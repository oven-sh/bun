use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::no_alias_methods;
use bun_lint::prelude::*;

/// Enforces Jest's canonical matcher names instead of aliases.
pub struct NoAliasMethods<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoAliasMethods<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-alias-methods", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAliasMethods
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(no_alias_methods::ALIASES) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_alias_methods::run);
    }
}
