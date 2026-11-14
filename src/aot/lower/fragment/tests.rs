use std::sync::Arc;

use bun_sema::erasure::PackedTypeRanges;
use bun_sema::program::FileId;

use super::{Fragment, FragmentBuilder, ModuleFragment};
use crate::builtins::id::RuntimeFunction;
use crate::ir::generated::{
    Data, EvalScope, Function, FunctionVisibility, Layout, LayoutFlags, RuntimeFunctionEntry,
    Variable,
};
use crate::ir::{FunctionId, Id, LayoutId, PropertyKey, TypeTable, VariableId};
use crate::link::testing::{test_class_key, test_function_key, test_variable_key};
use crate::lower::tables::TaskState;
use crate::modules::{ModuleFailureId, ModuleRef};

const FILE: FileId = FileId(0);
const OTHER_FILE: FileId = FileId(1);

fn finish(builder: FragmentBuilder) -> Fragment {
    builder.finish_alone(ModuleFragment::default())
}

fn finish_in(builder: FragmentBuilder, task: &mut TaskState) -> Fragment {
    builder.finish(ModuleFragment::default(), task)
}

fn ids_of<I: Id, R>(records: &[(I, R)]) -> Vec<usize> {
    records.iter().map(|record| record.0.index()).collect()
}

fn key_counts(fragment: &Fragment) -> [u32; 5] {
    let lengths = fragment.lengths;
    [
        lengths.functions,
        lengths.layouts,
        lengths.variables,
        lengths.modules,
        lengths.module_failures,
    ]
}

fn declare_keys_of(builder: &mut FragmentBuilder, file: u32) -> [usize; 5] {
    let function = builder.declare_function(test_function_key(file, 0));
    let layout = builder.declare_layout(test_class_key(file, 0));
    let variable = builder.declare_variable(test_variable_key(file, 0));
    let module = builder.declare_module(ModuleRef::File(FileId(file)));
    let failure = builder.declare_module_failure(ModuleFailureId(file));
    [
        function.index(),
        layout.index(),
        variable.index(),
        module.index(),
        failure.index(),
    ]
}

fn is_written_under_dictionary_type(fragment: &Fragment) -> bool {
    let flag = LayoutFlags::IS_WRITTEN_UNDER_DICTIONARY_TYPE;
    fragment.layouts[0].1.flags.contains(flag)
}

#[test]
fn repeated_key_has_one_id() {
    let mut builder = FragmentBuilder::alone(FILE);
    let keys = [test_function_key(0, 0), test_function_key(0, 1)];
    let ids = keys.map(|key| builder.declare_function(key));
    assert_eq!(ids.map(Id::index), [0, 1]);
    assert_eq!(keys.map(|key| builder.declare_function(key)), ids);

    let layout = builder.declare_layout(test_class_key(0, 0));
    let variable = builder.declare_variable(test_variable_key(0, 0));
    assert_eq!((layout.index(), variable.index()), (0, 0));
    assert_eq!(builder.declare_layout(test_class_key(0, 0)), layout);
    assert_eq!(builder.declare_variable(test_variable_key(0, 0)), variable);

    let tables = finish(builder).tables.take();
    assert_eq!(tables.function_keys, keys);
    assert_eq!(tables.layout_keys, [test_class_key(0, 0)]);
    assert_eq!(tables.variable_keys, [test_variable_key(0, 0)]);
}

#[test]
fn repeated_module_has_one_id() {
    let mut builder = FragmentBuilder::alone(FILE);
    let modules = [ModuleRef::File(FileId(0)), ModuleRef::File(FileId(1))];
    let ids = modules.map(|module| builder.declare_module(module));
    assert_eq!(ids.map(Id::index), [0, 1]);
    assert_eq!(modules.map(|module| builder.declare_module(module)), ids);
    assert_eq!(finish(builder).tables.take().module_keys, modules);
}

#[test]
fn repeated_module_failure_has_one_id() {
    let mut builder = FragmentBuilder::alone(FILE);
    let failures = [ModuleFailureId(7), ModuleFailureId(3)];
    let ids = failures.map(|failure| builder.declare_module_failure(failure));
    assert_eq!(ids.map(Id::index), [0, 1]);
    assert_eq!(
        failures.map(|failure| builder.declare_module_failure(failure)),
        ids
    );
    assert_eq!(finish(builder).tables.take().module_failure_keys, failures);
}

#[test]
fn keys_are_found_by_id() {
    let mut builder = FragmentBuilder::alone(FILE);
    let function_keys = [test_function_key(0, 4), test_function_key(1, 4)];
    let layout_keys = [test_class_key(1, 2), test_class_key(0, 2)];
    let functions = function_keys.map(|key| builder.declare_function(key));
    let layouts = layout_keys.map(|key| builder.declare_layout(key));
    assert_eq!(functions.map(|id| builder.function_key(id)), function_keys);
    assert_eq!(layouts.map(|id| builder.layout_key(id)), layout_keys);
    assert_eq!(builder.layouts_named_in_file(), layouts);
}

