use bun_lint::code_path::{Event, Step, steps_of_code_path};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::fix_tracker::FixTracker;
use rustc_hash::{FxHashMap, FxHashSet};

/// Disallow redundant return statements.
pub struct NoUselessReturn;

const UNNECESSARY_RETURN: Message =
    Message::new("unnecessaryReturn", "Unnecessary return statement.");

/// By `Segment::id`. Only reachable segments have an entry.
type SegmentInfoMap = FxHashMap<u32, SegmentInfo>;

#[derive(Copy, Clone)]
struct SegmentInfo {
    /// ESLint's `uselessReturns`: a set of [`ReturnSets`].
    useless_returns: u32,
    is_returned: bool,
}

#[derive(Copy, Clone)]
enum ReturnSet {
    /// The `return` statement with this number.
    One(u32),
    /// What is in either of two sets.
    Union(u32, u32),
}

/// What is known about a set.
#[derive(Copy, Clone)]
enum Filtered {
    No,
    /// All that is in it has been marked as used.
    Used,
    /// What was left of it when the rest was marked as used, and the `age` at that time.
    Left(u32, u32),
}

const EMPTY: u32 = 0;

/// Sets of `return` statements. A segment starts with what the segments before it end with, so a
/// set is made of other sets, which takes no copy. Each is gone through once to mark what is in it
/// as used, however many sets it is part of.
#[derive(Default)]
struct ReturnSets {
    /// The first is not used: it stands for the empty set.
    sets: Vec<(ReturnSet, Filtered)>,
    /// It grows whenever less is left in a set than before when it is marked as used.
    age: u32,
}

impl ReturnSets {
    fn add(&mut self, set: ReturnSet) -> u32 {
        if self.sets.is_empty() {
            self.sets
                .push((ReturnSet::Union(EMPTY, EMPTY), Filtered::Used));
        }
        self.sets.push((set, Filtered::No));
        self.sets.len() as u32 - 1
    }

    fn union(&mut self, a: u32, b: u32) -> u32 {
        match (a, b) {
            (EMPTY, other) | (other, EMPTY) => other,
            _ if a == b => a,
            _ => self.add(ReturnSet::Union(a, b)),
        }
    }

    /// What is left of `set`, if that has been found out at this age.
    fn left_of(&self, set: u32) -> Option<u32> {
        match self.sets.get(set as usize)?.1 {
            Filtered::Used => Some(EMPTY),
            Filtered::Left(left, age) if age == self.age => Some(left),
            _ => None,
        }
    }

    /// Calls `uses` with the number of each `return` statement in `set` that it has not been called
    /// with yet. What it answers `false` for is left: the result.
    fn mark_as_used(&mut self, set: u32, mut uses: impl FnMut(u32) -> bool) -> u32 {
        let mut pending = vec![set];
        while let Some(&at) = pending.last() {
            let Some(&(kind, _)) = self
                .sets
                .get(at as usize)
                .filter(|_| self.left_of(at).is_none())
            else {
                pending.pop();
                continue;
            };
            let left = match kind {
                ReturnSet::One(number) if uses(number) => EMPTY,
                ReturnSet::One(_) => at,
                ReturnSet::Union(a, b) => match (self.left_of(a), self.left_of(b)) {
                    (Some(left_of_a), Some(left_of_b)) if (left_of_a, left_of_b) == (a, b) => at,
                    (Some(left_of_a), Some(left_of_b)) => self.union(left_of_a, left_of_b),
                    (left_of_a, left_of_b) => {
                        pending.extend(left_of_a.is_none().then_some(a));
                        pending.extend(left_of_b.is_none().then_some(b));
                        continue;
                    }
                },
            };
            let filtered = match left {
                EMPTY => Filtered::Used,
                _ => Filtered::Left(left, self.age),
            };
            for it in [at, left] {
                if let Some(entry) = self.sets.get_mut(it as usize) {
                    entry.1 = filtered;
                }
            }
            pending.pop();
        }
        self.left_of(set).unwrap_or(EMPTY)
    }
}

struct ScopeInfo<'a> {
    code_path: CodePath<'a>,
    /// Whether it is the one that is checked. If not, nothing is kept about it.
    is_active: bool,
    /// The `block` of each `try` statement around the current node that has been left.
    traversed_try_blocks: Vec<Span>,
}

