usingnamespace @import("../global.zig");
const ast = @import("../import_record.zig");
const logger = @import("../logger.zig");
const options = @import("../options.zig");
const Fs = @import("../fs.zig");
const std = @import("std");
const cache = @import("../cache.zig");
const sync = @import("../sync.zig");
const TSConfigJSON = @import("./tsconfig_json.zig").TSConfigJSON;
const PackageJSON = @import("./package_json.zig").PackageJSON;
usingnamespace @import("./data_url.zig");

const Wyhash = std.hash.Wyhash;

const hash_map_v2 = @import("../hash_map_v2.zig");
const Mutex = sync.Mutex;
const StringBoolMap = std.StringHashMap(bool);

const allocators = @import("../allocators.zig");

const Path = Fs.Path;

pub const SideEffectsData = struct {
    source: *logger.Source,
    range: logger.Range,

    // If true, "sideEffects" was an array. If false, "sideEffects" was false.
    is_side_effects_array_in_json: bool = false,
};

pub const DirInfo = struct {
    pub const Index = allocators.IndexType;

    // These objects are immutable, so we can just point to the parent directory
    // and avoid having to lock the cache again
    parent: Index = allocators.NotFound,

    // A pointer to the enclosing dirInfo with a valid "browser" field in
    // package.json. We need this to remap paths after they have been resolved.
    enclosing_browser_scope: Index = allocators.NotFound,

    abs_path: string = "",
    entries: Index = undefined,
    has_node_modules: bool = false, // Is there a "node_modules" subdirectory?
    package_json: ?*PackageJSON = null, // Is there a "package.json" file?
    tsconfig_json: ?*TSConfigJSON = null, // Is there a "tsconfig.json" file in this directory or a parent directory?
    abs_real_path: string = "", // If non-empty, this is the real absolute path resolving any symlinks

    pub fn getFileDescriptor(dirinfo: *const DirInfo) StoredFileDescriptorType {
        if (!FeatureFlags.store_file_descriptors) {
            return 0;
        }

        if (dirinfo.getEntries()) |entries| {
            return entries.fd;
        } else {
            return 0;
        }
    }

    pub fn getEntries(dirinfo: *const DirInfo) ?*Fs.FileSystem.DirEntry {
        var entries_ptr = Fs.FileSystem.instance.fs.entries.atIndex(dirinfo.entries) orelse return null;
        switch (entries_ptr.*) {
            .entries => |entr| {
                return &entries_ptr.entries;
            },
            .err => {
                return null;
            },
        }
    }

    pub fn getParent(i: *const DirInfo) ?*DirInfo {
        return HashMap.instance.atIndex(i.parent);
    }
    pub fn getEnclosingBrowserScope(i: *const DirInfo) ?*DirInfo {
        return HashMap.instance.atIndex(i.enclosing_browser_scope);
    }

    // Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
    // 1. Don't store the keys or values of directories that don't exist
    // 2. Don't expect a provided key to exist after it's queried
    // 3. Store whether a directory has been queried and whether that query was successful.
    // 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
    pub const HashMap = allocators.BSSMap(DirInfo, Fs.Preallocate.Counts.dir_entry, false, 128);
};
pub const TemporaryBuffer = struct {
    pub threadlocal var ExtensionPathBuf = std.mem.zeroes([512]u8);
    pub threadlocal var TSConfigMatchStarBuf = std.mem.zeroes([512]u8);
    pub threadlocal var TSConfigMatchPathBuf = std.mem.zeroes([512]u8);
    pub threadlocal var TSConfigMatchFullBuf = std.mem.zeroes([512]u8);
};

pub const PathPair = struct {
    primary: Path,
    secondary: ?Path = null,

    pub const Iter = struct {
        index: u2,
        ctx: *PathPair,
        pub fn next(i: *Iter) ?Path {
            const ind = i.index;
            i.index += 1;

            switch (ind) {
                0 => return i.ctx.primary,
                1 => return i.ctx.secondary,
                else => return null,
            }
        }
    };

    pub fn iter(p: *PathPair) Iter {
        return Iter{ .ctx = p, .index = 0 };
    }
};

pub const Result = struct {
    path_pair: PathPair,

    jsx: options.JSX.Pragma = options.JSX.Pragma{},

    package_json_version: ?string = null,

    is_external: bool = false,

    // This is true when the package was loaded from within the node_modules directory.
    is_from_node_modules: bool = false,

    diff_case: ?Fs.FileSystem.Entry.Lookup.DifferentCase = null,

    // If present, any ES6 imports to this file can be considered to have no side
    // effects. This means they should be removed if unused.
    primary_side_effects_data: ?SideEffectsData = null,

    // If true, the class field transform should use Object.defineProperty().
    use_define_for_class_fields_ts: ?bool = null,

    // If true, unused imports are retained in TypeScript code. This matches the
    // behavior of the "importsNotUsedAsValues" field in "tsconfig.json" when the
    // value is not "remove".
    preserve_unused_imports_ts: bool = false,

    // This is the "type" field from "package.json"
    module_type: options.ModuleType = options.ModuleType.unknown,

    debug_meta: ?DebugMeta = null,

    dirname_fd: StoredFileDescriptorType = 0,
    file_fd: StoredFileDescriptorType = 0,

    // Most NPM modules are CommonJS
    // If unspecified, assume CommonJS.
    // If internal app code, assume ESM.
    pub fn shouldAssumeCommonJS(r: *const Result, import_record: *const ast.ImportRecord) bool {
        if (import_record.kind == .require or import_record.kind == .require_resolve or r.module_type == .cjs) {
            return true;
        }

        if (r.module_type == .esm) {
            return false;
        }

        return r.is_from_node_modules;
    }

    pub const DebugMeta = struct {
        notes: std.ArrayList(logger.Data),
        suggestion_text: string = "",
        suggestion_message: string = "",

        pub fn init(allocator: *std.mem.Allocator) DebugMeta {
            return DebugMeta{ .notes = std.ArrayList(logger.Data).init(allocator) };
        }

        pub fn logErrorMsg(m: *DebugMeta, log: *logger.Log, _source: ?*const logger.Source, r: logger.Range, comptime fmt: string, args: anytype) !void {
            if (_source != null and m.suggestion_message.len > 0) {
                const data = logger.rangeData(_source.?, r, m.suggestion_message);
                data.location.?.suggestion = m.suggestion_text;
                try m.notes.append(data);
            }

            try log.addMsg(Msg{
                .kind = .err,
                .data = logger.rangeData(_source, r, std.fmt.allocPrint(m.notes.allocator, fmt, args)),
                .notes = m.toOwnedSlice(),
            });
        }
    };
};

pub const DirEntryResolveQueueItem = struct { result: allocators.Result, unsafe_path: string };
threadlocal var _dir_entry_paths_to_resolve: [256]DirEntryResolveQueueItem = undefined;
threadlocal var _open_dirs: [256]std.fs.Dir = undefined;

threadlocal var tsconfig_base_url_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

pub const DebugLogs = struct {
    what: string = "",
    indent: MutableString,
    notes: std.ArrayList(logger.Data),

    pub const FlushMode = enum { fail, success };

    pub fn init(allocator: *std.mem.Allocator) !DebugLogs {
        var mutable = try MutableString.init(allocator, 0);
        return DebugLogs{
            .indent = mutable,
            .notes = std.ArrayList(logger.Data).init(allocator),
        };
    }

    pub fn deinit(d: DebugLogs) void {
        var allocator = d.notes.allocator;
        d.notes.deinit();
        // d.indent.deinit();
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
            var __text = try d.notes.allocator.alloc(u8, text.len + len);
            std.mem.copy(u8, __text, d.indent.list.items);
            std.mem.copy(u8, __text[len..__text.len], _text);
            d.notes.allocator.free(_text);
        }

        try d.notes.append(logger.rangeData(null, logger.Range.None, text));
    }

    pub fn addNoteFmt(d: *DebugLogs, comptime fmt: string, args: anytype) !void {
        return try d.addNote(try std.fmt.allocPrint(d.notes.allocator, fmt, args));
    }
};

