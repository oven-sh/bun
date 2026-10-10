use crate::jest::{self, Ctx};
use crate::jest_mocks::no_restricted_jest_methods::NoRestrictedTestMethodsConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Restrict the use of specific `jest` and `vi` methods.
pub struct NoRestrictedJestMethods(NoRestrictedTestMethodsConfig);

impl Rule for NoRestrictedJestMethods {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-restricted-jest-methods", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedJestMethods(NoRestrictedTestMethodsConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!self.0.is_empty() && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
