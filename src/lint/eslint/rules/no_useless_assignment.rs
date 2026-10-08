use bun_lint::code_path::{CurrentSegments, Event, Step, starts_code_path, steps_of_code_path};
use bun_lint::prelude::*;
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
    assignments: FxHashMap<Symbol<'a>, Option<Assignments<'a>>>,
    /// In the order of the source.
    try_statement_blocks: Vec<Span>,
    segments: Segments<'a>,
}

#[derive(Default)]
pub struct State<'a> {
    /// What the code paths to analyze start with: those that assign to a variable where the
    /// statements alone do not tell that the value is read.
    roots: FxHashSet<Node<'a>>,
    stack: Vec<ScopeStack<'a>>,
    /// Only the reachable ones.
    current_segments: CurrentSegments<'a>,
    code_path_start_scopes: StartScopes<'a>,
    /// For `code_path_scope`.
    code_path_scopes: Nearest<'a>,
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

/// Finds the nearest scope of some sort around a scope, where only scopes in which a `var` ends up
/// are of that sort: the blocks in between are not gone through.
#[derive(Default)]
struct Nearest<'a> {
    /// For a scope with many such scopes between it and the answer: the `version` and the answer.
    known: FxHashMap<Scope<'a>, (usize, Option<Scope<'a>>)>,
}

impl<'a> Nearest<'a> {
    /// How far up it goes before it looks at what is known.
    const PLAIN_STEPS: usize = 8;

    fn up(scope: Scope<'a>) -> Option<Scope<'a>> {
        scope.parent().map(Scope::variable_scope)
    }

    /// `scope.chain().find(is_it)`. `version`: another one when `is_it` holds of other scopes.
    fn find(
        &mut self,
        scope: Scope<'a>,
        version: usize,
        is_it: impl Fn(Scope<'a>) -> bool,
    ) -> Option<Scope<'a>> {
        let first = scope.variable_scope();
        let (mut at, mut steps) = (Some(first), 0);
        let answer = loop {
            let Some(it) = at else {
                break None;
            };
            if is_it(it) {
                break Some(it);
            }
            if steps >= Self::PLAIN_STEPS
                && let Some(&(_, known)) = self.known.get(&it).filter(|known| known.0 == version)
            {
                break known;
            }
            at = Self::up(it);
            steps += 1;
        };
        self.keep(first, steps, version, answer);
        answer
    }

    /// `answer` is the answer for the scopes that `steps` steps up from `first` have passed.
    fn keep(&mut self, first: Scope<'a>, steps: usize, version: usize, answer: Option<Scope<'a>>) {
        if steps <= Self::PLAIN_STEPS {
            return;
        }
        let mut passed = Some(first);
        for step in 0..steps {
            let Some(it) = passed else {
                break;
            };
            if step >= Self::PLAIN_STEPS {
                self.known.insert(it, (version, answer));
            }
            passed = Self::up(it);
        }
    }
}

/// The scopes that the code paths have started with so far.
#[derive(Default)]
struct StartScopes<'a> {
    all: FxHashSet<Scope<'a>>,
    /// Whether one of them is a scope in which no `var` ends up.
    has_other: bool,
    nearest: Nearest<'a>,
}

impl<'a> StartScopes<'a> {
    fn insert(&mut self, scope: Scope<'a>) {
        self.has_other |= scope.variable_scope() != scope;
        self.all.insert(scope);
    }

