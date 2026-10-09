use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_have_length;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// In order to have a better failure message, `toHaveLength()` should be used upon asserting expectations on objects length
/// property.
pub struct PreferToHaveLength;

impl Rule for PreferToHaveLength {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-to-have-length", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToHaveLength
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions("length") {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &prefer_to_have_length::run);
            });
        }
    }
}
