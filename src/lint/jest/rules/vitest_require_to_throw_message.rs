use crate::jest::{self, Ctx};
use crate::jest_matchers::require_to_throw_message;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers a warning if `toThrow()` or `toThrowError()` is used without an error message.
pub struct RequireToThrowMessage;

impl Rule for RequireToThrowMessage {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-to-throw-message", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireToThrowMessage
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions_any(&["toThrow", "toThrowError"]) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &require_to_throw_message::run);
            });
        }
    }
}
