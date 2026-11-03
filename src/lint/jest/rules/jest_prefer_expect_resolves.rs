use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_expect_resolves;
use bun_lint::prelude::*;

/// Prefer `await expect(...).resolves` over `expect(await ...)` when testing promises.
pub struct PreferExpectResolves<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferExpectResolves<RUNNER> {
    const META: Meta = jest::meta_with_risky_fix(RUNNER, "prefer-expect-resolves", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExpectResolves
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file, RUNNER) && file.has_exprs([ExprTag::Await])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_expect_resolves::run);
    }
}
