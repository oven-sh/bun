//! Ported from ESLint lib/rules/no-compare-neg-zero.js.

use bun_ast::{E, Expr, ExprData, Loc, OpCode};

use crate::context::Context;
use crate::rule::{Rule, RuleCategory};
use crate::rules::{is_comparison, text};

static RULE: Rule = Rule {
    name: "no-compare-neg-zero",
    category: RuleCategory::Correctness,
};

/// `isNegZero`: a `-` before a number literal that is zero. The `0n` of `-0n` is a BigInt: ESLint's `=== 0` is false for it.
fn is_neg_zero(context: &Context<'_, '_>, node: &Expr) -> bool {
    // A TypeScript node around the `-0` or around its `0` is what ESLint has there: `-0 as number` is no `-0`.
    if context.ts_wrapper(node).is_some() {
        return false;
    }
    let ExprData::EUnary(unary) = &node.data else {
        return false;
    };
    unary.op == OpCode::UnNeg
        && context.ts_wrapper(&unary.value).is_none()
        && matches!(&unary.value.data, ExprData::ENumber(number) if number.value() == 0.0)
}

/// The `BinaryExpression` handler: one of `OPERATORS_TO_CHECK` with a `-0` on either side, reported once where the comparison starts.
pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary, loc: Loc) {
    if !is_comparison(node.op)
        || !(is_neg_zero(context, &node.left) || is_neg_zero(context, &node.right))
    {
        return;
    }
    let start = context.binary_start(node, loc);
    let operator = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
    context.report(
        &RULE,
        start,
        text(&[
            b"Do not use the '",
            operator,
            b"' operator to compare against -0.",
        ]),
    );
}
