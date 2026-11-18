//! Which values are live between blocks.

use bun_engine_asm::{Bank, Reg, RegisterSet};

use super::code::{Code, NEVER, VReg};
use crate::TooComplex;
use crate::analysis::{Cfg, Frequencies, Loop, TURNS_OF_A_LOOP};
use crate::bitset;
use crate::ir::{Block, Edge, Entity, Function, Table};

const MAX_WORDS: usize = 8 << 20;
/// As a share of the turns of a loop.
const SELDOM: f32 = 0.125;
const END_OF_LIST: u32 = u32::MAX;
const BANK_SIZE: usize = Reg::COUNT / 2;

/// Links the globals whose stretch in the order of blocks starts at one position, and those whose stretch ends at one.
#[derive(Clone, Copy)]
struct Links {
    same_start: u32,
    same_end: u32,
}

/// About what the values that a loop defines ask of one bank, as shares of its turns.
#[derive(Clone, Copy, Default)]
pub(crate) struct Demand {
    /// By the number of registers, those that need more.
    more_than: [f32; BANK_SIZE],
    /// Those in which all registers are clobbered.
    pub(crate) losses: f32,
}

impl Demand {
    fn add(&mut self, count: u32, frequency: f32) {
        if let Some(fewer) = (count as usize).min(BANK_SIZE).checked_sub(1) {
            self.more_than[fewer] += frequency;
        }
    }

    fn finish(&mut self, turns: f32) {
        let mut sum = 0.0;
        for share in self.more_than.iter_mut().rev() {
            sum += *share;
            *share = (sum / turns).min(1.0);
        }
        self.losses = (self.losses / turns).min(1.0);
    }

    fn usual(&self) -> u32 {
        self.more_than.partition_point(|&share| share > SELDOM) as u32
    }

    pub(crate) fn more_than(&self, count: u32) -> f32 {
        self.more_than[count as usize % BANK_SIZE]
    }
}

#[derive(Default)]
pub(crate) struct Liveness {
    words: usize,
    /// The bits of each bank.
    banks: [core::ops::Range<u32>; 2],
    /// A row for each position in the order of blocks, and more for `rows_from_before`.
    live_in: Vec<u64>,
    /// For each position, the row for edges that do not go backward. It lacks the constants that a loop shares.
    rows_from_before: Vec<u32>,
    /// A row for each loop, of what it reads outside cold code.
    used_in_loop: Vec<u64>,
    in_gpr_bank: Vec<u64>,
    first_links: Vec<Links>,
    links: Vec<Links>,
    taken: [Vec<u64>; 2],
    row: Vec<u64>,
    demands: Table<Loop, [Demand; 2]>,
    claims: Table<Loop, RegisterSet>,
}

#[inline]
fn union(into: &mut [u64], from: &[u64]) {
    into.iter_mut()
        .zip(from)
        .for_each(|(into, from)| *into |= from);
}

fn take_lowest(taken: &mut Vec<u64>) -> u32 {
    let index = taken.iter().position(|&word| word != u64::MAX);
    let index = index.unwrap_or_else(|| {
        taken.push(0);
        taken.len() - 1
    });
    let bit = taken[index].trailing_ones();
    taken[index] |= 1 << bit;
    index as u32 * u64::BITS + bit
}

impl Liveness {
    /// Also numbers the globals, and moves the end of each value to where it stops being live.
    pub(crate) fn compute(
        &mut self,
        function: &Function,
        cfg: &Cfg,
        frequencies: &Frequencies,
        code: &mut Code,
    ) -> Result<(), TooComplex> {
        self.find_stretches(cfg, code);
        self.number(code);
        if (cfg.order().len() + 2 * cfg.loops().len()) * self.words > MAX_WORDS {
            return Err(TooComplex);
        }
        self.gather(cfg, frequencies, code);
        self.propagate(function, cfg, code);
        self.measure_loops(cfg, frequencies, code);
        Ok(())
    }

    #[inline]
    pub(super) fn words(&self) -> usize {
        self.words
    }

    #[inline]
    pub(super) fn bits_of(&self, bank: Bank) -> core::ops::Range<usize> {
        let bits = &self.banks[bank as usize];
        bits.start as usize..bits.end as usize
    }

    #[inline]
    fn range(&self, row: usize) -> core::ops::Range<usize> {
        row * self.words..(row + 1) * self.words
    }

    #[inline]
    pub(crate) fn live_in(&self, cfg: &Cfg, block: Block) -> &[u64] {
        &self.live_in[self.range(cfg.position(block) as usize)]
    }

    /// What has to be there already when the edge is taken.
    #[inline]
    pub(crate) fn live_along(&self, function: &Function, cfg: &Cfg, edge: Edge) -> &[u64] {
        let mut row = cfg.position(function.target(edge));
        if row > cfg.position(function.source(edge)) {
            row = self.rows_from_before[row as usize];
        }
        &self.live_in[self.range(row as usize)]
    }

    #[inline]
    pub(crate) fn used_in(&self, outer: Loop) -> &[u64] {
        &self.used_in_loop[self.range(outer.index())]
    }

