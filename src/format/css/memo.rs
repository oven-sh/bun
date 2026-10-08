//! What declarations have been printed as.
//!
//! Style sheets say the same things over and over: half of the declarations of a style sheet are in it more than
//! once, letter for letter, and three quarters of those of a project. What is printed for a declaration on one line
//! depends on its text and on little else, so it is kept, and the next time it is neither parsed nor printed.

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
    /// The number of the first of `contexts`. No number is given twice.
    first_context: u32,
    entries: Vec<Entry>,
    /// For each hash, by its low bits or in one of the places that follow, the index of its entry plus one. Its
    /// length is a power of two.
    table: Vec<u32>,
}

/// With more than that, it starts anew.
const MAX_BYTES: usize = 1 << 20;

fn hash(context: u32, text: &[u8]) -> u64 {
    let mut hasher = rustc_hash::FxHasher::default();
    hasher.write_u32(context);
    hasher.write(text);
    hasher.finish()
}

impl Memo {
    fn of(&self, (start, end): (u32, u32)) -> &[u8] {
        self.bytes.get(start as usize..end as usize).unwrap_or_default()
    }

    fn add(&mut self, bytes: &[u8]) -> (u32, u32) {
        let start = self.bytes.len() as u32;
        self.bytes.extend_from_slice(bytes);
        (start, self.bytes.len() as u32)
    }

    /// A number for all that the way a declaration is printed depends on besides its text: `flags`, and the name of
    /// the at-rule that it is in.
    pub(crate) fn context(&mut self, flags: u32, at_rule: &[u8]) -> u32 {
        if self.bytes.len() + self.entries.len() * size_of::<Entry>() + self.table.len() * size_of::<u32>() > MAX_BYTES {
            *self = Memo {
                first_context: self.first_context.wrapping_add(self.contexts.len() as u32),
                ..Memo::default()
            };
        }
        let known = self.contexts.iter().position(|context| context.flags == flags && self.of(context.at_rule) == at_rule);
        let index = known.unwrap_or_else(|| {
            let at_rule = self.add(at_rule);
            self.contexts.push(Context { flags, at_rule });
            self.contexts.len() - 1
        });
        self.first_context.wrapping_add(index as u32)
    }

    /// What has been printed for the declaration `text`, and whether there is a group in it.
    pub(crate) fn get(&self, context: u32, text: &[u8]) -> Option<(&[u8], bool)> {
        let mask = self.table.len().checked_sub(1)?;
        let hash = hash(context, text);
        let mut at = hash as usize & mask;
        loop {
            let entry = self.entries.get((*self.table.get(at)?).checked_sub(1)? as usize)?;
            if entry.hash == hash && entry.context == context && self.of(entry.text) == text {
                return Some((self.of(entry.output), entry.has_group));
            }
            at = (at + 1) & mask;
        }
    }

    /// `text` is not there yet.
    pub(crate) fn insert(&mut self, context: u32, text: &[u8], output: &[u8], has_group: bool) {
        if (self.entries.len() + 1) * 2 > self.table.len() {
            let len = (self.table.len() * 2).max(256);
            self.table.clear();
            self.table.resize(len, 0);
            for index in 0..self.entries.len() {
                self.place(index);
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
        self.place(self.entries.len() - 1);
    }

    /// Puts the entry `index` into the table, which has room.
    fn place(&mut self, index: usize) {
        let mask = self.table.len() - 1;
        let mut at = self.entries[index].hash as usize & mask;
        while self.table[at] != 0 {
            at = (at + 1) & mask;
        }
        self.table[at] = index as u32 + 1;
    }
}
