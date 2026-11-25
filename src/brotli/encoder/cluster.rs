//! Merges histograms that are alike.

use core::hint::select_unpredictable;

use bun_highway::brotli::tally;
use bun_highway::with_avx2;

use super::log2::fixed_point_log2;
use super::symbol_set::SymbolSet;
use crate::context::LITERAL_CONTEXTS;
use crate::format::{COMMAND_SYMBOLS, LITERAL_SYMBOLS};
use crate::memory::{self, Result};

const LANES: usize = 8;
const NONE: u32 = u32::MAX;
pub(super) const MAX_CLUSTERS: usize = 256;

/// One for each cluster of a group.
type Lanes<T = u32> = [T; LANES];

/// Costs are in sixteenths.
pub(super) const BIT: i32 = 16;
/// More would overflow.
pub(super) const MAX_SYMBOLS: usize = 3 << 18;

/// Room for any alphabet.
pub(super) type Counts = [u32; COMMAND_SYMBOLS.next_power_of_two()];

#[derive(Clone, Copy, Default)]
struct Entry {
    symbol: u32,
    count: u32,
}

/// Histograms without their zeros.
#[derive(Default)]
pub(super) struct Items {
    entries: Vec<Entry>,
    ends: Vec<u32>,
}

impl Items {
    pub(super) fn clear(&mut self) {
        self.entries.clear();
        self.ends.clear();
    }

    #[inline(never)]
    pub(super) fn push_counts(&mut self, counts: &[u32]) -> Result<()> {
        memory::try_reserve(&mut self.ends, 1)?;
        memory::try_reserve(&mut self.entries, counts.len())?;
        let used = with_avx2(
            #[inline(always)]
            || SymbolSet::matching(counts, |count| count != 0),
        );
        for symbol in &used {
            self.entries.push(Entry {
                symbol: symbol as u32,
                count: counts[symbol],
            });
        }
        self.ends.push(self.entries.len() as u32);
        Ok(())
    }

