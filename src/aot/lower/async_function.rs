use bun_sema::hir::{ExprId, ExprKind};

use super::{FunctionLowering, call, convert, expression, validate};
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
    validate::note_what_an_awaited_parse_may_build(lowering, expression, operand);
    let awaited = expression::lower_expression(lowering, operand);
    // JSC records no position for an await, so a suspended function is shown where its operand ends.
    lowering.set_position(call::last_reported_position(lowering.file, operand));
    let value = emit_await(lowering, awaited);
    lowering.set_position(hir[expression].pos);
    // The type of the whole expression also covers an operand that is a promise only in some members of a union.
    let fulfilled = lowering.file.queries.expression_type(expression);
    convert::claim_contents_read(lowering, fulfilled, TypeSiteKind::PromiseValue, value)
}

pub(crate) fn emit_await(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) -> ValueId {
    debug_assert!(
        lowering
            .builder
            .function()
            .flags
            .contains(FunctionFlags::IS_ASYNC),
        "only an async function or a module body with top-level await awaits"
    );
    lowering.builder.await_value(value, false)
}
