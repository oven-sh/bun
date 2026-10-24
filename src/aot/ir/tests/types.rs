use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::ids::{Id, LayoutId, TypeId};
use crate::ir::testing::{array_of, layout, string};
use crate::ir::types::{ClassPart, OpaqueKind, Primitives, Type, TypeFlags, TypeTable};

fn builtin(word: u32) -> BuiltinId {
    BuiltinId::from_wire(word).expect("the table has the built-in")
}

fn well_known_types() -> [(TypeId, Type); TypeTable::WELL_KNOWN_COUNT] {
    [
        (TypeTable::NEVER, Type::never()),
        (
            TypeTable::UNDEFINED,
            Type::primitives(Primitives::UNDEFINED),
        ),
        (TypeTable::NULL, Type::primitives(Primitives::NULL)),
        (
            TypeTable::NULLISH,
            Type::primitives(Primitives::UNDEFINED | Primitives::NULL),
        ),
        (
            TypeTable::BOOLEAN,
            Type::primitives(Primitives::FALSE | Primitives::TRUE),
        ),
        (TypeTable::NUMBER, Type::primitives(Primitives::NUMBER)),
        (
            TypeTable::INT32,
            Type::integers(-2_147_483_648, 2_147_483_647),
        ),
        (TypeTable::UINT32, Type::integers(0, 4_294_967_295)),
        (TypeTable::STRING, Type::primitives(Primitives::STRING)),
        (TypeTable::SYMBOL, Type::primitives(Primitives::SYMBOL)),
        (TypeTable::BIGINT, Type::primitives(Primitives::BIG_INT)),
        (TypeTable::OBJECT, Type::any_object()),
        (TypeTable::FUNCTION, Type::any_function()),
        (TypeTable::ANYTHING, Type::anything()),
        (TypeTable::ABSENT, Type::primitives(Primitives::ABSENT)),
        (TypeTable::ARRAY, array_of(TypeTable::ANYTHING)),
        (
            TypeTable::ANYTHING_OR_ABSENT,
            Type {
                primitives: Type::anything().primitives | Primitives::ABSENT,
                ..Type::anything()
            },
        ),
    ]
}

#[test]
fn well_known_types_have_their_ids() {
    let mut table = TypeTable::new();
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT);
    for (index, (id, ty)) in well_known_types().into_iter().enumerate() {
        assert_eq!(id.index(), index);
        assert_eq!(*table.get(id), ty);
        assert_eq!(table.intern(ty), id);
    }
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT);
}

#[test]
fn two_tables_agree_on_well_known_ids() {
    let mut first = TypeTable::new();
    let mut second = TypeTable::default();
    assert_eq!(first.types(), second.types());
    first.intern(Type::layout(layout(1)));
    second.intern(Type::string_literal(string(1)));
    let count = TypeTable::WELL_KNOWN_COUNT;
    assert_eq!(first.types()[..count], second.types()[..count]);
    assert_ne!(first.types()[count], second.types()[count]);
}

#[test]
fn equal_types_have_one_id() {
    let mut table = TypeTable::new();
    let map = ClassPart {
        builtin_class: BuiltinClass::Map,
        contents: vec![TypeTable::STRING, TypeTable::NUMBER],
    };
    let array = ClassPart {
        builtin_class: BuiltinClass::Array,
        contents: vec![TypeTable::NUMBER],
    };
    let ascending = Type {
        strings: vec![string(1), string(2)],
        layouts: vec![layout(3), layout(4)],
        classes: vec![array.clone(), map.clone()],
        builtins: vec![builtin(5), builtin(6)],
        ..Type::default()
    };
    let descending_with_repeats = Type {
        strings: vec![string(2), string(1), string(2)],
        layouts: vec![layout(4), layout(4), layout(3)],
        classes: vec![map, array.clone(), array],
        builtins: vec![builtin(6), builtin(5), builtin(5)],
        ..Type::default()
    };
    let id = table.intern(ascending.clone());
    assert_eq!(table.intern(descending_with_repeats), id);
    assert_eq!(*table.get(id), ascending);
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT + 1);
}

#[test]
fn different_types_have_different_ids() {
    let mut table = TypeTable::new();
    let types = [
        Type::layout(layout(1)),
        Type::layout(layout(2)),
        Type::environment(layout(1)),
        Type::string_literal(string(1)),
        Type::integers(1, 1),
        Type::integers(1, 2),
        Type::builtin(builtin(1)),
        Type::opaque(OpaqueKind::IteratorState),
        Type::opaque(OpaqueKind::Enumerator),
        array_of(TypeTable::NUMBER),
    ];
    for (index, ty) in types.into_iter().enumerate() {
        assert_eq!(
            table.intern(ty).index(),
            TypeTable::WELL_KNOWN_COUNT + index
        );
    }
}

