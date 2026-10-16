//! The checker's types as descriptions for the compiler behind the front end, and the layouts of the object types of the program.

use super::FileBuild;
use super::fit::Ty;
use crate::declared::{Declared, Part, prim};
use crate::fragment::LayoutKey;
use crate::id::{FuncId, LayoutId, StrId, TyId};
use crate::ir::{Field, Layout, LayoutKind, Literal, Why, field_flags};
use bun_sema::atom::Atom;
use bun_sema::bind::{Decl, SymFlags};
use bun_sema::check::{self, BuiltIn, Storage, kind};
use bun_sema::hir::{ClassId, FileKind, ParamId};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::{EnumValue, Intrinsic, Literalness, MapperId, Origin, Prop, PropFlags, TypeData, TypeId};

/// A union of more object types of the program than this is described by what they have in common. Whether one type is within another
/// is asked for every pair of their parts, over and over, and a program has unions of hundreds of object types. The target of a cast
/// names the parts all the same: see `ty_of_cast_target`.
const MOST_LAYOUTS_IN_UNION: usize = 4;
/// A description says what an array holds, what that holds if it is an array again, and so on, this many times. After that it says
/// `anything`. A type may hold itself, `type Json = string | Json[]`, and a description cannot. Where it stops is counted from the type
/// that is described, so that a description follows from the type and from nothing that was described before. A layout is named and
/// not looked into, so it needs no end.
pub(super) const MOST_HELD_WITHIN_EACH_OTHER: u8 = 4;

/// Where the types of the fields of a layout are to be had.
pub(crate) enum FieldTypes {
    /// From the properties of the type, which the fields are in the order of.
    Properties(TypeId),
    /// Of a class: from the layout it extends, whose fields come first, and by field from the member or the parameter that declares it,
    /// or from the property of that name of a type that the class implements.
    Members { base: LayoutId, declared_by: Vec<(u32, Sym)>, implemented: Vec<(u32, TypeId, Atom)> },
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    /// Everything a value of the checker's type can be, as far as a description tells.
    pub(crate) fn ty_of(&mut self, ty: TypeId) -> TyId {
        self.ty_within(ty, 0)
    }

    /// The same for a type that the type that is described holds, `depth` times over: what the elements of its elements are. What a type
    /// parameter is bounded by counts like what an array holds: `T extends T[]`.
    fn ty_within(&mut self, ty: TypeId, depth: u8) -> TyId {
        if depth > MOST_HELD_WITHIN_EACH_OTHER {
            return self.out.tys.anything;
        }
        if let Some(&known) = self.tys.get(&(ty, depth)) {
            return known;
        }
        self.describe(ty, depth)
    }

    fn describe(&mut self, ty: TypeId, depth: u8) -> TyId {
        // `Identifier & BinaryExpression`: nothing is both, going by `kind`, so it is `never`, which narrowing comes up with all the time.
        let reduced = self.c.reduced(ty);
        if reduced != ty {
            let id = self.ty_within(reduced, depth);
            self.tys.insert((ty, depth), id);
            return id;
        }
        if self.c.admits_primitives(ty) {
            self.tys.insert((ty, depth), self.out.tys.anything);
            return self.out.tys.anything;
        }
        // An object type is its layout, which is named and not looked into: a type that mentions itself finds it.
        if self.is_object_type_of_program(ty)
            && let Some(layout) = self.record_layout(ty)
        {
            // Nobody has declared the view that a coercion makes, so no primitive is of it.
            let described = Declared::part(Part::Class(layout));
            let described = if self.c.is_view_made_by_coercion(ty) { described } else { self.with_primitives(ty, described) };
            let id = self.out.tys.intern(described.nilable());
            self.tys.insert((ty, depth), id);
            return id;
        }
        let mut result = self.ty_of_uncached(ty, depth);
        if matches!(self.c.data(ty), TypeData::Ref { .. }) && !self.c.is_array(ty) && result.has_objects() {
            result = self.with_primitives(ty, result);
        }
        // `value as Attr`, with `type Attr = boolean | number | string`, lets an object through as it is. Whoever hands it on, stores it, compares it or asks for its `typeof` sees it so: no
        // parameter, field, element or result of such a type turns it away. What needs the primitive asserts it: `used_as_its_type`.
        if result.is_of_several_kinds_of_primitives() {
            result = result.or(&Declared::any_object());
        }
        let mut result = result.nilable();
        if !result.is_never() && self.c.admits_nil(ty) {
            result.prims |= prim::NULLISH;
        }
        if depth > 0 {
            result = result.with_literal_string_widened();
        }
        let id = self.out.tys.intern(result);
        self.tys.insert((ty, depth), id);
        id
    }

    /// A primitive that has what an object type says is of the type as well: a string is a `{ length: number }` and an `Iterable<string>`.
    fn with_primitives(&mut self, ty: TypeId, mut described: Declared) -> Declared {
        for primitive in self.c.primitives_of_type(ty) {
            let primitive = self.ty_of(primitive);
            described = described.or(self.out.tys.get(primitive));
        }
        described
    }

