use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{is_constant, is_ecmascript_global, is_literal, is_reference_to_global_variable};

/// Disallow expressions where the operation doesn't affect the value.
pub struct NoConstantBinaryExpression {
    check_relational_comparisons: bool,
}

const CONSTANT_BINARY_OPERAND: Message = Message::new(
    "constantBinaryOperand",
    "Unexpected constant binary expression. Compares constantly with the {{otherSide}}-hand side of the `{{operator}}`.",
);
const CONSTANT_SHORT_CIRCUIT: Message = Message::new(
    "constantShortCircuit",
    "Unexpected constant {{property}} on the left-hand side of a `{{operator}}` expression.",
);
const ALWAYS_NEW: Message = Message::new(
    "alwaysNew",
    "Unexpected comparison to newly constructed object. These two values can never be equal.",
);
const BOTH_ALWAYS_NEW: Message = Message::new(
    "bothAlwaysNew",
    "Unexpected comparison of two newly constructed objects. These two values can never be equal.",
);
const CONSTANT_RELATIONAL_COMPARISON: Message = Message::new(
    "constantRelationalComparison",
    "Unexpected constant relational comparison. Both sides of the `{{operator}}` are literal values.",
);

/// `e` is an identifier with one of `names` that refers to the global variable.
fn is_global(e: Expr<'_>, names: &[&str]) -> bool {
    e.as_ident().is_some_and(|name| name.is_any(names)) && is_reference_to_global_variable(e)
}

#[inline]
fn is_undefined(e: Expr<'_>) -> bool {
    is_global(e, &["undefined"])
}

/// A `CallExpression` whose callee is one of these global functions. An optional call is a
/// `ChainExpression` for ESLint.
fn is_call_of_global(call: Call<'_>, names: &[&str]) -> bool {
    call.chain() == Chain::No && is_global(call.callee(), names)
}

/// `Boolean()`, or `Boolean(x)` where the truthiness of `x` is constant.
fn is_constant_boolean_call(call: Call<'_>) -> bool {
    is_call_of_global(call, &["Boolean"]) && call.args().first().is_none_or(|it| is_constant(it, true))
}

/// ESLint's `isNullOrUndefined` of this rule, which knows that `undefined` can be redefined.
fn is_null_or_undefined(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => true,
        ExprKind::Ident(_) => is_undefined(e),
        _ => false,
    }
}

/// ESLint's `hasConstantNullishness`: `e` is always nullish or never. With `non_nullish`, never.
fn has_constant_nullishness(e: Expr<'_>, non_nullish: bool) -> bool {
    if non_nullish && is_null_or_undefined(e) {
        return false;
    }
    match e.kind() {
        ExprKind::Object(_)
        | ExprKind::Array(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::New(_)
        | ExprKind::Template(_)
        | ExprKind::Unary { .. } => true,
        ExprKind::Call(call) => is_call_of_global(call, &["Boolean", "String", "Number", "Symbol", "BigInt"]),
        ExprKind::Binary { op, right, .. } => match op {
            BinOp::Nullish => has_constant_nullishness(right, true),
            BinOp::And | BinOp::Or => false,
            BinOp::Comma => has_constant_nullishness(right, non_nullish),
            _ => true,
        },
        ExprKind::Assign { op, value, .. } => match op {
            None => has_constant_nullishness(value, non_nullish),
            Some(BinOp::And | BinOp::Or | BinOp::Nullish) => false,
            // A number or a string.
            Some(_) => true,
        },
        ExprKind::Ident(_) => is_undefined(e),
        _ => is_literal(e),
    }
}

/// ESLint's `isStaticBoolean`: `e` is a boolean that never changes.
fn is_static_boolean(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::True | ExprKind::False => true,
        ExprKind::Call(call) => is_constant_boolean_call(call),
        ExprKind::Unary { op: UnOp::Not, operand } => is_constant(operand, true),
        _ => false,
    }
}

/// ESLint's `hasConstantLooseBooleanComparison`: `e == true` always gives the same result.
fn has_constant_loose_boolean_comparison(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Object(_) | ExprKind::Class(_) | ExprKind::Fn(_) => true,
        // `[x]` could be `[0]` or `[1]`.
        ExprKind::Array(elements) => {
            let is_element = |it: &Expr<'_>| !matches!(it.tag(), ExprTag::Missing | ExprTag::Spread);
            elements.is_empty() || elements.iter().filter(is_element).count() > 1
        }
        ExprKind::Unary { op, operand } => match op {
            UnOp::Void | UnOp::Typeof => true,
            UnOp::Not => is_constant(operand, true),
            _ => false,
        },
        ExprKind::Call(call) => is_constant_boolean_call(call),
        ExprKind::Ident(_) => is_undefined(e),
        ExprKind::Template(template) => template.exprs().is_empty(),
        ExprKind::Assign { op: None, value, .. } => has_constant_loose_boolean_comparison(value),
        ExprKind::Binary { op: BinOp::Comma, right, .. } => has_constant_loose_boolean_comparison(right),
        _ => is_literal(e),
    }
}

