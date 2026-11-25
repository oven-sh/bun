//! Decodes a block at several places at once. A lane that starts at any bit soon gets in step with the symbols, which shows
//! when the lane before it arrives.

mod codes;

use bun_highway::inflate::kind::{DISTANCE, END, LENGTH, LITERALS, MASK, STOP};
use bun_highway::inflate::{
    Cursor, LANES, Lane, ROW_GROUP, ROW_STEP, ROWS, Scratch, Segment, USABLE_ROWS, Usual,
};
use core::cell::Cell;
use core::hint::select_unpredictable;
use core::ops::Range;
use core::sync::atomic::{AtomicU64, Ordering};

use crate::format::END_OF_BLOCK;
use crate::{chunk_at, chunk_at_mut, copy_prefix, wrapped, wrapped_mut};
pub use bun_highway::inflate::Sheet;
pub use codes::Lengths;
use codes::{ONE_BYTE, Sorted, share_of_matches};

/// For a lane to go on by itself until it is in step with the next.
const SPARE_ROWS: usize = 40;
const MAX_ROWS: usize = (USABLE_ROWS - ROW_GROUP - SPARE_ROWS) / ROW_STEP * ROW_STEP;
const PLANNED_ROWS: usize = MAX_ROWS - 54;
const MIN_OVERLAP: usize = 5;
const MAX_OVERLAP: usize = 96;
/// How far lanes may read.
const PADDING: usize = 8 * MAX_ROWS + 16;
const TAIL_LEN: usize = 6 * 1024;
/// In bits: less is not worth it.
const MIN_BATCH: usize = 256;
const MIN_BLOCK: usize = 3200;
/// In bytes of input: too few to start over for.
pub const SHORT_TURN: usize = 1600;
/// Behind the symbol for the longest match.
const LONGEST_END: usize = 286;
/// Of `Block::rate`.
const UNIT: usize = 4;

/// At least 57 bits.
#[inline(always)]
fn word_at(input: &[u8], bit: usize) -> Option<u64> {
    chunk_at(input, bit / 8).map(|word| u64::from_le_bytes(*word) >> (bit % 8))
}

pub enum Symbol {
    /// Only the first byte counts. Alone it is stored from a high-byte register, which some Raptor Lake CPUs get wrong:
    /// https://github.com/trifectatechfoundation/zlib-rs/issues/306
    Literal([u8; 4]),
    EndOfBlock,
    Match {
        len: usize,
        distance: usize,
    },
}

/// A codeword that stands for nothing.
pub enum Unknown {
    Length,
    Distance,
}

/// What a stream knows of its block, and of those before.
pub struct Block {
    /// No other block has it.
    id: u64,
    /// In bits, like all lengths: where the input starts.
    origin: usize,
    expected_len: usize,
    likely_max: usize,
    decoded_len: usize,
    /// Bits in `UNIT` rows.
    rate: usize,
    /// Rows by which a lane goes past the start of the next.
    overlap: usize,
    /// In bytes, before another stream may have its turn.
    room: usize,
    /// In bytes of input.
    last_turn: usize,
    bits_in_byte: f32,
    /// Counts down the calls since another stream has had a turn.
    doubts: u8,
    short_block_end: usize,
    is_last: bool,
    /// Whether that has been the end of the input before.
    trusts_last: bool,
    /// By how many symbols guessing is behind.
    debt: isize,
    failures: u32,
    skipped_blocks: u32,
}

impl Default for Block {
    #[inline]
    fn default() -> Self {
        Self {
            id: 0,
            origin: 0,
            expected_len: usize::MAX,
            likely_max: usize::MAX,
            decoded_len: 0,
            rate: 0,
            overlap: MIN_OVERLAP,
            room: usize::MAX,
            last_turn: 0,
            bits_in_byte: 8.0,
            doubts: 1,
            short_block_end: 0,
            is_last: false,
            trusts_last: true,
            debt: 0,
            failures: 0,
            skipped_blocks: 0,
        }
    }
}

impl Block {
    /// The next input starts `len` bytes further on.
    #[inline]
    pub fn advance(&mut self, len: usize) {
        (self.origin, self.last_turn) = (self.origin.wrapping_add(8 * len), len);
    }

    /// So many more bytes are written with these `Lanes`, at most.
    #[inline]
    pub fn set_room(&mut self, room: usize) {
        self.room = room;
    }

    /// Whether it has had to start over of late.
    #[inline]
    pub fn takes_turns(&self) -> bool {
        self.doubts > 1
    }

    /// How far it pays to look ahead.
    #[inline(always)]
    fn horizon(&self) -> usize {
        match (self.doubts, u32::try_from(self.room)) {
            (1.., Ok(room)) => (room as f32 * self.bits_in_byte) as usize + 1500,
            _ => usize::MAX,
        }
    }

