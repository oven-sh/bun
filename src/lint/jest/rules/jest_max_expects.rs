use crate::jest::{self, Ctx, Runner};
use crate::jest_expect::max_expects;
use bun_lint::prelude::*;

/// This rule enforces a maximum number of `expect()` calls in a single test.
pub struct MaxExpects<const RUNNER: u8 = { jest::JEST }>(u32);

impl<const RUNNER: u8> Rule for MaxExpects<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "max-expects", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxExpects(jest::max_of(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && file.mentions("expect")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        max_expects::run_once(self.0, &ctx);
    }
}
