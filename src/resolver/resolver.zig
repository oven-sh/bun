const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
const PathString = bun.PathString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const C = bun.C;
const ast = @import("../import_record.zig");
const logger = bun.logger;
const options = @import("../options.zig");
const Fs = @import("../fs.zig");
const std = @import("std");
const cache = @import("../cache.zig");
const sync = @import("../sync.zig");
const TSConfigJSON = @import("./tsconfig_json.zig").TSConfigJSON;
const PackageJSON = @import("./package_json.zig").PackageJSON;
const MacroRemap = @import("./package_json.zig").MacroMap;
const ESModule = @import("./package_json.zig").ESModule;
const BrowserMap = @import("./package_json.zig").BrowserMap;
const CacheSet = cache.Set;
const DataURL = @import("./data_url.zig").DataURL;
pub const DirInfo = @import("./dir_info.zig");
const ResolvePath = @import("./resolve_path.zig");
const NodeFallbackModules = @import("../node_fallbacks.zig");
const Mutex = @import("../lock.zig").Lock;
const StringBoolMap = bun.StringHashMap(bool);
const FileDescriptorType = bun.FileDescriptor;
const JSC = bun.JSC;

const allocators = @import("../allocators.zig");
const Msg = logger.Msg;
const Path = Fs.Path;
const debuglog = Output.scoped(.Resolver, true);
const PackageManager = @import("../install/install.zig").PackageManager;
const Dependency = @import("../install/dependency.zig");
const Install = @import("../install/install.zig");
const Lockfile = @import("../install/lockfile.zig").Lockfile;
const Package = @import("../install/lockfile.zig").Package;
const Resolution = @import("../install/resolution.zig").Resolution;
const Semver = @import("../install/semver.zig");
const DotEnv = @import("../env_loader.zig");

pub fn isPackagePath(path: string) bool {
    // Always check for posix absolute paths (starts with "/")
    // But don't check window's style on posix
    // For a more in depth explanation, look above where `isPackagePathNotAbsolute` is used.
    return !std.fs.path.isAbsolute(path) and @call(bun.callmod_inline, isPackagePathNotAbsolute, .{path});
}

pub fn isPackagePathNotAbsolute(non_absolute_path: string) bool {
    if (Environment.allow_assert) {
        assert(!std.fs.path.isAbsolute(non_absolute_path));
        assert(!strings.startsWith(non_absolute_path, "/"));
    }

    return !strings.startsWith(non_absolute_path, "./") and
        !strings.startsWith(non_absolute_path, "../") and
        !strings.eql(non_absolute_path, ".") and
        !strings.eql(non_absolute_path, "..") and if (Environment.isWindows)
        (!strings.startsWith(non_absolute_path, ".\\") and
            !strings.startsWith(non_absolute_path, "..\\"))
    else
        true;
}

pub const SideEffectsData = struct {
    source: *logger.Source,
    range: logger.Range,

    // If true, "sideEffects" was an array. If false, "sideEffects" was false.
    is_side_effects_array_in_json: bool = false,
};

/// A temporary threadlocal buffer with a lifetime more than the current
/// function call.
const bufs = struct {
    // Experimenting with making this one struct instead of a bunch of different
    // threadlocal vars yielded no performance improvement on macOS when
    // bundling 10 copies of Three.js. It may be worthwhile for more complicated
    // packages but we lack a decent module resolution benchmark right now.
    // Potentially revisit after https://github.com/oven-sh/bun/issues/2716
    pub threadlocal var extension_path: [512]u8 = undefined;
    pub threadlocal var tsconfig_match_full_buf: bun.PathBuffer = undefined;
    pub threadlocal var tsconfig_match_full_buf2: bun.PathBuffer = undefined;
    pub threadlocal var tsconfig_match_full_buf3: bun.PathBuffer = undefined;

    pub threadlocal var esm_subpath: [512]u8 = undefined;
    pub threadlocal var esm_absolute_package_path: bun.PathBuffer = undefined;
    pub threadlocal var esm_absolute_package_path_joined: bun.PathBuffer = undefined;

    pub threadlocal var dir_entry_paths_to_resolve: [256]DirEntryResolveQueueItem = undefined;
    pub threadlocal var open_dirs: [256]std.fs.Dir = undefined;
    pub threadlocal var resolve_without_remapping: bun.PathBuffer = undefined;
    pub threadlocal var index: bun.PathBuffer = undefined;
    pub threadlocal var dir_info_uncached_filename: bun.PathBuffer = undefined;
    pub threadlocal var node_bin_path: bun.PathBuffer = undefined;
    pub threadlocal var dir_info_uncached_path: bun.PathBuffer = undefined;
    pub threadlocal var tsconfig_base_url: bun.PathBuffer = undefined;
    pub threadlocal var relative_abs_path: bun.PathBuffer = undefined;
    pub threadlocal var load_as_file_or_directory_via_tsconfig_base_path: bun.PathBuffer = undefined;
    pub threadlocal var node_modules_check: bun.PathBuffer = undefined;
    pub threadlocal var field_abs_path: bun.PathBuffer = undefined;
    pub threadlocal var tsconfig_path_abs: bun.PathBuffer = undefined;
    pub threadlocal var check_browser_map: bun.PathBuffer = undefined;
    pub threadlocal var remap_path: bun.PathBuffer = undefined;
    pub threadlocal var load_as_file: bun.PathBuffer = undefined;
    pub threadlocal var remap_path_trailing_slash: bun.PathBuffer = undefined;
    pub threadlocal var path_in_global_disk_cache: bun.PathBuffer = undefined;
    pub threadlocal var abs_to_rel: bun.PathBuffer = undefined;
    pub threadlocal var node_modules_paths_buf: bun.PathBuffer = undefined;
    pub threadlocal var import_path_for_standalone_module_graph: bun.PathBuffer = undefined;

    pub inline fn bufs(comptime field: std.meta.DeclEnum(@This())) *@TypeOf(@field(@This(), @tagName(field))) {
        return &@field(@This(), @tagName(field));
    }
}.bufs;

pub const PathPair = struct {
    primary: Path,
    secondary: ?Path = null,

    pub const Iter = struct {
        index: u2,
        ctx: *PathPair,
        pub fn next(i: *Iter) ?*Path {
            if (i.next_()) |path_| {
                if (path_.is_disabled) {
                    return i.next();
                }
                return path_;
            }

            return null;
        }
        fn next_(i: *Iter) ?*Path {
            const ind = i.index;
            i.index +|= 1;

            switch (ind) {
                0 => return &i.ctx.primary,
                1 => return if (i.ctx.secondary) |*sec| sec else null,
                else => return null,
            }
        }
    };

    pub fn iter(p: *PathPair) Iter {
        return Iter{ .ctx = p, .index = 0 };
    }
};

// this is ripped from esbuild, comments included
pub const SideEffects = enum {
    /// The default value conservatively considers all files to have side effects.
    has_side_effects,

    /// This file was listed as not having side effects by a "package.json"
    /// file in one of our containing directories with a "sideEffects" field.
    no_side_effects__package_json,

    /// This file is considered to have no side effects because the AST was empty
    /// after parsing finished. This should be the case for ".d.ts" files.
    no_side_effects__empty_ast,

    /// This file was loaded using a data-oriented loader (e.g. "text") that is
    /// known to not have side effects.
    no_side_effects__pure_data,

    // /// Same as above but it came from a plugin. We don't want to warn about
    // /// unused imports to these files since running the plugin is a side effect.
    // /// Removing the import would not call the plugin which is observable.
    // no_side_effects__pure_data_from_plugin,
};

pub const Result = struct {
    path_pair: PathPair,

    jsx: options.JSX.Pragma = options.JSX.Pragma{},

    package_json: ?*PackageJSON = null,

    is_external: bool = false,

    is_external_and_rewrite_import_path: bool = false,

    is_standalone_module: bool = false,

    // This is true when the package was loaded from within the node_modules directory.
    is_from_node_modules: bool = false,

    diff_case: ?Fs.FileSystem.Entry.Lookup.DifferentCase = null,

    // If present, any ES6 imports to this file can be considered to have no side
    // effects. This means they should be removed if unused.
    primary_side_effects_data: SideEffects = SideEffects.has_side_effects,

    // If true, unused imports are retained in TypeScript code. This matches the
    // behavior of the "importsNotUsedAsValues" field in "tsconfig.json" when the
    // value is not "remove".
    preserve_unused_imports_ts: bool = false,

    // This is the "type" field from "package.json"
    module_type: options.ModuleType = options.ModuleType.unknown,

    emit_decorator_metadata: bool = false,

    debug_meta: ?DebugMeta = null,

    dirname_fd: StoredFileDescriptorType = .zero,
    file_fd: StoredFileDescriptorType = .zero,
    import_kind: ast.ImportKind = undefined,

    pub const Union = union(enum) {
        success: Result,
        failure: anyerror,
        pending: PendingResolution,
        not_found: void,
    };

    pub fn path(this: *Result) ?*Path {
        if (!this.path_pair.primary.is_disabled)
            return &this.path_pair.primary;

        if (this.path_pair.secondary) |*second| {
            if (!second.is_disabled) return second;
        }

        return null;
    }

    pub fn pathConst(this: *const Result) ?*const Path {
        if (!this.path_pair.primary.is_disabled)
            return &this.path_pair.primary;

        if (this.path_pair.secondary) |*second| {
            if (!second.is_disabled) return second;
        }

        return null;
    }

    // remember: non-node_modules can have package.json
    // checking package.json may not be relevant
    pub fn isLikelyNodeModule(this: *const Result) bool {
        const path_ = this.pathConst() orelse return false;
        return this.is_from_node_modules or strings.indexOf(path_.text, "/node_modules/") != null;
    }

    // Most NPM modules are CommonJS
    // If unspecified, assume CommonJS.
    // If internal app code, assume ESM.
    pub fn shouldAssumeCommonJS(r: *const Result, kind: ast.ImportKind) bool {
        switch (r.module_type) {
            .esm => return false,
            .cjs => return true,
            else => {
                if (kind == .require or kind == .require_resolve) {
                    return true;
                }

                // If we rely just on isPackagePath, we mess up tsconfig.json baseUrl paths.
                return r.isLikelyNodeModule();
            },
        }
    }

    pub const DebugMeta = struct {
        notes: std.ArrayList(logger.Data),
        suggestion_text: string = "",
        suggestion_message: string = "",
        suggestion_range: SuggestionRange,

        pub const SuggestionRange = enum { full, end };

        pub fn init(allocator: std.mem.Allocator) DebugMeta {
            return DebugMeta{ .notes = std.ArrayList(logger.Data).init(allocator) };
        }

        pub fn logErrorMsg(m: *DebugMeta, log: *logger.Log, _source: ?*const logger.Source, r: logger.Range, comptime fmt: string, args: anytype) !void {
            if (_source != null and m.suggestion_message.len > 0) {
                const suggestion_range = if (m.suggestion_range == .end)
                    logger.Range{ .loc = logger.Loc{ .start = r.endI() - 1 } }
                else
                    r;
                const data = logger.rangeData(_source.?, suggestion_range, m.suggestion_message);
                data.location.?.suggestion = m.suggestion_text;
                try m.notes.append(data);
            }

            try log.addMsg(Msg{
                .kind = .err,
                .data = logger.rangeData(_source, r, std.fmt.allocPrint(m.notes.allocator, fmt, args)),
                .notes = try m.toOwnedSlice(),
            });
        }
    };

    pub fn hash(this: *const Result, _: string, _: options.Loader) u32 {
        const module = this.path_pair.primary.text;
        const node_module_root = std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str;
        if (strings.lastIndexOf(module, node_module_root)) |end_| {
            const end: usize = end_ + node_module_root.len;

            return @as(u32, @truncate(bun.hash(module[end..])));
        }

        return @as(u32, @truncate(bun.hash(this.path_pair.primary.text)));
    }
};

pub const DirEntryResolveQueueItem = struct {
    result: allocators.Result,
    unsafe_path: string,
    safe_path: string = "",
    fd: StoredFileDescriptorType = .zero,
};

pub const DebugLogs = struct {
    what: string = "",
    indent: MutableString,
    notes: std.ArrayList(logger.Data),

    pub const FlushMode = enum { fail, success };

    pub fn init(allocator: std.mem.Allocator) !DebugLogs {
        const mutable = try MutableString.init(allocator, 0);
        return DebugLogs{
            .indent = mutable,
            .notes = std.ArrayList(logger.Data).init(allocator),
        };
    }

    pub fn deinit(d: DebugLogs) void {
        d.notes.deinit();
        // d.indent.deinit();
    }

    pub fn increaseIndent(d: *DebugLogs) void {
        @setCold(true);
        d.indent.append(" ") catch unreachable;
    }

    pub fn decreaseIndent(d: *DebugLogs) void {
        @setCold(true);
        d.indent.list.shrinkRetainingCapacity(d.indent.list.items.len - 1);
    }

    pub fn addNote(d: *DebugLogs, _text: string) void {
        @setCold(true);
        var text = _text;
        const len = d.indent.len();
        if (len > 0) {
            var __text = d.notes.allocator.alloc(u8, text.len + len) catch unreachable;
            bun.copy(u8, __text, d.indent.list.items);
            bun.copy(u8, __text[len..], _text);
            text = __text;
            d.notes.allocator.free(_text);
        }

        d.notes.append(logger.rangeData(null, logger.Range.None, text)) catch unreachable;
    }

    pub fn addNoteFmt(d: *DebugLogs, comptime fmt: string, args: anytype) void {
        @setCold(true);
        return d.addNote(std.fmt.allocPrint(d.notes.allocator, fmt, args) catch unreachable);
    }
};

pub const MatchResult = struct {
    path_pair: PathPair,
    dirname_fd: StoredFileDescriptorType = .zero,
    file_fd: StoredFileDescriptorType = .zero,
    is_node_module: bool = false,
    package_json: ?*PackageJSON = null,
    diff_case: ?Fs.FileSystem.Entry.Lookup.DifferentCase = null,
    dir_info: ?*DirInfo = null,
    module_type: options.ModuleType = .unknown,
    is_external: bool = false,

    pub const Union = union(enum) {
        not_found: void,
        success: MatchResult,
        pending: PendingResolution,
        failure: anyerror,
    };
};

pub const PendingResolution = struct {
    esm: ESModule.Package.External = .{},
    dependency: Dependency.Version = .{},
    resolution_id: Install.PackageID = Install.invalid_package_id,
    root_dependency_id: Install.DependencyID = Install.invalid_package_id,
    import_record_id: u32 = std.math.maxInt(u32),
    string_buf: []u8 = "",
    tag: Tag,

    pub const List = std.MultiArrayList(PendingResolution);

    pub fn deinitListItems(list_: List, allocator: std.mem.Allocator) void {
        var list = list_;
        const dependencies = list.items(.dependency);
        const string_bufs = list.items(.string_buf);
        for (dependencies) |*dependency| {
            dependency.deinit();
        }

        for (string_bufs) |string_buf| {
            allocator.free(string_buf);
        }
    }

    pub fn deinit(this: *PendingResolution, allocator: std.mem.Allocator) void {
        this.dependency.deinit();
        allocator.free(this.string_buf);
    }

    pub const Tag = enum {
        download,
        resolve,
        done,
    };

    pub fn init(
        allocator: std.mem.Allocator,
        esm: ESModule.Package,
        dependency: Dependency.Version,
        resolution_id: Install.PackageID,
    ) !PendingResolution {
        return PendingResolution{
            .esm = try esm.copy(allocator),
            .dependency = dependency,
            .resolution_id = resolution_id,
        };
    }
};

pub const LoadResult = struct {
    path: string,
    diff_case: ?Fs.FileSystem.Entry.Lookup.DifferentCase,
    dirname_fd: StoredFileDescriptorType = .zero,
    file_fd: StoredFileDescriptorType = .zero,
    dir_info: ?*DirInfo = null,
};

// This is a global so even if multiple resolvers are created, the mutex will still work
var resolver_Mutex: Mutex = undefined;
var resolver_Mutex_loaded: bool = false;

const BinFolderArray = std.BoundedArray(string, 128);
var bin_folders: BinFolderArray = undefined;
var bin_folders_lock: Mutex = .{};
var bin_folders_loaded: bool = false;

const Timer = @import("../system_timer.zig").Timer;

pub const AnyResolveWatcher = struct {
    context: *anyopaque,
    callback: *const (fn (*anyopaque, dir_path: string, dir_fd: StoredFileDescriptorType) void) = undefined,

    pub fn watch(this: @This(), dir_path: string, fd: StoredFileDescriptorType) void {
        return this.callback(this.context, dir_path, fd);
    }
};

pub fn ResolveWatcher(comptime Context: type, comptime onWatch: anytype) type {
    return struct {
        pub fn init(context: Context) AnyResolveWatcher {
            return AnyResolveWatcher{
                .context = context,
                .callback = watch,
            };
        }
        pub fn watch(this: *anyopaque, dir_path: string, fd: StoredFileDescriptorType) void {
            onWatch(bun.cast(Context, this), dir_path, fd);
        }
    };
}