    #[inline(always)]
    fn likely_input_len(&self, input_len: usize) -> usize {
        let bits = self.expected_len.min(self.horizon());
        input_len.min(bits / 8).min(1 << 16)
    }

    /// And on the next ones, so many in all.
    #[inline]
    pub fn give_up(&mut self, blocks: u32) {
        self.skipped_blocks = blocks;
    }

    #[inline]
    pub fn is_given_up(&self) -> bool {
        self.skipped_blocks != 0
    }

    /// Two successes make up for one. From the second on it gives up, for longer and longer.
    #[cold]
    fn fail(&mut self, times: u32) {
        self.failures = (self.failures + 2 * times).min(24);
        if self.failures >= 4 {
            self.give_up(1 << (self.failures / 4));
        }
    }

    #[inline(always)]
    fn count(&mut self, bits: usize, bytes: usize) {
        self.room = self.room.saturating_sub(bytes);
        if bytes >= 1024 {
            self.bits_in_byte =
                (self.bits_in_byte + bits as u32 as f32 / bytes as u32 as f32) / 2.0;
            // The time goes into copying.
            if self.bits_in_byte < 0.15 {
                self.give_up(2);
            }
        }
    }

    #[inline(always)]
    fn start(&mut self, is_last: bool) -> Option<()> {
        static BLOCKS: AtomicU64 = AtomicU64::new(1);
        self.skipped_blocks = self.skipped_blocks.saturating_sub(1);
        if self.is_given_up() {
            return None;
        }
        self.id = BLOCKS.fetch_add(1, Ordering::Relaxed);
        (self.decoded_len, self.debt, self.is_last) = (0, 0, is_last);
        Some(())
    }
}

/// Tokens that have not been written out. Bits count from the start of the first input.
#[derive(Default)]
struct Batch {
    segments: [Segment; 8],
    ends: [usize; 8],
    left: Range<usize>,
    bit: usize,
    is_last: bool,
    is_good: bool,
    /// Each takes as long as a dozen tokens save.
    stops_left: isize,
}

struct Rest {
    lengths: Lengths,
    sorted: Sorted,
    tail: [u8; TAIL_LEN + PADDING],
    /// Zeros follow.
    tail_len: usize,
    has_few_matches: bool,
    batch: Batch,
    copy: Vec<u8>,
    usual: Option<Usual>,
    /// Of the block that all this is for.
    id: u64,
    static_rate: Option<usize>,
}

impl Default for Rest {
    fn default() -> Self {
        Self {
            lengths: Lengths::STATIC,
            sorted: Sorted::default(),
            tail: [0; _],
            tail_len: 0,
            has_few_matches: false,
            batch: Batch::default(),
            usual: None,
            copy: Vec::new(),
            id: 0,
            static_rate: None,
        }
    }
}

std::thread_local! {
    static SPARE: Cell<Option<Box<Scratch<Rest>>>> = const { Cell::new(None) };
}

pub(crate) fn free_spare() {
    _ = SPARE.try_with(Cell::take);
}

/// Memory that the streams of a thread take turns with.
#[derive(Default)]
pub struct Lanes {
    scratch: Option<Box<Scratch<Rest>>>,
}

impl Drop for Lanes {
    #[inline]
    fn drop(&mut self) {
        if self.scratch.is_some() {
            _ = SPARE.try_with(|spare| spare.set(self.scratch.take()));
        }
    }
}

impl Lanes {
    #[inline]
    fn scratch(&mut self) -> Option<&mut Scratch<Rest>> {
        if self.scratch.is_none() {
            self.scratch = SPARE.try_with(Cell::take).ok()?.or_else(Scratch::new);
        }
        self.scratch.as_deref_mut()
    }

    /// The header of a dynamic block starts at `bit`. Returns where it ends, unless something is wrong,
    /// missing or out of the ordinary. The lengths may not make a code if it has given up.
    pub fn start_dynamic(&mut self, block: &mut Block, input: &[u8], bit: usize) -> Option<usize> {
        let (is_last, bit) = (word_at(input, bit)? % 2 != 0, bit + 3);
        // What follows a short block tends to be short.
        let start = block.origin.wrapping_add(bit);
        if start < core::mem::replace(&mut block.short_block_end, start.wrapping_add(MIN_BLOCK)) {
            return None;
        }
        block.start(is_last)?;
        let scratch = self.scratch()?;
        (scratch.rest.id, scratch.rest.static_rate) = (0, None);
        let bit = scratch.with_cpu(
            #[inline(always)]
            |it| it.rest.sorted.read(&mut it.rest.lengths, input, bit),
        )?;
        let lengths = &scratch.rest.lengths;
        // The time goes into copying.
        if let (LONGEST_END, 1..=2) = (lengths.litlens.into(), lengths.of(LONGEST_END - 1)) {
            scratch.rest.id = block.id;
            block.give_up(4);
            return Some(bit);
        }
        // The rarest symbol.
        let symbols = 1 << lengths.of(END_OF_BLOCK);
        let was_likely =
            block.expected_len <= core::mem::replace(&mut block.likely_max, 32 * symbols);
        block.expected_len = match (is_last && block.trusts_last, was_likely) {
            (true, _) => usize::MAX,
            (_, true) if block.failures != 0 => block.expected_len.min(32 * symbols),
            (_, true) => block.expected_len.clamp(4 * symbols, 32 * symbols),
            _ => block.expected_len,
        };
        let input_len = input.len() - bit / 8;
        if block.doubts != 0 && block.room / 16 < input_len {
            block.bits_in_byte = 8.0 / ratio(scratch);
        }
        build(scratch, block, block.likely_input_len(input_len)).then_some(bit)
    }

