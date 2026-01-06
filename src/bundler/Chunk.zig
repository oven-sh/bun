pub const ChunkImport = struct {
    chunk_index: u32,
    import_kind: ImportKind,
};

pub const Chunk = struct {
    /// This is a random string and is used to represent the output path of this
    /// chunk before the final output path has been computed. See OutputPiece
    /// for more info on this technique.
    unique_key: string = "",

    /// Maps source index to bytes contributed to this chunk's output (for metafile).
    /// The value is updated during chunk generation to track bytesInOutput.
    files_with_parts_in_chunk: std.AutoArrayHashMapUnmanaged(Index.Int, usize) = .{},

    /// We must not keep pointers to this type until all chunks have been allocated.
    entry_bits: AutoBitSet = undefined,

    final_rel_path: string = "",
    /// The path template used to generate `final_rel_path`
    template: PathTemplate = .{},

    /// For code splitting
    cross_chunk_imports: BabyList(ChunkImport) = .{},

    content: Content,

    entry_point: Chunk.EntryPoint = .{},

    output_source_map: SourceMap.SourceMapPieces,

    intermediate_output: IntermediateOutput = .{ .empty = {} },
    isolated_hash: u64 = std.math.maxInt(u64),

    renamer: renamer.Renamer = undefined,

    compile_results_for_chunk: []CompileResult = &.{},

    /// Pre-built JSON fragment for this chunk's metafile output entry.
    /// Generated during parallel chunk generation, joined at the end.
    metafile_chunk_json: []const u8 = "",

    /// Pack boolean flags to reduce padding overhead.
    /// Previously 3 separate bool fields caused ~21 bytes of padding waste.
    flags: Flags = .{},

    pub const Flags = packed struct(u8) {
        is_executable: bool = false,
        has_html_chunk: bool = false,
        is_browser_chunk_from_server_build: bool = false,
        _padding: u5 = 0,
    };

    pub inline fn isEntryPoint(this: *const Chunk) bool {
        return this.entry_point.is_entry_point;
    }

    pub fn getJSChunkForHTML(this: *const Chunk, chunks: []Chunk) ?*Chunk {
        const entry_point_id = this.entry_point.entry_point_id;
        for (chunks) |*other| {
            if (other.content == .javascript) {
                if (other.entry_point.entry_point_id == entry_point_id) {
                    return other;
                }
            }
        }
        return null;
    }

    pub fn getCSSChunkForHTML(this: *const Chunk, chunks: []Chunk) ?*Chunk {
        const entry_point_id = this.entry_point.entry_point_id;
        for (chunks) |*other| {
            if (other.content == .css) {
                if (other.entry_point.entry_point_id == entry_point_id) {
                    return other;
                }
            }
        }
        return null;
    }

    pub inline fn entryBits(this: *const Chunk) *const AutoBitSet {
        return &this.entry_bits;
    }

    pub const Order = struct {
        source_index: Index.Int = 0,
        distance: u32 = 0,
        tie_breaker: u32 = 0,

        pub fn lessThan(_: @This(), a: Order, b: Order) bool {
            return (a.distance < b.distance) or
                (a.distance == b.distance and a.tie_breaker < b.tie_breaker);
        }

        /// Sort so files closest to an entry point come first. If two files are
        /// equidistant to an entry point, then break the tie by sorting on the
        /// stable source index derived from the DFS over all entry points.
        pub fn sort(a: []Order) void {
            std.sort.pdq(Order, a, Order{}, lessThan);
        }
    };

    /// TODO: rewrite this
    /// This implementation is just slow.
    /// Can we make the JSPrinter itself track this without increasing
    /// complexity a lot?
    pub const IntermediateOutput = union(enum) {
        /// If the chunk has references to other chunks, then "pieces" contains
        /// the contents of the chunk. Another joiner will have to be
        /// constructed later when merging the pieces together.
        ///
        /// See OutputPiece's documentation comment for more details.
        pieces: bun.BabyList(OutputPiece),

        /// If the chunk doesn't have any references to other chunks, then
        /// `joiner` contains the contents of the chunk. This is more efficient
        /// because it avoids doing a join operation twice.
        joiner: StringJoiner,

        empty: void,

        pub fn allocatorForSize(size: usize) std.mem.Allocator {
            if (size >= 512 * 1024)
                return std.heap.page_allocator
            else
                return bun.default_allocator;
        }

        pub const CodeResult = struct {
            buffer: []u8,
            shifts: []SourceMap.SourceMapShifts,
        };

        pub fn getSize(this: *const IntermediateOutput) usize {
            return switch (this.*) {
                .pieces => |pieces| brk: {
                    var total: usize = 0;
                    for (pieces.slice()) |piece| {
                        total += piece.data_len;
                    }
                    break :brk total;
                },
                .joiner => |*joiner| joiner.len,
                .empty => 0,
            };
        }

        pub fn code(
            this: *IntermediateOutput,
            allocator_to_use: ?std.mem.Allocator,
            parse_graph: *const Graph,
            linker_graph: *const LinkerGraph,
            import_prefix: []const u8,
            chunk: *Chunk,
            chunks: []Chunk,
            display_size: ?*usize,
            force_absolute_path: bool,
            enable_source_map_shifts: bool,
        ) bun.OOM!CodeResult {
            return switch (enable_source_map_shifts) {
                inline else => |source_map_shifts| this.codeWithSourceMapShifts(
                    allocator_to_use,
                    parse_graph,
                    linker_graph,
                    import_prefix,
                    chunk,
                    chunks,
                    display_size,
                    force_absolute_path,
                    source_map_shifts,
                ),
            };
        }

        pub fn codeWithSourceMapShifts(
            this: *IntermediateOutput,
            allocator_to_use: ?std.mem.Allocator,
            graph: *const Graph,
            linker_graph: *const LinkerGraph,
            import_prefix: []const u8,
            chunk: *Chunk,
            chunks: []Chunk,
            display_size: ?*usize,
            force_absolute_path: bool,
            comptime enable_source_map_shifts: bool,
        ) bun.OOM!CodeResult {
            const additional_files = graph.input_files.items(.additional_files);
            const unique_key_for_additional_files = graph.input_files.items(.unique_key_for_additional_file);
            const relative_platform_buf = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(relative_platform_buf);
            switch (this.*) {
                .pieces => |*pieces| {
                    const entry_point_chunks_for_scb = linker_graph.files.items(.entry_point_chunk_index);

                    var shift = if (enable_source_map_shifts)
                        SourceMap.SourceMapShifts{
                            .after = .{},
                            .before = .{},
                        };
                    var shifts = if (enable_source_map_shifts)
                        try std.ArrayList(SourceMap.SourceMapShifts).initCapacity(bun.default_allocator, pieces.len + 1);

                    if (enable_source_map_shifts)
                        shifts.appendAssumeCapacity(shift);

                    var count: usize = 0;
                    var from_chunk_dir = std.fs.path.dirnamePosix(chunk.final_rel_path) orelse "";
                    if (strings.eqlComptime(from_chunk_dir, "."))
                        from_chunk_dir = "";

                    for (pieces.slice()) |piece| {
                        count += piece.data_len;

                        switch (piece.query.kind) {
                            .chunk, .asset, .scb, .html_import => {
                                const index = piece.query.index;
                                const file_path = switch (piece.query.kind) {
                                    .asset => brk: {
                                        const files = additional_files[index];
                                        if (!(files.len > 0)) {
                                            Output.panic("Internal error: missing asset file", .{});
                                        }

                                        const output_file = files.last().?.output_file;

                                        break :brk graph.additional_output_files.items[output_file].dest_path;
                                    },
                                    .chunk => chunks[index].final_rel_path,
                                    .scb => chunks[entry_point_chunks_for_scb[index]].final_rel_path,
                                    .html_import => {
                                        count += std.fmt.count("{f}", .{HTMLImportManifest.formatEscapedJSON(.{
                                            .index = index,
                                            .graph = graph,
                                            .chunks = chunks,
                                            .linker_graph = linker_graph,
                                        })});
                                        continue;
                                    },
                                    .none => unreachable,
                                };

                                const cheap_normalizer = cheapPrefixNormalizer(
                                    import_prefix,
                                    if (from_chunk_dir.len == 0 or force_absolute_path)
                                        file_path
                                    else
                                        bun.path.relativePlatformBuf(relative_platform_buf, from_chunk_dir, file_path, .posix, false),
                                );
                                count += cheap_normalizer[0].len + cheap_normalizer[1].len;
                            },
                            .none => {},
                        }
                    }

                    if (display_size) |amt| {
                        amt.* = count;
                    }

                    const debug_id_len = if (enable_source_map_shifts and FeatureFlags.source_map_debug_id)
                        std.fmt.count("\n//# debugId={f}\n", .{bun.SourceMap.DebugIDFormatter{ .id = chunk.isolated_hash }})
                    else
                        0;

                    const total_buf = try (allocator_to_use orelse allocatorForSize(count)).alloc(u8, count + debug_id_len);
                    var remain = total_buf;

                    for (pieces.slice()) |piece| {
                        const data = piece.data();

                        if (enable_source_map_shifts) {
                            var data_offset = SourceMap.LineColumnOffset{};
                            data_offset.advance(data);
                            shift.before.add(data_offset);
                            shift.after.add(data_offset);
                        }

                        if (data.len > 0)
                            @memcpy(remain[0..data.len], data);

                        remain = remain[data.len..];

                        switch (piece.query.kind) {
                            .asset, .chunk, .scb, .html_import => {
                                const index = piece.query.index;
                                const file_path = switch (piece.query.kind) {
                                    .asset => brk: {
                                        const files = additional_files[index];
                                        bun.assert(files.len > 0);

                                        const output_file = files.last().?.output_file;

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(unique_key_for_additional_files[index]);
                                        }

                                        break :brk graph.additional_output_files.items[output_file].dest_path;
                                    },
                                    .chunk => brk: {
                                        const piece_chunk = chunks[index];

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(piece_chunk.unique_key);
                                        }

                                        break :brk piece_chunk.final_rel_path;
                                    },
                                    .scb => brk: {
                                        const piece_chunk = chunks[entry_point_chunks_for_scb[index]];

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(piece_chunk.unique_key);
                                        }

                                        break :brk piece_chunk.final_rel_path;
                                    },
                                    .html_import => {
                                        var fixed_buffer_stream = std.io.fixedBufferStream(remain);
                                        const writer = fixed_buffer_stream.writer();

                                        HTMLImportManifest.writeEscapedJSON(index, graph, linker_graph, chunks, writer) catch unreachable;
                                        remain = remain[fixed_buffer_stream.pos..];

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(chunk.unique_key);
                                            shifts.appendAssumeCapacity(shift);
                                        }
                                        continue;
                                    },
                                    else => unreachable,
                                };

                                // normalize windows paths to '/'
                                bun.path.platformToPosixInPlace(u8, @constCast(file_path));
                                const cheap_normalizer = cheapPrefixNormalizer(
                                    import_prefix,
                                    if (from_chunk_dir.len == 0 or force_absolute_path)
                                        file_path
                                    else
                                        bun.path.relativePlatformBuf(relative_platform_buf, from_chunk_dir, file_path, .posix, false),
                                );

                                if (cheap_normalizer[0].len > 0) {
                                    @memcpy(remain[0..cheap_normalizer[0].len], cheap_normalizer[0]);
                                    remain = remain[cheap_normalizer[0].len..];
                                    if (enable_source_map_shifts)
                                        shift.after.advance(cheap_normalizer[0]);
                                }

                                if (cheap_normalizer[1].len > 0) {
                                    @memcpy(remain[0..cheap_normalizer[1].len], cheap_normalizer[1]);
                                    remain = remain[cheap_normalizer[1].len..];
                                    if (enable_source_map_shifts)
                                        shift.after.advance(cheap_normalizer[1]);
                                }

                                if (enable_source_map_shifts)
                                    shifts.appendAssumeCapacity(shift);
                            },
                            .none => {},
                        }
                    }

                    if (enable_source_map_shifts and FeatureFlags.source_map_debug_id) {
                        // This comment must go before the //# sourceMappingURL comment
                        remain = remain[(std.fmt.bufPrint(
                            remain,
                            "\n//# debugId={f}\n",
                            .{bun.SourceMap.DebugIDFormatter{ .id = chunk.isolated_hash }},
                        ) catch |err| switch (err) {
                            error.NoSpaceLeft => std.debug.panic(
                                "unexpected NoSpaceLeft error from bufPrint",
                                .{},
                            ),
                        }).len..];
                    }

                    bun.assert(remain.len == 0);
                    bun.assert(total_buf.len == count + debug_id_len);

                    return .{
                        .buffer = total_buf,
                        .shifts = if (enable_source_map_shifts)
                            shifts.items
                        else
                            &[_]SourceMap.SourceMapShifts{},
                    };
                },
                .joiner => |*joiner| {
                    const allocator = allocator_to_use orelse allocatorForSize(joiner.len);

                    if (display_size) |amt| {
                        amt.* = joiner.len;
                    }

                    const buffer = brk: {
                        if (enable_source_map_shifts and FeatureFlags.source_map_debug_id) {
                            // This comment must go before the //# sourceMappingURL comment
                            const debug_id_fmt = std.fmt.allocPrint(
                                graph.heap.allocator(),
                                "\n//# debugId={f}\n",
                                .{bun.SourceMap.DebugIDFormatter{ .id = chunk.isolated_hash }},
                            ) catch |err| bun.handleOom(err);

                            break :brk try joiner.doneWithEnd(allocator, debug_id_fmt);
                        }

                        break :brk try joiner.done(allocator);
                    };

                    return .{
                        .buffer = buffer,
                        .shifts = &[_]SourceMap.SourceMapShifts{},
                    };
                },
                .empty => return .{
                    .buffer = "",
                    .shifts = &[_]SourceMap.SourceMapShifts{},
                },
            }
        }
    };

    /// An issue with asset files and server component boundaries is they
    /// contain references to output paths, but those paths are not known until
    /// very late in the bundle. The solution is to have a magic word in the
    /// bundle text (BundleV2.unique_key, a random u64; impossible to guess).
    /// When a file wants a path to an emitted chunk, it emits the unique key
    /// in hex followed by the kind of path it wants:
    ///
    ///     `74f92237f4a85a6aA00000009` --> `./some-asset.png`
    ///      ^--------------^|^------- .query.index
    ///      unique_key      .query.kind
    ///
    /// An output piece is the concatenation of source code text and an output
    /// path, in that order. An array of pieces makes up an entire file.
    pub const OutputPiece = struct {
        /// Pointer and length split to reduce struct size
        data_ptr: [*]const u8,
        data_len: u32,
        query: Query,

        pub fn data(this: OutputPiece) []const u8 {
            return this.data_ptr[0..this.data_len];
        }

        pub const Query = packed struct(u32) {
            index: u29,
            kind: Kind,

            pub const Kind = enum(u3) {
                /// The last piece in an array uses this to indicate it is just data
                none,
                /// Given a source index, print the asset's output
                asset,
                /// Given a chunk index, print the chunk's output path
                chunk,
                /// Given a server component boundary index, print the chunk's output path
                scb,
                /// Given an HTML import index, print the manifest
                html_import,
            };

            pub const none: Query = .{ .index = 0, .kind = .none };
        };

        pub fn init(data_slice: []const u8, query: Query) OutputPiece {
            return .{
                .data_ptr = data_slice.ptr,
                .data_len = @intCast(data_slice.len),
                .query = query,
            };
        }
    };

    pub const OutputPieceIndex = OutputPiece.Query;

    pub const EntryPoint = packed struct(u64) {
        /// Index into `Graph.input_files`
        source_index: u32 = 0,
        entry_point_id: ID = 0,
        is_entry_point: bool = false,
        is_html: bool = false,

        /// so `EntryPoint` can be a u64
        pub const ID = u30;
    };

    pub const JavaScriptChunk = struct {
        files_in_chunk_order: []const Index.Int = &.{},
        parts_in_chunk_in_order: []const PartRange = &.{},

        // for code splitting
        exports_to_other_chunks: std.ArrayHashMapUnmanaged(Ref, string, Ref.ArrayHashCtx, false) = .{},
        imports_from_other_chunks: ImportsFromOtherChunks = .{},
        cross_chunk_prefix_stmts: BabyList(Stmt) = .{},
        cross_chunk_suffix_stmts: BabyList(Stmt) = .{},

        /// Indexes to CSS chunks. Currently this will only ever be zero or one
        /// items long, but smarter css chunking will allow multiple js entry points
        /// share a css file, or have an entry point contain multiple css files.
        ///
        /// Mutated while sorting chunks in `computeChunks`
        css_chunks: []u32 = &.{},
    };

    pub const CssChunk = struct {
        imports_in_chunk_in_order: BabyList(CssImportOrder),
        /// When creating a chunk, this is to be an uninitialized slice with
        /// length of `imports_in_chunk_in_order`
        ///
        /// Multiple imports may refer to the same file/stylesheet, but may need to
        /// wrap them in conditions (e.g. a layer).
        ///
        /// When we go through the `prepareCssAstsForChunk()` step, each import will
        /// create a shallow copy of the file's AST (just dereferencing the pointer).
        asts: []bun.css.BundlerStyleSheet,
    };

    const CssImportKind = enum {
        source_index,
        external_path,
        import_layers,
    };

    pub const CssImportOrder = struct {
        conditions: BabyList(bun.css.ImportConditions) = .{},
        condition_import_records: BabyList(ImportRecord) = .{},

        kind: union(enum) {
            /// Represents earlier imports that have been made redundant by later ones (see `isConditionalImportRedundant`)
            /// We don't want to redundantly print the rules of these redundant imports
            /// BUT, the imports may include layers.
            /// We'll just print layer name declarations so that the original ordering is preserved.
            layers: Layers,
            external_path: bun.fs.Path,
            source_index: Index,
        },

        pub const Layers = bun.ptr.Cow(bun.BabyList(bun.css.LayerName), struct {
            const Self = bun.BabyList(bun.css.LayerName);
            pub fn copy(self: *const Self, allocator: std.mem.Allocator) Self {
                return self.deepCloneInfallible(allocator);
            }

            pub fn deinit(self: *Self, a: std.mem.Allocator) void {
                // do shallow deinit since `LayerName` has
                // allocations in arena
                self.clearAndFree(a);
            }
        });

        pub fn hash(this: *const CssImportOrder, hasher: anytype) void {
            // TODO: conditions, condition_import_records

            bun.writeAnyToHasher(hasher, std.meta.activeTag(this.kind));
            switch (this.kind) {
                .layers => |layers| {
                    for (layers.inner().sliceConst()) |layer| {
                        for (layer.v.slice(), 0..) |layer_name, i| {
                            const is_last = i == layers.inner().len - 1;
                            if (is_last) {
                                hasher.update(layer_name);
                            } else {
                                hasher.update(layer_name);
                                hasher.update(".");
                            }
                        }
                    }
                    hasher.update("\x00");
                },
                .external_path => |path| hasher.update(path.text),
                .source_index => |idx| bun.writeAnyToHasher(hasher, idx),
            }
        }

        pub fn fmt(this: *const CssImportOrder, ctx: *LinkerContext) CssImportOrderDebug {
            return .{
                .inner = this,
                .ctx = ctx,
            };
        }

        pub const CssImportOrderDebug = struct {
            inner: *const CssImportOrder,
            ctx: *LinkerContext,

            pub fn format(this: *const CssImportOrderDebug, writer: *std.Io.Writer) !void {
                try writer.print("{s} = ", .{@tagName(this.inner.kind)});
                switch (this.inner.kind) {
                    .layers => |layers| {
                        try writer.print("[", .{});
                        const l = layers.inner();
                        for (l.sliceConst(), 0..) |*layer, i| {
                            if (i > 0) try writer.print(", ", .{});
                            try writer.print("\"{f}\"", .{layer});
                        }

                        try writer.print("]", .{});
                    },
                    .external_path => |path| {
                        try writer.print("\"{s}\"", .{path.pretty});
                    },
                    .source_index => |source_index| {
                        const source = this.ctx.parse_graph.input_files.items(.source)[source_index.get()];
                        try writer.print("{d} ({s})", .{ source_index.get(), source.path.text });
                    },
                }
            }
        };
    };

    pub const ImportsFromOtherChunks = std.AutoArrayHashMapUnmanaged(Index.Int, CrossChunkImport.Item.List);

    pub const Content = union(enum) {
        javascript: JavaScriptChunk,
        css: CssChunk,
        html,

        pub fn sourcemap(this: *const Content, default: options.SourceMapOption) options.SourceMapOption {
            return switch (this.*) {
                .javascript => default,
                .css => .none, // TODO: css source maps
                .html => .none,
            };
        }

        pub fn loader(this: *const Content) Loader {
            return switch (this.*) {
                .javascript => .js,
                .css => .css,
                .html => .html,
            };
        }

        pub fn ext(this: *const Content) string {
            return switch (this.*) {
                .javascript => "js",
                .css => "css",
                .html => "html",
            };
        }
    };
};

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const string = []const u8;

