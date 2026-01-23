//! Storage for source maps on `/_bun/client/{id}.js.map`
//!
//! All source maps are referenced counted, so that when a websocket disconnects
//! or a bundle is replaced, the unreachable source map URLs are revoked. Source
//! maps that aren't reachable from IncrementalGraph can still be reached by
//! a browser tab if it has a callback to a previously loaded chunk; so DevServer
//! should be aware of it.
const Self = @This();

/// See `SourceId` for what the content of u64 is.
pub const Key = bun.GenericIndex(u64, .{ "Key of", Self });

entries: AutoArrayHashMapUnmanaged(Key, Entry),
/// When a HTML bundle is loaded, it places a "weak reference" to the
/// script's source map. This reference is held until either:
/// - The script loads and moves the ref into "strongly held" by the HmrSocket
/// - The expiry time passes
/// - Too many different weak references exist
weak_refs: bun.LinearFifo(WeakRef, .{ .Static = weak_ref_entry_max }),
/// Shared
weak_ref_sweep_timer: EventLoopTimer,

pub const empty: Self = .{
    .entries = .empty,
    .weak_ref_sweep_timer = .initPaused(.DevServerSweepSourceMaps),
    .weak_refs = .init(),
};
const weak_ref_expiry_seconds = 10;
const weak_ref_entry_max = 16;

/// Route bundle keys clear the bottom 32 bits of this value, using only the
/// top 32 bits to represent the map. For JS chunks, these bottom 32 bits are
/// used as an index into `dev.route_bundles` to know what route it refers to.
///
/// HMR patches set the bottom bit to `1`, and use the remaining 63 bits as
/// an ID. This is fine since the JS chunks are never served after the update
/// is emitted.
// TODO: Rewrite this `SourceMapStore.Key` and some other places that use bit
// shifts and u64 to use this struct.
pub const SourceId = packed struct(u64) {
    kind: ChunkKind,
    bits: packed union {
        initial_response: packed struct(u63) {
            unused: enum(u31) { zero = 0 } = .zero,
            generation_id: u32,
        },
        hmr_chunk: packed struct(u63) {
            content_hash: u63,
        },
    },
};

