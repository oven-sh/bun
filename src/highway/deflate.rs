//! The kernels of the compressor in `bun_deflate`, from src/jsc/bindings/highway_deflate.cpp.

use core::mem::MaybeUninit;
use core::ops::Range;
use core::ptr::{null, null_mut};
use std::collections::TryReserveError;
use std::io::BorrowedCursor;

/// So many bytes are read in front of the oldest that a match may copy, and behind the last.
pub const FRONT: usize = 128;
pub const BACK: usize = 96;
/// So many positions are hashed at once, and matches go so much further.
pub const MAX_BATCH: usize = 8192;
pub const MAX_OVERRUN: usize = 288;
pub const MAX_TABLES: usize = 7;
pub const MAX_TABLE_LEN: usize = 1 << 15;
/// While all stamped positions are below, an entry from [`FRONT`] or more in front of the input has no effect.
pub const MAX_SAFE_STAMP: u32 = 1 << 15;
pub const LADDER_LEN: usize = 824 * 1024;
pub const SCRATCH_LEN: usize = 164 * 1024;
/// In the unit of [`Costs`].
pub const LITERAL_COST: u8 = 16;

/// How often each symbol is used, 288 for literals and lengths and then those for distances.
pub type Frequencies = [u16; 320];

/// A match or up to two literals: 9 bits at each end index the halves of [`Codes`], with extra bits below the upper.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct Token(u32);

impl Token {
    /// The exponent of a float and its next bit make the symbol of a distance, but that the first two are swapped.
    pub fn for_match(len: u32, distance: u32) -> Self {
        let scaled = if distance == 1 { 3 } else { 2 * (distance - 1) };
        Self((scaled as f32).to_bits() << 1 | (253 + len))
    }
}

/// Bits from the top, with the first of them lowest, and in the lowest five bits how many they are.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Codes {
    /// Literals, then lengths from 3 on, with the extra bits.
    pub first: [u32; 512],
    /// Literals, then distances, with room for the extra bits at the top. The first two are swapped, and the last is empty.
    pub second: [u32; 512],
    pub end_of_block: u32,
}

impl Codes {
    pub fn bits(&self, tokens: &[Token]) -> u32 {
        let bits =
            |&Token(it)| self.first[it as usize % 512] % 32 + self.second[it as usize >> 23] % 32;
        tokens.iter().map(bits).sum()
    }
}

/// Those of a byte that is not full. The kernels take up to 15.
#[derive(Clone, Copy, Default)]
#[repr(C)]
pub struct Bits {
    pub value: u64,
    pub count: usize,
}

/// What a match costs is the sum of three.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Costs {
    /// By how many bits the distance less one takes, less one.
    pub distances: [u8; 16],
    /// By the length, up to 15.
    pub short: [u8; 16],
    /// By a sixteenth of the length.
    pub long: [u8; 16],
}

/// From each of the latest positions to what the tables had for it.
#[derive(Default)]
pub struct Links {
    ring: Vec<u16>,
    /// With the stamp.
    end: u32,
    len: u32,
    did_pay: bool,
}

impl Links {
    pub fn try_reserve(&mut self, positions: usize) -> Result<(), TryReserveError> {
        self.len = 0;
        (self.ring).try_reserve_exact((positions + 16).next_power_of_two().min(1 << 15) + 8)
    }

    pub fn clear(&mut self) {
        (self.len, self.did_pay) = (0, false);
    }
}

/// Has the last position of each hash of so many bytes. A copy of it behind its end makes one that is twice as long.
#[derive(Default)]
pub struct Table {
    pub entries: Vec<u32>,
    /// So many of them are used.
    pub len: u32,
    pub gram_len: u8,
}

