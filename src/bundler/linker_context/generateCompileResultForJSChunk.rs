use crate::mal_prelude::*;
use core::sync::atomic::Ordering;

use bun_ast::Scope;
use bun_js_printer::{self as js_printer, PrintResult};
use bun_threading::thread_pool as ThreadPoolLib;

use crate::analyze_transpiled_module::ModuleInfo;
use crate::linker_context_mod::LinkerContext;
use crate::options::OutputFormat;
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index, PartRange};

use super::generate_code_for_file_in_chunk_js::generate_code_for_file_in_chunk_js;

// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// `PendingPartRange`. Writes: `chunk.compile_results_for_chunk[i]` (disjoint
// by per-task `i`), `chunk.files_with_parts_in_chunk[source].counter`
// (atomic RMW). Reads `c.graph`/`c.parse_graph` SoA columns shared. Never
// forms `&mut LinkerContext` — `c_ptr` stays raw and the printer takes
// `&LinkerContext` (see `generate_code_for_file_in_chunk_js`).
// `PendingPartRange` is `Send` because its only non-auto-`Send` field is
// `&GenerateChunkCtx` whose pointee is `unsafe impl Send + Sync`.
//
/// # Safety
///
/// `task` must be the intrusive `task` field of a live `PendingPartRange`
/// scheduled by `generate_chunks_in_parallel`. Matches the
/// `Task::callback: unsafe fn(*mut Task)` contract.
pub(crate) unsafe fn generate_compile_result_for_js_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` is the intrusive `task` field of a `PendingPartRange`
    // scheduled by `generate_chunks_in_parallel`; see the helper's contract.
    let (part_range, c_ptr, chunk_ptr, mut worker) =
        unsafe { crate::linker_context_mod::pending_part_range_prologue(task) };

    let result = {
        // SAFETY: `c_ptr` / `chunk_ptr` carry mutable provenance; the disjoint-write
        // contract is documented on `pending_part_range_prologue`. The `&mut`
        // borrows below are scoped to the impl call so they do not overlap the
        // raw slot write that follows. (Peer tasks still hold their own `&mut`
        // views into the same `LinkerContext`/`Chunk` for read-only printer use —
        // see the renamer caveat / SAFETY note on `unsafe impl Sync for
        // Chunk` in Chunk.rs.)
        let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };
        // SAFETY: same mutable-provenance / disjoint-write contract as `c_ptr` above.
        let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };
        generate_compile_result_for_js_chunk_impl(
            &mut **worker,
            c_mut,
            chunk_mut,
            part_range.part_range,
        )
    };

    // SAFETY: per-task unique `i`; see `Chunk::write_compile_result_slot`.
    // The slot write is routed through raw `addr_of_mut!` + `UnsafeCell` so it
    // never materializes `&mut Chunk` / `&mut [CompileResult]`.
    unsafe { Chunk::write_compile_result_slot(chunk_ptr, part_range.i as usize, result) };
}

