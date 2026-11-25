//! The kernels that decode several parts of a DEFLATE block at once, from src/jsc/bindings/highway_inflate.cpp.
//! They stay within their memory whatever is in the tables and in the tokens.

use core::array::from_fn;
use core::hint::{Locality, prefetch_write};
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ops::Range;

use crate::zlib::{MATCH_SPAN, copy_cells};

/// `kLanes` and so on in highway_inflate.cpp.
pub const LANES: usize = 5;
pub const ROWS: usize = 432;
const STAGE_LEN: usize = 256;
const COPIED: usize = 32;
const REACH: usize = 1 << 15;
/// So that adding 16 tokens does not overflow.
const MAX_ROOM: usize = 24_000;

const MAX_ROOT_BITS: u32 = 12;
const ENTRIES: usize = 4 << MAX_ROOT_BITS;
/// In none of the tables, so that it links to the root.
const NO_INDEX: usize = ENTRIES / 2;

/// So many rows behind the end of a segment may be written out too.
pub const ROW_GROUP: usize = 8;
/// Of what is looked up at once.
pub const ROW_STEP: usize = 3;
/// A group that does nothing and one that stops follow, and a row for `SkipLinks()` to look at.
pub const USABLE_ROWS: usize = ROWS - 3 * ROW_GROUP;

/// From the lowest bit on, an entry has how many bits of the stream it stands for (6 bits), its kind (2), how many bytes it
/// writes (8), and those bytes or a number (16). That is `2 * base + range`, and the last bits pick one of `range`.
pub mod kind {
    pub const MASK: u32 = 0xC0;
    /// Without any, it links to the table for long codes.
    pub const LITERALS: u32 = 0;
    /// Less one.
    pub const DISTANCE: u32 = 0x40;
    /// Of what the next token writes as well. It links to the distances.
    pub const LENGTH: u32 = 0x80;
    /// With nothing else, it links to the long distance codes.
    pub const STOP: u32 = 0xC0;
    pub const END: u32 = STOP | 1 << 8;
}

