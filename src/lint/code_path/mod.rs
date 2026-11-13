//! ESLint's code path analysis: the routes that execution can take through a function.
//!
//! There's one [`CodePath`] for the file and one for each function, class field initializer and
//! static block. It's made of [`Segment`]s, which fork at a branch and join after it. The analysis
//! only runs where a rule requests it, through [`Func::code_path_steps`], [`steps_of_code_path`] or
//! [`steps`]. Each call ESLint would make to a code path listener is an [`Event`] among the
//! [`Step`]s.
//!
//! As in ESLint, everything requested is analyzed before the first step is returned, so a rule sees
//! the finished graph from the first event on. When a segment starts, its `next_segments()` is
//! complete and its `prev_segments()` already includes the segments that loop back to it and
//! haven't started yet. When a code path starts, its `returned_segments()` is complete.
//!
//! | ESLint | Here |
//! | --- | --- |
//! | `onCodePathStart(codePath, node)`, `onCodePathEnd` | [`Event::CodePathStart`], [`Event::CodePathEnd`] |
//! | `onCodePathSegmentStart(segment, node)`, `onCodePathSegmentEnd` | [`Event::SegmentStart`], [`Event::SegmentEnd`] |
//! | the same two with `Unreachable` | [`Event::UnreachableSegmentStart`], [`Event::UnreachableSegmentEnd`] |
//! | `onCodePathSegmentLoop(from, to, node)` | [`Event::SegmentLoop`] |
//! | `codePath.id`, `segment.id` | `id()` is a number. `to_string()` is ESLint's `s1`, `s1_2` |
//! | `codePath.traverseSegments(options, callback)` | [`CodePath::traverse_segments`], [`CodePath::traverse_segments_between`] |
//! | a `Set` of the current segments, kept by four listeners and a stack | [`CodePath::current_segments`], or [`CurrentSegments`] |
//! | `isAnySegmentReachable(currentSegments)` | [`CodePath::is_current_reachable`] |
//! | `segment.reachable` | [`Segment::is_reachable`] |
//!
//! # Cost, and how to avoid it
//!
//! Analyzing a whole file ([`steps`]) costs about a quarter as much as parsing and binding it. No
//! ESLint rule needs that. The alternatives, cheapest first:
//!
//! 1. A rule's `isAnySegmentReachable(currentSegments)` checks need no listener. One pass over the
//!    file's statements answers them at a few instructions per statement (a twentieth of the
//!    analysis), and it runs once for all rules. The answers match the analysis, quirks included.
//!
//!    | When ESLint's rule checks | Here |
//!    | --- | --- |
//!    | entering a statement | [`Stmt::is_reachable`], [`File::has_unreachable_statements`] |
//!    | leaving a function or the file | [`Func::is_end_reachable`], [`File::is_end_reachable`] |
//!    | leaving a `SwitchCase` | [`Case::is_end_reachable`] |
//!    | `onCodePathSegmentLoop`, to find the loops that never repeat | [`Stmt::is_repeating_loop`] |
//!
//! 2. A rule that needs segments first uses the syntax to find the functions that could have
//!    something to report, in an unordered listener (`on.funcs`, `on.classes`, `on.symbols`), and
//!    analyzes only those: [`Func::code_path_steps`] includes nested functions,
//!    [`steps_of_code_path`] doesn't. It gets the events and the nodes it asked for in order, as
//!    [`Step`]s, and calls what would have been its listeners. See `constructor_super.rs`,
//!    `no_useless_return.rs` and `no_useless_assignment.rs`. The syntactic filter must never skip a
//!    function that has a report. To check, compare all the messages on `flows.ts` and
//!    `generate.ts` with those of the rule without the filter.
//! 3. The analysis skips any expression or type in which nothing forks and nothing was requested,
//!    so pass as few node kinds as possible in `enter` and `exit`. Statements and functions are
//!    cheap, but identifiers make it visit everything.
//!
//! # An event's node
//!
//! It's the node ESLint passes. Where ESLint passes a node that doesn't exist here:
//!
//! | ESLint | Here |
//! | --- | --- |
//! | a function | `Node::Func`, also for a function declaration or expression, whose `Stmt` or `Expr` is entered and left inside the code path of the function, like the `Func` |
//! | `StaticBlock` | `Node::Member` |
//! | the value of a `PropertyDefinition` | the `Expr` |
//! | a function body's `BlockStatement` | `Node::Func` |
//! | `CatchClause` | the `handler` block |
//! | `ChainExpression` | the outermost expression of the chain |
//! | the `b` of `a.b`, the `new` and `target` of `new.target` | the whole expression |
//! | `AssignmentPattern` | the `Param`, `PatElem` or `PatProp` with the default. In the target of an assignment, the `ExprKind::Assign` |
//! | any other name or wrapper (`ExportNamedDeclaration`, `ClassBody`, `TemplateElement`, a key, ..) | the next node that is entered or left |
//!
//! # Differences
//!
//! The ids, graphs and event order match ESLint's. The one difference comes from the order of the
//! walk:
//!
//! - ESTree puts a pattern's type annotation and a parameter's decorators inside the pattern. Here
//!   the annotation comes after the pattern and the decorators before it. To ESLint, a name in a
//!   type can be the first thing that may throw in a `try` block, so in `try { let a: T = b; }` the
//!   segment changes before ESLint leaves the `a`, and here it changes after.
//!
//! JavaScript plugins need the exact ESTree node and position of every event. [`estree`] drives the
//! same graph builder from the ESTree numbering for them.

