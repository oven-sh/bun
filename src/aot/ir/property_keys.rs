use hashbrown::HashTable;

pub use super::generated::{PropertyKey, PropertyKeyKind, WellKnownSymbol};
use super::ids::{
    ABSENT_WORD, Id, LayoutId, ModuleId, PropertyKeyId, StringId, optional_id_from_word,
    optional_id_to_word, optional_word,
};
use super::types::{hash_of, release_spare_capacity};
use super::waiting_lists::AsNumbers;

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

    pub fn string_name(&self) -> Option<StringId> {
        match self.kind {
            PropertyKeyKind::WellKnownSymbol | PropertyKeyKind::CreatedSymbol => None,
            _ => self.text,
        }
    }
}

/// The words of its record in the program that the engine reads.
impl AsNumbers for PropertyKey {
    type Numbers = [u32; 6];

    fn to_numbers(self) -> [u32; 6] {
        let PropertyKey {
            kind,
            text,
            owner,
            symbol,
            module,
            call_number,
        } = self;
        [
            kind.to_wire(),
            optional_id_to_word(text),
            optional_id_to_word(owner),
            symbol.map_or(ABSENT_WORD, WellKnownSymbol::to_wire),
            optional_id_to_word(module),
            optional_word(call_number),
        ]
    }

    fn from_numbers([kind, text, owner, symbol, module, call_number]: [u32; 6]) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::from_wire(kind).expect("`to_numbers` wrote it"),
            text: optional_id_from_word(text),
            owner: optional_id_from_word(owner),
            symbol: WellKnownSymbol::from_wire(symbol),
            module: optional_id_from_word(module),
            call_number: (call_number != ABSENT_WORD).then_some(call_number),
        }
    }
}

#[derive(Default, Clone)]
pub struct PropertyKeyTable {
    list: Vec<PropertyKey>,
    ids: HashTable<PropertyKeyId>,
}

impl PropertyKeyTable {
    /// For `WaitingLists`.
    pub fn list_mut(&mut self) -> &mut Vec<PropertyKey> {
        &mut self.list
    }

    /// For a table that waits with many others: nothing is added to it or looked up in it anymore.
    pub fn forget_ids(&mut self) {
        self.ids = Default::default();
    }

    pub fn intern(&mut self, key: PropertyKey) -> PropertyKeyId {
        debug_assert_eq!(self.ids.len(), self.list.len(), "`forget_ids` was the end");
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

    pub fn release_spare_capacity(&mut self) {
        release_spare_capacity(&mut self.list);
    }

    pub fn find(&self, key: &PropertyKey) -> Option<PropertyKeyId> {
        debug_assert_eq!(self.ids.len(), self.list.len(), "`forget_ids` was the end");
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
