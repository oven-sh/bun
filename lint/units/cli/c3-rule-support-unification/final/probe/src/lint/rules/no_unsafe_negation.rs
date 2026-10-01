//! Ported from ESLint lib/rules/no-unsafe-negation.js, with its default: `<`, `>`, `<=`, `>=` are not checked.

use bun_ast::{E, ExprData, Loc, OpCode};

use crate::lint::context::Context;
use crate::lint::rule::{Rule, RuleCategory};
use crate::lint::rules::text;

static RULE: Rule = Rule {
    name: "no-unsafe-negation",
    category: RuleCategory::Correctness,
};

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
    // `(!a) in b` says what it means: only a `!` that no parenthesis closes before the operator is reported.
    let after_not = Loc {
        start: node.left.loc.start.saturating_add(1),
    };
    if context.closes(after_not, node.right.loc, &[&unary.value, &node.right]) != Some(0) {
        return;
    }
    let op = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
    context.report(
        &RULE,
        node.left.loc,
        text(&[
            b"Unexpected negating the left operand of '",
            op,
            b"' operator.",
        ]),
    );
}
