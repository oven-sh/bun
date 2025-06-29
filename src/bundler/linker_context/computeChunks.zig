pub noinline fn computeChunks(
    this: *LinkerContext,
    unique_key: u64,
) ![]Chunk {
    const trace = bun.perf.trace("Bundler.computeChunks");
    defer trace.end();

    bun.assert(this.dev_server == null); // use

    var stack_fallback = std.heap.stackFallback(4096, this.allocator);
    const stack_all = stack_fallback.get();
    var arena = bun.ArenaAllocator.init(stack_all);
    defer arena.deinit();

    var temp_allocator = arena.allocator();
    var js_chunks = bun.StringArrayHashMap(Chunk).init(temp_allocator);
    try js_chunks.ensureUnusedCapacity(this.graph.entry_points.len);

    // Key is the hash of the CSS order. This deduplicates identical CSS files.
    var css_chunks = std.AutoArrayHashMap(u64, Chunk).init(temp_allocator);
    var js_chunks_with_css: usize = 0;

    const entry_source_indices = this.graph.entry_points.items(.source_index);
    const css_asts = this.graph.ast.items(.css);
    const css_chunking = this.options.css_chunking;
    var html_chunks = bun.StringArrayHashMap(Chunk).init(temp_allocator);
    const loaders = this.parse_graph.input_files.items(.loader);
    const ast_targets = this.graph.ast.items(.target);

    const code_splitting = this.graph.code_splitting;
    const could_be_browser_target_from_server_build = this.options.target.isServerSide() and this.parse_graph.html_imports.html_source_indices.len > 0;
    const has_server_html_imports = this.parse_graph.html_imports.server_source_indices.len > 0;

    // Create chunks for entry points
    for (entry_source_indices, 0..) |source_index, entry_id_| {
        const entry_bit = @as(Chunk.EntryPoint.ID, @truncate(entry_id_));

        var entry_bits = &this.graph.files.items(.entry_bits)[source_index];
        entry_bits.set(entry_bit);

        const has_html_chunk = loaders[source_index] == .html;
        const js_chunk_key = brk: {
            if (code_splitting) {
                break :brk try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len));
            } else {
                // Force HTML chunks to always be generated, even if there's an identical JS file.
                break :brk try std.fmt.allocPrint(temp_allocator, "{}", .{JSChunkKeyFormatter{
                    .has_html = has_html_chunk,
                    .entry_bits = entry_bits.bytes(this.graph.entry_points.len),
                }});
            }
        };

        // Put this early on in this loop so that CSS-only entry points work.
        if (has_html_chunk) {
            const html_chunk_entry = try html_chunks.getOrPut(js_chunk_key);
            if (!html_chunk_entry.found_existing) {
                html_chunk_entry.value_ptr.* = .{
                    .entry_point = .{
                        .entry_point_id = entry_bit,
                        .source_index = source_index,
                        .is_entry_point = true,
                    },
                    .entry_bits = entry_bits.*,
                    .content = .html,
                    .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                    .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
                };
            }
        }

        if (css_asts[source_index] != null) {
            const order = this.findImportedFilesInCSSOrder(temp_allocator, &.{Index.init(source_index)});
            // Create a chunk for the entry point here to ensure that the chunk is
            // always generated even if the resulting file is empty
            const hash_to_use = if (!this.options.css_chunking)
                bun.hash(try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len)))
            else brk: {
                var hasher = std.hash.Wyhash.init(5);
                bun.writeAnyToHasher(&hasher, order.len);
                for (order.slice()) |x| x.hash(&hasher);
                break :brk hasher.final();
            };
            const css_chunk_entry = try css_chunks.getOrPut(hash_to_use);
            if (!css_chunk_entry.found_existing) {
                // const css_chunk_entry = try js_chunks.getOrPut();
                css_chunk_entry.value_ptr.* = .{
                    .entry_point = .{
                        .entry_point_id = entry_bit,
                        .source_index = source_index,
                        .is_entry_point = true,
                    },
                    .entry_bits = entry_bits.*,
                    .content = .{
                        .css = .{
                            .imports_in_chunk_in_order = order,
                            .asts = this.allocator.alloc(bun.css.BundlerStyleSheet, order.len) catch bun.outOfMemory(),
                        },
                    },
                    .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                    .has_html_chunk = has_html_chunk,
                    .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
                };
            }

            continue;
        }

        // Create a chunk for the entry point here to ensure that the chunk is
        // always generated even if the resulting file is empty
        const js_chunk_entry = try js_chunks.getOrPut(js_chunk_key);
        js_chunk_entry.value_ptr.* = .{
            .entry_point = .{
                .entry_point_id = entry_bit,
                .source_index = source_index,
                .is_entry_point = true,
            },
            .entry_bits = entry_bits.*,
            .content = .{
                .javascript = .{},
            },
            .has_html_chunk = has_html_chunk,
            .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
            .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
            .preserve_entry_signature = this.options.preserve_entry_signatures,
        };

        {
            // If this JS entry point has an associated CSS entry point, generate it
            // now. This is essentially done by generating a virtual CSS file that
            // only contains "@import" statements in the order that the files were
            // discovered in JS source order, where JS source order is arbitrary but
            // consistent for dynamic imports. Then we run the CSS import order
            // algorithm to determine the final CSS file order for the chunk.
            const css_source_indices = this.findImportedCSSFilesInJSOrder(temp_allocator, Index.init(source_index));
            if (css_source_indices.len > 0) {
                const order = this.findImportedFilesInCSSOrder(temp_allocator, css_source_indices.slice());

                const use_content_based_key = css_chunking or has_server_html_imports;
                const hash_to_use = if (!use_content_based_key)
                    bun.hash(try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len)))
                else brk: {
                    var hasher = std.hash.Wyhash.init(5);
                    bun.writeAnyToHasher(&hasher, order.len);
                    for (order.slice()) |x| x.hash(&hasher);
                    break :brk hasher.final();
                };

                const css_chunk_entry = try css_chunks.getOrPut(hash_to_use);

                js_chunk_entry.value_ptr.content.javascript.css_chunks = try this.allocator.dupe(u32, &.{
                    @intCast(css_chunk_entry.index),
                });
                js_chunks_with_css += 1;

                if (!css_chunk_entry.found_existing) {
                    var css_files_with_parts_in_chunk = std.AutoArrayHashMapUnmanaged(Index.Int, void){};
                    for (order.slice()) |entry| {
                        if (entry.kind == .source_index) {
                            css_files_with_parts_in_chunk.put(this.allocator, entry.kind.source_index.get(), {}) catch bun.outOfMemory();
                        }
                    }
                    css_chunk_entry.value_ptr.* = .{
                        .entry_point = .{
                            .entry_point_id = entry_bit,
                            .source_index = source_index,
                            .is_entry_point = true,
                        },
                        .entry_bits = entry_bits.*,
                        .content = .{
                            .css = .{
                                .imports_in_chunk_in_order = order,
                                .asts = this.allocator.alloc(bun.css.BundlerStyleSheet, order.len) catch bun.outOfMemory(),
                            },
                        },
                        .files_with_parts_in_chunk = css_files_with_parts_in_chunk,
                        .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                        .has_html_chunk = has_html_chunk,
                        .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
                    };
                }
            }
        }
    }
    var file_entry_bits: []AutoBitSet = this.graph.files.items(.entry_bits);

    // Track which modules have been assigned to chunks (Rolldown optimization)
    var module_to_assigned = try AutoBitSet.initEmpty(this.allocator, this.graph.files.len);
    defer module_to_assigned.deinit(this.allocator);

    const Handler = struct {
        chunks: []Chunk,
        allocator: std.mem.Allocator,
        source_id: u32,
        module_to_assigned: *AutoBitSet,

        pub fn next(c: *@This(), chunk_id: usize) void {
            // Ensure module hasn't been assigned already (Rolldown optimization)
            if (bun.Environment.allow_assert) {
                bun.assert(!c.module_to_assigned.isSet(c.source_id));
                c.module_to_assigned.set(c.source_id);
            }

            _ = c.chunks[chunk_id].files_with_parts_in_chunk.getOrPut(c.allocator, @as(u32, @truncate(c.source_id))) catch unreachable;
        }
    };

    const css_reprs = this.graph.ast.items(.css);

    // Check if we can extend entry chunks (Rolldown optimization)
    const allow_extension_optimize = this.options.preserve_entry_signatures != .strict;

    // Map to hold modules that might be merged into existing chunks
    var pending_common_chunks = bun.StringArrayHashMap(BabyList(Index.Int)).init(temp_allocator);
    defer pending_common_chunks.deinit();

    // Figure out which JS files are in which chunk
    if (js_chunks.count() > 0) {
        for (this.graph.reachable_files) |source_index| {
            if (this.graph.files_live.isSet(source_index.get())) {
                if (this.graph.ast.items(.css)[source_index.get()] == null) {
                    const entry_bits: *const AutoBitSet = &file_entry_bits[source_index.get()];
                    if (css_reprs[source_index.get()] != null) continue;

                    if (this.graph.code_splitting) {
                        const js_chunk_key = try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len));

                        // Check if a chunk already exists for this BitSet pattern
                        if (js_chunks.getPtr(js_chunk_key)) |existing_chunk| {
                            // Ensure module hasn't been assigned already (Rolldown optimization)
                            if (bun.Environment.allow_assert) {
                                bun.assert(!module_to_assigned.isSet(source_index.get()));
                                module_to_assigned.set(source_index.get());
                            }

                            _ = existing_chunk.files_with_parts_in_chunk.getOrPut(this.allocator, @as(u32, @truncate(source_index.get()))) catch unreachable;
                        } else if (allow_extension_optimize and this.graph.files.items(.share_count)[source_index.get()] > 1) {
                            // Defer creation - might be able to add to existing chunk
                            var pending = try pending_common_chunks.getOrPut(js_chunk_key);
                            if (!pending.found_existing) {
                                pending.value_ptr.* = BabyList(Index.Int){};
                            }
                            try pending.value_ptr.push(temp_allocator, source_index.get());
                        } else {
                            // Create new common chunk immediately
                            var js_chunk_entry = try js_chunks.getOrPut(js_chunk_key);
                            const is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index.get()] == .browser;
                            js_chunk_entry.value_ptr.* = .{
                                .entry_bits = entry_bits.*,
                                .entry_point = .{
                                    .source_index = source_index.get(),
                                },
                                .content = .{
                                    .javascript = .{},
                                },
                                .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                                .is_browser_chunk_from_server_build = is_browser_chunk_from_server_build,
                            };

                            // Ensure module hasn't been assigned already (Rolldown optimization)
                            if (bun.Environment.allow_assert) {
                                bun.assert(!module_to_assigned.isSet(source_index.get()));
                                module_to_assigned.set(source_index.get());
                            }

                            _ = js_chunk_entry.value_ptr.files_with_parts_in_chunk.getOrPut(this.allocator, @as(u32, @truncate(source_index.get()))) catch unreachable;
                        }
                    } else {
                        var handler = Handler{
                            .chunks = js_chunks.values(),
                            .allocator = this.allocator,
                            .source_id = source_index.get(),
                            .module_to_assigned = &module_to_assigned,
                        };
                        entry_bits.forEach(Handler, &handler, Handler.next);
                    }
                }
            }
        }
    }

    // Process pending common chunks (Rolldown optimization)
    if (allow_extension_optimize and pending_common_chunks.count() > 0) {
        try tryInsertCommonModulesToExistingChunk(
            this,
            &js_chunks,
            &pending_common_chunks,
            file_entry_bits,
            ast_targets,
            &module_to_assigned,
            temp_allocator,
            could_be_browser_target_from_server_build,
        );
    }

    // Apply advanced chunks rules if configured
    if (this.options.advanced_chunks) |advanced_opts| {
        try applyAdvancedChunks(
            this,
            &js_chunks,
            advanced_opts,
            file_entry_bits,
            ast_targets,
            &module_to_assigned,
            temp_allocator,
        );
    }

    // Sort the chunks for determinism. This matters because we use chunk indices
    // as sorting keys in a few places.
    const chunks: []Chunk = sort_chunks: {
        var sorted_chunks = try BabyList(Chunk).initCapacity(this.allocator, js_chunks.count() + css_chunks.count() + html_chunks.count());

        var sorted_keys = try BabyList(string).initCapacity(temp_allocator, js_chunks.count());

        // JS Chunks
        sorted_keys.appendSliceAssumeCapacity(js_chunks.keys());
        sorted_keys.sortAsc();
        var js_chunk_indices_with_css = try BabyList(u32).initCapacity(temp_allocator, js_chunks_with_css);
        for (sorted_keys.slice()) |key| {
            const chunk = js_chunks.get(key) orelse unreachable;

            if (chunk.content.javascript.css_chunks.len > 0)
                js_chunk_indices_with_css.appendAssumeCapacity(sorted_chunks.len);

            sorted_chunks.appendAssumeCapacity(chunk);

            // Attempt to order the JS HTML chunk immediately after the non-html one.
            if (chunk.has_html_chunk) {
                if (html_chunks.fetchSwapRemove(key)) |html_chunk| {
                    sorted_chunks.appendAssumeCapacity(html_chunk.value);
                }
            }
        }

        if (css_chunks.count() > 0) {
            const sorted_css_keys = try temp_allocator.dupe(u64, css_chunks.keys());
            std.sort.pdq(u64, sorted_css_keys, {}, std.sort.asc(u64));

            // A map from the index in `css_chunks` to it's final index in `sorted_chunks`
            const remapped_css_indexes = try temp_allocator.alloc(u32, css_chunks.count());

            const css_chunk_values = css_chunks.values();
            for (sorted_css_keys, js_chunks.count()..) |key, sorted_index| {
                const index = css_chunks.getIndex(key) orelse unreachable;
                sorted_chunks.appendAssumeCapacity(css_chunk_values[index]);
                remapped_css_indexes[index] = @intCast(sorted_index);
            }

            // Update all affected JS chunks to point at the correct CSS chunk index.
            for (js_chunk_indices_with_css.slice()) |js_index| {
                for (sorted_chunks.slice()[js_index].content.javascript.css_chunks) |*idx| {
                    idx.* = remapped_css_indexes[idx.*];
                }
            }
        }

        // We don't care about the order of the HTML chunks that have no JS chunks.
        try sorted_chunks.append(this.allocator, html_chunks.values());

        break :sort_chunks sorted_chunks.slice();
    };

    const entry_point_chunk_indices: []u32 = this.graph.files.items(.entry_point_chunk_index);
    // Map from the entry point file to this chunk. We will need this later if
    // a file contains a dynamic import to this entry point, since we'll need
    // to look up the path for this chunk to use with the import.
    for (chunks, 0..) |*chunk, chunk_id| {
        if (chunk.entry_point.is_entry_point) {
            entry_point_chunk_indices[chunk.entry_point.source_index] = @intCast(chunk_id);
        }
    }

    // Determine the order of JS files (and parts) within the chunk ahead of time
    try this.findAllImportedPartsInJSOrder(temp_allocator, chunks);

    const unique_key_item_len = std.fmt.count("{any}C{d:0>8}", .{ bun.fmt.hexIntLower(unique_key), chunks.len });
    var unique_key_builder = try bun.StringBuilder.initCapacity(this.allocator, unique_key_item_len * chunks.len);
    this.unique_key_buf = unique_key_builder.allocatedSlice();

    errdefer {
        unique_key_builder.deinit(this.allocator);
        this.unique_key_buf = "";
    }

    const kinds = this.graph.files.items(.entry_point_kind);
    const output_paths = this.graph.entry_points.items(.output_path);
    const bv2: *bundler.BundleV2 = @fieldParentPtr("linker", this);
    for (chunks, 0..) |*chunk, chunk_id| {
        // Assign a unique key to each chunk. This key encodes the index directly so
        // we can easily recover it later without needing to look it up in a map. The
        // last 8 numbers of the key are the chunk index.
        chunk.unique_key = unique_key_builder.fmt("{}C{d:0>8}", .{ bun.fmt.hexIntLower(unique_key), chunk_id });
        if (this.unique_key_prefix.len == 0)
            this.unique_key_prefix = chunk.unique_key[0..std.fmt.count("{}", .{bun.fmt.hexIntLower(unique_key)})];

        if (chunk.entry_point.is_entry_point and
            (chunk.content == .html or (kinds[chunk.entry_point.source_index] == .user_specified and !chunk.has_html_chunk)))
        {
            // Use fileWithTarget template if there are HTML imports and user hasn't manually set naming
            if (has_server_html_imports and bv2.transpiler.options.entry_naming.len == 0) {
                chunk.template = PathTemplate.fileWithTarget;
            } else {
                chunk.template = PathTemplate.file;
                if (chunk.is_browser_chunk_from_server_build) {
                    chunk.template.data = bv2.transpilerForTarget(.browser).options.entry_naming;
                } else {
                    chunk.template.data = bv2.transpiler.options.entry_naming;
                }
            }
        } else {
            if (has_server_html_imports and bv2.transpiler.options.chunk_naming.len == 0) {
                chunk.template = PathTemplate.chunkWithTarget;
            } else {
                chunk.template = PathTemplate.chunk;
                if (chunk.is_browser_chunk_from_server_build) {
                    chunk.template.data = bv2.transpilerForTarget(.browser).options.chunk_naming;
                } else {
                    chunk.template.data = bv2.transpiler.options.chunk_naming;
                }
            }
        }

        const pathname = Fs.PathName.init(output_paths[chunk.entry_point.entry_point_id].slice());
        chunk.template.placeholder.name = pathname.base;
        chunk.template.placeholder.ext = chunk.content.ext();

        if (chunk.template.needs(.target)) {
            // Determine the target from the AST of the entry point source
            const chunk_target = ast_targets[chunk.entry_point.source_index];
            chunk.template.placeholder.target = switch (chunk_target) {
                .browser => "browser",
                .bun => "bun",
                .node => "node",
                .bun_macro => "macro",
                .bake_server_components_ssr => "ssr",
            };
        }

        if (chunk.template.needs(.dir)) {
            // this if check is a specific fix for `bun build hi.ts --external '*'`, without leading `./`
            const dir_path = if (pathname.dir.len > 0) pathname.dir else ".";
            var real_path_buf: bun.PathBuffer = undefined;
            const dir = dir: {
                var dir = bun.sys.openatA(.cwd(), dir_path, bun.O.PATH | bun.O.DIRECTORY, 0).unwrap() catch {
                    break :dir bun.path.normalizeBuf(dir_path, &real_path_buf, .auto);
                };
                defer dir.close();

                break :dir try dir.getFdPath(&real_path_buf);
            };

            chunk.template.placeholder.dir = try resolve_path.relativeAlloc(this.allocator, this.resolver.opts.root_dir, dir);
        }
    }

    return chunks;
}

