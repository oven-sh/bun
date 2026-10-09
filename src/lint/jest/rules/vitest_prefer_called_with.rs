use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_called_with;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Suggest using `toBeCalledWith()` or `toHaveBeenCalledWith()`
pub struct PreferCalledWith;

impl Rule for PreferCalledWith {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-called-with", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledWith
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions_any(&["toBeCalled", "toHaveBeenCalled"]) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &prefer_called_with::run);
            });
        }
    }
}
