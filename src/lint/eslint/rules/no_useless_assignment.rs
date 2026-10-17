use bun_lint::code_path::{CurrentSegments, Event, Step, starts_code_path, steps_of_code_path};
use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;
use bun_lint::types::IdSet;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_scope::is_type_only_reference;
use bun_lint_oxlint::module_record::ModuleRecord;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::{SmallVec, smallvec};
use std::collections::hash_map::Entry;
use std::ops::Range;

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
    /// `None` for a variable that is not looked at.
    assignments: FxHashMap<Binding<'a>, Option<Assignments<'a>>>,
    /// In the order of the source.
    try_statement_blocks: Vec<Span>,
    /// Those of them that have a `finally`, with a configuration of oxlint.
    finalized_blocks: Vec<Span>,
    /// With a configuration of oxlint: the `while` and `for` statements whose test is a literal or missing.
    endless_loops: Vec<Span>,
}

#[derive(Default)]
pub struct State<'a> {
    /// What the code paths to analyze start with: those that assign to a variable where the
    /// statements alone do not tell that the value is read.
    roots: FxHashSet<Node<'a>>,
    /// The variables of which they do not tell. Nothing is reported about the others.
    unknown: FxHashSet<Binding<'a>>,
    /// With a configuration of oxlint: the names under which the module exports something.
    exported: Option<FxHashMap<Name<'a>, Span>>,
    /// In a debug build: what all code paths with a variable that is looked at start with, and whether one is analyzed only to
    /// see that nothing is reported in it.
    all_roots: FxHashSet<Node<'a>>,
    is_only_checked: bool,
    stack: Vec<ScopeStack<'a>>,
    /// Only the reachable ones.
    current_segments: CurrentSegments<'a>,
    code_path_start_scopes: IdSet<Scope<'a>>,
    /// For `is_read_after_declaration`: the statement that an expression is evaluated in.
    evaluated_in: AncestorMemo<'a, Option<Stmt<'a>>>,
    /// Of the variable that is looked at.
    uses: Uses<'a>,
    /// By the id of a segment: from the start of the first identifier in it to the end of the last.
    /// Only identifiers that are expressions count, as only the place of those is asked for.
    identifier_ranges: Vec<Span>,
}

const NO_IDENTIFIERS: Span = Span::new(u32::MAX, 0);

/// ESLint's `extractIdentifiersFromPattern`, for the target of an assignment.
fn extract_identifiers_from_pattern<'a>(pattern: Expr<'a>, mut visit: impl FnMut(Expr<'a>)) {
    let mut stack: SmallVec<[Expr<'a>; 8]> = smallvec![pattern];
    while let Some(pattern) = stack.pop() {
        match pattern.kind() {
            ExprKind::Ident(_) => visit(pattern),
            ExprKind::Object(properties) => stack.extend(properties.iter().filter_map(Prop::value)),
            ExprKind::Array(elements) => stack.extend(elements),
            ExprKind::Spread(argument) => stack.push(argument),
            ExprKind::Assign { target, .. } => stack.push(target),
            _ => {}
        }
    }
}

fn is_identifier_evaluated_after_assignment(assignment: &Assignment<'_>, identifier: Span) -> bool {
    identifier.start >= assignment.identifier.end
        // `x = id`: it is evaluated before the assignment.
        && !assignment.expression.is_some_and(|expression| expression.contains(identifier))
}

/// `let { x, y = x } = obj`
fn is_identifier_used_between_assigned_and_equal_sign(
    assignment: &Assignment<'_>,
    identifier: Span,
) -> bool {
    assignment.expression.is_some_and(|expression| {
        assignment.identifier.end <= identifier.start && identifier.end <= expression.start
    })
}

fn get_code_path_start_scope<'a>(
    scope: Scope<'a>,
    code_path_start_scopes: &IdSet<Scope<'a>>,
) -> Option<Scope<'a>> {
    scope.chain().find(|it| code_path_start_scopes.contains(*it))
}

/// Whether `reference`, which is in the code path that starts with `scope` by its own scope, is in the decorator of a parameter
/// of a function in it: that is in the scope around the function and in the code path of the function.
fn is_in_decorator_of_parameter<'a>(reference: Reference<'a>, scope: Scope<'a>) -> bool {
    let is_part_of_expression = |it: &Node<'a>| matches!(it, Node::Expr(_) | Node::Prop(_));
    !scope.node().file().is_javascript()
        && matches!(
            reference.node().ancestors().find(|it| !is_part_of_expression(it)),
            Some(Node::Param(param)) if param.func().and_then(Func::scope) != Some(scope)
        )
}

/// What oxlint 1.87 takes for the declaration of `variable`: the first, if that is a declarator.
fn oxlint_declarator(variable: Symbol<'_>) -> Option<VarDecl<'_>> {
    let first @ Declaration::Var(name) = variable.declarations().next()? else {
        return None;
    };
    if variable
        .declaration_kinds()
        .contains(DeclarationKinds::CATCH_CLAUSE)
        && first.is_catch_parameter()
    {
        return None;
    }
    match name.parent() {
        Node::VarDecl(declarator) => Some(declarator),
        _ => first.node().and_then(|it| match it {
            Node::VarDecl(declarator) => Some(declarator),
            _ => None,
        }),
    }
}

/// oxlint 1.87 says nothing about what is first declared by something else than `var`, `let` or `using`: a parameter, also that
/// of a `catch`, a function, a class, the `arguments` of a function, a `const`. Nor about what is declared with a function as
/// its value.
fn oxlint_passes_over(variable: Symbol) -> bool {
    variable.file().language().is_oxlint
        && oxlint_declarator(variable).is_none_or(|it| {
            it.var_kind() == VarKind::Const
                || it
                    .init()
                    .is_some_and(|it| it.tag() == ExprTag::Fn && !it.is_parenthesized())
        })
}

/// For oxlint 1.87 a variable of any scope is exported if the module exports something under its name.
fn oxlint_takes_for_exported<'a>(
    variable: Symbol<'a>,
    exported: &mut Option<FxHashMap<Name<'a>, Span>>,
) -> bool {
    variable.file().language().is_oxlint
        && (exported.get_or_insert_with(|| ModuleRecord::new(variable.file()).exported_bindings))
            .contains_key(&variable.name())
}

/// For oxlint 1.87 only the first declarator of `var a = 1; var a = 2;` gives `a` a value. `at`: where the name is written in
/// a declarator with an initializer.
#[inline(never)]
fn oxlint_does_not_see(variable: Symbol, at: u32) -> bool {
    variable.file().language().is_oxlint
        && oxlint_declarator(variable).is_none_or(|it| !it.span().contains_offset(at))
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

/// A variable as ESLint has it. The name of a class declaration is two of them: one in the scope
/// around the class, and one in the scope of the class, which is what the name means in the class,
/// from the `extends` on.
#[derive(Copy, Clone, PartialEq, Eq)]
struct Binding<'a> {
    symbol: Symbol<'a>,
    /// For the variable in the scope of a class declaration.
    class: Option<Class<'a>>,
}

impl std::hash::Hash for Binding<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.symbol.hash(state);
    }
}

impl<'a> Binding<'a> {
    /// What `symbol` is in the scope that it is declared in.
    fn outer(symbol: Symbol<'a>) -> Binding<'a> {
        Binding {
            symbol,
            class: None,
        }
    }

    /// What `reference`, which is one to `symbol`, refers to.
    fn of(symbol: Symbol<'a>, reference: Reference<'a>) -> Binding<'a> {
        if !(symbol.declaration_kinds()).contains(DeclarationKinds::CLASS_NAME) {
            return Binding::outer(symbol);
        }
        let class = match symbol.variable_in(reference.scope()).kind() {
            VariableKind::NameInClass { class, .. } => Some(class),
            _ => None,
        };
        Binding { symbol, class }
    }

