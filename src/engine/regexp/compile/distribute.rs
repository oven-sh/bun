//! Moves what follows alternatives into each of them.

use smallvec::SmallVec;

use super::graph::{Id, Kind, Node, Traits};
use super::lower::Lowering;
use crate::Error;
use crate::program::Direction;

const MAX_TERMS: usize = 4;
const MAX_DEPTH: u32 = 8;
const MAX_STEPS_COPIED: usize = 48;
const MAX_PARENTHESES_COPIED: usize = 256;

impl Lowering<'_> {
    /// By one with `appended` at its end, whose captures are not those of the alternative.
    pub(super) fn replace_alternative(
        &mut self,
        index: usize,
        mut new: Id,
        appended: &[Id],
    ) -> Result<(), Error> {
        let old = self.graph[self.graph.children[index]];
        if appended.contains(&new) {
            new = self.graph.duplicate(new)?;
        }
        self.graph[new].pairs = old.pairs;
        self.graph[new].traits |= old.traits & Traits::DIFFERS_FROM_NEXT;
        self.graph.children[index] = new;
        Ok(())
    }

    /// Puts `ending` after the terms from `start` on, and into the last alternatives so that they need not meet again.
    /// Each of them may have to write the captures for the parentheses before it.
    pub(super) fn finish_with_ending(
        &mut self,
        start: usize,
        ending: &[Id],
        depth: u32,
        parentheses: usize,
    ) -> Result<Id, Error> {
        let terms = &self.terms[start..];
        let is_short = |it: &Node| it.is_bookkeeping() || it.kind == Kind::Edge(Direction::Forward);
        let kept = terms.iter().rposition(|&it| !is_short(&self.graph[it]));
        let (before, closing) = terms.split_at(kept.map_or(0, |last| last + 1));
        let passed = before.iter().filter(|&&it| self.graph[it].is_bookkeeping());
        let parentheses = parentheses + passed.count();
        if let Some(&last) = before.last()
            && let Kind::Alternation(children) = self.graph[last].kind
            && closing.len() + ending.len() <= MAX_TERMS
            && parentheses * children.len() <= MAX_PARENTHESES_COPIED
            && depth < MAX_DEPTH
        {
            let longer: SmallVec<[Id; MAX_TERMS]> = closing.iter().chain(ending).copied().collect();
            self.terms.truncate(start + before.len());
            for index in children.range() {
                let inner = self.terms.len();
                self.push_term(inner, self.graph.children[index])?;
                let ended = self.finish_with_ending(inner, &longer, depth + 1, parentheses)?;
                self.replace_alternative(index, ended, &longer)?;
            }
            self.graph.refresh(last);
        } else {
            for &term in ending {
                self.push_term(start, term)?;
            }
        }
        self.finish_sequence(start)
    }

    /// The number of terms after the first that are better tested before its alternatives meet.
    fn tests_to_move(&self, before: &[Id], terms: &[Id]) -> usize {
        let [first, following @ ..] = terms else {
            return 0;
        };
        let node = &self.graph[*first];
        let Kind::Alternation(children) = node.kind else {
            return 0;
        };
        let steps = following
            .iter()
            .take(MAX_TERMS)
            .position(|&it| !self.graph[it].is_bookkeeping());
        let Some((index, Kind::Steps(steps))) =
            steps.map(|it| (it, self.graph[following[it]].kind))
        else {
            return 0;
        };
        // One parenthesis of each group stays, to say that the sequence has the group.
        let is_opened_before = |pair| {
            let mut before = before.iter().rev().take(MAX_TERMS);
            before.any(|&it| self.graph[it].kind == Kind::Open(pair))
        };
        let mut kinds = following[..index].iter().map(|&it| self.graph[it].kind);
        if kinds.any(|it| matches!(it, Kind::Close(pair) if !is_opened_before(pair))) {
            return 0;
        }
        let mut alternatives = self.graph.children_of(children).iter();
        let is_worthwhile = !node.is(Traits::RIGID)
            && children.len() * (steps.len() + 4) <= MAX_STEPS_COPIED
            && alternatives.all(|&it| self.graph[it].is(Traits::RIGID));
        if is_worthwhile { index + 1 } else { 0 }
    }

    /// Among the terms of a sequence, which start at `start`.
    pub(super) fn move_tests_into_alternatives(&mut self, start: usize) -> Result<(), Error> {
        let (mut read, mut kept, end) = (start, start, self.terms.len());
        while read < end {
            let term = self.terms[read];
            let count = self.tests_to_move(&self.terms[start..kept], &self.terms[read..end]);
            if let (Kind::Alternation(children), 1..) = (self.graph[term].kind, count) {
                let moved: SmallVec<[Id; MAX_TERMS]> = self.terms[read + 1..][..count].into();
                for index in children.range() {
                    let longer = self.join_after(self.graph.children[index], &moved)?;
                    self.replace_alternative(index, longer, &[])?;
                }
                self.graph.refresh(term);
            }
            self.terms[kept] = term;
            kept += 1;
            read += count + 1;
        }
        self.terms.truncate(kept);
        Ok(())
    }

    fn join_after(&mut self, first: Id, others: &[Id]) -> Result<Id, Error> {
        let start = self.terms.len();
        self.push_term(start, first)?;
        for &term in others {
            // Steps can grow.
            let own = self.graph.duplicate(term)?;
            self.push_term(start, own)?;
        }
        self.finish_sequence(start)
    }
}
