mod bindings;
mod functions;
mod written;

use std::rc::Rc;

use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{PositionTypes, ShapeKind, WrittenType};
use bun_sema::hir::{FnId, TypeNodeId};
use bun_sema::program::Sym;
use rustc_hash::{FxHashMap, FxHashSet};

pub(in crate::lower) use self::bindings::{comes_from_elsewhere, is_made_by_its_file};
use super::{CheckerTypeId, FileLowering, types};
use crate::ir::{
    DeclaredType, LayoutKey, Mapped, PositionFlags, Primitives, Type, TypeId, TypeTable,
};
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

const SYMBOLS_OF_PAGE: usize = 64;

/// A part of a large file names the variables of its own stretch.
#[derive(Default)]
struct NamedVariables {
    pages: Vec<Option<Box<[Option<NamedVariable>; SYMBOLS_OF_PAGE]>>>,
}

impl NamedVariables {
    #[inline]
    fn get(&self, symbol: SymbolId) -> Option<NamedVariable> {
        let page = self.pages.get(symbol.idx() / SYMBOLS_OF_PAGE)?.as_ref()?;
        page[symbol.idx() % SYMBOLS_OF_PAGE]
    }

    fn insert(&mut self, symbol: SymbolId, named: NamedVariable) {
        let at = symbol.idx() / SYMBOLS_OF_PAGE;
        if self.pages.len() <= at {
            self.pages.resize_with(at + 1, || None);
        }
        let page = self.pages[at].get_or_insert_with(|| Box::new([None; SYMBOLS_OF_PAGE]));
        page[symbol.idx() % SYMBOLS_OF_PAGE] = Some(named);
    }
}

#[derive(Default)]
pub(in crate::lower) struct PositionState {
    annotations: FxHashMap<TypeNodeId, DeclaredType>,
    named_variables: NamedVariables,
    variables: FxHashMap<Sym, DeclaredType>,
    constant_zeros: FxHashSet<Sym>,
    functions: FxHashMap<FnId, Rc<FunctionPositions>>,
    built: FxHashMap<(u64, u8), DeclaredType>,
    shapes_being_mapped: u32,
    has_int32_promise: bool,
}

impl PositionState {
    #[inline]
    pub(in crate::lower) fn begin_mapping_shape(&mut self) {
        self.shapes_being_mapped += 1;
    }

    #[inline]
    pub(in crate::lower) fn end_mapping_shape(&mut self) {
        self.shapes_being_mapped -= 1;
    }
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

    fn find_listed_nullish_at(&mut self, ty: CheckerTypeId, mapped: TypeId) -> Primitives {
        let says_which = self.is_checked() && self.queries.files().options.strict_null_checks;
        let held = self.fragment.types.get(mapped).primitives;
        if !says_which || !held.intersects(Primitives::NULLISH) {
            return Primitives::NULLISH;
        }
        let row = self.queries.row_of_type(ty) as usize;
        if let Some(listed) = self.task.memo.find_listed_nullish(row) {
            return listed;
        }
        let (mut gives_up, unstable_answers) = (false, self.queries.count_unstable_answers());
        let listed = self.find_listed_nullish(ty, 0, &mut gives_up);
        if !gives_up && self.queries.count_unstable_answers() == unstable_answers {
            self.task.memo.keep_listed_nullish(row, listed);
        }
        listed
    }

    fn find_listed_nullish(
        &mut self,
        ty: CheckerTypeId,
        depth: u32,
        gives_up: &mut bool,
    ) -> Primitives {
        if depth > MAX_DEPTH_OF_LISTED_MEMBERS {
            return Primitives::NULLISH;
        }
        let Ok(shape) = self.queries.type_shape(ty) else {
            *gives_up = true;
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
            ShapeKind::TypeVariable {
                constraint: Some(constraint),
            } => self.find_listed_nullish(constraint, depth + 1, gives_up),
            ShapeKind::Union(members) => {
                let mut listed = Primitives::default();
                for &member in members {
                    listed |= self.find_listed_nullish(member, depth + 1, gives_up);
                }
                listed
            }
            ShapeKind::Int32 { base } => self.find_listed_nullish(base, depth + 1, gives_up),
            _ => Primitives::default(),
        }
    }

