use crate::jest::{self, Ctx};
use crate::jest_matchers::no_restricted_matchers::NoRestrictedMatchersConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ban specific matchers & modifiers from being used, and can suggest alternatives.
pub struct NoRestrictedMatchers(NoRestrictedMatchersConfig);

impl Rule for NoRestrictedMatchers {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-restricted-matchers", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedMatchers(NoRestrictedMatchersConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !self.0.is_empty() && jest::is_test(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &|node, ctx| rule.0.run(node, ctx));
            });
        }
    }
}
