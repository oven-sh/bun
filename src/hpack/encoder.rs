use bun_wyhash::Wyhash;

use crate::dynamic_table::{self, DynamicTable, Entry, entry_size};
use crate::{DEFAULT_TABLE_SIZE, equal, huffman, integer, static_table, wrapped, wrapped_mut};

/// The peer may allow more.
const MAX_TABLE_SIZE: usize = DEFAULT_TABLE_SIZE;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Indexing {
    /// As the encoder sees fit.
    Allowed,
    /// The field stays out of the table of this connection.
    Without,
    /// The field stays out of the tables of later hops too (RFC 7541 §6.2.3).
    Never,
}

/// Chains the entries of a bucket, from the newest on. Evicted entries drop out as their numbers no longer lead anywhere.
struct Links {
    field_hash: u32,
    name_hash: u32,
    older_by_field: u16,
    older_by_name: u16,
}

/// The state of one direction of a connection.
pub struct Encoder {
    table: DynamicTable<Links>,
    next_number: u16,
    newest_by_field: [u16; 128],
    /// Without the names of the static table.
    newest_by_name: [u16; 32],
    /// Of those that the peer has asked for since the last block.
    smallest_size: Option<u32>,
    history: Option<Box<History>>,
}

/// A header block in the making. The peer has to get all of them, in order.
pub struct Block<'a> {
    encoder: &'a mut Encoder,
    out: &'a mut Vec<u8>,
}

impl Encoder {
    /// Indexes every field that it may.
    pub fn new() -> Self {
        Self {
            table: DynamicTable::new(),
            // Far from the zeros below.
            next_number: 0x8000,
            newest_by_field: [0; _],
            newest_by_name: [0; _],
            smallest_size: None,
            history: None,
        }
    }

    /// After the first few fields, indexes only those that it has recently seen.
    pub fn with_history() -> Self {
        let history = Some(Box::new(History::new(MAX_TABLE_SIZE)));
        Self {
            history,
            ..Self::new()
        }
    }

    /// For when the peer sends a `SETTINGS_HEADER_TABLE_SIZE`.
    pub fn set_max_table_size(&mut self, max_table_size: u32) {
        let smallest = self.smallest_size.unwrap_or(MAX_TABLE_SIZE as u32);
        self.smallest_size = Some(smallest.min(max_table_size));
        let size = MAX_TABLE_SIZE.min(max_table_size as usize);
        if let Some(history) = &mut self.history
            && size != self.table.max_size()
        {
            **history = History::new(size);
        }
        self.table.set_max_size(size);
    }

    /// Starts a header block, which is appended to `out`.
    #[inline]
    pub fn block<'a>(&'a mut self, out: &'a mut Vec<u8>) -> Block<'a> {
        if let Some(smallest) = self.smallest_size.take() {
            let smallest = smallest as usize;
            integer::write(0x20, 5, smallest, |byte| out.push(byte));
            if smallest < self.table.max_size() {
                integer::write(0x20, 5, self.table.max_size(), |byte| out.push(byte));
            }
        }
        Block { encoder: self, out }
    }

    /// Returns an index.
    #[inline(always)]
    fn find(
        &self,
        newest: u16,
        older: impl Fn(&Links) -> u16,
        matches: impl Fn(&Entry<Links>) -> bool,
    ) -> Option<usize> {
        let (mut number, mut last_distance) = (newest, 0);
        loop {
            let distance = usize::from(self.next_number.wrapping_sub(number));
            if distance <= last_distance {
                return None;
            }
            let entry = self.table.get(distance - 1)?;
            if matches(entry) {
                return Some(static_table::LEN + distance);
            }
            (number, last_distance) = (older(&entry.links), distance);
        }
    }

    #[inline(always)]
    fn find_field(&self, name: &Name<'_>, value: &[u8], hash: u32) -> Option<usize> {
        self.find(
            *wrapped(&self.newest_by_field, hash as usize),
            |links| links.older_by_field,
            |entry| {
                (entry.links.field_hash, entry.place.static_index) == (hash, name.static_index)
                    && equal(self.table.value(entry.place), value)
                    && (name.static_index != 0
                        || equal(self.table.name(entry.place.name()), name.bytes))
            },
        )
    }

    #[inline(always)]
    fn find_name(&self, name: &Name<'_>) -> Option<usize> {
        if name.static_index != 0 {
            return Some(name.static_index.into());
        }
        self.find(
            *wrapped(&self.newest_by_name, name.hash as usize),
            |links| links.older_by_name,
            |entry| {
                entry.links.name_hash == name.hash
                    && equal(self.table.name(entry.place.name()), name.bytes)
            },
        )
    }

