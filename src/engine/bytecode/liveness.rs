//! Which locals hold a value that is yet to be read.

use core::ops::Range;

use crate::code::{Body, TooLarge};
use crate::effects::{EdgeKind, PlainEffects, Resumption, Run, Written};
use crate::graph::{BlockIndex, Graph, refill};
use crate::instruction::{Opcode, RawInstruction};
use crate::operand::Register;

const MAX_WORDS: usize = 1 << 25;
const EDGE_KINDS: usize = 3;
/// The words in a stripe of code whose locals do not fit in one.
const WIDE: usize = 4;

/// Calls `visit` with the index and the bits of each word of a set that has locals of the run.
#[inline(always)]
fn for_each_word(run: Run, mut visit: impl FnMut(usize, u64)) {
    if run.count == 1 {
        if let Some(local) = run.first.local_index() {
            visit(local as usize / 64, 1 << (local % 64));
        }
        return;
    }
    let first = -1 - i64::from(run.first.offset());
    let (mut local, end) = (first.max(0), first + i64::from(run.count));
    while local < end {
        let next = end.min((local | 63) + 1);
        let bits = u64::MAX >> (64 - (next - local)) << (local % 64);
        visit(local as usize / 64, bits);
        local = next;
    }
}

fn set_bits(mut bits: u64) -> impl Iterator<Item = u32> {
    core::iter::from_fn(move || {
        let bit = (bits != 0).then(|| bits.trailing_zeros())?;
        bits &= bits - 1;
        Some(bit)
    })
}

/// `64 * N` locals in a row.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Stripe<const N: usize>([u64; N]);

impl<const N: usize> Stripe<N> {
    const EMPTY: Stripe<N> = Stripe([0; N]);

    #[inline(always)]
    fn is_empty(self) -> bool {
        self.0.iter().fold(0, |all, word| all | word) == 0
    }

    #[inline(always)]
    fn with(self, other: Stripe<N>) -> Stripe<N> {
        Stripe(core::array::from_fn(|word| self.0[word] | other.0[word]))
    }

    #[inline(always)]
    fn without(self, other: Stripe<N>) -> Stripe<N> {
        Stripe(core::array::from_fn(|word| self.0[word] & !other.0[word]))
    }
}

/// What a block does to one stripe.
#[derive(Clone, Copy)]
struct Summary<const N: usize> {
    stripe: u32,
    block: u32,
    read_first: Stripe<N>,
    /// By the time it is left by each kind of edge, at the earliest.
    written: [Stripe<N>; EDGE_KINDS],
}

impl<const N: usize> Summary<N> {
    const EMPTY: Summary<N> = Summary {
        stripe: 0,
        block: 0,
        read_first: Stripe::EMPTY,
        written: [Stripe::EMPTY; EDGE_KINDS],
    };

    /// To the first word. Returns the offset of the first instruction that is not plain.
    #[inline(always)]
    fn add_plain(&mut self, code: &[u8], mut range: Range<u32>, before_throw: &mut u64) -> u32 {
        let [mut written, _, mut written_early] = self.written.map(|it| it.0[0]);
        let mut read_first = self.read_first.0[0];
        while range.start < range.end
            && let Some(effects) = PlainEffects::read(code, range.start)
        {
            read_first |= effects.read & !written;
            *before_throw &= u64::from(effects.can_throw).wrapping_sub(1);
            written |= effects.written;
            written_early |= effects.written & *before_throw;
            range.start += effects.size;
        }
        self.read_first.0[0] = read_first;
        for (stripe, bits) in self
            .written
            .iter_mut()
            .zip([written, written, written_early])
        {
            stripe.0[0] = bits;
        }
        range.start
    }
}

