use super::FileBuild;
use super::coerce::Ty;
use crate::declared::{Declared, Part, prim};
use crate::fragment::{LayoutKey, NO_FILE};
use crate::id::{FuncId, LayoutId, StrId, TyId};
use crate::ir::{Field, Layout, LayoutKind, Literal, CoerceReason, field_flags};
use bun_sema::atom::Atom;
use bun_sema::bind::{Decl, SymFlags};
use bun_sema::check::{self, BuiltIn, Storage, kind};
use bun_sema::hir::{ClassId, FileKind, ParamId};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::{EnumValue, Intrinsic, Literalness, MapperId, Origin, Prop, PropFlags, TypeData, TypeId};

const MAX_LAYOUTS_IN_UNION: usize = 4;
pub(super) const MAX_DESCRIPTION_DEPTH: u8 = 4;

mod cached {
    use crate::declared::Declared;

    pub(super) const ANY: u16 = 1;
    pub(super) const RECORD: u16 = 2;
    pub(super) const OTHER: u16 = 4;
    pub(super) const PLAIN: u16 = 8;
    pub(super) const LEAF: u16 = 16;

    pub(super) fn pack(kind: u16, described: &Declared) -> u16 {
        kind | (described.prims as u16) << 5 | u16::from(described.any_object) << 14 | u16::from(described.any_function) << 15
    }

    pub(super) fn unpack(packed: u16) -> Declared {
        Declared { prims: u32::from(packed >> 5 & 0x1FF), any_object: packed >> 14 & 1 != 0, any_function: packed >> 15 & 1 != 0, ..Declared::default() }
    }
}

pub(crate) enum FieldTypes {
    Properties(TypeId),
    Members { base: LayoutId, declared_by: Vec<(u32, Sym)>, implemented: Vec<(u32, TypeId, Atom)> },
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn ty_of(&mut self, ty: TypeId) -> TyId {
        self.ty_at_depth(ty, 0)
    }

    fn ty_at_depth(&mut self, ty: TypeId, depth: u8) -> TyId {
        if depth > MAX_DESCRIPTION_DEPTH {
            return self.out.tys.anything;
        }
        if let Some(&known) = self.tys.get(&(ty, depth)) {
            return known;
        }
        self.describe(ty, depth)
    }

    fn describe_nested(&mut self, ty: TypeId, depth: u8) -> TyId {
        let id = self.ty_at_depth(ty, depth);
        self.description_is_layout_free &= self.cached_description(ty) & (cached::ANY | cached::PLAIN) != 0;
        self.description_is_leaf &= self.is_always_describable(ty);
        id
    }

    pub(crate) fn is_always_describable(&self, ty: TypeId) -> bool {
        matches!(
            self.c.data(ty),
            TypeData::Intrinsic(_) | TypeData::StringLit { .. } | TypeData::BigIntLit { .. } | TypeData::BoolLit { .. } | TypeData::NumberLit { .. } | TypeData::EnumLit { .. } | TypeData::Enum { .. } | TypeData::UniqueSymbol { .. } | TypeData::Fns { .. }
        )
    }

    fn cached_description(&self, ty: TypeId) -> u16 {
        if self.file == NO_FILE { 0 } else { self.c.cached_description(ty) }
    }

    fn publish_description(&self, ty: TypeId, description: u16) {
        if self.file != NO_FILE {
            self.c.publish_description(ty, description);
        }
    }

    fn describe(&mut self, ty: TypeId, depth: u8) -> TyId {
        let known = self.cached_description(ty);
        let described = if known & cached::ANY != 0 {
            Some(self.out.tys.anything)
        } else if known & cached::PLAIN != 0 {
            if known & cached::LEAF == 0
                && depth == 0
                && let TypeData::Union(parts) = self.c.data(ty)
            {
                for &part in parts.iter() {
                    if !self.is_always_describable(part) {
                        self.ty_at_depth(part, depth);
                    }
                }
            }
            let described = cached::unpack(known);
            Some(self.out.tys.intern(if depth > 0 { described.with_literal_string_widened() } else { described }))
        } else if known & cached::RECORD != 0 {
            self.record_layout(ty).map(|layout| self.out.tys.intern(Declared { parts: Declared::part(Part::Class(layout)).parts, ..cached::unpack(known) }))
        } else {
            None
        };
        if let Some(id) = described {
            self.tys.insert((ty, depth), id);
            return id;
        }
        if known & cached::OTHER == 0 {
            let reduced = self.c.reduced(ty);
            if reduced != ty {
                let id = self.ty_at_depth(reduced, depth);
                self.tys.insert((ty, depth), id);
                return id;
            }
            if self.c.accepts_primitives(ty) {
                self.publish_description(ty, cached::ANY);
                self.tys.insert((ty, depth), self.out.tys.anything);
                return self.out.tys.anything;
            }
            if self.is_record_type(ty)
                && let Some(layout) = self.record_layout(ty)
            {
                let described = Declared::part(Part::Class(layout));
                let around = std::mem::replace(&mut self.description_is_leaf, true);
                let described = if self.c.is_coercion_result_type(ty) { described } else { self.with_primitives(ty, described) };
                let is_alone = std::mem::replace(&mut self.description_is_leaf, around);
                let described = described.nullable();
                if is_alone {
                    self.publish_description(ty, cached::pack(cached::RECORD, &described));
                }
                let id = self.out.tys.intern(described);
                self.tys.insert((ty, depth), id);
                return id;
            }
        }
        let around = (std::mem::replace(&mut self.description_is_layout_free, true), std::mem::replace(&mut self.description_is_leaf, true));
        let id = self.describe_non_record(ty, depth);
        let (is_plain, is_alone) = (std::mem::replace(&mut self.description_is_layout_free, around.0), std::mem::replace(&mut self.description_is_leaf, around.1));
        let described = self.out.tys.get(id);
        let is_plain = is_plain && described.parts.is_empty() && described.ints.is_none() && (depth == 0 || described.prims & prim::STRING == 0);
        if is_plain && is_alone {
            self.publish_description(ty, cached::pack(cached::OTHER | cached::PLAIN | cached::LEAF, described));
        } else if is_plain && matches!(self.c.data(ty), TypeData::Union(_)) {
            self.publish_description(ty, cached::pack(cached::OTHER | cached::PLAIN, described));
        } else if known & cached::OTHER == 0 {
            self.publish_description(ty, cached::OTHER);
        }
        id
    }

