use crate::jest::Ctx;
use crate::jest_hooks::{HOOKS, prefer_hooks_in_order};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensures that hooks are in the order that they are called in.
pub struct PreferHooksInOrder;

impl Rule for PreferHooksInOrder {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-hooks-in-order", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferHooksInOrder
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions_any(&HOOKS) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                prefer_hooks_in_order::run_once(&ctx);
            });
        }
    }
}
