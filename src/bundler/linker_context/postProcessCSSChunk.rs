use crate::mal_prelude::*;
use bun_collections::MultiArrayList;
use bun_core::string_joiner::{StringJoiner, Watcher};
use bun_sourcemap::{LineColumnOffset, LineColumnOffsetOptional};

use crate::chunk::IntermediateOutput;
use crate::linker_context_mod::{GenerateChunkCtx, LinkerOptionsMode};
use crate::thread_pool;
use crate::{Chunk, CompileResultForSourceMap, Index, options};

/// This runs after we've already populated the compile results
pub fn post_process_css_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut thread_pool::Worker,
    chunk: &mut Chunk,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let c = ctx.c();
    // TODO(port): worker.arena is a per-worker arena — thread `&'bump Bump`.
    // PORT NOTE: avoid FRU `..Default::default()` — StringJoiner impls Drop (E0509).
    let mut j = StringJoiner::default();
    j.watcher = Watcher {
        input: chunk.unique_key,
        ..Default::default()
    };

    let mut line_offset: LineColumnOffsetOptional =
        if c.options.source_maps != options::SourceMapOption::None {
            LineColumnOffsetOptional::Value(LineColumnOffset::default())
        } else {
            LineColumnOffsetOptional::Null
        };

    let mut newline_before_comment = false;

    // TODO: meta

    // Concatenate the generated CSS chunks together
    let compile_results = &chunk.compile_results_for_chunk;

    let mut compile_results_for_source_map: MultiArrayList<CompileResultForSourceMap> =
        MultiArrayList::default();
    bun_core::handle_oom(compile_results_for_source_map.set_capacity(compile_results.len()));

    let sources: &[bun_ast::Source] = c.parse_graph().input_files.items_source();
    for compile_result in compile_results.iter() {
        let source_index = compile_result.source_index();

        if c.options.mode == LinkerOptionsMode::Bundle
            && !c.options.minify_whitespace
            && Index::init(source_index).is_valid()
        {
            if newline_before_comment {
                j.push_static(b"\n");
                line_offset.advance(b"\n");
            }

            let pretty: &[u8] = sources[source_index as usize].path.pretty;

            j.push_static(b"/* ");
            line_offset.advance(b"/* ");

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
                line_offset.advance(&escaped);
                j.push_owned(escaped.into_boxed_slice());
            } else {
                j.push_static(pretty);
                line_offset.advance(pretty);
            }

            j.push_static(b" */\n");
            line_offset.advance(b" */\n");
        }

        if !compile_result.code().is_empty() {
            newline_before_comment = true;
        }

        // Save the offset to the start of the stored JavaScript
        // PORT NOTE: Zig `j.push(.., bun.default_allocator)` — code() borrows from
        // compile_results which outlives the joiner; treat as static (no copy/free).
        j.push_static(compile_result.code());

        if let Some(source_map_chunk) = compile_result.source_map_chunk() {
            if c.options.source_maps != options::SourceMapOption::None {
                bun_core::handle_oom(compile_results_for_source_map.append(
                    CompileResultForSourceMap {
                        // SAFETY: bitwise alias of `chunk.compile_results_for_chunk`
                        // (read-only and outlives this fn); see `postProcessJSChunk.rs`.
                        source_map_chunk: unsafe { source_map_chunk.alias() },
                        // Zig reads `.value` payload directly — guaranteed `Value` here
                        // because `source_maps != None` implies `line_offset` was
                        // initialised to `Value(_)` above.
                        generated_offset: match line_offset {
                            LineColumnOffsetOptional::Value(v) => v,
                            LineColumnOffsetOptional::Null => unreachable!(),
                        },
                        source_index: compile_result.source_index(),
                    },
                ));
            }

            line_offset.reset();
        } else {
            line_offset.advance(compile_result.code());
        }
    }

    // Make sure the file ends with a newline
    j.ensure_newline_at_end();

    // SAFETY: `worker.arena` set by `Worker::create`, outlives the worker step.
    let alloc = worker.arena();
    // SAFETY: every borrowed node in `j` points into `chunk.compile_results_for_chunk`
    // (filled in place before post-processing, never reassigned afterwards), graph
    // source paths (`Path<'static>`), or `'static` literals; `watcher.input` is
    // `chunk.unique_key` (`&'static`). All of these outlive the joiner stored in
    // `chunk.intermediate_output`, which is only read while the chunk and the linker
    // graph are alive.
    let mut j = unsafe { j.detach_lifetime() };
    chunk.intermediate_output =
        bun_core::handle_oom(c.break_output_into_pieces(alloc, &mut j, ctx.chunks.len() as u32));
    // TODO: meta contents

    chunk.isolated_hash = c.generate_isolated_hash(chunk);
    // chunk.flags.is_executable = is_executable;

    if c.options.source_maps != options::SourceMapOption::None {
        let can_have_shifts = matches!(chunk.intermediate_output, IntermediateOutput::Pieces(_));
        // Copy the `ParentRef` out (not `c.resolver()`) so `output_dir`
        // borrows the local, not `c`, avoiding the split-borrow with
        // `c.generate_source_map_for_chunk(&mut self, …)` below.
        let resolver = c.resolver.expect("resolver set in load()");
        let output_dir = &resolver.opts.output_dir;
        chunk.output_source_map = c.generate_source_map_for_chunk(
            chunk.isolated_hash,
            worker,
            &compile_results_for_source_map,
            output_dir,
            can_have_shifts,
        )?;
    }

    Ok(())
}

// ported from: src/bundler/linker_context/postProcessCSSChunk.zig
