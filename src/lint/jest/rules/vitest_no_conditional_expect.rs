use crate::jest::{self, Ctx};
use crate::jest_expect::no_conditional_expect;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule prevents the use of `expect` in conditional blocks, such as `if` and `catch`.
pub struct NoConditionalExpect;

impl Rule for NoConditionalExpect {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-conditional-expect", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalExpect
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_conditional_expect::run(&ctx);
            });
        }
    }
}
