use crate::unicorn::{UnnecessaryArgument, unnecessary_length_or_infinity_argument};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows passing `.length` or `Infinity` as the `deleteCount` or `skipCount` argument of `Array#splice()` or
/// `Array#toSpliced()`. With `SLICE`: as the second argument of `slice(...)`.
pub struct NoUnnecessaryArraySpliceCount<const SLICE: bool = false>;

const DELETE_COUNT: Message = Message::new("", "Passing `{{arg_str}}` as the `deleteCount` argument is unnecessary.");
const END: Message = Message::new("", "Passing `{{arg_str}}` as the `end` argument is unnecessary.");

impl<const SLICE: bool> NoUnnecessaryArraySpliceCount<SLICE> {
    const METHODS: &[&str] = if SLICE { &["slice"] } else { &["splice", "toSpliced"] };
}

impl<const SLICE: bool> Rule for NoUnnecessaryArraySpliceCount<SLICE> {
    const META: Meta = Meta::oxlint(
        Plugin::Unicorn,
        if SLICE { "no-unnecessary-slice-end" } else { "no-unnecessary-array-splice-count" },
        Kind::Suggestion,
    )
    .fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryArraySpliceCount
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(Self::METHODS).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && let Some(argument) = unnecessary_length_or_infinity_argument(call, Self::METHODS)
        {
            let UnnecessaryArgument { first, second, arg_str } = argument;
            cx.report(second.outer_span(), if SLICE { END } else { DELETE_COUNT })
                .data("arg_str", arg_str)
                .fix(|fixer| fixer.remove(Span::after(first.outer_span(), second.outer_span().end)));
        }
    }
}
