use crate::jest::{self, Ctx};
use crate::jest_tests::padding_around_blocks;
use bun_lint::prelude::*;

/// This rule enforces a line of padding before and after 1 or more `afterAll` statements.
pub struct PaddingAroundAfterAllBlocks<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PaddingAroundAfterAllBlocks<VITEST> {
    const META: Meta =
        Meta::oxlint(jest::plugin(VITEST), "padding-around-after-all-blocks", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PaddingAroundAfterAllBlocks
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("afterAll") && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        padding_around_blocks::run(&ctx, false);
    }
}
