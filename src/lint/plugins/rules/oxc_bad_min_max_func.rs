use bun_lint_oxlint::ast_util::{get_member_expr, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks whether the clamp function `Math.min(Math.max(x, y), z)` always evaluates to a constant result because the arguments are
/// in the wrong order.
pub struct BadMinMaxFunc;

const BAD_MIN_MAX_FUNC: Message = Message::new("", "Math.min and Math.max combination leads to constant result");

impl Rule for BadMinMaxFunc {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-min-max-func", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BadMinMaxFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Math") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call() else {
                return;
            };
            let Some(out_min_max) = min_max(call) else {
                return;
            };
            // An optional chain is not a call for oxlint.
            let inner_calls = call.args().iter().filter(|it| !it.is_parenthesized() && it.chain() == Chain::No).filter_map(Expr::as_call);
            for inner_min_max in inner_calls.filter_map(min_max) {
                let is_constant = match (&out_min_max, &inner_min_max) {
                    (MinMax::Max(max), MinMax::Min(min)) => max > min,
                    (MinMax::Min(min), MinMax::Max(max)) => min < max,
                    _ => false,
                };
                if is_constant {
                    cx.report(e, BAD_MIN_MAX_FUNC);
                }
            }
        });
    }
}

enum MinMax {
    Min(f64),
    Max(f64),
}

/// Whether `Math.min` or `Math.max` is called, and the result for the arguments that are numbers.
fn min_max(call: Call) -> Option<MinMax> {
    let member = get_member_expr(call.callee())?;
    if !member.object().is_some_and(|object| object.is_ident("Math") && !object.is_parenthesized()) {
        return None;
    }
    let number_args = call.args().iter().filter(|it| !it.is_parenthesized()).filter_map(|it| match it.kind() {
        ExprKind::Number(value) => Some(value),
        _ => None,
    });
    match static_property_name(member)?.bytes() {
        b"max" => Some(MinMax::Max(number_args.fold(f64::NEG_INFINITY, f64::max))),
        b"min" => Some(MinMax::Min(number_args.fold(f64::INFINITY, f64::min))),
        _ => None,
    }
}
