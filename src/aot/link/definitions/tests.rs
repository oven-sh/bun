use super::*;
use crate::builtins::RuntimeFunction;
use crate::ir::generated::FieldFlags;
use crate::ir::{FunctionKey, PropertyKeyId};
use crate::link::program_keys::ProgramModule;
use crate::link::testing::{
    COMMON_JS_IMPORTER, Prepared, Projects, SHARED_NAME_IMPORTERS, application_file,
    create_runtime_function, define_test_function, find_file, find_synthetic_export,
    in_application, key_in, link_sources_without_bun_modules, path_source, prepare, reverse,
    test_class_key, test_function_key, test_object_type_key, test_variable_key, unit_in,
    with_projects, with_projects_without_bun_modules, with_test_files,
};
use crate::lower::{Fragment, FragmentBuilder, ModuleFragment};
use crate::modules::ModuleRef;
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{FunctionRef, ObjectOrigin, TypeIdentity};
use bun_sema::hir::FnId;
use bun_sema::program::{FileId, Sym};

type Conflict = (ProgramKey, [ProgramFile; 2]);

fn definition_conflicts(errors: &[LinkError]) -> Vec<Conflict> {
    let conflicts = errors.iter().map(|error| match error {
        LinkError::ConflictingDefinitions { key, files } => (*key, *files),
        other => panic!("{other:?}"),
    });
    conflicts.collect()
}

fn finish(fragment: FragmentBuilder) -> Fragment {
    fragment.finish(ModuleFragment::default())
}

fn prepare_fragments<const COUNT: usize>(
    projects: &Projects<'_, '_>,
    fragments: [Fragment; COUNT],
) -> Prepared {
    let units = fragments.map(|fragment| unit_in(projects, ProjectId::Application, fragment));
    prepare(units.into(), projects)
}

fn function_site(prepared: &Prepared, key: ProgramFunctionKey) -> Option<DefinitionSite> {
    let merged = prepared.functions.find(&key);
    prepared.definitions.functions[merged.expect("no unit declares the function") as usize]
}

fn layout_site(prepared: &Prepared, key: ProgramLayoutKey) -> Option<DefinitionSite> {
    let merged = prepared.layouts.find(&key);
    prepared.definitions.layouts[merged.expect("no unit declares the layout") as usize]
}

fn variable_definition(prepared: &Prepared, key: ProgramVariableKey) -> Option<VariableDefinition> {
    let merged = prepared.variables.find(&key);
    prepared.definitions.variables[merged.expect("nothing declares the variable") as usize]
}

fn defining_file(prepared: &Prepared, site: Option<DefinitionSite>) -> Option<ProgramFile> {
    site.map(|site| file_of(&prepared.units, site))
}

fn define_function(fragment: &mut FragmentBuilder, key: FunctionKey) {
    define_test_function(fragment, key, ModuleId::default(), |_| {});
}

fn define_layout(fragment: &mut FragmentBuilder, key: LayoutKey) {
    let id = fragment.declare_layout(key);
    fragment.define_layout(id, empty_layout(&key));
}

fn define_variable(fragment: &mut FragmentBuilder, key: VariableKey) {
    let name = fragment.strings.intern(b"x");
    let id = fragment.declare_variable(key);
    let variable = synthetic_export_variable(name, ModuleId::default(), ExportWriter::Loader);
    fragment.define_variable(id, variable);
}

fn function_fragment(file: FileId, key: FunctionKey) -> Fragment {
    let mut fragment = FragmentBuilder::new(key.home_file());
    define_function(&mut fragment, key);
    Fragment {
        file,
        ..finish(fragment)
    }
}

fn layout_fragment(file: FileId, key: LayoutKey) -> Fragment {
    let mut fragment = FragmentBuilder::new(file);
    define_layout(&mut fragment, key);
    finish(fragment)
}

fn variable_fragment(file: FileId, key: VariableKey) -> Fragment {
    let mut fragment = FragmentBuilder::new(file);
    define_variable(&mut fragment, key);
    finish(fragment)
}

fn synthetic_key(
    projects: &Projects<'_, '_>,
    project: ProjectId,
    name: &[u8],
) -> ProgramVariableKey {
    let id = find_synthetic_export(projects, project, name);
    key_context(projects, project).variable_key(VariableKey::SyntheticExport(id))
}

