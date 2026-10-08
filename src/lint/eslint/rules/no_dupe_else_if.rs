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
fn split_into<'a>(operator: BinOp, e: Expr<'a>, into: &mut Operands<'a>) {
    match e.kind() {
        ExprKind::Binary { op, left, right } if op == operator => {
            split_into(operator, left, into);
            split_into(operator, right, into);
        }
        _ => into.push(e),
    }
}

fn split<'a>(operator: BinOp, e: Expr<'a>) -> Operands<'a> {
    let mut operands = Operands::new();
    split_into(operator, e, &mut operands);
    operands
}

/// ESLint's `splitByOr(e).map(splitByAnd)`.
fn split_by_or_and<'a>(e: Expr<'a>) -> OrOperands<'a> {
    split(BinOp::Or, e).into_iter().map(|it| split(BinOp::And, it)).collect()
}

/// In a boolean context, `||` and `&&` are commutative.
fn equal<'a>(a: Expr<'a>, b: Expr<'a>) -> bool {
    if a.tag() != b.tag() {
        return false;
    }
    if let ExprKind::Binary { op: op @ (BinOp::Or | BinOp::And), left, right } = a.kind()
        && let ExprKind::Binary { op: other_op, left: other_left, right: other_right } = b.kind()
        && op == other_op
    {
        return equal(left, other_left) && equal(right, other_right)
            || equal(left, other_right) && equal(right, other_left);
    }
    ast_utils::equal_tokens(a.file(), a, b)
}

fn is_subset<'a>(a: &[Expr<'a>], b: &[Expr<'a>]) -> bool {
    a.iter().all(|a| b.iter().any(|b| equal(*a, *b)))
}

/// The `if` whose `else` is `statement`.
fn previous_if<'a>(statement: Stmt<'a>) -> Option<Stmt<'a>> {
    let parent = statement.parent().as_stmt()?;
    matches!(parent.kind(), StmtKind::If { no: Some(no), .. } if no == statement).then_some(parent)
}

impl NoDupeElseIf {
    fn check<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let Some(mut current) = previous_if(statement) else {
            return;
        };
        let StmtKind::If { test, .. } = statement.kind() else {
            return;
        };
        let mut list_to_check: SmallVec<[OrOperands<'a>; 4]> = SmallVec::new();
        list_to_check.push(split_by_or_and(test));
        if matches!(test.kind(), ExprKind::Binary { op: BinOp::And, .. }) {
            list_to_check.extend(split(BinOp::And, test).into_iter().map(split_by_or_and));
        }
        loop {
            let StmtKind::If { test: current_test, .. } = current.kind() else {
                return;
            };
            let current_operands = split_by_or_and(current_test);
            for operands in &mut list_to_check {
                operands.retain(|operand| !current_operands.iter().any(|it| is_subset(it, operand)));
            }
            if list_to_check.iter().any(|operands| operands.is_empty()) {
                cx.report(test, UNEXPECTED);
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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDupeElseIf
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], Self::check);
    }
}
