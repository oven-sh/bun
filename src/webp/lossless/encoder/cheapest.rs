//! The copies that make for the fewest bits, going by what each symbol costs in a first attempt.

use core::ops::Range;

use super::cache;
use super::copies::{self, Coding, PixelCopy, Pixels};
use super::entropy::{Cost, ONE_BIT, div_round, log2};
use super::histogram::{
    Alphabet, BySymbol, CACHE, DISTANCE, GREEN, Histogram, LENGTH, literal_symbols,
};
use super::matches::{MAX_LEN, Match};
use super::prefix::{Prefixed, distance_code};
use crate::array::At;
use crate::error::Result;
use crate::lossless::LENGTH_CODES;
use crate::slice::{InBounds, known};
use crate::vec;

struct SymbolCosts<'a>(&'a BySymbol<u32>);

impl<'a> SymbolCosts<'a> {
    /// In the place of the counts.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_cost_enc.c#L43
    fn new(first_attempt: &Coding, histogram: &'a mut Histogram, width: usize) -> Self {
        histogram.get_mut(DISTANCE..GREEN).fill(0);
        for copy in &first_attempt.copies {
            let code = distance_code(copy.distance(), width);
            histogram.add(DISTANCE + Prefixed::new(code).symbol);
        }
        for alphabet in Alphabet::all(first_attempt.cache_bits) {
            let counts = histogram.get_mut(alphabet.symbols());
            if counts.iter().filter(|&&count| count != 0).count() <= 1 {
                counts.fill(0);
                continue;
            }
            let all = log2(counts.iter().sum());
            for count in counts {
                *count = all.saturating_sub(log2(*count));
            }
        }
        Self(&histogram.counts)
    }

    #[inline(always)]
    fn of(&self, symbol: usize) -> Cost {
        (*self.0.at(symbol)).into()
    }

    #[inline(always)]
    fn of_prefixed(&self, alphabet: usize, number: u32) -> Cost {
        let prefixed = Prefixed::new(number);
        self.of(alphabet + prefixed.symbol) + Cost::from(prefixed.extra_len) * ONE_BIT
    }
}

/// Positions that the copy to `origin` can end with, at the same cost.
#[derive(Clone, Copy)]
struct Interval {
    cost: Cost,
    origin: u32,
    start: u32,
    end: u32,
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_cost_enc.c#L145
const MAX_INTERVALS: usize = 500;
const MIN_LEN_FOR_INTERVALS: usize = 10;

/// The cheapest way found so far to code everything up to and including each pixel.
struct Paths {
    /// A ring, for as far ahead as a copy from the end of a copy gets.
    costs: Vec<Cost>,
    /// Of the last step.
    lens: Vec<u16>,
}

impl Paths {
    #[inline(always)]
    fn in_ring(&self, at: usize) -> usize {
        at & self.costs.len().wrapping_sub(1)
    }

    #[inline(always)]
    fn offer(&mut self, at: usize, origin: usize, cost: Cost) {
        let in_ring = self.in_ring(at);
        if let Some(best) = known(self.costs.get_mut(in_ring))
            && cost < *best
        {
            *best = cost;
            self.lens.set(at, (at - origin + 1) as u16);
        }
    }

    #[cold]
    fn offer_all(&mut self, range: Range<u32>, origin: u32, cost: Cost) {
        for at in range {
            self.offer(at as usize, origin as usize, cost);
        }
    }
}

struct Search {
    paths: Paths,
    /// What the length of a copy to position 0 costs, by where it ends.
    short_len_costs: [Cost; MIN_LEN_FOR_INTERVALS - 1],
    len_costs: Vec<Interval>,
    /// Offers that `paths` has yet to get, which do not overlap. The earliest is last.
    pending: Vec<Interval>,
    /// Those that have been taken off `pending` and will be put back. The earliest is first.
    passed: Vec<Interval>,
}

impl Search {
    fn new(costs: &SymbolCosts, pixels: usize) -> Result<Self> {
        // One less than the length is what gets priced.
        // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_cost_enc.c#L267
        let len_cost = |last: usize| costs.of_prefixed(LENGTH, last as u32);
        let mut len_costs: Vec<Interval> = vec::with_room(LENGTH_CODES)?;
        let mut start = 0;
        while start < MAX_LEN as u32 {
            let cost = len_cost(start as usize);
            let end = start.max(1) + (1 << Prefixed::new(start).extra_len);
            match len_costs.last_mut() {
                Some(last) if last.cost == cost => last.end = end,
                _ => len_costs.push(Interval {
                    cost,
                    origin: 0,
                    start,
                    end,
                }),
            }
            start = end;
        }
        let ring_len = pixels.next_power_of_two().min(2 * (MAX_LEN + 1));
        Ok(Self {
            paths: Paths {
                costs: vec::filled(Cost::MAX, ring_len)?,
                lens: vec::filled(0, pixels)?,
            },
            short_len_costs: core::array::from_fn(len_cost),
            len_costs,
            pending: vec::with_room(MAX_INTERVALS)?,
            passed: vec::with_room(MAX_INTERVALS)?,
        })
    }

