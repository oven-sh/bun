// This file is the old linker, used by Bun.Transpiler.
const bun = @import("bun");
const string = bun.string;
const Environment = bun.Environment;
const strings = bun.strings;
const FileDescriptorType = bun.FileDescriptor;

const std = @import("std");
const logger = bun.logger;
const Options = @import("options.zig");

const Fs = @import("fs.zig");
const Resolver = @import("./resolver/resolver.zig");
const _import_record = @import("./import_record.zig");
const ImportRecord = _import_record.ImportRecord;
const allocators = @import("./allocators.zig");
const _transpiler = bun.transpiler;
const Transpiler = _transpiler.Transpiler;
const ResolveQueue = _transpiler.ResolveQueue;
const ResolverType = Resolver.Resolver;
const URL = @import("url.zig").URL;
const JSC = bun.JSC;
const PluginRunner = bun.transpiler.PluginRunner;
pub const CSSResolveError = error{ResolveMessage};

pub const OnImportCallback = *const fn (resolve_result: *const Resolver.Result, import_record: *ImportRecord, origin: URL) void;

pub const Linker = struct {
    const HashedFileNameMap = std.AutoHashMap(u64, string);
    const ThisLinker = @This();
    allocator: std.mem.Allocator,
    options: *Options.BundleOptions,
    fs: *Fs.FileSystem,
    log: *logger.Log,
    resolve_queue: *ResolveQueue,
    resolver: *ResolverType,
    resolve_results: *_transpiler.ResolveResults,
    any_needs_runtime: bool = false,
    runtime_import_record: ?ImportRecord = null,
    hashed_filenames: HashedFileNameMap,
    import_counter: usize = 0,
    tagged_resolutions: TaggedResolution = TaggedResolution{},

    plugin_runner: ?*PluginRunner = null,

    pub const runtime_source_path = "bun:wrap";

    pub const TaggedResolution = struct {
        react_refresh: ?Resolver.Result = null,

        // These tags cannot safely be used
        // Projects may use different JSX runtimes across folders
        // jsx_import: ?Resolver.Result = null,
        // jsx_classic: ?Resolver.Result = null,
    };

    pub fn init(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        resolve_queue: *ResolveQueue,
        options: *Options.BundleOptions,
        resolver: *ResolverType,
        resolve_results: *_transpiler.ResolveResults,
        fs: *Fs.FileSystem,
    ) ThisLinker {
        relative_paths_list = ImportPathsList.init(allocator);

        return ThisLinker{
            .allocator = allocator,
            .options = options,
            .fs = fs,
            .log = log,
            .resolve_queue = resolve_queue,
            .resolver = resolver,
            .resolve_results = resolve_results,
            .hashed_filenames = HashedFileNameMap.init(allocator),
        };
    }

    pub fn getModKey(
        this: *ThisLinker,
        file_path: Fs.Path,
        fd: ?FileDescriptorType,
    ) !Fs.FileSystem.RealFS.ModKey {
        var file: std.fs.File = if (fd) |_fd| _fd.stdFile() else try std.fs.openFileAbsolute(file_path.text, .{ .mode = .read_only });
        Fs.FileSystem.setMaxFd(file.handle);
        const modkey = try Fs.FileSystem.RealFS.ModKey.generate(&this.fs.fs, file_path.text, file);

        if (fd == null)
            file.close();
        return modkey;
    }

    pub fn getHashedFilename(
        this: *ThisLinker,
        file_path: Fs.Path,
        fd: ?FileDescriptorType,
    ) !string {
        if (Transpiler.isCacheEnabled) {
            const hashed = bun.hash(file_path.text);
            const hashed_result = try this.hashed_filenames.getOrPut(hashed);
            if (hashed_result.found_existing) {
                return hashed_result.value_ptr.*;
            }
        }

        const modkey = try this.getModKey(file_path, fd);
        const hash_name = modkey.hashName(file_path.text);

        if (Transpiler.isCacheEnabled) {
            const hashed = bun.hash(file_path.text);
            try this.hashed_filenames.put(hashed, try this.allocator.dupe(u8, hash_name));
        }

        return hash_name;
    }

    // This modifies the Ast in-place!
    // But more importantly, this does the following:
    // - Wrap CommonJS files
    pub fn link(
        linker: *ThisLinker,
        file_path: Fs.Path,
        result: *_transpiler.ParseResult,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
        comptime ignore_runtime: bool,
        comptime is_bun: bool,
    ) !void {
        const source_dir = file_path.sourceDir();
        var externals = std.ArrayList(u32).init(linker.allocator);
        var had_resolve_errors = false;

        const is_deferred = result.pending_imports.len > 0;

        const import_records = result.ast.import_records.listManaged(linker.allocator);
        defer {
            result.ast.import_records = ImportRecord.List.fromList(import_records);
        }
        // Step 1. Resolve imports & requires
        switch (result.loader) {
            .jsx, .js, .ts, .tsx => {
                for (import_records.items, 0..) |*import_record, record_i| {
                    if (import_record.is_unused or
                        (is_bun and is_deferred and !result.isPendingImport(@intCast(record_i)))) continue;

                    const record_index = record_i;
                    if (comptime !ignore_runtime) {
                        if (strings.eqlComptime(import_record.path.namespace, "runtime")) {
                            if (import_path_format == .absolute_url) {
                                import_record.path = Fs.Path.initWithNamespace(try origin.joinAlloc(linker.allocator, "", "", "bun:wrap", "", ""), "bun");
                            } else {
                                import_record.path = try linker.generateImportPath(
                                    source_dir,
                                    Linker.runtime_source_path,
                                    false,
                                    "bun",
                                    origin,
                                    import_path_format,
                                );
                            }

                            result.ast.runtime_import_record_id = @intCast(record_index);
                            result.ast.needs_runtime = true;
                            continue;
                        }
                    }

                    if (comptime is_bun) {
                        if (JSC.ModuleLoader.HardcodedModule.Alias.get(import_record.path.text, linker.options.target)) |replacement| {
                            if (replacement.tag == .builtin and import_record.kind.isCommonJS())
                                continue;
                            import_record.path.text = replacement.path;
                            import_record.tag = replacement.tag;
                            import_record.is_external_without_side_effects = true;
                            continue;
                        }
                        if (strings.startsWith(import_record.path.text, "node:")) {
                            // if a module is not found here, it is not found at all
                            // so we can just disable it
                            had_resolve_errors = try whenModuleNotFound(linker, import_record, result, is_bun);

                            if (had_resolve_errors) return error.ResolveMessage;
                            continue;
                        }

                        // TODO: this is technical debt
                        if (linker.options.rewrite_jest_for_tests) {
                            if (strings.eqlComptime(
                                import_record.path.text,
                                "@jest/globals",
                            ) or strings.eqlComptime(
                                import_record.path.text,
                                "vitest",
                            )) {
                                import_record.path.namespace = "bun";
                                import_record.tag = .bun_test;
                                import_record.path.text = "test";
                                continue;
                            }
                        }

                        if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                            import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                            import_record.path.namespace = "bun";

                            if (strings.eqlComptime(import_record.path.text, "test")) {
                                import_record.tag = .bun_test;
                            }

                            // don't link bun
                            continue;
                        }

                        // Resolve dynamic imports lazily for perf
                        if (import_record.kind == .dynamic) {
                            continue;
                        }
                    }

                    if (linker.plugin_runner) |runner| {
                        if (PluginRunner.couldBePlugin(import_record.path.text)) {
                            if (try runner.onResolve(
                                import_record.path.text,
                                file_path.text,
                                linker.log,
                                import_record.range.loc,
                                if (is_bun)
                                    JSC.JSGlobalObject.BunPluginTarget.bun
                                else if (linker.options.target == .browser)
                                    JSC.JSGlobalObject.BunPluginTarget.browser
                                else
                                    JSC.JSGlobalObject.BunPluginTarget.node,
                            )) |path| {
                                import_record.path = try linker.generateImportPath(
                                    source_dir,
                                    path.text,
                                    false,
                                    path.namespace,
                                    origin,
                                    import_path_format,
                                );
                                import_record.print_namespace_in_path = true;
                                continue;
                            }
                        }
                    }
                }
            },

            else => {},
        }
        if (had_resolve_errors) return error.ResolveMessage;
        externals.clearAndFree();
    }

    fn whenModuleNotFound(
        linker: *ThisLinker,
        import_record: *ImportRecord,
        result: *_transpiler.ParseResult,
        comptime is_bun: bool,
    ) !bool {
        if (import_record.handles_import_errors) {
            import_record.path.is_disabled = true;
            return false;
        }

        if (comptime is_bun) {
            // make these happen at runtime
            if (import_record.kind == .require or import_record.kind == .require_resolve) {
                return false;
            }
        }

        if (import_record.path.text.len > 0 and Resolver.isPackagePath(import_record.path.text)) {
            if (linker.options.target == .browser and Options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                try linker.log.addResolveError(
                    &result.source,
                    import_record.range,
                    linker.allocator,
                    "Could not resolve: \"{s}\". Try setting --target=\"node\"",
                    .{import_record.path.text},
                    import_record.kind,
                    error.ModuleNotFound,
                );
            } else {
                try linker.log.addResolveError(
                    &result.source,
                    import_record.range,
                    linker.allocator,
                    "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                    .{import_record.path.text},
                    import_record.kind,
                    error.ModuleNotFound,
                );
            }
        } else {
            try linker.log.addResolveError(
                &result.source,
                import_record.range,
                linker.allocator,
                "Could not resolve: \"{s}\"",
                .{
                    import_record.path.text,
                },
                import_record.kind,
                error.ModuleNotFound,
            );
        }
        return true;
    }

    const ImportPathsList = allocators.BSSStringList(512, 128);
    pub var relative_paths_list: *ImportPathsList = undefined;

    pub fn generateImportPath(
        linker: *ThisLinker,
        source_dir: string,
        source_path: string,
        use_hashed_name: bool,
        namespace: string,
        origin: URL,
        comptime import_path_format: Options.BundleOptions.ImportPathFormat,
    ) !Fs.Path {
        switch (import_path_format) {
            .absolute_path => {
                if (strings.eqlComptime(namespace, "node")) {
                    return Fs.Path.initWithNamespace(source_path, "node");
                }

                if (strings.eqlComptime(namespace, "bun") or strings.eqlComptime(namespace, "file") or namespace.len == 0) {
                    const relative_name = linker.fs.relative(source_dir, source_path);
                    return Fs.Path.initWithPretty(source_path, relative_name);
                } else {
                    return Fs.Path.initWithNamespace(source_path, namespace);
                }
            },
            .relative => {
                var relative_name = linker.fs.relative(source_dir, source_path);

                var pretty: string = undefined;
                if (use_hashed_name) {
                    var basepath = Fs.Path.init(source_path);
                    const basename = try linker.getHashedFilename(basepath, null);
                    const dir = basepath.name.dirWithTrailingSlash();
                    var _pretty = try linker.allocator.alloc(u8, dir.len + basename.len + basepath.name.ext.len);
                    bun.copy(u8, _pretty, dir);
                    var remaining_pretty = _pretty[dir.len..];
                    bun.copy(u8, remaining_pretty, basename);
                    remaining_pretty = remaining_pretty[basename.len..];
                    bun.copy(u8, remaining_pretty, basepath.name.ext);
                    pretty = _pretty;
                    relative_name = try linker.allocator.dupe(u8, relative_name);
                } else {
                    if (relative_name.len > 1 and !(relative_name[0] == std.fs.path.sep or relative_name[0] == '.')) {
                        pretty = try strings.concat(linker.allocator, &.{ "./", relative_name });
                    } else {
                        pretty = try linker.allocator.dupe(u8, relative_name);
                    }

                    relative_name = pretty;
                }

                return Fs.Path.initWithPretty(pretty, relative_name);
            },

            .absolute_url => {
                if (strings.eqlComptime(namespace, "node")) {
                    if (comptime Environment.isDebug) bun.assert(strings.eqlComptime(source_path[0..5], "node:"));

                    return Fs.Path.init(try std.fmt.allocPrint(
                        linker.allocator,
                        // assumption: already starts with "node:"
                        "{s}/{s}",
                        .{
                            strings.withoutTrailingSlash(origin.href),
                            strings.withoutLeadingSlash(source_path),
                        },
                    ));
                } else {
                    var absolute_pathname = Fs.PathName.init(source_path);

                    if (!linker.options.preserve_extensions) {
                        if (linker.options.out_extensions.get(absolute_pathname.ext)) |ext| {
                            absolute_pathname.ext = ext;
                        }
                    }

                    var base = linker.fs.relativeTo(source_path);
                    if (strings.lastIndexOfChar(base, '.')) |dot| {
                        base = base[0..dot];
                    }

                    const dirname = std.fs.path.dirname(base) orelse "";

                    var basename = std.fs.path.basename(base);

                    if (use_hashed_name) {
                        const basepath = Fs.Path.init(source_path);

                        basename = try linker.getHashedFilename(basepath, null);
                    }

                    return Fs.Path.init(try origin.joinAlloc(
                        linker.allocator,
                        "",
                        dirname,
                        basename,
                        absolute_pathname.ext,
                        source_path,
                    ));
                }
            },

            else => unreachable,
        }
    }

    pub fn resolveResultHashKey(linker: *ThisLinker, resolve_result: *const Resolver.Result) u64 {
        const path = resolve_result.pathConst() orelse unreachable;
        var hash_key = path.text;

        // Shorter hash key is faster to hash
        if (strings.startsWith(path.text, linker.fs.top_level_dir)) {
            hash_key = path.text[linker.fs.top_level_dir.len..];
        }

        return bun.hash(hash_key);
    }

    pub fn enqueueResolveResult(linker: *ThisLinker, resolve_result: *const Resolver.Result) !bool {
        const hash_key = linker.resolveResultHashKey(resolve_result);

        const get_or_put_entry = try linker.resolve_results.getOrPut(hash_key);

        if (!get_or_put_entry.found_existing) {
            try linker.resolve_queue.writeItem(resolve_result.*);
        }

        return !get_or_put_entry.found_existing;
    }
};
