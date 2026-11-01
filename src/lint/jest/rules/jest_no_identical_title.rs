use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_identical_title;
use bun_lint::prelude::*;

/// This rule looks at the title of every test and test suite.
pub struct NoIdenticalTitle<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoIdenticalTitle<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-identical-title", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoIdenticalTitle
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && (jest::mentions_test(file) || jest::mentions_describe(file))).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_identical_title::run_once(&ctx);
    }
}
