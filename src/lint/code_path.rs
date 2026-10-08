//! ESLint's code path analysis: the routes that execution can take through a function.
//!
//! A [`CodePath`] is made for the file, for each function, each class field initializer and each
//! static block. It consists of [`Segment`]s, which fork at a branch and join after it. The
//! analysis runs during the walk of the file, and only if a rule listens for it
//! ([`Listeners::code_path_start`](crate::rule::Listeners::code_path_start) and the following).

use crate::ast::{File, Node};
use smallvec::SmallVec;
use std::cell::RefCell;

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
    pub(crate) origin: Origin,
    pub(crate) upper: Option<u32>,
    pub(crate) children: Vec<u32>,
    pub(crate) initial_segment: u32,
    pub(crate) final_segments: Vec<u32>,
    pub(crate) returned_segments: Vec<u32>,
    pub(crate) thrown_segments: Vec<u32>,
}

#[derive(Debug, Default)]
pub(crate) struct SegmentData {
    pub(crate) next: SmallVec<[u32; 2]>,
    pub(crate) prev: SmallVec<[u32; 2]>,
    pub(crate) all_next: SmallVec<[u32; 2]>,
    pub(crate) all_prev: SmallVec<[u32; 2]>,
    pub(crate) is_reachable: bool,
}

/// The code paths and the segments of a file. It grows during the walk.
#[derive(Default)]
pub(crate) struct Store {
    pub(crate) paths: RefCell<Vec<CodePathData>>,
    pub(crate) segments: RefCell<Vec<SegmentData>>,
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
impl std::fmt::Debug for CodePath<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CodePath({})", self.id)
    }
}

impl<'a> CodePath<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: u32) -> Self {
        CodePath { file, id }
    }

    /// Unique in the file.
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

    /// The code path of what contains the function.
    pub fn upper(self) -> Option<CodePath<'a>> {
        let file = self.file;
        self.read(|path| path.upper).map(|id| CodePath { file, id })
    }

    pub fn child_code_paths(self) -> Vec<CodePath<'a>> {
        let file = self.file;
        self.read(|path| path.children.iter().map(|&id| CodePath { file, id }).collect())
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
impl std::fmt::Debug for Segment<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Segment({})", self.id)
    }
}

impl<'a> Segment<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: u32) -> Self {
        Segment { file, id }
    }

    /// Unique in the file.
    #[inline]
    pub fn id(self) -> u32 {
        self.id
    }

    fn others(self, read: impl FnOnce(&SegmentData) -> &[u32]) -> Segments<'a> {
        let file = self.file;
        let segments = file.lazy.code_paths.segments.borrow();
        let others = read(&segments[self.id as usize]).iter();
        others.map(|&id| Segment { file, id }).collect()
    }

    pub fn is_reachable(self) -> bool {
        self.file.lazy.code_paths.segments.borrow()[self.id as usize].is_reachable
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

/// ESLint's `CodePathAnalyzer`.
pub(crate) struct Analyzer<'a> {
    file: &'a File<'a>,
}

impl<'a> Analyzer<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Analyzer { file }
    }

    /// `enterNode`, up to where it calls the listeners of the node.
    pub(crate) fn enter(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let _ = (self.file, node, emit, CodePath::new, Segment::new);
    }

    /// `leaveNode`, before it calls the listeners of the node.
    pub(crate) fn before_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let _ = (node, emit);
    }

    /// `leaveNode`, after it has called them.
    pub(crate) fn after_exit(&mut self, node: Node<'a>, emit: &mut dyn FnMut(Event<'a>)) {
        let _ = (node, emit);
    }
}
