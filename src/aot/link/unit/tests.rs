use super::*;
use crate::builtins::BuiltinId;
use crate::ir::generated::{FunctionReferenceKind, ImportPhase};
use crate::ir::testing::build_function;
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, ModuleFailureId as WireModuleFailureId, ModuleId,
    PropertyKeyId, StringId, Type, TypeId, TypeSiteId,
};
use crate::link::testing::{
    TestUnit, forward, key_in, reverse, test_class_key, test_function_key, test_variable_key,
    unit_in, with_test_files,
};
use crate::load::ProjectId;
use crate::lower::FragmentBuilder;
use crate::modules::ModuleRef;

fn assert_shards_match(index: &ShardIndex, hashes: &[u64]) {
    let mut occurrences = vec![0; hashes.len()];
    for shard in 0..SHARD_COUNT {
        let ids = index.shard(shard);
        assert!(ids.is_sorted_by(|a, b| a < b));
        for &id in ids {
            assert_eq!(shard_of(hashes[id as usize]), shard);
            occurrences[id as usize] += 1;
        }
    }
    assert!(occurrences.iter().all(|&count| count == 1));
}

fn finds_of_three_shards() -> [Vec<(u32, StringId)>; 3] {
    let find = |unit: u32, id: usize| (unit, StringId::new(id));
    [
        vec![find(0, 4), find(2, 1), find(2, 7)],
        Vec::new(),
        vec![find(0, 2), find(0, 9), find(2, 3), find(3, 0)],
    ]
}

#[test]
fn finds_of_one_unit_stand_in_a_row() {
    let shards = finds_of_three_shards();
    let lists: Vec<&[(u32, StringId)]> = shards.iter().map(|shard| &shard[..]).collect();
    let by_unit = FindsByUnit::new(5, &lists);
    let units: Vec<u32> = by_unit.finds.iter().map(|find| find.0).collect();
    assert_eq!(units, [0, 0, 0, 2, 2, 2, 3]);
    assert_eq!(by_unit.places.len(), shards.len());
    for (shard, places) in shards.iter().zip(&by_unit.places) {
        let found: Vec<(u32, StringId)> = (places.iter())
            .map(|&place| by_unit.finds[place as usize])
            .collect();
        assert_eq!(found, *shard);
    }
}

#[test]
fn rows_of_finds_are_ordered_by_key_whatever_the_task_order() {
    let shards = finds_of_three_shards();
    let lists: Vec<&[(u32, StringId)]> = shards.iter().map(|shard| &shard[..]).collect();
    let by_unit = FindsByUnit::new(5, &lists);
    let key = |_: u32, id: StringId| core::cmp::Reverse(id.index());
    let order = by_unit.order_rows_by(&forward, &key);
    assert_eq!(order, by_unit.order_rows_by(&reverse, &key));
    let ordered: Vec<(u32, usize)> = (order.iter())
        .map(|&place| by_unit.finds[place as usize])
        .map(|(unit, id)| (unit, id.index()))
        .collect();
    let expected = [(0, 9), (0, 4), (0, 2), (2, 7), (2, 3), (2, 1), (3, 0)];
    assert_eq!(ordered, expected);
    let numbers = by_unit.number_in(&order);
    for (number, &place) in order.iter().enumerate() {
        assert_eq!(numbers[place as usize].index(), number);
    }
}

#[test]
fn no_finds_make_no_rows() {
    let by_unit = FindsByUnit::<StringId>::new(3, &[&[], &[]]);
    assert!(by_unit.finds.is_empty());
    assert_eq!(by_unit.places, [Vec::<u32>::new(), Vec::new()]);
    assert!(by_unit.order_rows_by(&forward, &|_, id| id).is_empty());
}

fn list_references(functions: &[Function]) -> ReferenceLists {
    let definitions = (0..).zip(functions);
    let definitions: Vec<(FunctionId, Arc<Function>)> = definitions
        .map(|(index, function)| (FunctionId::new(index), Arc::new(function.clone())))
        .collect();
    ReferenceLists::new(&definitions)
}

fn collect_type_references(function: &Function) -> Vec<u32> {
    let mut types = Vec::new();
    function.for_each_reference(&mut |reference| {
        if let Reference::Type(id) = reference {
            types.push(id.to_word());
        }
    });
    types.sort_unstable();
    types.dedup();
    types
}