/// Solves for one stripe at a time, and visits only the blocks where something of it is live.
#[derive(Default)]
struct Solver<const N: usize> {
    /// The first is empty.
    summaries: Vec<Summary<N>>,
    /// An index into `summaries` for each stripe while it summarizes a block, for each block while it solves.
    summary_of: Vec<u32>,
    /// Indices into `summaries`.
    by_stripe: Vec<u32>,
    stripe_ends: Vec<u32>,
    live_in: Vec<Stripe<N>>,
    touched: Vec<u32>,
    pending: Vec<u64>,
}

impl<const N: usize> Solver<N> {
    fn summarize(
        &mut self,
        body: &Body,
        graph: &Graph,
        resumption: Resumption,
    ) -> Result<(), TooLarge> {
        let stripes = body.locals().div_ceil(64 * N as u32) as usize;
        refill(&mut self.summary_of, stripes, 0)?;
        refill(&mut self.summaries, 1, Summary::EMPTY)?;
        let (summaries, summary_of) = (&mut self.summaries, self.summary_of.as_mut_slice());
        let code = body.padded_instructions();
        for block in graph.blocks() {
            summaries.try_reserve(stripes).map_err(|_| TooLarge)?;
            let first = summaries.len() as u32;
            let mut index_for = |summaries: &mut Vec<Summary<N>>, stripe: usize| {
                if summary_of[stripe] < first {
                    summary_of[stripe] = summaries.len() as u32;
                    summaries.push(Summary {
                        stripe: stripe as u32,
                        block: block.0,
                        ..Summary::EMPTY
                    });
                }
                summary_of[stripe] as usize
            };
            let mut before_throw = u64::MAX;
            let Range { mut start, end } = graph.range(block);
            while start < end {
                if N == 1 {
                    let index = index_for(summaries, 0);
                    start = summaries[index].add_plain(code, start..end, &mut before_throw);
                    if start >= end {
                        break;
                    }
                }
                let instruction = &RawInstruction::read(code, start).expect("verified");
                start += u32::from(instruction.size);
                instruction.for_each_use_with(body, resumption, |run| {
                    for_each_word(run, |word, bits| {
                        let index = index_for(summaries, word / N);
                        let summary = &mut summaries[index];
                        // What is written on one way out only is written by the last instruction.
                        let written = summary.written[EdgeKind::Jump as usize].0[word % N];
                        summary.read_first.0[word % N] |= bits & !written;
                    });
                });
                if instruction.opcode.flow().can_throw() {
                    before_throw = 0;
                }
                instruction.for_each_def_with(body, resumption, |run, written| {
                    for_each_word(run, |word, bits| {
                        let index = index_for(summaries, word / N);
                        let [falling, jumping, throwing] = &mut summaries[index].written;
                        if written != Written::IfJumps {
                            falling.0[word % N] |= bits;
                        }
                        if written != Written::UnlessJumps {
                            jumping.0[word % N] |= bits;
                        }
                        if written == Written::Always {
                            throwing.0[word % N] |= bits & before_throw;
                        }
                    });
                });
            }
            if summaries.len() * N > MAX_WORDS / (1 + EDGE_KINDS) {
                return Err(TooLarge);
            }
        }

        refill(&mut self.stripe_ends, stripes + 1, 0)?;
        for summary in &summaries[1..] {
            self.stripe_ends[summary.stripe as usize + 1] += 1;
        }
        let mut start = 0;
        for count in &mut self.stripe_ends {
            start += *count;
            *count = start;
        }
        refill(&mut self.by_stripe, summaries.len() - 1, 0)?;
        for (index, summary) in (1..).zip(&summaries[1..]) {
            let at = &mut self.stripe_ends[summary.stripe as usize];
            self.by_stripe[*at as usize] = index;
            *at += 1;
        }
        self.stripe_ends.pop();
        Ok(())
    }

