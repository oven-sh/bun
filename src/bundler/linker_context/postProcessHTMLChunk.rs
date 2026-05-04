use bun_str::string_joiner::{self, StringJoiner};

use crate::linker_context::GenerateChunkCtx;
use crate::thread_pool;
use crate::Chunk;

pub fn post_process_html_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut thread_pool::Worker,
    chunk: &mut Chunk,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set — Zig `!void` but body has zero `try` sites (inferred-empty)
    // This is where we split output into pieces
    let c = ctx.c;
    let mut j = StringJoiner {
        // TODO(port): bundler is an AST crate; worker.allocator may need to thread as &'bump Bump
        allocator: &worker.allocator,
        watcher: string_joiner::Watcher {
            input: chunk.unique_key,
            ..Default::default()
        },
        ..Default::default()
    };

    let compile_results = &chunk.compile_results_for_chunk;

    for compile_result in compile_results.iter() {
        // bun.default_allocator arg dropped per §Allocators
        j.push(compile_result.code());
    }

    j.ensure_newline_at_end();

    chunk.intermediate_output = c
        .break_output_into_pieces(
            &worker.allocator,
            &mut j,
            ctx.chunks.len() as u32, // @truncate
        )
        .unwrap_or_oom(); // Zig: `catch |err| bun.handleOom(err)`

    // PORT NOTE: reshaped for borrowck (compute hash before assigning into chunk)
    let isolated_hash = c.generate_isolated_hash(chunk);
    chunk.isolated_hash = isolated_hash;

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/postProcessHTMLChunk.zig (35 lines)
//   confidence: medium
//   todos:      2
//   notes:      StringJoiner crate path guessed (bun_str::string_joiner); worker.allocator threading needs Phase B review
// ──────────────────────────────────────────────────────────────────────────
