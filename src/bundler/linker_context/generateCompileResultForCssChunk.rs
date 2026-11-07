use crate::mal_prelude::*;
use core::sync::atomic::Ordering;

use bun_collections::VecExt;
use bun_core::strings;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::bun_css::{
    BundlerStyleSheet, ImportConditions, ImportInfo, LocalsResultsMap, PrinterOptions, Targets,
};

use crate::chunk::{Content, CssChunk, CssImportOrderKind};
use crate::linker_context::prepare_css_asts_for_chunk::{
    SharedAnonymousConditions, empty_blocks, shared_anonymous_conditions,
};
use crate::linker_context_mod::LinkerContext;
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index};

// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// `PendingPartRange`. Writes: `chunk.compile_results_for_chunk[i]` (disjoint
// by per-task `i`). Reads `c.graph.ast.css` / `c.options` shared. Never forms
// `&mut LinkerContext`. See `generate_compile_result_for_js_chunk` for the
// `PendingPartRange: Send` justification.
//
/// # Safety
///
/// `task` must be the intrusive `task` field of a live `PendingPartRange`
/// scheduled by `generate_chunks_in_parallel`; see
/// [`pending_part_range_prologue`](crate::linker_context_mod::pending_part_range_prologue)
/// for the full contract. The signature matches `ThreadPoolLib::Task::callback`
/// (`unsafe fn(*mut Task)`).
pub(crate) unsafe fn generate_compile_result_for_css_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` is the intrusive `task` field of a `PendingPartRange`
    // scheduled by `generate_chunks_in_parallel`; see the helper's contract.
    let (part_range, chunk_ptr, mut worker) =
        unsafe { crate::linker_context_mod::pending_part_range_prologue(task) };
    let ctx = part_range.ctx;

    // CONCURRENCY: the CSS impl is read-only over `c`/`chunk` (the
    // `bytesInOutput` bump goes through `&AtomicUsize`), so form `&` — never
    // `&mut` — to avoid aliased exclusive borrows across peer worker tasks.
    let result = generate_compile_result_for_css_chunk_impl(
        &mut **worker,
        ctx.c.get(),
        ctx.chunk.get(),
        part_range.i,
    );

    // SAFETY: per-task unique `i`; see `Chunk::write_compile_result_slot`.
    // The slot write is routed through raw `addr_of_mut!` + `UnsafeCell` so it
    // never materializes `&mut Chunk` / `&mut [CompileResult]`.
    unsafe { Chunk::write_compile_result_slot(chunk_ptr, part_range.i as usize, result) };
}

fn generate_compile_result_for_css_chunk_impl(
    worker: &mut Worker,
    c: &LinkerContext,
    chunk: &Chunk,
    imports_in_chunk_index: u32,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkCss");
    // `defer trace.end()` — RAII; Drop ends the trace.

    // `worker.arena` (= `BackRef` to `worker.heap`) is a disjoint field from
    // `worker.temporary_arena` borrowed `&mut` below, so a direct shared
    // borrow via `BackRef::get` is fine. The heap is pinned for the worker's
    // lifetime; see `Worker::arena`.
    let arena = worker.arena.get();
    let _arena_reset = scopeguard::guard(&mut worker.temporary_arena, |arena| {
        // temporary_arena is initialized in Worker::create before any task runs.
        if let Some(a) = arena.as_mut() {
            a.reset();
        }
    });
    let mut allocating_writer: Vec<u8> = Vec::new();

    let Content::Css(css_content) = &chunk.content else {
        unreachable!("generateCompileResultForCssChunk called on non-CSS chunk");
    };
    let css_import = css_content
        .imports_in_chunk_in_order
        .at(imports_in_chunk_index as usize);
    let css: &BundlerStyleSheet = &css_content.asts[imports_in_chunk_index as usize];
    // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
    let symbols = &c.graph.symbols;
    // `LocalsResultsMap` is the same `ArrayHashMap<Ref, Box<[u8]>>` alias as
    // `bun_js_printer::MangledProps`; no cast needed.
    let local_names: &LocalsResultsMap = &c.mangled_props;
    let parse_graph = c.parse_graph();
    let unique_keys = parse_graph
        .input_files
        .items_unique_key_for_additional_file();

    let Ok(blocks) = shared_block_edges(c, css_content, imports_in_chunk_index as usize, arena)
    else {
        return CompileResult::Css {
            result: Err(crate::Error::PrintError),
            source_index: Index::INVALID.get(),
            source_map: None,
        };
    };
    allocating_writer.extend_from_slice(&blocks.open);
    if !c.options.minify_whitespace && !css.rules.v.is_empty() {
        allocating_writer.extend(core::iter::repeat_n(b' ', blocks.indent as usize));
    }

    match &css_import.kind {
        CssImportOrderKind::Layers(_)
        | CssImportOrderKind::ExternalPath(_)
        | CssImportOrderKind::Namespaces(_) => {
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                indent: blocks.indent,
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                &printer_options,
                Some(ImportInfo {
                    import_records: &css_import.condition_import_records,
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                // neither needs symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(crate::Error::PrintError),
                        source_index: Index::INVALID.get(),
                        source_map: None,
                    };
                }
            }
            blocks.close_into(&mut allocating_writer);
            CompileResult::Css {
                result: Ok(allocating_writer.into_boxed_slice()),
                source_index: Index::INVALID.get(),
                source_map: None,
            }
        }
        CssImportOrderKind::SourceIndex(idx) => {
            let printer_options = PrinterOptions {
                targets: Targets::for_bundler_target(c.options.target),
                // TODO: make this more configurable
                minify: c.options.minify_whitespace
                    || c.options.minify_syntax
                    || c.options.minify_identifiers,
                indent: blocks.indent,
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                &printer_options,
                Some(ImportInfo {
                    import_records: &c.graph.ast.items_import_records()[idx.get() as usize],
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(crate::Error::PrintError),
                        source_index: idx.get(),
                        source_map: None,
                    };
                }
            }
            blocks.close_into(&mut allocating_writer);
            let output = allocating_writer.into_boxed_slice();
            // Update bytesInOutput for this source in the chunk (for metafile)
            // Use atomic operation since multiple threads may update the same counter
            if !output.is_empty() {
                // CONCURRENCY: key set is frozen before parallel codegen; take a
                // shared `&AtomicUsize` so concurrent workers updating the same
                // source counter never alias a `&mut`.
                if let Some(bytes) = chunk.files_with_parts_in_chunk.get(&idx.get()) {
                    let _ = bytes.fetch_add(output.len(), Ordering::Relaxed);
                }
            }
            CompileResult::Css {
                result: Ok(output),
                source_index: idx.get(),
                source_map: None,
            }
        }
    }
}

#[derive(Default)]
struct SharedBlockEdges {
    open: Vec<u8>,
    close: Vec<u8>,
    indent: u32,
}

impl SharedBlockEdges {
    fn close_into(&self, output: &mut Vec<u8>) {
        if self.indent != 0 {
            output.truncate((output.trim_ascii_end().len() + 1).min(output.len()));
            output.extend_from_slice(&self.close);
        }
    }
}

/// An entry that shares blocks with a neighbour prints only the edges that are
/// its own: it opens what the next entry goes on to use, or closes what the
/// previous entry opened. Both edges come from one print of the empty blocks,
/// and every rule printer writes a block the same way.
fn shared_block_edges<'a>(
    c: &LinkerContext,
    css_content: &'a CssChunk,
    i: usize,
    arena: &'a bun_alloc::Arena,
) -> Result<SharedBlockEdges, ()> {
    let order = css_content.imports_in_chunk_in_order.slice();
    let SharedAnonymousConditions { before, after } = shared_anonymous_conditions(order, i);
    let (outer, inner) = (before.min(after), before.max(after));
    if inner == 0 {
        return Ok(SharedBlockEdges::default());
    }
    let conditions = order[i].conditions.slice();
    let indent_of = |conditions: &[ImportConditions]| -> u32 {
        conditions
            .iter()
            .map(|c| {
                c.layer.is_some() as u32
                    + c.supports.is_some() as u32
                    + !c.media.media_queries.is_empty() as u32
            })
            .sum::<u32>()
            * 2
    };
    let mut edges = SharedBlockEdges {
        indent: indent_of(&conditions[..inner]),
        ..Default::default()
    };
    if outer == inner {
        return Ok(edges);
    }

    let minify = c.options.minify_whitespace;
    let outer_indent = indent_of(&conditions[..outer]);
    let blocks = empty_blocks(arena, &conditions[outer..inner]);
    let printer_options = PrinterOptions {
        minify,
        targets: Targets::for_bundler_target(c.options.target),
        indent: outer_indent,
        ..Default::default()
    };
    let mut printed: Vec<u8> = Vec::new();
    blocks
        .to_css_with_writer(
            arena,
            &mut printed,
            &printer_options,
            None,
            Some(&c.mangled_props),
            &c.graph.symbols,
        )
        .map_err(|_| ())?;
    let split = strings::last_index_of_char(&printed, b'{').map_or(0, |at| at + 1);
    let (open, close) = printed.split_at(split);
    if before < after {
        if !minify {
            edges
                .open
                .extend(core::iter::repeat_n(b' ', outer_indent as usize));
        }
        edges.open.extend_from_slice(open);
        if !minify {
            edges.open.push(b'\n');
        }
    } else {
        let first_brace = strings::index_of_char_usize(close, b'}').unwrap_or(0);
        let line = strings::last_index_of_char(&close[..first_brace], b'\n').map_or(0, |at| at + 1);
        edges
            .close
            .extend_from_slice(close[line..].trim_ascii_end());
        if !minify {
            edges.close.push(b'\n');
        }
    }
    Ok(edges)
}
