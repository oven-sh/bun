//! The dynamic table of an encoder.

use crate::dynamic_table::{self, DynamicTable, Entry};
use crate::{equal, wrapped, wrapped_mut};

/// Chains the entries of a bucket, from the newest on. Evicted entries drop out as their numbers no longer lead anywhere.
pub struct Links {
    field_hash: u32,
    name_hash: u32,
    older_by_field: u16,
    older_by_name: u16,
}

pub struct Name<'a> {
    pub bytes: &'a [u8],
    /// Of the first entry with this name in the static table of HPACK, or 0.
    pub static_index: u8,
    pub hash: u32,
}

pub struct SearchableTable {
    /// Not to be added to but by [`Self::insert`].
    pub entries: DynamicTable<Links>,
    next_number: u16,
    newest_by_field: [u16; 128],
    /// Without the names of the static table.
    newest_by_name: [u16; 32],
}

impl SearchableTable {
    pub fn new() -> Self {
        Self {
            entries: DynamicTable::new(),
            // Far from the zeros below.
            next_number: 0x8000,
            newest_by_field: [0; _],
            newest_by_name: [0; _],
        }
    }

    /// Returns an age.
    #[inline(always)]
    fn find(
        &self,
        newest: u16,
        min_age: usize,
        older: impl Fn(&Links) -> u16,
        matches: impl Fn(&Entry<Links>) -> bool,
    ) -> Option<usize> {
        let (mut number, mut last_distance) = (newest, 0);
        loop {
            let distance = usize::from(self.next_number.wrapping_sub(number));
            if distance <= last_distance {
                return None;
            }
            let entry = self.entries.get(distance - 1)?;
            if distance > min_age && matches(entry) {
                return Some(distance - 1);
            }
            (number, last_distance) = (older(&entry.links), distance);
        }
    }

    #[inline(always)]
    pub fn find_field(
        &self,
        name: &Name<'_>,
        value: &[u8],
        hash: u32,
        min_age: usize,
    ) -> Option<usize> {
        self.find(
            *wrapped(&self.newest_by_field, hash as usize),
            min_age,
            |links| links.older_by_field,
            |entry| {
                (entry.links.field_hash, entry.place.static_index) == (hash, name.static_index)
                    && equal(self.entries.value(entry.place), value)
                    && (name.static_index != 0
                        || equal(self.entries.name(entry.place.name()), name.bytes))
            },
        )
    }

    /// Not for a name with a static index.
    #[inline(always)]
    pub fn find_name(&self, name: &Name<'_>, min_age: usize) -> Option<usize> {
        self.find(
            *wrapped(&self.newest_by_name, name.hash as usize),
            min_age,
            |links| links.older_by_name,
            |entry| {
                entry.links.name_hash == name.hash
                    && equal(self.entries.name(entry.place.name()), name.bytes)
            },
        )
    }

    #[inline(always)]
    pub fn insert(&mut self, name: &Name<'_>, value: &[u8], field_hash: u32) {
        let number = self.next_number;
        self.next_number = number.wrapping_add(1);
        let newest = wrapped_mut(&mut self.newest_by_field, field_hash as usize);
        let older_by_field = core::mem::replace(newest, number);
        let (table_name, older_by_name) = match name.static_index {
            0 => {
                let newest = wrapped_mut(&mut self.newest_by_name, name.hash as usize);
                let older = core::mem::replace(newest, number);
                (dynamic_table::Name::New(name.bytes), older)
            }
            index => (dynamic_table::Name::Static(index), number),
        };
        let links = Links {
            field_hash,
            name_hash: name.hash,
            older_by_field,
            older_by_name,
        };
        self.entries.insert(table_name, value, links);
    }
}
