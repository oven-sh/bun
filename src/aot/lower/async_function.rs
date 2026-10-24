use bun_sema::hir::{ExprId, ExprKind};

use super::FunctionLowering;
use crate::ir::ValueId;
use crate::ir::generated::{FunctionFlags, TypeSiteKind};

pub(crate) fn lower_await(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let ExprKind::Await(operand) = hir[expression].kind else {
        unreachable!("lower_await takes an Await expression");
    };
    lowering.note_what_an_awaited_parse_may_build(expression, operand);
    let awaited = lowering.lower_expression(operand);
    // JSC records no position for an await, so a suspended function is shown where its operand ends.
    lowering.set_position(lowering.file.last_reported_position(operand));
    let value = lowering.emit_await(awaited);
    lowering.set_position(hir[expression].pos);
    // The type of the whole expression also covers an operand that is a promise only in some members of a union.
    let fulfilled = lowering.file.queries.expression_type(expression);
    lowering.claim_contents_read(fulfilled, TypeSiteKind::PromiseValue, value)
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
        self.builder.await_value(value, false)
    }
}
