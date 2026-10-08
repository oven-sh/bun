use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_shadow::{Checker, Dialect};

/// Disallow variable declarations from shadowing variables declared in the outer scope.
pub struct NoShadow(Checker);

impl Rule for NoShadow {
    const META: Meta =
        Meta::typescript("no-shadow", Kind::Suggestion).extends_base_rule("no-shadow");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoShadow(Checker::new(options, Dialect::TypeScriptEslint))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| rule.0.check(cx));
    }
}
