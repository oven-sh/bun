use crate::jest::{self, Ctx};
use crate::jest_expect::no_conditional_expect;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule prevents the use of `expect` in conditional blocks, such as `if` and `catch`.
pub struct NoConditionalExpect;

impl Rule for NoConditionalExpect {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-conditional-expect", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalExpect
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_conditional_expect::run(&ctx);
    }
}
