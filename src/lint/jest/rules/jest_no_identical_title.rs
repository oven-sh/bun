use crate::jest::{self, Ctx};
use crate::jest_tests::no_identical_title;
use bun_lint::prelude::*;

/// This rule looks at the title of every test and test suite.
pub struct NoIdenticalTitle<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoIdenticalTitle<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-identical-title", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoIdenticalTitle
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_test(file) || jest::mentions_describe(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_identical_title::run_once(&ctx);
    }
}
