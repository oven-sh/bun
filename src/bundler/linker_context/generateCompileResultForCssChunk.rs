use crate::mal_prelude::*;
use core::mem::offset_of;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::VecExt;
use bun_options_types::ImportRecord;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::bun_css::{BundlerStyleSheet, ImportInfo, LocalsResultsMap, PrinterOptions, Targets};

use crate::chunk::{Content, CssImportOrderKind};
use crate::linker_context_mod::{LinkerContext, PendingPartRange};
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index};

// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// `PendingPartRange`. Writes: `chunk.compile_results_for_chunk[i]` (disjoint
// by per-task `i`). Reads `c.graph.ast.css` / `c.options` shared. Never forms
// `&mut LinkerContext` — `c_ptr` stays raw; the CSS printer takes
// `&LinkerContext`. See `generate_compile_result_for_js_chunk` for the
// `PendingPartRange: Send` justification.
pub fn generate_compile_result_for_css_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task is the `task` field embedded in a PendingPartRange (intrusive task node).
    let part_range: &PendingPartRange = unsafe {
        &*bun_core::from_field_ptr!(PendingPartRange, task, task)
    };
    let ctx = part_range.ctx;
    // `GenerateChunkCtx.{c, chunk}` are raw `*mut T` (Copy), so reading them
    // through `&GenerateChunkCtx` preserves the mutable provenance they were
    // constructed with in `generate_chunks_in_parallel`. This mirrors Zig's
    // `*LinkerContext` / `*Chunk` semantics where many `PendingPartRange`
    // tasks share one `chunk_ctx` across worker threads.
    let c_ptr: *mut LinkerContext = ctx.c.cast();
    let chunk_ptr: *mut Chunk = ctx.chunk;

    let worker = Worker::get(ctx.bundle());
    // `defer worker.unget()` — explicit; Worker::get returns the thread-local worker.
    let mut worker = scopeguard::guard(worker, |w| w.unget());

    #[cfg(feature = "show_crash_trace")]
    // SAFETY: `c_ptr` / `chunk_ptr` carry valid mutable provenance (see extraction above);
    // we materialize transient `&` refs only to hand erased `*const ()` to the crash-trace
    // vtable — they are not retained past this expression.
    // RAII: `ActionGuard` restores the previous `CURRENT_ACTION` on drop.
    let _prev_action_guard = bun_crash_handler::scoped_action(
        crate::linker_context_mod::bundle_generate_chunk_action(
            unsafe { &*c_ptr },
            unsafe { &*chunk_ptr },
            &part_range.part_range,
        ),
    );

    // SAFETY: `c_ptr` / `chunk_ptr` carry mutable provenance (see extraction above). In the
    // Zig source these are bare `*LinkerContext` / `*Chunk` shared across all part-range
    // tasks for a chunk; concurrent tasks uphold a disjoint-write contract:
    //   - `chunk.compile_results_for_chunk[i]` is written at a per-task unique index `i`,
    //   - `chunk.files_with_parts_in_chunk` entries are updated via atomic RMW only,
    //   - all other access through `c` / `chunk` during codegen is read-only.
    // No other live `&`/`&mut` to these allocations exists in this frame at this point.
    let _ = ctx;
    let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };
    let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };

    chunk_mut.compile_results_for_chunk[part_range.i as usize] =
        generate_compile_result_for_css_chunk_impl(&mut **worker, c_mut, chunk_mut, part_range.i);
}