#[test]
fn constructors_set_one_part() {
    let none = Type::default;
    assert_eq!(Type::never(), none());
    let expected = Type {
        primitives: Primitives::STRING,
        ..none()
    };
    assert_eq!(Type::primitives(Primitives::STRING), expected);
    let expected = Type {
        flags: TypeFlags::HAS_INTEGERS,
        minimum: -1,
        maximum: 5,
        ..none()
    };
    assert_eq!(Type::integers(-1, 5), expected);
    let expected = Type {
        strings: vec![string(7)],
        ..none()
    };
    assert_eq!(Type::string_literal(string(7)), expected);
    let expected = Type {
        layouts: vec![layout(7)],
        ..none()
    };
    assert_eq!(Type::layout(layout(7)), expected);
    let expected = Type {
        builtins: vec![builtin(7)],
        ..none()
    };
    assert_eq!(Type::builtin(builtin(7)), expected);
    let expected = Type {
        flags: TypeFlags::ANY_FUNCTION,
        ..none()
    };
    assert_eq!(Type::any_function(), expected);
    let expected = Type {
        environment: Some(layout(7)),
        ..none()
    };
    assert_eq!(Type::environment(layout(7)), expected);
    let expected = Type {
        opaque: Some(OpaqueKind::ClassToken),
        ..none()
    };
    assert_eq!(Type::opaque(OpaqueKind::ClassToken), expected);
}

#[test]
fn class_type_has_one_class_part() {
    let contents = [TypeTable::STRING, TypeTable::NUMBER];
    let part = ClassPart {
        builtin_class: BuiltinClass::Map,
        contents: contents.to_vec(),
    };
    let expected = Type {
        classes: vec![part],
        ..Type::default()
    };
    assert_eq!(Type::class(BuiltinClass::Map, &contents), expected);
}

#[test]
fn object_includes_functions() {
    let any_function = TypeFlags::ANY_FUNCTION;
    assert_eq!(
        Type::any_object().flags,
        TypeFlags::ANY_OBJECT | any_function
    );
    assert_eq!(Type::any_function().flags, any_function);
    let object_bit_alone = Type {
        flags: TypeFlags::ANY_OBJECT,
        ..Type::default()
    };
    assert_eq!(TypeTable::new().intern(object_bit_alone), TypeTable::OBJECT);
}

#[test]
fn anything_excludes_absent() {
    let anything = Type::anything();
    assert!(!anything.primitives.contains(Primitives::ABSENT));
    assert_eq!(anything.primitives | Primitives::ABSENT, Primitives::ALL);
    assert_eq!(anything.flags, TypeFlags::ANY_OBJECT_OR_FUNCTION);

    let mut table = TypeTable::new();
    let with_absent = table.union(TypeTable::ANYTHING, TypeTable::ABSENT);
    assert_ne!(with_absent, TypeTable::ANYTHING);
    assert!(table.get(with_absent).is_anything());
    assert!(
        table
            .get(with_absent)
            .primitives
            .contains(Primitives::ABSENT)
    );
}

#[test]
fn is_anything_needs_every_primitive_and_every_object() {
    assert!(Type::anything().is_anything());
    assert!(!Type::any_object().is_anything());
    assert!(!Type::primitives(Primitives::OBSERVABLE).is_anything());
    let primitives_and_functions = Type {
        primitives: Primitives::OBSERVABLE,
        flags: TypeFlags::ANY_FUNCTION,
        ..Type::default()
    };
    assert!(!primitives_and_functions.is_anything());
    let without_symbol = Type {
        primitives: Primitives::OBSERVABLE.without(Primitives::SYMBOL),
        ..Type::anything()
    };
    assert!(!without_symbol.is_anything());
}

#[test]
fn is_never_has_no_part() {
    assert!(Type::never().is_never());
    for (id, ty) in well_known_types() {
        assert_eq!(ty.is_never(), id == TypeTable::NEVER);
    }
    assert!(!Type::environment(layout(0)).is_never());
    assert!(!Type::opaque(OpaqueKind::IteratorState).is_never());
}

#[test]
fn integer_range_needs_flag() {
    assert_eq!(Type::integers(-3, 4).integer_range(), Some((-3, 4)));
    assert_eq!(Type::integers(0, 0).integer_range(), Some((0, 0)));
    assert_eq!(Type::primitives(Primitives::NUMBER).integer_range(), None);
    assert_eq!(Type::never().integer_range(), None);
}

