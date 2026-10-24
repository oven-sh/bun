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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_jsx(&mut self, expression: ExprId) -> ValueId {
        element::lower_element(self, expression)
    }

    pub(crate) fn lower_element_parts_for_effect(&mut self, expression: ExprId) {
        element::lower_parts_for_effect(self, expression);
    }
}
