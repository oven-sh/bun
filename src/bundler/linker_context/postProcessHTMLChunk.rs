use bun_core::string_joiner::{StringJoiner, Watcher};

use crate::Chunk;
use crate::linker_context_mod::GenerateChunkCtx;
use crate::thread_pool;

pub fn post_process_html_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut thread_pool::Worker,
    chunk: &mut Chunk,
) -> Result<(), crate::Error> {
    // The body has no fallible sites; the Result signature matches the other
    // `post_process_*_chunk` callees dispatched from `generate_chunk`.
    // This is where we split output into pieces
    let c = ctx.c();
    // E0509: StringJoiner has Drop, so FRU `..Default::default()` is illegal — assign field instead.
    let mut j = StringJoiner::default();
    j.watcher = Watcher {
        input: chunk.unique_key,
        ..Default::default()
    };

    let compile_results = &chunk.compile_results_for_chunk;

    for compile_result in compile_results.iter() {
        // code() borrows from
        // chunk.compile_results_for_chunk which outlives `j.done()`.
        j.push_static(compile_result.code());
    }

    j.ensure_newline_at_end();

    // SAFETY: `worker.arena` is set by `Worker::create` and outlives the worker step.
    let alloc = worker.arena();
    // SAFETY: every borrowed node in `j` points into `chunk.compile_results_for_chunk`
    // (filled in place before post-processing, never reassigned afterwards);
    // `watcher.input` is `chunk.unique_key` (`&'static`). Both outlive the joiner
    // stored in `chunk.intermediate_output`, which is only read while the chunk and
    // the linker graph are alive.
    let mut j = unsafe { j.detach_lifetime() };
    chunk.intermediate_output = bun_core::handle_oom(c.break_output_into_pieces(
        alloc,
        &mut j,
        ctx.chunks.len() as u32, // @truncate
    ));

    // Reshaped for borrowck (compute hash before assigning into chunk)
    let isolated_hash = c.generate_isolated_hash(chunk, alloc);
    chunk.isolated_hash = isolated_hash;

    Ok(())
}
