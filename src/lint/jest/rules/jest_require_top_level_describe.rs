use crate::jest::{self, Ctx};
use crate::jest_tests::require_top_level_describe;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires test cases and hooks to be inside a top-level `describe` block.
pub struct RequireTopLevelDescribe(u32);

impl Rule for RequireTopLevelDescribe {
    const META: Meta = Meta::oxlint(Plugin::Jest, "require-top-level-describe", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireTopLevelDescribe(require_top_level_describe::max_number_of_top_level_describes(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                require_top_level_describe::run_once(rule.0, &ctx);
            });
        }
    }
}
