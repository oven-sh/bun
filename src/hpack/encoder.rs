//! What enters the dynamic table, and which entry is referred to, is decided as in ls-hpack (MIT).

use std::collections::VecDeque;

use crate::storage::{Position, Storage};
use crate::{
    DEFAULT_TABLE_CAPACITY, ENTRY_OVERHEAD, Error, MAX_FIELD_LEN, Result, huffman, integer,
    static_table,
};

/// How a field that is not in the tables yet is sent (§6.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indexing {
    /// Added to the dynamic table.
    Add,
    /// Left out of the table.
    Skip,
    /// Left out of the table, here and by whoever forwards it. For secrets (§7.1.3).
    Never,
}

struct Entry {
    position: Position,
    name_len: usize,
    value_len: usize,
    name_hash: u32,
    field_hash: u32,
    /// The next entry in the same bucket's `by_field` and `by_name` chains.
    next_by_field: Option<Id>,
    next_by_name: Option<Id>,
    in_by_name: bool,
}

impl Entry {
    fn size(&self) -> usize {
        self.name_len + self.value_len + ENTRY_OVERHEAD
    }
}

/// Entries are numbered as they are added. Wraps around.
type Id = u32;

/// Entries whose hash falls into one bucket, oldest first, so that eviction takes the first.
#[derive(Clone, Copy, Default)]
struct Chain {
    first: Option<Id>,
    last: Option<Id>,
}

#[derive(Clone, Copy, Default)]
struct Bucket {
    by_field: Chain,
    /// Without the entries whose name is in the static table: that one is found first.
    by_name: Chain,
}

/// The hashes of the fields sent last. Once full, only a field found here enters the table.
struct History {
    hashes: Vec<u32>,
    /// Where the next hash goes.
    next: usize,
    full: bool,
}

impl History {
    /// A third of the entries the table has room for if they are all empty.
    fn len_for(capacity: u32) -> usize {
        capacity as usize / ENTRY_OVERHEAD / 3
    }

    fn new(len: usize) -> Self {
        Self {
            hashes: vec![0; len],
            next: 0,
            full: false,
        }
    }

    /// Whether `hash` was there already.
    fn add(&mut self, hash: u32) -> bool {
        let used = if self.full {
            self.hashes.as_slice()
        } else {
            self.hashes.get(..self.next).unwrap_or_default()
        };
        let seen = used.contains(&hash);
        if let Some(slot) = self.hashes.get_mut(self.next) {
            *slot = hash;
        }
        self.next = (self.next + 1) % self.hashes.len().max(1);
        self.full |= self.next == 0;
        seen
    }

    fn resized(&self, len: usize) -> Self {
        let old_len = self.hashes.len().max(1);
        let (first, count) = if self.full {
            ((self.next + 1) % old_len, old_len)
        } else {
            (0, self.next)
        };
        let mut resized = Self::new(len);
        let kept = count.min(len);
        for (i, slot) in resized.hashes.iter_mut().take(kept).enumerate() {
            *slot = self.hashes.get((first + i) % old_len).copied().unwrap_or(0);
        }
        resized.next = kept % len.max(1);
        resized.full = kept == len;
        resized
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
    use_history: bool,
    /// `None` also while the capacity is too low for one.
    history: Option<History>,
}

impl Encoder {
    /// With `use_history`, one-off fields stay out of the dynamic table. See [`History`].
    pub fn new(use_history: bool) -> Self {
        Self {
            entries: VecDeque::new(),
            storage: Storage::default(),
            next_id: 0,
            buckets: vec![Bucket::default(); 4],
            size: 0,
            capacity: DEFAULT_TABLE_CAPACITY,
            unannounced_capacity: None,
            use_history,
            history: use_history.then(|| History::new(History::len_for(DEFAULT_TABLE_CAPACITY))),
        }
    }

    /// The size of the dynamic table as §4.1 counts it.
    pub fn table_size(&self) -> usize {
        self.size
    }

