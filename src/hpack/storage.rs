//! The names and values of a dynamic table, back to back in one allocation.

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
    name_len: u32,
    value_len: u32,
}

const _: () = assert!(crate::MAX_FIELD_LEN <= u32::MAX as usize);

impl Span {
    fn len(self) -> usize {
        self.name_len as usize + self.value_len as usize
    }
}

const SPARE_CAPACITY: usize = 4096;

impl Storage {
    /// Drops the scratch space, so a `Span` of it is void, and reclaims what left the front.
    pub(crate) fn clear_scratch(&mut self) {
        self.bytes.truncate(self.end);
        // Moves at most four times the bytes it frees, so this is O(1) per byte kept.
        if self.start > 0 && self.start >= self.front_limit() {
            self.bytes.drain(..self.start);
            self.origin += self.start as u64;
            self.end -= self.start;
            self.start = 0;
        }
        if self.bytes.capacity() / 4 > self.end + SPARE_CAPACITY {
            self.bytes.shrink_to(self.end + SPARE_CAPACITY);
        }
    }

    /// How many bytes of entries that have left may stay at the front. A table of the default size is cheap to move.
    fn front_limit(&self) -> usize {
        let entries = self.entries_len();
        if entries <= SPARE_CAPACITY {
            entries / 4
        } else {
            entries
        }
    }

    /// Gives spare capacity back, at the end of a block. Call [`Self::clear_scratch`] first: its own limit is looser because it runs for every field.
    pub(crate) fn shrink(&mut self) {
        // What the entries come to before `clear_scratch` reclaims the front, and a field needs room after them.
        let keep = self.entries_len() + self.front_limit() + SPARE_CAPACITY;
        // Not for a large table: every block with a large field would move it here, and again to grow.
        if self.end <= 2 * SPARE_CAPACITY && self.bytes.capacity() > keep + SPARE_CAPACITY {
            self.bytes.shrink_to(keep);
        }
    }

    /// The scratch space is written by appending to this, which has room for `len` more bytes.
    pub(crate) fn bytes_mut(&mut self, len: usize) -> &mut Vec<u8> {
        self.reserve(len);
        &mut self.bytes
    }

    fn reserve(&mut self, len: usize) {
        let (used, capacity) = (self.bytes.len(), self.bytes.capacity());
        if capacity - used >= len {
            return;
        }
        // A table keeps the room it once had, and doubled it would be over what `shrink` leaves: cut back and doubled again, block after block.
        if (SPARE_CAPACITY / 4..=4 * SPARE_CAPACITY).contains(&capacity) {
            self.bytes.reserve_exact(len.max(capacity / 4));
        } else {
            self.bytes.reserve(len);
        }
    }

    pub(crate) fn scratch_len(&self) -> usize {
        self.bytes.len() - self.end
    }

    /// How many bytes the names and values of the entries have.
    pub(crate) fn entries_len(&self) -> usize {
        self.end - self.start
    }

    #[cfg(test)]
    pub(crate) fn heap_size(&self) -> usize {
        self.bytes.capacity()
    }

    /// The whole scratch space as a field whose name is the first `name_len` bytes.
    pub(crate) fn scratch(&self, name_len: usize) -> Span {
        Span {
            position: self.origin + self.end as u64,
            name_len: name_len as u32,
            value_len: self.scratch_len().saturating_sub(name_len) as u32,
        }
    }

    /// Turns the scratch space into the bytes of the newest entry.
    pub(crate) fn keep_scratch(&mut self) {
        self.end = self.bytes.len();
    }

    /// Gives up the oldest entry. Its bytes stay readable until [`Self::clear_scratch`].
    pub(crate) fn release(&mut self, oldest: Span) {
        self.start = (self.start + oldest.len()).min(self.end);
    }

    /// `None` once the bytes have been reclaimed, which no caller has a `Span` of.
    pub(crate) fn name_and_value(&self, span: Span) -> Option<(&[u8], &[u8])> {
        let start = span.position.checked_sub(self.origin)? as usize;
        let field = self.bytes.get(start..)?.get(..span.len())?;
        field.split_at_checked(span.name_len as usize)
    }

    pub(crate) fn append_name_of(&mut self, span: Span) -> Option<()> {
        let start = span.position.checked_sub(self.origin)? as usize;
        let name = start..start + span.name_len as usize;
        self.bytes.get(name.clone())?;
        self.reserve(name.len());
        self.bytes.extend_from_within(name);
        Some(())
    }
}
