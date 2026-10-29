//! What enters the dynamic table, and which entry is referred to, is decided as in ls-hpack (MIT).

use std::collections::VecDeque;

use crate::storage::{Span, Storage};
use crate::{
    DEFAULT_TABLE_CAPACITY, ENTRY_OVERHEAD, Error, MAX_FIELD_LEN, Result, huffman, integer,
    static_table,
};

/// What the encoder may do with a field (§6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indexing {
    /// Enters the dynamic table, unless a table has it already, it does not fit, or the history keeps it out.
    Add,
    /// Left out of the table.
    Skip,
    /// Its value is spelled out and it stays out of the table, here and with whoever forwards it. For secrets (§7.1.3).
    Never,
}

struct Entry {
    span: Span,
    name_hash: u32,
    field_hash: u32,
    /// The next entry in the same bucket's `by_field` and `by_name` chains.
    next_by_field: Option<Id>,
    next_by_name: Option<Id>,
}

/// Entries are numbered as they are added. Wraps around.
type Id = u32;

/// Entries whose hash falls into one bucket, oldest first, so that eviction takes the first.
#[derive(Clone, Copy, Default)]
struct Chain {
    first: Option<Id>,
    last: Option<Id>,
}

impl Chain {
    /// Returns the entry that was the last until now.
    fn push(&mut self, id: Id) -> Option<Id> {
        let previous = self.last.replace(id);
        if previous.is_none() {
            self.first = Some(id);
        }
        previous
    }

