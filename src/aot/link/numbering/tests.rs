use super::*;
use crate::builtins::RuntimeModule;
use crate::ir::generated::{
    Data, ECMAMode, EvalScope, ExpectedResult, Function, FunctionReferenceKind, ImportPhase,
    Layout, LayoutFlags, ModuleReferenceKind, TypeSite, TypeSiteKind, VariableInitialization,
};
use crate::ir::{
    DataId, EvalScopeId, ExpectedResultId, FunctionBuilder, FunctionId, FunctionKey, LayoutId,
    LayoutKey, ModuleFailureId, ModuleId, Reference, Type, TypeSiteId, TypeTable, VariableKey,
};
use crate::link::definitions::{empty_layout, synthetic_export_variable};
use crate::link::key_context;
use crate::link::keys::merge_keys;
use crate::link::move_definitions::{MoveInput, move_definitions};
use crate::link::program_keys::ProgramModule;
use crate::link::state::{ExportWriter, ModuleTable, ProgramTables, SupertypeEdges};
use crate::link::testing::{
    Numbered, Projects, TestUnit, application_file, define_test_function, find_file,
    find_synthetic_export, forward, in_application, key_in, number_units, path_source, reverse,
    test_class_key, test_function_key, test_object_type_key, test_variable_key, unit_in,
    with_projects, with_projects_without_bun_modules, with_test_files,
};
use crate::link::unit::{KeyList, LinkUnit};
use crate::load::{PerProject, ProgramFile, ProjectId};
use crate::lower::Fragment;
use crate::modules::ModuleRef;
use bun_sema::atom::Atom;
use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::FileId;

struct Moved {
    numbered: Numbered,
    tables: ProgramTables,
    functions: Vec<Function>,
}

impl Moved {
    fn program_function_id(&self, key: ProgramFunctionKey) -> Option<FunctionId> {
        let merged = self.numbered.prepared.functions.find(&key);
        self.numbered.numbering.functions[merged.expect("no unit declares the function") as usize]
    }

    fn function_id(&self, key: FunctionKey) -> Option<FunctionId> {
        self.program_function_id(in_application(key))
    }

    fn program_layout_id(&self, key: ProgramLayoutKey) -> Option<LayoutId> {
        let merged = self.numbered.prepared.layouts.find(&key);
        self.numbered.numbering.layouts[merged.expect("no unit declares the layout") as usize]
    }

    fn layout_id(&self, key: LayoutKey) -> Option<LayoutId> {
        self.program_layout_id(in_application(key))
    }

    fn program_variable_id(&self, key: ProgramVariableKey) -> Option<VariableId> {
        let merged = self.numbered.prepared.variables.find(&key);
        self.numbered.numbering.variables[merged.expect("nothing declares the variable") as usize]
    }

    fn variable_id(&self, key: VariableKey) -> Option<VariableId> {
        self.program_variable_id(ProgramVariableKey::Declared(in_application(key)))
    }

    fn module_id(&self, file: ProgramFile) -> Option<ModuleId> {
        let index = self
            .numbered
            .prepared
            .modules
            .index_of(ProgramModule::File(file));
        self.numbered.numbering.modules[index as usize]
    }

    fn unit_ids(&self, file: FileId) -> &UnitIds {
        let mut units = self.numbered.prepared.units.iter();
        let unit = units.position(|unit| unit.file == application_file(file));
        &self.numbered.numbering.units[unit.expect("the file has no unit")]
    }

    fn counts(&self) -> &ProgramCounts {
        &self.numbered.numbering.counts
    }
}

fn move_units(projects: &Projects<'_, '_>, units: Vec<LinkUnit>) -> Moved {
    let mut numbered = number_units(units, projects);
    let Numbered {
        prepared,
        retained,
        numbering,
        strings,
    } = &mut numbered;
    let input = MoveInput {
        defined: ProgramDefinitions::new(
            &prepared.functions,
            &prepared.layouts,
            &prepared.variables,
            &prepared.definitions,
            retained,
        ),
        layouts: &prepared.layouts,
        definitions: &prepared.definitions,
        numbering,
        atoms: &projects.application.loaded.files().atoms,
        in_parallel: &forward,
        beside: &crate::link::run_one_after_the_other,
    };
    let mut tables = move_definitions(&mut prepared.units, &input, strings);
    let mut functions = Vec::new();
    for (ids, list) in numbering
        .units
        .iter()
        .zip(core::mem::take(&mut tables.functions_by_unit))
    {
        for function in list {
            let mut function = std::sync::Arc::unwrap_or_clone(function);
            let function_types = core::mem::take(&mut function.function_types);
            function.remap_ids(&ids.as_map());
            function.function_types = function_types;
            functions.push(function);
        }
    }
    Moved {
        numbered,
        tables,
        functions,
    }
}

