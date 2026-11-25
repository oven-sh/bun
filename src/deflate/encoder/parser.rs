//! Turns input into literals and matches, a batch at a time.

use bun_highway::deflate::{
    Batch, Costs, Finder, LADDER_LEN, LITERAL_COST, Links, MAX_BATCH, MAX_OVERRUN, MAX_TABLE_LEN,
    MAX_TABLES, Table, end_of_run, log2, parse,
};
use core::array::from_fn;
use core::mem::{replace, take};

use super::block::{Block, Estimate};
use super::grams::Grams;
use super::scratch::Scratch;
use super::window::Window;
use crate::format::{MAX_MATCH_LEN, MIN_MATCH_LEN, length_slot, length_slot_of};
use crate::{Result, wrapped, wrapped_mut};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Effort {
    /// Few positions are hashed.
    Lowest,
    Lower,
    /// All are, once.
    Low,
    /// With a second length where it pays most.
    Medium,
    High,
    Highest,
    /// With up to so many passes, from 1 to 3.
    Thorough(u8),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Literals,
    /// Only matches at a distance of 1.
    Runs,
    Matches {
        effort: Effort,
        /// Shorter ones are not looked for.
        min_len: u8,
    },
}

/// So little input is short.
pub(super) const SHORT_LEN: u32 = 2048;
/// With so little, there is less to choose from.
pub(super) const EARLY_LEN: u32 = 2 * (MAX_BATCH + MAX_OVERRUN) as u32;

/// In sixteenths of a bit.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Prices {
    of_literal: u32,
    /// Without the extra bits.
    of_match: u32,
}

impl Default for Prices {
    fn default() -> Self {
        Self {
            of_literal: 104,
            of_match: 156,
        }
    }
}

impl Prices {
    /// Codes for few symbols are longer than they ought to be.
    const MIN: u32 = 40;
    const FIXED: Self = Self {
        of_literal: 132,
        of_match: 192,
    };

    /// The fewer there were, the closer to the default.
    fn after(latest: &Estimate) -> Self {
        let mean = |cost, count, default| (cost / 16 + 64 * default) / (count + 64);
        let default = Self::default();
        Self {
            of_literal: mean(latest.literal_cost, latest.literals, default.of_literal)
                .max(Self::MIN),
            of_match: mean(latest.match_cost, latest.matches, default.of_match),
        }
    }

