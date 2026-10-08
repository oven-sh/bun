use bun_lint::code_path::{CurrentSegments, Event, Step, starts_code_path, steps_of_code_path};
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::collections::VecDeque;

/// Disallow variable assignments when the value is not used.
pub struct NoUselessAssignment;

const UNNECESSARY_ASSIGNMENT: Message = Message::new(
    "unnecessaryAssignment",
    "The value assigned to '{{name}}' is not used in subsequent statements.",
);

struct Assignment<'a> {
    /// The identifier that is assigned.
    identifier: Span,
    /// The expression that is evaluated before the assignment.
    expression: Option<Span>,
    /// The code path segments where the assignment was made.
    segments: SmallVec<[Segment<'a>; 2]>,
}

type Assignments<'a> = SmallVec<[Assignment<'a>; 1]>;

/// What is kept for a code path.
struct ScopeStack<'a> {
    scope: Scope<'a>,
    assignments: FxHashMap<Symbol<'a>, Assignments<'a>>,
    try_statement_blocks: Vec<Span>,
}

#[derive(Default)]
pub struct State<'a> {
    /// What the code paths to analyze start with: those that assign to a variable where the
    /// statements alone do not tell that the value is read.
    roots: Vec<Node<'a>>,
    stack: Vec<ScopeStack<'a>>,
    /// Only the reachable ones.
    current_segments: CurrentSegments<'a>,
    code_path_start_scopes: FxHashSet<Scope<'a>>,
    /// By the id of a segment: from the start of the first identifier in it to the end of the last.
    /// Only identifiers that are expressions count, as only the place of those is asked for.
    identifier_ranges: Vec<Span>,
}

const NO_IDENTIFIERS: Span = Span::new(u32::MAX, 0);

/// ESLint's `extractIdentifiersFromPattern`, for the target of an assignment.
fn extract_identifiers_from_pattern<'a>(pattern: Expr<'a>, visit: &mut dyn FnMut(Expr<'a>)) {
    match pattern.kind() {
        ExprKind::Ident(_) => visit(pattern),
        ExprKind::Object(properties) => {
            for value in properties.iter().filter_map(Prop::value) {
                extract_identifiers_from_pattern(value, visit);
            }
        }
        ExprKind::Array(elements) => {
            for element in elements {
                extract_identifiers_from_pattern(element, visit);
            }
        }
        ExprKind::Spread(argument) => extract_identifiers_from_pattern(argument, visit),
        ExprKind::Assign { target, .. } => extract_identifiers_from_pattern(target, visit),
        _ => {}
    }
}

fn is_identifier_evaluated_after_assignment(assignment: &Assignment<'_>, identifier: Span) -> bool {
    identifier.start >= assignment.identifier.end
        // `x = id`: it is evaluated before the assignment.
        && !assignment.expression.is_some_and(|expression| expression.contains(identifier))
}

/// `let { x, y = x } = obj`
fn is_identifier_used_between_assigned_and_equal_sign(assignment: &Assignment<'_>, identifier: Span) -> bool {
    assignment.expression.is_some_and(|expression| {
        assignment.identifier.end <= identifier.start && identifier.end <= expression.start
    })
}

fn is_identifier_used_in_segment(ranges: &[Span], segment: Segment<'_>, identifier: Span) -> bool {
    ranges.get(segment.id() as usize).is_some_and(|range| range.contains(identifier))
}

fn get_code_path_start_scope<'a>(starts: &FxHashSet<Scope<'a>>, scope: Scope<'a>) -> Option<Scope<'a>> {
    scope.chain().find(|it| starts.contains(it))
}

/// Whether a variable of the scope of a module is exported, other than by `export default`.
fn is_exported(variable: Symbol<'_>) -> bool {
    variable.declarations().any(|declaration| match declaration {
        Declaration::Var(_) => {
            matches!(declaration.parent(), Some(Node::Stmt(statement)) if statement.is_exported())
        }
        Declaration::Fn(func) => func.flags().contains(Flags::EXPORT),
        Declaration::Class(class) => class.flags().contains(Flags::EXPORT),
        _ => false,
    }) || variable.references().any(|reference| matches!(reference.node(), Node::ExportSpec(_)))
}

