//! Ported from ESLint lib/rules/no-compare-neg-zero.js.

use bun_ast::{E, Expr, ExprData, Loc, OpCode};

use crate::lint::context::Context;
use crate::lint::rule::{Rule, RuleCategory};
use crate::lint::rules::{is_comparison, text};

static RULE: Rule = Rule {
    name: "no-compare-neg-zero",
    category: RuleCategory::Correctness,
};

fn is_neg_zero(expr: &Expr) -> bool {
    let ExprData::EUnary(unary) = &expr.data else {
        return false;
    };
    unary.op == OpCode::UnNeg
        && matches!(&unary.value.data, ExprData::ENumber(number) if number.value() == 0.0)
}

pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary, loc: Loc) {
    if !is_comparison(node.op) || !(is_neg_zero(&node.left) || is_neg_zero(&node.right)) {
        return;
    }
    let start = context.binary_start(node, loc);
    let op = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
    context.report(
        &RULE,
        start,
        text(&[
            b"Do not use the '",
            op,
            b"' operator to compare against -0.",
        ]),
    );
}
