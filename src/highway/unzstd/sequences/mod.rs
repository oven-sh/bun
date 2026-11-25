//! Groups of sequences go through three stages, which overlap: find their bits, work out their numbers, and copy.

mod tables;
cfg_select! {
    all(target_arch = "x86_64", not(miri)) => {
        #[path = "x86_64.rs"]
        mod kernel;
    }
    all(target_arch = "aarch64", not(miri)) => {
        #[path = "aarch64.rs"]
        mod kernel;
    }
    _ => {}
}

use core::hint::{Locality, cold_path, prefetch_write};
use core::mem::MaybeUninit;

use super::{Tape, load};
use tables::{
    FILLER, LITERAL_LENGTH, LONG_LEN, MATCH_LENGTH, OFFSET, REFILLED, extra_bits_and_prefix,
    next_state, state_bits,
};

pub use tables::{CODES_MAX, Codes, Tables};

const GROUP: usize = 8;
/// How far finding one goes back in the source.
const GROUP_BYTES_MAX: usize = GROUP * REFILLED as usize / 8;
/// How many bytes behind its end a copy may read and write.
pub const CHUNK: usize = 32;
const MIN_MATCH: u32 = 3;
const _: () = assert!(GROUP as u32 * (2 * LONG_LEN + MIN_MATCH) <= 1 << 16);
/// Matches that start further back are looked at one by one.
const REACH_MAX: usize = 1 << 30;

/// Where in [`Group::sums`] and [`Group::bits`].
const SLOTS: [usize; GROUP] = if cfg!(target_arch = "x86_64") {
    [0, 1, 4, 5, 2, 3, 6, 7]
} else {
    [0, 1, 2, 3, 4, 5, 6, 7]
};

#[repr(C, align(256))]
struct Group {
    /// Of the rows, within the budget.
    sums: [u64; GROUP],
    /// From the last that the sequence takes.
    bits: [u64; GROUP],
    /// From the start of the group: in the literals in the lower half, and in the output in the upper.
    ends: [u32; GROUP],
    /// Unless the sign is set, a chunk has the literals, and up to two from `sources` on, one by one, make the match.
    match_starts: [i32; GROUP],
    sources: [i32; GROUP],
    offsets: [u32; GROUP],
}

pub struct Sequence {
    pub literal_len: u32,
    pub match_len: u32,
    /// 0 is not valid.
    pub offset: u32,
}

impl Tape<'_> {
    /// At `position`, with the first of `literals`, if there is a quick way. `detached` is in front of the tape.
    #[inline]
    pub fn write(self, position: usize, it: &Sequence, literals: &[u8], detached: &[u8]) -> bool {
        let len = it.literal_len as usize + it.match_len as usize;
        if position > self.initialized
            || position + len > self.capacity
            || it.literal_len as usize + CHUNK > literals.len()
        {
            return false;
        }
        // SAFETY: see above.
        unsafe {
            let to = self.start.add(position);
            let is_done = if position + len + CHUNK > self.capacity {
                run_exactly(it, self.start, literals.as_ptr(), to)
            } else {
                copy_chunk(literals.as_ptr(), to);
                run_special(it, (detached, self.start), literals.as_ptr(), to)
            };
            if is_done {
                self.extend_to(position + len);
            }
            is_done
        }
    }
}

/// What the copies of one call go between.
struct Buffers<'a> {
    literals: *const u8,
    /// A chunk follows.
    literals_end: usize,
    /// The history in front of `out`.
    detached: &'a [u8],
    out: *mut u8,
    /// Up to where sequences may go, by how many chunks follow, unless it is 0.
    out_ends: [usize; 3],
}

/// The part of what is detached to which groups can refer without a closer look.
#[cfg(not(miri))]
#[repr(C)]
struct Reach {
    detached_len: i32,
    /// From the start of the tape to the end of what is detached.
    gap: i32,
}

#[cfg(not(miri))]
impl Reach {
    #[inline(always)]
    fn new(buffers: &Buffers<'_>) -> Self {
        let detached_end = buffers.detached.as_ptr_range().end.addr();
        let gap = detached_end.wrapping_sub(buffers.out.addr()) as isize;
        let is_near = buffers.out_ends[0].max(gap.unsigned_abs()) < REACH_MAX / 2;
        let detached_len = buffers.detached.len().min(REACH_MAX / 4) * usize::from(is_near);
        Self {
            detached_len: detached_len as i32,
            gap: gap as i32,
        }
    }

    /// How far back it goes from `position`.
    #[inline(always)]
    fn len_from(&self, position: usize) -> i32 {
        position.min(REACH_MAX) as i32 + self.detached_len
    }
}