/// The segments that follow those of an assignment, as far as they have been asked for.
struct SubsequentSegments<'a> {
    /// With the index of the first assignment in the segment. What follows that need not be looked
    /// at, as the value it assigns is what is used there.
    results: Vec<(Segment<'a>, Option<usize>)>,
    seen: FxHashSet<Segment<'a>>,
    queue: VecDeque<Segment<'a>>,
}

impl<'a> SubsequentSegments<'a> {
    fn new(target: &Assignment<'a>) -> Self {
        SubsequentSegments {
            results: Vec::new(),
            seen: FxHashSet::default(),
            queue: target.segments.iter().flat_map(|segment| segment.next_segments()).collect(),
        }
    }

    fn get(
        &mut self,
        index: usize,
        all: &[Assignment<'a>],
        target: &Assignment<'a>,
    ) -> Option<(Segment<'a>, Option<usize>)> {
        while index >= self.results.len() {
            let next = self.queue.pop_front()?;
            if !self.seen.insert(next) {
                continue;
            }
            let assignment = all.iter().position(|other| {
                other.segments.contains(&next)
                    && !is_identifier_used_between_assigned_and_equal_sign(other, target.identifier)
            });
            if assignment.is_none() {
                self.queue.extend(next.next_segments());
            }
            self.results.push((next, assignment));
        }
        self.results.get(index).copied()
    }
}

/// Whether nothing reads the value that `all[index]` assigns. `read_references`: where the variable
/// is read, all in the same code path.
fn is_assignment_unused(index: usize, all: &[Assignment<'_>], read_references: &[Span], ranges: &[Span]) -> bool {
    let Some(target) = all.get(index) else {
        return false;
    };
    // Another assignment in the same segment, after this one.
    let other_assignment_after_target = all.iter().enumerate().find_map(|(i, assignment)| {
        let is_after = i != index
            && assignment.segments.iter().any(|segment| target.segments.contains(segment))
            && (is_identifier_evaluated_after_assignment(target, assignment.identifier)
                // `x = (x = 1)`
                || assignment.expression.is_some_and(|expression| expression.contains(target.identifier)));
        is_after.then_some(assignment)
    });
    let mut subsequent_segments = None;

    for &reference in read_references {
        if is_identifier_evaluated_after_assignment(target, reference)
            && (is_identifier_used_between_assigned_and_equal_sign(target, reference)
                || target.segments.iter().any(|&segment| is_identifier_used_in_segment(ranges, segment, reference)))
        {
            if other_assignment_after_target
                .is_some_and(|other| is_identifier_evaluated_after_assignment(other, reference))
            {
                continue;
            }
            return false;
        }
        if other_assignment_after_target.is_some() {
            continue;
        }
        let subsequent_segments = subsequent_segments.get_or_insert_with(|| SubsequentSegments::new(target));
        let mut at = 0;
        while let Some((segment, assignment)) = subsequent_segments.get(at, all, target) {
            at += 1;
            if is_identifier_used_in_segment(ranges, segment, reference)
                && !assignment
                    .and_then(|it| all.get(it))
                    .is_some_and(|it| is_identifier_evaluated_after_assignment(it, reference))
            {
                return false;
            }
        }
    }
    true
}

// ───────────────────────────── without code paths ─────────────────────────────
//
// Nearly every value that is assigned is read, and the statements tell: there is a way from the
// assignment to a place where the variable is read that does not lead over another assignment.
// Each step of such a way is one of the code path too, so that the assignment is not reported. What
// cannot be told this way is left to the analysis.

/// A place where the variable is used.
#[derive(Copy, Clone)]
struct Use {
    span: Span,
    is_read: bool,
    is_write: bool,
}

/// What can happen from the start of a statement or an expression on.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Flow<'a> {
    /// The variable can be read before anything is assigned to it.
    Read,
    /// Its end can be reached without the variable being used.
    Through,
    /// This `break` or `continue` can be reached without the variable being used.
    Leaves(Stmt<'a>),
    /// None of these is known.
    Unknown,
}

impl<'a> Flow<'a> {
    fn or(self, other: Flow<'a>) -> Flow<'a> {
        match (self, other) {
            (Flow::Read, _) | (_, Flow::Read) => Flow::Read,
            (Flow::Through, _) | (_, Flow::Through) => Flow::Through,
            _ => Flow::Unknown,
        }
    }
}

/// An assignment as the rule sees it.
struct Written<'a> {
    identifier: Span,
    /// What is evaluated before the assignment.
    expression: Option<Span>,
    /// The `VariableDeclarator`, `AssignmentExpression` or `UpdateExpression`.
    node: Node<'a>,
}

/// The assignment that a reference that writes is part of. `None` if the rule does not see one: the
/// head of a `for`-`in`, the default value of a parameter.
fn written_by<'a>(reference: Reference<'a>) -> Option<Written<'a>> {
    let identifier = reference.span();
    let mut current = reference.node();
    loop {
        let parent = current.parent();
        match parent {
            Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_) | Node::Prop(_) => {}
            Node::VarDecl(declarator) => {
                return Some(Written {
                    identifier,
                    expression: Some(declarator.init()?.span()),
                    node: parent,
                });
            }
            Node::Expr(e) => match e.kind() {
                ExprKind::Assign { target, value, .. } if Node::Expr(target) == current => {
                    if !utils::is_assignment_target(e) {
                        return Some(Written {
                            identifier,
                            expression: Some(value.span()),
                            node: parent,
                        });
                    }
                }
                ExprKind::Unary { .. } if matches!(current, Node::Expr(it) if it.tag() == ExprTag::Ident) => {
                    return Some(Written {
                        identifier,
                        expression: None,
                        node: parent,
                    });
                }
                ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => {}
                _ => return None,
            },
            _ => return None,
        }
        current = parent;
    }
}