#[repr(C)]
struct RawLanes {
    bits: [u64; LANES],
    indices: [u64; LANES],
    inputs: [*const u8; LANES],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct RawSegment {
    start: *mut u32,
    end: *const u32,
}

#[repr(C)]
struct RawSheet {
    out: *mut u8,
    limit: i32,
    stage: i32,
    first: i32,
    max_distance: i32,
    offset: i32,
    lap: i32,
    written: i32,
    token: i32,
    row: *const u32,
    last: *const u32,
    dropped: usize,
    stops: usize,
}

unsafe extern "C" {
    safe fn highway_inflate_is_supported() -> bool;
    fn highway_inflate_build(
        litlens: &Litlens,
        distances: &Distances,
        input_len: u32,
        shortest_length: u32,
        draft: &mut Tokens,
        tables: &mut Tables,
    ) -> u32;
    fn highway_inflate_look_up(
        entries: *const u32,
        root_bits: u32,
        lanes: &mut RawLanes,
        to: *mut u32,
        rows: usize,
    );
    fn highway_inflate_guess(
        tables: &Tables,
        root_bits: u32,
        usual: &Usual,
        input: *const u8,
        bit: &mut usize,
        to: *mut u8,
        turns: &mut usize,
    ) -> *mut u8;
    fn highway_inflate_seek(
        tokens: &Tokens,
        rows: usize,
        targets: &[u16; LANES],
        found: &mut [[u16; 2]; LANES],
    );
    fn highway_inflate_literals(row: *const u32, groups: usize, to: &mut *mut u8) -> usize;
    fn highway_inflate_write(segments: *const RawSegment, sheet: &mut RawSheet);
}

/// Where a lane goes on.
#[derive(Clone, Copy)]
pub struct Cursor {
    pub bit: usize,
    /// Of the last entry, below `ENTRIES`.
    index: usize,
}

impl Cursor {
    /// At the start of a symbol.
    #[inline(always)]
    pub fn at(bit: usize) -> Self {
        let index = NO_INDEX;
        Self { bit, index }
    }
}

/// Rows of a lane.
#[derive(Clone, Copy, Default)]
pub struct Segment {
    pub lane: usize,
    pub start: usize,
    pub end: usize,
}

/// Two tokens in each row: entries, and the bits that they were found with.
#[repr(C)]
pub struct Lane {
    pub entries: [[u32; ROWS]; 2],
    pub bits: [[u32; ROWS]; 2],
}

/// For each length, the entries of the symbols that have a codeword of it, without its bits.
#[repr(C)]
pub struct Lists<const N: usize> {
    pub entries: [[u32; N]; 16],
    /// From the start of the first.
    pub ends: [u16; 16],
}

impl<const N: usize> Lists<N> {
    #[inline(always)]
    pub fn counts(&self) -> [u16; 16] {
        from_fn(|len| self.ends[len].wrapping_sub((N * len) as u16))
    }
}

pub type Litlens = Lists<{ 288 + 16 }>;
pub type Distances = Lists<{ 32 + 16 }>;

/// Literals whose codewords have the same length.
#[repr(C, align(16))]
pub struct Usual {
    literals: [u8; 256],
    /// For each bit that 8 codewords may start at, which two bytes each is in, and what moves it to their top.
    bytes: [[u16; 8]; 8],
    factors: [[u16; 8]; 8],
    len: u8,
    first: u8,
    last: u8,
}

impl Usual {
    /// Those up to `last` have the codewords from `first` on, of 1 to 8 bits.
    pub fn new(literals: &[u8; 256], last: u8, first: u8, len: u8) -> Self {
        let len = len.clamp(1, 8);
        let starts: [[_; 8]; 8] = from_fn(|bit| from_fn(|at| (bit + at * usize::from(len)) as u16));
        Self {
            literals: *literals,
            bytes: starts.map(|it| it.map(|start| start / 8 * 0x101 + 0x100)),
            factors: starts.map(|it| it.map(|start| 1 << (16 - len) >> (start % 8))),
            len,
            first,
            last,
        }
    }
}

/// The root, and the tables for long codes, distances and long distance codes.
#[repr(C, align(64))]
pub struct Tables {
    entries: [u32; ENTRIES],
    /// At most `MAX_ROOT_BITS`, the first. The others keep entries and links apart in the cache.
    root_bits: [u32; 512],
    /// For each entry, where the next table starts, which has all bits set that do not index it. Below `ENTRIES`.
    links: [u16; ENTRIES],
}

/// Only where the CPU is up to the kernels.
#[repr(C)]
pub struct Scratch<T> {
    pub tables: Tables,
    pub tokens: Tokens,
    pub rest: T,
}

#[repr(C, align(64))]
pub struct Tokens([Lane; LANES]);

impl<T: Default> Scratch<T> {
    pub fn new() -> Option<Box<Self>> {
        #[cfg(all(target_arch = "x86_64", not(miri)))]
        if !is_x86_feature_detected!("avx2")
            || !is_x86_feature_detected!("bmi1")
            || !is_x86_feature_detected!("bmi2")
            || !is_x86_feature_detected!("lzcnt")
        {
            return None;
        }
        if !highway_inflate_is_supported() {
            return None;
        }
        let mut scratch = Box::<Self>::try_new_zeroed().ok()?;
        // SAFETY: all else is numbers.
        unsafe {
            (&raw mut (*scratch.as_mut_ptr()).rest).write(T::default());
            Some(scratch.assume_init())
        }
    }
}

#[cfg_attr(
    all(target_arch = "x86_64", not(miri)),
    target_feature(enable = "avx2,bmi1,bmi2,lzcnt")
)]
#[inline(never)]
unsafe fn avx2<T, R>(it: &mut T, run: impl FnOnce(&mut T) -> R) -> R {
    run(it)
}

impl<T> Scratch<T> {
    /// Compiles `run` for such a CPU. It and what it calls have to be `#[inline(always)]`.
    #[inline(always)]
    pub fn with_cpu<R>(&mut self, run: impl FnOnce(&mut Self) -> R) -> R {
        // SAFETY: `new()` has checked, and there is no other way to get at `Tables`.
        unsafe { avx2(self, run) }
    }
}

impl Tables {
    /// For about `input_len` bytes, and as large as it gets for `u32::MAX`. Returns how many bits 8 tokens take on average, unless the codes are not complete,
    /// or out of the ordinary. The codewords for lengths have `shortest_length` bits or more.
    #[inline(always)]
    pub fn build(
        &mut self,
        (litlens, distances): (&Litlens, &Distances),
        input_len: u32,
        shortest_length: u32,
        draft: &mut Tokens,
    ) -> Option<u32> {
        // SAFETY: it checks the counts.
        let result = unsafe {
            highway_inflate_build(litlens, distances, input_len, shortest_length, draft, self)
        };
        self.root_bits[0] = result % 256;
        (result != 0).then_some(result >> 8)
    }

