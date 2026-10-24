use std::collections::VecDeque;

use crate::storage::{Position, Storage};
use crate::{
    DEFAULT_TABLE_CAPACITY, ENTRY_OVERHEAD, Error, Indexing, MAX_FIELD_LEN, Result, huffman,
    integer, static_table,
};

pub struct Field<'a> {
    pub name: &'a [u8],
    pub value: &'a [u8],
    /// It was sent as "never indexed" (§6.2.3).
    pub never_index: bool,
    /// The static table index the name was first taken from, 0 if the peer spelled it out.
    pub static_index: u8,
}

struct Entry {
    position: Position,
    name_len: usize,
    value_len: usize,
    static_index: u8,
}

impl Entry {
    fn size(&self) -> usize {
        self.name_len + self.value_len + ENTRY_OVERHEAD
    }
}

/// The room for entries that a lower capacity leaves. No table of the default capacity needs more.
const SPARE_ENTRIES: usize = DEFAULT_TABLE_CAPACITY as usize / ENTRY_OVERHEAD;

pub struct Decoder {
    /// Oldest first.
    entries: VecDeque<Entry>,
    storage: Storage,
    /// What the entries add up to (§4.1).
    size: usize,
    /// What `size` may reach. The peer picks it, up to `max_capacity`.
    capacity: u32,
    max_capacity: u32,
}

