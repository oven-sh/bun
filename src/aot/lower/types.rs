mod contents;
mod exploration;
mod mapping;
mod shape_edges;
mod shape_table;
#[cfg(test)]
mod tests;

use bun_sema::check::aot::{KeptFact, ShapeKind, TupleElementKind};
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
    facts: FxHashMap<(CheckerTypeId, u8), bool>,
    sources: FxHashMap<TypeId, CheckerTypeId>,
    walk: exploration::Walk,
    alike_walk: shape_table::AlikeWalkTables,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct MappedType {
    mapped: Mapped,
    // How many types it reaches, itself among them. Nothing, where they are more than the limit.
    weight: Option<u32>,
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

type Component = SmallVec<[ExploredType; 1]>;

type MapChild<'x> = dyn FnMut(&mut FileLowering<'_, '_, '_, '_>, TypeEdge) -> Mapped + 'x;

impl FileLowering<'_, '_, '_, '_> {
    fn find_known_fact(&self, ty: CheckerTypeId, fact: KeptFact) -> Option<bool> {
        let kept = self.queries.find_kept_fact(ty, fact);
        kept.or_else(|| self.types.facts.get(&(ty, fact as u8)).copied())
    }

    // A fact that follows from answers that hold in every file lies with them. Any other holds for this file.
    fn keep_fact(&mut self, ty: CheckerTypeId, fact: KeptFact, holds: bool, unstable_answers: u64) {
        if !self.queries.keep_fact(ty, fact, holds, unstable_answers) {
            self.types.facts.insert((ty, fact as u8), holds);
        }
    }

    fn find_fact(
        &mut self,
        ty: CheckerTypeId,
        fact: KeptFact,
        compute: fn(&mut FileLowering<'_, '_, '_, '_>, CheckerTypeId) -> bool,
    ) -> bool {
        if let Some(known) = self.find_known_fact(ty, fact) {
            return known;
        }
        let unstable_answers = self.queries.count_unstable_answers();
        let holds = compute(self, ty);
        self.keep_fact(ty, fact, holds, unstable_answers);
        holds
    }

    fn find_tuple_contents(&mut self, container: CheckerTypeId, position: u32) -> Option<TypeId> {
        let container = self.queries.without_nullish(container).ok()?;
        let elements = match self.queries.type_shape(container).ok()?.kind {
            ShapeKind::Tuple { elements, .. } => elements,
            ShapeKind::Int32 { base } => return self.find_tuple_contents(base, position),
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
    file.find_fact(ty, KeptFact::ListsInt32, shape_table::lists_int32)
}

pub(in crate::lower) fn is_mapped_alike_in_every_file(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    let compute = shape_table::is_mapped_alike_in_every_file;
    file.find_fact(ty, KeptFact::IsMappedAlikeInEveryFile, compute)
}

pub(in crate::lower) fn has_layout_in_every_value(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    let compute = shape_table::has_layout_in_every_value;
    file.find_fact(ty, KeptFact::HasLayoutInEveryValue, compute)
}
