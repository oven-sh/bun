use crate::mal_prelude::*;
use bun_core::string_joiner::{StringJoiner, Watcher};

use crate::Chunk;
use crate::linker_context_mod::GenerateChunkCtx;
use crate::thread_pool;

pub fn post_process_html_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut thread_pool::Worker,
    chunk: &mut Chunk,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set — Zig `!void` but body has zero `try` sites (inferred-empty)
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
        // PORT NOTE: Zig `j.push(.., bun.default_allocator)` — code() borrows from
        // chunk.compile_results_for_chunk which outlives `j.done()`; arena arg dropped.
        j.push_static(compile_result.code());
    }

    j.ensure_newline_at_end();

    // SAFETY: `worker.arena` is set by `Worker::create` and outlives the worker step.
    let alloc = worker.arena();
    chunk.intermediate_output = bun_core::handle_oom(c.break_output_into_pieces(
        alloc,
        &mut j,
        ctx.chunks.len() as u32, // @truncate
    )); // Zig: `catch |err| bun.handleOom(err)`

    // PORT NOTE: reshaped for borrowck (compute hash before assigning into chunk)
    let isolated_hash = c.generate_isolated_hash(chunk);
    chunk.isolated_hash = isolated_hash;

    Ok(())
}

// ported from: src/bundler/linker_context/postProcessHTMLChunk.zig