#[test]
fn layouts_named_only_by_types_are_not_named_by_code() {
    let mut builder = FragmentBuilder::alone(FILE);
    let named_by_code = [0, 1].map(|class| builder.declare_layout(test_class_key(0, class)));
    assert_eq!(builder.end_layouts_of_code(), 2);
    builder.declare_layout(test_class_key(0, 2));
    builder.declare_layout(test_class_key(0, 0));
    assert_eq!(builder.layouts_named_in_file().len(), 3);
    assert_eq!(finish(builder).layouts_named_by_code, named_by_code);
}

#[test]
fn definitions_set_defined() {
    let mut builder = FragmentBuilder::alone(FILE);
    let layouts = [0, 1].map(|class| builder.declare_layout(test_class_key(0, class)));
    let variables = [0, 1].map(|symbol| builder.declare_variable(test_variable_key(0, symbol)));
    assert_eq!(
        layouts.map(|id| builder.is_layout_defined(id)),
        [false, false]
    );
    assert_eq!(
        variables.map(|id| builder.is_variable_defined(id)),
        [false, false]
    );

    builder.define_layout(layouts[1], Layout::default());
    builder.define_variable(variables[0], Variable::default());
    assert_eq!(
        layouts.map(|id| builder.is_layout_defined(id)),
        [false, true]
    );
    assert_eq!(
        variables.map(|id| builder.is_variable_defined(id)),
        [true, false]
    );
}

#[test]
fn definitions_stay_in_call_order() {
    let mut builder = FragmentBuilder::alone(FILE);
    let functions = [0, 1].map(|function| builder.declare_function(test_function_key(0, function)));
    let layouts = [0, 1].map(|class| builder.declare_layout(test_class_key(0, class)));
    let variables = [0, 1].map(|symbol| builder.declare_variable(test_variable_key(0, symbol)));
    for index in [1, 0] {
        builder.define_function(functions[index], Function::default());
        builder.define_layout(layouts[index], Layout::default());
        builder.define_variable(variables[index], Variable::default());
    }
    let fragment = finish(builder);
    let defined_functions: Vec<FunctionId> = fragment.functions.iter().map(|pair| pair.0).collect();
    let defined_layouts: Vec<LayoutId> = fragment.layouts.iter().map(|pair| pair.0).collect();
    let defined_variables: Vec<VariableId> = fragment.variables.iter().map(|pair| pair.0).collect();
    assert_eq!(defined_functions, [functions[1], functions[0]]);
    assert_eq!(defined_layouts, [layouts[1], layouts[0]]);
    assert_eq!(defined_variables, [variables[1], variables[0]]);
}

#[test]
fn declared_key_without_definition_has_no_record() {
    let mut builder = FragmentBuilder::alone(FILE);
    builder.declare_function(test_function_key(1, 0));
    builder.declare_layout(test_class_key(1, 0));
    builder.declare_variable(test_variable_key(1, 0));
    let fragment = finish(builder);
    assert_eq!(key_counts(&fragment), [1, 1, 1, 0, 0]);
    assert!(fragment.functions.is_empty());
    assert!(fragment.layouts.is_empty());
    assert!(fragment.variables.is_empty());
}

#[test]
fn records_are_numbered_in_call_order() {
    let mut builder = FragmentBuilder::alone(FILE);
    let eval_scopes = [(); 2].map(|()| builder.add_eval_scope(EvalScope::default()));
    let data = [(); 2].map(|()| builder.add_data(Data::default()));
    assert_eq!(eval_scopes.map(Id::index), [0, 1]);
    assert_eq!(data.map(Id::index), [0, 1]);

    let fragment = finish(builder);
    assert_eq!(ids_of(&fragment.eval_scopes), [0, 1]);
    assert_eq!(ids_of(&fragment.data), [0, 1]);
}

#[test]
fn finish_removes_repeated_and_reflexive_edges() {
    let mut builder = FragmentBuilder::alone(FILE);
    let first = builder.declare_layout(test_class_key(0, 0));
    let second = builder.declare_layout(test_class_key(0, 1));
    for (layout, supertype) in [(second, first), (first, second), (second, first)] {
        builder.add_supertype(layout, supertype);
    }
    builder.add_supertype(first, first);
    let edges = finish(builder).supertype_edges;
    assert_eq!(edges, [(first, second), (second, first)]);
}

#[test]
fn runtime_functions_stay_in_call_order() {
    let mut builder = FragmentBuilder::alone(FILE);
    let function = builder.declare_function(test_function_key(0, 0));
    let entries = [3, 1].map(|id| RuntimeFunctionEntry {
        id: RuntimeFunction(id),
        function,
        visibility: FunctionVisibility::Private,
    });
    for entry in entries {
        builder.add_runtime_function(entry);
    }
    assert_eq!(finish(builder).runtime_functions, entries);
}

