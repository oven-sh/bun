//! The input that is being compressed, behind what matches are looked for in.

use bun_highway::deflate::{BACK, FRONT, MAX_BATCH, MAX_OVERRUN};

use crate::Result;
use crate::format::{MAX_MATCH_LEN, MIN_MATCH_LEN};

#[derive(Default)]
pub struct Window {
    /// Only as long as it has had to be.
    pub(super) bytes: Vec<u8>,
    /// How far back matches go.
    pub size: u32,
    /// How much of that they leave alone.
    pub(super) margin: u32,
    /// What is in front of it has been parsed.
    pub position: u32,
    /// Of the input.
    pub end: u32,
    /// Below [`Self::START`] once the start of the block has slid out.
    pub block_start: i64,
    /// What is in front of it is in the tables, or need not be.
    pub(super) hashed: u32,
    pub(super) stamp: u32,
}

impl Window {
    /// The position of the first byte.
    pub const START: u32 = FRONT as u32;

    pub fn new(bits: u8) -> Self {
        let mut this = Self {
            size: 1 << bits,
            // As in zlib, whose 9 bits are for peers with 8.
            margin: (MAX_MATCH_LEN + MIN_MATCH_LEN + 1) as u32,
            ..Self::default()
        };
        this.clear();
        this
    }

    pub fn has_memory(&self) -> bool {
        self.bytes.capacity() != 0
    }

    /// For no more than `max_input` bytes in all. It is clear.
    pub fn try_reserve(&mut self, max_input: usize) -> Result<()> {
        let len = (self.limit() as usize).min(max_input.saturating_add(FRONT));
        Ok(self.bytes.try_reserve_exact(len + BACK)?)
    }

    /// The parser has to be cleared too.
    pub fn clear(&mut self) {
        (self.position, self.end, self.hashed) = (Self::START, Self::START, Self::START);
        self.start_block();
        self.stamp = 0;
        self.bytes.clear();
    }

    /// The input ends no later.
    fn limit(&self) -> u32 {
        Self::START + self.size + self.size.max(MAX_BATCH as u32) + 2 * MAX_OVERRUN as u32
    }

    pub fn lookahead(&self) -> u32 {
        self.end - self.position
    }

    /// To be filled with the next `len` bytes of input, for which there is room.
    pub fn extend(&mut self, len: usize) -> &mut [u8] {
        let start = self.end as usize;
        self.end += len as u32;
        debug_assert!(start + len + BACK <= self.bytes.capacity());
        if self.bytes.len() < start + len + BACK {
            self.bytes.resize(start + len + BACK, 0);
        }
        self.bytes.get_mut(start..start + len).unwrap_or_default()
    }

    /// Drops the first `len` bytes, which are in front of the position.
    pub fn slide(&mut self, len: u32) {
        if let Some(input) = self.bytes.get_mut(FRONT..self.end as usize) {
            input.copy_within(input.len().min(len as usize).., 0);
        }
        self.position -= len;
        self.end -= len;
        self.block_start -= i64::from(len);
        self.hashed = self.hashed.saturating_sub(len).max(Self::START);
        self.stamp = self.stamp.wrapping_add(len);
    }

    pub fn drop_what_is_too_far(&mut self) {
        self.slide((self.position - Self::START).saturating_sub(self.size));
    }

    /// If not, it has for what the parser wants once it has dropped what is too far.
    pub fn has_room_for_batch(&self) -> bool {
        self.position + (MAX_BATCH + MAX_OVERRUN) as u32 <= self.limit()
    }

    /// What the block covers up to `end`, unless some of it is gone.
    pub fn block(&self, end: u32) -> Option<&[u8]> {
        let start = usize::try_from(self.block_start).ok()?;
        self.bytes
            .get(start..end as usize)
            .filter(|_| start >= FRONT)
    }

    pub fn start_block(&mut self) {
        self.block_start = self.position.into();
    }
}
