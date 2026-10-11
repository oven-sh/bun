use crate::jest::{self, Ctx};
use crate::jest_matchers::require_to_throw_message;
use bun_lint::prelude::*;

/// This rule triggers a warning if `toThrow()` or `toThrowError()` is used without an error message.
pub struct RequireToThrowMessage<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for RequireToThrowMessage<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "require-to-throw-message", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireToThrowMessage
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toThrow", "toThrowError"]) }) && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &require_to_throw_message::run);
    }
}