    /// One token.
    #[inline(always)]
    pub fn look_up_one(&self, bits: u64, cursor: &mut Cursor) -> u32 {
        let link = usize::from(self.links[cursor.index % ENTRIES]);
        cursor.index = (link | (bits as usize & ((1 << self.root_bits[0]) - 1))) % ENTRIES;
        let entry = self.entries[cursor.index];
        cursor.bit += entry as usize % 64;
        entry
    }

    /// Writes literals up to something else, or some way. Does nothing and returns `false` if they go on behind the last few bytes.
    /// `debt` counts how many more it would have been one by one.
    #[inline(always)]
    pub fn write_literals(
        &self,
        usual: &Usual,
        input: &[u8],
        bit: &mut usize,
        sheet: &mut Sheet<'_>,
        debt: &mut isize,
    ) -> bool {
        let (room, start) = (sheet.room(), *bit);
        let mut turns = input
            .len()
            .saturating_sub(start / 8)
            .min(room.clamp(64, 8192))
            / 64;
        if turns == 0 || room == 0 {
            return true;
        }
        let to = sheet.start.wrapping_add(sheet.position);
        // SAFETY: a turn takes less than 64 bytes of either, which are spare behind any room, and initializes what it goes past.
        let end = unsafe {
            highway_inflate_guess(
                self,
                self.root_bits[0],
                usual,
                input.as_ptr(),
                bit,
                to,
                &mut turns,
            )
        };
        let len = end.addr() - to.addr();
        *debt = debt.wrapping_add(turns as isize - len as isize);
        match len <= room {
            true => sheet.position += len,
            false => *bit = start,
        }
        len <= room
    }

    /// How many rows [`look_up`](Self::look_up) takes on with a lane at `bit`.
    #[inline(always)]
    pub fn max_rows(input: &[u8], bit: usize) -> usize {
        input.len().saturating_sub(bit / 8 + 8) / 8
    }

    /// Fills `rows`, or nothing. The two tokens of a row and the index of the next have to fit in 56 bits.
    #[inline(always)]
    pub fn look_up(
        &self,
        input: &[u8],
        cursors: &mut [Cursor; LANES],
        tokens: &mut Tokens,
        rows: Range<usize>,
    ) -> bool {
        let furthest = cursors.iter().fold(0, |max, it| it.bit.max(max));
        if rows.is_empty()
            || !rows.len().is_multiple_of(ROW_STEP)
            || rows.end > ROWS
            || rows.len() > Self::max_rows(input, furthest)
        {
            return false;
        }
        let inputs = cursors.map(|it| input.as_ptr().wrapping_add(it.bit / 8));
        let mut lanes = RawLanes {
            bits: from_fn(|lane| {
                // SAFETY: `max_rows()` is not 0.
                let word = unsafe { inputs[lane].cast::<[u8; 8]>().read() };
                (u64::from_le_bytes(word) | 1 << 63) >> (cursors[lane].bit % 8)
            }),
            indices: cursors.map(|it| it.index as u64),
            inputs,
        };
        // SAFETY: it indexes like `look_up_one()`. For each row, a lane goes on by up to 8 bytes and reads 8.
        unsafe {
            highway_inflate_look_up(
                (&raw const *self).cast(),
                self.root_bits[0],
                &mut lanes,
                tokens.0.as_mut_ptr().cast::<u32>().add(rows.start),
                rows.len(),
            );
        }
        *cursors = from_fn(|lane| Cursor {
            bit: 8 * (lanes.inputs[lane].addr() - input.as_ptr().addr())
                + lanes.bits[lane].leading_zeros() as usize,
            index: lanes.indices[lane] as usize,
        });
        true
    }
}

impl Tokens {
    #[inline(always)]
    pub fn lanes(&mut self) -> &mut [Lane; LANES] {
        &mut self.0
    }

    /// How many tokens at the start of each lane fit in so many bits, and how many they take. Instead of the first lane it is
    /// the last, back from the end of `rows`. May leave out up to a group of rows.
    #[inline(always)]
    pub fn seek(&self, rows: usize, bits: [usize; LANES]) -> [[u16; 2]; LANES] {
        let (mut found, bits) = ([[0; _]; _], bits.map(|it| it.min(30_000) as u16));
        // SAFETY: it reads so many rows.
        unsafe { highway_inflate_seek(self, rows.min(ROWS), &bits, &mut found) };
        found
    }