/// The first stage.
#[derive(Clone, Copy)]
struct Finder {
    /// The rows of the states.
    rows: [*const u64; 3],
    /// 8 bytes of the source, of which `REFILLED + spare` bits are unread.
    word: u64,
    spare: u64,
    /// Where they are from. That may be in front of the source, but not for kernels.
    loaded: *const u8,
}

/// Reads them one by one.
#[repr(C, align(32))]
pub struct Reader<'a> {
    /// The offsets to repeat are in the upper half.
    repeats: [u32; GROUP],
    tables: [&'a Tables; 3],
    src: &'a [u8],
    states: [usize; 3],
    /// How many of `src` are unread.
    bits_left: isize,
    left: usize,
}

#[repr(C, align(512))]
pub struct Sequences<'a> {
    /// One runs, while its first half takes in what is found. The other waits.
    groups: [Group; 2],
    /// Behind those that were found.
    reader: Reader<'a>,
    /// Those that were read for states behind the last sequence.
    unused_bits: u32,
    running: usize,
    ran: usize,
    to_run: usize,
    waiting: usize,
    is_prepared: bool,
    found: usize,
    /// Where the group that runs starts.
    position: usize,
    literal_position: usize,
    /// What the `sources` were worked out for.
    addresses: [usize; 3],
}

#[inline(always)]
fn low_bits(value: u64, count: u32) -> u64 {
    /// Without BMI2, a load is cheaper than a shift.
    static MASKS: [u32; 256] = {
        let (mut masks, mut count) = ([0; _], 0);
        while count < 32 {
            masks[count] = (1 << count) - 1;
            count += 1;
        }
        masks
    };

    if cfg!(target_arch = "x86_64") {
        value & u64::from(MASKS[count as usize % 256])
    } else {
        value & !u64::MAX.wrapping_shl(count)
    }
}

/// `count` bits of `src` below bit `end`, which moves down.
#[inline(always)]
fn read_below(src: &[u8], end: &mut isize, count: u32) -> u32 {
    let word = load(src, (*end - REFILLED as isize) >> 3);
    let unread = REFILLED + *end as u32 % 8 - count;
    *end -= count as isize;
    low_bits(word >> unread, count) as u32
}

/// The offset that `value` stands for.
#[inline(always)]
fn resolve(repeats: &mut [u32; GROUP], value: u32, literal_len: u32) -> u32 {
    let [.., a, b, c, _] = repeats;
    if value > 3 {
        (*a, *b, *c) = (value - 3, *a, *b);
    } else {
        match value + u32::from(literal_len == 0) {
            1 => {}
            2 => (*a, *b) = (*b, *a),
            3 => (*a, *b, *c) = (*c, *a, *b),
            _ => (*a, *b, *c) = (a.saturating_sub(1), *a, *b),
        }
    }
    *a
}

/// By what four sequences repeat: their offsets and the next to repeat, as indices into four new ones and the last.
#[cfg(not(miri))]
static ORDERS: [[u8; GROUP]; 256] = {
    let (mut orders, mut index) = ([[0; GROUP]; _], 0);
    while index < orders.len() {
        let ([mut a, mut b, mut c], mut lane) = ([4, 5, 6], 0);
        while lane < 4 {
            [a, b, c] = match index >> (2 * lane) & 3 {
                0 => [lane as u8, a, b],
                1 => [a, b, c],
                2 => [b, a, c],
                _ => [c, a, b],
            };
            orders[index][lane] = a;
            lane += 1;
        }
        let [.., first, second, third, unused] = &mut orders[index];
        [*first, *second, *third, *unused] = [a, b, c, c];
        index += 1;
    }
    orders
};

/// By their length.
#[cfg(not(miri))]
#[repr(C)]
struct Periods {
    /// To fill a chunk.
    shuffles: [[u8; CHUNK]; 16],
    /// As many whole periods as it holds.
    strides: [u8; 16],
}

#[cfg(not(miri))]
impl Periods {
    const ALL: Self = {
        let (mut shuffles, mut strides, mut len) = ([[0; _]; _], [0; _], 1);
        while len < 16 {
            let mut index = 0;
            while index < CHUNK {
                shuffles[len][index] = (index % len) as u8;
                index += 1;
            }
            strides[len] = (CHUNK - CHUNK % len) as u8;
            len += 1;
        }
        Self { shuffles, strides }
    };
}

type Chunk = MaybeUninit<[u8; CHUNK]>;

