use super::generated::NameClass;
use super::ids::{Id, StringId};
use super::name_class::classify_name;
use super::parallel::{InParallel, for_each_mut};
use super::types::release_spare_capacity;
use super::wtf8::join_surrogate_pairs;
use crate::builtins::id::BuiltinName;
use crate::builtins::table::{is_symbol_name, text_of_name};
use bun_threading::Guarded;
use std::sync::{Arc, OnceLock, Weak};

// Every file interns its strings anew, and the hash is at hand.
fn find_builtin_name(hash: u64, bytes: &[u8]) -> Option<BuiltinName> {
    static NAMES: OnceLock<hashbrown::HashTable<BuiltinName>> = OnceLock::new();
    let hash_of_name = |&name: &BuiltinName| StringTable::hash_of(text_of_name(name));
    let names = NAMES.get_or_init(|| {
        let mut names = hashbrown::HashTable::new();
        for name in (0..).map(BuiltinName).take_while(|&name| !is_symbol_name(name)) {
            names.insert_unique(hash_of_name(&name), name, hash_of_name);
        }
        names
    });
    names.find(hash, |&name| text_of_name(name) == bytes).copied()
}

#[derive(Default)]
pub struct StringTable {
    strings: StringList,
    ids: hashbrown::HashTable<StringId>,
}

enum StringList {
    Own(OwnStrings),
    Shared(SharedStringList),
}

#[derive(Default)]
struct OwnStrings {
    bytes: Vec<u8>,
    ends: Vec<usize>,
    hashes: Vec<u64>,
    name_classes: Vec<NameClass>,
    builtin_names: Vec<Option<BuiltinName>>,
}

struct SharedStringList {
    known: Arc<StringsOfAllTables>,
    strings: Vec<Arc<SharedString>>,
    byte_len: usize,
    all_bytes: OnceLock<Vec<u8>>,
}

struct SharedString {
    hash: u64,
    name_class: NameClass,
    builtin_name: Option<BuiltinName>,
    bytes: Box<[u8]>,
}

struct StringsOfAllTables {
    shards: [Guarded<hashbrown::HashTable<Arc<SharedString>>>; StringsOfAllTables::SHARD_COUNT],
}

impl StringsOfAllTables {
    const SHARD_COUNT: usize = 64;

    fn current() -> Arc<StringsOfAllTables> {
        static CURRENT: Guarded<Weak<StringsOfAllTables>> = Guarded::new(Weak::new());
        let mut current = CURRENT.lock();
        if let Some(known) = current.upgrade() {
            return known;
        }
        let known = Arc::new(StringsOfAllTables {
            shards: core::array::from_fn(|_| Guarded::new(hashbrown::HashTable::new())),
        });
        *current = Arc::downgrade(&known);
        known
    }

    fn intern(
        &self,
        hash: u64,
        bytes: &[u8],
        describe: impl FnOnce() -> (NameClass, Option<BuiltinName>),
    ) -> Arc<SharedString> {
        // The table itself goes by the lowest and by the highest bits.
        let shard = (hash >> 32) as usize % Self::SHARD_COUNT;
        let mut strings = self.shards[shard].lock();
        if let Some(known) = strings.find(hash, |known| *known.bytes == *bytes) {
            return Arc::clone(known);
        }
        let (name_class, builtin_name) = describe();
        let added = Arc::new(SharedString {
            hash,
            name_class,
            builtin_name,
            bytes: bytes.into(),
        });
        strings.insert_unique(hash, Arc::clone(&added), |known| known.hash);
        added
    }
}

impl Default for StringList {
    fn default() -> StringList {
        StringList::Own(OwnStrings::default())
    }
}

impl StringTable {
    pub fn hash_of(bytes: &[u8]) -> u64 {
        std::hash::BuildHasher::hash_one(&rustc_hash::FxBuildHasher, bytes)
    }

    /// For the many tables that are alive at a time: a string that several of them have is held once.
    pub fn sharing_strings() -> StringTable {
        StringTable {
            strings: StringList::Shared(SharedStringList {
                known: StringsOfAllTables::current(),
                strings: Vec::new(),
                byte_len: 0,
                all_bytes: OnceLock::new(),
            }),
            ids: hashbrown::HashTable::new(),
        }
    }

