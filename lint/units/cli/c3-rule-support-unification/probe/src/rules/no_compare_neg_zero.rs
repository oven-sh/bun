//! ESLint: lib/rules/no-compare-neg-zero.js
use crate::context::Context;
use crate::rules::{is_comparison, op_text};
use bun_ast::expr::Data as ExprData;
use bun_ast::{E, Expr, Loc, OpCode};

const NAME: &str = "no-compare-neg-zero";

fn is_neg_zero(expr: &Expr) -> bool {
    let ExprData::EUnary(unary) = &expr.data else { return false };
    if unary.op != OpCode::UnNeg {
        return false;
    }
    matches!(&unary.value.data, ExprData::ENumber(number) if number.value() == 0.0)
}

pub(crate) fn e_binary(cx: &mut Context<'_, '_>, node: &E::Binary, loc: Loc) {
    if !is_comparison(node.op) || !(is_neg_zero(&node.left) || is_neg_zero(&node.right)) {
        return;
    }
    let at = cx.start_of_binary(node, loc);
    cx.report(NAME, at, format_args!("Do not use the '{}' operator to compare against -0.", op_text(node.op)));
}