fn move_fragments<const COUNT: usize>(
    projects: &Projects<'_, '_>,
    fragments: [Fragment; COUNT],
) -> Moved {
    let units = fragments.map(|fragment| unit_in(projects, ProjectId::Application, fragment));
    move_units(projects, units.into())
}

fn emit_references(builder: &mut FunctionBuilder, names: &[Reference]) {
    let value = builder.undefined();
    for &reference in names {
        match reference {
            Reference::Function(id, _) => builder.call_direct(id, &[]),
            Reference::Layout(id) => builder.new_object(id, &[], None, &[]),
            Reference::Variable(id) => builder.get_module_variable(id),
            Reference::Type(id) => builder.type_test(value, id),
            Reference::TypeSite(id) => builder.check(value, TypeTable::NUMBER, Some(id)),
            Reference::EvalScope(id) => builder.direct_eval(id, value, value, None, &[]),
            Reference::ExpectedResult(id) => {
                builder.call(value, None, &[], None, None, Some(id), false, false)
            }
            Reference::Data(id) => builder.data(id),
            Reference::Module(id, ModuleReferenceKind::Target) => {
                builder.module_namespace(id, ImportPhase::Evaluation)
            }
            Reference::Module(_, ModuleReferenceKind::Referrer)
            | Reference::String(_)
            | Reference::PropertyKey(_)
            | Reference::ModuleFailure(_)
            | Reference::Builtin(_) => unreachable!("{reference:?}"),
        };
    }
}

fn define_function(unit: &mut TestUnit, function: u32, names: &[Reference]) -> FunctionId {
    unit.define_function(function, |builder| emit_references(builder, names))
}

fn finish_with_body(mut unit: TestUnit, names: &[Reference]) -> Fragment {
    unit.define_body(|builder| emit_references(builder, names));
    unit.finish()
}

fn call(function: FunctionId) -> Reference {
    Reference::Function(function, FunctionReferenceKind::Call)
}

fn define_variable(unit: &mut TestUnit, symbol: u32) -> Reference {
    let name = unit.fragment.strings.intern(b"variable");
    let id = unit
        .fragment
        .declare_variable(test_variable_key(unit.file.0, symbol));
    let definition = synthetic_export_variable(name, unit.module, ExportWriter::Loader);
    unit.fragment.define_variable(id, definition);
    Reference::Variable(id)
}

fn add_class(unit: &mut TestUnit, class: u32, base: Option<LayoutId>) -> LayoutId {
    let key = test_class_key(unit.file.0, class);
    let id = unit.fragment.declare_layout(key);
    let definition = Layout {
        base,
        ..empty_layout(&key)
    };
    unit.fragment.define_layout(id, definition);
    id
}

fn signature_key(file: FileId, declaration: u32) -> FunctionKey {
    FunctionKey::Signature(FunctionRef {
        file,
        function: FnId(declaration),
    })
}

fn class_signature_key(file: FileId, class: u32) -> FunctionKey {
    FunctionKey::ClassSignature(ClassRef {
        file,
        class: ClassId(class),
    })
}

fn define_function_type(unit: &mut TestUnit, key: FunctionKey) -> FunctionId {
    define_test_function(&mut unit.fragment, key, unit.module, |_| {})
}

fn add_type_site(unit: &mut TestUnit, position: u32) -> TypeSiteId {
    unit.fragment.add_type_site(TypeSite {
        module: unit.module,
        position,
        kind: TypeSiteKind::Assertion,
        text: None,
    })
}

fn create_eval_scope(mode: ECMAMode) -> EvalScope {
    EvalScope {
        mode,
        ..EvalScope::default()
    }
}

fn some_ids<I: Id, const COUNT: usize>(indexes: [usize; COUNT]) -> [Option<I>; COUNT] {
    indexes.map(|index| Some(I::new(index)))
}

fn references_of(function: &Function) -> Vec<Reference> {
    let mut references = Vec::new();
    function.for_each_reference(&mut |reference| references.push(reference));
    references
}