/// The scope that the code path around `scope` starts with.
fn code_path_scope(scope: Scope<'_>) -> Option<Scope<'_>> {
    scope.chain().find(|it| match it.kind() {
        ScopeKind::Global | ScopeKind::ClassStaticBlock => true,
        ScopeKind::Function | ScopeKind::ClassFieldInitializer => !matches!(it.node(), Node::File(_)) && starts_code_path(it.node()),
        _ => false,
    })
}

/// A loop whose test is a literal may have no way out but `break`.
fn is_literal(e: Expr<'_>) -> bool {
    matches!(
        e.tag(),
        ExprTag::String
            | ExprTag::Number
            | ExprTag::BigInt
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Null
            | ExprTag::Regex
    )
}

/// The index of the statement of `list` that `offset` is in, or of the first one after it.
fn index_at<'a>(list: List<'a, Stmt<'a>>, offset: u32) -> usize {
    let (mut low, mut high) = (0, list.len());
    while low < high {
        let middle = low + (high - low) / 2;
        if list.get(middle).is_some_and(|it| it.span().end <= offset) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    low
}

/// The statements that `node` has as a list.
fn statement_list<'a>(node: Node<'a>) -> Option<List<'a, Stmt<'a>>> {
    match node {
        Node::Func(func) => func.body_statements(),
        Node::File(file) => Some(file.body()),
        Node::Case(case) => Some(case.body()),
        Node::Stmt(statement) => statement.as_block(),
        _ => None,
    }
}

/// Where a variable is used, to look for ways from an assignment to a place where it is read.
struct Uses<'a> {
    /// In source order.
    all: SmallVec<[Use; 8]>,
    /// The loops whose body has been looked at from its start.
    loops: SmallVec<[Stmt<'a>; 2]>,
    /// How many more statements to look at.
    budget: u32,
}

impl<'a> Uses<'a> {
    fn of(variable: Symbol<'a>) -> Self {
        let mut all: SmallVec<[Use; 8]> = (variable.references())
            .map(|it| Use {
                span: it.span(),
                is_read: it.is_read(),
                is_write: it.is_write(),
            })
            .collect();
        if !all.is_sorted_by_key(|it| it.span.start) {
            all.sort_unstable_by_key(|it| it.span.start);
        }
        Uses {
            all,
            loops: SmallVec::new(),
            budget: 0,
        }
    }

    fn within(&self, span: Span) -> &[Use] {
        let all = &self.all[..];
        // Most variables are used a few times.
        if all.len() <= 8 {
            let first = all.iter().take_while(|it| it.span.start < span.start).count();
            let count = all[first..].iter().take_while(|it| it.span.start < span.end).count();
            return &all[first..first + count];
        }
        let first = all.partition_point(|it| it.span.start < span.start);
        let end = first + all[first..].partition_point(|it| it.span.start < span.end);
        &all[first..end]
    }

