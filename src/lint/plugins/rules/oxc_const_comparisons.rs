use bun_lint_oxlint::ast_util::{get_inner_expression, iter_outer_expressions};
use bun_lint_oxlint::same_expression::{is_same_expression, is_same_inner_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::{SmallVec, smallvec};
use std::cmp::Ordering;

/// Checks for redundant or logically impossible comparisons.
pub struct ConstComparisons;

const REDUNDANT_LEFT_HAND_SIDE: Message = Message::new("", "Left-hand side of `&&` operator has no effect.");
const REDUNDANT_RIGHT_HAND_SIDE: Message = Message::new("", "Right-hand side of `&&` operator has no effect.");
const IMPOSSIBLE: Message = Message::new("", "Unexpected constant comparison");
const CONSTANT_COMPARISON: Message = Message::new("", "This comparison will always evaluate to {{evaluates_to}}");
const IDENTICAL_EXPRESSIONS_LOGICAL_OPERATOR: Message = Message::new("", "Both sides of the logical operator are the same");
const EQUIVALENT_EXPRESSIONS_LOGICAL_OPERATOR: Message = Message::new("", "Both sides of the logical operator are equivalent");
const COMPLEMENTARY_EXPRESSIONS_LOGICAL_OPERATOR: Message = Message::new("", "Unexpected constant comparison");

impl Rule for ConstComparisons {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "const-comparisons", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ConstComparisons
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.binaries([BinOp::And, BinOp::Or], |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            // All the `&&` of `a && b && c` are looked at together, from the outermost.
            let is_and = |it: Node| matches!(it, Node::Expr(parent) if parent.binary_op() == Some(BinOp::And));
            if op == BinOp::And && !iter_outer_expressions(e).next().is_some_and(is_and) {
                check_const_literal_comparisons(e, cx);
            }
            check_redundant_logical_expression(left, right, op == BinOp::Or, cx);
        });
        on.binaries([BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge], |_, e, cx| {
            if let ExprKind::Binary { op, left, right } = e.kind()
                && is_same_inner_expression(left, right)
            {
                let is_const_truthy = matches!(op, BinOp::Le | BinOp::Ge);
                cx.report(e, CONSTANT_COMPARISON)
                    .data("evaluates_to", if is_const_truthy { "true" } else { "false" })
                    .data("left", cx.slice(left.outer_span()))
                    .data("how_often", if is_const_truthy { "always" } else { "never" })
                    .data("relation", match op {
                        BinOp::Lt => "less then",
                        BinOp::Gt => "greater than",
                        _ => "equal to",
                    });
            }
        });
    }
}

/// `expr op constant`
#[derive(Copy, Clone)]
struct ComparisonToConst<'a> {
    op: CmpOp,
    expr: Expr<'a>,
    constant: f64,
    /// As it is written.
    literal: Expr<'a>,
    whole: Expr<'a>,
}

