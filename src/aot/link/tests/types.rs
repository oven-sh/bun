use crate::builtins::BuiltinClass;
use crate::ir::{
    Id, InParallel, LayoutId, LayoutKey, Reference, StringId, Type, TypeId, TypeTable,
};
use crate::link::state::{MergedTypes, UnitIds, UnitMarks};
use crate::link::testing::{
    Projects, application_file, finish_unit, forward, mark_everything, number_everything, reverse,
    test_class_key, with_test_files,
};
use crate::link::type_hashes::ContentHash;
use crate::link::types::{TypeTableInput, build_type_table, merge_types, order_types_by_contents};
use crate::link::unit::ShardIndex;
use crate::link::{LinkError, LinkUnit};
use crate::load::ProgramFile;
use crate::lower::FragmentBuilder;
use bun_sema::program::FileId;

const DOG: usize = 0;
const DOG_ARRAY: usize = 6;
const PROMISE: usize = 9;
const TEST_TYPE_COUNT: usize = 10;
const MERGED_TYPE_COUNT: usize = TypeTable::WELL_KNOWN_COUNT + TEST_TYPE_COUNT;

fn dog_key() -> LayoutKey {
    test_class_key(9, 0)
}

fn animal_key() -> LayoutKey {
    test_class_key(9, 1)
}

fn environment_key() -> LayoutKey {
    LayoutKey::Environment {
        file: FileId(9),
        environment: 0,
    }
}

fn layout_set(layouts: [LayoutId; 2]) -> Type {
    Type {
        layouts: layouts.to_vec(),
        ..Type::default()
    }
}

fn literal_set(strings: [StringId; 2]) -> Type {
    Type {
        strings: strings.to_vec(),
        ..Type::default()
    }
}

fn set_type_hash(unit: &mut LinkUnit, id: TypeId, hash: ContentHash) {
    unit.type_hashes.types[id.index()] = hash;
    let hashes = unit.type_hashes.types.iter();
    unit.type_shards = ShardIndex::new(hashes.map(|hash| hash.0[0]));
}

fn create_layout_unit(
    projects: &Projects<'_, '_>,
    file: u32,
    key: LayoutKey,
) -> (LinkUnit, TypeId) {
    let mut fragment = FragmentBuilder::new(FileId(file));
    let layout = fragment.declare_layout(key);
    let ty = fragment.types.intern(Type::layout(layout));
    (finish_unit(projects, fragment), ty)
}

fn intern_types(
    fragment: &mut FragmentBuilder,
    mut types: Vec<Type>,
    is_reversed: bool,
) -> Vec<TypeId> {
    if is_reversed {
        types.reverse();
    }
    let types = types.into_iter();
    let mut ids: Vec<TypeId> = types.map(|ty| fragment.types.intern(ty)).collect();
    if is_reversed {
        ids.reverse();
    }
    ids
}

struct TypedUnit {
    unit: LinkUnit,
    types: Vec<TypeId>,
}

fn create_unit(projects: &Projects<'_, '_>, file: u32, is_reversed: bool) -> TypedUnit {
    let mut fragment = FragmentBuilder::new(FileId(file));
    let keys = [dog_key(), animal_key(), environment_key()];
    let texts: [&[u8]; 2] = [b"x", b"y"];
    if is_reversed {
        for &key in keys.iter().rev() {
            fragment.declare_layout(key);
        }
        for text in texts.iter().rev() {
            fragment.strings.intern(text);
        }
    }
    let [dog, animal, environment] = keys.map(|key| fragment.declare_layout(key));
    let literals = texts.map(|text| fragment.strings.intern(text));
    let leaf_types = vec![
        Type::layout(dog),
        Type::layout(animal),
        layout_set([dog, animal]),
        literal_set(literals),
        Type::environment(environment),
        Type::integers(0, 9),
    ];
    let leaves = intern_types(&mut fragment, leaf_types, is_reversed);
    let array_types = vec![
        Type::class(BuiltinClass::Array, &[leaves[0]]),
        Type::class(BuiltinClass::Array, &[leaves[1]]),
    ];
    let arrays = intern_types(&mut fragment, array_types, is_reversed);
    let parent_types = vec![
        Type::class(BuiltinClass::Map, &[leaves[3], arrays[0]]),
        Type::class(BuiltinClass::Promise, &[arrays[1]]),
    ];
    let parents = intern_types(&mut fragment, parent_types, is_reversed);
    let types = [leaves, arrays, parents].concat();
    assert_eq!(types.len(), TEST_TYPE_COUNT);
    TypedUnit {
        unit: finish_unit(projects, fragment),
        types,
    }
}