const HTMLImportManifest = @import("./HTMLImportManifest.zig");
const std = @import("std");

const options = @import("../options.zig");
const Loader = options.Loader;

const bun = @import("bun");
const FeatureFlags = bun.FeatureFlags;
const ImportKind = bun.ImportKind;
const ImportRecord = bun.ImportRecord;
const Output = bun.Output;
const SourceMap = bun.SourceMap;
const StringJoiner = bun.StringJoiner;
const default_allocator = bun.default_allocator;
const renamer = bun.renamer;
const strings = bun.strings;
const AutoBitSet = bun.bit_set.AutoBitSet;
const BabyList = bun.collections.BabyList;

const js_ast = bun.ast;
const Stmt = js_ast.Stmt;

const bundler = bun.bundle_v2;
const BundleV2 = bundler.BundleV2;
const CompileResult = bundler.CompileResult;
const CrossChunkImport = bundler.CrossChunkImport;
const EntryPoint = bundler.EntryPoint;
const Graph = bundler.Graph;
const LinkerContext = bundler.LinkerContext;
const LinkerGraph = bundler.LinkerGraph;
const PartRange = bundler.PartRange;
const PathTemplate = bundler.PathTemplate;
const cheapPrefixNormalizer = bundler.cheapPrefixNormalizer;
