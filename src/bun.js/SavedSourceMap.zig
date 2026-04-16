const SavedSourceMap = @This();

/// This is a pointer to the map located on the VirtualMachine struct
map: *HashTable,
mutex: bun.Mutex = .{},

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

/// `InternalSourceMap` is the storage for runtime-transpiled modules.
/// `ParsedSourceMap` is materialized lazily from a `SourceProviderMap` /
/// `BakeSourceProvider` / `DevServerSourceProvider` for sources that ship
/// their own external `.map`.
pub const Value = bun.TaggedPointerUnion(.{
    ParsedSourceMap,
    SourceProviderMap,
    BakeSourceProvider,
    DevServerSourceProvider,
    InternalSourceMap,
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
            } else if (value.get(SourceProviderMap)) |provider| {
                _ = provider; // do nothing, we did not hold a ref to ZigSourceProvider
            } else if (value.get(InternalSourceMap)) |ism| {
                (InternalSourceMap{ .data = @as([*]u8, @ptrCast(ism)) }).deinit();
            }
        }
    }

    this.map.unlockPointers();
    this.map.deinit();
}

pub fn putMappings(this: *SavedSourceMap, source: *const logger.Source, mappings: MutableString) !void {
    const blob = try bun.default_allocator.dupe(u8, mappings.list.items);
    try this.putValue(source.path.text, Value.init(bun.cast(*InternalSourceMap, blob.ptr)));
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
        } else if (old_value.get(SourceProviderMap)) |provider| {
            _ = provider; // do nothing, we did not hold a ref to ZigSourceProvider
        } else if (old_value.get(InternalSourceMap)) |ism| {
            (InternalSourceMap{ .data = @as([*]u8, @ptrCast(ism)) }).deinit();
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
        @field(Value.Tag, @typeName(InternalSourceMap)) => {
            // Rare path: a caller wants a ParsedSourceMap (e.g.
            // `node:module`.findSourceMap). Re-encode to VLQ, parse into a
            // Mapping.List, and swap the table entry so this only happens once.
            defer this.unlock();
            const ism: InternalSourceMap = .{
                .data = @as([*]u8, @ptrCast(Value.from(mapping.value_ptr.*).as(InternalSourceMap))),
            };
            var vlq = MutableString.initEmpty(bun.default_allocator);
            defer vlq.deinit();
            ism.appendVLQTo(&vlq);

            const parsed = switch (SourceMap.Mapping.parse(
                bun.default_allocator,
                vlq.list.items,
                ism.mappingCount(),
                1,
                ism.inputLineCount(),
                .{},
            )) {
                .fail => {
                    ism.deinit();
                    _ = this.map.remove(hash);
                    return .{};
                },
                .success => |success| success,
            };
            ism.deinit();
            const result = bun.new(ParsedSourceMap, parsed);
            mapping.value_ptr.* = Value.init(result).ptr();
            result.ref();
            return .{ .map = result };
        },
        @field(Value.Tag, @typeName(ParsedSourceMap)) => {
            defer this.unlock();
            const map = Value.from(mapping.value_ptr.*).as(ParsedSourceMap);
            map.ref();
            return .{ .map = map };
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

/// Returns a view over the InternalSourceMap blob if `path` was inserted via
/// `putMappings` (runtime-transpiled module). The blob lives until the entry is
/// replaced or the table is deinitialized; callers must not retain the view
/// across module reloads.
pub fn getInternal(this: *SavedSourceMap, path: string) ?InternalSourceMap {
    this.lock();
    defer this.unlock();
    const raw = this.map.get(bun.hash(path)) orelse return null;
    const ptr = Value.from(raw).get(InternalSourceMap) orelse return null;
    return .{ .data = @as([*]u8, @ptrCast(ptr)) };
}

pub fn resolveMapping(
    this: *SavedSourceMap,
    path: []const u8,
    line: bun.Ordinal,
    column: bun.Ordinal,
    source_handling: SourceMap.SourceContentHandling,
) ?SourceMap.Mapping.Lookup {
    {
        this.lock();
        defer this.unlock();
        if (this.map.get(bun.hash(path))) |raw| {
            if (Value.from(raw).get(InternalSourceMap)) |ptr| {
                const ism = InternalSourceMap{ .data = @as([*]u8, @ptrCast(ptr)) };
                const mapping = ism.find(line, column) orelse return null;
                // `source_handling` is irrelevant for this arm. Runtime-transpiled
                // modules have no external sources (`isExternal() == false`), so on
                // `main` this codepath returned a ParsedSourceMap that
                // `remapZigException` ignored anyway and fell through to
                // `fetchWithoutOnLoadPlugins(.print_source)` for the code frame.
                // Returning `source_map = null` reaches the same fallback one
                // branch earlier.
                return .{
                    .mapping = mapping,
                    .source_map = null,
                    .prefetched_source_code = null,
                };
            }
        }
    }

    const parse = this.getWithContent(path, switch (source_handling) {
        .no_source_contents => .mappings_only,
        .source_contents => .{ .all = .{ .line = @max(line.zeroBased(), 0), .column = @max(column.zeroBased(), 0) } },
    });
    const map = parse.map orelse return null;

    const mapping = parse.mapping orelse
        map.findMapping(line, column) orelse
        return null;

    return .{
        .mapping = mapping,
        .source_map = map,
        .prefetched_source_code = parse.source_contents,
    };
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const Output = bun.Output;
const js_printer = bun.js_printer;
const logger = bun.logger;

const SourceMap = bun.SourceMap;
const BakeSourceProvider = bun.SourceMap.BakeSourceProvider;
const DevServerSourceProvider = bun.SourceMap.DevServerSourceProvider;
const InternalSourceMap = SourceMap.InternalSourceMap;
const ParsedSourceMap = SourceMap.ParsedSourceMap;
const SourceProviderMap = SourceMap.SourceProviderMap;