#[test]
fn environments_and_opaque_kinds_are_internal() {
    assert!(Type::environment(layout(0)).is_internal());
    for kind in OpaqueKind::ALL {
        assert!(Type::opaque(kind).is_internal());
    }
    for (_, ty) in well_known_types() {
        assert!(!ty.is_internal());
    }
    assert!(!Type::layout(layout(0)).is_internal());
}

#[test]
fn ids_survive_index_growth() {
    const LAYOUT_COUNT: usize = 5000;
    let mut table = TypeTable::new();
    for _ in 0..2 {
        for index in 0..LAYOUT_COUNT {
            let id = table.intern(Type::layout(layout(index)));
            assert_eq!(id.index(), TypeTable::WELL_KNOWN_COUNT + index);
        }
    }
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT + LAYOUT_COUNT);
    assert_eq!(table.intern(Type::anything()), TypeTable::ANYTHING);
}

#[test]
fn union_all_of_nothing_is_never() {
    let mut table = TypeTable::new();
    assert_eq!(table.union_all([]), TypeTable::NEVER);
    assert_eq!(
        table.union_all([TypeTable::NEVER, TypeTable::NEVER]),
        TypeTable::NEVER
    );
    assert_eq!(table.union_all([TypeTable::NUMBER]), TypeTable::NUMBER);
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT);
}

#[test]
fn union_with_itself_and_never() {
    let mut table = TypeTable::new();
    let environment = table.intern(Type::environment(layout(0)));
    for ty in [
        TypeTable::NUMBER,
        TypeTable::ANYTHING,
        TypeTable::ARRAY,
        environment,
    ] {
        assert_eq!(table.union(ty, ty), ty);
        assert_eq!(table.union(ty, TypeTable::NEVER), ty);
        assert_eq!(table.union(TypeTable::NEVER, ty), ty);
    }
}

#[test]
fn union_is_commutative_and_idempotent() {
    let mut table = TypeTable::new();
    let types = [
        TypeTable::UNDEFINED,
        TypeTable::BOOLEAN,
        TypeTable::NUMBER,
        TypeTable::INT32,
        TypeTable::UINT32,
        TypeTable::STRING,
        TypeTable::OBJECT,
        TypeTable::FUNCTION,
        TypeTable::ARRAY,
        table.intern(Type::layout(layout(1))),
        table.intern(Type::string_literal(string(1))),
    ];
    for left in types {
        for right in types {
            let union = table.union(left, right);
            assert_eq!(table.union(right, left), union);
            assert_eq!(table.union(left, union), union);
            assert_eq!(table.union(union, right), union);
        }
    }
}

#[test]
fn union_keeps_every_layout() {
    const LAYOUT_COUNT: usize = 300;
    let mut table = TypeTable::new();
    let members: Vec<TypeId> = (0..LAYOUT_COUNT)
        .rev()
        .map(|index| table.intern(Type::layout(layout(index))))
        .collect();
    let union = table.union_all(members);
    let expected: Vec<LayoutId> = (0..LAYOUT_COUNT).map(layout).collect();
    assert_eq!(table.get(union).layouts, expected);
    assert!(table.get(union).flags.is_empty());
}

#[test]
fn wider_bit_absorbs_its_part_only() {
    let mut table = TypeTable::new();
    let literal = table.intern(Type::string_literal(string(1)));
    let object = table.intern(Type::layout(layout(1)));
    let range = table.intern(Type::integers(0, 1));
    let numbers = table.intern(array_of(TypeTable::NUMBER));

    let union = table.union_all([literal, TypeTable::STRING, object]);
    let expected = Type {
        primitives: Primitives::STRING,
        layouts: vec![layout(1)],
        ..Type::default()
    };
    assert_eq!(*table.get(union), expected);

    let union = table.union_all([range, TypeTable::NUMBER, literal]);
    let expected = Type {
        primitives: Primitives::NUMBER,
        strings: vec![string(1)],
        ..Type::default()
    };
    assert_eq!(*table.get(union), expected);

    let union = table.union_all([object, numbers, TypeTable::OBJECT, literal]);
    let expected = Type {
        flags: TypeFlags::ANY_OBJECT_OR_FUNCTION,
        strings: vec![string(1)],
        ..Type::default()
    };
    assert_eq!(*table.get(union), expected);
}

