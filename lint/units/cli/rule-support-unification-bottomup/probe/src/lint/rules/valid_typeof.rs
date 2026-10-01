//! Ported from ESLint lib/rules/valid-typeof.js, with its default: a value that is not a string literal is allowed.

use bun_ast::{E, Expr, ExprData, OpCode};

use crate::lint::ast_utils;
use crate::lint::context::{Context, Globals};
use crate::lint::rule::{Category, Rule};
use crate::lint::rules::is_equality;

static RULE: Rule = Rule {
    name: "valid-typeof",
    category: Category::Correctness,
};

fn is_typeof(expr: &Expr) -> bool {
    matches!(&expr.data, ExprData::EUnary(unary) if unary.op == OpCode::UnTypeof)
}

fn is_type_name(name: &[u8]) -> bool {
    matches!(
        name,
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

pub(crate) fn e_binary(context: &mut Context<'_, '_>, node: &E::Binary) {
    if !is_equality(node.op) {
        return;
    }
    if is_typeof(&node.left) {
        sibling(context, &node.right);
    }
    if is_typeof(&node.right) {
        sibling(context, &node.left);
    }
}

/// What a `typeof` is compared with.
fn sibling(context: &mut Context<'_, '_>, value: &Expr) {
    let Ok(start) = u32::try_from(value.loc.start) else {
        return;
    };
    let names = match &value.data {
        ExprData::EString(_) => {
            if ast_utils::get_static_string_value(value)
                .is_some_and(|name| is_type_name(name.bytes()))
            {
                return;
            }
            Globals::NONE
        }
        ExprData::ENumber(_)
        | ExprData::EBigInt(_)
        | ExprData::EBoolean(_)
        | ExprData::ENull(_) => Globals::NONE,
        ExprData::ERegExp(reg_exp) => {
            let len = reg_exp.value.slice().len() as u32;
            context.report(
                &RULE,
                start,
                len,
                b"Invalid typeof comparison value.".to_vec(),
            );
            return;
        }
        ExprData::EIdentifier(identifier) if context.name_of(identifier.ref_) == b"undefined" => {
            Globals::UNDEFINED
        }
        _ => return,
    };
    let len = context.token_len(start);
    context.report_if_global(
        &RULE,
        start,
        len,
        b"Invalid typeof comparison value.".to_vec(),
        names,
    );
}
