use crate::jest::{self, Ctx};
use crate::jest_mocks::no_restricted_jest_methods::NoRestrictedTestMethodsConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Restrict the use of specific `jest` and `vi` methods.
pub struct NoRestrictedViMethods(NoRestrictedTestMethodsConfig);

impl Rule for NoRestrictedViMethods {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-restricted-vi-methods", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedViMethods(NoRestrictedTestMethodsConfig::new(options))
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
