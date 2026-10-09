use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::is_global_reference;
use smallvec::{SmallVec, smallvec};

/// Disallow a count for `String.prototype.repeat()` that is the result of a subtraction and has no lower bound.
pub struct NoNegativeRepeatCount;

const UNBOUNDED_COUNT: Message = Message::new(
    "unboundedCount",
    "This count can be negative, and `repeat()` throws a `RangeError` then. Give it a lower bound.",
);
const CLAMP: Message = Message::new("clamp", "Add a lower bound of zero.");

/// The name of the function of the global `Math` that `call` calls.
fn math_function(call: Call<'_>) -> Option<Name<'_>> {
    match call.callee().kind() {
        ExprKind::Dot { obj, name, .. } if obj.is_ident("Math") && is_global_reference(obj) => Some(name.name()),
        _ => None,
    }
}

fn is_zero(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Number(value) if value == 0.0)
}

fn is_not_negative(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Number(value) if value >= 0.0)
}

/// Whether a subtraction decides what `count` is, and nothing keeps the result from being negative.
fn can_be_negative(count: Expr) -> bool {
    let mut pending: SmallVec<[Expr; 8]> = smallvec![count];
    while let Some(e) = pending.pop() {
        match e.skip_type_wrappers().kind() {
            ExprKind::Binary { op: BinOp::Sub, left, right } => match (left.kind(), right.kind()) {
                (ExprKind::Number(left), ExprKind::Number(right)) if left >= right => {}
                _ => return true,
            },
            ExprKind::Unary { op: UnOp::Minus, operand } if !is_zero(operand) => return true,
            ExprKind::Assign { op: Some(BinOp::Sub), .. } => return true,
            ExprKind::Binary { op: BinOp::Comma, right, .. } | ExprKind::Assign { op: None, value: right, .. } => {
                pending.push(right);
            }
            ExprKind::Binary {
                op: BinOp::Add | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            }
            | ExprKind::Cond { yes: left, no: right, .. } => pending.extend([left, right]),
            ExprKind::Unary { op: UnOp::Plus, operand } => pending.push(operand),
            ExprKind::Call(call) => match math_function(call).map(Name::bytes) {
                Some(b"max") if call.args().iter().any(is_not_negative) => {}
                Some(b"max" | b"min" | b"floor" | b"ceil" | b"round" | b"trunc") => pending.extend(call.args()),
                _ => {}
            },
            _ => {}
        }
    }
    false
}

impl Rule for NoNegativeRepeatCount {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-negative-repeat-count", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNegativeRepeatCount
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("repeat") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(call) = e.as_call()
                && call.args().len() == 1
                && ast_utils::is_specific_member_access(call.callee(), None, Some("repeat"))
                && let Some(count) = call.args().first().filter(|it| can_be_negative(*it))
            {
                let span = count.outer_span();
                cx.report(count, UNBOUNDED_COUNT).suggest(CLAMP, |fixer| {
                    [fixer.insert_before(span, "Math.max(0, "), fixer.insert_after(span, ")")]
                });
            }
        });
    }
}