#[derive(Default)]
pub struct State<'a> {
    /// What the code paths to analyze start with.
    roots: FxHashSet<Node<'a>>,
    /// What is known of a `return` statement by what is around it.
    known: AncestorMemo<'a, Known>,
    /// The `return` statements after which their function ends, each with the function.
    at_the_end: Vec<(Node<'a>, Stmt<'a>)>,
    /// The function around a `return` statement.
    functions: AncestorMemo<'a, Func<'a>>,
    /// Whether a `return` statement is in a loop or in a `finally` block.
    in_loop_or_finally: AncestorMemo<'a, bool>,
    /// For each of the code paths around the current node, the innermost last.
    scopes: Vec<ScopeInfo<'a>>,
    segments: SegmentInfoMap,
    /// ESLint's `scopeInfo.uselessReturns` of the code path that is checked, with those that have
    /// been taken out of it again: whether each is still in it.
    returns: Vec<(Stmt<'a>, bool)>,
    /// How many are.
    useless_count: usize,
    sets: ReturnSets,
    /// The unreachable segments from where everything before has been marked as used, each with the
    /// age of the sets at that time.
    used_unreachable: FxHashMap<u32, u32>,
    /// With a configuration of oxlint: whether a `return` statement is reported.
    oxlint_useless: AncestorMemo<'a, bool>,
    /// [`oxlint_is_at_the_end`]
    oxlint_at_the_end: AncestorMemo<'a, bool>,
}

/// ESLint's `isReturned`: `segment` ends with a `return`, or it is unreachable.
fn is_returned(segments: &SegmentInfoMap, segment: Segment<'_>) -> bool {
    segments
        .get(&segment.id())
        .is_none_or(|info| info.is_returned)
}

/// ESLint's `isInLoop` or `isInFinally`, as far as `parent`, which `child` is directly in, tells.
fn is_in_loop_or_finally<'a>(child: Node<'a>, parent: Node<'a>) -> Option<bool> {
    if let Node::Stmt(parent) = parent
        && matches!(
            parent.kind(),
            StmtKind::Try { finalizer: Some(finalizer), .. } if Node::Stmt(finalizer) == child
        )
    {
        return Some(true);
    }
    if ast_utils::is_function(parent) {
        return Some(false);
    }
    ast_utils::is_loop(parent).then_some(true)
}

impl<'a> State<'a> {
    /// ESLint's `getUselessReturns`, for the segments before `segment`. An unreachable one that
    /// comes after a `return` stands for those before it, as if the `return` was not there.
    fn get_useless_returns(&mut self, segment: Segment<'a>) -> u32 {
        let mut useless_returns = EMPTY;
        let mut traversed = FxHashSet::default();
        let mut pending = segment.all_prev_segments();
        while let Some(prev) = pending.pop() {
            if prev.is_reachable() {
                let of_prev = self
                    .segments
                    .get(&prev.id())
                    .map_or(EMPTY, |info| info.useless_returns);
                useless_returns = self.sets.union(useless_returns, of_prev);
            } else if traversed.insert(prev.id()) {
                let before = prev.all_prev_segments();
                pending.extend(
                    before
                        .into_iter()
                        .filter(|it| is_returned(&self.segments, *it)),
                );
            }
        }
        useless_returns
    }

    /// ESLint's `markReturnStatementsOnCurrentSegmentsAsUsed`, for the code path at `index` of
    /// `scopes`.
    fn mark_return_statements_on_current_segments_as_used(&mut self, index: usize) {
        let Some(scope) = self.scopes.get(index) else {
            return;
        };
        if !scope.is_active || self.useless_count == 0 {
            return;
        }
        let mut pending = scope.code_path.current_segments();
        while let Some(segment) = pending.pop() {
            if !segment.is_reachable() {
                // Nothing is added to what has ended before it.
                if self.used_unreachable.insert(segment.id(), self.sets.age) != Some(self.sets.age)
                {
                    let before = segment.all_prev_segments();
                    pending.extend(
                        before
                            .into_iter()
                            .filter(|it| is_returned(&self.segments, *it)),
                    );
                }
                continue;
            }
            let Some(info) = self.segments.get_mut(&segment.id()) else {
                continue;
            };
            info.useless_returns = self.sets.mark_as_used(info.useless_returns, |number| {
                let Some((statement, is_useless)) = self.returns.get_mut(number as usize) else {
                    return true;
                };
                let span = statement.span();
                if scope
                    .traversed_try_blocks
                    .iter()
                    .any(|block| block.contains(span))
                {
                    return false;
                }
                self.useless_count -= usize::from(std::mem::take(is_useless));
                true
            });
        }
    }

