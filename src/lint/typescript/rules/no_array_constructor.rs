use bun_lint::prelude::*;
use bun_lint_eslint::rules::no_array_constructor::{
    as_array_call, get_arguments_text, is_reported_by_oxlint, replace_as_oxlint,
};

/// Disallow generic `Array` constructors.
pub struct NoArrayConstructor;

const USE_LITERAL: Message = Message::new(
    "useLiteral",
    "The array literal notation [] is preferable.",
);

impl Rule for NoArrayConstructor {
    const META: Meta = Meta::typescript("no-array-constructor", Kind::Suggestion)
        .fixable(Fixable::Code)
        .recommended()
        .extends_base_rule("no-array-constructor");
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoArrayConstructor
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("Array") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = as_array_call(e) else {
            return;
        };
        let is_reported = match cx.language().is_oxlint {
            true => is_reported_by_oxlint(call),
            false => call.args().len() != 1,
        };
        if !is_reported {
            return;
        }
        cx.report(e, USE_LITERAL).fix(|fixer| match fixer.file().language().is_oxlint {
            true => replace_as_oxlint(fixer, e, call),
            false => Some(fixer.replace(e, [&b"["[..], get_arguments_text(e, call), b"]"].concat())),
        });
    }
}
