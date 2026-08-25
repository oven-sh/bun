use crate::mal_prelude::*;
use core::sync::atomic::Ordering;

use bun_ast::Scope;
use bun_js_printer::{self as js_printer, PrintResult};

use crate::analyze_transpiled_module::ModuleInfo;
use crate::linker_context_mod::LinkShared;
use crate::options::OutputFormat;
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index, PartRange};

use super::generate_code_for_file_in_chunk_js::generate_code_for_file_in_chunk_js;

/// Pool-thread body for one part range of a JS `chunk` (see
/// `CompileJob::run`). Reads the linker and parse graphs and `chunk`; the
/// only shared write is the atomic `bytesInOutput` bump.
pub(crate) fn generate_compile_result_for_js_chunk(
    ctx: &LinkShared<'_, '_>,
    chunk: &Chunk,
    part_range: &PartRange,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkJS");
    let c = ctx.c;
    let part_range = *part_range;
    let mut worker = ctx.worker();
    let worker: &mut Worker<'_> = &mut worker;
    let worker_alloc = worker.arena();

    // Client and server bundles for Bake must outlive the bundle task.
    // `BufferWriter::init()` output is allocated from the global heap and
    // outlives the task's CompileResult consumption, so a per-dev-server
    // arena would only be a perf optimization.
    let _ = c.dev_server;

    let arena = &mut worker.temporary_arena;
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
    let stmt_list = &mut worker.stmt_list;
    stmt_list.reset();

    let runtime_scope: &Scope = &c.graph.ast.items_module_scope()
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

    // Collects what the printer emits for this part range; `post_process_js_chunk`
    // appends it to the chunk's ModuleInfo, which is the one that gets finalized,
    // so the `is_typescript` flag of this accumulator is never read.
    let mut module_info: Option<Box<ModuleInfo>> = c
        .options
        .generates_module_info()
        .then(|| ModuleInfo::create(false));
    let result = generate_code_for_file_in_chunk_js(
        c,
        ctx.graph,
        &mut buffer_writer,
        chunk.renamer.as_renamer(),
        chunk,
        part_range,
        to_common_js_ref,
        to_esm_ref,
        runtime_require_ref,
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
