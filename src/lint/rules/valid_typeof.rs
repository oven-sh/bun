//! Ported from ESLint lib/rules/valid-typeof.js, with its default: a value that is not a string literal is allowed.

use bun_ast::{E, Expr, ExprData, OpCode};

use crate::ast_utils;
use crate::context::{Context, Globals};
use crate::rule::{Rule, RuleCategory};
use crate::rules::is_equality;

static RULE: Rule = Rule {
    name: "valid-typeof",
    category: RuleCategory::Correctness,
};

/// `isTypeofExpression`.
fn is_typeof_expression(node: &Expr) -> bool {
    matches!(&node.data, ExprData::EUnary(unary) if unary.op == OpCode::UnTypeof)
}

/// `VALID_TYPES`: the strings that `typeof` gives.
fn is_valid_type(value: &[u8]) -> bool {
    matches!(
        value,
        b"symbol"
            | b"undefined"
            | b"object"
            | b"boolean"
            | b"number"
            | b"string"
            | b"function"
            | b"bigint"
    )
}

/// The `UnaryExpression` handler, from the parent: a `==`, `!=`, `===` or `!==` checks the other side of each `typeof` it has.
pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary) {
    if !is_equality(node.op) {
        return;
    }
    if is_typeof_expression(&node.left) {
        check_sibling(context, &node.right);
    }
    if is_typeof_expression(&node.right) {
        check_sibling(context, &node.left);
    }
}

/// What a `typeof` is compared with: a literal that is no type name is reported, and an `undefined` that is the global.
fn check_sibling(context: &mut Context<'_, '_>, sibling: &Expr) {
    let names = match &sibling.data {
        // A template without a substitution is a string in Bun's tree: `isStaticTemplateLiteral` is this arm too.
        ExprData::EString(_) => {
            if ast_utils::get_static_string_value(sibling)
                .is_some_and(|value| is_valid_type(value.bytes()))
            {
                return;
            }
            Globals::NONE
        }
        ExprData::ENumber(_)
        | ExprData::EBigInt(_)
        | ExprData::EBoolean(_)
        | ExprData::ENull(_)
        | ExprData::ERegExp(_) => Globals::NONE,
        ExprData::EIdentifier(identifier) if context.name_of(identifier.ref_) == b"undefined" => {
            Globals::UNDEFINED
        }
        _ => return,
    };
    context.report_if_global(
        &RULE,
        sibling.loc,
        b"Invalid typeof comparison value.",
        names,
    );
}