    /// Removes the first entry, which `next` follows.
    fn pop(&mut self, next: Option<Id>) {
        self.first = next;
        if next.is_none() {
            self.last = None;
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Bucket {
    by_field: Chain,
    by_name: Chain,
}

/// The hashes of the `max_len` fields sent last. Once full, only a field found here enters the table.
struct History {
    hashes: Vec<u32>,
    max_len: usize,
    /// Where the oldest hash is.
    oldest: usize,
}

impl History {
    fn new(table_capacity: u32) -> Self {
        let mut history = Self {
            hashes: Vec::new(),
            max_len: 0,
            oldest: 0,
        };
        history.resize(table_capacity);
        history
    }

    fn resize(&mut self, table_capacity: u32) {
        // ls-hpack's `henc_hist_size`: a third of the entries the table has room for if they are all empty.
        self.max_len = table_capacity as usize / ENTRY_OVERHEAD / 3;
        self.hashes.rotate_left(self.oldest);
        self.oldest = 0;
        self.hashes
            .drain(..self.hashes.len().saturating_sub(self.max_len));
    }

    /// Takes note of a field. Returns whether it may enter the table.
    fn add(&mut self, hash: u32) -> bool {
        let seen = self.hashes.contains(&hash);
        if self.hashes.len() < self.max_len {
            self.hashes.push(hash);
        } else if let Some(oldest) = self.hashes.get_mut(self.oldest) {
            *oldest = hash;
            self.oldest = (self.oldest + 1) % self.hashes.len();
        }
        seen || self.hashes.len() < self.max_len || self.max_len == 0
    }
}

pub struct Encoder {
    /// Oldest first.
    entries: VecDeque<Entry>,
    storage: Storage,
    /// The `Id` the next entry gets.
    next_id: Id,
    /// A power of two of them.
    buckets: Vec<Bucket>,
    /// What the entries add up to (§4.1).
    size: usize,
    capacity: u32,
    /// The capacity changed since the last field. Holds the lowest it has been since.
    unannounced_capacity: Option<u32>,
    history: Option<History>,
}

impl Encoder {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            storage: Storage::default(),
            // About to wrap, as in ls-hpack, so that the tests cross the wrap.
            next_id: Id::MAX - 3,
            buckets: vec![Bucket::default(); 4],
            size: 0,
            capacity: DEFAULT_TABLE_CAPACITY,
            unannounced_capacity: None,
            history: None,
        }
    }

    /// One-off fields stay out of the dynamic table: after the first few dozen, only a field sent lately enters.
    pub fn with_history() -> Self {
        Self {
            history: Some(History::new(DEFAULT_TABLE_CAPACITY)),
            ..Self::new()
        }
    }

    /// The size of the dynamic table as §4.1 counts it.
    pub fn table_size(&self) -> usize {
        self.size
    }

    #[cfg(test)]
    pub(crate) fn heap_size(&self) -> usize {
        self.storage.heap_size()
            + self.entries.capacity() * size_of::<Entry>()
            + self.buckets.capacity() * size_of::<Bucket>()
    }

    /// Takes the peer's SETTINGS_HEADER_TABLE_SIZE, between blocks. The next field follows what its decoder has to hear.
    pub fn set_max_capacity(&mut self, max_capacity: u32) {
        // A peer that allows for more does not get to decide how much memory this side spends.
        let capacity = max_capacity.min(DEFAULT_TABLE_CAPACITY);
        let lowest = match self.unannounced_capacity {
            None if capacity == self.capacity => return,
            None => capacity,
            Some(lowest) => lowest.min(capacity),
        };
        self.unannounced_capacity = Some(lowest);
        self.capacity = capacity;
        self.evict();
        if let Some(history) = &mut self.history {
            history.resize(capacity);
        }
    }

    /// For when a block, or a part of one, was encoded and then not sent.
    pub fn discard_block(&mut self) {
        // The peer's table lacks what the block added. Emptying both brings them back in line.
        let capacity = core::mem::take(&mut self.capacity);
        self.evict();
        self.capacity = capacity;
        self.unannounced_capacity = Some(0);
    }

    /// §4.2: the decoder has to hear of the low point too, since that is what evicted entries.
    fn announce_capacity(&mut self, out: &mut Vec<u8>) {
        if let Some(lowest) = self.unannounced_capacity.take() {
            if lowest != self.capacity {
                integer::encode(out, 0x20, 5, lowest);
            }
            integer::encode(out, 0x20, 5, self.capacity);
        }
    }

    /// Appends the field to the header block in `out`. `TooLarge` is the one error, and leaves `out` and the table alone.
    pub fn encode(
        &mut self,
        out: &mut Vec<u8>,
        name: &[u8],
        value: &[u8],
        mut indexing: Indexing,
    ) -> Result<()> {
        let len = name.len().saturating_add(value.len());
        if len > MAX_FIELD_LEN {
            return Err(Error::TooLarge);
        }
        self.announce_capacity(out);

        let static_name = static_table::find_name(name);
        // Its index tells a name of the static table apart just as well.
        let name_hash = static_name.unwrap_or_else(|| bun_wyhash::hash(name) as u32);
        let field_hash = bun_wyhash::hash_with_seed(u64::from(name_hash), value) as u32;

        // A reference to an entry with the same value would not say "never indexed".
        let field_index = if indexing == Indexing::Never {
            None
        } else {
            static_name
                .and_then(|index| static_table::find(index, name, value))
                .or_else(|| self.find(name, value, field_hash))
        };
        // Adding it would only empty the table (§4.4).
        if indexing == Indexing::Add && len + ENTRY_OVERHEAD > self.capacity as usize {
            indexing = Indexing::Skip;
        }
        if let Some(history) = &mut self.history {
            let admitted = history.add(field_hash);
            if !admitted && indexing == Indexing::Add {
                indexing = Indexing::Skip;
            }
        }
        if let Some(index) = field_index {
            integer::encode(out, 0x80, 7, index);
            return Ok(());
        }

        let (flags, prefix_bits) = match indexing {
            Indexing::Add => (0x40, 6),
            Indexing::Skip => (0x00, 4),
            Indexing::Never => (0x10, 4),
        };
        match static_name.or_else(|| self.find_name(name, name_hash)) {
            Some(index) => integer::encode(out, flags, prefix_bits, index),
            None => {
                out.push(flags);
                encode_string(out, name);
            }
        }
        encode_string(out, value);

        if indexing == Indexing::Add {
            self.add(name, value, name_hash, field_hash);
        }
        Ok(())
    }

    /// Appends the field as it is: no table, no Huffman coding, no limit below 4 GiB.
    pub fn encode_verbatim(&mut self, out: &mut Vec<u8>, name: &[u8], value: &[u8]) {
        self.announce_capacity(out);
        out.push(0x00);
        for bytes in [name, value] {
            integer::encode(out, 0x00, 7, bytes.len() as u32);
            out.extend_from_slice(bytes);
        }
    }

    fn entry(&self, id: Id) -> Option<&Entry> {
        let age = self.next_id.wrapping_sub(id) as usize;
        self.entries.get(self.entries.len().checked_sub(age)?)
    }

    fn entry_mut(&mut self, id: Id) -> Option<&mut Entry> {
        let age = self.next_id.wrapping_sub(id) as usize;
        self.entries.get_mut(self.entries.len().checked_sub(age)?)
    }

    /// The newest entry comes right after the static table (§2.3.3).
    fn index_of(&self, id: Id) -> u32 {
        static_table::LEN.wrapping_add(self.next_id.wrapping_sub(id))
    }

    fn bucket_of(&self, hash: u32) -> usize {
        hash as usize & (self.buckets.len() - 1)
    }

    fn find(&self, name: &[u8], value: &[u8], field_hash: u32) -> Option<u32> {
        let mut next = self.buckets.get(self.bucket_of(field_hash))?.by_field.first;
        while let Some(id) = next {
            let entry = self.entry(id)?;
            if entry.field_hash == field_hash
                && self.storage.name_and_value(entry.span)? == (name, value)
            {
                return Some(self.index_of(id));
            }
            next = entry.next_by_field;
        }
        None
    }

    fn find_name(&self, name: &[u8], name_hash: u32) -> Option<u32> {
        let mut next = self.buckets.get(self.bucket_of(name_hash))?.by_name.first;
        while let Some(id) = next {
            let entry = self.entry(id)?;
            if entry.name_hash == name_hash && self.storage.name_and_value(entry.span)?.0 == name {
                return Some(self.index_of(id));
            }
            next = entry.next_by_name;
        }
        None
    }

    fn add(&mut self, name: &[u8], value: &[u8], name_hash: u32, field_hash: u32) {
        if self.entries.len() >= self.buckets.len() / 2 {
            self.grow_buckets();
        }
        self.storage.clear_scratch();
        self.storage.bytes_mut().extend_from_slice(name);
        self.storage.bytes_mut().extend_from_slice(value);
        let span = self.storage.scratch(name.len());
        self.storage.keep_scratch();
        self.size += span.size();
        self.entries.push_back(Entry {
            span,
            name_hash,
            field_hash,
            next_by_field: None,
            next_by_name: None,
        });
        let id = self.next_id;
        self.next_id = id.wrapping_add(1);
        self.link(id);
        self.evict();
    }

    fn by_field(&mut self, field_hash: u32) -> Option<&mut Chain> {
        let bucket = self.bucket_of(field_hash);
        Some(&mut self.buckets.get_mut(bucket)?.by_field)
    }

    fn by_name(&mut self, name_hash: u32) -> Option<&mut Chain> {
        let bucket = self.bucket_of(name_hash);
        Some(&mut self.buckets.get_mut(bucket)?.by_name)
    }

    /// Appends the entry to the two chains that its hashes select.
    fn link(&mut self, id: Id) {
        let Some(entry) = self.entry(id) else {
            return;
        };
        let (field_hash, name_hash) = (entry.field_hash, entry.name_hash);
        if let Some(previous) = self.by_field(field_hash).and_then(|chain| chain.push(id))
            && let Some(previous) = self.entry_mut(previous)
        {
            previous.next_by_field = Some(id);
        }
        if let Some(previous) = self.by_name(name_hash).and_then(|chain| chain.push(id))
            && let Some(previous) = self.entry_mut(previous)
        {
            previous.next_by_name = Some(id);
        }
    }

    fn grow_buckets(&mut self) {
        let len = self.buckets.len() * 2;
        self.buckets.clear();
        self.buckets.resize(len, Bucket::default());
        for entry in &mut self.entries {
            entry.next_by_field = None;
            entry.next_by_name = None;
        }
        for age in (1..=self.entries.len() as u32).rev() {
            self.link(self.next_id.wrapping_sub(age));
        }
    }

    fn evict(&mut self) {
        while self.size > self.capacity as usize {
            let Some(entry) = self.entries.pop_front() else {
                return;
            };
            self.size -= entry.span.size();
            self.storage.release(entry.span);
            if let Some(chain) = self.by_field(entry.field_hash) {
                chain.pop(entry.next_by_field);
            }
            if let Some(chain) = self.by_name(entry.name_hash) {
                chain.pop(entry.next_by_name);
            }
        }
    }
}

/// A string literal (§5.2), Huffman coded unless that makes it longer.
fn encode_string(out: &mut Vec<u8>, bytes: &[u8]) {
    let huffman_len = huffman::encoded_len(bytes);
    if huffman_len > 0 && huffman_len <= bytes.len() {
        integer::encode(out, 0x80, 7, huffman_len as u32);
        huffman::encode(bytes, out);
    } else {
        integer::encode(out, 0x00, 7, bytes.len() as u32);
        out.extend_from_slice(bytes);
    }
}
