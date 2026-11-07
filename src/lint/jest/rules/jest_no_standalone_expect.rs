use crate::jest::{self, Ctx, Runner};
use crate::jest_expect::no_standalone_expect::NoStandaloneExpectConfig;
use bun_lint::prelude::*;

/// Prevents `expect` statements outside of a `test` or `it` block.
pub struct NoStandaloneExpect<const RUNNER: u8 = { jest::JEST }>(NoStandaloneExpectConfig);

impl<const RUNNER: u8> Rule for NoStandaloneExpect<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-standalone-expect", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoStandaloneExpect(NoStandaloneExpectConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && file.mentions("expect")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