enum Step<'a> {
    Visit(Expr<'a>),
    /// Between the operands of an `&&`. `start`: how many comparisons were found before its left operand.
    CheckRight { right: Expr<'a>, start: usize },
}

/// `x < 42 && x < 42`, `x < 42 && x > 42`: for each `&&` in `root`, which is one, its right operand against all the comparisons that
/// are connected by `&&` in its left operand. These are a part of the list of those in `root`, which is made on the way.
fn check_const_literal_comparisons<'a>(root: Expr<'a>, cx: &Cx<'a, ConstComparisons>) {
    let mut steps: SmallVec<[Step<'a>; 8]> = smallvec![Step::Visit(root)];
    let mut found: SmallVec<[ComparisonToConst<'a>; 4]> = SmallVec::new();
    while let Some(step) = steps.pop() {
        match step {
            Step::Visit(e) => {
                let e = get_inner_expression(e);
                match e.kind() {
                    ExprKind::Binary { op: BinOp::And, left, right } => {
                        steps.push(Step::Visit(right));
                        steps.push(Step::CheckRight { right, start: found.len() });
                        steps.push(Step::Visit(left));
                    }
                    _ => found.extend(comparison_to_const(e)),
                }
            }
            Step::CheckRight { right, start } => {
                if let Some(on_the_left) = found.get(start..)
                    && !on_the_left.is_empty()
                    && let Some(comparison) = comparison_to_const(get_inner_expression(right))
                {
                    check_right_operand(on_the_left, comparison, right, cx);
                }
            }
        }
    }
}

fn check_right_operand<'a>(
    on_the_left: &[ComparisonToConst<'a>],
    right: ComparisonToConst<'a>,
    right_operand: Expr<'a>,
    cx: &Cx<'a, ConstComparisons>,
) {
    for left in on_the_left {
        // Of n comparisons of one expression every other pair is reported.
        if cx.has_reported_too_much() {
            return;
        }
        let Some(ordering) = left.constant.partial_cmp(&right.constant) else {
            return;
        };
        if matches!((left.op, right.op, ordering), (CmpOp::Le | CmpOp::Ge, CmpOp::Le | CmpOp::Ge, Ordering::Equal)) {
            return;
        }
        if left.expr.is_parenthesized() || right.expr.is_parenthesized() || !is_same_expression(left.expr, right.expr) {
            return;
        }
        if left.op.direction() == right.op.direction() {
            let (left_span, right_span) = (left.whole.span(), right_operand.outer_span());
            let (report, other) = match left_side_is_useless(left.op, ordering) {
                true => (cx.report(right_span, REDUNDANT_LEFT_HAND_SIDE), left_span),
                false => (cx.report(left_span, REDUNDANT_RIGHT_HAND_SIDE), right_span),
            };
            report
                .first_label("If this evaluates to `true`")
                .label(other, "This will always evaluate to true.")
                .data("lhs_str", left.whole.text())
                .data("rhs_str", cx.slice(right_span));
        } else if !comparison_is_possible(left.op.direction(), ordering) {
            let report = cx.report(left.whole, IMPOSSIBLE).labels_with(|labels| {
                let requires = |it: &ComparisonToConst| {
                    let (expr, literal) = (bstr::BStr::new(left.expr.text()), bstr::BStr::new(it.literal.text()));
                    format!("Requires that `{expr} {} {literal}` ", it.op.sign())
                };
                labels.first(requires(left));
                labels.push(right.whole, requires(&right));
            });
            report.help_with(|| {
                let text = |e: Expr<'a>| bstr::BStr::new(e.text());
                let (lhs_str, rhs_str, expr_str) = (text(left.literal), text(right.literal), text(left.expr));
                let sign = match ordering {
                    Ordering::Less => '<',
                    Ordering::Greater => '>',
                    Ordering::Equal => {
                        return format!("`{expr_str}` cannot simultaneously be greater than and less than `{lhs_str}`");
                    }
                };
                format!(
                    "since `{lhs_str}` {sign} `{rhs_str}`, the expression evaluates to false for any value of `{expr_str}`"
                )
            });
        }
    }
}

fn check_redundant_logical_expression<'a>(left: Expr<'a>, right: Expr<'a>, is_or: bool, cx: &Cx<'a, ConstComparisons>) {
    let complementary = || {
        let (help, left_label, right_label) = match is_or {
            true => (
                "This logical expression will always evaluate to true",
                "If this expression evaluates to false",
                "This expression must evaluate to true",
            ),
            false => (
                "This logical expression will always evaluate to false",
                "If this expression evaluates to true",
                "This expression cannot also evaluate to true",
            ),
        };
        cx.report(left.outer_span(), COMPLEMENTARY_EXPRESSIONS_LOGICAL_OPERATOR)
            .help(help)
            .first_label(left_label)
            .label(right.outer_span(), right_label);
    };
    if is_same_inner_expression(left, right) {
        cx.report(left.outer_span(), IDENTICAL_EXPRESSIONS_LOGICAL_OPERATOR)
            .first_label("If this expression evaluates to true")
            .label(right.outer_span(), "This expression will always evaluate to true");
        return;
    }
    let (inner_left, inner_right) = (get_inner_expression(left), get_inner_expression(right));
    if let Some(relation) = equality_relation(inner_left, inner_right) {
        match relation {
            EqualityRelation::Equivalent => drop(
                cx.report(left.outer_span(), EQUIVALENT_EXPRESSIONS_LOGICAL_OPERATOR)
                    .first_label("If this expression evaluates to true")
                    .label(right.outer_span(), "This equivalent expression will always evaluate to true"),
            ),
            EqualityRelation::Inverse => complementary(),
        }
        return;
    }
    // `foo && !foo`, `foo || !foo`
    let is_negation_of = |negated: Expr<'a>, other: Expr<'a>| {
        matches!(negated.kind(), ExprKind::Unary { op: UnOp::Not, operand }
            if !operand.is_parenthesized() && is_same_expression(operand, other))
    };
    if is_negation_of(inner_left, inner_right) || is_negation_of(inner_right, inner_left) {
        complementary();
    }
}

/// A comparison between a number and something else. `42 < x` is `x > 42`.
fn comparison_to_const(e: Expr<'_>) -> Option<ComparisonToConst<'_>> {
    let op = CmpOp::of(e.binary_op()?)?;
    let (left, right) = (e.left()?, e.right()?);
    let (left_literal, right_literal) = (get_inner_expression(left), get_inner_expression(right));
    if let ExprKind::Number(constant) = left_literal.kind() {
        return Some(ComparisonToConst { op: op.reverse(), expr: right, constant, literal: left_literal, whole: e });
    }
    match right_literal.kind() {
        ExprKind::Number(constant) => Some(ComparisonToConst { op, expr: left, constant, literal: right_literal, whole: e }),
        _ => None,
    }
}

enum EqualityRelation {
    Equivalent,
    Inverse,
}

fn equality_inverse_operator(op: BinOp) -> Option<BinOp> {
    match op {
        BinOp::EqEq => Some(BinOp::NotEq),
        BinOp::NotEq => Some(BinOp::EqEq),
        BinOp::EqEqEq => Some(BinOp::NotEqEq),
        BinOp::NotEqEq => Some(BinOp::EqEqEq),
        _ => None,
    }
}

fn equality_relation<'a>(left: Expr<'a>, right: Expr<'a>) -> Option<EqualityRelation> {
    let (left_op, right_op) = (left.binary_op()?, right.binary_op()?);
    let (inverse_of_left, _) = (equality_inverse_operator(left_op)?, equality_inverse_operator(right_op)?);
    let (left_left, left_right, right_left, right_right) = (left.left()?, left.right()?, right.left()?, right.right()?);
    let same_order = is_same_inner_expression(left_left, right_left) && is_same_inner_expression(left_right, right_right);
    if !same_order && !(is_same_inner_expression(left_left, right_right) && is_same_inner_expression(left_right, right_left)) {
        return None;
    }
    if left_op == right_op {
        Some(EqualityRelation::Equivalent)
    } else if inverse_of_left == right_op {
        Some(EqualityRelation::Inverse)
    } else {
        None
    }
}

fn left_side_is_useless(left_cmp_op: CmpOp, ordering: Ordering) -> bool {
    match ordering {
        // Equal constants with an inclusive comparison.
        Ordering::Equal => matches!(left_cmp_op, CmpOp::Le | CmpOp::Ge),
        Ordering::Less => left_cmp_op.direction() == CmpOpDirection::Greater,
        Ordering::Greater => left_cmp_op.direction() == CmpOpDirection::Lesser,
    }
}

fn comparison_is_possible(left_cmp_direction: CmpOpDirection, ordering: Ordering) -> bool {
    match left_cmp_direction {
        CmpOpDirection::Lesser => ordering == Ordering::Greater,
        CmpOpDirection::Greater => ordering == Ordering::Less,
    }
}

#[derive(PartialEq, Eq, Clone, Copy)]
enum CmpOpDirection {
    Lesser,
    Greater,
}

#[derive(Clone, Copy)]
enum CmpOp {
    Lt,
    Le,
    Ge,
    Gt,
}

impl CmpOp {
    fn of(op: BinOp) -> Option<CmpOp> {
        match op {
            BinOp::Lt => Some(CmpOp::Lt),
            BinOp::Le => Some(CmpOp::Le),
            BinOp::Gt => Some(CmpOp::Gt),
            BinOp::Ge => Some(CmpOp::Ge),
            _ => None,
        }
    }

    fn sign(self) -> &'static str {
        match self {
            CmpOp::Lt => "<",
            CmpOp::Le => "<=",
            CmpOp::Ge => ">=",
            CmpOp::Gt => ">",
        }
    }

    fn reverse(self) -> CmpOp {
        match self {
            CmpOp::Lt => CmpOp::Gt,
            CmpOp::Le => CmpOp::Ge,
            CmpOp::Ge => CmpOp::Le,
            CmpOp::Gt => CmpOp::Lt,
        }
    }

    fn direction(self) -> CmpOpDirection {
        match self {
            CmpOp::Lt | CmpOp::Le => CmpOpDirection::Lesser,
            CmpOp::Ge | CmpOp::Gt => CmpOpDirection::Greater,
        }
    }
}
