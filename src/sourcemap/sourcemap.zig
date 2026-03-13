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
            const mapping = map.?.mappings.find(.fromZeroBased(loc.line), .fromZeroBased(loc.column)) orelse
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
pub const Mapping = @import("./Mapping.zig");

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

pub const ParsedSourceMap = @import("./ParsedSourceMap.zig");

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

/// Always returns UTF-8
fn findSourceMappingURL(comptime T: type, source: []const T, alloc: std.mem.Allocator) ?bun.jsc.ZigString.Slice {
    const needle = comptime bun.strings.literal(T, "\n//# sourceMappingURL=");
    const found = std.mem.lastIndexOf(T, source, needle) orelse return null;
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

            const maybe_found_url = found_url: {
                if (source.is8Bit())
                    break :found_url findSourceMappingURL(u8, source.latin1(), allocator);

                break :found_url findSourceMappingURL(u16, source.utf16(), allocator);
            };

            const found_url = maybe_found_url orelse break :try_inline;
            defer found_url.deinit();

            const parsed = parseUrl(
                bun.default_allocator,
                allocator,
                found_url.slice(),
                result,
            ) catch |err| {
                inline_err = err;
                break :try_inline;
            };

            break :parsed .{
                .is_inline_map,
                parsed,
            };
        }

        // try to load a .map file
        if (load_hint != .is_inline_map) try_external: {
            if (comptime SourceProviderKind == DevServerSourceProvider) {
                // For DevServerSourceProvider, get the source map JSON directly
                const source_map_data = provider.getSourceMapJSON();

                if (source_map_data.length == 0) {
                    break :try_external;
                }

                const json_slice = source_map_data.ptr[0..source_map_data.length];

                // Parse the JSON source map
                break :parsed .{
                    .is_external_map,
                    parseJSON(
                        bun.default_allocator,
                        allocator,
                        json_slice,
                        result,
                    ) catch |err| {
                        // Print warning even if this came from non-visible code like
                        // calling `error.stack`. This message is only printed if
                        // the sourcemap has been found but is invalid, such as being
                        // invalid JSON text or corrupt mappings.
                        bun.Output.warn("Could not decode sourcemap in dev server runtime: {s} - {s}", .{
                            source_filename,
                            @errorName(err),
                        }); // Disable the "try using --sourcemap=external" hint
                        bun.jsc.SavedSourceMap.MissingSourceMapNoteInfo.seen_invalid = true;
                        return null;
                    },
                };
            }

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

pub const DevServerSourceProvider = opaque {
    pub const SourceMapData = extern struct {
        ptr: [*]const u8,
        length: usize,
    };

    extern fn DevServerSourceProvider__getSourceSlice(*DevServerSourceProvider) bun.String;
    extern fn DevServerSourceProvider__getSourceMapJSON(*DevServerSourceProvider) SourceMapData;

    pub const getSourceSlice = DevServerSourceProvider__getSourceSlice;
    pub const getSourceMapJSON = DevServerSourceProvider__getSourceMapJSON;

    pub fn toSourceContentPtr(this: *DevServerSourceProvider) ParsedSourceMap.SourceContentPtr {
        return ParsedSourceMap.SourceContentPtr.fromDevServerProvider(this);
    }

    /// The last two arguments to this specify loading hints
    pub fn getSourceMap(
        provider: *DevServerSourceProvider,
        source_filename: []const u8,
        load_hint: SourceMap.SourceMapLoadHint,
        result: SourceMap.ParseUrlResultHint,
    ) ?SourceMap.ParseUrl {
        return getSourceMapImpl(
            DevServerSourceProvider,
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
    line: bun.Ordinal,
    column: bun.Ordinal,
) ?Mapping {
    return this.mapping.find(line, column);
}

pub const SourceMapShifts = struct {
    before: LineColumnOffset,
    after: LineColumnOffset,
};

pub const SourceMapPieces = struct {
    prefix: std.array_list.Managed(u8),
    mappings: std.array_list.Managed(u8),
    suffix: std.array_list.Managed(u8),

    pub fn init(allocator: std.mem.Allocator) SourceMapPieces {
        return .{
            .prefix = std.array_list.Managed(u8).init(allocator),
            .mappings = std.array_list.Managed(u8).init(allocator),
            .suffix = std.array_list.Managed(u8).init(allocator),
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

pub const Chunk = @import("./Chunk.zig");

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
/// https://github.com/getsentry/rfcs/blob/main/text/0081-sourcemap-debugid.md#the-debugid-format
pub const DebugIDFormatter = struct {
    id: u64 = 0,

    pub fn format(self: DebugIDFormatter, writer: *std.Io.Writer) !void {
        // The RFC asks for a UUID, which is 128 bits (32 hex chars). Our hashes are only 64 bits.
        // We fill the end of the id with "bun!bun!" hex encoded
        var buf: [32]u8 = undefined;
        const formatter = bun.fmt.hexIntUpper(self.id);
        _ = std.fmt.bufPrint(&buf, "{f}64756E2164756E21", .{formatter}) catch unreachable;
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
const Logger = bun.logger;
const MutableString = bun.MutableString;
const StringJoiner = bun.StringJoiner;
const URL = bun.URL;
const assert = bun.assert;
const strings = bun.strings;
