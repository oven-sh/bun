use crate::jest::{self, Ctx};
use crate::jest_expect::max_expects;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule enforces a maximum number of `expect()` calls in a single test.
pub struct MaxExpects(u32);

impl Rule for MaxExpects {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "max-expects", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxExpects(jest::max_of(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("expect").then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        max_expects::run_once(self.0, &ctx);
    }
}
