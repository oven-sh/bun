use crate::jest::{self, Ctx};
use crate::jest_matchers::no_restricted_matchers::NoRestrictedMatchersConfig;
use bun_lint::prelude::*;

/// Ban specific matchers & modifiers from being used, and can suggest alternatives.
pub struct NoRestrictedMatchers<const VITEST: bool = false>(NoRestrictedMatchersConfig);

impl<const VITEST: bool> Rule for NoRestrictedMatchers<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-restricted-matchers", Kind::Suggestion);
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
