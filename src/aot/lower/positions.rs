mod bindings;
mod functions;
mod sites;

use std::rc::Rc;

use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{PositionTypes, ShapeKind, WrittenType};
use bun_sema::hir::{FnId, TypeNodeId};
use bun_sema::program::Sym;
use rustc_hash::{FxHashMap, FxHashSet};

pub(crate) use self::sites::add_type_site;
use super::{CheckerTypeId, FileLowering, types};
use crate::ir::generated::{TypeSite, TypeSiteKind};
use crate::ir::{
    DeclaredType, Mapped, PositionFlags, Primitives, StringId, Type, TypeId, TypeSiteId, TypeTable,
};
use crate::modules::ImportBinding;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct SiteOrigin {
    pub(crate) kind: TypeSiteKind,
    pub(crate) position: u32,
}

pub(crate) struct FunctionPositions {
    pub(crate) this: DeclaredType,
    pub(crate) parameters: Vec<DeclaredType>,
    pub(crate) result: DeclaredType,
    pub(crate) returned: DeclaredType,
    pub(crate) yielded: DeclaredType,
}

#[derive(Default)]
pub(in crate::lower) struct PositionState {
    annotations: FxHashMap<(TypeNodeId, TypeSiteKind), DeclaredType>,
    named_variables: FxHashMap<SymbolId, Sym>,
    variables: FxHashMap<Sym, DeclaredType>,
    /// Each `const zero = 0` whose position is in `variables`.
    constant_zeros: FxHashSet<Sym>,
    functions: FxHashMap<FnId, Rc<FunctionPositions>>,
    sites: FxHashMap<TypeSite, TypeSiteId>,
    texts: FxHashMap<CheckerTypeId, StringId>,
    // All instantiations of a generic class map to one IR type, so the type of a position does not say which one it is.
    sources: FxHashMap<DeclaredType, CheckerTypeId>,
    listed_nullish: FxHashMap<CheckerTypeId, Primitives>,
    has_int32_promise: bool,
}

const MAX_DEPTH_OF_LISTED_MEMBERS: u32 = 8;

#[derive(Copy, Clone)]
struct PositionSource {
    ty: CheckerTypeId,
    mapped: Mapped,
    listed_nullish: Primitives,
    is_annotation: bool,
}

impl FileLowering<'_, '_, '_, '_> {
    fn map_source(
        &mut self,
        ty: CheckerTypeId,
        origin: Option<SiteOrigin>,
        is_annotation: bool,
    ) -> PositionSource {
        let position = origin.map_or(0, |origin| origin.position);
        let mut mapped = self.map_type_at(ty, position);
        // `x as never` silences the checker and says nothing about `x`.
        if mapped.ty == TypeTable::NEVER {
            mapped = Mapped::UNKNOWN;
        }
        PositionSource {
            ty,
            mapped,
            listed_nullish: self.find_listed_nullish_at(ty, mapped.ty),
            is_annotation,
        }
    }

    // Nobody asks where the position holds neither.
    fn find_listed_nullish_at(&mut self, ty: CheckerTypeId, mapped: TypeId) -> Primitives {
        let says_which = self.is_checked() && self.queries.files().options.strict_null_checks;
        let held = self.fragment.types.get(mapped).primitives;
        if !says_which || !held.intersects(Primitives::NULLISH) {
            return Primitives::NULLISH;
        }
        if let Some(&listed) = self.types.positions.listed_nullish.get(&ty) {
            return listed;
        }
        let listed = self.find_listed_nullish(ty, 0);
        self.types.positions.listed_nullish.insert(ty, listed);
        listed
    }