    /// Writes what the tokens stand for, up to or a little before one that stops, does not fit, or reaches too far back.
    #[inline(always)]
    pub fn write(&mut self, segments: &[Segment], sheet: &mut Sheet<'_>) -> Written {
        for column in &mut self.0[0].entries {
            column[USABLE_ROWS..][..ROW_GROUP].fill(0);
            column[USABLE_ROWS + ROW_GROUP..].fill(u32::MAX);
        }
        let tokens = self.0.as_mut_ptr().cast::<u32>();
        let raw = |lane: usize, start: usize, end: usize| RawSegment {
            start: tokens.wrapping_add(4 * ROWS * lane + start),
            end: tokens.wrapping_add(4 * ROWS * lane + end),
        };
        let mut all = [raw(0, USABLE_ROWS, ROWS); LANES + 1];
        for (to, it) in all[..LANES].iter_mut().zip(segments) {
            let last = USABLE_ROWS - ROW_GROUP;
            *to = raw(it.lane.min(LANES - 1), it.start.min(last), it.end.min(last));
        }
        let Some(mut raw_sheet) = sheet.raw() else {
            let next = segments.first().map(|it| (it.lane, 2 * it.start));
            return Written {
                next,
                end: None,
                stops: 0,
            };
        };
        // SAFETY: it touches up to `ROW_GROUP + 1` rows from the start of a segment on, or from one in front of its end, and does
        // not get past the group that stops. `Sheet::raw()` has the rest.
        unsafe { highway_inflate_write(all.as_ptr(), &mut raw_sheet) };
        sheet.position += raw_sheet.written as usize;
        let place = |row: *const u32| {
            let word = (row.addr() - tokens.addr()) / size_of::<u32>();
            (word / (4 * ROWS), word % ROWS)
        };
        let (lane, row) = place(raw_sheet.row);
        Written {
            next: (row < USABLE_ROWS).then_some((lane, 2 * row + raw_sheet.token as usize)),
            end: (!raw_sheet.last.is_null()).then(|| (place(raw_sheet.last), raw_sheet.dropped)),
            stops: raw_sheet.stops,
        }
    }
}

pub struct Written {
    /// The lane and the token that it has not got to.
    pub next: Option<(usize, usize)>,
    /// In front of this lane's row, [`kind::END`] has been taken from an entry, and entries for so many bits behind it have been zeroed.
    pub end: Option<((usize, usize), usize)>,
    /// For distances with long codewords.
    pub stops: usize,
}

/// What is written to.
pub struct Sheet<'a> {
    start: *mut u8,
    len: usize,
    /// All in front of it is initialized.
    position: usize,
    /// Nothing ends behind it.
    limit: usize,
    /// So many bytes in front of `start` are within reach, or not within reach behind it.
    before_start: isize,
    max_distance: usize,
    /// If it is not 0, all is initialized, and what is in front of `start` is so much further on.
    lap: usize,
    bytes: PhantomData<&'a mut [MaybeUninit<u8>]>,
}

impl<'a> Sheet<'a> {
    /// What it needs behind what it writes.
    pub const SPARE_LEN: usize = 2 * COPIED + STAGE_LEN + COPIED;
    /// The same for a ring, behind the end of the lap.
    pub const LAP_SPARE_LEN: usize = 2 * 255 + 2 * COPIED;

    /// `available` bytes in front of `position` may be copied. With a `lap`, the last `SPARE_LEN` bytes are for scribbling.
    #[inline(always)]
    pub fn slice(
        bytes: &'a mut [u8],
        room: Range<usize>,
        available: usize,
        max_distance: usize,
        lap: usize,
    ) -> Self {
        let position = room.start.min(bytes.len());
        let is_ring = lap > REACH && lap <= bytes.len().saturating_sub(Self::LAP_SPARE_LEN);
        let lap = if is_ring { lap } else { 0 };
        Self {
            start: bytes.as_mut_ptr(),
            len: bytes.len(),
            position,
            limit: room.end,
            before_start: available.min(position + lap) as isize - position as isize,
            max_distance,
            lap,
            bytes: PhantomData,
        }
    }

