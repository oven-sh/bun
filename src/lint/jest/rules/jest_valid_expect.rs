use crate::jest::{self, Ctx};
use crate::jest_expect::valid_expect::ValidExpectConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks that `expect()` is called correctly.
pub struct ValidExpect(ValidExpectConfig);

impl Rule for ValidExpect {
    const META: Meta = Meta::oxlint(Plugin::Jest, "valid-expect", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ValidExpect(ValidExpectConfig::new(options, false))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx);
            });
        }
    }
}
