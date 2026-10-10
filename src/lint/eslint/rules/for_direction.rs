use bun_lint::prelude::*;
use bun_lint::utils::eslint_utils::{StaticValue, get_static_value};

/// Enforce `for` loop update clause moving the counter in the right direction.
pub struct ForDirection;

const INCORRECT_DIRECTION: Message = Message::new(
    "incorrectDirection",
    "The update clause in this loop moves the variable in the wrong direction.",
);

/// How many expressions in the update clause `e` modify `counter`, and the last of them. It goes
/// through them from the last to the first.
fn modifying_expressions<'a>(mut e: Expr<'a>, counter: Name<'a>, count: &mut u32, last: &mut Option<Expr<'a>>) {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        // Several: nothing is reported.
        *count += 2;
        return;
    }
    while let ExprKind::Binary {
        op: BinOp::Comma,
        left,
        right,
    } = e.kind()
    {
        modifying_expressions(right, counter, count, last);
        e = left;
    }
    let modified = match e.kind() {
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            operand,
        } => operand,
        ExprKind::Assign { target, .. } => target,
        _ => return,
    };
    if modified.as_ident() == Some(counter) {
        *count += 1;
        last.get_or_insert(e);
    }
}

/// The sign of what is added to the counter. 0 if it is not known.
fn sign_of(value: Expr<'_>) -> i32 {
    let sign = |n: f64| if n > 0.0 { 1 } else if n < 0.0 { -1 } else { 0 };
    match get_static_value(value, Some(value.file().scope())) {
        Some(StaticValue::Number(n)) => sign(n),
        Some(StaticValue::BigInt(n)) => n.signum() as i32,
        Some(StaticValue::Bool(b)) => i32::from(b),
        _ => 0,
    }
}

/// 1 if `update`, which modifies the counter, increments it, -1 if it decrements it, 0 if that is
/// not known.
fn direction_of(update: Expr<'_>) -> i32 {
    match update.kind() {
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PostInc,
            ..
        } => 1,
        ExprKind::Unary { .. } => -1,
        ExprKind::Assign {
            op: Some(BinOp::Add),
            value,
            ..
        } => sign_of(value),
        ExprKind::Assign {
            op: Some(BinOp::Sub),
            value,
            ..
        } => -sign_of(value),
        _ => 0,
    }
}

/// oxlint's rule, which points at the test. It knows one counter, the left one if both sides are names, and an update
/// clause that is one expression. Of what is added it looks at how it is written: a number, or an operator before
/// something. In parentheses it knows nothing.
fn check_as_oxlint<'a>(test: Expr<'a>, update: Expr<'a>, cx: &Cx<'a, ForDirection>) {
    let ExprKind::Binary { op, left, right } = test.kind() else {
        return;
    };
    let is_less = match op {
        BinOp::Lt | BinOp::Le => true,
        BinOp::Gt | BinOp::Ge => false,
        _ => return,
    };
    let as_counter = |side: Expr<'a>| side.as_ident().filter(|_| !side.is_parenthesized());
    let (counter, is_left) = match (as_counter(left), as_counter(right)) {
        (Some(counter), _) => (counter, true),
        (None, Some(counter)) => (counter, false),
        (None, None) => return,
    };
    if test.is_parenthesized() || update.is_parenthesized() {
        return;
    }
    let is_forward = match update.kind() {
        ExprKind::Unary { op, operand } if operand.as_ident() == Some(counter) => match op {
            UnOp::PreInc | UnOp::PostInc => true,
            UnOp::PreDec | UnOp::PostDec => false,
            _ => return,
        },
        ExprKind::Assign { op: Some(assigned @ (BinOp::Add | BinOp::Sub)), target, value }
            if target.as_ident() == Some(counter) && !value.is_parenthesized() =>
        {
            let is_positive = match value.kind() {
                ExprKind::Number(n) if n != 0.0 => true,
                ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => return,
                ExprKind::Unary { op, .. } => op != UnOp::Minus,
                _ => return,
            };
            is_positive == (assigned == BinOp::Add)
        }
        _ => return,
    };
    if is_forward != (is_less == is_left) {
        // The other operator, in the place of all that is between the operands.
        let report = cx.report(test, INCORRECT_DIRECTION);
        let report = report.first_label("This test moves in the wrong direction").label(update, "with this update");
        report.fix_dangerously(|fixer| match update.kind() {
            ExprKind::Unary { operand, .. } => {
                let (whole, argument) = (update.span(), operand.span());
                let operator = match whole.start == argument.start {
                    true => Span::new(argument.end, whole.end),
                    false => Span::new(whole.start, argument.start),
                };
                Some(fixer.replace(operator, if is_forward { "--" } else { "++" }))
            }
            ExprKind::Assign { op, target, value } => {
                let other = if op == Some(BinOp::Add) { "-=" } else { "+=" };
                Some(fixer.replace(target.span().between(value.span()), other))
            }
            _ => None,
        });
    }
}

impl Rule for ForDirection {
    const META: Meta = Meta::eslint("for-direction", Kind::Problem).recommended();
    const ON: On = On::new().stmts(&[StmtTag::For]);
    no_state!();

    fn new(_: &Options) -> Self {
        ForDirection
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::For {
            test: Some(test),
            update: Some(update),
            ..
        } = stmt.kind()
        else {
            return;
        };
        if cx.language().is_oxlint {
            return check_as_oxlint(test, update, cx);
        }
        let ExprKind::Binary { op, left, right } = test.kind() else {
            return;
        };
        // The direction that is wrong for a counter on the left.
        let wrong = match op {
            BinOp::Lt | BinOp::Le => -1,
            BinOp::Gt | BinOp::Ge => 1,
            _ => return,
        };
        for (side, wrong) in [(left, wrong), (right, -wrong)] {
            let Some(counter) = side.as_ident() else {
                continue;
            };
            let (mut count, mut last) = (0, None);
            modifying_expressions(update, counter, &mut count, &mut last);
            if count == 1
                && let Some(last) = last
                && direction_of(last) == wrong
            {
                let close_paren = skip_trivia(cx.text(), update.outer_span().end);
                cx.report(Span::new(stmt.span().start, close_paren + 1), INCORRECT_DIRECTION);
            }
        }
    }
}
