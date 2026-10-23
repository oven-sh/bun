mod bindings;
mod functions;
mod sites;

use std::rc::Rc;

use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{ClassRef, PositionTypes, ShapeKind, WrittenType};
use bun_sema::hir::{FnId, MemberId, TypeNodeId};
use bun_sema::program::Sym;
use rustc_hash::FxHashMap;

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
    // The variable that a symbol of the file names.
    named_variables: FxHashMap<SymbolId, Sym>,
    variables: FxHashMap<Sym, DeclaredType>,
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
    // What of `undefined` and `null` the checker's type lists.
    listed_nullish: Primitives,
    is_annotation: bool,
}

fn map_source(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    origin: Option<SiteOrigin>,
    is_annotation: bool,
) -> PositionSource {
    let position = origin.map_or(0, |origin| origin.position);
    let mut mapped = types::map_type_at(file, ty, position);
    // `x as never` silences the checker and says nothing about `x`.
    if mapped.ty == TypeTable::NEVER {
        mapped = Mapped::UNKNOWN;
    }
    PositionSource {
        ty,
        mapped,
        listed_nullish: find_listed_nullish_at(file, ty, mapped.ty),
        is_annotation,
    }
}

// Nobody asks where the position holds neither.
fn find_listed_nullish_at(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    mapped: TypeId,
) -> Primitives {
    let says_which = file.is_checked() && file.queries.files().options.strict_null_checks;
    let holds_any = file
        .fragment
        .types
        .get(mapped)
        .primitives
        .intersects(Primitives::NULLISH);
    if !says_which || !holds_any {
        return Primitives::NULLISH;
    }
    if let Some(&listed) = file.types.positions.listed_nullish.get(&ty) {
        return listed;
    }
    let listed = find_listed_nullish(file, ty, 0);
    file.types.positions.listed_nullish.insert(ty, listed);
    listed
}

// Both, where the type says nothing against them.
fn find_listed_nullish(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    depth: u32,
) -> Primitives {
    if depth > MAX_DEPTH_OF_LISTED_MEMBERS {
        return Primitives::NULLISH;
    }
    let Ok(shape) = file.queries.type_shape(ty) else {
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
                listed |= find_listed_nullish(file, member, depth + 1);
            }
            listed
        }
        ShapeKind::Constrained { base, .. } => find_listed_nullish(file, base, depth + 1),
        _ => Primitives::default(),
    }
}

// The type of a position that holds a reference lists `undefined` and `null` whatever the program has written, because nothing keeps them out.
fn find_omitted_nullish(
    file: &FileLowering<'_, '_, '_, '_>,
    source: PositionSource,
) -> PositionFlags {
    let held = file.fragment.types.get(source.mapped.ty).primitives;
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

fn add_nullish_of(file: &mut FileLowering<'_, '_, '_, '_>, ty: TypeId, listing: TypeId) -> TypeId {
    let types = &mut file.fragment.types;
    let listed = types.get(listing).primitives & Primitives::NULLISH;
    if types.get(ty).primitives.contains(listed) {
        return ty;
    }
    let listed = types.intern(Type::primitives(listed));
    types.union(ty, listed)
}

// The annotation where there is one, and what the checker infers where there is none.
fn choose_source(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
    origin: Option<SiteOrigin>,
) -> Option<PositionSource> {
    let checked = types.checked.ok();
    let checked = checked.map(|ty| map_source(file, ty, origin, false));
    let Some(written) = types.written.written() else {
        return checked;
    };
    let mut source = map_source(file, written, origin, true);
    // What an annotation takes from declarations that nobody checked is left out of its written form.
    if source.mapped.ty == TypeTable::ANYTHING {
        return checked.map(|checked| PositionSource {
            mapped: Mapped::expected(checked.mapped.ty),
            ..checked
        });
    }
    // `x?: number` is written `number`.
    if let Some(checked) = checked {
        source.mapped.ty = add_nullish_of(file, source.mapped.ty, checked.mapped.ty);
        source.listed_nullish |= checked.listed_nullish;
    }
    Some(source)
}

// Only who writes `int32` asks the build for the proof.
fn find_promise(file: &mut FileLowering<'_, '_, '_, '_>, source: PositionSource) -> PositionFlags {
    let is_tested =
        file.is_checked() && source.mapped.is_checked && source.mapped.ty != TypeTable::ANYTHING;
    if !is_tested || !source.is_annotation || !types::lists_int32(file, source.ty) {
        return PositionFlags::default();
    }
    // Without the proof the build of a program goes on where only the author of another package could give it.
    match file.is_in_dependency() {
        true => PositionFlags::IS_INT32_PROMISE | PositionFlags::IS_DECLARED_BY_DEPENDENCY,
        false => PositionFlags::IS_INT32_PROMISE,
    }
}

fn finish_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: PositionSource,
    origin: Option<SiteOrigin>,
    flags: PositionFlags,
) -> DeclaredType {
    let mapped = match file.is_checked() {
        true => source.mapped,
        false => Mapped::expected(source.mapped.ty),
    };
    let site = match origin {
        Some(origin) if mapped.is_checked && mapped.ty != TypeTable::ANYTHING => {
            let text = source.is_annotation.then_some(source.ty);
            Some(add_type_site(file, origin, text))
        }
        Some(_) | None => None,
    };
    file.types.positions.has_int32_promise |= flags.contains(PositionFlags::IS_INT32_PROMISE);
    let declared = DeclaredType::new(mapped, site, flags);
    if declared.site.is_some() {
        file.types
            .positions
            .sources
            .entry(declared)
            .or_insert(source.ty);
    }
    declared
}

