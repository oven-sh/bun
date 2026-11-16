//! RFC 7541 §4.

use std::collections::VecDeque;

use crate::{DEFAULT_TABLE_SIZE, static_table};

const ENTRY_OVERHEAD: usize = 32;
const MIN_STORAGE_LEN: usize = 512;
const MIN_ENTRIES: usize = 16;

/// What a field counts for in the size of a table.
#[inline(always)]
pub(crate) const fn entry_size(name_len: usize, value_len: usize) -> usize {
    name_len + value_len + ENTRY_OVERHEAD
}

/// Where the name and, right after it, the value of a field are stored.
#[derive(Clone, Copy)]
pub(crate) struct Place {
    /// Counts all bytes that the table has ever kept.
    start: usize,
    /// 0 if the name is not stored, but in the static table.
    pub(crate) name_len: u32,
    value_len: u32,
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
    /// The bytes of evicted entries, those of `entries` from the oldest on, and the room for more.
    storage: Vec<u8>,
    /// How many bytes are gone from the front of `storage`.
    dropped: usize,
    /// How many bytes of `storage` come before the room.
    used: usize,
    size: usize,
    max_size: usize,
}

impl<T> DynamicTable<T> {
    pub(crate) const fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            storage: Vec::new(),
            dropped: 0,
            used: 0,
            size: 0,
            max_size: DEFAULT_TABLE_SIZE,
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

    #[inline(always)]
    fn bytes(&self, start: usize, len: usize) -> &[u8] {
        let at = start - self.dropped;
        self.storage.get(at..at + len).unwrap_or_default()
    }

    #[inline(always)]
    pub(crate) fn name(&self, place: Place) -> &[u8] {
        match place.static_index {
            0 => self.bytes(place.start, place.name_len as usize),
            index => static_table::name(index),
        }
    }

    #[inline(always)]
    pub(crate) fn value(&self, place: Place) -> &[u8] {
        let start = place.start + place.name_len as usize;
        self.bytes(start, place.value_len as usize)
    }

    /// Makes the room at least `len` bytes long.
    #[inline(always)]
    pub(crate) fn make_room(&mut self, len: usize) {
        if self.storage.len() - self.used < len {
            self.compact();
            self.grow(len);
        }
    }

    /// Where the next entry goes.
    #[inline(always)]
    pub(crate) fn room(&mut self) -> &mut [u8] {
        self.storage.get_mut(self.used..).unwrap_or_default()
    }

    #[inline(always)]
    pub(crate) fn place_in_room(
        &self,
        static_index: u8,
        name_len: usize,
        value_len: usize,
    ) -> Place {
        Place {
            start: self.dropped + self.used,
            name_len: name_len as u32,
            value_len: value_len as u32,
            static_index,
        }
    }

    #[inline(always)]
    pub(crate) fn copy_name_to_room(&mut self, place: Place) {
        let at = place.start - self.dropped;
        let name = at..at + place.name_len as usize;
        self.storage.copy_within(name, self.used);
    }

    /// `place` is at the start of the room. Its bytes stay there for now even if it is too large to enter.
    #[inline(always)]
    pub(crate) fn insert(&mut self, place: Place, links: T) {
        let size = place.size();
        self.evict_down_to(self.max_size.saturating_sub(size));
        if size <= self.max_size {
            self.size += size;
            self.used += place.stored_len();
            self.entries.push_front(Entry { place, links });
        }
    }

    /// Gives back what a much larger field or table took.
    #[inline(always)]
    pub(crate) fn trim(&mut self) {
        let held = self.storage.len() + self.entries.capacity() * size_of::<Entry<T>>();
        if held / 4 > self.max_size.max(DEFAULT_TABLE_SIZE) {
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
    fn compact(&mut self) {
        let oldest = self.entries.back();
        let evicted = oldest.map_or(self.used, |entry| entry.place.start - self.dropped);
        self.storage.copy_within(evicted..self.used, 0);
        self.dropped += evicted;
        self.used -= evicted;
    }

    /// Leaves room to spare, in proportion to what [`Self::compact`] has to move.
    #[cold]
    #[inline(never)]
    fn grow(&mut self, len: usize) {
        let needed = self.used + len;
        if self.storage.len() < needed + needed / 4 {
            let new_len = MIN_STORAGE_LEN.max(needed + needed / 2);
            self.storage.reserve_exact(new_len - self.storage.len());
            self.storage.resize(new_len, 0);
            self.entries
                .reserve(MIN_ENTRIES.saturating_sub(self.entries.len()));
        }
    }

    #[cold]
    #[inline(never)]
    fn shrink(&mut self) {
        self.compact();
        self.storage.truncate(self.used);
        self.storage.shrink_to_fit();
        self.entries.shrink_to_fit();
    }
}
