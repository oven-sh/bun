use core::sync::atomic::AtomicU16;
use std::sync::OnceLock;

use bun_engine_text::{CodeUnit, Text, with_text};

use super::data;
use super::rules::ZoneRules;

/// What a name stands for is looked up when it is first asked for.
pub(super) struct Entry {
    name_end: u32,
    /// Every thread that looks it up finds the same.
    pub(super) primary: AtomicU16,
    pub(super) rules: OnceLock<&'static ZoneRules>,
}

impl Entry {
    pub(super) const NOT_KNOWN_YET: u16 = u16::MAX;
    pub(super) const NOT_AVAILABLE: u16 = u16::MAX - 1;
}

/// `UTC`, then `data::names`.
pub(super) struct Table {
    names: String,
    entries: Vec<Entry>,
    /// Indices of entries by the hash of the name, with open addressing. The length is a power of two.
    slots: Vec<u16>,
}

impl Table {
    pub(super) const UTC: u16 = 0;
    const FREE: u16 = u16::MAX;
    const MAX_NAMES: usize = Entry::NOT_AVAILABLE as usize - 1;

    pub(super) fn get() -> &'static Table {
        static TABLE: OnceLock<Table> = OnceLock::new();
        TABLE.get_or_init(Table::load)
    }

    #[cold]
    fn load() -> Table {
        let source = data::names().ok();
        let count = (source.as_ref())
            .map_or(0, |names| names.item_count())
            .min(Table::MAX_NAMES);
        let mut table = Table {
            names: String::with_capacity(16 * count),
            entries: Vec::with_capacity(count + 1),
            slots: vec![Table::FREE; (2 * (count + 1)).next_power_of_two()],
        };
        table.push(b"UTC");
        for position in 0..count {
            let name = (source.as_ref()).and_then(|names| names.string_at(position).ok());
            table.push(name.unwrap_or_default());
        }
        table
    }

    fn push<T: CodeUnit>(&mut self, name: &[T]) {
        let slot = self.slot(name);
        let primary = if self.slots[slot] == Table::FREE {
            self.slots[slot] = self.len();
            Entry::NOT_KNOWN_YET
        } else {
            Entry::NOT_AVAILABLE
        };
        let ascii = |unit: &T| char::from(unit.to_u16() as u8 & 0x7f);
        self.names.extend(name.iter().map(ascii));
        self.entries.push(Entry {
            name_end: self.names.len() as u32,
            primary: AtomicU16::new(primary),
            rules: OnceLock::new(),
        });
    }

    pub(super) fn len(&self) -> u16 {
        self.entries.len() as u16
    }

    pub(super) fn entry(&self, index: u16) -> &Entry {
        &self.entries[usize::from(index)]
    }

    pub(super) fn name(&self, index: u16) -> &str {
        let before = &self.entries[..usize::from(index)];
        let start = before.last().map_or(0, |entry| entry.name_end);
        &self.names[start as usize..self.entry(index).name_end as usize]
    }

    /// Ignores ASCII case.
    pub(super) fn find(&self, name: Text<'_>) -> Option<u16> {
        let index = self.slots[with_text!(name, |units| self.slot(units))];
        (index != Table::FREE).then_some(index)
    }

    /// The slot of `name`, or the free one that it would go in.
    fn slot<T: CodeUnit>(&self, name: &[T]) -> usize {
        let hash = name.iter().fold(0u32, |hash, unit| {
            (hash ^ (unit.to_u32() | 0x20)).wrapping_mul(0x9e37_79b1)
        });
        let mask = self.slots.len() - 1;
        let mut slot = (hash >> 15) as usize & mask;
        while self.slots[slot] != Table::FREE && !self.is_named(self.slots[slot], name) {
            slot = (slot + 1) & mask;
        }
        slot
    }

    fn is_named<T: CodeUnit>(&self, index: u16, name: &[T]) -> bool {
        let own = self.name(index).as_bytes();
        own.len() == name.len()
            && own.iter().zip(name).all(|(&own, &unit)| {
                unit.is(own) || (unit.is(own ^ 0x20) && own.is_ascii_alphabetic())
            })
    }

    /// Those of the zone that the name is a link to, if it is one.
    pub(super) fn load_rules(&self, index: u16) -> &'static ZoneRules {
        let position = data::link_target(usize::from(index) - 1);
        self.entries
            .get(position + 1)
            .map_or(ZoneRules::UTC, |entry| {
                entry.rules.get_or_init(|| {
                    data::rules(position).map_or(ZoneRules::UTC, |it| Box::leak(Box::new(it)))
                })
            })
    }
}