    /// Calls `visit` for each stripe in ascending order with the blocks at whose start something of it is live.
    fn solve(
        &mut self,
        body: &Body,
        graph: &Graph,
        resumption: Resumption,
        mut visit: impl FnMut(u32, &[u32], &[Stripe<N>]) -> Result<(), TooLarge>,
    ) -> Result<(), TooLarge> {
        self.summarize(body, graph, resumption)?;
        refill(&mut self.summary_of, graph.len(), 0)?;
        refill(&mut self.live_in, graph.len(), Stripe::EMPTY)?;
        refill(&mut self.pending, graph.len() / 64 + 1, 0)?;
        self.touched.clear();
        (self.touched.try_reserve(graph.len())).map_err(|_| TooLarge)?;
        let mut start = 0;
        for stripe in 0..self.stripe_ends.len() {
            let range = start..self.stripe_ends[stripe] as usize;
            start = range.end;
            self.touched.clear();
            for &index in &self.by_stripe[range.clone()] {
                let summary = &self.summaries[index as usize];
                self.summary_of[summary.block as usize] = index;
                if !summary.read_first.is_empty() {
                    self.live_in[summary.block as usize] = summary.read_first;
                    self.touched.push(summary.block);
                    self.pending[summary.block as usize / 64] |= 1 << (summary.block % 64);
                }
            }
            if !self.touched.is_empty() {
                self.propagate(graph);
                visit(stripe as u32, &self.touched, &self.live_in)?;
            }
            for &block in &self.touched {
                self.live_in[block as usize] = Stripe::EMPTY;
            }
            for &index in &self.by_stripe[range] {
                self.summary_of[self.summaries[index as usize].block as usize] = 0;
            }
        }
        Ok(())
    }

    /// From the end of the code to its start, and again for as long as loops lead back up.
    fn propagate(&mut self, graph: &Graph) {
        let (live_in, pending) = (self.live_in.as_mut_slice(), self.pending.as_mut_slice());
        let mut remaining = self.touched.len();
        let mut highest = pending.len() - 1;
        while remaining != 0 {
            let mut word = core::mem::take(&mut highest);
            while remaining != 0 {
                let Some(bit) = pending[word].highest_one() else {
                    if word == 0 {
                        break;
                    }
                    word -= 1;
                    continue;
                };
                pending[word] ^= 1 << bit;
                remaining -= 1;
                let block = word as u32 * 64 + bit;
                let live = live_in[block as usize];
                for edge in graph.predecessors(BlockIndex(block)) {
                    let from = edge.block.index();
                    let summary = &self.summaries[self.summary_of[from] as usize];
                    let known = live_in[from];
                    let new = (live.without(summary.written[edge.kind as usize])).without(known);
                    if new.is_empty() {
                        continue;
                    }
                    if known.is_empty() {
                        self.touched.push(from as u32);
                    }
                    live_in[from] = known.with(new);
                    let (pending, bit) = (&mut pending[from / 64], 1 << (from % 64));
                    remaining += usize::from(*pending & bit == 0);
                    *pending |= bit;
                    highest = highest.max(from / 64);
                }
            }
        }
    }
}

/// A set of locals.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Locals<'a>(&'a [u64]);

impl<'a> Locals<'a> {
    #[inline]
    pub fn contains(self, register: Register) -> bool {
        register.local_index().is_some_and(|local| {
            let word = self.0.get(local as usize / 64);
            word.is_some_and(|word| word >> (local % 64) & 1 != 0)
        })
    }

    pub fn is_empty(self) -> bool {
        self.0.iter().all(|&word| word == 0)
    }

    /// From local 0 on.
    pub fn iter(self) -> impl Iterator<Item = Register> + 'a {
        (0..).zip(self.0).flat_map(|(word, &bits)| {
            set_bits(bits).map(move |bit| Register::local(word * 64 + bit))
        })
    }

    /// Local `n` is bit `n % 64` of word `n / 64`.
    #[inline]
    pub fn words(self) -> &'a [u64] {
        self.0
    }
}

impl core::fmt::Debug for Locals<'_> {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter.debug_set().entries(self.iter()).finish()
    }
}

pub struct Liveness {
    graph: Graph,
    words: usize,
    live_in: Box<[u64]>,
}

