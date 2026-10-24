use hashbrown::HashTable;

pub use super::generated::{PropertyKey, PropertyKeyKind, WellKnownSymbol};
use super::ids::{Id, LayoutId, ModuleId, PropertyKeyId, StringId};
use super::types::{hash_of, release_spare_capacity};

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
        position: u32,
        description: Option<StringId>,
    ) -> PropertyKey {
        PropertyKey {
            kind: PropertyKeyKind::CreatedSymbol,
            text: description,
            module: Some(module),
            position: Some(position),
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

#[derive(Default)]
pub struct PropertyKeyTable {
    list: Vec<PropertyKey>,
    ids: HashTable<PropertyKeyId>,
}

impl PropertyKeyTable {
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

    pub fn release_spare_capacity(&mut self) {
        release_spare_capacity(&mut self.list);
    }

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

    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    pub fn as_slice(&self) -> &[PropertyKey] {
        &self.list
    }
}