    /// Takes the peer's SETTINGS_HEADER_TABLE_SIZE. The next block tells its decoder what was made of it.
    pub fn set_max_capacity(&mut self, max_capacity: u32) {
        // A peer that allows for more does not get to decide how much memory this side spends.
        let capacity = max_capacity.min(DEFAULT_TABLE_CAPACITY);
        let lowest = match self.unannounced_capacity {
            None if capacity == self.capacity => return,
            None => capacity,
            Some(lowest) => lowest.min(capacity),
        };
        self.unannounced_capacity = Some(lowest);
        self.apply_capacity(lowest);
        if capacity != lowest {
            self.apply_capacity(capacity);
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

    fn apply_capacity(&mut self, capacity: u32) {
        self.capacity = capacity;
        self.evict();
        if !self.use_history {
            return;
        }
        let len = History::len_for(capacity);
        self.history = match self.history.take() {
            _ if len == 0 => None,
            None => Some(History::new(len)),
            Some(history) if history.hashes.len() == len => Some(history),
            Some(history) => Some(history.resized(len)),
        };
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

    /// Appends the field to the header block in `out`.
    pub fn encode(
        &mut self,
        out: &mut Vec<u8>,
        name: &[u8],
        value: &[u8],
        indexing: Indexing,
    ) -> Result<()> {
        let len = name.len().saturating_add(value.len());
        if len > MAX_FIELD_LEN {
            return Err(Error::TooLarge);
        }
        self.announce_capacity(out);

        let name_hash = static_table::hash_name(name);
        let field_hash = static_table::hash_field(name_hash, value);

        // A reference to an entry with the same value would not say "never indexed".
        let whole = if indexing == Indexing::Never {
            None
        } else {
            static_table::find(name, value, field_hash)
                .or_else(|| self.find(name, value, field_hash))
        };
        let mut indexing = indexing;
        // Adding it would only empty the table (§4.4).
        if indexing == Indexing::Add && len + ENTRY_OVERHEAD > self.capacity as usize {
            indexing = Indexing::Skip;
        }
        if let Some(history) = &mut self.history {
            let seen = history.add(field_hash);
            if !seen && history.full && indexing == Indexing::Add {
                indexing = Indexing::Skip;
            }
        }
        if let Some(index) = whole {
            integer::encode(out, 0x80, 7, index);
            return Ok(());
        }

        let (flags, prefix_bits) = match indexing {
            Indexing::Add => (0x40, 6),
            Indexing::Skip => (0x00, 4),
            Indexing::Never => (0x10, 4),
        };
        let static_name = static_table::find_name(name, name_hash);
        match static_name.or_else(|| self.find_name(name, name_hash)) {
            Some(index) => integer::encode(out, flags, prefix_bits, index),
            None => {
                out.push(flags);
                string(out, name);
            }
        }
        string(out, value);

        if indexing == Indexing::Add {
            self.add(name, value, name_hash, field_hash, static_name.is_none());
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
                && entry.name_len == name.len()
                && entry.value_len == value.len()
            {
                let stored_name = self.storage.range(entry.position, entry.name_len);
                let stored_value = stored_name.end..stored_name.end + entry.value_len;
                if self.storage.get(stored_name) == name && self.storage.get(stored_value) == value
                {
                    return Some(self.index_of(id));
                }
            }
            next = entry.next_by_field;
        }
        None
    }

    fn find_name(&self, name: &[u8], name_hash: u32) -> Option<u32> {
        let mut next = self.buckets.get(self.bucket_of(name_hash))?.by_name.first;
        while let Some(id) = next {
            let entry = self.entry(id)?;
            if entry.name_hash == name_hash
                && entry.name_len == name.len()
                && self
                    .storage
                    .get(self.storage.range(entry.position, entry.name_len))
                    == name
            {
                return Some(self.index_of(id));
            }
            next = entry.next_by_name;
        }
        None
    }

    fn add(
        &mut self,
        name: &[u8],
        value: &[u8],
        name_hash: u32,
        field_hash: u32,
        find_by_name: bool,
    ) {
        if self.entries.len() >= self.buckets.len() / 2 {
            self.grow_buckets();
        }
        self.storage.clear_scratch();
        self.storage.bytes_mut().extend_from_slice(name);
        self.storage.bytes_mut().extend_from_slice(value);
        let entry = Entry {
            position: self.storage.keep_scratch(),
            name_len: name.len(),
            value_len: value.len(),
            name_hash,
            field_hash,
            next_by_field: None,
            next_by_name: None,
            in_by_name: find_by_name,
        };
        self.size += entry.size();
        self.entries.push_back(entry);
        let id = self.next_id;
        self.next_id = id.wrapping_add(1);
        self.link(id, field_hash, false);
        if find_by_name {
            self.link(id, name_hash, true);
        }
        self.evict();
    }

    /// Appends the entry to the chain its hash selects.
    fn link(&mut self, id: Id, hash: u32, by_name: bool) {
        let at = self.bucket_of(hash);
        let Some(bucket) = self.buckets.get_mut(at) else {
            return;
        };
        let chain = if by_name {
            &mut bucket.by_name
        } else {
            &mut bucket.by_field
        };
        let previous = chain.last.replace(id);
        match previous {
            None => chain.first = Some(id),
            Some(previous) => {
                if let Some(previous) = self.entry_mut(previous) {
                    if by_name {
                        previous.next_by_name = Some(id);
                    } else {
                        previous.next_by_field = Some(id);
                    }
                }
            }
        }
    }

    fn grow_buckets(&mut self) {
        let len = self.buckets.len() * 2;
        self.buckets.clear();
        self.buckets.resize(len, Bucket::default());
        let oldest = self.next_id.wrapping_sub(self.entries.len() as u32);
        for i in 0..self.entries.len() {
            let Some(entry) = self.entries.get_mut(i) else {
                return;
            };
            entry.next_by_field = None;
            entry.next_by_name = None;
            let (field_hash, name_hash, in_by_name) =
                (entry.field_hash, entry.name_hash, entry.in_by_name);
            let id = oldest.wrapping_add(i as u32);
            self.link(id, field_hash, false);
            if in_by_name {
                self.link(id, name_hash, true);
            }
        }
    }

    fn evict(&mut self) {
        while self.size > self.capacity as usize {
            let id = self.next_id.wrapping_sub(self.entries.len() as u32);
            let Some(entry) = self.entries.pop_front() else {
                return;
            };
            self.size -= entry.size();
            self.storage.release(entry.name_len + entry.value_len);
            let (field_bucket, name_bucket) = (
                self.bucket_of(entry.field_hash),
                self.bucket_of(entry.name_hash),
            );
            if let Some(bucket) = self.buckets.get_mut(field_bucket) {
                unlink_first(&mut bucket.by_field, id, entry.next_by_field);
            }
            if let Some(bucket) = self.buckets.get_mut(name_bucket) {
                unlink_first(&mut bucket.by_name, id, entry.next_by_name);
            }
        }
    }
}

fn unlink_first(chain: &mut Chain, id: Id, next: Option<Id>) {
    if chain.first == Some(id) {
        chain.first = next;
        if next.is_none() {
            chain.last = None;
        }
    }
}

/// A string literal (§5.2), Huffman coded unless that makes it longer.
fn string(out: &mut Vec<u8>, bytes: &[u8]) {
    let huffman_len = huffman::encoded_len(bytes);
    if huffman_len > 0 && huffman_len <= bytes.len() {
        integer::encode(out, 0x80, 7, huffman_len as u32);
        huffman::encode(bytes, out);
    } else {
        integer::encode(out, 0x00, 7, bytes.len() as u32);
        out.extend_from_slice(bytes);
    }
}