    /// Returns `interval` if it is to be kept for later. There is a limit, beyond which the offer is made right away.
    fn admitted(&mut self, interval: Interval) -> Option<Interval> {
        if self.pending.len() + self.passed.len() < MAX_INTERVALS {
            return (interval.start < interval.end).then_some(interval);
        }
        let range = interval.start..interval.end;
        self.paths.offer_all(range, interval.origin, interval.cost);
        None
    }

    fn insert(&mut self, interval: Interval) {
        let admitted = self.admitted(interval);
        self.passed.extend(admitted);
    }

    fn pass(&mut self) {
        self.passed.extend(self.pending.pop());
    }

    /// A copy to `origin` of up to `len` pixels, which costs `cost` and its length.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_cost_enc.c#L465
    fn offer_copy(&mut self, origin: usize, len: usize, cost: Cost) {
        if len < MIN_LEN_FOR_INTERVALS {
            for (at, len_cost) in (origin..origin + len).zip(self.short_len_costs) {
                self.paths.offer(at, origin, cost + len_cost);
            }
            return;
        }
        let (origin, len) = (origin as u32, len as u32);
        let mut index = 0;
        while let Some(&lens) = self.len_costs.get(index)
            && lens.start < len
        {
            index += 1;
            let mut new = Interval {
                cost: cost + lens.cost,
                origin,
                start: origin + lens.start,
                end: origin + lens.end.min(len),
            };
            while let Some(old) = self.pending.last_mut()
                && old.start < new.end
            {
                if old.end <= new.start {
                    self.pass();
                } else if old.cost <= new.cost {
                    let old = *old;
                    self.insert(Interval {
                        end: old.start,
                        ..new
                    });
                    new.start = old.end;
                    if new.start >= new.end {
                        break;
                    }
                } else if old.start >= new.start {
                    if old.end > new.end {
                        old.start = new.end;
                        break;
                    }
                    self.pending.pop();
                } else {
                    let behind = Interval {
                        start: new.end,
                        ..*old
                    };
                    old.end = new.start;
                    self.pass();
                    if behind.start < behind.end {
                        let admitted = self.admitted(behind);
                        self.pending.extend(admitted);
                        break;
                    }
                }
            }
            self.insert(new);
        }
        self.pending.extend(self.passed.drain(..).rev());
    }

    /// With the offer that is pending for `at`.
    fn cost_ahead(&mut self, at: usize) -> Cost {
        let mut pending = self.pending.iter().rev();
        if let Some(interval) = pending.find(|interval| interval.end as usize > at)
            && interval.start as usize <= at
        {
            let origin = interval.origin as usize;
            self.paths.offer(at, origin, interval.cost);
        }
        self.paths.costs.value(self.paths.in_ring(at))
    }

    /// Leaves the positions from `at` on at which nothing beats the copy that has led to the one before at `cost`, given
    /// that any pixel adds to that, and for which `has_no_offer` says so. Returns how many there are.
    #[inline(always)]
    fn leave_along_copy(
        &mut self,
        at: usize,
        cost: Cost,
        has_no_offer: impl Iterator<Item = bool>,
    ) -> usize {
        let goes_on = |it: &&Interval| it.cost == cost && it.start as usize <= at;
        let Some(&interval) = self.pending.last().filter(goes_on) else {
            return 0;
        };
        let in_ring = self.paths.in_ring(at);
        let costs = self.paths.costs.part_mut(in_ring..).iter_mut();
        let paths = costs.zip(self.paths.lens.part_mut(at..));
        let along = (at as u32..interval.end).zip(paths).zip(has_no_offer);
        let along = along.take_while(|&((_, (&mut best, _)), no_offer)| no_offer && best > cost);
        let left = along.map(|((at, (best, len)), _)| {
            *best = Cost::MAX;
            *len = (at - interval.origin + 1) as u16;
        });
        left.count()
    }

