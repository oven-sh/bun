use super::definitions::{
    choose_and_relate_definitions, forget_library_layouts_without_definition,
    order_layout_definitions, synthetic_export_keys,
};
use super::merged_keys::{Merged, MergedKeys, merge_keys};
use super::module_table::collect_modules;
use super::state::{Definitions, ModuleTable};
use super::tables::{LinkTables, collect_tables};
use super::{
    InProject, LinkError, LinkInput, LinkProject, LinkUnit, Linked, LinkedFunctions,
    ProgramFunctionKey, ProgramLayoutKey, ProgramVariableKey, key_context, run_one_after_the_other,
};
use crate::builtins::{RuntimeFunction, RuntimeModule};
use crate::compile::testing::{
    default_settings, describe_messages, set_up_output, with_loaded_build,
};
use crate::compile::{BoundBuild, Build, LoadedBuild};
use crate::diagnostics::Diagnostics;
use crate::engine::ExecutableIdentity;
use crate::ir::generated::{Function, FunctionFlags, FunctionVisibility, RuntimeFunctionEntry};
use crate::ir::testing::function_with_parameters;
use crate::ir::{
    BuilderScratch, FunctionBuilder, FunctionId, FunctionKey, InParallel, LayoutKey, ModuleId,
    VariableKey,
};
use crate::load::source_provider::WithoutServices;
use crate::load::{ProgramFile, ProjectId};
use crate::lower::{Fragment, FragmentBuilder, ModuleFragment};
use crate::modules::{ModuleRef, SyntheticExportId};
use crate::options::{LoadOptions, Options, PathOptions};
use crate::statistics::LimitValues;
use bun_ast::Log;
use bun_options_types::aot_options::AotOptions;
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::{ClassRef, FunctionRef, ObjectOrigin, TypeIdentity};
use bun_sema::hir::{ClassId, FnId};
use bun_sema::program::{FileId, Sym};
use bun_sema::resolve::CodeOptions;
use bun_sema_driver::host::from_native;
use bun_sema_driver::{Libs, ThreadCaches};
use core::mem::replace;
use core::num::NonZeroU32;

pub(crate) use crate::ir::run_serially as forward;

const PROJECT_DIRECTORY: &[u8] = b"/project";
const PROJECT_ROOT: &[u8] = b"/project/";
const CONFIGURATION_FILE: (&str, &str) = (
    "tsconfig.json",
    r#"{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  }
}
"#,
);

pub(super) const SHARED_NAME_IMPORTERS: [(&str, &str); 2] = [
    (
        "main.js",
        "import { shared } from 'node:path';\nimport 'node:punycode';\nconsole.log(shared);\n",
    ),
    (
        "/$bun/js/node/punycode.ts",
        "import { own, shared } from 'node:path';\nexport default [own, shared];\n",
    ),
];

pub(super) const COMMON_JS_IMPORTER: [(&str, &str); 2] = [
    (
        "main.js",
        "import { a, b } from './legacy.cjs';\nconsole.log(a, b);\n",
    ),
    ("legacy.cjs", "exports.a = 1;\nexports.b = 2;\n"),
];

pub(super) use super::Projects;
pub(super) use crate::lower::TaskState;

pub(crate) fn reverse(count: usize, work: &(dyn Fn(usize) + Sync)) {
    for index in (0..count).rev() {
        work(index);
    }
}

pub(crate) fn test_function_key(file: u32, function: u32) -> FunctionKey {
    FunctionKey::Source(FunctionRef {
        file: FileId(file),
        function: FnId(function),
    })
}

pub(crate) fn test_class_key(file: u32, class: u32) -> LayoutKey {
    LayoutKey::Class(ClassRef {
        file: FileId(file),
        class: ClassId(class),
    })
}

pub(crate) fn test_object_type_key(identity: u64) -> LayoutKey {
    LayoutKey::ObjectType {
        origin: ObjectOrigin::Computed,
        instantiation: TypeIdentity([identity, 0]),
    }
}

