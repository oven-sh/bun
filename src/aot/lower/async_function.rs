use bun_sema::hir::{ExprId, ExprKind};

use super::FunctionLowering;
use crate::ir::ValueId;
use crate::ir::generated::FunctionFlags;

pub(crate) fn lower_await(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Await(operand) = hir[expression].kind else {
        unreachable!("lower_await takes an Await expression");
    };
    let awaited = lowering.lower_expression(operand);
    if let Some(position) = lowering.file.awaited_position(operand) {
        lowering.set_position(position);
    }
    let value = lowering.emit_await(awaited);
    lowering.set_position(hir[expression].pos);
    value
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn emit_await(&mut self, value: ValueId) -> ValueId {
        debug_assert!(
            self.builder
                .function()
                .flags
                .contains(FunctionFlags::IS_ASYNC),
            "only an async function or a module body with top-level await awaits"
        );
        let held = self.get_held_values();
        self.builder.await_value(value, &held)
    }
}
