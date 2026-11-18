use core::cell::Cell;

use bun_alloc::AllocError;
use bun_engine_macros::FieldOffsets;
use bun_engine_text::{Identifier, PropertyName, home_slot};

use crate::{Attributes, DontEnumMode, PropertyNameMode, PropertyOffset};

#[derive(Clone, FieldOffsets)]
#[repr(C)]
pub struct PropertyEntry {
    /// `None` once the property has been removed.
    key: Option<Identifier>,
    offset: PropertyOffset,
    attributes: Attributes,
}

impl PropertyEntry {
    /// Unless it has been removed.
    #[inline(always)]
    pub(crate) fn name_and_offset(&self) -> Option<(PropertyName<'_>, PropertyOffset)> {
        Some((self.key.as_ref()?.name(), self.offset))
    }

    /// Unless it has been removed, is not enumerable or has a symbol for a key.
    #[inline(always)]
    pub(crate) fn as_enumerable_string(&self) -> Option<(PropertyName<'_>, PropertyOffset)> {
        let name = self.key.as_ref()?.name();
        (self.attributes.is_enumerable() && !name.is_symbol()).then_some((name, self.offset))
    }
}

/// Up to this many entries are searched in order.
const LINEAR_LIMIT: usize = 8;

/// The properties of a shape, in the order in which they were added.
#[derive(Clone, Default)]
pub(crate) struct PropertyTable {
    entries: Vec<PropertyEntry>,
    /// Linear probing. A slot is the index of an entry that has a key, plus one, or zero.
    index: Box<[u32]>,
    live: u32,
    deleted_offsets: Vec<PropertyOffset>,
    reported_size: ReportedSize,
}

/// How much of the memory the heap knows to have been allocated. Of that of a copy, nothing.
#[derive(Default)]
struct ReportedSize(Cell<usize>);

impl Clone for ReportedSize {
    fn clone(&self) -> ReportedSize {
        ReportedSize::default()
    }
}

impl PropertyTable {
    pub(crate) fn clone_with_capacity(&self, capacity: usize) -> PropertyTable {
        let mut entries = Vec::with_capacity(capacity.max(self.entries.len()));
        entries.extend_from_slice(&self.entries);
        PropertyTable {
            entries,
            index: self.index.clone(),
            live: self.live,
            deleted_offsets: self.deleted_offsets.clone(),
            reported_size: ReportedSize::default(),
        }
    }

    pub(crate) fn with_capacity(capacity: usize) -> PropertyTable {
        PropertyTable {
            entries: Vec::with_capacity(capacity),
            ..PropertyTable::default()
        }
    }

    /// Adding that many allocates nothing.
    pub(crate) fn try_with_room_for(count: usize) -> Result<PropertyTable, AllocError> {
        if count > PropertyOffset::MAX_OUT_OF_LINE_CAPACITY {
            return Err(AllocError);
        }
        let (mut entries, mut index) = (Vec::new(), Vec::new());
        entries.try_reserve_exact(count).map_err(|_| AllocError)?;
        if count > LINEAR_LIMIT {
            let capacity = (count * 2).next_power_of_two();
            index.try_reserve_exact(capacity).map_err(|_| AllocError)?;
            index.resize(capacity, 0);
        }
        Ok(PropertyTable {
            entries,
            index: index.into_boxed_slice(),
            ..PropertyTable::default()
        })
    }

    pub(crate) fn len(&self) -> usize {
        self.live as usize
    }

    /// By how much it has grown since the last call.
    #[inline]
    pub(super) fn take_growth(&self) -> usize {
        let size = self.memory_size();
        size.saturating_sub(self.reported_size.0.replace(size))
    }

    #[inline]
    pub(crate) fn memory_size(&self) -> usize {
        size_of::<PropertyTable>()
            + self.entries.capacity() * size_of::<PropertyEntry>()
            + size_of_val(&*self.index)
    }