    /// In the middle of a block, where `read` bytes have just stood for `written`, and `left` follow.
    #[inline]
    pub fn start_static(
        &mut self,
        block: &mut Block,
        is_last: bool,
        [read, written, left]: [usize; 3],
    ) -> bool {
        let expected_len = if is_last && block.trusts_last {
            usize::MAX
        } else {
            block.expected_len % usize::MAX
        };
        // It takes matches to get in step.
        if left < 1000
            || read < 128
            || 8 * written < 9 * read
            || written > 16 * read
            || read.max(expected_len / 8) < 1000
        {
            return false;
        }
        (block.expected_len, block.overlap) = (expected_len.max(16 * read), block.overlap.max(12));
        block.bits_in_byte = 8.0 * read as f32 / written as f32;
        block.horizon() >= 8 * SHORT_TURN
            && block.start(is_last).is_some()
            && self.resume(block, None, 0)
    }

    /// A little more than `input_len` bytes are likely to stand for, within reason. Right after `start_dynamic()`.
    pub fn likely_output_len(&mut self, input_len: usize) -> usize {
        let ratio = self.scratch.as_deref_mut().map_or(0.0, ratio);
        let likely = (input_len as f32 * ratio * 1.1) as usize;
        likely.min(input_len.saturating_mul(16).clamp(64 << 10, 32 << 20))
    }

    /// Those of `block`, unless another has had its turn.
    #[inline]
    pub fn lengths(&self, block: &Block) -> Option<&Lengths> {
        let rest = &self.scratch.as_deref()?.rest;
        (rest.id == block.id).then_some(&rest.lengths)
    }

    /// For a block that has been started with other `Lanes`. A static one has no `lengths`.
    pub fn resume(
        &mut self,
        block: &mut Block,
        lengths: Option<&Lengths>,
        input_len: usize,
    ) -> bool {
        let is_new = self.scratch.is_none() && block.decoded_len != 0;
        let Some(scratch) = self.scratch() else {
            return false;
        };
        let rest = &mut scratch.rest;
        if is_new {
            block.doubts = match rest.id == block.id {
                true => block.doubts.saturating_sub(1),
                false => 8,
            };
        }
        if rest.id == block.id {
            return true;
        }
        if is_new && block.last_turn.max(block.likely_input_len(input_len)) < SHORT_TURN {
            block.give_up(2);
            return false;
        }
        if let (None, Some(rate)) = (lengths, rest.static_rate.take()) {
            (rest.id, rest.batch.left, block.rate) = (block.id, 0..0, rate);
        } else {
            rest.lengths = *lengths.unwrap_or(&Lengths::STATIC);
            rest.sorted.fill_with(&rest.lengths);
            let input_len = lengths.map_or(usize::MAX, |_| block.likely_input_len(input_len));
            let rate = block.rate;
            if !build(scratch, block, input_len) {
                return false;
            }
            if is_new {
                block.rate = rate;
            }
        }
        scratch.rest.static_rate = lengths.is_none().then_some(block.rate);
        true
    }

    /// What `stream` starts with, and how many bits that takes.
    #[inline(never)]
    pub fn first_symbol(&self, stream: u64) -> (Result<Symbol, Unknown>, u32) {
        let scratch = self.scratch.as_deref();
        scratch.map_or((Err(Unknown::Length), 0), |it| first_symbol(it, stream))
    }

