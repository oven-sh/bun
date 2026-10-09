use bun_lint_oxlint::regex_flags::method_called_without_global_flag;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule warns when the `replaceAll` method is called with a regular expression that does not have the global flag (g).
pub struct BadReplaceAllArg;

const BAD_REPLACE_ALL_ARG: Message =
    Message::new("", "Global flag (g) is missing in the regular expression supplied to the `replaceAll` method.");

impl Rule for BadReplaceAllArg {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-replace-all-arg", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BadReplaceAllArg
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("replaceAll") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(replace_all) = method_called_without_global_flag(e, "replaceAll") {
                cx.report(replace_all, BAD_REPLACE_ALL_ARG);
            }
        });
    }
}