    /// A `return` without a value.
    fn add_return(&mut self, statement: Stmt<'a>) {
        let Some(scope) = self.scopes.last() else {
            return;
        };
        if !scope.is_active
            || !scope.code_path.is_current_reachable()
            || self
                .in_loop_or_finally
                .find(statement.into(), is_in_loop_or_finally)
                == Some(true)
        {
            return;
        }
        let set = self.sets.add(ReturnSet::One(self.returns.len() as u32));
        for segment in scope.code_path.current_segments() {
            if let Some(info) = self.segments.get_mut(&segment.id()) {
                info.useless_returns = self.sets.union(info.useless_returns, set);
                info.is_returned = true;
            }
        }
        self.returns.push((statement, true));
        self.useless_count += 1;
    }
}

/// The kinds of statements that the rule listens for.
const STATEMENTS: [StmtTag; 28] = [
    StmtTag::Return,
    StmtTag::Class,
    StmtTag::Continue,
    StmtTag::Debugger,
    StmtTag::DoWhile,
    StmtTag::Empty,
    StmtTag::Expr,
    StmtTag::ForIn,
    StmtTag::ForOf,
    StmtTag::For,
    StmtTag::If,
    StmtTag::Import,
    StmtTag::Labeled,
    StmtTag::Switch,
    StmtTag::Throw,
    StmtTag::Try,
    StmtTag::Var,
    StmtTag::While,
    // A `with` statement.
    StmtTag::Block,
    StmtTag::ExportNamed,
    StmtTag::ExportDefault,
    StmtTag::ExportStar,
    // These only with an `export`.
    StmtTag::Fn,
    StmtTag::Interface,
    StmtTag::TypeAlias,
    StmtTag::Enum,
    StmtTag::Module,
    StmtTag::ImportEquals,
];

/// What the statements alone tell about a `return` without a value.
#[derive(Copy, Clone)]
enum Known {
    /// It is not reported: it is in a loop, or something is executed if it is left out.
    Useful,
    /// Nothing is: the function ends. It is reported if it can be reached.
    Useless,
    Nothing,
}

/// What is executed if a `return` is left out is the statement after it, or after the `if` statements and the blocks that
/// it is the end of. This is what `parent` tells, which `current`, the `return` statement or one of these, is directly in.
fn what_is_known<'a>(current: Node<'a>, parent: Node<'a>) -> Option<Known> {
    let list = match parent {
        Node::Func(func) => func.body_statements(),
        Node::Stmt(parent) => parent.as_block(),
        _ => None,
    };
    if let Some(next) = list.and_then(|list| list.after(current.span().start)) {
        let is_executed = matches!(
            next.tag(),
            StmtTag::Expr
                | StmtTag::Var
                | StmtTag::If
                | StmtTag::Throw
                | StmtTag::Switch
                | StmtTag::Try
                | StmtTag::For
                | StmtTag::ForIn
                | StmtTag::ForOf
                | StmtTag::While
                | StmtTag::DoWhile
        ) || matches!(next.as_return(), Some(Some(_)));
        return Some(if is_executed {
            Known::Useful
        } else {
            Known::Nothing
        });
    }
    match parent {
        // A `return` in a static block is an error.
        Node::Func(func) if list.is_some() && func.kind() != FnKind::StaticBlock => {
            Some(Known::Useless)
        }
        Node::Stmt(parent) => match parent.tag() {
            StmtTag::While | StmtTag::DoWhile | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf => {
                Some(Known::Useful)
            }
            StmtTag::If => None,
            StmtTag::Block if parent.as_block().is_some() => None,
            _ => Some(Known::Nothing),
        },
        _ => Some(Known::Nothing),
    }
}

