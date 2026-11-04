mod bindings;
mod functions;
mod written;

use std::rc::Rc;

use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{PositionTypes, ShapeKind, WrittenType};
use bun_sema::hir::{FnId, TypeNodeId};
use bun_sema::program::Sym;
use rustc_hash::{FxHashMap, FxHashSet};

use super::{CheckerTypeId, FileLowering, types};
use crate::ir::{DeclaredType, Mapped, PositionFlags, Primitives, Type, TypeId, TypeTable};
use crate::modules::ImportBinding;

pub(crate) struct FunctionPositions {
    pub(crate) this: DeclaredType,
    pub(crate) parameters: Vec<DeclaredType>,
    pub(crate) result: DeclaredType,
    pub(crate) returned: DeclaredType,
    pub(crate) yielded: DeclaredType,
}

#[derive(Copy, Clone)]
struct NamedVariable {
    position: DeclaredType,
    is_constant_zero: bool,
}

#[derive(Default)]
pub(in crate::lower) struct PositionState {
    annotations: FxHashMap<TypeNodeId, DeclaredType>,
    /// By `SymbolId`.
    named_variables: Vec<Option<NamedVariable>>,
    variables: FxHashMap<Sym, DeclaredType>,
    /// Each `const zero = 0` whose position is in `variables`.
    constant_zeros: FxHashSet<Sym>,
    functions: FxHashMap<FnId, Rc<FunctionPositions>>,
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
    fn map_source(&mut self, ty: CheckerTypeId, is_annotation: bool) -> PositionSource {
        let mut mapped = self.map_type_at(ty);
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

    // The answer is read only where the position holds `null` or `undefined`.
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

    // Both, where the type cannot tell: the position then omits neither.
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
            ShapeKind::Anything(_)
            | ShapeKind::TypeVariable { constraint: None }
            | ShapeKind::Never => Primitives::NULLISH,
            // Whatever stands in the place of `T extends Node` fits Node, so it lists no more than the bound does.
            ShapeKind::TypeVariable {
                constraint: Some(constraint),
            } => self.find_listed_nullish(constraint, depth + 1),
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

    fn choose_source(&mut self, types: PositionTypes) -> Option<PositionSource> {
        let checked = types.checked.ok();
        let checked = checked.map(|ty| self.map_source(ty, false));
        let Some(written) = types.written.written() else {
            return checked;
        };
        let mut source = self.map_source(written, true);
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

    // Only a written `int32` asks the build for the proof.
    fn find_promise(&mut self, source: PositionSource) -> PositionFlags {
        let is_tested = self.is_checked()
            && source.mapped.is_checked
            && source.mapped.ty != TypeTable::ANYTHING;
        if !is_tested || !source.is_annotation || !types::lists_int32(self, source.ty) {
            return PositionFlags::default();
        }
        // In a dependency a missing proof does not stop the build: only that package's author could supply it.
        match self.is_in_dependency() {
            true => PositionFlags::IS_INT32_PROMISE | PositionFlags::IS_DECLARED_BY_DEPENDENCY,
            false => PositionFlags::IS_INT32_PROMISE,
        }
    }

    fn finish_position(&mut self, source: PositionSource, flags: PositionFlags) -> DeclaredType {
        let mapped = match self.is_checked() {
            true => source.mapped,
            false => Mapped::expected(source.mapped.ty),
        };
        self.types.positions.has_int32_promise |= flags.contains(PositionFlags::IS_INT32_PROMISE);
        DeclaredType::new(mapped, None, flags)
    }

    fn build_position_of_types(&mut self, types: PositionTypes) -> DeclaredType {
        let Some(source) = self.choose_source(types) else {
            return DeclaredType::untyped();
        };
        let flags = self.find_promise(source) | self.find_omitted_nullish(source);
        self.finish_position(source, flags)
    }

    // Whoever declares a position of a type says what the fields of the type hold.
    pub(crate) fn create_position(&mut self, types: PositionTypes) -> DeclaredType {
        let position = self.build_position_of_types(types);
        self.note_layouts_of_objects(position.ty);
        position
    }

    // Without an annotation the checker has the type of the expressions that flow in. Nobody declared it: the engine follows what is stored there.
    pub(crate) fn create_written_position(&mut self, types: PositionTypes) -> DeclaredType {
        match types.written.written() {
            Some(_) => self.create_position(types),
            None => DeclaredType::untyped(),
        }
    }

    pub(crate) fn create_member_position(&mut self, types: PositionTypes) -> DeclaredType {
        self.build_position_of_types(types)
    }

    // `a?: number` is written `number`, and holds `undefined` where it is left out.
    pub(crate) fn add_undefined(&mut self, position: DeclaredType) -> DeclaredType {
        let ty = self.fragment.types.union(position.ty, TypeTable::UNDEFINED);
        let flags = position.flags.without(PositionFlags::OMITS_UNDEFINED);
        DeclaredType {
            ty,
            flags,
            ..position
        }
    }

    pub(crate) fn annotation_position(&mut self, annotation: TypeNodeId) -> DeclaredType {
        if annotation.is_none() {
            return DeclaredType::untyped();
        }
        if let Some(&position) = self.types.positions.annotations.get(&annotation) {
            return position;
        }
        let position = match self.queries.written_type(annotation) {
            WrittenType::Written(ty) => {
                let source = self.map_source(ty, true);
                let flags = self.find_promise(source) | self.find_omitted_nullish(source);
                self.finish_position(source, flags)
            }
            WrittenType::Unwritten | WrittenType::GaveUp(_) => DeclaredType::untyped(),
        };
        self.note_layouts_of_objects(position.ty);
        let memo = &mut self.types.positions.annotations;
        memo.insert(annotation, position);
        position
    }

    #[inline]
    fn named_variable(&mut self, symbol: SymbolId) -> NamedVariable {
        match self.types.positions.named_variables.get(symbol.idx()) {
            Some(&Some(named)) => named,
            _ => self.find_named_variable(symbol),
        }
    }

    fn find_named_variable(&mut self, symbol: SymbolId) -> NamedVariable {
        let variable = match self.inputs.modules.import_binding(self.file, symbol) {
            ImportBinding::Variable(exported) => exported,
            _ => self.queries.canonical_symbol(self.file, symbol),
        };
        let position = self.variable_position(variable);
        // A mock that is laid over the module stores what its factory gives into the variable.
        let is_replaceable = self.inputs.modules.is_replaceable(variable);
        let positions = &mut self.types.positions;
        let named = NamedVariable {
            position,
            is_constant_zero: positions.constant_zeros.contains(&variable) && !is_replaceable,
        };
        let memo = &mut positions.named_variables;
        if memo.is_empty() {
            memo.resize(self.bound.symbols.len(), None);
        }
        if let Some(stored) = memo.get_mut(symbol.idx()) {
            *stored = Some(named);
        }
        named
    }

    pub(crate) fn binding_position(&mut self, symbol: SymbolId) -> DeclaredType {
        self.named_variable(symbol).position
    }

    /// Whether the name stands for a `const zero = 0`, of this file or imported.
    pub(in crate::lower) fn is_constant_zero(&mut self, symbol: SymbolId) -> bool {
        self.named_variable(symbol).is_constant_zero
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
