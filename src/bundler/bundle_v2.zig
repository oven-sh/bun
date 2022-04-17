const Bundler = @import("../bundler.zig").Bundler;
const GenerateNodeModulesBundle = @This();
const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;
const C = bun.C;
const std = @import("std");
const lex = @import("../js_lexer.zig");
const Logger = @import("../logger.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser/js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const Ref = @import("../ast/base.zig").Ref;
const Define = @import("../defines.zig").Define;
const DebugOptions = @import("../cli.zig").Command.DebugOptions;
const ThreadPoolLib = @import("../thread_pool.zig");
const ThreadlocalArena = @import("../mimalloc_arena.zig").Arena;

const panicky = @import("../panic_handler.zig");
const Fs = @import("../fs.zig");
const schema = @import("../api/schema.zig");
const Api = schema.Api;
const _resolver = @import("../resolver/resolver.zig");
const sync = @import("../sync.zig");
const ImportRecord = @import("../import_record.zig").ImportRecord;
const allocators = @import("../allocators.zig");
const MimeType = @import("../http/mime_type.zig");
const resolve_path = @import("../resolver/resolve_path.zig");
const runtime = @import("../runtime.zig");
const Timer = @import("../timer.zig");
const PackageJSON = @import("../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../resolver/package_json.zig").MacroMap;
const DebugLogs = _resolver.DebugLogs;
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const Router = @import("../router.zig");
const isPackagePath = _resolver.isPackagePath;
const Lock = @import("../lock.zig").Lock;
const NodeFallbackModules = @import("../node_fallbacks.zig");
const CacheEntry = @import("../cache.zig").FsCacheEntry;
const Analytics = @import("../analytics/analytics_thread.zig");
const URL = @import("../url.zig").URL;
const Report = @import("../report.zig");
const Linker = linker.Linker;
const Resolver = _resolver.Resolver;
const TOML = @import("../toml/toml_parser.zig").TOML;
const Schema = @import("../api/bundle_v2.zig").BundleV2;
const EntryPoints = @import("./entry_points.zig");
const ParseChannel = sync.Channel(ParseTask.Result, .{ .Static = 500 });
const BundleV2 = @This();
const ThisBundler = @import("../bundler.zig").Bundler;
const StringPointer = Schema.StringPointer;
const wyhash = std.hash.Wyhash.hash;
const Dependency = js_ast.Dependency;
const JSAst = js_ast.Ast;

pub const ThreadPool = struct {
    pool: ThreadPoolLib = undefined,
    // Hardcode 512 as max number of threads for now.
    workers: [512]Worker = undefined,
    workers_used: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    cpu_count: u32 = 0,
    started_workers: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    stopped_workers: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    completed_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
    pending_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),

    v2: *BundleV2 = undefined,

    pub fn start(this: *ThreadPool, v2: *BundleV2) !void {
        v2.bundler.env.loadProcess();
        this.v2 = v2;

        this.cpu_count = @truncate(Ref.Int, @divFloor((try std.Thread.getCpuCount()) + 1, 2));

        if (v2.bundler.env.map.get("GOMAXPROCS")) |max_procs| {
            if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count| {
                this.cpu_count = std.math.min(this.cpu_count, cpu_count);
            } else |_| {}
        }

        this.pool = ThreadPoolLib.init(.{
            .max_threads = this.cpu_count,
        });
        this.pool.on_thread_spawn = Worker.onSpawn;
        this.pool.threadpool_context = this;
        var workers_used: u32 = 0;
        while (workers_used < this.cpu_count) : (workers_used += 1) {
            try this.workers[workers_used].init(v2);
        }
        if (workers_used > 0)
            this.pool.forceSpawn();
    }

    pub fn waitForParse(this: *ThreadPool, v2: *BundleV2) !void {
        var graph = &v2.graph;
        while (graph.parse_pending > 0) {
            while (graph.parse_channel.tryReadItem() catch null) |*parse_result| {
                var batch = ThreadPoolLib.Batch{};
                defer graph.parse_pending -= 1;

                switch (parse_result.*) {
                    .empty => |source_index| {
                        var input_files = graph.input_files.slice();
                        var side_effects = input_files.items(.side_effects);
                        side_effects[source_index] = .no_side_effects__empty_ast;
                    },
                    .success => |*result| {
                        result.log.appendTo(v2.bundler.log) catch unreachable;
                        {
                            var input_files = graph.input_files.slice();
                            input_files.items(.source)[result.source.index] = result.source;
                            input_files.items(.ast)[result.source.index] = @truncate(Ref.Int, graph.ast.len);
                        }

                        var iter = result.resolve_queue.iterator();

                        while (iter.next()) |entry| {
                            const hash = entry.key_ptr.*;
                            const value = entry.value_ptr.*;
                            var existing = graph.path_to_source_index_map.getOrPut(graph.allocator, hash) catch unreachable;
                            if (!existing.found_existing) {
                                var new_input_file = Graph.InputFile{
                                    .source = Logger.Source.initEmptyFile(entry.value_ptr.resolve_result.path().?.text),
                                    .side_effects = value.resolve_result.primary_side_effects_data,
                                };
                                new_input_file.source.index = @truncate(Ref.Int, graph.input_files.len - 1);
                                new_input_file.source.path = entry.value_ptr.resolve_result.path().?.*;
                                new_input_file.source.key_path = new_input_file.source.path;
                                existing.value_ptr.* = new_input_file.source.index;
                                entry.value_ptr.source_index = new_input_file.source.index;
                                graph.input_files.append(graph.allocator, new_input_file) catch unreachable;
                                batch.push(ThreadPoolLib.Batch.from(&entry.value_ptr.task));
                                graph.parse_pending += 1;
                            }
                        }

                        graph.ast.append(graph.allocator, result.ast) catch unreachable;
                        // schedule as early as possible
                        this.pool.schedule(batch);

                        var import_records = result.ast.import_records;
                        for (import_records) |*record| {
                            if (record.is_unused or record.is_internal) {
                                continue;
                            }

                            if (graph.path_to_source_index_map.get(wyhash(0, record.path.text))) |source_index| {
                                record.source_index = source_index;
                            }
                        }
                    },
                    .err => |*err| {
                        if (err.log.msgs.items.len > 0) {
                            err.log.appendTo(v2.bundler.log) catch unreachable;
                        } else {
                            v2.bundler.log.addErrorFmt(
                                null,
                                Logger.Loc.Empty,
                                v2.bundler.allocator,
                                "{s} while {s}",
                                .{ @errorName(err.err), @tagName(err.step) },
                            ) catch unreachable;
                        }
                    },
                }
            }
        }

        if (comptime Environment.allow_assert) {
            Output.prettyErrorln("Parsed {d} files, producing {d} ASTs", .{ graph.input_files.len, graph.ast.len });
        }
    }

    pub const Worker = struct {
        thread_id: std.Thread.Id,
        thread: std.Thread,
        heap: ThreadlocalArena = ThreadlocalArena{},
        allocator: std.mem.Allocator,
        ctx: *BundleV2,

        data: *WorkerData = undefined,
        quit: bool = false,

        has_notify_started: bool = false,

        pub const WorkerData = struct {
            log: *Logger.Log,
            estimated_input_lines_of_code: usize = 0,
            macro_context: js_ast.Macro.MacroContext,
            bundler: Bundler = undefined,

            pub fn deinit(this: *WorkerData, allocator: std.mem.Allocator) void {
                allocator.destroy(this);
            }
        };

        pub fn init(worker: *Worker, v2: *BundleV2) !void {
            worker.ctx = v2;
        }

        pub fn onSpawn(ctx: ?*anyopaque) ?*anyopaque {
            var pool = @ptrCast(*ThreadPool, @alignCast(@alignOf(*ThreadPool), ctx.?));

            const id = pool.workers_used.fetchAdd(1, .Monotonic);
            pool.workers[id].run();
            return &pool.workers[id];
        }

        pub fn notifyStarted(this: *Worker) void {
            if (!this.has_notify_started) {
                this.has_notify_started = true;
                _ = this.v2.pool.started_workers.fetchAdd(1, .Release);
                std.Thread.Futex.wake(&this.v2.pool.started_workers, std.math.maxInt(u32));
            }
        }

        pub fn run(this: *Worker) void {
            Output.Source.configureThread();
            this.thread_id = std.Thread.getCurrentId();
            this.heap = ThreadlocalArena.init() catch unreachable;
            this.allocator = this.heap.allocator();
            var allocator = this.allocator;
            if (Environment.isDebug) {
                Output.prettyln("Thread started.\n", .{});
            }

            // Ensure we're using the same allocator for the worker's data.
            js_ast.Expr.Data.Store.deinit();
            js_ast.Stmt.Data.Store.deinit();

            js_ast.Expr.Data.Store.create(allocator);
            js_ast.Stmt.Data.Store.create(allocator);
            this.data = allocator.create(WorkerData) catch unreachable;
            this.data.* = WorkerData{
                .log = allocator.create(Logger.Log) catch unreachable,
                .estimated_input_lines_of_code = 0,
                .macro_context = js_ast.Macro.MacroContext.init(this.ctx.bundler),
            };
            this.data.log.* = Logger.Log.init(allocator);
            this.data.bundler = this.ctx.bundler.*;
            var bundler_ptr = &this.data.bundler;
            const CacheSet = @import("../cache.zig");
            // no funny business mr. cache
            bundler_ptr.resolver.caches = CacheSet.Set.init(this.allocator);
            bundler_ptr.linker.resolver = &bundler_ptr.resolver;
            bundler_ptr.log = this.data.log;
            bundler_ptr.linker.log = this.data.log;
            bundler_ptr.linker.resolver.log = this.data.log;
        }
    };
};

