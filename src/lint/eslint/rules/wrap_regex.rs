use bun_lint::prelude::*;

/// Require parenthesis around regex literals.
pub struct WrapRegex;

const REQUIRE_PARENS: Message = Message::new(
    "requireParens",
    "Wrap the regexp literal in parens to disambiguate the slash.",
);

impl Rule for WrapRegex {
    const META: Meta = Meta::eslint("wrap-regex", Kind::Layout).fixable(Fixable::Code).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::Regex]);
    no_state!();

    fn new(_: &Options) -> Self {
        WrapRegex
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(parent) = e.parent() else {
            return;
        };
        if ast_utils::member_object(parent) == Some(e) && !e.is_parenthesized() {
            cx.report(e, REQUIRE_PARENS)
                .fix(|fixer| [fixer.insert_before(e, "("), fixer.insert_after(e, ")")]);
        }
    }
}
