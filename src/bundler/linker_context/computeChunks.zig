pub noinline fn computeChunks(
    this: *LinkerContext,
    unique_key: u64,
) ![]Chunk {
    const trace = bun.perf.trace("Bundler.computeChunks");
    defer trace.end();

    bun.assert(this.dev_server == null); // use

    var stack_fallback = std.heap.stackFallback(4096, this.allocator());
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

        // For code splitting, entry point chunks should be keyed by ONLY the entry point's
        // own bit, not the full entry_bits. This ensures that if an entry point file is
        // reachable from other entry points (e.g., via re-exports), its content goes into
        // a shared chunk rather than staying in the entry point's chunk.
        // https://github.com/evanw/esbuild/blob/cd832972927f1f67b6d2cc895c06a8759c1cf309/internal/linker/linker.go#L3882
        var entry_point_chunk_bits = try AutoBitSet.initEmpty(this.allocator(), this.graph.entry_points.len);
        entry_point_chunk_bits.set(entry_bit);

        const js_chunk_key = brk: {
            if (code_splitting) {
                break :brk try temp_allocator.dupe(u8, entry_point_chunk_bits.bytes(this.graph.entry_points.len));
            } else {
                // Force HTML chunks to always be generated, even if there's an identical JS file.
                break :brk try std.fmt.allocPrint(temp_allocator, "{f}", .{JSChunkKeyFormatter{
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
                    .entry_bits = entry_point_chunk_bits,
                    .content = .html,
                    .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
                    .flags = .{ .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser },
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
                    .entry_bits = entry_point_chunk_bits,
                    .content = .{
                        .css = .{
                            .imports_in_chunk_in_order = order,
                            .asts = bun.handleOom(this.allocator().alloc(bun.css.BundlerStyleSheet, order.len)),
                        },
                    },
                    .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
                    .flags = .{
                        .has_html_chunk = has_html_chunk,
                        .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
                    },
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
            .entry_bits = entry_point_chunk_bits,
            .content = .{
                .javascript = .{},
            },
            .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
            .flags = .{
                .has_html_chunk = has_html_chunk,
                .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
            },
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

                js_chunk_entry.value_ptr.content.javascript.css_chunks = try this.allocator().dupe(u32, &.{
                    @intCast(css_chunk_entry.index),
                });
                js_chunks_with_css += 1;

                if (!css_chunk_entry.found_existing) {
                    var css_files_with_parts_in_chunk = std.AutoArrayHashMapUnmanaged(Index.Int, usize){};
                    for (order.slice()) |entry| {
                        if (entry.kind == .source_index) {
                            bun.handleOom(css_files_with_parts_in_chunk.put(this.allocator(), entry.kind.source_index.get(), 0));
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
                                .asts = bun.handleOom(this.allocator().alloc(bun.css.BundlerStyleSheet, order.len)),
                            },
                        },
                        .files_with_parts_in_chunk = css_files_with_parts_in_chunk,
                        .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
                        .flags = .{
                            .has_html_chunk = has_html_chunk,
                            .is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index] == .browser,
                        },
                    };
                }
            }
        }
    }
    var file_entry_bits: []AutoBitSet = this.graph.files.items(.entry_bits);

    const Handler = struct {
        chunks: []Chunk,
        allocator: std.mem.Allocator,
        source_id: u32,

        pub fn next(c: *@This(), chunk_id: usize) void {
            const entry = c.chunks[chunk_id].files_with_parts_in_chunk.getOrPut(c.allocator, @as(u32, @truncate(c.source_id))) catch unreachable;
            if (!entry.found_existing) {
                entry.value_ptr.* = 0; // Initialize byte count to 0
            }
        }
    };

    const css_reprs = this.graph.ast.items(.css);

    // Figure out which JS files are in which chunk
    if (js_chunks.count() > 0) {
        for (this.graph.reachable_files) |source_index| {
            if (this.graph.files_live.isSet(source_index.get())) {
                if (this.graph.ast.items(.css)[source_index.get()] == null) {
                    const entry_bits: *const AutoBitSet = &file_entry_bits[source_index.get()];
                    if (css_reprs[source_index.get()] != null) continue;

                    if (this.graph.code_splitting) {
                        const js_chunk_key = try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len));
                        var js_chunk_entry = try js_chunks.getOrPut(js_chunk_key);

                        if (!js_chunk_entry.found_existing) {
                            const is_browser_chunk_from_server_build = could_be_browser_target_from_server_build and ast_targets[source_index.get()] == .browser;
                            js_chunk_entry.value_ptr.* = .{
                                .entry_bits = entry_bits.*,
                                .entry_point = .{
                                    .source_index = source_index.get(),
                                },
                                .content = .{
                                    .javascript = .{},
                                },
                                .output_source_map = SourceMap.SourceMapPieces.init(this.allocator()),
                                .flags = .{ .is_browser_chunk_from_server_build = is_browser_chunk_from_server_build },
                            };
                        } else if (could_be_browser_target_from_server_build and
                            !js_chunk_entry.value_ptr.entry_point.is_entry_point and
                            !js_chunk_entry.value_ptr.flags.is_browser_chunk_from_server_build and
                            ast_targets[source_index.get()] == .browser)
                        {
                            // If any file in the chunk has browser target, mark the whole chunk as browser.
                            // This handles the case where a lazy-loaded chunk (code splitting chunk, not entry point)
                            // contains browser-targeted files but was first created by a non-browser file.
                            // We only apply this to non-entry-point chunks to preserve the correct side for server entry points.
                            js_chunk_entry.value_ptr.flags.is_browser_chunk_from_server_build = true;
                        }

                        const entry = js_chunk_entry.value_ptr.files_with_parts_in_chunk.getOrPut(this.allocator(), @as(u32, @truncate(source_index.get()))) catch unreachable;
                        if (!entry.found_existing) {
                            entry.value_ptr.* = 0; // Initialize byte count to 0
                        }
                    } else {
                        var handler = Handler{
                            .chunks = js_chunks.values(),
                            .allocator = this.allocator(),
                            .source_id = source_index.get(),
                        };
                        entry_bits.forEach(Handler, &handler, Handler.next);
                    }
                }
            }
        }
    }

    // Sort the chunks for determinism. This matters because we use chunk indices
    // as sorting keys in a few places.
    const chunks: []Chunk = sort_chunks: {
        var sorted_chunks = try BabyList(Chunk).initCapacity(this.allocator(), js_chunks.count() + css_chunks.count() + html_chunks.count());

        var sorted_keys = try BabyList(string).initCapacity(temp_allocator, js_chunks.count());

        sorted_keys.appendSliceAssumeCapacity(js_chunks.keys());

        // sort by entry_point_id to ensure the main entry point (id=0) comes first,
        // then by key for determinism among the rest.
        const ChunkSortContext = struct {
            chunks: *const bun.StringArrayHashMap(Chunk),

            pub fn lessThan(ctx: @This(), a_key: string, b_key: string) bool {
                const a_chunk = ctx.chunks.get(a_key) orelse return true;
                const b_chunk = ctx.chunks.get(b_key) orelse return false;
                const a_id = a_chunk.entry_point.entry_point_id;
                const b_id = b_chunk.entry_point.entry_point_id;

                // Main entry point (id=0) always comes first
                if (a_id == 0 and b_id != 0) return true;
                if (b_id == 0 and a_id != 0) return false;

                // Otherwise sort alphabetically by key for determinism
                return bun.strings.order(a_key, b_key) == .lt;
            }
        };

        sorted_keys.sort(ChunkSortContext, .{ .chunks = &js_chunks });
        var js_chunk_indices_with_css = try BabyList(u32).initCapacity(temp_allocator, js_chunks_with_css);
        for (sorted_keys.slice()) |key| {
            const chunk = js_chunks.get(key) orelse unreachable;

            if (chunk.content.javascript.css_chunks.len > 0)
                js_chunk_indices_with_css.appendAssumeCapacity(sorted_chunks.len);

            sorted_chunks.appendAssumeCapacity(chunk);

            // Attempt to order the JS HTML chunk immediately after the non-html one.
            if (chunk.flags.has_html_chunk) {
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
        try sorted_chunks.appendSlice(this.allocator(), html_chunks.values());

        break :sort_chunks sorted_chunks.slice();
    };

    const entry_point_chunk_indices: []u32 = this.graph.files.items(.entry_point_chunk_index);
    // Map from the entry point file to this chunk. We will need this later if
    // a file contains a dynamic import to this entry point, since we'll need
    // to look up the path for this chunk to use with the import.
    for (chunks, 0..) |*chunk, chunk_id| {
        if (chunk.entry_point.is_entry_point) {
            // JS entry points that import CSS files generate two chunks, a JS chunk
            // and a CSS chunk. Don't link the CSS chunk to the JS file since the CSS
            // chunk is secondary (the JS chunk is primary).
            if (chunk.content == .css and css_asts[chunk.entry_point.source_index] == null) {
                continue;
            }
            entry_point_chunk_indices[chunk.entry_point.source_index] = @intCast(chunk_id);
        }
    }

    // Determine the order of JS files (and parts) within the chunk ahead of time
    try this.findAllImportedPartsInJSOrder(temp_allocator, chunks);

    // Handle empty chunks case
    if (chunks.len == 0) {
        this.unique_key_buf = "";
        return chunks;
    }

    const unique_key_item_len = std.fmt.count("{f}C{d:0>8}", .{ bun.fmt.hexIntLower(unique_key), chunks.len });
    var unique_key_builder = try bun.StringBuilder.initCapacity(this.allocator(), unique_key_item_len * chunks.len);
    this.unique_key_buf = unique_key_builder.allocatedSlice();

    errdefer {
        unique_key_builder.deinit(this.allocator());
        this.unique_key_buf = "";
    }

    const kinds = this.graph.files.items(.entry_point_kind);
    const output_paths = this.graph.entry_points.items(.output_path);
    const bv2: *bundler.BundleV2 = @fieldParentPtr("linker", this);
    for (chunks, 0..) |*chunk, chunk_id| {
        // Assign a unique key to each chunk. This key encodes the index directly so
        // we can easily recover it later without needing to look it up in a map. The
        // last 8 numbers of the key are the chunk index.
        chunk.unique_key = unique_key_builder.fmt("{f}C{d:0>8}", .{ bun.fmt.hexIntLower(unique_key), chunk_id });
        if (this.unique_key_prefix.len == 0)
            this.unique_key_prefix = chunk.unique_key[0..std.fmt.count("{f}", .{bun.fmt.hexIntLower(unique_key)})];

        if (chunk.entry_point.is_entry_point and
            (chunk.content == .html or (kinds[chunk.entry_point.source_index] == .user_specified and !chunk.flags.has_html_chunk)))
        {
            // Use fileWithTarget template if there are HTML imports and user hasn't manually set naming
            if (has_server_html_imports and bv2.transpiler.options.entry_naming.len == 0) {
                chunk.template = PathTemplate.fileWithTarget;
            } else {
                chunk.template = PathTemplate.file;
                if (chunk.flags.is_browser_chunk_from_server_build) {
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
                if (chunk.flags.is_browser_chunk_from_server_build) {
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

                break :dir dir.getFdPath(&real_path_buf) catch |err| {
                    try this.log.addErrorFmt(null, .Empty, this.allocator(), "{s}: Failed to get full path for directory '{s}'", .{ @errorName(err), dir_path });
                    return error.BuildFailed;
                };
            };

            chunk.template.placeholder.dir = try resolve_path.relativeAlloc(this.allocator(), this.resolver.opts.root_dir, dir);
        }
    }

    return chunks;
}

const JSChunkKeyFormatter = struct {
    has_html: bool,
    entry_bits: []const u8,

    pub fn format(this: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try writer.writeAll(&[_]u8{@intFromBool(!this.has_html)});
        try writer.writeAll(this.entry_bits);
    }
};

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const SourceMap = bun.SourceMap;
const options = bun.options;
const AutoBitSet = bun.bit_set.AutoBitSet;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const EntryPoint = bundler.EntryPoint;
const Fs = bun.bundle_v2.Fs;
const Index = bun.bundle_v2.Index;
const LinkerContext = bun.bundle_v2.LinkerContext;
const PathTemplate = bundler.PathTemplate;
const resolve_path = bun.bundle_v2.resolve_path;