const U32Map = std.AutoHashMap(u32, u32);
pub const current_version: u32 = 1;
const dist_index_js_string_pointer = StringPointer{ .length = "dist/index.js".len };
const index_js_string_pointer = StringPointer{ .length = "index.js".len, .offset = "dist/".len };

pub fn ensurePathIsAllocated(this: *BundleV2, path_: ?*Fs.Path) !void {
    var path = path_ orelse return;

    const loader = this.bundler.options.loaders.get(path.name.ext) orelse .file;
    if (!loader.isJavaScriptLikeOrJSON()) return;
    path.* = try path.dupeAlloc(this.allocator);
}

pub fn enqueueItem(this: *BundleV2, hash: ?u64, batch: *ThreadPoolLib.Batch, resolve: _resolver.Result) !?Ref.Int {
    var result = resolve;
    var path = result.path() orelse return null;

    const loader = this.bundler.options.loaders.get(path.name.ext) orelse .file;
    if (!loader.isJavaScriptLikeOrJSON()) return null;

    var entry = try this.graph.path_to_source_index_map.getOrPut(this.graph.allocator, hash orelse wyhash(0, path.text));
    if (entry.found_existing) {
        return null;
    }
    this.graph.parse_pending += 1;
    const source_index = @truncate(Ref.Int, this.graph.input_files.len);
    path.* = try path.dupeAlloc(this.graph.allocator);
    entry.value_ptr.* = source_index;
    try this.graph.input_files.append(this.graph.allocator, .{
        .source = .{
            .path = path.*,
            .key_path = path.*,
            .contents = "",
        },
        .loader = loader,
        .side_effects = resolve.primary_side_effects_data,
    });
    var task = try this.graph.allocator.create(ParseTask);
    task.* = .{
        .resolve_result = resolve,
        .source_index = source_index,
    };
    batch.push(ThreadPoolLib.Batch.from(&task.task));
    return source_index;
}