fn sorted<const COUNT: usize>(mut files: [FileId; COUNT]) -> [FileId; COUNT] {
    files.sort_unstable();
    files
}

fn create_function_fragments([main, first, second]: [FileId; 3]) -> ([Fragment; 3], FunctionId) {
    let mut first_unit = TestUnit::new(first);
    first_unit.declare_function(first, 0);
    define_function(&mut first_unit, 1, &[]);
    let dropped = define_function(&mut first_unit, 2, &[]);
    define_function(&mut first_unit, 0, &[]);
    let mut second_unit = TestUnit::new(second);
    let callee = second_unit.declare_function(first, 0);
    define_function(&mut second_unit, 0, &[call(callee)]);
    let mut main_unit = TestUnit::new(main);
    let callees = [(first, 0), (first, 1), (second, 0)]
        .map(|(file, function)| call(main_unit.declare_function(file, function)));
    let fragments = [
        second_unit.finish(),
        finish_with_body(main_unit, &callees),
        first_unit.finish(),
    ];
    (fragments, dropped)
}

fn move_function_files(projects: &Projects<'_, '_>, files: [FileId; 3]) -> (Moved, FunctionId) {
    let (fragments, dropped) = create_function_fragments(files);
    (move_fragments(projects, fragments), dropped)
}

#[test]
fn functions_ascend_by_file_then_definition() {
    with_test_files(|projects, files| {
        let [main, first, second] = files;
        let (moved, _) = move_function_files(projects, files);
        let mut keys_in_order = Vec::new();
        for file in sorted(files) {
            if file == main {
                keys_in_order.push(FunctionKey::ModuleBody(main));
            } else if file == first {
                keys_in_order.extend([1, 0].map(|function| test_function_key(first.0, function)));
            } else {
                keys_in_order.push(test_function_key(second.0, 0));
            }
        }
        let ids: Vec<Option<FunctionId>> = keys_in_order
            .into_iter()
            .map(|key| moved.function_id(key))
            .collect();
        assert_eq!(ids, some_ids([0, 1, 2, 3]));
    });
}

#[test]
fn dropped_function_leaves_no_gap() {
    with_test_files(|projects, files| {
        let first = files[1];
        let (moved, dropped) = move_function_files(projects, files);
        assert_eq!(moved.function_id(test_function_key(first.0, 2)), None);
        assert_eq!(moved.unit_ids(first).functions[dropped.index()], None);
        assert_eq!(moved.counts().functions, 4);
        assert_eq!(moved.functions.len(), 4);
    });
}

#[test]
fn call_names_callee_program_id() {
    with_test_files(|projects, files| {
        let [_, first, second] = files;
        let (moved, _) = move_function_files(projects, files);
        let [caller, callee] = [(second, 0), (first, 0)].map(|(file, function)| {
            let id = moved.function_id(test_function_key(file.0, function));
            id.expect("the function is called")
        });
        let mut callees = references_of(&moved.functions[caller.index()]);
        callees.retain(|reference| matches!(reference, Reference::Function(..)));
        assert_eq!(callees, [call(callee)]);
    });
}

#[test]
fn ignored_definitions_get_no_ids() {
    with_test_files(|projects, [main, first, second]| {
        let layout_key = test_object_type_key(1);
        let mut main_unit = TestUnit::new(main);
        let definers = [first, second].map(|file| {
            let mut unit = TestUnit::new(file);
            let layout = unit.fragment.declare_layout(layout_key);
            unit.fragment
                .define_layout(layout, empty_layout(&layout_key));
            define_function(&mut unit, 0, &[Reference::Layout(layout)]);
            unit.finish()
        });
        let callees = [first, second].map(|file| call(main_unit.declare_function(file, 0)));
        let [first_fragment, second_fragment] = definers;
        let fragments = [
            finish_with_body(main_unit, &callees),
            first_fragment,
            second_fragment,
        ];

        let moved = move_fragments(projects, fragments);

        assert_eq!(moved.layout_id(layout_key), Some(LayoutId::new(0)));
        assert_eq!(moved.counts().layouts, 1);
        assert_eq!(moved.tables.layouts.len(), 1);
        assert_eq!(moved.counts().functions, 3);
    });
}

