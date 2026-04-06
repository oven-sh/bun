const SavedSourceMap = @This();

/// This is a pointer to the map located on the VirtualMachine struct
map: *HashTable,
mutex: bun.Mutex = .{},

pub const vlq_offset = 24;

pub fn init(this: *SavedSourceMap, map: *HashTable) void {
    this.* = .{
        .map = map,
        .mutex = .{},
    };

    this.map.lockPointers();
}

pub inline fn lock(map: *SavedSourceMap) void {
    map.mutex.lock();
    map.map.unlockPointers();
}

pub inline fn unlock(map: *SavedSourceMap) void {
    map.map.lockPointers();
    map.mutex.unlock();
}

// For the runtime, we store the number of mappings and how many bytes the final list is at the beginning of the array
// The first 8 bytes are the length of the array
// The second 8 bytes are the number of mappings
pub const SavedMappings = struct {
    data: [*]u8,

    pub fn vlq(this: SavedMappings) []u8 {
        return this.data[vlq_offset..this.len()];
    }

    pub inline fn len(this: SavedMappings) usize {
        return @as(u64, @bitCast(this.data[0..8].*));
    }

    pub fn deinit(this: SavedMappings) void {
        bun.default_allocator.free(this.data[0..this.len()]);
    }

    pub fn toMapping(this: SavedMappings, allocator: Allocator, path: string) anyerror!ParsedSourceMap {
        const result = SourceMap.Mapping.parse(
            allocator,
            this.data[vlq_offset..this.len()],
            @as(usize, @bitCast(this.data[8..16].*)),
            1,
            @as(usize, @bitCast(this.data[16..24].*)),
            .{},
        );
        switch (result) {
            .fail => |fail| {
                if (Output.enable_ansi_colors_stderr) {
                    try fail.toData(path).writeFormat(
                        Output.errorWriter(),
                        logger.Kind.warn,
                        false,
                        true,
                    );
                } else {
                    try fail.toData(path).writeFormat(
                        Output.errorWriter(),
                        logger.Kind.warn,
                        false,
                        false,
                    );
                }

                return fail.err;
            },
            .success => |success| {
                return success;
            },
        }
    }
};

/// ParsedSourceMap is the canonical form for sourcemaps,
///
/// but `SavedMappings` and `SourceProviderMap` are much cheaper to construct.
/// In `fn get`, this value gets converted to ParsedSourceMap always
pub const Value = bun.TaggedPointerUnion(.{
    ParsedSourceMap,
    SavedMappings,
    SourceProviderMap,
    BakeSourceProvider,
    DevServerSourceProvider,
});

pub const MissingSourceMapNoteInfo = struct {
    pub var storage: bun.PathBuffer = undefined;
    pub var path: ?[]const u8 = null;
    pub var seen_invalid = false;

    pub fn print() void {
        if (seen_invalid) return;
        if (path) |note| {
            Output.note("missing sourcemaps for {s}", .{note});
            Output.note("consider bundling with '--sourcemap' to get unminified traces", .{});
        }
    }
};

pub fn putBakeSourceProvider(this: *SavedSourceMap, opaque_source_provider: *BakeSourceProvider, path: []const u8) void {
    bun.handleOom(this.putValue(path, Value.init(opaque_source_provider)));
}

pub fn putDevServerSourceProvider(this: *SavedSourceMap, opaque_source_provider: *DevServerSourceProvider, path: []const u8) void {
    this.putValue(path, Value.init(opaque_source_provider)) catch |err| bun.handleOom(err);
}

pub fn removeDevServerSourceProvider(this: *SavedSourceMap, opaque_source_provider: *anyopaque, path: []const u8) void {
    this.lock();
    defer this.unlock();

    const entry = this.map.getEntry(bun.hash(path)) orelse return;
    const old_value = Value.from(entry.value_ptr.*);
    if (old_value.get(DevServerSourceProvider)) |prov| {
        if (@intFromPtr(prov) == @intFromPtr(opaque_source_provider)) {
            // there is nothing to unref or deinit
            this.map.removeByPtr(entry.key_ptr);
        }
    } else if (old_value.get(ParsedSourceMap)) |map| {
        if (map.underlying_provider.provider()) |prov| {
            if (@intFromPtr(prov.ptr()) == @intFromPtr(opaque_source_provider)) {
                this.map.removeByPtr(entry.key_ptr);
                map.deref();
            }
        }
    }
}

