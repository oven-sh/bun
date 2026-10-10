use crate::unicorn::{UnnecessaryArgument, unnecessary_length_or_infinity_argument};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows unnecessarily passing a second argument to `slice(...)`, for cases where it would not change the result.
pub struct NoUnnecessarySliceEnd;

const UNNECESSARY_ARGUMENT: Message = Message::new("", "Passing `{{arg_str}}` as the `end` argument is unnecessary.");
const METHODS: &[&str] = &["slice"];

impl Rule for NoUnnecessarySliceEnd {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-unnecessary-slice-end", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessarySliceEnd
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions_any(METHODS) {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && let Some(argument) = unnecessary_length_or_infinity_argument(call, METHODS)
        {
            let UnnecessaryArgument { first, second, arg_str } = argument;
            cx.report(second.outer_span(), UNNECESSARY_ARGUMENT)
                .data("arg_str", arg_str)
                .fix(|fixer| fixer.remove(Span::after(first.outer_span(), second.outer_span().end)));
        }
    }
}