#[test]
fn home_definition_is_chosen() {
    with_test_files(|projects, [_, home, caller]| {
        let key = test_function_key(home.0, 0);
        let mut caller_fragment = FragmentBuilder::new(caller);
        caller_fragment.declare_function(key);
        let fragments = [function_fragment(home, key), finish(caller_fragment)];
        let prepared = prepare_fragments(projects, fragments);
        assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
        let site = function_site(&prepared, in_application(key));
        assert_eq!(defining_file(&prepared, site), Some(application_file(home)));
    });
}

#[test]
fn definitions_in_two_files_conflict() {
    with_test_files(|projects, [_, home, other]| {
        let key = test_function_key(home.0, 0);
        let fragments = [function_fragment(home, key), function_fragment(other, key)];
        let prepared = prepare_fragments(projects, fragments);
        let files = [home, other].map(application_file);
        let conflict = (ProgramKey::Function(in_application(key)), files);
        assert_eq!(definition_conflicts(&prepared.errors), [conflict]);
        let site = function_site(&prepared, in_application(key));
        assert_eq!(defining_file(&prepared, site), Some(application_file(home)));
    });
}

#[test]
fn definition_outside_home_file_is_ignored() {
    with_test_files(|projects, [_, home, other]| {
        let key = test_function_key(home.0, 0);
        let prepared = prepare_fragments(projects, [function_fragment(other, key)]);
        let files = [home, other].map(application_file);
        let conflict = (ProgramKey::Function(in_application(key)), files);
        assert_eq!(definition_conflicts(&prepared.errors), [conflict]);
        assert_eq!(function_site(&prepared, in_application(key)), None);
    });
}

#[test]
fn second_definition_in_one_file_conflicts() {
    with_test_files(|projects, [_, home, _]| {
        let key = test_function_key(home.0, 0);
        let mut fragment = function_fragment(home, key);
        fragment.functions.push(fragment.functions[0].clone());
        let prepared = prepare_fragments(projects, [fragment]);
        let files = [application_file(home); 2];
        let conflict = (ProgramKey::Function(in_application(key)), files);
        assert_eq!(definition_conflicts(&prepared.errors), [conflict]);
        let first_site = DefinitionSite { unit: 0, index: 0 };
        assert_eq!(
            function_site(&prepared, in_application(key)),
            Some(first_site)
        );
    });
}

#[test]
fn variables_are_defined_at_home_only() {
    with_test_files(|projects, [_, home, other]| {
        let key = test_variable_key(home.0, 0);
        let fragments = [variable_fragment(home, key), variable_fragment(other, key)];
        let prepared = prepare_fragments(projects, fragments);
        let program_key = ProgramVariableKey::Declared(in_application(key));
        let files = [home, other].map(application_file);
        let conflict = (ProgramKey::Variable(program_key), files);
        assert_eq!(definition_conflicts(&prepared.errors), [conflict]);
        let Some(VariableDefinition::Unit(site)) = variable_definition(&prepared, program_key)
        else {
            panic!("the home unit defines the variable");
        };
        assert_eq!(file_of(&prepared.units, site), application_file(home));
    });
}

#[test]
fn declaring_files_layout_stands() {
    with_test_files(|projects, [_, first, second]| {
        for (home, importer) in [(first, second), (second, first)] {
            let key = test_class_key(home.0, 0);
            let fragments = [layout_fragment(importer, key), layout_fragment(home, key)];
            let prepared = prepare_fragments(projects, fragments);
            assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
            let site = layout_site(&prepared, in_application(key));
            assert_eq!(defining_file(&prepared, site), Some(application_file(home)));
        }
    });
}

#[test]
fn first_unit_stands_without_home_definition() {
    with_test_files(|projects, [main, first, second]| {
        let lowest_file = application_file(first.min(second));
        for key in [test_object_type_key(1), test_class_key(main.0, 0)] {
            let fragments = [layout_fragment(second, key), layout_fragment(first, key)];
            let prepared = prepare_fragments(projects, fragments);
            assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
            let site = layout_site(&prepared, in_application(key));
            assert_eq!(defining_file(&prepared, site), Some(lowest_file), "{key:?}");
        }
    });
}

fn object_type(identity: u64) -> ObjectTypeKey {
    ObjectTypeKey {
        origin: ObjectOrigin::Computed,
        identity: TypeIdentity([identity, 0]),
        is_checked: true,
    }
}

