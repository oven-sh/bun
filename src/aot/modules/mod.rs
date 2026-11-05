mod bindings;
mod commonjs_exports;
mod deferred_data;
mod deferred_exports;
pub(crate) mod evicted;
mod exports;
mod failures;
mod graph;
mod imports;
mod interop;
mod known_members;
mod module_set;
mod namespace_members;
mod order;
mod plan;
mod reached_targets;
mod referents;
mod requests;
mod side_effects;
mod synthetic_exports;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;
mod unloadable;
mod unread_exports;
mod wrapped;
mod written_descriptor;

pub use bindings::{
    AccessedModule, AnswerMember, Candidates, CopiedExports, ExportBinding, ExportLookup,
    ExportStatement, ExportUse, Holder, ImportBinding, ModuleExport, ModuleRequest, RequiredName,
    ShownNames, SiteAnswer, SpelledModule, SyntheticExport, SyntheticExportId,
};
pub use bun_core::strings::order_utf16 as compare_code_units;
pub use commonjs_exports::CommonJsExports;
pub use deferred_data::{DeferredData, bundle_pages};
pub use deferred_exports::DeferredExports;
pub use failures::{FailureEffect, ModuleFailure, ModuleFailureId, ModuleFailureKind};
pub use graph::ModuleGraph;
pub use interop::{ImportPhase, Interop, ModuleKind, RequireResult, SyntheticExportRule};
pub(crate) use known_members::{KnownMemberValues, KnownObjects, Validity, is_enum};
pub use plan::{Member, ModuleRef, Shape, Site, View};
pub use referents::{Library, LinkedProject};
pub use wrapped::{InnerModule, InnerModuleKind, WrappedModules};
pub(crate) use written_descriptor::{DescribedPart, WrittenDescriptor};

use crate::builtins::{BuiltinNames, Platforms, RuntimeModule, table};
use crate::ir::InParallel;
use crate::ir::parallel::map_each;
use crate::known_helpers::KnownHelpers;
use crate::link::{Beside, run_beside};
use crate::load::replaced_by_tests::without_extension;
use crate::load::{EntryPointKind, SourceKind, Sources};
use crate::options::{
    FilesThatTestsLoad, LoadsBelowFilesLeftToLoader, ReplacedExport, ReplacedModule,
};
use crate::statistics::{Counters, StatisticId};
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::StmtId;
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use commonjs_exports::{CommonJsInput, InnerCommonJs, scan_commonjs_modules};
use core::cmp::Ordering;
use evicted::{find_evicted_modules, find_library_modules_stored_in_cache};
use exports::{
    ExportTables, Resolution, collect_export_entries, find_ambiguous_names, finish_exports,
    resolve_exports,
};
use failures::{PendingFailure, number_failures};
use graph::{FileRow, find};
use imports::{FileImports, bind_imports, finish_bindings, finish_named_members};
use module_set::{ModuleSet, collect_modules};
use order::{SiteKey, SitePosition, compute_order};
use plan::{Plan, StoredSite};
use requests::{
    ScannedSite, Scans, finish_requests, finish_site_answers,
    leave_imports_of_test_files_to_loader, scan_files,
};
use side_effects::is_declared_free_of_side_effects;
use std::sync::Arc;
use synthetic_exports::{ReplacedNames, number_synthetic_exports};
use unloadable::{drop_errors_of_unloadable_modules, find_unloadable_modules};

