mod contents;
mod exploration;
mod mapping;
mod memo;
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
pub(in crate::lower) use self::memo::TypeMemo;

#[derive(Default)]
pub(crate) struct TypeState {
    pub(in crate::lower) positions: PositionState,
    pub(in crate::lower) conversions: ConversionState,
    pub(in crate::lower) function_types: FunctionTypeState,
    exhausted: FxHashSet<CheckerTypeId>,
    facts: FxHashMap<(CheckerTypeId, u8), bool>,
    walk: exploration::Walk,
    pub(in crate::lower) first_variable_element: Option<(CheckerTypeId, usize)>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct MappedType {
    mapped: Mapped,
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

    fn find_tuple_contents(&mut self, container: CheckerTypeId) -> Option<TypeId> {
        let container = self.queries.without_nullish(container).ok()?;
        let elements = match self.queries.type_shape(container).ok()?.kind {
            ShapeKind::Tuple { elements, .. } => elements,
            ShapeKind::Int32 { base } => return self.find_tuple_contents(base),
            _ => return None,
        };
        let mut contents = TypeTable::NEVER;
        for element in elements {
            let held = match element.kind {
                TupleElementKind::Required
                | TupleElementKind::Optional
                | TupleElementKind::Rest => self.map_type_at(element.ty).ty,
                TupleElementKind::Variadic => return None,
            };
            contents = self.fragment.types.union(contents, held);
        }
        (contents != TypeTable::NEVER).then_some(contents)
    }

    /// The numbers that the checker infers for an array literal without a written type.
    fn inferred_literal_contents(&mut self, literal: ExprId) -> TypeId {
        if !self.is_checked() {
            return TypeTable::ANYTHING;
        }
        let Ok(list) = self.queries.expression_type(literal) else {
            return TypeTable::ANYTHING;
        };
        let Some(element) = self.find_array_element_type(list) else {
            return TypeTable::ANYTHING;
        };
        match self.queries.type_shape(element).map(|shape| shape.kind) {
            Ok(ShapeKind::Number) => TypeTable::NUMBER,
            _ => TypeTable::ANYTHING,
        }
    }

    pub(in crate::lower) fn literal_holds_inferred_numbers(&mut self, literal: ExprId) -> bool {
        matches!(self.hir[literal].kind, ExprKind::Array(_))
            && self.inferred_literal_contents(literal) == TypeTable::NUMBER
    }

    pub(crate) fn array_literal_contents(&mut self, literal: ExprId) -> TypeId {
        debug_assert!(
            matches!(
                self.hir[literal].kind,
                ExprKind::Array(_) | ExprKind::New(_)
            ),
            "an array literal or `new Array()` was expected"
        );
        let Ok(Some(container)) = self.queries.contextual_type(literal) else {
            return self.inferred_literal_contents(literal);
        };
        match self.find_array_element_type(container) {
            Some(element) => self.map_type_at(element).ty,
            None => {
                let contents = self.find_tuple_contents(container);
                contents.unwrap_or(TypeTable::ANYTHING)
            }
        }
    }
}

pub(in crate::lower) fn lists_int32(
    file: &mut FileLowering<'_, '_, '_, '_>,
    ty: CheckerTypeId,
) -> bool {
    file.find_fact(ty, KeptFact::ListsInt32, shape_table::lists_int32)
}
