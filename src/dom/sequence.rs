//! The elements of a tree in order, for searches that follow each other while it keeps its shape.

use core::cell::Cell;
use core::ops::Range;
use std::rc::Rc;

use crate::name::Name;
use crate::rules::Classes;
use crate::selector::second_filter_of;
use crate::tree::{Element, NodeId, Tree};

#[derive(Default)]
pub(crate) struct Row {
    /// `Node::keys`, and `second_filter_of` the element.
    pub(crate) filters: [u64; 2],
    pub(crate) tag: Name,
    pub(crate) first_class: Name,
    pub(crate) classes: Option<Rc<Classes>>,
    pub(crate) id: NodeId,
    /// The row, or 0.
    pub(crate) parent: u32,
}

/// Bits of `Row::filters` that are all required, or `ANY`.
pub(crate) type Wanted = [u8; 4];

pub(crate) const ANY: u8 = 128;

#[derive(Default)]
pub(crate) struct Sequence {
    /// The root of the tree, or 0 if that has changed.
    top: NodeId,
    /// The first is for no element.
    pub(crate) rows: Vec<Row>,
    /// For each bit of `Row::filters`, a bit for each row.
    planes: Vec<u64>,
    /// The row by the node, if that row agrees.
    places: Vec<u32>,
    /// The nodes that searches have walked through since.
    pub(crate) walked: Cell<usize>,
    frames_without_use: Cell<u8>,
}

fn first_class(element: &Element) -> Name {
    element
        .classes
        .as_ref()
        .and_then(|it| it.first().copied())
        .unwrap_or(Name::NONE)
}

impl Sequence {
    fn place(&self, id: NodeId) -> Option<usize> {
        self.places
            .get(id as usize)
            .map(|it| *it as usize)
            .filter(|it| self.rows.get(*it).is_some_and(|it| it.id == id))
    }

    fn words(&self) -> usize {
        self.rows.len().div_ceil(64)
    }

    fn flip(&mut self, place: usize, bits: [u64; 2]) {
        let words = self.words();
        for (first, mut bits) in [0, 64].into_iter().zip(bits) {
            while bits != 0 {
                self.planes[(first + bits.trailing_zeros() as usize) * words + place / 64] ^=
                    1 << (place % 64);
                bits &= bits - 1;
            }
        }
    }

    pub(crate) fn fill(&mut self, tree: &Tree, top: NodeId) {
        self.rows.clear();
        self.rows.push(Row::default());
        self.places.resize(tree.capacity(), 0);
        for id in core::iter::once(top).chain(tree.descendants(top)) {
            let Some(element) = tree.element(id) else {
                continue;
            };
            let parent = if tree[id].parent == top && tree.element(top).is_none() || id == top {
                0
            } else {
                self.places[tree[id].parent as usize]
            };
            self.places[id as usize] = self.rows.len() as u32;
            self.rows.push(Row {
                filters: [tree[id].keys, second_filter_of(element)],
                tag: element.tag,
                first_class: first_class(element),
                classes: element.classes.clone(),
                id,
                parent,
            });
        }
        self.planes.clear();
        self.planes.resize(usize::from(ANY) * self.words(), 0);
        self.planes
            .resize(self.planes.len() + self.words(), u64::MAX);
        (1..self.rows.len()).for_each(|it| self.flip(it, self.rows[it].filters));
        self.top = top;
        self.walked.set(0);
    }

    /// An element is put into the node or taken out of it, or it ceases to exist.
    #[inline]
    pub(crate) fn shape_changed(&mut self, id: NodeId) {
        match self.top {
            0 => self.walked.set(0),
            top if top == id || self.place(id).is_some() => self.forget(),
            _ => {}
        }
    }

    pub(crate) fn forget(&mut self) {
        self.top = 0;
        self.walked.set(0);
    }

    #[inline]
    pub(crate) fn is_current(&self) -> bool {
        self.top != 0
    }

    pub(crate) fn attributes_changed(&mut self, id: NodeId, keys: u64, element: &Element) {
        let Some(place) = self.place(id) else { return };
        let (row, new) = (&mut self.rows[place], [keys, second_filter_of(element)]);
        row.classes.clone_from(&element.classes);
        row.first_class = first_class(element);
        let old = core::mem::replace(&mut row.filters, new);
        self.flip(place, [old[0] ^ new[0], old[1] ^ new[1]]);
    }

    pub(crate) fn frame_ended(&mut self) {
        if self.rows.capacity() != 0
            && self
                .frames_without_use
                .replace(self.frames_without_use.get() + 1)
                >= if self.is_current() { 60 } else { 1 }
        {
            *self = Sequence::default();
        }
    }

    /// The rows of the descendants.
    #[inline]
    pub(crate) fn below(&self, tree: &Tree, root: NodeId) -> Option<Range<usize>> {
        self.is_current().then_some(())?;
        let start = if root == self.top && tree.element(root).is_none() {
            0
        } else {
            self.place(root)?
        };
        let after = |id: NodeId| {
            core::iter::successors(Some(tree[id].next), |it| Some(tree[*it].next))
                .take_while(|it| *it != 0)
                .find_map(|it| self.place(it))
        };
        let path = core::iter::successors(Some(root), |it| Some(tree[*it].parent))
            .take_while(|it| *it != self.top);
        self.frames_without_use.set(0);
        Some(start + 1..path.filter_map(after).next().unwrap_or(self.rows.len()))
    }

    /// Those that may have what one of `wanted` asks for, up to `N` at a time, until `visit` returns false.
    #[inline(always)]
    pub(crate) fn visit<const N: usize>(
        &self,
        rows: Range<usize>,
        wanted: &[Wanted],
        mut visit: impl FnMut(&mut [u32]) -> bool,
    ) {
        let (mut batch, mut count) = ([0; N], 0);
        let (words, range) = (self.words(), rows.start / 64..rows.end.div_ceil(64));
        let planes =
            |it: &Wanted| it.map(|it| &self.planes[usize::from(it) * words..][..range.end]);
        let (first, mut from) = (wanted.first().map(planes), u64::MAX << (rows.start % 64));
        let Some((first, others)) = first.zip(wanted.get(1..)) else {
            return;
        };
        for word in range.clone() {
            let having = |[a, b, c, d]: [&[u64]; 4]| a[word] & b[word] & c[word] & d[word];
            let mut bits = others
                .iter()
                .fold(having(first), |all, it| all | having(planes(it)))
                & core::mem::replace(&mut from, u64::MAX);
            if word * 64 + 64 > rows.end {
                bits &= !(u64::MAX << (rows.end % 64));
            }
            while bits != 0 {
                batch[count] = word as u32 * 64 + bits.trailing_zeros();
                count += 1;
                bits &= bits - 1;
            }
            if count > N - 64 && !visit(&mut batch[..core::mem::take(&mut count)]) {
                return;
            }
        }
        visit(&mut batch[..count]);
    }
}
