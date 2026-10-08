//! ESLint's code path analysis: the routes that execution can take through a function.
//!
//! A [`CodePath`] is made for the file, for each function, each class field initializer and each
//! static block. It consists of [`Segment`]s, which fork at a branch and join after it. The
//! analysis runs during the walk of the file, and only if a rule listens for it
//! ([`Listeners::code_path_start`](crate::rule::Listeners::code_path_start) and the following).
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
//! | `segment.reachable` | [`Segment::is_reachable`] |
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
//! | an expression that is the `init` of a `for` or the `left` of a `for`-`in` or `for`-`of` | the `Stmt` around it, which is what `StmtKind::For::init` and `StmtKind::ForIn::left` are |
//! | `AssignmentPattern` | the `Param`, `PatElem` or `PatProp` with the default. In the target of an assignment, the `ExprKind::Assign` |
//! | any other name or wrapper (`ExportNamedDeclaration`, `ClassBody`, `TemplateElement`, a key, ..) | the next node that is entered or left |

mod analyzer;
mod state;

pub(crate) use analyzer::Analyzer;

use crate::ast::{File, Node};
use smallvec::SmallVec;
use std::cell::{Cell, RefCell};

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
    /// Those of `all_prev` that come from the end of a loop.
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

/// The code paths and the segments of a file. It grows during the walk.
#[derive(Default)]
pub(crate) struct Store {
    paths: RefCell<Vec<CodePathData>>,
    segments: RefCell<Vec<SegmentData>>,
    /// Counts the calls of `flatten_unused`.
    epoch: Cell<u32>,
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
        self.read(|path| path.current_segments.iter().any(|&id| segments[id as usize].is_reachable))
    }

    /// The code path of what contains the function.
    pub fn upper(self) -> Option<CodePath<'a>> {
        let file = self.file;
        self.read(|path| path.upper).map(|id| CodePath { file, id })
    }

    pub fn child_code_paths(self) -> Vec<CodePath<'a>> {
        let file = self.file;
        self.read(|path| path.children.iter().map(|&id| CodePath { file, id }).collect())
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
                        set.has(&segments[prev as usize]) || segment.looped_prev.contains(&prev)
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
                next.get(index as usize).map(|&it| (it, index as usize + 1 == next.len()))
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
        let word = self.bits.get(segment.number as usize / 64).copied().unwrap_or(0);
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
        self.read(|segment| read(segment).iter().map(|&id| Segment { file, id }).collect())
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
        self.read(|segment| segment.looped_prev.contains(&prev.id))
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
        if let Some(at) = self.segments.iter().skip(start).position(|it| *it == segment) {
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

/// What the analysis tells the rules.
#[derive(Copy, Clone, Debug)]
#[doc(hidden)]
pub enum Event<'a> {
    CodePathStart(CodePath<'a>, Node<'a>),
    CodePathEnd(CodePath<'a>, Node<'a>),
    SegmentStart(Segment<'a>, Node<'a>),
    SegmentEnd(Segment<'a>, Node<'a>),
    UnreachableSegmentStart(Segment<'a>, Node<'a>),
    UnreachableSegmentEnd(Segment<'a>, Node<'a>),
    SegmentLoop(Segment<'a>, Segment<'a>, Node<'a>),
}