pub fn putZigSourceProvider(this: *SavedSourceMap, opaque_source_provider: *anyopaque, path: []const u8) void {
    const source_provider: *SourceProviderMap = @ptrCast(opaque_source_provider);
    bun.handleOom(this.putValue(path, Value.init(source_provider)));
}

pub fn removeZigSourceProvider(this: *SavedSourceMap, opaque_source_provider: *anyopaque, path: []const u8) void {
    this.lock();
    defer this.unlock();

    const entry = this.map.getEntry(bun.hash(path)) orelse return;
    const old_value = Value.from(entry.value_ptr.*);
    if (old_value.get(SourceProviderMap)) |prov| {
        if (@intFromPtr(prov) == @intFromPtr(opaque_source_provider)) {
            // there is nothing to unref or deinit
            this.map.removeByPtr(entry.key_ptr);
        }
    } else if (old_value.get(ParsedSourceMap)) |map| {
        if (map.underlying_provider.provider()) |prov| {
            if (@intFromPtr(prov.ptr()) == @intFromPtr(opaque_source_provider)) {
                this.map.removeByPtr(entry.key_ptr);
                map.deref();
            }
        }
    }
}

pub const HashTable = std.HashMap(u64, *anyopaque, bun.IdentityContext(u64), 80);

pub fn onSourceMapChunk(this: *SavedSourceMap, chunk: SourceMap.Chunk, source: *const logger.Source) anyerror!void {
    try this.putMappings(source, chunk.buffer);
}

pub const SourceMapHandler = js_printer.SourceMapHandler.For(SavedSourceMap, onSourceMapChunk);

pub fn deinit(this: *SavedSourceMap) void {
    {
        this.lock();
        defer this.unlock();

        var iter = this.map.valueIterator();
        while (iter.next()) |val| {
            var value = Value.from(val.*);
            if (value.get(ParsedSourceMap)) |source_map| {
                source_map.deref();
            } else if (value.get(SavedMappings)) |saved_mappings| {
                var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(saved_mappings)) };
                saved.deinit();
            } else if (value.get(SourceProviderMap)) |provider| {
                _ = provider; // do nothing, we did not hold a ref to ZigSourceProvider
            }
        }
    }

    this.map.unlockPointers();
    this.map.deinit();
}

pub fn putMappings(this: *SavedSourceMap, source: *const logger.Source, mappings: MutableString) !void {
    try this.putValue(source.path.text, Value.init(bun.cast(*SavedMappings, try bun.default_allocator.dupe(u8, mappings.list.items))));
}

pub fn putValue(this: *SavedSourceMap, path: []const u8, value: Value) !void {
    this.lock();
    defer this.unlock();

    const entry = try this.map.getOrPut(bun.hash(path));
    if (entry.found_existing) {
        var old_value = Value.from(entry.value_ptr.*);
        if (old_value.get(ParsedSourceMap)) |parsed_source_map| {
            var source_map: *ParsedSourceMap = parsed_source_map;
            source_map.deref();
        } else if (old_value.get(SavedMappings)) |saved_mappings| {
            var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(saved_mappings)) };
            saved.deinit();
        } else if (old_value.get(SourceProviderMap)) |provider| {
            _ = provider; // do nothing, we did not hold a ref to ZigSourceProvider
        }
    }
    entry.value_ptr.* = value.ptr();
}