    /// ESLint's `getCodePathStartScope`.
    fn around(&mut self, scope: Scope<'a>) -> Option<Scope<'a>> {
        let all = &self.all;
        if self.has_other {
            return scope.chain().find(|it| all.contains(it));
        }
        self.nearest.find(scope, all.len(), |it| all.contains(&it))
    }
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

const NONE: u32 = u32::MAX;

fn intersection(a: Range<usize>, b: Range<usize>) -> Range<usize> {
    a.start.max(b.start)..a.end.min(b.end)
}

/// Whether something of `range` is not in `without`.
fn is_any_outside(range: &Range<usize>, without: &Range<usize>) -> bool {
    range.start < range.end && (range.start < without.start || without.end < range.end)
}

/// Lists of numbers, one after the other.
struct Lists {
    starts: Vec<u32>,
    items: Vec<u32>,
}

impl Lists {
    /// `pairs`: the number of a list with an item of it, sorted.
    fn new(count: usize, pairs: &[(u32, u32)]) -> Lists {
        let mut starts = vec![0u32; count + 1];
        for &(list, _) in pairs {
            starts[list as usize + 1] += 1;
        }
        for list in 0..count {
            starts[list + 1] += starts[list];
        }
        Lists {
            starts,
            items: pairs.iter().map(|it| it.1).collect(),
        }
    }

    fn get(&self, list: u32) -> &[u32] {
        &self.items[self.starts[list as usize] as usize..self.starts[list as usize + 1] as usize]
    }
}

/// The least of any part of a list of numbers, in the logarithm of its length.
struct Minima {
    /// The numbers are `tree[size..]`, and `tree[i]` is the lesser of `tree[2 * i]` and
    /// `tree[2 * i + 1]`.
    tree: Vec<u32>,
    size: usize,
}

impl Minima {
    fn new(numbers: &[u32]) -> Minima {
        let size = numbers.len().next_power_of_two();
        let mut tree = vec![u32::MAX; 2 * size];
        tree[size..size + numbers.len()].copy_from_slice(numbers);
        for at in (1..size).rev() {
            tree[at] = tree[2 * at].min(tree[2 * at + 1]);
        }
        Minima { tree, size }
    }

    fn least_of(&self, part: Range<usize>) -> u32 {
        let (mut from, mut to, mut least) =
            (part.start + self.size, part.end + self.size, u32::MAX);
        while from < to {
            if from % 2 == 1 {
                least = least.min(self.tree[from]);
                from += 1;
            }
            if to % 2 == 1 {
                to -= 1;
                least = least.min(self.tree[to]);
            }
            from /= 2;
            to /= 2;
        }
        least
    }

    /// Calls `visit` with the index of each number of `part` that is at most `limit`.
    fn for_each_up_to(&self, part: &Range<usize>, limit: u32, visit: &mut impl FnMut(usize)) {
        self.for_each_below(1, 0..self.size, part, limit, visit);
    }

    /// `all`: what `tree[at]` is the least of. It halves with each call.
    fn for_each_below(
        &self,
        at: usize,
        all: Range<usize>,
        part: &Range<usize>,
        limit: u32,
        visit: &mut impl FnMut(usize),
    ) {
        if self.tree[at] > limit || all.end <= part.start || part.end <= all.start {
            return;
        }
        if at >= self.size {
            return visit(all.start);
        }
        let middle = all.start + (all.end - all.start) / 2;
        self.for_each_below(2 * at, all.start..middle, part, limit, visit);
        self.for_each_below(2 * at + 1, middle..all.end, part, limit, visit);
    }
}

/// The forest that the algorithm of Lengauer and Tarjan grows: the nodes from some number on are
/// linked to the node from which the search has come to them.
struct Forest {
    /// A node further up in the tree of a linked node.
    ancestors: Vec<u32>,
    /// The node with the least semidominator from a linked node up to below `ancestors`.
    labels: Vec<u32>,
    semidominators: Vec<u32>,
    path: Vec<u32>,
}

impl Forest {
    /// The node with the least semidominator from `from` up to below the root of its tree, if the
    /// nodes from `linked` on are linked. The way up is made short for the next time.
    fn least(&mut self, from: u32, linked: u32) -> u32 {
        let mut top = from as usize;
        while self.ancestors[top] >= linked {
            self.path.push(top as u32);
            top = self.ancestors[top] as usize;
        }
        while let Some(it) = self.path.pop() {
            let it = it as usize;
            self.ancestors[it] = self.ancestors[top];
            if self.semidominators[self.labels[top] as usize]
                < self.semidominators[self.labels[it] as usize]
            {
                self.labels[it] = self.labels[top];
            }
            top = it;
        }
        self.labels[from as usize]
    }
}

/// The immediate dominator of each node of a graph, in `m log n` for `n` nodes and `m` edges. The
/// nodes are numbered in the order of a depth first search from node 0. `parents`: from where the
/// search has come to each node. `prev`: where the edges to it come from.
fn immediate_dominators(parents: &[u32], prev: &Lists) -> Vec<u32> {
    let count = parents.len();
    let numbers: Vec<u32> = (0..count as u32).collect();
    let mut forest = Forest {
        ancestors: parents.to_vec(),
        labels: numbers.clone(),
        semidominators: numbers,
        path: Vec::new(),
    };
    let mut dominators = vec![0u32; count];
    // The nodes with the same semidominator, as a linked list.
    let (mut first_with, mut next_with) = (vec![NONE; count], vec![NONE; count]);
    for node in (1..count as u32).rev() {
        let parent = parents[node as usize];
        let mut semidominator = parent;
        for &from in prev.get(node) {
            let least = forest.least(from, node + 1);
            semidominator = semidominator.min(forest.semidominators[least as usize]);
        }
        forest.semidominators[node as usize] = semidominator;
        next_with[node as usize] = std::mem::replace(&mut first_with[semidominator as usize], node);
        let mut it = std::mem::replace(&mut first_with[parent as usize], NONE);
        while it != NONE {
            let least = forest.least(it, node);
            let is_above =
                forest.semidominators[least as usize] < forest.semidominators[it as usize];
            // The dominator of `least` is its own, and is known later.
            dominators[it as usize] = if is_above { least } else { parent };
            it = next_with[it as usize];
        }
    }
    for node in 1..count {
        if dominators[node] != forest.semidominators[node] {
            dominators[node] = dominators[dominators[node] as usize];
        }
    }
    dominators
}

/// The reachable segments of a code path with their dominator tree, to follow the value of a
/// variable without passing through the segments that have nothing to do with it.
///
/// A segment has the number that a walk through the tree gives it when it enters it, so that what it
/// dominates are the numbers from its own to `last`.
struct Graph {
    /// By the id of a segment.
    numbers: FxHashMap<u32, u32>,
    last: Vec<u32>,
    /// How far it is from the root of the tree.
    levels: Vec<u32>,
    /// The segments that precede, sorted.
    prev: Lists,
    /// The edges that do not come from the immediate dominator of their target, by where they come
    /// from. `target` is in the dominance frontier of the segments on the way up the tree from
    /// `source`, as far as the level in `frontier_levels`. For a segment that is on the way up from
    /// several edges to a target, that holds for one of them.
    frontier_sources: Vec<u32>,
    frontier_targets: Vec<u32>,
    frontier_levels: Minima,
    /// The ranges of the identifiers in the segments, each with the number of the segment, by where
    /// they start.
    ranges: Vec<(Span, u32)>,
    /// The greatest end of `ranges[..=i]`.
    ends: Vec<u32>,
}

impl Graph {
    /// It takes `n log n` for `n` segments.
    fn new(initial: Segment<'_>, started: &[Segment<'_>], identifier_ranges: &[Span]) -> Graph {
        let mut found: FxHashMap<u32, u32> = FxHashMap::default();
        let mut parents: Vec<u32> = Vec::new();
        // The target comes first.
        let mut edges: Vec<(u32, u32)> = Vec::new();
        let mut stack = vec![(initial, NONE)];
        while let Some((segment, from)) = stack.pop() {
            let node = *found.entry(segment.id()).or_insert(parents.len() as u32);
            if from != NONE {
                edges.push((node, from));
            }
            if node as usize == parents.len() {
                parents.push(if from == NONE { 0 } else { from });
                stack.extend(segment.next_segments().into_iter().map(|next| (next, node)));
            }
        }
        let count = parents.len();
        edges.sort_unstable();
        edges.dedup();
        let dominators = immediate_dominators(&parents, &Lists::new(count, &edges));

        // A dominator has been found before what it dominates.
        let mut sizes = vec![1u32; count];
        for node in (1..count).rev() {
            sizes[dominators[node] as usize] += sizes[node];
        }
        let (mut numbers, mut levels, mut last) =
            (vec![0u32; count], vec![0u32; count], vec![0u32; count]);
        // The number for the next of the segments that it dominates immediately.
        let mut free = vec![1u32; count];
        for node in 1..count {
            let dominator = dominators[node] as usize;
            numbers[node] = free[dominator];
            free[dominator] += sizes[node];
            free[node] = numbers[node] + 1;
            levels[numbers[node] as usize] = levels[numbers[dominator] as usize] + 1;
        }
        for node in 0..count {
            last[numbers[node] as usize] = numbers[node] + sizes[node] - 1;
        }

        let mut frontier: Vec<(u32, u32, u32)> = Vec::new();
        for edge in &mut edges {
            // Nothing dominates the root.
            let is_from_dominator = edge.0 != 0 && dominators[edge.0 as usize] == edge.1;
            *edge = (numbers[edge.0 as usize], numbers[edge.1 as usize]);
            if !is_from_dominator {
                frontier.push((edge.0, edge.1, 0));
            }
        }
        edges.sort_unstable();
        frontier.sort_unstable();
        let least_levels = Minima::new(&levels);
        let mut previous = None;
        for (target, source, level) in &mut frontier {
            *level = match previous {
                // Below what dominates both: the rest of the way up is that of the previous one.
                Some((it, before)) if it == *target => {
                    least_levels.least_of(before as usize + 1..*source as usize + 1)
                }
                _ => levels[*target as usize],
            };
            previous = Some((*target, *source));
        }
        frontier.sort_unstable_by_key(|it| it.1);
        let frontier_levels: Vec<u32> = frontier.iter().map(|it| it.2).collect();

        for node in found.values_mut() {
            *node = numbers[*node as usize];
        }
        let mut ranges: Vec<(Span, u32)> = (started.iter())
            .filter_map(|it| {
                Some((
                    *identifier_ranges.get(it.id() as usize)?,
                    *found.get(&it.id())?,
                ))
            })
            .filter(|it| it.0 != NO_IDENTIFIERS)
            .collect();
        if !ranges.is_sorted_by_key(|it| it.0.start) {
            ranges.sort_by_key(|it| it.0.start);
        }
        let mut end = 0;
        Graph {
            numbers: found,
            last,
            levels,
            prev: Lists::new(count, &edges),
            frontier_sources: frontier.iter().map(|it| it.1).collect(),
            frontier_targets: frontier.iter().map(|it| it.0).collect(),
            frontier_levels: Minima::new(&frontier_levels),
            ends: (ranges.iter())
                .map(|it| {
                    end = end.max(it.0.end);
                    end
                })
                .collect(),
            ranges,
        }
    }

    /// Calls `visit` with each segment of the dominance frontier of `segment`: those that it does not
    /// dominate, or that are itself, with an edge from a segment that it dominates.
    fn for_each_in_frontier(&self, segment: u32, mut visit: impl FnMut(u32)) {
        let from = self.frontier_sources.partition_point(|&it| it < segment);
        let to = self
            .frontier_sources
            .partition_point(|&it| it <= self.last[segment as usize]);
        self.frontier_levels.for_each_up_to(
            &(from..to),
            self.levels[segment as usize],
            &mut |at| {
                visit(self.frontier_targets[at]);
            },
        );
    }

    /// Calls `visit` with each segment whose range has `identifier` in it.
    fn for_each_around(&self, identifier: Span, mut visit: impl FnMut(u32)) {
        let mut at = self
            .ranges
            .partition_point(|it| it.0.start <= identifier.start);
        while at > 0 && self.ends[at - 1] >= identifier.end {
            at -= 1;
            if self.ranges[at].0.end >= identifier.end {
                visit(self.ranges[at].1);
            }
        }
    }
}

/// What a segment is for a variable.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    /// It is read there before anything is assigned to it.
    Read,
    /// Something is assigned to it there before it is read.
    Assigned,
    /// Neither: ways from the others meet there.
    Join,
}

