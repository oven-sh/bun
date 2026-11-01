use bun_sema::hir::{ExprId, ExprKind};
use smallvec::SmallVec;

use super::supertypes::ConversionKind;
use crate::lower::{CheckerTypeId, FileLowering};

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn record_spread_elements(&mut self, spread: ExprId, held: &[CheckerTypeId]) {
        let Ok(copied) = self.queries.expression_type(spread) else {
            return;
        };
        let position = self.hir[spread].pos;
        for element in self.collect_element_types_from(copied, 0) {
            for &held in held {
                let kind = ConversionKind::Asserted;
                self.record_conversion(element, held, position, kind);
            }
        }
    }

    pub(in crate::lower) fn record_list_flow(&mut self, elements: &[ExprId], list: CheckerTypeId) {
        let hir = self.hir;
        let holds_family = self
            .collect_element_types_from(list, 0)
            .into_iter()
            .any(|held| self.can_hold_family(held));
        if !holds_family {
            return;
        }
        let mut first_spread = None;
        for (index, &element) in elements.iter().enumerate() {
            let spread = match hir[element].kind {
                ExprKind::Missing => continue,
                ExprKind::Spread(spread) => Some(spread),
                _ => None,
            };
            if spread.is_some() && first_spread.is_none() {
                first_spread = Some(index);
            }
            let held = match first_spread {
                Some(first_spread) => self.collect_element_types_from(list, first_spread),
                None => self.find_element_type(list, index).into_iter().collect(),
            };
            match spread {
                Some(spread) => self.record_spread_elements(spread, &held),
                None => {
                    for &held in &held {
                        let kind = ConversionKind::Asserted;
                        self.record_flow_into_type(element, held, kind);
                    }
                }
            }
        }
    }

    pub(in crate::lower) fn record_array_literal_flow(
        &mut self,
        literal: ExprId,
        contextual: Option<CheckerTypeId>,
        own: Option<CheckerTypeId>,
    ) {
        let ExprKind::Array(elements) = self.hir[literal].kind else {
            return;
        };
        let elements: SmallVec<[ExprId; 8]> = self.hir.ids(elements).collect();
        let own = own.filter(|_| own != contextual);
        for list in contextual.into_iter().chain(own) {
            self.record_list_flow(&elements, list);
        }
    }
}

pub(in crate::lower) fn record_spread_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: ExprId,
    target: CheckerTypeId,
) {
    for operand in file.collect_flowing_operands(source) {
        if let Ok(copied) = file.queries.expression_type(operand) {
            let position = file.hir[operand].pos;
            file.record_copied_members(copied, target, position);
        }
    }
}