    #[inline(always)]
    fn insert(&mut self, name: &Name<'_>, value: &[u8], field_hash: u32) {
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
        self.table.insert(table_name, value, links);
    }
}

struct Name<'a> {
    bytes: &'a [u8],
    /// Of the first entry with this name, or 0.
    static_index: u8,
    hash: u32,
}

impl Block<'_> {
    pub fn field(&mut self, name: &[u8], value: &[u8], indexing: Indexing) {
        let Self { encoder, out } = self;
        let mut same_name = static_table::find(name);
        let name = Name {
            bytes: name,
            static_index: same_name.start,
            hash: match same_name.start {
                0 => Wyhash::hash(0, name) as u32,
                index => index.into(),
            },
        };

        let mut to_insert = None;
        if indexing != Indexing::Never {
            if let Some(index) = same_name.find(|&index| equal(static_table::value(index), value)) {
                if let Some(history) = &mut encoder.history {
                    history.add(0);
                }
                return out.push(0x80 | index);
            }
            if entry_size(name.bytes.len(), value.len()) <= encoder.table.max_size() {
                let hash = Wyhash::hash(name.hash.into(), value) as u32;
                if let Some(index) = encoder.find_field(&name, value, hash) {
                    if let Some(history) = &mut encoder.history {
                        history.add(hash);
                    }
                    return integer::write(0x80, 7, index, |byte| out.push(byte));
                }
                let is_worth_it = encoder
                    .history
                    .as_mut()
                    .is_none_or(|history| history.add_and_judge(hash));
                to_insert = (is_worth_it && indexing == Indexing::Allowed).then_some(hash);
            }
        }

        let (pattern, prefix_bits) = match (to_insert, indexing) {
            (Some(_), _) => (0x40, 6),
            (None, Indexing::Never) => (0x10, 4),
            (None, _) => (0x00, 4),
        };
        if let Some(index) = encoder.find_name(&name) {
            integer::write(pattern, prefix_bits, index, |byte| out.push(byte));
        } else {
            out.push(pattern);
            write_literal(name.bytes, out);
        }
        write_literal(value, out);
        if let Some(hash) = to_insert {
            encoder.insert(&name, value, hash);
        }
    }
}

/// A string literal (RFC 7541 §5.2).
fn write_literal(text: &[u8], out: &mut Vec<u8>) {
    const SHORT_ROOM: [u8; 64] = [0; _];
    let start = out.len();
    let text_start = start + integer::written_len(7, text.len());
    let end = text_start + text.len() + huffman::SLACK;
    if end - start <= SHORT_ROOM.len() {
        out.extend_from_slice(&SHORT_ROOM);
    } else {
        out.resize(end, 0);
    }
    let room = out.get_mut(text_start..end).unwrap_or_default();
    if let Some(len @ 1..) = huffman::encode(text, room) {
        out.truncate(text_start + len);
        let mut at = start;
        #[expect(clippy::indexing_slicing, reason = "a smaller number is no longer")]
        integer::write(0x80, 7, len, |byte| {
            out[at] = byte;
            at += 1;
        });
        if at < text_start {
            out.drain(at..text_start);
        }
    } else {
        out.truncate(start);
        integer::write(0x00, 7, text.len(), |byte| out.push(byte));
        out.extend_from_slice(text);
    }
}

/// A third of the most entries that a table can have, which is about how many it usually has.
const fn history_len(table_size: usize) -> usize {
    table_size / entry_size(0, 0) / 3
}

/// The hashes of the latest fields.
struct History {
    hashes: [u32; history_len(MAX_TABLE_SIZE)],
    len: usize,
    next: usize,
    is_full: bool,
}

impl History {
    fn new(table_size: usize) -> Self {
        Self {
            hashes: [0; _],
            len: history_len(table_size),
            next: 0,
            is_full: false,
        }
    }

    #[inline(always)]
    #[expect(clippy::indexing_slicing, reason = "`next` is 0 or less than `len`")]
    fn add(&mut self, hash: u32) {
        self.hashes[self.next] = hash;
        self.next += 1;
        if self.next >= self.len {
            self.next = 0;
            self.is_full = self.len != 0;
        }
    }

    /// Returns whether to index the field.
    #[inline(always)]
    fn add_and_judge(&mut self, hash: u32) -> bool {
        let hashes = self.hashes.iter();
        let is_repeated = hashes.fold(false, |found, &other| found | (other == hash));
        self.add(hash);
        is_repeated || !self.is_full
    }
}
