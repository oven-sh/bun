use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_shadow::{Checker, Dialect};

/// Disallow variable declarations from shadowing variables declared in the outer scope.
pub struct NoShadow(Checker);

impl Rule for NoShadow {
    const META: Meta =
        Meta::typescript("no-shadow", Kind::Suggestion).extends_base_rule("no-shadow");
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoShadow(Checker::new(options, Dialect::TypeScriptEslint))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(cx);
    }
}