fn generate_compile_result_for_js_chunk_impl(
    worker: &mut Worker,
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    part_range: PartRange,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkJS");
    // `defer trace.end()` → handled by Drop on _trace

    // Client and server bundles for Bake must outlive the bundle task.
    // `BufferWriter::init()` output is allocated from the global heap and
    // outlives the task's CompileResult consumption, so a per-dev-server
    // arena would only be a perf optimization.
    let _ = c.dev_server;

    // temporary_arena / stmt_list are initialized in Worker::create before any task runs.
    let arena = worker
        .temporary_arena
        .as_mut()
        .expect("Worker.temporary_arena set in create()");
    let mut buffer_writer = js_printer::BufferWriter::init();
    // `temporary_arena` is a `MimallocArena`
    // here because `temp_arena` flows into `Stmt::allocate`/`Expr::allocate`/
    // `Binding::alloc`/`ArenaVec`, all of which take `&MimallocArena` concretely;
    // a plain `reset()` would be `mi_heap_destroy + mi_heap_new` *per part_range*
    // (perf-probe: 46× for one elysia build). Use `reset_retain_with_limit`
    // (see `ModuleLoader`'s `transpile_source_code_arena`):
    // keep the heap warm across part_ranges and
    // only pay the destroy+new round-trip once accumulated scratch exceeds the
    // limit. 8 MiB matches the module-arena precedent and comfortably covers a
    // worker's full part_range set for typical bundles, so this is ~one
    // `mi_heap_new` per worker instead of one per module.
    let arena = scopeguard::guard(&mut *arena, |a| {
        let _ = a.reset_retain_with_limit(8 * 1024 * 1024);
    });
    let stmt_list = worker
        .stmt_list
        .as_mut()
        .expect("Worker.stmt_list set in create()");
    stmt_list.reset();

    let runtime_scope: &mut Scope = &mut c.graph.ast.items_module_scope_mut()
        [c.graph.files.items_input_file()[Index::RUNTIME.get() as usize].get() as usize];
    let runtime_members = &runtime_scope.members;
    let to_common_js_ref = c.graph.symbols.follow(
        runtime_members
            .get(b"__toCommonJS".as_slice())
            .unwrap()
            .ref_,
    );
    let to_esm_ref = c
        .graph
        .symbols
        .follow(runtime_members.get(b"__toESM".as_slice()).unwrap().ref_);
    let runtime_require_ref = if c.options.output_format == OutputFormat::Cjs {
        None
    } else {
        Some(
            c.graph
                .symbols
                .follow(runtime_members.get(b"__require".as_slice()).unwrap().ref_),
        )
    };
    let inside_bun_cjs_wrapper = c.chunk_has_bun_cjs_wrapper(chunk);

    // `worker.arena` (= `BackRef` to `worker.heap`) is a disjoint field from
    // `worker.temporary_arena` / `worker.stmt_list` borrowed `&mut` above, so
    // a direct shared borrow is fine. Heap is pinned; see `Worker::arena`.
    let worker_alloc = worker.arena.get();
    // Collects what the printer emits for this part range; `post_process_js_chunk`
    // appends it to the chunk's ModuleInfo, which is the one that gets finalized,
    // so the `is_typescript` flag of this accumulator is never read.
    let mut module_info: Option<Box<ModuleInfo>> = c
        .options
        .generates_module_info()
        .then(|| ModuleInfo::create(false));
    // SAFETY: split borrow of `chunk` — `generate_code_for_file_in_chunk_js` never
    // touches `chunk.renamer` through its `chunk` parameter; take a raw-ptr view so borrowck doesn't
    // see two overlapping `&mut chunk` borrows.
    let renamer_ptr: *mut crate::bun_renamer::ChunkRenamer = core::ptr::addr_of_mut!(chunk.renamer);
    let result = generate_code_for_file_in_chunk_js(
        c,
        &mut buffer_writer,
        // SAFETY: split borrow of `*chunk` — `renamer_ptr` aliases only
        // `chunk.renamer`, which the callee never touches via its `chunk`
        // parameter, so this deref does not overlap the `chunk` reborrow below.
        unsafe { (*renamer_ptr).as_renamer() },
        chunk,
        part_range,
        to_common_js_ref,
        to_esm_ref,
        runtime_require_ref,
        inside_bun_cjs_wrapper,
        stmt_list,
        worker_alloc,
        &**arena,
        module_info.as_deref_mut(),
    );

    // Update bytesInOutput for this source in the chunk (for metafile)
    // Use atomic operation since multiple threads may update the same counter
    let code_len = match &result {
        PrintResult::Result(r) => r.code.len(),
        _ => 0,
    };
    if code_len > 0 && !part_range.source_index.is_runtime() {
        // CONCURRENCY: the map's key set is frozen before parallel codegen; we
        // only need a shared `&AtomicUsize` to RMW the counter. Using `get`
        // (not `get_ptr_mut`) avoids materializing an aliased `&mut` to a slot
        // that other worker threads may be updating for the same source.
        if let Some(bytes) = chunk
            .files_with_parts_in_chunk
            .get(&part_range.source_index.get())
        {
            let _ = bytes.fetch_add(code_len, Ordering::Relaxed);
        }
    }

    CompileResult::Javascript {
        source_index: part_range.source_index.get(),
        result,
        module_info,
    }
}