/// ESLint's `hasConstantStrictBooleanComparison`: `e === true` always gives the same result,
/// because `e` is never a boolean or always the same.
fn has_constant_strict_boolean_comparison(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Object(_)
        | ExprKind::Array(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::New(_)
        | ExprKind::Template(_) => true,
        ExprKind::Binary { op, right, .. } => match op {
            BinOp::Comma => has_constant_strict_boolean_comparison(right),
            BinOp::Add
            | BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::BitOr
            | BinOp::BitXor
            | BinOp::BitAnd
            | BinOp::Pow
            | BinOp::Shl
            | BinOp::Shr
            | BinOp::UShr => true,
            _ => false,
        },
        ExprKind::Unary { op, operand } => match op {
            UnOp::Delete => false,
            UnOp::Not => is_constant(operand, true),
            // A string or a number.
            _ => true,
        },
        ExprKind::Ident(_) => is_undefined(e),
        ExprKind::Assign { op, value, .. } => match op {
            None => has_constant_strict_boolean_comparison(value),
            Some(BinOp::And | BinOp::Or | BinOp::Nullish) => false,
            Some(_) => true,
        },
        ExprKind::Call(call) => {
            is_call_of_global(call, &["String", "Number", "BigInt", "Symbol"]) || is_constant_boolean_call(call)
        }
        _ => is_literal(e),
    }
}

/// ESLint's `isAlwaysNew`: `e` always results in a newly constructed object.
fn is_always_new(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Regex(_) => true,
        // A constructor that is not built in could return a sentinel object.
        ExprKind::New(call) => {
            let callee = call.callee();
            callee.as_ident().is_some_and(|name| is_ecmascript_global(name.bytes()))
                && is_reference_to_global_variable(callee)
        }
        ExprKind::Binary { op: BinOp::Comma, right, .. } => is_always_new(right),
        ExprKind::Assign { op: None, value, .. } => is_always_new(value),
        ExprKind::Cond { yes, no, .. } => is_always_new(yes) && is_always_new(no),
        _ => false,
    }
}

/// ESLint's `findBinaryExpressionConstantOperand`: `b` makes the result of comparing it with `a`
/// constant.
fn is_constant_operand(a: Expr<'_>, b: Expr<'_>, is_strict: bool) -> bool {
    (is_null_or_undefined(a) && has_constant_nullishness(b, false))
        || (is_static_boolean(a)
            && match is_strict {
                true => has_constant_strict_boolean_comparison(b),
                false => has_constant_loose_boolean_comparison(b),
            })
}

/// ESLint's `isStaticLiteral`.
fn is_static_literal(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Unary {
            op: UnOp::Minus | UnOp::Plus | UnOp::BitNot,
            operand,
        } => is_literal(operand),
        ExprKind::Ident(_) => is_undefined(e),
        ExprKind::Template(template) => template.exprs().is_empty(),
        _ => is_literal(e),
    }
}

impl NoConstantBinaryExpression {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let operator = bin_op_text(op);
        match op {
            BinOp::And | BinOp::Or => {
                if is_constant(left, true) {
                    cx.report(left, CONSTANT_SHORT_CIRCUIT).data("property", "truthiness").data("operator", operator);
                }
            }
            BinOp::Nullish => {
                if has_constant_nullishness(left, false) {
                    cx.report(left, CONSTANT_SHORT_CIRCUIT).data("property", "nullishness").data("operator", operator);
                }
            }
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                let is_strict = matches!(op, BinOp::EqEqEq | BinOp::NotEqEq);
                if is_constant_operand(left, right, is_strict) {
                    cx.report(right, CONSTANT_BINARY_OPERAND).data("operator", operator).data("otherSide", "left");
                } else if is_constant_operand(right, left, is_strict) {
                    cx.report(left, CONSTANT_BINARY_OPERAND).data("operator", operator).data("otherSide", "right");
                } else if is_strict {
                    if is_always_new(left) {
                        cx.report(left, ALWAYS_NEW);
                    } else if is_always_new(right) {
                        cx.report(right, ALWAYS_NEW);
                    }
                } else if is_always_new(left) && is_always_new(right) {
                    // Both are objects, which `==` compares by reference too.
                    cx.report(left, BOTH_ALWAYS_NEW);
                }
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                if self.check_relational_comparisons && is_static_literal(left) && is_static_literal(right) {
                    cx.report(e, CONSTANT_RELATIONAL_COMPARISON).data("operator", operator);
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoConstantBinaryExpression {
    const META: Meta = Meta::eslint("no-constant-binary-expression", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoConstantBinaryExpression {
            check_relational_comparisons: options.object(0).bool_or("checkRelationalComparisons", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check);
    }
}
