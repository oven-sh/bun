use crate::jest::{self, Ctx};
use crate::jest_hooks::{mentions_hook, no_duplicate_hooks};
use bun_lint::prelude::*;

/// Disallows duplicate hooks in describe blocks.
pub struct NoDuplicateHooks<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoDuplicateHooks<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-duplicate-hooks", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateHooks
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        mentions_hook(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_duplicate_hooks::run_once(&ctx);
    }
}
