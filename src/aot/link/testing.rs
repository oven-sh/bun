use super::definitions::{MergedUnits, choose_definitions, synthetic_export_keys};
use super::keys::{MergedKeys, merge_keys};
use super::marks::mark;
use super::module_table::collect_modules;
use super::numbering::number_program;
use super::property_keys::merge_property_keys;
use super::state::{
    Definitions, MergedTypes, ModuleTable, Numbering, ProgramCounts, Retained, UnitIds, UnitMarks,
};
use super::strings::merge_strings;
use super::types::merge_types;
use super::{
    InProject, KeyContext, LinkError, LinkInput, LinkProject, LinkUnit, Linked, ProgramFunctionKey,
    ProgramLayoutKey, ProgramModule, ProgramVariableKey, collect_key_lists, key_context,
    link_while, run_one_after_the_other,
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
    BuilderScratch, FunctionBuilder, FunctionId, FunctionKey, Id, InParallel, LayoutKey,
    ModuleFailureId, ModuleId, StringTable, VariableKey,
};
use crate::load::source_provider::WithoutServices;
use crate::load::{PerProject, ProgramFile, ProjectId, Sources};
use crate::lower::{Fragment, FragmentBuilder, ModuleFragment};
use crate::modules::{ModuleGraph, ModuleRef, SyntheticExportId};
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

pub(crate) fn application_keys<'a>(
    graph: &'a ModuleGraph,
    runtime_sources: &'a Sources,
) -> KeyContext<'a> {
    KeyContext {
        project: ProjectId::Application,
        graph,
        runtime_sources,
        rehoming: None,
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
    pub(super) fn new(file: FileId) -> TestUnit {
        let mut fragment = FragmentBuilder::new(file);
        let module = fragment.declare_module(ModuleRef::File(file));
        TestUnit {
            fragment,
            file,
            module,
            body: None,
        }
    }

    pub(super) fn declare_function(&mut self, file: FileId, function: u32) -> FunctionId {
        let key = test_function_key(file.0, function);
        self.fragment.declare_function(key)
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

    pub(super) fn finish(self) -> Fragment {
        self.fragment.finish(ModuleFragment {
            body: self.body,
            ..ModuleFragment::default()
        })
    }
}

fn bind_loaded_build<'s>(build: &mut Build<'_>, loaded: &LoadedBuild<'_, 's>) -> BoundBuild<'s> {
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
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>, &BoundBuild<'s>) -> R,
) -> R {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let bound = bind_loaded_build(build, loaded);
        then(build, loaded, &bound)
    })
}

fn with_bound_build_without_bun_modules<R>(
    files: &[(&str, &str)],
    then: impl for<'b, 's> FnOnce(&mut Build<'_>, &LoadedBuild<'b, 's>, &BoundBuild<'s>) -> R,
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
    bound: &'a BoundBuild<'s>,
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
    let fragment = fragment.finish(ModuleFragment::default());
    unit_in(projects, ProjectId::Application, fragment)
}

pub(super) fn create_runtime_function(id: u32, function: FunctionId) -> RuntimeFunctionEntry {
    RuntimeFunctionEntry {
        id: RuntimeFunction(id),
        function,
        visibility: FunctionVisibility::Public,
    }
}

pub(crate) fn unit_of(fragment: Fragment) -> LinkUnit {
    with_projects_without_bun_modules(&[("main.js", "export {};\n")], |projects| {
        let keys = application_keys(projects.application.graph, projects.runtime.sources);
        LinkUnit::new(&keys, fragment)
    })
}

pub(super) struct Prepared {
    pub units: Vec<LinkUnit>,
    pub modules: ModuleTable,
    pub functions: MergedKeys<ProgramFunctionKey>,
    pub layouts: MergedKeys<ProgramLayoutKey>,
    pub variables: MergedKeys<ProgramVariableKey>,
    pub definitions: Definitions,
    pub errors: Vec<LinkError>,
}

impl Prepared {
    pub(super) fn merged<'a>(&'a self, in_parallel: InParallel<'a>) -> MergedUnits<'a> {
        MergedUnits {
            units: &self.units,
            modules: &self.modules,
            functions: &self.functions,
            layouts: &self.layouts,
            variables: &self.variables,
            in_parallel,
        }
    }
}

