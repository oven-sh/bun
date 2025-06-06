pub fn generateChunksInParallel(c: *LinkerContext, chunks: []Chunk, comptime is_dev_server: bool) !if (is_dev_server) void else std.ArrayList(options.OutputFile) {
    const trace = bun.perf.trace("Bundler.generateChunksInParallel");
    defer trace.end();

    c.mangleLocalCss();

    var has_js_chunk = false;
    var has_css_chunk = false;
    var has_html_chunk = false;
    bun.assert(chunks.len > 0);

    {
        // TODO(@paperclover/bake): instead of running a renamer per chunk, run it per file
        debug(" START {d} renamers", .{chunks.len});
        defer debug("  DONE {d} renamers", .{chunks.len});
        var wait_group = try c.allocator.create(sync.WaitGroup);
        wait_group.init();
        defer {
            wait_group.deinit();
            c.allocator.destroy(wait_group);
        }
        wait_group.counter = @as(u32, @truncate(chunks.len));
        const ctx = GenerateChunkCtx{ .chunk = &chunks[0], .wg = wait_group, .c = c, .chunks = chunks };
        try c.parse_graph.pool.worker_pool.doPtr(c.allocator, wait_group, ctx, LinkerContext.generateJSRenamer, chunks);
    }

    if (c.source_maps.line_offset_tasks.len > 0) {
        debug(" START {d} source maps (line offset)", .{chunks.len});
        defer debug("  DONE {d} source maps (line offset)", .{chunks.len});
        c.source_maps.line_offset_wait_group.wait();
        c.allocator.free(c.source_maps.line_offset_tasks);
        c.source_maps.line_offset_tasks.len = 0;
    }

    {
        // Per CSS chunk:
        // Remove duplicate rules across files. This must be done in serial, not
        // in parallel, and must be done from the last rule to the first rule.
        if (c.parse_graph.css_file_count > 0) {
            var wait_group = try c.allocator.create(sync.WaitGroup);
            wait_group.init();
            defer {
                wait_group.deinit();
                c.allocator.destroy(wait_group);
            }
            const total_count = total_count: {
                var total_count: usize = 0;
                for (chunks) |*chunk| {
                    if (chunk.content == .css) total_count += 1;
                }
                break :total_count total_count;
            };

            debug(" START {d} prepare CSS ast (total count)", .{total_count});
            defer debug("  DONE {d} prepare CSS ast (total count)", .{total_count});

            var batch = ThreadPoolLib.Batch{};
            const tasks = c.allocator.alloc(LinkerContext.PrepareCssAstTask, total_count) catch bun.outOfMemory();
            var i: usize = 0;
            for (chunks) |*chunk| {
                if (chunk.content == .css) {
                    tasks[i] = LinkerContext.PrepareCssAstTask{
                        .task = ThreadPoolLib.Task{
                            .callback = &LinkerContext.prepareCssAstsForChunk,
                        },
                        .chunk = chunk,
                        .linker = c,
                        .wg = wait_group,
                    };
                    batch.push(.from(&tasks[i].task));
                    i += 1;
                }
            }
            wait_group.counter = @as(u32, @truncate(total_count));
            c.parse_graph.pool.worker_pool.schedule(batch);
            wait_group.wait();
        } else if (Environment.isDebug) {
            for (chunks) |*chunk| {
                bun.assert(chunk.content != .css);
            }
        }
    }

    {
        const chunk_contexts = c.allocator.alloc(GenerateChunkCtx, chunks.len) catch unreachable;
        defer c.allocator.free(chunk_contexts);
        var wait_group = try c.allocator.create(sync.WaitGroup);
        wait_group.init();

        defer {
            wait_group.deinit();
            c.allocator.destroy(wait_group);
        }
        errdefer wait_group.wait();
        {
            var total_count: usize = 0;
            for (chunks, chunk_contexts) |*chunk, *chunk_ctx| {
                switch (chunk.content) {
                    .javascript => {
                        chunk_ctx.* = .{ .wg = wait_group, .c = c, .chunks = chunks, .chunk = chunk };
                        total_count += chunk.content.javascript.parts_in_chunk_in_order.len;
                        chunk.compile_results_for_chunk = c.allocator.alloc(CompileResult, chunk.content.javascript.parts_in_chunk_in_order.len) catch bun.outOfMemory();
                        has_js_chunk = true;
                    },
                    .css => {
                        has_css_chunk = true;
                        chunk_ctx.* = .{ .wg = wait_group, .c = c, .chunks = chunks, .chunk = chunk };
                        total_count += chunk.content.css.imports_in_chunk_in_order.len;
                        chunk.compile_results_for_chunk = c.allocator.alloc(CompileResult, chunk.content.css.imports_in_chunk_in_order.len) catch bun.outOfMemory();
                    },
                    .html => {
                        has_html_chunk = true;
                        // HTML gets only one chunk.
                        chunk_ctx.* = .{ .wg = wait_group, .c = c, .chunks = chunks, .chunk = chunk };
                        total_count += 1;
                        chunk.compile_results_for_chunk = c.allocator.alloc(CompileResult, 1) catch bun.outOfMemory();
                    },
                }
            }

            debug(" START {d} compiling part ranges", .{total_count});
            defer debug("  DONE {d} compiling part ranges", .{total_count});
            const combined_part_ranges = c.allocator.alloc(PendingPartRange, total_count) catch unreachable;
            defer c.allocator.free(combined_part_ranges);
            var remaining_part_ranges = combined_part_ranges;
            var batch = ThreadPoolLib.Batch{};
            for (chunks, chunk_contexts) |*chunk, *chunk_ctx| {
                switch (chunk.content) {
                    .javascript => {
                        for (chunk.content.javascript.parts_in_chunk_in_order, 0..) |part_range, i| {
                            if (Environment.enable_logs) {
                                debugPartRanges(
                                    "Part Range: {s} {s} ({d}..{d})",
                                    .{
                                        c.parse_graph.input_files.items(.source)[part_range.source_index.get()].path.pretty,
                                        @tagName(c.parse_graph.ast.items(.target)[part_range.source_index.get()].bakeGraph()),
                                        part_range.part_index_begin,
                                        part_range.part_index_end,
                                    },
                                );
                            }

                            remaining_part_ranges[0] = .{
                                .part_range = part_range,
                                .i = @intCast(i),
                                .task = .{
                                    .callback = &generateCompileResultForJSChunk,
                                },
                                .ctx = chunk_ctx,
                            };
                            batch.push(.from(&remaining_part_ranges[0].task));

                            remaining_part_ranges = remaining_part_ranges[1..];
                        }
                    },
                    .css => {
                        for (0..chunk.content.css.imports_in_chunk_in_order.len) |i| {
                            remaining_part_ranges[0] = .{
                                .part_range = .{},
                                .i = @intCast(i),
                                .task = .{
                                    .callback = &generateCompileResultForCssChunk,
                                },
                                .ctx = chunk_ctx,
                            };
                            batch.push(.from(&remaining_part_ranges[0].task));

                            remaining_part_ranges = remaining_part_ranges[1..];
                        }
                    },
                    .html => {
                        remaining_part_ranges[0] = .{
                            .part_range = .{},
                            .i = 0,
                            .task = .{
                                .callback = &generateCompileResultForHtmlChunk,
                            },
                            .ctx = chunk_ctx,
                        };

                        batch.push(.from(&remaining_part_ranges[0].task));
                        remaining_part_ranges = remaining_part_ranges[1..];
                    },
                }
            }
            wait_group.counter = @as(u32, @truncate(total_count));
            c.parse_graph.pool.worker_pool.schedule(batch);
            wait_group.wait();
        }

        if (c.source_maps.quoted_contents_tasks.len > 0) {
            debug(" START {d} source maps (quoted contents)", .{chunks.len});
            defer debug("  DONE {d} source maps (quoted contents)", .{chunks.len});
            c.source_maps.quoted_contents_wait_group.wait();
            c.allocator.free(c.source_maps.quoted_contents_tasks);
            c.source_maps.quoted_contents_tasks.len = 0;
        }

        // For dev server, only post-process CSS + HTML chunks.
        const chunks_to_do = if (is_dev_server) chunks[1..] else chunks;
        if (!is_dev_server or chunks_to_do.len > 0) {
            bun.assert(chunks_to_do.len > 0);
            debug(" START {d} postprocess chunks", .{chunks_to_do.len});
            defer debug("  DONE {d} postprocess chunks", .{chunks_to_do.len});
            wait_group.init();
            wait_group.counter = @as(u32, @truncate(chunks_to_do.len));

            try c.parse_graph.pool.worker_pool.doPtr(
                c.allocator,
                wait_group,
                chunk_contexts[0],
                generateChunk,
                chunks_to_do,
            );
        }
    }

    // When bake.DevServer is in use, we're going to take a different code path at the end.
    // We want to extract the source code of each part instead of combining it into a single file.
    // This is so that when hot-module updates happen, we can:
    //
    // - Reuse unchanged parts to assemble the full bundle if Cmd+R is used in the browser
    // - Send only the newly changed code through a socket.
    // - Use IncrementalGraph to have full knowledge of referenced CSS files.
    //
    // When this isn't the initial bundle, concatenation as usual would produce a
    // broken module. It is DevServer's job to create and send HMR patches.
    if (is_dev_server) return;

    // TODO: enforceNoCyclicChunkImports()
    {
        var path_names_map = bun.StringHashMap(void).init(c.allocator);
        defer path_names_map.deinit();

        const DuplicateEntry = struct {
            sources: std.ArrayListUnmanaged(*Chunk) = .{},
        };
        var duplicates_map: bun.StringArrayHashMapUnmanaged(DuplicateEntry) = .{};

        var chunk_visit_map = try AutoBitSet.initEmpty(c.allocator, chunks.len);
        defer chunk_visit_map.deinit(c.allocator);

        // Compute the final hashes of each chunk, then use those to create the final
        // paths of each chunk. This can technically be done in parallel but it
        // probably doesn't matter so much because we're not hashing that much data.
        for (chunks, 0..) |*chunk, index| {
            var hash: ContentHasher = .{};
            c.appendIsolatedHashesForImportedChunks(&hash, chunks, @intCast(index), &chunk_visit_map);
            chunk_visit_map.setAll(false);
            chunk.template.placeholder.hash = hash.digest();

            const rel_path = std.fmt.allocPrint(c.allocator, "{any}", .{chunk.template}) catch bun.outOfMemory();
            bun.path.platformToPosixInPlace(u8, rel_path);

            if ((try path_names_map.getOrPut(rel_path)).found_existing) {
                // collect all duplicates in a list
                const dup = try duplicates_map.getOrPut(bun.default_allocator, rel_path);
                if (!dup.found_existing) dup.value_ptr.* = .{};
                try dup.value_ptr.sources.append(bun.default_allocator, chunk);
                continue;
            }

            // resolve any /./ and /../ occurrences
            // use resolvePosix since we asserted above all seps are '/'
            if (Environment.isWindows and std.mem.indexOf(u8, rel_path, "/./") != null) {
                var buf: bun.PathBuffer = undefined;
                const rel_path_fixed = c.allocator.dupe(u8, bun.path.normalizeBuf(rel_path, &buf, .posix)) catch bun.outOfMemory();
                chunk.final_rel_path = rel_path_fixed;
                continue;
            }

            chunk.final_rel_path = rel_path;
        }

        if (duplicates_map.count() > 0) {
            var msg = std.ArrayList(u8).init(bun.default_allocator);
            errdefer msg.deinit();

            var entry_naming: ?[]const u8 = null;
            var chunk_naming: ?[]const u8 = null;
            var asset_naming: ?[]const u8 = null;

            const writer = msg.writer();
            try writer.print("Multiple files share the same output path\n", .{});

            const kinds = c.graph.files.items(.entry_point_kind);

            for (duplicates_map.keys(), duplicates_map.values()) |key, dup| {
                try writer.print("  {s}:\n", .{key});
                for (dup.sources.items) |chunk| {
                    if (chunk.entry_point.is_entry_point) {
                        if (kinds[chunk.entry_point.source_index] == .user_specified) {
                            entry_naming = chunk.template.data;
                        } else {
                            chunk_naming = chunk.template.data;
                        }
                    } else {
                        asset_naming = chunk.template.data;
                    }

                    const source_index = chunk.entry_point.source_index;
                    const file: Logger.Source = c.parse_graph.input_files.items(.source)[source_index];
                    try writer.print("    from input {s}\n", .{file.path.pretty});
                }
            }

            try c.log.addError(null, Logger.Loc.Empty, try msg.toOwnedSlice());

            inline for (.{
                .{ .name = "entry", .template = entry_naming },
                .{ .name = "chunk", .template = chunk_naming },
                .{ .name = "asset", .template = asset_naming },
            }) |x| brk: {
                const template = x.template orelse break :brk;
                const name = x.name;

                try c.log.addMsg(.{
                    .kind = .note,
                    .data = .{
                        .text = try std.fmt.allocPrint(bun.default_allocator, name ++ " naming is '{s}', consider adding '[hash]' to make filenames unique", .{template}),
                    },
                });
            }

            return error.DuplicateOutputPath;
        }
    }

    var output_files = std.ArrayList(options.OutputFile).initCapacity(
        bun.default_allocator,
        (if (c.options.source_maps.hasExternalFiles()) chunks.len * 2 else chunks.len) +
            @as(usize, c.parse_graph.additional_output_files.items.len),
    ) catch unreachable;

    const root_path = c.resolver.opts.output_dir;
    const more_than_one_output = c.parse_graph.additional_output_files.items.len > 0 or c.options.generate_bytecode_cache or (has_css_chunk and has_js_chunk) or (has_html_chunk and (has_js_chunk or has_css_chunk));

    if (!c.resolver.opts.compile and more_than_one_output and !c.resolver.opts.supports_multiple_outputs) {
        try c.log.addError(null, Logger.Loc.Empty, "cannot write multiple output files without an output directory");
        return error.MultipleOutputFilesWithoutOutputDir;
    }

    if (root_path.len > 0) {
        try c.writeOutputFilesToDisk(root_path, chunks, &output_files);
    } else {
        // In-memory build
        for (chunks) |*chunk| {
            var display_size: usize = 0;

            const _code_result = chunk.intermediate_output.code(
                null,
                c.parse_graph,
                &c.graph,
                c.resolver.opts.public_path,
                chunk,
                chunks,
                &display_size,
                chunk.content.sourcemap(c.options.source_maps) != .none,
            );
            var code_result = _code_result catch @panic("Failed to allocate memory for output file");

            var sourcemap_output_file: ?options.OutputFile = null;
            const input_path = try bun.default_allocator.dupe(
                u8,
                if (chunk.entry_point.is_entry_point)
                    c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path.text
                else
                    chunk.final_rel_path,
            );

            switch (chunk.content.sourcemap(c.options.source_maps)) {
                .external, .linked => |tag| {
                    const output_source_map = chunk.output_source_map.finalize(bun.default_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                    var source_map_final_rel_path = bun.default_allocator.alloc(u8, chunk.final_rel_path.len + ".map".len) catch unreachable;
                    bun.copy(u8, source_map_final_rel_path, chunk.final_rel_path);
                    bun.copy(u8, source_map_final_rel_path[chunk.final_rel_path.len..], ".map");

                    if (tag == .linked) {
                        const a, const b = if (c.options.public_path.len > 0)
                            cheapPrefixNormalizer(c.options.public_path, source_map_final_rel_path)
                        else
                            .{ "", std.fs.path.basename(source_map_final_rel_path) };

                        const source_map_start = "//# sourceMappingURL=";
                        const total_len = code_result.buffer.len + source_map_start.len + a.len + b.len + "\n".len;
                        var buf = std.ArrayList(u8).initCapacity(Chunk.IntermediateOutput.allocatorForSize(total_len), total_len) catch @panic("Failed to allocate memory for output file with inline source map");
                        buf.appendSliceAssumeCapacity(code_result.buffer);
                        buf.appendSliceAssumeCapacity(source_map_start);
                        buf.appendSliceAssumeCapacity(a);
                        buf.appendSliceAssumeCapacity(b);
                        buf.appendAssumeCapacity('\n');

                        Chunk.IntermediateOutput.allocatorForSize(code_result.buffer.len).free(code_result.buffer);
                        code_result.buffer = buf.items;
                    }

                    sourcemap_output_file = options.OutputFile.init(.{
                        .data = .{
                            .buffer = .{
                                .data = output_source_map,
                                .allocator = bun.default_allocator,
                            },
                        },
                        .hash = null,
                        .loader = .json,
                        .input_loader = .file,
                        .output_path = source_map_final_rel_path,
                        .output_kind = .sourcemap,
                        .input_path = try strings.concat(bun.default_allocator, &.{ input_path, ".map" }),
                        .side = null,
                        .entry_point_index = null,
                        .is_executable = false,
                    });
                },
                .@"inline" => {
                    const output_source_map = chunk.output_source_map.finalize(bun.default_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                    const encode_len = base64.encodeLen(output_source_map);

                    const source_map_start = "//# sourceMappingURL=data:application/json;base64,";
                    const total_len = code_result.buffer.len + source_map_start.len + encode_len + 1;
                    var buf = std.ArrayList(u8).initCapacity(Chunk.IntermediateOutput.allocatorForSize(total_len), total_len) catch @panic("Failed to allocate memory for output file with inline source map");

                    buf.appendSliceAssumeCapacity(code_result.buffer);
                    buf.appendSliceAssumeCapacity(source_map_start);

                    buf.items.len += encode_len;
                    _ = base64.encode(buf.items[buf.items.len - encode_len ..], output_source_map);

                    buf.appendAssumeCapacity('\n');
                    Chunk.IntermediateOutput.allocatorForSize(code_result.buffer.len).free(code_result.buffer);
                    code_result.buffer = buf.items;
                },
                .none => {},
            }

            const bytecode_output_file: ?options.OutputFile = brk: {
                if (c.options.generate_bytecode_cache) {
                    const loader: Loader = if (chunk.entry_point.is_entry_point)
                        c.parse_graph.input_files.items(.loader)[
                            chunk.entry_point.source_index
                        ]
                    else
                        .js;

                    if (loader.isJavaScriptLike()) {
                        JSC.VirtualMachine.is_bundler_thread_for_bytecode_cache = true;
                        JSC.initialize(false);
                        var fdpath: bun.PathBuffer = undefined;
                        var source_provider_url = try bun.String.createFormat("{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path});
                        source_provider_url.ref();

                        defer source_provider_url.deref();

                        if (JSC.CachedBytecode.generate(c.options.output_format, code_result.buffer, &source_provider_url)) |result| {
                            const bytecode, const cached_bytecode = result;
                            const source_provider_url_str = source_provider_url.toSlice(bun.default_allocator);
                            defer source_provider_url_str.deinit();
                            debug("Bytecode cache generated {s}: {}", .{ source_provider_url_str.slice(), bun.fmt.size(bytecode.len, .{ .space_between_number_and_unit = true }) });
                            @memcpy(fdpath[0..chunk.final_rel_path.len], chunk.final_rel_path);
                            fdpath[chunk.final_rel_path.len..][0..bun.bytecode_extension.len].* = bun.bytecode_extension.*;

                            break :brk options.OutputFile.init(.{
                                .output_path = bun.default_allocator.dupe(u8, source_provider_url_str.slice()) catch unreachable,
                                .input_path = std.fmt.allocPrint(bun.default_allocator, "{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path}) catch unreachable,
                                .input_loader = .js,
                                .hash = if (chunk.template.placeholder.hash != null) bun.hash(bytecode) else null,
                                .output_kind = .bytecode,
                                .loader = .file,
                                .size = @as(u32, @truncate(bytecode.len)),
                                .display_size = @as(u32, @truncate(bytecode.len)),
                                .data = .{
                                    .buffer = .{ .data = bytecode, .allocator = cached_bytecode.allocator() },
                                },
                                .side = null,
                                .entry_point_index = null,
                                .is_executable = false,
                            });
                        } else {
                            // an error
                            c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to generate bytecode for {s}", .{
                                chunk.final_rel_path,
                            }) catch unreachable;
                        }
                    }
                }

                break :brk null;
            };

            const source_map_index: ?u32 = if (sourcemap_output_file != null)
                @as(u32, @truncate(output_files.items.len + 1))
            else
                null;

            const bytecode_index: ?u32 = if (bytecode_output_file != null and source_map_index != null)
                @as(u32, @truncate(output_files.items.len + 2))
            else if (bytecode_output_file != null)
                @as(u32, @truncate(output_files.items.len + 1))
            else
                null;

            const output_kind = if (chunk.content == .css)
                .asset
            else if (chunk.entry_point.is_entry_point)
                c.graph.files.items(.entry_point_kind)[chunk.entry_point.source_index].outputKind()
            else
                .chunk;
            try output_files.append(options.OutputFile.init(.{
                .data = .{
                    .buffer = .{
                        .data = code_result.buffer,
                        .allocator = Chunk.IntermediateOutput.allocatorForSize(code_result.buffer.len),
                    },
                },
                .hash = chunk.template.placeholder.hash,
                .loader = chunk.content.loader(),
                .input_path = input_path,
                .display_size = @as(u32, @truncate(display_size)),
                .output_kind = output_kind,
                .input_loader = if (chunk.entry_point.is_entry_point) c.parse_graph.input_files.items(.loader)[chunk.entry_point.source_index] else .js,
                .output_path = try bun.default_allocator.dupe(u8, chunk.final_rel_path),
                .is_executable = chunk.is_executable,
                .source_map_index = source_map_index,
                .bytecode_index = bytecode_index,
                .side = if (chunk.content == .css)
                    .client
                else switch (c.graph.ast.items(.target)[chunk.entry_point.source_index]) {
                    .browser => .client,
                    else => .server,
                },
                .entry_point_index = if (output_kind == .@"entry-point")
                    chunk.entry_point.source_index - @as(u32, (if (c.framework) |fw| if (fw.server_components != null) 3 else 1 else 1))
                else
                    null,
                .referenced_css_files = switch (chunk.content) {
                    .javascript => |js| @ptrCast(try bun.default_allocator.dupe(u32, js.css_chunks)),
                    .css => &.{},
                    .html => &.{},
                },
            }));
            if (sourcemap_output_file) |sourcemap_file| {
                try output_files.append(sourcemap_file);
            }
            if (bytecode_output_file) |bytecode_file| {
                try output_files.append(bytecode_file);
            }
        }

        try output_files.appendSlice(c.parse_graph.additional_output_files.items);
    }

    return output_files;
}

const bun = @import("bun");
const strings = bun.strings;
const LinkerContext = bun.bundle_v2.LinkerContext;
const Part = bun.bundle_v2.Part;
const Loader = bun.Loader;
const std = @import("std");
const debug = LinkerContext.debug;

const Environment = bun.Environment;
const Logger = bun.logger;
const options = bun.options;

pub const ThreadPool = bun.bundle_v2.ThreadPool;

const Loc = Logger.Loc;
const Chunk = bun.bundle_v2.Chunk;

const sync = bun.ThreadPool;
const GenerateChunkCtx = LinkerContext.GenerateChunkCtx;
const CompileResult = LinkerContext.CompileResult;
const PendingPartRange = LinkerContext.PendingPartRange;

const Output = bun.Output;
const debugPartRanges = Output.scoped(.PartRanges, true);

const generateCompileResultForJSChunk = LinkerContext.generateCompileResultForJSChunk;
const generateCompileResultForCssChunk = LinkerContext.generateCompileResultForCssChunk;
const generateCompileResultForHtmlChunk = LinkerContext.generateCompileResultForHtmlChunk;
const generateChunk = LinkerContext.generateChunk;

const AutoBitSet = bun.bit_set.AutoBitSet;

const ContentHasher = bun.bundle_v2.ContentHasher;

const cheapPrefixNormalizer = bun.bundle_v2.cheapPrefixNormalizer;

const base64 = bun.base64;

const JSC = bun.JSC;

pub const ThreadPoolLib = bun.ThreadPool;
