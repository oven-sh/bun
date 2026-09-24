//! Gets what an imported constant function returns before its importer is visited (`bun_js_parser::visit::const_call`).

use crate::Graph::InputFileFlags;
use crate::bundle_v2::BundleV2;
use crate::bundle_v2::bv2_impl::ResolveImportRecordCtx;
use crate::mal_prelude::*;
use crate::parse_task::{self, ParseTask};
use crate::{Index, IndexInt};
use bun_ast::ast_result::ConstCallValues;
use bun_ast::{Expr, ImportKind, ImportRecord, ImportRecordFlags};
use bun_collections::HashMap;
use bun_js_parser::{ConstCallImport, ConstCallSeed};
use bun_resolver::fs as Fs;
use bun_resolver::fs::PathResolverExt as _;

bun_core::declare_scope!(const_call, hidden);

/// `export { x } from` chains longer than this are not followed.
const MAX_HOPS: u32 = 8;

#[derive(Default)]
pub(crate) struct State {
    /// Files that are parsed but not visited, by source index.
    stopped: HashMap<IndexInt, Stopped>,
    /// File -> the stopped files that wait for it to finish.
    waiters: HashMap<IndexInt, Vec<IndexInt>>,
    /// `Success::const_call_values` of each file that has any.
    values: HashMap<IndexInt, ConstCallValues>,
    /// Files that finished with no AST: a parse error, or an empty file.
    finished_without_ast: Vec<IndexInt>,
}

struct Stopped {
    task: *mut ParseTask,
    requests: Vec<Request>,
}

struct Request {
    import: ConstCallImport<'static>,
    state: RequestState,
}

enum RequestState {
    /// The export `alias` of file `source_index` decides it, once that file finishes.
    WaitingFor {
        source_index: IndexInt,
        alias: &'static [u8],
        hops: u32,
    },
    Known(Expr),
    Unknown,
}

enum Lookup {
    Value(Expr),
    /// A re-export: ask this file next.
    Follow(IndexInt, &'static [u8]),
    NotFinished,
    Unknown,
}

impl State {
    #[inline]
    pub(crate) fn stopped_count(&self) -> u32 {
        self.stopped.len() as u32
    }
}

/// Tarjan's algorithm: a component id for each node, equal for nodes that reach each other.
fn strongly_connected_components(edges: &[Vec<usize>]) -> Vec<usize> {
    const UNVISITED: usize = usize::MAX;
    let mut order = vec![UNVISITED; edges.len()];
    let mut lowest = vec![0usize; edges.len()];
    let mut component = vec![UNVISITED; edges.len()];
    let mut open: Vec<usize> = Vec::new();
    // (node, how many of its edges are done)
    let mut path: Vec<(usize, usize)> = Vec::new();
    let mut next_order = 0;
    let mut next_component = 0;
    for root in 0..edges.len() {
        if order[root] != UNVISITED {
            continue;
        }
        path.push((root, 0));
        while let Some(&(node, done)) = path.last() {
            if done == 0 {
                order[node] = next_order;
                lowest[node] = next_order;
                next_order += 1;
                open.push(node);
            }
            if let Some(&to) = edges[node].get(done) {
                path.last_mut().expect("not empty").1 += 1;
                if order[to] == UNVISITED {
                    path.push((to, 0));
                } else if component[to] == UNVISITED {
                    lowest[node] = lowest[node].min(order[to]);
                }
                continue;
            }
            path.pop();
            if let Some(&(parent, _)) = path.last() {
                lowest[parent] = lowest[parent].min(lowest[node]);
            }
            if lowest[node] == order[node] {
                while let Some(member) = open.pop() {
                    component[member] = next_component;
                    if member == node {
                        break;
                    }
                }
                next_component += 1;
            }
        }
    }
    component
}

impl<'a> BundleV2<'a> {
    /// `ResultValue::NeedsConstCallValues`. Returns the number of parse tasks it scheduled.
    pub(crate) fn on_needs_const_call_values(
        &mut self,
        needs: &mut parse_task::NeedsConstCallValues,
    ) -> i32 {
        let importer = needs.source_index.get();
        let imports = core::mem::take(&mut needs.imports);
        let (targets, scheduled) = self.resolve_const_call_imports(needs, &imports);

        let mut requests = Vec::with_capacity(imports.len());
        for (import, target) in imports.into_iter().zip(targets) {
            let state = match target {
                Some(source_index) => RequestState::WaitingFor {
                    source_index,
                    alias: import.alias,
                    hops: 0,
                },
                None => RequestState::Unknown,
            };
            requests.push(Request { import, state });
        }
        bun_core::scoped_log!(
            const_call,
            "stopped {} for {} import(s)",
            importer,
            requests.len()
        );
        self.graph.const_calls.stopped.insert(
            importer,
            Stopped {
                task: needs.task,
                requests,
            },
        );
        self.advance_stopped_file(importer);
        scheduled
    }