    // Both, where the type says nothing against them.
    fn find_listed_nullish(&mut self, ty: CheckerTypeId, depth: u32) -> Primitives {
        if depth > MAX_DEPTH_OF_LISTED_MEMBERS {
            return Primitives::NULLISH;
        }
        let Ok(shape) = self.queries.type_shape(ty) else {
            return Primitives::NULLISH;
        };
        if !shape.trust.is_trusted() {
            return Primitives::NULLISH;
        }
        match shape.kind {
            ShapeKind::Undefined => Primitives::UNDEFINED,
            ShapeKind::Null => Primitives::NULL,
            ShapeKind::Anything(_) | ShapeKind::TypeVariable { .. } | ShapeKind::Never => {
                Primitives::NULLISH
            }
            ShapeKind::Union(members) => {
                let mut listed = Primitives::default();
                for &member in members {
                    listed |= self.find_listed_nullish(member, depth + 1);
                }
                listed
            }
            ShapeKind::Int32 { base } => self.find_listed_nullish(base, depth + 1),
            _ => Primitives::default(),
        }
    }

    // The type of a position that holds a reference lists `undefined` and `null` whatever the program has written, because nothing keeps them out.
    fn find_omitted_nullish(&self, source: PositionSource) -> PositionFlags {
        let held = self.fragment.types.get(source.mapped.ty).primitives;
        let omitted = (held & Primitives::NULLISH).without(source.listed_nullish);
        let mut flags = PositionFlags::default();
        if omitted.contains(Primitives::NULL) {
            flags |= PositionFlags::OMITS_NULL;
        }
        if omitted.contains(Primitives::UNDEFINED) {
            flags |= PositionFlags::OMITS_UNDEFINED;
        }
        flags
    }

    fn choose_source(
        &mut self,
        types: PositionTypes,
        origin: Option<SiteOrigin>,
    ) -> Option<PositionSource> {
        let checked = types.checked.ok();
        let checked = checked.map(|ty| self.map_source(ty, origin, false));
        let Some(written) = types.written.written() else {
            return checked;
        };
        let mut source = self.map_source(written, origin, true);
        // What an annotation takes from declarations that nobody checked is left out of its written form.
        if source.mapped.ty == TypeTable::ANYTHING {
            return checked.map(|checked| PositionSource {
                mapped: Mapped::expected(checked.mapped.ty),
                ..checked
            });
        }
        // `x?: number` is written `number`.
        if let Some(checked) = checked {
            let types = &mut self.fragment.types;
            let listed = types.get(checked.mapped.ty).primitives & Primitives::NULLISH;
            if !types.get(source.mapped.ty).primitives.contains(listed) {
                let listed = types.intern(Type::primitives(listed));
                source.mapped.ty = types.union(source.mapped.ty, listed);
            }
            source.listed_nullish |= checked.listed_nullish;
        }
        Some(source)
    }

    // Only who writes `int32` asks the build for the proof.
    fn find_promise(&mut self, source: PositionSource) -> PositionFlags {
        let is_tested = self.is_checked()
            && source.mapped.is_checked
            && source.mapped.ty != TypeTable::ANYTHING;
        if !is_tested || !source.is_annotation || !types::lists_int32(self, source.ty) {
            return PositionFlags::default();
        }
        // Without the proof the build of a program goes on where only the author of another package could give it.
        match self.is_in_dependency() {
            true => PositionFlags::IS_INT32_PROMISE | PositionFlags::IS_DECLARED_BY_DEPENDENCY,
            false => PositionFlags::IS_INT32_PROMISE,
        }
    }

    fn finish_position(
        &mut self,
        source: PositionSource,
        origin: Option<SiteOrigin>,
        flags: PositionFlags,
    ) -> DeclaredType {
        let mapped = match self.is_checked() {
            true => source.mapped,
            false => Mapped::expected(source.mapped.ty),
        };
        let site = match origin {
            Some(origin) if mapped.is_checked && mapped.ty != TypeTable::ANYTHING => {
                let text = source.is_annotation.then_some(source.ty);
                Some(add_type_site(self, origin, text))
            }
            Some(_) | None => None,
        };
        self.types.positions.has_int32_promise |= flags.contains(PositionFlags::IS_INT32_PROMISE);
        let declared = DeclaredType::new(mapped, site, flags);
        if declared.site.is_some() {
            let sources = &mut self.types.positions.sources;
            sources.entry(declared).or_insert(source.ty);
        }
        declared
    }

