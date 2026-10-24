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

use super::convert::ConversionState;
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

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn map_type_at(&mut self, ty: CheckerTypeId, position: u32) -> Mapped {
        self.ensure_mapped(ty, position).mapped
    }

    // A fact that follows from answers that hold in every file lies with them. Any other holds for this file.
    fn find_fact(
        &mut self,
        ty: CheckerTypeId,
        fact: KeptFact,
        of_file: fn(&mut TypeState) -> &mut FxHashMap<CheckerTypeId, bool>,
        compute: fn(&mut FileLowering<'_, '_, '_, '_>, CheckerTypeId) -> bool,
    ) -> bool {
        if let Some(known) = self.queries.find_kept_fact(ty, fact) {
            return known;
        }
        if let Some(&known) = of_file(&mut self.types).get(&ty) {
            return known;
        }
        let unstable_answers = self.queries.count_unstable_answers();
        let holds = compute(self, ty);
        if !self.queries.keep_fact(ty, fact, holds, unstable_answers) {
            of_file(&mut self.types).insert(ty, holds);
        }
        holds
    }

    // The array of a tuple type holds what any of its elements holds, as the type itself is mapped.
    fn find_tuple_contents(&mut self, container: CheckerTypeId, position: u32) -> Option<TypeId> {
        let container = self.queries.without_nullish(container).ok()?;
        let elements: SmallVec<[TupleElement; 4]> =
            match self.queries.type_shape(container).ok()?.kind {
                ShapeKind::Tuple { elements, .. } => SmallVec::from_slice(elements),
                ShapeKind::Constrained { base, .. } => {
                    return self.find_tuple_contents(base, position);
                }
                _ => return None,
            };
        let mut contents = TypeTable::NEVER;
        for element in elements {
            let held = match element.kind {
                TupleElementKind::Required
                | TupleElementKind::Optional
                | TupleElementKind::Rest => self.map_type_at(element.ty, position).ty,
                TupleElementKind::Variadic => return None,
            };
            contents = self.fragment.types.union(contents, held);
        }
        (contents != TypeTable::NEVER).then_some(contents)
    }

    pub(crate) fn array_literal_contents(&mut self, literal: ExprId) -> TypeId {
        debug_assert!(
            matches!(self.hir[literal].kind, ExprKind::Array(_)),
            "an array literal was expected"
        );
        let contextual = self.queries.contextual_type(literal).ok().flatten();
        let own = self.queries.expression_type(literal).ok();
        self.record_array_literal_flow(literal, contextual, own);
        let container = contextual.or(own);
        let Some(element) = container.and_then(|ty| self.find_array_element_type(ty)) else {
            let position = self.hir[literal].pos;
            let contents = container.and_then(|ty| self.find_tuple_contents(ty, position));
            return contents.unwrap_or(TypeTable::ANYTHING);
        };
        let contents = self.map_type_at(element, self.hir[literal].pos).ty;
        // `[]` alone has the type `never[]`: what it holds, and not what is stored into it later, which is what the contents declare.
        if contextual.is_none() && contents == TypeTable::NEVER {
            return TypeTable::ANYTHING;
        }
        contents
    }

    pub(in crate::lower) fn find_mapped_source(&self, ty: TypeId) -> Option<CheckerTypeId> {
        self.types.sources.get(&ty).copied()
    }
}

pub(in crate::lower) fn lists_int32(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    file.find_fact(
        ty,
        KeptFact::ListsInt32,
        |types| &mut types.lists_int32,
        shape_table::lists_int32,
    )
}

/// Whether mapping the type declares the same in whichever file it is mapped.
pub(in crate::lower) fn is_mapped_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    file.find_fact(
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
    file.find_fact(
        ty,
        KeptFact::HasLayoutInEveryValue,
        |types| &mut types.laid_out,
        shape_table::has_layout_in_every_value,
    )
}
