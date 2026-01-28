const DirectoryWatchStore = @This();

/// When a file fails to import a relative path, directory watchers are added so
/// that when a matching file is created, the dependencies can be rebuilt. This
/// handles HMR cases where a user writes an import before creating the file,
/// or moves files around. This structure is not thread-safe.
///
/// This structure manages those watchers, including releasing them once
/// import resolution failures are solved.
// TODO: when a file fixes its resolution, there is no code specifically to remove the watchers.

/// List of active watchers. Can be re-ordered on removal
watches: bun.StringArrayHashMapUnmanaged(Entry),
dependencies: ArrayListUnmanaged(Dep),
/// Dependencies cannot be re-ordered. This list tracks what indexes are free.
dependencies_free_list: ArrayListUnmanaged(Dep.Index),

pub const empty: DirectoryWatchStore = .{
    .watches = .{},
    .dependencies = .{},
    .dependencies_free_list = .{},
};

pub fn owner(store: *DirectoryWatchStore) *DevServer {
    return @alignCast(@fieldParentPtr("directory_watchers", store));
}

pub fn trackResolutionFailure(store: *DirectoryWatchStore, import_source: []const u8, specifier: []const u8, renderer: bake.Graph, loader: bun.options.Loader) bun.OOM!void {
    // When it does not resolve to a file path, there is nothing to track.
    if (specifier.len == 0) return;
    if (!std.fs.path.isAbsolute(import_source)) return;

    switch (loader) {
        .tsx, .ts, .jsx, .js => {
            if (!(bun.strings.startsWith(specifier, "./") or
                bun.strings.startsWith(specifier, "../"))) return;
        },

        // Imports in CSS can resolve to relative files without './'
        // Imports in HTML can resolve to project-relative paths by
        // prefixing with '/', but that is done in HTMLScanner.
        .css, .html => {},

        // Multiple parts of DevServer rely on the fact that these
        // loaders do not depend on importing other files.
        .file,
        .json,
        .jsonc,
        .toml,
        .yaml,
        .json5,
        .wasm,
        .napi,
        .base64,
        .dataurl,
        .text,
        .bunsh,
        .sqlite,
        .sqlite_embedded,
        => bun.debugAssert(false),
    }

    const buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(buf);
    const joined = bun.path.joinAbsStringBuf(bun.path.dirname(import_source, .auto), buf, &.{specifier}, .auto);
    const dir = bun.path.dirname(joined, .auto);

    // The `import_source` parameter is not a stable string. Since the
    // import source will be added to IncrementalGraph anyways, this is a
    // great place to share memory.
    const dev = store.owner();
    dev.graph_safety_lock.lock();
    defer dev.graph_safety_lock.unlock();
    const owned_file_path = switch (renderer) {
        .client => (try dev.client_graph.insertEmpty(import_source, .unknown)).key,
        .server, .ssr => (try dev.server_graph.insertEmpty(import_source, .unknown)).key,
    };

    store.insert(dir, owned_file_path, specifier) catch |err| switch (err) {
        error.Ignore => {}, // ignoring watch errors.
        error.OutOfMemory => |e| return e,
    };
}