/// Whether the function ends after `child` for oxlint, as far as `parent`, which `child` is directly in, tells: it is the last
/// statement of everything around it but a `case`. Whether it can be reached is not asked.
fn oxlint_is_at_the_end<'a>(child: Node<'a>, parent: Node<'a>) -> Option<bool> {
    let is_last = |list: List<'a, Stmt<'a>>| list.last().map(Node::Stmt) == Some(child);
    match parent {
        // A `return` in a static block is an error.
        Node::Func(func) => {
            Some(func.kind() != FnKind::StaticBlock && func.body_statements().is_some_and(is_last))
        }
        Node::Case(_) => None,
        Node::Stmt(parent) => match parent.kind() {
            StmtKind::Block(list) if !is_last(list) => Some(false),
            StmtKind::Try {
                finalizer: Some(finalizer),
                ..
            } if Node::Stmt(finalizer) == child => Some(false),
            _ => parent.is_loop().then_some(false),
        },
        _ => Some(false),
    }
}

/// Whether one of `statements` is executed for oxlint if they are run into. `Some(false)`: a `break`, a `continue` or a
/// `return` without a value comes first.
fn oxlint_executes<'a>(statements: &mut dyn Iterator<Item = Stmt<'a>>) -> Option<bool> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return Some(true);
    }
    for statement in statements {
        let verdict = match statement.kind() {
            StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Return(None) => Some(false),
            StmtKind::Block(list) => oxlint_executes(&mut list.iter()),
            StmtKind::Empty
            | StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_) => None,
            _ => Some(true),
        };
        if verdict.is_some() {
            return verdict;
        }
    }
    None
}

/// [`oxlint_executes`] for what follows `child` in `case` and in the cases after it.
fn oxlint_executes_after<'a>(child: Node<'a>, case: Case<'a>) -> Option<bool> {
    let Node::Stmt(switch) = case.parent() else {
        return None;
    };
    let StmtKind::Switch { cases, .. } = switch.kind() else {
        return None;
    };
    let body = case.body();
    let rest = std::iter::successors(body.after(child.span().start), |it| {
        body.after(it.span().start)
    });
    let later = std::iter::successors(cases.after(case.span().start), |it| {
        cases.after(it.span().start)
    });
    oxlint_executes(&mut rest.chain(later.flat_map(|it| it.body().iter())))
}