/// The segments that matter for a variable, to go back from one of them without passing through those
/// that have nothing to do with it.
///
/// It is how a compiler brings a variable into static single assignment form: at the end of a segment
/// the variable has the value that it has at the end of the nearest of these that dominates it.
struct Places {
    /// By the number of the segment: those that the variable is used in, and those where ways from
    /// these meet, unless `nearest` is empty.
    list: Vec<(u32, Place)>,
    /// From each of these numbers to the next, the index in `list` of the nearest that dominates.
    /// Empty if it takes less to go through all the segments.
    nearest: Vec<(u32, u32)>,
    /// `list` by the number of the segment, if `nearest` is empty.
    all: Vec<Option<Place>>,
}

/// Numbers of segments.
enum Seen {
    Few(FxHashSet<u32>),
    /// By the number.
    Many(Vec<bool>),
}

impl Seen {
    fn insert(&mut self, segment: u32) -> bool {
        match self {
            Seen::Few(few) => few.insert(segment),
            Seen::Many(many) => many
                .get_mut(segment as usize)
                .is_some_and(|it| !std::mem::replace(it, true)),
        }
    }
}

impl Places {
    fn get(&self, segment: u32) -> Option<Place> {
        if self.nearest.is_empty() {
            return self.all.get(segment as usize).copied().flatten();
        }
        let at = self.list.binary_search_by_key(&segment, |it| it.0).ok()?;
        self.list.get(at).map(|it| it.1)
    }

