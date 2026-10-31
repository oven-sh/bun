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
    flags: u32,
    /// A range of `Memo::bytes`.
    at_rule: (u32, u32),
}

#[derive(Default)]
pub(crate) struct Memo {
    bytes: Vec<u8>,
    contexts: Vec<Context>,
    /// The id of `contexts[0]`. Ids are never reused, even after a reset.
    first_context: u32,
    entries: Vec<Entry>,
    /// Open addressing with linear probing from the hash's low bits. Each slot holds an entry's index plus one, or 0.
    /// The length is a power of two.
    table: Vec<u32>,
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
            + self.table.len() * size_of::<u32>()
            > MAX_BYTES
        {
            *self = Memo {
                first_context: self.first_context.wrapping_add(self.contexts.len() as u32),
                ..Memo::default()
            };
        }
        let known = self
            .contexts
            .iter()
            .position(|context| context.flags == flags && self.of(context.at_rule) == at_rule);
        let index = known.unwrap_or_else(|| {
            let at_rule = self.add(at_rule);
            self.contexts.push(Context { flags, at_rule });
            self.contexts.len() - 1
        });
        self.first_context.wrapping_add(index as u32)
    }

    /// Returns the cached output for the declaration `text`, and whether it has a group in it.
    pub(crate) fn get(&self, context: u32, text: &[u8]) -> Option<(&[u8], bool)> {
        let mask = self.table.len().checked_sub(1)?;
        let hash = hash(context, text);
        let mut at = hash as usize & mask;
        loop {
            let entry = self
                .entries
                .get((*self.table.get(at)?).checked_sub(1)? as usize)?;
            if entry.hash == hash && entry.context == context && self.of(entry.text) == text {
                return Some((self.of(entry.output), entry.has_group));
            }
            at = (at + 1) & mask;
        }
    }

    /// `text` must not be cached yet.
    pub(crate) fn insert(&mut self, context: u32, text: &[u8], output: &[u8], has_group: bool) {
        if (self.entries.len() + 1) * 2 > self.table.len() {
            let len = (self.table.len() * 2).max(256);
            self.table.clear();
            self.table.resize(len, 0);
            for index in 0..self.entries.len() {
                self.insert_into_table(index);
            }
        }
        let (text_range, output) = (self.add(text), self.add(output));
        self.entries.push(Entry {
            hash: hash(context, text),
            context,
            text: text_range,
            output,
            has_group,
        });
        self.insert_into_table(self.entries.len() - 1);
    }

    /// Inserts entry `index` into the table, which must have a free slot.
    fn insert_into_table(&mut self, index: usize) {
        let mask = self.table.len() - 1;
        let mut at = self.entries[index].hash as usize & mask;
        while self.table[at] != 0 {
            at = (at + 1) & mask;
        }
        self.table[at] = index as u32 + 1;
    }
}
