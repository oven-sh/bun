use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::padding_around_blocks;
use bun_lint::prelude::*;

/// This rule enforces a line of padding before and after 1 or more `afterAll` statements.
pub struct PaddingAroundAfterAllBlocks<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PaddingAroundAfterAllBlocks<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "padding-around-after-all-blocks", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PaddingAroundAfterAllBlocks
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("afterAll") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        padding_around_blocks::run(&ctx, false);
    }
}