    /// Whole symbols from `bit` on, which it advances, and which wraps around in front of `input`. Whether the block has ended. If not, the end of `input` or `sheet` is near,
    /// or something wrong, or it has given up.
    pub fn decode(
        &mut self,
        block: &mut Block,
        input: &[u8],
        bit: &mut usize,
        sheet: &mut Sheet<'_>,
    ) -> bool {
        let Some(scratch) = self.scratch.as_deref_mut().filter(|_| !block.is_given_up()) else {
            return false;
        };
        if let Some(usual) = &scratch.rest.usual {
            let start = *bit;
            let has_ended = decode_usual(scratch, usual, block, input, bit, sheet);
            block.decoded_len += bit.wrapping_sub(start);
            if has_ended {
                (block.expected_len, block.failures) =
                    (block.decoded_len, block.failures.saturating_sub(1));
            }
            return has_ended;
        }
        scratch.with_cpu(
            #[inline(always)]
            |it| decode(it, block, input, bit, sheet),
        )
    }
}

impl Lanes {
    /// The same for the last bytes of `output`, from `written` on, which have none to spare.
    pub(crate) fn decode_last(
        &mut self,
        block: &mut Block,
        input: &[u8],
        bit: &mut usize,
        output: &mut [u8],
        written: &mut usize,
    ) -> bool {
        const REACH: usize = 32 * 1024;
        let (Some(scratch), Some((before, rest))) =
            (&mut self.scratch, output.split_at_mut_checked(*written))
        else {
            return false;
        };
        let (history, room) = (
            before.len().min(REACH),
            rest.len().min(1024) + Sheet::SPARE_LEN,
        );
        let mut copy = core::mem::take(&mut scratch.rest.copy);
        copy.clear();
        if copy
            .try_reserve_exact(REACH + 1024 + Sheet::SPARE_LEN)
            .is_err()
        {
            return false;
        }
        copy.extend_from_slice(before.split_at(before.len() - history).1);
        let has_ended = Sheet::behind(&mut copy, room, history, REACH, |it| {
            self.decode(block, input, bit, it)
        });
        *written += copy_prefix(rest, copy.get(history..).unwrap_or_default());
        if let Some(scratch) = &mut self.scratch {
            scratch.rest.copy = copy;
        }
        has_ended
    }
}

#[inline(always)]
fn first_symbol(
    Scratch { tables, rest, .. }: &Scratch<Rest>,
    stream: u64,
) -> (Result<Symbol, Unknown>, u32) {
    let mut cursor = Cursor::at(0);
    let mut next = |link: u32| {
        let mut entry = tables.look_up_one(stream >> cursor.bit, &mut cursor);
        if entry & !63 == link {
            entry = tables.look_up_one(stream >> cursor.bit, &mut cursor);
        }
        let (high, end) = (entry >> 16, cursor.bit as u32);
        let extra_bits = high.trailing_zeros().min(end);
        let extra = (stream >> (end - extra_bits)) & ((1 << extra_bits) - 1);
        let base = (high & high.wrapping_sub(1)) / 2;
        (entry, base as usize + extra as usize, end)
    };
    let (entry, number, bits) = next(LITERALS);
    let len = byte_count(entry);
    match entry & MASK {
        LITERALS => {
            let literals = (entry >> 16).to_le_bytes();
            (
                Ok(Symbol::Literal(literals)),
                rest.lengths.of(literals[0].into()),
            )
        }
        DISTANCE => (
            Ok(Symbol::Match {
                len,
                distance: number + 1,
            }),
            bits,
        ),
        LENGTH => match next(STOP) {
            (entry, _, bits) if entry & MASK == STOP => (Err(Unknown::Distance), bits),
            (_, distance, bits) => {
                let (len, distance) = (len + number, distance + 1);
                (Ok(Symbol::Match { len, distance }), bits)
            }
        },
        _ if entry & !63 == END => (Ok(Symbol::EndOfBlock), bits),
        _ => (Err(Unknown::Length), bits),
    }
}

/// Where lanes would take long to get in step.
#[inline(never)]
fn decode_usual(
    scratch: &Scratch<Rest>,
    usual: &Usual,
    block: &mut Block,
    input: &[u8],
    bit: &mut usize,
    sheet: &mut Sheet<'_>,
) -> bool {
    let (tables, mut may_fit) = (&scratch.tables, true);
    loop {
        block.debt = block.debt.max(-4096);
        if block.debt > 1024 {
            block.fail(2);
            return false;
        }
        may_fit = may_fit && tables.write_literals(usual, input, bit, sheet, &mut block.debt);
        if let Some(tail) = input.get(*bit / 8..).filter(|it| it.len() < 64 && may_fit) {
            let (mut padded, mut end, position) = ([0; 192], *bit % 8, sheet.position());
            copy_prefix(&mut padded, tail);
            may_fit = tables.write_literals(usual, &padded, &mut end, sheet, &mut block.debt)
                && end <= 8 * tail.len();
            match may_fit {
                true => *bit += end - *bit % 8,
                false => sheet.take_back(sheet.position() - position),
            }
        }
        let Some((Ok(symbol), used)) = word_at(input, *bit).map(|it| first_symbol(scratch, it))
        else {
            return false;
        };
        let is_written = match symbol {
            Symbol::Literal(literals) => sheet.push(literals[0]),
            Symbol::Match { len, distance } => sheet.copy(distance, len),
            Symbol::EndOfBlock => {
                *bit += used as usize;
                return true;
            }
        };
        if !is_written {
            return false;
        }
        *bit += used as usize;
    }
}

