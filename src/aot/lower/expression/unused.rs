use bun_sema::hir::{ExprId, ExprKind, PropId, PropKey, PropKind, Span};
use smallvec::SmallVec;

use super::{BinaryForm, binary_form, lower_expression, lower_expression_for_effect};
use crate::lower::{FunctionLowering, jsx};

fn lower_properties_for_effect(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    properties: Span<PropId>,
) {
    let hir = lowering.file.hir;
    for property in properties.iter() {
        if let PropKey::Computed(key) = hir[property].key {
            let key = lower_expression(lowering, key);
            lowering.builder.to_property_key(key);
        }
        match hir[property].kind {
            PropKind::Init | PropKind::Shorthand => {
                lower_expression_for_effect(lowering, hir[property].value);
            }
            PropKind::Method | PropKind::Getter | PropKind::Setter => {}
            PropKind::Spread => unreachable!("an object with a spread is made as it is written"),
        }
    }
}

// What is evaluated of an expression that `Removable::find_simplified_expressions` lists.
pub(super) fn lower_simplified_expression(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    let hir = lowering.file.hir;
    let mut parts: SmallVec<[ExprId; 4]> = SmallVec::new();
    match hir[expression].kind {
        ExprKind::Cond { test, .. } => parts.push(test),
        ExprKind::Unary { operand, .. } => parts.push(operand),
        ExprKind::Binary { op, left, right } => match binary_form(op) {
            BinaryForm::Logical => parts.push(left),
            BinaryForm::Operator | BinaryForm::Comma => parts.extend([left, right]),
        },
        ExprKind::Call(site) | ExprKind::New(site) => parts.extend(hir.ids(hir[site].args)),
        ExprKind::Array(items) => parts.extend(hir.ids(items)),
        ExprKind::Object(properties) => return lower_properties_for_effect(lowering, properties),
        ExprKind::Jsx(_) => return jsx::lower_element_parts_for_effect(lowering, expression),
        _ => unreachable!("no part of such an expression is left out"),
    }
    for part in parts {
        lower_expression_for_effect(lowering, part);
    }
}
