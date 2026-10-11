use crate::jest::{self, Ctx};
use crate::jest_expect::prefer_expect_assertions::PreferExpectAssertionsConfig;
use bun_lint::prelude::*;

/// Enforces that every test has either `expect.assertions(<number>)` or `expect.hasAssertions()` as its first expression.
pub struct PreferExpectAssertions<const VITEST: bool = false>(PreferExpectAssertionsConfig);

impl<const VITEST: bool> Rule for PreferExpectAssertions<VITEST> {
    const META: Meta =
        Meta::oxlint(jest::plugin(VITEST), "prefer-expect-assertions", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferExpectAssertions(PreferExpectAssertionsConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx, VITEST);
    }
}