pub struct BindInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub sources: &'a Sources,
    pub builtin_names: &'a BuiltinNames,
    pub deferred_exports: &'a DeferredExports,
    pub known_helpers: &'a KnownHelpers,
    pub platform: Platforms,
    /// Packages that an option of the build names as external. A computed specifier can name one that no import site names.
    pub external_packages: &'a [Vec<u8>],
    /// What the engine found in an earlier compile of the program: a spy of the test runner may replace them.
    pub replaced_exports: &'a [ReplacedExport],
    /// `LoadOptions::replaced_builtins`
    pub replaced_builtins: &'a [u32],
    /// `AotOptions::runs_in_place`: the program answers as `bun run`, not as `bun build --compile`, where the two differ.
    pub runs_in_place: bool,
    /// `CodeOptions::working_directory`
    pub working_directory: &'a [u8],
    /// `CodeOptions::ignores_declared_side_effects`
    pub ignores_declared_side_effects: bool,
    /// `LoadOptions::mocked_modules`
    pub mocked_modules: &'a [ReplacedModule],
    /// `LoadOptions::mocks_any_module`
    pub mocks_any_module: bool,
    /// `LoadOptions::handed_on_modules`
    pub handed_on_modules: &'a [ReplacedModule],
    /// `LoadOptions::hands_on_any_module`
    pub hands_on_any_module: bool,
    /// `LoadOptions::spies_on_unknown_objects`
    pub spies_on_unknown_objects: bool,
    /// `LoadOptions::names_spied_on_unknown_objects`
    pub names_spied_on_unknown_objects: &'a [Vec<u8>],
    /// `LoadOptions::names_spied_in_text`
    pub names_spied_in_text: &'a [Vec<u8>],
    /// `LoadOptions::modules_replaced_in_text`
    pub modules_replaced_in_text: &'a [Vec<u8>],
    /// `LoadOptions::every_export_is_asked_for`
    pub every_export_is_asked_for: bool,
    /// `LoadOptions::evicted_modules`
    pub evicted_modules: &'a [ReplacedModule],
    /// `LoadOptions::evicts_any_module`
    pub evicts_any_module: bool,
    /// `LoadOptions::loads_below_files_left_to_loader`
    pub loads_below_files_left_to_loader: &'a [Arc<LoadsBelowFilesLeftToLoader>],
    pub files_that_tests_load: &'a FilesThatTestsLoad,
    pub runs_tests: bool,
    /// The entry points are the test files and the preloads of `bun test --aot`, which the runner starts one after another.
    pub runner_starts_entry_points: bool,
    /// `LoadOptions::stores_path_of_main_module`
    pub stores_path_of_main_module: bool,
    /// `AotOptions::entry_points_run_again`
    pub entry_points_run_again: bool,
    /// `AotOptions::typescript_drops_absent_exports`
    pub typescript_drops_absent_exports: bool,
    /// `AotOptions::loads_code_from_disk`
    pub loads_code_from_disk: bool,
    /// `AotOptions::host_runs_files_from_disk`
    pub host_runs_files_from_disk: bool,
    /// `LoadOptions::stand_in_for_files_from_disk`
    pub stand_in_for_files_from_disk: Option<FileId>,
    pub application: Option<&'a ApplicationGraph<'a>>,
    pub in_parallel: InParallel<'a>,
    pub beside: Beside<'a>,
}

/// For the graph of a typed package's own program. Every importer of a module has a say in how it exports, and only the application has all of them.
pub struct ApplicationGraph<'a> {
    pub graph: &'a ModuleGraph,
    pub to_local: &'a (dyn Fn(FileId) -> Option<FileId> + Sync),
    pub to_application: &'a (dyn Fn(FileId) -> Option<FileId> + Sync),
}

impl ApplicationGraph<'_> {
    fn local_module(&self, module: ModuleRef) -> Option<ModuleRef> {
        module.map_file(self.to_local)
    }

    fn application_module(&self, module: ModuleRef) -> Option<ModuleRef> {
        module.map_file(self.to_application)
    }

    /// A program of its own asks its files for every name, so it loads code that a file hands on and nobody in the application asks for.
    pub fn has_module(&self, local: FileId) -> bool {
        (self.to_application)(local).is_some_and(|file| self.graph.has_record(file))
    }
}

pub struct BoundModules {
    pub graph: ModuleGraph,
    pub counters: Counters,
}

