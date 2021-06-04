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
const _resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ThreadPool = sync.ThreadPool;
const ThreadSafeHashMap = @import("./thread_safe_hash_map.zig");
const ImportRecord = @import("./import_record.zig").ImportRecord;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const runtime = @import("./runtime.zig");
const Timer = @import("./timer.zig");

const DebugLogs = _resolver.DebugLogs;

pub const ServeResult = struct {
    file: options.OutputFile,
    mime_type: MimeType,
};

// const BundleMap =
pub const ResolveResults = ThreadSafeHashMap.ThreadSafeStringHashMap(_resolver.Result);
pub const ResolveQueue = std.fifo.LinearFifo(_resolver.Result, std.fifo.LinearFifoBufferType.Dynamic);

// How it works end-to-end
// 1. Resolve a file path from input using the resolver
// 2. Look at the extension of that file path, and determine a loader
// 3. If the loader is .js, .jsx, .ts, .tsx, or .json, run it through our JavaScript Parser
// IF serving via HTTP and it's parsed without errors:
// 4. If parsed without errors, generate a strong ETag & write the output to a buffer that sends to the in the Printer.
// 7. Else, write any errors to error page
// IF writing to disk AND it's parsed without errors:
// 4. Write the output to a temporary file.
//    Why? Two reasons.
//    1. At this point, we don't know what the best output path is.
//       Most of the time, you want the shortest common path, which you can't know until you've
//       built & resolved all paths.
//       Consider this directory tree:
//          - /Users/jarred/Code/app/src/index.tsx
//          - /Users/jarred/Code/app/src/Button.tsx
//          - /Users/jarred/Code/app/assets/logo.png
//          - /Users/jarred/Code/app/src/Button.css
//          - /Users/jarred/Code/app/node_modules/react/index.js
//          - /Users/jarred/Code/app/node_modules/react/cjs/react.development.js
//        Remember that we cannot know which paths need to be resolved without parsing the JavaScript.
//        If we stopped here: /Users/jarred/Code/app/src/Button.tsx
//        We would choose /Users/jarred/Code/app/src/ as the directory
//        Then, that would result in a directory structure like this:
//         - /Users/jarred/Code/app/src/Users/jarred/Code/app/node_modules/react/cjs/react.development.js
//        Which is absolutely insane
//
//    2. We will need to write to disk at some point!
//          - If we delay writing to disk, we need to print & allocate a potentially quite large
//          buffer (react-dom.development.js is 550 KB)
//             ^ This is how it used to work!
//          - If we delay printing, we need to keep the AST around. Which breaks all our
//          recycling logic since that could be many many ASTs.
//  5. Once all files are written, determine the shortest common path
//  6. Move all the temporary files to their intended destinations
// IF writing to disk AND it's a file-like loader
// 4. Hash the contents
//     - rewrite_paths.put(absolute_path, hash(file(absolute_path)))
// 5. Resolve any imports of this file to that hash(file(absolute_path))
// 6. Append to the files array with the new filename
// 7. When parsing & resolving is over, just copy the file.
//     - on macOS, ensure it does an APFS shallow clone so that doesn't use disk space
// IF serving via HTTP AND it's a file-like loader:
// 4. Hash the metadata ${absolute_path}-${fstat.mtime}-${fstat.size}
// 5. Use a deterministic prefix so we know what file to look for without copying it
//    Example scenario:
//      GET /logo-SIU3242.png
//      404 Not Found because there is no file named "logo-SIu3242.png"
//    Instead, we can do this:
//      GET /public/SIU3242/logo.png
//      Our server sees "/public/" and knows the next segment will be a token
//      which lets it ignore that when resolving the absolute path on disk
// 6. Compare the current hash with the expected hash
// 7. IF does not match, do a 301 Temporary Redirect to the new file path
//    This adds an extra network request for outdated files, but that should be uncommon.
// 7. IF does match, serve it with that hash as a weak ETag
// 8. This should also just work unprefixed, but that will be served Cache-Control: private, no-store

pub const ParseResult = struct {
    source: logger.Source,
    loader: options.Loader,
    ast: js_ast.Ast,
};

