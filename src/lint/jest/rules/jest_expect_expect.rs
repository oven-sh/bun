use crate::jest::{self, Ctx, Runner};
use crate::jest_expect::expect_expect::ExpectExpectConfig;
use bun_lint::prelude::*;

/// This rule triggers when there is no call made to `expect` in a test, ensure that there is at least one `expect` call made
/// in a test.
pub struct ExpectExpect<const RUNNER: u8 = { jest::JEST }>(ExpectExpectConfig);

impl<const RUNNER: u8> Rule for ExpectExpect<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "expect-expect", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ExpectExpect(ExpectExpectConfig::new(options, Runner::of(RUNNER)))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
