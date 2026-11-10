use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::no_restricted_matchers::NoRestrictedMatchersConfig;
use bun_lint::prelude::*;

/// Ban specific matchers & modifiers from being used, and can suggest alternatives.
pub struct NoRestrictedMatchers<const RUNNER: u8 = { jest::JEST }>(NoRestrictedMatchersConfig);

impl<const RUNNER: u8> Rule for NoRestrictedMatchers<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-restricted-matchers", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedMatchers(NoRestrictedMatchersConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!self.0.is_empty() && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