pub const TSConfigExtender = struct {
    visited: *StringBoolMap,
    file_dir: string,
    r: *ThisResolver,

    pub fn extends(ctx: *TSConfigExtender, extends: String, range: logger.Range) ?*TSConfigJSON {
        Global.notimpl();
        // if (isPackagePath(extends)) {
        //     // // If this is a package path, try to resolve it to a "node_modules"
        //     // // folder. This doesn't use the normal node module resolution algorithm
        //     // // both because it's different (e.g. we don't want to match a directory)
        //     // // and because it would deadlock since we're currently in the middle of
        //     // // populating the directory info cache.
        //     // var current = ctx.file_dir;
        //     // while (true) {
        //     //     // Skip "node_modules" folders
        //     //     if (!strings.eql(std.fs.path.basename(current), "node_modules")) {
        //     //         var paths1 = [_]string{ current, "node_modules", extends };
        //     //         var join1 = r.fs.absAlloc(ctx.r.allocator, &paths1) catch unreachable;
        //     //         const res = ctx.r.parseTSConfig(join1, ctx.1) catch |err| {
        //     //             if (err == error.ENOENT) {
        //     //                 continue;
        //     //             } else if (err == error.ParseErrorImportCycle) {} else if (err != error.ParseErrorAlreadyLogged) {}
        //     //             return null;
        //     //         };
        //     //         return res;

        //     //     }
        //     // }
        // }
    }
};

pub const MatchResult = struct {
    path_pair: PathPair,
    dirname_fd: StoredFileDescriptorType = 0,
    file_fd: StoredFileDescriptorType = 0,
    is_node_module: bool = false,
    package_json_version: ?string = null,
    diff_case: ?Fs.FileSystem.Entry.Lookup.DifferentCase = null,
};

pub const LoadResult = struct {
    path: string,
    diff_case: ?Fs.FileSystem.Entry.Lookup.DifferentCase,
    dirname_fd: StoredFileDescriptorType = 0,
};