fn ratio(scratch: &mut Scratch<Rest>) -> f32 {
    scratch.with_cpu(
        #[inline(always)]
        |it| it.rest.sorted.ratio(&it.rest.lengths),
    )
}

fn build(scratch: &mut Scratch<Rest>, block: &mut Block, input_len: usize) -> bool {
    let Scratch {
        tables,
        tokens,
        rest,
    } = scratch;
    rest.usual = rest.sorted.usual(&rest.lengths);
    rest.has_few_matches = share_of_matches(&rest.lengths) < 500;
    let most = if rest.usual.is_some() {
        0
    } else {
        u32::MAX as usize
    };
    let input_len = input_len.min(most) as u32;
    let bits = rest.sorted.build(&rest.lengths, input_len, tokens, tables);
    block.rate = bits.map_or(0, |it| it.max(8) as usize);
    rest.id = bits.map_or(0, |_| block.id);
    rest.batch.left = 0..0;
    bits.is_some()
}

#[inline(always)]
fn byte_count(entry: u32) -> usize {
    (entry / ONE_BYTE) as usize % 256
}

#[inline(always)]
fn bit_count(entry: u32) -> usize {
    entry as usize % 64
}

#[inline(always)]
fn ends_symbol(entry: u32) -> bool {
    (entry & MASK != LENGTH) & (entry & !63 != LITERALS) & (entry & !63 != STOP)
}

#[inline(always)]
fn slot(columns: &mut [[u32; ROWS]; 2], token: usize) -> &mut u32 {
    let [column @ .., last] = wrapped_mut(columns, token);
    column.get_mut(token / 2).unwrap_or(last)
}

#[inline(always)]
fn entry_and_number(lane: &mut Lane, token: usize) -> (u32, usize) {
    let (entry, bits) = (
        *slot(&mut lane.entries, token),
        *slot(&mut lane.bits, token),
    );
    let (high, extra_bits) = (entry >> 16, (entry >> 16).trailing_zeros() % 16);
    let extra = bits.wrapping_shr(entry.wrapping_sub(extra_bits)) & ((1 << extra_bits) - 1);
    (entry, ((high & high.wrapping_sub(1)) / 2 + extra) as usize)
}

/// Of a token in a lane.
#[derive(Clone, Copy)]
struct Place {
    token: usize,
    bit: usize,
}

impl Place {
    /// Goes on to the token that has `bit`, if there is one before `end`. Whether a symbol starts there, and now a token too.
    #[inline(always)]
    fn seek(&mut self, lane: &mut Lane, bit: usize, end: usize, lengths: &Lengths) -> bool {
        while self.token < end {
            let entry = slot(&mut lane.entries, self.token);
            let next = self.bit.wrapping_add(bit_count(*entry));
            if (bit.wrapping_sub(next) as isize) < 0 {
                let skipped = bit.wrapping_sub(self.bit) as u32;
                let is_pair = *entry & 0xFFC0 == 2 * ONE_BYTE;
                let is_split = is_pair & (lengths.of((*entry >> 16) as usize % 256) == skipped);
                let second =
                    (*entry >> 24 << 16 | ONE_BYTE) + (*entry % 64).wrapping_sub(skipped) % 64;
                (*entry, self.bit) =
                    select_unpredictable(is_split, (second, bit), (*entry, self.bit));
                return self.bit == bit;
            }
            (self.token, self.bit) = (self.token + 1, next);
        }
        false
    }

    /// Back to where a symbol ends, at `limit` or before.
    #[inline(always)]
    fn trim(&mut self, lane: &mut Lane, limit: usize, start: usize) {
        while self.token > start
            && let entry = *slot(&mut lane.entries, self.token - 1)
            && (self.bit > limit || !ends_symbol(entry))
        {
            (self.token, self.bit) = (self.token - 1, self.bit.wrapping_sub(bit_count(entry)));
        }
    }
}

/// The row of `token`, in which what comes before does nothing.
#[inline(always)]
fn start_at(lane: &mut Lane, token: usize) -> usize {
    *slot(&mut lane.entries, token & !1) &= (token as u32 % 2).wrapping_sub(1);
    token / 2
}

#[inline(always)]
fn end_at(lane: &mut Lane, token: usize) -> usize {
    *slot(&mut lane.entries, token | 1) = 0;
    let row = token.div_ceil(2);
    for column in &mut lane.entries {
        if let Some(rows) = chunk_at_mut(column, row) {
            *rows = [0; ROW_GROUP];
        }
    }
    row
}

