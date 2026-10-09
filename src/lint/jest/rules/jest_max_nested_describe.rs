use crate::jest::{self, Ctx};
use crate::jest_tests::max_nested_describe;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces a maximum depth to nested `describe()` calls.
pub struct MaxNestedDescribe(u32);

impl Rule for MaxNestedDescribe {
    const META: Meta = Meta::oxlint(Plugin::Jest, "max-nested-describe", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxNestedDescribe(jest::max_of(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                max_nested_describe::run_once(rule.0, &ctx);
            });
        }
    }
}
