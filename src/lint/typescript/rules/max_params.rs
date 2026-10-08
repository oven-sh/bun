use bun_lint::prelude::*;
use bun_lint_eslint::rules::max_params::Config;

/// Enforce a maximum number of parameters in function definitions.
pub struct MaxParams(Config);

impl Rule for MaxParams {
    const META: Meta = Meta::typescript("max-params", Kind::Suggestion).extends_base_rule("max-params");
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxParams(Config::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|rule, func, cx| rule.0.check(func, cx));
    }
}