#[inline(always)]
fn lane_at(lanes: &mut [Lane; LANES], index: usize) -> &mut Lane {
    let [others @ .., last] = lanes;
    others.get_mut(index).unwrap_or(last)
}

#[inline(always)]
fn decode(
    scratch: &mut Scratch<Rest>,
    block: &mut Block,
    input: &[u8],
    bit: &mut usize,
    sheet: &mut Sheet<'_>,
) -> bool {
    let origin = block.origin;
    let batch = &mut scratch.rest.batch;
    batch.skip_to(
        scratch.tokens.lanes(),
        origin.wrapping_add(*bit),
        &scratch.rest.lengths,
    );
    if wrapped(&batch.ends, batch.left.end + 7).wrapping_sub(origin) > 8 * input.len() {
        batch.left = 0..0;
    }
    if block.decoded_len == 0 {
        sheet.prefetch();
    }
    loop {
        if sheet.room() == 0 {
            return false;
        }
        if scratch.rest.batch.left.is_empty()
            && !look_up(scratch, block, input, *bit, sheet.available() == 0)
        {
            return false;
        }
        let (batch, position) = (&mut scratch.rest.batch, sheet.position());
        if scratch.rest.has_few_matches {
            batch.write_literals(scratch.tokens.lanes(), sheet);
        }
        let segments = batch
            .segments
            .get(batch.left.start..batch.left.end)
            .unwrap_or_default();
        let written = scratch.tokens.write(segments, sheet);
        let lanes = scratch.tokens.lanes();
        if let Some(((lane, row), dropped)) = written.end {
            let too_many = batch.end_at(lanes, lane, row, dropped);
            block.expected_len = block.decoded_len.saturating_sub(too_many);
            if block.is_last {
                block.trusts_last = too_many < MIN_BATCH;
            }
            if too_many > block.expected_len {
                batch.is_good = false;
                block.fail(1);
            }
        }
        batch.stops_left -= written.stops as isize;
        if batch.stops_left < 0 && core::mem::take(&mut batch.is_good) {
            block.fail(2);
        }
        let Some((lane, token)) = written.next else {
            let end = wrapped(&batch.ends, batch.left.end + 7).wrapping_sub(origin);
            block.count(end.wrapping_sub(*bit), sheet.position() - position);
            *bit = end;
            batch.left = 0..0;
            block.failures = block
                .failures
                .saturating_sub(u32::from(batch.is_good) << u32::from(!batch.is_last));
            if batch.is_last || block.is_given_up() {
                return batch.is_last;
            }
            continue;
        };
        sheet.take_back(batch.go_on_at(lanes, lane, token));
        let end = batch.bit.wrapping_sub(origin);
        block.count(
            end.wrapping_sub(*bit),
            sheet.position().saturating_sub(position),
        );
        *bit = end;
        if sheet.position() == position || sheet.room() < 4096 || block.is_given_up() {
            return false;
        }
    }
}

impl Batch {
    /// And the odd match. Leaves the rest to the kernel.
    #[inline(always)]
    fn write_literals(&mut self, lanes: &mut [Lane; LANES], sheet: &mut Sheet<'_>) {
        let mut credit = 200;
        loop {
            let segment = wrapped_mut(&mut self.segments, self.left.start);
            let (lane, mut token) = (lane_at(lanes, segment.lane), 2 * segment.start);
            while token < 2 * segment.end && credit > 0 {
                let row = start_at(lane, token);
                let written = sheet.push_literals(lane, row..segment.end);
                (token, credit) = (token.max(2 * row + written), credit + written as isize);
                if token >= 2 * segment.end {
                    break;
                }
                let (entry, number) = entry_and_number(lane, token);
                let (last, len, distance, count) = match entry & MASK {
                    LENGTH => {
                        let (last, distance) = entry_and_number(lane, token + 1);
                        (last, byte_count(entry) + number, distance, 2)
                    }
                    _ => (entry, byte_count(entry), number, 1),
                };
                if last & MASK != DISTANCE || !sheet.copy(distance + 1, len) {
                    break;
                }
                (token, credit) = (token + count, credit - 24);
            }
            if token < 2 * segment.end || self.left.len() == 1 {
                token = token.min(2 * segment.end);
                if token > 2 * segment.start && !ends_symbol(*slot(&mut lane.entries, token - 1)) {
                    token -= 1;
                }
                segment.start = start_at(lane, token);
                return;
            }
            self.left.start += 1;
        }
    }