/// Room for [`Liveness::walk_backwards`] to work in.
#[derive(Default)]
pub struct Walk {
    live: Vec<u64>,
    offsets: Vec<u32>,
}

impl Liveness {
    /// Of verified code.
    pub fn new(body: &Body) -> Result<Liveness, TooLarge> {
        let graph = Graph::new(body)?;
        if body.locals() <= 64 {
            Self::solve::<1>(body, graph)
        } else {
            Self::solve::<WIDE>(body, graph)
        }
    }

    fn solve<const N: usize>(body: &Body, graph: Graph) -> Result<Liveness, TooLarge> {
        let words = body.locals().div_ceil(64) as usize;
        let len = graph.len().saturating_mul(words);
        if len > MAX_WORDS {
            return Err(TooLarge);
        }
        let mut live_in = Vec::new();
        refill(&mut live_in, len, 0)?;
        let keep = |stripe: u32, blocks: &[u32], live: &[Stripe<N>]| {
            let first = stripe as usize * N;
            let count = N.min(words - first);
            for &block in blocks {
                let row = &mut live_in[block as usize * words + first..][..count];
                row.copy_from_slice(&live[block as usize].0[..count]);
            }
            Ok(())
        };
        Solver::default().solve(body, &graph, Resumption::Dispatched, keep)?;
        Ok(Liveness {
            graph,
            words,
            live_in: live_in.into(),
        })
    }

    #[inline]
    pub fn graph(&self) -> &Graph {
        &self.graph
    }

    #[inline]
    pub fn live_in(&self, block: BlockIndex) -> Locals<'_> {
        Locals(&self.live_in[block.index() * self.words..][..self.words])
    }

    /// Calls `visit` for each instruction of the block, the last first, with what is live before it.
    pub fn walk_backwards(
        &self,
        body: &Body,
        block: BlockIndex,
        walk: &mut Walk,
        visit: impl FnMut(u32, &RawInstruction, Locals<'_>),
    ) {
        self.walk_back_to(self.graph.range(block).start, body, walk, visit);
    }

    /// Takes time in proportion to the rest of the block.
    pub fn live_before<'a>(&self, body: &Body, offset: u32, walk: &'a mut Walk) -> Locals<'a> {
        self.walk_back_to(offset, body, walk, |_, _, _| {});
        Locals(&walk.live)
    }

    fn walk_back_to(
        &self,
        start: u32,
        body: &Body,
        walk: &mut Walk,
        mut visit: impl FnMut(u32, &RawInstruction, Locals<'_>),
    ) {
        let block = self.graph.block_at(start);
        let (code, end) = (body.padded_instructions(), self.graph.range(block).end);
        let Walk { live, offsets } = walk;
        offsets.clear();
        let mut offset = start;
        while offset < end {
            offsets.push(offset);
            offset += Opcode::read(code, offset).expect("verified").1;
        }
        live.clear();
        live.resize(self.words, 0);
        let handler = self.graph.handler(block);
        let mut is_last = true;
        for &offset in offsets.iter().rev() {
            let instruction = RawInstruction::read(code, offset).expect("verified");
            if core::mem::take(&mut is_last) {
                self.add_successors(body, block, &instruction, live);
            } else {
                instruction.for_each_def(body, |run, _| {
                    for_each_word(run, |word, bits| live[word] &= !bits);
                });
            }
            if let Some(handler) = handler
                && instruction.opcode.flow().can_throw()
            {
                self.add_live_in(handler, live);
            }
            instruction.for_each_use(body, |run| {
                for_each_word(run, |word, bits| live[word] |= bits);
            });
            visit(offset, &instruction, Locals(live));
        }
    }

    fn add_live_in(&self, block: BlockIndex, live: &mut [u64]) {
        for (live, &more) in live.iter_mut().zip(self.live_in(block).0) {
            *live |= more;
        }
    }

    /// What is live after the last instruction of the block and not written by it.
    fn add_successors(
        &self,
        body: &Body,
        block: BlockIndex,
        last: &RawInstruction,
        live: &mut [u64],
    ) {
        let edges = self.graph.successors(block).iter();
        let edges = edges.filter(|edge| edge.kind != EdgeKind::Throw);
        for edge in edges.clone() {
            self.add_live_in(edge.block, live);
        }
        last.for_each_def(body, |run, written| {
            for_each_word(run, |word, bits| {
                live[word] &= !bits;
                if written != Written::Always {
                    for edge in edges.clone().filter(|edge| !written.holds_on(edge.kind)) {
                        live[word] |= self.live_in(edge.block).0[word] & bits;
                    }
                }
            });
        });
    }
}