    /// Calls `visit` with what comes before `segment`: the segments that precede it, or for each of
    /// these the one of `list` at whose end the variable has the same value.
    fn for_each_before(&self, graph: &Graph, segment: u32, mut visit: impl FnMut(u32)) {
        let prev = graph.prev.get(segment);
        if self.nearest.is_empty() {
            return prev.iter().copied().for_each(visit);
        }
        let mut visit_at = |index: u32| {
            if let Some(it) = self.list.get(index as usize) {
                visit(it.0);
            }
        };
        if prev.len() <= self.nearest.len() {
            for &from in prev {
                let at = self.nearest.partition_point(|it| it.0 <= from);
                visit_at(
                    at.checked_sub(1)
                        .and_then(|at| self.nearest.get(at))
                        .map_or(NONE, |it| it.1),
                );
            }
        } else {
            for (at, &(from, index)) in self.nearest.iter().enumerate() {
                let to = self.nearest.get(at + 1).map_or(u32::MAX, |it| it.0);
                if prev
                    .get(prev.partition_point(|&it| it < from))
                    .is_some_and(|&it| it < to)
                {
                    visit_at(index);
                }
            }
        }
    }

    /// The segments that the variable is used in from whose end there is a way to the start of one of
    /// `targets` on which it is not used. Sorted. It takes time in proportion to what is on these ways,
    /// unless these are expected to be `most` of the segments.
    fn leading_to(&self, graph: &Graph, targets: Vec<u32>, most: bool) -> Vec<u32> {
        let mut seen = if most && self.nearest.is_empty() {
            Seen::Many(vec![false; graph.last.len()])
        } else {
            Seen::Few(FxHashSet::default())
        };
        let mut found: Vec<u32> = Vec::new();
        let mut stack = targets;
        while let Some(segment) = stack.pop() {
            self.for_each_before(graph, segment, |from| {
                if seen.insert(from) {
                    match self.get(from) {
                        Some(Place::Read | Place::Assigned) => found.push(from),
                        Some(Place::Join) | None => stack.push(from),
                    }
                }
            });
        }
        found.sort_unstable();
        found
    }
}

/// What is known about a variable once the graph has been asked.
///
/// `[x, y = (x = 1)] = z`: the outer assignment does not count for the inner one, so the segment that
/// starts with the outer one is not the same for all. Such segments are kept apart.
struct Later {
    /// `Places::leading_to` the segments where the variable is read before anything is assigned to it.
    read_after: Vec<u32>,
    /// The same without the segments that are kept apart.
    read_after_plain: Vec<u32>,
    /// `Places::leading_to` each segment that is kept apart: the number of a segment that leads to it,
    /// its number, its id. Sorted.
    leading_apart: Vec<(u32, u32, u32)>,
    /// The greatest start of the `expression` of `assignments[..=i]`.
    expression_starts: Vec<u32>,
    /// For each of `in_segments`, the least start of an `expression` from the first of its segment
    /// up to it. 0 if one has no expression.
    least_expression_starts: Vec<u32>,
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
    later: Option<Later>,
}

