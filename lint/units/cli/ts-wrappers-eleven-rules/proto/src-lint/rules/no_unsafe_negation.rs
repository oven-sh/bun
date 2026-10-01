//! Ported from ESLint lib/rules/no-unsafe-negation.js, with its default: `<`, `>`, `<=`, `>=` are not checked.

use bun_ast::{E, ExprData, OpCode};

use crate::context::Context;
use crate::rule::{Rule, RuleCategory};
use crate::rules::text;

static RULE: Rule = Rule {
    name: "no-unsafe-negation",
    category: RuleCategory::Correctness,
};

/// The `BinaryExpression` handler: a `!` that is the left operand of an `in` or of an `instanceof` is reported at the `!`, but not one in parentheses of its own.
pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary) {
    if !matches!(node.op, OpCode::BinIn | OpCode::BinInstanceof) {
        return;
    }
    let ExprData::EUnary(unary) = &node.left.data else {
        return;
    };
    if unary.op != OpCode::UnNot {
        return;
    }
    // `astUtils.isParenthesised`, and a TypeScript node around the `!`: `(!a) in b` and `!a as any in b` have no `!` as their left operand.
    if context.is_wrapped(&node.left) {
        return;
    }
    let operator = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
    context.report(
        &RULE,
        node.left.loc,
        text(&[
            b"Unexpected negating the left operand of '",
            operator,
            b"' operator.",
        ]),
    );
}
