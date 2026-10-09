use crate::unicorn::unnecessary_length_or_infinity_argument;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows passing `.length` or `Infinity` as the `deleteCount` or `skipCount` argument of `Array#splice()` or
/// `Array#toSpliced()`.
pub struct NoUnnecessaryArraySpliceCount;

const UNNECESSARY_ARGUMENT: Message =
    Message::new("", "Passing `{{arg_str}}` as the `deleteCount` argument is unnecessary.");
const METHODS: &[&str] = &["splice", "toSpliced"];

impl Rule for NoUnnecessaryArraySpliceCount {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-unnecessary-array-splice-count", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryArraySpliceCount
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