fn plain_layout_fragment(
    file: FileId,
    key: LayoutKey,
    types: &[Option<ObjectTypeKey>],
) -> Fragment {
    let mut fragment = FragmentBuilder::new(file);
    let id = fragment.declare_layout(key);
    for &ty in types {
        fragment.define_object_type(id, empty_layout(&key), ty.map(|ty| (ty, 0)));
    }
    finish(fragment)
}

#[test]
fn what_is_said_again_of_a_type_is_dropped() {
    with_test_files(|projects, [main, first, _]| {
        let key = test_object_type_key(1);
        let (earlier, later) = (main.min(first), main.max(first));
        let [one, two, three] = [1, 2, 3].map(|identity| Some(object_type(identity)));
        let prepared = prepare_fragments(
            projects,
            [
                plain_layout_fragment(earlier, key, &[one, two]),
                plain_layout_fragment(later, key, &[two, three, one, None, None]),
            ],
        );

        let site = |unit, index| DefinitionSite { unit, index };
        assert_eq!(
            layout_site(&prepared, in_application(key)),
            Some(site(0, 0))
        );
        let merged = prepared.layouts.find(&in_application(key)).unwrap();
        let others = prepared.definitions.other_definitions_of(merged).iter();
        let others: Vec<DefinitionSite> = others.map(|&(_, site)| site).collect();
        assert_eq!(others, [site(0, 1), site(1, 1), site(1, 3), site(1, 4)]);
        assert!(prepared.definitions.is_other_definition(merged, site(1, 1)));
        assert!(!prepared.definitions.is_other_definition(merged, site(1, 0)));
    });
}

#[test]
fn literals_written_alike_in_two_files_are_two_types() {
    let types = "export interface Context { n: number }\nexport interface Module { call: (done: () => void, context: Context) => Promise<number> }\nexport interface Command { name: string; load: () => Promise<Module> }\n";
    let command = "import type { Command } from './types';\nexport const command: Command = {\n  name: 'x',\n  load: () => Promise.resolve({ async call(done, context) { done(); return context.n + 1; } }),\n};\n";
    let main = "import { command as one } from './one';\nimport { command as two } from './two';\nexport const commands = [one, two];\n";
    let files = [
        ("main.ts", main),
        ("one.ts", command),
        ("two.ts", command),
        ("types.ts", types),
    ];
    let linked = link_sources_without_bun_modules(&files).expect("the program links");
    let program = &linked.program;
    let is_call = |key: PropertyKeyId| {
        let text = program.property_keys.get(key).text;
        text.is_some_and(|text| program.strings.get(text) == b"call")
    };
    let methods = program
        .layouts
        .iter()
        .flat_map(|layout| &layout.fields)
        .filter(|field| {
            field.key.is_some_and(is_call) && field.flags.contains(FieldFlags::IS_METHOD)
        });
    let function_counts: Vec<usize> = methods
        .map(|field| program.types.get(field.declared.ty).functions.len())
        .collect();
    assert_eq!(function_counts, [2]);
}

#[test]
fn declared_layout_without_definition_has_no_site() {
    with_test_files(|projects, [main, ..]| {
        let key = test_object_type_key(1);
        let mut fragment = FragmentBuilder::new(main);
        fragment.declare_layout(key);
        let prepared = prepare_fragments(projects, [finish(fragment)]);
        assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
        assert_eq!(layout_site(&prepared, in_application(key)), None);
    });
}

#[test]
fn equal_keys_of_two_projects_do_not_conflict() {
    with_test_files(|projects, [main, ..]| {
        let function = test_function_key(main.0, 0);
        let layout = test_class_key(main.0, 0);
        let variable = test_variable_key(main.0, 0);
        let units = ProjectId::ALL.map(|project| {
            let mut fragment = FragmentBuilder::new(main);
            define_function(&mut fragment, function);
            define_layout(&mut fragment, layout);
            define_variable(&mut fragment, variable);
            unit_in(projects, project, finish(fragment))
        });
        let prepared = prepare(units.into(), projects);
        assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
        for project in ProjectId::ALL {
            let file = Some(ProgramFile {
                project,
                file: main,
            });
            let site = function_site(&prepared, key_in(project, function));
            assert_eq!(defining_file(&prepared, site), file);
            let site = layout_site(&prepared, key_in(project, layout));
            assert_eq!(defining_file(&prepared, site), file);
            let variable_key = ProgramVariableKey::Declared(key_in(project, variable));
            let Some(VariableDefinition::Unit(site)) = variable_definition(&prepared, variable_key)
            else {
                panic!("each project defines its variable");
            };
            assert_eq!(Some(file_of(&prepared.units, site)), file);
        }
    });
}

