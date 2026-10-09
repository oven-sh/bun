use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, is_method_call, static_property_info};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows passing `1` to `Array.prototype.flat`.
pub struct NoUnnecessaryArrayFlatDepth;

const UNNECESSARY_DEPTH: Message = Message::new("", "Passing `1` as the `depth` argument is unnecessary.");
const REMOVE_ARGUMENT: Message = Message::new("", "Remove the argument");

impl Rule for NoUnnecessaryArrayFlatDepth {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-unnecessary-array-flat-depth", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnnecessaryArrayFlatDepth
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("flat") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| !it.is_optional()) else {
                return;
            };
            let Some(depth) = call.args().first().map(get_inner_expression) else {
                return;
            };
            if !matches!(depth.kind(), ExprKind::Number(n) if (n - 1.0).abs() < f64::EPSILON)
                || !is_method_call(call, None, Some(&["flat"]), Some(1), Some(1))
            {
                return;
            }
            let property = as_member_expression(call.callee()).and_then(static_property_info);
            let span = property.map_or_else(|| e.span(), |it| it.0);
            cx.report(span, UNNECESSARY_DEPTH).suggest(REMOVE_ARGUMENT, |fixer| {
                fixer.remove(Span::new(depth.span().start, e.span().end.saturating_sub(1)))
            });
        });
    }
}
