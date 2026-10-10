use crate::jest::{self, Ctx};
use crate::jest_tests::valid_describe_callback;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that the second argument to `describe()` is a valid callback function.
pub struct ValidDescribeCallback;

impl Rule for ValidDescribeCallback {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "valid-describe-callback", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ValidDescribeCallback
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| valid_describe_callback::run(node, ctx, true));
    }
}