mod analyzer;
pub(crate) mod estree;
mod matters;
mod reach;
mod state;

#[doc(hidden)]
pub use analyzer::steps;
pub use analyzer::{Step, Steps};
use reach::Reach;

use crate::ast::{Case, File, Func, MemberKind, Node, Stmt};
use crate::rule::NodeTags;
use smallvec::SmallVec;
use std::cell::{Cell, OnceCell, RefCell};

#[derive(Debug)]
pub(crate) struct CodePathData {
    initial_segment: u32,
    final_segments: Vec<u32>,
    returned_segments: Vec<u32>,
    thrown_segments: Vec<u32>,
    current_segments: SegmentIds,
    /// The number of segments numbered so far, including ones nothing refers to.
    segment_count: u32,
}

/// As many as fit in the space a `SmallVec` takes up anyway.
type Edges = SmallVec<[u32; 4]>;
/// One segment per parallel route. There's more than one only inside a `finally` block.
type SegmentIds = SmallVec<[u32; 2]>;

#[derive(Debug, Default)]
pub(crate) struct SegmentData {
    next: Edges,
    prev: Edges,
    all_next: Edges,
    all_prev: Edges,
    /// The entries of `all_prev` that come from the end of a loop. Sorted once the graph is
    /// finished.
    looped_prev: SmallVec<[u32; 2]>,
    path: u32,
    /// Its 1-based number within its code path.
    number: u32,
    /// The epoch of the last `flatten_unused` call that visited it.
    mark: u32,
    is_reachable: bool,
    /// True if it has been the current segment. Otherwise it's left out of the graph.
    is_used: bool,
    is_returned: bool,
    is_thrown: bool,
}

/// A file's code paths and segments.
#[derive(Default)]
pub(crate) struct Store {
    paths: RefCell<Vec<CodePathData>>,
    segments: RefCell<Vec<SegmentData>>,
    /// Counts `flatten_unused` calls.
    epoch: Cell<u32>,
    /// The nodes that matter to the analysis itself, with no rule listening.
    matters: OnceCell<matters::Matters>,
    reach: OnceCell<Reach>,
}

impl Store {
    fn matters_without_listeners<'a>(&self, file: &'a File<'a>) -> &matters::Matters {
        self.matters
            .get_or_init(|| matters::Matters::new(file, NodeTags::EMPTY))
    }
}