#[test]
fn only_link_defines_synthetic_exports() {
    with_projects_without_bun_modules(&COMMON_JS_IMPORTER, |projects| {
        let main = find_file(projects, "main.js");
        let id = find_synthetic_export(projects, ProjectId::Application, b"a");
        let fragment = variable_fragment(main, VariableKey::SyntheticExport(id));
        let prepared = prepare_fragments(projects, [fragment]);

        let defined_key = synthetic_key(projects, ProjectId::Application, b"a");
        let conflict = (
            ProgramKey::Variable(defined_key),
            [application_file(main); 2],
        );
        assert_eq!(definition_conflicts(&prepared.errors), [conflict]);

        let exporter = ProgramModule::File(application_file(find_file(projects, "legacy.cjs")));
        let atoms = &projects.application.loaded.files().atoms;
        for name in [b"a", b"b"] {
            let key = synthetic_key(projects, ProjectId::Application, name);
            let definition = VariableDefinition::SyntheticExport {
                module: prepared.modules.index_of(exporter),
                name: atoms.intern(name),
                is_known_member: false,
                writer: ExportWriter::Body,
            };
            assert_eq!(variable_definition(&prepared, key), Some(definition));
        }
    });
}

#[test]
fn copy_is_defined_where_the_file_has_a_face() {
    let files = [
        (
            "main.js",
            "import { a } from './legacy.cjs';\nconsole.log(a);\n",
        ),
        ("legacy.cjs", "exports.a = 1;\n"),
    ];
    with_projects_without_bun_modules(&files, |projects| {
        let [main, legacy] = ["main.js", "legacy.cjs"].map(|name| find_file(projects, name));
        let id = find_synthetic_export(projects, ProjectId::Application, b"a");
        let context = key_context(projects, ProjectId::Application);
        let copy = context.variable_key(VariableKey::Copy(id));
        assert_ne!(copy, context.variable_key(VariableKey::SyntheticExport(id)));
        assert!(synthetic_export_keys(projects).keys.contains(&copy));

        let declare = |face: Option<ModuleRef>| {
            let mut fragment = FragmentBuilder::new(main);
            fragment.declare_variable(VariableKey::Copy(id));
            if let Some(face) = face {
                fragment.declare_module(face);
            }
            prepare_fragments(projects, [finish(fragment)])
        };
        let has_face = projects
            .application
            .graph
            .face(ModuleRef::File(legacy))
            .is_some();
        if !has_face {
            assert_eq!(variable_definition(&declare(None), copy), None);
        }

        let prepared = declare(Some(ModuleRef::Face(legacy)));
        let face = ProgramModule::Face(application_file(legacy));
        let definition = VariableDefinition::SyntheticExport {
            module: prepared.modules.index_of(face),
            name: projects.application.loaded.files().atoms.intern(b"a"),
            is_known_member: false,
            writer: ExportWriter::Face,
        };
        assert_eq!(variable_definition(&prepared, copy), Some(definition));
    });
}

#[test]
fn synthetic_export_keys_list_application_before_runtime() {
    with_projects(&SHARED_NAME_IMPORTERS, |projects| {
        let keys = synthetic_export_keys(projects).keys;
        let [application_count, runtime_count] =
            ProjectId::ALL.map(|project| projects.get(project).graph.synthetic_exports().len());
        assert_eq!(keys.len(), application_count + runtime_count);

        let shared = synthetic_key(projects, ProjectId::Application, b"shared");
        let own = synthetic_key(projects, ProjectId::Runtime, b"own");
        let (application_keys, runtime_keys) = keys.split_at(application_count);
        assert!(application_keys.contains(&shared));
        assert!(!application_keys.contains(&own));
        assert!(runtime_keys.contains(&shared));
        assert!(runtime_keys.contains(&own));
    });
}

