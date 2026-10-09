use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Require or disallow "Yoda" conditions.
pub struct Yoda {
    is_always: bool,
    except_range: bool,
    only_equality: bool,
}

const EXPECTED: Message = Message::new(
    "expected",
    "Expected literal to be on the {{expectedSide}} side of {{operator}}.",
);

/// The operator for the operands the other way around. `None` if `op` is not a comparison.
fn flipped(op: BinOp) -> Option<BinOp> {
    Some(match op {
        BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq => op,
        BinOp::Lt => BinOp::Gt,
        BinOp::Gt => BinOp::Lt,
        BinOp::Le => BinOp::Ge,
        BinOp::Ge => BinOp::Le,
        _ => return None,
    })
}

/// The operand, if `e` is a negative number that is treated as a literal.
fn as_negative_numeric_literal(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.kind() {
        ExprKind::Unary {
            op: UnOp::Minus,
            operand,
        } if ast_utils::is_numeric_literal(operand) => Some(operand),
        _ => None,
    }
}

/// A `Literal`, or ESLint's `looksLikeLiteral`.
fn is_literal_like(e: Expr) -> bool {
    ast_utils::is_literal(e)
        || as_negative_numeric_literal(e).is_some()
        || ast_utils::is_static_template_literal(e)
}

/// The value of a literal, as far as `<=` tells values apart.
enum Value<'a> {
    Number(f64),
    String(Cow<'a, [u8]>),
    /// In decimal notation.
    BigInt { is_negative: bool, digits: &'a [u8] },
}

impl Value<'_> {
    fn to_number(&self) -> f64 {
        match self {
            Value::Number(n) => *n,
            Value::String(value) => bun_core::fmt::js_string_to_number(value),
            Value::BigInt { is_negative, digits } => {
                let magnitude = bun_core::fmt::js_string_to_number(digits);
                if *is_negative { -magnitude } else { magnitude }
            }
        }
    }

    /// `self <= other`
    fn is_at_most(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::String(a), Value::String(b)) => strings::order_utf16(a, b) != Ordering::Greater,
            (
                Value::BigInt {
                    is_negative: a_is_negative,
                    digits: a,
                },
                Value::BigInt {
                    is_negative: b_is_negative,
                    digits: b,
                },
            ) => {
                let magnitudes = a.len().cmp(&b.len()).then_with(|| a.cmp(b));
                match (a_is_negative, b_is_negative) {
                    (true, false) => true,
                    (false, true) => false,
                    (false, false) => magnitudes != Ordering::Greater,
                    (true, true) => magnitudes != Ordering::Less,
                }
            }
            _ => self.to_number() <= other.to_number(),
        }
    }
}

