use crate::jest::{self, Ctx};
use crate::jest_matchers::no_alias_methods;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces Jest's canonical matcher names instead of aliases.
pub struct NoAliasMethods;

impl Rule for NoAliasMethods {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-alias-methods", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAliasMethods
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions_any(&no_alias_methods::ALIASES)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_alias_methods::run);
    }
}