    /// Up to `room` bytes of the spare capacity are written to.
    #[inline(always)]
    pub fn behind<R>(
        vec: &mut Vec<u8>,
        room: usize,
        available: usize,
        max_distance: usize,
        write: impl FnOnce(&mut Sheet<'_>) -> R,
    ) -> R {
        let (start, position) = (vec.as_mut_ptr(), vec.len());
        let mut sheet = Sheet {
            start,
            len: position + room.min(vec.capacity() - position),
            position,
            limit: usize::MAX,
            before_start: available.min(position) as isize - position as isize,
            max_distance,
            lap: 0,
            bytes: PhantomData,
        };
        let result = write(&mut sheet);
        if sheet.start == start {
            // SAFETY: it is still the same sheet.
            unsafe { vec.set_len(sheet.position) };
        }
        result
    }

    #[inline(always)]
    pub fn position(&self) -> usize {
        self.position
    }

    #[inline(always)]
    pub fn room(&self) -> usize {
        let end = self.limit.min(self.len.saturating_sub(Self::SPARE_LEN));
        end.saturating_sub(self.position)
    }

    #[inline(always)]
    pub fn available(&self) -> usize {
        (self.position as isize + self.before_start).clamp(0, REACH as isize) as usize
    }

    /// Unless there is no room.
    #[inline(always)]
    pub fn push(&mut self, byte: u8) -> bool {
        let fits = self.room() != 0;
        if fits {
            // SAFETY: there is room.
            unsafe { self.start.add(self.position).write(byte) };
            self.position += 1;
        }
        fits
    }

    /// Those of the tokens in `rows` and a few more, up to something else or close to the end of the room. Returns how many tokens.
    #[inline(always)]
    pub fn push_literals(&mut self, lane: &Lane, rows: Range<usize>) -> usize {
        let left = rows.end.min(USABLE_ROWS).saturating_sub(rows.start);
        let groups = left.div_ceil(ROW_GROUP).min(self.room() / (4 * ROW_GROUP));
        let (row, start) = (
            lane.entries.as_ptr().cast::<u32>().wrapping_add(rows.start),
            self.start.wrapping_add(self.position),
        );
        let mut to = start;
        // SAFETY: a group of rows starts in front of `USABLE_ROWS`. Two bytes are written for a token at most, and all that it goes past.
        let tokens = unsafe { highway_inflate_literals(row, groups, &mut to) };
        self.position += to.addr() - start.addr();
        tokens
    }

    /// Unless there is no room, or it is out of reach.
    #[inline(always)]
    pub fn copy(&mut self, distance: usize, len: usize) -> bool {
        const { assert!(MATCH_SPAN <= Sheet::SPARE_LEN && MATCH_SPAN <= Sheet::LAP_SPARE_LEN) };
        let reach = 1..=self.available().min(self.max_distance);
        let fits = len <= self.room().min(258) && self.room() != 0 && reach.contains(&distance);
        if fits {
            let lap = if distance > self.position {
                self.lap
            } else {
                0
            };
            // SAFETY: both start where there is room, or before, or in the last lap.
            let [from, to] = [self.position + lap - distance, self.position]
                .map(|at| unsafe { &*self.start.add(at).cast() });
            copy_cells(from, to, distance, len, None, Some(MaybeUninit::new(0u8)));
            self.position += len;
        }
        fits
    }

    /// What is written to first.
    #[inline(always)]
    pub fn prefetch(&self) {
        let (next, room) = (
            self.start.wrapping_add(self.position),
            self.room().min(MAX_ROOM),
        );
        let stage = (0..Self::SPARE_LEN).step_by(64).map(|at| room + at);
        for at in (0..1024).step_by(64).chain(stage) {
            prefetch_write(next.wrapping_add(at), Locality::L1);
        }
    }

    #[inline(always)]
    pub fn take_back(&mut self, len: usize) {
        self.position = self.position.saturating_sub(len);
    }

    /// A token writes 510 bytes at most. The kernel writes less than `2 * COPIED` bytes behind `limit`, initializes all in
    /// front of `written`, and reads as much as it writes: from `first` on and before it writes, a lap on, or on the stage.
    #[inline(always)]
    fn raw(&mut self) -> Option<RawSheet> {
        let room = self.room().min(MAX_ROOM);
        let available = self.available();
        let (offset, stage) = match self.lap {
            0 => (available, room + 2 * COPIED),
            _ => (
                self.position,
                (self.len - self.position).checked_sub(STAGE_LEN + COPIED)?,
            ),
        };
        (room != 0 && offset + stage + STAGE_LEN < 2 * REACH).then_some(RawSheet {
            out: self.start.wrapping_add(self.position),
            limit: room as i32,
            stage: stage as i32,
            first: -(available as i32),
            max_distance: self.max_distance.clamp(1, REACH) as i32,
            offset: offset as i32,
            lap: self.lap as i32,
            row: core::ptr::null(),
            written: 0,
            token: 0,
            last: core::ptr::null(),
            dropped: 0,
            stops: 0,
        })
    }
}