    /// A table of `count` strings of other tables in the given order. No two of them are the same string.
    pub fn of_distinct_strings<'a>(
        count: usize,
        string_at: &(dyn Fn(usize) -> (&'a StringTable, StringId) + Sync),
        in_parallel: InParallel<'_>,
    ) -> StringTable {
        const STRINGS_IN_A_TASK: usize = 2048;
        struct Descriptions<'t> {
            first: usize,
            // Lengths, until all are known.
            ends: &'t mut [usize],
            hashes: &'t mut [u64],
            name_classes: &'t mut [NameClass],
            builtin_names: &'t mut [Option<BuiltinName>],
        }
        struct Copies<'t> {
            first: usize,
            ends: &'t [usize],
            start: usize,
            bytes: &'t mut [u8],
        }
        let mut own = OwnStrings {
            bytes: Vec::new(),
            ends: vec![0; count],
            hashes: vec![0; count],
            name_classes: vec![NameClass::default(); count],
            builtin_names: vec![None; count],
        };
        let ends = own.ends.chunks_mut(STRINGS_IN_A_TASK);
        let hashes = own.hashes.chunks_mut(STRINGS_IN_A_TASK);
        let name_classes = own.name_classes.chunks_mut(STRINGS_IN_A_TASK);
        let builtin_names = own.builtin_names.chunks_mut(STRINGS_IN_A_TASK);
        let lists = ends.zip(hashes).zip(name_classes.zip(builtin_names)).enumerate();
        let mut tasks: Vec<Descriptions<'_>> = lists
            .map(|(task, ((ends, hashes), (name_classes, builtin_names)))| Descriptions {
                first: task * STRINGS_IN_A_TASK,
                ends,
                hashes,
                name_classes,
                builtin_names,
            })
            .collect();
        for_each_mut(&mut tasks, in_parallel, &|task| {
            for offset in 0..task.ends.len() {
                let (table, id) = string_at(task.first + offset);
                task.ends[offset] = table.get(id).len();
                task.hashes[offset] = table.hash(id);
                task.name_classes[offset] = table.name_class(id);
                task.builtin_names[offset] = table.builtin_name(id);
            }
        });
        let mut end = 0;
        for length in &mut own.ends {
            end += *length;
            *length = end;
        }
        own.bytes = vec![0; end];
        let (mut rest, mut start) = (own.bytes.as_mut_slice(), 0);
        let mut tasks: Vec<Copies<'_>> = Vec::with_capacity(count.div_ceil(STRINGS_IN_A_TASK));
        for (task, ends) in own.ends.chunks(STRINGS_IN_A_TASK).enumerate() {
            let end = ends[ends.len() - 1];
            let (bytes, after) = core::mem::take(&mut rest).split_at_mut(end - start);
            tasks.push(Copies {
                first: task * STRINGS_IN_A_TASK,
                ends,
                start,
                bytes,
            });
            (rest, start) = (after, end);
        }
        for_each_mut(&mut tasks, in_parallel, &|task| {
            let mut start = 0;
            for (offset, end) in task.ends.iter().map(|end| end - task.start).enumerate() {
                let (table, id) = string_at(task.first + offset);
                task.bytes[start..end].copy_from_slice(table.get(id));
                start = end;
            }
        });
        let mut ids = hashbrown::HashTable::with_capacity(count);
        for (index, &hash) in own.hashes.iter().enumerate() {
            ids.insert_unique(hash, StringId::new(index), |&id: &StringId| own.hashes[id.index()]);
        }
        StringTable {
            strings: StringList::Own(own),
            ids,
        }
    }

    /// For a table that is complete and waits with many others.
    pub fn share_strings(&mut self) {
        let StringList::Own(own) = &self.strings else {
            return;
        };
        let known = StringsOfAllTables::current();
        let mut start = 0;
        let strings = (0..own.ends.len()).map(|index| {
            let bytes = &own.bytes[core::mem::replace(&mut start, own.ends[index])..own.ends[index]];
            let describe = || (own.name_classes[index], own.builtin_names[index]);
            known.intern(own.hashes[index], bytes, describe)
        });
        let strings = strings.collect();
        self.strings = StringList::Shared(SharedStringList {
            strings,
            byte_len: own.bytes.len(),
            all_bytes: OnceLock::new(),
            known,
        });
    }

    pub fn intern(&mut self, bytes: &[u8]) -> StringId {
        let joined = join_surrogate_pairs(bytes);
        let bytes = joined.as_deref().unwrap_or(bytes);
        self.intern_hashed(StringTable::hash_of(bytes), bytes)
    }

    pub fn intern_hashed(&mut self, hash: u64, bytes: &[u8]) -> StringId {
        debug_assert_eq!(hash, StringTable::hash_of(bytes));
        debug_assert!(join_surrogate_pairs(bytes).is_none());
        match self.find_hashed(hash, bytes) {
            Some(id) => id,
            None => self.add(hash, bytes, || (classify_name(bytes), find_builtin_name(hash, bytes))),
        }
    }

    pub fn release_spare_capacity(&mut self) {
        match &mut self.strings {
            StringList::Own(own) => {
                release_spare_capacity(&mut own.bytes);
                release_spare_capacity(&mut own.ends);
                release_spare_capacity(&mut own.hashes);
                release_spare_capacity(&mut own.name_classes);
                release_spare_capacity(&mut own.builtin_names);
            }
            StringList::Shared(list) => release_spare_capacity(&mut list.strings),
        }
    }

    pub fn intern_from(&mut self, other: &StringTable, id: StringId) -> StringId {
        let (hash, bytes) = (other.hash(id), other.get(id));
        match self.find_hashed(hash, bytes) {
            Some(id) => id,
            None => self.add(hash, bytes, || (other.name_class(id), other.builtin_name(id))),
        }
    }

    /// Makes room for that many more strings. Their bytes find room as they come.
    pub fn reserve(&mut self, additional: usize) {
        match &mut self.strings {
            StringList::Own(own) => {
                own.ends.reserve(additional);
                own.hashes.reserve(additional);
                own.name_classes.reserve(additional);
                own.builtin_names.reserve(additional);
            }
            StringList::Shared(list) => list.strings.reserve(additional),
        }
        let strings = &self.strings;
        self.ids.reserve(additional, |&id| strings.hash(id.index()));
    }

    pub fn find(&self, bytes: &[u8]) -> Option<StringId> {
        self.find_hashed(StringTable::hash_of(bytes), bytes)
    }

    #[inline]
    pub fn get(&self, id: StringId) -> &[u8] {
        let index = id.index();
        match &self.strings {
            StringList::Own(own) => {
                let start = if index == 0 { 0 } else { own.ends[index - 1] };
                &own.bytes[start..own.ends[index]]
            }
            StringList::Shared(list) => &list.strings[index].bytes,
        }
    }

    #[inline]
    pub fn hash(&self, id: StringId) -> u64 {
        self.strings.hash(id.index())
    }

    #[inline]
    pub fn name_class(&self, id: StringId) -> NameClass {
        match &self.strings {
            StringList::Own(own) => own.name_classes[id.index()],
            StringList::Shared(list) => list.strings[id.index()].name_class,
        }
    }

    #[inline]
    pub fn builtin_name(&self, id: StringId) -> Option<BuiltinName> {
        match &self.strings {
            StringList::Own(own) => own.builtin_names[id.index()],
            StringList::Shared(list) => list.strings[id.index()].builtin_name,
        }
    }

    pub fn len(&self) -> usize {
        match &self.strings {
            StringList::Own(own) => own.ends.len(),
            StringList::Shared(list) => list.strings.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn byte_len(&self) -> usize {
        match &self.strings {
            StringList::Own(own) => own.bytes.len(),
            StringList::Shared(list) => list.byte_len,
        }
    }

    /// Of a table that shares its strings: a copy, which stays.
    pub fn bytes(&self) -> &[u8] {
        match &self.strings {
            StringList::Own(own) => &own.bytes,
            StringList::Shared(list) => list.all_bytes.get_or_init(|| {
                let mut all = Vec::with_capacity(list.byte_len);
                for string in &list.strings {
                    all.extend_from_slice(&string.bytes);
                }
                all
            }),
        }
    }

    pub fn ids(&self) -> impl ExactSizeIterator<Item = StringId> + Clone + use<> {
        (0..self.len()).map(StringId::new)
    }

    fn add(
        &mut self,
        hash: u64,
        bytes: &[u8],
        describe: impl FnOnce() -> (NameClass, Option<BuiltinName>),
    ) -> StringId {
        let id = StringId::new(self.len());
        match &mut self.strings {
            StringList::Own(own) => {
                let (name_class, builtin_name) = describe();
                own.bytes.extend_from_slice(bytes);
                own.ends.push(own.bytes.len());
                own.hashes.push(hash);
                own.name_classes.push(name_class);
                own.builtin_names.push(builtin_name);
            }
            StringList::Shared(list) => {
                debug_assert!(list.all_bytes.get().is_none());
                list.strings.push(list.known.intern(hash, bytes, describe));
                list.byte_len += bytes.len();
            }
        }
        let strings = &self.strings;
        self.ids.insert_unique(hash, id, |&id| strings.hash(id.index()));
        id
    }

    fn find_hashed(&self, hash: u64, bytes: &[u8]) -> Option<StringId> {
        self.ids.find(hash, |&id| self.get(id) == bytes).copied()
    }
}

impl StringList {
    #[inline]
    fn hash(&self, index: usize) -> u64 {
        match self {
            StringList::Own(own) => own.hashes[index],
            StringList::Shared(list) => list.strings[index].hash,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::table::find_name;

    #[test]
    fn table_of_distinct_strings_is_the_table_that_interning_them_gives() {
        let mut sources = [StringTable::default(), StringTable::sharing_strings()];
        let texts: Vec<String> = (0..5000).map(|index| "x".repeat(index % 7) + &index.to_string()).collect();
        let mut places = Vec::new();
        for (index, text) in texts.iter().chain([&"length".to_string(), &String::new()]).enumerate() {
            places.push((index % 2, sources[index % 2].intern(text.as_bytes())));
        }
        let string_at = |index: usize| (&sources[places[index].0], places[index].1);
        let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| (0..count).rev().for_each(work);
        let table = StringTable::of_distinct_strings(places.len(), &string_at, &in_reverse);
        let mut interned = StringTable::default();
        for index in 0..places.len() {
            let (source, id) = string_at(index);
            assert_eq!(interned.intern_from(source, id).index(), index);
        }
        assert_eq!(table.len(), interned.len());
        assert_eq!(table.bytes(), interned.bytes());
        for id in interned.ids() {
            assert_eq!(table.get(id), interned.get(id));
            assert_eq!(table.hash(id), interned.hash(id));
            assert_eq!(table.name_class(id), interned.name_class(id));
            assert_eq!(table.builtin_name(id), interned.builtin_name(id));
            assert_eq!(table.find(interned.get(id)), Some(id));
        }
        let empty = StringTable::of_distinct_strings(0, &string_at, &in_reverse);
        assert!(empty.is_empty());
    }

    #[test]
    fn builtin_name_is_the_one_that_the_table_finds() {
        let mut strings = StringTable::default();
        let names = (0..).map(BuiltinName).take_while(|&name| !is_symbol_name(name));
        for name in names {
            let id = strings.intern(text_of_name(name));
            assert_eq!(strings.builtin_name(id), find_name(text_of_name(name)));
            assert_eq!(strings.builtin_name(id), Some(name));
        }
        let other = strings.intern(b"no name of the table");
        assert_eq!(strings.builtin_name(other), None);
    }

    #[test]
    fn tables_that_share_strings_answer_like_a_table_of_its_own() {
        let written: [&[u8]; 6] = [b"length", b"", b"a name", b"12", b"length", b"then"];
        let mut own = StringTable::default();
        let mut first = StringTable::sharing_strings();
        let mut second = StringTable::sharing_strings();
        for bytes in written {
            assert_eq!(first.intern(bytes), own.intern(bytes));
        }
        for bytes in written.iter().rev() {
            second.intern(bytes);
        }
        first.release_spare_capacity();
        assert_eq!(first.len(), own.len());
        assert_eq!(first.byte_len(), own.byte_len());
        for id in own.ids() {
            assert_eq!(first.get(id), own.get(id));
            assert_eq!(first.hash(id), own.hash(id));
            assert_eq!(first.name_class(id), own.name_class(id));
            assert_eq!(first.builtin_name(id), own.builtin_name(id));
            assert_eq!(first.find(own.get(id)), Some(id));
        }
        assert_eq!(first.bytes(), own.bytes());
        let (in_first, in_second) = (first.find(b"a name"), second.find(b"a name"));
        assert_ne!(in_first, in_second);
        let (in_first, in_second) = (first.get(in_first.unwrap()), second.get(in_second.unwrap()));
        assert!(core::ptr::eq(in_first, in_second));
        let mut copied = StringTable::default();
        for id in first.ids() {
            assert_eq!(copied.intern_from(&first, id), id);
        }
    }

    #[test]
    fn table_that_shares_its_strings_when_it_is_complete_stays_the_same() {
        let written: [&[u8]; 5] = [b"length", b"", b"a name", b"12", b"then"];
        let mut own = StringTable::default();
        let mut shared = StringTable::default();
        for bytes in written {
            own.intern(bytes);
            shared.intern(bytes);
        }
        shared.share_strings();
        shared.share_strings();
        assert_eq!(shared.byte_len(), own.byte_len());
        for id in own.ids() {
            assert_eq!(shared.get(id), own.get(id));
            assert_eq!(shared.hash(id), own.hash(id));
            assert_eq!(shared.name_class(id), own.name_class(id));
            assert_eq!(shared.builtin_name(id), own.builtin_name(id));
            assert_eq!(shared.find(own.get(id)), Some(id));
        }
        assert_eq!(shared.intern(b"one more"), own.intern(b"one more"));
    }
}
