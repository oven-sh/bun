use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_strict_equal;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers a warning if `toEqual()` is used to assert equality.
pub struct PreferStrictEqual;

impl Rule for PreferStrictEqual {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-strict-equal", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStrictEqual
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions("toEqual") {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &prefer_strict_equal::run);
            });
        }
    }
}
