usingnamespace @import("global.zig");

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
const panicky = @import("panic_handler.zig");
const Fs = @import("fs.zig");
const Api = @import("api/schema.zig").Api;
const Resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ThreadPool = sync.ThreadPool;
const ThreadSafeHashMap = @import("./thread_safe_hash_map.zig");
const ImportRecord = @import("./import_record.zig").ImportRecord;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");

pub const ServeResult = struct {
    value: Value,

    mime_type: MimeType,

    // Either we:
    // - send pre-buffered asset body
    // - stream a file from the file system
    pub const Value = union(Tag) {
        file: File,
        build: options.OutputFile,
        none: u0,

        pub const Tag = enum {
            file,
            build,
            none,
        };

        pub const File = struct {
            absolute_path: string,
            handle: std.fs.File,
        };
    };
};

// const BundleMap =
const ResolveResults = ThreadSafeHashMap.ThreadSafeStringHashMap(Resolver.Resolver.Result);
pub const Bundler = struct {
    options: options.BundleOptions,
    log: *logger.Log,
    allocator: *std.mem.Allocator,
    result: options.TransformResult = undefined,
    resolver: Resolver.Resolver,
    fs: *Fs.FileSystem,
    // thread_pool: *ThreadPool,
    output_files: std.ArrayList(options.OutputFile),
    resolve_results: *ResolveResults,
    resolve_queue: std.fifo.LinearFifo(Resolver.Resolver.Result, std.fifo.LinearFifoBufferType.Dynamic),
    elapsed: i128 = 0,
    needs_runtime: bool = false,

    runtime_output_path: Fs.Path = undefined,

    pub const RuntimeCode = @embedFile("./runtime.js");

    // to_bundle:

    // thread_pool: *ThreadPool,

    pub fn init(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !Bundler {
        var fs = try Fs.FileSystem.init1(allocator, opts.absolute_working_dir, opts.serve orelse false);
        const bundle_options = try options.BundleOptions.fromApi(allocator, fs, log, opts);

        relative_paths_list = ImportPathsList.init(allocator);
        // var pool = try allocator.create(ThreadPool);
        // try pool.init(ThreadPool.InitConfig{
        //     .allocator = allocator,
        // });
        return Bundler{
            .options = bundle_options,
            .fs = fs,
            .allocator = allocator,
            .resolver = Resolver.Resolver.init1(allocator, log, fs, bundle_options),
            .log = log,
            // .thread_pool = pool,
            .result = options.TransformResult{ .outbase = bundle_options.output_dir },
            .resolve_results = try ResolveResults.init(allocator),
            .resolve_queue = std.fifo.LinearFifo(Resolver.Resolver.Result, std.fifo.LinearFifoBufferType.Dynamic).init(allocator),
            .output_files = std.ArrayList(options.OutputFile).init(allocator),
        };
    }

    const ImportPathsList = allocators.BSSStringList(2048, 256);
    var relative_paths_list: *ImportPathsList = undefined;
    threadlocal var relative_path_allocator: std.heap.FixedBufferAllocator = undefined;
    threadlocal var relative_path_allocator_buf: [4096]u8 = undefined;
    threadlocal var relative_path_allocator_buf_loaded: bool = false;

    pub fn generateImportPath(bundler: *Bundler, source_dir: string, source_path: string) !Fs.Path {
        if (!relative_path_allocator_buf_loaded) {
            relative_path_allocator_buf_loaded = true;
            relative_path_allocator = std.heap.FixedBufferAllocator.init(&relative_path_allocator_buf);
        }
        defer relative_path_allocator.reset();

        var pretty = try relative_paths_list.append(bundler.fs.relativeTo(source_path));
        var pathname = Fs.PathName.init(pretty);
        var absolute_pathname = Fs.PathName.init(source_path);

        if (bundler.options.out_extensions.get(absolute_pathname.ext)) |ext| {
            absolute_pathname.ext = ext;
        }

        switch (bundler.options.import_path_format) {
            .relative => {
                return Fs.Path.initWithPretty(pretty, pretty);
            },
            .relative_nodejs => {
                var path = Fs.Path.initWithPretty(pretty, pretty);
                path.text = path.text[0 .. path.text.len - path.name.ext.len];
                return path;
            },

            .absolute_url => {
                const absolute_url = try relative_paths_list.append(
                    try std.fmt.allocPrint(
                        &relative_path_allocator.allocator,
                        "{s}{s}{s}{s}",
                        .{
                            bundler.options.public_url,
                            pathname.dir,
                            pathname.base,
                            absolute_pathname.ext,
                        },
                    ),
                );

                return Fs.Path.initWithPretty(absolute_url, pretty);
            },

            else => unreachable,
        }
    }

    pub fn processImportRecord(bundler: *Bundler, source_dir: string, import_record: *ImportRecord) !void {
        var resolve_result = try bundler.resolver.resolve(source_dir, import_record.path.text, import_record.kind);

        // extremely naive.
        resolve_result.is_from_node_modules = strings.contains(resolve_result.path_pair.primary.text, "/node_modules");

        if (resolve_result.shouldAssumeCommonJS()) {
            import_record.wrap_with_to_module = true;
            if (!bundler.needs_runtime) {
                bundler.runtime_output_path = Fs.Path.init(try std.fmt.allocPrint(bundler.allocator, "{s}/__runtime.js", .{bundler.fs.top_level_dir}));
            }
            bundler.needs_runtime = true;
        }

        // lazy means:
        // Run the resolver
        // Don't parse/print automatically.
        if (bundler.options.resolve_mode != .lazy) {
            if (!bundler.resolve_results.contains(resolve_result.path_pair.primary.text)) {
                try bundler.resolve_results.put(resolve_result.path_pair.primary.text, resolve_result);
                try bundler.resolve_queue.writeItem(resolve_result);
            }
        }

        if (!strings.eql(import_record.path.text, resolve_result.path_pair.primary.text)) {
            import_record.path = try bundler.generateImportPath(source_dir, resolve_result.path_pair.primary.text);
        }
    }

    pub fn buildWithResolveResult(bundler: *Bundler, resolve_result: Resolver.Resolver.Result) !?options.OutputFile {
        if (resolve_result.is_external) {
            return null;
        }

        // Step 1. Parse & scan
        const loader = bundler.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;
        var file_path = resolve_result.path_pair.primary;
        file_path.pretty = relative_paths_list.append(bundler.fs.relativeTo(file_path.text)) catch unreachable;
        var result = bundler.parse(file_path, loader) orelse return null;

        switch (result.loader) {
            .jsx, .js, .ts, .tsx => {
                const ast = result.ast;

                for (ast.import_records) |*import_record| {
                    bundler.processImportRecord(
                        std.fs.path.dirname(file_path.text) orelse file_path.text,
                        import_record,
                    ) catch |err| {
                        switch (err) {
                            error.ModuleNotFound => {
                                if (Resolver.Resolver.isPackagePath(import_record.path.text)) {
                                    if (bundler.options.platform != .node and options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                        try bundler.log.addRangeErrorFmt(
                                            &result.source,
                                            import_record.range,
                                            bundler.allocator,
                                            "Could not resolve: \"{s}\". Try setting --platform=\"node\"",
                                            .{import_record.path.text},
                                        );
                                    } else {
                                        try bundler.log.addRangeErrorFmt(
                                            &result.source,
                                            import_record.range,
                                            bundler.allocator,
                                            "Could not resolve: \"{s}\". Maybe you need to \"npm install\" (or yarn/pnpm)?",
                                            .{import_record.path.text},
                                        );
                                    }
                                } else {
                                    try bundler.log.addRangeErrorFmt(
                                        &result.source,
                                        import_record.range,
                                        bundler.allocator,
                                        "Could not resolve: \"{s}\"",
                                        .{
                                            import_record.path.text,
                                        },
                                    );
                                }
                            },
                            else => {
                                continue;
                            },
                        }
                    };
                }
            },
            else => {},
        }

        const output_file = try bundler.print(
            result,
        );

        js_ast.Stmt.Data.Store.reset();
        js_ast.Expr.Data.Store.reset();

        return output_file;
    }

    pub fn print(
        bundler: *Bundler,
        result: ParseResult,
    ) !options.OutputFile {
        var allocator = bundler.allocator;
        var parts = &([_]string{result.source.path.text});
        var abs_path = bundler.fs.abs(parts);
        var rel_path = bundler.fs.relativeTo(abs_path);
        var pathname = Fs.PathName.init(rel_path);

        if (bundler.options.out_extensions.get(pathname.ext)) |ext| {
            pathname.ext = ext;
        }

        var stack_fallback = std.heap.stackFallback(1024, bundler.allocator);

        var stack = stack_fallback.get();
        var _out_path = std.fmt.allocPrint(stack, "{s}{s}{s}{s}", .{ pathname.dir, std.fs.path.sep_str, pathname.base, pathname.ext }) catch unreachable;
        defer stack.free(_out_path);
        var out_path = bundler.fs.filename_store.append(_out_path) catch unreachable;

        const ast = result.ast;

        var _linker = linker.Linker{};
        var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

        const print_result = try js_printer.printAst(
            allocator,
            ast,
            js_ast.Symbol.Map.initList(symbols),
            &result.source,
            false,
            js_printer.Options{ .to_module_ref = Ref.RuntimeRef },
            &_linker,
        );
        // allocator.free(result.source.contents);

        return options.OutputFile{
            .path = out_path,
            .contents = print_result.js,
        };
    }

    pub const ParseResult = struct {
        source: logger.Source,
        loader: options.Loader,

        ast: js_ast.Ast,
    };
    pub var tracing_start: i128 = if (enableTracing) 0 else undefined;
    pub fn parse(bundler: *Bundler, path: Fs.Path, loader: options.Loader) ?ParseResult {
        if (enableTracing) {
            tracing_start = std.time.nanoTimestamp();
        }
        defer {
            if (enableTracing) {
                bundler.elapsed += std.time.nanoTimestamp() - tracing_start;
            }
        }
        var result: ParseResult = undefined;
        const entry = bundler.resolver.caches.fs.readFile(bundler.fs, path.text) catch return null;
        const source = logger.Source.initFile(Fs.File{ .path = path, .contents = entry.contents }, bundler.allocator) catch return null;

        switch (loader) {
            .js, .jsx, .ts, .tsx => {
                var jsx = bundler.options.jsx;
                jsx.parse = loader.isJSX();
                var opts = js_parser.Parser.Options.init(jsx, loader);
                const value = (bundler.resolver.caches.js.parse(bundler.allocator, opts, bundler.options.define, bundler.log, &source) catch null) orelse return null;
                return ParseResult{
                    .ast = value,
                    .source = source,
                    .loader = loader,
                };
            },
            .json => {
                var expr = json_parser.ParseJSON(&source, bundler.log, bundler.allocator) catch return null;
                var stmt = js_ast.Stmt.alloc(bundler.allocator, js_ast.S.ExportDefault{
                    .value = js_ast.StmtOrExpr{ .expr = expr },
                    .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
                }, logger.Loc{ .start = 0 });
                var stmts = bundler.allocator.alloc(js_ast.Stmt, 1) catch unreachable;
                stmts[0] = stmt;
                var parts = bundler.allocator.alloc(js_ast.Part, 1) catch unreachable;
                parts[0] = js_ast.Part{ .stmts = stmts };

                return ParseResult{
                    .ast = js_ast.Ast.initTest(parts),
                    .source = source,
                    .loader = loader,
                };
            },
            .css => {
                return null;
            },
            else => Global.panic("Unsupported loader {s} for path: {s}", .{ loader, source.path.text }),
        }

        return null;
    }

    pub fn buildServeResultOutput(bundler: *Bundler, resolve: Resolver.Resolver.Result, loader: options.Loader) !ServeResult.Output {
        switch (loader) {
            .js, .jsx, .ts, .tsx, .json => {
                return ServeResult.Output{ .built = bundler.buildWithResolveResult(resolve) orelse error.BuildFailed };
            },
            else => {
                return ServeResult.Output{ .file = ServeResult.Output.File{ .absolute_path = resolve.path_pair.primary.text } };
            },
        }
    }

    threadlocal var tmp_buildfile_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

    // We try to be mostly stateless when serving
    // This means we need a slightly different resolver setup
    // Essentially:
    pub fn buildFile(
        bundler: *Bundler,
        log: *logger.Log,
        allocator: *std.mem.Allocator,
        relative_path: string,
        extension: string,
    ) !ServeResult {
        var original_resolver_logger = bundler.resolver.log;
        var original_bundler_logger = bundler.log;

        defer bundler.log = original_bundler_logger;
        defer bundler.resolver.log = original_resolver_logger;
        bundler.log = log;
        bundler.resolver.log = log;

        // Resolving a public file has special behavior
        if (bundler.options.public_dir_enabled) {
            // On Windows, we don't keep the directory handle open forever because Windows doesn't like that.
            const public_dir: std.fs.Dir = bundler.options.public_dir_handle orelse std.fs.openDirAbsolute(bundler.options.public_dir, .{}) catch |err| {
                log.addErrorFmt(null, logger.Loc.Empty, allocator, "Opening public directory failed: {s}", .{@errorName(err)}) catch unreachable;
                Output.printErrorln("Opening public directory failed: {s}", .{@errorName(err)});
                bundler.options.public_dir_enabled = false;
                return error.PublicDirError;
            };

            var relative_unrooted_path: []u8 = resolve_path.normalizeString(relative_path, false, .auto);

            var _file: ?std.fs.File = null;

            // Is it the index file?
            if (relative_unrooted_path.len == 1 and relative_unrooted_path[0] == '.') {
                // std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path);
                // std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/"
                // Search for /index.html
                if (public_dir.openFile("index.html", .{})) |file| {
                    std.mem.copy(u8, relative_unrooted_path, "index.html");
                    relative_unrooted_path = relative_unrooted_path[0.."index.html".len];
                    _file = file;
                } else |err| {}
                // Okay is it actually a full path?
            } else {
                if (public_dir.openFile(relative_unrooted_path, .{})) |file| {
                    _file = file;
                } else |err| {}
            }

            // Try some weird stuff.
            while (_file == null and relative_unrooted_path.len > 1) {
                // When no extension is provided, it might be html
                if (extension.len == 0) {
                    std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                    std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], ".html");

                    if (public_dir.openFile(tmp_buildfile_buf[0 .. relative_unrooted_path.len + ".html".len], .{})) |file| {
                        _file = file;
                        break;
                    } else |err| {}

                    var _path: []u8 = undefined;
                    if (relative_unrooted_path[relative_unrooted_path.len - 1] == '/') {
                        std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path[0 .. relative_unrooted_path.len - 1]);
                        std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len - 1 ..], "/index.html");
                        _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len - 1 + "/index.html".len];
                    } else {
                        std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path[0..relative_unrooted_path.len]);
                        std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/index.html");

                        _path = tmp_buildfile_buf[0 .. relative_unrooted_path.len + "/index.html".len];
                    }

                    if (public_dir.openFile(_path, .{})) |file| {
                        const __path = _path;
                        relative_unrooted_path = __path;
                        _file = file;
                        break;
                    } else |err| {}
                }

                break;
            }

            if (_file) |file| {
                const _parts = [_]string{ bundler.options.public_dir, relative_unrooted_path };
                return ServeResult{
                    .value = ServeResult.Value{ .file = .{
                        .absolute_path = try bundler.fs.joinAlloc(allocator, &_parts),
                        .handle = file,
                    } },
                    .mime_type = MimeType.byExtension(extension),
                };
            }
        }

        // We make some things faster in theory by using absolute paths instead of relative paths
        const absolute_path = resolve_path.joinAbsStringBuf(
            bundler.fs.top_level_dir,
            &tmp_buildfile_buf,
            &([_][]const u8{relative_path}),
            .auto,
        );

        const resolved = (try bundler.resolver.resolve(bundler.fs.top_level_dir, absolute_path, .entry_point));

        const loader = bundler.options.loaders.get(resolved.path_pair.primary.name.ext) orelse .file;
        const output = switch (loader) {
            .js, .jsx, .ts, .tsx, .json => ServeResult.Value{
                .build = (try bundler.buildWithResolveResult(resolved)) orelse return error.BuildFailed,
            },
            else => ServeResult.Value{ .file = ServeResult.Value.File{
                .absolute_path = resolved.path_pair.primary.text,
                .handle = try std.fs.openFileAbsolute(resolved.path_pair.primary.text, .{ .read = true, .write = false }),
            } },
        };

        return ServeResult{
            .value = output,
            .mime_type = MimeType.byLoader(loader, resolved.path_pair.primary.name.ext),
        };
    }

    pub fn bundle(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        var bundler = try Bundler.init(allocator, log, opts);

        var entry_points = try allocator.alloc(Resolver.Resolver.Result, bundler.options.entry_points.len);

        if (isDebug) {
            log.level = .verbose;
            bundler.resolver.debug_logs = try Resolver.Resolver.DebugLogs.init(allocator);
        }

        var rfs: *Fs.FileSystem.RealFS = &bundler.fs.fs;

        var entry_point_i: usize = 0;
        for (bundler.options.entry_points) |_entry| {
            var entry: string = _entry;
            // if (!std.fs.path.isAbsolute(_entry)) {
            //     const _paths = [_]string{ bundler.fs.top_level_dir, _entry };
            //     entry = std.fs.path.join(allocator, &_paths) catch unreachable;
            // } else {
            //     entry = allocator.dupe(u8, _entry) catch unreachable;
            // }

            // const dir = std.fs.path.dirname(entry) orelse continue;
            // const base = std.fs.path.basename(entry);

            // var dir_entry = try rfs.readDirectory(dir);
            // if (std.meta.activeTag(dir_entry) == .err) {
            //     log.addErrorFmt(null, logger.Loc.Empty, allocator, "Failed to read directory: {s} - {s}", .{ dir, @errorName(dir_entry.err.original_err) }) catch unreachable;
            //     continue;
            // }

            // const file_entry = dir_entry.entries.get(base) orelse continue;
            // if (file_entry.entry.kind(rfs) != .file) {
            //     continue;
            // }

            if (!strings.startsWith(entry, "./")) {
                // allocator.free(entry);

                // Entry point paths without a leading "./" are interpreted as package
                // paths. This happens because they go through general path resolution
                // like all other import paths so that plugins can run on them. Requiring
                // a leading "./" for a relative path simplifies writing plugins because
                // entry points aren't a special case.
                //
                // However, requiring a leading "./" also breaks backward compatibility
                // and makes working with the CLI more difficult. So attempt to insert
                // "./" automatically when needed. We don't want to unconditionally insert
                // a leading "./" because the path may not be a file system path. For
                // example, it may be a URL. So only insert a leading "./" when the path
                // is an exact match for an existing file.
                var __entry = allocator.alloc(u8, "./".len + entry.len) catch unreachable;
                __entry[0] = '.';
                __entry[1] = '/';
                std.mem.copy(u8, __entry[2..__entry.len], entry);
                entry = __entry;
            }

            const result = bundler.resolver.resolve(bundler.fs.top_level_dir, entry, .entry_point) catch |err| {
                Output.printError("Error resolving \"{s}\": {s}\n", .{ entry, @errorName(err) });
                continue;
            };
            const key = result.path_pair.primary.text;
            if (bundler.resolve_results.contains(key)) {
                continue;
            }
            try bundler.resolve_results.put(key, result);
            entry_points[entry_point_i] = result;

            if (isDebug) {
                Output.print("Resolved {s} => {s}", .{ entry, result.path_pair.primary.text });
            }

            entry_point_i += 1;
            bundler.resolve_queue.writeItem(result) catch unreachable;
        }

        switch (bundler.options.resolve_mode) {
            .lazy, .dev, .bundle => {
                while (bundler.resolve_queue.readItem()) |item| {
                    const output_file = bundler.buildWithResolveResult(item) catch continue orelse continue;
                    bundler.output_files.append(output_file) catch unreachable;
                }
            },
            else => Global.panic("Unsupported resolve mode: {s}", .{@tagName(bundler.options.resolve_mode)}),
        }

        // if (log.level == .verbose) {
        //     for (log.msgs.items) |msg| {
        //         try msg.writeFormat(std.io.getStdOut().writer());
        //     }
        // }

        // if (bundler.needs_runtime) {
        //     try bundler.output_files.append(options.OutputFile{

        //     });
        // }

        if (enableTracing) {
            Output.print(
                "\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n",
                .{ bundler.resolver.elapsed, bundler.elapsed },
            );
        }

        return try options.TransformResult.init(try allocator.dupe(u8, bundler.result.outbase), bundler.output_files.toOwnedSlice(), log, allocator);
    }
};