    /// Whether `written` and what it evaluates first are the only uses in `span`.
    fn is_alone_in(&self, written: &Written<'a>, span: Span) -> bool {
        self.within(span).iter().all(|it| {
            it.span == written.identifier
                || !it.is_write && written.expression.is_some_and(|expression| expression.contains(it.span))
        })
    }

    fn expression(&self, e: Expr<'a>) -> Flow<'a> {
        let read_or_unknown = |is_read| if is_read { Flow::Read } else { Flow::Unknown };
        match self.within(e.span()) {
            [] => Flow::Through,
            [only] => read_or_unknown(only.is_read),
            [first, rest @ ..] => {
                if rest.iter().any(|it| it.is_write) {
                    return Flow::Unknown;
                }
                // `x = f(x)`
                read_or_unknown(!first.is_write || matches!(
                    e.kind(),
                    ExprKind::Assign { target, value, .. }
                        if target.span() == first.span && rest.iter().all(|it| value.span().contains(it.span))
                ))
            }
        }
    }

    fn optional_expression(&self, e: Option<Expr<'a>>) -> Flow<'a> {
        e.map_or(Flow::Through, |e| self.expression(e))
    }

    fn declarations(&self, declarators: List<'a, VarDecl<'a>>) -> Flow<'a> {
        for declarator in declarators {
            match self.optional_expression(declarator.init()) {
                Flow::Through if self.within(declarator.span()).is_empty() => {}
                Flow::Read => return Flow::Read,
                _ => return Flow::Unknown,
            }
        }
        Flow::Through
    }

    /// What is in the head of a `for`.
    fn head(&self, statement: Stmt<'a>) -> Flow<'a> {
        match statement.kind() {
            StmtKind::Expr(e) => self.expression(e),
            StmtKind::Var(declarators) => self.declarations(declarators),
            _ => Flow::Unknown,
        }
    }

    /// From `offset` on, which is between two statements of `list`, before the first or after the
    /// last.
    fn statements(&mut self, list: List<'a, Stmt<'a>>, mut offset: u32) -> Flow<'a> {
        let (Some(first), Some(last)) = (list.first(), list.last().filter(|it| it.span().end > offset)) else {
            return Flow::Through;
        };
        offset = offset.max(first.span().start);
        loop {
            // Whether there is a way from `offset` to the start of `list[at]`. That the end of the one
            // before it can be reached tells the same of those before that.
            let is_reached = |at: usize| {
                let previous = at.checked_sub(1).and_then(|it| list.get(it));
                previous.is_none_or(|it| it.span().start < offset || it.is_known_to_complete())
            };
            let Some(next) = self.within(Span::new(offset, last.span().end)).first().copied() else {
                return match last.tag() {
                    _ if last.is_known_to_complete() => Flow::Through,
                    StmtTag::Break | StmtTag::Continue if is_reached(list.len() - 1) => Flow::Leaves(last),
                    _ => Flow::Unknown,
                };
            };
            let at = index_at(list, next.span.start);
            let Some(statement) = list.get(at).filter(|_| is_reached(at)) else {
                return Flow::Unknown;
            };
            match self.statement(statement) {
                Flow::Through if statement == last => return Flow::Through,
                Flow::Through => offset = statement.span().end,
                flow => return flow,
            }
        }
    }

    /// From the start of `statement` on.
    fn statement(&mut self, statement: Stmt<'a>) -> Flow<'a> {
        if self.within(statement.span()).is_empty() {
            return if statement.is_known_to_complete() { Flow::Through } else { Flow::Unknown };
        }
        let Some(budget) = self.budget.checked_sub(1) else {
            return Flow::Unknown;
        };
        self.budget = budget;
        /// Goes on only if the variable is not used in the expression.
        macro_rules! through {
            ($flow:expr) => {
                match $flow {
                    Flow::Through => {}
                    flow => return flow,
                }
            };
        }
        match statement.kind() {
            StmtKind::Expr(e) => self.expression(e),
            StmtKind::Return(Some(e)) | StmtKind::Throw(e) => match self.expression(e) {
                Flow::Read => Flow::Read,
                _ => Flow::Unknown,
            },
            StmtKind::Var(declarators) => self.declarations(declarators),
            StmtKind::Block(list) => self.statements(list, 0),
            StmtKind::Labeled { body, .. } => self.statement(body).or(Flow::Unknown),
            StmtKind::If { test, yes, no } => {
                through!(self.expression(test));
                let yes = self.statement(yes);
                yes.or(no.map_or(Flow::Through, |no| self.statement(no)))
            }
            StmtKind::While { test, body } => {
                through!(self.expression(test));
                let out = if is_literal(test) { Flow::Unknown } else { Flow::Through };
                self.body(body).or(out)
            }
            StmtKind::DoWhile { body, test } => {
                through!(self.statement(body).or(Flow::Unknown));
                through!(self.expression(test));
                if is_literal(test) { Flow::Unknown } else { Flow::Through }
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                through!(init.map_or(Flow::Through, |init| self.head(init)));
                through!(self.optional_expression(test));
                let out = if test.is_some_and(|test| !is_literal(test)) { Flow::Through } else { Flow::Unknown };
                match self.statement(body) {
                    Flow::Read => Flow::Read,
                    Flow::Through if self.optional_expression(update) == Flow::Read => Flow::Read,
                    _ => out,
                }
            }
            StmtKind::ForIn { left, expr, body } | StmtKind::ForOf { left, expr, body, .. } => {
                through!(self.expression(expr));
                if !self.within(left.span()).is_empty() {
                    return Flow::Through;
                }
                self.body(body).or(Flow::Through)
            }
            StmtKind::Switch { expr, cases } => {
                through!(self.expression(expr));
                if cases.iter().any(|case| self.optional_expression(case.test()) != Flow::Through) {
                    return Flow::Unknown;
                }
                let has_default = cases.iter().any(Case::is_default);
                let mut all = if has_default { Flow::Unknown } else { Flow::Through };
                // From the start of the following case on.
                let mut next = Flow::Through;
                for at in (0..cases.len()).rev() {
                    let Some(case) = cases.get(at) else {
                        continue;
                    };
                    next = match self.statements(case.body(), 0) {
                        Flow::Through => next,
                        Flow::Leaves(jump) if matches!(jump.kind(), StmtKind::Break(None)) => Flow::Through,
                        flow => flow.or(Flow::Unknown),
                    };
                    all = all.or(next);
                }
                all
            }
            StmtKind::Try { block, finalizer, .. } => {
                through!(self.statement(block).or(Flow::Unknown));
                finalizer.map_or(Flow::Through, |finalizer| self.statement(finalizer).or(Flow::Unknown))
            }
            _ => Flow::Unknown,
        }
    }

    /// From the start of the body of a loop on. Only whether the variable is read matters.
    fn body(&mut self, body: Stmt<'a>) -> Flow<'a> {
        match self.statement(body) {
            Flow::Read => Flow::Read,
            _ => Flow::Unknown,
        }
    }

    /// Whether the variable can be read after the test of `a_loop`, which is `None` if it has none.
    fn is_read_after_test(&mut self, a_loop: Stmt<'a>, test: Option<Expr<'a>>, body: Stmt<'a>) -> bool {
        if !self.loops.contains(&a_loop) {
            self.loops.push(a_loop);
            if self.statement(body) == Flow::Read {
                return true;
            }
        }
        test.is_some_and(|test| !is_literal(test)) && self.is_read_after(a_loop)
    }

    fn is_read_from_test(&mut self, a_loop: Stmt<'a>, test: Option<Expr<'a>>, body: Stmt<'a>) -> bool {
        match self.optional_expression(test) {
            Flow::Read => true,
            Flow::Through => self.is_read_after_test(a_loop, test, body),
            _ => false,
        }
    }

    /// Whether the variable can be read after the end of the body of `a_loop`, where a `continue`
    /// leads too.
    fn is_read_after_body(&mut self, a_loop: Stmt<'a>) -> bool {
        match a_loop.kind() {
            StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
                self.is_read_from_test(a_loop, Some(test), body)
            }
            StmtKind::For {
                test, update, body, ..
            } => match self.optional_expression(update) {
                Flow::Read => true,
                Flow::Through => self.is_read_from_test(a_loop, test, body),
                _ => false,
            },
            StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
                if !self.loops.contains(&a_loop) {
                    self.loops.push(a_loop);
                    if self.within(left.span()).is_empty() && self.statement(body) == Flow::Read {
                        return true;
                    }
                }
                self.is_read_after(a_loop)
            }
            _ => false,
        }
    }

    /// Whether the variable can be read after a `break` or a `continue`.
    fn is_read_after_jump(&mut self, jump: Stmt<'a>) -> bool {
        let (label, is_break) = match jump.kind() {
            StmtKind::Break(label) => (label, true),
            StmtKind::Continue(label) => (label, false),
            _ => return false,
        };
        let mut inner = jump;
        for ancestor in Node::Stmt(jump).ancestors() {
            let Node::Stmt(target) = ancestor else {
                if matches!(ancestor, Node::Case(_)) {
                    continue;
                }
                return false;
            };
            // ESLint does not connect all of what leaves a `finally` block.
            if matches!(target.kind(), StmtKind::Try { finalizer, .. } if finalizer == Some(inner)) {
                return false;
            }
            inner = target;
            let is_loop = matches!(
                target.tag(),
                StmtTag::While | StmtTag::DoWhile | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf
            );
            match (target.kind(), label) {
                (StmtKind::Labeled { label: it, mut body }, Some(label)) if it == label => {
                    if is_break {
                        return self.is_read_after(target);
                    }
                    while let StmtKind::Labeled { body: inner, .. } = body.kind() {
                        body = inner;
                    }
                    return self.is_read_after_body(body);
                }
                (_, None) if is_loop && !is_break => return self.is_read_after_body(target),
                (_, None) if is_break && (is_loop || target.tag() == StmtTag::Switch) => {
                    return self.is_read_after(target);
                }
                _ => {}
            }
        }
        false
    }

    /// Whether the variable can be read after the end of `statement`, or an assignment in it is
    /// not reported for another reason.
    fn is_read_after(&mut self, mut statement: Stmt<'a>) -> bool {
        loop {
            let Some(budget) = self.budget.checked_sub(1) else {
                return false;
            };
            self.budget = budget;
            let parent = statement.parent();
            if let Some(list) = statement_list(parent) {
                let mut flow = self.statements(list, statement.span().end);
                let mut around = parent;
                if let (Node::Case(case), Node::Stmt(switch)) = (parent, parent.parent())
                    && let StmtKind::Switch { cases, .. } = switch.kind()
                {
                    // It falls through to the following cases.
                    let mut following = cases.iter().skip_while(|it| *it != case).skip(1);
                    while flow == Flow::Through
                        && let Some(next) = following.next()
                    {
                        flow = self.statements(next.body(), 0);
                    }
                    around = Node::Stmt(switch);
                }
                match (flow, around) {
                    (Flow::Read, _) => return true,
                    (Flow::Leaves(jump), _) => return self.is_read_after_jump(jump),
                    (Flow::Through, Node::Stmt(around)) => statement = around,
                    _ => return false,
                }
                continue;
            }
            let Node::Stmt(parent) = parent else {
                return false;
            };
            match parent.kind() {
                StmtKind::If { .. } | StmtKind::Labeled { .. } => {}
                // What is assigned in the block of a `try` statement is not reported.
                StmtKind::Try { block, .. } if block == statement => return true,
                // A `finally` block that is only entered by a `return` leads nowhere else.
                StmtKind::Try { finalizer, .. } if finalizer == Some(statement) => {
                    if !parent.is_known_to_complete() {
                        return false;
                    }
                }
                StmtKind::Try { finalizer, .. } => match finalizer.map_or(Flow::Through, |it| self.statement(it)) {
                    Flow::Read => return true,
                    Flow::Through => {}
                    _ => return false,
                },
                StmtKind::For {
                    init: Some(init),
                    test,
                    body,
                    ..
                } if init == statement => return self.is_read_from_test(parent, test, body),
                StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                    if body == statement =>
                {
                    return self.is_read_after_body(parent);
                }
                _ => return false,
            }
            statement = parent;
        }
    }

    /// Whether the statements tell that `written` is not reported.
    fn is_known_to_be_read(&mut self, written: &Written<'a>) -> bool {
        self.loops.clear();
        self.budget = 200;
        // Not the statement around a function whose body is an expression.
        let statement = written.node.ancestors().find_map(|it| match it {
            Node::Stmt(statement) => Some(Some(statement)),
            Node::Func(_) | Node::Member(_) => Some(None),
            _ => None,
        });
        let Some(statement) = statement.flatten() else {
            return false;
        };
        if !statement.is_reachable() {
            return true;
        }
        // The part of the statement that it is in.
        let part = match statement.kind() {
            StmtKind::Expr(_) | StmtKind::Var(_) => statement.span(),
            StmtKind::If { test, .. } | StmtKind::While { test, .. } => test.span(),
            StmtKind::For {
                init, test, update, ..
            } => {
                let parts = [init.map(Stmt::span), test.map(Expr::span), update.map(Expr::span)];
                match parts.into_iter().flatten().find(|it| it.contains(written.identifier)) {
                    Some(part) => part,
                    None => return false,
                }
            }
            _ => return false,
        };
        if !self.is_alone_in(written, part) {
            return false;
        }
        match statement.kind() {
            StmtKind::If { yes, no, .. } => {
                let yes = self.statement(yes);
                match yes.or(no.map_or(Flow::Through, |no| self.statement(no))) {
                    Flow::Read => true,
                    Flow::Through => self.is_read_after(statement),
                    _ => false,
                }
            }
            StmtKind::While { test, body } => self.is_read_after_test(statement, Some(test), body),
            StmtKind::For { test, body, .. } => match test {
                Some(test) if test.span() == part => self.is_read_after_test(statement, Some(test), body),
                _ => self.is_read_from_test(statement, test, body),
            },
            _ => self.is_read_after(statement),
        }
    }
}

impl NoUselessAssignment {
    /// Finds out whether the code path that `variable` is declared in has to be analyzed.
    fn check_variable<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        if !variable.has_writes() || !variable.has_reads() {
            return;
        }
        let mut uses = Uses::of(variable);
        // What a function assigns to a variable from outside it is not looked at.
        let is_unknown = variable.references().filter(|it| it.is_write()).any(|reference| {
            written_by(reference).is_some_and(|written| !uses.is_known_to_be_read(&written))
                && code_path_scope(reference.scope()) == code_path_scope(variable.scope())
        });
        if !is_unknown {
            return;
        }
        let Some(scope) = code_path_scope(variable.scope()) else {
            return;
        };
        // What a function reads can be read at any time.
        if variable.references().any(|it| it.is_read() && code_path_scope(it.scope()) != Some(scope)) {
            return;
        }
        let root = match (scope.kind(), scope.node()) {
            (ScopeKind::ClassStaticBlock, Node::Func(func)) => func.owner(),
            (_, node) => node,
        };
        if !cx.state.roots.contains(&root) {
            cx.state.roots.push(root);
        }
    }

