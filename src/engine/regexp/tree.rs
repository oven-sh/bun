//! What a pattern means, without its syntax.

use core::marker::PhantomData;
use core::ops::{Index, Range};

use bun_engine_unicode::IgnoreCase;
use smallvec::{Array, SmallVec};

use crate::set::Set;
use crate::{Error, Flags};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct NodeId(u32);

impl NodeId {
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// Equal sets nearly always have the same one.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct SetId(pub(crate) u32);

impl SetId {
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

/// A slice that the tree holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Span<T> {
    start: u32,
    end: u32,
    element: PhantomData<T>,
}

impl<T> Span<T> {
    #[inline]
    pub(crate) fn new(range: Range<usize>) -> Span<T> {
        Span {
            start: range.start as u32,
            end: range.end as u32,
            element: PhantomData,
        }
    }

    #[inline]
    pub(crate) fn range(self) -> Range<usize> {
        self.start as usize..self.end as usize
    }

    #[inline]
    pub fn len(self) -> usize {
        (self.end - self.start) as usize
    }

    /// `range` counts from the start of the span and is inside it.
    #[inline]
    pub fn slice(self, range: Range<usize>) -> Span<T> {
        assert!(range.start <= range.end && range.end <= self.end as usize - self.start as usize);
        let start = self.start as usize;
        Span::new(start + range.start..start + range.end)
    }
}

/// The index of a capturing group, from 1.
pub type Group = u16;

pub const MAX_GROUPS: Group = 1 << 15;

/// The groups whose left parentheses are inside a node.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Groups {
    pub first: Group,
    pub end: Group,
}

impl Groups {
    #[inline]
    pub fn is_empty(self) -> bool {
        self.first >= self.end
    }

    #[inline]
    pub fn range(self) -> Range<Group> {
        self.first..self.end
    }
}

pub const UNBOUNDED: u32 = u32::MAX;

/// The flags `i`, `m` and `s` are resolved. Children are in the order of the source, also inside a lookbehind.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Node {
    Empty,
    /// One character or more. With `ignore_case` each is the canonical one of those equal to it.
    Text {
        chars: Span<u32>,
        ignore_case: bool,
    },
    /// One character. The set is closed over case where case is ignored, and can be empty.
    Set(SetId),
    /// Two children or more, none of them `Empty` or `Sequence`.
    Sequence(Span<NodeId>),
    /// Two children or more.
    Alternation(Span<NodeId>),
    Capture {
        group: Group,
        body: NodeId,
    },
    /// `max` is not zero, `min` and `max` are not both one, and `body` is neither `Empty` nor `Look`. Greedy if `min`
    /// is `max`.
    Repeat {
        body: NodeId,
        min: u32,
        max: u32,
        greedy: bool,
        captures: Groups,
    },
    Look {
        body: NodeId,
        behind: bool,
        negated: bool,
        captures: Groups,
    },
    /// To whichever of the groups has matched: at most one has. None of them encloses this node.
    BackReference {
        groups: Span<Group>,
        ignore_case: bool,
    },
    InputStart,
    InputEnd,
    LineStart,
    LineEnd,
    /// By [`Set::WORD`], or by [`Set::WORD_IGNORING_CASE`].
    WordBoundary {
        negated: bool,
        unicode_ignore_case: bool,
    },
}

/// A node comes after its children. The last one is the root, and every other has one parent.
pub struct Tree {
    nodes: SmallVec<[Node; 12]>,
    children: SmallVec<[NodeId; 12]>,
    chars: SmallVec<[u32; 24]>,
    groups: SmallVec<[Group; 4]>,
    sets: SmallVec<[Set; 3]>,
    group_count: Group,
    flags: Flags,
}

const MAX_ELEMENTS: usize = 1 << 22;

#[inline(always)]
fn reserve<A: Array>(elements: &mut SmallVec<A>, additional: usize) -> Result<(), Error> {
    if additional > elements.capacity() - elements.len() {
        grow(elements, additional)?;
    }
    Ok(())
}

#[cold]
fn grow<A: Array>(elements: &mut SmallVec<A>, additional: usize) -> Result<(), Error> {
    let required = elements.len() + additional;
    if required > MAX_ELEMENTS {
        return Err(Error::PatternTooLarge);
    }
    elements
        .try_grow((required * 2).next_power_of_two().min(MAX_ELEMENTS))
        .map_err(|_| Error::OutOfMemory)
}