pub fn NewBundler(cache_files: bool) type {
    return struct {
        const Linker = if (cache_files) linker.Linker else linker.ServeLinker;
        pub const Resolver = if (cache_files) _resolver.Resolver else _resolver.ResolverUncached;

        const ThisBundler = @This();

        options: options.BundleOptions,
        log: *logger.Log,
        allocator: *std.mem.Allocator,
        result: options.TransformResult = undefined,
        resolver: Resolver,
        fs: *Fs.FileSystem,
        // thread_pool: *ThreadPool,
        output_files: std.ArrayList(options.OutputFile),
        resolve_results: *ResolveResults,
        resolve_queue: ResolveQueue,
        elapsed: i128 = 0,
        needs_runtime: bool = false,
        linker: Linker,
        timer: Timer = Timer{},

        pub const RuntimeCode = @embedFile("./runtime.js");

        // to_bundle:

        // thread_pool: *ThreadPool,

        pub fn init(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            opts: Api.TransformOptions,
        ) !ThisBundler {
            js_ast.Expr.Data.Store.create(allocator);
            js_ast.Stmt.Data.Store.create(allocator);
            var fs = try Fs.FileSystem.init1(allocator, opts.absolute_working_dir, opts.serve orelse false);
            const bundle_options = try options.BundleOptions.fromApi(allocator, fs, log, opts);

            // var pool = try allocator.create(ThreadPool);
            // try pool.init(ThreadPool.InitConfig{
            //     .allocator = allocator,
            // });
            return ThisBundler{
                .options = bundle_options,
                .fs = fs,
                .allocator = allocator,
                .resolver = Resolver.init1(allocator, log, fs, bundle_options),
                .log = log,
                // .thread_pool = pool,
                .linker = undefined,
                .result = options.TransformResult{ .outbase = bundle_options.output_dir },
                .resolve_results = try ResolveResults.init(allocator),
                .resolve_queue = ResolveQueue.init(allocator),
                .output_files = std.ArrayList(options.OutputFile).init(allocator),
            };
        }

        pub fn configureLinker(bundler: *ThisBundler) void {
            bundler.linker = Linker.init(
                bundler.allocator,
                bundler.log,
                &bundler.resolve_queue,
                &bundler.options,
                &bundler.resolver,
                bundler.resolve_results,
                bundler.fs,
            );
        }

        pub fn resetStore(bundler: *ThisBundler) void {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();
        }

        pub fn buildWithResolveResult(
            bundler: *ThisBundler,
            resolve_result: _resolver.Result,
            allocator: *std.mem.Allocator,
            loader: options.Loader,
            comptime Writer: type,
            writer: Writer,
        ) !usize {
            if (resolve_result.is_external) {
                return 0;
            }

            errdefer bundler.resetStore();

            var file_path = resolve_result.path_pair.primary;
            file_path.pretty = allocator.dupe(u8, bundler.fs.relativeTo(file_path.text)) catch unreachable;

            var old_bundler_allocator = bundler.allocator;
            bundler.allocator = allocator;
            defer bundler.allocator = old_bundler_allocator;
            var result = bundler.parse(allocator, file_path, loader, resolve_result.dirname_fd) orelse {
                bundler.resetStore();
                return 0;
            };
            var old_linker_allocator = bundler.linker.allocator;
            defer bundler.linker.allocator = old_linker_allocator;
            bundler.linker.allocator = allocator;
            try bundler.linker.link(file_path, &result);

            return try bundler.print(
                result,
                Writer,
                writer,
            );
            // output_file.version = if (resolve_result.is_from_node_modules) resolve_result.package_json_version else null;

        }

        pub fn buildWithResolveResultEager(bundler: *ThisBundler, resolve_result: _resolver.Result) !?options.OutputFile {
            if (resolve_result.is_external) {
                return null;
            }

            errdefer js_ast.Expr.Data.Store.reset();
            errdefer js_ast.Stmt.Data.Store.reset();

            // Step 1. Parse & scan
            const loader = bundler.options.loaders.get(resolve_result.path_pair.primary.name.ext) orelse .file;
            var file_path = resolve_result.path_pair.primary;
            file_path.pretty = Linker.relative_paths_list.append(bundler.fs.relativeTo(file_path.text)) catch unreachable;

            switch (loader) {
                .jsx, .tsx, .js, .json => {
                    var result = bundler.parse(bundler.allocator, file_path, loader, resolve_result.dirname_fd) orelse {
                        js_ast.Expr.Data.Store.reset();
                        js_ast.Stmt.Data.Store.reset();
                        return null;
                    };

                    try bundler.linker.link(file_path, &result);
                    var output_file = options.OutputFile{
                        .input = file_path,
                        .loader = loader,
                        .value = undefined,
                    };

                    const output_dir = bundler.options.output_dir_handle.?;
                    if (std.fs.path.dirname(file_path.pretty)) |dirname| {
                        try output_dir.makePath(dirname);
                    }

                    var file = try output_dir.createFile(file_path.pretty, .{});
                    output_file.size = try bundler.print(
                        result,
                        js_printer.FileWriter,
                        js_printer.NewFileWriter(file),
                    );

                    var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);
                    file_op.dir = output_dir.fd;
                    file_op.fd = file.handle;

                    if (bundler.fs.fs.needToCloseFiles()) {
                        file.close();
                        file_op.fd = 0;
                    }
                    file_op.is_tmpdir = false;
                    output_file.value = .{ .move = file_op };
                    return output_file;
                },
                // TODO:
                else => {
                    return null;
                },
            }
        }

        pub fn print(
            bundler: *ThisBundler,
            result: ParseResult,
            comptime Writer: type,
            writer: Writer,
        ) !usize {
            const ast = result.ast;
            var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

            return try js_printer.printAst(
                Writer,
                writer,
                ast,
                js_ast.Symbol.Map.initList(symbols),
                &result.source,
                false,
                js_printer.Options{
                    .to_module_ref = Ref.RuntimeRef,
                    .externals = ast.externals,
                    .runtime_imports = ast.runtime_imports,
                },
                Linker,
                &bundler.linker,
            );
        }

        pub fn parse(bundler: *ThisBundler, allocator: *std.mem.Allocator, path: Fs.Path, loader: options.Loader, dirname_fd: StoredFileDescriptorType) ?ParseResult {
            if (FeatureFlags.tracing) {
                bundler.timer.start();
            }
            defer {
                if (FeatureFlags.tracing) {
                    bundler.timer.stop();
                    bundler.elapsed += bundler.timer.elapsed;
                }
            }
            var result: ParseResult = undefined;
            const entry = bundler.resolver.caches.fs.readFile(bundler.fs, path.text, dirname_fd, !cache_files) catch return null;

            const source = logger.Source.initFile(Fs.File{ .path = path, .contents = entry.contents }, bundler.allocator) catch return null;

            switch (loader) {
                .js, .jsx, .ts, .tsx => {
                    var jsx = bundler.options.jsx;
                    jsx.parse = loader.isJSX();
                    var opts = js_parser.Parser.Options.init(jsx, loader);
                    const value = (bundler.resolver.caches.js.parse(allocator, opts, bundler.options.define, bundler.log, &source) catch null) orelse return null;
                    return ParseResult{
                        .ast = value,
                        .source = source,
                        .loader = loader,
                    };
                },
                .json => {
                    var expr = json_parser.ParseJSON(&source, bundler.log, allocator) catch return null;
                    var stmt = js_ast.Stmt.alloc(allocator, js_ast.S.ExportDefault{
                        .value = js_ast.StmtOrExpr{ .expr = expr },
                        .default_name = js_ast.LocRef{ .loc = logger.Loc{}, .ref = Ref{} },
                    }, logger.Loc{ .start = 0 });
                    var stmts = allocator.alloc(js_ast.Stmt, 1) catch unreachable;
                    stmts[0] = stmt;
                    var parts = allocator.alloc(js_ast.Part, 1) catch unreachable;
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

        pub fn buildServeResultOutput(bundler: *ThisBundler, resolve: _resolver.Result, loader: options.Loader) !ServeResult.Output {
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
            bundler: *ThisBundler,
            log: *logger.Log,
            allocator: *std.mem.Allocator,
            relative_path: string,
            _extension: string,
        ) !ServeResult {
            var extension = _extension;
            var original_resolver_logger = bundler.resolver.log;
            var original_bundler_logger = bundler.log;

            defer bundler.log = original_bundler_logger;
            defer bundler.resolver.log = original_resolver_logger;
            bundler.log = log;
            bundler.linker.allocator = allocator;
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
                if (relative_unrooted_path.len == 0) {
                    // std.mem.copy(u8, &tmp_buildfile_buf, relative_unrooted_path);
                    // std.mem.copy(u8, tmp_buildfile_buf[relative_unrooted_path.len..], "/"
                    // Search for /index.html
                    if (public_dir.openFile("index.html", .{})) |file| {
                        var index_path = "index.html".*;
                        relative_unrooted_path = &(index_path);
                        _file = file;
                        extension = "html";
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
                            extension = "html";
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
                            extension = "html";
                            _file = file;
                            break;
                        } else |err| {}
                    }

                    break;
                }

                if (_file) |*file| {
                    var stat = try file.stat();
                    var absolute_path = resolve_path.joinAbs(bundler.options.public_dir, .auto, relative_unrooted_path);

                    if (stat.kind == .SymLink) {
                        absolute_path = try std.fs.realpath(absolute_path, &tmp_buildfile_buf);
                        file.close();
                        file.* = try std.fs.openFileAbsolute(absolute_path, .{ .read = true });
                        stat = try file.stat();
                    }

                    if (stat.kind != .File) {
                        file.close();
                        return error.NotFile;
                    }

                    return ServeResult{
                        .file = options.OutputFile.initFile(file.*, absolute_path, stat.size),
                        .mime_type = MimeType.byExtension(std.fs.path.extension(absolute_path)[1..]),
                    };
                }
            }

            if (strings.eqlComptime(relative_path, "__runtime.js")) {
                return ServeResult{
                    .file = options.OutputFile.initBuf(runtime.SourceContent, "__runtime.js", .js),
                    .mime_type = MimeType.javascript,
                };
            }

            // We make some things faster in theory by using absolute paths instead of relative paths
            var absolute_path = resolve_path.joinAbsStringBuf(
                bundler.fs.top_level_dir,
                &tmp_buildfile_buf,
                &([_][]const u8{relative_path}),
                .auto,
            );

            defer {
                js_ast.Expr.Data.Store.reset();
                js_ast.Stmt.Data.Store.reset();
            }

            // If the extension is .js, omit it.
            // if (absolute_path.len > ".js".len and strings.eqlComptime(absolute_path[absolute_path.len - ".js".len ..], ".js")) {
            //     absolute_path = absolute_path[0 .. absolute_path.len - ".js".len];
            // }

            const resolved = (try bundler.resolver.resolve(bundler.fs.top_level_dir, absolute_path, .entry_point));

            const loader = bundler.options.loaders.get(resolved.path_pair.primary.name.ext) orelse .file;

            switch (loader) {
                .js, .jsx, .ts, .tsx, .json => {
                    return ServeResult{
                        .file = options.OutputFile.initPending(loader, resolved),
                        .mime_type = MimeType.byLoader(
                            loader,
                            bundler.options.out_extensions.get(resolved.path_pair.primary.name.ext) orelse resolved.path_pair.primary.name.ext,
                        ),
                    };
                },
                else => {
                    var abs_path = resolved.path_pair.primary.text;
                    const file = try std.fs.openFileAbsolute(abs_path, .{ .read = true });
                    var stat = try file.stat();
                    return ServeResult{
                        .file = options.OutputFile.initFile(file, abs_path, stat.size),
                        .mime_type = MimeType.byLoader(loader, abs_path),
                    };
                },
            }
        }

        pub fn bundle(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            opts: Api.TransformOptions,
        ) !options.TransformResult {
            var bundler = try ThisBundler.init(allocator, log, opts);
            bundler.configureLinker();

            if (bundler.options.write and bundler.options.output_dir.len > 0) {}

            //  100.00 µs std.fifo.LinearFifo(resolver.Result,std.fifo.LinearFifoBufferType { .Dynamic = {}}).writeItemAssumeCapacity
            if (bundler.options.resolve_mode != .lazy) {
                try bundler.resolve_queue.ensureUnusedCapacity(24);
            }

            var entry_points = try allocator.alloc(_resolver.Result, bundler.options.entry_points.len);

            if (isDebug) {
                log.level = .verbose;
                bundler.resolver.debug_logs = try DebugLogs.init(allocator);
            }

            var rfs: *Fs.FileSystem.RealFS = &bundler.fs.fs;

            var entry_point_i: usize = 0;
            for (bundler.options.entry_points) |_entry| {
                var entry: string = _entry;

                if (!strings.startsWith(entry, "./")) {
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

                defer {
                    js_ast.Expr.Data.Store.reset();
                    js_ast.Stmt.Data.Store.reset();
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
                        js_ast.Expr.Data.Store.reset();
                        js_ast.Stmt.Data.Store.reset();
                        const output_file = bundler.buildWithResolveResultEager(item) catch continue orelse continue;
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

            if (bundler.linker.any_needs_runtime) {
                try bundler.output_files.append(
                    options.OutputFile.initBuf(runtime.SourceContent, bundler.linker.runtime_source_path, .js),
                );
            }

            if (FeatureFlags.tracing) {
                Output.printError(
                    "\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n",
                    .{
                        bundler.resolver.elapsed,
                        bundler.elapsed,
                    },
                );
            }

            var final_result = try options.TransformResult.init(try allocator.dupe(u8, bundler.result.outbase), bundler.output_files.toOwnedSlice(), log, allocator);
            final_result.root_dir = bundler.options.output_dir_handle;
            return final_result;
        }
    };
}

pub const Bundler = NewBundler(true);
pub const ServeBundler = NewBundler(false);

pub const Transformer = struct {
    opts: Api.TransformOptions,
    log: *logger.Log,
    allocator: *std.mem.Allocator,
    platform: options.Platform = undefined,
    out_extensions: std.StringHashMap(string) = undefined,
    output_path: string,
    cwd: string,
    define: *Define,

    pub fn transform(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        js_ast.Expr.Data.Store.create(allocator);
        js_ast.Stmt.Data.Store.create(allocator);
        var raw_defines = try options.stringHashMapFromArrays(RawDefines, allocator, opts.define_keys, opts.define_values);
        if (opts.define_keys.len == 0) {
            try raw_defines.put("process.env.NODE_ENV", "\"development\"");
        }

        var user_defines = try DefineData.from_input(raw_defines, log, alloc.static);
        var define = try Define.init(
            alloc.static,
            user_defines,
        );

        const cwd = if (opts.absolute_working_dir) |workdir| try std.fs.realpathAlloc(allocator, workdir) else try std.process.getCwdAlloc(allocator);

        const output_dir_parts = [_]string{ try std.process.getCwdAlloc(allocator), opts.output_dir orelse "out" };
        const output_dir = try std.fs.path.join(allocator, &output_dir_parts);
        var output_files = try std.ArrayList(options.OutputFile).initCapacity(allocator, opts.entry_points.len);
        var loader_values = try allocator.alloc(options.Loader, opts.loader_values.len);
        const platform = options.Platform.from(opts.platform);
        const out_extensions = platform.outExtensions(allocator);

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

        var ulimit: usize = Fs.FileSystem.RealFS.adjustUlimit();
        var care_about_closing_files = !(FeatureFlags.store_file_descriptors and opts.entry_points.len * 2 < ulimit);

        var transformer = Transformer{
            .log = log,
            .allocator = allocator,
            .opts = opts,
            .cwd = cwd,
            .platform = platform,
            .out_extensions = out_extensions,
            .define = define,
            .output_path = output_dir,
        };

        const write_to_output_dir = opts.entry_points.len > 1 or opts.output_dir != null;

        var output_dir_handle: ?std.fs.Dir = null;
        if (write_to_output_dir) {
            output_dir_handle = try options.openOutputDir(output_dir);
        }

        if (write_to_output_dir) {
            for (opts.entry_points) |entry_point, i| {
                try transformer.processEntryPoint(
                    entry_point,
                    i,
                    &output_files,
                    output_dir_handle,
                    .disk,
                    care_about_closing_files,
                    use_default_loaders,
                    loader_map,
                    &jsx,
                );
            }
        } else {
            for (opts.entry_points) |entry_point, i| {
                try transformer.processEntryPoint(
                    entry_point,
                    i,
                    &output_files,
                    output_dir_handle,
                    .stdout,
                    care_about_closing_files,
                    use_default_loaders,
                    loader_map,
                    &jsx,
                );
            }
        }

        return try options.TransformResult.init(output_dir, output_files.toOwnedSlice(), log, allocator);
    }

    pub fn processEntryPoint(
        transformer: *Transformer,
        entry_point: string,
        i: usize,
        output_files: *std.ArrayList(options.OutputFile),
        _output_dir: ?std.fs.Dir,
        comptime write_destination_type: options.WriteDestination,
        care_about_closing_files: bool,
        use_default_loaders: bool,
        loader_map: std.StringHashMap(options.Loader),
        jsx: *options.JSX.Pragma,
    ) !void {
        var allocator = transformer.allocator;
        var log = transformer.log;

        var _log = logger.Log.init(allocator);
        var __log = &_log;
        const absolutePath = resolve_path.joinAbs(transformer.cwd, .auto, entry_point);

        const file = try std.fs.openFileAbsolute(absolutePath, std.fs.File.OpenFlags{ .read = true });
        defer {
            if (care_about_closing_files) {
                file.close();
            }
        }

        const stat = try file.stat();

        const code = try file.readToEndAlloc(allocator, stat.size);
        defer {
            if (_log.msgs.items.len == 0) {
                allocator.free(code);
            }
            _log.appendTo(log) catch {};
        }
        const _file = Fs.File{ .path = Fs.Path.init(entry_point), .contents = code };
        var source = try logger.Source.initFile(_file, allocator);
        var loader: options.Loader = undefined;
        if (use_default_loaders) {
            loader = options.defaultLoaders.get(std.fs.path.extension(absolutePath)) orelse return;
        } else {
            loader = options.Loader.forFileName(
                entry_point,
                loader_map,
            ) orelse return;
        }

        var _source = &source;

        var output_file = options.OutputFile{
            .input = _file.path,
            .loader = loader,
            .value = undefined,
        };

        var file_to_write: std.fs.File = undefined;
        var output_path: Fs.Path = undefined;

        switch (write_destination_type) {
            .stdout => {
                file_to_write = std.io.getStdOut();
                output_path = Fs.Path.init("stdout");
            },
            .disk => {
                const output_dir = _output_dir orelse unreachable;
                output_path = Fs.Path.init(try allocator.dupe(u8, resolve_path.relative(transformer.cwd, entry_point)));
                file_to_write = try output_dir.createFile(entry_point, .{});
            },
        }

        switch (loader) {
            .jsx, .js, .ts, .tsx => {
                jsx.parse = loader.isJSX();
                var file_op = options.OutputFile.FileOperation.fromFile(file_to_write.handle, output_path.pretty);

                const parser_opts = js_parser.Parser.Options.init(jsx.*, loader);
                file_op.is_tmpdir = false;
                output_file.value = .{ .move = file_op };

                if (_output_dir) |output_dir| {
                    file_op.dir = output_dir.fd;
                }

                file_op.fd = file.handle;
                var parser = try js_parser.Parser.init(parser_opts, log, _source, transformer.define, allocator);
                const result = try parser.parse();

                const ast = result.ast;
                var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

                output_file.size = try js_printer.printAst(
                    js_printer.FileWriter,
                    js_printer.NewFileWriter(file_to_write),
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    _source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .transform_imports = false,
                        .runtime_imports = ast.runtime_imports,
                    },
                    u1,
                    null,
                );
            },
            else => {
                unreachable;
            },
        }

        js_ast.Expr.Data.Store.reset();
        js_ast.Stmt.Data.Store.reset();
        try output_files.append(output_file);
    }

    pub fn _transform(
        allocator: *std.mem.Allocator,
        log: *logger.Log,
        opts: js_parser.Parser.Options,
        loader: options.Loader,
        define: *const Define,
        source: *const logger.Source,
        comptime Writer: type,
        writer: Writer,
    ) !usize {
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

        var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

        return try js_printer.printAst(
            Writer,
            writer,
            ast,
            js_ast.Symbol.Map.initList(symbols),
            source,
            false,
            js_printer.Options{
                .to_module_ref = ast.module_ref orelse js_ast.Ref{ .inner_index = 0 },
                .transform_imports = false,
                .runtime_imports = ast.runtime_imports,
            },
            null,
        );
    }
};
