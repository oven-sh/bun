use bun_sema::check::aot::{ShapeKind, TupleElement, TupleElementKind};
use smallvec::SmallVec;

use crate::ir::ContentsSlot;
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering};

impl FileLowering<'_, '_, '_, '_> {
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
