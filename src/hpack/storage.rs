//! The names and values of a dynamic table, back to back in one allocation.

use crate::ENTRY_OVERHEAD;

#[derive(Default)]
pub(crate) struct Storage {
    /// `bytes[start..end]` belongs to entries, oldest first. What follows is scratch space.
    bytes: Vec<u8>,
    start: usize,
    end: usize,
    /// The `position` of `bytes[0]`.
    origin: u64,
}

/// The name of a field and, right after it, its value.
#[derive(Clone, Copy)]
pub(crate) struct Span {
    /// Counts every byte ever kept, so moving the bytes does not change it.
    position: u64,
    name_len: usize,
    value_len: usize,
}

impl Span {
    /// What an entry adds to the size of its table (§4.1).
    pub(crate) fn size(self) -> usize {
        self.name_len + self.value_len + ENTRY_OVERHEAD
    }
}

const SPARE_CAPACITY: usize = 4096;

impl Storage {
    /// Drops the scratch space, so a `Span` of it is void, and reclaims what left the front.
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

    /// After [`Self::clear_scratch`], which leaves more room so as not to do this for every field.
    pub(crate) fn shrink(&mut self) {
        // Not for a large table: it would be moved here, and again to grow, every few fields.
        let spare = self.bytes.capacity() - self.end;
        if self.end <= 2 * SPARE_CAPACITY && spare > 2 * SPARE_CAPACITY {
            self.bytes.shrink_to(self.end + SPARE_CAPACITY);
        }
    }

    /// The scratch space is written by appending to this.
    pub(crate) fn bytes_mut(&mut self) -> &mut Vec<u8> {
        &mut self.bytes
    }

    pub(crate) fn scratch_len(&self) -> usize {
        self.bytes.len() - self.end
    }

    #[cfg(test)]
    pub(crate) fn heap_size(&self) -> usize {
        self.bytes.capacity()
    }

    /// The whole scratch space as a field whose name is the first `name_len` bytes.
    pub(crate) fn scratch(&self, name_len: usize) -> Span {
        Span {
            position: self.origin + self.end as u64,
            name_len,
            value_len: self.scratch_len().saturating_sub(name_len),
        }
    }

    /// Turns the scratch space into the bytes of the newest entry.
    pub(crate) fn keep_scratch(&mut self) {
        self.end = self.bytes.len();
    }

    /// Gives up the oldest entry. Its bytes stay readable until [`Self::clear_scratch`].
    pub(crate) fn release(&mut self, oldest: Span) {
        self.start = (self.start + oldest.name_len + oldest.value_len).min(self.end);
    }

    /// `None` for what was released and cleared, which no caller has a `Span` of.
    pub(crate) fn name_and_value(&self, span: Span) -> Option<(&[u8], &[u8])> {
        let start = span.position.checked_sub(self.origin)? as usize;
        let len = span.name_len + span.value_len;
        let field = self.bytes.get(start..)?.get(..len)?;
        field.split_at_checked(span.name_len)
    }

    pub(crate) fn append_name_of(&mut self, span: Span) -> Option<()> {
        let start = span.position.checked_sub(self.origin)? as usize;
        let name = start..start + span.name_len;
        self.bytes.get(name.clone())?;
        self.bytes.extend_from_within(name);
        Some(())
    }
}
