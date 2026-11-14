use super::*;
use crate::builtins::RuntimeFunction;
use crate::ir::generated::FieldFlags;
use crate::ir::testing::create_builder;
use crate::ir::{FunctionKey, PropertyKeyId, TypeId};
use crate::link::program_keys::ProgramModule;
use crate::link::testing::{
    COMMON_JS_IMPORTER, Prepared, Projects, SHARED_NAME_IMPORTERS, application_file,
    create_runtime_function, define_test_function, find_file, find_synthetic_export,
    in_application, link_sources_without_bun_modules, path_source, prepare, reverse,
    test_class_key, test_function_key, test_object_type_key, unit_in, with_projects,
    with_projects_without_bun_modules, with_test_files,
};
use crate::lower::{Fragment, FragmentBuilder, ModuleFragment};
use crate::modules::ModuleRef;
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{ClassRef, FunctionRef, ObjectOrigin, TypeIdentity};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::{FileId, Sym};

fn finish(fragment: FragmentBuilder) -> Fragment {
    fragment.finish_alone(ModuleFragment::default())
}

fn prepare_fragments<'a, const COUNT: usize>(
    projects: &'a Projects<'a, '_>,
    fragments: [Fragment; COUNT],
) -> Prepared<'a> {
    let units = fragments.map(|fragment| unit_in(projects, ProjectId::Application, fragment));
    prepare(units.into(), projects)
}

fn function_site(prepared: &Prepared<'_>, key: ProgramFunctionKey) -> Option<DefinitionSite> {
    let merged = prepared.functions.find(&key);
    prepared.definitions.functions[merged.expect("no unit declares the function") as usize]
}

fn layout_site(prepared: &Prepared<'_>, key: ProgramLayoutKey) -> Option<DefinitionSite> {
    let merged = prepared.layouts.find(&key);
    prepared.definitions.layouts[merged.expect("no unit declares the layout") as usize]
}

fn variable_definition(
    prepared: &Prepared<'_>,
    key: ProgramVariableKey,
) -> Option<VariableDefinition> {
    let merged = prepared.variables.find(&key);
    prepared.definitions.variables[merged.expect("nothing declares the variable") as usize]
}

fn defining_file(prepared: &Prepared<'_>, site: Option<DefinitionSite>) -> Option<ProgramFile> {
    site.map(|site| prepared.units[site.unit as usize].file)
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
    let variable = synthetic_export_variable(name, ModuleId::default(), ExportWriter::Loader, true);
    fragment.define_variable(id, variable);
}

fn function_fragment(file: FileId, key: FunctionKey) -> Fragment {
    let mut fragment = FragmentBuilder::alone(key.home_file());
    define_function(&mut fragment, key);
    Fragment {
        file,
        ..finish(fragment)
    }
}

fn layout_fragment(file: FileId, key: LayoutKey) -> Fragment {
    let mut fragment = FragmentBuilder::alone(file);
    define_layout(&mut fragment, key);
    fragment.end_layouts_of_code();
    finish(fragment)
}

fn variable_fragment(file: FileId, key: VariableKey) -> Fragment {
    let mut fragment = FragmentBuilder::alone(file);
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
        let mut caller_fragment = FragmentBuilder::alone(caller);
        caller_fragment.declare_function(key);
        let fragments = [function_fragment(home, key), finish(caller_fragment)];
        let prepared = prepare_fragments(projects, fragments);
        let site = function_site(&prepared, in_application(key));
        assert_eq!(defining_file(&prepared, site), Some(application_file(home)));
    });
}

fn function_type_fragment(file: FileId, key: FunctionKey, parameters: &[TypeId]) -> Fragment {
    let mut fragment = FragmentBuilder::alone(file);
    let id = fragment.declare_function(key);
    let mut builder = create_builder(parameters);
    builder.return_value(None);
    fragment.define_function(id, builder.finish().0);
    finish(fragment)
}

