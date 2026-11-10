use super::generated::NameClass;
use super::ids::{Id, StringId};
use super::name_class::classify_name;
use super::parallel::{InParallel, for_each_mut};
use super::wtf8::join_surrogate_pairs;
use crate::builtins::id::BuiltinName;
use crate::builtins::table::{is_symbol_name, text_of_name};
use core::ops::Range;
use std::sync::OnceLock;

fn find_builtin_name(hash: u64, bytes: &[u8]) -> Option<BuiltinName> {
    static NAMES: OnceLock<hashbrown::HashTable<BuiltinName>> = OnceLock::new();
    let hash_of_name = |&name: &BuiltinName| StringTable::hash_of(text_of_name(name));
    let names = NAMES.get_or_init(|| {
        let mut names = hashbrown::HashTable::new();
        for name in (0..)
            .map(BuiltinName)
            .take_while(|&name| !is_symbol_name(name))
        {
            names.insert_unique(hash_of_name(&name), name, hash_of_name);
        }
        names
    });
    names
        .find(hash, |&name| text_of_name(name) == bytes)
        .copied()
}

#[derive(Copy, Clone, Default)]
struct NameFacts(u32);

impl NameFacts {
    const CLASS_BITS: u32 = 4;

    #[inline]
    fn new(class: NameClass, builtin: Option<BuiltinName>) -> NameFacts {
        const { assert!(NameClass::COUNT <= 1 << NameFacts::CLASS_BITS) };
        let builtin = builtin.map_or(0, |name| name.0 + 1);
        debug_assert!(builtin <= u32::MAX >> NameFacts::CLASS_BITS);
        NameFacts(builtin << NameFacts::CLASS_BITS | class.to_wire())
    }

    #[inline]
    fn class(self) -> NameClass {
        NameClass::ALL[(self.0 & ((1 << NameFacts::CLASS_BITS) - 1)) as usize]
    }

    #[inline]
    fn builtin(self) -> Option<BuiltinName> {
        let builtin = (self.0 >> NameFacts::CLASS_BITS).checked_sub(1);
        builtin.map(BuiltinName)
    }
}

#[derive(Default, Clone)]
pub struct StringTable {
    bytes: Vec<u8>,
    ends: Vec<u32>,
    hashes: Vec<u64>,
    name_facts: Vec<NameFacts>,
    ids: hashbrown::HashTable<StringId>,
}

#[inline]
fn end_of(bytes: &[u8]) -> u32 {
    u32::try_from(bytes.len()).expect("the strings of a program fit 32 bits")
}

impl StringTable {
    #[inline]
    pub fn hash_of(bytes: &[u8]) -> u64 {
        std::hash::BuildHasher::hash_one(&rustc_hash::FxBuildHasher, bytes)
    }