// TODO:
// - Fix "browser" field mapping
// - Consider removing the string list abstraction?
pub fn NewResolver(cache_files: bool) type {
    const CacheSet = if (cache_files) cache.Cache.Set else cache.ServeCache.Set;

    return struct {
        const ThisResolver = @This();
        opts: options.BundleOptions,
        fs: *Fs.FileSystem,
        log: *logger.Log,
        allocator: *std.mem.Allocator,

        debug_logs: ?DebugLogs = null,
        elapsed: i128 = 0, // tracing

        caches: CacheSet,

        // These are sets that represent various conditions for the "exports" field
        // in package.json.
        // esm_conditions_default: std.StringHashMap(bool),
        // esm_conditions_import: std.StringHashMap(bool),
        // esm_conditions_require: std.StringHashMap(bool),

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
        mutex: Mutex,

        // This cache maps a directory path to information about that directory and
        // all parent directories
        dir_cache: *DirInfo.HashMap,

        pub fn init1(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            _fs: *Fs.FileSystem,
            opts: options.BundleOptions,
        ) ThisResolver {
            return ThisResolver{
                .allocator = allocator,
                .dir_cache = DirInfo.HashMap.init(allocator),
                .mutex = Mutex.init(),
                .caches = CacheSet.init(allocator),
                .opts = opts,
                .fs = _fs,
                .log = log,
            };
        }

        pub fn isExternalPattern(r: *ThisResolver, import_path: string) bool {
            for (r.opts.external.patterns) |pattern| {
                if (import_path.len >= pattern.prefix.len + pattern.suffix.len and (strings.startsWith(
                    import_path,
                    pattern.prefix,
                ) and strings.endsWith(
                    import_path,
                    pattern.suffix,
                ))) {
                    return true;
                }
            }
            return false;
        }

        pub fn flushDebugLogs(r: *ThisResolver, flush_mode: DebugLogs.FlushMode) !void {
            if (r.debug_logs) |*debug| {
                defer {
                    debug.deinit();
                    r.debug_logs = null;
                }

                if (flush_mode == DebugLogs.FlushMode.fail) {
                    try r.log.addRangeDebugWithNotes(null, logger.Range{ .loc = logger.Loc{} }, debug.what, debug.notes.toOwnedSlice());
                } else if (@enumToInt(r.log.level) <= @enumToInt(logger.Log.Level.verbose)) {
                    try r.log.addVerboseWithNotes(null, logger.Loc.Empty, debug.what, debug.notes.toOwnedSlice());
                }
            }
        }
        var tracing_start: i128 = if (FeatureFlags.tracing) 0 else undefined;

        threadlocal var relative_abs_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        pub fn resolve(r: *ThisResolver, source_dir: string, import_path: string, kind: ast.ImportKind) !Result {
            if (FeatureFlags.tracing) {
                tracing_start = std.time.nanoTimestamp();
            }
            defer {
                if (FeatureFlags.tracing) {
                    r.elapsed += std.time.nanoTimestamp() - tracing_start;
                }
            }
            if (r.log.level == .verbose) {
                if (r.debug_logs != null) {
                    r.debug_logs.?.deinit();
                }

                r.debug_logs = try DebugLogs.init(r.allocator);
            }

            // Certain types of URLs default to being external for convenience
            if (r.isExternalPattern(import_path) or
                // "fill: url(#filter);"
                (kind.isFromCSS() and strings.startsWith(import_path, "#")) or

                // "background: url(http://example.com/images/image.png);"
                strings.startsWith(import_path, "http://") or

                // "background: url(https://example.com/images/image.png);"
                strings.startsWith(import_path, "https://") or

                // "background: url(//example.com/images/image.png);"
                strings.startsWith(import_path, "//"))
            {
                if (r.debug_logs) |*debug| {
                    try debug.addNote("Marking this path as implicitly external");
                }
                r.flushDebugLogs(.success) catch {};
                return Result{
                    .path_pair = PathPair{
                        .primary = Path.init(import_path),
                    },
                    .is_external = true,
                    .module_type = .esm,
                };
            }

            if (DataURL.parse(import_path)) |_data_url| {
                const data_url: DataURL = _data_url;
                // "import 'data:text/javascript,console.log(123)';"
                // "@import 'data:text/css,body{background:white}';"
                if (data_url.decode_mime_type() != .Unsupported) {
                    if (r.debug_logs) |*debug| {
                        debug.addNote("Putting this path in the \"dataurl\" namespace") catch {};
                    }
                    r.flushDebugLogs(.success) catch {};
                    return Result{ .path_pair = PathPair{ .primary = Path.initWithNamespace(import_path, "dataurl") } };
                }

                // "background: url(data:image/png;base64,iVBORw0KGgo=);"
                if (r.debug_logs) |*debug| {
                    debug.addNote("Marking this \"dataurl\" as external") catch {};
                }
                r.flushDebugLogs(.success) catch {};
                return Result{
                    .path_pair = PathPair{ .primary = Path.initWithNamespace(import_path, "dataurl") },
                    .is_external = true,
                };
            }

            // Fail now if there is no directory to resolve in. This can happen for
            // virtual modules (e.g. stdin) if a resolve directory is not specified.
            if (source_dir.len == 0) {
                if (r.debug_logs) |*debug| {
                    debug.addNote("Cannot resolve this path without a directory") catch {};
                }
                r.flushDebugLogs(.fail) catch {};
                return error.MissingResolveDir;
            }

            r.mutex.lock();
            defer r.mutex.unlock();

            var result = try r.resolveWithoutSymlinks(source_dir, import_path, kind);

            return result orelse error.ModuleNotFound;
        }

        pub fn resolveWithoutSymlinks(r: *ThisResolver, source_dir: string, import_path: string, kind: ast.ImportKind) !?Result {
            // This implements the module resolution algorithm from node.js, which is
            // described here: https://nodejs.org/api/modules.html#modules_all_together
            var result: Result = Result{ .path_pair = PathPair{ .primary = Path.init("") } };

            // Return early if this is already an absolute path. In addition to asking
            // the file system whether this is an absolute path, we also explicitly check
            // whether it starts with a "/" and consider that an absolute path too. This
            // is because relative paths can technically start with a "/" on Windows
            // because it's not an absolute path on Windows. Then people might write code
            // with imports that start with a "/" that works fine on Windows only to
            // experience unexpected build failures later on other operating systems.
            // Treating these paths as absolute paths on all platforms means Windows
            // users will not be able to accidentally make use of these paths.
            if (strings.startsWith(import_path, "/") or std.fs.path.isAbsolutePosix(import_path)) {
                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("The import \"{s}\" is being treated as an absolute path", .{import_path}) catch {};
                }

                // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
                if ((r.dirInfoCached(source_dir) catch null)) |_dir_info| {
                    const dir_info: *DirInfo = _dir_info;
                    if (dir_info.tsconfig_json) |tsconfig| {
                        if (tsconfig.paths.count() > 0) {
                            if (r.matchTSConfigPaths(tsconfig, import_path, kind)) |res| {
                                return Result{
                                    .path_pair = res.path_pair,
                                    .diff_case = res.diff_case,
                                    .dirname_fd = dir_info.getFileDescriptor(),
                                    .is_from_node_modules = res.is_node_module,
                                };
                            }
                        }
                    }
                }

                if (r.opts.external.abs_paths.count() > 0 and r.opts.external.abs_paths.exists(import_path)) {
                    // If the string literal in the source text is an absolute path and has
                    // been marked as an external module, mark it as *not* an absolute path.
                    // That way we preserve the literal text in the output and don't generate
                    // a relative path from the output directory to that path.
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("The path \"{s}\" is marked as external by the user", .{import_path}) catch {};
                    }

                    return Result{
                        .path_pair = .{ .primary = Path.init(import_path) },
                        .is_external = true,
                    };
                }

                // Run node's resolution rules (e.g. adding ".js")
                if (r.loadAsFileOrDirectory(import_path, kind)) |entry| {
                    return Result{
                        .dirname_fd = entry.dirname_fd,
                        .path_pair = entry.path_pair,
                        .diff_case = entry.diff_case,
                        .is_from_node_modules = entry.is_node_module,
                    };
                }

                return null;
            }

            // Check both relative and package paths for CSS URL tokens, with relative
            // paths taking precedence over package paths to match Webpack behavior.
            const is_package_path = isPackagePath(import_path);
            var check_relative = !is_package_path or kind == .url;
            var check_package = is_package_path;

            if (check_relative) {
                const parts = [_]string{ source_dir, import_path };
                const abs_path = r.fs.absBuf(&parts, &relative_abs_path_buf);

                if (r.opts.external.abs_paths.count() > 0 and r.opts.external.abs_paths.exists(abs_path)) {
                    // If the string literal in the source text is an absolute path and has
                    // been marked as an external module, mark it as *not* an absolute path.
                    // That way we preserve the literal text in the output and don't generate
                    // a relative path from the output directory to that path.
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("The path \"{s}\" is marked as external by the user", .{abs_path}) catch {};
                    }

                    return Result{
                        .path_pair = .{ .primary = Path.init(r.fs.filename_store.append(abs_path) catch unreachable) },
                        .is_external = true,
                    };
                }

                // Check the "browser" map for the first time (1 out of 2)
                if (r.dirInfoCached(std.fs.path.dirname(abs_path) orelse unreachable) catch null) |_import_dir_info| {
                    if (_import_dir_info.getEnclosingBrowserScope()) |import_dir_info| {
                        if (import_dir_info.package_json) |pkg| {
                            const pkg_json_dir = std.fs.path.dirname(pkg.source.key_path.text) orelse unreachable;

                            const rel_path = r.fs.relative(pkg_json_dir, abs_path);
                            if (r.checkBrowserMap(pkg, rel_path)) |remap| {
                                // Is the path disabled?
                                if (remap.len == 0) {
                                    var _path = Path.init(r.fs.filename_store.append(abs_path) catch unreachable);
                                    _path.is_disabled = true;
                                    return Result{
                                        .path_pair = PathPair{
                                            .primary = _path,
                                        },
                                    };
                                }

                                if (r.resolveWithoutRemapping(import_dir_info, remap, kind)) |_result| {
                                    result = Result{
                                        .path_pair = _result.path_pair,
                                        .diff_case = _result.diff_case,
                                        .is_from_node_modules = _result.is_node_module,
                                        .module_type = pkg.module_type,
                                        .dirname_fd = _result.dirname_fd,
                                        .package_json_version = pkg.version,
                                    };
                                    check_relative = false;
                                    check_package = false;
                                }
                            }
                        }
                    }
                }

                if (check_relative) {
                    if (r.loadAsFileOrDirectory(abs_path, kind)) |res| {
                        check_package = false;
                        result = Result{
                            .path_pair = res.path_pair,
                            .diff_case = res.diff_case,
                            .is_from_node_modules = res.is_node_module,
                            .dirname_fd = res.dirname_fd,
                            .package_json_version = res.package_json_version,
                        };
                    } else if (!check_package) {
                        return null;
                    }
                }
            }

            if (check_package) {
                // Check for external packages first
                if (r.opts.external.node_modules.count() > 0) {
                    var query = import_path;
                    while (true) {
                        if (r.opts.external.node_modules.exists(query)) {
                            if (r.debug_logs) |*debug| {
                                debug.addNoteFmt("The path \"{s}\" was marked as external by the user", .{query}) catch {};
                            }
                            return Result{
                                .path_pair = .{ .primary = Path.init(query) },
                                .is_external = true,
                            };
                        }

                        // If the module "foo" has been marked as external, we also want to treat
                        // paths into that module such as "foo/bar" as external too.
                        var slash = strings.lastIndexOfChar(query, '/') orelse break;
                        query = query[0..slash];
                    }
                }

                const source_dir_info = (r.dirInfoCached(source_dir) catch null) orelse return null;

                // Support remapping one package path to another via the "browser" field
                if (source_dir_info.getEnclosingBrowserScope()) |browser_scope| {
                    if (browser_scope.package_json) |package_json| {
                        if (r.checkBrowserMap(package_json, import_path)) |remapped| {
                            if (remapped.len == 0) {
                                // "browser": {"module": false}
                                if (r.loadNodeModules(import_path, kind, source_dir_info)) |node_module| {
                                    var pair = node_module.path_pair;
                                    pair.primary.is_disabled = true;
                                    if (pair.secondary != null) {
                                        pair.secondary.?.is_disabled = true;
                                    }
                                    return Result{
                                        .path_pair = pair,
                                        .dirname_fd = node_module.dirname_fd,
                                        .diff_case = node_module.diff_case,
                                        .is_from_node_modules = true,
                                        .package_json_version = package_json.version,
                                    };
                                }
                            } else {
                                var primary = Path.init(import_path);
                                primary.is_disabled = true;
                                return Result{
                                    .path_pair = PathPair{ .primary = primary },
                                    // this might not be null? i think it is
                                    .diff_case = null,
                                };
                            }
                        }
                    }
                }

                if (r.resolveWithoutRemapping(source_dir_info, import_path, kind)) |res| {
                    result = Result{
                        .path_pair = res.path_pair,
                        .diff_case = res.diff_case,
                        .is_from_node_modules = res.is_node_module,
                        .dirname_fd = res.dirname_fd,
                        .package_json_version = res.package_json_version,
                    };
                } else {
                    // Note: node's "self references" are not currently supported
                    return null;
                }
            }

            var iter = result.path_pair.iter();
            while (iter.next()) |*path| {
                const dirname = std.fs.path.dirname(path.text) orelse continue;
                const base_dir_info = ((r.dirInfoCached(dirname) catch null)) orelse continue;
                const dir_info = base_dir_info.getEnclosingBrowserScope() orelse continue;
                const pkg_json = dir_info.package_json orelse continue;
                const rel_path = r.fs.relative(pkg_json.source.key_path.text, path.text);
                result.module_type = pkg_json.module_type;
                result.package_json_version = if (result.package_json_version == null) pkg_json.version else result.package_json_version;
                if (r.checkBrowserMap(pkg_json, rel_path)) |remapped| {
                    if (remapped.len == 0) {
                        path.is_disabled = true;
                    } else if (r.resolveWithoutRemapping(dir_info, remapped, kind)) |remapped_result| {
                        result.is_from_node_modules = remapped_result.is_node_module;

                        switch (iter.index) {
                            0 => {
                                result.path_pair.primary = remapped_result.path_pair.primary;
                                result.dirname_fd = remapped_result.dirname_fd;
                            },
                            else => {
                                result.path_pair.secondary = remapped_result.path_pair.primary;
                            },
                        }
                    }
                }
            }

            return result;
        }

        pub fn loadNodeModules(r: *ThisResolver, import_path: string, kind: ast.ImportKind, _dir_info: *DirInfo) ?MatchResult {
            var res = _loadNodeModules(r, import_path, kind, _dir_info) orelse return null;
            res.is_node_module = true;
            return res;
        }

        threadlocal var load_as_file_or_directory_via_tsconfig_base_path: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        pub fn _loadNodeModules(r: *ThisResolver, import_path: string, kind: ast.ImportKind, _dir_info: *DirInfo) ?MatchResult {
            var dir_info = _dir_info;
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Searching for {s} in \"node_modules\" directories starting from \"{s}\"", .{ import_path, dir_info.abs_path }) catch {};
                debug.increaseIndent() catch {};
            }

            defer {
                if (r.debug_logs) |*debug| {
                    debug.decreaseIndent() catch {};
                }
            }

            // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file

            if (dir_info.tsconfig_json) |tsconfig| {
                // Try path substitutions first
                if (tsconfig.paths.count() > 0) {
                    if (r.matchTSConfigPaths(tsconfig, import_path, kind)) |res| {
                        return res;
                    }
                }

                // Try looking up the path relative to the base URL
                if (tsconfig.hasBaseURL()) {
                    const base = tsconfig.base_url;
                    const paths = [_]string{ base, import_path };
                    const abs = r.fs.absBuf(&paths, &load_as_file_or_directory_via_tsconfig_base_path);

                    if (r.loadAsFileOrDirectory(abs, kind)) |res| {
                        return res;
                    }
                    // r.allocator.free(abs);
                }
            }

            // Then check for the package in any enclosing "node_modules" directories
            while (true) {
                // Skip directories that are themselves called "node_modules", since we
                // don't ever want to search for "node_modules/node_modules"
                if (dir_info.has_node_modules) {
                    var _paths = [_]string{ dir_info.abs_path, "node_modules", import_path };
                    const abs_path = r.fs.abs(&_paths);
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Checking for a package in the directory \"{s}\"", .{abs_path}) catch {};
                    }

                    // TODO: esm "exports" field goes here!!! Here!!

                    if (r.loadAsFileOrDirectory(abs_path, kind)) |res| {
                        return res;
                    }
                    // r.allocator.free(abs_path);
                }

                dir_info = dir_info.getParent() orelse break;
            }

            // Mostly to cut scope, we don't resolve `NODE_PATH` environment variable.
            // But also: https://github.com/nodejs/node/issues/38128#issuecomment-814969356

            return null;
        }

        threadlocal var resolve_without_remapping_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        pub fn resolveWithoutRemapping(r: *ThisResolver, source_dir_info: *DirInfo, import_path: string, kind: ast.ImportKind) ?MatchResult {
            if (isPackagePath(import_path)) {
                return r.loadNodeModules(import_path, kind, source_dir_info);
            } else {
                const paths = [_]string{ source_dir_info.abs_path, import_path };
                var resolved = r.fs.absBuf(&paths, &resolve_without_remapping_buf);
                return r.loadAsFileOrDirectory(resolved, kind);
            }
        }

        pub fn parseTSConfig(
            r: *ThisResolver,
            file: string,
            dirname_fd: StoredFileDescriptorType,
        ) !?*TSConfigJSON {
            const entry = try r.caches.fs.readFile(
                r.fs,
                file,
                dirname_fd,
                false,
            );
            const key_path = Path.init(file);

            const source = logger.Source.initPathString(key_path.text, entry.contents);
            const file_dir = std.fs.path.dirname(file) orelse return null;

            var result = (try TSConfigJSON.parse(r.allocator, r.log, source, @TypeOf(r.caches.json), &r.caches.json)) orelse return null;

            if (result.hasBaseURL()) {
                // this might leak
                if (!std.fs.path.isAbsolute(result.base_url)) {
                    const paths = [_]string{ file_dir, result.base_url };
                    result.base_url = r.fs.filename_store.append(r.fs.absBuf(&paths, &tsconfig_base_url_buf)) catch unreachable;
                }
            }

            if (result.paths.count() > 0 and (result.base_url_for_paths.len == 0 or !std.fs.path.isAbsolute(result.base_url_for_paths))) {
                // this might leak
                const paths = [_]string{ file_dir, result.base_url };
                result.base_url_for_paths = r.fs.filename_store.append(r.fs.absBuf(&paths, &tsconfig_base_url_buf)) catch unreachable;
            }

            return result;
        }

        // TODO:
        pub fn prettyPath(r: *ThisResolver, path: Path) string {
            return path.text;
        }

        pub fn parsePackageJSON(r: *ThisResolver, file: string, dirname_fd: StoredFileDescriptorType) !?*PackageJSON {
            const pkg = PackageJSON.parse(ThisResolver, r, file, dirname_fd) orelse return null;
            var _pkg = try r.allocator.create(PackageJSON);
            _pkg.* = pkg;
            return _pkg;
        }

        pub fn isPackagePath(path: string) bool {
            // this could probably be flattened into something more optimized
            return path[0] != '/' and !strings.startsWith(path, "./") and !strings.startsWith(path, "../") and !strings.eql(path, ".") and !strings.eql(path, "..");
        }

        fn dirInfoCached(r: *ThisResolver, path: string) !?*DirInfo {
            const top_result = try r.dir_cache.getOrPut(path);
            if (top_result.status != .unknown) {
                return r.dir_cache.atIndex(top_result.index);
            }

            var i: i32 = 1;
            _dir_entry_paths_to_resolve[0] = (DirEntryResolveQueueItem{ .result = top_result, .unsafe_path = path });
            var top = path;
            var top_parent: allocators.Result = allocators.Result{
                .index = allocators.NotFound,
                .hash = 0,
                .status = .not_found,
            };
            const root_path = if (isWindows) std.fs.path.diskDesignator(path) else "/";

            while (std.fs.path.dirname(top)) |_top| {
                var result = try r.dir_cache.getOrPut(_top);
                if (result.status != .unknown) {
                    top_parent = result;
                    break;
                }
                _dir_entry_paths_to_resolve[@intCast(usize, i)] = DirEntryResolveQueueItem{
                    .unsafe_path = _top,
                    .result = result,
                };
                i += 1;
                top = _top;
            }

            if (std.fs.path.dirname(top) == null and !strings.eql(top, root_path)) {
                var result = try r.dir_cache.getOrPut(root_path);
                if (result.status != .unknown) {
                    top_parent = result;
                } else {
                    _dir_entry_paths_to_resolve[@intCast(usize, i)] = DirEntryResolveQueueItem{
                        .unsafe_path = root_path,
                        .result = result,
                    };
                    i += 1;
                    top = root_path;
                }
            }

            var queue_slice: []DirEntryResolveQueueItem = _dir_entry_paths_to_resolve[0..@intCast(usize, i)];
            std.debug.assert(queue_slice.len > 0);
            var open_dir_count: usize = 0;

            // When this function halts, any item not processed means it's not found.
            defer {

                // Anything
                if (open_dir_count > 0 and r.fs.fs.needToCloseFiles()) {
                    var open_dirs: []std.fs.Dir = _open_dirs[0..open_dir_count];
                    for (open_dirs) |*open_dir| {
                        open_dir.close();
                    }
                }
            }

            var rfs: *Fs.FileSystem.RealFS = &r.fs.fs;

            rfs.entries_mutex.lock();
            defer rfs.entries_mutex.unlock();

            // We want to walk in a straight line from the topmost directory to the desired directory
            // For each directory we visit, we get the entries, but not traverse into child directories
            // (unless those child directores are in the queue)
            // Going top-down rather than bottom-up should have best performance because we can use
            // the file handle from the parent directory to open the child directory
            // It's important that we walk in precisely a straight line
            // For example
            // "/home/jarred/Code/node_modules/react/cjs/react.development.js"
            //       ^
            // If we start there, we will traverse all of /home/jarred, including e.g. /home/jarred/Downloads
            // which is completely irrelevant.

            // After much experimentation, fts_open is not the fastest way. fts actually just uses readdir!!
            var _safe_path: ?string = null;

            // Start at the top.
            while (queue_slice.len > 0) {
                var queue_top = queue_slice[queue_slice.len - 1];
                defer top_parent = queue_top.result;
                queue_slice.len -= 1;

                var _open_dir: anyerror!std.fs.Dir = undefined;
                if (open_dir_count > 0) {
                    _open_dir = _open_dirs[open_dir_count - 1].openDir(std.fs.path.basename(queue_top.unsafe_path), .{ .iterate = true });
                } else {
                    _open_dir = std.fs.openDirAbsolute(queue_top.unsafe_path, .{ .iterate = true });
                }

                const open_dir = _open_dir catch |err| {
                    switch (err) {
                        error.EACCESS => {},

                        // Ignore "ENOTDIR" here so that calling "ReadDirectory" on a file behaves
                        // as if there is nothing there at all instead of causing an error due to
                        // the directory actually being a file. This is a workaround for situations
                        // where people try to import from a path containing a file as a parent
                        // directory. The "pnpm" package manager generates a faulty "NODE_PATH"
                        // list which contains such paths and treating them as missing means we just
                        // ignore them during path resolution.
                        error.ENOENT,
                        error.ENOTDIR,
                        error.IsDir,
                        error.NotDir,
                        error.FileNotFound,
                        => {
                            return null;
                        },

                        else => {
                            var cached_dir_entry_result = rfs.entries.getOrPut(queue_top.unsafe_path) catch unreachable;
                            r.dir_cache.markNotFound(queue_top.result);
                            rfs.entries.markNotFound(cached_dir_entry_result);
                            const pretty = r.prettyPath(Path.init(queue_top.unsafe_path));

                            r.log.addErrorFmt(
                                null,
                                logger.Loc{},
                                r.allocator,
                                "Cannot read directory \"{s}\": {s}",
                                .{
                                    pretty,
                                    @errorName(err),
                                },
                            ) catch {};
                        },
                    }

                    return null;
                };
                Fs.FileSystem.setMaxFd(open_dir.fd);
                // these objects mostly just wrap the file descriptor, so it's fine to keep it.
                _open_dirs[open_dir_count] = open_dir;
                open_dir_count += 1;

                if (_safe_path == null) {
                    // Now that we've opened the topmost directory successfully, it's reasonable to store the slice.
                    _safe_path = try r.fs.dirname_store.append(path);
                }
                const safe_path = _safe_path.?;

                var dir_path_i = std.mem.indexOf(u8, safe_path, queue_top.unsafe_path) orelse unreachable;
                const dir_path = safe_path[dir_path_i .. dir_path_i + queue_top.unsafe_path.len];

                var dir_iterator = open_dir.iterate();

                var cached_dir_entry_result = rfs.entries.getOrPut(dir_path) catch unreachable;

                var dir_entries_option: *Fs.FileSystem.RealFS.EntriesOption = undefined;
                var has_dir_entry_result: bool = false;

                if (rfs.entries.atIndex(cached_dir_entry_result.index)) |cached_entry| {
                    if (std.meta.activeTag(cached_entry.*) == .entries) {
                        dir_entries_option = cached_entry;
                    }
                }

                if (!has_dir_entry_result) {
                    dir_entries_option = try rfs.entries.put(&cached_dir_entry_result, .{
                        .entries = Fs.FileSystem.DirEntry.init(dir_path, r.fs.allocator),
                    });

                    if (FeatureFlags.store_file_descriptors) {
                        Fs.FileSystem.setMaxFd(open_dir.fd);
                        dir_entries_option.entries.fd = open_dir.fd;
                    }

                    has_dir_entry_result = true;
                }

                while (try dir_iterator.next()) |_value| {
                    const value: std.fs.Dir.Entry = _value;
                    dir_entries_option.entries.addEntry(value) catch unreachable;
                }

                const dir_info = try r.dirInfoUncached(
                    dir_path,
                    dir_entries_option,
                    queue_top.result,
                    cached_dir_entry_result.index,
                    r.dir_cache.atIndex(top_parent.index),
                    top_parent.index,
                    open_dir.fd,
                );

                var dir_info_ptr = try r.dir_cache.put(&queue_top.result, dir_info);

                if (queue_slice.len == 0) {
                    return dir_info_ptr;

                    // Is the directory we're searching for actually a file?
                } else if (queue_slice.len == 1) {
                    // const next_in_queue = queue_slice[0];
                    // const next_basename = std.fs.path.basename(next_in_queue.unsafe_path);
                    // if (dir_info_ptr.getEntries()) |entries| {
                    //     if (entries.get(next_basename) != null) {
                    //         return null;
                    //     }
                    // }
                }
            }

            unreachable;
        }

        // This closely follows the behavior of "tryLoadModuleUsingPaths()" in the
        // official TypeScript compiler
        pub fn matchTSConfigPaths(r: *ThisResolver, tsconfig: *TSConfigJSON, path: string, kind: ast.ImportKind) ?MatchResult {
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Matching \"{s}\" against \"paths\" in \"{s}\"", .{ path, tsconfig.abs_path }) catch unreachable;
            }

            var abs_base_url = tsconfig.base_url_for_paths;

            // The explicit base URL should take precedence over the implicit base URL
            // if present. This matters when a tsconfig.json file overrides "baseUrl"
            // from another extended tsconfig.json file but doesn't override "paths".
            if (tsconfig.hasBaseURL()) {
                abs_base_url = tsconfig.base_url;
            }

            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Using \"{s}\" as \"baseURL\"", .{abs_base_url}) catch unreachable;
            }

            // Check for exact matches first
            {
                var iter = tsconfig.paths.iterator();
                while (iter.next()) |entry| {
                    const key = entry.key;

                    if (strings.eql(key, path)) {
                        for (entry.value) |original_path| {
                            var absolute_original_path = original_path;
                            var was_alloc = false;

                            if (!std.fs.path.isAbsolute(absolute_original_path)) {
                                const parts = [_]string{ abs_base_url, original_path };
                                absolute_original_path = r.fs.absAlloc(r.allocator, &parts) catch unreachable;
                                was_alloc = true;
                            }

                            if (r.loadAsFileOrDirectory(absolute_original_path, kind)) |res| {
                                return res;
                            } else if (was_alloc) {
                                r.allocator.free(absolute_original_path);
                            }
                        }

                        return null;
                    }
                }
            }

            const TSConfigMatch = struct {
                prefix: string,
                suffix: string,
                original_paths: []string,
            };

            var longest_match: TSConfigMatch = undefined;
            var longest_match_prefix_length: i32 = -1;
            var longest_match_suffix_length: i32 = -1;

            var iter = tsconfig.paths.iterator();
            while (iter.next()) |entry| {
                const key = entry.key;
                const original_paths = entry.value;

                if (strings.indexOfChar(key, '*')) |star_index| {
                    const prefix = key[0..star_index];
                    const suffix = key[star_index..key.len];

                    // Find the match with the longest prefix. If two matches have the same
                    // prefix length, pick the one with the longest suffix. This second edge
                    // case isn't handled by the TypeScript compiler, but we handle it
                    // because we want the output to always be deterministic and Go map
                    // iteration order is deliberately non-deterministic.
                    if (strings.startsWith(path, prefix) and strings.endsWith(path, suffix) and (prefix.len > longest_match_prefix_length or (prefix.len == longest_match_prefix_length and suffix.len > longest_match_suffix_length))) {
                        longest_match_prefix_length = @intCast(i32, prefix.len);
                        longest_match_suffix_length = @intCast(i32, suffix.len);
                        longest_match = TSConfigMatch{ .prefix = prefix, .suffix = suffix, .original_paths = original_paths };
                    }
                }
            }

            // If there is at least one match, only consider the one with the longest
            // prefix. This matches the behavior of the TypeScript compiler.
            if (longest_match_prefix_length > -1) {
                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Found a fuzzy match for \"{s}*{s}\" in \"paths\"", .{ longest_match.prefix, longest_match.suffix }) catch unreachable;
                }

                for (longest_match.original_paths) |original_path| {
                    // Swap out the "*" in the original path for whatever the "*" matched
                    const matched_text = path[longest_match.prefix.len .. path.len - longest_match.suffix.len];

                    std.mem.copy(
                        u8,
                        &TemporaryBuffer.TSConfigMatchPathBuf,
                        original_path,
                    );
                    var start: usize = 0;
                    var total_length: usize = 0;
                    const star = std.mem.indexOfScalar(u8, original_path, '*') orelse unreachable;
                    total_length = star;
                    std.mem.copy(u8, &TemporaryBuffer.TSConfigMatchPathBuf, original_path[0..total_length]);
                    start = total_length;
                    total_length += matched_text.len;
                    std.mem.copy(u8, TemporaryBuffer.TSConfigMatchPathBuf[start..total_length], matched_text);
                    start = total_length;

                    total_length += original_path.len - star + 1; // this might be an off by one.
                    std.mem.copy(u8, TemporaryBuffer.TSConfigMatchPathBuf[start..TemporaryBuffer.TSConfigMatchPathBuf.len], original_path[star..original_path.len]);
                    const region = TemporaryBuffer.TSConfigMatchPathBuf[0..total_length];

                    // Load the original path relative to the "baseUrl" from tsconfig.json
                    var absolute_original_path: string = region;

                    var did_allocate = false;
                    if (!std.fs.path.isAbsolute(region)) {
                        var paths = [_]string{ abs_base_url, original_path };
                        absolute_original_path = r.fs.absAlloc(r.allocator, &paths) catch unreachable;
                        did_allocate = true;
                    } else {
                        absolute_original_path = std.mem.dupe(r.allocator, u8, region) catch unreachable;
                    }

                    if (r.loadAsFileOrDirectory(absolute_original_path, kind)) |res| {
                        return res;
                    }
                }
            }

            return null;
        }

        pub fn checkBrowserMap(r: *ThisResolver, pkg: *PackageJSON, input_path: string) ?string {
            // Normalize the path so we can compare against it without getting confused by "./"
            var cleaned = r.fs.normalize(input_path);
            const original_cleaned = cleaned;

            if (cleaned.len == 1 and cleaned[0] == '.') {
                // No bundler supports remapping ".", so we don't either
                return null;
            }

            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Checking for \"{s}\" in the \"browser\" map in \"{s}\"", .{ input_path, pkg.source.path.text }) catch {};
            }

            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Checking for \"{s}\" ", .{cleaned}) catch {};
            }
            var remapped = pkg.browser_map.get(cleaned);
            if (remapped == null) {
                for (r.opts.extension_order) |ext| {
                    std.mem.copy(u8, &TemporaryBuffer.ExtensionPathBuf, cleaned);
                    std.mem.copy(u8, TemporaryBuffer.ExtensionPathBuf[cleaned.len .. cleaned.len + ext.len], ext);
                    const new_path = TemporaryBuffer.ExtensionPathBuf[0 .. cleaned.len + ext.len];
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Checking for \"{s}\" ", .{new_path}) catch {};
                    }
                    if (pkg.browser_map.get(new_path)) |_remapped| {
                        remapped = _remapped;
                        cleaned = new_path;
                        break;
                    }
                }
            }

            if (remapped) |remap| {
                // "" == disabled, {"browser": { "file.js": false }}
                if (remap.len == 0 or (remap.len == 1 and remap[0] == '.')) {
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Found \"{s}\" marked as disabled", .{remap}) catch {};
                    }
                    return remap;
                }

                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Found \"{s}\" remapped to \"{s}\"", .{ original_cleaned, remap }) catch {};
                }

                // Only allocate on successful remapping.
                return r.allocator.dupe(u8, remap) catch unreachable;
            }

            return null;
        }

        pub fn loadFromMainField(r: *ThisResolver, path: string, dir_info: *DirInfo, _field_rel_path: string, field: string, extension_order: []const string) ?MatchResult {
            var field_rel_path = _field_rel_path;
            // Is this a directory?
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Found main field \"{s}\" with path \"{s}\"", .{ field, field_rel_path }) catch {};
                debug.increaseIndent() catch {};
            }

            defer {
                if (r.debug_logs) |*debug| {
                    debug.decreaseIndent() catch {};
                }
            }

            // Potentially remap using the "browser" field
            if (dir_info.getEnclosingBrowserScope()) |browser_scope| {
                if (browser_scope.package_json) |browser_json| {
                    if (r.checkBrowserMap(browser_json, field_rel_path)) |remap| {
                        // Is the path disabled?
                        if (remap.len == 0) {
                            const paths = [_]string{ path, field_rel_path };
                            const new_path = r.fs.absAlloc(r.allocator, &paths) catch unreachable;
                            var _path = Path.init(new_path);
                            _path.is_disabled = true;
                            return MatchResult{
                                .path_pair = PathPair{
                                    .primary = _path,
                                },
                                .package_json_version = browser_json.version,
                            };
                        }

                        field_rel_path = remap;
                    }
                }
            }
            const _paths = [_]string{ field_rel_path, path };
            const field_abs_path = r.fs.absAlloc(r.allocator, &_paths) catch unreachable;

            const field_dir_info = (r.dirInfoCached(field_abs_path) catch null) orelse {
                r.allocator.free(field_abs_path);
                return null;
            };

            return r.loadAsIndexWithBrowserRemapping(field_dir_info, field_abs_path, extension_order) orelse {
                r.allocator.free(field_abs_path);
                return null;
            };
        }

        pub fn loadAsIndex(r: *ThisResolver, dir_info: *DirInfo, path: string, extension_order: []const string) ?MatchResult {
            var rfs = &r.fs.fs;
            // Try the "index" file with extensions
            for (extension_order) |ext| {
                var base = TemporaryBuffer.ExtensionPathBuf[0 .. "index".len + ext.len];
                base[0.."index".len].* = "index".*;
                std.mem.copy(u8, base["index".len..base.len], ext);

                if (dir_info.getEntries()) |entries| {
                    if (entries.get(base)) |lookup| {
                        if (lookup.entry.kind(rfs) == .file) {
                            const parts = [_]string{ path, base };
                            const out_buf = r.fs.absAlloc(r.allocator, &parts) catch unreachable;
                            if (r.debug_logs) |*debug| {
                                debug.addNoteFmt("Found file: \"{s}\"", .{out_buf}) catch unreachable;
                            }

                            return MatchResult{
                                .path_pair = .{ .primary = Path.init(out_buf) },
                                .diff_case = lookup.diff_case,
                                .dirname_fd = dir_info.getFileDescriptor(),
                            };
                        }
                    }
                }

                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Failed to find file: \"{s}/{s}\"", .{ path, base }) catch unreachable;
                }
            }

            return null;
        }

        pub fn loadAsIndexWithBrowserRemapping(r: *ThisResolver, dir_info: *DirInfo, path: string, extension_order: []const string) ?MatchResult {
            if (dir_info.getEnclosingBrowserScope()) |browser_scope| {
                const field_rel_path = comptime "index";
                if (browser_scope.package_json) |browser_json| {
                    if (r.checkBrowserMap(browser_json, field_rel_path)) |remap| {
                        // Is the path disabled?
                        // This doesn't really make sense to me.
                        if (remap.len == 0) {
                            const paths = [_]string{ path, field_rel_path };
                            const new_path = r.fs.absAlloc(r.allocator, &paths) catch unreachable;
                            var _path = Path.init(new_path);
                            _path.is_disabled = true;
                            return MatchResult{
                                .path_pair = PathPair{
                                    .primary = _path,
                                },
                                .package_json_version = browser_json.version,
                            };
                        }

                        const new_paths = [_]string{ path, remap };
                        const remapped_abs = r.fs.absAlloc(r.allocator, &new_paths) catch unreachable;

                        // Is this a file
                        if (r.loadAsFile(remapped_abs, extension_order)) |file_result| {
                            return MatchResult{ .dirname_fd = file_result.dirname_fd, .path_pair = .{ .primary = Path.init(file_result.path) }, .diff_case = file_result.diff_case };
                        }

                        // Is it a directory with an index?
                        if (r.dirInfoCached(remapped_abs) catch null) |new_dir| {
                            if (r.loadAsIndex(new_dir, remapped_abs, extension_order)) |absolute| {
                                return absolute;
                            }
                        }

                        return null;
                    }
                }
            }

            return r.loadAsIndex(dir_info, path, extension_order);
        }

        pub fn loadAsFileOrDirectory(r: *ThisResolver, path: string, kind: ast.ImportKind) ?MatchResult {
            const extension_order = r.opts.extension_order;

            // Is this a file?
            if (r.loadAsFile(path, extension_order)) |file| {
                return MatchResult{
                    .path_pair = .{ .primary = Path.init(file.path) },
                    .diff_case = file.diff_case,
                    .dirname_fd = file.dirname_fd,
                };
            }

            // Is this a directory?
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Attempting to load \"{s}\" as a directory", .{path}) catch {};
                debug.increaseIndent() catch {};
            }
            defer {
                if (r.debug_logs) |*debug| {
                    debug.decreaseIndent() catch {};
                }
            }

            const dir_info = (r.dirInfoCached(path) catch null) orelse return null;
            var package_json_version: ?string = null;

            // Try using the main field(s) from "package.json"
            if (dir_info.package_json) |pkg_json| {
                package_json_version = pkg_json.version;
                if (pkg_json.main_fields.count() > 0) {
                    const main_field_values = pkg_json.main_fields;
                    const main_field_keys = r.opts.main_fields;
                    // TODO: check this works right. Not sure this will really work.
                    const auto_main = r.opts.main_fields.ptr == options.Platform.DefaultMainFields.get(r.opts.platform).ptr;

                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Searching for main fields in \"{s}\"", .{pkg_json.source.path.text}) catch {};
                    }

                    for (main_field_keys) |key| {
                        const field_rel_path = (main_field_values.get(key)) orelse {
                            if (r.debug_logs) |*debug| {
                                debug.addNoteFmt("Did not find main field \"{s}\"", .{key}) catch {};
                            }
                            continue;
                        };

                        var _result = r.loadFromMainField(path, dir_info, field_rel_path, key, extension_order) orelse continue;

                        // If the user did not manually configure a "main" field order, then
                        // use a special per-module automatic algorithm to decide whether to
                        // use "module" or "main" based on whether the package is imported
                        // using "import" or "require".
                        if (auto_main and strings.eqlComptime(key, "module")) {
                            var absolute_result: ?MatchResult = null;

                            if (main_field_values.get("main")) |main_rel_path| {
                                if (main_rel_path.len > 0) {
                                    absolute_result = r.loadFromMainField(path, dir_info, main_rel_path, "main", extension_order);
                                }
                            } else {
                                // Some packages have a "module" field without a "main" field but
                                // still have an implicit "index.js" file. In that case, treat that
                                // as the value for "main".
                                absolute_result = r.loadAsIndexWithBrowserRemapping(dir_info, path, extension_order);
                            }

                            if (absolute_result) |auto_main_result| {
                                // If both the "main" and "module" fields exist, use "main" if the
                                // path is for "require" and "module" if the path is for "import".
                                // If we're using "module", return enough information to be able to
                                // fall back to "main" later if something ended up using "require()"
                                // with this same path. The goal of this code is to avoid having
                                // both the "module" file and the "main" file in the bundle at the
                                // same time.
                                if (kind != ast.ImportKind.require) {
                                    if (r.debug_logs) |*debug| {
                                        debug.addNoteFmt("Resolved to \"{s}\" using the \"module\" field in \"{s}\"", .{ auto_main_result.path_pair.primary.text, pkg_json.source.key_path.text }) catch {};

                                        debug.addNoteFmt("The fallback path in case of \"require\" is {s}", .{auto_main_result.path_pair.primary.text}) catch {};
                                    }

                                    return MatchResult{
                                        .path_pair = .{
                                            .primary = auto_main_result.path_pair.primary,
                                            .secondary = _result.path_pair.primary,
                                        },
                                        .diff_case = auto_main_result.diff_case,
                                        .dirname_fd = auto_main_result.dirname_fd,
                                        .package_json_version = pkg_json.version,
                                    };
                                } else {
                                    if (r.debug_logs) |*debug| {
                                        debug.addNoteFmt("Resolved to \"{s}\" using the \"{s}\" field in \"{s}\"", .{
                                            auto_main_result.path_pair.primary.text,
                                            key,
                                            pkg_json.source.key_path.text,
                                        }) catch {};
                                    }
                                    var _auto_main_result = auto_main_result;
                                    _auto_main_result.package_json_version = pkg_json.version;
                                    return _auto_main_result;
                                }
                            }
                        }
                    }
                }
            }

            // Look for an "index" file with known extensions
            if (r.loadAsIndexWithBrowserRemapping(dir_info, path, extension_order)) |*res| {
                if (res.package_json_version == null and package_json_version != null) {
                    res.package_json_version = package_json_version;
                }
                return res.*;
            }

            return null;
        }

        pub fn loadAsFile(r: *ThisResolver, path: string, extension_order: []const string) ?LoadResult {
            var rfs: *Fs.FileSystem.RealFS = &r.fs.fs;

            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Attempting to load \"{s}\" as a file", .{path}) catch {};
                debug.increaseIndent() catch {};
            }
            defer {
                if (r.debug_logs) |*debug| {
                    debug.decreaseIndent() catch {};
                }
            }

            const dir_path = std.fs.path.dirname(path) orelse "/";

            const dir_entry: *Fs.FileSystem.RealFS.EntriesOption = rfs.readDirectory(dir_path, null, false) catch {
                return null;
            };

            if (@as(Fs.FileSystem.RealFS.EntriesOption.Tag, dir_entry.*) == .err) {
                if (dir_entry.err.original_err != error.ENOENT) {
                    r.log.addErrorFmt(
                        null,
                        logger.Loc.Empty,
                        r.allocator,
                        "Cannot read directory \"{s}\": {s}",
                        .{
                            r.prettyPath(Path.init(dir_path)),
                            @errorName(dir_entry.err.original_err),
                        },
                    ) catch {};
                }
                return null;
            }

            const entries = dir_entry.entries;

            const base = std.fs.path.basename(path);

            // Try the plain path without any extensions
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Checking for file \"{s}\" ", .{base}) catch {};
            }

            if (entries.get(base)) |query| {
                if (query.entry.kind(rfs) == .file) {
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Found file \"{s}\" ", .{base}) catch {};
                    }
                    const abs_path_parts = [_]string{ query.entry.dir, query.entry.base };
                    const abs_path = r.fs.filename_store.append(r.fs.joinBuf(&abs_path_parts, &TemporaryBuffer.ExtensionPathBuf)) catch unreachable;

                    return LoadResult{
                        .path = abs_path,
                        .diff_case = query.diff_case,
                        .dirname_fd = entries.fd,
                    };
                }
            }

            // Try the path with extensions

            std.mem.copy(u8, &TemporaryBuffer.ExtensionPathBuf, path);
            for (r.opts.extension_order) |ext| {
                var buffer = TemporaryBuffer.ExtensionPathBuf[0 .. path.len + ext.len];
                std.mem.copy(u8, buffer[path.len..buffer.len], ext);
                const file_name = buffer[path.len - base.len .. buffer.len];

                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Checking for file \"{s}{s}\" ", .{ base, ext }) catch {};
                }

                if (entries.get(file_name)) |query| {
                    if (query.entry.kind(rfs) == .file) {
                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Found file \"{s}\" ", .{buffer}) catch {};
                        }

                        // now that we've found it, we allocate it.
                        return LoadResult{
                            .path = r.fs.filename_store.append(buffer) catch unreachable,
                            .diff_case = query.diff_case,
                            .dirname_fd = entries.fd,
                        };
                    }
                }
            }

            // TypeScript-specific behavior: if the extension is ".js" or ".jsx", try
            // replacing it with ".ts" or ".tsx". At the time of writing this specific
            // behavior comes from the function "loadModuleFromFile()" in the file
            // "moduleNameThisResolver.ts" in the TypeScript compiler source code. It
            // contains this comment:
            //
            //   If that didn't work, try stripping a ".js" or ".jsx" extension and
            //   replacing it with a TypeScript one; e.g. "./foo.js" can be matched
            //   by "./foo.ts" or "./foo.d.ts"
            //
            // We don't care about ".d.ts" files because we can't do anything with
            // those, so we ignore that part of the behavior.
            //
            // See the discussion here for more historical context:
            // https://github.com/microsoft/TypeScript/issues/4595
            if (strings.lastIndexOfChar(base, '.')) |last_dot| {
                const ext = base[last_dot..base.len];
                if (strings.eql(ext, ".js") or strings.eql(ext, ".jsx")) {
                    const segment = base[0..last_dot];
                    std.mem.copy(u8, &TemporaryBuffer.ExtensionPathBuf, segment);

                    const exts = comptime [_]string{ ".ts", ".tsx" };

                    for (exts) |ext_to_replace| {
                        var buffer = TemporaryBuffer.ExtensionPathBuf[0 .. segment.len + ext_to_replace.len];
                        std.mem.copy(u8, buffer[segment.len..buffer.len], ext_to_replace);

                        if (entries.get(buffer)) |query| {
                            if (query.entry.kind(rfs) == .file) {
                                if (r.debug_logs) |*debug| {
                                    debug.addNoteFmt("Rewrote to \"{s}\" ", .{buffer}) catch {};
                                }

                                return LoadResult{
                                    .path = r.fs.filename_store.append(buffer) catch unreachable,
                                    .diff_case = query.diff_case,
                                    .dirname_fd = entries.fd,
                                };
                            }
                        }
                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Failed to rewrite \"{s}\" ", .{base}) catch {};
                        }
                    }
                }
            }

            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Failed to find \"{s}\" ", .{path}) catch {};
            }
            return null;
        }

        threadlocal var dir_info_uncached_filename_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        fn dirInfoUncached(
            r: *ThisResolver,
            path: string,
            _entries: *Fs.FileSystem.RealFS.EntriesOption,
            _result: allocators.Result,
            dir_entry_index: allocators.IndexType,
            parent: ?*DirInfo,
            parent_index: allocators.IndexType,
            fd: FileDescriptorType,
        ) anyerror!DirInfo {
            var result = _result;

            var rfs: *Fs.FileSystem.RealFS = &r.fs.fs;
            var entries = _entries.entries;

            var info = DirInfo{
                .abs_path = path,
                .parent = parent_index,
                .entries = dir_entry_index,
            };

            // A "node_modules" directory isn't allowed to directly contain another "node_modules" directory
            var base = std.fs.path.basename(path);
            // if (entries != null) {
            if (!strings.eqlComptime(base, "node_modules")) {
                if (entries.getComptimeQuery("node_modules")) |entry| {
                    // the catch might be wrong!
                    info.has_node_modules = (entry.entry.kind(rfs)) == .dir;
                }
            }
            // }

            if (parent != null) {

                // Propagate the browser scope into child directories
                info.enclosing_browser_scope = parent.?.enclosing_browser_scope;

                // Make sure "absRealPath" is the real path of the directory (resolving any symlinks)
                if (!r.opts.preserve_symlinks) {
                    if (parent.?.getEntries()) |parent_entries| {
                        if (parent_entries.get(base)) |lookup| {
                            const entry = lookup.entry;

                            var symlink = entry.symlink(rfs);
                            if (symlink.len > 0) {
                                if (r.debug_logs) |*logs| {
                                    try logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved symlink \"{s}\" to \"{s}\"", .{ path, symlink }) catch unreachable);
                                }
                                info.abs_real_path = symlink;
                            } else if (parent.?.abs_real_path.len > 0) {
                                // this might leak a little i'm not sure
                                const parts = [_]string{ parent.?.abs_real_path, base };
                                symlink = r.fs.filename_store.append(r.fs.joinBuf(&parts, &dir_info_uncached_filename_buf)) catch unreachable;

                                if (r.debug_logs) |*logs| {
                                    try logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved symlink \"{s}\" to \"{s}\"", .{ path, symlink }) catch unreachable);
                                }
                                info.abs_real_path = symlink;
                            }
                        }
                    }
                }
            }

            // Record if this directory has a package.json file
            if (entries.getComptimeQuery("package.json")) |lookup| {
                const entry = lookup.entry;
                if (entry.kind(rfs) == .file) {
                    info.package_json = r.parsePackageJSON(path, if (FeatureFlags.store_file_descriptors) fd else 0) catch null;

                    if (info.package_json) |pkg| {
                        if (pkg.browser_map.count() > 0) {
                            info.enclosing_browser_scope = result.index;
                        }

                        if (r.debug_logs) |*logs| {
                            logs.addNoteFmt("Resolved package.json in \"{s}\"", .{
                                path,
                            }) catch unreachable;
                        }
                    }
                }
            }

            // Record if this directory has a tsconfig.json or jsconfig.json file
            {
                var tsconfig_path: ?string = null;
                if (r.opts.tsconfig_override == null) {
                    if (entries.getComptimeQuery("tsconfig.json")) |lookup| {
                        const entry = lookup.entry;
                        if (entry.kind(rfs) == .file) {
                            const parts = [_]string{ path, "tsconfig.json" };

                            tsconfig_path = r.fs.absBuf(&parts, &dir_info_uncached_filename_buf);
                        }
                    }
                    if (tsconfig_path == null) {
                        if (entries.getComptimeQuery("jsconfig.json")) |lookup| {
                            const entry = lookup.entry;
                            if (entry.kind(rfs) == .file) {
                                const parts = [_]string{ path, "jsconfig.json" };
                                tsconfig_path = r.fs.absBuf(&parts, &dir_info_uncached_filename_buf);
                            }
                        }
                    }
                } else if (parent == null) {
                    tsconfig_path = r.opts.tsconfig_override.?;
                }

                if (tsconfig_path) |tsconfigpath| {
                    info.tsconfig_json = r.parseTSConfig(
                        tsconfigpath,
                        if (FeatureFlags.store_file_descriptors) fd else 0,
                    ) catch |err| brk: {
                        const pretty = r.prettyPath(Path.init(tsconfigpath));

                        if (err == error.ENOENT) {
                            r.log.addErrorFmt(null, logger.Loc.Empty, r.allocator, "Cannot find tsconfig file \"{s}\"", .{pretty}) catch unreachable;
                        } else if (err != error.ParseErrorAlreadyLogged and err != error.IsDir) {
                            r.log.addErrorFmt(null, logger.Loc.Empty, r.allocator, "Cannot read file \"{s}\": {s}", .{ pretty, @errorName(err) }) catch unreachable;
                        }
                        break :brk null;
                    };
                }
            }

            if (info.tsconfig_json == null and parent != null) {
                info.tsconfig_json = parent.?.tsconfig_json;
            }

            return info;
        }
    };
}

pub const Resolver = NewResolver(true);
pub const ResolverUncached = NewResolver(false);