// The bun Bundle Format
// All the node_modules your app uses in a single compact file with metadata
// A binary JavaScript bundle format prioritizing generation time and deserialization time
pub const magic_bytes = "#!/usr/bin/env bun\n\n";
// This makes it possible to do ./path-to-bundle on posix systems so you can see the raw JS contents
// https://en.wikipedia.org/wiki/Magic_number_(programming)#In_files
// Immediately after the magic bytes, the next character is a uint32 followed by a newline
// 0x00000000\n
// That uint32 denotes the byte offset in the file where the code for the bundle ends
//     - If the value is 0, that means the file did not finish writing or there are no modules
//     - This imposes a maximum bundle size of around 4,294,967,295 bytes. If your JS is more than 4 GB, it won't work.
// The raw JavaScript is encoded as a UTF-8 string starting from the current position + 1 until the above byte offset.
// This uint32 is useful for HTTP servers to separate:
// - Which part of the bundle is the JS code?
// - Which part is the metadata?
// Without needing to do a full pass through the file, or necessarily care about the metadata.
// The metadata is at the bottom of the file instead of the top because the metadata is written after all JS code in the bundle is written.
// The rationale there is:
// 1. We cannot prepend to a file without rewriting the entire file
// 2. The metadata is variable-length and that format will change often.
// 3. We won't have all the metadata until after all JS is finished writing
// If you have 32 MB of JavaScript dependencies, you really want to avoid reading the code in memory.
//      - This lets you seek to the specific position in the file.
//      - HTTP servers should use sendfile() instead of copying the file to userspace memory.
// So instead, we append metadata to the file after printing each node_module
// When there are no more modules to process, we generate the metadata
// To find the metadata, you look at the byte offset: initial_header[magic_bytes.len..initial_header.len - 1]
// Then, you add that number to initial_header.len
const initial_header = brk: {
    var buf = std.mem.zeroes([magic_bytes.len + 5]u8);
    std.mem.copy(u8, &buf, magic_bytes);
    var remainder = buf[magic_bytes.len..];
    // Write an invalid byte offset to be updated after we finish generating the code
    std.mem.writeIntNative(u32, remainder[0 .. remainder.len - 1], 0);
    buf[buf.len - 1] = '\n';
    break :brk buf;
};
const code_start_byte_offset: u32 = initial_header.len;
// The specifics of the metadata is not documented here. You can find it in src/api/schema.peechy.

pub fn appendHeaderString(generator: *BundleV2, str: string) !StringPointer {
    // This is so common we might as well just reuse it
    // Plus this is one machine word so it's a quick comparison
    if (strings.eqlComptime(str, "index.js")) {
        return index_js_string_pointer;
    } else if (strings.eqlComptime(str, "dist/index.js")) {
        return dist_index_js_string_pointer;
    }

    var offset = generator.header_string_buffer.list.items.len;
    try generator.header_string_buffer.append(str);
    return StringPointer{
        .offset = @truncate(Ref.Int, offset),
        .length = @truncate(Ref.Int, str.len),
    };
}

// pub fn print(this: *BundleV2) !void {}

