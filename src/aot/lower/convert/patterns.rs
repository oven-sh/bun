use bun_sema::bind::PatParent;
use bun_sema::check::aot::{ShapeKind, TupleElement, TupleElementKind};
use bun_sema::hir::{ExprKind, PatId};
use smallvec::SmallVec;

use crate::ir::{ContentsSlot, DeclaredType, PositionFlags, Primitives};
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering};

impl FileLowering<'_, '_, '_, '_> {
    fn type_read_into_binding(&mut self, pattern: PatId) -> Option<CheckerTypeId> {
        match self.bound.pat_parent[pattern.idx()] {
            PatParent::Prop(..) | PatParent::Elem(..) => self.queries.binding_type(pattern).ok(),
            PatParent::Var(declaration) => {
                let (written, value) = (self.hir[declaration].ty, self.hir[declaration].init);
                if written.is_some() {
                    return None;
                }
                if value.is_none() {
                    return self.queries.binding_type(pattern).ok();
                }
                let read = self.skip_type_syntax(value);
                let is_read = matches!(
                    self.hir[read].kind,
                    ExprKind::Dot { .. } | ExprKind::Index { .. }
                );
                let is_stated = is_read
                    && !self.is_statically_resolved(read)
                    && !self.reads_field_that_may_be_absent(read);
                match is_stated {
                    true => self.queries.expression_type(read).ok(),
                    false => None,
                }
            }
            PatParent::Param(_) | PatParent::None => None,
        }
    }

    pub(super) fn position_of_int32_binding(&mut self, pattern: PatId) -> Option<DeclaredType> {
        let ty = self.type_read_into_binding(pattern)?;
        let mapped = self.map_type_at(ty);
        let held = self.fragment.types.get(mapped.ty);
        let (minimum, maximum) = held.integer_range()?;
        let int32 = i64::from(i32::MIN)..=i64::from(i32::MAX);
        (mapped.is_checked
            && !held.primitives.contains(Primitives::NUMBER)
            && int32.contains(&minimum)
            && int32.contains(&maximum))
        .then(|| DeclaredType::new(mapped, None, PositionFlags::default()))
    }

    pub(super) fn find_element_type(
        &mut self,
        list: CheckerTypeId,
        index: usize,
    ) -> Option<CheckerTypeId> {
        let stripped = self.queries.without_nullish(list);
        let shape = stripped.and_then(|list| self.queries.type_shape(list));
        if let Ok(ShapeKind::Union(members)) = shape.map(|shape| shape.kind) {
            let mut common = None;
            for &list in members {
                let Some(element) = self.find_element_type(list, index) else {
                    continue;
                };
                if common.is_some_and(|common| common != element) {
                    return None;
                }
                common = Some(element);
            }
            return common;
        }
        let Some(elements) = find_tuple_elements(self, list) else {
            return find_contents_type(self, list, ContentsSlot::Element);
        };
        let first_variable = match self.types.first_variable_element {
            Some((asked, position)) if asked == list => position,
            _ => {
                let is_variable = |element: &TupleElement| {
                    matches!(
                        element.kind,
                        TupleElementKind::Rest | TupleElementKind::Variadic
                    )
                };
                let position = elements.iter().position(is_variable);
                let position = position.unwrap_or(elements.len());
                self.types.first_variable_element = Some((list, position));
                position
            }
        };
        let element = elements.get(index.min(first_variable))?;
        match element.kind {
            TupleElementKind::Required | TupleElementKind::Optional | TupleElementKind::Rest => {
                Some(element.ty)
            }
            TupleElementKind::Variadic => None,
        }
    }

    pub(super) fn collect_element_types_from(
        &mut self,
        list: CheckerTypeId,
        first: usize,
    ) -> SmallVec<[CheckerTypeId; 4]> {
        let Some(elements) = find_tuple_elements(self, list) else {
            return find_contents_type(self, list, ContentsSlot::Element)
                .into_iter()
                .collect();
        };
        let mut types = SmallVec::new();
        for (position, element) in elements.iter().enumerate() {
            match element.kind {
                TupleElementKind::Required | TupleElementKind::Optional if position < first => {}
                TupleElementKind::Required
                | TupleElementKind::Optional
                | TupleElementKind::Rest => {
                    types.push(element.ty);
                }
                TupleElementKind::Variadic => {
                    types.extend(find_contents_type(self, element.ty, ContentsSlot::Element));
                }
            }
        }
        types
    }
}

pub(super) fn find_tuple_elements<'c>(
    file: &mut FileLowering<'_, 'c, '_, '_>,
    list: CheckerTypeId,
) -> Option<&'c [TupleElement]> {
    let list = file.queries.without_nullish(list).ok()?;
    let ShapeKind::Tuple { elements, .. } = file.queries.type_shape(list).ok()?.kind else {
        return None;
    };
    Some(elements)
}
