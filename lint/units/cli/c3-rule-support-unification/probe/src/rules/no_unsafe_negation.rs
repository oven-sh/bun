//! ESLint: lib/rules/no-unsafe-negation.js (enforceForOrderingRelations: false)
use crate::context::Context;
use crate::rules::op_text;
use bun_ast::expr::Data as ExprData;
use bun_ast::{E, OpCode};

const NAME: &str = "no-unsafe-negation";

pub(crate) fn e_binary(cx: &mut Context<'_, '_>, node: &E::Binary) {
    if !matches!(node.op, OpCode::BinIn | OpCode::BinInstanceof) {
        return;
    }
    let ExprData::EUnary(unary) = &node.left.data else { return };
    if unary.op != OpCode::UnNot {
        return;
    }
    let (Ok(not), Ok(right)) = (u32::try_from(node.left.loc.start), u32::try_from(node.right.loc.start)) else { return };
    // `(!a) in b` says what it means: a `)` between the `!` and the operator closes a `(` before the `!`.
    let Some(between) = cx.between(not + 1, right, &[&unary.value, &node.right]) else { return };
    if between.unmatched > 0 {
        return;
    }
    cx.report(NAME, node.left.loc, format_args!("Unexpected negating the left operand of '{}' operator.", op_text(node.op)));
}