    #[inline]
    fn position(&self, name: PropertyName<'_>) -> Option<usize> {
        let has_name = |entry: &PropertyEntry| entry.key.as_ref().is_some_and(|key| *key == name);
        if self.index.is_empty() {
            return self.entries.iter().position(has_name);
        }
        let mask = self.index.len() - 1;
        let mut slot = home_slot(name.hash(), mask);
        loop {
            let position = (self.index[slot] as usize).checked_sub(1)?;
            if has_name(&self.entries[position]) {
                return Some(position);
            }
            slot = (slot + 1) & mask;
        }
    }

    #[inline]
    pub(crate) fn get(&self, name: PropertyName<'_>) -> Option<(PropertyOffset, Attributes)> {
        let entry = &self.entries[self.position(name)?];
        Some((entry.offset, entry.attributes))
    }

    /// The offset that `add` gives to the next property.
    #[inline]
    pub(crate) fn next_offset(&self, inline_capacity: usize) -> PropertyOffset {
        match self.deleted_offsets.last() {
            Some(&offset) => offset,
            None => PropertyOffset::for_slot(self.len(), inline_capacity),
        }
    }

    /// The table does not have the name.
    #[inline]
    pub(crate) fn add(
        &mut self,
        name: PropertyName<'_>,
        attributes: Attributes,
        inline_capacity: usize,
    ) -> PropertyOffset {
        debug_assert!(self.position(name).is_none());
        let offset = self.next_offset(inline_capacity);
        self.deleted_offsets.pop();
        self.entries.push(PropertyEntry {
            key: Some(name.to_identifier()),
            offset,
            attributes,
        });
        self.live += 1;
        if self.entries.len() * 2 > self.index.len() {
            if self.entries.len() > LINEAR_LIMIT {
                self.rebuild();
            }
        } else {
            Self::insert(&mut self.index, name, self.entries.len() as u32);
        }
        offset
    }

    /// The position of the property, which is added without attributes if it is not there. Nothing has been removed.
    #[inline]
    pub(crate) fn find_or_add(&mut self, name: PropertyName<'_>, inline_capacity: usize) -> usize {
        self.position(name).unwrap_or_else(|| {
            self.add(name, Attributes::NONE, inline_capacity);
            self.entries.len() - 1
        })
    }

    fn insert(index: &mut [u32], name: PropertyName<'_>, value: u32) {
        let mask = index.len() - 1;
        let mut slot = home_slot(name.hash(), mask);
        while index[slot] != 0 {
            slot = (slot + 1) & mask;
        }
        index[slot] = value;
    }

    #[cold]
    fn rebuild(&mut self) {
        self.entries.retain(|entry| entry.key.is_some());
        if self.entries.len() <= LINEAR_LIMIT {
            self.index = Box::default();
            return;
        }
        let capacity = (self.entries.len() * 3).next_power_of_two();
        self.index = vec![0; capacity].into_boxed_slice();
        for (position, entry) in self.entries.iter().enumerate() {
            if let Some(key) = &entry.key {
                Self::insert(&mut self.index, key.name(), position as u32 + 1);
            }
        }
    }

    /// Moves up those that would not be found past the gap.
    fn remove_from_index(&mut self, name: PropertyName<'_>, position: usize) {
        let mask = self.index.len() - 1;
        let mut gap = home_slot(name.hash(), mask);
        while self.index[gap] as usize != position + 1 {
            gap = (gap + 1) & mask;
        }
        let mut slot = (gap + 1) & mask;
        while let Some(other) = (self.index[slot] as usize).checked_sub(1) {
            let key = self.entries[other].key.as_ref().expect("in the index");
            let distance_from = |start: usize| slot.wrapping_sub(start) & mask;
            if distance_from(home_slot(key.name().hash(), mask)) >= distance_from(gap) {
                self.index[gap] = self.index[slot];
                gap = slot;
            }
            slot = (slot + 1) & mask;
        }
        self.index[gap] = 0;
    }

    pub(crate) fn remove(&mut self, name: PropertyName<'_>) -> Option<PropertyOffset> {
        let position = self.position(name)?;
        let offset = self.entries[position].offset;
        if self.index.is_empty() {
            self.entries.remove(position);
        } else {
            self.remove_from_index(name, position);
            self.entries[position].key = None;
            while self.entries.pop_if(|last| last.key.is_none()).is_some() {}
        }
        self.live -= 1;
        self.deleted_offsets.push(offset);
        if self.entries.len() > LINEAR_LIMIT && self.len() * 4 < self.entries.len() {
            self.rebuild();
        }
        Some(offset)
    }

