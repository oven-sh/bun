use bun_core::string_joiner::{StringJoiner, Watcher};

use crate::chunk::ChunkOutput;
use crate::linker_context_mod::GenerateChunkCtx;

pub(crate) fn post_process_html_chunk<'r>(
    ctx: GenerateChunkCtx<'_, 'r, '_>,
    chunk_index: usize,
    output: &mut ChunkOutput<'r, '_>,
) -> Result<(), crate::Error> {
    // The body has no fallible sites; the Result signature matches the other
    // `post_process_*_chunk` callees dispatched from `generate_chunk`.
    // This is where we split output into pieces
    let c = ctx.c;
    let chunk = &ctx.chunks[chunk_index];
    // E0509: StringJoiner has Drop, so FRU `..Default::default()` is illegal — assign field instead.
    let mut j = StringJoiner::default();
    j.watcher = Watcher {
        input: chunk.unique_key,
        ..Default::default()
    };

    let compile_results = &ctx.compile_results[chunk_index];

    for compile_result in compile_results.iter() {
        j.push_static(compile_result.code());
    }

    j.ensure_newline_at_end();

    output.intermediate_output = bun_core::handle_oom(c.break_output_into_pieces(
        j,
        ctx.chunks.len() as u32, // @truncate
    ));

    output.isolated_hash = c.generate_isolated_hash(chunk, &output.intermediate_output);

    Ok(())
}