impl<'a> Func<'a> {
    /// True if execution can reach the end of the body. It's what ESLint's rules get from
    /// `isAnySegmentReachable(currentSegments)` when they leave the function.
    ///
    /// It only looks at this function's statements, at a few instructions each, and doesn't run the
    /// analysis.
    pub fn is_end_reachable(self) -> bool {
        match self.file().lazy.code_paths.reach.get() {
            Some(reach) => !self.has_body() || reach.is_fn_end_reachable(self),
            None => reach::is_end_reachable(Node::Func(self), None),
        }
    }
}

impl<'a> Func<'a> {
    /// Analyzes only this function and the functions nested in it. Returns, in order, the events
    /// that code path listeners would get, interleaved with the nodes in it whose kinds are in
    /// `enter` and `exit`, which is what [`Rule::enter`](crate::rule::Rule::enter) and
    /// [`Rule::exit`](crate::rule::Rule::exit) would be called with.
    ///
    /// For a rule that can tell from the syntax which few functions it has to look at.
    pub fn code_path_steps(
        self,
        enter: impl Into<NodeTags>,
        exit: impl Into<NodeTags>,
    ) -> Steps<'a> {
        analyzer::steps_of(Node::Func(self), enter.into(), exit.into(), false)
    }
}

/// True if a code path starts at `node`: the file, a function with a body, a static block (the
/// `Member`), or the initializer of a field that ESLint treats as a `PropertyDefinition`, which
/// excludes `accessor` fields.
pub fn starts_code_path(node: Node<'_>) -> bool {
    match node {
        Node::File(_) => true,
        Node::Func(func) => analyzer::has_code_path(func),
        Node::Member(member) => member.kind() == MemberKind::StaticBlock,
        Node::Expr(e) => matches!(
            e.parent(),
            Node::Member(member) if analyzer::is_property_definition(member) && member.init() == Some(e)
        ),
        _ => false,
    }
}

/// [`Func::code_path_steps`] for a single code path: the file's (`Node::File`), a function's
/// (`Node::Func`), a static block's (`Node::Member`) or a field initializer's (`Node::Expr`). A
/// nested code path starts and ends immediately, and its contents are skipped.
pub fn steps_of_code_path<'a>(
    root: Node<'a>,
    enter: impl Into<NodeTags>,
    exit: impl Into<NodeTags>,
) -> Steps<'a> {
    analyzer::steps_of(root, enter.into(), exit.into(), true)
}

impl<'a> File<'a> {
    /// [`Func::is_end_reachable`] for the file's code path.
    pub fn is_end_reachable(&'a self) -> bool {
        match self.lazy.code_paths.reach.get() {
            Some(reach) => reach.is_file_end_reachable(),
            None => reach::is_end_reachable(Node::File(self), None),
        }
    }

    fn reach(&'a self) -> &'a Reach {
        self.lazy.code_paths.reach.get_or_init(|| Reach::new(self))
    }

    /// True if [`Stmt::is_reachable`] is false for some statement.
    pub fn has_unreachable_statements(&'a self) -> bool {
        self.reach().has_unreachable()
    }
}

impl<'a> Stmt<'a> {
    /// True if execution can reach the statement. It's what ESLint's rules get from
    /// `isAnySegmentReachable(currentSegments)` when they enter it. For a function declaration,
    /// that's in the enclosing code path.
    ///
    /// The first call scans all the file's statements, at a few instructions each. It doesn't run
    /// the analysis.
    pub fn is_reachable(self) -> bool {
        self.file().reach().is_reachable(self)
    }
}

impl<'a> Stmt<'a> {
    /// True if execution can definitely reach the end of the statement, and so whatever follows it.
    /// False means unknown, not unreachable.
    ///
    /// See [`Stmt::is_reachable`] for the cost.
    pub fn is_known_to_complete(self) -> bool {
        self.file().reach().is_known_to_complete(self)
    }
}

impl<'a> Stmt<'a> {
    /// True if a loop can start another iteration, meaning the end of its body or a `continue`
    /// targeting it is reachable. ESLint's `no-unreachable-loop` gets this from
    /// `onCodePathSegmentLoop`.
    ///
    /// See [`Stmt::is_reachable`] for the cost.
    pub fn is_repeating_loop(self) -> bool {
        self.file().reach().is_repeating(self)
    }
}

impl<'a> Case<'a> {
    /// True if execution can reach the end of the case and fall through to the next one. It's what
    /// ESLint's rules get from `isAnySegmentReachable(currentSegments)` when they leave it.
    ///
    /// See [`Stmt::is_reachable`] for the cost.
    pub fn is_end_reachable(self) -> bool {
        self.file().reach().is_case_end_reachable(self)
    }
}

pub type Segments<'a> = SmallVec<[Segment<'a>; 2]>;