struct Merged {
    ids: Vec<UnitIds>,
    type_representatives: Vec<(u32, TypeId)>,
    table: Result<TypeTable, LinkError>,
}

impl Merged {
    fn program_id(&self, unit: usize, local: TypeId) -> Option<TypeId> {
        self.ids[unit].types[local.index()]
    }

    fn table(&self) -> &TypeTable {
        self.table.as_ref().expect("the type tables merge")
    }
}

fn merge(
    units: &[LinkUnit],
    unmarked_types: &[(usize, TypeId)],
    in_parallel: InParallel<'_>,
) -> Merged {
    let mut ids = number_everything(units);
    let mut marks: Vec<UnitMarks> = units.iter().map(mark_everything).collect();
    for &(unit, local) in unmarked_types {
        marks[unit].types[local.index()] = false;
    }
    let MergedTypes {
        types,
        mut type_representatives,
    } = merge_types(units, &marks, in_parallel);
    for (unit_ids, types) in ids.iter_mut().zip(types) {
        unit_ids.types = types;
    }
    order_types_by_contents(units, &mut ids, &mut type_representatives, in_parallel);
    let table = build_type_table(&TypeTableInput {
        units,
        type_representatives: &type_representatives,
        ids: &ids,
        marks: &marks,
        in_parallel,
    });
    Merged {
        ids,
        type_representatives,
        table,
    }
}

fn collision_files(merged: Merged) -> [ProgramFile; 2] {
    match merged.table {
        Err(LinkError::TypeHashCollision { files }) => files,
        Err(other) => panic!("{other:?}"),
        Ok(_) => panic!("the type tables were merged"),
    }
}

fn assert_children_precede_parents(table: &TypeTable) {
    for (index, ty) in table.types().iter().enumerate() {
        let parent = TypeId::new(index);
        ty.for_each_reference(&mut |reference| {
            if let Reference::Type(child) = reference {
                assert!(child < parent, "{parent} names {child}");
            }
        });
    }
}

#[test]
fn equal_types_merge_to_one_program_type() {
    with_test_files(|projects, _| {
        let first = create_unit(projects, 0, false);
        let second = create_unit(projects, 1, true);
        assert_ne!(first.types, second.types);
        let merged = merge(&[first.unit, second.unit], &[], &forward);

        for (&first_type, &second_type) in first.types.iter().zip(&second.types) {
            let program_id = merged.program_id(0, first_type);
            assert!(program_id.is_some());
            assert_eq!(merged.program_id(1, second_type), program_id);
        }
        let representatives = &merged.type_representatives;
        assert_eq!(representatives.len(), MERGED_TYPE_COUNT);
        assert!(representatives.iter().all(|&(unit, _)| unit == 0));

        let table = merged.table();
        assert_eq!(table.len(), MERGED_TYPE_COUNT);
        assert_children_precede_parents(table);
        let dog = merged.program_id(0, first.types[DOG]);
        let dog = dog.expect("every type is marked");
        let dog_array = merged.program_id(0, first.types[DOG_ARRAY]);
        let dog_array = dog_array.expect("every type is marked");
        let expected_type = Type::class(BuiltinClass::Array, &[dog]);
        assert_eq!(*table.get(dog_array), expected_type);
    });
}

