use crate::jest::Ctx;
use crate::jest_tests::prefer_each;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces using `each` rather than manual loops.
pub struct PreferEach;

impl Rule for PreferEach {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-each", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferEach
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if prefer_each::should_run(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                prefer_each::run_once(&ctx);
            });
        }
    }
}
