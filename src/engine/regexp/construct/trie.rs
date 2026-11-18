//! A class with strings matches the longest of them first. All that match at one position are prefixes of one another,
//! so a trie that goes deeper before it accepts tries them in that order.

use super::strings::Strings;
use super::{Builder, NO_CAPTURES, Outer};
use crate::Error;
use crate::parser::{GroupKind, Sink};
use crate::set::{Set, SetBuilder};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Edge {
    target: u32,
    c: u32,
}

#[derive(Clone, Copy)]
struct State {
    edges_start: u32,
    edges_end: u32,
    accepts: bool,
}

/// States from which the same strings go on are one, so that edges to them can be one set of characters.
#[derive(Default)]
struct Trie {
    states: Vec<State>,
    edges: Vec<Edge>,
    /// By hash: the last state that had it, plus one.
    slots: Vec<u32>,
}

struct OpenState {
    c: u32,
    accepts: bool,
    edges_start: usize,
}

fn push<T>(items: &mut Vec<T>, item: T) -> Result<(), Error> {
    items.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
    items.push(item);
    Ok(())
}

const SLOTS: usize = 1 << 10;

impl Trie {
    /// The root is the last state. A character that starts a string accepts if it is among `characters`.
    fn new<'a>(strings: impl Iterator<Item = &'a [u32]>, characters: &Set) -> Result<Trie, Error> {
        let mut trie = Trie::default();
        trie.slots.resize(SLOTS, 0);
        let (mut path, mut edges) = (Vec::new(), Vec::new());
        let mut accepts_nothing = false;
        for string in strings {
            let common = path.iter().zip(string);
            let common = common.take_while(|&(open, &c): &(&OpenState, _)| open.c == c);
            let common = common.count();
            trie.close_down_to(common, &mut path, &mut edges)?;
            for (depth, &c) in string.iter().enumerate().skip(common) {
                let open = OpenState {
                    c,
                    accepts: depth + 1 == string.len() || (depth == 0 && characters.contains(c)),
                    edges_start: edges.len(),
                };
                push(&mut path, open)?;
            }
            accepts_nothing |= string.is_empty();
        }
        trie.close_down_to(0, &mut path, &mut edges)?;
        edges.sort_unstable();
        trie.add(accepts_nothing, &edges)?;
        Ok(trie)
    }

    fn close_down_to(
        &mut self,
        depth: usize,
        path: &mut Vec<OpenState>,
        edges: &mut Vec<Edge>,
    ) -> Result<(), Error> {
        for open in path.drain(depth..).rev() {
            let target = self.find_or_add(open.accepts, &mut edges[open.edges_start..])?;
            edges.truncate(open.edges_start);
            push(edges, Edge { target, c: open.c })?;
        }
        Ok(())
    }

    fn find_or_add(&mut self, accepts: bool, edges: &mut [Edge]) -> Result<u32, Error> {
        edges.sort_unstable();
        let hash = edges.iter().fold(u64::from(accepts), |hash, edge| {
            let word = u64::from(edge.target) << 32 | u64::from(edge.c);
            (hash.rotate_left(23) ^ word).wrapping_mul(0x9e37_79b9_7f4a_7c15)
        });
        let slot = (hash ^ hash >> 32 ^ hash >> 48) as usize % SLOTS;
        if let Some(known) = self.slots[slot].checked_sub(1)
            && self.states[known as usize].accepts == accepts
            && self.edges_of(known) == edges
        {
            return Ok(known);
        }
        let state = self.add(accepts, edges)?;
        self.slots[slot] = state + 1;
        Ok(state)
    }

    fn add(&mut self, accepts: bool, edges: &[Edge]) -> Result<u32, Error> {
        let edges_start = self.edges.len() as u32;
        self.edges
            .try_reserve(edges.len())
            .map_err(|_| Error::OutOfMemory)?;
        self.edges.extend_from_slice(edges);
        let state = State {
            edges_start,
            edges_end: self.edges.len() as u32,
            accepts,
        };
        push(&mut self.states, state)?;
        Ok(self.states.len() as u32 - 1)
    }

    /// Those with the same target are neighbours.
    fn edges_of(&self, state: u32) -> &[Edge] {
        let state = self.states[state as usize];
        &self.edges[state.edges_start as usize..state.edges_end as usize]
    }
}

enum Step<'a> {
    Enter(u32),
    Label(&'a [Edge]),
    Branches(&'a [Edge]),
    NextAlternative,
    Close(Outer),
}

impl Builder<'_> {
    /// As the alternatives of the group that is open.
    pub(super) fn add_strings(
        &mut self,
        characters: &Set,
        mut strings: Strings,
    ) -> Result<(), Error> {
        let trie = Trie::new(strings.sorted(self.is_backward), characters)?;
        let root = trie.states.len() as u32 - 1;
        let branches = trie.edges_of(root);
        let mut sets = SetBuilder::default();
        self.add_branches(&trie, branches, &mut sets)?;
        let others = characters.difference(&self.label(branches, &mut sets)?)?;
        let has_others = !others.is_empty();
        if has_others {
            if !branches.is_empty() {
                self.next_alternative()?;
            }
            self.add_class(others)?;
        }
        if trie.states[root as usize].accepts && (has_others || !branches.is_empty()) {
            self.next_alternative()?;
        }
        Ok(())
    }

    fn label(&self, edges: &[Edge], sets: &mut SetBuilder) -> Result<Set, Error> {
        for edge in edges {
            sets.add(edge.c)?;
        }
        Ok(sets.finish(self.ignore_case())?)
    }

    fn add_branches(
        &mut self,
        trie: &Trie,
        branches: &[Edge],
        sets: &mut SetBuilder,
    ) -> Result<(), Error> {
        let mut steps = vec![Step::Branches(branches)];
        while let Some(step) = steps.pop() {
            steps.try_reserve(4).map_err(|_| Error::OutOfMemory)?;
            match step {
                Step::Enter(state) => {
                    let edges = trie.edges_of(state);
                    let (Some(first), Some(last)) = (edges.first(), edges.last()) else {
                        continue;
                    };
                    let accepts = trie.states[state as usize].accepts;
                    if accepts || first.target != last.target {
                        steps.push(Step::Close(self.open(GroupKind::PLAIN)?));
                    }
                    if accepts {
                        steps.push(Step::NextAlternative);
                    }
                    steps.push(Step::Branches(edges));
                }
                Step::Branches(edges) => {
                    let Some(&Edge { target, .. }) = edges.first() else {
                        continue;
                    };
                    let (label, rest) =
                        edges.split_at(edges.partition_point(|edge| edge.target == target));
                    if !rest.is_empty() {
                        steps.extend([Step::Branches(rest), Step::NextAlternative]);
                    }
                    steps.extend(match self.is_backward {
                        true => [Step::Label(label), Step::Enter(target)],
                        false => [Step::Enter(target), Step::Label(label)],
                    });
                }
                Step::Label(&[Edge { c, .. }]) => self.character(c)?,
                Step::Label(edges) => {
                    let set = self.label(edges, sets)?;
                    self.add_class(set)?;
                }
                Step::NextAlternative => self.next_alternative()?,
                Step::Close(outer) => self.close(outer, NO_CAPTURES, None)?,
            }
        }
        Ok(())
    }
}
