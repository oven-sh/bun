use bun_lint_oxlint::regex_flags::method_called_without_global_flag;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warn when `matchAll`, or `replaceAll`, is called with a non-global regular expression.
pub struct BadAllArg<const REPLACE: bool = false>;

/// The rule, the method, the message, the label.
const TEXTS: [[&str; 4]; 2] = [
    [
        "bad-match-all-arg",
        "matchAll",
        "Global flag (g) is missing in the regular expression supplied to the `matchAll` method.",
        "`matchAll` called here",
    ],
    [
        "bad-replace-all-arg",
        "replaceAll",
        "Global flag (g) is missing in the regular expression supplied to the `replaceAll` method.",
        "`replaceAll` called here",
    ],
];

impl<const REPLACE: bool> Rule for BadAllArg<REPLACE> {
    const META: Meta = Meta::oxlint(Plugin::Oxc, TEXTS[REPLACE as usize][0], Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions(TEXTS[REPLACE as usize][1]).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let [_, method, message, called_here] = TEXTS[REPLACE as usize];
        if let Some((called, regex)) = method_called_without_global_flag(e, method) {
            cx.report(called, Message::new("", message)).first_label(called_here).label(regex, "RegExp supplied here");
        }
    }
}