/// The value of ESLint's `getNormalizedLiteral`.
fn normalized_literal(e: Expr<'_>) -> Option<Value<'_>> {
    Some(match e.kind() {
        ExprKind::Number(n) => Value::Number(n),
        ExprKind::True => Value::Number(1.0),
        ExprKind::False | ExprKind::Null => Value::Number(0.0),
        ExprKind::BigInt(digits) => Value::BigInt {
            is_negative: false,
            digits: digits.bytes(),
        },
        ExprKind::String(_) | ExprKind::Regex(_) | ExprKind::Template(_) => {
            Value::String(ast_utils::get_static_string_value(e)?)
        }
        ExprKind::Unary { .. } => match as_negative_numeric_literal(e)?.kind() {
            ExprKind::Number(n) => Value::Number(-n),
            ExprKind::BigInt(digits) => Value::BigInt {
                is_negative: digits != "0",
                digits: digits.bytes(),
            },
            _ => return None,
        },
        _ => return None,
    })
}

/// The operands of a `<` or a `<=`.
fn as_range_comparison(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    match e.kind() {
        ExprKind::Binary {
            op: BinOp::Lt | BinOp::Le,
            left,
            right,
        } => Some((left, right)),
        _ => None,
    }
}

/// ESLint's `isRangeTest`: a "between" test like `(0 <= x && x < 1)` or an "outside" test like
/// `(x < 0 || 1 <= x)`, in parentheses.
fn is_range_test(node: Node) -> bool {
    let Node::Expr(e) = node else {
        return false;
    };
    let ExprKind::Binary { op, left, right } = e.kind() else {
        return false;
    };
    let (Some(left), Some(right)) = (as_range_comparison(left), as_range_comparison(right)) else {
        return false;
    };
    let (subjects, lower, upper) = match op {
        BinOp::And => ((left.1, right.0), left.0, right.1),
        BinOp::Or => ((left.0, right.1), left.1, right.0),
        _ => return false,
    };
    if !ast_utils::is_same_reference(subjects.0, subjects.1, false) {
        return false;
    }
    let is_in_order = match (normalized_literal(lower), normalized_literal(upper)) {
        (None, None) => false,
        (None, Some(_)) | (Some(_), None) => true,
        (Some(lower), Some(upper)) => lower.is_at_most(&upper),
    };
    is_in_order && ast_utils::is_parenthesised(e)
}

/// Whether oxlint puts a blank before and after the flipped comparison, which is at `whole`: by the characters there.
fn needs_spaces_for_oxlint(source: &[u8], whole: Span, left: Expr, right: Expr) -> (bool, bool) {
    let is_literal_or_name = |it: Expr| {
        !it.is_parenthesized()
            && matches!(
                it.tag(),
                ExprTag::True
                    | ExprTag::False
                    | ExprTag::Null
                    | ExprTag::Number
                    | ExprTag::BigInt
                    | ExprTag::Regex
                    | ExprTag::String
                    | ExprTag::Ident
            )
    };
    let starts_with_keyword = |it: Expr| {
        !it.is_parenthesized()
            && match it.kind() {
                ExprKind::Unary { op, .. } => matches!(op, UnOp::Typeof | UnOp::Void | UnOp::Delete),
                ExprKind::Await(_) | ExprKind::Yield { .. } | ExprKind::New(_) => true,
                _ => false,
            }
    };
    let separates = |c: Option<u32>| c.is_some_and(|c| b" (){}/=;".iter().any(|it| u32::from(*it) == c));
    let before = source.get(..whole.start as usize).unwrap_or_default();
    let after = source.get(whole.end as usize..).unwrap_or_default();
    (
        !before.is_empty()
            && (is_literal_or_name(right) || starts_with_keyword(right))
            && !separates(text::last_code_point(before)),
        !after.is_empty() && is_literal_or_name(left) && !separates(strings::wtf8_first_codepoint(after)),
    )
}

/// ESLint's `getFlippedString`: the text of the comparison `e` with its sides and its operator
/// flipped around.
fn flipped_text<'a>(
    file: &'a File<'a>,
    e: Expr<'a>,
    left: Expr<'a>,
    right: Expr<'a>,
    flipped: BinOp,
) -> Option<Vec<u8>> {
    let (whole, operator) = (e.span(), e.operator_span()?);
    let (left_side, right_side) = (left, right);
    let (left, right) = (left.outer_span(), right.outer_span());
    let needs_space_before = || {
        file.token_before(e).is_some_and(|before| {
            before.end() == whole.start
                && file.first_token(right).is_some_and(|first| !ast_utils::can_tokens_be_adjacent(before, first))
        })
    };
    let needs_space_after = || {
        file.token_after(e).is_some_and(|after| {
            whole.end == after.start()
                && file.last_token(left).is_some_and(|last| !ast_utils::can_tokens_be_adjacent(last, after))
        })
    };
    let (needs_space_before, needs_space_after) = match file.language().is_oxlint {
        true => needs_spaces_for_oxlint(file.text(), whole, left_side, right_side),
        false => (needs_space_before(), needs_space_after()),
    };
    let space = |is_needed: bool| -> &'static [u8] { if is_needed { b" " } else { b"" } };
    Some(
        [
            space(needs_space_before),
            file.slice(Span::new(right.start, whole.end)),
            file.slice(left.between(operator)),
            bin_op_text(flipped).as_bytes(),
            file.slice(operator.between(right)),
            file.slice(Span::new(whole.start, left.end)),
            space(needs_space_after),
        ]
        .concat(),
    )
}

impl Yoda {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let Some(flipped) = flipped(op) else {
            return;
        };
        if self.only_equality && !matches!(op, BinOp::EqEq | BinOp::EqEqEq) {
            return;
        }
        let (expected_literal, expected_non_literal) = match self.is_always {
            true => (left, right),
            false => (right, left),
        };
        // oxlint sees through what only concerns types: `"a" as T`.
        let is_oxlint = cx.language().is_oxlint;
        let is_literal_like = |it: Expr<'a>| is_literal_like(if is_oxlint { get_inner_expression(it) } else { it });
        if !is_literal_like(expected_non_literal)
            || is_literal_like(expected_literal)
            || (self.except_range && is_range_test(e.parent()))
        {
            return;
        }
        cx.report(e, EXPECTED)
            .data("operator", bin_op_text(op))
            .data("expectedSide", if self.is_always { "left" } else { "right" })
            .fix(|fixer| {
                let text = flipped_text(fixer.file(), e, left, right, flipped)?;
                Some(fixer.replace(e, text))
            });
    }
}

impl Rule for Yoda {
    const META: Meta = Meta::eslint("yoda", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(1);
        Yoda {
            is_always: options.str(0) == Some("always"),
            except_range: object.bool_or("exceptRange", false),
            only_equality: object.bool_or("onlyEquality", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check);
    }
}
