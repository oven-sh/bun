use crate::jest::{self, Ctx};
use crate::jest_expect::valid_expect_in_promise;
use bun_lint::prelude::*;

/// Ensures that `expect` calls inside promise chains (`.then()`, `.catch()`, `.finally()`) are properly awaited or returned
/// from the test.
pub struct ValidExpectInPromise<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for ValidExpectInPromise<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "valid-expect-in-promise", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidExpectInPromise
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.find_name("expect").is_some() && file.mentions_any(&["then", "catch", "finally"]) && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &valid_expect_in_promise::run);
    }
}
