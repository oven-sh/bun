//! VM-wide cache for `with { type: "bundle" }` sub-build results.
//!
//! This is the cross-build counterpart of `BundleV2.sub_build_cache` (which
//! lives only for the duration of one top-level build). The VM-wide cache
//! lets sub-builds in different parent `BundleV2` instances reuse each
//! other's results when they share an `(absolute_path, BundleImportConfig)`
//! key.
//!
//! Concretely: when both `worker?bundle` and `some_other?bundle` contain a
//! nested `frontend?bundle` import with the same env config, the second
//! parent build skips the bundler entirely and reuses the snapshot stored
//! in this cache by the first.
//!
//! ## Memory ownership
//!
//! The cache holds a deep-copied **snapshot** of each build's outputs in
//! its own `bun.default_allocator`-owned memory, fully decoupled from any
//! BundleV2 arena. This is necessary because:
//!
//! - `OutputFile.toBlob` and `OutputFile.toJS` mutate the source by zeroing
//!   out `value` to transfer ownership to the resulting JS Blob, so we
//!   can't store live `OutputFile`s and let multiple consumers walk them.
//! - Sub-build arenas live inside the parent build's lifetime in the
//!   current code, so a sub-build snapshot must outlive the BundleV2 that
//!   produced it.
//!
//! Snapshots are reference-counted. The cache holds one reference per
//! entry; consumers receive an additional reference from `lookup` /
//! `insert` and must `deref()` when done.
//!
//! ## Thread safety
//!
//! The cache is accessed from the bundle worker thread and (in future
//! phases) potentially the JS thread. A simple mutex covers all
//! map mutation; snapshot ref counts are atomic. Mutation work that
//! doesn't need the lock (deep-copying bytes during `insert`) is done
//! outside the critical section.
//!
//! Phase 1 of the bake v2 plan. See the plan in
//! `~/.claude/plans/partitioned-dancing-koala.md` for context.

const SubBuildCache = @This();

mutex: bun.Mutex = .{},
entries: std.array_list.Managed(Entry) = std.array_list.Managed(Entry).init(bun.default_allocator),

/// One entry in the cache. The entry owns its `path` and any owned slice
/// fields inside `config`; the snapshot is reference-counted separately.
pub const Entry = struct {
    /// Owned by `bun.default_allocator`. Absolute path of the entry point.
    path: []const u8,
    /// `BundleImportConfig` with slice fields (`naming`, `env_prefix`)
    /// duplicated into `bun.default_allocator`-owned memory.
    config: ImportRecord.BundleImportConfig,
    /// Reference-counted snapshot of the build outputs.
    snapshot: *Snapshot,
};

/// Reference-counted snapshot of one sub-build's output files. Every byte
/// of every file is owned by `bun.default_allocator` and is independent of
/// any BundleV2 arena.
pub const Snapshot = struct {
    /// Atomic reference count. The cache holds one ref while the entry is
    /// alive; each consumer that gets a snapshot from `lookup`/`insert`
    /// also holds one ref and must call `deref()` when done.
    ref_count: std.atomic.Value(u32) = .{ .raw = 1 },

    /// Deep-copied output files. Each file's byte buffers are owned by
    /// `bun.default_allocator` and freed in `deinit`.
    files: []const SnapshotFile,

    /// Index in `files` of the entry-point file, if any.
    entry_point_index: ?u32,

    /// Number of "direct" files (the entry's own outputs vs files appended
    /// from nested sub-builds).
    direct_file_count: u32,

    pub fn ref(this: *Snapshot) void {
        _ = this.ref_count.fetchAdd(1, .acquire);
    }

    pub fn deref(this: *Snapshot) void {
        if (this.ref_count.fetchSub(1, .release) == 1) {
            for (this.files) |f| {
                bun.default_allocator.free(f.dest_path);
                bun.default_allocator.free(f.bytes);
                if (f.input_path.len > 0) bun.default_allocator.free(f.input_path);
            }
            bun.default_allocator.free(this.files);
            bun.destroy(this);
        }
    }

    /// Materialize a fresh slice of `OutputFile` for use by a consumer.
    /// Each returned `OutputFile` owns its own bytes via
    /// `bun.default_allocator`, so the consumer (typically a parent
    /// `BundleV2` that just got a sub-build cache hit) can mutate, deinit,
    /// and convert them via `toBlob`/`toJS` independently of other
    /// consumers and of the cached snapshot itself.
    pub fn materialize(this: *const Snapshot) ![]options.OutputFile {
        const out = try bun.default_allocator.alloc(options.OutputFile, this.files.len);
        var produced: usize = 0;
        errdefer {
            for (out[0..produced]) |*of| of.deinit();
            bun.default_allocator.free(out);
        }
        for (this.files, 0..) |f, i| {
            const bytes_copy = try bun.default_allocator.dupe(u8, f.bytes);
            errdefer bun.default_allocator.free(bytes_copy);
            const dest_copy = try bun.default_allocator.dupe(u8, f.dest_path);
            errdefer bun.default_allocator.free(dest_copy);
            const input_copy = if (f.input_path.len > 0)
                try bun.default_allocator.dupe(u8, f.input_path)
            else
                "";

            out[i] = .{
                .loader = f.loader,
                .input_loader = f.input_loader,
                .src_path = bun.fs.Path.init(input_copy),
                .dest_path = dest_copy,
                .value = .{ .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = bytes_copy,
                } },
                .size = bytes_copy.len,
                .size_without_sourcemap = f.size_without_sourcemap,
                .hash = f.hash,
                .is_executable = f.is_executable,
                .source_map_index = f.source_map_index,
                .bytecode_index = f.bytecode_index,
                .module_info_index = f.module_info_index,
                .output_kind = f.output_kind,
                .side = f.side,
                .entry_point_index = f.entry_point_index,
                .source_map_external = f.source_map_external,
            };
            produced = i + 1;
        }
        return out;
    }
};

