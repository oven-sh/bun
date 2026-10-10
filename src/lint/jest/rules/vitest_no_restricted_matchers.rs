use crate::jest::{self, Ctx};
use crate::jest_matchers::no_restricted_matchers::NoRestrictedMatchersConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ban specific matchers & modifiers from being used, and can suggest alternatives.
pub struct NoRestrictedMatchers(NoRestrictedMatchersConfig);

impl Rule for NoRestrictedMatchers {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-restricted-matchers", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedMatchers(NoRestrictedMatchersConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!self.0.is_empty() && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
