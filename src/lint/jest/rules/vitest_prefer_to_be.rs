use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_be;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Recommends using `toBe` matcher for primitive literals and specific matchers for `null`, `undefined`, and `NaN`.
pub struct PreferToBe;

impl Rule for PreferToBe {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-to-be", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToBe
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &prefer_to_be::run);
            });
        }
    }
}
