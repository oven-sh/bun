pub fn writeOutputFilesToDisk(
    c: *LinkerContext,
    root_path: string,
    chunks: []Chunk,
    output_files: *OutputFileListBuilder,
) !void {
    const trace = bun.perf.trace("Bundler.writeOutputFilesToDisk");
    defer trace.end();
    var root_dir = std.fs.cwd().makeOpenPath(root_path, .{}) catch |err| {
        if (err == error.NotDir) {
            c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to create output directory {f} is a file. Please choose a different outdir or delete {f}", .{
                bun.fmt.quote(root_path),
                bun.fmt.quote(root_path),
            }) catch unreachable;
        } else {
            c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to create output directory {s} {f}", .{
                @errorName(err),
                bun.fmt.quote(root_path),
            }) catch unreachable;
        }

        return err;
    };
    defer root_dir.close();
    // Optimization: when writing to disk, we can re-use the memory
    var max_heap_allocator: bun.MaxHeapAllocator = undefined;
    defer max_heap_allocator.deinit();

    const code_allocator = max_heap_allocator.init(bun.default_allocator);

    var max_heap_allocator_source_map: bun.MaxHeapAllocator = undefined;
    defer max_heap_allocator_source_map.deinit();

    const source_map_allocator = max_heap_allocator_source_map.init(bun.default_allocator);

    var max_heap_allocator_inline_source_map: bun.MaxHeapAllocator = undefined;
    defer max_heap_allocator_inline_source_map.deinit();

    const code_with_inline_source_map_allocator = max_heap_allocator_inline_source_map.init(bun.default_allocator);

    var pathbuf: bun.PathBuffer = undefined;
    const bv2: *bundler.BundleV2 = @fieldParentPtr("linker", c);

    for (chunks, 0..) |*chunk, chunk_index_in_chunks_list| {
        const trace2 = bun.perf.trace("Bundler.writeChunkToDisk");
        defer trace2.end();
        defer max_heap_allocator.reset();

        const rel_path = chunk.final_rel_path;
        if (std.fs.path.dirnamePosix(rel_path)) |rel_parent| {
            if (rel_parent.len > 0) {
                root_dir.makePath(rel_parent) catch |err| {
                    c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{s} creating outdir {f} while saving chunk {f}", .{
                        @errorName(err),
                        bun.fmt.quote(rel_parent),
                        bun.fmt.quote(chunk.final_rel_path),
                    }) catch unreachable;
                    return err;
                };
            }
        }
        var display_size: usize = 0;
        const public_path = if (chunk.flags.is_browser_chunk_from_server_build)
            bv2.transpilerForTarget(.browser).options.public_path
        else
            c.resolver.opts.public_path;

        var code_result = chunk.intermediate_output.code(
            code_allocator,
            c.parse_graph,
            &c.graph,
            public_path,
            chunk,
            chunks,
            &display_size,
            c.resolver.opts.compile and !chunk.flags.is_browser_chunk_from_server_build,
            chunk.content.sourcemap(c.options.source_maps) != .none,
        ) catch |err| bun.Output.panic("Failed to create output chunk: {s}", .{@errorName(err)});

        var source_map_output_file: ?options.OutputFile = null;

        const input_path = try bun.default_allocator.dupe(
            u8,
            if (chunk.entry_point.is_entry_point)
                c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path.text
            else
                chunk.final_rel_path,
        );

        switch (chunk.content.sourcemap(c.options.source_maps)) {
            .external, .linked => |tag| {
                const output_source_map = chunk.output_source_map.finalize(source_map_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                const source_map_final_rel_path = strings.concat(default_allocator, &.{
                    chunk.final_rel_path,
                    ".map",
                }) catch @panic("Failed to allocate memory for external source map path");

                if (tag == .linked) {
                    const a, const b = if (public_path.len > 0)
                        cheapPrefixNormalizer(public_path, source_map_final_rel_path)
                    else
                        .{ "", std.fs.path.basename(source_map_final_rel_path) };

                    const source_map_start = "//# sourceMappingURL=";
                    const total_len = code_result.buffer.len + source_map_start.len + a.len + b.len + "\n".len;
                    var buf = std.array_list.Managed(u8).initCapacity(Chunk.IntermediateOutput.allocatorForSize(total_len), total_len) catch @panic("Failed to allocate memory for output file with inline source map");
                    buf.appendSliceAssumeCapacity(code_result.buffer);
                    buf.appendSliceAssumeCapacity(source_map_start);
                    buf.appendSliceAssumeCapacity(a);
                    buf.appendSliceAssumeCapacity(b);
                    buf.appendAssumeCapacity('\n');
                    code_result.buffer = buf.items;
                }

                switch (jsc.Node.fs.NodeFS.writeFileWithPathBuffer(
                    &pathbuf,
                    .{
                        .data = jsc.Node.StringOrBuffer{
                            .buffer = bun.api.node.Buffer{
                                .buffer = .{
                                    .ptr = @constCast(output_source_map.ptr),
                                    // TODO: handle > 4 GB files
                                    .len = @as(u32, @truncate(output_source_map.len)),
                                    .byte_len = @as(u32, @truncate(output_source_map.len)),
                                },
                            },
                        },
                        .encoding = .buffer,
                        .dirfd = .fromStdDir(root_dir),
                        .file = .{
                            .path = .{
                                .string = bun.PathString.init(source_map_final_rel_path),
                            },
                        },
                    },
                )) {
                    .err => |err| {
                        try c.log.addSysError(bun.default_allocator, err, "writing sourcemap for chunk {f}", .{
                            bun.fmt.quote(chunk.final_rel_path),
                        });
                        return error.WriteFailed;
                    },
                    .result => {},
                }

                source_map_output_file = options.OutputFile.init(.{
                    .output_path = source_map_final_rel_path,
                    .input_path = try strings.concat(bun.default_allocator, &.{ input_path, ".map" }),
                    .loader = .json,
                    .input_loader = .file,
                    .output_kind = .sourcemap,
                    .size = @as(u32, @truncate(output_source_map.len)),
                    .data = .{
                        .saved = 0,
                    },
                    .side = .client,
                    .entry_point_index = null,
                    .is_executable = false,
                });
            },
            .@"inline" => {
                const output_source_map = chunk.output_source_map.finalize(source_map_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                const encode_len = base64.encodeLen(output_source_map);

                const source_map_start = "//# sourceMappingURL=data:application/json;base64,";
                const total_len = code_result.buffer.len + source_map_start.len + encode_len + 1;
                var buf = std.array_list.Managed(u8).initCapacity(code_with_inline_source_map_allocator, total_len) catch @panic("Failed to allocate memory for output file with inline source map");

                buf.appendSliceAssumeCapacity(code_result.buffer);
                buf.appendSliceAssumeCapacity(source_map_start);

                buf.items.len += encode_len;
                _ = base64.encode(buf.items[buf.items.len - encode_len ..], output_source_map);

                buf.appendAssumeCapacity('\n');
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
                    jsc.VirtualMachine.is_bundler_thread_for_bytecode_cache = true;
                    jsc.initialize(false);
                    var fdpath: bun.PathBuffer = undefined;
                    var source_provider_url = try bun.String.createFormat("{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path});
                    source_provider_url.ref();

                    defer source_provider_url.deref();

                    if (jsc.CachedBytecode.generate(c.options.output_format, code_result.buffer, &source_provider_url)) |result| {
                        const source_provider_url_str = source_provider_url.toSlice(bun.default_allocator);
                        defer source_provider_url_str.deinit();
                        const bytecode, const cached_bytecode = result;
                        debug("Bytecode cache generated {s}: {f}", .{ source_provider_url_str.slice(), bun.fmt.size(bytecode.len, .{ .space_between_number_and_unit = true }) });
                        @memcpy(fdpath[0..chunk.final_rel_path.len], chunk.final_rel_path);
                        fdpath[chunk.final_rel_path.len..][0..bun.bytecode_extension.len].* = bun.bytecode_extension.*;
                        defer cached_bytecode.deref();
                        switch (jsc.Node.fs.NodeFS.writeFileWithPathBuffer(
                            &pathbuf,
                            .{
                                .data = .{
                                    .buffer = .{
                                        .buffer = .{
                                            .ptr = @constCast(bytecode.ptr),
                                            .len = @as(u32, @truncate(bytecode.len)),
                                            .byte_len = @as(u32, @truncate(bytecode.len)),
                                        },
                                    },
                                },
                                .encoding = .buffer,
                                .mode = if (chunk.flags.is_executable) 0o755 else 0o644,

                                .dirfd = .fromStdDir(root_dir),
                                .file = .{
                                    .path = .{
                                        .string = bun.PathString.init(fdpath[0 .. chunk.final_rel_path.len + bun.bytecode_extension.len]),
                                    },
                                },
                            },
                        )) {
                            .result => {},
                            .err => |err| {
                                c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{f} writing bytecode for chunk {f}", .{
                                    err,
                                    bun.fmt.quote(chunk.final_rel_path),
                                }) catch unreachable;
                                return error.WriteFailed;
                            },
                        }

                        break :brk options.OutputFile.init(.{
                            .output_path = bun.default_allocator.dupe(u8, source_provider_url_str.slice()) catch unreachable,
                            .input_path = std.fmt.allocPrint(bun.default_allocator, "{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path}) catch unreachable,
                            .input_loader = .file,
                            .hash = if (chunk.template.placeholder.hash != null) bun.hash(bytecode) else null,
                            .output_kind = .bytecode,
                            .loader = .file,
                            .size = @as(u32, @truncate(bytecode.len)),
                            .display_size = @as(u32, @truncate(bytecode.len)),
                            .data = .{
                                .saved = 0,
                            },
                            .side = null,
                            .entry_point_index = null,
                            .is_executable = false,
                        });
                    }
                }
            }

            break :brk null;
        };

        switch (jsc.Node.fs.NodeFS.writeFileWithPathBuffer(
            &pathbuf,
            .{
                .data = .{
                    .buffer = .{
                        .buffer = .{
                            .ptr = @constCast(code_result.buffer.ptr),
                            // TODO: handle > 4 GB files
                            .len = @as(u32, @truncate(code_result.buffer.len)),
                            .byte_len = @as(u32, @truncate(code_result.buffer.len)),
                        },
                    },
                },
                .encoding = .buffer,
                .mode = if (chunk.flags.is_executable) 0o755 else 0o644,

                .dirfd = .fromStdDir(root_dir),
                .file = .{
                    .path = jsc.Node.PathLike{
                        .string = bun.PathString.init(rel_path),
                    },
                },
            },
        )) {
            .err => |err| {
                try c.log.addSysError(bun.default_allocator, err, "writing chunk {f}", .{
                    bun.fmt.quote(chunk.final_rel_path),
                });
                return error.WriteFailed;
            },
            .result => {},
        }

        const source_map_index: ?u32 = if (source_map_output_file != null)
            try output_files.insertForSourcemapOrBytecode(source_map_output_file.?)
        else
            null;

        const bytecode_index: ?u32 = if (bytecode_output_file != null)
            try output_files.insertForSourcemapOrBytecode(bytecode_output_file.?)
        else
            null;

        const output_kind = if (chunk.content == .css)
            .asset
        else if (chunk.entry_point.is_entry_point)
            c.graph.files.items(.entry_point_kind)[chunk.entry_point.source_index].outputKind()
        else
            .chunk;

        const chunk_index = output_files.insertForChunk(options.OutputFile.init(.{
            .output_path = bun.default_allocator.dupe(u8, chunk.final_rel_path) catch unreachable,
            .input_path = input_path,
            .input_loader = if (chunk.entry_point.is_entry_point)
                c.parse_graph.input_files.items(.loader)[chunk.entry_point.source_index]
            else
                .js,
            .hash = chunk.template.placeholder.hash,
            .output_kind = output_kind,
            .loader = .js,
            .source_map_index = source_map_index,
            .bytecode_index = bytecode_index,
            .size = @as(u32, @truncate(code_result.buffer.len)),
            .display_size = @as(u32, @truncate(display_size)),
            .is_executable = chunk.flags.is_executable,
            .data = .{
                .saved = 0,
            },
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
            .referenced_css_chunks = switch (chunk.content) {
                .javascript => |js| @ptrCast(try bun.default_allocator.dupe(u32, js.css_chunks)),
                .css => &.{},
                .html => &.{},
            },
        }));

        // We want the chunk index to remain the same in `output_files` so the indices in `OutputFile.referenced_css_chunks` work
        bun.assertf(chunk_index == chunk_index_in_chunks_list, "chunk_index ({d}) != chunk_index_in_chunks_list ({d})", .{ chunk_index, chunk_index_in_chunks_list });
    }

    {
        const additional_output_files = output_files.getMutableAdditionalOutputFiles();
        output_files.total_insertions += @intCast(additional_output_files.len);
        for (c.parse_graph.additional_output_files.items, additional_output_files) |*src, *dest| {
            const bytes = src.value.buffer.bytes;
            src.value.buffer.bytes.len = 0;

            defer {
                src.value.buffer.allocator.free(bytes);
            }

            if (std.fs.path.dirname(src.dest_path)) |rel_parent| {
                if (rel_parent.len > 0) {
                    root_dir.makePath(rel_parent) catch |err| {
                        c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{s} creating outdir {f} while saving file {f}", .{
                            @errorName(err),
                            bun.fmt.quote(rel_parent),
                            bun.fmt.quote(src.dest_path),
                        }) catch unreachable;
                        return err;
                    };
                }
            }

            switch (jsc.Node.fs.NodeFS.writeFileWithPathBuffer(
                &pathbuf,
                .{
                    .data = .{
                        .buffer = .{
                            .buffer = .{
                                .ptr = @constCast(bytes.ptr),
                                .len = @as(u32, @truncate(bytes.len)),
                                .byte_len = @as(u32, @truncate(bytes.len)),
                            },
                        },
                    },
                    .encoding = .buffer,
                    .dirfd = .fromStdDir(root_dir),
                    .file = .{
                        .path = jsc.Node.PathLike{
                            .string = bun.PathString.init(src.dest_path),
                        },
                    },
                },
            )) {
                .err => |err| {
                    c.log.addSysError(bun.default_allocator, err, "writing file {f}", .{
                        bun.fmt.quote(src.src_path.text),
                    }) catch unreachable;
                    return error.WriteFailed;
                },
                .result => {},
            }

            dest.* = src.*;
            dest.value = .{
                .saved = .{},
            };
            dest.size = @as(u32, @truncate(bytes.len));
        }
    }
}

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Loader = bun.Loader;
const Output = bun.Output;
const base64 = bun.base64;
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const options = bun.options;
const strings = bun.strings;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const cheapPrefixNormalizer = bundler.cheapPrefixNormalizer;

const LinkerContext = bun.bundle_v2.LinkerContext;
const OutputFileListBuilder = bun.bundle_v2.LinkerContext.OutputFileListBuilder;
const debug = LinkerContext.debug;

const Logger = bun.logger;
const Loc = Logger.Loc;