/// SAFETY: a chunk can be read from one and written to the other.
#[inline(always)]
unsafe fn copy_chunk(from: *const u8, to: *mut u8) {
    // SAFETY: as the caller promises.
    unsafe { to.cast::<Chunk>().write(from.cast::<Chunk>().read()) }
}

/// SAFETY: the same for as many as it takes to get from `done` to `len`.
#[inline(always)]
unsafe fn copy_chunks(from: *const u8, to: *mut u8, mut done: usize, len: usize) {
    while done < len {
        // SAFETY: as the caller promises.
        unsafe { copy_chunk(from.add(done), to.add(done)) };
        prefetch_write(to.wrapping_add(done + 1024), Locality::L1);
        done += CHUNK;
    }
}

impl Group {
    const EMPTY: Self = Self {
        sums: [0; _],
        bits: [0; _],
        ends: [0; _],
        match_starts: [0; _],
        sources: [0; _],
        offsets: [0; _],
    };

    /// In the literals and in the output, behind so many sequences.
    #[inline(always)]
    fn ends_of(&self, count: usize) -> (usize, usize) {
        let ends = match count {
            0 => 0,
            _ => self.ends[(count - 1) % GROUP] as usize,
        };
        (ends & 0xFFFF, ends >> 16)
    }

    #[inline(always)]
    fn sequence(&self, index: usize) -> Sequence {
        let match_start = (self.match_starts[index] & i32::MAX) as u32;
        Sequence {
            literal_len: match_start - self.ends_of(index).1 as u32,
            match_len: self.ends_of(index + 1).1 as u32 - match_start,
            offset: self.offsets[index],
        }
    }

    /// The second stage, for a group that starts at `position`. The compiler vectorizes every other loop.
    #[cfg(any(target_arch = "x86_64", miri))]
    #[inline(always)]
    fn prepare(&mut self, repeats: &mut [u32; GROUP], position: usize, span: i32) {
        let [mut uppers, mut bits, mut literal_lens, mut match_lens] = [[0; GROUP]; _];
        for index in 0..GROUP {
            let sum = self.sums[SLOTS[index]];
            uppers[index] = (sum >> 32) as u32;
            bits[index] = self.bits[SLOTS[index]].wrapping_shr(state_bits(sum)) as u32;
        }
        // Not all vector units have a shift for each lane.
        let power = |log: i32| f32::from_bits(((127 + log) as u32) << 23);
        // SAFETY: the budget keeps all numbers within 31 bits.
        let int = |float: f32| unsafe { float.to_int_unchecked::<i32>() } as u32;
        let shifted = |value: u32, by: i32| int(value as i32 as f32 * power(by));
        for index in 0..GROUP {
            let take = |kind, bits: u32| {
                let (count, prefix) = extra_bits_and_prefix(uppers[index], kind);
                let count = count as i32;
                (
                    shifted(prefix, count) | bits & (shifted(1, count) - 1),
                    count,
                )
            };
            let (literal_len, taken) = take(LITERAL_LENGTH, bits[index]);
            let (match_len, more) = take(MATCH_LENGTH, shifted(bits[index] % (1 << 24), -taken));
            let part = |mask: u32| shifted(bits[index] & mask, -taken - more);
            self.offsets[index] = take(OFFSET, part(0x3FFF_FC00) | part(0x3FF)).0;
            (literal_lens[index], match_lens[index]) = (literal_len, match_len + MIN_MATCH);
            self.ends[index] = literal_len | (literal_len + match_len + MIN_MATCH) << 16;
        }
        let (mut ends, mut last) = (0, *repeats);
        for index in 0..GROUP {
            ends += self.ends[index];
            self.ends[index] = ends;
            self.offsets[index] = resolve(&mut last, self.offsets[index], literal_lens[index]);
        }
        *repeats = last;
        for index in 0..GROUP {
            let (match_len, offset) = (match_lens[index] as i32, self.offsets[index] as i32);
            let start = (self.ends[index] >> 16) as i32 - match_len;
            let negative_if_special = (CHUNK as i32 - literal_lens[index] as i32)
                | (span - match_len)
                | (offset - match_len.min(CHUNK as i32))
                | (start - offset + position.min(REACH_MAX) as i32);
            self.match_starts[index] = start | negative_if_special & i32::MIN;
            self.sources[index] = start - offset;
        }
    }

    /// With sequences that do nothing, behind so many.
    #[inline(always)]
    fn pad(&mut self, count: usize) {
        let ends = self.ends[(count - 1) % GROUP];
        for index in count..GROUP {
            self.ends[index] = ends;
            self.match_starts[index] = (ends >> 16) as i32;
            self.sources[index] = (ends >> 16) as i32;
        }
    }