pub const Resolver = struct {
    const ThisResolver = @This();
    opts: options.BundleOptions,
    fs: *Fs.FileSystem,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    extension_order: []const string = undefined,
    timer: Timer = undefined,

    care_about_bin_folder: bool = false,
    care_about_scripts: bool = false,

    /// Read the "browser" field in package.json files?
    /// For Bun's runtime, we don't.
    care_about_browser_field: bool = true,

    debug_logs: ?DebugLogs = null,
    elapsed: u64 = 0, // tracing

    watcher: ?AnyResolveWatcher = null,

    caches: CacheSet,
    generation: bun.Generation = 0,

    package_manager: ?*PackageManager = null,
    onWakePackageManager: PackageManager.WakeHandler = .{},
    env_loader: ?*DotEnv.Loader = null,
    store_fd: bool = false,

    standalone_module_graph: ?*bun.StandaloneModuleGraph = null,

    // These are sets that represent various conditions for the "exports" field
    // in package.json.
    // esm_conditions_default: bun.StringHashMap(bool),
    // esm_conditions_import: bun.StringHashMap(bool),
    // esm_conditions_require: bun.StringHashMap(bool),

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
    mutex: *Mutex,

    /// This cache maps a directory path to information about that directory and
    /// all parent directories. When interacting with this structure, make sure
    /// to validate your keys with `Resolver.assertValidCacheKey`
    dir_cache: *DirInfo.HashMap,

    /// This is set to false for the runtime. The runtime should choose "main"
    /// over "module" in package.json
    prefer_module_field: bool = true,

    pub fn getPackageManager(this: *Resolver) *PackageManager {
        return this.package_manager orelse brk: {
            bun.HTTPThread.init();
            const pm = PackageManager.initWithRuntime(
                this.log,
                this.opts.install,

                // This cannot be the threadlocal allocator. It goes to the HTTP thread.
                bun.default_allocator,

                .{},
                this.env_loader.?,
            ) catch @panic("Failed to initialize package manager");
            pm.onWake = this.onWakePackageManager;
            this.package_manager = pm;
            break :brk pm;
        };
    }

    pub inline fn usePackageManager(self: *const ThisResolver) bool {
        // TODO(@paperdave): make this configurable. the rationale for disabling
        // auto-install in standalone mode is that such executable must either:
        //
        // - bundle the dependency itself. dynamic `require`/`import` could be
        //   changed to bundle potential dependencies specified in package.json
        //
        // - want to load the user's node_modules, which is what currently happens.
        //
        // auto install, as of writing, is also quite buggy and untested, it always
        // installs the latest version regardless of a user's package.json or specifier.
        // in addition to being not fully stable, it is completely unexpected to invoke
        // a package manager after bundling an executable. if enough people run into
        // this, we could implement point 1
        if (self.standalone_module_graph) |_| return false;

        return self.opts.global_cache.isEnabled();
    }

    pub fn init1(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        _fs: *Fs.FileSystem,
        opts: options.BundleOptions,
    ) ThisResolver {
        if (!resolver_Mutex_loaded) {
            resolver_Mutex = .{};
            resolver_Mutex_loaded = true;
        }

        return ThisResolver{
            .allocator = allocator,
            .dir_cache = DirInfo.HashMap.init(bun.default_allocator),
            .mutex = &resolver_Mutex,
            .caches = CacheSet.init(allocator),
            .opts = opts,
            .timer = Timer.start() catch @panic("Timer fail"),
            .fs = _fs,
            .log = log,
            .extension_order = opts.extension_order.default.default,
            .care_about_browser_field = opts.target.isWebLike(),
        };
    }

    pub fn isExternalPattern(r: *ThisResolver, import_path: string) bool {
        if (r.opts.packages == .external and isPackagePath(import_path)) {
            return true;
        }
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
            if (flush_mode == DebugLogs.FlushMode.fail) {
                try r.log.addRangeDebugWithNotes(null, logger.Range{ .loc = logger.Loc{} }, debug.what, try debug.notes.toOwnedSlice());
            } else if (@intFromEnum(r.log.level) <= @intFromEnum(logger.Log.Level.verbose)) {
                try r.log.addVerboseWithNotes(null, logger.Loc.Empty, debug.what, try debug.notes.toOwnedSlice());
            }
        }
    }
    var tracing_start: i128 = if (FeatureFlags.tracing) 0 else undefined;

    pub const bunFrameworkPackagePrefix = "bun-framework-";
    pub fn resolveFramework(
        r: *ThisResolver,
        package: string,
        pair: *PackageJSON.FrameworkRouterPair,
        comptime preference: PackageJSON.LoadFramework,
        comptime load_defines: bool,
    ) !void {

        // We want to enable developers to integrate frameworks without waiting on official support.
        // But, we still want the command to do the actual framework integration to be succint
        // This lets users type "--use next" instead of "--use bun-framework-next"
        // If they're using a local file path, we skip this.
        if (isPackagePath(package)) {
            var prefixed_package_buf: [512]u8 = undefined;
            // Prevent the extra lookup if the package is already prefixed, i.e. avoid "bun-framework-next-bun-framework-next"
            if (strings.startsWith(package, bunFrameworkPackagePrefix) or package.len + bunFrameworkPackagePrefix.len >= prefixed_package_buf.len) {
                return r._resolveFramework(package, pair, preference, load_defines) catch |err| {
                    switch (err) {
                        error.ModuleNotFound => {
                            Output.prettyErrorln("<r><red>ResolveError<r> can't find framework: <b>\"{s}\"<r>.\n\nMaybe it's not installed? Try running this:\n\n   <b>bun add -d {s}<r>\n   <b>bun bun --use {s}<r>", .{ package, package, package });
                            Global.exit(1);
                        },
                        else => {
                            return err;
                        },
                    }
                };
            }

            prefixed_package_buf[0..bunFrameworkPackagePrefix.len].* = bunFrameworkPackagePrefix.*;
            bun.copy(u8, prefixed_package_buf[bunFrameworkPackagePrefix.len..], package);
            const prefixed_name = prefixed_package_buf[0 .. bunFrameworkPackagePrefix.len + package.len];
            return r._resolveFramework(prefixed_name, pair, preference, load_defines) catch |err| {
                switch (err) {
                    error.ModuleNotFound => {
                        return r._resolveFramework(package, pair, preference, load_defines) catch |err2| {
                            switch (err2) {
                                error.ModuleNotFound => {
                                    Output.prettyErrorln("<r><red>ResolveError<r> can't find framework: <b>\"{s}\"<r>.\n\nMaybe it's not installed? Try running this:\n\n   <b>bun add -d {s}\n   <b>bun bun --use {s}<r>", .{ package, prefixed_name, package });
                                    Global.exit(1);
                                },
                                else => {
                                    return err;
                                },
                            }
                        };
                    },
                    else => {
                        return err;
                    },
                }
            };
        }

        return r._resolveFramework(package, pair, preference, load_defines) catch |err| {
            switch (err) {
                error.ModuleNotFound => {
                    Output.prettyError("<r><red>ResolveError<r> can't find local framework: <b>\"{s}\"<r>.", .{package});
                    Global.exit(1);
                },
                else => {
                    return err;
                },
            }
        };
    }

    fn _resolveFramework(
        r: *ThisResolver,
        package: string,
        pair: *PackageJSON.FrameworkRouterPair,
        comptime preference: PackageJSON.LoadFramework,
        comptime load_defines: bool,
    ) !void {

        // TODO: make this only parse package.json once
        var result = try r.resolve(r.fs.top_level_dir, package, .internal);
        // support passing a package.json or path to a package
        const pkg: *const PackageJSON = result.package_json orelse r.packageJSONForResolvedNodeModuleWithIgnoreMissingName(&result, true) orelse return error.MissingPackageJSON;

        const json = (try r.caches.json.parsePackageJSON(r.log, pkg.source, r.allocator)) orelse return error.JSONParseError;

        pkg.loadFrameworkWithPreference(pair, json, r.allocator, load_defines, preference);
        const dir = pkg.source.path.sourceDir();

        var buf: bun.PathBuffer = undefined;

        pair.framework.resolved_dir = pkg.source.path.sourceDir();

        if (pair.framework.client.isEnabled()) {
            var parts = [_]string{ dir, pair.framework.client.path };
            const abs = r.fs.abs(&parts);
            pair.framework.client.path = try r.allocator.dupe(u8, abs);
            pair.framework.resolved = true;
        }

        if (pair.framework.server.isEnabled()) {
            var parts = [_]string{ dir, pair.framework.server.path };
            const abs = r.fs.abs(&parts);
            pair.framework.server.path = try r.allocator.dupe(u8, abs);
            pair.framework.resolved = true;
        }

        if (pair.framework.fallback.isEnabled()) {
            var parts = [_]string{ dir, pair.framework.fallback.path };
            const abs = r.fs.abs(&parts);
            pair.framework.fallback.path = try r.allocator.dupe(u8, abs);
            pair.framework.resolved = true;
        }

        if (pair.loaded_routes) {
            const chosen_dir: string = brk: {
                if (pair.router.possible_dirs.len > 0) {
                    for (pair.router.possible_dirs) |route_dir| {
                        var parts = [_]string{ r.fs.top_level_dir, std.fs.path.sep_str, route_dir };
                        const abs = r.fs.join(&parts);
                        // must end in trailing slash
                        break :brk (std.posix.realpath(abs, &buf) catch continue);
                    }
                    return error.MissingRouteDir;
                } else {
                    var parts = [_]string{ r.fs.top_level_dir, std.fs.path.sep_str, pair.router.dir };
                    const abs = r.fs.join(&parts);
                    // must end in trailing slash
                    break :brk std.posix.realpath(abs, &buf) catch return error.MissingRouteDir;
                }
            };

            var out = try r.allocator.alloc(u8, chosen_dir.len + 1);
            bun.copy(u8, out, chosen_dir);
            out[out.len - 1] = '/';
            pair.router.dir = out;
            pair.router.routes_enabled = true;
        }
    }

    pub fn resolveAndAutoInstall(
        r: *ThisResolver,
        source_dir: string,
        import_path: string,
        kind: ast.ImportKind,
        global_cache: GlobalCache,
    ) Result.Union {
        const tracer = bun.tracy.traceNamed(@src(), "ModuleResolver.resolve");
        defer tracer.end();

        // Only setting 'current_action' in debug mode because module resolution
        // is done very often, and has a very low crash rate.
        const prev_action = if (Environment.isDebug) bun.crash_handler.current_action;
        if (Environment.isDebug) bun.crash_handler.current_action = .{ .resolver = .{
            .source_dir = source_dir,
            .import_path = import_path,
            .kind = kind,
        } };
        defer if (Environment.isDebug) {
            bun.crash_handler.current_action = prev_action;
        };

        if (Environment.isDebug and bun.CLI.debug_flags.hasResolveBreakpoint(import_path)) {
            bun.Output.debug("Resolving <green>{s}<r> from <blue>{s}<r>", .{
                import_path,
                source_dir,
            });
            @breakpoint();
        }

        const original_order = r.extension_order;
        defer r.extension_order = original_order;
        r.extension_order = switch (kind) {
            .url, .at_conditional, .at => options.BundleOptions.Defaults.CSSExtensionOrder[0..],
            .entry_point, .stmt, .dynamic => r.opts.extension_order.default.esm,
            else => r.opts.extension_order.default.default,
        };

        if (FeatureFlags.tracing) {
            r.timer.reset();
        }

        defer {
            if (FeatureFlags.tracing) {
                r.elapsed += r.timer.read();
            }
        }
        if (r.log.level == .verbose) {
            if (r.debug_logs != null) {
                r.debug_logs.?.deinit();
            }

            r.debug_logs = DebugLogs.init(r.allocator) catch unreachable;
        }

        if (import_path.len == 0) return .{ .not_found = {} };

        if (r.opts.mark_builtins_as_external) {
            if (strings.hasPrefixComptime(import_path, "node:") or
                strings.hasPrefixComptime(import_path, "bun:") or
                bun.JSC.HardcodedModule.Aliases.has(import_path, r.opts.target))
            {
                return .{
                    .success = Result{
                        .import_kind = kind,
                        .path_pair = PathPair{
                            .primary = Path.init(import_path),
                        },
                        .is_external = true,
                        .module_type = .cjs,
                        .primary_side_effects_data = .no_side_effects__pure_data,
                    },
                };
            }
        }

        // Certain types of URLs default to being external for convenience,
        // while these rules should not be applied to the entrypoint as it is never external (#12734)
        if (kind != .entry_point and
            (r.isExternalPattern(import_path) or
            // "fill: url(#filter);"
            (kind.isFromCSS() and strings.startsWith(import_path, "#")) or

            // "background: url(http://example.com/images/image.png);"
            strings.startsWith(import_path, "http://") or

            // "background: url(https://example.com/images/image.png);"
            strings.startsWith(import_path, "https://") or

            // "background: url(//example.com/images/image.png);"
            strings.startsWith(import_path, "//")))
        {
            if (r.debug_logs) |*debug| {
                debug.addNote("Marking this path as implicitly external");
                r.flushDebugLogs(.success) catch {};
            }

            return .{
                .success = Result{
                    .import_kind = kind,
                    .path_pair = PathPair{
                        .primary = Path.init(import_path),
                    },
                    .is_external = true,
                    .module_type = .esm,
                },
            };
        }

        if (DataURL.parse(import_path) catch {
            return .{ .failure = error.InvalidDataURL };
        }) |data_url| {
            // "import 'data:text/javascript,console.log(123)';"
            // "@import 'data:text/css,body{background:white}';"
            const mime = data_url.decodeMimeType();
            if (mime.category == .javascript or mime.category == .css or mime.category == .json or mime.category == .text) {
                if (r.debug_logs) |*debug| {
                    debug.addNote("Putting this path in the \"dataurl\" namespace");
                    r.flushDebugLogs(.success) catch {};
                }

                return .{
                    .success = Result{ .path_pair = PathPair{ .primary = Path.initWithNamespace(import_path, "dataurl") } },
                };
            }

            // "background: url(data:image/png;base64,iVBORw0KGgo=);"
            if (r.debug_logs) |*debug| {
                debug.addNote("Marking this \"dataurl\" as external");
                r.flushDebugLogs(.success) catch {};
            }

            return .{
                .success = Result{
                    .path_pair = PathPair{ .primary = Path.initWithNamespace(import_path, "dataurl") },
                    .is_external = true,
                },
            };
        }

        // When using `bun build --compile`, module resolution is never
        // relative to our special /$bunfs/ directory.
        //
        // It's always relative to the current working directory of the project root.
        //
        // ...unless you pass a relative path that exists in the standalone module graph executable.
        var source_dir_resolver: bun.path.PosixToWinNormalizer = .{};
        const source_dir_normalized = brk: {
            if (r.standalone_module_graph) |graph| {
                if (bun.StandaloneModuleGraph.isBunStandaloneFilePath(import_path)) {
                    if (graph.findAssumeStandalonePath(import_path) != null) {
                        return .{
                            .success = Result{
                                .import_kind = kind,
                                .path_pair = PathPair{
                                    .primary = Path.init(import_path),
                                },
                                .is_standalone_module = true,
                                .module_type = .esm,
                            },
                        };
                    }

                    return .{ .not_found = {} };
                } else if (bun.StandaloneModuleGraph.isBunStandaloneFilePath(source_dir)) {
                    if (import_path.len > 2 and isDotSlash(import_path[0..2])) {
                        const buf = bufs(.import_path_for_standalone_module_graph);
                        const joined = bun.path.joinAbsStringBuf(source_dir, buf, &.{import_path}, .loose);

                        // Support relative paths in the graph
                        if (graph.findAssumeStandalonePath(joined)) |file| {
                            return .{
                                .success = Result{
                                    .import_kind = kind,
                                    .path_pair = PathPair{
                                        .primary = Path.init(file.name),
                                    },
                                    .is_standalone_module = true,
                                    .module_type = .esm,
                                },
                            };
                        }
                    }
                    break :brk Fs.FileSystem.instance.top_level_dir;
                }
            }

            // Fail now if there is no directory to resolve in. This can happen for
            // virtual modules (e.g. stdin) if a resolve directory is not specified.
            //
            // TODO: This is skipped for now because it is impossible to set a
            // resolveDir so we default to the top level directory instead (this
            // is backwards compat with Bun 1.0 behavior)
            // See https://github.com/oven-sh/bun/issues/8994 for more details.
            if (source_dir.len == 0) {
                // if (r.debug_logs) |*debug| {
                //     debug.addNote("Cannot resolve this path without a directory");
                //     r.flushDebugLogs(.fail) catch {};
                // }

                // return .{ .failure = error.MissingResolveDir };
                break :brk Fs.FileSystem.instance.top_level_dir;
            }

            // This can also be hit if you use plugins with non-file namespaces,
            // or call the module resolver from javascript (Bun.resolveSync)
            // with a faulty parent specifier.
            if (!std.fs.path.isAbsolute(source_dir)) {
                // if (r.debug_logs) |*debug| {
                //     debug.addNote("Cannot resolve this path without an absolute directory");
                //     r.flushDebugLogs(.fail) catch {};
                // }

                // return .{ .failure = error.InvalidResolveDir };
                break :brk Fs.FileSystem.instance.top_level_dir;
            }

            break :brk source_dir_resolver.resolveCWD(source_dir) catch @panic("Failed to query CWD");
        };

        // r.mutex.lock();
        // defer r.mutex.unlock();
        errdefer (r.flushDebugLogs(.fail) catch {});

        var tmp = r.resolveWithoutSymlinks(source_dir_normalized, import_path, kind, global_cache);
        switch (tmp) {
            .success => |*result| {
                if (!strings.eqlComptime(result.path_pair.primary.namespace, "node") and !result.is_standalone_module)
                    r.finalizeResult(result, kind) catch |err| return .{ .failure = err };

                r.flushDebugLogs(.success) catch {};
                result.import_kind = kind;
                return .{ .success = result.* };
            },
            .failure => |e| {
                r.flushDebugLogs(.fail) catch {};
                return .{ .failure = e };
            },
            .pending => |pending| {
                r.flushDebugLogs(.fail) catch {};
                return .{ .pending = pending };
            },
            .not_found => {
                r.flushDebugLogs(.fail) catch {};
                return .{ .not_found = {} };
            },
        }
    }

    pub fn resolve(r: *ThisResolver, source_dir: string, import_path: string, kind: ast.ImportKind) !Result {
        switch (r.resolveAndAutoInstall(source_dir, import_path, kind, GlobalCache.disable)) {
            .success => |result| return result,
            .pending, .not_found => return error.ModuleNotFound,

            .failure => |e| return e,
        }
    }

    const ModuleTypeMap = bun.ComptimeStringMap(options.ModuleType, .{
        .{ ".mjs", options.ModuleType.esm },
        .{ ".mts", options.ModuleType.esm },
        .{ ".cjs", options.ModuleType.cjs },
        .{ ".cts", options.ModuleType.cjs },
    });

    pub fn finalizeResult(r: *ThisResolver, result: *Result, kind: ast.ImportKind) !void {
        if (result.is_external) return;

        var iter = result.path_pair.iter();
        var module_type = result.module_type;
        while (iter.next()) |path| {
            var dir: *DirInfo = (r.readDirInfo(path.name.dir) catch continue) orelse continue;
            var needs_side_effects = true;
            if (result.package_json) |existing| {
                // if we don't have it here, they might put it in a sideEfffects
                // map of the parent package.json
                // TODO: check if webpack also does this parent lookup
                needs_side_effects = existing.side_effects == .unspecified;

                result.primary_side_effects_data = switch (existing.side_effects) {
                    .unspecified => .has_side_effects,
                    .false => .no_side_effects__package_json,
                    .map => |map| if (map.contains(bun.StringHashMapUnowned.Key.init(path.text))) .has_side_effects else .no_side_effects__package_json,
                };

                if (existing.name.len == 0 or r.care_about_bin_folder) result.package_json = null;
            }

            result.package_json = result.package_json orelse dir.enclosing_package_json;

            if (needs_side_effects) {
                if (result.package_json) |package_json| {
                    result.primary_side_effects_data = switch (package_json.side_effects) {
                        .unspecified => .has_side_effects,
                        .false => .no_side_effects__package_json,
                        .map => |map| if (map.contains(bun.StringHashMapUnowned.Key.init(path.text))) .has_side_effects else .no_side_effects__package_json,
                    };
                }
            }

            if (dir.enclosing_tsconfig_json) |tsconfig| {
                result.jsx = tsconfig.mergeJSX(result.jsx);
                result.emit_decorator_metadata = result.emit_decorator_metadata or tsconfig.emit_decorator_metadata;
            }

            // If you use mjs or mts, then you're using esm
            // If you use cjs or cts, then you're using cjs
            // This should win out over the module type from package.json
            if (!kind.isFromCSS() and module_type == .unknown and path.name.ext.len == 4) {
                module_type = ModuleTypeMap.getWithLength(path.name.ext, 4) orelse .unknown;
            }

            if (dir.getEntries(r.generation)) |entries| {
                if (entries.get(path.name.filename)) |query| {
                    const symlink_path = query.entry.symlink(&r.fs.fs, r.store_fd);
                    if (symlink_path.len > 0) {
                        path.setRealpath(symlink_path);
                        if (result.file_fd == .zero) result.file_fd = query.entry.cache.fd;

                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Resolved symlink \"{s}\" to \"{s}\"", .{ path.text, symlink_path });
                        }
                    } else if (dir.abs_real_path.len > 0) {
                        var parts = [_]string{ dir.abs_real_path, query.entry.base() };
                        var buf: bun.PathBuffer = undefined;

                        var out = r.fs.absBuf(&parts, &buf);

                        const store_fd = r.store_fd;

                        if (query.entry.cache.fd == .zero) {
                            buf[out.len] = 0;
                            const span = buf[0..out.len :0];
                            var file = try if (store_fd)
                                std.fs.openFileAbsoluteZ(span, .{ .mode = .read_only })
                            else
                                bun.openFileForPath(span);

                            if (!store_fd) {
                                assert(bun.FDTag.get(file.handle) == .none);
                                out = try bun.getFdPath(file.handle, &buf);
                                file.close();
                                query.entry.cache.fd = .zero;
                            } else {
                                query.entry.cache.fd = bun.toFD(file.handle);
                                Fs.FileSystem.setMaxFd(file.handle);
                            }
                        }

                        defer {
                            if (r.fs.fs.needToCloseFiles()) {
                                if (query.entry.cache.fd != .zero) {
                                    var file = query.entry.cache.fd.asFile();
                                    file.close();
                                    query.entry.cache.fd = .zero;
                                }
                            }
                        }

                        if (store_fd) {
                            out = try bun.getFdPath(query.entry.cache.fd, &buf);
                        }

                        const symlink = try Fs.FileSystem.FilenameStore.instance.append(@TypeOf(out), out);
                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Resolved symlink \"{s}\" to \"{s}\"", .{ symlink, path.text });
                        }
                        query.entry.cache.symlink = PathString.init(symlink);
                        if (result.file_fd == .zero and store_fd) result.file_fd = query.entry.cache.fd;

                        path.setRealpath(symlink);
                    }
                }
            }
        }

        if (!kind.isFromCSS() and module_type == .unknown) {
            if (result.package_json) |package| {
                module_type = package.module_type;
            }
        }

        result.module_type = module_type;
    }

    pub fn resolveWithoutSymlinks(
        r: *ThisResolver,
        source_dir: string,
        input_import_path: string,
        kind: ast.ImportKind,
        global_cache: GlobalCache,
    ) Result.Union {
        assert(std.fs.path.isAbsolute(source_dir));

        var import_path = input_import_path;

        // This implements the module resolution algorithm from node.js, which is
        // described here: https://nodejs.org/api/modules.html#modules_all_together
        var result: Result = Result{
            .path_pair = PathPair{
                .primary = Path.empty,
            },
            .jsx = r.opts.jsx,
        };

        // Return early if this is already an absolute path. In addition to asking
        // the file system whether this is an absolute path, we also explicitly check
        // whether it starts with a "/" and consider that an absolute path too. This
        // is because relative paths can technically start with a "/" on Windows
        // because it's not an absolute path on Windows. Then people might write code
        // with imports that start with a "/" that works fine on Windows only to
        // experience unexpected build failures later on other operating systems.
        // Treating these paths as absolute paths on all platforms means Windows
        // users will not be able to accidentally make use of these paths.
        if (std.fs.path.isAbsolute(import_path)) {
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("The import \"{s}\" is being treated as an absolute path", .{import_path});
            }

            // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file
            if ((r.dirInfoCached(source_dir) catch null)) |_dir_info| {
                const dir_info: *DirInfo = _dir_info;
                if (dir_info.enclosing_tsconfig_json) |tsconfig| {
                    if (tsconfig.paths.count() > 0) {
                        if (r.matchTSConfigPaths(tsconfig, import_path, kind)) |res| {

                            // We don't set the directory fd here because it might remap an entirely different directory
                            return .{
                                .success = Result{
                                    .path_pair = res.path_pair,
                                    .diff_case = res.diff_case,
                                    .package_json = res.package_json,
                                    .dirname_fd = res.dirname_fd,
                                    .file_fd = res.file_fd,
                                    .jsx = tsconfig.mergeJSX(result.jsx),
                                },
                            };
                        }
                    }
                }
            }

            if (r.opts.external.abs_paths.count() > 0 and r.opts.external.abs_paths.contains(import_path)) {
                // If the string literal in the source text is an absolute path and has
                // been marked as an external module, mark it as *not* an absolute path.
                // That way we preserve the literal text in the output and don't generate
                // a relative path from the output directory to that path.
                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("The path \"{s}\" is marked as external by the user", .{import_path});
                }

                return .{
                    .success = Result{
                        .path_pair = .{ .primary = Path.init(import_path) },
                        .is_external = true,
                    },
                };
            }

            // Run node's resolution rules (e.g. adding ".js")
            var normalizer = ResolvePath.PosixToWinNormalizer{};
            if (r.loadAsFileOrDirectory(normalizer.resolve(source_dir, import_path), kind)) |entry| {
                return .{
                    .success = Result{
                        .dirname_fd = entry.dirname_fd,
                        .path_pair = entry.path_pair,
                        .diff_case = entry.diff_case,
                        .package_json = entry.package_json,
                        .file_fd = entry.file_fd,
                        .jsx = r.opts.jsx,
                    },
                };
            }

            return .{ .not_found = {} };
        }

        // Check both relative and package paths for CSS URL tokens, with relative
        // paths taking precedence over package paths to match Webpack behavior.
        const is_package_path = isPackagePathNotAbsolute(import_path);
        var check_relative = !is_package_path or kind == .url;
        var check_package = is_package_path;

        if (check_relative) {
            const parts = [_]string{ source_dir, import_path };
            const abs_path = r.fs.absBuf(&parts, bufs(.relative_abs_path));

            if (r.opts.external.abs_paths.count() > 0 and r.opts.external.abs_paths.contains(abs_path)) {
                // If the string literal in the source text is an absolute path and has
                // been marked as an external module, mark it as *not* an absolute path.
                // That way we preserve the literal text in the output and don't generate
                // a relative path from the output directory to that path.
                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("The path \"{s}\" is marked as external by the user", .{abs_path});
                }

                return .{
                    .success = Result{
                        .path_pair = .{ .primary = Path.init(r.fs.dirname_store.append(@TypeOf(abs_path), abs_path) catch unreachable) },
                        .is_external = true,
                    },
                };
            }

            // Check the "browser" map
            if (r.care_about_browser_field) {
                if (r.dirInfoCached(std.fs.path.dirname(abs_path) orelse unreachable) catch null) |_import_dir_info| {
                    if (_import_dir_info.getEnclosingBrowserScope()) |import_dir_info| {
                        const pkg = import_dir_info.package_json.?;
                        if (r.checkBrowserMap(
                            import_dir_info,
                            abs_path,
                            .AbsolutePath,
                        )) |remap| {

                            // Is the path disabled?
                            if (remap.len == 0) {
                                var _path = Path.init(r.fs.dirname_store.append(string, abs_path) catch unreachable);
                                _path.is_disabled = true;
                                return .{
                                    .success = Result{
                                        .path_pair = PathPair{
                                            .primary = _path,
                                        },
                                    },
                                };
                            }

                            switch (r.resolveWithoutRemapping(import_dir_info, remap, kind, global_cache)) {
                                .success => |_result| {
                                    result = Result{
                                        .path_pair = _result.path_pair,
                                        .diff_case = _result.diff_case,
                                        .dirname_fd = _result.dirname_fd,
                                        .package_json = pkg,
                                        .jsx = r.opts.jsx,
                                        .module_type = _result.module_type,
                                        .is_external = _result.is_external,
                                        .is_external_and_rewrite_import_path = _result.is_external,
                                    };
                                    check_relative = false;
                                    check_package = false;
                                },
                                else => {},
                            }
                        }
                    }
                }
            }

            if (check_relative) {
                const prev_extension_order = r.extension_order;
                defer {
                    r.extension_order = prev_extension_order;
                }
                if (strings.pathContainsNodeModulesFolder(abs_path)) {
                    r.extension_order = r.opts.extension_order.kind(kind, true);
                }
                if (r.loadAsFileOrDirectory(abs_path, kind)) |res| {
                    check_package = false;
                    result = Result{
                        .path_pair = res.path_pair,
                        .diff_case = res.diff_case,
                        .dirname_fd = res.dirname_fd,
                        .package_json = res.package_json,
                        .jsx = r.opts.jsx,
                    };
                } else if (!check_package) {
                    return .{ .not_found = {} };
                }
            }
        }

        if (check_package) {
            if (r.opts.polyfill_node_globals) {
                const had_node_prefix = strings.hasPrefixComptime(import_path, "node:");
                const import_path_without_node_prefix = if (had_node_prefix) import_path["node:".len..] else import_path;

                if (NodeFallbackModules.Map.get(import_path_without_node_prefix)) |*fallback_module| {
                    result.path_pair.primary = fallback_module.path;
                    result.module_type = .cjs;
                    result.package_json = @as(*PackageJSON, @ptrFromInt(@intFromPtr(fallback_module.package_json)));
                    result.is_from_node_modules = true;
                    return .{ .success = result };
                }

                if (had_node_prefix) {
                    // Module resolution fails automatically for unknown node builtins
                    if (!bun.JSC.HardcodedModule.Aliases.has(import_path_without_node_prefix, .node)) {
                        return .{ .not_found = {} };
                    }

                    // Valid node:* modules becomes {} in the output
                    result.path_pair.primary.namespace = "node";
                    result.path_pair.primary.text = import_path_without_node_prefix;
                    result.path_pair.primary.name = Fs.PathName.init(import_path_without_node_prefix);
                    result.module_type = .cjs;
                    result.path_pair.primary.is_disabled = true;
                    result.is_from_node_modules = true;
                    result.primary_side_effects_data = .no_side_effects__pure_data;
                    return .{ .success = result };
                }

                // Always mark "fs" as disabled, matching Webpack v4 behavior
                if (strings.hasPrefixComptime(import_path_without_node_prefix, "fs") and
                    (import_path_without_node_prefix.len == 2 or
                    import_path_without_node_prefix[2] == '/'))
                {
                    result.path_pair.primary.namespace = "node";
                    result.path_pair.primary.text = import_path_without_node_prefix;
                    result.path_pair.primary.name = Fs.PathName.init(import_path_without_node_prefix);
                    result.module_type = .cjs;
                    result.path_pair.primary.is_disabled = true;
                    result.is_from_node_modules = true;
                    result.primary_side_effects_data = .no_side_effects__pure_data;
                    return .{ .success = result };
                }
            }

            // Check for external packages first
            if (r.opts.external.node_modules.count() > 0 and
                // Imports like "process/" need to resolve to the filesystem, not a builtin
                !strings.hasSuffixComptime(import_path, "/"))
            {
                var query = import_path;
                while (true) {
                    if (r.opts.external.node_modules.contains(query)) {
                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("The path \"{s}\" was marked as external by the user", .{query});
                        }
                        return .{
                            .success = Result{
                                .path_pair = .{ .primary = Path.init(query) },
                                .is_external = true,
                            },
                        };
                    }

                    // If the module "foo" has been marked as external, we also want to treat
                    // paths into that module such as "foo/bar" as external too.
                    const slash = strings.lastIndexOfChar(query, '/') orelse break;
                    query = query[0..slash];
                }
            }

            var source_dir_info = (r.dirInfoCached(source_dir) catch null) orelse return .{ .not_found = {} };

            if (r.care_about_browser_field) {
                // Support remapping one package path to another via the "browser" field
                if (source_dir_info.getEnclosingBrowserScope()) |browser_scope| {
                    if (browser_scope.package_json) |package_json| {
                        if (r.checkBrowserMap(
                            browser_scope,
                            import_path,
                            .PackagePath,
                        )) |remapped| {
                            if (remapped.len == 0) {
                                // "browser": {"module": false}
                                // does the module exist in the filesystem?
                                switch (r.loadNodeModules(import_path, kind, source_dir_info, global_cache, false)) {
                                    .success => |node_module| {
                                        var pair = node_module.path_pair;
                                        pair.primary.is_disabled = true;
                                        if (pair.secondary != null) {
                                            pair.secondary.?.is_disabled = true;
                                        }
                                        return .{
                                            .success = Result{
                                                .path_pair = pair,
                                                .dirname_fd = node_module.dirname_fd,
                                                .diff_case = node_module.diff_case,
                                                .package_json = package_json,
                                                .jsx = r.opts.jsx,
                                            },
                                        };
                                    },
                                    else => {
                                        // "browser": {"module": false}
                                        // the module doesn't exist and it's disabled
                                        // so we should just not try to load it
                                        var primary = Path.init(import_path);
                                        primary.is_disabled = true;
                                        return .{
                                            .success = Result{
                                                .path_pair = PathPair{ .primary = primary },
                                                .diff_case = null,
                                                .jsx = r.opts.jsx,
                                            },
                                        };
                                    },
                                }
                            }

                            import_path = remapped;
                            source_dir_info = browser_scope;
                        }
                    }
                }
            }

            switch (r.resolveWithoutRemapping(source_dir_info, import_path, kind, global_cache)) {
                .success => |res| {
                    result.path_pair = res.path_pair;
                    result.dirname_fd = res.dirname_fd;
                    result.file_fd = res.file_fd;
                    result.package_json = res.package_json;
                    result.diff_case = res.diff_case;
                    result.is_from_node_modules = result.is_from_node_modules or res.is_node_module;
                    result.jsx = r.opts.jsx;
                    result.module_type = res.module_type;
                    result.is_external = res.is_external;
                    // Potentially rewrite the import path if it's external that
                    // was remapped to a different path
                    result.is_external_and_rewrite_import_path = result.is_external;

                    if (res.path_pair.primary.is_disabled and res.path_pair.secondary == null) {
                        return .{ .success = result };
                    }

                    if (res.package_json != null and r.care_about_browser_field) {
                        var base_dir_info = res.dir_info orelse (r.readDirInfo(res.path_pair.primary.name.dir) catch null) orelse return .{ .success = result };
                        if (base_dir_info.getEnclosingBrowserScope()) |browser_scope| {
                            if (r.checkBrowserMap(
                                browser_scope,
                                res.path_pair.primary.text,
                                .AbsolutePath,
                            )) |remap| {
                                if (remap.len == 0) {
                                    result.path_pair.primary.is_disabled = true;
                                    result.path_pair.primary = Fs.Path.initWithNamespace(remap, "file");
                                } else {
                                    switch (r.resolveWithoutRemapping(browser_scope, remap, kind, global_cache)) {
                                        .success => |remapped| {
                                            result.path_pair = remapped.path_pair;
                                            result.dirname_fd = remapped.dirname_fd;
                                            result.file_fd = remapped.file_fd;
                                            result.package_json = remapped.package_json;
                                            result.diff_case = remapped.diff_case;
                                            result.module_type = remapped.module_type;
                                            result.is_external = remapped.is_external;

                                            // Potentially rewrite the import path if it's external that
                                            // was remapped to a different path
                                            result.is_external_and_rewrite_import_path = result.is_external;

                                            result.is_from_node_modules = result.is_from_node_modules or remapped.is_node_module;
                                            return .{ .success = result };
                                        },
                                        else => {},
                                    }
                                }
                            }
                        }
                    }

                    return .{ .success = result };
                },
                .pending => |p| return .{ .pending = p },
                .failure => |p| return .{ .failure = p },
                else => return .{ .not_found = {} },
            }
        }

        return .{ .success = result };
    }

    pub fn packageJSONForResolvedNodeModule(
        r: *ThisResolver,
        result: *const Result,
    ) ?*const PackageJSON {
        return @call(bun.callmod_inline, packageJSONForResolvedNodeModuleWithIgnoreMissingName, .{ r, result, true });
    }

    // This is a fallback, hopefully not called often. It should be relatively quick because everything should be in the cache.
    fn packageJSONForResolvedNodeModuleWithIgnoreMissingName(
        r: *ThisResolver,
        result: *const Result,
        comptime ignore_missing_name: bool,
    ) ?*const PackageJSON {
        var dir_info = (r.dirInfoCached(result.path_pair.primary.name.dir) catch null) orelse return null;
        while (true) {
            if (dir_info.package_json) |pkg| {
                // if it doesn't have a name, assume it's something just for adjusting the main fields (react-bootstrap does this)
                // In that case, we really would like the top-level package that you download from NPM
                // so we ignore any unnamed packages
                if (comptime !ignore_missing_name) {
                    if (pkg.name.len > 0) {
                        return pkg;
                    }
                } else {
                    return pkg;
                }
            }

            dir_info = dir_info.getParent() orelse return null;
        }

        unreachable;
    }
    const node_module_root_string = std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str;

    pub fn rootNodeModulePackageJSON(
        r: *ThisResolver,
        result: *const Result,
    ) ?RootPathPair {
        const path = (result.pathConst() orelse return null);
        var absolute = path.text;
        // /foo/node_modules/@babel/standalone/index.js
        //     ^------------^
        var end = strings.lastIndexOf(absolute, node_module_root_string) orelse brk: {
            // try non-symlinked version
            if (path.pretty.len != absolute.len) {
                absolute = path.pretty;
                break :brk strings.lastIndexOf(absolute, node_module_root_string);
            }

            break :brk null;
        } orelse return null;
        end += node_module_root_string.len;

        const is_scoped_package = absolute[end] == '@';
        end += strings.indexOfChar(absolute[end..], std.fs.path.sep) orelse return null;

        // /foo/node_modules/@babel/standalone/index.js
        //                   ^
        if (is_scoped_package) {
            end += 1;
            end += strings.indexOfChar(absolute[end..], std.fs.path.sep) orelse return null;
        }

        end += 1;

        // /foo/node_modules/@babel/standalone/index.js
        //                                    ^
        const slice = absolute[0..end];

        // Try to avoid the hash table lookup whenever possible
        // That can cause filesystem lookups in parent directories and it requires a lock
        if (result.package_json) |pkg| {
            if (strings.eql(slice, pkg.source.path.name.dirWithTrailingSlash())) {
                return RootPathPair{
                    .package_json = pkg,
                    .base_path = slice,
                };
            }
        }

        {
            const dir_info = (r.dirInfoCached(slice) catch null) orelse return null;
            return RootPathPair{
                .base_path = slice,
                .package_json = dir_info.package_json orelse return null,
            };
        }
    }

    const dev = Output.scoped(.Resolver, false);

    /// Directory cache keys must follow the following rules. If the rules are broken,
    /// then there will be conflicting cache entries, and trying to bust the cache may not work.
    ///
    /// When an incorrect cache key is used, this assertion will trip; ignoring it allows
    /// very very subtle cache invalidation issues to happen, which will cause modules to
    /// mysteriously fail to resolve.
    ///
    /// The rules for this changed in https://github.com/oven-sh/bun/pull/9144 after multiple
    /// cache issues were found on Windows. These issues extended to other platforms because
    /// we never checked if the cache key was following the rules.
    ///
    /// CACHE KEY RULES:
    /// A cache key must use native slashes, and must NOT end with a trailing slash.
    /// But drive roots MUST have a trailing slash ('/' and 'C:\')
    /// UNC paths, even if the root, must not have the trailing slash.
    ///
    /// The helper function bun.strings.pathWithoutTrailingSlashOne can be used to remove
    /// the trailing slash from a path, but also note it will only remove a SINGLE slash.
    pub fn assertValidCacheKey(path: []const u8) void {
        if (Environment.allow_assert) {
            if (path.len > 1 and strings.charIsAnySlash(path[path.len - 1]) and !if (Environment.isWindows)
                path.len == 3 and path[1] == ':'
            else
                path.len == 1)
            {
                std.debug.panic("Internal Assertion Failure: Invalid cache key \"{s}\"\nSee Resolver.assertValidCacheKey for details.", .{path});
            }
        }
    }

    /// Bust the directory cache for the given path.
    /// See `assertValidCacheKey` for requirements on the input
    pub fn bustDirCache(r: *ThisResolver, path: string) bool {
        assertValidCacheKey(path);
        const first_bust = r.fs.fs.bustEntriesCache(path);
        const second_bust = r.dir_cache.remove(path);
        dev("Bust {s} = {}, {}", .{ path, first_bust, second_bust });
        return first_bust or second_bust;
    }

    pub fn loadNodeModules(
        r: *ThisResolver,
        import_path: string,
        kind: ast.ImportKind,
        _dir_info: *DirInfo,
        global_cache: GlobalCache,
        forbid_imports: bool,
    ) MatchResult.Union {
        var dir_info = _dir_info;
        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Searching for {s} in \"node_modules\" directories starting from \"{s}\"", .{ import_path, dir_info.abs_path });
            debug.increaseIndent();
        }

        defer {
            if (r.debug_logs) |*debug| {
                debug.decreaseIndent();
            }
        }

        // First, check path overrides from the nearest enclosing TypeScript "tsconfig.json" file

        if (dir_info.enclosing_tsconfig_json) |tsconfig| {
            // Try path substitutions first
            if (tsconfig.paths.count() > 0) {
                if (r.matchTSConfigPaths(tsconfig, import_path, kind)) |res| {
                    return .{ .success = res };
                }
            }

            // Try looking up the path relative to the base URL
            if (tsconfig.hasBaseURL()) {
                const base = tsconfig.base_url;
                const paths = [_]string{ base, import_path };
                const abs = r.fs.absBuf(&paths, bufs(.load_as_file_or_directory_via_tsconfig_base_path));

                if (r.loadAsFileOrDirectory(abs, kind)) |res| {
                    return .{ .success = res };
                }
                // r.allocator.free(abs);
            }
        }

        // Find the parent directory with the "package.json" file
        var dir_info_package_json: ?*DirInfo = dir_info;
        while (dir_info_package_json != null and dir_info_package_json.?.package_json == null)
            dir_info_package_json = dir_info_package_json.?.getParent();

        // Check for subpath imports: https://nodejs.org/api/packages.html#subpath-imports
        if (dir_info_package_json != null and
            strings.hasPrefixComptime(import_path, "#") and
            !forbid_imports and
            dir_info_package_json.?.package_json.?.imports != null)
        {
            return r.loadPackageImports(import_path, dir_info_package_json.?, kind, global_cache);
        }

        const esm_ = ESModule.Package.parse(import_path, bufs(.esm_subpath));

        const source_dir_info = dir_info;
        var any_node_modules_folder = false;
        const use_node_module_resolver = global_cache != .force;

        // Then check for the package in any enclosing "node_modules" directories
        while (use_node_module_resolver) {
            // Skip directories that are themselves called "node_modules", since we
            // don't ever want to search for "node_modules/node_modules"
            if (dir_info.hasNodeModules()) {
                any_node_modules_folder = true;
                var _paths = [_]string{ dir_info.abs_path, "node_modules", import_path };
                const abs_path = r.fs.absBuf(&_paths, bufs(.node_modules_check));
                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Checking for a package in the directory \"{s}\"", .{abs_path});
                }
                const prev_extension_order = r.extension_order;
                defer r.extension_order = prev_extension_order;

                if (esm_) |esm| {
                    const abs_package_path = brk: {
                        var parts = [_]string{ dir_info.abs_path, "node_modules", esm.name };
                        break :brk r.fs.absBuf(&parts, bufs(.esm_absolute_package_path));
                    };

                    if (r.dirInfoCached(abs_package_path) catch null) |pkg_dir_info| {
                        r.extension_order = switch (kind) {
                            .url, .at_conditional, .at => options.BundleOptions.Defaults.CSSExtensionOrder[0..],
                            else => r.opts.extension_order.kind(kind, true),
                        };

                        if (pkg_dir_info.package_json) |package_json| {
                            if (package_json.exports) |exports_map| {

                                // The condition set is determined by the kind of import
                                var module_type = options.ModuleType.unknown;
                                var esmodule = ESModule{
                                    .conditions = switch (kind) {
                                        ast.ImportKind.require, ast.ImportKind.require_resolve => r.opts.conditions.require,
                                        else => r.opts.conditions.import,
                                    },
                                    .allocator = r.allocator,
                                    .debug_logs = if (r.debug_logs) |*debug| debug else null,
                                    .module_type = &module_type,
                                };

                                // Resolve against the path "/", then join it with the absolute
                                // directory path. This is done because ESM package resolution uses
                                // URLs while our path resolution uses file system paths. We don't
                                // want problems due to Windows paths, which are very unlike URL
                                // paths. We also want to avoid any "%" characters in the absolute
                                // directory path accidentally being interpreted as URL escapes.
                                {
                                    const esm_resolution = esmodule.resolve("/", esm.subpath, exports_map.root);

                                    if (r.handleESMResolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath)) |result| {
                                        var result_copy = result;
                                        result_copy.is_node_module = true;
                                        result_copy.module_type = module_type;
                                        return .{ .success = result_copy };
                                    }
                                }

                                // Some popular packages forget to include the extension in their
                                // exports map, so we try again without the extension.
                                //
                                // This is useful for browser-like environments
                                // where you want a file extension in the URL
                                // pathname by convention. Vite does this.
                                //
                                // React is an example of a package that doesn't include file extensions.
                                // {
                                //     "exports": {
                                //         ".": "./index.js",
                                //         "./jsx-runtime": "./jsx-runtime.js",
                                //     }
                                // }
                                //
                                // We limit this behavior just to ".js" files.
                                const extname = std.fs.path.extension(esm.subpath);
                                if (strings.eqlComptime(extname, ".js") and esm.subpath.len > 3) {
                                    const esm_resolution = esmodule.resolve("/", esm.subpath[0 .. esm.subpath.len - 3], exports_map.root);
                                    if (r.handleESMResolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath)) |result| {
                                        var result_copy = result;
                                        result_copy.is_node_module = true;
                                        result_copy.module_type = module_type;
                                        return .{ .success = result_copy };
                                    }
                                }

                                // if they hid "package.json" from "exports", still allow importing it.
                                if (strings.eqlComptime(esm.subpath, "./package.json")) {
                                    return .{
                                        .success = .{
                                            .path_pair = .{ .primary = package_json.source.path },
                                            .dirname_fd = pkg_dir_info.getFileDescriptor(),
                                            .file_fd = .zero,
                                            .is_node_module = package_json.source.path.isNodeModule(),
                                            .package_json = package_json,
                                            .dir_info = dir_info,
                                        },
                                    };
                                }

                                return .{ .not_found = {} };
                            }
                        }
                    }
                }

                if (r.loadAsFileOrDirectory(abs_path, kind)) |res| {
                    return .{ .success = res };
                }
            }

            dir_info = dir_info.getParent() orelse break;
        }

        dir_info = source_dir_info;

        // this is the magic!
        if (global_cache.canUse(any_node_modules_folder) and r.usePackageManager() and esm_ != null) {
            if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .RunCommand) unreachable;
            const esm = esm_.?.withAutoVersion();
            load_module_from_cache: {
                // If the source directory doesn't have a node_modules directory, we can
                // check the global cache directory for a package.json file.
                var manager = r.getPackageManager();
                var dependency_version = Dependency.Version{};
                var dependency_behavior = Dependency.Behavior.normal;
                var string_buf = esm.version;

                // const initial_pending_tasks = manager.pending_tasks;
                var resolved_package_id: Install.PackageID = brk: {
                    // check if the package.json in the source directory was already added to the lockfile
                    // and try to look up the dependency from there
                    if (dir_info.package_json_for_dependencies) |package_json| {
                        var dependencies_list: []const Dependency = &[_]Dependency{};
                        const resolve_from_lockfile = package_json.package_manager_package_id != Install.invalid_package_id;

                        if (resolve_from_lockfile) {
                            const dependencies = &manager.lockfile.packages.items(.dependencies)[package_json.package_manager_package_id];

                            // try to find this package name in the dependencies of the enclosing package
                            dependencies_list = dependencies.get(manager.lockfile.buffers.dependencies.items);
                            string_buf = manager.lockfile.buffers.string_bytes.items;
                        } else if (esm_.?.version.len == 0) {
                            // If you don't specify a version, default to the one chosen in your package.json
                            dependencies_list = package_json.dependencies.map.values();
                            string_buf = package_json.dependencies.source_buf;
                        }

                        for (dependencies_list, 0..) |dependency, dependency_id| {
                            if (!strings.eqlLong(dependency.name.slice(string_buf), esm.name, true)) {
                                continue;
                            }

                            dependency_version = dependency.version;
                            dependency_behavior = dependency.behavior;

                            if (resolve_from_lockfile) {
                                const resolutions = &manager.lockfile.packages.items(.resolutions)[package_json.package_manager_package_id];

                                // found it!
                                break :brk resolutions.get(manager.lockfile.buffers.resolutions.items)[dependency_id];
                            }

                            break;
                        }
                    }

                    // If we get here, it means that the lockfile doesn't have this package at all.
                    // we know nothing
                    break :brk Install.invalid_package_id;
                };

                // Now, there are two possible states:
                // 1) We have resolved the package ID, either from the
                //    lockfile globally OR from the particular package.json
                //    dependencies list
                //
                // 2) We parsed the Dependency.Version but there is no
                //    existing resolved package ID

                // If its an exact version, we can just immediately look it up in the global cache and resolve from there
                // If the resolved package ID is _not_ invalid, we can just check

                // If this returns null, then it means we need to *resolve* the package
                // Even after resolution, we might still need to download the package
                // There are two steps here! Two steps!
                const resolution: Resolution = brk: {
                    if (resolved_package_id == Install.invalid_package_id) {
                        if (dependency_version.tag == .uninitialized) {
                            const sliced_string = Semver.SlicedString.init(esm.version, esm.version);
                            if (esm_.?.version.len > 0 and dir_info.enclosing_package_json != null and global_cache.allowVersionSpecifier()) {
                                return .{ .failure = error.VersionSpecifierNotAllowedHere };
                            }
                            string_buf = esm.version;
                            dependency_version = Dependency.parse(
                                r.allocator,
                                Semver.String.init(esm.name, esm.name),
                                null,
                                esm.version,
                                &sliced_string,
                                r.log,
                            ) orelse break :load_module_from_cache;
                        }

                        if (manager.lockfile.resolve(esm.name, dependency_version)) |id| {
                            resolved_package_id = id;
                        }
                    }

                    if (resolved_package_id != Install.invalid_package_id) {
                        break :brk manager.lockfile.packages.items(.resolution)[resolved_package_id];
                    }

                    // unsupported or not found dependency, we might need to install it to the cache
                    switch (r.enqueueDependencyToResolve(
                        dir_info.package_json_for_dependencies orelse dir_info.package_json,
                        esm,
                        dependency_behavior,
                        &resolved_package_id,
                        dependency_version,
                        string_buf,
                    )) {
                        .resolution => |res| break :brk res,
                        .pending => |pending| return .{ .pending = pending },
                        .failure => |err| return .{ .failure = err },
                        // this means we looked it up in the registry and the package doesn't exist or the version doesn't exist
                        .not_found => return .{ .not_found = {} },
                    }
                };

                const dir_path_for_resolution = manager.pathForResolution(resolved_package_id, resolution, bufs(.path_in_global_disk_cache)) catch |err| {
                    // if it's missing, we need to install it
                    if (err == error.FileNotFound) {
                        switch (manager.getPreinstallState(resolved_package_id)) {
                            .done => {
                                var path = Fs.Path.init(import_path);
                                path.is_disabled = true;
                                // this might mean the package is disabled
                                return .{
                                    .success = .{
                                        .path_pair = .{
                                            .primary = path,
                                        },
                                    },
                                };
                            },
                            .extract, .extracting => |st| {
                                if (!global_cache.canInstall()) {
                                    return .{ .not_found = {} };
                                }
                                var builder = Semver.String.Builder{};
                                esm.count(&builder);
                                builder.allocate(manager.allocator) catch unreachable;
                                const cloned = esm.clone(&builder);

                                if (st == .extract)
                                    manager.enqueuePackageForDownload(
                                        esm.name,
                                        manager.lockfile.buffers.legacyPackageToDependencyID(null, resolved_package_id) catch unreachable,
                                        resolved_package_id,
                                        resolution.value.npm.version,
                                        manager.lockfile.str(&resolution.value.npm.url),
                                        .{
                                            .root_request_id = 0,
                                        },
                                        null,
                                    );

                                return .{
                                    .pending = .{
                                        .esm = cloned,
                                        .dependency = dependency_version,
                                        .resolution_id = resolved_package_id,

                                        .string_buf = builder.allocatedSlice(),
                                        .tag = .download,
                                    },
                                };
                            },
                            else => {},
                        }
                    }

                    return .{ .failure = err };
                };

                if (r.dirInfoForResolution(dir_path_for_resolution, resolved_package_id)) |dir_info_to_use_| {
                    if (dir_info_to_use_) |pkg_dir_info| {
                        const abs_package_path = pkg_dir_info.abs_path;
                        var module_type = options.ModuleType.unknown;
                        if (pkg_dir_info.package_json) |package_json| {
                            if (package_json.exports) |exports_map| {
                                // The condition set is determined by the kind of import
                                const esmodule = ESModule{
                                    .conditions = switch (kind) {
                                        ast.ImportKind.require,
                                        ast.ImportKind.require_resolve,
                                        => r.opts.conditions.require,
                                        else => r.opts.conditions.import,
                                    },
                                    .allocator = r.allocator,
                                    .module_type = &module_type,
                                    .debug_logs = if (r.debug_logs) |*debug|
                                        debug
                                    else
                                        null,
                                };

                                // Resolve against the path "/", then join it with the absolute
                                // directory path. This is done because ESM package resolution uses
                                // URLs while our path resolution uses file system paths. We don't
                                // want problems due to Windows paths, which are very unlike URL
                                // paths. We also want to avoid any "%" characters in the absolute
                                // directory path accidentally being interpreted as URL escapes.
                                {
                                    const esm_resolution = esmodule.resolve("/", esm.subpath, exports_map.root);

                                    if (r.handleESMResolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath)) |result| {
                                        var result_copy = result;
                                        result_copy.is_node_module = true;
                                        return .{ .success = result_copy };
                                    }
                                }

                                // Some popular packages forget to include the extension in their
                                // exports map, so we try again without the extension.
                                //
                                // This is useful for browser-like environments
                                // where you want a file extension in the URL
                                // pathname by convention. Vite does this.
                                //
                                // React is an example of a package that doesn't include file extensions.
                                // {
                                //     "exports": {
                                //         ".": "./index.js",
                                //         "./jsx-runtime": "./jsx-runtime.js",
                                //     }
                                // }
                                //
                                // We limit this behavior just to ".js" files.
                                const extname = std.fs.path.extension(esm.subpath);
                                if (strings.eqlComptime(extname, ".js") and esm.subpath.len > 3) {
                                    const esm_resolution = esmodule.resolve("/", esm.subpath[0 .. esm.subpath.len - 3], exports_map.root);
                                    if (r.handleESMResolution(esm_resolution, abs_package_path, kind, package_json, esm.subpath)) |result| {
                                        var result_copy = result;
                                        result_copy.is_node_module = true;
                                        return .{ .success = result_copy };
                                    }
                                }

                                // if they hid "package.json" from "exports", still allow importing it.
                                if (strings.eqlComptime(esm.subpath, "./package.json")) {
                                    return .{
                                        .success = .{
                                            .path_pair = .{ .primary = package_json.source.path },
                                            .dirname_fd = pkg_dir_info.getFileDescriptor(),
                                            .file_fd = .zero,
                                            .is_node_module = package_json.source.path.isNodeModule(),
                                            .package_json = package_json,
                                            .dir_info = dir_info,
                                        },
                                    };
                                }

                                return .{ .not_found = {} };
                            }
                        }

                        var _paths = [_]string{ pkg_dir_info.abs_path, esm.subpath };
                        const abs_path = r.fs.absBuf(&_paths, bufs(.node_modules_check));
                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Checking for a package in the directory \"{s}\"", .{abs_path});
                        }

                        var tmp = r.loadAsFileOrDirectory(abs_path, kind);
                        if (tmp) |*res| {
                            res.is_node_module = true;
                            return .{ .success = res.* };
                        }
                    }
                } else |err| {
                    return .{ .failure = err };
                }
            }
        }

        // Mostly to cut scope, we don't resolve `NODE_PATH` environment variable.
        // But also: https://github.com/nodejs/node/issues/38128#issuecomment-814969356
        return .{ .not_found = {} };
    }
    fn dirInfoForResolution(
        r: *ThisResolver,
        dir_path_maybe_trail_slash: string,
        package_id: Install.PackageID,
    ) !?*DirInfo {
        assert(r.package_manager != null);

        const dir_path = strings.pathWithoutTrailingSlashOne(dir_path_maybe_trail_slash);

        assertValidCacheKey(dir_path);
        var dir_cache_info_result = r.dir_cache.getOrPut(dir_path) catch bun.outOfMemory();
        if (dir_cache_info_result.status == .exists) {
            // we've already looked up this package before
            return r.dir_cache.atIndex(dir_cache_info_result.index).?;
        }
        var rfs = &r.fs.fs;
        var cached_dir_entry_result = rfs.entries.getOrPut(dir_path) catch bun.outOfMemory();

        var dir_entries_option: *Fs.FileSystem.RealFS.EntriesOption = undefined;
        var needs_iter = true;
        var in_place: ?*Fs.FileSystem.DirEntry = null;
        const open_dir = bun.openDirForIteration(std.fs.cwd(), dir_path) catch |err| {
            // TODO: handle this error better
            r.log.addErrorFmt(
                null,
                logger.Loc.Empty,
                r.allocator,
                "Unable to open directory: {s}",
                .{bun.asByteSlice(@errorName(err))},
            ) catch unreachable;
            return err;
        };

        if (rfs.entries.atIndex(cached_dir_entry_result.index)) |cached_entry| {
            if (cached_entry.* == .entries) {
                if (cached_entry.entries.generation >= r.generation) {
                    dir_entries_option = cached_entry;
                    needs_iter = false;
                } else {
                    in_place = cached_entry.entries;
                }
            }
        }

        if (needs_iter) {
            const allocator = bun.fs_allocator;
            var new_entry = Fs.FileSystem.DirEntry.init(
                if (in_place) |existing| existing.dir else Fs.FileSystem.DirnameStore.instance.append(string, dir_path) catch unreachable,
                r.generation,
            );

            var dir_iterator = bun.iterateDir(open_dir);
            while (dir_iterator.next().unwrap() catch null) |_value| {
                new_entry.addEntry(
                    if (in_place) |existing| &existing.data else null,
                    &_value,
                    allocator,
                    void,
                    {},
                ) catch unreachable;
            }
            if (in_place) |existing| {
                existing.data.clearAndFree(allocator);
            }

            var dir_entries_ptr = in_place orelse allocator.create(Fs.FileSystem.DirEntry) catch unreachable;
            dir_entries_ptr.* = new_entry;

            if (r.store_fd) {
                dir_entries_ptr.fd = bun.toFD(open_dir.fd);
            }

            bun.fs.debug("readdir({}, {s}) = {d}", .{ bun.toFD(open_dir.fd), dir_path, dir_entries_ptr.data.count() });

            dir_entries_option = rfs.entries.put(&cached_dir_entry_result, .{
                .entries = dir_entries_ptr,
            }) catch unreachable;
        }

        // We must initialize it as empty so that the result index is correct.
        // This is important so that browser_scope has a valid index.
        const dir_info_ptr = r.dir_cache.put(&dir_cache_info_result, .{}) catch unreachable;

        try r.dirInfoUncached(
            dir_info_ptr,
            dir_path,
            dir_entries_option,
            dir_cache_info_result,
            cached_dir_entry_result.index,
            // Packages in the global disk cache are top-level, we shouldn't try
            // to check for a parent package.json
            null,
            allocators.NotFound,
            bun.toFD(open_dir.fd),
            package_id,
        );
        return dir_info_ptr;
    }

    const DependencyToResolve = union(enum) {
        not_found: void,
        pending: PendingResolution,
        failure: anyerror,
        resolution: Resolution,
    };

    fn enqueueDependencyToResolve(
        r: *ThisResolver,
        package_json_: ?*PackageJSON,
        esm: ESModule.Package,
        behavior: Dependency.Behavior,
        input_package_id_: *Install.PackageID,
        version: Dependency.Version,
        version_buf: []const u8,
    ) DependencyToResolve {
        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Enqueueing pending dependency \"{s}@{s}\"", .{ esm.name, esm.version });
        }

        const input_package_id = input_package_id_.*;
        var pm = r.getPackageManager();
        if (comptime Environment.allow_assert) {
            // we should never be trying to resolve a dependency that is already resolved
            assert(pm.lockfile.resolve(esm.name, version) == null);
        }

        // Add the containing package to the lockfile

        var package: Package = .{};

        const is_main = pm.lockfile.packages.len == 0 and input_package_id == Install.invalid_package_id;
        if (is_main) {
            if (package_json_) |package_json| {
                package = Package.fromPackageJSON(
                    pm.lockfile,
                    package_json,
                    Install.Features{
                        .dev_dependencies = true,
                        .is_main = true,
                        .dependencies = true,
                        .optional_dependencies = true,
                    },
                ) catch |err| {
                    return .{ .failure = err };
                };
                package.meta.setHasInstallScript(package.scripts.hasAny());
                package = pm.lockfile.appendPackage(package) catch |err| {
                    return .{ .failure = err };
                };
                package_json.package_manager_package_id = package.meta.id;
            } else {
                // we're resolving an unknown package
                // the unknown package is the root package
                package = Package{
                    .name = Semver.String.from(""),
                    .resolution = .{
                        .tag = .root,
                        .value = .{ .root = {} },
                    },
                };
                package.meta.setHasInstallScript(package.scripts.hasAny());
                package = pm.lockfile.appendPackage(package) catch |err| {
                    return .{ .failure = err };
                };
            }
        }

        if (r.opts.prefer_offline_install) {
            if (pm.resolveFromDiskCache(esm.name, version)) |package_id| {
                input_package_id_.* = package_id;
                return .{ .resolution = pm.lockfile.packages.items(.resolution)[package_id] };
            }
        }

        if (input_package_id == Install.invalid_package_id or input_package_id == 0) {

            // All packages are enqueued to the root
            // because we download all the npm package dependencies
            switch (pm.enqueueDependencyToRoot(esm.name, &version, version_buf, behavior)) {
                .resolution => |result| {
                    input_package_id_.* = result.package_id;
                    return .{ .resolution = result.resolution };
                },
                .pending => |id| {
                    var builder = Semver.String.Builder{};
                    esm.count(&builder);
                    builder.allocate(pm.allocator) catch unreachable;
                    const cloned = esm.clone(&builder);

                    return .{
                        .pending = .{
                            .esm = cloned,
                            .dependency = version,
                            .root_dependency_id = id,
                            .string_buf = builder.allocatedSlice(),
                            .tag = .resolve,
                        },
                    };
                },
                .not_found => {
                    return .{ .not_found = {} };
                },
                .failure => |err| {
                    return .{ .failure = err };
                },
            }
        }

        bun.unreachablePanic("TODO: implement enqueueDependencyToResolve for non-root packages", .{});
    }

    fn handleESMResolution(r: *ThisResolver, esm_resolution_: ESModule.Resolution, abs_package_path: string, kind: ast.ImportKind, package_json: *PackageJSON, package_subpath: string) ?MatchResult {
        var esm_resolution = esm_resolution_;
        if (!((esm_resolution.status == .Inexact or esm_resolution.status == .Exact or esm_resolution.status == .ExactEndsWithStar) and
            esm_resolution.path.len > 0 and esm_resolution.path[0] == std.fs.path.sep))
            return null;

        const abs_esm_path: string = brk: {
            var parts = [_]string{
                abs_package_path,
                strings.withoutLeadingPathSeparator(esm_resolution.path),
            };
            break :brk r.fs.absBuf(&parts, bufs(.esm_absolute_package_path_joined));
        };

        var missing_suffix: string = "";

        switch (esm_resolution.status) {
            .Exact, .ExactEndsWithStar => {
                const resolved_dir_info = (r.dirInfoCached(std.fs.path.dirname(abs_esm_path).?) catch null) orelse {
                    esm_resolution.status = .ModuleNotFound;
                    return null;
                };
                const entries = resolved_dir_info.getEntries(r.generation) orelse {
                    esm_resolution.status = .ModuleNotFound;
                    return null;
                };
                const extension_order = if (kind == .at or kind == .at_conditional)
                    r.extension_order
                else
                    r.opts.extension_order.kind(kind, resolved_dir_info.isInsideNodeModules());

                const base = std.fs.path.basename(abs_esm_path);
                const entry_query = entries.get(base) orelse {
                    const ends_with_star = esm_resolution.status == .ExactEndsWithStar;
                    esm_resolution.status = .ModuleNotFound;

                    // Try to have a friendly error message if people forget the extension
                    if (ends_with_star) {
                        bun.copy(u8, bufs(.load_as_file), base);
                        for (extension_order) |ext| {
                            var file_name = bufs(.load_as_file)[0 .. base.len + ext.len];
                            bun.copy(u8, file_name[base.len..], ext);
                            if (entries.get(file_name) != null) {
                                if (r.debug_logs) |*debug| {
                                    const parts = [_]string{ package_json.name, package_subpath };
                                    debug.addNoteFmt("The import {s} is missing the extension {s}", .{ ResolvePath.join(parts, .auto), ext });
                                }
                                esm_resolution.status = .ModuleNotFoundMissingExtension;
                                missing_suffix = ext;
                                break;
                            }
                        }
                    }
                    return null;
                };

                if (entry_query.entry.kind(&r.fs.fs, r.store_fd) == .dir) {
                    const ends_with_star = esm_resolution.status == .ExactEndsWithStar;
                    esm_resolution.status = .UnsupportedDirectoryImport;

                    // Try to have a friendly error message if people forget the "/index.js" suffix
                    if (ends_with_star) {
                        if (r.dirInfoCached(abs_esm_path) catch null) |dir_info| {
                            if (dir_info.getEntries(r.generation)) |dir_entries| {
                                const index = "index";
                                bun.copy(u8, bufs(.load_as_file), index);
                                for (extension_order) |ext| {
                                    var file_name = bufs(.load_as_file)[0 .. index.len + ext.len];
                                    bun.copy(u8, file_name[index.len..], ext);
                                    const index_query = dir_entries.get(file_name);
                                    if (index_query != null and index_query.?.entry.kind(&r.fs.fs, r.store_fd) == .file) {
                                        if (r.debug_logs) |*debug| {
                                            missing_suffix = std.fmt.allocPrint(r.allocator, "/{s}", .{file_name}) catch unreachable;
                                            defer r.allocator.free(missing_suffix);
                                            const parts = [_]string{ package_json.name, package_subpath };
                                            debug.addNoteFmt("The import {s} is missing the suffix {s}", .{ ResolvePath.join(parts, .auto), missing_suffix });
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    return null;
                }

                const absolute_out_path = brk: {
                    if (entry_query.entry.abs_path.isEmpty()) {
                        entry_query.entry.abs_path =
                            PathString.init(r.fs.dirname_store.append(@TypeOf(abs_esm_path), abs_esm_path) catch unreachable);
                    }
                    break :brk entry_query.entry.abs_path.slice();
                };

                return MatchResult{
                    .path_pair = PathPair{
                        .primary = Path.initWithNamespace(absolute_out_path, "file"),
                    },
                    .dirname_fd = entries.fd,
                    .file_fd = entry_query.entry.cache.fd,
                    .dir_info = resolved_dir_info,
                    .diff_case = entry_query.diff_case,
                    .is_node_module = true,
                    .package_json = resolved_dir_info.package_json orelse package_json,
                };
            },
            .Inexact => {
                // If this was resolved against an expansion key ending in a "/"
                // instead of a "*", we need to try CommonJS-style implicit
                // extension and/or directory detection.
                if (r.loadAsFileOrDirectory(abs_esm_path, kind)) |res| {
                    var res_copy = res;
                    res_copy.is_node_module = true;
                    res_copy.package_json = res.package_json orelse package_json;
                    return res_copy;
                }
                esm_resolution.status = .ModuleNotFound;
                return null;
            },
            else => unreachable,
        }
    }

    pub fn resolveWithoutRemapping(
        r: *ThisResolver,
        source_dir_info: *DirInfo,
        import_path: string,
        kind: ast.ImportKind,
        global_cache: GlobalCache,
    ) MatchResult.Union {
        if (isPackagePath(import_path)) {
            return r.loadNodeModules(import_path, kind, source_dir_info, global_cache, false);
        } else {
            const paths = [_]string{ source_dir_info.abs_path, import_path };
            const resolved = r.fs.absBuf(&paths, bufs(.resolve_without_remapping));
            if (r.loadAsFileOrDirectory(resolved, kind)) |result| {
                return .{ .success = result };
            }
            return .{ .not_found = {} };
        }
    }

    pub fn parseTSConfig(
        r: *ThisResolver,
        file: string,
        dirname_fd: StoredFileDescriptorType,
    ) !?*TSConfigJSON {
        // Since tsconfig.json is cached permanently, in our DirEntries cache
        // we must use the global allocator
        var entry = try r.caches.fs.readFileWithAllocator(
            bun.fs_allocator,
            r.fs,
            file,
            dirname_fd,
            false,
            null,
        );
        defer _ = entry.closeFD();

        // The file name needs to be persistent because it can have errors
        // and if those errors need to print the filename
        // then it will be undefined memory if we parse another tsconfig.json late
        const key_path = Fs.Path.init(r.fs.dirname_store.append(string, file) catch unreachable);

        const source = logger.Source.initPathString(key_path.text, entry.contents);
        const file_dir = source.path.sourceDir();

        var result = (try TSConfigJSON.parse(bun.default_allocator, r.log, source, &r.caches.json)) orelse return null;

        if (result.hasBaseURL()) {

            // this might leak
            if (!std.fs.path.isAbsolute(result.base_url)) {
                const paths = [_]string{ file_dir, result.base_url };
                result.base_url = r.fs.dirname_store.append(string, r.fs.absBuf(&paths, bufs(.tsconfig_base_url))) catch unreachable;
            }
        }

        if (result.paths.count() > 0 and (result.base_url_for_paths.len == 0 or !std.fs.path.isAbsolute(result.base_url_for_paths))) {
            // this might leak
            const paths = [_]string{ file_dir, result.base_url };
            result.base_url_for_paths = r.fs.dirname_store.append(string, r.fs.absBuf(&paths, bufs(.tsconfig_base_url))) catch unreachable;
        }

        return result;
    }

    // TODO:
    pub fn prettyPath(_: *ThisResolver, path: Path) string {
        return path.text;
    }

    pub fn binDirs(_: *const ThisResolver) []const string {
        if (!bin_folders_loaded) return &[_]string{};
        return bin_folders.constSlice();
    }

    pub fn parsePackageJSON(
        r: *ThisResolver,
        file: string,
        dirname_fd: StoredFileDescriptorType,
        package_id: ?Install.PackageID,
        comptime allow_dependencies: bool,
    ) !?*PackageJSON {
        var pkg: PackageJSON = undefined;
        if (!r.care_about_scripts) {
            pkg = PackageJSON.parse(
                r,
                file,
                dirname_fd,
                package_id,
                .ignore_scripts,
                if (allow_dependencies) .local else .none,
                .generate_hash,
            ) orelse return null;
        } else {
            pkg = PackageJSON.parse(
                r,
                file,
                dirname_fd,
                package_id,
                .include_scripts,
                if (allow_dependencies) .local else .none,
                .generate_hash,
            ) orelse return null;
        }

        return PackageJSON.new(pkg);
    }

    fn dirInfoCached(
        r: *ThisResolver,
        path: string,
    ) !?*DirInfo {
        return try r.dirInfoCachedMaybeLog(path, true, true);
    }

    /// The path must have a trailing slash and a sentinel 0
    pub fn readDirInfo(
        r: *ThisResolver,
        path: string,
    ) !?*DirInfo {
        return try r.dirInfoCachedMaybeLog(path, false, true);
    }

    pub fn readDirInfoIgnoreError(
        r: *ThisResolver,
        path: string,
    ) ?*const DirInfo {
        return r.dirInfoCachedMaybeLog(path, false, true) catch null;
    }

    inline fn isDotSlash(path: string) bool {
        return switch (Environment.os) {
            else => strings.eqlComptime(path, "./"),
            .windows => path.len == 2 and path[0] == '.' and strings.charIsAnySlash(path[1]),
        };
    }

    threadlocal var win32_normalized_dir_info_cache_buf: if (Environment.isWindows) [bun.MAX_PATH_BYTES * 2]u8 else void = undefined;
    fn dirInfoCachedMaybeLog(r: *ThisResolver, raw_input_path: string, comptime enable_logging: bool, comptime follow_symlinks: bool) !?*DirInfo {
        r.mutex.lock();
        defer r.mutex.unlock();
        var input_path = raw_input_path;

        if (isDotSlash(input_path) or strings.eqlComptime(input_path, ".")) {
            input_path = r.fs.top_level_dir;
        }

        if (comptime Environment.isWindows) {
            input_path = r.fs.normalizeBuf(&win32_normalized_dir_info_cache_buf, input_path);
            // kind of a patch on the fact normalizeBuf isn't 100% perfect what we want
            if ((input_path.len == 2 and input_path[1] == ':') or
                (input_path.len == 3 and input_path[1] == ':' and input_path[2] == '.'))
            {
                bun.unsafeAssert(input_path.ptr == &win32_normalized_dir_info_cache_buf);
                win32_normalized_dir_info_cache_buf[2] = '\\';
                input_path.len = 3;
            }

            // Filter out \\hello\, a UNC server path but without a share.
            // When there isn't a share name, such path is not considered to exist.
            if (bun.strings.hasPrefixComptime(input_path, "\\\\")) {
                const first_slash = bun.strings.indexOfChar(input_path[2..], '\\') orelse
                    return null;
                _ = bun.strings.indexOfChar(input_path[2 + first_slash ..], '\\') orelse
                    return null;
            }
        }

        assert(std.fs.path.isAbsolute(input_path));

        const path_without_trailing_slash = strings.pathWithoutTrailingSlashOne(input_path);
        assertValidCacheKey(path_without_trailing_slash);
        const top_result = try r.dir_cache.getOrPut(path_without_trailing_slash);
        if (top_result.status != .unknown) {
            return r.dir_cache.atIndex(top_result.index);
        }

        var dir_info_uncached_path_buf = bufs(.dir_info_uncached_path);

        var i: i32 = 1;
        bun.copy(u8, dir_info_uncached_path_buf, input_path);
        var path = dir_info_uncached_path_buf[0..input_path.len];

        bufs(.dir_entry_paths_to_resolve)[0] = DirEntryResolveQueueItem{ .result = top_result, .unsafe_path = path, .safe_path = "" };
        var top = Dirname.dirname(path);

        var top_parent: allocators.Result = allocators.Result{
            .index = allocators.NotFound,
            .hash = 0,
            .status = .not_found,
        };
        const root_path = if (Environment.isWindows)
            bun.strings.pathWithoutTrailingSlashOne(ResolvePath.windowsFilesystemRoot(path))
        else
            // we cannot just use "/"
            // we will write to the buffer past the ptr len so it must be a non-const buffer
            path[0..1];
        assertValidCacheKey(root_path);

        const rfs = &r.fs.fs;

        rfs.entries_mutex.lock();
        defer rfs.entries_mutex.unlock();

        while (top.len > root_path.len) : (top = Dirname.dirname(top)) {
            assert(top.ptr == root_path.ptr);
            const result = try r.dir_cache.getOrPut(top);

            if (result.status != .unknown) {
                top_parent = result;
                break;
            }
            bufs(.dir_entry_paths_to_resolve)[@as(usize, @intCast(i))] = DirEntryResolveQueueItem{
                .unsafe_path = top,
                .result = result,
                .fd = .zero,
            };

            if (rfs.entries.get(top)) |top_entry| {
                switch (top_entry.*) {
                    .entries => {
                        bufs(.dir_entry_paths_to_resolve)[@as(usize, @intCast(i))].safe_path = top_entry.entries.dir;
                        bufs(.dir_entry_paths_to_resolve)[@as(usize, @intCast(i))].fd = top_entry.entries.fd;
                    },
                    .err => |err| {
                        debuglog("Failed to load DirEntry {s}  {s} - {s}", .{ top, @errorName(err.original_err), @errorName(err.canonical_error) });
                        break;
                    },
                }
            }
            i += 1;
        }

        if (strings.eql(top, root_path)) {
            const result = try r.dir_cache.getOrPut(root_path);
            if (result.status != .unknown) {
                top_parent = result;
            } else {
                bufs(.dir_entry_paths_to_resolve)[@as(usize, @intCast(i))] = DirEntryResolveQueueItem{
                    .unsafe_path = root_path,
                    .result = result,
                    .fd = .zero,
                };
                if (rfs.entries.get(top)) |top_entry| {
                    switch (top_entry.*) {
                        .entries => {
                            bufs(.dir_entry_paths_to_resolve)[@as(usize, @intCast(i))].safe_path = top_entry.entries.dir;
                            bufs(.dir_entry_paths_to_resolve)[@as(usize, @intCast(i))].fd = top_entry.entries.fd;
                        },
                        .err => |err| {
                            debuglog("Failed to load DirEntry {s}  {s} - {s}", .{ top, @errorName(err.original_err), @errorName(err.canonical_error) });
                            return err.canonical_error;
                        },
                    }
                }

                i += 1;
            }
        }

        var queue_slice: []DirEntryResolveQueueItem = bufs(.dir_entry_paths_to_resolve)[0..@as(usize, @intCast(i))];
        if (Environment.allow_assert) assert(queue_slice.len > 0);
        var open_dir_count: usize = 0;

        // When this function halts, any item not processed means it's not found.
        defer {
            if (open_dir_count > 0 and (!r.store_fd or r.fs.fs.needToCloseFiles())) {
                const open_dirs: []std.fs.Dir = bufs(.open_dirs)[0..open_dir_count];
                for (open_dirs) |*open_dir| {
                    _ = bun.sys.close(bun.toFD(open_dir.fd));
                }
            }
        }

        // We want to walk in a straight line from the topmost directory to the desired directory
        // For each directory we visit, we get the entries, but not traverse into child directories
        // (unless those child directores are in the queue)
        // We go top-down instead of bottom-up to increase odds of reusing previously open file handles
        // "/home/jarred/Code/node_modules/react/cjs/react.development.js"
        //       ^
        // If we start there, we will traverse all of /home/jarred, including e.g. /home/jarred/Downloads
        // which is completely irrelevant.

        // After much experimentation...
        // - fts_open is not the fastest way to read directories. fts actually just uses readdir!!
        // - remember
        var _safe_path: ?string = null;

        // Start at the top.
        while (queue_slice.len > 0) {
            var queue_top = queue_slice[queue_slice.len - 1];
            defer top_parent = queue_top.result;
            queue_slice.len -= 1;

            const open_dir = if (queue_top.fd != .zero)
                queue_top.fd.asDir()
            else open_dir: {
                // This saves us N copies of .toPosixPath
                // which was likely the perf gain from resolving directories relative to the parent directory, anyway.
                const prev_char = path.ptr[queue_top.unsafe_path.len];
                path.ptr[queue_top.unsafe_path.len] = 0;
                defer path.ptr[queue_top.unsafe_path.len] = prev_char;
                const sentinel = path.ptr[0..queue_top.unsafe_path.len :0];

                const open_req = if (comptime Environment.isPosix)
                    std.fs.openDirAbsoluteZ(
                        sentinel,
                        .{ .no_follow = !follow_symlinks, .iterate = true },
                    )
                else if (comptime Environment.isWindows) open_req: {
                    const dirfd_result = bun.sys.openDirAtWindowsA(bun.invalid_fd, sentinel, .{
                        .iterable = true,
                        .no_follow = !follow_symlinks,
                        .read_only = true,
                    });
                    if (dirfd_result.unwrap()) |result| {
                        break :open_req result.asDir();
                    } else |err| {
                        break :open_req err;
                    }
                };

                bun.fs.debug("open({s}) = {any}", .{ sentinel, open_req });

                break :open_dir open_req catch |err| switch (@as(anyerror, err)) {
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
                    => return null,

                    else => {
                        const cached_dir_entry_result = rfs.entries.getOrPut(queue_top.unsafe_path) catch unreachable;
                        r.dir_cache.markNotFound(queue_top.result);
                        rfs.entries.markNotFound(cached_dir_entry_result);
                        if (comptime enable_logging) {
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
                        }
                        return null;
                    },
                };
            };

            if (queue_top.fd == .zero) {
                Fs.FileSystem.setMaxFd(open_dir.fd);
                // these objects mostly just wrap the file descriptor, so it's fine to keep it.
                bufs(.open_dirs)[open_dir_count] = open_dir;
                open_dir_count += 1;
            }

            const dir_path = if (queue_top.safe_path.len > 0) queue_top.safe_path else brk: {

                // ensure trailing slash
                if (_safe_path == null) {
                    // Now that we've opened the topmost directory successfully, it's reasonable to store the slice.
                    if (path[path.len - 1] != std.fs.path.sep) {
                        const parts = [_]string{ path, std.fs.path.sep_str };
                        _safe_path = try r.fs.dirname_store.append(@TypeOf(parts), parts);
                    } else {
                        _safe_path = try r.fs.dirname_store.append(string, path);
                    }
                }

                const safe_path = _safe_path.?;

                const dir_path_i = std.mem.indexOf(u8, safe_path, queue_top.unsafe_path) orelse unreachable;
                var end = dir_path_i +
                    queue_top.unsafe_path.len;

                // Directories must always end in a trailing slash or else various bugs can occur.
                // This covers "what happens when the trailing"
                end += @as(usize, @intCast(@intFromBool(safe_path.len > end and end > 0 and safe_path[end - 1] != std.fs.path.sep and safe_path[end] == std.fs.path.sep)));
                break :brk safe_path[dir_path_i..end];
            };

            var cached_dir_entry_result = rfs.entries.getOrPut(dir_path) catch unreachable;

            var dir_entries_option: *Fs.FileSystem.RealFS.EntriesOption = undefined;
            var needs_iter: bool = true;
            var in_place: ?*Fs.FileSystem.DirEntry = null;

            if (rfs.entries.atIndex(cached_dir_entry_result.index)) |cached_entry| {
                if (cached_entry.entries.generation >= r.generation) {
                    dir_entries_option = cached_entry;
                    needs_iter = false;
                } else {
                    in_place = cached_entry.entries;
                }
            }

            if (needs_iter) {
                const allocator = bun.fs_allocator;
                var new_entry = Fs.FileSystem.DirEntry.init(
                    if (in_place) |existing| existing.dir else Fs.FileSystem.DirnameStore.instance.append(string, dir_path) catch unreachable,
                    r.generation,
                );

                var dir_iterator = bun.iterateDir(open_dir);
                while (dir_iterator.next().unwrap() catch null) |_value| {
                    new_entry.addEntry(
                        if (in_place) |existing| &existing.data else null,
                        &_value,
                        allocator,
                        void,
                        {},
                    ) catch unreachable;
                }
                if (in_place) |existing| {
                    existing.data.clearAndFree(allocator);
                }
                new_entry.fd = if (r.store_fd) bun.toFD(open_dir.fd) else .zero;
                var dir_entries_ptr = in_place orelse allocator.create(Fs.FileSystem.DirEntry) catch unreachable;
                dir_entries_ptr.* = new_entry;
                dir_entries_option = try rfs.entries.put(&cached_dir_entry_result, .{
                    .entries = dir_entries_ptr,
                });
                bun.fs.debug("readdir({}, {s}) = {d}", .{ bun.toFD(open_dir.fd), dir_path, dir_entries_ptr.data.count() });
            }

            // We must initialize it as empty so that the result index is correct.
            // This is important so that browser_scope has a valid index.
            const dir_info_ptr = try r.dir_cache.put(&queue_top.result, DirInfo{});

            try r.dirInfoUncached(
                dir_info_ptr,
                dir_path,
                dir_entries_option,
                queue_top.result,
                cached_dir_entry_result.index,
                r.dir_cache.atIndex(top_parent.index),
                top_parent.index,
                bun.toFD(open_dir.fd),
                null,
            );

            if (queue_slice.len == 0) {
                return dir_info_ptr;

                // Is the directory we're searching for actually a file?
            } else if (queue_slice.len == 1) {
                // const next_in_queue = queue_slice[0];
                // const next_basename = std.fs.path.basename(next_in_queue.unsafe_path);
                // if (dir_info_ptr.getEntries(r.generation)) |entries| {
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
    pub fn matchTSConfigPaths(r: *ThisResolver, tsconfig: *const TSConfigJSON, path: string, kind: ast.ImportKind) ?MatchResult {
        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Matching \"{s}\" against \"paths\" in \"{s}\"", .{ path, tsconfig.abs_path });
        }

        var abs_base_url = tsconfig.base_url_for_paths;

        // The explicit base URL should take precedence over the implicit base URL
        // if present. This matters when a tsconfig.json file overrides "baseUrl"
        // from another extended tsconfig.json file but doesn't override "paths".
        if (tsconfig.hasBaseURL()) {
            abs_base_url = tsconfig.base_url;
        }

        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Using \"{s}\" as \"baseURL\"", .{abs_base_url});
        }

        // Check for exact matches first
        {
            var iter = tsconfig.paths.iterator();
            while (iter.next()) |entry| {
                const key = entry.key_ptr.*;

                if (strings.eqlLong(key, path, true)) {
                    for (entry.value_ptr.*) |original_path| {
                        var absolute_original_path = original_path;

                        if (!std.fs.path.isAbsolute(absolute_original_path)) {
                            const parts = [_]string{ abs_base_url, original_path };
                            absolute_original_path = r.fs.absBuf(&parts, bufs(.tsconfig_path_abs));
                        }

                        if (r.loadAsFileOrDirectory(absolute_original_path, kind)) |res| {
                            return res;
                        }
                    }
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
            const key = entry.key_ptr.*;
            const original_paths = entry.value_ptr.*;

            if (strings.indexOfChar(key, '*')) |star| {
                const prefix = if (star == 0) "" else key[0..star];
                const suffix = if (star == key.len - 1) "" else key[star + 1 ..];

                // Find the match with the longest prefix. If two matches have the same
                // prefix length, pick the one with the longest suffix. This second edge
                // case isn't handled by the TypeScript compiler, but we handle it
                // because we want the output to always be deterministic
                if (strings.startsWith(path, prefix) and
                    strings.endsWith(path, suffix) and
                    (prefix.len > longest_match_prefix_length or
                    (prefix.len == longest_match_prefix_length and suffix.len > longest_match_suffix_length)))
                {
                    longest_match_prefix_length = @as(i32, @intCast(prefix.len));
                    longest_match_suffix_length = @as(i32, @intCast(suffix.len));
                    longest_match = TSConfigMatch{ .prefix = prefix, .suffix = suffix, .original_paths = original_paths };
                }
            }
        }

        // If there is at least one match, only consider the one with the longest
        // prefix. This matches the behavior of the TypeScript compiler.
        if (longest_match_prefix_length != -1) {
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Found a fuzzy match for \"{s}*{s}\" in \"paths\"", .{ longest_match.prefix, longest_match.suffix });
            }

            for (longest_match.original_paths) |original_path| {
                // Swap out the "*" in the original path for whatever the "*" matched
                const matched_text = path[longest_match.prefix.len .. path.len - longest_match.suffix.len];

                const total_length: ?u32 = strings.indexOfChar(original_path, '*');
                var prefix_parts = [_]string{ abs_base_url, original_path[0 .. total_length orelse original_path.len] };

                // Concatenate the matched text with the suffix from the wildcard path
                var matched_text_with_suffix = bufs(.tsconfig_match_full_buf3);
                var matched_text_with_suffix_len: usize = 0;
                if (total_length != null) {
                    const suffix = std.mem.trimLeft(u8, original_path[total_length orelse original_path.len ..], "*");
                    matched_text_with_suffix_len = matched_text.len + suffix.len;
                    bun.concat(u8, matched_text_with_suffix, &.{ matched_text, suffix });
                }

                // 1. Normalize the base path
                // so that "/Users/foo/project/", "../components/*" => "/Users/foo/components/""
                const prefix = r.fs.absBuf(&prefix_parts, bufs(.tsconfig_match_full_buf2));

                // 2. Join the new base path with the matched result
                // so that "/Users/foo/components/", "/foo/bar" => /Users/foo/components/foo/bar
                var parts = [_]string{
                    prefix,
                    if (matched_text_with_suffix_len > 0) std.mem.trimLeft(u8, matched_text_with_suffix[0..matched_text_with_suffix_len], "/") else "",
                    std.mem.trimLeft(u8, longest_match.suffix, "/"),
                };
                const absolute_original_path = r.fs.absBuf(
                    &parts,
                    bufs(.tsconfig_match_full_buf),
                );

                if (r.loadAsFileOrDirectory(absolute_original_path, kind)) |res| {
                    return res;
                }
            }
        }

        return null;
    }

    pub fn loadPackageImports(r: *ThisResolver, import_path: string, dir_info: *DirInfo, kind: ast.ImportKind, global_cache: GlobalCache) MatchResult.Union {
        const package_json = dir_info.package_json.?;
        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Looking for {s} in \"imports\" map in {s}", .{ import_path, package_json.source.key_path.text });
            debug.increaseIndent();
            defer debug.decreaseIndent();
        }
        const imports_map = package_json.imports.?;

        if (import_path.len == 1 or strings.hasPrefix(import_path, "#/")) {
            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("The path \"{s}\" must not equal \"#\" and must not start with \"#/\"", .{import_path});
            }
            return .{ .not_found = {} };
        }
        var module_type = options.ModuleType.unknown;

        const esmodule = ESModule{
            .conditions = switch (kind) {
                ast.ImportKind.require,
                ast.ImportKind.require_resolve,
                => r.opts.conditions.require,
                else => r.opts.conditions.import,
            },
            .allocator = r.allocator,
            .debug_logs = if (r.debug_logs) |*debug| debug else null,
            .module_type = &module_type,
        };

        const esm_resolution = esmodule.resolveImports(import_path, imports_map.root);

        if (esm_resolution.status == .PackageResolve) {
            // https://github.com/oven-sh/bun/issues/4972
            // Resolve a subpath import to a Bun or Node.js builtin
            //
            // Code example:
            //
            //     import { readFileSync } from '#fs';
            //
            // package.json:
            //
            //     "imports": {
            //       "#fs": "node:fs"
            //     }
            //
            if (r.opts.mark_builtins_as_external or r.opts.target.isBun()) {
                if (JSC.HardcodedModule.Aliases.has(esm_resolution.path, r.opts.target)) {
                    return .{
                        .success = .{
                            .path_pair = .{ .primary = bun.fs.Path.init(esm_resolution.path) },
                            .is_external = true,
                        },
                    };
                }
            }

            return r.loadNodeModules(
                esm_resolution.path,
                kind,
                dir_info,
                global_cache,
                true,
            );
        }

        if (r.handleESMResolution(esm_resolution, package_json.source.path.name.dir, kind, package_json, "")) |result| {
            return .{ .success = result };
        }

        return .{ .not_found = {} };
    }

    const BrowserMapPath = struct {
        remapped: string = "",
        cleaned: string = "",
        input_path: string = "",
        extension_order: []const string,
        map: BrowserMap,

        pub const Kind = enum { PackagePath, AbsolutePath };

        pub fn checkPath(
            this: *BrowserMapPath,
            path_to_check: string,
        ) bool {
            const map = this.map;

            const cleaned = this.cleaned;
            // Check for equality
            if (this.map.get(path_to_check)) |result| {
                this.remapped = result;
                this.input_path = path_to_check;
                return true;
            }

            var ext_buf = bufs(.extension_path);

            bun.copy(u8, ext_buf, cleaned);

            // If that failed, try adding implicit extensions
            for (this.extension_order) |ext| {
                bun.copy(u8, ext_buf[cleaned.len..], ext);
                const new_path = ext_buf[0 .. cleaned.len + ext.len];
                // if (r.debug_logs) |*debug| {
                //     debug.addNoteFmt("Checking for \"{s}\" ", .{new_path});
                // }
                if (map.get(new_path)) |_remapped| {
                    this.remapped = _remapped;
                    this.cleaned = new_path;
                    this.input_path = new_path;
                    return true;
                }
            }

            // If that failed, try assuming this is a directory and looking for an "index" file

            var index_path: string = "";
            {
                var parts = [_]string{ std.mem.trimRight(u8, path_to_check, std.fs.path.sep_str), std.fs.path.sep_str ++ "index" };
                index_path = ResolvePath.joinStringBuf(bufs(.tsconfig_base_url), &parts, .auto);
            }

            if (map.get(index_path)) |_remapped| {
                this.remapped = _remapped;
                this.input_path = index_path;
                return true;
            }

            bun.copy(u8, ext_buf, index_path);

            for (this.extension_order) |ext| {
                bun.copy(u8, ext_buf[index_path.len..], ext);
                const new_path = ext_buf[0 .. index_path.len + ext.len];
                // if (r.debug_logs) |*debug| {
                //     debug.addNoteFmt("Checking for \"{s}\" ", .{new_path});
                // }
                if (map.get(new_path)) |_remapped| {
                    this.remapped = _remapped;
                    this.cleaned = new_path;
                    this.input_path = new_path;
                    return true;
                }
            }

            return false;
        }
    };

    pub fn checkBrowserMap(
        r: *ThisResolver,
        dir_info: *const DirInfo,
        input_path_: string,
        comptime kind: BrowserMapPath.Kind,
    ) ?string {
        const package_json = dir_info.package_json orelse return null;
        const browser_map = package_json.browser_map;

        if (browser_map.count() == 0) return null;

        var input_path = input_path_;

        if (comptime kind == .AbsolutePath) {
            const abs_path = dir_info.abs_path;
            // Turn absolute paths into paths relative to the "browser" map location
            if (!strings.startsWith(input_path, abs_path)) {
                return null;
            }

            input_path = input_path[abs_path.len..];
        }

        if (input_path.len == 0 or (input_path.len == 1 and (input_path[0] == '.' or input_path[0] == std.fs.path.sep))) {
            // No bundler supports remapping ".", so we don't either
            return null;
        }

        // Normalize the path so we can compare against it without getting confused by "./"
        const cleaned = r.fs.normalizeBuf(bufs(.check_browser_map), input_path);

        if (cleaned.len == 1 and cleaned[0] == '.') {
            // No bundler supports remapping ".", so we don't either
            return null;
        }

        var checker = BrowserMapPath{
            .remapped = "",
            .cleaned = cleaned,
            .input_path = input_path,
            .extension_order = r.extension_order,
            .map = package_json.browser_map,
        };

        if (checker.checkPath(input_path)) {
            return checker.remapped;
        }

        // First try the import path as a package path
        if (isPackagePath(checker.input_path)) {
            var abs_to_rel = bufs(.abs_to_rel);
            switch (comptime kind) {
                .AbsolutePath => {
                    abs_to_rel[0..2].* = "./".*;
                    bun.copy(u8, abs_to_rel[2..], checker.input_path);
                    if (checker.checkPath(abs_to_rel[0 .. checker.input_path.len + 2])) {
                        return checker.remapped;
                    }
                },
                .PackagePath => {
                    // Browserify allows a browser map entry of "./pkg" to override a package
                    // path of "require('pkg')". This is weird, and arguably a bug. But we
                    // replicate this bug for compatibility. However, Browserify only allows
                    // this within the same package. It does not allow such an entry in a
                    // parent package to override this in a child package. So this behavior
                    // is disallowed if there is a "node_modules" folder in between the child
                    // package and the parent package.
                    const isInSamePackage = brk: {
                        const parent = dir_info.getParent() orelse break :brk true;
                        break :brk !parent.isNodeModules();
                    };

                    if (isInSamePackage) {
                        abs_to_rel[0..2].* = "./".*;
                        bun.copy(u8, abs_to_rel[2..], checker.input_path);

                        if (checker.checkPath(abs_to_rel[0 .. checker.input_path.len + 2])) {
                            return checker.remapped;
                        }
                    }
                },
            }
        }

        return null;
    }

    pub fn loadFromMainField(r: *ThisResolver, path: string, dir_info: *DirInfo, _field_rel_path: string, field: string, extension_order: []const string) ?MatchResult {
        var field_rel_path = _field_rel_path;
        // Is this a directory?
        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Found main field \"{s}\" with path \"{s}\"", .{ field, field_rel_path });
            debug.increaseIndent();
        }

        defer {
            if (r.debug_logs) |*debug| {
                debug.decreaseIndent();
            }
        }

        if (r.care_about_browser_field) {
            // Potentially remap using the "browser" field
            if (dir_info.getEnclosingBrowserScope()) |browser_scope| {
                if (browser_scope.package_json) |browser_json| {
                    if (r.checkBrowserMap(
                        browser_scope,
                        field_rel_path,
                        .AbsolutePath,
                    )) |remap| {
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
                                .package_json = browser_json,
                            };
                        }

                        field_rel_path = remap;
                    }
                }
            }
        }
        const _paths = [_]string{ path, field_rel_path };
        const field_abs_path = r.fs.absBuf(&_paths, bufs(.field_abs_path));

        // Is this a file?
        if (r.loadAsFile(field_abs_path, extension_order)) |result| {
            if (dir_info.package_json) |package_json| {
                return MatchResult{
                    .path_pair = PathPair{ .primary = Fs.Path.init(result.path) },
                    .package_json = package_json,
                    .dirname_fd = result.dirname_fd,
                };
            }

            return MatchResult{
                .path_pair = PathPair{ .primary = Fs.Path.init(result.path) },
                .dirname_fd = result.dirname_fd,
                .diff_case = result.diff_case,
            };
        }

        // Is it a directory with an index?
        const field_dir_info = (r.dirInfoCached(field_abs_path) catch null) orelse {
            return null;
        };

        return r.loadAsIndexWithBrowserRemapping(field_dir_info, field_abs_path, extension_order) orelse {
            return null;
        };
    }

    pub export fn Resolver__nodeModulePathsForJS(globalThis: *bun.JSC.JSGlobalObject, callframe: *bun.JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
        bun.JSC.markBinding(@src());
        const argument: bun.JSC.JSValue = callframe.argument(0);

        if (argument.isEmpty() or !argument.isString()) {
            globalThis.throwInvalidArgumentType("nodeModulePaths", "path", "string");
            return .zero;
        }

        const in_str = argument.toBunString(globalThis);
        defer in_str.deref();
        const r = &globalThis.bunVM().bundler.resolver;
        return nodeModulePathsJSValue(r, in_str, globalThis);
    }

    pub export fn Resolver__propForRequireMainPaths(globalThis: *bun.JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        bun.JSC.markBinding(@src());

        const in_str = bun.String.createUTF8(".");
        const r = &globalThis.bunVM().bundler.resolver;
        return nodeModulePathsJSValue(r, in_str, globalThis);
    }

    pub fn nodeModulePathsJSValue(
        r: *ThisResolver,
        in_str: bun.String,
        globalObject: *bun.JSC.JSGlobalObject,
    ) bun.JSC.JSValue {
        var list = std.ArrayList(bun.String).init(bun.default_allocator);
        defer list.deinit();

        const sliced = in_str.toUTF8(bun.default_allocator);
        defer sliced.deinit();

        const str = brk: {
            if (std.fs.path.isAbsolute(sliced.slice())) {
                if (comptime Environment.isWindows) {
                    const dir_path_buf = bufs(.node_modules_paths_buf);
                    var normalizer = bun.path.PosixToWinNormalizer{};
                    const normalized = normalizer.resolveCWD(sliced.slice()) catch {
                        @panic("Failed to get cwd for _nodeModulesPaths");
                    };
                    break :brk bun.path.normalizeBuf(normalized, dir_path_buf, .windows);
                }
                break :brk sliced.slice();
            }
            const dir_path_buf = bufs(.node_modules_paths_buf);
            break :brk bun.path.joinStringBuf(dir_path_buf, &[_]string{ r.fs.top_level_dir, sliced.slice() }, .auto);
        };
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var stack_fallback_allocator = std.heap.stackFallback(1024, arena.allocator());
        const alloc = stack_fallback_allocator.get();

        if (r.readDirInfo(str) catch null) |result| {
            var dir_info = result;

            while (true) {
                const path_without_trailing_slash = strings.withoutTrailingSlash(dir_info.abs_path);
                const path_parts = brk: {
                    if (path_without_trailing_slash.len == 1 and path_without_trailing_slash[0] == '/') {
                        break :brk [2]string{ "", std.fs.path.sep_str ++ "node_modules" };
                    }

                    break :brk [2]string{ path_without_trailing_slash, std.fs.path.sep_str ++ "node_modules" };
                };
                const nodemodules_path = bun.strings.concat(alloc, &path_parts) catch unreachable;
                bun.path.posixToPlatformInPlace(u8, nodemodules_path);
                list.append(bun.String.createUTF8(nodemodules_path)) catch unreachable;
                dir_info = (r.readDirInfo(std.fs.path.dirname(path_without_trailing_slash) orelse break) catch null) orelse break;
            }
        } else {
            // does not exist
            const full_path = std.fs.path.resolve(r.allocator, &[1][]const u8{str}) catch unreachable;
            var path = strings.withoutTrailingSlash(full_path);
            while (true) {
                const path_without_trailing_slash = strings.withoutTrailingSlash(path);

                list.append(
                    bun.String.createUTF8(
                        bun.strings.concat(
                            alloc,
                            &[_]string{
                                path_without_trailing_slash,
                                std.fs.path.sep_str ++ "node_modules",
                            },
                        ) catch unreachable,
                    ),
                ) catch unreachable;

                path = path[0 .. strings.lastIndexOfChar(path, std.fs.path.sep) orelse break];
            }
        }

        return bun.String.toJSArray(globalObject, list.items);
    }

    pub fn loadAsIndex(r: *ThisResolver, dir_info: *DirInfo, extension_order: []const string) ?MatchResult {
        const rfs = &r.fs.fs;
        // Try the "index" file with extensions
        for (extension_order) |ext| {
            var ext_buf = bufs(.extension_path);

            var base = ext_buf[0 .. "index".len + ext.len];
            base[0.."index".len].* = "index".*;
            bun.copy(u8, base["index".len..], ext);

            if (dir_info.getEntries(r.generation)) |entries| {
                if (entries.get(base)) |lookup| {
                    if (lookup.entry.kind(rfs, r.store_fd) == .file) {
                        const out_buf = brk: {
                            if (lookup.entry.abs_path.isEmpty()) {
                                const parts = [_]string{ dir_info.abs_path, base };
                                const out_buf_ = r.fs.absBuf(&parts, bufs(.index));
                                lookup.entry.abs_path =
                                    PathString.init(r.fs.dirname_store.append(@TypeOf(out_buf_), out_buf_) catch unreachable);
                            }
                            break :brk lookup.entry.abs_path.slice();
                        };

                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Found file: \"{s}\"", .{out_buf});
                        }

                        if (dir_info.package_json) |package_json| {
                            return MatchResult{
                                .path_pair = .{ .primary = Path.init(out_buf) },
                                .diff_case = lookup.diff_case,
                                .package_json = package_json,
                                .dirname_fd = dir_info.getFileDescriptor(),
                            };
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
                debug.addNoteFmt("Failed to find file: \"{s}/{s}\"", .{ dir_info.abs_path, base });
            }
        }

        return null;
    }

    pub fn loadAsIndexWithBrowserRemapping(r: *ThisResolver, dir_info: *DirInfo, path_: string, extension_order: []const string) ?MatchResult {
        // In order for our path handling logic to be correct, it must end with a trailing slash.
        var path = path_;
        if (!strings.endsWithChar(path_, std.fs.path.sep)) {
            var path_buf = bufs(.remap_path_trailing_slash);
            bun.copy(u8, path_buf, path);
            path_buf[path.len] = std.fs.path.sep;
            path_buf[path.len + 1] = 0;
            path = path_buf[0 .. path.len + 1];
        }

        if (r.care_about_browser_field) {
            if (dir_info.getEnclosingBrowserScope()) |browser_scope| {
                const field_rel_path = comptime "index";

                if (browser_scope.package_json) |browser_json| {
                    if (r.checkBrowserMap(
                        browser_scope,
                        field_rel_path,
                        .AbsolutePath,
                    )) |remap| {

                        // Is the path disabled?
                        if (remap.len == 0) {
                            const paths = [_]string{ path, field_rel_path };
                            const new_path = r.fs.absBuf(&paths, bufs(.remap_path));
                            var _path = Path.init(new_path);
                            _path.is_disabled = true;
                            return MatchResult{
                                .path_pair = PathPair{
                                    .primary = _path,
                                },
                                .package_json = browser_json,
                            };
                        }

                        const new_paths = [_]string{ path, remap };
                        const remapped_abs = r.fs.absBuf(&new_paths, bufs(.remap_path));

                        // Is this a file
                        if (r.loadAsFile(remapped_abs, extension_order)) |file_result| {
                            return MatchResult{ .dirname_fd = file_result.dirname_fd, .path_pair = .{ .primary = Path.init(file_result.path) }, .diff_case = file_result.diff_case };
                        }

                        // Is it a directory with an index?
                        if (r.dirInfoCached(remapped_abs) catch null) |new_dir| {
                            if (r.loadAsIndex(new_dir, extension_order)) |absolute| {
                                return absolute;
                            }
                        }

                        return null;
                    }
                }
            }
        }

        return r.loadAsIndex(dir_info, extension_order);
    }

    pub fn loadAsFileOrDirectory(r: *ThisResolver, path: string, kind: ast.ImportKind) ?MatchResult {
        const extension_order = r.extension_order;

        // Is this a file?
        if (r.loadAsFile(path, extension_order)) |file| {
            // Determine the package folder by looking at the last node_modules/ folder in the path
            if (strings.lastIndexOf(file.path, "node_modules" ++ std.fs.path.sep_str)) |last_node_modules_folder| {
                const node_modules_folder_offset = last_node_modules_folder + ("node_modules" ++ std.fs.path.sep_str).len;
                // Determine the package name by looking at the next separator
                if (strings.indexOfChar(file.path[node_modules_folder_offset..], std.fs.path.sep)) |package_name_length| {
                    if ((r.dirInfoCached(file.path[0 .. node_modules_folder_offset + package_name_length]) catch null)) |package_dir_info| {
                        if (package_dir_info.package_json) |package_json| {
                            return MatchResult{
                                .path_pair = .{ .primary = Path.init(file.path) },
                                .diff_case = file.diff_case,
                                .dirname_fd = file.dirname_fd,
                                .package_json = package_json,
                                .file_fd = file.file_fd,
                            };
                        }
                    }
                }
            }

            if (Environment.allow_assert) {
                assert(std.fs.path.isAbsolute(file.path));
            }

            return MatchResult{
                .path_pair = .{ .primary = Path.init(file.path) },
                .diff_case = file.diff_case,
                .dirname_fd = file.dirname_fd,
                .file_fd = file.file_fd,
            };
        }

        // Is this a directory?
        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Attempting to load \"{s}\" as a directory", .{path});
            debug.increaseIndent();
        }
        defer if (r.debug_logs) |*debug| {
            debug.decreaseIndent();
        };

        const dir_info = (r.dirInfoCached(path) catch |err| {
            if (comptime Environment.isDebug) Output.prettyErrorln("err: {s} reading {s}", .{ @errorName(err), path });
            return null;
        }) orelse return null;
        var package_json: ?*PackageJSON = null;

        // Try using the main field(s) from "package.json"
        if (dir_info.package_json) |pkg_json| {
            package_json = pkg_json;
            if (pkg_json.main_fields.count() > 0) {
                const main_field_values = pkg_json.main_fields;
                const main_field_keys = r.opts.main_fields;
                // TODO: check this works right. Not sure this will really work.
                const auto_main = r.opts.main_fields.ptr == options.Target.DefaultMainFields.get(r.opts.target).ptr;

                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Searching for main fields in \"{s}\"", .{pkg_json.source.path.text});
                }

                for (main_field_keys) |key| {
                    const field_rel_path = (main_field_values.get(key)) orelse {
                        if (r.debug_logs) |*debug| {
                            debug.addNoteFmt("Did not find main field \"{s}\"", .{key});
                        }
                        continue;
                    };

                    var _result = r.loadFromMainField(
                        path,
                        dir_info,
                        field_rel_path,
                        key,
                        if (strings.eqlComptime(key, "main")) r.opts.main_field_extension_order else extension_order,
                    ) orelse continue;

                    // If the user did not manually configure a "main" field order, then
                    // use a special per-module automatic algorithm to decide whether to
                    // use "module" or "main" based on whether the package is imported
                    // using "import" or "require".
                    if (auto_main and strings.eqlComptime(key, "module")) {
                        var absolute_result: ?MatchResult = null;

                        if (main_field_values.get("main")) |main_rel_path| {
                            if (main_rel_path.len > 0) {
                                absolute_result = r.loadFromMainField(path, dir_info, main_rel_path, "main", r.opts.main_field_extension_order);
                            }
                        } else {
                            // Some packages have a "module" field without a "main" field but
                            // still have an implicit "index.js" file. In that case, treat that
                            // as the value for "main".
                            absolute_result = r.loadAsIndexWithBrowserRemapping(dir_info, path, r.opts.main_field_extension_order);
                        }

                        if (absolute_result) |auto_main_result| {
                            // If both the "main" and "module" fields exist, use "main" if the
                            // path is for "require" and "module" if the path is for "import".
                            // If we're using "module", return enough information to be able to
                            // fall back to "main" later if something ended up using "require()"
                            // with this same path. The goal of this code is to avoid having
                            // both the "module" file and the "main" file in the bundle at the
                            // same time.
                            //
                            // Additionally, if this is for the runtime, use the "main" field.
                            // If it doesn't exist, the "module" field will be used.
                            if (r.prefer_module_field and kind != ast.ImportKind.require) {
                                if (r.debug_logs) |*debug| {
                                    debug.addNoteFmt("Resolved to \"{s}\" using the \"module\" field in \"{s}\"", .{ auto_main_result.path_pair.primary.text, pkg_json.source.key_path.text });

                                    debug.addNoteFmt("The fallback path in case of \"require\" is {s}", .{auto_main_result.path_pair.primary.text});
                                }

                                return MatchResult{
                                    .path_pair = .{
                                        .primary = _result.path_pair.primary,
                                        .secondary = auto_main_result.path_pair.primary,
                                    },
                                    .diff_case = _result.diff_case,
                                    .dirname_fd = _result.dirname_fd,
                                    .package_json = package_json,
                                    .file_fd = auto_main_result.file_fd,
                                };
                            } else {
                                if (r.debug_logs) |*debug| {
                                    debug.addNoteFmt("Resolved to \"{s}\" using the \"{s}\" field in \"{s}\"", .{
                                        auto_main_result.path_pair.primary.text,
                                        key,
                                        pkg_json.source.key_path.text,
                                    });
                                }
                                var _auto_main_result = auto_main_result;
                                _auto_main_result.package_json = package_json;
                                return _auto_main_result;
                            }
                        }
                    }

                    _result.package_json = _result.package_json orelse package_json;
                    return _result;
                }
            }
        }

        // Look for an "index" file with known extensions
        if (r.loadAsIndexWithBrowserRemapping(dir_info, path, extension_order)) |res| {
            var res_copy = res;
            res_copy.package_json = res.package_json orelse package_json;
            return res_copy;
        }

        return null;
    }

    pub fn loadAsFile(r: *ThisResolver, path: string, extension_order: []const string) ?LoadResult {
        var rfs: *Fs.FileSystem.RealFS = &r.fs.fs;

        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Attempting to load \"{s}\" as a file", .{path});
            debug.increaseIndent();
        }
        defer {
            if (r.debug_logs) |*debug| {
                debug.decreaseIndent();
            }
        }

        const dir_path = bun.strings.pathWithoutTrailingSlashOne(Dirname.dirname(path));

        const dir_entry: *Fs.FileSystem.RealFS.EntriesOption = rfs.readDirectory(
            dir_path,
            null,
            r.generation,
            r.store_fd,
        ) catch {
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
            debug.addNoteFmt("Checking for file \"{s}\" ", .{base});
        }

        if (entries.get(base)) |query| {
            if (query.entry.kind(rfs, r.store_fd) == .file) {
                if (r.debug_logs) |*debug| {
                    debug.addNoteFmt("Found file \"{s}\" ", .{base});
                }

                const abs_path = brk: {
                    if (query.entry.abs_path.isEmpty()) {
                        const abs_path_parts = [_]string{ query.entry.dir, query.entry.base() };
                        query.entry.abs_path = PathString.init(r.fs.dirname_store.append(string, r.fs.absBuf(&abs_path_parts, bufs(.load_as_file))) catch unreachable);
                    }

                    break :brk query.entry.abs_path.slice();
                };

                return LoadResult{
                    .path = abs_path,
                    .diff_case = query.diff_case,
                    .dirname_fd = entries.fd,
                    .file_fd = query.entry.cache.fd,
                };
            }
        }

        // Try the path with extensions
        bun.copy(u8, bufs(.load_as_file), path);
        for (extension_order) |ext| {
            var buffer = bufs(.load_as_file)[0 .. path.len + ext.len];
            bun.copy(u8, buffer[path.len..], ext);
            const file_name = buffer[path.len - base.len .. buffer.len];

            if (r.debug_logs) |*debug| {
                debug.addNoteFmt("Checking for file \"{s}\" ", .{buffer});
            }

            if (entries.get(file_name)) |query| {
                if (query.entry.kind(rfs, r.store_fd) == .file) {
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Found file \"{s}\" ", .{buffer});
                    }

                    // now that we've found it, we allocate it.
                    return LoadResult{
                        .path = brk: {
                            query.entry.abs_path = if (query.entry.abs_path.isEmpty())
                                PathString.init(r.fs.dirname_store.append(@TypeOf(buffer), buffer) catch unreachable)
                            else
                                query.entry.abs_path;

                            break :brk query.entry.abs_path.slice();
                        },
                        .diff_case = query.diff_case,
                        .dirname_fd = entries.fd,
                        .file_fd = query.entry.cache.fd,
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
            if ((strings.eqlComptime(ext, ".js") or strings.eqlComptime(ext, ".jsx") or strings.eqlComptime(ext, ".mjs") and
                (!FeatureFlags.disable_auto_js_to_ts_in_node_modules or !strings.pathContainsNodeModulesFolder(path))))
            {
                const segment = base[0..last_dot];
                var tail = bufs(.load_as_file)[path.len - base.len ..];
                bun.copy(u8, tail, segment);

                const exts: []const string = if (strings.eqlComptime(ext, ".mjs"))
                    &.{".mts"}
                else
                    &.{ ".ts", ".tsx", ".mts" };

                for (exts) |ext_to_replace| {
                    var buffer = tail[0 .. segment.len + ext_to_replace.len];
                    @memcpy(buffer[segment.len..buffer.len][0..ext_to_replace.len], ext_to_replace);

                    if (entries.get(buffer)) |query| {
                        if (query.entry.kind(rfs, r.store_fd) == .file) {
                            if (r.debug_logs) |*debug| {
                                debug.addNoteFmt("Rewrote to \"{s}\" ", .{buffer});
                            }

                            return LoadResult{
                                .path = brk: {
                                    if (query.entry.abs_path.isEmpty()) {
                                        if (query.entry.dir.len > 0 and query.entry.dir[query.entry.dir.len - 1] == std.fs.path.sep) {
                                            const parts = [_]string{ query.entry.dir, buffer };
                                            query.entry.abs_path = PathString.init(r.fs.filename_store.append(@TypeOf(parts), parts) catch unreachable);
                                            // the trailing path CAN be missing here
                                        } else {
                                            const parts = [_]string{ query.entry.dir, std.fs.path.sep_str, buffer };
                                            query.entry.abs_path = PathString.init(r.fs.filename_store.append(@TypeOf(parts), parts) catch unreachable);
                                        }
                                    }

                                    break :brk query.entry.abs_path.slice();
                                },
                                .diff_case = query.diff_case,
                                .dirname_fd = entries.fd,
                                .file_fd = query.entry.cache.fd,
                            };
                        }
                    }
                    if (r.debug_logs) |*debug| {
                        debug.addNoteFmt("Failed to rewrite \"{s}\" ", .{base});
                    }
                }
            }
        }

        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("Failed to find \"{s}\" ", .{path});
        }

        if (comptime FeatureFlags.watch_directories) {
            // For existent directories which don't find a match
            // Start watching it automatically,
            if (r.watcher) |watcher| {
                watcher.watch(entries.dir, entries.fd);
            }
        }
        return null;
    }

    fn dirInfoUncached(
        r: *ThisResolver,
        info: *DirInfo,
        path: string,
        _entries: *Fs.FileSystem.RealFS.EntriesOption,
        _result: allocators.Result,
        dir_entry_index: allocators.IndexType,
        parent: ?*DirInfo,
        parent_index: allocators.IndexType,
        fd: FileDescriptorType,
        package_id: ?Install.PackageID,
    ) anyerror!void {
        const result = _result;

        const rfs: *Fs.FileSystem.RealFS = &r.fs.fs;
        var entries = _entries.entries;

        info.* = DirInfo{
            .abs_path = path,
            // .abs_real_path = path,
            .parent = parent_index,
            .entries = dir_entry_index,
        };

        // A "node_modules" directory isn't allowed to directly contain another "node_modules" directory
        var base = std.fs.path.basename(path);

        // base must
        if (base.len > 1 and base[base.len - 1] == std.fs.path.sep) base = base[0 .. base.len - 1];

        info.flags.setPresent(.is_node_modules, strings.eqlComptime(base, "node_modules"));

        // if (entries != null) {
        if (!info.isNodeModules()) {
            if (entries.getComptimeQuery("node_modules")) |entry| {
                info.flags.setPresent(.has_node_modules, (entry.entry.kind(rfs, r.store_fd)) == .dir);
            }
        }

        if (r.care_about_bin_folder) {
            append_bin_dir: {
                if (info.hasNodeModules()) {
                    if (entries.hasComptimeQuery("node_modules")) {
                        if (!bin_folders_loaded) {
                            bin_folders_loaded = true;
                            bin_folders = BinFolderArray.init(0) catch unreachable;
                        }

                        const this_dir = fd.asDir();
                        var file = this_dir.openDirZ(bun.pathLiteral("node_modules/.bin"), .{ .iterate = true }) catch break :append_bin_dir;
                        defer file.close();
                        const bin_path = bun.getFdPath(file.fd, bufs(.node_bin_path)) catch break :append_bin_dir;
                        bin_folders_lock.lock();
                        defer bin_folders_lock.unlock();

                        for (bin_folders.constSlice()) |existing_folder| {
                            if (strings.eql(existing_folder, bin_path)) {
                                break :append_bin_dir;
                            }
                        }

                        bin_folders.append(r.fs.dirname_store.append([]u8, bin_path) catch break :append_bin_dir) catch {};
                    }
                }

                if (info.isNodeModules()) {
                    if (entries.getComptimeQuery(".bin")) |q| {
                        if (q.entry.kind(rfs, r.store_fd) == .dir) {
                            if (!bin_folders_loaded) {
                                bin_folders_loaded = true;
                                bin_folders = BinFolderArray.init(0) catch unreachable;
                            }

                            const this_dir = fd.asDir();
                            var file = this_dir.openDirZ(".bin", .{}) catch break :append_bin_dir;
                            defer file.close();
                            const bin_path = bun.getFdPath(file.fd, bufs(.node_bin_path)) catch break :append_bin_dir;
                            bin_folders_lock.lock();
                            defer bin_folders_lock.unlock();

                            for (bin_folders.constSlice()) |existing_folder| {
                                if (strings.eql(existing_folder, bin_path)) {
                                    break :append_bin_dir;
                                }
                            }

                            bin_folders.append(r.fs.dirname_store.append([]u8, bin_path) catch break :append_bin_dir) catch {};
                        }
                    }
                }
            }
        }
        // }

        if (parent) |parent_| {
            // Propagate the browser scope into child directories
            info.enclosing_browser_scope = parent_.enclosing_browser_scope;
            info.package_json_for_browser_field = parent_.package_json_for_browser_field;
            info.enclosing_tsconfig_json = parent_.enclosing_tsconfig_json;

            if (parent_.package_json) |parent_package_json| {
                // https://github.com/oven-sh/bun/issues/229
                if (parent_package_json.name.len > 0 or r.care_about_bin_folder) {
                    info.enclosing_package_json = parent_package_json;
                }

                if (parent_package_json.dependencies.map.count() > 0 or parent_package_json.package_manager_package_id != Install.invalid_package_id) {
                    info.package_json_for_dependencies = parent_package_json;
                }
            }

            info.enclosing_package_json = info.enclosing_package_json orelse parent_.enclosing_package_json;
            info.package_json_for_dependencies = info.package_json_for_dependencies orelse parent_.package_json_for_dependencies;

            // Make sure "absRealPath" is the real path of the directory (resolving any symlinks)
            if (!r.opts.preserve_symlinks) {
                if (parent_.getEntries(r.generation)) |parent_entries| {
                    if (parent_entries.get(base)) |lookup| {
                        if (entries.fd != .zero and lookup.entry.cache.fd == .zero and r.store_fd) lookup.entry.cache.fd = entries.fd;
                        const entry = lookup.entry;

                        var symlink = entry.symlink(rfs, r.store_fd);
                        if (symlink.len > 0) {
                            if (r.debug_logs) |*logs| {
                                logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved symlink \"{s}\" to \"{s}\"", .{ path, symlink }) catch unreachable);
                            }
                            info.abs_real_path = symlink;
                        } else if (parent_.abs_real_path.len > 0) {
                            // this might leak a little i'm not sure
                            const parts = [_]string{ parent.?.abs_real_path, base };
                            symlink = r.fs.dirname_store.append(string, r.fs.absBuf(&parts, bufs(.dir_info_uncached_filename))) catch unreachable;

                            if (r.debug_logs) |*logs| {
                                logs.addNote(std.fmt.allocPrint(r.allocator, "Resolved symlink \"{s}\" to \"{s}\"", .{ path, symlink }) catch unreachable);
                            }
                            lookup.entry.cache.symlink = PathString.init(symlink);
                            info.abs_real_path = symlink;
                        }
                    }
                }
            }

            if (parent_.isNodeModules() or parent_.isInsideNodeModules()) {
                info.flags.setPresent(.inside_node_modules, true);
            }
        }

        // Record if this directory has a package.json file
        if (entries.getComptimeQuery("package.json")) |lookup| {
            const entry = lookup.entry;
            if (entry.kind(rfs, r.store_fd) == .file) {
                info.package_json = if (r.usePackageManager() and !info.hasNodeModules() and !info.isNodeModules())
                    r.parsePackageJSON(path, if (FeatureFlags.store_file_descriptors) fd else .zero, package_id, true) catch null
                else
                    r.parsePackageJSON(path, if (FeatureFlags.store_file_descriptors) fd else .zero, null, false) catch null;

                if (info.package_json) |pkg| {
                    if (pkg.browser_map.count() > 0) {
                        info.enclosing_browser_scope = result.index;
                        info.package_json_for_browser_field = pkg;
                    }

                    if (pkg.name.len > 0 or r.care_about_bin_folder)
                        info.enclosing_package_json = pkg;

                    if (pkg.dependencies.map.count() > 0 or pkg.package_manager_package_id != Install.invalid_package_id)
                        info.package_json_for_dependencies = pkg;

                    if (r.debug_logs) |*logs| {
                        logs.addNoteFmt("Resolved package.json in \"{s}\"", .{
                            path,
                        });
                    }
                }
            }
        }

        // Record if this directory has a tsconfig.json or jsconfig.json file
        if (r.opts.load_tsconfig_json) {
            var tsconfig_path: ?string = null;
            if (r.opts.tsconfig_override == null) {
                if (entries.getComptimeQuery("tsconfig.json")) |lookup| {
                    const entry = lookup.entry;
                    if (entry.kind(rfs, r.store_fd) == .file) {
                        const parts = [_]string{ path, "tsconfig.json" };

                        tsconfig_path = r.fs.absBuf(&parts, bufs(.dir_info_uncached_filename));
                    }
                }
                if (tsconfig_path == null) {
                    if (entries.getComptimeQuery("jsconfig.json")) |lookup| {
                        const entry = lookup.entry;
                        if (entry.kind(rfs, r.store_fd) == .file) {
                            const parts = [_]string{ path, "jsconfig.json" };
                            tsconfig_path = r.fs.absBuf(&parts, bufs(.dir_info_uncached_filename));
                        }
                    }
                }
            } else if (parent == null) {
                tsconfig_path = r.opts.tsconfig_override.?;
            }

            if (tsconfig_path) |tsconfigpath| {
                info.tsconfig_json = r.parseTSConfig(
                    tsconfigpath,
                    if (FeatureFlags.store_file_descriptors) fd else .zero,
                ) catch |err| brk: {
                    const pretty = r.prettyPath(Path.init(tsconfigpath));

                    if (err == error.ENOENT or err == error.FileNotFound) {
                        r.log.addErrorFmt(null, logger.Loc.Empty, r.allocator, "Cannot find tsconfig file {}", .{bun.fmt.QuotedFormatter{ .text = pretty }}) catch {};
                    } else if (err != error.ParseErrorAlreadyLogged and err != error.IsDir and err != error.EISDIR) {
                        r.log.addErrorFmt(null, logger.Loc.Empty, r.allocator, "Cannot read file {}: {s}", .{ bun.fmt.QuotedFormatter{ .text = pretty }, @errorName(err) }) catch {};
                    }
                    break :brk null;
                };
                if (info.tsconfig_json) |tsconfig_json| {
                    var parent_configs = try std.BoundedArray(*TSConfigJSON, 64).init(0);
                    try parent_configs.append(tsconfig_json);
                    var current = tsconfig_json;
                    while (current.extends.len > 0) {
                        const ts_dir_name = Dirname.dirname(current.abs_path);
                        const abs_path = ResolvePath.joinAbsStringBuf(ts_dir_name, bufs(.tsconfig_path_abs), &[_]string{ ts_dir_name, current.extends }, .auto);
                        const parent_config_maybe = r.parseTSConfig(abs_path, bun.invalid_fd) catch |err| {
                            r.log.addDebugFmt(null, logger.Loc.Empty, r.allocator, "{s} loading tsconfig.json extends {}", .{
                                @errorName(err),
                                bun.fmt.QuotedFormatter{
                                    .text = abs_path,
                                },
                            }) catch {};
                            break;
                        };
                        if (parent_config_maybe) |parent_config| {
                            try parent_configs.append(parent_config);
                            current = parent_config;
                        } else {
                            break;
                        }
                    }

                    var merged_config = parent_configs.pop();
                    // starting from the base config (end of the list)
                    // successively apply the inheritable attributes to the next config
                    while (parent_configs.popOrNull()) |parent_config| {
                        merged_config.emit_decorator_metadata = merged_config.emit_decorator_metadata or parent_config.emit_decorator_metadata;
                        if (parent_config.base_url.len > 0) {
                            merged_config.base_url = parent_config.base_url;
                            merged_config.base_url_for_paths = parent_config.base_url_for_paths;
                        }
                        merged_config.jsx = parent_config.mergeJSX(merged_config.jsx);
                        merged_config.jsx_flags.setUnion(parent_config.jsx_flags);

                        if (parent_config.preserve_imports_not_used_as_values) |value| {
                            merged_config.preserve_imports_not_used_as_values = value;
                        }

                        var iter = parent_config.paths.iterator();
                        while (iter.next()) |c| {
                            merged_config.paths.put(c.key_ptr.*, c.value_ptr.*) catch unreachable;
                        }
                        // todo deinit these parent configs somehow?
                    }
                    info.tsconfig_json = merged_config;
                }
                info.enclosing_tsconfig_json = info.tsconfig_json;
            }
        }
    }
};

