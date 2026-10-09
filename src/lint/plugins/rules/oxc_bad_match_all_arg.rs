use bun_lint_oxlint::regex_flags::method_called_without_global_flag;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warn when `matchAll` is called with a non-global regular expression.
pub struct BadMatchAllArg;

const BAD_MATCH_ALL_ARG: Message =
    Message::new("", "Global flag (g) is missing in the regular expression supplied to the `matchAll` method.");

impl Rule for BadMatchAllArg {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-match-all-arg", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BadMatchAllArg
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("matchAll") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some((match_all, regex)) = method_called_without_global_flag(e, "matchAll") {
                cx.report(match_all, BAD_MATCH_ALL_ARG)
                    .first_label("`matchAll` called here")
                    .label(regex, "RegExp supplied here");
            }
        });
    }
}