    /// What instructions that the loop runs often clobber or need for themselves.
    #[inline]
    pub(crate) fn claims(&self, outer: Loop) -> RegisterSet {
        self.claims[outer]
    }

    pub(crate) fn demand(&self, outer: Loop, bank: Bank) -> &Demand {
        &self.demands[outer][bank as usize]
    }

    #[inline]
    pub(crate) fn live_out(
        &self,
        function: &Function,
        cfg: &Cfg,
        block: Block,
        into: &mut Vec<u64>,
    ) {
        into.clear();
        let mut edges = function.successors(block);
        match edges.next() {
            Some(first) => into.extend_from_slice(self.live_along(function, cfg, first)),
            None => into.resize(self.words, 0),
        }
        for edge in edges {
            union(into, self.live_along(function, cfg, edge));
        }
    }

    /// The globals that the block at the position defines, and the constants of the loop that it heads.
    #[inline]
    pub(crate) fn starting_at(&self, code: &Code, position: usize) -> impl Iterator<Item = VReg> {
        let mut next = self.first_links[position].same_start;
        core::iter::from_fn(move || {
            let links = self.links.get(next as usize)?;
            Some(code.globals[core::mem::replace(&mut next, links.same_start) as usize].0)
        })
    }

    /// A value is live in all of a loop that uses it and does not define it.
    fn find_stretches(&mut self, cfg: &Cfg, code: &mut Code) {
        const UNLINKED: Links = Links {
            same_start: END_OF_LIST,
            same_end: END_OF_LIST,
        };
        self.first_links.clear();
        self.first_links.resize(cfg.order().len(), UNLINKED);
        self.links.clear();
        for (index, &(vreg, last_user)) in code.globals.iter().enumerate() {
            let data = &mut code.vregs[vreg];
            let (start, mut end) = (cfg.position(data.block), cfg.position(last_user));
            let before_loops = start + u32::from(!data.is_floating());
            let mut around = cfg.loop_of(last_user);
            while let Some(outer) = cfg.loops().get(around)
                && outer.positions().start >= before_loops
            {
                end = outer.positions().end - 1;
                data.end = code.blocks[cfg.order()[end as usize]].exit();
                around = outer.parent;
            }
            let link = |first: &mut u32| core::mem::replace(first, index as u32);
            self.links.push(Links {
                same_start: link(&mut self.first_links[start as usize].same_start),
                same_end: link(&mut self.first_links[end as usize].same_end),
            });
        }
    }

    fn number(&mut self, code: &mut Code) {
        self.taken.iter_mut().for_each(Vec::clear);
        let mut counts = [0; 2];
        for first in &self.first_links {
            let mut next = first.same_start;
            while let Some(links) = self.links.get(next as usize) {
                let data = &mut code.vregs[code.globals[next as usize].0];
                let bank = data.class.bank() as usize;
                data.global = take_lowest(&mut self.taken[bank]);
                counts[bank] = counts[bank].max(data.global + 1);
                next = links.same_start;
            }
            next = first.same_end;
            while let Some(links) = self.links.get(next as usize) {
                let data = &code.vregs[code.globals[next as usize].0];
                let taken = &mut self.taken[data.class.bank() as usize];
                bitset::remove(taken, data.global as usize);
                next = links.same_end;
            }
        }
        let [gprs, fprs] = counts;
        self.banks = if fprs <= gprs {
            [fprs..fprs + gprs, 0..fprs]
        } else {
            [0..gprs, gprs..gprs + fprs]
        };
        if gprs != 0 && fprs != 0 {
            for &(vreg, _) in &code.globals {
                let data = &mut code.vregs[vreg];
                data.global += self.banks[data.class.bank() as usize].start;
            }
        }
        self.words = bitset::words_for((gprs + fprs) as usize);
        self.in_gpr_bank.clear();
        self.in_gpr_bank.resize(self.words, 0);
        for bit in self.bits_of(Bank::Gpr) {
            bitset::insert(&mut self.in_gpr_bank, bit);
        }
    }

    fn gather(&mut self, cfg: &Cfg, frequencies: &Frequencies, code: &Code) {
        let (blocks, loops) = (cfg.order().len(), cfg.loops().len());
        for (rows, count) in [
            (&mut self.live_in, blocks + loops),
            (&mut self.used_in_loop, loops),
        ] {
            rows.clear();
            rows.resize(count * self.words, 0);
        }
        self.rows_from_before.clear();
        self.rows_from_before.extend(0..blocks as u32);
        for (index, data) in cfg.loops().values().enumerate() {
            self.rows_from_before[data.positions().start as usize] = (blocks + index) as u32;
        }
        for foreign in &code.foreign_uses {
            let global = code.vregs[foreign.vreg].global;
            let range = self.range(cfg.position(foreign.block) as usize);
            bitset::insert(&mut self.live_in[range], global as usize);
            if let Some(own) = cfg.loop_of(foreign.block).expand()
                && foreign.first_warm != NEVER
                && !frequencies.is_cold(foreign.block)
            {
                let range = self.range(own.index());
                bitset::insert(&mut self.used_in_loop[range], global as usize);
            }
        }
        for inner in cfg.loops().keys().rev() {
            if let Some(outer) = cfg.loops()[inner].parent.expand() {
                let (outer, inner) = (self.range(outer.index()), self.range(inner.index()));
                let (before, after) = self.used_in_loop.split_at_mut(inner.start);
                union(&mut before[outer], &after[..self.words]);
            }
        }
    }

