use bun_lint::code_path::CurrentSegments;
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

impl NoUselessAssignment {
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
        on.code_path_start(Self::on_code_path_start);
        on.code_path_end(Self::on_code_path_end);
        on.segment_start(Self::on_segment_start);
        on.segment_end(Self::on_segment_end);
        on.enter(StmtTag::Try, Self::on_try_statement);
        on.enter(ExprTag::Ident, Self::on_identifier);
        on.exit(
            NodeTags::VAR_DECL | ExprTag::Assign.into() | ExprTag::Unary.into(),
            Self::on_assignment_exit,
        );
        State::default()
    }
}
