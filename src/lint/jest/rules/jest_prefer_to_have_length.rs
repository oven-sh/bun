use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_have_length;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// In order to have a better failure message, `toHaveLength()` should be used upon asserting expectations on objects length
/// property.
pub struct PreferToHaveLength;

impl Rule for PreferToHaveLength {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-to-have-length", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToHaveLength
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (jest::is_test(file) && file.mentions("length")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_have_length::run);
    }
}
