//! The places at which a memoizing program remembers that it has been.

use super::{Direction, LookId, Place, Slot, Target};

/// An index into a list whose elements name the next one out.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Link(pub(crate) u32);

impl Link {
    pub(crate) const END: Link = Link(u32::MAX);
}

/// How far a loop has got.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Progress {
    Turns(Slot),
    /// From where it has started, in turns of that many units.
    Distance(Place, u32),
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Counter {
    pub(crate) progress: Progress,
    /// From that many turns on the number has no effect, unless `max` is within reach.
    pub(crate) enough: u32,
    pub(crate) max: u32,
    pub(crate) outer: Link,
}

/// Where a turn that must not be empty has started.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TurnStart {
    pub(crate) place: Place,
    pub(crate) outer: Link,
}

/// What a back reference can read.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Readable {
    /// The start or the end of a capture whose group has not ended.
    Entry(u32),
    Pair(u16),
}

/// The captures that what follows a site can depend on.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Reads {
    Nothing,
    These { first: u32, end: u32 },
    TooMany,
}

/// What the rest of the pattern, or of the innermost lookaround, depends on besides the position.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Site {
    pub(crate) counters: Link,
    pub(crate) turns: Link,
    pub(crate) reads: Reads,
    /// The number of lookarounds that it is inside of.
    pub(crate) depth: u32,
    pub(crate) direction: Direction,
    pub(crate) look: Option<LookId>,
}

/// A lookaround of which all that counts is whether it succeeds.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Look {
    /// Of the stack where it starts.
    pub(crate) mark: Slot,
    /// Nothing if it never gets there.
    pub(crate) found: Option<Target>,
}

pub(crate) struct Sites {
    pub(crate) sites: Vec<Site>,
    pub(crate) counters: Vec<Counter>,
    pub(crate) turns: Vec<TurnStart>,
    pub(crate) readable: Vec<Readable>,
    pub(crate) looks: Vec<Look>,
}

impl Sites {
    pub(crate) const fn new() -> Sites {
        Sites {
            sites: Vec::new(),
            counters: Vec::new(),
            turns: Vec::new(),
            readable: Vec::new(),
            looks: Vec::new(),
        }
    }

    pub(crate) fn counters(&self, site: &Site) -> impl Iterator<Item = &Counter> {
        let at = |link: Link| self.counters.get(link.0 as usize);
        core::iter::successors(at(site.counters), move |it| at(it.outer))
    }

    pub(crate) fn look(&self, site: &Site) -> Option<(Slot, Target)> {
        let look = self.looks[site.look?.index()];
        Some((look.mark, look.found?))
    }

    pub(crate) fn turns(&self, site: &Site) -> impl Iterator<Item = &TurnStart> {
        let at = |link: Link| self.turns.get(link.0 as usize);
        core::iter::successors(at(site.turns), move |it| at(it.outer))
    }
}