pub(crate) fn test_variable_key(file: u32, symbol: u32) -> VariableKey {
    VariableKey::Symbol(Sym {
        file: FileId(file),
        id: SymbolId(symbol),
    })
}

pub(crate) fn key_in<K>(project: ProjectId, key: K) -> InProject<K> {
    InProject { project, key }
}

pub(crate) fn in_application<K>(key: K) -> InProject<K> {
    key_in(ProjectId::Application, key)
}

pub(super) fn application_file(file: FileId) -> ProgramFile {
    ProgramFile {
        project: ProjectId::Application,
        file,
    }
}

pub(crate) fn define_test_function(
    fragment: &mut FragmentBuilder,
    key: FunctionKey,
    module: ModuleId,
    emit: impl FnOnce(&mut FunctionBuilder),
) -> FunctionId {
    let id = fragment.declare_function(key);
    let function = Function {
        module,
        ..function_with_parameters(FunctionFlags::default(), &[])
    };
    let mut builder = FunctionBuilder::new(function, BuilderScratch::default());
    emit(&mut builder);
    builder.return_value(None);
    let (function, _) = builder.finish();
    fragment.define_function(id, function);
    id
}

pub(super) struct TestUnit {
    pub fragment: FragmentBuilder,
    pub file: FileId,
    pub module: ModuleId,
    body: Option<FunctionId>,
}

impl TestUnit {
    fn with_fragment(file: FileId, mut fragment: FragmentBuilder) -> TestUnit {
        let module = fragment.declare_module(ModuleRef::File(file));
        TestUnit {
            fragment,
            file,
            module,
            body: None,
        }
    }

    /// With tables of its own. `finish` ends it.
    pub(super) fn new(file: FileId) -> TestUnit {
        TestUnit::with_fragment(file, FragmentBuilder::alone(file))
    }

    /// Writes under the tables of `task`, after the files that the task has already visited. `finish_in` ends it.
    pub(super) fn new_in(file: FileId, task: &mut TaskState) -> TestUnit {
        TestUnit::with_fragment(file, FragmentBuilder::new(file, task))
    }

    pub(super) fn define_function(
        &mut self,
        function: u32,
        emit: impl FnOnce(&mut FunctionBuilder),
    ) -> FunctionId {
        let key = test_function_key(self.file.0, function);
        define_test_function(&mut self.fragment, key, self.module, emit)
    }

    pub(super) fn define_body(&mut self, emit: impl FnOnce(&mut FunctionBuilder)) -> FunctionId {
        let key = FunctionKey::ModuleBody(self.file);
        let body = define_test_function(&mut self.fragment, key, self.module, emit);
        self.body = Some(body);
        body
    }

    fn module_fragment(&self) -> ModuleFragment {
        ModuleFragment {
            body: self.body,
            ..ModuleFragment::default()
        }
    }

    pub(super) fn finish(self) -> Fragment {
        let module = self.module_fragment();
        self.fragment.finish_alone(module)
    }

    pub(super) fn finish_in(self, task: &mut TaskState) -> Fragment {
        let module = self.module_fragment();
        self.fragment.finish(module, task)
    }
}

fn bind_loaded_build(build: &mut Build<'_>, loaded: &LoadedBuild<'_, '_>) -> BoundBuild {
    let bound = build.bind_modules(loaded);
    if build.diagnostics.has_errors() {
        let mut log = Log::init();
        replace(&mut build.diagnostics, Diagnostics::new()).write_to(&mut log);
        panic!("module binding failed:\n{}", describe_messages(&log));
    }
    bound.expect("module binding reports every failure")
}

fn with_bound_build<R>(
    files: &[(&str, &str)],
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>, &BoundBuild) -> R,
) -> R {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let bound = bind_loaded_build(build, loaded);
        then(build, loaded, &bound)
    })
}