pub fn generate(
    bundler: *ThisBundler,
    allocator: std.mem.Allocator,
    framework_config: ?Api.LoadedFramework,
    route_config: ?Api.LoadedRouteConfig,
    destination: [*:0]const u8,
    estimated_input_lines_of_code: *usize,
    package_bundle_map: options.BundlePackage.Map,
) !?Schema.JavascriptBundleContainer {
    _ = try bundler.fs.fs.openTmpDir();
    var tmpname_buf: [64]u8 = undefined;
    bundler.resetStore();
    try bundler.configureDefines();
    _ = framework_config;
    _ = route_config;
    _ = estimated_input_lines_of_code;
    _ = package_bundle_map;

    const tmpname = try bundler.fs.tmpname(
        ".bun",
        std.mem.span(&tmpname_buf),
        wyhash(@intCast(usize, std.time.milliTimestamp()) % std.math.maxInt(u32), std.mem.span(destination)),
    );

    var tmpfile = Fs.FileSystem.RealFS.Tmpfile{};
    try tmpfile.create(&bundler.fs.fs, tmpname);

    errdefer tmpfile.closeAndDelete(tmpname);

    var generator = try allocator.create(BundleV2);

    defer allocator.destroy(generator);
    generator.* = BundleV2{
        .tmpfile = tmpfile.file(),
        .bundler = bundler,
        .graph = .{
            .pool = undefined,
            .heap = try ThreadlocalArena.init(),
            .allocator = undefined,
        },
    };
    generator.graph.allocator = generator.graph.heap.allocator();
    var pool = try generator.graph.allocator.create(ThreadPool);
    // errdefer pool.destroy();
    errdefer generator.graph.heap.deinit();

    if (framework_config != null) {
        defer bundler.resetStore();

        try bundler.configureFramework(true);
        if (bundler.options.framework) |framework| {
            Analytics.Features.framework = true;

            if (framework.override_modules.keys.len > 0) {
                bundler.options.framework.?.override_modules_hashes = allocator.alloc(u64, framework.override_modules.keys.len) catch unreachable;
                for (framework.override_modules.keys) |key, i| {
                    bundler.options.framework.?.override_modules_hashes[i] = std.hash.Wyhash.hash(0, key);
                }
            }
        }
    } else {}

    pool.* = ThreadPool{};
    generator.graph.pool = pool;

    var batch = ThreadPoolLib.Batch{};

    var this = generator;
    try pool.start(this);
    try generator.appendBytes(&initial_header);

    if (framework_config != null) {
        defer this.bundler.resetStore();

        try this.bundler.configureFramework(true);
        if (bundler.options.framework) |framework| {
            Analytics.Features.framework = true;

            if (framework.override_modules.keys.len > 0) {
                bundler.options.framework.?.override_modules_hashes = allocator.alloc(u64, framework.override_modules.keys.len) catch unreachable;
                for (framework.override_modules.keys) |key, i| {
                    bundler.options.framework.?.override_modules_hashes[i] = wyhash(0, key);
                }
            }
        }
    } else {}

    if (bundler.options.framework) |framework| {
        if (bundler.options.platform.isBun()) {
            if (framework.server.isEnabled()) {
                Analytics.Features.bunjs = true;
                const resolved = try bundler.resolver.resolve(
                    bundler.fs.top_level_dir,
                    framework.server.path,
                    .entry_point,
                );
                if (try this.enqueueItem(null, &batch, resolved)) |source_index| {
                    this.graph.entry_points.append(this.graph.allocator, source_index) catch unreachable;
                } else {}
            }
        } else {
            if (framework.client.isEnabled()) {
                const resolved = try bundler.resolver.resolve(
                    bundler.fs.top_level_dir,
                    framework.client.path,
                    .entry_point,
                );
                if (try this.enqueueItem(null, &batch, resolved)) |source_index| {
                    this.graph.entry_points.append(this.graph.allocator, source_index) catch unreachable;
                } else {}
            }

            if (framework.fallback.isEnabled()) {
                const resolved = try bundler.resolver.resolve(
                    bundler.fs.top_level_dir,
                    framework.fallback.path,
                    .entry_point,
                );
                if (try this.enqueueItem(null, &batch, resolved)) |source_index| {
                    this.graph.entry_points.append(this.graph.allocator, source_index) catch unreachable;
                } else {}
            }
        }
    }

    if (bundler.router) |router| {
        defer this.bundler.resetStore();
        Analytics.Features.filesystem_router = true;

        const entry_points = try router.getEntryPoints();
        try this.graph.entry_points.ensureUnusedCapacity(this.graph.allocator, entry_points.len);
        try this.graph.input_files.ensureUnusedCapacity(this.graph.allocator, entry_points.len);
        try this.graph.path_to_source_index_map.ensureUnusedCapacity(this.graph.allocator, @truncate(u32, entry_points.len));

        for (entry_points) |entry_point| {
            const resolved = bundler.resolveEntryPoint(entry_point) catch continue;
            if (try this.enqueueItem(null, &batch, resolved)) |source_index| {
                this.graph.entry_points.append(this.graph.allocator, source_index) catch unreachable;
            } else {}
        }
    } else {}

    {
        // Setup entry points
        try this.graph.entry_points.ensureUnusedCapacity(this.graph.allocator, bundler.options.entry_points.len);
        try this.graph.input_files.ensureUnusedCapacity(this.graph.allocator, bundler.options.entry_points.len);
        try this.graph.path_to_source_index_map.ensureUnusedCapacity(this.graph.allocator, @truncate(u32, bundler.options.entry_points.len));

        defer this.bundler.resetStore();
        for (bundler.options.entry_points) |entry_point| {
            const resolved = bundler.resolveEntryPoint(entry_point) catch continue;
            if (try this.enqueueItem(null, &batch, resolved)) |source_index| {
                this.graph.entry_points.append(this.graph.allocator, source_index) catch unreachable;
            } else {}
        }
    }

    this.graph.pool.pool.schedule(batch);
    try this.graph.pool.waitForParse(this);

    try this.link(try this.findReachableFiles());

    return null;
}

