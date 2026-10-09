use bun_lint_oxlint::ast_util::{as_member_expression, get_member_expr, static_property_info};
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow using `length` as the end argument of a `slice` call.
pub struct NoLengthAsSliceEnd;

const NO_LENGTH_AS_SLICE_END: Message =
    Message::new("", "Passing `length` as the end argument of a `slice` call is unnecessary.");

impl Rule for NoLengthAsSliceEnd {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-length-as-slice-end", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLengthAsSliceEnd
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("slice") || !file.mentions("length") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(call_expr) = e.as_call()
                && call_expr.args().len() == 2
                && !call_expr.is_optional()
                && let (Some(first), Some(second)) = (call_expr.args().first(), call_expr.args().get(1))
                && first.tag() != ExprTag::Spread
                && let Some(second_argument) = get_member_expr(second)
                && let ExprKind::Dot { obj: object_of_length, name, .. } = second_argument.kind()
                && name.name().is("length")
                // oxlint panics if the callee is in parentheses.
                && let Some(callee) = as_member_expression(call_expr.callee())
                && let Some((call_span, method)) = static_property_info(callee)
                && method.is("slice")
                && let Some(object) = callee.object()
                && !object.is_parenthesized()
                && !object_of_length.is_parenthesized()
                && is_same_expression(object, object_of_length)
            {
                let span = Span::new(first.outer_span().end, second.outer_span().end);
                cx.report(call_span, NO_LENGTH_AS_SLICE_END)
                    .first_label("`.slice` called here.")
                    .label(second_argument, "Invalid argument here")
                    .fix(|fixer| fixer.remove(span));
            }
        });
    }
}