fn with_bound_build_without_bun_modules<R>(
    files: &[(&str, &str)],
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>, &BoundBuild) -> R,
) -> R {
    set_up_output();
    let aot = AotOptions {
        thread_count: Some(NonZeroU32::MIN),
        ..AotOptions::default()
    };
    let entry_points = vec![files[0].0.as_bytes().to_vec()];
    let mut in_memory_files: Vec<(Vec<u8>, Vec<u8>)> = files
        .iter()
        .chain(&[CONFIGURATION_FILE])
        .map(|(name, text)| {
            let path = [PROJECT_ROOT, name.as_bytes()].concat();
            (path, text.as_bytes().to_vec())
        })
        .collect();
    in_memory_files.sort_unstable();
    let options = Options {
        aot: &aot,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        entry_points: entry_points.clone(),
        code: CodeOptions::bun_run(&from_native(PROJECT_DIRECTORY)),
        typescript_libs: Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS),
        load: LoadOptions {
            in_memory_files,
            omits_builtin_modules: true,
            ..LoadOptions::new(PROJECT_DIRECTORY.to_vec())
        },
        paths: PathOptions {
            module_prefix: b"/$bunfs/root/".to_vec(),
            root_directory: PROJECT_DIRECTORY.to_vec(),
            entry_point_names: entry_points,
            entry_point_file_names: Vec::new(),
        },
        removable: Default::default(),
        lists_modules: false,
        minifies_identifiers: false,
    };
    let caches = ThreadCaches::default();
    let limits = LimitValues::for_host();
    let mut build = Build::new(&options, &WithoutServices, &caches, limits);
    let result = build.with_loaded_projects(|build, loaded| {
        let bound = bind_loaded_build(build, &loaded);
        Ok(then(build, &loaded, &bound))
    });
    let mut log = Log::init();
    match build.finish(result, &mut log) {
        Ok((value, _)) => value,
        Err(failed) => panic!(
            "the build failed in stage \"{}\":\n{}",
            failed.stage.name(),
            describe_messages(&log)
        ),
    }
}

fn create_link_projects<'a, 's>(
    loaded: &'a LoadedBuild<'_, 's>,
    bound: &'a BoundBuild,
    unreached_runtime_files: &'a [FileId],
) -> Projects<'a, 's> {
    loaded.projects.as_ref().map(|id, project| LinkProject {
        loaded: project.loaded,
        graph: &bound.projects.get(id).graph,
        sources: &project.sources,
        unreached_files: match id {
            ProjectId::Application => &bound.projects.application.left_out.files,
            ProjectId::Runtime => unreached_runtime_files,
        },
    })
}

pub(super) fn with_projects<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Projects<'_, '_>) -> R,
) -> R {
    with_bound_build(files, |_, loaded, bound| {
        then(&create_link_projects(loaded, bound, &[]))
    })
}

pub(super) fn with_projects_without_bun_modules<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Projects<'_, '_>) -> R,
) -> R {
    with_bound_build_without_bun_modules(files, |_, loaded, bound| {
        then(&create_link_projects(loaded, bound, &[]))
    })
}

pub(super) fn with_test_files<R>(then: impl FnOnce(&Projects<'_, '_>, [FileId; 3]) -> R) -> R {
    let files = [
        (
            "main.js",
            "export {};\nimport('./first.js');\nimport('./second.js');\n",
        ),
        ("first.js", "export {};\n"),
        ("second.js", "export {};\n"),
    ];
    with_projects_without_bun_modules(&files, |projects| {
        then(projects, files.map(|(name, _)| find_file(projects, name)))
    })
}

pub(super) fn with_lowered_units<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(Vec<LinkUnit>, &Projects<'_, '_>) -> R,
) -> R {
    with_bound_build(files, |build, loaded, bound| {
        let units = build.check_and_lower(loaded, bound);
        let unreached = build.take_unreached_runtime_files();
        then(units, &create_link_projects(loaded, bound, &unreached))
    })
}

pub(super) fn with_lowered_units_without_bun_modules<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(Vec<LinkUnit>, &Projects<'_, '_>) -> R,
) -> R {
    with_bound_build_without_bun_modules(files, |build, loaded, bound| {
        let units = build.check_and_lower(loaded, bound);
        let unreached = build.take_unreached_runtime_files();
        then(units, &create_link_projects(loaded, bound, &unreached))
    })
}