const ParseTask = struct {
    resolve_result: _resolver.Result,
    source_index: Ref.Int = std.math.maxInt(Ref.Int),
    task: ThreadPoolLib.Task = .{ .callback = callback },

    pub const ResolveQueue = std.AutoArrayHashMap(u64, ParseTask);

    pub const Result = union(Tag) {
        err: Error,
        success: Success,
        empty: Ref.Int,

        pub const Success = struct {
            ast: js_ast.Ast,
            resolve_queue: ResolveQueue,
            source: Logger.Source,
            log: Logger.Log,
        };

        pub const Error = struct {
            err: anyerror,
            step: Step,
            log: Logger.Log,

            pub const Step = enum {
                pending,
                read_file,
                parse,
                resolve,
            };
        };

        pub const Tag = enum {
            success,
            err,
            empty,
        };
    };

    threadlocal var override_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    fn run_(
        task: *ParseTask,
        this: *ThreadPool.Worker,
        step: *ParseTask.Result.Error.Step,
        log: *Logger.Log,
    ) anyerror!?Result.Success {
        var allocator = this.allocator;

        var data = this.data;
        var bundler = &data.bundler;
        errdefer bundler.resetStore();
        var resolver: *Resolver = &bundler.resolver;
        var file_path = task.resolve_result.path_pair.iter().next().?.*;
        step.* = .read_file;

        var entry: CacheEntry = brk: {
            if (bundler.options.framework) |framework| {
                if (framework.override_modules_hashes.len > 0) {
                    const package_relative_path_hash = wyhash(0, file_path.pretty);
                    if (std.mem.indexOfScalar(
                        u64,
                        framework.override_modules_hashes,
                        package_relative_path_hash,
                    )) |index| {
                        const relative_path = [_]string{
                            framework.resolved_dir,
                            framework.override_modules.values[index],
                        };
                        var override_path = bundler.fs.absBuf(
                            &relative_path,
                            &override_file_path_buf,
                        );
                        override_file_path_buf[override_path.len] = 0;
                        var override_pathZ = override_file_path_buf[0..override_path.len :0];
                        break :brk try resolver.caches.fs.readFile(
                            bundler.fs,
                            override_pathZ,
                            0,
                            false,
                            null,
                        );
                    }
                }
            }

            if (strings.eqlComptime(file_path.namespace, "node"))
                break :brk CacheEntry{
                    .contents = NodeFallbackModules.contentsFromPath(file_path.text) orelse "",
                };

            break :brk try resolver.caches.fs.readFile(
                bundler.fs,
                file_path.text,
                task.resolve_result.dirname_fd,
                false,
                if (task.resolve_result.file_fd > 2) task.resolve_result.file_fd else null,
            );
        };

        errdefer entry.deinit(allocator);

        if (entry.fd > 2) task.resolve_result.file_fd = entry.fd;
        step.* = .parse;

        if (entry.contents.len == 0 or (entry.contents.len < 33 and strings.trim(entry.contents, " \n\r").len == 0)) {
            return null;
        }

        var source = Logger.Source.initPathString(file_path.text, entry.contents);
        source.path = file_path;
        source.index = task.source_index;

        const source_dir = file_path.sourceDir();
        const loader = bundler.options.loader(file_path.name.ext);
        const platform = bundler.options.platform;
        var resolve_queue = ResolveQueue.init(allocator);
        errdefer resolve_queue.clearAndFree();

        switch (loader) {
            .jsx, .tsx, .js, .ts => {
                var jsx = task.resolve_result.jsx;
                jsx.parse = loader.isJSX();

                var opts = js_parser.Parser.Options.init(jsx, loader);
                opts.transform_require_to_import = false;
                opts.enable_bundling = true;
                opts.warn_about_unbundled_modules = false;
                opts.macro_context = &this.data.macro_context;
                opts.features.auto_import_jsx = jsx.parse;
                opts.features.trim_unused_imports = bundler.options.trim_unused_imports orelse loader.isTypeScript();
                opts.tree_shaking = bundler.options.tree_shaking;

                var ast = (try resolver.caches.js.parse(
                    bundler.allocator,
                    opts,
                    bundler.options.define,
                    log,
                    &source,
                )) orelse return error.EmptyAST;

                step.* = .resolve;
                var estimated_resolve_queue_count: usize = 0;
                for (ast.import_records) |*import_record| {
                    // Don't resolve the runtime
                    if (import_record.is_internal or import_record.is_unused) {
                        continue;
                    }
                    estimated_resolve_queue_count += 1;
                }

                try resolve_queue.ensureUnusedCapacity(estimated_resolve_queue_count);
                var last_error: ?anyerror = null;
                for (ast.import_records) |*import_record| {
                    // Don't resolve the runtime
                    if (import_record.is_internal or import_record.is_unused) {
                        continue;
                    }

                    if (resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                        // if there were errors, lets go ahead and collect them all
                        if (last_error != null) continue;

                        var path: *Fs.Path = _resolved_import.path() orelse {
                            import_record.path.is_disabled = true;
                            import_record.is_bundled = true;
                            continue;
                        };

                        if (_resolved_import.is_external) {
                            continue;
                        }

                        var resolve_entry = try resolve_queue.getOrPut(wyhash(0, path.text));
                        if (resolve_entry.found_existing) {
                            import_record.path = resolve_entry.value_ptr.resolve_result.path().?.*;
                            import_record.is_bundled = true;
                            continue;
                        }

                        path.* = try path.dupeAlloc(allocator);
                        import_record.path = path.*;
                        import_record.is_bundled = true;

                        resolve_entry.value_ptr.* = .{ .resolve_result = _resolved_import.* };
                    } else |err| {
                        // Disable failing packages from being printed.
                        // This may cause broken code to write.
                        // However, doing this means we tell them all the resolve errors
                        // Rather than just the first one.
                        import_record.path.is_disabled = true;

                        switch (err) {
                            error.ModuleNotFound => {
                                const addError = Logger.Log.addResolveErrorWithTextDupeMaybeWarn;

                                if (!import_record.handles_import_errors) {
                                    last_error = err;
                                    if (isPackagePath(import_record.path.text)) {
                                        if (platform.isWebLike() and options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                            try addError(
                                                log,
                                                &source,
                                                import_record.range,
                                                this.allocator,
                                                "Could not resolve Node.js builtin: \"{s}\".",
                                                .{import_record.path.text},
                                                import_record.kind,
                                                platform.isBun(),
                                            );
                                        } else {
                                            try addError(
                                                log,
                                                &source,
                                                import_record.range,
                                                this.allocator,
                                                "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                                                .{import_record.path.text},
                                                import_record.kind,
                                                platform.isBun(),
                                            );
                                        }
                                    } else if (!platform.isBun()) {
                                        try addError(
                                            log,
                                            &source,
                                            import_record.range,
                                            this.allocator,
                                            "Could not resolve: \"{s}\"",
                                            .{
                                                import_record.path.text,
                                            },
                                            import_record.kind,
                                            platform.isBun(),
                                        );
                                    }
                                }
                            },
                            // assume other errors are already in the log
                            else => {
                                last_error = err;
                            },
                        }
                    }
                }

                if (last_error) |err| {
                    return err;
                }

                // Allow the AST to outlive this call
                _ = js_ast.Expr.Data.Store.toOwnedSlice();
                _ = js_ast.Stmt.Data.Store.toOwnedSlice();

                return Result.Success{
                    .ast = ast,
                    .source = source,
                    .resolve_queue = resolve_queue,
                    .log = log.*,
                };
            },
            else => return null,
        }
    }

    pub fn callback(this: *ThreadPoolLib.Task) void {
        run(@fieldParentPtr(ParseTask, "task", this));
    }

    fn run(this: *ParseTask) void {
        var worker = @ptrCast(
            *ThreadPool.Worker,
            @alignCast(
                @alignOf(*ThreadPool.Worker),
                ThreadPoolLib.Thread.current.?.ctx.?,
            ),
        );
        var step: ParseTask.Result.Error.Step = .pending;
        var log = Logger.Log.init(worker.allocator);
        std.debug.assert(this.source_index != std.math.maxInt(Ref.Int)); // forgot to set source_index

        var result: ParseTask.Result = brk: {
            if (run_(
                this,
                worker,
                &step,
                &log,
            )) |ast_or_null| {
                if (ast_or_null) |ast| {
                    break :brk .{ .success = ast };
                } else {
                    log.deinit();
                    break :brk .{ .empty = this.source_index };
                }
            } else |err| {
                if (err == error.EmptyAST) {
                    log.deinit();
                    break :brk .{ .empty = this.source_index };
                }
                break :brk .{ .err = .{
                    .err = err,
                    .step = step,
                    .log = log,
                } };
            }
        };

        worker.ctx.graph.parse_channel.writeItem(result) catch unreachable;
    }
};

