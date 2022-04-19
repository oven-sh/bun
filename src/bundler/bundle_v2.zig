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

    pub fn go(this: *ThreadPool, allocator: std.mem.Allocator, comptime Function: anytype) !ThreadPoolLib.ConcurrentFunction(Function) {
        return this.pool.go(allocator, Function);
    }

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

                        var import_records = result.ast.import_records.slice();
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

    try this.linker.link(this, try this.findReachableFiles());

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
                for (ast.import_records.slice()) |*import_record| {
                    // Don't resolve the runtime
                    if (import_record.is_internal or import_record.is_unused) {
                        continue;
                    }
                    estimated_resolve_queue_count += 1;
                }

                try resolve_queue.ensureUnusedCapacity(estimated_resolve_queue_count);
                var last_error: ?anyerror = null;
                for (ast.import_records.slice()) |*import_record| {
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

pub const invalid_part_index = std.math.maxInt(Ref.Int);

const Visitor = struct {
    reachable: std.ArrayList(Ref.Int),
    visited: std.DynamicBitSet = undefined,
    input_file_asts: []Ref.Int,
    all_import_records: []ImportRecord.List,

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
        // when there are no import records, this index will be invalid
        if (import_record_list_id < this.all_import_records.len) {
            for (this.all_import_records[import_record_list_id].slice()) |*import_record| {
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

bundler: *Bundler,
graph: Graph = Graph{},
linker: LinkerContext = LinkerContext{},
tmpfile: std.fs.File = undefined,
tmpfile_byte_offset: u32 = 0,

pub fn appendBytes(generator: *BundleV2, bytes: anytype) !void {
    try generator.tmpfile.writeAll(bytes);
    generator.tmpfile_byte_offset += @truncate(Ref.Int, bytes.len);
}

const IdentityContext = @import("../identity_context.zig").IdentityContext;

const RefVoidMap = std.ArrayHashMapUnmanaged(Ref, void, Ref.ArrayHashCtx, false);
const RefImportData = std.ArrayHashMapUnmanaged(Ref, ImportData, Ref.ArrayHashCtx, false);
const RefExportData = std.ArrayHashMapUnmanaged(Ref, ExportData, Ref.ArrayHashCtx, false);
const TopLevelSymbolToParts = std.ArrayHashMapUnmanaged(Ref, u32, Ref.ArrayHashCtx, false);

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
    potentially_ambiguous_export_star_refs: BabyList(ImportData) = .{},

    ref: Ref = Ref.None,

    // This is the file that the named export above came from. This will be
    // different from the file that contains this object if this is a re-export.
    name_loc: Logger.Loc = Logger.Loc.Empty, // Optional, goes with sourceIndex, ignore if zero,
    source_index: Ref.Int = invalid_part_index,
};

pub const Graph = struct {
    entry_points: std.ArrayListUnmanaged(Ref.Int) = .{},
    ast: std.MultiArrayList(JSAst) = .{},
    meta: std.MultiArrayList(JSMeta) = .{},
    input_files: InputFile.List = .{},

    code_splitting: bool = false,

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

const EntryPoint = struct {
    // This may be an absolute path or a relative path. If absolute, it will
    // eventually be turned into a relative path by computing the path relative
    // to the "outbase" directory. Then this relative path will be joined onto
    // the "outdir" directory to form the final output path for this entry point.
    output_path: bun.PathString = bun.PathString.empty,

    // This is the source index of the entry point. This file must have a valid
    // entry point kind (i.e. not "none").
    source_index: u32 = 0,

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

const LinkerGraph = struct {
    files: File.List = .{},
    entry_points: EntryPoint.List = .{},
    symbols: js_ast.Symbol.Map = .{},

    allocator: std.mem.Allocator,

    code_splitting: bool = false,

    // This is an alias from Graph
    // it is not a clone!
    asts: std.MultiArrayList(js_ast.Ast) = .{},

    reachable_files: []Ref.Int = &[_]Ref.Int{},

    stable_source_indices: []const u32 = &[_]u32{},

    // This holds all entry points that can reach a file
    // it is a 2 dimensional bitset
    file_entry_bits: Bitmap,

    pub fn load(this: *LinkerGraph, entry_points: []const Ref.Int, sources: []const Logger.Source) !void {
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
            var stable_source_indices = try this.allocator.alloc(Ref.Int, sources.len);
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

    // We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    cjs_runtime_ref: Ref = Ref.None,
    esm_runtime_ref: Ref = Ref.None,

    // We may need to refer to the CommonJS "module" symbol for exports
    unbound_module_ref: Ref = Ref.None,

    options: LinkerOptions = LinkerOptions{},

    wait_group: ThreadPoolLib.WaitGroup = undefined,

    pub const LinkerOptions = struct {
        output_format: options.OutputFormat = .esm,
    };

    fn load(this: *LinkerContext, bundle: *BundleV2, entry_points: []Ref.Int, reachable: []Ref.Int) !void {
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

        this.graph.reachable_files = reachable;

        const sources: []const Logger.Source = this.parse_graph.input_files.items(.source);

        try this.graph.load(entry_points, sources);
        this.wait_group = try ThreadPoolLib.WaitGroup.init();
    }

    pub fn link(this: *LinkerContext, bundle: *BundleV2, entry_points: []Ref.Int, reachable: []Ref.Int) !void {
        try this.load(bundle, entry_points, reachable);

        try this.scanImportsAndExports();

        // Stop now if there were errors
        if (this.log.hasErrors()) {
            return;
        }
    }

    pub fn scanImportsAndExports(this: *LinkerContext) !void {
        var import_records_list: []ImportRecord.List = this.graph.asts.items(.import_records);
        // var parts_list: [][]js_ast.Part = this.graph.asts.items(.parts);
        var asts = this.parse_graph.input_files.items(.ast);
        var export_kinds: []js_ast.ExportsKind = this.parse_graph.ast.items(.export_kinds);
        var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
        var named_imports: []js_ast.Ast.NamedImports = this.graph.asts.items(.named_imports);
        var wraps: []WrapKind = this.parse_graph.meta.items(.wrap);
        const reachable = this.graph.reachable_files;
        const output_format = this.options.output_format;
        var export_star_import_records: [][]u32 = this.parse_graph.ast.items(.export_star_import_records);
        var exports_refs: []Ref = this.parse_graph.ast.items(.exports_ref);

        // Step 1: Figure out what modules must be CommonJS
        for (reachable) |source_index| {
            const id = asts[source_index];

            // does it have a JS AST?
            if (!(id < import_records_list.len)) continue;

            var import_records: []ImportRecord = import_records_list[id].slice();
            for (import_records) |record| {
                if (record.source_index == invalid_part_index) {
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
                .did_wrap_dependencies = this.parse_graph.meta.items(.did_wrap_dependencies),
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
            var resolved_exports: []RefExportData = this.parse_graph.meta.items(.resolved_exports);
            var resolved_export_stars: []ExportData = this.parse_graph.meta.items(.resolved_export_star);

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
            for (reachable) |source_index| {
                if (asts.len < @as(usize, source_index)) continue;
                const ast = asts[source_index];
                // not a JS ast or empty
                if (ast > named_imports.len) {
                    continue;
                }

                var named_imports_ = &named_imports[ast];
                if (named_imports_.count() > 0) {
                    this.matchImportsWithExportsForFile(named_imports_);
                }
            }
        }
    }

    const ExportStarContext = struct {
        import_records_list: []const ImportRecord.List,
        source_index_stack: std.ArrayList(u32),
        export_kinds: []js_ast.ExportKind,
        named_exports: []js_ast.Ast.NamedExports,
        imports_to_bind: []RefImportData,
        asts: []const u32,
        export_star_records: []const []const u32,
        allocator: std.mem.Allocator,

        pub fn addExports(
            this: *ExportStarContext,
            resolved_exports: *RefExportData,
            source_index: u32,
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
                if (other_source_index >= this.asts.len)
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
        export_star_map: std.AutoHashMap(u32, void),
        entry_point_kinds: []EntryPoint.Kind,
        export_star_records: [][]u32,
        output_format: options.OutputFormat,

        pub fn hasDynamicExportsDueToExportStar(this: *DependencyWrapper, source_index: u32) bool {
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

        pub fn wrap(this: *DependencyWrapper, source_index: u32) void {

            // Never wrap the runtime file since it always comes first
            if (source_index == Ref.RuntimeRef.sourceIndex()) {
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
                if (record.source_index == invalid_part_index) {
                    continue;
                }
                this.wrap(record.source_index);
            }
        }
    };

    pub inline fn allocator(this: *const LinkerContext) std.mem.Allocator {
        return this.graph.allocator;
    }

    pub const ImportTracker = struct {
        source_index: Ref.Int = invalid_part_index,
        part_index_begin: u32 = 0,
        part_index_end: u32 = 0,
    };
};