    fn describe_non_record(&mut self, ty: TypeId, depth: u8) -> TyId {
        let mut result = self.ty_at_depth_uncached(ty, depth);
        if matches!(self.c.data(ty), TypeData::Ref { .. } | TypeData::Anon { origin: Origin::TypeLiteral(..), .. }) && !self.c.is_array(ty) && result.has_objects() {
            result = self.with_primitives(ty, result);
        }
        if result.has_multiple_primitive_kinds() {
            result = result.or(&Declared::any_object());
        }
        let mut result = result.nullable();
        if !result.is_never() && self.c.accepts_nullish(ty) {
            result.prims |= prim::NULLISH;
        }
        if depth > 0 {
            result = result.with_literal_string_widened();
        }
        let id = self.out.tys.intern(result);
        self.tys.insert((ty, depth), id);
        id
    }

    fn with_primitives(&mut self, ty: TypeId, mut described: Declared) -> Declared {
        for primitive in self.c.assignable_primitives(ty) {
            self.description_is_leaf = false;
            let primitive = self.ty_of(primitive);
            described = described.or(self.out.tys.get(primitive));
        }
        described
    }

    pub(crate) fn declared(&mut self, ty: TypeId) -> TyId {
        let described = self.ty_of(ty);
        if described == self.out.tys.anything || self.out.tys.get(described).is_never() { TyId::NONE } else { described }
    }

    pub(crate) fn kinds_ty(&mut self, kinds: u16) -> TyId {
        if kinds & kind::OBJECTS != 0 || kinds == kind::NOTHING {
            return TyId::NONE;
        }
        let primitives = [
            (kind::UNDEFINED, prim::UNDEFINED),
            (kind::NULL, prim::NULL),
            (kind::BOOLEAN, prim::BOOLEAN),
            (kind::NUMBER, prim::NUMBER),
            (kind::STRING, prim::STRING),
            (kind::BIGINT, prim::BIGINT),
            (kind::SYMBOL, prim::SYMBOL),
        ];
        self.out.tys.intern(Declared::prims(primitives.iter().filter(|it| kinds & it.0 != 0).fold(0, |all, it| all | it.1)))
    }

    pub(crate) fn none_if_unranged_number(&self, ty: TyId) -> TyId {
        if ty.is_some() && self.out.tys.get(ty).prims & prim::NUMBER != 0 { TyId::NONE } else { ty }
    }

    fn ty_from_stores(&mut self, sym: Sym) -> Ty {
        let kinds = self.query(|c| c.symbol_kinds(sym));
        let described = self.kinds_ty(if kinds & kind::SYMBOL != 0 { kinds | kind::UNDEFINED } else { kinds });
        let integers = if kinds & (kind::NUMBER | kind::BIGINT) == kind::NUMBER { self.query(|c| c.symbol_integer_range(sym)) } else { None };
        let described = self.with_integers(described, integers);
        Ty::from_id(self.none_if_unranged_number(described))
    }

    pub(crate) fn symbol_ty(&mut self, sym: Sym) -> Ty {
        let file = self.value_declaration(sym).map_or(sym.file, |(file, _)| file);
        if self.is_untyped_file(file) {
            return self.ty_from_stores(sym);
        }
        let storage = self.c.symbol_storage(sym);
        self.storage_ty(storage, Some(sym))
    }

    pub(crate) fn symbol_store_ty(&mut self, sym: Sym) -> Ty {
        let Some((file, Decl::Var(_))) = self.value_declaration(sym) else { return self.symbol_ty(sym) };
        if self.is_untyped_file(file) {
            return Ty::NONE;
        }
        let storage = self.c.symbol_storage(sym);
        self.storage_ty(Storage { starts_undefined: false, ..storage }, Some(sym))
    }

    pub(crate) fn param_ty(&mut self, file: FileId, p: ParamId) -> Ty {
        let hir = self.hir(file);
        let name = self.c.bound(file).pat_symbol[hir[p].pat.idx()].some().map(|name| self.files.sym(file, name));
        if self.is_untyped_file(file) {
            return name.map_or(Ty::NONE, |name| self.ty_from_stores(name));
        }
        let storage = self.query(|c| c.param_storage(file, p));
        self.storage_ty(storage, name)
    }

    pub(crate) fn param_cast_reason(&mut self, file: FileId, p: ParamId) -> CoerceReason {
        if self.query(|c| c.is_param_annotated(file, p)) { CoerceReason::Cast } else { CoerceReason::Store }
    }

