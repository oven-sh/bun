use crate::jest::{self, Ctx, Runner};
use crate::jest_expect::no_conditional_expect;
use bun_lint::prelude::*;

/// This rule prevents the use of `expect` in conditional blocks, such as `if` and `catch`.
pub struct NoConditionalExpect<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoConditionalExpect<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-conditional-expect", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalExpect
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_conditional_expect::run(&ctx);
    }
}
