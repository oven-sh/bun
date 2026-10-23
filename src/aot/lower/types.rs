mod contents;
mod exploration;
mod mapping;
mod shape_edges;
mod shape_table;
#[cfg(test)]
mod tests;

use bun_sema::check::aot::{KeptFact, ShapeKind, TupleElement, TupleElementKind};
use bun_sema::hir::{ExprId, ExprKind};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::convert::{ConversionState, find_array_element_type, record_array_literal_flow};
use super::function_types::FunctionTypeState;
use super::positions::PositionState;
use super::{CheckerTypeId, FileLowering};
use crate::ir::{Mapped, TypeId, TypeTable};

pub(in crate::lower) use self::contents::find_contents_type;

#[derive(Default)]
pub(crate) struct TypeState {
    pub(in crate::lower) positions: PositionState,
    pub(in crate::lower) conversions: ConversionState,
    pub(in crate::lower) function_types: FunctionTypeState,
    mapped: FxHashMap<CheckerTypeId, MappedType>,
    shallow: FxHashMap<CheckerTypeId, Mapped>,
    exhausted: FxHashSet<CheckerTypeId>,
    laid_out: FxHashMap<CheckerTypeId, bool>,
    lists_int32: FxHashMap<CheckerTypeId, bool>,
    mapped_alike: FxHashMap<CheckerTypeId, bool>,
    sources: FxHashMap<TypeId, CheckerTypeId>,
    walk: exploration::WalkTables,
    alike_walk: shape_table::AlikeWalkTables,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct MappedType {
    mapped: Mapped,
    weight: u32,
    is_oversized: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum EdgeKind {
    Transparent,
    Contents,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct TypeEdge {
    kind: EdgeKind,
    target: CheckerTypeId,
}

type TypeEdges = SmallVec<[TypeEdge; 4]>;

struct ExploredType {
    ty: CheckerTypeId,
    edges: TypeEdges,
}

struct Component {
    members: SmallVec<[ExploredType; 1]>,
}

enum Exploration {
    Complete(SmallVec<[Component; 1]>),
    Exhausted,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Reach {
    Within(u32),
    AboveLimit,
}

trait ChildTypes {
    fn map_child(&mut self, file: &mut FileLowering<'_, '_, '_, '_>, edge: TypeEdge) -> Mapped;
}

pub(crate) fn map_type_at(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    position: u32,
) -> Mapped {
    mapping::ensure_mapped(file, ty, position).mapped
}

pub(in crate::lower) fn lists_int32(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    find_fact(
        file,
        ty,
        KeptFact::ListsInt32,
        |types| &mut types.lists_int32,
        shape_table::lists_int32,
    )
}

// A fact that follows from answers that hold in every file lies with them. Any other holds for this file.
fn find_fact(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
    fact: KeptFact,
    of_file: fn(&mut TypeState) -> &mut FxHashMap<CheckerTypeId, bool>,
    compute: fn(&mut FileLowering<'_, '_, '_, '_>, CheckerTypeId) -> bool,
) -> bool {
    if let Some(known) = file.queries.find_kept_fact(ty, fact) {
        return known;
    }
    if let Some(&known) = of_file(&mut file.types).get(&ty) {
        return known;
    }
    let unstable_answers = file.queries.count_unstable_answers();
    let holds = compute(file, ty);
    if !file.queries.keep_fact(ty, fact, holds, unstable_answers) {
        of_file(&mut file.types).insert(ty, holds);
    }
    holds
}

/// Whether mapping the type declares the same in whichever file it is mapped.
pub(in crate::lower) fn is_mapped_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    find_fact(
        file,
        ty,
        KeptFact::IsMappedAlikeInEveryFile,
        |types| &mut types.mapped_alike,
        shape_table::is_mapped_alike_in_every_file,
    )
}

/// Whether every value of the object type `ty` has one of the layouts that the type maps to.
pub(in crate::lower) fn has_layout_in_every_value(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    find_fact(
        file,
        ty,
        KeptFact::HasLayoutInEveryValue,
        |types| &mut types.laid_out,
        shape_table::has_layout_in_every_value,
    )
}

// The array of a tuple type holds what any of its elements holds, as the type itself is mapped.
fn find_tuple_contents(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: CheckerTypeId,
    position: u32,
) -> Option<TypeId> {
    let container = file.queries.without_nullish(container).ok()?;
    let elements: SmallVec<[TupleElement; 4]> = match file.queries.type_shape(container).ok()?.kind
    {
        ShapeKind::Tuple { elements, .. } => SmallVec::from_slice(elements),
        ShapeKind::Constrained { base, .. } => return find_tuple_contents(file, base, position),
        _ => return None,
    };
    let mut contents = TypeTable::NEVER;
    for element in elements {
        let held = match element.kind {
            TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => {
                map_type_at(file, element.ty, position).ty
            }
            TupleElementKind::Variadic => return None,
        };
        contents = file.fragment.types.union(contents, held);
    }
    (contents != TypeTable::NEVER).then_some(contents)
}

pub(crate) fn array_literal_contents(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
) -> TypeId {
    debug_assert!(
        matches!(file.hir[literal].kind, ExprKind::Array(_)),
        "an array literal was expected"
    );
    let contextual = file.queries.contextual_type(literal).ok().flatten();
    let own = file.queries.expression_type(literal).ok();
    record_array_literal_flow(file, literal, contextual, own);
    let container = contextual.or(own);
    let Some(element) = container.and_then(|ty| find_array_element_type(file, ty)) else {
        let position = file.hir[literal].pos;
        let contents = container.and_then(|ty| find_tuple_contents(file, ty, position));
        return contents.unwrap_or(TypeTable::ANYTHING);
    };
    let contents = map_type_at(file, element, file.hir[literal].pos).ty;
    // `[]` alone has the type `never[]`: what it holds, and not what is stored into it later, which is what the contents declare.
    if contextual.is_none() && contents == TypeTable::NEVER {
        return TypeTable::ANYTHING;
    }
    contents
}

pub(in crate::lower) fn find_mapped_source(
    file: &FileLowering<'_, '_, '_, '_>,
    ty: TypeId,
) -> Option<CheckerTypeId> {
    file.types.sources.get(&ty).copied()
}
