//! The input that is being compressed, behind what matches are looked for in.

use crate::error::Result;
use crate::format::{MAX_MATCH, MIN_MATCH};
use crate::vec;

/// So much input is wanted behind the position, unless there is a flush.
pub(super) const MIN_LOOKAHEAD: u32 = (MAX_MATCH + MIN_MATCH + 1) as u32;
/// How much may be compared for a match.
pub(super) const SCAN_LEN: usize = 16 + (MAX_MATCH - 16).next_multiple_of(32);
/// Behind the input. Zeros, or what used to be there.
const PADDING: usize = SCAN_LEN + 8;

pub(super) struct Window {
    /// Only as long as it has had to be.
    pub(super) bytes: Vec<u8>,
    /// There is room for twice as much.
    pub(super) size: u32,
    /// What is in front of it has been compressed.
    pub(super) position: u32,
    /// Of the input.
    pub(super) end: u32,
    /// Negative once the start of the block has slid out.
    pub(super) block_start: i64,
    /// So many positions in front of `position` are still to be put in the hash chains.
    pub(super) unhashed: u32,
}

impl Window {
    pub(super) fn new(bits: u8) -> Result<Self> {
        let size = 1 << bits;
        Ok(Self {
            bytes: vec::with_room(2 * size as usize + PADDING)?,
            size,
            position: 0,
            end: 0,
            block_start: 0,
            unhashed: 0,
        })
    }

    pub(super) fn rewind(&mut self) {
        (self.position, self.end, self.block_start, self.unhashed) = (0, 0, 0, 0);
    }

    #[inline(always)]
    pub(super) fn lookahead(&self) -> u32 {
        self.end - self.position
    }

    #[inline(always)]
    pub(super) fn max_distance(&self) -> u32 {
        self.size - MIN_LOOKAHEAD
    }

    /// From this position on, the upper half is moved down before more is read.
    #[inline(always)]
    pub(super) fn slide_position(&self) -> u32 {
        2 * self.size - MIN_LOOKAHEAD
    }

    pub(super) fn room(&self) -> usize {
        (2 * self.size - self.end) as usize
    }

    /// Returns the copy. There is `room()` for it.
    pub(super) fn append(&mut self, input: &[u8]) -> &[u8] {
        debug_assert!(input.len() <= self.room());
        let range = self.end as usize..self.end as usize + input.len();
        self.end = range.end as u32;
        vec::write_at(&mut self.bytes, range.start, input);
        if self.bytes.len() < range.end + PADDING {
            self.bytes.resize(range.end + PADDING, 0);
        }
        self.bytes.get(range).unwrap_or_default()
    }

    /// Moves the first `len` bytes of the upper half down.
    pub(super) fn slide(&mut self, len: u32) {
        let (size, len) = (self.size as usize, len as usize);
        debug_assert!(len <= size && size + len <= self.bytes.len());
        if let Some((lower, upper)) = self.bytes.split_at_mut_checked(size)
            && let (Some(lower), Some(upper)) = (lower.get_mut(..len), upper.get(..len))
        {
            lower.copy_from_slice(upper);
        }
        self.position -= self.size;
        self.end -= self.size;
        self.block_start -= i64::from(self.size);
        self.unhashed = self.unhashed.min(self.position);
    }

    /// What the block covers up to `position`, unless some of it is gone.
    pub(super) fn block(&self) -> Option<&[u8]> {
        let start = usize::try_from(self.block_start).ok()?;
        self.bytes.get(start..self.position as usize)
    }

    pub(super) fn start_block(&mut self) {
        self.block_start = self.position.into();
    }

    /// The last two positions have not had enough behind them for a hash.
    pub(super) fn leave_end_unhashed(&mut self) {
        self.unhashed = self.position.min(MIN_MATCH as u32 - 1);
    }
}

#[inline(always)]
pub(super) fn chunk<const N: usize>(bytes: &[u8], at: u32) -> Option<&[u8; N]> {
    bytes.get(at as usize..at as usize + N)?.try_into().ok()
}

#[inline(always)]
pub(super) fn byte(bytes: &[u8], at: u32) -> u8 {
    let byte = bytes.get(at as usize);
    debug_assert!(byte.is_some());
    byte.copied().unwrap_or_default()
}

#[inline(always)]
pub(super) fn word(bytes: &[u8], at: u32) -> Option<u64> {
    chunk(bytes, at).copied().map(u64::from_le_bytes)
}

/// How many bytes are equal at the start, at most `MAX_MATCH`. The first 8 are known to be.
#[inline(always)]
pub(super) fn long_match_len(a: &[u8; SCAN_LEN], b: &[u8; SCAN_LEN]) -> u32 {
    let difference = word(a, 8).unwrap_or_default() ^ word(b, 8).unwrap_or_default();
    if difference != 0 {
        return 8 + difference.trailing_zeros() / 8;
    }
    let mut len = 16;
    while let (Some(a), Some(b)) = (chunk::<32>(a, len), chunk::<32>(b, len)) {
        if a != b {
            let difference = |at| {
                let half = |bytes| chunk(bytes, at).copied().map_or(0, u128::from_le_bytes);
                half(a) ^ half(b)
            };
            let equal_bits = match difference(0) {
                0 => u128::BITS + difference(16).trailing_zeros(),
                lower => lower.trailing_zeros(),
            };
            return (len + equal_bits / 8).min(MAX_MATCH as u32);
        }
        len += 32;
    }
    MAX_MATCH as u32
}