#[test]
fn synthetic_export_variables_follow_unit_variables() {
    let files = [
        (
            "main.js",
            "import { a, b, c } from './legacy.cjs';\nconsole.log(a, b, c);\n",
        ),
        (
            "legacy.cjs",
            "exports.a = 1;\nexports.b = 2;\nexports.c = 3;\n",
        ),
    ];
    with_projects_without_bun_modules(&files, |projects| {
        let application = ProjectId::Application;
        let [main, legacy] = ["main.js", "legacy.cjs"].map(|name| find_file(projects, name));
        let [a, b, c] = [&b"a"[..], b"b", b"c"].map(|name| {
            VariableKey::SyntheticExport(find_synthetic_export(projects, application, name))
        });
        let mut unit = TestUnit::new(main);
        let read_variables = [
            Reference::Variable(unit.fragment.declare_variable(c)),
            define_variable(&mut unit, 0),
            Reference::Variable(unit.fragment.declare_variable(a)),
            define_variable(&mut unit, 1),
        ];
        unit.fragment.declare_variable(b);

        let moved = move_fragments(projects, [finish_with_body(unit, &read_variables)]);

        let declared_ids =
            [0, 1].map(|symbol| moved.variable_id(test_variable_key(main.0, symbol)));
        assert_eq!(declared_ids, some_ids([0, 1]));
        let context = key_context(projects, application);
        let synthetic_ids =
            [a, b, c].map(|key| moved.program_variable_id(context.variable_key(key)));
        let [a_id, c_id] = [2, 3].map(VariableId::new);
        assert_eq!(synthetic_ids, [Some(a_id), None, Some(c_id)]);
        assert_eq!(moved.counts().variables, 4);

        let exporter = moved.module_id(application_file(legacy));
        let strings = &moved.numbered.strings;
        for (id, expected_name) in [(a_id, b"a"), (c_id, b"c")] {
            let variable = &moved.tables.variables[id.index()];
            let name = variable.name.map(|name| strings.get(name));
            assert_eq!(name, Some(&expected_name[..]));
            assert_eq!(Some(variable.module), exporter);
            assert_eq!(variable.initialization, VariableInitialization::Undefined);
        }
    });
}

#[test]
fn dropped_records_leave_no_gap() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let sites = [10, 11].map(|position| add_type_site(&mut unit, position));
        let scopes = [ECMAMode::Strict, ECMAMode::Sloppy]
            .map(|mode| unit.fragment.add_eval_scope(create_eval_scope(mode)));
        let expected_results = [TypeTable::NUMBER, TypeTable::STRING].map(|ty| {
            unit.fragment.add_expected_result(ExpectedResult {
                ty,
                ..ExpectedResult::default()
            })
        });
        let records = [None, Some(unit.module)].map(|module| {
            unit.fragment.add_data(Data {
                module,
                ..Data::default()
            })
        });
        let names_of = |index: usize| {
            [
                Reference::TypeSite(sites[index]),
                Reference::EvalScope(scopes[index]),
                Reference::ExpectedResult(expected_results[index]),
                Reference::Data(records[index]),
            ]
        };
        define_function(&mut unit, 0, &names_of(0));

        let moved = move_fragments(projects, [finish_with_body(unit, &names_of(1))]);

        let ids = moved.unit_ids(main);
        assert_eq!(ids.type_sites, [None, Some(TypeSiteId::new(0))]);
        assert_eq!(ids.eval_scopes, [None, Some(EvalScopeId::new(0))]);
        assert_eq!(ids.expected_results, [None, Some(ExpectedResultId::new(0))]);
        assert_eq!(ids.data, [None, Some(DataId::new(0))]);
        let counts = moved.counts();
        let record_counts = [
            counts.type_sites,
            counts.eval_scopes,
            counts.expected_results,
            counts.data,
        ];
        assert_eq!(record_counts, [1; 4]);

        let tables = &moved.tables;
        let entry_module = moved.module_id(application_file(main));
        let [site] = tables.type_sites.as_slice() else {
            panic!("{:?}", tables.type_sites);
        };
        assert_eq!((site.position, Some(site.module)), (11, entry_module));
        assert_eq!(tables.eval_scopes, [create_eval_scope(ECMAMode::Sloppy)]);
        let [expected] = tables.expected_results.as_slice() else {
            panic!("{:?}", tables.expected_results);
        };
        assert_eq!(expected.ty, TypeTable::STRING);
        let [data] = tables.data.as_slice() else {
            panic!("{:?}", tables.data);
        };
        assert_eq!(data.module, entry_module);
    });
}