/// The segments of a code path.
struct Segments<'a> {
    initial: Segment<'a>,
    /// The reachable ones, in the order in which they start.
    started: Vec<Segment<'a>>,
    graph: Option<Graph>,
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
            later: None,
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
    fn first_assignment_in(
        &self,
        id: u32,
        target: &Assignment<'a>,
        later: Option<&Later>,
    ) -> Option<&'v Assignment<'a>> {
        let assignments = self.assignments;
        let get = |it: &(u32, u32)| assignments.get(it.1 as usize);
        let from = self.in_segments.partition_point(|it| it.0 < id);
        let in_segment = self.in_segments.get(from..).unwrap_or_default();
        let in_segment = in_segment
            .get(..in_segment.partition_point(|it| it.0 == id))
            .unwrap_or_default();
        // None of those before `target` counts if the expressions of all of them come after it.
        let before = in_segment.partition_point(|it| {
            get(it).is_some_and(|it| it.identifier.end <= target.identifier.start)
        });
        if let Some(last) = before.checked_sub(1)
            && (later.and_then(|it| it.least_expression_starts.get(from + last)))
                .is_some_and(|&it| it >= target.identifier.end)
        {
            return in_segment.get(before).and_then(get);
        }
        (in_segment.iter().filter_map(get))
            .find(|it| !is_identifier_used_between_assigned_and_equal_sign(it, target.identifier))
    }

    /// Goes from the end of the segments of `target` through those where nothing is assigned to the
    /// variable, and tells whether it is read on the way. `None` if that takes more than `limit`
    /// segments.
    fn search(&self, target: &Assignment<'a>, limit: usize) -> Option<bool> {
        const FEW: usize = 32;
        let mut few: SmallVec<[u32; FEW]> = SmallVec::new();
        let mut many: FxHashSet<u32> = FxHashSet::default();
        let mut stack: SmallVec<[Segment<'a>; 16]> = target
            .segments
            .iter()
            .flat_map(|it| it.next_segments())
            .collect();
        while let Some(segment) = stack.pop() {
            let id = segment.id();
            if few.contains(&id) || few.len() == FEW && !many.insert(id) {
                continue;
            }
            if few.len() < FEW {
                few.push(id);
            }
            if few.len() + many.len() > limit {
                return None;
            }
            let first = self.first_assignment_in(id, target, None);
            if self.is_read_in(id, first) {
                return Some(true);
            }
            if first.is_none() {
                stack.extend(segment.next_segments());
            }
        }
        Some(false)
    }

    /// It takes `m log n` for the `m` segments that the variable is used in and those where ways from
    /// these meet, of `n` segments in all, and at most `n`.
    fn places(&self, graph: &Graph) -> Places {
        let mut list: Vec<(u32, Place)> = Vec::new();
        let mut known: FxHashSet<u32> = FxHashSet::default();
        for in_segment in self.in_segments.chunk_by(|a, b| a.0 == b.0) {
            if let Some(&(id, first)) = in_segment.first()
                && let Some(&segment) = graph.numbers.get(&id)
            {
                let is_read = self.is_read_in(id, self.assignments.get(first as usize));
                known.insert(segment);
                list.push((
                    segment,
                    if is_read {
                        Place::Read
                    } else {
                        Place::Assigned
                    },
                ));
            }
        }
        for &read in self.reads {
            graph.for_each_around(read, |segment| {
                if known.insert(segment) {
                    list.push((segment, Place::Read));
                }
            });
        }
        let (used, mut at) = (list.len(), 0);
        while let Some(&(segment, _)) = list.get(at) {
            at += 1;
            graph.for_each_in_frontier(segment, |join| {
                if known.insert(join) {
                    list.push((join, Place::Join));
                }
            });
            // Going through all the segments takes less.
            if list.len() > graph.last.len() / 32 {
                list.truncate(used);
                list.sort_unstable_by_key(|it| it.0);
                let mut all = vec![None; graph.last.len()];
                for &(segment, place) in &list {
                    if let Some(it) = all.get_mut(segment as usize) {
                        *it = Some(place);
                    }
                }
                return Places {
                    list,
                    nearest: Vec::new(),
                    all,
                };
            }
        }
        list.sort_unstable_by_key(|it| it.0);

        let mut nearest: Vec<(u32, u32)> = Vec::with_capacity(2 * list.len());
        let mut around: Vec<(u32, u32)> = Vec::new();
        for (index, &(segment, _)) in list.iter().enumerate() {
            while let Some(&(_, last)) = around.last().filter(|it| it.1 < segment) {
                around.pop();
                nearest.push((last + 1, around.last().map_or(NONE, |it| it.0)));
            }
            nearest.push((segment, index as u32));
            around.push((index as u32, graph.last[segment as usize]));
        }
        while let Some((_, last)) = around.pop() {
            nearest.push((last + 1, around.last().map_or(NONE, |it| it.0)));
        }
        Places {
            list,
            nearest,
            all: Vec::new(),
        }
    }

    fn look_later(&self, graph: &Graph) -> Later {
        let count = self.assignments.len();
        let expression_start = |it: &Assignment<'a>| it.expression.map_or(0, |it| it.start);
        let (mut expression_starts, mut greatest) = (Vec::with_capacity(count), 0);
        // Whether another assignment is between the identifier and the expression of each. It does no
        // harm to say so of one more.
        let mut is_around = vec![false; count];
        // Those whose expression is still to come, the last to come first.
        let mut ahead: Vec<usize> = Vec::new();
        // What is in one of these is in those before it too.
        let pop = |ahead: &mut Vec<usize>, is_around: &mut [bool]| {
            if let Some(last) = ahead.pop()
                && is_around.get(last) == Some(&true)
                && let Some(&before) = ahead.last()
                && let Some(it) = is_around.get_mut(before)
            {
                *it = true;
            }
        };
        for (index, it) in self.assignments.iter().enumerate() {
            greatest = greatest.max(expression_start(it));
            expression_starts.push(greatest);
            let get = |index: &usize| self.assignments.get(*index);
            while ahead
                .last()
                .and_then(get)
                .is_some_and(|last| expression_start(last) < it.identifier.end)
            {
                pop(&mut ahead, &mut is_around);
            }
            if let Some(&last) = ahead.last()
                && let Some(last) = is_around.get_mut(last)
            {
                *last = true;
            }
            if it.expression.is_some() {
                ahead.push(index);
            }
        }
        while !ahead.is_empty() {
            pop(&mut ahead, &mut is_around);
        }

        let mut apart: Vec<(u32, u32)> = Vec::new();
        let mut least_expression_starts = Vec::with_capacity(self.in_segments.len());
        for in_segment in self.in_segments.chunk_by(|a, b| a.0 == b.0) {
            if let Some(&(id, first)) = in_segment.first()
                && is_around.get(first as usize) == Some(&true)
                && let Some(&segment) = graph.numbers.get(&id)
            {
                apart.push((segment, id));
            }
            let mut least = u32::MAX;
            for it in in_segment {
                least = least.min(
                    self.assignments
                        .get(it.1 as usize)
                        .map_or(0, expression_start),
                );
                least_expression_starts.push(least);
            }
        }
        apart.sort_unstable();

        let places = self.places(graph);
        let is_plain = |segment: u32| apart.binary_search_by_key(&segment, |it| it.0).is_err();
        let read: Vec<u32> = places
            .list
            .iter()
            .filter(|it| it.1 == Place::Read && is_plain(it.0))
            .map(|it| it.0)
            .collect();
        let read_after_plain = places.leading_to(graph, read, true);
        let mut read_after = read_after_plain.clone();
        let mut leading_apart: Vec<(u32, u32, u32)> = Vec::new();
        for &(segment, id) in &apart {
            let leading = places.leading_to(graph, vec![segment], false);
            if places.get(segment) == Some(Place::Read) {
                read_after.extend_from_slice(&leading);
            }
            leading_apart.extend(leading.into_iter().map(|from| (from, segment, id)));
        }
        read_after.sort_unstable();
        read_after.dedup();
        leading_apart.sort_unstable();
        Later {
            read_after,
            read_after_plain,
            leading_apart,
            expression_starts,
            least_expression_starts,
        }
    }

    /// What `search` finds without a limit, from what is known about all the assignments at once.
    /// `None` if that does not tell.
    fn is_read_later_in(
        &self,
        index: usize,
        target: &Assignment<'a>,
        graph: &Graph,
        later: &Later,
    ) -> Option<bool> {
        let number = |segment: &Segment<'a>| graph.numbers.get(&segment.id()).copied();
        let mut from: SmallVec<[u32; 2]> =
            target.segments.iter().map(number).collect::<Option<_>>()?;
        let is_in_a_pattern = (index
            .checked_sub(1)
            .and_then(|it| later.expression_starts.get(it)))
        .is_some_and(|&start| start >= target.identifier.end);
        if !is_in_a_pattern {
            return Some(
                from.iter()
                    .any(|it| later.read_after.binary_search(it).is_ok()),
            );
        }
        // From the end of `from`, and then from the end of each of the segments that are kept apart that
        // is reached and has nothing in it that counts for `target`.
        let mut seen: SmallVec<[u32; 4]> = SmallVec::new();
        while !from.is_empty() {
            if from
                .iter()
                .any(|it| later.read_after_plain.binary_search(it).is_ok())
            {
                return Some(true);
            }
            let mut next: SmallVec<[u32; 2]> = SmallVec::new();
            for &segment in &from {
                let at = later.leading_apart.partition_point(|it| it.0 < segment);
                for &(_, to, id) in later
                    .leading_apart
                    .iter()
                    .skip(at)
                    .take_while(|it| it.0 == segment)
                {
                    if seen.contains(&to) {
                        continue;
                    }
                    seen.push(to);
                    let first = self.first_assignment_in(id, target, Some(later));
                    if self.is_read_in(id, first) {
                        return Some(true);
                    }
                    if first.is_none() {
                        next.push(to);
                    }
                }
            }
            from = next;
        }
        Some(false)
    }

    /// Whether the variable is read in a segment after those of `assignments[index]`, before
    /// something else is assigned to it.
    fn is_read_later(
        &mut self,
        index: usize,
        target: &Assignment<'a>,
        segments: &mut Segments<'a>,
    ) -> bool {
        if let Some(is_read) = self.search(target, 32) {
            return is_read;
        }
        let graph = (segments.graph)
            .get_or_insert_with(|| Graph::new(segments.initial, &segments.started, self.ranges));
        let later = self.later.take().unwrap_or_else(|| self.look_later(graph));
        let is_read = self.is_read_later_in(index, target, graph, &later);
        self.later = Some(later);
        is_read.unwrap_or_else(|| self.search(target, usize::MAX).unwrap_or(true))
    }

    /// Whether nothing reads the value that `assignments[index]` assigns. `next`: what
    /// `next_assignments` tells for it.
    fn is_assignment_unused(
        &mut self,
        index: usize,
        next: u32,
        segments: &mut Segments<'a>,
    ) -> bool {
        let assignments = self.assignments;
        let Some(target) = assignments.get(index) else {
            return false;
        };
        let next = assignments.get(next as usize);
        !self.is_read_at_once(target, next)
            && (next.is_some() || !self.is_read_later(index, target, segments))
    }
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
    /// Where the name starts.
    start: u32,
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
                ExprKind::Unary { .. } if matches!(current, Node::Expr(it) if it.tag() == ExprTag::Ident) =>
                {
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
fn code_path_scope<'a>(scope: Scope<'a>, nearest: &mut Nearest<'a>) -> Option<Scope<'a>> {
    nearest.find(scope, 0, |it| match it.kind() {
        ScopeKind::Global | ScopeKind::ClassStaticBlock => true,
        ScopeKind::Function | ScopeKind::ClassFieldInitializer => {
            !matches!(it.node(), Node::File(_)) && starts_code_path(it.node())
        }
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
    /// What a module exports is not reported.
    is_in_module_scope: bool,
}

impl<'a> Uses<'a> {
    fn of(variable: Symbol<'a>) -> Self {
        let mut all: SmallVec<[Use; 8]> = (variable.references())
            .map(|it| Use {
                start: it.ident().start(),
                is_read: it.is_read(),
                is_write: it.is_write(),
            })
            .collect();
        if !all.is_sorted_by_key(|it| it.start) {
            all.sort_unstable_by_key(|it| it.start);
        }
        Uses {
            all,
            loops: SmallVec::new(),
            budget: 0,
            is_in_module_scope: variable.scope().kind() == ScopeKind::Module,
        }
    }

    fn within(&self, span: Span) -> &[Use] {
        let all = &self.all[..];
        // Most variables are used a few times.
        if all.len() <= 8 {
            let first = all.iter().take_while(|it| it.start < span.start).count();
            let count = all[first..]
                .iter()
                .take_while(|it| it.start < span.end)
                .count();
            return &all[first..first + count];
        }
        let first = all.partition_point(|it| it.start < span.start);
        let end = first + all[first..].partition_point(|it| it.start < span.end);
        &all[first..end]
    }

    /// Whether `written` and what it evaluates first are the only uses in `span`.
    fn is_alone_in(&self, written: &Written<'a>, span: Span) -> bool {
        self.within(span).iter().all(|it| {
            it.start == written.identifier.start
                || !it.is_write
                    && written
                        .expression
                        .is_some_and(|expression| expression.contains_offset(it.start))
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
                read_or_unknown(
                    !first.is_write
                        || matches!(
                            e.kind(),
                            ExprKind::Assign { target, value, .. }
                                if target.span().start == first.start
                                    && rest.iter().all(|it| value.span().contains_offset(it.start))
                        ),
                )
            }
        }
    }

    fn optional_expression(&self, e: Option<Expr<'a>>) -> Flow<'a> {
        e.map_or(Flow::Through, |e| self.expression(e))
    }

    fn declarations(&self, declarators: List<'a, VarDecl<'a>>) -> Flow<'a> {
        let (Some(first), Some(last)) = (declarators.first(), declarators.last()) else {
            return Flow::Through;
        };
        let Some(next) = self.within(first.span().to(last.span())).first() else {
            return Flow::Through;
        };
        // Those before it have nothing to do with the variable.
        match declarators
            .around(next.start)
            .map(|it| self.optional_expression(it.init()))
        {
            Some(Flow::Read) => Flow::Read,
            _ => Flow::Unknown,
        }
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
        let (Some(first), Some(last)) = (
            list.first(),
            list.last().filter(|it| it.span().end > offset),
        ) else {
            return Flow::Through;
        };
        offset = offset.max(first.span().start);
        loop {
            // Whether there is a way from `offset` to the start of `list[at]`. That the end of the one
            // before it can be reached tells the same of those before that.
            let is_reached = |statement: Stmt<'a>| {
                let previous = list.before(statement.span().start);
                previous.is_none_or(|it| it.span().start < offset || it.is_known_to_complete())
            };
            let Some(next) = self
                .within(Span::new(offset, last.span().end))
                .first()
                .copied()
            else {
                return match last.tag() {
                    _ if last.is_known_to_complete() => Flow::Through,
                    StmtTag::Break | StmtTag::Continue if is_reached(last) => Flow::Leaves(last),
                    _ => Flow::Unknown,
                };
            };
            let Some(statement) = list.around(next.start).filter(|&it| is_reached(it)) else {
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
            return if statement.is_known_to_complete() {
                Flow::Through
            } else {
                Flow::Unknown
            };
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
                let out = if is_literal(test) {
                    Flow::Unknown
                } else {
                    Flow::Through
                };
                self.body(body).or(out)
            }
            StmtKind::DoWhile { body, test } => {
                through!(self.statement(body).or(Flow::Unknown));
                through!(self.expression(test));
                if is_literal(test) {
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
                let out = if test.is_some_and(|test| !is_literal(test)) {
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
                if !self.within(left.span()).is_empty() {
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
                    next = match self.statements(case.body(), 0) {
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
            StmtKind::Fn(_) if self.within(statement.span()).iter().any(|it| it.is_read) => {
                Flow::Read
            }
            StmtKind::ExportNamed(_) | StmtKind::ImportEquals(_) => Flow::Read,
            // The same, or it is read where the class is defined.
            StmtKind::Class(_) if self.within(statement.span()).iter().all(|it| !it.is_write) => {
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
        let Some(&first) = self.within(block.span()).first() else {
            return false;
        };
        for statement in block.as_block().into_iter().flatten() {
            let Some(budget) = self.budget.checked_sub(1) else {
                return false;
            };
            self.budget = budget;
            match statement.kind() {
                _ if statement.span().end <= first.start => {
                    if !matches!(statement.tag(), StmtTag::Expr | StmtTag::Var) {
                        return false;
                    }
                }
                StmtKind::Expr(e) => {
                    return match e.kind() {
                        ExprKind::Assign { target: it, .. }
                        | ExprKind::Unary { operand: it, .. } => {
                            it.tag() == ExprTag::Ident && it.span().start == first.start
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
        if !self.loops.contains(&a_loop) {
            self.loops.push(a_loop);
            if self.statement(body) == Flow::Read {
                return true;
            }
        }
        test.is_some_and(|test| !is_literal(test)) && self.is_read_after(a_loop)
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
            if let Some(list) = statement_list(parent) {
                let mut flow = self.statements(list, statement.span().end);
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
        // Not the statement around a function whose body is an expression.
        let statement = written.node.ancestors().find_map(|it| match it {
            Node::Stmt(statement) => Some(Some(statement)),
            Node::Func(_) | Node::Member(_) => Some(None),
            _ => None,
        });
        let Some(statement) = statement.flatten() else {
            return false;
        };
        if !statement.is_reachable()
            || self.is_in_module_scope && statement.tag() == StmtTag::Var && statement.is_exported()
        {
            return true;
        }
        // The part of the statement that it is in.
        let part = match statement.kind() {
            StmtKind::Expr(_) | StmtKind::Var(_) => statement.span(),
            StmtKind::If { test, .. } | StmtKind::While { test, .. } => test.span(),
            StmtKind::For {
                init, test, update, ..
            } => {
                let parts = [
                    init.map(Stmt::span),
                    test.map(Expr::span),
                    update.map(Expr::span),
                ];
                match parts
                    .into_iter()
                    .flatten()
                    .find(|it| it.contains(written.identifier))
                {
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
                Some(test) if test.span() == part => {
                    self.is_read_after_test(statement, Some(test), body)
                }
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
        let nearest = &mut cx.state.code_path_scopes;
        let scope = code_path_scope(variable.scope(), nearest);
        // What a function assigns to a variable from outside it is not looked at.
        let is_unknown = variable
            .references()
            .filter(|it| it.is_write())
            .any(|reference| {
                written_by(reference).is_some_and(|written| !uses.is_known_to_be_read(&written))
                    && code_path_scope(reference.scope(), nearest) == scope
            });
        if !is_unknown {
            return;
        }
        let Some(scope) = scope else {
            return;
        };
        // What a function reads can be read at any time.
        if variable
            .references()
            .any(|it| it.is_read() && code_path_scope(it.scope(), nearest) != Some(scope))
        {
            return;
        }
        let root = match (scope.kind(), scope.node()) {
            (ScopeKind::ClassStaticBlock, Node::Func(func)) => func.owner(),
            (_, node) => node,
        };
        cx.state.roots.insert(root);
    }

    fn check_code_path<'a>(&self, root: Node<'a>, cx: &mut Cx<'a, Self>) {
        let statements = NodeTags::from(StmtTag::Try) | StmtTag::ImportEquals.into();
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
        let mut end = 0;
        for block in &mut target.try_statement_blocks {
            end = end.max(block.end);
            block.end = end;
        }
        let is_in_try_statement_block = |identifier: Span| {
            let blocks = &target.try_statement_blocks;
            let before = blocks.partition_point(|block| block.start <= identifier.start);
            before
                .checked_sub(1)
                .and_then(|it| blocks.get(it))
                .is_some_and(|block| identifier.end <= block.end)
        };
        'variables: for (variable, assignments) in target.assignments {
            let Some(mut assignments) = assignments else {
                continue;
            };
            let mut read_references: SmallVec<[Span; 8]> = SmallVec::new();
            for reference in variable.references().filter(|it| it.is_read()) {
                // It can be called at any time.
                let start = cx.state.code_path_start_scopes.around(reference.scope());
                if start != Some(target.scope) {
                    continue 'variables;
                }
                read_references.push(reference.span());
            }
            // That is for `no-unused-vars` to report.
            if read_references.is_empty() {
                continue;
            }
            if !read_references.is_sorted_by_key(|it| it.start) {
                read_references.sort_unstable_by_key(|it| it.start);
            }
            assignments.sort_by_key(|it| it.identifier.start);
            let mut uses =
                Variable::new(&assignments, &read_references, &cx.state.identifier_ranges);
            let next = uses.next_assignments();
            for (index, (assignment, &next)) in assignments.iter().zip(&next).enumerate() {
                let identifier = assignment.identifier;
                if !is_in_try_statement_block(identifier)
                    && uses.is_assignment_unused(index, next, &mut target.segments)
                {
                    cx.report(identifier, UNNECESSARY_ASSIGNMENT)
                        .data("name", variable.name());
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
        let assignments = match top.assignments.entry(variable) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                let scope = variable.scope();
                let is_ignored = state.code_path_start_scopes.around(scope) != Some(top.scope)
                    || variable.is_marked_used()
                    || scope.kind() == ScopeKind::Module && is_exported(variable);
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

    fn on_code_path_start<'a>(&self, path: CodePath<'a>, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let scope = node.scope();
        cx.state.stack.push(ScopeStack {
            scope,
            assignments: FxHashMap::default(),
            try_statement_blocks: Vec::new(),
            segments: Segments {
                initial: path.initial_segment(),
                started: Vec::new(),
                graph: None,
            },
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
        if let Some(top) = cx.state.stack.last_mut() {
            top.segments.started.push(segment);
        }
        let needed = segment.id() as usize + 1;
        if cx.state.identifier_ranges.len() < needed {
            cx.state.identifier_ranges.resize(needed, NO_IDENTIFIERS);
        }
    }

    fn on_segment_end<'a>(&self, segment: Segment<'a>, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.current_segments.segment_end(segment);
    }

    /// At a `try` statement, or at an `import a = b.c`, whose `b` is a reference.
    fn on_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Try { block, .. } => {
                if let Some(top) = cx.state.stack.last_mut() {
                    top.try_statement_blocks.push(block.span());
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
        extract_identifiers_from_pattern(pattern, |identifier| {
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