#[test]
fn union_of_ranges_is_hull() {
    let mut table = TypeTable::new();
    let low = table.intern(Type::integers(0, 1));
    let high = table.intern(Type::integers(5, 6));
    let union = table.union(low, high);
    assert_eq!(*table.get(union), Type::integers(0, 6));
    let with_string = table.union(low, TypeTable::STRING);
    assert_eq!(table.get(with_string).integer_range(), Some((0, 1)));
}

#[test]
fn range_outside_tracked_integers_becomes_number() {
    let mut table = TypeTable::new();
    let widest = Type::integers(-MAX_TRACKED_INTEGER, MAX_TRACKED_INTEGER);
    let widest_id = table.intern(widest.clone());
    assert_eq!(*table.get(widest_id), widest);

    for (minimum, maximum) in [(0, MAX_TRACKED_INTEGER + 1), (-MAX_TRACKED_INTEGER - 1, 0)] {
        let untracked = Type {
            layouts: vec![layout(1)],
            ..Type::integers(minimum, maximum)
        };
        let expected = Type {
            primitives: Primitives::NUMBER,
            layouts: vec![layout(1)],
            ..Type::default()
        };
        let id = table.intern(untracked);
        assert_eq!(*table.get(id), expected);
    }
}

#[test]
fn empty_range_is_no_part() {
    let empty = Type {
        flags: TypeFlags::HAS_INTEGERS,
        minimum: 1,
        maximum: 0,
        ..Type::default()
    };
    assert_eq!(TypeTable::new().intern(empty), TypeTable::NEVER);
}

#[test]
fn bounds_without_flag_are_cleared() {
    let stray_bounds = Type {
        minimum: 1,
        maximum: 2,
        ..Type::primitives(Primitives::STRING)
    };
    assert_eq!(TypeTable::new().intern(stray_bounds), TypeTable::STRING);
}

#[test]
fn one_class_merges_contents() {
    let mut table = TypeTable::new();
    let numbers = table.intern(array_of(TypeTable::NUMBER));
    let strings = table.intern(array_of(TypeTable::STRING));
    let contents = [TypeTable::STRING, TypeTable::NUMBER];
    let map = table.intern(Type::class(BuiltinClass::Map, &contents));

    let arrays = table.union(numbers, strings);
    let number_or_string = table.union(TypeTable::NUMBER, TypeTable::STRING);
    assert_eq!(*table.get(arrays), array_of(number_or_string));

    let array_or_map = table.union(map, numbers);
    let classes = table.get(array_or_map).classes.iter();
    let classes: Vec<BuiltinClass> = classes.map(|part| part.builtin_class).collect();
    assert_eq!(classes, [BuiltinClass::Array, BuiltinClass::Map]);
}

#[test]
fn parts_are_interned_before_wholes() {
    let mut table = TypeTable::new();
    let numbers = table.intern(array_of(TypeTable::NUMBER));
    let strings = table.intern(array_of(TypeTable::STRING));
    table.union(numbers, strings);
    for (index, ty) in table.types().iter().enumerate() {
        let contents = ty.classes.iter().flat_map(|part| &part.contents);
        for content in contents {
            assert!(content.index() < index);
        }
    }
}

#[test]
fn function_beside_other_parts_stays() {
    let mut table = TypeTable::new();
    let function = TypeTable::FUNCTION;
    let object = table.intern(Type::layout(layout(1)));
    let union = table.union_all([function, object, TypeTable::NUMBER, function]);
    let expected = Type {
        primitives: Primitives::NUMBER,
        flags: TypeFlags::ANY_FUNCTION,
        layouts: vec![layout(1)],
        ..Type::default()
    };
    assert_eq!(*table.get(union), expected);
    assert_eq!(table.union(function, TypeTable::OBJECT), TypeTable::OBJECT);
}

#[test]
fn with_nullish_is_idempotent() {
    let mut table = TypeTable::new();
    let nullable = table.with_nullish(TypeTable::NUMBER);
    let expected = Primitives::NUMBER | Primitives::NULLISH;
    assert_eq!(*table.get(nullable), Type::primitives(expected));
    assert_eq!(table.with_nullish(nullable), nullable);
    assert_eq!(table.with_nullish(TypeTable::NEVER), TypeTable::NULLISH);
    assert_eq!(table.with_nullish(TypeTable::UNDEFINED), TypeTable::NULLISH);
    assert_eq!(table.with_nullish(TypeTable::ANYTHING), TypeTable::ANYTHING);
}

