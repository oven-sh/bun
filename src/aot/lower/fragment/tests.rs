use bun_sema::program::FileId;

use super::{Fragment, FragmentBuilder, ModuleFragment};
use crate::builtins::id::RuntimeFunction;
use crate::ir::generated::{
    Data, EvalScope, ExpectedResult, Function, FunctionVisibility, Layout, RuntimeFunctionEntry,
    TypeSite, Variable,
};
use crate::ir::{FunctionId, Id, LayoutId, TypeTable, VariableId};
use crate::link::testing::{test_class_key, test_function_key, test_variable_key};
use crate::modules::{ModuleFailureId, ModuleRef};

const FILE: FileId = FileId(0);

fn finish(builder: FragmentBuilder) -> Fragment {
    builder.finish(ModuleFragment::default())
}

#[test]
fn repeated_key_has_one_id() {
    let mut builder = FragmentBuilder::new(FILE);
    let keys = [test_function_key(0, 0), test_function_key(0, 1)];
    let ids = keys.map(|key| builder.declare_function(key));
    assert_eq!(ids.map(Id::index), [0, 1]);
    assert_eq!(keys.map(|key| builder.declare_function(key)), ids);

    let layout = builder.declare_layout(test_class_key(0, 0));
    let variable = builder.declare_variable(test_variable_key(0, 0));
    assert_eq!((layout.index(), variable.index()), (0, 0));
    assert_eq!(builder.declare_layout(test_class_key(0, 0)), layout);
    assert_eq!(builder.declare_variable(test_variable_key(0, 0)), variable);

    let fragment = finish(builder);
    assert_eq!(fragment.function_keys, keys);
    assert_eq!(fragment.layout_keys, [test_class_key(0, 0)]);
    assert_eq!(fragment.variable_keys, [test_variable_key(0, 0)]);
}

#[test]
fn repeated_module_has_one_id() {
    let mut builder = FragmentBuilder::new(FILE);
    let modules = [ModuleRef::File(FileId(0)), ModuleRef::File(FileId(1))];
    let ids = modules.map(|module| builder.declare_module(module));
    assert_eq!(ids.map(Id::index), [0, 1]);
    assert_eq!(modules.map(|module| builder.declare_module(module)), ids);
    assert_eq!(finish(builder).module_keys, modules);
}

#[test]
fn repeated_module_failure_has_one_id() {
    let mut builder = FragmentBuilder::new(FILE);
    let failures = [ModuleFailureId(7), ModuleFailureId(3)];
    let ids = failures.map(|failure| builder.declare_module_failure(failure));
    assert_eq!(ids.map(Id::index), [0, 1]);
    assert_eq!(
        failures.map(|failure| builder.declare_module_failure(failure)),
        ids
    );
    assert_eq!(finish(builder).module_failure_keys, failures);
}

#[test]
fn keys_are_found_by_id() {
    let mut builder = FragmentBuilder::new(FILE);
    let function_keys = [test_function_key(0, 4), test_function_key(1, 4)];
    let layout_keys = [test_class_key(1, 2), test_class_key(0, 2)];
    let functions = function_keys.map(|key| builder.declare_function(key));
    let layouts = layout_keys.map(|key| builder.declare_layout(key));
    assert_eq!(functions.map(|id| builder.function_key(id)), function_keys);
    assert_eq!(layouts.map(|id| builder.layout_key(id)), layout_keys);
    assert_eq!(builder.layout_keys(), layout_keys);
}

#[test]
fn definitions_set_defined() {
    let mut builder = FragmentBuilder::new(FILE);
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
    let mut builder = FragmentBuilder::new(FILE);
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
    let mut builder = FragmentBuilder::new(FILE);
    builder.declare_function(test_function_key(1, 0));
    builder.declare_layout(test_class_key(1, 0));
    builder.declare_variable(test_variable_key(1, 0));
    let fragment = finish(builder);
    assert_eq!(fragment.function_keys.len(), 1);
    assert_eq!(fragment.layout_keys.len(), 1);
    assert_eq!(fragment.variable_keys.len(), 1);
    assert!(fragment.functions.is_empty());
    assert!(fragment.layouts.is_empty());
    assert!(fragment.variables.is_empty());
}

#[test]
fn records_are_numbered_in_call_order() {
    let mut builder = FragmentBuilder::new(FILE);
    let type_sites = [(); 2].map(|()| builder.add_type_site(TypeSite::default()));
    let expected_results = [(); 2].map(|()| builder.add_expected_result(ExpectedResult::default()));
    let eval_scopes = [(); 2].map(|()| builder.add_eval_scope(EvalScope::default()));
    let data = [(); 2].map(|()| builder.add_data(Data::default()));
    assert_eq!(type_sites.map(Id::index), [0, 1]);
    assert_eq!(expected_results.map(Id::index), [0, 1]);
    assert_eq!(eval_scopes.map(Id::index), [0, 1]);
    assert_eq!(data.map(Id::index), [0, 1]);

    let fragment = finish(builder);
    assert_eq!(fragment.type_sites.len(), 2);
    assert_eq!(fragment.expected_results.len(), 2);
    assert_eq!(fragment.eval_scopes.len(), 2);
    assert_eq!(fragment.data.len(), 2);
}

#[test]
fn finish_removes_repeated_and_reflexive_edges() {
    let mut builder = FragmentBuilder::new(FILE);
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
    let mut builder = FragmentBuilder::new(FILE);
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
    let mut builder = FragmentBuilder::new(FileId(5));
    let body = builder.declare_function(test_function_key(5, 0));
    let data = builder.add_data(Data::default());
    let fragment = builder.finish(ModuleFragment {
        body: Some(body),
        data: Some(data),
        function_text: b"text".to_vec(),
        ..ModuleFragment::default()
    });
    assert_eq!(fragment.file, FileId(5));
    assert_eq!(fragment.module.body, Some(body));
    assert_eq!(fragment.module.data, Some(data));
    assert_eq!(fragment.module.function_text, b"text");
}

#[test]
fn empty_fragment_has_well_known_types() {
    let fragment = finish(FragmentBuilder::new(FILE));
    assert_eq!(fragment.types.len(), TypeTable::WELL_KNOWN_COUNT);
    assert!(fragment.strings.is_empty());
    assert!(fragment.property_keys.is_empty());
    assert!(fragment.function_keys.is_empty());
    assert!(fragment.layout_keys.is_empty());
    assert!(fragment.variable_keys.is_empty());
    assert!(fragment.module_keys.is_empty());
    assert!(fragment.module_failure_keys.is_empty());
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "a fragment defines a key once")]
fn second_definition_is_rejected() {
    let mut builder = FragmentBuilder::new(FILE);
    let variable = builder.declare_variable(test_variable_key(0, 0));
    builder.define_variable(variable, Variable::default());
    builder.define_variable(variable, Variable::default());
}

#[cfg(debug_assertions)]
#[test]
#[should_panic]
fn function_of_another_file_is_rejected() {
    let mut builder = FragmentBuilder::new(FILE);
    let function = builder.declare_function(test_function_key(1, 0));
    builder.define_function(function, Function::default());
}

#[cfg(debug_assertions)]
#[test]
#[should_panic(expected = "supertypes are edges until link")]
fn layout_with_supertypes_is_rejected() {
    let mut builder = FragmentBuilder::new(FILE);
    let layout = builder.declare_layout(test_class_key(0, 0));
    let supertype = builder.declare_layout(test_class_key(0, 1));
    let definition = Layout {
        supertypes: vec![supertype],
        ..Layout::default()
    };
    builder.define_layout(layout, definition);
}
