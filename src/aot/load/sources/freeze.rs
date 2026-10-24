use bun_builtin_sources::Manifest;
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::ExprId;
use bun_sema::node::NodeData;
use bun_sema::program::{CodeAnswer, CompiledModule, FileId, Files};
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_driver::host::to_native;
use core::ops::Range;

use super::{
    EntryPoint, EntryPointKind, EvaluatedTextSite, ParsedSource, SourceEntry, SourceKind, Sources,
    parsed_source,
};
use crate::builtins::RuntimeModule;
use crate::diagnostics::{DiagnosticBuffer, InternalError, Span};
use crate::ir::{InParallel, for_each_mut};
use crate::load::loaders::{BY_NAME, loader_by_name};
use crate::load::module_paths::{
    FileMaps, PathContext, PathInput, check_unique_public_paths, collect_entry_point_paths,
    compute_display_path, compute_public_path, file_ids, is_linkable,
};
use crate::load::project::{PerProject, ProjectId};
use crate::options::Options;
use crate::statistics::{Counters, LimitId, Stage, StatisticId};

pub(crate) struct FreezeInput<'a, 's> {
    pub project: ProjectId,
    pub files: &'a Files<'s>,
    pub options: &'a Options<'a>,
    pub manifest: &'static Manifest,
    pub host_loaded_modules: &'a [RuntimeModule],
    pub is_world: bool,
}

pub(crate) struct FrozenSources {
    pub sources: Sources,
    pub diagnostics: DiagnosticBuffer,
    pub counters: Counters,
}

const FILES_FROZEN_IN_A_RUN: usize = 64;

pub(crate) fn freeze_sources(
    input: &FreezeInput<'_, '_>,
    in_parallel: InParallel<'_>,
) -> Result<FrozenSources, InternalError> {
    let files = input.files;
    let file_count = files.modules.len();
    let (runs_in_place, paths) = (input.options.aot.runs_in_place, &input.options.paths);
    let mut maps = FileMaps::collect(files, collect_entry_point_paths(runs_in_place, paths));
    if input.is_world {
        maps.forget_entry_points();
    }
    let context = PathContext {
        runs_in_place,
        paths,
        manifest: input.manifest,
        maps: &maps,
    };
    let starts = (0..file_count).step_by(FILES_FROZEN_IN_A_RUN);
    let mut runs: Vec<RunSlot> = starts
        .map(|start| (start..file_count.min(start + FILES_FROZEN_IN_A_RUN), None))
        .collect();
    for_each_mut(&mut runs, in_parallel, &|(file_indexes, frozen)| {
        *frozen = Some(freeze_run(input, &context, file_indexes.clone()));
    });
    let mut entries = Vec::with_capacity(file_count);
    let mut lists = FrozenLists::default();
    for (_, frozen) in runs {
        let mut frozen = frozen.expect("every task ran")?;
        entries.append(&mut frozen.entries);
        lists.append(frozen.lists);
    }
    let entry_points = collect_entry_points(input, &entries);

    let modules = &mut lists.runtime_module_files;
    modules.shared_sort_unstable_by_key(|entry| entry.0.registry_id());
    let functions = &mut lists.evaluated_functions;
    functions.shared_sort_unstable_by_key(|entry| entry.0);
    let sources = Sources {
        project: input.project,
        entries,
        entry_points,
        runtime_module_files: lists.runtime_module_files,
        web_assembly_files: lists.web_assembly_files,
        pages: lists.pages,
        evaluated_functions: lists.evaluated_functions,
        manifest: input.manifest,
    };
    let linkable_files = file_ids(file_count).filter(|&file| is_linkable(files, file));
    check_unique_public_paths(linkable_files.map(|file| (file, sources.module_paths(file))))?;
    Ok(FrozenSources {
        sources,
        diagnostics: lists.diagnostics,
        counters: lists.counters,
    })
}

