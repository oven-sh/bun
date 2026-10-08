use bun_lint::prelude::*;

/// Require parenthesis around regex literals.
pub struct WrapRegex;

const REQUIRE_PARENS: Message = Message::new(
    "requireParens",
    "Wrap the regexp literal in parens to disambiguate the slash.",
);

impl Rule for WrapRegex {
    const META: Meta = Meta::eslint("wrap-regex", Kind::Layout).fixable(Fixable::Code).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        WrapRegex
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Regex], |_, e, cx| {
            let Node::Expr(parent) = e.parent() else {
                return;
            };
            if ast_utils::member_object(parent) == Some(e) && !e.is_parenthesized() {
                cx.report(e, REQUIRE_PARENS)
                    .fix(|fixer| [fixer.insert_before(e, "("), fixer.insert_after(e, ")")]);
            }
        });
    }
}
