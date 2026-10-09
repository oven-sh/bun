use crate::jest::{self, Ctx};
use crate::jest_tests::no_conditional_in_test;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow conditional statements in tests.
pub struct NoConditionalInTest;

impl Rule for NoConditionalInTest {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-conditional-in-test", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalInTest
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_conditional_in_test::run_once(&ctx);
            });
        }
    }
}
