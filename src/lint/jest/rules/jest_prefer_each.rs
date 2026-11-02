use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::prefer_each;
use bun_lint::prelude::*;

/// This rule enforces using `each` rather than manual loops.
pub struct PreferEach<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferEach<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-each", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferEach
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && prefer_each::should_run(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        prefer_each::run_once(&ctx);
    }
}
