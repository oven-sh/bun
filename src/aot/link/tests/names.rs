use crate::builtins::RuntimeModule;
use crate::engine::Position;
use crate::ir::generated::{Body, Field, Function, Layout, Module, SourceRange, Variable};
use crate::ir::{
    FunctionId, Id, LayoutId, ModuleId, Program, PropertyKey, StringId, VariableId,
    WellKnownSymbol,
};
use crate::link::keys::merge_keys;
use crate::link::names::NameInput;
use crate::link::state::{ModuleTable, Numbering, ProgramCounts, UnitIds};
use crate::link::testing::{forward, in_application, test_function_key};
use crate::link::unit::KeyList;
use crate::link::{BodyRemap, ModuleOrigin, ProgramKeys, ProgramModule, ProgramNames};
use crate::load::PerProject;
use std::sync::Arc;

const MODULE: ModuleId = ModuleId::from_word(1);
const NAMED: usize = 0;
const UNNAMED: usize = 1;
const OUT_OF_RANGE: usize = 2;

fn create_fields(program: &mut Program) -> Vec<Field> {
    let [text, private_name, description] =
        [&b"x"[..], b"hidden", b"description"].map(|text| program.strings.intern(text));
    let keys = [
        PropertyKey::from_text(text),
        PropertyKey::from_private_name(private_name, LayoutId::new(NAMED)),
        PropertyKey::from_well_known_symbol(WellKnownSymbol::default()),
        PropertyKey::from_created_symbol(MODULE, 3, Some(description)),
    ];
    let keys = keys.map(|key| Some(program.property_keys.intern(key)));
    let keys = keys.into_iter().chain([None]);
    keys.map(|key| Field {
        key,
        ..Field::default()
    })
    .collect()
}

fn create_program() -> Program {
    let mut program = Program::new();
    let [path, display_path, shared_name, layout_name] =
        [&b"/project/main.ts"[..], b"main.ts", b"shared", b"Point"]
            .map(|text| program.strings.intern(text));
    let fields = create_fields(&mut program);
    program.modules = vec![
        Module {
            path: display_path,
            display_path: path,
            ..Module::default()
        },
        Module {
            path,
            display_path,
            ..Module::default()
        },
    ];
    program.functions = vec![
        Function {
            name: Some(shared_name),
            module: MODULE,
            text: SourceRange { start: 4, end: 9 },
            body: Body {
                value_count: 7,
                ..Body::default()
            },
            ..Function::default()
        },
        Function::default(),
    ];
    program.layouts = vec![
        Layout {
            name: Some(layout_name),
            module: Some(MODULE),
            position: 12,
            fields,
            ..Layout::default()
        },
        Layout {
            position: 12,
            ..Layout::default()
        },
    ];
    program.variables = vec![
        Variable {
            name: Some(shared_name),
            ..Variable::default()
        },
        Variable::default(),
    ];
    program
}

// One unit, whose ids are the program's.
fn take_functions(program: &mut Program) -> BodyRemap {
    let functions = core::mem::take(&mut program.functions);
    let ids = UnitIds {
        strings: (0..program.strings.len()).map(|index| Some(StringId::new(index))).collect(),
        property_keys: Vec::new(),
        types: Vec::new(),
        type_sites: Vec::new(),
        expected_results: Vec::new(),
        layouts: Vec::new(),
        variables: Vec::new(),
        modules: (0..program.modules.len()).map(|index| Some(ModuleId::new(index))).collect(),
        module_failures: Vec::new(),
        eval_scopes: Vec::new(),
        functions: Vec::new(),
        data: Vec::new(),
    };
    BodyRemap::new(vec![ids], vec![functions.into_iter().map(Arc::new).collect()])
}

fn create_names() -> ProgramNames {
    let mut program = create_program();
    let functions = take_functions(&mut program);
    ProgramNames::new(NameInput {
        program: &program,
        functions: &functions,
        module_origins: vec![ModuleOrigin::Dependency, ModuleOrigin::Program],
        beside: &crate::link::run_one_after_the_other,
    })
}

#[test]
fn names_follow_program_records() {
    let names = create_names();
    assert_eq!(names.function_name(FunctionId::new(NAMED)), b"shared");
    assert_eq!(names.function_module(FunctionId::new(NAMED)), Some(MODULE));
    assert_eq!(names.layout_name(LayoutId::new(NAMED)), b"Point");
    assert_eq!(names.variable_name(VariableId::new(NAMED)), b"shared");
}

#[test]
fn module_path_is_the_display_path() {
    let names = create_names();
    assert_eq!(names.module_path(MODULE), b"main.ts");
    assert_eq!(names.module_path(ModuleId::new(0)), b"/project/main.ts");
}

#[test]
fn records_without_names_have_empty_names() {
    let names = create_names();
    assert_eq!(names.function_name(FunctionId::new(UNNAMED)), b"");
    assert_eq!(names.layout_name(LayoutId::new(UNNAMED)), b"");
    assert_eq!(names.variable_name(VariableId::new(UNNAMED)), b"");
}

