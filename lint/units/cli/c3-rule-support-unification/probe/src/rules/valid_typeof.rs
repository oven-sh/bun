//! ESLint: lib/rules/valid-typeof.js (requireStringLiterals: false)
use crate::context::{Context, Globals};
use bun_ast::expr::Data as ExprData;
use bun_ast::{E, Expr, OpCode};

const NAME: &str = "valid-typeof";
const MESSAGE: &str = "Invalid typeof comparison value.";

fn is_typeof(expr: &Expr) -> bool {
    matches!(&expr.data, ExprData::EUnary(unary) if unary.op == OpCode::UnTypeof)
}

fn check(cx: &mut Context<'_, '_>, sibling: &Expr) {
    match &sibling.data {
        // A quoted string, or a template without a substitution.
        ExprData::EString(string) => {
            let valid = [&b"symbol"[..], b"undefined", b"object", b"boolean", b"number", b"string", b"function", b"bigint"]
                .iter()
                .any(|name| string.eql_bytes(name));
            if !valid {
                cx.report(NAME, sibling.loc, format_args!("{MESSAGE}"));
            }
        }
        ExprData::ENumber(_) | ExprData::EBigInt(_) | ExprData::EBoolean(_) | ExprData::ENull(_) | ExprData::ERegExp(_) => {
            cx.report(NAME, sibling.loc, format_args!("{MESSAGE}"));
        }
        ExprData::EIdentifier(identifier) if cx.name(identifier.ref_) == b"undefined" => {
            cx.report_if_global(Globals::UNDEFINED, NAME, sibling.loc, format_args!("{MESSAGE}"));
        }
        _ => {}
    }
}

pub(crate) fn e_binary(cx: &mut Context<'_, '_>, node: &E::Binary) {
    if !crate::rules::is_equality(node.op) {
        return;
    }
    if is_typeof(&node.left) {
        check(cx, &node.right);
    }
    if is_typeof(&node.right) {
        check(cx, &node.left);
    }
}
