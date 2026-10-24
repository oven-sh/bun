//! The names and values of a dynamic table, back to back in one allocation.

use core::ops::Range;

#[derive(Default)]
pub(crate) struct Storage {
    /// `bytes[start..end]` belongs to entries, oldest first. What follows is scratch space.
    bytes: Vec<u8>,
    start: usize,
    end: usize,
    /// The `Position` of `bytes[0]`.
    origin: Position,
}

/// Where an entry's bytes are, counting every byte ever kept. Moving the bytes does not change it.
pub(crate) type Position = u64;

const SPARE_CAPACITY: usize = 4096;

impl Storage {
    /// Drops the scratch space and reclaims what left the front. Invalidates every earlier range.
    pub(crate) fn clear_scratch(&mut self) {
        self.bytes.truncate(self.end);
        // Moves fewer bytes than it frees, so this is O(1) per byte kept.
        if self.start > 0 && self.start >= self.end - self.start {
            self.bytes.copy_within(self.start..self.end, 0);
            self.origin += self.start as u64;
            self.end -= self.start;
            self.start = 0;
            self.bytes.truncate(self.end);
        }
        if self.bytes.capacity() / 4 > self.end + SPARE_CAPACITY {
            self.bytes.shrink_to(self.end + SPARE_CAPACITY);
        }
    }

    /// The scratch space is written by appending to this.
    pub(crate) fn bytes_mut(&mut self) -> &mut Vec<u8> {
        &mut self.bytes
    }

    pub(crate) fn len(&self) -> usize {
        self.bytes.len()
    }

    #[cfg(test)]
    pub(crate) fn heap_size(&self) -> usize {
        self.bytes.capacity()
    }

    pub(crate) fn append_copy_of(&mut self, range: Range<usize>) {
        if range.start <= range.end && range.end <= self.bytes.len() {
            self.bytes.extend_from_within(range);
        }
    }

    /// Turns the whole scratch space into the bytes of a new entry.
    pub(crate) fn keep_scratch(&mut self) -> Position {
        let position = self.origin + self.end as u64;
        self.end = self.bytes.len();
        position
    }

    /// Gives up the `len` oldest bytes. They stay readable until [`Self::clear_scratch`].
    pub(crate) fn release(&mut self, len: usize) {
        self.start = self.start.saturating_add(len).min(self.end);
    }

    pub(crate) fn range(&self, position: Position, len: usize) -> Range<usize> {
        let start = position.saturating_sub(self.origin) as usize;
        start..start.saturating_add(len)
    }

    pub(crate) fn get(&self, range: Range<usize>) -> &[u8] {
        self.bytes.get(range).unwrap_or_default()
    }
}
