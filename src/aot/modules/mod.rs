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
pub use referents::{Library, LinkedProject, find_name_stored_as_module_exports};
pub use requests::Spelling;
pub use wrapped::{InnerModule, InnerModuleKind, WrappedModules};
pub(crate) use written_descriptor::{DescribedPart, WrittenDescriptor};

use crate::builtins::{BuiltinNames, Platforms, RuntimeModule, table};
use crate::ir::InParallel;
use crate::ir::parallel::map_each;
use crate::known_helpers::KnownHelpers;
use crate::link::{Beside, run_beside};
use crate::load::is_written_by_test_runner;
use crate::load::replaced_by_tests::without_extension;
use crate::load::replaced_modules::asks_for_original_beside_mock;
use crate::load::sources::parsed_source;
use crate::load::{EntryPointKind, SourceKind, Sources};
use crate::options::{
    FilesThatTestsLoad, LoadsBelowFilesLeftToLoader, ReplacedExport, ReplacedModule,
};
use crate::statistics::{Counters, Stage, StatisticId, StepClock, logs_stages};
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::StmtId;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use commonjs_exports::{CommonJsInput, InnerCommonJs, scan_commonjs_modules};
use core::cmp::Ordering;
use evicted::{
    find_evicted_modules, find_files_that_run_again, find_library_modules_stored_in_cache,
};
use exports::{
    ExportTables, Resolution, collect_export_entries, find_ambiguous_names, finish_exports,
    resolve_exports,
};
use failures::{PendingFailure, number_failures};
use graph::{FileRow, find};
use imports::{
    FileImports, bind_imports, find_mocked_modules, finish_bindings, finish_named_members,
};
use module_set::{ModuleSet, collect_modules};
use order::{SiteKey, SitePosition, compute_order};
use plan::{Plan, StoredSite};
use requests::{
    ScannedSite, Scans, find_spelling, finish_requests, finish_site_answers,
    leave_imports_of_test_files_to_loader, program_names_plugin, scan_files,
};
use side_effects::is_declared_free_of_side_effects;
use std::sync::{Arc, OnceLock};
use synthetic_exports::{ReplacedNames, number_synthetic_exports};
use unloadable::{
    drop_errors_of_unloadable_modules, find_unloadable_modules,
    let_late_commonjs_files_fail_at_load,
};

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
    /// `LoadOptions::modules_that_mocked_files_export_whole`
    pub modules_that_mocked_files_export_whole: &'a [ReplacedModule],
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
    /// `LoadOptions::tests_load_by_unknown_path`
    pub tests_load_by_unknown_path: bool,
    /// `LoadOptions::every_export_is_asked_for`
    pub every_export_is_asked_for: bool,
    /// --aot-sabotage=CopiesNameNoFile
    pub copies_name_no_file: bool,
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
    /// `AotOptions::only_tests_load_code_from_disk`
    pub only_tests_load_code_from_disk: bool,
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
    let mut steps = StepClock::new(Stage::BindModules, "bind_modules");
    let mut scans = scan_files(input);
    steps.end("scan_files");
    let_late_commonjs_files_fail_at_load(input, &mut scans);
    let unloadable = find_unloadable_modules(input, &mut scans);
    steps.end("find_unloadable_modules");
    let mut modules = collect_modules(input, &scans);
    steps.end("collect_modules");
    let mut evicted = find_evicted_modules(input, &scans, &modules);
    steps.end("find_evicted_modules");
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
    steps.end("leave_imports_of_test_files_to_loader");
    let ((order, mut sites), entries) = run_beside(
        input.beside,
        || compute_order(input, &scans, &modules),
        || collect_export_entries(input, &scans, &modules),
    );
    steps.end("compute_order beside collect_export_entries");
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
    steps.end("scan_commonjs_modules");
    let stored_in_cache = find_library_modules_stored_in_cache(input, &scans, &modules);
    let mut stored_markers = FxHashSet::default();
    let mut newly_stored_markers = find_markers_stored_in_application(input, &modules);
    // What the build knows of the `__esModule` of a module counts until a store in another file is found.
    steps.end("modules stored in the cache, markers stored");
    let mocked = find_mocked_modules(input, &scans, &modules);
    let (tables, imports) = loop {
        texts.forget_markers(&newly_stored_markers);
        stored_markers.extend(newly_stored_markers);
        let entries = entries
            .take()
            .unwrap_or_else(|| collect_export_entries(input, &scans, &modules));
        steps.end("export entries of this round");
        let tables = resolve_exports(input.files, &scans, &modules, entries, &texts, &mocked);
        steps.end("resolve_exports");
        sites.settle(input.files, &modules, &tables);
        steps.end("sites.settle");
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
        steps.end("bind_imports");
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
    let mut behind_stars_of_files_above = Vec::new();
    for module in input.modules_that_mocked_files_export_whole {
        let Some(module) = replaced_modules.find(module) else {
            continue;
        };
        let Some(file) = modules.table_file(module) else {
            replaced_without_table.push(module);
            continue;
        };
        for &(_, resolved) in tables.names(file) {
            replace(resolved.resolution);
        }
        if tables.has_dynamic_names(module) {
            let behind = find_modules_behind_stars(input, &scans, &modules, file);
            behind_stars_of_files_above.extend(behind);
        }
    }
    // In a test run a namespace object that goes somewhere may reach a spy that takes an object from somewhere. The engine would find
    // that out behind a whole run of the flow analysis, and the program would be compiled again.
    let mocked_modules = imports.iter().flat_map(|file| &file.mocked_modules);
    let mut mocked_modules: FxHashSet<ModuleRef> = mocked_modules.copied().collect();
    let mut named_by_mocks = mocked_modules.clone();
    mocked_modules.extend(replaced_without_table);
    mocked_modules.extend(behind_stars_of_files_above);
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
    // A test file of a layer above spies on the object of a file under a name that it computes. `export * from "./common.cjs"`: the names of that module show at run time,
    // and whoever holds the object of the file reaches them. See `namespaces_spied_on_whole` for a test file of this build.
    for module in input.mocked_modules {
        let Some(module) = replaced_modules.find(module) else {
            continue;
        };
        if let Some(file) = modules.table_file(module)
            && tables.has_dynamic_names(module)
        {
            mocked_modules.extend(find_modules_behind_stars(input, &scans, &modules, file));
        }
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
    // Whether somebody passes a helper its names is for the scan of the test files to say, which reads them all, also for a program that lies below them: it tells
    // the names, and the modules whose objects go into a call. Flow opens nothing for an object and a name that it does not know.
    let loads_by_unknown_path =
        input.tests_load_by_unknown_path || imports.iter().any(|file| file.loads_by_unknown_path);
    let is_any_name_spied_on =
        input.spies_on_unknown_objects || spies.clone().any(|it| it.is_any_name);
    if input.runs_tests && logs_stages() {
        for (&file, of_file) in modules.compiled_files.iter().zip(&imports) {
            if of_file.spies_on_unknown_objects.is_any_name {
                bun_core::print_errorln!(
                    "AOT test run | {} lets spyOn go where nobody sees what it is called with",
                    bstr::BStr::new(input.files.module(file).file_name()),
                );
            }
        }
    }
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
                || (!input.names_spied_in_text.is_empty() && loads_by_unknown_path))
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
                named_by_mocks.insert(ModuleRef::File(file));
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
    if input.runs_tests && logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | variables that tests may replace {} in {} files | modules that may be mocked {} | a spy under any name {} | names that spies on objects from somewhere spell {} | such a spy may reach any module {}",
            replaced_variables.len(),
            modules.compiled_files.len(),
            mocked_modules.len(),
            is_any_name_spied_on,
            names_spied_on.len(),
            spy_may_reach_any_module,
        );
    }
    let replaced = ReplacedNames {
        names: &replaced_names,
        modules: &mocked_modules,
        is_every_module: mocks_any_module || spy_may_reach_any_module,
    };
    steps.end("what tests replace, mock and spy on");
    let synthetic = number_synthetic_exports(input, &modules, &tables, &imports, &texts, replaced);
    steps.end("number_synthetic_exports");
    let ((mut pending, requests, is_library), mut commonjs_exports) = run_beside(
        input.beside,
        || {
            (
                collect_pending_failures(&scans, &modules, &tables, &imports),
                finish_requests(&scans, &modules, &tables, &order, &sites, &mocked_modules),
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
    steps.end("requests beside CommonJS exports");
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
    steps.end("failures, drafts");
    let leads_to_mock = find_files_that_lead_to_mocks(&scans, &tables, &modules, &named_by_mocks);
    let reaches_mock = find_files_that_reach_mocks(&drafts, &named_by_mocks);
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
        let mut handed_on = Vec::new();
        let mut named_by_stars = Vec::new();
        if is_compiled && (mocked.is_every_module() || mocked.iter().next().is_some()) {
            let named = tables.files_named_by_stars(file);
            named_by_stars
                .extend(named.filter(|next| mocks_any_module || leads_to_mock.contains(next)));
            let names = tables.own_names(file).iter().enumerate();
            handed_on.extend(names.filter_map(|(position, &(name, _))| {
                let (site, asked) = tables.find_indirect_name(file, position)?;
                match scans.of(file).sites[site as usize] {
                    ScannedSite::Module(target) => Some((name, (target, asked))),
                    _ => None,
                }
            }));
            handed_on.sort_unstable_by_key(|&(name, _): &(Atom, _)| name.0);
        }
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
            handed_on,
            named_by_stars,
            reaches_mock: reaches_mock.contains(&file),
        }
    });
    steps.end("rows");
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
    for &module in &named_by_mocks {
        plan.set_is_named_by_mock(module);
    }
    if mocks_any_module {
        plan.set_every_module_may_be_mocked();
    }
    // Only a build that holds every file of the tests sees who asks. A layer below them has a file of the runner's in their place, and code that a run loads from disk
    // gets `vi` and `jest` like any other.
    let asks_for_original = |&&file: &&FileId| {
        let Some(source) = parsed_source(input.files, file) else {
            return false;
        };
        is_written_by_test_runner(input.files.module(file).file_name())
            || asks_for_original_beside_mock(
                input.files.hir(file),
                input.files.bound(file),
                input.files.analysis(file),
                &source.builtins,
                &input.files.atoms,
                &|site| {
                    matches!(
                        scans.of(file).sites[site],
                        ScannedSite::Module(ModuleRef::Runtime(RuntimeModule::BunTest))
                    )
                },
            )
    };
    let asking_file = modules.compiled_files.iter().find(asks_for_original);
    let runs_code_out_of_sight = input.loads_code_from_disk || input.host_runs_files_from_disk;
    if mocks_any_module || runs_code_out_of_sight || asking_file.is_some() {
        plan.set_originals_beside_mocks_may_run();
    }
    if let (Some(&file), true) = (asking_file, input.runs_tests && logs_stages()) {
        bun_core::print_errorln!(
            "AOT test run | the original beside a mock may run: {} may ask for it",
            bstr::BStr::new(input.files.module(file).file_name()),
        );
    }
    if input.runs_tests && mocks_any_module {
        plan.set_test_runner_hands_out_every_runtime_module();
    }
    for &file in modules.compiled_files.iter().filter(|_| input.runs_tests) {
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, answer) in sites.zip(&scans.of(file).sites) {
            let is_asked_of_test_runner = matches!(
                site.kind,
                ImportSiteKind::MockModule(_)
                    | ImportSiteKind::ImportByTestRunner(_)
                    | ImportSiteKind::RequireByTestRunner(_)
            );
            let loads = matches!(
                site.kind,
                ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_)
                    | ImportSiteKind::ImportCall(_)
                    | ImportSiteKind::Require(_)
                    | ImportSiteKind::ImportMetaRequire(_)
            );
            if let (true, ImportSpecifier::Constant(written), &ScannedSite::Module(module)) =
                (loads, site.specifier, answer)
                && let ModuleRef::File(target) = module
                && let written = input.files.atoms.bytes(written)
                && let Some(spelling) = find_spelling(input.sources, file, written, target)
            {
                plan.set_is_reached_by(module, spelling);
            }
            match *answer {
                _ if !is_asked_of_test_runner => {}
                ScannedSite::Module(ModuleRef::Runtime(module)) => {
                    plan.set_is_handed_out_by_test_runner(module);
                }
                ScannedSite::Module(_) | ScannedSite::Unresolved | ScannedSite::Erased => {}
                ScannedSite::AllModules | ScannedSite::Candidates(_) => {
                    plan.set_test_runner_hands_out_every_runtime_module();
                }
            }
        }
    }
    if input.runs_tests {
        plan.set_runs_tests();
    }
    if input.only_tests_load_code_from_disk {
        for &file in input.files.compiled_files() {
            let Some(source) = parsed_source(input.files, file) else {
                continue;
            };
            if !source.is_of_tests() {
                plan.set_loads_compiled_files_alone(ModuleRef::File(file));
            }
            if source.finds_builtins_read_only() {
                plan.set_finds_builtins_read_only(ModuleRef::File(file));
            }
        }
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
    for module in find_files_that_run_again(input, &scans, &modules, &evicted) {
        plan.set_runs_again(module);
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
    if program_names_plugin(input) {
        plan.set_names_plugin();
    }
    if evicted.is_table_reached() {
        plan.set_reaches_entries_of_cache();
    }
    if evicted.are_entries_read() {
        plan.set_reads_entries_of_cache();
    }
    for module in evicted.asked_for_any_export() {
        plan.set_every_export_is_asked_for(module);
        // The copy is code that the build has not seen, and it calls what it imports from a module of Bun's own.
        if let ModuleRef::Runtime(module) = module {
            plan.set_is_handed_out_by_test_runner(module);
        }
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
        requests_that_bind_nothing: Vec::new(),
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
        member_stores: (0..file_count).map(|_| OnceLock::new()).collect(),
    };
    steps.end("the plan, the graph");
    let graph = graph.finish(input.in_parallel);
    steps.end("graph.finish");
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
    /// A file of a program below this one, under its path, as each of its importers here names it.
    files_of_other_programs: FxHashMap<&'a [u8], Vec<ModuleRef>>,
}

impl<'a> ReplacedModules<'a> {
    fn new(input: &BindInput<'a, '_>, modules: &ModuleSet) -> ReplacedModules<'a> {
        let names_none = input.replaced_exports.is_empty()
            && input.mocked_modules.is_empty()
            && input.modules_that_mocked_files_export_whole.is_empty()
            && input.handed_on_modules.is_empty();
        match names_none {
            true => ReplacedModules {
                files: FxHashMap::default(),
                files_of_other_programs: FxHashMap::default(),
            },
            false => ReplacedModules::of_every_file(input, modules),
        }
    }

    fn of_every_file(input: &BindInput<'a, '_>, modules: &ModuleSet) -> ReplacedModules<'a> {
        let files = modules.record_files.iter();
        let mut files_of_other_programs: FxHashMap<&'a [u8], Vec<ModuleRef>> = FxHashMap::default();
        for &module in &modules.other_modules {
            if let ModuleRef::External { specifier, .. } = module {
                let path = input.files.atoms.bytes(specifier);
                files_of_other_programs
                    .entry(path)
                    .or_default()
                    .push(module);
            }
        }
        ReplacedModules {
            files: files
                .map(|&file| (input.files.module(file).file_name(), file))
                .collect(),
            files_of_other_programs,
        }
    }

    fn find_in_other_programs(&self, module: &ReplacedModule) -> &[ModuleRef] {
        let found = module
            .file_path()
            .and_then(|path| self.files_of_other_programs.get(&path[..]));
        found.map_or(&[][..], |modules| &modules[..])
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
/// The files that a mock names, and whoever comes to one of them by requests.
fn find_files_that_reach_mocks(
    drafts: &[(FileId, Vec<ModuleRequest>, Option<FileImports>)],
    named_by_mocks: &FxHashSet<ModuleRef>,
) -> FxHashSet<FileId> {
    let files_of_mocks = named_by_mocks.iter().filter_map(|&module| match module {
        ModuleRef::File(file) | ModuleRef::Face(file) => Some(file),
        _ => None,
    });
    let mut reaching: FxHashSet<FileId> = files_of_mocks.collect();
    if reaching.is_empty() {
        return reaching;
    }
    let mut requested_by: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    for (file, requests, _) in drafts {
        for request in requests {
            let (ModuleRef::File(target)
            | ModuleRef::Face(target)
            | ModuleRef::Check(target)
            | ModuleRef::Inner { file: target, .. }) = request.target
            else {
                continue;
            };
            requested_by.entry(target).or_default().push(*file);
        }
    }
    let mut pending: Vec<FileId> = reaching.iter().copied().collect();
    while let Some(file) = pending.pop() {
        for &from in requested_by.get(&file).into_iter().flatten() {
            if reaching.insert(from) {
                pending.push(from);
            }
        }
    }
    reaching
}

/// The files from which `export *` and names that are handed on lead to a file that a mock names, and those files.
fn find_files_that_lead_to_mocks(
    scans: &Scans,
    tables: &ExportTables,
    modules: &ModuleSet,
    named_by_mocks: &FxHashSet<ModuleRef>,
) -> FxHashSet<FileId> {
    let files_of_mocks = named_by_mocks.iter().filter_map(|&module| match module {
        ModuleRef::File(file) => Some(file),
        _ => None,
    });
    let mut leading: FxHashSet<FileId> = files_of_mocks.collect();
    if leading.is_empty() {
        return leading;
    }
    let mut named_from: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
    for &file in &modules.compiled_files {
        let positions = 0..tables.own_names(file).len();
        let by_name = positions.filter_map(|position| {
            let (site, _) = tables.find_indirect_name(file, position)?;
            match scans.of(file).sites[site as usize] {
                ScannedSite::Module(ModuleRef::File(target)) => Some(target),
                _ => None,
            }
        });
        for target in tables.files_named_by_stars(file).chain(by_name) {
            let from = named_from.entry(target).or_default();
            if from.last() != Some(&file) {
                from.push(file);
            }
        }
    }
    let mut pending: Vec<FileId> = leading.iter().copied().collect();
    while let Some(file) = pending.pop() {
        for &from in named_from.get(&file).into_iter().flatten() {
            if leading.insert(from) {
                pending.push(from);
            }
        }
    }
    leading
}

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
