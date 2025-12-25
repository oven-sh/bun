/// This runs after we've already populated the compile results
pub fn postProcessCSSChunk(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk) !void {
    const c = ctx.c;
    var j = StringJoiner{
        .allocator = worker.allocator,
        .watcher = .{
            .input = chunk.unique_key,
        },
    };

    var line_offset: bun.SourceMap.LineColumnOffset.Optional = if (c.options.source_maps != .none) .{ .value = .{} } else .{ .null = {} };

    var newline_before_comment = false;

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
    const compile_results = chunk.compile_results_for_chunk;

    var compile_results_for_source_map: std.MultiArrayList(CompileResultForSourceMap) = .{};
    bun.handleOom(compile_results_for_source_map.setCapacity(worker.allocator, compile_results.len));

    const sources: []const Logger.Source = c.parse_graph.input_files.items(.source);
    for (compile_results) |compile_result| {
        const source_index = compile_result.sourceIndex();

        if (c.options.mode == .bundle and !c.options.minify_whitespace and Index.init(source_index).isValid()) {
            if (newline_before_comment) {
                j.pushStatic("\n");
                line_offset.advance("\n");
            }

            const pretty = sources[source_index].path.pretty;

            j.pushStatic("/* ");
            line_offset.advance("/* ");

            j.pushStatic(pretty);
            line_offset.advance(pretty);

            j.pushStatic(" */\n");
            line_offset.advance(" */\n");
        }

        if (compile_result.code().len > 0) {
            newline_before_comment = true;
        }

        // Save the offset to the start of the stored JavaScript
        j.push(compile_result.code(), bun.default_allocator);

        if (compile_result.sourceMapChunk()) |source_map_chunk| {
            if (c.options.source_maps != .none) {
                try compile_results_for_source_map.append(worker.allocator, CompileResultForSourceMap{
                    .source_map_chunk = source_map_chunk,
                    .generated_offset = line_offset.value,
                    .source_index = compile_result.sourceIndex(),
                });
            }

            line_offset.reset();
        } else {
            line_offset.advance(compile_result.code());
        }
    }

    // Make sure the file ends with a newline
    j.ensureNewlineAtEnd();
    // if c.options.UnsupportedCSSFeatures.Has(compat.InlineStyle) {
    //    slashTag = ""
    // }
    // c.maybeAppendLegalComments(c.options.LegalComments, legalCommentList, chunk, &j, slashTag)

    // if len(c.options.CSSFooter) > 0 {
    //     j.AddString(c.options.CSSFooter)
    //     j.AddString("\n")
    // }

    chunk.intermediate_output = c.breakOutputIntoPieces(
        worker.allocator,
        &j,
        @as(u32, @truncate(ctx.chunks.len)),
    ) catch |err| bun.handleOom(err);
    // TODO: meta contents

    chunk.isolated_hash = c.generateIsolatedHash(chunk);
    // chunk.flags.is_executable = is_executable;

    if (c.options.source_maps != .none) {
        const can_have_shifts = chunk.intermediate_output == .pieces;
        chunk.output_source_map = try c.generateSourceMapForChunk(
            chunk.isolated_hash,
            worker,
            compile_results_for_source_map,
            c.resolver.opts.output_dir,
            can_have_shifts,
        );
    }
}

const std = @import("std");

const bun = @import("bun");
const Logger = bun.logger;
const StringJoiner = bun.StringJoiner;
const options = bun.options;

const Chunk = bun.bundle_v2.Chunk;
const CompileResultForSourceMap = bun.bundle_v2.CompileResultForSourceMap;
const Index = bun.bundle_v2.Index;
const ThreadPool = bun.bundle_v2.ThreadPool;

const LinkerContext = bun.bundle_v2.LinkerContext;
const GenerateChunkCtx = bun.bundle_v2.LinkerContext.GenerateChunkCtx;
