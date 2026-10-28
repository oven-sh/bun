use crate::mal_prelude::*;
use bun_core::string_joiner::{StringJoiner, Watcher};

use crate::linker_context_mod::{GenerateChunkCtx, LinkerOptionsMode};
use crate::thread_pool;
use crate::{Chunk, Index};

/// This runs after we've already populated the compile results
pub(crate) fn post_process_css_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut thread_pool::Worker,
    chunk: &mut Chunk,
) -> Result<(), crate::Error> {
    let c = ctx.c();
    // Avoid FRU `..Default::default()` — StringJoiner impls Drop (E0509).
    let mut j = StringJoiner::default();
    j.watcher = Watcher {
        input: chunk.unique_key,
        ..Default::default()
    };

    let mut newline_before_comment = false;

    // TODO: css banner
    // if len(c.options.CSSBanner) > 0 {
    //     prevOffset.AdvanceString(c.options.CSSBanner)
    //     j.AddString(c.options.CSSBanner)
    //     prevOffset.AdvanceString("\n")
    //     j.AddString("\n")
    // }

    // TODO: (this is where we would put the imports)
    // Generate any prefix rules now
    // (THIS SHOULD BE SET WHEN GENERATING PREFIX RULES!)
    // newline_before_comment = true;

    // TODO: meta

    // Concatenate the generated CSS chunks together
    let compile_results = &chunk.compile_results_for_chunk;

    let sources: &[bun_ast::Source] = c.parse_graph().input_files.items_source();
    for compile_result in compile_results.iter() {
        let source_index = compile_result.source_index();

        if c.options.mode == LinkerOptionsMode::Bundle
            && !c.options.minify_whitespace
            && Index::init(source_index).is_valid()
        {
            if newline_before_comment {
                j.push_static(b"\n");
            }

            let pretty: &[u8] = sources[source_index as usize].path.pretty;

            j.push_static(b"/* ");

            // A `*/` in the path would terminate the comment early and let the
            // rest of the path be parsed as CSS in the bundled output.
            if bun_core::strings::contains(pretty, b"*/") {
                let mut escaped = Vec::with_capacity(pretty.len() + 1);
                for &byte in pretty {
                    if byte == b'/' && escaped.last() == Some(&b'*') {
                        escaped.push(b'\\');
                    }
                    escaped.push(byte);
                }
                j.push_owned(escaped.into_boxed_slice());
            } else {
                j.push_static(pretty);
            }

            j.push_static(b" */\n");
        }

        if !compile_result.code().is_empty() {
            newline_before_comment = true;
        }

        // Save the offset to the start of the stored JavaScript
        // code() borrows from
        // compile_results which outlives the joiner; treat as static (no copy/free).
        j.push_static(compile_result.code());
    }

    // Make sure the file ends with a newline
    j.ensure_newline_at_end();

    // SAFETY: `worker.arena` set by `Worker::create`, outlives the worker step.
    let alloc = worker.arena();
    // SAFETY: every borrowed node in `j` points into `chunk.compile_results_for_chunk`
    // (filled in place before post-processing, never reassigned afterwards), graph
    // source paths, or `'static` literals; `watcher.input` is
    // `chunk.unique_key` (`&'static`). All of these outlive the joiner stored in
    // `chunk.intermediate_output`, which is only read while the chunk and the linker
    // graph are alive.
    let mut j = unsafe { j.detach_lifetime() };
    chunk.intermediate_output =
        bun_core::handle_oom(c.break_output_into_pieces(alloc, &mut j, ctx.chunks.len() as u32));
    // TODO: meta contents

    chunk.isolated_hash = c.generate_isolated_hash(chunk, alloc);
    // chunk.flags.is_executable = is_executable;

    Ok(())
}