impl Decoder {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            storage: Storage::default(),
            size: 0,
            capacity: DEFAULT_TABLE_CAPACITY,
            max_capacity: DEFAULT_TABLE_CAPACITY,
        }
    }

    /// For when the peer has acknowledged another SETTINGS_HEADER_TABLE_SIZE.
    pub fn set_max_capacity(&mut self, max_capacity: u32) {
        self.max_capacity = max_capacity;
        // Not every encoder says so when it grows its table. More room than it uses does no harm: its entries are the newest.
        self.set_capacity(max_capacity);
    }

    /// The size of the dynamic table as §4.1 counts it.
    pub fn table_size(&self) -> usize {
        self.size
    }

    #[cfg(test)]
    pub(crate) fn heap_size(&self) -> usize {
        self.storage.heap_size() + self.entries.capacity() * size_of::<Entry>()
    }

    /// The field at `*pos`, 0 at first, of a whole header block. `None` at its end. An error is fatal to the connection.
    pub fn next(&mut self, block: &[u8], pos: &mut usize) -> Option<Result<Field<'_>>> {
        if *pos == 0
            && let Err(error) = self.size_updates(block, pos)
        {
            return Some(Err(error));
        }
        if *pos >= block.len() {
            return None;
        }
        Some(self.decode_field(block, pos))
    }

    /// The dynamic table size updates (§6.3) that a block may begin with.
    fn size_updates(&mut self, src: &[u8], pos: &mut usize) -> Result<()> {
        while src.get(*pos).is_some_and(|first| first & 0xe0 == 0x20) {
            let capacity = integer::decode(src, pos, 5).ok_or(Error::Invalid)?;
            if capacity > self.max_capacity {
                return Err(Error::Invalid);
            }
            self.set_capacity(capacity);
        }
        Ok(())
    }

    fn decode_field(&mut self, src: &[u8], field_pos: &mut usize) -> Result<Field<'_>> {
        use Error::Invalid;

        self.storage.clear_scratch();
        let mut pos = *field_pos;
        let first = *src.get(pos).ok_or(Invalid)?;

        if first & 0x80 != 0 {
            let index = integer::decode(src, &mut pos, 7).ok_or(Invalid)?;
            *field_pos = pos;
            return self.indexed_field(index);
        }

        let (indexing, prefix_bits) = match first {
            0x40.. => (Indexing::Add, 6),
            // §4.2: a size update after a field.
            0x20.. => return Err(Invalid),
            0x10.. => (Indexing::Never, 4),
            _ => (Indexing::Skip, 4),
        };
        let index = integer::decode(src, &mut pos, prefix_bits).ok_or(Invalid)?;

        // The name and then the value go to the scratch space, which is how an entry has them.
        let start = self.storage.len();
        let mut static_index = 0;
        if index == 0 {
            self.string(src, &mut pos, MAX_FIELD_LEN)?;
            if self.storage.len() == start {
                return Err(Invalid);
            }
        } else if let Some((name, _)) = static_table::get(index) {
            static_index = index as u8;
            self.storage.bytes_mut().extend_from_slice(name);
        } else {
            let entry = self.entry(index).ok_or(Invalid)?;
            static_index = entry.static_index;
            let name = self.storage.range(entry.position, entry.name_len);
            self.storage.append_copy_of(name);
        }
        let value_start = self.storage.len();
        let room = MAX_FIELD_LEN
            .checked_sub(value_start - start)
            .ok_or(Error::TooLarge)?;
        self.string(src, &mut pos, room)?;
        let end = self.storage.len();

        if indexing == Indexing::Add {
            let entry = Entry {
                position: self.storage.keep_scratch(),
                name_len: value_start - start,
                value_len: end - value_start,
                static_index,
            };
            self.size += entry.size();
            self.entries.push_back(entry);
            // May evict the new entry, whose bytes stay readable for now.
            self.evict();
        }

        *field_pos = pos;
        Ok(Field {
            name: self.storage.get(start..value_start),
            value: self.storage.get(value_start..end),
            never_index: indexing == Indexing::Never,
            static_index,
        })
    }

    fn indexed_field(&self, index: u32) -> Result<Field<'_>> {
        if let Some((name, value)) = static_table::get(index) {
            return Ok(Field {
                name,
                value,
                never_index: false,
                static_index: index as u8,
            });
        }
        let entry = self.entry(index).ok_or(Error::Invalid)?;
        let name = self.storage.range(entry.position, entry.name_len);
        let value = name.end..name.end + entry.value_len;
        Ok(Field {
            name: self.storage.get(name),
            value: self.storage.get(value),
            never_index: false,
            static_index: entry.static_index,
        })
    }

    /// Appends a string literal (§5.2) of at most `max_len` bytes to the scratch space.
    fn string(&mut self, src: &[u8], pos: &mut usize, max_len: usize) -> Result<()> {
        let huffman = *src.get(*pos).ok_or(Error::Invalid)? & 0x80 != 0;
        let len = integer::decode(src, pos, 7).ok_or(Error::Invalid)? as usize;
        let end = pos.checked_add(len).ok_or(Error::Invalid)?;
        let encoded = src.get(*pos..end).ok_or(Error::Invalid)?;
        *pos = end;
        if huffman {
            return huffman::decode(encoded, self.storage.bytes_mut(), max_len);
        }
        if len > max_len {
            return Err(Error::TooLarge);
        }
        self.storage.bytes_mut().extend_from_slice(encoded);
        Ok(())
    }

    /// `index` is past the static table. The newest entry comes first (§2.3.3).
    fn entry(&self, index: u32) -> Option<&Entry> {
        let age = (index as usize).checked_sub(static_table::LEN as usize + 1)?;
        self.entries.get(self.entries.len().checked_sub(age + 1)?)
    }

    fn set_capacity(&mut self, capacity: u32) {
        self.capacity = capacity;
        self.evict();
        // The connection may send no field for a long time, so what left the table is given back now.
        self.storage.clear_scratch();
        let keep = self.entries.len() + SPARE_ENTRIES;
        if self.entries.capacity() / 4 > keep {
            self.entries.shrink_to(keep);
        }
    }

    fn evict(&mut self) {
        while self.size > self.capacity as usize {
            let Some(entry) = self.entries.pop_front() else {
                return;
            };
            self.size -= entry.size();
            self.storage.release(entry.name_len + entry.value_len);
        }
    }
}