#[test]
fn well_known_types_keep_ids() {
    with_test_files(|projects, _| {
        let units = [false, true]
            .map(|is_reversed| create_unit(projects, u32::from(is_reversed), is_reversed).unit);
        let merged = merge(&units, &[], &forward);
        for id in (0..TypeTable::WELL_KNOWN_COUNT).map(TypeId::new) {
            assert_eq!(merged.program_id(0, id), Some(id));
            assert_eq!(merged.program_id(1, id), Some(id));
        }
        let well_known_types = TypeTable::new();
        assert_eq!(
            merged.table().types()[..TypeTable::WELL_KNOWN_COUNT],
            *well_known_types.types()
        );
    });
}

#[test]
fn parent_names_representative_in_earlier_unit() {
    with_test_files(|projects, _| {
        let (first, first_dog) = create_layout_unit(projects, 0, dog_key());
        let mut second = FragmentBuilder::new(FileId(1));
        let animal = second.declare_layout(animal_key());
        second.types.intern(Type::layout(animal));
        let dog = second.declare_layout(dog_key());
        let second_dog = second.types.intern(Type::layout(dog));
        let array_type = Type::class(BuiltinClass::Array, &[second_dog]);
        let dog_array = second.types.intern(array_type);
        assert_ne!(first_dog, second_dog);
        let merged = merge(&[first, finish_unit(projects, second)], &[], &forward);

        let representatives = &merged.type_representatives;
        let program_dog = merged.program_id(0, first_dog);
        assert_eq!(merged.program_id(1, second_dog), program_dog);
        let program_dog = program_dog.expect("every type is marked");
        assert_eq!(representatives[program_dog.index()], (0, first_dog));
        let program_array = merged.program_id(1, dog_array);
        let program_array = program_array.expect("every type is marked");
        assert_eq!(representatives[program_array.index()], (1, dog_array));

        let table = merged.table();
        let expected_type = Type::class(BuiltinClass::Array, &[program_dog]);
        assert_eq!(*table.get(program_array), expected_type);
        assert_children_precede_parents(table);
    });
}

#[test]
fn unmarked_type_is_dropped() {
    with_test_files(|projects, _| {
        let TypedUnit { unit, types } = create_unit(projects, 0, false);
        let promise = types[PROMISE];
        let merged = merge(&[unit], &[(0, promise)], &forward);

        for &ty in &types {
            assert_eq!(merged.program_id(0, ty).is_some(), ty != promise);
        }
        assert!(!merged.type_representatives.contains(&(0, promise)));
        let table = merged.table();
        assert_eq!(table.len(), MERGED_TYPE_COUNT - 1);
        let mut parts = table.types().iter().flat_map(|ty| &ty.classes);
        assert!(parts.all(|part| part.builtin_class != BuiltinClass::Promise));
    });
}

#[test]
fn representative_is_first_marked_occurrence() {
    with_test_files(|projects, _| {
        let first = create_unit(projects, 0, false);
        let second = create_unit(projects, 1, true);
        let unmarked_types = [(0, first.types[PROMISE])];
        let merged = merge(&[first.unit, second.unit], &unmarked_types, &forward);

        assert_eq!(merged.program_id(0, first.types[PROMISE]), None);
        let promise = merged.program_id(1, second.types[PROMISE]);
        let promise = promise.expect("the second occurrence is marked");
        assert_eq!(promise.index(), MERGED_TYPE_COUNT - 1);
        let representative = merged.type_representatives[promise.index()];
        assert_eq!(representative, (1, second.types[PROMISE]));
        let table = merged.table();
        assert_eq!(table.len(), MERGED_TYPE_COUNT);
        assert_children_precede_parents(table);
    });
}

#[test]
fn different_types_with_one_hash_are_reported() {
    with_test_files(|projects, _| {
        let keys = [(3, dog_key()), (5, animal_key()), (8, environment_key())];
        let units = keys.map(|(file, key)| {
            let (mut unit, ty) = create_layout_unit(projects, file, key);
            set_type_hash(&mut unit, ty, ContentHash([1, 2]));
            unit
        });
        let expected_files = [3, 5].map(|file| application_file(FileId(file)));
        for in_parallel in [&forward as InParallel<'_>, &reverse] {
            let merged = merge(&units, &[], in_parallel);
            assert_eq!(collision_files(merged), expected_files);
        }
    });
}

