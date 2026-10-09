use bun_lint_oxlint::ast_util::is_method_call;
use bun_lint_oxlint::text::find_next_token_within;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow magic numbers for `Array.prototype.flat` depth.
pub struct NoMagicArrayFlatDepth;

const NO_MAGIC_ARRAY_FLAT_DEPTH: Message =
    Message::new("", "Magic number for `Array.prototype.flat` depth is not allowed.");

impl Rule for NoMagicArrayFlatDepth {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-magic-array-flat-depth", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMagicArrayFlatDepth
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("flat") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| !it.is_optional()) else {
                return;
            };
            let Some(depth) = call.args().first() else {
                return;
            };
            if !matches!(depth.kind(), ExprKind::Number(n) if (n - 1.0).abs() >= f64::EPSILON)
                || !is_method_call(call, None, Some(&["flat"]), Some(1), Some(1))
            {
                return;
            }
            // A comment between the parentheses explains the number.
            let (file, call_end) = (cx.file(), e.span().end);
            if let Some(open_paren) = find_next_token_within(file, Span::after(call.callee().outer_span(), call_end), b"(")
                && file.comments_in(Span::new(open_paren, call_end)).next().is_none()
            {
                cx.report(depth, NO_MAGIC_ARRAY_FLAT_DEPTH);
            }
        });
    }
}