#[test]
fn function_range_is_its_text() {
    let names = create_names();
    assert_eq!(names.function_range(FunctionId::new(NAMED)), Some((4, 9)));
    assert_eq!(names.function_range(FunctionId::new(UNNAMED)), None);
}

#[test]
fn function_values_are_those_of_its_body() {
    let names = create_names();
    assert_eq!(names.function_values(FunctionId::new(NAMED)), 7);
    assert_eq!(names.function_values(FunctionId::new(UNNAMED)), 0);
}

#[test]
fn layout_position_needs_a_module() {
    let names = create_names();
    let position = Position {
        module: MODULE,
        offset: 12,
    };
    assert_eq!(names.layout_position(LayoutId::new(NAMED)), Some(position));
    assert_eq!(names.layout_position(LayoutId::new(UNNAMED)), None);
}

#[test]
fn field_names_are_text_and_private_names() {
    let names = create_names();
    let layout = LayoutId::new(NAMED);
    assert_eq!(names.field_name(layout, 0), b"x");
    assert_eq!(names.field_name(layout, 1), b"hidden");
}

#[test]
fn field_name_of_symbol_key_is_empty() {
    let names = create_names();
    let layout = LayoutId::new(NAMED);
    for field in [2, 3, 4] {
        assert_eq!(names.field_name(layout, field), b"", "{field}");
    }
}

#[test]
fn fields_of_one_layout_do_not_reach_the_next() {
    let names = create_names();
    assert_eq!(names.field_name(LayoutId::new(NAMED), 5), b"");
    assert_eq!(names.field_name(LayoutId::new(UNNAMED), 0), b"");
}

#[test]
fn ids_out_of_range_have_no_names() {
    let names = create_names();
    let function = FunctionId::new(OUT_OF_RANGE);
    let layout = LayoutId::new(OUT_OF_RANGE);
    assert_eq!(names.function_name(function), b"");
    assert_eq!(names.function_module(function), None);
    assert_eq!(names.function_range(function), None);
    assert_eq!(names.layout_name(layout), b"");
    assert_eq!(names.layout_position(layout), None);
    assert_eq!(names.field_name(layout, 0), b"");
    assert_eq!(names.variable_name(VariableId::new(OUT_OF_RANGE)), b"");
    assert_eq!(names.module_path(ModuleId::new(OUT_OF_RANGE)), b"");
    let origin = names.module_origin(ModuleId::new(OUT_OF_RANGE));
    assert_eq!(origin, ModuleOrigin::Runtime);
}

#[test]
fn module_origins_are_stored_by_module() {
    let names = create_names();
    let origins = [0, 1].map(|module| names.module_origin(ModuleId::new(module)));
    assert_eq!(origins, [ModuleOrigin::Dependency, ModuleOrigin::Program]);
}

#[test]
fn listed_names_answer_like_program_names() {
    let names = ProgramNames::from_lists(
        &[(b"first", Some(MODULE)), (b"second", None)],
        &[b"Point"],
        &[(b"main.ts", ModuleOrigin::Program)],
    );
    assert_eq!(names.function_name(FunctionId::new(1)), b"second");
    assert_eq!(names.function_module(FunctionId::new(0)), Some(MODULE));
    assert_eq!(names.function_module(FunctionId::new(1)), None);
    assert_eq!(names.layout_name(LayoutId::new(0)), b"Point");
    assert_eq!(names.field_name(LayoutId::new(0), 0), b"");
    assert_eq!(names.module_path(ModuleId::new(0)), b"main.ts");
    assert_eq!(names.module_origin(ModuleId::new(0)), ModuleOrigin::Program);
}

#[test]
fn keys_are_listed_by_program_id() {
    let keys = [0, 1, 2].map(|function| in_application(test_function_key(0, function)));
    let functions = merge_keys(&[&KeyList::new(keys.to_vec())], &forward);
    let mut function_ids = vec![None; keys.len()];
    for (key, id) in [(keys[2], 0), (keys[0], 1)] {
        let merged = functions.find(&key).expect("the key is listed");
        function_ids[merged as usize] = Some(FunctionId::new(id));
    }
    let modules = [RuntimeModule::NodeBuffer, RuntimeModule::BunJsc].map(ProgramModule::Runtime);
    let module_table = ModuleTable {
        modules: modules.to_vec(),
        index_by_module: Default::default(),
        unit_by_module: vec![None; modules.len()],
    };
    let numbering = Numbering {
        functions: function_ids,
        layouts: Vec::new(),
        variables: Vec::new(),
        modules: vec![None, Some(ModuleId::new(0))],
        module_failures: PerProject::default(),
        counts: ProgramCounts {
            functions: 2,
            modules: 1,
            ..ProgramCounts::default()
        },
        units: Vec::new(),
    };

    let program_keys = ProgramKeys::new(
        &functions,
        &merge_keys(&[], &forward),
        &merge_keys(&[], &forward),
        &module_table,
        &numbering,
    );

    assert_eq!(program_keys.functions, [keys[2], keys[0]]);
    assert_eq!(program_keys.modules, [modules[1]]);
    assert!(program_keys.layouts.is_empty());
    assert!(program_keys.variables.is_empty());
}
