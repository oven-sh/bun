const Bundler = bun.Bundler;
const GenerateNodeModulesBundle = @This();
const bun = @import("bun");
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
const js_parser = bun.js_parser;
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
const ImportRecord = bun.ImportRecord;
const ImportKind = bun.ImportKind;
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
const EntryPoints = @import("./entry_points.zig");
const ThisBundler = @import("../bundler.zig").Bundler;
const wyhash = std.hash.Wyhash.hash;
const Dependency = js_ast.Dependency;
const JSAst = js_ast.Ast;
const Loader = options.Loader;
const Index = @import("../ast/base.zig").Index;
const Batcher = bun.Batcher;
const Symbol = js_ast.Symbol;
const EventLoop = bun.JSC.AnyEventLoop;
const MultiArrayList = bun.MultiArrayList;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const AutoBitSet = bun.bit_set.AutoBitSet;
const renamer = @import("../renamer.zig");

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

    const debug = Output.scoped(.ThreadPool, false);

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
        debug("allocated {d} workers", .{this.cpu_count});
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
                .macro_context = undefined,
            };
            this.data.log.* = Logger.Log.init(allocator);
            this.data.bundler = this.ctx.bundler.*;
            this.data.bundler.setLog(this.data.log);
            this.data.bundler.setAllocator(allocator);
            this.data.bundler.linker.resolver = &this.data.bundler.resolver;
            this.data.bundler.macro_context = js_ast.Macro.MacroContext.init(&this.data.bundler);
            this.data.macro_context = this.data.bundler.macro_context.?;

            const CacheSet = @import("../cache.zig");

            this.data.bundler.resolver.caches = CacheSet.Set.init(this.allocator);

            // no funny business mr. cache

        }
    };
};