#[test]
fn shard_of_reads_bits_32_to_37() {
    assert_eq!(shard_of(u64::from(u32::MAX)), 0);
    assert_eq!(shard_of(5 << 32), 5);
    assert_eq!(shard_of((SHARD_COUNT as u64 - 1) << 32), SHARD_COUNT - 1);
    assert_eq!(shard_of((SHARD_COUNT as u64) << 32), 0);
}

#[test]
fn shard_index_groups_ids_by_shard() {
    let hashes: Vec<u64> = (0..1000u64)
        .map(|number| number.wrapping_mul(0x9E37_79B9_7F4A_7C15))
        .collect();
    let index = ShardIndex::new(hashes.iter().copied());
    assert_shards_match(&index, &hashes);
    assert!((0..SHARD_COUNT).all(|shard| !index.shard(shard).is_empty()));
}

#[test]
fn empty_shard_index_has_empty_shards() {
    let index = ShardIndex::new(core::iter::empty());
    assert!((0..SHARD_COUNT).all(|shard| index.shard(shard).is_empty()));
}

#[test]
fn key_list_hashes_every_key() {
    let keys = [
        test_function_key(0, 0),
        test_function_key(0, 1),
        test_function_key(7, 0),
    ];
    let list = KeyList::new(keys.to_vec());
    assert_eq!(list.keys, keys);
    assert_eq!(list.hashes, keys.map(|key| hash_key(&key)));
    assert_shards_match(&list.shards, &list.hashes);
}

#[test]
fn every_reference_has_its_kind() {
    let module = ModuleId::new(1);
    let function = FunctionId::new(1);
    let references = [
        (Reference::String(StringId::new(1)), LocalKind::String),
        (
            Reference::PropertyKey(PropertyKeyId::new(1)),
            LocalKind::PropertyKey,
        ),
        (Reference::Type(TypeId::new(1)), LocalKind::Type),
        (Reference::TypeSite(TypeSiteId::new(1)), LocalKind::TypeSite),
        (
            Reference::ExpectedResult(ExpectedResultId::new(1)),
            LocalKind::ExpectedResult,
        ),
        (Reference::Layout(LayoutId::new(1)), LocalKind::Layout),
        (Reference::Variable(VariableId::new(1)), LocalKind::Variable),
        (
            Reference::Module(module, ModuleReferenceKind::Target),
            LocalKind::ModuleTarget,
        ),
        (
            Reference::Module(module, ModuleReferenceKind::Referrer),
            LocalKind::ModuleReferrer,
        ),
        (
            Reference::ModuleFailure(WireModuleFailureId::new(1)),
            LocalKind::ModuleFailure,
        ),
        (
            Reference::EvalScope(EvalScopeId::new(1)),
            LocalKind::EvalScope,
        ),
        (
            Reference::Function(function, FunctionReferenceKind::Call),
            LocalKind::Function,
        ),
        (
            Reference::Function(function, FunctionReferenceKind::Closure),
            LocalKind::Function,
        ),
        (
            Reference::Function(function, FunctionReferenceKind::Constructor),
            LocalKind::Function,
        ),
        (Reference::Data(DataId::new(1)), LocalKind::Data),
    ];
    for (reference, kind) in references {
        let local = LocalReference { kind, index: 1 };
        assert_eq!(LocalReference::new(reference), Some(local), "{reference:?}");
    }
}

#[test]
fn function_references_are_sorted_and_unique() {
    let callees = [0, 1].map(FunctionId::new);
    let functions = [
        build_function(&[], |builder| {
            builder.call_direct(callees[1], &[]);
            builder.call_direct(callees[0], &[]);
            builder.call_direct(callees[1], &[]);
            builder.get_module_variable(VariableId::new(4));
            builder.string(StringId::new(2));
            builder.return_value(None);
        }),
        build_function(&[], |builder| {
            builder.call_direct(callees[1], &[]);
            builder.return_value(None);
        }),
    ];
    let references = list_references(&functions);

    assert_eq!(references.of(0, LocalKind::Function), [0, 1]);
    assert_eq!(references.of(0, LocalKind::Variable), [4]);
    assert_eq!(references.of(0, LocalKind::String), [2]);
    assert_eq!(
        references.of(0, LocalKind::Type),
        collect_type_references(&functions[0])
    );
    for kind in [LocalKind::Layout, LocalKind::TypeSite, LocalKind::EvalScope] {
        assert!(references.of(0, kind).is_empty(), "{kind:?}");
    }

    assert_eq!(references.of(1, LocalKind::Function), [1]);
    assert!(references.of(1, LocalKind::Variable).is_empty());
    assert!(references.of(1, LocalKind::String).is_empty());
    let lists = |definition| LocalKind::ALL.map(|kind| references.of(definition, kind));
    let listed_ids = [lists(0), lists(1)].as_flattened().concat();
    assert_eq!(listed_ids, references.ids);
}

