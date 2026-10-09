use crate::jest::Ctx;
use crate::jest_mocks::prefer_spy_on;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// When mocking a function by overwriting a property you have to manually restore the original implementation when cleaning
/// up.
pub struct PreferSpyOn;

impl Rule for PreferSpyOn {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-spy-on", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSpyOn
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if prefer_spy_on::should_run(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                prefer_spy_on::run_once(&ctx);
            });
        }
    }
}
