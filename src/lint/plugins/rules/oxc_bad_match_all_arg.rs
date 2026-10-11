use bun_lint_oxlint::regex_flags::method_called_without_global_flag;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warn when `matchAll`, or `replaceAll`, is called with a non-global regular expression.
pub struct BadAllArg<const REPLACE: bool = false>;

/// The rule, the method, the label.
const TEXTS: [[&str; 3]; 2] = [
    ["bad-match-all-arg", "matchAll", "`matchAll` called here"],
    ["bad-replace-all-arg", "replaceAll", "`replaceAll` called here"],
];
const MESSAGES: [Message; 2] = [
    Message::new("", "Global flag (g) is missing in the regular expression supplied to the `matchAll` method."),
    Message::new("", "Global flag (g) is missing in the regular expression supplied to the `replaceAll` method."),
];

impl<const REPLACE: bool> Rule for BadAllArg<REPLACE> {
    const META: Meta = Meta::oxlint(Plugin::Oxc, TEXTS[REPLACE as usize][0], Kind::Problem);
    const ON: On = On::new().method_calls(&[TEXTS[REPLACE as usize][1]]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions(TEXTS[REPLACE as usize][1]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let [_, method, called_here] = TEXTS[REPLACE as usize];
        if let Some((called, regex)) = method_called_without_global_flag(e, method) {
            cx.report(called, MESSAGES[REPLACE as usize]).first_label(called_here).label(regex, "RegExp supplied here");
        }
    }
}