/// IncrementalGraph stores partial source maps for each file. A
/// `SourceMapStore.Entry` is the information + refcount holder to
/// construct the actual JSON file associated with a bundle/hot update.
pub const Entry = struct {
    dev_allocator: DevAllocator,
    /// Sum of:
    /// - How many active sockets have code that could reference this source map?
    /// - For route bundle client scripts, +1 until invalidation.
    ref_count: u32,
    /// Indexes are off by one because this excludes the HMR Runtime.
    /// Outer slice is owned, inner slice is shared with IncrementalGraph.
    paths: []const []const u8,
    /// Indexes are off by one because this excludes the HMR Runtime.
    files: bun.MultiArrayList(PackedMap.Shared),
    /// The memory cost can be shared between many entries and IncrementalGraph
    /// So this is only used for eviction logic, to pretend this was the only
    /// entry. To compute the memory cost of DevServer, this cannot be used.
    overlapping_memory_cost: u32,

    pub fn sourceContents(entry: Entry) []const bun.StringPointer {
        return entry.source_contents[0..entry.file_paths.len];
    }

    pub fn renderMappings(map: Entry, kind: ChunkKind, arena: Allocator, gpa: Allocator) ![]u8 {
        var j: StringJoiner = .{ .allocator = arena };
        j.pushStatic("AAAA");
        try joinVLQ(&map, kind, &j, arena, .client);
        return j.done(gpa);
    }

    pub fn renderJSON(map: *const Entry, dev: *DevServer, arena: Allocator, kind: ChunkKind, gpa: Allocator, side: bake.Side) ![]u8 {
        const map_files = map.files.slice();
        const paths = map.paths;

        var j: StringJoiner = .{ .allocator = arena };

        j.pushStatic(
            \\{"version":3,"sources":["bun://Bun/Bun HMR Runtime"
        );

        // This buffer is temporary, holding the quoted source paths, joined with commas.
        var source_map_strings = std.array_list.Managed(u8).init(arena);
        defer source_map_strings.deinit();

        const buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(buf);

        for (paths) |native_file_path| {
            try source_map_strings.appendSlice(",");
            const path = if (Environment.isWindows)
                bun.path.pathToPosixBuf(u8, native_file_path, buf)
            else
                native_file_path;

            if (std.fs.path.isAbsolute(path)) {
                const is_windows_drive_path = Environment.isWindows and path[0] != '/';

                // On the client we prefix the sourcemap path with "file://" and
                // percent encode it
                if (side == .client) {
                    try source_map_strings.appendSlice(if (is_windows_drive_path)
                        "\"file:///"
                    else
                        "\"file://");
                } else {
                    try source_map_strings.append('"');
                }

                if (Environment.isWindows and !is_windows_drive_path) {
                    // UNC namespace -> file://server/share/path.ext
                    encodeSourceMapPath(
                        side,
                        if (path.len > 2 and path[0] == '/' and path[1] == '/')
                            path[2..]
                        else
                            path, // invalid but must not crash
                        &source_map_strings,
                    ) catch |err| switch (err) {
                        error.IncompleteUTF8 => @panic("Unexpected: asset with incomplete UTF-8 as file path"),
                        error.OutOfMemory => |e| return e,
                    };
                } else {
                    // posix paths always start with '/'
                    // -> file:///path/to/file.js
                    // windows drive letter paths have the extra slash added
                    // -> file:///C:/path/to/file.js
                    encodeSourceMapPath(side, path, &source_map_strings) catch |err| switch (err) {
                        error.IncompleteUTF8 => @panic("Unexpected: asset with incomplete UTF-8 as file path"),
                        error.OutOfMemory => |e| return e,
                    };
                }
                try source_map_strings.appendSlice("\"");
            } else {
                try source_map_strings.appendSlice("\"bun://");
                bun.strings.percentEncodeWrite(path, &source_map_strings) catch |err| switch (err) {
                    error.IncompleteUTF8 => @panic("Unexpected: asset with incomplete UTF-8 as file path"),
                    error.OutOfMemory => |e| return e,
                };
                try source_map_strings.appendSlice("\"");
            }
        }
        j.pushStatic(source_map_strings.items);
        j.pushStatic(
            \\],"sourcesContent":["// (Bun's internal HMR runtime is minified)"
        );
        for (0..map_files.len) |i| {
            const chunk = map_files.get(i);
            const source_map = chunk.get() orelse {
                // For empty chunks, put a blank entry. This allows HTML files to get their stack
                // remapped, despite having no actual mappings.
                j.pushStatic(",\"\"");
                continue;
            };
            j.pushStatic(",");
            const quoted_slice = source_map.quotedContents();
            if (quoted_slice.len == 0) {
                bun.debugAssert(false); // vlq without source contents!
                j.pushStatic(",\"// Did not have source contents for this file.\n// This is a bug in Bun's bundler and should be reported with a reproduction.\"");
                continue;
            }
            // Store the location of the source file. Since it is going
            // to be stored regardless for use by the served source map.
            // These 8 bytes per file allow remapping sources without
            // reading from disk, as well as ensuring that remaps to
            // this exact sourcemap can print the previous state of
            // the code when it was modified.
            bun.assert(quoted_slice[0] == '"');
            bun.assert(quoted_slice[quoted_slice.len - 1] == '"');
            j.pushStatic(quoted_slice);
        }
        // This first mapping makes the bytes from line 0 column 0 to the next mapping
        j.pushStatic(
            \\],"names":[],"mappings":"AAAA
        );
        try joinVLQ(map, kind, &j, arena, side);

        const json_bytes = try j.doneWithEnd(gpa, "\"}");
        errdefer @compileError("last try should be the final alloc");

        if (bun.FeatureFlags.bake_debugging_features) if (dev.dump_dir) |dump_dir| {
            const rel_path_escaped = if (side == .client) "latest_chunk.js.map" else "latest_hmr.js.map";
            dumpBundle(dump_dir, if (side == .client) .client else .server, rel_path_escaped, json_bytes, false) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                Output.warn("Could not dump bundle: {}", .{err});
            };
        };

        return json_bytes;
    }

    fn encodeSourceMapPath(
        side: bake.Side,
        utf8_input: []const u8,
        array_list: *std.array_list.Managed(u8),
    ) error{ OutOfMemory, IncompleteUTF8 }!void {
        // On the client, percent encode everything so it works in the browser
        if (side == .client) {
            return bun.strings.percentEncodeWrite(utf8_input, array_list);
        }

        const writer = array_list.writer();
        try bun.js_printer.writePreQuotedString(utf8_input, @TypeOf(writer), writer, '"', false, true, .utf8);
    }

    fn joinVLQ(map: *const Entry, kind: ChunkKind, j: *StringJoiner, arena: Allocator, side: bake.Side) !void {
        _ = side;
        const map_files = map.files.slice();

        const runtime: bake.HmrRuntime = switch (kind) {
            .initial_response => bun.bake.getHmrRuntime(.client),
            .hmr_chunk => comptime .init("self[Symbol.for(\"bun:hmr\")]({\n"),
        };

        var prev_end_state: SourceMap.SourceMapState = .{
            .generated_line = 0,
            .generated_column = 0,
            .source_index = 0,
            .original_line = 0,
            .original_column = 0,
        };

        // The runtime.line_count counts newlines (e.g., 2941 for a 2942-line file).
        // The runtime ends at line 2942 with })({ so modules start after that.
        var lines_between: u32 = runtime.line_count;

        // Join all of the mappings together.
        for (0..map_files.len) |i| switch (map_files.get(i)) {
            .some => |source_map| {
                const source_index = i + 1;
                const content = source_map.get();
                const start_state: SourceMap.SourceMapState = .{
                    .source_index = @intCast(source_index),
                    .generated_line = @intCast(lines_between),
                    .generated_column = 0,
                    .original_line = 0,
                    .original_column = 0,
                };
                lines_between = 0;

                try SourceMap.appendSourceMapChunk(
                    j,
                    arena,
                    prev_end_state,
                    start_state,
                    content.vlq(),
                );

                prev_end_state = .{
                    .source_index = @intCast(source_index),
                    .generated_line = 0,
                    .generated_column = 0,
                    .original_line = content.end_state.original_line,
                    .original_column = content.end_state.original_column,
                };
            },
            .line_count => |count| {
                lines_between += count.get();
                // - Empty file has no breakpoints that could remap.
                // - Codegen of HTML files cannot throw.
            },
            .none => {
                // NOTE: It is too late to compute the line count since the bundled text may
                // have been freed already. For example, a HMR chunk is never persisted.
                // We could return an error here but what would be a better behavior for renderJSON and renderMappings?
                // This is a dev server, crashing is not a good DX, we could fail the request but that's not a good DX either.
                if (bun.Environment.enable_logs) {
                    mapLog("Skipping source map entry with missing line count at index {d}", .{i});
                }
            },
        };
    }

    pub fn deinit(entry: *Entry) void {
        useAllFields(Entry, .{
            .dev_allocator = {},
            .ref_count = assert(entry.ref_count == 0),
            .overlapping_memory_cost = {},
            .files = {
                const files = entry.files.slice();
                for (0..files.len) |i| {
                    var file = files.get(i);
                    file.deinit();
                }
                entry.files.deinit(entry.allocator());
            },
            .paths = entry.allocator().free(entry.paths),
        });
    }

    fn allocator(entry: *const Entry) Allocator {
        return entry.dev_allocator.allocator();
    }
};