pub fn bind_modules(input: &BindInput<'_, '_>) -> BoundModules {
    let file_count = input.files.modules.len();
    let mut scans = scan_files(input);
    let unloadable = find_unloadable_modules(input, &mut scans);
    let mut modules = collect_modules(input, &scans);
    let mut evicted = find_evicted_modules(input, &scans, &modules);
    let may_load_again = |file: FileId| {
        let kind = modules.interop(ModuleRef::File(file)).kind;
        evicted.contains(ModuleRef::File(file))
            && match input.sources.kind(file) {
                SourceKind::Program => {
                    matches!(kind, ModuleKind::SourceText | ModuleKind::CommonJs)
                }
                SourceKind::Data => true,
                _ => false,
            }
    };
    // A test file whose statements the loader links imports no file that may load again, so it never runs from disk for the sake of one.
    if leave_imports_of_test_files_to_loader(input, &mut scans, &may_load_again) {
        modules = collect_modules(input, &scans);
        evicted = find_evicted_modules(input, &scans, &modules);
    }
    let ((order, mut sites), entries) = run_beside(
        input.beside,
        || compute_order(input, &scans, &modules),
        || collect_export_entries(input, &scans, &modules),
    );
    let mut entries = Some(entries);
    let inner_commonjs_modules = collect_inner_commonjs_modules(&modules, file_count);
    let commonjs_input = CommonJsInput {
        bind: input,
        scans: &scans,
        modules: &modules,
        inner_modules: &|file: FileId| &inner_commonjs_modules[file.idx()][..],
        half: &|module: ModuleRef| order.half(module),
        half_at_link: &|module: ModuleRef| order.half_at_link(module),
        is_prefix_root: &|file: FileId| order.is_prefix_root(file),
    };
    let mut texts = scan_commonjs_modules(&commonjs_input);
    let stored_in_cache = find_library_modules_stored_in_cache(input, &scans, &modules);
    let mut stored_markers = FxHashSet::default();
    let mut newly_stored_markers = find_markers_stored_in_application(input, &modules);
    // What the build knows of the `__esModule` of a module counts until a store in another file is found.
    let (tables, imports) = loop {
        texts.forget_markers(&newly_stored_markers);
        stored_markers.extend(newly_stored_markers);
        let entries = entries
            .take()
            .unwrap_or_else(|| collect_export_entries(input, &scans, &modules));
        let tables = resolve_exports(input.files, &scans, &modules, entries, &texts);
        sites.settle(input.files, &modules, &tables);
        let find_marker = |module: ModuleRef| match modules.interop(module).kind {
            _ if stored_markers.contains(&module) => None,
            // From the first `require` on.
            ModuleKind::SourceText => Some(true),
            ModuleKind::CommonJs => texts.marker(module),
            _ => None,
        };
        let imports = bind_imports(
            input,
            &scans,
            &modules,
            &tables,
            &order,
            &sites,
            &find_marker,
            &evicted,
            &stored_in_cache,
        );
        let stored = imports.iter().flat_map(|file| &file.stored_markers);
        newly_stored_markers = stored.copied().collect();
        if newly_stored_markers.is_empty() {
            break (tables, imports);
        }
    };
    // A spy, and whoever is handed the object, gets hold of the namespace object of the compiled file.
    let mut imports = imports;
    for file in &mut imports {
        let lists = [
            &mut file.imported_namespaces,
            &mut file.namespaces_handed_out,
            &mut file.namespaces_spied_on_whole,
        ];
        for module in lists.into_iter().flatten() {
            *module = modules.module_behind(*module);
        }
    }
    let imported_namespaces = imports.iter().flat_map(|file| &file.imported_namespaces);
    let imported_namespaces: Vec<ModuleRef> = imported_namespaces.copied().collect();
    let replaced_variables = imports.iter().flat_map(|file| &file.replaced_variables);
    let mut replaced_variables: Vec<Sym> = replaced_variables.copied().collect();
    let replaced_names = imports.iter().flat_map(|file| &file.replaced_names);
    let mut replaced_names: Vec<(ModuleRef, Atom)> = replaced_names.copied().collect();
    let mut replace = |resolution: Resolution| match resolution {
        Resolution::Variable(variable) => replaced_variables.push(variable),
        Resolution::Synthetic { module, name } => replaced_names.push((module, name)),
        Resolution::RuntimeMember { module, name } => {
            replaced_names.push((ModuleRef::Runtime(module), name));
        }
        Resolution::Namespace { .. }
        | Resolution::LiveName { .. }
        | Resolution::DynamicStar { .. }
        | Resolution::Unloadable { .. }
        | Resolution::NotFound
        | Resolution::Ambiguous => {}
    };
    let replaced_modules = ReplacedModules::new(input, &modules);
    let mut replaced_without_table = Vec::new();
    for export in input.replaced_exports {
        if let Some(module) = replaced_modules.find(&export.module) {
            let name = input.files.atoms.intern(&export.name);
            replace(tables.resolve_in(&modules, module, name).resolution);
            // The names of a module of the library or a CommonJS file show at run time, and no file of this build may ask for this one.
            if modules.table_file(module).is_none() {
                replaced_without_table.push(module);
            }
        }
    }
    // In a test run a namespace object that goes somewhere may reach a spy that takes an object from somewhere. The engine would find
    // that out behind a whole run of the flow analysis, and the program would be compiled again.
    let mocked_modules = imports.iter().flat_map(|file| &file.mocked_modules);
    let mut mocked_modules: FxHashSet<ModuleRef> = mocked_modules.copied().collect();
    mocked_modules.extend(replaced_without_table);
    // A test names an ES module of Bun's own as a module of the library. Its table stands here, with its file.
    for module in input.mocked_modules {
        let Some(ModuleRef::Runtime(module)) = replaced_modules.find(module) else {
            continue;
        };
        let files = modules.compiled_files.iter();
        let is_its_file =
            |file: &&FileId| input.sources.kind(**file) == SourceKind::RuntimeModule(module);
        mocked_modules.extend(files.filter(is_its_file).map(|&file| ModuleRef::File(file)));
    }
    // A file of the application may spy on or mock a module that is lowered in a program of its own.
    if let Some(application) = input.application {
        for &file in &modules.compiled_files {
            let module = ModuleRef::File(file);
            let theirs = application.application_module(module);
            if theirs.is_some_and(|theirs| application.graph.may_be_mocked(theirs)) {
                mocked_modules.insert(module);
            }
            for &(_, resolved) in tables.names(file) {
                let Resolution::Variable(variable) = resolved.resolution else {
                    continue;
                };
                let their_file = (application.to_application)(variable.file);
                let their_variable = their_file.map(|file| Sym { file, ..variable });
                if their_variable.is_some_and(|it| application.graph.is_replaceable(it)) {
                    replace(resolved.resolution);
                }
            }
        }
    }
    // In a test run a statement that names a file that is not there fails where the file loads, unless a mock stands under the name. The functions of the file
    // are left out, so nothing may be said of what it exports.
    if input.runs_tests {
        for &file in &modules.compiled_files {
            if scans.of(file).failures.is_empty() {
                continue;
            }
            for &(_, resolved) in tables.names(file) {
                replace(resolved.resolution);
            }
        }
    }
    let mut spy_may_reach_any_module = false;
    let spies = imports.iter().map(|file| &file.spies_on_unknown_objects);
    // Such a spy replaces what goes by the name that it is given, and nothing else. Under a name that nobody can read it replaces every name.
    let told = input.names_spied_on_unknown_objects.iter();
    let told = told.chain(input.names_spied_in_text);
    let mut names_spied_on: FxHashSet<Atom> =
        told.map(|name| input.files.atoms.intern(name)).collect();
    names_spied_on.extend(spies.clone().flat_map(|it| &it.names));
    // Whether somebody passes a helper its names is for the scan of the test files to say, which reads them all. Flow reads the callers in this program
    // alone: below other programs it takes such a helper for a spy under any name, and what it finds that is not open starts the build over.
    let is_seen_to_spy = spies
        .clone()
        .any(|it| it.is_any_name || !it.names.is_empty());
    let loads_by_unknown_path = imports.iter().any(|file| file.loads_by_unknown_path);
    // Where a file loads under a path that nobody reads, every namespace object has escaped for flow, and a spy in sight whose object and name it loses on
    // the way is a spy on every export of them all: it finds that behind a whole front end. A name that is a constant where the spy is called it does not lose.
    let meets_all_that_escaped = spies
        .clone()
        .any(|it| it.is_any_name || it.has_name_that_is_no_constant)
        && loads_by_unknown_path
        && !input.every_export_is_asked_for
        && !input.host_runs_files_from_disk;
    let is_any_name_spied_on = input.spies_on_unknown_objects
        || meets_all_that_escaped
        || spies.clone().any(|it| {
            it.is_any_name || (it.takes_names_from_outside && input.every_export_is_asked_for)
        });
    if input.runs_tests && (is_any_name_spied_on || !names_spied_on.is_empty()) {
        let handed_out = imports.iter().flat_map(|file| &file.namespaces_handed_out);
        let mut handed_out: FxHashSet<ModuleRef> = handed_out.copied().collect();
        let out_of_sight = input.handed_on_modules.iter();
        handed_out.extend(out_of_sight.filter_map(|module| replaced_modules.find(module)));
        // `export * as name`: whoever reads the name holds the object.
        for &file in &modules.compiled_files {
            handed_out.extend(tables.names(file).iter().filter_map(|&(_, resolved)| {
                match resolved.resolution {
                    Resolution::Namespace { module, .. } => Some(module),
                    _ => None,
                }
            }));
        }
        // Such a spy may be handed the object of any module. The engine says so behind a whole run of flow. Where the test files are not in the build it finds few: they reach the entry points alone.
        if !input.host_runs_files_from_disk
            && (input.hands_on_any_module
                || ((is_seen_to_spy || !input.names_spied_in_text.is_empty())
                    && loads_by_unknown_path))
        {
            spy_may_reach_any_module = true;
            let files = modules.compiled_files.iter();
            handed_out.extend(files.map(|&file| ModuleRef::File(file)));
        }
        for &module in &handed_out {
            let Some(file) = modules.table_file(module) else {
                // The names of a module of the library or a CommonJS file show at run time.
                mocked_modules.insert(module);
                continue;
            };
            // The object of such a module has no layout of its own, and flow takes a spy that may meet it for a spy on all its names.
            let is_source_text = scans.of(file).interop.kind == ModuleKind::SourceText;
            for &(name, resolved) in tables.names(file) {
                if is_any_name_spied_on || !is_source_text || names_spied_on.contains(&name) {
                    replace(resolved.resolution);
                }
            }
            if !tables.has_dynamic_names(module) {
                continue;
            }
            // `export * from "node:os"`: whoever holds the object of the file reaches the names of that module, which show at run time.
            for behind in find_modules_behind_stars(input, &scans, &modules, file) {
                if is_any_name_spied_on {
                    mocked_modules.insert(behind);
                    continue;
                }
                for &name in &names_spied_on {
                    replace(tables.resolve_in(&modules, behind, name).resolution);
                }
            }
        }
        // Whoever finds a file by its name gets the object of a file of data, and no text says who does.
        for &file in &modules.compiled_files {
            if scans.of(file).interop.kind == ModuleKind::Data {
                for &(_, resolved) in tables.names(file) {
                    replace(resolved.resolution);
                }
            }
        }
    }
    for &module in imports
        .iter()
        .flat_map(|file| &file.namespaces_spied_on_whole)
    {
        // Where the names of the module are all known they are replaced, and that is all: the object of a module that may be mocked is an object that nobody
        // knows for flow, and a spy on such an object under a name that nobody reads is a spy on every export of the program.
        match modules.table_file(module) {
            Some(file) if !tables.has_dynamic_names(module) => {
                for &(_, resolved) in tables.names(file) {
                    replace(resolved.resolution);
                }
            }
            Some(file) => {
                mocked_modules.insert(module);
                mocked_modules.extend(find_modules_behind_stars(input, &scans, &modules, file));
            }
            None => {
                mocked_modules.insert(module);
            }
        }
    }
    if loads_by_unknown_path && !input.modules_replaced_in_text.is_empty() {
        for &file in &modules.compiled_files {
            let path = input.files.module(file).file_name();
            if (input.modules_replaced_in_text.iter()).any(|it| ends_with_module_in_text(path, it))
            {
                mocked_modules.insert(ModuleRef::File(file));
            }
        }
    }
    let mocked_files = mocked_modules.iter();
    for file in mocked_files.filter_map(|&module| modules.table_file(module)) {
        for &(_, resolved) in tables.names(file) {
            replace(resolved.resolution);
        }
    }
    let mocks_any_module = imports.iter().any(|file| file.mocks_any_module);
    let replaced = ReplacedNames {
        names: &replaced_names,
        modules: &mocked_modules,
        is_every_module: mocks_any_module || spy_may_reach_any_module,
    };
    let synthetic = number_synthetic_exports(input, &modules, &tables, &imports, &texts, replaced);
    let ((mut pending, requests, is_library), mut commonjs_exports) = run_beside(
        input.beside,
        || {
            (
                collect_pending_failures(&scans, &modules, &tables, &imports),
                finish_requests(&scans, &modules, &tables, &order, &sites),
                find_library_files(input),
            )
        },
        || CommonJsExports::finish(&commonjs_input, texts, &tables, &imports, &synthetic),
    );
    // What the text of the files that use a module says, dead code too. Reach says the same of the code that is left.
    for file_imports in &imports {
        for &module in &file_imports.exports_values {
            commonjs_exports.look_at(module);
        }
        // A call through the object hands the object over as `this`.
        for &(accessed, owner, name) in &file_imports.called_members {
            if !commonjs_exports.ignores_this(owner, name) {
                commonjs_exports.look_at(accessed);
            }
        }
    }
    for file_imports in &imports {
        for &(module, name) in &file_imports.called_namespace_members {
            commonjs_exports.call_through_namespace(module, name);
        }
    }
    drop_errors_of_unloadable_modules(&mut pending, &unloadable);
    let failures = number_failures(file_count, pending);
    let mut load_failures = Vec::with_capacity(unloadable.len());
    let mut erased_statements = find_statements_of_inner_modules(&modules);
    for module in &unloadable {
        load_failures.push((module.file, failures.id_of(module.importer, module.order)));
        let hir = input.files.hir(module.file);
        erased_statements.extend(hir.ids(hir.body).map(|statement| (module.file, statement)));
    }
    let mut compiled_files = modules.compiled_files.iter().zip(imports).peekable();
    let record_files = modules.record_files.iter().zip(requests.files);
    let drafts: Vec<(FileId, Vec<ModuleRequest>, Option<FileImports>)> = record_files
        .map(|(&file, requests)| {
            let compiled = compiled_files.next_if(|&(&compiled_file, _)| compiled_file == file);
            (file, requests, compiled.map(|(_, imports)| imports))
        })
        .collect();
    debug_assert!(compiled_files.next().is_none());
    let files_left_to_loader = modules.files_left_to_loader();
    let rows = map_each(drafts, input.in_parallel, &|(file, requests, imports)| {
        let (files, sources) = (input.files, input.sources);
        let interop = modules.interop(ModuleRef::File(file));
        let runtime_module = match sources.kind(file) {
            SourceKind::RuntimeModule(module) if interop.kind == ModuleKind::RuntimeSource => {
                Some(module)
            }
            _ => None,
        };
        debug_assert_eq!(
            runtime_module.is_some(),
            interop.kind == ModuleKind::RuntimeSource
        );
        let is_compiled = imports.is_some();
        let is_code_of_program = sources.kind(file) == SourceKind::Program
            && matches!(interop.kind, ModuleKind::SourceText | ModuleKind::CommonJs);
        let (site_answers, exports, imports) = match imports {
            Some(imports) => (
                finish_site_answers(files, &scans, file, &failures),
                finish_exports(files, &tables, &synthetic, file),
                imports,
            ),
            None => (Vec::new(), Vec::new(), FileImports::default()),
        };
        let evaluating_sites = sites.of(file).iter().filter(|site| site.evaluates);
        let mut evaluating_sites: Vec<(SiteKey, StoredSite)> = evaluating_sites
            .map(|site| {
                // The text of a file that keeps the function around it is lowered into that function, which is not the body.
                let is_bare = site.position == SitePosition::InOrder
                    && site.is_proven
                    && !commonjs_exports.needs_wrapped_body(site.referrer);
                let stored = StoredSite {
                    referrer: site.referrer,
                    target: site.target,
                    is_bare,
                };
                (site.key, stored)
            })
            .collect();
        evaluating_sites.shared_sort_unstable_by_key(|&(key, _)| key);
        FileRow {
            file,
            interop,
            runtime_module,
            is_library: is_library[file.idx()],
            has_dynamic_names: tables.has_dynamic_names(ModuleRef::File(file)),
            has_top_level_await: is_compiled
                && interop.kind == ModuleKind::SourceText
                && files.analysis(file).has_live_top_level_await,
            // A load that fails throws, whatever the package says of the file.
            has_no_side_effects: is_code_of_program
                && !input.ignores_declared_side_effects
                && !is_library[file.idx()]
                && find(&load_failures, file).is_none()
                && is_declared_free_of_side_effects(
                    files.declared_side_effects(file),
                    files.module(file).file_name(),
                ),
            requests,
            sites: site_answers,
            spellings: match is_compiled {
                true => scans.of(file).spellings.clone(),
                false => Vec::new(),
            },
            imports: finish_bindings(imports.bindings, &synthetic),
            members: finish_bindings(imports.members, &synthetic),
            accessed: imports.accessed,
            fixed_members: imports.fixed_members,
            named_members: finish_named_members(imports.named_members, &synthetic),
            jsx: finish_bindings(
                (imports.jsx.into_iter())
                    .map(|it| (it.import, it.binding))
                    .collect(),
                &synthetic,
            ),
            namespace_values: imports.namespace_values,
            evaluating_sites,
            unread_sites: imports.unread_sites,
            holders: imports.holders,
            answer_members: imports.answer_members,
            exports,
            ambiguous_names: match is_compiled {
                true => find_ambiguous_names(files, &tables, file),
                false => Vec::new(),
            },
            unread_exports: Vec::new(),
            is_data_linked_by_names_alone: false,
            is_left_to_loader: files_left_to_loader.contains(&file),
            required_names: imports.required_names,
            names_searched_behind_stars: imports.names_searched_behind_stars,
        }
    });
    let mut counters = Counters::default();
    let module_count = modules.record_files.len() + modules.other_modules.len();
    counters.count(StatisticId::ModulesBound, module_count as u64);
    for &file in &modules.compiled_files {
        for &import in &scans.of(file).computed_imports {
            counters.add_computed_import(import);
        }
    }
    let (errors, failures) = failures.into_lists();
    let mut plan = Plan::new(order.into_parts(), erased_statements);
    for &module in &stored_markers {
        plan.set_marker_is_stored(module);
    }
    for &module in &imported_namespaces {
        plan.set_is_imported_as_namespace(module);
    }
    plan.set_replaced_variables(replaced_variables);
    for &module in &mocked_modules {
        plan.set_may_be_mocked(module);
    }
    if mocks_any_module {
        plan.set_every_module_may_be_mocked();
    }
    if input.runs_tests {
        plan.set_runs_tests();
    }
    // `require.main` is what the cache holds under the path in `Bun.main`.
    if input.runs_tests || input.stores_path_of_main_module {
        plan.set_lists_files_in_cache();
    }
    if input.entry_points_run_again {
        for entry_point in input.sources.entry_points() {
            plan.set_runs_again(ModuleRef::File(entry_point.file));
        }
    }
    plan.set_library_modules_stored_in_cache(stored_in_cache);
    for module in evicted.iter() {
        plan.set_may_be_evicted(module);
    }
    if evicted.is_every_module() {
        plan.set_every_module_may_be_evicted();
    }
    for module in evicted.changed_on_disk() {
        plan.set_is_changed_on_disk_by_run(module);
    }
    if evicted.is_table_reached() {
        plan.set_reaches_entries_of_cache();
    }
    for module in evicted.asked_for_any_export() {
        plan.set_every_export_is_asked_for(module);
    }
    if evicted.is_every_export_asked_for() || input.every_export_is_asked_for {
        plan.set_every_export_of_every_module_is_asked_for();
    }
    if evicted.copies_name_every_module() {
        plan.set_copies_name_every_module();
    }
    let inner_requests = requests.inner_modules.into_iter();
    plan.inner_requests = inner_requests.map(|(_, requests)| requests).collect();
    let graph = ModuleGraph {
        row_by_file: vec![None; file_count],
        rows,
        record_files: Vec::new(),
        left_out_files: Vec::new(),
        files_brought_by_calls: Vec::new(),
        placeholder_files: Vec::new(),
        left_out_inner_modules: Vec::new(),
        other_modules: modules.other_modules,
        external_kinds: modules.external_kinds,
        statements_left_to_loader: modules.left_to_loader,
        importers_that_stand_for_all: Vec::new(),
        synthetic_exports: synthetic.into_list(),
        errors,
        failures,
        load_failures,
        wrapped: modules.wrapped,
        commonjs_exports,
        plan,
    };
    let graph = graph.finish(input.in_parallel);
    BoundModules { graph, counters }
}