    /// Returns the cost of the path to `at`, for which there will be no more offers.
    #[inline(always)]
    fn leave(&mut self, at: usize) -> Cost {
        while let Some(&interval) = self.pending.last()
            && interval.start as usize <= at
        {
            if interval.end as usize > at {
                let origin = interval.origin as usize;
                self.paths.offer(at, origin, interval.cost);
                break;
            }
            self.pending.pop();
        }
        let in_ring = self.paths.in_ring(at);
        let take = |cost: &mut Cost| core::mem::replace(cost, Cost::MAX);
        self.paths.costs.update(in_ring, take)
    }
}

/// `histogram` is that of `first_attempt`, and used up.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_cost_enc.c#L569
pub(super) fn copies(
    pixels: Pixels,
    matches: &[Match],
    first_attempt: &Coding,
    histogram: &mut Histogram,
) -> Result<Vec<PixelCopy>> {
    let cache_bits = first_attempt.cache_bits;
    let costs = SymbolCosts::new(first_attempt, histogram, pixels.width);
    let mut search = Search::new(&costs, matches.len())?;
    let mut cost_before = 0;
    let mut previous = Match::NONE;
    let mut distance_cost = 0;
    // Where the last copy that was offered ends.
    let mut reach = 0;
    let [first_symbols, ..] = Alphabet::all(cache_bits);
    let nothing_is_free = first_symbols.symbols().all(|symbol| costs.of(symbol) > 0);
    let mut at = 0;
    while let (Some(&argb), Some(&needed), Some(&found)) = (
        pixels.argb.get(at),
        pixels.cache_bits_needed.get(at),
        matches.get(at),
    ) {
        // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_cost_enc.c#L130
        let alone = if u32::from(needed) <= cache_bits {
            div_round(costs.of(CACHE + cache::key(argb, cache_bits)) * 68, 100)
        } else {
            let [green, red, blue, alpha] = literal_symbols(argb).map(|symbol| costs.of(symbol));
            div_round((green + red + blue + alpha) * 82, 100)
        };
        search.paths.offer(at, at, cost_before + alone);

        if found.len() >= 2 {
            if found.distance() != previous.distance() {
                let code = distance_code(found.distance(), pixels.width);
                distance_cost = costs.of_prefixed(DISTANCE, code);
                search.offer_copy(at, found.len(), cost_before + distance_cost);
                reach = at + found.len();
            } else if at + found.len() > reach {
                // The match goes on for longer than a copy can be. The next copy starts as late as it can.
                let ahead = matches.part(at + 1..=reach).iter();
                let same = ahead.take_while(|next| next.distance() == found.distance());
                let origin = at + same.count();
                let len = matches.value(origin).len();
                let cost_before = if origin > at {
                    search.cost_ahead(origin - 1)
                } else {
                    cost_before
                };
                search.cost_ahead(origin);
                search.offer_copy(origin, len, cost_before + distance_cost);
                reach = origin + len;
            }
        }
        cost_before = search.leave(at);
        previous = found;
        at += 1;

        if found.len() > MIN_LEN_FOR_INTERVALS && nothing_is_free {
            let has_no_offer = (at..matches.len())
                .zip(matches.part(at..))
                .map(|(at, next)| next.distance() == found.distance() && at + next.len() <= reach);
            at += search.leave_along_copy(at, cost_before, has_no_offer);
        }
    }

    let mut copies = Vec::new();
    let mut lens = search.paths.lens.as_slice();
    while let Some(&len) = lens.last() {
        let start = lens.len().saturating_sub(len.max(1).into());
        if len > 1 {
            let distance = matches.value(start).distance();
            copies::push(&mut copies, PixelCopy::new(start, distance, len.into()))?;
        }
        lens = lens.part(..start);
    }
    copies.reverse();
    Ok(copies)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_position_gets_the_cheapest_of_many_offers() -> Result<()> {
        let costs = SymbolCosts(&[0; _]);
        let mut expected = [(Cost::MAX, 0); 8000];
        let mut search = Search::new(&costs, expected.len())?;
        let rooms = |search: &Search| [search.pending.capacity(), search.passed.capacity()];
        assert_eq!(rooms(&search), [500; 2]);
        let (mut seed, mut most_pending) = (1, 0);
        for offer in 0..2000 {
            seed = seed * 48271 % 2_147_483_647;
            let (origin, len) = (seed as usize % 7900, 2 + seed as usize / 7900 % 99);
            // No two are the same.
            let cost = (seed >> 24) * ONE_BIT + offer;
            search.offer_copy(origin, len, cost);
            for (best, last) in expected.part_mut(origin..origin + len).iter_mut().zip(0..) {
                *best = (cost + costs.of_prefixed(LENGTH, last), last as u16 + 1).min(*best);
            }
            let mut pairs = search.pending.array_windows();
            assert!(pairs.all(|[later, earlier]| earlier.end <= later.start));
            most_pending = search.pending.len().max(most_pending);
        }
        assert_eq!((most_pending, rooms(&search)), (500, [500; 2]));
        for (at, expected) in expected.into_iter().enumerate() {
            assert_eq!((search.leave(at), search.paths.lens.value(at)), expected);
        }
        Ok(())
    }
}
