mod element;
mod props;

use bun_sema::hir::{ExprId, JsxId, PropId};

use super::FunctionLowering;
use crate::ir::ValueId;

#[derive(Copy, Clone, Debug)]
struct Element {
    expression: ExprId,
    jsx: JsxId,
    position: u32,
    key: Option<PropId>,
}

pub(crate) fn lower_jsx(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    element::lower_element(lowering, expression)
}

pub(crate) fn lower_element_parts_for_effect(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    element::lower_parts_for_effect(lowering, expression);
}