#[test]
fn finish_keeps_file_and_module() {
    let mut builder = FragmentBuilder::alone(FileId(5));
    let body = builder.declare_function(test_function_key(5, 0));
    let data = builder.add_data(Data::default());
    let fragment = builder.finish_alone(ModuleFragment {
        body: Some(body),
        data: Some(data),
        erased_type_ranges: Some(PackedTypeRanges::default()),
        ..ModuleFragment::default()
    });
    assert_eq!(fragment.file, FileId(5));
    assert_eq!(fragment.module.body, Some(body));
    assert_eq!(fragment.module.data, Some(data));
    assert!(fragment.module.erased_type_ranges.is_some());
}

#[test]
fn empty_fragment_has_well_known_types() {
    let tables = finish(FragmentBuilder::alone(FILE)).tables.take();
    assert_eq!(tables.types.len(), TypeTable::WELL_KNOWN_COUNT);
    assert!(tables.strings.is_empty());
    assert!(tables.property_keys.is_empty());
    assert!(tables.function_keys.is_empty());
    assert!(tables.layout_keys.is_empty());
    assert!(tables.variable_keys.is_empty());
    assert!(tables.module_keys.is_empty());
    assert!(tables.module_failure_keys.is_empty());
}

#[test]
fn next_file_gets_same_ids_for_same_keys() {
    let mut task = TaskState::new();
    let mut builder = FragmentBuilder::new(FILE, &mut task);
    assert_eq!(declare_keys_of(&mut builder, 0), [0; 5]);
    let first = finish_in(builder, &mut task);

    let mut builder = FragmentBuilder::new(OTHER_FILE, &mut task);
    assert_eq!(declare_keys_of(&mut builder, 1), [1; 5]);
    assert_eq!(declare_keys_of(&mut builder, 0), [0; 5]);
    let second = finish_in(builder, &mut task);

    assert!(Arc::ptr_eq(&first.tables, &second.tables));
    assert_eq!(key_counts(&first), [1; 5]);
    assert_eq!(key_counts(&second), [2; 5]);
    let tables = second.tables.take();
    for file in [0, 1] {
        let index = file as usize;
        assert_eq!(tables.function_keys[index], test_function_key(file, 0));
        assert_eq!(tables.layout_keys[index], test_class_key(file, 0));
        assert_eq!(tables.variable_keys[index], test_variable_key(file, 0));
        assert_eq!(tables.module_keys[index], ModuleRef::File(FileId(file)));
        assert_eq!(tables.module_failure_keys[index], ModuleFailureId(file));
    }
}

#[test]
fn next_file_finds_nothing_defined() {
    let mut task = TaskState::new();
    for file in [FILE, OTHER_FILE] {
        let mut builder = FragmentBuilder::new(file, &mut task);
        let layout = builder.declare_layout(test_class_key(0, 0));
        let variable = builder.declare_variable(test_variable_key(0, 0));
        assert!(!builder.is_layout_defined(layout));
        assert!(!builder.is_variable_defined(variable));

        builder.define_layout(layout, Layout::default());
        builder.define_variable(variable, Variable::default());
        assert!(builder.is_layout_defined(layout));
        assert!(builder.is_variable_defined(variable));

        let fragment = finish_in(builder, &mut task);
        assert_eq!(ids_of(&fragment.layouts), [0]);
        assert_eq!(ids_of(&fragment.variables), [0]);
    }
}

#[test]
fn next_file_names_layouts_anew() {
    let mut task = TaskState::new();
    let mut builder = FragmentBuilder::new(FILE, &mut task);
    let layouts = [0, 1, 2].map(|class| builder.declare_layout(test_class_key(0, class)));
    assert_eq!(builder.layouts_named_in_file(), layouts);
    assert_eq!(finish_in(builder, &mut task).layouts_named_by_code, layouts);

    let mut builder = FragmentBuilder::new(OTHER_FILE, &mut task);
    assert!(builder.layouts_named_in_file().is_empty());
    for class in [2, 0, 2] {
        builder.declare_layout(test_class_key(0, class));
    }
    assert_eq!(builder.layouts_named_in_file(), [layouts[2], layouts[0]]);
    let named_by_code = finish_in(builder, &mut task).layouts_named_by_code;
    assert_eq!(named_by_code, [layouts[0], layouts[2]]);
}

