use bun_lint_oxlint::ast_util::{is_reference_to_global_variable, static_property_name};
use crate::unicorn::concat;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `Number()` over `parseFloat()` and base-10 `parseInt()`.
pub struct PreferNumberCoercion;

const PREFER_NUMBER_COERCION: Message = Message::new("", "Prefer `{{replacement}}`.");
const REPLACE: Message = Message::new("", "Replace this call with `{{replacement}}`.");

impl Rule for PreferNumberCoercion {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-number-coercion", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferNumberCoercion
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["parseFloat", "parseInt"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call_expr) = e.as_call().filter(|it| !it.is_optional()) else {
                return;
            };
            let Some(is_parse_int) = parse_target(call_expr.callee()) else {
                return;
            };
            let args = call_expr.args();
            let is_base_10 = |it: Expr| matches!(it.kind(), ExprKind::Number(value) if value == 10.0) && !it.is_parenthesized();
            if args.len() != (if is_parse_int { 2 } else { 1 }) || is_parse_int && !args.get(1).is_some_and(is_base_10) {
                return;
            }
            let Some(first_argument) = args.first().filter(|it| it.tag() != ExprTag::Spread) else {
                return;
            };
            let first_argument_text = cx.slice(first_argument.outer_span());
            let replacement_text = match is_parse_int {
                true => concat(&[b"Math.trunc(Number(", first_argument_text, b"))"]),
                false => concat(&[b"Number(", first_argument_text, b")"]),
            };
            cx.report(e, PREFER_NUMBER_COERCION)
                .data("replacement", replacement_text.clone())
                .suggest_with(REPLACE, &[("replacement", &replacement_text[..])], |fixer| fixer.replace(e, &replacement_text[..]));
        });
    }
}

/// Whether `parseInt` is called, or else `parseFloat`: the global, or that of the global `Number`.
fn parse_target(callee: Expr) -> Option<bool> {
    let (name, global) = match callee.kind() {
        ExprKind::Ident(name) => (name, callee),
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !callee.is_chain_root() => {
            (static_property_name(callee)?, Some(obj).filter(|it| it.is_ident("Number") && !it.is_parenthesized())?)
        }
        _ => return None,
    };
    let is_parse_int = match name.bytes() {
        b"parseInt" => true,
        b"parseFloat" => false,
        _ => return None,
    };
    is_reference_to_global_variable(global).then_some(is_parse_int)
}