#[derive(Copy, Clone)]
pub struct CodePath<'a> {
    file: &'a File<'a>,
    id: u32,
}

impl PartialEq for CodePath<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for CodePath<'_> {}
impl std::hash::Hash for CodePath<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
/// ESLint's `codePath.id`: `s1`
impl std::fmt::Display for CodePath<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "s{}", self.id + 1)
    }
}
impl std::fmt::Debug for CodePath<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CodePath({self})")
    }
}

impl<'a> CodePath<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: u32) -> Self {
        CodePath { file, id }
    }

    /// Unique in the file. Numbered from 0 in the order the code paths start.
    #[inline]
    pub fn id(self) -> u32 {
        self.id
    }

    fn read<T>(self, read: impl FnOnce(&CodePathData) -> T) -> T {
        read(&self.file.lazy.code_paths.paths.borrow()[self.id as usize])
    }

    fn segments(self, read: impl FnOnce(&CodePathData) -> &[u32]) -> Segments<'a> {
        let file = self.file;
        self.read(|path| read(path).iter().map(|&id| Segment { file, id }).collect())
    }

    pub fn initial_segment(self) -> Segment<'a> {
        Segment {
            file: self.file,
            id: self.read(|path| path.initial_segment),
        }
    }

    /// `returned_segments` and `thrown_segments` together.
    pub fn final_segments(self) -> Segments<'a> {
        self.segments(|path| &path.final_segments)
    }

    /// The segments that end with a `return`, or with the end of the function.
    pub fn returned_segments(self) -> Segments<'a> {
        self.segments(|path| &path.returned_segments)
    }

    pub fn thrown_segments(self) -> Segments<'a> {
        self.segments(|path| &path.thrown_segments)
    }

    /// The segments that the walk's current node belongs to, meaning those that have started but
    /// not ended. Empty once the code path has ended.
    ///
    /// There's more than one only in a `finally` block.
    pub fn current_segments(self) -> Segments<'a> {
        self.segments(|path| &path.current_segments)
    }

    /// True if the walk's current node is reachable, meaning one of [`CodePath::current_segments`]
    /// is.
    pub fn is_current_reachable(self) -> bool {
        let segments = self.file.lazy.code_paths.segments.borrow();
        self.read(|path| {
            path.current_segments
                .iter()
                .any(|&id| segments[id as usize].is_reachable)
        })
    }

    /// Calls `visit` with every reachable segment, starting at the initial segment. A segment is
    /// visited after all its predecessors, except those that loop back to it.
    pub fn traverse_segments(self, visit: impl FnMut(Segment<'a>, &mut Traversal)) {
        self.traverse_segments_between(None, None, visit);
    }

    /// ESLint's `traverseSegments({ first, last }, callback)`: starts at `first`, or the initial
    /// segment if `None`, and doesn't go past `last`.
    pub fn traverse_segments_between(
        self,
        first: Option<Segment<'a>>,
        last: Option<Segment<'a>>,
        mut visit: impl FnMut(Segment<'a>, &mut Traversal),
    ) {
        let file = self.file;
        let store = &file.lazy.code_paths;
        let start = first.map_or_else(|| self.read(|path| path.initial_segment), |it| it.id);
        let last = last.map(|it| it.id);
        let mut visited = Numbers::default();
        let mut skipped = Numbers::default();
        let mut stack: SmallVec<[(u32, u32); 16]> = SmallVec::new();
        stack.push((start, 0));
        while let Some(&(id, index)) = stack.last() {
            let next = {
                let segments = store.segments.borrow();
                let segment = &segments[id as usize];
                if index == 0 {
                    let is_in = |set: &Numbers, prev: u32| {
                        set.has(&segments[prev as usize])
                            || segment.looped_prev.binary_search(&prev).is_ok()
                    };
                    if visited.has(segment)
                        || id != start && !segment.prev.iter().all(|&prev| is_in(&visited, prev))
                    {
                        stack.pop();
                        continue;
                    }
                    visited.add(segment);
                    let is_skipped = !skipped.is_empty()
                        && !segment.prev.is_empty()
                        && segment.prev.iter().all(|&prev| is_in(&skipped, prev));
                    if is_skipped {
                        skipped.add(segment);
                    } else {
                        let number = (segment.path, segment.number);
                        drop(segments);
                        let mut traversal = Traversal::default();
                        visit(Segment { file, id }, &mut traversal);
                        if traversal.is_skipped || last == Some(id) {
                            skipped.add_number(number);
                        }
                        if traversal.is_broken {
                            break;
                        }
                    }
                }
                let segments = store.segments.borrow();
                let next = &segments[id as usize].next;
                next.get(index as usize)
                    .map(|&it| (it, index as usize + 1 == next.len()))
            };
            match (next, stack.last_mut()) {
                (Some((next, true)), Some(top)) => *top = (next, 0),
                (Some((next, false)), Some(top)) => {
                    top.1 += 1;
                    stack.push((next, 0));
                }
                _ => {
                    stack.pop();
                }
            }
        }
    }
}

/// The `controller` of ESLint's `traverseSegments`.
#[derive(Default)]
pub struct Traversal {
    is_skipped: bool,
    is_broken: bool,
}

impl Traversal {
    /// ESLint's `controller.skip()`: skips everything that can only be reached through this
    /// segment.
    #[inline]
    pub fn skip(&mut self) {
        self.is_skipped = true;
    }
}

/// A set of segments from one code path, with one bit per segment number.
#[derive(Default)]
struct Numbers {
    path: Option<u32>,
    bits: SmallVec<[u64; 4]>,
}

impl Numbers {
    fn is_empty(&self) -> bool {
        self.path.is_none()
    }

    fn has(&self, segment: &SegmentData) -> bool {
        let word = self
            .bits
            .get(segment.number as usize / 64)
            .copied()
            .unwrap_or(0);
        self.path == Some(segment.path) && word & (1 << (segment.number % 64)) != 0
    }

    fn add(&mut self, segment: &SegmentData) {
        self.add_number((segment.path, segment.number));
    }

    fn add_number(&mut self, (path, number): (u32, u32)) {
        if *self.path.get_or_insert(path) != path {
            return;
        }
        let word = number as usize / 64;
        if self.bits.len() <= word {
            self.bits.resize(word + 1, 0);
        }
        self.bits[word] |= 1 << (number % 64);
    }
}

#[derive(Copy, Clone)]
pub struct Segment<'a> {
    file: &'a File<'a>,
    id: u32,
}

