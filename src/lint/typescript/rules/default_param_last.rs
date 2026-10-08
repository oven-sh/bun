use bun_lint::prelude::*;
use bun_lint_eslint::rules::default_param_last::check;

/// Enforce default parameters to be last.
pub struct DefaultParamLast;

impl Rule for DefaultParamLast {
    const META: Meta =
        Meta::typescript("default-param-last", Kind::Suggestion).extends_base_rule("default-param-last");
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        DefaultParamLast
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.funcs(|_, func, cx| check(func, false, cx));
    }
}