#[test]
fn records_are_listed_by_kind() {
    let function = build_function(&[], |builder| {
        let value = builder.undefined();
        let expected = Some(ExpectedResultId::new(5));
        builder.new_object(LayoutId::new(3), &[], None, &[]);
        builder.check(value, TypeTable::NUMBER, Some(TypeSiteId::new(1)));
        builder.direct_eval(EvalScopeId::new(2), value, value, None, &[]);
        builder.call(value, None, &[], None, None, expected, false, false);
        builder.data(DataId::new(6));
        builder.prop_get(value, PropertyKeyId::new(7), false, false);
        builder.throw_module_failure(WireModuleFailureId::new(8), false);
        builder.return_value(None);
    });
    let references = list_references(&[function]);
    let listed_ids = [
        (LocalKind::Layout, 3),
        (LocalKind::TypeSite, 1),
        (LocalKind::EvalScope, 2),
        (LocalKind::ExpectedResult, 5),
        (LocalKind::Data, 6),
        (LocalKind::PropertyKey, 7),
        (LocalKind::ModuleFailure, 8),
    ];
    for (kind, id) in listed_ids {
        assert_eq!(references.of(0, kind), [id], "{kind:?}");
    }
    assert!(references.of(0, LocalKind::ModuleTarget).is_empty());
}

#[test]
fn target_and_referrer_are_separate_lists() {
    let [owner, target, referrer, resolved] = [0, 1, 2, 3].map(ModuleId::new);
    let function = build_function(&[], |builder| {
        builder.import_module(target, referrer);
        builder.resolve_module(resolved, referrer, StringId::new(0), false);
        builder.module_namespace(referrer, ImportPhase::Evaluation);
        builder.return_value(None);
    });
    assert_eq!(function.module, owner);
    let references = list_references(&[function]);
    assert_eq!(references.of(0, LocalKind::ModuleTarget), [1, 2]);
    assert_eq!(references.of(0, LocalKind::ModuleReferrer), [0, 2, 3]);
}

#[test]
fn builtin_references_are_dropped() {
    let global_this = Reference::Builtin(BuiltinId::GlobalThis);
    assert_eq!(LocalReference::new(global_this), None);

    let functions = [
        build_function(&[], |builder| {
            builder.builtin(BuiltinId::GlobalThis);
            builder.return_value(None);
        }),
        build_function(&[], |builder| builder.return_value(None)),
    ];
    let mut names_builtin = false;
    functions[0].for_each_reference(&mut |reference| names_builtin |= reference == global_this);
    assert!(names_builtin);

    let references = list_references(&functions);
    for kind in LocalKind::ALL {
        assert_eq!(references.of(0, kind), references.of(1, kind), "{kind:?}");
    }
}

#[test]
fn definitions_that_share_a_record_share_their_lists() {
    let own = Arc::new(build_function(&[], |builder| {
        builder.throw_module_failure(WireModuleFailureId::new(8), false);
        builder.return_value(None);
    }));
    let shared = Arc::new(build_function(&[], |builder| {
        builder.throw_module_failure(WireModuleFailureId::new(3), false);
        builder.return_value(None);
    }));
    let records = [&own, &shared, &shared, &own, &shared];
    let definitions: Vec<(FunctionId, Arc<Function>)> = (0..)
        .zip(records)
        .map(|(index, record)| (FunctionId::new(index), Arc::clone(record)))
        .collect();
    let references = ReferenceLists::new(&definitions);
    assert_eq!(references.rows, [0, 1, 1, 2, 3]);
    assert_eq!(references.ends.len(), 4);
    for (definition, failure) in [(0, 8), (1, 3), (2, 3), (3, 8), (4, 3)] {
        assert_eq!(
            references.of(definition, LocalKind::ModuleFailure),
            [failure]
        );
    }
}