    pub fn of_distinct_strings<'a>(
        count: usize,
        string_at: &(dyn Fn(usize) -> (&'a StringTable, StringId) + Sync),
        in_parallel: InParallel<'_>,
    ) -> StringTable {
        const STRINGS_IN_A_TASK: usize = 2048;
        let mut table = StringTable {
            bytes: Vec::new(),
            ends: vec![0; count],
            hashes: vec![0; count],
            name_facts: vec![NameFacts::default(); count],
            ids: hashbrown::HashTable::with_capacity(count),
        };
        let ends = table.ends.chunks_mut(STRINGS_IN_A_TASK);
        let hashes = table.hashes.chunks_mut(STRINGS_IN_A_TASK);
        let name_facts = table.name_facts.chunks_mut(STRINGS_IN_A_TASK);
        let lists = ends.zip(hashes).zip(name_facts);
        let mut tasks: Vec<_> = lists.enumerate().collect();
        for_each_mut(&mut tasks, in_parallel, &|(task, lists)| {
            let ((ends, hashes), name_facts) = lists;
            let first = *task * STRINGS_IN_A_TASK;
            for offset in 0..ends.len() {
                let (source, id) = string_at(first + offset);
                ends[offset] = end_of(source.get(id));
                hashes[offset] = source.hash(id);
                name_facts[offset] = source.name_facts[id.index()];
            }
        });
        let mut end = 0u32;
        for length in &mut table.ends {
            end = end
                .checked_add(*length)
                .expect("the strings of a program fit 32 bits");
            *length = end;
        }
        table.bytes = vec![0; end as usize];
        let (mut rest, mut start) = (table.bytes.as_mut_slice(), 0);
        let mut tasks = Vec::with_capacity(count.div_ceil(STRINGS_IN_A_TASK));
        for (task, ends) in table.ends.chunks(STRINGS_IN_A_TASK).enumerate() {
            let end = ends[ends.len() - 1];
            let length = (end - start) as usize;
            let (bytes, after) = core::mem::take(&mut rest).split_at_mut(length);
            tasks.push((task * STRINGS_IN_A_TASK, ends, start, bytes));
            (rest, start) = (after, end);
        }
        for_each_mut(&mut tasks, in_parallel, &|(
            first,
            ends,
            first_byte,
            bytes,
        )| {
            let mut start = 0;
            let ends = ends.iter().map(|end| (end - *first_byte) as usize);
            for (offset, end) in ends.enumerate() {
                let (source, id) = string_at(*first + offset);
                bytes[start..end].copy_from_slice(source.get(id));
                start = end;
            }
        });
        let hashes = &table.hashes;
        for (index, &hash) in hashes.iter().enumerate() {
            let id = StringId::new(index);
            debug_assert!(
                table.find_hashed(hash, table.get(id)).is_none(),
                "no two strings are alike"
            );
            table.ids.insert_unique(hash, id, |&id| hashes[id.index()]);
        }
        table
    }

    pub fn intern(&mut self, bytes: &[u8]) -> StringId {
        let hash = StringTable::hash_of(bytes);
        if let Some(id) = self.find_hashed(hash, bytes) {
            return id;
        }
        if bytes.is_ascii() {
            return self.add_hashed(hash, bytes);
        }
        let Some(joined) = join_surrogate_pairs(bytes) else {
            return self.add_hashed(hash, bytes);
        };
        let hash = StringTable::hash_of(&joined);
        if let Some(id) = self.find_hashed(hash, &joined) {
            return id;
        }
        self.add_hashed(hash, &joined)
    }

    fn add_hashed(&mut self, hash: u64, bytes: &[u8]) -> StringId {
        let id = StringId::new(self.len());
        self.bytes.extend_from_slice(bytes);
        self.ends.push(end_of(&self.bytes));
        self.hashes.push(hash);
        let facts = NameFacts::new(classify_name(bytes), find_builtin_name(hash, bytes));
        self.name_facts.push(facts);
        let hashes = &self.hashes;
        self.ids.insert_unique(hash, id, |&id| hashes[id.index()]);
        id
    }

    pub fn intern_string_of(&mut self, other: &StringTable, string: StringId) -> StringId {
        let (hash, bytes) = (other.hash(string), other.get(string));
        if let Some(id) = self.find_hashed(hash, bytes) {
            return id;
        }
        let id = StringId::new(self.len());
        self.bytes.extend_from_slice(bytes);
        self.ends.push(end_of(&self.bytes));
        self.hashes.push(hash);
        self.name_facts.push(other.name_facts[string.index()]);
        let hashes = &self.hashes;
        self.ids.insert_unique(hash, id, |&id| hashes[id.index()]);
        id
    }

    pub fn find_string_of(&self, other: &StringTable, string: StringId) -> Option<StringId> {
        self.find_hashed(other.hash(string), other.get(string))
    }

    pub fn truncate(&mut self, length: usize) {
        if self.len() <= length {
            return;
        }
        for (index, &hash) in self.hashes.iter().enumerate().skip(length) {
            let id = StringId::new(index);
            if let Ok(entry) = self.ids.find_entry(hash, |&other| other == id) {
                let _ = entry.remove();
            }
        }
        self.bytes.truncate(self.start_of(length));
        self.ends.truncate(length);
        self.hashes.truncate(length);
        self.name_facts.truncate(length);
    }

    #[cfg(test)]
    pub fn find(&self, bytes: &[u8]) -> Option<StringId> {
        self.find_hashed(StringTable::hash_of(bytes), bytes)
    }

    #[inline]
    pub fn get(&self, id: StringId) -> &[u8] {
        let index = id.index();
        &self.bytes[self.start_of(index)..self.ends[index] as usize]
    }

    #[inline]
    fn start_of(&self, index: usize) -> usize {
        let before = index.checked_sub(1);
        before.map_or(0, |before| self.ends[before] as usize)
    }

    #[inline]
    pub fn hash(&self, id: StringId) -> u64 {
        self.hashes[id.index()]
    }

    #[inline]
    pub fn name_class(&self, id: StringId) -> NameClass {
        self.name_facts[id.index()].class()
    }

    #[inline]
    pub fn builtin_name(&self, id: StringId) -> Option<BuiltinName> {
        self.name_facts[id.index()].builtin()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.ends.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    #[cfg(test)]
    pub fn byte_len(&self) -> usize {
        self.bytes.len()
    }

    #[cfg(test)]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn bytes_of(&self, strings: Range<usize>) -> &[u8] {
        &self.bytes[self.start_of(strings.start)..self.start_of(strings.end)]
    }

    pub fn ids(&self) -> impl ExactSizeIterator<Item = StringId> + Clone + use<> {
        (0..self.len()).map(StringId::new)
    }

    fn find_hashed(&self, hash: u64, bytes: &[u8]) -> Option<StringId> {
        self.ids.find(hash, |&id| self.get(id) == bytes).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::table::find_name;

    #[test]
    fn builtin_name_is_the_one_that_the_table_finds() {
        let mut strings = StringTable::default();
        let names = (0..)
            .map(BuiltinName)
            .take_while(|&name| !is_symbol_name(name));
        for name in names {
            let id = strings.intern(text_of_name(name));
            assert_eq!(strings.builtin_name(id), find_name(text_of_name(name)));
            assert_eq!(strings.builtin_name(id), Some(name));
        }
        let other = strings.intern(b"no name of the table");
        assert_eq!(strings.builtin_name(other), None);
    }

    #[test]
    fn string_of_another_table_is_interned_as_its_bytes_are() {
        let written: [&[u8]; 4] = [b"length", b"12", b"a name", b""];
        let mut other = StringTable::default();
        let ids = written.map(|bytes| other.intern(bytes));
        let (mut table, mut expected) = (StringTable::default(), StringTable::default());
        table.intern(b"a name");
        expected.intern(b"a name");
        for (bytes, id) in written.into_iter().zip(ids) {
            assert_eq!(table.find_string_of(&other, id), expected.find(bytes));
            assert_eq!(table.intern_string_of(&other, id), expected.intern(bytes));
            assert_eq!(table.find_string_of(&other, id), expected.find(bytes));
        }
        assert_eq!(table.bytes(), expected.bytes());
        for id in expected.ids() {
            assert_eq!(table.get(id), expected.get(id));
            assert_eq!(table.hash(id), expected.hash(id));
            assert_eq!(table.name_class(id), expected.name_class(id));
            assert_eq!(table.builtin_name(id), expected.builtin_name(id));
            assert_eq!(table.find(expected.get(id)), Some(id));
        }
    }

    #[test]
    fn truncated_table_behaves_like_one_that_never_held_the_cut_strings() {
        let written: [&[u8]; 5] = [b"length", b"", b"a name", b"12", b"then"];
        for length in 0..=written.len() + 1 {
            let (kept, cut) = written.split_at(length.min(written.len()));
            let mut table = StringTable::default();
            for bytes in written {
                table.intern(bytes);
            }
            table.truncate(length);
            assert_eq!(table.len(), kept.len());
            for &bytes in cut {
                assert_eq!(table.find(bytes), None);
            }
            let mut expected = StringTable::default();
            for &bytes in kept.iter().chain(cut.iter().rev()) {
                assert_eq!(table.intern(bytes), expected.intern(bytes));
            }
            assert_eq!(table.bytes(), expected.bytes());
            for id in expected.ids() {
                assert_eq!(table.get(id), expected.get(id));
                assert_eq!(table.hash(id), expected.hash(id));
                assert_eq!(table.name_class(id), expected.name_class(id));
                assert_eq!(table.builtin_name(id), expected.builtin_name(id));
            }
        }
    }
}
