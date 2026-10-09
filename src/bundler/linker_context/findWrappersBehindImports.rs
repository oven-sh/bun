use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_ast::ImportKind;

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
use crate::linker_context::resolve_chunk_order_conflicts::{NO_CYCLE, find_import_cycles};
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

/// A file prints one `await` of the async wrappers that it waits for (`async_wrappers_awaited_by`).
/// Finds the import cycles that this goes by, and records the symbols that the `await` adds to the file.
fn record_awaited_wrappers(c: &mut LinkerContext) -> Result<bool, AllocError> {
    let flags = c.graph.meta.items_flags();
    let wrapper_refs = c.graph.ast.items_wrapper_ref();
    let is_async_wrapper = |id: usize| {
        flags[id].wrap == WrapKind::Esm
            && flags[id].is_async_or_has_async_dependency
            && c.graph.files_live.is_set(id)
            && wrapper_refs[id].is_valid()
    };
    if !c
        .graph
        .reachable_files
        .iter()
        .any(|source_index| is_async_wrapper(source_index.get() as usize))
    {
        return Ok(false);
    }

    let (cycle_of_file, cycles_len) = find_import_cycles(c);
    let mut entrances: Vec<Vec<IndexInt>> = vec![Vec::new(); cycles_len];
    let mut is_entrance: Vec<bool> = vec![false; c.graph.files.len()];
    let mut add_entrance = |source_index: IndexInt| {
        let id = source_index as usize;
        if is_async_wrapper(id) && !core::mem::replace(&mut is_entrance[id], true) {
            entrances[cycle_of_file[id] as usize].push(source_index);
        }
    };
    let entry_point_kinds = c.graph.files.items_entry_point_kind();
    for source_index in c.graph.reachable_files.iter() {
        let id = source_index.get() as usize;
        if cycle_of_file[id] != NO_CYCLE && entry_point_kinds[id].is_entry_point() {
            add_entrance(source_index.get());
        }
        for record in c.graph.ast.items_import_records()[id].as_slice() {
            if record.source_index.is_valid()
                && let cycle = cycle_of_file[record.source_index.get() as usize]
                && cycle != NO_CYCLE
                && cycle != cycle_of_file[id]
            {
                add_entrance(record.source_index.get());
            }
        }
    }
    if entrances.iter().any(|entrances| !entrances.is_empty()) {
        c.graph.async_cycle_of_file = cycle_of_file;
        c.graph.async_cycle_entrances = entrances.into_iter().map(Into::into).collect();
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
        let awaited = c.async_wrappers_awaited_by(source_index);
        if awaited.len() < 2 {
            continue;
        }
        let part_index = c.graph.parts_live[id]
            .find_first_set()
            .expect("a live file has a live part") as u32;
        called.clear();
        c.for_each_async_wrapper_call(source_index, |wrapper| called.push(wrapper));
        for &wrapper in awaited.iter().filter(|wrapper| !called.contains(wrapper)) {
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
