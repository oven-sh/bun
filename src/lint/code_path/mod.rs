//! ESLint's code path analysis: the routes that execution can take through a function.
//!
//! A [`CodePath`] is made for the file, for each function, each class field initializer and each
//! static block. It consists of [`Segment`]s, which fork at a branch and join after it. The
//! analysis runs only if a rule listens for it
//! ([`Listeners::code_path_start`](crate::rule::Listeners::code_path_start) and the following).
//!
//! As in ESLint, the whole file is analyzed before the first listener is called, and the events
//! are told during the walk. So a rule sees the finished graph from the first event on:
//! `next_segments()` of a segment that starts is complete, its `prev_segments()` include those
//! that lead back to it from the end of a loop and have not started yet, and
//! `returned_segments()` is complete when the code path starts.
//!
//! | ESLint | Here |
//! | --- | --- |
//! | `onCodePathStart(codePath, node)`, `onCodePathEnd` | `on.code_path_start(..)`, `on.code_path_end(..)` |
//! | `onCodePathSegmentStart(segment, node)`, `onCodePathSegmentEnd` | `on.segment_start(..)`, `on.segment_end(..)` |
//! | `onUnreachableCodePathSegmentStart`, `onUnreachableCodePathSegmentEnd` | `on.unreachable_segment_start(..)`, `on.unreachable_segment_end(..)` |
//! | `onCodePathSegmentLoop(from, to, node)` | `on.segment_loop(..)` |
//! | `codePath.id`, `segment.id` | `id()` is a number. `to_string()` is ESLint's `s1`, `s1_2` |
//! | `codePath.origin` | [`CodePath::origin`] |
//! | `codePath.traverseSegments(options, callback)` | [`CodePath::traverse_segments`], [`CodePath::traverse_segments_between`] |
//! | a `Set` of the current segments, kept by four listeners and a stack | [`CodePath::current_segments`], or [`CurrentSegments`] |
//! | `isAnySegmentReachable(currentSegments)` | [`CodePath::is_current_reachable`] |
//! | `segment.reachable` | [`Segment::is_reachable`] |
//!
//! # What it costs, and how to avoid it
//!
//! A listener for code paths makes the linter analyze the whole file, which costs about a quarter
//! of what parsing and binding it costs. No rule of ESLint needs that. In the order of what they
//! cost:
//!
//! 1. What a rule asks with `isAnySegmentReachable(currentSegments)` is answered without any
//!    listener, by a pass over the statements of the file that takes a few instructions for each
//!    (a twentieth of the analysis) and is made once for all rules. The answers are those of the
//!    analysis, quirks included (`test/cli/lint/oracle/code_path/reach.ts` compares them).
//!
//!    | when ESLint's rule asks | Here |
//!    | --- | --- |
//!    | entering a statement | [`Stmt::is_reachable`], [`File::has_unreachable_statements`] |
//!    | leaving a function or the file | [`Func::is_end_reachable`], [`File::is_end_reachable`] |
//!    | leaving a `SwitchCase` | [`Case::is_end_reachable`] |
//!    | `onCodePathSegmentLoop`, to find the loops that never repeat | [`Stmt::is_repeating_loop`] |
//!
//! 2. A rule that needs segments finds out from the syntax which functions can have something to
//!    report, in a listener without order (`on.funcs`, `on.classes`, `on.symbols`), and analyzes
//!    only those: [`Func::code_path_steps`] with the functions in it, [`steps_of_code_path`]
//!    without. It gets the events and the nodes it wants in order, as [`Step`]s, and calls what
//!    would have been its listeners. See `constructor_super.rs`, `no_useless_return.rs` and
//!    `no_useless_assignment.rs`. What tells that there is nothing to report has to be certain:
//!    compare all the messages on `flows.ts` and `generate.ts` with those of the rule without it.
//! 3. With listeners, the walk does not go into an expression or a type in which nothing forks and
//!    nothing is listened for: `on.enter(..)` and `on.exit(..)` as few kinds of nodes as possible.
//!    Statements and functions are cheap, identifiers make the walk visit everything.
//!
//! # The node of an event
//!
//! It is the node that ESLint passes. Where ESLint passes a node that does not exist here:
//!
//! | ESLint | Here |
//! | --- | --- |
//! | a function | `Node::Func`, also for a function declaration or expression, whose `Stmt` or `Expr` is entered and left inside the code path of the function, like the `Func` |
//! | `StaticBlock` | `Node::Member` |
//! | the value of a `PropertyDefinition` | the `Expr` |
//! | the `BlockStatement` that is the body of a function | `Node::Func` |
//! | `CatchClause` | the `handler` block |
//! | `ChainExpression` | the outermost expression of the chain |
//! | the `b` of `a.b`, the `new` and `target` of `new.target` | the whole expression |
//! | `AssignmentPattern` | the `Param`, `PatElem` or `PatProp` with the default. In the target of an assignment, the `ExprKind::Assign` |
//! | any other name or wrapper (`ExportNamedDeclaration`, `ClassBody`, `TemplateElement`, a key, ..) | the next node that is entered or left |
//!
//! # Differences
//!
//! The ids, the graphs and the order of the events are ESLint's
//! (`test/cli/lint/oracle/code_path/trace.ts` compares them). What differs follows from the order
//! of the walk:
//!
//! - ESTree has the type annotation of a pattern and the decorators of a parameter inside the
//!   pattern. Here the annotation comes after the pattern and the decorators before it. A name in
//!   a type is what may throw first in a `try` block as far as ESLint knows, so in
//!   `try { let a: T = b; }` the segment changes before ESLint leaves the `a`, and here after.
//! - Each `finally` block that a `return` or a `throw` leads through doubles the number of
//!   current segments in it. Here that ends with 256 of them, which takes 8 such blocks each in
//!   the `finally` block of the other: further ones are analyzed as if only their end was left.