    #[inline(always)]
    fn distrust_sources(&mut self) {
        self.match_starts.iter_mut().for_each(|it| *it |= i32::MIN);
    }

    /// The last stage. Returns whether it got the sequence done. SAFETY: it is prepared for `buffers`, in which the group starts at `literals` and `out`. All in front of the sequence is initialized. A chunk follows its end in the literals, and in the output. Two do there, unless it is special.
    #[inline(always)]
    unsafe fn run(
        &self,
        is_wide: bool,
        index: usize,
        buffers: &Buffers<'_>,
        literals: *const u8,
        out: *mut u8,
    ) -> bool {
        let (literal_start, start) = self.ends_of(index);
        // SAFETY: no chunk starts behind the end of the sequence but the second of the span.
        unsafe {
            let (literals, to) = (literals.wrapping_add(literal_start), out.add(start));
            copy_chunk(literals, to);
            let match_start = self.match_starts[index];
            if match_start < 0 {
                cold_path();
                return self.run_special(index, buffers, literals, to);
            }
            let mut from = out
                .wrapping_offset(self.sources[index] as isize)
                .cast_const();
            // Only kernels make it leave the tape.
            if !cfg!(miri) {
                from = core::ptr::with_exposed_provenance(from.addr());
            }
            let to = out.add(match_start as usize);
            copy_chunk(from, to);
            if is_wide {
                copy_chunk(from.add(CHUNK), to.add(CHUNK));
            }
        }
        true
    }

    /// SAFETY: as for the function of that name.
    #[inline(never)]
    unsafe fn run_special(
        &self,
        index: usize,
        to: &Buffers<'_>,
        literals: *const u8,
        out: *mut u8,
    ) -> bool {
        // SAFETY: as the caller promises.
        unsafe {
            run_special(
                &self.sequence(index % GROUP),
                (to.detached, to.out),
                literals,
                out,
            )
        }
    }
}

/// SAFETY: as for [`Group::run`], with where the sequence starts. The first chunk of literals has been copied.
#[inline(always)]
unsafe fn run_special(
    sequence: &Sequence,
    (detached, tape): (&[u8], *mut u8),
    literals: *const u8,
    out: *mut u8,
) -> bool {
    let (offset, len) = (sequence.offset as usize, sequence.match_len as usize);
    // SAFETY: the chunks start in front of the end of the sequence, or of the match in `detached`, which a chunk follows.
    unsafe {
        copy_chunks(literals, out, CHUNK, sequence.literal_len as usize);
        let to = out.add(sequence.literal_len as usize);
        let written = to.addr() - tape.addr();
        if offset.wrapping_sub(1) >= written {
            let distance = offset.wrapping_sub(written);
            if distance > detached.len() || distance < len + CHUNK {
                return false;
            }
            copy_chunks(detached.as_ptr_range().end.sub(distance), to, 0, len);
            return true;
        }
        if offset >= CHUNK {
            copy_chunks(to.sub(offset), to, 0, len);
        } else {
            if sequence.literal_len > CHUNK as u32 - 8 {
                to.cast::<u64>().write_unaligned(0);
            }
            repeat(offset, to, len);
        }
    }
    true
}

/// SAFETY: the same, but nothing has been copied, and nothing has to follow.
unsafe fn run_exactly(it: &Sequence, tape: *mut u8, literals: *const u8, out: *mut u8) -> bool {
    let (mut period, mut left) = (it.offset as usize, it.match_len as usize);
    // SAFETY: as the caller promises. The match starts on the tape.
    unsafe {
        out.copy_from_nonoverlapping(literals, it.literal_len as usize);
        let mut to = out.add(it.literal_len as usize);
        if period.wrapping_sub(1) >= to.addr() - tape.addr() {
            return false;
        }
        let from = to.sub(period);
        if period == 1 {
            to.write_bytes(*from, left);
            return true;
        }
        while period < left {
            to.copy_from_nonoverlapping(from, period);
            (to, left, period) = (to.add(period), left - period, 2 * period);
        }
        to.copy_from_nonoverlapping(from, left);
    }
    true
}

