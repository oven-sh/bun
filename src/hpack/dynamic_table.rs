//! RFC 7541 §4.

use core::ops::Range;
use std::collections::VecDeque;

use crate::{DEFAULT_TABLE_SIZE, static_table};

const ENTRY_OVERHEAD: usize = 32;
const MIN_SPARE_LEN: usize = 128;
const MIN_SPARE_ENTRIES: usize = 8;
/// In bytes of memory.
const NOT_WORTH_FREEING: usize = 1024;
/// glibc up to 2.39 copies more with `rep movsb`, which Zen 3 and 4 are slow at for some distances (BZ 30994).
const MAX_COPY_LEN: usize = 2048;

/// What a field counts for in the size of a table.
#[inline(always)]
pub(crate) const fn entry_size(name_len: usize, value_len: usize) -> usize {
    name_len + value_len + ENTRY_OVERHEAD
}

/// Where the name and, right after it, the value of an entry are stored.
#[derive(Clone, Copy)]
pub(crate) struct Place {
    start: u32,
    /// 0 if the name is not stored, but in the static table.
    name_len: u32,
    value_len: u32,
    /// Of an entry with this name, or 0.
    pub(crate) static_index: u8,
}

impl Place {
    #[inline(always)]
    pub(crate) fn name(self) -> Name<'static> {
        match self.static_index {
            0 => Name::Stored(self.start, self.name_len),
            index => Name::Static(index),
        }
    }

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

#[derive(Clone, Copy)]
pub(crate) enum Name<'a> {
    Static(u8),
    /// The start and the length.
    Stored(u32, u32),
    New(&'a [u8]),
}

impl Name<'_> {
    #[inline(always)]
    pub(crate) fn static_index(self) -> u8 {
        match self {
            Self::Static(index) => index,
            _ => 0,
        }
    }
}

#[inline(always)]
fn range(start: u32, len: u32) -> Range<usize> {
    start as usize..start as usize + len as usize
}

pub(crate) struct Entry<T> {
    pub(crate) place: Place,
    pub(crate) links: T,
}

pub(crate) struct DynamicTable<T> {
    /// The newest comes first.
    entries: VecDeque<Entry<T>>,
    /// A ring. An entry that does not fit in at the end leaves a gap there.
    storage: Box<[u8]>,
    /// Where the newest entry ends.
    end: usize,
    /// How many entries have entered since `end` was at the start.
    in_this_lap: usize,
    size: usize,
    max_size: usize,
}