pub const Dirname = struct {
    pub fn dirname(path: string) string {
        if (path.len == 0)
            return std.fs.path.sep_str;

        const root = brk: {
            if (Environment.isWindows) {
                const root = ResolvePath.windowsFilesystemRoot(path);
                assert(root.len > 0);
                break :brk root;
            }
            break :brk "/";
        };

        var end_index: usize = path.len - 1;
        while (bun.path.isSepAny(path[end_index])) {
            if (end_index == 0)
                return root;
            end_index -= 1;
        }

        while (!bun.path.isSepAny(path[end_index])) {
            if (end_index == 0)
                return root;
            end_index -= 1;
        }

        if (end_index == 0 and bun.path.isSepAny(path[0]))
            return path[0..1];

        if (end_index == 0)
            return root;

        return path[0 .. end_index + 1];
    }
};

pub const RootPathPair = struct {
    base_path: string,
    package_json: *const PackageJSON,
};

pub const GlobalCache = enum {
    allow_install,
    read_only,
    auto,
    force,
    fallback,
    disable,

    pub const Map = bun.ComptimeStringMap(GlobalCache, .{
        .{ "auto", GlobalCache.auto },
        .{ "force", GlobalCache.force },
        .{ "disable", GlobalCache.disable },
        .{ "fallback", GlobalCache.fallback },
    });

    pub fn allowVersionSpecifier(this: GlobalCache) bool {
        return this == .force;
    }

    pub fn canUse(this: GlobalCache, has_a_node_modules_folder: bool) bool {
        // When there is a node_modules folder, we default to false
        // When there is NOT a node_modules folder, we default to true
        // That is the difference between these two branches.
        if (has_a_node_modules_folder) {
            return switch (this) {
                .fallback, .allow_install, .force => true,
                .read_only, .disable, .auto => false,
            };
        } else {
            return switch (this) {
                .read_only, .fallback, .allow_install, .auto, .force => true,
                .disable => false,
            };
        }
    }

    pub fn isEnabled(this: GlobalCache) bool {
        return this != .disable;
    }

    pub fn canInstall(this: GlobalCache) bool {
        return switch (this) {
            .auto, .allow_install, .force, .fallback => true,
            else => false,
        };
    }
};

comptime {
    if (!bun.JSC.is_bindgen) {
        _ = Resolver.Resolver__nodeModulePathsForJS;
        _ = Resolver.Resolver__propForRequireMainPaths;
    }
}

const assert = bun.assert;