/// SAFETY: `period` bytes, which are less than a chunk, are in front of `to`, and 8 behind it. There is room for `len` and a chunk.
#[inline(always)]
unsafe fn repeat(period: usize, to: *mut u8, len: usize) {
    /// By period: a bit where each repetition starts in a word, and as many whole periods as that holds.
    const SHORT: [(u64, usize); 8] = {
        let (mut periods, mut len) = ([(0, 0); _], 1);
        while len < 8 {
            let mut start = 0;
            while start < 8 {
                periods[len].0 |= 1 << (8 * start);
                start += len;
            }
            periods[len].1 = 8 - 8 % len;
            len += 1;
        }
        periods
    };

    #[inline(always)]
    unsafe fn fill<T: Copy>(with: T, stride: usize, to: *mut u8, len: usize) {
        let mut done = 0;
        while done < len {
            // SAFETY: a chunk at most.
            unsafe { to.add(done).cast::<T>().write_unaligned(with) };
            done += stride;
        }
    }

    // SAFETY: as the caller promises.
    unsafe {
        let from = to.sub(period);
        if let Some(&(multiplier, stride)) = SHORT.get(period) {
            let word = u64::from_le_bytes(*from.cast()) & !(u64::MAX << (8 * period));
            fill(word.wrapping_mul(multiplier).to_le_bytes(), stride, to, len);
        } else {
            fill(from.cast::<Chunk>().read(), period, to, len);
        }
    }
}

impl Finder {
    #[inline(always)]
    fn index_in(&self, src: &[u8]) -> isize {
        self.loaded.addr().wrapping_sub(src.as_ptr().addr()) as isize
    }

    /// Returns whether it found the next sequence. `word` is to be loaded then. SAFETY: the rows are among those that are set in tables that start at `first_rows`.
    #[inline(always)]
    unsafe fn find(
        &mut self,
        first_rows: &[*const u64; 3],
        group: &mut Group,
        index: usize,
    ) -> bool {
        // SAFETY: rows lead to rows.
        unsafe {
            let rows = [*self.rows[0], *self.rows[1], *self.rows[2]];
            let sum = (self.spare + rows[OFFSET]).wrapping_add(rows[MATCH_LENGTH]);
            if (sum as i64) < (rows[LITERAL_LENGTH] as i64).wrapping_neg() {
                cold_path();
                return false;
            }
            let sum = sum.wrapping_add(rows[LITERAL_LENGTH]);
            let mut bits = self.word.wrapping_shr(sum as u32);
            (group.sums[SLOTS[index]], group.bits[SLOTS[index]]) = (sum, bits);
            let mut step = |kind: usize| {
                let (mut next, mut count) = (next_state(rows[kind]), state_bits(rows[kind]));
                // Loads are cheaper than shifts there.
                if cfg!(target_arch = "x86_64") {
                    next = next_state(
                        u64::from(self.rows[kind].cast::<u16>().add(1).read_volatile()) << 16,
                    );
                    count = self.rows[kind].cast::<u8>().add(1).read_volatile().into();
                }
                let next = first_rows[kind].add(next);
                self.rows[kind] = next.add(low_bits(bits, count) as usize);
                bits = bits.wrapping_shr(count);
            };
            step(OFFSET);
            step(MATCH_LENGTH);
            step(LITERAL_LENGTH);
            self.loaded = self.loaded.wrapping_sub(!sum as usize / 8 % 8);
            self.spare = sum % 8;
        }
        true
    }
}

impl<'a> Reader<'a> {
    /// `count` of them, in a stream that ends below bit `end` of `src`.
    #[inline(always)]
    pub fn new(
        tables: [&'a Tables; 3],
        (src, end): (&'a [u8], usize),
        count: usize,
        [first, second, third]: [u32; 3],
    ) -> Self {
        let mut bits_left = (end.min(8 * src.len()) as isize).min(8 * src.len() as isize - 1);
        let mut state = |kind: usize| read_below(src, &mut bits_left, tables[kind].log(kind));
        Self {
            repeats: [0, 0, 0, 0, first, second, third, 0],
            tables,
            src,
            states: [state(0) as usize, state(1) as usize, state(2) as usize],
            bits_left,
            left: count,
        }
    }

    pub fn repeats(&self) -> [u32; 3] {
        let [.., first, second, third, _] = self.repeats;
        [first, second, third]
    }

    /// How many bits of the source are unread. Negative once more were read than it has.
    pub fn bits_left(&self) -> isize {
        self.bits_left
    }

    #[inline(always)]
    fn first_rows(&self) -> [*const u64; 3] {
        let [a, b, c] = self.tables;
        [a.first_row(0), b.first_row(1), c.first_row(2)]
    }
}

impl Iterator for Reader<'_> {
    type Item = Sequence;

    fn next(&mut self) -> Option<Sequence> {
        self.left = self.left.checked_sub(1)?;
        let first_rows = self.first_rows();
        // SAFETY: the states are below the sizes of their tables.
        let row = |kind: usize| unsafe { *first_rows[kind].add(self.states[kind]) };
        let rows = [row(0), row(1), row(2)];
        let mut read = |count| read_below(self.src, &mut self.bits_left, count);
        let mut number = |kind: usize| {
            let (count, prefix) = extra_bits_and_prefix((rows[kind] >> 32) as u32, kind);
            prefix << count | read(count)
        };
        let (value, match_len) = (number(OFFSET), number(MATCH_LENGTH) + MIN_MATCH);
        let literal_len = number(LITERAL_LENGTH);
        if self.left != 0 {
            for kind in [LITERAL_LENGTH, MATCH_LENGTH, OFFSET] {
                self.states[kind] = next_state(rows[kind]) + read(state_bits(rows[kind])) as usize;
            }
        }
        Some(Sequence {
            literal_len,
            match_len,
            offset: resolve(&mut self.repeats, value, literal_len),
        })
    }
}

impl<'a> Sequences<'a> {
    /// The first starts at `position` of the tape.
    #[inline(always)]
    pub fn new(reader: Reader<'a>, position: usize) -> Self {
        Self {
            groups: [Group::EMPTY; _],
            reader,
            unused_bits: 0,
            running: 0,
            ran: 0,
            to_run: 0,
            waiting: 0,
            is_prepared: false,
            found: 0,
            position,
            literal_position: 0,
            addresses: [0; _],
        }
    }