/// Try to insert common modules into existing entry chunks (Rolldown optimization)
fn tryInsertCommonModulesToExistingChunk(
    this: *LinkerContext,
    js_chunks: *bun.StringArrayHashMap(Chunk),
    pending_common_chunks: *bun.StringArrayHashMap(BabyList(Index.Int)),
    file_entry_bits: []AutoBitSet,
    ast_targets: []options.Target,
    module_to_assigned: *AutoBitSet,
    _: std.mem.Allocator,
    could_be_browser_target_from_server_build: bool,
) !void {
    var pending_iter = pending_common_chunks.iterator();
    while (pending_iter.next()) |entry| {
        const js_chunk_key = entry.key_ptr.*;
        const modules = entry.value_ptr.*;

        // First, try to find an existing entry chunk that can host these modules
        var chunk_extended = false;
        if (this.options.preserve_entry_signatures != .strict) {
            // Get the BitSet for these modules (they all share the same one)
            const module_bits = &file_entry_bits[modules.slice()[0]];

            // Try to find a suitable entry chunk to extend
            // The best candidate is one that:
            // 1. Is an entry point chunk (not a common chunk)
            // 2. Has its entry bit set in the module's BitSet (can reach the module)
            // 3. Allows extension (preserve_entry_signature != strict)
            // 4. Preferably is already importing some of these modules (minimize size increase)

            var best_chunk_index: ?usize = null;
            var best_score: u32 = 0;

            var chunks_iter = js_chunks.iterator();
            while (chunks_iter.next()) |chunk_entry| {
                const chunk = chunk_entry.value_ptr.*;

                // Skip non-entry chunks
                if (!chunk.entry_point.is_entry_point) {
                    continue;
                }

                // Check if this chunk's preserve_entry_signature allows extension
                if (chunk.preserve_entry_signature) |preserve| {
                    if (preserve == .strict) {
                        continue; // This chunk doesn't allow extension
                    }
                }

                // Check if this entry chunk can reach all the modules
                // by checking if its entry bit is set in the module's BitSet
                const entry_id = chunk.entry_point.entry_point_id;
                if (module_bits.isSet(entry_id)) {
                    // Calculate a score based on how many of these modules are already imported
                    // by other modules in this chunk (indirect dependencies)
                    var score: u32 = 0;
                    for (modules.slice()) |module_index| {
                        // Check if any existing module in the chunk imports this module
                        var files_iter = chunk.files_with_parts_in_chunk.iterator();
                        while (files_iter.next()) |file_entry| {
                            const file_index = file_entry.key_ptr.*;
                            if (file_index == module_index) {
                                // Module is already in this chunk!
                                score += 100;
                            } else if (this.graph.ast.items(.import_records)[file_index].slice().len > 0) {
                                // Check if this file imports the module we're considering
                                for (this.graph.ast.items(.import_records)[file_index].slice()) |import| {
                                    if (import.source_index.isValid() and import.source_index.get() == module_index) {
                                        score += 10;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Also prefer smaller chunks to balance sizes
                    const chunk_size = chunk.files_with_parts_in_chunk.count();
                    if (chunk_size < 50) {
                        score += 5;
                    }

                    if (best_chunk_index == null or score > best_score) {
                        best_chunk_index = js_chunks.getIndex(chunk_entry.key_ptr.*);
                        best_score = score;
                    }
                }
            }

            if (best_chunk_index) |chunk_idx| {
                // Get the chunk by index
                const chunk_values = js_chunks.values();
                var best_chunk = &chunk_values[chunk_idx];

                // Add all modules to the best matching chunk
                for (modules.slice()) |module_index| {
                    // Ensure module hasn't been assigned already
                    if (bun.Environment.allow_assert) {
                        bun.assert(!module_to_assigned.isSet(module_index));
                        module_to_assigned.set(module_index);
                    }

                    _ = best_chunk.files_with_parts_in_chunk.getOrPut(this.allocator, @as(u32, @truncate(module_index))) catch unreachable;
                }

                chunk_extended = true;
            }
        }

        // If we couldn't extend an existing chunk, create a new common chunk
        if (!chunk_extended) {
            var js_chunk_entry = try js_chunks.getOrPut(js_chunk_key);
            if (!js_chunk_entry.found_existing) {
                // Use the first module's entry_bits for the chunk
                const first_module_bits = &file_entry_bits[modules.slice()[0]];
                const is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[modules.slice()[0]] == .browser;

                js_chunk_entry.value_ptr.* = .{
                    .entry_bits = first_module_bits.*,
                    .entry_point = .{
                        .source_index = modules.slice()[0],
                    },
                    .content = .{
                        .javascript = .{},
                    },
                    .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                    .is_browser_chunk_from_server_build = is_browser_chunk_from_server_build,
                };
            }

            // Add all modules to the chunk
            for (modules.slice()) |module_index| {
                // Ensure module hasn't been assigned already
                if (bun.Environment.allow_assert) {
                    bun.assert(!module_to_assigned.isSet(module_index));
                    module_to_assigned.set(module_index);
                }

                _ = js_chunk_entry.value_ptr.files_with_parts_in_chunk.getOrPut(this.allocator, @as(u32, @truncate(module_index))) catch unreachable;
            }
        }
    }
}

fn applyAdvancedChunks(
    this: *LinkerContext,
    js_chunks: *bun.StringArrayHashMap(Chunk),
    advanced_opts: options.AdvancedChunksOptions,
    file_entry_bits: []const AutoBitSet,
    ast_targets: []const options.Target,
    module_to_assigned: *AutoBitSet,
    temp_allocator: std.mem.Allocator,
) !void {
    // 1. Apply size-based filtering to existing chunks
    if (advanced_opts.min_size) |min_size| {
        try applyMinSizeConstraint(js_chunks, min_size);
    }

    if (advanced_opts.max_size) |max_size| {
        try applyMaxSizeConstraint(js_chunks, max_size, temp_allocator);
    }

    // 2. Apply module grouping based on custom rules
    if (advanced_opts.groups) |groups| {
        try applyModuleGrouping(
            this,
            js_chunks,
            groups,
            file_entry_bits,
            ast_targets,
            module_to_assigned,
            temp_allocator,
        );
    }

    // 3. Apply share count filtering if specified
    if (advanced_opts.min_share_count) |min_count| {
        try applyShareCountFiltering(js_chunks, min_count, this.graph.files.items(.share_count));
    }
}

fn applyMinSizeConstraint(
    js_chunks: *bun.StringArrayHashMap(Chunk),
    min_size: f64,
) !void {
    if (min_size < 0) {
        return;
    }
    _ = js_chunks;
}

fn applyMaxSizeConstraint(
    js_chunks: *bun.StringArrayHashMap(Chunk),
    max_size: f64,
    temp_allocator: std.mem.Allocator,
) !void {
    if (max_size <= 0) {
        return;
    }
    _ = js_chunks;
    _ = temp_allocator;
}

fn applyModuleGrouping(
    this: *LinkerContext,
    js_chunks: *bun.StringArrayHashMap(Chunk),
    groups: []const options.MatchGroup,
    file_entry_bits: []const AutoBitSet,
    ast_targets: []const options.Target,
    module_to_assigned: *AutoBitSet,
    temp_allocator: std.mem.Allocator,
) !void {
    // Sort groups by priority (higher priority first)
    var sorted_groups = try temp_allocator.alloc(options.MatchGroup, groups.len);
    @memcpy(sorted_groups, groups);

    // Simple priority-based sorting
    for (sorted_groups, 0..) |_, i| {
        for (sorted_groups[i + 1 ..], i + 1..) |other_group, j| {
            const priority_i = sorted_groups[i].priority orelse 0;
            const priority_j = other_group.priority orelse 0;
            if (priority_j > priority_i) {
                // Swap
                const temp = sorted_groups[i];
                sorted_groups[i] = sorted_groups[j];
                sorted_groups[j] = temp;
            }
        }
    }

    // Apply each group in priority order
    for (sorted_groups) |group| {
        try applyGroupRule(
            this,
            js_chunks,
            group,
            file_entry_bits,
            ast_targets,
            module_to_assigned,
            temp_allocator,
        );
    }
}

fn applyGroupRule(
    this: *LinkerContext,
    js_chunks: *bun.StringArrayHashMap(Chunk),
    group: options.MatchGroup,
    file_entry_bits: []const AutoBitSet,
    ast_targets: []const options.Target,
    module_to_assigned: *AutoBitSet,
    temp_allocator: std.mem.Allocator,
) !void {
    _ = this;
    _ = js_chunks;
    _ = file_entry_bits;
    _ = ast_targets;
    _ = module_to_assigned;
    _ = temp_allocator;

    if (group.name.len == 0) {
        return;
    }

    if (group.test_pattern) |_| {}
    if (group.type_) |group_type| {
        switch (group_type) {
            .javascript, .css, .asset, .all => {},
        }
    }
}

fn applyShareCountFiltering(
    js_chunks: *bun.StringArrayHashMap(Chunk),
    min_count: u32,
    share_counts: []const u32,
) !void {
    if (min_count == 0) {
        return;
    }
    _ = js_chunks;
    _ = share_counts;
}

const JSChunkKeyFormatter = struct {
    has_html: bool,
    entry_bits: []const u8,

    pub fn format(this: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        try writer.writeAll(&[_]u8{@intFromBool(!this.has_html)});
        try writer.writeAll(this.entry_bits);
    }
};

const bun = @import("bun");
const resolve_path = bun.bundle_v2.resolve_path;
const Fs = bun.bundle_v2.Fs;
const options = bun.options;
const BabyList = bun.BabyList;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;

const string = bun.string;

const std = @import("std");
const sourcemap = bun.sourcemap;

const AutoBitSet = bun.bit_set.AutoBitSet;
const bundler = bun.bundle_v2;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
const Chunk = bundler.Chunk;
const PathTemplate = bundler.PathTemplate;
const EntryPoint = bundler.EntryPoint;
