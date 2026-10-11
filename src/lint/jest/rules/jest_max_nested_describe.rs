use crate::jest::{self, Ctx};
use crate::jest_tests::max_nested_describe;
use bun_lint::prelude::*;

/// This rule enforces a maximum depth to nested `describe()` calls.
pub struct MaxNestedDescribe<const VITEST: bool = false>(u32);

impl<const VITEST: bool> Rule for MaxNestedDescribe<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "max-nested-describe", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxNestedDescribe(jest::max_of(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::mentions_describe(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        max_nested_describe::run_once(self.0, &ctx);
    }
}
