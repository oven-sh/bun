use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::valid_describe_callback;
use bun_lint::prelude::*;

/// Enforce that the second argument to `describe()` is a valid callback function.
pub struct ValidDescribeCallback<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for ValidDescribeCallback<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "valid-describe-callback", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidDescribeCallback
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_describe(file) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &valid_describe_callback::run);
    }
}
