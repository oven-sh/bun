//! Ported from ESLint lib/rules/no-unsafe-negation.js, with its default: `<`, `>`, `<=`, `>=` are not checked.

use bun_ast::{E, ExprData, OpCode};

use crate::lint::context::Context;
use crate::lint::rule::{Category, Rule};
use crate::lint::rules::text;

static RULE: Rule = Rule {
    name: "no-unsafe-negation",
    category: Category::Correctness,
};

pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary) {
    if !matches!(node.op, OpCode::BinIn | OpCode::BinInstanceof) {
        return;
    }
    let ExprData::EUnary(unary) = &node.left.data else {
        return;
    };
    let Ok(start) = u32::try_from(node.left.loc.start) else {
        return;
    };
    if unary.op != OpCode::UnNot {
        return;
    }
    // `(!a) in b` says what it means: only a `!` that no parenthesis closes before the operator is reported.
    if context.closes(start + 1, node.right.loc, &[&unary.value, &node.right]) != Some(0) {
        return;
    }
    let op = bun_ast::Op::TABLE.get_ptr_const(node.op).text;
    context.report(
        &RULE,
        start,
        1,
        text(&[
            b"Unexpected negating the left operand of '",
            op,
            b"' operator.",
        ]),
    );
}
