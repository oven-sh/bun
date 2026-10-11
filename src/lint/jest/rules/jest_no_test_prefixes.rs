use crate::jest::{self, Ctx};
use crate::jest_tests::no_test_prefixes;
use bun_lint::prelude::*;

/// Require using `.only` and `.skip` over `f` and `x`.
pub struct NoTestPrefixes<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoTestPrefixes<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-test-prefixes", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTestPrefixes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_any(file, &const { jest::mention_bits(["fit", "fdescribe", "xit", "xtest", "xdescribe"]) }) && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_test_prefixes::run);
    }
}
