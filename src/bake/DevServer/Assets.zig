/// Storage for hashed assets on `/_bun/asset/{hash}.ext`
pub const Assets = @This();

/// Keys are absolute paths, sharing memory with the keys in IncrementalGraph(.client)
/// Values are indexes into files
path_map: bun.StringArrayHashMapUnmanaged(EntryIndex),
/// Content-addressable store. Multiple paths can point to the same content
/// hash, which is tracked by the `refs` array. One reference is held to
/// contained StaticRoute instances when they are stored.
files: AutoArrayHashMapUnmanaged(u64, *StaticRoute),
/// Indexed by the same index of `files`. The value is never `0`.
refs: ArrayListUnmanaged(u32),
/// When mutating `files`'s keys, the map must be reindexed to function.
needs_reindex: bool = false,

pub const EntryIndex = bun.GenericIndex(u30, Assets);

fn owner(assets: *Assets) *DevServer {
    return @alignCast(@fieldParentPtr("assets", assets));
}

pub fn getHash(assets: *Assets, path: []const u8) ?u64 {
    assert(assets.owner().magic == .valid);
    return if (assets.path_map.get(path)) |idx|
        assets.files.keys()[idx.get()]
    else
        null;
}

/// When an asset is overwritten, it receives a new URL to get around browser caching.
/// The old URL is immediately revoked.
pub fn replacePath(
    assets: *Assets,
    /// not allocated
    abs_path: []const u8,
    /// Ownership is transferred to this function
    contents: *const AnyBlob,
    mime_type: *const MimeType,
    /// content hash of the asset
    content_hash: u64,
) !EntryIndex {
    assert(assets.owner().magic == .valid);
    defer assert(assets.files.count() == assets.refs.items.len);
    const alloc = assets.owner().allocator();
    debug.log("replacePath {f} {} - {s}/{s} ({s})", .{
        bun.fmt.quote(abs_path),
        content_hash,
        DevServer.asset_prefix,
        &std.fmt.bytesToHex(std.mem.asBytes(&content_hash), .lower),
        mime_type.value,
    });

    const gop = try assets.path_map.getOrPut(alloc, abs_path);
    if (!gop.found_existing) {
        // Locate a stable pointer for the file path
        const stable_abs_path = (try assets.owner().client_graph.insertEmpty(abs_path, .unknown)).key;
        gop.key_ptr.* = stable_abs_path;
    } else {
        const entry_index = gop.value_ptr.*;
        // When there is one reference to the asset, the entry can be
        // replaced in-place with the new asset.
        if (assets.refs.items[entry_index.get()] == 1) {
            const slice = assets.files.entries.slice();

            const prev = slice.items(.value)[entry_index.get()];
            prev.deref();

            slice.items(.key)[entry_index.get()] = content_hash;
            slice.items(.value)[entry_index.get()] = StaticRoute.initFromAnyBlob(contents, .{
                .mime_type = mime_type,
                .server = assets.owner().server orelse unreachable,
            });
            comptime assert(@TypeOf(slice.items(.hash)[0]) == void);
            assets.needs_reindex = true;
            return entry_index;
        } else {
            assets.refs.items[entry_index.get()] -= 1;
            assert(assets.refs.items[entry_index.get()] > 0);
        }
    }

    try assets.reindexIfNeeded(alloc);
    const file_index_gop = try assets.files.getOrPut(alloc, content_hash);
    if (!file_index_gop.found_existing) {
        try assets.refs.append(alloc, 1);
        file_index_gop.value_ptr.* = StaticRoute.initFromAnyBlob(contents, .{
            .mime_type = mime_type,
            .server = assets.owner().server orelse unreachable,
        });
    } else {
        assets.refs.items[file_index_gop.index] += 1;
        var contents_mut = contents.*;
        contents_mut.detach();
    }
    gop.value_ptr.* = .init(@intCast(file_index_gop.index));
    return gop.value_ptr.*;
}

/// Returns a pointer to insert the *StaticRoute. If `null` is returned, then it
/// means there is already data here.
pub fn putOrIncrementRefCount(assets: *Assets, content_hash: u64, ref_count: u32) !?**StaticRoute {
    defer assert(assets.files.count() == assets.refs.items.len);
    const file_index_gop = try assets.files.getOrPut(assets.owner().allocator(), content_hash);
    if (!file_index_gop.found_existing) {
        try assets.refs.append(assets.owner().allocator(), ref_count);
        return file_index_gop.value_ptr;
    } else {
        assets.refs.items[file_index_gop.index] += ref_count;
        return null;
    }
}

pub fn unrefByHash(assets: *Assets, content_hash: u64, dec_count: u32) void {
    const index = assets.files.getIndex(content_hash) orelse
        Output.panic("Asset double unref: {x}", .{std.mem.asBytes(&content_hash)});
    assets.unrefByIndex(.init(@intCast(index)), dec_count);
}

pub fn unrefByIndex(assets: *Assets, index: EntryIndex, dec_count: u32) void {
    defer assert(assets.files.count() == assets.refs.items.len);
    assert(dec_count > 0);
    assets.refs.items[index.get()] -= dec_count;
    if (assets.refs.items[index.get()] == 0) {
        assets.files.values()[index.get()].deref();
        assets.files.swapRemoveAt(index.get());
        _ = assets.refs.swapRemove(index.get());
    }
}

pub fn unrefByPath(assets: *Assets, path: []const u8) void {
    const entry = assets.path_map.fetchSwapRemove(path) orelse return;
    assets.unrefByIndex(entry.value, 1);
}

pub fn reindexIfNeeded(assets: *Assets, alloc: Allocator) !void {
    if (assets.needs_reindex) {
        try assets.files.reIndex(alloc);
        assets.needs_reindex = false;
    }
}

pub fn get(assets: *Assets, content_hash: u64) ?*StaticRoute {
    assert(assets.owner().magic == .valid);
    assert(assets.files.count() == assets.refs.items.len);
    return assets.files.get(content_hash);
}

pub fn deinit(assets: *Assets, alloc: Allocator) void {
    assets.path_map.deinit(alloc);
    for (assets.files.values()) |blob| blob.deref();
    assets.files.deinit(alloc);
    assets.refs.deinit(alloc);
}

pub fn memoryCost(assets: *Assets) usize {
    var cost: usize = 0;
    cost += memoryCostArrayHashMap(assets.path_map);
    for (assets.files.values()) |blob| cost += blob.memoryCost();
    cost += memoryCostArrayHashMap(assets.files);
    cost += memoryCostArrayList(assets.refs);
    return cost;
}

const bun = @import("bun");
const Output = bun.Output;
const assert = bun.assert;
const bake = bun.bake;
const jsc = bun.jsc;
const MimeType = bun.http.MimeType;
const StaticRoute = bun.api.server.StaticRoute;
const AnyBlob = jsc.WebCore.Blob.Any;

const DevServer = bake.DevServer;
const debug = DevServer.debug;
const memoryCostArrayHashMap = DevServer.memoryCostArrayHashMap;
const memoryCostArrayList = DevServer.memoryCostArrayList;

const std = @import("std");
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const AutoArrayHashMapUnmanaged = std.AutoArrayHashMapUnmanaged;
const Allocator = std.mem.Allocator;
