pub const SourceMap = @This();
const debug = bun.Output.scoped(.SourceMap, .visible);

/// Coordinates in source maps are stored using relative offsets for size
/// reasons. When joining together chunks of a source map that were emitted
/// in parallel for different parts of a file, we need to fix up the first
/// segment of each chunk to be relative to the end of the previous chunk.
pub const SourceMapState = struct {
    /// This isn't stored in the source map. It's only used by the bundler to join
    /// source map chunks together correctly.
    generated_line: i32 = 0,

    /// These are stored in the source map in VLQ format.
    generated_column: i32 = 0,
    source_index: i32 = 0,
    original_line: i32 = 0,
    original_column: i32 = 0,
};

sources: [][]const u8 = &[_][]u8{},
sources_content: []string,
mapping: Mapping.List = .{},
allocator: std.mem.Allocator,

/// Dictates what parseUrl/parseJSON return.
pub const ParseUrlResultHint = union(enum) {
    mappings_only,
    /// Source Index to fetch
    source_only: u32,
    /// In order to fetch source contents, you need to know the
    /// index, but you cant know the index until the mappings
    /// are loaded. So pass in line+col.
    all: struct {
        line: i32,
        column: i32,
        include_names: bool = false,
    },
};

pub const ParseUrl = struct {
    /// Populated when `mappings_only` or `all`.
    map: ?*ParsedSourceMap = null,
    /// Populated when `all`
    /// May be `null` even when requested.
    mapping: ?Mapping = null,
    /// Populated when `source_only` or `all`
    /// May be `null` even when requested, if did not exist in map.
    source_contents: ?[]const u8 = null,
};

/// Parses an inline source map url like `data:application/json,....`
/// Currently does not handle non-inline source maps.
///
/// `source` must be in UTF-8 and can be freed after this call.
/// The mappings are owned by the `alloc` allocator.
/// Temporary allocations are made to the `arena` allocator, which
/// should be an arena allocator (caller is assumed to call `deinit`).
pub fn parseUrl(
    alloc: std.mem.Allocator,
    arena: std.mem.Allocator,
    source: []const u8,
    hint: ParseUrlResultHint,
) !ParseUrl {
    const json_bytes = json_bytes: {
        const data_prefix = "data:application/json";

        if (bun.strings.hasPrefixComptime(source, data_prefix) and source.len > (data_prefix.len + 1)) try_data_url: {
            debug("parse (data url, {d} bytes)", .{source.len});
            switch (source[data_prefix.len]) {
                ';' => {
                    const encoding = bun.sliceTo(source[data_prefix.len + 1 ..], ',');
                    if (!bun.strings.eqlComptime(encoding, "base64")) break :try_data_url;
                    const base64_data = source[data_prefix.len + ";base64,".len ..];

                    const len = bun.base64.decodeLen(base64_data);
                    const bytes = bun.handleOom(arena.alloc(u8, len));
                    const decoded = bun.base64.decode(bytes, base64_data);
                    if (!decoded.isSuccessful()) {
                        return error.InvalidBase64;
                    }
                    break :json_bytes bytes[0..decoded.count];
                },
                ',' => break :json_bytes source[data_prefix.len + 1 ..],
                else => break :try_data_url,
            }
        }

        return error.UnsupportedFormat;
    };

    return parseJSON(alloc, arena, json_bytes, hint);
}

/// Parses a JSON source-map
///
/// `source` must be in UTF-8 and can be freed after this call.
/// The mappings are owned by the `alloc` allocator.
/// Temporary allocations are made to the `arena` allocator, which
/// should be an arena allocator (caller is assumed to call `deinit`).
pub fn parseJSON(
    alloc: std.mem.Allocator,
    arena: std.mem.Allocator,
    source: []const u8,
    hint: ParseUrlResultHint,
) !ParseUrl {
    const json_src = bun.logger.Source.initPathString("sourcemap.json", source);
    var log = bun.logger.Log.init(arena);
    defer log.deinit();

    // the allocator given to the JS parser is not respected for all parts
    // of the parse, so we need to remember to reset the ast store
    bun.ast.Expr.Data.Store.reset();
    bun.ast.Stmt.Data.Store.reset();
    defer {
        // the allocator given to the JS parser is not respected for all parts
        // of the parse, so we need to remember to reset the ast store
        bun.ast.Expr.Data.Store.reset();
        bun.ast.Stmt.Data.Store.reset();
    }
    debug("parse (JSON, {d} bytes)", .{source.len});
    var json = bun.json.parse(&json_src, &log, arena, false) catch {
        return error.InvalidJSON;
    };

    if (json.get("version")) |version| {
        if (version.data != .e_number or version.data.e_number.value != 3.0) {
            return error.UnsupportedVersion;
        }
    }

    const mappings_str = json.get("mappings") orelse {
        return error.UnsupportedVersion;
    };

    if (mappings_str.data != .e_string) {
        return error.InvalidSourceMap;
    }

    const sources_content = switch ((json.get("sourcesContent") orelse return error.InvalidSourceMap).data) {
        .e_array => |arr| arr,
        else => return error.InvalidSourceMap,
    };

    const sources_paths = switch ((json.get("sources") orelse return error.InvalidSourceMap).data) {
        .e_array => |arr| arr,
        else => return error.InvalidSourceMap,
    };

    if (sources_content.items.len != sources_paths.items.len) {
        return error.InvalidSourceMap;
    }

    var i: usize = 0;

    const source_paths_slice = if (hint != .source_only)
        bun.handleOom(alloc.alloc([]const u8, sources_content.items.len))
    else
        null;
    errdefer if (hint != .source_only) {
        for (source_paths_slice.?[0..i]) |item| alloc.free(item);
        alloc.free(source_paths_slice.?);
    };

    if (hint != .source_only) for (sources_paths.items.slice()) |item| {
        if (item.data != .e_string)
            return error.InvalidSourceMap;

        source_paths_slice.?[i] = try alloc.dupe(u8, try item.data.e_string.string(alloc));

        i += 1;
    };

    const map = if (hint != .source_only) map: {
        var map_data = switch (Mapping.parse(
            alloc,
            mappings_str.data.e_string.slice(arena),
            null,
            std.math.maxInt(i32),
            std.math.maxInt(i32),
            .{ .allow_names = hint == .all and hint.all.include_names, .sort = true },
        )) {
            .success => |x| x,
            .fail => |fail| return fail.err,
        };

        if (hint == .all and hint.all.include_names and map_data.mappings.impl == .with_names) {
            if (json.get("names")) |names| {
                if (names.data == .e_array) {
                    var names_list = try std.ArrayListUnmanaged(bun.Semver.String).initCapacity(alloc, names.data.e_array.items.len);
                    errdefer names_list.deinit(alloc);

                    var names_buffer = std.ArrayListUnmanaged(u8){};
                    errdefer names_buffer.deinit(alloc);

                    for (names.data.e_array.items.slice()) |*item| {
                        if (item.data != .e_string) {
                            return error.InvalidSourceMap;
                        }

                        const str = try item.data.e_string.string(arena);

                        names_list.appendAssumeCapacity(try bun.Semver.String.initAppendIfNeeded(alloc, &names_buffer, str));
                    }

                    map_data.mappings.names = names_list.items;
                    map_data.mappings.names_buffer = .moveFromList(&names_buffer);
                }
            }
        }

        const ptr = bun.new(ParsedSourceMap, map_data);
        ptr.external_source_names = source_paths_slice.?;

        break :map ptr;
    } else null;
    errdefer if (map) |m| m.deref();

    const mapping, const source_index = switch (hint) {
        .source_only => |index| .{ null, index },
        .all => |loc| brk: {
            const mapping = map.?.mappings.find(loc.line, loc.column) orelse
                break :brk .{ null, null };
            break :brk .{ mapping, std.math.cast(u32, mapping.source_index) };
        },
        .mappings_only => .{ null, null },
    };

    const content_slice: ?[]const u8 = if (hint != .mappings_only and
        source_index != null and
        source_index.? < sources_content.items.len)
    content: {
        const item = sources_content.items.slice()[source_index.?];
        if (item.data != .e_string) {
            break :content null;
        }

        const str = bun.handleOom(item.data.e_string.string(arena));
        if (str.len == 0) {
            break :content null;
        }

        break :content try alloc.dupe(u8, str);
    } else null;

    return .{
        .map = map,
        .mapping = mapping,
        .source_contents = content_slice,
    };
}