    /// Once all are through.
    #[inline(always)]
    pub fn into_reader(mut self) -> Reader<'a> {
        self.reader.bits_left += self.unused_bits as isize;
        self.reader
    }

    /// Where the next starts, in the literals and on the tape.
    #[inline]
    pub fn positions(&self) -> (usize, usize) {
        let (literal_end, end) = self.groups[self.running % 2].ends_of(self.ran);
        (self.literal_position + literal_end, self.position + end)
    }

    #[inline]
    pub fn unread(&self) -> usize {
        self.reader.left
    }

    /// Whether all that were read are through.
    #[inline]
    pub fn is_idle(&self) -> bool {
        self.to_run + self.waiting + self.found == 0
    }

    /// The one at which [`run`](Self::run) stopped, for the caller to run.
    #[inline]
    pub fn take(&mut self) -> Option<Sequence> {
        if self.ran < self.to_run {
            self.ran += 1;
            return Some(self.groups[self.running % 2].sequence(self.ran - 1));
        }
        if !self.is_idle() {
            return None;
        }
        let sequence = self.reader.next()?;
        self.position += (sequence.literal_len + sequence.match_len) as usize;
        self.literal_position += sequence.literal_len as usize;
        Some(sequence)
    }

    /// Up to one that has no quick way, or passes `end` or the last chunk of `literals`, which lack the first `skipped`.
    #[inline]
    pub fn run(
        &mut self,
        (literals, skipped): (&[u8], usize),
        detached: &[u8],
        tape: Tape<'_>,
        end: usize,
    ) {
        let (literal_position, position) = self.positions();
        let [a, b, c] = self.reader.tables;
        if literals.len() < CHUNK
            || skipped > literal_position
            || tape.initialized < position
            || !(a.is_settled(0) && b.is_settled(1) && c.is_settled(2))
        {
            return;
        }
        let end = end.clamp(position, position + REACH_MAX / 4);
        let end = |chunks| end.min(tape.capacity.saturating_sub(chunks * CHUNK));
        let buffers = Buffers {
            literals: literals.as_ptr().wrapping_sub(skipped),
            literals_end: skipped + literals.len() - CHUNK,
            detached,
            out: tape.start,
            out_ends: [end(0), end(1), end(2)],
        };
        if self.ran < self.to_run && !self.fit(self.ran + 1, &buffers, 0) {
            return;
        }
        let addresses = [
            tape.start.expose_provenance(),
            detached.as_ptr().expose_provenance(),
            detached.len(),
        ];
        if core::mem::replace(&mut self.addresses, addresses) != addresses {
            self.groups.iter_mut().for_each(Group::distrust_sources);
        }
        cfg_select! {
            miri => self.run_portably(&buffers),
            _ => kernel::run(self, &buffers),
        };
        // SAFETY: the sequences have written all up to there, from what is initialized.
        unsafe { tape.extend_to(self.positions().1) };
    }

    #[cfg(any(target_arch = "x86_64", miri))]
    #[inline(always)]
    fn run_portably(&mut self, buffers: &Buffers<'_>) {
        self.run_with(
            buffers,
            |this, _, _| this.found,
            Self::prepare,
            #[inline(always)]
            |this, finder| this.overlap(buffers, finder),
        );
    }

