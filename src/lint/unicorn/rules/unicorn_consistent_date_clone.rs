use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent cloning of `Date` objects without unnecessary `.getTime()` calls.
pub struct ConsistentDateClone;

const UNNECESSARY_GET_TIME: Message = Message::new("", "Unnecessary `.getTime()` call");

impl Rule for ConsistentDateClone {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "consistent-date-clone", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ConsistentDateClone
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("getTime") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new) = e.kind() else {
            return;
        };
        if new.args().len() != 1 || !new.type_args().is_empty() {
            return;
        }
        let Some(argument) = new.args().first() else {
            return;
        };
        let Some(call) = argument.as_call().filter(|it| it.args().is_empty() && it.chain() == Chain::No) else {
            return;
        };
        let callee = call.callee();
        if let ExprKind::Dot { obj, name, .. } = callee.kind()
            && name.name().is("getTime")
            && !callee.is_parenthesized()
            && !argument.is_parenthesized()
            && get_inner_expression(new.callee()).is_ident("Date")
        {
            cx.report(argument, UNNECESSARY_GET_TIME)
                .fix(|fixer| fixer.remove(Span::after(obj.outer_span(), argument.span().end)));
        }
    }
}
