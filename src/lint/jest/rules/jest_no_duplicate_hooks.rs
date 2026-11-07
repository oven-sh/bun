use crate::jest::{self, Ctx, Runner};
use crate::jest_hooks::{mentions_hook, no_duplicate_hooks};
use bun_lint::prelude::*;

/// Disallows duplicate hooks in describe blocks.
pub struct NoDuplicateHooks<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoDuplicateHooks<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-duplicate-hooks", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateHooks
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && mentions_hook(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_duplicate_hooks::run_once(&ctx);
    }
}