pub const BundleV2 = struct {
    bundler: *Bundler,
    graph: Graph = Graph{},
    linker: LinkerContext = LinkerContext{ .loop = undefined },
    tmpfile: std.fs.File = undefined,
    tmpfile_byte_offset: u32 = 0,

    const debug = Output.scoped(.Bundle, false);

    pub inline fn loop(this: *BundleV2) *EventLoop {
        return &this.linker.loop;
    }

    pub fn findReachableFiles(this: *BundleV2) ![]Index {
        const Visitor = struct {
            reachable: std.ArrayList(Index),
            visited: bun.bit_set.DynamicBitSet = undefined,
            all_import_records: []ImportRecord.List,

            // Find all files reachable from all entry points. This order should be
            // deterministic given that the entry point order is deterministic, since the
            // returned order is the postorder of the graph traversal and import record
            // order within a given file is deterministic.
            pub fn visit(v: *@This(), source_index: Index) void {
                if (source_index.isInvalid()) return;
                if (v.visited.isSet(source_index.get())) {
                    return;
                }
                v.visited.set(source_index.get());

                const import_record_list_id = source_index;
                // when there are no import records, v index will be invalid
                if (import_record_list_id.get() < v.all_import_records.len) {
                    for (v.all_import_records[import_record_list_id.get()].slice()) |*import_record| {
                        const other_source = import_record.source_index;
                        if (other_source.isValid()) {
                            v.visit(other_source);
                        }
                    }
                }

                // Each file must come after its dependencies
                v.reachable.append(source_index) catch unreachable;
            }
        };

        var visitor = Visitor{
            .reachable = try std.ArrayList(Index).initCapacity(this.graph.allocator, this.graph.entry_points.items.len + 1),
            .visited = try bun.bit_set.DynamicBitSet.initEmpty(this.graph.allocator, this.graph.input_files.len),
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

    pub fn appendBytes(generator: *BundleV2, bytes: anytype) !void {
        try generator.tmpfile.writeAll(bytes);
        generator.tmpfile_byte_offset += @truncate(u32, bytes.len);
    }

    pub fn ensurePathIsAllocated(this: *BundleV2, path_: ?*Fs.Path) !void {
        var path = path_ orelse return;

        const loader = this.bundler.options.loaders.get(path.name.ext) orelse .file;
        if (!loader.isJavaScriptLikeOrJSON()) return;
        path.* = try path.dupeAlloc(this.allocator);
    }

    pub fn waitForParse(this: *BundleV2) void {
        while (this.graph.parse_pending > 0) {
            this.loop().tick(this);
        }

        debug("Parsed {d} files, producing {d} ASTs", .{ this.graph.input_files.len, this.graph.ast.len });
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
        const source_index = Index.source(this.graph.input_files.len);
        path.* = try path.dupeAlloc(this.graph.allocator);
        entry.value_ptr.* = source_index.get();
        this.graph.ast.append(this.graph.allocator, js_ast.Ast.empty) catch unreachable;
        try this.graph.input_files.append(this.graph.allocator, .{
            .source = .{
                .path = path.*,
                .key_path = path.*,
                .contents = "",
                .index = source_index,
            },
            .loader = loader,
            .side_effects = resolve.primary_side_effects_data,
        });
        var task = try this.graph.allocator.create(ParseTask);
        task.* = ParseTask.init(&result, source_index);
        task.loader = loader;
        task.task.node.next = null;
        task.tree_shaking = this.bundler.options.tree_shaking;
        batch.push(ThreadPoolLib.Batch.from(&task.task));
        return source_index.get();
    }

    pub fn generate(
        bundler: *ThisBundler,
        allocator: std.mem.Allocator,
        framework_config: ?Api.LoadedFramework,
        route_config: ?Api.LoadedRouteConfig,
        destination: [*:0]const u8,
        estimated_input_lines_of_code: *usize,
        package_bundle_map: options.BundlePackage.Map,
        event_loop: EventLoop,
        unique_key: u64,
    ) !void {
        _ = try bundler.fs.fs.openTmpDir();
        var tmpname_buf: [64]u8 = undefined;
        bundler.resetStore();
        try bundler.configureDefines();
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
            .linker = .{
                .loop = event_loop,
                .graph = .{
                    .allocator = undefined,
                },
            },
        };
        generator.linker.graph.allocator = generator.graph.heap.allocator();
        generator.graph.allocator = generator.linker.graph.allocator;
        generator.bundler.allocator = generator.graph.allocator;
        generator.bundler.resolver.allocator = generator.graph.allocator;
        generator.bundler.linker.allocator = generator.graph.allocator;
        generator.bundler.log.msgs.allocator = generator.graph.allocator;
        generator.linker.resolver = &generator.bundler.resolver;

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

        {
            // Add the runtime
            try this.graph.input_files.append(allocator, Graph.InputFile{
                .source = ParseTask.runtime_source,
                .loader = .js,
                .side_effects = _resolver.SideEffects.no_side_effects__package_json,
            });

            // try this.graph.entry_points.append(allocator, Index.runtime);
            this.graph.ast.append(this.graph.allocator, js_ast.Ast.empty) catch unreachable;
            this.graph.path_to_source_index_map.put(this.graph.allocator, bun.hash("bun:wrap"), Index.runtime.get()) catch unreachable;
            var runtime_parse_task = try this.graph.allocator.create(ParseTask);
            runtime_parse_task.* = ParseTask.runtime;
            runtime_parse_task.task.node.next = null;
            runtime_parse_task.loader = .js;
            this.graph.parse_pending += 1;
            batch.push(ThreadPoolLib.Batch.from(&runtime_parse_task.task));
        }

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
                        this.graph.entry_points.append(this.graph.allocator, Index.source(source_index)) catch unreachable;
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
                        this.graph.entry_points.append(this.graph.allocator, Index.source(source_index)) catch unreachable;
                    } else {}
                }

                if (framework.fallback.isEnabled()) {
                    const resolved = try bundler.resolver.resolve(
                        bundler.fs.top_level_dir,
                        framework.fallback.path,
                        .entry_point,
                    );
                    if (try this.enqueueItem(null, &batch, resolved)) |source_index| {
                        this.graph.entry_points.append(this.graph.allocator, Index.source(source_index)) catch unreachable;
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
                    this.graph.entry_points.append(this.graph.allocator, Index.source(source_index)) catch unreachable;
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
                    this.graph.entry_points.append(this.graph.allocator, Index.source(source_index)) catch unreachable;
                } else {}
            }
        }

        this.graph.pool.pool.schedule(batch);
        this.waitForParse();

        this.linker.allocator = this.bundler.allocator;
        this.linker.graph.allocator = this.bundler.allocator;
        this.linker.graph.ast = try this.graph.ast.clone(this.linker.allocator);

        try this.linker.link(
            this,
            this.graph.entry_points.items,
            try this.findReachableFiles(),
            unique_key,
        );

        // return null;
    }

    pub fn onParseTaskComplete(parse_result: *ParseTask.Result, this: *BundleV2) void {
        var graph = &this.graph;
        var batch = ThreadPoolLib.Batch{};
        var diff: isize = -1;
        defer graph.parse_pending = if (diff > 0)
            graph.parse_pending + @intCast(usize, diff)
        else
            graph.parse_pending - @intCast(usize, -diff);
        switch (parse_result.value) {
            .empty => |source_index| {
                var input_files = graph.input_files.slice();
                var side_effects = input_files.items(.side_effects);
                side_effects[source_index.get()] = .no_side_effects__empty_ast;
                if (comptime Environment.allow_assert) {
                    debug("onParse({d}, {s}) = empty", .{
                        source_index.get(),
                        input_files.items(.source)[source_index.get()].path.text,
                    });
                }
            },
            .success => |*result| {
                result.log.appendTo(this.bundler.log) catch unreachable;
                {
                    var input_files = graph.input_files.slice();
                    input_files.items(.source)[result.source.index.get()] = result.source;
                    debug("onParse({d}, {s}) = {d} imports, {d} exports", .{
                        result.source.index.get(),
                        result.source.path.text,
                        result.ast.import_records.len,
                        result.ast.named_exports.count(),
                    });
                }

                var iter = result.resolve_queue.iterator();

                while (iter.next()) |entry| {
                    const hash = entry.key_ptr.*;
                    const value = entry.value_ptr.*;
                    const loader = value.loader orelse options.Loader.file;
                    if (!loader.isJavaScriptLikeOrJSON()) {
                        // TODO:
                        continue;
                    }
                    var existing = graph.path_to_source_index_map.getOrPut(graph.allocator, hash) catch unreachable;
                    if (!existing.found_existing) {
                        var new_input_file = Graph.InputFile{
                            .source = Logger.Source.initEmptyFile(entry.value_ptr.path.text),
                            .side_effects = value.side_effects,
                        };
                        new_input_file.source.index = Index.source(graph.input_files.len);
                        new_input_file.source.path = entry.value_ptr.path;
                        new_input_file.source.key_path = new_input_file.source.path;
                        // graph.source_index_map.put(graph.allocator, new_input_file.source.index.get, new_input_file.source) catch unreachable;
                        existing.value_ptr.* = new_input_file.source.index.get();
                        entry.value_ptr.source_index = new_input_file.source.index;
                        graph.input_files.append(graph.allocator, new_input_file) catch unreachable;
                        graph.ast.append(graph.allocator, js_ast.Ast.empty) catch unreachable;
                        batch.push(ThreadPoolLib.Batch.from(&entry.value_ptr.task));
                        diff += 1;
                    }
                }

                var import_records = result.ast.import_records.slice();
                for (import_records) |*record| {
                    if (graph.path_to_source_index_map.get(wyhash(0, record.path.text))) |source_index| {
                        record.source_index.set(source_index);
                    }
                }

                graph.ast.set(result.source.index.get(), result.ast);
                // schedule as early as possible
                graph.pool.pool.schedule(batch);
            },
            .err => |*err| {
                if (comptime Environment.allow_assert) {
                    debug("onParse() = err", .{});
                }

                if (err.log.msgs.items.len > 0) {
                    err.log.appendTo(this.bundler.log) catch unreachable;
                } else {
                    this.bundler.log.addErrorFmt(
                        null,
                        Logger.Loc.Empty,
                        this.bundler.allocator,
                        "{s} while {s}",
                        .{ @errorName(err.err), @tagName(err.step) },
                    ) catch unreachable;
                }
            },
        }
    }
};

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
    task: ThreadPoolLib.Task = .{ .callback = &callback },
    tree_shaking: bool = false,

    const debug = Output.scoped(.ParseTask, false);

    pub const ResolveQueue = std.AutoArrayHashMap(u64, ParseTask);

    pub fn init(resolve_result: *const _resolver.Result, source_index: ?Index) ParseTask {
        return .{
            .path = resolve_result.path_pair.primary,
            .contents_or_fd = .{
                .fd = .{
                    .dir = resolve_result.dirname_fd,
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
            // .supports_react_refresh = false,
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

    pub const Result = struct {
        task: EventLoop.Task = undefined,

        value: union(Tag) {
            err: Error,
            success: Success,
            empty: Index,
        },

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
                            debug("{s} -> {s}", .{ file_path.text, override_path });
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
                    task.contents_or_fd.fd.dir,
                    false,
                    if (task.contents_or_fd.fd.file > 0)
                        task.contents_or_fd.fd.file
                    else
                        null,
                );
            },
            .contents => |contents| CacheEntry{
                .contents = contents,
                .fd = 0,
            },
        };

        errdefer if (task.contents_or_fd == .fd) entry.deinit(allocator);

        if (entry.fd > 2) task.contents_or_fd = .{
            .fd = .{
                .file = entry.fd,
                .dir = bun.invalid_fd,
            },
        };
        step.* = .parse;

        if (entry.contents.len == 0 or (entry.contents.len < 33 and strings.trim(entry.contents, " \n\r").len == 0)) {
            debug("skipping empty file: {s}", .{file_path.text});
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
        const loader = task.loader orelse bundler.options.loader(file_path.name.ext);
        const platform = bundler.options.platform;
        var resolve_queue = ResolveQueue.init(bun.default_allocator);
        errdefer resolve_queue.clearAndFree();

        switch (loader) {
            .jsx, .tsx, .js, .ts => {
                task.jsx.parse = loader.isJSX();

                var opts = js_parser.Parser.Options.init(task.jsx, loader);
                opts.transform_require_to_import = false;
                opts.can_import_from_bundle = false;
                opts.features.allow_runtime = !source.index.isRuntime();
                opts.warn_about_unbundled_modules = false;
                opts.macro_context = &this.data.macro_context;
                opts.bundle = true;
                opts.features.auto_import_jsx = task.jsx.parse and bundler.options.auto_import_jsx;
                opts.features.trim_unused_imports = bundler.options.trim_unused_imports orelse loader.isTypeScript();
                opts.tree_shaking = task.tree_shaking;

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
                        import_record.source_index = Index.invalid;
                        continue;
                    }

                    if (resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |_resolved_import| {
                        var resolve_result = _resolved_import;
                        // if there were errors, lets go ahead and collect them all
                        if (last_error != null) continue;

                        var path: *Fs.Path = resolve_result.path() orelse {
                            import_record.path.is_disabled = true;
                            import_record.source_index = Index.invalid;

                            continue;
                        };

                        if (resolve_result.is_external) {
                            continue;
                        }

                        var resolve_entry = try resolve_queue.getOrPut(wyhash(0, path.text));
                        if (resolve_entry.found_existing) {
                            import_record.path = resolve_entry.value_ptr.path;

                            continue;
                        }

                        path.* = try path.dupeAlloc(allocator);
                        import_record.path = path.*;
                        debug("created ParseTask: {s}", .{path.text});

                        resolve_entry.value_ptr.* = ParseTask.init(&resolve_result, null);
                        if (resolve_entry.value_ptr.loader == null) {
                            resolve_entry.value_ptr.loader = bundler.options.loader(path.name.ext);
                            resolve_entry.value_ptr.tree_shaking = task.tree_shaking;
                        }
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
                    debug("failed with error: {s}", .{@errorName(err)});
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

        var result = bun.default_allocator.create(Result) catch unreachable;
        result.* = .{
            .value = brk: {
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
                    break :brk .{
                        .err = .{
                            .err = err,
                            .step = step,
                            .log = log,
                        },
                    };
                }
            },
        };

        worker.ctx.loop().enqueueTaskConcurrent(
            Result,
            BundleV2,
            result,
            BundleV2.onParseTaskComplete,
            .task,
        );
    }
};

const IdentityContext = @import("../identity_context.zig").IdentityContext;

const RefVoidMap = std.ArrayHashMapUnmanaged(Ref, void, Ref.ArrayHashCtx, false);
const RefVoidMapManaged = std.ArrayHashMap(Ref, void, Ref.ArrayHashCtx, false);
const RefImportData = std.ArrayHashMapUnmanaged(Ref, ImportData, Ref.ArrayHashCtx, false);
const RefExportData = bun.StringArrayHashMapUnmanaged(ExportData);
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

    data: ImportTracker = .{},
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

    // This is the file that the named export above came from. This will be
    // different from the file that contains this object if this is a re-export.
    data: ImportTracker = .{},
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
    probably_typescript_type: RefVoidMap = .{},

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

    flags: Flags = .{},

    pub const Flags = packed struct {
        wrap: WrapKind = WrapKind.none,

        /// This is true if this file is affected by top-level await, either by having
        /// a top-level await inside this file or by having an import/export statement
        /// that transitively imports such a file. It is forbidden to call "require()"
        /// on these files since they are evaluated asynchronously.
        is_async_or_has_async_dependency: bool = false,

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

pub const Graph = struct {
    entry_points: std.ArrayListUnmanaged(Index) = .{},
    ast: MultiArrayList(JSAst) = .{},

    input_files: InputFile.List = .{},

    code_splitting: bool = false,

    pool: *ThreadPool = undefined,

    heap: ThreadlocalArena = ThreadlocalArena{},
    /// Main thread only!!
    allocator: std.mem.Allocator = undefined,

    parse_pending: usize = 0,

    /// Stable source index mapping
    source_index_map: std.AutoArrayHashMapUnmanaged(Index.Int, Ref.Int) = .{},

    /// Stable source index mapping
    path_to_source_index_map: std.HashMapUnmanaged(u64, Index.Int, IdentityContext(u64), 80) = .{},

    pub const InputFile = struct {
        source: Logger.Source,
        loader: options.Loader = options.Loader.file,
        side_effects: _resolver.SideEffects = _resolver.SideEffects.has_side_effects,

        pub const List = MultiArrayList(InputFile);
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

    pub const List = MultiArrayList(EntryPoint);

    pub const Kind = enum(u2) {
        none = 0,
        user_specified = 1,
        dynamic_import = 2,

        pub inline fn isEntryPoint(this: Kind) bool {
            return this != .none;
        }

        pub inline fn isUserSpecifiedEntryPoint(this: Kind) bool {
            return this == .user_specified;
        }
    };
};

const AstSourceIDMapping = struct {
    id: Index.Int,
    source_index: Index.Int,
};

const LinkerGraph = struct {
    const debug = Output.scoped(.LinkerGraph, false);

    files: File.List = .{},
    files_live: bun.bit_set.DynamicBitSetUnmanaged = undefined,
    entry_points: EntryPoint.List = .{},
    symbols: js_ast.Symbol.Map = .{},

    allocator: std.mem.Allocator,

    code_splitting: bool = false,

    // This is an alias from Graph
    // it is not a clone!
    ast: MultiArrayList(js_ast.Ast) = .{},
    meta: MultiArrayList(JSMeta) = .{},

    reachable_files: []Index = &[_]Index{},

    stable_source_indices: []const u32 = &[_]u32{},

    pub fn init(allocator: std.mem.Allocator, file_count: usize) !LinkerGraph {
        return LinkerGraph{ .allocator = allocator, .files_live = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(allocator, file_count) };
    }

    pub fn generateNewSymbol(this: *LinkerGraph, source_index: u32, kind: Symbol.Kind, original_name: string) Ref {
        var source_symbols = &this.symbols.symbols_for_source.slice()[source_index];

        const ref = Ref.init(
            @truncate(Ref.Int, source_symbols.len),
            @truncate(Ref.Int, source_index),
            false,
        );

        // TODO: will this crash on resize due to using threadlocal mimalloc heap?
        source_symbols.push(
            this.allocator,
            .{
                .kind = kind,
                .original_name = original_name,
            },
        ) catch unreachable;

        this.ast.items(.module_scope)[source_index].?.generated.push(this.allocator, ref) catch unreachable;
        return ref;
    }

    pub fn generateRuntimeSymbolImportAndUse(
        graph: *LinkerGraph,
        source_index: Index.Int,
        entry_point_part_index: Index,
        name: []const u8,
        count: u32,
    ) !void {
        const ref = graph.ast.items(.module_scope)[Index.runtime.get()].?.members.get(name).?.ref;
        try graph.generateSymbolImportAndUse(
            source_index,
            entry_point_part_index.get(),
            ref,
            count,
            Index.runtime,
        );
    }

    pub fn addPartToFile(
        graph: *LinkerGraph,
        id: u32,
        part: js_ast.Part,
    ) !u32 {
        var parts: *js_ast.Part.List = &graph.ast.items(.parts)[id];
        const part_id = parts.len;
        try parts.push(graph.allocator, part);
        var top_level_symbol_to_parts_overlay: ?*TopLevelSymbolToParts = null;

        var ctx = .{
            .graph = graph,
            .id = id,
            .part_id = part_id,
            .top_level_symbol_to_parts_overlay = &top_level_symbol_to_parts_overlay,
        };
        const Ctx = @TypeOf(ctx);

        const Iterator = struct {
            pub fn next(self: *Ctx, ref: Ref) void {
                var overlay = brk: {
                    if (self.top_level_symbol_to_parts_overlay.*) |out| {
                        break :brk out;
                    }

                    var out = &self.graph.meta.items(.top_level_symbol_to_parts_overlay)[self.id];

                    self.top_level_symbol_to_parts_overlay.* = out;
                    break :brk out;
                };

                var entry = overlay.getOrPut(self.graph.allocator, ref) catch unreachable;
                if (!entry.found_existing) {
                    entry.value_ptr.* = bun.from(
                        BabyList(u32),
                        self.graph.allocator,
                        &[_]u32{
                            self.part_id,
                        },
                    ) catch unreachable;
                } else {
                    entry.value_ptr.push(self.graph.allocator, self.part_id) catch unreachable;
                }
            }
        };

        js_ast.DeclaredSymbol.forEachTopLevelSymbol(&parts.ptr[part_id].declared_symbols, &ctx, Iterator.next);

        return part_id;
    }
    pub fn generateSymbolImportAndUse(
        g: *LinkerGraph,
        id: u32,
        part_index: u32,
        ref: Ref,
        use_count: u32,
        source_index_to_import_from: Index,
    ) !void {
        if (use_count == 0) return;

        // Mark this symbol as used by this part
        var part: *js_ast.Part = &g.ast.items(.parts)[id].slice()[part_index];

        var uses = part.symbol_uses.getOrPut(g.allocator, ref) catch unreachable;
        if (uses.found_existing) {
            uses.value_ptr.count_estimate += use_count;
        } else {
            uses.value_ptr.* = .{ .count_estimate = use_count };
        }

        const exports_ref = g.ast.items(.exports_ref)[id];
        const module_ref = g.ast.items(.module_ref)[id].?;
        if (ref.eql(exports_ref)) {
            g.ast.items(.uses_exports_ref)[id] = true;
        }

        if (ref.eql(module_ref)) {
            g.ast.items(.uses_module_ref)[id] = true;
        }

        // Track that this specific symbol was imported
        if (source_index_to_import_from.get() != id) {
            try g.meta.items(.imports_to_bind)[id].put(g.allocator, ref, .{
                .data = .{
                    .source_index = source_index_to_import_from,
                    .import_ref = ref,
                },
            });
        }

        // Pull in all parts that declare this symbol
        var dependencies = &part.dependencies;
        const part_ids = g.topLevelSymbolToParts(id, ref);
        try dependencies.ensureUnusedCapacity(g.allocator, part_ids.len);
        for (part_ids) |_, part_id| {
            dependencies.appendAssumeCapacity(.{
                .source_index = source_index_to_import_from,
                .part_index = @truncate(u32, part_id),
            });
        }
    }

    pub fn topLevelSymbolToParts(g: *LinkerGraph, id: u32, ref: Ref) []u32 {
        var list: BabyList(u32) = g.meta.items(.top_level_symbol_to_parts_overlay)[id].get(ref) orelse
            g.ast.items(.top_level_symbols_to_parts)[id].get(ref) orelse
            return &.{};

        return list.slice();
    }

    pub fn load(this: *LinkerGraph, entry_points: []const Index, sources: []const Logger.Source) !void {
        try this.files.ensureTotalCapacity(this.allocator, sources.len);
        this.files.zero();
        this.files_live = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(
            this.allocator,
            sources.len,
        );
        this.files.len = sources.len;
        var files = this.files.slice();

        var entry_point_kinds = files.items(.entry_point_kind);
        {
            var kinds = std.mem.sliceAsBytes(entry_point_kinds);
            @memset(kinds.ptr, 0, kinds.len);
        }

        // Setup entry points
        {
            try this.entry_points.ensureTotalCapacity(this.allocator, entry_points.len);
            this.entry_points.len = entry_points.len;
            var source_indices = this.entry_points.items(.source_index);

            var path_strings: []bun.PathString = this.entry_points.items(.output_path);
            {
                var output_was_auto_generated = std.mem.sliceAsBytes(this.entry_points.items(.output_path_was_auto_generated));
                @memset(output_was_auto_generated.ptr, 0, output_was_auto_generated.len);
            }

            for (entry_points) |i, j| {
                const source = sources[i.get()];
                if (comptime Environment.allow_assert) {
                    std.debug.assert(source.index.get() == i.get());
                }
                entry_point_kinds[source.index.get()] = EntryPoint.Kind.user_specified;
                path_strings[j] = bun.PathString.init(source.path.text);
                source_indices[j] = source.index.get();
            }
        }

        // Setup files
        {
            var stable_source_indices = try this.allocator.alloc(Index, sources.len);
            for (this.reachable_files) |_, i| {
                stable_source_indices[i] = Index.source(i);
            }

            const file = comptime LinkerGraph.File{};
            // TODO: verify this outputs efficient code
            std.mem.set(
                @TypeOf(file.distance_from_entry_point),
                files.items(.distance_from_entry_point),
                comptime file.distance_from_entry_point,
            );
        }

        this.symbols = js_ast.Symbol.Map.initList(js_ast.Symbol.NestedList.init(this.ast.items(.symbols)));
    }

    pub const File = struct {
        entry_bits: AutoBitSet = undefined,

        input_file: Index = Index.source(0),

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

        pub fn isEntryPoint(this: *const File) bool {
            return this.entry_point_kind.isEntryPoint();
        }

        pub fn isUserSpecifiedEntryPoint(this: *const File) bool {
            return this.entry_point_kind.isUserSpecifiedEntryPoint();
        }

        pub const List = MultiArrayList(File);
    };
};

const LinkerContext = struct {
    const debug = Output.scoped(.LinkerCtx, false);

    parse_graph: *Graph = undefined,
    graph: LinkerGraph = undefined,
    allocator: std.mem.Allocator = undefined,
    log: *Logger.Log = undefined,

    resolver: *Resolver = undefined,
    cycle_detector: std.ArrayList(ImportTracker) = undefined,
    swap_cycle_detector: std.ArrayList(ImportTracker) = undefined,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    cjs_runtime_ref: Ref = Ref.None,
    esm_runtime_ref: Ref = Ref.None,

    /// We may need to refer to the CommonJS "module" symbol for exports
    unbound_module_ref: Ref = Ref.None,

    options: LinkerOptions = LinkerOptions{},

    wait_group: ThreadPoolLib.WaitGroup = undefined,

    ambiguous_result_pool: std.ArrayList(MatchImport) = undefined,

    loop: EventLoop,
    unique_key_buf: []u8 = "",

    pub const LinkerOptions = struct {
        output_format: options.OutputFormat = .esm,
        ignore_dce_annotations: bool = false,
        tree_shaking: bool = true,
    };

    fn isExternalDynamicImport(this: *LinkerContext, record: *const ImportRecord, source_index: u32) bool {
        return record.kind == .dynamic and this.graph.files.items(.entry_point_kind)[source_index].isEntryPoint() and record.source_index.get() != source_index;
    }

    inline fn shouldCallRuntimeRequire(format: options.OutputFormat) bool {
        return format != .cjs;
    }

    fn load(this: *LinkerContext, bundle: *BundleV2, entry_points: []Index, reachable: []Index) !void {
        this.parse_graph = &bundle.graph;

        this.graph.code_splitting = bundle.bundler.options.code_splitting;
        this.log = bundle.bundler.log;

        this.resolver = &bundle.bundler.resolver;
        this.cycle_detector = std.ArrayList(ImportTracker).init(this.allocator);
        this.swap_cycle_detector = std.ArrayList(ImportTracker).init(this.allocator);

        this.graph.reachable_files = reachable;

        const sources: []const Logger.Source = this.parse_graph.input_files.items(.source);

        try this.graph.load(entry_points, sources);
        try this.wait_group.init();
        this.ambiguous_result_pool = std.ArrayList(MatchImport).init(this.allocator);
    }

    pub noinline fn link(
        this: *LinkerContext,
        bundle: *BundleV2,
        entry_points: []Index,
        reachable: []Index,
        unique_key: u64,
    ) !void {
        try this.load(bundle, entry_points, reachable);

        try this.scanImportsAndExports();

        // Stop now if there were errors
        if (this.log.hasErrors()) {
            return;
        }

        try this.treeShakingAndCodeSplitting();

        const chunks = try this.computeChunks(unique_key);

        try this.computeCrossChunkDependencies(chunks);

        this.graph.symbols.followAll();
    }

    pub noinline fn computeChunks(
        this: *LinkerContext,
        unique_key: u64,
    ) ![]Chunk {
        var stack_fallback = std.heap.stackFallback(4096, this.allocator);
        var stack_all = stack_fallback.get();
        var arena = std.heap.ArenaAllocator.init(stack_all);
        defer arena.deinit();

        var temp_allocator = arena.allocator();
        var js_chunks = bun.StringArrayHashMap(Chunk).init(this.allocator);
        try js_chunks.ensureUnusedCapacity(this.graph.entry_points.len);

        var entry_source_indices = this.graph.entry_points.items(.source_index);

        // Create chunks for entry points
        for (entry_source_indices) |source_index, entry_id_| {
            const entry_bit = @truncate(Chunk.EntryPoint.ID, entry_id_);

            var entry_bits = try bun.bit_set.AutoBitSet.initEmpty(this.allocator, this.graph.entry_points.len);
            entry_bits.set(entry_bit);

            // Create a chunk for the entry point here to ensure that the chunk is
            // always generated even if the resulting file is empty
            var js_chunk_entry = try js_chunks.getOrPut(try temp_allocator.dupe(u8, entry_bits.bytes()));

            js_chunk_entry.value_ptr.* = .{
                .entry_point = .{
                    .entry_point_id = entry_bit,
                    .source_index = source_index,
                    .is_entry_point = true,
                },
                .entry_bits = entry_bits,
                .content = .{
                    .javascript = .{},
                },
            };
        }
        var file_entry_bits: []AutoBitSet = this.graph.files.items(.entry_bits);

        // Figure out which JS files are in which chunk
        for (this.graph.reachable_files) |source_index| {
            if (this.graph.files_live.isSet(source_index.get())) {
                var entry_bits: *AutoBitSet = &file_entry_bits[source_index.get()];
                var js_chunk_entry = try js_chunks.getOrPut(
                    try temp_allocator.dupe(u8, entry_bits.bytes()),
                );

                if (!js_chunk_entry.found_existing) {
                    js_chunk_entry.value_ptr.* = .{
                        .entry_bits = try entry_bits.clone(this.allocator),
                        .entry_point = .{
                            .source_index = source_index.get(),
                        },
                        .content = .{
                            .javascript = .{},
                        },
                    };
                }

                var files = try js_chunk_entry.value_ptr.files_with_parts_in_chunk.getOrPut(this.allocator, source_index.get());
                _ = files;
            }
        }

        js_chunks.sort(strings.StringArrayByIndexSorter.init(js_chunks.keys()));

        var chunks: []Chunk = js_chunks.values();

        var entry_point_chunk_indices: []u32 = this.graph.files.items(.entry_point_chunk_index);
        // Map from the entry point file to this chunk. We will need this later if
        // a file contains a dynamic import to this entry point, since we'll need
        // to look up the path for this chunk to use with the import.
        for (chunks) |*chunk, chunk_id| {
            if (chunk.entry_point.is_entry_point) {
                entry_point_chunk_indices[chunk.entry_point.source_index] = @truncate(u32, chunk_id);
            }
        }

        // Determine the order of JS files (and parts) within the chunk ahead of time
        try this.findAllImportedPartsInJSOrder(temp_allocator, chunks);

        const unique_key_item_len = std.fmt.count("{any}C{d:8}", .{ bun.fmt.hexIntLower(unique_key), chunks.len });
        var unique_key_builder = try bun.StringBuilder.initCapacity(this.allocator, unique_key_item_len);
        this.unique_key_buf = unique_key_builder.allocatedSlice();
        errdefer {
            unique_key_builder.deinit(this.allocator);
            this.unique_key_buf = "";
        }

        var chunk_id: usize = 0;
        for (chunks) |*chunk| {
            defer chunk_id += 1;

            // Assign a unique key to each chunk. This key encodes the index directly so
            // we can easily recover it later without needing to look it up in a map. The
            // last 8 numbers of the key are the chunk index.
            chunk.unique_key = unique_key_builder.fmt("{any}C{d:8}", .{ bun.fmt.hexIntLower(unique_key), chunk_id });

            if (chunk.entry_point.is_entry_point) {
                chunk.template = PathTemplate.file;
                const pathname = Fs.PathName.init(this.graph.entry_points.items(.output_path)[chunk.entry_point.source_index].slice());
                chunk.template.placeholder.name = pathname.base;
                chunk.template.placeholder.ext = "js";
                chunk.template.placeholder.dir = pathname.dir;
            } else {
                chunk.template = PathTemplate.chunk;
            }
        }

        return chunks;
    }

    pub fn findAllImportedPartsInJSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, chunks: []Chunk) !void {
        var part_ranges_shared = std.ArrayList(PartRange).init(temp_allocator);
        var parts_prefix_shared = std.ArrayList(PartRange).init(temp_allocator);
        defer part_ranges_shared.deinit();
        defer parts_prefix_shared.deinit();
        for (chunks) |*chunk| {
            try this.findImportedPartsInJSOrder(
                chunk,
                &part_ranges_shared,
                &parts_prefix_shared,
            );
        }
    }

    pub fn findImportedPartsInJSOrder(
        this: *LinkerContext,
        chunk: *Chunk,
        part_ranges_shared: *std.ArrayList(PartRange),
        parts_prefix_shared: *std.ArrayList(PartRange),
    ) !void {
        var chunk_order_array = try std.ArrayList(Chunk.Order).initCapacity(this.allocator, chunk.files_with_parts_in_chunk.count());
        defer chunk_order_array.deinit();
        var distances = this.graph.files.items(.distance_from_entry_point);
        for (chunk.files_with_parts_in_chunk.keys()) |source_index| {
            chunk_order_array.appendAssumeCapacity(
                .{
                    .source_index = source_index,
                    .distance = distances[source_index],

                    .tie_breaker = this.graph.stable_source_indices[source_index],
                },
            );
        }

        Chunk.Order.sort(chunk_order_array.items);

        const Visitor = struct {
            entry_bits: *const AutoBitSet,
            flags: []const JSMeta.Flags,
            parts: []BabyList(js_ast.Part),
            import_records: []BabyList(ImportRecord),
            files: std.ArrayList(Index.Int) = undefined,
            part_ranges: std.ArrayList(PartRange) = undefined,
            visited: std.AutoHashMap(Index.Int, void) = undefined,
            parts_prefix: std.ArrayList(PartRange) = undefined,
            c: *LinkerContext,

            fn appendOrExtendRange(
                ranges: *std.ArrayList(PartRange),
                source_index: Index.Int,
                part_index: Index.Int,
            ) void {
                if (ranges.items.len > 0) {
                    var last_range = &ranges.items[ranges.items.len - 1];
                    if (last_range.source_index.get() == source_index and last_range.part_index_end == part_index) {
                        last_range.part_index_end += 1;
                        return;
                    }
                }

                ranges.append(.{
                    .source_index = Index.init(source_index),
                    .part_index_begin = part_index,
                    .part_index_end = part_index + 1,
                }) catch unreachable;
            }

            pub fn visit(v: *@This(), source_index: Index.Int) void {
                if (source_index == Index.invalid.value) return;
                const visited_entry = v.visited.getOrPut(source_index) catch unreachable;
                if (visited_entry.found_existing) return;

                var is_file_in_chunk = v.entry_bits.isSet(
                    source_index,
                );

                // Wrapped files can't be split because they are all inside the wrapper
                const can_be_split = v.flags[source_index].wrap == .none;

                const parts = v.parts[source_index].slice();
                if (can_be_split and is_file_in_chunk and parts[js_ast.namespace_export_part_index].is_live) {
                    appendOrExtendRange(&v.part_ranges, source_index, js_ast.namespace_export_part_index);
                }

                const records = v.import_records[source_index].slice();

                for (parts) |*part, part_index_| {
                    const part_index = @truncate(u32, part_index_);
                    const is_part_in_this_chunk = is_file_in_chunk and part.is_live;

                    for (part.import_record_indices.slice()) |record_id| {
                        const record = &records[record_id];
                        if (record.source_index.isValid() and (record.kind == .stmt or is_part_in_this_chunk)) {
                            if (v.c.isExternalDynamicImport(record, source_index)) {
                                // Don't follow import() dependencies

                                continue;
                            }

                            v.visit(record.source_index.get());
                        }
                    }

                    // Then include this part after the files it imports
                    if (is_part_in_this_chunk) {
                        is_file_in_chunk = true;

                        // if (can_be_split and part_index != js_ast.namespace_export_part_index and v.c.shouldIncludePart())
                        var js_parts = if (source_index == Index.runtime.value)
                            &v.parts_prefix
                        else
                            &v.part_ranges;

                        appendOrExtendRange(js_parts, source_index, part_index);
                    }
                }

                if (is_file_in_chunk) {
                    v.files.append(source_index) catch unreachable;

                    // CommonJS files are all-or-nothing so all parts must be contiguous
                    if (!can_be_split) {
                        v.parts_prefix.append(
                            .{
                                .source_index = Index.init(source_index),
                                .part_index_begin = 0,
                                .part_index_end = @truncate(u32, parts.len),
                            },
                        ) catch unreachable;
                    }
                }
            }
        };

        part_ranges_shared.clearRetainingCapacity();
        parts_prefix_shared.clearRetainingCapacity();

        var visitor = Visitor{
            .files = std.ArrayList(Index.Int).init(this.allocator),
            .part_ranges = part_ranges_shared.*,
            .parts_prefix = parts_prefix_shared.*,
            .visited = std.AutoHashMap(Index.Int, void).init(this.allocator),
            .flags = this.graph.meta.items(.flags),
            .parts = this.graph.ast.items(.parts),
            .import_records = this.graph.ast.items(.import_records),
            .entry_bits = chunk.entryBits(),
            .c = this,
        };
        defer {
            part_ranges_shared.* = visitor.part_ranges;
            parts_prefix_shared.* = visitor.parts_prefix;
            visitor.visited.deinit();
        }

        visitor.visit(Index.runtime.value);
        for (chunk_order_array.items) |order| {
            visitor.visit(order.source_index);
        }

        chunk.content.javascript.files_in_chunk_order = visitor.files.items;
        var parts_in_chunk_order = try this.allocator.alloc(PartRange, visitor.part_ranges.items.len + visitor.parts_prefix.items.len);
        std.mem.copy(PartRange, parts_in_chunk_order, visitor.parts_prefix.items);
        std.mem.copy(PartRange, parts_in_chunk_order[visitor.parts_prefix.items.len..], visitor.part_ranges.items);
        chunk.content.javascript.parts_in_chunk_in_order = parts_in_chunk_order;
    }

    pub fn scanImportsAndExports(this: *LinkerContext) !void {
        const reachable = this.graph.reachable_files;
        const output_format = this.options.output_format;
        const max_id = reachable.len;

        {
            var import_records_list: []ImportRecord.List = this.graph.ast.items(.import_records);
            try this.graph.meta.ensureTotalCapacity(this.graph.allocator, import_records_list.len);
            this.graph.meta.len = this.graph.ast.len;
            this.graph.meta.zero();

            // var parts_list: [][]js_ast.Part = this.graph.ast.items(.parts);
            var exports_kind: []js_ast.ExportsKind = this.graph.ast.items(.exports_kind);
            var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
            var named_imports: []js_ast.Ast.NamedImports = this.graph.ast.items(.named_imports);
            var flags: []JSMeta.Flags = this.graph.meta.items(.flags);

            var export_star_import_records: [][]u32 = this.graph.ast.items(.export_star_import_records);
            var exports_refs: []Ref = this.graph.ast.items(.exports_ref);
            var module_refs: []?Ref = this.graph.ast.items(.module_ref);
            var symbols = &this.graph.symbols;
            defer this.graph.symbols = symbols.*;

            // Step 1: Figure out what modules must be CommonJS
            for (reachable) |source_index_| {
                const id = source_index_.get();

                // does it have a JS AST?
                if (!(id < import_records_list.len)) continue;

                var import_records: []ImportRecord = import_records_list[id].slice();
                for (import_records) |record| {
                    if (!record.source_index.isValid()) {
                        continue;
                    }

                    const other_file = record.source_index.get();
                    // other file is empty
                    if (other_file >= exports_kind.len) continue;
                    const other_kind = exports_kind[other_file];
                    const other_wrap = flags[other_file].wrap;

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
                                exports_kind[other_file] = .cjs;
                                flags[other_file].wrap = .cjs;
                            }
                        },
                        ImportKind.require =>
                        // Files that are imported with require() must be CommonJS modules
                        {
                            if (other_kind == .esm) {
                                flags[other_file].wrap = .esm;
                            } else {
                                flags[other_file].wrap = .cjs;
                                exports_kind[other_file] = .cjs;
                            }
                        },
                        ImportKind.dynamic => {
                            if (!this.graph.code_splitting) {
                                // If we're not splitting, then import() is just a require() that
                                // returns a promise, so the imported file must be a CommonJS module
                                if (exports_kind[other_file] == .esm) {
                                    flags[other_file].wrap = .esm;
                                } else {
                                    flags[other_file].wrap = .cjs;
                                    exports_kind[other_file] = .cjs;
                                }
                            }
                        },
                        else => {},
                    }
                }

                const kind = exports_kind[id];

                // If the output format doesn't have an implicit CommonJS wrapper, any file
                // that uses CommonJS features will need to be wrapped, even though the
                // resulting wrapper won't be invoked by other files. An exception is made
                // for entry point files in CommonJS format (or when in pass-through mode).
                if (kind == .cjs and (!entry_point_kinds[id].isEntryPoint() or output_format == .iife or output_format == .esm)) {
                    flags[id].wrap = .cjs;
                }
            }

            if (comptime Environment.allow_assert) {
                var cjs_count: usize = 0;
                var esm_count: usize = 0;
                for (exports_kind) |kind| {
                    cjs_count += @boolToInt(kind == .cjs);
                    esm_count += @boolToInt(kind == .esm);
                }

                debug("Step 1: {d} CommonJS modules, {d} ES modules", .{ cjs_count, esm_count });
            }

            // Step 2: Propagate dynamic export status for export star statements that
            // are re-exports from a module whose exports are not statically analyzable.
            // In this case the export star must be evaluated at run time instead of at
            // bundle time.

            {
                var dependency_wrapper = DependencyWrapper{
                    .linker = this,
                    .flags = flags,
                    .import_records = import_records_list,
                    .exports_kind = exports_kind,
                    .entry_point_kinds = entry_point_kinds,
                    .export_star_map = std.AutoHashMap(u32, void).init(this.allocator),
                    .export_star_records = export_star_import_records,
                    .output_format = output_format,
                };
                defer dependency_wrapper.export_star_map.deinit();

                for (reachable) |source_index_| {
                    const source_index = source_index_.get();
                    const id = source_index;

                    // does it have a JS AST?
                    if (!(id < import_records_list.len)) continue;

                    if (flags[id].wrap != .none) {
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
                        if (record.source_index.isValid()) {
                            if (exports_kind[record.source_index.get()] == .cjs) {
                                dependency_wrapper.wrap(record.source_index.get());
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

                for (reachable) |source_index_| {
                    const source_index = source_index_.get();
                    const id = source_index;

                    // --
                    // TODO: generateCodeForLazyExport here!
                    // --

                    // Propagate exports for export star statements
                    var export_star_ids = export_star_import_records[id];
                    if (export_star_ids.len > 0) {
                        if (export_star_ctx == null) {
                            export_star_ctx = ExportStarContext{
                                .allocator = this.allocator,
                                .resolved_exports = resolved_exports,
                                .import_records_list = import_records_list,
                                .export_star_records = export_star_import_records,

                                // TODO:
                                .imports_to_bind = &.{},

                                .source_index_stack = std.ArrayList(u32).initCapacity(this.allocator, 32) catch unreachable,
                                .exports_kind = exports_kind,
                                .named_exports = this.graph.ast.items(.named_exports),
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
                        .data = .{
                            .source_index = Index.source(source_index),
                            .import_ref = exports_refs[id],
                        },
                    };
                }
            }

            // Step 4: Match imports with exports. This must be done after we process all
            // export stars because imports can bind to export star re-exports.
            {
                this.cycle_detector.clearRetainingCapacity();
                var wrapper_part_indices = this.graph.meta.items(.wrapper_part_index);
                var imports_to_bind = this.graph.meta.items(.imports_to_bind);

                for (reachable) |source_index_| {
                    const source_index = source_index_.get();
                    const id = source_index;

                    // ignore the runtime
                    if (source_index == Index.runtime.get())
                        continue;

                    // not a JS ast or empty
                    if (id >= named_imports.len) {
                        continue;
                    }

                    var named_imports_ = &named_imports[id];
                    if (named_imports_.count() > 0) {
                        this.matchImportsWithExportsForFile(
                            named_imports_,
                            &imports_to_bind[id],
                            source_index,
                        );
                    }
                    const export_kind = exports_kind[id];

                    // If we're exporting as CommonJS and this file was originally CommonJS,
                    // then we'll be using the actual CommonJS "exports" and/or "module"
                    // symbols. In that case make sure to mark them as such so they don't
                    // get minified.
                    if ((output_format == .cjs or output_format == .preserve) and
                        entry_point_kinds[source_index].isEntryPoint() and
                        export_kind == .cjs and flags[id].wrap == .none)
                    {
                        const exports_ref = symbols.follow(exports_refs[id]);
                        const module_ref = symbols.follow(module_refs[id].?);
                        symbols.get(exports_ref).?.kind = .unbound;
                        symbols.get(module_ref).?.kind = .unbound;
                    } else if (flags[id].force_include_exports_for_entry_point or export_kind != .cjs) {
                        flags[id].needs_exports_variable = true;
                    }

                    // Create the wrapper part for wrapped files. This is needed by a later step.
                    this.createWrapperForFile(
                        flags[id].wrap,
                        // if this one is null, the AST does not need to be wrapped.
                        this.graph.ast.items(.wrapper_ref)[id] orelse continue,
                        &wrapper_part_indices[id],
                        source_index,
                        id,
                    );
                }
            }

            // Step 5: Create namespace exports for every file. This is always necessary
            // for CommonJS files, and is also necessary for other files if they are
            // imported using an import star statement.
            // Note: `do` will wait for all to finish before moving forward
            try this.parse_graph.pool.pool.do(this.allocator, &this.wait_group, this, doStep5, this.graph.reachable_files);
        }
        // Step 6: Bind imports to exports. This adds non-local dependencies on the
        // parts that declare the export to all parts that use the import. Also
        // generate wrapper parts for wrapped files.
        {
            const bufPrint = std.fmt.bufPrint;
            var parts_list: []js_ast.Part.List = this.graph.ast.items(.parts);
            var wrapper_refs = this.graph.ast.items(.wrapper_ref);
            // const needs_export_symbol_from_runtime: []const bool = this.graph.meta.items(.needs_export_symbol_from_runtime);
            var imports_to_bind_list: []RefImportData = this.graph.meta.items(.imports_to_bind);
            var runtime_export_symbol_ref: Ref = Ref.None;
            var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
            const flags: []const JSMeta.Flags = this.graph.meta.items(.flags);
            const exports_kind = this.graph.ast.items(.exports_kind);
            const exports_refs = this.graph.ast.items(.exports_ref);
            const module_refs = this.graph.ast.items(.module_ref);
            const named_imports = this.graph.ast.items(.named_imports);
            const import_records_list = this.graph.ast.items(.import_records);
            const export_star_import_records = this.graph.ast.items(.export_star_import_records);
            for (reachable) |source_index_| {
                const source_index = source_index_.get();
                const id = source_index;
                if (id >= max_id) {
                    continue;
                }

                const is_entry_point = entry_point_kinds[source_index].isEntryPoint();
                const aliases = this.graph.meta.items(.sorted_and_filtered_export_aliases)[id];
                const flag = flags[id];
                const wrap = flag.wrap;
                const export_kind = exports_kind[id];
                const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];

                const exports_ref = exports_refs[id];
                var exports_symbol: ?*js_ast.Symbol = if (exports_ref.isValid())
                    this.graph.symbols.get(exports_ref)
                else
                    null;
                const module_ref = module_refs[id] orelse Ref.None;
                var module_symbol: ?*js_ast.Symbol = if (module_ref.isValid())
                    this.graph.symbols.get(module_ref)
                else
                    null;

                // TODO: see if counting and batching into a single large allocation instead of per-file improves perf
                const string_buffer_len: usize = brk: {
                    var count: usize = 0;
                    if (is_entry_point and this.options.output_format == .esm) {
                        for (aliases) |alias| {
                            count += std.fmt.count("{}", .{strings.fmtIdentifier(alias)});
                        }
                        count *= "export_".len;
                    }

                    var ident_fmt_len: usize = 0;
                    if (wrap == .esm or (wrap != .cjs and export_kind != .cjs)) {
                        ident_fmt_len += if (source.identifier_name.len > 0)
                            source.identifier_name.len
                        else
                            std.fmt.count("{}", .{source.fmtIdentifier()});
                    }

                    if (wrap == .esm) {
                        count += "init_".len + ident_fmt_len;
                    }

                    if (wrap != .cjs and export_kind != .cjs) {
                        count += "exports_".len + ident_fmt_len;
                        count += "module_".len + ident_fmt_len;
                    }

                    break :brk count;
                };

                var string_buffer = this.allocator.alloc(u8, string_buffer_len) catch unreachable;
                var buf = string_buffer;

                defer std.debug.assert(buf.len == 0); // ensure we used all of it

                // Pre-generate symbols for re-exports CommonJS symbols in case they
                // are necessary later. This is done now because the symbols map cannot be
                // mutated later due to parallelism.
                if (is_entry_point and this.options.output_format == .esm) {
                    var copies = this.allocator.alloc(Ref, aliases.len) catch unreachable;

                    for (aliases) |alias, i| {
                        const original_name = bufPrint(buf, "export_{}", .{strings.fmtIdentifier(alias)}) catch unreachable;
                        buf = buf[original_name.len..];
                        copies[i] = this.graph.generateNewSymbol(source_index, .other, original_name);
                    }
                    this.graph.meta.items(.cjs_export_copies)[id] = copies;
                }

                // Use "init_*" for ESM wrappers instead of "require_*"
                if (wrap == .esm) {
                    const original_name = bufPrint(
                        buf,
                        "init_{}",
                        .{
                            source.fmtIdentifier(),
                        },
                    ) catch unreachable;

                    buf = buf[original_name.len..];
                    this.graph.symbols.get(wrapper_refs[id].?).?.original_name = original_name;
                }

                // If this isn't CommonJS, then rename the unused "exports" and "module"
                // variables to avoid them causing the identically-named variables in
                // actual CommonJS files from being renamed. This is purely about
                // aesthetics and is not about correctness. This is done here because by
                // this point, we know the CommonJS status will not change further.
                if (wrap != .cjs and export_kind != .cjs) {
                    const exports_name = bufPrint(buf, "exports_{s}", .{source.fmtIdentifier()}) catch unreachable;
                    buf = buf[exports_name.len..];
                    const module_name = bufPrint(buf, "module_{s}", .{source.fmtIdentifier()}) catch unreachable;
                    buf = buf[module_name.len..];
                    if (exports_symbol != null)
                        exports_symbol.?.original_name = exports_name;
                    if (module_symbol != null)
                        module_symbol.?.original_name = module_name;
                }

                // Include the "__export" symbol from the runtime if it was used in the
                // previous step. The previous step can't do this because it's running in
                // parallel and can't safely mutate the "importsToBind" map of another file.
                if (flag.needs_exports_variable) {
                    if (!runtime_export_symbol_ref.isValid()) {
                        runtime_export_symbol_ref = this.graph.ast.items(.module_scope)[Index.runtime.get()].?.members.get("__export").?.ref;
                    }

                    std.debug.assert(runtime_export_symbol_ref.isValid());

                    this.graph.generateSymbolImportAndUse(
                        id,
                        js_ast.namespace_export_part_index,
                        runtime_export_symbol_ref,
                        1,
                        Index.runtime,
                    ) catch unreachable;
                }

                var imports_to_bind = imports_to_bind_list[id];
                var imports_to_bind_iter = imports_to_bind.iterator();

                var parts: []js_ast.Part = parts_list[id].slice();
                while (imports_to_bind_iter.next()) |import| {
                    const import_source_index = import.value_ptr.data.source_index.get();
                    const import_id = import_source_index;

                    const import_ref = import.key_ptr.*;
                    var named_import = named_imports[import_id].getPtr(import_ref) orelse continue;
                    const parts_declaring_symbol = this.topLevelSymbolsToParts(import_id, import_ref);

                    for (named_import.local_parts_with_uses.slice()) |part_index| {
                        var part: *js_ast.Part = &parts[part_index];

                        part.dependencies.ensureUnusedCapacity(
                            this.allocator,
                            parts_declaring_symbol.len + @as(usize, import.value_ptr.re_exports.len),
                        ) catch unreachable;

                        // Depend on the file containing the imported symbol
                        for (parts_declaring_symbol) |resolved_part_index| {
                            part.dependencies.appendAssumeCapacity(
                                .{
                                    .source_index = Index.source(import_source_index),
                                    .part_index = resolved_part_index,
                                },
                            );
                        }

                        // Also depend on any files that re-exported this symbol in between the
                        // file containing the import and the file containing the imported symbol
                        part.dependencies.appendSliceAssumeCapacity(import.value_ptr.re_exports.slice());
                    }

                    // Merge these symbols so they will share the same name
                    _ = this.graph.symbols.merge(import_ref, import.value_ptr.data.import_ref);
                }

                // If this is an entry point, depend on all exports so they are included
                if (is_entry_point) {
                    const force_include_exports = flag.force_include_exports_for_entry_point;
                    const add_wrapper = wrap != .none;
                    var dependencies = std.ArrayList(js_ast.Dependency).initCapacity(
                        this.allocator,
                        @as(usize, @boolToInt(force_include_exports)) + @as(usize, @boolToInt(add_wrapper)),
                    ) catch unreachable;
                    var resolved_exports_list: *RefExportData = &this.graph.meta.items(.resolved_exports)[id];
                    for (aliases) |alias| {
                        var export_ = resolved_exports_list.get(alias).?;
                        var target_source_index = export_.data.source_index.get();
                        var target_id = target_source_index;
                        var target_ref = export_.data.import_ref;

                        // If this is an import, then target what the import points to

                        if (imports_to_bind.get(target_ref)) |import_data| {
                            target_source_index = import_data.data.source_index.get();
                            target_id = target_source_index;
                            target_ref = import_data.data.import_ref;
                            dependencies.appendSlice(import_data.re_exports.slice()) catch unreachable;
                        }

                        const top_to_parts = this.topLevelSymbolsToParts(target_id, target_ref);
                        dependencies.ensureUnusedCapacity(top_to_parts.len) catch unreachable;
                        // Pull in all declarations of this symbol
                        for (top_to_parts) |part_index| {
                            dependencies.appendAssumeCapacity(
                                .{
                                    .source_index = Index.source(target_source_index),
                                    .part_index = part_index,
                                },
                            );
                        }
                    }

                    dependencies.ensureUnusedCapacity(@as(usize, @boolToInt(force_include_exports)) + @as(usize, @boolToInt(add_wrapper))) catch unreachable;

                    // Ensure "exports" is included if the current output format needs it
                    if (force_include_exports) {
                        dependencies.appendAssumeCapacity(
                            .{ .source_index = Index.source(source_index), .part_index = js_ast.namespace_export_part_index },
                        );
                    }

                    if (add_wrapper) {
                        dependencies.appendAssumeCapacity(
                            .{
                                .source_index = Index.source(source_index),
                                .part_index = this.graph.meta.items(.wrapper_part_index)[id].get(),
                            },
                        );
                    }

                    // Represent these constraints with a dummy part
                    const entry_point_part_index = this.graph.addPartToFile(
                        id,
                        .{
                            .dependencies = js_ast.Dependency.List.fromList(dependencies),
                            .can_be_removed_if_unused = false,
                        },
                    ) catch unreachable;
                    parts = parts_list[id].slice();
                    this.graph.meta.items(.entry_point_part_index)[id] = Index.part(entry_point_part_index);

                    // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
                    if (force_include_exports) {
                        this.graph.generateRuntimeSymbolImportAndUse(
                            source_index,
                            Index.part(entry_point_part_index),
                            "__toCommonJS",
                            1,
                        ) catch unreachable;
                    }
                }

                // Encode import-specific constraints in the dependency graph
                var import_records = import_records_list[id].slice();
                debug("Binding {d} imports for file {s} (#{d})", .{ import_records.len, source.path.text, id });

                for (parts) |*part, part_index| {
                    var to_esm_uses: u32 = 0;
                    var to_common_js_uses: u32 = 0;
                    var runtime_require_uses: u32 = 0;

                    for (part.import_record_indices.slice()) |import_record_index| {
                        var record = &import_records[import_record_index];
                        const kind = record.kind;

                        // Don't follow external imports (this includes import() expressions)
                        if (!record.source_index.isValid() or this.isExternalDynamicImport(record, source_index)) {
                            // This is an external import. Check if it will be a "require()" call.
                            if (kind == .require or !output_format.keepES6ImportExportSyntax() or
                                (kind == .dynamic))
                            {
                                // We should use "__require" instead of "require" if we're not
                                // generating a CommonJS output file, since it won't exist otherwise
                                if (shouldCallRuntimeRequire(output_format)) {
                                    record.calls_runtime_require = true;
                                    runtime_require_uses += 1;
                                }

                                // If this wasn't originally a "require()" call, then we may need
                                // to wrap this in a call to the "__toESM" wrapper to convert from
                                // CommonJS semantics to ESM semantics.
                                //
                                // Unfortunately this adds some additional code since the conversion
                                // is somewhat complex. As an optimization, we can avoid this if the
                                // following things are true:
                                //
                                // - The import is an ES module statement (e.g. not an "import()" expression)
                                // - The ES module namespace object must not be captured
                                // - The "default" and "__esModule" exports must not be accessed
                                //
                                if (kind != .require and
                                    (kind != .stmt or
                                    record.contains_import_star or
                                    record.contains_default_alias or
                                    record.contains_es_module_alias))
                                {
                                    record.wrap_with_to_esm = true;
                                    to_esm_uses += 1;
                                }
                            }
                            continue;
                        }

                        const other_source_index = record.source_index.get();
                        const other_id = other_source_index;
                        std.debug.assert(@intCast(usize, other_id) < this.graph.meta.len);

                        const other_export_kind = exports_kind[other_id];

                        switch (wrap) {
                            else => {

                                // Depend on the automatically-generated require wrapper symbol
                                const wrapper_ref = wrapper_refs[other_id].?;
                                this.graph.generateSymbolImportAndUse(
                                    source_index,
                                    @intCast(u32, part_index),
                                    wrapper_ref,
                                    1,
                                    Index.source(other_source_index),
                                ) catch unreachable;

                                // This is an ES6 import of a CommonJS module, so it needs the
                                // "__toESM" wrapper as long as it's not a bare "require()"
                                if (kind != .require and other_export_kind == .cjs) {
                                    record.wrap_with_to_esm = true;
                                    to_esm_uses += 1;
                                }
                            },
                            .none => {
                                if (kind == .stmt and other_export_kind == .esm_with_dynamic_fallback) {
                                    // This is an import of a module that has a dynamic export fallback
                                    // object. In that case we need to depend on that object in case
                                    // something ends up needing to use it later. This could potentially
                                    // be omitted in some cases with more advanced analysis if this
                                    // dynamic export fallback object doesn't end up being needed.
                                    this.graph.generateSymbolImportAndUse(
                                        source_index,
                                        @intCast(u32, part_index),
                                        this.graph.ast.items(.exports_ref)[other_id],
                                        1,
                                        Index.source(other_source_index),
                                    ) catch unreachable;
                                }
                            },
                        }
                    }

                    // If there's an ES6 import of a non-ES6 module, then we're going to need the
                    // "__toESM" symbol from the runtime to wrap the result of "require()"
                    this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),

                        // TODO: implement this runtime symbol
                        "__toESM",
                        to_esm_uses,
                    ) catch unreachable;

                    // If there's a CommonJS require of an ES6 module, then we're going to need the
                    // "__toCommonJS" symbol from the runtime to wrap the exports object
                    this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),
                        "__toCommonJS",
                        to_common_js_uses,
                    ) catch unreachable;

                    // If there are unbundled calls to "require()" and we're not generating
                    // code for node, then substitute a "__require" wrapper for "require".
                    this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),

                        // TODO: refactor this runtime symbol
                        "__require",
                        runtime_require_uses,
                    ) catch unreachable;

                    // If there's an ES6 export star statement of a non-ES6 module, then we're
                    // going to need the "__reExport" symbol from the runtime
                    var re_export_uses: u32 = 0;

                    for (export_star_import_records[id]) |import_record_index| {
                        var record = &import_records[import_record_index];

                        var happens_at_runtime = record.source_index.isInvalid() and (!is_entry_point or !output_format.keepES6ImportExportSyntax());
                        if (record.source_index.isValid()) {
                            var other_source_index = record.source_index.get();
                            const other_id = other_source_index;
                            std.debug.assert(@intCast(usize, other_id) < this.graph.meta.len);
                            const other_export_kind = exports_kind[other_id];
                            if (other_source_index != source_index and other_export_kind.isDynamic()) {
                                happens_at_runtime = true;
                            }

                            if (other_export_kind == .esm_with_dynamic_fallback) {
                                // This looks like "__reExport(exports_a, exports_b)". Make sure to
                                // pull in the "exports_b" symbol into this export star. This matters
                                // in code splitting situations where the "export_b" symbol might live
                                // in a different chunk than this export star.
                                this.graph.generateSymbolImportAndUse(
                                    source_index,
                                    @intCast(u32, part_index),
                                    this.graph.ast.items(.exports_ref)[other_id],
                                    1,
                                    Index.source(other_source_index),
                                ) catch unreachable;
                            }
                        }

                        if (happens_at_runtime) {
                            // Depend on this file's "exports" object for the first argument to "__reExport"
                            this.graph.generateSymbolImportAndUse(
                                source_index,
                                @intCast(u32, part_index),
                                this.graph.ast.items(.exports_ref)[id],
                                1,
                                Index.source(source_index),
                            ) catch unreachable;
                            this.graph.ast.items(.uses_exports_ref)[id] = true;
                            record.calls_runtime_re_export_fn = true;
                            re_export_uses += 1;
                        }
                    }

                    this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(part_index),

                        "__reExport",
                        re_export_uses,
                    ) catch unreachable;
                }
            }
        }
    }

    pub fn createExportsForFile(c: *LinkerContext, allocator_: std.mem.Allocator, id: u32, resolved_exports: *RefExportData, imports_to_bind: []RefImportData, export_aliases: []const string, re_exports_count: usize) void {
        ////////////////////////////////////////////////////////////////////////////////
        // WARNING: This method is run in parallel over all files. Do not mutate data
        // for other files within this method or you will create a data race.
        ////////////////////////////////////////////////////////////////////////////////

        // 1 property per export
        var properties = std.ArrayList(js_ast.G.Property)
            .initCapacity(allocator_, export_aliases.len) catch unreachable;

        var ns_export_symbol_uses = js_ast.Part.SymbolUseMap{};
        ns_export_symbol_uses.ensureTotalCapacity(allocator_, export_aliases.len) catch unreachable;

        const needs_exports_variable = c.graph.meta.items(.flags)[id].needs_exports_variable;

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
        var ns_export_dependencies = std.ArrayList(js_ast.Dependency).initCapacity(allocator_, re_exports_count) catch unreachable;

        for (export_aliases) |alias| {
            var export_ = resolved_exports.getPtr(alias).?;

            const other_id = export_.data.source_index.get();

            // If this is an export of an import, reference the symbol that the import
            // was eventually resolved to. We need to do this because imports have
            // already been resolved by this point, so we can't generate a new import
            // and have that be resolved later.
            if (imports_to_bind[other_id].get(export_.data.import_ref)) |import_data| {
                export_.data = import_data.data;
                ns_export_dependencies.appendSlice(import_data.re_exports.slice()) catch unreachable;
            }

            // Exports of imports need EImportIdentifier in case they need to be re-
            // written to a property access later on
            // note: this is stack allocated
            var value: js_ast.Expr = undefined;
            if (c.graph.symbols.getConst(export_.data.import_ref).?.namespace_alias != null) {
                value = js_ast.Expr.init(
                    js_ast.E.ImportIdentifier,
                    js_ast.E.ImportIdentifier{
                        .ref = export_.data.import_ref,
                    },
                    loc,
                );
            } else {
                value = js_ast.Expr.init(
                    js_ast.E.Identifier,
                    js_ast.E.Identifier{
                        .ref = export_.data.import_ref,
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
                            .data = alias,
                        },
                        loc,
                    ),
                    .value = js_ast.Expr.init(
                        js_ast.E.Arrow,
                        .{ .prefer_expr = true, .body = fn_body },
                        loc,
                    ),
                },
            );
            ns_export_symbol_uses.putAssumeCapacity(export_.data.import_ref, .{ .count_estimate = 1 });

            // Make sure the part that declares the export is included
            const parts = c.topLevelSymbolsToParts(other_id, export_.data.import_ref);
            ns_export_dependencies.ensureUnusedCapacity(parts.len) catch unreachable;
            var ptr = ns_export_dependencies.items.ptr + ns_export_dependencies.items.len;
            ns_export_dependencies.items.len += parts.len;

            for (parts) |part_id| {
                // Use a non-local dependency since this is likely from a different
                // file if it came in through an export star
                ptr[0] = .{
                    .source_index = export_.data.source_index,
                    .part_index = part_id,
                };
                ptr += 1;
            }
        }

        var declared_symbols = js_ast.DeclaredSymbol.List{};
        var exports_ref = c.graph.ast.items(.exports_ref)[id];
        var export_stmts: []js_ast.Stmt = stmts.head;
        std.debug.assert(stmts.head.len <= 2); // assert we allocated exactly the right amount
        stmts.head.len = 0;

        // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
        if (needs_exports_variable) {
            var decls = allocator_.alloc(js_ast.G.Decl, 1) catch unreachable;
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
            export_ref = c.graph.ast.items(.module_scope)[Index.runtime.get()].?.members.get("__export").?.ref;
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
                            .args = js_ast.ExprNodeList.init(args),
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
                    .{ .source_index = Index.runtime, .part_index = part_index },
                );
            }

            // Make sure the CommonJS closure, if there is one, includes "exports"
            c.graph.ast.items(.uses_exports_ref)[id] = true;
        }

        // No need to generate a part if it'll be empty
        if (export_stmts.len > 0) {
            // - we must already have preallocated the parts array
            // - if the parts list is completely empty, we shouldn't have gotten here in the first place

            // Initialize the part that was allocated for us earlier. The information
            // here will be used after this during tree shaking.
            c.graph.ast.items(.parts)[id].slice()[js_ast.namespace_export_part_index] = .{
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
                c.graph.meta.items(.flags)[id].needs_export_symbol_from_runtime = true;
            }
        }
    }

    /// Step 5: Create namespace exports for every file. This is always necessary
    /// for CommonJS files, and is also necessary for other files if they are
    /// imported using an import star statement.
    pub fn doStep5(c: *LinkerContext, source_index_: Index, _: usize) void {
        const source_index = source_index_.get();

        const id = source_index;
        if (id > c.graph.meta.len) return;

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
        var probably_typescript_type = c.graph.meta.items(.probably_typescript_type);

        // counting in here saves us an extra pass through the array
        var re_exports_count: usize = 0;

        next_alias: while (alias_iter.next()) |entry| {
            var export_ = entry.value_ptr.*;
            var alias = entry.key_ptr.*;
            const this_id = export_.data.source_index.get();
            var inner_count: usize = 0;
            // Re-exporting multiple symbols with the same name causes an ambiguous
            // export. These names cannot be used and should not end up in generated code.
            if (export_.potentially_ambiguous_export_star_refs.len > 0) {
                const main = imports_to_bind[this_id].get(export_.data.import_ref) orelse ImportData{ .data = export_.data };
                for (export_.potentially_ambiguous_export_star_refs.slice()) |ambig| {
                    const _id = ambig.data.source_index.get();
                    const ambig_ref = if (imports_to_bind[_id].get(ambig.data.import_ref)) |bound|
                        bound.data.import_ref
                    else
                        ambig.data.import_ref;
                    if (!main.data.import_ref.eql(ambig_ref)) {
                        continue :next_alias;
                    }
                    inner_count += @as(usize, ambig.re_exports.len);
                }
            }

            // Ignore re-exported imports in TypeScript files that failed to be
            // resolved. These are probably just type-only imports so the best thing to
            // do is to silently omit them from the export list.
            if (probably_typescript_type[this_id].contains(export_.data.import_ref)) {
                continue;
            }
            re_exports_count += inner_count;

            aliases.appendAssumeCapacity(alias);
        }
        // TODO: can this be u32 instead of a string?
        // if yes, we could just move all the hidden exports to the end of the array
        // and only store a count instead of an array
        strings.sortDesc(aliases.items);
        const export_aliases = aliases.toOwnedSlice() catch unreachable;
        c.graph.meta.items(.sorted_and_filtered_export_aliases)[id] = export_aliases;

        // Export creation uses "sortedAndFilteredExportAliases" so this must
        // come second after we fill in that array
        c.createExportsForFile(
            allocator_,
            id,
            resolved_exports,
            imports_to_bind,
            export_aliases,
            re_exports_count,
        );

        // Each part tracks the other parts it depends on within this file
        var local_dependencies = std.AutoHashMap(u32, u32).init(allocator_);
        defer local_dependencies.deinit();
        var parts = &c.graph.ast.items(.parts)[id];
        var parts_slice: []js_ast.Part = parts.slice();
        var named_imports: *js_ast.Ast.NamedImports = &c.graph.ast.items(.named_imports)[id];
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
                        part.dependencies.push(
                            allocator_,
                            .{
                                .source_index = Index.source(source_index),
                                .part_index = other_part_index,
                            },
                        ) catch unreachable;
                    }
                }

                // Also map from imports to parts that use them
                if (named_imports.getPtr(ref)) |existing| {
                    existing.local_parts_with_uses.push(allocator_, @intCast(u32, part_index)) catch unreachable;
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
            probably_typescript_type,

            /// The import resolved to multiple symbols via "export * from"
            ambiguous,
        };
    };
    pub fn source_(c: *LinkerContext, index: anytype) *const Logger.Source {
        return &c.parse_graph.input_files.items(.source)[index];
    }

    pub fn treeShakingAndCodeSplitting(c: *LinkerContext) !void {
        var parts = c.graph.ast.items(.parts);
        var import_records = c.graph.ast.items(.import_records);
        var side_effects = c.parse_graph.input_files.items(.side_effects);
        var entry_point_kinds = c.graph.files.items(.entry_point_kind);
        const entry_points = c.graph.entry_points.items(.source_index);
        var distances = c.graph.files.items(.distance_from_entry_point);

        // Tree shaking: Each entry point marks all files reachable from itself
        for (entry_points) |entry_point| {
            c.markFileLiveForTreeShaking(
                entry_point,
                side_effects,
                parts,
                import_records,
                entry_point_kinds,
            );
        }

        var file_entry_bits: []AutoBitSet = c.graph.files.items(.entry_bits);
        // AutoBitSet needs to be initialized if it is dynamic
        if (AutoBitSet.needsDynamic(entry_points.len)) {
            for (file_entry_bits) |*bits| {
                bits.* = try AutoBitSet.initEmpty(c.allocator, entry_points.len);
            }
        } else if (file_entry_bits.len > 0) {
            // assert that the tag is correct
            std.debug.assert(file_entry_bits[0] == .static);
        }

        // Code splitting: Determine which entry points can reach which files. This
        // has to happen after tree shaking because there is an implicit dependency
        // between live parts within the same file. All liveness has to be computed
        // first before determining which entry points can reach which files.
        for (entry_points) |entry_point, i| {
            c.markFileReachableForCodeSplitting(
                entry_point,
                i,
                distances,
                0,
                parts,
                import_records,
                file_entry_bits,
            );
        }
    }

    pub noinline fn computeCrossChunkDependencies(c: *LinkerContext, chunks: []Chunk) !void {
        var js_chunks_count: usize = 0;
        for (chunks) |*chunk| {
            js_chunks_count += @boolToInt(chunk.content == .javascript);
        }

        // TODO: remove this branch before release. We are keeping it to assert this code is correct
        if (comptime !Environment.allow_assert) {
            // No need to compute cross-chunk dependencies if there can't be any
            if (js_chunks_count < 2)
                return;
        }

        const ChunkMeta = struct {
            imports: std.ArrayHashMap(Ref, void, Ref.ArrayHashCtx, false),
            exports: std.ArrayHashMap(Ref, void, Ref.ArrayHashCtx, false),
            dynamic_imports: std.AutoArrayHashMap(Index.Int, void),
        };
        var chunk_metas = try c.allocator.alloc(ChunkMeta, chunks.len);
        for (chunk_metas) |*meta| {
            // these must be global allocator
            meta.* = comptime ChunkMeta{
                .imports = std.ArrayHashMap(Ref, void, Ref.ArrayHashCtx, false).init(bun.default_allocator),
                .exports = std.ArrayHashMap(Ref, void, Ref.ArrayHashCtx, false).init(bun.default_allocator),
                .dynamic_imports = std.AutoArrayHashMap(Index.Int, void).init(bun.default_allocator),
            };
        }
        defer {
            for (chunk_metas) |*meta| {
                meta.imports.deinit();
                meta.exports.deinit();
                meta.dynamic_imports.deinit();
            }
            c.allocator.free(chunk_metas);
        }

        const CrossChunkDependencies = struct {
            chunk_meta: []ChunkMeta,
            chunks: []Chunk,
            parts: []BabyList(js_ast.Part),
            import_records: []BabyList(bun.ImportRecord),
            flags: []const JSMeta.Flags,
            entry_point_chunk_indices: []Index.Int,
            imports_to_bind: []RefImportData,
            wrapper_refs: []const ?Ref,
            sorted_and_filtered_export_aliases: []const []const string,
            resolved_exports: []const RefExportData,
            ctx: *LinkerContext,
            symbols: *Symbol.Map,

            pub fn walk(deps: *@This(), chunk: *Chunk, chunk_index: usize) void {
                var chunk_meta = &deps.chunk_meta[chunk_index];
                const entry_point_chunk_indices = deps.entry_point_chunk_indices;

                // Go over each file in this chunk
                for (chunk.files_with_parts_in_chunk.keys()) |source_index| {
                    if (chunk.content != .javascript) continue;

                    // Go over each part in this file that's marked for inclusion in this chunk
                    var parts = deps.parts[source_index].slice();
                    var import_records = deps.import_records[source_index].slice();
                    const imports_to_bind = deps.imports_to_bind[source_index];
                    const wrap = deps.flags[source_index].wrap;
                    const wrapper_ref = deps.wrapper_refs[source_index].?;
                    var _chunks = deps.chunks;

                    for (parts) |*part| {
                        if (!part.is_live)
                            continue;

                        // Rewrite external dynamic imports to point to the chunk for that entry point
                        for (part.import_record_indices.slice()) |import_record_id| {
                            var import_record = &import_records[import_record_id];
                            if (import_record.source_index.isValid() and deps.ctx.isExternalDynamicImport(import_record, source_index)) {
                                const other_chunk_index = entry_point_chunk_indices[import_record.source_index.get()];
                                import_record.path.text = _chunks[other_chunk_index].unique_key;
                                import_record.source_index = Index.invalid;

                                // Track this cross-chunk dynamic import so we make sure to
                                // include its hash when we're calculating the hashes of all
                                // dependencies of this chunk.
                                if (other_chunk_index != chunk_index)
                                    chunk_meta.dynamic_imports.put(other_chunk_index, void{}) catch unreachable;
                            }
                        }

                        // Remember what chunk each top-level symbol is declared in. Symbols
                        // with multiple declarations such as repeated "var" statements with
                        // the same name should already be marked as all being in a single
                        // chunk. In that case this will overwrite the same value below which
                        // is fine.
                        deps.symbols.assignChunkIndex(part.declared_symbols, @truncate(u32, chunk_index));

                        for (part.symbol_uses.keys()) |ref_| {
                            var ref = ref_;
                            var symbol = deps.symbols.get(ref).?;

                            // Ignore unbound symbols
                            if (symbol.kind == .unbound)
                                continue;

                            // Ignore symbols that are going to be replaced by undefined
                            if (symbol.import_item_status == .missing) {
                                continue;
                            }

                            // If this is imported from another file, follow the import
                            // reference and reference the symbol in that file instead
                            if (imports_to_bind.get(ref)) |import_data| {
                                ref = import_data.data.import_ref;
                                symbol = deps.symbols.get(ref).?;
                            } else if (wrap == .cjs and ref.eql(wrapper_ref)) {
                                // The only internal symbol that wrapped CommonJS files export
                                // is the wrapper itself.
                                continue;
                            }

                            // If this is an ES6 import from a CommonJS file, it will become a
                            // property access off the namespace symbol instead of a bare
                            // identifier. In that case we want to pull in the namespace symbol
                            // instead. The namespace symbol stores the result of "require()".
                            if (symbol.namespace_alias) |*namespace_alias| {
                                ref = namespace_alias.namespace_ref;
                            }

                            // We must record this relationship even for symbols that are not
                            // imports. Due to code splitting, the definition of a symbol may
                            // be moved to a separate chunk than the use of a symbol even if
                            // the definition and use of that symbol are originally from the
                            // same source file.
                            chunk_meta.imports.put(ref, void{}) catch unreachable;
                        }
                    }
                }

                // Include the exports if this is an entry point chunk
                if (chunk.content == .javascript) {
                    if (chunk.entry_point.is_entry_point) {
                        const flags = deps.flags[chunk.entry_point.source_index];
                        if (flags.wrap != .cjs) {
                            for (deps.sorted_and_filtered_export_aliases[chunk.entry_point.source_index]) |alias| {
                                const export_ = deps.resolved_exports[chunk.entry_point.source_index].get(alias).?;
                                var target_ref = export_.data.import_ref;

                                // If this is an import, then target what the import points to
                                if (deps.imports_to_bind[export_.data.source_index.get()].get(target_ref)) |import_data| {
                                    target_ref = import_data.data.import_ref;
                                }

                                // If this is an ES6 import from a CommonJS file, it will become a
                                // property access off the namespace symbol instead of a bare
                                // identifier. In that case we want to pull in the namespace symbol
                                // instead. The namespace symbol stores the result of "require()".
                                if (deps.symbols.get(target_ref).?.namespace_alias) |namespace_alias| {
                                    target_ref = namespace_alias.namespace_ref;
                                }

                                chunk_meta.imports.put(target_ref, void{}) catch unreachable;
                            }
                        }

                        // Ensure "exports" is included if the current output format needs it
                        if (flags.force_include_exports_for_entry_point) {
                            chunk_meta.imports.put(deps.wrapper_refs[chunk.entry_point.source_index].?, void{}) catch unreachable;
                        }

                        // Include the wrapper if present
                        if (flags.wrap != .none) {
                            chunk_meta.imports.put(deps.wrapper_refs[chunk.entry_point.source_index].?, void{}) catch unreachable;
                        }
                    }
                }
            }
        };

        var cross_chunk_dependencies = CrossChunkDependencies{
            .chunks = chunks,
            .chunk_meta = chunk_metas,

            .parts = c.graph.ast.items(.parts),
            .import_records = c.graph.ast.items(.import_records),
            .flags = c.graph.meta.items(.flags),
            .entry_point_chunk_indices = c.graph.files.items(.entry_point_chunk_index),
            .imports_to_bind = c.graph.meta.items(.imports_to_bind),
            .wrapper_refs = c.graph.ast.items(.wrapper_ref),
            .sorted_and_filtered_export_aliases = c.graph.meta.items(.sorted_and_filtered_export_aliases),
            .resolved_exports = c.graph.meta.items(.resolved_exports),
            .ctx = c,
            .symbols = &c.graph.symbols,
        };

        try c.parse_graph.pool.pool.doPtr(
            c.allocator,
            &c.wait_group,
            &cross_chunk_dependencies,
            CrossChunkDependencies.walk,
            chunks,
        );

        // Mark imported symbols as exported in the chunk from which they are declared
        for (chunks) |*chunk, chunk_index| {
            if (chunk.content != .javascript) {
                continue;
            }

            var js = &chunk.content.javascript;

            var chunk_meta = &chunk_metas[chunk_index];
            // Find all uses in this chunk of symbols from other chunks
            for (chunk_meta.imports.keys()) |import_ref| {
                const symbol = c.graph.symbols.get(import_ref).?;

                // Ignore uses that aren't top-level symbols
                if (symbol.chunk_index) |other_chunk_index| {
                    if (@as(usize, other_chunk_index) != chunk_index) {
                        {
                            var entry = try js.imports_from_other_chunks.getOrPutValue(c.allocator, other_chunk_index, .{});
                            try entry.value_ptr.push(c.allocator, .{
                                .ref = import_ref,
                            });
                        }

                        chunk_metas[other_chunk_index].exports.put(import_ref, void{}) catch unreachable;
                    }
                }
            }

            // If this is an entry point, make sure we import all chunks belonging to
            // this entry point, even if there are no imports. We need to make sure
            // these chunks are evaluated for their side effects too.
            if (chunk.entry_point.is_entry_point) {
                for (chunks) |*other_chunk, other_chunk_index| {
                    if (other_chunk_index == chunk_index or other_chunk.content != .javascript) continue;

                    if (other_chunk.entry_bits.isSet(chunk.entry_point.entry_point_id)) {
                        _ = js.imports_from_other_chunks.getOrPutValue(
                            c.allocator,
                            @truncate(u32, other_chunk_index),
                            CrossChunkImport.Item.List{},
                        ) catch unreachable;
                    }
                }
            }

            // Make sure we also track dynamic cross-chunk imports. These need to be
            // tracked so we count them as dependencies of this chunk for the purpose
            // of hash calculation.
            if (chunk_meta.dynamic_imports.count() > 0) {
                var dynamic_chunk_indices = chunk_meta.dynamic_imports.keys();
                std.sort.sort(Index.Int, dynamic_chunk_indices, void{}, std.sort.asc(Index.Int));

                var list = chunk.cross_chunk_imports.listManaged(c.allocator);
                defer chunk.cross_chunk_imports.update(list);
                try list.ensureTotalCapacity(dynamic_chunk_indices.len);
                for (dynamic_chunk_indices) |dynamic_chunk_index| {
                    list.appendAssumeCapacity(
                        .{
                            .import_kind = .dynamic,
                            .chunk_index = dynamic_chunk_index,
                        },
                    );
                }
            }
        }

        // Generate cross-chunk exports. These must be computed before cross-chunk
        // imports because of export alias renaming, which must consider all export
        // aliases simultaneously to avoid collisions.
        {
            var chunk_metas_ptr = chunk_metas.ptr;
            std.debug.assert(chunk_metas.len == chunks.len);
            var r = renamer.ExportRenamer.init(c.allocator);
            defer r.deinit();

            var stable_ref_list = std.ArrayList(StableRef).init(c.allocator);
            defer stable_ref_list.deinit();

            for (chunks) |*chunk| {
                var chunk_meta = chunk_metas_ptr[0];
                chunk_metas_ptr += 1;

                if (chunk.content != .javascript) continue;

                var repr = &chunk.content.javascript;

                switch (c.options.output_format) {
                    .esm => {
                        stable_ref_list = c.sortedCrossChunkExportItems(chunk_meta.exports, stable_ref_list);
                        var clause_items = BabyList(js_ast.ClauseItem).initCapacity(c.allocator, stable_ref_list.items.len) catch unreachable;
                        for (stable_ref_list.items) |stable_ref| {
                            r.clearRetainingCapacity();
                            const alias = r.nextRenamedName(c.graph.symbols.get(stable_ref.ref).?.original_name);

                            clause_items.appendAssumeCapacity(
                                .{
                                    .name = .{
                                        .ref = stable_ref.ref,
                                        .loc = Logger.Loc.Empty,
                                    },
                                    .alias = alias,
                                    .alias_loc = Logger.Loc.Empty,
                                    .original_name = "",
                                },
                            );
                            repr.exports_to_other_chunks.put(
                                c.allocator,
                                stable_ref.ref,
                                alias,
                            ) catch unreachable;
                        }

                        if (clause_items.len > 0) {
                            var stmts = BabyList(js_ast.Stmt).initCapacity(c.allocator, 1) catch unreachable;
                            var export_clause = c.allocator.create(js_ast.S.ExportClause) catch unreachable;
                            export_clause.* = .{
                                .items = clause_items.slice(),
                                .is_single_line = false,
                            };
                            stmts.appendAssumeCapacity(.{
                                .data = .{
                                    .s_export_clause = export_clause,
                                },
                                .loc = Logger.Loc.Empty,
                            });
                            repr.cross_chunk_suffix_stmts = stmts;
                        }
                    },
                    else => bun.unreachablePanic("Unexpected output format", .{}),
                }
            }
        }

        // Generate cross-chunk imports. These must be computed after cross-chunk
        // exports because the export aliases must already be finalized so they can
        // be embedded in the generated import statements.
        {
            var list = CrossChunkImport.List.init(c.allocator);
            defer list.deinit();

            var cross_chunk_prefix_stmts = BabyList(js_ast.Stmt){};

            for (chunks) |*chunk| {
                if (chunk.content != .javascript) continue;
                var repr = &chunk.content.javascript;

                list.clearRetainingCapacity();
                CrossChunkImport.sortedCrossChunkImports(&list, chunks, &repr.imports_from_other_chunks) catch unreachable;
                var cross_chunk_imports: []CrossChunkImport = list.items;
                for (cross_chunk_imports) |cross_chunk_import| {
                    switch (c.options.output_format) {
                        .esm => {
                            const import_record_index = @truncate(u32, chunk.cross_chunk_imports.len);

                            var clauses = std.ArrayList(js_ast.ClauseItem).initCapacity(c.allocator, cross_chunk_import.sorted_import_items.len) catch unreachable;
                            for (cross_chunk_import.sorted_import_items.slice()) |item| {
                                clauses.appendAssumeCapacity(.{
                                    .name = .{
                                        .ref = item.ref,
                                        .loc = Logger.Loc.Empty,
                                    },
                                    .alias = item.export_alias,
                                    .alias_loc = Logger.Loc.Empty,
                                });
                            }

                            chunk.cross_chunk_imports.push(c.allocator, .{
                                .import_kind = .stmt,
                                .chunk_index = cross_chunk_import.chunk_index,
                            }) catch unreachable;

                            var import = c.allocator.create(js_ast.S.Import) catch unreachable;
                            import.* = .{
                                .items = clauses.items,
                                .import_record_index = import_record_index,
                                .namespace_ref = Ref.None,
                            };
                            cross_chunk_prefix_stmts.push(
                                c.allocator,
                                .{
                                    .data = .{
                                        .s_import = import,
                                    },
                                    .loc = Logger.Loc.Empty,
                                },
                            ) catch unreachable;
                        },
                        else => bun.unreachablePanic("Unexpected output format", .{}),
                    }
                }

                repr.cross_chunk_prefix_stmts = cross_chunk_prefix_stmts;
            }
        }
    }

    // Sort cross-chunk exports by chunk name for determinism
    fn sortedCrossChunkExportItems(
        c: *LinkerContext,
        export_refs: RefVoidMapManaged,
        list: std.ArrayList(StableRef),
    ) std.ArrayList(StableRef) {
        var result = list;
        result.clearRetainingCapacity();
        result.ensureTotalCapacity(export_refs.count()) catch unreachable;
        for (export_refs.keys()) |export_ref| {
            result.appendAssumeCapacity(.{
                .stable_source_index = c.graph.stable_source_indices[export_ref.sourceIndex()],
                .ref = export_ref,
            });
        }
        std.sort.sort(StableRef, result.items, void{}, StableRef.isLessThan);
        return result;
    }

    pub fn markFileReachableForCodeSplitting(
        c: *LinkerContext,
        source_index: Index.Int,
        entry_points_count: usize,
        distances: []u32,
        distance: u32,
        parts: []bun.BabyList(js_ast.Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        file_entry_bits: []AutoBitSet,
    ) void {
        if (!c.graph.files_live.isSet(source_index))
            return;

        const cur_dist = distances[source_index];
        const traverse_again = distance < cur_dist;
        if (traverse_again) {
            distances[source_index] = distance;
        }
        const out_dist = distance + 1;

        // Don't mark this file more than once
        if (file_entry_bits[source_index].isSet(entry_points_count) and !traverse_again)
            return;

        file_entry_bits[source_index].set(entry_points_count);

        if (comptime bun.Environment.allow_assert)
            debug(
                "markFileReachableForCodeSplitting: {s} ({d})",
                .{
                    c.parse_graph.input_files.get(source_index).source.path.text,
                    out_dist,
                },
            );

        // TODO: CSS AST

        for (import_records[source_index].slice()) |*record| {
            if (record.source_index.isValid() and !c.isExternalDynamicImport(record, source_index)) {
                c.markFileReachableForCodeSplitting(
                    record.source_index.get(),
                    entry_points_count,
                    distances,
                    out_dist,
                    parts,
                    import_records,
                    file_entry_bits,
                );
            }
        }

        for (parts[source_index].slice()) |*part| {
            for (part.dependencies.slice()) |dependency| {
                if (dependency.source_index.get() != source_index) {
                    c.markFileReachableForCodeSplitting(
                        dependency.source_index.get(),
                        entry_points_count,
                        distances,
                        out_dist,
                        parts,
                        import_records,
                        file_entry_bits,
                    );
                }
            }
        }
    }

    pub fn markFileLiveForTreeShaking(
        c: *LinkerContext,
        source_index: Index.Int,
        side_effects: []_resolver.SideEffects,
        parts: []bun.BabyList(js_ast.Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        entry_point_kinds: []EntryPoint.Kind,
    ) void {
        if (c.graph.files_live.isSet(source_index))
            return;

        c.graph.files_live.set(source_index);
        if (comptime bun.Environment.allow_assert)
            debug("markFileLiveForTreeShaking: {s}", .{c.parse_graph.input_files.get(source_index).source.path.text});

        // TODO: CSS source index

        const id = source_index;
        if (@as(usize, id) >= c.graph.ast.len)
            return;
        var _parts = parts[id].slice();
        for (_parts) |*part, part_index| {
            var can_be_removed_if_unused = part.can_be_removed_if_unused;

            // Also include any statement-level imports
            for (part.import_record_indices.slice()) |import_record_Index| {
                var record: *ImportRecord = &import_records[source_index].slice()[import_record_Index];

                if (record.kind != .stmt)
                    continue;

                if (record.source_index.isValid()) {
                    const other_source_index = record.source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    if (side_effects[other_source_index] != .has_side_effects and !c.options.ignore_dce_annotations) {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    c.markFileLiveForTreeShaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                    );
                } else if (record.is_external_without_side_effects) {
                    // This can be removed if it's unused
                    continue;
                }

                // If we get here then the import was included for its side effects, so
                // we must also keep this part
                can_be_removed_if_unused = false;
            }

            // Include all parts in this file with side effects, or just include
            // everything if tree-shaking is disabled. Note that we still want to
            // perform tree-shaking on the runtime even if tree-shaking is disabled.
            if (!can_be_removed_if_unused or
                (!part.force_tree_shaking and
                !c.options.tree_shaking and
                entry_point_kinds[id].isEntryPoint()))
            {
                _ = c.markPartLiveForTreeShaking(
                    @intCast(u32, part_index),
                    id,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                );
            }
        }
    }

    pub fn markPartLiveForTreeShaking(
        c: *LinkerContext,
        part_index: Index.Int,
        id: Index.Int,
        side_effects: []_resolver.SideEffects,
        parts: []bun.BabyList(js_ast.Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        entry_point_kinds: []EntryPoint.Kind,
    ) bool {
        var part: *js_ast.Part = &parts[id].slice()[part_index];
        // only once
        if (part.is_live) {
            return false;
        }

        part.is_live = true;
        if (comptime bun.Environment.allow_assert)
            debug("markPartLiveForTreeShaking({d}): {s}:{d}", .{ id, c.parse_graph.input_files.get(id).source.path.text, part_index });

        for (part.dependencies.slice()) |dependency| {
            const _id = dependency.source_index.get();
            if (c.markPartLiveForTreeShaking(
                dependency.part_index,
                _id,
                side_effects,
                parts,
                import_records,
                entry_point_kinds,
            )) {
                c.markFileLiveForTreeShaking(
                    _id,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                );
            }
        }

        return true;
    }

    pub fn matchImportWithExport(
        c: *LinkerContext,
        init_tracker: *ImportTracker,
        re_exports: *std.ArrayList(js_ast.Dependency),
    ) MatchImport {
        var tracker = init_tracker;
        var ambiguous_results = std.ArrayList(MatchImport).init(c.allocator);
        defer ambiguous_results.clearAndFree();
        var result: MatchImport = MatchImport{};
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
            // majority of cases have one or two elements
            for (c.cycle_detector.items) |prev_tracker| {
                if (std.meta.eql(tracker.*, prev_tracker)) {
                    result = .{ .kind = .cycle };
                    break :loop;
                }
            }
            c.cycle_detector.append(tracker.*) catch unreachable;

            // Resolve the import by one step
            var advanced = c.advanceImportTracker(tracker);
            const next_tracker = advanced.tracker.*;
            const status = advanced.status;
            const potentially_ambiguous_export_star_refs = advanced.import_data;
            const other_id = tracker.source_index.get();

            switch (status) {
                .cjs, .cjs_without_exports, .disabled, .external => {
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
                    if (status == .cjs_without_exports) {
                        const source = c.source_(tracker.source_index.get());
                        c.log.addRangeWarningFmt(
                            source,
                            source.rangeOfIdentifier(named_import.alias_loc.?),
                            c.allocator,
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
                            c.allocator,
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
                            c.allocator,
                            "No matching export in \"{s}\" for import \"{s}\"",
                            .{
                                next_source.path.pretty,
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    }
                },
                .probably_typescript_type => {
                    // Omit this import from any namespace export code we generate for
                    // import star statements (i.e. "import * as ns from 'path'")
                    result = .{ .kind = .probably_typescript_type };
                },
                .found => {

                    // If there are multiple ambiguous results due to use of "export * from"
                    // statements, trace them all to see if they point to different things.
                    for (potentially_ambiguous_export_star_refs) |*ambiguous_tracker| {
                        // If this is a re-export of another import, follow the import
                        if (named_imports[ambiguous_tracker.data.source_index.get()].contains(ambiguous_tracker.data.import_ref)) {

                            // TODO: not fully confident this will work
                            // test with nested ambiguous re-exports
                            var old_cycle_detector = c.cycle_detector;
                            c.cycle_detector = c.swap_cycle_detector;
                            c.cycle_detector.clearRetainingCapacity();
                            var ambig = c.matchImportWithExport(&ambiguous_tracker.data, re_exports);
                            c.cycle_detector.clearRetainingCapacity();
                            c.swap_cycle_detector = c.cycle_detector;
                            c.cycle_detector = old_cycle_detector;
                            ambiguous_results.append(ambig) catch unreachable;
                        } else {
                            ambiguous_results.append(.{
                                .kind = .normal,
                                .source_index = ambiguous_tracker.data.source_index.get(),
                                .ref = ambiguous_tracker.data.import_ref,
                                .name_loc = ambiguous_tracker.data.name_loc,
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
                        .source_index = next_tracker.source_index.get(),
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
                                    .part_index = dep,
                                    .source_index = tracker.source_index,
                                },
                            );
                        }
                    }

                    // If this is a re-export of another import, continue for another
                    // iteration of the loop to resolve that import as well
                    const next_id = next_tracker.source_index.get();
                    if (named_imports[next_id].contains(next_tracker.import_ref)) {
                        tracker.* = next_tracker;
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
        return if (c.graph.ast.items(.top_level_symbols_to_parts)[id].get(ref)) |list|
            list.slice()
        else
            &[_]u32{};
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
                var dependencies = c.allocator.alloc(js_ast.Dependency, common_js_parts.len) catch unreachable;
                for (common_js_parts) |part, i| {
                    dependencies[i] = .{
                        .part_index = part,
                        .source_index = Index.runtime,
                    };
                }
                const part_index = c.graph.addPartToFile(
                    source_index,
                    .{
                        .stmts = &.{},
                        .symbol_uses = bun.from(
                            js_ast.Part.SymbolUseMap,
                            c.allocator,
                            .{
                                .{ wrapper_ref, .{ .count_estimate = 1 } },
                            },
                        ) catch unreachable,
                        .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(
                            c.allocator,
                            &[_]js_ast.DeclaredSymbol{
                                .{ .ref = c.graph.ast.items(.exports_ref)[id], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.module_ref)[id].?, .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.wrapper_ref)[id].?, .is_top_level = true },
                            },
                        ) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                ) catch unreachable;
                wrapper_part_index.* = Index.part(part_index);
                c.graph.generateSymbolImportAndUse(
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
                var dependencies = c.allocator.alloc(js_ast.Dependency, esm_parts.len) catch unreachable;
                for (esm_parts) |part, i| {
                    dependencies[i] = .{
                        .part_index = part,
                        .source_index = Index.runtime,
                    };
                }

                const part_index = c.graph.addPartToFile(
                    source_index,
                    .{
                        .symbol_uses = bun.from(
                            js_ast.Part.SymbolUseMap,
                            c.allocator,
                            .{
                                .{ wrapper_ref, .{ .count_estimate = 1 } },
                            },
                        ) catch unreachable,
                        .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(c.allocator, &[_]js_ast.DeclaredSymbol{
                            .{ .ref = wrapper_ref, .is_top_level = true },
                        }) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                ) catch unreachable;
                wrapper_part_index.* = Index.part(part_index);
                c.graph.generateSymbolImportAndUse(
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

    pub fn advanceImportTracker(c: *LinkerContext, tracker: *ImportTracker) ImportTracker.Iterator {
        const id = tracker.source_index.get();
        var named_imports: *JSAst.NamedImports = &c.graph.ast.items(.named_imports)[id];
        var import_records = c.graph.ast.items(.import_records)[id];
        const exports_kind: []js_ast.ExportsKind = c.graph.ast.items(.exports_kind);

        const named_import = named_imports.get(tracker.import_ref) orelse
            // TODO: investigate if this is a bug
            // It implies there are imports being added without being resolved
            return .{
            .value = .{},
            .status = .external,
            .tracker = tracker,
        };

        // Is this an external file?
        const record = import_records.at(named_import.import_record_index);
        if (!record.source_index.isValid()) {
            return .{
                .value = .{},
                .status = .external,
                .tracker = tracker,
            };
        }

        // Is this a disabled file?
        const other_source_index = record.source_index.get();
        const other_id = other_source_index;

        if (other_id > c.graph.ast.len or c.parse_graph.input_files.items(.source)[other_source_index].key_path.is_disabled) {
            return .{
                .value = .{
                    .source_index = record.source_index,
                },
                .status = .disabled,
                .tracker = tracker,
            };
        }

        // Is this a named import of a file without any exports?
        if (!named_import.alias_is_star and
            // TODO hasLazyExport

            // CommonJS exports
            c.graph.ast.items(.export_keyword)[other_id].len == 0 and !strings.eqlComptime(named_import.alias orelse "", "default") and
            // ESM exports
            !c.graph.ast.items(.uses_exports_ref)[other_id] and !c.graph.ast.items(.uses_module_ref)[other_id])
        {
            // Just warn about it and replace the import with "undefined"
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = Ref.None,
                },
                .status = .cjs_without_exports,
                .tracker = tracker,
            };
        }
        const other_kind = exports_kind[other_id];
        // Is this a CommonJS file?
        if (other_kind == .cjs) {
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = Ref.None,
                },
                .status = .cjs,
                .tracker = tracker,
            };
        }

        // Match this import star with an export star from the imported file
        if (named_import.alias_is_star) {
            const matching_export = c.graph.meta.items(.resolved_export_star)[other_id];
            if (matching_export.data.import_ref.isValid()) {
                // Check to see if this is a re-export of another import
                return .{
                    .value = matching_export.data,
                    .status = .found,
                    .import_data = matching_export.potentially_ambiguous_export_star_refs.slice(),
                    .tracker = tracker,
                };
            }
        }

        // Match this import up with an export from the imported file
        if (c.graph.meta.items(.resolved_exports)[other_id].get(named_import.alias.?)) |matching_export| {
            // Check to see if this is a re-export of another import
            return .{
                .value = .{
                    .source_index = matching_export.data.source_index,
                    .import_ref = matching_export.data.import_ref,
                    .name_loc = matching_export.data.name_loc,
                },
                .status = .found,
                .import_data = matching_export.potentially_ambiguous_export_star_refs.slice(),
                .tracker = tracker,
            };
        }

        // Is this a file with dynamic exports?
        if (other_kind == .esm_with_dynamic_fallback) {
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = c.graph.ast.items(.exports_ref)[other_id],
                },
                .status = .dynamic_fallback,
                .tracker = tracker,
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        if (named_import.is_exported and c.parse_graph.input_files.items(.loader)[other_source_index].isTypeScript()) {
            return .{
                .value = .{},
                .status = .probably_typescript_type,
                .tracker = tracker,
            };
        }

        return .{
            .value = .{
                .source_index = Index.source(other_source_index),
            },
            .status = .no_match,
            .tracker = tracker,
        };
    }

    pub fn matchImportsWithExportsForFile(c: *LinkerContext, named_imports: *JSAst.NamedImports, imports_to_bind: *RefImportData, source_index: Index.Int) void {
        var iter = named_imports.iterator();
        // TODO: do we need to sort here? I don't think so
        // because NamedImports is an ArrayHashMap, it's order should naturally be deterministic

        // Pair imports with their matching exports
        const Sorter = struct {
            imports: *JSAst.NamedImports,

            pub fn lessThan(self: @This(), a_index: usize, b_index: usize) bool {
                const a_ref = self.imports.keys()[a_index];
                const b_ref = self.imports.keys()[b_index];

                return std.math.order(a_ref.innerIndex(), b_ref.innerIndex()) == .lt;
            }
        };
        var sorter = Sorter{
            .imports = named_imports,
        };
        named_imports.sort(sorter);

        while (iter.next()) |entry| {
            // Re-use memory for the cycle detector
            c.cycle_detector.clearRetainingCapacity();
            const ref = entry.key_ptr.*;

            const import_ref = Ref.init(ref.innerIndex(), @truncate(Ref.Int, source_index), ref.isSourceContentsSlice());
            var import_tracker = ImportData{
                .data = .{
                    .source_index = Index.source(source_index),
                    .import_ref = import_ref,
                },
            };
            var re_exports = std.ArrayList(js_ast.Dependency).init(c.allocator);
            var result = c.matchImportWithExport(
                &import_tracker.data,
                &re_exports,
            );

            switch (result.kind) {
                .normal => {
                    imports_to_bind.put(
                        c.allocator,
                        import_ref,
                        .{
                            .re_exports = bun.BabyList(js_ast.Dependency).init(re_exports.items),
                            .data = .{
                                .source_index = Index.source(result.source_index),
                                .import_ref = result.ref,
                            },
                        },
                    ) catch unreachable;
                },
                .namespace => {
                    c.graph.symbols.get(import_ref).?.namespace_alias = js_ast.G.NamespaceAlias{
                        .namespace_ref = result.namespace_ref,
                        .alias = result.alias,
                    };
                },
                .normal_and_namespace => {
                    imports_to_bind.put(
                        c.allocator,
                        import_ref,
                        .{
                            .re_exports = bun.BabyList(js_ast.Dependency).init(re_exports.items),
                            .data = .{
                                .source_index = Index.source(result.source_index),
                                .import_ref = result.ref,
                            },
                        },
                    ) catch unreachable;

                    c.graph.symbols.get(import_ref).?.namespace_alias = js_ast.G.NamespaceAlias{
                        .namespace_ref = result.namespace_ref,
                        .alias = result.alias,
                    };
                },
                .cycle => {
                    const source = &c.parse_graph.input_files.items(.source)[source_index];
                    const r = lex.rangeOfIdentifier(source, entry.value_ptr.alias_loc orelse Logger.Loc{});
                    c.log.addRangeErrorFmt(
                        source,
                        r,
                        c.allocator,
                        "Detected cycle while resolving import {s}",
                        .{
                            entry.value_ptr.alias.?,
                        },
                    ) catch unreachable;
                },
                .probably_typescript_type => {
                    c.graph.meta.items(.probably_typescript_type)[source_index].put(
                        c.allocator,
                        import_ref,
                        void{},
                    ) catch unreachable;
                },
                .ambiguous => {
                    var named_import = entry.value_ptr.*;
                    const source = &c.parse_graph.input_files.items(.source)[source_index];

                    const r = lex.rangeOfIdentifier(source, entry.value_ptr.alias_loc orelse Logger.Loc{});

                    // if (result.name_loc.start != 0)
                    // TODO: better error
                    c.log.addRangeErrorFmt(
                        source,
                        r,
                        c.allocator,
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
        exports_kind: []js_ast.ExportsKind,
        named_exports: []js_ast.Ast.NamedExports,
        resolved_exports: []RefExportData,
        imports_to_bind: []RefImportData,
        export_star_records: []const []const Index.Int,
        allocator: std.mem.Allocator,

        pub fn addExports(
            this: *ExportStarContext,
            resolved_exports: *RefExportData,
            source_index: Index.Int,
        ) void {
            // Avoid infinite loops due to cycles in the export star graph
            for (this.source_index_stack.items) |i| {
                if (i == source_index)
                    return;
            }

            this.source_index_stack.append(source_index) catch unreachable;
            const id = source_index;

            const import_records = this.import_records_list[id].slice();

            for (this.export_star_records[id]) |import_id| {
                const other_source_index = import_records[import_id].source_index.get();

                const other_id = other_source_index;
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
                if (this.exports_kind[other_id] == .cjs)
                    continue;
                var iter = this.named_exports[other_id].iterator();
                next_export: while (iter.next()) |entry| {
                    const alias = entry.key_ptr.*;

                    // ES6 export star statements ignore exports named "default"
                    if (strings.eqlComptime(alias, "default"))
                        continue;

                    // This export star is shadowed if any file in the stack has a matching real named export
                    for (this.source_index_stack.items) |prev| {
                        if (this.named_exports[prev].contains(alias)) {
                            continue :next_export;
                        }
                    }
                    const ref = entry.value_ptr.ref;
                    var resolved = resolved_exports.getOrPut(this.allocator, entry.key_ptr.*) catch unreachable;
                    if (!resolved.found_existing) {
                        resolved.value_ptr.* = .{
                            .data = .{
                                .import_ref = ref,
                                .source_index = Index.source(other_source_index),
                                .name_loc = entry.value_ptr.alias_loc,
                            },
                        };

                        // Make sure the symbol is marked as imported so that code splitting
                        // imports it correctly if it ends up being shared with another chunk
                        this.imports_to_bind[id].put(this.allocator, entry.value_ptr.ref, .{
                            .data = .{
                                .import_ref = ref,
                                .source_index = Index.source(other_source_index),
                            },
                        }) catch unreachable;
                    } else if (resolved.value_ptr.data.source_index.get() != other_source_index) {
                        // Two different re-exports colliding makes it potentially ambiguous
                        resolved.value_ptr.potentially_ambiguous_export_star_refs.push(this.allocator, .{
                            .data = .{
                                .source_index = Index.source(other_source_index),
                                .import_ref = ref,
                                .name_loc = entry.value_ptr.alias_loc,
                            },
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
        flags: []JSMeta.Flags,
        exports_kind: []js_ast.ExportsKind,
        import_records: []ImportRecord.List,
        export_star_map: std.AutoHashMap(Index.Int, void),
        entry_point_kinds: []EntryPoint.Kind,
        export_star_records: [][]u32,
        output_format: options.OutputFormat,

        pub fn hasDynamicExportsDueToExportStar(this: *DependencyWrapper, source_index: Index.Int) bool {
            // Terminate the traversal now if this file already has dynamic exports
            const export_kind = this.exports_kind[source_index];
            switch (export_kind) {
                .cjs, .esm_with_dynamic_fallback => return true,
                else => {},
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
                    const kind = this.entry_point_kinds[record.source_index.get()];
                    if ((record.source_index.get() >= this.import_records.len and (!kind.isEntryPoint() or !this.output_format.keepES6ImportExportSyntax())) or
                        (record.source_index.get() < this.import_records.len and record.source_index.get() != source_index and this.hasDynamicExportsDueToExportStar(record.source_index.get())))
                    {
                        this.exports_kind[source_index] = .esm_with_dynamic_fallback;
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

            var flags = this.flags[source_index];

            if (flags.did_wrap_dependencies) return;
            flags.did_wrap_dependencies = true;

            // This module must be wrapped
            if (flags.wrap == .none) {
                flags.wrap = switch (this.exports_kind[source_index]) {
                    .cjs => .cjs,
                    else => .esm,
                };
            }
            this.flags[source_index] = flags;

            const records = this.import_records[source_index].slice();
            for (records) |record| {
                if (!record.source_index.isValid()) {
                    continue;
                }
                this.wrap(record.source_index.get());
            }
        }
    };
};

pub const PartRange = struct {
    source_index: Index = Index.invalid,
    part_index_begin: u32 = 0,
    part_index_end: u32 = 0,
};

const StableRef = packed struct {
    stable_source_index: Index.Int,
    ref: Ref,

    pub fn isLessThan(_: void, a: StableRef, b: StableRef) bool {
        return a.stable_source_index < b.stable_source_index or
            (a.stable_source_index == b.stable_source_index and a.ref.innerIndex() < b.ref.innerIndex());
    }
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
        cjs,

        /// The import is missing but there is a dynamic fallback object
        dynamic_fallback,

        /// The import was treated as a CommonJS import but the file is known to have no exports
        cjs_without_exports,

        /// The imported file was disabled by mapping it to false in the "browser"
        /// field of package.json
        disabled,

        /// The imported file is external and has unknown exports
        external,

        /// This is a missing re-export in a TypeScript file, so it's probably a type
        probably_typescript_type,
    };

    pub const Iterator = struct {
        status: Status = Status.no_match,
        value: ImportTracker = .{},
        import_data: []ImportData = &.{},
        tracker: *ImportTracker,
    };
};

pub const PathTemplate = struct {
    data: string = "",
    placeholder: Placeholder = .{},

    pub const Placeholder = struct {
        dir: []const u8 = "",
        name: []const u8 = "",
        ext: []const u8 = "",
        hash: ?u64 = null,
    };

    pub const chunk = PathTemplate{
        .data = "./chunk-[hash].[ext]",
        .placeholder = .{
            .name = "chunk",
            .ext = "js",
            .dir = "",
        },
    };

    pub const file = PathTemplate{
        .data = "./[name]-[hash].[ext]",
        .placeholder = .{},
    };
};

pub const Chunk = struct {
    /// This is a random string and is used to represent the output path of this
    /// chunk before the final output path has been computed.
    unique_key: string = "",

    files_with_parts_in_chunk: std.AutoArrayHashMapUnmanaged(Index.Int, void) = .{},

    /// We must not keep pointers to this type until all chunks have been allocated.
    entry_bits: AutoBitSet = undefined,

    final_rel_path: string = "",
    template: PathTemplate = .{},

    /// For code splitting
    cross_chunk_imports: BabyList(ChunkImport) = .{},

    content: Content,

    entry_point: Chunk.EntryPoint = .{},

    is_executable: bool = false,

    pub inline fn entryBits(this: *const Chunk) *const AutoBitSet {
        return &this.entry_bits;
    }

    pub const Order = struct {
        source_index: Index.Int = 0,
        distance: u32 = 0,
        tie_breaker: u32 = 0,

        pub fn lessThan(_: @This(), a: Order, b: Order) bool {
            if (a.distance < b.distance) return true;

            return a.tie_breaker < b.tie_breaker;
        }

        /// Sort so files closest to an entry point come first. If two files are
        /// equidistant to an entry point, then break the tie by sorting on the
        /// stable source index derived from the DFS over all entry points.
        pub fn sort(a: []Order) void {
            std.sort.sort(Order, a, Order{}, lessThan);
        }
    };

    pub const IntermediateOutput = union(enum) {
        /// If the chunk has references to other chunks, then "pieces" contains the
        /// contents of the chunk. Another joiner
        /// will have to be constructed later when merging the pieces together.
        pieces: bun.BabyList(OutputPiece),

        /// If the chunk doesn't have any references to other chunks, then
        /// "joiner" contains the contents of the chunk. This is more efficient
        /// because it avoids doing a join operation twice.
        joiner: *bun.Joiner,
    };

    pub const OutputPiece = struct {
        // layed out like this so it takes up the same amount of space as a []const u8
        data_ptr: [*]const u8 = undefined,
        data_len: u32 = 0,

        index: OutputPieceIndex = .{},

        pub inline fn data(this: OutputPiece) []const u8 {
            return this.data_ptr[0..this.data_len];
        }
    };

    pub const OutputPieceIndex = packed struct {
        index: u30 = 0,

        kind: Kind = Kind.none,

        pub const Kind = enum(u2) {
            /// The "kind" may be "none" in which case there is one piece
            /// with data and no chunk index. For example, the chunk may not contain any
            /// imports.
            none,

            asset,
            chunk,
        };
    };

    pub const EntryPoint = packed struct(u64) {
        source_index: Index.Int = 0,
        entry_point_id: ID = 0,
        is_entry_point: bool = false,

        // so it fits in a 64-bit integer
        pub const ID = u31;
    };

    pub const JavaScriptChunk = struct {
        files_in_chunk_order: []const Index.Int = &.{},
        parts_in_chunk_in_order: []const PartRange = &.{},

        // for code splitting
        exports_to_other_chunks: std.ArrayHashMapUnmanaged(Ref, string, Ref.ArrayHashCtx, false) = .{},
        imports_from_other_chunks: ImportsFromOtherChunks = .{},
        cross_chunk_prefix_stmts: BabyList(Stmt) = .{},
        cross_chunk_suffix_stmts: BabyList(Stmt) = .{},
    };

    pub const ImportsFromOtherChunks = std.AutoArrayHashMapUnmanaged(Index.Int, CrossChunkImport.Item.List);

    pub const Content = union(enum) {
        javascript: JavaScriptChunk,
    };
};

pub const ChunkImport = struct {
    chunk_index: u32,
    import_kind: ImportKind,
};

pub const CrossChunkImport = struct {
    chunk_index: Index.Int = 0,
    sorted_import_items: CrossChunkImport.Item.List = undefined,

    pub const Item = struct {
        export_alias: string = "",
        ref: Ref = Ref.None,

        pub const List = bun.BabyList(Item);

        pub fn lessThan(_: void, a: CrossChunkImport.Item, b: CrossChunkImport.Item) bool {
            return strings.order(a.export_alias, b.export_alias) == .lt;
        }
    };

    pub fn lessThan(_: void, a: CrossChunkImport, b: CrossChunkImport) bool {
        return std.math.order(a.chunk_index, b.chunk_index) == .lt;
    }

    pub const List = std.ArrayList(CrossChunkImport);

    pub fn sortedCrossChunkImports(
        list: *List,
        chunks: []Chunk,
        imports_from_other_chunks: *Chunk.ImportsFromOtherChunks,
    ) !void {
        var result = list.*;
        defer {
            list.* = result;
        }

        try result.ensureTotalCapacity(imports_from_other_chunks.count());

        var import_items_list = imports_from_other_chunks.values();
        var chunk_indices = imports_from_other_chunks.keys();
        var i: usize = 0;
        while (i < chunk_indices.len) : (i += 1) {
            const chunk_index = chunk_indices[i];
            var chunk = &chunks[chunk_index];

            // Sort imports from a single chunk by alias for determinism
            const exports_to_other_chunks = &chunk.content.javascript.exports_to_other_chunks;
            // TODO: do we need to clone this array?
            var import_items = import_items_list[i];
            for (import_items.slice()) |*item| {
                item.export_alias = exports_to_other_chunks.get(item.ref).?;
                std.debug.assert(item.export_alias.len > 0);
            }
            std.sort.sort(CrossChunkImport.Item, import_items.slice(), void{}, CrossChunkImport.Item.lessThan);

            result.append(CrossChunkImport{
                .chunk_index = chunk_index,
                .sorted_import_items = import_items,
            }) catch unreachable;
        }

        std.sort.sort(CrossChunkImport, result.items, void{}, CrossChunkImport.lessThan);
    }
};
