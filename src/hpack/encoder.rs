use bun_wyhash::Wyhash;

use crate::dynamic_table::entry_size;
use crate::searchable_table::{Name, SearchableTable};
use crate::{DEFAULT_TABLE_SIZE, equal, integer, literal, static_table};

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

/// The state of one direction of a connection.
pub struct Encoder {
    table: SearchableTable,
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
            table: SearchableTable::new(),
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
            && size != self.table.entries.max_size()
        {
            **history = History::new(size);
        }
        self.table.entries.set_max_size(size);
    }

    /// Starts a header block, which is appended to `out`.
    #[inline]
    pub fn block<'a>(&'a mut self, out: &'a mut Vec<u8>) -> Block<'a> {
        if let Some(smallest) = self.smallest_size.take() {
            let smallest = smallest as usize;
            integer::write(0x20, 5, smallest, |byte| out.push(byte));
            let size = self.table.entries.max_size();
            if smallest < size {
                integer::write(0x20, 5, size, |byte| out.push(byte));
            }
        }
        Block { encoder: self, out }
    }
}

#[inline(always)]
fn index(age: usize) -> usize {
    static_table::LEN + 1 + age
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
            if entry_size(name.bytes.len(), value.len()) <= encoder.table.entries.max_size() {
                let hash = Wyhash::hash(name.hash.into(), value) as u32;
                if let Some(age) = encoder.table.find_field(&name, value, hash, 0) {
                    if let Some(history) = &mut encoder.history {
                        history.add(hash);
                    }
                    return integer::write(0x80, 7, index(age), |byte| out.push(byte));
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
        let name_index = match name.static_index {
            0 => encoder.table.find_name(&name, 0).map(index),
            index => Some(index.into()),
        };
        if let Some(index) = name_index {
            integer::write(pattern, prefix_bits, index, |byte| out.push(byte));
        } else {
            out.push(pattern);
            literal::write(name.bytes, out);
        }
        literal::write(value, out);
        if let Some(hash) = to_insert {
            encoder.table.insert(&name, value, hash);
        }
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
