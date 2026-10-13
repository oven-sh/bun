use crate::jest::{self, Ctx, Runner};
use crate::jest_expect::valid_expect_in_promise;
use bun_lint::prelude::*;

/// Ensures that `expect` calls inside promise chains (`.then()`, `.catch()`, `.finally()`) are properly awaited or returned
/// from the test.
pub struct ValidExpectInPromise<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for ValidExpectInPromise<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "valid-expect-in-promise", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidExpectInPromise
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.find_name("expect").is_some() && file.mentions_any(&["then", "catch", "finally"]) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &valid_expect_in_promise::run);
    }
}