    /// With a kernel that stopped `at` addresses in a group, the literals and the output, where that group starts.
    #[cfg(not(miri))]
    #[inline(always)]
    fn catch_up(
        &mut self,
        buffers: &Buffers<'_>,
        finder: &mut Finder,
        found_and_ran: usize,
        left: usize,
        [group, literals, out]: [usize; 3],
    ) {
        (self.found, self.ran) = (found_and_ran % 256, found_and_ran / 256);
        finder.loaded = finder.loaded.wrapping_add(self.found);
        self.reader.left = left;
        self.running = group / size_of::<Group>() % 2;
        self.literal_position = literals.wrapping_sub(buffers.literals.addr());
        self.position = out - buffers.out.addr();
    }

    /// Whether matches that are not special take two chunks.
    #[inline(always)]
    fn is_wide(&self) -> bool {
        self.reader.tables[MATCH_LENGTH].has_long_matches
    }

    #[inline(always)]
    fn span(&self) -> usize {
        CHUNK << u32::from(self.is_wide())
    }

    #[inline(always)]
    fn is_far(&self) -> bool {
        self.reader.tables[OFFSET].has_far_matches
    }

    /// Where the group that waits starts.
    #[inline(always)]
    fn waiting_position(&self) -> usize {
        self.position + self.groups[self.running % 2].ends_of(self.to_run).1
    }

    /// Whether the first `count` of the group that runs are within `buffers`, with so many chunks behind them.
    #[inline(always)]
    fn fit(&self, count: usize, buffers: &Buffers<'_>, chunks: usize) -> bool {
        let (literal_end, end) = self.groups[self.running % 2].ends_of(count);
        self.literal_position + literal_end <= buffers.literals_end
            && self.position + end <= buffers.out_ends[chunks]
    }

    #[inline(always)]
    fn move_on(&mut self) {
        (self.literal_position, self.position) = self.positions();
        (self.ran, self.to_run, self.waiting, self.found) = (0, self.waiting, self.found, 0);
        self.is_prepared = false;
        self.running ^= 1;
    }

    /// `find` returns how many the group has then. `overlap` is for when a full group waits, and neither was touched.
    #[inline(always)]
    fn run_with(
        &mut self,
        buffers: &Buffers<'_>,
        find: impl Fn(&mut Self, &mut Finder, usize) -> usize,
        prepare: impl Fn(&mut Self),
        overlap: impl Fn(&mut Self, &mut Finder),
    ) {
        let (first_rows, src) = (self.reader.first_rows(), self.reader.src.as_ptr());
        let row = |kind: usize| first_rows[kind].wrapping_add(self.reader.states[kind]);
        let start = (self.reader.bits_left - REFILLED as isize) >> 3;
        let mut finder = Finder {
            rows: [row(0), row(1), row(2)],
            word: load(self.reader.src, start),
            loaded: src.wrapping_offset(start),
            spare: self.reader.bits_left as u64 % 8,
        };
        let can_find = self.reader.repeats.iter().all(|&it| it as i32 >= 0);
        loop {
            if can_find {
                self.find(&mut finder, &find);
            }
            if !self.is_prepared && self.waiting != 0 {
                self.prepare_with(&prepare);
            }
            if !self.run_rest(buffers) {
                break;
            }
            self.move_on();
            if self.to_run + self.waiting == 0 {
                break;
            }
            if (self.to_run != 0 && self.waiting == GROUP && self.reader.left >= GROUP)
                && finder.index_in(self.reader.src) >= 0
            {
                let position = self.position;
                overlap(self, &mut finder);
                self.reader.left -= self.found;
                if self.position != position {
                    self.to_run = GROUP;
                }
                self.ran = self.ran.min(self.to_run);
            }
        }
        let state = |kind: usize| (finder.rows[kind].addr() - first_rows[kind].addr()) / 8;
        self.reader.states = [state(0), state(1), state(2)];
        self.reader.bits_left =
            8 * finder.index_in(self.reader.src) + (REFILLED as u64 + finder.spare) as isize;
    }

    /// So many that the rest makes whole groups.
    #[inline(always)]
    fn find(&mut self, finder: &mut Finder, some: impl Fn(&mut Self, &mut Finder, usize) -> usize) {
        let (first_rows, src, start) = (self.reader.first_rows(), self.reader.src, self.found);
        let end = match start {
            0 => self.reader.left.wrapping_sub(1) % GROUP + 1,
            _ => GROUP,
        };
        let end = end.min(start + self.reader.left);
        let mut found = match finder.index_in(src) {
            0.. => some(self, finder, end),
            _ => start,
        };
        let group = &mut self.groups[self.running % 2];
        // SAFETY: the states were below the sizes of their tables.
        while found < end && unsafe { finder.find(&first_rows, group, found % GROUP) } {
            finder.word = load(src, finder.index_in(src));
            found += 1;
        }
        (self.found, self.reader.left) = (found, self.reader.left - (found - start));
    }

