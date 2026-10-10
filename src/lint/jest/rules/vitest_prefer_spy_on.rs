use crate::jest::Ctx;
use crate::jest_mocks::prefer_spy_on;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// When mocking a function by overwriting a property you have to manually restore the original implementation when cleaning
/// up.
pub struct PreferSpyOn;

impl Rule for PreferSpyOn {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-spy-on", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSpyOn
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        prefer_spy_on::should_run(file).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_spy_on::run_once(&ctx);
    }
}