    fn storage_ty(&mut self, storage: Storage, sym: Option<Sym>) -> Ty {
        let mut id = self.declared(storage.ty);
        if id.is_none()
            && let Some(sym) = sym
            && let Some((file, initializer)) = self.c.initializer_of_const(sym)
            && let Some(created) = self.allocation_ty(file, initializer)
        {
            id = created;
        }
        if let Some(sym) = sym
            && id.is_some()
            && self.out.tys.get(id).prims & prim::NUMBER != 0
        {
            let integers = self.query(|c| c.symbol_integer_range(sym));
            id = self.with_integers(id, integers);
        }
        if id.is_some() && storage.starts_undefined {
            id = self.or_undefined(id);
        }
        Ty { id, checked: storage.ty }
    }

    fn base_classes(&self, layout: LayoutId) -> Vec<(FileId, ClassId)> {
        let mut extended = Vec::new();
        let mut at = self.out.layouts[layout.idx()].base;
        while at.is_some() {
            let Some(&class) = self.fixed_layout_classes.get(&at) else { return Vec::new() };
            extended.push(class);
            at = self.out.layouts[at.idx()].base;
        }
        extended
    }

    pub(crate) fn field_starts_undefined(&mut self, layout: LayoutId, sym: Sym) -> bool {
        let extended = self.base_classes(layout);
        self.c.field_starts_undefined(sym, &extended)
    }

    pub(crate) fn this_escapes_in_base_classes(&mut self, layout: LayoutId) -> bool {
        let extended = self.base_classes(layout);
        extended.is_empty() || self.c.this_escapes_during_construction(&extended)
    }

    pub(crate) fn initializers_where_this_escapes(&mut self, layout: LayoutId, file: FileId, class: ClassId) -> Vec<bun_sema::hir::MemberId> {
        let extended = self.base_classes(layout);
        self.c.initializers_where_this_escapes(file, class, &extended)
    }

    pub(crate) fn cast_target_ty(&mut self, ty: TyId) -> TyId {
        if let Some(&(grown, known)) = self.cast_targets.get(&ty)
            && grown == self.layout_growth_epoch
        {
            return known;
        }
        let found = self.find_cast_target_ty(ty);
        self.cast_targets.insert(ty, (self.layout_growth_epoch, found));
        found
    }

    fn find_cast_target_ty(&mut self, ty: TyId) -> TyId {
        let described = self.out.tys.get(ty).clone();
        let mut target = Declared { parts: Default::default(), ..described };
        for part in &described.parts {
            match part {
                Part::Class(view) if self.union_part_layouts.contains_key(view) => {
                    for &layout in &self.union_part_layouts[view] {
                        target = target.or(&Declared::part(Part::Class(layout)));
                    }
                }
                &Part::Array(elements) if elements != ty => {
                    let elements = self.cast_target_ty(elements);
                    target = target.or(&Declared::part(Part::Array(elements)));
                }
                part => target = target.or(&Declared::part(part.clone())),
            }
        }
        if target == described { ty } else { self.out.tys.intern(target) }
    }

    pub(crate) fn or_undefined(&mut self, ty: TyId) -> TyId {
        let widened = self.out.tys.get(ty).or(&Declared::prims(prim::UNDEFINED));
        self.out.tys.intern(widened)
    }

    pub(crate) fn or_any_primitive(&mut self, ty: TyId) -> TyId {
        let widened = self.out.tys.get(ty).or(&Declared::prims(prim::ALL));
        self.out.tys.intern(widened)
    }