/// You must call `sourcemap.map.deref()` or you will leak memory
fn getWithContent(
    this: *SavedSourceMap,
    path: string,
    hint: SourceMap.ParseUrlResultHint,
) SourceMap.ParseUrl {
    const hash = bun.hash(path);

    // This lock is for the hash table
    this.lock();

    // This mapping entry is only valid while the mutex is locked
    const mapping = this.map.getEntry(hash) orelse {
        this.unlock();
        return .{};
    };

    switch (Value.from(mapping.value_ptr.*).tag()) {
        @field(Value.Tag, @typeName(ParsedSourceMap)) => {
            defer this.unlock();
            const map = Value.from(mapping.value_ptr.*).as(ParsedSourceMap);
            map.ref();
            return .{ .map = map };
        },
        @field(Value.Tag, @typeName(SavedMappings)) => {
            defer this.unlock();
            var saved = SavedMappings{ .data = @as([*]u8, @ptrCast(Value.from(mapping.value_ptr.*).as(ParsedSourceMap))) };
            defer saved.deinit();
            const result = bun.new(ParsedSourceMap, saved.toMapping(bun.default_allocator, path) catch {
                _ = this.map.remove(mapping.key_ptr.*);
                return .{};
            });
            mapping.value_ptr.* = Value.init(result).ptr();
            result.ref();

            return .{ .map = result };
        },
        @field(Value.Tag, @typeName(SourceProviderMap)) => {
            const ptr: *SourceProviderMap = Value.from(mapping.value_ptr.*).as(SourceProviderMap);
            this.unlock();

            // Do not lock the mutex while we're parsing JSON!
            if (ptr.getSourceMap(path, .none, hint)) |parse| {
                if (parse.map) |map| {
                    map.ref();
                    // The mutex is not locked. We have to check the hash table again.
                    bun.handleOom(this.putValue(path, Value.init(map)));

                    return parse;
                }
            }

            this.lock();
            defer this.unlock();
            // does not have a valid source map. let's not try again
            _ = this.map.remove(hash);

            // Store path for a user note.
            const storage = MissingSourceMapNoteInfo.storage[0..path.len];
            @memcpy(storage, path);
            MissingSourceMapNoteInfo.path = storage;
            return .{};
        },
        @field(Value.Tag, @typeName(BakeSourceProvider)) => {
            // TODO: This is a copy-paste of above branch
            const ptr: *BakeSourceProvider = Value.from(mapping.value_ptr.*).as(BakeSourceProvider);
            this.unlock();

            // Do not lock the mutex while we're parsing JSON!
            if (ptr.getSourceMap(path, .none, hint)) |parse| {
                if (parse.map) |map| {
                    map.ref();
                    // The mutex is not locked. We have to check the hash table again.
                    bun.handleOom(this.putValue(path, Value.init(map)));

                    return parse;
                }
            }

            this.lock();
            defer this.unlock();
            // does not have a valid source map. let's not try again
            _ = this.map.remove(hash);

            // Store path for a user note.
            const storage = MissingSourceMapNoteInfo.storage[0..path.len];
            @memcpy(storage, path);
            MissingSourceMapNoteInfo.path = storage;
            return .{};
        },
        @field(Value.Tag, @typeName(DevServerSourceProvider)) => {
            // TODO: This is a copy-paste of above branch
            const ptr: *DevServerSourceProvider = Value.from(mapping.value_ptr.*).as(DevServerSourceProvider);
            this.unlock();

            // Do not lock the mutex while we're parsing JSON!
            if (ptr.getSourceMap(path, .none, hint)) |parse| {
                if (parse.map) |map| {
                    map.ref();
                    // The mutex is not locked. We have to check the hash table again.
                    this.putValue(path, Value.init(map)) catch |err| bun.handleOom(err);

                    return parse;
                }
            }

            this.lock();
            defer this.unlock();
            // does not have a valid source map. let's not try again
            _ = this.map.remove(hash);

            // Store path for a user note.
            const storage = MissingSourceMapNoteInfo.storage[0..path.len];
            @memcpy(storage, path);
            MissingSourceMapNoteInfo.path = storage;
            return .{};
        },
        else => {
            if (Environment.allow_assert) {
                @panic("Corrupt pointer tag");
            }
            this.unlock();

            return .{};
        },
    }
}

/// You must `deref()` the returned value or you will leak memory
pub fn get(this: *SavedSourceMap, path: string) ?*ParsedSourceMap {
    return this.getWithContent(path, .mappings_only).map;
}

pub fn resolveMapping(
    this: *SavedSourceMap,
    path: []const u8,
    line: bun.Ordinal,
    column: bun.Ordinal,
    source_handling: SourceMap.SourceContentHandling,
) ?SourceMap.Mapping.Lookup {
    const parse = this.getWithContent(path, switch (source_handling) {
        .no_source_contents => .mappings_only,
        .source_contents => .{ .all = .{ .line = @max(line.zeroBased(), 0), .column = @max(column.zeroBased(), 0) } },
    });
    const map = parse.map orelse return null;

    const mapping = parse.mapping orelse
        map.mappings.find(line, column) orelse
        return null;

    return .{
        .mapping = mapping,
        .source_map = map,
        .prefetched_source_code = parse.source_contents,
    };
}

const string = []const u8;

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const Output = bun.Output;
const js_printer = bun.js_printer;
const logger = bun.logger;

const SourceMap = bun.SourceMap;
const BakeSourceProvider = bun.SourceMap.BakeSourceProvider;
const DevServerSourceProvider = bun.SourceMap.DevServerSourceProvider;
const ParsedSourceMap = SourceMap.ParsedSourceMap;
const SourceProviderMap = SourceMap.SourceProviderMap;
