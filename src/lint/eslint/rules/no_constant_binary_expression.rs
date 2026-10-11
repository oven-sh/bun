use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{
    Constants, is_constant, is_constant_in, is_ecmascript_global, is_global_reference, is_literal,
    is_reference_to_global_variable,
};
use smallvec::SmallVec;

/// Disallow expressions where the operation doesn't affect the value.
pub struct NoConstantBinaryExpression {
    check_relational_comparisons: Option<bool>,
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

#[inline]
fn is_oxlint(e: Expr<'_>) -> bool {
    e.file().language().is_oxlint
}

/// `e` refers to a global variable. oxlint finds the reference wherever it is.
fn refers_to_global(e: Expr<'_>) -> bool {
    if is_oxlint(e) { is_global_reference(e) } else { is_reference_to_global_variable(e) }
}

/// `e` is an identifier with one of `names` that refers to the global variable.
fn is_global(e: Expr<'_>, names: &[&str]) -> bool {
    e.as_ident().is_some_and(|name| name.is_any(names)) && refers_to_global(e)
}

/// For oxlint it is enough that the name is written.
#[inline]
fn is_undefined(e: Expr<'_>) -> bool {
    e.is_ident("undefined") && (is_oxlint(e) || refers_to_global(e))
}

/// oxlint looks at what is asserted to have a type.
fn inner(e: Expr<'_>) -> Expr<'_> {
    if is_oxlint(e) { e.skip_type_wrappers() } else { e }
}

/// oxlint does not look into the parentheses around the operand that the other is compared with.
fn oxlint_is_hidden_by_parentheses(e: Expr<'_>) -> bool {
    is_oxlint(e) && e.is_parenthesized()
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
        _ if oxlint_is_hidden_by_parentheses(e) => false,
        ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => true,
        ExprKind::Ident(_) => is_undefined(e),
        _ => false,
    }
}

/// ESLint's `hasConstantNullishness`: `e` is always nullish or never. With `non_nullish`, never.
fn has_constant_nullishness(mut e: Expr<'_>, mut non_nullish: bool) -> bool {
    // Not by recursion, here and below: `a = a = ..` is nested tens of thousands deep.
    loop {
        if non_nullish && is_null_or_undefined(e) {
            return false;
        }
        // oxlint does not know the last two.
        e = inner(e);
        let functions = ["Boolean", "String", "Number", "Symbol", "BigInt"];
        let known = if is_oxlint(e) { 3 } else { functions.len() };
        (e, non_nullish) = match e.kind() {
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Template(_)
            | ExprKind::Unary { .. } => return true,
            ExprKind::Call(call) => return is_call_of_global(call, functions.get(..known).unwrap_or_default()),
            ExprKind::Binary { op, right, .. } => match op {
                BinOp::Nullish => (right, true),
                BinOp::And | BinOp::Or => return false,
                BinOp::Comma => (right, non_nullish),
                _ => return true,
            },
            ExprKind::Assign { op, value, .. } => match op {
                None => (value, non_nullish),
                Some(BinOp::And | BinOp::Or | BinOp::Nullish) => return false,
                // A number or a string.
                Some(_) => return true,
            },
            ExprKind::Ident(_) => return is_undefined(e),
            _ => return is_literal(e),
        };
    }
}

/// ESLint's `isStaticBoolean`: `e` is a boolean that never changes.
fn is_static_boolean(e: Expr<'_>) -> bool {
    match e.kind() {
        _ if oxlint_is_hidden_by_parentheses(e) => false,
        ExprKind::True | ExprKind::False => true,
        ExprKind::Call(call) => is_constant_boolean_call(call),
        ExprKind::Unary { op: UnOp::Not, operand } => is_constant(operand, true),
        _ => false,
    }
}

/// ESLint's `hasConstantLooseBooleanComparison`: `e == true` always gives the same result.
fn has_constant_loose_boolean_comparison(mut e: Expr<'_>) -> bool {
    loop {
        e = match e.kind() {
            ExprKind::Object(_) | ExprKind::Class(_) | ExprKind::Fn(_) => return true,
            // `[x]` could be `[0]` or `[1]`.
            ExprKind::Array(elements) => {
                let is_element = |it: &Expr<'_>| !matches!(it.tag(), ExprTag::Missing | ExprTag::Spread);
                return elements.is_empty() || elements.iter().filter(is_element).count() > 1;
            }
            ExprKind::Unary { op, operand } => {
                return match op {
                    UnOp::Void | UnOp::Typeof => true,
                    UnOp::Not => is_constant(operand, true),
                    _ => false,
                };
            }
            ExprKind::Call(call) => return is_constant_boolean_call(call),
            ExprKind::Ident(_) => return is_undefined(e),
            ExprKind::Template(template) => return template.exprs().is_empty(),
            ExprKind::Assign { op: None, value, .. } => value,
            ExprKind::Binary { op: BinOp::Comma, right, .. } => right,
            _ => return is_literal(e),
        };
    }
}

/// ESLint's `hasConstantStrictBooleanComparison`: `e === true` always gives the same result,
/// because `e` is never a boolean or always the same.
fn has_constant_strict_boolean_comparison(mut e: Expr<'_>) -> bool {
    loop {
        e = match e.kind() {
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Template(_) => return true,
            ExprKind::Binary { op, right, .. } => match op {
                BinOp::Comma => right,
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
                | BinOp::UShr => return true,
                _ => return false,
            },
            ExprKind::Unary { op, operand } => {
                return match op {
                    UnOp::Delete => false,
                    UnOp::Not => is_constant(operand, true),
                    // A string or a number.
                    _ => true,
                };
            }
            ExprKind::Ident(_) => return is_undefined(e),
            ExprKind::Assign { op, value, .. } => match op {
                None => value,
                Some(BinOp::And | BinOp::Or | BinOp::Nullish) => return false,
                Some(_) => return true,
            },
            ExprKind::Call(call) => {
                let functions = ["String", "Number", "BigInt", "Symbol"];
                let known = if is_oxlint(e) { 2 } else { functions.len() };
                return is_call_of_global(call, functions.get(..known).unwrap_or_default())
                    || is_constant_boolean_call(call);
            }
            _ => return is_literal(e),
        };
    }
}

/// ESLint's `isAlwaysNew`: `e` always results in a newly constructed object.
fn is_always_new(e: Expr<'_>) -> bool {
    // All that it can be the value of.
    let mut open: SmallVec<[Expr<'_>; 4]> = SmallVec::new();
    open.push(e);
    while let Some(e) = open.pop() {
        match e.kind() {
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Regex(_) => {}
            // A constructor that is not built in could return a sentinel object.
            ExprKind::New(call) => {
                let callee = call.callee();
                let is_built_in = callee.as_ident().is_some_and(|name| is_ecmascript_global(name.bytes()));
                if !is_built_in || !refers_to_global(callee) {
                    return false;
                }
            }
            ExprKind::Binary { op: BinOp::Comma, right, .. } => open.push(right),
            ExprKind::Assign { op: None, value, .. } => open.push(value),
            ExprKind::Cond { yes, no, .. } => open.extend([no, yes]),
            _ => return false,
        }
    }
    true
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
    let e = inner(e);
    match e.kind() {
        ExprKind::Unary {
            op: UnOp::Minus | UnOp::Plus | UnOp::BitNot,
            operand,
        } => is_literal(inner(operand)),
        ExprKind::Ident(_) => is_global(e, &["undefined"]),
        ExprKind::Template(template) => template.exprs().is_empty(),
        _ => is_literal(e),
    }
}

impl Rule for NoConstantBinaryExpression {
    const META: Meta = Meta::eslint("no-constant-binary-expression", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Binary]);
    type State<'a> = Constants;

    fn new(options: &Options) -> Self {
        NoConstantBinaryExpression {
            check_relational_comparisons: options.object(0).bool("checkRelationalComparisons"),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Constants> {
        Some(Constants::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let operator = bin_op_text(op);
        // oxlint points at the whole.
        let (left_place, right_place) = if cx.language().is_oxlint { (e, e) } else { (left, right) };
        match op {
            BinOp::And | BinOp::Or => {
                if is_constant_in(left, true, &mut cx.state) {
                    cx.report(left_place, CONSTANT_SHORT_CIRCUIT)
                        .data("property", "truthiness")
                        .data("operator", operator);
                }
            }
            BinOp::Nullish => {
                if has_constant_nullishness(left, false) {
                    cx.report(left_place, CONSTANT_SHORT_CIRCUIT)
                        .data("property", "nullishness")
                        .data("operator", operator);
                }
            }
            BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => {
                let is_strict = matches!(op, BinOp::EqEqEq | BinOp::NotEqEq);
                if is_constant_operand(left, right, is_strict) {
                    cx.report(right_place, CONSTANT_BINARY_OPERAND)
                        .data("operator", operator)
                        .data("otherSide", "left");
                } else if is_constant_operand(right, left, is_strict) {
                    cx.report(left_place, CONSTANT_BINARY_OPERAND)
                        .data("operator", operator)
                        .data("otherSide", "right");
                } else if is_strict {
                    if is_always_new(left) {
                        cx.report(left_place, ALWAYS_NEW);
                    } else if is_always_new(right) {
                        cx.report(right_place, ALWAYS_NEW);
                    }
                } else if is_always_new(left) && is_always_new(right) {
                    // Both are objects, which `==` compares by reference too.
                    cx.report(left_place, BOTH_ALWAYS_NEW);
                }
            }
            BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                // It is on in oxlint unless the option says otherwise.
                if self.check_relational_comparisons.unwrap_or_else(|| cx.language().is_oxlint)
                    && is_static_literal(left)
                    && is_static_literal(right)
                {
                    cx.report(e, CONSTANT_RELATIONAL_COMPARISON).data("operator", operator);
                }
            }
            _ => {}
        }
    }
}
