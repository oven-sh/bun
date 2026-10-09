use crate::jest::{self, Ctx};
use crate::jest_expect::valid_expect_in_promise;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensures that `expect` calls inside promise chains (`.then()`, `.catch()`, `.finally()`) are properly awaited or returned
/// from the test.
pub struct ValidExpectInPromise;

impl Rule for ValidExpectInPromise {
    const META: Meta = Meta::oxlint(Plugin::Jest, "valid-expect-in-promise", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidExpectInPromise
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) && file.mentions_any(&["then", "catch", "finally"]) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &valid_expect_in_promise::run);
            });
        }
    }
}