impl PartialEq for Segment<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Segment<'_> {}
impl crate::types::Indexed for Segment<'_> {
    #[inline]
    fn index(self) -> u32 {
        self.id
    }
}
impl std::hash::Hash for Segment<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
/// ESLint's `segment.id`: `s1_2`
impl std::fmt::Display for Segment<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (path, number) = self.read(|segment| (segment.path, segment.number));
        write!(f, "s{}_{number}", path + 1)
    }
}
impl std::fmt::Debug for Segment<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Segment({self})")
    }
}

impl<'a> Segment<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: u32) -> Self {
        Segment { file, id }
    }

    /// Unique in the file. It works well as an index into a rule's per-segment state, because ids
    /// are small and increase in creation order.
    #[inline]
    pub fn id(self) -> u32 {
        self.id
    }

    fn read<T>(self, read: impl FnOnce(&SegmentData) -> T) -> T {
        read(&self.file.lazy.code_paths.segments.borrow()[self.id as usize])
    }

    fn others(self, read: impl FnOnce(&SegmentData) -> &[u32]) -> Segments<'a> {
        let file = self.file;
        self.read(|segment| {
            read(segment)
                .iter()
                .map(|&id| Segment { file, id })
                .collect()
        })
    }

    pub fn is_reachable(self) -> bool {
        self.read(|segment| segment.is_reachable)
    }

    pub fn code_path(self) -> CodePath<'a> {
        CodePath {
            file: self.file,
            id: self.read(|segment| segment.path),
        }
    }

    /// The reachable segments that follow.
    pub fn next_segments(self) -> Segments<'a> {
        self.others(|segment| &segment.next)
    }

    /// The reachable segments that precede.
    pub fn prev_segments(self) -> Segments<'a> {
        self.others(|segment| &segment.prev)
    }

    /// The preceding segments, including unreachable ones.
    pub fn all_prev_segments(self) -> Segments<'a> {
        self.others(|segment| &segment.all_prev)
    }
}