pub const WeakRef = struct {
    /// This encoding only supports route bundle scripts, which do not
    /// utilize the bottom 32 bits of their keys. This is because the bottom
    /// 32 bits are used for the index of the route bundle. While those bits
    /// are present in the JS file's key, it is not present in the source
    /// map key. This allows this struct to be cleanly packed to 128 bits.
    key_top_bits: u32,
    /// When this ref expires, it must subtract this many from `refs`
    count: u32,
    /// Seconds since epoch. Every time `weak_refs` is incremented, this is
    /// updated to the current time + 1 minute. When the timer expires, all
    /// references are removed.
    expire: i64,

    pub fn key(ref: WeakRef) Key {
        return .init(@as(u64, ref.key_top_bits) << 32);
    }

    pub fn init(k: Key, count: u32, expire: i64) WeakRef {
        return .{
            .key_top_bits = @intCast(k.get() >> 32),
            .count = count,
            .expire = expire,
        };
    }
};

pub fn owner(store: *Self) *DevServer {
    return @alignCast(@fieldParentPtr("source_maps", store));
}

fn allocator(store: *Self) Allocator {
    return store.dev_allocator().allocator();
}

fn dev_allocator(store: *const Self) DevAllocator {
    const dev_server: *const DevServer = @constCast(store).owner();
    return dev_server.dev_allocator();
}

