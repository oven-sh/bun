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

#[derive(Default, Clone)]
pub struct StringTable {
    bytes: Vec<u8>,
    ends: Vec<usize>,
    hashes: Vec<u64>,
    name_classes: Vec<NameClass>,
    builtin_names: Vec<Option<BuiltinName>>,
    ids: hashbrown::HashTable<StringId>,
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
            name_classes: vec![NameClass::default(); count],
            builtin_names: vec![None; count],
            ids: hashbrown::HashTable::with_capacity(count),
        };
        let ends = table.ends.chunks_mut(STRINGS_IN_A_TASK);
        let hashes = table.hashes.chunks_mut(STRINGS_IN_A_TASK);
        let name_classes = table.name_classes.chunks_mut(STRINGS_IN_A_TASK);
        let builtin_names = table.builtin_names.chunks_mut(STRINGS_IN_A_TASK);
        let lists = ends.zip(hashes).zip(name_classes.zip(builtin_names));
        let mut tasks: Vec<_> = lists.enumerate().collect();
        for_each_mut(&mut tasks, in_parallel, &|(task, lists)| {
            let ((ends, hashes), (name_classes, builtin_names)) = lists;
            let first = *task * STRINGS_IN_A_TASK;
            for offset in 0..ends.len() {
                let (source, id) = string_at(first + offset);
                ends[offset] = source.get(id).len();
                hashes[offset] = source.hash(id);
                name_classes[offset] = source.name_class(id);
                builtin_names[offset] = source.builtin_name(id);
            }
        });
        let mut end = 0;
        for length in &mut table.ends {
            end += *length;
            *length = end;
        }
        table.bytes = vec![0; end];
        let (mut rest, mut start) = (table.bytes.as_mut_slice(), 0);
        let mut tasks = Vec::with_capacity(count.div_ceil(STRINGS_IN_A_TASK));
        for (task, ends) in table.ends.chunks(STRINGS_IN_A_TASK).enumerate() {
            let end = ends[ends.len() - 1];
            let (bytes, after) = core::mem::take(&mut rest).split_at_mut(end - start);
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
            for (offset, end) in ends.iter().map(|end| end - *first_byte).enumerate() {
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
        self.ends.push(self.bytes.len());
        self.hashes.push(hash);
        self.name_classes.push(classify_name(bytes));
        self.builtin_names.push(find_builtin_name(hash, bytes));
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
        self.ends.push(self.bytes.len());
        self.hashes.push(hash);
        self.name_classes.push(other.name_class(string));
        self.builtin_names.push(other.builtin_name(string));
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
        let byte_len = length.checked_sub(1).map_or(0, |last| self.ends[last]);
        self.bytes.truncate(byte_len);
        self.ends.truncate(length);
        self.hashes.truncate(length);
        self.name_classes.truncate(length);
        self.builtin_names.truncate(length);
    }

    #[cfg(test)]
    pub fn find(&self, bytes: &[u8]) -> Option<StringId> {
        self.find_hashed(StringTable::hash_of(bytes), bytes)
    }

    #[inline]
    pub fn get(&self, id: StringId) -> &[u8] {
        let index = id.index();
        let start = if index == 0 { 0 } else { self.ends[index - 1] };
        &self.bytes[start..self.ends[index]]
    }

    #[inline]
    pub fn hash(&self, id: StringId) -> u64 {
        self.hashes[id.index()]
    }

    #[inline]
    pub fn name_class(&self, id: StringId) -> NameClass {
        self.name_classes[id.index()]
    }

    #[inline]
    pub fn builtin_name(&self, id: StringId) -> Option<BuiltinName> {
        self.builtin_names[id.index()]
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
        let start_of = |index: usize| index.checked_sub(1).map_or(0, |before| self.ends[before]);
        &self.bytes[start_of(strings.start)..start_of(strings.end)]
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
