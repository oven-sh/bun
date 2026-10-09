use bun_lint::prelude::*;
use bun_lint::utils::token_key::TokenClasses;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Disallow duplicate conditions in if-else-if chains.
pub struct NoDupeElseIf;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "This branch can never execute. Its condition is a duplicate or covered by previous conditions in the if-else-if chain.",
);

/// A chain whose conditions have more operands of `||` and `&&` than this, taken together, is checked by [`LongChain`].
const COMPARED: usize = 24;

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

fn split(operator: BinOp, e: Expr<'_>) -> Operands<'_> {
    let mut operands = Operands::new();
    split_into(operator, e, &mut operands);
    operands
}

/// ESLint's `splitByOr(e).map(splitByAnd)`.
fn split_by_or_and(e: Expr<'_>) -> OrOperands<'_> {
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
fn previous_if(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    let parent = statement.parent().as_stmt()?;
    matches!(parent.kind(), StmtKind::If { no: Some(no), .. } if no == statement).then_some(parent)
}

/// Appends the operands of `operator` in `e`, as [`split_into`] does, however many there are.
fn split_all<'a>(operator: BinOp, e: Expr<'a>, into: &mut Vec<Expr<'a>>) {
    let mut pending: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
    pending.push(e);
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Binary { op, left, right } if op == operator => pending.extend([right, left]),
            _ => into.push(e),
        }
    }
}

/// Whether `e` has more than `limit` operands of `||` and `&&`. What is left of `limit` otherwise.
fn count_operands(e: Expr<'_>, limit: usize) -> Option<usize> {
    // One, and one more for each operator.
    let mut limit = limit.checked_sub(1)?;
    let mut pending: SmallVec<[Expr<'_>; 8]> = SmallVec::new();
    pending.push(e);
    while let Some(e) = pending.pop() {
        if let ExprKind::Binary { op: BinOp::Or | BinOp::And, left, right } = e.kind() {
            limit = limit.checked_sub(1)?;
            pending.extend([left, right]);
        }
    }
    Some(limit)
}

/// What is to do to number an expression.
enum Step<'a> {
    Number(Expr<'a>),
    /// Of the last two numbers, make that of their `||` or `&&`.
    Combine(BinOp),
}

/// The conditions so far of a chain, in a form in which to find out whether they cover another one takes time in proportion to
/// that one, and not to the chain, unless many of them have an operand of `&&` in common with it and another one not.
struct LongChain<'a> {
    file: &'a File<'a>,
    /// Expressions have the same number if and only if they are [`equal`]. These are the numbers of what is no `||` or `&&`.
    tokens: TokenClasses,
    /// The numbers of the others, by the operator and the numbers of the operands, the smaller first. They have [`LOGICAL`] set.
    logical: FxHashMap<(bool, u32, u32), u32>,
    /// The operands of `||` so far that are not an `&&`.
    single: FxHashSet<u32>,
    /// The operands of `&&` of the others, sorted, one after the other.
    operands: Vec<u32>,
    /// Where in `operands` those are that have an operand, each listed under one of its operands.
    conjunctions: FxHashMap<u32, Vec<std::ops::Range<u32>>>,
}

const LOGICAL: u32 = 1 << 31;

impl<'a> LongChain<'a> {
    fn number_of(&mut self, e: Expr<'a>) -> u32 {
        if !matches!(e.kind(), ExprKind::Binary { op: BinOp::Or | BinOp::And, .. }) {
            return self.tokens.number_of(self.file, e);
        }
        let mut steps = vec![Step::Number(e)];
        let mut numbers: Vec<u32> = Vec::new();
        while let Some(step) = steps.pop() {
            match step {
                Step::Number(e) => match e.kind() {
                    ExprKind::Binary { op: op @ (BinOp::Or | BinOp::And), left, right } => {
                        steps.extend([Step::Combine(op), Step::Number(right), Step::Number(left)]);
                    }
                    _ => numbers.push(self.tokens.number_of(self.file, e)),
                },
                Step::Combine(op) => {
                    let (a, b) = (numbers.pop().unwrap_or(0), numbers.pop().unwrap_or(0));
                    let next = self.logical.len() as u32 | LOGICAL;
                    numbers.push(*self.logical.entry((op == BinOp::Or, a.min(b), a.max(b))).or_insert(next));
                }
            }
        }
        numbers.pop().unwrap_or(0)
    }