/// The modules of the program by what an option of the load names them with.
pub fn names_es_module_of_library(module: &ReplacedModule) -> bool {
    let module = match module {
        ReplacedModule::File(specifier) => table::module_by_specifier(specifier),
        ReplacedModule::Runtime(id) => RuntimeModule::from_registry_id(*id),
    };
    module.is_some_and(table::is_es_module)
}

struct ReplacedModules<'a> {
    files: FxHashMap<&'a [u8], FileId>,
}

impl<'a> ReplacedModules<'a> {
    fn new(input: &BindInput<'a, '_>, modules: &ModuleSet) -> ReplacedModules<'a> {
        let names_none = input.replaced_exports.is_empty()
            && input.mocked_modules.is_empty()
            && input.handed_on_modules.is_empty();
        match names_none {
            true => ReplacedModules {
                files: FxHashMap::default(),
            },
            false => ReplacedModules::of_every_file(input, modules),
        }
    }

    fn of_every_file(input: &BindInput<'a, '_>, modules: &ModuleSet) -> ReplacedModules<'a> {
        let files = modules.record_files.iter();
        ReplacedModules {
            files: files
                .map(|&file| (input.files.module(file).file_name(), file))
                .collect(),
        }
    }

    fn find(&self, module: &ReplacedModule) -> Option<ModuleRef> {
        match module {
            ReplacedModule::File(path) => match self.files.get(&path[..]) {
                Some(&file) => Some(ModuleRef::File(file)),
                None => table::module_by_specifier(path).map(ModuleRef::Runtime),
            },
            ReplacedModule::Runtime(id) => {
                RuntimeModule::from_registry_id(*id).map(ModuleRef::Runtime)
            }
        }
    }
}

