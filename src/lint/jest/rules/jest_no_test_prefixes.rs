use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_test_prefixes;
use bun_lint::prelude::*;

/// Require using `.only` and `.skip` over `f` and `x`.
pub struct NoTestPrefixes<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoTestPrefixes<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-test-prefixes", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTestPrefixes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_any(file, &const { jest::mention_bits(["fit", "fdescribe", "xit", "xtest", "xdescribe"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_test_prefixes::run);
    }
}