    /// The same for a storage place. `NONE`: the type says nothing. So it is with `never`: `assertNever(x: never)` is there for what
    /// arrives all the same.
    pub(crate) fn declared(&mut self, ty: TypeId) -> TyId {
        let described = self.ty_of(ty);
        if described == self.out.tys.anything || self.out.tys.get(described).is_never() { TyId::NONE } else { described }
    }

    /// The description of the kinds (`check::kind`). `NONE`: they say nothing, or there is an object among them. In JavaScript an object
    /// is looked at as anything, with a prediction: see `predict_expression`.
    pub(crate) fn ty_of_kinds(&mut self, kinds: u16) -> TyId {
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

    /// The description, unless it has numbers of which no range is known. Such a number is kept as a raw double, whatever it is expected to be, and most of what untyped code does with a
    /// number wants it as it is handed around there, an int32 in a boxed value: an index, a compare with a counter, a store to a property, an argument. So it stays anything, with its
    /// prediction. (The TypeScript compiler as plain JavaScript: 1,759 M instructions a check; with such numbers said to be numbers 1,920 M; without 1,728 M.)
    pub(crate) fn unless_plain_number(&self, ty: TyId) -> TyId {
        if ty.is_some() && self.out.tys.get(ty).prims & prim::NUMBER != 0 { TyId::NONE } else { ty }
    }

    /// What a variable or a parameter of an untyped file holds over its whole life, going by what is stored to it and by no type.
    /// A place is blank before anything is stored to it. There is no symbol to stand in for that: see `blank_of`.
    fn ty_by_stores(&mut self, sym: Sym) -> Ty {
        let kinds = self.ask(|c| c.kinds_held_by(sym));
        let described = self.ty_of_kinds(if kinds & kind::SYMBOL != 0 { kinds | kind::UNDEFINED } else { kinds });
        // Not `bigint | integers 0..9`, which no typed code has ever come up with.
        let integers = if kinds & (kind::NUMBER | kind::BIGINT) == kind::NUMBER { self.ask(|c| c.integers_of_symbol(sym)) } else { None };
        let described = self.with_integers(described, integers);
        Ty::of(self.unless_plain_number(described))
    }

    /// What the checker has a variable, a parameter or a static field hold over its whole life.
    pub(crate) fn ty_of_symbol(&mut self, sym: Sym) -> Ty {
        let file = self.value_declaration(sym).map_or(sym.file, |(file, _)| file);
        if self.is_untyped_file(file) {
            return self.ty_by_stores(sym);
        }
        let storage = self.c.storage_of_symbol(sym);
        self.ty_of_storage(storage, Some(sym))
    }

    /// What a store to the variable holds the value to: its type, without the room for the `undefined` that it holds at first. That room is
    /// for the blank start and for `a = undefined!`. Whether there is any depends on what is found out about the reads, and whether a
    /// store throws must not.
    pub(crate) fn ty_held_by_symbol(&mut self, sym: Sym) -> Ty {
        let Some((file, Decl::Var(_))) = self.value_declaration(sym) else { return self.ty_of_symbol(sym) };
        if self.is_untyped_file(file) {
            return Ty::NONE;
        }
        let storage = self.c.storage_of_symbol(sym);
        self.ty_of_storage(Storage { starts_undefined: false, ..storage }, Some(sym))
    }

    /// Written down or taken from where the function is used, it is the type the checker has held the body to.
    pub(crate) fn ty_of_param(&mut self, file: FileId, p: ParamId) -> Ty {
        let hir = self.hir(file);
        let name = self.c.bound(file).pat_symbol[hir[p].pat.idx()].some().map(|name| self.files.sym(file, name));
        if self.is_untyped_file(file) {
            return name.map_or(Ty::NONE, |name| self.ty_by_stores(name));
        }
        let storage = self.ask(|c| c.storage_of_param(file, p));
        self.ty_of_storage(storage, name)
    }

    /// Why an argument for the parameter is held to its type.
    pub(crate) fn why_of_param(&mut self, file: FileId, p: ParamId) -> Why {
        if self.ask(|c| c.is_param_annotated(file, p)) { Why::Cast } else { Why::Store }
    }

    /// `sym`: the place, if it has a name of its own.
    fn ty_of_storage(&mut self, storage: Storage, sym: Option<Sym>) -> Ty {
        let mut id = self.declared(storage.ty);
        if id.is_none()
            && let Some(sym) = sym
            && let Some((file, initializer)) = self.c.initializer_of_const(sym)
            && let Some(made) = self.ty_made_by(file, initializer)
        {
            id = made;
        }
        if let Some(sym) = sym
            && id.is_some()
            && self.out.tys.get(id).prims & prim::NUMBER != 0
        {
            let integers = self.ask(|c| c.integers_of_symbol(sym));
            id = self.with_integers(id, integers);
        }
        if id.is_some() && storage.starts_undefined {
            id = self.or_undefined(id);
        }
        Ty { id, checked: storage.ty }
    }

    /// The classes that the class with the layout extends, the nearest first. None: not all of them are known.
    fn classes_extended_by(&self, layout: LayoutId) -> Vec<(FileId, ClassId)> {
        let mut extended = Vec::new();
        let mut at = self.out.layouts[layout.idx()].base;
        while at.is_some() {
            let Some(&class) = self.laid_out_classes.get(&at) else { return Vec::new() };
            extended.push(class);
            at = self.out.layouts[at.idx()].base;
        }
        extended
    }

    /// Whether the instance field `sym` of the class with the layout may be found to hold `undefined` that nothing has stored to it.
    /// If not, its type may have no room for that.
    pub(crate) fn field_starts_undefined(&mut self, layout: LayoutId, sym: Sym) -> bool {
        let extended = self.classes_extended_by(layout);
        self.c.field_starts_undefined(sym, &extended)
    }

    pub(crate) fn is_let_go_of_by_extended_classes(&mut self, layout: LayoutId) -> bool {
        let extended = self.classes_extended_by(layout);
        extended.is_empty() || self.c.is_let_go_of_while_constructed_by(&extended)
    }

    pub(crate) fn initializers_that_let_go_of_this(&mut self, layout: LayoutId, file: FileId, class: ClassId) -> Vec<bun_sema::hir::MemberId> {
        let extended = self.classes_extended_by(layout);
        self.c.initializers_that_let_go_of_this(file, class, &extended)
    }

    /// The type as what a cast makes of plain data. No object is made as what the parts of a union have in common: it is made as one of
    /// the parts, so where that layout stands for the union, here the parts are named, also for the elements of an array.
    pub(crate) fn ty_of_cast_target(&mut self, ty: TyId) -> TyId {
        if let Some(&(grown, known)) = self.cast_targets.get(&ty)
            && grown == self.views_grown
        {
            return known;
        }
        let found = self.find_ty_of_cast_target(ty);
        self.cast_targets.insert(ty, (self.views_grown, found));
        found
    }

    fn find_ty_of_cast_target(&mut self, ty: TyId) -> TyId {
        let described = self.out.tys.get(ty).clone();
        let mut target = Declared { parts: Default::default(), ..described.clone() };
        for part in &described.parts {
            match part {
                Part::Class(view) if self.parts_of_views.contains_key(view) => {
                    for &layout in &self.parts_of_views[view] {
                        target = target.or(&Declared::part(Part::Class(layout)));
                    }
                }
                &Part::Array(elements) if elements != ty => {
                    let elements = self.ty_of_cast_target(elements);
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

    fn ty_of_uncached(&mut self, ty: TypeId, depth: u8) -> Declared {
        match self.c.data(ty) {
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Never | Intrinsic::SilentNever | Intrinsic::UnreachableNever | Intrinsic::ImplicitNever | Intrinsic::UniqueLiteral => Declared::never(),
                // Not `void`: what is declared to yield it may yield anything, `(): void => list.push(1)`.
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
            // Which integers a value of such a type is, if it is one, the checker says.
            TypeData::NumberLit { .. } | TypeData::EnumLit { value: EnumValue::Number(_), .. } => match self.c.integers_of_type(ty) {
                Some((least, most)) => Declared::ints(least, most),
                None => Declared::prims(prim::NUMBER),
            },
            // A member whose value is computed when the program runs, which has to be a number.
            TypeData::Enum { .. } => Declared::prims(prim::NUMBER),
            TypeData::UniqueSymbol { .. } => Declared::prims(prim::SYMBOL),
            TypeData::Union(parts) => {
                let mut result = Declared::never();
                let mut objects: Vec<TypeId> = Vec::new();
                for &part in parts.iter() {
                    // What `0` says depends on what it stands beside.
                    if matches!(self.c.data(part), TypeData::NumberLit { .. })
                        && let Some((least, most)) = self.c.integers_of_part(part, ty)
                    {
                        result = result.or(&Declared::ints(least, most));
                        continue;
                    }
                    let described = self.ty_within(part, depth);
                    let described = self.out.tys.get(described);
                    if described.only_layout().is_some() {
                        objects.push(part);
                    } else {
                        result = result.or(described);
                    }
                }
                let common = if objects.len() > MOST_LAYOUTS_IN_UNION { self.layout_in_common(&objects) } else { None };
                match common {
                    Some(layout) => {
                        for &part in &objects {
                            let described = self.ty_of(part);
                            let Some(part) = self.out.tys.get(described).only_layout() else { continue };
                            let parts = self.parts_of_views.entry(layout).or_default();
                            if !parts.contains(&part) {
                                parts.push(part);
                                self.views_grown += 1;
                            }
                        }
                        result = result.or(&Declared::part(Part::Class(layout)));
                    }
                    None => {
                        for part in objects {
                            let described = self.ty_within(part, depth);
                            result = result.or(self.out.tys.get(described));
                        }
                    }
                }
                self.with_one_array_part(result)
            }
            // Not of object types of the program alone, which has a layout.
            TypeData::Intersection(parts) => {
                // `T & Identifier`, which narrowing makes of a `T extends Node` all the time: what is known of `T` is what it is bounded by.
                let bound = self.c.base_constraint(ty);
                if bound != ty {
                    let bound = self.ty_within(bound, depth + 1);
                    return self.out.tys.get(bound).clone();
                }
                // An array, a function or an object of a class of the engine of whose properties more is said: `Int32Array & { 0: number }`.
                if let Some(element) = self.c.element_of_array_subtype(ty) {
                    return Declared::part(Part::Array(self.ty_within(element, depth + 1)));
                }
                if let Some(extended) = self.c.built_in_extended_by(ty) {
                    return self.ty_of_built_in_that_may_say_more(ty, extended, depth);
                }
                let mut object = None;
                for &part in parts.iter() {
                    if matches!(self.c.data(part), TypeData::Intrinsic(Intrinsic::Void)) {
                        return Declared::prims(prim::UNDEFINED);
                    }
                    let part = self.ty_within(part, depth);
                    let part = self.out.tys.get(part);
                    // A primitive with a brand is the primitive. What wraps one is an object.
                    if !part.has_objects() && !part.is_never() {
                        let primitive = part.clone();
                        return if self.c.is_wrapper_of_primitive(ty) { primitive.or(&Declared::any_object()) } else { primitive };
                    }
                    if object.is_none() && !part.parts.is_empty() && part.prims == 0 {
                        object = Some(part.clone());
                    }
                }
                object.unwrap_or_else(Declared::any_object)
            }
            TypeData::Ref { target, .. } => {
                let target = *target;
                self.ty_of_reference(ty, target, depth)
            }
            TypeData::ThisParam(sym) if self.files.flags(*sym).contains(SymFlags::CLASS) => {
                let sym = *sym;
                self.ty_of_reference(ty, sym, depth)
            }
            TypeData::Tuple { .. } | TypeData::EvolvingArray(_) => self.array_of(ty, depth),
            TypeData::Fns { .. } => Declared::any_function(),
            TypeData::Anon { origin: Origin::Function(_) | Origin::ClassStatic(_), .. } => Declared::any_function(),
            TypeData::Anon { .. } | TypeData::Synth(_) | TypeData::ReverseMapped { .. } => Declared::any_object(),
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::IndexedAccess { .. } | TypeData::Cond { .. } | TypeData::Substitution { .. } => {
                // What is known of it is what it is bounded by.
                let bound = self.c.base_constraint(ty);
                if bound == ty {
                    return Declared::anything();
                }
                let bound = self.ty_within(bound, depth + 1);
                self.out.tys.get(bound).clone()
            }
            TypeData::Keyof(_) => Declared::prims(prim::STRING | prim::NUMBER | prim::SYMBOL),
            TypeData::Template { .. } | TypeData::StringMapping { .. } => Declared::prims(prim::STRING),
            _ => Declared::anything(),
        }
    }

    /// An interface, a type literal, an intersection of such, a mapped type, the type of an object literal: a record type, which the
    /// program can allocate. Not a class (its instances have the layout of the class), an array, or what the checker makes of
    /// JavaScript. Nor what extends an array, a function or a class of the engine, or can be called: the program says more of such an
    /// object and does not make it.
    ///
    /// Nor an interface all of whose declarations are ambient (`Checker::is_ambient_interface`): it says what code without a body hands
    /// out, and nothing is held to that. A type literal or an alias of a declaration file counts: `const o: FromADts = { .. }` is the
    /// program's own claim, checked against its literal. Not so for `lib.*.d.ts`: the engine's own code yields ordinary objects that are
    /// typed by what is written there.
    pub(crate) fn is_object_type_of_program(&mut self, ty: TypeId) -> bool {
        match self.c.data(ty) {
            TypeData::Ref { target, .. } => {
                let target = *target;
                if self.c.is_array(ty) || self.files.flags(target).contains(SymFlags::CLASS) {
                    return false;
                }
                self.declares_records(target.file) && !self.c.is_ambient_interface(target) && self.c.element_of_array_subtype(ty).is_none() && self.c.built_in_extended_by(ty).is_none()
            }
            TypeData::Anon { origin, .. } => match *origin {
                Origin::TypeLiteral(file, _) | Origin::ObjectLiteral(file, ..) | Origin::WidenedLiteral(file, ..) => self.declares_records(file),
                // `Readonly<T>`, `Pick<T, K>`, `Partial<T>` are written in the standard library. Whose objects they describe depends on
                // what they are applied to.
                Origin::Mapped(file, _) => match self.c.alias_of_type(ty) {
                    _ if self.is_untyped_file(file) => false,
                    // `Record<"code", unknown>`, which `"code" in e` narrows to: any object that has the property is one.
                    Some((_, arguments)) if self.files.module(file).is_lib && arguments.iter().any(|&argument| argument.is_any() || argument == TypeId::UNKNOWN) => false,
                    Some((_, arguments)) => arguments.into_iter().all(|argument| !self.c.is_object_type(argument) || self.is_object_type_of_program(argument) || self.is_class_of_program(argument)),
                    None => self.is_written_in_typescript(file),
                },
                Origin::Module(namespace) => self.c.is_reified_namespace(namespace) && self.declares_records(namespace.file),
                _ => false,
            },
            TypeData::Intersection(parts) => parts.iter().all(|&part| self.is_object_type_of_program(part)),
            TypeData::Synth(shape) => shape.literal != Literalness::SyntheticDefault,
            TypeData::ReverseMapped { .. } => true,
            _ => false,
        }
    }

    fn is_class_of_program(&self, ty: TypeId) -> bool {
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
        !self.is_untyped_file(file) && hir.kind != FileKind::Json && !self.only_declares(file)
    }

    pub(crate) fn is_declared_by_declaration_files_alone(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::UNRESOLVED || self.c.says_nothing(ty) {
            return false;
        }
        self.c.parts(ty).to_vec().into_iter().any(|part| match *self.c.data(part) {
            TypeData::Ref { target, .. } => self.only_declares(target.file) && (!self.files.module(target.file).is_lib || self.ty_of(part) == self.out.tys.anything),
            _ => false,
        })
    }

    fn ty_made_by(&mut self, file: FileId, e: bun_sema::hir::ExprId) -> Option<TyId> {
        match self.hir(file)[e].kind {
            bun_sema::hir::ExprKind::New(_) => self.ty_made_by_new(file, e),
            bun_sema::hir::ExprKind::Call(_) => self.ty_made_by_call(file, e),
            _ => None,
        }
    }

    pub(crate) fn ty_made_by_call(&mut self, file: FileId, e: bun_sema::hir::ExprId) -> Option<TyId> {
        if !self.c.has_declared_type(file, e) {
            return None;
        }
        let made = self.c.type_of_expr(file, e);
        if self.ty_of(made) != self.out.tys.anything {
            return None;
        }
        let TypeData::Ref { target, .. } = *self.c.data(made) else { return None };
        let name = self.files.symbol(target).name;
        if self.c.global_type_symbol(name) != Some(target) || !self.files.module(target.file).is_lib || !self.c.calls_static_of_global_object(file, e, name) {
            return None;
        }
        Some(self.out.tys.intern(Declared::any_object()))
    }

    pub(crate) fn ty_made_by_new(&mut self, file: FileId, e: bun_sema::hir::ExprId) -> Option<TyId> {
        if !self.c.has_declared_type(file, e) {
            return None;
        }
        let made = self.c.type_of_expr(file, e);
        if self.ty_of(made) != self.out.tys.anything {
            return None;
        }
        let root = match self.c.built_in_extended_by(made) {
            Some(BuiltIn::Instance(root)) => root,
            _ => made,
        };
        let TypeData::Ref { target, .. } = *self.c.data(root) else { return None };
        let name = self.files.symbol(target).name;
        if self.c.global_type_symbol(name) != Some(target) || !self.files.module(target.file).is_lib {
            return None;
        }
        if root == made && !matches!(self.c.atoms().bytes(name), b"Error" | b"Promise") && self.c.constructs_global_object(file, e, name) {
            let name = self.str(name);
            return Some(self.out.tys.intern(Declared::part(Part::Global(name, Default::default()))));
        }
        Some(self.out.tys.intern(Declared::any_object()))
    }

    fn ty_of_reference(&mut self, ty: TypeId, target: Sym, depth: u8) -> Declared {
        if self.c.is_array(ty) {
            return self.array_of(ty, depth);
        }
        if let Some(element) = self.c.element_of_array_subtype(ty) {
            return Declared::part(Part::Array(self.ty_within(element, depth + 1)));
        }
        if let Some(extended) = self.c.built_in_extended_by(ty) {
            return self.ty_of_built_in_that_may_say_more(ty, extended, depth);
        }
        if self.files.flags(target).contains(SymFlags::CLASS)
            && let Some((file, Decl::Class(class))) = self.value_declaration(target)
            && !self.is_ambient(target)
        {
            return match self.instance_layout(file, class) {
                Some(layout) => Declared::part(Part::Class(layout)),
                None => Declared::any_object(),
            };
        }
        let name = self.files.symbol(target).name;
        if self.c.global_type_symbol(name) == Some(target) {
            // The interface says what a primitive has as well as what its wrapper object has, and the checker takes either for it.
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
            // What the host makes and the library declares an `Error` need be no error object of the engine: `interface DOMException extends Error`, a wrapper of a native object with
            // `Error.prototype` on its chain. And what is thrown need be no object: `throw "text"`, `catch (e) { report(e as Error) }`. So a place for an `Error` takes anything.
            if self.c.atoms().bytes(name) == b"Error" {
                return Declared::anything();
            }
            // Nor need what is handed on as a `Promise<T>` be a promise of the engine: a thenable of a library, which may declare it `extends Promise<T>`. `await` and `.then` take it the language's own
            // way. Nothing is made of it: to call its `then` may be to start what it stands for.
            if self.c.atoms().bytes(name) == b"Promise" {
                return Declared::anything();
            }
            let is_only_predicted = matches!(self.c.atoms().bytes(name), b"ArrayBuffer" | b"SharedArrayBuffer" | b"DataView" | b"WeakMap" | b"WeakSet" | b"WeakRef" | b"FinalizationRegistry");
            if self.only_declares(target.file) && (is_only_predicted || !self.files.module(target.file).is_lib) {
                return Declared::anything();
            }
            let arguments: Vec<TypeId> = self.c.type_arguments(ty).to_vec();
            let arguments = arguments.into_iter().map(|argument| self.ty_within(argument, depth + 1)).collect();
            let name = self.str(name);
            return Declared::part(Part::Global(name, arguments));
        }
        if self.only_declares(target.file) {
            return Declared::anything();
        }
        Declared::any_object()
    }

    fn ty_of_built_in_that_may_say_more(&mut self, ty: TypeId, built_in: BuiltIn, depth: u8) -> Declared {
        let is_called_and_says_more = matches!(built_in, BuiltIn::Function)
            && (!self.c.signatures(ty, false).is_empty() || !self.c.signatures(ty, true).is_empty())
            && self.c.members(ty).is_some_and(|members| !members.shape().props.is_empty());
        if is_called_and_says_more { Declared::any_object() } else { self.ty_of_built_in(built_in, depth) }
    }

    fn ty_of_built_in(&mut self, built_in: BuiltIn, depth: u8) -> Declared {
        match built_in {
            BuiltIn::Function => Declared::any_function(),
            BuiltIn::Claimed => Declared::anything(),
            BuiltIn::Instance(class) => {
                let class = self.ty_within(class, depth);
                self.out.tys.get(class).clone()
            }
        }
    }

    /// The checker's type of an array or a tuple.
    fn array_of(&mut self, ty: TypeId, depth: u8) -> Declared {
        let element = match self.c.array_element(ty) {
            Some(element) => self.ty_within(element, depth + 1),
            None => {
                let mut result = Declared::never();
                let arguments: Vec<TypeId> = self.c.type_arguments(ty).to_vec();
                for argument in arguments {
                    let argument = self.ty_within(argument, depth + 1);
                    result = result.or(self.out.tys.get(argument));
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
            admits_foreign: false,
            is_opened_for_the_log: false,
            admits_only_other_layouts: false,
            members: Vec::new(),
            members_by_fit: Vec::new(),
            specializations: Vec::new(),
            declared_path: StrId::NONE,
            declared_line: 0,
        });
        id
    }

    /// The layout of the objects of this type: a field for each of its properties, in the order of their declaration, of the type the
    /// property is declared with: see `type_fields_of`. One per type. `None`: the type does not say which properties its objects have.
    /// `A[] | B[]` as `(A | B)[]`. A type has one element type in the engine.
    fn with_one_array_part(&mut self, mut described: Declared) -> Declared {
        let elements: Vec<TyId> = described.parts.iter().filter_map(|part| if let Part::Array(element) = part { Some(*element) } else { None }).collect();
        if elements.len() < 2 {
            return described;
        }
        let mut merged = Declared::never();
        for element in elements {
            merged = merged.or(self.out.tys.get(element));
        }
        let merged = self.with_one_array_part(merged);
        let merged = self.out.tys.intern(merged);
        described.parts.retain(|part| !matches!(part, Part::Array(_)));
        described.parts.push(Part::Array(merged));
        described.parts.sort_unstable();
        described
    }

    pub(crate) fn record_layout(&mut self, ty: TypeId) -> Option<LayoutId> {
        let ty = self.c.laid_out_as(ty);
        if let Some(&known) = self.records.get(&ty) {
            return known;
        }
        self.add_record_layout(ty)
    }

    /// What all of the object types have, which is what the program can get at without knowing which of them an object is of: the
    /// discriminant above all. No object is made with this layout.
    fn layout_in_common(&mut self, objects: &[TypeId]) -> Option<LayoutId> {
        let union = self.c.union(objects);
        let common = self.c.view_of_union(union);
        self.record_layout(common)
    }

    fn add_record_layout(&mut self, ty: TypeId) -> Option<LayoutId> {
        // The type of the objects of a class stands for the layout of the class. A literal that is checked against it is made as what it is
        // by itself, and looked at as the class says. A generic type whose fields are of ever larger instantiations of itself is laid
        // out so far and no further.
        let gets_no_fields = self.c.members(ty).is_none_or(|members| !members.shape().call.is_empty() || !members.shape().construct.is_empty() || members.shape().props.is_empty());
        let fields = if gets_no_fields || self.c.is_type_of_instances(ty) || self.c.is_nested_too_deeply(ty) || self.c.is_redefined_somewhere(ty) { None } else { self.fields_of(ty) };
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
        let key = LayoutKey::Record(self.keep(ty));
        let id = self.add_layout(LayoutKind::Record, name, key);
        self.out.layouts[id.idx()].fields = fields;
        self.out.layouts[id.idx()].methods = self.accessors_of_literal(ty);
        self.records.insert(ty, Some(id));
        self.layout_types.insert(id, ty);
        self.untyped_layouts.insert(id, FieldTypes::Properties(ty));
        Some(id)
    }

    fn accessors_of_literal(&mut self, ty: TypeId) -> Vec<crate::ir::Method> {
        let TypeData::Anon { origin: Origin::ObjectLiteral(file, literal, ..) | Origin::WidenedLiteral(file, literal, ..), .. } = *self.c.data(ty) else { return Vec::new() };
        if self.only_declares(file) {
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
            let (name, func) = (self.str(name), self.name_function(file, accessor));
            accessors.push(crate::ir::Method { name, func, kind, flags: 0, key: crate::ir::NO_VARIABLE });
        }
        accessors
    }

    /// Where the fields of the layout of the class `class` get their types from.
    pub(crate) fn set_field_types_of_class(&mut self, layout: LayoutId, class: Sym, base: LayoutId, declared_by: Vec<(u32, Sym)>, implemented: Vec<(u32, TypeId, Atom)>) {
        let declarations = &self.c.bound(class.file).symbols[class.id.idx()].decls;
        if let Some(&Decl::Class(declaration)) = declarations.iter().find(|decl| matches!(decl, Decl::Class(_))) {
            self.laid_out_classes.insert(layout, (class.file, declaration));
        }
        self.untyped_layouts.insert(layout, FieldTypes::Members { base, declared_by, implemented });
    }

    /// Whether a layout can have a field by the name: no index, which has its place among the keys by its number, nor the empty name.
    pub(crate) fn is_field_name(name: &[u8]) -> bool {
        name.first().is_some_and(|first| !first.is_ascii_digit())
    }

    /// A field for each property, without its type.
    fn fields_of(&mut self, ty: TypeId) -> Option<Vec<Field>> {
        let members = self.c.members(ty)?;
        let shape = members.shape();
        // With an index signature besides, as `CompilerOptions` has: what is accessed by a name that is written down has a field, and
        // whatever else is stored by a key that is computed is kept aside.
        if !shape.call.is_empty() || !shape.construct.is_empty() || shape.props.is_empty() {
            return None;
        }
        // An accessor that a literal defines is a property of the object besides its fields.
        let is_of_literal = matches!(self.c.data(ty), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. });
        let mut fields = Vec::with_capacity(shape.props.len());
        for prop in shape.props.iter() {
            if prop.flags.contains(PropFlags::ACCESSOR) {
                if is_of_literal {
                    continue;
                }
                return None;
            }
            let bytes = self.c.atoms().bytes(prop.name);
            if bytes.first() == Some(&0xFE) || bytes == b"__proto__" || !Self::is_field_name(bytes) {
                return None;
            }
            let mut flags = 0;
            if prop.flags.contains(PropFlags::OPTIONAL) || self.c.is_deleted_from_untyped_objects(prop.name) {
                flags |= field_flags::OPTIONAL;
            }
            if prop.flags.contains(PropFlags::METHOD) {
                flags |= field_flags::METHOD;
            }
            fields.push(Field::new(self.out.strs.intern(bytes), TyId::NONE, flags));
        }
        for &(name, _) in self.c.undeclared_fields_of(ty).iter() {
            fields.push(Field::new(self.str(name), TyId::NONE, field_flags::OPTIONAL));
        }
        Some(fields)
    }

    /// `Field::literals` of a field of the type.
    fn literals_of(&mut self, checked: TypeId) -> Vec<Literal> {
        let literals = self.c.literals_of_type(checked);
        (literals.into_iter())
            .map(|literal| match literal {
                check::Literal::String(text) => Literal::Str(self.str(text)),
                check::Literal::Number(value) => Literal::Num(value),
            })
            .collect()
    }

    /// Gives the fields of the layout their types, unless they have them. That comes before anything is made of the type of a field. A
    /// layout that the file does not look into stays without: it is only named, and whoever looks into it says what its fields hold.
    /// The layouts that the types of the fields name are not looked into here, so that this ends: the types of a program refer to each
    /// other through long chains, and to themselves.
    pub(crate) fn type_fields_of(&mut self, layout: LayoutId) {
        match self.untyped_layouts.remove(&layout) {
            None => {}
            Some(FieldTypes::Properties(ty)) => {
                let Some(members) = self.c.members(ty) else { return };
                // As `fields_of` has it.
                let own = members.shape().props.iter().filter(|prop| !prop.flags.contains(PropFlags::ACCESSOR));
                for (i, prop) in own.clone().enumerate() {
                    self.type_field_as_property(layout, i as u32, prop, members.mapper, ty);
                }
                for (i, &(name, declaring)) in self.c.undeclared_fields_of(ty).iter().enumerate() {
                    let field = (own.clone().count() + i) as u32;
                    let Some(declared_by) = self.c.members(declaring) else { continue };
                    let Some(prop) = declared_by.shape().props.iter().find(|prop| prop.name == name) else { continue };
                    self.type_field_as_property(layout, field, prop, declared_by.mapper, declaring);
                    // It is optional here.
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
                self.type_fields_of(base);
                let inherited = if base.is_some() { self.out.layouts[base.idx()].fields.len() } else { 0 };
                for i in 0..inherited {
                    self.out.layouts[layout.idx()].fields[i].declared = self.out.layouts[base.idx()].fields[i].declared;
                    self.out.layouts[layout.idx()].fields[i].literals = self.out.layouts[base.idx()].fields[i].literals.clone();
                    if let Some(&checked) = self.checked_fields.get(&(base, i as u32)) {
                        self.checked_fields.insert((layout, i as u32), checked);
                    }
                    if self.annotated_fields.contains(&(base, i as u32)) {
                        self.annotated_fields.insert((layout, i as u32));
                    }
                }
                let extended = self.classes_extended_by(layout);
                for (field, sym) in declared_by {
                    let storage = self.c.storage_of_field(sym, &extended);
                    let declared = self.ty_of_storage(storage, Some(sym));
                    let name = self.files.symbol(sym).name;
                    let is_stored_to_as_more = self.laid_out_classes.get(&layout).copied().is_some_and(|(file, class)| {
                        let instances = self.c.type_of_instances(file, class);
                        self.c.is_stored_to_as_more_by_a_checked_text(instances, name)
                    });
                    let declared = if is_stored_to_as_more { Ty { id: self.out.tys.anything, checked: TypeId::UNKNOWN } } else { declared };
                    self.out.layouts[layout.idx()].fields[field as usize].declared = declared.id;
                    self.out.layouts[layout.idx()].fields[field as usize].literals = self.literals_of(declared.checked);
                    self.checked_fields.insert((layout, field), declared.checked);
                    if self.c.is_annotated(sym) {
                        self.annotated_fields.insert((layout, field));
                    } else {
                        self.annotated_fields.remove(&(layout, field));
                    }
                }
                // As the field of the layout of the implemented type, so that the two compare equal.
                for (field, interface, name) in implemented {
                    let Some(members) = self.c.members(interface) else { continue };
                    let Some(prop) = members.shape().props.iter().find(|prop| prop.name == name) else { continue };
                    if prop.flags.contains(PropFlags::METHOD) {
                        self.out.layouts[layout.idx()].fields[field as usize].flags |= field_flags::METHOD;
                    }
                    self.type_field_as_property(layout, field, prop, members.mapper, interface);
                    // `declare x: T`: it is absent until it is stored to, whatever `T` says.
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
        let is_nil = |data: &TypeData| matches!(data, TypeData::Intrinsic(Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedWidening | Intrinsic::Null | Intrinsic::NullWidening));
        parts.iter().all(|&part| is_nil(self.c.data(part))) || parts.len() == 1 && matches!(self.c.data(parts[0]), TypeData::BoolLit { .. } | TypeData::NumberLit { .. } | TypeData::StringLit { .. } | TypeData::BigIntLit { .. })
    }

    /// Gives the field the type of the property, which was found in a type whose mapper is `mapper`.
    fn type_field_as_property(&mut self, layout: LayoutId, field: u32, prop: &Prop, mapper: MapperId, found_in: TypeId) {
        let is_predicted = self.c.is_prop_predicted(prop) || self.c.is_predicted_through_spread(found_in, prop.name) || self.c.is_stored_to_as_more_by_a_checked_text(found_in, prop.name);
        let checked = if is_predicted { TypeId::UNKNOWN } else { self.c.type_held_by_prop(prop, mapper) };
        let checked = if self.is_inferred_only_from_first_value(prop, found_in, checked) { TypeId::UNKNOWN } else { checked };
        let may_be_absent = prop.flags.contains(PropFlags::OPTIONAL) || self.out.layouts[layout.idx()].fields[field as usize].flags & field_flags::OPTIONAL != 0;
        let checked = if may_be_absent && !self.c.admits_undefined(checked) { self.c.union(&[checked, TypeId::UNDEFINED]) } else { checked };
        let declared = self.declared(checked);
        let written = self.c.integers_written_for_prop(prop);
        let declared = self.with_integers(declared, written);
        self.out.layouts[layout.idx()].fields[field as usize].declared = self.or_anything(declared);
        self.out.layouts[layout.idx()].fields[field as usize].literals = self.literals_of(checked);
        if !self.c.admits_undefined(checked) {
            self.out.layouts[layout.idx()].fields[field as usize].flags |= field_flags::DECLARED_WITHOUT_UNDEFINED;
        }
        self.checked_fields.insert((layout, field), checked);
        if self.c.is_prop_annotated(prop) {
            self.annotated_fields.insert((layout, field));
        }
    }

    /// Whether the fields of the layout have their types.
    pub(crate) fn has_typed_fields(&self, layout: LayoutId) -> bool {
        !self.untyped_layouts.contains_key(&layout)
    }
}
