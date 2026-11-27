//! `bun_code_coverage` ties each counter to the `loc` of a node, and what makes code of the file says where that ends up.

use bun_core::{Unaligned, strings};

/// Tells apart the nodes that have the same `loc`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    File,
    Statement,
    Expression,
    /// Of `&&`, `||` or `??`.
    FirstOperand,
    /// Of a function, a `catch` or a `finally`.
    Body,
    /// What an `if` or a loop runs, at the `loc` of the `if` or the loop.
    Guarded,
    Case,
    /// A `?.`, at the name, the index or the `)` that follows.
    Chain,
}

/// `JSC::CoverageCounters::Event`
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Event {
    Reached,
    Skipped,
}

const EVENT_SHIFT: u32 = 30;
pub const MAX_COUNTERS: u32 = 1 << EVENT_SHIFT;
const NONE: u32 = u32::MAX;

#[derive(Clone, Copy)]
pub struct Anchor {
    pub loc: u32,
    pub role: Role,
    pub event: Event,
    pub counter: u32,
}

/// Whether the next entry of `Anchors::statements` runs after this one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GoesOn {
    Never,
    Sometimes,
    Always,
}

#[derive(Default)]
pub struct Anchors {
    pub counters: u32,
    /// A transform can drop a node, so a counter can have several. The best comes first.
    pub all: Vec<Anchor>,
    /// The counters of the statements of each block. One that a transform drops is counted with its neighbor.
    pub statements: Vec<(u32, GoesOn)>,
}

pub struct Placement<T> {
    anchors: Anchors,
    /// For every 64 bytes of the file: a bit for each `loc`, and how many bits come before.
    locs: Vec<(u64, u32)>,
    /// For each bit, the first of the anchors there that have no place yet.
    first: Vec<u32>,
    /// Parallel to `anchors.all`.
    next: Vec<u32>,
    marks: Vec<(T, u32)>,
}

pub struct Placed<T> {
    pub counters: u32,
    pub places: Vec<(T, Event, u32)>,
    /// The counters of code that is gone.
    pub unplaced: Vec<u32>,
}

impl<T: Copy> Placement<T> {
    pub fn new(anchors: Anchors) -> Placement<T> {
        let last = anchors.all.iter().map(|it| it.loc).max();
        let mut locs = vec![(0u64, 0u32); last.map_or(0, |it| it as usize / 64 + 1)];
        for it in &anchors.all {
            locs[it.loc as usize / 64].0 |= 1 << (it.loc % 64);
        }
        let mut bits = 0;
        for (word, before) in &mut locs {
            *before = bits;
            bits += word.count_ones();
        }
        let mut placement = Placement {
            locs,
            first: vec![NONE; bits as usize],
            next: Vec::with_capacity(anchors.all.len()),
            marks: Vec::with_capacity(anchors.all.len()),
            anchors,
        };
        for (it, index) in placement.anchors.all.iter().zip(0..) {
            let first = placement.bit_at(it.loc).map(|it| &mut placement.first[it]);
            (placement.next).extend(first.map(|it| core::mem::replace(it, index)));
        }
        placement
    }

    #[inline]
    fn bit_at(&self, loc: u32) -> Option<usize> {
        let (word, before) = *self.locs.get(loc as usize / 64)?;
        let bit = 1 << (loc % 64);
        (word & bit != 0).then(|| (before + (word & (bit - 1)).count_ones()) as usize)
    }

    /// An expression has the `loc` of what it starts with, so the outermost is to be marked first.
    pub fn mark(&mut self, role: Role, loc: u32, place: T) {
        let Some(bit) = self.bit_at(loc) else {
            return;
        };
        let mut index = core::mem::replace(&mut self.first[bit], NONE);
        while let Some(anchor) = self.anchors.all.get(index as usize) {
            let next = self.next[index as usize];
            match anchor.role == role {
                true => self.marks.push((place, index)),
                false => {
                    self.next[index as usize] = core::mem::replace(&mut self.first[bit], index)
                }
            }
            index = next;
        }
    }

