usingnamespace @import("../global.zig");
const ast = @import("../ast.zig");
const logger = @import("../logger.zig");
const options = @import("../options.zig");
const fs = @import("../fs.zig");
const std = @import("std");
const cache = @import("../cache.zig");

const TSConfigJSON = @import("./tsconfig_json.zig").TSConfigJSON;
const PackageJSON = @import("./package_json.zig").PackageJSON;
usingnamespace @import("./data_url.zig");

const StringBoolMap = std.StringHashMap(bool);

const Path = fs.Path;
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

    caches: cache.Cache.Set,

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
    mutex: std.Thread.Mutex,

    // This cache maps a directory path to information about that directory and
    // all parent directories
    dir_cache: std.StringHashMap(?*DirInfo),

    pub const DebugLogs = struct {
        what: string = "",
        indent: MutableString,
        notes: std.ArrayList(logger.Data),

        pub const FlushMode = enum { fail, success };

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

        pub fn addNoteFmt(d: *DebugLogs, comptime fmt: string, args: anytype) !void {
            return try d.addNote(try std.fmt.allocPrint(d.notes.allocator, fmt, args));
        }
    };

    pub const PathPair = struct {
        primary: Path,
        secondary: ?Path = null,
    };

    pub const Result = struct {
        path_pair: PathPair,

        jsx: options.JSX.Pragma = options.JSX.Pragma{},

        is_external: bool = false,

        different_case: ?fs.FileSystem.Entry.Lookup.DifferentCase = null,

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
        module_type: options.ModuleType,

        debug_meta: ?DebugMeta = null,

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

    pub fn isExternalPattern(r: *Resolver, import_path: string) bool {
        Global.notimpl();
    }

    pub fn flushDebugLogs(r: *Resolver, flush_mode: DebugLogs.FlushMode) !void {
        if (r.debug_logs) |debug| {
            defer {
                debug.deinit();
                r.debug_logs = null;
            }

            if (mode == .failure) {
                try r.log.addRangeDebugWithNotes(null, .empty, debug.what, debug.notes.toOwnedSlice());
            } else if (@enumToInt(r.log.level) <= @enumToInt(logger.Log.Level.verbose)) {
                try r.log.addVerboseWithNotes(null, .empty, debug.what, debug.notes.toOwnedSlice());
            }
        }
    }

    pub fn resolve(r: *Resolver, source_dir: string, import_path: string, kind: ast.ImportKind) !?Result {
        if (r.log.level == .verbose) {
            if (r.debug_logs != null) {
                r.debug_logs.?.deinit();
            }

            r.debug_logs = DebugLogs.init(r.allocator);
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
            if (r.debug_logs) |debug| {
                try debug.addNote("Marking this path as implicitly external");
            }
            r.flushDebugLogs(.success) catch {};
            return Result{ .path_pair = PathPair{
                .primary = Path{ .text = import_path },
                .is_external = true,
            } };
        }

        if (DataURL.parse(import_path) catch null) |_data_url| {
            const data_url: DataURL = _data_url;
            // "import 'data:text/javascript,console.log(123)';"
            // "@import 'data:text/css,body{background:white}';"
            if (data_url.decode_mime_type() != .Unsupported) {
                if (r.debug_logs) |debug| {
                    debug.addNote("Putting this path in the \"dataurl\" namespace") catch {};
                }
                r.flushDebugLogs(.success) catch {};
                return Resolver.Result{ .path_pair = PathPair{ .primary = Path{ .text = import_path, .namespace = "dataurl" } } };
            }

            // "background: url(data:image/png;base64,iVBORw0KGgo=);"
            if (r.debug_logs) |debug| {
                debug.addNote("Marking this \"dataurl\" as external") catch {};
            }
            r.flushDebugLogs(.success) catch {};
            return Resolver.Result{
                .path_pair = PathPair{ .primary = Path{ .text = import_path, .namespace = "dataurl" } },
                .is_external = true,
            };
        }

        // Fail now if there is no directory to resolve in. This can happen for
        // virtual modules (e.g. stdin) if a resolve directory is not specified.
        if (source_dir.len == 0) {
            if (r.debug_logs) |debug| {
                debug.addNote("Cannot resolve this path without a directory") catch {};
            }
            r.flushDebugLogs(.fail) catch {};
            return null;
        }

        const hold = r.mutex.acquire();
        defer hold.release();
    }

    pub fn resolveWithoutSymlinks(r: *Resolver, source_dir: string, import_path: string, kind: ast.ImportKind) !Result {
        // This implements the module resolution algorithm from node.js, which is
        // described here: https://nodejs.org/api/modules.html#modules_all_together
        var result: Result = undefined;

        // Return early if this is already an absolute path. In addition to asking
        // the file system whether this is an absolute path, we also explicitly check
        // whether it starts with a "/" and consider that an absolute path too. This
        // is because relative paths can technically start with a "/" on Windows
        // because it's not an absolute path on Windows. Then people might write code
        // with imports that start with a "/" that works fine on Windows only to
        // experience unexpected build failures later on other operating systems.
        // Treating these paths as absolute paths on all platforms means Windows
        // users will not be able to accidentally make use of these paths.
        if (striongs.startsWith(import_path, "/") or std.fs.path.isAbsolutePosix(import_path)) {
            if (r.debug_logs) |debug| {
                debug.addNoteFmt("The import \"{s}\" is being treated as an absolute path", .{import_path}) catch {};
            }

            // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
            if (try r.dirInfoCached(source_dir)) |_dir_info| {
                const dir_info: *DirInfo = _dir_info;
                if (dir_info.ts_config_json) |tsconfig| {
                    if (tsconfig.paths.size() > 0) {
                        const res = r.matchTSConfigPaths(tsconfig, import_path, kind);
                        return Result{ .path_pair = res.path_pair, .diff_case = res.diff_case };
                    }
                }
            }

            
        }
    }

    pub const TSConfigExtender = struct {
        visited: *StringBoolMap,
        file_dir: string,
        r: *Resolver,

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
            //     //         var join1 = std.fs.path.join(ctx.r.allocator, &paths1) catch unreachable;
            //     //         const res = ctx.r.parseTSConfig(join1, ctx.visited) catch |err| {
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

    pub fn parseTSConfig(r: *Resolver, file: string, visited: *StringBoolMap) !?*TSConfigJSON {
        if (visited.contains(file)) {
            return error.ParseErrorImportCycle;
        }
        visited.put(file, true) catch unreachable;
        const entry = try r.caches.fs.readFile(r.fs, file);
        const key_path = Path.init(file);

        const source = logger.Source{
            .key_path = key_path,
            .pretty_path = r.prettyPath(key_path),
            .contents = entry.contents,
        };
        const file_dir = std.fs.path.dirname(file);

        var result = try TSConfigJSON.parse(r.allocator, r.log, r.opts, r.caches.json) orelse return null;

        if (result.base_url) |base| {
            // this might leak
            if (!std.fs.path.isAbsolute(base)) {
                var paths = [_]string{ file_dir, base };
                result.base_url = std.fs.path.join(r.allocator, paths) catch unreachable;
            }
        }

        if (result.paths.count() > 0 and (result.base_url_for_paths.len == 0 or !std.fs.path.isAbsolute(result.base_url_for_paths))) {
            // this might leak
            var paths = [_]string{ file_dir, base };
            result.base_url_for_paths = std.fs.path.join(r.allocator, paths) catch unreachable;
        }

        return result;
    }

    // TODO:
    pub fn prettyPath(r: *Resolver, path: Ptah) string {
        return path.text;
    }

    pub fn parsePackageJSON(r: *Resolver, file: string) !?*PackageJSON {
        return try PackageJSON.parse(r, file);
    }

    pub fn isPackagePath(path: string) bool {
        // this could probably be flattened into something more optimized
        return path[0] != '/' and !strings.startsWith(path, "./") and !strings.startsWith(path, "../") and !strings.eql(path, ".") and !strings.eql(path, "..");
    }

    fn dirInfoCached(r: *Resolver, path: string) !*DirInfo {
        const info = r.dir_cache.get(path) orelse try r.dirInfoUncached(path);

        try r.dir_cache.put(path, info);
    }

    pub const MatchResult = struct {
        path_pair: PathPair,
        ok: bool = false,
        diff_case: ?fs.FileSystem.Entry.Lookup.DifferentCase = null,
    };

    pub fn matchTSConfigPaths(r: *Resolver, tsconfig: *TSConfigJSON, path: string, kind: ast.ImportKind) MatchResult {
        Global.notimpl();
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
                error.EACCESS => {
                    entries = fs.FileSystem.DirEntry.empty(path, r.allocator);
                },

                // Ignore "ENOTDIR" here so that calling "ReadDirectory" on a file behaves
                // as if there is nothing there at all instead of causing an error due to
                // the directory actually being a file. This is a workaround for situations
                // where people try to import from a path containing a file as a parent
                // directory. The "pnpm" package manager generates a faulty "NODE_PATH"
                // list which contains such paths and treating them as missing means we just
                // ignore them during path resolution.
                error.ENOENT,
                error.ENOTDIR,
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
        if (parent) |parent_info| {
            info.enclosing_browser_scope = parent_info.enclosing_browser_scope;

            // Make sure "absRealPath" is the real path of the directory (resolving any symlinks)
            if (!r.opts.preserve_symlinks) {
                if (parent_info.entries.get(base)) |entry| {
                    var symlink = entry.symlink(rfs);
                    if (symlink.len > 0) {
                        if (r.debug_logs) |logs| {
                            try logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved symlink \"{s}\" to \"{s}\"", .{ path, symlink }));
                        }
                        info.abs_real_path = symlink;
                    } else if (parent_info.abs_real_path.len > 0) {
                        // this might leak a little i'm not sure
                        const parts = [_]string{ parent_info.abs_real_path, base };
                        symlink = std.fs.path.join(r.allocator, &parts);
                        if (r.debug_logs) |logs| {
                            try logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved symlink \"{s}\" to \"{s}\"", .{ path, symlink }));
                        }
                        info.abs_real_path = symlink;
                    }
                }
            }
        }

        // Record if this directory has a package.json file
        if (entries.get("package.json")) |entry| {
            if (entry.kind(rfs) == .file) {
                info.package_json = r.parsePackageJSON(path);

                if (info.package_json) |pkg| {
                    if (pkg.browser_map != null) {
                        info.enclosing_browser_scope = info;
                    }

                    if (r.debug_logs) |logs| {
                        try logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved package.json in \"{s}\"", .{
                            path,
                        }));
                    }
                }
            }
        }

        // Record if this directory has a tsconfig.json or jsconfig.json file
        {
            var tsconfig_path: ?string = null;
            if (r.opts.tsconfig_override == null) {
                var entry = entries.get("tsconfig.json");
                if (entry.kind(rfs) == .file) {
                    const parts = [_]string{ path, "tsconfig.json" };
                    tsconfig_path = try std.fs.path.join(r.allocator, parts);
                } else if (entries.get("jsconfig.json")) |jsconfig| {
                    if (jsconfig.kind(rfs) == .file) {
                        const parts = [_]string{ path, "jsconfig.json" };
                        tsconfig_path = try std.fs.path.join(r.allocator, parts);
                    }
                }
            } else if (parent == null) {
                tsconfig_path = r.opts.tsconfig_override.?;
            }

            if (tsconfig_path) |tsconfigpath| {
                var visited = std.StringHashMap(bool).init(r.allocator);
                defer visited.deinit();
                info.ts_config_json = r.parseTSConfig(tsconfigpath, visited) catch |err| {
                    const pretty = r.prettyPath(fs.Path{ .text = tsconfigpath, .namespace = "file" });

                    if (err == error.ENOENT) {
                        r.log.addErrorFmt(null, .empty, r.allocator, "Cannot find tsconfig file \"{s}\"", .{pretty});
                    } else if (err != error.ParseErrorAlreadyLogged) {
                        r.log.addErrorFmt(null, .empty, r.allocator, "Cannot read file \"{s}\": {s}", .{ pretty, @errorName(err) });
                    }
                };
            }
        }

        if (info.ts_config_json == null and parent != null) {
            info.ts_config_json = parent.?.tsconfig_json;
        }

        return info;
    }
};