#[inline(always)]
fn append<A: Array<Item: Copy>>(
    elements: &mut SmallVec<A>,
    new: &[A::Item],
) -> Result<Span<A::Item>, Error> {
    reserve(elements, new.len())?;
    let start = elements.len();
    elements.extend(new.iter().copied());
    Ok(Span::new(start..start + new.len()))
}

impl Tree {
    /// Without a node.
    #[inline]
    pub(crate) fn new(flags: Flags) -> Tree {
        Tree {
            nodes: SmallVec::new(),
            children: SmallVec::new(),
            chars: SmallVec::new(),
            groups: SmallVec::new(),
            sets: SmallVec::new(),
            group_count: 0,
            flags,
        }
    }

    /// The node that was added last.
    #[inline]
    pub fn root(&self) -> NodeId {
        NodeId(self.nodes.len() as u32 - 1)
    }

    #[inline]
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn nodes(&self) -> impl DoubleEndedIterator<Item = (NodeId, Node)> {
        let nodes = self.nodes.iter().enumerate();
        nodes.map(|(index, &node)| (NodeId(index as u32), node))
    }

    #[inline]
    pub fn set_count(&self) -> usize {
        self.sets.len()
    }

    /// The whole match does not count.
    #[inline]
    pub fn group_count(&self) -> Group {
        self.group_count
    }

    /// Whether a character is a code point rather than a code unit.
    #[inline]
    pub fn is_unicode_aware(&self) -> bool {
        self.flags.is_unicode_aware()
    }

    #[inline]
    pub fn is_sticky(&self) -> bool {
        self.flags.contains(Flags::STICKY)
    }

    /// What `ignore_case` of a node means.
    #[inline]
    pub fn case_equivalence(&self) -> IgnoreCase {
        match self.is_unicode_aware() {
            true => IgnoreCase::CodePoints,
            false => IgnoreCase::CodeUnits,
        }
    }

    #[inline(always)]
    pub(crate) fn add(&mut self, node: Node) -> Result<NodeId, Error> {
        let id = NodeId(self.nodes.len() as u32);
        reserve(&mut self.nodes, 1)?;
        self.nodes.push(node);
        Ok(id)
    }

    pub(crate) fn set_group_count(&mut self, group_count: Group) {
        self.group_count = group_count;
    }

    #[inline]
    pub(crate) fn truncate(&mut self, node_count: usize) {
        self.nodes.truncate(node_count);
    }

    pub(crate) fn replace(&mut self, id: NodeId, node: Node) {
        self.nodes[id.index()] = node;
    }

    /// Returns the number of characters that the tree has now.
    #[inline(always)]
    pub(crate) fn push_char(&mut self, c: u32) -> Result<usize, Error> {
        let count = self.chars.len() + 1;
        reserve(&mut self.chars, 1)?;
        self.chars.push(c);
        Ok(count)
    }

    /// Returns the number of characters that the tree has now.
    #[inline(always)]
    pub(crate) fn extend_chars(
        &mut self,
        most: usize,
        chars: impl Iterator<Item = u32>,
    ) -> Result<usize, Error> {
        reserve(&mut self.chars, most)?;
        self.chars.extend(chars);
        Ok(self.chars.len())
    }

    #[inline]
    pub(crate) fn add_children(&mut self, children: &[NodeId]) -> Result<Span<NodeId>, Error> {
        append(&mut self.children, children)
    }

    pub(crate) fn add_groups(&mut self, groups: &[Group]) -> Result<Span<Group>, Error> {
        append(&mut self.groups, groups)
    }

    #[inline]
    pub(crate) fn add_set(&mut self, set: Set) -> Result<SetId, Error> {
        let id = SetId(self.sets.len() as u32);
        reserve(&mut self.sets, 1)?;
        self.sets.push(set);
        Ok(id)
    }

    #[inline]
    pub(crate) fn sets(&self) -> &[Set] {
        &self.sets
    }
}

impl Index<NodeId> for Tree {
    type Output = Node;

    #[inline]
    fn index(&self, id: NodeId) -> &Node {
        &self.nodes[id.index()]
    }
}

impl Index<SetId> for Tree {
    type Output = Set;

    #[inline]
    fn index(&self, id: SetId) -> &Set {
        &self.sets[id.index()]
    }
}

macro_rules! index_by_span {
    ($($element:ty => $field:ident),*) => {$(
        impl Index<Span<$element>> for Tree {
            type Output = [$element];

            #[inline]
            fn index(&self, span: Span<$element>) -> &[$element] {
                &self.$field[span.range()]
            }
        }
    )*};
}

index_by_span!(NodeId => children, u32 => chars, Group => groups);
