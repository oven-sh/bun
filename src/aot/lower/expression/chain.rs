use bun_sema::hir::{Chain, ExprFlags, ExprId, ExprKind};

use super::{Evaluation, Tail, lower_expression, lower_expression_in};
use crate::ir::{BlockId, ValueId};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ShortCircuit {
    Undefined,
    True,
}

pub(in crate::lower) fn is_chain_root(
    file: &FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    let hir = file.hir;
    let chain = match hir[expression].kind {
        ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
        ExprKind::Call(call) => hir[call].chain,
        _ => Chain::No,
    };
    match chain {
        Chain::Start | Chain::Continue => true,
        Chain::No => false,
    }
}

pub(in crate::lower) fn lower_chain_base(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    base: ExprId,
    exit: Option<BlockId>,
) -> ValueId {
    let hir = lowering.file.hir;
    let mut inner = base;
    while let ExprKind::NonNull(operand) = hir[inner].kind {
        if hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED) {
            break;
        }
        inner = operand;
    }
    match exit {
        Some(exit)
            if is_chain_root(lowering.file, inner)
                && !hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED) =>
        {
            lower_expression_in(lowering, inner, Evaluation::in_chain(exit, Tail::No))
        }
        Some(_) | None => lower_expression(lowering, base),
    }
}

pub(in crate::lower) fn lower_in_chain(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    short_circuit: ShortCircuit,
    body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, BlockId) -> ValueId,
) -> ValueId {
    let exit = lowering.create_block();
    let join = lowering.create_block();
    let result = lowering.builder.create_variable(None);
    let value = body(lowering, exit);
    lowering.builder.write_variable(result, value);
    lowering.jump(join);
    lowering.continue_in(exit);
    let skipped = match short_circuit {
        ShortCircuit::Undefined => lowering.builder.undefined(),
        ShortCircuit::True => lowering.builder.boolean(true),
    };
    lowering.builder.write_variable(result, skipped);
    lowering.jump(join);
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

pub(super) fn lower_whole_chain(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    tail: Tail<'_>,
) -> ValueId {
    lower_in_chain(lowering, ShortCircuit::Undefined, &mut |lowering, exit| {
        super::lower_by_kind(lowering, expression, Evaluation::in_chain(exit, tail))
    })
}