// The modules without a table that `file` passes on whole, by itself or through files that it passes on whole.
fn find_modules_behind_stars(
    input: &BindInput<'_, '_>,
    scans: &Scans,
    modules: &ModuleSet,
    file: FileId,
) -> Vec<ModuleRef> {
    let (mut found, mut seen, mut pending) = (Vec::new(), FxHashSet::default(), vec![file]);
    while let Some(file) = pending.pop() {
        if !seen.insert(file) {
            continue;
        }
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, scanned) in sites.zip(&scans.of(file).sites) {
            let (ImportSiteKind::ExportStar(_), &ScannedSite::Module(target)) =
                (site.kind, scanned)
            else {
                continue;
            };
            match modules.table_file(target) {
                Some(passed_on) => pending.push(passed_on),
                None => found.push(target),
            }
        }
    }
    found
}

fn find_markers_stored_in_application(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
) -> Vec<ModuleRef> {
    let Some(application) = input.application else {
        return Vec::new();
    };
    let files = modules.record_files.iter();
    let files = files.map(|&file| ModuleRef::File(file));
    files
        .filter(|&module| {
            let theirs = application.application_module(module);
            theirs.is_some_and(|theirs| application.graph.is_marker_stored(theirs))
        })
        .collect()
}

// `"../lib.js"` in code that a test holds as text: the folder depends on where the file is written, and what is left of the path is what is known.
fn ends_with_module_in_text(path: &[u8], written: &[u8]) -> bool {
    let mut tail = written;
    while let Some(rest) = (tail.strip_prefix(b"../"))
        .or_else(|| tail.strip_prefix(b"./"))
        .or_else(|| tail.strip_prefix(b"/"))
    {
        tail = rest;
    }
    let tail = without_extension(tail);
    let path = without_extension(path);
    let ends_in = |path: &[u8]| {
        path.strip_suffix(tail)
            .is_some_and(|folder| folder.is_empty() || folder.ends_with(b"/"))
    };
    !tail.is_empty() && (ends_in(path) || path.strip_suffix(b"/index").is_some_and(ends_in))
}