pub(super) fn prepare(mut units: Vec<LinkUnit>, projects: &Projects<'_, '_>) -> Prepared {
    units.sort_by_key(|unit| unit.file);
    let modules = collect_modules(projects, &units);
    let functions = merge_keys(&collect_key_lists(&units, |unit| &unit.functions), &forward);
    let layouts = merge_keys(&collect_key_lists(&units, |unit| &unit.layouts), &forward);
    let synthetic_exports = synthetic_export_keys(projects);
    let mut variable_lists = collect_key_lists(&units, |unit| &unit.variables);
    variable_lists.push(&synthetic_exports);
    let variables = merge_keys(&variable_lists, &forward);
    let mut errors = Vec::new();
    let merged = MergedUnits {
        units: &units,
        modules: &modules,
        functions: &functions,
        layouts: &layouts,
        variables: &variables,
        in_parallel: &forward,
    };
    let definitions = choose_definitions(&merged, projects, &run_one_after_the_other, &mut errors);
    Prepared {
        units,
        modules,
        functions,
        layouts,
        variables,
        definitions,
        errors,
    }
}

pub(super) fn mark_prepared(
    prepared: &Prepared,
    projects: &Projects<'_, '_>,
    in_parallel: InParallel<'_>,
    errors: &mut Vec<LinkError>,
) -> Retained {
    let merged = prepared.merged(in_parallel);
    mark(&merged, projects, &prepared.definitions, errors)
}

pub(super) struct Numbered {
    pub prepared: Prepared,
    pub retained: Retained,
    pub numbering: Numbering,
    pub strings: StringTable,
}

pub(super) fn number_units(units: Vec<LinkUnit>, projects: &Projects<'_, '_>) -> Numbered {
    let prepared = prepare(units, projects);
    assert!(prepared.errors.is_empty(), "{:?}", prepared.errors);
    let mut errors = Vec::new();
    let retained = mark_prepared(&prepared, projects, &forward, &mut errors);
    assert!(errors.is_empty(), "{errors:?}");
    let units = &prepared.units;
    let merged_strings = merge_strings(units, &retained.units, &forward);
    let merged_types = merge_types(units, &retained.units, &forward);
    let merged = prepared.merged(&forward);
    let mut numbering = number_program(&merged, &prepared.definitions, &retained);
    let merged_ids = merged_strings.local_to_program.into_iter();
    let merged_ids = merged_ids.zip(merged_types.types);
    for (ids, (strings, types)) in numbering.units.iter_mut().zip(merged_ids) {
        ids.strings = strings;
        ids.types = types;
    }
    let property_keys = merge_property_keys(units, &retained.units, &numbering.units, &forward);
    let unit_ids = numbering.units.iter_mut();
    for (ids, property_keys) in unit_ids.zip(property_keys.local_to_program) {
        ids.property_keys = property_keys;
    }
    Numbered {
        prepared,
        retained,
        numbering,
        strings: merged_strings.table,
    }
}

pub(super) fn mark_everything(unit: &LinkUnit) -> UnitMarks {
    let records = &unit.records;
    UnitMarks {
        strings: vec![true; unit.strings.len()],
        property_keys: vec![true; unit.property_keys.len()],
        types: vec![true; unit.types.len()],
        type_sites: vec![true; records.type_sites.len()],
        expected_results: vec![true; records.expected_results.len()],
        eval_scopes: vec![true; records.eval_scopes.len()],
        data: vec![true; records.data.len()],
    }
}

fn allocate_ids<I: Id>(allocated_count: &mut usize, count: usize) -> Vec<Option<I>> {
    let start = *allocated_count;
    *allocated_count += count;
    (start..*allocated_count)
        .map(|index| Some(I::new(index)))
        .collect()
}

fn ids_from_merged_indexes<I: Id>(merged_indexes: &[u32]) -> Vec<Option<I>> {
    merged_indexes
        .iter()
        .map(|&index| Some(I::new(index as usize)))
        .collect()
}

