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
    // A TypeScript node around the `!` is the left operand for ESLint: `!a as any in b` has no negation there.
    if context.ts_wrapper(&node.left).is_some() {
        return;
    }
    // `astUtils.isParenthesised`: `(!a) in b` is what the rule asks for.
    if context.paren_count(&node.left) > 0 {
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