fn collect_inner_commonjs_modules(
    modules: &ModuleSet,
    file_count: usize,
) -> Vec<Vec<InnerCommonJs>> {
    let mut by_file = Vec::new();
    by_file.resize_with(file_count, Vec::new);
    for &file in &modules.compiled_files {
        let inner_modules = modules.wrapped.of_file(file).iter();
        let commonjs_modules =
            inner_modules.filter(|inner| inner.kind == InnerModuleKind::CommonJs);
        by_file[file.idx()] = commonjs_modules
            .map(|inner| InnerCommonJs {
                holder: inner.holder,
                callback: inner.callback,
            })
            .collect();
    }
    by_file
}

// Every variable that the statement of an inner module declares is a holder: a statement that declares something else has none.
fn find_statements_of_inner_modules(modules: &ModuleSet) -> Vec<(FileId, StmtId)> {
    let mut statements = Vec::new();
    for &file in &modules.compiled_files {
        let inner_modules = modules.wrapped.of_file(file).iter();
        statements.extend(inner_modules.map(|inner| (file, inner.statement)));
    }
    statements.shared_sort_unstable();
    statements.dedup();
    statements
}
fn rank_of_module(module: ModuleRef) -> u8 {
    match module {
        ModuleRef::File(_) => 0,
        ModuleRef::Inner { .. } => 1,
        ModuleRef::Face(_) => 2,
        ModuleRef::Check(_) => 3,
        ModuleRef::Runtime(_) => 4,
        ModuleRef::External { .. } => 5,
    }
}

