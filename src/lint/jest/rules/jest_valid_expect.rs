use crate::jest::{self, Ctx, Runner};
use crate::jest_expect::valid_expect::ValidExpectConfig;
use bun_lint::prelude::*;

/// Checks that `expect()` is called correctly.
pub struct ValidExpect<const RUNNER: u8 = { jest::JEST }>(ValidExpectConfig);

impl<const RUNNER: u8> Rule for ValidExpect<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "valid-expect", Kind::Problem).has_suggestions().hints();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ValidExpect(ValidExpectConfig::new(options, RUNNER != jest::JEST))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && file.mentions("expect")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
