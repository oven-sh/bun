use core::ops::Range;
use std::collections::VecDeque;

use crate::storage::{Position, Storage};
use crate::{
    DEFAULT_TABLE_CAPACITY, ENTRY_OVERHEAD, Error, MAX_FIELD_LEN, Result, huffman, integer,
    static_table,
};

/// A header block and how far it has been decoded.
pub struct Block<'s> {
    src: &'s [u8],
    pos: usize,
}

impl<'s> Block<'s> {
    /// `src` is the whole block, CONTINUATION frames included.
    pub fn new(src: &'s [u8]) -> Self {
        Self { src, pos: 0 }
    }

    /// Picks up a block again at an earlier [`Self::position`].
    pub fn resume(src: &'s [u8], position: usize) -> Self {
        Self { src, pos: position }
    }

    /// How many bytes of the block have been decoded.
    pub fn position(&self) -> usize {
        self.pos
    }
}

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

/// Where the bytes of a name or value are once the field is decoded.
enum Bytes {
    Static(&'static [u8]),
    Source(Range<usize>),
    Stored(Range<usize>),
}

impl Bytes {
    fn len(&self) -> usize {
        match self {
            Bytes::Static(bytes) => bytes.len(),
            Bytes::Source(range) | Bytes::Stored(range) => range.len(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Literal {
    Indexed,
    NotIndexed,
    NeverIndexed,
}

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

impl Default for Decoder {
    fn default() -> Self {
        Self::new()
    }
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
        // Only the peer's encoder raises the capacity (§6.3).
        if self.capacity > max_capacity {
            self.set_capacity(max_capacity);
        }
    }

    /// The size of the dynamic table as §4.1 counts it.
    pub fn table_size(&self) -> usize {
        self.size
    }

    /// The next field of `block`, `None` at its end. An error is fatal to the connection (RFC 9113 §4.3).
    pub fn next<'a, 's: 'a>(&'a mut self, block: &mut Block<'s>) -> Option<Result<Field<'a>>> {
        if block.pos >= block.src.len() {
            return None;
        }
        Some(self.decode_field(block))
    }

    fn decode_field<'a, 's: 'a>(&'a mut self, block: &mut Block<'s>) -> Result<Field<'a>> {
        use Error::Invalid;

        self.storage.clear_scratch();
        let src = block.src;
        let mut pos = block.pos;
        let mut first = *src.get(pos).ok_or(Invalid)?;

        while first & 0xe0 == 0x20 {
            // §4.2: only at the beginning of a block.
            if block.pos != 0 {
                return Err(Invalid);
            }
            let capacity = integer::decode(src, &mut pos, 5).ok_or(Invalid)?;
            if capacity > self.max_capacity {
                return Err(Invalid);
            }
            self.set_capacity(capacity);
            first = *src.get(pos).ok_or(Invalid)?;
        }

        if first & 0x80 != 0 {
            let index = integer::decode(src, &mut pos, 7).ok_or(Invalid)?;
            block.pos = pos;
            return self.indexed_field(index);
        }

        let (kind, prefix_bits) = match first {
            0x40.. => (Literal::Indexed, 6),
            0x10.. => (Literal::NeverIndexed, 4),
            _ => (Literal::NotIndexed, 4),
        };
        let index = integer::decode(src, &mut pos, prefix_bits).ok_or(Invalid)?;

        // An entry's name and value are adjacent in `storage`, so both are copied there.
        let keep = kind == Literal::Indexed;
        let mut static_index = 0;
        let name = if index == 0 {
            let name = self.string(src, &mut pos, MAX_FIELD_LEN, keep)?;
            if name.len() == 0 {
                return Err(Invalid);
            }
            name
        } else if let Some((name, _)) = static_table::get(index) {
            static_index = index as u8;
            if keep {
                self.store(name)
            } else {
                Bytes::Static(name)
            }
        } else {
            let entry = self.entry(index).ok_or(Invalid)?;
            static_index = entry.static_index;
            let range = self.storage.range(entry.position, entry.name_len);
            if keep {
                let start = self.storage.len();
                self.storage.append_copy_of(range);
                Bytes::Stored(start..self.storage.len())
            } else {
                Bytes::Stored(range)
            }
        };
        let room = MAX_FIELD_LEN
            .checked_sub(name.len())
            .ok_or(Error::TooLarge)?;
        let value = self.string(src, &mut pos, room, keep)?;

        if keep {
            let entry = Entry {
                position: self.storage.keep_scratch(),
                name_len: name.len(),
                value_len: value.len(),
                static_index,
            };
            self.size += entry.size();
            self.entries.push_back(entry);
            // May evict the new entry, whose bytes stay readable for now.
            self.evict();
        }

        block.pos = pos;
        Ok(Field {
            name: self.bytes(src, name),
            value: self.bytes(src, value),
            never_index: kind == Literal::NeverIndexed,
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

    /// A string literal (§5.2) of at most `max_len` bytes.
    fn string(&mut self, src: &[u8], pos: &mut usize, max_len: usize, keep: bool) -> Result<Bytes> {
        let huffman = *src.get(*pos).ok_or(Error::Invalid)? & 0x80 != 0;
        let len = integer::decode(src, pos, 7).ok_or(Error::Invalid)? as usize;
        let range = *pos..pos.checked_add(len).ok_or(Error::Invalid)?;
        let encoded = src.get(range.clone()).ok_or(Error::Invalid)?;
        *pos = range.end;
        if huffman {
            let start = self.storage.len();
            huffman::decode(encoded, self.storage.bytes_mut(), max_len).map_err(
                |error| match error {
                    huffman::DecodeError::Invalid => Error::Invalid,
                    huffman::DecodeError::TooLong => Error::TooLarge,
                },
            )?;
            return Ok(Bytes::Stored(start..self.storage.len()));
        }
        if len > max_len {
            return Err(Error::TooLarge);
        }
        Ok(if keep {
            self.store(encoded)
        } else {
            Bytes::Source(range)
        })
    }

    fn store(&mut self, bytes: &[u8]) -> Bytes {
        let start = self.storage.len();
        self.storage.bytes_mut().extend_from_slice(bytes);
        Bytes::Stored(start..self.storage.len())
    }

    fn bytes<'a>(&'a self, src: &'a [u8], bytes: Bytes) -> &'a [u8] {
        match bytes {
            Bytes::Static(bytes) => bytes,
            Bytes::Source(range) => src.get(range).unwrap_or_default(),
            Bytes::Stored(range) => self.storage.get(range),
        }
    }

    /// `index` is past the static table. The newest entry comes first (§2.3.3).
    fn entry(&self, index: u32) -> Option<&Entry> {
        let age = (index as usize).checked_sub(static_table::LEN as usize + 1)?;
        self.entries.get(self.entries.len().checked_sub(age + 1)?)
    }

    fn set_capacity(&mut self, capacity: u32) {
        self.capacity = capacity;
        self.evict();
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
