use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_called_with;
use bun_lint::prelude::*;

/// Suggest using `toBeCalledWith()` or `toHaveBeenCalledWith()`
pub struct PreferCalledWith<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferCalledWith<VITEST> {
    const META: Meta =
        Meta::oxlint(jest::plugin(VITEST), "prefer-called-with", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledWith
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toBeCalled", "toHaveBeenCalled"]) }) && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_called_with::run);
    }
}