    /// A file finished. `values` is `None` when it has no AST on the graph.
    pub(crate) fn on_file_finished_for_const_calls(
        &mut self,
        source_index: IndexInt,
        values: Option<ConstCallValues>,
    ) {
        match values {
            Some(values) if values.count() > 0 => {
                self.graph.const_calls.values.insert(source_index, values);
            }
            Some(_) => {}
            None => self
                .graph
                .const_calls
                .finished_without_ast
                .push(source_index),
        }
        if self.graph.const_calls.waiters.is_empty() {
            return;
        }
        let Some(importers) = self.graph.const_calls.waiters.remove(&source_index) else {
            return;
        };
        for importer in importers {
            self.advance_stopped_file(importer);
        }
    }

    /// When only stopped files are pending, gives up the waits that cannot end: a cycle, a deferred load.
    pub(crate) fn release_stopped_files_if_idle(&mut self) -> bool {
        let stopped = self.graph.const_calls.stopped_count();
        if stopped == 0 || self.graph.pending_items != stopped {
            return false;
        }
        let mut files: Vec<IndexInt> = self.graph.const_calls.stopped.keys().copied().collect();
        files.sort_unstable();
        let waits: Vec<Vec<usize>> = files
            .iter()
            .map(|file| {
                let requests = self.graph.const_calls.stopped.get(file);
                requests
                    .into_iter()
                    .flat_map(|stopped| &stopped.requests)
                    .filter_map(|request| match request.state {
                        RequestState::WaitingFor { source_index, .. } => {
                            files.binary_search(&source_index).ok()
                        }
                        _ => None,
                    })
                    .collect()
            })
            .collect();
        let cycle_of = strongly_connected_components(&waits);

        let mut ready = Vec::new();
        for (i, file) in files.iter().enumerate() {
            let Some(stopped) = self.graph.const_calls.stopped.get_mut(file) else {
                continue;
            };
            let mut waiting = false;
            for request in &mut stopped.requests {
                let RequestState::WaitingFor { source_index, .. } = request.state else {
                    continue;
                };
                match files.binary_search(&source_index) {
                    Ok(awaited) if cycle_of[awaited] != cycle_of[i] => waiting = true,
                    _ => request.state = RequestState::Unknown,
                }
            }
            if !waiting {
                ready.push(*file);
            }
        }
        bun_core::scoped_log!(
            const_call,
            "idle: {} of {} stopped file(s) run",
            ready.len(),
            files.len()
        );
        // The cycles form a graph without cycles, so at least one of them waits for no other.
        debug_assert!(!ready.is_empty());
        for file in ready {
            self.schedule_second_run(file);
        }
        true
    }