    fn scope(self) -> Scope<'a> {
        self.class
            .and_then(Class::scope)
            .unwrap_or_else(|| self.symbol.scope())
    }

    /// Whether `reference`, which is one to `symbol`, is one to this. For oxlint `typeof a` in a type is none, which writes
    /// nothing.
    #[inline(always)]
    fn has(self, reference: Reference<'a>) -> bool {
        let symbol = self.symbol;
        (reference.is_write()
            || !symbol.file().language().is_oxlint
            || !is_type_only_reference(symbol, reference))
            && (!(symbol.declaration_kinds()).contains(DeclarationKinds::CLASS_NAME)
                || Binding::of(symbol, reference) == self)
            && !(reference.is_init()
                && symbol.declaration_count() > 1
                && oxlint_does_not_see(symbol, reference.ident().start()))
    }

    fn references(self) -> impl Iterator<Item = Reference<'a>> {
        self.symbol.references().filter(move |&it| self.has(it))
    }
}

const NONE: u32 = u32::MAX;

fn intersection(a: Range<usize>, b: Range<usize>) -> Range<usize> {
    a.start.max(b.start)..a.end.min(b.end)
}

/// Whether something of `range` is not in `without`.
fn is_any_outside(range: &Range<usize>, without: &Range<usize>) -> bool {
    range.start < range.end && (range.start < without.start || without.end < range.end)
}

/// Where a variable is assigned to and where it is read, all in one code path.
struct Variable<'a, 'v> {
    /// In the order of the source.
    assignments: &'v [Assignment<'a>],
    /// In the order of the source.
    reads: &'v [Span],
    /// `State::identifier_ranges`
    ranges: &'v [Span],
    /// The id of a segment with the index of an assignment that was made in it, sorted.
    in_segments: SmallVec<[(u32, u32); 8]>,
}

impl<'a, 'v> Variable<'a, 'v> {
    fn new(assignments: &'v [Assignment<'a>], reads: &'v [Span], ranges: &'v [Span]) -> Self {
        let mut in_segments: SmallVec<[(u32, u32); 8]> = (assignments.iter().enumerate())
            .flat_map(|(index, it)| {
                it.segments
                    .iter()
                    .map(move |segment| (segment.id(), index as u32))
            })
            .collect();
        in_segments.sort_unstable();
        Variable {
            assignments,
            reads,
            ranges,
            in_segments,
        }
    }

    /// How many of `reads` start before `offset`.
    fn reads_before(&self, offset: u32) -> usize {
        self.reads.partition_point(|it| it.start < offset)
    }

    /// Which of `reads` are in `span`.
    fn reads_in(&self, span: Span) -> Range<usize> {
        self.reads_before(span.start)..self.reads.partition_point(|it| it.end <= span.end)
    }

    /// ESLint's `isIdentifierUsedInSegment`, for all of `reads`.
    fn reads_in_segment(&self, id: u32) -> Range<usize> {
        self.ranges
            .get(id as usize)
            .map_or(0..0, |&range| self.reads_in(range))
    }

    /// Whether the variable is read in a segment, and if `first` is assigned there, not after that.
    fn is_read_in(&self, id: u32, first: Option<&Assignment<'a>>) -> bool {
        let all = self.reads_in_segment(id);
        let Some(first) = first else {
            return !all.is_empty();
        };
        all.start < all.end.min(self.reads_before(first.identifier.end))
            || first
                .expression
                .is_some_and(|it| !intersection(all, self.reads_in(it)).is_empty())
    }

    /// For each assignment, the index of the first of the others that was made in one of its
    /// segments and is evaluated after it, or `NONE`.
    fn next_assignments(&self) -> SmallVec<[u32; 8]> {
        let mut next: SmallVec<[u32; 8]> = smallvec![NONE; self.assignments.len()];
        let get = |index: u32| self.assignments.get(index as usize);
        let expression = |index: u32| get(index).and_then(|it| it.expression).unwrap_or_default();
        // The assignments whose expression the walk is in, the outermost first, and those whose
        // expression is still to come, the last to come first: `[x, y = (x = 1)] = z`.
        let (mut around, mut ahead): (SmallVec<[u32; 4]>, SmallVec<[u32; 4]>) = Default::default();
        for in_segment in self.in_segments.chunk_by(|a, b| a.0 == b.0) {
            around.clear();
            ahead.clear();
            for (at, &(_, index)) in in_segment.iter().enumerate() {
                let (Some(target), Some(found)) = (get(index), next.get_mut(index as usize)) else {
                    continue;
                };
                let identifier = target.identifier;
                while around
                    .last()
                    .is_some_and(|&it| expression(it).end < identifier.end)
                {
                    around.pop();
                }
                let started = ahead.partition_point(|&it| expression(it).start > identifier.start);
                around.extend(
                    ahead
                        .drain(started..)
                        .filter(|&it| expression(it).end >= identifier.end),
                );
                // `x = (x = 1)`
                if let Some(&outermost) = around.first() {
                    *found = outermost.min(*found);
                }
                if target.expression.is_some() {
                    ahead.push(index);
                }
                // What is in its expression is evaluated before it.
                let rest = &in_segment[at + 1..];
                let is_before = |it: &(u32, u32)| {
                    get(it.1).is_some_and(|it| {
                        !is_identifier_evaluated_after_assignment(target, it.identifier)
                    })
                };
                let skipped = if rest.first().is_some_and(is_before) {
                    rest.partition_point(is_before)
                } else {
                    0
                };
                if let Some(&(_, following)) = rest.get(skipped) {
                    *found = following.min(*found);
                }
            }
        }
        next
    }

    /// Whether the variable is read in a segment of `target` after it, and if `next` is given, not
    /// after that.
    fn is_read_at_once(&self, target: &Assignment<'a>, next: Option<&Assignment<'a>>) -> bool {
        let after = self.reads_before(target.identifier.end)..self.reads.len();
        // `x = id`: it is evaluated before the assignment.
        let before = target.expression.map_or(0..0, |it| self.reads_in(it));
        // `let { x, y = x } = obj`
        let between = target.expression.map_or(0, |it| {
            self.reads.partition_point(|read| read.end <= it.start)
        });
        let in_segments = target
            .segments
            .iter()
            .map(|it| self.reads_in_segment(it.id()));
        std::iter::once(0..between).chain(in_segments).any(|place| {
            let place = intersection(place, after.clone());
            let Some(next) = next else {
                return is_any_outside(&place, &before);
            };
            let until_next = place.start..place.end.min(self.reads_before(next.identifier.end));
            is_any_outside(&until_next, &before)
                || (next.expression).is_some_and(|it| {
                    is_any_outside(&intersection(place, self.reads_in(it)), &before)
                })
        })
    }

    /// The first assignment in a segment that counts for `target`: `[x, y = (x = 1)] = z` does not
    /// count for the one in it.
    fn first_assignment_in(&self, id: u32, target: &Assignment<'a>) -> Option<&'v Assignment<'a>> {
        let assignments = self.assignments;
        let get = |it: &(u32, u32)| assignments.get(it.1 as usize);
        let from = self.in_segments.partition_point(|it| it.0 < id);
        let in_segment = self.in_segments.get(from..).unwrap_or_default();
        let in_segment = in_segment
            .get(..in_segment.partition_point(|it| it.0 == id))
            .unwrap_or_default();
        (in_segment.iter().filter_map(get))
            .find(|it| !is_identifier_used_between_assigned_and_equal_sign(it, target.identifier))
    }

    /// Walks forward from the end of `target`'s segments, through segments that don't assign to the variable, and returns
    /// whether the variable is read along the way. Calls `overwritten` with each assignment that ends a path.
    fn is_read_later(
        &self,
        target: &Assignment<'a>,
        mut overwritten: impl FnMut(&Assignment<'a>),
    ) -> bool {
        let mut seen: IdSet<Segment<'a>> = IdSet::new();
        let mut stack: SmallVec<[Segment<'a>; 16]> = target
            .segments
            .iter()
            .flat_map(|it| it.next_segments())
            .collect();
        while let Some(segment) = stack.pop() {
            let id = segment.id();
            if !seen.insert(segment) {
                continue;
            }
            let first = self.first_assignment_in(id, target);
            if self.is_read_in(id, first) {
                return true;
            }
            match first {
                Some(first) => overwritten(first),
                None => stack.extend(segment.next_segments()),
            }
        }
        false
    }

    /// The hint for an assignment that [`Variable::is_assignment_unused`] flagged. Says what happens to the value.
    fn hint(&self, index: usize, next: u32, file: &File<'a>) -> Option<String> {
        let mut lines: SmallVec<[u32; 4]> = SmallVec::new();
        let mut overwritten = |it: &Assignment<'a>| lines.push(file.line_of(it.identifier.start));
        match self.assignments.get(next as usize) {
            Some(next) => overwritten(next),
            None => _ = self.is_read_later(self.assignments.get(index)?, overwritten),
        }
        lines.sort_unstable();
        lines.dedup();
        let places = match lines[..] {
            [] => return Some("Nothing reads it after this.".to_owned()),
            [line] => format!("line {line}"),
            [first, second] => format!("line {first} and line {second}"),
            [first, second, third] => format!("lines {first}, {second} and {third}"),
            [first, second, third, ref others @ ..] => {
                format!("lines {first}, {second}, {third} and {} more", others.len())
            }
        };
        Some(format!("It is overwritten on {places} before it is read."))
    }

    /// Whether nothing reads the value that `assignments[index]` assigns. `next`: what
    /// `next_assignments` tells for it.
    fn is_assignment_unused(&self, index: usize, next: u32) -> bool {
        let assignments = self.assignments;
        let Some(target) = assignments.get(index) else {
            return false;
        };
        let next = assignments.get(next as usize);
        !self.is_read_at_once(target, next)
            && (next.is_some() || !self.is_read_later(target, |_| {}))
    }
}

// ───────────────────────────── without code paths ─────────────────────────────
//
// Nearly every value that is assigned is read, and the statements tell: there is a way from the
// assignment to a place where the variable is read that does not lead over another assignment.
// Each step of such a way is one of the code path too, so that the assignment is not reported. What
// cannot be told this way is left to the analysis.

/// Where the name starts.
#[inline]
fn start_of(reference: &Reference<'_>) -> u32 {
    reference.ident().start()
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
    identifier: Reference<'a>,
    /// What is evaluated before the assignment.
    expression: Option<Span>,
    /// The `VariableDeclarator`, `AssignmentExpression` or `UpdateExpression`.
    node: Node<'a>,
}

/// `Written::node` and `Written::expression` of the assignment that a node is a target of.
type Writer<'a> = Option<(Node<'a>, Option<Span>)>;