fn generate_compile_result_for_css_chunk_impl(
    worker: &mut Worker,
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    imports_in_chunk_index: u32,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkCss");
    // `defer trace.end()` — RAII; Drop ends the trace.

    // SAFETY: `worker.arena` (= `&worker.heap`) is detached from the `worker`
    // borrow so the `temporary_arena` scopeguard below can hold `&mut worker.*`
    // for the rest of the function. The heap is pinned for the worker's
    // lifetime; see `Worker::arena`.
    let arena = unsafe { bun_ptr::detach_lifetime_ref(worker.arena()) };
    // PERF(port): was arena bulk-free (worker.temporary_arena.reset(.retain_capacity)) — profile in Phase B
    let _arena_reset = scopeguard::guard(&mut worker.temporary_arena, |arena| {
        // SAFETY: temporary_arena is initialized in Worker::create before any task runs.
        unsafe { arena.assume_init_mut() }.reset();
    });
    // TODO(port): worker.arena threading — css crate is an AST crate and may want &'bump Bump
    let mut allocating_writer: Vec<u8> = Vec::new();

    let Content::Css(css_content) = &chunk.content else {
        unreachable!("generateCompileResultForCssChunk called on non-CSS chunk");
    };
    let css_import = css_content
        .imports_in_chunk_in_order
        .at(imports_in_chunk_index as usize);
    let css: &BundlerStyleSheet = &css_content.asts[imports_in_chunk_index as usize];
    // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
    // `to_css_with_writer` takes `&bun_logger::symbol::Map`, but
    // `c.graph.symbols` is `bun_js_parser::ast::symbol::Map`. Both are
    // `{ symbols_for_source: NestedList }` (`UnsafeCell<T>` is `repr(transparent)`),
    // so layouts match — bridge by pointer cast.
    let symbols: &bun_logger::symbol::Map = unsafe {
        &*(&raw const c.graph.symbols).cast::<bun_logger::symbol::Map>()
    };
    // `LocalsResultsMap` = `ArrayHashMap<bun_logger::Ref, *const [u8]>`;
    // `c.mangled_props` is `ArrayHashMap<bun_js_parser::Ref, Box<[u8]>>`. Both `Ref`s are
    // newtype-`u64` and `Box<[u8]>`/`*const [u8]` are both `(ptr, len)` fat ptrs — same
    // layout, used read-only by the printer.
    let local_names: &LocalsResultsMap = unsafe {
        &*(&raw const c.mangled_props).cast::<LocalsResultsMap>()
    };
    let parse_graph = c.parse_graph();
    // SAFETY: read-only fan-out of `&[Box<[u8]>]` as `&[&[u8]]`; relies on
    // fat-pointer field-order equivalence (see `boxed_slices_as_borrowed`).
    let unique_keys: &[&[u8]] = unsafe {
        bun_ptr::boxed_slices_as_borrowed(
            parse_graph.input_files.items_unique_key_for_additional_file(),
        )
    };

    match &css_import.kind {
        CssImportOrderKind::Layers(_) => {
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                printer_options,
                Some(ImportInfo {
                    import_records: &css_import.condition_import_records,
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                // layer does not need symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(bun_core::err!("PrintError")),
                        source_index: Index::INVALID.get(),
                        source_map: None,
                    };
                }
            }
            CompileResult::Css {
                result: Ok(allocating_writer.into_boxed_slice()),
                source_index: Index::INVALID.get(),
                source_map: None,
            }
        }
        CssImportOrderKind::ExternalPath(_) => {
            // SAFETY: borrows `condition_import_records` storage for the duration of the
            // `to_css_with_writer` call below; the borrowed Vec is dropped (no-op)
            // before `css_import` goes out of scope, so no double-free / dangling.
            let import_records = unsafe {
                Vec::<ImportRecord>::from_borrowed_slice_dangerous(
                    css_import.condition_import_records.slice_const(),
                )
            };
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                printer_options,
                Some(ImportInfo {
                    import_records: &import_records,
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                // external_path does not need symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(bun_core::err!("PrintError")),
                        source_index: Index::INVALID.get(),
                        source_map: None,
                    };
                }
            }
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
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                printer_options,
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
                        result: Err(bun_core::err!("PrintError")),
                        source_index: idx.get(),
                        source_map: None,
                    };
                }
            }
            let output = allocating_writer.into_boxed_slice();
            // Update bytesInOutput for this source in the chunk (for metafile)
            // Use atomic operation since multiple threads may update the same counter
            if !output.is_empty() {
                if let Some(bytes_ptr) = chunk.files_with_parts_in_chunk.get_ptr_mut(&idx.get()) {
                    // SAFETY: multiple threads update this counter; treat *usize as AtomicUsize
                    // (Zig: @atomicRmw(usize, bytes_ptr, .Add, output.len, .monotonic))
                    let atomic: &AtomicUsize =
                        unsafe { &*std::ptr::from_mut::<usize>(bytes_ptr).cast_const().cast::<AtomicUsize>() };
                    let _ = atomic.fetch_add(output.len(), Ordering::Relaxed);
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

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/linker_context/generateCompileResultForCssChunk.zig