#[test]
fn function_type_is_defined_by_the_first_file_that_records_its_parameters() {
    with_test_files(|projects, mut files| {
        files.sort_unstable();
        let declaration = FunctionRef {
            file: files[0],
            function: FnId(0),
        };
        let class = ClassRef {
            file: files[0],
            class: ClassId(0),
        };
        let (without, with): (&[TypeId], &[TypeId]) = (&[], &[TypeTable::NUMBER]);
        let function_types = [
            FunctionKey::Signature(declaration),
            FunctionKey::ClassSignature(class),
        ];
        for key in function_types {
            let find_defining_unit = |parameters: [&[TypeId]; 3]| {
                let fragments = [0, 1, 2]
                    .map(|place| function_type_fragment(files[place], key, parameters[place]));
                let prepared = prepare_fragments(projects, fragments);
                let site = function_site(&prepared, in_application(key));
                let merged = prepared.functions.find(&in_application(key));
                let merged = merged.expect("every unit declares the function type");
                let reversed = choose_in_reverse(&prepared, projects);
                assert_eq!(reversed.functions[merged as usize], site, "{key:?}");
                site.expect("every unit defines the function type").unit
            };
            assert_eq!(find_defining_unit([without, with, with]), 1, "{key:?}");
            assert_eq!(find_defining_unit([without, without, with]), 2, "{key:?}");
            assert_eq!(
                find_defining_unit([without, without, without]),
                0,
                "{key:?}"
            );
            assert_eq!(find_defining_unit([with, without, with]), 0, "{key:?}");
        }
    });
}

#[test]
fn declaring_files_layout_stands() {
    with_test_files(|projects, [_, first, second]| {
        for (home, importer) in [(first, second), (second, first)] {
            let key = test_class_key(home.0, 0);
            let fragments = [layout_fragment(importer, key), layout_fragment(home, key)];
            let prepared = prepare_fragments(projects, fragments);
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
            let site = layout_site(&prepared, in_application(key));
            assert_eq!(defining_file(&prepared, site), Some(lowest_file), "{key:?}");
        }
    });
}

fn object_type(identity: u64) -> ObjectTypeKey {
    ObjectTypeKey::Type {
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
    let mut fragment = FragmentBuilder::alone(file);
    let id = fragment.declare_layout(key);
    for &ty in types {
        fragment.define_object_type(id, empty_layout(&key), ty);
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
        assert_eq!(others, [site(0, 1), site(1, 0), site(1, 1), site(1, 4)]);
        assert!(prepared.definitions.is_other_definition(merged, site(1, 1)));
        assert!(!prepared.definitions.is_other_definition(merged, site(1, 2)));
    });
}

#[test]
fn in_which_order_a_unit_defines_the_types_of_a_layout_changes_nothing() {
    with_test_files(|projects, [main, _, _]| {
        let keys = [1, 2].map(test_object_type_key);
        let positions_in_order = |said: &[(usize, Option<u64>, u32)]| {
            let mut fragment = FragmentBuilder::alone(main);
            for &(key, identity, position) in said {
                let id = fragment.declare_layout(keys[key]);
                let definition = Layout {
                    position,
                    ..empty_layout(&keys[key])
                };
                fragment.define_object_type(id, definition, identity.map(object_type));
            }
            let prepared = prepare_fragments(projects, [finish(fragment)]);
            keys.map(|key| {
                let merged = prepared.layouts.find(&in_application(key)).unwrap();
                let first = layout_site(&prepared, in_application(key));
                let others = prepared.definitions.other_definitions_of(merged).iter();
                let sites = first.into_iter().chain(others.map(|&(_, site)| site));
                let position = |site: DefinitionSite| {
                    prepared.units[site.unit as usize].layout_definitions[site.index as usize]
                        .1
                        .position()
                };
                sites.map(position).collect::<Vec<u32>>()
            })
        };
        let one_way = [
            (0, Some(3), 30),
            (0, None, 7),
            (0, Some(1), 10),
            (0, None, 5),
            (1, Some(2), 20),
            (1, Some(1), 11),
        ];
        let another_way = [
            (1, Some(1), 11),
            (1, Some(2), 20),
            (0, None, 5),
            (0, Some(1), 10),
            (0, None, 7),
            (0, Some(3), 30),
        ];
        let expected = [vec![5, 7, 10, 30], vec![11, 20]];
        assert_eq!(positions_in_order(&one_way), expected);
        assert_eq!(positions_in_order(&another_way), expected);
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
        let mut fragment = FragmentBuilder::alone(main);
        fragment.declare_layout(key);
        let prepared = prepare_fragments(projects, [finish(fragment)]);
        assert_eq!(layout_site(&prepared, in_application(key)), None);
    });
}

