use crate::jest::Ctx;
use crate::jest_tests::prefer_each;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces using `each` rather than manual loops.
pub struct PreferEach;

impl Rule for PreferEach {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-each", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferEach
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        prefer_each::should_run(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_each::run_once(&ctx);
    }
}
