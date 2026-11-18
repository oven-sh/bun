//! Which captures are kept, and which can have been set at the place that is being lowered.

use core::ops::Range;

use smallvec::SmallVec;

use super::Mode;
use super::graph::{Graph, Id};
use super::memory::{fill, push};
use crate::Error;
use crate::program::{Direction, Pairs};
use crate::tree::{Group, Node, Span, Tree};

#[derive(Clone, Copy, Default)]
struct OfGroup {
    pair: Option<u16>,
    is_referenced: bool,
}

#[derive(Clone, Copy)]
struct OfPair {
    is_closed: bool,
    index_in_closed: u32,
    /// A reference as it is where the capture is sure to be set.
    reference: Id,
    direction: Direction,
}

pub(super) struct Groups {
    /// From group one.
    groups: Vec<OfGroup>,
    pairs: Vec<OfPair>,
    closed: Vec<u16>,
    /// The parts of `closed` that a match can go around, ascending.
    optional: Vec<Range<u32>>,
    /// Those of the alternatives before the ones that enclose the place, ascending.
    hidden: Vec<Pairs>,
    /// Of what is visible.
    changes: usize,
}

const OPEN: OfPair = OfPair {
    is_closed: false,
    index_in_closed: 0,
    reference: Graph::EMPTY,
    direction: Direction::Forward,
};

fn mark_referenced(tree: &Tree, groups: &mut [OfGroup]) -> Result<(), Error> {
    let mut lists = SmallVec::<[Range<usize>; 8]>::new();
    for (_, node) in tree.nodes() {
        if let Node::BackReference { groups: read, .. } = node {
            lists.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
            lists.push(read.range());
        }
    }
    // Those for a name overlap.
    lists.sort_unstable_by_key(|it| it.start);
    let mut done = 0;
    for list in lists.into_iter().filter(|it| !it.is_empty()) {
        let start = list.start.max(done);
        done = list.end.max(done);
        for &group in &tree[Span::<Group>::new(start..done)] {
            groups[usize::from(group) - 1].is_referenced = true;
        }
    }
    Ok(())
}

impl Groups {
    pub(super) const fn new() -> Groups {
        Groups {
            groups: Vec::new(),
            pairs: Vec::new(),
            closed: Vec::new(),
            optional: Vec::new(),
            hidden: Vec::new(),
            changes: 0,
        }
    }

    pub(super) fn start(&mut self, tree: &Tree, mode: Mode) -> Result<(), Error> {
        let groups = &mut self.groups;
        fill(groups, tree.group_count().into(), OfGroup::default())?;
        if !groups.is_empty() {
            mark_referenced(tree, groups)?;
        }
        let mut pair_count = 0;
        for group in groups {
            if mode == Mode::Captures || group.is_referenced {
                group.pair = Some(pair_count);
                pair_count += 1;
            }
        }
        self.closed.clear();
        self.optional.clear();
        self.hidden.clear();
        fill(&mut self.pairs, pair_count.into(), OPEN)
    }

    pub(super) fn pair_count(&self) -> u16 {
        self.pairs.len() as u16
    }

    pub(super) fn pair(&self, group: Group) -> Option<u16> {
        self.groups[usize::from(group) - 1].pair
    }

    pub(super) fn is_referenced(&self, group: Group) -> bool {
        self.groups[usize::from(group) - 1].is_referenced
    }

    /// Ascending.
    pub(super) fn referenced_pairs(&self) -> Result<Vec<u16>, Error> {
        let mut pairs = Vec::new();
        let referenced = self.groups.iter().filter(|it| it.is_referenced);
        for pair in referenced.filter_map(|it| it.pair) {
            push(&mut pairs, pair)?;
        }
        Ok(pairs)
    }

    pub(super) fn close(
        &mut self,
        pair: u16,
        reference: Id,
        direction: Direction,
    ) -> Result<(), Error> {
        self.pairs[usize::from(pair)] = OfPair {
            is_closed: true,
            index_in_closed: self.closed.len() as u32,
            reference,
            direction,
        };
        self.changes += 1;
        push(&mut self.closed, pair)
    }

    pub(super) fn closed_so_far(&self) -> usize {
        self.closed.len()
    }

    /// Those closed since then are not set after all.
    pub(super) fn forget(&mut self, closed_so_far: usize) {
        self.changes += 1;
        for pair in self.closed.drain(closed_so_far..) {
            self.pairs[usize::from(pair)].is_closed = false;
        }
        self.drop_optional_since(closed_so_far);
    }

    fn drop_optional_since(&mut self, closed_so_far: usize) {
        let kept = self
            .optional
            .partition_point(|it| (it.start as usize) < closed_so_far);
        self.optional.truncate(kept);
    }

    /// Those closed since then need not be set.
    pub(super) fn make_optional(&mut self, closed_so_far: usize) -> Result<(), Error> {
        if closed_so_far == self.closed.len() {
            return Ok(());
        }
        self.drop_optional_since(closed_so_far);
        push(
            &mut self.optional,
            closed_so_far as u32..self.closed.len() as u32,
        )
    }

    /// A model of a reference and the direction for which it is, if the capture is sure to be set.
    pub(super) fn certain_reference(&self, pair: u16) -> Option<(Id, Direction)> {
        let pair = self.pairs[usize::from(pair)];
        let index = pair.index_in_closed;
        let after = self.optional.partition_point(|it| it.end <= index);
        let is_optional = self.optional.get(after).is_some_and(|it| it.start <= index);
        (!is_optional).then_some((pair.reference, pair.direction))
    }

    pub(super) fn hide(&mut self, pairs: Pairs) -> Result<(), Error> {
        self.changes += usize::from(!pairs.is_empty());
        let after_last = self.hidden.last().map_or(0, |last| last.end);
        let kept_in_order = Pairs {
            first: after_last,
            end: after_last,
        };
        push(
            &mut self.hidden,
            if pairs.is_empty() {
                kept_in_order
            } else {
                pairs
            },
        )
    }

    pub(super) fn reveal(&mut self) {
        self.changes += usize::from(self.hidden.pop().is_some_and(|it| !it.is_empty()));
    }

    pub(super) fn changes(&self) -> usize {
        self.changes
    }

    pub(super) fn visible_pair(&self, group: Group) -> Option<u16> {
        let pair = self.pair(group)?;
        let after = self.hidden.partition_point(|hidden| hidden.end <= pair);
        let is_hidden = self.hidden.get(after).is_some_and(|it| it.first <= pair);
        (self.pairs[usize::from(pair)].is_closed && !is_hidden).then_some(pair)
    }

    pub(super) fn never_set(&self) -> impl Iterator<Item = Pairs> {
        let mut first = 0;
        let runs = self.pairs.chunk_by(|a, b| a.is_closed == b.is_closed);
        runs.filter_map(move |run| {
            let pairs = Pairs {
                first,
                end: first + run.len() as u16,
            };
            first = pairs.end;
            (!run[0].is_closed).then_some(pairs)
        })
    }
}
