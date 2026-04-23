/// A logical group for a `?bundle` import in standalone mode.
///
/// Each unique `(entry_path, BundleImportConfig)` gets one BundleGroup.
/// Multiple JSBundles can share a group (e.g., when `server.ts` and
/// `worker.ts` both import the same `bundle.ts`).
///
/// See `src/bundler/BUNDLE_IMPORTS.md` for architecture principles.
const bun = @import("bun");
const ImportRecord = bun.ImportRecord;
const std = @import("std");

pub const BundleGroup = struct {
    /// Absolute path to the entry point file.
    entry_path: []const u8,
    /// Per-bundle config from import attributes.
    config: ImportRecord.BundleImportConfig,
    /// JSBundle weak references that share this group.
    consumers: std.ArrayListUnmanaged(*anyopaque),
    /// Whether this group needs a rebuild (set by file watcher).
    needs_rebuild: bool = false,
    /// Whether the initial build has completed at least once.
    built: bool = false,
    /// Whether this group's entry uses the worker HMR runtime.
    is_worker: bool,
    /// Source map generation counter.
    source_map_generation: u32 = 0,

    pub fn init(
        allocator: std.mem.Allocator,
        path: []const u8,
        config: ImportRecord.BundleImportConfig,
    ) !BundleGroup {
        return .{
            .entry_path = try allocator.dupe(u8, path),
            .config = config,
            .consumers = .{},
            .is_worker = if (config.target) |t| t == .worker else false,
        };
    }

    pub fn deinit(self: *BundleGroup, allocator: std.mem.Allocator) void {
        allocator.free(self.entry_path);
        self.consumers.deinit(allocator);
    }

    /// Check if this group matches a given (path, config) tuple.
    pub fn matches(self: *const BundleGroup, path: []const u8, config: ImportRecord.BundleImportConfig) bool {
        return bun.strings.eql(self.entry_path, path) and configEql(self.config, config);
    }

    fn configEql(a: ImportRecord.BundleImportConfig, b: ImportRecord.BundleImportConfig) bool {
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
};
