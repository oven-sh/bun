use bun_lint::prelude::*;
use bun_lint_eslint::rules::default_param_last::check;

/// Enforce default parameters to be last.
pub struct DefaultParamLast;

impl Rule for DefaultParamLast {
    const META: Meta =
        Meta::typescript("default-param-last", Kind::Suggestion).extends_base_rule("default-param-last");
    const ON: On = On::new().funcs();
    no_state!();

    fn new(_: &Options) -> Self {
        DefaultParamLast
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check(func, false, cx);
    }
}