    /// Drops all unless `bit` is near.
    #[inline(always)]
    fn skip_to(&mut self, lanes: &mut [Lane; LANES], bit: usize, lengths: &Lengths) {
        if bit.wrapping_sub(self.bit) > 2048 {
            self.left = 0..0;
        }
        while self.bit != bit && !self.left.is_empty() {
            let segment = wrapped_mut(&mut self.segments, self.left.start);
            let (lane, token) = (lane_at(lanes, segment.lane), 2 * segment.start);
            let mut place = Place {
                token,
                bit: self.bit,
            };
            if place.seek(lane, bit, 2 * segment.end, lengths) {
                segment.start = start_at(lane, place.token);
            } else if place.token == 2 * segment.end {
                self.left.start += 1;
            } else {
                self.left = 0..0;
            }
            self.bit = place.bit;
        }
    }

    /// Returns how many bytes have been written of a match that is not finished.
    #[inline(always)]
    fn go_on_at(&mut self, lanes: &mut [Lane; LANES], index: usize, mut token: usize) -> usize {
        self.left.start = index;
        let (segment, lane) = (
            wrapped_mut(&mut self.segments, index),
            lane_at(lanes, index),
        );
        let mut begun = 0;
        while token > 2 * segment.start
            && let last = *slot(&mut lane.entries, token - 1)
            && !ends_symbol(last)
        {
            (token, begun) = (token - 1, begun + byte_count(last));
        }
        segment.start = start_at(lane, token);
        self.bit =
            wrapped(&self.ends, index).wrapping_sub(bits_in(lane, segment.start..segment.end));
        begun
    }

    /// With the block. Returns by how many bits it gets shorter.
    #[inline(always)]
    fn end_at(
        &mut self,
        lanes: &mut [Lane; LANES],
        index: usize,
        row: usize,
        dropped: usize,
    ) -> usize {
        let before = *wrapped(&self.ends, self.left.end + 7);
        let (segment, lane) = (
            wrapped_mut(&mut self.segments, index),
            lane_at(lanes, index),
        );
        let end = wrapped_mut(&mut self.ends, index);
        *end = end.wrapping_sub(dropped + bits_in(lane, row..segment.end));
        segment.end = end_at(lane, 2 * row.min(segment.end));
        (self.left.end, self.is_last) = (index + 1, true);
        before.wrapping_sub(*end)
    }
}

/// And in the zeros that follow.
#[inline(always)]
fn bits_in(lane: &Lane, rows: Range<usize>) -> usize {
    let mut sums = [0; ROW_GROUP];
    for row in rows.step_by(ROW_GROUP) {
        for group in lane
            .entries
            .iter()
            .filter_map(|it| chunk_at::<_, ROW_GROUP>(it, row))
        {
            sums = core::array::from_fn(|at| wrapped(&sums, at) + wrapped(group, at) % 64);
        }
    }
    sums.iter().sum::<u32>() as usize
}

