use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `String#codePointAt` over `String#charCodeAt` and `String.fromCodePoint` over `String.fromCharCode`.
pub struct PreferCodePoint;

const PREFER_CODE_POINT: Message = Message::new("", "Prefer `{{good_method}}` over `{{bad_method}}`");

impl Rule for PreferCodePoint {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-code-point", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCodePoint
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(&["fromCharCode", "charCodeAt"]) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, member_expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Dot { obj, name, .. } = member_expr.kind() else {
            return;
        };
        let replacement = match name.bytes() {
            b"fromCharCode" if get_inner_expression(obj).is_ident("String") => "fromCodePoint",
            b"charCodeAt" if is_in_call_of_char_code_at(member_expr) => "codePointAt",
            _ => return,
        };
        if !member_expr.is_jsx_tag_name() && !member_expr.is_in_type_query() {
            cx.report(name, PREFER_CODE_POINT)
                .data("good_method", replacement)
                .data("bad_method", name)
                .fix_dangerously(|fixer| fixer.replace(name, replacement));
        }
    }
}

/// It is what a call of `charCodeAt` calls, or an argument of one.
fn is_in_call_of_char_code_at(member_expr: Expr) -> bool {
    let Some(call_expr) = member_expr.parent().as_expr().and_then(Expr::as_call) else {
        return false;
    };
    let callee = call_expr.callee();
    !member_expr.is_parenthesized()
        && !member_expr.is_chain_root()
        && !call_expr.is_optional()
        && !callee.is_parenthesized()
        && static_property_name(callee).is_some_and(|it| it.is("charCodeAt"))
}
