use core::cmp::Ordering;

use hashbrown::HashTable;

pub use super::generated::{PropertyKey, PropertyKeyKind, WellKnownSymbol};
use super::ids::{Id, LayoutId, ModuleId, PropertyKeyId, StringId};
use super::types::hash_of;

impl PropertyKey {
    pub fn from_text(text: StringId) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::Text,
            text: Some(text),
            ..PropertyKey::default()
        }
    }

    pub fn from_engine_private_name(text: StringId) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::EnginePrivateName,
            text: Some(text),
            ..PropertyKey::default()
        }
    }

    pub fn from_module_private_name(text: StringId) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::ModulePrivateName,
            text: Some(text),
            ..PropertyKey::default()
        }
    }

    pub fn from_private_name(text: StringId, owner: LayoutId) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::PrivateName,
            text: Some(text),
            owner: Some(owner),
            ..PropertyKey::default()
        }
    }

    pub fn from_well_known_symbol(symbol: WellKnownSymbol) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::WellKnownSymbol,
            symbol: Some(symbol),
            ..PropertyKey::default()
        }
    }

    pub fn from_created_symbol(
        module: ModuleId,
        call_number: u32,
        description: Option<StringId>,
    ) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::CreatedSymbol,
            text: description,
            module: Some(module),
            call_number: Some(call_number),
            ..PropertyKey::default()
        }
    }

    pub fn from_registered_symbol(text: StringId) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::RegisteredSymbol,
            text: Some(text),
            ..PropertyKey::default()
        }
    }

    pub fn string_name(&self) -> Option<StringId> {
        match self.kind {
            PropertyKeyKind::WellKnownSymbol
            | PropertyKeyKind::CreatedSymbol
            | PropertyKeyKind::RegisteredSymbol => None,
            _ => self.text,
        }
    }
}

/// Ids compare by number, and the numbers in a task's tables depend on the thread schedule. An order that reaches the program may compare
/// only keys that already hold program ids.
impl Ord for PropertyKey {
    fn cmp(&self, other: &PropertyKey) -> Ordering {
        let fields = |key: &PropertyKey| {
            let PropertyKey {
                kind,
                text,
                owner,
                symbol,
                module,
                call_number,
            } = *key;
            (kind, text, owner, symbol, module, call_number)
        };
        fields(self).cmp(&fields(other))
    }
}

impl PartialOrd for PropertyKey {
    fn partial_cmp(&self, other: &PropertyKey) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Default, Clone)]
pub struct PropertyKeyTable {
    list: Vec<PropertyKey>,
    ids: HashTable<PropertyKeyId>,
}

impl PropertyKeyTable {
    /// The keys take their ids in the given order. No two of them are alike.
    pub fn of_distinct_keys(keys: Vec<PropertyKey>) -> PropertyKeyTable {
        let mut ids: HashTable<PropertyKeyId> = HashTable::with_capacity(keys.len());
        for (index, key) in keys.iter().enumerate() {
            let hash = hash_of(key);
            debug_assert!(
                ids.find(hash, |&id| keys[id.index()] == *key).is_none(),
                "no two keys are alike"
            );
            let id = PropertyKeyId::new(index);
            ids.insert_unique(hash, id, |&id| hash_of(&keys[id.index()]));
        }
        PropertyKeyTable { list: keys, ids }
    }

    pub fn intern(&mut self, key: PropertyKey) -> PropertyKeyId {
        let hash = hash_of(&key);
        let list = &self.list;
        if let Some(&id) = self.ids.find(hash, |&id| list[id.index()] == key) {
            return id;
        }
        let id = PropertyKeyId::new(self.list.len());
        self.list.push(key);
        let list = &self.list;
        self.ids
            .insert_unique(hash, id, |&id| hash_of(&list[id.index()]));
        id
    }

    /// The keys interned next take the ids from `length` on: whoever holds one of those has to forget it.
    pub fn truncate(&mut self, length: usize) {
        if self.list.len() <= length {
            return;
        }
        self.list.truncate(length);
        self.ids.retain(|id| id.index() < length);
    }

    #[cfg(test)]
    pub fn find(&self, key: &PropertyKey) -> Option<PropertyKeyId> {
        let is_equal = |&id: &PropertyKeyId| self.list[id.index()] == *key;
        self.ids.find(hash_of(key), is_equal).copied()
    }

    #[inline]
    pub fn get(&self, id: PropertyKeyId) -> &PropertyKey {
        &self.list[id.index()]
    }

    pub fn len(&self) -> usize {
        self.list.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub fn as_slice(&self) -> &[PropertyKey] {
        &self.list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 0 stands for the least value of a field, 1 and 2 for the next two.
    fn key_of([kind, text, owner, symbol, module, call_number]: [u32; 6]) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::ALL[kind as usize],
            text: text.checked_sub(1).map(StringId::from_word),
            owner: owner.checked_sub(1).map(LayoutId::from_word),
            symbol: symbol
                .checked_sub(1)
                .map(|symbol| WellKnownSymbol::ALL[symbol as usize]),
            module: module.checked_sub(1).map(ModuleId::from_word),
            call_number: call_number.checked_sub(1),
        }
    }

    fn keys_of_texts(count: usize) -> Vec<PropertyKey> {
        let texts = (0..count).map(StringId::new);
        texts.map(PropertyKey::from_text).collect()
    }

    fn intern_all(keys: &[PropertyKey]) -> PropertyKeyTable {
        let mut table = PropertyKeyTable::default();
        for &key in keys {
            table.intern(key);
        }
        table
    }

    #[test]
    fn keys_are_ordered_by_their_fields_from_first_to_last() {
        let all: Vec<[u32; 6]> = (0..3u32.pow(6))
            .map(|number| core::array::from_fn(|place| number / 3u32.pow(place as u32) % 3))
            .collect();
        for first in &all {
            for second in &all {
                let (first_key, second_key) = (key_of(*first), key_of(*second));
                let expected = first.cmp(second);
                assert_eq!(first_key.cmp(&second_key), expected);
                assert_eq!(first_key.partial_cmp(&second_key), Some(expected));
                assert_eq!(first_key == second_key, expected.is_eq());
            }
        }
    }

    #[test]
    fn table_of_distinct_keys_behaves_like_one_that_interned_them() {
        let keys = keys_of_texts(300);
        let mut table = PropertyKeyTable::of_distinct_keys(keys.clone());
        let mut expected = intern_all(&keys);
        assert_eq!(table.as_slice(), keys);
        let further = PropertyKey::from_engine_private_name(StringId::new(0));
        assert_eq!(table.find(&further), None);
        for key in keys.iter().chain([&further]) {
            assert_eq!(table.intern(*key), expected.intern(*key));
            assert_eq!(table.find(key), expected.find(key));
        }
        assert_eq!(table.as_slice(), expected.as_slice());
    }

    #[test]
    fn truncated_table_behaves_like_one_that_never_held_the_cut_keys() {
        let written = keys_of_texts(5);
        for length in 0..=written.len() + 1 {
            let (kept, cut) = written.split_at(length.min(written.len()));
            let mut table = intern_all(&written);
            table.truncate(length);
            assert_eq!(table.as_slice(), kept);
            for key in cut {
                assert_eq!(table.find(key), None);
            }
            let mut expected = PropertyKeyTable::default();
            for &key in kept.iter().chain(cut.iter().rev()) {
                assert_eq!(table.intern(key), expected.intern(key));
            }
            assert_eq!(table.as_slice(), expected.as_slice());
        }
    }
}
