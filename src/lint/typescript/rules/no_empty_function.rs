use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_empty_function::{Allow, check};

/// Disallow empty functions.
pub struct NoEmptyFunction {
    allow: Allow,
}

impl Rule for NoEmptyFunction {
    const META: Meta = Meta::typescript("no-empty-function", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STYLISTIC)
        .extends_base_rule("no-empty-function");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoEmptyFunction {
            allow: Allow::of_typescript_eslint(options),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|rule, func, cx| check(func, rule.allow, cx));
    }
}
