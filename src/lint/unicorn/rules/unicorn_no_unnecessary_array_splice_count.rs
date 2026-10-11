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
    const ON: On = On::new().method_calls(Self::METHODS);
    /// The first and the last of the methods.
    type State<'a> = [Name<'a>; 2];

    fn new(_: &Options) -> Self {
        NoUnnecessaryArraySpliceCount
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let methods = [Self::METHODS.first(), Self::METHODS.last()];
        let has_any = Self::METHODS.iter().any(|it| file.find_name(it).is_some());
        has_any.then(|| methods.map(|it| file.name_of(it.copied().unwrap_or_default())))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && call.args().len() == 2
            && call.callee().member_name().is_some_and(|it| cx.state.contains(&it.name()))
            && let Some(argument) = unnecessary_length_or_infinity_argument(call, Self::METHODS)
        {
            let UnnecessaryArgument { first, second, arg_str } = argument;
            cx.report(second.outer_span(), if SLICE { END } else { DELETE_COUNT })
                .data("arg_str", arg_str)
                .fix(|fixer| fixer.remove(Span::after(first.outer_span(), second.outer_span().end)));
        }
    }
}
