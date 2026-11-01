use crate::jest::{self, Ctx, Runner};
use crate::jest_mocks::no_restricted_jest_methods::NoRestrictedTestMethodsConfig;
use bun_lint::prelude::*;

/// Restrict the use of specific `jest` and `vi` methods.
pub struct NoRestrictedJestMethods<const RUNNER: u8 = { jest::JEST }>(NoRestrictedTestMethodsConfig);

impl<const RUNNER: u8> Rule for NoRestrictedJestMethods<RUNNER> {
    const META: Meta = jest::meta(
        RUNNER,
        if RUNNER == jest::VITEST { "no-restricted-vi-methods" } else { "no-restricted-jest-methods" },
        Kind::Suggestion,
    );
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoRestrictedJestMethods(NoRestrictedTestMethodsConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!self.0.is_empty() && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