mod analyzer;
mod matters;
mod reach;
mod state;

#[doc(hidden)]
pub use analyzer::steps;
pub use analyzer::{Step, Steps};
#[doc(hidden)]
pub use reach::Method;
use reach::Reach;

use crate::ast::{Case, File, Func, Handle, MemberKind, Node, Stmt};
use crate::rule::NodeTags;
use smallvec::SmallVec;
use std::cell::{Cell, OnceCell, RefCell};

/// ESLint's `codePath.origin`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Origin {
    Program,
    Function,
    ClassFieldInitializer,
    ClassStaticBlock,
}

#[derive(Debug)]
pub(crate) struct CodePathData {
    origin: Origin,
    upper: Option<u32>,
    children: Vec<u32>,
    initial_segment: u32,
    final_segments: Vec<u32>,
    returned_segments: Vec<u32>,
    thrown_segments: Vec<u32>,
    current_segments: SegmentIds,
    /// How many segments have been numbered, including those that nothing refers to.
    segment_count: u32,
}

/// As many as fit in the space that a `SmallVec` takes anyway.
type Edges = SmallVec<[u32; 4]>;
/// One segment for each of the parallel routes, of which there is more than one only inside a
/// `finally` block.
type SegmentIds = SmallVec<[u32; 2]>;

#[derive(Debug, Default)]
pub(crate) struct SegmentData {
    next: Edges,
    prev: Edges,
    all_next: Edges,
    all_prev: Edges,
    /// Those of `all_prev` that come from the end of a loop. Sorted once the graph is finished.
    looped_prev: SmallVec<[u32; 2]>,
    path: u32,
    /// Counted from 1 in its code path.
    number: u32,
    /// The last call of `flatten_unused` that has seen it.
    mark: u32,
    is_reachable: bool,
    /// Whether it has been the current segment. One that has not is left out of the graph.
    is_used: bool,
    is_returned: bool,
    is_thrown: bool,
}

/// The code paths and the segments of a file.
#[derive(Default)]
pub(crate) struct Store {
    paths: RefCell<Vec<CodePathData>>,
    segments: RefCell<Vec<SegmentData>>,
    /// Counts the calls of `flatten_unused`.
    epoch: Cell<u32>,
    /// What matters to the analysis itself.
    matters: OnceCell<matters::Matters>,
    reach: OnceCell<Reach>,
}

impl Store {
    fn what_matters_to_nobody<'a>(&self, file: &'a File<'a>) -> &matters::Matters {
        self.matters
            .get_or_init(|| matters::Matters::new(file, NodeTags::EMPTY))
    }
}

impl<'a> Func<'a> {
    /// Whether execution can reach the end of the body: what ESLint's rules ask with
    /// `isAnySegmentReachable(currentSegments)` when they leave the function.
    ///
    /// It looks at the statements of this function alone, and takes a few instructions for each. A
    /// rule that asks nothing else needs no listener for code paths, which make the linter
    /// analyze the file.
    pub fn is_end_reachable(self) -> bool {
        match self.file().lazy.code_paths.reach.get() {
            Some(reach) => !self.has_body() || reach.is_fn_end_reachable(self),
            None => reach::is_end_reachable(Node::Func(self), Method::Quick, None),
        }
    }
}