pub(super) fn find_file(projects: &Projects<'_, '_>, name: &str) -> FileId {
    let path = [PROJECT_ROOT, name.as_bytes()].concat();
    let file = projects.application.loaded.files().by_path.get(&path);
    file.expect("the program has no file with this name")
}

pub(super) fn path_source(projects: &Projects<'_, '_>) -> ProgramFile {
    let file = projects
        .runtime
        .sources
        .runtime_module_file(RuntimeModule::NodePath);
    ProgramFile {
        project: ProjectId::Runtime,
        file: file.expect("the runtime project has no source of node:path"),
    }
}

pub(super) fn find_synthetic_export(
    projects: &Projects<'_, '_>,
    project: ProjectId,
    name: &[u8],
) -> SyntheticExportId {
    let atoms = &projects.application.loaded.files().atoms;
    let mut exports = projects.get(project).graph.synthetic_exports().iter();
    let index = exports.position(|export| atoms.bytes(export.name) == name);
    SyntheticExportId(index.expect("the project has no synthetic export with this name") as u32)
}

pub(super) fn unit_in(
    projects: &Projects<'_, '_>,
    project: ProjectId,
    fragment: Fragment,
) -> LinkUnit {
    LinkUnit::new(&key_context(projects, project), fragment)
}

pub(super) fn finish_unit(projects: &Projects<'_, '_>, fragment: FragmentBuilder) -> LinkUnit {
    let fragment = fragment.finish_alone(ModuleFragment::default());
    unit_in(projects, ProjectId::Application, fragment)
}

/// One unit of the application per file, filled by `fill`. The files in one list share tables, like the files that one task of the checker visits.
pub(super) fn units_in_tasks(
    projects: &Projects<'_, '_>,
    tasks: &[&[FileId]],
    fill: impl Fn(&mut TestUnit),
) -> Vec<LinkUnit> {
    let mut units = Vec::new();
    for &files in tasks {
        let mut task = TaskState::new();
        for &file in files {
            let mut unit = TestUnit::new_in(file, &mut task);
            fill(&mut unit);
            let fragment = unit.finish_in(&mut task);
            units.push(unit_in(projects, ProjectId::Application, fragment));
        }
    }
    units
}

pub(super) fn create_runtime_function(id: u32, function: FunctionId) -> RuntimeFunctionEntry {
    RuntimeFunctionEntry {
        id: RuntimeFunction(id),
        function,
        visibility: FunctionVisibility::Public,
    }
}

/// What `link` holds once it has chosen the definitions.
pub(super) struct Prepared<'a> {
    pub units: Vec<LinkUnit>,
    pub tables: Vec<LinkTables>,
    pub modules: ModuleTable,
    pub functions: MergedKeys<'a, ProgramFunctionKey>,
    pub layouts: MergedKeys<'a, ProgramLayoutKey>,
    pub variables: MergedKeys<'a, ProgramVariableKey>,
    pub definitions: Definitions,
}

fn key_lists<'t, K>(
    tables: &'t [LinkTables],
    keys_of: impl Fn(&'t LinkTables) -> &'t [K],
) -> Vec<&'t [K]> {
    tables.iter().map(keys_of).collect()
}

