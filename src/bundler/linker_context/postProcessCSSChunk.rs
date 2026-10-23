use crate::mal_prelude::*;
use bun_collections::MultiArrayList;
use bun_core::string_joiner::{StringJoiner, Watcher};
use bun_sourcemap::{LineColumnOffset, LineColumnOffsetOptional};

use crate::chunk::{Content, CssAnonymousLayer, IntermediateOutput};
use crate::linker_context_mod::{GenerateChunkCtx, LinkerOptionsMode};
use crate::thread_pool;
use crate::{Chunk, CompileResultForSourceMap, Index, options};

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

    let mut line_offset: LineColumnOffsetOptional =
        if c.options.source_maps != options::SourceMapOption::None {
            LineColumnOffsetOptional::Value(LineColumnOffset::default())
        } else {
            LineColumnOffsetOptional::Null
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

    let mut compile_results_for_source_map: MultiArrayList<CompileResultForSourceMap> =
        MultiArrayList::default();
    bun_core::handle_oom(compile_results_for_source_map.set_capacity(compile_results.len()));

    // The blocks of bare `layer` imports. Each goes around several results: it opens
    // ahead of its first entry and closes after its last one.
    let layers: &[CssAnonymousLayer] = match &chunk.content {
        Content::Css(css) => css.anonymous_layers.as_deref().map(|l| &*l.layers),
        _ => None,
    }
    .unwrap_or_default();
    let mut next_layer: usize = 0;
    let mut open_layers: Vec<usize> = Vec::new();
    let mut depth: u32 = 0;
    let comments = c.options.mode == LinkerOptionsMode::Bundle && !c.options.minify_whitespace;
    // The entries print their lines at the depth of the blocks around them when their
    // printer does not minify. The blocks then take lines of their own.
    let indent_lines = !layers.is_empty()
        && !(c.options.minify_whitespace
            || c.options.minify_syntax
            || c.options.minify_identifiers);

    let sources: &[bun_ast::Source] = c.parse_graph().input_files.items_source();
    for (i, compile_result) in compile_results.iter().enumerate() {
        let source_index = compile_result.source_index();

        while let Some(layer) = layers.get(next_layer).filter(|l| l.first as usize == i) {
            open_layers.push(next_layer);
            next_layer += 1;
            // A layer with no rules in it has no block.
            if layer.blocks == 0 {
                continue;
            }
            if comments && newline_before_comment {
                j.push_static(b"\n");
                line_offset.advance(b"\n");
                newline_before_comment = false;
            }
            if indent_lines {
                push_indent(&mut j, &mut line_offset, depth);
            }
            j.push_static(&layer.open);
            line_offset.advance(&layer.open);
            if indent_lines {
                j.push_static(b"\n");
                line_offset.advance(b"\n");
            }
            depth += layer.blocks;
        }

        if comments && Index::init(source_index).is_valid() {
            if newline_before_comment {
                j.push_static(b"\n");
                line_offset.advance(b"\n");
            }
            if indent_lines {
                push_indent(&mut j, &mut line_offset, depth);
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
            // A file with no rules prints as an empty line.
            if indent_lines && compile_result.code()[0] != b'\n' {
                push_indent(&mut j, &mut line_offset, depth);
            }
        }

        // Save the offset to the start of the stored JavaScript
        // code() borrows from
        // compile_results which outlives the joiner; treat as static (no copy/free).
        j.push_static(compile_result.code());

        if let Some(source_map_chunk) = compile_result.source_map_chunk() {
            if c.options.source_maps != options::SourceMapOption::None {
                bun_core::handle_oom(compile_results_for_source_map.append(
                    CompileResultForSourceMap {
                        // SAFETY: bitwise alias of `chunk.compile_results_for_chunk`
                        // (read-only and outlives this fn); see `postProcessJSChunk.rs`.
                        source_map_chunk: unsafe { source_map_chunk.alias() },
                        // Guaranteed `Value` here
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

        while let Some(layer) = open_layers
            .last()
            .map(|&open| &layers[open])
            .filter(|l| l.last as usize == i)
        {
            for _ in 0..layer.blocks {
                depth -= 1;
                if indent_lines {
                    push_indent(&mut j, &mut line_offset, depth);
                    j.push_static(b"}\n");
                    line_offset.advance(b"}\n");
                } else {
                    j.push_static(b"}");
                    line_offset.advance(b"}");
                }
            }
            open_layers.pop();
            if layer.blocks > 0 {
                newline_before_comment = true;
            }
        }
    }

    // Make sure the file ends with a newline
    j.ensure_newline_at_end();

    // SAFETY: `worker.arena` set by `Worker::create`, outlives the worker step.
    let alloc = worker.arena();
    // SAFETY: every borrowed node in `j` points into `chunk.compile_results_for_chunk`
    // (filled in place before post-processing, never reassigned afterwards), the
    // `anonymous_layers` of `chunk.content` (the same), graph
    // source paths (`Path<'static>`), or `'static` literals; `watcher.input` is
    // `chunk.unique_key` (`&'static`). All of these outlive the joiner stored in
    // `chunk.intermediate_output`, which is only read while the chunk and the linker
    // graph are alive.
    let mut j = unsafe { j.detach_lifetime() };
    chunk.intermediate_output =
        bun_core::handle_oom(c.break_output_into_pieces(alloc, &mut j, ctx.chunks.len() as u32));
    // TODO: meta contents

    chunk.isolated_hash = c.generate_isolated_hash(chunk, alloc);
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

/// Two spaces for each open block, as the CSS printer indents.
fn push_indent(j: &mut StringJoiner<'_>, line_offset: &mut LineColumnOffsetOptional, depth: u32) {
    const SPACES: &[u8] = &[b' '; 64];
    let mut left = depth as usize * 2;
    while left > 0 {
        let indent = &SPACES[..left.min(SPACES.len())];
        j.push_static(indent);
        line_offset.advance(indent);
        left -= indent.len();
    }
}