impl<'a> Func<'a> {
    /// Analyzes this function alone, with the functions in it, and returns what the listeners for
    /// code paths would be called with, in order, together with the nodes of the kinds `enter` and
    /// `exit` in it: what [`Listeners::enter`](crate::rule::Listeners::enter) and
    /// [`Listeners::exit`](crate::rule::Listeners::exit) would be called with.
    ///
    /// For a rule that finds out from the syntax which few functions it has to look at: it needs
    /// no listener for code paths, which make the linter analyze the whole file. The code path of
    /// the function has no [`CodePath::upper`].
    pub fn code_path_steps(
        self,
        enter: impl Into<NodeTags>,
        exit: impl Into<NodeTags>,
    ) -> Steps<'a> {
        analyzer::steps_of(Node::Func(self), enter.into(), exit.into(), false)
    }
}

/// Whether a code path starts with `node`: it is the file, a function with a body, a static block
/// (the `Member`), or the initializer of a field that is a `PropertyDefinition` for ESLint, which
/// one with `accessor` is not.
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

/// [`Func::code_path_steps`] for one code path alone: that of the file (`Node::File`), of a function
/// (`Node::Func`), of a static block (`Node::Member`) or of the initializer of a field
/// (`Node::Expr`). The code paths in it start and end at once: what is in them is left out.
pub fn steps_of_code_path<'a>(
    root: Node<'a>,
    enter: impl Into<NodeTags>,
    exit: impl Into<NodeTags>,
) -> Steps<'a> {
    analyzer::steps_of(root, enter.into(), exit.into(), true)
}

impl<'a> File<'a> {
    /// [`Func::is_end_reachable`] for the code path of the file.
    pub fn is_end_reachable(&'a self) -> bool {
        match self.lazy.code_paths.reach.get() {
            Some(reach) => reach.is_file_end_reachable(),
            None => reach::is_end_reachable(Node::File(self), Method::Quick, None),
        }
    }