    fn check_code_path<'a>(&self, root: Node<'a>, cx: &mut Cx<'a, Self>) {
        let enter = NodeTags::from(StmtTag::Try) | ExprTag::Ident.into();
        let exit = NodeTags::VAR_DECL | ExprTag::Assign.into() | ExprTag::Unary.into();
        for step in steps_of_code_path(root, enter, exit) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) => self.on_code_path_start(path, node, cx),
                Step::Event(Event::CodePathEnd(path, node)) => self.on_code_path_end(path, node, cx),
                Step::Event(Event::SegmentStart(segment, node)) => self.on_segment_start(segment, node, cx),
                Step::Event(Event::SegmentEnd(segment, node)) => self.on_segment_end(segment, node, cx),
                Step::Event(_) => {}
                Step::Enter(node @ Node::Stmt(_)) => self.on_try_statement(node, cx),
                Step::Enter(node) => self.on_identifier(node, cx),
                Step::Exit(node) => self.on_assignment_exit(node, cx),
            }
        }
    }

    fn verify<'a>(target: ScopeStack<'a>, cx: &Cx<'a, Self>) {
        'variables: for (variable, mut assignments) in target.assignments {
            let mut read_references: SmallVec<[Span; 8]> = SmallVec::new();
            for reference in variable.references().filter(|it| it.is_read()) {
                // It can be called at any time.
                let start = get_code_path_start_scope(&cx.state.code_path_start_scopes, reference.scope());
                if start != Some(target.scope) {
                    continue 'variables;
                }
                read_references.push(reference.span());
            }
            // That is for `no-unused-vars` to report.
            if read_references.is_empty() {
                continue;
            }
            assignments.sort_by_key(|it| it.identifier.start);
            for (index, assignment) in assignments.iter().enumerate() {
                let identifier = assignment.identifier;
                if !target.try_statement_blocks.iter().any(|block| block.contains(identifier))
                    && is_assignment_unused(index, &assignments, &read_references, &cx.state.identifier_ranges)
                {
                    cx.report(identifier, UNNECESSARY_ASSIGNMENT).data("name", variable.name());
                }
            }
        }
    }

    fn add_assignment<'a>(
        variable: Option<Symbol<'a>>,
        identifier: Span,
        expression: Option<Span>,
        cx: &mut Cx<'a, Self>,
    ) {
        let state = &mut cx.state;
        let (Some(variable), Some(top)) = (variable, state.stack.last_mut()) else {
            return;
        };
        let scope = variable.scope();
        if get_code_path_start_scope(&state.code_path_start_scopes, scope) != Some(top.scope)
            || variable.is_marked_used()
            || scope.kind() == ScopeKind::Module && is_exported(variable)
        {
            return;
        }
        top.assignments.entry(variable).or_default().push(Assignment {
            identifier,
            expression,
            segments: state.current_segments.iter().collect(),
        });
    }

    fn on_code_path_start<'a>(&self, _: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let scope = node.scope();
        cx.state.stack.push(ScopeStack {
            scope,
            assignments: FxHashMap::default(),
            try_statement_blocks: Vec::new(),
        });
        cx.state.current_segments.code_path_start();
        cx.state.code_path_start_scopes.insert(scope);
    }

    fn on_code_path_end<'a>(&self, _: CodePath<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.current_segments.code_path_end();
        if let Some(target) = cx.state.stack.pop() {
            Self::verify(target, cx);
        }
    }

    fn on_segment_start<'a>(&self, segment: Segment<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.current_segments.segment_start(segment);
        let needed = segment.id() as usize + 1;
        if cx.state.identifier_ranges.len() < needed {
            cx.state.identifier_ranges.resize(needed, NO_IDENTIFIERS);
        }
    }

    fn on_segment_end<'a>(&self, segment: Segment<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.current_segments.segment_end(segment);
    }

    fn on_try_statement<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Stmt(statement) = node
            && let StmtKind::Try { block, .. } = statement.kind()
            && let Some(top) = cx.state.stack.last_mut()
        {
            top.try_statement_blocks.push(block.span());
        }
    }

    fn on_identifier<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let identifier = node.span();
        let state = &mut cx.state;
        for segment in state.current_segments.iter() {
            if let Some(range) = state.identifier_ranges.get_mut(segment.id() as usize) {
                if *range == NO_IDENTIFIERS {
                    range.start = identifier.start;
                }
                range.end = identifier.end;
            }
        }
    }

    /// Leaving a `VariableDeclarator`, an `AssignmentExpression` or an `UpdateExpression`.
    fn on_assignment_exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if cx.state.current_segments.as_slice().is_empty() {
            return;
        }
        let (pattern, expression) = match node {
            Node::VarDecl(declarator) => {
                let Some(init) = declarator.init() else {
                    return;
                };
                let id = declarator.pat();
                id.for_each_binding(&mut |pat| {
                    // With typescript-eslint's parser the annotation is part of the identifier.
                    let identifier = if pat == id { declarator.binding_span() } else { pat.span() };
                    Self::add_assignment(pat.symbol(), identifier, Some(init.span()), cx);
                });
                return;
            }
            Node::Expr(e) => match e.kind() {
                // In a pattern it is a default value.
                ExprKind::Assign { target, value, .. } if !utils::is_assignment_target(e) => {
                    (target, Some(value.span()))
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PostInc | UnOp::PreDec | UnOp::PostDec,
                    operand,
                } => (operand, None),
                _ => return,
            },
            _ => return,
        };
        extract_identifiers_from_pattern(pattern, &mut |identifier| {
            let variable = identifier.reference().and_then(Reference::symbol);
            Self::add_assignment(variable, identifier.span(), expression, cx);
        });
    }
}

impl Rule for NoUselessAssignment {
    const META: Meta = Meta::eslint("no-useless-assignment", Kind::Problem).recommended();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUselessAssignment
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        if !file.has_stmts([StmtTag::Var]) && !file.has_exprs([ExprTag::Assign, ExprTag::Unary]) {
            return State::default();
        }
        on.symbols(Self::check_variable);
        on.finish(|rule, cx| {
            for root in std::mem::take(&mut cx.state.roots) {
                rule.check_code_path(root, cx);
            }
        });
        State::default()
    }
}
