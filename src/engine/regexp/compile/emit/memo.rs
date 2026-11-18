//! Where a memoizing program looks whether it has been before.

use super::Emitter;
use super::output::{Label, Section};
use super::repeat::{Count, Repeat};
use crate::Error;
use crate::compile::memory::{push, reserve};
use crate::program::{
    Counter, Link, Op, Pairs, Place, Progress, Readable, Reads, Site, SiteId, TurnStart, UNBOUNDED,
};

/// With more, states hardly ever come back.
const MAX_ENTRIES: usize = 16;
const MAX_COUNTERS: u32 = 16;

/// The loops around the code at hand that have a say in whether it fails.
#[derive(Clone, Copy)]
pub(super) struct Surroundings {
    counters: Link,
    counter_count: u32,
    turns: Link,
}

impl Surroundings {
    pub(super) const NONE: Surroundings = Surroundings {
        counters: Link::END,
        counter_count: 0,
        turns: Link::END,
    };
}

pub(super) struct Memoizing {
    /// Ascending.
    pub(super) referenced_pairs: Vec<u16>,
    /// The starts and ends that have been written and that a reference can read.
    pub(super) entries: Vec<u32>,
    /// No reference can be reached once all have been written, but for those in a loop around.
    pub(super) references_left: usize,
}

impl Emitter<'_> {
    /// For code that runs after `least` turns have been counted.
    pub(super) fn surround_with_count(
        &mut self,
        count: Count,
        repeat: Repeat,
        least: u32,
    ) -> Result<(), Error> {
        let progress = match count {
            _ if self.memoizing.is_none() => return Ok(()),
            Count::NotNeeded | Count::Distance(_, 0) => return Ok(()),
            Count::Distance(start, length) => Progress::Distance(start, length),
            Count::Number(slot) => Progress::Turns(slot),
        };
        let can_be_empty = repeat.min != 0 && self.graph[repeat.body].min == 0;
        let enough = repeat.min.saturating_add(can_be_empty.into());
        if enough <= least && repeat.max == UNBOUNDED {
            return Ok(());
        }
        let (counters, outer) = (
            &mut self.output.program.sites.counters,
            self.surroundings.counters,
        );
        self.surroundings.counters = Link(counters.len() as u32);
        self.surroundings.counter_count += 1;
        let counter = Counter {
            progress,
            enough,
            max: repeat.max,
            outer,
        };
        push(counters, counter)
    }

    pub(super) fn surround_with_turn(&mut self, place: Place) -> Result<(), Error> {
        if self.memoizing.is_some() {
            let (turns, outer) = (
                &mut self.output.program.sites.turns,
                self.surroundings.turns,
            );
            self.surroundings.turns = Link(turns.len() as u32);
            push(turns, TurnStart { place, outer })?;
        }
        Ok(())
    }

    pub(super) fn note_written(&mut self, entry: u32) -> Result<(), Error> {
        let pair = (entry / 2) as u16;
        match &mut self.memoizing {
            Some(memoizing) if memoizing.referenced_pairs.binary_search(&pair).is_ok() => {
                push(&mut memoizing.entries, entry)
            }
            _ => Ok(()),
        }
    }

    pub(super) fn note_reference(&mut self) {
        if let Some(memoizing) = &mut self.memoizing {
            memoizing.references_left = memoizing.references_left.saturating_sub(1);
        }
    }

    pub(super) fn entries_written(&self) -> usize {
        self.memoizing.as_ref().map_or(0, |it| it.entries.len())
    }

    /// Replaces those since then by all of the pairs, or by too many.
    pub(super) fn note_written_since(&mut self, written: usize, pairs: Pairs) -> Result<(), Error> {
        let Some(memoizing) = &mut self.memoizing else {
            return Ok(());
        };
        memoizing.entries.truncate(written);
        let referenced = &memoizing.referenced_pairs;
        let from_first = &referenced[referenced.partition_point(|&it| it < pairs.first)..];
        let inside = from_first.iter().take_while(|&&it| it < pairs.end);
        for &pair in inside.take(MAX_ENTRIES / 2 + 1) {
            push(&mut memoizing.entries, u32::from(pair) * 2)?;
            push(&mut memoizing.entries, u32::from(pair) * 2 + 1)?;
        }
        Ok(())
    }

    /// Nothing if the program does not memoize, or the code at hand runs once.
    pub(super) fn site(&mut self) -> Result<Option<SiteId>, Error> {
        let Some(memoizing) = self.memoizing.as_ref().filter(|_| self.repeats) else {
            return Ok(None);
        };
        if self.surroundings.counter_count > MAX_COUNTERS {
            return Ok(None);
        }
        let sites = &mut self.output.program.sites;
        let reads = match &memoizing.entries[..] {
            _ if memoizing.references_left == 0 && !self.is_in_loop => Reads::Nothing,
            [] => Reads::Nothing,
            entries if entries.len() > MAX_ENTRIES => Reads::TooMany,
            entries => {
                let first = sites.readable.len() as u32;
                reserve(&mut sites.readable, entries.len())?;
                let readable = |&entry: &u32| match entries.contains(&(entry ^ 1)) {
                    false => Some(Readable::Entry(entry)),
                    true => (entry % 2 == 0).then_some(Readable::Pair((entry / 2) as u16)),
                };
                sites.readable.extend(entries.iter().filter_map(readable));
                let end = sites.readable.len() as u32;
                Reads::These { first, end }
            }
        };
        let site = Site {
            counters: self.surroundings.counters,
            turns: self.surroundings.turns,
            reads,
            depth: self.looks,
            direction: self.direction,
            look: self.look,
        };
        push(&mut sites.sites, site)?;
        Ok(Some(SiteId(sites.sites.len() as u32 - 1)))
    }

    /// Nothing is put off.
    pub(super) fn visit(&mut self, site: Option<SiteId>, seen: Label) -> Result<(), Error> {
        match site {
            Some(site) => self.op(Op::Visit { site, seen }),
            None => Ok(()),
        }
    }

    /// For where the code goes on without going back after all has failed that a visit was for.
    pub(super) fn doubt_visit(&mut self, has_visit: bool, section: Section) -> Result<(), Error> {
        match has_visit && self.look.is_some() {
            true => self.output.op(section, Op::DoubtVisit),
            false => Ok(()),
        }
    }

    /// Where a turn of a loop without frames starts. `seen` is for when all that starts with a turn has failed.
    pub(super) fn visit_turn(&mut self, is_worthwhile: bool, seen: Label) -> Result<(), Error> {
        let site = match is_worthwhile {
            true => self.site()?,
            false => None,
        };
        self.visit(site, seen)
    }
}