/// `dir_name_to_watch` is cloned
/// `file_path` must have lifetime that outlives the watch
/// `specifier` is cloned
fn insert(
    store: *DirectoryWatchStore,
    dir_name_to_watch: []const u8,
    file_path: []const u8,
    specifier: []const u8,
) !void {
    assert(specifier.len > 0);
    // TODO: watch the parent dir too.
    const dev = store.owner();

    debug.log("DirectoryWatchStore.insert({f}, {f}, {f})", .{
        bun.fmt.quote(dir_name_to_watch),
        bun.fmt.quote(file_path),
        bun.fmt.quote(specifier),
    });

    if (store.dependencies_free_list.items.len == 0)
        try store.dependencies.ensureUnusedCapacity(dev.allocator(), 1);

    const gop = try store.watches.getOrPut(dev.allocator(), bun.strings.withoutTrailingSlashWindowsPath(dir_name_to_watch));
    const specifier_cloned = if (specifier[0] == '.' or std.fs.path.isAbsolute(specifier))
        try dev.allocator().dupe(u8, specifier)
    else
        try std.fmt.allocPrint(dev.allocator(), "./{s}", .{specifier});
    errdefer dev.allocator().free(specifier_cloned);

    if (gop.found_existing) {
        const dep = store.appendDepAssumeCapacity(.{
            .next = gop.value_ptr.first_dep.toOptional(),
            .source_file_path = file_path,
            .specifier = specifier_cloned,
        });
        gop.value_ptr.first_dep = dep;

        return;
    }
    errdefer store.watches.swapRemoveAt(gop.index);

    // Try to use an existing open directory handle
    const cache_fd = if (dev.server_transpiler.resolver.readDirInfo(dir_name_to_watch) catch null) |cache|
        cache.getFileDescriptor().unwrapValid()
    else
        null;

    const fd, const owned_fd = if (Watcher.requires_file_descriptors) if (cache_fd) |fd|
        .{ fd, false }
    else switch (bun.sys.open(
        &(std.posix.toPosixPath(dir_name_to_watch) catch |err| switch (err) {
            error.NameTooLong => return error.Ignore, // wouldn't be able to open, ignore
        }),
        // O_EVTONLY is the flag to indicate that only watches will be used.
        bun.O.DIRECTORY | bun.c.O_EVTONLY,
        0,
    )) {
        .result => |fd| .{ fd, true },
        .err => |err| switch (err.getErrno()) {
            // If this directory doesn't exist, a watcher should be placed
            // on the parent directory. Then, if this directory is later
            // created, the watcher can be properly initialized. This would
            // happen if a specifier like `./dir/whatever/hello.tsx` and
            // `dir` does not exist, Bun must place a watcher on `.`, see
            // the creation of `dir`, and repeat until it can open a watcher
            // on `whatever` to see the creation of `hello.tsx`
            .NOENT => {
                // TODO: implement that. for now it ignores (BUN-10968)
                return error.Ignore;
            },
            .NOTDIR => return error.Ignore, // ignore
            else => {
                bun.todoPanic(@src(), "log watcher error", .{});
            },
        },
    } else .{ bun.invalid_fd, false };
    errdefer if (Watcher.requires_file_descriptors) if (owned_fd) fd.close();
    if (Watcher.requires_file_descriptors)
        debug.log("-> fd: {f} ({s})", .{
            fd,
            if (owned_fd) "from dir cache" else "owned fd",
        });

    const dir_name = try dev.allocator().dupe(u8, dir_name_to_watch);
    errdefer dev.allocator().free(dir_name);

    gop.key_ptr.* = bun.strings.withoutTrailingSlashWindowsPath(dir_name);

    const watch_index = switch (dev.bun_watcher.addDirectory(fd, dir_name, bun.Watcher.getHash(dir_name), false)) {
        .err => return error.Ignore,
        .result => |id| id,
    };
    const dep = store.appendDepAssumeCapacity(.{
        .next = .none,
        .source_file_path = file_path,
        .specifier = specifier_cloned,
    });
    store.watches.putAssumeCapacity(dir_name, .{
        .dir = fd,
        .dir_fd_owned = owned_fd,
        .first_dep = dep,
        .watch_index = watch_index,
    });
}

/// Caller must detach the dependency from the linked list it is in.
pub fn freeDependencyIndex(store: *DirectoryWatchStore, alloc: Allocator, index: Dep.Index) !void {
    alloc.free(store.dependencies.items[index.get()].specifier);

    if (Environment.isDebug) {
        store.dependencies.items[index.get()] = undefined;
    }

    if (index.get() == (store.dependencies.items.len - 1)) {
        store.dependencies.items.len -= 1;
    } else {
        try store.dependencies_free_list.append(alloc, index);
    }
}

/// Expects dependency list to be already freed
pub fn freeEntry(store: *DirectoryWatchStore, alloc: Allocator, entry_index: usize) void {
    const entry = store.watches.values()[entry_index];

    debug.log("DirectoryWatchStore.freeEntry({d}, {f})", .{
        entry_index,
        entry.dir,
    });

    store.owner().bun_watcher.removeAtIndex(entry.watch_index, 0, &.{}, .file);

    defer if (entry.dir_fd_owned) entry.dir.close();

    alloc.free(store.watches.keys()[entry_index]);
    store.watches.swapRemoveAt(entry_index);

    if (store.watches.entries.len == 0) {
        assert(store.dependencies.items.len == 0);
        store.dependencies_free_list.clearRetainingCapacity();
    }
}

fn appendDepAssumeCapacity(store: *DirectoryWatchStore, dep: Dep) Dep.Index {
    if (store.dependencies_free_list.pop()) |index| {
        store.dependencies.items[index.get()] = dep;
        return index;
    }

    const index = Dep.Index.init(@intCast(store.dependencies.items.len));
    store.dependencies.appendAssumeCapacity(dep);
    return index;
}

pub const Entry = struct {
    /// The directory handle the watch is placed on
    dir: bun.FileDescriptor,
    dir_fd_owned: bool,
    /// Files which request this import index
    first_dep: Dep.Index,
    /// To pass to Watcher.remove
    watch_index: u16,
};

pub const Dep = struct {
    next: Index.Optional,
    /// The file used
    source_file_path: []const u8,
    /// The specifier that failed. Before running re-build, it is resolved for, as
    /// creating an unrelated file should not re-emit another error. Allocated memory
    specifier: []u8,

    pub const Index = bun.GenericIndex(u32, Dep);
};

const bun = @import("bun");
const Environment = bun.Environment;
const Watcher = bun.Watcher;
const assert = bun.assert;
const bake = bun.bake;

const DevServer = bake.DevServer;
const debug = DevServer.debug;

const std = @import("std");
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