#[test]
fn keys_carry_the_project() {
    with_test_files(|projects, [main, first, _]| {
        let function = test_function_key(main.0, 0);
        let layout = test_class_key(main.0, 0);
        let variable = test_variable_key(main.0, 0);
        for project in ProjectId::ALL {
            let mut fragment = FragmentBuilder::new(main);
            fragment.declare_function(function);
            fragment.declare_layout(layout);
            fragment.declare_variable(variable);
            fragment.declare_module(ModuleRef::File(first));
            let unit = unit_in(
                projects,
                project,
                fragment.finish(ModuleFragment::default()),
            );

            let in_project = |file| ProgramFile { project, file };
            let declared = ProgramVariableKey::Declared(key_in(project, variable));
            assert_eq!(unit.file, in_project(main));
            assert_eq!(unit.functions.keys, [key_in(project, function)]);
            assert_eq!(unit.layouts.keys, [key_in(project, layout)]);
            assert_eq!(unit.variables.keys, [declared]);
            assert_eq!(unit.modules, [ProgramModule::File(in_project(first))]);
        }
    });
}

#[test]
fn unit_hashes_keys_strings_and_types() {
    with_test_files(|projects, [main, ..]| {
        let mut fragment = FragmentBuilder::new(main);
        let texts: [&[u8]; 3] = [b"a", b"b", b""];
        for text in texts {
            fragment.strings.intern(text);
        }
        let layout = fragment.declare_layout(test_class_key(main.0, 0));
        fragment.types.intern(Type::layout(layout));
        let fragment = fragment.finish(ModuleFragment::default());
        let unit = unit_in(projects, ProjectId::Application, fragment);

        let strings = &unit.strings;
        let string_hashes: Vec<u64> = strings.ids().map(|id| strings.hash(id)).collect();
        assert_eq!(string_hashes.len(), texts.len());
        assert_shards_match(&unit.string_shards, &string_hashes);

        assert_eq!(unit.types.len(), TypeTable::WELL_KNOWN_COUNT + 1);
        assert_eq!(unit.type_hashes.types.len(), unit.types.len());
        let type_hashes = unit.type_hashes.types.iter();
        let type_hashes: Vec<u64> = type_hashes.map(|hash| hash.0[0]).collect();
        assert_shards_match(&unit.type_shards, &type_hashes);

        assert_eq!(unit.layouts.hashes, [hash_key(&unit.layouts.keys[0])]);
        assert_shards_match(&unit.layouts.shards, &unit.layouts.hashes);
    });
}

#[test]
fn unit_keeps_definitions_and_records() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let callee = unit.define_function(1, |_| {});
        let body = unit.define_body(|builder| {
            builder.call_direct(callee, &[]);
        });
        let failure = ModuleFailureId(4);
        unit.fragment.declare_module_failure(failure);
        unit.fragment.add_type_site(TypeSite {
            module: unit.module,
            ..TypeSite::default()
        });
        unit.fragment.add_expected_result(ExpectedResult::default());
        unit.fragment.add_eval_scope(EvalScope::default());
        unit.fragment.add_data(Data::default());
        let unit = unit_in(projects, ProjectId::Application, unit.finish());

        assert_eq!(unit.module.body, Some(body));
        assert_eq!(unit.module_failures, [failure]);
        let definitions = unit.function_definitions.iter();
        let defined_functions: Vec<FunctionId> =
            definitions.map(|definition| definition.0).collect();
        assert_eq!(defined_functions, [callee, body]);
        let references = &unit.function_references;
        assert!(references.of(0, LocalKind::Function).is_empty());
        assert_eq!(references.of(1, LocalKind::Function), [callee.to_word()]);
        let records = &unit.records;
        let record_counts = [
            records.type_sites.len(),
            records.expected_results.len(),
            records.eval_scopes.len(),
            records.data.len(),
        ];
        assert_eq!(record_counts, [1; 4]);
    });
}