pub(super) fn prepare<'a>(mut units: Vec<LinkUnit>, projects: &Projects<'a, '_>) -> Prepared<'a> {
    units.sort_by_key(|unit| unit.file);
    let atoms = &projects.application.loaded.files().atoms;
    let tables = collect_tables(&mut units, projects, &forward);
    let modules = collect_modules(projects, &units, &tables);
    let function_lists = key_lists(&tables, |tables| tables.functions.as_slice());
    let functions = merge_keys(&function_lists, atoms, &forward);
    let layout_lists = key_lists(&tables, |tables| tables.layouts.as_slice());
    let layouts = merge_keys(&layout_lists, atoms, &forward);
    forget_library_layouts_without_definition(&mut units, &tables, &layouts, &forward);
    order_layout_definitions(&mut units, &forward);
    let synthetic_exports = synthetic_export_keys(projects);
    let mut variable_lists = key_lists(&tables, |tables| tables.variables.as_slice());
    variable_lists.push(&synthetic_exports);
    let variables = merge_keys(&variable_lists, atoms, &forward);
    let merged = Merged {
        units: &units,
        tables: &tables,
        modules: &modules,
        functions: &functions,
        layouts: &layouts,
        variables: &variables,
        in_parallel: &forward,
    };
    let definitions = choose_and_relate_definitions(&merged, projects, &run_one_after_the_other);
    Prepared {
        units,
        tables,
        modules,
        functions,
        layouts,
        variables,
        definitions,
    }
}

/// The program lists its functions. `Linked::functions` holds the same functions, also in the program's ids, and no tables.
pub(super) fn link(input: LinkInput<'_, '_>) -> Result<Linked, Vec<LinkError>> {
    let in_parallel = input.in_parallel;
    let mut linked = super::link(input)?;
    let none = LinkedFunctions::of_program_functions(Vec::new());
    let functions = replace(&mut linked.functions, none).into_program_functions(in_parallel);
    linked.program.functions.clone_from(&functions);
    linked.functions = LinkedFunctions::of_program_functions(functions);
    Ok(linked)
}

pub(super) fn link_units(
    units: Vec<LinkUnit>,
    projects: &Projects<'_, '_>,
    in_parallel: InParallel<'_>,
) -> Result<Linked, Vec<LinkError>> {
    link(LinkInput {
        units,
        projects: *projects,
        in_parallel,
        beside: &run_one_after_the_other,
    })
}

pub(crate) fn link_sources(files: &[(&str, &str)]) -> Result<Linked, Vec<LinkError>> {
    link_sources_in(files, &forward)
}

pub(crate) fn link_sources_in(
    files: &[(&str, &str)],
    in_parallel: InParallel<'_>,
) -> Result<Linked, Vec<LinkError>> {
    with_lowered_units(files, |units, projects| {
        link_units(units, projects, in_parallel)
    })
}

pub(super) fn link_sources_without_bun_modules(
    files: &[(&str, &str)],
) -> Result<Linked, Vec<LinkError>> {
    with_lowered_units_without_bun_modules(files, |units, projects| {
        link_units(units, projects, &forward)
    })
}

#[test]
fn files_of_one_task_share_tables_and_a_unit_alone_has_its_own() {
    with_test_files(|projects, [main, first, second]| {
        let mut units = units_in_tasks(projects, &[&[first, second]], |unit| {
            unit.define_body(|_| {});
        });
        let mut alone = TestUnit::new(main);
        alone.define_body(|_| {});
        units.push(unit_in(projects, ProjectId::Application, alone.finish()));

        let prepared = prepare(units, projects);

        assert_eq!(prepared.tables.len(), 2);
        let tables_of = |file: FileId| {
            let mut units = prepared.units.iter();
            let unit = units.find(|unit| unit.file == application_file(file));
            unit.expect("the file has no unit").tables
        };
        assert_eq!(tables_of(first), tables_of(second));
        assert_ne!(tables_of(main), tables_of(first));
        for file in [main, first, second] {
            let key = in_application(FunctionKey::ModuleBody(file));
            let body = prepared.functions.find(&key);
            let body = body.expect("no tables name the body") as usize;
            let site = prepared.definitions.functions[body];
            let site = site.expect("no unit defines the body");
            assert_eq!(
                prepared.units[site.unit as usize].file,
                application_file(file)
            );
        }
    });
}

#[test]
fn linked_program_lists_its_functions() {
    let linked = link_sources_without_bun_modules(&[("main.js", "export {};\n")]);
    let linked = linked.expect("the program links");
    assert!(!linked.program.functions.is_empty());
    assert_eq!(
        linked.functions.function_count(),
        linked.program.functions.len()
    );
}
