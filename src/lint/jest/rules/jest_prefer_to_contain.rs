use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_contain;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// In order to have a better failure message, `toContain()` should be used upon asserting expectations on an array containing
/// an object.
pub struct PreferToContain;

impl Rule for PreferToContain {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-to-contain", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToContain
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions("includes") {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &prefer_to_contain::run);
            });
        }
    }
}