#[test]
fn synthetic_export_of_two_projects_is_one_variable() {
    with_projects(&SHARED_NAME_IMPORTERS, |projects| {
        let prepared = prepare(Vec::new(), projects);
        assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
        let shared = synthetic_key(projects, ProjectId::Application, b"shared");
        assert_eq!(
            synthetic_key(projects, ProjectId::Runtime, b"shared"),
            shared
        );

        let name = projects.application.loaded.files().atoms.intern(b"shared");
        let exporter = ProgramModule::File(path_source(projects));
        let definition = VariableDefinition::SyntheticExport {
            module: prepared.modules.index_of(exporter),
            name,
            is_known_member: false,
            writer: ExportWriter::Loader,
        };
        assert_eq!(variable_definition(&prepared, shared), Some(definition));
        let definitions = prepared.definitions.variables.iter();
        assert_eq!(
            definitions
                .filter(|&&other| other == Some(definition))
                .count(),
            1
        );
    });
}

#[test]
fn name_required_by_one_project_is_tested_at_run_time() {
    let files = [
        SHARED_NAME_IMPORTERS[0],
        (
            "/$bun/js/node/punycode.ts",
            "import * as path from 'node:path';\nexport default [path.shared, path.optional];\n",
        ),
    ];
    with_projects(&files, |projects| {
        let is_known_in = |project, name: &[u8]| {
            let id = find_synthetic_export(projects, project, name);
            projects
                .get(project)
                .graph
                .synthetic_export(id)
                .is_known_member
        };
        assert!(!is_known_in(ProjectId::Application, b"shared"));
        assert!(is_known_in(ProjectId::Runtime, b"shared"));
        assert!(is_known_in(ProjectId::Runtime, b"optional"));

        let prepared = prepare(Vec::new(), projects);
        let is_known = |name: &[u8]| {
            let key = synthetic_key(projects, ProjectId::Runtime, name);
            match variable_definition(&prepared, key) {
                Some(VariableDefinition::SyntheticExport {
                    is_known_member, ..
                }) => is_known_member,
                other => panic!("{other:?}"),
            }
        };
        assert!(!is_known(b"shared"));
        assert!(is_known(b"optional"));
    });
}

fn edge_fragment(file: FileId, edges: &[(LayoutKey, LayoutKey)]) -> Fragment {
    let mut fragment = FragmentBuilder::new(file);
    for &(layout, supertype) in edges {
        let layout = fragment.declare_layout(layout);
        let supertype = fragment.declare_layout(supertype);
        fragment.add_supertype(layout, supertype);
    }
    finish(fragment)
}

fn choose_in_reverse(prepared: &Prepared, projects: &Projects<'_, '_>) -> Definitions {
    let (merged, beside) = (
        prepared.merged(&reverse),
        &crate::link::run_one_after_the_other,
    );
    let mut errors = Vec::new();
    let definitions = choose_definitions(&merged, projects, beside, &mut errors);
    assert!(errors.is_empty(), "{errors:?}");
    definitions
}

#[test]
fn supertype_edges_of_all_units_are_united() {
    with_test_files(|projects, [_, first, second]| {
        let [a, b, c] = [1, 2, 3].map(test_object_type_key);
        let fragments = [
            edge_fragment(first, &[(a, c), (a, b)]),
            edge_fragment(second, &[(a, b)]),
        ];
        let prepared = prepare_fragments(projects, fragments);
        let find = |key| prepared.layouts.find(&in_application(key));
        let [a, b, c] = [a, b, c].map(|key| find(key).expect("a unit declares the layout"));
        let reversed = choose_in_reverse(&prepared, projects);
        for supertypes in [&prepared.definitions.supertypes, &reversed.supertypes] {
            assert_eq!(supertypes.of(a), [b.min(c), b.max(c)]);
            assert!(supertypes.of(b).is_empty());
            assert!(supertypes.of(c).is_empty());
        }
    });
}

fn runtime_function_fragment(file: FileId, ids: &[u32]) -> Fragment {
    let mut fragment = FragmentBuilder::new(file);
    for (index, &id) in (0..).zip(ids) {
        let function = fragment.declare_function(test_function_key(file.0, index));
        fragment.add_runtime_function(create_runtime_function(id, function));
    }
    finish(fragment)
}

