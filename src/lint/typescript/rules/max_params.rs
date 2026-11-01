use bun_lint::prelude::*;
use bun_lint_eslint::rules::max_params::Config;

/// Enforce a maximum number of parameters in function definitions.
pub struct MaxParams(Config);

impl Rule for MaxParams {
    const META: Meta = Meta::typescript("max-params", Kind::Suggestion).extends_base_rule("max-params");
    const ON: On = On::new().funcs();
    no_state!();

    fn new(options: &Options) -> Self {
        MaxParams(Config::new_for_typescript_eslint(options))
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.0.check(func, cx);
    }
}
