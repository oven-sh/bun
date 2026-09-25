//! Gets what an imported constant function returns before its importer goes on the graph (`bun_js_parser::visit::const_call`).

use crate::Graph::InputFileFlags;
use crate::bundle_v2::BundleV2;
use crate::bundle_v2::bv2_impl::ResolveImportRecordCtx;
use crate::mal_prelude::*;
use crate::options::Target;
use crate::parse_task::{self, ConstCallSecondRun, NeedsConstCallValues};
use crate::{Index, IndexInt};
use bun_ast::ast_result::ConstCallValues;
use bun_ast::{Expr, ImportKind, ImportRecord, ImportRecordFlags};
use bun_collections::HashMap;
use bun_js_parser::ConstCallSeed;
use bun_resolver::fs as Fs;
use bun_resolver::fs::PathResolverExt as _;

bun_core::declare_scope!(const_call, hidden);

/// `export { x } from` chains longer than this are not followed.
pub(crate) const MAX_HOPS: u32 = 8;

#[derive(Default)]
pub(crate) struct State {
    /// Files whose result waits for a value, by source index.
    held: HashMap<IndexInt, Held>,
    /// File -> the held files that wait for it to finish.
    waiters: HashMap<IndexInt, Vec<IndexInt>>,
    /// `Success::const_call_values` of each file that has any.
    values: HashMap<IndexInt, ConstCallValues>,
    /// Files that finished with an error, so they have no AST.
    failed: Vec<IndexInt>,
    /// Held files to look at again. A list, so that a long chain of files does not recurse.
    ready: Vec<IndexInt>,
    draining: bool,
}

struct Held {
    needs: Box<NeedsConstCallValues>,
    /// The file as visited without the values. `None` when that visit failed.
    visited: Option<Box<Visited>>,
    requests: Vec<Request>,
}

struct Visited {
    success: parse_task::Success,
    watcher_data: parse_task::WatcherData,
    external: crate::cache::ExternalFreeFunction,
}

struct Request {
    import_record_index: u32,
    alias: &'static [u8],
    state: RequestState,
}

#[derive(Clone, Copy)]
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
    pub(crate) fn held_count(&self) -> u32 {
        self.held.len() as u32
    }
}

