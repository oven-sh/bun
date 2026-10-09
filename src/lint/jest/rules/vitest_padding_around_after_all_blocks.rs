use crate::jest::{self, Ctx};
use crate::jest_tests::padding_around_blocks;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces a line of padding before and after 1 or more `afterAll` statements.
pub struct PaddingAroundAfterAllBlocks;

impl Rule for PaddingAroundAfterAllBlocks {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "padding-around-after-all-blocks", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PaddingAroundAfterAllBlocks
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions("afterAll") {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                padding_around_blocks::run(&ctx, false);
            });
        }
    }
}
