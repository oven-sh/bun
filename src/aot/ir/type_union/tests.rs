use super::*;
use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::ir::testing::{array_of, layout, string};

fn array_part(contents: TypeId) -> ClassPart {
    ClassPart {
        builtin_class: BuiltinClass::Array,
        contents: vec![contents],
    }
}

fn map_of(key: TypeId, value: TypeId) -> Type {
    Type::class(BuiltinClass::Map, &[key, value])
}

fn normalize(table: &mut TypeTable, mut ty: Type) -> Type {
    normalize_type(table, &mut ty);
    ty
}

fn intern_sample_types(table: &mut TypeTable) -> Vec<TypeId> {
    let interned = [
        Type::integers(5, 6),
        Type::string_literal(string(1)),
        Type::layout(layout(1)),
        Type::builtin(BuiltinId::GlobalThis),
        array_of(TypeTable::NUMBER),
        map_of(TypeTable::STRING, TypeTable::NUMBER),
    ];
    let mut types = vec![
        TypeTable::UNDEFINED,
        TypeTable::BOOLEAN,
        TypeTable::NUMBER,
        TypeTable::INT32,
        TypeTable::STRING,
        TypeTable::OBJECT,
        TypeTable::FUNCTION,
        TypeTable::ARRAY,
    ];
    types.extend(interned.map(|ty| table.intern(ty)));
    types
}

#[test]
fn normalizing_twice_changes_nothing() {
    let mut table = TypeTable::new();
    let types = [
        Type {
            strings: vec![string(2), string(1), string(2)],
            layouts: vec![layout(3), layout(0), layout(3)],
            builtins: vec![BuiltinId::ArrayPrototype, BuiltinId::GlobalThis],
            ..Type::default()
        },
        Type {
            primitives: Primitives::STRING | Primitives::NUMBER,
            strings: vec![string(1)],
            ..Type::integers(0, 5)
        },
        Type {
            classes: vec![array_part(TypeTable::STRING), array_part(TypeTable::NUMBER)],
            ..Type::default()
        },
        Type {
            flags: TypeFlags::ANY_OBJECT,
            layouts: vec![layout(1)],
            ..Type::default()
        },
        Type::integers(0, MAX_TRACKED_INTEGER + 1),
    ];
    for ty in types {
        let once = normalize(&mut table, ty.clone());
        assert_ne!(once, ty);
        assert_eq!(normalize(&mut table, once.clone()), once);
    }
}

#[test]
fn only_repeated_classes_intern_merged_contents() {
    let mut table = TypeTable::new();
    let map_part = ClassPart {
        builtin_class: BuiltinClass::Map,
        contents: vec![TypeTable::STRING, TypeTable::NUMBER],
    };
    let distinct_classes = Type {
        strings: vec![string(2), string(1)],
        classes: vec![map_part, array_part(TypeTable::NUMBER)],
        ..Type::default()
    };
    normalize(&mut table, distinct_classes);
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT);

    let repeated_class = Type {
        classes: vec![array_part(TypeTable::NUMBER), array_part(TypeTable::STRING)],
        ..Type::default()
    };
    let merged = normalize(&mut table, repeated_class);
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT + 1);
    let [part] = &merged.classes[..] else {
        panic!("{} class parts", merged.classes.len());
    };
    let number_or_string = Type::primitives(Primitives::NUMBER | Primitives::STRING);
    assert_eq!(*table.get(part.contents[0]), number_or_string);
}

#[test]
fn every_part_of_one_class_merges() {
    let mut table = TypeTable::new();
    let contents = [TypeTable::NUMBER, TypeTable::STRING, TypeTable::BOOLEAN];
    let [numbers, strings, booleans] = contents.map(array_part);
    let set = ClassPart {
        builtin_class: BuiltinClass::Set,
        contents: vec![TypeTable::NULL],
    };
    let ty = Type {
        classes: vec![set.clone(), numbers, strings, set, booleans],
        ..Type::default()
    };
    let merged = normalize(&mut table, ty);
    let classes = merged.classes.iter().map(|part| part.builtin_class);
    let classes: Vec<BuiltinClass> = classes.collect();
    assert_eq!(classes, [BuiltinClass::Array, BuiltinClass::Set]);
    assert_eq!(merged.classes[0].contents, [table.union_all(contents)]);
    assert_eq!(merged.classes[1].contents, [TypeTable::NULL]);
}

#[test]
fn contents_merge_slot_by_slot() {
    let mut table = TypeTable::new();
    let first = table.intern(map_of(TypeTable::STRING, TypeTable::NUMBER));
    let second = table.intern(map_of(TypeTable::BOOLEAN, TypeTable::NULL));
    let union = table.union(first, second);
    let key = table.union(TypeTable::STRING, TypeTable::BOOLEAN);
    let value = table.union(TypeTable::NUMBER, TypeTable::NULL);
    assert_ne!(key, value);
    assert_eq!(*table.get(union), map_of(key, value));
}

#[test]
fn nested_contents_merge() {
    let mut table = TypeTable::new();
    let [numbers, strings] =
        [TypeTable::NUMBER, TypeTable::STRING].map(|contents| table.intern(array_of(contents)));
    let [number_lists, string_lists] =
        [numbers, strings].map(|contents| table.intern(array_of(contents)));
    let union = table.union(number_lists, string_lists);
    let inner = table.union(numbers, strings);
    assert_eq!(*table.get(union), array_of(inner));
    let number_or_string = table.union(TypeTable::NUMBER, TypeTable::STRING);
    assert_eq!(*table.get(inner), array_of(number_or_string));
}

