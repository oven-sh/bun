use crate::mal_prelude::*;
use bun_alloc::{Arena, ArenaVecExt as _};
use bun_ast::ImportKind;
use bun_collections::{ArrayHashMap, AutoBitSet};
use bun_sourcemap::SourceMapPieces;
use core::sync::atomic::AtomicUsize;

use crate::linker_context_mod::debug;
use crate::options::Target;
use crate::{Chunk, LinkerContext, chunk};

/// Splits chunks so that a bundle runs top-level side effects in the order
/// the unbundled modules would.
///
/// ESM hoists every `import` above the module's own code, so whatever a chunk
/// imports from other chunks runs before any of its own files. With `e1.js`
/// importing `s1.js` (only used by `e1`) and then `s2.js` (shared with `e2`),
/// the `e1` chunk inlines `s1` and imports the `s2` chunk: `s2` runs first.
/// The only layout ESM allows is a chunk per run: `s1` in its own chunk,
/// imported before the `s2` chunk.
///
/// For each entry point, this walks the files it loads in evaluation order
/// and cuts a chunk wherever a side-effect file of another chunk interrupts
/// its run. `find_imported_parts_in_js_order` lays a chunk out in the first
/// loading entry's order and ranks chunks by the same walk, so the entry's
/// imports evaluate the runs in source order. Files that two entries run in
/// opposite orders are cut apart too.
///
/// A file that runs nothing when loaded may join a run across an interruption
/// if the run can still be evaluated when it must be (before its own side
/// effects, or before what imports it): everything the file imports, through
/// other such files, must have run its side effects by then and must not gain
/// any later.
///
/// New chunks keep their parent's `entry_bits` under a longer key; chunk
/// membership is `files_with_parts_in_chunk` from here on. `guaranteed_loaded`
/// (from `merge_small_chunks`): per entry, the entries that have finished
/// whenever it loads. What they load takes no part in its order.
pub(crate) fn split_chunks_for_evaluation_order<'t>(
    this: &LinkerContext,
    temp: &'t Arena,
    js_chunks: &mut ArrayHashMap<&'t [u8], Chunk>,
    guaranteed_loaded: &[AutoBitSet],
) -> Result<(), bun_alloc::AllocError> {
    let _trace = bun_core::perf::trace("Bundler.splitChunksForEvaluationOrder");
    if js_chunks.count() < 2 {
        return Ok(());
    }

    let files_len = this.graph.files.len();
    let entry_source_indices = this.graph.entry_points.items_source_index();
    let file_entry_bits = this.graph.files.items_entry_bits();
    let css_asts = this.graph.ast.items_css();
    let parts = this.graph.ast.items_parts();
    let import_records = this.graph.ast.items_import_records();
    let ast_targets = this.graph.ast.items_target();
    let could_be_browser_target_from_server_build = this.options.target.is_server_side()
        && this.parse_graph().html_imports.html_source_indices.len() > 0;

    // Index into `js_chunks.values()` of the chunk holding each live JS file.
    let mut chunk_of_file: Vec<u32> = vec![u32::MAX; files_len];
    for (chunk_index, chunk) in js_chunks.values().iter().enumerate() {
        for &source_index in chunk.files_with_parts_in_chunk.keys() {
            chunk_of_file[source_index as usize] = chunk_index as u32;
        }
    }
    let mut impure: Vec<bool> = vec![false; files_len];
    for (source_index, &chunk_index) in chunk_of_file.iter().enumerate() {
        if chunk_index != u32::MAX {
            impure[source_index] = !this.loading_file_has_no_side_effects(source_index as u32);
        }
    }
    // The files a live part statically imports: what must run before the file.
    let live_imports = |source_index: u32, f: &mut dyn FnMut(u32)| {
        let parts_live = &this.graph.parts_live[source_index as usize];
        let records = import_records[source_index as usize].as_slice();
        for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate() {
            if !parts_live.is_set(part_index) {
                continue;
            }
            for &record_id in part.import_record_indices.iter() {
                let record = &records[record_id as usize];
                if record.source_index.is_valid()
                    && !this.is_external_dynamic_import(record, source_index)
                {
                    f(record.source_index.get());
                }
            }
        }
    };

    // Each entry's files in evaluation order: the post-order walk from the
    // entry file, kept to files that carry the entry's bit and that no entry
    // finished before it loads. Splitting does not change it.
    enum Frame {
        Enter(u32),
        Exit(u32),
    }
    let mut orders: Vec<Vec<u32>> = Vec::new();
    let mut visited: Vec<bool> = vec![false; files_len];
    let mut touched: Vec<u32> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    for (entry_id, &entry_source_index) in entry_source_indices.iter().enumerate() {
        if chunk_of_file[entry_source_index as usize] == u32::MAX {
            continue;
        }
        let mut order: Vec<u32> = Vec::new();
        debug_assert!(stack.is_empty());
        stack.push(Frame::Enter(entry_source_index));
        while let Some(frame) = stack.pop() {
            let source_index = match frame {
                Frame::Exit(source_index) => {
                    order.push(source_index);
                    continue;
                }
                Frame::Enter(source_index) => source_index,
            };
            if core::mem::replace(&mut visited[source_index as usize], true) {
                continue;
            }
            touched.push(source_index);
            if css_asts[source_index as usize].is_some() {
                continue;
            }
            stack.push(Frame::Exit(source_index));
            let mark = stack.len();
            let parts_live = &this.graph.parts_live[source_index as usize];
            let records = import_records[source_index as usize].as_slice();
            for (part_index, part) in parts[source_index as usize].as_slice().iter().enumerate() {
                let is_part_live = parts_live.is_set(part_index);
                for &record_id in part.import_record_indices.iter() {
                    let record = &records[record_id as usize];
                    if record.source_index.is_valid()
                        && (record.kind == ImportKind::Stmt || is_part_live)
                        && !this.is_external_dynamic_import(record, source_index)
                    {
                        stack.push(Frame::Enter(record.source_index.get()));
                    }
                }
            }
            stack[mark..].reverse();
        }
        for &source_index in touched.iter() {
            visited[source_index as usize] = false;
        }
        touched.clear();
        let already_loaded = guaranteed_loaded.get(entry_id);
        order.retain(|&source_index| {
            let bits = &file_entry_bits[source_index as usize];
            chunk_of_file[source_index as usize] != u32::MAX
                && bits.is_set(entry_id)
                && !already_loaded.is_some_and(|loaded| bits.has_intersection(loaded))
        });
        orders.push(order);
    }

    // Moves `files` out of chunk `chunk_index` into a new chunk.
    let mut split_count: u32 = 0;
    let mut split_off = |js_chunks: &mut ArrayHashMap<&'t [u8], Chunk>,
                         chunk_of_file: &mut [u32],
                         chunk_index: u32,
                         files: &[u32]|
     -> Result<(), bun_alloc::AllocError> {
        split_count += 1;
        let parent_key: &[u8] = js_chunks.keys()[chunk_index as usize];
        let mut key = bun_alloc::ArenaVec::with_capacity_in(parent_key.len() + 4, temp);
        key.extend_from_slice(parent_key);
        key.extend_from_slice(&split_count.to_le_bytes());
        let is_browser_chunk_from_server_build = could_be_browser_target_from_server_build
            && files
                .iter()
                .any(|&source_index| ast_targets[source_index as usize] == Target::Browser);
        let new_chunk_index = js_chunks.count() as u32;
        let parent = &mut js_chunks.values_mut()[chunk_index as usize];
        let mut new_chunk = Chunk {
            entry_bits: parent.entry_bits.clone()?,
            entry_point: chunk::EntryPoint::non_entry_point(files[0], 0),
            content: chunk::Content::Javascript(chunk::JavaScriptChunk::default()),
            output_source_map: SourceMapPieces::init(),
            flags: if is_browser_chunk_from_server_build {
                chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD
            } else {
                chunk::Flags::empty()
            },
            ..Default::default()
        };
        for &source_index in files.iter() {
            parent
                .files_with_parts_in_chunk
                .ordered_remove(&source_index);
            new_chunk
                .files_with_parts_in_chunk
                .put(source_index, AtomicUsize::new(0))?;
            chunk_of_file[source_index as usize] = new_chunk_index;
        }
        js_chunks.put(key.into_bump_slice(), new_chunk)
    };

    /// A stretch of one chunk's files in an entry's order. Positions are
    /// 1-based indices into the order; 0 means none.
    struct Run {
        chunk_index: u32,
        files: Vec<u32>,
        /// Positions of the first and last side-effect file.
        first_impure: u32,
        last_impure: u32,
        /// Position of the first foreign side-effect file after `last_impure`.
        interrupted: u32,
        /// The run must be evaluated before this position: a run whose side
        /// effects begin there imports it.
        importer: u32,
    }
    let mut runs: Vec<Run> = Vec::new();
    let mut run_of_chunk: Vec<u32> = Vec::new();
    let mut run_of_file: Vec<u32> = vec![u32::MAX; files_len];
    // Runs with side effects and no `interrupted` yet.
    let mut uninterrupted: Vec<u32> = Vec::new();
    // Per file, the smallest position a walk has checked its imports
    // against (`u32::MAX`: none yet).
    let mut walked_below: Vec<u32> = vec![u32::MAX; files_len];
    let mut walk: Vec<u32> = Vec::new();
    // What one walk changed, to undo when it fails.
    let mut walk_touched: Vec<(u32, u32)> = Vec::new();
    let mut walk_marked: Vec<(u32, u32)> = Vec::new();
    // Whether `current` can be evaluated before position `before` with `start`
    // in it: all they import, through files that run nothing, ran its side
    // effects before that. Runs without side effects met on the way inherit
    // the bound, so they never gain side effects later than it.
    let mut can_evaluate_before = |runs: &mut Vec<Run>,
                                   run_of_file: &[u32],
                                   walked_below: &mut [u32],
                                   start: &[u32],
                                   current: u32,
                                   before: u32|
     -> bool {
        debug_assert!(walk.is_empty() && walk_touched.is_empty() && walk_marked.is_empty());
        walk.extend_from_slice(start);
        let mut ok = true;
        while let Some(file) = walk.pop() {
            if walked_below[file as usize] <= before {
                continue;
            }
            walk_touched.push((file, walked_below[file as usize]));
            walked_below[file as usize] = before;
            live_imports(file, &mut |imported| {
                let imported_run = run_of_file[imported as usize];
                // Not loaded by this entry, later in a cycle, or in `current`.
                if imported_run == u32::MAX || imported_run == current {
                    return;
                }
                let run = &mut runs[imported_run as usize];
                if run.last_impure != 0 {
                    ok &= run.last_impure < before;
                } else if run.importer == 0 || before < run.importer {
                    walk_marked.push((imported_run, run.importer));
                    run.importer = before;
                    walk.extend_from_slice(&run.files);
                }
            });
        }
        if !ok {
            for &(file, previous) in walk_touched.iter() {
                walked_below[file as usize] = previous;
            }
            for &(run_index, previous) in walk_marked.iter() {
                runs[run_index as usize].importer = previous;
            }
        }
        walk_touched.clear();
        walk_marked.clear();
        ok
    };
    // Per chunk, its side-effect files in the first loading entry's order
    // (`reference`) and in the current entry's (`sequence`).
    let mut reference: Vec<Vec<u32>> = Vec::new();
    let mut sequence: Vec<Vec<u32>> = Vec::new();
    let mut touched_chunks: Vec<u32> = Vec::new();
    let mut reference_position: Vec<u32> = vec![0; files_len];
    // A cut for one entry can break a run of another; repeat until no pass cuts.
    'passes: loop {
        let mut changed = false;
        for order in orders.iter() {
            runs.clear();
            run_of_chunk.clear();
            run_of_chunk.resize(js_chunks.count(), u32::MAX);
            uninterrupted.clear();
            for (index, &source_index) in order.iter().enumerate() {
                let pos = index as u32 + 1;
                let chunk_index = chunk_of_file[source_index as usize];
                let is_impure = impure[source_index as usize];
                let current = run_of_chunk[chunk_index as usize];
                let joins = current != u32::MAX && {
                    let run = &runs[current as usize];
                    if is_impure {
                        if run.last_impure != 0 {
                            run.interrupted == 0
                        } else {
                            run.importer == 0
                        }
                    } else {
                        let before = if run.first_impure != 0 {
                            run.first_impure
                        } else {
                            run.importer
                        };
                        before == 0
                            || can_evaluate_before(
                                &mut runs,
                                &run_of_file,
                                &mut walked_below,
                                &[source_index],
                                current,
                                before,
                            )
                    }
                };
                let run_index = if joins {
                    current
                } else {
                    let run_index = runs.len() as u32;
                    runs.push(Run {
                        chunk_index,
                        files: Vec::new(),
                        first_impure: 0,
                        last_impure: 0,
                        interrupted: 0,
                        importer: 0,
                    });
                    run_of_chunk[chunk_index as usize] = run_index;
                    run_index
                };
                runs[run_index as usize].files.push(source_index);
                run_of_file[source_index as usize] = run_index;
                if !is_impure {
                    continue;
                }
                if runs[run_index as usize].first_impure == 0 {
                    runs[run_index as usize].first_impure = pos;
                    uninterrupted.push(run_index);
                }
                runs[run_index as usize].last_impure = pos;
                // Bind what the run imports to its first side effect; files
                // that joined before it had any are bound now.
                let files = core::mem::take(&mut runs[run_index as usize].files);
                let before = runs[run_index as usize].first_impure;
                let ok = can_evaluate_before(
                    &mut runs,
                    &run_of_file,
                    &mut walked_below,
                    if before == pos {
                        &files
                    } else {
                        &files[files.len() - 1..]
                    },
                    run_index,
                    before,
                );
                debug_assert!(ok);
                runs[run_index as usize].files = files;
                uninterrupted.retain(|&other| {
                    if other == run_index {
                        return true;
                    }
                    runs[other as usize].interrupted = pos;
                    false
                });
            }
            for &source_index in order.iter() {
                run_of_file[source_index as usize] = u32::MAX;
                walked_below[source_index as usize] = u32::MAX;
            }

            // All but the chunk's last run split off; the last holds the entry file.
            for run_index in 0..runs.len() {
                let chunk_index = runs[run_index].chunk_index;
                if run_of_chunk[chunk_index as usize] == run_index as u32 {
                    continue;
                }
                changed = true;
                let files = core::mem::take(&mut runs[run_index].files);
                split_off(js_chunks, &mut chunk_of_file, chunk_index, &files)?;
            }
        }
        if changed {
            continue 'passes;
        }

        // Every chunk is one run in every order. A chunk follows the first
        // entry's order; where another entry runs a file earlier, cut it and
        // everything the first entry runs before it off the chunk.
        reference.clear();
        reference.resize(js_chunks.count(), Vec::new());
        sequence.clear();
        sequence.resize(js_chunks.count(), Vec::new());
        for order in orders.iter() {
            for &source_index in order.iter() {
                if !impure[source_index as usize] {
                    continue;
                }
                let chunk_index = chunk_of_file[source_index as usize] as usize;
                if sequence[chunk_index].is_empty() {
                    touched_chunks.push(chunk_index as u32);
                }
                sequence[chunk_index].push(source_index);
            }
            for k in 0..touched_chunks.len() {
                let chunk_index = touched_chunks[k] as usize;
                let current = core::mem::take(&mut sequence[chunk_index]);
                if reference[chunk_index].is_empty() {
                    reference[chunk_index] = current;
                    continue;
                }
                let first = &reference[chunk_index];
                for (i, &source_index) in first.iter().enumerate() {
                    reference_position[source_index as usize] = i as u32 + 1;
                }
                // The files must come in increasing reference position.
                let mut cut_len: Option<usize> = None;
                let mut last = 0;
                for &source_index in current.iter() {
                    let reference_pos = reference_position[source_index as usize];
                    if reference_pos == 0 {
                        continue;
                    }
                    if reference_pos < last {
                        cut_len = Some(reference_pos as usize);
                        break;
                    }
                    last = reference_pos;
                }
                for &source_index in first.iter() {
                    reference_position[source_index as usize] = 0;
                }
                if let Some(cut_len) = cut_len {
                    let files: Vec<u32> = first[..cut_len].to_vec();
                    split_off(js_chunks, &mut chunk_of_file, chunk_index as u32, &files)?;
                    touched_chunks.clear();
                    continue 'passes;
                }
            }
            touched_chunks.clear();
        }
        break;
    }
    debug!(
        "splitChunksForEvaluationOrder: {} chunks split off to keep the evaluation order",
        split_count
    );
    Ok(())
}
