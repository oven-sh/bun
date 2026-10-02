//! Ported from ESLint lib/rules/no-unsafe-negation.js, with its default: `<`, `>`, `<=`, `>=` are not checked.

use bun_ast::{E, ExprData, Loc, OpCode};

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
    // `astUtils.isParenthesised`, from the tokens: the tree does not say whether a `!` stands in parentheses. In `(!a) in b` a `)` before the right operand closes a `(` from before the `!`.
    let after_not = Loc {
        start: node.left.loc.start.saturating_add(1),
    };
    // The spans of both operands: the scan ends at the `loc` of the right one, and the decorators of a class stand before its `loc`. Text that does not read is not reported.
    if context.closes(after_not, node.right.loc, &[&unary.value, &node.right]) != Some(0) {
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