#[test]
fn contents_follow_union_rules() {
    let mut table = TypeTable::new();
    let numbers = table.intern(array_of(TypeTable::NUMBER));
    let nothing = table.intern(array_of(TypeTable::NEVER));
    assert_eq!(table.union(nothing, numbers), numbers);
    assert_eq!(table.union(numbers, TypeTable::ARRAY), TypeTable::ARRAY);
}

#[test]
fn hull_covers_only_members_with_a_range() {
    let mut table = TypeTable::new();
    let [low, high, negative_low, negative_high] = [(5, 6), (8, 9), (-9, -8), (-6, -5)]
        .map(|(minimum, maximum)| table.intern(Type::integers(minimum, maximum)));

    let positive = table.union(low, high);
    assert_eq!(*table.get(positive), Type::integers(5, 9));
    let negative = table.union(negative_high, negative_low);
    assert_eq!(*table.get(negative), Type::integers(-9, -5));
    for members in [
        [TypeTable::STRING, low, high],
        [low, TypeTable::STRING, high],
    ] {
        let union = table.union_all(members);
        assert_eq!(table.get(union).integer_range(), Some((5, 9)));
        assert_eq!(table.get(union).primitives, Primitives::STRING);
    }
    let inside = table.union(TypeTable::INT32, low);
    assert_eq!(inside, TypeTable::INT32);
}

#[test]
fn empty_range_leaves_other_parts() {
    let mut table = TypeTable::new();
    let bounds = [(1, 0), (MAX_TRACKED_INTEGER + 2, MAX_TRACKED_INTEGER + 1)];
    for (minimum, maximum) in bounds {
        let ty = Type {
            flags: TypeFlags::HAS_INTEGERS,
            minimum,
            maximum,
            layouts: vec![layout(1)],
            ..Type::default()
        };
        assert_eq!(normalize(&mut table, ty), Type::layout(layout(1)));
    }
}

#[test]
fn any_function_absorbs_no_object_part() {
    let mut table = TypeTable::new();
    let ty = Type {
        flags: TypeFlags::ANY_FUNCTION,
        layouts: vec![layout(1)],
        classes: vec![array_part(TypeTable::NUMBER)],
        builtins: vec![BuiltinId::GlobalThis],
        ..Type::default()
    };
    assert_eq!(normalize(&mut table, ty.clone()), ty);
}

#[test]
fn any_object_absorbs_every_object_part() {
    let mut table = TypeTable::new();
    let builtin = table.intern(Type::builtin(BuiltinId::GlobalThis));
    let object = table.intern(Type::layout(layout(1)));
    let members = [
        builtin,
        TypeTable::FUNCTION,
        object,
        TypeTable::ARRAY,
        TypeTable::OBJECT,
    ];
    assert_eq!(table.union_all(members), TypeTable::OBJECT);
}

#[test]
fn union_is_associative() {
    let mut table = TypeTable::new();
    let types = intern_sample_types(&mut table);
    for &first in &types {
        for &second in &types {
            let first_two = table.union(first, second);
            for &third in &types {
                let last_two = table.union(second, third);
                let union = table.union(first_two, third);
                assert_eq!(table.union(first, last_two), union);
                assert_eq!(table.union_all([first, second, third]), union);
            }
        }
    }
}

#[test]
fn union_of_one_distinct_member_interns_nothing() {
    let mut table = TypeTable::new();
    let object = table.intern(Type::layout(layout(1)));
    let count = table.len();
    let never = TypeTable::NEVER;
    assert_eq!(
        table.union_all([never, object, object, never, object]),
        object
    );
    assert_eq!(table.union(object, never), object);
    assert_eq!(table.len(), count);
}

#[test]
fn removing_nothing_changes_nothing() {
    let mut table = TypeTable::new();
    for ty in intern_sample_types(&mut table) {
        assert_eq!(table.without_primitives(ty, Primitives::default()), ty);
        assert_eq!(table.without_primitives(ty, Primitives::ABSENT), ty);
    }
}

#[test]
fn removing_one_kind_keeps_parts_of_other_kinds() {
    let mut table = TypeTable::new();
    let ty = table.intern(Type {
        primitives: Primitives::BOOLEAN | Primitives::ABSENT,
        strings: vec![string(1)],
        layouts: vec![layout(1)],
        ..Type::integers(0, 5)
    });
    let remove = |table: &mut TypeTable, removed: Primitives| {
        let remaining = table.without_primitives(ty, removed);
        table.get(remaining).clone()
    };
    let whole = table.get(ty).clone();

    let without_true = Type {
        primitives: Primitives::FALSE | Primitives::ABSENT,
        ..whole.clone()
    };
    assert_eq!(remove(&mut table, Primitives::TRUE), without_true);
    let without_absent = Type {
        primitives: Primitives::BOOLEAN,
        ..whole.clone()
    };
    assert_eq!(remove(&mut table, Primitives::ABSENT), without_absent);
    let without_string = Type {
        strings: Vec::new(),
        ..whole.clone()
    };
    assert_eq!(remove(&mut table, Primitives::STRING), without_string);
    let without_number = Type {
        flags: TypeFlags::default(),
        minimum: 0,
        maximum: 0,
        ..whole
    };
    assert_eq!(remove(&mut table, Primitives::NUMBER), without_number);
    assert_eq!(remove(&mut table, Primitives::ALL), Type::layout(layout(1)));
}

#[test]
#[cfg(not(debug_assertions))]
fn internal_type_in_union_is_anything() {
    let mut table = TypeTable::new();
    let environment = table.intern(Type::environment(layout(0)));
    assert_eq!(
        table.union(environment, TypeTable::NUMBER),
        TypeTable::ANYTHING
    );
    assert_eq!(
        table.union(TypeTable::NUMBER, environment),
        TypeTable::ANYTHING
    );
}
