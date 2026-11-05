mod bindings;
mod commonjs_exports;
mod deferred_exports;
mod evicted;
mod exports;
mod failures;
mod graph;
mod imports;
mod interop;
#[cfg(test)]
mod kept_frames_tests;
mod known_members;
mod module_set;
mod namespace_members;
mod order;
mod plan;
mod referents;
mod requests;
mod side_effects;
mod spelled_files;
mod synthetic_exports;
mod test_replacements;
mod test_run_evictions;
mod test_run_names_handed_on;
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
pub(crate) use commonjs_exports::find_literal_exported_under_name;
pub use deferred_exports::DeferredExports;
pub use failures::{FailureEffect, ModuleFailure, ModuleFailureId, ModuleFailureKind};
pub use graph::ModuleGraph;
pub use interop::{ImportPhase, Interop, ModuleKind, RequireResult, SyntheticExportRule};
pub(crate) use known_members::{KnownMemberValues, KnownObjects, Validity, is_enum};
pub use plan::{Member, ModuleRef, Shape, Site, View};
pub use referents::{Library, LinkedProject, find_name_stored_as_module_exports};
pub use requests::Spelling;
pub(crate) use spelled_files::directory_of;
pub(crate) use test_replacements::asks_for_original_beside_mock;
pub use wrapped::{InnerModule, InnerModuleKind, WrappedModules};
pub(crate) use written_descriptor::{DescribedPart, WrittenDescriptor};

use crate::builtins::id::BuiltinId;
use crate::builtins::{BuiltinNames, Platforms, RuntimeModule, table};
use crate::ir::InParallel;
use crate::ir::parallel::map_each;
use crate::known_helpers::KnownHelpers;
use crate::link::{Beside, run_steps_beside};
use crate::load::sources::parsed_source;
use crate::load::{EntryPointKind, SourceKind, Sources};
use crate::statistics::{Stage, StepClock};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::StmtId;
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files, Sym};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use commonjs_exports::{CommonJsInput, scan_commonjs_modules};
use core::cmp::Ordering;
use evicted::{find_evicted_modules, find_files_that_run_again};
use exports::{
    ExportTables, Resolution, collect_export_entries, find_ambiguous_names, finish_exports,
    resolve_exports,
};
use failures::{PendingFailure, number_failures};
use graph::{FileRow, StarNamesLeftOut, find};
use imports::{
    FileImports, bind_imports, find_mocked_modules, finish_bindings, finish_named_members,
};
use interop::file_interop;
use module_set::{ModuleSet, collect_modules};
use order::{SiteKey, SitePosition, compute_order};
use plan::{Plan, StoredSite};
use requests::{
    ScannedSite, Scans, find_spelling, finish_requests, finish_site_answers,
    leave_imports_of_test_files_to_loader, scan_files,
};
use side_effects::is_declared_free_of_side_effects;
use std::sync::OnceLock;
use synthetic_exports::{ReplacedNames, number_synthetic_exports};
use test_run_names_handed_on::NamesHandedOn;
use unloadable::{
    drop_errors_of_unloadable_modules, find_files_that_sites_name, find_unloadable_modules,
    let_late_commonjs_files_fail_at_load, let_unlinkable_modules_fail_at_load,
};

pub struct BindInput<'a, 's> {
    pub files: &'a Files<'s>,
    pub sources: &'a Sources,
    pub builtin_names: &'a BuiltinNames,
    pub deferred_exports: &'a DeferredExports,
    pub known_helpers: &'a KnownHelpers,
    pub platform: Platforms,
    pub external_packages: &'a [Vec<u8>],
    pub replaced_builtins: &'a [u32],
    pub names_added_to_builtins: &'a [(BuiltinId, Atom)],
    pub runs_in_place: bool,
    pub ignores_declared_side_effects: bool,
    pub mocks_any_module: bool,
    pub mocked_library_modules: &'a [RuntimeModule],
    pub hands_on_any_module: bool,
    pub any_module_loads_again: bool,
    pub runs_tests: bool,
    pub runner_starts_entry_points: bool,
    pub written_entry_point_count: usize,
    pub entry_points_run_again: bool,
    pub typescript_drops_absent_exports: bool,
    pub runs_in_several_realms: bool,
    pub files_are_named_out_of_sight: bool,
    pub helpers_of_tests_name_files: bool,
    pub(crate) run: &'a crate::test_runs::RunContents,
    pub in_parallel: InParallel<'a>,
    pub beside: Beside<'a>,
}

