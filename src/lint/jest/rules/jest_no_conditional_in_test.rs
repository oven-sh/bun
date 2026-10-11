use crate::jest::{self, Ctx};
use crate::jest_tests::no_conditional_in_test;
use bun_lint::prelude::*;

/// Disallow conditional statements in tests.
pub struct NoConditionalInTest<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoConditionalInTest<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-conditional-in-test", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalInTest
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::mentions_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_conditional_in_test::run_once(&ctx);
    }
}