/// One file in a `Snapshot`. Mirrors the subset of `options.OutputFile`
/// fields that are needed by sub-build consumers (the patcher in
/// `BundleV2.patchSubBuildExports` and the dest-path append loop in
/// `BundleV2.runFromJSInNewThread`).
pub const SnapshotFile = struct {
    /// Owned by `bun.default_allocator`.
    dest_path: []const u8,
    /// Owned by `bun.default_allocator`.
    bytes: []const u8,
    /// Owned by `bun.default_allocator`. Empty if there was no input path.
    input_path: []const u8 = "",

    loader: options.Loader,
    input_loader: options.Loader,
    output_kind: jsc.API.BuildArtifact.OutputKind,
    side: ?bun.bake.Side,
    is_executable: bool,
    size_without_sourcemap: usize,
    hash: u64,
    source_map_index: u32,
    bytecode_index: u32,
    module_info_index: u32,
    entry_point_index: ?u32,
    source_map_external: bool,
};

/// Look up a snapshot by `(path, config)`. On a hit, the snapshot's
/// reference count is incremented and the caller takes ownership of the
/// extra reference (must call `snap.deref()` when done).
pub fn lookup(
    this: *SubBuildCache,
    path: []const u8,
    config: ImportRecord.BundleImportConfig,
) ?*Snapshot {
    this.mutex.lock();
    defer this.mutex.unlock();
    for (this.entries.items) |entry| {
        if (bun.strings.eql(entry.path, path) and bundleConfigEql(entry.config, config)) {
            entry.snapshot.ref();
            return entry.snapshot;
        }
    }
    return null;
}

