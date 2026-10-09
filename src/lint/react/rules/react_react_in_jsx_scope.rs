use crate::react::is_jsx;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that React is in scope when using JSX.
pub struct ReactInJsxScope;

const REACT_IN_JSX_SCOPE: Message = Message::new("", "`React` must be in scope when using JSX.");

/// What the configuration declares does not count.
fn declares_react(scope: Scope) -> bool {
    scope.resolve("React").is_some_and(|it| it.declarations().next().is_some())
}

impl Rule for ReactInJsxScope {
    const META: Meta = Meta::oxlint(Plugin::React, "react-in-jsx-scope", Kind::Problem);
    /// Whether the file has the name `React` in it.
    type State<'a> = bool;

    fn new(_: &Options) -> Self {
        ReactInJsxScope
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> bool {
        if !is_jsx(file) || !file.has_exprs([ExprTag::Jsx]) {
            return false;
        }
        let mentions_react = file.mentions("React");
        if mentions_react && declares_react(file.top_level_scope()) {
            return true;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            if let ExprKind::Jsx(jsx) = e.kind()
                && !(cx.state && declares_react(Node::Expr(e).scope()))
            {
                cx.report(jsx.tag().map_or_else(|| jsx.opening_span(), Expr::span), REACT_IN_JSX_SCOPE);
            }
        });
        mentions_react
    }
}
