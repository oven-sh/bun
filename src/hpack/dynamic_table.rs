//! RFC 7541 §4.

use std::collections::VecDeque;

use crate::static_table;

const ENTRY_OVERHEAD: usize = 32;
const MIN_STORAGE_LEN: usize = 512;

/// What a field counts for in the size of a table.
#[inline(always)]
pub(crate) const fn entry_size(name_len: usize, value_len: usize) -> usize {
    name_len + value_len + ENTRY_OVERHEAD
}

/// Where a field is in [`DynamicTable::storage`].
#[derive(Clone, Copy)]
pub(crate) struct Place {
    pub(crate) start: usize,
    /// 0 if the name is not stored, but in the static table.
    pub(crate) name_len: u32,
    pub(crate) value_len: u32,
    /// Of an entry with this name, or 0.
    pub(crate) static_index: u8,
}

impl Place {
    fn stored_len(self) -> usize {
        self.name_len as usize + self.value_len as usize
    }

    fn size(self) -> usize {
        entry_size(
            static_table::name(self.static_index).len(),
            self.stored_len(),
        )
    }
}

pub(crate) struct Entry<T> {
    pub(crate) place: Place,
    pub(crate) links: T,
}

pub(crate) struct DynamicTable<T> {
    /// The newest comes first.
    entries: VecDeque<Entry<T>>,
    /// The bytes of evicted entries, those of `entries` from the oldest on, and from `end` on room for more.
    storage: Vec<u8>,
    end: usize,
    size: usize,
    max_size: usize,
}

impl<T> DynamicTable<T> {
    pub(crate) const fn new(max_size: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            storage: Vec::new(),
            end: 0,
            size: 0,
            max_size,
        }
    }

    pub(crate) fn max_size(&self) -> usize {
        self.max_size
    }

    pub(crate) fn set_max_size(&mut self, max_size: usize) {
        self.max_size = max_size;
        self.evict_down_to(max_size);
    }

    /// The newest has age 0.
    #[inline(always)]
    pub(crate) fn get(&self, age: usize) -> Option<&Entry<T>> {
        self.entries.get(age)
    }

    /// The name is empty if it is not stored.
    #[inline(always)]
    pub(crate) fn stored(&self, place: Place) -> (&[u8], &[u8]) {
        let bytes = self.storage.get(place.start..).unwrap_or_default();
        let (name, rest) = bytes
            .split_at_checked(place.name_len as usize)
            .unwrap_or_default();
        (
            name,
            rest.get(..place.value_len as usize).unwrap_or_default(),
        )
    }

    #[inline(always)]
    pub(crate) fn field(&self, place: Place) -> (&[u8], &[u8]) {
        let (name, value) = self.stored(place);
        match place.static_index {
            0 => (name, value),
            index => (static_table::name(index), value),
        }
    }

    /// Makes the room at least `len` bytes long. Returns how far the entries have moved to the front for it.
    #[inline(always)]
    pub(crate) fn make_room(&mut self, len: usize) -> usize {
        if self.storage.len() - self.end >= len {
            return 0;
        }
        let moved = self.compact();
        self.grow(len);
        moved
    }

    /// Where the next entry goes, and its start.
    #[inline(always)]
    pub(crate) fn room(&mut self) -> (&mut [u8], usize) {
        let room = self.storage.get_mut(self.end..).unwrap_or_default();
        (room, self.end)
    }

    #[inline(always)]
    pub(crate) fn copy_to_room(&mut self, start: usize, len: usize) {
        self.storage.copy_within(start..start + len, self.end);
    }

    /// `place` is at the start of the room. Its bytes stay until the next [`Self::make_room`], even if it is too large to enter.
    #[inline(always)]
    pub(crate) fn insert(&mut self, place: Place, links: T) {
        let size = place.size();
        self.evict_down_to(self.max_size.saturating_sub(size));
        if size <= self.max_size {
            self.size += size;
            self.end += place.stored_len();
            self.entries.push_front(Entry { place, links });
        }
    }

    /// Gives back what a field much larger than the table took.
    #[inline(always)]
    pub(crate) fn trim(&mut self, retained_len: usize) {
        if self.storage.len() > retained_len {
            self.shrink();
        }
    }

    #[inline(always)]
    fn evict_down_to(&mut self, size: usize) {
        while let Some(oldest) = self.entries.pop_back_if(|_| self.size > size) {
            self.size -= oldest.place.size();
        }
    }

    #[cold]
    #[inline(never)]
    fn compact(&mut self) -> usize {
        let oldest = self.entries.back();
        let start = oldest.map_or(self.end, |entry| entry.place.start);
        self.storage.copy_within(start..self.end, 0);
        self.end -= start;
        for entry in &mut self.entries {
            entry.place.start -= start;
        }
        start
    }

    /// Leaves as much spare room as is in use, so that a byte is moved no more often than one is added.
    #[cold]
    #[inline(never)]
    fn grow(&mut self, len: usize) {
        let wanted = MIN_STORAGE_LEN.max(2 * self.end + len);
        if let Some(missing) = wanted.checked_sub(self.storage.len()) {
            self.storage.reserve(missing);
            self.storage.resize(self.storage.capacity(), 0);
        }
    }

    #[cold]
    #[inline(never)]
    fn shrink(&mut self) {
        self.compact();
        self.storage.truncate(self.end);
        self.storage.shrink_to_fit();
    }
}