    fn ty_at_depth_uncached(&mut self, ty: TypeId, depth: u8) -> Declared {
        match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Never | Intrinsic::SilentNever | Intrinsic::UnreachableNever | Intrinsic::ImplicitNever | Intrinsic::UniqueLiteral => Declared::never(),
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening => Declared::prims(prim::UNDEFINED),
                Intrinsic::Null | Intrinsic::NullWidening => Declared::prims(prim::NULL),
                Intrinsic::String => Declared::prims(prim::STRING),
                Intrinsic::Number => Declared::prims(prim::NUMBER),
                Intrinsic::BigInt => Declared::prims(prim::BIGINT),
                Intrinsic::Symbol => Declared::prims(prim::SYMBOL),
                Intrinsic::Object => Declared::any_object(),
                _ => Declared::anything(),
            },
            TypeData::StringLit { .. } => Declared::prims(prim::LITERAL_STRING),
            TypeData::BigIntLit { .. } => Declared::prims(prim::BIGINT),
            TypeData::BoolLit { value, .. } => Declared::prims(if *value { prim::TRUE } else { prim::FALSE }),
            TypeData::EnumLit { value: EnumValue::String(_), .. } => Declared::prims(prim::LITERAL_STRING),
            TypeData::NumberLit { .. } | TypeData::EnumLit { value: EnumValue::Number(_), .. } => match self.c.type_integer_range(ty) {
                Some((minimum, maximum)) => Declared::ints(minimum, maximum),
                None => Declared::prims(prim::NUMBER),
            },
            TypeData::Enum { .. } => Declared::prims(prim::NUMBER),
            TypeData::UniqueSymbol { .. } => Declared::prims(prim::SYMBOL),
            TypeData::Union(parts) => {
                let mut result = Declared::never();
                let mut objects: Vec<TypeId> = Vec::new();
                let is_next_to_enum = self.c.has_numeric_enum_member(ty);
                for &part in parts.iter() {
                    if matches!(self.c.data(part), TypeData::NumberLit { .. })
                        && let Some((minimum, maximum)) = self.c.union_part_integer_range(part, is_next_to_enum)
                    {
                        result.merge(&Declared::ints(minimum, maximum));
                        continue;
                    }
                    let described = self.describe_nested(part, depth);
                    let described = self.out.tys.get(described);
                    if described.single_layout().is_some() {
                        objects.push(part);
                    } else {
                        result.merge(described);
                    }
                }
                let common = if objects.len() > MAX_LAYOUTS_IN_UNION { self.common_layout(&objects) } else { None };
                match common {
                    Some(layout) => {
                        let mut known_parts: bun_sema::util::FxHashSet<LayoutId> = self.union_part_layouts.get(&layout).into_iter().flatten().copied().collect();
                        for &part in &objects {
                            let described = self.ty_of(part);
                            let Some(part) = self.out.tys.get(described).single_layout() else { continue };
                            if known_parts.insert(part) {
                                self.union_part_layouts.entry(layout).or_default().push(part);
                                self.layout_growth_epoch += 1;
                            }
                        }
                        result = result.or(&Declared::part(Part::Class(layout)));
                    }
                    None => {
                        for part in objects {
                            let described = self.ty_at_depth(part, depth);
                            result.merge(self.out.tys.get(described));
                        }
                    }
                }
                self.merge_array_parts(result)
            }
            TypeData::Intersection(parts) => {
                let bound = self.c.value_bound(ty);
                if bound != ty {
                    self.description_is_layout_free = false;
                    let bound = self.ty_at_depth(bound, depth + 1);
                    return self.out.tys.get(bound).clone();
                }
                if let Some(element) = self.c.array_subtype_element(ty) {
                    return Declared::part(Part::Array(self.ty_at_depth(element, depth + 1)));
                }
                if let Some(extended) = self.c.extended_built_in(ty) {
                    return self.refined_built_in_ty(ty, &extended, depth);
                }
                let mut object = None;
                for &part in parts.iter() {
                    if matches!(self.c.data(part), TypeData::Intrinsic(Intrinsic::Void)) {
                        return Declared::prims(prim::UNDEFINED);
                    }
                    let part = self.describe_nested(part, depth);
                    let part = self.out.tys.get(part);
                    if !part.has_objects() && !part.is_never() {
                        let primitive = part.clone();
                        return if self.c.is_primitive_wrapper(ty) { primitive.or(&Declared::any_object()) } else { primitive };
                    }
                    if object.is_none() && !part.parts.is_empty() && part.prims == 0 {
                        object = Some(part.clone());
                    }
                }
                object.unwrap_or_else(Declared::any_object)
            }
            TypeData::Ref { target, .. } => {
                let target = *target;
                self.reference_ty(ty, target, depth)
            }
            TypeData::ThisParam(sym) if self.files.flags(*sym).contains(SymFlags::CLASS) => {
                let sym = *sym;
                self.reference_ty(ty, sym, depth)
            }
            TypeData::Tuple { .. } | TypeData::EvolvingArray(_) => self.array_of(ty, depth),
            TypeData::Fns { .. } => Declared::any_function(),
            TypeData::Anon { origin: Origin::Function(_) | Origin::ClassStatic(_), .. } => Declared::any_function(),
            TypeData::Anon { .. } | TypeData::Synth(_) | TypeData::ReverseMapped { .. } => Declared::any_object(),
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::IndexedAccess { .. } | TypeData::Cond { .. } | TypeData::Substitution { .. } => {
                let bound = self.c.value_bound(ty);
                if bound == ty {
                    return Declared::anything();
                }
                self.description_is_layout_free = false;
                let bound = self.ty_at_depth(bound, depth + 1);
                self.out.tys.get(bound).clone()
            }
            TypeData::Keyof(_) => Declared::prims(prim::STRING | prim::NUMBER | prim::SYMBOL),
            TypeData::Template { .. } | TypeData::StringMapping { .. } => Declared::prims(prim::STRING),
            _ => Declared::anything(),
        }
    }

    pub(crate) fn is_record_type(&mut self, ty: TypeId) -> bool {
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => {
                let target = *target;
                if self.c.is_array(ty) || self.files.flags(target).contains(SymFlags::CLASS) {
                    return false;
                }
                self.declares_records(target.file) && !self.c.is_ambient_interface(target) && self.c.array_subtype_element(ty).is_none() && self.c.extended_built_in(ty).is_none()
            }
            TypeData::Anon { origin, .. } => match *origin {
                Origin::TypeLiteral(file, literal) => self.declares_records(file) || self.c.is_safe_validate_result(file, literal),
                Origin::ObjectLiteral(file, ..) | Origin::WidenedLiteral(file, ..) => self.declares_records(file),
                Origin::Mapped(file, _) => match self.c.alias_of_type(ty) {
                    _ if self.is_untyped_file(file) => false,
                    Some((_, arguments)) if self.files.module(file).is_lib && arguments.iter().any(|&argument| argument.is_any() || argument == TypeId::UNKNOWN) => false,
                    Some((_, arguments)) => arguments.into_iter().all(|argument| !self.c.is_object_type(argument) || self.is_record_type(argument) || self.is_program_class(argument)),
                    None => self.is_written_in_typescript(file),
                },
                Origin::Module(namespace) => self.c.is_reified_namespace(namespace) && self.declares_records(namespace.file),
                _ => false,
            },
            TypeData::Intersection(parts) => parts.iter().all(|&part| self.is_record_type(part)),
            TypeData::Synth(shape) => shape.literal != Literalness::SyntheticDefault,
            TypeData::ReverseMapped { .. } => true,
            _ => false,
        }
    }

    fn is_program_class(&self, ty: TypeId) -> bool {
        matches!(self.c.data(ty), TypeData::Ref { target, .. } if self.files.flags(*target).contains(SymFlags::CLASS) && self.is_written_in_typescript(target.file) && self.shared.is_compiled(target.file))
    }

    fn declares_records(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        !self.is_untyped_file(file) && hir.kind != FileKind::Json && !self.files.module(file).is_lib
    }

    pub(crate) fn is_untyped_file(&self, file: FileId) -> bool {
        self.files.module(file).is_untyped()
    }

    fn is_written_in_typescript(&self, file: FileId) -> bool {
        let hir = self.hir(file);
        !self.is_untyped_file(file) && hir.kind != FileKind::Json && !self.is_declaration_only(file)
    }

    pub(crate) fn is_ambient_only(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED || self.c.is_uninformative(ty) {
            return false;
        }
        self.c.parts(ty).to_vec().into_iter().any(|part| match *self.c.data(part) {
            TypeData::Ref { target, .. } => self.is_declaration_only(target.file) && (!self.files.module(target.file).is_lib || self.ty_of(part) == self.out.tys.anything),
            _ => false,
        })
    }

    fn allocation_ty(&mut self, file: FileId, e: bun_sema::hir::ExprId) -> Option<TyId> {
        match self.hir(file)[e].kind {
            bun_sema::hir::ExprKind::New(_) => self.new_result_ty(file, e),
            bun_sema::hir::ExprKind::Call(_) => self.call_result_ty(file, e),
            _ => None,
        }
    }

    pub(crate) fn call_result_ty(&mut self, file: FileId, e: bun_sema::hir::ExprId) -> Option<TyId> {
        if !self.c.has_declared_type(file, e) {
            return None;
        }
        let created = self.c.type_of_expr(file, e);
        if self.ty_of(created) != self.out.tys.anything {
            return None;
        }
        let TypeData::Ref { target, .. } = *self.c.data(created) else { return None };
        let name = self.files.symbol(target).name;
        if self.c.global_type_symbol(name) != Some(target) || !self.files.module(target.file).is_lib || !self.c.calls_global_static_method(file, e, name) {
            return None;
        }
        Some(self.out.tys.intern(Declared::any_object()))
    }

    pub(crate) fn new_result_ty(&mut self, file: FileId, e: bun_sema::hir::ExprId) -> Option<TyId> {
        if !self.c.has_declared_type(file, e) {
            return None;
        }
        let created = self.c.type_of_expr(file, e);
        if self.ty_of(created) != self.out.tys.anything {
            return None;
        }
        let root = match self.c.extended_built_in(created) {
            Some(BuiltIn::Instance(root)) => root,
            _ => created,
        };
        let TypeData::Ref { target, .. } = *self.c.data(root) else { return None };
        let name = self.files.symbol(target).name;
        if self.c.global_type_symbol(name) != Some(target) || !self.files.module(target.file).is_lib {
            return None;
        }
        if root == created && !matches!(self.c.atoms().bytes(name), b"Error" | b"Promise") && self.c.constructs_global_object(file, e, name) {
            let name = self.str(name);
            return Some(self.out.tys.intern(Declared::part(Part::Global(name, Default::default()))));
        }
        Some(self.out.tys.intern(Declared::any_object()))
    }

    fn reference_ty(&mut self, ty: TypeId, target: Sym, depth: u8) -> Declared {
        if self.c.is_array(ty) {
            return self.array_of(ty, depth);
        }
        if let Some(element) = self.c.array_subtype_element(ty) {
            return Declared::part(Part::Array(self.ty_at_depth(element, depth + 1)));
        }
        if let Some(extended) = self.c.extended_built_in(ty) {
            return self.refined_built_in_ty(ty, &extended, depth);
        }
        if self.files.flags(target).contains(SymFlags::CLASS)
            && let Some((file, Decl::Class(class))) = self.value_declaration(target)
            && !self.is_ambient(target)
        {
            self.description_is_layout_free = false;
            return match self.instance_layout(file, class) {
                Some(layout) => Declared::part(Part::Class(layout)),
                None => Declared::any_object(),
            };
        }
        let name = self.files.symbol(target).name;
        if self.c.global_type_symbol(name) == Some(target) {
            let primitives = match self.c.atoms().bytes(name) {
                b"String" => prim::STRING,
                b"Number" => prim::NUMBER,
                b"Boolean" => prim::BOOLEAN,
                b"Symbol" => prim::SYMBOL,
                b"BigInt" => prim::BIGINT,
                _ => 0,
            };
            if primitives != 0 {
                return Declared::any_object().or(&Declared::prims(primitives));
            }
            if self.c.atoms().bytes(name) == b"Error" {
                return Declared::anything();
            }
            if self.c.atoms().bytes(name) == b"Promise" {
                return Declared::anything();
            }
            let is_only_predicted = matches!(self.c.atoms().bytes(name), b"ArrayBuffer" | b"SharedArrayBuffer" | b"DataView" | b"WeakMap" | b"WeakSet" | b"WeakRef" | b"FinalizationRegistry");
            if self.is_declaration_only(target.file) && (is_only_predicted || !self.files.module(target.file).is_lib) {
                return Declared::anything();
            }
            let arguments: Vec<TypeId> = self.c.type_arguments(ty).to_vec();
            let arguments = arguments.into_iter().map(|argument| self.ty_at_depth(argument, depth + 1)).collect();
            let name = self.str(name);
            return Declared::part(Part::Global(name, arguments));
        }
        if self.is_declaration_only(target.file) {
            return Declared::anything();
        }
        Declared::any_object()
    }

    fn refined_built_in_ty(&mut self, ty: TypeId, built_in: &BuiltIn, depth: u8) -> Declared {
        let is_call_with_narrower_type = matches!(built_in, BuiltIn::Function)
            && (!self.c.signatures(ty, false).is_empty() || !self.c.signatures(ty, true).is_empty())
            && self.c.members(ty).is_some_and(|members| !members.shape().props.is_empty());
        if is_call_with_narrower_type { Declared::any_object() } else { self.built_in_ty(built_in, depth) }
    }

    fn built_in_ty(&mut self, built_in: &BuiltIn, depth: u8) -> Declared {
        match built_in {
            BuiltIn::Function => Declared::any_function(),
            BuiltIn::Claimed => Declared::anything(),
            BuiltIn::Instance(class) => {
                let class = self.describe_nested(*class, depth);
                self.out.tys.get(class).clone()
            }
        }
    }

    fn array_of(&mut self, ty: TypeId, depth: u8) -> Declared {
        let element = match self.c.array_element(ty) {
            Some(element) => self.ty_at_depth(element, depth + 1),
            None => {
                let mut result = Declared::never();
                let arguments: Vec<TypeId> = self.c.type_arguments(ty).to_vec();
                for argument in arguments {
                    let argument = self.ty_at_depth(argument, depth + 1);
                    result.merge(self.out.tys.get(argument));
                }
                self.out.tys.intern(result)
            }
        };
        Declared::part(Part::Array(element))
    }

    pub(crate) fn add_layout(&mut self, kind: LayoutKind, name: StrId, key: LayoutKey) -> LayoutId {
        let id = LayoutId::new(self.out.layouts.len());
        self.layout_keys.push(key);
        self.out.layouts.push(Layout {
            kind,
            name,
            base: LayoutId::NONE,
            fields: Vec::new(),
            methods: Vec::new(),
            constructor: FuncId::NONE,
            class_flags: 0,
            environment: LayoutId::NONE,
            static_fields: Vec::new(),
            is_allocated: false,
            may_be_frozen: false,
            accepts_untyped: false,
            is_relaxed_for_logging: false,
            accepts_only_other_layouts: false,
            members: Vec::new(),
            structural_subtypes: Vec::new(),
            specializations: Vec::new(),
            declared_path: StrId::NONE,
            declared_line: 0,
        });
        id
    }

    fn merge_array_parts(&mut self, mut described: Declared) -> Declared {
        let elements: Vec<TyId> = described.parts.iter().filter_map(|part| if let Part::Array(element) = part { Some(*element) } else { None }).collect();
        if elements.len() < 2 {
            return described;
        }
        let mut merged = Declared::never();
        for element in elements {
            merged.merge(self.out.tys.get(element));
        }
        let merged = self.merge_array_parts(merged);
        let merged = self.out.tys.intern(merged);
        described.parts.retain(|part| !matches!(part, Part::Array(_)));
        described.parts.push(Part::Array(merged));
        described.parts.sort_unstable();
        described
    }

    pub(crate) fn record_layout(&mut self, ty: TypeId) -> Option<LayoutId> {
        let ty = self.c.layout_defining_type(ty);
        if let Some(&known) = self.records.get(&ty) {
            return known;
        }
        self.add_record_layout(ty)
    }

    fn common_layout(&mut self, objects: &[TypeId]) -> Option<LayoutId> {
        let union = self.c.union(objects);
        let common = self.c.common_supertype_of_union(union);
        self.record_layout(common)
    }

    fn add_record_layout(&mut self, ty: TypeId) -> Option<LayoutId> {
        let has_no_fields = self.c.members(ty).is_none_or(|members| !members.shape().call.is_empty() || !members.shape().construct.is_empty() || members.shape().props.is_empty());
        let fields = if has_no_fields || self.c.is_instance_type(ty) || self.c.is_nested_too_deeply(ty) || self.c.may_be_redefined(ty) { None } else { self.declare_fields(ty) };
        let Some(fields) = fields else {
            self.records.insert(ty, None);
            return None;
        };
        let name = match self.c.alias_of_type(ty) {
            Some((alias, _)) => self.str(self.files.symbol(alias).name),
            None => match self.c.data(ty) {
                TypeData::Ref { target, .. } | TypeData::Anon { origin: Origin::Module(target), .. } => self.str(self.files.symbol(*target).name),
                _ => StrId::NONE,
            },
        };
        let key = LayoutKey::Record(self.retain_type(ty));
        let id = self.add_layout(LayoutKind::Record, name, key);
        self.out.layouts[id.idx()].fields = fields;
        self.out.layouts[id.idx()].methods = self.literal_accessors(ty);
        self.records.insert(ty, Some(id));
        self.layout_types.insert(id, ty);
        self.layouts_pending_field_types.insert(id, FieldTypes::Properties(ty));
        Some(id)
    }

    fn literal_accessors(&mut self, ty: TypeId) -> Vec<crate::ir::Method> {
        let TypeData::Anon { origin: Origin::ObjectLiteral(file, literal, ..) | Origin::WidenedLiteral(file, literal, ..), .. } = *self.c.data(ty) else { return Vec::new() };
        if self.is_declaration_only(file) {
            return Vec::new();
        }
        let hir = self.hir(file);
        let bun_sema::hir::ExprKind::Object(props) = hir[literal].kind else { return Vec::new() };
        let mut accessors = Vec::new();
        for p in props.iter() {
            let kind = match hir[p].kind {
                bun_sema::hir::PropKind::Getter => crate::ir::MethodKind::Getter,
                bun_sema::hir::PropKind::Setter => crate::ir::MethodKind::Setter,
                _ => continue,
            };
            let (bun_sema::hir::PropKey::Name(name), bun_sema::hir::ExprKind::Fn(accessor)) = (hir[p].key, hir[hir[p].value].kind) else { continue };
            let (name, func) = (self.str(name), self.forward_declare_function(file, accessor));
            accessors.push(crate::ir::Method { name, func, kind, flags: 0, key: crate::ir::NO_VARIABLE });
        }
        accessors
    }

    pub(crate) fn set_class_field_types(&mut self, layout: LayoutId, class: Sym, base: LayoutId, declared_by: Vec<(u32, Sym)>, implemented: Vec<(u32, TypeId, Atom)>) {
        let declarations = &self.c.bound(class.file).symbols[class.id.idx()].decls;
        if let Some(&Decl::Class(declaration)) = declarations.iter().find(|decl| matches!(decl, Decl::Class(_))) {
            self.fixed_layout_classes.insert(layout, (class.file, declaration));
        }
        self.layouts_pending_field_types.insert(layout, FieldTypes::Members { base, declared_by, implemented });
    }

    pub(crate) fn is_field_name(name: &[u8]) -> bool {
        name.first().is_some_and(|first| !first.is_ascii_digit())
    }

    fn declare_fields(&mut self, ty: TypeId) -> Option<Vec<Field>> {
        let members = self.c.members(ty)?;
        let shape = members.shape();
        if !shape.call.is_empty() || !shape.construct.is_empty() || shape.props.is_empty() {
            return None;
        }
        let is_of_literal = matches!(self.c.data(ty), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. });
        let mut fields = Vec::with_capacity(shape.props.len());
        for prop in shape.props.iter() {
            if prop.flags.contains(PropFlags::ACCESSOR) {
                if is_of_literal {
                    continue;
                }
                return None;
            }
            let is_named_by_constant_symbol = self.c.constant_symbol_of_property(prop.name).is_some();
            let bytes = self.c.atoms().bytes(prop.name);
            if bytes.first() == Some(&0xFE) && !is_named_by_constant_symbol || bytes == b"__proto__" || !Self::is_field_name(bytes) {
                return None;
            }
            let mut flags = 0;
            if prop.flags.contains(PropFlags::OPTIONAL) || self.c.is_deleted_from_untyped_objects(prop.name) {
                flags |= field_flags::OPTIONAL;
            }
            if prop.flags.contains(PropFlags::METHOD) {
                flags |= field_flags::METHOD;
            }
            let name = self.str(prop.name);
            if is_named_by_constant_symbol && fields.iter().any(|field: &Field| field.name == name) {
                return None;
            }
            fields.push(Field::new(name, TyId::NONE, flags));
        }
        for &(name, _) in self.c.undeclared_fields_for(ty).iter() {
            fields.push(Field::new(self.str(name), TyId::NONE, field_flags::OPTIONAL));
        }
        Some(fields)
    }

    fn field_literals(&mut self, checked: TypeId) -> Vec<Literal> {
        let literals = self.c.type_literals(checked);
        (literals.into_iter())
            .map(|literal| match literal {
                check::Literal::String(text) => Literal::Str(self.str(text)),
                check::Literal::Number(value) => Literal::Num(value),
            })
            .collect()
    }

    pub(crate) fn resolve_field_types(&mut self, layout: LayoutId) {
        match self.layouts_pending_field_types.remove(&layout) {
            None => {}
            Some(FieldTypes::Properties(ty)) => {
                let Some(members) = self.c.members(ty) else { return };
                let own = members.shape().props.iter().filter(|prop| !prop.flags.contains(PropFlags::ACCESSOR));
                for (i, prop) in own.clone().enumerate() {
                    self.set_field_type_from_property(layout, i as u32, prop, members.mapper, ty);
                }
                for (i, &(name, declaring)) in self.c.undeclared_fields_for(ty).iter().enumerate() {
                    let field = (own.clone().count() + i) as u32;
                    let Some(declared_by) = self.c.members(declaring) else { continue };
                    let Some(prop) = declared_by.shape().props.iter().find(|prop| prop.name == name) else { continue };
                    self.set_field_type_from_property(layout, field, prop, declared_by.mapper, declaring);
                    let checked = self.c.union(&[self.checked_fields[&(layout, field)], TypeId::UNDEFINED]);
                    self.checked_fields.insert((layout, field), checked);
                    let of_layout = &mut self.out.layouts[layout.idx()].fields[field as usize];
                    of_layout.flags &= !field_flags::DECLARED_WITHOUT_UNDEFINED;
                    let declared = of_layout.declared;
                    if declared.is_some() && declared != self.out.tys.anything {
                        self.out.layouts[layout.idx()].fields[field as usize].declared = self.or_undefined(declared);
                    }
                }
            }
            Some(FieldTypes::Members { base, declared_by, implemented }) => {
                self.resolve_field_types(base);
                let inherited = if base.is_some() { self.out.layouts[base.idx()].fields.len() } else { 0 };
                for i in 0..inherited {
                    self.out.layouts[layout.idx()].fields[i].declared = self.out.layouts[base.idx()].fields[i].declared;
                    let literals = self.out.layouts[base.idx()].fields[i].literals.clone();
                    self.out.layouts[layout.idx()].fields[i].literals = literals;
                    if let Some(&checked) = self.checked_fields.get(&(base, i as u32)) {
                        self.checked_fields.insert((layout, i as u32), checked);
                    }
                    if self.annotated_fields.contains(&(base, i as u32)) {
                        self.annotated_fields.insert((layout, i as u32));
                    }
                }
                let extended = self.base_classes(layout);
                for (field, sym) in declared_by {
                    let storage = self.c.field_storage(sym, &extended);
                    let declared = self.storage_ty(storage, Some(sym));
                    let name = self.files.symbol(sym).name;
                    let is_widened_by_store = self.fixed_layout_classes.get(&layout).copied().is_some_and(|(file, class)| {
                        let instances = self.c.class_instance_type(file, class);
                        self.c.is_widened_by_checked_source_store(instances, name)
                    });
                    let declared = if is_widened_by_store { Ty { id: self.out.tys.anything, checked: TypeId::UNKNOWN } } else { declared };
                    self.out.layouts[layout.idx()].fields[field as usize].declared = declared.id;
                    self.out.layouts[layout.idx()].fields[field as usize].literals = self.field_literals(declared.checked);
                    self.checked_fields.insert((layout, field), declared.checked);
                    if self.c.is_annotated(sym) {
                        self.annotated_fields.insert((layout, field));
                    } else {
                        self.annotated_fields.remove(&(layout, field));
                    }
                }
                for (field, interface, name) in implemented {
                    let Some(members) = self.c.members(interface) else { continue };
                    let Some(prop) = members.shape().props.iter().find(|prop| prop.name == name) else { continue };
                    if prop.flags.contains(PropFlags::METHOD) {
                        self.out.layouts[layout.idx()].fields[field as usize].flags |= field_flags::METHOD;
                    }
                    self.set_field_type_from_property(layout, field, prop, members.mapper, interface);
                    if !prop.flags.contains(PropFlags::OPTIONAL) {
                        let declared = self.out.layouts[layout.idx()].fields[field as usize].declared;
                        self.out.layouts[layout.idx()].fields[field as usize].declared = self.or_undefined(declared);
                    }
                }
            }
        }
    }

    fn is_inferred_only_from_first_value(&mut self, prop: &Prop, found_in: TypeId, checked: TypeId) -> bool {
        if !matches!(self.c.data(found_in), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. }) || prop.flags.contains(PropFlags::READONLY) || self.c.is_prop_annotated(prop) {
            return false;
        }
        let parts: Vec<TypeId> = match self.c.data(checked) {
            TypeData::Union(parts) => parts.to_vec(),
            _ => vec![checked],
        };
        let is_nullish = |data: &TypeData| matches!(data, TypeData::Intrinsic(Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening));
        parts.iter().all(|&part| is_nullish(self.c.data(part))) || parts.len() == 1 && matches!(self.c.data(parts[0]), TypeData::BoolLit { .. } | TypeData::NumberLit { .. } | TypeData::StringLit { .. } | TypeData::BigIntLit { .. })
    }

    fn set_field_type_from_property(&mut self, layout: LayoutId, field: u32, prop: &Prop, mapper: MapperId, found_in: TypeId) {
        let is_predicted = self.c.is_prop_predicted(prop) || self.c.is_predicted_through_spread(found_in, prop.name) || self.c.is_widened_by_checked_source_store(found_in, prop.name);
        let checked = if is_predicted { TypeId::UNKNOWN } else { self.c.prop_storage_type(prop, mapper) };
        let checked = if self.is_inferred_only_from_first_value(prop, found_in, checked) { TypeId::UNKNOWN } else { checked };
        let may_be_absent = prop.flags.contains(PropFlags::OPTIONAL) || self.out.layouts[layout.idx()].fields[field as usize].flags & field_flags::OPTIONAL != 0;
        let checked = if may_be_absent && !self.c.accepts_undefined(checked) { self.c.union(&[checked, TypeId::UNDEFINED]) } else { checked };
        let declared = self.declared(checked);
        let written = self.c.annotated_prop_integer_range(prop);
        let declared = self.with_integers(declared, written);
        self.out.layouts[layout.idx()].fields[field as usize].declared = self.or_anything(declared);
        self.out.layouts[layout.idx()].fields[field as usize].literals = self.field_literals(checked);
        if !self.c.accepts_undefined(checked) {
            self.out.layouts[layout.idx()].fields[field as usize].flags |= field_flags::DECLARED_WITHOUT_UNDEFINED;
        }
        self.checked_fields.insert((layout, field), checked);
        if self.c.is_prop_annotated(prop) {
            self.annotated_fields.insert((layout, field));
        }
    }

    pub(crate) fn has_resolved_field_types(&self, layout: LayoutId) -> bool {
        !self.layouts_pending_field_types.contains_key(&layout)
    }
}