#[test]
fn removing_primitives_removes_matching_parts() {
    let mut table = TypeTable::new();
    let literal = table.intern(Type::string_literal(string(1)));
    let range_or_string = table.union(TypeTable::INT32, TypeTable::STRING);
    let literal_or_number = table.union(literal, TypeTable::NUMBER);

    let without_number = table.without_primitives(range_or_string, Primitives::NUMBER);
    assert_eq!(without_number, TypeTable::STRING);
    let without_string = table.without_primitives(literal_or_number, Primitives::STRING);
    assert_eq!(without_string, TypeTable::NUMBER);
    let without_null = table.without_primitives(TypeTable::NULLISH, Primitives::NULL);
    assert_eq!(without_null, TypeTable::UNDEFINED);
    let without_true = table.without_primitives(TypeTable::BOOLEAN, Primitives::TRUE);
    assert_eq!(
        *table.get(without_true),
        Type::primitives(Primitives::FALSE)
    );
    let without_boolean = table.without_primitives(TypeTable::BOOLEAN, Primitives::BOOLEAN);
    assert_eq!(without_boolean, TypeTable::NEVER);
}

#[test]
fn removing_primitives_keeps_other_parts() {
    let mut table = TypeTable::new();
    let environment = table.intern(Type::environment(layout(0)));
    for ty in [
        TypeTable::OBJECT,
        TypeTable::FUNCTION,
        TypeTable::ARRAY,
        environment,
    ] {
        assert_eq!(table.without_primitives(ty, Primitives::ALL), ty);
    }
    assert_eq!(
        table.without_primitives(TypeTable::INT32, Primitives::STRING),
        TypeTable::INT32
    );
    let objects = table.without_primitives(TypeTable::ANYTHING, Primitives::ALL);
    assert_eq!(objects, TypeTable::OBJECT);
}

#[test]
#[cfg(debug_assertions)]
#[should_panic(expected = "an opaque or environment type is never part of a union")]
fn internal_type_in_union_panics() {
    let mut table = TypeTable::new();
    let environment = table.intern(Type::environment(layout(0)));
    table.union(environment, TypeTable::NUMBER);
}

#[test]
fn tables_that_share_types_number_them_like_a_table_of_its_own() {
    let written = [
        Type::layout(layout(3)),
        Type::string_literal(string(2)),
        Type::layout(layout(1)),
        Type::integers(1, 5),
        Type::layout(layout(3)),
    ];
    let mut own = TypeTable::new();
    let [mut first, mut second] = [(); 2].map(|()| TypeTable::new());
    first.share_types();
    second.share_types();
    assert_eq!(first.len(), TypeTable::WELL_KNOWN_COUNT);
    for ty in &written {
        let id = own.intern(ty.clone());
        assert_eq!(first.intern(ty.clone()), id);
    }
    for ty in written.iter().rev() {
        second.intern(ty.clone());
    }
    let numbered = |position: usize| TypeId::new(TypeTable::WELL_KNOWN_COUNT + position);
    let union = own.union(numbered(0), numbered(2));
    assert_eq!(first.union(numbered(0), numbered(2)), union);
    first.release_spare_capacity();
    assert_eq!(first.len(), own.len());
    assert!(first.iter().eq(own.iter()));
    assert_eq!(first.types(), own.types());
    assert_eq!(*second.get(numbered(0)), Type::layout(layout(3)));
    assert_eq!(*second.get(numbered(1)), Type::integers(1, 5));
    assert!(core::ptr::eq(
        first.get(numbered(0)),
        second.get(numbered(0))
    ));
    assert!(core::ptr::eq(
        first.get(TypeTable::ARRAY),
        second.get(TypeTable::ARRAY)
    ));
}

#[test]
fn releasing_spare_capacity_keeps_the_elements() {
    let mut list = Vec::with_capacity(100);
    list.extend([1, 2, 3]);
    crate::ir::types::release_spare_capacity(&mut list);
    assert_eq!(list, [1, 2, 3]);
    assert_eq!(list.capacity(), 3);
}

#[test]
fn table_that_shares_its_types_when_it_is_complete_stays_the_same() {
    let mut own = TypeTable::new();
    let mut shared = TypeTable::new();
    for table in [&mut own, &mut shared] {
        let first = table.intern(Type::layout(layout(3)));
        let second = table.intern(Type::string_literal(string(2)));
        table.union(first, second);
        table.intern(array_of(first));
    }
    shared.share_types();
    shared.share_types();
    assert!(shared.iter().eq(own.iter()));
    assert_eq!(
        shared.intern(Type::layout(layout(3))),
        own.intern(Type::layout(layout(3)))
    );
    assert_eq!(
        shared.intern(Type::layout(layout(9))),
        own.intern(Type::layout(layout(9)))
    );
    assert_eq!(shared.len(), own.len());
}
