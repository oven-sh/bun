mod bindings;
mod commonjs_exports;
mod deferred_data;
mod deferred_exports;
mod exports;
mod failures;
mod graph;
mod imports;
mod interop;
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

pub use bindings::{
    AccessedModule, Candidates, ExportBinding, ExportLookup, ExportUse, Holder, ImportBinding,
    ModuleExport, ModuleRequest, RequiredName, SiteAnswer, SpelledModule, SyntheticExport,
    SyntheticExportId,
};
pub use bun_core::strings::order_utf16 as compare_code_units;
pub use commonjs_exports::CommonJsExports;
pub use deferred_data::{DeferredData, bundle_pages};
pub use deferred_exports::DeferredExports;
pub use failures::{FailureEffect, ModuleFailure, ModuleFailureId, ModuleFailureKind};
pub use graph::ModuleGraph;
pub use interop::{ImportPhase, Interop, ModuleKind, RequireResult, SyntheticExportRule};
pub use plan::{Member, ModuleRef, Shape, Site, View};
pub use referents::{Library, LinkedProject};
pub use wrapped::{InnerModule, InnerModuleKind, WrappedModules};

use crate::builtins::{BuiltinNames, Platforms};
use crate::ir::InParallel;
use crate::ir::parallel::map_each;
use crate::known_helpers::KnownHelpers;
use crate::load::{EntryPointKind, SourceKind, Sources};
use crate::statistics::{Counters, LimitId, StatisticId};
use bun_sema::atom::Interner;
use bun_sema::hir::StmtId;
use bun_sema::program::{FileId, Files};
use bun_sema::util::SharedSort;
use commonjs_exports::{CommonJsInput, InnerCommonJs, scan_commonjs_modules};
use core::cmp::Ordering;
use exports::{ExportTables, collect_export_entries, finish_exports, resolve_exports};
use failures::{PendingFailure, number_failures};
use graph::FileRow;
use imports::{FileImports, bind_imports, finish_bindings, finish_named_members};
use module_set::{ModuleSet, collect_modules};
use order::{SiteKey, SitePosition, compute_order};
use plan::{Plan, StoredSite};
use requests::{Scans, finish_requests, finish_site_answers, scan_files};
use side_effects::is_declared_free_of_side_effects;
use synthetic_exports::number_synthetic_exports;
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
    pub application: Option<&'a ApplicationGraph<'a>>,
    pub in_parallel: InParallel<'a>,
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
}

pub struct BoundModules {
    pub graph: ModuleGraph,
    pub counters: Counters,
}

pub fn bind_modules(input: &BindInput<'_, '_>) -> BoundModules {
    let file_count = input.files.modules.len();
    let mut scans = scan_files(input);
    let unloadable = find_unloadable_modules(input, &mut scans);
    let modules = collect_modules(input, &scans);
    let (order, mut sites) = compute_order(input, &scans, &modules);
    let inner_commonjs_modules = collect_inner_commonjs_modules(&modules, file_count);
    let commonjs_input = CommonJsInput {
        bind: input,
        scans: &scans,
        modules: &modules,
        inner_modules: &|file: FileId| &inner_commonjs_modules[file.idx()][..],
        half: &|module: ModuleRef| order.half(module),
        is_prefix_root: &|file: FileId| order.is_prefix_root(file),
    };
    let texts = scan_commonjs_modules(&commonjs_input);
    let entries = collect_export_entries(input, &scans, &modules);
    let tables = resolve_exports(&scans, &modules, entries, &texts);
    sites.settle(input.files, &modules, &tables);
    let find_marker = |module: ModuleRef| texts.marker(module);
    let imports = bind_imports(
        input,
        &scans,
        &modules,
        &tables,
        &order,
        &sites,
        &find_marker,
    );
    let synthetic = number_synthetic_exports(input, &modules, &tables, &imports, &texts);
    let mut commonjs_exports =
        CommonJsExports::finish(&commonjs_input, texts, &tables, &imports, &synthetic);
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
    let mut pending = collect_pending_failures(&scans, &modules, &tables, &imports);
    drop_errors_of_unloadable_modules(&mut pending, &unloadable);
    let failures = number_failures(file_count, pending);
    let mut load_failures = Vec::with_capacity(unloadable.len());
    let mut erased_statements = find_statements_of_inner_modules(&modules);
    for module in &unloadable {
        load_failures.push((module.file, failures.id_of(module.importer, module.order)));
        let hir = input.files.hir(module.file);
        erased_statements.extend(hir.ids(hir.body).map(|statement| (module.file, statement)));
    }
    let requests = finish_requests(&scans, &modules, &tables, &order, &sites);
    let is_library = find_library_files(input);
    let mut compiled_files = modules.compiled_files.iter().zip(imports).peekable();
    let record_files = modules.record_files.iter().zip(requests.files);
    let drafts: Vec<(FileId, Vec<ModuleRequest>, Option<FileImports>)> = record_files
        .map(|(&file, requests)| {
            let compiled = compiled_files.next_if(|&(&compiled_file, _)| compiled_file == file);
            (file, requests, compiled.map(|(_, imports)| imports))
        })
        .collect();
    debug_assert!(compiled_files.next().is_none());
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
            has_no_side_effects: is_code_of_program
                && !is_library[file.idx()]
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
            jsx: finish_bindings(imports.jsx, &synthetic),
            namespace_values: imports.namespace_values,
            evaluating_sites,
            unread_sites: imports.unread_sites,
            holders: imports.holders,
            exports,
            unread_exports: Vec::new(),
            required_names: imports.required_names,
        }
    });
    let mut counters = Counters::default();
    let module_count = modules.record_files.len() + modules.other_modules.len();
    counters.count(StatisticId::ModulesBound, module_count as u64);
    for &file in &modules.compiled_files {
        for &site in &scans.of(file).sites_over_candidate_limit {
            counters.gave_up(LimitId::MaxComputedSpecifierCandidates, Some(site));
        }
    }
    let (errors, failures) = failures.into_lists();
    let mut plan = Plan::new(order.into_parts(), erased_statements);
    let inner_requests = requests.inner_modules.into_iter();
    plan.inner_requests = inner_requests.map(|(_, requests)| requests).collect();
    let graph = ModuleGraph {
        project: input.sources.project(),
        row_by_file: vec![None; file_count],
        rows,
        record_files: Vec::new(),
        left_out_files: Vec::new(),
        left_out_inner_modules: Vec::new(),
        other_modules: modules.other_modules,
        external_kinds: modules.external_kinds,
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
            },
            External {
                importer: b_importer,
                specifier: b_specifier,
            },
        ) => a_importer
            .cmp(&b_importer)
            .then_with(|| atoms.bytes(a_specifier).cmp(atoms.bytes(b_specifier))),
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