    fn copy_for_edges_from_before(&mut self, code: &Code, position: usize) {
        let copy = self.rows_from_before[position] as usize;
        if copy != position {
            let (from, to) = (self.range(position), self.range(copy));
            let mut live_in = core::mem::take(&mut self.live_in);
            live_in.copy_within(from, to.start);
            for vreg in self.starting_at(code, position) {
                bitset::remove(&mut live_in[to.clone()], code.vregs[vreg].global as usize);
            }
            self.live_in = live_in;
        }
    }

    /// Returns whether anything was added.
    fn flow_backward(&mut self, function: &Function, cfg: &Cfg, code: &Code) -> bool {
        let mut added = 0;
        let mut row = core::mem::take(&mut self.row);
        for (position, &block) in cfg.order().iter().enumerate().rev() {
            self.live_out(function, cfg, block, &mut row);
            for vreg in self.starting_at(code, position) {
                let data = &code.vregs[vreg];
                if !data.is_floating() {
                    bitset::remove(&mut row, data.global as usize);
                }
            }
            let range = self.range(position);
            for (live, &out) in self.live_in[range].iter_mut().zip(&row) {
                added |= out & !*live;
                *live |= out;
            }
            self.copy_for_edges_from_before(code, position);
        }
        self.row = row;
        added != 0
    }

    /// What is live at the header of a natural loop is live in all of it.
    fn propagate(&mut self, function: &Function, cfg: &Cfg, code: &Code) {
        self.flow_backward(function, cfg, code);
        if cfg.loops().values().any(|data| !data.is_natural) {
            while self.flow_backward(function, cfg, code) {}
            return;
        }
        for (position, &block) in cfg.order().iter().enumerate() {
            let Some(own) = cfg.loops().get(cfg.loop_of(block)) else {
                continue;
            };
            let around = if own.header == block {
                cfg.loops().get(own.parent)
            } else {
                Some(own)
            };
            if let Some(around) = around {
                let header = self.range(around.positions().start as usize);
                let (before, after) = self.live_in.split_at_mut(position * self.words);
                union(&mut after[..self.words], &before[header]);
                self.copy_for_edges_from_before(code, position);
            }
        }
    }

    fn count_by_bank(&self, mut word: impl FnMut(usize) -> u64) -> [u32; 2] {
        let mut counts = [0; 2];
        for (index, &gprs) in self.in_gpr_bank.iter().enumerate() {
            let word = word(index);
            counts[Bank::Gpr as usize] += (word & gprs).count_ones();
            counts[Bank::Fpr as usize] += (word & !gprs).count_ones();
        }
        counts
    }

    fn measure_loops(&mut self, cfg: &Cfg, frequencies: &Frequencies, code: &Code) {
        let mut demands = core::mem::take(&mut self.demands);
        demands.refill(cfg.loops().len(), [Demand::default(); 2]);
        let mut claims = core::mem::take(&mut self.claims);
        claims.refill(cfg.loops().len(), RegisterSet::EMPTY);
        let is_often = |outer: Loop, frequency: f32| {
            frequency >= SELDOM * frequencies.of_block(cfg.loops()[outer].header)
        };
        let defined_since = |outer: Loop, block: Block| {
            let before = self.live_in(cfg, cfg.loops()[outer].header);
            let live = self.live_in(cfg, block);
            self.count_by_bank(|index| live[index] & !before[index])
        };
        for &block in cfg.order().iter().rev() {
            let Some(own) = cfg.loop_of(block).expand() else {
                continue;
            };
            let (data, around) = (&code.blocks[block], &cfg.loops()[own]);
            let (defined, frequency) = (defined_since(own, block), frequencies.of_block(block));
            for (bank, demand) in demands[own].iter_mut().enumerate() {
                if data.barrier[bank] != 0 {
                    demand.losses += frequency;
                }
                demand.add(
                    defined[bank].saturating_add_signed(data.pressure[bank]),
                    frequency,
                );
            }
            if is_often(own, frequency) {
                claims[own] |= data.claimed;
            }
            if around.header != block {
                continue;
            }
            demands[own].iter_mut().for_each(|it| it.finish(frequency));
            if let Some(outer) = around.parent.expand() {
                let (inner, defined) = (demands[own], defined_since(outer, block));
                let entered = frequency / TURNS_OF_A_LOOP;
                if is_often(outer, entered) {
                    let inner = claims[own];
                    claims[outer] |= inner;
                }
                for (bank, demand) in demands[outer].iter_mut().enumerate() {
                    demand.losses += entered * (inner[bank].losses * TURNS_OF_A_LOOP).min(1.0);
                    demand.add(defined[bank] + inner[bank].usual(), entered);
                }
            }
        }
        (self.demands, self.claims) = (demands, claims);
    }
}