/// The assignment that a reference that writes is part of. `None` if the rule does not see one: the
/// head of a `for`-`in`, the default value of a parameter.
fn written_by<'a>(
    reference: Reference<'a>,
    writers: &mut AncestorMemo<'a, Writer<'a>>,
) -> Option<Written<'a>> {
    let identifier = reference
        .expr()
        .map_or_else(|| reference.node(), Node::Expr);
    // `let a = 1`
    if let Node::Pat(pat) = identifier
        && let Node::VarDecl(declarator) = pat.parent()
    {
        return Some(Written {
            identifier: reference,
            expression: Some(declarator.init()?.span()),
            node: Node::VarDecl(declarator),
        });
    }
    let writer = writers.find(identifier, |current, parent| match parent {
        Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_) | Node::Prop(_) => None,
        Node::VarDecl(declarator) => Some(declarator.init().map(|it| (parent, Some(it.span())))),
        Node::Expr(e) => match e.kind() {
            ExprKind::Assign { target, value, .. } if Node::Expr(target) == current => {
                (!utils::is_assignment_target(e)).then(|| Some((parent, Some(value.span()))))
            }
            ExprKind::Unary { .. } if matches!(current, Node::Expr(it) if it.tag() == ExprTag::Ident) =>
            {
                Some(Some((parent, None)))
            }
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Spread(_) => None,
            _ => Some(None),
        },
        _ => Some(None),
    });
    let (node, expression) = writer??;
    Some(Written {
        identifier: reference,
        expression,
        node,
    })
}

/// [`is_read_after_declarator`], if `written`, the only assignment to `variable` in its code path, is the initializer of a
/// declarator.
fn is_read_after_declaration<'a>(
    variable: Symbol<'a>,
    written: Reference<'a>,
    (writers, evaluated_in): (
        &mut AncestorMemo<'a, Writer<'a>>,
        &mut AncestorMemo<'a, Option<Stmt<'a>>>,
    ),
) -> bool {
    written.expr().is_none()
        && variable.declaration_count() == 1
        && matches!(
            written_by(written, writers).map(|it| it.node),
            Some(Node::VarDecl(declarator)) if is_read_after_declarator(variable, declarator, evaluated_in)
        )
}

/// Whether `declarator`, the only declaration of `variable` and the only assignment to it in its code path, is one with
/// `let`, `const` or `using` in a list of statements, and a statement that can be reached evaluates the variable after
/// it, in the same function. That is in the block of the list, where every way to it leads over the declaration.
fn is_read_after_declarator<'a>(
    variable: Symbol<'a>,
    declarator: VarDecl<'a>,
    evaluated_in: &mut AncestorMemo<'a, Option<Stmt<'a>>>,
) -> bool {
    if declarator.var_kind() == VarKind::Var || declarator.init().is_none() {
        return false;
    }
    let Node::Stmt(declaration) = declarator.parent() else {
        return false;
    };
    let is_in_list = match declaration.parent() {
        Node::Func(_) | Node::File(_) => true,
        Node::Stmt(around) => around.tag() == StmtTag::Module || around.as_block().is_some(),
        _ => false,
    };
    if !is_in_list {
        return false;
    }
    let (end, scope) = (declarator.span().end, variable.scope());
    let read = variable.references().find(|&it| {
        it.is_read()
            && start_of(&it) >= end
            && (it.scope() == scope || it.scope().variable_scope() == scope.variable_scope())
            && Binding::outer(variable).has(it)
    });
    let Some(identifier) = read.and_then(Reference::expr) else {
        return false;
    };
    // Mostly the statement is near.
    let (mut node, mut statement) = (Node::Expr(identifier), None);
    for _ in 0..16 {
        node = node.parent();
        match node {
            Node::Expr(_) | Node::Prop(_) | Node::VarDecl(_) => {}
            Node::Stmt(it) => {
                statement = Some(Some(it));
                break;
            }
            _ => return false,
        }
    }
    let statement = statement.or_else(|| {
        evaluated_in.find(node, |_, parent| match parent {
            Node::Expr(_) | Node::Prop(_) | Node::VarDecl(_) => None,
            Node::Stmt(statement) => Some(Some(statement)),
            _ => Some(None),
        })
    });
    // Not where the body of a loop comes first.
    statement.flatten().is_some_and(|it| {
        matches!(
            it.tag(),
            StmtTag::Expr
                | StmtTag::Var
                | StmtTag::Return
                | StmtTag::Throw
                | StmtTag::If
                | StmtTag::While
                | StmtTag::Switch
                | StmtTag::ForIn
                | StmtTag::ForOf
        ) && it.is_reachable()
    })
}

