use crate::jest::{self, Ctx};
use crate::jest_tests::consistent_test_it::ConsistentTestItConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent use of either the `it` or `test` keyword for defining tests.
pub struct ConsistentTestIt(ConsistentTestItConfig);

impl Rule for ConsistentTestIt {
    const META: Meta = Meta::oxlint(Plugin::Jest, "consistent-test-it", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentTestIt(ConsistentTestItConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
