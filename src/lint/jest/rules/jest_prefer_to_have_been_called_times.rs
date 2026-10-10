use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_have_been_called_times;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// In order to have a better failure message, [`toHaveBeenCalledTimes` should be used instead of directly checking the length
/// of
/// `mock.calls`](https://github.com/jest-community/eslint-plugin-jest/blob/v29.5.0/docs/rules/prefer-to-have-been-called-times.md).
pub struct PreferToHaveBeenCalledTimes;

impl Rule for PreferToHaveBeenCalledTimes {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-to-have-been-called-times", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToHaveBeenCalledTimes
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (jest::is_test(file) && file.mentions("toHaveLength") && file.mentions("calls")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_have_been_called_times::run);
    }
}
