use bun_sema::hir::MemberId;

use crate::ir::PropertyKeyId;
use crate::ir::generated::{Field, FieldFlags};

#[derive(Default)]
pub(in crate::lower) struct OwnFields {
    fields: Vec<Field>,
    fields_by_key: Vec<u32>,
    accessor_storages: Vec<(MemberId, u32)>,
    brand: Option<u32>,
}

impl OwnFields {
    pub(super) fn add(&mut self, field: Field) -> u32 {
        debug_assert!(
            self.fields_by_key.is_empty(),
            "fields are added before finish"
        );
        let index = u32::try_from(self.fields.len()).expect("the fields of a layout fit 32 bits");
        if field.flags.contains(FieldFlags::IS_BRAND) {
            debug_assert!(self.brand.is_none(), "a layout has one brand");
            self.brand = Some(index);
        }
        self.fields.push(field);
        index
    }

    pub(super) fn add_accessor_storage(&mut self, member: MemberId, field: Field) {
        debug_assert!(
            field.flags.contains(FieldFlags::IS_PRIVATE),
            "storage is private state"
        );
        let index = self.add(field);
        self.accessor_storages.push((member, index));
    }

    pub(super) fn replace(&mut self, index: u32, field: Field) {
        debug_assert_eq!(self.fields[index as usize].key, field.key);
        self.fields[index as usize] = field;
    }

    pub(super) fn find_unindexed(&self, key: PropertyKeyId) -> Option<u32> {
        let position = self.fields.iter().position(|field| field.key == Some(key));
        position.map(|position| position as u32)
    }

    pub(super) fn finish(mut self) -> OwnFields {
        let fields = &self.fields;
        let mut by_key: Vec<u32> = (0..fields.len() as u32)
            .filter(|&index| fields[index as usize].key.is_some())
            .collect();
        by_key.sort_unstable_by_key(|&index| fields[index as usize].key);
        debug_assert!(
            by_key
                .iter()
                .zip(by_key.iter().skip(1))
                .all(|(&left, &right)| fields[left as usize].key != fields[right as usize].key),
            "a key names one own field"
        );
        self.fields_by_key = by_key;
        self.accessor_storages.sort_unstable_by_key(|entry| entry.0);
        self
    }

    pub(in crate::lower) fn find(&self, key: PropertyKeyId) -> Option<u32> {
        let key_of = |&index: &u32| self.fields[index as usize].key;
        let found = self.fields_by_key.binary_search_by_key(&Some(key), key_of);
        found.ok().map(|found| self.fields_by_key[found])
    }

    pub(in crate::lower) fn find_accessor_storage(&self, member: MemberId) -> Option<u32> {
        let storages = &self.accessor_storages;
        let found = storages.binary_search_by_key(&member, |entry| entry.0);
        found.ok().map(|found| storages[found].1)
    }

    pub(in crate::lower) fn brand(&self) -> Option<u32> {
        self.brand
    }

    pub(in crate::lower) fn get(&self, field: u32) -> &Field {
        &self.fields[field as usize]
    }

    pub(in crate::lower) fn as_slice(&self) -> &[Field] {
        &self.fields
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::Id;

    fn named(key: usize) -> Field {
        Field {
            key: Some(PropertyKeyId::new(key)),
            ..Field::default()
        }
    }

    fn hidden(key: usize, flags: FieldFlags) -> Field {
        Field {
            flags: flags | FieldFlags::IS_HIDDEN | FieldFlags::IS_PRIVATE,
            ..named(key)
        }
    }

    #[test]
    fn fields_keep_declaration_order_and_are_found_by_key() {
        let mut fields = OwnFields::default();
        assert_eq!(fields.add(named(9)), 0);
        assert_eq!(fields.add(named(2)), 1);
        assert_eq!(fields.add(named(5)), 2);
        let fields = fields.finish();
        let keys: Vec<_> = fields.as_slice().iter().map(|field| field.key).collect();
        let expected = [9, 2, 5].map(|key| Some(PropertyKeyId::new(key)));
        assert_eq!(keys, expected);
        assert_eq!(fields.find(PropertyKeyId::new(9)), Some(0));
        assert_eq!(fields.find(PropertyKeyId::new(2)), Some(1));
        assert_eq!(fields.find(PropertyKeyId::new(5)), Some(2));
        assert_eq!(fields.find(PropertyKeyId::new(3)), None);
    }

    #[test]
    fn hidden_fields_are_found_by_role() {
        let mut fields = OwnFields::default();
        fields.add(hidden(4, FieldFlags::IS_BRAND));
        fields.add(named(0));
        fields.add_accessor_storage(MemberId(7), hidden(5, FieldFlags::default()));
        let fields = fields.finish();
        assert_eq!(fields.brand(), Some(0));
        assert_eq!(fields.find(PropertyKeyId::new(0)), Some(1));
        assert_eq!(fields.find_accessor_storage(MemberId(7)), Some(2));
        assert_eq!(fields.find_accessor_storage(MemberId(8)), None);
    }

    #[test]
    fn empty_layout_has_no_field() {
        let fields = OwnFields::default().finish();
        assert_eq!(fields.brand(), None);
        assert_eq!(fields.find(PropertyKeyId::new(0)), None);
        assert!(fields.as_slice().is_empty());
        let unfinished = OwnFields::default();
        assert_eq!(unfinished.find(PropertyKeyId::new(0)), None);
    }

    #[test]
    fn later_declaration_replaces_field_in_place() {
        let mut fields = OwnFields::default();
        fields.add(named(1));
        fields.add(named(2));
        let index = fields.find_unindexed(PropertyKeyId::new(1)).unwrap();
        let replacement = Field {
            flags: FieldFlags::IS_REQUIRED,
            ..named(1)
        };
        fields.replace(index, replacement);
        let fields = fields.finish();
        assert_eq!(fields.find(PropertyKeyId::new(1)), Some(0));
        assert!(fields.get(0).flags.contains(FieldFlags::IS_REQUIRED));
    }
}
