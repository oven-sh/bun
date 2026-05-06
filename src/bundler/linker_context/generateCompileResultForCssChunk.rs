use core::mem::offset_of;
use bun_js_parser::ast::bundled_ast::BundledAstListExt as _;
use crate::ungate_support::js_meta::JSMetaListExt as _;
use crate::Graph::InputFileListExt as _;
use crate::linker_graph::FileListExt as _;
use crate::ungate_support::EntryPointListExt as _;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_collections::BabyList;
use bun_options_types::ImportRecord;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::bun_css::{BundlerStyleSheet, ImportInfo, PrinterOptions, Targets};

use crate::chunk::{Content, CssImportOrderKind};
use crate::linker_context_mod::{LinkerContext, PendingPartRange};
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index};

pub fn generate_compile_result_for_css_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task is the `task` field embedded in a PendingPartRange (intrusive task node).
    let part_range: &PendingPartRange = unsafe {
        &*(task as *mut u8)
            .sub(offset_of!(PendingPartRange, task))
            .cast::<PendingPartRange>()
    };
    let ctx = part_range.ctx;
    // SAFETY: `GenerateChunkCtx.{c, chunk}` are stored as `&mut T`, but `ctx` is held by
    // shared ref (`PendingPartRange.ctx: &GenerateChunkCtx`), so a normal field access would
    // reborrow them as `&T` and any later `*const → *mut` cast would launder shared
    // provenance into mutable (UB). Instead, read the pointer *value* of each `&mut T` field
    // directly: `addr_of!` yields `*const &mut T`, which has identical layout to
    // `*const *mut T`, and dereferencing that yields a `*mut T` carrying the original
    // mutable provenance. This mirrors Zig's `*LinkerContext` / `*Chunk` raw-pointer
    // semantics in `generateChunksInParallel.zig`, where many `PendingPartRange` tasks share
    // one `chunk_ctx` across worker threads.
    let c_ptr: *mut LinkerContext =
        unsafe { *core::ptr::addr_of!(ctx.c).cast::<*mut LinkerContext>() };
    let chunk_ptr: *mut Chunk = unsafe { *core::ptr::addr_of!(ctx.chunk).cast::<*mut Chunk>() };

    // SAFETY: `c_ptr` addresses the `linker` field embedded in `BundleV2`
    // (`bundle_v2.zig:linker`); Zig `@fieldParentPtr("linker", ctx.c)` recovers `*BundleV2`.
    // `Worker::get` only needs `&BundleV2` (it reads `graph.pool` and serializes via mutex),
    // so no mutable reference is materialized here.
    let bv2: &crate::BundleV2 = unsafe {
        &*(c_ptr as *const u8)
            .sub(offset_of!(crate::BundleV2, linker))
            .cast::<crate::BundleV2>()
    };
    let worker = Worker::get(bv2);
    // `defer worker.unget()` — explicit; Worker::get returns `&'static mut Worker`.
    let mut worker = scopeguard::guard(worker, |w| w.unget());

    #[cfg(feature = "show_crash_trace")]
    let _prev_action_guard = {
        let prev_action = bun_crash_handler::current_action();
        bun_crash_handler::set_current_action(bun_crash_handler::Action::BundleGenerateChunk {
            chunk: chunk_ptr as *const (),
            context: c_ptr as *const (),
            part_range: &part_range.part_range,
        });
        scopeguard::guard((), move |_| {
            bun_crash_handler::set_current_action(prev_action);
        })
    };

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

    // PERF(port): was arena bulk-free (worker.temporary_arena.reset(.retain_capacity)) — profile in Phase B
    let _arena_reset = scopeguard::guard(&mut worker.temporary_arena, |arena| {
        // SAFETY: temporary_arena is initialized in Worker::create before any task runs.
        unsafe { arena.assume_init_mut() }.reset();
    });
    // SAFETY: worker.allocator is set to &worker.heap in Worker::create.
    let allocator = unsafe { &*worker.allocator };
    // TODO(port): worker.allocator threading — css crate is an AST crate and may want &'bump Bump
    let mut allocating_writer: Vec<u8> = Vec::new();

    let Content::Css(css_content) = &chunk.content else {
        unreachable!("generateCompileResultForCssChunk called on non-CSS chunk");
    };
    let css_import = css_content
        .imports_in_chunk_in_order
        .at(imports_in_chunk_index as usize);
    let css: &BundlerStyleSheet = &css_content.asts[imports_in_chunk_index as usize];
    // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
    // CYCLEBREAK: `to_css_with_writer` takes `&bun_logger::symbol::Map`, but
    // `c.graph.symbols` is `bun_js_parser::ast::symbol::Map`. Both are
    // `{ symbols_for_source: NestedList }` (`UnsafeCell<T>` is `repr(transparent)`),
    // so layouts match — bridge by pointer cast.
    let symbols: &bun_logger::symbol::Map = unsafe {
        &*(&c.graph.symbols as *const _ as *const bun_logger::symbol::Map)
    };
    // CYCLEBREAK: `LocalsResultsMap` = `ArrayHashMap<bun_logger::Ref, *const [u8]>`;
    // `c.mangled_props` is `ArrayHashMap<bun_js_parser::Ref, Box<[u8]>>`. Both `Ref`s are
    // newtype-`u64` and `Box<[u8]>`/`*const [u8]` are both `(ptr, len)` fat ptrs — same
    // layout, used read-only by the printer.
    let local_names: &bun_css::LocalsResultsMap = unsafe {
        &*(&c.mangled_props as *const _ as *const bun_css::LocalsResultsMap)
    };
    // SAFETY: parse_graph is a backref into BundleV2.graph, valid for the bundle lifetime.
    let parse_graph = unsafe { &*c.parse_graph };
    // SAFETY: `Box<[u8]>` and `&[u8]` are both `(ptr, len)` fat pointers with identical
    // layout; the column slice is reinterpreted read-only for the duration of `to_css`.
    let unique_keys: &[&[u8]] = unsafe {
        core::mem::transmute::<&[Box<[u8]>], &[&[u8]]>(
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
                allocator,
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
            let import_records = BabyList::<ImportRecord>::from_borrowed_slice_dangerous(
                css_import.condition_import_records.slice_const(),
            );
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                allocator,
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
                allocator,
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
                        unsafe { &*(bytes_ptr as *mut usize as *const AtomicUsize) };
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCompileResultForCssChunk.zig (178 lines)
//   confidence: medium
//   todos:      2
//   notes:      @fieldParentPtr intrusive recovery kept raw (parent=BundleV2 per Worker::get sig); allocating_writer→Vec<u8>; ctx.c/ctx.chunk treated as raw ptrs per BACKREF semantics; files_with_parts_in_chunk atomic-rmw via *usize→*AtomicUsize cast (matches JS chunk)
// ──────────────────────────────────────────────────────────────────────────