const PutOrIncrementRefCount = union(enum) {
    /// If an *Entry is returned, caller must initialize some
    /// fields with the source map data.
    uninitialized: *Entry,
    /// Already exists, ref count was incremented.
    shared: *Entry,
};

pub fn putOrIncrementRefCount(store: *Self, script_id: Key, ref_count: u32) !PutOrIncrementRefCount {
    const gop = try store.entries.getOrPut(store.allocator(), script_id);
    if (!gop.found_existing) {
        bun.debugAssert(ref_count > 0); // invalid state
        gop.value_ptr.* = .{
            .dev_allocator = store.dev_allocator(),
            .ref_count = ref_count,
            .overlapping_memory_cost = undefined,
            .paths = undefined,
            .files = undefined,
        };
        return .{ .uninitialized = gop.value_ptr };
    } else {
        bun.debugAssert(ref_count >= 0); // okay since ref_count is already 1
        gop.value_ptr.*.ref_count += ref_count;
        return .{ .shared = gop.value_ptr };
    }
}

pub fn unref(store: *Self, key: Key) void {
    unrefCount(store, key, 1);
}

pub fn unrefCount(store: *Self, key: Key, count: u32) void {
    const index = store.entries.getIndex(key) orelse
        return bun.debugAssert(false);
    unrefAtIndex(store, index, count);
}

fn unrefAtIndex(store: *Self, index: usize, count: u32) void {
    const e = &store.entries.values()[index];
    e.ref_count -= count;
    if (bun.Environment.enable_logs) {
        mapLog("dec {x}, {d} | {d} -> {d}", .{ store.entries.keys()[index].get(), count, e.ref_count + count, e.ref_count });
    }
    if (e.ref_count == 0) {
        e.deinit();
        store.entries.swapRemoveAt(index);
    }
}

pub fn addWeakRef(store: *Self, key: Key) void {
    // This function expects that `weak_ref_entry_max` is low.
    const entry = store.entries.getPtr(key) orelse
        return bun.debugAssert(false);
    entry.ref_count += 1;

    var new_weak_ref_count: u32 = 1;

    for (0..store.weak_refs.count) |i| {
        const ref = store.weak_refs.peekItem(i);
        if (ref.key() == key) {
            new_weak_ref_count += ref.count;
            store.weak_refs.orderedRemoveItem(i);
            break;
        }
    } else {
        // If full, one must be expired to make room.
        if (store.weak_refs.count >= weak_ref_entry_max) {
            const first = store.weak_refs.readItem().?;
            store.unrefCount(first.key(), first.count);
            if (store.weak_ref_sweep_timer.state == .ACTIVE and
                store.weak_ref_sweep_timer.next.sec == first.expire)
                store.owner().vm.timer.remove(&store.weak_ref_sweep_timer);
        }
    }

    const expire = bun.timespec.msFromNow(.allow_mocked_time, weak_ref_expiry_seconds * 1000);
    store.weak_refs.writeItem(.init(
        key,
        new_weak_ref_count,
        expire.sec,
    )) catch
        unreachable; // space has been cleared above

    if (store.weak_ref_sweep_timer.state != .ACTIVE) {
        mapLog("arming weak ref sweep timer", .{});
        store.owner().vm.timer.update(&store.weak_ref_sweep_timer, &expire);
    }
    mapLog("addWeakRef {x}, ref_count: {d}", .{ key.get(), entry.ref_count });
}

