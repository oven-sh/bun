use crate::ir::ids::{Id, LayoutId, ModuleId, PropertyKeyId, StringId};
use crate::ir::property_keys::{PropertyKey, PropertyKeyKind, PropertyKeyTable, WellKnownSymbol};

const TEXT: StringId = StringId::from_word(3);
const OTHER_TEXT: StringId = StringId::from_word(4);
const OWNER: LayoutId = LayoutId::from_word(5);
const MODULE: ModuleId = ModuleId::from_word(6);
const POSITION: u32 = 120;

fn keys_of_every_kind() -> [PropertyKey; 5] {
    [
        PropertyKey::from_text(TEXT),
        PropertyKey::from_engine_private_name(TEXT),
        PropertyKey::from_private_name(TEXT, OWNER),
        PropertyKey::from_well_known_symbol(WellKnownSymbol::Iterator),
        PropertyKey::from_created_symbol(MODULE, POSITION, Some(TEXT)),
    ]
}

fn intern_all(table: &mut PropertyKeyTable, keys: &[PropertyKey]) -> Vec<PropertyKeyId> {
    keys.iter().map(|&key| table.intern(key)).collect()
}

fn first_ids(count: usize) -> Vec<PropertyKeyId> {
    (0..count).map(PropertyKeyId::new).collect()
}

#[test]
fn equal_keys_have_one_id() {
    let mut table = PropertyKeyTable::default();
    assert!(table.is_empty());
    let keys = keys_of_every_kind();
    let ids = intern_all(&mut table, &keys);
    assert_eq!(intern_all(&mut table, &keys), ids);
    assert_eq!(table.len(), keys.len());
    assert!(!table.is_empty());
}

#[test]
fn kinds_of_one_text_are_distinct() {
    let mut table = PropertyKeyTable::default();
    let keys = keys_of_every_kind();
    assert_eq!(intern_all(&mut table, &keys), first_ids(5));
    let kinds: Vec<PropertyKeyKind> = table.as_slice().iter().map(|key| key.kind).collect();
    assert_eq!(kinds, PropertyKeyKind::ALL);
}

#[test]
fn texts_of_one_kind_are_distinct() {
    let mut table = PropertyKeyTable::default();
    let keys = [
        PropertyKey::from_text(TEXT),
        PropertyKey::from_text(OTHER_TEXT),
        PropertyKey::from_engine_private_name(TEXT),
        PropertyKey::from_engine_private_name(OTHER_TEXT),
        PropertyKey::from_well_known_symbol(WellKnownSymbol::Iterator),
        PropertyKey::from_well_known_symbol(WellKnownSymbol::AsyncIterator),
    ];
    assert_eq!(intern_all(&mut table, &keys), first_ids(keys.len()));
}

#[test]
fn private_names_of_two_owners_are_distinct() {
    let mut table = PropertyKeyTable::default();
    let first = table.intern(PropertyKey::from_private_name(TEXT, OWNER));
    let second = table.intern(PropertyKey::from_private_name(TEXT, LayoutId::new(9)));
    assert_ne!(first, second);
    assert_eq!(
        table.intern(PropertyKey::from_private_name(TEXT, OWNER)),
        first
    );
}

#[test]
fn created_symbols_differ_by_module_and_position() {
    let mut table = PropertyKeyTable::default();
    let keys = [
        PropertyKey::from_created_symbol(MODULE, POSITION, None),
        PropertyKey::from_created_symbol(ModuleId::new(7), POSITION, None),
        PropertyKey::from_created_symbol(MODULE, POSITION + 1, None),
    ];
    assert_eq!(intern_all(&mut table, &keys), first_ids(3));
    assert_eq!(intern_all(&mut table, &keys), first_ids(3));
}

#[test]
fn equal_descriptions_do_not_make_sites_equal() {
    let mut table = PropertyKeyTable::default();
    let first = table.intern(PropertyKey::from_created_symbol(MODULE, 1, Some(TEXT)));
    let second = table.intern(PropertyKey::from_created_symbol(MODULE, 2, Some(TEXT)));
    assert_ne!(first, second);
}

#[test]
fn find_returns_interned_keys_only() {
    let mut table = PropertyKeyTable::default();
    let key = PropertyKey::from_text(TEXT);
    assert_eq!(table.find(&key), None);
    let id = table.intern(key);
    assert_eq!(table.find(&key), Some(id));
    assert_eq!(
        table.find(&PropertyKey::from_engine_private_name(TEXT)),
        None
    );
    assert_eq!(table.len(), 1);
}

#[test]
fn keys_are_stored_in_id_order() {
    let mut table = PropertyKeyTable::default();
    let keys = keys_of_every_kind();
    let ids = intern_all(&mut table, &keys);
    assert_eq!(table.as_slice(), keys);
    for (id, key) in ids.into_iter().zip(keys) {
        assert_eq!(*table.get(id), key);
    }
}

#[test]
fn ids_survive_index_growth() {
    let mut table = PropertyKeyTable::default();
    let keys: Vec<PropertyKey> = (0..2000)
        .map(|index| PropertyKey::from_text(StringId::new(index)))
        .collect();
    assert_eq!(intern_all(&mut table, &keys), first_ids(keys.len()));
    for (index, key) in keys.iter().enumerate() {
        assert_eq!(table.find(key), Some(PropertyKeyId::new(index)));
    }
    assert_eq!(table.len(), keys.len());
}

#[test]
fn constructors_leave_other_fields_absent() {
    let [
        text,
        engine_private_name,
        private_name,
        well_known_symbol,
        created_symbol,
    ] = keys_of_every_kind();
    let expected_text = PropertyKey {
        kind: PropertyKeyKind::Text,
        text: Some(TEXT),
        owner: None,
        symbol: None,
        module: None,
        position: None,
    };
    assert_eq!(text, expected_text);
    let expected_engine_private_name = PropertyKey {
        kind: PropertyKeyKind::EnginePrivateName,
        ..expected_text
    };
    assert_eq!(engine_private_name, expected_engine_private_name);
    let expected_private_name = PropertyKey {
        kind: PropertyKeyKind::PrivateName,
        owner: Some(OWNER),
        ..expected_text
    };
    assert_eq!(private_name, expected_private_name);
    let expected_well_known_symbol = PropertyKey {
        kind: PropertyKeyKind::WellKnownSymbol,
        text: None,
        symbol: Some(WellKnownSymbol::Iterator),
        ..expected_text
    };
    assert_eq!(well_known_symbol, expected_well_known_symbol);
    let expected_created_symbol = PropertyKey {
        kind: PropertyKeyKind::CreatedSymbol,
        module: Some(MODULE),
        position: Some(POSITION),
        ..expected_text
    };
    assert_eq!(created_symbol, expected_created_symbol);
    let without_description = PropertyKey::from_created_symbol(MODULE, POSITION, None);
    assert_eq!(without_description.text, None);
}

#[test]
fn only_names_have_string_name() {
    let names = keys_of_every_kind().map(|key| key.string_name());
    assert_eq!(names, [Some(TEXT), Some(TEXT), Some(TEXT), None, None]);
}
