use crate::jest::{self, Ctx};
use crate::jest_tests::no_conditional_in_test;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow conditional statements in tests.
pub struct NoConditionalInTest;

impl Rule for NoConditionalInTest {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-conditional-in-test", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalInTest
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_conditional_in_test::run_once(&ctx);
    }
}