pub fn compare_modules(a: ModuleRef, b: ModuleRef, atoms: &Interner<'_>) -> Ordering {
    use ModuleRef::{Check, External, Face, File, Inner, Runtime};
    match (a, b) {
        (File(a), File(b)) | (Face(a), Face(b)) | (Check(a), Check(b)) => a.cmp(&b),
        (
            Inner {
                file: a_file,
                callback: a_callback,
            },
            Inner {
                file: b_file,
                callback: b_callback,
            },
        ) => (a_file, a_callback).cmp(&(b_file, b_callback)),
        (Runtime(a), Runtime(b)) => a.cmp(&b),
        (
            External {
                importer: a_importer,
                specifier: a_specifier,
                type_attribute: a_type,
            },
            External {
                importer: b_importer,
                specifier: b_specifier,
                type_attribute: b_type,
            },
        ) => a_importer
            .cmp(&b_importer)
            .then_with(|| atoms.bytes(a_specifier).cmp(atoms.bytes(b_specifier)))
            // The module that no attribute asks for comes first.
            .then_with(|| a_type.map(|it| it as u8).cmp(&b_type.map(|it| it as u8))),
        (File(_) | Inner { .. } | Face(_) | Check(_) | Runtime(_) | External { .. }, _) => {
            rank_of_module(a).cmp(&rank_of_module(b))
        }
    }
}

fn find_library_files(input: &BindInput<'_, '_>) -> Vec<bool> {
    let mut is_library = vec![false; input.files.modules.len()];
    for entry_point in input.sources.entry_points() {
        is_library[entry_point.file.idx()] |= entry_point.kind == EntryPointKind::Library;
    }
    is_library
}

fn collect_pending_failures(
    scans: &Scans,
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
) -> Vec<(FileId, Vec<PendingFailure>)> {
    debug_assert_eq!(modules.compiled_files.len(), imports.len());
    let compiled_files = modules.compiled_files.iter().zip(imports);
    compiled_files
        .map(|(&file, imports)| {
            let lists = [
                scans.of(file).failures.as_slice(),
                tables.failures_of(file),
                imports.failures.as_slice(),
            ];
            (file, lists.concat())
        })
        .collect()
}
