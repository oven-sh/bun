use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::consistent_test_it::ConsistentTestItConfig;
use bun_lint::prelude::*;

/// Enforce consistent use of either the `it` or `test` keyword for defining tests.
pub struct ConsistentTestIt<const RUNNER: u8 = { jest::JEST }>(ConsistentTestItConfig);

impl<const RUNNER: u8> Rule for ConsistentTestIt<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "consistent-test-it", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentTestIt(ConsistentTestItConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && jest::mentions_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
