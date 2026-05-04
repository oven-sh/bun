use bun_collections::MultiArrayList;
use bun_core::StringJoiner;
use bun_logger as logger;
use bun_sourcemap::line_column_offset::Optional as LineColumnOffsetOptional;
use bun_sourcemap::LineColumnOffset;

use crate::linker_context::GenerateChunkCtx;
use crate::thread_pool;
use crate::{Chunk, CompileResultForSourceMap, Index, IntermediateOutput};

/// This runs after we've already populated the compile results
pub fn post_process_css_chunk(
    ctx: GenerateChunkCtx,
    worker: &mut thread_pool::Worker,
    chunk: &mut Chunk,
) -> Result<(), bun_core::Error> {
    // TODO(port): narrow error set
    let c = ctx.c;
    let mut j = StringJoiner {
        // PORT NOTE: dropped `.allocator = worker.allocator` — global mimalloc
        watcher: bun_core::string_joiner::Watcher {
            input: chunk.unique_key,
        },
        ..Default::default()
    };

    // TODO(port): exact enum path for `c.options.source_maps` (.none) — assuming `crate::options::SourceMapOption::None`
    let mut line_offset: LineColumnOffsetOptional =
        if c.options.source_maps != crate::options::SourceMapOption::None {
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
    compile_results_for_source_map.reserve(compile_results.len());

    // TODO(port): MultiArrayList field-slice accessor — Zig: `c.parse_graph.input_files.items(.source)`
    let sources: &[logger::Source] = c.parse_graph.input_files.items_source();
    for compile_result in compile_results.iter() {
        let source_index = compile_result.source_index();

        // TODO(port): exact enum path for `c.options.mode` (.bundle)
        if c.options.mode == crate::options::Mode::Bundle
            && !c.options.minify_whitespace
            && Index::init(source_index).is_valid()
        {
            if newline_before_comment {
                j.push_static(b"\n");
                line_offset.advance(b"\n");
            }

            let pretty: &[u8] = &sources[source_index as usize].path.pretty;

            j.push_static(b"/* ");
            line_offset.advance(b"/* ");

            j.push_static(pretty);
            line_offset.advance(pretty);

            j.push_static(b" */\n");
            line_offset.advance(b" */\n");
        }

        if !compile_result.code().is_empty() {
            newline_before_comment = true;
        }

        // Save the offset to the start of the stored JavaScript
        // PORT NOTE: dropped `bun.default_allocator` arg
        j.push(compile_result.code());

        if let Some(source_map_chunk) = compile_result.source_map_chunk() {
            if c.options.source_maps != crate::options::SourceMapOption::None {
                compile_results_for_source_map.push(CompileResultForSourceMap {
                    source_map_chunk,
                    // TODO(port): `LineColumnOffsetOptional::value()` accessor — Zig reads `.value` payload directly
                    generated_offset: line_offset.value(),
                    source_index: compile_result.source_index(),
                });
            }

            line_offset.reset();
        } else {
            line_offset.advance(compile_result.code());
        }
    }

    // Make sure the file ends with a newline
    j.ensure_newline_at_end();
    // if c.options.UnsupportedCSSFeatures.Has(compat.InlineStyle) {
    //    slashTag = ""
    // }
    // c.maybeAppendLegalComments(c.options.LegalComments, legalCommentList, chunk, &j, slashTag)

    // if len(c.options.CSSFooter) > 0 {
    //     j.AddString(c.options.CSSFooter)
    //     j.AddString("\n")
    // }

    // PORT NOTE: dropped `worker.allocator` arg; `catch |err| bun.handleOom(err)` → Rust aborts on OOM
    chunk.intermediate_output = c.break_output_into_pieces(&mut j, ctx.chunks.len() as u32);
    // TODO: meta contents

    chunk.isolated_hash = c.generate_isolated_hash(chunk);
    // chunk.flags.is_executable = is_executable;

    if c.options.source_maps != crate::options::SourceMapOption::None {
        let can_have_shifts = matches!(chunk.intermediate_output, IntermediateOutput::Pieces { .. });
        chunk.output_source_map = c.generate_source_map_for_chunk(
            chunk.isolated_hash,
            worker,
            compile_results_for_source_map,
            &c.resolver.opts.output_dir,
            can_have_shifts,
        )?;
    }

    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/postProcessCSSChunk.zig (127 lines)
//   confidence: medium
//   todos:      5
//   notes:      Dropped allocator args (worker.allocator/default_allocator); enum variant paths for options.{source_maps,mode} and MultiArrayList field-slice accessor are guessed — verify in Phase B.
// ──────────────────────────────────────────────────────────────────────────
