use crate::jest::{self, Ctx};
use crate::jest_tests::require_top_level_describe;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires test cases and hooks to be inside a top-level `describe` block.
pub struct RequireTopLevelDescribe(u32);

impl Rule for RequireTopLevelDescribe {
    const META: Meta = Meta::oxlint(Plugin::Jest, "require-top-level-describe", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireTopLevelDescribe(require_top_level_describe::max_number_of_top_level_describes(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        require_top_level_describe::run_once(self.0, &ctx);
    }
}