#[test]
fn records_of_later_units_continue_the_count() {
    with_test_files(|projects, [main, first, _]| {
        let mut first_unit = TestUnit::new(first);
        let first_site = add_type_site(&mut first_unit, first.0);
        define_function(&mut first_unit, 0, &[Reference::TypeSite(first_site)]);
        let mut main_unit = TestUnit::new(main);
        let main_site = add_type_site(&mut main_unit, main.0);
        let callee = main_unit.declare_function(first, 0);
        let names = [Reference::TypeSite(main_site), call(callee)];
        let fragments = [first_unit.finish(), finish_with_body(main_unit, &names)];

        let moved = move_fragments(projects, fragments);

        let positions = moved.tables.type_sites.iter().map(|site| site.position);
        assert!(positions.eq(sorted([main, first]).map(|file| file.0)));
        let caller = moved.function_id(FunctionKey::ModuleBody(main));
        let caller = caller.expect("the entry point is evaluated");
        let main_site = moved.unit_ids(main).type_sites[main_site.index()];
        let main_site = Reference::TypeSite(main_site.expect("the body names the site"));
        assert!(references_of(&moved.functions[caller.index()]).contains(&main_site));
    });
}

#[test]
fn class_follows_base() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let base = unit.fragment.declare_layout(test_class_key(main.0, 1));
        let class = add_class(&mut unit, 0, Some(base));
        add_class(&mut unit, 1, None);

        let moved = move_fragments(
            projects,
            [finish_with_body(unit, &[Reference::Layout(class)])],
        );

        let ids = [1, 0].map(|class| moved.layout_id(test_class_key(main.0, class)));
        assert_eq!(ids, some_ids([0, 1]));
        assert_eq!(moved.tables.layouts[1].base, Some(LayoutId::new(0)));
    });
}

#[test]
fn empty_layouts_ascend_by_key() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let class = add_class(&mut unit, 0, None);
        let mut names = vec![Reference::Layout(class)];
        for identity in (0..16).rev() {
            let layout = unit.fragment.declare_layout(test_object_type_key(identity));
            names.push(Reference::Type(
                unit.fragment.types.intern(Type::layout(layout)),
            ));
        }

        let moved = move_fragments(projects, [finish_with_body(unit, &names)]);

        assert_eq!(
            moved.layout_id(test_class_key(main.0, 0)),
            Some(LayoutId::new(0))
        );
        for (identity, index) in (0..16).zip(1..) {
            let key = test_object_type_key(identity);
            assert_eq!(moved.layout_id(key), Some(LayoutId::new(index)));
            assert_eq!(moved.tables.layouts[index], empty_layout(&key));
        }
    });
}

#[test]
fn supertype_edges_do_not_order_layouts() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let layout = add_class(&mut unit, 0, None);
        let base = add_class(&mut unit, 1, None);
        let supertype = add_class(&mut unit, 2, Some(base));
        unit.fragment.add_supertype(layout, supertype);

        let fragment = finish_with_body(unit, &[Reference::Layout(layout)]);
        let moved = move_fragments(projects, [fragment]);

        let ids = [0, 1, 2].map(|class| moved.layout_id(test_class_key(main.0, class)));
        assert_eq!(ids, some_ids([0, 1, 2]));
    });
}

#[test]
fn supertypes_ascend_by_program_id() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let class = add_class(&mut unit, 0, None);
        let supertypes = [3, 2, 1, 0]
            .map(|identity| unit.fragment.declare_layout(test_object_type_key(identity)));
        for supertype in supertypes {
            unit.fragment.add_supertype(class, supertype);
        }
        unit.fragment.add_supertype(supertypes[0], supertypes[1]);

        let moved = move_fragments(
            projects,
            [finish_with_body(unit, &[Reference::Layout(class)])],
        );

        let layouts = &moved.tables.layouts;
        assert_eq!(layouts[0].supertypes, [1, 2, 3, 4].map(LayoutId::new));
        assert_eq!(layouts[4].supertypes, [LayoutId::new(3)]);
    });
}