    /// The places are in the order of the marks, but for those of dropped statements.
    pub fn finish(&self) -> Placed<T> {
        let Anchors {
            counters,
            all,
            statements,
        } = &self.anchors;
        let mut best = vec![NONE; *counters as usize];
        for &(_, index) in &self.marks {
            let best = &mut best[all[index as usize].counter as usize];
            *best = index.min(*best);
        }
        let mut places = Vec::with_capacity(best.len());
        for &(place, index) in &self.marks {
            let anchor = all[index as usize];
            if best[anchor.counter as usize] == index {
                places.push((place, anchor.event, anchor.counter));
            }
        }
        let mut unplaced = Vec::new();
        if places.len() < best.len() {
            let mut place_of = vec![None; best.len()];
            for &(place, event, counter) in &places {
                place_of[counter as usize] = Some((place, event));
            }
            let mut share = |from: u32, to: u32| {
                if let (Some((place, event)), None) =
                    (place_of[from as usize], place_of[to as usize])
                {
                    place_of[to as usize] = Some((place, event));
                    places.push((place, event, to));
                }
            };
            for &[(it, goes_on), (next, _)] in statements.array_windows().rev() {
                if goes_on != GoesOn::Never {
                    share(next, it);
                }
            }
            for &[(it, goes_on), (next, _)] in statements.array_windows() {
                if goes_on == GoesOn::Always {
                    share(it, next);
                }
            }
            unplaced.extend((0..*counters).filter(|&it| place_of[it as usize].is_none()));
        }
        Placed {
            counters: *counters,
            places,
            unplaced,
        }
    }
}

/// `JSC::CoverageCounters::Place`
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Place {
    pub offset: u32,
    counter_and_event: u32,
}
bun_core::impl_pod!(Place);

impl Place {
    pub fn new(offset: u32, event: Event, counter: u32) -> Place {
        Place {
            offset,
            counter_and_event: (event as u32) << EVENT_SHIFT | counter,
        }
    }
}

/// `Placed`, in a text that JavaScriptCore runs.
#[derive(Default)]
pub struct PlacedInText {
    pub counters: u32,
    /// Sorted by offset.
    pub places: Vec<Place>,
    pub unplaced: Vec<u32>,
}

fn next_token(text: &[u8], offset: u32) -> u32 {
    let mut rest = text.get(offset as usize..).unwrap_or_default();
    loop {
        rest = rest.trim_ascii_start();
        let end: &[u8] = match rest {
            [b'/', b'*', ..] => b"*/",
            [b'/', b'/', ..] | [b'#', b'!', ..] => b"\n",
            _ => return (text.len() - rest.len()) as u32,
        };
        let comment = strings::index_of(&rest[2..], end);
        rest = &rest[comment.map_or(rest.len(), |it| 2 + it + end.len())..];
    }
}

impl Placement<u32> {
    /// A mark can be before the white space and the comments before its token.
    pub fn finish_in(&mut self, text: &[u8]) -> PlacedInText {
        for (offset, _) in &mut self.marks {
            *offset = next_token(text, *offset);
        }
        let placed = self.finish();
        let mut places: Vec<Place> = (placed.places.iter())
            .map(|&(offset, event, counter)| Place::new(offset, event, counter))
            .collect();
        if !places.is_sorted_by_key(|it| it.offset) {
            bun_collections::index_sort::sort_slice_by_key(&mut places, |it| it.offset);
        }
        PlacedInText {
            counters: placed.counters,
            places,
            unplaced: placed.unplaced,
        }
    }
}

/// What the printer fills in.
pub struct Printing {
    pub placement: Placement<u32>,
    pub placed: PlacedInText,
}

impl PlacedInText {
    pub fn encode(&self) -> Vec<u8> {
        let unplaced = bun_core::slice_as_bytes(&self.unplaced);
        let places = bun_core::slice_as_bytes(&self.places);
        [
            &(self.unplaced.len() as u32).to_ne_bytes(),
            unplaced,
            places,
        ]
        .concat()
    }

    /// JavaScriptCore indexes the counts by what this returns.
    pub fn decode(bytes: &[u8]) -> Option<PlacedInText> {
        let (unplaced, rest) = bytes.split_first_chunk()?;
        let unplaced = (u32::from_ne_bytes(*unplaced) as usize).checked_mul(size_of::<u32>())?;
        let (unplaced, places) = rest.split_at_checked(unplaced)?;
        let unplaced: Vec<u32> =
            (Unaligned::slice_of(unplaced).iter().map(|it| it.get())).collect();
        let places: Vec<Place> = (Unaligned::slice_of(places).iter().map(|it| it.get())).collect();
        let counters = u32::try_from(places.len() + unplaced.len()).ok()?;
        let is_valid = places.is_sorted_by_key(|it| it.offset)
            && (places.iter()).all(|it| it.counter_and_event % MAX_COUNTERS < counters)
            && unplaced.is_sorted()
            && unplaced.last().is_none_or(|&it| it < counters);
        is_valid.then_some(PlacedInText {
            counters,
            places,
            unplaced,
        })
    }
}
