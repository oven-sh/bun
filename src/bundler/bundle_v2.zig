const Bundler = @import("../bundler.zig").Bundler;
const GenerateNodeModulesBundle = @This();
const bun = @import("../global.zig");
const from = bun.from;
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
const BabyList = @import("../baby_list.zig").BabyList;
const panicky = @import("../panic_handler.zig");
const Fs = @import("../fs.zig");
const schema = @import("../api/schema.zig");
const Api = schema.Api;
const _resolver = @import("../resolver/resolver.zig");
const sync = @import("../sync.zig");
const ImportRecord = @import("../import_record.zig").ImportRecord;
const ImportKind = @import("../import_record.zig").ImportKind;
const allocators = @import("../allocators.zig");
const MimeType = @import("../http/mime_type.zig");
const resolve_path = @import("../resolver/resolve_path.zig");
const runtime = @import("../runtime.zig");
const Timer = @import("../system_timer.zig");
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
const Loader = options.Loader;
const Index = @import("../ast/base.zig").Index;
const Batcher = bun.Batcher;

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

    pub fn go(this: *ThreadPool, allocator: std.mem.Allocator, comptime Function: anytype) !ThreadPoolLib.ConcurrentFunction(Function) {
        return this.pool.go(allocator, Function);
    }

    pub fn start(this: *ThreadPool, v2: *BundleV2) !void {
        v2.bundler.env.loadProcess();
        this.v2 = v2;

        this.cpu_count = @truncate(u32, @divFloor((try std.Thread.getCpuCount()) + 1, 2));

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
                            input_files.items(.source)[result.source.index.get()] = result.source;
                            input_files.items(.ast)[result.source.index.get()] = Index.init(graph.ast.len);
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
                                new_input_file.source.index = Index.init(graph.input_files.len - 1);
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

                        var import_records = result.ast.import_records.slice();
                        for (import_records) |*record| {
                            if (record.is_unused or record.isInternal()) {
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

pub fn enqueueItem(this: *BundleV2, hash: ?u64, batch: *ThreadPoolLib.Batch, resolve: _resolver.Result) !?Index.Int {
    var result = resolve;
    var path = result.path() orelse return null;

    const loader = this.bundler.options.loaders.get(path.name.ext) orelse .file;
    if (!loader.isJavaScriptLikeOrJSON()) return null;

    var entry = try this.graph.path_to_source_index_map.getOrPut(this.graph.allocator, hash orelse wyhash(0, path.text));
    if (entry.found_existing) {
        return null;
    }
    this.graph.parse_pending += 1;
    const source_index = Index.init(this.graph.input_files.len);
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
    task.* = ParseTask.init(&result, source_index);
    task.loader = loader;
    batch.push(ThreadPoolLib.Batch.from(&task.task));
    return source_index.get();
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
        .offset = @truncate(u32, offset),
        .length = @truncate(u32, str.len),
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

    // Add the runtime
    try this.graph.input_files.append(allocator, Graph.InputFile{
        .source = ParseTask.runtime_source,
        .loader = .js,
        .side_effects = _resolver.SideEffects.no_side_effects__package_json,
    });
    try this.graph.entry_points.append(allocator, Index.runtime.get());
    batch.push(@intToPtr(*ThreadPoolLib.Task, @ptrToInt(&ParseTask.runtime.task)));

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

    try this.linker.link(this, try this.findReachableFiles());

    return null;
}

const ParseTask = struct {
    path: Fs.Path,
    contents_or_fd: union(enum) {
        fd: struct {
            dir: StoredFileDescriptorType,
            file: StoredFileDescriptorType,
        },
        contents: string,
    },
    side_effects: _resolver.SideEffects,
    loader: ?Loader = null,
    jsx: options.JSX.Pragma,
    source_index: Index = Index.invalid,
    task: ThreadPoolLib.Task = .{ .callback = callback },

    pub const ResolveQueue = std.AutoArrayHashMap(u64, ParseTask);

    pub fn init(resolve_result: *const _resolver.Result, source_index: ?Index) ParseTask {
        return .{
            .path = resolve_result.path_pair.iter().next().?,
            .contents_or_fd = .{
                .fd = .{
                    .dir = resolve_result.dir_fd,
                    .file = resolve_result.file_fd,
                },
            },
            .side_effects = resolve_result.primary_side_effects_data,
            .jsx = resolve_result.jsx,
            .source_index = source_index orelse Index.invalid,
        };
    }

    pub const runtime = ParseTask{
        .path = Fs.Path.initWithNamespace("runtime", "bun:runtime"),
        .side_effects = _resolver.SideEffects.no_side_effects__pure_data,
        .jsx = options.JSX.Pragma{
            .parse = false,
            .supports_react_refresh = false,
        },
        .contents_or_fd = .{
            .contents = @as(string, @embedFile("../runtime.js")),
        },
        .source_index = Index.runtime,
        .loader = Loader.js,
    };
    pub const runtime_source = Logger.Source{
        .path = ParseTask.runtime.path,
        .key_path = ParseTask.runtime.path,
        .contents = ParseTask.runtime.contents_or_fd.contents,
        .index = Index.runtime,
    };

    pub const Result = union(Tag) {
        err: Error,
        success: Success,
        empty: Index,

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
        var file_path = task.path;
        step.* = .read_file;

        var entry: CacheEntry = switch (task.contents_or_fd) {
            .fd => brk: {
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
            },
            .contents => |contents| CacheEntry{
                .contents = contents,
                .fd = 0,
            },
        };

        errdefer if (task.contents_or_fd == .fd) entry.deinit(allocator);

        if (entry.fd > 2) task.resolve_result.file_fd = entry.fd;
        step.* = .parse;

        if (entry.contents.len == 0 or (entry.contents.len < 33 and strings.trim(entry.contents, " \n\r").len == 0)) {
            return null;
        }

        var source = Logger.Source{
            .path = file_path,
            .key_path = file_path,
            .index = task.source_index,
            .contents = entry.contents,
            .contents_is_recycled = false,
        };

        const source_dir = file_path.sourceDir();
        const loader = bundler.options.loader(file_path.name.ext);
        const platform = bundler.options.platform;
        var resolve_queue = ResolveQueue.init(allocator);
        errdefer resolve_queue.clearAndFree();

        switch (loader) {
            .jsx, .tsx, .js, .ts => {
                task.jsx.parse = loader.isJSX();

                var opts = js_parser.Parser.Options.init(task.jsx, loader);
                opts.transform_require_to_import = false;
                opts.enable_bundling = true;
                opts.can_import_from_bundle = false;
                opts.features.allow_runtime = source.index != .runtime;
                opts.warn_about_unbundled_modules = false;
                opts.macro_context = &this.data.macro_context;
                opts.features.auto_import_jsx = task.jsx.parse and bundler.options.auto_import_jsx;
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
                for (ast.import_records.slice()) |*import_record| {
                    // Don't resolve the runtime
                    if (import_record.isInternal() or import_record.is_unused) {
                        continue;
                    }
                    estimated_resolve_queue_count += 1;
                }

                try resolve_queue.ensureUnusedCapacity(estimated_resolve_queue_count);
                var last_error: ?anyerror = null;
                for (ast.import_records.slice()) |*import_record| {
                    // Don't resolve the runtime
                    if (import_record.isInternal() or import_record.is_unused) {
                        continue;
                    }

                    if (resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                        // if there were errors, lets go ahead and collect them all
                        if (last_error != null) continue;

                        var path: *Fs.Path = _resolved_import.path() orelse {
                            import_record.path.is_disabled = true;

                            continue;
                        };

                        if (_resolved_import.is_external) {
                            continue;
                        }

                        var resolve_entry = try resolve_queue.getOrPut(wyhash(0, path.text));
                        if (resolve_entry.found_existing) {
                            import_record.path = resolve_entry.value_ptr.resolve_result.path().?.*;

                            continue;
                        }

                        path.* = try path.dupeAlloc(allocator);
                        import_record.path = path.*;

                        resolve_entry.value_ptr.* = ParseTask.init(_resolved_import, null);
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
        std.debug.assert(this.source_index.isValid()); // forgot to set source_index

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
    reachable: std.ArrayList(Index.Int),
    visited: std.DynamicBitSet = undefined,
    input_file_asts: []Index.Int,
    all_import_records: []ImportRecord.List,

    // Find all files reachable from all entry points. This order should be
    // deterministic given that the entry point order is deterministic, since the
    // returned order is the postorder of the graph traversal and import record
    // order within a given file is deterministic.
    pub fn visit(this: *Visitor, source_index: Index) void {
        if (source_index.isInvalid()) return;
        if (this.visited.isSet(source_index)) {
            return;
        }
        this.visited.set(source_index);

        const import_record_list_id = this.input_file_asts[source_index];
        // when there are no import records, this index will be invalid
        if (import_record_list_id < this.all_import_records.len) {
            for (this.all_import_records[import_record_list_id].slice()) |*import_record| {
                const other_source = import_record.source_index;
                if (other_source.isValid()) {
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

bundler: *Bundler,
graph: Graph = Graph{},
linker: LinkerContext = LinkerContext{},
tmpfile: std.fs.File = undefined,
tmpfile_byte_offset: u32 = 0,

pub fn appendBytes(generator: *BundleV2, bytes: anytype) !void {
    try generator.tmpfile.writeAll(bytes);
    generator.tmpfile_byte_offset += @truncate(u32, bytes.len);
}

const IdentityContext = @import("../identity_context.zig").IdentityContext;

const RefVoidMap = std.ArrayHashMapUnmanaged(Ref, void, Ref.ArrayHashCtx, false);
const RefImportData = std.ArrayHashMapUnmanaged(Ref, ImportData, Ref.ArrayHashCtx, false);
const RefExportData = std.ArrayHashMapUnmanaged(Ref, ExportData, Ref.ArrayHashCtx, false);
const TopLevelSymbolToParts = js_ast.Ast.TopLevelSymbolToParts;

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
    re_exports: Dependency.List = Dependency.List{},

    name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if empty
    ref: Ref = Ref.None,
    source_index: Index.Int = Index.invalid.get(),
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
    potentially_ambiguous_export_star_refs: BabyList(ImportData) = .{},

    ref: Ref = Ref.None,

    // This is the file that the named export above came from. This will be
    // different from the file that contains this object if this is a re-export.
    name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if zero,
    source_index: Index.Int = Index.invalid.get(),
};

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
    resolved_export_star: ExportData = ExportData{},

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
    wrapper_part_index: Index = Index.invalid,

    /// The index of the automatically-generated part used to handle entry point
    /// specific stuff. If a certain part is needed by the entry point, it's added
    /// as a dependency of this part. This is important for parts that are marked
    /// as removable when unused and that are not used by anything else. Only
    /// entry point files have one of these.
    entry_point_part_index: Index = Index.invalid,

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

pub const Graph = struct {
    entry_points: std.ArrayListUnmanaged(Index.Int) = .{},
    ast: std.MultiArrayList(JSAst) = .{},

    input_files: InputFile.List = .{},

    code_splitting: bool = false,

    pool: *ThreadPool = undefined,

    heap: ThreadlocalArena = ThreadlocalArena{},
    /// Main thread only!!
    allocator: std.mem.Allocator = undefined,

    parse_channel: ParseChannel = ParseChannel.init(),
    parse_pending: usize = 0,

    /// Stable source index mapping
    source_index_map: std.AutoArrayHashMapUnmanaged(Index.Int, Ref.Int) = .{},

    /// Stable source index mapping
    path_to_source_index_map: std.HashMapUnmanaged(u64, Index.Int, IdentityContext(u64), 80) = .{},

    pub const InputFile = struct {
        source: Logger.Source,
        ast: Index = Index.invalid,
        meta: Index = Index.invalid,
        loader: options.Loader = options.Loader.file,
        side_effects: _resolver.SideEffects = _resolver.SideEffects.has_side_effects,

        pub const List = std.MultiArrayList(InputFile);
    };
};

const EntryPoint = struct {
    // This may be an absolute path or a relative path. If absolute, it will
    // eventually be turned into a relative path by computing the path relative
    // to the "outbase" directory. Then this relative path will be joined onto
    // the "outdir" directory to form the final output path for this entry point.
    output_path: bun.PathString = bun.PathString.empty,

    // This is the source index of the entry point. This file must have a valid
    // entry point kind (i.e. not "none").
    source_index: Index.Int = 0,

    // Manually specified output paths are ignored when computing the default
    // "outbase" directory, which is computed as the lowest common ancestor of
    // all automatically generated output paths.
    output_path_was_auto_generated: bool = false,

    pub const List = std.MultiArrayList(EntryPoint);

    pub const Kind = enum(u2) {
        none = 0,
        user_specified = 1,
        dynamic_import = 2,

        pub inline fn isEntryPoint(this: Kind) bool {
            return this.kind != .none;
        }

        pub inline fn isUserSpecifiedEntryPoint(this: Kind) bool {
            return this.kind == .user_specified;
        }
    };
};

/// Two-dimensional bitset
/// Quickly lets us know which files are visible for which entry points
const Bitmap = struct {
    bitset: std.DynamicBitSetUnmanaged = undefined,
    file_count: usize = 0,

    pub fn init(file_count: usize, entry_point_count: usize, allocator: std.mem.Allocator) !Bitmap {
        return Bitmap{
            .file_count = file_count,
            .bitset = try std.DynamicBitSetUnmanaged.initEmpty(file_count * entry_point_count, allocator),
        };
    }

    pub fn isSet(this: *Bitmap, file_id: usize, entry_point_count: usize) bool {
        return this.bitset.isSet(file_id * this.file_count + entry_point_count);
    }

    pub fn set(this: *Bitmap, file_id: usize, entry_point_count: usize) void {
        this.bitset.set(file_id * this.file_count + entry_point_count);
    }

    pub fn setter(this: *Bitmap, file_id: usize) Setter {
        return Setter{
            .offset = file_id * this.file_count,
            .bitset = this.bitset,
        };
    }

    // turn add add and a multiply into an add
    pub const Setter = struct {
        offset: usize = 0,
        bitset: std.DynamicBitSetUnmanaged,

        pub fn isSet(this: Bitmap.Setter, x: usize) bool {
            return this.bitset.isSet(this.offset + x);
        }

        pub fn set(this: Bitmap.Setter, x: usize) void {
            this.bitset.set(this.offset + x);
        }
    };
};

const AstSourceIDMapping = struct {
    id: Index.Int,
    source_index: Index.Int,
};

const LinkerGraph = struct {
    files: File.List = .{},
    entry_points: EntryPoint.List = .{},
    symbols: js_ast.Symbol.Map = .{},

    allocator: std.mem.Allocator,

    code_splitting: bool = false,

    // This is an alias from Graph
    // it is not a clone!
    ast: std.MultiArrayList(js_ast.Ast) = .{},
    meta: std.MultiArrayList(JSMeta) = .{},

    reachable_files: []Index.Int = &[_]Index.Int{},

    stable_source_indices: []const u32 = &[_]u32{},

    // This holds all entry points that can reach a file
    // it is a 2 dimensional bitset
    file_entry_bits: Bitmap,

    pub fn addPartToFile(
        graph: *LinkerGraph,
        id: u32,
        part: js_ast.Part,
    ) !u32 {
        var parts: *js_ast.Part.List = &graph.ast.items(.parts)[id];
        const part_id = parts.len;
        try parts.append(graph.allocator, part);
        var top_level_symbols_overlay: ?*TopLevelSymbolToParts = null;
        var sliced = part.declared_symbols.slice();
        var is_top_level = sliced.items(.is_top_level);
        var refs = sliced.items(.ref);
        for (is_top_level) |is_top, i| {
            if (is_top) {
                const ref = refs[i];
                if (top_level_symbols_overlay == null) {
                    top_level_symbols_overlay = &graph.meta.items(.top_level_symbols_overlay)[id];
                }

                var entry = try top_level_symbols_overlay.?.getOrPut(graph.allocator, ref);
                if (!entry.found_existing) {
                    entry.value_ptr.* = try bun.from(
                        BabyList(u32),
                        graph.allocator,
                        &[_]u32{
                            part_id,
                        },
                    );
                } else {
                    try entry.value_ptr.append(graph.allocator, part_id);
                }
            }
        }

        return part_id;
    }
    pub fn generateSymbolImportAndUse(
        g: *LinkerGraph,
        id: u32,
        source_index: Index.Int,
        part_index: u32,
        ref: Ref,
        use_count: u32,
        source_index_to_import_from: Index,
    ) !void {
        if (use_count == 0) return;

        // Mark this symbol as used by this part
        var parts: []js_ast.Part = &g.ast.items(.parts)[id].slice();
        parts[part_index].symbol_uses.getPtr(ref).?.use_count += use_count;
        const exports_ref = g.ast.items(.exports_ref)[id];
        const module_ref = g.ast.items(.module_ref)[id];
        if (ref.eql(exports_ref)) {
            g.ast.items(.uses_exports_ref)[id] = true;
        }

        if (ref.eql(module_ref)) {
            g.ast.items(.uses_module_ref)[id] = true;
        }

        // Track that this specific symbol was imported
        if (source_index_to_import_from != source_index) {
            try g.meta.items(.imports_to_bind)[id].put(g.allocator, ref, .{
                .index = source_index_to_import_from,
                .ref = ref,
            });
        }

        // Pull in all parts that declare this symbol
        var dependencies = &parts[id].dependencies;
        const part_ids = g.topLevelSymbolToParts(id, ref);
        try dependencies.ensureUnusedCapacity(g.allocator, part_ids.len);
        for (part_ids) |part_id| {
            dependencies.appendAssumeCapacity(.{
                .source_index = source_index_to_import_from,
                .part_index = part_id,
            });
        }
    }

    pub fn topLevelSymbolToParts(g: *LinkerGraph, id: u32, ref: Ref) []js_ast.Part {
        var list: BabyList(u32) = g.meta.items(.top_level_symbols_overlay)[id].get(ref) orelse
            g.ast.items(.top_level_symbol_to_parts)[id].get(ref) orelse
            return &.{};

        return list.slice();
    }

    pub fn load(this: *LinkerGraph, entry_points: []const Index.Int, sources: []const Logger.Source) !void {
        this.file_entry_bits = try Bitmap.init(sources.len, entry_points.len, this.allocator());

        try this.files.ensureTotalCapacity(this.allocator(), sources.len);
        this.files.len = sources.len;
        var files = this.files.slice();

        var entry_point_kinds = files.items(.entry_point_kind);
        {
            var kinds = std.mem.sliceAsBytes(entry_point_kinds);
            @memset(kinds.ptr, 0, kinds.len);
        }

        // Setup entry points
        {
            try this.entry_points.ensureTotalCapacity(this.allocator(), entry_points.len);
            this.entry_points.len = entry_points.len;
            var path_strings: []bun.PathString = this.entry_points.items(.output_path);
            {
                var output_was_auto_generated = std.mem.sliceAsBytes(this.entry_points.items(.output_path_was_auto_generated));
                @memset(output_was_auto_generated.ptr, 0, output_was_auto_generated.len);
            }

            for (entry_points) |i, j| {
                if (comptime Environment.allow_assert) {
                    std.debug.assert(sources[i].index == i);
                }
                entry_point_kinds[sources[i].index] = EntryPoint.Kind.user_specified;
                path_strings[j] = bun.PathString.init(sources[i].path.text);
            }
        }

        // Setup files
        {
            var stable_source_indices = try this.allocator.alloc(Index.Int, sources.len);
            for (this.reachable_files) |reachable, i| {
                stable_source_indices[i] = reachable;
            }

            const file = comptime LinkerGraph.File{};
            // TODO: verify this outputs efficient code
            std.mem.set(
                @TypeOf(file.distance_from_entry_point),
                files.items(.distance_from_entry_point),
                comptime file.distance_from_entry_point,
            );
            var is_live = std.mem.sliceAsBytes(files.items(.is_live));
            @memset(is_live.ptr, 0, is_live.len);
        }

        this.symbols = js_ast.Symbol.Map.initList(js_ast.Symbol.NestedList.init(this.parse_graph.ast.items(.symbols)));
    }

    pub const File = struct {
        input_file: u32 = 0,

        /// The minimum number of links in the module graph to get from an entry point
        /// to this file
        distance_from_entry_point: u32 = std.math.maxInt(u32),

        /// If "entryPointKind" is not "entryPointNone", this is the index of the
        /// corresponding entry point chunk.
        entry_point_chunk_index: u32 = 0,

        /// This file is an entry point if and only if this is not "entryPointNone".
        /// Note that dynamically-imported files are allowed to also be specified by
        /// the user as top-level entry points, so some dynamically-imported files
        /// may be "entryPointUserSpecified" instead of "entryPointDynamicImport".
        entry_point_kind: EntryPoint.Kind = .none,

        /// This is true if this file has been marked as live by the tree shaking
        /// algorithm.
        is_live: bool = false,

        pub fn isEntryPoint(this: *const File) bool {
            return this.entry_point_kind.isEntryPoint();
        }

        pub fn isUserSpecifiedEntryPoint(this: *const File) bool {
            return this.entry_point_kind.isUserSpecifiedEntryPoint();
        }

        pub const List = std.MultiArrayList(File);
    };
};

const LinkerContext = struct {
    parse_graph: *Graph = undefined,
    graph: LinkerGraph = undefined,
    allocator: std.mem.Allocator = undefined,
    log: *Logger.Log = undefined,

    resolver: *Resolver = undefined,
    cycle_detector: std.ArrayList(ImportTracker) = undefined,
    swap_cycle_detector: std.ArrayList(ImportTracker) = undefined,

    // We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    cjs_runtime_ref: Ref = Ref.None,
    esm_runtime_ref: Ref = Ref.None,

    // We may need to refer to the CommonJS "module" symbol for exports
    unbound_module_ref: Ref = Ref.None,

    options: LinkerOptions = LinkerOptions{},

    wait_group: ThreadPoolLib.WaitGroup = undefined,

    ambiguous_result_pool: std.ArrayList(MatchImport) = undefined,

    pub const LinkerOptions = struct {
        output_format: options.OutputFormat = .esm,
    };

    fn load(this: *LinkerContext, bundle: *BundleV2, entry_points: []Index.Int, reachable: []Index.Int) !void {
        this.parse_graph = &bundle.graph;
        this.graph = .{
            .allocator = bundle.allocator,
            .bitmap = undefined,
        };

        this.graph.code_splitting = bundle.bundler.options.code_splitting;
        this.graph.allocator = bundle.allocator;
        this.log = bundle.bundler.log;

        this.resolver = &bundle.bundler.resolver;
        this.cycle_detector = std.ArrayList(ImportTracker).init(this.allocator());
        this.swap_cycle_detector = std.ArrayList(ImportTracker).init(this.allocator());

        this.graph.reachable_files = reachable;

        const sources: []const Logger.Source = this.parse_graph.input_files.items(.source);

        try this.graph.load(entry_points, sources);
        this.wait_group = try ThreadPoolLib.WaitGroup.init();
        this.ambiguous_result_pool = std.ArrayList(MatchImport).init(this.allocator());
    }

    pub fn link(this: *LinkerContext, bundle: *BundleV2, entry_points: []Index.Int, reachable: []Index.Int) !void {
        try this.load(bundle, entry_points, reachable);

        try this.scanImportsAndExports();

        // Stop now if there were errors
        if (this.log.hasErrors()) {
            return;
        }
    }

    pub fn scanImportsAndExports(this: *LinkerContext) !void {
        var import_records_list: []ImportRecord.List = this.graph.ast.items(.import_records);
        // var parts_list: [][]js_ast.Part = this.graph.ast.items(.parts);
        var asts = this.parse_graph.input_files.items(.ast);
        var export_kinds: []js_ast.ExportsKind = this.parse_graph.ast.items(.export_kinds);
        var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
        var named_imports: []js_ast.Ast.NamedImports = this.graph.ast.items(.named_imports);
        var wraps: []WrapKind = this.graph.meta.items(.wrap);
        const reachable = this.graph.reachable_files;
        const output_format = this.options.output_format;
        var export_star_import_records: [][]u32 = this.parse_graph.ast.items(.export_star_import_records);
        var exports_refs: []Ref = this.parse_graph.ast.items(.exports_ref);
        var module_refs: []Ref = this.parse_graph.ast.items(.module_ref);
        var symbols = &this.graph.symbols;
        defer this.graph.symbols = symbols;
        var force_include_exports_for_entry_points: []bool = this.graph.meta.items(.force_include_exports_for_entry_point);
        var needs_exports_variable: []bool = this.graph.meta.items(.needs_exports_variable);
        // Step 1: Figure out what modules must be CommonJS
        for (reachable) |source_index| {
            const id = asts[source_index];

            // does it have a JS AST?
            if (!(id < import_records_list.len)) continue;

            var import_records: []ImportRecord = import_records_list[id].slice();
            for (import_records) |record| {
                if (record.source_index.isValid()) {
                    continue;
                }

                const other_file = asts[record.source_index];
                // other file is empty
                if (other_file >= export_kinds.len) continue;
                const other_kind = export_kinds[other_file];
                const other_wrap = wraps[other_file];

                switch (record.kind) {
                    ImportKind.stmt => {
                        // Importing using ES6 syntax from a file without any ES6 syntax
                        // causes that module to be considered CommonJS-style, even if it
                        // doesn't have any CommonJS exports.
                        //
                        // That means the ES6 imports will become undefined instead of
                        // causing errors. This is for compatibility with older CommonJS-
                        // style bundlers.
                        //
                        // We emit a warning in this case but try to avoid turning the module
                        // into a CommonJS module if possible. This is possible with named
                        // imports (the module stays an ECMAScript module but the imports are
                        // rewritten with undefined) but is not possible with star or default
                        // imports:
                        //
                        //   import * as ns from './empty-file'
                        //   import defVal from './empty-file'
                        //   console.log(ns, defVal)
                        //
                        // In that case the module *is* considered a CommonJS module because
                        // the namespace object must be created.
                        if ((record.contains_import_star or record.contains_default_alias) and
                            // TODO: hasLazyExport
                            (other_wrap == .none))
                        {
                            export_kinds[other_file] = .cjs;
                            wraps[other_file] = .cjs;
                        }
                    },
                    ImportKind.require =>
                    // Files that are imported with require() must be CommonJS modules
                    {
                        if (other_kind == .esm) {
                            wraps[other_file] = .esm;
                        } else {
                            wraps[other_file] = .cjs;
                            export_kinds[other_file] = .cjs;
                        }
                    },
                    ImportKind.dynamic => {
                        if (!this.graph.code_splitting) {
                            // If we're not splitting, then import() is just a require() that
                            // returns a promise, so the imported file must be a CommonJS module
                            if (export_kinds[other_file] == .esm) {
                                wraps[other_file] = .esm;
                            } else {
                                wraps[other_file] = .cjs;
                                export_kinds[other_file] = .cjs;
                            }
                        }
                    },
                    else => {},
                }
            }

            const kind = export_kinds[id];

            // If the output format doesn't have an implicit CommonJS wrapper, any file
            // that uses CommonJS features will need to be wrapped, even though the
            // resulting wrapper won't be invoked by other files. An exception is made
            // for entry point files in CommonJS format (or when in pass-through mode).
            if (kind == .cjs and (!entry_point_kinds[id].isEntryPoint() or output_format == .iife or output_format == .esm)) {
                wraps[id] = .cjs;
            }
        }

        // Step 2: Propagate dynamic export status for export star statements that
        // are re-exports from a module whose exports are not statically analyzable.
        // In this case the export star must be evaluated at run time instead of at
        // bundle time.
        {
            var dependency_wrapper = DependencyWrapper{
                .linker = this,
                .did_wrap_dependencies = this.graph.meta.items(.did_wrap_dependencies),
                .wraps = wraps,
                .import_records = import_records_list,
                .export_kinds = export_kinds,
                .export_star_map = std.AutoHashMap(u32, void).init(this.allocator()),
                .export_star_records = export_star_import_records,
            };
            defer dependency_wrapper.export_star_map.deinit();

            for (reachable) |source_index| {
                const id = asts[source_index];

                // does it have a JS AST?
                if (!(id < import_records_list.len)) continue;

                if (wraps[id] != .none) {
                    dependency_wrapper.wrap(id);
                }

                if (export_star_import_records[id].len > 0) {
                    dependency_wrapper.export_star_map.clearRetainingCapacity();
                    _ = dependency_wrapper.hasDynamicExportsDueToExportStar(id);
                }

                // Even if the output file is CommonJS-like, we may still need to wrap
                // CommonJS-style files. Any file that imports a CommonJS-style file will
                // cause that file to need to be wrapped. This is because the import
                // method, whatever it is, will need to invoke the wrapper. Note that
                // this can include entry points (e.g. an entry point that imports a file
                // that imports that entry point).
                for (import_records_list[id].slice()) |record| {
                    if (record.source_index < import_records_list.len) {
                        if (export_kinds[record.source_index] == .cjs) {
                            dependency_wrapper.wrap(record.source_index);
                        }
                    }
                }
            }
        }

        // Step 3: Resolve "export * from" statements. This must be done after we
        // discover all modules that can have dynamic exports because export stars
        // are ignored for those modules.
        {
            var export_star_ctx: ?ExportStarContext = null;
            var resolved_exports: []RefExportData = this.graph.meta.items(.resolved_exports);
            var resolved_export_stars: []ExportData = this.graph.meta.items(.resolved_export_star);

            for (reachable) |source_index| {
                if (asts.len < @as(usize, source_index)) continue;
                const id = asts[source_index];

                // --
                // TODO: generateCodeForLazyExport here!
                // --

                // Propagate exports for export star statements
                var export_star_ids = export_star_import_records[id];
                if (export_star_ids.len > 0) {
                    if (export_star_ctx == null) {
                        export_star_ctx = ExportStarContext{
                            .resolved_exports = resolved_exports,
                            .import_records_list = import_records_list,
                            .export_star_records = export_star_import_records,
                            .source_index_stack = std.ArrayList(u32).initCapacity(this.allocator, 32) catch unreachable,
                            .export_kinds = export_kinds,
                            .named_exports = this.parse_graph.ast.items(.named_exports),
                        };
                    } else {
                        export_star_ctx.?.source_index_stack.clearRetainingCapacity();
                    }
                    export_star_ctx.?.addExports(&resolved_exports[id], source_index);
                }

                // Also add a special export so import stars can bind to it. This must be
                // done in this step because it must come after CommonJS module discovery
                // but before matching imports with exports.
                resolved_export_stars[id] = ExportData{
                    .source_index = source_index,
                    .ref = exports_refs[id],
                };
            }
        }

        // Step 4: Match imports with exports. This must be done after we process all
        // export stars because imports can bind to export star re-exports.
        {
            this.cycle_detector.clearRetainingCapacity();
            var wrapper_part_indices = this.graph.meta.items(.wrapper_part_index);
            for (reachable) |source_index| {
                if (asts.len < @as(usize, source_index)) continue;
                const id = asts[source_index];
                // not a JS ast or empty
                if (id > named_imports.len) {
                    continue;
                }

                var named_imports_ = &named_imports[id];
                if (named_imports_.count() > 0) {
                    this.matchImportsWithExportsForFile(named_imports_);
                }
                const export_kind = export_kinds[id];

                // If we're exporting as CommonJS and this file was originally CommonJS,
                // then we'll be using the actual CommonJS "exports" and/or "module"
                // symbols. In that case make sure to mark them as such so they don't
                // get minified.
                if ((output_format == .cjs or output_format == .preseve) and
                    entry_point_kinds[source_index].isEntryPoint() and
                    export_kind == .cjs and wraps[id] == .none)
                {
                    const exports_ref = symbols.follow(exports_refs[id]);
                    const module_ref = symbols.follow(module_refs[id]);
                    symbols.get(exports_ref).?.kind = .unbound;
                    symbols.get(module_ref).?.kind = .unbound;
                } else if (force_include_exports_for_entry_points[id] or export_kind != .cjs) {
                    needs_exports_variable[id] = true;
                }

                // Create the wrapper part for wrapped files. This is needed by a later step.
                this.createWrapperForFile(
                    source_index,
                    wraps[id],
                    &wrapper_part_indices[id],
                    source_index,
                    id,
                );
            }
        }

        // Step 5: Create namespace exports for every file. This is always necessary
        // for CommonJS files, and is also necessary for other files if they are
        // imported using an import star statement.
        {
            try this.parse_graph.pool.pool.do(this.allocator(), &this.wait_group, this, doStep5, this.graph.reachable_files);
        }
    }

    pub fn createExportsForFile(c: *LinkerContext, allocator_: std.mem.Allocator, source_index: Index.Int, id: u32, ids: []u32, resolved_exports: *RefExportData, imports_to_bind: []*RefImportData, export_aliases: []const string, re_exports_count: usize) void {
        ////////////////////////////////////////////////////////////////////////////////
        // WARNING: This method is run in parallel over all files. Do not mutate data
        // for other files within this method or you will create a data race.
        ////////////////////////////////////////////////////////////////////////////////

        // 1 property per export
        var properties = std.ArrayList(js_ast.G.Property)
            .initCapacity(allocator_, export_aliases.len) catch unreachable;

        var ns_export_symbol_uses = js_ast.Part.SymbolUseMap{};
        ns_export_symbol_uses.ensureTotalCapacity(allocator_, export_aliases.len) catch unreachable;

        const needs_exports_variable = c.graph.meta.items(.needs_exports_variable)[id];

        const stmts_count =
            // 3 statements for every export
            export_aliases.len * 3 +
            // + 1 if there are non-zero exports
            @as(usize, @boolToInt(export_aliases.len > 0)) +
            // + 1 if we need to inject the exports variable
            @as(usize, @boolToInt(needs_exports_variable));

        var stmts = js_ast.Stmt.Batcher.init(allocator_, stmts_count) catch unreachable;
        defer stmts.done();
        const loc = Logger.Loc.Empty;
        // todo: investigate if preallocating this array is faster
        var ns_export_dependencies = std.ArrayList(js_ast.Dependency).init(allocator_);

        for (export_aliases) |alias| {
            var export_ = resolved_exports.getPtr(alias).?;

            const other_id = ids[export_.source_index];

            // If this is an export of an import, reference the symbol that the import
            // was eventually resolved to. We need to do this because imports have
            // already been resolved by this point, so we can't generate a new import
            // and have that be resolved later.
            if (imports_to_bind[other_id].get(export_.ref)) |import_data| {
                export_.ref = import_data.ref;
                export_.source_index = import_data.source_index;
                ns_export_dependencies.appendSlice(import_data.re_exports.slice()) catch unreachable;
            }

            // Exports of imports need EImportIdentifier in case they need to be re-
            // written to a property access later on
            // note: this is stack allocated
            var value: js_ast.Expr = undefined;
            if (c.graph.symbols.getConst(export_.ref).?.namespace_alias != null) {
                value = js_ast.Expr.init(
                    js_ast.E.ImportIdentifier,
                    js_ast.E.ImportIdentifier{
                        .ref = export_.ref,
                    },
                    loc,
                );
            } else {
                value = js_ast.Expr.init(
                    js_ast.E.Identifier,
                    js_ast.E.Identifier{
                        .ref = export_.ref,
                    },
                    loc,
                );
            }

            var block = stmts.eat1(
                js_ast.Stmt.alloc(js_ast.S.Block, .{
                    .stmts = stmts.eat1(
                        js_ast.Stmt.alloc(
                            js_ast.S.Return,
                            .{ .value = value },
                            loc,
                        ),
                    ),
                }, loc),
            );
            const fn_body = js_ast.G.FnBody{
                .stmts = block,
                .loc = loc,
            };
            properties.appendAssumeCapacity(
                .{
                    .key = js_ast.Expr.init(
                        js_ast.E.String,
                        .{
                            // TODO: test emoji work as expected
                            // relevant for WASM exports
                            .utf8 = alias,
                        },
                        loc,
                    ),
                    .value = js_ast.Expr.init(js_ast.E.Arrow, .{ .prefer_expr = true, .body = fn_body }, loc),
                },
            );
            ns_export_symbol_uses.putAssumeCapacity(export_.ref, .{ .count_estimate = 1 });

            // Make sure the part that declares the export is included
            const parts = c.topLevelSymbolsToParts(other_id, export_.ref);
            ns_export_dependencies.ensureUnusedCapacity(parts.len) catch unreachable;
            var ptr = ns_export_dependencies.items.ptr + ns_export_dependencies.items.len;
            ns_export_dependencies.items.len += parts.len;

            for (parts) |part_id| {
                // Use a non-local dependency since this is likely from a different
                // file if it came in through an export star
                ptr[0] = .{
                    .source_index = export_.source_index,
                    .part_index = part_id,
                };
                ptr += 1;
            }
        }

        var declared_symbols = js_ast.DeclaredSymbol.List{};
        var exports_ref = c.graph.ast.items(.exports_ref)[id];
        var export_stmts: []js_ast.Stmt = stmts.head;
        std.debug.assert(stmts.head.len <= 2);
        stmts.head.len = 0;

        // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
        if (needs_exports_variable) {
            var decls = allocator_.alloc(1, js_ast.G.Decl) catch unreachable;
            decls[0] = .{
                .binding = js_ast.Binding.alloc(
                    allocator_,
                    js_ast.B.Identifier{
                        .ref = exports_ref,
                    },
                    loc,
                ),
                .value = js_ast.Expr.init(js_ast.E.Object, .{}, loc),
            };
            export_stmts[0] = js_ast.Stmt.alloc(
                js_ast.S.Local,
                .{
                    .decls = decls,
                },
                export_stmts[0].loc,
            );
            declared_symbols.append(allocator_, .{ .ref = exports_ref, .is_top_level = true }) catch unreachable;
        }

        // "__export(exports, { foo: () => foo })"
        var export_ref = Ref.None;
        if (properties.items.len > 0) {
            export_ref = c.graph.ast.items(.module_scope)[Index.runtime.get()].members.get("__export").?.ref;
            var args = allocator_.alloc(js_ast.Expr, 2) catch unreachable;
            args[0..2].* = [_]js_ast.Expr{
                js_ast.Expr.initIdentifier(exports_ref, loc),
                js_ast.Expr.init(js_ast.E.Object, .{ .properties = js_ast.G.Property.List.fromList(properties) }, loc),
            };
            // the end incase we somehow get into a state where needs_export_variable is false but properties.len > 0
            export_stmts[export_stmts.len - 1] = js_ast.Stmt.alloc(
                js_ast.S.SExpr,
                .{
                    .value = js_ast.Expr.init(
                        js_ast.E.Call,
                        .{
                            .target = js_ast.Expr.initIdentifier(export_ref, loc),
                            .args = args,
                        },
                        loc,
                    ),
                },
                loc,
            );

            // Make sure this file depends on the "__export" symbol
            const parts = c.topLevelSymbolsToPartsForRuntime(export_ref);
            ns_export_dependencies.ensureUnusedCapacity(parts.len) catch unreachable;
            for (parts) |part_index| {
                ns_export_dependencies.appendAssumeCapacity(
                    .{ .source_index = Index.runtime.get(), .part_index = part_index },
                );
            }

            // Make sure the CommonJS closure, if there is one, includes "exports"
            c.graph.ast.items(.uses_exports_ref)[id] = true;
        }

        // No need to generate a part if it'll be empty
        if (export_stmts.len > 0) {
            var parts: js_ast.Part.List = c.graph.ast.items(.parts)[id];
            // - we must already have preallocated the parts array
            // - if the parts list is completely empty, we shouldn't have gotten here in the first place
            std.debug.assert(parts.len > 1);

            // Initialize the part that was allocated for us earlier. The information
            // here will be used after this during tree shaking.
            parts.ptr[js_ast.namespace_export_part_index] = .{
                .stmts = export_stmts,
                .symbol_uses = ns_export_symbol_uses,
                .dependencies = js_ast.Dependency.List.fromList(ns_export_dependencies),
                .declared_symbols = declared_symbols,

                // This can be removed if nothing uses it
                .can_be_removed_if_unused = true,

                // Make sure this is trimmed if unused even if tree shaking is disabled
                .force_tree_shaking = true,
            };

            // Pull in the "__export" symbol if it was used
            if (export_ref.isValid()) {
                c.graph.meta.items(.needs_export_symbol_from_runtime)[id] = true;
            }
        }
    }

    pub fn doStep5(c: *LinkerContext, source_index: Index.Int, _: usize) void {
        const ids = c.parse_graph.input_files.items(.ast);
        const id = ids[source_index];
        if (@as(usize, id) > c.graph.meta.len) return;

        var worker: *ThreadPool.Worker = @ptrCast(
            *ThreadPool.Worker,
            @alignCast(
                @alignOf(*ThreadPool.Worker),
                ThreadPoolLib.Thread.current.?.ctx.?,
            ),
        );
        // we must use this allocator here
        const allocator_ = worker.allocator;

        var resolved_exports: *RefExportData = &c.graph.meta.items(.resolved_exports)[id];

        // Now that all exports have been resolved, sort and filter them to create
        // something we can iterate over later.
        var aliases = std.ArrayList(string).initCapacity(allocator_, resolved_exports.count()) catch unreachable;
        var alias_iter = resolved_exports.iterator();
        var imports_to_bind = c.graph.meta.items(.imports_to_bind);
        var is_probably_typescript_type = c.graph.meta.items(.is_probably_typescript_type);

        // counting in here saves us an extra pass through the array
        var re_exports_count: usize = 0;

        next_alias: while (alias_iter.next()) |entry| {
            var export_ = entry.value_ptr.*;
            var alias = entry.key_ptr.*;
            const this_id = ids[export_.source_index];
            var inner_count: usize = 0;
            // Re-exporting multiple symbols with the same name causes an ambiguous
            // export. These names cannot be used and should not end up in generated code.
            if (export_.potentially_ambiguous_export_star_refs.len > 0) {
                const main_ref = imports_to_bind[this_id].get(export_.ref) orelse export_.ref;
                for (export_.potentially_ambiguous_export_star_refs.slice()) |ambig| {
                    const _id = ids[ambig.source_index];
                    const ambig_ref = imports_to_bind[_id].get(ambig.ref) orelse ambig.ref;
                    if (!main_ref.eql(ambig_ref)) {
                        continue :next_alias;
                    }
                    inner_count += @as(usize, ambig.re_exports.len);
                }
            }

            // Ignore re-exported imports in TypeScript files that failed to be
            // resolved. These are probably just type-only imports so the best thing to
            // do is to silently omit them from the export list.
            if (is_probably_typescript_type[this_id].contains(export_.ref)) {
                continue;
            }
            re_exports_count += inner_count;

            aliases.appendAssumeCapacity(alias);
        }
        // TODO: can this be u32 instead of a string?
        // if yes, we could just move all the hidden exports to the end of the array
        // and only store a count instead of an array
        strings.sortDesc(aliases);
        const export_aliases = aliases.toOwnedSlice();
        c.graph.meta.items(.sorted_and_filtered_export_aliases)[id] = export_aliases;

        // Export creation uses "sortedAndFilteredExportAliases" so this must
        // come second after we fill in that array
        c.createExportsForFile(
            allocator_,
            source_index,
            id,
            ids,
            resolved_exports,
            imports_to_bind,
            export_aliases,
            re_exports_count,
        );

        // Each part tracks the other parts it depends on within this file
        var local_dependencies = std.AutoHashMap(u32, u32).init(allocator);
        defer local_dependencies.deinit();
        var parts = &c.graph.ast.items(.parts)[id];
        var parts_slice: []js_ast.Part = parts.slice();
        var named_imports: *js_ast.Ast.NamedImports = &c.graph.meta.items(.named_imports)[id];
        for (parts_slice) |*part, part_index| {

            // TODO: inline const TypeScript enum here

            // TODO: inline function calls here

            // note: if we crash on append, it is due to threadlocal heaps in mimalloc
            const symbol_uses = part.symbol_uses.keys();
            for (symbol_uses) |ref, j| {
                if (comptime Environment.allow_assert) {
                    std.debug.assert(part.symbol_uses.values()[j].count_estimate > 0);
                }

                // TODO: inline const values from an import

                const other_parts = c.topLevelSymbolsToParts(id, ref);

                for (other_parts) |other_part_index| {
                    var local = local_dependencies.getOrPutValue(@intCast(u32, other_part_index), @intCast(u32, part_index)) catch unreachable;
                    if (local.value_ptr.* != @intCast(u32, part_index)) {
                        local.value_ptr.* = @intCast(u32, part_index);
                        // note: if we crash on append, it is due to threadlocal heaps in mimalloc
                        part.dependencies.append(
                            allocator_,
                            .{
                                .source_index = Index.init(source_index),
                                .part_index = other_part_index,
                            },
                        ) catch unreachable;
                    }
                }

                // Also map from imports to parts that use them
                if (named_imports.getPtr(ref)) |existing| {
                    existing.local_parts_with_uses.append(allocator_, @intCast(u32, part_index)) catch unreachable;
                }
            }
        }
    }

    const MatchImport = struct {
        alias: string = "",
        kind: MatchImport.Kind = MatchImport.Kind.ignore,
        namespace_ref: Ref = Ref.None,
        source_index: u32 = 0,
        name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if zero,
        other_source_index: u32 = 0,
        other_name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with otherSourceIndex, ignore if zero,
        ref: Ref = Ref.None,

        pub const Kind = enum {
            /// The import is either external or undefined
            ignore,

            /// "sourceIndex" and "ref" are in use
            normal,

            /// "namespaceRef" and "alias" are in use
            namespace,

            /// Both "normal" and "namespace"
            normal_and_namespace,

            /// The import could not be evaluated due to a cycle
            cycle,

            /// The import is missing but came from a TypeScript file
            probably_type_script_type,

            /// The import resolved to multiple symbols via "export * from"
            ambiguous,
        };
    };
    pub fn source_(c: *LinkerContext, index: anytype) *const Logger.Source {
        return &c.parse_graph.input_files.items(.source)[index];
    }
    pub fn matchImportWithExport(
        c: *LinkerContext,
        tracker_: ImportTracker,
        re_exports: *std.ArrayList(js_ast.Dependency),
    ) MatchImport {
        var tracker = tracker_;

        var ambiguous_results = std.ArrayList(MatchImport).init(c.allocator());
        defer ambiguous_results.clearAndFree();
        var result: MatchImport = MatchImport{};
        const ids = c.parse_graph.input_files.items(.ast);
        const named_imports = c.graph.ast.items(.named_imports);
        var top_level_symbols_to_parts: []js_ast.Ast.TopLevelSymbolToParts = c.graph.ast.items(.top_level_symbols_to_parts);

        loop: while (true) {
            // Make sure we avoid infinite loops trying to resolve cycles:
            //
            //   // foo.js
            //   export {a as b} from './foo.js'
            //   export {b as c} from './foo.js'
            //   export {c as a} from './foo.js'
            //
            // This uses a O(n^2) array scan instead of a O(n) map because the vast
            // majority of cases have one or two elements and Go arrays are cheap to
            // reuse without allocating.
            for (c.cycle_detector.items) |prev_tracker| {
                if (std.meta.eql(tracker, prev_tracker)) {
                    result = .{ .kind = .cycle };
                    break :loop;
                }
            }
            c.cycle_detector.append(tracker) catch unreachable;

            // Resolve the import by one step
            const advanced = c.advanceImportTracker(tracker);
            const next_tracker = advanced.value;
            const status = advanced.status;
            const potentially_ambiguous_export_star_refs = advanced.import_data;
            const other_id = ids[tracker.source_index];

            switch (status) {
                .common_js, .common_js_without_exports, .disabled, .external => {
                    if (status == .external and c.options.output_format.keepES6ImportExportSyntax()) {
                        // Imports from external modules should not be converted to CommonJS
                        // if the output format preserves the original ES6 import statements
                        break;
                    }

                    // If it's a CommonJS or external file, rewrite the import to a
                    // property access. Don't do this if the namespace reference is invalid
                    // though. This is the case for star imports, where the import is the
                    // namespace.
                    const named_import: js_ast.NamedImport = named_imports[other_id].get(tracker.import_ref).?;
                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        if (result.kind == .normal) {
                            result.kind = .normal_and_namespace;
                            result.namespace_ref = named_import.namespace_ref.?;
                            result.alias = named_import.alias.?;
                        } else {
                            result = .{
                                .kind = .namespace,
                                .namespace_ref = named_import.namespace_ref.?,
                                .alias = named_import.alias.?,
                            };
                        }
                    }

                    // Warn about importing from a file that is known to not have any exports
                    if (status == .common_js_without_exports) {
                        const source = c.source_(tracker.source_index.get());
                        c.log.addRangeWarningFmt(
                            source,
                            source.rangeOfIdentifier(named_import.alias_loc.?),
                            c.allocator(),
                            "Import \"{s}\" will always be undefined because the file \"{s}\" has no exports",
                            .{
                                named_import.alias.?,
                                source.path.pretty,
                            },
                        ) catch unreachable;
                    }
                },

                .dynamic_fallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    const named_import: js_ast.NamedImport = named_imports[other_id].get(tracker.import_ref).?;
                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        if (result.kind == .normal) {
                            result.kind = .normal_and_namespace;
                            result.namespace_ref = named_import.namespace_ref.?;
                            result.alias = named_import.alias.?;
                        } else {
                            result = .{
                                .kind = .namespace,
                                .namespace_ref = named_import.namespace_ref.?,
                                .alias = named_import.alias.?,
                            };
                        }
                    }
                },
                .no_match => {
                    // Report mismatched imports and exports
                    const symbol = c.graph.symbols.get(tracker.import_ref).?;
                    const named_import: js_ast.NamedImport = named_imports[other_id].get(tracker.import_ref).?;

                    const source = c.source_(tracker.source_index.get());
                    const next_source = c.source_(next_tracker.source_index.get());
                    const r = source.rangeOfIdentifier(named_import.alias_loc.?);

                    // Report mismatched imports and exports
                    if (symbol.import_item_status == .generated) {
                        // This is a debug message instead of an error because although it
                        // appears to be a named import, it's actually an automatically-
                        // generated named import that was originally a property access on an
                        // import star namespace object. Normally this property access would
                        // just resolve to undefined at run-time instead of failing at binding-
                        // time, so we emit a debug message and rewrite the value to the literal
                        // "undefined" instead of emitting an error.
                        symbol.import_item_status = .missing;
                        c.log.addRangeWarningFmt(
                            source,
                            r,
                            c.allocator(),
                            "Import \"{s}\" will always be undefined because there is no matching export in \"{s}\"",
                            .{
                                named_import.alias.?,
                                next_source.path.pretty,
                            },
                        ) catch unreachable;
                    } else {
                        c.log.addRangeErrorFmt(
                            source,
                            r,
                            c.allocator(),
                            "No matching export in \"{s}\" for import \"{s}\"",
                            .{
                                next_source.path.pretty,
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    }
                },
                .probably_type_script_type => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = .{ .kind = .probably_type_script_type };
                },
                .found => {
                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for (potentially_ambiguous_export_star_refs) |ambiguous_tracker| {
                        // If this is a re-export of another import, follow the import
                        if (named_imports[ids[ambiguous_tracker.source_index]].contains(ambiguous_tracker.ref)) {

                            // TODO: not fully confident this will work
                            // test with nested ambiguous re-exports
                            var old_cycle_detector = c.cycle_detector;
                            c.cycle_detector = c.swap_cycle_detector;
                            c.cycle_detector.clearRetainingCapacity();
                            var ambig = c.matchImportWithExport(ambiguous_tracker, re_exports);
                            c.cycle_detector.clearRetainingCapacity();
                            c.swap_cycle_detector = c.cycle_detector;
                            c.cycle_detector = old_cycle_detector;
                            ambiguous_results.append(ambig) catch unreachable;
                        } else {
                            ambiguous_results.append(.{
                                .kind = .normal,
                                .source_index = ambiguous_tracker.source_index,
                                .ref = ambiguous_tracker.ref,
                                .name_loc = ambiguous_tracker.name_loc,
                            }) catch unreachable;
                        }
                    }

                    // Defer the actual binding of this import until after we generate
                    // namespace export code for all files. This has to be done for all
                    // import-to-export matches, not just the initial import to the final
                    // export, since all imports and re-exports must be merged together
                    // for correctness.
                    result = .{
                        .kind = .normal,
                        .source_index = next_tracker.source_index,
                        .ref = next_tracker.import_ref,
                        .name_loc = next_tracker.name_loc,
                    };

                    // Depend on the statement(s) that declared this import symbol in the
                    // original file
                    {
                        var deps = top_level_symbols_to_parts[other_id].get(tracker.import_ref).?.slice();
                        re_exports.ensureUnusedCapacity(deps.len) catch unreachable;
                        for (deps) |dep| {
                            re_exports.appendAssumeCapacity(
                                .{
                                    .part_index = dep.part_index,
                                    .source_index = tracker.source_index.get(),
                                },
                            );
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    const next_id = ids[next_tracker.source_index];
                    if (named_imports[next_id].contains(next_tracker.import_ref)) {
                        tracker = next_tracker;
                        continue :loop;
                    }
                },
            }

            break :loop;
        }

        // If there is a potential ambiguity, all results must be the same
        for (ambiguous_results.items) |ambig| {
            if (!std.meta.eql(ambig, result)) {
                if (result.kind == ambig.kind and
                    ambig.kind == .normal and
                    ambig.name_loc.start != 0 and
                    result.name_loc.start != 0)
                {
                    return .{
                        .kind = .ambiguous,
                        .source_index = result.source_index,
                        .name_loc = result.name_loc,
                        .other_source_index = ambig.source_index,
                        .other_name_loc = ambig.name_loc,
                    };
                }

                return .{ .kind = .ambiguous };
            }
        }

        return result;
    }

    pub fn topLevelSymbolsToParts(c: *LinkerContext, id: u32, ref: Ref) []u32 {
        return c.graph.ast.items(.top_level_symbols_to_parts)[id].get(ref) orelse &.{};
    }

    pub fn topLevelSymbolsToPartsForRuntime(c: *LinkerContext, ref: Ref) []u32 {
        return topLevelSymbolsToParts(c, Index.runtime.get(), ref);
    }

    pub fn createWrapperForFile(
        c: *LinkerContext,
        wrap: WrapKind,
        wrapper_ref: Ref,
        wrapper_part_index: *Index,
        source_index: Index.Int,
        id: u32,
    ) void {
        switch (wrap) {
            // If this is a CommonJS file, we're going to need to generate a wrapper
            // for the CommonJS closure. That will end up looking something like this:
            //
            //   var require_foo = __commonJS((exports, module) => {
            //     ...
            //   });
            //
            // However, that generation is special-cased for various reasons and is
            // done later on. Still, we're going to need to ensure that this file
            // both depends on the "__commonJS" symbol and declares the "require_foo"
            // symbol. Instead of special-casing this during the reachablity analysis
            // below, we just append a dummy part to the end of the file with these
            // dependencies and let the general-purpose reachablity analysis take care
            // of it.
            .cjs => {
                const common_js_parts = c.topLevelSymbolsToPartsForRuntime(c.cjs_runtime_ref);

                // generate a dummy part that depends on the "__commonJS" symbol
                var dependencies = c.allocator().alloc(js_ast.Dependency, common_js_parts.len);
                for (common_js_parts) |part, i| {
                    dependencies[i] = .{
                        .part_index = part,
                        .source_index = Index.runtime.get(),
                    };
                }
                const part_index = c.graph.addPartToFile(
                    source_index,
                    id,
                    .{
                        .symbol_uses = bun.from(
                            js_ast.Part.SymbolUseMap,
                            c.allocator(),
                            .{
                                .{ wrapper_ref, .{ .count_estimate = 1 } },
                            },
                        ) catch unreachable,
                        .declared_symbols = bun.from(
                            js_ast.DeclaredSymbol.List,
                            c.allocator(),
                            &[_]js_ast.DeclaredSymbol{
                                .{ .ref = c.graph.ast.items(.exports_ref)[id], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.module_ref)[id], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.wrapper_ref)[id], .is_top_level = true },
                            },
                        ) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                );
                wrapper_part_index.* = Index.init(part_index);
                c.graph.generateSymbolImportAndUse(
                    id,
                    source_index,
                    part_index,
                    c.cjs_runtime_ref,
                    1,
                    Index.runtime,
                ) catch unreachable;
            },

            .esm => {
                // If this is a lazily-initialized ESM file, we're going to need to
                // generate a wrapper for the ESM closure. That will end up looking
                // something like this:
                //
                //   var init_foo = __esm(() => {
                //     ...
                //   });
                //
                // This depends on the "__esm" symbol and declares the "init_foo" symbol
                // for similar reasons to the CommonJS closure above.
                const esm_parts = c.topLevelSymbolsToPartsForRuntime(c.esm_runtime_ref);

                // generate a dummy part that depends on the "__esm" symbol
                var dependencies = c.allocator().alloc(js_ast.Dependency, esm_parts.len) catch unreachable;
                for (esm_parts) |part, i| {
                    dependencies[i] = .{
                        .part_index = part,
                        .source_index = Index.runtime.get(),
                    };
                }

                const part_index = c.graph.addPartToFile(
                    source_index,
                    id,
                    .{
                        .symbol_uses = bun.from(
                            js_ast.Part.SymbolUseMap,
                            c.allocator(),
                            .{
                                .{ wrapper_ref, .{ .count_estimate = 1 } },
                            },
                        ) catch unreachable,
                        .declared_symbols = bun.from(
                            js_ast.DeclaredSymbol.List,
                            c.allocator(),
                            &[_]js_ast.DeclaredSymbol{
                                .{ .ref = wrapper_ref, .is_top_level = true },
                            },
                        ) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                );
                wrapper_part_index.* = Index.init(part_index);
                c.graph.generateSymbolImportAndUse(
                    id,
                    source_index,
                    part_index,
                    c.esm_runtime_ref,
                    1,
                    Index.runtime,
                ) catch unreachable;
            },
            else => {},
        }
    }

    pub fn advanceImportTracker(c: *LinkerContext, tracker: ImportTracker) ImportTracker.Iterator {
        const ids = c.parse_graph.input_files.items(.ast);
        const id = ids[tracker.source_index.get()];
        var named_imports: JSAst.NamedImports = c.graph.ast.items(.named_imports)[id];
        var import_records: []ImportRecord = c.graph.ast.items(.import_records)[id];
        const export_kinds: []js_ast.ExportsKind = c.graph.ast.items(.export_kinds);
        const named_import = named_imports.get(tracker.import_ref).?;
        // Is this an external file?
        const record = &import_records[named_import.import_record_index];
        if (!record.source_index.isValid()) {
            return .{ .value = .{}, .status = .external };
        }

        // Is this a disabled file?
        const other_source_index = record.source_index.get();
        const other_id = c.parse_graph.input_files.items(.ast)[other_source_index];

        if (other_id > c.graph.ast.len or c.graph.files.items(.source)[other_source_index].key_path.is_disabled) {
            return .{
                .value = .{
                    .source_index = record.source_index,
                },
                .status = .disabled,
            };
        }

        // Is this a named import of a file without any exports?
        if (!named_import.alias_is_star and
            // TODO hasLazyExport

            // CommonJS exports
            c.parse_graph.ast.items(.export_keyword)[other_id].len == 0 and !strings.eqlComptime(named_import.alias orelse "", "default") and
            // ESM exports
            !c.parse_graph.ast.items(.uses_exports_ref)[other_id] and !c.parse_graph.ast.items(.uses_module_ref)[other_id])
        {
            // Just warn about it and replace the import with "undefined"
            return .{
                .value = .{
                    .source_index = other_source_index,
                    .import_ref = Ref.None,
                },
                .status = .common_js_without_exports,
            };
        }
        const other_kind = export_kinds[other_id];
        // Is this a CommonJS file?
        if (other_kind == .cjs) {
            return .{
                .value = .{
                    .source_index = other_source_index,
                    .import_ref = Ref.None,
                },
                .status = .common_js,
            };
        }

        // Match this import star with an export star from the imported file
        if (named_import.alias_is_star) {
            if (c.graph.meta.items(.resolved_export_star)[other_id].resolved_export_star) |*matching_export| {
                // Check to see if this is a re-export of another import
                return .{
                    .value = .{
                        .source_index = matching_export.source_index,
                        .import_ref = matching_export.ref,
                        .name_loc = matching_export.name_loc,
                    },
                    .status = .found,
                    .import_data = matching_export.potentially_ambiguous_export_star_refs,
                };
            }
        }

        // Match this import up with an export from the imported file
        if (c.graph.meta.items(.resolved_exports)[other_id].get(named_import.alias.?)) |matching_export| {
            // Check to see if this is a re-export of another import
            return .{
                .value = .{
                    .source_index = matching_export.source_index,
                    .import_ref = matching_export.ref,
                    .name_loc = matching_export.name_loc,
                },
                .status = .found,
                .import_data = matching_export.potentially_ambiguous_export_star_refs,
            };
        }

        // Is this a file with dynamic exports?
        if (other_kind == .esm_with_dynamic_fallback) {
            return .{
                .value = .{
                    .source_index = other_source_index,
                    .import_ref = c.parse_graph.ast.items(.exports_ref)[other_id],
                },
                .status = .dynamic_exports,
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        if (named_import.is_exported and c.parse_graph.input_files.items(.loader)[other_source_index].isTypeScript()) {
            return .{
                .value = .{},
                .status = .probably_type_script_type,
            };
        }

        return .{
            .value = .{
                .source_index = other_source_index,
            },
            .status = .no_match,
        };
    }

    pub fn matchImportsWithExportsForFile(c: *LinkerContext, named_imports: *JSAst.NamedImports, imports_to_bind: *RefImportData, source_index: Index.Int) void {
        var iter = named_imports.iterator();
        // TODO: do we need to sort here? I don't think so
        // because NamedImports is an ArrayHashMap, it's order should naturally be deterministic

        // Pair imports with their matching exports

        while (iter.next()) |entry| {
            // Re-use memory for the cycle detector
            c.cycle_detector.clearRetainingCapacity();
            const ref = entry.key_ptr.*;

            const import_ref = Ref.init(ref.innerIndex(), @truncate(Ref.Int, source_index), ref.isSourceContentsSlice());
            var result = c.matchImportWithExport(
                .{
                    .source_index = source_index,
                    .import_ref = import_ref,
                },
                &.{},
            );

            switch (result.kind) {
                .normal => {
                    imports_to_bind.put(
                        c.allocator(),
                        import_ref,
                        .{
                            .re_exports = result.re_exports,
                            .source_index = result.source_index,
                            .ref = result.ref,
                        },
                    ) catch unreachable;
                },
                .namespace => {
                    c.graph.symbols.get(import_ref).?.namespace_alias = js_ast.G.NamespaceAlias{
                        .namespace_ref = result.namespace_ref,
                        .ref = result.ref,
                    };
                },
                .normal_and_namespace => {
                    imports_to_bind.put(
                        c.allocator(),
                        import_ref,
                        .{
                            .re_exports = result.re_exports,
                            .source_index = result.source_index,
                            .ref = result.ref,
                        },
                    ) catch unreachable;

                    c.graph.symbols.get(import_ref).?.namespace_alias = js_ast.G.NamespaceAlias{
                        .namespace_ref = result.namespace_ref,
                        .ref = result.ref,
                    };
                },
                .cycle => {
                    const source = &c.parse_graph.input_files.items(.source_index)[source_index];
                    const r = lex.rangeOfIdentifier(source, entry.value_ptr.alias_loc);
                    c.log.addRangeErrorFmt(
                        source,
                        r,
                        c.allocator(),
                        "Detected cycle while resolving import {s}",
                        .{
                            entry.value_ptr.alias.?,
                        },
                    ) catch unreachable;
                },
                .is_probably_typescript_type => {
                    c.graph.meta.items(.is_probably_typescript_type)[source_index].put(
                        c.allocator(),
                        import_ref,
                        .{},
                    ) catch unreachable;
                },
                .ambiguous => {
                    var named_import = entry.value_ptr.*;
                    const source = &c.parse_graph.input_files.items(.source_index)[source_index];

                    const r = lex.rangeOfIdentifier(source, entry.value_ptr.alias_loc);

                    // if (result.name_loc.start != 0)
                    // TODO: better error
                    c.log.addRangeErrorFmt(
                        source,
                        r,
                        c.allocator(),
                        "Ambiguous import: {s}",
                        .{
                            named_import.alias.?,
                        },
                    ) catch unreachable;
                },
                .ignore => {},
            }
        }
    }

    const ExportStarContext = struct {
        import_records_list: []const ImportRecord.List,
        source_index_stack: std.ArrayList(Index.Int),
        export_kinds: []js_ast.ExportKind,
        named_exports: []js_ast.Ast.NamedExports,
        imports_to_bind: []RefImportData,
        asts: []const Index.Int,
        export_star_records: []const []const Index.Int,
        allocator: std.mem.Allocator,

        pub fn addExports(
            this: *ExportStarContext,
            resolved_exports: *RefExportData,
            source_index: Index,
        ) void {
            // Avoid infinite loops due to cycles in the export star graph
            for (this.source_index_stack.items) |i| {
                if (i == source_index)
                    return;
            }

            this.source_index_stack.append(source_index) catch unreachable;
            const id = this.asts[source_index];

            const import_records = this.import_records_list[id].slice();

            for (this.export_star_records[id]) |import_id| {
                const other_source_index = import_records[import_id].source_index;
                if (other_source_index >= this.ast.len)
                    // This will be resolved at run time instead
                    continue;

                const other_id = this.asts[other_source_index];
                if (other_id >= this.named_exports.len)
                    // this AST was empty or it wasn't a JS AST
                    continue;

                // Export stars from a CommonJS module don't work because they can't be
                // statically discovered. Just silently ignore them in this case.
                //
                // We could attempt to check whether the imported file still has ES6
                // exports even though it still uses CommonJS features. However, when
                // doing this we'd also have to rewrite any imports of these export star
                // re-exports as property accesses off of a generated require() call.
                if (this.export_kinds[other_id] == .cjs)
                    continue;
                var iter = this.named_exports[other_id].iterator();
                next_export: while (iter.next()) |entry| {
                    const alias = entry.key_ptr.*;

                    // ES6 export star statements ignore exports named "default"
                    if (strings.eqlComptime(alias, "default"))
                        continue;

                    // This export star is shadowed if any file in the stack has a matching real named export
                    for (this.source_index_stack.items) |prev| {
                        if (this.named_exports[this.asts[prev]].contains(alias)) {
                            continue :next_export;
                        }
                    }

                    var resolved = resolved_exports.getOrPut(this, alias) catch unreachable;
                    if (!resolved.found_existing) {
                        resolved.value_ptr.* = .{
                            .ref = entry.value_ptr.ref,
                            .source_index = other_source_index,
                            .name_loc = entry.value_ptr.alias_loc,
                        };

                        // Make sure the symbol is marked as imported so that code splitting
                        // imports it correctly if it ends up being shared with another chunk
                        this.imports_to_bind[id].put(this.allocator, entry.value_ptr.*, .{
                            .ref = entry.value_ptr.ref,
                            .source_index = other_source_index,
                        }) catch unreachable;
                    } else if (resolved.value_ptr.*.source_index != other_source_index) {
                        // Two different re-exports colliding makes it potentially ambiguous
                        resolved.value_ptr.potentially_ambiguous_export_star_refs.append(this.allocator, .{
                            .source_index = other_source_index,
                            .ref = entry.value_ptr.ref,
                            .name_loc = entry.value_ptr.alias_loc,
                        }) catch unreachable;
                    }
                }

                // Search further through this file's export stars
                this.addExports(resolved_exports, other_source_index);
            }
        }
    };

    const DependencyWrapper = struct {
        linker: *LinkerContext,
        did_wrap_dependencies: []bool,
        wraps: []WrapKind,
        export_kinds: []js_ast.ExportsKind,
        import_records: []ImportRecord.List,
        export_star_map: std.AutoHashMap(Index.Int, void),
        entry_point_kinds: []EntryPoint.Kind,
        export_star_records: [][]u32,
        output_format: options.OutputFormat,

        pub fn hasDynamicExportsDueToExportStar(this: *DependencyWrapper, source_index: Index.Int) bool {
            // Terminate the traversal now if this file already has dynamic exports
            const export_kind = this.export_kinds[source_index];
            switch (export_kind) {
                .cjs, .esm_with_dynamic_fallback => return true,
            }

            // Avoid infinite loops due to cycles in the export star graph
            const has_visited = this.export_star_map.getOrPut(source_index) catch unreachable;
            if (has_visited.found_existing) {
                return false;
            }

            for (this.export_star_records[source_index]) |id| {
                const records: []const ImportRecord = this.import_records[id].slice();
                for (records) |record| {
                    // This file has dynamic exports if the exported imports are from a file
                    // that either has dynamic exports directly or transitively by itself
                    // having an export star from a file with dynamic exports.
                    const kind = this.entry_point_kinds[record.source_index];
                    if ((record.source_index >= this.import_records.len and (!kind.isEntryPoint() or !this.output_format.keepES6ImportExportSyntax())) or
                        (record.source_index < this.import_records.len and record.source_index != source_index and this.hasDynamicExportsDueToExportStar(record.source_index)))
                    {
                        this.export_kinds[source_index] = .esm_with_dynamic_fallback;
                        return true;
                    }
                }
            }

            return false;
        }

        pub fn wrap(this: *DependencyWrapper, source_index: Index.Int) void {

            // Never wrap the runtime file since it always comes first
            if (source_index == Index.runtime.get()) {
                return;
            }

            if (this.did_wrap_dependencies[source_index]) return;

            // This module must be wrapped
            if (this.wraps[source_index] == .none) {
                this.wraps[source_index] = switch (this.export_kinds[source_index]) {
                    .cjs => .cjs,
                    else => .esm,
                };
            }

            const records = this.import_records[source_index].slice();
            for (records) |record| {
                if (record.source_index.isValid()) {
                    continue;
                }
                this.wrap(record.source_index);
            }
        }
    };

    pub inline fn allocator(this: *const LinkerContext) std.mem.Allocator {
        return this.graph.allocator;
    }
};

pub const PartRange = struct {
    source_index: Index = Index.invalid,
    part_index_begin: u32 = 0,
    part_index_end: u32 = 0,
};

pub const ImportTracker = struct {
    source_index: Index = Index.invalid,
    name_loc: Logger.Loc = Logger.Loc.Empty,
    import_ref: Ref = Ref.None,

    pub const Status = enum {
        /// The imported file has no matching export
        no_match,

        /// The imported file has a matching export
        found,

        /// The imported file is CommonJS and has unknown exports
        common_js,

        /// The import is missing but there is a dynamic fallback object
        dynamic_fallback,

        /// The import was treated as a CommonJS import but the file is known to have no exports
        common_js_without_exports,

        /// The imported file was disabled by mapping it to false in the "browser"
        /// field of package.json
        disabled,

        /// The imported file is external and has unknown exports
        external,

        /// This is a missing re-export in a TypeScript file, so it's probably a type
        probably_type_script_type,
    };

    pub const Iterator = struct {
        status: Status = Status.no_match,
        value: ImportTracker = ImportTracker{},
        import_data: []ImportData = &.{},
    };
};
