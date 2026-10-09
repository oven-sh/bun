use bun_lint_oxlint::ast_util::{get_member_expr, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks whether the radix or precision arguments of number-related functions exceed the limit.
pub struct NumberArgOutOfRange;

const NUMBER_ARG_OUT_OF_RANGE: Message =
    Message::new("", "Radix or precision arguments of number-related functions should not exceed the limit");

impl Rule for NumberArgOutOfRange {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "number-arg-out-of-range", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NumberArgOutOfRange
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["toString", "toFixed", "toExponential", "toPrecision"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call() else {
                return;
            };
            let Some(literal) = call.args().first().filter(|it| it.tag() == ExprTag::Number && !it.is_parenthesized()) else {
                return;
            };
            let (ExprKind::Number(value), Some(name)) = (literal.kind(), get_member_expr(call.callee()).and_then(static_property_name))
            else {
                return;
            };
            let (min, max): (u8, u8) = match name.bytes() {
                b"toString" => (2, 36),
                b"toFixed" | b"toExponential" => (0, 20),
                b"toPrecision" => (1, 21),
                _ => return,
            };
            if !(f64::from(min)..=f64::from(max)).contains(&value) {
                cx.report(e, NUMBER_ARG_OUT_OF_RANGE).data("method_name", name).data("min", min).data("max", max);
            }
        });
    }
}