    fn find_omitted_nullish(&self, source: PositionSource) -> PositionFlags {
        let held = self.fragment.types.get(source.mapped.ty).primitives;
        let omitted = (held & Primitives::NULLISH).without(source.listed_nullish);
        let mut flags = PositionFlags::default();
        if omitted == Primitives::default() {
            return flags;
        }
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
        let mut source = match checked {
            Some(checked) if checked.ty == written => PositionSource {
                is_annotation: true,
                ..checked
            },
            _ => self.map_source(written, true),
        };
        if source.mapped.ty == TypeTable::ANYTHING {
            return checked.map(|checked| PositionSource {
                mapped: Mapped::expected(checked.mapped.ty),
                ..checked
            });
        }
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

    fn find_promise(&mut self, source: PositionSource) -> PositionFlags {
        let is_tested = self.is_checked()
            && source.mapped.is_checked
            && source.mapped.ty != TypeTable::ANYTHING;
        if !is_tested
            || !source.is_annotation
            || !self.queries.is_int32_written()
            || !types::lists_int32(self, source.ty)
        {
            return PositionFlags::default();
        }
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

    fn build_position_anew(&mut self, types: PositionTypes) -> DeclaredType {
        let Some(source) = self.choose_source(types) else {
            return DeclaredType::untyped();
        };
        let flags = self.find_promise(source) | self.find_omitted_nullish(source);
        self.finish_position(source, flags)
    }

    fn build_position_of_types(&mut self, types: PositionTypes) -> DeclaredType {
        if self.types.positions.shapes_being_mapped != 0 {
            return self.build_position_anew(types);
        }
        let (written, is_written) = match types.written {
            WrittenType::Written(ty) => (ty.0, 1),
            WrittenType::Unwritten | WrittenType::GaveUp(_) => (0, 0),
        };
        let (checked, is_checked) = match types.checked {
            Ok(ty) => (ty.0, 2),
            Err(_) => (0, 0),
        };
        let key = (
            u64::from(written) << 32 | u64::from(checked),
            is_written | is_checked,
        );
        if let Some(&position) = self.types.positions.built.get(&key) {
            return position;
        }
        let unstable_answers_before = self.queries.count_unstable_answers();
        let position = self.build_position_anew(types);
        if self.queries.count_unstable_answers() == unstable_answers_before {
            self.types.positions.built.insert(key, position);
        }
        position
    }

    pub(crate) fn create_position(&mut self, types: PositionTypes) -> DeclaredType {
        let position = self.build_position_of_types(types);
        if !self.fragment.types.get(position.ty).layouts.is_empty() {
            self.note_layouts_of_objects(position.ty);
        }
        position
    }

    pub(crate) fn create_written_position(&mut self, types: PositionTypes) -> DeclaredType {
        match types.written.written() {
            Some(_) => self.create_position(types),
            None => DeclaredType::untyped(),
        }
    }

    pub(crate) fn create_expected_position(
        &mut self,
        types: PositionTypes,
        admits_records: bool,
    ) -> DeclaredType {
        let Some(source) = self.choose_source(types) else {
            return DeclaredType::untyped();
        };
        let fragment = &self.fragment;
        let layouts = &fragment.types.get(source.mapped.ty).layouts;
        let names_classes_alone = layouts.iter().all(|&layout| {
            matches!(
                fragment.layout_key(layout),
                LayoutKey::Class(_) | LayoutKey::ConstructorFunction(_) | LayoutKey::Library(_)
            )
        });
        if !names_classes_alone && !admits_records {
            return DeclaredType::untyped();
        }
        let source = PositionSource {
            mapped: Mapped::expected(source.mapped.ty),
            ..source
        };
        let flags = self.find_omitted_nullish(source);
        self.finish_position(source, flags)
    }

    pub(crate) fn create_member_position(&mut self, types: PositionTypes) -> DeclaredType {
        self.build_position_of_types(types)
    }

    pub(crate) fn add_undefined(&mut self, position: DeclaredType) -> DeclaredType {
        let types = &mut self.fragment.types;
        let ty = match types
            .get(position.ty)
            .primitives
            .contains(Primitives::UNDEFINED)
        {
            true => position.ty,
            false => types.union(position.ty, TypeTable::UNDEFINED),
        };
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
        match self.types.positions.named_variables.get(symbol) {
            Some(named) => named,
            None => self.find_named_variable(symbol),
        }
    }

    fn find_named_variable(&mut self, symbol: SymbolId) -> NamedVariable {
        let variable = match self.inputs.modules.import_binding(self.file, symbol) {
            ImportBinding::Variable(exported) => exported,
            _ => self.queries.canonical_symbol(self.file, symbol),
        };
        let position = self.variable_position(variable);
        let is_replaceable = self.inputs.modules.is_replaceable(variable);
        let positions = &mut self.types.positions;
        let named = NamedVariable {
            position,
            is_constant_zero: positions.constant_zeros.contains(&variable) && !is_replaceable,
        };
        positions.named_variables.insert(symbol, named);
        named
    }

    pub(crate) fn binding_position(&mut self, symbol: SymbolId) -> DeclaredType {
        self.named_variable(symbol).position
    }

    #[inline]
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