impl NoUselessReturn {
    /// oxlint does not follow the ways through a function: it asks what is written after the `return`.
    fn is_useless_for_oxlint<'a>(statement: Stmt<'a>, state: &mut State<'a>) -> bool {
        let at_the_end = &mut state.oxlint_at_the_end;
        let is_useless =
            state
                .oxlint_useless
                .find(statement.into(), |child, parent| match parent {
                    Node::Case(case) => match oxlint_executes_after(child, case)? {
                        true => Some(false),
                        // It looks no further, not after the `switch` that the `break` leaves either.
                        false => Some(at_the_end.find(parent, oxlint_is_at_the_end) == Some(true)),
                    },
                    _ => oxlint_is_at_the_end(child, parent),
                });
        is_useless == Some(true)
    }

    /// Checks the code path that starts with `root`.
    fn check_code_path<'a>(&self, root: Node<'a>, cx: &mut Cx<'a, Self>) {
        for step in steps_of_code_path(root, STATEMENTS, [StmtTag::Block, StmtTag::Try]) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) => {
                    self.on_code_path_start(path, node == root, cx)
                }
                Step::Event(Event::CodePathEnd(..)) => self.on_code_path_end(cx),
                Step::Event(Event::SegmentStart(segment, _)) => self.on_segment_start(segment, cx),
                Step::Event(_) => {}
                Step::Enter(node) => self.enter_statement(node, cx),
                Step::Exit(node) => self.exit_statement(node, cx),
            }
        }
        let state = &mut cx.state;
        state.segments.clear();
        state.returns.clear();
        state.sets = ReturnSets::default();
        state.used_unreachable.clear();
    }

    fn on_code_path_start<'a>(
        &self,
        code_path: CodePath<'a>,
        is_active: bool,
        cx: &mut Cx<'a, Self>,
    ) {
        cx.state.scopes.push(ScopeInfo {
            code_path,
            is_active,
            traversed_try_blocks: Vec::new(),
        });
    }

    fn on_code_path_end<'a>(&self, cx: &mut Cx<'a, Self>) {
        if !cx.state.scopes.pop().is_some_and(|scope| scope.is_active) {
            return;
        }
        cx.state.useless_count = 0;
        for (statement, is_useless) in std::mem::take(&mut cx.state.returns) {
            if is_useless {
                self.report(statement, cx);
            }
        }
    }

    fn report<'a>(&self, statement: Stmt<'a>, cx: &Cx<'a, Self>) {
        cx.report(statement, UNNECESSARY_RETURN).fix(|fixer| {
            let is_removable = ast_utils::is_statement_list_parent(statement.parent())
                && fixer.file().comments_in(statement).next().is_none();
            // The whole function, so that this does not conflict with `no-else-return`.
            is_removable.then(|| {
                FixTracker::new(fixer)
                    .retain_enclosing_function(statement)
                    .remove(statement)
            })
        });
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.scopes.last().is_some_and(|scope| scope.is_active) {
            let useless_returns = cx.state.get_useless_returns(segment);
            cx.state.segments.insert(
                segment.id(),
                SegmentInfo {
                    useless_returns,
                    is_returned: false,
                },
            );
        }
    }

    fn enter_statement<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Stmt(statement) = node else {
            return;
        };
        let innermost = cx.state.scopes.len().wrapping_sub(1);
        let scope = match statement.kind() {
            StmtKind::Return(None) => {
                cx.state.add_return(statement);
                return;
            }
            StmtKind::Block(_) => return,
            // These only count for the `export` around them, which is outside the code path of a
            // function.
            StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::ImportEquals(_)
                if !statement.is_exported() =>
            {
                return;
            }
            StmtKind::Fn(func) if func.has_body() => innermost.wrapping_sub(1),
            _ => innermost,
        };
        cx.state
            .mark_return_statements_on_current_segments_as_used(scope);
    }

    fn exit_statement<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let (Node::Stmt(statement), Some(scope)) = (node, cx.state.scopes.last_mut()) else {
            return;
        };
        if !scope.is_active {
            return;
        }
        match statement.kind() {
            StmtKind::Try { .. } => {
                scope.traversed_try_blocks.pop();
                cx.state.sets.age += 1;
            }
            StmtKind::Block(_) => {
                if let Node::Stmt(parent) = statement.parent()
                    && matches!(parent.kind(), StmtKind::Try { block, .. } if block == statement)
                {
                    scope.traversed_try_blocks.push(statement.span());
                }
            }
            _ => {}
        }
    }
}

impl Rule for NoUselessReturn {
    const META: Meta = Meta::eslint("no-useless-return", Kind::Suggestion)
        .fixable(Fixable::Code)
        .reports_on_code_path_end();
    const ON: On = On::new().stmts(&[StmtTag::Return]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUselessReturn
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.has_stmts([StmtTag::Return]).then(State::default)
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if !matches!(statement.as_return(), Some(None)) {
            return;
        }
        if cx.language().is_oxlint {
            if Self::is_useless_for_oxlint(statement, &mut cx.state) {
                self.report(statement, cx);
            }
            return;
        }
        let known = cx.state.known.find(statement.into(), what_is_known);
        if matches!(known, Some(Known::Useful)) {
            return;
        }
        let function = cx
            .state
            .functions
            .find(statement.into(), |_, parent| parent.as_func());
        let root = function.map_or_else(|| Node::File(cx.file()), Node::Func);
        match known {
            Some(Known::Useless) => cx.state.at_the_end.push((root, statement)),
            _ => {
                cx.state.roots.insert(root);
            }
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // A function in which all is known is not analyzed.
        for (root, statement) in std::mem::take(&mut cx.state.at_the_end) {
            if !cx.state.roots.contains(&root) && statement.is_reachable() {
                self.report(statement, cx);
            }
        }
        let as_entered = |it: &Node<'_>| (it.span().start, std::cmp::Reverse(it.span().end));
        for root in utils::sort::in_order_of(std::mem::take(&mut cx.state.roots), as_entered) {
            self.check_code_path(root, cx);
        }
    }
}