/// Whether each local is written on every way to where it is read or saved. Of code that is well formed.
pub(crate) fn is_written_first(body: &Body) -> Result<bool, TooLarge> {
    fn solve<const N: usize>(body: &Body) -> Result<bool, TooLarge> {
        let (graph, mut holds) = (Graph::new(body)?, true);
        Solver::<N>::default().solve(body, &graph, Resumption::Dispatched, |_, _, live_in| {
            holds &= live_in[0].is_empty();
            Ok(())
        })?;
        Ok(holds)
    }
    if body.locals() <= 64 {
        solve::<1>(body)
    } else {
        solve::<WIDE>(body)
    }
}

/// The locals of one word that a suspend point has to save.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Saved {
    point: u32,
    word: u32,
    bits: u64,
}

#[derive(Default)]
pub(crate) struct SavedRegisters {
    graph: Graph,
    solver: Solver<1>,
    saved: Vec<Saved>,
    registers: Vec<Register>,
}

fn find_saved<const N: usize>(
    body: &Body,
    graph: &Graph,
    solver: &mut Solver<N>,
    saved: &mut Vec<Saved>,
) -> Result<(), TooLarge> {
    solver.solve(body, graph, Resumption::Direct, |stripe, _, live_in| {
        (saved.try_reserve(N * body.suspend_points().len())).map_err(|_| TooLarge)?;
        for (point, state) in (0..).zip(body.suspend_points()) {
            let live = live_in[graph.block_at(state.resume).index()];
            for (word, live) in (stripe * N as u32..).zip(live.0) {
                // `enter` loads the scope of the callee on a resumption too.
                let bits = if word == 0 { live & !1 } else { live };
                if bits != 0 {
                    saved.push(Saved { point, word, bits });
                }
            }
        }
        (saved.len() <= MAX_WORDS).ok_or(TooLarge)
    })
}

impl SavedRegisters {
    pub(crate) fn fill_in(&mut self, body: &mut Body) -> Result<(), TooLarge> {
        let SavedRegisters {
            graph,
            solver,
            saved,
            registers,
        } = self;
        graph.build(body, Resumption::Direct)?;
        saved.clear();
        if body.locals() <= 64 {
            find_saved(body, graph, solver, saved)?;
        } else {
            find_saved::<WIDE>(body, graph, &mut Solver::default(), saved)?;
        }
        saved.sort_unstable();

        registers.clear();
        let tables = body.tables.as_mut().expect("has suspend points");
        (tables.suspend_points.iter_mut()).for_each(|point| point.registers = 0..0);
        let (mut previous, mut range): (&[Saved], _) = (&[], 0..0);
        for saved in saved.chunk_by(|a, b| a.point == b.point) {
            let locals = |saved: &Saved| (saved.word, saved.bits);
            if !saved.iter().map(locals).eq(previous.iter().map(locals)) {
                range.start = range.end;
                for &Saved { word, bits, .. } in saved {
                    if registers.len() > MAX_WORDS || registers.try_reserve(64).is_err() {
                        return Err(TooLarge);
                    }
                    registers.extend(set_bits(bits).map(|bit| Register::local(word * 64 + bit)));
                }
                range.end = registers.len() as u32;
                previous = saved;
            }
            tables.suspend_points[saved[0].point as usize].registers = range.clone();
        }
        tables.set_saved_registers(registers);
        Ok(())
    }
}