    /// Resolves the imports a stopped file asked about. Its second run resolves and reports them again.
    fn resolve_const_call_imports(
        &mut self,
        needs: &parse_task::NeedsConstCallValues,
        imports: &[ConstCallImport<'static>],
    ) -> (Vec<Option<IndexInt>>, i32) {
        let importer = needs.source_index.get() as usize;
        // One record per import statement: its items share `import_record_index`.
        let mut record_of_import: Vec<usize> = Vec::with_capacity(imports.len());
        let mut records: Vec<ImportRecord> = Vec::new();
        for (i, import) in imports.iter().enumerate() {
            if i > 0 && imports[i - 1].import_record_index == import.import_record_index {
                record_of_import.push(records.len() - 1);
                continue;
            }
            record_of_import.push(records.len());
            let mut record = ImportRecord {
                kind: ImportKind::Stmt,
                range: import.range,
                path: bun_paths::fs::Path::init(import.specifier),
                tag: bun_ast::ImportRecordTag::None,
                loader: None,
                source_index: Index::INVALID,
                original_path: b"",
                flags: ImportRecordFlags::empty(),
            };
            // An `onResolve` plugin answers later, with this record's real index.
            let matches_plugin = self.matches_on_resolve_plugin(import.specifier);
            // Only a JavaScript file exports a function, and resolving an HTML import has side effects.
            let names_other_loader = Fs::Path::init(import.specifier)
                .loader(&self.transpiler.options.loaders)
                .is_some_and(|loader| !loader.is_javascript_like());
            if matches_plugin || names_other_loader {
                record.flags.insert(ImportRecordFlags::IS_UNUSED);
            }
            records.push(record);
        }

        // The placeholder `enqueue` stored: the path is all that resolution reads.
        let source = self.graph.input_files.items_source()[importer].clone();
        let (msgs_before, errors_before) = {
            let log = self.transpiler.log_mut();
            (log.msgs.len(), log.errors)
        };
        let mut resolved = self.resolve_import_records(&mut ResolveImportRecordCtx {
            import_records: &mut records,
            source: &source,
            loader: needs.loader,
            target: needs.target,
            only_records: None,
        });
        // The second run reports the errors again. A warning is logged only once, so it stays.
        {
            let log = self.transpiler.log_mut();
            let mut kept = msgs_before;
            for i in msgs_before..log.msgs.len() {
                if log.msgs[i].kind != bun_ast::Kind::Err {
                    log.msgs.swap(kept, i);
                    kept += 1;
                }
            }
            log.msgs.truncate(kept);
            log.errors = errors_before;
        }

        // A new file of another loader is left for the second run, which records it on the importer.
        let loaders = &self.transpiler.options.loaders;
        resolved.resolve_queue.retain(|_, task| {
            // SAFETY: arena-allocated by `resolve_import_records` and not scheduled yet.
            let unscheduled = unsafe { &**task };
            let is_javascript = unscheduled
                .loader
                .or_else(|| unscheduled.path.loader(loaders))
                .is_some_and(|loader| loader.is_javascript_like());
            if !is_javascript {
                // SAFETY: as above. The queue forgets the slot, so it is not used again.
                unsafe { core::ptr::drop_in_place(*task) };
            }
            is_javascript
        });

        let scheduled =
            self.process_resolve_queue(&resolved.resolve_queue, needs.target, importer as IndexInt);

        let path_to_source_index = &self.graph.build_graphs[needs.target];
        let targets = record_of_import
            .iter()
            .map(|&record| {
                let record = &records[record];
                if record.flags.contains(ImportRecordFlags::IS_UNUSED) {
                    None
                } else if record.source_index.is_valid() {
                    Some(record.source_index.get())
                } else {
                    path_to_source_index.get_path(&record.path)
                }
            })
            .collect();
        (targets, scheduled)
    }

    /// Moves each request of `importer` as far as finished files allow, then schedules it if none waits.
    fn advance_stopped_file(&mut self, importer: IndexInt) {
        let Some(mut stopped) = self.graph.const_calls.stopped.remove(&importer) else {
            return;
        };
        let mut waiting = false;
        for request in &mut stopped.requests {
            while let RequestState::WaitingFor {
                source_index,
                alias,
                hops,
            } = request.state
            {
                request.state = match self.lookup_const_call(source_index, alias) {
                    Lookup::Value(value) => RequestState::Known(value),
                    Lookup::Follow(next, next_alias) if hops < MAX_HOPS => {
                        RequestState::WaitingFor {
                            source_index: next,
                            alias: next_alias,
                            hops: hops + 1,
                        }
                    }
                    Lookup::Follow(..) | Lookup::Unknown => RequestState::Unknown,
                    Lookup::NotFinished => {
                        let waiters = self
                            .graph
                            .const_calls
                            .waiters
                            .entry(source_index)
                            .or_default();
                        if !waiters.contains(&importer) {
                            waiters.push(importer);
                        }
                        waiting = true;
                        break;
                    }
                };
            }
        }
        self.graph.const_calls.stopped.insert(importer, stopped);
        if !waiting {
            self.schedule_second_run(importer);
        }
    }

    /// What calling export `alias` of `source_index` returns.
    fn lookup_const_call(&self, source_index: IndexInt, alias: &[u8]) -> Lookup {
        let index = source_index as usize;
        // Another build of the same package can replace this file (`scan_for_secondary_paths`).
        if !self.graph.input_files.items_secondary_path()[index].is_empty() {
            return Lookup::Unknown;
        }
        // `module.exports = require("./x")` alone: the file finished as a redirect.
        if self.graph.ast.items_redirect_import_record_index()[index] != u32::MAX {
            return Lookup::Unknown;
        }
        // A finished file has at least the part the parser reserves for its wrapper.
        if self.graph.ast.items_parts()[index].len() == 0 {
            return if self
                .graph
                .const_calls
                .finished_without_ast
                .contains(&source_index)
            {
                Lookup::Unknown
            } else {
                Lookup::NotFinished
            };
        }
        let Some(export) = self.graph.ast.items_named_exports()[index].get(alias) else {
            return Lookup::Unknown;
        };
        if let Some(value) = self
            .graph
            .const_calls
            .values
            .get(&source_index)
            .and_then(|values| values.get(&export.ref_))
        {
            return Lookup::Value(*value);
        }
        // `export { x } from "./other"`, or an import that is exported again.
        let Some(import) = self.graph.ast.items_named_imports()[index].get(&export.ref_) else {
            return Lookup::Unknown;
        };
        let Some(next_alias) = import.alias.filter(|_| !import.alias_is_star) else {
            return Lookup::Unknown;
        };
        let record = &self.graph.ast.items_import_records()[index].as_slice()
            [import.import_record_index as usize];
        // Whether such a record is resolved yet depends on timing. The output must not.
        if self.graph.input_files.items_flags()[index].contains(InputFileFlags::IS_BARREL)
            || self.matches_on_resolve_plugin(record.original_path)
        {
            return Lookup::Unknown;
        }
        if record.kind != ImportKind::Stmt || !record.source_index.is_valid() {
            return Lookup::Unknown;
        }
        Lookup::Follow(record.source_index.get(), next_alias.slice())
    }

    fn matches_on_resolve_plugin(&self, specifier: &[u8]) -> bool {
        self.plugins_ref()
            .is_some_and(|plugins| plugins.has_any_matches(&Fs::Path::init(specifier), false))
    }

    fn schedule_second_run(&mut self, importer: IndexInt) {
        let Some(stopped) = self.graph.const_calls.stopped.remove(&importer) else {
            return;
        };
        let seeds: Vec<ConstCallSeed<'static>> = stopped
            .requests
            .into_iter()
            .filter_map(|request| match request.state {
                RequestState::Known(value) => Some(ConstCallSeed {
                    import_record_index: request.import.import_record_index,
                    alias: request.import.alias,
                    value,
                }),
                RequestState::WaitingFor { .. } | RequestState::Unknown => None,
            })
            .collect();
        bun_core::scoped_log!(
            const_call,
            "second run of {} with {} value(s)",
            importer,
            seeds.len()
        );
        // SAFETY: the task is arena-owned, and no worker holds it: its first run
        // ended before the bundle thread saw `NeedsConstCallValues`.
        unsafe { (*stopped.task).const_call_seeds = Some(seeds) };
        self.graph.pool().schedule(stopped.task);
    }
}