pub enum Finder<'a> {
    Nothing,
    /// Only at a distance of 1.
    Runs,
    /// The first that knows of a match is believed.
    Tables(&'a mut [Table]),
    /// Only at about a sixth of the positions. This and the next hash up to 8 bytes.
    Samples(&'a mut Table),
    /// Only between matches.
    Gaps(&'a mut Table),
    /// All lengths of all that the tables know are tried, at prices that follow from `known` and the pass before.
    Everything {
        tables: &'a mut [Table],
        known: Option<&'a Frequencies>,
        /// In 128ths of a bit. It is updated.
        price_per_byte: &'a mut u16,
        passes: u8,
        ladder: &'a mut [MaybeUninit<u8>; LADDER_LEN],
    },
}

/// All positions are indices into `bytes`, of which those from [`FRONT`] on are input.
pub struct Batch<'a> {
    pub bytes: &'a [u8],
    /// Where matches are looked for.
    pub hashed: Range<u32>,
    /// What tokens are wanted for.
    pub parsed: Range<u32>,
    /// No match goes further.
    pub end: u32,
    /// If not, a long match that gets there is left to be continued.
    pub ends_input: bool,
    pub expects_few_matches: bool,
    /// Then links are followed however many candidates there are.
    pub were_tokens_few: bool,
    /// Then a run goes on even if pieces of it have a shorter period.
    pub is_hasty: bool,
    pub max_distance: u32,
    /// Added to a position, it gives a number that stays the same when the bytes are moved.
    pub stamp: u32,
}

#[derive(Default)]
#[repr(C)]
pub struct Parsed {
    tokens: u32,
    /// Up to which there are tokens.
    pub position: u32,
    /// How many matches there were to choose from.
    pub candidates: u32,
    /// Of the match to be continued, or 0.
    pub run_distance: u32,
    is_linked: bool,
    pub did_links_pay: bool,
}

#[derive(Clone, Copy, Default)]
#[repr(C)]
pub struct Sums {
    pub symbols: u32,
    pub different: u32,
    /// Of each frequency times its [`log2`].
    pub times_log: u32,
}

/// In 256ths. The bits of a float are nearly it.
pub fn log2(value: u32) -> u32 {
    const MISSING: [u8; 16] = [3, 9, 14, 17, 20, 21, 22, 22, 21, 20, 18, 16, 13, 10, 6, 2];
    let bits = (value.max(1) as f32).to_bits() >> 15;
    bits - (127 << 8) + u32::from(MISSING[(bits >> 4) as usize % 16])
}

/// How many tokens there has to be room for.
pub const fn max_tokens(len: usize) -> usize {
    len / 2 + 16
}

#[derive(Clone, Copy)]
#[repr(C)]
struct RawTable {
    entries: *mut u32,
    mask: u32,
    gram_len: u32,
}

#[repr(C)]
struct RawBatch {
    bytes: *const u8,
    oldest: u32,
    hashed: [u32; 2],
    parsed: [u32; 2],
    end: u32,
    max_distance: u32,
    stamp: u32,
    tables: [RawTable; MAX_TABLES],
    known: *const u16,
    price_per_byte: *mut u16,
    ladder: *mut MaybeUninit<u8>,
    links: *mut MaybeUninit<u16>,
    link_mask: u32,
    linked_from: u32,
    table_count: u8,
    finder: u8,
    ends_input: bool,
    expects_few_matches: bool,
    depth: u8,
    did_links_pay: bool,
    were_tokens_few: bool,
    is_hasty: bool,
    passes: u8,
    costs: Costs,
}

#[cfg(any(miri, feature = "test_support"))]
mod plain;
#[cfg(any(miri, feature = "test_support"))]
use plain::*;

#[cfg(not(any(miri, feature = "test_support")))]
unsafe extern "C" {
    fn highway_deflate_parse(
        batch: &RawBatch,
        scratch: *mut MaybeUninit<u8>,
        tokens: *mut MaybeUninit<Token>,
        parsed: &mut Parsed,
    );
    fn highway_deflate_end_of_run(
        bytes: *const u8,
        at: usize,
        end: usize,
        distance: usize,
    ) -> usize;
    fn highway_deflate_count(tokens: *const Token, count: usize, frequencies: &mut Frequencies);
    safe fn highway_deflate_make_codes(frequencies: &Frequencies, dynamic: &mut Dynamic) -> u32;
    fn highway_deflate_start_block(
        dynamic: &mut Dynamic,
        codes: &mut Codes,
        bits: &mut Bits,
    ) -> usize;
    safe fn highway_deflate_sum(frequencies: &Frequencies, sums: &mut [Sums; 3]);
    fn highway_deflate_write(
        tokens: *const Token,
        count: usize,
        codes: &Codes,
        out: *mut MaybeUninit<u8>,
        room: usize,
        bits: &mut Bits,
    ) -> usize;
}

/// How far into `range` the bytes are like those `distance` in front of them.
pub fn end_of_run(bytes: &[u8], range: Range<u32>, distance: u32) -> Option<u32> {
    let [at, end, distance] = [range.start, range.end, distance].map(|it| it as usize);
    // SAFETY: it reads from `at - distance` to less than 32 bytes behind `end`.
    ([distance, at, end].is_sorted() && end + BACK <= bytes.len())
        .then(|| unsafe { highway_deflate_end_of_run(bytes.as_ptr(), at, end, distance) } as u32)
}

/// Appends to `tokens`. `None` if an argument is out of range.
pub fn parse(
    batch: &Batch<'_>,
    finder: Finder<'_>,
    mut links: Option<(&mut Links, u8)>,
    mut costs: Costs,
    scratch: &mut [MaybeUninit<u8>; SCRATCH_LEN],
    tokens: &mut Vec<Token>,
) -> Option<Parsed> {
    let Batch { hashed, parsed, .. } = batch;
    let is_in_range = [FRONT as u32, hashed.start, hashed.end, batch.end].is_sorted()
        && [hashed.start, parsed.start, parsed.end, batch.end].is_sorted()
        && hashed.len() <= MAX_BATCH
        && (batch.end - hashed.start) as usize <= MAX_BATCH + MAX_OVERRUN
        && batch.end as usize + BACK <= batch.bytes.len()
        && (1..=1 << 15).contains(&batch.max_distance)
        && max_tokens((batch.end - parsed.start) as usize) <= tokens.capacity() - tokens.len();
    if !is_in_range {
        return None;
    }
    let aligned = |memory: &mut [MaybeUninit<u8>]| {
        let start = memory.as_ptr().addr().wrapping_neg() % 64;
        memory[start..].as_mut_ptr()
    };
    let mut thorough = (null(), null_mut(), null_mut(), 0);
    let (finder, tables) = match finder {
        Finder::Nothing | Finder::Tables([]) => (0, &mut [][..]),
        Finder::Runs => (1, &mut [][..]),
        Finder::Tables(tables) => (2, tables),
        Finder::Samples(table) => (3, core::slice::from_mut(table)),
        Finder::Gaps(table) => (4, core::slice::from_mut(table)),
        Finder::Everything {
            tables,
            known,
            price_per_byte,
            passes,
            ladder,
        } => {
            let known = known.map_or(null(), |it| it.as_ptr());
            thorough = (known, price_per_byte, aligned(ladder), passes);
            (5, tables)
        }
    };
    let chains = match &mut links {
        Some((links, depth)) => {
            let ring = links.ring.spare_capacity_mut();
            let mask = (1u32 << ring.len().checked_sub(8)?.checked_ilog2()?.min(15)) - 1;
            let again = links
                .end
                .wrapping_sub(batch.stamp.wrapping_add(hashed.start));
            let before = links.len.saturating_sub(again).min(hashed.start);
            links.end = batch.stamp.wrapping_add(hashed.end);
            links.len = before + hashed.len() as u32;
            (
                ring.as_mut_ptr(),
                mask.checked_sub(8)? + 8,
                hashed.start - before,
                *depth,
                links.did_pay,
            )
        }
        _ => (null_mut(), 0, 0, 0, false),
    };
    let mut raw_tables = [RawTable {
        entries: null_mut(),
        mask: 0,
        gram_len: 0,
    }; _];
    for (raw, table) in raw_tables.iter_mut().zip(&mut *tables) {
        *raw = RawTable {
            mask: table.len.min(table.entries.len() as u32).checked_sub(1)?,
            entries: table.entries.as_mut_ptr(),
            gram_len: table.gram_len.clamp(3, 24).into(),
        };
    }
    // Or it might choose matches that are too short.
    costs.distances = costs.distances.map(|cost| cost.max(2 * LITERAL_COST + 1));
    let raw = RawBatch {
        bytes: batch.bytes.as_ptr(),
        oldest: FRONT as u32,
        hashed: [hashed.start, hashed.end],
        parsed: [parsed.start, parsed.end],
        end: batch.end,
        max_distance: batch.max_distance,
        stamp: batch.stamp,
        tables: raw_tables,
        known: thorough.0,
        price_per_byte: thorough.1,
        ladder: thorough.2,
        passes: thorough.3,
        table_count: tables.len().min(MAX_TABLES) as u8,
        finder,
        ends_input: batch.ends_input,
        expects_few_matches: batch.expects_few_matches,
        links: chains.0,
        link_mask: chains.1,
        linked_from: chains.2,
        depth: chains.3,
        did_links_pay: chains.4,
        were_tokens_few: batch.were_tokens_few,
        is_hasty: batch.is_hasty,
        costs,
    };
    let scratch = aligned(scratch);
    let room = tokens.spare_capacity_mut().as_mut_ptr();
    let mut result = Parsed::default();
    // SAFETY: whatever is in the tables, the kernel stays within these ranges. It initializes the tokens that it tells of.
    unsafe {
        highway_deflate_parse(&raw, scratch, room, &mut result);
        tokens.set_len(tokens.len() + result.tokens as usize);
    }
    if let Some((links, _)) = links {
        links.len *= u32::from(result.is_linked);
        links.did_pay = result.did_links_pay;
    }
    Some(result)
}

pub fn count(tokens: &[Token], frequencies: &mut Frequencies) {
    // SAFETY: the kernel reads so many.
    unsafe { highway_deflate_count(tokens.as_ptr(), tokens.len(), frequencies) }
}

#[repr(C)]
struct Code {
    before_symbols: [u16; 16],
    symbols: [u16; 304],
    lens: [u16; 304],
    unused_before: [u16; 304],
    words: [u32; 304],
    counts: [u16; 16],
    used: u32,
}

/// The codes that a block tells in its header.
#[repr(C)]
pub struct Dynamic {
    codes: [Code; 3],
    header: [u8; 896],
}

impl Dynamic {
    pub const UNMADE: Self = Self {
        codes: [const {
            Code {
                before_symbols: [0; _],
                symbols: [0; _],
                lens: [0; _],
                unused_before: [0; _],
                words: [0; _],
                counts: [0; _],
                used: 0,
            }
        }; _],
        header: [0; _],
    };

    /// Returns how many bits the header and the codewords take. The end of the block is used, and no symbol 32768 times.
    pub fn make(&mut self, frequencies: &Frequencies) -> u32 {
        highway_deflate_make_codes(frequencies, self)
    }

    /// Returns the bytes that `bits` and the header fill, and sets what the tokens need of `codes`.
    pub fn start_block(&mut self, codes: &mut Codes, bits: &mut Bits) -> &[u8] {
        bits.count %= 16;
        // SAFETY: only the other kernel has written to `self`.
        let len = unsafe { highway_deflate_start_block(self, codes, bits) };
        &self.header[..len]
    }
}

/// For literals, lengths and distances. No symbol is used 32768 times.
pub fn sum(frequencies: &Frequencies) -> [Sums; 3] {
    let mut sums = [Sums::default(); _];
    highway_deflate_sum(frequencies, &mut sums);
    sums
}

/// With the end of the block. `false` if `out` has no room for them and 8 bytes more.
pub fn write(
    tokens: &[Token],
    codes: &Codes,
    mut out: BorrowedCursor<'_, u8>,
    bits: &mut Bits,
) -> bool {
    bits.count %= 16;
    let room = out.capacity();
    // SAFETY: the kernel writes no further than `room`, and to all the bytes that it tells of.
    unsafe {
        let to = out.as_mut().as_mut_ptr();
        let written = highway_deflate_write(tokens.as_ptr(), tokens.len(), codes, to, room, bits);
        if written > room {
            return false;
        }
        out.advance(written);
    }
    true
}
