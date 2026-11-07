//! Caches the printed output of declarations.
//!
//! Style sheets are repetitive. Half of a style sheet's declarations occur in it more than once, byte for byte, and so
//! do three quarters of a project's. The output for a single-line declaration depends on its text and little else, so
//! it's cached, and a repeated declaration is neither parsed nor printed again.

use std::hash::Hasher;

struct Entry {
    hash: u64,
    context: u32,
    /// Ranges of `Memo::bytes`.
    text: (u32, u32),
    output: (u32, u32),
    has_group: bool,
}

struct Context {
    hash: u64,
    flags: u32,
    /// A range of `Memo::bytes`.
    at_rule: (u32, u32),
}

/// Finds the items of a list by their hashes: open addressing with linear probing from the hash's low bits. Each slot
/// holds an index plus one, or 0. The length is a power of two.
#[derive(Default)]
struct Table(Vec<u32>);

impl Table {
    /// Returns the index with that hash for which `is_it` is true.
    fn find(&self, hash: u64, is_it: impl Fn(usize) -> bool) -> Option<usize> {
        let mask = self.0.len().checked_sub(1)?;
        let mut at = hash as usize & mask;
        loop {
            let index = (*self.0.get(at)?).checked_sub(1)? as usize;
            if is_it(index) {
                return Some(index);
            }
            at = (at + 1) & mask;
        }
    }

    /// There has to be a free slot.
    fn insert(&mut self, hash: u64, index: usize) {
        let mask = self.0.len() - 1;
        let mut at = hash as usize & mask;
        while self.0[at] != 0 {
            at = (at + 1) & mask;
        }
        self.0[at] = index as u32 + 1;
    }

    /// Before an item is added to a list with these `hashes`: keeps half of the slots free.
    fn make_room(&mut self, hashes: impl ExactSizeIterator<Item = u64>) {
        if (hashes.len() + 1) * 2 <= self.0.len() {
            return;
        }
        let len = (self.0.len() * 2).max(256);
        self.0.clear();
        self.0.resize(len, 0);
        for (index, hash) in hashes.enumerate() {
            self.insert(hash, index);
        }
    }
}

#[derive(Default)]
pub(crate) struct Memo {
    bytes: Vec<u8>,
    contexts: Vec<Context>,
    contexts_by_hash: Table,
    /// The id of `contexts[0]`. Ids are never reused, even after a reset.
    first_context: u32,
    entries: Vec<Entry>,
    entries_by_hash: Table,
}

/// The cache is reset when it grows past this.
const MAX_BYTES: usize = 1 << 20;

fn hash(context: u32, text: &[u8]) -> u64 {
    let mut hasher = rustc_hash::FxHasher::default();
    hasher.write_u32(context);
    hasher.write(text);
    hasher.finish()
}

impl Memo {
    fn of(&self, (start, end): (u32, u32)) -> &[u8] {
        self.bytes
            .get(start as usize..end as usize)
            .unwrap_or_default()
    }

    fn add(&mut self, bytes: &[u8]) -> (u32, u32) {
        let start = self.bytes.len() as u32;
        self.bytes.extend_from_slice(bytes);
        (start, self.bytes.len() as u32)
    }

    /// Returns an id for everything besides the text that affects how a declaration is printed: `flags` and the name of
    /// the enclosing at-rule.
    pub(crate) fn context(&mut self, flags: u32, at_rule: &[u8]) -> u32 {
        if self.bytes.len()
            + self.entries.len() * size_of::<Entry>()
            + self.contexts.len() * size_of::<Context>()
            + (self.entries_by_hash.0.len() + self.contexts_by_hash.0.len()) * size_of::<u32>()
            > MAX_BYTES
        {
            *self = Memo {
                first_context: self.first_context.wrapping_add(self.contexts.len() as u32),
                ..Memo::default()
            };
        }
        let hash = hash(flags, at_rule);
        let known = self.contexts_by_hash.find(hash, |index| {
            let context = &self.contexts[index];
            context.hash == hash && context.flags == flags && self.of(context.at_rule) == at_rule
        });
        let index = known.unwrap_or_else(|| {
            self.contexts_by_hash
                .make_room(self.contexts.iter().map(|it| it.hash));
            let at_rule = self.add(at_rule);
            self.contexts.push(Context {
                hash,
                flags,
                at_rule,
            });
            self.contexts_by_hash.insert(hash, self.contexts.len() - 1);
            self.contexts.len() - 1
        });
        self.first_context.wrapping_add(index as u32)
    }

    /// Returns the cached output for the declaration `text`, and whether it has a group in it.
    pub(crate) fn get(&self, context: u32, text: &[u8]) -> Option<(&[u8], bool)> {
        let hash = hash(context, text);
        let index = self.entries_by_hash.find(hash, |index| {
            let entry = &self.entries[index];
            entry.hash == hash && entry.context == context && self.of(entry.text) == text
        })?;
        let entry = &self.entries[index];
        Some((self.of(entry.output), entry.has_group))
    }

    /// `text` must not be cached yet.
    pub(crate) fn insert(&mut self, context: u32, text: &[u8], output: &[u8], has_group: bool) {
        self.entries_by_hash
            .make_room(self.entries.iter().map(|it| it.hash));
        let (text_range, output) = (self.add(text), self.add(output));
        let hash = hash(context, text);
        self.entries.push(Entry {
            hash,
            context,
            text: text_range,
            output,
            has_group,
        });
        self.entries_by_hash.insert(hash, self.entries.len() - 1);
    }
}