fn build_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    origin: Option<SiteOrigin>,
) -> DeclaredType {
    let source = map_source(file, ty, origin, true);
    let flags = find_promise(file, source) | find_omitted_nullish(file, source);
    finish_position(file, source, origin, flags)
}

fn build_position_of_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
    origin: Option<SiteOrigin>,
) -> DeclaredType {
    let Some(source) = choose_source(file, types, origin) else {
        return DeclaredType::untyped();
    };
    let flags = find_promise(file, source) | find_omitted_nullish(file, source);
    finish_position(file, source, origin, flags)
}

pub(in crate::lower) fn has_int32_promise(file: &FileLowering<'_, '_, '_, '_>) -> bool {
    file.types.positions.has_int32_promise
}

pub(in crate::lower) fn find_position_source(
    file: &FileLowering<'_, '_, '_, '_>,
    position: DeclaredType,
) -> Option<CheckerTypeId> {
    file.types.positions.sources.get(&position).copied()
}

pub(crate) fn create_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
    origin: SiteOrigin,
) -> DeclaredType {
    build_position_of_types(file, types, Some(origin))
}

pub(crate) fn create_member_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
) -> DeclaredType {
    build_position_of_types(file, types, None)
}

// `a?: number` is written `number`, and holds `undefined` where it is left out.
pub(crate) fn add_undefined(
    file: &mut FileLowering<'_, '_, '_, '_>,
    position: DeclaredType,
) -> DeclaredType {
    let ty = file.fragment.types.union(position.ty, TypeTable::UNDEFINED);
    let flags = position.flags.without(PositionFlags::OMITS_UNDEFINED);
    let widened = DeclaredType {
        ty,
        flags,
        ..position
    };
    if let Some(source) = find_position_source(file, position) {
        file.types
            .positions
            .sources
            .entry(widened)
            .or_insert(source);
    }
    widened
}

pub(crate) fn annotation_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    annotation: TypeNodeId,
    kind: TypeSiteKind,
) -> DeclaredType {
    if annotation.is_none() {
        return DeclaredType::untyped();
    }
    if let Some(&position) = file.types.positions.annotations.get(&(annotation, kind)) {
        return position;
    }
    let origin = SiteOrigin {
        kind,
        position: file.hir[annotation].pos,
    };
    let position = match file.queries.written_type(annotation) {
        WrittenType::Written(ty) => build_position(file, ty, Some(origin)),
        WrittenType::Unwritten | WrittenType::GaveUp(_) => DeclaredType::untyped(),
    };
    file.types
        .positions
        .annotations
        .insert((annotation, kind), position);
    position
}

pub(crate) fn binding_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    symbol: SymbolId,
) -> DeclaredType {
    if let Some(&variable) = file.types.positions.named_variables.get(&symbol) {
        return variable_position(file, variable);
    }
    let variable = match file.inputs.modules.import_binding(file.file, symbol) {
        ImportBinding::Variable(exported) => exported,
        _ => file.queries.canonical_symbol(file.file, symbol),
    };
    file.types
        .positions
        .named_variables
        .insert(symbol, variable);
    variable_position(file, variable)
}

pub(crate) fn variable_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    symbol: Sym,
) -> DeclaredType {
    if let Some(&position) = file.types.positions.variables.get(&symbol) {
        return position;
    }
    let position = bindings::compute_variable_position(file, symbol);
    file.types.positions.variables.insert(symbol, position);
    position
}

pub(crate) fn function_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> Rc<FunctionPositions> {
    if let Some(positions) = file.types.positions.functions.get(&function) {
        return Rc::clone(positions);
    }
    let positions = Rc::new(functions::compute_function_positions(file, function));
    file.types
        .positions
        .functions
        .insert(function, Rc::clone(&positions));
    positions
}

pub(crate) fn class_this_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
    member: Option<MemberId>,
) -> DeclaredType {
    functions::compute_class_this_type(file, class, member)
}