    #[inline(always)]
    fn prepare_with(&mut self, prepare: impl Fn(&mut Self)) {
        let count = self.waiting;
        if self.reader.left + self.found == 0 {
            let last = self.groups[!self.running % 2].sums[SLOTS[(count - 1) % GROUP]];
            self.unused_bits = state_bits(last);
        }
        for &slot in SLOTS.iter().skip(count) {
            self.groups[!self.running % 2].sums[slot] = FILLER;
        }
        prepare(self);
        self.groups[!self.running % 2].pad(count);
        self.is_prepared = true;
    }

    #[cfg(any(target_arch = "x86_64", miri))]
    #[inline(always)]
    fn prepare(&mut self) {
        let (position, span) = (self.waiting_position(), self.span());
        self.groups[!self.running % 2].prepare(&mut self.reader.repeats, position, span as i32);
    }

    /// Returns whether it got through the group that runs.
    #[inline(always)]
    fn run_rest(&mut self, buffers: &Buffers<'_>) -> bool {
        let from = buffers.literals.wrapping_add(self.literal_position);
        let to = buffers.out.wrapping_add(self.position);
        let (mut ran, mut end, is_wide) = (self.ran, self.to_run, self.is_wide());
        if !self.fit(end, buffers, 2) {
            self.groups[self.running % 2].distrust_sources();
            while end > ran && !self.fit(end, buffers, 1) {
                end -= 1;
            }
        }
        let group = &self.groups[self.running % 2];
        // SAFETY: it fits, and those before it were run here, or `run()` saw that they were.
        while ran < end && unsafe { group.run(is_wide, ran % GROUP, buffers, from, to) } {
            ran += 1;
        }
        while (end..self.to_run).contains(&ran) && self.fit(ran + 1, buffers, 0) {
            let (it, (literal_start, start)) = (group.sequence(ran % GROUP), group.ends_of(ran));
            let from = from.wrapping_add(literal_start);
            // SAFETY: the same.
            if !unsafe { run_exactly(&it, buffers.out, from, to.add(start)) } {
                break;
            }
            ran += 1;
        }
        self.ran = ran;
        ran == self.to_run
    }

    /// All stages at once.
    #[cfg(any(target_arch = "x86_64", miri))]
    #[inline(always)]
    fn overlap(&mut self, buffers: &Buffers<'_>, finder: &mut Finder) {
        let (first_rows, is_wide, is_far) =
            (self.reader.first_rows(), self.is_wide(), self.is_far());
        while self.reader.left >= GROUP
            && finder.index_in(self.reader.src) >= GROUP_BYTES_MAX as isize
            && self.fit(GROUP, buffers, 2)
        {
            self.prepare();
            self.is_prepared = true;
            let next = buffers.out.wrapping_add(self.waiting_position());
            for line in 0..3 {
                prefetch_write(next.wrapping_add(1024 - 64 * line), Locality::L1);
            }
            if is_far {
                for source in self.groups[!self.running % 2].sources {
                    core::hint::prefetch_read(next.wrapping_offset(source as isize), Locality::L1);
                }
            }
            let from = buffers.literals.wrapping_add(self.literal_position);
            let to = buffers.out.wrapping_add(self.position);
            let group = &mut self.groups[self.running % 2];
            macro_rules! steps {
                ($($index:literal)*) => {$(
                    // SAFETY: as in `run_with()`.
                    if !unsafe { finder.find(&first_rows, group, $index) } {
                        (self.found, self.ran) = ($index, $index);
                        break;
                    }
                    // SAFETY: it started 8 bytes in front of the end of the source or more, and is not in front of it.
                    finder.word = u64::from_le_bytes(unsafe { *finder.loaded.cast() });
                    // SAFETY: the same.
                    if !unsafe { group.run(is_wide, $index, buffers, from, to) } {
                        (self.found, self.ran) = ($index + 1, $index);
                        break;
                    }
                )*};
            }
            steps!(0 1 2 3 4 5 6 7);
            (self.found, self.ran, self.reader.left) = (GROUP, GROUP, self.reader.left - GROUP);
            self.move_on();
        }
    }
}