    fn reach(&'a self) -> &'a Reach {
        self.lazy
            .code_paths
            .reach
            .get_or_init(|| Reach::new(self, Method::Quick))
    }

    /// Whether there is a statement for which [`Stmt::is_reachable`] does not hold.
    pub fn has_unreachable_statements(&'a self) -> bool {
        self.reach().has_unreachable()
    }
}

impl<'a> Stmt<'a> {
    /// Whether execution can reach the statement: what ESLint's rules ask with
    /// `isAnySegmentReachable(currentSegments)` when they enter it. For a function declaration,
    /// that is in the code path around it.
    ///
    /// The first call looks at all the statements of the file, and takes a few instructions for
    /// each. It needs no listener for code paths.
    pub fn is_reachable(self) -> bool {
        self.file().reach().is_reachable(self)
    }
}

impl<'a> Stmt<'a> {
    /// Whether execution is known to be able to reach the end of the statement, and so what
    /// follows it. If this does not hold, it may still be able to.
    ///
    /// See [`Stmt::is_reachable`] for what it costs.
    pub fn is_known_to_complete(self) -> bool {
        self.file().reach().is_known_to_complete(self)
    }
}

impl<'a> Stmt<'a> {
    /// Whether a loop can start another iteration: the end of its body or a `continue` for it can
    /// be reached. It is what ESLint's `no-unreachable-loop` finds out from
    /// `onCodePathSegmentLoop`.
    ///
    /// See [`Stmt::is_reachable`] for what it costs.
    pub fn is_repeating_loop(self) -> bool {
        self.file().reach().is_repeating(self)
    }
}

impl<'a> Case<'a> {
    /// Whether execution can reach the end of the case, and so falls through to the next: what
    /// ESLint's rules ask with `isAnySegmentReachable(currentSegments)` when they leave it.
    ///
    /// See [`Stmt::is_reachable`] for what it costs.
    pub fn is_end_reachable(self) -> bool {
        self.file().reach().is_case_end_reachable(self)
    }
}

/// What [`Stmt::is_reachable`] and the like answer for `file` if they find out by `method`: the
/// unreachable statements, the cases and the functions whose end can be reached, whether that of
/// the file can, and the loops that repeat. For comparing the methods.
#[doc(hidden)]
pub fn reachability<'a>(
    file: &'a File<'a>,
    method: Method,
) -> (
    Vec<Stmt<'a>>,
    Vec<Case<'a>>,
    Vec<Func<'a>>,
    bool,
    Vec<Stmt<'a>>,
) {
    let reach = Reach::new(file, method);
    let (mut statements, mut cases, mut funcs, mut loops) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for id in 0..file.hir.stmts.len() as u32 {
        let stmt = Stmt::from_raw(file, id);
        if !reach.is_reachable(stmt) {
            statements.push(stmt);
        }
        if reach.is_repeating(stmt) {
            loops.push(stmt);
        }
    }
    file.every_case(|case| {
        if reach.is_case_end_reachable(case) {
            cases.push(case);
        }
    });
    file.every_func(|func| {
        if reach.is_fn_end_reachable(func) {
            funcs.push(func);
        }
    });
    (
        statements,
        cases,
        funcs,
        reach.is_file_end_reachable(),
        loops,
    )
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

    /// Unique in the file, and counted from 0 in the order in which the code paths start.
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

    pub fn origin(self) -> Origin {
        self.read(|path| path.origin)
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

    /// The segments that the node which the walk is at belongs to: those that have started and
    /// not ended. Empty once the code path has ended.
    ///
    /// There is more than one only in a `finally` block.
    pub fn current_segments(self) -> Segments<'a> {
        self.segments(|path| &path.current_segments)
    }

    /// Whether the node which the walk is at can be reached: one of
    /// [`CodePath::current_segments`] is reachable.
    pub fn is_current_reachable(self) -> bool {
        let segments = self.file.lazy.code_paths.segments.borrow();
        self.read(|path| {
            path.current_segments
                .iter()
                .any(|&id| segments[id as usize].is_reachable)
        })
    }

    /// The code path of what contains the function.
    pub fn upper(self) -> Option<CodePath<'a>> {
        let file = self.file;
        self.read(|path| path.upper).map(|id| CodePath { file, id })
    }

    pub fn child_code_paths(self) -> Vec<CodePath<'a>> {
        let file = self.file;
        self.read(|path| {
            path.children
                .iter()
                .map(|&id| CodePath { file, id })
                .collect()
        })
    }

    /// Calls `visit` with every reachable segment, from the initial segment on. A segment comes
    /// after all that precede it, except those that lead back to it from the end of a loop.
    pub fn traverse_segments(self, visit: impl FnMut(Segment<'a>, &mut Traversal)) {
        self.traverse_segments_between(None, None, visit);
    }

    /// ESLint's `traverseSegments({ first, last }, callback)`: from `first`, or else the initial
    /// segment, and not beyond `last`.
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
    /// ESLint's `controller.skip()`: leaves out what can only be reached through this segment.
    #[inline]
    pub fn skip(&mut self) {
        self.is_skipped = true;
    }

    /// ESLint's `controller.break()`: ends the traversal.
    #[inline]
    pub fn stop(&mut self) {
        self.is_broken = true;
    }
}

/// A set of segments of one code path: a bit for each number.
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

    /// Unique in the file. A good index for what a rule keeps about each segment: the numbers are
    /// small, and grow in the order in which the segments are made.
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

    /// Including the unreachable ones.
    pub fn all_next_segments(self) -> Segments<'a> {
        self.others(|segment| &segment.all_next)
    }

    /// Including the unreachable ones.
    pub fn all_prev_segments(self) -> Segments<'a> {
        self.others(|segment| &segment.all_prev)
    }

    /// Whether `prev` leads here from the end of a loop.
    pub fn is_looped_prev_segment(self, prev: Segment<'a>) -> bool {
        self.read(|segment| segment.looped_prev.binary_search(&prev.id).is_ok())
    }
}

/// The set of current segments that many of ESLint's rules keep, with the stack of those of the
/// enclosing code paths. The rule calls each method from the listener of the same name.
///
/// [`CodePath::current_segments`] is the same without any listener. This is for a rule that does
/// not keep the current `CodePath`.
#[derive(Default, Debug)]
pub struct CurrentSegments<'a> {
    /// Those of the outermost code path first.
    segments: SmallVec<[Segment<'a>; 4]>,
    /// Where those of each code path start in `segments`.
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

    /// Those of the innermost code path, in the order in which they have started.
    pub fn as_slice(&self) -> &[Segment<'a>] {
        let start = self.starts.last().copied().unwrap_or(0) as usize;
        self.segments.get(start..).unwrap_or_default()
    }

    pub fn iter(&self) -> impl Iterator<Item = Segment<'a>> + '_ {
        self.as_slice().iter().copied()
    }

    /// ESLint's `isAnySegmentReachable(currentSegments)`.
    pub fn is_any_reachable(&self) -> bool {
        self.iter().any(Segment::is_reachable)
    }
}

/// What the analysis tells the rules: what a listener for code paths is called with.
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