    /// The numbers of the operands of `&&` in `e`, sorted, each once.
    fn conjunction_of(&mut self, e: Expr<'a>) -> Vec<u32> {
        let mut operands = Vec::new();
        split_all(BinOp::And, e, &mut operands);
        let mut numbers: Vec<u32> = operands.into_iter().map(|it| self.number_of(it)).collect();
        numbers.sort_unstable();
        numbers.dedup();
        numbers
    }

    /// Whether all the operands of an earlier operand of `||` are among `conjunction`.
    fn is_covered(&self, conjunction: &[u32]) -> bool {
        let is_subset = |range: &std::ops::Range<u32>| {
            let earlier = self.operands.get(range.start as usize..range.end as usize).unwrap_or_default();
            earlier.len() <= conjunction.len() && earlier.iter().all(|it| conjunction.binary_search(it).is_ok())
        };
        conjunction.iter().any(|it| self.single.contains(it))
            || conjunction.iter().any(|it| self.conjunctions.get(it).is_some_and(|all| all.iter().any(is_subset)))
    }

    /// Whether each operand of `||` in `e` is covered. `uncovered`: takes those that are not.
    fn is_disjunction_covered(&mut self, e: Expr<'a>, mut uncovered: Option<&mut Vec<Vec<u32>>>) -> bool {
        let mut operands = Vec::new();
        split_all(BinOp::Or, e, &mut operands);
        let mut is_covered = true;
        for operand in operands {
            let conjunction = self.conjunction_of(operand);
            if self.is_covered(&conjunction) {
                continue;
            }
            is_covered = false;
            match &mut uncovered {
                Some(uncovered) => uncovered.push(conjunction),
                None => break,
            }
        }
        is_covered
    }

    fn add(&mut self, conjunction: &[u32]) {
        if let [only] = conjunction {
            self.single.insert(*only);
            return;
        }
        // Under the operand with the fewest so far, and of these the newest: `a && b1`, `a && b2`, .. are not all under `a`.
        let listed = |it: &u32| self.conjunctions.get(it).map_or(0, Vec::len);
        let Some(&key) = conjunction.iter().rev().min_by_key(|it| listed(it)) else {
            return;
        };
        let start = self.operands.len() as u32;
        self.operands.extend_from_slice(conjunction);
        self.conjunctions.entry(key).or_default().push(start..self.operands.len() as u32);
    }

    /// Whether the earlier conditions cover `test`, which is then one of them.
    fn check(&mut self, test: Expr<'a>) -> bool {
        let mut uncovered = Vec::new();
        let mut is_covered = self.is_disjunction_covered(test, Some(&mut uncovered));
        if !is_covered && matches!(test.kind(), ExprKind::Binary { op: BinOp::And, .. }) {
            let mut operands = Vec::new();
            split_all(BinOp::And, test, &mut operands);
            is_covered = operands.into_iter().any(|it| self.is_disjunction_covered(it, None));
        }
        // What is covered covers nothing more.
        for conjunction in uncovered {
            self.add(&conjunction);
        }
        is_covered
    }
}

impl NoDupeElseIf {
    /// `first`: an `if` that is not after an `else`.
    fn check_chain<'a>(&self, first: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let next = |statement: Stmt<'a>| match statement.kind() {
            StmtKind::If { test, no, .. } => Some((test, no.filter(|no| no.tag() == StmtTag::If))),
            _ => None,
        };
        if !matches!(next(first), Some((_, Some(_)))) || previous_if(first).is_some() {
            return;
        }
        let (mut at, mut left) = (Some(first), Some(COMPARED));
        while let (Some((test, no)), Some(limit)) = (at.and_then(next), left) {
            (at, left) = (no, count_operands(test, limit));
        }
        let mut long = left.is_none().then(|| LongChain {
            file: cx.file(),
            tokens: TokenClasses::default(),
            logical: FxHashMap::default(),
            single: FxHashSet::default(),
            operands: Vec::new(),
            conjunctions: FxHashMap::default(),
        });
        let mut at = Some(first);
        while let Some(statement) = at
            && let Some((test, no)) = next(statement)
        {
            match &mut long {
                Some(long) => {
                    if long.check(test) {
                        cx.report(test, UNEXPECTED);
                    }
                }
                None => self.check(statement, cx),
            }
            at = no;
        }
    }

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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDupeElseIf
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], Self::check_chain);
    }
}
