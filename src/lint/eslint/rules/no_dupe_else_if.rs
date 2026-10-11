use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Disallow duplicate conditions in if-else-if chains.
pub struct NoDupeElseIf;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "This branch can never execute. Its condition is a duplicate or covered by previous conditions in the if-else-if chain.",
);

type Operands<'a> = SmallVec<[Expr<'a>; 4]>;
/// The operands of `||`, each split by `&&`.
type OrOperands<'a> = SmallVec<[Operands<'a>; 2]>;

/// ESLint's `splitByLogicalOperator`.
fn split(operator: BinOp, e: Expr<'_>) -> Operands<'_> {
    let mut operands = Operands::new();
    let mut pending: SmallVec<[Expr<'_>; 8]> = SmallVec::new();
    pending.push(e);
    while let Some(e) = pending.pop() {
        match e.as_binary() {
            Some((op, left, right)) if op == operator => pending.extend([right, left]),
            _ => operands.push(e),
        }
    }
    operands
}

/// ESLint's `splitByOr(e).map(splitByAnd)`.
fn split_by_or_and(e: Expr<'_>) -> OrOperands<'_> {
    split(BinOp::Or, e).into_iter().map(|it| split(BinOp::And, it)).collect()
}

/// Whether `a` and `b` can consist of the same tokens: then they are parsed alike.
pub(super) fn can_have_equal_tokens<'a>(a: Expr<'a>, b: Expr<'a>) -> bool {
    let mut pending: SmallVec<[(Expr<'a>, Expr<'a>); 8]> = SmallVec::new();
    pending.push((a, b));
    while let Some((a, b)) = pending.pop() {
        if a.tag() != b.tag()
            || a.as_ident() != b.as_ident()
            || a.as_string() != b.as_string()
            || a.as_number().map(f64::to_bits) != b.as_number().map(f64::to_bits)
            || a.member_name().map(Ident::name) != b.member_name().map(Ident::name)
            || a.binary_op() != b.binary_op()
            || a.unary_op() != b.unary_op()
            || a.tag() == ExprTag::Regex && a.text() != b.text()
        {
            return false;
        }
        if let (Some(a), Some(b)) = (a.as_call_like(), b.as_call_like()) {
            if a.args().len() != b.args().len() {
                return false;
            }
            pending.push((a.callee(), b.callee()));
            pending.extend(a.args().iter().zip(b.args()));
        }
        pending.extend(a.object().zip(b.object()));
        pending.extend(a.index().zip(b.index()));
        pending.extend(a.operand().zip(b.operand()));
        pending.extend(a.right().zip(b.right()));
        pending.extend(a.left().zip(b.left()));
    }
    true
}

/// In a boolean context, `||` and `&&` are commutative.
fn equal<'a>(a: Expr<'a>, b: Expr<'a>) -> bool {
    if a.tag() != b.tag() || !bun_core::StackCheck::init().is_safe_to_recurse() {
        return false;
    }
    if let Some((op @ (BinOp::Or | BinOp::And), left, right)) = a.as_binary()
        && let Some((other_op, other_left, other_right)) = b.as_binary()
        && op == other_op
    {
        return equal(left, other_left) && equal(right, other_right)
            || equal(left, other_right) && equal(right, other_left);
    }
    can_have_equal_tokens(a, b) && ast_utils::equal_tokens(a.file(), a, b)
}

fn is_subset<'a>(a: &[Expr<'a>], b: &[Expr<'a>]) -> bool {
    a.iter().all(|a| b.iter().any(|b| equal(*a, *b)))
}

/// The `if` whose `else` is `statement`.
#[inline]
fn previous_if(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    let parent = statement.parent().as_stmt()?;
    matches!(parent.as_if(), Some((_, _, Some(no))) if no == statement).then_some(parent)
}

impl NoDupeElseIf {
    /// `current`: the `if` whose `else` is `statement`.
    #[inline(never)]
    fn check<'a>(&self, statement: Stmt<'a>, mut current: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some((test, ..)) = statement.as_if() else {
            return;
        };
        let mut list_to_check: SmallVec<[OrOperands<'a>; 4]> = SmallVec::new();
        list_to_check.push(split_by_or_and(test));
        if test.binary_op() == Some(BinOp::And) {
            list_to_check.extend(split(BinOp::And, test).into_iter().map(split_by_or_and));
        }
        loop {
            let Some((current_test, ..)) = current.as_if() else {
                return;
            };
            let current_operands = split_by_or_and(current_test);
            for operands in &mut list_to_check {
                operands.retain(|operand| !current_operands.iter().any(|it| is_subset(it, operand)));
            }
            if list_to_check.iter().any(|operands| operands.is_empty()) {
                // oxlint points at the test with which nothing is left.
                cx.report(if cx.language().is_oxlint { current_test } else { test }, UNEXPECTED)
                    .labels_with(|labels| labels.push(test, "this branch will never be executed"));
                return;
            }
            match previous_if(current) {
                Some(previous) => current = previous,
                None => return,
            }
        }
    }
}

impl Rule for NoDupeElseIf {
    const META: Meta = Meta::eslint("no-dupe-else-if", Kind::Problem).recommended();
    const ON: On = On::new().stmts(&[StmtTag::If]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDupeElseIf
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(previous) = previous_if(statement) {
            self.check(statement, previous, cx);
        }
    }
}