const Visitor = struct {
    reachable: std.ArrayList(Ref.Int),
    visited: std.DynamicBitSet = undefined,
    input_file_asts: []Ref.Int,
    all_import_records: [][]ImportRecord,

    // Find all files reachable from all entry points. This order should be
    // deterministic given that the entry point order is deterministic, since the
    // returned order is the postorder of the graph traversal and import record
    // order within a given file is deterministic.
    pub fn visit(this: *Visitor, source_index: Ref.Int) void {
        if (source_index >= this.input_file_asts.len) return;
        if (this.visited.isSet(source_index)) {
            return;
        }
        this.visited.set(source_index);

        const import_record_list_id = this.input_file_asts[source_index];
        // no import records
        if (import_record_list_id < this.all_import_records.len) {
            for (this.all_import_records[import_record_list_id]) |*import_record| {
                const other_source = import_record.source_index;
                if (other_source != std.math.maxInt(Ref.Int)) {
                    this.visit(other_source);
                }
            }
        }

        // Each file must come after its dependencies
        this.reachable.append(source_index) catch unreachable;
    }
};

pub fn findReachableFiles(this: *BundleV2) ![]Ref.Int {
    var visitor = Visitor{
        .reachable = try std.ArrayList(Ref.Int).initCapacity(this.graph.allocator, this.graph.entry_points.items.len + 1),
        .visited = try std.DynamicBitSet.initEmpty(this.graph.allocator, this.graph.input_files.len),
        .input_file_asts = this.graph.input_files.items(.ast),
        .all_import_records = this.graph.ast.items(.import_records),
    };
    defer visitor.visited.deinit();

    for (this.graph.entry_points.items) |entry_point| {
        visitor.visit(entry_point);
    }

    if (comptime Environment.allow_assert) {
        Output.prettyErrorln("Reachable count: {d} / {d}", .{ visitor.reachable.items.len, this.graph.input_files.len });
    }

    return visitor.reachable.toOwnedSlice();
}