#[test]
fn only_link_defines_synthetic_exports() {
    with_projects_without_bun_modules(&COMMON_JS_IMPORTER, |projects| {
        let main = find_file(projects, "main.js");
        let id = find_synthetic_export(projects, ProjectId::Application, b"a");
        let fragment = variable_fragment(main, VariableKey::SyntheticExport(id));
        let prepared = prepare_fragments(projects, [fragment]);

        let exporter = ProgramModule::File(application_file(find_file(projects, "legacy.cjs")));
        let atoms = &projects.application.loaded.files().atoms;
        for name in [b"a", b"b"] {
            let key = synthetic_key(projects, ProjectId::Application, name);
            let definition = VariableDefinition::SyntheticExport {
                module: prepared.modules.index_of(exporter),
                name: atoms.intern(name),
                is_known_member: false,
                is_replaceable: false,
                writer: ExportWriter::Body,
            };
            assert_eq!(variable_definition(&prepared, key), Some(definition));
        }
    });
}

#[test]
fn copy_is_defined_by_facade() {
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
        assert!(synthetic_export_keys(projects).contains(&copy));

        let declare = |facade: Option<ModuleRef>| {
            let mut fragment = FragmentBuilder::alone(main);
            fragment.declare_variable(VariableKey::Copy(id));
            if let Some(facade) = facade {
                fragment.declare_module(facade);
            }
            prepare_fragments(projects, [finish(fragment)])
        };
        let has_facade = projects
            .application
            .graph
            .facade(ModuleRef::File(legacy))
            .is_some();
        if !has_facade {
            assert_eq!(variable_definition(&declare(None), copy), None);
        }

        let prepared = declare(Some(ModuleRef::Facade(legacy)));
        let facade = ProgramModule::Facade(application_file(legacy));
        let definition = VariableDefinition::SyntheticExport {
            module: prepared.modules.index_of(facade),
            name: projects.application.loaded.files().atoms.intern(b"a"),
            is_known_member: false,
            is_replaceable: false,
            writer: ExportWriter::Facade,
        };
        assert_eq!(variable_definition(&prepared, copy), Some(definition));
    });
}

#[test]
fn synthetic_export_keys_list_application_before_runtime() {
    with_projects(&SHARED_NAME_IMPORTERS, |projects| {
        let keys = synthetic_export_keys(projects);
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
            is_replaceable: false,
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
    let mut fragment = FragmentBuilder::alone(file);
    for &(layout, supertype) in edges {
        let layout = fragment.declare_layout(layout);
        let supertype = fragment.declare_layout(supertype);
        fragment.add_supertype(layout, supertype);
    }
    finish(fragment)
}

pub(super) fn choose_in_reverse(
    prepared: &Prepared<'_>,
    projects: &Projects<'_, '_>,
) -> Definitions {
    let merged = Merged {
        units: &prepared.units,
        tables: &prepared.tables,
        modules: &prepared.modules,
        functions: &prepared.functions,
        layouts: &prepared.layouts,
        variables: &prepared.variables,
        in_parallel: &reverse,
    };
    choose_and_relate_definitions(&merged, projects, &crate::link::run_one_after_the_other)
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
    let mut fragment = FragmentBuilder::alone(file);
    for (index, &id) in (0..).zip(ids) {
        let function = fragment.declare_function(test_function_key(file.0, index));
        fragment.add_runtime_function(create_runtime_function(id, function));
    }
    finish(fragment)
}

#[test]
fn runtime_functions_are_sorted_by_id() {
    with_test_files(|projects, [_, first, second]| {
        let fragments = [
            runtime_function_fragment(first, &[9, 2]),
            runtime_function_fragment(second, &[5]),
        ];
        let prepared = prepare_fragments(projects, fragments);
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
    let may_be_read_empty = || DeclaredType {
        ty: TypeTable::ANYTHING_OR_ABSENT,
        ..DeclaredType::untyped()
    };
    let writers = [
        (ExportWriter::Loader, true, DeclaredType::untyped()),
        (ExportWriter::Loader, false, may_be_read_empty()),
        (ExportWriter::Facade, true, may_be_read_empty()),
        (ExportWriter::Capture, true, may_be_read_empty()),
    ];
    for (writer, is_known_member, declared) in writers {
        let expected = Variable {
            name: Some(name),
            module,
            declared,
            ..Variable::default()
        };
        let variable = synthetic_export_variable(name, module, writer, is_known_member);
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
        synthetic_export_variable(name, module, ExportWriter::Body, true),
        expected
    );
}