/// The image has one module table: a module of the application and one of Bun's own cannot have the same path either.
pub(crate) fn check_unique_paths_across_projects(
    projects: PerProject<(&Files<'_>, &Sources)>,
) -> Result<(), InternalError> {
    let [application, runtime] =
        [projects.application, projects.runtime].map(|(files, sources)| {
            let compiled_files = files.compiled_files().iter();
            compiled_files.map(move |&file| (file, sources.module_paths(file)))
        });
    check_unique_public_paths(application.chain(runtime))
}

fn create_load_error(message: &[u8], file_name: &[u8]) -> InternalError {
    InternalError {
        stage: Stage::Load,
        message: [message, to_native(file_name)].concat(),
    }
}

fn runtime_module_of(kind: SourceKind) -> Option<RuntimeModule> {
    match kind {
        SourceKind::RuntimeModule(module) => Some(module),
        _ => None,
    }
}

#[derive(Default)]
struct FrozenLists {
    diagnostics: DiagnosticBuffer,
    counters: Counters,
    runtime_module_files: Vec<(RuntimeModule, FileId)>,
    web_assembly_files: Vec<FileId>,
    pages: Vec<(FileId, Box<[u8]>)>,
    evaluated_functions: Vec<((FileId, ExprId), FunctionRef)>,
}

// Consecutive files.
struct FrozenRun {
    entries: Vec<SourceEntry>,
    lists: FrozenLists,
}

type RunSlot = (Range<usize>, Option<Result<FrozenRun, InternalError>>);

impl FrozenLists {
    fn append(&mut self, mut following: FrozenLists) {
        self.diagnostics.append(following.diagnostics);
        self.counters.merge(following.counters);
        self.runtime_module_files
            .append(&mut following.runtime_module_files);
        self.web_assembly_files
            .append(&mut following.web_assembly_files);
        self.pages.append(&mut following.pages);
        self.evaluated_functions
            .append(&mut following.evaluated_functions);
    }

    fn add_compiled_file(
        &mut self,
        files: &Files<'_>,
        file: FileId,
        compiled: &CompiledModule<'_>,
        payload: &ParsedSource,
    ) -> Result<(), InternalError> {
        if let Some(module) = runtime_module_of(payload.kind) {
            self.runtime_module_files.push((module, file));
        }
        if payload.web_assembly.is_some() {
            self.web_assembly_files.push(file);
        }
        if payload.is_page {
            let native_path = to_native(files.module(file).file_name());
            let plugin_module = payload.plugin_module.as_ref();
            let path = plugin_module.map_or(native_path, |module| &*module.path);
            self.pages.push((file, path.into()));
        }
        for diagnostic in &payload.diagnostics {
            let diagnostic = diagnostic.clone().into_diagnostic(file);
            self.diagnostics.push(diagnostic);
        }
        self.count_compiled_file(files, file, compiled);
        self.add_evaluated_functions(files, file, compiled, payload)
    }

    fn count_compiled_file(
        &mut self,
        files: &Files<'_>,
        file: FileId,
        compiled: &CompiledModule<'_>,
    ) {
        let (hir, counters) = (files.hir(file), &mut self.counters);
        for &string in compiled.analysis.strings_over_limit {
            let span = Span::of_node(hir, file, NodeData::Expr(string));
            counters.gave_up(LimitId::MaxFoldedStringBytes, Some(span));
        }
        let used = u64::from(compiled.typed_source_path.is_some());
        counters.count(StatisticId::TypedVersionsUsed, used);
        let rejected = u64::from(compiled.rejected_typed_version.is_some());
        counters.count(StatisticId::TypedVersionsRejected, rejected);
    }

    fn add_evaluated_functions(
        &mut self,
        files: &Files<'_>,
        file: FileId,
        compiled: &CompiledModule<'_>,
        payload: &ParsedSource,
    ) -> Result<(), InternalError> {
        for &site in &payload.evaluated_text_sites {
            let Some(text_file) = evaluated_text_file(compiled, site) else {
                let file_name = files.module(file).file_name();
                return Err(create_load_error(
                    b"no file for evaluated text in ",
                    file_name,
                ));
            };
            let text = parsed_source(files, text_file);
            if let Some(function) = text.and_then(|text| text.evaluated_function) {
                let function = FunctionRef {
                    file: text_file,
                    function,
                };
                self.evaluated_functions.push(((file, site.call), function));
            }
        }
        Ok(())
    }
}

fn evaluated_text_file(compiled: &CompiledModule<'_>, site: EvaluatedTextSite) -> Option<FileId> {
    match *compiled.implied_answers.get(site.implied_answer as usize)? {
        CodeAnswer::File(file) => Some(file),
        _ => None,
    }
}

fn freeze_run(
    input: &FreezeInput<'_, '_>,
    context: &PathContext<'_>,
    file_indexes: Range<usize>,
) -> Result<FrozenRun, InternalError> {
    let mut lists = FrozenLists::default();
    let entries = file_indexes
        .map(|index| freeze_file(input, context, FileId(index as u32), &mut lists))
        .collect::<Result<Vec<SourceEntry>, InternalError>>()?;
    Ok(FrozenRun { entries, lists })
}

fn freeze_file(
    input: &FreezeInput<'_, '_>,
    context: &PathContext<'_>,
    file: FileId,
    lists: &mut FrozenLists,
) -> Result<SourceEntry, InternalError> {
    let files = input.files;
    let module = files.module(file);
    let compiled = files.compiled(file);
    let payload = parsed_source(files, file);
    if compiled.is_some() && payload.is_none() {
        return Err(create_load_error(b"no payload for ", module.file_name()));
    }
    let kind = payload.map_or(SourceKind::TypesOnly, |payload| payload.kind);
    let host_module = compiled.and_then(|compiled| compiled.host_module);
    debug_assert!(host_module.is_none_or(|id| {
        runtime_module_of(kind).is_some_and(|module| module.registry_id() == id.0)
    }));
    let loader = match payload {
        Some(payload) => payload.loader,
        None => loader_by_name(module.file_name()),
    };
    let plugin_module = payload.and_then(|payload| payload.plugin_module.as_ref());
    let public_path = compute_public_path(
        context,
        &PathInput {
            file,
            kind,
            plugin_module,
            file_name: module.file_name(),
            canonical_path: module.path.text,
            host_loader: compiled.map_or(BY_NAME, |compiled| compiled.loader),
            is_linkable: is_linkable(files, file),
            is_default_library: module.is_lib,
        },
    );
    let (diagnostic_path, display_path): (Box<[u8]>, Box<[u8]>) = match (kind, plugin_module) {
        (SourceKind::Program | SourceKind::Data | SourceKind::TypesOnly, None) => {
            let native_path = to_native(files.diagnostic_path(file));
            let project_root = &input.options.load.project_root;
            (
                native_path.into(),
                compute_display_path(project_root, native_path),
            )
        }
        (SourceKind::Program | SourceKind::Data | SourceKind::TypesOnly, Some(_))
        | (
            SourceKind::EvaluatedText | SourceKind::RuntimeModule(_) | SourceKind::RuntimeFunctions,
            Some(_) | None,
        ) => (public_path.clone(), public_path.clone()),
    };
    if let (Some(compiled), Some(payload)) = (compiled, payload) {
        lists.add_compiled_file(files, file, compiled, payload)?;
    }
    Ok(SourceEntry {
        kind,
        loader,
        byte_count: payload.map_or(0, |payload| payload.byte_count as u64),
        is_from_plugin: payload.is_some_and(|payload| payload.is_from_plugin),
        public_path,
        display_path,
        diagnostic_path,
    })
}

fn collect_entry_points(input: &FreezeInput<'_, '_>, entries: &[SourceEntry]) -> Vec<EntryPoint> {
    match input.project {
        ProjectId::Application => collect_application_entry_points(input.files.entry_points()),
        ProjectId::Runtime => collect_runtime_entry_points(input, entries),
    }
}

fn collect_application_entry_points(command_line_files: &[FileId]) -> Vec<EntryPoint> {
    let mut entry_points = Vec::with_capacity(command_line_files.len());
    let mut named_files = FxHashSet::default();
    for (index, &file) in command_line_files.iter().enumerate() {
        if named_files.insert(file) {
            let kind = match index {
                0 => EntryPointKind::Main,
                _ => EntryPointKind::Additional,
            };
            entry_points.push(EntryPoint { file, kind });
        }
    }
    entry_points
}

fn collect_runtime_entry_points(
    input: &FreezeInput<'_, '_>,
    entries: &[SourceEntry],
) -> Vec<EntryPoint> {
    let host_loaded_modules = collect_host_loaded_modules(input, entries);
    let compiled_files = input.files.compiled_files().iter();
    let mut entry_points: Vec<EntryPoint> = compiled_files
        .filter_map(|&file| {
            let kind = runtime_entry_point_kind(entries[file.idx()].kind, &host_loaded_modules)?;
            Some(EntryPoint { file, kind })
        })
        .collect();
    entry_points.shared_sort_unstable_by_key(|entry| (entry.kind, entry.file));
    entry_points
}

fn runtime_entry_point_kind(
    kind: SourceKind,
    host_loaded_modules: &[RuntimeModule],
) -> Option<EntryPointKind> {
    match kind {
        SourceKind::RuntimeModule(module) => match host_loaded_modules.binary_search(&module) {
            Ok(_) => Some(EntryPointKind::HostLoadedModule),
            Err(_) => Some(EntryPointKind::ImportedModule),
        },
        SourceKind::RuntimeFunctions => Some(EntryPointKind::Library),
        _ => None,
    }
}

fn collect_host_loaded_modules(
    input: &FreezeInput<'_, '_>,
    entries: &[SourceEntry],
) -> Vec<RuntimeModule> {
    let files = input.files;
    let compiled_modules = files
        .compiled_files()
        .iter()
        .filter_map(|&file| files.compiled(file));
    let implied_answers = compiled_modules.flat_map(|compiled| compiled.implied_answers);
    let implied_modules = implied_answers.filter_map(|&answer| implied_module(entries, answer));
    let mut modules = input.host_loaded_modules.to_vec();
    modules.extend(implied_modules);
    modules.shared_sort_unstable();
    modules.dedup();
    modules
}

fn implied_module(entries: &[SourceEntry], answer: CodeAnswer<'_>) -> Option<RuntimeModule> {
    match answer {
        CodeAnswer::File(file) => runtime_module_of(entries[file.idx()].kind),
        CodeAnswer::HostModule(id) => RuntimeModule::from_registry_id(id.0),
        _ => None,
    }
}