fn number_module(
    numbered_modules: &mut Vec<ProgramModule>,
    module: ProgramModule,
) -> Option<ModuleId> {
    let found = numbered_modules.iter().position(|&other| other == module);
    let index = found.unwrap_or_else(|| {
        numbered_modules.push(module);
        numbered_modules.len() - 1
    });
    Some(ModuleId::new(index))
}

fn number_module_failures(units: &[LinkUnit]) -> PerProject<Vec<Option<ModuleFailureId>>> {
    let mut key_counts = PerProject::<usize>::default();
    for unit in units {
        let key_count = match unit.file.project {
            ProjectId::Application => &mut key_counts.application,
            ProjectId::Runtime => &mut key_counts.runtime,
        };
        for failure in &unit.module_failures {
            *key_count = (*key_count).max(failure.0 as usize + 1);
        }
    }
    let mut allocated_count = 0;
    key_counts.map(|_, key_count| allocate_ids(&mut allocated_count, key_count))
}

/// The ids of each unit in a program that keeps everything.
pub(super) fn number_everything(units: &[LinkUnit]) -> Vec<UnitIds> {
    let marks: Vec<UnitMarks> = units.iter().map(mark_everything).collect();
    let functions = merge_keys(&collect_key_lists(units, |unit| &unit.functions), &forward);
    let layouts = merge_keys(&collect_key_lists(units, |unit| &unit.layouts), &forward);
    let variables = merge_keys(&collect_key_lists(units, |unit| &unit.variables), &forward);
    let strings = merge_strings(units, &marks, &forward).local_to_program;
    let MergedTypes { types, .. } = merge_types(units, &marks, &forward);
    let module_failures = number_module_failures(units);

    let mut counts = ProgramCounts::default();
    let mut numbered_modules = Vec::new();
    let mut unit_ids = Vec::with_capacity(units.len());
    let merged_ids = strings.into_iter().zip(types);
    for (index, (strings, types)) in merged_ids.enumerate() {
        let unit = &units[index];
        let records = &unit.records;
        let failure_ids = module_failures.get(unit.file.project);
        let modules = unit.modules.iter();
        let failures = unit.module_failures.iter();
        unit_ids.push(UnitIds {
            strings,
            property_keys: Vec::new(),
            types,
            type_sites: allocate_ids(&mut counts.type_sites, records.type_sites.len()),
            expected_results: allocate_ids(
                &mut counts.expected_results,
                records.expected_results.len(),
            ),
            layouts: ids_from_merged_indexes(&layouts.local_to_merged[index]),
            variables: ids_from_merged_indexes(&variables.local_to_merged[index]),
            modules: modules
                .map(|&module| number_module(&mut numbered_modules, module))
                .collect(),
            module_failures: failures
                .map(|failure| failure_ids[failure.0 as usize])
                .collect(),
            eval_scopes: allocate_ids(&mut counts.eval_scopes, records.eval_scopes.len()),
            functions: ids_from_merged_indexes(&functions.local_to_merged[index]),
            data: allocate_ids(&mut counts.data, records.data.len()),
        });
    }
    let property_keys = merge_property_keys(units, &marks, &unit_ids, &forward).local_to_program;
    for (ids, property_keys) in unit_ids.iter_mut().zip(property_keys) {
        ids.property_keys = property_keys;
    }
    unit_ids
}

/// The program lists its functions.
pub(super) fn link(input: LinkInput<'_, '_>) -> Result<Linked, Vec<LinkError>> {
    let in_parallel = input.in_parallel;
    let mut linked = link_while(input, &mut |_| {})?;
    let body_remap = core::mem::take(&mut linked.body_remap);
    linked.program.functions = body_remap.into_program_functions(in_parallel);
    Ok(linked)
}

pub(super) fn link_units(
    units: Vec<LinkUnit>,
    projects: &Projects<'_, '_>,
    in_parallel: InParallel<'_>,
) -> Result<Linked, Vec<LinkError>> {
    let limits = LimitValues::for_host();
    link(LinkInput {
        units,
        projects: *projects,
        limits: &limits,
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