    fn build_position_of_types(
        &mut self,
        types: PositionTypes,
        origin: Option<SiteOrigin>,
    ) -> DeclaredType {
        let Some(source) = self.choose_source(types, origin) else {
            return DeclaredType::untyped();
        };
        let flags = self.find_promise(source) | self.find_omitted_nullish(source);
        self.finish_position(source, origin, flags)
    }

    pub(in crate::lower) fn find_position_source(
        &self,
        position: DeclaredType,
    ) -> Option<CheckerTypeId> {
        self.types.positions.sources.get(&position).copied()
    }

    pub(crate) fn create_position(
        &mut self,
        types: PositionTypes,
        origin: SiteOrigin,
    ) -> DeclaredType {
        self.build_position_of_types(types, Some(origin))
    }

    pub(crate) fn create_member_position(&mut self, types: PositionTypes) -> DeclaredType {
        self.build_position_of_types(types, None)
    }

    // `a?: number` is written `number`, and holds `undefined` where it is left out.
    pub(crate) fn add_undefined(&mut self, position: DeclaredType) -> DeclaredType {
        let ty = self.fragment.types.union(position.ty, TypeTable::UNDEFINED);
        let flags = position.flags.without(PositionFlags::OMITS_UNDEFINED);
        let widened = DeclaredType {
            ty,
            flags,
            ..position
        };
        if let Some(source) = self.find_position_source(position) {
            let sources = &mut self.types.positions.sources;
            sources.entry(widened).or_insert(source);
        }
        widened
    }

    pub(crate) fn annotation_position(
        &mut self,
        annotation: TypeNodeId,
        kind: TypeSiteKind,
    ) -> DeclaredType {
        if annotation.is_none() {
            return DeclaredType::untyped();
        }
        if let Some(&position) = self.types.positions.annotations.get(&(annotation, kind)) {
            return position;
        }
        let origin = SiteOrigin {
            kind,
            position: self.hir[annotation].pos,
        };
        let position = match self.queries.written_type(annotation) {
            WrittenType::Written(ty) => {
                let source = self.map_source(ty, Some(origin), true);
                let flags = self.find_promise(source) | self.find_omitted_nullish(source);
                self.finish_position(source, Some(origin), flags)
            }
            WrittenType::Unwritten | WrittenType::GaveUp(_) => DeclaredType::untyped(),
        };
        let memo = &mut self.types.positions.annotations;
        memo.insert((annotation, kind), position);
        position
    }

    pub(crate) fn binding_position(&mut self, symbol: SymbolId) -> DeclaredType {
        if let Some(&variable) = self.types.positions.named_variables.get(&symbol) {
            return self.variable_position(variable);
        }
        let variable = match self.inputs.modules.import_binding(self.file, symbol) {
            ImportBinding::Variable(exported) => exported,
            _ => self.queries.canonical_symbol(self.file, symbol),
        };
        let memo = &mut self.types.positions.named_variables;
        memo.insert(symbol, variable);
        self.variable_position(variable)
    }

    /// Whether the name stands for a `const zero = 0`, of this file or imported.
    pub(in crate::lower) fn is_constant_zero(&mut self, symbol: SymbolId) -> bool {
        self.binding_position(symbol);
        let positions = &self.types.positions;
        let variable = positions.named_variables.get(&symbol);
        variable.is_some_and(|variable| positions.constant_zeros.contains(variable))
    }

    pub(crate) fn variable_position(&mut self, symbol: Sym) -> DeclaredType {
        if let Some(&position) = self.types.positions.variables.get(&symbol) {
            return position;
        }
        let position = self.compute_variable_position(symbol);
        self.types.positions.variables.insert(symbol, position);
        position
    }

    pub(crate) fn function_positions(&mut self, function: FnId) -> Rc<FunctionPositions> {
        if let Some(positions) = self.types.positions.functions.get(&function) {
            return Rc::clone(positions);
        }
        let positions = Rc::new(functions::compute_function_positions(self, function));
        let memo = &mut self.types.positions.functions;
        memo.insert(function, Rc::clone(&positions));
        positions
    }
}

pub(in crate::lower) fn has_int32_promise(file: &FileLowering<'_, '_, '_, '_>) -> bool {
    file.types.positions.has_int32_promise
}