#[test]
fn members_without_layout_are_flagged_up_to_the_supertypes() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let class = add_class(&mut unit, 0, None);
        let other_class = add_class(&mut unit, 1, None);
        let supertype = unit.fragment.declare_layout(test_object_type_key(0));
        unit.fragment.add_supertype(class, supertype);
        unit.fragment
            .family_facts
            .layouts_with_members_without_layout
            .push(class);

        let names = [class, other_class].map(Reference::Layout);
        let moved = move_fragments(projects, [finish_with_body(unit, &names)]);

        let keys = [
            test_class_key(main.0, 0),
            test_class_key(main.0, 1),
            test_object_type_key(0),
        ];
        let is_flagged = keys.map(|key| {
            let id = moved.layout_id(key).expect("the layout is kept");
            let flags = moved.tables.layouts[id.index()].flags;
            flags.contains(LayoutFlags::HAS_MEMBERS_WITHOUT_LAYOUT)
        });
        assert_eq!(is_flagged, [true, false, true]);
    });
}

#[test]
fn function_types_ascend_by_program_id() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let function = define_function(&mut unit, 0, &[]);
        let keys = [
            signature_key(main, 1),
            class_signature_key(main, 0),
            signature_key(main, 2),
        ];
        let [first, second, unnamed] = keys.map(|key| define_function_type(&mut unit, key));
        unit.fragment.add_function_type_edge(function, second);
        unit.fragment.add_function_type_edge(function, first);
        unit.fragment.add_function_type_edge(first, second);
        unit.fragment.add_function_type_edge(unnamed, first);

        let moved = move_fragments(projects, [finish_with_body(unit, &[call(function)])]);

        let [function, first, second] = [test_function_key(main.0, 0), keys[0], keys[1]]
            .map(|key| moved.function_id(key).expect("the function is kept"));
        assert_eq!(moved.function_id(keys[2]), None);
        assert!(first < second);
        let functions = &moved.functions;
        assert_eq!(functions[function.index()].function_types, [first, second]);
        assert_eq!(functions[first.index()].function_types, [second]);
        assert!(functions[second.index()].function_types.is_empty());
    });
}

#[test]
fn type_keeps_its_function_type_and_no_member() {
    with_test_files(|projects, [main, ..]| {
        let mut unit = TestUnit::new(main);
        let member = define_function(&mut unit, 0, &[]);
        let key = signature_key(main, 1);
        let function_type = define_function_type(&mut unit, key);
        unit.fragment.add_function_type_edge(member, function_type);
        let ty = unit.fragment.types.intern(Type::function(function_type));

        let moved = move_fragments(projects, [finish_with_body(unit, &[Reference::Type(ty)])]);

        assert!(moved.function_id(key).is_some());
        assert_eq!(moved.function_id(test_function_key(main.0, 0)), None);
    });
}

#[test]
fn module_named_by_dropped_function_has_an_id() {
    with_test_files(|projects, files| {
        let [main, first, second] = files;
        let mut unit = TestUnit::new(main);
        let [retained, dropped] = [first, second].map(|file| {
            let module = unit.fragment.declare_module(ModuleRef::File(file));
            Reference::Module(module, ModuleReferenceKind::Target)
        });
        define_function(&mut unit, 0, &[dropped]);

        let moved = move_fragments(projects, [finish_with_body(unit, &[retained])]);

        let module_ids = files.map(|file| moved.module_id(application_file(file)));
        assert!(module_ids.iter().all(Option::is_some));
        assert_eq!(moved.unit_ids(main).modules, module_ids);

        let numbering = &moved.numbered.numbering;
        let ids = numbering.modules.iter().flatten().copied();
        assert!(ids.eq((0..numbering.counts.modules).map(ModuleId::new)));
    });
}

#[test]
fn application_ids_precede_runtime_ids() {
    with_projects(&[("main.js", "import 'node:path';\n")], |projects| {
        let files = [
            application_file(find_file(projects, "main.js")),
            path_source(projects),
        ];
        let units = files.map(|file| {
            let mut unit = TestUnit::new(file.file);
            let names = [
                Reference::Layout(add_class(&mut unit, 0, None)),
                define_variable(&mut unit, 0),
            ];
            unit_in(projects, file.project, finish_with_body(unit, &names))
        });
        let [application_unit, runtime_unit] = units;

        let moved = move_units(projects, vec![runtime_unit, application_unit]);

        let function_ids = files.map(|file| {
            moved.program_function_id(key_in(file.project, FunctionKey::ModuleBody(file.file)))
        });
        assert_eq!(function_ids, some_ids([0, 1]));
        let layout_ids = files.map(|file| {
            moved.program_layout_id(key_in(file.project, test_class_key(file.file.0, 0)))
        });
        assert_eq!(layout_ids, some_ids([0, 1]));
        let variable_ids = files.map(|file| {
            let key = key_in(file.project, test_variable_key(file.file.0, 0));
            moved.program_variable_id(ProgramVariableKey::Declared(key))
        });
        assert_eq!(variable_ids, some_ids([0, 1]));
        let [application_module, runtime_module] = files.map(|file| moved.module_id(file));
        assert!(application_module.is_some());
        assert!(application_module < runtime_module);
    });
}