#[test]
fn two_functions_of_one_runtime_id_conflict() {
    with_test_files(|projects, [_, first, second]| {
        let (low, high) = (first.min(second), first.max(second));
        let fragments = [
            runtime_function_fragment(high, &[5]),
            runtime_function_fragment(low, &[5, 7]),
        ];
        let prepared = prepare_fragments(projects, fragments);
        let [LinkError::ConflictingRuntimeFunctions { function, files }] =
            prepared.errors.as_slice()
        else {
            panic!("{:?}", prepared.errors);
        };
        assert_eq!(*function, RuntimeFunction(5));
        assert_eq!(*files, [low, high].map(application_file));

        let roots = &prepared.definitions.runtime_functions;
        let ids: Vec<RuntimeFunction> = roots.iter().map(|root| root.entry.id).collect();
        assert_eq!(ids, [5, 7].map(RuntimeFunction));
        assert!(roots.iter().all(|root| root.file == application_file(low)));
    });
}

#[test]
fn runtime_functions_are_sorted_by_id() {
    with_test_files(|projects, [_, first, second]| {
        let fragments = [
            runtime_function_fragment(first, &[9, 2]),
            runtime_function_fragment(second, &[5]),
        ];
        let prepared = prepare_fragments(projects, fragments);
        assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
        let expected_roots = [(2, first, 1), (5, second, 0), (9, first, 0)];
        let roots = &prepared.definitions.runtime_functions;
        assert_eq!(roots.len(), expected_roots.len());
        for (root, (id, file, function)) in roots.iter().zip(expected_roots) {
            assert_eq!(root.entry.id, RuntimeFunction(id));
            assert_eq!(root.file, application_file(file));
            let key = in_application(test_function_key(file.0, function));
            assert_eq!(Some(root.function), prepared.functions.find(&key));
        }
    });
}

#[test]
fn empty_layout_has_kind_of_its_key() {
    let file = FileId(1);
    let function = FunctionRef {
        file,
        function: FnId(0),
    };
    let symbol = Sym {
        file,
        id: SymbolId(0),
    };
    let untyped_literal = LayoutKey::UntypedLiteral {
        file,
        members: TypeIdentity([1, 0]),
    };
    let environment = LayoutKey::Environment {
        file,
        environment: 0,
    };
    let kinds = [
        (test_object_type_key(1), LayoutKind::Record),
        (untyped_literal, LayoutKind::Record),
        (LayoutKey::Container(symbol), LayoutKind::Container),
        (test_class_key(1, 0), LayoutKind::Instance),
        (
            LayoutKey::ConstructorFunction(function),
            LayoutKind::Instance,
        ),
        (environment, LayoutKind::Environment),
    ];
    for (key, kind) in kinds {
        let expected = Layout {
            kind,
            ..Layout::default()
        };
        assert_eq!(empty_layout(&key), expected, "{key:?}");
    }
}

#[test]
fn synthetic_export_variable_is_untyped_and_uninitialized() {
    let (name, module) = (StringId::new(3), ModuleId::new(2));
    // A copy stays empty where the object lacks the name, and what a face takes is empty for an importer that the CommonJS file itself requires. The check of the importer tests for that.
    let may_be_read_empty = || DeclaredType {
        ty: TypeTable::ANYTHING_OR_ABSENT,
        ..DeclaredType::untyped()
    };
    let writers = [
        (ExportWriter::Loader, DeclaredType::untyped()),
        (ExportWriter::Face, may_be_read_empty()),
        (ExportWriter::Capture, may_be_read_empty()),
    ];
    for (writer, declared) in writers {
        let expected = Variable {
            name: Some(name),
            module,
            declared,
            ..Variable::default()
        };
        let variable = synthetic_export_variable(name, module, writer);
        assert_eq!(variable, expected, "{writer:?}");
        assert_eq!(
            variable.initialization,
            VariableInitialization::Uninitialized
        );
    }
}

#[test]
fn name_that_a_body_stores_reads_undefined_until_then() {
    let (name, module) = (StringId::new(3), ModuleId::new(2));
    let expected = Variable {
        name: Some(name),
        module,
        declared: DeclaredType::untyped(),
        initialization: VariableInitialization::Undefined,
        ..Variable::default()
    };
    assert_eq!(
        synthetic_export_variable(name, module, ExportWriter::Body),
        expected
    );
}