#[test]
fn one_type_with_two_hashes_is_reported() {
    with_test_files(|projects, _| {
        let (first, _) = create_layout_unit(projects, 3, dog_key());
        let (mut second, dog) = create_layout_unit(projects, 5, dog_key());
        set_type_hash(&mut second, dog, ContentHash([1, 2]));
        let merged = merge(&[first, second], &[], &forward);
        let expected_files = [3, 5].map(|file| application_file(FileId(file)));
        assert_eq!(collision_files(merged), expected_files);
    });
}

#[test]
fn missing_well_known_type_is_reported() {
    with_test_files(|projects, _| {
        let (unit, _) = create_layout_unit(projects, 3, dog_key());
        let merged = merge(&[unit], &[(0, TypeTable::NEVER)], &forward);
        assert_eq!(collision_files(merged), [application_file(FileId(3)); 2]);
    });
}

#[test]
fn task_order_does_not_change_table() {
    const LAYOUT_COUNT: u32 = 2000;
    with_test_files(|projects, _| {
        let mut fragments: Vec<FragmentBuilder> = (0..8)
            .map(|file| FragmentBuilder::new(FileId(file)))
            .collect();
        for class in 0..LAYOUT_COUNT {
            for file in [class % 8, class / 5 % 8] {
                let fragment = &mut fragments[file as usize];
                let layout = fragment.declare_layout(test_class_key(9, class));
                let element = fragment.types.intern(Type::layout(layout));
                let array = Type::class(BuiltinClass::Array, &[element]);
                fragment.types.intern(array);
            }
        }
        let units: Vec<LinkUnit> = fragments
            .into_iter()
            .map(|fragment| finish_unit(projects, fragment))
            .collect();

        let in_order = merge(&units, &[], &forward);
        let in_reverse = merge(&units, &[], &reverse);
        assert_eq!(
            in_order.type_representatives,
            in_reverse.type_representatives
        );
        for (ids, reverse_ids) in in_order.ids.iter().zip(&in_reverse.ids) {
            assert_eq!(ids.types, reverse_ids.types);
        }
        let type_count = TypeTable::WELL_KNOWN_COUNT + 2 * LAYOUT_COUNT as usize;
        assert_eq!(in_order.table().len(), type_count);
        assert_eq!(in_order.table().types(), in_reverse.table().types());
        assert_children_precede_parents(in_order.table());
    });
}

#[test]
fn order_in_which_a_file_met_its_types_does_not_change_table() {
    with_test_files(|projects, _| {
        let merge_met_in_order = |classes: [usize; 3]| {
            let mut fragment = FragmentBuilder::new(FileId(0));
            let layouts = [0, 1, 2].map(|class| fragment.declare_layout(test_class_key(9, class)));
            for class in classes {
                let element = fragment.types.intern(Type::layout(layouts[class]));
                let array = fragment
                    .types
                    .intern(Type::class(BuiltinClass::Array, &[element]));
                fragment
                    .types
                    .intern(Type::class(BuiltinClass::Array, &[array]));
            }
            merge(&[finish_unit(projects, fragment)], &[], &forward)
        };
        let ascending = merge_met_in_order([0, 1, 2]);
        for classes in [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] {
            let merged = merge_met_in_order(classes);
            assert_eq!(
                merged.table().types(),
                ascending.table().types(),
                "{classes:?}"
            );
            assert_children_precede_parents(merged.table());
        }
    });
}

#[test]
fn no_units_merge_to_well_known_types() {
    let merged = merge(&[], &[], &forward);
    assert!(merged.ids.is_empty());
    assert!(merged.type_representatives.is_empty());
    assert_eq!(merged.table().len(), TypeTable::WELL_KNOWN_COUNT);
}