/// Fills the batch from `start` on.
#[inline(always)]
fn look_up(
    scratch: &mut Scratch<Rest>,
    block: &mut Block,
    input: &[u8],
    start: usize,
    is_first: bool,
) -> bool {
    let Scratch {
        tables,
        tokens,
        rest,
    } = scratch;
    let (origin, start) = (start / 8, start % 8);
    let mut input = input.get(origin..).unwrap_or_default();
    let origin = block.origin.wrapping_add(8 * origin);
    let limit = 8 * input.len();
    if limit < MIN_BATCH {
        return false;
    }
    let expected = block.expected_len.saturating_add(block.expected_len / 32);
    let overdue = block.decoded_len.saturating_sub(block.expected_len);
    let wanted = expected.saturating_sub(block.decoded_len);
    let wanted = wanted
        .max(overdue + block.expected_len / 16 + MIN_BATCH)
        .min(block.horizon())
        .min(limit);
    let most = LANES * (PLANNED_ROWS - block.overlap) * block.rate / UNIT;
    let mut len = match wanted {
        _ if wanted <= most => wanted,
        _ if wanted <= 2 * most => wanted / 2,
        _ => most,
    };
    if len + 8 * PADDING > limit {
        if input.len() > TAIL_LEN {
            len = limit - 8 * PADDING;
        } else {
            let stale = input.len()..core::mem::replace(&mut rest.tail_len, input.len());
            rest.tail.get_mut(stale).unwrap_or_default().fill(0);
            copy_prefix(&mut rest.tail, input);
            input = &rest.tail;
        }
    }

    // In 256ths. At first there is little for matches, which take more bits.
    let shares = match is_first {
        true => [0, 45, 95, 147, 201, 256],
        false => [0, 51, 102, 154, 205, 256],
    };
    // The last lane overlaps with none.
    let overlap = (block.overlap * block.rate / UNIT).min(len / 2);
    let bounds = shares.map(|share| start + (len - overlap) * share / 256);
    let ([starts @ .., _], [_, ends @ ..]) = (bounds, bounds);
    let mut goals = ends.map(|end| end + overlap);
    if len != wanted {
        goals[LANES - 1] = start;
    }
    let mut cursors = starts.map(Cursor::at);
    let mut rows = 0;
    let mut more = (UNIT * (len + 4 * overlap)) as f32 / (block.rate as f32 * 5.3);
    while more > 0.0
        && let end = (rows + more as u16 as usize + 1)
            .next_multiple_of(ROW_STEP)
            .min(MAX_ROWS)
        && tables.look_up(input, &mut cursors, tokens, rows..end)
    {
        rows = end;
        let lanes = cursors.iter().zip(starts).zip(goals);
        let left = lanes.map(|((it, start), goal)| {
            (goal as i32 - it.bit as i32) as f32 / (it.bit - start) as i32 as f32
        });
        more = rows as f32 * left.fold(0.0, |max, it| if it > max { it } else { max });
    }
    if rows == 0 {
        return false;
    }
    let covered = cursors.iter().zip(starts).map(|(it, start)| it.bit - start);
    block.rate = (block.rate
        + ((UNIT * covered.sum::<usize>()) as u32 / (LANES * rows) as u32) as usize)
        .div_ceil(2);

    let batch = &mut rest.batch;
    (batch.bit, batch.is_last) = (origin.wrapping_add(start), false);
    // Back to where a symbol ends, in most cases.
    let mut lens = [2 * rows; LANES];
    for ((cursor, len), lane) in cursors
        .iter_mut()
        .zip(&mut lens)
        .zip(tokens.lanes())
        .take(LANES - 1)
    {
        let (last, before) = (
            *slot(&mut lane.entries, *len - 1),
            *slot(&mut lane.entries, *len - 2),
        );
        let (is_dropped, back) = (
            !ends_symbol(last) & ends_symbol(before),
            cursor.bit.wrapping_sub(bit_count(last)),
        );
        *cursor = select_unpredictable(is_dropped, Cursor::at(back), *cursor);
        *len -= usize::from(is_dropped);
    }
    let mut goals = ends;
    goals[LANES - 1] = limit;
    let mut beyond: [_; LANES] = core::array::from_fn(|lane| {
        let (cursor, goal) = (cursors.get(lane), goals.get(lane));
        cursor
            .zip(goal)
            .map_or(0, |(it, &goal)| it.bit.saturating_sub(goal))
    });
    beyond.rotate_right(1);
    let mut found = tokens.seek(rows, beyond).map(|it| it.map(usize::from));
    found.rotate_left(1);
    let (mut first, mut added, mut lanes) = (0, 0, &mut tokens.lanes()[..]);
    for (index, (((mut cursor, mut end), next_start), [count, bits])) in cursors
        .into_iter()
        .zip(lens)
        .zip(ends)
        .zip(found)
        .enumerate()
    {
        let Some(lane) = lanes.split_off_first_mut() else {
            break;
        };
        let mut next_first = None;
        if let Some(next) = lanes.first_mut() {
            let mut place = Place {
                token: count,
                bit: next_start + bits,
            };
            while cursor.bit <= limit {
                if ends_symbol(*slot(&mut lane.entries, end - 1))
                    && place.seek(next, cursor.bit, 2 * rows, &rest.lengths)
                    && (place.token == 0 || ends_symbol(*slot(&mut next.entries, place.token - 1)))
                {
                    next_first = Some(place.token);
                    break;
                }
                let Some(word) = word_at(input, cursor.bit) else {
                    break;
                };
                if end == 2 * (rows + SPARE_ROWS) || place.token == 2 * rows {
                    break;
                }
                *slot(&mut lane.bits, end) = word as u32;
                *slot(&mut lane.entries, end) = tables.look_up_one(word, &mut cursor);
                (end, added) = (end + 1, added + 1);
            }
        } else if end - count > first {
            (end, cursor.bit) = (end - count, cursor.bit - bits);
        }
        let mut end = Place {
            token: end,
            bit: cursor.bit,
        };
        end.trim(lane, limit, first);
        *wrapped_mut(&mut batch.segments, index) = Segment {
            lane: index,
            start: start_at(lane, first),
            end: end_at(lane, end.token),
        };
        *wrapped_mut(&mut batch.ends, index) = origin.wrapping_add(end.bit);
        batch.left = 0..index + 1;
        match next_first {
            Some(token) => first = token,
            None => break,
        }
    }

    let decoded = wrapped(&batch.ends, batch.left.end + 7).wrapping_sub(batch.bit);
    block.decoded_len += decoded;
    block.overlap = (block.overlap * 7 / 8 + added / 8).clamp(MIN_OVERLAP, MAX_OVERLAP);
    (batch.is_good, batch.stops_left) = (2 * decoded >= len, rows as isize);
    if !batch.is_good {
        block.fail(1);
    }
    decoded != 0
}
