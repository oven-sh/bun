use crate::jest::{self, Ctx};
use crate::jest_hooks::no_duplicate_hooks;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows duplicate hooks in describe blocks.
pub struct NoDuplicateHooks;

impl Rule for NoDuplicateHooks {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-duplicate-hooks", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateHooks
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_duplicate_hooks::run_once(&ctx);
            });
        }
    }
}