pub fn link(this: *BundleV2, reachable_files: []Ref.Int) !void {
    _ = this;
    _ = reachable_files;
}

bundler: *Bundler,
graph: Graph = Graph{},
tmpfile: std.fs.File = undefined,
tmpfile_byte_offset: u32 = 0,

pub fn appendBytes(generator: *BundleV2, bytes: anytype) !void {
    try generator.tmpfile.writeAll(bytes);
    generator.tmpfile_byte_offset += @truncate(Ref.Int, bytes.len);
}

const IdentityContext = @import("../identity_context.zig").IdentityContext;

pub const Graph = struct {
    entry_points: std.ArrayListUnmanaged(Ref.Int) = .{},
    ast: std.MultiArrayList(JSAst) = .{},
    meta: std.MultiArrayList(JSMeta) = .{},
    input_files: InputFile.List = .{},

    pool: *ThreadPool = undefined,

    heap: ThreadlocalArena = ThreadlocalArena{},
    /// Main thread only!!
    allocator: std.mem.Allocator = undefined,

    parse_channel: ParseChannel = ParseChannel.init(),
    parse_pending: usize = 0,

    /// Stable source index mapping
    source_index_map: std.AutoArrayHashMapUnmanaged(Ref.Int, Ref.Int) = .{},

    /// Stable source index mapping
    path_to_source_index_map: std.HashMapUnmanaged(u64, Ref.Int, IdentityContext(u64), 80) = .{},

    pub const InputFile = struct {
        source: Logger.Source,
        ast: Ref.Int = invalid_part_index,
        meta: Ref.Int = invalid_part_index,
        loader: options.Loader = options.Loader.file,
        side_effects: _resolver.SideEffects = _resolver.SideEffects.has_side_effects,

        pub const List = std.MultiArrayList(InputFile);
    };

    pub const WrapKind = enum {
        none,
        cjs,
        esm,
    };

    pub const ImportData = struct {
        // This is an array of intermediate statements that re-exported this symbol
        // in a chain before getting to the final symbol. This can be done either with
        // "export * from" or "export {} from". If this is done with "export * from"
        // then this may not be the result of a single chain but may instead form
        // a diamond shape if this same symbol was re-exported multiple times from
        // different files.
        re_exports: []Dependency = &[_]Dependency{},

        name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if zero
        ref: Ref = Ref.None,
        source_index: Ref.Int = invalid_part_index,
    };

    pub const ExportData = struct {
        // Export star resolution happens first before import resolution. That means
        // it cannot yet determine if duplicate names from export star resolution are
        // ambiguous (point to different symbols) or not (point to the same symbol).
        // This issue can happen in the following scenario:
        //
        //   // entry.js
        //   export * from './a'
        //   export * from './b'
        //
        //   // a.js
        //   export * from './c'
        //
        //   // b.js
        //   export {x} from './c'
        //
        //   // c.js
        //   export let x = 1, y = 2
        //
        // In this case "entry.js" should have two exports "x" and "y", neither of
        // which are ambiguous. To handle this case, ambiguity resolution must be
        // deferred until import resolution time. That is done using this array.
        potentially_ambiguous_export_star_refs: []ImportData,

        ref: Ref = Ref.None,

        // This is the file that the named export above came from. This will be
        // different from the file that contains this object if this is a re-export.
        name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if zero,
        source_index: Ref.Int = invalid_part_index,
    };

    pub const RefVoidMap = std.ArrayHashMapUnmanaged(Ref, void, Ref.ArrayHashCtx, false);
    pub const RefImportData = std.ArrayHashMapUnmanaged(Ref, ImportData, Ref.ArrayHashCtx, false);
    pub const RefExportData = std.ArrayHashMapUnmanaged(Ref, ExportData, Ref.ArrayHashCtx, false);
    pub const TopLevelSymbolToParts = std.ArrayHashMapUnmanaged(Ref, u32, Ref.ArrayHashCtx, false);
    pub const invalid_part_index = std.math.maxInt(Ref.Int);

    pub const JSMeta = struct {

        /// This is only for TypeScript files. If an import symbol is in this map, it
        /// means the import couldn't be found and doesn't actually exist. This is not
        /// an error in TypeScript because the import is probably just a type.
        ///
        /// Normally we remove all unused imports for TypeScript files during parsing,
        /// which automatically removes type-only imports. But there are certain re-
        /// export situations where it's impossible to tell if an import is a type or
        /// not:
        ///
        ///   import {typeOrNotTypeWhoKnows} from 'path';
        ///   export {typeOrNotTypeWhoKnows};
        ///
        /// Really people should be using the TypeScript "isolatedModules" flag with
        /// bundlers like this one that compile TypeScript files independently without
        /// type checking. That causes the TypeScript type checker to emit the error
        /// "Re-exporting a type when the '--isolatedModules' flag is provided requires
        /// using 'export type'." But we try to be robust to such code anyway.
        is_probably_typescript_type: RefVoidMap = .{},

        /// Imports are matched with exports in a separate pass from when the matched
        /// exports are actually bound to the imports. Here "binding" means adding non-
        /// local dependencies on the parts in the exporting file that declare the
        /// exported symbol to all parts in the importing file that use the imported
        /// symbol.
        ///
        /// This must be a separate pass because of the "probably TypeScript type"
        /// check above. We can't generate the part for the export namespace until
        /// we've matched imports with exports because the generated code must omit
        /// type-only imports in the export namespace code. And we can't bind exports
        /// to imports until the part for the export namespace is generated since that
        /// part needs to participate in the binding.
        ///
        /// This array holds the deferred imports to bind so the pass can be split
        /// into two separate passes.
        imports_to_bind: RefImportData = .{},

        /// This includes both named exports and re-exports.
        ///
        /// Named exports come from explicit export statements in the original file,
        /// and are copied from the "NamedExports" field in the AST.
        ///
        /// Re-exports come from other files and are the result of resolving export
        /// star statements (i.e. "export * from 'foo'").
        resolved_exports: RefExportData = .{},
        resolved_export_star: ?*ExportData = null,

        /// Never iterate over "resolvedExports" directly. Instead, iterate over this
        /// array. Some exports in that map aren't meant to end up in generated code.
        /// This array excludes these exports and is also sorted, which avoids non-
        /// determinism due to random map iteration order.
        sorted_and_filtered_export_aliases: []const string = &[_]string{},

        /// This is merged on top of the corresponding map from the parser in the AST.
        /// You should call "TopLevelSymbolToParts" to access this instead of accessing
        /// it directly.
        top_level_symbol_to_parts_overlay: TopLevelSymbolToParts = .{},

        /// If this is an entry point, this array holds a reference to one free
        /// temporary symbol for each entry in "sortedAndFilteredExportAliases".
        /// These may be needed to store copies of CommonJS re-exports in ESM.
        cjs_export_copies: []const Ref = &[_]Ref{},

        /// The index of the automatically-generated part used to represent the
        /// CommonJS or ESM wrapper. This part is empty and is only useful for tree
        /// shaking and code splitting. The wrapper can't be inserted into the part
        /// because the wrapper contains other parts, which can't be represented by
        /// the current part system. Only wrapped files have one of these.
        wrapper_part_index: Ref.Int = invalid_part_index,

        /// The index of the automatically-generated part used to handle entry point
        /// specific stuff. If a certain part is needed by the entry point, it's added
        /// as a dependency of this part. This is important for parts that are marked
        /// as removable when unused and that are not used by anything else. Only
        /// entry point files have one of these.
        entry_point_part_index: Ref.Int = invalid_part_index,

        /// This is true if this file is affected by top-level await, either by having
        /// a top-level await inside this file or by having an import/export statement
        /// that transitively imports such a file. It is forbidden to call "require()"
        /// on these files since they are evaluated asynchronously.
        is_async_or_has_async_dependency: bool = false,

        wrap: WrapKind = WrapKind.none,

        /// If true, we need to insert "var exports = {};". This is the case for ESM
        /// files when the import namespace is captured via "import * as" and also
        /// when they are the target of a "require()" call.
        needs_exports_variable: bool = false,

        /// If true, the "__export(exports, { ... })" call will be force-included even
        /// if there are no parts that reference "exports". Otherwise this call will
        /// be removed due to the tree shaking pass. This is used when for entry point
        /// files when code related to the current output format needs to reference
        /// the "exports" variable.
        force_include_exports_for_entry_point: bool = false,

        /// This is set when we need to pull in the "__export" symbol in to the part
        /// at "nsExportPartIndex". This can't be done in "createExportsForFile"
        /// because of concurrent map hazards. Instead, it must be done later.
        needs_export_symbol_from_runtime: bool = false,

        /// Wrapped files must also ensure that their dependencies are wrapped. This
        /// flag is used during the traversal that enforces this invariant, and is used
        /// to detect when the fixed point has been reached.
        did_wrap_dependencies: bool = false,
    };
};