/// Returns true if the ref count was incremented (meaning there was a source map to transfer)
pub fn removeOrUpgradeWeakRef(store: *Self, key: Key, mode: enum(u1) {
    /// Remove the weak ref entirely
    remove = 0,
    /// Convert the weak ref into a strong ref
    upgrade = 1,
}) bool {
    const entry = store.entries.getPtr(key) orelse
        return false;
    for (0..store.weak_refs.count) |i| {
        const ref = store.weak_refs.peekItemMut(i);
        if (ref.key() == key) {
            ref.count -|= 1;
            if (mode == .remove) {
                store.unref(key);
            }
            if (ref.count == 0) {
                store.weak_refs.orderedRemoveItem(i);
            }
            break;
        }
    } else {
        entry.ref_count += @intFromEnum(mode);
    }
    mapLog("maybeUpgradeWeakRef {x}, ref_count: {d}", .{
        key.get(),
        entry.ref_count,
    });
    return true;
}

pub fn locateWeakRef(store: *Self, key: Key) ?struct { index: usize, ref: WeakRef } {
    for (0..store.weak_refs.count) |i| {
        const ref = store.weak_refs.peekItem(i);
        if (ref.key() == key) return .{ .index = i, .ref = ref };
    }
    return null;
}

pub fn sweepWeakRefs(timer: *EventLoopTimer, now_ts: *const bun.timespec) void {
    mapLog("sweepWeakRefs", .{});
    const store: *Self = @fieldParentPtr("weak_ref_sweep_timer", timer);
    assert(store.owner().magic == .valid);

    const now: u64 = @max(now_ts.sec, 0);

    defer store.owner().emitMemoryVisualizerMessageIfNeeded();

    while (store.weak_refs.readItem()) |item| {
        if (item.expire <= now) {
            store.unrefCount(item.key(), item.count);
        } else {
            store.weak_refs.unget(&.{item}) catch
                unreachable; // there is enough space since the last item was just removed.
            store.weak_ref_sweep_timer.state = .FIRED;
            store.owner().vm.timer.update(
                &store.weak_ref_sweep_timer,
                &.{ .sec = item.expire + 1, .nsec = 0 },
            );
            return;
        }
    }

    store.weak_ref_sweep_timer.state = .CANCELLED;
}

pub const GetResult = struct {
    index: bun.GenericIndex(u32, Entry),
    mappings: SourceMap.Mapping.List,
    file_paths: []const []const u8,
    entry_files: *const bun.MultiArrayList(PackedMap.Shared),

    pub fn deinit(self: *@This(), alloc: Allocator) void {
        self.mappings.deinit(alloc);
        // file paths and source contents are borrowed
    }
};

/// This is used in exactly one place: remapping errors.
/// In that function, an arena allows reusing memory between different source maps
pub fn getParsedSourceMap(store: *Self, script_id: Key, arena: Allocator, gpa: Allocator) ?GetResult {
    const index = store.entries.getIndex(script_id) orelse
        return null; // source map was collected.
    const entry = &store.entries.values()[index];

    const script_id_decoded: SourceId = @bitCast(script_id.get());
    const vlq_bytes = bun.handleOom(entry.renderMappings(script_id_decoded.kind, arena, arena));

    switch (SourceMap.Mapping.parse(
        gpa,
        vlq_bytes,
        null,
        @intCast(entry.paths.len),
        0, // unused
        .{},
    )) {
        .fail => |fail| {
            Output.debugWarn("Failed to re-parse source map: {s}", .{fail.msg});
            return null;
        },
        .success => |psm| {
            return .{
                .index = .init(@intCast(index)),
                .mappings = psm.mappings,
                .file_paths = entry.paths,
                .entry_files = &entry.files,
            };
        },
    }
}

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const SourceMap = bun.SourceMap;
const StringJoiner = bun.StringJoiner;
const assert = bun.assert;
const bake = bun.bake;
const useAllFields = bun.meta.useAllFields;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const DevServer = bun.bake.DevServer;
const ChunkKind = DevServer.ChunkKind;
const DevAllocator = DevServer.DevAllocator;
const PackedMap = DevServer.PackedMap;
const dumpBundle = DevServer.dumpBundle;
const mapLog = DevServer.mapLog;

const std = @import("std");
const AutoArrayHashMapUnmanaged = std.AutoArrayHashMapUnmanaged;
const Allocator = std.mem.Allocator;