pub const Transformer = struct {
    options: options.TransformOptions,
    log: *logger.Log,
    allocator: *std.mem.Allocator,
    result: ?options.TransformResult = null,

    pub fn transform(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        var raw_defines = try options.stringHashMapFromArrays(RawDefines, allocator, opts.define_keys, opts.define_values);
        if (opts.define_keys.len == 0) {
            try raw_defines.put("process.env.NODE_ENV", "\"development\"");
        }

        var user_defines = try DefineData.from_input(raw_defines, log, alloc.static);
        var define = try Define.init(
            alloc.static,
            user_defines,
        );

        const cwd = opts.absolute_working_dir orelse try std.process.getCwdAlloc(allocator);
        const output_dir_parts = [_]string{ try std.process.getCwdAlloc(allocator), opts.output_dir orelse "out" };
        const output_dir = try std.fs.path.join(allocator, &output_dir_parts);
        var output_files = try std.ArrayList(options.OutputFile).initCapacity(allocator, opts.entry_points.len);
        var loader_values = try allocator.alloc(options.Loader, opts.loader_values.len);
        for (loader_values) |_, i| {
            const loader = switch (opts.loader_values[i]) {
                .jsx => options.Loader.jsx,
                .js => options.Loader.js,
                .ts => options.Loader.ts,
                .css => options.Loader.css,
                .tsx => options.Loader.tsx,
                .json => options.Loader.json,
                else => unreachable,
            };

            loader_values[i] = loader;
        }
        var loader_map = try options.stringHashMapFromArrays(
            std.StringHashMap(options.Loader),
            allocator,
            opts.loader_keys,
            loader_values,
        );
        var use_default_loaders = loader_map.count() == 0;

        var jsx = if (opts.jsx) |_jsx| try options.JSX.Pragma.fromApi(_jsx, allocator) else options.JSX.Pragma{};

        var output_i: usize = 0;
        var chosen_alloc: *std.mem.Allocator = allocator;
        var arena: std.heap.ArenaAllocator = undefined;
        const use_arenas = opts.entry_points.len > 8;

        for (opts.entry_points) |entry_point, i| {
            if (use_arenas) {
                arena = std.heap.ArenaAllocator.init(allocator);
                chosen_alloc = &arena.allocator;
            }

            defer {
                if (use_arenas) {
                    arena.deinit();
                }
            }

            var _log = logger.Log.init(allocator);
            var __log = &_log;
            var paths = [_]string{ cwd, entry_point };
            const absolutePath = try std.fs.path.resolve(chosen_alloc, &paths);

            const file = try std.fs.openFileAbsolute(absolutePath, std.fs.File.OpenFlags{ .read = true });
            defer file.close();
            const stat = try file.stat();

            const code = try file.readToEndAlloc(allocator, stat.size);
            defer {
                if (_log.msgs.items.len == 0) {
                    allocator.free(code);
                }
                chosen_alloc.free(absolutePath);
                _log.appendTo(log) catch {};
            }
            const _file = Fs.File{ .path = Fs.Path.init(entry_point), .contents = code };
            var source = try logger.Source.initFile(_file, chosen_alloc);
            var loader: options.Loader = undefined;
            if (use_default_loaders) {
                loader = options.defaultLoaders.get(std.fs.path.extension(absolutePath)) orelse continue;
            } else {
                loader = options.Loader.forFileName(
                    entry_point,
                    loader_map,
                ) orelse continue;
            }

            jsx.parse = loader.isJSX();

            const parser_opts = js_parser.Parser.Options.init(jsx, loader);
            var _source = &source;
            const res = _transform(chosen_alloc, allocator, __log, parser_opts, loader, define, _source) catch continue;

            const relative_path = resolve_path.relative(cwd, absolutePath);
            const out_path = resolve_path.joinAbs2(cwd, .auto, absolutePath, relative_path);
            try output_files.append(options.OutputFile{ .path = allocator.dupe(u8, out_path) catch continue, .contents = res.js });
        }

        return try options.TransformResult.init(output_dir, output_files.toOwnedSlice(), log, allocator);
    }

    pub fn _transform(
        allocator: *std.mem.Allocator,
        result_allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: js_parser.Parser.Options,
        loader: options.Loader,
        define: *Define,
        source: *logger.Source,
    ) !js_printer.PrintResult {
        var ast: js_ast.Ast = undefined;

        switch (loader) {
            .json => {
                var expr = try json_parser.ParseJSON(source, log, allocator);
                var stmt = js_ast.Stmt.alloc(allocator, js_ast.S.ExportDefault{
                    .value = js_ast.StmtOrExpr{ .expr = expr },
                    .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
                }, logger.Loc{ .start = 0 });
                var stmts = try allocator.alloc(js_ast.Stmt, 1);
                stmts[0] = stmt;
                var parts = try allocator.alloc(js_ast.Part, 1);
                parts[0] = js_ast.Part{ .stmts = stmts };

                ast = js_ast.Ast.initTest(parts);
            },
            .jsx, .tsx, .ts, .js => {
                var parser = try js_parser.Parser.init(opts, log, source, define, allocator);
                var res = try parser.parse();
                ast = res.ast;

                if (FeatureFlags.print_ast) {
                    try ast.toJSON(allocator, std.io.getStdErr().writer());
                }
            },
            else => {
                Global.panic("Unsupported loader: {s} for path: {s}", .{ loader, source.path.text });
            },
        }

        var _linker = linker.Linker{};
        var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

        return try js_printer.printAst(
            result_allocator,
            ast,
            js_ast.Symbol.Map.initList(symbols),
            source,
            false,
            js_printer.Options{ .to_module_ref = ast.module_ref orelse js_ast.Ref{ .inner_index = 0 } },
            &_linker,
        );
    }
};