    pub(crate) fn set_attributes(
        &mut self,
        name: PropertyName<'_>,
        attributes: Attributes,
    ) -> Option<PropertyOffset> {
        let position = self.position(name)?;
        self.entries[position].attributes = attributes;
        Some(self.entries[position].offset)
    }

    pub(crate) fn iter(
        &self,
    ) -> impl Iterator<Item = (PropertyName<'_>, PropertyOffset, Attributes)> {
        self.entries
            .iter()
            .filter_map(|entry| Some((entry.key.as_ref()?.name(), entry.offset, entry.attributes)))
    }

    pub(crate) fn entries(&self) -> &[PropertyEntry] {
        &self.entries
    }

    /// In the order of OrdinaryOwnPropertyKeys, without private names.
    pub(super) fn keys(&self, kinds: PropertyNameMode, mode: DontEnumMode) -> Keys<'_> {
        Keys {
            all: &self.entries,
            rest: self.entries.iter(),
            mode,
            is_at_symbols: kinds == PropertyNameMode::Symbols,
            wants_second_pass: kinds == PropertyNameMode::StringsAndSymbols,
            has_skipped_symbols: false,
        }
    }

    /// Of all properties but private elements.
    pub(crate) fn update_attributes(&mut self, update: impl Fn(Attributes) -> Attributes) {
        for entry in &mut self.entries {
            if (entry.key.as_ref()).is_some_and(|key| !key.name().is_private_element()) {
                entry.attributes = update(entry.attributes);
            }
        }
    }

    /// In that order. The others follow in theirs.
    pub(crate) fn move_to_front(&mut self, names: impl Iterator<Item = Identifier>) {
        let mut rank = vec![usize::MAX; self.entries.len()];
        for (number, name) in names.enumerate() {
            if let Some(position) = self.position(name.name()) {
                rank[position] = rank[position].min(number);
            }
        }
        let mut ranked: Vec<_> = rank.into_iter().zip(self.entries.drain(..)).collect();
        ranked.sort_by_key(|it| it.0);
        self.entries.extend(ranked.into_iter().map(|it| it.1));
        self.rebuild();
    }

    /// Closes the gaps between the offsets, and returns the old ones.
    pub(crate) fn renumber(&mut self, inline_capacity: usize) -> Vec<PropertyOffset> {
        self.deleted_offsets = Vec::new();
        self.entries
            .iter_mut()
            .filter(|entry| entry.key.is_some())
            .enumerate()
            .map(|(number, entry)| {
                let offset = PropertyOffset::for_slot(number, inline_capacity);
                core::mem::replace(&mut entry.offset, offset)
            })
            .collect()
    }
}

#[derive(Clone)]
pub(super) struct Keys<'a> {
    all: &'a [PropertyEntry],
    rest: core::slice::Iter<'a, PropertyEntry>,
    mode: DontEnumMode,
    is_at_symbols: bool,
    wants_second_pass: bool,
    has_skipped_symbols: bool,
}

impl<'a> Iterator for Keys<'a> {
    type Item = PropertyName<'a>;

    #[inline]
    fn next(&mut self) -> Option<PropertyName<'a>> {
        loop {
            for entry in &mut self.rest {
                if let Some(key) = &entry.key
                    && self.mode.includes(entry.attributes)
                {
                    match key.name().symbol_flags() {
                        None if !self.is_at_symbols => return Some(key.name()),
                        Some(flags) if !flags.is_private() => {
                            if self.is_at_symbols {
                                return Some(key.name());
                            }
                            self.has_skipped_symbols = true;
                        }
                        _ => {}
                    }
                }
            }
            if !(self.has_skipped_symbols && core::mem::take(&mut self.wants_second_pass)) {
                return None;
            }
            (self.rest, self.is_at_symbols) = (self.all.iter(), true);
        }
    }
}