impl BindInput<'_, '_> {
    pub(in crate::modules) fn is_plain_name(&self, name: Atom) -> bool {
        let atoms = &self.files.atoms;
        let is_index = atoms.bytes(name).first().is_some_and(u8::is_ascii_digit);
        let listed = self.builtin_names.get(name);
        let is_member = listed
            .is_some_and(|name| table::own_member(BuiltinId::ObjectPrototype, name).is_some());
        let sought = (BuiltinId::ObjectPrototype, atoms.bytes(name));
        let added = self.names_added_to_builtins;
        let is_added = added
            .binary_search_by(|&(holder, laid)| (holder, atoms.bytes(laid)).cmp(&sought))
            .is_ok();
        !is_index && !is_member && !is_added && name != known::__proto__
    }
}

pub struct BoundModules {
    pub graph: ModuleGraph,
}

pub fn bind_modules(input: &BindInput<'_, '_>) -> BoundModules {
    let file_count = input.files.modules.len();
    let mut steps = StepClock::new(Stage::BindModules);
    let mut scans = scan_files(input);
    steps.end("bind: scan files");
    let_late_commonjs_files_fail_at_load(input, &mut scans);
    let mut unloadable = find_unloadable_modules(input, &mut scans);
    let evicted = find_evicted_modules(input, &scans);
    steps.end("bind: unloadable and evicted modules");
    let may_load_again = |file: FileId| {
        evicted.contains(ModuleRef::File(file))
            && match input.sources.kind(file) {
                SourceKind::Program => {
                    let kind = file_interop(input.files, input.sources, file).kind;
                    matches!(kind, ModuleKind::SourceText | ModuleKind::CommonJs)
                }
                SourceKind::Data => true,
                _ => false,
            }
    };
    leave_imports_of_test_files_to_loader(input, &mut scans, &may_load_again);
    let mut modules = collect_modules(input, &scans);
    steps.end("bind: collect modules: the modules");
    let mut run_again = find_files_that_run_again(input, &scans, &modules, &evicted);
    if input.entry_points_run_again {
        let entry_points = input.sources.entry_points().iter();
        run_again.extend(entry_points.map(|entry_point| ModuleRef::File(entry_point.file)));
    }
    steps.end("bind: collect modules: files that run again");
    modules.find_inner_modules(input, &run_again);
    let modules = modules;
    steps.end("bind: collect modules: modules inside files");
    let ((order, mut sites), entries) = run_steps_beside(
        input.beside,
        &mut steps,
        ["bind: order", "entries of exports"],
        || compute_order(input, &scans, &modules),
        || collect_export_entries(input, &scans, &modules),
    );
    let commonjs_input = CommonJsInput {
        bind: input,
        scans: &scans,
        modules: &modules,
        half: &|module: ModuleRef| order.half(module),
        half_at_link: &|module: ModuleRef| order.half_at_link(module),
        is_prefix_root: &|file: FileId| order.is_prefix_root(file),
    };
    let texts = scan_commonjs_modules(&commonjs_input);
    steps.end("bind: scan CommonJS modules");
    let stored_markers: FxHashSet<ModuleRef> =
        texts.markers_stored_from_outside().into_iter().collect();
    let mocked = find_mocked_modules(input, &scans, &modules);
    let names_without_code = mocked.names_without_code.clone();
    let tables = resolve_exports(input, &scans, &modules, entries, &texts, &mocked);
    sites.settle(input.files, &modules, &tables);
    steps.end("bind: resolve exports");
    let find_marker = |module: ModuleRef| match modules.interop(module).kind {
        _ if stored_markers.contains(&module) => None,
        ModuleKind::SourceText => Some(true),
        ModuleKind::CommonJs => texts.marker(module),
        _ => None,
    };
    let mut imports = bind_imports(
        input,
        &scans,
        &modules,
        &tables,
        &order,
        &sites,
        &find_marker,
        &evicted,
    );
    steps.end("bind: imports");
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
    let mocked_modules = imports.iter().flat_map(|file| &file.mocked_modules);
    let mut mocked_modules: FxHashSet<ModuleRef> = mocked_modules.copied().collect();
    if !input.run.modules_replaced_in_text.is_empty() {
        for &file in &modules.compiled_files {
            let path = input.files.module(file).file_name();
            if input.run.is_replaced_in_text(&input.files.atoms, path) {
                mocked_modules.insert(ModuleRef::File(file));
            }
        }
    }
    let named_by_mocks = mocked_modules.clone();
    let named_here = named_by_mocks.iter().filter_map(|&module| match module {
        ModuleRef::Runtime(module) => Some(module),
        _ => None,
    });
    let named_by_application = input.mocked_library_modules.iter().copied();
    let mocked_es_modules_of_library: Vec<RuntimeModule> = named_here
        .chain(named_by_application)
        .filter(|&module| table::is_es_module(module))
        .collect();
    if !mocked_es_modules_of_library.is_empty() {
        for &file in &modules.compiled_files {
            if let SourceKind::RuntimeModule(module) = input.sources.kind(file)
                && mocked_es_modules_of_library.contains(&module)
            {
                mocked_modules.insert(ModuleRef::File(file));
            }
        }
    }
    let mocked_files_with_stars = mocked_modules.iter().filter_map(|&module| {
        let file = modules.table_file(module)?;
        tables.has_dynamic_names(module).then_some(file)
    });
    let mocked_files_with_stars: Vec<FileId> = mocked_files_with_stars.collect();
    for file in mocked_files_with_stars {
        mocked_modules.extend(find_modules_behind_stars(input, &scans, &modules, file));
    }
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
    let names_spied_on = spies.clone().flat_map(|it| &it.names);
    let names_spied_on = names_spied_on.chain(&input.run.names_spied);
    let names_spied_on: FxHashSet<Atom> = names_spied_on.copied().collect();
    let is_any_name_spied_on =
        input.run.spies_under_any_name || spies.clone().any(|it| it.is_any_name);
    if input.runs_tests && (is_any_name_spied_on || !names_spied_on.is_empty()) {
        let handed_out = imports.iter().flat_map(|file| &file.namespaces_handed_out);
        let mut handed_out: FxHashSet<ModuleRef> = handed_out.copied().collect();
        for &file in &modules.compiled_files {
            handed_out.extend(tables.names(file).iter().filter_map(|&(_, resolved)| {
                match resolved.resolution {
                    Resolution::Namespace { module, .. } => Some(module),
                    _ => None,
                }
            }));
        }
        if input.hands_on_any_module {
            spy_may_reach_any_module = true;
            let files = modules.compiled_files.iter();
            handed_out.extend(files.map(|&file| ModuleRef::File(file)));
        }
        for &module in &handed_out {
            let Some(file) = modules.table_file(module) else {
                mocked_modules.insert(module);
                continue;
            };
            let is_source_text = modules.interop(module).kind == ModuleKind::SourceText;
            for &(name, resolved) in tables.names(file) {
                if is_any_name_spied_on || !is_source_text || names_spied_on.contains(&name) {
                    replace(resolved.resolution);
                }
            }
            if !tables.has_dynamic_names(module) {
                continue;
            }
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
        for &file in &modules.compiled_files {
            if scans.of(file).interop.kind == ModuleKind::Data {
                for &(_, resolved) in tables.names(file) {
                    replace(resolved.resolution);
                }
            }
        }
    }
    if !input.run.exports_spied_in_text.is_empty() {
        for &file in &modules.compiled_files {
            let path = input.files.module(file).file_name();
            for name in input.run.names_spied_in_text_on(&input.files.atoms, path) {
                replace(
                    tables
                        .resolve_in(&modules, ModuleRef::File(file), name)
                        .resolution,
                );
            }
        }
    }
    for &module in imports
        .iter()
        .flat_map(|file| &file.namespaces_spied_on_whole)
    {
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
    if modules.has_sibling_forms() {
        for &file in &modules.compiled_files {
            let has_siblings = || {
                let siblings = modules.sibling_forms_of_kind(ModuleRef::File(file), None);
                siblings.count() != 0
            };
            if scans.of(file).interop.kind == ModuleKind::Data && has_siblings() {
                for &(_, resolved) in tables.names(file) {
                    replace(resolved.resolution);
                }
            }
        }
    }
    let mocks_any_module =
        input.mocks_any_module || imports.iter().any(|file| file.mocks_any_module);
    if mocks_any_module {
        let files = modules.compiled_files.iter();
        mocked_modules.extend(files.map(|&file| ModuleRef::File(file)));
    }
    let mocked_files = mocked_modules.iter();
    for file in mocked_files.filter_map(|&module| modules.table_file(module)) {
        for &(_, resolved) in tables.names(file) {
            replace(resolved.resolution);
        }
    }
    let replaced = ReplacedNames {
        names: &replaced_names,
        modules: &mocked_modules,
        is_every_module: mocks_any_module || spy_may_reach_any_module,
    };
    if input.runs_tests {
        crate::test_run_report::say_what_tests_replace(
            replaced_variables.len(),
            modules.compiled_files.len(),
            mocked_modules.len(),
            is_any_name_spied_on,
            names_spied_on.len(),
            spy_may_reach_any_module,
        );
    }
    steps.end("bind: what mocks and spies replace");
    let synthetic = number_synthetic_exports(input, &modules, &tables, &imports, &texts, replaced);
    steps.end("bind: number synthetic exports");
    let ((mut pending, requests, is_library, files_that_sites_name), mut commonjs_exports) =
        run_steps_beside(
            input.beside,
            &mut steps,
            ["bind: failures, requests", "exports of CommonJS modules"],
            || {
                (
                    collect_pending_failures(&scans, &modules, &tables, &imports),
                    finish_requests(&scans, &modules, &tables, &order, &sites, &mocked_modules),
                    find_library_files(input),
                    find_files_that_sites_name(input, &scans),
                )
            },
            || CommonJsExports::finish(&commonjs_input, texts, &tables, &imports, &synthetic),
        );
    for file_imports in &imports {
        for &module in &file_imports.exports_values {
            commonjs_exports.look_at(module);
        }
        for &(accessed, owner, name) in &file_imports.called_members {
            if !commonjs_exports.ignores_this(owner, name) {
                commonjs_exports.look_at(accessed);
            }
        }
    }
    for &(module, _) in &replaced_names {
        commonjs_exports.look_at(module);
    }
    for file_imports in &imports {
        for &(module, name) in &file_imports.called_namespace_members {
            commonjs_exports.call_through_namespace(module, name);
        }
    }
    let_unlinkable_modules_fail_at_load(
        input,
        &scans,
        &files_that_sites_name,
        &mut pending,
        &mut imports,
        &mut unloadable,
    );
    drop_errors_of_unloadable_modules(&mut pending, &unloadable);
    let failures = number_failures(file_count, pending);
    commonjs_exports.number_checks(&failures);
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
    let reaches_mock =
        find_files_that_reach_mocks(&drafts, &requests.inner_modules, &named_by_mocks);
    let names_handed_on = NamesHandedOn::find(
        &scans,
        &tables,
        &modules,
        &mocked,
        &named_by_mocks,
        mocks_any_module,
    );
    let mut is_left_to_loader = vec![false; file_count];
    for &(_, file) in &modules.left_to_loader {
        is_left_to_loader[file.idx()] = true;
    }
    steps.end("bind: what follows for the rows");
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
            names_read_on_answers: imports.names_read_on_answers,
            exports,
            ambiguous_names: match is_compiled {
                true => find_ambiguous_names(files, &tables, file),
                false => Vec::new(),
            },
            unread_exports: Vec::new(),
            is_left_to_loader: is_left_to_loader[file.idx()],
            required_names: imports.required_names,
            names_searched_behind_stars: imports.names_searched_behind_stars,
            handed_on: names_handed_on.names_of(file, is_compiled),
            named_by_stars: names_handed_on.files_named_by_stars(file, is_compiled),
            names_from_stars: names_handed_on.names_from_stars(file, is_compiled),
            reaches_mock: reaches_mock.contains(&file),
        }
    });
    steps.end("bind: rows");
    let (errors, failures) = failures.into_lists();
    let mut plan = Plan::new(order.into_parts(), erased_statements);
    for &module in &stored_markers {
        plan.set_marker_is_stored(module);
    }
    for &module in &imported_namespaces {
        plan.set_is_imported_as_namespace(module);
    }
    plan.set_replaced_variables(replaced_variables);
    plan.set_names_without_code_that_mocks_give(names_without_code);
    plan.test_run = input.run.plan_of_files();
    test_run_evictions::fill_plan_of_loads(input, evicted.modules(), &mut plan);
    for &module in &mocked_modules {
        plan.set_may_be_mocked(module);
    }
    let mut named_in_order: Vec<ModuleRef> = named_by_mocks.iter().copied().collect();
    named_in_order.shared_sort_unstable_by(|&a, &b| compare_modules(a, b, &input.files.atoms));
    for module in named_in_order {
        plan.set_is_named_by_mock(module);
    }
    if mocks_any_module {
        plan.set_every_module_may_be_mocked();
    }
    let asks_for_original = |&file: &FileId| {
        let Some(source) = parsed_source(input.files, file) else {
            return false;
        };
        asks_for_original_beside_mock(
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
    let is_any_module_named_by_mock = mocks_any_module || !named_by_mocks.is_empty();
    if is_any_module_named_by_mock
        && (mocks_any_module
            || input.files_are_named_out_of_sight
            || modules.compiled_files.iter().any(asks_for_original))
    {
        plan.set_originals_beside_mocks_may_run();
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
    for module in run_again {
        let is_es_module = modules.interop(module).kind == ModuleKind::SourceText;
        plan.set_runs_again(module, is_es_module);
    }
    test_run_evictions::fill_plan_of_copies(input, &scans, &modules, &evicted, &mocked, &mut plan);
    if evicted.is_every_module() {
        plan.set_every_module_may_be_evicted();
    }
    if input.runs_tests {
        plan.set_reaches_entries_of_cache(evicted.is_table_reached());
    }
    plan.set_library_modules_stored_in_cache(evicted.library_modules_stored_in_cache());
    let mocked_library_modules = mocked_modules.iter().filter_map(|&module| match module {
        ModuleRef::Runtime(module) => Some(module),
        _ => None,
    });
    let mut mocked_library_modules: Vec<RuntimeModule> = mocked_library_modules.collect();
    mocked_library_modules.shared_sort_unstable();
    let inner_requests = requests.inner_modules.into_iter();
    plan.inner_requests = inner_requests.map(|(_, requests)| requests).collect();
    let leaves_out_names = |file: &&FileId| tables.leaves_out_names(**file);
    let star_names_left_out = StarNamesLeftOut {
        names: tables.names_left_out().clone(),
        files: (modules
            .record_files
            .iter()
            .filter(leaves_out_names)
            .copied())
        .collect(),
    };
    let laid = input.names_added_to_builtins.iter();
    let laid = laid.filter(|added| added.0 == BuiltinId::ObjectPrototype);
    let laid = laid.map(|added| input.files.atoms.bytes(added.1).into());
    let laid_over = input.replaced_builtins.iter();
    let laid_over = laid_over.filter_map(|&member| BuiltinId::from_wire(member).map(table::entry));
    let laid_over = laid_over.filter(|member| member.holder == Some(BuiltinId::ObjectPrototype));
    let laid_over = laid_over.map(|member| table::text_of_name(member.name).into());
    let mut names_laid_on_object_prototype: Vec<Box<[u8]>> = laid.chain(laid_over).collect();
    names_laid_on_object_prototype.shared_sort_unstable();
    names_laid_on_object_prototype.dedup();
    let graph = ModuleGraph {
        row_by_file: vec![None; file_count],
        rows,
        record_files: Vec::new(),
        left_out_files: Vec::new(),
        placeholder_files: Vec::new(),
        left_out_inner_modules: Vec::new(),
        other_modules: modules.other_modules,
        external_kinds: modules.external_kinds,
        synthetic_exports: synthetic.into_list(),
        errors,
        failures,
        load_failures,
        files_that_sites_name,
        mocked_library_modules,
        wrapped: modules.wrapped,
        commonjs_exports,
        plan,
        member_stores: (0..file_count).map(|_| OnceLock::new()).collect(),
        data_linked_by_names_alone: Box::default(),
        forms_require_checks_first: modules.forms_require_checks_first,
        star_names_left_out,
        names_laid_on_object_prototype,
    };
    let graph = graph.finish();
    steps.end("bind: plan and graph");
    BoundModules { graph }
}

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
        let Some(scan) = scans.find(file) else {
            continue;
        };
        let sites = input.files.analysis(file).import_sites.iter();
        for (site, scanned) in sites.zip(&scan.sites) {
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

fn find_files_that_reach_mocks(
    drafts: &[(FileId, Vec<ModuleRequest>, Option<FileImports>)],
    requests_of_inner_modules: &[(ModuleRef, Vec<ModuleRequest>)],
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
    let of_files = drafts.iter().map(|(file, requests, _)| (*file, requests));
    let of_inner_modules = requests_of_inner_modules
        .iter()
        .filter_map(|(module, requests)| match *module {
            ModuleRef::Inner { file, .. } => Some((file, requests)),
            _ => None,
        });
    for (file, requests) in of_files.chain(of_inner_modules) {
        for request in requests {
            let (ModuleRef::File(target)
            | ModuleRef::Face(target)
            | ModuleRef::Check(target)
            | ModuleRef::Inner { file: target, .. }) = request.target
            else {
                continue;
            };
            requested_by.entry(target).or_default().push(file);
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
            let mut failures = lists.concat();
            if imports.fails_where_it_is_linked {
                failures.retain(|pending| {
                    pending.failure.exporter().is_none()
                        || pending.failure.effect() != FailureEffect::StopsBuild
                });
            }
            (file, failures)
        })
        .collect()
}
