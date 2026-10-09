use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow optional chaining.
pub struct NoOptionalChaining;

const NO_OPTIONAL_CHAINING: Message = Message::new("", "Optional chaining is not allowed.");

impl Rule for NoOptionalChaining {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-optional-chaining", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoOptionalChaining
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.optional_chains(|_, e, cx| {
            // The whole of `a?.b!` is the `!`.
            let whole = match e.parent() {
                Node::Expr(parent) if parent.tag() == ExprTag::NonNull && !e.is_parenthesized() => parent,
                _ => e,
            };
            if whole.is_chain_root() {
                cx.report(whole, NO_OPTIONAL_CHAINING);
            }
        });
    }
}