/// The set of current segments that many ESLint rules maintain, along with the stack of sets for
/// the enclosing code paths. The rule calls each method on the [`Event`] of the same name.
///
/// [`CodePath::current_segments`] gives the same set without the bookkeeping. This is for a rule
/// that doesn't track the current `CodePath`.
#[derive(Default, Debug)]
pub struct CurrentSegments<'a> {
    /// The outermost code path's segments come first.
    segments: SmallVec<[Segment<'a>; 4]>,
    /// Where each code path's segments start in `segments`.
    starts: SmallVec<[u32; 8]>,
}

impl<'a> CurrentSegments<'a> {
    pub fn code_path_start(&mut self) {
        self.starts.push(self.segments.len() as u32);
    }

    pub fn code_path_end(&mut self) {
        let start = self.starts.pop().unwrap_or(0);
        self.segments.truncate(start as usize);
    }

    /// Also for `unreachable_segment_start`.
    pub fn segment_start(&mut self, segment: Segment<'a>) {
        self.segments.push(segment);
    }

    /// Also for `unreachable_segment_end`.
    pub fn segment_end(&mut self, segment: Segment<'a>) {
        let start = self.starts.last().copied().unwrap_or(0) as usize;
        if let Some(at) = self
            .segments
            .iter()
            .skip(start)
            .position(|it| *it == segment)
        {
            self.segments.remove(start + at);
        }
    }

    /// The innermost code path's segments, in the order they started.
    pub fn as_slice(&self) -> &[Segment<'a>] {
        let start = self.starts.last().copied().unwrap_or(0) as usize;
        self.segments.get(start..).unwrap_or_default()
    }

    pub fn iter(&self) -> impl Iterator<Item = Segment<'a>> + '_ {
        self.as_slice().iter().copied()
    }
}

/// A code path event, with the arguments ESLint passes to the matching listener.
#[derive(Copy, Clone, Debug)]
pub enum Event<'a> {
    CodePathStart(CodePath<'a>, Node<'a>),
    CodePathEnd(CodePath<'a>, Node<'a>),
    SegmentStart(Segment<'a>, Node<'a>),
    SegmentEnd(Segment<'a>, Node<'a>),
    UnreachableSegmentStart(Segment<'a>, Node<'a>),
    UnreachableSegmentEnd(Segment<'a>, Node<'a>),
    SegmentLoop(Segment<'a>, Segment<'a>, Node<'a>),
}
