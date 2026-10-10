use crate::jest::{self, Ctx};
use crate::jest_hooks::no_duplicate_hooks;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows duplicate hooks in describe blocks.
pub struct NoDuplicateHooks;

impl Rule for NoDuplicateHooks {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-duplicate-hooks", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateHooks
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_duplicate_hooks::run_once(&ctx);
    }
}