    /// One for each of the `contexts`, which are above the 8 bits of the literals. `zeros` are that again afterwards.
    #[inline(never)]
    pub(super) fn push_literals<'a>(
        &mut self,
        blocks: impl Iterator<Item = &'a [u16]>,
        contexts: usize,
        zeros: &mut [u32; LITERAL_CONTEXTS * LITERAL_SYMBOLS],
    ) -> Result<()> {
        let mut used = [[0u64; LITERAL_SYMBOLS / 64]; LITERAL_CONTEXTS];
        for block in blocks {
            for tagged in block
                .iter()
                .map(|&tagged| usize::from(tagged) % (LITERAL_CONTEXTS * LITERAL_SYMBOLS))
            {
                zeros[tagged] += 1;
                used.as_flattened_mut()[tagged / 64] |= 1 << (tagged % 64);
            }
        }
        memory::try_reserve(&mut self.ends, contexts)?;
        for (used, counts) in used[..contexts]
            .iter()
            .zip(zeros.as_chunks_mut::<LITERAL_SYMBOLS>().0)
        {
            memory::try_reserve(&mut self.entries, LITERAL_SYMBOLS)?;
            for (first, mut bits) in (0..).step_by(64).zip(*used) {
                while bits != 0 {
                    let symbol = first + bits.trailing_zeros();
                    let count = core::mem::take(&mut counts[symbol as usize % LITERAL_SYMBOLS]);
                    self.entries.push(Entry { symbol, count });
                    bits &= bits - 1;
                }
            }
            self.ends.push(self.entries.len() as u32);
        }
        Ok(())
    }

    /// `zeros` are that again afterwards.
    #[inline(never)]
    pub(super) fn push_symbols(&mut self, symbols: &[u16], zeros: &mut Counts) -> Result<()> {
        let (start, room) = (self.entries.len(), symbols.len().min(zeros.len()) + 1);
        memory::try_reserve(&mut self.ends, 1)?;
        memory::try_reserve(&mut self.entries, room)?;
        memory::resize(&mut self.entries, start + room, Entry::default());
        let mut end = start;
        for &symbol in symbols {
            let count = &mut zeros[usize::from(symbol) % zeros.len()];
            self.entries[end].symbol = symbol.into();
            end += usize::from(*count == 0);
            *count += 1;
        }
        self.entries.truncate(end);
        for entry in &mut self.entries[start..] {
            entry.count = core::mem::take(&mut zeros[entry.symbol as usize % zeros.len()]);
        }
        self.ends.push(end as u32);
        Ok(())
    }

    #[inline(always)]
    fn get(&self, index: usize) -> &[Entry] {
        let start = self.ends.get(index.wrapping_sub(1));
        &self.entries[start.map_or(0, |&start| start as usize)..self.ends[index] as usize]
    }

    pub(super) fn add_to(&self, index: usize, counts: &mut [u32]) {
        for entry in self.get(index) {
            counts[entry.symbol as usize] += entry.count;
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct Prices {
    /// For the description of a prefix code, in percent of what it takes.
    pub(super) description: u32,
    /// The same, while the first clusters come together.
    pub(super) first_description: u32,
    /// For neighbors in different clusters.
    pub(super) change: i32,
    /// For more than one cluster.
    pub(super) several: i32,
}

/// For the number of clusters.
#[derive(Clone, Copy)]
pub(super) struct Limit {
    pub(super) usual: usize,
    /// In sixteenths of what a cluster costs, for those above the usual number.
    pub(super) surcharge: i32,
    pub(super) max: usize,
}

/// Fits a quicker multiplication.
const SMALL: u32 = 0x7FFF;

/// Plus a constant, with 8 bits after the point.
#[inline(always)]
fn log2(value: u32) -> u32 {
    fixed_point_log2(value as i32 as f32) as u32 >> 15
}

#[inline(always)]
fn times_log2(counts: Lanes, mask: u32) -> Lanes {
    let mut sums = [[0; _]; _];
    tally(&[counts, [0; _]], 0, &[0; _], mask, &mut [0; _], &mut sums);
    sums[0]
}

/// What the description of a prefix code costs, with 12 bits after the point.
#[derive(Clone, Copy, Default)]
struct Description {
    fixed: u32,
    per_symbol: u32,
    /// Also per symbol, times the logarithms of the share of the alphabet and of the average count.
    sparse: u32,
    uneven: u32,
    log2_size: u32,
    /// The alphabet counts as so much more than the eights that are in use.
    nearby: u32,
}

impl Description {
    fn new(alphabet_size: usize, percent: u32) -> Self {
        let hundredths = match alphabet_size {
            LITERAL_SYMBOLS => [600, 30, 230, 50],
            COMMAND_SYMBOLS => [6000, 230, 50, 32],
            _ => [500, 140, 170, 0],
        };
        let [fixed, per_symbol, sparse, uneven] =
            hundredths.map(|price| price * percent * 256 / 625);
        let nearby = if alphabet_size == LITERAL_SYMBOLS {
            24
        } else {
            alphabet_size as u32
        };
        let log2_size = log2(alphabet_size as u32);
        Self {
            fixed,
            per_symbol,
            sparse,
            uneven,
            log2_size,
            nearby,
        }
    }
}

/// What the cost of a histogram depends on.
#[derive(Clone, Copy, Default)]
struct Sums {
    total: Lanes,
    times_log2: Lanes,
    used: Lanes,
    largest: Lanes,
    /// A bit for each eight literals, if there ever was one of them.
    eights: Lanes,
}

impl Sums {
    #[inline(always)]
    fn costs(&self, description: &Description, mask: u32) -> Lanes<i32> {
        let (mut apart, mut rest, mut costs) = ([0; LANES], [0; LANES], [0; LANES]);
        for i in 0..LANES {
            // No code is shorter than one bit.
            apart[i] = if 2 * self.largest[i] > self.total[i] {
                self.largest[i]
            } else {
                0
            };
            rest[i] = self.total[i] - apart[i];
        }
        let products = [times_log2(apart, mask), times_log2(rest, mask)];
        for (i, cost) in costs.iter_mut().enumerate() {
            let (total, used) = (self.total[i], self.used[i]);
            let first_bits = if apart[i] != 0 { total * BIT as u32 } else { 0 };
            let symbols = (products[0][i].wrapping_add(products[1][i]))
                .wrapping_add(first_bits)
                .wrapping_sub(self.times_log2[i]);
            // Among three, only one can be so short.
            let least = if used > 2 {
                (2 * total - self.largest[i]) * BIT as u32
            } else {
                0
            };
            // With all that is missing, other symbols could join for free.
            let symbols =
                symbols.wrapping_add((least.wrapping_sub(symbols) as i32).max(0) as u32 / 4);
            let times = |a: u32, b: u32| (a & SMALL) * (b & SMALL);
            let average = (log2(total) - log2(used)).min(4 << 8);
            let span = log2(8 * self.eights[i].count_ones() + description.nearby)
                .min(description.log2_size);
            let logs = times(description.sparse, span.wrapping_sub(log2(used)))
                + times(description.uneven, average);
            let code = description.fixed / 256
                + times(used, (description.per_symbol + logs / 256) / 16) / 16;
            let symbols = if used > 1 { symbols } else { 0 };
            *cost = if used != 0 {
                symbols.wrapping_add(code) as i32
            } else {
                0
            };
        }
        costs
    }
}

/// For a prefix code and its symbols. See [`Prices::description`].
#[inline(never)]
pub(super) fn cost_of(counts: &[u32], description: u32) -> i32 {
    #[inline(always)]
    fn sum(counts: &[u32], mask: u32) -> Sums {
        let (mut sums, mut eights) = (Sums::default(), 0);
        for counts in counts.as_chunks::<LANES>().0 {
            let products = times_log2(*counts, mask);
            eights = eights << 1 | u32::from(*counts != [0; _]);
            for (i, &count) in counts.iter().enumerate() {
                sums.total[i] += count;
                sums.times_log2[i] = sums.times_log2[i].wrapping_add(products[i]);
                sums.used[i] += u32::from(count != 0);
                sums.largest[i] = count.max(sums.largest[i]);
            }
        }
        for sums in [&mut sums.total, &mut sums.times_log2, &mut sums.used] {
            sums[0] = sums.iter().fold(0, |all, &sum| sum.wrapping_add(all));
        }
        sums.largest[0] = sums.largest.into_iter().fold(0, u32::max);
        sums.eights[0] = eights;
        sums
    }
    with_avx2(
        #[inline(always)]
        || {
            let mut sums = sum(counts, SMALL);
            if sums.largest[0] > SMALL {
                sums = sum(counts, u32::MAX);
            }
            sums.costs(&Description::new(counts.len(), description), u32::MAX)[0]
        },
    )
}

#[derive(Clone, Copy, Default)]
struct Group {
    sums: Sums,
    costs: Lanes<i32>,
    tried_sums: Sums,
    tried_costs: Lanes<i32>,
    most_frequent: [u32; LANES],
}

#[derive(Default)]
pub(super) struct Clusters {
    alphabet_size: usize,
    description: Description,
    is_small: bool,
    /// For each group and symbol, and [`times_log2`] of them.
    counts: Vec<[Lanes; 2]>,
    /// For each group and entry of the item that was tried.
    products: Vec<Lanes>,
    groups: Vec<Group>,
    added: Vec<Lanes<i32>>,
    /// For each pair of clusters.
    gains: Vec<i32>,
    pub(super) of_item: Vec<u32>,
    pub(super) count: usize,
}

impl Clusters {
    fn add_group(&mut self) -> Result<()> {
        let length = self.counts.len() + self.alphabet_size;
        memory::try_reserve(&mut self.counts, self.alphabet_size)?;
        memory::resize(&mut self.counts, length, [[0; LANES]; 2]);
        if self.products.len() < length {
            memory::try_reserve(&mut self.products, self.alphabet_size)?;
            memory::resize(&mut self.products, length, [0; LANES]);
        }
        self.groups.push(Group::default());
        self.added.push([0; LANES]);
        Ok(())
    }

    /// Notes what becomes of the first `count` clusters with `item`, and of `own` without it.
    #[inline(never)]
    fn try_adding(&mut self, item: &[Entry], own: usize, count: usize) {
        with_avx2(
            #[inline(always)]
            || match self.is_small {
                true => self.try_adding_below(SMALL, item, own, count),
                false => self.try_adding_below(u32::MAX, item, own, count),
            },
        );
    }

    #[inline(always)]
    fn try_adding_below(&mut self, mask: u32, item: &[Entry], own: usize, count: usize) {
        let size = self.alphabet_size;
        let eights = item
            .iter()
            .fold(0, |eights, entry| eights | 1 << (entry.symbol / 8 % 32));
        let groups = self.groups[..count.div_ceil(LANES)]
            .iter_mut()
            .zip(&mut self.added);
        for (index, (group, added)) in groups.enumerate() {
            let (counts, products) = (
                &self.counts[index * size..],
                &mut self.products[index * size..],
            );
            let (mut sums, mut signs, mut total) = (group.sums, [0; LANES], 0);
            if let Some(sign) = signs.get_mut(own.wrapping_sub(index * LANES)) {
                *sign = u32::MAX;
                let symbol = group.most_frequent[own % LANES];
                let entry = item.iter().find(|entry| entry.symbol == symbol);
                sums.largest[own % LANES] =
                    sums.largest[own % LANES].saturating_sub(entry.map_or(0, |entry| entry.count));
            }
            let mut tallies = [sums.times_log2, sums.used, sums.largest];
            for (entry, products) in item.iter().zip(products) {
                tally(
                    &counts[entry.symbol as usize],
                    entry.count,
                    &signs,
                    mask,
                    products,
                    &mut tallies,
                );
                total += entry.count;
            }
            [sums.times_log2, sums.used, sums.largest] = tallies;
            let signed = |value: u32, i: usize| (value ^ signs[i]).wrapping_sub(signs[i]);
            for i in 0..LANES {
                sums.total[i] = sums.total[i].wrapping_add(signed(total, i));
                sums.eights[i] |= eights;
            }
            let costs = sums.costs(&self.description, mask);
            for i in 0..LANES {
                added[i] = signed(costs[i].wrapping_sub(group.costs[i]) as u32, i) as i32;
            }
            (group.tried_sums, group.tried_costs) = (sums, costs);
        }
    }

    /// What was tried last.
    #[inline(never)]
    fn add(&mut self, item: &[Entry], sign: i32, cluster: usize) {
        let (group, lane) = (&mut self.groups[cluster / LANES], cluster % LANES);
        let first = cluster / LANES * self.alphabet_size;
        let (counts, largest) = (&mut self.counts[first..], group.tried_sums.largest[lane]);
        let mut most_frequent = group.most_frequent[lane];
        for (entry, products) in item.iter().zip(&self.products[first..]) {
            let [count, product] = &mut counts[entry.symbol as usize];
            count[lane] = count[lane].wrapping_add_signed(sign * entry.count as i32);
            product[lane] = products[lane];
            let is_largest = count[lane] == largest;
            most_frequent = select_unpredictable(is_largest, entry.symbol, most_frequent);
        }
        group.most_frequent[lane] = most_frequent;
        group.sums.total[lane] = group.tried_sums.total[lane];
        group.sums.times_log2[lane] = group.tried_sums.times_log2[lane];
        group.sums.used[lane] = group.tried_sums.used[lane];
        group.sums.largest[lane] = largest;
        group.sums.eights[lane] = group.tried_sums.eights[lane];
        group.costs[lane] = group.tried_costs[lane];
    }

    fn cheapest(&self, count: usize) -> usize {
        let added = &self.added.as_flattened()[..count];
        (0..count).fold(0, |best, i| if added[i] < added[best] { i } else { best })
    }

    fn members<'a>(&self, cluster: usize, room: &'a mut [Entry; COMMAND_SYMBOLS]) -> &'a [Entry] {
        let (size, mut end) = (self.alphabet_size, 0);
        for (symbol, [counts, _]) in (0..).zip(&self.counts[cluster / LANES * size..][..size]) {
            let count = counts[cluster % LANES];
            room[end] = Entry { symbol, count };
            end += usize::from(count != 0);
        }
        &room[..end]
    }

    fn set_gains(
        &mut self,
        cluster: usize,
        others: usize,
        borders: &[i32],
        room: &mut [Entry; COMMAND_SYMBOLS],
    ) {
        let members = self.members(cluster, room);
        self.try_adding(members, usize::MAX, others);
        let (count, cost) = (
            self.count,
            self.groups[cluster / LANES].costs[cluster % LANES],
        );
        for (other, added) in self.added.as_flattened()[..others].iter().enumerate() {
            if other != cluster && self.groups[other / LANES].sums.used[other % LANES] != 0 {
                let gain = cost - added + borders[cluster * count + other];
                self.gains[cluster * count + other] = gain;
                self.gains[other * count + cluster] = gain;
            }
        }
    }

    /// The best pair first. Returns how many there are up to the last one that is left.
    fn merge(&mut self, change: i32) -> Result<usize> {
        let count = self.count;
        self.gains = memory::filled(i32::MIN, count * count)?;
        // What the changes between two clusters cost.
        let mut borders: Vec<i32> = memory::zeroed(count * count)?;
        let mut previous = None;
        for &cluster in self.of_item.iter().filter(|&&cluster| cluster != NONE) {
            if let Some(previous) = previous.replace(cluster as usize) {
                borders[previous * count + cluster as usize] += change;
                borders[cluster as usize * count + previous] += change;
            }
        }
        let room = &mut [Entry::default(); _];
        for cluster in 1..count {
            self.set_gains(cluster, cluster, &borders, room);
        }
        let mut left = count;
        loop {
            let largest = self
                .gains
                .iter()
                .fold(0, |largest, &gain| gain.max(largest));
            let Some(best) = self.gains.iter().position(|&gain| gain == largest) else {
                return Ok(left);
            };
            let (kept, gone) = (best / count, best % count);
            let members = self.members(gone, room);
            self.try_adding(members, gone, gone + 1);
            self.add(members, -1, gone);
            self.add(members, 1, kept);
            for cluster in &mut self.of_item {
                *cluster = if *cluster == gone as u32 {
                    kept as u32
                } else {
                    *cluster
                };
            }
            for other in 0..count {
                borders[kept * count + other] += borders[gone * count + other];
                borders[other * count + kept] = borders[kept * count + other];
                self.gains[gone * count + other] = i32::MIN;
                self.gains[other * count + gone] = i32::MIN;
            }
            while self.groups[(left - 1) / LANES].sums.used[(left - 1) % LANES] == 0 {
                left -= 1;
            }
            self.set_gains(kept, left, &borders, room);
        }
    }

    fn reassign(&mut self, items: &Items, change: i32) {
        let mut previous = NONE;
        for index in 0..self.of_item.len() {
            let (item, old) = (items.get(index), self.of_item[index] as usize);
            if item.is_empty() {
                continue;
            }
            self.try_adding(item, old, self.count);
            let next = self.of_item[index + 1..].iter().find(|&&next| next != NONE);
            for &neighbor in [&previous, next.unwrap_or(&NONE)] {
                if let Some(added) = self.added.as_flattened_mut().get_mut(neighbor as usize) {
                    *added -= change;
                }
            }
            let new = self.cheapest(self.count);
            if new != old {
                self.add(item, -1, old);
                self.add(item, 1, new);
            }
            (self.of_item[index], previous) = (new as u32, new as u32);
        }
    }

    /// Each item, from the largest on, goes where it adds the least. Empty ones get no cluster.
    pub(super) fn begin(
        &mut self,
        items: &Items,
        alphabet_size: usize,
        limit: Limit,
        description: u32,
    ) -> Result<()> {
        (self.alphabet_size, self.description, self.count) = (
            alphabet_size,
            Description::new(alphabet_size, description),
            0,
        );
        self.is_small = items.entries.iter().map(|entry| entry.count).sum::<u32>() <= SMALL / 2;
        self.counts.clear();
        self.groups.clear();
        self.added.clear();
        memory::try_reserve(&mut self.groups, limit.max.div_ceil(LANES))?;
        memory::try_reserve(&mut self.added, limit.max.div_ceil(LANES))?;
        self.of_item = memory::filled(NONE, items.ends.len())?;
        let mut order = memory::empty(items.ends.len())?;
        order.extend((0..items.ends.len()).filter_map(|index| {
            let total: u32 = items.get(index).iter().map(|entry| entry.count).sum();
            (total != 0).then_some(u64::from(!total) << 32 | index as u64)
        }));
        order.sort_unstable();
        for index in order.into_iter().map(|key| key as u32 as usize) {
            let choices = limit.max.min(self.count + 1);
            if choices > self.groups.len() * LANES {
                self.add_group()?;
            }
            self.try_adding(items.get(index), usize::MAX, choices);
            if (limit.usual..limit.max).contains(&self.count) {
                let alone = &mut self.added.as_flattened_mut()[self.count];
                *alone += *alone / 16 * limit.surcharge;
            }
            let cluster = self.cheapest(choices);
            self.add(items.get(index), 1, cluster);
            self.of_item[index] = cluster as u32;
            self.count = self.count.max(cluster + 1);
        }
        Ok(())
    }

    /// Numbers them in the order they appear.
    pub(super) fn find(
        &mut self,
        items: &Items,
        alphabet_size: usize,
        limit: Limit,
        prices: &Prices,
    ) -> Result<()> {
        self.begin(items, alphabet_size, limit, prices.first_description)?;
        if self.count > 1 {
            self.description = Description::new(alphabet_size, prices.description);
            for group in &mut self.groups {
                group.costs = group.sums.costs(&self.description, u32::MAX);
            }
            self.count = self.merge(prices.change)?;
            if self.count > 1 {
                self.reassign(items, prices.change);
            }
        }
        let (mut numbers, mut changes) = ([None; MAX_CLUSTERS], 0);
        let first = self.of_item.iter().find(|&&cluster| cluster != NONE);
        let mut previous = first.copied().unwrap_or_default();
        self.count = 0;
        for cluster in &mut self.of_item {
            if *cluster != NONE && *cluster != previous {
                (changes, previous) = (changes + prices.change, *cluster);
            }
            *cluster = *numbers[previous as usize].get_or_insert_with(|| {
                self.count += 1;
                self.count as u32 - 1
            });
        }
        if let ([group], 2..) = (&*self.groups, self.count) {
            let mut all = [0; COMMAND_SYMBOLS];
            for entry in &items.entries {
                all[entry.symbol as usize] += entry.count;
            }
            let together = cost_of(
                &all[..alphabet_size.next_multiple_of(LANES)],
                prices.description,
            );
            if together <= group.costs.iter().sum::<i32>() + changes + prices.several {
                self.count = 1;
                self.of_item.fill(0);
            }
        }
        Ok(())
    }
}