    fn costs(self, min_len: u8) -> Costs {
        const SHORT: [u8; 16] = table!(|len| extra_bits(len));
        const LONG: [u8; 16] = table!(|at| extra_bits(16 * at + 4).saturating_sub(1));
        const fn extra_bits(len: usize) -> u8 {
            length_slot(length_slot_of(if len < 3 { 3 } else { len })).extra_bits as u8
        }
        let unit = (u32::from(LITERAL_COST) << 16) / self.of_literal.max(1);
        let (mut of_bits, mut of_match) = (0, self.of_match * unit);
        let next = |price: &mut u32| (replace(price, *price + 16 * unit) >> 16).min(255) as u8;
        let of_bits: [u8; 8] = from_fn(|_| next(&mut of_bits));
        let least = (min_len - 1) * LITERAL_COST + 1;
        Costs {
            distances: from_fn(|_| next(&mut of_match).max(least)),
            short: SHORT.map(|bits| *wrapped(&of_bits, bits.into())),
            long: LONG.map(|bits| *wrapped(&of_bits, bits.into())),
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Extent {
    len: u32,
    candidates: u32,
}

#[derive(Default)]
pub struct Parser {
    /// The last are used.
    tables: [Table; MAX_TABLES],
    /// Only has a capacity.
    ladder: Vec<u8>,
    links: Links,
    grams: Grams,
    /// When the input ends there, it tells more about them.
    next_look: u32,
    /// The length of the shortest gram that followed from the last look.
    looks: u8,
    prices: Prices,
    /// With what they were made from.
    costs: Option<(Prices, u8, Costs)>,
    /// In the last batch.
    were_matches_rare: bool,
    were_matches_long: bool,
    were_tokens_rare: bool,
    were_tokens_few: bool,
    bytes_per_token: u32,
    /// So many batches from now on, and the last time.
    without_links: (u8, u8),
    were_literals_common: bool,
    were_literals_dear: bool,
    /// Counts the batches that might have been sampled.
    hasty_batches: u8,
    /// In 256ths of the last batch that was.
    sampled_literals: u32,
    /// So many batches are not, as that misses too much.
    careful_batches: u8,
    /// So much input has been in blocks that were too short to learn from.
    unlearned: u32,
    price_per_byte: Option<u16>,
    /// Of a match that went as far as there was input, or 0.
    run_distance: u32,
    /// The last batch, if it was a block of its own that ended with the input.
    flushed: Option<Extent>,
    collected: Extent,
}

/// More are hashed on their own, or little of the batch would be left.
const MAX_UNHASHED: u32 = 512;

fn finder(method: Method, tables: &mut [Table], is_sampled: bool) -> Option<Finder<'_>> {
    Some(match method {
        Method::Literals => Finder::Nothing,
        Method::Runs => Finder::Runs,
        _ if is_sampled => Finder::Samples(tables.iter_mut().find(|it| it.gram_len <= 8)?),
        _ => Finder::Tables(tables),
    })
}

impl Parser {
    /// Before `method` is used on `window`.
    pub fn try_reserve(&mut self, method: Method, window: &Window) -> Result<()> {
        let Method::Matches { effort, .. } = method else {
            return Ok(());
        };
        let len = Self::table_len(effort, window, window.bytes.capacity() as u32);
        let tables = match effort {
            Effort::Lowest | Effort::Lower | Effort::Low => 1,
            Effort::Medium | Effort::High => 2,
            Effort::Highest => 3,
            Effort::Thorough(_) => {
                self.ladder.try_reserve_exact(LADDER_LEN)?;
                MAX_TABLES
            }
        };
        if effort > Effort::Lower {
            self.links.try_reserve(window.bytes.capacity())?;
        }
        for table in self.tables.iter_mut().rev().take(tables) {
            let more = len.saturating_sub(table.entries.len());
            table.entries.try_reserve_exact(more)?;
        }
        Ok(())
    }

    fn table_len(effort: Effort, window: &Window, end: u32) -> usize {
        let positions = (end - Window::START).min(2 * window.size) as usize;
        let len = (positions + positions.min(1024)).next_power_of_two();
        // A longer one takes time to clear.
        len.min(match positions as u32 {
            ..=EARLY_LEN if effort < Effort::High => MAX_TABLE_LEN / 4,
            ..=EARLY_LEN => MAX_TABLE_LEN / 2,
            _ => MAX_TABLE_LEN,
        })
    }

    pub fn clear(&mut self) {
        self.tables.iter_mut().for_each(|it| it.entries.clear());
        self.clear_all_but_entries();
    }

    pub(super) fn clear_all_but_entries(&mut self) {
        self.tables.iter_mut().for_each(|it| it.gram_len = 0);
        self.links.clear();
        *self = Self {
            tables: take(&mut self.tables),
            ladder: take(&mut self.ladder),
            links: take(&mut self.links),
            costs: self.costs,
            ..Self::default()
        };
    }

    fn look_at(&mut self, window: &Window, min_len: u8) {
        self.grams.shortest = min_len;
        let start = (window.position).min(window.end.saturating_sub(SHORT_LEN));
        let input = window
            .bytes
            .get(start.max(Window::START) as usize..window.end as usize);
        let input = input.unwrap_or_default();
        self.next_look = match input.len() as u32 {
            ..256 => Window::START + 256,
            256..SHORT_LEN => Window::START + SHORT_LEN,
            _ => u32::MAX,
        };
        let Some(last) = input.last_chunk::<32>().filter(|_| input.len() >= 256) else {
            return;
        };
        let seen = last.iter().fold(0u64, |seen, byte| seen | 1 << (byte % 64));
        if min_len > 3 && input.len() < SHORT_LEN as usize && seen.count_ones() > 8 {
            return;
        }
        let (mut seen, mut periodic) = ([false; 256], 0);
        for piece in input.array_windows::<20>().step_by((input.len() / 32) | 1) {
            for (&earlier, &byte) in piece.iter().zip(&piece[12..]) {
                *wrapped_mut(&mut seen, byte.into()) = true;
                periodic += u32::from(byte == earlier);
            }
        }
        self.were_matches_long = periodic > 170;
        self.were_tokens_rare = periodic > 250;
        if self.were_matches_long {
            self.prices = Prices::default();
        } else {
            let count = |seen: &[bool]| seen.iter().map(|&it| u8::from(it)).sum::<u8>().into();
            let (low, high): (u32, u32) = (count(&seen[..128]), count(&seen[128..]));
            let different = low + high;
            self.grams
                .choose(different, high >= 8, input.len(), min_len);
            self.prices.of_literal = (log2(different) / 16 + 12).max(Prices::MIN);
            // So short blocks have the fixed codes.
            if window.lookahead() < 100 && (4..20).contains(&different) {
                self.grams = Grams::for_dear_literals(min_len);
            }
        }
    }

    /// What has been learned holds, unless the input looks different.
    fn look_again(&mut self, window: &Window, min_len: u8) {
        let before = (self.grams, self.prices, self.were_matches_long);
        self.look_at(window, min_len);
        let looks = replace(&mut self.looks, self.grams.shortest);
        if (looks == self.looks && !self.were_literals_dear)
            || (before.0.shortest == 4 && !self.were_matches_long)
        {
            (self.grams, self.prices) = (before.0, before.1);
        }
        self.were_matches_long = before.2;
    }

    /// Returns how many of the tables are not used, and which know nothing yet.
    fn prepare_tables(&mut self, effort: Effort, window: &Window) -> (usize, [bool; MAX_TABLES]) {
        let gram_lens = match (window.end - Window::START, effort) {
            (len, Effort::Thorough(passes)) => self.grams.ladder(len, passes),
            (..=SHORT_LEN, _) => self.grams.lens(Effort::Low),
            (..=EARLY_LEN, Effort::High) => self.grams.lens(Effort::Medium),
            (..=EARLY_LEN, Effort::Highest) => self.grams.lens(Effort::High),
            _ => self.grams.lens(effort),
        };
        let len = Self::table_len(effort, window, window.end);
        let unused = MAX_TABLES - gram_lens.len();
        let (idle, used) = self.tables.split_at(unused);
        let is_ready =
            |(it, &gram_len): (&Table, _)| (it.gram_len, it.len) == (gram_len, len as u32);
        if idle.last().is_none_or(|it| it.gram_len == 0) && used.iter().zip(gram_lens).all(is_ready)
        {
            return (unused, [false; _]);
        }
        for (at, &gram_len) in (unused..).zip(gram_lens) {
            if let Some(known) = self.tables.iter().position(|it| it.gram_len == gram_len) {
                self.tables.swap(at, known);
            }
        }
        let mut are_new = [false; _];
        let (idle, used) = self.tables.split_at_mut(unused);
        idle.iter_mut().for_each(|it| it.gram_len = 0);
        for ((table, &gram_len), is_new) in used.iter_mut().zip(gram_lens).zip(&mut are_new) {
            if table.entries.is_empty() {
                table.entries.resize(len, 0);
            }
            while table.entries.len() < len {
                table.entries.extend_from_within(..);
            }
            table.len = len as u32;
            *is_new = replace(&mut table.gram_len, gram_len) != gram_len;
        }
        (unused, are_new)
    }

    /// For a block that ends there.
    pub fn has_no_time_for_codes(&self, method: Method, window: &Window, end: u32) -> bool {
        matches!(method, Method::Matches { effort: Effort::Lowest, min_len } if min_len + u8::from(end == window.end) >= self.grams.shortest)
            && i64::from(end) - window.block_start <= SHORT_LEN.into()
    }

    /// How much more input [`Self::parse`] wants.
    pub fn wanted(window: &Window) -> usize {
        let unhashed = window.position - window.hashed;
        let unhashed = if unhashed > MAX_UNHASHED { 0 } else { unhashed };
        let len = (MAX_BATCH + MAX_OVERRUN) as u32 - unhashed;
        len.saturating_sub(window.lookahead()) as usize
    }

    /// Moves the position on. `block` is not full. `None` is for what the code rules out.
    pub fn parse(
        &mut self,
        method: Method,
        window: &mut Window,
        ends_input: bool,
        has_fixed_codes: bool,
        scratch: &mut Scratch,
        block: &mut Block,
    ) -> Option<()> {
        match method {
            Method::Literals => self.run_distance = 0,
            Method::Runs => self.run_distance = self.run_distance.min(1),
            Method::Matches { .. } => {}
        }
        if self.run_distance != 0 && self.continue_run(window, ends_input, block)? {
            return Some(());
        }
        self.learn_from_short_batches(method, block);
        let scratch = scratch.parsing.spare_capacity_mut().first_chunk_mut()?;
        let (mut unused, mut shortest, mut is_sampled) = (MAX_TABLES, MIN_MATCH_LEN as u8, false);
        let (mut least, mut are_new) = (shortest, [false; _]);
        let (mut is_hasty, mut is_greedy, mut is_probe) = (false, false, false);
        if let Method::Matches { effort, min_len } = method {
            let is_long = window.lookahead() > SHORT_LEN;
            let are_rare = is_long
                && self.were_matches_rare
                && (effort <= Effort::Highest || self.prices.of_literal >= 60);
            is_hasty = is_long && effort == Effort::Lowest && self.careful_batches == 0;
            self.careful_batches = self.careful_batches.saturating_sub(1);
            // The input may have changed.
            if are_rare || is_hasty || effort > Effort::Highest {
                self.hasty_batches = self.hasty_batches.wrapping_add(1);
                let is_time = self.hasty_batches % if are_rare { 4 } else { 16 } == 3;
                is_probe = is_time && (are_rare || (is_hasty && self.sampled_literals > 128));
                if is_time {
                    self.next_look = 0;
                }
            }
            if take(&mut self.were_literals_common) && self.grams.shortest > min_len {
                self.look_again(window, min_len);
            }
            if has_fixed_codes {
                self.grams = Grams::for_dear_literals(min_len);
            } else if self.grams.shortest < min_len || window.end >= self.next_look {
                self.look_at(window, min_len + u8::from(is_hasty && !is_probe));
                self.looks = self.grams.shortest;
            }
            ((unused, are_new), shortest) =
                (self.prepare_tables(effort, window), self.grams.shortest);
            // What is found by chance is welcome, unless it is filtered.
            least = if min_len > 4 { min_len } else { least };
            // For so little, it does not pay to set up more.
            let little = if window.position == Window::START {
                128
            } else if shortest == min_len {
                400
            } else {
                SHORT_LEN
            };
            is_greedy = (effort <= Effort::Lower && self.were_matches_long)
                || (effort == Effort::Low && self.bytes_per_token > 64 && min_len > 3)
                || (effort == Effort::Lowest && window.lookahead() < little);
            is_hasty |= are_rare;
            is_sampled = !is_probe
                && (is_hasty || (effort == Effort::Lowest && !is_long && shortest > min_len));
        }
        let prices = if has_fixed_codes
            || self.has_no_time_for_codes(method, window, window.end)
            || (block.was_fixed && window.lookahead() < SHORT_LEN)
        {
            Prices::FIXED
        } else {
            self.prices
        };
        let costs = match self.costs {
            Some(known) if (known.0, known.1) == (prices, least) => known.2,
            _ => self.costs.insert((prices, least, prices.costs(least))).2,
        };
        let tables = self.tables.get_mut(unused..)?;
        if ends_input {
            // Some hashes cover them.
            *crate::chunk_at_mut(&mut window.bytes, window.end as usize)? = [0; 24];
        }

        let hashable = match ends_input {
            true => window.end + 1 - u32::from(shortest),
            false => window.end - MAX_OVERRUN as u32,
        };
        let mut batch = Batch {
            bytes: &window.bytes,
            hashed: 0..0,
            parsed: 0..0,
            end: 0,
            ends_input,
            expects_few_matches: self.were_matches_long,
            were_tokens_few: self.were_tokens_few,
            is_hasty: matches!(method, Method::Matches { effort, .. } if effort <= Effort::Low),
            max_distance: window.size - window.margin,
            stamp: window.stamp,
        };
        let mut hash = |from: u32, to: u32, tables: &mut [Table], is_sampled| {
            batch.end = from.max(window.position.saturating_sub(window.size));
            while batch.end < to {
                batch.hashed = batch.end..to.min(batch.end + MAX_BATCH as u32);
                batch.end = batch.hashed.end;
                batch.parsed = batch.end..batch.end;
                let finder = finder(method, tables, is_sampled)?;
                parse(&batch, finder, None, costs, scratch, &mut block.tokens)?;
            }
            Some(batch.end)
        };
        for (table, _) in tables.chunks_mut(1).zip(are_new).filter(|it| it.1) {
            let is_sampled = is_hasty && table.first()?.gram_len <= 8;
            hash(Window::START, window.hashed, table, is_sampled)?;
        }
        let start = match window.position - window.hashed {
            _ if tables.is_empty() => window.position,
            ..=MAX_UNHASHED => window.hashed,
            _ => hash(
                window.hashed,
                window.position.min(hashable),
                tables,
                is_sampled,
            )?,
        };
        // It soon shows if there is a quicker way.
        let len = match is_probe || (is_sampled && window.position == Window::START) {
            true => SHORT_LEN,
            false => MAX_BATCH as u32,
        };
        batch.hashed = start..hashable.clamp(start, start + len);
        batch.end = window.end.min(start + len + MAX_OVERRUN as u32);
        batch.ends_input &= batch.end == window.end;
        let is_last = batch.ends_input && batch.hashed.end >= hashable;
        batch.parsed = window.position..if is_last { batch.end } else { batch.hashed.end };
        let is_alone = is_last && block.is_empty();
        let is_first = window.position == Window::START;
        let (tokens, known) = block.room()?;
        let finder = match method {
            _ if is_greedy => Finder::Gaps(tables.first_mut()?),
            Method::Matches {
                effort: Effort::Thorough(passes),
                ..
            } if !is_sampled && !self.were_tokens_rare => Finder::Everything {
                price_per_byte: self.price_per_byte.get_or_insert(300),
                tables,
                known: (!is_first).then_some(known),
                passes,
                ladder: self.ladder.spare_capacity_mut().first_chunk_mut()?,
            },
            _ => finder(method, tables, is_sampled)?,
        };
        let depth = match method {
            _ if self.without_links.0 != 0 => 0,
            Method::Matches { effort, .. } => match effort {
                Effort::Lowest | Effort::Lower => 0,
                Effort::Low => 1,
                Effort::Medium => 2,
                Effort::High => 3,
                _ => 10,
            },
            _ => 0,
        };
        let links = (depth != 0).then_some((&mut self.links, depth));
        let parsed = parse(&batch, finder, links, costs, scratch, tokens)?;
        self.without_links = match self.without_links {
            _ if parsed.did_links_pay => (0, 0),
            (0, last) => (last, (2 * last + 1).min(15)),
            (left, last) => (left - 1, last),
        };
        window.hashed = batch.hashed.end.min(parsed.position);
        let batch_start = replace(&mut window.position, parsed.position);
        self.run_distance = parsed.run_distance;
        let latest = Extent {
            len: parsed.position - batch_start,
            candidates: parsed.candidates,
        };
        if is_alone {
            block.take_in_all();
            self.were_matches_long = 24 * (block.tokens.len() as u32) < latest.len;
            self.flushed = Some(latest);
        } else {
            let estimate = block.take_in_or_end()?;
            if !is_last {
                let literals = 256 * estimate.literals / latest.len.max(1);
                let needed = if self.prices.of_literal > 120 { 32 } else { 80 };
                if is_sampled {
                    if replace(&mut self.sampled_literals, literals) + 64 < literals && !is_first {
                        self.hasty_batches = 2;
                    }
                } else if is_probe && literals + needed < self.sampled_literals {
                    (self.careful_batches, self.hasty_batches) = (64, 1);
                }
                self.learn(method, &estimate, latest, is_sampled);
            }
        }
        (parsed.position > batch_start).then_some(())
    }

    fn learn(&mut self, method: Method, latest: &Estimate, extent: Extent, is_sampled: bool) {
        let Extent { len, candidates } = extent;
        self.prices = Prices::after(latest);
        self.unlearned = 0;
        self.bytes_per_token = len / (latest.literals + latest.matches + 1);
        self.were_tokens_few = 2 * latest.literals + 9 * latest.matches < len;
        self.were_literals_dear = latest.literal_cost > 6 * 256 * len;
        self.were_literals_common = !is_sampled && 5 * latest.literals > 2 * len;
        self.were_matches_rare = (len - latest.literals) * if is_sampled { 256 } else { 64 } < len;
        self.were_matches_long = 4 * latest.literals + 32 * latest.matches < len;
        self.were_tokens_rare = 224 * (latest.literals + latest.matches) < len;
        if let (Method::Matches { effort, min_len }, false) = (method, is_sampled)
            && (Effort::Lower..=Effort::Highest).contains(&effort)
            && (effort > Effort::Low || candidates != 0)
        {
            self.grams.adapt(latest, candidates, effort, min_len);
        }
    }

    /// Once they add up to a whole one.
    fn learn_from_short_batches(&mut self, method: Method, block: &mut Block) {
        let Some(latest) = self.flushed.take() else {
            return;
        };
        let Some(frequencies) = block.add_up(self.collected.len == 0) else {
            let before = self.unlearned;
            self.unlearned = before.saturating_add(latest.len);
            if (before..self.unlearned).contains(&SHORT_LEN) {
                (self.prices, self.next_look) = Default::default();
            }
            return;
        };
        self.collected.len += latest.len;
        self.collected.candidates += latest.candidates;
        if self.collected.len >= MAX_BATCH as u32 {
            let (collected, is_sampled) = (take(&mut self.collected), self.were_matches_rare);
            self.learn(method, &Estimate::new(frequencies), collected, is_sampled);
            if self.were_matches_rare {
                self.next_look = 0;
            }
        }
    }

    /// Whether the position has moved.
    fn continue_run(
        &mut self,
        window: &mut Window,
        ends_input: bool,
        block: &mut Block,
    ) -> Option<bool> {
        let (before, ahead) = window
            .bytes
            .get(..window.end as usize)?
            .split_at_checked(window.position as usize)?;
        if before
            .last_chunk::<16>()?
            .iter()
            .all(|byte| ahead.first() == Some(byte))
        {
            self.run_distance = 1;
        }
        let distance = self.run_distance;
        let end = end_of_run(&window.bytes, window.position..window.end, distance)?;
        let len = (end - window.position) as usize;
        if len < ahead.len() || ends_input {
            self.run_distance = 0;
        }
        let matches = len / MAX_MATCH_LEN;
        block.add_longest_matches(matches, distance)?;
        window.position += (matches * MAX_MATCH_LEN) as u32;
        // The last period leaves the same in the tables as all do.
        window.hashed = window.hashed.max(window.position - distance);
        Some(matches != 0)
    }
}
