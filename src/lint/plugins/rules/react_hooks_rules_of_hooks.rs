use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the Rules of Hooks.
pub struct RulesOfHooks;

impl Rule for RulesOfHooks {
    const META: Meta = Meta::plugin(Plugin::ReactHooks, "rules-of-hooks", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RulesOfHooks
    }

    fn register<'a>(&self, _: &mut Listeners<'a, Self>, _: &'a File<'a>) {}
}