/// Corresponds to a segment in the "mappings" field of a sourcemap
pub const Mapping = struct {
    generated: LineColumnOffset,
    original: LineColumnOffset,
    source_index: i32,
    name_index: i32 = -1,

    /// Optimization: if we don't care about the "names" column, then don't store the names.
    pub const MappingWithoutName = struct {
        generated: LineColumnOffset,
        original: LineColumnOffset,
        source_index: i32,

        pub fn toNamed(this: *const MappingWithoutName) Mapping {
            return .{
                .generated = this.generated,
                .original = this.original,
                .source_index = this.source_index,
                .name_index = -1,
            };
        }
    };

    pub const List = struct {
        impl: Value = .{ .without_names = .{} },
        names: []const bun.Semver.String = &[_]bun.Semver.String{},
        names_buffer: bun.ByteList = .{},

        pub const Value = union(enum) {
            without_names: bun.MultiArrayList(MappingWithoutName),
            with_names: bun.MultiArrayList(Mapping),

            pub fn memoryCost(this: *const Value) usize {
                return switch (this.*) {
                    .without_names => |*list| list.memoryCost(),
                    .with_names => |*list| list.memoryCost(),
                };
            }

            pub fn ensureTotalCapacity(this: *Value, allocator: std.mem.Allocator, count: usize) !void {
                switch (this.*) {
                    inline else => |*list| try list.ensureTotalCapacity(allocator, count),
                }
            }
        };

        fn ensureWithNames(this: *List, allocator: std.mem.Allocator) !void {
            if (this.impl == .with_names) return;

            var without_names = this.impl.without_names;
            var with_names = bun.MultiArrayList(Mapping){};
            try with_names.ensureTotalCapacity(allocator, without_names.len);
            defer without_names.deinit(allocator);

            with_names.len = without_names.len;
            var old_slices = without_names.slice();
            var new_slices = with_names.slice();

            @memcpy(new_slices.items(.generated), old_slices.items(.generated));
            @memcpy(new_slices.items(.original), old_slices.items(.original));
            @memcpy(new_slices.items(.source_index), old_slices.items(.source_index));
            @memset(new_slices.items(.name_index), -1);

            this.impl = .{ .with_names = with_names };
        }

        fn findIndexFromGenerated(line_column_offsets: []const LineColumnOffset, line: i32, column: i32) ?usize {
            var count = line_column_offsets.len;
            var index: usize = 0;
            while (count > 0) {
                const step = count / 2;
                const i: usize = index + step;
                const mapping = line_column_offsets[i];
                if (mapping.lines.zeroBased() < line or (mapping.lines.zeroBased() == line and mapping.columns.zeroBased() <= column)) {
                    index = i + 1;
                    count -|= step + 1;
                } else {
                    count = step;
                }
            }

            if (index > 0) {
                if (line_column_offsets[index - 1].lines.zeroBased() == line) {
                    return index - 1;
                }
            }

            return null;
        }

        pub fn findIndex(this: *const List, line: i32, column: i32) ?usize {
            switch (this.impl) {
                inline else => |*list| {
                    if (findIndexFromGenerated(list.items(.generated), line, column)) |i| {
                        return i;
                    }
                },
            }

            return null;
        }

        const SortContext = struct {
            generated: []const LineColumnOffset,
            pub fn lessThan(ctx: SortContext, a_index: usize, b_index: usize) bool {
                const a = ctx.generated[a_index];
                const b = ctx.generated[b_index];

                return a.lines.zeroBased() < b.lines.zeroBased() or (a.lines.zeroBased() == b.lines.zeroBased() and a.columns.zeroBased() <= b.columns.zeroBased());
            }
        };

        pub fn sort(this: *List) void {
            switch (this.impl) {
                .without_names => |*list| list.sort(SortContext{ .generated = list.items(.generated) }),
                .with_names => |*list| list.sort(SortContext{ .generated = list.items(.generated) }),
            }
        }

        pub fn append(this: *List, allocator: std.mem.Allocator, mapping: *const Mapping) !void {
            switch (this.impl) {
                .without_names => |*list| {
                    try list.append(allocator, .{
                        .generated = mapping.generated,
                        .original = mapping.original,
                        .source_index = mapping.source_index,
                    });
                },
                .with_names => |*list| {
                    try list.append(allocator, mapping.*);
                },
            }
        }

        pub fn find(this: *const List, line: i32, column: i32) ?Mapping {
            switch (this.impl) {
                inline else => |*list, tag| {
                    if (findIndexFromGenerated(list.items(.generated), line, column)) |i| {
                        if (tag == .without_names) {
                            return list.get(i).toNamed();
                        } else {
                            return list.get(i);
                        }
                    }
                },
            }

            return null;
        }
        pub fn generated(self: *const List) []const LineColumnOffset {
            return switch (self.impl) {
                inline else => |*list| list.items(.generated),
            };
        }

        pub fn original(self: *const List) []const LineColumnOffset {
            return switch (self.impl) {
                inline else => |*list| list.items(.original),
            };
        }

        pub fn sourceIndex(self: *const List) []const i32 {
            return switch (self.impl) {
                inline else => |*list| list.items(.source_index),
            };
        }

        pub fn nameIndex(self: *const List) []const i32 {
            return switch (self.impl) {
                inline else => |*list| list.items(.name_index),
            };
        }

        pub fn deinit(self: *List, allocator: std.mem.Allocator) void {
            switch (self.impl) {
                inline else => |*list| list.deinit(allocator),
            }

            self.names_buffer.deinit(allocator);
            allocator.free(self.names);
        }

        pub fn getName(this: *List, index: i32) ?[]const u8 {
            if (index < 0) return null;
            const i: usize = @intCast(index);

            if (i >= this.names.len) return null;

            if (this.impl == .with_names) {
                const str: *const bun.Semver.String = &this.names[i];
                return str.slice(this.names_buffer.slice());
            }

            return null;
        }

        pub fn memoryCost(this: *const List) usize {
            return this.impl.memoryCost() + this.names_buffer.memoryCost() +
                (this.names.len * @sizeOf(bun.Semver.String));
        }

        pub fn ensureTotalCapacity(this: *List, allocator: std.mem.Allocator, count: usize) !void {
            try this.impl.ensureTotalCapacity(allocator, count);
        }
    };

    pub const Lookup = struct {
        mapping: Mapping,
        source_map: ?*ParsedSourceMap = null,
        /// Owned by default_allocator always
        /// use `getSourceCode` to access this as a Slice
        prefetched_source_code: ?[]const u8,

        name: ?[]const u8 = null,

        /// This creates a bun.String if the source remap *changes* the source url,
        /// which is only possible if the executed file differs from the source file:
        ///
        /// - `bun build --sourcemap`, it is another file on disk
        /// - `bun build --compile --sourcemap`, it is an embedded file.
        pub fn displaySourceURLIfNeeded(lookup: Lookup, base_filename: []const u8) ?bun.String {
            const source_map = lookup.source_map orelse return null;
            // See doc comment on `external_source_names`
            if (source_map.external_source_names.len == 0)
                return null;
            if (lookup.mapping.source_index >= source_map.external_source_names.len)
                return null;

            const name = source_map.external_source_names[@intCast(lookup.mapping.source_index)];

            if (source_map.is_standalone_module_graph) {
                return bun.String.cloneUTF8(name);
            }

            if (std.fs.path.isAbsolute(base_filename)) {
                const dir = bun.path.dirname(base_filename, .auto);
                return bun.String.cloneUTF8(bun.path.joinAbs(dir, .auto, name));
            }

            return bun.String.init(name);
        }

        /// Only valid if `lookup.source_map.isExternal()`
        /// This has the possibility of invoking a call to the filesystem.
        ///
        /// This data is freed after printed on the assumption that printing
        /// errors to the console are rare (this isnt used for error.stack)
        pub fn getSourceCode(lookup: Lookup, base_filename: []const u8) ?bun.jsc.ZigString.Slice {
            const bytes = bytes: {
                if (lookup.prefetched_source_code) |code| {
                    break :bytes code;
                }

                const source_map = lookup.source_map orelse return null;
                assert(source_map.isExternal());

                const provider = source_map.underlying_provider.provider() orelse
                    return null;

                const index = lookup.mapping.source_index;

                // Standalone module graph source maps are stored (in memory) compressed.
                // They are decompressed on demand.
                if (source_map.is_standalone_module_graph) {
                    const serialized = source_map.standaloneModuleGraphData();
                    if (index >= source_map.external_source_names.len)
                        return null;

                    const code = serialized.sourceFileContents(@intCast(index));

                    return bun.jsc.ZigString.Slice.fromUTF8NeverFree(code orelse return null);
                }

                if (provider.getSourceMap(
                    base_filename,
                    source_map.underlying_provider.load_hint,
                    .{ .source_only = @intCast(index) },
                )) |parsed|
                    if (parsed.source_contents) |contents|
                        break :bytes contents;

                if (index >= source_map.external_source_names.len)
                    return null;

                const name = source_map.external_source_names[@intCast(index)];

                var buf: bun.PathBuffer = undefined;
                const normalized = bun.path.joinAbsStringBufZ(
                    bun.path.dirname(base_filename, .auto),
                    &buf,
                    &.{name},
                    .loose,
                );
                switch (bun.sys.File.readFrom(
                    std.fs.cwd(),
                    normalized,
                    bun.default_allocator,
                )) {
                    .result => |r| break :bytes r,
                    .err => return null,
                }
            };

            return bun.jsc.ZigString.Slice.init(bun.default_allocator, bytes);
        }
    };

    pub inline fn generatedLine(mapping: *const Mapping) i32 {
        return mapping.generated.lines.zeroBased();
    }

    pub inline fn generatedColumn(mapping: *const Mapping) i32 {
        return mapping.generated.columns.zeroBased();
    }

    pub inline fn sourceIndex(mapping: *const Mapping) i32 {
        return mapping.source_index;
    }

    pub inline fn originalLine(mapping: *const Mapping) i32 {
        return mapping.original.lines.zeroBased();
    }

    pub inline fn originalColumn(mapping: *const Mapping) i32 {
        return mapping.original.columns.zeroBased();
    }

    pub inline fn nameIndex(mapping: *const Mapping) i32 {
        return mapping.name_index;
    }

    pub fn parse(
        allocator: std.mem.Allocator,
        bytes: []const u8,
        estimated_mapping_count: ?usize,
        sources_count: i32,
        input_line_count: usize,
        options: struct {
            allow_names: bool = false,
            sort: bool = false,
        },
    ) ParseResult {
        debug("parse mappings ({d} bytes)", .{bytes.len});

        var mapping = Mapping.List{};
        errdefer mapping.deinit(allocator);

        if (estimated_mapping_count) |count| {
            mapping.ensureTotalCapacity(allocator, count) catch {
                return .{
                    .fail = .{
                        .msg = "Out of memory",
                        .err = error.OutOfMemory,
                        .loc = .{},
                    },
                };
            };
        }

        var generated = LineColumnOffset{ .lines = bun.Ordinal.start, .columns = bun.Ordinal.start };
        var original = LineColumnOffset{ .lines = bun.Ordinal.start, .columns = bun.Ordinal.start };
        var name_index: i32 = 0;
        var source_index: i32 = 0;
        var needs_sort = false;
        var remain = bytes;
        var has_names = false;
        while (remain.len > 0) {
            if (remain[0] == ';') {
                generated.columns = bun.Ordinal.start;

                while (strings.hasPrefixComptime(
                    remain,
                    comptime [_]u8{';'} ** (@sizeOf(usize) / 2),
                )) {
                    generated.lines = generated.lines.addScalar(@sizeOf(usize) / 2);
                    remain = remain[@sizeOf(usize) / 2 ..];
                }

                while (remain.len > 0 and remain[0] == ';') {
                    generated.lines = generated.lines.addScalar(1);
                    remain = remain[1..];
                }

                if (remain.len == 0) {
                    break;
                }
            }

            // Read the generated column
            const generated_column_delta = decodeVLQ(remain, 0);

            if (generated_column_delta.start == 0) {
                return .{
                    .fail = .{
                        .msg = "Missing generated column value",
                        .err = error.MissingGeneratedColumnValue,
                        .value = generated.columns.zeroBased(),
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }

            needs_sort = needs_sort or generated_column_delta.value < 0;

            generated.columns = generated.columns.addScalar(generated_column_delta.value);
            if (generated.columns.zeroBased() < 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid generated column value",
                        .err = error.InvalidGeneratedColumnValue,
                        .value = generated.columns.zeroBased(),
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }

            remain = remain[generated_column_delta.start..];

            // According to the specification, it's valid for a mapping to have 1,
            // 4, or 5 variable-length fields. Having one field means there's no
            // original location information, which is pretty useless. Just ignore
            // those entries.
            if (remain.len == 0)
                break;

            switch (remain[0]) {
                ',' => {
                    remain = remain[1..];
                    continue;
                },
                ';' => {
                    continue;
                },
                else => {},
            }

            // Read the original source
            const source_index_delta = decodeVLQ(remain, 0);
            if (source_index_delta.start == 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid source index delta",
                        .err = error.InvalidSourceIndexDelta,
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }
            source_index += source_index_delta.value;

            if (source_index < 0 or source_index > sources_count) {
                return .{
                    .fail = .{
                        .msg = "Invalid source index value",
                        .err = error.InvalidSourceIndexValue,
                        .value = source_index,
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }
            remain = remain[source_index_delta.start..];

            // Read the original line
            const original_line_delta = decodeVLQ(remain, 0);
            if (original_line_delta.start == 0) {
                return .{
                    .fail = .{
                        .msg = "Missing original line",
                        .err = error.MissingOriginalLine,
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }

            original.lines = original.lines.addScalar(original_line_delta.value);
            if (original.lines.zeroBased() < 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid original line value",
                        .err = error.InvalidOriginalLineValue,
                        .value = original.lines.zeroBased(),
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }
            remain = remain[original_line_delta.start..];

            // Read the original column
            const original_column_delta = decodeVLQ(remain, 0);
            if (original_column_delta.start == 0) {
                return .{
                    .fail = .{
                        .msg = "Missing original column value",
                        .err = error.MissingOriginalColumnValue,
                        .value = original.columns.zeroBased(),
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }

            original.columns = original.columns.addScalar(original_column_delta.value);
            if (original.columns.zeroBased() < 0) {
                return .{
                    .fail = .{
                        .msg = "Invalid original column value",
                        .err = error.InvalidOriginalColumnValue,
                        .value = original.columns.zeroBased(),
                        .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                    },
                };
            }
            remain = remain[original_column_delta.start..];

            if (remain.len > 0) {
                switch (remain[0]) {
                    ',' => {
                        // 4 column, but there's more on this line.
                        remain = remain[1..];
                    },
                    // 4 column, and there's no more on this line.
                    ';' => {},

                    // 5th column: the name
                    else => |c| {
                        // Read the name index
                        const name_index_delta = decodeVLQ(remain, 0);
                        if (name_index_delta.start == 0) {
                            return .{
                                .fail = .{
                                    .msg = "Invalid name index delta",
                                    .err = error.InvalidNameIndexDelta,
                                    .value = @intCast(c),
                                    .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                                },
                            };
                        }
                        remain = remain[name_index_delta.start..];

                        if (options.allow_names) {
                            name_index += name_index_delta.value;
                            if (!has_names) {
                                mapping.ensureWithNames(allocator) catch {
                                    return .{
                                        .fail = .{
                                            .msg = "Out of memory",
                                            .err = error.OutOfMemory,
                                            .loc = .{ .start = @as(i32, @intCast(bytes.len - remain.len)) },
                                        },
                                    };
                                };
                            }
                            has_names = true;
                        }

                        if (remain.len > 0) {
                            switch (remain[0]) {
                                // There's more on this line.
                                ',' => {
                                    remain = remain[1..];
                                },
                                // That's the end of the line.
                                ';' => {},
                                else => {},
                            }
                        }
                    },
                }
            }
            mapping.append(allocator, &.{
                .generated = generated,
                .original = original,
                .source_index = source_index,
                .name_index = name_index,
            }) catch |err| bun.handleOom(err);
        }

        if (needs_sort and options.sort) {
            mapping.sort();
        }

        return .{ .success = .{
            .ref_count = .init(),
            .mappings = mapping,
            .input_line_count = input_line_count,
        } };
    }
};

pub const ParseResult = union(enum) {
    fail: struct {
        loc: Logger.Loc,
        err: anyerror,
        value: i32 = 0,
        msg: []const u8 = "",

        pub fn toData(this: @This(), path: []const u8) Logger.Data {
            return Logger.Data{
                .location = Logger.Location{
                    .file = path,
                    .offset = this.loc.toUsize(),
                    // TODO: populate correct line and column information
                    .line = -1,
                    .column = -1,
                },
                .text = this.msg,
            };
        }
    },
    success: ParsedSourceMap,
};

pub const ParsedSourceMap = struct {
    const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    /// ParsedSourceMap can be acquired by different threads via the thread-safe
    /// source map store (SavedSourceMap), so the reference count must be thread-safe.
    ref_count: RefCount,

    input_line_count: usize = 0,
    mappings: Mapping.List = .{},

    /// If this is empty, this implies that the source code is a single file
    /// transpiled on-demand. If there are items, then it means this is a file
    /// loaded without transpilation but with external sources. This array
    /// maps `source_index` to the correct filename.
    external_source_names: []const []const u8 = &.{},
    /// In order to load source contents from a source-map after the fact,
    /// a handle to the underlying source provider is stored. Within this pointer,
    /// a flag is stored if it is known to be an inline or external source map.
    ///
    /// Source contents are large, we don't preserve them in memory. This has
    /// the downside of repeatedly re-decoding sourcemaps if multiple errors
    /// are emitted (specifically with Bun.inspect / unhandled; the ones that
    /// rely on source contents)
    underlying_provider: SourceContentPtr = .none,

    is_standalone_module_graph: bool = false,

    const SourceProviderKind = enum(u1) { zig, bake };
    const AnySourceProvider = union(enum) {
        zig: *SourceProviderMap,
        bake: *BakeSourceProvider,

        pub fn ptr(this: AnySourceProvider) *anyopaque {
            return switch (this) {
                .zig => @ptrCast(this.zig),
                .bake => @ptrCast(this.bake),
            };
        }

        pub fn getSourceMap(
            this: AnySourceProvider,
            source_filename: []const u8,
            load_hint: SourceMapLoadHint,
            result: ParseUrlResultHint,
        ) ?SourceMap.ParseUrl {
            return switch (this) {
                .zig => this.zig.getSourceMap(source_filename, load_hint, result),
                .bake => this.bake.getSourceMap(source_filename, load_hint, result),
            };
        }
    };

    const SourceContentPtr = packed struct(u64) {
        load_hint: SourceMapLoadHint,
        kind: SourceProviderKind,
        data: u61,

        pub const none: SourceContentPtr = .{ .load_hint = .none, .kind = .zig, .data = 0 };

        fn fromProvider(p: *SourceProviderMap) SourceContentPtr {
            return .{ .load_hint = .none, .data = @intCast(@intFromPtr(p)), .kind = .zig };
        }

        fn fromBakeProvider(p: *BakeSourceProvider) SourceContentPtr {
            return .{ .load_hint = .none, .data = @intCast(@intFromPtr(p)), .kind = .bake };
        }

        pub fn provider(sc: SourceContentPtr) ?AnySourceProvider {
            switch (sc.kind) {
                .zig => return .{ .zig = @ptrFromInt(sc.data) },
                .bake => return .{ .bake = @ptrFromInt(sc.data) },
            }
        }
    };

    pub fn isExternal(psm: *ParsedSourceMap) bool {
        return psm.external_source_names.len != 0;
    }

    fn deinit(this: *ParsedSourceMap) void {
        const allocator = bun.default_allocator;

        this.mappings.deinit(allocator);

        if (this.external_source_names.len > 0) {
            for (this.external_source_names) |name|
                allocator.free(name);
            allocator.free(this.external_source_names);
        }

        bun.destroy(this);
    }

    fn standaloneModuleGraphData(this: *ParsedSourceMap) *bun.StandaloneModuleGraph.SerializedSourceMap.Loaded {
        bun.assert(this.is_standalone_module_graph);
        return @ptrFromInt(this.underlying_provider.data);
    }

    pub fn memoryCost(this: *const ParsedSourceMap) usize {
        return @sizeOf(ParsedSourceMap) + this.mappings.memoryCost() + this.external_source_names.len * @sizeOf([]const u8);
    }

    pub fn writeVLQs(map: *const ParsedSourceMap, writer: anytype) !void {
        var last_col: i32 = 0;
        var last_src: i32 = 0;
        var last_ol: i32 = 0;
        var last_oc: i32 = 0;
        var current_line: i32 = 0;
        for (
            map.mappings.generated(),
            map.mappings.original(),
            map.mappings.sourceIndex(),
            0..,
        ) |gen, orig, source_index, i| {
            if (current_line != gen.lines.zeroBased()) {
                assert(gen.lines.zeroBased() > current_line);
                const inc = gen.lines.zeroBased() - current_line;
                try writer.writeByteNTimes(';', @intCast(inc));
                current_line = gen.lines.zeroBased();
                last_col = 0;
            } else if (i != 0) {
                try writer.writeByte(',');
            }
            try VLQ.encode(gen.columns.zeroBased() - last_col).writeTo(writer);
            last_col = gen.columns.zeroBased();
            try VLQ.encode(source_index - last_src).writeTo(writer);
            last_src = source_index;
            try VLQ.encode(orig.lines.zeroBased() - last_ol).writeTo(writer);
            last_ol = orig.lines.zeroBased();
            try VLQ.encode(orig.columns.zeroBased() - last_oc).writeTo(writer);
            last_oc = orig.columns.zeroBased();
        }
    }

    pub fn formatVLQs(map: *const ParsedSourceMap) std.fmt.Formatter(formatVLQsImpl) {
        return .{ .data = map };
    }

    fn formatVLQsImpl(map: *const ParsedSourceMap, comptime _: []const u8, _: std.fmt.FormatOptions, w: anytype) !void {
        try map.writeVLQs(w);
    }
};

/// For some sourcemap loading code, this enum is used as a hint if it should
/// bother loading source code into memory. Most uses of source maps only care
/// about filenames and source mappings, and we should avoid loading contents
/// whenever possible.
pub const SourceContentHandling = enum(u1) {
    no_source_contents,
    source_contents,
};

/// For some sourcemap loading code, this enum is used as a hint if we already
/// know if the sourcemap is located on disk or inline in the source code.
pub const SourceMapLoadHint = enum(u2) {
    none,
    is_inline_map,
    is_external_map,
};

fn findSourceMappingURL(comptime T: type, source: []const T, alloc: std.mem.Allocator) ?bun.jsc.ZigString.Slice {
    const needle = comptime bun.strings.literal(T, "\n//# sourceMappingURL=");
    const found = bun.strings.indexOfT(T, source, needle) orelse return null;
    const end = std.mem.indexOfScalarPos(T, source, found + needle.len, '\n') orelse source.len;
    const url = std.mem.trimRight(T, source[found + needle.len .. end], &.{ ' ', '\r' });
    return switch (T) {
        u8 => bun.jsc.ZigString.Slice.fromUTF8NeverFree(url),
        u16 => bun.jsc.ZigString.Slice.init(
            alloc,
            bun.handleOom(bun.strings.toUTF8Alloc(alloc, url)),
        ),
        else => @compileError("Not Supported"),
    };
}

/// The last two arguments to this specify loading hints
pub fn getSourceMapImpl(
    comptime SourceProviderKind: type,
    provider: *SourceProviderKind,
    source_filename: []const u8,
    load_hint: SourceMapLoadHint,
    result: ParseUrlResultHint,
) ?SourceMap.ParseUrl {
    // This was previously 65535 but that is a size that can risk stack overflow
    // and due to the many layers of indirections and wrappers this function is called in, it
    // is difficult to reason about how deeply nested of a callstack this
    // function is called in. 1024 is a safer number.
    //
    // TODO: Experiment in debug builds calculating how much stack space we have left and using that to
    //       adjust the size
    const STACK_SPACE_TO_USE = 1024;
    var sfb = std.heap.stackFallback(STACK_SPACE_TO_USE, bun.default_allocator);
    var arena = bun.ArenaAllocator.init(sfb.get());
    defer arena.deinit();
    const allocator = arena.allocator();

    const new_load_hint: SourceMapLoadHint, const parsed = parsed: {
        var inline_err: ?anyerror = null;

        // try to get an inline source map
        if (load_hint != .is_external_map) try_inline: {
            const source = SourceProviderKind.getSourceSlice(provider);
            defer source.deref();
            bun.assert(source.tag == .ZigString);

            const found_url = (if (source.is8Bit())
                findSourceMappingURL(u8, source.latin1(), allocator)
            else
                findSourceMappingURL(u16, source.utf16(), allocator)) orelse
                break :try_inline;
            defer found_url.deinit();

            break :parsed .{
                .is_inline_map,
                parseUrl(
                    bun.default_allocator,
                    allocator,
                    found_url.slice(),
                    result,
                ) catch |err| {
                    inline_err = err;
                    break :try_inline;
                },
            };
        }

        // try to load a .map file
        if (load_hint != .is_inline_map) try_external: {
            if (comptime SourceProviderKind == BakeSourceProvider) fallback_to_normal: {
                const global = bun.jsc.VirtualMachine.get().global;
                // If we're using bake's production build the global object will
                // be Bake::GlobalObject and we can fetch the sourcemap from it,
                // if not fallback to the normal way
                if (!BakeGlobalObject__isBakeGlobalObject(global)) {
                    break :fallback_to_normal;
                }
                const data = BakeSourceProvider.getExternal(
                    provider,
                    global,
                    source_filename,
                );
                break :parsed .{
                    .is_external_map,
                    parseJSON(
                        bun.default_allocator,
                        allocator,
                        data,
                        result,
                    ) catch |err| {
                        // Print warning even if this came from non-visible code like
                        // calling `error.stack`. This message is only printed if
                        // the sourcemap has been found but is invalid, such as being
                        // invalid JSON text or corrupt mappings.
                        bun.Output.warn("Could not decode sourcemap in '{s}': {s}", .{
                            source_filename,
                            @errorName(err),
                        }); // Disable the "try using --sourcemap=external" hint
                        bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.seen_invalid = true;
                        return null;
                    },
                };
            }
            var load_path_buf: *bun.PathBuffer = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(load_path_buf);
            if (source_filename.len + 4 > load_path_buf.len)
                break :try_external;
            @memcpy(load_path_buf[0..source_filename.len], source_filename);
            @memcpy(load_path_buf[source_filename.len..][0..4], ".map");

            const load_path = load_path_buf[0 .. source_filename.len + 4];
            const data = switch (bun.sys.File.readFrom(std.fs.cwd(), load_path, allocator)) {
                .err => break :try_external,
                .result => |data| data,
            };

            break :parsed .{
                .is_external_map,
                parseJSON(
                    bun.default_allocator,
                    allocator,
                    data,
                    result,
                ) catch |err| {
                    // Print warning even if this came from non-visible code like
                    // calling `error.stack`. This message is only printed if
                    // the sourcemap has been found but is invalid, such as being
                    // invalid JSON text or corrupt mappings.
                    bun.Output.warn("Could not decode sourcemap in '{s}': {s}", .{
                        source_filename,
                        @errorName(err),
                    }); // Disable the "try using --sourcemap=external" hint
                    bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.seen_invalid = true;
                    return null;
                },
            };
        }

        if (inline_err) |err| {
            bun.Output.warn("Could not decode sourcemap in '{s}': {s}", .{
                source_filename,
                @errorName(err),
            });
            // Disable the "try using --sourcemap=external" hint
            bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.seen_invalid = true;
            return null;
        }

        return null;
    };
    if (parsed.map) |ptr| {
        ptr.underlying_provider = SourceProviderKind.toSourceContentPtr(provider);
        ptr.underlying_provider.load_hint = new_load_hint;
    }
    return parsed;
}

/// This is a pointer to a ZigSourceProvider that may or may not have a `//# sourceMappingURL` comment
/// when we want to lookup this data, we will then resolve it to a ParsedSourceMap if it does.
///
/// This is used for files that were pre-bundled with `bun build --target=bun --sourcemap`
pub const SourceProviderMap = opaque {
    extern fn ZigSourceProvider__getSourceSlice(*SourceProviderMap) bun.String;
    pub const getSourceSlice = ZigSourceProvider__getSourceSlice;
    pub fn toSourceContentPtr(this: *SourceProviderMap) ParsedSourceMap.SourceContentPtr {
        return ParsedSourceMap.SourceContentPtr.fromProvider(this);
    }

    /// The last two arguments to this specify loading hints
    pub fn getSourceMap(
        provider: *SourceProviderMap,
        source_filename: []const u8,
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) ?SourceMap.ParseUrl {
        return getSourceMapImpl(
            SourceProviderMap,
            provider,
            source_filename,
            load_hint,
            result,
        );
    }
};

extern "c" fn BakeGlobalObject__isBakeGlobalObject(global: *bun.jsc.JSGlobalObject) bool;

extern "c" fn BakeGlobalObject__getPerThreadData(global: *bun.jsc.JSGlobalObject) *bun.bake.production.PerThread;

pub const BakeSourceProvider = opaque {
    extern fn BakeSourceProvider__getSourceSlice(*BakeSourceProvider) bun.String;
    pub const getSourceSlice = BakeSourceProvider__getSourceSlice;
    pub fn toSourceContentPtr(this: *BakeSourceProvider) ParsedSourceMap.SourceContentPtr {
        return ParsedSourceMap.SourceContentPtr.fromBakeProvider(this);
    }

    pub fn getExternal(_: *BakeSourceProvider, global: *bun.jsc.JSGlobalObject, source_filename: []const u8) []const u8 {
        bun.assert(BakeGlobalObject__isBakeGlobalObject(global));
        const pt = BakeGlobalObject__getPerThreadData(global);
        if (pt.source_maps.get(source_filename)) |value| {
            return pt.bundled_outputs[value.get()].value.asSlice();
        }
        return "";
    }

    /// The last two arguments to this specify loading hints
    pub fn getSourceMap(
        provider: *BakeSourceProvider,
        source_filename: []const u8,
        load_hint: SourceMap.SourceMapLoadHint,
        result: SourceMap.ParseUrlResultHint,
    ) ?SourceMap.ParseUrl {
        return getSourceMapImpl(
            BakeSourceProvider,
            provider,
            source_filename,
            load_hint,
            result,
        );
    }
};

/// The sourcemap spec says line and column offsets are zero-based
pub const LineColumnOffset = struct {
    /// The zero-based line offset
    lines: bun.Ordinal = bun.Ordinal.start,
    /// The zero-based column offset
    columns: bun.Ordinal = bun.Ordinal.start,

    pub const Optional = union(enum) {
        null: void,
        value: LineColumnOffset,

        pub fn advance(this: *Optional, input: []const u8) void {
            switch (this.*) {
                .null => {},
                .value => |*v| v.advance(input),
            }
        }

        pub fn reset(this: *Optional) void {
            switch (this.*) {
                .null => {},
                .value => this.* = .{ .value = .{} },
            }
        }
    };

    pub fn add(this: *LineColumnOffset, b: LineColumnOffset) void {
        if (b.lines.zeroBased() == 0) {
            this.columns = this.columns.add(b.columns);
        } else {
            this.lines = this.lines.add(b.lines);
            this.columns = b.columns;
        }
    }

    pub fn advance(this_ptr: *LineColumnOffset, input: []const u8) void {
        // Instead of mutating `this_ptr` directly, copy the state to the stack and do
        // all the work here, then move it back to the input pointer. When sourcemaps
        // are enabled, this function is extremely hot.
        var this = this_ptr.*;
        defer this_ptr.* = this;

        var offset: u32 = 0;
        while (strings.indexOfNewlineOrNonASCII(input, offset)) |i| {
            assert(i >= offset);
            assert(i < input.len);

            var iter = strings.CodepointIterator.initOffset(input, i);
            var cursor = strings.CodepointIterator.Cursor{ .i = @as(u32, @truncate(iter.i)) };
            _ = iter.next(&cursor);

            // Given a null byte, cursor.width becomes 0
            // This can lead to integer overflow, crashes, or hangs.
            // https://github.com/oven-sh/bun/issues/10624
            if (cursor.width == 0) {
                this.columns = this.columns.addScalar(1);
                offset = i + 1;
                continue;
            }

            offset = i + cursor.width;

            switch (cursor.c) {
                '\r', '\n', 0x2028, 0x2029 => {
                    // Handle Windows-specific "\r\n" newlines
                    if (cursor.c == '\r' and input.len > i + 1 and input[i + 1] == '\n') {
                        this.columns = this.columns.addScalar(1);
                        continue;
                    }

                    this.lines = this.lines.addScalar(1);
                    this.columns = bun.Ordinal.start;
                },
                else => |c| {
                    // Mozilla's "source-map" library counts columns using UTF-16 code units
                    this.columns = this.columns.addScalar(switch (c) {
                        0...0xFFFF => 1,
                        else => 2,
                    });
                },
            }
        }

        const remain = input[offset..];

        if (bun.Environment.allow_assert) {
            assert(bun.strings.isAllASCII(remain));
            assert(!bun.strings.containsChar(remain, '\n'));
            assert(!bun.strings.containsChar(remain, '\r'));
        }

        this.columns = this.columns.addScalar(@intCast(remain.len));
    }

    pub fn comesBefore(a: LineColumnOffset, b: LineColumnOffset) bool {
        return a.lines.zeroBased() < b.lines.zeroBased() or (a.lines.zeroBased() == b.lines.zeroBased() and a.columns.zeroBased() < b.columns.zeroBased());
    }

    pub fn cmp(_: void, a: LineColumnOffset, b: LineColumnOffset) std.math.Order {
        if (a.lines.zeroBased() != b.lines.zeroBased()) {
            return std.math.order(a.lines.zeroBased(), b.lines.zeroBased());
        }

        return std.math.order(a.columns.zeroBased(), b.columns.zeroBased());
    }
};

pub const SourceContent = struct {
    value: []const u16 = &[_]u16{},
    quoted: []const u8 = &[_]u8{},
};

pub fn find(
    this: *const SourceMap,
    line: i32,
    column: i32,
) ?Mapping {
    return this.mapping.find(line, column);
}

pub const SourceMapShifts = struct {
    before: LineColumnOffset,
    after: LineColumnOffset,
};

pub const SourceMapPieces = struct {
    prefix: std.ArrayList(u8),
    mappings: std.ArrayList(u8),
    suffix: std.ArrayList(u8),

    pub fn init(allocator: std.mem.Allocator) SourceMapPieces {
        return .{
            .prefix = std.ArrayList(u8).init(allocator),
            .mappings = std.ArrayList(u8).init(allocator),
            .suffix = std.ArrayList(u8).init(allocator),
        };
    }

    pub fn hasContent(this: *SourceMapPieces) bool {
        return (this.prefix.items.len + this.mappings.items.len + this.suffix.items.len) > 0;
    }

    pub fn finalize(this: *SourceMapPieces, allocator: std.mem.Allocator, _shifts: []SourceMapShifts) ![]const u8 {
        var shifts = _shifts;
        var start_of_run: usize = 0;
        var current: usize = 0;
        var generated = LineColumnOffset{};
        var prev_shift_column_delta: i32 = 0;

        // the joiner's node allocator contains string join nodes as well as some vlq encodings
        // it doesnt contain json payloads or source code, so 16kb is probably going to cover
        // most applications.
        var sfb = std.heap.stackFallback(16384, bun.default_allocator);
        var j = StringJoiner{ .allocator = sfb.get() };

        j.pushStatic(this.prefix.items);
        const mappings = this.mappings.items;

        while (current < mappings.len) {
            if (mappings[current] == ';') {
                generated.lines = generated.lines.addScalar(1);
                generated.columns = bun.Ordinal.start;
                prev_shift_column_delta = 0;
                current += 1;
                continue;
            }

            const potential_end_of_run = current;

            const decode_result = decodeVLQ(mappings, current);
            generated.columns = generated.columns.addScalar(decode_result.value);
            current = decode_result.start;

            const potential_start_of_run = current;

            current = decodeVLQAssumeValid(mappings, current).start;
            current = decodeVLQAssumeValid(mappings, current).start;
            current = decodeVLQAssumeValid(mappings, current).start;

            if (current < mappings.len) {
                const c = mappings[current];
                if (c != ',' and c != ';') {
                    current = decodeVLQAssumeValid(mappings, current).start;
                }
            }

            if (current < mappings.len and mappings[current] == ',') {
                current += 1;
            }

            var did_cross_boundary = false;
            if (shifts.len > 1 and shifts[1].before.comesBefore(generated)) {
                shifts = shifts[1..];
                did_cross_boundary = true;
            }

            if (!did_cross_boundary) {
                continue;
            }

            const shift = shifts[0];
            if (shift.after.lines.zeroBased() != generated.lines.zeroBased()) {
                continue;
            }

            j.pushStatic(mappings[start_of_run..potential_end_of_run]);

            assert(shift.before.lines.zeroBased() == shift.after.lines.zeroBased());

            const shift_column_delta = shift.after.columns.zeroBased() - shift.before.columns.zeroBased();
            const vlq_value = decode_result.value + shift_column_delta - prev_shift_column_delta;
            const encode = VLQ.encode(vlq_value);
            j.pushCloned(encode.slice());
            prev_shift_column_delta = shift_column_delta;

            start_of_run = potential_start_of_run;
        }

        j.pushStatic(mappings[start_of_run..]);

        const str = try j.doneWithEnd(allocator, this.suffix.items);
        bun.assert(str[0] == '{'); // invalid json
        return str;
    }
};

// -- comment from esbuild --
// Source map chunks are computed in parallel for speed. Each chunk is relative
// to the zero state instead of being relative to the end state of the previous
// chunk, since it's impossible to know the end state of the previous chunk in
// a parallel computation.
//
// After all chunks are computed, they are joined together in a second pass.
// This rewrites the first mapping in each chunk to be relative to the end
// state of the previous chunk.
pub fn appendSourceMapChunk(
    j: *StringJoiner,
    allocator: std.mem.Allocator,
    prev_end_state_: SourceMapState,
    start_state_: SourceMapState,
    source_map_: []const u8,
) !void {
    var prev_end_state = prev_end_state_;
    var start_state = start_state_;
    // Handle line breaks in between this mapping and the previous one
    if (start_state.generated_line != 0) {
        j.push(try strings.repeatingAlloc(allocator, @intCast(start_state.generated_line), ';'), allocator);
        prev_end_state.generated_column = 0;
    }

    // Skip past any leading semicolons, which indicate line breaks
    var source_map = source_map_;
    if (strings.indexOfNotChar(source_map, ';')) |semicolons| {
        if (semicolons > 0) {
            j.pushStatic(source_map[0..semicolons]);
            source_map = source_map[semicolons..];
            prev_end_state.generated_column = 0;
            start_state.generated_column = 0;
        }
    }

    // Strip off the first mapping from the buffer. The first mapping should be
    // for the start of the original file (the printer always generates one for
    // the start of the file).
    var i: usize = 0;
    const generated_column = decodeVLQAssumeValid(source_map, i);
    i = generated_column.start;
    const source_index = decodeVLQAssumeValid(source_map, i);
    i = source_index.start;
    const original_line = decodeVLQAssumeValid(source_map, i);
    i = original_line.start;
    const original_column = decodeVLQAssumeValid(source_map, i);
    i = original_column.start;

    source_map = source_map[i..];

    // Rewrite the first mapping to be relative to the end state of the previous
    // chunk. We now know what the end state is because we're in the second pass
    // where all chunks have already been generated.
    start_state.source_index += source_index.value;
    start_state.generated_column += generated_column.value;
    start_state.original_line += original_line.value;
    start_state.original_column += original_column.value;

    var str = MutableString.initEmpty(allocator);
    appendMappingToBuffer(&str, j.lastByte(), prev_end_state, start_state);
    j.push(str.slice(), allocator);

    // Then append everything after that without modification.
    j.pushStatic(source_map);
}

pub fn appendSourceMappingURLRemote(
    origin: URL,
    source: *const Logger.Source,
    asset_prefix_path: []const u8,
    comptime Writer: type,
    writer: Writer,
) !void {
    try writer.writeAll("\n//# sourceMappingURL=");
    try writer.writeAll(strings.withoutTrailingSlash(origin.href));
    if (asset_prefix_path.len > 0)
        try writer.writeAll(asset_prefix_path);
    if (source.path.pretty.len > 0 and source.path.pretty[0] != '/') {
        try writer.writeAll("/");
    }
    try writer.writeAll(source.path.pretty);
    try writer.writeAll(".map");
}

/// This function is extremely hot.
pub fn appendMappingToBuffer(buffer: *MutableString, last_byte: u8, prev_state: SourceMapState, current_state: SourceMapState) void {
    const needs_comma = last_byte != 0 and last_byte != ';' and last_byte != '"';

    const vlqs = [_]VLQ{
        // Record the generated column (the line is recorded using ';' elsewhere)
        .encode(current_state.generated_column -| prev_state.generated_column),
        // Record the generated source
        .encode(current_state.source_index -| prev_state.source_index),
        // Record the original line
        .encode(current_state.original_line -| prev_state.original_line),
        // Record the original column
        .encode(current_state.original_column -| prev_state.original_column),
    };

    // Count exactly how many bytes we need to write
    const total_len = @as(usize, vlqs[0].len) +
        @as(usize, vlqs[1].len) +
        @as(usize, vlqs[2].len) +
        @as(usize, vlqs[3].len);

    // Instead of updating .len 5 times, we only need to update it once.
    var writable = buffer.writableNBytes(total_len + @as(usize, @intFromBool(needs_comma))) catch unreachable;

    // Put commas in between mappings
    if (needs_comma) {
        writable[0] = ',';
        writable = writable[1..];
    }

    inline for (&vlqs) |item| {
        @memcpy(writable[0..item.len], item.slice());
        writable = writable[item.len..];
    }
}

pub const Chunk = struct {
    buffer: MutableString,

    mappings_count: usize = 0,

    /// This end state will be used to rewrite the start of the following source
    /// map chunk so that the delta-encoded VLQ numbers are preserved.
    end_state: SourceMapState = .{},

    /// There probably isn't a source mapping at the end of the file (nor should
    /// there be) but if we're appending another source map chunk after this one,
    /// we'll need to know how many characters were in the last line we generated.
    final_generated_column: i32 = 0,

    /// ignore empty chunks
    should_ignore: bool = true,

    pub fn initEmpty() Chunk {
        return .{
            .buffer = MutableString.initEmpty(bun.default_allocator),
            .mappings_count = 0,
            .end_state = .{},
            .final_generated_column = 0,
            .should_ignore = true,
        };
    }

    pub fn deinit(this: *Chunk) void {
        this.buffer.deinit();
    }

    pub fn printSourceMapContents(
        chunk: Chunk,
        source: *const Logger.Source,
        mutable: *MutableString,
        include_sources_contents: bool,
        comptime ascii_only: bool,
    ) !void {
        try printSourceMapContentsAtOffset(
            chunk,
            source,
            mutable,
            include_sources_contents,
            0,
            ascii_only,
        );
    }

    pub fn printSourceMapContentsAtOffset(
        chunk: Chunk,
        source: *const Logger.Source,
        mutable: *MutableString,
        include_sources_contents: bool,
        offset: usize,
        comptime ascii_only: bool,
    ) !void {
        // attempt to pre-allocate

        var filename_buf: bun.PathBuffer = undefined;
        var filename = source.path.text;
        if (strings.hasPrefix(source.path.text, FileSystem.instance.top_level_dir)) {
            filename = filename[FileSystem.instance.top_level_dir.len - 1 ..];
        } else if (filename.len > 0 and filename[0] != '/') {
            filename_buf[0] = '/';
            @memcpy(filename_buf[1..][0..filename.len], filename);
            filename = filename_buf[0 .. filename.len + 1];
        }

        mutable.growIfNeeded(
            filename.len + 2 + (source.contents.len * @as(usize, @intFromBool(include_sources_contents))) + (chunk.buffer.list.items.len - offset) + 32 + 39 + 29 + 22 + 20,
        ) catch unreachable;
        try mutable.append("{\n  \"version\":3,\n  \"sources\": [");

        try JSPrinter.quoteForJSON(filename, mutable, ascii_only);

        if (include_sources_contents) {
            try mutable.append("],\n  \"sourcesContent\": [");
            try JSPrinter.quoteForJSON(source.contents, mutable, ascii_only);
        }

        try mutable.append("],\n  \"mappings\": ");
        try JSPrinter.quoteForJSON(chunk.buffer.list.items[offset..], mutable, ascii_only);
        try mutable.append(", \"names\": []\n}");
    }

    // TODO: remove the indirection by having generic functions for SourceMapFormat and NewBuilder. Source maps are always VLQ
    pub fn SourceMapFormat(comptime Type: type) type {
        return struct {
            ctx: Type,
            const Format = @This();

            pub fn init(allocator: std.mem.Allocator, prepend_count: bool) Format {
                return .{ .ctx = Type.init(allocator, prepend_count) };
            }

            pub inline fn appendLineSeparator(this: *Format) anyerror!void {
                try this.ctx.appendLineSeparator();
            }

            pub inline fn append(this: *Format, current_state: SourceMapState, prev_state: SourceMapState) anyerror!void {
                try this.ctx.append(current_state, prev_state);
            }

            pub inline fn shouldIgnore(this: Format) bool {
                return this.ctx.shouldIgnore();
            }

            pub inline fn getBuffer(this: Format) MutableString {
                return this.ctx.getBuffer();
            }

            pub inline fn takeBuffer(this: *Format) MutableString {
                return this.ctx.takeBuffer();
            }

            pub inline fn getCount(this: Format) usize {
                return this.ctx.getCount();
            }
        };
    }

    pub const VLQSourceMap = struct {
        data: MutableString,
        count: usize = 0,
        offset: usize = 0,
        approximate_input_line_count: usize = 0,

        pub fn init(allocator: std.mem.Allocator, prepend_count: bool) VLQSourceMap {
            var map = VLQSourceMap{
                .data = MutableString.initEmpty(allocator),
            };

            // For bun.js, we store the number of mappings and how many bytes the final list is at the beginning of the array
            if (prepend_count) {
                map.offset = 24;
                map.data.append(&([_]u8{0} ** 24)) catch unreachable;
            }

            return map;
        }

        pub fn appendLineSeparator(this: *VLQSourceMap) anyerror!void {
            try this.data.appendChar(';');
        }

        pub fn append(this: *VLQSourceMap, current_state: SourceMapState, prev_state: SourceMapState) anyerror!void {
            const last_byte: u8 = if (this.data.list.items.len > this.offset)
                this.data.list.items[this.data.list.items.len - 1]
            else
                0;

            appendMappingToBuffer(&this.data, last_byte, prev_state, current_state);
            this.count += 1;
        }

        pub fn shouldIgnore(this: VLQSourceMap) bool {
            return this.count == 0;
        }

        pub fn getBuffer(this: VLQSourceMap) MutableString {
            return this.data;
        }

        pub fn takeBuffer(this: *VLQSourceMap) MutableString {
            defer this.data = .initEmpty(this.data.allocator);
            return this.data;
        }

        pub fn getCount(this: VLQSourceMap) usize {
            return this.count;
        }
    };

    pub fn NewBuilder(comptime SourceMapFormatType: type) type {
        return struct {
            const ThisBuilder = @This();
            source_map: SourceMapper,
            line_offset_tables: LineOffsetTable.List = .{},
            prev_state: SourceMapState = SourceMapState{},
            last_generated_update: u32 = 0,
            generated_column: i32 = 0,
            prev_loc: Logger.Loc = Logger.Loc.Empty,
            has_prev_state: bool = false,

            line_offset_table_byte_offset_list: []const u32 = &.{},

            // This is a workaround for a bug in the popular "source-map" library:
            // https://github.com/mozilla/source-map/issues/261. The library will
            // sometimes return null when querying a source map unless every line
            // starts with a mapping at column zero.
            //
            // The workaround is to replicate the previous mapping if a line ends
            // up not starting with a mapping. This is done lazily because we want
            // to avoid replicating the previous mapping if we don't need to.
            line_starts_with_mapping: bool = false,
            cover_lines_without_mappings: bool = false,

            approximate_input_line_count: usize = 0,

            /// When generating sourcemappings for bun, we store a count of how many mappings there were
            prepend_count: bool = false,

            pub const SourceMapper = SourceMapFormat(SourceMapFormatType);

            pub noinline fn generateChunk(b: *ThisBuilder, output: []const u8) Chunk {
                b.updateGeneratedLineAndColumn(output);
                var buffer = b.source_map.getBuffer();
                if (b.prepend_count) {
                    buffer.list.items[0..8].* = @as([8]u8, @bitCast(buffer.list.items.len));
                    buffer.list.items[8..16].* = @as([8]u8, @bitCast(b.source_map.getCount()));
                    buffer.list.items[16..24].* = @as([8]u8, @bitCast(b.approximate_input_line_count));
                }
                return Chunk{
                    .buffer = b.source_map.takeBuffer(),
                    .mappings_count = b.source_map.getCount(),
                    .end_state = b.prev_state,
                    .final_generated_column = b.generated_column,
                    .should_ignore = b.source_map.shouldIgnore(),
                };
            }

            // Scan over the printed text since the last source mapping and update the
            // generated line and column numbers
            pub fn updateGeneratedLineAndColumn(b: *ThisBuilder, output: []const u8) void {
                const slice = output[b.last_generated_update..];
                var needs_mapping = b.cover_lines_without_mappings and !b.line_starts_with_mapping and b.has_prev_state;

                var i: usize = 0;
                const n = @as(usize, @intCast(slice.len));
                var c: i32 = 0;
                while (i < n) {
                    const len = strings.wtf8ByteSequenceLengthWithInvalid(slice[i]);
                    c = strings.decodeWTF8RuneT(slice[i..].ptr[0..4], len, i32, strings.unicode_replacement);
                    i += @as(usize, len);

                    switch (c) {
                        14...127 => {
                            if (strings.indexOfNewlineOrNonASCII(slice, @as(u32, @intCast(i)))) |j| {
                                b.generated_column += @as(i32, @intCast((@as(usize, j) - i) + 1));
                                i = j;
                                continue;
                            } else {
                                b.generated_column += @as(i32, @intCast(slice[i..].len)) + 1;
                                i = n;
                                break;
                            }
                        },
                        '\r', '\n', 0x2028, 0x2029 => {
                            // windows newline
                            if (c == '\r') {
                                const newline_check = b.last_generated_update + i + 1;
                                if (newline_check < output.len and output[newline_check] == '\n') {
                                    continue;
                                }
                            }

                            // If we're about to move to the next line and the previous line didn't have
                            // any mappings, add a mapping at the start of the previous line.
                            if (needs_mapping) {
                                b.appendMappingWithoutRemapping(.{
                                    .generated_line = b.prev_state.generated_line,
                                    .generated_column = 0,
                                    .source_index = b.prev_state.source_index,
                                    .original_line = b.prev_state.original_line,
                                    .original_column = b.prev_state.original_column,
                                });
                            }

                            b.prev_state.generated_line += 1;
                            b.prev_state.generated_column = 0;
                            b.generated_column = 0;
                            b.source_map.appendLineSeparator() catch unreachable;

                            // This new line doesn't have a mapping yet
                            b.line_starts_with_mapping = false;

                            needs_mapping = b.cover_lines_without_mappings and !b.line_starts_with_mapping and b.has_prev_state;
                        },

                        else => {
                            // Mozilla's "source-map" library counts columns using UTF-16 code units
                            b.generated_column += @as(i32, @intFromBool(c > 0xFFFF)) + 1;
                        },
                    }
                }

                b.last_generated_update = @as(u32, @truncate(output.len));
            }

            pub fn appendMapping(b: *ThisBuilder, current_state: SourceMapState) void {
                b.appendMappingWithoutRemapping(current_state);
            }

            pub fn appendMappingWithoutRemapping(b: *ThisBuilder, current_state: SourceMapState) void {
                b.source_map.append(current_state, b.prev_state) catch unreachable;
                b.prev_state = current_state;
                b.has_prev_state = true;
            }

            pub fn addSourceMapping(b: *ThisBuilder, loc: Logger.Loc, output: []const u8) void {
                if (
                // don't insert mappings for same location twice
                b.prev_loc.eql(loc) or
                    // exclude generated code from source
                    loc.start == Logger.Loc.Empty.start)
                    return;

                b.prev_loc = loc;
                const list = b.line_offset_tables;

                // We have no sourcemappings.
                // This happens for example when importing an asset which does not support sourcemaps
                // like a png or a jpg
                //
                // import foo from "./foo.png";
                //
                if (list.len == 0) {
                    return;
                }

                const original_line = LineOffsetTable.findLine(b.line_offset_table_byte_offset_list, loc);
                const line = list.get(@as(usize, @intCast(@max(original_line, 0))));

                // Use the line to compute the column
                var original_column = loc.start - @as(i32, @intCast(line.byte_offset_to_start_of_line));
                if (line.columns_for_non_ascii.len > 0 and original_column >= @as(i32, @intCast(line.byte_offset_to_first_non_ascii))) {
                    original_column = line.columns_for_non_ascii.slice()[@as(u32, @intCast(original_column)) - line.byte_offset_to_first_non_ascii];
                }

                b.updateGeneratedLineAndColumn(output);

                // If this line doesn't start with a mapping and we're about to add a mapping
                // that's not at the start, insert a mapping first so the line starts with one.
                if (b.cover_lines_without_mappings and !b.line_starts_with_mapping and b.generated_column > 0 and b.has_prev_state) {
                    b.appendMappingWithoutRemapping(.{
                        .generated_line = b.prev_state.generated_line,
                        .generated_column = 0,
                        .source_index = b.prev_state.source_index,
                        .original_line = b.prev_state.original_line,
                        .original_column = b.prev_state.original_column,
                    });
                }

                b.appendMapping(.{
                    .generated_line = b.prev_state.generated_line,
                    .generated_column = @max(b.generated_column, 0),
                    .source_index = b.prev_state.source_index,
                    .original_line = @max(original_line, 0),
                    .original_column = @max(original_column, 0),
                });

                // This line now has a mapping on it, so don't insert another one
                b.line_starts_with_mapping = true;
            }
        };
    }

    pub const Builder = NewBuilder(VLQSourceMap);
};

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
/// https://github.com/getsentry/rfcs/blob/main/text/0081-sourcemap-debugid.md#the-debugid-format
pub const DebugIDFormatter = struct {
    id: u64 = 0,

    pub fn format(self: DebugIDFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        // The RFC asks for a UUID, which is 128 bits (32 hex chars). Our hashes are only 64 bits.
        // We fill the end of the id with "bun!bun!" hex encoded
        var buf: [32]u8 = undefined;
        const formatter = bun.fmt.hexIntUpper(self.id);
        _ = std.fmt.bufPrint(&buf, "{}64756E2164756E21", .{formatter}) catch unreachable;
        try writer.writeAll(&buf);
    }
};

pub const coverage = @import("./CodeCoverage.zig");
pub const VLQ = @import("./VLQ.zig");
pub const LineOffsetTable = @import("./LineOffsetTable.zig");
pub const JSSourceMap = @import("./JSSourceMap.zig");

const decodeVLQAssumeValid = VLQ.decodeAssumeValid;
const decodeVLQ = VLQ.decode;

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const JSPrinter = bun.js_printer;
const Logger = bun.logger;
const MutableString = bun.MutableString;
const StringJoiner = bun.StringJoiner;
const URL = bun.URL;
const assert = bun.assert;
const strings = bun.strings;
const FileSystem = bun.fs.FileSystem;
