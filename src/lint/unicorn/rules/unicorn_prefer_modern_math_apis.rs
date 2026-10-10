use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, plain, static_property_name};
use bun_lint_oxlint::same_expression::is_same_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};

/// Checks for usage of legacy patterns for mathematical operations.
pub struct PreferModernMathApis;

const PREFER_MATH_ABS: Message = Message::new("", "Prefer `Math.abs(x)` over alternatives");
const PREFER_MATH_HYPOT: Message = Message::new("", "Prefer `Math.hypot(…)` over alternatives");
const PREFER_MATH_LOG_N: Message = Message::new("", "Prefer `Math.{{good_method}}(x)` over `{{bad_method}}`");

impl Rule for PreferModernMathApis {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-modern-math-apis", Kind::Suggestion);
    const ON: On = On::new().binaries(&[BinOp::Mul, BinOp::Div]).exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferModernMathApis
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions("log") && file.mentions_any(&["LN10", "LN2", "LOG10E", "LOG2E"]) {
            on = on.binaries(&[BinOp::Mul, BinOp::Div]);
        }
        if file.mentions("sqrt") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("Math") {
            return None;
        }
        Some(())
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        check_prefer_log(e, left, right, cx);
        if op == BinOp::Mul {
            check_prefer_log(e, right, left, cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(arg) = e.as_call().and_then(|it| argument_of_math_method(it, "sqrt")) else {
            return;
        };
        // `a * a + b ** 2 + ..`
        let mut count = 0;
        let mut pending: SmallVec<[Expr; 8]> = smallvec![arg];
        while let Some(expression) = pending.pop() {
            match expression.kind() {
                ExprKind::Binary { op: BinOp::Add, left, right } => pending.extend([left, right]),
                _ if is_pow_2_expression(expression) => count += 1,
                _ => return,
            }
        }
        cx.report(e, if count == 1 { PREFER_MATH_ABS } else { PREFER_MATH_HYPOT });
    }
}

fn is_math(member_expr: Expr) -> bool {
    member_expr.object().is_some_and(|it| get_inner_expression(it).is_ident("Math"))
}

/// The `a` of `Math.method(a)`.
fn argument_of_math_method<'a>(call_expr: Call<'a>, method: &str) -> Option<Expr<'a>> {
    let member_expr = as_member_expression(call_expr.callee())?;
    (call_expr.args().len() == 1 && static_property_name(member_expr)?.is(method) && is_math(member_expr))
        .then(|| call_expr.args().first().filter(|it| it.tag() != ExprTag::Spread))?
}

/// `Math.log(x) * Math.LOG10E`, `Math.log(x) / Math.LN10`
fn check_prefer_log<'a>(e: Expr<'a>, log: Expr<'a>, constant: Expr<'a>, cx: &Cx<'a, PreferModernMathApis>) {
    if plain(log).and_then(Expr::as_call).and_then(|it| argument_of_math_method(it, "log")).is_some()
        && let Some(member_expr) = as_member_expression(constant).filter(|it| is_math(*it))
        && let Some(good_method) = match static_property_name(member_expr).map(Name::bytes) {
            Some(b"LN2" | b"LOG2E") => Some("log2"),
            Some(b"LN10" | b"LOG10E") => Some("log10"),
            _ => None,
        }
    {
        cx.report(e, PREFER_MATH_LOG_N).data("good_method", good_method).data("bad_method", clean_string(e.text()));
    }
}

/// `a ** 2`, `a * a`
fn is_pow_2_expression(expression: Expr) -> bool {
    match expression.kind() {
        ExprKind::Binary { op: BinOp::Pow, right, .. } => {
            matches!(right.kind(), ExprKind::Number(value) if (value - 2.0).abs() < f64::EPSILON)
        }
        ExprKind::Binary { op: BinOp::Mul, left, right } => {
            !left.is_parenthesized() && !right.is_parenthesized() && is_same_expression(left, right)
        }
        _ => false,
    }
}

/// On one line, with one blank where there are many.
fn clean_string(input: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(input.len());
    let mut prev_char = b' ';
    for c in input.iter().filter(|it| **it != b'\n') {
        let current_char = if *c == b'\t' { b' ' } else { *c };
        if current_char != b' ' || prev_char != b' ' {
            result.push(current_char);
        }
        prev_char = current_char;
    }
    result
}
