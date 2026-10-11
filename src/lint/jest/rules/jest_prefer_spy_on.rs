use crate::jest::{self, Ctx};
use crate::jest_mocks::prefer_spy_on;
use bun_lint::prelude::*;

/// When mocking a function by overwriting a property you have to manually restore the original implementation when cleaning
/// up.
pub struct PreferSpyOn<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferSpyOn<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "prefer-spy-on", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSpyOn
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        prefer_spy_on::should_run(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_spy_on::run_once(&ctx);
    }
}