/// Tarjan's algorithm: a component id for each node, equal for nodes that reach each other.
pub(crate) fn strongly_connected_components(edges: &[Vec<usize>]) -> Vec<usize> {
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
    /// Takes a result whose conditions call imports out of `parse_result`. Returns the number of parse tasks it scheduled.
    pub(crate) fn hold_for_const_call_values(
        &mut self,
        parse_result: &mut parse_task::Result,
    ) -> Option<i32> {
        let source_index = Index::init(parse_result.value.source_index());
        let (needs, visited) = match &mut parse_result.value {
            parse_task::ResultValue::NeedsConstCallValues(needs) => {
                let empty = NeedsConstCallValues {
                    imports: Vec::new(),
                    source_log: bun_ast::Log::init(),
                    ..**needs
                };
                (Box::new(core::mem::replace(&mut **needs, empty)), None)
            }
            parse_task::ResultValue::Success(success) => {
                let needs = success.needs_const_call_values.take()?;
                let held = parse_task::ResultValue::Empty { source_index };
                let parse_task::ResultValue::Success(success) =
                    core::mem::replace(&mut parse_result.value, held)
                else {
                    unreachable!()
                };
                let visited = Visited {
                    success,
                    watcher_data: core::mem::replace(
                        &mut parse_result.watcher_data,
                        parse_task::WatcherData::NONE,
                    ),
                    external: core::mem::take(&mut parse_result.external),
                };
                (needs, Some(Box::new(visited)))
            }
            _ => return None,
        };

        let importer = source_index.get();
        let (targets, scheduled) = self.resolve_const_call_imports(&needs);
        let requests = needs
            .imports
            .iter()
            .zip(targets)
            .map(|(import, target)| Request {
                import_record_index: import.import_record_index,
                alias: import.alias,
                state: match target {
                    Some(source_index) => RequestState::WaitingFor {
                        source_index,
                        alias: import.alias,
                        hops: 0,
                    },
                    None => RequestState::Unknown,
                },
            })
            .collect();
        bun_core::scoped_log!(
            const_call,
            "held {} for {} import(s)",
            importer,
            needs.imports.len()
        );
        self.graph.const_calls.held.insert(
            importer,
            Held {
                needs,
                visited,
                requests,
            },
        );
        self.graph.const_calls.ready.push(importer);
        self.drain_ready_held_files();
        Some(scheduled)
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
            None => self.graph.const_calls.failed.push(source_index),
        }
        if self.graph.const_calls.waiters.is_empty() {
            return;
        }
        let Some(importers) = self.graph.const_calls.waiters.remove(&source_index) else {
            return;
        };
        self.graph.const_calls.ready.extend(importers);
        self.drain_ready_held_files();
    }

    fn drain_ready_held_files(&mut self) {
        if core::mem::replace(&mut self.graph.const_calls.draining, true) {
            return;
        }
        while let Some(importer) = self.graph.const_calls.ready.pop() {
            self.advance_held_file(importer);
        }
        self.graph.const_calls.draining = false;
    }

    /// When only held files are pending, gives up the waits that cannot end: a cycle, a deferred load.
    pub(crate) fn release_held_files_if_idle(&mut self) -> bool {
        let held = self.graph.const_calls.held_count();
        if held == 0 || self.graph.pending_items != held {
            return false;
        }
        let mut files: Vec<IndexInt> = self.graph.const_calls.held.keys().copied().collect();
        files.sort_unstable();
        let waits: Vec<Vec<usize>> = files
            .iter()
            .map(|file| {
                let held = self.graph.const_calls.held.get(file);
                held.into_iter()
                    .flat_map(|held| &held.requests)
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

        for (i, file) in files.iter().enumerate() {
            let Some(held) = self.graph.const_calls.held.get_mut(file) else {
                continue;
            };
            let mut waiting = false;
            for request in &mut held.requests {
                let RequestState::WaitingFor { source_index, .. } = request.state else {
                    continue;
                };
                match files.binary_search(&source_index) {
                    Ok(awaited) if cycle_of[awaited] != cycle_of[i] => waiting = true,
                    _ => request.state = RequestState::Unknown,
                }
            }
            if !waiting {
                self.graph.const_calls.ready.push(*file);
            }
        }
        bun_core::scoped_log!(
            const_call,
            "idle: {} of {} held file(s) go on",
            self.graph.const_calls.ready.len(),
            files.len()
        );
        // The cycles form a graph without cycles, so at least one of them waits for no other.
        debug_assert!(!self.graph.const_calls.ready.is_empty());
        self.drain_ready_held_files();
        true
    }

    /// Whether `specifier` in a file at `importer_path` names one JavaScript file that nothing else can replace.
    fn is_plain_javascript_import(
        &mut self,
        importer_path: &Fs::Path,
        specifier: &[u8],
        target: Target,
    ) -> bool {
        // An `onResolve` plugin answers later, and its answer does not depend on this file alone.
        let matches_plugin = self
            .plugins_ref()
            .is_some_and(|plugins| plugins.has_any_matches(&Fs::Path::init(specifier), false));
        if matches_plugin {
            return false;
        }
        if let Some(file_map) = self.file_map {
            if let Some(result) = file_map.resolve(self.arena(), importer_path.text, specifier) {
                return self.is_javascript_path(&result.path_pair.primary);
            }
        }
        let source_dir = importer_path.source_dir();
        let resolved = self
            .transpiler_for_target(target)
            .resolver
            .resolve_with_framework(source_dir, specifier, ImportKind::Stmt);
        let Ok(result) = resolved else {
            return false;
        };
        // A package with a second build can get its imports rewritten to that one (`scan_for_secondary_paths`).
        !result.flags.is_external()
            && result.path_pair.secondary.is_none()
            && !result.path_pair.primary.is_disabled
            && self.is_javascript_path(&result.path_pair.primary)
    }

    fn is_javascript_path(&self, path: &Fs::Path) -> bool {
        path.loader(&self.transpiler.options.loaders)
            .is_some_and(|loader| loader.is_javascript_like())
    }

    /// Resolves the imports a held file asked about. The file's own resolution does them again.
    fn resolve_const_call_imports(
        &mut self,
        needs: &NeedsConstCallValues,
    ) -> (Vec<Option<IndexInt>>, i32) {
        let importer = needs.source_index.get() as usize;
        // The placeholder `enqueue` stored: the path is all that resolution reads.
        let source = self.graph.input_files.items_source()[importer].clone();
        // One record per import statement: its items share `import_record_index`.
        let mut record_of_import: Vec<Option<usize>> = Vec::with_capacity(needs.imports.len());
        let mut records: Vec<ImportRecord> = Vec::new();
        let mut last: Option<(u32, Option<usize>)> = None;
        for import in &needs.imports {
            if let Some((index, record)) = last {
                if index == import.import_record_index {
                    record_of_import.push(record);
                    continue;
                }
            }
            let record =
                if self.is_plain_javascript_import(&source.path, import.specifier, needs.target) {
                    records.push(ImportRecord {
                        kind: ImportKind::Stmt,
                        range: import.range,
                        path: bun_paths::fs::Path::init(import.specifier),
                        tag: bun_ast::ImportRecordTag::None,
                        loader: None,
                        source_index: Index::INVALID,
                        original_path: b"",
                        flags: ImportRecordFlags::empty(),
                    });
                    Some(records.len() - 1)
                } else {
                    None
                };
            record_of_import.push(record);
            last = Some((import.import_record_index, record));
        }
        if records.is_empty() {
            return (vec![None; needs.imports.len()], 0);
        }

        let resolved = self.resolve_import_records(&mut ResolveImportRecordCtx {
            import_records: &mut records,
            source: &source,
            loader: needs.loader,
            target: needs.target,
            only_records: None,
        });
        let scheduled =
            self.process_resolve_queue(&resolved.resolve_queue, needs.target, importer as IndexInt);

        let path_to_source_index = &self.graph.build_graphs[needs.target];
        let targets = record_of_import
            .iter()
            .map(|record| {
                let record = &records[(*record)?];
                if record.source_index.is_valid() {
                    Some(record.source_index.get())
                } else {
                    path_to_source_index.get_path(&record.path)
                }
            })
            .collect();
        (targets, scheduled)
    }

    /// Moves each request of `importer` as far as finished files allow. When none waits, the file goes on.
    fn advance_held_file(&mut self, importer: IndexInt) {
        let Some(mut held) = self.graph.const_calls.held.remove(&importer) else {
            return;
        };
        let mut waiting = false;
        for request in &mut held.requests {
            while let RequestState::WaitingFor {
                source_index,
                alias,
                hops,
            } = request.state
            {
                request.state = match self.lookup_const_call(source_index, alias, held.needs.target)
                {
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
                        // One call of this function makes all the entries of one file, so they are adjacent.
                        if waiters.last() != Some(&importer) {
                            waiters.push(importer);
                        }
                        waiting = true;
                        break;
                    }
                };
            }
        }
        if waiting {
            self.graph.const_calls.held.insert(importer, held);
        } else {
            self.finish_held_file(held);
        }
    }

    /// What calling export `alias` of `source_index` returns, for an importer in the graph of `target`.
    fn lookup_const_call(
        &mut self,
        source_index: IndexInt,
        alias: &'static [u8],
        target: Target,
    ) -> Lookup {
        let index = source_index as usize;
        // A finished file has at least the part the parser reserves for its wrapper.
        if self.graph.ast.items_parts()[index].len() == 0 {
            // `module.exports = require("./x")` alone finishes as a redirect with no part.
            let redirect = self.graph.ast.items_redirect_import_record_index()[index];
            if redirect != u32::MAX {
                let record =
                    &self.graph.ast.items_import_records()[index].as_slice()[redirect as usize];
                return if record.source_index.is_valid() {
                    Lookup::Follow(record.source_index.get(), alias)
                } else {
                    Lookup::Unknown
                };
            }
            return if self.graph.const_calls.failed.contains(&source_index) {
                Lookup::Unknown
            } else {
                Lookup::NotFinished
            };
        }
        // A value of the client graph is not a value of the server graph.
        if self.graph.ast.items_target()[index] != target {
            return Lookup::Unknown;
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
        let (kind, next, specifier) = (record.kind, record.source_index, record.original_path);
        // Which records of a barrel are resolved yet depends on timing. The output must not.
        if kind != ImportKind::Stmt
            || !next.is_valid()
            || self.graph.input_files.items_flags()[index].contains(InputFileFlags::IS_BARREL)
        {
            return Lookup::Unknown;
        }
        let path = self.graph.input_files.items_source()[index].path.clone();
        if !self.is_plain_javascript_import(&path, specifier, target) {
            return Lookup::Unknown;
        }
        Lookup::Follow(next.get(), next_alias.slice())
    }

    /// Every request of the file is decided. With a value, the task runs again. Without one, the held result goes on the graph.
    fn finish_held_file(&mut self, held: Held) {
        let Held {
            mut needs,
            visited,
            requests,
        } = held;
        let seeds: Vec<ConstCallSeed<'static>> = requests
            .into_iter()
            .filter_map(|request| match request.state {
                RequestState::Known(value) => Some(ConstCallSeed {
                    import_record_index: request.import_record_index,
                    alias: request.alias,
                    value,
                }),
                RequestState::WaitingFor { .. } | RequestState::Unknown => None,
            })
            .collect();
        bun_core::scoped_log!(
            const_call,
            "{} has {} value(s)",
            needs.source_index.get(),
            seeds.len()
        );

        let task = needs.task;
        if let Some(visited) = visited {
            let Visited {
                mut success,
                watcher_data,
                external,
            } = *visited;
            if seeds.is_empty() {
                // SAFETY: the task is arena-owned, and its worker let go of it when it posted the result.
                let task = unsafe { &mut *task };
                task.release_owned_fields();
                parse_task::complete_held_result(self, task, success, watcher_data, external);
                return;
            }
            // The second run reads the same source, so the buffer of a native plugin stays until the end.
            if external.function.is_some() {
                self.finalizers.push(external);
            }
            needs.source_mark.rewind(&mut success.log);
            needs.source_log = core::mem::take(&mut success.log);
        }
        // SAFETY: as above.
        unsafe {
            (*task).const_call_second_run = Some(Box::new(ConstCallSecondRun {
                seeds,
                source_log: core::mem::take(&mut needs.source_log),
            }));
        }
        self.graph.pool().schedule(task);
    }
}
