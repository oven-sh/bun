use crate::unicorn::unnecessary_length_or_infinity_argument;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows unnecessarily passing a second argument to `slice(...)`, for cases where it would not change the result.
pub struct NoUnnecessarySliceEnd;

const UNNECESSARY_ARGUMENT: Message = Message::new("", "Passing `{{arg_str}}` as the `end` argument is unnecessary.");
const METHODS: &[&str] = &["slice"];

impl Rule for NoUnnecessarySliceEnd {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-unnecessary-slice-end", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessarySliceEnd
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(METHODS) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(call) = e.as_call()
                && let Some((first, second, arg_str)) = unnecessary_length_or_infinity_argument(call, METHODS)
            {
                cx.report(second.outer_span(), UNNECESSARY_ARGUMENT)
                    .data("arg_str", arg_str)
                    .fix(|fixer| fixer.remove(Span::after(first.outer_span(), second.outer_span().end)));
            }
        });
    }
}
