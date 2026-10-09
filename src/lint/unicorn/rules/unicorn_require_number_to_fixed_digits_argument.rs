use bun_lint_oxlint::ast_util::get_member_expr;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using the digits argument with `Number#toFixed()`.
pub struct RequireNumberToFixedDigitsArgument;

const MISSING_DIGITS_ARGUMENT: Message = Message::new("", "Number method .toFixed() should have an argument");

impl Rule for RequireNumberToFixedDigitsArgument {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "require-number-to-fixed-digits-argument", Kind::Suggestion)
        .fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireNumberToFixedDigitsArgument
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("toFixed") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| it.args().is_empty() && !it.is_optional()) else {
                return;
            };
            let Some(member) = get_member_expr(call.callee()) else {
                return;
            };
            let ExprKind::Dot { obj, name, .. } = member.kind() else {
                return;
            };
            if !name.name().is("toFixed") || obj.tag() == ExprTag::New && !obj.is_parenthesized() {
                return;
            }
            // From the end of `a.toFixed`, whatever is between that and the `(`.
            let parentheses = Span::after(member.span(), e.span().end);
            cx.report(parentheses, MISSING_DIGITS_ARGUMENT)
                .fix(|fixer| fixer.insert_before(Span::empty(parentheses.end.saturating_sub(1)), "0"));
        });
    }
}
