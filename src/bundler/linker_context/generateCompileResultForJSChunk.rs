use core::mem::offset_of;
use bun_js_parser::ast::bundled_ast::BundledAstListExt as _;
use crate::ungate_support::js_meta::JSMetaListExt as _;
use crate::Graph::InputFileListExt as _;
use crate::linker_graph::FileListExt as _;
use crate::ungate_support::EntryPointListExt as _;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_threading::thread_pool as ThreadPoolLib;
use bun_js_printer::{self as js_printer, PrintResult};
use bun_js_parser::ast::Scope;

use crate::linker_context_mod::{LinkerContext, PendingPartRange};
use crate::options::OutputFormat;
use crate::thread_pool::Worker;
use crate::{BundleV2, Chunk, CompileResult, Index, PartRange};

use super::generate_code_for_file_in_chunk_js::{generate_code_for_file_in_chunk_js, DeclCollector};

pub fn generate_compile_result_for_js_chunk(task: *mut ThreadPoolLib::Task) {
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
    let bv2: &BundleV2 = unsafe {
        &*(c_ptr as *const u8)
            .sub(offset_of!(BundleV2, linker))
            .cast::<BundleV2>()
    };
    let worker = Worker::get(bv2);
    // `defer worker.unget()` — explicit; Worker::get returns `&'static mut Worker`.
    let mut worker = scopeguard::guard(worker, |w| w.unget());

    // TODO(port): Environment.show_crash_trace — exact cfg key TBD; using feature = "show_crash_trace"
    #[cfg(feature = "show_crash_trace")]
    let _crash_guard = {
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

    #[cfg(feature = "show_crash_trace")]
    {
        // SAFETY: parse_graph is a backref into BundleV2.graph, valid for the bundle lifetime.
        let parse_graph = unsafe { &*(*c_ptr).parse_graph };
        let path = &parse_graph.input_files.items_source()
            [part_range.part_range.source_index.get() as usize]
            .path;
        if bun_core::cli::debug_flags::has_print_breakpoint(path) {
            // TODO(port): @breakpoint() — no stable Rust equivalent; use core::intrinsics::breakpoint behind cfg or a helper
            bun_core::breakpoint();
        }
    }

    // SAFETY: `c_ptr` / `chunk_ptr` carry mutable provenance (see extraction above). In the
    // Zig source these are bare `*LinkerContext` / `*Chunk` shared across all part-range
    // tasks for a chunk; concurrent tasks uphold a disjoint-write contract:
    //   - `chunk.compile_results_for_chunk[i]` is written at a per-task unique index `i`,
    //   - `chunk.files_with_parts_in_chunk` entries are updated via atomic RMW only,
    //   - all other access through `c` / `chunk` during codegen is read-only.
    // No other live `&`/`&mut` to these allocations exists in this frame at this point
    // (`bv2` and `ctx` are no longer used below).
    let _ = ctx;
    let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };
    let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };

    chunk_mut.compile_results_for_chunk[part_range.i as usize] =
        generate_compile_result_for_js_chunk_impl(
            &mut **worker,
            c_mut,
            chunk_mut,
            part_range.part_range,
        );
}

fn generate_compile_result_for_js_chunk_impl(
    worker: &mut Worker,
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    part_range: PartRange,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkJS");
    // `defer trace.end()` → handled by Drop on _trace

    // Client and server bundles for Bake must be globally allocated, as they
    // must outlive the bundle task.
    // TODO(port): runtime allocator selection (dev_server vs default) —
    // `DevServerHandle` does not yet expose an arena handle, and
    // `BufferWriter::init()` / `DeclCollector.decls` use the global allocator
    // in the Rust port. Once `dispatch::DevServerHandle::allocator()` exists,
    // thread it here so dev-server bundles outlive the worker arena.
    let _ = c.dev_server;

    // SAFETY: temporary_arena / stmt_list are initialized in Worker::create before any task runs.
    let arena = unsafe { worker.temporary_arena.assume_init_mut() };
    let mut buffer_writer = js_printer::BufferWriter::init();
    // PERF(port): was arena bulk-free (.retain_capacity) — profile in Phase B
    let arena = scopeguard::guard(&mut *arena, |a| {
        a.reset();
    });
    // SAFETY: see above.
    let stmt_list = unsafe { worker.stmt_list.assume_init_mut() };
    stmt_list.reset();

    let runtime_scope: &mut Scope =
        &mut c.graph.ast.items_module_scope_mut()[c.graph.files.items_input_file()[Index::RUNTIME.get() as usize].get() as usize];
    let runtime_members = &runtime_scope.members;
    let to_common_js_ref = c.graph.symbols.follow(runtime_members.get(b"__toCommonJS".as_slice()).unwrap().ref_);
    let to_esm_ref = c.graph.symbols.follow(runtime_members.get(b"__toESM".as_slice()).unwrap().ref_);
    let runtime_require_ref = if c.options.output_format == OutputFormat::Cjs {
        None
    } else {
        Some(c.graph.symbols.follow(runtime_members.get(b"__require".as_slice()).unwrap().ref_))
    };

    let collect_decls = c.options.generate_bytecode_cache
        && c.options.output_format == OutputFormat::Esm
        && c.options.compile;
    // PORT NOTE: Zig threaded `allocator` (dev_server or default) into
    // DeclCollector; the Rust DeclCollector wants `*const Arena`. Use the
    // worker heap for now (see TODO above re: dev_server allocator).
    let mut dc = DeclCollector { allocator: worker.allocator, ..Default::default() };

    // SAFETY: worker.allocator points at worker.heap, initialized in Worker::create.
    let worker_alloc = unsafe { &*worker.allocator };
    let result = generate_code_for_file_in_chunk_js(
        c,
        &mut buffer_writer,
        &mut chunk.renamer,
        chunk,
        part_range,
        to_common_js_ref,
        to_esm_ref,
        runtime_require_ref,
        stmt_list,
        worker_alloc,
        &**arena,
        if collect_decls { Some(&mut dc) } else { None },
    );

    // Update bytesInOutput for this source in the chunk (for metafile)
    // Use atomic operation since multiple threads may update the same counter
    let code_len = match &result {
        PrintResult::Result(r) => r.code.len(),
        _ => 0,
    };
    if code_len > 0 && !part_range.source_index.is_runtime() {
        if let Some(bytes_ptr) = chunk
            .files_with_parts_in_chunk
            .get_ptr_mut(&part_range.source_index.get())
        {
            // SAFETY: multiple threads update this counter; treat &mut usize as &AtomicUsize
            // (same layout, monotonic add only).
            let atomic: &AtomicUsize =
                unsafe { &*(bytes_ptr as *mut usize as *const AtomicUsize) };
            let _ = atomic.fetch_add(code_len, Ordering::Relaxed);
        }
    }

    CompileResult::Javascript {
        source_index: part_range.source_index.get(),
        result,
        decls: if collect_decls {
            dc.decls.into_boxed_slice()
        } else {
            Box::new([])
        },
    }
}

pub use crate::DeferredBatchTask::DeferredBatchTask;
pub use crate::ParseTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCompileResultForJSChunk.zig (110 lines)
//   confidence: medium
//   todos:      3
//   notes:      @fieldParentPtr parent type for Worker::get assumed BundleV2; Worker::get + scopeguard for unget; show_crash_trace gated by #[cfg(feature)]; dev_server allocator selection deferred (DevServerHandle has no arena accessor yet)
// ──────────────────────────────────────────────────────────────────────────
