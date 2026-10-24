use bun_sema::hir::{ExprId, ExprKind};
use smallvec::SmallVec;

use super::patterns::{collect_element_types_from, find_element_type};
use super::supertypes::{self, ConversionKind};
use crate::lower::{CheckerTypeId, FileLowering};

type HeldTypes = SmallVec<[CheckerTypeId; 4]>;

fn record_spread_elements(
    file: &mut FileLowering<'_, '_, '_, '_>,
    spread: ExprId,
    held: &[CheckerTypeId],
) {
    let Ok(copied) = file.queries.expression_type(spread) else {
        return;
    };
    let position = file.hir[spread].pos;
    for element in collect_element_types_from(file, copied, 0) {
        for &held in held {
            let kind = ConversionKind::Asserted;
            supertypes::record_conversion(file, element, held, position, kind);
        }
    }
}

fn find_held_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    list: CheckerTypeId,
    index: usize,
    first_spread: Option<usize>,
) -> HeldTypes {
    match first_spread {
        Some(first_spread) => collect_element_types_from(file, list, first_spread),
        None => find_element_type(file, list, index).into_iter().collect(),
    }
}

pub(in crate::lower) fn record_list_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    elements: &[ExprId],
    list: CheckerTypeId,
) {
    let hir = file.hir;
    let holds_family = collect_element_types_from(file, list, 0)
        .into_iter()
        .any(|held| supertypes::can_hold_family(file, held));
    if !holds_family {
        return;
    }
    let mut first_spread = None;
    for (index, &element) in elements.iter().enumerate() {
        if matches!(hir[element].kind, ExprKind::Missing) {
            continue;
        }
        let spread = if let ExprKind::Spread(spread) = hir[element].kind {
            Some(spread)
        } else {
            None
        };
        if spread.is_some() && first_spread.is_none() {
            first_spread = Some(index);
        }
        let held = find_held_types(file, list, index, first_spread);
        match spread {
            Some(spread) => record_spread_elements(file, spread, &held),
            None => {
                for &held in &held {
                    let kind = ConversionKind::Asserted;
                    supertypes::record_flow_into_type(file, element, held, kind);
                }
            }
        }
    }
}

pub(in crate::lower) fn record_array_literal_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    literal: ExprId,
    contextual: Option<CheckerTypeId>,
    own: Option<CheckerTypeId>,
) {
    let ExprKind::Array(elements) = file.hir[literal].kind else {
        return;
    };
    let elements: SmallVec<[ExprId; 8]> = file.hir.ids(elements).collect();
    let own = own.filter(|_| own != contextual);
    for list in contextual.into_iter().chain(own) {
        record_list_flow(file, &elements, list);
    }
}

pub(in crate::lower) fn record_spread_flow(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: ExprId,
    target: CheckerTypeId,
) {
    for operand in supertypes::collect_flowing_operands(file, source) {
        if let Ok(copied) = file.queries.expression_type(operand) {
            let position = file.hir[operand].pos;
            supertypes::record_copied_members(file, copied, target, position);
        }
    }
}
