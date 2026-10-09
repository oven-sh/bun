use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_ast::ImportKind;

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::resolve_chunk_order_conflicts::{NO_CYCLE, find_cycles};
use crate::linker_context_mod::TreeShakeWork;
use crate::options::{Format, Loader};
use crate::{Index, IndexInt, LinkerContext, WrapKind};

/// The files that one walk has seen. `clear` is O(1).
struct VisitedFiles {
    epoch_of_file: Vec<u32>,
    epoch: u32,
}

impl VisitedFiles {
    fn new(files_len: usize) -> VisitedFiles {
        VisitedFiles {
            epoch_of_file: vec![0; files_len],
            epoch: 1,
        }
    }

    fn clear(&mut self) {
        self.epoch += 1;
    }

    /// Whether this is the first time.
    fn insert(&mut self, source_index: IndexInt) -> bool {
        core::mem::replace(&mut self.epoch_of_file[source_index as usize], self.epoch) != self.epoch
    }
}

impl LinkerContext<'_> {
    /// Whether every load that evaluates `importer` evaluates `imported`.
    pub(crate) fn runs_with(&self, importer: IndexInt, imported: IndexInt) -> bool {
        let entry_bits = self.graph.files.items_entry_bits();
        self.graph.files_live.is_set(imported as usize)
            && entry_bits[importer as usize].subset_of(&entry_bits[imported as usize])
    }

    /// The files that an `import` of `target` in `importer` runs, in order: `target`, or when
    /// that does not run with `importer`, what the `import` statements of `target` run.
    fn for_each_file_run_by_import(
        &self,
        importer: IndexInt,
        target: IndexInt,
        visited: &mut VisitedFiles,
        mut each: impl FnMut(IndexInt),
    ) {
        let mut stack: Vec<IndexInt> = vec![target];
        while let Some(source_index) = stack.pop() {
            if !visited.insert(source_index) {
                continue;
            }
            if self.runs_with(importer, source_index) {
                each(source_index);
                continue;
            }
            let mark = stack.len();
            for_each_edge(self, source_index, false, |_, edge| {
                if let Edge::Import(other) = edge {
                    stack.push(other);
                }
            });
            stack[mark..].reverse();
        }
    }
}

/// An unwrapped file runs when its chunk loads. A wrapper runs where it is called, and an `import`
/// prints as a call of the wrapper of its target. That misses a wrapper behind a target that does
/// not run (a `"sideEffects": false` barrel), and one whose `import` tree shaking dropped.
pub(crate) fn find_wrappers_behind_imports(c: &mut LinkerContext) -> Result<(), AllocError> {
    let flags = c.graph.meta.items_flags();
    if c.options.output_format == Format::InternalBakeDev
        || !c.graph.reachable_files.iter().any(|source_index| {
            flags[source_index.get() as usize].wrap == WrapKind::Esm
                && c.graph.files_live.is_set(source_index.get() as usize)
        })
    {
        return Ok(());
    }

    let mut visited = VisitedFiles::new(c.graph.files.len());
    let mut worklist: Vec<TreeShakeWork> = Vec::new();
    let mut wrappers: Vec<IndexInt> = Vec::new();
    for i in 0..c.graph.reachable_files.len() {
        let source_index = c.graph.reachable_files[i].get();
        let id = source_index as usize;
        if source_index == Index::RUNTIME.value()
            || !c.graph.files_live.is_set(id)
            || c.graph.ast.items_css()[id].is_some()
            || c.parse_graph().input_files.items_loader()[id] == Loader::Html
        {
            continue;
        }
        for part_index in 0..c.graph.ast.items_parts()[id].len() {
            let is_part_live = c.graph.parts_live[id].is_set(part_index);
            let records_len = c.graph.ast.items_parts()[id].as_slice()[part_index]
                .import_record_indices
                .len();
            for n in 0..records_len {
                let import_record_index =
                    c.graph.ast.items_parts()[id].as_slice()[part_index].import_record_indices[n];
                let record = &c.graph.ast.items_import_records()[id].as_slice()
                    [import_record_index as usize];
                if record.kind != ImportKind::Stmt || !record.source_index.is_valid() {
                    continue;
                }
                let target = record.source_index.get();
                // The statement prints what its target needs.
                if is_part_live && c.runs_with(source_index, target) {
                    continue;
                }

                wrappers.clear();
                visited.clear();
                let flags = c.graph.meta.items_flags();
                let wrapper_refs = c.graph.ast.items_wrapper_ref();
                // A `__commonJS` wrapper cannot wait, so what tree shaking dropped from it stays dropped.
                let skips_async_wrappers = !is_part_live && flags[id].wrap == WrapKind::Cjs;
                c.for_each_file_run_by_import(source_index, target, &mut visited, |other| {
                    if flags[other as usize].wrap == WrapKind::Esm
                        && wrapper_refs[other as usize].is_valid()
                        && !(skips_async_wrappers
                            && flags[other as usize].is_async_or_has_async_dependency)
                    {
                        wrappers.push(other);
                    }
                });
                if wrappers.is_empty() {
                    continue;
                }
                for &other in &wrappers {
                    c.graph.generate_symbol_import_and_use(
                        source_index,
                        part_index as u32,
                        c.graph.ast.items_wrapper_ref()[other as usize],
                        1,
                        Index::source(other),
                    )?;
                    worklist.push(TreeShakeWork::Part {
                        part_index: c.graph.meta.items_wrapper_part_index()[other as usize].get(),
                        source_index: other,
                    });
                }
                worklist.push(TreeShakeWork::Part {
                    part_index: part_index as u32,
                    source_index,
                });
                if wrappers != [target] {
                    c.graph.wrappers_behind_import.insert(
                        (source_index, import_record_index),
                        wrappers.as_slice().into(),
                    );
                }
            }
        }
    }
    let has_new_calls = !worklist.is_empty();
    c.mark_live(worklist);
    let has_new_awaits = record_awaited_wrappers(c)?;
    if has_new_calls || has_new_awaits {
        c.compute_entry_bits()?;
    }
    Ok(())
}

