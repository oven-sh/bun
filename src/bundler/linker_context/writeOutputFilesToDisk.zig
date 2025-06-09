pub fn writeOutputFilesToDisk(
    c: *LinkerContext,
    root_path: string,
    chunks: []Chunk,
    output_files: *std.ArrayList(options.OutputFile),
) !void {
    const trace = bun.perf.trace("Bundler.writeOutputFilesToDisk");
    defer trace.end();
    var root_dir = std.fs.cwd().makeOpenPath(root_path, .{}) catch |err| {
        if (err == error.NotDir) {
            c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to create output directory {} is a file. Please choose a different outdir or delete {}", .{
                bun.fmt.quote(root_path),
                bun.fmt.quote(root_path),
            }) catch unreachable;
        } else {
            c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to create output directory {s} {}", .{
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

    for (chunks) |*chunk| {
        const trace2 = bun.perf.trace("Bundler.writeChunkToDisk");
        defer trace2.end();
        defer max_heap_allocator.reset();

        const rel_path = chunk.final_rel_path;
        if (std.fs.path.dirnamePosix(rel_path)) |rel_parent| {
            if (rel_parent.len > 0) {
                root_dir.makePath(rel_parent) catch |err| {
                    c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{s} creating outdir {} while saving chunk {}", .{
                        @errorName(err),
                        bun.fmt.quote(rel_parent),
                        bun.fmt.quote(chunk.final_rel_path),
                    }) catch unreachable;
                    return err;
                };
            }
        }
        var display_size: usize = 0;
        var code_result = chunk.intermediate_output.code(
            code_allocator,
            c.parse_graph,
            &c.graph,
            c.resolver.opts.public_path,
            chunk,
            chunks,
            &display_size,
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
                    code_result.buffer = buf.items;
                }

                switch (JSC.Node.fs.NodeFS.writeFileWithPathBuffer(
                    &pathbuf,
                    .{
                        .data = JSC.Node.StringOrBuffer{
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
                        try c.log.addSysError(bun.default_allocator, err, "writing sourcemap for chunk {}", .{
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
                var buf = std.ArrayList(u8).initCapacity(code_with_inline_source_map_allocator, total_len) catch @panic("Failed to allocate memory for output file with inline source map");

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
                    JSC.VirtualMachine.is_bundler_thread_for_bytecode_cache = true;
                    JSC.initialize(false);
                    var fdpath: bun.PathBuffer = undefined;
                    var source_provider_url = try bun.String.createFormat("{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path});
                    source_provider_url.ref();

                    defer source_provider_url.deref();

                    if (JSC.CachedBytecode.generate(c.options.output_format, code_result.buffer, &source_provider_url)) |result| {
                        const source_provider_url_str = source_provider_url.toSlice(bun.default_allocator);
                        defer source_provider_url_str.deinit();
                        const bytecode, const cached_bytecode = result;
                        debug("Bytecode cache generated {s}: {}", .{ source_provider_url_str.slice(), bun.fmt.size(bytecode.len, .{ .space_between_number_and_unit = true }) });
                        @memcpy(fdpath[0..chunk.final_rel_path.len], chunk.final_rel_path);
                        fdpath[chunk.final_rel_path.len..][0..bun.bytecode_extension.len].* = bun.bytecode_extension.*;
                        defer cached_bytecode.deref();
                        switch (JSC.Node.fs.NodeFS.writeFileWithPathBuffer(
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
                                .mode = if (chunk.is_executable) 0o755 else 0o644,

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
                                c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{} writing bytecode for chunk {}", .{
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

        switch (JSC.Node.fs.NodeFS.writeFileWithPathBuffer(
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
                .mode = if (chunk.is_executable) 0o755 else 0o644,

                .dirfd = .fromStdDir(root_dir),
                .file = .{
                    .path = JSC.Node.PathLike{
                        .string = bun.PathString.init(rel_path),
                    },
                },
            },
        )) {
            .err => |err| {
                try c.log.addSysError(bun.default_allocator, err, "writing chunk {}", .{
                    bun.fmt.quote(chunk.final_rel_path),
                });
                return error.WriteFailed;
            },
            .result => {},
        }

        const source_map_index: ?u32 = if (source_map_output_file != null)
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
            .is_executable = chunk.is_executable,
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
            .referenced_css_files = switch (chunk.content) {
                .javascript => |js| @ptrCast(try bun.default_allocator.dupe(u32, js.css_chunks)),
                .css => &.{},
                .html => &.{},
            },
        }));

        if (source_map_output_file) |sourcemap_file| {
            try output_files.append(sourcemap_file);
        }

        if (bytecode_output_file) |bytecode_file| {
            try output_files.append(bytecode_file);
        }
    }

    {
        const offset = output_files.items.len;
        output_files.items.len += c.parse_graph.additional_output_files.items.len;

        for (c.parse_graph.additional_output_files.items, output_files.items[offset..][0..c.parse_graph.additional_output_files.items.len]) |*src, *dest| {
            const bytes = src.value.buffer.bytes;
            src.value.buffer.bytes.len = 0;

            defer {
                src.value.buffer.allocator.free(bytes);
            }

            if (std.fs.path.dirname(src.dest_path)) |rel_parent| {
                if (rel_parent.len > 0) {
                    root_dir.makePath(rel_parent) catch |err| {
                        c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{s} creating outdir {} while saving file {}", .{
                            @errorName(err),
                            bun.fmt.quote(rel_parent),
                            bun.fmt.quote(src.dest_path),
                        }) catch unreachable;
                        return err;
                    };
                }
            }

            switch (JSC.Node.fs.NodeFS.writeFileWithPathBuffer(
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
                        .path = JSC.Node.PathLike{
                            .string = bun.PathString.init(src.dest_path),
                        },
                    },
                },
            )) {
                .err => |err| {
                    c.log.addSysError(bun.default_allocator, err, "writing file {}", .{
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

pub fn writeOutputFilesToS3(
    c: *LinkerContext,
    s3_url: []const u8,
    s3_credentials: ?*bun.S3.S3Credentials,
    chunks: []Chunk,
    output_files: *std.ArrayList(options.OutputFile),
    globalThis: *JSC.JSGlobalObject,
) !void {
    const trace = bun.perf.trace("Bundler.writeOutputFilesToS3");
    defer trace.end();

    // Parse S3 URL to extract bucket and prefix
    var bucket: []const u8 = "";
    var prefix: []const u8 = "";
    if (strings.hasPrefixComptime(s3_url, "s3://")) {
        const url_without_protocol = s3_url[5..];
        if (strings.indexOfChar(url_without_protocol, '/')) |slash_index| {
            bucket = url_without_protocol[0..slash_index];
            prefix = url_without_protocol[slash_index + 1 ..];
        } else {
            bucket = url_without_protocol;
        }
    } else {
        c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Invalid S3 URL format: {s}. Expected s3://bucket/prefix", .{s3_url}) catch unreachable;
        return error.InvalidS3URL;
    }

    // Get or create S3 credentials
    const credentials = s3_credentials orelse brk: {
        const env_creds = globalThis.bunVM().transpiler.env.getS3Credentials();
        if (env_creds.accessKeyId.len == 0 or env_creds.secretAccessKey.len == 0) {
            c.log.addError(null, Logger.Loc.Empty, "Missing S3 credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables") catch unreachable;
            return error.MissingS3Credentials;
        }
        var creds = env_creds.dupe();
        if (creds.bucket.len == 0) {
            creds.bucket = bucket;
        }
        break :brk creds;
    };
    defer if (s3_credentials == null) credentials.deref();

    // First, generate all content in memory
    var memory_files = std.ArrayList(MemoryFile).init(bun.default_allocator);
    defer {
        for (memory_files.items) |*file| {
            file.deinit();
        }
        memory_files.deinit();
    }

    // Generate content for all chunks
    for (chunks) |*chunk| {
        const trace2 = bun.perf.trace("Bundler.generateChunkForS3");
        defer trace2.end();

        var display_size: usize = 0;
        var code_result = chunk.intermediate_output.code(
            bun.default_allocator,
            c.parse_graph,
            &c.graph,
            c.resolver.opts.public_path,
            chunk,
            chunks,
            &display_size,
            chunk.content.sourcemap(c.options.source_maps) != .none,
        ) catch |err| bun.Output.panic("Failed to create output chunk: {s}", .{@errorName(err)});

        const input_path = try bun.default_allocator.dupe(
            u8,
            if (chunk.entry_point.is_entry_point)
                c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path.text
            else
                chunk.final_rel_path,
        );

        // Prepare S3 path
        const s3_path = if (prefix.len > 0)
            try std.fmt.allocPrint(bun.default_allocator, "{s}/{s}", .{ prefix, chunk.final_rel_path })
        else
            try bun.default_allocator.dupe(u8, chunk.final_rel_path);

        // Store the main file content
        try memory_files.append(.{
            .path = s3_path,
            .content = code_result.buffer,
            .content_type = switch (chunk.content) {
                .javascript => "application/javascript",
                .css => "text/css",
                .html => "text/html",
            },
        });

        // Handle source maps
        switch (chunk.content.sourcemap(c.options.source_maps)) {
            .external, .linked => |tag| {
                const output_source_map = chunk.output_source_map.finalize(bun.default_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                const source_map_path = try std.fmt.allocPrint(bun.default_allocator, "{s}.map", .{s3_path});

                if (tag == .linked) {
                    // Append source map URL to the code
                    const a, const b = if (c.options.public_path.len > 0)
                        cheapPrefixNormalizer(c.options.public_path, std.fs.path.basename(source_map_path))
                    else
                        .{ "", std.fs.path.basename(source_map_path) };

                    const source_map_url = try std.fmt.allocPrint(bun.default_allocator, "//# sourceMappingURL={s}{s}\n", .{ a, b });
                    const new_content = try std.mem.concat(bun.default_allocator, u8, &.{ memory_files.items[memory_files.items.len - 1].content, source_map_url });
                    memory_files.items[memory_files.items.len - 1].content = new_content;
                }

                try memory_files.append(.{
                    .path = source_map_path,
                    .content = output_source_map,
                    .content_type = "application/json",
                });
            },
            .@"inline" => {
                const output_source_map = chunk.output_source_map.finalize(bun.default_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                const encode_len = base64.encodeLen(output_source_map);

                const source_map_start = "//# sourceMappingURL=data:application/json;base64,";
                var encoded = try bun.default_allocator.alloc(u8, source_map_start.len + encode_len + 1);
                @memcpy(encoded[0..source_map_start.len], source_map_start);
                _ = base64.encode(encoded[source_map_start.len .. source_map_start.len + encode_len], output_source_map);
                encoded[encoded.len - 1] = '\n';

                const new_content = try std.mem.concat(bun.default_allocator, u8, &.{ memory_files.items[memory_files.items.len - 1].content, encoded });
                memory_files.items[memory_files.items.len - 1].content = new_content;
            },
            .none => {},
        }

        // TODO: Handle bytecode generation for S3
    }

    // Add additional output files
    for (c.parse_graph.additional_output_files.items) |*src| {
        const s3_path = if (prefix.len > 0)
            try std.fmt.allocPrint(bun.default_allocator, "{s}/{s}", .{ prefix, src.dest_path })
        else
            try bun.default_allocator.dupe(u8, src.dest_path);

        try memory_files.append(.{
            .path = s3_path,
            .content = src.value.buffer.bytes,
            .content_type = src.loader.toMimeType(&.{}),
        });
    }

    // Now upload all files to S3
    Output.prettyln("<r><d>Uploading {d} files to S3...<r>", .{memory_files.items.len});

    var upload_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0);
    var error_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0);

    for (memory_files.items) |*file| {
        const task = bun.new(S3UploadTask, .{
            .credentials = credentials,
            .path = file.path,
            .content = file.content,
            .content_type = file.content_type,
            .upload_count = &upload_count,
            .error_count = &error_count,
            .globalThis = globalThis,
        });

        // Start the upload
        credentials.ref();
        bun.S3.upload(
            credentials,
            file.path,
            file.content,
            file.content_type,
            null, // acl
            null, // proxy_url
            null, // storage_class
            S3UploadTask.onComplete,
            task,
        );
    }

    // Wait for all uploads to complete
    while (upload_count.load(.acquire) < memory_files.items.len) {
        // Let the event loop process S3 callbacks
        if (globalThis.bunVM().tick()) {
            continue;
        }
        std.time.sleep(10 * std.time.ns_per_ms);
    }

    if (error_count.load(.acquire) > 0) {
        c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to upload {d} files to S3", .{error_count.load(.acquire)}) catch unreachable;
        return error.S3UploadFailed;
    }

    Output.prettyln("<r><green>✓<r> Successfully uploaded {d} files to S3", .{memory_files.items.len});

    // Build output files list for the result
    // We don't have actual file sizes from S3, so we use the content size
    var file_index: usize = 0;
    for (chunks) |*chunk| {
        const main_file = &memory_files.items[file_index];
        file_index += 1;

        const input_path = try bun.default_allocator.dupe(
            u8,
            if (chunk.entry_point.is_entry_point)
                c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path.text
            else
                chunk.final_rel_path,
        );

        const output_kind = if (chunk.content == .css)
            .asset
        else if (chunk.entry_point.is_entry_point)
            c.graph.files.items(.entry_point_kind)[chunk.entry_point.source_index].outputKind()
        else
            .chunk;

        var source_map_index: ?u32 = null;
        if (chunk.content.sourcemap(c.options.source_maps) == .external or
            chunk.content.sourcemap(c.options.source_maps) == .linked)
        {
            source_map_index = @as(u32, @truncate(output_files.items.len + 1));
        }

        try output_files.append(options.OutputFile.init(.{
            .output_path = main_file.path,
            .input_path = input_path,
            .input_loader = if (chunk.entry_point.is_entry_point)
                c.parse_graph.input_files.items(.loader)[chunk.entry_point.source_index]
            else
                .js,
            .hash = chunk.template.placeholder.hash,
            .output_kind = output_kind,
            .loader = .js,
            .source_map_index = source_map_index,
            .bytecode_index = null,
            .size = @as(u32, @truncate(main_file.content.len)),
            .display_size = @as(u32, @truncate(main_file.content.len)),
            .is_executable = chunk.is_executable,
            .data = .{ .buffer = .{
                .allocator = bun.default_allocator,
                .bytes = main_file.content,
            } },
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

        // Add source map output file if exists
        if (source_map_index != null and
            (chunk.content.sourcemap(c.options.source_maps) == .external or
                chunk.content.sourcemap(c.options.source_maps) == .linked))
        {
            const source_map_file = &memory_files.items[file_index];
            file_index += 1;

            try output_files.append(options.OutputFile.init(.{
                .output_path = source_map_file.path,
                .input_path = try strings.concat(bun.default_allocator, &.{ input_path, ".map" }),
                .loader = .json,
                .input_loader = .file,
                .output_kind = .sourcemap,
                .size = @as(u32, @truncate(source_map_file.content.len)),
                .data = .{ .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = source_map_file.content,
                } },
                .side = .client,
                .entry_point_index = null,
                .is_executable = false,
            }));
        }
    }

    // Add additional output files
    for (c.parse_graph.additional_output_files.items) |*src| {
        const file = &memory_files.items[file_index];
        file_index += 1;

        try output_files.append(options.OutputFile.init(.{
            .output_path = file.path,
            .input_path = src.src_path.text,
            .input_loader = src.loader,
            .loader = src.loader,
            .output_kind = src.output_kind,
            .size = @as(u32, @truncate(file.content.len)),
            .data = .{ .buffer = .{
                .allocator = bun.default_allocator,
                .bytes = file.content,
            } },
            .side = src.side,
            .entry_point_index = src.entry_point_index,
            .is_executable = false,
        }));
    }
}

const MemoryFile = struct {
    path: []const u8,
    content: []const u8,
    content_type: []const u8,

    pub fn deinit(self: *MemoryFile) void {
        bun.default_allocator.free(self.path);
        // Content is managed by the chunks/output files
    }
};

const S3UploadTask = struct {
    credentials: *bun.S3.S3Credentials,
    path: []const u8,
    content: []const u8,
    content_type: []const u8,
    upload_count: *std.atomic.Value(usize),
    error_count: *std.atomic.Value(usize),
    globalThis: *JSC.JSGlobalObject,

    pub fn onComplete(result: bun.S3.S3UploadResult, ctx: *anyopaque) void {
        const task: *S3UploadTask = @ptrCast(@alignCast(ctx));
        defer {
            task.credentials.deref();
            bun.destroy(task);
        }

        switch (result) {
            .success => {
                _ = task.upload_count.fetchAdd(1, .release);
                Output.prettyln("<r><d>  Uploaded: {s}<r>", .{task.path});
            },
            .failure => |err| {
                _ = task.error_count.fetchAdd(1, .release);
                _ = task.upload_count.fetchAdd(1, .release);
                Output.prettyErrorln("<r><red>Failed to upload {s}: {s}<r>", .{ task.path, err.message });
            },
        }
    }
};

const bun = @import("bun");
const options = bun.options;
const Loader = bun.Loader;
const Logger = bun.logger;
const Loc = Logger.Loc;
const LinkerContext = bun.bundle_v2.LinkerContext;

const string = bun.string;
const Output = bun.Output;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const std = @import("std");
const sourcemap = bun.sourcemap;
const base64 = bun.base64;

const JSC = bun.JSC;
const bundler = bun.bundle_v2;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
const Chunk = bundler.Chunk;
const cheapPrefixNormalizer = bundler.cheapPrefixNormalizer;
const debug = LinkerContext.debug;