impl<T> DynamicTable<T> {
    pub(crate) fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            storage: Box::default(),
            end: 0,
            in_this_lap: 0,
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
        if self.holds_too_much() {
            self.relocate(0, Name::New(&[]));
        }
    }

    /// The newest has age 0.
    #[inline(always)]
    pub(crate) fn get(&self, age: usize) -> Option<&Entry<T>> {
        self.entries.get(age)
    }

    #[inline(always)]
    pub(crate) fn name<'a>(&'a self, name: Name<'a>) -> &'a [u8] {
        match name {
            Name::Static(index) => static_table::name(index),
            Name::Stored(start, len) => self.storage.get(range(start, len)).unwrap_or_default(),
            Name::New(bytes) => bytes,
        }
    }

    #[inline(always)]
    pub(crate) fn value(&self, place: Place) -> &[u8] {
        let value = range(place.start + place.name_len, place.value_len);
        self.storage.get(value).unwrap_or_default()
    }

    /// Returns `None` if the field is too large to enter. What that evicts stays in its place for now.
    #[inline(always)]
    pub(crate) fn insert(&mut self, mut name: Name<'_>, value: &[u8], links: T) -> Option<Place> {
        let name_len = self.name(name).len();
        let size = entry_size(name_len, value.len());
        self.evict_down_to(self.max_size.saturating_sub(size));
        if size > self.max_size {
            return None;
        }
        self.size += size;

        let static_index = name.static_index();
        let name_len = if static_index == 0 { name_len } else { 0 };
        let len = name_len + value.len();
        if self.holds_too_much() || !self.find_room(len) {
            name = self.relocate(len, name);
        }
        let start = self.end;
        if let Name::Stored(from, len) = name {
            let from = range(from, len);
            debug_assert!(!(from.start + 1..from.end).contains(&start));
            for at in from.clone().step_by(MAX_COPY_LEN) {
                let piece = at..from.end.min(at + MAX_COPY_LEN);
                self.storage.copy_within(piece, start + at - from.start);
            }
        }
        let room = self.storage.get_mut(start..start + len).unwrap_or_default();
        let (for_name, for_value) = room.split_at_mut(name_len);
        if let Name::New(bytes) = name {
            for_name.copy_from_slice(bytes);
        }
        for_value.copy_from_slice(value);

        let place = Place {
            start: start as u32,
            name_len: name_len as u32,
            value_len: value.len() as u32,
            static_index,
        };
        self.entries.push_front(Entry { place, links });
        self.end += len;
        self.in_this_lap += 1;
        Some(place)
    }

    #[inline(always)]
    fn evict_down_to(&mut self, size: usize) {
        while let Some(oldest) = self.entries.pop_back_if(|_| self.size > size) {
            self.size -= oldest.place.size();
        }
    }

    /// Returns whether `len` bytes are free at `end`, which may go back to the start for that.
    #[inline(always)]
    fn find_room(&mut self, len: usize) -> bool {
        let oldest = self.entries.back();
        let oldest = oldest.map_or(self.storage.len(), |entry| entry.place.start as usize);
        if self.in_this_lap < self.entries.len() {
            return oldest - self.end >= len;
        }
        if self.storage.len() - self.end >= len {
            return true;
        }
        (self.end, self.in_this_lap) = (0, 0);
        oldest >= len
    }

    /// Never right after [`Self::relocate`].
    #[inline(always)]
    fn holds_too_much(&self) -> bool {
        const { assert!(size_of::<Entry<T>>() <= ENTRY_OVERHEAD) };
        let held = self.storage.len() + self.entries.capacity() * size_of::<Entry<T>>();
        held > 2 * self.size + NOT_WORTH_FREEING
    }

    fn capacity_for(&self, used: usize, len: usize) -> usize {
        let needed = used + len;
        // Moving that much is cheap. Beyond it, what is spare has to be in proportion to what moves.
        let limit = match self.max_size {
            ..=DEFAULT_TABLE_SIZE => DEFAULT_TABLE_SIZE,
            _ => u32::MAX as usize,
        };
        limit.min(needed + used.min(needed / 2) + MIN_SPARE_LEN)
    }

    /// Moves the entries to new storage that has at least `len` bytes for the next, and its name with them.
    #[cold]
    #[inline(never)]
    fn relocate<'a>(&mut self, len: usize, mut name: Name<'a>) -> Name<'a> {
        let entries = self.entries.iter();
        let used: usize = entries.map(|entry| entry.place.stored_len()).sum();
        let capacity = self.capacity_for(used, len);
        let mut storage = Vec::with_capacity(capacity);
        let mut keep = |start: &mut u32, len: u32| {
            let bytes = self.storage.get(range(*start, len)).unwrap_or_default();
            *start = storage.len() as u32;
            for piece in bytes.chunks(MAX_COPY_LEN) {
                storage.extend_from_slice(piece);
            }
        };
        for Entry { place, .. } in self.entries.iter_mut().rev() {
            keep(&mut place.start, place.name_len + place.value_len);
        }
        if let Name::Stored(start, len) = &mut name {
            keep(start, *len);
        }
        storage.resize(capacity, 0);
        (self.end, self.in_this_lap) = (used, self.entries.len());
        self.entries
            .shrink_to(2 * self.entries.len() + MIN_SPARE_ENTRIES);
        self.storage = storage.into();
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const AGE: Name<'_> = Name::Static(21);

    fn with_max_size<T>(max_size: usize) -> DynamicTable<T> {
        let mut table = DynamicTable::new();
        table.set_max_size(max_size);
        table
    }

    /// Returns whether the entries have moved.
    fn insert<T: Default>(table: &mut DynamicTable<T>, len: usize) -> bool {
        let before = table.storage.as_ptr();
        table.insert(AGE, &vec![0; len], T::default());
        table.storage.as_ptr() != before
    }

    fn held<T>(table: &DynamicTable<T>) -> (usize, usize) {
        (table.storage.len(), table.entries.capacity())
    }

    #[test]
    fn storage_follows_the_entries() {
        for (max_size, lens, storage) in [
            (4096, &[][..], 0),
            (4096, &[4062], 0),
            (4096, &[0], 0),
            (4096, &[1], 129),
            (4096, &[1, 128], 129),
            (4096, &[1, 129], 259),
            (4096, &[1000, 1000], 3128),
            (4096, &[1000, 200], 1928),
            (4096, &[1000, 1000, 1000, 900], 4096),
            (4096, &[4061], 4096),
            (4097, &[4061], 4189),
            (4096, &[4000, 4000], 4096),
            (4096, &[4000, 1533], 4096),
            (4096, &[4000, 1532], 1660),
            (4096, &[4000, 5000], 4096),
            (4096, &[4000, 5000, 0], 128),
            (100, &[65, 65, 65, 65], 193),
        ] {
            let mut table = with_max_size::<()>(max_size);
            for &len in lens {
                insert(&mut table, len);
            }
            assert_eq!(held(&table).0, storage, "{lens:?}");
        }
    }

    #[test]
    fn places_fit_in_32_bits() {
        let table = with_max_size::<()>(u32::MAX as usize);
        assert_eq!(table.capacity_for(4_000_000_000, 1), u32::MAX as usize);
    }

    #[test]
    fn equal_entries_go_round_without_moving() {
        for len in [0, 1, 50, 777, 1300, 2013, 4061] {
            let mut table = DynamicTable::<()>::new();
            let moves = (0..1000).map(|_| insert(&mut table, len));
            assert_eq!(moves.skip(200).filter(|&moved| moved).count(), 0, "{len}");
        }
    }

    fn check_bounds<T: Default>() {
        for max_size in [100, 1000, 4096, 5000, 70_000, 300_000] {
            for max_len in [1, 20, 300, 2000, 65_000] {
                let mut table = with_max_size::<T>(max_size);
                let (mut inserted, mut moved, mut state) = (0, 0, 1_usize);
                for _ in 0..3000 {
                    state = state
                        .wrapping_mul(6_364_136_223_846_793_005)
                        .wrapping_add(1);
                    let len = (state >> 33) % max_len.min(max_size - 34);
                    if insert(&mut table, len) {
                        moved += table.end - len;
                        assert!(!table.holds_too_much());
                    }
                    inserted += len;
                    let (storage, entries) = held(&table);
                    match max_size {
                        ..=4096 => assert!(storage <= 4096),
                        _ => assert!(storage <= max_size + max_size / 2 + 128),
                    }
                    assert!(storage + entries * size_of::<Entry<T>>() <= 4 * table.size + 1024);
                }
                assert!(moved <= 3 * inserted, "{max_size} {max_len}");
            }
        }
    }

    #[test]
    fn memory_and_moves_are_bounded() {
        check_bounds::<()>();
        check_bounds::<[u32; 3]>();
    }

    #[test]
    fn gives_back_what_a_larger_table_took() {
        let mut table = with_max_size::<()>(1 << 20);
        for _ in 0..20_000 {
            insert(&mut table, 1);
        }
        let before = held(&table);
        table.set_max_size(36 * 19_000);
        assert_eq!(held(&table), before);
        table.set_max_size(36 * 10);
        assert_eq!(held(&table), (143, 28));
        table.set_max_size(0);
        assert_eq!(held(&table), (143, 28));
    }

    #[test]
    fn gives_back_what_many_entries_took() {
        let mut table = DynamicTable::<()>::new();
        for _ in 0..200 {
            insert(&mut table, 0);
        }
        assert_eq!(held(&table), (0, 128));
        table.set_max_size(0);
        assert_eq!(held(&table), (128, 8));
    }

    #[test]
    fn gives_back_what_an_emptied_table_took() {
        let mut table = DynamicTable::<()>::new();
        insert(&mut table, 4000);
        insert(&mut table, 5000);
        table.set_max_size(0);
        assert_eq!(held(&table), (128, 4));
    }
}
