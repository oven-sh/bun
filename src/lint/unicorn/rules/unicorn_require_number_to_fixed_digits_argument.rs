use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using the digits argument with `Number#toFixed()`.
pub struct RequireNumberToFixedDigitsArgument;

const MISSING_DIGITS_ARGUMENT: Message = Message::new("", "Number method .toFixed() should have an argument");

impl Rule for RequireNumberToFixedDigitsArgument {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "require-number-to-fixed-digits-argument", Kind::Suggestion)
        .fixable(Fixable::Code);
    const ON: On = On::new().method_calls(&["toFixed"]);
    /// `toFixed`
    type State<'a> = Name<'a>;

    fn new(_: &Options) -> Self {
        RequireNumberToFixedDigitsArgument
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.find_name("toFixed")
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let Some(member) = get_member_expr(call.callee()) else {
            return;
        };
        let Some((obj, _, _)) = member.as_dot().filter(|it| it.1.name() == cx.state) else {
            return;
        };
        if !call.args().is_empty() || call.is_optional() || obj.tag() == ExprTag::New && !obj.is_parenthesized() {
            return;
        }
        // From the end of `a.toFixed`, whatever is between that and the `(`.
        let parentheses = Span::after(member.span(), e.span().end);
        cx.report(parentheses, MISSING_DIGITS_ARGUMENT)
            .fix(|fixer| fixer.insert_before(Span::empty(parentheses.end.saturating_sub(1)), "0"));
    }
}
