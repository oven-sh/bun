usingnamespace @import("../global.zig");
const ast = @import("../ast.zig");
const logger = @import("../logger.zig");
const options = @import("../options.zig");
const fs = @import("../fs.zig");
const std = @import("std");

pub const SideEffectsData = struct {
    source: *logger.Source,
    range: logger.Range,

    // If true, "sideEffects" was an array. If false, "sideEffects" was false.
    is_side_effects_array_in_json: bool = false,
};

pub const DirInfo = struct {
    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    parent: ?*DirInfo = null,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    enclosing_browser_scope: *?DirInfo = null,

    abs_path: string,
    entries: fs.FileSystem.DirEntry,
    has_node_modules: bool = false, // Is there a "node_modules" subdirectory?
    package_json: ?*PackageJSON, // Is there a "package.json" file?
    ts_config_json: ?*TSConfigJSON, // Is there a "tsconfig.json" file in this directory or a parent directory?
    abs_real_path: string = "", // If non-empty, this is the real absolute path resolving any symlinks

};

pub const Resolver = struct {
    opts: options.TransformOptions,
    fs: *fs.FileSystem,
    log: *logger.Log,
    allocator: *std.mem.Allocator,

    debug_logs: ?DebugLogs = null,

    // These are sets that represent various conditions for the "exports" field
    // in package.json.
    esm_conditions_default: std.StringHashMap(bool),
    esm_conditions_import: std.StringHashMap(bool),
    esm_conditions_require: std.StringHashMap(bool),

    // A special filtered import order for CSS "@import" imports.
    //
    // The "resolve extensions" setting determines the order of implicit
    // extensions to try when resolving imports with the extension omitted.
    // Sometimes people create a JavaScript/TypeScript file and a CSS file with
    // the same name when they create a component. At a high level, users expect
    // implicit extensions to resolve to the JS file when being imported from JS
    // and to resolve to the CSS file when being imported from CSS.
    //
    // Different bundlers handle this in different ways. Parcel handles this by
    // having the resolver prefer the same extension as the importing file in
    // front of the configured "resolve extensions" order. Webpack's "css-loader"
    // plugin just explicitly configures a special "resolve extensions" order
    // consisting of only ".css" for CSS files.
    //
    // It's unclear what behavior is best here. What we currently do is to create
    // a special filtered version of the configured "resolve extensions" order
    // for CSS files that filters out any extension that has been explicitly
    // configured with a non-CSS loader. This still gives users control over the
    // order but avoids the scenario where we match an import in a CSS file to a
    // JavaScript-related file. It's probably not perfect with plugins in the
    // picture but it's better than some alternatives and probably pretty good.
    // atImportExtensionOrder []string

    // This mutex serves two purposes. First of all, it guards access to "dirCache"
    // which is potentially mutated during path resolution. But this mutex is also
    // necessary for performance. The "React admin" benchmark mysteriously runs
    // twice as fast when this mutex is locked around the whole resolve operation
    // instead of around individual accesses to "dirCache". For some reason,
    // reducing parallelism in the resolver helps the rest of the bundler go
    // faster. I'm not sure why this is but please don't change this unless you
    // do a lot of testing with various benchmarks and there aren't any regressions.
    mutex: std.Thread.Mutex,

    // This cache maps a directory path to information about that directory and
    // all parent directories
    dir_cache: std.StringHashMap(?*DirInfo),

    pub const DebugLogs = struct {
        what: string = "",
        indent: MutableString,
        notes: std.ArrayList(logger.Data),

        pub fn init(allocator: *std.mem.Allocator) DebugLogs {
            return .{
                .indent = MutableString.init(allocator, 0),
                .notes = std.ArrayList(logger.Data).init(allocator),
            };
        }

        pub fn deinit(d: DebugLogs) void {
            var allocator = d.notes.allocator;
            d.notes.deinit();
            d.indent.deinit();
        }

        pub fn increaseIndent(d: *DebugLogs) !void {
            try d.indent.append(" ");
        }

        pub fn decreaseIndent(d: *DebugLogs) !void {
            d.indent.list.shrinkRetainingCapacity(d.indent.list.items.len - 1);
        }

        pub fn addNote(d: *DebugLogs, _text: string) !void {
            var text = _text;
            const len = d.indent.len();
            if (len > 0) {
                text = try d.notes.allocator.alloc(u8, text.len + d.indent.len);
                std.mem.copy(u8, text, d.indent);
                std.mem.copy(u8, text[d.indent.len..text.len], _text);
                d.notes.allocator.free(_text);
            }

            try d.notes.append(logger.rangeData(null, logger.Range.None, text));
        }
    };

    pub const PathPair = struct {
        primary: logger.Path,
        secondary: ?logger.Path = null,
    };

    pub const Result = struct {
        path_pair: PathPair,

        jsx: options.JSX.Pragma = options.JSX.Pragma{},

        // plugin_data: void
    };

    pub fn resolve(r: *Resolver, source_dir: string, import_path: string, kind: ast.ImportKind) Result {}

    fn dirInfoCached(r: *Resolver, path: string) !*DirInfo {
        // First, check the cache
        if (r.dir_cache.get(path)) |dir| {
            return dir;
        }

        const info = try r.dirInfoUncached(path);

        try r.dir_cache.put(path, info);
    }

    fn dirInfoUncached(r: *Resolver, path: string) !?*DirInfo {
        const rfs: r.fs.RealFS = r.fs.fs;
        var parent: ?*DirInfo = null;
        const parent_dir = std.fs.path.dirname(path) orelse return null;
        if (!strings.eql(parent_dir, path)) {
            parent = r.dirInfoCached(parent_dir);
        }

        // List the directories
        var _entries = try rfs.readDirectory(path);
        var entries: @TypeOf(_entries.entries) = undefined;
        if (std.meta.activeTag(_entries) == .err) {
            // Just pretend this directory is empty if we can't access it. This is the
            // case on Unix for directories that only have the execute permission bit
            // set. It means we will just pass through the empty directory and
            // continue to check the directories above it, which is now node behaves.
            switch (_entries.err) {
                fs.FileSystem.Error.EACCESS => {
                    entries = fs.FileSystem.DirEntry.empty(path, r.allocator);
                },

                // Ignore "ENOTDIR" here so that calling "ReadDirectory" on a file behaves
                // as if there is nothing there at all instead of causing an error due to
                // the directory actually being a file. This is a workaround for situations
                // where people try to import from a path containing a file as a parent
                // directory. The "pnpm" package manager generates a faulty "NODE_PATH"
                // list which contains such paths and treating them as missing means we just
                // ignore them during path resolution.
                fs.FileSystem.Error.ENOENT,
                fs.FileSystem.Error.ENOTDIR,
                => {},
                else => {
                    const pretty = r.prettyPath(fs.Path{ .text = path, .namespace = "file" });
                    r.log.addErrorFmt(
                        null,
                        logger.Loc{},
                        r.allocator,
                        "Cannot read directory \"{s}\": {s}",
                        .{
                            pretty,
                            @errorName(err),
                        },
                    );
                    return null;
                },
            }
        } else {
            entries = _entries.entries;
        }

        var info = try r.allocator.create(DirInfo);
        info.* = DirInfo{
            .abs_path = path,
            .parent = parent_dir,
            .entries = entries,
        };

        // A "node_modules" directory isn't allowed to directly contain another "node_modules" directory
        var base = std.fs.path.basename(path);
        if (!strings.eqlComptime(base, "node_modules")) {
            if (entries.get("node_modules")) |entry| {
                info.has_node_modules = entry.entry.kind(rfs) == .dir;
            }
        }

        // Propagate the browser scope into child directories
    }
};
