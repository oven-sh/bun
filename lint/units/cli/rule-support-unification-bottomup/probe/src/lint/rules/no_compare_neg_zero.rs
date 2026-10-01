//! Ported from ESLint lib/rules/no-compare-neg-zero.js.

use bun_ast::{E, Expr, ExprData, Loc, OpCode};

use crate::lint::context::Context;
use crate::lint::rule::{Category, Rule};
use crate::lint::rules::{is_comparison, text};

static RULE: Rule = Rule {
    name: "no-compare-neg-zero",
    category: Category::Correctness,
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
    let Ok(own) = u32::try_from(loc.start) else {
        return;
    };
    let start = context
        .start_of(loc, node.right.loc, &[&node.left, &node.right])
        .unwrap_or(own);
    let len = context.token_len(start);
    let op = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
    context.report(
        &RULE,
        start,
        len,
        text(&[
            b"Do not use the '",
            op,
            b"' operator to compare against -0.",
        ]),
    );
}
