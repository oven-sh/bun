use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_ast::ImportKind;

use crate::linker_context::find_all_imported_parts_in_js_order::{Edge, for_each_edge};
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
                c.for_each_file_run_by_import(source_index, target, &mut visited, |other| {
                    if flags[other as usize].wrap == WrapKind::Esm
                        && wrapper_refs[other as usize].is_valid()
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

    // A file outside of a wrapper prints `await __esmWait(init_x)` for the async wrappers that it imports.
    for i in 0..c.graph.reachable_files.len() {
        let source_index = c.graph.reachable_files[i].get();
        let id = source_index as usize;
        let flags = c.graph.meta.items_flags()[id];
        if flags.wrap != WrapKind::None
            || !flags.is_async_or_has_async_dependency
            || !c.graph.files_live.is_set(id)
            || c.async_wrappers_called_by(source_index).is_empty()
        {
            continue;
        }
        let part_index = c.graph.parts_live[id]
            .find_first_set()
            .expect("a live file has a live part");
        c.graph.generate_symbol_import_and_use(
            source_index,
            part_index as u32,
            c.esm_wait_runtime_ref,
            1,
            Index::RUNTIME,
        )?;
    }

    if has_new_calls {
        c.compute_entry_bits()?;
    }
    Ok(())
}