/// Insert a snapshot for `(path, config)` built from `output_files`.
/// Returns the resulting snapshot pointer with one reference for the
/// caller (in addition to the cache's own reference).
///
/// If another caller raced us to insert an entry with the same key, the
/// freshly-built snapshot is discarded and the existing one is returned
/// instead. This keeps the cache canonical.
///
/// The byte deep-copy work runs *outside* the lock to keep the critical
/// section small.
pub fn insert(
    this: *SubBuildCache,
    path: []const u8,
    config: ImportRecord.BundleImportConfig,
    output_files: []const options.OutputFile,
    entry_point_index: ?u32,
    direct_file_count: u32,
) !*Snapshot {
    // Build the snapshot outside the lock so the (potentially large) byte
    // copies don't serialize with other callers.
    var files = try bun.default_allocator.alloc(SnapshotFile, output_files.len);
    var produced: usize = 0;
    errdefer {
        for (files[0..produced]) |f| {
            bun.default_allocator.free(f.dest_path);
            bun.default_allocator.free(f.bytes);
            if (f.input_path.len > 0) bun.default_allocator.free(f.input_path);
        }
        bun.default_allocator.free(files);
    }
    for (output_files, 0..) |of, i| {
        const bytes = of.value.asSlice();
        const dest_copy = try bun.default_allocator.dupe(u8, of.dest_path);
        errdefer bun.default_allocator.free(dest_copy);
        const bytes_copy = try bun.default_allocator.dupe(u8, bytes);
        errdefer bun.default_allocator.free(bytes_copy);
        const input_copy: []const u8 = if (of.src_path.text.len > 0)
            try bun.default_allocator.dupe(u8, of.src_path.text)
        else
            "";

        files[i] = .{
            .dest_path = dest_copy,
            .bytes = bytes_copy,
            .input_path = input_copy,
            .loader = of.loader,
            .input_loader = of.input_loader,
            .output_kind = of.output_kind,
            .side = of.side,
            .is_executable = of.is_executable,
            .size_without_sourcemap = of.size_without_sourcemap,
            .hash = of.hash,
            .source_map_index = of.source_map_index,
            .bytecode_index = of.bytecode_index,
            .module_info_index = of.module_info_index,
            .entry_point_index = of.entry_point_index,
            .source_map_external = of.source_map_external,
        };
        produced = i + 1;
    }

    const snap = try bun.tryNew(Snapshot, .{
        .ref_count = .{ .raw = 1 },
        .files = files,
        .entry_point_index = entry_point_index,
        .direct_file_count = direct_file_count,
    });

    // Clone the cache key (path + slice fields of config) into our own
    // memory. The Entry is constructed below under the lock.
    const cloned_path = try bun.default_allocator.dupe(u8, path);
    errdefer bun.default_allocator.free(cloned_path);

    var cloned_config = config;
    if (config.naming) |n| {
        cloned_config.naming = try bun.default_allocator.dupe(u8, n);
    }
    errdefer if (cloned_config.naming) |n| bun.default_allocator.free(n);
    if (config.env_prefix) |p| {
        cloned_config.env_prefix = try bun.default_allocator.dupe(u8, p);
    }
    errdefer if (cloned_config.env_prefix) |p| bun.default_allocator.free(p);

    this.mutex.lock();
    defer this.mutex.unlock();

    // Race check: another caller may have inserted while we were copying.
    // Prefer the existing entry to keep the cache canonical.
    for (this.entries.items) |entry| {
        if (bun.strings.eql(entry.path, path) and bundleConfigEql(entry.config, config)) {
            // Drop our locally-built copies; return the existing entry's
            // snapshot with an extra ref for the caller.
            bun.default_allocator.free(cloned_path);
            if (cloned_config.naming) |n| bun.default_allocator.free(n);
            if (cloned_config.env_prefix) |p| bun.default_allocator.free(p);
            snap.deref();
            entry.snapshot.ref();
            return entry.snapshot;
        }
    }

    // No race — install our entry. Bump refcount so both the cache and the
    // returning caller hold a reference.
    snap.ref();
    try this.entries.append(.{
        .path = cloned_path,
        .config = cloned_config,
        .snapshot = snap,
    });
    return snap;
}

/// Free all entries and the underlying spine. Called from
/// `VirtualMachine.deinit`.
pub fn deinit(this: *SubBuildCache) void {
    this.mutex.lock();
    defer this.mutex.unlock();
    for (this.entries.items) |entry| {
        bun.default_allocator.free(entry.path);
        if (entry.config.naming) |n| bun.default_allocator.free(n);
        if (entry.config.env_prefix) |p| bun.default_allocator.free(p);
        entry.snapshot.deref();
    }
    this.entries.deinit();
}

/// Equality of two `BundleImportConfig` values. Slice fields are compared
/// by content; `std.meta.eql` would only compare slice headers, which
/// would mistakenly treat two equal strings at different addresses as
/// different.
fn bundleConfigEql(
    a: ImportRecord.BundleImportConfig,
    b: ImportRecord.BundleImportConfig,
) bool {
    if (!std.meta.eql(a.splitting, b.splitting)) return false;
    if (!std.meta.eql(a.minify, b.minify)) return false;
    if (!std.meta.eql(a.sourcemap, b.sourcemap)) return false;
    if (!std.meta.eql(a.target, b.target)) return false;
    if (!std.meta.eql(a.format, b.format)) return false;
    if (!std.meta.eql(a.env_behavior, b.env_behavior)) return false;
    if ((a.naming == null) != (b.naming == null)) return false;
    if (a.naming) |an| if (!bun.strings.eql(an, b.naming.?)) return false;
    if ((a.env_prefix == null) != (b.env_prefix == null)) return false;
    if (a.env_prefix) |ap| if (!bun.strings.eql(ap, b.env_prefix.?)) return false;
    return true;
}

const std = @import("std");

const bun = @import("bun");
const ImportRecord = bun.ImportRecord;
const options = bun.options;
const jsc = bun.jsc;