#[test]
fn next_file_goes_on_numbering_records() {
    let mut task = TaskState::new();
    let mut builder = FragmentBuilder::new(FILE, &mut task);
    builder.add_eval_scope(EvalScope::default());
    builder.add_data(Data::default());
    builder.add_data(Data::default());
    let first = finish_in(builder, &mut task);

    let mut builder = FragmentBuilder::new(OTHER_FILE, &mut task);
    assert_eq!(builder.add_eval_scope(EvalScope::default()).index(), 1);
    assert_eq!(builder.add_data(Data::default()).index(), 2);
    let second = finish_in(builder, &mut task);

    assert_eq!(ids_of(&first.eval_scopes), [0]);
    assert_eq!(ids_of(&first.data), [0, 1]);
    assert_eq!(ids_of(&second.eval_scopes), [1]);
    assert_eq!(ids_of(&second.data), [2]);
    assert_eq!((first.lengths.eval_scopes, first.lengths.data), (1, 2));
    assert_eq!((second.lengths.eval_scopes, second.lengths.data), (2, 3));
}

#[test]
fn next_file_finds_nothing_marked() {
    let mut task = TaskState::new();
    let mut builder = FragmentBuilder::new(FILE, &mut task);
    let layouts = [0, 1].map(|class| builder.declare_layout(test_class_key(0, class)));
    let name = builder.strings.intern(b"name");
    let key = builder.property_keys.intern(PropertyKey::from_text(name));
    for layout in [layouts[1], layouts[0], layouts[1]] {
        builder.note_allocation(layout);
    }
    builder.note_write(key);
    builder.note_write(key);
    builder.note_literal_under_dictionary_type(layouts[0]);
    builder.define_layout(layouts[0], Layout::default());
    let first = finish_in(builder, &mut task);
    assert_eq!(first.allocated_layouts, layouts);
    assert_eq!(first.written_keys, [key]);
    assert!(is_written_under_dictionary_type(&first));

    let mut builder = FragmentBuilder::new(OTHER_FILE, &mut task);
    let layouts_again = [0, 1].map(|class| builder.declare_layout(test_class_key(0, class)));
    assert_eq!(layouts_again, layouts);
    builder.note_allocation(layouts[1]);
    builder.define_layout(layouts[0], Layout::default());
    let second = finish_in(builder, &mut task);
    assert_eq!(second.allocated_layouts, [layouts[1]]);
    assert!(second.written_keys.is_empty());
    assert!(!is_written_under_dictionary_type(&second));
}

fn check_visit_is_taken_back(end_visit: impl FnOnce(FragmentBuilder, &mut TaskState)) {
    let mut task = TaskState::new();
    let mut builder = FragmentBuilder::new(FILE, &mut task);
    assert_eq!(declare_keys_of(&mut builder, 0), [0; 5]);
    builder.add_data(Data::default());
    finish_in(builder, &mut task);

    let mut builder = FragmentBuilder::new(OTHER_FILE, &mut task);
    assert_eq!(declare_keys_of(&mut builder, 1), [1; 5]);
    builder.strings.intern(b"thrown away");
    builder.add_data(Data::default());
    end_visit(builder, &mut task);

    let mut builder = FragmentBuilder::new(OTHER_FILE, &mut task);
    assert_eq!(builder.strings.find(b"thrown away"), None);
    assert_eq!(declare_keys_of(&mut builder, 2), [1; 5]);
    assert_eq!(declare_keys_of(&mut builder, 1), [2; 5]);
    assert_eq!(declare_keys_of(&mut builder, 0), [0; 5]);
    assert_eq!(builder.add_data(Data::default()).index(), 1);
    let fragment = finish_in(builder, &mut task);
    assert_eq!(key_counts(&fragment), [3; 5]);
    assert_eq!((fragment.lengths.strings, fragment.lengths.data), (0, 2));
}

#[test]
fn visiting_a_file_twice_in_a_row_takes_back_the_first_visit() {
    check_visit_is_taken_back(|builder, task| drop(finish_in(builder, task)));
}

#[test]
fn abandoned_visit_leaves_nothing_in_the_tables() {
    check_visit_is_taken_back(FragmentBuilder::abandon);
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "a fragment defines a key once")]
fn second_definition_is_rejected() {
    let mut builder = FragmentBuilder::alone(FILE);
    let variable = builder.declare_variable(test_variable_key(0, 0));
    builder.define_variable(variable, Variable::default());
    builder.define_variable(variable, Variable::default());
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn function_of_another_file_is_rejected() {
    let mut builder = FragmentBuilder::alone(FILE);
    let function = builder.declare_function(test_function_key(1, 0));
    builder.define_function(function, Function::default());
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "supertypes are edges until link")]
fn layout_with_supertypes_is_rejected() {
    let mut builder = FragmentBuilder::alone(FILE);
    let layout = builder.declare_layout(test_class_key(0, 0));
    let supertype = builder.declare_layout(test_class_key(0, 1));
    let definition = Layout {
        supertypes: vec![supertype],
        ..Layout::default()
    };
    builder.define_layout(layout, definition);
}