/// The scope that the code path around `scope` starts with.
fn code_path_scope(scope: Scope<'_>) -> Option<Scope<'_>> {
    scope.chain().find(|it| match it.kind() {
        ScopeKind::Global | ScopeKind::ClassStaticBlock => true,
        ScopeKind::Function | ScopeKind::ClassFieldInitializer => {
            !matches!(it.node(), Node::File(_)) && starts_code_path(it.node())
        }
        _ => false,
    })
}

/// What the code path around `scope` starts with.
fn code_path_root(scope: Scope<'_>) -> Option<Node<'_>> {
    let scope = code_path_scope(scope)?;
    Some(match (scope.kind(), scope.node()) {
        (ScopeKind::ClassStaticBlock, Node::Func(func)) => func.owner(),
        (_, node) => node,
    })
}

/// Where a variable is used, to look for ways from an assignment to a place where it is read.
#[derive(Default)]
struct Uses<'a> {
    /// In source order.
    all: Vec<Reference<'a>>,
    /// For every variable: the innermost `a ? b : c` in the statement of a node that has the node in its `b`.
    conditions: AncestorMemo<'a, Option<Expr<'a>>>,
    /// For every variable: for `written_by`.
    writers: AncestorMemo<'a, Writer<'a>>,
    /// The loops whose body has been looked at from its start.
    loops: IdSet<Stmt<'a>>,
    /// How many more statements to look at.
    budget: u32,
    /// What a module exports is not reported.
    is_in_module_scope: bool,
}

impl<'a> Uses<'a> {
    /// `references`: those to `variable` in its code path.
    fn look_at(&mut self, variable: Binding<'a>, references: impl Iterator<Item = Reference<'a>>) {
        self.all.clear();
        self.all.extend(references);
        if !self.all.is_sorted_by_key(start_of) {
            utils::sort::sort_unstable_by_key(&mut self.all, start_of);
        }
        self.is_in_module_scope = variable.scope().kind() == ScopeKind::Module;
    }

    /// How many of `uses`, which are in source order, start before `offset`. Most variables have few.
    #[inline]
    fn count_before(uses: &[Reference<'a>], offset: u32) -> usize {
        match uses.len() {
            0..=8 => uses.iter().take_while(|it| start_of(it) < offset).count(),
            _ => uses.partition_point(|it| start_of(it) < offset),
        }
    }

    fn within(&self, span: Span) -> &[Reference<'a>] {
        let from = &self.all[Self::count_before(&self.all, span.start)..];
        &from[..Self::count_before(from, span.end)]
    }

    /// The first use that does not start before `offset`.
    fn first_from(&self, offset: u32) -> Option<Reference<'a>> {
        self.all.get(Self::count_before(&self.all, offset)).copied()
    }

    fn first_within(&self, span: Span) -> Option<Reference<'a>> {
        self.first_from(span.start)
            .filter(|it| start_of(it) < span.end)
    }

    /// Whether `written` and what it evaluates first are the only uses in `span`.
    fn is_alone_in(&self, written: &Written<'a>, span: Span) -> bool {
        let identifier = start_of(&written.identifier);
        self.within(span).iter().all(|it| {
            start_of(it) == identifier
                || !it.is_write()
                    && written
                        .expression
                        .is_some_and(|expression| expression.contains_offset(start_of(it)))
        })
    }

    /// Whether one more step can be taken.
    fn spends(&mut self) -> bool {
        self.budget = self.budget.saturating_sub(1);
        self.budget > 0
    }

    /// From `start` to `end`, both in one expression or list of declarators. ESLint's code path follows the order of the
    /// source there, but for what is not evaluated: the `c` of `a ? b : c` after something in `b`, which `after` is if it is
    /// given, and what [`Uses::way_around`] leaves out.
    ///
    /// `counts_in_type`: whether a name in a type that starts there, which is not evaluated, is taken for a read.
    fn part(
        &mut self,
        mut after: Option<Node<'a>>,
        (start, end): (u32, u32),
        counts_in_type: &dyn Fn(u32) -> bool,
    ) -> Flow<'a> {
        let condition_around = |child: Node<'a>, parent: Node<'a>| match parent {
            Node::Expr(it) => it
                .as_cond()
                .filter(|it| Node::Expr(it.1) == child)
                .map(|_| Some(it)),
            Node::Stmt(_) | Node::Func(_) | Node::Member(_) | Node::File(_) => Some(None),
            _ => None,
        };
        // From where on uses are looked for, and from where on something can be left out.
        let (mut offset, mut floor) = (start, start);
        'uses: loop {
            let Some(next) = self.first_within(Span::new(offset, end)) else {
                return Flow::Through;
            };
            while let Some(inner) = after
                && let Some(condition) = self.conditions.find(inner, condition_around).flatten()
                && let Some((_, yes, _)) = condition.as_cond()
                && start_of(&next) >= yes.span().end
            {
                after = Some(Node::Expr(condition));
                if start_of(&next) < condition.span().end {
                    offset = condition.span().end;
                    continue 'uses;
                }
            }
            if next.is_read() {
                let is_in_type = next
                    .symbol()
                    .is_some_and(|it| is_type_only_reference(it, next));
                return if is_in_type && !counts_in_type(start_of(&next)) {
                    Flow::Unknown
                } else {
                    Flow::Read
                };
            }
            // `x = f(x)`
            let evaluated_first = written_by(next, &mut self.writers).and_then(|it| it.expression);
            if evaluated_first
                .and_then(|it| self.first_within(it))
                .is_some_and(|it| it.is_read())
            {
                return Flow::Read;
            }
            match self.way_around(next.node(), floor) {
                Some(way) => (offset, floor) = way,
                None => return Flow::Unknown,
            }
        }
    }

    /// `&&`, `||` or `??`, if `e` is `a && b` or `a &&= b`.
    fn logical_operator(e: Expr<'a>) -> Option<BinOp> {
        (e.binary_op().or_else(|| e.assign_op().flatten()))
            .filter(|it| matches!(it, BinOp::And | BinOp::Or | BinOp::Nullish))
    }

    /// A way on which `node` is not evaluated: it is in the `b` of `a && b` or in a branch of `a ? b : c`, which starts at
    /// `floor` or later. Returned is where the way goes on, and from where on something can be left out then: not what the
    /// way has to lead through.
    fn way_around(&mut self, node: Node<'a>, floor: u32) -> Option<(u32, u32)> {
        let mut child = node;
        while child.span().start >= floor && self.spends() {
            let parent = child.parent();
            match parent {
                Node::Expr(e) => {
                    if let Some((_, yes, no)) = e.as_cond() {
                        if Node::Expr(yes) == child {
                            return Some((yes.span().end, no.span().start + 1));
                        }
                        if Node::Expr(no) == child {
                            return Some((no.span().end, floor));
                        }
                    } else if Self::logical_operator(e).is_some()
                        && e.right().map(Node::Expr) == Some(child)
                    {
                        return self.way_after_left_operand(e, floor);
                    }
                }
                Node::Prop(_) | Node::VarDecl(_) => {}
                _ => return None,
            }
            child = parent;
        }
        None
    }

    /// [`Uses::way_around`] the right operand of `logical`. ESLint knows what that says about the operations around it: after
    /// the `a` of `(a || b) || c` the `c` is not evaluated either, after that of `(a || b) && c` it is.
    fn way_after_left_operand(&mut self, logical: Expr<'a>, floor: u32) -> Option<(u32, u32)> {
        let is_and = |e: Expr<'a>| Self::logical_operator(e).map(|it| it == BinOp::And);
        let (mut decided, is_false) = (logical, is_and(logical)?);
        while self.spends() {
            match decided.parent() {
                Node::Expr(around) => match (is_and(around), around.right()) {
                    (Some(skips_if_false), Some(right)) => {
                        if right != decided && skips_if_false != is_false {
                            return Some((decided.span().end, right.span().start + 1));
                        }
                        decided = around;
                    }
                    _ if around.as_cond().is_some_and(|it| it.0 == decided) => return None,
                    _ => return Some((decided.span().end, floor)),
                },
                Node::Stmt(it)
                    if matches!(
                        it.tag(),
                        StmtTag::If | StmtTag::While | StmtTag::DoWhile | StmtTag::For
                    ) =>
                {
                    return None;
                }
                _ => return Some((decided.span().end, floor)),
            }
        }
        None
    }

    fn expression(&mut self, e: Expr<'a>) -> Flow<'a> {
        self.part(None, (e.span().start, e.span().end), &|_| true)
    }

    fn optional_expression(&mut self, e: Option<Expr<'a>>) -> Flow<'a> {
        e.map_or(Flow::Through, |e| self.expression(e))
    }

    fn declarations(&mut self, declarators: List<'a, VarDecl<'a>>) -> Flow<'a> {
        match (declarators.first(), declarators.last()) {
            // Not in the annotation of a declarator.
            (Some(first), Some(last)) => {
                self.part(None, (first.span().start, last.span().end), &|at| {
                    (declarators.around(at).and_then(VarDecl::init))
                        .is_some_and(|it| it.span().contains_offset(at))
                })
            }
            _ => Flow::Through,
        }
    }

    /// What is in the head of a `for`.
    fn head(&mut self, statement: Stmt<'a>) -> Flow<'a> {
        match statement.kind() {
            StmtKind::Expr(e) => self.expression(e),
            StmtKind::Var(declarators) => self.declarations(declarators),
            _ => Flow::Unknown,
        }
    }

    /// From the end of `after` on, which is one of `list`, or from the start of `list`.
    fn statements(&mut self, list: List<'a, Stmt<'a>>, after: Option<Stmt<'a>>) -> Flow<'a> {
        // Where the statement ends that has been passed last, and from where on uses are looked for.
        let (mut passed, mut offset) = match after {
            Some(after) => (after.span().end, after.span().end),
            None => match list.first() {
                Some(first) => (0, first.span().start),
                None => return Flow::Through,
            },
        };
        loop {
            // Whether there is a way from `offset` to the start of `list[at]`. That the end of the one
            // before it can be reached tells the same of those before that.
            let is_reached = |statement: Stmt<'a>| {
                let previous = list.before(statement.span().start);
                previous.is_none_or(|it| it.span().start < offset || it.is_known_to_complete())
            };
            let next = self.first_from(offset).map(|it| start_of(&it));
            let Some((statement, previous)) = next.and_then(|next| list.around_with_previous(next))
            else {
                let Some(last) = list.last().filter(|it| it.span().end > passed) else {
                    return Flow::Through;
                };
                return match last.tag() {
                    _ if next.is_some_and(|next| next < last.span().end) => Flow::Unknown,
                    _ if last.is_known_to_complete() => Flow::Through,
                    StmtTag::Break | StmtTag::Continue if is_reached(last) => Flow::Leaves(last),
                    _ => Flow::Unknown,
                };
            };
            if previous.is_some_and(|it| it.span().start >= offset && !it.is_known_to_complete()) {
                return Flow::Unknown;
            }
            match self.statement_with_uses(statement) {
                Flow::Through => (passed, offset) = (statement.span().end, statement.span().end),
                flow => return flow,
            }
        }
    }

    /// From the start of `statement` on.
    fn statement(&mut self, statement: Stmt<'a>) -> Flow<'a> {
        if self.first_within(statement.span()).is_none() {
            return if statement.is_known_to_complete() {
                Flow::Through
            } else {
                Flow::Unknown
            };
        }
        self.statement_with_uses(statement)
    }

    /// From the start of `statement` on, in which the variable is used.
    fn statement_with_uses(&mut self, statement: Stmt<'a>) -> Flow<'a> {
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
            StmtKind::Block(list) => self.statements(list, None),
            StmtKind::Labeled { body, .. } => self.statement(body).or(Flow::Unknown),
            StmtKind::If { test, yes, no } => {
                through!(self.expression(test));
                let yes = self.statement(yes);
                yes.or(no.map_or(Flow::Through, |no| self.statement(no)))
            }
            StmtKind::While { test, body } => {
                through!(self.expression(test));
                let out = if ast_utils::is_literal(test) {
                    Flow::Unknown
                } else {
                    Flow::Through
                };
                self.body(body).or(out)
            }
            StmtKind::DoWhile { body, test } => {
                through!(self.statement(body).or(Flow::Unknown));
                through!(self.expression(test));
                if ast_utils::is_literal(test) {
                    Flow::Unknown
                } else {
                    Flow::Through
                }
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                through!(init.map_or(Flow::Through, |init| self.head(init)));
                through!(self.optional_expression(test));
                let out = if test.is_some_and(|test| !ast_utils::is_literal(test)) {
                    Flow::Through
                } else {
                    Flow::Unknown
                };
                match self.statement(body) {
                    Flow::Read => Flow::Read,
                    Flow::Through if self.optional_expression(update) == Flow::Read => Flow::Read,
                    _ => out,
                }
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                through!(self.expression(expr));
                if self.first_within(left.span()).is_some() {
                    return Flow::Through;
                }
                self.body(body).or(Flow::Through)
            }
            StmtKind::Switch { expr, cases } => {
                through!(self.expression(expr));
                for case in cases {
                    let Some(budget) = self.budget.checked_sub(1) else {
                        return Flow::Unknown;
                    };
                    self.budget = budget;
                    if self.optional_expression(case.test()) != Flow::Through {
                        return Flow::Unknown;
                    }
                }
                let has_default = cases.iter().any(Case::is_default);
                let mut all = if has_default {
                    Flow::Unknown
                } else {
                    Flow::Through
                };
                // From the start of the following case on.
                let mut next = Flow::Through;
                for case in cases.iter().rev() {
                    next = match self.statements(case.body(), None) {
                        Flow::Through => next,
                        Flow::Leaves(jump) if matches!(jump.kind(), StmtKind::Break(None)) => {
                            Flow::Through
                        }
                        flow => flow.or(Flow::Unknown),
                    };
                    all = all.or(next);
                }
                all
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                let mut flow = self.statement(block).or(Flow::Unknown);
                if let Some(handler) =
                    handler.filter(|_| flow != Flow::Read && self.throws_before_write(block))
                {
                    flow = flow.or(self.statement(handler));
                }
                through!(flow);
                finalizer.map_or(Flow::Through, |finalizer| {
                    self.statement(finalizer).or(Flow::Unknown)
                })
            }
            StmtKind::ExportDefault(e) => self.expression(e),
            // What a function reads can be read at any time.
            StmtKind::Fn(_) if self.within(statement.span()).iter().any(|it| it.is_read()) => {
                Flow::Read
            }
            StmtKind::ExportNamed(_) | StmtKind::ImportEquals(_) => Flow::Read,
            // The same, or it is read where the class is defined.
            StmtKind::Class(_)
                if self
                    .within(statement.span())
                    .iter()
                    .all(|it| !it.is_write()) =>
            {
                Flow::Read
            }
            _ => Flow::Unknown,
        }
    }

    /// Whether there is a way from the start of the block of a `try` statement to the `catch` block
    /// on which nothing is assigned to the variable. ESLint lets the first name that is evaluated
    /// in the block throw, which at the latest is that of the variable, before it is assigned to.
    /// In another `try` statement in the block it throws for that.
    fn throws_before_write(&mut self, block: Stmt<'a>) -> bool {
        let Some(first) = self.first_within(block.span()).map(|it| start_of(&it)) else {
            return false;
        };
        for statement in block.as_block().into_iter().flatten() {
            let Some(budget) = self.budget.checked_sub(1) else {
                return false;
            };
            self.budget = budget;
            match statement.kind() {
                _ if statement.span().end <= first => {
                    if !matches!(statement.tag(), StmtTag::Expr | StmtTag::Var) {
                        return false;
                    }
                }
                StmtKind::Expr(e) => {
                    return match e.kind() {
                        ExprKind::Assign { target: it, .. }
                        | ExprKind::Unary { operand: it, .. } => {
                            it.tag() == ExprTag::Ident && it.span().start == first
                        }
                        _ => false,
                    };
                }
                _ => return false,
            }
        }
        false
    }

    /// From the start of the body of a loop on. Only whether the variable is read matters.
    fn body(&mut self, body: Stmt<'a>) -> Flow<'a> {
        match self.statement(body) {
            Flow::Read => Flow::Read,
            _ => Flow::Unknown,
        }
    }

    /// Whether the variable can be read after the test of `a_loop`, which is `None` if it has none.
    fn is_read_after_test(
        &mut self,
        a_loop: Stmt<'a>,
        test: Option<Expr<'a>>,
        body: Stmt<'a>,
    ) -> bool {
        if self.loops.insert(a_loop) {
            if self.statement(body) == Flow::Read {
                return true;
            }
        }
        test.is_some_and(|test| !ast_utils::is_literal(test)) && self.is_read_after(a_loop)
    }

    fn is_read_from_test(
        &mut self,
        a_loop: Stmt<'a>,
        test: Option<Expr<'a>>,
        body: Stmt<'a>,
    ) -> bool {
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
                if self.loops.insert(a_loop) {
                    if self.first_within(left.span()).is_none()
                        && self.statement(body) == Flow::Read
                    {
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
            if matches!(target.kind(), StmtKind::Try { finalizer, .. } if finalizer == Some(inner))
            {
                return false;
            }
            inner = target;
            let is_loop = matches!(
                target.tag(),
                StmtTag::While | StmtTag::DoWhile | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf
            );
            match (target.kind(), label) {
                (
                    StmtKind::Labeled {
                        label: it,
                        mut body,
                    },
                    Some(label),
                ) if it == label => {
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
            // The statements that it has as a list, or the statement that it is.
            let (list, around) = match parent {
                Node::Func(func) => (func.body_statements(), None),
                Node::File(file) => (Some(file.body()), None),
                Node::Case(case) => (Some(case.body()), None),
                Node::Stmt(it) => match it.as_block() {
                    Some(list) => (Some(list), None),
                    None => (None, Some((it, it.kind()))),
                },
                _ => (None, None),
            };
            if let Some(list) = list {
                let mut flow = self.statements(list, Some(statement));
                let mut around = parent;
                if let (Node::Case(case), Node::Stmt(switch)) = (parent, parent.parent())
                    && let StmtKind::Switch { cases, .. } = switch.kind()
                {
                    // It falls through to the following cases.
                    let mut following = cases.after(case.span().start);
                    while flow == Flow::Through
                        && let Some(next) = following
                    {
                        following = cases.after(next.span().start);
                        let Some(budget) = self.budget.checked_sub(1) else {
                            return false;
                        };
                        self.budget = budget;
                        flow = self.statements(next.body(), None);
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
            let Some((parent, kind)) = around else {
                return false;
            };
            match kind {
                StmtKind::If { .. } | StmtKind::Labeled { .. } => {}
                // What is assigned in the block of a `try` statement is not reported.
                StmtKind::Try { block, .. } if block == statement => return true,
                // A `finally` block that is only entered by a `return` leads nowhere else.
                StmtKind::Try { finalizer, .. } if finalizer == Some(statement) => {
                    if !parent.is_known_to_complete() {
                        return false;
                    }
                }
                StmtKind::Try { finalizer, .. } => {
                    match finalizer.map_or(Flow::Through, |it| self.statement(it)) {
                        Flow::Read => return true,
                        Flow::Through => {}
                        _ => return false,
                    }
                }
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
        let statement = match written.node {
            Node::VarDecl(declarator) => Some(declarator.parent()),
            // Not the statement around a function whose body is an expression.
            node => (node.ancestors())
                .find(|it| matches!(it, Node::Stmt(_) | Node::Func(_) | Node::Member(_))),
        };
        let Some(Node::Stmt(statement)) = statement else {
            return false;
        };
        if !statement.is_reachable()
            || self.is_in_module_scope && statement.tag() == StmtTag::Var && statement.is_exported()
        {
            return true;
        }
        let kind = statement.kind();
        // The part of the statement that it is in.
        let part = match kind {
            StmtKind::Expr(_) | StmtKind::Var(_) | StmtKind::Return(_) | StmtKind::Throw(_) => {
                statement.span()
            }
            StmtKind::If { test, .. }
            | StmtKind::While { test, .. }
            | StmtKind::DoWhile { test, .. } => test.span(),
            StmtKind::Switch { expr, .. }
            | StmtKind::ForIn { expr, .. }
            | StmtKind::ForOf { expr, .. }
                if expr.span().contains_offset(start_of(&written.identifier)) =>
            {
                expr.span()
            }
            StmtKind::For {
                init, test, update, ..
            } => {
                let parts = [
                    init.map(Stmt::span),
                    test.map(Expr::span),
                    update.map(Expr::span),
                ];
                let identifier = written.identifier.span();
                match parts
                    .into_iter()
                    .flatten()
                    .find(|it| it.contains(identifier))
                {
                    Some(part) => part,
                    None => return false,
                }
            }
            _ => return false,
        };
        if !self.is_alone_in(written, written.node.span()) {
            return false;
        }
        match self.part(
            Some(written.node),
            (written.node.span().end, part.end),
            &|_| false,
        ) {
            Flow::Read => return true,
            Flow::Through => {}
            _ => return false,
        }
        match kind {
            StmtKind::Expr(_) | StmtKind::Var(_) => self.is_read_after(statement),
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
                Some(test) if test.span() == part => {
                    self.is_read_after_test(statement, Some(test), body)
                }
                _ => self.is_read_from_test(statement, test, body),
            },
            _ => false,
        }
    }
}

/// Where the outermost of `blocks` around `identifier` ends. They are in the order of the source, and each ends where
/// the last of those up to it ends.
fn end_of_block_around(blocks: &[Span], identifier: Span) -> Option<u32> {
    let before = blocks.partition_point(|block| block.start <= identifier.start);
    let block = blocks.get(before.checked_sub(1)?)?;
    (identifier.end <= block.end).then_some(block.end)
}

impl NoUselessAssignment {
    fn check_variable<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        if !variable.has_writes()
            || !variable.has_reads()
            || oxlint_passes_over(variable)
            || oxlint_takes_for_exported(variable, &mut cx.state.exported)
        {
            return;
        }
        if cfg!(debug_assertions) {
            cx.state.all_roots.extend(code_path_root(variable.scope()));
        }
        // Nearly all are a name with an initializer that nothing else assigns to.
        if !variable.has_modifying_references()
            && variable.declaration_count() == 1
            && let Some(declaration @ Declaration::Var(name)) = variable.declarations().next()
            && let Some(Node::VarDecl(declarator)) = match name.parent() {
                parent @ Node::VarDecl(_) => Some(parent),
                _ => declaration.node(),
            }
            && is_read_after_declarator(variable, declarator, &mut cx.state.evaluated_in)
        {
            return;
        }
        if !variable
            .declaration_kinds()
            .contains(DeclarationKinds::CLASS_NAME)
        {
            return Self::check_binding(Binding::outer(variable), cx);
        }
        let mut bindings: SmallVec<[Binding<'a>; 2]> = smallvec![Binding::outer(variable)];
        for reference in variable.references() {
            let binding = Binding::of(variable, reference);
            if !bindings.contains(&binding) {
                bindings.push(binding);
            }
        }
        for binding in bindings {
            Self::check_binding(binding, cx);
        }
    }

    /// Finds out whether the code path that `variable` is declared in has to be analyzed.
    fn check_binding<'a>(variable: Binding<'a>, cx: &mut Cx<'a, Self>) {
        let State {
            uses, evaluated_in, ..
        } = &mut cx.state;
        let home = variable.scope().variable_scope();
        // In another code path than that of the variable.
        let is_elsewhere = |it: Reference<'a>| {
            it.scope().variable_scope() != home
                && code_path_scope(it.scope()) != code_path_scope(variable.scope())
        };
        // What a function assigns to a variable from outside it is not looked at.
        let (mut writes, mut written) = (0, None);
        for reference in variable.symbol.references() {
            if reference.is_write() && variable.has(reference) && !is_elsewhere(reference) {
                writes += 1;
                written = Some(reference);
            }
        }
        if let (1, None, Some(written)) = (writes, variable.class, written)
            && is_read_after_declaration(
                variable.symbol,
                written,
                (&mut uses.writers, evaluated_in),
            )
        {
            return;
        }
        // What a function reads can be read at any time.
        if writes == 0
            || (variable.symbol.references())
                .any(|it| it.is_read() && is_elsewhere(it) && variable.has(it))
        {
            return;
        }
        uses.look_at(
            variable,
            variable.references().filter(|&it| !is_elsewhere(it)),
        );
        // Of the variable, once it is asked for.
        let mut scope = None;
        let mut at = 0;
        // Where the last of the assignments so far ends: one that does not end later is in another, which comes after it.
        let mut end = 0;
        let is_unknown = loop {
            let Some(&reference) = uses.all.get(at) else {
                break false;
            };
            at += 1;
            if reference.is_write()
                && written_by(reference, &mut uses.writers).is_some_and(|written| {
                    let is_in_another = written.node.span().end <= end;
                    end = end.max(written.node.span().end);
                    is_in_another || !uses.is_known_to_be_read(&written)
                })
                && code_path_scope(reference.scope())
                    == *scope.get_or_insert_with(|| code_path_scope(variable.scope()))
            {
                break true;
            }
        };
        if !is_unknown {
            return;
        }
        // What is never read is left to `no-unused-vars`.
        if !uses.all.iter().any(|it| it.is_read()) {
            return;
        }
        let Some(scope) = scope.flatten() else {
            return;
        };
        // What a function reads can be read at any time.
        if (uses.all.iter()).any(|it| it.is_read() && code_path_scope(it.scope()) != Some(scope)) {
            return;
        }
        cx.state.roots.extend(code_path_root(scope));
        cx.state.unknown.insert(variable);
    }

    fn check_code_path<'a>(&self, root: Node<'a>, cx: &mut Cx<'a, Self>) {
        let mut statements = NodeTags::from(StmtTag::Try) | StmtTag::ImportEquals.into();
        if cx.language().is_oxlint {
            statements = statements | StmtTag::While.into() | StmtTag::For.into();
        }
        let enter = statements | NodeTags::EXPORT_SPEC | ExprTag::Ident.into();
        let exit = NodeTags::VAR_DECL | ExprTag::Assign.into() | ExprTag::Unary.into();
        for step in steps_of_code_path(root, enter, exit) {
            match step {
                Step::Event(Event::CodePathStart(path, node)) => {
                    self.on_code_path_start(path, node, cx)
                }
                Step::Event(Event::CodePathEnd(path, node)) => {
                    self.on_code_path_end(path, node, cx)
                }
                Step::Event(Event::SegmentStart(segment, node)) => {
                    self.on_segment_start(segment, node, cx)
                }
                Step::Event(Event::SegmentEnd(segment, node)) => {
                    self.on_segment_end(segment, node, cx)
                }
                Step::Event(_) => {}
                Step::Enter(Node::Stmt(statement)) => self.on_statement(statement, cx),
                Step::Enter(Node::ExportSpec(specifier)) => {
                    self.on_identifier(specifier.local().span(), cx)
                }
                Step::Enter(node) => self.on_identifier(node.span(), cx),
                Step::Exit(node) => self.on_assignment_exit(node, cx),
            }
        }
    }

    fn verify<'a>(mut target: ScopeStack<'a>, cx: &mut Cx<'a, Self>) {
        // Each block ends where the last of those up to it ends: a block that starts before an
        // identifier is around it if one of these ends after it.
        for blocks in [
            &mut target.try_statement_blocks,
            &mut target.finalized_blocks,
            &mut target.endless_loops,
        ] {
            let mut end = 0;
            for block in blocks {
                end = end.max(block.end);
                block.end = end;
            }
        }
        let is_in_try_statement_block = |identifier: Span| {
            end_of_block_around(&target.try_statement_blocks, identifier).is_some()
        };
        // For oxlint every statement of a `try` block with a `finally` can be the last one that runs before what
        // follows the `try` statement, as if there were a `catch`: in `let a = 0; try { a = f(); } finally { g(); }
        // return a;` the 0 is used.
        let oxlint_takes_for_used = |following: Option<&Assignment<'a>>,
                                     last_read: Option<&Span>| {
            following
                .and_then(|it| end_of_block_around(&target.finalized_blocks, it.identifier))
                .is_some_and(|end| last_read.is_some_and(|it| it.start >= end))
        };
        // For oxlint every loop can end at its test, be that `true` or missing: in `let a = 0; while (true) { a = f(); if (a)
        // break; } return a;` the 0 is used.
        let oxlint_takes_for_read_after_loop =
            |assignments: &[Assignment<'a>], index: usize, reads: &[Span]| {
                let loop_around = |index: usize| {
                    end_of_block_around(&target.endless_loops, assignments.get(index)?.identifier)
                };
                let Some(end) =
                    loop_around(index + 1).filter(|&end| loop_around(index) != Some(end))
                else {
                    return false;
                };
                let written =
                    assignments.get(assignments.partition_point(|it| it.identifier.start < end));
                reads
                    .get(reads.partition_point(|it| it.start < end))
                    .is_some_and(|read| {
                        written.is_none_or(|written| {
                            read.start < written.identifier.start
                                || written
                                    .expression
                                    .is_some_and(|it| it.start <= read.start && read.end <= it.end)
                        })
                    })
            };
        let by_variable = |it: &(Binding<'a>, _)| (it.0.symbol.key(), it.0.class.is_some());
        'variables: for (variable, assignments) in
            utils::sort::in_order_of(target.assignments, by_variable)
        {
            let Some(mut assignments) = assignments else {
                continue;
            };
            let mut read_references: SmallVec<[Span; 8]> = SmallVec::new();
            for reference in variable.references().filter(|it| it.is_read()) {
                // It can be called at any time.
                let start =
                    get_code_path_start_scope(reference.scope(), &cx.state.code_path_start_scopes);
                if start != Some(target.scope)
                    || is_in_decorator_of_parameter(reference, target.scope)
                {
                    continue 'variables;
                }
                read_references.push(reference.span());
            }
            // That is for `no-unused-vars` to report.
            if read_references.is_empty() {
                continue;
            }
            if !read_references.is_sorted_by_key(|it| it.start) {
                utils::sort::sort_unstable_by_key(&mut read_references, |it| it.start);
            }
            utils::sort::sort_by_key(&mut assignments, |it| it.identifier.start);
            let uses = Variable::new(&assignments, &read_references, &cx.state.identifier_ranges);
            let next = uses.next_assignments();
            for (index, (assignment, &next)) in assignments.iter().zip(&next).enumerate() {
                let identifier = assignment.identifier;
                if !is_in_try_statement_block(identifier)
                    && uses.is_assignment_unused(index, next)
                    && !oxlint_takes_for_used(assignments.get(index + 1), read_references.last())
                    && !oxlint_takes_for_read_after_loop(&assignments, index, &read_references)
                {
                    // Only a debug build gets here with a variable that was passed over. Types are not walked: of a name in
                    // one it is not known in which segment it is.
                    if cx.state.is_only_checked || !cx.state.unknown.contains(&variable) {
                        debug_assert!(
                            variable
                                .references()
                                .any(|it| is_type_only_reference(variable.symbol, it))
                        );
                        continue 'variables;
                    }
                    // For oxlint a name that is declared is without its type.
                    let name = variable.symbol.name();
                    let end = match cx.language().is_oxlint {
                        true => identifier
                            .end
                            .min(identifier.start + name.bytes().len() as u32),
                        false => identifier.end,
                    };
                    cx.report(Span::new(identifier.start, end), UNNECESSARY_ASSIGNMENT)
                        .data("name", name)
                        .hint_with(|| uses.hint(index, next, cx.file()));
                }
            }
        }
    }

    fn add_assignment<'a>(
        variable: Option<Binding<'a>>,
        identifier: Span,
        expression: Option<Span>,
        cx: &mut Cx<'a, Self>,
    ) {
        let state = &mut cx.state;
        let (Some(variable), Some(top)) = (variable, state.stack.last_mut()) else {
            return;
        };
        let assignments = match top.assignments.entry(variable) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                let scope = variable.scope();
                let is_ignored = !cfg!(debug_assertions) && !state.unknown.contains(&variable)
                    || oxlint_passes_over(variable.symbol)
                    || oxlint_takes_for_exported(variable.symbol, &mut state.exported)
                    || get_code_path_start_scope(scope, &state.code_path_start_scopes)
                        != Some(top.scope)
                    || variable.class.is_none() && variable.symbol.is_marked_used()
                    || scope.kind() == ScopeKind::Module && is_exported(variable.symbol);
                entry.insert((!is_ignored).then(SmallVec::new))
            }
        };
        if let Some(assignments) = assignments {
            assignments.push(Assignment {
                identifier,
                expression,
                segments: state.current_segments.iter().collect(),
            });
        }
    }

    fn on_code_path_start<'a>(&self, _: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let scope = node.scope();
        cx.state.stack.push(ScopeStack {
            scope,
            assignments: FxHashMap::default(),
            try_statement_blocks: Vec::new(),
            finalized_blocks: Vec::new(),
            endless_loops: Vec::new(),
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

    /// At a `try` statement, or at an `import a = b.c`, whose `b` is a reference. With a configuration of oxlint also at
    /// a `while` or `for` statement.
    fn on_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::While { test, .. }
            | StmtKind::For {
                test: Some(test), ..
            } if !ast_utils::is_literal(test) => {}
            StmtKind::While { .. } | StmtKind::For { .. } => {
                if let Some(top) = cx.state.stack.last_mut() {
                    top.endless_loops.push(statement.span());
                }
            }
            StmtKind::Try {
                block, finalizer, ..
            } => {
                let is_finalized = finalizer.is_some() && cx.language().is_oxlint;
                if let Some(top) = cx.state.stack.last_mut() {
                    top.try_statement_blocks.push(block.span());
                    if is_finalized {
                        top.finalized_blocks.push(block.span());
                    }
                }
            }
            StmtKind::ImportEquals(import) => {
                if let ImportEqualsTarget::Entity(name) = import.target()
                    && let Some(first) = name.first()
                {
                    self.on_identifier(first.span(), cx);
                }
            }
            _ => {}
        }
    }

    fn on_identifier<'a>(&self, identifier: Span, cx: &mut Cx<'a, Self>) {
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
                    let identifier = if pat == id {
                        declarator.binding_span()
                    } else {
                        pat.span()
                    };
                    // In the block of `catch (e)`, `var e = 1` gives the value to the parameter.
                    let written = match declarator.var_kind() {
                        VarKind::Var => cx
                            .file()
                            .reference_at(pat.span().start)
                            .and_then(Reference::symbol),
                        _ => None,
                    };
                    let variable =
                        written
                            .or_else(|| pat.symbol())
                            .map(Binding::outer)
                            .filter(|it| {
                                it.symbol.declaration_count() <= 1
                                    || !oxlint_does_not_see(it.symbol, pat.span().start)
                            });
                    Self::add_assignment(variable, identifier, Some(init.span()), cx);
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
        extract_identifiers_from_pattern(pattern, |identifier| {
            // `([a]) = b`, which TypeScript parses, assigns nothing.
            let variable = (identifier.reference().filter(|it| it.is_write()))
                .and_then(|it| Some(Binding::of(it.symbol()?, it)));
            Self::add_assignment(variable, identifier.span(), expression, cx);
        });
    }
}

impl Rule for NoUselessAssignment {
    const META: Meta = Meta::eslint("no-useless-assignment", Kind::Problem)
        .recommended()
        .reports_at_the_end()
        .hints();
    const ON: On = On::new().symbols().finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUselessAssignment
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if !file.has_stmts([StmtTag::Var]) && !file.has_exprs([ExprTag::Assign, ExprTag::Unary]) {
            return None;
        }
        Some(State::default())
    }

    fn symbol<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        self.check_variable(variable, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        // The `arguments` of a function is none of the symbols.
        if !cx.language().is_oxlint && cx.file().mentions("arguments") {
            for scope in cx.file().funcs().filter_map(Func::scope) {
                if let Some(arguments) = scope
                    .symbols()
                    .next()
                    .filter(|it| it.is_implicit_arguments())
                {
                    self.check_variable(arguments, cx);
                }
            }
        }
        let as_entered = |it: &&Node<'_>| (it.span().start, std::cmp::Reverse(it.span().end));
        let roots = std::mem::take(&mut cx.state.roots);
        for &root in utils::sort::in_order_of(&roots, as_entered) {
            self.check_code_path(root, cx);
        }
        cx.state.is_only_checked = true;
        let all_roots = std::mem::take(&mut cx.state.all_roots);
        for root in utils::sort::in_order_of(all_roots.difference(&roots), as_entered) {
            self.check_code_path(*root, cx);
        }
    }
}
