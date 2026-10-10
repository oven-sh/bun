use crate::jest::{self, Ctx};
use crate::jest_tests::max_nested_describe;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces a maximum depth to nested `describe()` calls.
pub struct MaxNestedDescribe(u32);

impl Rule for MaxNestedDescribe {
    const META: Meta = Meta::oxlint(Plugin::Jest, "max-nested-describe", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxNestedDescribe(jest::max_of(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        max_nested_describe::run_once(self.0, &ctx);
    }
}
