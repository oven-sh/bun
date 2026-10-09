use crate::jest::{self, Ctx};
use crate::jest_tests::no_identical_title;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule looks at the title of every test and test suite.
pub struct NoIdenticalTitle;

impl Rule for NoIdenticalTitle {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-identical-title", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoIdenticalTitle
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_identical_title::run_once(&ctx);
            });
        }
    }
}