/// A file prints one `await` of the async wrappers that its `import` statements call. Records them per file
/// (`LinkerGraph.awaited_wrappers`), with the symbols that the `await` adds. Returns whether it adds any.
///
/// A wrapper in a cycle of such calls ends before the one where the cycle started, which ends last. So a file
/// outside of the cycle also waits for the wrappers where the cycle can start. The call has started them all.
fn record_awaited_wrappers(c: &mut LinkerContext) -> Result<bool, AllocError> {
    let flags = c.graph.meta.items_flags();
    if !c.graph.reachable_files.iter().any(|source_index| {
        let id = source_index.get() as usize;
        flags[id].wrap == WrapKind::Esm
            && flags[id].is_async_or_has_async_dependency
            && c.graph.files_live.is_set(id)
    }) {
        return Ok(false);
    }

    let is_live_and_async = |source_index: IndexInt| {
        flags[source_index as usize].is_async_or_has_async_dependency
            && c.graph.files_live.is_set(source_index as usize)
    };
    let (cycle_of_file, cycles_len) = find_cycles(c, |source_index, edges| {
        if is_live_and_async(source_index) {
            c.for_each_async_wrapper_call(source_index, |wrapper| edges.push(wrapper));
        }
    });
    // Per cycle: the wrappers that something outside of it calls, in an `import` statement or otherwise.
    let mut entrances: Vec<Vec<IndexInt>> = vec![Vec::new(); cycles_len];
    if cycles_len > 0 {
        let mut is_entrance: Vec<bool> = vec![false; c.graph.files.len()];
        let mut add_entrance = |importer: Option<IndexInt>, wrapper: IndexInt| {
            let cycle = cycle_of_file[wrapper as usize];
            if cycle != NO_CYCLE
                && importer.is_none_or(|importer| cycle_of_file[importer as usize] != cycle)
                && !core::mem::replace(&mut is_entrance[wrapper as usize], true)
            {
                entrances[cycle as usize].push(wrapper);
            }
        };
        let entry_point_kinds = c.graph.files.items_entry_point_kind();
        for source_index in c.graph.reachable_files.iter() {
            let source_index = source_index.get();
            let id = source_index as usize;
            if !c.graph.files_live.is_set(id) {
                continue;
            }
            if entry_point_kinds[id].is_entry_point() {
                add_entrance(None, source_index);
            }
            if is_live_and_async(source_index) {
                c.for_each_async_wrapper_call(source_index, |wrapper| {
                    add_entrance(Some(source_index), wrapper)
                });
            }
            for record in c.graph.ast.items_import_records()[id].as_slice() {
                if record.kind != ImportKind::Stmt && record.source_index.is_valid() {
                    add_entrance(Some(source_index), record.source_index.get());
                }
            }
        }
    }

    let mut worklist: Vec<TreeShakeWork> = Vec::new();
    let mut called: Vec<IndexInt> = Vec::new();
    for i in 0..c.graph.reachable_files.len() {
        let source_index = c.graph.reachable_files[i].get();
        let id = source_index as usize;
        if !c.graph.meta.items_flags()[id].is_async_or_has_async_dependency
            || !c.graph.files_live.is_set(id)
        {
            continue;
        }
        called.clear();
        c.for_each_async_wrapper_call(source_index, |wrapper| {
            if !called.contains(&wrapper) {
                called.push(wrapper);
            }
        });
        let mut awaited = called.clone();
        for &wrapper in &called {
            let cycle = cycle_of_file[wrapper as usize];
            if cycle == NO_CYCLE || cycle == cycle_of_file[id] {
                continue;
            }
            for &entrance in &entrances[cycle as usize] {
                if c.runs_with(source_index, entrance) && !awaited.contains(&entrance) {
                    awaited.push(entrance);
                }
            }
        }
        if awaited.is_empty() {
            continue;
        }
        c.graph
            .awaited_wrappers
            .insert(source_index, awaited.as_slice().into());
        if awaited.len() < 2 {
            continue;
        }
        let part_index = c.graph.parts_live[id]
            .find_first_set()
            .expect("a live file has a live part") as u32;
        for &wrapper in &awaited[called.len()..] {
            c.graph.generate_symbol_import_and_use(
                source_index,
                part_index,
                c.graph.ast.items_wrapper_ref()[wrapper as usize],
                1,
                Index::source(wrapper),
            )?;
            worklist.push(TreeShakeWork::Part {
                part_index: c.graph.meta.items_wrapper_part_index()[wrapper as usize].get(),
                source_index: wrapper,
            });
        }
        c.graph.generate_symbol_import_and_use(
            source_index,
            part_index,
            c.promise_all_runtime_ref,
            1,
            Index::RUNTIME,
        )?;
        for &part_index in c.top_level_symbols_to_parts_for_runtime(c.promise_all_runtime_ref) {
            worklist.push(TreeShakeWork::Part {
                part_index,
                source_index: Index::RUNTIME.value(),
            });
        }
    }
    let has_new_awaits = !worklist.is_empty();
    c.mark_live(worklist);
    Ok(has_new_awaits)
}