#[test]
fn task_order_does_not_change_ids() {
    with_test_files(|projects, files| {
        let (fragments, _) = create_function_fragments(files);
        let units = fragments.map(|fragment| unit_in(projects, ProjectId::Application, fragment));
        let Numbered {
            prepared,
            retained,
            numbering,
            ..
        } = number_units(units.into(), projects);
        let unit_ids = &numbering.units;
        let merged = prepared.merged(&reverse);
        let in_reverse = number_program(&merged, &prepared.definitions, &retained);
        assert_eq!(in_reverse.counts, numbering.counts);
        assert_eq!(in_reverse.functions, numbering.functions);
        assert_eq!(in_reverse.modules, numbering.modules);
        for (reversed, ids) in in_reverse.units.iter().zip(unit_ids) {
            assert_eq!(reversed.functions, ids.functions);
            assert_eq!(reversed.layouts, ids.layouts);
            assert_eq!(reversed.variables, ids.variables);
            assert_eq!(reversed.modules, ids.modules);
            assert_eq!(reversed.module_failures, ids.module_failures);
        }
    });
}

fn number_without_units(
    variables: &MergedKeys<ProgramVariableKey>,
    retained: &Retained,
) -> Numbering {
    let definitions = Definitions {
        functions: Vec::new(),
        layouts: Vec::new(),
        other_layout_definitions: Vec::new(),
        variables: vec![None; variables.keys.len()],
        supertypes: SupertypeEdges {
            starts: vec![0],
            supertypes: Vec::new(),
        },
        function_types: SupertypeEdges {
            starts: vec![0],
            supertypes: Vec::new(),
        },
        builtin_members: Vec::new(),
        has_members_without_layout: Vec::new(),
        conversions_outside_family: Vec::new(),
        runtime_functions: Vec::new(),
    };
    let modules = ModuleTable {
        modules: Vec::new(),
        index_by_module: Default::default(),
        unit_by_module: Vec::new(),
    };
    let merged = MergedUnits {
        units: &[],
        modules: &modules,
        functions: &merge_keys(&[], &forward),
        layouts: &merge_keys(&[], &forward),
        variables,
        in_parallel: &forward,
    };
    number_program(&merged, &definitions, retained)
}

fn retain_variables(variables: Vec<bool>) -> Retained {
    Retained {
        functions: Vec::new(),
        layouts: Vec::new(),
        variables,
        module_failures: PerProject::default(),
        units: Vec::new(),
    }
}

#[test]
fn shared_synthetic_export_is_numbered_once() {
    let module = ProgramModule::Runtime(RuntimeModule::NodeBuffer);
    let [shared, own, unread] = [7, 8, 9].map(|name| ProgramVariableKey::SyntheticExport {
        module,
        name: Atom(name),
    });
    let synthetic_exports = KeyList::new(vec![shared, unread, own, shared]);
    let variables = merge_keys(&[&synthetic_exports], &forward);
    let is_retained = variables.keys.iter().map(|&key| key != unread);

    let numbering = number_without_units(&variables, &retain_variables(is_retained.collect()));

    let ids = [shared, own, unread].map(|key| {
        let merged = variables.find(&key).expect("the key is listed");
        numbering.variables[merged as usize]
    });
    assert_eq!(
        ids,
        [Some(VariableId::new(0)), Some(VariableId::new(1)), None]
    );
    assert_eq!(numbering.counts.variables, 2);
}

#[test]
fn failures_are_numbered_over_both_projects() {
    let variables = merge_keys(&[&KeyList::new(Vec::new())], &forward);
    let retained = Retained {
        module_failures: PerProject {
            application: vec![false, true],
            runtime: vec![true, false, true],
        },
        ..retain_variables(Vec::new())
    };

    let numbering = number_without_units(&variables, &retained);

    let [first, second, third] = [0, 1, 2].map(|index| Some(ModuleFailureId::new(index)));
    assert_eq!(numbering.module_failures.application, [None, first]);
    assert_eq!(numbering.module_failures.runtime, [second, None, third]);
    assert_eq!(numbering.counts.module_failures, 3);
}
