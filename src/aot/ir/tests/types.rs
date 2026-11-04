use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::ir::generated::MAX_TRACKED_INTEGER;
use crate::ir::ids::{Id, LayoutId, TypeId};
use crate::ir::parallel::{InParallel, run_serially};
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
    assert_eq!(Type::value_of_builtin(builtin(7)), Some(expected));
    assert_eq!(
        Type::value_of_builtin(BuiltinId::SymbolIterator),
        Some(Type::primitives(Primitives::SYMBOL))
    );
    assert_eq!(Type::value_of_builtin(BuiltinId::MathPI), None);
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
fn table_of_distinct_types_finds_each_type() {
    let mut interned = TypeTable::new();
    let object = interned.intern(Type::layout(layout(3)));
    let literal = interned.intern(Type::string_literal(string(2)));
    interned.union(object, literal);
    interned.intern(array_of(object));
    interned.intern(Type::environment(layout(3)));
    // More than one task hashes them.
    for maximum in 1..10_000 {
        interned.intern(Type::integers(0, maximum));
    }

    let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| {
        (0..count).rev().for_each(work);
    };
    let ways: [InParallel<'_>; 2] = [&run_serially, &in_reverse];
    for in_parallel in ways {
        let mut table = TypeTable::of_distinct_types(interned.types().to_vec(), in_parallel);
        assert_eq!(table.types(), interned.types());
        for (index, ty) in interned.types().iter().enumerate() {
            assert_eq!(table.intern(ty.clone()).index(), index);
        }
        assert_eq!(table.len(), interned.len());
    }
}

#[test]
fn table_that_was_cut_back_and_grows_again_finds_each_type() {
    fn intern_literals(table: &mut TypeTable, count: i64) -> Vec<TypeId> {
        let literals = (0..count).map(|value| table.intern(Type::integers(value, value)));
        literals.collect()
    }
    let mut table = TypeTable::new();
    let first = intern_literals(&mut table, 1_000);
    table.truncate(TypeTable::WELL_KNOWN_COUNT + 500);
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT + 500);
    let second = intern_literals(&mut table, 5_000);
    assert_eq!(second[..1_000], first[..]);
    assert_eq!(table.len(), TypeTable::WELL_KNOWN_COUNT + 5_000);
    assert_eq!(intern_literals(&mut table, 5_000), second);
}

#[test]
fn union_adds_to_table_of_distinct_types() {
    let mut interned = TypeTable::new();
    let [circle, square] = [3, 1].map(|index| interned.intern(Type::layout(layout(index))));
    let literal = interned.intern(Type::string_literal(string(2)));
    let circle_or_literal = interned.union(circle, literal);
    let [circles, squares] = [circle, square].map(|shape| interned.intern(array_of(shape)));
    let count = interned.len();

    let mut table = TypeTable::of_distinct_types(interned.types().to_vec(), &run_serially);
    assert_eq!(table.union(literal, circle), circle_or_literal);
    assert_eq!(table.union(circle, TypeTable::OBJECT), TypeTable::OBJECT);
    assert_eq!(table.with_nullish(TypeTable::NULL), TypeTable::NULLISH);
    assert_eq!(table.len(), count);

    let shapes = table.union(circles, squares);
    let shape = table.union(square, circle);
    assert_eq!([shape.index(), shapes.index()], [count, count + 1]);
    let expected = Type {
        layouts: vec![layout(1), layout(3)],
        ..Type::default()
    };
    assert_eq!(*table.get(shape), expected);
    assert_eq!(*table.get(shapes), array_of(shape));

    assert_eq!(interned.union(circles, squares), shapes);
    assert_eq!(table.types(), interned.types());
}

#[test]
#[cfg(debug_assertions)]
#[should_panic]
fn table_of_distinct_types_needs_well_known_types_at_their_ids() {
    let mut types = TypeTable::new().types().to_vec();
    types.swap(TypeTable::NUMBER.index(), TypeTable::STRING.index());
    TypeTable::of_distinct_types(types, &run_serially);
}

#[test]
fn truncating_keeps_earlier_ids_and_frees_later_ones() {
    let mut table = TypeTable::new();
    let kept = table.intern(Type::layout(layout(1)));
    let length = table.len();
    let cut = table.intern(Type::layout(layout(2)));
    let cut_union = table.union(kept, cut);
    assert_eq!([cut.index(), cut_union.index()], [length, length + 1]);

    table.truncate(length);
    assert_eq!(table.len(), length);
    assert_eq!(table.intern(Type::layout(layout(1))), kept);
    assert_eq!(table.intern(Type::anything()), TypeTable::ANYTHING);
    assert_eq!(table.len(), length);

    let both = Type {
        layouts: vec![layout(1), layout(2)],
        ..Type::default()
    };
    assert_eq!(table.intern(both.clone()).index(), length);
    assert_eq!(table.intern(Type::layout(layout(2))).index(), length + 1);
    assert_eq!(table.types()[length..], [both, Type::layout(layout(2))]);
}
