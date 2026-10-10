use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `trimStart` / `trimEnd` over `trimLeft` / `trimRight` on String.
pub struct PreferStringTrimStartEnd;

const PREFER_STRING_TRIM_START_END: Message = Message::new("", "Prefer `{{good_trim}}` over `{{bad_trim}}`");

impl Rule for PreferStringTrimStartEnd {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-string-trim-start-end", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStringTrimStartEnd
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions_any(&["trimLeft", "trimRight"]) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call_expr) = e.as_call()
            && call_expr.args().is_empty()
            && !call_expr.is_optional()
            && let Some(ExprKind::Dot { name, .. }) = get_member_expr(call_expr.callee()).map(Expr::kind)
            && let Some(good_trim) = match name.bytes() {
                b"trimLeft" => Some("trimStart"),
                b"trimRight" => Some("trimEnd"),
                _ => None,
            }
        {
            cx.report(name, PREFER_STRING_TRIM_START_END)
                .data("good_trim", good_trim)
                .data("bad_trim", name.bytes())
                .fix(|fixer| fixer.replace(name, good_trim));
        }
    }
}
