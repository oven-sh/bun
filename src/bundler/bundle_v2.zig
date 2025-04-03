// This is Bun's JavaScript/TypeScript transpiler
//
// A lot of the implementation is based on the Go implementation of esbuild. Thank you Evan Wallace.
//
// # Memory management
//
// Zig is not a managed language, so we have to be careful about memory management.
// Manually freeing memory is error-prone and tedious, but garbage collection
// is slow and reference counting incurs a performance penalty.
//
// Bun's bundler relies on mimalloc's threadlocal heaps as arena allocators.
//
// When a new thread is spawned for a bundling job, it is given a threadlocal
// heap and all allocations are done on that heap. When the job is done, the
// threadlocal heap is destroyed and all memory is freed.
//
// There are a few careful gotchas to keep in mind:
//
// - A threadlocal heap cannot allocate memory on a different thread than the one that
//  created it. You will get a segfault if you try to do that.
//
// - Since the heaps are destroyed at the end of bundling, any globally shared
//   references to data must NOT be allocated on a threadlocal heap.
//
//   For example, package.json and tsconfig.json read from the filesystem must be
//   use the global allocator (bun.default_allocator) because bun's directory
//   entry cache and module resolution cache are globally shared across all
//   threads.
//
//   Additionally, `LinkerContext`'s allocator is also threadlocal.
//
// - Globally allocated data must be in a cache & reused, or we will create an infinite
//   memory leak over time. To do that, we have a DirnameStore, FilenameStore, and the other
//   data structures related to `BSSMap`. This still leaks memory, but not very
//   much since it only allocates the first time around.
//
//
// In development, it is strongly recommended to use either a debug build of
// mimalloc or Valgrind to help catch memory issues
// To use a debug build of mimalloc:
//
//     make mimalloc-debug
//
const Transpiler = bun.Transpiler;
const bun = @import("root").bun;
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
const Part = js_ast.Part;
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
const sourcemap = bun.sourcemap;
const StringJoiner = bun.StringJoiner;
const base64 = bun.base64;
pub const Ref = @import("../ast/base.zig").Ref;
const Define = @import("../defines.zig").Define;
const DebugOptions = @import("../cli.zig").Command.DebugOptions;
const ThreadPoolLib = @import("../thread_pool.zig");
const ThreadlocalArena = @import("../allocators/mimalloc_arena.zig").Arena;
const BabyList = @import("../baby_list.zig").BabyList;
const Fs = @import("../fs.zig");
const schema = @import("../api/schema.zig");
const Api = schema.Api;
const _resolver = @import("../resolver/resolver.zig");
const sync = bun.ThreadPool;
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
const OOM = bun.OOM;

const HTMLScanner = @import("../HTMLScanner.zig");
const Router = @import("../router.zig");
const isPackagePath = _resolver.isPackagePath;
const Lock = bun.Mutex;
const NodeFallbackModules = @import("../node_fallbacks.zig");
const CacheEntry = @import("../cache.zig").Fs.Entry;
const Analytics = @import("../analytics/analytics_thread.zig");
const URL = @import("../url.zig").URL;
const Linker = linker.Linker;
const Resolver = _resolver.Resolver;
const TOML = @import("../toml/toml_parser.zig").TOML;
const EntryPoints = bun.transpiler.EntryPoints;
const Dependency = js_ast.Dependency;
const JSAst = js_ast.BundledAst;
const Loader = options.Loader;
pub const Index = @import("../ast/base.zig").Index;
const Symbol = js_ast.Symbol;
const EventLoop = bun.JSC.AnyEventLoop;
const MultiArrayList = bun.MultiArrayList;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;
const Binding = js_ast.Binding;
const AutoBitSet = bun.bit_set.AutoBitSet;
const renamer = bun.renamer;
const StableSymbolCount = renamer.StableSymbolCount;
const MinifyRenamer = renamer.MinifyRenamer;
const Scope = js_ast.Scope;
const JSC = bun.JSC;
const debugTreeShake = Output.scoped(.TreeShake, true);
const debugPartRanges = Output.scoped(.PartRanges, true);
const BitSet = bun.bit_set.DynamicBitSetUnmanaged;
const Async = bun.Async;
const Loc = Logger.Loc;
const bake = bun.bake;
const lol = bun.LOLHTML;
const debug_deferred = bun.Output.scoped(.BUNDLER_DEFERRED, true);
const DataURL = @import("../resolver/resolver.zig").DataURL;

const logPartDependencyTree = Output.scoped(.part_dep_tree, false);

pub const MangledProps = std.AutoArrayHashMapUnmanaged(Ref, []const u8);
pub const ThreadPool = struct {
    /// macOS holds an IORWLock on every file open.
    /// This causes massive contention after about 4 threads as of macOS 15.2
    /// On Windows, this seemed to be a small performance improvement.
    /// On Linux, this was a performance regression.
    /// In some benchmarks on macOS, this yielded up to a 60% performance improvement in microbenchmarks that load ~10,000 files.
    io_pool: *ThreadPoolLib = undefined,
    worker_pool: *ThreadPoolLib = undefined,
    workers_assignments: std.AutoArrayHashMap(std.Thread.Id, *Worker) = std.AutoArrayHashMap(std.Thread.Id, *Worker).init(bun.default_allocator),
    workers_assignments_lock: bun.Mutex = .{},
    v2: *BundleV2 = undefined,

    const debug = Output.scoped(.ThreadPool, false);

    pub fn reset(this: *ThreadPool) void {
        if (this.usesIOPool()) {
            if (this.io_pool.threadpool_context == @as(?*anyopaque, @ptrCast(this))) {
                this.io_pool.threadpool_context = null;
            }
        }

        if (this.worker_pool.threadpool_context == @as(?*anyopaque, @ptrCast(this))) {
            this.worker_pool.threadpool_context = null;
        }
    }

    pub fn go(this: *ThreadPool, allocator: std.mem.Allocator, comptime Function: anytype) !ThreadPoolLib.ConcurrentFunction(Function) {
        return this.worker_pool.go(allocator, Function);
    }

    pub fn start(this: *ThreadPool, v2: *BundleV2, existing_thread_pool: ?*ThreadPoolLib) !void {
        this.v2 = v2;

        if (existing_thread_pool) |pool| {
            this.worker_pool = pool;
        } else {
            const cpu_count = bun.getThreadCount();
            this.worker_pool = try v2.graph.allocator.create(ThreadPoolLib);
            this.worker_pool.* = ThreadPoolLib.init(.{
                .max_threads = cpu_count,
            });
            debug("{d} workers", .{cpu_count});
        }

        this.worker_pool.setThreadContext(this);

        this.worker_pool.warm(8);

        const IOThreadPool = struct {
            var thread_pool: ThreadPoolLib = undefined;
            var once = bun.once(startIOThreadPool);

            fn startIOThreadPool() void {
                thread_pool = ThreadPoolLib.init(.{
                    .max_threads = @max(@min(bun.getThreadCount(), 4), 2),

                    // Use a much smaller stack size for the IO thread pool
                    .stack_size = 512 * 1024,
                });
            }

            pub fn get() *ThreadPoolLib {
                once.call(.{});
                return &thread_pool;
            }
        };

        if (this.usesIOPool()) {
            this.io_pool = IOThreadPool.get();
            this.io_pool.setThreadContext(this);
            this.io_pool.warm(1);
        }
    }

    pub fn usesIOPool(_: *const ThreadPool) bool {
        if (bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_FORCE_IO_POOL")) {
            // For testing.
            return true;
        }

        if (bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_DISABLE_IO_POOL")) {
            // For testing.
            return false;
        }

        if (Environment.isMac or Environment.isWindows) {
            // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
            return bun.getThreadCount() > 3;
        }

        return false;
    }

    pub fn scheduleWithOptions(this: *ThreadPool, parse_task: *ParseTask, is_inside_thread_pool: bool) void {
        if (parse_task.contents_or_fd == .contents and parse_task.stage == .needs_source_code) {
            parse_task.stage = .{
                .needs_parse = .{
                    .contents = parse_task.contents_or_fd.contents,
                    .fd = bun.invalid_fd,
                },
            };
        }

        const scheduleFn = if (is_inside_thread_pool) &ThreadPoolLib.scheduleInsideThreadPool else &ThreadPoolLib.schedule;

        if (this.usesIOPool()) {
            switch (parse_task.stage) {
                .needs_parse => {
                    scheduleFn(this.worker_pool, .from(&parse_task.task));
                },
                .needs_source_code => {
                    scheduleFn(this.io_pool, .from(&parse_task.io_task));
                },
            }
        } else {
            scheduleFn(this.worker_pool, .from(&parse_task.task));
        }
    }

    pub fn schedule(this: *ThreadPool, parse_task: *ParseTask) void {
        this.scheduleWithOptions(parse_task, false);
    }

    pub fn scheduleInsideThreadPool(this: *ThreadPool, parse_task: *ParseTask) void {
        this.scheduleWithOptions(parse_task, true);
    }

    pub fn getWorker(this: *ThreadPool, id: std.Thread.Id) *Worker {
        var worker: *Worker = undefined;
        {
            this.workers_assignments_lock.lock();
            defer this.workers_assignments_lock.unlock();
            const entry = this.workers_assignments.getOrPut(id) catch unreachable;
            if (entry.found_existing) {
                return entry.value_ptr.*;
            }

            worker = bun.default_allocator.create(Worker) catch unreachable;
            entry.value_ptr.* = worker;
        }

        worker.* = .{
            .ctx = this.v2,
            .allocator = undefined,
            .thread = ThreadPoolLib.Thread.current,
        };
        worker.init(this.v2);

        return worker;
    }

    pub const Worker = struct {
        heap: ThreadlocalArena = ThreadlocalArena{},

        /// Thread-local memory allocator
        /// All allocations are freed in `deinit` at the very end of bundling.
        allocator: std.mem.Allocator,

        ctx: *BundleV2,

        data: WorkerData = undefined,
        quit: bool = false,

        ast_memory_allocator: js_ast.ASTMemoryAllocator = undefined,
        has_created: bool = false,
        thread: ?*ThreadPoolLib.Thread = null,

        deinit_task: ThreadPoolLib.Task = .{ .callback = deinitCallback },

        temporary_arena: bun.ArenaAllocator = undefined,
        stmt_list: LinkerContext.StmtList = undefined,

        pub fn deinitCallback(task: *ThreadPoolLib.Task) void {
            debug("Worker.deinit()", .{});
            var this: *Worker = @alignCast(@fieldParentPtr("deinit_task", task));
            this.deinit();
        }

        pub fn deinitSoon(this: *Worker) void {
            if (this.thread) |thread| {
                thread.pushIdleTask(&this.deinit_task);
            }
        }

        pub fn deinit(this: *Worker) void {
            if (this.has_created) {
                this.heap.deinit();
            }

            bun.default_allocator.destroy(this);
        }

        pub fn get(ctx: *BundleV2) *Worker {
            var worker = ctx.graph.pool.getWorker(std.Thread.getCurrentId());
            if (!worker.has_created) {
                worker.create(ctx);
            }

            worker.ast_memory_allocator.push();

            if (comptime FeatureFlags.help_catch_memory_issues) {
                worker.heap.helpCatchMemoryIssues();
            }

            return worker;
        }

        pub fn unget(this: *Worker) void {
            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.heap.helpCatchMemoryIssues();
            }

            this.ast_memory_allocator.pop();
        }

        pub const WorkerData = struct {
            log: *Logger.Log,
            estimated_input_lines_of_code: usize = 0,
            macro_context: js_ast.Macro.MacroContext,
            transpiler: Transpiler = undefined,
        };

        pub fn init(worker: *Worker, v2: *BundleV2) void {
            worker.ctx = v2;
        }

        fn create(this: *Worker, ctx: *BundleV2) void {
            const trace = bun.perf.trace("Bundler.Worker.create");
            defer trace.end();

            this.has_created = true;
            Output.Source.configureThread();
            this.heap = ThreadlocalArena.init() catch unreachable;
            this.allocator = this.heap.allocator();

            var allocator = this.allocator;

            this.ast_memory_allocator = .{ .allocator = this.allocator };
            this.ast_memory_allocator.reset();

            this.data = WorkerData{
                .log = allocator.create(Logger.Log) catch unreachable,
                .estimated_input_lines_of_code = 0,
                .macro_context = undefined,
            };
            this.data.log.* = Logger.Log.init(allocator);
            this.ctx = ctx;
            this.data.transpiler = ctx.transpiler.*;
            this.data.transpiler.setLog(this.data.log);
            this.data.transpiler.setAllocator(allocator);
            this.data.transpiler.linker.resolver = &this.data.transpiler.resolver;
            this.data.transpiler.macro_context = js_ast.Macro.MacroContext.init(&this.data.transpiler);
            this.data.macro_context = this.data.transpiler.macro_context.?;
            this.temporary_arena = bun.ArenaAllocator.init(this.allocator);
            this.stmt_list = LinkerContext.StmtList.init(this.allocator);

            const CacheSet = @import("../cache.zig");

            this.data.transpiler.resolver.caches = CacheSet.Set.init(this.allocator);
            debug("Worker.create()", .{});
        }

        pub fn run(this: *Worker, ctx: *BundleV2) void {
            if (!this.has_created) {
                this.create(ctx);
            }

            // no funny business mr. cache

        }
    };
};

const Watcher = bun.JSC.NewHotReloader(BundleV2, EventLoop, true);

/// This assigns a concise, predictable, and unique `.pretty` attribute to a Path.
/// DevServer relies on pretty paths for identifying modules, so they must be unique.
fn genericPathWithPrettyInitialized(path: Fs.Path, target: options.Target, top_level_dir: string, allocator: std.mem.Allocator) !Fs.Path {
    var buf: bun.PathBuffer = undefined;

    const is_node = bun.strings.eqlComptime(path.namespace, "node");
    if (is_node and
        (bun.strings.hasPrefixComptime(path.text, NodeFallbackModules.import_path) or
            !std.fs.path.isAbsolute(path.text)))
    {
        return path;
    }

    // "file" namespace should use the relative file path for its display name.
    // the "node" namespace is also put through this code path so that the
    // "node:" prefix is not emitted.
    if (path.isFile() or is_node) {
        const rel = bun.path.relativePlatform(top_level_dir, path.text, .loose, false);
        var path_clone = path;
        // stack-allocated temporary is not leaked because dupeAlloc on the path will
        // move .pretty into the heap. that function also fixes some slash issues.
        if (target == .bake_server_components_ssr) {
            // the SSR graph needs different pretty names or else HMR mode will
            // confuse the two modules.
            path_clone.pretty = std.fmt.bufPrint(&buf, "ssr:{s}", .{rel}) catch buf[0..];
        } else {
            path_clone.pretty = rel;
        }
        return path_clone.dupeAllocFixPretty(allocator);
    } else {
        // in non-file namespaces, standard filesystem rules do not apply.
        var path_clone = path;
        path_clone.pretty = std.fmt.bufPrint(&buf, "{s}{}:{s}", .{
            if (target == .bake_server_components_ssr) "ssr:" else "",
            // make sure that a namespace including a colon wont collide with anything
            std.fmt.Formatter(fmtEscapedNamespace){ .data = path.namespace },
            path.text,
        }) catch buf[0..];
        return path_clone.dupeAllocFixPretty(allocator);
    }
}

fn fmtEscapedNamespace(slice: []const u8, comptime fmt: []const u8, _: std.fmt.FormatOptions, w: anytype) !void {
    comptime bun.assert(fmt.len == 0);
    var rest = slice;
    while (bun.strings.indexOfChar(rest, ':')) |i| {
        try w.writeAll(rest[0..i]);
        try w.writeAll("::");
        rest = rest[i + 1 ..];
    }
    try w.writeAll(rest);
}

pub const BundleV2 = struct {
    transpiler: *Transpiler,
    /// When Server Component is enabled, this is used for the client bundles
    /// and `transpiler` is used for the server bundles.
    client_transpiler: *Transpiler,
    /// See bake.Framework.ServerComponents.separate_ssr_graph
    ssr_transpiler: *Transpiler,
    /// When Bun Bake is used, the resolved framework is passed here
    framework: ?bake.Framework,
    graph: Graph,
    linker: LinkerContext,
    bun_watcher: ?*bun.Watcher,
    plugins: ?*JSC.API.JSBundler.Plugin,
    completion: ?*JSBundleCompletionTask,
    source_code_length: usize,

    /// There is a race condition where an onResolve plugin may schedule a task on the bundle thread before it's parsing task completes
    resolve_tasks_waiting_for_import_source_index: std.AutoArrayHashMapUnmanaged(Index.Int, BabyList(struct { to_source_index: Index, import_record_index: u32 })) = .{},

    /// Allocations not tracked by a threadlocal heap
    free_list: std.ArrayList([]const u8) = std.ArrayList([]const u8).init(bun.default_allocator),

    /// See the comment in `Chunk.OutputPiece`
    unique_key: u64 = 0,
    dynamic_import_entry_points: std.AutoArrayHashMap(Index.Int, void) = undefined,
    has_on_parse_plugins: bool = false,

    finalizers: std.ArrayListUnmanaged(CacheEntry.ExternalFreeFunction) = .{},

    drain_defer_task: DeferredBatchTask = .{},

    /// Set true by DevServer. Currently every usage of the transpiler (Bun.build
    /// and `bun build` cli) runs at the top of an event loop. When this is
    /// true, a callback is executed after all work is complete.
    asynchronous: bool = false,
    thread_lock: bun.DebugThreadLock,

    const BakeOptions = struct {
        framework: bake.Framework,
        client_transpiler: *Transpiler,
        ssr_transpiler: *Transpiler,
        plugins: ?*JSC.API.JSBundler.Plugin,
    };

    const debug = Output.scoped(.Bundle, false);

    pub inline fn loop(this: *BundleV2) *EventLoop {
        return &this.linker.loop;
    }

    /// Returns the JSC.EventLoop where plugin callbacks can be queued up on
    pub fn jsLoopForPlugins(this: *BundleV2) *JSC.EventLoop {
        bun.assert(this.plugins != null);
        if (this.completion) |completion|
            // From Bun.build
            return completion.jsc_event_loop
        else switch (this.loop().*) {
            // From bake where the loop running the bundle is also the loop
            // running the plugins.
            .js => |jsc_event_loop| return jsc_event_loop,
            // The CLI currently has no JSC event loop; for now, no plugin support
            .mini => @panic("No JavaScript event loop for transpiler plugins to run on"),
        }
    }

    /// Most of the time, accessing .transpiler directly is OK. This is only
    /// needed when it is important to distinct between client and server
    ///
    /// Note that .log, .allocator, and other things are shared
    /// between the three transpiler configurations
    pub inline fn transpilerForTarget(this: *BundleV2, target: options.Target) *Transpiler {
        return if (!this.transpiler.options.server_components and this.linker.dev_server == null)
            this.transpiler
        else switch (target) {
            else => this.transpiler,
            .browser => this.client_transpiler,
            .bake_server_components_ssr => this.ssr_transpiler,
        };
    }

    /// By calling this function, it implies that the returned log *will* be
    /// written to. For DevServer, this allocates a per-file log for the sources
    /// it is called on. Function must be called on the bundle thread.
    pub fn logForResolutionFailures(this: *BundleV2, abs_path: []const u8, bake_graph: bake.Graph) *bun.logger.Log {
        if (this.transpiler.options.dev_server) |dev| {
            return dev.getLogForResolutionFailures(abs_path, bake_graph) catch bun.outOfMemory();
        }
        return this.transpiler.log;
    }

    /// Same semantics as bundlerForTarget for `path_to_source_index_map`
    pub inline fn pathToSourceIndexMap(this: *BundleV2, target: options.Target) *PathToSourceIndexMap {
        return if (!this.transpiler.options.server_components)
            &this.graph.path_to_source_index_map
        else switch (target) {
            else => &this.graph.path_to_source_index_map,
            .browser => &this.graph.client_path_to_source_index_map,
            .bake_server_components_ssr => &this.graph.ssr_path_to_source_index_map,
        };
    }

    const ReachableFileVisitor = struct {
        reachable: std.ArrayList(Index),
        visited: bun.bit_set.DynamicBitSet,
        all_import_records: []ImportRecord.List,
        all_loaders: []const Loader,
        all_urls_for_css: []const []const u8,
        redirects: []u32,
        redirect_map: PathToSourceIndexMap,
        dynamic_import_entry_points: *std.AutoArrayHashMap(Index.Int, void),
        /// Files which are Server Component Boundaries
        scb_bitset: ?bun.bit_set.DynamicBitSetUnmanaged,
        scb_list: ServerComponentBoundary.List.Slice,

        /// Files which are imported by JS and inlined in CSS
        additional_files_imported_by_js_and_inlined_in_css: *bun.bit_set.DynamicBitSetUnmanaged,
        /// Files which are imported by CSS and inlined in CSS
        additional_files_imported_by_css_and_inlined: *bun.bit_set.DynamicBitSetUnmanaged,

        const MAX_REDIRECTS: usize = 64;

        // Find all files reachable from all entry points. This order should be
        // deterministic given that the entry point order is deterministic, since the
        // returned order is the postorder of the graph traversal and import record
        // order within a given file is deterministic.
        pub fn visit(v: *@This(), source_index: Index, was_dynamic_import: bool, comptime check_dynamic_imports: bool) void {
            if (source_index.isInvalid()) return;

            if (v.visited.isSet(source_index.get())) {
                if (comptime check_dynamic_imports) {
                    if (was_dynamic_import) {
                        v.dynamic_import_entry_points.put(source_index.get(), {}) catch unreachable;
                    }
                }
                return;
            }
            v.visited.set(source_index.get());

            if (v.scb_bitset) |scb_bitset| {
                if (scb_bitset.isSet(source_index.get())) {
                    const scb_index = v.scb_list.getIndex(source_index.get()) orelse unreachable;
                    v.visit(Index.init(v.scb_list.list.items(.reference_source_index)[scb_index]), false, check_dynamic_imports);
                    v.visit(Index.init(v.scb_list.list.items(.ssr_source_index)[scb_index]), false, check_dynamic_imports);
                }
            }

            const is_js = v.all_loaders[source_index.get()].isJavaScriptLike();
            const is_css = v.all_loaders[source_index.get()].isCSS();

            const import_record_list_id = source_index;
            // when there are no import records, v index will be invalid
            if (import_record_list_id.get() < v.all_import_records.len) {
                const import_records = v.all_import_records[import_record_list_id.get()].slice();
                for (import_records) |*import_record| {
                    var other_source = import_record.source_index;
                    if (other_source.isValid()) {
                        var redirect_count: usize = 0;
                        while (getRedirectId(v.redirects[other_source.get()])) |redirect_id| : (redirect_count += 1) {
                            var other_import_records = v.all_import_records[other_source.get()].slice();
                            const other_import_record = &other_import_records[redirect_id];
                            import_record.source_index = other_import_record.source_index;
                            import_record.path = other_import_record.path;
                            other_source = other_import_record.source_index;
                            if (redirect_count == MAX_REDIRECTS) {
                                import_record.path.is_disabled = true;
                                import_record.source_index = Index.invalid;
                                break;
                            }

                            // Handle redirects to a builtin or external module
                            // https://github.com/oven-sh/bun/issues/3764
                            if (!other_source.isValid()) {
                                break;
                            }
                        }

                        // Mark if the file is imported by JS and its URL is inlined for CSS
                        const is_inlined = import_record.source_index.isValid() and v.all_urls_for_css[import_record.source_index.get()].len > 0;
                        if (is_js and is_inlined) {
                            v.additional_files_imported_by_js_and_inlined_in_css.set(import_record.source_index.get());
                        } else if (is_css and is_inlined) {
                            v.additional_files_imported_by_css_and_inlined.set(import_record.source_index.get());
                        }

                        v.visit(import_record.source_index, check_dynamic_imports and import_record.kind == .dynamic, check_dynamic_imports);
                    }
                }

                // Redirects replace the source file with another file
                if (getRedirectId(v.redirects[source_index.get()])) |redirect_id| {
                    const redirect_source_index = v.all_import_records[source_index.get()].slice()[redirect_id].source_index.get();
                    v.visit(Index.source(redirect_source_index), was_dynamic_import, check_dynamic_imports);
                    return;
                }
            }

            // Each file must come after its dependencies
            v.reachable.append(source_index) catch unreachable;
            if (comptime check_dynamic_imports) {
                if (was_dynamic_import) {
                    v.dynamic_import_entry_points.put(source_index.get(), {}) catch unreachable;
                }
            }
        }
    };

    pub fn findReachableFiles(this: *BundleV2) ![]Index {
        const trace = bun.perf.trace("Bundler.findReachableFiles");
        defer trace.end();

        // Create a quick index for server-component boundaries.
        // We need to mark the generated files as reachable, or else many files will appear missing.
        var sfa = std.heap.stackFallback(4096, this.graph.allocator);
        const stack_alloc = sfa.get();
        var scb_bitset = if (this.graph.server_component_boundaries.list.len > 0)
            try this.graph.server_component_boundaries.slice().bitSet(stack_alloc, this.graph.input_files.len)
        else
            null;
        defer if (scb_bitset) |*b| b.deinit(stack_alloc);

        var additional_files_imported_by_js_and_inlined_in_css = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(stack_alloc, this.graph.input_files.len);
        var additional_files_imported_by_css_and_inlined = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(stack_alloc, this.graph.input_files.len);
        defer {
            additional_files_imported_by_js_and_inlined_in_css.deinit(stack_alloc);
            additional_files_imported_by_css_and_inlined.deinit(stack_alloc);
        }

        this.dynamic_import_entry_points = std.AutoArrayHashMap(Index.Int, void).init(this.graph.allocator);

        const all_urls_for_css = this.graph.ast.items(.url_for_css);

        var visitor = ReachableFileVisitor{
            .reachable = try std.ArrayList(Index).initCapacity(this.graph.allocator, this.graph.entry_points.items.len + 1),
            .visited = try bun.bit_set.DynamicBitSet.initEmpty(this.graph.allocator, this.graph.input_files.len),
            .redirects = this.graph.ast.items(.redirect_import_record_index),
            .all_import_records = this.graph.ast.items(.import_records),
            .all_loaders = this.graph.input_files.items(.loader),
            .all_urls_for_css = all_urls_for_css,
            .redirect_map = this.graph.path_to_source_index_map,
            .dynamic_import_entry_points = &this.dynamic_import_entry_points,
            .scb_bitset = scb_bitset,
            .scb_list = if (scb_bitset != null)
                this.graph.server_component_boundaries.slice()
            else
                undefined, // will never be read since the above bitset is `null`
            .additional_files_imported_by_js_and_inlined_in_css = &additional_files_imported_by_js_and_inlined_in_css,
            .additional_files_imported_by_css_and_inlined = &additional_files_imported_by_css_and_inlined,
        };
        defer visitor.visited.deinit();

        // If we don't include the runtime, __toESM or __toCommonJS will not get
        // imported and weird things will happen
        visitor.visit(Index.runtime, false, false);

        switch (this.transpiler.options.code_splitting) {
            inline else => |check_dynamic_imports| {
                for (this.graph.entry_points.items) |entry_point| {
                    visitor.visit(entry_point, false, comptime check_dynamic_imports);
                }
            },
        }

        const DebugLog = bun.Output.Scoped(.ReachableFiles, false);
        if (DebugLog.isVisible()) {
            DebugLog.log("Reachable count: {d} / {d}", .{ visitor.reachable.items.len, this.graph.input_files.len });
            const sources: []Logger.Source = this.graph.input_files.items(.source);
            const targets: []options.Target = this.graph.ast.items(.target);
            for (visitor.reachable.items) |idx| {
                const source = sources[idx.get()];
                DebugLog.log("reachable file: #{d} {} ({s}) target=.{s}", .{
                    source.index.get(),
                    bun.fmt.quote(source.path.pretty),
                    source.path.text,
                    @tagName(targets[idx.get()]),
                });
            }
        }

        const additional_files = this.graph.input_files.items(.additional_files);
        const unique_keys = this.graph.input_files.items(.unique_key_for_additional_file);
        const content_hashes = this.graph.input_files.items(.content_hash_for_additional_file);
        for (all_urls_for_css, 0..) |url_for_css, index| {
            if (url_for_css.len > 0) {
                // We like to inline additional files in CSS if they fit a size threshold
                // If we do inline a file in CSS, and it is not imported by JS, then we don't need to copy the additional file into the output directory
                if (additional_files_imported_by_css_and_inlined.isSet(index) and !additional_files_imported_by_js_and_inlined_in_css.isSet(index)) {
                    additional_files[index].clearRetainingCapacity();
                    unique_keys[index] = "";
                    content_hashes[index] = 0;
                }
            }
        }

        return visitor.reachable.toOwnedSlice();
    }

    fn isDone(this: *BundleV2) bool {
        this.thread_lock.assertLocked();

        if (this.graph.pending_items == 0) {
            if (this.graph.drainDeferredTasks(this)) {
                return false;
            }

            return true;
        }

        return false;
    }

    pub fn waitForParse(this: *BundleV2) void {
        this.loop().tick(this, &isDone);

        debug("Parsed {d} files, producing {d} ASTs", .{ this.graph.input_files.len, this.graph.ast.len });
    }

    /// This runs on the Bundle Thread.
    pub fn runResolver(
        this: *BundleV2,
        import_record: bun.JSC.API.JSBundler.Resolve.MiniImportRecord,
        target: options.Target,
    ) void {
        const transpiler = this.transpilerForTarget(target);
        var had_busted_dir_cache: bool = false;
        var resolve_result = while (true) break transpiler.resolver.resolve(
            Fs.PathName.init(import_record.source_file).dirWithTrailingSlash(),
            import_record.specifier,
            import_record.kind,
        ) catch |err| {
            // Only perform directory busting when hot-reloading is enabled
            if (err == error.ModuleNotFound) {
                if (this.transpiler.options.dev_server) |dev| {
                    if (!had_busted_dir_cache) {
                        // Only re-query if we previously had something cached.
                        if (transpiler.resolver.bustDirCacheFromSpecifier(import_record.source_file, import_record.specifier)) {
                            had_busted_dir_cache = true;
                            continue;
                        }
                    }

                    // Tell Bake's Dev Server to wait for the file to be imported.
                    dev.directory_watchers.trackResolutionFailure(
                        import_record.source_file,
                        import_record.specifier,
                        target.bakeGraph(),
                        this.graph.input_files.items(.loader)[import_record.importer_source_index],
                    ) catch bun.outOfMemory();

                    // Turn this into an invalid AST, so that incremental mode skips it when printing.
                    this.graph.ast.items(.parts)[import_record.importer_source_index].len = 0;
                }
            }

            var handles_import_errors = false;
            var source: ?*const Logger.Source = null;
            const log = this.logForResolutionFailures(import_record.source_file, target.bakeGraph());

            var record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
            source = &this.graph.input_files.items(.source)[import_record.importer_source_index];
            handles_import_errors = record.handles_import_errors;

            // Disable failing packages from being printed.
            // This may cause broken code to write.
            // However, doing this means we tell them all the resolve errors
            // Rather than just the first one.
            record.path.is_disabled = true;

            switch (err) {
                error.ModuleNotFound => {
                    const addError = Logger.Log.addResolveErrorWithTextDupe;

                    const path_to_use = import_record.specifier;

                    if (!handles_import_errors and !this.transpiler.options.ignore_module_resolution_errors) {
                        if (isPackagePath(import_record.specifier)) {
                            if (target == .browser and options.ExternalModules.isNodeBuiltin(path_to_use)) {
                                addError(
                                    log,
                                    source,
                                    import_record.range,
                                    this.graph.allocator,
                                    "Browser build cannot {s} Node.js module: \"{s}\". To use Node.js builtins, set target to 'node' or 'bun'",
                                    .{ import_record.kind.errorLabel(), path_to_use },
                                    import_record.kind,
                                ) catch unreachable;
                            } else {
                                addError(
                                    log,
                                    source,
                                    import_record.range,
                                    this.graph.allocator,
                                    "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                                    .{path_to_use},
                                    import_record.kind,
                                ) catch unreachable;
                            }
                        } else {
                            addError(
                                log,
                                source,
                                import_record.range,
                                this.graph.allocator,
                                "Could not resolve: \"{s}\"",
                                .{
                                    path_to_use,
                                },
                                import_record.kind,
                            ) catch unreachable;
                        }
                    }
                },
                // assume other errors are already in the log
                else => {},
            }
            return;
        };

        var out_source_index: ?Index = null;

        var path: *Fs.Path = resolve_result.path() orelse {
            var record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];

            // Disable failing packages from being printed.
            // This may cause broken code to write.
            // However, doing this means we tell them all the resolve errors
            // Rather than just the first one.
            record.path.is_disabled = true;
            return;
        };

        if (resolve_result.is_external) {
            return;
        }

        if (path.pretty.ptr == path.text.ptr) {
            // TODO: outbase
            const rel = bun.path.relativePlatform(transpiler.fs.top_level_dir, path.text, .loose, false);
            path.pretty = this.graph.allocator.dupe(u8, rel) catch bun.outOfMemory();
        }
        path.assertPrettyIsValid();

        var secondary_path_to_copy: ?Fs.Path = null;
        if (resolve_result.path_pair.secondary) |*secondary| {
            if (!secondary.is_disabled and
                secondary != path and
                !strings.eqlLong(secondary.text, path.text, true))
            {
                secondary_path_to_copy = secondary.dupeAlloc(this.graph.allocator) catch bun.outOfMemory();
            }
        }

        const entry = this.pathToSourceIndexMap(target).getOrPut(this.graph.allocator, path.hashKey()) catch bun.outOfMemory();
        if (!entry.found_existing) {
            path.* = this.pathWithPrettyInitialized(path.*, target) catch bun.outOfMemory();
            const loader: Loader = (brk: {
                const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
                if (record.loader) |out_loader| {
                    break :brk out_loader;
                }
                break :brk path.loader(&transpiler.options.loaders) orelse options.Loader.file;
                // HTML is only allowed at the entry point.
            }).disableHTML();
            const idx = this.enqueueParseTask(
                &resolve_result,
                .{
                    .path = path.*,
                    .contents = "",
                },
                loader,
                import_record.original_target,
            ) catch bun.outOfMemory();
            entry.value_ptr.* = idx;
            out_source_index = Index.init(idx);

            // For non-javascript files, make all of these files share indices.
            // For example, it is silly to bundle index.css depended on by client+server twice.
            // It makes sense to separate these for JS because the target affects DCE
            if (this.transpiler.options.server_components and !loader.isJavaScriptLike()) {
                const a, const b = switch (target) {
                    else => .{ &this.graph.client_path_to_source_index_map, &this.graph.ssr_path_to_source_index_map },
                    .browser => .{ &this.graph.path_to_source_index_map, &this.graph.ssr_path_to_source_index_map },
                    .bake_server_components_ssr => .{ &this.graph.path_to_source_index_map, &this.graph.client_path_to_source_index_map },
                };
                a.put(this.graph.allocator, entry.key_ptr.*, entry.value_ptr.*) catch bun.outOfMemory();
                if (this.framework.?.server_components.?.separate_ssr_graph)
                    b.put(this.graph.allocator, entry.key_ptr.*, entry.value_ptr.*) catch bun.outOfMemory();
            }
        } else {
            out_source_index = Index.init(entry.value_ptr.*);
        }

        if (out_source_index) |source_index| {
            const record: *ImportRecord = &this.graph.ast.items(.import_records)[import_record.importer_source_index].slice()[import_record.import_record_index];
            record.source_index = source_index;
        }
    }

    pub fn enqueueFileFromDevServerIncrementalGraphInvalidation(
        this: *BundleV2,
        path_slice: []const u8,
        target: options.Target,
    ) !void {
        // TODO: plugins with non-file namespaces
        const entry = try this.pathToSourceIndexMap(target).getOrPut(this.graph.allocator, bun.hash(path_slice));
        if (entry.found_existing) {
            return;
        }
        const t = this.transpilerForTarget(target);
        const result = t.resolveEntryPoint(path_slice) catch
            return;
        var path = result.path_pair.primary;
        this.incrementScanCounter();
        const source_index = Index.source(this.graph.input_files.len);
        const loader = brk: {
            const default = path.loader(&this.transpiler.options.loaders) orelse .file;
            break :brk default;
        };

        path = this.pathWithPrettyInitialized(path, target) catch bun.outOfMemory();
        path.assertPrettyIsValid();
        entry.value_ptr.* = source_index.get();
        this.graph.ast.append(bun.default_allocator, JSAst.empty) catch bun.outOfMemory();

        try this.graph.input_files.append(bun.default_allocator, .{
            .source = .{
                .path = path,
                .contents = "",
                .index = source_index,
            },
            .loader = loader,
            .side_effects = result.primary_side_effects_data,
        });
        var task = try this.graph.allocator.create(ParseTask);
        task.* = ParseTask.init(&result, source_index, this);
        task.loader = loader;
        task.task.node.next = null;
        task.tree_shaking = this.linker.options.tree_shaking;
        task.known_target = target;
        task.jsx.development = switch (t.options.force_node_env) {
            .development => true,
            .production => false,
            .unspecified => t.options.jsx.development,
        };

        // Handle onLoad plugins as entry points
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                additional_files.push(this.graph.allocator, .{ .source_index = task.source_index.get() }) catch unreachable;
                this.graph.input_files.items(.side_effects)[source_index.get()] = .no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }
    }

    pub fn enqueueEntryItem(
        this: *BundleV2,
        hash: ?u64,
        resolve: _resolver.Result,
        is_entry_point: bool,
        target: options.Target,
    ) !?Index.Int {
        var result = resolve;
        var path = result.path() orelse return null;

        const entry = try this.pathToSourceIndexMap(target).getOrPut(this.graph.allocator, hash orelse path.hashKey());
        if (entry.found_existing) {
            return null;
        }
        this.incrementScanCounter();
        const source_index = Index.source(this.graph.input_files.len);
        const loader = brk: {
            const loader = path.loader(&this.transpiler.options.loaders) orelse .file;
            if (target != .browser) break :brk loader.disableHTML();
            break :brk loader;
        };

        path.* = this.pathWithPrettyInitialized(path.*, target) catch bun.outOfMemory();
        path.assertPrettyIsValid();
        entry.value_ptr.* = source_index.get();
        this.graph.ast.append(bun.default_allocator, JSAst.empty) catch bun.outOfMemory();

        try this.graph.input_files.append(bun.default_allocator, .{
            .source = .{
                .path = path.*,
                .contents = "",
                .index = source_index,
            },
            .loader = loader,
            .side_effects = resolve.primary_side_effects_data,
        });
        var task = try this.graph.allocator.create(ParseTask);
        task.* = ParseTask.init(&result, source_index, this);
        task.loader = loader;
        task.task.node.next = null;
        task.tree_shaking = this.linker.options.tree_shaking;
        task.is_entry_point = is_entry_point;
        task.known_target = target;
        {
            const bundler = this.transpilerForTarget(target);
            task.jsx.development = switch (bundler.options.force_node_env) {
                .development => true,
                .production => false,
                .unspecified => bundler.options.jsx.development,
            };
        }

        // Handle onLoad plugins as entry points
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                additional_files.push(this.graph.allocator, .{ .source_index = task.source_index.get() }) catch unreachable;
                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }

        try this.graph.entry_points.append(this.graph.allocator, source_index);

        return source_index.get();
    }

    pub fn init(
        transpiler: *Transpiler,
        bake_options: ?BakeOptions,
        allocator: std.mem.Allocator,
        event_loop: EventLoop,
        cli_watch_flag: bool,
        thread_pool: ?*ThreadPoolLib,
        heap: ?ThreadlocalArena,
    ) !*BundleV2 {
        transpiler.env.loadTracy();

        const this = try allocator.create(BundleV2);
        transpiler.options.mark_builtins_as_external = transpiler.options.target.isBun() or transpiler.options.target == .node;
        transpiler.resolver.opts.mark_builtins_as_external = transpiler.options.target.isBun() or transpiler.options.target == .node;

        this.* = .{
            .transpiler = transpiler,
            .client_transpiler = transpiler,
            .ssr_transpiler = transpiler,
            .framework = null,
            .graph = .{
                .pool = undefined,
                .heap = heap orelse try ThreadlocalArena.init(),
                .allocator = undefined,
                .kit_referenced_server_data = false,
                .kit_referenced_client_data = false,
            },
            .linker = .{
                .loop = event_loop,
                .graph = .{
                    .allocator = undefined,
                },
            },
            .bun_watcher = null,
            .plugins = null,
            .completion = null,
            .source_code_length = 0,
            .thread_lock = bun.DebugThreadLock.initLocked(),
        };
        if (bake_options) |bo| {
            this.client_transpiler = bo.client_transpiler;
            this.ssr_transpiler = bo.ssr_transpiler;
            this.framework = bo.framework;
            this.linker.framework = &this.framework.?;
            this.plugins = bo.plugins;
            if (transpiler.options.server_components) {
                bun.assert(this.client_transpiler.options.server_components);
                if (bo.framework.server_components.?.separate_ssr_graph)
                    bun.assert(this.ssr_transpiler.options.server_components);
            }
        }
        this.linker.graph.allocator = this.graph.heap.allocator();
        this.graph.allocator = this.linker.graph.allocator;
        this.transpiler.allocator = this.graph.allocator;
        this.transpiler.resolver.allocator = this.graph.allocator;
        this.transpiler.linker.allocator = this.graph.allocator;
        this.transpiler.log.msgs.allocator = this.graph.allocator;
        this.transpiler.log.clone_line_text = true;

        // We don't expose an option to disable this. Bake forbids tree-shaking
        // since every export must is always exist in case a future module
        // starts depending on it.
        if (this.transpiler.options.output_format == .internal_bake_dev) {
            this.transpiler.options.tree_shaking = false;
            this.transpiler.resolver.opts.tree_shaking = false;
        } else {
            this.transpiler.options.tree_shaking = true;
            this.transpiler.resolver.opts.tree_shaking = true;
        }

        this.linker.resolver = &this.transpiler.resolver;
        this.linker.graph.code_splitting = transpiler.options.code_splitting;

        this.linker.options.minify_syntax = transpiler.options.minify_syntax;
        this.linker.options.minify_identifiers = transpiler.options.minify_identifiers;
        this.linker.options.minify_whitespace = transpiler.options.minify_whitespace;
        this.linker.options.emit_dce_annotations = transpiler.options.emit_dce_annotations;
        this.linker.options.ignore_dce_annotations = transpiler.options.ignore_dce_annotations;
        this.linker.options.banner = transpiler.options.banner;
        this.linker.options.footer = transpiler.options.footer;
        this.linker.options.css_chunking = transpiler.options.css_chunking;
        this.linker.options.source_maps = transpiler.options.source_map;
        this.linker.options.tree_shaking = transpiler.options.tree_shaking;
        this.linker.options.public_path = transpiler.options.public_path;
        this.linker.options.target = transpiler.options.target;
        this.linker.options.output_format = transpiler.options.output_format;
        this.linker.options.generate_bytecode_cache = transpiler.options.bytecode;

        this.linker.dev_server = transpiler.options.dev_server;

        var pool = try this.graph.allocator.create(ThreadPool);
        if (cli_watch_flag) {
            Watcher.enableHotModuleReloading(this);
        }
        // errdefer pool.destroy();
        errdefer this.graph.heap.deinit();

        pool.* = ThreadPool{};
        this.graph.pool = pool;
        try pool.start(
            this,
            thread_pool,
        );

        return this;
    }

    const logScanCounter = bun.Output.scoped(.scan_counter, false);

    pub fn incrementScanCounter(this: *BundleV2) void {
        this.thread_lock.assertLocked();
        this.graph.pending_items += 1;
        logScanCounter(".pending_items + 1 = {d}", .{this.graph.pending_items});
    }

    pub fn decrementScanCounter(this: *BundleV2) void {
        this.thread_lock.assertLocked();
        this.graph.pending_items -= 1;
        logScanCounter(".pending_items - 1 = {d}", .{this.graph.pending_items});
        this.onAfterDecrementScanCounter();
    }

    pub fn onAfterDecrementScanCounter(this: *BundleV2) void {
        if (this.asynchronous and this.isDone()) {
            this.finishFromBakeDevServer(this.transpiler.options.dev_server orelse
                @panic("No dev server attached in asynchronous bundle job")) catch
                bun.outOfMemory();
        }
    }

    pub fn enqueueEntryPoints(
        this: *BundleV2,
        comptime variant: enum { normal, dev_server, bake_production },
        data: switch (variant) {
            .normal => []const []const u8,
            .dev_server => struct {
                files: bake.DevServer.EntryPointList,
                css_data: *std.AutoArrayHashMapUnmanaged(Index, CssEntryPointMeta),
            },
            .bake_production => bake.production.EntryPointMap,
        },
    ) !void {
        {
            // Add the runtime
            const rt = ParseTask.getRuntimeSource(this.transpiler.options.target);
            try this.graph.input_files.append(bun.default_allocator, Graph.InputFile{
                .source = rt.source,
                .loader = .js,
                .side_effects = _resolver.SideEffects.no_side_effects__pure_data,
            });

            // try this.graph.entry_points.append(allocator, Index.runtime);
            try this.graph.ast.append(bun.default_allocator, JSAst.empty);
            try this.graph.path_to_source_index_map.put(this.graph.allocator, bun.hash("bun:wrap"), Index.runtime.get());
            var runtime_parse_task = try this.graph.allocator.create(ParseTask);
            runtime_parse_task.* = rt.parse_task;
            runtime_parse_task.ctx = this;
            runtime_parse_task.tree_shaking = true;
            runtime_parse_task.loader = .js;
            this.incrementScanCounter();
            this.graph.pool.schedule(runtime_parse_task);
        }

        // Bake reserves two source indexes at the start of the file list, but
        // gets its content set after the scan+parse phase, but before linking.
        //
        // The dev server does not use these, as it is implement in the HMR runtime.
        if (variant != .dev_server) {
            try this.reserveSourceIndexesForBake();
        } else {
            bun.assert(this.transpiler.options.dev_server != null);
        }

        {
            // Setup entry points
            const num_entry_points = switch (variant) {
                .normal => data.len,
                .bake_production => data.files.count(),
                .dev_server => data.files.set.count(),
            };

            try this.graph.entry_points.ensureUnusedCapacity(this.graph.allocator, num_entry_points);
            try this.graph.input_files.ensureUnusedCapacity(this.graph.allocator, num_entry_points);
            try this.graph.path_to_source_index_map.ensureUnusedCapacity(this.graph.allocator, @intCast(num_entry_points));

            switch (variant) {
                .normal => {
                    for (data) |entry_point| {
                        const resolved = this.transpiler.resolveEntryPoint(entry_point) catch
                            continue;

                        _ = try this.enqueueEntryItem(null, resolved, true, this.transpiler.options.target);
                    }
                },
                .dev_server => {
                    for (data.files.set.keys(), data.files.set.values()) |abs_path, flags| {
                        const resolved = this.transpiler.resolveEntryPoint(abs_path) catch |err| {
                            const dev = this.transpiler.options.dev_server orelse unreachable;
                            dev.handleParseTaskFailure(
                                err,
                                if (flags.client) .client else .server,
                                abs_path,
                                this.transpiler.log,
                                this,
                            ) catch bun.outOfMemory();
                            this.transpiler.log.reset();
                            continue;
                        };

                        if (flags.client) brk: {
                            const source_index = try this.enqueueEntryItem(null, resolved, true, .browser) orelse break :brk;
                            if (flags.css) {
                                try data.css_data.putNoClobber(this.graph.allocator, Index.init(source_index), .{ .imported_on_server = false });
                            }
                        }
                        if (flags.server) _ = try this.enqueueEntryItem(null, resolved, true, this.transpiler.options.target);
                        if (flags.ssr) _ = try this.enqueueEntryItem(null, resolved, true, .bake_server_components_ssr);
                    }
                },
                .bake_production => {
                    for (data.files.keys()) |key| {
                        const resolved = this.transpiler.resolveEntryPoint(key.absPath()) catch
                            continue;

                        // TODO: wrap client files so the exports arent preserved.
                        _ = try this.enqueueEntryItem(null, resolved, true, switch (key.side) {
                            .client => .browser,
                            .server => this.transpiler.options.target,
                        }) orelse continue;
                    }
                },
            }
        }
    }

    fn cloneAST(this: *BundleV2) !void {
        const trace = bun.perf.trace("Bundler.cloneAST");
        defer trace.end();
        this.linker.allocator = this.transpiler.allocator;
        this.linker.graph.allocator = this.transpiler.allocator;
        this.linker.graph.ast = try this.graph.ast.clone(this.linker.allocator);
        var ast = this.linker.graph.ast.slice();
        for (ast.items(.module_scope)) |*module_scope| {
            for (module_scope.children.slice()) |child| {
                child.parent = module_scope;
            }

            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.graph.heap.helpCatchMemoryIssues();
            }

            module_scope.generated = try module_scope.generated.clone(this.linker.allocator);
        }
    }

    /// This generates the two asts for 'bun:bake/client' and 'bun:bake/server'. Both are generated
    /// at the same time in one pass over the SCB list.
    pub fn processServerComponentManifestFiles(this: *BundleV2) OOM!void {
        // If a server components is not configured, do nothing
        const fw = this.framework orelse return;
        const sc = fw.server_components orelse return;

        if (!this.graph.kit_referenced_server_data and
            !this.graph.kit_referenced_client_data) return;

        const alloc = this.graph.allocator;

        var server = try AstBuilder.init(this.graph.allocator, &bake.server_virtual_source, this.transpiler.options.hot_module_reloading);
        var client = try AstBuilder.init(this.graph.allocator, &bake.client_virtual_source, this.transpiler.options.hot_module_reloading);

        var server_manifest_props: std.ArrayListUnmanaged(G.Property) = .{};
        var client_manifest_props: std.ArrayListUnmanaged(G.Property) = .{};

        const scbs = this.graph.server_component_boundaries.list.slice();
        const named_exports_array = this.graph.ast.items(.named_exports);

        const id_string = server.newExpr(E.String{ .data = "id" });
        const name_string = server.newExpr(E.String{ .data = "name" });
        const chunks_string = server.newExpr(E.String{ .data = "chunks" });
        const specifier_string = server.newExpr(E.String{ .data = "specifier" });
        const empty_array = server.newExpr(E.Array{});

        for (
            scbs.items(.use_directive),
            scbs.items(.source_index),
            scbs.items(.ssr_source_index),
        ) |use, source_id, ssr_index| {
            if (use == .client) {
                // TODO(@paperclover/bake): this file is being generated far too
                // early. we don't know which exports are dead and which exports
                // are live. Tree-shaking figures that out. However,
                // tree-shaking happens after import binding, which would
                // require this ast.
                //
                // The plan: change this to generate a stub ast which only has
                // `export const serverManifest = undefined;`, and then
                // re-generate this file later with the properly decided
                // manifest. However, I will probably reconsider how this
                // manifest is being generated when I write the whole
                // "production build" part of Bake.

                const keys = named_exports_array[source_id].keys();
                const client_manifest_items = try alloc.alloc(G.Property, keys.len);

                if (!sc.separate_ssr_graph) bun.todoPanic(@src(), "separate_ssr_graph=false", .{});

                const client_path = server.newExpr(E.String{
                    .data = try std.fmt.allocPrint(alloc, "{}S{d:0>8}", .{
                        bun.fmt.hexIntLower(this.unique_key),
                        source_id,
                    }),
                });
                const ssr_path = server.newExpr(E.String{
                    .data = try std.fmt.allocPrint(alloc, "{}S{d:0>8}", .{
                        bun.fmt.hexIntLower(this.unique_key),
                        ssr_index,
                    }),
                });

                for (keys, client_manifest_items) |export_name_string, *client_item| {
                    const server_key_string = try std.fmt.allocPrint(alloc, "{}S{d:0>8}#{s}", .{
                        bun.fmt.hexIntLower(this.unique_key),
                        source_id,
                        export_name_string,
                    });
                    const export_name = server.newExpr(E.String{ .data = export_name_string });

                    // write dependencies on the underlying module, not the proxy
                    try server_manifest_props.append(alloc, .{
                        .key = server.newExpr(E.String{ .data = server_key_string }),
                        .value = server.newExpr(E.Object{
                            .properties = try G.Property.List.fromSlice(alloc, &.{
                                .{ .key = id_string, .value = client_path },
                                .{ .key = name_string, .value = export_name },
                                .{ .key = chunks_string, .value = empty_array },
                            }),
                        }),
                    });
                    client_item.* = .{
                        .key = export_name,
                        .value = server.newExpr(E.Object{
                            .properties = try G.Property.List.fromSlice(alloc, &.{
                                .{ .key = name_string, .value = export_name },
                                .{ .key = specifier_string, .value = ssr_path },
                            }),
                        }),
                    };
                }

                try client_manifest_props.append(alloc, .{
                    .key = client_path,
                    .value = server.newExpr(E.Object{
                        .properties = G.Property.List.init(client_manifest_items),
                    }),
                });
            } else {
                bun.todoPanic(@src(), "\"use server\"", .{});
            }
        }

        try server.appendStmt(S.Local{
            .kind = .k_const,
            .decls = try G.Decl.List.fromSlice(alloc, &.{.{
                .binding = Binding.alloc(alloc, B.Identifier{
                    .ref = try server.newSymbol(.other, "serverManifest"),
                }, Logger.Loc.Empty),
                .value = server.newExpr(E.Object{
                    .properties = G.Property.List.fromList(server_manifest_props),
                }),
            }}),
            .is_export = true,
        });
        try server.appendStmt(S.Local{
            .kind = .k_const,
            .decls = try G.Decl.List.fromSlice(alloc, &.{.{
                .binding = Binding.alloc(alloc, B.Identifier{
                    .ref = try server.newSymbol(.other, "ssrManifest"),
                }, Logger.Loc.Empty),
                .value = server.newExpr(E.Object{
                    .properties = G.Property.List.fromList(client_manifest_props),
                }),
            }}),
            .is_export = true,
        });

        this.graph.ast.set(Index.bake_server_data.get(), try server.toBundledAst(.bun));
        this.graph.ast.set(Index.bake_client_data.get(), try client.toBundledAst(.browser));
    }

    pub fn enqueueParseTask(
        this: *BundleV2,
        resolve_result: *const _resolver.Result,
        source: Logger.Source,
        loader_: Loader,
        known_target: options.Target,
    ) OOM!Index.Int {
        const source_index = Index.init(@as(u32, @intCast(this.graph.ast.len)));
        this.graph.ast.append(bun.default_allocator, JSAst.empty) catch unreachable;
        // Only enable HTML loader when it's an entry point.
        const loader = loader_.disableHTML();

        this.graph.input_files.append(bun.default_allocator, .{
            .source = source,
            .loader = loader,
            .side_effects = loader.sideEffects(),
        }) catch bun.outOfMemory();
        var task = this.graph.allocator.create(ParseTask) catch bun.outOfMemory();
        task.* = ParseTask.init(resolve_result, source_index, this);
        task.loader = loader;
        task.jsx = this.transpilerForTarget(known_target).options.jsx;
        task.task.node.next = null;
        task.io_task.node.next = null;
        task.tree_shaking = this.linker.options.tree_shaking;
        task.known_target = known_target;

        this.incrementScanCounter();

        // Handle onLoad plugins
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                additional_files.push(this.graph.allocator, .{ .source_index = task.source_index.get() }) catch unreachable;
                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }

        return source_index.get();
    }

    pub fn enqueueParseTask2(
        this: *BundleV2,
        source: Logger.Source,
        loader: Loader,
        known_target: options.Target,
    ) OOM!Index.Int {
        const source_index = Index.init(@as(u32, @intCast(this.graph.ast.len)));
        this.graph.ast.append(bun.default_allocator, JSAst.empty) catch unreachable;

        this.graph.input_files.append(bun.default_allocator, .{
            .source = source,
            .loader = loader,
            .side_effects = loader.sideEffects(),
        }) catch bun.outOfMemory();
        var task = this.graph.allocator.create(ParseTask) catch bun.outOfMemory();
        task.* = .{
            .ctx = this,
            .path = source.path,
            .contents_or_fd = .{
                .contents = source.contents,
            },
            .side_effects = .has_side_effects,
            .jsx = if (known_target == .bake_server_components_ssr and !this.framework.?.server_components.?.separate_ssr_graph)
                this.transpiler.options.jsx
            else
                this.transpilerForTarget(known_target).options.jsx,
            .source_index = source_index,
            .module_type = .unknown,
            .emit_decorator_metadata = false, // TODO
            .package_version = "",
            .loader = loader,
            .tree_shaking = this.linker.options.tree_shaking,
            .known_target = known_target,
        };
        task.task.node.next = null;
        task.io_task.node.next = null;

        this.incrementScanCounter();

        // Handle onLoad plugins
        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
            if (loader.shouldCopyForBundling()) {
                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                additional_files.push(this.graph.allocator, .{ .source_index = task.source_index.get() }) catch unreachable;
                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                this.graph.estimated_file_loader_count += 1;
            }

            this.graph.pool.schedule(task);
        }
        return source_index.get();
    }

    /// Enqueue a ServerComponentParseTask.
    /// `source_without_index` is copied and assigned a new source index. That index is returned.
    pub fn enqueueServerComponentGeneratedFile(
        this: *BundleV2,
        data: ServerComponentParseTask.Data,
        source_without_index: Logger.Source,
    ) OOM!Index.Int {
        var new_source: Logger.Source = source_without_index;
        const source_index = this.graph.input_files.len;
        new_source.index = Index.init(source_index);
        try this.graph.input_files.append(default_allocator, .{
            .source = new_source,
            .loader = .js,
            .side_effects = .has_side_effects,
        });
        try this.graph.ast.append(default_allocator, JSAst.empty);

        const task = bun.new(ServerComponentParseTask, .{
            .data = data,
            .ctx = this,
            .source = new_source,
        });

        this.incrementScanCounter();

        this.graph.pool.worker_pool.schedule(.from(&task.task));

        return @intCast(source_index);
    }

    pub const DependenciesScanner = struct {
        ctx: *anyopaque,
        entry_points: []const []const u8,

        onFetch: *const fn (
            ctx: *anyopaque,
            result: *DependenciesScanner.Result,
        ) anyerror!void,

        pub const Result = struct {
            dependencies: bun.StringSet,
            reachable_files: []const Index,
            bundle_v2: *BundleV2,
        };
    };

    pub fn getAllDependencies(this: *BundleV2, reachable_files: []const Index, fetcher: *const DependenciesScanner) !void {

        // Find all external dependencies from reachable files
        var external_deps = bun.StringSet.init(bun.default_allocator);
        defer external_deps.deinit();

        const import_records = this.graph.ast.items(.import_records);

        for (reachable_files) |source_index| {
            const records: []const ImportRecord = import_records[source_index.get()].slice();
            for (records) |*record| {
                if (!record.source_index.isValid() and record.tag == .none) {
                    const path = record.path.text;
                    // External dependency
                    if (path.len > 0 and
                        // Check for either node or bun builtins
                        // We don't use the list from .bun because that includes third-party packages in some cases.
                        !JSC.HardcodedModule.Alias.has(path, .node) and
                        !strings.hasPrefixComptime(path, "bun:") and
                        !strings.eqlComptime(path, "bun"))
                    {
                        if (strings.isNPMPackageNameIgnoreLength(path)) {
                            try external_deps.insert(path);
                        }
                    }
                }
            }
        }
        var result = DependenciesScanner.Result{
            .dependencies = external_deps,
            .bundle_v2 = this,
            .reachable_files = reachable_files,
        };
        try fetcher.onFetch(fetcher.ctx, &result);
    }

    pub fn generateFromCLI(
        transpiler: *Transpiler,
        allocator: std.mem.Allocator,
        event_loop: EventLoop,
        enable_reloading: bool,
        reachable_files_count: *usize,
        minify_duration: *u64,
        source_code_size: *u64,
        fetcher: ?*DependenciesScanner,
    ) !std.ArrayList(options.OutputFile) {
        var this = try BundleV2.init(transpiler, null, allocator, event_loop, enable_reloading, null, null);
        this.unique_key = generateUniqueKey();

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        try this.enqueueEntryPoints(.normal, this.transpiler.options.entry_points);

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        this.waitForParse();

        minify_duration.* = @as(u64, @intCast(@divTrunc(@as(i64, @truncate(std.time.nanoTimestamp())) - @as(i64, @truncate(bun.CLI.start_time)), @as(i64, std.time.ns_per_ms))));
        source_code_size.* = this.source_code_length;

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        try this.processServerComponentManifestFiles();

        const reachable_files = try this.findReachableFiles();
        reachable_files_count.* = reachable_files.len -| 1; // - 1 for the runtime

        try this.processFilesToCopy(reachable_files);

        try this.addServerComponentBoundariesAsExtraEntryPoints();

        try this.cloneAST();

        const chunks = try this.linker.link(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            reachable_files,
        );

        // Do this at the very end, after processing all the imports/exports so that we can follow exports as needed.
        if (fetcher) |fetch| {
            try this.getAllDependencies(reachable_files, fetch);
            return std.ArrayList(options.OutputFile).init(allocator);
        }

        return try this.linker.generateChunksInParallel(chunks, false);
    }

    pub fn generateFromBakeProductionCLI(
        entry_points: bake.production.EntryPointMap,
        server_transpiler: *Transpiler,
        kit_options: BakeOptions,
        allocator: std.mem.Allocator,
        event_loop: EventLoop,
    ) !std.ArrayList(options.OutputFile) {
        var this = try BundleV2.init(server_transpiler, kit_options, allocator, event_loop, false, null, null);
        this.unique_key = generateUniqueKey();

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        try this.enqueueEntryPoints(.bake_production, entry_points);

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        this.waitForParse();

        if (this.transpiler.log.hasErrors()) {
            return error.BuildFailed;
        }

        try this.processServerComponentManifestFiles();

        const reachable_files = try this.findReachableFiles();

        try this.processFilesToCopy(reachable_files);

        try this.addServerComponentBoundariesAsExtraEntryPoints();

        try this.cloneAST();

        const chunks = try this.linker.link(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            reachable_files,
        );

        return try this.linker.generateChunksInParallel(chunks, false);
    }

    pub fn addServerComponentBoundariesAsExtraEntryPoints(this: *BundleV2) !void {
        // Prepare server component boundaries. Each boundary turns into two
        // entry points, a client entrypoint and a server entrypoint.
        //
        // TODO: This should be able to group components by the user specified
        // entry points. This way, using two component files in a route does not
        // create two separate chunks. (note: bake passes each route as an entrypoint)
        {
            const scbs = this.graph.server_component_boundaries.slice();
            try this.graph.entry_points.ensureUnusedCapacity(this.graph.allocator, scbs.list.len * 2);
            for (scbs.list.items(.source_index), scbs.list.items(.ssr_source_index)) |original_index, ssr_index| {
                inline for (.{ original_index, ssr_index }) |idx| {
                    this.graph.entry_points.appendAssumeCapacity(Index.init(idx));
                }
            }
        }
    }

    pub fn processFilesToCopy(this: *BundleV2, reachable_files: []const Index) !void {
        if (this.graph.estimated_file_loader_count > 0) {
            const file_allocators = this.graph.input_files.items(.allocator);
            const unique_key_for_additional_files = this.graph.input_files.items(.unique_key_for_additional_file);
            const content_hashes_for_additional_files = this.graph.input_files.items(.content_hash_for_additional_file);
            const sources = this.graph.input_files.items(.source);
            var additional_output_files = std.ArrayList(options.OutputFile).init(this.transpiler.allocator);

            const additional_files: []BabyList(AdditionalFile) = this.graph.input_files.items(.additional_files);
            const loaders = this.graph.input_files.items(.loader);

            for (reachable_files) |reachable_source| {
                const index = reachable_source.get();
                const key = unique_key_for_additional_files[index];
                if (key.len > 0) {
                    var template = PathTemplate.asset;
                    if (this.transpiler.options.asset_naming.len > 0)
                        template.data = this.transpiler.options.asset_naming;
                    const source = &sources[index];
                    var pathname = source.path.name;

                    // TODO: outbase
                    pathname = Fs.PathName.init(bun.path.relativePlatform(this.transpiler.options.root_dir, source.path.text, .loose, false));

                    template.placeholder.name = pathname.base;
                    template.placeholder.dir = pathname.dir;
                    template.placeholder.ext = pathname.ext;
                    if (template.placeholder.ext.len > 0 and template.placeholder.ext[0] == '.')
                        template.placeholder.ext = template.placeholder.ext[1..];

                    if (template.needs(.hash)) {
                        template.placeholder.hash = content_hashes_for_additional_files[index];
                    }

                    const loader = loaders[index];

                    additional_output_files.append(options.OutputFile.init(.{
                        .data = .{ .buffer = .{
                            .data = source.contents,
                            .allocator = file_allocators[index],
                        } },
                        .size = source.contents.len,
                        .output_path = std.fmt.allocPrint(bun.default_allocator, "{}", .{template}) catch bun.outOfMemory(),
                        .input_path = bun.default_allocator.dupe(u8, source.path.text) catch bun.outOfMemory(),
                        .input_loader = .file,
                        .output_kind = .asset,
                        .loader = loader,
                        .hash = content_hashes_for_additional_files[index],
                        .side = .client,
                        .entry_point_index = null,
                        .is_executable = false,
                    })) catch unreachable;
                    additional_files[index].push(this.graph.allocator, AdditionalFile{
                        .output_file = @as(u32, @truncate(additional_output_files.items.len - 1)),
                    }) catch unreachable;
                }
            }

            this.graph.additional_output_files = additional_output_files.moveToUnmanaged();
        }
    }

    pub const JSBundleThread = BundleThread(JSBundleCompletionTask);

    pub fn createAndScheduleCompletionTask(
        config: bun.JSC.API.JSBundler.Config,
        plugins: ?*bun.JSC.API.JSBundler.Plugin,
        globalThis: *JSC.JSGlobalObject,
        event_loop: *bun.JSC.EventLoop,
        _: std.mem.Allocator,
    ) OOM!*JSBundleCompletionTask {
        const completion = JSBundleCompletionTask.new(.{
            .config = config,
            .jsc_event_loop = event_loop,
            .globalThis = globalThis,
            .poll_ref = Async.KeepAlive.init(),
            .env = globalThis.bunVM().transpiler.env,
            .plugins = plugins,
            .log = Logger.Log.init(bun.default_allocator),
            .task = undefined,
        });
        completion.task = JSBundleCompletionTask.TaskCompletion.init(completion);

        if (plugins) |plugin| {
            plugin.setConfig(completion);
        }

        // Ensure this exists before we spawn the thread to prevent any race
        // conditions from creating two
        _ = JSC.WorkPool.get();

        JSBundleThread.singleton.enqueue(completion);

        completion.poll_ref.ref(globalThis.bunVM());

        return completion;
    }

    pub fn generateFromJavaScript(
        config: bun.JSC.API.JSBundler.Config,
        plugins: ?*bun.JSC.API.JSBundler.Plugin,
        globalThis: *JSC.JSGlobalObject,
        event_loop: *bun.JSC.EventLoop,
        allocator: std.mem.Allocator,
    ) OOM!bun.JSC.JSValue {
        const completion = try createAndScheduleCompletionTask(config, plugins, globalThis, event_loop, allocator);
        completion.promise = JSC.JSPromise.Strong.init(globalThis);
        return completion.promise.value();
    }

    pub const BuildResult = struct {
        output_files: std.ArrayList(options.OutputFile),

        pub fn deinit(this: *BuildResult) void {
            for (this.output_files.items) |*output_file| {
                output_file.deinit();
            }

            this.output_files.clearAndFree();
        }
    };

    pub const Result = union(enum) {
        pending: void,
        err: anyerror,
        value: BuildResult,

        pub fn deinit(this: *Result) void {
            switch (this.*) {
                .value => |*value| {
                    value.deinit();
                },
                else => {},
            }
        }
    };

    pub const JSBundleCompletionTask = struct {
        config: bun.JSC.API.JSBundler.Config,
        jsc_event_loop: *bun.JSC.EventLoop,
        task: bun.JSC.AnyTask,
        globalThis: *JSC.JSGlobalObject,
        promise: JSC.JSPromise.Strong = .{},
        poll_ref: Async.KeepAlive = Async.KeepAlive.init(),
        env: *bun.DotEnv.Loader,
        log: Logger.Log,
        cancelled: bool = false,

        html_build_task: ?*JSC.API.HTMLBundle.HTMLBundleRoute = null,

        result: Result = .{ .pending = {} },

        next: ?*JSBundleCompletionTask = null,
        transpiler: *BundleV2 = undefined,
        plugins: ?*bun.JSC.API.JSBundler.Plugin = null,
        ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
        started_at_ns: u64 = 0,

        pub usingnamespace bun.NewThreadSafeRefCounted(JSBundleCompletionTask, _deinit, null);

        pub fn configureBundler(
            completion: *JSBundleCompletionTask,
            transpiler: *Transpiler,
            allocator: std.mem.Allocator,
        ) !void {
            const config = &completion.config;

            transpiler.* = try bun.Transpiler.init(
                allocator,
                &completion.log,
                Api.TransformOptions{
                    .define = if (config.define.count() > 0) config.define.toAPI() else null,
                    .entry_points = config.entry_points.keys(),
                    .target = config.target.toAPI(),
                    .absolute_working_dir = if (config.dir.list.items.len > 0)
                        config.dir.sliceWithSentinel()
                    else
                        null,
                    .inject = &.{},
                    .external = config.external.keys(),
                    .main_fields = &.{},
                    .extension_order = &.{},
                    .env_files = &.{},
                    .conditions = config.conditions.map.keys(),
                    .ignore_dce_annotations = transpiler.options.ignore_dce_annotations,
                    .drop = config.drop.map.keys(),
                    .bunfig_path = transpiler.options.bunfig_path,
                },
                completion.env,
            );
            transpiler.options.env.behavior = config.env_behavior;
            transpiler.options.env.prefix = config.env_prefix.slice();
            if (config.force_node_env != .unspecified) {
                transpiler.options.force_node_env = config.force_node_env;
            }

            transpiler.options.entry_points = config.entry_points.keys();
            transpiler.options.jsx = config.jsx;
            transpiler.options.no_macros = config.no_macros;
            transpiler.options.loaders = try options.loadersFromTransformOptions(allocator, config.loaders, config.target);
            transpiler.options.entry_naming = config.names.entry_point.data;
            transpiler.options.chunk_naming = config.names.chunk.data;
            transpiler.options.asset_naming = config.names.asset.data;

            transpiler.options.public_path = config.public_path.list.items;
            transpiler.options.output_format = config.format;
            transpiler.options.bytecode = config.bytecode;

            transpiler.options.output_dir = config.outdir.slice();
            transpiler.options.root_dir = config.rootdir.slice();
            transpiler.options.minify_syntax = config.minify.syntax;
            transpiler.options.minify_whitespace = config.minify.whitespace;
            transpiler.options.minify_identifiers = config.minify.identifiers;
            transpiler.options.inlining = config.minify.syntax;
            transpiler.options.source_map = config.source_map;
            transpiler.options.packages = config.packages;
            transpiler.options.code_splitting = config.code_splitting;
            transpiler.options.emit_dce_annotations = config.emit_dce_annotations orelse !config.minify.whitespace;
            transpiler.options.ignore_dce_annotations = config.ignore_dce_annotations;
            transpiler.options.css_chunking = config.css_chunking;
            transpiler.options.banner = config.banner.slice();
            transpiler.options.footer = config.footer.slice();

            transpiler.configureLinker();
            try transpiler.configureDefines();

            if (!transpiler.options.production) {
                try transpiler.options.conditions.appendSlice(&.{"development"});
            }

            transpiler.resolver.opts = transpiler.options;
        }

        pub fn completeOnBundleThread(completion: *JSBundleCompletionTask) void {
            completion.jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.create(completion.task.task()));
        }

        pub const TaskCompletion = bun.JSC.AnyTask.New(JSBundleCompletionTask, onComplete);

        fn _deinit(this: *JSBundleCompletionTask) void {
            this.result.deinit();
            this.log.deinit();
            this.poll_ref.disable();
            if (this.plugins) |plugin| {
                plugin.deinit();
            }
            this.config.deinit(bun.default_allocator);
            this.promise.deinit();
            this.destroy();
        }

        pub fn onComplete(this: *JSBundleCompletionTask) void {
            var globalThis = this.globalThis;
            defer this.deref();

            this.poll_ref.unref(globalThis.bunVM());
            if (this.cancelled) {
                return;
            }

            if (this.html_build_task) |html_build_task| {
                this.plugins = null;
                html_build_task.onComplete(this);
                return;
            }

            const promise = this.promise.swap();

            switch (this.result) {
                .pending => unreachable,
                .err => brk: {
                    if (this.config.throw_on_error) {
                        promise.reject(globalThis, this.log.toJSAggregateError(globalThis, bun.String.static("Bundle failed")));
                        break :brk;
                    }

                    const root_obj = JSC.JSValue.createEmptyObject(globalThis, 3);
                    root_obj.put(globalThis, JSC.ZigString.static("outputs"), JSC.JSValue.createEmptyArray(globalThis, 0));
                    root_obj.put(
                        globalThis,
                        JSC.ZigString.static("success"),
                        JSC.JSValue.jsBoolean(false),
                    );
                    root_obj.put(
                        globalThis,
                        JSC.ZigString.static("logs"),
                        this.log.toJSArray(globalThis, bun.default_allocator),
                    );
                    promise.resolve(globalThis, root_obj);
                },
                .value => |*build| {
                    const root_obj = JSC.JSValue.createEmptyObject(globalThis, 3);
                    const output_files: []options.OutputFile = build.output_files.items;
                    const output_files_js = JSC.JSValue.createEmptyArray(globalThis, output_files.len);
                    if (output_files_js == .zero) {
                        @panic("Unexpected pending JavaScript exception in JSBundleCompletionTask.onComplete. This is a bug in Bun.");
                    }

                    var to_assign_on_sourcemap: JSC.JSValue = .zero;
                    for (output_files, 0..) |*output_file, i| {
                        const result = output_file.toJS(
                            if (!this.config.outdir.isEmpty())
                                if (std.fs.path.isAbsolute(this.config.outdir.list.items))
                                    bun.default_allocator.dupe(
                                        u8,
                                        bun.path.joinAbsString(
                                            this.config.outdir.slice(),
                                            &[_]string{output_file.dest_path},
                                            .auto,
                                        ),
                                    ) catch unreachable
                                else
                                    bun.default_allocator.dupe(
                                        u8,
                                        bun.path.joinAbsString(
                                            Fs.FileSystem.instance.top_level_dir,
                                            &[_]string{ this.config.dir.slice(), this.config.outdir.slice(), output_file.dest_path },
                                            .auto,
                                        ),
                                    ) catch unreachable
                            else
                                bun.default_allocator.dupe(
                                    u8,
                                    output_file.dest_path,
                                ) catch unreachable,
                            globalThis,
                        );
                        if (to_assign_on_sourcemap != .zero) {
                            JSC.Codegen.JSBuildArtifact.sourcemapSetCached(to_assign_on_sourcemap, globalThis, result);
                            if (to_assign_on_sourcemap.as(JSC.API.BuildArtifact)) |to_assign_on_sourcemap_artifact| {
                                to_assign_on_sourcemap_artifact.sourcemap.set(globalThis, result);
                            }
                            to_assign_on_sourcemap = .zero;
                        }

                        if (output_file.source_map_index != std.math.maxInt(u32)) {
                            to_assign_on_sourcemap = result;
                        }

                        output_files_js.putIndex(globalThis, @as(u32, @intCast(i)), result);
                    }

                    root_obj.put(globalThis, JSC.ZigString.static("outputs"), output_files_js);
                    root_obj.put(
                        globalThis,
                        JSC.ZigString.static("success"),
                        JSC.JSValue.jsBoolean(true),
                    );
                    root_obj.put(
                        globalThis,
                        JSC.ZigString.static("logs"),
                        this.log.toJSArray(globalThis, bun.default_allocator),
                    );
                    promise.resolve(globalThis, root_obj);
                },
            }

            if (Environment.isDebug) {
                bun.assert(promise.status(globalThis.vm()) != .pending);
            }
        }
    };

    pub fn onLoadAsync(this: *BundleV2, load: *bun.JSC.API.JSBundler.Load) void {
        switch (this.loop().*) {
            .js => |jsc_event_loop| {
                jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(load, onLoadFromJsLoop));
            },
            .mini => |*mini| {
                mini.enqueueTaskConcurrentWithExtraCtx(
                    bun.JSC.API.JSBundler.Load,
                    BundleV2,
                    load,
                    BundleV2.onLoad,
                    .task,
                );
            },
        }
    }

    pub fn onResolveAsync(this: *BundleV2, resolve: *bun.JSC.API.JSBundler.Resolve) void {
        switch (this.loop().*) {
            .js => |jsc_event_loop| {
                jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(resolve, onResolveFromJsLoop));
            },
            .mini => |*mini| {
                mini.enqueueTaskConcurrentWithExtraCtx(
                    bun.JSC.API.JSBundler.Resolve,
                    BundleV2,
                    resolve,
                    BundleV2.onResolve,
                    .task,
                );
            },
        }
    }

    pub fn onLoadFromJsLoop(load: *bun.JSC.API.JSBundler.Load) void {
        onLoad(load, load.bv2);
    }

    pub fn onLoad(load: *bun.JSC.API.JSBundler.Load, this: *BundleV2) void {
        debug("onLoad: ({d}, {s})", .{ load.source_index.get(), @tagName(load.value) });
        defer load.deinit();
        defer {
            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.graph.heap.helpCatchMemoryIssues();
            }
        }
        const log = this.transpiler.log;

        // TODO: watcher

        switch (load.value.consume()) {
            .no_match => {
                const source = &this.graph.input_files.items(.source)[load.source_index.get()];
                // If it's a file namespace, we should run it through the parser like normal.
                // The file could be on disk.
                if (source.path.isFile()) {
                    this.graph.pool.schedule(load.parse_task);
                    return;
                }

                // When it's not a file, this is a build error and we should report it.
                // we have no way of loading non-files.
                log.addErrorFmt(source, Logger.Loc.Empty, bun.default_allocator, "Module not found {} in namespace {}", .{
                    bun.fmt.quote(source.path.pretty),
                    bun.fmt.quote(source.path.namespace),
                }) catch {};

                // An error occurred, prevent spinning the event loop forever
                this.decrementScanCounter();
            },
            .success => |code| {
                const should_copy_for_bundling = load.parse_task.defer_copy_for_bundling and code.loader.shouldCopyForBundling();
                if (should_copy_for_bundling) {
                    const source_index = load.source_index;
                    var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                    additional_files.push(this.graph.allocator, .{ .source_index = source_index.get() }) catch unreachable;
                    this.graph.input_files.items(.side_effects)[source_index.get()] = .no_side_effects__pure_data;
                    this.graph.estimated_file_loader_count += 1;
                }
                this.graph.input_files.items(.loader)[load.source_index.get()] = code.loader;
                this.graph.input_files.items(.source)[load.source_index.get()].contents = code.source_code;
                this.graph.input_files.items(.is_plugin_file)[load.source_index.get()] = true;
                var parse_task = load.parse_task;
                parse_task.loader = code.loader;
                if (!should_copy_for_bundling) this.free_list.append(code.source_code) catch unreachable;
                parse_task.contents_or_fd = .{
                    .contents = code.source_code,
                };
                this.graph.pool.schedule(parse_task);

                if (this.bun_watcher) |watcher| add_watchers: {
                    if (!this.shouldAddWatcherPlugin(load.namespace, load.path)) break :add_watchers;

                    // TODO: support explicit watchFiles array. this is not done
                    // right now because DevServer requires a table to map
                    // watched files and dirs to their respective dependants.
                    const fd = if (bun.Watcher.requires_file_descriptors)
                        switch (bun.sys.open(
                            &(std.posix.toPosixPath(load.path) catch break :add_watchers),
                            bun.c.O_EVTONLY,
                            0,
                        )) {
                            .result => |fd| fd,
                            .err => break :add_watchers,
                        }
                    else
                        bun.invalid_fd;

                    _ = watcher.addFile(
                        fd,
                        load.path,
                        bun.Watcher.getHash(load.path),
                        code.loader,
                        bun.invalid_fd,
                        null,
                        true,
                    );
                }
            },
            .err => |msg| {
                if (this.transpiler.options.dev_server) |dev| {
                    const source = &this.graph.input_files.items(.source)[load.source_index.get()];
                    // A stack-allocated Log object containing the singular message
                    var msg_mut = msg;
                    const temp_log: Logger.Log = .{
                        .clone_line_text = false,
                        .errors = @intFromBool(msg.kind == .err),
                        .warnings = @intFromBool(msg.kind == .warn),
                        .msgs = std.ArrayList(Logger.Msg).fromOwnedSlice(this.graph.allocator, (&msg_mut)[0..1]),
                    };
                    dev.handleParseTaskFailure(
                        error.Plugin,
                        load.bakeGraph(),
                        source.path.keyForIncrementalGraph(),
                        &temp_log,
                        this,
                    ) catch bun.outOfMemory();
                } else {
                    log.msgs.append(msg) catch bun.outOfMemory();
                    log.errors += @intFromBool(msg.kind == .err);
                    log.warnings += @intFromBool(msg.kind == .warn);
                }

                // An error occurred, prevent spinning the event loop forever
                this.decrementScanCounter();
            },
            .pending, .consumed => unreachable,
        }
    }

    pub fn onResolveFromJsLoop(resolve: *bun.JSC.API.JSBundler.Resolve) void {
        onResolve(resolve, resolve.bv2);
    }

    pub fn onResolve(resolve: *bun.JSC.API.JSBundler.Resolve, this: *BundleV2) void {
        defer resolve.deinit();
        defer this.decrementScanCounter();
        debug("onResolve: ({s}:{s}, {s})", .{ resolve.import_record.namespace, resolve.import_record.specifier, @tagName(resolve.value) });

        defer {
            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.graph.heap.helpCatchMemoryIssues();
            }
        }

        switch (resolve.value.consume()) {
            .no_match => {
                // If it's a file namespace, we should run it through the resolver like normal.
                //
                // The file could be on disk.
                if (strings.eqlComptime(resolve.import_record.namespace, "file")) {
                    this.runResolver(resolve.import_record, resolve.import_record.original_target);
                    return;
                }

                const log = this.logForResolutionFailures(resolve.import_record.source_file, resolve.import_record.original_target.bakeGraph());

                // When it's not a file, this is an error and we should report it.
                //
                // We have no way of loading non-files.
                if (resolve.import_record.kind == .entry_point_build) {
                    log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Module not found {} in namespace {}", .{
                        bun.fmt.quote(resolve.import_record.specifier),
                        bun.fmt.quote(resolve.import_record.namespace),
                    }) catch {};
                } else {
                    const source = &this.graph.input_files.items(.source)[resolve.import_record.importer_source_index];
                    log.addRangeErrorFmt(
                        source,
                        resolve.import_record.range,
                        bun.default_allocator,
                        "Module not found {} in namespace {}",
                        .{
                            bun.fmt.quote(resolve.import_record.specifier),
                            bun.fmt.quote(resolve.import_record.namespace),
                        },
                    ) catch {};
                }
            },
            .success => |result| {
                var out_source_index: ?Index = null;
                if (!result.external) {
                    var path = Fs.Path.init(result.path);
                    if (result.namespace.len == 0 or strings.eqlComptime(result.namespace, "file")) {
                        path.namespace = "file";
                    } else {
                        path.namespace = result.namespace;
                    }

                    const existing = this.pathToSourceIndexMap(resolve.import_record.original_target).getOrPut(this.graph.allocator, path.hashKey()) catch unreachable;
                    if (!existing.found_existing) {
                        this.free_list.appendSlice(&.{ result.namespace, result.path }) catch {};

                        path = this.pathWithPrettyInitialized(path, resolve.import_record.original_target) catch bun.outOfMemory();

                        // We need to parse this
                        const source_index = Index.init(@as(u32, @intCast(this.graph.ast.len)));
                        existing.value_ptr.* = source_index.get();
                        out_source_index = source_index;
                        this.graph.ast.append(bun.default_allocator, JSAst.empty) catch unreachable;
                        const loader = path.loader(&this.transpiler.options.loaders) orelse options.Loader.file;

                        this.graph.input_files.append(bun.default_allocator, .{
                            .source = .{
                                .path = path,
                                .contents = "",
                                .index = source_index,
                            },
                            .loader = loader,
                            .side_effects = .has_side_effects,
                        }) catch unreachable;
                        var task = bun.default_allocator.create(ParseTask) catch unreachable;
                        task.* = ParseTask{
                            .ctx = this,
                            .path = path,
                            // unknown at this point:
                            .contents_or_fd = .{
                                .fd = .{
                                    .dir = bun.invalid_fd,
                                    .file = bun.invalid_fd,
                                },
                            },
                            .side_effects = .has_side_effects,
                            .jsx = this.transpilerForTarget(resolve.import_record.original_target).options.jsx,
                            .source_index = source_index,
                            .module_type = .unknown,
                            .loader = loader,
                            .tree_shaking = this.linker.options.tree_shaking,
                            .known_target = resolve.import_record.original_target,
                        };
                        task.task.node.next = null;
                        task.io_task.node.next = null;
                        this.incrementScanCounter();

                        // Handle onLoad plugins
                        if (!this.enqueueOnLoadPluginIfNeeded(task)) {
                            if (loader.shouldCopyForBundling()) {
                                var additional_files: *BabyList(AdditionalFile) = &this.graph.input_files.items(.additional_files)[source_index.get()];
                                additional_files.push(this.graph.allocator, .{ .source_index = task.source_index.get() }) catch unreachable;
                                this.graph.input_files.items(.side_effects)[source_index.get()] = _resolver.SideEffects.no_side_effects__pure_data;
                                this.graph.estimated_file_loader_count += 1;
                            }

                            this.graph.pool.schedule(task);
                        }
                    } else {
                        out_source_index = Index.init(existing.value_ptr.*);
                        bun.default_allocator.free(result.namespace);
                        bun.default_allocator.free(result.path);
                    }
                } else {
                    bun.default_allocator.free(result.namespace);
                    bun.default_allocator.free(result.path);
                }

                if (out_source_index) |source_index| {
                    const source_import_records = &this.graph.ast.items(.import_records)[resolve.import_record.importer_source_index];
                    if (source_import_records.len <= resolve.import_record.import_record_index) {
                        const entry = this.resolve_tasks_waiting_for_import_source_index.getOrPut(
                            this.graph.allocator,
                            resolve.import_record.importer_source_index,
                        ) catch bun.outOfMemory();
                        if (!entry.found_existing) {
                            entry.value_ptr.* = .{};
                        }
                        entry.value_ptr.push(
                            this.graph.allocator,
                            .{
                                .to_source_index = source_index,
                                .import_record_index = resolve.import_record.import_record_index,
                            },
                        ) catch bun.outOfMemory();
                    } else {
                        const import_record: *ImportRecord = &source_import_records.slice()[resolve.import_record.import_record_index];
                        import_record.source_index = source_index;
                    }
                }
            },
            .err => |err| {
                const log = this.logForResolutionFailures(resolve.import_record.source_file, resolve.import_record.original_target.bakeGraph());
                log.msgs.append(err) catch unreachable;
                log.errors += @as(u32, @intFromBool(err.kind == .err));
                log.warnings += @as(u32, @intFromBool(err.kind == .warn));
            },
            .pending, .consumed => unreachable,
        }
    }

    pub fn deinit(this: *BundleV2) void {
        {
            // We do this first to make it harder for any dangling pointers to data to be used in there.
            var on_parse_finalizers = this.finalizers;
            this.finalizers = .{};
            for (on_parse_finalizers.items) |finalizer| {
                finalizer.call();
            }
            on_parse_finalizers.deinit(bun.default_allocator);
        }

        defer this.graph.ast.deinit(bun.default_allocator);
        defer this.graph.input_files.deinit(bun.default_allocator);
        if (this.graph.pool.workers_assignments.count() > 0) {
            {
                this.graph.pool.workers_assignments_lock.lock();
                defer this.graph.pool.workers_assignments_lock.unlock();
                for (this.graph.pool.workers_assignments.values()) |worker| {
                    worker.deinitSoon();
                }
                this.graph.pool.workers_assignments.deinit();
            }

            this.graph.pool.worker_pool.wakeForIdleEvents();
        }

        for (this.free_list.items) |free| {
            bun.default_allocator.free(free);
        }

        this.free_list.clearAndFree();
    }

    pub fn runFromJSInNewThread(
        this: *BundleV2,
        entry_points: []const []const u8,
    ) !std.ArrayList(options.OutputFile) {
        this.unique_key = generateUniqueKey();

        if (this.transpiler.log.errors > 0) {
            return error.BuildFailed;
        }

        this.graph.heap.helpCatchMemoryIssues();

        try this.enqueueEntryPoints(.normal, entry_points);

        // We must wait for all the parse tasks to complete, even if there are errors.
        this.waitForParse();

        this.graph.heap.helpCatchMemoryIssues();

        if (this.transpiler.log.errors > 0) {
            return error.BuildFailed;
        }

        try this.processServerComponentManifestFiles();

        this.graph.heap.helpCatchMemoryIssues();

        try this.cloneAST();

        this.graph.heap.helpCatchMemoryIssues();

        const reachable_files = try this.findReachableFiles();

        try this.processFilesToCopy(reachable_files);

        try this.addServerComponentBoundariesAsExtraEntryPoints();

        const chunks = try this.linker.link(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            reachable_files,
        );

        if (this.transpiler.log.errors > 0) {
            return error.BuildFailed;
        }

        return try this.linker.generateChunksInParallel(chunks, false);
    }

    fn shouldAddWatcherPlugin(bv2: *BundleV2, namespace: []const u8, path: []const u8) bool {
        return bun.strings.eqlComptime(namespace, "file") and
            std.fs.path.isAbsolute(path) and
            bv2.shouldAddWatcher(path);
    }

    fn shouldAddWatcher(bv2: *BundleV2, path: []const u8) bool {
        return if (bv2.transpiler.options.dev_server != null)
            bun.strings.indexOf(path, "/node_modules/") == null and
                (if (Environment.isWindows) bun.strings.indexOf(path, "\\node_modules\\") == null else true)
        else
            true; // `bun build --watch` has always watched node_modules
    }

    /// Dev Server uses this instead to run a subset of the transpiler, and to run it asynchronously.
    pub fn startFromBakeDevServer(this: *BundleV2, bake_entry_points: bake.DevServer.EntryPointList) !DevServerInput {
        this.unique_key = generateUniqueKey();

        this.graph.heap.helpCatchMemoryIssues();

        var ctx: DevServerInput = .{ .css_entry_points = .{} };
        try this.enqueueEntryPoints(.dev_server, .{
            .files = bake_entry_points,
            .css_data = &ctx.css_entry_points,
        });

        this.graph.heap.helpCatchMemoryIssues();

        return ctx;
    }

    pub fn finishFromBakeDevServer(this: *BundleV2, dev_server: *bake.DevServer) bun.OOM!void {
        const start = &dev_server.current_bundle.?.start_data;

        this.graph.heap.helpCatchMemoryIssues();

        try this.cloneAST();

        this.graph.heap.helpCatchMemoryIssues();

        this.dynamic_import_entry_points = .init(this.graph.allocator);
        var html_files: std.AutoArrayHashMapUnmanaged(Index, void) = .{};

        // Separate non-failing files into two lists: JS and CSS
        const js_reachable_files = reachable_files: {
            var css_total_files = try std.ArrayListUnmanaged(Index).initCapacity(this.graph.allocator, this.graph.css_file_count);
            try start.css_entry_points.ensureUnusedCapacity(this.graph.allocator, this.graph.css_file_count);
            var js_files = try std.ArrayListUnmanaged(Index).initCapacity(this.graph.allocator, this.graph.ast.len - this.graph.css_file_count - 1);

            const asts = this.graph.ast.slice();
            const css_asts = asts.items(.css);

            const input_files = this.graph.input_files.slice();
            const loaders = input_files.items(.loader);
            const sources = input_files.items(.source);
            for (
                asts.items(.parts)[1..],
                asts.items(.import_records)[1..],
                css_asts[1..],
                asts.items(.target)[1..],
                1..,
            ) |part_list, import_records, maybe_css, target, index| {
                // Dev Server proceeds even with failed files.
                // These files are filtered out via the lack of any parts.
                //
                // Actual empty files will contain a part exporting an empty object.
                if (part_list.len != 0) {
                    if (maybe_css != null) {
                        // CSS has restrictions on what files can be imported.
                        // This means the file can become an error after
                        // resolution, which is not usually the case.
                        css_total_files.appendAssumeCapacity(Index.init(index));
                        var log = Logger.Log.init(this.graph.allocator);
                        defer log.deinit();
                        if (this.linker.scanCSSImports(
                            @intCast(index),
                            import_records.slice(),
                            css_asts,
                            sources,
                            loaders,
                            &log,
                        ) == .errors) {
                            // TODO: it could be possible for a plugin to change
                            // the type of loader from whatever it was into a
                            // css-compatible loader.
                            try dev_server.handleParseTaskFailure(
                                error.InvalidCssImport,
                                .client,
                                sources[index].path.text,
                                &log,
                                this,
                            );
                            // Since there is an error, do not treat it as a
                            // valid CSS chunk.
                            _ = start.css_entry_points.swapRemove(Index.init(index));
                        }
                    } else {
                        // HTML files are special cased because they correspond
                        // to routes in DevServer. They have a JS chunk too,
                        // derived off of the import record list.
                        if (loaders[index] == .html) {
                            try html_files.put(this.graph.allocator, Index.init(index), {});
                        } else {
                            js_files.appendAssumeCapacity(Index.init(index));

                            // Mark every part live.
                            for (part_list.slice()) |*p| {
                                p.is_live = true;
                            }
                        }

                        // Discover all CSS roots.
                        for (import_records.slice()) |*record| {
                            if (!record.source_index.isValid()) continue;
                            if (loaders[record.source_index.get()] != .css) continue;
                            if (asts.items(.parts)[record.source_index.get()].len == 0) {
                                record.source_index = Index.invalid;
                                continue;
                            }

                            const gop = start.css_entry_points.getOrPutAssumeCapacity(record.source_index);
                            if (target != .browser)
                                gop.value_ptr.* = .{ .imported_on_server = true }
                            else if (!gop.found_existing)
                                gop.value_ptr.* = .{ .imported_on_server = false };
                        }
                    }
                } else {
                    // Treat empty CSS files for removal.
                    _ = start.css_entry_points.swapRemove(Index.init(index));
                }
            }

            // Find CSS entry points. Originally, this was computed up front, but
            // failed files do not remember their loader, and plugins can
            // asynchronously decide a file is CSS.
            const css = asts.items(.css);
            for (this.graph.entry_points.items) |entry_point| {
                if (css[entry_point.get()] != null) {
                    try start.css_entry_points.put(
                        this.graph.allocator,
                        entry_point,
                        .{ .imported_on_server = false },
                    );
                }
            }

            break :reachable_files js_files.items;
        };

        this.graph.heap.helpCatchMemoryIssues();

        // HMR skips most of the linker! All linking errors are converted into
        // runtime errors to avoid a more complicated dependency graph. For
        // example, if you remove an exported symbol, we only rebuild the
        // changed file, then detect the missing export at runtime.
        //
        // Additionally, notice that we run this code generation even if we have
        // files that failed. This allows having a large build graph (importing
        // a new npm dependency), where one file that fails doesnt prevent the
        // passing files to get cached in the incremental graph.

        // The linker still has to be initialized as code generation expects
        // much of its state to be valid memory, even if empty.
        try this.linker.load(
            this,
            this.graph.entry_points.items,
            this.graph.server_component_boundaries,
            js_reachable_files,
        );

        this.graph.heap.helpCatchMemoryIssues();

        // Compute line offset tables and quoted contents, used in source maps.
        // Quoted contents will be default-allocated
        if (Environment.isDebug) for (js_reachable_files) |idx| {
            bun.assert(this.graph.ast.items(.parts)[idx.get()].len != 0); // will create a memory leak
        };
        this.linker.computeDataForSourceMap(@as([]Index.Int, @ptrCast(js_reachable_files)));
        errdefer {
            // reminder that the caller cannot handle this error, since source contents
            // are default-allocated. the only option is to crash here.
            bun.outOfMemory();
        }

        this.graph.heap.helpCatchMemoryIssues();

        // Generate chunks
        const js_part_ranges = try this.graph.allocator.alloc(PartRange, js_reachable_files.len);
        const parts = this.graph.ast.items(.parts);
        for (js_reachable_files, js_part_ranges) |source_index, *part_range| {
            part_range.* = .{
                .source_index = source_index,
                .part_index_begin = 0,
                .part_index_end = parts[source_index.get()].len,
            };
        }

        const chunks = try this.graph.allocator.alloc(
            Chunk,
            1 + start.css_entry_points.count() + html_files.count(),
        );

        // First is a chunk to contain all JavaScript modules.
        chunks[0] = .{
            .entry_point = .{
                .entry_point_id = 0,
                .source_index = 0,
                .is_entry_point = true,
            },
            .content = .{
                .javascript = .{
                    // TODO(@paperclover): remove this ptrCast when Source Index is fixed
                    .files_in_chunk_order = @ptrCast(js_reachable_files),
                    .parts_in_chunk_in_order = js_part_ranges,
                },
            },
            .output_source_map = sourcemap.SourceMapPieces.init(this.graph.allocator),
        };

        // Then all the distinct CSS bundles (these are JS->CSS, not CSS->CSS)
        for (chunks[1..][0..start.css_entry_points.count()], start.css_entry_points.keys()) |*chunk, entry_point| {
            const order = this.linker.findImportedFilesInCSSOrder(this.graph.allocator, &.{entry_point});
            chunk.* = .{
                .entry_point = .{
                    .entry_point_id = @intCast(entry_point.get()),
                    .source_index = entry_point.get(),
                    .is_entry_point = false,
                },
                .content = .{
                    .css = .{
                        .imports_in_chunk_in_order = order,
                        .asts = try this.graph.allocator.alloc(bun.css.BundlerStyleSheet, order.len),
                    },
                },
                .output_source_map = sourcemap.SourceMapPieces.init(this.graph.allocator),
            };
        }

        // Then all HTML files
        for (html_files.keys(), chunks[1 + start.css_entry_points.count() ..]) |source_index, *chunk| {
            chunk.* = .{
                .entry_point = .{
                    .entry_point_id = @intCast(source_index.get()),
                    .source_index = source_index.get(),
                    .is_entry_point = false,
                },
                .content = .html,
                .output_source_map = sourcemap.SourceMapPieces.init(this.graph.allocator),
            };
        }

        this.graph.heap.helpCatchMemoryIssues();

        try this.linker.generateChunksInParallel(chunks, true);
        errdefer {
            // reminder that the caller cannot handle this error, since
            // the contents in this generation are default-allocated.
            bun.outOfMemory();
        }

        this.graph.heap.helpCatchMemoryIssues();

        try dev_server.finalizeBundle(this, .{
            .chunks = chunks,
            .css_file_list = start.css_entry_points,
            .html_files = html_files,
        });
    }

    pub fn enqueueOnResolvePluginIfNeeded(
        this: *BundleV2,
        source_index: Index.Int,
        import_record: *const ImportRecord,
        source_file: []const u8,
        import_record_index: u32,
        original_target: options.Target,
    ) bool {
        if (this.plugins) |plugins| {
            if (plugins.hasAnyMatches(&import_record.path, false)) {
                // This is where onResolve plugins are enqueued
                var resolve: *JSC.API.JSBundler.Resolve = bun.default_allocator.create(JSC.API.JSBundler.Resolve) catch unreachable;
                debug("enqueue onResolve: {s}:{s}", .{
                    import_record.path.namespace,
                    import_record.path.text,
                });
                this.incrementScanCounter();

                resolve.* = JSC.API.JSBundler.Resolve.init(this, .{
                    .kind = import_record.kind,
                    .source_file = source_file,
                    .namespace = import_record.path.namespace,
                    .specifier = import_record.path.text,
                    .importer_source_index = source_index,
                    .import_record_index = import_record_index,
                    .range = import_record.range,
                    .original_target = original_target,
                });

                resolve.dispatch();
                return true;
            }
        }

        return false;
    }

    pub fn enqueueOnLoadPluginIfNeeded(this: *BundleV2, parse: *ParseTask) bool {
        const had_matches = enqueueOnLoadPluginIfNeededImpl(this, parse);
        if (had_matches) return true;

        if (bun.strings.eqlComptime(parse.path.namespace, "dataurl")) {
            const maybe_data_url = DataURL.parse(parse.path.text) catch return false;
            const data_url = maybe_data_url orelse return false;
            const maybe_decoded = data_url.decodeData(bun.default_allocator) catch return false;
            this.free_list.append(maybe_decoded) catch bun.outOfMemory();
            parse.contents_or_fd = .{
                .contents = maybe_decoded,
            };
            parse.loader = switch (data_url.decodeMimeType().category) {
                .javascript => .js,
                .css => .css,
                .json => .json,
                else => parse.loader,
            };
        }

        return false;
    }

    pub fn enqueueOnLoadPluginIfNeededImpl(this: *BundleV2, parse: *ParseTask) bool {
        if (this.plugins) |plugins| {
            if (plugins.hasAnyMatches(&parse.path, true)) {
                if (parse.is_entry_point and parse.loader != null and parse.loader.?.shouldCopyForBundling()) {
                    parse.defer_copy_for_bundling = true;
                }
                // This is where onLoad plugins are enqueued
                debug("enqueue onLoad: {s}:{s}", .{
                    parse.path.namespace,
                    parse.path.text,
                });
                const load = bun.default_allocator.create(JSC.API.JSBundler.Load) catch bun.outOfMemory();
                load.* = JSC.API.JSBundler.Load.init(this, parse);
                load.dispatch();
                return true;
            }
        }

        return false;
    }

    fn pathWithPrettyInitialized(this: *BundleV2, path: Fs.Path, target: options.Target) !Fs.Path {
        return genericPathWithPrettyInitialized(path, target, this.transpiler.fs.top_level_dir, this.graph.allocator);
    }

    fn reserveSourceIndexesForBake(this: *BundleV2) !void {
        const fw = this.framework orelse return;
        _ = fw.server_components orelse return;

        // Call this after
        bun.assert(this.graph.input_files.len == 1);
        bun.assert(this.graph.ast.len == 1);

        try this.graph.ast.ensureUnusedCapacity(this.graph.allocator, 2);
        try this.graph.input_files.ensureUnusedCapacity(this.graph.allocator, 2);

        const server_source = bake.server_virtual_source;
        const client_source = bake.client_virtual_source;

        this.graph.input_files.appendAssumeCapacity(.{
            .source = server_source,
            .loader = .js,
            .side_effects = .no_side_effects__pure_data,
        });
        this.graph.input_files.appendAssumeCapacity(.{
            .source = client_source,
            .loader = .js,
            .side_effects = .no_side_effects__pure_data,
        });

        bun.assert(this.graph.input_files.items(.source)[Index.bake_server_data.get()].index.get() == Index.bake_server_data.get());
        bun.assert(this.graph.input_files.items(.source)[Index.bake_client_data.get()].index.get() == Index.bake_client_data.get());

        this.graph.ast.appendAssumeCapacity(JSAst.empty);
        this.graph.ast.appendAssumeCapacity(JSAst.empty);
    }

    // TODO: remove ResolveQueue
    //
    // Moving this to the Bundle thread was a significant perf improvement on Linux for first builds
    //
    // The problem is that module resolution has many mutexes.
    // The downside is cached resolutions are faster to do in threads since they only lock very briefly.
    fn runResolutionForParseTask(parse_result: *ParseTask.Result, this: *BundleV2) ResolveQueue {
        var ast = &parse_result.value.success.ast;
        const source = &parse_result.value.success.source;
        const loader = parse_result.value.success.loader;
        const source_dir = source.path.sourceDir();
        var estimated_resolve_queue_count: usize = 0;
        for (ast.import_records.slice()) |*import_record| {
            if (import_record.is_internal) {
                import_record.tag = .runtime;
                import_record.source_index = Index.runtime;
            }

            if (import_record.is_unused) {
                import_record.source_index = Index.invalid;
            }

            estimated_resolve_queue_count += @as(usize, @intFromBool(!(import_record.is_internal or import_record.is_unused or import_record.source_index.isValid())));
        }
        var resolve_queue = ResolveQueue.init(this.graph.allocator);
        resolve_queue.ensureTotalCapacity(estimated_resolve_queue_count) catch bun.outOfMemory();

        var last_error: ?anyerror = null;

        outer: for (ast.import_records.slice(), 0..) |*import_record, i| {
            if (
            // Don't resolve TypeScript types
            import_record.is_unused or

                // Don't resolve the runtime
                import_record.is_internal or

                // Don't resolve pre-resolved imports
                import_record.source_index.isValid())
            {
                continue;
            }

            if (this.framework) |fw| if (fw.server_components != null) {
                switch (ast.target.isServerSide()) {
                    inline else => |is_server| {
                        const src = if (is_server) bake.server_virtual_source else bake.client_virtual_source;
                        if (strings.eqlComptime(import_record.path.text, src.path.pretty)) {
                            if (this.transpiler.options.dev_server != null) {
                                import_record.is_external_without_side_effects = true;
                                import_record.source_index = Index.invalid;
                            } else {
                                if (is_server) {
                                    this.graph.kit_referenced_server_data = true;
                                } else {
                                    this.graph.kit_referenced_client_data = true;
                                }
                                import_record.path.namespace = "bun";
                                import_record.source_index = src.index;
                            }
                            continue;
                        }
                    },
                }
            };

            if (strings.eqlComptime(import_record.path.text, "bun:wrap")) {
                import_record.path.namespace = "bun";
                import_record.tag = .runtime;
                import_record.path.text = "wrap";
                import_record.source_index = .runtime;
                continue;
            }

            if (ast.target.isBun()) {
                if (JSC.HardcodedModule.Alias.get(import_record.path.text, .bun)) |replacement| {
                    // When bundling node builtins, remove the "node:" prefix.
                    // This supports special use cases where the bundle is put
                    // into a non-node module resolver that doesn't support
                    // node's prefix. https://github.com/oven-sh/bun/issues/18545
                    import_record.path.text = if (replacement.node_builtin and !replacement.node_only_prefix)
                        replacement.path[5..]
                    else
                        replacement.path;
                    import_record.tag = replacement.tag;
                    import_record.source_index = Index.invalid;
                    import_record.is_external_without_side_effects = true;
                    continue;
                }

                if (this.transpiler.options.rewrite_jest_for_tests) {
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
                        import_record.is_external_without_side_effects = true;
                        continue;
                    }
                }

                if (strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                    import_record.path = Fs.Path.init(import_record.path.text["bun:".len..]);
                    import_record.path.namespace = "bun";
                    import_record.source_index = Index.invalid;
                    import_record.is_external_without_side_effects = true;

                    if (strings.eqlComptime(import_record.path.text, "test")) {
                        import_record.tag = .bun_test;
                    }

                    // don't link bun
                    continue;
                }
            }

            // By default, we treat .sqlite files as external.
            if (import_record.loader != null and import_record.loader.? == .sqlite) {
                import_record.is_external_without_side_effects = true;
                continue;
            }

            if (import_record.loader != null and import_record.loader.? == .sqlite_embedded) {
                import_record.is_external_without_side_effects = true;
            }

            if (this.enqueueOnResolvePluginIfNeeded(source.index.get(), import_record, source.path.text, @as(u32, @truncate(i)), ast.target)) {
                continue;
            }

            const transpiler, const bake_graph: bake.Graph, const target =
                if (import_record.tag == .bake_resolve_to_ssr_graph) brk: {
                    if (this.framework == null) {
                        this.logForResolutionFailures(source.path.text, .ssr).addErrorFmt(
                            source,
                            import_record.range.loc,
                            this.graph.allocator,
                            "The 'bunBakeGraph' import attribute cannot be used outside of a Bun Bake bundle",
                            .{},
                        ) catch @panic("unexpected log error");
                        continue;
                    }

                    const is_supported = this.framework.?.server_components != null and
                        this.framework.?.server_components.?.separate_ssr_graph;
                    if (!is_supported) {
                        this.logForResolutionFailures(source.path.text, .ssr).addErrorFmt(
                            source,
                            import_record.range.loc,
                            this.graph.allocator,
                            "Framework does not have a separate SSR graph to put this import into",
                            .{},
                        ) catch @panic("unexpected log error");
                        continue;
                    }

                    break :brk .{
                        this.ssr_transpiler,
                        .ssr,
                        .bake_server_components_ssr,
                    };
                } else .{
                    this.transpilerForTarget(ast.target),
                    ast.target.bakeGraph(),
                    ast.target,
                };

            var had_busted_dir_cache = false;
            var resolve_result = inner: while (true) break transpiler.resolver.resolveWithFramework(
                source_dir,
                import_record.path.text,
                import_record.kind,
            ) catch |err| {
                const log = this.logForResolutionFailures(source.path.text, bake_graph);

                // Only perform directory busting when hot-reloading is enabled
                if (err == error.ModuleNotFound) {
                    if (this.bun_watcher != null) {
                        if (!had_busted_dir_cache) {
                            bun.Output.scoped(.watcher, false)("busting dir cache {s} -> {s}", .{ source.path.text, import_record.path.text });
                            // Only re-query if we previously had something cached.
                            if (transpiler.resolver.bustDirCacheFromSpecifier(
                                source.path.text,
                                import_record.path.text,
                            )) {
                                had_busted_dir_cache = true;
                                continue :inner;
                            }
                        }
                        if (this.transpiler.options.dev_server) |dev| {
                            // Tell DevServer about the resolution failure.
                            dev.directory_watchers.trackResolutionFailure(
                                source.path.text,
                                import_record.path.text,
                                ast.target.bakeGraph(), // use the source file target not the altered one
                                loader,
                            ) catch bun.outOfMemory();
                        }
                    }
                }

                // Disable failing packages from being printed.
                // This may cause broken code to write.
                // However, doing this means we tell them all the resolve errors
                // Rather than just the first one.
                import_record.path.is_disabled = true;

                switch (err) {
                    error.ModuleNotFound => {
                        const addError = Logger.Log.addResolveErrorWithTextDupe;

                        if (!import_record.handles_import_errors and !this.transpiler.options.ignore_module_resolution_errors) {
                            last_error = err;
                            if (isPackagePath(import_record.path.text)) {
                                if (ast.target == .browser and options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.graph.allocator,
                                        "Browser build cannot {s} Node.js builtin: \"{s}\"{s}",
                                        .{
                                            import_record.kind.errorLabel(),
                                            import_record.path.text,
                                            if (this.transpiler.options.dev_server == null)
                                                ". To use Node.js builtins, set target to 'node' or 'bun'"
                                            else
                                                "",
                                        },
                                        import_record.kind,
                                    ) catch bun.outOfMemory();
                                } else if (!ast.target.isBun() and strings.eqlComptime(import_record.path.text, "bun")) {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.graph.allocator,
                                        "Browser build cannot {s} Bun builtin: \"{s}\"{s}",
                                        .{
                                            import_record.kind.errorLabel(),
                                            import_record.path.text,
                                            if (this.transpiler.options.dev_server == null)
                                                ". When bundling for Bun, set target to 'bun'"
                                            else
                                                "",
                                        },
                                        import_record.kind,
                                    ) catch bun.outOfMemory();
                                } else if (!ast.target.isBun() and strings.hasPrefixComptime(import_record.path.text, "bun:")) {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.graph.allocator,
                                        "Browser build cannot {s} Bun builtin: \"{s}\"{s}",
                                        .{
                                            import_record.kind.errorLabel(),
                                            import_record.path.text,
                                            if (this.transpiler.options.dev_server == null)
                                                ". When bundling for Bun, set target to 'bun'"
                                            else
                                                "",
                                        },
                                        import_record.kind,
                                    ) catch bun.outOfMemory();
                                } else {
                                    addError(
                                        log,
                                        source,
                                        import_record.range,
                                        this.graph.allocator,
                                        "Could not resolve: \"{s}\". Maybe you need to \"bun install\"?",
                                        .{import_record.path.text},
                                        import_record.kind,
                                    ) catch bun.outOfMemory();
                                }
                            } else {
                                const buf = bun.PathBufferPool.get();
                                defer bun.PathBufferPool.put(buf);
                                const specifier_to_use = if (loader == .html and bun.strings.hasPrefix(import_record.path.text, bun.fs.FileSystem.instance.top_level_dir)) brk: {
                                    const specifier_to_use = import_record.path.text[bun.fs.FileSystem.instance.top_level_dir.len..];
                                    if (Environment.isWindows) {
                                        break :brk bun.path.pathToPosixBuf(u8, specifier_to_use, buf);
                                    }
                                    break :brk specifier_to_use;
                                } else import_record.path.text;
                                addError(
                                    log,
                                    source,
                                    import_record.range,
                                    this.graph.allocator,
                                    "Could not resolve: \"{s}\"",
                                    .{specifier_to_use},
                                    import_record.kind,
                                ) catch bun.outOfMemory();
                            }
                        }
                    },
                    // assume other errors are already in the log
                    else => {
                        last_error = err;
                    },
                }
                continue :outer;
            };
            // if there were errors, lets go ahead and collect them all
            if (last_error != null) continue;

            const path: *Fs.Path = resolve_result.path() orelse {
                import_record.path.is_disabled = true;
                import_record.source_index = Index.invalid;

                continue;
            };

            if (resolve_result.is_external) {
                if (resolve_result.is_external_and_rewrite_import_path and !strings.eqlLong(resolve_result.path_pair.primary.text, import_record.path.text, true)) {
                    import_record.path = resolve_result.path_pair.primary;
                }
                import_record.is_external_without_side_effects = resolve_result.primary_side_effects_data != .has_side_effects;
                continue;
            }

            if (this.transpiler.options.dev_server) |dev_server| brk: {
                if (path.loader(&this.transpiler.options.loaders) == .html) {
                    // This use case is currently not supported. This error
                    // blocks an assertion failure because the DevServer
                    // reserves the HTML file's spot in IncrementalGraph for the
                    // route definition.
                    const log = this.logForResolutionFailures(source.path.text, bake_graph);
                    log.addRangeErrorFmt(
                        source,
                        import_record.range,
                        this.graph.allocator,
                        "Browser builds cannot import HTML files.",
                        .{},
                    ) catch bun.outOfMemory();
                    continue;
                }

                if (loader == .css) {
                    // Do not use cached files for CSS.
                    break :brk;
                }

                import_record.source_index = Index.invalid;

                if (dev_server.isFileCached(path.text, bake_graph)) |entry| {
                    const rel = bun.path.relativePlatform(this.transpiler.fs.top_level_dir, path.text, .loose, false);
                    if (loader == .html and entry.kind == .asset) {
                        // Overload `path.text` to point to the final URL
                        // This information cannot be queried while printing because a lock wouldn't get held.
                        const hash = dev_server.assets.getHash(path.text) orelse @panic("cached asset not found");
                        import_record.path.text = path.text;
                        import_record.path.namespace = "file";
                        import_record.path.pretty = std.fmt.allocPrint(this.graph.allocator, bun.bake.DevServer.asset_prefix ++ "/{s}{s}", .{
                            &std.fmt.bytesToHex(std.mem.asBytes(&hash), .lower),
                            std.fs.path.extension(path.text),
                        }) catch bun.outOfMemory();
                        import_record.path.is_disabled = false;
                    } else {
                        import_record.path.text = path.text;
                        import_record.path.pretty = rel;
                        import_record.path = this.pathWithPrettyInitialized(path.*, target) catch bun.outOfMemory();
                        if (loader == .html or entry.kind == .css) {
                            import_record.path.is_disabled = true;
                        }
                    }
                    continue;
                }
            }

            const hash_key = path.hashKey();

            if (this.pathToSourceIndexMap(target).get(hash_key)) |id| {
                if (this.transpiler.options.dev_server != null and loader != .html) {
                    import_record.path = this.graph.input_files.items(.source)[id].path;
                } else {
                    import_record.source_index = Index.init(id);
                }
                continue;
            }

            const resolve_entry = resolve_queue.getOrPut(hash_key) catch bun.outOfMemory();
            if (resolve_entry.found_existing) {
                import_record.path = resolve_entry.value_ptr.*.path;
                continue;
            }

            path.* = this.pathWithPrettyInitialized(path.*, target) catch bun.outOfMemory();

            var secondary_path_to_copy: ?Fs.Path = null;
            if (resolve_result.path_pair.secondary) |*secondary| {
                if (!secondary.is_disabled and
                    secondary != path and
                    !strings.eqlLong(secondary.text, path.text, true))
                {
                    secondary_path_to_copy = secondary.dupeAlloc(this.graph.allocator) catch bun.outOfMemory();
                }
            }

            import_record.path = path.*;
            debug("created ParseTask: {s}", .{path.text});

            const resolve_task = bun.default_allocator.create(ParseTask) catch bun.outOfMemory();
            resolve_task.* = ParseTask.init(&resolve_result, Index.invalid, this);
            resolve_task.secondary_path_for_commonjs_interop = secondary_path_to_copy;
            resolve_task.known_target = target;
            resolve_task.jsx = resolve_result.jsx;
            resolve_task.jsx.development = switch (transpiler.options.force_node_env) {
                .development => true,
                .production => false,
                .unspecified => transpiler.options.jsx.development,
            };

            // Figure out the loader.
            {
                if (import_record.loader) |l| {
                    resolve_task.loader = l;
                }

                if (resolve_task.loader == null) {
                    resolve_task.loader = path.loader(&this.transpiler.options.loaders);
                    resolve_task.tree_shaking = this.transpiler.options.tree_shaking;
                }

                // HTML must be an entry point.
                if (resolve_task.loader) |*l| {
                    l.* = l.disableHTML();
                }
            }

            resolve_entry.value_ptr.* = resolve_task;
        }

        if (last_error) |err| {
            debug("failed with error: {s}", .{@errorName(err)});
            resolve_queue.clearAndFree();
            parse_result.value = .{
                .err = .{
                    .err = err,
                    .step = .resolve,
                    .log = Logger.Log.init(bun.default_allocator),
                    .source_index = source.index,
                    .target = ast.target,
                },
            };
        }

        return resolve_queue;
    }

    const ResolveQueue = std.AutoArrayHashMap(u64, *ParseTask);

    pub fn onNotifyDefer(this: *BundleV2) void {
        this.thread_lock.assertLocked();
        this.graph.deferred_pending += 1;
        this.decrementScanCounter();
    }

    pub fn onNotifyDeferMini(_: *bun.JSC.API.JSBundler.Load, this: *BundleV2) void {
        this.onNotifyDefer();
    }

    pub fn onParseTaskComplete(parse_result: *ParseTask.Result, this: *BundleV2) void {
        const trace = bun.perf.trace("Bundler.onParseTaskComplete");
        defer trace.end();
        if (parse_result.external.function != null) {
            const source = switch (parse_result.value) {
                inline .empty, .err => |data| data.source_index.get(),
                .success => |val| val.source.index.get(),
            };
            const loader: Loader = this.graph.input_files.items(.loader)[source];
            if (!loader.shouldCopyForBundling()) {
                this.finalizers.append(bun.default_allocator, parse_result.external) catch bun.outOfMemory();
            } else {
                this.graph.input_files.items(.allocator)[source] = ExternalFreeFunctionAllocator.create(parse_result.external.function.?, parse_result.external.ctx.?);
            }
        }

        defer bun.default_allocator.destroy(parse_result);

        const graph = &this.graph;

        var diff: i32 = -1;
        defer {
            logScanCounter("in parse task .pending_items += {d} = {d}\n", .{ diff, @as(i32, @intCast(graph.pending_items)) + diff });
            graph.pending_items = @intCast(@as(i32, @intCast(graph.pending_items)) + diff);
            if (diff < 0)
                this.onAfterDecrementScanCounter();
        }

        var resolve_queue = ResolveQueue.init(this.graph.allocator);
        defer resolve_queue.deinit();
        var process_log = true;

        if (parse_result.value == .success) {
            resolve_queue = runResolutionForParseTask(parse_result, this);
            if (parse_result.value == .err) {
                process_log = false;
            }
        }

        // To minimize contention, watchers are appended by the transpiler thread.
        if (this.bun_watcher) |watcher| {
            if (parse_result.watcher_data.fd != bun.invalid_fd and parse_result.watcher_data.fd != .zero) {
                const source = switch (parse_result.value) {
                    inline .empty, .err => |data| graph.input_files.items(.source)[data.source_index.get()],
                    .success => |val| val.source,
                };
                if (this.shouldAddWatcher(source.path.text)) {
                    _ = watcher.addFile(
                        parse_result.watcher_data.fd,
                        source.path.text,
                        bun.hash32(source.path.text),
                        graph.input_files.items(.loader)[source.index.get()],
                        parse_result.watcher_data.dir_fd,
                        null,
                        false,
                    );
                }
            }
        }

        switch (parse_result.value) {
            .empty => |empty_result| {
                const input_files = graph.input_files.slice();
                const side_effects = input_files.items(.side_effects);
                side_effects[empty_result.source_index.get()] = .no_side_effects__empty_ast;
                if (comptime Environment.allow_assert) {
                    debug("onParse({d}, {s}) = empty", .{
                        empty_result.source_index.get(),
                        input_files.items(.source)[empty_result.source_index.get()].path.text,
                    });
                }
            },
            .success => |*result| {
                result.log.cloneToWithRecycled(this.transpiler.log, true) catch unreachable;

                // Warning: `input_files` and `ast` arrays may resize in this function call
                // It is not safe to cache slices from them.
                graph.input_files.items(.source)[result.source.index.get()] = result.source;
                this.source_code_length += if (!result.source.index.isRuntime())
                    result.source.contents.len
                else
                    @as(usize, 0);

                graph.input_files.items(.unique_key_for_additional_file)[result.source.index.get()] = result.unique_key_for_additional_file;
                graph.input_files.items(.content_hash_for_additional_file)[result.source.index.get()] = result.content_hash_for_additional_file;
                if (result.unique_key_for_additional_file.len > 0 and result.loader.shouldCopyForBundling()) {
                    if (this.transpiler.options.dev_server) |dev| {
                        dev.putOrOverwriteAsset(
                            &result.source.path,
                            // SAFETY: when shouldCopyForBundling is true, the
                            // contents are allocated by bun.default_allocator
                            &.fromOwnedSlice(bun.default_allocator, @constCast(result.source.contents)),
                            result.content_hash_for_additional_file,
                        ) catch bun.outOfMemory();
                    }
                }

                // Record which loader we used for this file
                graph.input_files.items(.loader)[result.source.index.get()] = result.loader;

                debug("onParse({d}, {s}) = {d} imports, {d} exports", .{
                    result.source.index.get(),
                    result.source.path.text,
                    result.ast.import_records.len,
                    result.ast.named_exports.count(),
                });

                var iter = resolve_queue.iterator();

                const path_to_source_index_map = this.pathToSourceIndexMap(result.ast.target);
                while (iter.next()) |entry| {
                    const hash = entry.key_ptr.*;
                    const value = entry.value_ptr.*;

                    var existing = path_to_source_index_map.getOrPut(graph.allocator, hash) catch unreachable;

                    // If the same file is imported and required, and those point to different files
                    // Automatically rewrite it to the secondary one
                    if (value.secondary_path_for_commonjs_interop) |secondary_path| {
                        const secondary_hash = secondary_path.hashKey();
                        if (path_to_source_index_map.get(secondary_hash)) |secondary| {
                            existing.found_existing = true;
                            existing.value_ptr.* = secondary;
                        }
                    }

                    if (!existing.found_existing) {
                        var new_task: *ParseTask = value;
                        var new_input_file = Graph.InputFile{
                            .source = Logger.Source.initEmptyFile(new_task.path.text),
                            .side_effects = value.side_effects,
                        };

                        const loader = new_task.loader orelse new_input_file.source.path.loader(&this.transpiler.options.loaders) orelse options.Loader.file;

                        new_input_file.source.index = Index.source(graph.input_files.len);
                        new_input_file.source.path = new_task.path;

                        // We need to ensure the loader is set or else importstar_ts/ReExportTypeOnlyFileES6 will fail.
                        new_input_file.loader = loader;

                        existing.value_ptr.* = new_input_file.source.index.get();
                        new_task.source_index = new_input_file.source.index;

                        new_task.ctx = this;
                        graph.input_files.append(bun.default_allocator, new_input_file) catch unreachable;
                        graph.ast.append(bun.default_allocator, JSAst.empty) catch unreachable;
                        diff += 1;

                        if (this.enqueueOnLoadPluginIfNeeded(new_task)) {
                            continue;
                        }

                        if (loader.shouldCopyForBundling()) {
                            var additional_files: *BabyList(AdditionalFile) = &graph.input_files.items(.additional_files)[result.source.index.get()];
                            additional_files.push(this.graph.allocator, .{ .source_index = new_task.source_index.get() }) catch unreachable;
                            new_input_file.side_effects = _resolver.SideEffects.no_side_effects__pure_data;
                            graph.estimated_file_loader_count += 1;
                        }

                        graph.pool.schedule(new_task);
                    } else {
                        const loader = value.loader orelse
                            graph.input_files.items(.source)[existing.value_ptr.*].path.loader(&this.transpiler.options.loaders) orelse
                            options.Loader.file;

                        if (loader.shouldCopyForBundling()) {
                            var additional_files: *BabyList(AdditionalFile) = &graph.input_files.items(.additional_files)[result.source.index.get()];
                            additional_files.push(this.graph.allocator, .{ .source_index = existing.value_ptr.* }) catch unreachable;
                            graph.estimated_file_loader_count += 1;
                        }

                        bun.default_allocator.destroy(value);
                    }
                }

                var import_records = result.ast.import_records.clone(this.graph.allocator) catch unreachable;

                const input_file_loaders = this.graph.input_files.items(.loader);
                const save_import_record_source_index = this.transpiler.options.dev_server == null or
                    result.loader == .html or
                    result.loader.isCSS();

                if (this.resolve_tasks_waiting_for_import_source_index.fetchSwapRemove(result.source.index.get())) |pending_entry| {
                    for (pending_entry.value.slice()) |to_assign| {
                        if (save_import_record_source_index or
                            input_file_loaders[to_assign.to_source_index.get()].isCSS())
                        {
                            import_records.slice()[to_assign.import_record_index].source_index = to_assign.to_source_index;
                        }
                    }

                    var list = pending_entry.value.list();
                    list.deinit(this.graph.allocator);
                }

                if (result.ast.css != null) {
                    this.graph.css_file_count += 1;
                }

                for (import_records.slice(), 0..) |*record, i| {
                    if (path_to_source_index_map.get(record.path.hashKey())) |source_index| {
                        if (save_import_record_source_index or input_file_loaders[source_index] == .css)
                            record.source_index.value = source_index;

                        if (getRedirectId(result.ast.redirect_import_record_index)) |compare| {
                            if (compare == @as(u32, @truncate(i))) {
                                path_to_source_index_map.put(
                                    graph.allocator,
                                    result.source.path.hashKey(),
                                    source_index,
                                ) catch unreachable;
                            }
                        }
                    }
                }
                result.ast.import_records = import_records;

                graph.ast.set(result.source.index.get(), result.ast);

                // For files with use directives, index and prepare the other side.
                if (result.use_directive != .none and if (this.framework.?.server_components.?.separate_ssr_graph)
                    ((result.use_directive == .client) == (result.ast.target == .browser))
                else
                    ((result.use_directive == .client) != (result.ast.target == .browser)))
                {
                    if (result.use_directive == .server)
                        bun.todoPanic(@src(), "\"use server\"", .{});

                    const reference_source_index, const ssr_index = if (this.framework.?.server_components.?.separate_ssr_graph) brk: {
                        // Enqueue two files, one in server graph, one in ssr graph.
                        const reference_source_index = this.enqueueServerComponentGeneratedFile(
                            .{ .client_reference_proxy = .{
                                .other_source = result.source,
                                .named_exports = result.ast.named_exports,
                            } },
                            result.source,
                        ) catch bun.outOfMemory();

                        var ssr_source = result.source;
                        ssr_source.path.pretty = ssr_source.path.text;
                        ssr_source.path = this.pathWithPrettyInitialized(ssr_source.path, .bake_server_components_ssr) catch bun.outOfMemory();
                        const ssr_index = this.enqueueParseTask2(
                            ssr_source,
                            this.graph.input_files.items(.loader)[result.source.index.get()],
                            .bake_server_components_ssr,
                        ) catch bun.outOfMemory();

                        break :brk .{ reference_source_index, ssr_index };
                    } else brk: {
                        // Enqueue only one file
                        var server_source = result.source;
                        server_source.path.pretty = server_source.path.text;
                        server_source.path = this.pathWithPrettyInitialized(server_source.path, this.transpiler.options.target) catch bun.outOfMemory();
                        const server_index = this.enqueueParseTask2(
                            server_source,
                            this.graph.input_files.items(.loader)[result.source.index.get()],
                            .browser,
                        ) catch bun.outOfMemory();

                        break :brk .{ server_index, Index.invalid.get() };
                    };

                    this.graph.path_to_source_index_map.put(
                        graph.allocator,
                        result.source.path.hashKey(),
                        reference_source_index,
                    ) catch bun.outOfMemory();

                    graph.server_component_boundaries.put(
                        graph.allocator,
                        result.source.index.get(),
                        result.use_directive,
                        reference_source_index,
                        ssr_index,
                    ) catch bun.outOfMemory();
                }
            },
            .err => |*err| {
                if (comptime Environment.enable_logs) {
                    debug("onParse() = err", .{});
                }

                if (process_log) {
                    if (this.transpiler.options.dev_server) |dev_server| {
                        dev_server.handleParseTaskFailure(
                            err.err,
                            err.target.bakeGraph(),
                            this.graph.input_files.items(.source)[err.source_index.get()].path.text,
                            &err.log,
                            this,
                        ) catch bun.outOfMemory();
                    } else if (err.log.msgs.items.len > 0) {
                        err.log.cloneToWithRecycled(this.transpiler.log, true) catch unreachable;
                    } else {
                        this.transpiler.log.addErrorFmt(
                            null,
                            Logger.Loc.Empty,
                            this.transpiler.log.msgs.allocator,
                            "{s} while {s}",
                            .{ @errorName(err.err), @tagName(err.step) },
                        ) catch unreachable;
                    }
                }

                if (Environment.allow_assert and this.transpiler.options.dev_server != null) {
                    bun.assert(this.graph.ast.items(.parts)[err.source_index.get()].len == 0);
                }
            },
        }
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn getLoaders(vm: *BundleV2) *bun.options.Loader.HashTable {
        return &vm.transpiler.options.loaders;
    }

    /// To satisfy the interface from NewHotReloader()
    pub fn bustDirCache(vm: *BundleV2, path: []const u8) bool {
        return vm.transpiler.resolver.bustDirCache(path);
    }
};

/// Used to keep the bundle thread from spinning on Windows
pub fn timerCallback(_: *bun.windows.libuv.Timer) callconv(.C) void {}

/// Originally, bake.DevServer required a separate bundling thread, but that was
/// later removed. The bundling thread's scheduling logic is generalized over
/// the completion structure.
///
/// CompletionStruct's interface:
///
/// - `configureBundler` is used to configure `Bundler`.
/// - `completeOnBundleThread` is used to tell the task that it is done.
pub fn BundleThread(CompletionStruct: type) type {
    return struct {
        const Self = @This();

        waker: bun.Async.Waker,
        ready_event: std.Thread.ResetEvent,
        queue: bun.UnboundedQueue(CompletionStruct, .next),
        generation: bun.Generation = 0,

        /// To initialize, put this somewhere in memory, and then call `spawn()`
        pub const uninitialized: Self = .{
            .waker = undefined,
            .queue = .{},
            .generation = 0,
            .ready_event = .{},
        };

        pub fn spawn(instance: *Self) !std.Thread {
            const thread = try std.Thread.spawn(.{}, threadMain, .{instance});
            instance.ready_event.wait();
            return thread;
        }

        /// Lazily-initialized singleton. This is used for `Bun.build` since the
        /// bundle thread may not be needed.
        pub const singleton = struct {
            var once = std.once(loadOnceImpl);
            var instance: ?*Self = null;

            // Blocks the calling thread until the bun build thread is created.
            // std.once also blocks other callers of this function until the first caller is done.
            fn loadOnceImpl() void {
                const bundle_thread = bun.default_allocator.create(Self) catch bun.outOfMemory();
                bundle_thread.* = uninitialized;
                instance = bundle_thread;

                // 2. Spawn the bun build thread.
                const os_thread = bundle_thread.spawn() catch
                    Output.panic("Failed to spawn bun build thread", .{});
                os_thread.detach();
            }

            pub fn get() *Self {
                once.call();
                return instance.?;
            }

            pub fn enqueue(completion: *CompletionStruct) void {
                get().enqueue(completion);
            }
        };

        pub fn enqueue(instance: *Self, completion: *CompletionStruct) void {
            instance.queue.push(completion);
            instance.waker.wake();
        }

        fn threadMain(instance: *Self) void {
            Output.Source.configureNamedThread("Bundler");

            instance.waker = bun.Async.Waker.init() catch @panic("Failed to create waker");

            // Unblock the calling thread so it can continue.
            instance.ready_event.set();

            var timer: bun.windows.libuv.Timer = undefined;
            if (bun.Environment.isWindows) {
                timer.init(instance.waker.loop.uv_loop);
                timer.start(std.math.maxInt(u64), std.math.maxInt(u64), &timerCallback);
            }

            var has_bundled = false;
            while (true) {
                while (instance.queue.pop()) |completion| {
                    generateInNewThread(completion, instance.generation) catch |err| {
                        completion.result = .{ .err = err };
                        completion.completeOnBundleThread();
                    };
                    has_bundled = true;
                }
                instance.generation +|= 1;

                if (has_bundled) {
                    bun.Mimalloc.mi_collect(false);
                    has_bundled = false;
                }

                _ = instance.waker.wait();
            }
        }

        /// This is called from `Bun.build` in JavaScript.
        fn generateInNewThread(completion: *CompletionStruct, generation: bun.Generation) !void {
            var heap = try ThreadlocalArena.init();
            defer heap.deinit();

            const allocator = heap.allocator();
            var ast_memory_allocator = try allocator.create(js_ast.ASTMemoryAllocator);
            ast_memory_allocator.* = .{ .allocator = allocator };
            ast_memory_allocator.reset();
            ast_memory_allocator.push();

            const transpiler = try allocator.create(bun.Transpiler);

            try completion.configureBundler(transpiler, allocator);

            transpiler.resolver.generation = generation;

            const this = try BundleV2.init(
                transpiler,
                null, // TODO: Kit
                allocator,
                JSC.AnyEventLoop.init(allocator),
                false,
                JSC.WorkPool.get(),
                heap,
            );

            this.plugins = completion.plugins;
            this.completion = switch (CompletionStruct) {
                BundleV2.JSBundleCompletionTask => completion,
                else => @compileError("Unknown completion struct: " ++ CompletionStruct),
            };
            completion.transpiler = this;

            defer {
                this.graph.pool.reset();
                ast_memory_allocator.pop();
                this.deinit();
            }

            errdefer {
                // Wait for wait groups to finish. There still may be ongoing work.
                this.linker.source_maps.line_offset_wait_group.wait();
                this.linker.source_maps.quoted_contents_wait_group.wait();

                var out_log = Logger.Log.init(bun.default_allocator);
                this.transpiler.log.appendToWithRecycled(&out_log, true) catch bun.outOfMemory();
                completion.log = out_log;
            }

            completion.result = .{ .value = .{
                .output_files = try this.runFromJSInNewThread(transpiler.options.entry_points),
            } };

            var out_log = Logger.Log.init(bun.default_allocator);
            this.transpiler.log.appendToWithRecycled(&out_log, true) catch bun.outOfMemory();
            completion.log = out_log;
            completion.completeOnBundleThread();
        }
    };
}

const UseDirective = js_ast.UseDirective;
const ServerComponentBoundary = js_ast.ServerComponentBoundary;

/// This task is run once all parse and resolve tasks have been complete
/// and we have deferred onLoad plugins that we need to resume
///
/// It enqueues a task to be run on the JS thread which resolves the promise
/// for every onLoad callback which called `.defer()`.
pub const DeferredBatchTask = struct {
    running: if (Environment.isDebug) bool else u0 = if (Environment.isDebug) false else 0,

    const AnyTask = JSC.AnyTask.New(@This(), runOnJSThread);

    pub fn init(this: *DeferredBatchTask) void {
        if (comptime Environment.isDebug) bun.debugAssert(!this.running);
        this.* = .{
            .running = if (comptime Environment.isDebug) false else 0,
        };
    }

    pub fn getBundleV2(this: *DeferredBatchTask) *bun.BundleV2 {
        return @alignCast(@fieldParentPtr("drain_defer_task", this));
    }

    pub fn schedule(this: *DeferredBatchTask) void {
        if (comptime Environment.isDebug) {
            bun.assert(!this.running);
            this.running = false;
        }
        this.getBundleV2().jsLoopForPlugins().enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this)));
    }

    pub fn deinit(this: *DeferredBatchTask) void {
        if (comptime Environment.isDebug) {
            this.running = false;
        }
    }

    pub fn runOnJSThread(this: *DeferredBatchTask) void {
        defer this.deinit();
        var bv2 = this.getBundleV2();
        bv2.plugins.?.drainDeferred(
            if (bv2.completion) |completion|
                completion.result == .err
            else
                false,
        );
    }
};

const ContentsOrFd = union(enum) {
    fd: struct {
        dir: StoredFileDescriptorType,
        file: StoredFileDescriptorType,
    },
    contents: string,

    const Tag = @typeInfo(ContentsOrFd).@"union".tag_type.?;
};

pub const ParseTask = struct {
    path: Fs.Path,
    secondary_path_for_commonjs_interop: ?Fs.Path = null,
    contents_or_fd: ContentsOrFd,
    external_free_function: CacheEntry.ExternalFreeFunction = .none,
    side_effects: _resolver.SideEffects,
    loader: ?Loader = null,
    jsx: options.JSX.Pragma,
    source_index: Index = Index.invalid,
    task: ThreadPoolLib.Task = .{ .callback = &taskCallback },

    // Split this into a different task so that we don't accidentally run the
    // tasks for io on the threads that are meant for parsing.
    io_task: ThreadPoolLib.Task = .{ .callback = &ioTaskCallback },

    // Used for splitting up the work between the io and parse steps.
    stage: ParseTaskStage = .needs_source_code,

    tree_shaking: bool = false,
    known_target: options.Target,
    module_type: options.ModuleType = .unknown,
    emit_decorator_metadata: bool = false,
    ctx: *BundleV2,
    package_version: string = "",
    is_entry_point: bool = false,
    /// This is set when the file is an entrypoint, and it has an onLoad plugin.
    /// In this case we want to defer adding this to additional_files until after
    /// the onLoad plugin has finished.
    defer_copy_for_bundling: bool = false,

    const ParseTaskStage = union(enum) {
        needs_source_code: void,
        needs_parse: CacheEntry,
    };

    /// The information returned to the Bundler thread when a parse finishes.
    pub const Result = struct {
        task: EventLoop.Task,
        ctx: *BundleV2,
        value: Value,
        watcher_data: WatcherData,
        /// This is used for native onBeforeParsePlugins to store
        /// a function pointer and context pointer to free the
        /// returned source code by the plugin.
        external: CacheEntry.ExternalFreeFunction = .none,

        pub const Value = union(enum) {
            success: Success,
            err: Error,
            empty: struct {
                source_index: Index,
            },
        };

        const WatcherData = struct {
            fd: bun.StoredFileDescriptorType,
            dir_fd: bun.StoredFileDescriptorType,

            /// When no files to watch, this encoding is used.
            const none: WatcherData = .{
                .fd = bun.invalid_fd,
                .dir_fd = bun.invalid_fd,
            };
        };

        pub const Success = struct {
            ast: JSAst,
            source: Logger.Source,
            log: Logger.Log,
            use_directive: UseDirective,
            side_effects: _resolver.SideEffects,

            /// Used by "file" loader files.
            unique_key_for_additional_file: []const u8 = "",
            /// Used by "file" loader files.
            content_hash_for_additional_file: u64 = 0,

            loader: Loader,
        };

        pub const Error = struct {
            err: anyerror,
            step: Step,
            log: Logger.Log,
            target: options.Target,
            source_index: Index,

            pub const Step = enum {
                pending,
                read_file,
                parse,
                resolve,
            };
        };
    };

    const debug = Output.scoped(.ParseTask, true);

    pub fn init(resolve_result: *const _resolver.Result, source_index: Index, ctx: *BundleV2) ParseTask {
        return .{
            .ctx = ctx,
            .path = resolve_result.path_pair.primary,
            .contents_or_fd = .{
                .fd = .{
                    .dir = resolve_result.dirname_fd,
                    .file = resolve_result.file_fd,
                },
            },
            .side_effects = resolve_result.primary_side_effects_data,
            .jsx = resolve_result.jsx,
            .source_index = source_index,
            .module_type = resolve_result.module_type,
            .emit_decorator_metadata = resolve_result.emit_decorator_metadata,
            .package_version = if (resolve_result.package_json) |package_json| package_json.version else "",
            .known_target = ctx.transpiler.options.target,
        };
    }

    const RuntimeSource = struct {
        parse_task: ParseTask,
        source: Logger.Source,
    };

    fn getRuntimeSourceComptime(comptime target: options.Target) RuntimeSource {
        // When the `require` identifier is visited, it is replaced with e_require_call_target
        // and then that is either replaced with the module itself, or an import to the
        // runtime here.
        const runtime_require = switch (target) {
            // Previously, Bun inlined `import.meta.require` at all usages. This broke
            // code that called `fn.toString()` and parsed the code outside a module
            // context.
            .bun, .bun_macro =>
            \\export var __require = import.meta.require;
            ,

            .node =>
            \\import { createRequire } from "node:module";
            \\export var __require = /* @__PURE__ */ createRequire(import.meta.url);
            \\
            ,

            // Copied from esbuild's runtime.go:
            //
            // > This fallback "require" function exists so that "typeof require" can
            // > naturally be "function" even in non-CommonJS environments since esbuild
            // > emulates a CommonJS environment (issue #1202). However, people want this
            // > shim to fall back to "globalThis.require" even if it's defined later
            // > (including property accesses such as "require.resolve") so we need to
            // > use a proxy (issue #1614).
            //
            // When bundling to node, esbuild picks this code path as well, but `globalThis.require`
            // is not always defined there. The `createRequire` call approach is more reliable.
            else =>
            \\export var __require = /* @__PURE__ */ (x =>
            \\  typeof require !== 'undefined' ? require :
            \\  typeof Proxy !== 'undefined' ? new Proxy(x, {
            \\    get: (a, b) => (typeof require !== 'undefined' ? require : a)[b]
            \\  }) : x
            \\)(function (x) {
            \\  if (typeof require !== 'undefined') return require.apply(this, arguments)
            \\  throw Error('Dynamic require of "' + x + '" is not supported')
            \\});
            \\
        };
        const runtime_using_symbols = switch (target) {
            // bun's webkit has Symbol.asyncDispose, Symbol.dispose, and SuppressedError, but not the syntax support
            .bun =>
            \\export var __using = (stack, value, async) => {
            \\  if (value != null) {
            \\    if (typeof value !== 'object' && typeof value !== 'function') throw TypeError('Object expected to be assigned to "using" declaration')
            \\    let dispose
            \\    if (async) dispose = value[Symbol.asyncDispose]
            \\    if (dispose === void 0) dispose = value[Symbol.dispose]
            \\    if (typeof dispose !== 'function') throw TypeError('Object not disposable')
            \\    stack.push([async, dispose, value])
            \\  } else if (async) {
            \\    stack.push([async])
            \\  }
            \\  return value
            \\}
            \\
            \\export var __callDispose = (stack, error, hasError) => {
            \\  let fail = e => error = hasError ? new SuppressedError(e, error, 'An error was suppressed during disposal') : (hasError = true, e)
            \\    , next = (it) => {
            \\      while (it = stack.pop()) {
            \\        try {
            \\          var result = it[1] && it[1].call(it[2])
            \\          if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()))
            \\        } catch (e) {
            \\          fail(e)
            \\        }
            \\      }
            \\      if (hasError) throw error
            \\    }
            \\  return next()
            \\}
            \\
            ,
            // Other platforms may or may not have the symbol or errors
            // The definitions of __dispose and __asyncDispose match what esbuild's __wellKnownSymbol() helper does
            else =>
            \\var __dispose = Symbol.dispose || /* @__PURE__ */ Symbol.for('Symbol.dispose');
            \\var __asyncDispose =  Symbol.dispose || /* @__PURE__ */ Symbol.for('Symbol.dispose');
            \\
            \\export var __using = (stack, value, async) => {
            \\  if (value != null) {
            \\    if (typeof value !== 'object' && typeof value !== 'function') throw TypeError('Object expected to be assigned to "using" declaration')
            \\    var dispose
            \\    if (async) dispose = value[__asyncDispose]
            \\    if (dispose === void 0) dispose = value[__dispose]
            \\    if (typeof dispose !== 'function') throw TypeError('Object not disposable')
            \\    stack.push([async, dispose, value])
            \\  } else if (async) {
            \\    stack.push([async])
            \\  }
            \\  return value
            \\}
            \\
            \\export var __callDispose = (stack, error, hasError) => {
            \\  var E = typeof SuppressedError === 'function' ? SuppressedError :
            \\    function (e, s, m, _) { return _ = Error(m), _.name = 'SuppressedError', _.error = e, _.suppressed = s, _ },
            \\    fail = e => error = hasError ? new E(e, error, 'An error was suppressed during disposal') : (hasError = true, e),
            \\    next = (it) => {
            \\      while (it = stack.pop()) {
            \\        try {
            \\          var result = it[1] && it[1].call(it[2])
            \\          if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()))
            \\        } catch (e) {
            \\          fail(e)
            \\        }
            \\      }
            \\      if (hasError) throw error
            \\    }
            \\  return next()
            \\}
            \\
        };
        const runtime_code = @embedFile("../runtime.js") ++ runtime_require ++ runtime_using_symbols;

        const parse_task = ParseTask{
            .ctx = undefined,
            .path = Fs.Path.initWithNamespace("runtime", "bun:runtime"),
            .side_effects = .no_side_effects__pure_data,
            .jsx = .{
                .parse = false,
            },
            .contents_or_fd = .{
                .contents = runtime_code,
            },
            .source_index = Index.runtime,
            .loader = .js,
            .known_target = target,
        };
        const source = Logger.Source{
            .path = parse_task.path,
            .contents = parse_task.contents_or_fd.contents,
            .index = Index.runtime,
        };
        return .{ .parse_task = parse_task, .source = source };
    }

    fn getRuntimeSource(target: options.Target) RuntimeSource {
        return switch (target) {
            inline else => |t| comptime getRuntimeSourceComptime(t),
        };
    }

    threadlocal var override_file_path_buf: bun.PathBuffer = undefined;

    fn getEmptyCSSAST(
        log: *Logger.Log,
        transpiler: *Transpiler,
        opts: js_parser.Parser.Options,
        allocator: std.mem.Allocator,
        source: Logger.Source,
    ) !JSAst {
        const root = Expr.init(E.Object, E.Object{}, Logger.Loc{ .start = 0 });
        var ast = JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
        ast.css = bun.create(allocator, bun.css.BundlerStyleSheet, bun.css.BundlerStyleSheet.empty(allocator));
        return ast;
    }

    fn getEmptyAST(log: *Logger.Log, transpiler: *Transpiler, opts: js_parser.Parser.Options, allocator: std.mem.Allocator, source: Logger.Source, comptime RootType: type) !JSAst {
        const root = Expr.init(RootType, RootType{}, Logger.Loc.Empty);
        return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
    }

    const FileLoaderHash = struct {
        key: []const u8,
        content_hash: u64,
    };

    fn getAST(
        log: *Logger.Log,
        transpiler: *Transpiler,
        opts: js_parser.Parser.Options,
        allocator: std.mem.Allocator,
        resolver: *Resolver,
        source: Logger.Source,
        loader: Loader,
        unique_key_prefix: u64,
        unique_key_for_additional_file: *FileLoaderHash,
        has_any_css_locals: *std.atomic.Value(u32),
    ) !JSAst {
        switch (loader) {
            .jsx, .tsx, .js, .ts => {
                const trace = bun.perf.trace("Bundler.ParseJS");
                defer trace.end();
                return if (try resolver.caches.js.parse(
                    transpiler.allocator,
                    opts,
                    transpiler.options.define,
                    log,
                    &source,
                )) |res|
                    JSAst.init(res.ast)
                else switch (opts.module_type == .esm) {
                    inline else => |as_undefined| try getEmptyAST(
                        log,
                        transpiler,
                        opts,
                        allocator,
                        source,
                        if (as_undefined) E.Undefined else E.Object,
                    ),
                };
            },
            .json, .jsonc => |v| {
                const trace = bun.perf.trace("Bundler.ParseJSON");
                defer trace.end();
                const root = (try resolver.caches.json.parseJSON(log, source, allocator, if (v == .jsonc) .jsonc else .json, true)) orelse Expr.init(E.Object, E.Object{}, Logger.Loc.Empty);
                return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
            },
            .toml => {
                const trace = bun.perf.trace("Bundler.ParseTOML");
                defer trace.end();
                var temp_log = bun.logger.Log.init(allocator);
                defer {
                    temp_log.cloneToWithRecycled(log, true) catch bun.outOfMemory();
                    temp_log.msgs.clearAndFree();
                }
                const root = try TOML.parse(&source, &temp_log, allocator, false);
                return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, &temp_log, root, &source, "")).?);
            },
            .text => {
                const root = Expr.init(E.String, E.String{
                    .data = source.contents,
                }, Logger.Loc{ .start = 0 });
                var ast = JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
                ast.addUrlForCss(allocator, &source, "text/plain", null);
                return ast;
            },

            .sqlite_embedded, .sqlite => {
                if (!transpiler.options.target.isBun()) {
                    log.addError(
                        &source,
                        Logger.Loc.Empty,
                        "To use the \"sqlite\" loader, set target to \"bun\"",
                    ) catch bun.outOfMemory();
                    return error.ParserError;
                }

                const path_to_use = brk: {
                    // Implements embedded sqlite
                    if (loader == .sqlite_embedded) {
                        const embedded_path = std.fmt.allocPrint(allocator, "{any}A{d:0>8}", .{ bun.fmt.hexIntLower(unique_key_prefix), source.index.get() }) catch unreachable;
                        unique_key_for_additional_file.* = .{
                            .key = embedded_path,
                            .content_hash = ContentHasher.run(source.contents),
                        };
                        break :brk embedded_path;
                    }

                    break :brk source.path.text;
                };

                // This injects the following code:
                //
                // import.meta.require(unique_key).db
                //
                const import_path = Expr.init(E.String, E.String{
                    .data = path_to_use,
                }, Logger.Loc{ .start = 0 });

                const import_meta = Expr.init(E.ImportMeta, E.ImportMeta{}, Logger.Loc{ .start = 0 });
                const require_property = Expr.init(E.Dot, E.Dot{
                    .target = import_meta,
                    .name_loc = Logger.Loc.Empty,
                    .name = "require",
                }, Logger.Loc{ .start = 0 });
                const require_args = allocator.alloc(Expr, 2) catch unreachable;
                require_args[0] = import_path;
                const object_properties = allocator.alloc(G.Property, 1) catch unreachable;
                object_properties[0] = G.Property{
                    .key = Expr.init(E.String, E.String{
                        .data = "type",
                    }, Logger.Loc{ .start = 0 }),
                    .value = Expr.init(E.String, E.String{
                        .data = "sqlite",
                    }, Logger.Loc{ .start = 0 }),
                };
                require_args[1] = Expr.init(E.Object, E.Object{
                    .properties = G.Property.List.init(object_properties),
                    .is_single_line = true,
                }, Logger.Loc{ .start = 0 });
                const require_call = Expr.init(E.Call, E.Call{
                    .target = require_property,
                    .args = BabyList(Expr).init(require_args),
                }, Logger.Loc{ .start = 0 });

                const root = Expr.init(E.Dot, E.Dot{
                    .target = require_call,
                    .name_loc = Logger.Loc.Empty,
                    .name = "db",
                }, Logger.Loc{ .start = 0 });

                return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
            },
            .napi => {
                // (dap-eval-cb "source.contents.ptr")
                if (transpiler.options.target == .browser) {
                    log.addError(
                        &source,
                        Logger.Loc.Empty,
                        "Loading .node files won't work in the browser. Make sure to set target to \"bun\" or \"node\"",
                    ) catch bun.outOfMemory();
                    return error.ParserError;
                }

                const unique_key = std.fmt.allocPrint(allocator, "{any}A{d:0>8}", .{ bun.fmt.hexIntLower(unique_key_prefix), source.index.get() }) catch unreachable;
                // This injects the following code:
                //
                // require(unique_key)
                //
                const import_path = Expr.init(E.String, E.String{
                    .data = unique_key,
                }, Logger.Loc{ .start = 0 });

                const require_args = allocator.alloc(Expr, 1) catch unreachable;
                require_args[0] = import_path;

                const root = Expr.init(E.Call, E.Call{
                    .target = .{ .data = .{ .e_require_call_target = {} }, .loc = .{ .start = 0 } },
                    .args = BabyList(Expr).init(require_args),
                }, Logger.Loc{ .start = 0 });

                unique_key_for_additional_file.* = .{
                    .key = unique_key,
                    .content_hash = ContentHasher.run(source.contents),
                };
                return JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
            },
            .html => {
                var scanner = HTMLScanner.init(allocator, log, &source);
                try scanner.scan(source.contents);

                // Reuse existing code for creating the AST
                // because it handles the various Ref and other structs we
                // need in order to print code later.
                var ast = (try js_parser.newLazyExportAST(
                    allocator,
                    transpiler.options.define,
                    opts,
                    log,
                    Expr.init(E.Missing, E.Missing{}, Logger.Loc.Empty),
                    &source,
                    "",
                )).?;
                ast.import_records = scanner.import_records;

                // We're banning import default of html loader files for now.
                //
                // TLDR: it kept including:
                //
                //   var name_default = ...;
                //
                // in the bundle because of the exports AST, and
                // gave up on figuring out how to fix it so that
                // this feature could ship.
                ast.has_lazy_export = false;
                ast.parts.ptr[1] = .{
                    .stmts = &.{},
                    .is_live = true,
                    .import_record_indices = brk2: {
                        // Generate a single part that depends on all the import records.
                        // This is to ensure that we generate a JavaScript bundle containing all the user's code.
                        var import_record_indices = try Part.ImportRecordIndices.initCapacity(allocator, scanner.import_records.len);
                        import_record_indices.len = @truncate(scanner.import_records.len);
                        for (import_record_indices.slice(), 0..) |*import_record, index| {
                            import_record.* = @intCast(index);
                        }
                        break :brk2 import_record_indices;
                    },
                };

                // Try to avoid generating unnecessary ESM <> CJS wrapper code.
                if (opts.output_format == .esm or opts.output_format == .iife) {
                    ast.exports_kind = .esm;
                }

                return JSAst.init(ast);
            },
            .css => {
                // make css ast
                var import_records = BabyList(ImportRecord){};
                const source_code = source.contents;
                var temp_log = bun.logger.Log.init(allocator);
                defer {
                    temp_log.appendToMaybeRecycled(log, &source) catch bun.outOfMemory();
                }

                const css_module_suffix = ".module.css";
                const enable_css_modules = source.path.pretty.len > css_module_suffix.len and
                    strings.eqlComptime(source.path.pretty[source.path.pretty.len - css_module_suffix.len ..], css_module_suffix);
                const parser_options = if (enable_css_modules) init: {
                    var parseropts = bun.css.ParserOptions.default(allocator, &temp_log);
                    parseropts.filename = bun.path.basename(source.path.pretty);
                    parseropts.css_modules = bun.css.CssModuleConfig{};
                    break :init parseropts;
                } else bun.css.ParserOptions.default(allocator, &temp_log);

                var css_ast, var extra = switch (bun.css.BundlerStyleSheet.parseBundler(
                    allocator,
                    source_code,
                    parser_options,
                    &import_records,
                    source.index,
                )) {
                    .result => |v| v,
                    .err => |e| {
                        try e.addToLogger(&temp_log, &source, allocator);
                        return error.SyntaxError;
                    },
                };
                // Make sure the css modules local refs have a valid tag
                if (comptime bun.Environment.isDebug) {
                    if (css_ast.local_scope.count() > 0) {
                        for (css_ast.local_scope.values()) |entry| {
                            const ref = entry.ref;
                            bun.assert(ref.innerIndex() < extra.symbols.len);
                        }
                    }
                }
                if (css_ast.minify(allocator, bun.css.MinifyOptions{
                    .targets = bun.css.Targets.forBundlerTarget(transpiler.options.target),
                    .unused_symbols = .{},
                }, &extra).asErr()) |e| {
                    try e.addToLogger(&temp_log, &source, allocator);
                    return error.MinifyError;
                }
                if (css_ast.local_scope.count() > 0) {
                    _ = has_any_css_locals.fetchAdd(1, .monotonic);
                }
                // If this is a css module, the final exports object wil be set in `generateCodeForLazyExport`.
                const root = Expr.init(E.Object, E.Object{}, Logger.Loc{ .start = 0 });
                const css_ast_heap = bun.create(allocator, bun.css.BundlerStyleSheet, css_ast);
                var ast = JSAst.init((try js_parser.newLazyExportASTImpl(allocator, transpiler.options.define, opts, &temp_log, root, &source, "", extra.symbols)).?);
                ast.css = css_ast_heap;
                ast.import_records = import_records;
                return ast;
            },
            // TODO:
            .dataurl, .base64, .bunsh => {
                return try getEmptyAST(log, transpiler, opts, allocator, source, E.String);
            },
            .file, .wasm => {
                bun.assert(loader.shouldCopyForBundling());

                // Put a unique key in the AST to implement the URL loader. At the end
                // of the bundle, the key is replaced with the actual URL.
                const content_hash = ContentHasher.run(source.contents);

                const unique_key: []const u8 = if (transpiler.options.dev_server != null)
                    // With DevServer, the actual URL is added now, since it can be
                    // known this far ahead of time, and it means the unique key code
                    // does not have to perform an additional pass over files.
                    //
                    // To avoid a mutex, the actual insertion of the asset to DevServer
                    // is done on the bundler thread.
                    try std.fmt.allocPrint(
                        allocator,
                        bun.bake.DevServer.asset_prefix ++ "/{s}{s}",
                        .{
                            &std.fmt.bytesToHex(std.mem.asBytes(&content_hash), .lower),
                            std.fs.path.extension(source.path.text),
                        },
                    )
                else
                    try std.fmt.allocPrint(
                        allocator,
                        "{any}A{d:0>8}",
                        .{ bun.fmt.hexIntLower(unique_key_prefix), source.index.get() },
                    );
                const root = Expr.init(E.String, .{ .data = unique_key }, .{ .start = 0 });
                unique_key_for_additional_file.* = .{
                    .key = unique_key,
                    .content_hash = content_hash,
                };
                var ast = JSAst.init((try js_parser.newLazyExportAST(allocator, transpiler.options.define, opts, log, root, &source, "")).?);
                ast.addUrlForCss(allocator, &source, null, unique_key);
                return ast;
            },
        }
    }

    fn getCodeForParseTaskWithoutPlugins(
        task: *ParseTask,
        log: *Logger.Log,
        transpiler: *Transpiler,
        resolver: *Resolver,
        allocator: std.mem.Allocator,
        file_path: *Fs.Path,
        loader: Loader,
    ) !CacheEntry {
        return switch (task.contents_or_fd) {
            .fd => |contents| brk: {
                const trace = bun.perf.trace("Bundler.readFile");
                defer trace.end();

                if (strings.eqlComptime(file_path.namespace, "node")) lookup_builtin: {
                    if (task.ctx.framework) |f| {
                        if (f.built_in_modules.get(file_path.text)) |file| {
                            switch (file) {
                                .code => |code| break :brk .{ .contents = code, .fd = bun.invalid_fd },
                                .import => |path| {
                                    file_path.* = Fs.Path.init(path);
                                    break :lookup_builtin;
                                },
                            }
                        }
                    }

                    break :brk .{
                        .contents = NodeFallbackModules.contentsFromPath(file_path.text) orelse "",
                        .fd = bun.invalid_fd,
                    };
                }

                break :brk resolver.caches.fs.readFileWithAllocator(
                    // TODO: this allocator may be wrong for native plugins
                    if (loader.shouldCopyForBundling())
                        // The OutputFile will own the memory for the contents
                        bun.default_allocator
                    else
                        allocator,
                    transpiler.fs,
                    file_path.text,
                    task.contents_or_fd.fd.dir,
                    false,
                    if (contents.file != bun.invalid_fd and contents.file != .zero)
                        contents.file
                    else
                        null,
                ) catch |err| {
                    const source = &Logger.Source.initEmptyFile(log.msgs.allocator.dupe(u8, file_path.text) catch unreachable);
                    switch (err) {
                        error.ENOENT, error.FileNotFound => {
                            log.addErrorFmt(
                                source,
                                Logger.Loc.Empty,
                                allocator,
                                "File not found {}",
                                .{bun.fmt.quote(file_path.text)},
                            ) catch {};
                            return error.FileNotFound;
                        },
                        else => {
                            log.addErrorFmt(
                                source,
                                Logger.Loc.Empty,
                                allocator,
                                "{s} reading file: {}",
                                .{ @errorName(err), bun.fmt.quote(file_path.text) },
                            ) catch {};
                        },
                    }
                    return err;
                };
            },
            .contents => |contents| .{
                .contents = contents,
                .fd = bun.invalid_fd,
            },
        };
    }

    fn getCodeForParseTask(
        task: *ParseTask,
        log: *Logger.Log,
        transpiler: *Transpiler,
        resolver: *Resolver,
        allocator: std.mem.Allocator,
        file_path: *Fs.Path,
        loader: *Loader,
        from_plugin: *bool,
    ) !CacheEntry {
        const might_have_on_parse_plugins = brk: {
            if (task.source_index.isRuntime()) break :brk false;
            const plugin = task.ctx.plugins orelse break :brk false;
            if (!plugin.hasOnBeforeParsePlugins()) break :brk false;

            if (strings.eqlComptime(file_path.namespace, "node")) {
                break :brk false;
            }
            break :brk true;
        };

        if (!might_have_on_parse_plugins) {
            return getCodeForParseTaskWithoutPlugins(task, log, transpiler, resolver, allocator, file_path, loader.*);
        }

        var should_continue_running: i32 = 1;

        var ctx = OnBeforeParsePlugin{
            .task = task,
            .log = log,
            .transpiler = transpiler,
            .resolver = resolver,
            .allocator = allocator,
            .file_path = file_path,
            .loader = loader,
            .deferred_error = null,
            .should_continue_running = &should_continue_running,
        };

        return try ctx.run(task.ctx.plugins.?, from_plugin);
    }

    const OnBeforeParsePlugin = struct {
        task: *ParseTask,
        log: *Logger.Log,
        transpiler: *Transpiler,
        resolver: *Resolver,
        allocator: std.mem.Allocator,
        file_path: *Fs.Path,
        loader: *Loader,
        deferred_error: ?anyerror = null,
        should_continue_running: *i32,

        result: ?*OnBeforeParseResult = null,

        const headers = bun.c;

        comptime {
            bun.assert(@sizeOf(OnBeforeParseArguments) == @sizeOf(headers.OnBeforeParseArguments));
            bun.assert(@alignOf(OnBeforeParseArguments) == @alignOf(headers.OnBeforeParseArguments));

            bun.assert(@sizeOf(BunLogOptions) == @sizeOf(headers.BunLogOptions));
            bun.assert(@alignOf(BunLogOptions) == @alignOf(headers.BunLogOptions));

            bun.assert(@sizeOf(OnBeforeParseResult) == @sizeOf(headers.OnBeforeParseResult));
            bun.assert(@alignOf(OnBeforeParseResult) == @alignOf(headers.OnBeforeParseResult));

            bun.assert(@sizeOf(BunLogOptions) == @sizeOf(headers.BunLogOptions));
            bun.assert(@alignOf(BunLogOptions) == @alignOf(headers.BunLogOptions));
        }

        const OnBeforeParseArguments = extern struct {
            struct_size: usize = @sizeOf(OnBeforeParseArguments),
            context: *OnBeforeParsePlugin,
            path_ptr: ?[*]const u8 = "",
            path_len: usize = 0,
            namespace_ptr: ?[*]const u8 = "file",
            namespace_len: usize = "file".len,
            default_loader: Loader = .file,
            external: ?*anyopaque = null,
        };

        const BunLogOptions = extern struct {
            struct_size: usize = @sizeOf(BunLogOptions),
            message_ptr: ?[*]const u8 = null,
            message_len: usize = 0,
            path_ptr: ?[*]const u8 = null,
            path_len: usize = 0,
            source_line_text_ptr: ?[*]const u8 = null,
            source_line_text_len: usize = 0,
            level: Logger.Log.Level = .err,
            line: i32 = 0,
            column: i32 = 0,
            line_end: i32 = 0,
            column_end: i32 = 0,

            pub fn sourceLineText(this: *const BunLogOptions) string {
                if (this.source_line_text_ptr) |ptr| {
                    if (this.source_line_text_len > 0) {
                        return ptr[0..this.source_line_text_len];
                    }
                }
                return "";
            }

            pub fn path(this: *const BunLogOptions) string {
                if (this.path_ptr) |ptr| {
                    if (this.path_len > 0) {
                        return ptr[0..this.path_len];
                    }
                }
                return "";
            }

            pub fn message(this: *const BunLogOptions) string {
                if (this.message_ptr) |ptr| {
                    if (this.message_len > 0) {
                        return ptr[0..this.message_len];
                    }
                }
                return "";
            }

            pub fn append(this: *const BunLogOptions, log: *Logger.Log, namespace: string) void {
                const allocator = log.msgs.allocator;
                const source_line_text = this.sourceLineText();
                const location = Logger.Location.init(
                    this.path(),
                    namespace,
                    @max(this.line, -1),
                    @max(this.column, -1),
                    @max(this.column_end - this.column, 0),
                    if (source_line_text.len > 0) allocator.dupe(u8, source_line_text) catch bun.outOfMemory() else null,
                    null,
                );
                var msg = Logger.Msg{ .data = .{ .location = location, .text = allocator.dupe(u8, this.message()) catch bun.outOfMemory() } };
                switch (this.level) {
                    .err => msg.kind = .err,
                    .warn => msg.kind = .warn,
                    .verbose => msg.kind = .verbose,
                    .debug => msg.kind = .debug,
                    else => {},
                }
                if (msg.kind == .err) {
                    log.errors += 1;
                } else if (msg.kind == .warn) {
                    log.warnings += 1;
                }
                log.addMsg(msg) catch bun.outOfMemory();
            }

            pub fn logFn(
                args_: ?*OnBeforeParseArguments,
                log_options_: ?*BunLogOptions,
            ) callconv(.C) void {
                const args = args_ orelse return;
                const log_options = log_options_ orelse return;
                log_options.append(args.context.log, args.context.file_path.namespace);
            }
        };

        const OnBeforeParseResultWrapper = extern struct {
            original_source: ?[*]const u8 = null,
            original_source_len: usize = 0,
            original_source_fd: bun.FileDescriptor = bun.invalid_fd,
            loader: Loader,
            check: if (bun.Environment.isDebug) u32 else u0 = if (bun.Environment.isDebug) 42069 else 0, // Value to ensure OnBeforeParseResult is wrapped in this struct
            result: OnBeforeParseResult,
        };

        const OnBeforeParseResult = extern struct {
            struct_size: usize = @sizeOf(OnBeforeParseResult),
            source_ptr: ?[*]const u8 = null,
            source_len: usize = 0,
            loader: Loader,

            fetch_source_code_fn: *const fn (*OnBeforeParseArguments, *OnBeforeParseResult) callconv(.C) i32 = &fetchSourceCode,

            user_context: ?*anyopaque = null,
            free_user_context: ?*const fn (?*anyopaque) callconv(.C) void = null,

            log: *const fn (
                args_: ?*OnBeforeParseArguments,
                log_options_: ?*BunLogOptions,
            ) callconv(.C) void = &BunLogOptions.logFn,

            pub fn getWrapper(result: *OnBeforeParseResult) *OnBeforeParseResultWrapper {
                const wrapper: *OnBeforeParseResultWrapper = @fieldParentPtr("result", result);
                bun.debugAssert(wrapper.check == 42069);
                return wrapper;
            }
        };

        pub fn fetchSourceCode(args: *OnBeforeParseArguments, result: *OnBeforeParseResult) callconv(.C) i32 {
            debug("fetchSourceCode", .{});
            const this = args.context;
            if (this.log.errors > 0 or this.deferred_error != null or this.should_continue_running.* != 1) {
                return 1;
            }

            if (result.source_ptr != null) {
                return 0;
            }

            const entry = getCodeForParseTaskWithoutPlugins(
                this.task,
                this.log,
                this.transpiler,
                this.resolver,
                this.allocator,
                this.file_path,

                result.loader,
            ) catch |err| {
                this.deferred_error = err;
                this.should_continue_running.* = 0;
                return 1;
            };
            result.source_ptr = entry.contents.ptr;
            result.source_len = entry.contents.len;
            result.free_user_context = null;
            result.user_context = null;
            const wrapper: *OnBeforeParseResultWrapper = result.getWrapper();
            wrapper.original_source = entry.contents.ptr;
            wrapper.original_source_len = entry.contents.len;
            wrapper.original_source_fd = entry.fd;
            return 0;
        }

        pub export fn OnBeforeParseResult__reset(this: *OnBeforeParseResult) void {
            const wrapper = this.getWrapper();
            this.loader = wrapper.loader;
            if (wrapper.original_source) |src_ptr| {
                const src = src_ptr[0..wrapper.original_source_len];
                this.source_ptr = src.ptr;
                this.source_len = src.len;
            } else {
                this.source_ptr = null;
                this.source_len = 0;
            }
        }

        pub export fn OnBeforeParsePlugin__isDone(this: *OnBeforeParsePlugin) i32 {
            if (this.should_continue_running.* != 1) {
                return 1;
            }

            const result = this.result orelse return 1;
            // The first plugin to set the source wins.
            // But, we must check that they actually modified it
            // since fetching the source stores it inside `result.source_ptr`
            if (result.source_ptr != null) {
                const wrapper: *OnBeforeParseResultWrapper = result.getWrapper();
                return @intFromBool(result.source_ptr.? != wrapper.original_source.?);
            }

            return 0;
        }

        pub fn run(this: *OnBeforeParsePlugin, plugin: *JSC.API.JSBundler.Plugin, from_plugin: *bool) !CacheEntry {
            var args = OnBeforeParseArguments{
                .context = this,
                .path_ptr = this.file_path.text.ptr,
                .path_len = this.file_path.text.len,
                .default_loader = this.loader.*,
            };
            if (this.file_path.namespace.len > 0) {
                args.namespace_ptr = this.file_path.namespace.ptr;
                args.namespace_len = this.file_path.namespace.len;
            }
            var wrapper = OnBeforeParseResultWrapper{
                .loader = this.loader.*,
                .result = OnBeforeParseResult{
                    .loader = this.loader.*,
                },
            };

            this.result = &wrapper.result;
            const count = plugin.callOnBeforeParsePlugins(
                this,
                if (bun.strings.eqlComptime(this.file_path.namespace, "file"))
                    &bun.String.empty
                else
                    &bun.String.init(this.file_path.namespace),

                &bun.String.init(this.file_path.text),
                &args,
                &wrapper.result,
                this.should_continue_running,
            );
            if (comptime Environment.enable_logs)
                debug("callOnBeforeParsePlugins({s}:{s}) = {d}", .{ this.file_path.namespace, this.file_path.text, count });
            if (count > 0) {
                if (this.deferred_error) |err| {
                    if (wrapper.result.free_user_context) |free_user_context| {
                        free_user_context(wrapper.result.user_context);
                    }

                    return err;
                }

                // If the plugin sets the `free_user_context` function pointer, it _must_ set the `user_context` pointer.
                // Otherwise this is just invalid behavior.
                if (wrapper.result.user_context == null and wrapper.result.free_user_context != null) {
                    var msg = Logger.Msg{ .data = .{ .location = null, .text = bun.default_allocator.dupe(
                        u8,
                        "Native plugin set the `free_plugin_source_code_context` field without setting the `plugin_source_code_context` field.",
                    ) catch bun.outOfMemory() } };
                    msg.kind = .err;
                    args.context.log.errors += 1;
                    args.context.log.addMsg(msg) catch bun.outOfMemory();
                    return error.InvalidNativePlugin;
                }

                if (this.log.errors > 0) {
                    if (wrapper.result.free_user_context) |free_user_context| {
                        free_user_context(wrapper.result.user_context);
                    }

                    return error.SyntaxError;
                }

                if (wrapper.result.source_ptr) |ptr| {
                    if (wrapper.result.free_user_context != null) {
                        this.task.external_free_function = .{
                            .ctx = wrapper.result.user_context,
                            .function = wrapper.result.free_user_context,
                        };
                    }
                    from_plugin.* = true;
                    this.loader.* = wrapper.result.loader;
                    return .{
                        .contents = ptr[0..wrapper.result.source_len],
                        .external_free_function = .{
                            .ctx = wrapper.result.user_context,
                            .function = wrapper.result.free_user_context,
                        },
                        .fd = wrapper.original_source_fd,
                    };
                }
            }

            return try getCodeForParseTaskWithoutPlugins(this.task, this.log, this.transpiler, this.resolver, this.allocator, this.file_path, this.loader.*);
        }
    };

    fn getSourceCode(
        task: *ParseTask,
        this: *ThreadPool.Worker,
        log: *Logger.Log,
    ) anyerror!CacheEntry {
        const allocator = this.allocator;

        var data = this.data;
        var transpiler = &data.transpiler;
        errdefer transpiler.resetStore();
        const resolver: *Resolver = &transpiler.resolver;
        var file_path = task.path;
        var loader = task.loader orelse file_path.loader(&transpiler.options.loaders) orelse options.Loader.file;

        // Do not process files as HTML if any of the following are true:
        // - building for node or bun.js
        //
        //   We allow non-entrypoints to import HTML so that people could
        //   potentially use an onLoad plugin that returns HTML.
        if (task.known_target != .browser) {
            loader = loader.disableHTML();
            task.loader = loader;
        }

        var contents_came_from_plugin: bool = false;
        return try getCodeForParseTask(task, log, transpiler, resolver, allocator, &file_path, &loader, &contents_came_from_plugin);
    }

    fn runWithSourceCode(
        task: *ParseTask,
        this: *ThreadPool.Worker,
        step: *ParseTask.Result.Error.Step,
        log: *Logger.Log,
        entry: *CacheEntry,
    ) anyerror!Result.Success {
        const allocator = this.allocator;

        var data = this.data;
        var transpiler = &data.transpiler;
        errdefer transpiler.resetStore();
        var resolver: *Resolver = &transpiler.resolver;
        var file_path = task.path;
        var loader = task.loader orelse file_path.loader(&transpiler.options.loaders) orelse options.Loader.file;

        // Do not process files as HTML if any of the following are true:
        // - building for node or bun.js
        //
        //   We allow non-entrypoints to import HTML so that people could
        //   potentially use an onLoad plugin that returns HTML.
        if (task.known_target != .browser) {
            loader = loader.disableHTML();
            task.loader = loader;
        }

        // WARNING: Do not change the variant of `task.contents_or_fd` from
        // `.fd` to `.contents` (or back) after this point!
        //
        // When `task.contents_or_fd == .fd`, `entry.contents` is an owned string.
        // When `task.contents_or_fd == .contents`, `entry.contents` is NOT owned! Freeing it here will cause a double free!
        //
        // Changing from `.contents` to `.fd` will cause a double free.
        // This was the case in the situation where the ParseTask receives its `.contents` from an onLoad plugin, which caused it to be
        // allocated by `bun.default_allocator` and then freed in `BundleV2.deinit` (and also by `entry.deinit(allocator)` below).
        const debug_original_variant_check: if (bun.Environment.isDebug) ContentsOrFd.Tag else void =
            if (bun.Environment.isDebug) @as(ContentsOrFd.Tag, task.contents_or_fd);
        errdefer {
            if (comptime bun.Environment.isDebug) {
                if (@as(ContentsOrFd.Tag, task.contents_or_fd) != debug_original_variant_check) {
                    std.debug.panic("BUG: `task.contents_or_fd` changed in a way that will cause a double free or memory to leak!\n\n    Original = {s}\n    New = {s}\n", .{
                        @tagName(debug_original_variant_check),
                        @tagName(task.contents_or_fd),
                    });
                }
            }
            if (task.contents_or_fd == .fd) entry.deinit(allocator);
        }

        const will_close_file_descriptor = task.contents_or_fd == .fd and
            entry.fd.isValid() and !entry.fd.isStdio() and
            this.ctx.bun_watcher == null;
        if (will_close_file_descriptor) {
            _ = entry.closeFD();
            task.contents_or_fd = .{ .fd = .{
                .file = bun.invalid_fd,
                .dir = bun.invalid_fd,
            } };
        } else if (task.contents_or_fd == .fd) {
            task.contents_or_fd = .{ .fd = .{
                .file = entry.fd,
                .dir = bun.invalid_fd,
            } };
        }
        step.* = .parse;

        const is_empty = strings.isAllWhitespace(entry.contents);

        const use_directive: UseDirective = if (!is_empty and transpiler.options.server_components)
            if (UseDirective.parse(entry.contents)) |use|
                use
            else
                .none
        else
            .none;

        if (
        // separate_ssr_graph makes boundaries switch to client because the server file uses that generated file as input.
        // this is not done when there is one server graph because it is easier for plugins to deal with.
        (use_directive == .client and
            task.known_target != .bake_server_components_ssr and
            this.ctx.framework.?.server_components.?.separate_ssr_graph) or
            // set the target to the client when bundling client-side files
            ((transpiler.options.server_components or transpiler.options.dev_server != null) and
                task.known_target == .browser))
        {
            transpiler = this.ctx.client_transpiler;
            resolver = &transpiler.resolver;
            bun.assert(transpiler.options.target == .browser);
        }

        var source = Logger.Source{
            .path = file_path,
            .index = task.source_index,
            .contents = entry.contents,
            .contents_is_recycled = false,
        };

        const target = (if (task.source_index.get() == 1) targetFromHashbang(entry.contents) else null) orelse
            if (task.known_target == .bake_server_components_ssr and transpiler.options.framework.?.server_components.?.separate_ssr_graph)
                .bake_server_components_ssr
            else
                transpiler.options.target;

        const output_format = transpiler.options.output_format;

        var opts = js_parser.Parser.Options.init(task.jsx, loader);
        opts.bundle = true;
        opts.warn_about_unbundled_modules = false;
        opts.macro_context = &this.data.macro_context;
        opts.package_version = task.package_version;

        opts.features.allow_runtime = !source.index.isRuntime();
        opts.features.unwrap_commonjs_to_esm = output_format == .esm and FeatureFlags.unwrap_commonjs_to_esm;
        opts.features.top_level_await = output_format == .esm or output_format == .internal_bake_dev;
        opts.features.auto_import_jsx = task.jsx.parse and transpiler.options.auto_import_jsx;
        opts.features.trim_unused_imports = loader.isTypeScript() or (transpiler.options.trim_unused_imports orelse false);
        opts.features.inlining = transpiler.options.minify_syntax;
        opts.output_format = output_format;
        opts.features.minify_syntax = transpiler.options.minify_syntax;
        opts.features.minify_identifiers = transpiler.options.minify_identifiers;
        opts.features.emit_decorator_metadata = transpiler.options.emit_decorator_metadata;
        opts.features.unwrap_commonjs_packages = transpiler.options.unwrap_commonjs_packages;
        opts.features.hot_module_reloading = output_format == .internal_bake_dev and !source.index.isRuntime();
        opts.features.auto_polyfill_require = output_format == .esm and !opts.features.hot_module_reloading;
        opts.features.react_fast_refresh = target == .browser and
            transpiler.options.react_fast_refresh and
            loader.isJSX() and
            !source.path.isNodeModule();

        opts.features.server_components = if (transpiler.options.server_components) switch (target) {
            .browser => .client_side,
            else => switch (use_directive) {
                .none => .wrap_anon_server_functions,
                .client => if (transpiler.options.framework.?.server_components.?.separate_ssr_graph)
                    .client_side
                else
                    .wrap_exports_for_client_reference,
                .server => .wrap_exports_for_server_reference,
            },
        } else .none;

        opts.framework = transpiler.options.framework;

        opts.ignore_dce_annotations = transpiler.options.ignore_dce_annotations and !source.index.isRuntime();

        // For files that are not user-specified entrypoints, set `import.meta.main` to `false`.
        // Entrypoints will have `import.meta.main` set as "unknown", unless we use `--compile`,
        // in which we inline `true`.
        if (transpiler.options.inline_entrypoint_import_meta_main or !task.is_entry_point) {
            opts.import_meta_main_value = task.is_entry_point and transpiler.options.dev_server == null;
        } else if (target == .node) {
            opts.lower_import_meta_main_for_node_js = true;
        }

        opts.tree_shaking = if (source.index.isRuntime()) true else transpiler.options.tree_shaking;
        opts.module_type = task.module_type;

        task.jsx.parse = loader.isJSX();

        var unique_key_for_additional_file: FileLoaderHash = .{
            .key = "",
            .content_hash = 0,
        };
        var ast: JSAst = if (!is_empty)
            try getAST(log, transpiler, opts, allocator, resolver, source, loader, task.ctx.unique_key, &unique_key_for_additional_file, &task.ctx.linker.has_any_css_locals)
        else switch (opts.module_type == .esm) {
            inline else => |as_undefined| if (loader.isCSS()) try getEmptyCSSAST(
                log,
                transpiler,
                opts,
                allocator,
                source,
            ) else try getEmptyAST(
                log,
                transpiler,
                opts,
                allocator,
                source,
                if (as_undefined) E.Undefined else E.Object,
            ),
        };

        ast.target = target;
        if (ast.parts.len <= 1 and ast.css == null and (task.loader == null or task.loader.? != .html)) {
            task.side_effects = .no_side_effects__empty_ast;
        }

        // bun.debugAssert(ast.parts.len > 0); // when parts.len == 0, it is assumed to be pending/failed. empty ast has at least 1 part.

        step.* = .resolve;

        return .{
            .ast = ast,
            .source = source,
            .log = log.*,
            .use_directive = use_directive,
            .unique_key_for_additional_file = unique_key_for_additional_file.key,
            .side_effects = task.side_effects,
            .loader = loader,

            // Hash the files in here so that we do it in parallel.
            .content_hash_for_additional_file = if (loader.shouldCopyForBundling())
                unique_key_for_additional_file.content_hash
            else
                0,
        };
    }

    fn ioTaskCallback(task: *ThreadPoolLib.Task) void {
        runFromThreadPool(@fieldParentPtr("io_task", task));
    }

    fn taskCallback(task: *ThreadPoolLib.Task) void {
        runFromThreadPool(@fieldParentPtr("task", task));
    }

    pub fn runFromThreadPool(this: *ParseTask) void {
        var worker = ThreadPool.Worker.get(this.ctx);
        defer worker.unget();
        debug("ParseTask(0x{x}, {s}) callback", .{ @intFromPtr(this), this.path.text });

        var step: ParseTask.Result.Error.Step = .pending;
        var log = Logger.Log.init(worker.allocator);
        bun.assert(this.source_index.isValid()); // forgot to set source_index

        const value: ParseTask.Result.Value = value: {
            if (this.stage == .needs_source_code) {
                this.stage = .{
                    .needs_parse = getSourceCode(this, worker, &log) catch |err| {
                        break :value .{ .err = .{
                            .err = err,
                            .step = step,
                            .log = log,
                            .source_index = this.source_index,
                            .target = this.known_target,
                        } };
                    },
                };

                if (log.hasErrors()) {
                    break :value .{ .err = .{
                        .err = error.SyntaxError,
                        .step = step,
                        .log = log,
                        .source_index = this.source_index,
                        .target = this.known_target,
                    } };
                }

                if (this.ctx.graph.pool.usesIOPool()) {
                    this.ctx.graph.pool.scheduleInsideThreadPool(this);
                    return;
                }
            }

            if (runWithSourceCode(this, worker, &step, &log, &this.stage.needs_parse)) |ast| {
                // When using HMR, always flag asts with errors as parse failures.
                // Not done outside of the dev server out of fear of breaking existing code.
                if (this.ctx.transpiler.options.dev_server != null and ast.log.hasErrors()) {
                    break :value .{
                        .err = .{
                            .err = error.SyntaxError,
                            .step = .parse,
                            .log = ast.log,
                            .source_index = this.source_index,
                            .target = this.known_target,
                        },
                    };
                }

                break :value .{ .success = ast };
            } else |err| {
                if (err == error.EmptyAST) {
                    log.deinit();
                    break :value .{ .empty = .{
                        .source_index = this.source_index,
                    } };
                }

                break :value .{ .err = .{
                    .err = err,
                    .step = step,
                    .log = log,
                    .source_index = this.source_index,
                    .target = this.known_target,
                } };
            }
        };

        const result = bun.default_allocator.create(Result) catch bun.outOfMemory();

        result.* = .{
            .ctx = this.ctx,
            .task = .{},
            .value = value,
            .external = this.external_free_function,
            .watcher_data = switch (this.contents_or_fd) {
                .fd => |fd| .{ .fd = fd.file, .dir_fd = fd.dir },
                .contents => .none,
            },
        };

        switch (worker.ctx.loop().*) {
            .js => |jsc_event_loop| {
                jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(result, onComplete));
            },
            .mini => |*mini| {
                mini.enqueueTaskConcurrentWithExtraCtx(
                    Result,
                    BundleV2,
                    result,
                    BundleV2.onParseTaskComplete,
                    .task,
                );
            },
        }
    }

    pub fn onComplete(result: *Result) void {
        BundleV2.onParseTaskComplete(result, result.ctx);
    }
};

/// Files for Server Components are generated using `AstBuilder`, instead of
/// running through the js_parser. It emits a ParseTask.Result and joins
/// with the same logic that it runs though.
pub const ServerComponentParseTask = struct {
    task: ThreadPoolLib.Task = .{ .callback = &taskCallbackWrap },
    data: Data,
    ctx: *BundleV2,
    source: Logger.Source,

    pub const Data = union(enum) {
        /// Generate server-side code for a "use client" module. Given the
        /// client ast, a "reference proxy" is created with identical exports.
        client_reference_proxy: ReferenceProxy,

        client_entry_wrapper: ClientEntryWrapper,

        pub const ReferenceProxy = struct {
            other_source: Logger.Source,
            named_exports: JSAst.NamedExports,
        };

        pub const ClientEntryWrapper = struct {
            path: []const u8,
        };
    };

    fn taskCallbackWrap(thread_pool_task: *ThreadPoolLib.Task) void {
        const task: *ServerComponentParseTask = @fieldParentPtr("task", thread_pool_task);
        var worker = ThreadPool.Worker.get(task.ctx);
        defer worker.unget();
        var log = Logger.Log.init(worker.allocator);

        const result = bun.default_allocator.create(ParseTask.Result) catch bun.outOfMemory();
        result.* = .{
            .ctx = task.ctx,
            .task = undefined,

            .value = if (taskCallback(
                task,
                &log,
                worker.allocator,
            )) |success|
                .{ .success = success }
            else |err| switch (err) {
                error.OutOfMemory => bun.outOfMemory(),
            },

            .watcher_data = .none,
        };

        switch (worker.ctx.loop().*) {
            .js => |jsc_event_loop| {
                jsc_event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(result, ParseTask.onComplete));
            },
            .mini => |*mini| {
                mini.enqueueTaskConcurrentWithExtraCtx(
                    ParseTask.Result,
                    BundleV2,
                    result,
                    BundleV2.onParseTaskComplete,
                    .task,
                );
            },
        }
    }

    fn taskCallback(
        task: *ServerComponentParseTask,
        log: *Logger.Log,
        allocator: std.mem.Allocator,
    ) bun.OOM!ParseTask.Result.Success {
        var ab = try AstBuilder.init(allocator, &task.source, task.ctx.transpiler.options.hot_module_reloading);

        switch (task.data) {
            .client_reference_proxy => |data| try task.generateClientReferenceProxy(data, &ab),
            .client_entry_wrapper => |data| try task.generateClientEntryWrapper(data, &ab),
        }

        return .{
            .ast = try ab.toBundledAst(switch (task.data) {
                // Server-side
                .client_reference_proxy => task.ctx.transpiler.options.target,
                // Client-side,
                .client_entry_wrapper => .browser,
            }),
            .source = task.source,
            .loader = .js,
            .log = log.*,
            .use_directive = .none,
            .side_effects = .no_side_effects__pure_data,
        };
    }

    fn generateClientEntryWrapper(_: *ServerComponentParseTask, data: Data.ClientEntryWrapper, b: *AstBuilder) !void {
        const record = try b.addImportRecord(data.path, .stmt);
        const namespace_ref = try b.newSymbol(.other, "main");
        try b.appendStmt(S.Import{
            .namespace_ref = namespace_ref,
            .import_record_index = record,
            .items = &.{},
            .is_single_line = true,
        });
        b.import_records.items[record].was_originally_bare_import = true;
    }

    fn generateClientReferenceProxy(task: *ServerComponentParseTask, data: Data.ReferenceProxy, b: *AstBuilder) !void {
        const server_components = task.ctx.framework.?.server_components orelse
            unreachable; // config must be non-null to enter this function

        const client_named_exports = data.named_exports;

        const register_client_reference = (try b.addImportStmt(
            server_components.server_runtime_import,
            &.{server_components.server_register_client_reference},
        ))[0];

        const module_path = b.newExpr(E.String{
            // In development, the path loaded is the source file: Easy!
            //
            // In production, the path here must be the final chunk path, but
            // that information is not yet available since chunks are not
            // computed. The unique_key replacement system is used here.
            .data = if (task.ctx.transpiler.options.dev_server != null)
                data.other_source.path.pretty
            else
                try std.fmt.allocPrint(b.allocator, "{}S{d:0>8}", .{
                    bun.fmt.hexIntLower(task.ctx.unique_key),
                    data.other_source.index.get(),
                }),
        });

        for (client_named_exports.keys()) |key| {
            const is_default = bun.strings.eqlComptime(key, "default");

            // This error message is taken from
            // https://github.com/facebook/react/blob/c5b9375767e2c4102d7e5559d383523736f1c902/packages/react-server-dom-webpack/src/ReactFlightWebpackNodeLoader.js#L323-L354
            const err_msg_string = try if (is_default)
                std.fmt.allocPrint(
                    b.allocator,
                    "Attempted to call the default export of {[module_path]s} from " ++
                        "the server, but it's on the client. It's not possible to invoke a " ++
                        "client function from the server, it can only be rendered as a " ++
                        "Component or passed to props of a Client Component.",
                    .{ .module_path = data.other_source.path.pretty },
                )
            else
                std.fmt.allocPrint(
                    b.allocator,
                    "Attempted to call {[key]s}() from the server but {[key]s} " ++
                        "is on the client. It's not possible to invoke a client function from " ++
                        "the server, it can only be rendered as a Component or passed to " ++
                        "props of a Client Component.",
                    .{ .key = key },
                );

            // throw new Error(...)
            const err_msg = b.newExpr(E.New{
                .target = b.newExpr(E.Identifier{
                    .ref = try b.newExternalSymbol("Error"),
                }),
                .args = try BabyList(Expr).fromSlice(b.allocator, &.{
                    b.newExpr(E.String{ .data = err_msg_string }),
                }),
                .close_parens_loc = Logger.Loc.Empty,
            });

            // registerClientReference(
            //   () => { throw new Error(...) },
            //   "src/filepath.tsx",
            //   "Comp"
            // );
            const value = b.newExpr(E.Call{
                .target = register_client_reference,
                .args = try js_ast.ExprNodeList.fromSlice(b.allocator, &.{
                    b.newExpr(E.Arrow{ .body = .{
                        .stmts = try b.allocator.dupe(Stmt, &.{
                            b.newStmt(S.Throw{ .value = err_msg }),
                        }),
                        .loc = Logger.Loc.Empty,
                    } }),
                    module_path,
                    b.newExpr(E.String{ .data = key }),
                }),
            });

            if (is_default) {
                // export default registerClientReference(...);
                try b.appendStmt(S.ExportDefault{ .value = .{ .expr = value }, .default_name = .{} });
            } else {
                // export const Component = registerClientReference(...);
                const export_ref = try b.newSymbol(.other, key);
                try b.appendStmt(S.Local{
                    .decls = try G.Decl.List.fromSlice(b.allocator, &.{.{
                        .binding = Binding.alloc(b.allocator, B.Identifier{ .ref = export_ref }, Logger.Loc.Empty),
                        .value = value,
                    }}),
                    .is_export = true,
                    .kind = .k_const,
                });
            }
        }
    }
};

const IdentityContext = @import("../identity_context.zig").IdentityContext;

const RefVoidMap = std.ArrayHashMapUnmanaged(Ref, void, Ref.ArrayHashCtx, false);
const RefVoidMapManaged = std.ArrayHashMap(Ref, void, Ref.ArrayHashCtx, false);
const RefImportData = std.ArrayHashMapUnmanaged(Ref, ImportData, Ref.ArrayHashCtx, false);
pub const ResolvedExports = bun.StringArrayHashMapUnmanaged(ExportData);
const TopLevelSymbolToParts = js_ast.Ast.TopLevelSymbolToParts;

pub const WrapKind = enum(u2) {
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
    resolved_exports: ResolvedExports = .{},
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

        /// When a converted CommonJS module is import() dynamically
        /// We need ensure that the "default" export is set to the equivalent of module.exports
        /// (unless a "default" export already exists)
        needs_synthetic_default_export: bool = false,

        wrap: WrapKind = WrapKind.none,
    };
};

pub const Graph = struct {
    pool: *ThreadPool,
    heap: ThreadlocalArena = .{},
    /// This allocator is thread-local to the Bundler thread
    /// .allocator == .heap.allocator()
    allocator: std.mem.Allocator = undefined,

    /// Mapping user-specified entry points to their Source Index
    entry_points: std.ArrayListUnmanaged(Index) = .{},
    /// Every source index has an associated InputFile
    input_files: MultiArrayList(InputFile) = .{},
    /// Every source index has an associated Ast
    /// When a parse is in progress / queued, it is `Ast.empty`
    ast: MultiArrayList(JSAst) = .{},

    /// During the scan + parse phase, this value keeps a count of the remaining
    /// tasks. Once it hits zero, the scan phase ends and linking begins. Note
    /// that if `deferred_pending > 0`, it means there are plugin callbacks
    /// to invoke before linking, which can initiate another scan phase.
    ///
    /// Increment and decrement this via `incrementScanCounter` and
    /// `decrementScanCounter`, as asynchronous bundles check for `0` in the
    /// decrement function, instead of at the top of the event loop.
    ///
    /// - Parsing a file (ParseTask and ServerComponentParseTask)
    /// - onResolve and onLoad functions
    /// - Resolving an onDefer promise
    pending_items: u32 = 0,
    /// When an `onLoad` plugin calls `.defer()`, the count from `pending_items`
    /// is "moved" into this counter (pending_items -= 1; deferred_pending += 1)
    ///
    /// When `pending_items` hits zero and there are deferred pending tasks, those
    /// tasks will be run, and the count is "moved" back to `pending_items`
    deferred_pending: u32 = 0,

    /// Maps a hashed path string to a source index, if it exists in the compilation.
    /// Instead of accessing this directly, consider using BundleV2.pathToSourceIndexMap
    path_to_source_index_map: PathToSourceIndexMap = .{},
    /// When using server components, a completely separate file listing is
    /// required to avoid incorrect inlining of defines and dependencies on
    /// other files. This is relevant for files shared between server and client
    /// and have no "use <side>" directive, and must be duplicated.
    ///
    /// To make linking easier, this second graph contains indices into the
    /// same `.ast` and `.input_files` arrays.
    client_path_to_source_index_map: PathToSourceIndexMap = .{},
    /// When using server components with React, there is an additional module
    /// graph which is used to contain SSR-versions of all client components;
    /// the SSR graph. The difference between the SSR graph and the server
    /// graph is that this one does not apply '--conditions react-server'
    ///
    /// In Bun's React Framework, it includes SSR versions of 'react' and
    /// 'react-dom' (an export condition is used to provide a different
    /// implementation for RSC, which is potentially how they implement
    /// server-only features such as async components).
    ssr_path_to_source_index_map: PathToSourceIndexMap = .{},

    /// When Server Components is enabled, this holds a list of all boundary
    /// files. This happens for all files with a "use <side>" directive.
    server_component_boundaries: ServerComponentBoundary.List = .{},

    estimated_file_loader_count: usize = 0,

    /// For Bake, a count of the CSS asts is used to make precise
    /// pre-allocations without re-iterating the file listing.
    css_file_count: usize = 0,

    additional_output_files: std.ArrayListUnmanaged(options.OutputFile) = .{},

    kit_referenced_server_data: bool,
    kit_referenced_client_data: bool,

    pub const InputFile = struct {
        source: Logger.Source,
        loader: options.Loader = options.Loader.file,
        side_effects: _resolver.SideEffects,
        allocator: std.mem.Allocator = bun.default_allocator,
        additional_files: BabyList(AdditionalFile) = .{},
        unique_key_for_additional_file: string = "",
        content_hash_for_additional_file: u64 = 0,
        is_plugin_file: bool = false,
    };

    /// Schedule a task to be run on the JS thread which resolves the promise of
    /// each `.defer()` called in an onLoad plugin.
    ///
    /// Returns true if there were more tasks queued.
    pub fn drainDeferredTasks(this: *@This(), transpiler: *BundleV2) bool {
        transpiler.thread_lock.assertLocked();

        if (this.deferred_pending > 0) {
            this.pending_items += this.deferred_pending;
            this.deferred_pending = 0;

            transpiler.drain_defer_task.init();
            transpiler.drain_defer_task.schedule();

            return true;
        }

        return false;
    }
};

pub const AdditionalFile = union(enum) {
    source_index: Index.Int,
    output_file: Index.Int,
};

pub const PathToSourceIndexMap = std.HashMapUnmanaged(u64, Index.Int, IdentityContext(u64), 80);

const EntryPoint = struct {
    /// This may be an absolute path or a relative path. If absolute, it will
    /// eventually be turned into a relative path by computing the path relative
    /// to the "outbase" directory. Then this relative path will be joined onto
    /// the "outdir" directory to form the final output path for this entry point.
    output_path: bun.PathString = bun.PathString.empty,

    /// This is the source index of the entry point. This file must have a valid
    /// entry point kind (i.e. not "none").
    source_index: Index.Int = 0,

    /// Manually specified output paths are ignored when computing the default
    /// "outbase" directory, which is computed as the lowest common ancestor of
    /// all automatically generated output paths.
    output_path_was_auto_generated: bool = false,

    pub const List = MultiArrayList(EntryPoint);

    pub const Kind = enum {
        none,
        user_specified,
        dynamic_import,
        html,

        pub fn outputKind(this: Kind) JSC.API.BuildArtifact.OutputKind {
            return switch (this) {
                .user_specified => .@"entry-point",
                else => .chunk,
            };
        }

        pub inline fn isEntryPoint(this: Kind) bool {
            return this != .none;
        }

        pub inline fn isUserSpecifiedEntryPoint(this: Kind) bool {
            return this == .user_specified;
        }

        // TODO: delete
        pub inline fn isServerEntryPoint(this: Kind) bool {
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
    files_live: BitSet = undefined,
    entry_points: EntryPoint.List = .{},
    symbols: js_ast.Symbol.Map = .{},

    allocator: std.mem.Allocator,

    code_splitting: bool = false,

    // This is an alias from Graph
    // it is not a clone!
    ast: MultiArrayList(JSAst) = .{},
    meta: MultiArrayList(JSMeta) = .{},

    /// We should avoid traversing all files in the bundle, because the linker
    /// should be able to run a linking operation on a large bundle where only
    /// a few files are needed (e.g. an incremental compilation scenario). This
    /// holds all files that could possibly be reached through the entry points.
    /// If you need to iterate over all files in the linking operation, iterate
    /// over this array. This array is also sorted in a deterministic ordering
    /// to help ensure deterministic builds (source indices are random).
    reachable_files: []Index = &[_]Index{},

    /// Index from `.parse_graph.input_files` to index in `.files`
    stable_source_indices: []const u32 = &[_]u32{},

    is_scb_bitset: BitSet = .{},
    has_client_components: bool = false,
    has_server_components: bool = false,

    /// This is for cross-module inlining of detected inlinable constants
    // const_values: js_ast.Ast.ConstValuesMap = .{},
    /// This is for cross-module inlining of TypeScript enum constants
    ts_enums: js_ast.Ast.TsEnumsMap = .{},

    pub fn init(allocator: std.mem.Allocator, file_count: usize) !LinkerGraph {
        return LinkerGraph{
            .allocator = allocator,
            .files_live = try BitSet.initEmpty(allocator, file_count),
        };
    }

    pub fn runtimeFunction(this: *const LinkerGraph, name: string) Ref {
        return this.ast.items(.named_exports)[Index.runtime.value].get(name).?.ref;
    }

    pub fn generateNewSymbol(this: *LinkerGraph, source_index: u32, kind: Symbol.Kind, original_name: string) Ref {
        const source_symbols = &this.symbols.symbols_for_source.slice()[source_index];

        var ref = Ref.init(
            @truncate(source_symbols.len),
            @truncate(source_index),
            false,
        );
        ref.tag = .symbol;

        // TODO: will this crash on resize due to using threadlocal mimalloc heap?
        source_symbols.push(
            this.allocator,
            .{
                .kind = kind,
                .original_name = original_name,
            },
        ) catch unreachable;

        this.ast.items(.module_scope)[source_index].generated.push(this.allocator, ref) catch unreachable;
        return ref;
    }

    pub fn generateRuntimeSymbolImportAndUse(
        graph: *LinkerGraph,
        source_index: Index.Int,
        entry_point_part_index: Index,
        name: []const u8,
        count: u32,
    ) !void {
        if (count == 0) return;
        debug("generateRuntimeSymbolImportAndUse({s}) for {d}", .{ name, source_index });

        const ref = graph.runtimeFunction(name);
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
        part: Part,
    ) !u32 {
        var parts: *Part.List = &graph.ast.items(.parts)[id];
        const part_id = @as(u32, @truncate(parts.len));
        try parts.push(graph.allocator, part);
        var top_level_symbol_to_parts_overlay: ?*TopLevelSymbolToParts = null;

        const Iterator = struct {
            graph: *LinkerGraph,
            id: u32,
            top_level_symbol_to_parts_overlay: *?*TopLevelSymbolToParts,
            part_id: u32,

            pub fn next(self: *@This(), ref: Ref) void {
                var overlay = brk: {
                    if (self.top_level_symbol_to_parts_overlay.*) |out| {
                        break :brk out;
                    }

                    const out = &self.graph.meta.items(.top_level_symbol_to_parts_overlay)[self.id];

                    self.top_level_symbol_to_parts_overlay.* = out;
                    break :brk out;
                };

                var entry = overlay.getOrPut(self.graph.allocator, ref) catch unreachable;
                if (!entry.found_existing) {
                    if (self.graph.ast.items(.top_level_symbols_to_parts)[self.id].get(ref)) |original_parts| {
                        var list = std.ArrayList(u32).init(self.graph.allocator);
                        list.ensureTotalCapacityPrecise(original_parts.len + 1) catch unreachable;
                        list.appendSliceAssumeCapacity(original_parts.slice());
                        list.appendAssumeCapacity(self.part_id);

                        entry.value_ptr.* = .init(list.items);
                    } else {
                        entry.value_ptr.* = BabyList(u32).fromSlice(self.graph.allocator, &.{self.part_id}) catch bun.outOfMemory();
                    }
                } else {
                    entry.value_ptr.push(self.graph.allocator, self.part_id) catch unreachable;
                }
            }
        };

        var ctx = Iterator{
            .graph = graph,
            .id = id,
            .part_id = part_id,
            .top_level_symbol_to_parts_overlay = &top_level_symbol_to_parts_overlay,
        };

        js_ast.DeclaredSymbol.forEachTopLevelSymbol(&parts.ptr[part_id].declared_symbols, &ctx, Iterator.next);

        return part_id;
    }

    pub fn generateSymbolImportAndUse(
        g: *LinkerGraph,
        source_index: u32,
        part_index: u32,
        ref: Ref,
        use_count: u32,
        source_index_to_import_from: Index,
    ) !void {
        if (use_count == 0) return;

        var parts_list = g.ast.items(.parts)[source_index].slice();
        var part: *Part = &parts_list[part_index];

        // Mark this symbol as used by this part

        var uses = &part.symbol_uses;
        var uses_entry = uses.getOrPut(g.allocator, ref) catch unreachable;

        if (!uses_entry.found_existing) {
            uses_entry.value_ptr.* = .{ .count_estimate = use_count };
        } else {
            uses_entry.value_ptr.count_estimate += use_count;
        }

        const exports_ref = g.ast.items(.exports_ref)[source_index];
        const module_ref = g.ast.items(.module_ref)[source_index];
        if (!exports_ref.isNull() and ref.eql(exports_ref)) {
            g.ast.items(.flags)[source_index].uses_exports_ref = true;
        }

        if (!module_ref.isNull() and ref.eql(module_ref)) {
            g.ast.items(.flags)[source_index].uses_module_ref = true;
        }

        // null ref shouldn't be there.
        bun.assert(!ref.isEmpty());

        // Track that this specific symbol was imported
        if (source_index_to_import_from.get() != source_index) {
            const imports_to_bind = &g.meta.items(.imports_to_bind)[source_index];
            try imports_to_bind.put(g.allocator, ref, .{
                .data = .{
                    .source_index = source_index_to_import_from,
                    .import_ref = ref,
                },
            });
        }

        // Pull in all parts that declare this symbol
        var dependencies = &part.dependencies;
        const part_ids = g.topLevelSymbolToParts(source_index_to_import_from.get(), ref);
        const new_dependencies = try dependencies.writableSlice(g.allocator, part_ids.len);
        for (part_ids, new_dependencies) |part_id, *dependency| {
            dependency.* = .{
                .source_index = source_index_to_import_from,
                .part_index = @as(u32, @truncate(part_id)),
            };
        }
    }

    pub fn topLevelSymbolToParts(g: *LinkerGraph, id: u32, ref: Ref) []u32 {
        if (g.meta.items(.top_level_symbol_to_parts_overlay)[id].get(ref)) |overlay| {
            return overlay.slice();
        }

        if (g.ast.items(.top_level_symbols_to_parts)[id].get(ref)) |list| {
            return list.slice();
        }

        return &.{};
    }

    pub fn load(
        this: *LinkerGraph,
        entry_points: []const Index,
        sources: []const Logger.Source,
        server_component_boundaries: ServerComponentBoundary.List,
        dynamic_import_entry_points: []const Index.Int,
    ) !void {
        const scb = server_component_boundaries.slice();
        try this.files.setCapacity(this.allocator, sources.len);
        this.files.zero();
        this.files_live = try BitSet.initEmpty(
            this.allocator,
            sources.len,
        );
        this.files.len = sources.len;
        var files = this.files.slice();

        var entry_point_kinds = files.items(.entry_point_kind);
        {
            const kinds = std.mem.sliceAsBytes(entry_point_kinds);
            @memset(kinds, 0);
        }

        // Setup entry points
        {
            try this.entry_points.setCapacity(this.allocator, entry_points.len + server_component_boundaries.list.len + dynamic_import_entry_points.len);
            this.entry_points.len = entry_points.len;
            const source_indices = this.entry_points.items(.source_index);

            const path_strings: []bun.PathString = this.entry_points.items(.output_path);
            {
                const output_was_auto_generated = std.mem.sliceAsBytes(this.entry_points.items(.output_path_was_auto_generated));
                @memset(output_was_auto_generated, 0);
            }

            for (entry_points, path_strings, source_indices) |i, *path_string, *source_index| {
                const source = sources[i.get()];
                if (comptime Environment.allow_assert) {
                    bun.assert(source.index.get() == i.get());
                }
                entry_point_kinds[source.index.get()] = EntryPoint.Kind.user_specified;
                path_string.* = bun.PathString.init(source.path.text);
                source_index.* = source.index.get();
            }

            for (dynamic_import_entry_points) |id| {
                bun.assert(this.code_splitting); // this should never be a thing without code splitting

                if (entry_point_kinds[id] != .none) {
                    // You could dynamic import a file that is already an entry point
                    continue;
                }

                const source = &sources[id];
                entry_point_kinds[id] = EntryPoint.Kind.dynamic_import;

                this.entry_points.appendAssumeCapacity(.{
                    .source_index = id,
                    .output_path = bun.PathString.init(source.path.text),
                    .output_path_was_auto_generated = true,
                });
            }

            var import_records_list: []ImportRecord.List = this.ast.items(.import_records);
            try this.meta.setCapacity(this.allocator, import_records_list.len);
            this.meta.len = this.ast.len;
            this.meta.zero();

            if (scb.list.len > 0) {
                this.is_scb_bitset = BitSet.initEmpty(this.allocator, this.files.len) catch unreachable;

                // Index all SCBs into the bitset. This is needed so chunking
                // can track the chunks that SCBs belong to.
                for (scb.list.items(.use_directive), scb.list.items(.source_index), scb.list.items(.reference_source_index)) |use, original_id, ref_id| {
                    switch (use) {
                        .none => {},
                        .client => {
                            this.is_scb_bitset.set(original_id);
                            this.is_scb_bitset.set(ref_id);
                        },
                        .server => {
                            bun.todoPanic(@src(), "um", .{});
                        },
                    }
                }

                // For client components, the import record index currently points to the original source index, instead of the reference source index.
                for (this.reachable_files) |source_id| {
                    for (import_records_list[source_id.get()].slice()) |*import_record| {
                        if (import_record.source_index.isValid() and this.is_scb_bitset.isSet(import_record.source_index.get())) {
                            import_record.source_index = Index.init(
                                scb.getReferenceSourceIndex(import_record.source_index.get()) orelse
                                    // If this gets hit, might be fine to switch this to `orelse continue`
                                    // not confident in this assertion
                                    Output.panic("Missing SCB boundary for file #{d}", .{import_record.source_index.get()}),
                            );
                            bun.assert(import_record.source_index.isValid()); // did not generate
                        }
                    }
                }
            } else {
                this.is_scb_bitset = .{};
            }
        }

        // Setup files
        {
            var stable_source_indices = try this.allocator.alloc(Index, sources.len + 1);

            // set it to max value so that if we access an invalid one, it crashes
            @memset(std.mem.sliceAsBytes(stable_source_indices), 255);

            for (this.reachable_files, 0..) |source_index, i| {
                stable_source_indices[source_index.get()] = Index.source(i);
            }

            @memset(
                files.items(.distance_from_entry_point),
                (LinkerGraph.File{}).distance_from_entry_point,
            );
            this.stable_source_indices = @as([]const u32, @ptrCast(stable_source_indices));
        }

        {
            var input_symbols = js_ast.Symbol.Map.initList(js_ast.Symbol.NestedList.init(this.ast.items(.symbols)));
            var symbols = input_symbols.symbols_for_source.clone(this.allocator) catch bun.outOfMemory();
            for (symbols.slice(), input_symbols.symbols_for_source.slice()) |*dest, src| {
                dest.* = src.clone(this.allocator) catch bun.outOfMemory();
            }
            this.symbols = js_ast.Symbol.Map.initList(symbols);
        }

        // TODO: const_values
        // {
        //     var const_values = this.const_values;
        //     var count: usize = 0;

        //     for (this.ast.items(.const_values)) |const_value| {
        //         count += const_value.count();
        //     }

        //     if (count > 0) {
        //         try const_values.ensureTotalCapacity(this.allocator, count);
        //         for (this.ast.items(.const_values)) |const_value| {
        //             for (const_value.keys(), const_value.values()) |key, value| {
        //                 const_values.putAssumeCapacityNoClobber(key, value);
        //             }
        //         }
        //     }

        //     this.const_values = const_values;
        // }

        {
            var count: usize = 0;
            for (this.ast.items(.ts_enums)) |ts_enums| {
                count += ts_enums.count();
            }
            if (count > 0) {
                try this.ts_enums.ensureTotalCapacity(this.allocator, count);
                for (this.ast.items(.ts_enums)) |ts_enums| {
                    for (ts_enums.keys(), ts_enums.values()) |key, value| {
                        this.ts_enums.putAssumeCapacityNoClobber(key, value);
                    }
                }
            }
        }

        const src_named_exports: []js_ast.Ast.NamedExports = this.ast.items(.named_exports);
        const dest_resolved_exports: []ResolvedExports = this.meta.items(.resolved_exports);
        for (src_named_exports, dest_resolved_exports, 0..) |src, *dest, source_index| {
            var resolved = ResolvedExports{};
            resolved.ensureTotalCapacity(this.allocator, src.count()) catch unreachable;
            for (src.keys(), src.values()) |key, value| {
                resolved.putAssumeCapacityNoClobber(key, .{ .data = .{
                    .import_ref = value.ref,
                    .name_loc = value.alias_loc,
                    .source_index = Index.source(source_index),
                } });
            }
            dest.* = resolved;
        }
    }

    pub const File = struct {
        entry_bits: AutoBitSet = undefined,

        input_file: Index = Index.source(0),

        /// The minimum number of links in the module graph to get from an entry point
        /// to this file
        distance_from_entry_point: u32 = std.math.maxInt(u32),

        /// This file is an entry point if and only if this is not ".none".
        /// Note that dynamically-imported files are allowed to also be specified by
        /// the user as top-level entry points, so some dynamically-imported files
        /// may be ".user_specified" instead of ".dynamic_import".
        entry_point_kind: EntryPoint.Kind = .none,

        /// If "entry_point_kind" is not ".none", this is the index of the
        /// corresponding entry point chunk.
        ///
        /// This is also initialized for files that are a SCB's generated
        /// reference, pointing to its destination. This forms a lookup map from
        /// a Source.Index to its output path inb reakOutputIntoPieces
        entry_point_chunk_index: u32 = std.math.maxInt(u32),

        line_offset_table: bun.sourcemap.LineOffsetTable.List = .empty,
        quoted_source_contents: string = "",

        pub fn isEntryPoint(this: *const File) bool {
            return this.entry_point_kind.isEntryPoint();
        }

        pub fn isUserSpecifiedEntryPoint(this: *const File) bool {
            return this.entry_point_kind.isUserSpecifiedEntryPoint();
        }

        pub const List = MultiArrayList(File);
    };
};

pub const LinkerContext = struct {
    const debug = Output.scoped(.LinkerCtx, false);

    parse_graph: *Graph = undefined,
    graph: LinkerGraph = undefined,
    allocator: std.mem.Allocator = undefined,
    log: *Logger.Log = undefined,

    resolver: *Resolver = undefined,
    cycle_detector: std.ArrayList(ImportTracker) = undefined,

    /// We may need to refer to the "__esm" and/or "__commonJS" runtime symbols
    cjs_runtime_ref: Ref = Ref.None,
    esm_runtime_ref: Ref = Ref.None,

    /// We may need to refer to the CommonJS "module" symbol for exports
    unbound_module_ref: Ref = Ref.None,

    options: LinkerOptions = .{},

    wait_group: ThreadPoolLib.WaitGroup = .{},

    ambiguous_result_pool: std.ArrayList(MatchImport) = undefined,

    loop: EventLoop,

    /// string buffer containing pre-formatted unique keys
    unique_key_buf: []u8 = "",

    /// string buffer containing prefix for each unique keys
    unique_key_prefix: string = "",

    source_maps: SourceMapData = .{},

    /// This will eventually be used for reference-counting LinkerContext
    /// to know whether or not we can free it safely.
    pending_task_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    ///
    has_any_css_locals: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    /// Used by Bake to extract []CompileResult before it is joined
    dev_server: ?*bun.bake.DevServer = null,
    framework: ?*const bake.Framework = null,

    mangled_props: MangledProps = .{},

    fn pathWithPrettyInitialized(this: *LinkerContext, path: Fs.Path) !Fs.Path {
        return genericPathWithPrettyInitialized(path, this.options.target, this.resolver.fs.top_level_dir, this.graph.allocator);
    }

    pub const LinkerOptions = struct {
        generate_bytecode_cache: bool = false,
        output_format: options.Format = .esm,
        ignore_dce_annotations: bool = false,
        emit_dce_annotations: bool = true,
        tree_shaking: bool = true,
        minify_whitespace: bool = false,
        minify_syntax: bool = false,
        minify_identifiers: bool = false,
        banner: []const u8 = "",
        footer: []const u8 = "",
        css_chunking: bool = false,
        source_maps: options.SourceMapOption = .none,
        target: options.Target = .browser,

        mode: Mode = .bundle,

        public_path: []const u8 = "",

        pub const Mode = enum {
            passthrough,
            bundle,
        };
    };

    pub const SourceMapData = struct {
        line_offset_wait_group: sync.WaitGroup = .{},
        line_offset_tasks: []Task = &.{},

        quoted_contents_wait_group: sync.WaitGroup = .{},
        quoted_contents_tasks: []Task = &.{},

        pub const Task = struct {
            ctx: *LinkerContext,
            source_index: Index.Int,
            thread_task: ThreadPoolLib.Task = .{ .callback = &runLineOffset },

            pub fn runLineOffset(thread_task: *ThreadPoolLib.Task) void {
                var task: *Task = @fieldParentPtr("thread_task", thread_task);
                defer {
                    task.ctx.markPendingTaskDone();
                    task.ctx.source_maps.line_offset_wait_group.finish();
                }

                const worker = ThreadPool.Worker.get(@fieldParentPtr("linker", task.ctx));
                defer worker.unget();
                SourceMapData.computeLineOffsets(task.ctx, worker.allocator, task.source_index);
            }

            pub fn runQuotedSourceContents(thread_task: *ThreadPoolLib.Task) void {
                var task: *Task = @fieldParentPtr("thread_task", thread_task);
                defer {
                    task.ctx.markPendingTaskDone();
                    task.ctx.source_maps.quoted_contents_wait_group.finish();
                }

                const worker = ThreadPool.Worker.get(@fieldParentPtr("linker", task.ctx));
                defer worker.unget();

                // Use the default allocator when using DevServer and the file
                // was generated. This will be preserved so that remapping
                // stack traces can show the source code, even after incremental
                // rebuilds occur.
                const allocator = if (worker.ctx.transpiler.options.dev_server) |dev|
                    dev.allocator
                else
                    worker.allocator;

                SourceMapData.computeQuotedSourceContents(task.ctx, allocator, task.source_index);
            }
        };

        pub fn computeLineOffsets(this: *LinkerContext, allocator: std.mem.Allocator, source_index: Index.Int) void {
            debug("Computing LineOffsetTable: {d}", .{source_index});
            const line_offset_table: *bun.sourcemap.LineOffsetTable.List = &this.graph.files.items(.line_offset_table)[source_index];

            const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];
            const loader: options.Loader = this.parse_graph.input_files.items(.loader)[source_index];

            if (!loader.canHaveSourceMap()) {
                // This is not a file which we support generating source maps for
                line_offset_table.* = .{};
                return;
            }

            const approximate_line_count = this.graph.ast.items(.approximate_newline_count)[source_index];

            line_offset_table.* = bun.sourcemap.LineOffsetTable.generate(
                allocator,
                source.contents,

                // We don't support sourcemaps for source files with more than 2^31 lines
                @as(i32, @intCast(@as(u31, @truncate(approximate_line_count)))),
            );
        }

        pub fn computeQuotedSourceContents(this: *LinkerContext, allocator: std.mem.Allocator, source_index: Index.Int) void {
            debug("Computing Quoted Source Contents: {d}", .{source_index});
            const loader: options.Loader = this.parse_graph.input_files.items(.loader)[source_index];
            const quoted_source_contents: *string = &this.graph.files.items(.quoted_source_contents)[source_index];
            if (!loader.canHaveSourceMap()) {
                quoted_source_contents.* = "";
                return;
            }

            const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];
            const mutable = MutableString.initEmpty(allocator);
            quoted_source_contents.* = (js_printer.quoteForJSON(source.contents, mutable, false) catch bun.outOfMemory()).list.items;
        }
    };

    fn isExternalDynamicImport(this: *LinkerContext, record: *const ImportRecord, source_index: u32) bool {
        return this.graph.code_splitting and
            record.kind == .dynamic and
            this.graph.files.items(.entry_point_kind)[record.source_index.get()].isEntryPoint() and
            record.source_index.get() != source_index;
    }

    inline fn shouldCallRuntimeRequire(format: options.Format) bool {
        return format != .cjs;
    }

    pub fn shouldIncludePart(c: *LinkerContext, source_index: Index.Int, part: Part) bool {
        // As an optimization, ignore parts containing a single import statement to
        // an internal non-wrapped file. These will be ignored anyway and it's a
        // performance hit to spin up a goroutine only to discover this later.
        if (part.stmts.len == 1) {
            if (part.stmts[0].data == .s_import) {
                const record = c.graph.ast.items(.import_records)[source_index].at(part.stmts[0].data.s_import.import_record_index);
                if (record.source_index.isValid() and c.graph.meta.items(.flags)[record.source_index.get()].wrap == .none) {
                    return false;
                }
            }
        }

        return true;
    }

    fn load(
        this: *LinkerContext,
        bundle: *BundleV2,
        entry_points: []Index,
        server_component_boundaries: ServerComponentBoundary.List,
        reachable: []Index,
    ) !void {
        const trace = bun.perf.trace("Bundler.CloneLinkerGraph");
        defer trace.end();
        this.parse_graph = &bundle.graph;

        this.graph.code_splitting = bundle.transpiler.options.code_splitting;
        this.log = bundle.transpiler.log;

        this.resolver = &bundle.transpiler.resolver;
        this.cycle_detector = std.ArrayList(ImportTracker).init(this.allocator);

        this.graph.reachable_files = reachable;

        const sources: []const Logger.Source = this.parse_graph.input_files.items(.source);

        try this.graph.load(entry_points, sources, server_component_boundaries, bundle.dynamic_import_entry_points.keys());
        bundle.dynamic_import_entry_points.deinit();
        this.wait_group.init();
        this.ambiguous_result_pool = std.ArrayList(MatchImport).init(this.allocator);

        var runtime_named_exports = &this.graph.ast.items(.named_exports)[Index.runtime.get()];

        this.esm_runtime_ref = runtime_named_exports.get("__esm").?.ref;
        this.cjs_runtime_ref = runtime_named_exports.get("__commonJS").?.ref;

        if (this.options.output_format == .cjs) {
            this.unbound_module_ref = this.graph.generateNewSymbol(Index.runtime.get(), .unbound, "module");
        }

        if (this.options.output_format == .cjs or this.options.output_format == .iife) {
            const exports_kind = this.graph.ast.items(.exports_kind);
            const ast_flags_list = this.graph.ast.items(.flags);
            const meta_flags_list = this.graph.meta.items(.flags);

            for (entry_points) |entry_point| {
                var ast_flags: js_ast.BundledAst.Flags = ast_flags_list[entry_point.get()];

                // Loaders default to CommonJS when they are the entry point and the output
                // format is not ESM-compatible since that avoids generating the ESM-to-CJS
                // machinery.
                if (ast_flags.has_lazy_export) {
                    exports_kind[entry_point.get()] = .cjs;
                }

                // Entry points with ES6 exports must generate an exports object when
                // targeting non-ES6 formats. Note that the IIFE format only needs this
                // when the global name is present, since that's the only way the exports
                // can actually be observed externally.
                if (ast_flags.uses_export_keyword) {
                    ast_flags.uses_exports_ref = true;
                    ast_flags_list[entry_point.get()] = ast_flags;
                    meta_flags_list[entry_point.get()].force_include_exports_for_entry_point = true;
                }
            }
        }
    }

    pub fn computeDataForSourceMap(
        this: *LinkerContext,
        reachable: []const Index.Int,
    ) void {
        bun.assert(this.options.source_maps != .none);
        this.source_maps.line_offset_wait_group.init();
        this.source_maps.quoted_contents_wait_group.init();
        this.source_maps.line_offset_wait_group.counter = @as(u32, @truncate(reachable.len));
        this.source_maps.quoted_contents_wait_group.counter = @as(u32, @truncate(reachable.len));
        this.source_maps.line_offset_tasks = this.allocator.alloc(SourceMapData.Task, reachable.len) catch unreachable;
        this.source_maps.quoted_contents_tasks = this.allocator.alloc(SourceMapData.Task, reachable.len) catch unreachable;

        var batch = ThreadPoolLib.Batch{};
        var second_batch = ThreadPoolLib.Batch{};
        for (reachable, this.source_maps.line_offset_tasks, this.source_maps.quoted_contents_tasks) |source_index, *line_offset, *quoted| {
            line_offset.* = .{
                .ctx = this,
                .source_index = source_index,
                .thread_task = .{ .callback = &SourceMapData.Task.runLineOffset },
            };
            quoted.* = .{
                .ctx = this,
                .source_index = source_index,
                .thread_task = .{ .callback = &SourceMapData.Task.runQuotedSourceContents },
            };
            batch.push(.from(&line_offset.thread_task));
            second_batch.push(.from(&quoted.thread_task));
        }

        // line offsets block sooner and are faster to compute, so we should schedule those first
        batch.push(second_batch);

        this.scheduleTasks(batch);
    }

    pub fn scheduleTasks(this: *LinkerContext, batch: ThreadPoolLib.Batch) void {
        _ = this.pending_task_count.fetchAdd(@as(u32, @truncate(batch.len)), .monotonic);
        this.parse_graph.pool.worker_pool.schedule(batch);
    }

    pub fn markPendingTaskDone(this: *LinkerContext) void {
        _ = this.pending_task_count.fetchSub(1, .monotonic);
    }

    pub noinline fn link(
        this: *LinkerContext,
        bundle: *BundleV2,
        entry_points: []Index,
        server_component_boundaries: ServerComponentBoundary.List,
        reachable: []Index,
    ) ![]Chunk {
        try this.load(
            bundle,
            entry_points,
            server_component_boundaries,
            reachable,
        );

        if (this.options.source_maps != .none) {
            this.computeDataForSourceMap(@as([]Index.Int, @ptrCast(reachable)));
        }

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        try this.scanImportsAndExports();

        // Stop now if there were errors
        if (this.log.hasErrors()) {
            return error.BuildFailed;
        }

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        try this.treeShakingAndCodeSplitting();

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        const chunks = try this.computeChunks(bundle.unique_key);

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        try this.computeCrossChunkDependencies(chunks);

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        this.graph.symbols.followAll();

        return chunks;
    }

    fn checkForMemoryCorruption(this: *LinkerContext) void {
        // For this to work, you need mimalloc's debug build enabled.
        //    make mimalloc-debug
        this.parse_graph.heap.helpCatchMemoryIssues();
    }

    const JSChunkKeyFormatter = struct {
        has_html: bool,
        entry_bits: []const u8,

        pub fn format(this: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
            try writer.writeAll(&[_]u8{@intFromBool(!this.has_html)});
            try writer.writeAll(this.entry_bits);
        }
    };
    pub noinline fn computeChunks(
        this: *LinkerContext,
        unique_key: u64,
    ) ![]Chunk {
        const trace = bun.perf.trace("Bundler.computeChunks");
        defer trace.end();

        bun.assert(this.dev_server == null); // use

        var stack_fallback = std.heap.stackFallback(4096, this.allocator);
        const stack_all = stack_fallback.get();
        var arena = bun.ArenaAllocator.init(stack_all);
        defer arena.deinit();

        var temp_allocator = arena.allocator();
        var js_chunks = bun.StringArrayHashMap(Chunk).init(temp_allocator);
        try js_chunks.ensureUnusedCapacity(this.graph.entry_points.len);

        // Key is the hash of the CSS order. This deduplicates identical CSS files.
        var css_chunks = std.AutoArrayHashMap(u64, Chunk).init(temp_allocator);
        var js_chunks_with_css: usize = 0;

        const entry_source_indices = this.graph.entry_points.items(.source_index);
        const css_asts = this.graph.ast.items(.css);
        const css_chunking = this.options.css_chunking;
        var html_chunks = bun.StringArrayHashMap(Chunk).init(temp_allocator);
        const loaders = this.parse_graph.input_files.items(.loader);

        const code_splitting = this.graph.code_splitting;

        // Create chunks for entry points
        for (entry_source_indices, 0..) |source_index, entry_id_| {
            const entry_bit = @as(Chunk.EntryPoint.ID, @truncate(entry_id_));

            var entry_bits = &this.graph.files.items(.entry_bits)[source_index];
            entry_bits.set(entry_bit);

            const has_html_chunk = loaders[source_index] == .html;
            const js_chunk_key = brk: {
                if (code_splitting) {
                    break :brk try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len));
                } else {
                    // Force HTML chunks to always be generated, even if there's an identical JS file.
                    break :brk try std.fmt.allocPrint(temp_allocator, "{}", .{JSChunkKeyFormatter{
                        .has_html = has_html_chunk,
                        .entry_bits = entry_bits.bytes(this.graph.entry_points.len),
                    }});
                }
            };

            // Put this early on in this loop so that CSS-only entry points work.
            if (has_html_chunk) {
                const html_chunk_entry = try html_chunks.getOrPut(js_chunk_key);
                if (!html_chunk_entry.found_existing) {
                    html_chunk_entry.value_ptr.* = .{
                        .entry_point = .{
                            .entry_point_id = entry_bit,
                            .source_index = source_index,
                            .is_entry_point = true,
                        },
                        .entry_bits = entry_bits.*,
                        .content = .html,
                        .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                    };
                }
            }

            if (css_asts[source_index] != null) {
                const order = this.findImportedFilesInCSSOrder(temp_allocator, &.{Index.init(source_index)});
                // Create a chunk for the entry point here to ensure that the chunk is
                // always generated even if the resulting file is empty
                const hash_to_use = if (!this.options.css_chunking)
                    bun.hash(try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len)))
                else brk: {
                    var hasher = std.hash.Wyhash.init(5);
                    bun.writeAnyToHasher(&hasher, order.len);
                    for (order.slice()) |x| x.hash(&hasher);
                    break :brk hasher.final();
                };
                const css_chunk_entry = try css_chunks.getOrPut(hash_to_use);
                if (!css_chunk_entry.found_existing) {
                    // const css_chunk_entry = try js_chunks.getOrPut();
                    css_chunk_entry.value_ptr.* = .{
                        .entry_point = .{
                            .entry_point_id = entry_bit,
                            .source_index = source_index,
                            .is_entry_point = true,
                        },
                        .entry_bits = entry_bits.*,
                        .content = .{
                            .css = .{
                                .imports_in_chunk_in_order = order,
                                .asts = this.allocator.alloc(bun.css.BundlerStyleSheet, order.len) catch bun.outOfMemory(),
                            },
                        },
                        .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                        .has_html_chunk = has_html_chunk,
                    };
                }

                continue;
            }

            // Create a chunk for the entry point here to ensure that the chunk is
            // always generated even if the resulting file is empty
            const js_chunk_entry = try js_chunks.getOrPut(js_chunk_key);
            js_chunk_entry.value_ptr.* = .{
                .entry_point = .{
                    .entry_point_id = entry_bit,
                    .source_index = source_index,
                    .is_entry_point = true,
                },
                .entry_bits = entry_bits.*,
                .content = .{
                    .javascript = .{},
                },
                .has_html_chunk = has_html_chunk,
                .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
            };

            {
                // If this JS entry point has an associated CSS entry point, generate it
                // now. This is essentially done by generating a virtual CSS file that
                // only contains "@import" statements in the order that the files were
                // discovered in JS source order, where JS source order is arbitrary but
                // consistent for dynamic imports. Then we run the CSS import order
                // algorithm to determine the final CSS file order for the chunk.
                const css_source_indices = this.findImportedCSSFilesInJSOrder(temp_allocator, Index.init(source_index));
                if (css_source_indices.len > 0) {
                    const order = this.findImportedFilesInCSSOrder(temp_allocator, css_source_indices.slice());

                    const hash_to_use = if (!css_chunking)
                        bun.hash(try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len)))
                    else brk: {
                        var hasher = std.hash.Wyhash.init(5);
                        bun.writeAnyToHasher(&hasher, order.len);
                        for (order.slice()) |x| x.hash(&hasher);
                        break :brk hasher.final();
                    };

                    const css_chunk_entry = try css_chunks.getOrPut(hash_to_use);

                    js_chunk_entry.value_ptr.content.javascript.css_chunks = try this.allocator.dupe(u32, &.{
                        @intCast(css_chunk_entry.index),
                    });
                    js_chunks_with_css += 1;

                    if (!css_chunk_entry.found_existing) {
                        var css_files_with_parts_in_chunk = std.AutoArrayHashMapUnmanaged(Index.Int, void){};
                        for (order.slice()) |entry| {
                            if (entry.kind == .source_index) {
                                css_files_with_parts_in_chunk.put(this.allocator, entry.kind.source_index.get(), {}) catch bun.outOfMemory();
                            }
                        }
                        css_chunk_entry.value_ptr.* = .{
                            .entry_point = .{
                                .entry_point_id = entry_bit,
                                .source_index = source_index,
                                .is_entry_point = true,
                            },
                            .entry_bits = entry_bits.*,
                            .content = .{
                                .css = .{
                                    .imports_in_chunk_in_order = order,
                                    .asts = this.allocator.alloc(bun.css.BundlerStyleSheet, order.len) catch bun.outOfMemory(),
                                },
                            },
                            .files_with_parts_in_chunk = css_files_with_parts_in_chunk,
                            .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                            .has_html_chunk = has_html_chunk,
                        };
                    }
                }
            }
        }
        var file_entry_bits: []AutoBitSet = this.graph.files.items(.entry_bits);

        const Handler = struct {
            chunks: []Chunk,
            allocator: std.mem.Allocator,
            source_id: u32,

            pub fn next(c: *@This(), chunk_id: usize) void {
                _ = c.chunks[chunk_id].files_with_parts_in_chunk.getOrPut(c.allocator, @as(u32, @truncate(c.source_id))) catch unreachable;
            }
        };

        const css_reprs = this.graph.ast.items(.css);

        // Figure out which JS files are in which chunk
        if (js_chunks.count() > 0) {
            for (this.graph.reachable_files) |source_index| {
                if (this.graph.files_live.isSet(source_index.get())) {
                    if (this.graph.ast.items(.css)[source_index.get()] == null) {
                        const entry_bits: *const AutoBitSet = &file_entry_bits[source_index.get()];
                        if (css_reprs[source_index.get()] != null) continue;

                        if (this.graph.code_splitting) {
                            const js_chunk_key = try temp_allocator.dupe(u8, entry_bits.bytes(this.graph.entry_points.len));
                            var js_chunk_entry = try js_chunks.getOrPut(js_chunk_key);

                            if (!js_chunk_entry.found_existing) {
                                js_chunk_entry.value_ptr.* = .{
                                    .entry_bits = entry_bits.*,
                                    .entry_point = .{
                                        .source_index = source_index.get(),
                                    },
                                    .content = .{
                                        .javascript = .{},
                                    },
                                    .output_source_map = sourcemap.SourceMapPieces.init(this.allocator),
                                };
                            }

                            _ = js_chunk_entry.value_ptr.files_with_parts_in_chunk.getOrPut(this.allocator, @as(u32, @truncate(source_index.get()))) catch unreachable;
                        } else {
                            var handler = Handler{
                                .chunks = js_chunks.values(),
                                .allocator = this.allocator,
                                .source_id = source_index.get(),
                            };
                            entry_bits.forEach(Handler, &handler, Handler.next);
                        }
                    }
                }
            }
        }

        // Sort the chunks for determinism. This matters because we use chunk indices
        // as sorting keys in a few places.
        const chunks: []Chunk = sort_chunks: {
            var sorted_chunks = try BabyList(Chunk).initCapacity(this.allocator, js_chunks.count() + css_chunks.count() + html_chunks.count());

            var sorted_keys = try BabyList(string).initCapacity(temp_allocator, js_chunks.count());

            // JS Chunks
            sorted_keys.appendSliceAssumeCapacity(js_chunks.keys());
            sorted_keys.sortAsc();
            var js_chunk_indices_with_css = try BabyList(u32).initCapacity(temp_allocator, js_chunks_with_css);
            for (sorted_keys.slice()) |key| {
                const chunk = js_chunks.get(key) orelse unreachable;

                if (chunk.content.javascript.css_chunks.len > 0)
                    js_chunk_indices_with_css.appendAssumeCapacity(sorted_chunks.len);

                sorted_chunks.appendAssumeCapacity(chunk);

                // Attempt to order the JS HTML chunk immediately after the non-html one.
                if (chunk.has_html_chunk) {
                    if (html_chunks.fetchSwapRemove(key)) |html_chunk| {
                        sorted_chunks.appendAssumeCapacity(html_chunk.value);
                    }
                }
            }

            if (css_chunks.count() > 0) {
                const sorted_css_keys = try temp_allocator.dupe(u64, css_chunks.keys());
                std.sort.pdq(u64, sorted_css_keys, {}, std.sort.asc(u64));

                // A map from the index in `css_chunks` to it's final index in `sorted_chunks`
                const remapped_css_indexes = try temp_allocator.alloc(u32, css_chunks.count());

                const css_chunk_values = css_chunks.values();
                for (sorted_css_keys, js_chunks.count()..) |key, sorted_index| {
                    const index = css_chunks.getIndex(key) orelse unreachable;
                    sorted_chunks.appendAssumeCapacity(css_chunk_values[index]);
                    remapped_css_indexes[index] = @intCast(sorted_index);
                }

                // Update all affected JS chunks to point at the correct CSS chunk index.
                for (js_chunk_indices_with_css.slice()) |js_index| {
                    for (sorted_chunks.slice()[js_index].content.javascript.css_chunks) |*idx| {
                        idx.* = remapped_css_indexes[idx.*];
                    }
                }
            }

            // We don't care about the order of the HTML chunks that have no JS chunks.
            try sorted_chunks.append(this.allocator, html_chunks.values());

            break :sort_chunks sorted_chunks.slice();
        };

        const entry_point_chunk_indices: []u32 = this.graph.files.items(.entry_point_chunk_index);
        // Map from the entry point file to this chunk. We will need this later if
        // a file contains a dynamic import to this entry point, since we'll need
        // to look up the path for this chunk to use with the import.
        for (chunks, 0..) |*chunk, chunk_id| {
            if (chunk.entry_point.is_entry_point) {
                entry_point_chunk_indices[chunk.entry_point.source_index] = @intCast(chunk_id);
            }
        }

        // Determine the order of JS files (and parts) within the chunk ahead of time
        try this.findAllImportedPartsInJSOrder(temp_allocator, chunks);

        const unique_key_item_len = std.fmt.count("{any}C{d:0>8}", .{ bun.fmt.hexIntLower(unique_key), chunks.len });
        var unique_key_builder = try bun.StringBuilder.initCapacity(this.allocator, unique_key_item_len * chunks.len);
        this.unique_key_buf = unique_key_builder.allocatedSlice();

        errdefer {
            unique_key_builder.deinit(this.allocator);
            this.unique_key_buf = "";
        }

        const kinds = this.graph.files.items(.entry_point_kind);
        const output_paths = this.graph.entry_points.items(.output_path);
        for (chunks, 0..) |*chunk, chunk_id| {
            // Assign a unique key to each chunk. This key encodes the index directly so
            // we can easily recover it later without needing to look it up in a map. The
            // last 8 numbers of the key are the chunk index.
            chunk.unique_key = unique_key_builder.fmt("{}C{d:0>8}", .{ bun.fmt.hexIntLower(unique_key), chunk_id });
            if (this.unique_key_prefix.len == 0)
                this.unique_key_prefix = chunk.unique_key[0..std.fmt.count("{}", .{bun.fmt.hexIntLower(unique_key)})];

            if (chunk.entry_point.is_entry_point and
                (chunk.content == .html or (kinds[chunk.entry_point.source_index] == .user_specified and !chunk.has_html_chunk)))
            {
                chunk.template = PathTemplate.file;
                if (this.resolver.opts.entry_naming.len > 0)
                    chunk.template.data = this.resolver.opts.entry_naming;
            } else {
                chunk.template = PathTemplate.chunk;
                if (this.resolver.opts.chunk_naming.len > 0)
                    chunk.template.data = this.resolver.opts.chunk_naming;
            }

            const pathname = Fs.PathName.init(output_paths[chunk.entry_point.entry_point_id].slice());
            chunk.template.placeholder.name = pathname.base;
            chunk.template.placeholder.ext = chunk.content.ext();

            // this if check is a specific fix for `bun build hi.ts --external '*'`, without leading `./`
            const dir_path = if (pathname.dir.len > 0) pathname.dir else ".";

            var real_path_buf: bun.PathBuffer = undefined;
            const dir = dir: {
                var dir = std.fs.cwd().openDir(dir_path, .{}) catch {
                    break :dir bun.path.normalizeBuf(dir_path, &real_path_buf, .auto);
                };
                defer dir.close();

                break :dir try bun.getFdPath(bun.toFD(dir.fd), &real_path_buf);
            };

            chunk.template.placeholder.dir = try resolve_path.relativeAlloc(this.allocator, this.resolver.opts.root_dir, dir);
        }

        return chunks;
    }

    pub fn findAllImportedPartsInJSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, chunks: []Chunk) !void {
        const trace = bun.perf.trace("Bundler.findAllImportedPartsInJSOrder");
        defer trace.end();

        var part_ranges_shared = std.ArrayList(PartRange).init(temp_allocator);
        var parts_prefix_shared = std.ArrayList(PartRange).init(temp_allocator);
        defer part_ranges_shared.deinit();
        defer parts_prefix_shared.deinit();
        for (chunks, 0..) |*chunk, index| {
            switch (chunk.content) {
                .javascript => {
                    try this.findImportedPartsInJSOrder(
                        chunk,
                        &part_ranges_shared,
                        &parts_prefix_shared,
                        @intCast(index),
                    );
                },
                .css => {}, // handled in `findImportedCSSFilesInJSOrder`
                .html => {},
            }
        }
    }

    pub fn findImportedPartsInJSOrder(
        this: *LinkerContext,
        chunk: *Chunk,
        part_ranges_shared: *std.ArrayList(PartRange),
        parts_prefix_shared: *std.ArrayList(PartRange),
        chunk_index: u32,
    ) !void {
        var chunk_order_array = try std.ArrayList(Chunk.Order).initCapacity(this.allocator, chunk.files_with_parts_in_chunk.count());
        defer chunk_order_array.deinit();
        const distances = this.graph.files.items(.distance_from_entry_point);
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

        const FindImportedPartsVisitor = struct {
            entry_bits: *const AutoBitSet,
            flags: []const JSMeta.Flags,
            parts: []BabyList(Part),
            import_records: []BabyList(ImportRecord),
            files: std.ArrayList(Index.Int),
            part_ranges: std.ArrayList(PartRange),
            visited: std.AutoHashMap(Index.Int, void),
            parts_prefix: std.ArrayList(PartRange),
            c: *LinkerContext,
            entry_point: Chunk.EntryPoint,
            chunk_index: u32,

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

            // Traverse the graph using this stable order and linearize the files with
            // dependencies before dependents
            pub fn visit(
                v: *@This(),
                source_index: Index.Int,
                comptime with_code_splitting: bool,
                comptime with_scb: bool,
            ) void {
                if (source_index == Index.invalid.value) return;
                const visited_entry = v.visited.getOrPut(source_index) catch unreachable;
                if (visited_entry.found_existing) return;

                var is_file_in_chunk = if (with_code_splitting and v.c.graph.ast.items(.css)[source_index] == null)
                    // when code splitting, include the file in the chunk if ALL of the entry points overlap
                    v.entry_bits.eql(&v.c.graph.files.items(.entry_bits)[source_index])
                else
                    // when NOT code splitting, include the file in the chunk if ANY of the entry points overlap
                    v.entry_bits.hasIntersection(&v.c.graph.files.items(.entry_bits)[source_index]);

                // Wrapped files can't be split because they are all inside the wrapper
                const can_be_split = v.flags[source_index].wrap == .none;

                const parts = v.parts[source_index].slice();
                if (can_be_split and is_file_in_chunk and parts[js_ast.namespace_export_part_index].is_live) {
                    appendOrExtendRange(&v.part_ranges, source_index, js_ast.namespace_export_part_index);
                }

                const records = v.import_records[source_index].slice();

                for (parts, 0..) |part, part_index_| {
                    const part_index = @as(u32, @truncate(part_index_));
                    const is_part_in_this_chunk = is_file_in_chunk and part.is_live;
                    for (part.import_record_indices.slice()) |record_id| {
                        const record: *const ImportRecord = &records[record_id];
                        if (record.source_index.isValid() and (record.kind == .stmt or is_part_in_this_chunk)) {
                            if (v.c.isExternalDynamicImport(record, source_index)) {
                                // Don't follow import() dependencies
                                continue;
                            }

                            v.visit(record.source_index.get(), with_code_splitting, with_scb);
                        }
                    }

                    // Then include this part after the files it imports
                    if (is_part_in_this_chunk) {
                        is_file_in_chunk = true;

                        if (can_be_split and
                            part_index != js_ast.namespace_export_part_index and
                            v.c.shouldIncludePart(source_index, part))
                        {
                            const js_parts = if (source_index == Index.runtime.value)
                                &v.parts_prefix
                            else
                                &v.part_ranges;

                            appendOrExtendRange(js_parts, source_index, part_index);
                        }
                    }
                }

                if (is_file_in_chunk) {
                    if (with_scb and v.c.graph.is_scb_bitset.isSet(source_index)) {
                        v.c.graph.files.items(.entry_point_chunk_index)[source_index] = v.chunk_index;
                    }

                    v.files.append(source_index) catch bun.outOfMemory();

                    // CommonJS files are all-or-nothing so all parts must be contiguous
                    if (!can_be_split) {
                        v.parts_prefix.append(
                            .{
                                .source_index = Index.init(source_index),
                                .part_index_begin = 0,
                                .part_index_end = @as(u32, @truncate(parts.len)),
                            },
                        ) catch bun.outOfMemory();
                    }
                }
            }
        };

        part_ranges_shared.clearRetainingCapacity();
        parts_prefix_shared.clearRetainingCapacity();

        var visitor = FindImportedPartsVisitor{
            .files = std.ArrayList(Index.Int).init(this.allocator),
            .part_ranges = part_ranges_shared.*,
            .parts_prefix = parts_prefix_shared.*,
            .visited = std.AutoHashMap(Index.Int, void).init(this.allocator),
            .flags = this.graph.meta.items(.flags),
            .parts = this.graph.ast.items(.parts),
            .import_records = this.graph.ast.items(.import_records),
            .entry_bits = chunk.entryBits(),
            .c = this,
            .entry_point = chunk.entry_point,
            .chunk_index = chunk_index,
        };
        defer {
            part_ranges_shared.* = visitor.part_ranges;
            parts_prefix_shared.* = visitor.parts_prefix;
            visitor.visited.deinit();
        }

        switch (this.graph.code_splitting) {
            inline else => |with_code_splitting| switch (this.graph.is_scb_bitset.bit_length > 0) {
                inline else => |with_scb| {
                    visitor.visit(Index.runtime.value, with_code_splitting, with_scb);

                    for (chunk_order_array.items) |order| {
                        visitor.visit(order.source_index, with_code_splitting, with_scb);
                    }
                },
            },
        }

        const parts_in_chunk_order = try this.allocator.alloc(PartRange, visitor.part_ranges.items.len + visitor.parts_prefix.items.len);
        bun.concat(PartRange, parts_in_chunk_order, &.{
            visitor.parts_prefix.items,
            visitor.part_ranges.items,
        });
        chunk.content.javascript.files_in_chunk_order = visitor.files.items;
        chunk.content.javascript.parts_in_chunk_in_order = parts_in_chunk_order;
    }

    // CSS files are traversed in depth-first postorder just like JavaScript. But
    // unlike JavaScript import statements, CSS "@import" rules are evaluated every
    // time instead of just the first time.
    //
    //      A
    //     / \
    //    B   C
    //     \ /
    //      D
    //
    // If A imports B and then C, B imports D, and C imports D, then the CSS
    // traversal order is D B D C A.
    //
    // However, evaluating a CSS file multiple times is sort of equivalent to
    // evaluating it once at the last location. So we basically drop all but the
    // last evaluation in the order.
    //
    // The only exception to this is "@layer". Evaluating a CSS file multiple
    // times is sort of equivalent to evaluating it once at the first location
    // as far as "@layer" is concerned. So we may in some cases keep both the
    // first and last locations and only write out the "@layer" information
    // for the first location.
    pub fn findImportedFilesInCSSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, entry_points: []const Index) BabyList(Chunk.CssImportOrder) {
        const Visitor = struct {
            allocator: std.mem.Allocator,
            temp_allocator: std.mem.Allocator,
            css_asts: []?*bun.css.BundlerStyleSheet,
            all_import_records: []const BabyList(ImportRecord),

            graph: *LinkerGraph,
            parse_graph: *Graph,

            has_external_import: bool = false,
            visited: BabyList(Index),
            order: BabyList(Chunk.CssImportOrder) = .{},

            pub fn visit(
                visitor: *@This(),
                source_index: Index,
                wrapping_conditions: *BabyList(bun.css.ImportConditions),
                wrapping_import_records: *BabyList(ImportRecord),
            ) void {
                debug(
                    "Visit file: {d}={s}",
                    .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                );
                // The CSS specification strangely does not describe what to do when there
                // is a cycle. So we are left with reverse-engineering the behavior from a
                // real browser. Here's what the WebKit code base has to say about this:
                //
                //   "Check for a cycle in our import chain. If we encounter a stylesheet
                //   in our parent chain with the same URL, then just bail."
                //
                // So that's what we do here. See "StyleRuleImport::requestStyleSheet()" in
                // WebKit for more information.
                for (visitor.visited.slice()) |visitedSourceIndex| {
                    if (visitedSourceIndex.get() == source_index.get()) {
                        debug(
                            "Skip file: {d}={s}",
                            .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                        );
                        return;
                    }
                }

                visitor.visited.push(
                    visitor.temp_allocator,
                    source_index,
                ) catch bun.outOfMemory();

                const repr: *const bun.css.BundlerStyleSheet = visitor.css_asts[source_index.get()] orelse return; // Sanity check
                const top_level_rules = &repr.rules;

                // TODO: should we even do this? @import rules have to be the first rules in the stylesheet, why even allow pre-import layers?
                // Any pre-import layers come first
                // if len(repr.AST.LayersPreImport) > 0 {
                //     order = append(order, cssImportOrder{
                //         kind:                   cssImportLayers,
                //         layers:                 repr.AST.LayersPreImport,
                //         conditions:             wrappingConditions,
                //         conditionImportRecords: wrappingImportRecords,
                //     })
                // }

                defer {
                    _ = visitor.visited.pop();
                }

                // Iterate over the top-level "@import" rules
                var import_record_idx: usize = 0;
                for (top_level_rules.v.items) |*rule| {
                    if (rule.* == .import) {
                        defer import_record_idx += 1;
                        const record = visitor.all_import_records[source_index.get()].at(import_record_idx);

                        // Follow internal dependencies
                        if (record.source_index.isValid()) {
                            // If this import has conditions, fork our state so that the entire
                            // imported stylesheet subtree is wrapped in all of the conditions
                            if (rule.import.hasConditions()) {
                                // Fork our state
                                var nested_conditions = wrapping_conditions.deepClone2(visitor.allocator);
                                var nested_import_records = wrapping_import_records.clone(visitor.allocator) catch bun.outOfMemory();

                                // Clone these import conditions and append them to the state
                                nested_conditions.push(visitor.allocator, rule.import.conditionsWithImportRecords(visitor.allocator, &nested_import_records)) catch bun.outOfMemory();
                                visitor.visit(record.source_index, &nested_conditions, wrapping_import_records);
                                continue;
                            }
                            visitor.visit(record.source_index, wrapping_conditions, wrapping_import_records);
                            continue;
                        }

                        // Record external depednencies
                        if (!record.is_internal) {
                            var all_conditions = wrapping_conditions.deepClone2(visitor.allocator);
                            var all_import_records = wrapping_import_records.clone(visitor.allocator) catch bun.outOfMemory();
                            // If this import has conditions, append it to the list of overall
                            // conditions for this external import. Note that an external import
                            // may actually have multiple sets of conditions that can't be
                            // merged. When this happens we need to generate a nested imported
                            // CSS file using a data URL.
                            if (rule.import.hasConditions()) {
                                all_conditions.push(visitor.allocator, rule.import.conditionsWithImportRecords(visitor.allocator, &all_import_records)) catch bun.outOfMemory();
                                visitor.order.push(
                                    visitor.allocator,
                                    Chunk.CssImportOrder{
                                        .kind = .{
                                            .external_path = record.path,
                                        },
                                        .conditions = all_conditions,
                                        .condition_import_records = all_import_records,
                                    },
                                ) catch bun.outOfMemory();
                            } else {
                                visitor.order.push(
                                    visitor.allocator,
                                    Chunk.CssImportOrder{
                                        .kind = .{
                                            .external_path = record.path,
                                        },
                                        .conditions = wrapping_conditions.*,
                                        .condition_import_records = wrapping_import_records.*,
                                    },
                                ) catch bun.outOfMemory();
                            }
                            debug(
                                "Push external: {d}={s}",
                                .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                            );
                            visitor.has_external_import = true;
                        }
                    }
                }

                // Iterate over the "composes" directives. Note that the order doesn't
                // matter for these because the output order is explicitly undfened
                // in the specification.
                for (visitor.all_import_records[source_index.get()].sliceConst()) |*record| {
                    if (record.kind == .composes and record.source_index.isValid()) {
                        visitor.visit(record.source_index, wrapping_conditions, wrapping_import_records);
                    }
                }

                if (comptime bun.Environment.isDebug) {
                    debug(
                        "Push file: {d}={s}",
                        .{ source_index.get(), visitor.parse_graph.input_files.items(.source)[source_index.get()].path.pretty },
                    );
                }
                // Accumulate imports in depth-first postorder
                visitor.order.push(visitor.allocator, Chunk.CssImportOrder{
                    .kind = .{ .source_index = source_index },
                    .conditions = wrapping_conditions.*,
                }) catch bun.outOfMemory();
            }
        };

        var visitor = Visitor{
            .allocator = this.allocator,
            .temp_allocator = temp_allocator,
            .graph = &this.graph,
            .parse_graph = this.parse_graph,
            .visited = BabyList(Index).initCapacity(temp_allocator, 16) catch bun.outOfMemory(),
            .css_asts = this.graph.ast.items(.css),
            .all_import_records = this.graph.ast.items(.import_records),
        };
        var wrapping_conditions: BabyList(bun.css.ImportConditions) = .{};
        var wrapping_import_records: BabyList(ImportRecord) = .{};
        // Include all files reachable from any entry point
        for (entry_points) |entry_point| {
            visitor.visit(entry_point, &wrapping_conditions, &wrapping_import_records);
        }

        var order = visitor.order;
        var wip_order = BabyList(Chunk.CssImportOrder).initCapacity(temp_allocator, order.len) catch bun.outOfMemory();

        const css_asts: []const ?*bun.css.BundlerStyleSheet = this.graph.ast.items(.css);

        debugCssOrder(this, &order, .BEFORE_HOISTING);

        // CSS syntax unfortunately only allows "@import" rules at the top of the
        // file. This means we must hoist all external "@import" rules to the top of
        // the file when bundling, even though doing so will change the order of CSS
        // evaluation.
        if (visitor.has_external_import) {
            // Pass 1: Pull out leading "@layer" and external "@import" rules
            var is_at_layer_prefix = true;
            for (order.slice()) |*entry| {
                if ((entry.kind == .layers and is_at_layer_prefix) or entry.kind == .external_path) {
                    wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
                }
                if (entry.kind != .layers) {
                    is_at_layer_prefix = false;
                }
            }

            // Pass 2: Append everything that we didn't pull out in pass 1
            is_at_layer_prefix = true;
            for (order.slice()) |*entry| {
                if ((entry.kind != .layers or !is_at_layer_prefix) and entry.kind != .external_path) {
                    wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
                }
                if (entry.kind != .layers) {
                    is_at_layer_prefix = false;
                }
            }

            order.len = wip_order.len;
            @memcpy(order.slice(), wip_order.slice());
            wip_order.clearRetainingCapacity();
        }
        debugCssOrder(this, &order, .AFTER_HOISTING);

        // Next, optimize import order. If there are duplicate copies of an imported
        // file, replace all but the last copy with just the layers that are in that
        // file. This works because in CSS, the last instance of a declaration
        // overrides all previous instances of that declaration.
        {
            var source_index_duplicates = std.AutoArrayHashMap(u32, BabyList(u32)).init(temp_allocator);
            var external_path_duplicates = std.StringArrayHashMap(BabyList(u32)).init(temp_allocator);

            var i: u32 = visitor.order.len;
            next_backward: while (i != 0) {
                i -= 1;
                const entry = visitor.order.at(i);
                switch (entry.kind) {
                    .source_index => |idx| {
                        const gop = source_index_duplicates.getOrPut(idx.get()) catch bun.outOfMemory();
                        if (!gop.found_existing) {
                            gop.value_ptr.* = BabyList(u32){};
                        }
                        for (gop.value_ptr.slice()) |j| {
                            if (isConditionalImportRedundant(&entry.conditions, &order.at(j).conditions)) {
                                // This import is redundant, but it might have @layer rules.
                                // So we should keep the @layer rules so that the cascade ordering of layers
                                // is preserved
                                order.mut(i).kind = .{
                                    .layers = Chunk.CssImportOrder.Layers.borrow(&css_asts[idx.get()].?.layer_names),
                                };
                                continue :next_backward;
                            }
                        }
                        gop.value_ptr.push(temp_allocator, i) catch bun.outOfMemory();
                    },
                    .external_path => |p| {
                        const gop = external_path_duplicates.getOrPut(p.text) catch bun.outOfMemory();
                        if (!gop.found_existing) {
                            gop.value_ptr.* = BabyList(u32){};
                        }
                        for (gop.value_ptr.slice()) |j| {
                            if (isConditionalImportRedundant(&entry.conditions, &order.at(j).conditions)) {
                                // Don't remove duplicates entirely. The import conditions may
                                // still introduce layers to the layer order. Represent this as a
                                // file with an empty layer list.
                                order.mut(i).kind = .{
                                    .layers = .{ .owned = .{} },
                                };
                                continue :next_backward;
                            }
                        }
                        gop.value_ptr.push(temp_allocator, i) catch bun.outOfMemory();
                    },
                    .layers => {},
                }
            }
        }
        debugCssOrder(this, &order, .AFTER_REMOVING_DUPLICATES);

        // Then optimize "@layer" rules by removing redundant ones. This loop goes
        // forward instead of backward because "@layer" takes effect at the first
        // copy instead of the last copy like other things in CSS.
        {
            const DuplicateEntry = struct {
                layers: []const bun.css.LayerName,
                indices: bun.BabyList(u32) = .{},
            };
            var layer_duplicates = bun.BabyList(DuplicateEntry){};

            next_forward: for (order.slice()) |*entry| {
                debugCssOrder(this, &wip_order, .WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES);
                switch (entry.kind) {
                    // Simplify the conditions since we know they only wrap "@layer"
                    .layers => |*layers| {
                        // Truncate the conditions at the first anonymous layer
                        for (entry.conditions.slice(), 0..) |*condition_, i| {
                            const conditions: *bun.css.ImportConditions = condition_;
                            // The layer is anonymous if it's a "layer" token without any
                            // children instead of a "layer(...)" token with children:
                            //
                            //   /* entry.css */
                            //   @import "foo.css" layer;
                            //
                            //   /* foo.css */
                            //   @layer foo;
                            //
                            // We don't need to generate this (as far as I can tell):
                            //
                            //   @layer {
                            //     @layer foo;
                            //   }
                            //
                            if (conditions.hasAnonymousLayer()) {
                                entry.conditions.len = @intCast(i);
                                layers.replace(temp_allocator, .{});
                                break;
                            }
                        }

                        // If there are no layer names for this file, trim all conditions
                        // without layers because we know they have no effect.
                        //
                        // (They have no effect because this is a `.layer` import with no rules
                        //  and only layer declarations.)
                        //
                        //   /* entry.css */
                        //   @import "foo.css" layer(foo) supports(display: flex);
                        //
                        //   /* foo.css */
                        //   @import "empty.css" supports(display: grid);
                        //
                        // That would result in this:
                        //
                        //   @supports (display: flex) {
                        //     @layer foo {
                        //       @supports (display: grid) {}
                        //     }
                        //   }
                        //
                        // Here we can trim "supports(display: grid)" to generate this:
                        //
                        //   @supports (display: flex) {
                        //     @layer foo;
                        //   }
                        //
                        if (layers.inner().len == 0) {
                            var i: u32 = entry.conditions.len;
                            while (i != 0) {
                                i -= 1;
                                const condition = entry.conditions.at(i);
                                if (condition.layer != null) {
                                    break;
                                }
                                entry.conditions.len = i;
                            }
                        }

                        // Remove unnecessary entries entirely
                        if (entry.conditions.len == 0 and layers.inner().len == 0) {
                            continue;
                        }
                    },
                    else => {},
                }

                // Omit redundant "@layer" rules with the same set of layer names. Note
                // that this tests all import order entries (not just layer ones) because
                // sometimes non-layer ones can make following layer ones redundant.
                // layers_post_import
                const layers_key: []const bun.css.LayerName = switch (entry.kind) {
                    .source_index => css_asts[entry.kind.source_index.get()].?.layer_names.sliceConst(),
                    .layers => entry.kind.layers.inner().sliceConst(),
                    .external_path => &.{},
                };
                var index: usize = 0;
                while (index < layer_duplicates.len) : (index += 1) {
                    const both_equal = both_equal: {
                        if (layers_key.len != layer_duplicates.at(index).layers.len) {
                            break :both_equal false;
                        }

                        for (layers_key, layer_duplicates.at(index).layers) |*a, *b| {
                            if (!a.eql(b)) {
                                break :both_equal false;
                            }
                        }

                        break :both_equal true;
                    };

                    if (both_equal) {
                        break;
                    }
                }
                if (index == layer_duplicates.len) {
                    // This is the first time we've seen this combination of layer names.
                    // Allocate a new set of duplicate indices to track this combination.
                    layer_duplicates.push(temp_allocator, DuplicateEntry{
                        .layers = layers_key,
                    }) catch bun.outOfMemory();
                }
                var duplicates = layer_duplicates.at(index).indices.slice();
                var j = duplicates.len;
                while (j != 0) {
                    j -= 1;
                    const duplicate_index = duplicates[j];
                    if (isConditionalImportRedundant(&entry.conditions, &wip_order.at(duplicate_index).conditions)) {
                        if (entry.kind != .layers) {
                            // If an empty layer is followed immediately by a full layer and
                            // everything else is identical, then we don't need to emit the
                            // empty layer. For example:
                            //
                            //   @media screen {
                            //     @supports (display: grid) {
                            //       @layer foo;
                            //     }
                            //   }
                            //   @media screen {
                            //     @supports (display: grid) {
                            //       @layer foo {
                            //         div {
                            //           color: red;
                            //         }
                            //       }
                            //     }
                            //   }
                            //
                            // This can be improved by dropping the empty layer. But we can
                            // only do this if there's nothing in between these two rules.
                            if (j == duplicates.len - 1 and duplicate_index == wip_order.len - 1) {
                                const other = wip_order.at(duplicate_index);
                                if (other.kind == .layers and importConditionsAreEqual(entry.conditions.sliceConst(), other.conditions.sliceConst())) {
                                    // Remove the previous entry and then overwrite it below
                                    duplicates = duplicates[0..j];
                                    wip_order.len = duplicate_index;
                                    break;
                                }
                            }

                            // Non-layer entries still need to be present because they have
                            // other side effects beside inserting things in the layer order
                            wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
                        }

                        // Don't add this to the duplicate list below because it's redundant
                        continue :next_forward;
                    }
                }

                layer_duplicates.mut(index).indices.push(
                    temp_allocator,
                    wip_order.len,
                ) catch bun.outOfMemory();
                wip_order.push(temp_allocator, entry.*) catch bun.outOfMemory();
            }

            debugCssOrder(this, &wip_order, .WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES);

            order.len = wip_order.len;
            @memcpy(order.slice(), wip_order.slice());
            wip_order.clearRetainingCapacity();
        }
        debugCssOrder(this, &order, .AFTER_OPTIMIZING_REDUNDANT_LAYER_RULES);

        // Finally, merge adjacent "@layer" rules with identical conditions together.
        {
            var did_clone: i32 = -1;
            for (order.slice()) |*entry| {
                if (entry.kind == .layers and wip_order.len > 0) {
                    const prev_index = wip_order.len - 1;
                    const prev = wip_order.at(prev_index);
                    if (prev.kind == .layers and importConditionsAreEqual(prev.conditions.sliceConst(), entry.conditions.sliceConst())) {
                        if (did_clone != prev_index) {
                            did_clone = @intCast(prev_index);
                        }
                        // need to clone the layers here as they could be references to css ast
                        wip_order.mut(prev_index).kind.layers.toOwned(temp_allocator).append(
                            temp_allocator,
                            entry.kind.layers.inner().sliceConst(),
                        ) catch bun.outOfMemory();
                    }
                }
            }
        }
        debugCssOrder(this, &order, .AFTER_MERGING_ADJACENT_LAYER_RULES);

        return order;
    }

    const CssOrderDebugStep = enum {
        BEFORE_HOISTING,
        AFTER_HOISTING,
        AFTER_REMOVING_DUPLICATES,
        WHILE_OPTIMIZING_REDUNDANT_LAYER_RULES,
        AFTER_OPTIMIZING_REDUNDANT_LAYER_RULES,
        AFTER_MERGING_ADJACENT_LAYER_RULES,
    };

    fn debugCssOrder(this: *LinkerContext, order: *const BabyList(Chunk.CssImportOrder), comptime step: CssOrderDebugStep) void {
        if (comptime bun.Environment.isDebug) {
            const env_var = "BUN_DEBUG_CSS_ORDER_" ++ @tagName(step);
            const enable_all = bun.getenvTruthy("BUN_DEBUG_CSS_ORDER");
            if (enable_all or bun.getenvTruthy(env_var)) {
                debugCssOrderImpl(this, order, step);
            }
        }
    }

    fn debugCssOrderImpl(this: *LinkerContext, order: *const BabyList(Chunk.CssImportOrder), comptime step: CssOrderDebugStep) void {
        if (comptime bun.Environment.isDebug) {
            debug("CSS order {s}:\n", .{@tagName(step)});
            var arena = bun.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            for (order.slice(), 0..) |entry, i| {
                const conditions_str = if (entry.conditions.len > 0) conditions_str: {
                    var arrlist = std.ArrayListUnmanaged(u8){};
                    const writer = arrlist.writer(arena.allocator());
                    const W = @TypeOf(writer);
                    arrlist.appendSlice(arena.allocator(), "[") catch unreachable;
                    var symbols = Symbol.Map{};
                    for (entry.conditions.sliceConst(), 0..) |*condition_, j| {
                        const condition: *const bun.css.ImportConditions = condition_;
                        const scratchbuf = std.ArrayList(u8).init(arena.allocator());
                        var printer = bun.css.Printer(W).new(
                            arena.allocator(),
                            scratchbuf,
                            writer,
                            bun.css.PrinterOptions.default(),
                            .{
                                .import_records = &entry.condition_import_records,
                                .ast_urls_for_css = this.parse_graph.ast.items(.url_for_css),
                                .ast_unique_key_for_additional_file = this.parse_graph.input_files.items(.unique_key_for_additional_file),
                            },
                            &this.mangled_props,
                            &symbols,
                        );

                        condition.toCss(W, &printer) catch unreachable;
                        if (j != entry.conditions.len - 1) {
                            arrlist.appendSlice(arena.allocator(), ", ") catch unreachable;
                        }
                    }
                    arrlist.appendSlice(arena.allocator(), " ]") catch unreachable;
                    break :conditions_str arrlist.items;
                } else "[]";

                debug("  {d}: {} {s}\n", .{ i, entry.fmt(this), conditions_str });
            }
        }
    }

    fn importConditionsAreEqual(a: []const bun.css.ImportConditions, b: []const bun.css.ImportConditions) bool {
        if (a.len != b.len) {
            return false;
        }

        for (a, b) |*ai, *bi| {
            if (!ai.layersEql(bi) or !ai.supportsEql(bi) or !ai.media.eql(&bi.media)) return false;
        }

        return true;
    }

    /// Given two "@import" rules for the same source index (an earlier one and a
    /// later one), the earlier one is masked by the later one if the later one's
    /// condition list is a prefix of the earlier one's condition list.
    ///
    /// For example:
    ///
    ///    // entry.css
    ///    @import "foo.css" supports(display: flex);
    ///    @import "bar.css" supports(display: flex);
    ///
    ///    // foo.css
    ///    @import "lib.css" screen;
    ///
    ///    // bar.css
    ///    @import "lib.css";
    ///
    /// When we bundle this code we'll get an import order as follows:
    ///
    ///  1. lib.css [supports(display: flex), screen]
    ///  2. foo.css [supports(display: flex)]
    ///  3. lib.css [supports(display: flex)]
    ///  4. bar.css [supports(display: flex)]
    ///  5. entry.css []
    ///
    /// For "lib.css", the entry with the conditions [supports(display: flex)] should
    /// make the entry with the conditions [supports(display: flex), screen] redundant.
    ///
    /// Note that all of this deliberately ignores the existence of "@layer" because
    /// that is handled separately. All of this is only for handling unlayered styles.
    pub fn isConditionalImportRedundant(earlier: *const BabyList(bun.css.ImportConditions), later: *const BabyList(bun.css.ImportConditions)) bool {
        if (later.len > earlier.len) return false;

        for (0..later.len) |i| {
            const a = earlier.at(i);
            const b = later.at(i);

            // Only compare "@supports" and "@media" if "@layers" is equal
            if (a.layersEql(b)) {
                const same_supports = a.supportsEql(b);
                const same_media = a.media.eql(&b.media);

                // If the import conditions are exactly equal, then only keep
                // the later one. The earlier one is redundant. Example:
                //
                //   @import "foo.css" layer(abc) supports(display: flex) screen;
                //   @import "foo.css" layer(abc) supports(display: flex) screen;
                //
                // The later one makes the earlier one redundant.
                if (same_supports and same_media) {
                    continue;
                }

                // If the media conditions are exactly equal and the later one
                // doesn't have any supports conditions, then the later one will
                // apply in all cases where the earlier one applies. Example:
                //
                //   @import "foo.css" layer(abc) supports(display: flex) screen;
                //   @import "foo.css" layer(abc) screen;
                //
                // The later one makes the earlier one redundant.
                if (same_media and b.supports == null) {
                    continue;
                }

                // If the supports conditions are exactly equal and the later one
                // doesn't have any media conditions, then the later one will
                // apply in all cases where the earlier one applies. Example:
                //
                //   @import "foo.css" layer(abc) supports(display: flex) screen;
                //   @import "foo.css" layer(abc) supports(display: flex);
                //
                // The later one makes the earlier one redundant.
                if (same_supports and b.media.media_queries.items.len == 0) {
                    continue;
                }
            }

            return false;
        }

        return true;
    }

    // JavaScript modules are traversed in depth-first postorder. This is the
    // order that JavaScript modules were evaluated in before the top-level await
    // feature was introduced.
    //
    //      A
    //     / \
    //    B   C
    //     \ /
    //      D
    //
    // If A imports B and then C, B imports D, and C imports D, then the JavaScript
    // traversal order is D B C A.
    //
    // This function may deviate from ESM import order for dynamic imports (both
    // "require()" and "import()"). This is because the import order is impossible
    // to determine since the imports happen at run-time instead of compile-time.
    // In this case we just pick an arbitrary but consistent order.
    pub fn findImportedCSSFilesInJSOrder(this: *LinkerContext, temp_allocator: std.mem.Allocator, entry_point: Index) BabyList(Index) {
        var visited = BitSet.initEmpty(temp_allocator, this.graph.files.len) catch bun.outOfMemory();
        var order: BabyList(Index) = .{};

        const all_import_records = this.graph.ast.items(.import_records);
        const all_loaders = this.parse_graph.input_files.items(.loader);
        const all_parts = this.graph.ast.items(.parts);

        const visit = struct {
            fn visit(
                c: *LinkerContext,
                import_records: []const BabyList(ImportRecord),
                parts: []const Part.List,
                loaders: []const Loader,
                temp: std.mem.Allocator,
                visits: *BitSet,
                o: *BabyList(Index),
                source_index: Index,
                is_css: bool,
            ) void {
                if (visits.isSet(source_index.get())) return;
                visits.set(source_index.get());

                const records: []ImportRecord = import_records[source_index.get()].slice();
                const p = &parts[source_index.get()];

                // Iterate over each part in the file in order
                for (p.sliceConst()) |part| {
                    // Traverse any files imported by this part. Note that CommonJS calls
                    // to "require()" count as imports too, sort of as if the part has an
                    // ESM "import" statement in it. This may seem weird because ESM imports
                    // are a compile-time concept while CommonJS imports are a run-time
                    // concept. But we don't want to manipulate <style> tags at run-time so
                    // this is the only way to do it.
                    for (part.import_record_indices.sliceConst()) |import_record_index| {
                        const record = &records[import_record_index];
                        if (record.source_index.isValid()) {
                            visit(
                                c,
                                import_records,
                                parts,
                                loaders,
                                temp,
                                visits,
                                o,
                                record.source_index,
                                loaders[record.source_index.get()].isCSS(),
                            );
                        }
                    }
                }

                if (is_css and source_index.isValid()) {
                    o.push(temp, source_index) catch bun.outOfMemory();
                }
            }
        }.visit;

        // Include all files reachable from the entry point
        visit(
            this,
            all_import_records,
            all_parts,
            all_loaders,
            temp_allocator,
            &visited,
            &order,
            entry_point,
            false,
        );

        return order;
    }

    pub fn generateNamedExportInFile(this: *LinkerContext, source_index: Index.Int, module_ref: Ref, name: []const u8, alias: []const u8) !struct { Ref, u32 } {
        const ref = this.graph.generateNewSymbol(source_index, .other, name);
        const part_index = this.graph.addPartToFile(source_index, .{
            .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(
                this.allocator,
                &[_]js_ast.DeclaredSymbol{
                    .{ .ref = ref, .is_top_level = true },
                },
            ) catch unreachable,
            .can_be_removed_if_unused = true,
        }) catch unreachable;

        try this.graph.generateSymbolImportAndUse(source_index, part_index, module_ref, 1, Index.init(source_index));
        var top_level = &this.graph.meta.items(.top_level_symbol_to_parts_overlay)[source_index];
        var parts_list = this.allocator.alloc(u32, 1) catch unreachable;
        parts_list[0] = part_index;

        top_level.put(this.allocator, ref, BabyList(u32).init(parts_list)) catch unreachable;

        var resolved_exports = &this.graph.meta.items(.resolved_exports)[source_index];
        resolved_exports.put(this.allocator, alias, ExportData{
            .data = ImportTracker{
                .source_index = Index.init(source_index),
                .import_ref = ref,
            },
        }) catch unreachable;
        return .{ ref, part_index };
    }

    fn generateCodeForLazyExport(this: *LinkerContext, source_index: Index.Int) !void {
        const exports_kind = this.graph.ast.items(.exports_kind)[source_index];
        const all_sources = this.parse_graph.input_files.items(.source);
        const all_css_asts = this.graph.ast.items(.css);
        const maybe_css_ast: ?*bun.css.BundlerStyleSheet = all_css_asts[source_index];
        var parts = &this.graph.ast.items(.parts)[source_index];

        if (parts.len < 1) {
            @panic("Internal error: expected at least one part for lazy export");
        }

        var part: *Part = &parts.ptr[1];

        if (part.stmts.len == 0) {
            @panic("Internal error: expected at least one statement in the lazy export");
        }

        const module_ref = this.graph.ast.items(.module_ref)[source_index];

        // Handle css modules
        //
        // --- original comment from esbuild ---
        // If this JavaScript file is a stub from a CSS file, populate the exports of
        // this JavaScript stub with the local names from that CSS file. This is done
        // now instead of earlier because we need the whole bundle to be present.
        if (maybe_css_ast) |css_ast| {
            const stmt: Stmt = part.stmts[0];
            if (stmt.data != .s_lazy_export) {
                @panic("Internal error: expected top-level lazy export statement");
            }
            if (css_ast.local_scope.count() > 0) out: {
                var exports = E.Object{};

                const symbols: *const Symbol.List = &this.graph.ast.items(.symbols)[source_index];
                const all_import_records: []const BabyList(bun.css.ImportRecord) = this.graph.ast.items(.import_records);

                const values = css_ast.local_scope.values();
                if (values.len == 0) break :out;
                const size = size: {
                    var size: u32 = 0;
                    for (values) |entry| {
                        size = @max(size, entry.ref.inner_index);
                    }
                    break :size size + 1;
                };

                var inner_visited = try BitSet.initEmpty(this.allocator, size);
                defer inner_visited.deinit(this.allocator);
                var composes_visited = std.AutoArrayHashMap(bun.bundle_v2.Ref, void).init(this.allocator);
                defer composes_visited.deinit();

                const Visitor = struct {
                    inner_visited: *BitSet,
                    composes_visited: *std.AutoArrayHashMap(bun.bundle_v2.Ref, void),
                    parts: *std.ArrayList(E.TemplatePart),
                    all_import_records: []const BabyList(bun.css.ImportRecord),
                    all_css_asts: []?*bun.css.BundlerStyleSheet,
                    all_sources: []const Logger.Source,
                    all_symbols: []const Symbol.List,
                    source_index: Index.Int,
                    log: *Logger.Log,
                    loc: Loc,
                    allocator: std.mem.Allocator,

                    fn clearAll(visitor: *@This()) void {
                        visitor.inner_visited.setAll(false);
                        visitor.composes_visited.clearRetainingCapacity();
                    }

                    fn visitName(visitor: *@This(), ast: *bun.css.BundlerStyleSheet, ref: bun.css.CssRef, idx: Index.Int) void {
                        bun.assert(ref.canBeComposed());
                        const from_this_file = ref.sourceIndex(idx) == visitor.source_index;
                        if ((from_this_file and visitor.inner_visited.isSet(ref.innerIndex())) or
                            (!from_this_file and visitor.composes_visited.contains(ref.toRealRef(idx))))
                        {
                            return;
                        }

                        visitor.visitComposes(ast, ref, idx);
                        visitor.parts.append(E.TemplatePart{
                            .value = Expr.init(
                                E.NameOfSymbol,
                                E.NameOfSymbol{
                                    .ref = ref.toRealRef(idx),
                                },
                                visitor.loc,
                            ),
                            .tail = .{
                                .cooked = E.String.init(" "),
                            },
                            .tail_loc = visitor.loc,
                        }) catch bun.outOfMemory();

                        if (from_this_file) {
                            visitor.inner_visited.set(ref.innerIndex());
                        } else {
                            visitor.composes_visited.put(ref.toRealRef(idx), {}) catch unreachable;
                        }
                    }

                    fn warnNonSingleClassComposes(visitor: *@This(), ast: *bun.css.BundlerStyleSheet, css_ref: bun.css.CssRef, idx: Index.Int, compose_loc: Loc) void {
                        const ref = css_ref.toRealRef(idx);
                        _ = ref;
                        const syms: *const Symbol.List = &visitor.all_symbols[css_ref.sourceIndex(idx)];
                        const name = syms.at(css_ref.innerIndex()).original_name;
                        const loc = ast.local_scope.get(name).?.loc;

                        visitor.log.addRangeErrorFmtWithNote(
                            &visitor.all_sources[idx],
                            .{ .loc = compose_loc },
                            visitor.allocator,
                            "The composes property cannot be used with {}, because it is not a single class name.",
                            .{
                                bun.fmt.quote(name),
                            },
                            "The definition of {} is here.",
                            .{
                                bun.fmt.quote(name),
                            },

                            .{
                                .loc = loc,
                            },
                        ) catch bun.outOfMemory();
                    }

                    fn visitComposes(visitor: *@This(), ast: *bun.css.BundlerStyleSheet, css_ref: bun.css.CssRef, idx: Index.Int) void {
                        const ref = css_ref.toRealRef(idx);
                        if (ast.composes.count() > 0) {
                            const composes = ast.composes.getPtr(ref) orelse return;
                            // while parsing we check that we only allow `composes` on single class selectors
                            bun.assert(css_ref.tag.class);

                            for (composes.composes.slice()) |*compose| {
                                // it is imported
                                if (compose.from != null) {
                                    if (compose.from.? == .import_record_index) {
                                        const import_record_idx = compose.from.?.import_record_index;
                                        const import_records: *const BabyList(bun.css.ImportRecord) = &visitor.all_import_records[idx];
                                        const import_record = import_records.at(import_record_idx);
                                        if (import_record.source_index.isValid()) {
                                            const other_file = visitor.all_css_asts[import_record.source_index.get()] orelse {
                                                visitor.log.addErrorFmt(
                                                    &visitor.all_sources[idx],
                                                    compose.loc,
                                                    visitor.allocator,
                                                    "Cannot use the \"composes\" property with the {} file (it is not a CSS file)",
                                                    .{bun.fmt.quote(visitor.all_sources[import_record.source_index.get()].path.pretty)},
                                                ) catch bun.outOfMemory();
                                                continue;
                                            };
                                            for (compose.names.slice()) |name| {
                                                const other_name_entry = other_file.local_scope.get(name.v) orelse continue;
                                                const other_name_ref = other_name_entry.ref;
                                                if (!other_name_ref.canBeComposed()) {
                                                    visitor.warnNonSingleClassComposes(other_file, other_name_ref, import_record.source_index.get(), compose.loc);
                                                } else {
                                                    visitor.visitName(other_file, other_name_ref, import_record.source_index.get());
                                                }
                                            }
                                        }
                                    } else if (compose.from.? == .global) {
                                        // E.g.: `composes: foo from global`
                                        //
                                        // In this example `foo` is global and won't be rewritten to a locally scoped
                                        // name, so we can just add it as a string.
                                        for (compose.names.slice()) |name| {
                                            visitor.parts.append(
                                                E.TemplatePart{
                                                    .value = Expr.init(
                                                        E.String,
                                                        E.String.init(name.v),
                                                        visitor.loc,
                                                    ),
                                                    .tail = .{
                                                        .cooked = E.String.init(" "),
                                                    },
                                                    .tail_loc = visitor.loc,
                                                },
                                            ) catch bun.outOfMemory();
                                        }
                                    }
                                } else {
                                    // it is from the current file
                                    for (compose.names.slice()) |name| {
                                        const name_entry = ast.local_scope.get(name.v) orelse {
                                            visitor.log.addErrorFmt(
                                                &visitor.all_sources[idx],
                                                compose.loc,
                                                visitor.allocator,
                                                "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                                .{
                                                    bun.fmt.quote(name.v),
                                                    bun.fmt.quote(visitor.all_sources[idx].path.pretty),
                                                },
                                            ) catch bun.outOfMemory();
                                            continue;
                                        };
                                        const name_ref = name_entry.ref;
                                        if (!name_ref.canBeComposed()) {
                                            visitor.warnNonSingleClassComposes(ast, name_ref, idx, compose.loc);
                                        } else {
                                            visitor.visitName(ast, name_ref, idx);
                                        }
                                    }
                                }
                            }
                        }
                    }
                };

                var visitor = Visitor{
                    .inner_visited = &inner_visited,
                    .composes_visited = &composes_visited,
                    .source_index = source_index,
                    .parts = undefined,
                    .all_import_records = all_import_records,
                    .all_css_asts = all_css_asts,
                    .loc = stmt.loc,
                    .log = this.log,
                    .all_sources = all_sources,
                    .allocator = this.allocator,
                    .all_symbols = this.graph.ast.items(.symbols),
                };

                for (values) |entry| {
                    const ref = entry.ref;
                    bun.assert(ref.inner_index < symbols.len);

                    var template_parts = std.ArrayList(E.TemplatePart).init(this.allocator);
                    var value = Expr.init(E.NameOfSymbol, E.NameOfSymbol{ .ref = ref.toRealRef(source_index) }, stmt.loc);

                    visitor.parts = &template_parts;
                    visitor.clearAll();
                    visitor.inner_visited.set(ref.innerIndex());
                    if (ref.tag.class) visitor.visitComposes(css_ast, ref, source_index);

                    if (template_parts.items.len > 0) {
                        template_parts.append(E.TemplatePart{
                            .value = value,
                            .tail_loc = stmt.loc,
                            .tail = .{ .cooked = E.String.init("") },
                        }) catch bun.outOfMemory();
                        value = Expr.init(
                            E.Template,
                            E.Template{
                                .parts = template_parts.items,
                                .head = .{
                                    .cooked = E.String.init(""),
                                },
                            },
                            stmt.loc,
                        );
                    }

                    const key = symbols.at(ref.innerIndex()).original_name;
                    try exports.put(this.allocator, key, value);
                }

                part.stmts[0].data.s_lazy_export.* = Expr.init(E.Object, exports, stmt.loc).data;
            }
        }

        const stmt: Stmt = part.stmts[0];
        if (stmt.data != .s_lazy_export) {
            @panic("Internal error: expected top-level lazy export statement");
        }

        const expr = Expr{
            .data = stmt.data.s_lazy_export.*,
            .loc = stmt.loc,
        };

        switch (exports_kind) {
            .cjs => {
                part.stmts[0] = Stmt.assign(
                    Expr.init(
                        E.Dot,
                        E.Dot{
                            .target = Expr.initIdentifier(module_ref, stmt.loc),
                            .name = "exports",
                            .name_loc = stmt.loc,
                        },
                        stmt.loc,
                    ),
                    expr,
                );
                try this.graph.generateSymbolImportAndUse(source_index, 0, module_ref, 1, Index.init(source_index));

                // If this is a .napi addon and it's not node, we need to generate a require() call to the runtime
                if (expr.data == .e_call and
                    expr.data.e_call.target.data == .e_require_call_target and
                    // if it's commonjs, use require()
                    this.options.output_format != .cjs)
                {
                    try this.graph.generateRuntimeSymbolImportAndUse(
                        source_index,
                        Index.part(1),
                        "__require",
                        1,
                    );
                }
            },
            else => {
                // Otherwise, generate ES6 export statements. These are added as additional
                // parts so they can be tree shaken individually.
                part.stmts.len = 0;

                if (expr.data == .e_object) {
                    for (expr.data.e_object.properties.slice()) |property_| {
                        const property: G.Property = property_;
                        if (property.key == null or property.key.?.data != .e_string or property.value == null or
                            property.key.?.data.e_string.eqlComptime("default") or property.key.?.data.e_string.eqlComptime("__esModule"))
                        {
                            continue;
                        }

                        const name = property.key.?.data.e_string.slice(this.allocator);

                        // TODO: support non-identifier names
                        if (!bun.js_lexer.isIdentifier(name))
                            continue;

                        // This initializes the generated variable with a copy of the property
                        // value, which is INCORRECT for values that are objects/arrays because
                        // they will have separate object identity. This is fixed up later in
                        // "generateCodeForFileInChunkJS" by changing the object literal to
                        // reference this generated variable instead.
                        //
                        // Changing the object literal is deferred until that point instead of
                        // doing it now because we only want to do this for top-level variables
                        // that actually end up being used, and we don't know which ones will
                        // end up actually being used at this point (since import binding hasn't
                        // happened yet). So we need to wait until after tree shaking happens.
                        const generated = try this.generateNamedExportInFile(source_index, module_ref, name, name);
                        parts.ptr[generated[1]].stmts = this.allocator.alloc(Stmt, 1) catch unreachable;
                        parts.ptr[generated[1]].stmts[0] = Stmt.alloc(
                            S.Local,
                            S.Local{
                                .is_export = true,
                                .decls = js_ast.G.Decl.List.fromSlice(
                                    this.allocator,
                                    &.{
                                        .{
                                            .binding = Binding.alloc(
                                                this.allocator,
                                                B.Identifier{
                                                    .ref = generated[0],
                                                },
                                                expr.loc,
                                            ),
                                            .value = property.value.?,
                                        },
                                    },
                                ) catch unreachable,
                            },
                            property.key.?.loc,
                        );
                    }
                }

                {
                    const generated = try this.generateNamedExportInFile(
                        source_index,
                        module_ref,
                        std.fmt.allocPrint(
                            this.allocator,
                            "{}_default",
                            .{this.parse_graph.input_files.items(.source)[source_index].fmtIdentifier()},
                        ) catch unreachable,
                        "default",
                    );
                    parts.ptr[generated[1]].stmts = this.allocator.alloc(Stmt, 1) catch unreachable;
                    parts.ptr[generated[1]].stmts[0] = Stmt.alloc(
                        S.ExportDefault,
                        S.ExportDefault{
                            .default_name = .{
                                .ref = generated[0],
                                .loc = stmt.loc,
                            },
                            .value = .{
                                .expr = expr,
                            },
                        },
                        stmt.loc,
                    );
                }
            },
        }
    }

    pub fn scanImportsAndExports(this: *LinkerContext) !void {
        const outer_trace = bun.perf.trace("Bundler.scanImportsAndExports");
        defer outer_trace.end();
        const reachable = this.graph.reachable_files;
        const output_format = this.options.output_format;
        {
            var import_records_list: []ImportRecord.List = this.graph.ast.items(.import_records);

            // var parts_list: [][]Part = this.graph.ast.items(.parts);
            var exports_kind: []js_ast.ExportsKind = this.graph.ast.items(.exports_kind);
            var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
            var named_imports: []js_ast.Ast.NamedImports = this.graph.ast.items(.named_imports);
            var flags: []JSMeta.Flags = this.graph.meta.items(.flags);

            const tla_keywords = this.parse_graph.ast.items(.top_level_await_keyword);
            const tla_checks = this.parse_graph.ast.items(.tla_check);
            const input_files = this.parse_graph.input_files.items(.source);
            const loaders: []const Loader = this.parse_graph.input_files.items(.loader);

            const export_star_import_records: [][]u32 = this.graph.ast.items(.export_star_import_records);
            const exports_refs: []Ref = this.graph.ast.items(.exports_ref);
            const module_refs: []Ref = this.graph.ast.items(.module_ref);
            const ast_flags_list = this.graph.ast.items(.flags);

            const css_asts: []?*bun.css.BundlerStyleSheet = this.graph.ast.items(.css);

            var symbols = &this.graph.symbols;
            defer this.graph.symbols = symbols.*;

            // Step 1: Figure out what modules must be CommonJS
            for (reachable) |source_index_| {
                const trace = bun.perf.trace("Bundler.FigureOutCommonJS");
                defer trace.end();
                const id = source_index_.get();

                // does it have a JS AST?
                if (!(id < import_records_list.len)) continue;

                const import_records: []ImportRecord = import_records_list[id].slice();

                // Is it CSS?
                if (css_asts[id] != null) {
                    const css_ast = css_asts[id].?;
                    // Inline URLs for non-CSS files into the CSS file
                    _ = this.scanCSSImports(
                        id,
                        import_records,
                        css_asts,
                        input_files,
                        loaders,
                        this.log,
                    );

                    // Validate cross-file "composes: ... from" named imports
                    for (css_ast.composes.values()) |*composes| {
                        for (composes.composes.slice()) |*compose| {
                            if (compose.from == null or compose.from.? != .import_record_index) continue;
                            const import_record_idx = compose.from.?.import_record_index;
                            const record = &import_records[import_record_idx];
                            if (!record.source_index.isValid()) continue;
                            const other_css_ast = css_asts[record.source_index.get()] orelse continue;
                            for (compose.names.slice()) |name| {
                                if (!other_css_ast.local_scope.contains(name.v)) {
                                    try this.log.addErrorFmt(
                                        &input_files[record.source_index.get()],
                                        compose.loc,
                                        this.allocator,
                                        "The name \"{s}\" never appears in \"{s}\" as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                        .{
                                            name.v,
                                            input_files[record.source_index.get()].path.pretty,
                                        },
                                    );
                                }
                            }
                        }
                    }
                    this.validateComposesFromProperties(id, css_ast, import_records_list, css_asts);

                    continue;
                }

                _ = this.validateTLA(id, tla_keywords, tla_checks, input_files, import_records, flags, import_records_list);

                for (import_records) |record| {
                    if (!record.source_index.isValid()) {
                        continue;
                    }

                    const other_file = record.source_index.get();
                    const other_flags = ast_flags_list[other_file];
                    // other file is empty
                    if (other_file >= exports_kind.len) continue;
                    const other_kind = exports_kind[other_file];

                    switch (record.kind) {
                        .stmt => {
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
                                !other_flags.has_lazy_export and !other_flags.force_cjs_to_esm and
                                exports_kind[other_file] == .none)
                            {
                                exports_kind[other_file] = .cjs;
                                flags[other_file].wrap = .cjs;
                            }

                            if (record.contains_default_alias and
                                other_flags.force_cjs_to_esm)
                            {
                                exports_kind[other_file] = .cjs;
                                flags[other_file].wrap = .cjs;
                            }
                        },
                        .require =>
                        // Files that are imported with require() must be CommonJS modules
                        {
                            if (other_kind == .esm) {
                                flags[other_file].wrap = .esm;
                            } else {
                                // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
                                flags[other_file].wrap = .cjs;
                                exports_kind[other_file] = .cjs;
                            }
                        },
                        .dynamic => {
                            if (!this.graph.code_splitting) {
                                // If we're not splitting, then import() is just a require() that
                                // returns a promise, so the imported file must be a CommonJS module
                                if (exports_kind[other_file] == .esm) {
                                    flags[other_file].wrap = .esm;
                                } else {
                                    // TODO: introduce a NamedRequire for require("./foo").Bar AST nodes to support tree-shaking those.
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
                // resulting wrapper won't be invoked by other files. An exception is
                // made for entry point files in CommonJS format (or when in pass-through mode).
                if (kind == .cjs and (!entry_point_kinds[id].isEntryPoint() or output_format == .iife or output_format == .esm)) {
                    flags[id].wrap = .cjs;
                }
            }

            if (comptime Environment.enable_logs) {
                var cjs_count: usize = 0;
                var esm_count: usize = 0;
                var wrap_cjs_count: usize = 0;
                var wrap_esm_count: usize = 0;
                for (exports_kind) |kind| {
                    cjs_count += @intFromBool(kind == .cjs);
                    esm_count += @intFromBool(kind == .esm);
                }

                for (flags) |flag| {
                    wrap_cjs_count += @intFromBool(flag.wrap == .cjs);
                    wrap_esm_count += @intFromBool(flag.wrap == .esm);
                }

                debug("Step 1: {d} CommonJS modules (+ {d} wrapped), {d} ES modules (+ {d} wrapped)", .{
                    cjs_count,
                    wrap_cjs_count,
                    esm_count,
                    wrap_esm_count,
                });
            }

            // Step 2: Propagate dynamic export status for export star statements that
            // are re-exports from a module whose exports are not statically analyzable.
            // In this case the export star must be evaluated at run time instead of at
            // bundle time.

            {
                const trace = bun.perf.trace("Bundler.WrapDependencies");
                defer trace.end();
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
                const trace = bun.perf.trace("Bundler.ResolveExportStarStatements");
                defer trace.end();
                defer {
                    if (export_star_ctx) |*export_ctx| {
                        export_ctx.source_index_stack.deinit();
                    }
                }
                var resolved_exports: []ResolvedExports = this.graph.meta.items(.resolved_exports);
                var resolved_export_stars: []ExportData = this.graph.meta.items(.resolved_export_star);

                for (reachable) |source_index_| {
                    const source_index = source_index_.get();
                    const id = source_index;

                    // Expression-style loaders defer code generation until linking. Code
                    // generation is done here because at this point we know that the
                    // "ExportsKind" field has its final value and will not be changed.
                    if (ast_flags_list[id].has_lazy_export) {
                        try this.generateCodeForLazyExport(id);
                    }

                    // Propagate exports for export star statements
                    const export_star_ids = export_star_import_records[id];
                    if (export_star_ids.len > 0) {
                        if (export_star_ctx == null) {
                            export_star_ctx = ExportStarContext{
                                .allocator = this.allocator,
                                .resolved_exports = resolved_exports,
                                .import_records_list = import_records_list,
                                .export_star_records = export_star_import_records,

                                .imports_to_bind = this.graph.meta.items(.imports_to_bind),

                                .source_index_stack = std.ArrayList(u32).initCapacity(this.allocator, 32) catch unreachable,
                                .exports_kind = exports_kind,
                                .named_exports = this.graph.ast.items(.named_exports),
                            };
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

            if (comptime FeatureFlags.help_catch_memory_issues) {
                this.checkForMemoryCorruption();
            }

            // Step 4: Match imports with exports. This must be done after we process all
            // export stars because imports can bind to export star re-exports.
            {
                this.cycle_detector.clearRetainingCapacity();
                const trace = bun.perf.trace("Bundler.MatchImportsWithExports");
                defer trace.end();
                const wrapper_part_indices = this.graph.meta.items(.wrapper_part_index);
                const imports_to_bind = this.graph.meta.items(.imports_to_bind);
                for (reachable) |source_index_| {
                    const source_index = source_index_.get();

                    // not a JS ast or empty
                    if (source_index >= named_imports.len) {
                        continue;
                    }

                    const named_imports_ = &named_imports[source_index];
                    if (named_imports_.count() > 0) {
                        this.matchImportsWithExportsForFile(
                            named_imports_,
                            &imports_to_bind[source_index],
                            source_index,
                        );

                        if (this.log.errors > 0) {
                            return error.ImportResolutionFailed;
                        }
                    }
                    const export_kind = exports_kind[source_index];
                    var flag = flags[source_index];
                    // If we're exporting as CommonJS and this file was originally CommonJS,
                    // then we'll be using the actual CommonJS "exports" and/or "module"
                    // symbols. In that case make sure to mark them as such so they don't
                    // get minified.
                    if ((output_format == .cjs) and
                        entry_point_kinds[source_index].isEntryPoint() and
                        export_kind == .cjs and flag.wrap == .none)
                    {
                        const exports_ref = symbols.follow(exports_refs[source_index]);
                        const module_ref = symbols.follow(module_refs[source_index]);
                        symbols.get(exports_ref).?.kind = .unbound;
                        symbols.get(module_ref).?.kind = .unbound;
                    } else if (flag.force_include_exports_for_entry_point or export_kind != .cjs) {
                        flag.needs_exports_variable = true;
                        flags[source_index] = flag;
                    }

                    const wrapped_ref = this.graph.ast.items(.wrapper_ref)[source_index];

                    // Create the wrapper part for wrapped files. This is needed by a later step.
                    this.createWrapperForFile(
                        flag.wrap,
                        // if this one is null, the AST does not need to be wrapped.
                        wrapped_ref,
                        &wrapper_part_indices[source_index],
                        source_index,
                    );
                }
            }

            // Step 5: Create namespace exports for every file. This is always necessary
            // for CommonJS files, and is also necessary for other files if they are
            // imported using an import star statement.
            // Note: `do` will wait for all to finish before moving forward
            try this.parse_graph.pool.worker_pool.do(this.allocator, &this.wait_group, this, doStep5, this.graph.reachable_files);
        }

        if (comptime FeatureFlags.help_catch_memory_issues) {
            this.checkForMemoryCorruption();
        }

        // Step 6: Bind imports to exports. This adds non-local dependencies on the
        // parts that declare the export to all parts that use the import. Also
        // generate wrapper parts for wrapped files.
        {
            const trace = bun.perf.trace("Bundler.BindImportsToExports");
            defer trace.end();
            // const needs_export_symbol_from_runtime: []const bool = this.graph.meta.items(.needs_export_symbol_from_runtime);

            var runtime_export_symbol_ref: Ref = Ref.None;
            var entry_point_kinds: []EntryPoint.Kind = this.graph.files.items(.entry_point_kind);
            var flags: []JSMeta.Flags = this.graph.meta.items(.flags);
            var ast_fields = this.graph.ast.slice();

            const wrapper_refs = ast_fields.items(.wrapper_ref);
            const exports_kind = ast_fields.items(.exports_kind);
            const exports_refs = ast_fields.items(.exports_ref);
            const module_refs = ast_fields.items(.module_ref);
            const named_imports = ast_fields.items(.named_imports);
            const import_records_list = ast_fields.items(.import_records);
            const export_star_import_records = ast_fields.items(.export_star_import_records);
            const ast_flags = ast_fields.items(.flags);
            for (reachable) |source_index_| {
                const source_index = source_index_.get();
                const id = source_index;

                const is_entry_point = entry_point_kinds[source_index].isEntryPoint();
                const aliases = this.graph.meta.items(.sorted_and_filtered_export_aliases)[id];
                const flag = flags[id];
                const wrap = flag.wrap;
                const export_kind = exports_kind[id];
                const source: *const Logger.Source = &this.parse_graph.input_files.items(.source)[source_index];

                const exports_ref = exports_refs[id];

                const module_ref = module_refs[id];

                const string_buffer_len: usize = brk: {
                    var count: usize = 0;
                    if (is_entry_point and output_format == .esm) {
                        for (aliases) |alias| {
                            count += std.fmt.count("export_{}", .{bun.fmt.fmtIdentifier(alias)});
                        }
                    }

                    const ident_fmt_len: usize = if (source.identifier_name.len > 0)
                        source.identifier_name.len
                    else
                        std.fmt.count("{}", .{source.fmtIdentifier()});

                    if (wrap == .esm and wrapper_refs[id].isValid()) {
                        count += "init_".len + ident_fmt_len;
                    }

                    if (wrap != .cjs and export_kind != .cjs and output_format != .internal_bake_dev) {
                        count += "exports_".len + ident_fmt_len;
                        count += "module_".len + ident_fmt_len;
                    }

                    break :brk count;
                };

                const string_buffer = this.allocator.alloc(u8, string_buffer_len) catch unreachable;
                var builder = bun.StringBuilder{
                    .len = 0,
                    .cap = string_buffer.len,
                    .ptr = string_buffer.ptr,
                };

                defer bun.assert(builder.len == builder.cap); // ensure we used all of it

                // Pre-generate symbols for re-exports CommonJS symbols in case they
                // are necessary later. This is done now because the symbols map cannot be
                // mutated later due to parallelism.
                if (is_entry_point and output_format == .esm) {
                    const copies = this.allocator.alloc(Ref, aliases.len) catch unreachable;

                    for (aliases, copies) |alias, *copy| {
                        const original_name = builder.fmt("export_{}", .{bun.fmt.fmtIdentifier(alias)});
                        copy.* = this.graph.generateNewSymbol(source_index, .other, original_name);
                    }
                    this.graph.meta.items(.cjs_export_copies)[id] = copies;
                }

                // Use "init_*" for ESM wrappers instead of "require_*"
                if (wrap == .esm) {
                    const ref = wrapper_refs[id];
                    if (ref.isValid()) {
                        const original_name = builder.fmt(
                            "init_{}",
                            .{source.fmtIdentifier()},
                        );

                        this.graph.symbols.get(ref).?.original_name = original_name;
                    }
                }

                // If this isn't CommonJS, then rename the unused "exports" and "module"
                // variables to avoid them causing the identically-named variables in
                // actual CommonJS files from being renamed. This is purely about
                // aesthetics and is not about correctness. This is done here because by
                // this point, we know the CommonJS status will not change further.
                if (wrap != .cjs and export_kind != .cjs and output_format != .internal_bake_dev) {
                    const exports_name = builder.fmt("exports_{}", .{source.fmtIdentifier()});
                    const module_name = builder.fmt("module_{}", .{source.fmtIdentifier()});

                    // Note: it's possible for the symbols table to be resized
                    // so we cannot call .get() above this scope.
                    var exports_symbol: ?*js_ast.Symbol = if (exports_ref.isValid())
                        this.graph.symbols.get(exports_ref)
                    else
                        null;
                    var module_symbol: ?*js_ast.Symbol = if (module_ref.isValid())
                        this.graph.symbols.get(module_ref)
                    else
                        null;

                    if (exports_symbol != null)
                        exports_symbol.?.original_name = exports_name;
                    if (module_symbol != null)
                        module_symbol.?.original_name = module_name;
                }

                // Include the "__export" symbol from the runtime if it was used in the
                // previous step. The previous step can't do this because it's running in
                // parallel and can't safely mutate the "importsToBind" map of another file.
                if (flag.needs_export_symbol_from_runtime) {
                    if (!runtime_export_symbol_ref.isValid()) {
                        runtime_export_symbol_ref = this.runtimeFunction("__export");
                    }

                    bun.assert(runtime_export_symbol_ref.isValid());

                    this.graph.generateSymbolImportAndUse(
                        id,
                        js_ast.namespace_export_part_index,
                        runtime_export_symbol_ref,
                        1,
                        Index.runtime,
                    ) catch unreachable;
                }
                var imports_to_bind_list: []RefImportData = this.graph.meta.items(.imports_to_bind);
                var parts_list: []Part.List = ast_fields.items(.parts);

                var parts: []Part = parts_list[id].slice();

                const imports_to_bind = &imports_to_bind_list[id];
                for (imports_to_bind.keys(), imports_to_bind.values()) |ref_untyped, import_untyped| {
                    const ref: Ref = ref_untyped; // ZLS
                    const import: ImportData = import_untyped; // ZLS

                    const import_source_index = import.data.source_index.get();

                    if (named_imports[id].get(ref)) |named_import| {
                        for (named_import.local_parts_with_uses.slice()) |part_index| {
                            var part: *Part = &parts[part_index];
                            const parts_declaring_symbol: []const u32 = this.graph.topLevelSymbolToParts(import_source_index, import.data.import_ref);

                            const total_len = parts_declaring_symbol.len + @as(usize, import.re_exports.len) + @as(usize, part.dependencies.len);
                            if (part.dependencies.cap < total_len) {
                                var list = std.ArrayList(Dependency).init(this.allocator);
                                list.ensureUnusedCapacity(total_len) catch unreachable;
                                list.appendSliceAssumeCapacity(part.dependencies.slice());
                                part.dependencies.update(list);
                            }

                            // Depend on the file containing the imported symbol
                            for (parts_declaring_symbol) |resolved_part_index| {
                                part.dependencies.appendAssumeCapacity(.{
                                    .source_index = Index.source(import_source_index),
                                    .part_index = resolved_part_index,
                                });
                            }

                            // Also depend on any files that re-exported this symbol in between the
                            // file containing the import and the file containing the imported symbol
                            part.dependencies.appendSliceAssumeCapacity(import.re_exports.slice());
                        }
                    }

                    _ = this.graph.symbols.merge(ref, import.data.import_ref);
                }

                // If this is an entry point, depend on all exports so they are included
                if (is_entry_point) {
                    const force_include_exports = flag.force_include_exports_for_entry_point;
                    const add_wrapper = wrap != .none;

                    const extra_count = @as(usize, @intFromBool(force_include_exports)) +
                        @as(usize, @intFromBool(add_wrapper));

                    var dependencies = std.ArrayList(js_ast.Dependency).initCapacity(this.allocator, extra_count) catch bun.outOfMemory();

                    var resolved_exports_list: *ResolvedExports = &this.graph.meta.items(.resolved_exports)[id];
                    for (aliases) |alias| {
                        const exp = resolved_exports_list.get(alias).?;
                        var target_source_index = exp.data.source_index;
                        var target_ref = exp.data.import_ref;

                        // If this is an import, then target what the import points to
                        if (imports_to_bind_list[target_source_index.get()].get(target_ref)) |import_data| {
                            target_source_index = import_data.data.source_index;
                            target_ref = import_data.data.import_ref;

                            dependencies.appendSlice(import_data.re_exports.slice()) catch bun.outOfMemory();
                        }

                        // Pull in all declarations of this symbol
                        const top_to_parts = this.topLevelSymbolsToParts(target_source_index.get(), target_ref);
                        dependencies.ensureUnusedCapacity(top_to_parts.len) catch bun.outOfMemory();
                        for (top_to_parts) |part_index| {
                            dependencies.appendAssumeCapacity(.{
                                .source_index = target_source_index,
                                .part_index = part_index,
                            });
                        }
                    }

                    dependencies.ensureUnusedCapacity(extra_count) catch bun.outOfMemory();

                    // Ensure "exports" is included if the current output format needs it
                    if (force_include_exports) {
                        dependencies.appendAssumeCapacity(
                            .{ .source_index = Index.source(source_index), .part_index = js_ast.namespace_export_part_index },
                        );
                    }

                    // Include the wrapper if present
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
                    ) catch bun.outOfMemory();

                    parts = parts_list[id].slice();
                    this.graph.meta.items(.entry_point_part_index)[id] = Index.part(entry_point_part_index);

                    // Pull in the "__toCommonJS" symbol if we need it due to being an entry point
                    if (force_include_exports and output_format != .internal_bake_dev) {
                        this.graph.generateRuntimeSymbolImportAndUse(
                            source_index,
                            Index.part(entry_point_part_index),
                            "__toCommonJS",
                            1,
                        ) catch unreachable;
                    }
                }

                // Encode import-specific constraints in the dependency graph
                const import_records: []ImportRecord = import_records_list[id].slice();
                debug("Binding {d} imports for file {s} (#{d})", .{ import_records.len, source.path.text, id });

                for (parts, 0..) |*part, part_index| {
                    var to_esm_uses: u32 = 0;
                    var to_common_js_uses: u32 = 0;
                    var runtime_require_uses: u32 = 0;

                    // Imports of wrapped files must depend on the wrapper
                    for (part.import_record_indices.slice()) |import_record_index| {
                        var record = &import_records[import_record_index];
                        const kind = record.kind;
                        const other_id = record.source_index.value;

                        // Don't follow external imports (this includes import() expressions)
                        if (!record.source_index.isValid() or this.isExternalDynamicImport(record, source_index)) {
                            if (output_format == .internal_bake_dev) continue;

                            // This is an external import. Check if it will be a "require()" call.
                            if (kind == .require or !output_format.keepES6ImportExportSyntax() or kind == .dynamic) {
                                if (record.source_index.isValid() and kind == .dynamic and ast_flags[other_id].force_cjs_to_esm) {
                                    // If the CommonJS module was converted to ESM
                                    // and the developer `import("cjs_module")`, then
                                    // they may have code that expects the default export to return the CommonJS module.exports object
                                    // That module.exports object does not exist.
                                    // We create a default object with getters for each statically-known export
                                    // This is kind of similar to what Node.js does
                                    // Once we track usages of the dynamic import, we can remove this.
                                    if (!ast_fields.items(.named_exports)[other_id].contains("default"))
                                        flags[other_id].needs_synthetic_default_export = true;

                                    continue;
                                } else {
                                    // We should use "__require" instead of "require" if we're not
                                    // generating a CommonJS output file, since it won't exist otherwise.
                                    if (shouldCallRuntimeRequire(output_format)) {
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
                            }
                            continue;
                        }

                        bun.assert(@as(usize, @intCast(other_id)) < this.graph.meta.len);
                        const other_flags = flags[other_id];
                        const other_export_kind = exports_kind[other_id];
                        const other_source_index = other_id;

                        if (other_flags.wrap != .none) {
                            // Depend on the automatically-generated require wrapper symbol
                            const wrapper_ref = wrapper_refs[other_id];
                            if (wrapper_ref.isValid()) {
                                this.graph.generateSymbolImportAndUse(
                                    source_index,
                                    @as(u32, @intCast(part_index)),
                                    wrapper_ref,
                                    1,
                                    Index.source(other_source_index),
                                ) catch unreachable;
                            }

                            // This is an ES6 import of a CommonJS module, so it needs the
                            // "__toESM" wrapper as long as it's not a bare "require()"
                            if (kind != .require and other_export_kind == .cjs and output_format != .internal_bake_dev) {
                                record.wrap_with_to_esm = true;
                                to_esm_uses += 1;
                            }

                            // If this is an ESM wrapper, also depend on the exports object
                            // since the final code will contain an inline reference to it.
                            // This must be done for "require()" and "import()" expressions
                            // but does not need to be done for "import" statements since
                            // those just cause us to reference the exports directly.
                            if (other_flags.wrap == .esm and kind != .stmt) {
                                this.graph.generateSymbolImportAndUse(
                                    source_index,
                                    @as(u32, @intCast(part_index)),
                                    this.graph.ast.items(.exports_ref)[other_id],
                                    1,
                                    Index.source(other_source_index),
                                ) catch unreachable;

                                // If this is a "require()" call, then we should add the
                                // "__esModule" marker to behave as if the module was converted
                                // from ESM to CommonJS. This is done via a wrapper instead of
                                // by modifying the exports object itself because the same ES
                                // module may be simultaneously imported and required, and the
                                // importing code should not see "__esModule" while the requiring
                                // code should see "__esModule". This is an extremely complex
                                // and subtle set of transpiler interop issues. See for example
                                // https://github.com/evanw/esbuild/issues/1591.
                                if (kind == .require) {
                                    record.wrap_with_to_commonjs = true;
                                    to_common_js_uses += 1;
                                }
                            }
                        } else if (kind == .stmt and export_kind == .esm_with_dynamic_fallback) {
                            // This is an import of a module that has a dynamic export fallback
                            // object. In that case we need to depend on that object in case
                            // something ends up needing to use it later. This could potentially
                            // be omitted in some cases with more advanced analysis if this
                            // dynamic export fallback object doesn't end up being needed.
                            this.graph.generateSymbolImportAndUse(
                                source_index,
                                @as(u32, @intCast(part_index)),
                                this.graph.ast.items(.exports_ref)[other_id],
                                1,
                                Index.source(other_source_index),
                            ) catch unreachable;
                        }
                    }

                    // If there's an ES6 export star statement of a non-ES6 module, then we're
                    // going to need the "__reExport" symbol from the runtime
                    var re_export_uses: u32 = 0;

                    for (export_star_import_records[id]) |import_record_index| {
                        var record = &import_records[import_record_index];

                        var happens_at_runtime = record.source_index.isInvalid() and (!is_entry_point or !output_format.keepES6ImportExportSyntax());
                        if (record.source_index.isValid()) {
                            const other_source_index = record.source_index.get();
                            const other_id = other_source_index;
                            bun.assert(@as(usize, @intCast(other_id)) < this.graph.meta.len);
                            const other_export_kind = exports_kind[other_id];
                            if (other_source_index != source_index and other_export_kind.isDynamic()) {
                                happens_at_runtime = true;
                            }

                            if (other_export_kind.isESMWithDynamicFallback()) {
                                // This looks like "__reExport(exports_a, exports_b)". Make sure to
                                // pull in the "exports_b" symbol into this export star. This matters
                                // in code splitting situations where the "export_b" symbol might live
                                // in a different chunk than this export star.
                                this.graph.generateSymbolImportAndUse(
                                    source_index,
                                    @as(u32, @intCast(part_index)),
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
                                @as(u32, @intCast(part_index)),
                                this.graph.ast.items(.exports_ref)[id],
                                1,
                                Index.source(source_index),
                            ) catch unreachable;
                            this.graph.ast.items(.flags)[id].uses_exports_ref = true;
                            record.calls_runtime_re_export_fn = true;
                            re_export_uses += 1;
                        }
                    }

                    if (output_format != .internal_bake_dev) {
                        // If there's an ES6 import of a CommonJS module, then we're going to need the
                        // "__toESM" symbol from the runtime to wrap the result of "require()"
                        this.graph.generateRuntimeSymbolImportAndUse(
                            source_index,
                            Index.part(part_index),
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
                            "__require",
                            runtime_require_uses,
                        ) catch unreachable;

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
    }

    /// CSS modules spec says that the following is undefined behavior:
    ///
    /// ```css
    /// .foo {
    ///     composes: bar;
    ///     color: red;
    /// }
    ///
    /// .bar {
    ///     color: blue;
    /// }
    /// ```
    ///
    /// Specfically, composing two classes that both define the same property is undefined behavior.
    ///
    /// We check this by recording, at parse time, properties that classes use in the `PropertyUsage` struct.
    /// Then here, we compare the properties of the two classes to ensure that there are no conflicts.
    ///
    /// There is one case we skip, which is checking the properties of composing from the global scope (`composes: X from global`).
    ///
    /// The reason we skip this is because it would require tracking _every_ property of _every_ class (not just CSS module local classes).
    /// This sucks because:
    /// 1. It introduces a performance hit even if the user did not use CSS modules
    /// 2. Composing from the global scope is pretty rare
    ///
    /// We should find a way to do this without incurring performance penalties to the common cases.
    fn validateComposesFromProperties(
        this: *LinkerContext,
        index: Index.Int,
        root_css_ast: *bun.css.BundlerStyleSheet,
        import_records_list: []ImportRecord.List,
        all_css_asts: []const ?*bun.css.BundlerStyleSheet,
    ) void {
        const PropertyInFile = struct {
            source_index: Index.Int,
            range: bun.logger.Range,
        };
        const Visitor = struct {
            visited: std.AutoArrayHashMap(Ref, void),
            properties: bun.StringArrayHashMap(PropertyInFile),
            all_import_records: []const ImportRecord.List,
            all_css_asts: []const ?*bun.css.BundlerStyleSheet,
            all_symbols: *const Symbol.Map,
            all_sources: []const Logger.Source,
            temp_allocator: std.mem.Allocator,
            allocator: std.mem.Allocator,
            log: *Logger.Log,

            pub fn deinit(v: *@This()) void {
                v.visited.deinit();
                v.properties.deinit();
            }

            fn addPropertyOrWarn(v: *@This(), local: Ref, property_name: []const u8, source_index: Index.Int, range: bun.logger.Range) void {
                const entry = v.properties.getOrPut(property_name) catch bun.outOfMemory();

                if (!entry.found_existing) {
                    entry.value_ptr.* = .{
                        .source_index = source_index,
                        .range = range,
                    };
                    return;
                }

                if (entry.value_ptr.source_index == source_index or entry.value_ptr.source_index == Index.invalid.get()) {
                    return;
                }

                const local_original_name = v.all_symbols.get(local).?.original_name;

                v.log.addMsg(.{
                    .kind = .err,
                    .data = Logger.rangeData(
                        &v.all_sources[source_index],
                        range,
                        Logger.Log.allocPrint(
                            v.allocator,
                            "<r>The value of <b>{s}<r> in the class <b>{s}<r> is undefined.",
                            .{ property_name, local_original_name },
                        ) catch bun.outOfMemory(),
                    ).cloneLineText(v.log.clone_line_text, v.log.msgs.allocator) catch bun.outOfMemory(),
                    .notes = v.allocator.dupe(
                        Logger.Data,
                        &.{
                            bun.logger.rangeData(
                                &v.all_sources[entry.value_ptr.source_index],
                                entry.value_ptr.range,
                                Logger.Log.allocPrint(v.allocator, "The first definition of {s} is in this style rule:", .{property_name}) catch bun.outOfMemory(),
                            ),
                            .{ .text = std.fmt.allocPrint(
                                v.allocator,
                                "The specification of \"composes\" does not define an order when class declarations from separate files are composed together. " ++
                                    "The value of the {} property for {} may change unpredictably as the code is edited. " ++
                                    "Make sure that all definitions of {} for {} are in a single file.",
                                .{ bun.fmt.quote(property_name), bun.fmt.quote(local_original_name), bun.fmt.quote(property_name), bun.fmt.quote(local_original_name) },
                            ) catch bun.outOfMemory() },
                        },
                    ) catch bun.outOfMemory(),
                }) catch bun.outOfMemory();

                // Don't warn more than once
                entry.value_ptr.source_index = Index.invalid.get();
            }

            fn clearRetainingCapacity(v: *@This()) void {
                v.visited.clearRetainingCapacity();
                v.properties.clearRetainingCapacity();
            }

            fn visit(v: *@This(), idx: Index.Int, ast: *bun.css.BundlerStyleSheet, ref: Ref) void {
                if (v.visited.contains(ref)) return;
                v.visited.put(ref, {}) catch unreachable;

                // This local name was in a style rule that
                if (ast.composes.getPtr(ref)) |composes| {
                    for (composes.composes.sliceConst()) |*compose| {
                        // is an import
                        if (compose.from != null) {
                            if (compose.from.? == .import_record_index) {
                                const import_record_idx = compose.from.?.import_record_index;
                                const record = v.all_import_records[idx].at(import_record_idx);
                                if (record.source_index.isInvalid()) continue;
                                const other_ast = v.all_css_asts[record.source_index.get()] orelse continue;
                                for (compose.names.slice()) |name| {
                                    const other_name = other_ast.local_scope.get(name.v) orelse continue;
                                    const other_name_ref = other_name.ref.toRealRef(record.source_index.get());
                                    v.visit(record.source_index.get(), other_ast, other_name_ref);
                                }
                            } else {
                                bun.assert(compose.from.? == .global);
                                // Otherwise it is composed from the global scope.
                                //
                                // See comment above for why we are skipping checking this for now.
                            }
                        } else {
                            // inside this file
                            for (compose.names.slice()) |name| {
                                const name_entry = ast.local_scope.get(name.v) orelse continue;
                                v.visit(idx, ast, name_entry.ref.toRealRef(idx));
                            }
                        }
                    }
                }

                const property_usage = ast.local_properties.getPtr(ref) orelse return;
                // Warn about cross-file composition with the same CSS properties
                var iter = property_usage.bitset.iterator(.{});
                while (iter.next()) |property_tag| {
                    const property_id_tag: bun.css.PropertyIdTag = @enumFromInt(@as(u16, @intCast(property_tag)));
                    bun.assert(property_id_tag != .custom);
                    bun.assert(property_id_tag != .unparsed);
                    v.addPropertyOrWarn(ref, @tagName(property_id_tag), idx, property_usage.range);
                }

                for (property_usage.custom_properties) |property| {
                    v.addPropertyOrWarn(ref, property, idx, property_usage.range);
                }
            }
        };
        var sfb = std.heap.stackFallback(1024, this.graph.allocator);
        const temp_allocator = sfb.get();
        var visitor = Visitor{
            .visited = std.AutoArrayHashMap(Ref, void).init(temp_allocator),
            .properties = bun.StringArrayHashMap(PropertyInFile).init(temp_allocator),
            .all_import_records = import_records_list,
            .all_css_asts = all_css_asts,
            .all_symbols = &this.graph.symbols,
            .all_sources = this.parse_graph.input_files.items(.source),
            .temp_allocator = temp_allocator,
            .allocator = this.graph.allocator,
            .log = this.log,
        };
        defer visitor.deinit();
        for (root_css_ast.local_scope.values()) |local| {
            visitor.clearRetainingCapacity();
            visitor.visit(index, root_css_ast, local.ref.toRealRef(index));
        }
    }

    pub fn scanCSSImports(
        this: *LinkerContext,
        file_source_index: u32,
        file_import_records: []ImportRecord,
        // slices from Graph
        css_asts: []const ?*bun.css.BundlerStyleSheet,
        sources: []const Logger.Source,
        loaders: []const Loader,
        log: *Logger.Log,
    ) enum { ok, errors } {
        for (file_import_records) |*record| {
            if (record.source_index.isValid()) {
                // Other file is not CSS
                if (css_asts[record.source_index.get()] == null) {
                    const source = &sources[file_source_index];
                    const loader = loaders[record.source_index.get()];

                    switch (loader) {
                        .jsx, .js, .ts, .tsx, .napi, .sqlite, .json, .jsonc, .html, .sqlite_embedded => {
                            log.addErrorFmt(
                                source,
                                record.range.loc,
                                this.allocator,
                                "Cannot import a \".{s}\" file into a CSS file",
                                .{@tagName(loader)},
                            ) catch bun.outOfMemory();
                        },
                        .css, .file, .toml, .wasm, .base64, .dataurl, .text, .bunsh => {},
                    }
                }
            }
        }
        return if (log.errors > 0) .errors else .ok;
    }

    pub fn createExportsForFile(
        c: *LinkerContext,
        allocator: std.mem.Allocator,
        id: u32,
        resolved_exports: *ResolvedExports,
        imports_to_bind: []RefImportData,
        export_aliases: []const string,
        re_exports_count: usize,
    ) void {
        ////////////////////////////////////////////////////////////////////////////////
        // WARNING: This method is run in parallel over all files. Do not mutate data
        // for other files within this method or you will create a data race.
        ////////////////////////////////////////////////////////////////////////////////

        Stmt.Disabler.disable();
        defer Stmt.Disabler.enable();
        Expr.Disabler.disable();
        defer Expr.Disabler.enable();

        // 1 property per export
        var properties = std.ArrayList(js_ast.G.Property)
            .initCapacity(allocator, export_aliases.len) catch bun.outOfMemory();

        var ns_export_symbol_uses = Part.SymbolUseMap{};
        ns_export_symbol_uses.ensureTotalCapacity(allocator, export_aliases.len) catch bun.outOfMemory();

        const initial_flags = c.graph.meta.items(.flags)[id];
        const needs_exports_variable = initial_flags.needs_exports_variable;
        const force_include_exports_for_entry_point = c.options.output_format == .cjs and initial_flags.force_include_exports_for_entry_point;

        const stmts_count =
            // 1 statement for every export
            export_aliases.len +
            // + 1 if there are non-zero exports
            @as(usize, @intFromBool(export_aliases.len > 0)) +
            // + 1 if we need to inject the exports variable
            @as(usize, @intFromBool(needs_exports_variable)) +
            // + 1 if we need to do module.exports = __toCommonJS(exports)
            @as(usize, @intFromBool(force_include_exports_for_entry_point));

        var stmts = js_ast.Stmt.Batcher.init(allocator, stmts_count) catch bun.outOfMemory();
        defer stmts.done();
        const loc = Logger.Loc.Empty;
        // todo: investigate if preallocating this array is faster
        var ns_export_dependencies = std.ArrayList(js_ast.Dependency).initCapacity(allocator, re_exports_count) catch bun.outOfMemory();
        for (export_aliases) |alias| {
            var exp = resolved_exports.getPtr(alias).?.*;

            // If this is an export of an import, reference the symbol that the import
            // was eventually resolved to. We need to do this because imports have
            // already been resolved by this point, so we can't generate a new import
            // and have that be resolved later.
            if (imports_to_bind[exp.data.source_index.get()].get(exp.data.import_ref)) |import_data| {
                exp.data.import_ref = import_data.data.import_ref;
                exp.data.source_index = import_data.data.source_index;
                ns_export_dependencies.appendSlice(import_data.re_exports.slice()) catch bun.outOfMemory();
            }

            // Exports of imports need EImportIdentifier in case they need to be re-
            // written to a property access later on
            // note: this is stack allocated
            const value: js_ast.Expr = brk: {
                if (c.graph.symbols.getConst(exp.data.import_ref)) |symbol| {
                    if (symbol.namespace_alias != null) {
                        break :brk js_ast.Expr.init(
                            js_ast.E.ImportIdentifier,
                            js_ast.E.ImportIdentifier{
                                .ref = exp.data.import_ref,
                            },
                            loc,
                        );
                    }
                }

                break :brk js_ast.Expr.init(
                    js_ast.E.Identifier,
                    js_ast.E.Identifier{
                        .ref = exp.data.import_ref,
                    },
                    loc,
                );
            };

            const fn_body = js_ast.G.FnBody{
                .stmts = stmts.eat1(
                    js_ast.Stmt.allocate(
                        allocator,
                        js_ast.S.Return,
                        .{ .value = value },
                        loc,
                    ),
                ),
                .loc = loc,
            };
            properties.appendAssumeCapacity(.{
                .key = js_ast.Expr.allocate(
                    allocator,
                    js_ast.E.String,
                    .{
                        // TODO: test emoji work as expected
                        // relevant for WASM exports
                        .data = alias,
                    },
                    loc,
                ),
                .value = js_ast.Expr.allocate(
                    allocator,
                    js_ast.E.Arrow,
                    .{ .prefer_expr = true, .body = fn_body },
                    loc,
                ),
            });
            ns_export_symbol_uses.putAssumeCapacity(exp.data.import_ref, .{ .count_estimate = 1 });

            // Make sure the part that declares the export is included
            const parts = c.topLevelSymbolsToParts(exp.data.source_index.get(), exp.data.import_ref);
            ns_export_dependencies.ensureUnusedCapacity(parts.len) catch unreachable;
            for (parts, ns_export_dependencies.unusedCapacitySlice()[0..parts.len]) |part_id, *dest| {
                // Use a non-local dependency since this is likely from a different
                // file if it came in through an export star
                dest.* = .{
                    .source_index = exp.data.source_index,
                    .part_index = part_id,
                };
            }
            ns_export_dependencies.items.len += parts.len;
        }

        var declared_symbols = js_ast.DeclaredSymbol.List{};
        const exports_ref = c.graph.ast.items(.exports_ref)[id];
        const all_export_stmts: []js_ast.Stmt = stmts.head[0 .. @as(usize, @intFromBool(needs_exports_variable)) +
            @as(usize, @intFromBool(properties.items.len > 0) +
                @as(usize, @intFromBool(force_include_exports_for_entry_point)))];
        stmts.head = stmts.head[all_export_stmts.len..];
        var remaining_stmts = all_export_stmts;
        defer bun.assert(remaining_stmts.len == 0); // all must be used

        // Prefix this part with "var exports = {}" if this isn't a CommonJS entry point
        if (needs_exports_variable) {
            var decls = allocator.alloc(js_ast.G.Decl, 1) catch unreachable;
            decls[0] = .{
                .binding = js_ast.Binding.alloc(
                    allocator,
                    js_ast.B.Identifier{
                        .ref = exports_ref,
                    },
                    loc,
                ),
                .value = js_ast.Expr.allocate(allocator, js_ast.E.Object, .{}, loc),
            };
            remaining_stmts[0] = js_ast.Stmt.allocate(
                allocator,
                js_ast.S.Local,
                .{
                    .decls = G.Decl.List.init(decls),
                },
                loc,
            );
            remaining_stmts = remaining_stmts[1..];
            declared_symbols.append(allocator, .{ .ref = exports_ref, .is_top_level = true }) catch unreachable;
        }

        // "__export(exports, { foo: () => foo })"
        var export_ref = Ref.None;
        if (properties.items.len > 0) {
            export_ref = c.runtimeFunction("__export");
            var args = allocator.alloc(js_ast.Expr, 2) catch unreachable;
            args[0..2].* = [_]js_ast.Expr{
                js_ast.Expr.initIdentifier(exports_ref, loc),
                js_ast.Expr.allocate(allocator, js_ast.E.Object, .{ .properties = js_ast.G.Property.List.fromList(properties) }, loc),
            };
            remaining_stmts[0] = js_ast.Stmt.allocate(
                allocator,
                js_ast.S.SExpr,
                .{
                    .value = js_ast.Expr.allocate(
                        allocator,
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
            remaining_stmts = remaining_stmts[1..];
            // Make sure this file depends on the "__export" symbol
            const parts = c.topLevelSymbolsToPartsForRuntime(export_ref);
            ns_export_dependencies.ensureUnusedCapacity(parts.len) catch unreachable;
            for (parts) |part_index| {
                ns_export_dependencies.appendAssumeCapacity(
                    .{ .source_index = Index.runtime, .part_index = part_index },
                );
            }

            // Make sure the CommonJS closure, if there is one, includes "exports"
            c.graph.ast.items(.flags)[id].uses_exports_ref = true;
        }

        // Decorate "module.exports" with the "__esModule" flag to indicate that
        // we used to be an ES module. This is done by wrapping the exports object
        // instead of by mutating the exports object because other modules in the
        // bundle (including the entry point module) may do "import * as" to get
        // access to the exports object and should NOT see the "__esModule" flag.
        if (force_include_exports_for_entry_point) {
            const toCommonJSRef = c.runtimeFunction("__toCommonJS");

            var call_args = allocator.alloc(js_ast.Expr, 1) catch unreachable;
            call_args[0] = Expr.initIdentifier(exports_ref, Loc.Empty);
            remaining_stmts[0] = js_ast.Stmt.assign(
                Expr.allocate(
                    allocator,
                    E.Dot,
                    E.Dot{
                        .name = "exports",
                        .name_loc = Loc.Empty,
                        .target = Expr.initIdentifier(c.unbound_module_ref, Loc.Empty),
                    },
                    Loc.Empty,
                ),
                Expr.allocate(
                    allocator,
                    E.Call,
                    E.Call{
                        .target = Expr.initIdentifier(toCommonJSRef, Loc.Empty),
                        .args = js_ast.ExprNodeList.init(call_args),
                    },
                    Loc.Empty,
                ),
            );
            remaining_stmts = remaining_stmts[1..];
        }

        // No need to generate a part if it'll be empty
        if (all_export_stmts.len > 0) {
            // - we must already have preallocated the parts array
            // - if the parts list is completely empty, we shouldn't have gotten here in the first place

            // Initialize the part that was allocated for us earlier. The information
            // here will be used after this during tree shaking.
            c.graph.ast.items(.parts)[id].slice()[js_ast.namespace_export_part_index] = .{
                .stmts = if (c.options.output_format != .internal_bake_dev) all_export_stmts else &.{},
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
        const trace = bun.perf.trace("Bundler.CreateNamespaceExports");
        defer trace.end();

        const id = source_index;
        if (id > c.graph.meta.len) return;

        const worker: *ThreadPool.Worker = ThreadPool.Worker.get(@fieldParentPtr("linker", c));
        defer worker.unget();

        // we must use this allocator here
        const allocator = worker.allocator;

        const resolved_exports: *ResolvedExports = &c.graph.meta.items(.resolved_exports)[id];

        // Now that all exports have been resolved, sort and filter them to create
        // something we can iterate over later.
        var aliases = std.ArrayList(string).initCapacity(allocator, resolved_exports.count()) catch unreachable;
        var alias_iter = resolved_exports.iterator();
        const imports_to_bind = c.graph.meta.items(.imports_to_bind);
        const probably_typescript_type = c.graph.meta.items(.probably_typescript_type);

        // counting in here saves us an extra pass through the array
        var re_exports_count: usize = 0;

        next_alias: while (alias_iter.next()) |entry| {
            var export_ = entry.value_ptr.*;
            const alias = entry.key_ptr.*;
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
            allocator,
            id,
            resolved_exports,
            imports_to_bind,
            export_aliases,
            re_exports_count,
        );

        // Each part tracks the other parts it depends on within this file
        var local_dependencies = std.AutoHashMap(u32, u32).init(allocator);
        defer local_dependencies.deinit();

        const parts_slice: []Part = c.graph.ast.items(.parts)[id].slice();
        const named_imports: *js_ast.Ast.NamedImports = &c.graph.ast.items(.named_imports)[id];

        const our_imports_to_bind = imports_to_bind[id];
        outer: for (parts_slice, 0..) |*part, part_index| {
            // Now that all files have been parsed, determine which property
            // accesses off of imported symbols are inlined enum values and
            // which ones aren't
            for (
                part.import_symbol_property_uses.keys(),
                part.import_symbol_property_uses.values(),
            ) |ref, properties| {
                const use = part.symbol_uses.getPtr(ref).?;

                // Rare path: this import is a TypeScript enum
                if (our_imports_to_bind.get(ref)) |import_data| {
                    const import_ref = import_data.data.import_ref;
                    if (c.graph.symbols.get(import_ref)) |symbol| {
                        if (symbol.kind == .ts_enum) {
                            if (c.graph.ts_enums.get(import_ref)) |enum_data| {
                                var found_non_inlined_enum = false;

                                var it = properties.iterator();
                                while (it.next()) |next| {
                                    const name = next.key_ptr.*;
                                    const prop_use = next.value_ptr;

                                    if (enum_data.get(name) == null) {
                                        found_non_inlined_enum = true;
                                        use.count_estimate += prop_use.count_estimate;
                                    }
                                }

                                if (!found_non_inlined_enum) {
                                    if (use.count_estimate == 0) {
                                        _ = part.symbol_uses.swapRemove(ref);
                                    }
                                    continue;
                                }
                            }
                        }
                    }
                }

                // Common path: this import isn't a TypeScript enum
                var it = properties.valueIterator();
                while (it.next()) |prop_use| {
                    use.count_estimate += prop_use.count_estimate;
                }
            }

            // TODO: inline function calls here

            // TODO: Inline cross-module constants
            // if (c.graph.const_values.count() > 0) {
            //     // First, find any symbol usage that points to a constant value.
            //     // This will be pretty rare.
            //     const first_constant_i: ?usize = brk: {
            //         for (part.symbol_uses.keys(), 0..) |ref, j| {
            //             if (c.graph.const_values.contains(ref)) {
            //                 break :brk j;
            //             }
            //         }

            //         break :brk null;
            //     };
            //     if (first_constant_i) |j| {
            //         var end_i: usize = 0;
            //         // symbol_uses is an array
            //         var keys = part.symbol_uses.keys()[j..];
            //         var values = part.symbol_uses.values()[j..];
            //         for (keys, values) |ref, val| {
            //             if (c.graph.const_values.contains(ref)) {
            //                 continue;
            //             }

            //             keys[end_i] = ref;
            //             values[end_i] = val;
            //             end_i += 1;
            //         }
            //         part.symbol_uses.entries.len = end_i + j;

            //         if (part.symbol_uses.entries.len == 0 and part.can_be_removed_if_unused) {
            //             part.tag = .dead_due_to_inlining;
            //             part.dependencies.len = 0;
            //             continue :outer;
            //         }

            //         part.symbol_uses.reIndex(allocator) catch unreachable;
            //     }
            // }
            if (false) break :outer; // this `if` is here to preserve the unused
            //                          block label from the above commented code.

            // Now that we know this, we can determine cross-part dependencies
            for (part.symbol_uses.keys(), 0..) |ref, j| {
                if (comptime Environment.allow_assert) {
                    bun.assert(part.symbol_uses.values()[j].count_estimate > 0);
                }

                const other_parts = c.topLevelSymbolsToParts(id, ref);

                for (other_parts) |other_part_index| {
                    const local = local_dependencies.getOrPut(other_part_index) catch unreachable;
                    if (!local.found_existing or local.value_ptr.* != part_index) {
                        local.value_ptr.* = @as(u32, @intCast(part_index));
                        // note: if we crash on append, it is due to threadlocal heaps in mimalloc
                        part.dependencies.push(
                            allocator,
                            .{
                                .source_index = Index.source(source_index),
                                .part_index = other_part_index,
                            },
                        ) catch unreachable;
                    }
                }

                // Also map from imports to parts that use them
                if (named_imports.getPtr(ref)) |existing| {
                    existing.local_parts_with_uses.push(allocator, @intCast(part_index)) catch unreachable;
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

    pub fn getSource(c: *LinkerContext, index: usize) *const Logger.Source {
        return &c.parse_graph.input_files.items(.source)[index];
    }

    pub fn treeShakingAndCodeSplitting(c: *LinkerContext) !void {
        const trace = bun.perf.trace("Bundler.treeShakingAndCodeSplitting");
        defer trace.end();

        const parts = c.graph.ast.items(.parts);
        const import_records = c.graph.ast.items(.import_records);
        const css_reprs = c.graph.ast.items(.css);
        const side_effects = c.parse_graph.input_files.items(.side_effects);
        const entry_point_kinds = c.graph.files.items(.entry_point_kind);
        const entry_points = c.graph.entry_points.items(.source_index);
        const distances = c.graph.files.items(.distance_from_entry_point);

        {
            const trace2 = bun.perf.trace("Bundler.markFileLiveForTreeShaking");
            defer trace2.end();

            // Tree shaking: Each entry point marks all files reachable from itself
            for (entry_points) |entry_point| {
                c.markFileLiveForTreeShaking(
                    entry_point,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }

        {
            const trace2 = bun.perf.trace("Bundler.markFileReachableForCodeSplitting");
            defer trace2.end();

            const file_entry_bits: []AutoBitSet = c.graph.files.items(.entry_bits);
            // AutoBitSet needs to be initialized if it is dynamic
            if (AutoBitSet.needsDynamic(entry_points.len)) {
                for (file_entry_bits) |*bits| {
                    bits.* = try AutoBitSet.initEmpty(c.allocator, entry_points.len);
                }
            } else if (file_entry_bits.len > 0) {
                // assert that the tag is correct
                bun.assert(file_entry_bits[0] == .static);
            }

            // Code splitting: Determine which entry points can reach which files. This
            // has to happen after tree shaking because there is an implicit dependency
            // between live parts within the same file. All liveness has to be computed
            // first before determining which entry points can reach which files.
            for (entry_points, 0..) |entry_point, i| {
                c.markFileReachableForCodeSplitting(
                    entry_point,
                    i,
                    distances,
                    0,
                    parts,
                    import_records,
                    file_entry_bits,
                    css_reprs,
                );
            }
        }
    }

    const ChunkMeta = struct {
        imports: Map,
        exports: Map,
        dynamic_imports: std.AutoArrayHashMap(Index.Int, void),

        pub const Map = std.AutoArrayHashMap(Ref, void);
    };

    const CrossChunkDependencies = struct {
        chunk_meta: []ChunkMeta,
        chunks: []Chunk,
        parts: []BabyList(Part),
        import_records: []BabyList(bun.ImportRecord),
        flags: []const JSMeta.Flags,
        entry_point_chunk_indices: []Index.Int,
        imports_to_bind: []RefImportData,
        wrapper_refs: []const Ref,
        sorted_and_filtered_export_aliases: []const []const string,
        resolved_exports: []const ResolvedExports,
        ctx: *LinkerContext,
        symbols: *Symbol.Map,

        pub fn walk(deps: *@This(), chunk: *Chunk, chunk_index: usize) void {
            var chunk_meta = &deps.chunk_meta[chunk_index];
            var imports = &deps.chunk_meta[chunk_index].imports;

            const entry_point_chunk_indices = deps.entry_point_chunk_indices;

            // Go over each file in this chunk
            for (chunk.files_with_parts_in_chunk.keys()) |source_index| {
                // TODO: make this switch
                if (chunk.content == .css) {
                    continue;
                }
                if (chunk.content != .javascript) continue;

                // Go over each part in this file that's marked for inclusion in this chunk
                const parts = deps.parts[source_index].slice();
                var import_records = deps.import_records[source_index].slice();
                const imports_to_bind = deps.imports_to_bind[source_index];
                const wrap = deps.flags[source_index].wrap;
                const wrapper_ref = deps.wrapper_refs[source_index];
                const _chunks = deps.chunks;

                for (parts) |part| {
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
                                chunk_meta.dynamic_imports.put(other_chunk_index, {}) catch unreachable;
                        }
                    }

                    // Remember what chunk each top-level symbol is declared in. Symbols
                    // with multiple declarations such as repeated "var" statements with
                    // the same name should already be marked as all being in a single
                    // chunk. In that case this will overwrite the same value below which
                    // is fine.
                    deps.symbols.assignChunkIndex(part.declared_symbols, @as(u32, @truncate(chunk_index)));

                    const used_refs = part.symbol_uses.keys();

                    // Record each symbol used in this part. This will later be matched up
                    // with our map of which chunk a given symbol is declared in to
                    // determine if the symbol needs to be imported from another chunk.
                    for (used_refs) |ref| {
                        const ref_to_use = brk: {
                            var ref_to_use = ref;
                            var symbol = deps.symbols.getConst(ref_to_use).?;

                            // Ignore unbound symbols
                            if (symbol.kind == .unbound)
                                continue;

                            // Ignore symbols that are going to be replaced by undefined
                            if (symbol.import_item_status == .missing)
                                continue;

                            // If this is imported from another file, follow the import
                            // reference and reference the symbol in that file instead
                            if (imports_to_bind.get(ref_to_use)) |import_data| {
                                ref_to_use = import_data.data.import_ref;
                                symbol = deps.symbols.getConst(ref_to_use).?;
                            } else if (wrap == .cjs and ref_to_use.eql(wrapper_ref)) {
                                // The only internal symbol that wrapped CommonJS files export
                                // is the wrapper itself.
                                continue;
                            }

                            // If this is an ES6 import from a CommonJS file, it will become a
                            // property access off the namespace symbol instead of a bare
                            // identifier. In that case we want to pull in the namespace symbol
                            // instead. The namespace symbol stores the result of "require()".
                            if (symbol.namespace_alias) |*namespace_alias| {
                                ref_to_use = namespace_alias.namespace_ref;
                            }
                            break :brk ref_to_use;
                        };

                        if (comptime Environment.allow_assert)
                            debug("Cross-chunk import: {s} {}", .{ deps.symbols.get(ref_to_use).?.original_name, ref_to_use });

                        // We must record this relationship even for symbols that are not
                        // imports. Due to code splitting, the definition of a symbol may
                        // be moved to a separate chunk than the use of a symbol even if
                        // the definition and use of that symbol are originally from the
                        // same source file.
                        imports.put(ref_to_use, {}) catch unreachable;
                    }
                }
            }

            // Include the exports if this is an entry point chunk
            if (chunk.content == .javascript) {
                if (chunk.entry_point.is_entry_point) {
                    const flags = deps.flags[chunk.entry_point.source_index];
                    if (flags.wrap != .cjs) {
                        const resolved_exports = deps.resolved_exports[chunk.entry_point.source_index];
                        const sorted_and_filtered_export_aliases = deps.sorted_and_filtered_export_aliases[chunk.entry_point.source_index];
                        for (sorted_and_filtered_export_aliases) |alias| {
                            const export_ = resolved_exports.get(alias).?;
                            var target_ref = export_.data.import_ref;

                            // If this is an import, then target what the import points to
                            if (deps.imports_to_bind[export_.data.source_index.get()].get(target_ref)) |import_data| {
                                target_ref = import_data.data.import_ref;
                            }

                            // If this is an ES6 import from a CommonJS file, it will become a
                            // property access off the namespace symbol instead of a bare
                            // identifier. In that case we want to pull in the namespace symbol
                            // instead. The namespace symbol stores the result of "require()".
                            if (deps.symbols.getConst(target_ref).?.namespace_alias) |namespace_alias| {
                                target_ref = namespace_alias.namespace_ref;
                            }
                            if (comptime Environment.allow_assert)
                                debug("Cross-chunk export: {s}", .{deps.symbols.get(target_ref).?.original_name});

                            imports.put(target_ref, {}) catch unreachable;
                        }
                    }

                    // Ensure "exports" is included if the current output format needs it
                    if (flags.force_include_exports_for_entry_point) {
                        imports.put(deps.wrapper_refs[chunk.entry_point.source_index], {}) catch unreachable;
                    }

                    // Include the wrapper if present
                    if (flags.wrap != .none) {
                        imports.put(deps.wrapper_refs[chunk.entry_point.source_index], {}) catch unreachable;
                    }
                }
            }
        }
    };

    fn computeCrossChunkDependenciesWithChunkMetas(c: *LinkerContext, chunks: []Chunk, chunk_metas: []ChunkMeta) !void {

        // Mark imported symbols as exported in the chunk from which they are declared
        for (chunks, chunk_metas, 0..) |*chunk, *chunk_meta, chunk_index| {
            if (chunk.content != .javascript) {
                continue;
            }
            var js = &chunk.content.javascript;

            // Find all uses in this chunk of symbols from other chunks
            for (chunk_meta.imports.keys()) |import_ref| {
                const symbol = c.graph.symbols.getConst(import_ref).?;

                // Ignore uses that aren't top-level symbols
                if (symbol.chunkIndex()) |other_chunk_index| {
                    if (@as(usize, other_chunk_index) != chunk_index) {
                        if (comptime Environment.allow_assert)
                            debug("Import name: {s} (in {s})", .{
                                symbol.original_name,
                                c.parse_graph.input_files.get(import_ref.sourceIndex()).source.path.text,
                            });

                        {
                            var entry = try js
                                .imports_from_other_chunks
                                .getOrPutValue(c.allocator, other_chunk_index, .{});
                            try entry.value_ptr.push(c.allocator, .{
                                .ref = import_ref,
                            });
                        }
                        _ = chunk_metas[other_chunk_index].exports.getOrPut(import_ref) catch unreachable;
                    } else {
                        debug("{s} imports from itself (chunk {d})", .{ symbol.original_name, chunk_index });
                    }
                }
            }

            // If this is an entry point, make sure we import all chunks belonging to
            // this entry point, even if there are no imports. We need to make sure
            // these chunks are evaluated for their side effects too.
            if (chunk.entry_point.is_entry_point) {
                for (chunks, 0..) |*other_chunk, other_chunk_index| {
                    if (other_chunk_index == chunk_index or other_chunk.content != .javascript) continue;

                    if (other_chunk.entry_bits.isSet(chunk.entry_point.entry_point_id)) {
                        _ = js.imports_from_other_chunks.getOrPutValue(
                            c.allocator,
                            @as(u32, @truncate(other_chunk_index)),
                            CrossChunkImport.Item.List{},
                        ) catch unreachable;
                    }
                }
            }

            // Make sure we also track dynamic cross-chunk imports. These need to be
            // tracked so we count them as dependencies of this chunk for the purpose
            // of hash calculation.
            if (chunk_meta.dynamic_imports.count() > 0) {
                const dynamic_chunk_indices = chunk_meta.dynamic_imports.keys();
                std.sort.pdq(Index.Int, dynamic_chunk_indices, {}, std.sort.asc(Index.Int));

                var imports = chunk.cross_chunk_imports.listManaged(c.allocator);
                defer chunk.cross_chunk_imports.update(imports);
                imports.ensureUnusedCapacity(dynamic_chunk_indices.len) catch unreachable;
                const prev_len = imports.items.len;
                imports.items.len += dynamic_chunk_indices.len;
                for (dynamic_chunk_indices, imports.items[prev_len..]) |dynamic_chunk_index, *item| {
                    item.* = .{
                        .import_kind = .dynamic,
                        .chunk_index = dynamic_chunk_index,
                    };
                }
            }
        }

        // Generate cross-chunk exports. These must be computed before cross-chunk
        // imports because of export alias renaming, which must consider all export
        // aliases simultaneously to avoid collisions.
        {
            bun.assert(chunk_metas.len == chunks.len);
            var r = renamer.ExportRenamer.init(c.allocator);
            defer r.deinit();
            debug("Generating cross-chunk exports", .{});

            var stable_ref_list = std.ArrayList(StableRef).init(c.allocator);
            defer stable_ref_list.deinit();

            for (chunks, chunk_metas) |*chunk, *chunk_meta| {
                if (chunk.content != .javascript) continue;

                var repr = &chunk.content.javascript;

                switch (c.options.output_format) {
                    .esm => {
                        c.sortedCrossChunkExportItems(
                            chunk_meta.exports,
                            &stable_ref_list,
                        );
                        var clause_items = BabyList(js_ast.ClauseItem).initCapacity(c.allocator, stable_ref_list.items.len) catch unreachable;
                        clause_items.len = @as(u32, @truncate(stable_ref_list.items.len));
                        repr.exports_to_other_chunks.ensureUnusedCapacity(c.allocator, stable_ref_list.items.len) catch unreachable;
                        r.clearRetainingCapacity();

                        for (stable_ref_list.items, clause_items.slice()) |stable_ref, *clause_item| {
                            const ref = stable_ref.ref;
                            const alias = if (c.options.minify_identifiers) try r.nextMinifiedName(c.allocator) else r.nextRenamedName(c.graph.symbols.get(ref).?.original_name);

                            clause_item.* = .{
                                .name = .{
                                    .ref = ref,
                                    .loc = Logger.Loc.Empty,
                                },
                                .alias = alias,
                                .alias_loc = Logger.Loc.Empty,
                                .original_name = "",
                            };

                            repr.exports_to_other_chunks.putAssumeCapacity(
                                ref,
                                alias,
                            );
                        }

                        if (clause_items.len > 0) {
                            var stmts = BabyList(js_ast.Stmt).initCapacity(c.allocator, 1) catch unreachable;
                            const export_clause = c.allocator.create(js_ast.S.ExportClause) catch unreachable;
                            export_clause.* = .{
                                .items = clause_items.slice(),
                                .is_single_line = true,
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
                    else => {},
                }
            }
        }

        // Generate cross-chunk imports. These must be computed after cross-chunk
        // exports because the export aliases must already be finalized so they can
        // be embedded in the generated import statements.
        {
            debug("Generating cross-chunk imports", .{});
            var list = CrossChunkImport.List.init(c.allocator);
            defer list.deinit();
            for (chunks) |*chunk| {
                if (chunk.content != .javascript) continue;
                var repr = &chunk.content.javascript;
                var cross_chunk_prefix_stmts = BabyList(js_ast.Stmt){};

                CrossChunkImport.sortedCrossChunkImports(&list, chunks, &repr.imports_from_other_chunks) catch unreachable;
                const cross_chunk_imports_input: []CrossChunkImport = list.items;
                var cross_chunk_imports = chunk.cross_chunk_imports;
                for (cross_chunk_imports_input) |cross_chunk_import| {
                    switch (c.options.output_format) {
                        .esm => {
                            const import_record_index = @as(u32, @intCast(cross_chunk_imports.len));

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

                            cross_chunk_imports.push(c.allocator, .{
                                .import_kind = .stmt,
                                .chunk_index = cross_chunk_import.chunk_index,
                            }) catch unreachable;
                            const import = c.allocator.create(js_ast.S.Import) catch unreachable;
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
                        else => {},
                    }
                }

                repr.cross_chunk_prefix_stmts = cross_chunk_prefix_stmts;
                chunk.cross_chunk_imports = cross_chunk_imports;
            }
        }
    }

    pub fn computeCrossChunkDependencies(c: *LinkerContext, chunks: []Chunk) !void {
        if (!c.graph.code_splitting) {
            // No need to compute cross-chunk dependencies if there can't be any
            return;
        }

        const chunk_metas = try c.allocator.alloc(ChunkMeta, chunks.len);
        for (chunk_metas) |*meta| {
            // these must be global allocator
            meta.* = .{
                .imports = ChunkMeta.Map.init(bun.default_allocator),
                .exports = ChunkMeta.Map.init(bun.default_allocator),
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

        {
            const cross_chunk_dependencies = c.allocator.create(CrossChunkDependencies) catch unreachable;
            defer c.allocator.destroy(cross_chunk_dependencies);

            cross_chunk_dependencies.* = .{
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

            c.parse_graph.pool.worker_pool.doPtr(
                c.allocator,
                &c.wait_group,
                cross_chunk_dependencies,
                CrossChunkDependencies.walk,
                chunks,
            ) catch unreachable;
        }

        try computeCrossChunkDependenciesWithChunkMetas(c, chunks, chunk_metas);
    }

    const GenerateChunkCtx = struct {
        wg: *sync.WaitGroup,
        c: *LinkerContext,
        chunks: []Chunk,
        chunk: *Chunk,
    };
    fn generateChunk(ctx: GenerateChunkCtx, chunk: *Chunk, chunk_index: usize) void {
        defer ctx.wg.finish();
        const worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();
        switch (chunk.content) {
            .javascript => postProcessJSChunk(ctx, worker, chunk, chunk_index) catch |err| Output.panic("TODO: handle error: {s}", .{@errorName(err)}),
            .css => postProcessCSSChunk(ctx, worker, chunk) catch |err| Output.panic("TODO: handle error: {s}", .{@errorName(err)}),
            .html => postProcessHTMLChunk(ctx, worker, chunk) catch |err| Output.panic("TODO: handle error: {s}", .{@errorName(err)}),
        }
    }

    // TODO: investigate if we need to parallelize this function
    // esbuild does parallelize it.
    fn renameSymbolsInChunk(
        c: *LinkerContext,
        allocator: std.mem.Allocator,
        chunk: *Chunk,
        files_in_order: []const u32,
    ) !renamer.Renamer {
        const trace = bun.perf.trace("Bundler.renameSymbolsInChunk");
        defer trace.end();
        const all_module_scopes = c.graph.ast.items(.module_scope);
        const all_flags: []const JSMeta.Flags = c.graph.meta.items(.flags);
        const all_parts: []const Part.List = c.graph.ast.items(.parts);
        const all_wrapper_refs: []const Ref = c.graph.ast.items(.wrapper_ref);
        const all_import_records: []const ImportRecord.List = c.graph.ast.items(.import_records);

        var reserved_names = try renamer.computeInitialReservedNames(allocator, c.options.output_format);
        for (files_in_order) |source_index| {
            renamer.computeReservedNamesForScope(&all_module_scopes[source_index], &c.graph.symbols, &reserved_names, allocator);
        }

        var sorted_imports_from_other_chunks: std.ArrayList(StableRef) = brk: {
            var list = std.ArrayList(StableRef).init(allocator);
            var count: u32 = 0;
            const imports_from_other_chunks = chunk.content.javascript.imports_from_other_chunks.values();
            for (imports_from_other_chunks) |item| {
                count += item.len;
            }

            list.ensureTotalCapacityPrecise(count) catch unreachable;
            list.items.len = count;
            var remain = list.items;
            const stable_source_indices = c.graph.stable_source_indices;
            for (imports_from_other_chunks) |item| {
                for (item.slice()) |ref| {
                    remain[0] = StableRef{
                        .stable_source_index = stable_source_indices[ref.ref.sourceIndex()],
                        .ref = ref.ref,
                    };
                    remain = remain[1..];
                }
            }

            std.sort.pdq(StableRef, list.items, {}, StableRef.isLessThan);
            break :brk list;
        };
        defer sorted_imports_from_other_chunks.deinit();

        if (c.options.minify_identifiers) {
            const first_top_level_slots: js_ast.SlotCounts = brk: {
                var slots = js_ast.SlotCounts{};
                const nested_scope_slot_counts = c.graph.ast.items(.nested_scope_slot_counts);
                for (files_in_order) |i| {
                    slots.unionMax(nested_scope_slot_counts[i]);
                }
                break :brk slots;
            };

            var minify_renamer = try MinifyRenamer.init(allocator, c.graph.symbols, first_top_level_slots, reserved_names);

            var top_level_symbols = renamer.StableSymbolCount.Array.init(allocator);
            defer top_level_symbols.deinit();

            var top_level_symbols_all = renamer.StableSymbolCount.Array.init(allocator);

            const stable_source_indices = c.graph.stable_source_indices;
            var freq = js_ast.CharFreq{
                .freqs = [_]i32{0} ** 64,
            };
            const ast_flags_list = c.graph.ast.items(.flags);

            var capacity = sorted_imports_from_other_chunks.items.len;
            {
                const char_freqs = c.graph.ast.items(.char_freq);

                for (files_in_order) |source_index| {
                    if (ast_flags_list[source_index].has_char_freq) {
                        freq.include(char_freqs[source_index]);
                    }
                }
            }

            const exports_ref_list = c.graph.ast.items(.exports_ref);
            const module_ref_list = c.graph.ast.items(.module_ref);
            const parts_list = c.graph.ast.items(.parts);

            for (files_in_order) |source_index| {
                const ast_flags = ast_flags_list[source_index];
                const uses_exports_ref = ast_flags.uses_exports_ref;
                const uses_module_ref = ast_flags.uses_module_ref;
                const exports_ref = exports_ref_list[source_index];
                const module_ref = module_ref_list[source_index];
                const parts = parts_list[source_index];

                top_level_symbols.clearRetainingCapacity();

                if (uses_exports_ref) {
                    try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, exports_ref, 1, stable_source_indices);
                }
                if (uses_module_ref) {
                    try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, module_ref, 1, stable_source_indices);
                }

                for (parts.slice()) |part| {
                    if (!part.is_live) {
                        continue;
                    }

                    try minify_renamer.accumulateSymbolUseCounts(&top_level_symbols, part.symbol_uses, stable_source_indices);

                    for (part.declared_symbols.refs()) |declared_ref| {
                        try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, declared_ref, 1, stable_source_indices);
                    }
                }

                std.sort.pdq(renamer.StableSymbolCount, top_level_symbols.items, {}, StableSymbolCount.lessThan);
                capacity += top_level_symbols.items.len;
                top_level_symbols_all.appendSlice(top_level_symbols.items) catch unreachable;
            }

            top_level_symbols.clearRetainingCapacity();
            for (sorted_imports_from_other_chunks.items) |stable_ref| {
                try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, stable_ref.ref, 1, stable_source_indices);
            }
            top_level_symbols_all.appendSlice(top_level_symbols.items) catch unreachable;
            try minify_renamer.allocateTopLevelSymbolSlots(top_level_symbols_all);

            var minifier = freq.compile(allocator);
            try minify_renamer.assignNamesByFrequency(&minifier);

            return minify_renamer.toRenamer();
        }

        var r = try renamer.NumberRenamer.init(
            allocator,
            allocator,
            c.graph.symbols,
            reserved_names,
        );
        for (sorted_imports_from_other_chunks.items) |stable_ref| {
            r.addTopLevelSymbol(stable_ref.ref);
        }

        var sorted_ = std.ArrayList(u32).init(r.temp_allocator);
        var sorted = &sorted_;
        defer sorted.deinit();

        for (files_in_order) |source_index| {
            const wrap = all_flags[source_index].wrap;
            const parts: []const Part = all_parts[source_index].slice();

            switch (wrap) {
                // Modules wrapped in a CommonJS closure look like this:
                //
                //   // foo.js
                //   var require_foo = __commonJS((exports, module) => {
                //     exports.foo = 123;
                //   });
                //
                // The symbol "require_foo" is stored in "file.ast.WrapperRef". We want
                // to be able to minify everything inside the closure without worrying
                // about collisions with other CommonJS modules. Set up the scopes such
                // that it appears as if the file was structured this way all along. It's
                // not completely accurate (e.g. we don't set the parent of the module
                // scope to this new top-level scope) but it's good enough for the
                // renaming code.
                .cjs => {
                    r.addTopLevelSymbol(all_wrapper_refs[source_index]);

                    // External import statements will be hoisted outside of the CommonJS
                    // wrapper if the output format supports import statements. We need to
                    // add those symbols to the top-level scope to avoid causing name
                    // collisions. This code special-cases only those symbols.
                    if (c.options.output_format.keepES6ImportExportSyntax()) {
                        const import_records = all_import_records[source_index].slice();
                        for (parts) |*part| {
                            for (part.stmts) |stmt| {
                                switch (stmt.data) {
                                    .s_import => |import| {
                                        if (!import_records[import.import_record_index].source_index.isValid()) {
                                            r.addTopLevelSymbol(import.namespace_ref);
                                            if (import.default_name) |default_name| {
                                                if (default_name.ref) |ref| {
                                                    r.addTopLevelSymbol(ref);
                                                }
                                            }

                                            for (import.items) |*item| {
                                                if (item.name.ref) |ref| {
                                                    r.addTopLevelSymbol(ref);
                                                }
                                            }
                                        }
                                    },
                                    .s_export_star => |export_| {
                                        if (!import_records[export_.import_record_index].source_index.isValid()) {
                                            r.addTopLevelSymbol(export_.namespace_ref);
                                        }
                                    },
                                    .s_export_from => |export_| {
                                        if (!import_records[export_.import_record_index].source_index.isValid()) {
                                            r.addTopLevelSymbol(export_.namespace_ref);

                                            for (export_.items) |*item| {
                                                if (item.name.ref) |ref| {
                                                    r.addTopLevelSymbol(ref);
                                                }
                                            }
                                        }
                                    },
                                    else => {},
                                }
                            }
                        }
                    }
                    r.assignNamesRecursiveWithNumberScope(&r.root, &all_module_scopes[source_index], source_index, sorted);
                    continue;
                },

                // Modules wrapped in an ESM closure look like this:
                //
                //   // foo.js
                //   var foo, foo_exports = {};
                //   __export(foo_exports, {
                //     foo: () => foo
                //   });
                //   let init_foo = __esm(() => {
                //     foo = 123;
                //   });
                //
                // The symbol "init_foo" is stored in "file.ast.WrapperRef". We need to
                // minify everything inside the closure without introducing a new scope
                // since all top-level variables will be hoisted outside of the closure.
                .esm => {
                    r.addTopLevelSymbol(all_wrapper_refs[source_index]);
                },

                else => {},
            }

            for (parts) |*part| {
                if (!part.is_live) continue;

                r.addTopLevelDeclaredSymbols(part.declared_symbols);
                for (part.scopes) |scope| {
                    r.assignNamesRecursiveWithNumberScope(&r.root, scope, source_index, sorted);
                }
                r.number_scope_pool.hive.used = @TypeOf(r.number_scope_pool.hive.used).initEmpty();
            }
        }

        return r.toRenamer();
    }

    fn generateJSRenamer(ctx: GenerateChunkCtx, chunk: *Chunk, chunk_index: usize) void {
        defer ctx.wg.finish();
        var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();
        switch (chunk.content) {
            .javascript => generateJSRenamer_(ctx, worker, chunk, chunk_index),
            .css => {},
            .html => {},
        }
    }

    fn generateJSRenamer_(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk, chunk_index: usize) void {
        _ = chunk_index;
        chunk.renamer = ctx.c.renameSymbolsInChunk(
            worker.allocator,
            chunk,
            chunk.content.javascript.files_in_chunk_order,
        ) catch @panic("TODO: handle error");
    }

    fn generateCompileResultForCssChunk(task: *ThreadPoolLib.Task) void {
        const part_range: *const PendingPartRange = @fieldParentPtr("task", task);
        const ctx = part_range.ctx;
        defer ctx.wg.finish();
        var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();

        const prev_action = if (Environment.isDebug) bun.crash_handler.current_action;
        defer if (Environment.isDebug) {
            bun.crash_handler.current_action = prev_action;
        };
        if (Environment.isDebug) bun.crash_handler.current_action = .{ .bundle_generate_chunk = .{
            .chunk = ctx.chunk,
            .context = ctx.c,
            .part_range = &part_range.part_range,
        } };

        ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForCssChunkImpl(worker, ctx.c, ctx.chunk, part_range.i);
    }

    fn generateCompileResultForHtmlChunk(task: *ThreadPoolLib.Task) void {
        const part_range: *const PendingPartRange = @fieldParentPtr("task", task);
        const ctx = part_range.ctx;
        defer ctx.wg.finish();
        var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();

        ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForHTMLChunkImpl(worker, ctx.c, ctx.chunk, ctx.chunks);
    }

    fn generateCompileResultForCssChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, imports_in_chunk_index: u32) CompileResult {
        const trace = bun.perf.trace("Bundler.generateCodeForFileInChunkCss");
        defer trace.end();

        var arena = &worker.temporary_arena;
        var buffer_writer = js_printer.BufferWriter.init(worker.allocator) catch unreachable;
        defer _ = arena.reset(.retain_capacity);

        const css_import = chunk.content.css.imports_in_chunk_in_order.at(imports_in_chunk_index);
        const css: *const bun.css.BundlerStyleSheet = &chunk.content.css.asts[imports_in_chunk_index];
        // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
        const symbols = &c.graph.symbols;

        switch (css_import.kind) {
            .layers => {
                const printer_options = bun.css.PrinterOptions{
                    // TODO: make this more configurable
                    .minify = c.options.minify_whitespace,
                    .targets = bun.css.Targets.forBundlerTarget(c.options.target),
                };
                _ = switch (css.toCssWithWriter(
                    worker.allocator,
                    &buffer_writer,
                    printer_options,
                    .{
                        .import_records = &css_import.condition_import_records,
                        .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                        .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                    },
                    &c.mangled_props,
                    // layer does not need symbols i think
                    symbols,
                )) {
                    .result => {},
                    .err => {
                        return CompileResult{
                            .css = .{
                                .result = .{ .err = error.PrintError },
                                .source_index = Index.invalid.get(),
                            },
                        };
                    },
                };
                return CompileResult{
                    .css = .{
                        .result = .{ .result = buffer_writer.getWritten() },
                        .source_index = Index.invalid.get(),
                    },
                };
            },
            .external_path => {
                var import_records = BabyList(ImportRecord).init(css_import.condition_import_records.sliceConst());
                const printer_options = bun.css.PrinterOptions{
                    // TODO: make this more configurable
                    .minify = c.options.minify_whitespace,
                    .targets = bun.css.Targets.forBundlerTarget(c.options.target),
                };
                _ = switch (css.toCssWithWriter(
                    worker.allocator,
                    &buffer_writer,
                    printer_options,
                    .{
                        .import_records = &import_records,
                        .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                        .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                    },
                    &c.mangled_props,
                    // external_path does not need symbols i think
                    symbols,
                )) {
                    .result => {},
                    .err => {
                        return CompileResult{
                            .css = .{
                                .result = .{ .err = error.PrintError },
                                .source_index = Index.invalid.get(),
                            },
                        };
                    },
                };
                return CompileResult{
                    .css = .{
                        .result = .{ .result = buffer_writer.getWritten() },

                        .source_index = Index.invalid.get(),
                    },
                };
            },
            .source_index => |idx| {
                const printer_options = bun.css.PrinterOptions{
                    .targets = bun.css.Targets.forBundlerTarget(c.options.target),
                    // TODO: make this more configurable
                    .minify = c.options.minify_whitespace or c.options.minify_syntax or c.options.minify_identifiers,
                };
                _ = switch (css.toCssWithWriter(
                    worker.allocator,
                    &buffer_writer,
                    printer_options,
                    .{
                        .import_records = &c.graph.ast.items(.import_records)[idx.get()],
                        .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                        .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                    },
                    &c.mangled_props,
                    symbols,
                )) {
                    .result => {},
                    .err => {
                        return CompileResult{
                            .css = .{
                                .result = .{ .err = error.PrintError },
                                .source_index = idx.get(),
                            },
                        };
                    },
                };
                return CompileResult{
                    .css = .{
                        .result = .{ .result = buffer_writer.getWritten() },
                        .source_index = idx.get(),
                    },
                };
            },
        }
    }

    fn generateCompileResultForJSChunk(task: *ThreadPoolLib.Task) void {
        const part_range: *const PendingPartRange = @fieldParentPtr("task", task);
        const ctx = part_range.ctx;
        defer ctx.wg.finish();
        var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", ctx.c));
        defer worker.unget();

        const prev_action = if (Environment.isDebug) bun.crash_handler.current_action;
        defer if (Environment.isDebug) {
            bun.crash_handler.current_action = prev_action;
        };
        if (Environment.isDebug) bun.crash_handler.current_action = .{ .bundle_generate_chunk = .{
            .chunk = ctx.chunk,
            .context = ctx.c,
            .part_range = &part_range.part_range,
        } };

        if (Environment.isDebug) {
            const path = ctx.c.parse_graph.input_files.items(.source)[part_range.part_range.source_index.get()].path;
            if (bun.CLI.debug_flags.hasPrintBreakpoint(path)) {
                @breakpoint();
            }
        }

        ctx.chunk.compile_results_for_chunk[part_range.i] = generateCompileResultForJSChunkImpl(worker, ctx.c, ctx.chunk, part_range.part_range);
    }

    fn generateCompileResultForJSChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, part_range: PartRange) CompileResult {
        const trace = bun.perf.trace("Bundler.generateCodeForFileInChunkJS");
        defer trace.end();

        // Client bundles for Bake must be globally allocated,
        // as it must outlive the bundle task.
        const allocator = if (c.dev_server) |dev|
            if (c.parse_graph.ast.items(.target)[part_range.source_index.get()].bakeGraph() == .client)
                dev.allocator
            else
                default_allocator
        else
            default_allocator;

        var arena = &worker.temporary_arena;
        var buffer_writer = js_printer.BufferWriter.init(allocator) catch bun.outOfMemory();
        defer _ = arena.reset(.retain_capacity);
        worker.stmt_list.reset();

        var runtime_scope: *Scope = &c.graph.ast.items(.module_scope)[c.graph.files.items(.input_file)[Index.runtime.value].get()];
        var runtime_members = &runtime_scope.members;
        const toCommonJSRef = c.graph.symbols.follow(runtime_members.get("__toCommonJS").?.ref);
        const toESMRef = c.graph.symbols.follow(runtime_members.get("__toESM").?.ref);
        const runtimeRequireRef = if (c.options.output_format == .cjs) null else c.graph.symbols.follow(runtime_members.get("__require").?.ref);

        const result = c.generateCodeForFileInChunkJS(
            &buffer_writer,
            chunk.renamer,
            chunk,
            part_range,
            toCommonJSRef,
            toESMRef,
            runtimeRequireRef,
            &worker.stmt_list,
            worker.allocator,
            arena.allocator(),
        );

        return .{
            .javascript = .{
                .result = result,
                .source_index = part_range.source_index.get(),
            },
        };
    }

    const PrepareCssAstTask = struct {
        task: ThreadPoolLib.Task,
        chunk: *Chunk,
        linker: *LinkerContext,
        wg: *sync.WaitGroup,
    };

    fn prepareCssAstsForChunk(task: *ThreadPoolLib.Task) void {
        const prepare_css_asts: *const PrepareCssAstTask = @fieldParentPtr("task", task);
        defer prepare_css_asts.wg.finish();
        var worker = ThreadPool.Worker.get(@fieldParentPtr("linker", prepare_css_asts.linker));
        defer worker.unget();

        prepareCssAstsForChunkImpl(prepare_css_asts.linker, prepare_css_asts.chunk, worker.allocator);
    }

    fn prepareCssAstsForChunkImpl(c: *LinkerContext, chunk: *Chunk, allocator: std.mem.Allocator) void {
        const asts: []const ?*bun.css.BundlerStyleSheet = c.graph.ast.items(.css);

        // Prepare CSS asts
        // Remove duplicate rules across files. This must be done in serial, not
        // in parallel, and must be done from the last rule to the first rule.
        {
            var i: usize = chunk.content.css.imports_in_chunk_in_order.len;
            while (i != 0) {
                i -= 1;
                const entry = chunk.content.css.imports_in_chunk_in_order.mut(i);
                switch (entry.kind) {
                    .layers => |layers| {
                        const len = layers.inner().len;
                        var rules = bun.css.BundlerCssRuleList{};
                        if (len > 0) {
                            rules.v.append(allocator, bun.css.BundlerCssRule{
                                .layer_statement = bun.css.LayerStatementRule{
                                    .names = bun.css.SmallList(bun.css.LayerName, 1).fromBabyListNoDeinit(layers.inner().*),
                                    .loc = bun.css.Location.dummy(),
                                },
                            }) catch bun.outOfMemory();
                        }
                        var ast = bun.css.BundlerStyleSheet{
                            .rules = rules,
                            .sources = .{},
                            .source_map_urls = .{},
                            .license_comments = .{},
                            .options = bun.css.ParserOptions.default(allocator, null),
                            .composes = .{},
                        };
                        wrapRulesWithConditions(&ast, allocator, &entry.conditions);
                        chunk.content.css.asts[i] = ast;
                    },
                    .external_path => |*p| {
                        var conditions: ?*bun.css.ImportConditions = null;
                        if (entry.conditions.len > 0) {
                            conditions = entry.conditions.mut(0);
                            entry.condition_import_records.push(
                                allocator,
                                bun.ImportRecord{ .kind = .at, .path = p.*, .range = Logger.Range{} },
                            ) catch bun.outOfMemory();

                            // Handling a chain of nested conditions is complicated. We can't
                            // necessarily join them together because a) there may be multiple
                            // layer names and b) layer names are only supposed to be inserted
                            // into the layer order if the parent conditions are applied.
                            //
                            // Instead we handle them by preserving the "@import" nesting using
                            // imports of data URL stylesheets. This may seem strange but I think
                            // this is the only way to do this in CSS.
                            var j: usize = entry.conditions.len;
                            while (j != 1) {
                                j -= 1;

                                const ast_import = bun.css.BundlerStyleSheet{
                                    .options = bun.css.ParserOptions.default(allocator, null),
                                    .license_comments = .{},
                                    .sources = .{},
                                    .source_map_urls = .{},
                                    .rules = rules: {
                                        var rules = bun.css.BundlerCssRuleList{};
                                        var import_rule = bun.css.ImportRule{
                                            .url = p.pretty,
                                            .import_record_idx = entry.condition_import_records.len,
                                            .loc = bun.css.Location.dummy(),
                                        };
                                        import_rule.conditionsMut().* = entry.conditions.at(j).*;
                                        rules.v.append(allocator, bun.css.BundlerCssRule{
                                            .import = import_rule,
                                        }) catch bun.outOfMemory();
                                        break :rules rules;
                                    },
                                    .composes = .{},
                                };

                                const printer_options = bun.css.PrinterOptions{
                                    .targets = bun.css.Targets.forBundlerTarget(c.options.target),
                                    // TODO: make this more configurable
                                    .minify = c.options.minify_whitespace or c.options.minify_syntax or c.options.minify_identifiers,
                                };

                                const print_result = switch (ast_import.toCss(
                                    allocator,
                                    printer_options,
                                    .{
                                        .import_records = &entry.condition_import_records,
                                        .ast_urls_for_css = c.parse_graph.ast.items(.url_for_css),
                                        .ast_unique_key_for_additional_file = c.parse_graph.input_files.items(.unique_key_for_additional_file),
                                    },
                                    &c.mangled_props,
                                    &c.graph.symbols,
                                )) {
                                    .result => |v| v,
                                    .err => |e| {
                                        c.log.addErrorFmt(null, Loc.Empty, c.allocator, "Error generating CSS for import: {}", .{e}) catch bun.outOfMemory();
                                        continue;
                                    },
                                };
                                p.* = bun.fs.Path.init(DataURL.encodeStringAsShortestDataURL(allocator, "text/css", std.mem.trim(u8, print_result.code, " \n\r\t")));
                            }
                        }

                        var empty_conditions = bun.css.ImportConditions{};
                        const actual_conditions = if (conditions) |cc| cc else &empty_conditions;

                        entry.condition_import_records.push(allocator, bun.ImportRecord{
                            .kind = .at,
                            .path = p.*,
                            .range = Logger.Range.none,
                        }) catch bun.outOfMemory();

                        chunk.content.css.asts[i] = bun.css.BundlerStyleSheet{
                            .rules = rules: {
                                var rules = bun.css.BundlerCssRuleList{};
                                var import_rule = bun.css.ImportRule.fromUrlAndImportRecordIdx(p.pretty, entry.condition_import_records.len);
                                import_rule.conditionsMut().* = actual_conditions.*;
                                rules.v.append(allocator, bun.css.BundlerCssRule{
                                    .import = import_rule,
                                }) catch bun.outOfMemory();
                                break :rules rules;
                            },
                            .sources = .{},
                            .source_map_urls = .{},
                            .license_comments = .{},
                            .options = bun.css.ParserOptions.default(allocator, null),
                            .composes = .{},
                        };
                    },
                    .source_index => |source_index| {
                        // Multiple imports may refer to the same file/AST, but they
                        // may wrap or modify the AST in different ways. So we need
                        // to make a shallow copy and be careful not to modify shared
                        // references.
                        var ast = ast: {
                            const original_stylesheet = asts[source_index.get()].?;
                            chunk.content.css.asts[i] = original_stylesheet.*;
                            break :ast &chunk.content.css.asts[i];
                        };

                        filter: {
                            // Filter out "@charset", "@import", and leading "@layer" rules
                            // TODO: we are doing simple version rn, only @import
                            for (ast.rules.v.items, 0..) |*rule, ruleidx| {
                                // if ((rule.* == .import and import_records[source_index.get()].at(rule.import.import_record_idx).is_internal) or rule.* == .ignored) {} else {
                                if (rule.* == .import or rule.* == .ignored) {} else {
                                    // It's okay to do this because AST is allocated into arena
                                    const reslice = ast.rules.v.items[ruleidx..];
                                    ast.rules.v = .{
                                        .items = reslice,
                                        .capacity = ast.rules.v.capacity - (ast.rules.v.items.len - reslice.len),
                                    };
                                    break :filter;
                                }
                            }
                            ast.rules.v.items.len = 0;
                        }

                        wrapRulesWithConditions(ast, allocator, &entry.conditions);
                        // TODO: Remove top-level duplicate rules across files
                    },
                }
            }
        }
    }

    fn wrapRulesWithConditions(
        ast: *bun.css.BundlerStyleSheet,
        temp_allocator: std.mem.Allocator,
        conditions: *const BabyList(bun.css.ImportConditions),
    ) void {
        var dummy_import_records = bun.BabyList(bun.ImportRecord){};
        defer bun.debugAssert(dummy_import_records.len == 0);

        var i: usize = conditions.len;
        while (i > 0) {
            i -= 1;
            const item = conditions.at(i);

            // Generate "@layer" wrappers. Note that empty "@layer" rules still have
            // a side effect (they set the layer order) so they cannot be removed.
            if (item.layer) |l| {
                const layer = l.v;
                var do_block_rule = true;
                if (ast.rules.v.items.len == 0) {
                    if (l.v == null) {
                        // Omit an empty "@layer {}" entirely
                        continue;
                    } else {
                        // Generate "@layer foo;" instead of "@layer foo {}"
                        ast.rules.v = .{};
                        do_block_rule = false;
                    }
                }

                ast.rules = brk: {
                    var new_rules = bun.css.BundlerCssRuleList{};
                    new_rules.v.append(
                        temp_allocator,
                        if (do_block_rule) .{ .layer_block = bun.css.BundlerLayerBlockRule{
                            .name = layer,
                            .rules = ast.rules,
                            .loc = bun.css.Location.dummy(),
                        } } else .{
                            .layer_statement = .{
                                .names = if (layer) |ly| bun.css.SmallList(bun.css.LayerName, 1).withOne(ly) else .{},
                                .loc = bun.css.Location.dummy(),
                            },
                        },
                    ) catch bun.outOfMemory();

                    break :brk new_rules;
                };
            }

            // Generate "@supports" wrappers. This is not done if the rule block is
            // empty because empty "@supports" rules have no effect.
            if (ast.rules.v.items.len > 0) {
                if (item.supports) |*supports| {
                    ast.rules = brk: {
                        var new_rules = bun.css.BundlerCssRuleList{};
                        new_rules.v.append(temp_allocator, .{
                            .supports = bun.css.BundlerSupportsRule{
                                .condition = supports.cloneWithImportRecords(
                                    temp_allocator,
                                    &dummy_import_records,
                                ),
                                .rules = ast.rules,
                                .loc = bun.css.Location.dummy(),
                            },
                        }) catch bun.outOfMemory();
                        break :brk new_rules;
                    };
                }
            }

            // Generate "@media" wrappers. This is not done if the rule block is
            // empty because empty "@media" rules have no effect.
            if (ast.rules.v.items.len > 0 and item.media.media_queries.items.len > 0) {
                ast.rules = brk: {
                    var new_rules = bun.css.BundlerCssRuleList{};
                    new_rules.v.append(temp_allocator, .{
                        .media = bun.css.BundlerMediaRule{
                            .query = item.media.cloneWithImportRecords(temp_allocator, &dummy_import_records),
                            .rules = ast.rules,
                            .loc = bun.css.Location.dummy(),
                        },
                    }) catch bun.outOfMemory();
                    break :brk new_rules;
                };
            }
        }
    }

    /// Rrewrite the HTML with the following transforms:
    /// 1. Remove all <script> and <link> tags which were not marked as
    ///    external. This is defined by the source_index on the ImportRecord,
    ///    when it's not Index.invalid then we update it accordingly. This will
    ///    need to be a reference to the chunk or asset.
    /// 2. For all other non-external URLs, update the "src" or "href"
    ///    attribute to point to the asset's unique key. Later, when joining
    ///    chunks, we will rewrite these to their final URL or pathname,
    ///    including the public_path.
    /// 3. If a JavaScript chunk exists, add a <script type="module" crossorigin> tag that contains
    ///    the JavaScript for the entry point which uses the "src" attribute
    ///    to point to the JavaScript chunk's unique key.
    /// 4. If a CSS chunk exists, add a <link rel="stylesheet" href="..." crossorigin> tag that contains
    ///    the CSS for the entry point which uses the "href" attribute to point to the
    ///    CSS chunk's unique key.
    /// 5. For each imported module or chunk within the JavaScript code, add
    ///    a <link rel="modulepreload" href="..." crossorigin> tag that
    ///    points to the module or chunk's unique key so that we tell the
    ///    browser to preload the user's code.
    fn generateCompileResultForHTMLChunkImpl(worker: *ThreadPool.Worker, c: *LinkerContext, chunk: *Chunk, chunks: []Chunk) CompileResult {
        const parse_graph = c.parse_graph;
        const input_files = parse_graph.input_files.slice();
        const sources = input_files.items(.source);
        const import_records = c.graph.ast.items(.import_records);

        const HTMLLoader = struct {
            linker: *LinkerContext,
            source_index: Index.Int,
            import_records: []const ImportRecord,
            log: *Logger.Log,
            allocator: std.mem.Allocator,
            current_import_record_index: u32 = 0,
            chunk: *Chunk,
            chunks: []Chunk,
            minify_whitespace: bool,
            output: std.ArrayList(u8),
            end_tag_indices: struct {
                head: ?u32 = 0,
                body: ?u32 = 0,
                html: ?u32 = 0,
            },
            added_head_tags: bool,

            pub fn onWriteHTML(this: *@This(), bytes: []const u8) void {
                this.output.appendSlice(bytes) catch bun.outOfMemory();
            }

            pub fn onHTMLParseError(_: *@This(), err: []const u8) void {
                Output.panic("Parsing HTML during replacement phase errored, which should never happen since the first pass succeeded: {s}", .{err});
            }

            pub fn onTag(this: *@This(), element: *lol.Element, _: []const u8, url_attribute: []const u8, _: ImportKind) void {
                if (this.current_import_record_index >= this.import_records.len) {
                    Output.panic("Assertion failure in HTMLLoader.onTag: current_import_record_index ({d}) >= import_records.len ({d})", .{ this.current_import_record_index, this.import_records.len });
                }

                const import_record: *const ImportRecord = &this.import_records[this.current_import_record_index];
                this.current_import_record_index += 1;
                const unique_key_for_additional_files = if (import_record.source_index.isValid())
                    this.linker.parse_graph.input_files.items(.unique_key_for_additional_file)[import_record.source_index.get()]
                else
                    "";
                const loader: Loader = if (import_record.source_index.isValid())
                    this.linker.parse_graph.input_files.items(.loader)[import_record.source_index.get()]
                else
                    .file;

                if (import_record.is_external_without_side_effects) {
                    debug("Leaving external import: {s}", .{import_record.path.text});
                    return;
                }

                if (this.linker.dev_server != null) {
                    if (unique_key_for_additional_files.len > 0) {
                        element.setAttribute(url_attribute, unique_key_for_additional_files) catch bun.outOfMemory();
                    } else if (import_record.path.is_disabled or loader.isJavaScriptLike() or loader.isCSS()) {
                        element.remove();
                    } else {
                        element.setAttribute(url_attribute, import_record.path.pretty) catch bun.outOfMemory();
                    }
                    return;
                }

                if (import_record.source_index.isInvalid()) {
                    debug("Leaving import with invalid source index: {s}", .{import_record.path.text});
                    return;
                }

                if (loader.isJavaScriptLike() or loader.isCSS()) {
                    // Remove the original non-external tags
                    element.remove();
                    return;
                }
                if (unique_key_for_additional_files.len > 0) {
                    // Replace the external href/src with the unique key so that we later will rewrite it to the final URL or pathname
                    element.setAttribute(url_attribute, unique_key_for_additional_files) catch bun.outOfMemory();
                    return;
                }
            }

            pub fn onHeadTag(this: *@This(), element: *lol.Element) bool {
                element.onEndTag(endHeadTagHandler, this) catch return true;
                return false;
            }

            pub fn onHtmlTag(this: *@This(), element: *lol.Element) bool {
                element.onEndTag(endHtmlTagHandler, this) catch return true;
                return false;
            }

            pub fn onBodyTag(this: *@This(), element: *lol.Element) bool {
                element.onEndTag(endBodyTagHandler, this) catch return true;
                return false;
            }

            /// This is called for head, body, and html; whichever ends up coming first.
            fn addHeadTags(this: *@This(), endTag: *lol.EndTag) !void {
                if (this.added_head_tags) return;
                this.added_head_tags = true;

                var html_appender = std.heap.stackFallback(256, bun.default_allocator);
                const allocator = html_appender.get();
                const slices = this.getHeadTags(allocator);
                defer for (slices.slice()) |slice|
                    allocator.free(slice);
                for (slices.slice()) |slice|
                    try endTag.before(slice, true);
            }

            fn getHeadTags(this: *@This(), allocator: std.mem.Allocator) std.BoundedArray([]const u8, 2) {
                var array: std.BoundedArray([]const u8, 2) = .{};
                // Put CSS before JS to reduce changes of flash of unstyled content
                if (this.chunk.getCSSChunkForHTML(this.chunks)) |css_chunk| {
                    const link_tag = std.fmt.allocPrintZ(allocator, "<link rel=\"stylesheet\" crossorigin href=\"{s}\">", .{css_chunk.unique_key}) catch bun.outOfMemory();
                    array.appendAssumeCapacity(link_tag);
                }
                if (this.chunk.getJSChunkForHTML(this.chunks)) |js_chunk| {
                    // type="module" scripts do not block rendering, so it is okay to put them in head
                    const script = std.fmt.allocPrintZ(allocator, "<script type=\"module\" crossorigin src=\"{s}\"></script>", .{js_chunk.unique_key}) catch bun.outOfMemory();
                    array.appendAssumeCapacity(script);
                }
                return array;
            }

            fn endHeadTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.C) lol.Directive {
                const this: *@This() = @alignCast(@ptrCast(opaque_this.?));
                if (this.linker.dev_server == null) {
                    this.addHeadTags(end) catch return .stop;
                } else {
                    this.end_tag_indices.head = @intCast(this.output.items.len);
                }
                return .@"continue";
            }

            fn endBodyTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.C) lol.Directive {
                const this: *@This() = @alignCast(@ptrCast(opaque_this.?));
                if (this.linker.dev_server == null) {
                    this.addHeadTags(end) catch return .stop;
                } else {
                    this.end_tag_indices.body = @intCast(this.output.items.len);
                }
                return .@"continue";
            }

            fn endHtmlTagHandler(end: *lol.EndTag, opaque_this: ?*anyopaque) callconv(.C) lol.Directive {
                const this: *@This() = @alignCast(@ptrCast(opaque_this.?));
                if (this.linker.dev_server == null) {
                    this.addHeadTags(end) catch return .stop;
                } else {
                    this.end_tag_indices.html = @intCast(this.output.items.len);
                }
                return .@"continue";
            }
        };

        // HTML bundles for dev server must be allocated to it, as it must outlive
        // the bundle task. See `DevServer.RouteBundle.HTML.bundled_html_text`
        const output_allocator = if (c.dev_server) |dev| dev.allocator else worker.allocator;

        var html_loader: HTMLLoader = .{
            .linker = c,
            .source_index = chunk.entry_point.source_index,
            .import_records = import_records[chunk.entry_point.source_index].slice(),
            .log = c.log,
            .allocator = worker.allocator,
            .minify_whitespace = c.options.minify_whitespace,
            .chunk = chunk,
            .chunks = chunks,
            .output = std.ArrayList(u8).init(output_allocator),
            .current_import_record_index = 0,
            .end_tag_indices = .{
                .html = null,
                .body = null,
                .head = null,
            },
            .added_head_tags = false,
        };

        HTMLScanner.HTMLProcessor(HTMLLoader, true).run(
            &html_loader,
            sources[chunk.entry_point.source_index].contents,
        ) catch bun.outOfMemory();

        // There are some cases where invalid HTML will make it so </head> is
        // never emitted, even if the literal text DOES appear. These cases are
        // along the lines of having a self-closing tag for a non-self closing
        // element. In this case, head_end_tag_index will be 0, and a simple
        // search through the page is done to find the "</head>"
        // See https://github.com/oven-sh/bun/issues/17554
        const script_injection_offset: u32 = if (c.dev_server != null) brk: {
            if (html_loader.end_tag_indices.head) |head|
                break :brk head;
            if (bun.strings.indexOf(html_loader.output.items, "</head>")) |head|
                break :brk @intCast(head);
            if (html_loader.end_tag_indices.body) |body|
                break :brk body;
            if (html_loader.end_tag_indices.html) |html|
                break :brk html;
            break :brk @intCast(html_loader.output.items.len); // inject at end of file.
        } else brk: {
            if (!html_loader.added_head_tags) {
                @branchHint(.cold); // this is if the document is missing all head, body, and html elements.
                var html_appender = std.heap.stackFallback(256, bun.default_allocator);
                const allocator = html_appender.get();
                const slices = html_loader.getHeadTags(allocator);
                for (slices.slice()) |slice| {
                    html_loader.output.appendSlice(slice) catch bun.outOfMemory();
                    allocator.free(slice);
                }
            }
            break :brk if (Environment.isDebug) undefined else 0; // value is ignored. fail loud if hit in debug
        };

        return .{ .html = .{
            .code = html_loader.output.items,
            .source_index = chunk.entry_point.source_index,
            .script_injection_offset = script_injection_offset,
        } };
    }

    fn postProcessHTMLChunk(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk) !void {
        // This is where we split output into pieces
        const c = ctx.c;
        var j = StringJoiner{
            .allocator = worker.allocator,
            .watcher = .{
                .input = chunk.unique_key,
            },
        };

        const compile_results = chunk.compile_results_for_chunk;

        for (compile_results) |compile_result| {
            j.push(compile_result.code(), bun.default_allocator);
        }

        j.ensureNewlineAtEnd();

        chunk.intermediate_output = c.breakOutputIntoPieces(
            worker.allocator,
            &j,
            @as(u32, @truncate(ctx.chunks.len)),
        ) catch bun.outOfMemory();

        chunk.isolated_hash = c.generateIsolatedHash(chunk);
    }

    // This runs after we've already populated the compile results
    fn postProcessCSSChunk(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk) !void {
        const c = ctx.c;
        var j = StringJoiner{
            .allocator = worker.allocator,
            .watcher = .{
                .input = chunk.unique_key,
            },
        };

        var line_offset: bun.sourcemap.LineColumnOffset.Optional = if (c.options.source_maps != .none) .{ .value = .{} } else .{ .null = {} };

        var newline_before_comment = false;

        // TODO: css banner
        // if len(c.options.CSSBanner) > 0 {
        //     prevOffset.AdvanceString(c.options.CSSBanner)
        //     j.AddString(c.options.CSSBanner)
        //     prevOffset.AdvanceString("\n")
        //     j.AddString("\n")
        // }

        // TODO: (this is where we would put the imports)
        // Generate any prefix rules now
        // (THIS SHOULD BE SET WHEN GENERATING PREFIX RULES!)
        // newline_before_comment = true;

        // TODO: meta

        // Concatenate the generated CSS chunks together
        const compile_results = chunk.compile_results_for_chunk;

        var compile_results_for_source_map: std.MultiArrayList(CompileResultForSourceMap) = .{};
        compile_results_for_source_map.setCapacity(worker.allocator, compile_results.len) catch bun.outOfMemory();

        const sources: []const Logger.Source = c.parse_graph.input_files.items(.source);
        for (compile_results) |compile_result| {
            const source_index = compile_result.sourceIndex();

            if (c.options.mode == .bundle and !c.options.minify_whitespace and Index.init(source_index).isValid()) {
                if (newline_before_comment) {
                    j.pushStatic("\n");
                    line_offset.advance("\n");
                }

                const pretty = sources[source_index].path.pretty;

                j.pushStatic("/* ");
                line_offset.advance("/* ");

                j.pushStatic(pretty);
                line_offset.advance(pretty);

                j.pushStatic(" */\n");
                line_offset.advance(" */\n");
            }

            if (compile_result.code().len > 0) {
                newline_before_comment = true;
            }

            // Save the offset to the start of the stored JavaScript
            j.push(compile_result.code(), bun.default_allocator);

            if (compile_result.sourceMapChunk()) |source_map_chunk| {
                if (c.options.source_maps != .none) {
                    try compile_results_for_source_map.append(worker.allocator, CompileResultForSourceMap{
                        .source_map_chunk = source_map_chunk,
                        .generated_offset = line_offset.value,
                        .source_index = compile_result.sourceIndex(),
                    });
                }

                line_offset.reset();
            } else {
                line_offset.advance(compile_result.code());
            }
        }

        // Make sure the file ends with a newline
        j.ensureNewlineAtEnd();
        // if c.options.UnsupportedCSSFeatures.Has(compat.InlineStyle) {
        //    slashTag = ""
        // }
        // c.maybeAppendLegalComments(c.options.LegalComments, legalCommentList, chunk, &j, slashTag)

        // if len(c.options.CSSFooter) > 0 {
        //     j.AddString(c.options.CSSFooter)
        //     j.AddString("\n")
        // }

        chunk.intermediate_output = c.breakOutputIntoPieces(
            worker.allocator,
            &j,
            @as(u32, @truncate(ctx.chunks.len)),
        ) catch bun.outOfMemory();
        // TODO: meta contents

        chunk.isolated_hash = c.generateIsolatedHash(chunk);
        // chunk.is_executable = is_executable;

        if (c.options.source_maps != .none) {
            const can_have_shifts = chunk.intermediate_output == .pieces;
            chunk.output_source_map = try c.generateSourceMapForChunk(
                chunk.isolated_hash,
                worker,
                compile_results_for_source_map,
                c.resolver.opts.output_dir,
                can_have_shifts,
            );
        }
    }

    // This runs after we've already populated the compile results
    fn postProcessJSChunk(ctx: GenerateChunkCtx, worker: *ThreadPool.Worker, chunk: *Chunk, chunk_index: usize) !void {
        const trace = bun.perf.trace("Bundler.postProcessJSChunk");
        defer trace.end();

        _ = chunk_index;
        const c = ctx.c;
        bun.assert(chunk.content == .javascript);

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();

        defer chunk.renamer.deinit(bun.default_allocator);

        var arena = bun.ArenaAllocator.init(worker.allocator);
        defer arena.deinit();

        // Also generate the cross-chunk binding code
        var cross_chunk_prefix: []u8 = &.{};
        var cross_chunk_suffix: []u8 = &.{};

        var runtime_scope: *Scope = &c.graph.ast.items(.module_scope)[c.graph.files.items(.input_file)[Index.runtime.value].get()];
        var runtime_members = &runtime_scope.members;
        const toCommonJSRef = c.graph.symbols.follow(runtime_members.get("__toCommonJS").?.ref);
        const toESMRef = c.graph.symbols.follow(runtime_members.get("__toESM").?.ref);
        const runtimeRequireRef = if (c.options.output_format == .cjs) null else c.graph.symbols.follow(runtime_members.get("__require").?.ref);

        {
            const print_options = js_printer.Options{
                .bundling = true,
                .indent = .{},
                .has_run_symbol_renamer = true,

                .allocator = worker.allocator,
                .require_ref = runtimeRequireRef,
                .minify_whitespace = c.options.minify_whitespace,
                .minify_identifiers = c.options.minify_identifiers,
                .minify_syntax = c.options.minify_syntax,
                .target = c.options.target,
                .print_dce_annotations = c.options.emit_dce_annotations,
                .mangled_props = &c.mangled_props,
                // .const_values = c.graph.const_values,
            };

            var cross_chunk_import_records = ImportRecord.List.initCapacity(worker.allocator, chunk.cross_chunk_imports.len) catch unreachable;
            defer cross_chunk_import_records.deinitWithAllocator(worker.allocator);
            for (chunk.cross_chunk_imports.slice()) |import_record| {
                cross_chunk_import_records.appendAssumeCapacity(
                    .{
                        .kind = import_record.import_kind,
                        .path = Fs.Path.init(ctx.chunks[import_record.chunk_index].unique_key),
                        .range = Logger.Range.None,
                    },
                );
            }

            const ast = c.graph.ast.get(chunk.entry_point.source_index);

            cross_chunk_prefix = js_printer.print(
                worker.allocator,
                c.resolver.opts.target,
                ast.toAST(),
                c.getSource(chunk.entry_point.source_index),
                print_options,
                cross_chunk_import_records.slice(),
                &[_]Part{
                    .{ .stmts = chunk.content.javascript.cross_chunk_prefix_stmts.slice() },
                },
                chunk.renamer,
                false,
            ).result.code;
            cross_chunk_suffix = js_printer.print(
                worker.allocator,
                c.resolver.opts.target,
                ast.toAST(),
                c.getSource(chunk.entry_point.source_index),
                print_options,
                &.{},
                &[_]Part{
                    .{ .stmts = chunk.content.javascript.cross_chunk_suffix_stmts.slice() },
                },
                chunk.renamer,
                false,
            ).result.code;
        }

        // Generate the exports for the entry point, if there are any
        const entry_point_tail = brk: {
            if (chunk.isEntryPoint()) {
                break :brk c.generateEntryPointTailJS(
                    toCommonJSRef,
                    toESMRef,
                    chunk.entry_point.source_index,
                    worker.allocator,
                    arena.allocator(),
                    chunk.renamer,
                );
            }

            break :brk CompileResult.empty;
        };

        var j = StringJoiner{
            .allocator = worker.allocator,
            .watcher = .{
                .input = chunk.unique_key,
            },
        };
        const output_format = c.options.output_format;

        var line_offset: bun.sourcemap.LineColumnOffset.Optional = if (c.options.source_maps != .none) .{ .value = .{} } else .{ .null = {} };

        // Concatenate the generated JavaScript chunks together

        var newline_before_comment = false;
        var is_executable = false;

        // Start with the hashbang if there is one. This must be done before the
        // banner because it only works if it's literally the first character.
        if (chunk.isEntryPoint()) {
            const is_bun = ctx.c.graph.ast.items(.target)[chunk.entry_point.source_index].isBun();
            const hashbang = c.graph.ast.items(.hashbang)[chunk.entry_point.source_index];

            if (hashbang.len > 0) {
                j.pushStatic(hashbang);
                j.pushStatic("\n");
                line_offset.advance(hashbang);
                line_offset.advance("\n");
                newline_before_comment = true;
                is_executable = true;
            }

            if (is_bun) {
                const cjs_entry_chunk = "(function(exports, require, module, __filename, __dirname) {";
                if (ctx.c.options.generate_bytecode_cache and output_format == .cjs) {
                    const input = "// @bun @bytecode @bun-cjs\n" ++ cjs_entry_chunk;
                    j.pushStatic(input);
                    line_offset.advance(input);
                } else if (ctx.c.options.generate_bytecode_cache) {
                    j.pushStatic("// @bun @bytecode\n");
                    line_offset.advance("// @bun @bytecode\n");
                } else if (output_format == .cjs) {
                    j.pushStatic("// @bun @bun-cjs\n" ++ cjs_entry_chunk);
                    line_offset.advance("// @bun @bun-cjs\n" ++ cjs_entry_chunk);
                } else {
                    j.pushStatic("// @bun\n");
                    line_offset.advance("// @bun\n");
                }
            }
        }

        if (c.options.banner.len > 0) {
            if (newline_before_comment) {
                j.pushStatic("\n");
                line_offset.advance("\n");
            }
            j.pushStatic(ctx.c.options.banner);
            line_offset.advance(ctx.c.options.banner);
            j.pushStatic("\n");
            line_offset.advance("\n");
        }

        // Add the top-level directive if present (but omit "use strict" in ES
        // modules because all ES modules are automatically in strict mode)
        if (chunk.isEntryPoint() and !output_format.isAlwaysStrictMode()) {
            const flags: JSAst.Flags = c.graph.ast.items(.flags)[chunk.entry_point.source_index];

            if (flags.has_explicit_use_strict_directive) {
                j.pushStatic("\"use strict\";\n");
                line_offset.advance("\"use strict\";\n");
                newline_before_comment = true;
            }
        }

        // For Kit, hoist runtime.js outside of the IIFE
        const compile_results = chunk.compile_results_for_chunk;
        if (c.options.output_format == .internal_bake_dev) {
            for (compile_results) |compile_result| {
                const source_index = compile_result.sourceIndex();
                if (source_index != Index.runtime.value) break;
                line_offset.advance(compile_result.code());
                j.push(compile_result.code(), bun.default_allocator);
            }
        }

        switch (c.options.output_format) {
            .internal_bake_dev => {
                const start = bun.bake.getHmrRuntime(if (c.options.target.isServerSide()) .server else .client);
                j.pushStatic(start.code);
                line_offset.advance(start.code);
            },
            .iife => {
                // Bun does not do arrow function lowering. So the wrapper can be an arrow.
                const start = if (c.options.minify_whitespace) "(()=>{" else "(() => {\n";
                j.pushStatic(start);
                line_offset.advance(start);
            },
            else => {}, // no wrapper
        }

        if (cross_chunk_prefix.len > 0) {
            newline_before_comment = true;
            line_offset.advance(cross_chunk_prefix);
            j.push(cross_chunk_prefix, bun.default_allocator);
        }

        // Concatenate the generated JavaScript chunks together
        var prev_filename_comment: Index.Int = 0;

        var compile_results_for_source_map: std.MultiArrayList(CompileResultForSourceMap) = .{};
        compile_results_for_source_map.setCapacity(worker.allocator, compile_results.len) catch bun.outOfMemory();

        const show_comments = c.options.mode == .bundle and
            !c.options.minify_whitespace;

        const emit_targets_in_commands = show_comments and (if (ctx.c.framework) |fw| fw.server_components != null else false);

        const sources: []const Logger.Source = c.parse_graph.input_files.items(.source);
        const targets: []const options.Target = c.parse_graph.ast.items(.target);
        for (compile_results) |compile_result| {
            const source_index = compile_result.sourceIndex();
            const is_runtime = source_index == Index.runtime.value;

            // TODO: extracated legal comments

            // Add a comment with the file path before the file contents
            if (show_comments and source_index != prev_filename_comment and compile_result.code().len > 0) {
                prev_filename_comment = source_index;

                if (newline_before_comment) {
                    j.pushStatic("\n");
                    line_offset.advance("\n");
                }

                // Make sure newlines in the path can't cause a syntax error.
                const CommentType = enum {
                    multiline,
                    single,
                };

                const pretty = sources[source_index].path.pretty;

                // TODO: quote this. This is really janky.
                const comment_type = if (strings.indexOfNewlineOrNonASCII(pretty, 0) != null)
                    CommentType.multiline
                else
                    CommentType.single;

                if (!c.options.minify_whitespace and
                    (output_format == .iife or output_format == .internal_bake_dev))
                {
                    j.pushStatic("  ");
                    line_offset.advance("  ");
                }

                switch (comment_type) {
                    .multiline => {
                        j.pushStatic("/* ");
                        line_offset.advance("/* ");
                    },
                    .single => {
                        j.pushStatic("// ");
                        line_offset.advance("// ");
                    },
                }

                j.pushStatic(pretty);
                line_offset.advance(pretty);

                if (emit_targets_in_commands) {
                    j.pushStatic(" (");
                    line_offset.advance(" (");
                    const target = @tagName(targets[source_index].bakeGraph());
                    j.pushStatic(target);
                    line_offset.advance(target);
                    j.pushStatic(")");
                    line_offset.advance(")");
                }

                switch (comment_type) {
                    .multiline => {
                        j.pushStatic(" */\n");
                        line_offset.advance(" */\n");
                    },
                    .single => {
                        j.pushStatic("\n");
                        line_offset.advance("\n");
                    },
                }
            }

            if (is_runtime) {
                if (c.options.output_format != .internal_bake_dev) {
                    line_offset.advance(compile_result.code());
                    j.push(compile_result.code(), bun.default_allocator);
                }
            } else {
                j.push(compile_result.code(), bun.default_allocator);

                if (compile_result.sourceMapChunk()) |source_map_chunk| {
                    if (c.options.source_maps != .none) {
                        try compile_results_for_source_map.append(worker.allocator, CompileResultForSourceMap{
                            .source_map_chunk = source_map_chunk,
                            .generated_offset = line_offset.value,
                            .source_index = compile_result.sourceIndex(),
                        });
                    }

                    line_offset.reset();
                } else {
                    line_offset.advance(compile_result.code());
                }
            }

            // TODO: metafile
            newline_before_comment = compile_result.code().len > 0;
        }

        const tail_code = entry_point_tail.code();
        if (tail_code.len > 0) {
            // Stick the entry point tail at the end of the file. Deliberately don't
            // include any source mapping information for this because it's automatically
            // generated and doesn't correspond to a location in the input file.
            j.push(tail_code, bun.default_allocator);
        }

        // Put the cross-chunk suffix inside the IIFE
        if (cross_chunk_suffix.len > 0) {
            if (newline_before_comment) {
                j.pushStatic("\n");
            }

            j.push(cross_chunk_suffix, bun.default_allocator);
        }

        switch (output_format) {
            .iife => {
                const without_newline = "})();";

                const with_newline = if (newline_before_comment)
                    without_newline ++ "\n"
                else
                    without_newline;

                j.pushStatic(with_newline);
            },
            .internal_bake_dev => {
                {
                    const str = "}, {\n  main: ";
                    j.pushStatic(str);
                    line_offset.advance(str);
                }
                {
                    const input = c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path;
                    var buf = MutableString.initEmpty(worker.allocator);
                    js_printer.quoteForJSONBuffer(input.pretty, &buf, true) catch bun.outOfMemory();
                    const str = buf.slice(); // worker.allocator is an arena
                    j.pushStatic(str);
                    line_offset.advance(str);
                }
                // {
                //     const str = "\n  react_refresh: ";
                //     j.pushStatic(str);
                //     line_offset.advance(str);
                // }
                {
                    const str = "\n});";
                    j.pushStatic(str);
                    line_offset.advance(str);
                }
            },
            .cjs => {
                if (chunk.isEntryPoint()) {
                    const is_bun = ctx.c.graph.ast.items(.target)[chunk.entry_point.source_index].isBun();
                    if (is_bun) {
                        j.pushStatic("})\n");
                        line_offset.advance("})\n");
                    }
                }
            },
            else => {},
        }

        j.ensureNewlineAtEnd();
        // TODO: maybeAppendLegalComments

        if (c.options.footer.len > 0) {
            if (newline_before_comment) {
                j.pushStatic("\n");
                line_offset.advance("\n");
            }
            j.pushStatic(ctx.c.options.footer);
            line_offset.advance(ctx.c.options.footer);
            j.pushStatic("\n");
            line_offset.advance("\n");
        }

        chunk.intermediate_output = c.breakOutputIntoPieces(
            worker.allocator,
            &j,
            @as(u32, @truncate(ctx.chunks.len)),
        ) catch @panic("Unhandled out of memory error in breakOutputIntoPieces()");

        // TODO: meta contents

        chunk.isolated_hash = c.generateIsolatedHash(chunk);
        chunk.is_executable = is_executable;

        if (c.options.source_maps != .none) {
            const can_have_shifts = chunk.intermediate_output == .pieces;
            chunk.output_source_map = try c.generateSourceMapForChunk(
                chunk.isolated_hash,
                worker,
                compile_results_for_source_map,
                c.resolver.opts.output_dir,
                can_have_shifts,
            );
        }
    }

    pub fn generateSourceMapForChunk(
        c: *LinkerContext,
        isolated_hash: u64,
        worker: *ThreadPool.Worker,
        results: std.MultiArrayList(CompileResultForSourceMap),
        chunk_abs_dir: string,
        can_have_shifts: bool,
    ) !sourcemap.SourceMapPieces {
        const trace = bun.perf.trace("Bundler.generateSourceMapForChunk");
        defer trace.end();

        var j = StringJoiner{ .allocator = worker.allocator };

        const sources = c.parse_graph.input_files.items(.source);
        const quoted_source_map_contents = c.graph.files.items(.quoted_source_contents);

        // Entries in `results` do not 1:1 map to source files, the mapping
        // is actually many to one, where a source file can have multiple chunks
        // in the sourcemap.
        //
        // This hashmap is going to map:
        //    `source_index` (per compilation) in a chunk
        //   -->
        //    Which source index in the generated sourcemap, referred to
        //    as the "mapping source index" within this function to be distinct.
        var source_id_map = std.AutoArrayHashMap(u32, i32).init(worker.allocator);
        defer source_id_map.deinit();

        const source_indices = results.items(.source_index);

        j.pushStatic(
            \\{
            \\  "version": 3,
            \\  "sources": [
        );
        if (source_indices.len > 0) {
            {
                const index = source_indices[0];
                var path = sources[index].path;
                try source_id_map.putNoClobber(index, 0);

                if (path.isFile()) {
                    const rel_path = try std.fs.path.relative(worker.allocator, chunk_abs_dir, path.text);
                    path.pretty = rel_path;
                }

                var quote_buf = try MutableString.init(worker.allocator, path.pretty.len + 2);
                quote_buf = try js_printer.quoteForJSON(path.pretty, quote_buf, false);
                j.pushStatic(quote_buf.list.items); // freed by arena
            }

            var next_mapping_source_index: i32 = 1;
            for (source_indices[1..]) |index| {
                const gop = try source_id_map.getOrPut(index);
                if (gop.found_existing) continue;

                gop.value_ptr.* = next_mapping_source_index;
                next_mapping_source_index += 1;

                var path = sources[index].path;

                if (path.isFile()) {
                    const rel_path = try std.fs.path.relative(worker.allocator, chunk_abs_dir, path.text);
                    path.pretty = rel_path;
                }

                var quote_buf = try MutableString.init(worker.allocator, path.pretty.len + ", ".len + 2);
                quote_buf.appendAssumeCapacity(", ");
                quote_buf = try js_printer.quoteForJSON(path.pretty, quote_buf, false);
                j.pushStatic(quote_buf.list.items); // freed by arena
            }
        }

        j.pushStatic(
            \\],
            \\  "sourcesContent": [
        );

        const source_indices_for_contents = source_id_map.keys();
        if (source_indices_for_contents.len > 0) {
            j.pushStatic("\n    ");
            j.pushStatic(quoted_source_map_contents[source_indices_for_contents[0]]);

            for (source_indices_for_contents[1..]) |index| {
                j.pushStatic(",\n    ");
                j.pushStatic(quoted_source_map_contents[index]);
            }
        }
        j.pushStatic(
            \\
            \\  ],
            \\  "mappings": "
        );

        const mapping_start = j.len;
        var prev_end_state = sourcemap.SourceMapState{};
        var prev_column_offset: i32 = 0;
        const source_map_chunks = results.items(.source_map_chunk);
        const offsets = results.items(.generated_offset);
        for (source_map_chunks, offsets, source_indices) |chunk, offset, current_source_index| {
            const mapping_source_index = source_id_map.get(current_source_index) orelse
                unreachable; // the pass above during printing of "sources" must add the index

            var start_state = sourcemap.SourceMapState{
                .source_index = mapping_source_index,
                .generated_line = offset.lines,
                .generated_column = offset.columns,
            };

            if (offset.lines == 0) {
                start_state.generated_column += prev_column_offset;
            }

            try sourcemap.appendSourceMapChunk(&j, worker.allocator, prev_end_state, start_state, chunk.buffer.list.items);

            prev_end_state = chunk.end_state;
            prev_end_state.source_index = mapping_source_index;
            prev_column_offset = chunk.final_generated_column;

            if (prev_end_state.generated_line == 0) {
                prev_end_state.generated_column += start_state.generated_column;
                prev_column_offset += start_state.generated_column;
            }
        }
        const mapping_end = j.len;

        if (comptime FeatureFlags.source_map_debug_id) {
            j.pushStatic("\",\n  \"debugId\": \"");
            j.push(
                try std.fmt.allocPrint(worker.allocator, "{}", .{bun.sourcemap.DebugIDFormatter{ .id = isolated_hash }}),
                worker.allocator,
            );
            j.pushStatic("\",\n  \"names\": []\n}");
        } else {
            j.pushStatic("\",\n  \"names\": []\n}");
        }

        const done = try j.done(worker.allocator);
        bun.assert(done[0] == '{');

        var pieces = sourcemap.SourceMapPieces.init(worker.allocator);
        if (can_have_shifts) {
            try pieces.prefix.appendSlice(done[0..mapping_start]);
            try pieces.mappings.appendSlice(done[mapping_start..mapping_end]);
            try pieces.suffix.appendSlice(done[mapping_end..]);
        } else {
            try pieces.prefix.appendSlice(done);
        }

        return pieces;
    }

    pub fn generateIsolatedHash(c: *LinkerContext, chunk: *const Chunk) u64 {
        const trace = bun.perf.trace("Bundler.generateIsolatedHash");
        defer trace.end();

        var hasher = ContentHasher{};

        // Mix the file names and part ranges of all of the files in this chunk into
        // the hash. Objects that appear identical but that live in separate files or
        // that live in separate parts in the same file must not be merged. This only
        // needs to be done for JavaScript files, not CSS files.
        if (chunk.content == .javascript) {
            const sources = c.parse_graph.input_files.items(.source);
            for (chunk.content.javascript.parts_in_chunk_in_order) |part_range| {
                const source: *Logger.Source = &sources[part_range.source_index.get()];

                const file_path = brk: {
                    if (source.path.isFile()) {
                        // Use the pretty path as the file name since it should be platform-
                        // independent (relative paths and the "/" path separator)
                        if (source.path.text.ptr == source.path.pretty.ptr) {
                            source.path = c.pathWithPrettyInitialized(source.path) catch bun.outOfMemory();
                        }
                        source.path.assertPrettyIsValid();

                        break :brk source.path.pretty;
                    } else {
                        // If this isn't in the "file" namespace, just use the full path text
                        // verbatim. This could be a source of cross-platform differences if
                        // plugins are storing platform-specific information in here, but then
                        // that problem isn't caused by esbuild itself.
                        break :brk source.path.text;
                    }
                };

                // Include the path namespace in the hash
                hasher.write(source.path.namespace);

                // Then include the file path
                hasher.write(file_path);

                // Then include the part range
                hasher.writeInts(&[_]u32{
                    part_range.part_index_begin,
                    part_range.part_index_end,
                });
            }
        }

        // Hash the output path template as part of the content hash because we want
        // any import to be considered different if the import's output path has changed.
        hasher.write(chunk.template.data);

        // Also hash the public path. If provided, this is used whenever files
        // reference each other such as cross-chunk imports, asset file references,
        // and source map comments. We always include the hash in all chunks instead
        // of trying to figure out which chunks will include the public path for
        // simplicity and for robustness to code changes in the future.
        if (c.options.public_path.len > 0) {
            hasher.write(c.options.public_path);
        }

        // Include the generated output content in the hash. This excludes the
        // randomly-generated import paths (the unique keys) and only includes the
        // data in the spans between them.
        if (chunk.intermediate_output == .pieces) {
            for (chunk.intermediate_output.pieces.slice()) |piece| {
                hasher.write(piece.data());
            }
        } else {
            var el = chunk.intermediate_output.joiner.head;
            while (el) |e| : (el = e.next) {
                hasher.write(e.slice);
            }
        }

        // Also include the source map data in the hash. The source map is named the
        // same name as the chunk name for ease of discovery. So we want the hash to
        // change if the source map data changes even if the chunk data doesn't change.
        // Otherwise the output path for the source map wouldn't change and the source
        // map wouldn't end up being updated.
        //
        // Note that this means the contents of all input files are included in the
        // hash because of "sourcesContent", so changing a comment in an input file
        // can now change the hash of the output file. This only happens when you
        // have source maps enabled (and "sourcesContent", which is on by default).
        //
        // The generated positions in the mappings here are in the output content
        // *before* the final paths have been substituted. This may seem weird.
        // However, I think this shouldn't cause issues because a) the unique key
        // values are all always the same length so the offsets are deterministic
        // and b) the final paths will be folded into the final hash later.
        hasher.write(chunk.output_source_map.prefix.items);
        hasher.write(chunk.output_source_map.mappings.items);
        hasher.write(chunk.output_source_map.suffix.items);

        return hasher.digest();
    }

    pub fn validateTLA(
        c: *LinkerContext,
        source_index: Index.Int,
        tla_keywords: []Logger.Range,
        tla_checks: []js_ast.TlaCheck,
        input_files: []Logger.Source,
        import_records: []ImportRecord,
        meta_flags: []JSMeta.Flags,
        ast_import_records: []bun.BabyList(ImportRecord),
    ) js_ast.TlaCheck {
        var result_tla_check: *js_ast.TlaCheck = &tla_checks[source_index];

        if (result_tla_check.depth == 0) {
            result_tla_check.depth = 1;
            if (tla_keywords[source_index].len > 0) {
                result_tla_check.parent = source_index;
            }

            for (import_records, 0..) |record, import_record_index| {
                if (Index.isValid(record.source_index) and (record.kind == .require or record.kind == .stmt)) {
                    const parent = c.validateTLA(record.source_index.get(), tla_keywords, tla_checks, input_files, import_records, meta_flags, ast_import_records);
                    if (Index.isInvalid(Index.init(parent.parent))) {
                        continue;
                    }

                    // Follow any import chains
                    if (record.kind == .stmt and (Index.isInvalid(Index.init(result_tla_check.parent)) or parent.depth < result_tla_check.depth)) {
                        result_tla_check.depth = parent.depth + 1;
                        result_tla_check.parent = record.source_index.get();
                        result_tla_check.import_record_index = @intCast(import_record_index);
                        continue;
                    }

                    // Require of a top-level await chain is forbidden
                    if (record.kind == .require) {
                        var notes = std.ArrayList(Logger.Data).init(c.allocator);

                        var tla_pretty_path: string = "";
                        var other_source_index = record.source_index.get();

                        // Build up a chain of notes for all of the imports
                        while (true) {
                            const parent_result_tla_keyword = tla_keywords[other_source_index];
                            const parent_tla_check = tla_checks[other_source_index];
                            const parent_source_index = other_source_index;

                            if (parent_result_tla_keyword.len > 0) {
                                const source = input_files[other_source_index];
                                tla_pretty_path = source.path.pretty;
                                notes.append(Logger.Data{
                                    .text = std.fmt.allocPrint(c.allocator, "The top-level await in {s} is here:", .{tla_pretty_path}) catch bun.outOfMemory(),
                                    .location = .initOrNull(&source, parent_result_tla_keyword),
                                }) catch bun.outOfMemory();
                                break;
                            }

                            if (!Index.isValid(Index.init(parent_tla_check.parent))) {
                                notes.append(Logger.Data{
                                    .text = "unexpected invalid index",
                                }) catch bun.outOfMemory();
                                break;
                            }

                            other_source_index = parent_tla_check.parent;

                            notes.append(Logger.Data{
                                .text = std.fmt.allocPrint(c.allocator, "The file {s} imports the file {s} here:", .{
                                    input_files[parent_source_index].path.pretty,
                                    input_files[other_source_index].path.pretty,
                                }) catch bun.outOfMemory(),
                                .location = .initOrNull(&input_files[parent_source_index], ast_import_records[parent_source_index].slice()[tla_checks[parent_source_index].import_record_index].range),
                            }) catch bun.outOfMemory();
                        }

                        const source: *const Logger.Source = &input_files[source_index];
                        const imported_pretty_path = source.path.pretty;
                        const text: string = if (strings.eql(imported_pretty_path, tla_pretty_path))
                            std.fmt.allocPrint(c.allocator, "This require call is not allowed because the imported file \"{s}\" contains a top-level await", .{imported_pretty_path}) catch bun.outOfMemory()
                        else
                            std.fmt.allocPrint(c.allocator, "This require call is not allowed because the transitive dependency \"{s}\" contains a top-level await", .{tla_pretty_path}) catch bun.outOfMemory();

                        c.log.addRangeErrorWithNotes(source, record.range, text, notes.items) catch bun.outOfMemory();
                    }
                }
            }

            // Make sure that if we wrap this module in a closure, the closure is also
            // async. This happens when you call "import()" on this module and code
            // splitting is off.
            if (Index.isValid(Index.init(result_tla_check.parent))) {
                meta_flags[source_index].is_async_or_has_async_dependency = true;
            }
        }

        return result_tla_check.*;
    }

    pub fn generateEntryPointTailJS(
        c: *LinkerContext,
        toCommonJSRef: Ref,
        toESMRef: Ref,
        source_index: Index.Int,
        allocator: std.mem.Allocator,
        temp_allocator: std.mem.Allocator,
        r: renamer.Renamer,
    ) CompileResult {
        const flags: JSMeta.Flags = c.graph.meta.items(.flags)[source_index];
        var stmts = std.ArrayList(Stmt).init(temp_allocator);
        defer stmts.deinit();
        const ast: JSAst = c.graph.ast.get(source_index);

        switch (c.options.output_format) {
            .esm => {
                switch (flags.wrap) {
                    .cjs => {
                        stmts.append(
                            Stmt.alloc(
                                // "export default require_foo();"
                                S.ExportDefault,
                                .{
                                    .default_name = .{
                                        .loc = Logger.Loc.Empty,
                                        .ref = ast.wrapper_ref,
                                    },
                                    .value = .{
                                        .expr = Expr.init(
                                            E.Call,
                                            E.Call{
                                                .target = Expr.initIdentifier(
                                                    ast.wrapper_ref,
                                                    Logger.Loc.Empty,
                                                ),
                                            },
                                            Logger.Loc.Empty,
                                        ),
                                    },
                                },
                                Logger.Loc.Empty,
                            ),
                        ) catch unreachable;
                    },
                    else => {
                        if (flags.wrap == .esm and ast.wrapper_ref.isValid()) {
                            if (flags.is_async_or_has_async_dependency) {
                                // "await init_foo();"
                                stmts.append(
                                    Stmt.alloc(
                                        S.SExpr,
                                        .{
                                            .value = Expr.init(
                                                E.Await,
                                                E.Await{
                                                    .value = Expr.init(
                                                        E.Call,
                                                        E.Call{
                                                            .target = Expr.initIdentifier(
                                                                ast.wrapper_ref,
                                                                Logger.Loc.Empty,
                                                            ),
                                                        },
                                                        Logger.Loc.Empty,
                                                    ),
                                                },
                                                Logger.Loc.Empty,
                                            ),
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                ) catch unreachable;
                            } else {
                                // "init_foo();"
                                stmts.append(
                                    Stmt.alloc(
                                        S.SExpr,
                                        .{
                                            .value = Expr.init(
                                                E.Call,
                                                E.Call{
                                                    .target = Expr.initIdentifier(
                                                        ast.wrapper_ref,
                                                        Logger.Loc.Empty,
                                                    ),
                                                },
                                                Logger.Loc.Empty,
                                            ),
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                ) catch unreachable;
                            }
                        }

                        const sorted_and_filtered_export_aliases = c.graph.meta.items(.sorted_and_filtered_export_aliases)[source_index];

                        if (sorted_and_filtered_export_aliases.len > 0) {
                            const resolved_exports: ResolvedExports = c.graph.meta.items(.resolved_exports)[source_index];
                            const imports_to_bind: RefImportData = c.graph.meta.items(.imports_to_bind)[source_index];

                            // If the output format is ES6 modules and we're an entry point, generate an
                            // ES6 export statement containing all exports. Except don't do that if this
                            // entry point is a CommonJS-style module, since that would generate an ES6
                            // export statement that's not top-level. Instead, we will export the CommonJS
                            // exports as a default export later on.
                            var items = std.ArrayList(js_ast.ClauseItem).init(temp_allocator);
                            const cjs_export_copies = c.graph.meta.items(.cjs_export_copies)[source_index];

                            var had_default_export = false;

                            for (sorted_and_filtered_export_aliases, 0..) |alias, i| {
                                var resolved_export = resolved_exports.get(alias).?;

                                had_default_export = had_default_export or strings.eqlComptime(alias, "default");

                                // If this is an export of an import, reference the symbol that the import
                                // was eventually resolved to. We need to do this because imports have
                                // already been resolved by this point, so we can't generate a new import
                                // and have that be resolved later.
                                if (imports_to_bind.get(resolved_export.data.import_ref)) |import_data| {
                                    resolved_export.data.import_ref = import_data.data.import_ref;
                                    resolved_export.data.source_index = import_data.data.source_index;
                                }

                                // Exports of imports need EImportIdentifier in case they need to be re-
                                // written to a property access later on
                                if (c.graph.symbols.get(resolved_export.data.import_ref).?.namespace_alias != null) {
                                    const temp_ref = cjs_export_copies[i];

                                    // Create both a local variable and an export clause for that variable.
                                    // The local variable is initialized with the initial value of the
                                    // export. This isn't fully correct because it's a "dead" binding and
                                    // doesn't update with the "live" value as it changes. But ES6 modules
                                    // don't have any syntax for bare named getter functions so this is the
                                    // best we can do.
                                    //
                                    // These input files:
                                    //
                                    //   // entry_point.js
                                    //   export {foo} from './cjs-format.js'
                                    //
                                    //   // cjs-format.js
                                    //   Object.defineProperty(exports, 'foo', {
                                    //     enumerable: true,
                                    //     get: () => Math.random(),
                                    //   })
                                    //
                                    // Become this output file:
                                    //
                                    //   // cjs-format.js
                                    //   var require_cjs_format = __commonJS((exports) => {
                                    //     Object.defineProperty(exports, "foo", {
                                    //       enumerable: true,
                                    //       get: () => Math.random()
                                    //     });
                                    //   });
                                    //
                                    //   // entry_point.js
                                    //   var cjs_format = __toESM(require_cjs_format());
                                    //   var export_foo = cjs_format.foo;
                                    //   export {
                                    //     export_foo as foo
                                    //   };
                                    //
                                    stmts.append(
                                        Stmt.alloc(
                                            S.Local,
                                            .{
                                                .decls = js_ast.G.Decl.List.fromSlice(
                                                    temp_allocator,
                                                    &.{
                                                        .{
                                                            .binding = Binding.alloc(
                                                                temp_allocator,
                                                                B.Identifier{
                                                                    .ref = temp_ref,
                                                                },
                                                                Logger.Loc.Empty,
                                                            ),
                                                            .value = Expr.init(
                                                                E.ImportIdentifier,
                                                                E.ImportIdentifier{
                                                                    .ref = resolved_export.data.import_ref,
                                                                },
                                                                Logger.Loc.Empty,
                                                            ),
                                                        },
                                                    },
                                                ) catch unreachable,
                                            },
                                            Logger.Loc.Empty,
                                        ),
                                    ) catch unreachable;

                                    items.append(
                                        .{
                                            .name = js_ast.LocRef{
                                                .ref = temp_ref,
                                                .loc = Logger.Loc.Empty,
                                            },
                                            .alias = alias,
                                            .alias_loc = Logger.Loc.Empty,
                                        },
                                    ) catch unreachable;
                                } else {
                                    // Local identifiers can be exported using an export clause. This is done
                                    // this way instead of leaving the "export" keyword on the local declaration
                                    // itself both because it lets the local identifier be minified and because
                                    // it works transparently for re-exports across files.
                                    //
                                    // These input files:
                                    //
                                    //   // entry_point.js
                                    //   export * from './esm-format.js'
                                    //
                                    //   // esm-format.js
                                    //   export let foo = 123
                                    //
                                    // Become this output file:
                                    //
                                    //   // esm-format.js
                                    //   let foo = 123;
                                    //
                                    //   // entry_point.js
                                    //   export {
                                    //     foo
                                    //   };
                                    //
                                    items.append(.{
                                        .name = js_ast.LocRef{
                                            .ref = resolved_export.data.import_ref,
                                            .loc = resolved_export.data.name_loc,
                                        },
                                        .alias = alias,
                                        .alias_loc = resolved_export.data.name_loc,
                                    }) catch unreachable;
                                }
                            }

                            stmts.append(
                                Stmt.alloc(
                                    S.ExportClause,
                                    .{
                                        .items = items.items,
                                        .is_single_line = false,
                                    },
                                    Logger.Loc.Empty,
                                ),
                            ) catch unreachable;

                            if (flags.needs_synthetic_default_export and !had_default_export) {
                                var properties = G.Property.List.initCapacity(allocator, items.items.len) catch unreachable;
                                const getter_fn_body = allocator.alloc(Stmt, items.items.len) catch unreachable;
                                var remain_getter_fn_body = getter_fn_body;
                                for (items.items) |export_item| {
                                    var fn_body = remain_getter_fn_body[0..1];
                                    remain_getter_fn_body = remain_getter_fn_body[1..];
                                    fn_body[0] = Stmt.alloc(
                                        S.Return,
                                        S.Return{
                                            .value = Expr.init(
                                                E.Identifier,
                                                E.Identifier{
                                                    .ref = export_item.name.ref.?,
                                                },
                                                export_item.name.loc,
                                            ),
                                        },
                                        Logger.Loc.Empty,
                                    );
                                    properties.appendAssumeCapacity(
                                        G.Property{
                                            .key = Expr.init(
                                                E.String,
                                                E.String{
                                                    .data = export_item.alias,
                                                    .is_utf16 = false,
                                                },
                                                export_item.alias_loc,
                                            ),
                                            .value = Expr.init(
                                                E.Function,
                                                E.Function{
                                                    .func = G.Fn{
                                                        .body = G.FnBody{
                                                            .loc = Logger.Loc.Empty,
                                                            .stmts = fn_body,
                                                        },
                                                    },
                                                },
                                                export_item.alias_loc,
                                            ),
                                            .kind = G.Property.Kind.get,
                                            .flags = js_ast.Flags.Property.init(.{
                                                .is_method = true,
                                            }),
                                        },
                                    );
                                }
                                stmts.append(
                                    Stmt.alloc(
                                        S.ExportDefault,
                                        S.ExportDefault{
                                            .default_name = .{
                                                .ref = Ref.None,
                                                .loc = Logger.Loc.Empty,
                                            },
                                            .value = .{
                                                .expr = Expr.init(
                                                    E.Object,
                                                    E.Object{
                                                        .properties = properties,
                                                    },
                                                    Logger.Loc.Empty,
                                                ),
                                            },
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                ) catch unreachable;
                            }
                        }
                    },
                }
            },

            // TODO: iife
            .iife => {},

            .internal_bake_dev => {
                // nothing needs to be done here, as the exports are already
                // forwarded in the module closure.
            },

            .cjs => {
                switch (flags.wrap) {
                    .cjs => {
                        // "module.exports = require_foo();"
                        stmts.append(
                            Stmt.assign(
                                Expr.init(
                                    E.Dot,
                                    .{
                                        .target = Expr.initIdentifier(c.unbound_module_ref, Logger.Loc.Empty),
                                        .name = "exports",
                                        .name_loc = Logger.Loc.Empty,
                                    },
                                    Logger.Loc.Empty,
                                ),
                                Expr.init(
                                    E.Call,
                                    .{
                                        .target = Expr.initIdentifier(ast.wrapper_ref, Logger.Loc.Empty),
                                    },
                                    Logger.Loc.Empty,
                                ),
                            ),
                        ) catch unreachable;
                    },
                    .esm => {
                        // "init_foo();"
                        stmts.append(
                            Stmt.alloc(
                                S.SExpr,
                                .{
                                    .value = Expr.init(
                                        E.Call,
                                        .{
                                            .target = Expr.initIdentifier(ast.wrapper_ref, Logger.Loc.Empty),
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                },
                                Logger.Loc.Empty,
                            ),
                        ) catch unreachable;
                    },
                    else => {},
                }

                // TODO:
                // If we are generating CommonJS for node, encode the known export names in
                // a form that node can understand them. This relies on the specific behavior
                // of this parser, which the node project uses to detect named exports in
                // CommonJS files: https://github.com/guybedford/cjs-module-lexer. Think of
                // this code as an annotation for that parser.
            },
        }

        if (stmts.items.len == 0) {
            return .{
                .javascript = .{
                    .source_index = source_index,
                    .result = .{ .result = .{
                        .code = "",
                    } },
                },
            };
        }

        const print_options = js_printer.Options{
            // TODO: IIFE indent
            .indent = .{},
            .has_run_symbol_renamer = true,

            .allocator = allocator,
            .to_esm_ref = toESMRef,
            .to_commonjs_ref = toCommonJSRef,
            .require_or_import_meta_for_source_callback = js_printer.RequireOrImportMeta.Callback.init(LinkerContext, requireOrImportMetaForSource, c),

            .minify_whitespace = c.options.minify_whitespace,
            .print_dce_annotations = c.options.emit_dce_annotations,
            .minify_syntax = c.options.minify_syntax,
            .mangled_props = &c.mangled_props,
            // .const_values = c.graph.const_values,
        };

        return .{
            .javascript = .{
                .result = js_printer.print(
                    allocator,
                    c.resolver.opts.target,
                    ast.toAST(),
                    c.getSource(source_index),
                    print_options,
                    ast.import_records.slice(),
                    &[_]Part{
                        .{
                            .stmts = stmts.items,
                        },
                    },
                    r,
                    false,
                ),
                .source_index = source_index,
            },
        };
    }

    pub const StmtList = struct {
        inside_wrapper_prefix: std.ArrayList(Stmt),
        outside_wrapper_prefix: std.ArrayList(Stmt),
        inside_wrapper_suffix: std.ArrayList(Stmt),

        all_stmts: std.ArrayList(Stmt),

        pub fn reset(this: *StmtList) void {
            this.inside_wrapper_prefix.clearRetainingCapacity();
            this.outside_wrapper_prefix.clearRetainingCapacity();
            this.inside_wrapper_suffix.clearRetainingCapacity();
            this.all_stmts.clearRetainingCapacity();
        }

        pub fn deinit(this: *StmtList) void {
            this.inside_wrapper_prefix.deinit();
            this.outside_wrapper_prefix.deinit();
            this.inside_wrapper_suffix.deinit();
            this.all_stmts.deinit();
        }

        pub fn init(allocator: std.mem.Allocator) StmtList {
            return .{
                .inside_wrapper_prefix = std.ArrayList(Stmt).init(allocator),
                .outside_wrapper_prefix = std.ArrayList(Stmt).init(allocator),
                .inside_wrapper_suffix = std.ArrayList(Stmt).init(allocator),
                .all_stmts = std.ArrayList(Stmt).init(allocator),
            };
        }
    };

    fn mergeAdjacentLocalStmts(stmts: *std.ArrayList(Stmt), allocator: std.mem.Allocator) void {
        if (stmts.items.len == 0)
            return;

        var did_merge_with_previous_local = false;
        var end: usize = 1;

        for (stmts.items[1..]) |stmt| {
            // Try to merge with the previous variable statement
            if (stmt.data == .s_local) {
                var after = stmt.data.s_local;
                if (stmts.items[end - 1].data == .s_local) {
                    var before = stmts.items[end - 1].data.s_local;
                    // It must be the same kind of variable statement (i.e. let/var/const)
                    if (before.canMergeWith(after)) {
                        if (did_merge_with_previous_local) {
                            // Avoid O(n^2) behavior for repeated variable declarations
                            // Appending to this decls list is safe because did_merge_with_previous_local is true
                            before.decls.append(allocator, after.decls.slice()) catch unreachable;
                        } else {
                            // Append the declarations to the previous variable statement
                            did_merge_with_previous_local = true;

                            var clone = std.ArrayList(G.Decl).initCapacity(allocator, before.decls.len + after.decls.len) catch unreachable;
                            clone.appendSliceAssumeCapacity(before.decls.slice());
                            clone.appendSliceAssumeCapacity(after.decls.slice());
                            // we must clone instead of overwrite in-place incase the same S.Local is used across threads
                            // https://github.com/oven-sh/bun/issues/2942
                            stmts.items[end - 1] = Stmt.allocate(
                                allocator,
                                S.Local,
                                S.Local{
                                    .decls = BabyList(G.Decl).fromList(clone),
                                    .is_export = before.is_export,
                                    .was_commonjs_export = before.was_commonjs_export,
                                    .was_ts_import_equals = before.was_ts_import_equals,
                                    .kind = before.kind,
                                },
                                stmts.items[end - 1].loc,
                            );
                        }
                        continue;
                    }
                }
            }

            did_merge_with_previous_local = false;
            stmts.items[end] = stmt;
            end += 1;
        }
        stmts.items.len = end;
    }

    fn shouldRemoveImportExportStmt(
        c: *LinkerContext,
        stmts: *StmtList,
        loc: Logger.Loc,
        namespace_ref: Ref,
        import_record_index: u32,
        allocator: std.mem.Allocator,
        ast: *const JSAst,
    ) !bool {
        const record = ast.import_records.at(import_record_index);
        // Is this an external import?
        if (!record.source_index.isValid()) {
            // Keep the "import" statement if import statements are supported
            if (c.options.output_format.keepES6ImportExportSyntax()) {
                return false;
            }

            // Otherwise, replace this statement with a call to "require()"
            stmts.inside_wrapper_prefix.append(
                Stmt.alloc(
                    S.Local,
                    S.Local{
                        .decls = G.Decl.List.fromSlice(
                            allocator,
                            &.{
                                .{
                                    .binding = Binding.alloc(
                                        allocator,
                                        B.Identifier{
                                            .ref = namespace_ref,
                                        },
                                        loc,
                                    ),
                                    .value = Expr.init(
                                        E.RequireString,
                                        E.RequireString{
                                            .import_record_index = import_record_index,
                                        },
                                        loc,
                                    ),
                                },
                            },
                        ) catch unreachable,
                    },
                    record.range.loc,
                ),
            ) catch unreachable;
            return true;
        }

        // We don't need a call to "require()" if this is a self-import inside a
        // CommonJS-style module, since we can just reference the exports directly.
        if (ast.exports_kind == .cjs and c.graph.symbols.follow(namespace_ref).eql(ast.exports_ref)) {
            return true;
        }

        const other_flags = c.graph.meta.items(.flags)[record.source_index.get()];
        switch (other_flags.wrap) {
            .none => {},
            .cjs => {
                // Replace the statement with a call to "require()" if this module is not wrapped
                try stmts.inside_wrapper_prefix.append(
                    Stmt.alloc(S.Local, .{
                        .decls = try G.Decl.List.fromSlice(
                            allocator,
                            &.{
                                .{
                                    .binding = Binding.alloc(allocator, B.Identifier{
                                        .ref = namespace_ref,
                                    }, loc),
                                    .value = Expr.init(E.RequireString, .{
                                        .import_record_index = import_record_index,
                                    }, loc),
                                },
                            },
                        ),
                    }, loc),
                );
            },
            .esm => {
                // Ignore this file if it's not included in the bundle. This can happen for
                // wrapped ESM files but not for wrapped CommonJS files because we allow
                // tree shaking inside wrapped ESM files.
                if (!c.graph.files_live.isSet(record.source_index.get())) {
                    return true;
                }

                const wrapper_ref = c.graph.ast.items(.wrapper_ref)[record.source_index.get()];
                if (wrapper_ref.isEmpty()) {
                    return true;
                }

                // Replace the statement with a call to "init()"
                const value: Expr = brk: {
                    const default = Expr.init(E.Call, .{
                        .target = Expr.initIdentifier(
                            wrapper_ref,
                            loc,
                        ),
                    }, loc);

                    if (other_flags.is_async_or_has_async_dependency) {
                        // This currently evaluates sibling dependencies in serial instead of in
                        // parallel, which is incorrect. This should be changed to store a promise
                        // and await all stored promises after all imports but before any code.
                        break :brk Expr.init(E.Await, .{
                            .value = default,
                        }, loc);
                    }

                    break :brk default;
                };

                try stmts.inside_wrapper_prefix.append(
                    Stmt.alloc(S.SExpr, .{
                        .value = value,
                    }, loc),
                );
            },
        }

        return true;
    }

    /// Code we ultimately include in the bundle is potentially wrapped
    ///
    /// In that case, we do a final pass over the statements list to figure out
    /// where it needs to go in the wrapper, following the syntax of the output
    /// format ESM import and export statements to always be top-level, so they
    /// can never be inside the wrapper.
    ///
    ///      prefix - outer
    ///      ...
    ///      var init_foo = __esm(() => {
    ///          prefix - inner
    ///          ...
    ///          suffix - inenr
    ///      });
    ///      ...
    ///      suffix - outer
    ///
    /// Keep in mind that we may need to wrap ES modules in some cases too
    /// Consider:
    ///   import * as foo from 'bar';
    ///   foo[computedProperty]
    ///
    /// In that case, when bundling, we still need to preserve that module
    /// namespace object (foo) because we cannot know what they are going to
    /// attempt to access statically
    fn convertStmtsForChunk(
        c: *LinkerContext,
        source_index: u32,
        stmts: *StmtList,
        part_stmts: []const js_ast.Stmt,
        chunk: *Chunk,
        allocator: std.mem.Allocator,
        wrap: WrapKind,
        ast: *const JSAst,
    ) !void {
        const shouldExtractESMStmtsForWrap = wrap != .none;
        const shouldStripExports = c.options.mode != .passthrough or c.graph.files.items(.entry_point_kind)[source_index] != .none;

        const flags = c.graph.meta.items(.flags);
        const output_format = c.options.output_format;

        // If this file is a CommonJS entry point, double-write re-exports to the
        // external CommonJS "module.exports" object in addition to our internal ESM
        // export namespace object. The difference between these two objects is that
        // our internal one must not have the "__esModule" marker while the external
        // one must have the "__esModule" marker. This is done because an ES module
        // importing itself should not see the "__esModule" marker but a CommonJS module
        // importing us should see the "__esModule" marker.
        var module_exports_for_export: ?Expr = null;
        if (output_format == .cjs and chunk.isEntryPoint()) {
            module_exports_for_export = Expr.allocate(
                allocator,
                E.Dot,
                E.Dot{
                    .target = Expr.allocate(
                        allocator,
                        E.Identifier,
                        E.Identifier{
                            .ref = c.unbound_module_ref,
                        },
                        Logger.Loc.Empty,
                    ),
                    .name = "exports",
                    .name_loc = Logger.Loc.Empty,
                },
                Logger.Loc.Empty,
            );
        }

        for (part_stmts) |stmt_| {
            var stmt = stmt_;
            process_stmt: {
                switch (stmt.data) {
                    .s_import => |s| {
                        // "import * as ns from 'path'"
                        // "import {foo} from 'path'"
                        if (try c.shouldRemoveImportExportStmt(
                            stmts,
                            stmt.loc,
                            s.namespace_ref,
                            s.import_record_index,
                            allocator,
                            ast,
                        )) {
                            continue;
                        }

                        // Make sure these don't end up in the wrapper closure
                        if (shouldExtractESMStmtsForWrap) {
                            try stmts.outside_wrapper_prefix.append(stmt);
                            continue;
                        }
                    },
                    .s_export_star => |s| {
                        // "export * as ns from 'path'"
                        if (s.alias) |alias| {
                            if (try c.shouldRemoveImportExportStmt(
                                stmts,
                                stmt.loc,
                                s.namespace_ref,
                                s.import_record_index,
                                allocator,
                                ast,
                            )) {
                                continue;
                            }

                            if (shouldStripExports) {
                                // Turn this statement into "import * as ns from 'path'"
                                stmt = Stmt.alloc(
                                    S.Import,
                                    S.Import{
                                        .namespace_ref = s.namespace_ref,
                                        .import_record_index = s.import_record_index,
                                        .star_name_loc = alias.loc,
                                    },
                                    stmt.loc,
                                );
                            }

                            // Make sure these don't end up in the wrapper closure
                            if (shouldExtractESMStmtsForWrap) {
                                try stmts.outside_wrapper_prefix.append(stmt);
                                continue;
                            }

                            break :process_stmt;
                        }

                        // "export * from 'path'"
                        if (!shouldStripExports) {
                            break :process_stmt;
                        }

                        const record = ast.import_records.at(s.import_record_index);

                        // Is this export star evaluated at run time?
                        if (!record.source_index.isValid() and c.options.output_format.keepES6ImportExportSyntax()) {
                            if (record.calls_runtime_re_export_fn) {
                                // Turn this statement into "import * as ns from 'path'"
                                stmt = Stmt.alloc(
                                    S.Import,
                                    S.Import{
                                        .namespace_ref = s.namespace_ref,
                                        .import_record_index = s.import_record_index,
                                        .star_name_loc = stmt.loc,
                                    },
                                    stmt.loc,
                                );

                                // Prefix this module with "__reExport(exports, ns, module.exports)"
                                const export_star_ref = c.runtimeFunction("__reExport");
                                var args = try allocator.alloc(Expr, 2 + @as(usize, @intFromBool(module_exports_for_export != null)));
                                args[0..2].* = .{
                                    Expr.init(
                                        E.Identifier,
                                        E.Identifier{
                                            .ref = ast.exports_ref,
                                        },
                                        stmt.loc,
                                    ),
                                    Expr.init(
                                        E.Identifier,
                                        E.Identifier{
                                            .ref = s.namespace_ref,
                                        },
                                        stmt.loc,
                                    ),
                                };

                                if (module_exports_for_export) |mod| {
                                    args[3] = mod;
                                }

                                try stmts.inside_wrapper_prefix.append(
                                    Stmt.alloc(
                                        S.SExpr,
                                        S.SExpr{
                                            .value = Expr.allocate(
                                                allocator,
                                                E.Call,
                                                E.Call{
                                                    .target = Expr.allocate(
                                                        allocator,
                                                        E.Identifier,
                                                        E.Identifier{
                                                            .ref = export_star_ref,
                                                        },
                                                        stmt.loc,
                                                    ),
                                                    .args = bun.BabyList(Expr).init(args),
                                                },
                                                stmt.loc,
                                            ),
                                        },
                                        stmt.loc,
                                    ),
                                );

                                // Make sure these don't end up in the wrapper closure
                                if (shouldExtractESMStmtsForWrap) {
                                    try stmts.outside_wrapper_prefix.append(stmt);
                                    continue;
                                }
                            }
                        } else {
                            if (record.source_index.isValid()) {
                                const flag = flags[record.source_index.get()];
                                const wrapper_ref = c.graph.ast.items(.wrapper_ref)[record.source_index.get()];
                                if (flag.wrap == .esm and wrapper_ref.isValid()) {
                                    try stmts.inside_wrapper_prefix.append(
                                        Stmt.alloc(S.SExpr, .{
                                            .value = Expr.init(E.Call, .{
                                                .target = Expr.init(
                                                    E.Identifier,
                                                    E.Identifier{
                                                        .ref = wrapper_ref,
                                                    },
                                                    stmt.loc,
                                                ),
                                            }, stmt.loc),
                                        }, stmt.loc),
                                    );
                                }
                            }

                            if (record.calls_runtime_re_export_fn) {
                                const target: Expr = brk: {
                                    if (record.source_index.isValid() and c.graph.ast.items(.exports_kind)[record.source_index.get()].isESMWithDynamicFallback()) {
                                        // Prefix this module with "__reExport(exports, otherExports, module.exports)"
                                        break :brk Expr.initIdentifier(c.graph.ast.items(.exports_ref)[record.source_index.get()], stmt.loc);
                                    }

                                    break :brk Expr.init(
                                        E.RequireString,
                                        E.RequireString{
                                            .import_record_index = s.import_record_index,
                                        },
                                        stmt.loc,
                                    );
                                };

                                // Prefix this module with "__reExport(exports, require(path), module.exports)"
                                const export_star_ref = c.runtimeFunction("__reExport");
                                var args = try allocator.alloc(Expr, 2 + @as(usize, @intFromBool(module_exports_for_export != null)));
                                args[0..2].* = .{
                                    Expr.init(
                                        E.Identifier,
                                        E.Identifier{
                                            .ref = ast.exports_ref,
                                        },
                                        stmt.loc,
                                    ),
                                    target,
                                };

                                if (module_exports_for_export) |mod| {
                                    args[2] = mod;
                                }

                                try stmts.inside_wrapper_prefix.append(
                                    Stmt.alloc(
                                        S.SExpr,
                                        S.SExpr{
                                            .value = Expr.init(
                                                E.Call,
                                                E.Call{
                                                    .target = Expr.init(
                                                        E.Identifier,
                                                        E.Identifier{
                                                            .ref = export_star_ref,
                                                        },
                                                        stmt.loc,
                                                    ),
                                                    .args = js_ast.ExprNodeList.init(args),
                                                },
                                                stmt.loc,
                                            ),
                                        },
                                        stmt.loc,
                                    ),
                                );
                            }

                            // Remove the export star statement
                            continue;
                        }
                    },

                    .s_export_from => |s| {
                        // "export {foo} from 'path'"
                        if (try c.shouldRemoveImportExportStmt(
                            stmts,
                            stmt.loc,
                            s.namespace_ref,
                            s.import_record_index,
                            allocator,
                            ast,
                        )) {
                            continue;
                        }

                        if (shouldStripExports) {
                            // Turn this statement into "import {foo} from 'path'"
                            // TODO: is this allocation necessary?
                            const items = allocator.alloc(js_ast.ClauseItem, s.items.len) catch unreachable;
                            for (s.items, items) |src, *dest| {
                                dest.* = .{
                                    .alias = src.original_name,
                                    .alias_loc = src.alias_loc,
                                    .name = src.name,
                                };
                            }

                            stmt = Stmt.alloc(
                                S.Import,
                                S.Import{
                                    .items = items,
                                    .import_record_index = s.import_record_index,
                                    .namespace_ref = s.namespace_ref,
                                    .is_single_line = s.is_single_line,
                                },
                                stmt.loc,
                            );
                        }

                        // Make sure these don't end up in the wrapper closure
                        if (shouldExtractESMStmtsForWrap) {
                            try stmts.outside_wrapper_prefix.append(stmt);
                            continue;
                        }
                    },

                    .s_export_clause => {
                        // "export {foo}"

                        if (shouldStripExports) {
                            // Remove export statements entirely
                            continue;
                        }

                        // Make sure these don't end up in the wrapper closure
                        if (shouldExtractESMStmtsForWrap) {
                            try stmts.outside_wrapper_prefix.append(stmt);
                            continue;
                        }
                    },

                    .s_function => |s| {
                        // Strip the "export" keyword while bundling
                        if (shouldStripExports and s.func.flags.contains(.is_export)) {
                            // Be c areful to not modify the original statement
                            stmt = Stmt.alloc(
                                S.Function,
                                S.Function{
                                    .func = s.func,
                                },
                                stmt.loc,
                            );
                            stmt.data.s_function.func.flags.remove(.is_export);
                        }
                    },

                    .s_class => |s| {
                        // Strip the "export" keyword while bundling
                        if (shouldStripExports and s.is_export) {
                            // Be careful to not modify the original statement
                            stmt = Stmt.alloc(
                                S.Class,
                                S.Class{
                                    .class = s.class,
                                    .is_export = false,
                                },
                                stmt.loc,
                            );
                        }
                    },

                    .s_local => |s| {
                        // Strip the "export" keyword while bundling
                        if (shouldStripExports and s.is_export) {
                            // Be careful to not modify the original statement
                            stmt = Stmt.alloc(
                                S.Local,
                                s.*,
                                stmt.loc,
                            );
                            stmt.data.s_local.is_export = false;
                        } else if (FeatureFlags.unwrap_commonjs_to_esm and s.was_commonjs_export and wrap == .cjs) {
                            bun.assert(stmt.data.s_local.decls.len == 1);
                            const decl = stmt.data.s_local.decls.ptr[0];
                            if (decl.value) |decl_value| {
                                stmt = Stmt.alloc(
                                    S.SExpr,
                                    S.SExpr{
                                        .value = Expr.init(
                                            E.Binary,
                                            E.Binary{
                                                .op = .bin_assign,
                                                .left = Expr.init(
                                                    E.CommonJSExportIdentifier,
                                                    E.CommonJSExportIdentifier{
                                                        .ref = decl.binding.data.b_identifier.ref,
                                                    },
                                                    decl.binding.loc,
                                                ),
                                                .right = decl_value,
                                            },
                                            stmt.loc,
                                        ),
                                    },
                                    stmt.loc,
                                );
                            } else {
                                continue;
                            }
                        }
                    },

                    .s_export_default => |s| {
                        // "export default foo"

                        if (shouldStripExports) {
                            switch (s.value) {
                                .stmt => |stmt2| {
                                    switch (stmt2.data) {
                                        .s_expr => |s2| {
                                            // "export default foo;" => "var default = foo;"
                                            stmt = Stmt.alloc(
                                                S.Local,
                                                S.Local{
                                                    .decls = try G.Decl.List.fromSlice(
                                                        allocator,
                                                        &.{
                                                            .{
                                                                .binding = Binding.alloc(
                                                                    allocator,
                                                                    B.Identifier{
                                                                        .ref = s.default_name.ref.?,
                                                                    },
                                                                    s2.value.loc,
                                                                ),
                                                                .value = s2.value,
                                                            },
                                                        },
                                                    ),
                                                },
                                                stmt.loc,
                                            );
                                        },
                                        .s_function => |s2| {
                                            // "export default function() {}" => "function default() {}"
                                            // "export default function foo() {}" => "function foo() {}"

                                            // Be careful to not modify the original statement
                                            stmt = Stmt.alloc(
                                                S.Function,
                                                S.Function{
                                                    .func = s2.func,
                                                },
                                                stmt.loc,
                                            );
                                            stmt.data.s_function.func.name = s.default_name;
                                        },

                                        .s_class => |s2| {
                                            // "export default class {}" => "class default {}"
                                            // "export default class foo {}" => "class foo {}"

                                            // Be careful to not modify the original statement
                                            stmt = Stmt.alloc(
                                                S.Class,
                                                S.Class{
                                                    .class = s2.class,
                                                    .is_export = false,
                                                },
                                                stmt.loc,
                                            );
                                            stmt.data.s_class.class.class_name = s.default_name;
                                        },

                                        else => bun.unreachablePanic(
                                            "Unexpected type {any} in source file {s}",
                                            .{
                                                stmt2.data,
                                                c.parse_graph.input_files.get(c.graph.files.get(source_index).input_file.get()).source.path.text,
                                            },
                                        ),
                                    }
                                },
                                .expr => |e| {
                                    stmt = Stmt.alloc(
                                        S.Local,
                                        S.Local{
                                            .decls = try G.Decl.List.fromSlice(
                                                allocator,
                                                &.{
                                                    .{
                                                        .binding = Binding.alloc(
                                                            allocator,
                                                            B.Identifier{
                                                                .ref = s.default_name.ref.?,
                                                            },
                                                            e.loc,
                                                        ),
                                                        .value = e,
                                                    },
                                                },
                                            ),
                                        },
                                        stmt.loc,
                                    );
                                },
                            }
                        }
                    },

                    else => {},
                }
            }

            try stmts.inside_wrapper_suffix.append(stmt);
        }
    }

    /// The conversion logic is completely different for format .internal_bake_dev
    /// For CommonJS, all statements are copied `inside_wrapper_suffix` and this returns.
    ///
    /// For ESM, this function populates all three lists:
    /// 1. outside_wrapper_prefix: all import statements, unmodified.
    /// 2. inside_wrapper_prefix: a var decl line and a call to `module.retrieve`
    /// 3. inside_wrapper_suffix: all non-import statements
    ///
    /// The imports are rewritten at print time to fit the packed array format
    /// that the HMR runtime can decode. This encoding is low on JS objects and
    /// indentation.
    ///
    /// 1 ┃ "module/esm": [ [
    ///   ┃   'module_1', 1, "add",
    ///   ┃   'module_2', 2, "mul", "div",
    ///   ┃   'module_3', 0, // bare or import star
    ///     ], [ "default" ], [], (hmr) => {
    /// 2 ┃   var [module_1, module_2, module_3] = hmr.imports;
    ///   ┃   hmr.onUpdate = [
    ///   ┃     (module) => (module_1 = module),
    ///   ┃     (module) => (module_2 = module),
    ///   ┃     (module) => (module_3 = module),
    ///   ┃   ];
    ///
    /// 3 ┃   console.log("my module", module_1.add(1, module_2.mul(2, 3));
    ///   ┃   module.exports = {
    ///   ┃     default: module_3.something(module_2.div),
    ///   ┃   };
    ///     }, false ],
    ///        ----- "is the module async?"
    fn convertStmtsForChunkForDevServer(
        c: *LinkerContext,
        stmts: *StmtList,
        part_stmts: []const js_ast.Stmt,
        allocator: std.mem.Allocator,
        ast: *JSAst,
    ) !void {
        const hmr_api_ref = ast.wrapper_ref;
        const hmr_api_id = Expr.initIdentifier(hmr_api_ref, Logger.Loc.Empty);
        var esm_decls: std.ArrayListUnmanaged(B.Array.Item) = .empty;
        var esm_callbacks: std.ArrayListUnmanaged(Expr) = .empty;

        for (ast.import_records.slice()) |*record| {
            if (record.path.is_disabled) continue;
            if (record.source_index.isValid() and c.parse_graph.input_files.items(.loader)[record.source_index.get()] == .css) {
                record.path.is_disabled = true;
                continue;
            }
            // Make sure the printer gets the resolved path
            if (record.source_index.isValid()) {
                record.path = c.parse_graph.input_files.items(.source)[record.source_index.get()].path;
            }
        }

        // Modules which do not have side effects
        for (part_stmts) |stmt| switch (stmt.data) {
            else => try stmts.inside_wrapper_suffix.append(stmt),

            .s_import => |st| {
                const record = ast.import_records.mut(st.import_record_index);
                if (record.path.is_disabled) continue;

                const is_builtin = record.tag == .builtin or record.tag == .bun_test or record.tag == .bun or record.tag == .runtime;
                const is_bare_import = st.star_name_loc == null and st.items.len == 0 and st.default_name == null;

                if (is_builtin) {
                    if (!is_bare_import) {
                        // hmr.importBuiltin('...') or hmr.require('bun:wrap')
                        const call = Expr.init(E.Call, .{
                            .target = Expr.init(E.Dot, .{
                                .target = hmr_api_id,
                                .name = if (record.tag == .runtime) "require" else "builtin",
                                .name_loc = stmt.loc,
                            }, stmt.loc),
                            .args = .init(try allocator.dupe(Expr, &.{Expr.init(E.String, .{
                                .data = if (record.tag == .runtime) "bun:wrap" else record.path.pretty,
                            }, record.range.loc)})),
                        }, stmt.loc);

                        // var namespace = ...;
                        try stmts.inside_wrapper_prefix.append(Stmt.alloc(S.Local, .{
                            .kind = .k_var, // remove a tdz
                            .decls = try G.Decl.List.fromSlice(allocator, &.{.{
                                .binding = Binding.alloc(
                                    allocator,
                                    B.Identifier{ .ref = st.namespace_ref },
                                    st.star_name_loc orelse stmt.loc,
                                ),
                                .value = call,
                            }}),
                        }, stmt.loc));
                    }
                } else {
                    const loc = st.star_name_loc orelse stmt.loc;
                    if (is_bare_import) {
                        try esm_decls.append(allocator, .{ .binding = .{ .data = .b_missing, .loc = .Empty } });
                        try esm_callbacks.append(allocator, Expr.init(E.Arrow, .noop_return_undefined, .Empty));
                    } else {
                        const binding = Binding.alloc(allocator, B.Identifier{ .ref = st.namespace_ref }, loc);
                        try esm_decls.append(allocator, .{ .binding = binding });
                        try esm_callbacks.append(allocator, Expr.init(E.Arrow, .{
                            .args = try allocator.dupe(G.Arg, &.{.{
                                .binding = Binding.alloc(allocator, B.Identifier{
                                    .ref = ast.module_ref,
                                }, .Empty),
                            }}),
                            .prefer_expr = true,
                            .body = try .initReturnExpr(allocator, Expr.init(E.Binary, .{
                                .op = .bin_assign,
                                .left = Expr.initIdentifier(st.namespace_ref, .Empty),
                                .right = Expr.initIdentifier(ast.module_ref, .Empty),
                            }, .Empty)),
                        }, .Empty));
                    }

                    try stmts.outside_wrapper_prefix.append(stmt);
                }
            },
        };

        if (esm_decls.items.len > 0) {
            // var ...;
            try stmts.inside_wrapper_prefix.append(Stmt.alloc(S.Local, .{
                .kind = .k_var, // remove a tdz
                .decls = try .fromSlice(allocator, &.{.{
                    .binding = Binding.alloc(allocator, B.Array{
                        .items = esm_decls.items,
                        .is_single_line = true,
                    }, .Empty),
                    .value = Expr.init(E.Dot, .{
                        .target = hmr_api_id,
                        .name = "imports",
                        .name_loc = .Empty,
                    }, .Empty),
                }}),
            }, .Empty));
            // hmr.onUpdate = [ ... ];
            try stmts.inside_wrapper_prefix.append(Stmt.alloc(S.SExpr, .{
                .value = Expr.init(E.Binary, .{
                    .op = .bin_assign,
                    .left = Expr.init(E.Dot, .{
                        .target = hmr_api_id,
                        .name = "updateImport",
                        .name_loc = .Empty,
                    }, .Empty),
                    .right = Expr.init(E.Array, .{
                        .items = .fromList(esm_callbacks),
                        .is_single_line = esm_callbacks.items.len <= 2,
                    }, .Empty),
                }, .Empty),
            }, .Empty));
        }
    }

    fn runtimeFunction(c: *LinkerContext, name: []const u8) Ref {
        return c.graph.runtimeFunction(name);
    }

    fn generateCodeForFileInChunkJS(
        c: *LinkerContext,
        writer: *js_printer.BufferWriter,
        r: renamer.Renamer,
        chunk: *Chunk,
        part_range: PartRange,
        toCommonJSRef: Ref,
        toESMRef: Ref,
        runtimeRequireRef: ?Ref,
        stmts: *StmtList,
        allocator: std.mem.Allocator,
        temp_allocator: std.mem.Allocator,
    ) js_printer.PrintResult {
        const parts: []Part = c.graph.ast.items(.parts)[part_range.source_index.get()].slice()[part_range.part_index_begin..part_range.part_index_end];
        const all_flags: []const JSMeta.Flags = c.graph.meta.items(.flags);
        const flags = all_flags[part_range.source_index.get()];
        const wrapper_part_index = if (flags.wrap != .none)
            c.graph.meta.items(.wrapper_part_index)[part_range.source_index.get()]
        else
            Index.invalid;

        // referencing everything by array makes the code a lot more annoying :(
        var ast: JSAst = c.graph.ast.get(part_range.source_index.get());

        // For HMR, part generation is entirely special cased.
        // - export wrapping is already done.
        // - imports are split from the main code.
        // - one part range per file
        if (c.options.output_format == .internal_bake_dev) brk: {
            if (part_range.source_index.isRuntime()) {
                @branchHint(.cold);
                bun.debugAssert(c.dev_server == null);
                break :brk; // this is from `bun build --format=internal_bake_dev`
            }

            const hmr_api_ref = ast.wrapper_ref;

            for (parts) |part| {
                c.convertStmtsForChunkForDevServer(stmts, part.stmts, allocator, &ast) catch |err|
                    return .{ .err = err };
            }

            const main_stmts_len = stmts.inside_wrapper_prefix.items.len + stmts.inside_wrapper_suffix.items.len;
            const all_stmts_len = main_stmts_len + stmts.outside_wrapper_prefix.items.len + 1;

            stmts.all_stmts.ensureUnusedCapacity(all_stmts_len) catch bun.outOfMemory();
            stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_prefix.items);
            stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_suffix.items);

            const inner = stmts.all_stmts.items[0..main_stmts_len];

            var clousure_args = std.BoundedArray(G.Arg, 3).fromSlice(&.{
                .{ .binding = Binding.alloc(temp_allocator, B.Identifier{
                    .ref = hmr_api_ref,
                }, Logger.Loc.Empty) },
            }) catch unreachable; // is within bounds

            if (ast.flags.uses_module_ref or ast.flags.uses_exports_ref) {
                clousure_args.appendSliceAssumeCapacity(&.{
                    .{
                        .binding = Binding.alloc(temp_allocator, B.Identifier{
                            .ref = ast.module_ref,
                        }, Logger.Loc.Empty),
                    },
                    .{
                        .binding = Binding.alloc(temp_allocator, B.Identifier{
                            .ref = ast.exports_ref,
                        }, Logger.Loc.Empty),
                    },
                });
            }

            stmts.all_stmts.appendAssumeCapacity(Stmt.allocateExpr(temp_allocator, Expr.init(E.Function, .{ .func = .{
                .args = temp_allocator.dupe(G.Arg, clousure_args.slice()) catch bun.outOfMemory(),
                .body = .{
                    .stmts = inner,
                    .loc = Logger.Loc.Empty,
                },
            } }, Logger.Loc.Empty)));
            stmts.all_stmts.appendSliceAssumeCapacity(stmts.outside_wrapper_prefix.items);

            ast.flags.uses_module_ref = true;

            // TODO: there is a weird edge case where the pretty path is not computed
            // it does not reproduce when debugging.
            var source = c.getSource(part_range.source_index.get()).*;
            if (source.path.text.ptr == source.path.pretty.ptr) {
                source.path = genericPathWithPrettyInitialized(
                    source.path,
                    c.options.target,
                    c.resolver.fs.top_level_dir,
                    allocator,
                ) catch bun.outOfMemory();
            }

            return c.printCodeForFileInChunkJS(
                r,
                allocator,
                writer,
                stmts.all_stmts.items[main_stmts_len..],
                &ast,
                flags,
                .None,
                .None,
                null,
                part_range.source_index,
                &source,
            );
        }

        var needs_wrapper = false;

        const namespace_export_part_index = js_ast.namespace_export_part_index;

        stmts.reset();

        const part_index_for_lazy_default_export: u32 = brk: {
            if (ast.flags.has_lazy_export) {
                if (c.graph.meta.items(.resolved_exports)[part_range.source_index.get()].get("default")) |default| {
                    break :brk c.graph.topLevelSymbolToParts(part_range.source_index.get(), default.data.import_ref)[0];
                }
            }
            break :brk std.math.maxInt(u32);
        };

        const output_format = c.options.output_format;

        // The top-level directive must come first (the non-wrapped case is handled
        // by the chunk generation code, although only for the entry point)
        if (flags.wrap != .none and ast.flags.has_explicit_use_strict_directive and !chunk.isEntryPoint() and !output_format.isAlwaysStrictMode()) {
            stmts.inside_wrapper_prefix.append(Stmt.alloc(S.Directive, .{
                .value = "use strict",
            }, Logger.Loc.Empty)) catch unreachable;
        }

        // TODO: handle directive
        if (namespace_export_part_index >= part_range.part_index_begin and
            namespace_export_part_index < part_range.part_index_end and
            parts[namespace_export_part_index].is_live)
        {
            c.convertStmtsForChunk(
                part_range.source_index.get(),
                stmts,
                parts[namespace_export_part_index].stmts,
                chunk,
                temp_allocator,
                flags.wrap,
                &ast,
            ) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                return .{ .err = err };
            };

            switch (flags.wrap) {
                .esm => {
                    stmts.outside_wrapper_prefix.appendSlice(stmts.inside_wrapper_suffix.items) catch unreachable;
                },
                else => {
                    stmts.inside_wrapper_prefix.appendSlice(stmts.inside_wrapper_suffix.items) catch unreachable;
                },
            }

            stmts.inside_wrapper_suffix.clearRetainingCapacity();
        }

        // Add all other parts in this chunk
        for (parts, 0..) |part, index_| {
            const index = part_range.part_index_begin + @as(u32, @truncate(index_));
            if (!part.is_live) {
                // Skip the part if it's not in this chunk
                continue;
            }

            if (index == namespace_export_part_index) {
                // Skip the namespace export part because we already handled it above
                continue;
            }

            if (index == wrapper_part_index.get()) {
                // Skip the wrapper part because we already handled it above
                needs_wrapper = true;
                continue;
            }

            var single_stmts_list = [1]Stmt{undefined};
            var part_stmts = part.stmts;

            // If this could be a JSON or TOML file that exports a top-level object literal, go
            // over the non-default top-level properties that ended up being imported
            // and substitute references to them into the main top-level object literal.
            // So this JSON file:
            //
            //   {
            //     "foo": [1, 2, 3],
            //     "bar": [4, 5, 6],
            //   }
            //
            // is initially compiled into this:
            //
            //   export var foo = [1, 2, 3];
            //   export var bar = [4, 5, 6];
            //   export default {
            //     foo: [1, 2, 3],
            //     bar: [4, 5, 6],
            //   };
            //
            // But we turn it into this if both "foo" and "default" are imported:
            //
            //   export var foo = [1, 2, 3];
            //   export default {
            //     foo,
            //     bar: [4, 5, 6],
            //   };
            //
            if (index == part_index_for_lazy_default_export) {
                bun.assert(index != std.math.maxInt(u32));

                const stmt = part_stmts[0];

                if (stmt.data != .s_export_default)
                    @panic("expected Lazy default export to be an export default statement");

                const default_export = stmt.data.s_export_default;
                var default_expr = default_export.value.expr;

                // Be careful: the top-level value in a JSON file is not necessarily an object
                if (default_expr.data == .e_object) {
                    var new_properties = default_expr.data.e_object.properties.clone(temp_allocator) catch unreachable;

                    var resolved_exports = c.graph.meta.items(.resolved_exports)[part_range.source_index.get()];

                    // If any top-level properties ended up being imported directly, change
                    // the property to just reference the corresponding variable instead
                    for (new_properties.slice()) |*prop| {
                        if (prop.key == null or prop.key.?.data != .e_string or prop.value == null) continue;
                        const name = prop.key.?.data.e_string.slice(temp_allocator);
                        if (strings.eqlComptime(name, "default") or
                            strings.eqlComptime(name, "__esModule") or
                            !bun.js_lexer.isIdentifier(name)) continue;

                        if (resolved_exports.get(name)) |export_data| {
                            const export_ref = export_data.data.import_ref;
                            const export_part = ast.parts.slice()[c.graph.topLevelSymbolToParts(part_range.source_index.get(), export_ref)[0]];
                            if (export_part.is_live) {
                                prop.* = .{
                                    .key = prop.key,
                                    .value = Expr.initIdentifier(export_ref, prop.value.?.loc),
                                };
                            }
                        }
                    }

                    default_expr = Expr.allocate(
                        temp_allocator,
                        E.Object,
                        E.Object{
                            .properties = new_properties,
                        },
                        default_expr.loc,
                    );
                }

                single_stmts_list[0] = Stmt.allocate(
                    temp_allocator,
                    S.ExportDefault,
                    .{
                        .default_name = default_export.default_name,
                        .value = .{ .expr = default_expr },
                    },
                    stmt.loc,
                );
                part_stmts = single_stmts_list[0..];
            }

            c.convertStmtsForChunk(
                part_range.source_index.get(),
                stmts,
                part_stmts,
                chunk,
                temp_allocator,
                flags.wrap,
                &ast,
            ) catch |err| return .{
                .err = err,
            };
        }

        // Hoist all import statements before any normal statements. ES6 imports
        // are different than CommonJS imports. All modules imported via ES6 import
        // statements are evaluated before the module doing the importing is
        // evaluated (well, except for cyclic import scenarios). We need to preserve
        // these semantics even when modules imported via ES6 import statements end
        // up being CommonJS modules.
        stmts.all_stmts.ensureUnusedCapacity(stmts.inside_wrapper_prefix.items.len + stmts.inside_wrapper_suffix.items.len) catch unreachable;
        stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_prefix.items);
        stmts.all_stmts.appendSliceAssumeCapacity(stmts.inside_wrapper_suffix.items);
        stmts.inside_wrapper_prefix.items.len = 0;
        stmts.inside_wrapper_suffix.items.len = 0;

        if (c.options.minify_syntax) {
            mergeAdjacentLocalStmts(&stmts.all_stmts, temp_allocator);
        }

        var out_stmts: []js_ast.Stmt = stmts.all_stmts.items;

        // Optionally wrap all statements in a closure
        if (needs_wrapper) {
            switch (flags.wrap) {
                .cjs => {
                    // Only include the arguments that are actually used
                    var args = std.ArrayList(G.Arg).initCapacity(
                        temp_allocator,
                        if (ast.flags.uses_module_ref or ast.flags.uses_exports_ref) 2 else 0,
                    ) catch unreachable;

                    if (ast.flags.uses_module_ref or ast.flags.uses_exports_ref) {
                        args.appendAssumeCapacity(
                            G.Arg{
                                .binding = Binding.alloc(
                                    temp_allocator,
                                    B.Identifier{
                                        .ref = ast.exports_ref,
                                    },
                                    Logger.Loc.Empty,
                                ),
                            },
                        );

                        if (ast.flags.uses_module_ref) {
                            args.appendAssumeCapacity(
                                G.Arg{
                                    .binding = Binding.alloc(
                                        temp_allocator,
                                        B.Identifier{
                                            .ref = ast.module_ref,
                                        },
                                        Logger.Loc.Empty,
                                    ),
                                },
                            );
                        }
                    }

                    // TODO: variants of the runtime functions
                    var cjs_args = temp_allocator.alloc(Expr, 1) catch unreachable;
                    cjs_args[0] = Expr.init(
                        E.Arrow,
                        E.Arrow{
                            .args = args.items,
                            .body = .{
                                .stmts = stmts.all_stmts.items,
                                .loc = Logger.Loc.Empty,
                            },
                        },
                        Logger.Loc.Empty,
                    );

                    const commonjs_wrapper_definition = Expr.init(
                        E.Call,
                        E.Call{
                            .target = Expr.init(
                                E.Identifier,
                                E.Identifier{
                                    .ref = c.cjs_runtime_ref,
                                },
                                Logger.Loc.Empty,
                            ),
                            .args = bun.BabyList(Expr).init(cjs_args),
                        },
                        Logger.Loc.Empty,
                    );

                    // "var require_foo = __commonJS(...);"
                    {
                        var decls = temp_allocator.alloc(G.Decl, 1) catch unreachable;
                        decls[0] = G.Decl{
                            .binding = Binding.alloc(
                                temp_allocator,
                                B.Identifier{
                                    .ref = ast.wrapper_ref,
                                },
                                Logger.Loc.Empty,
                            ),
                            .value = commonjs_wrapper_definition,
                        };

                        stmts.outside_wrapper_prefix.append(
                            Stmt.alloc(
                                S.Local,
                                S.Local{
                                    .decls = G.Decl.List.init(decls),
                                },
                                Logger.Loc.Empty,
                            ),
                        ) catch unreachable;
                    }
                },
                .esm => {
                    // The wrapper only needs to be "async" if there is a transitive async
                    // dependency. For correctness, we must not use "async" if the module
                    // isn't async because then calling "require()" on that module would
                    // swallow any exceptions thrown during module initialization.
                    const is_async = flags.is_async_or_has_async_dependency;

                    const ExportHoist = struct {
                        decls: std.ArrayListUnmanaged(G.Decl),
                        allocator: std.mem.Allocator,

                        pub fn wrapIdentifier(w: *@This(), loc: Logger.Loc, ref: Ref) Expr {
                            w.decls.append(
                                w.allocator,
                                .{
                                    .binding = Binding.alloc(
                                        w.allocator,
                                        B.Identifier{
                                            .ref = ref,
                                        },
                                        loc,
                                    ),
                                    .value = null,
                                },
                            ) catch bun.outOfMemory();

                            return Expr.initIdentifier(ref, loc);
                        }
                    };

                    var hoist = ExportHoist{
                        .decls = .{},
                        .allocator = temp_allocator,
                    };

                    var inner_stmts = stmts.all_stmts.items;

                    // Hoist all top-level "var" and "function" declarations out of the closure
                    {
                        var end: usize = 0;
                        for (stmts.all_stmts.items) |stmt| {
                            const transformed = switch (stmt.data) {
                                .s_local => |local| stmt: {
                                    // Convert the declarations to assignments
                                    var value = Expr.empty;
                                    for (local.decls.slice()) |*decl| {
                                        if (decl.value) |initializer| {
                                            const can_be_moved = initializer.canBeMoved();
                                            if (can_be_moved) {
                                                // if the value can be moved, move the decl directly to preserve destructuring
                                                // ie `const { main } = class { static main() {} }` => `var {main} = class { static main() {} }`
                                                hoist.decls.append(hoist.allocator, decl.*) catch bun.outOfMemory();
                                            } else {
                                                // if the value cannot be moved, add every destructuring key seperately
                                                // ie `var { append } = { append() {} }` => `var append; __esm(() => ({ append } = { append() {} }))`
                                                const binding = decl.binding.toExpr(&hoist);
                                                value = value.joinWithComma(
                                                    binding.assign(initializer),
                                                    temp_allocator,
                                                );
                                            }
                                        } else {
                                            _ = decl.binding.toExpr(&hoist);
                                        }
                                    }

                                    if (value.isEmpty()) {
                                        continue;
                                    }

                                    break :stmt Stmt.allocateExpr(temp_allocator, value);
                                },
                                .s_function => {
                                    stmts.outside_wrapper_prefix.append(stmt) catch bun.outOfMemory();
                                    continue;
                                },
                                .s_class => |class| stmt: {
                                    if (class.class.canBeMoved()) {
                                        stmts.outside_wrapper_prefix.append(stmt) catch bun.outOfMemory();
                                        continue;
                                    }

                                    break :stmt Stmt.allocateExpr(
                                        temp_allocator,
                                        Expr.assign(hoist.wrapIdentifier(
                                            class.class.class_name.?.loc,
                                            class.class.class_name.?.ref.?,
                                        ), .{
                                            .data = .{ .e_class = &class.class },
                                            .loc = stmt.loc,
                                        }),
                                    );
                                },
                                else => stmt,
                            };

                            inner_stmts[end] = transformed;
                            end += 1;
                        }
                        inner_stmts.len = end;
                    }

                    if (hoist.decls.items.len > 0) {
                        stmts.outside_wrapper_prefix.append(
                            Stmt.alloc(
                                S.Local,
                                S.Local{
                                    .decls = G.Decl.List.fromList(hoist.decls),
                                },
                                Logger.Loc.Empty,
                            ),
                        ) catch unreachable;
                        hoist.decls.items.len = 0;
                    }

                    if (inner_stmts.len > 0) {
                        // See the comment in needsWrapperRef for why the symbol
                        // is sometimes not generated.
                        bun.assert(!ast.wrapper_ref.isEmpty()); // js_parser's needsWrapperRef thought wrapper was not needed

                        // "__esm(() => { ... })"
                        var esm_args = temp_allocator.alloc(Expr, 1) catch bun.outOfMemory();
                        esm_args[0] = Expr.init(E.Arrow, .{
                            .args = &.{},
                            .is_async = is_async,
                            .body = .{
                                .stmts = inner_stmts,
                                .loc = Logger.Loc.Empty,
                            },
                        }, Logger.Loc.Empty);

                        // "var init_foo = __esm(...);"
                        const value = Expr.init(E.Call, .{
                            .target = Expr.initIdentifier(c.esm_runtime_ref, Logger.Loc.Empty),
                            .args = bun.BabyList(Expr).init(esm_args),
                        }, Logger.Loc.Empty);

                        var decls = temp_allocator.alloc(G.Decl, 1) catch bun.outOfMemory();
                        decls[0] = G.Decl{
                            .binding = Binding.alloc(
                                temp_allocator,
                                B.Identifier{
                                    .ref = ast.wrapper_ref,
                                },
                                Logger.Loc.Empty,
                            ),
                            .value = value,
                        };

                        stmts.outside_wrapper_prefix.append(
                            Stmt.alloc(S.Local, .{
                                .decls = G.Decl.List.init(decls),
                            }, Logger.Loc.Empty),
                        ) catch bun.outOfMemory();
                    } else {
                        // // If this fails, then there will be places we reference
                        // // `init_foo` without it actually existing.
                        // bun.assert(ast.wrapper_ref.isEmpty());

                        // TODO: the edge case where we are wrong is when there
                        // are references to other ESM modules, but those get
                        // fully hoisted. The look like side effects, but they
                        // are removed.
                        //
                        // It is too late to retroactively delete the
                        // wrapper_ref, since printing has already begun.  The
                        // most we can do to salvage the situation is to print
                        // an empty arrow function.
                        //
                        // This is marked as a TODO, because this can be solved
                        // via a count of external modules, decremented during
                        // linking.
                        if (!ast.wrapper_ref.isEmpty()) {
                            const value = Expr.init(E.Arrow, .{
                                .args = &.{},
                                .is_async = is_async,
                                .body = .{
                                    .stmts = inner_stmts,
                                    .loc = Logger.Loc.Empty,
                                },
                            }, Logger.Loc.Empty);

                            stmts.outside_wrapper_prefix.append(
                                Stmt.alloc(S.Local, .{
                                    .decls = G.Decl.List.fromSlice(temp_allocator, &.{.{
                                        .binding = Binding.alloc(
                                            temp_allocator,
                                            B.Identifier{
                                                .ref = ast.wrapper_ref,
                                            },
                                            Logger.Loc.Empty,
                                        ),
                                        .value = value,
                                    }}) catch bun.outOfMemory(),
                                }, Logger.Loc.Empty),
                            ) catch bun.outOfMemory();
                        }
                    }
                },
                else => {},
            }

            out_stmts = stmts.outside_wrapper_prefix.items;
        }

        if (out_stmts.len == 0) {
            return .{
                .result = .{
                    .code = &[_]u8{},
                    .source_map = null,
                },
            };
        }

        return c.printCodeForFileInChunkJS(
            r,
            allocator,
            writer,
            out_stmts,
            &ast,
            flags,
            toESMRef,
            toCommonJSRef,
            runtimeRequireRef,
            part_range.source_index,
            c.getSource(part_range.source_index.get()),
        );
    }

    fn printCodeForFileInChunkJS(
        c: *LinkerContext,
        r: renamer.Renamer,
        allocator: std.mem.Allocator,
        writer: *js_printer.BufferWriter,
        out_stmts: []Stmt,
        ast: *const js_ast.BundledAst,
        flags: JSMeta.Flags,
        to_esm_ref: Ref,
        to_commonjs_ref: Ref,
        runtime_require_ref: ?Ref,
        source_index: Index,
        source: *const bun.logger.Source,
    ) js_printer.PrintResult {
        const parts_to_print = &[_]Part{
            .{ .stmts = out_stmts },
        };

        const print_options = js_printer.Options{
            .bundling = true,
            // TODO: IIFE
            .indent = .{},
            .commonjs_named_exports = ast.commonjs_named_exports,
            .commonjs_named_exports_ref = ast.exports_ref,
            .commonjs_module_ref = if (ast.flags.uses_module_ref)
                ast.module_ref
            else
                Ref.None,
            .commonjs_named_exports_deoptimized = flags.wrap == .cjs,
            .commonjs_module_exports_assigned_deoptimized = ast.flags.commonjs_module_exports_assigned_deoptimized,
            // .const_values = c.graph.const_values,
            .ts_enums = c.graph.ts_enums,

            .minify_whitespace = c.options.minify_whitespace,
            .minify_syntax = c.options.minify_syntax,
            .module_type = c.options.output_format,
            .print_dce_annotations = c.options.emit_dce_annotations,
            .has_run_symbol_renamer = true,

            .allocator = allocator,
            .source_map_allocator = if (c.dev_server != null and
                c.parse_graph.input_files.items(.loader)[source_index.get()].isJavaScriptLike())
                // The loader check avoids globally allocating asset source maps
                writer.buffer.allocator
            else
                allocator,
            .to_esm_ref = to_esm_ref,
            .to_commonjs_ref = to_commonjs_ref,
            .require_ref = switch (c.options.output_format) {
                .cjs => null, // use unbounded global
                else => runtime_require_ref,
            },
            .require_or_import_meta_for_source_callback = .init(
                LinkerContext,
                requireOrImportMetaForSource,
                c,
            ),
            .line_offset_tables = c.graph.files.items(.line_offset_table)[source_index.get()],
            .target = c.options.target,

            .hmr_ref = if (c.options.output_format == .internal_bake_dev)
                ast.wrapper_ref
            else
                .None,

            .input_files_for_dev_server = if (c.options.output_format == .internal_bake_dev)
                c.parse_graph.input_files.items(.source)
            else
                null,
            .mangled_props = &c.mangled_props,
        };

        writer.buffer.reset();
        var printer = js_printer.BufferPrinter.init(writer.*);
        defer writer.* = printer.ctx;

        switch (c.options.source_maps != .none and !source_index.isRuntime()) {
            inline else => |enable_source_maps| {
                return js_printer.printWithWriter(
                    *js_printer.BufferPrinter,
                    &printer,
                    ast.target,
                    ast.toAST(),
                    source,
                    print_options,
                    ast.import_records.slice(),
                    parts_to_print,
                    r,
                    enable_source_maps,
                );
            },
        }
    }

    const PendingPartRange = struct {
        part_range: PartRange,
        task: ThreadPoolLib.Task,
        ctx: *GenerateChunkCtx,
        i: u32 = 0,
    };

    fn requireOrImportMetaForSource(
        c: *LinkerContext,
        source_index: Index.Int,
        was_unwrapped_require: bool,
    ) js_printer.RequireOrImportMeta {
        const flags = c.graph.meta.items(.flags)[source_index];
        return .{
            .exports_ref = if (flags.wrap == .esm or (was_unwrapped_require and c.graph.ast.items(.flags)[source_index].force_cjs_to_esm))
                c.graph.ast.items(.exports_ref)[source_index]
            else
                Ref.None,
            .is_wrapper_async = flags.is_async_or_has_async_dependency,
            .wrapper_ref = c.graph.ast.items(.wrapper_ref)[source_index],

            .was_unwrapped_require = was_unwrapped_require and c.graph.ast.items(.flags)[source_index].force_cjs_to_esm,
        };
    }

    const SubstituteChunkFinalPathResult = struct {
        j: StringJoiner,
        shifts: []sourcemap.SourceMapShifts,
    };

    fn mangleLocalCss(c: *LinkerContext) void {
        if (c.has_any_css_locals.load(.monotonic) == 0) return;

        const all_css_asts: []?*bun.css.BundlerStyleSheet = c.graph.ast.items(.css);
        const all_symbols: []Symbol.List = c.graph.ast.items(.symbols);
        const all_sources: []Logger.Source = c.parse_graph.input_files.items(.source);

        // Collect all local css names
        var sfb = std.heap.stackFallback(512, c.allocator);
        const allocator = sfb.get();
        var local_css_names = std.AutoHashMap(bun.bundle_v2.Ref, void).init(allocator);
        defer local_css_names.deinit();

        for (all_css_asts, 0..) |maybe_css_ast, source_index| {
            if (maybe_css_ast) |css_ast| {
                if (css_ast.local_scope.count() == 0) continue;
                const symbols = all_symbols[source_index];
                for (symbols.sliceConst(), 0..) |*symbol_, inner_index| {
                    var symbol = symbol_;
                    if (symbol.kind == .local_css) {
                        const ref = ref: {
                            var ref = Ref.init(@intCast(inner_index), @intCast(source_index), false);
                            ref.tag = .symbol;
                            while (symbol.hasLink()) {
                                ref = symbol.link;
                                symbol = all_symbols[ref.source_index].at(ref.inner_index);
                            }
                            break :ref ref;
                        };

                        const entry = local_css_names.getOrPut(ref) catch bun.outOfMemory();
                        if (entry.found_existing) continue;

                        const source = all_sources[ref.source_index];

                        const original_name = symbol.original_name;
                        const path_hash = bun.css.css_modules.hash(
                            allocator,
                            "{s}",
                            // use path relative to cwd for determinism
                            .{source.path.pretty},
                            false,
                        );

                        const final_generated_name = std.fmt.allocPrint(c.graph.allocator, "{s}_{s}", .{ original_name, path_hash }) catch bun.outOfMemory();
                        c.mangled_props.put(c.allocator, ref, final_generated_name) catch bun.outOfMemory();
                    }
                }
            }
        }
    }

    pub fn generateChunksInParallel(c: *LinkerContext, chunks: []Chunk, comptime is_dev_server: bool) !if (is_dev_server) void else std.ArrayList(options.OutputFile) {
        const trace = bun.perf.trace("Bundler.generateChunksInParallel");
        defer trace.end();

        c.mangleLocalCss();

        var has_js_chunk = false;
        var has_css_chunk = false;
        var has_html_chunk = false;
        bun.assert(chunks.len > 0);

        {
            // TODO(@paperclover/bake): instead of running a renamer per chunk, run it per file
            debug(" START {d} renamers", .{chunks.len});
            defer debug("  DONE {d} renamers", .{chunks.len});
            var wait_group = try c.allocator.create(sync.WaitGroup);
            wait_group.init();
            defer {
                wait_group.deinit();
                c.allocator.destroy(wait_group);
            }
            wait_group.counter = @as(u32, @truncate(chunks.len));
            const ctx = GenerateChunkCtx{ .chunk = &chunks[0], .wg = wait_group, .c = c, .chunks = chunks };
            try c.parse_graph.pool.worker_pool.doPtr(c.allocator, wait_group, ctx, generateJSRenamer, chunks);
        }

        if (c.source_maps.line_offset_tasks.len > 0) {
            debug(" START {d} source maps (line offset)", .{chunks.len});
            defer debug("  DONE {d} source maps (line offset)", .{chunks.len});
            c.source_maps.line_offset_wait_group.wait();
            c.allocator.free(c.source_maps.line_offset_tasks);
            c.source_maps.line_offset_tasks.len = 0;
        }

        {
            // Per CSS chunk:
            // Remove duplicate rules across files. This must be done in serial, not
            // in parallel, and must be done from the last rule to the first rule.
            if (c.parse_graph.css_file_count > 0) {
                var wait_group = try c.allocator.create(sync.WaitGroup);
                wait_group.init();
                defer {
                    wait_group.deinit();
                    c.allocator.destroy(wait_group);
                }
                const total_count = total_count: {
                    var total_count: usize = 0;
                    for (chunks) |*chunk| {
                        if (chunk.content == .css) total_count += 1;
                    }
                    break :total_count total_count;
                };

                debug(" START {d} prepare CSS ast (total count)", .{total_count});
                defer debug("  DONE {d} prepare CSS ast (total count)", .{total_count});

                var batch = ThreadPoolLib.Batch{};
                const tasks = c.allocator.alloc(PrepareCssAstTask, total_count) catch bun.outOfMemory();
                var i: usize = 0;
                for (chunks) |*chunk| {
                    if (chunk.content == .css) {
                        tasks[i] = PrepareCssAstTask{
                            .task = ThreadPoolLib.Task{
                                .callback = &prepareCssAstsForChunk,
                            },
                            .chunk = chunk,
                            .linker = c,
                            .wg = wait_group,
                        };
                        batch.push(.from(&tasks[i].task));
                        i += 1;
                    }
                }
                wait_group.counter = @as(u32, @truncate(total_count));
                c.parse_graph.pool.worker_pool.schedule(batch);
                wait_group.wait();
            } else if (Environment.isDebug) {
                for (chunks) |*chunk| {
                    bun.assert(chunk.content != .css);
                }
            }
        }

        {
            const chunk_contexts = c.allocator.alloc(GenerateChunkCtx, chunks.len) catch unreachable;
            defer c.allocator.free(chunk_contexts);
            var wait_group = try c.allocator.create(sync.WaitGroup);
            wait_group.init();

            defer {
                wait_group.deinit();
                c.allocator.destroy(wait_group);
            }
            errdefer wait_group.wait();
            {
                var total_count: usize = 0;
                for (chunks, chunk_contexts) |*chunk, *chunk_ctx| {
                    switch (chunk.content) {
                        .javascript => {
                            chunk_ctx.* = .{ .wg = wait_group, .c = c, .chunks = chunks, .chunk = chunk };
                            total_count += chunk.content.javascript.parts_in_chunk_in_order.len;
                            chunk.compile_results_for_chunk = c.allocator.alloc(CompileResult, chunk.content.javascript.parts_in_chunk_in_order.len) catch bun.outOfMemory();
                            has_js_chunk = true;
                        },
                        .css => {
                            has_css_chunk = true;
                            chunk_ctx.* = .{ .wg = wait_group, .c = c, .chunks = chunks, .chunk = chunk };
                            total_count += chunk.content.css.imports_in_chunk_in_order.len;
                            chunk.compile_results_for_chunk = c.allocator.alloc(CompileResult, chunk.content.css.imports_in_chunk_in_order.len) catch bun.outOfMemory();
                        },
                        .html => {
                            has_html_chunk = true;
                            // HTML gets only one chunk.
                            chunk_ctx.* = .{ .wg = wait_group, .c = c, .chunks = chunks, .chunk = chunk };
                            total_count += 1;
                            chunk.compile_results_for_chunk = c.allocator.alloc(CompileResult, 1) catch bun.outOfMemory();
                        },
                    }
                }

                debug(" START {d} compiling part ranges", .{total_count});
                defer debug("  DONE {d} compiling part ranges", .{total_count});
                const combined_part_ranges = c.allocator.alloc(PendingPartRange, total_count) catch unreachable;
                defer c.allocator.free(combined_part_ranges);
                var remaining_part_ranges = combined_part_ranges;
                var batch = ThreadPoolLib.Batch{};
                for (chunks, chunk_contexts) |*chunk, *chunk_ctx| {
                    switch (chunk.content) {
                        .javascript => {
                            for (chunk.content.javascript.parts_in_chunk_in_order, 0..) |part_range, i| {
                                if (Environment.enable_logs) {
                                    debugPartRanges(
                                        "Part Range: {s} {s} ({d}..{d})",
                                        .{
                                            c.parse_graph.input_files.items(.source)[part_range.source_index.get()].path.pretty,
                                            @tagName(c.parse_graph.ast.items(.target)[part_range.source_index.get()].bakeGraph()),
                                            part_range.part_index_begin,
                                            part_range.part_index_end,
                                        },
                                    );
                                }

                                remaining_part_ranges[0] = .{
                                    .part_range = part_range,
                                    .i = @intCast(i),
                                    .task = .{
                                        .callback = &generateCompileResultForJSChunk,
                                    },
                                    .ctx = chunk_ctx,
                                };
                                batch.push(.from(&remaining_part_ranges[0].task));

                                remaining_part_ranges = remaining_part_ranges[1..];
                            }
                        },
                        .css => {
                            for (0..chunk.content.css.imports_in_chunk_in_order.len) |i| {
                                remaining_part_ranges[0] = .{
                                    .part_range = .{},
                                    .i = @intCast(i),
                                    .task = .{
                                        .callback = &generateCompileResultForCssChunk,
                                    },
                                    .ctx = chunk_ctx,
                                };
                                batch.push(.from(&remaining_part_ranges[0].task));

                                remaining_part_ranges = remaining_part_ranges[1..];
                            }
                        },
                        .html => {
                            remaining_part_ranges[0] = .{
                                .part_range = .{},
                                .i = 0,
                                .task = .{
                                    .callback = &generateCompileResultForHtmlChunk,
                                },
                                .ctx = chunk_ctx,
                            };

                            batch.push(.from(&remaining_part_ranges[0].task));
                            remaining_part_ranges = remaining_part_ranges[1..];
                        },
                    }
                }
                wait_group.counter = @as(u32, @truncate(total_count));
                c.parse_graph.pool.worker_pool.schedule(batch);
                wait_group.wait();
            }

            if (c.source_maps.quoted_contents_tasks.len > 0) {
                debug(" START {d} source maps (quoted contents)", .{chunks.len});
                defer debug("  DONE {d} source maps (quoted contents)", .{chunks.len});
                c.source_maps.quoted_contents_wait_group.wait();
                c.allocator.free(c.source_maps.quoted_contents_tasks);
                c.source_maps.quoted_contents_tasks.len = 0;
            }

            // For dev server, only post-process CSS + HTML chunks.
            const chunks_to_do = if (is_dev_server) chunks[1..] else chunks;
            if (!is_dev_server or chunks_to_do.len > 0) {
                bun.assert(chunks_to_do.len > 0);
                debug(" START {d} postprocess chunks", .{chunks_to_do.len});
                defer debug("  DONE {d} postprocess chunks", .{chunks_to_do.len});
                wait_group.init();
                wait_group.counter = @as(u32, @truncate(chunks_to_do.len));

                try c.parse_graph.pool.worker_pool.doPtr(
                    c.allocator,
                    wait_group,
                    chunk_contexts[0],
                    generateChunk,
                    chunks_to_do,
                );
            }
        }

        // When bake.DevServer is in use, we're going to take a different code path at the end.
        // We want to extract the source code of each part instead of combining it into a single file.
        // This is so that when hot-module updates happen, we can:
        //
        // - Reuse unchanged parts to assemble the full bundle if Cmd+R is used in the browser
        // - Send only the newly changed code through a socket.
        // - Use IncrementalGraph to have full knowledge of referenced CSS files.
        //
        // When this isn't the initial bundle, concatenation as usual would produce a
        // broken module. It is DevServer's job to create and send HMR patches.
        if (is_dev_server) return;

        // TODO: enforceNoCyclicChunkImports()
        {
            var path_names_map = bun.StringHashMap(void).init(c.allocator);
            defer path_names_map.deinit();

            const DuplicateEntry = struct {
                sources: std.ArrayListUnmanaged(*Chunk) = .{},
            };
            var duplicates_map: bun.StringArrayHashMapUnmanaged(DuplicateEntry) = .{};

            var chunk_visit_map = try AutoBitSet.initEmpty(c.allocator, chunks.len);
            defer chunk_visit_map.deinit(c.allocator);

            // Compute the final hashes of each chunk, then use those to create the final
            // paths of each chunk. This can technically be done in parallel but it
            // probably doesn't matter so much because we're not hashing that much data.
            for (chunks, 0..) |*chunk, index| {
                var hash: ContentHasher = .{};
                c.appendIsolatedHashesForImportedChunks(&hash, chunks, @intCast(index), &chunk_visit_map);
                chunk_visit_map.setAll(false);
                chunk.template.placeholder.hash = hash.digest();

                const rel_path = std.fmt.allocPrint(c.allocator, "{any}", .{chunk.template}) catch bun.outOfMemory();
                bun.path.platformToPosixInPlace(u8, rel_path);

                if ((try path_names_map.getOrPut(rel_path)).found_existing) {
                    // collect all duplicates in a list
                    const dup = try duplicates_map.getOrPut(bun.default_allocator, rel_path);
                    if (!dup.found_existing) dup.value_ptr.* = .{};
                    try dup.value_ptr.sources.append(bun.default_allocator, chunk);
                    continue;
                }

                // resolve any /./ and /../ occurrences
                // use resolvePosix since we asserted above all seps are '/'
                if (Environment.isWindows and std.mem.indexOf(u8, rel_path, "/./") != null) {
                    var buf: bun.PathBuffer = undefined;
                    const rel_path_fixed = c.allocator.dupe(u8, bun.path.normalizeBuf(rel_path, &buf, .posix)) catch bun.outOfMemory();
                    chunk.final_rel_path = rel_path_fixed;
                    continue;
                }

                chunk.final_rel_path = rel_path;
            }

            if (duplicates_map.count() > 0) {
                var msg = std.ArrayList(u8).init(bun.default_allocator);
                errdefer msg.deinit();

                var entry_naming: ?[]const u8 = null;
                var chunk_naming: ?[]const u8 = null;
                var asset_naming: ?[]const u8 = null;

                const writer = msg.writer();
                try writer.print("Multiple files share the same output path\n", .{});

                const kinds = c.graph.files.items(.entry_point_kind);

                for (duplicates_map.keys(), duplicates_map.values()) |key, dup| {
                    try writer.print("  {s}:\n", .{key});
                    for (dup.sources.items) |chunk| {
                        if (chunk.entry_point.is_entry_point) {
                            if (kinds[chunk.entry_point.source_index] == .user_specified) {
                                entry_naming = chunk.template.data;
                            } else {
                                chunk_naming = chunk.template.data;
                            }
                        } else {
                            asset_naming = chunk.template.data;
                        }

                        const source_index = chunk.entry_point.source_index;
                        const file: Logger.Source = c.parse_graph.input_files.items(.source)[source_index];
                        try writer.print("    from input {s}\n", .{file.path.pretty});
                    }
                }

                try c.log.addError(null, Logger.Loc.Empty, try msg.toOwnedSlice());

                inline for (.{
                    .{ .name = "entry", .template = entry_naming },
                    .{ .name = "chunk", .template = chunk_naming },
                    .{ .name = "asset", .template = asset_naming },
                }) |x| brk: {
                    const template = x.template orelse break :brk;
                    const name = x.name;

                    try c.log.addMsg(.{
                        .kind = .note,
                        .data = .{
                            .text = try std.fmt.allocPrint(bun.default_allocator, name ++ " naming is '{s}', consider adding '[hash]' to make filenames unique", .{template}),
                        },
                    });
                }

                return error.DuplicateOutputPath;
            }
        }

        var output_files = std.ArrayList(options.OutputFile).initCapacity(
            bun.default_allocator,
            (if (c.options.source_maps.hasExternalFiles()) chunks.len * 2 else chunks.len) +
                @as(usize, c.parse_graph.additional_output_files.items.len),
        ) catch unreachable;

        const root_path = c.resolver.opts.output_dir;
        const more_than_one_output = c.parse_graph.additional_output_files.items.len > 0 or c.options.generate_bytecode_cache or (has_css_chunk and has_js_chunk) or (has_html_chunk and (has_js_chunk or has_css_chunk));

        if (!c.resolver.opts.compile and more_than_one_output and !c.resolver.opts.supports_multiple_outputs) {
            try c.log.addError(null, Logger.Loc.Empty, "cannot write multiple output files without an output directory");
            return error.MultipleOutputFilesWithoutOutputDir;
        }

        if (root_path.len > 0) {
            try c.writeOutputFilesToDisk(root_path, chunks, &output_files);
        } else {
            // In-memory build
            for (chunks) |*chunk| {
                var display_size: usize = 0;

                const _code_result = chunk.intermediate_output.code(
                    null,
                    c.parse_graph,
                    &c.graph,
                    c.resolver.opts.public_path,
                    chunk,
                    chunks,
                    &display_size,
                    chunk.content.sourcemap(c.options.source_maps) != .none,
                );
                var code_result = _code_result catch @panic("Failed to allocate memory for output file");

                var sourcemap_output_file: ?options.OutputFile = null;
                const input_path = try bun.default_allocator.dupe(
                    u8,
                    if (chunk.entry_point.is_entry_point)
                        c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path.text
                    else
                        chunk.final_rel_path,
                );

                switch (chunk.content.sourcemap(c.options.source_maps)) {
                    .external, .linked => |tag| {
                        const output_source_map = chunk.output_source_map.finalize(bun.default_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                        var source_map_final_rel_path = default_allocator.alloc(u8, chunk.final_rel_path.len + ".map".len) catch unreachable;
                        bun.copy(u8, source_map_final_rel_path, chunk.final_rel_path);
                        bun.copy(u8, source_map_final_rel_path[chunk.final_rel_path.len..], ".map");

                        if (tag == .linked) {
                            const a, const b = if (c.options.public_path.len > 0)
                                cheapPrefixNormalizer(c.options.public_path, source_map_final_rel_path)
                            else
                                .{ "", std.fs.path.basename(source_map_final_rel_path) };

                            const source_map_start = "//# sourceMappingURL=";
                            const total_len = code_result.buffer.len + source_map_start.len + a.len + b.len + "\n".len;
                            var buf = std.ArrayList(u8).initCapacity(Chunk.IntermediateOutput.allocatorForSize(total_len), total_len) catch @panic("Failed to allocate memory for output file with inline source map");
                            buf.appendSliceAssumeCapacity(code_result.buffer);
                            buf.appendSliceAssumeCapacity(source_map_start);
                            buf.appendSliceAssumeCapacity(a);
                            buf.appendSliceAssumeCapacity(b);
                            buf.appendAssumeCapacity('\n');

                            Chunk.IntermediateOutput.allocatorForSize(code_result.buffer.len).free(code_result.buffer);
                            code_result.buffer = buf.items;
                        }

                        sourcemap_output_file = options.OutputFile.init(.{
                            .data = .{
                                .buffer = .{
                                    .data = output_source_map,
                                    .allocator = bun.default_allocator,
                                },
                            },
                            .hash = null,
                            .loader = .json,
                            .input_loader = .file,
                            .output_path = source_map_final_rel_path,
                            .output_kind = .sourcemap,
                            .input_path = try strings.concat(bun.default_allocator, &.{ input_path, ".map" }),
                            .side = null,
                            .entry_point_index = null,
                            .is_executable = false,
                        });
                    },
                    .@"inline" => {
                        const output_source_map = chunk.output_source_map.finalize(bun.default_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                        const encode_len = base64.encodeLen(output_source_map);

                        const source_map_start = "//# sourceMappingURL=data:application/json;base64,";
                        const total_len = code_result.buffer.len + source_map_start.len + encode_len + 1;
                        var buf = std.ArrayList(u8).initCapacity(Chunk.IntermediateOutput.allocatorForSize(total_len), total_len) catch @panic("Failed to allocate memory for output file with inline source map");

                        buf.appendSliceAssumeCapacity(code_result.buffer);
                        buf.appendSliceAssumeCapacity(source_map_start);

                        buf.items.len += encode_len;
                        _ = base64.encode(buf.items[buf.items.len - encode_len ..], output_source_map);

                        buf.appendAssumeCapacity('\n');
                        Chunk.IntermediateOutput.allocatorForSize(code_result.buffer.len).free(code_result.buffer);
                        code_result.buffer = buf.items;
                    },
                    .none => {},
                }

                const bytecode_output_file: ?options.OutputFile = brk: {
                    if (c.options.generate_bytecode_cache) {
                        const loader: Loader = if (chunk.entry_point.is_entry_point)
                            c.parse_graph.input_files.items(.loader)[
                                chunk.entry_point.source_index
                            ]
                        else
                            .js;

                        if (loader.isJavaScriptLike()) {
                            JSC.VirtualMachine.is_bundler_thread_for_bytecode_cache = true;
                            JSC.initialize(false);
                            var fdpath: bun.PathBuffer = undefined;
                            var source_provider_url = try bun.String.createFormat("{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path});
                            source_provider_url.ref();

                            defer source_provider_url.deref();

                            if (JSC.CachedBytecode.generate(c.options.output_format, code_result.buffer, &source_provider_url)) |result| {
                                const bytecode, const cached_bytecode = result;
                                const source_provider_url_str = source_provider_url.toSlice(bun.default_allocator);
                                defer source_provider_url_str.deinit();
                                debug("Bytecode cache generated {s}: {}", .{ source_provider_url_str.slice(), bun.fmt.size(bytecode.len, .{ .space_between_number_and_unit = true }) });
                                @memcpy(fdpath[0..chunk.final_rel_path.len], chunk.final_rel_path);
                                fdpath[chunk.final_rel_path.len..][0..bun.bytecode_extension.len].* = bun.bytecode_extension.*;

                                break :brk options.OutputFile.init(.{
                                    .output_path = bun.default_allocator.dupe(u8, source_provider_url_str.slice()) catch unreachable,
                                    .input_path = std.fmt.allocPrint(bun.default_allocator, "{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path}) catch unreachable,
                                    .input_loader = .js,
                                    .hash = if (chunk.template.placeholder.hash != null) bun.hash(bytecode) else null,
                                    .output_kind = .bytecode,
                                    .loader = .file,
                                    .size = @as(u32, @truncate(bytecode.len)),
                                    .display_size = @as(u32, @truncate(bytecode.len)),
                                    .data = .{
                                        .buffer = .{ .data = bytecode, .allocator = cached_bytecode.allocator() },
                                    },
                                    .side = null,
                                    .entry_point_index = null,
                                    .is_executable = false,
                                });
                            } else {
                                // an error
                                c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to generate bytecode for {s}", .{
                                    chunk.final_rel_path,
                                }) catch unreachable;
                            }
                        }
                    }

                    break :brk null;
                };

                const source_map_index: ?u32 = if (sourcemap_output_file != null)
                    @as(u32, @truncate(output_files.items.len + 1))
                else
                    null;

                const bytecode_index: ?u32 = if (bytecode_output_file != null and source_map_index != null)
                    @as(u32, @truncate(output_files.items.len + 2))
                else if (bytecode_output_file != null)
                    @as(u32, @truncate(output_files.items.len + 1))
                else
                    null;

                const output_kind = if (chunk.content == .css)
                    .asset
                else if (chunk.entry_point.is_entry_point)
                    c.graph.files.items(.entry_point_kind)[chunk.entry_point.source_index].outputKind()
                else
                    .chunk;
                try output_files.append(options.OutputFile.init(.{
                    .data = .{
                        .buffer = .{
                            .data = code_result.buffer,
                            .allocator = Chunk.IntermediateOutput.allocatorForSize(code_result.buffer.len),
                        },
                    },
                    .hash = chunk.template.placeholder.hash,
                    .loader = chunk.content.loader(),
                    .input_path = input_path,
                    .display_size = @as(u32, @truncate(display_size)),
                    .output_kind = output_kind,
                    .input_loader = if (chunk.entry_point.is_entry_point) c.parse_graph.input_files.items(.loader)[chunk.entry_point.source_index] else .js,
                    .output_path = try bun.default_allocator.dupe(u8, chunk.final_rel_path),
                    .is_executable = chunk.is_executable,
                    .source_map_index = source_map_index,
                    .bytecode_index = bytecode_index,
                    .side = if (chunk.content == .css)
                        .client
                    else switch (c.graph.ast.items(.target)[chunk.entry_point.source_index]) {
                        .browser => .client,
                        else => .server,
                    },
                    .entry_point_index = if (output_kind == .@"entry-point")
                        chunk.entry_point.source_index - @as(u32, (if (c.framework) |fw| if (fw.server_components != null) 3 else 1 else 1))
                    else
                        null,
                    .referenced_css_files = switch (chunk.content) {
                        .javascript => |js| @ptrCast(try bun.default_allocator.dupe(u32, js.css_chunks)),
                        .css => &.{},
                        .html => &.{},
                    },
                }));
                if (sourcemap_output_file) |sourcemap_file| {
                    try output_files.append(sourcemap_file);
                }
                if (bytecode_output_file) |bytecode_file| {
                    try output_files.append(bytecode_file);
                }
            }

            try output_files.appendSlice(c.parse_graph.additional_output_files.items);
        }

        return output_files;
    }

    fn appendIsolatedHashesForImportedChunks(
        c: *LinkerContext,
        hash: *ContentHasher,
        chunks: []Chunk,
        index: u32,
        chunk_visit_map: *AutoBitSet,
    ) void {
        // Only visit each chunk at most once. This is important because there may be
        // cycles in the chunk import graph. If there's a cycle, we want to include
        // the hash of every chunk involved in the cycle (along with all of their
        // dependencies). This depth-first traversal will naturally do that.
        if (chunk_visit_map.isSet(index)) {
            return;
        }
        chunk_visit_map.set(index);

        // Visit the other chunks that this chunk imports before visiting this chunk
        const chunk = &chunks[index];
        for (chunk.cross_chunk_imports.slice()) |import| {
            c.appendIsolatedHashesForImportedChunks(
                hash,
                chunks,
                import.chunk_index,
                chunk_visit_map,
            );
        }

        // Mix in hashes for referenced asset paths (i.e. the "file" loader)
        switch (chunk.intermediate_output) {
            .pieces => |pieces| for (pieces.slice()) |piece| {
                if (piece.query.kind == .asset) {
                    var from_chunk_dir = std.fs.path.dirnamePosix(chunk.final_rel_path) orelse "";
                    if (strings.eqlComptime(from_chunk_dir, "."))
                        from_chunk_dir = "";

                    const source_index = piece.query.index;
                    const additional_files: []AdditionalFile = c.parse_graph.input_files.items(.additional_files)[source_index].slice();
                    bun.assert(additional_files.len > 0);
                    switch (additional_files[0]) {
                        .output_file => |output_file_id| {
                            const path = c.parse_graph.additional_output_files.items[output_file_id].dest_path;
                            hash.write(bun.path.relativePlatform(from_chunk_dir, path, .posix, false));
                        },
                        .source_index => {},
                    }
                }
            },
            else => {},
        }

        // Mix in the hash for this chunk
        hash.write(std.mem.asBytes(&chunk.isolated_hash));
    }

    fn writeOutputFilesToDisk(
        c: *LinkerContext,
        root_path: string,
        chunks: []Chunk,
        output_files: *std.ArrayList(options.OutputFile),
    ) !void {
        const trace = bun.perf.trace("Bundler.writeOutputFilesToDisk");
        defer trace.end();
        var root_dir = std.fs.cwd().makeOpenPath(root_path, .{}) catch |err| {
            if (err == error.NotDir) {
                c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to create output directory {} is a file. Please choose a different outdir or delete {}", .{
                    bun.fmt.quote(root_path),
                    bun.fmt.quote(root_path),
                }) catch unreachable;
            } else {
                c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "Failed to create output directory {s} {}", .{
                    @errorName(err),
                    bun.fmt.quote(root_path),
                }) catch unreachable;
            }

            return err;
        };
        defer root_dir.close();
        // Optimization: when writing to disk, we can re-use the memory
        var max_heap_allocator: bun.MaxHeapAllocator = undefined;
        defer max_heap_allocator.deinit();

        const code_allocator = max_heap_allocator.init(bun.default_allocator);

        var max_heap_allocator_source_map: bun.MaxHeapAllocator = undefined;
        defer max_heap_allocator_source_map.deinit();

        const source_map_allocator = max_heap_allocator_source_map.init(bun.default_allocator);

        var max_heap_allocator_inline_source_map: bun.MaxHeapAllocator = undefined;
        defer max_heap_allocator_inline_source_map.deinit();

        const code_with_inline_source_map_allocator = max_heap_allocator_inline_source_map.init(bun.default_allocator);

        var pathbuf: bun.PathBuffer = undefined;

        for (chunks) |*chunk| {
            const trace2 = bun.perf.trace("Bundler.writeChunkToDisk");
            defer trace2.end();
            defer max_heap_allocator.reset();

            const rel_path = chunk.final_rel_path;
            if (std.fs.path.dirnamePosix(rel_path)) |rel_parent| {
                if (rel_parent.len > 0) {
                    root_dir.makePath(rel_parent) catch |err| {
                        c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{s} creating outdir {} while saving chunk {}", .{
                            @errorName(err),
                            bun.fmt.quote(rel_parent),
                            bun.fmt.quote(chunk.final_rel_path),
                        }) catch unreachable;
                        return err;
                    };
                }
            }
            var display_size: usize = 0;
            var code_result = chunk.intermediate_output.code(
                code_allocator,
                c.parse_graph,
                &c.graph,
                c.resolver.opts.public_path,
                chunk,
                chunks,
                &display_size,
                chunk.content.sourcemap(c.options.source_maps) != .none,
            ) catch |err| bun.Output.panic("Failed to create output chunk: {s}", .{@errorName(err)});

            var source_map_output_file: ?options.OutputFile = null;

            const input_path = try bun.default_allocator.dupe(
                u8,
                if (chunk.entry_point.is_entry_point)
                    c.parse_graph.input_files.items(.source)[chunk.entry_point.source_index].path.text
                else
                    chunk.final_rel_path,
            );

            switch (chunk.content.sourcemap(c.options.source_maps)) {
                .external, .linked => |tag| {
                    const output_source_map = chunk.output_source_map.finalize(source_map_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                    const source_map_final_rel_path = strings.concat(default_allocator, &.{
                        chunk.final_rel_path,
                        ".map",
                    }) catch @panic("Failed to allocate memory for external source map path");

                    if (tag == .linked) {
                        const a, const b = if (c.options.public_path.len > 0)
                            cheapPrefixNormalizer(c.options.public_path, source_map_final_rel_path)
                        else
                            .{ "", std.fs.path.basename(source_map_final_rel_path) };

                        const source_map_start = "//# sourceMappingURL=";
                        const total_len = code_result.buffer.len + source_map_start.len + a.len + b.len + "\n".len;
                        var buf = std.ArrayList(u8).initCapacity(Chunk.IntermediateOutput.allocatorForSize(total_len), total_len) catch @panic("Failed to allocate memory for output file with inline source map");
                        buf.appendSliceAssumeCapacity(code_result.buffer);
                        buf.appendSliceAssumeCapacity(source_map_start);
                        buf.appendSliceAssumeCapacity(a);
                        buf.appendSliceAssumeCapacity(b);
                        buf.appendAssumeCapacity('\n');
                        code_result.buffer = buf.items;
                    }

                    switch (JSC.Node.NodeFS.writeFileWithPathBuffer(
                        &pathbuf,
                        JSC.Node.Arguments.WriteFile{
                            .data = JSC.Node.StringOrBuffer{
                                .buffer = JSC.Buffer{
                                    .buffer = .{
                                        .ptr = @constCast(output_source_map.ptr),
                                        // TODO: handle > 4 GB files
                                        .len = @as(u32, @truncate(output_source_map.len)),
                                        .byte_len = @as(u32, @truncate(output_source_map.len)),
                                    },
                                },
                            },
                            .encoding = .buffer,
                            .dirfd = bun.toFD(root_dir.fd),
                            .file = .{
                                .path = JSC.Node.PathLike{
                                    .string = JSC.PathString.init(source_map_final_rel_path),
                                },
                            },
                        },
                    )) {
                        .err => |err| {
                            try c.log.addSysError(bun.default_allocator, err, "writing sourcemap for chunk {}", .{
                                bun.fmt.quote(chunk.final_rel_path),
                            });
                            return error.WriteFailed;
                        },
                        .result => {},
                    }

                    source_map_output_file = options.OutputFile.init(.{
                        .output_path = source_map_final_rel_path,
                        .input_path = try strings.concat(bun.default_allocator, &.{ input_path, ".map" }),
                        .loader = .json,
                        .input_loader = .file,
                        .output_kind = .sourcemap,
                        .size = @as(u32, @truncate(output_source_map.len)),
                        .data = .{
                            .saved = 0,
                        },
                        .side = .client,
                        .entry_point_index = null,
                        .is_executable = false,
                    });
                },
                .@"inline" => {
                    const output_source_map = chunk.output_source_map.finalize(source_map_allocator, code_result.shifts) catch @panic("Failed to allocate memory for external source map");
                    const encode_len = base64.encodeLen(output_source_map);

                    const source_map_start = "//# sourceMappingURL=data:application/json;base64,";
                    const total_len = code_result.buffer.len + source_map_start.len + encode_len + 1;
                    var buf = std.ArrayList(u8).initCapacity(code_with_inline_source_map_allocator, total_len) catch @panic("Failed to allocate memory for output file with inline source map");

                    buf.appendSliceAssumeCapacity(code_result.buffer);
                    buf.appendSliceAssumeCapacity(source_map_start);

                    buf.items.len += encode_len;
                    _ = base64.encode(buf.items[buf.items.len - encode_len ..], output_source_map);

                    buf.appendAssumeCapacity('\n');
                    code_result.buffer = buf.items;
                },
                .none => {},
            }
            const bytecode_output_file: ?options.OutputFile = brk: {
                if (c.options.generate_bytecode_cache) {
                    const loader: Loader = if (chunk.entry_point.is_entry_point)
                        c.parse_graph.input_files.items(.loader)[
                            chunk.entry_point.source_index
                        ]
                    else
                        .js;

                    if (loader.isJavaScriptLike()) {
                        JSC.VirtualMachine.is_bundler_thread_for_bytecode_cache = true;
                        JSC.initialize(false);
                        var fdpath: bun.PathBuffer = undefined;
                        var source_provider_url = try bun.String.createFormat("{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path});
                        source_provider_url.ref();

                        defer source_provider_url.deref();

                        if (JSC.CachedBytecode.generate(c.options.output_format, code_result.buffer, &source_provider_url)) |result| {
                            const source_provider_url_str = source_provider_url.toSlice(bun.default_allocator);
                            defer source_provider_url_str.deinit();
                            const bytecode, const cached_bytecode = result;
                            debug("Bytecode cache generated {s}: {}", .{ source_provider_url_str.slice(), bun.fmt.size(bytecode.len, .{ .space_between_number_and_unit = true }) });
                            @memcpy(fdpath[0..chunk.final_rel_path.len], chunk.final_rel_path);
                            fdpath[chunk.final_rel_path.len..][0..bun.bytecode_extension.len].* = bun.bytecode_extension.*;
                            defer cached_bytecode.deref();
                            switch (JSC.Node.NodeFS.writeFileWithPathBuffer(
                                &pathbuf,
                                JSC.Node.Arguments.WriteFile{
                                    .data = JSC.Node.StringOrBuffer{
                                        .buffer = JSC.Buffer{
                                            .buffer = .{
                                                .ptr = @constCast(bytecode.ptr),
                                                .len = @as(u32, @truncate(bytecode.len)),
                                                .byte_len = @as(u32, @truncate(bytecode.len)),
                                            },
                                        },
                                    },
                                    .encoding = .buffer,
                                    .mode = if (chunk.is_executable) 0o755 else 0o644,

                                    .dirfd = bun.toFD(root_dir.fd),
                                    .file = .{
                                        .path = JSC.Node.PathLike{
                                            .string = JSC.PathString.init(fdpath[0 .. chunk.final_rel_path.len + bun.bytecode_extension.len]),
                                        },
                                    },
                                },
                            )) {
                                .result => {},
                                .err => |err| {
                                    c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{} writing bytecode for chunk {}", .{
                                        err,
                                        bun.fmt.quote(chunk.final_rel_path),
                                    }) catch unreachable;
                                    return error.WriteFailed;
                                },
                            }

                            break :brk options.OutputFile.init(.{
                                .output_path = bun.default_allocator.dupe(u8, source_provider_url_str.slice()) catch unreachable,
                                .input_path = std.fmt.allocPrint(bun.default_allocator, "{s}" ++ bun.bytecode_extension, .{chunk.final_rel_path}) catch unreachable,
                                .input_loader = .file,
                                .hash = if (chunk.template.placeholder.hash != null) bun.hash(bytecode) else null,
                                .output_kind = .bytecode,
                                .loader = .file,
                                .size = @as(u32, @truncate(bytecode.len)),
                                .display_size = @as(u32, @truncate(bytecode.len)),
                                .data = .{
                                    .saved = 0,
                                },
                                .side = null,
                                .entry_point_index = null,
                                .is_executable = false,
                            });
                        }
                    }
                }

                break :brk null;
            };

            switch (JSC.Node.NodeFS.writeFileWithPathBuffer(
                &pathbuf,
                JSC.Node.Arguments.WriteFile{
                    .data = JSC.Node.StringOrBuffer{
                        .buffer = JSC.Buffer{
                            .buffer = .{
                                .ptr = @constCast(code_result.buffer.ptr),
                                // TODO: handle > 4 GB files
                                .len = @as(u32, @truncate(code_result.buffer.len)),
                                .byte_len = @as(u32, @truncate(code_result.buffer.len)),
                            },
                        },
                    },
                    .encoding = .buffer,
                    .mode = if (chunk.is_executable) 0o755 else 0o644,

                    .dirfd = bun.toFD(root_dir.fd),
                    .file = .{
                        .path = JSC.Node.PathLike{
                            .string = JSC.PathString.init(rel_path),
                        },
                    },
                },
            )) {
                .err => |err| {
                    try c.log.addSysError(bun.default_allocator, err, "writing chunk {}", .{
                        bun.fmt.quote(chunk.final_rel_path),
                    });
                    return error.WriteFailed;
                },
                .result => {},
            }

            const source_map_index: ?u32 = if (source_map_output_file != null)
                @as(u32, @truncate(output_files.items.len + 1))
            else
                null;

            const bytecode_index: ?u32 = if (bytecode_output_file != null and source_map_index != null)
                @as(u32, @truncate(output_files.items.len + 2))
            else if (bytecode_output_file != null)
                @as(u32, @truncate(output_files.items.len + 1))
            else
                null;

            const output_kind = if (chunk.content == .css)
                .asset
            else if (chunk.entry_point.is_entry_point)
                c.graph.files.items(.entry_point_kind)[chunk.entry_point.source_index].outputKind()
            else
                .chunk;
            try output_files.append(options.OutputFile.init(.{
                .output_path = bun.default_allocator.dupe(u8, chunk.final_rel_path) catch unreachable,
                .input_path = input_path,
                .input_loader = if (chunk.entry_point.is_entry_point)
                    c.parse_graph.input_files.items(.loader)[chunk.entry_point.source_index]
                else
                    .js,
                .hash = chunk.template.placeholder.hash,
                .output_kind = output_kind,
                .loader = .js,
                .source_map_index = source_map_index,
                .bytecode_index = bytecode_index,
                .size = @as(u32, @truncate(code_result.buffer.len)),
                .display_size = @as(u32, @truncate(display_size)),
                .is_executable = chunk.is_executable,
                .data = .{
                    .saved = 0,
                },
                .side = if (chunk.content == .css)
                    .client
                else switch (c.graph.ast.items(.target)[chunk.entry_point.source_index]) {
                    .browser => .client,
                    else => .server,
                },
                .entry_point_index = if (output_kind == .@"entry-point")
                    chunk.entry_point.source_index - @as(u32, (if (c.framework) |fw| if (fw.server_components != null) 3 else 1 else 1))
                else
                    null,
                .referenced_css_files = switch (chunk.content) {
                    .javascript => |js| @ptrCast(try bun.default_allocator.dupe(u32, js.css_chunks)),
                    .css => &.{},
                    .html => &.{},
                },
            }));

            if (source_map_output_file) |sourcemap_file| {
                try output_files.append(sourcemap_file);
            }

            if (bytecode_output_file) |bytecode_file| {
                try output_files.append(bytecode_file);
            }
        }

        {
            const offset = output_files.items.len;
            output_files.items.len += c.parse_graph.additional_output_files.items.len;

            for (c.parse_graph.additional_output_files.items, output_files.items[offset..][0..c.parse_graph.additional_output_files.items.len]) |*src, *dest| {
                const bytes = src.value.buffer.bytes;
                src.value.buffer.bytes.len = 0;

                defer {
                    src.value.buffer.allocator.free(bytes);
                }

                if (std.fs.path.dirname(src.dest_path)) |rel_parent| {
                    if (rel_parent.len > 0) {
                        root_dir.makePath(rel_parent) catch |err| {
                            c.log.addErrorFmt(null, Logger.Loc.Empty, bun.default_allocator, "{s} creating outdir {} while saving file {}", .{
                                @errorName(err),
                                bun.fmt.quote(rel_parent),
                                bun.fmt.quote(src.dest_path),
                            }) catch unreachable;
                            return err;
                        };
                    }
                }

                switch (JSC.Node.NodeFS.writeFileWithPathBuffer(
                    &pathbuf,
                    JSC.Node.Arguments.WriteFile{
                        .data = JSC.Node.StringOrBuffer{
                            .buffer = JSC.Buffer{
                                .buffer = .{
                                    .ptr = @constCast(bytes.ptr),
                                    .len = @as(u32, @truncate(bytes.len)),
                                    .byte_len = @as(u32, @truncate(bytes.len)),
                                },
                            },
                        },
                        .encoding = .buffer,
                        .dirfd = bun.toFD(root_dir.fd),
                        .file = .{
                            .path = JSC.Node.PathLike{
                                .string = JSC.PathString.init(src.dest_path),
                            },
                        },
                    },
                )) {
                    .err => |err| {
                        c.log.addSysError(bun.default_allocator, err, "writing file {}", .{
                            bun.fmt.quote(src.src_path.text),
                        }) catch unreachable;
                        return error.WriteFailed;
                    },
                    .result => {},
                }

                dest.* = src.*;
                dest.value = .{
                    .saved = .{},
                };
                dest.size = @as(u32, @truncate(bytes.len));
            }
        }
    }

    // Sort cross-chunk exports by chunk name for determinism
    fn sortedCrossChunkExportItems(
        c: *LinkerContext,
        export_refs: ChunkMeta.Map,
        list: *std.ArrayList(StableRef),
    ) void {
        var result = list.*;
        defer list.* = result;
        result.clearRetainingCapacity();
        result.ensureTotalCapacity(export_refs.count()) catch unreachable;
        result.items.len = export_refs.count();
        for (export_refs.keys(), result.items) |export_ref, *item| {
            if (comptime Environment.allow_assert)
                debugTreeShake("Export name: {s} (in {s})", .{
                    c.graph.symbols.get(export_ref).?.original_name,
                    c.parse_graph.input_files.get(export_ref.sourceIndex()).source.path.text,
                });
            item.* = .{
                .stable_source_index = c.graph.stable_source_indices[export_ref.sourceIndex()],
                .ref = export_ref,
            };
        }
        std.sort.pdq(StableRef, result.items, {}, StableRef.isLessThan);
    }

    pub fn markFileReachableForCodeSplitting(
        c: *LinkerContext,
        source_index: Index.Int,
        entry_points_count: usize,
        distances: []u32,
        distance: u32,
        parts: []bun.BabyList(Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        file_entry_bits: []AutoBitSet,
        css_reprs: []?*bun.css.BundlerStyleSheet,
    ) void {
        if (!c.graph.files_live.isSet(source_index))
            return;

        const cur_dist = distances[source_index];
        const traverse_again = distance < cur_dist;
        if (traverse_again) {
            distances[source_index] = distance;
        }
        const out_dist = distance + 1;

        var bits = &file_entry_bits[source_index];

        // Don't mark this file more than once
        if (bits.isSet(entry_points_count) and !traverse_again)
            return;

        bits.set(entry_points_count);

        if (comptime bun.Environment.enable_logs)
            debugTreeShake(
                "markFileReachableForCodeSplitting(entry: {d}): {s} {s} ({d})",
                .{
                    entry_points_count,
                    c.parse_graph.input_files.items(.source)[source_index].path.pretty,
                    @tagName(c.parse_graph.ast.items(.target)[source_index].bakeGraph()),
                    out_dist,
                },
            );

        if (css_reprs[source_index] != null) {
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
                        css_reprs,
                    );
                }
            }
            return;
        }

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
                    css_reprs,
                );
            }
        }

        const parts_in_file = parts[source_index].slice();
        for (parts_in_file) |part| {
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
                        css_reprs,
                    );
                }
            }
        }
    }

    pub fn markFileLiveForTreeShaking(
        c: *LinkerContext,
        source_index: Index.Int,
        side_effects: []_resolver.SideEffects,
        parts: []bun.BabyList(Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        entry_point_kinds: []EntryPoint.Kind,
        css_reprs: []?*bun.css.BundlerStyleSheet,
    ) void {
        if (comptime bun.Environment.allow_assert) {
            debugTreeShake("markFileLiveForTreeShaking({d}, {s} {s}) = {s}", .{
                source_index,
                c.parse_graph.input_files.get(source_index).source.path.pretty,
                @tagName(c.parse_graph.ast.items(.target)[source_index].bakeGraph()),
                if (c.graph.files_live.isSet(source_index)) "already seen" else "first seen",
            });
        }

        defer if (Environment.allow_assert) {
            debugTreeShake("end()", .{});
        };

        if (c.graph.files_live.isSet(source_index)) return;
        c.graph.files_live.set(source_index);

        if (source_index >= c.graph.ast.len) {
            bun.assert(false);
            return;
        }

        if (css_reprs[source_index] != null) {
            for (import_records[source_index].slice()) |*record| {
                const other_source_index = record.source_index.get();
                if (record.source_index.isValid()) {
                    c.markFileLiveForTreeShaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
                    );
                }
            }
            return;
        }

        for (parts[source_index].slice(), 0..) |part, part_index| {
            var can_be_removed_if_unused = part.can_be_removed_if_unused;

            if (can_be_removed_if_unused and part.tag == .commonjs_named_export) {
                if (c.graph.meta.items(.flags)[source_index].wrap == .cjs) {
                    can_be_removed_if_unused = false;
                }
            }

            // Also include any statement-level imports
            for (part.import_record_indices.slice()) |import_index| {
                const record = import_records[source_index].at(import_index);
                if (record.kind != .stmt)
                    continue;

                if (record.source_index.isValid()) {
                    const other_source_index = record.source_index.get();

                    // Don't include this module for its side effects if it can be
                    // considered to have no side effects
                    const se = side_effects[other_source_index];

                    if (se != .has_side_effects and
                        !c.options.ignore_dce_annotations)
                    {
                        continue;
                    }

                    // Otherwise, include this module for its side effects
                    c.markFileLiveForTreeShaking(
                        other_source_index,
                        side_effects,
                        parts,
                        import_records,
                        entry_point_kinds,
                        css_reprs,
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
                    entry_point_kinds[source_index].isEntryPoint()))
            {
                c.markPartLiveForTreeShaking(
                    @intCast(part_index),
                    source_index,
                    side_effects,
                    parts,
                    import_records,
                    entry_point_kinds,
                    css_reprs,
                );
            }
        }
    }

    pub fn markPartLiveForTreeShaking(
        c: *LinkerContext,
        part_index: Index.Int,
        source_index: Index.Int,
        side_effects: []_resolver.SideEffects,
        parts: []bun.BabyList(Part),
        import_records: []bun.BabyList(bun.ImportRecord),
        entry_point_kinds: []EntryPoint.Kind,
        css_reprs: []?*bun.css.BundlerStyleSheet,
    ) void {
        const part: *Part = &parts[source_index].slice()[part_index];

        // only once
        if (part.is_live) {
            return;
        }
        part.is_live = true;

        if (comptime bun.Environment.isDebug) {
            debugTreeShake("markPartLiveForTreeShaking({d}): {s}:{d} = {d}, {s}", .{
                source_index,
                c.parse_graph.input_files.get(source_index).source.path.pretty,
                part_index,
                if (part.stmts.len > 0) part.stmts[0].loc.start else Logger.Loc.Empty.start,
                if (part.stmts.len > 0) @tagName(part.stmts[0].data) else @tagName(Stmt.empty().data),
            });
        }

        defer if (Environment.allow_assert) {
            debugTreeShake("end()", .{});
        };

        // Include the file containing this part
        c.markFileLiveForTreeShaking(
            source_index,
            side_effects,
            parts,
            import_records,
            entry_point_kinds,
            css_reprs,
        );

        if (Environment.enable_logs and part.dependencies.slice().len == 0) {
            logPartDependencyTree("markPartLiveForTreeShaking {d}:{d} | EMPTY", .{
                source_index, part_index,
            });
        }

        for (part.dependencies.slice()) |dependency| {
            if (Environment.enable_logs and source_index != 0 and dependency.source_index.get() != 0) {
                logPartDependencyTree("markPartLiveForTreeShaking: {d}:{d} --> {d}:{d}\n", .{
                    source_index, part_index, dependency.source_index.get(), dependency.part_index,
                });
            }

            c.markPartLiveForTreeShaking(
                dependency.part_index,
                dependency.source_index.get(),
                side_effects,
                parts,
                import_records,
                entry_point_kinds,
                css_reprs,
            );
        }
    }

    pub fn matchImportWithExport(
        c: *LinkerContext,
        init_tracker: ImportTracker,
        re_exports: *std.ArrayList(js_ast.Dependency),
    ) MatchImport {
        const cycle_detector_top = c.cycle_detector.items.len;
        defer c.cycle_detector.shrinkRetainingCapacity(cycle_detector_top);

        var tracker = init_tracker;
        var ambiguous_results = std.ArrayList(MatchImport).init(c.allocator);
        defer ambiguous_results.clearAndFree();

        var result: MatchImport = MatchImport{};
        const named_imports = c.graph.ast.items(.named_imports);

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
            for (c.cycle_detector.items[cycle_detector_top..]) |prev_tracker| {
                if (std.meta.eql(tracker, prev_tracker)) {
                    result = .{ .kind = .cycle };
                    break :loop;
                }
            }

            if (tracker.source_index.isInvalid()) {
                // External
                break;
            }

            const prev_source_index = tracker.source_index.get();
            c.cycle_detector.append(tracker) catch bun.outOfMemory();

            // Resolve the import by one step
            const advanced = c.advanceImportTracker(&tracker);
            const next_tracker = advanced.value;
            const status = advanced.status;
            const potentially_ambiguous_export_star_refs = advanced.import_data;

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
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;

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
                        const source = c.getSource(tracker.source_index.get());
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

                .dynamic_fallback_interop_default => {
                    // if the file was rewritten from CommonJS into ESM
                    // and the developer imported an export that doesn't exist
                    // We don't do a runtime error since that CJS would have returned undefined.
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;

                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        const symbol = c.graph.symbols.get(tracker.import_ref).?;
                        symbol.import_item_status = .missing;
                        result.kind = .normal_and_namespace;
                        result.namespace_ref = tracker.import_ref;
                        result.alias = named_import.alias.?;
                        result.name_loc = named_import.alias_loc orelse Logger.Loc.Empty;
                    }
                },

                .dynamic_fallback => {
                    // If it's a file with dynamic export fallback, rewrite the import to a property access
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;
                    if (named_import.namespace_ref != null and named_import.namespace_ref.?.isValid()) {
                        if (result.kind == .normal) {
                            result.kind = .normal_and_namespace;
                            result.namespace_ref = next_tracker.import_ref;
                            result.alias = named_import.alias.?;
                        } else {
                            result = .{
                                .kind = .namespace,
                                .namespace_ref = next_tracker.import_ref,
                                .alias = named_import.alias.?,
                            };
                        }
                    }
                },
                .no_match => {
                    // Report mismatched imports and exports
                    const symbol = c.graph.symbols.get(tracker.import_ref).?;
                    const named_import: js_ast.NamedImport = named_imports[prev_source_index].get(tracker.import_ref).?;
                    const source = c.getSource(prev_source_index);

                    const next_source = c.getSource(next_tracker.source_index.get());
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

                        if (c.resolver.opts.target == .browser and JSC.HardcodedModule.Alias.has(next_source.path.pretty, .bun)) {
                            c.log.addRangeWarningFmtWithNote(
                                source,
                                r,
                                c.allocator,
                                "Browser polyfill for module \"{s}\" doesn't have a matching export named \"{s}\"",
                                .{
                                    next_source.path.pretty,
                                    named_import.alias.?,
                                },
                                "Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options.",
                                .{},
                                r,
                            ) catch unreachable;
                        } else {
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
                        }
                    } else if (c.resolver.opts.target == .browser and bun.strings.hasPrefixComptime(next_source.path.text, NodeFallbackModules.import_path)) {
                        c.log.addRangeErrorFmtWithNote(
                            source,
                            r,
                            c.allocator,
                            "Browser polyfill for module \"{s}\" doesn't have a matching export named \"{s}\"",
                            .{
                                next_source.path.pretty,
                                named_import.alias.?,
                            },
                            "Bun's bundler defaults to browser builds instead of node or bun builds. If you want to use node or bun builds, you can set the target to \"node\" or \"bun\" in the transpiler options.",
                            .{},
                            r,
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
                            const ambig = c.matchImportWithExport(ambiguous_tracker.data, re_exports);
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
                        const deps = c.topLevelSymbolsToParts(prev_source_index, tracker.import_ref);
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
        return c.graph.topLevelSymbolToParts(id, ref);
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
            // symbol. Instead of special-casing this during the reachability analysis
            // below, we just append a dummy part to the end of the file with these
            // dependencies and let the general-purpose reachability analysis take care
            // of it.
            .cjs => {
                const common_js_parts = c.topLevelSymbolsToPartsForRuntime(c.cjs_runtime_ref);

                for (common_js_parts) |part_id| {
                    const runtime_parts = c.graph.ast.items(.parts)[Index.runtime.get()].slice();
                    const part: *Part = &runtime_parts[part_id];
                    const symbol_refs = part.symbol_uses.keys();
                    for (symbol_refs) |ref| {
                        if (ref.eql(c.cjs_runtime_ref)) continue;
                    }
                }

                // Generate a dummy part that depends on the "__commonJS" symbol.
                const dependencies: []js_ast.Dependency = if (c.options.output_format != .internal_bake_dev) brk: {
                    const dependencies = c.allocator.alloc(js_ast.Dependency, common_js_parts.len) catch bun.outOfMemory();
                    for (common_js_parts, dependencies) |part, *cjs| {
                        cjs.* = .{
                            .part_index = part,
                            .source_index = Index.runtime,
                        };
                    }
                    break :brk dependencies;
                } else &.{};
                var symbol_uses: Part.SymbolUseMap = .empty;
                symbol_uses.put(c.allocator, wrapper_ref, .{ .count_estimate = 1 }) catch bun.outOfMemory();
                const part_index = c.graph.addPartToFile(
                    source_index,
                    .{
                        .stmts = &.{},
                        .symbol_uses = symbol_uses,
                        .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(
                            c.allocator,
                            &[_]js_ast.DeclaredSymbol{
                                .{ .ref = c.graph.ast.items(.exports_ref)[source_index], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.module_ref)[source_index], .is_top_level = true },
                                .{ .ref = c.graph.ast.items(.wrapper_ref)[source_index], .is_top_level = true },
                            },
                        ) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                ) catch unreachable;
                bun.assert(part_index != js_ast.namespace_export_part_index);
                wrapper_part_index.* = Index.part(part_index);

                // Bake uses a wrapping approach that does not use __commonJS
                if (c.options.output_format != .internal_bake_dev) {
                    c.graph.generateSymbolImportAndUse(
                        source_index,
                        part_index,
                        c.cjs_runtime_ref,
                        1,
                        Index.runtime,
                    ) catch unreachable;
                }
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
                const esm_parts = if (wrapper_ref.isValid() and c.options.output_format != .internal_bake_dev)
                    c.topLevelSymbolsToPartsForRuntime(c.esm_runtime_ref)
                else
                    &.{};

                // generate a dummy part that depends on the "__esm" symbol
                const dependencies = c.allocator.alloc(js_ast.Dependency, esm_parts.len) catch unreachable;
                for (esm_parts, dependencies) |part, *esm| {
                    esm.* = .{
                        .part_index = part,
                        .source_index = Index.runtime,
                    };
                }

                var symbol_uses: Part.SymbolUseMap = .empty;
                symbol_uses.put(c.allocator, wrapper_ref, .{ .count_estimate = 1 }) catch bun.outOfMemory();
                const part_index = c.graph.addPartToFile(
                    source_index,
                    .{
                        .symbol_uses = symbol_uses,
                        .declared_symbols = js_ast.DeclaredSymbol.List.fromSlice(c.allocator, &[_]js_ast.DeclaredSymbol{
                            .{ .ref = wrapper_ref, .is_top_level = true },
                        }) catch unreachable,
                        .dependencies = Dependency.List.init(dependencies),
                    },
                ) catch unreachable;
                bun.assert(part_index != js_ast.namespace_export_part_index);
                wrapper_part_index.* = Index.part(part_index);
                if (wrapper_ref.isValid() and c.options.output_format != .internal_bake_dev) {
                    c.graph.generateSymbolImportAndUse(
                        source_index,
                        part_index,
                        c.esm_runtime_ref,
                        1,
                        Index.runtime,
                    ) catch bun.outOfMemory();
                }
            },
            else => {},
        }
    }

    pub fn advanceImportTracker(c: *LinkerContext, tracker: *const ImportTracker) ImportTracker.Iterator {
        const id = tracker.source_index.get();
        var named_imports: *JSAst.NamedImports = &c.graph.ast.items(.named_imports)[id];
        var import_records = c.graph.ast.items(.import_records)[id];
        const exports_kind: []const js_ast.ExportsKind = c.graph.ast.items(.exports_kind);
        const ast_flags = c.graph.ast.items(.flags);

        const named_import: js_ast.NamedImport = named_imports.get(tracker.import_ref) orelse
            // TODO: investigate if this is a bug
            // It implies there are imports being added without being resolved
            return .{
                .value = .{},
                .status = .external,
            };

        // Is this an external file?
        const record: *const ImportRecord = import_records.at(named_import.import_record_index);
        if (!record.source_index.isValid()) {
            return .{
                .value = .{},
                .status = .external,
            };
        }

        // Is this a disabled file?
        const other_source_index = record.source_index.get();
        const other_id = other_source_index;

        if (other_id > c.graph.ast.len or c.parse_graph.input_files.items(.source)[other_source_index].path.is_disabled) {
            return .{
                .value = .{
                    .source_index = record.source_index,
                },
                .status = .disabled,
            };
        }

        const flags = ast_flags[other_id];

        // Is this a named import of a file without any exports?
        if (!named_import.alias_is_star and
            flags.has_lazy_export and

            // CommonJS exports
            !flags.uses_export_keyword and !strings.eqlComptime(named_import.alias orelse "", "default") and
            // ESM exports
            !flags.uses_exports_ref and !flags.uses_module_ref)
        {
            // Just warn about it and replace the import with "undefined"
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = Ref.None,
                },
                .status = .cjs_without_exports,
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
            };
        }

        // Is this a file with dynamic exports?
        const is_commonjs_to_esm = flags.force_cjs_to_esm;
        if (other_kind.isESMWithDynamicFallback() or is_commonjs_to_esm) {
            return .{
                .value = .{
                    .source_index = Index.source(other_source_index),
                    .import_ref = c.graph.ast.items(.exports_ref)[other_id],
                },
                .status = if (is_commonjs_to_esm)
                    .dynamic_fallback_interop_default
                else
                    .dynamic_fallback,
            };
        }

        // Missing re-exports in TypeScript files are indistinguishable from types
        const other_loader = c.parse_graph.input_files.items(.loader)[other_id];
        if (named_import.is_exported and other_loader.isTypeScript()) {
            return .{
                .value = .{},
                .status = .probably_typescript_type,
            };
        }

        return .{
            .value = .{
                .source_index = Index.source(other_source_index),
            },
            .status = .no_match,
        };
    }

    pub fn matchImportsWithExportsForFile(
        c: *LinkerContext,
        named_imports_ptr: *JSAst.NamedImports,
        imports_to_bind: *RefImportData,
        source_index: Index.Int,
    ) void {
        var named_imports = named_imports_ptr.clone(c.allocator) catch bun.outOfMemory();
        defer named_imports_ptr.* = named_imports;

        const Sorter = struct {
            imports: *JSAst.NamedImports,

            pub fn lessThan(self: @This(), a_index: usize, b_index: usize) bool {
                const a_ref = self.imports.keys()[a_index];
                const b_ref = self.imports.keys()[b_index];

                return std.math.order(a_ref.innerIndex(), b_ref.innerIndex()) == .lt;
            }
        };
        const sorter = Sorter{
            .imports = &named_imports,
        };
        named_imports.sort(sorter);

        for (named_imports.keys(), named_imports.values()) |ref, named_import| {
            // Re-use memory for the cycle detector
            c.cycle_detector.clearRetainingCapacity();

            const import_ref = ref;

            var re_exports = std.ArrayList(js_ast.Dependency).init(c.allocator);
            const result = c.matchImportWithExport(.{
                .source_index = Index.source(source_index),
                .import_ref = import_ref,
            }, &re_exports);

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
                    const r = lex.rangeOfIdentifier(source, named_import.alias_loc orelse Logger.Loc{});
                    c.log.addRangeErrorFmt(
                        source,
                        r,
                        c.allocator,
                        "Detected cycle while resolving import \"{s}\"",
                        .{
                            named_import.alias.?,
                        },
                    ) catch unreachable;
                },
                .probably_typescript_type => {
                    c.graph.meta.items(.probably_typescript_type)[source_index].put(
                        c.allocator,
                        import_ref,
                        {},
                    ) catch unreachable;
                },
                .ambiguous => {
                    const source = &c.parse_graph.input_files.items(.source)[source_index];

                    const r = lex.rangeOfIdentifier(source, named_import.alias_loc orelse Logger.Loc{});

                    // TODO: log locations of the ambiguous exports

                    const symbol: *Symbol = c.graph.symbols.get(import_ref).?;
                    if (symbol.import_item_status == .generated) {
                        symbol.import_item_status = .missing;
                        c.log.addRangeWarningFmt(
                            source,
                            r,
                            c.allocator,
                            "Import \"{s}\" will always be undefined because there are multiple matching exports",
                            .{
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    } else {
                        c.log.addRangeErrorFmt(
                            source,
                            r,
                            c.allocator,
                            "Ambiguous import \"{s}\" has multiple matching exports",
                            .{
                                named_import.alias.?,
                            },
                        ) catch unreachable;
                    }
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
        resolved_exports: []ResolvedExports,
        imports_to_bind: []RefImportData,
        export_star_records: []const []const Index.Int,
        allocator: std.mem.Allocator,

        pub fn addExports(
            this: *ExportStarContext,
            resolved_exports: *ResolvedExports,
            source_index: Index.Int,
        ) void {
            // Avoid infinite loops due to cycles in the export star graph
            for (this.source_index_stack.items) |i| {
                if (i == source_index)
                    return;
            }
            this.source_index_stack.append(source_index) catch bun.outOfMemory();
            const stack_end_pos = this.source_index_stack.items.len;
            defer this.source_index_stack.shrinkRetainingCapacity(stack_end_pos - 1);

            const import_records = this.import_records_list[source_index].slice();

            for (this.export_star_records[source_index]) |import_id| {
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
                    const name = entry.value_ptr.*;

                    // ES6 export star statements ignore exports named "default"
                    if (strings.eqlComptime(alias, "default"))
                        continue;

                    // This export star is shadowed if any file in the stack has a matching real named export
                    for (this.source_index_stack.items[0..stack_end_pos]) |prev| {
                        if (this.named_exports[prev].contains(alias)) {
                            continue :next_export;
                        }
                    }

                    const gop = resolved_exports.getOrPut(this.allocator, alias) catch bun.outOfMemory();
                    if (!gop.found_existing) {
                        // Initialize the re-export
                        gop.value_ptr.* = .{
                            .data = .{
                                .import_ref = name.ref,
                                .source_index = Index.source(other_source_index),
                                .name_loc = name.alias_loc,
                            },
                        };

                        // Make sure the symbol is marked as imported so that code splitting
                        // imports it correctly if it ends up being shared with another chunk
                        this.imports_to_bind[source_index].put(this.allocator, name.ref, .{
                            .data = .{
                                .import_ref = name.ref,
                                .source_index = Index.source(other_source_index),
                            },
                        }) catch bun.outOfMemory();
                    } else if (gop.value_ptr.data.source_index.get() != other_source_index) {
                        // Two different re-exports colliding makes it potentially ambiguous
                        gop.value_ptr.potentially_ambiguous_export_star_refs.push(this.allocator, .{
                            .data = .{
                                .source_index = Index.source(other_source_index),
                                .import_ref = name.ref,
                                .name_loc = name.alias_loc,
                            },
                        }) catch bun.outOfMemory();
                    }
                }

                // Search further through this file's export stars
                this.addExports(resolved_exports, other_source_index);
            }
        }
    };

    pub fn breakOutputIntoPieces(
        c: *LinkerContext,
        allocator: std.mem.Allocator,
        j: *StringJoiner,
        count: u32,
    ) !Chunk.IntermediateOutput {
        const trace = bun.perf.trace("Bundler.breakOutputIntoPieces");
        defer trace.end();

        const OutputPiece = Chunk.OutputPiece;

        if (!j.contains(c.unique_key_prefix))
            // There are like several cases that prohibit this from being checked more trivially, example:
            // 1. dynamic imports
            // 2. require()
            // 3. require.resolve()
            // 4. externals
            return .{ .joiner = j.* };

        var pieces = try std.ArrayList(OutputPiece).initCapacity(allocator, count);
        const complete_output = try j.done(allocator);
        var output = complete_output;

        const prefix = c.unique_key_prefix;

        outer: while (true) {
            // Scan for the next piece boundary
            const boundary = strings.indexOf(output, prefix) orelse
                break;

            // Try to parse the piece boundary
            const start = boundary + prefix.len;
            if (start + 9 > output.len) {
                // Not enough bytes to parse the piece index
                break;
            }

            const kind: OutputPiece.Query.Kind = switch (output[start]) {
                'A' => .asset,
                'C' => .chunk,
                'S' => .scb,
                else => {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
            };

            var index: usize = 0;
            for (output[start..][1..9].*) |char| {
                if (char < '0' or char > '9') {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break :outer;
                }

                index = (index * 10) + (@as(usize, char) - '0');
            }

            // Validate the boundary
            switch (kind) {
                .asset, .scb => if (index >= c.graph.files.len) {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
                .chunk => if (index >= count) {
                    if (bun.Environment.isDebug)
                        bun.Output.debugWarn("Invalid output piece boundary", .{});
                    break;
                },
                else => unreachable,
            }

            try pieces.append(OutputPiece.init(output[0..boundary], .{
                .kind = kind,
                .index = @intCast(index),
            }));
            output = output[boundary + prefix.len + 9 ..];
        }

        try pieces.append(OutputPiece.init(output, OutputPiece.Query.none));

        return .{
            .pieces = bun.BabyList(Chunk.OutputPiece).init(pieces.items),
        };
    }

    const DependencyWrapper = struct {
        linker: *LinkerContext,
        flags: []JSMeta.Flags,
        exports_kind: []js_ast.ExportsKind,
        import_records: []ImportRecord.List,
        export_star_map: std.AutoHashMap(Index.Int, void),
        entry_point_kinds: []EntryPoint.Kind,
        export_star_records: [][]u32,
        output_format: options.Format,

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

            const records = this.import_records[source_index].slice();
            for (this.export_star_records[source_index]) |id| {
                const record = records[id];

                // This file has dynamic exports if the exported imports are from a file
                // that either has dynamic exports directly or transitively by itself
                // having an export star from a file with dynamic exports.
                const kind = this.entry_point_kinds[source_index];
                if ((record.source_index.isInvalid() and (!kind.isEntryPoint() or !this.output_format.keepES6ImportExportSyntax())) or
                    (record.source_index.isValid() and record.source_index.get() != source_index and this.hasDynamicExportsDueToExportStar(record.source_index.get())))
                {
                    this.exports_kind[source_index] = .esm_with_dynamic_fallback;
                    return true;
                }
            }

            return false;
        }

        pub fn wrap(this: *DependencyWrapper, source_index: Index.Int) void {
            var flags = this.flags[source_index];

            if (flags.did_wrap_dependencies) return;
            flags.did_wrap_dependencies = true;

            // Never wrap the runtime file since it always comes first
            if (source_index == Index.runtime.get()) {
                return;
            }

            this.flags[source_index] = brk: {

                // This module must be wrapped
                if (flags.wrap == .none) {
                    flags.wrap = switch (this.exports_kind[source_index]) {
                        .cjs => .cjs,
                        else => .esm,
                    };
                }
                break :brk flags;
            };

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

        /// The import is missing but there is a dynamic fallback object
        /// and the file was originally CommonJS.
        dynamic_fallback_interop_default,

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
    };
};

const PathTemplate = options.PathTemplate;

pub const Chunk = struct {
    /// This is a random string and is used to represent the output path of this
    /// chunk before the final output path has been computed. See OutputPiece
    /// for more info on this technique.
    unique_key: string = "",

    files_with_parts_in_chunk: std.AutoArrayHashMapUnmanaged(Index.Int, void) = .{},

    /// We must not keep pointers to this type until all chunks have been allocated.
    entry_bits: AutoBitSet = undefined,

    final_rel_path: string = "",
    /// The path template used to generate `final_rel_path`
    template: PathTemplate = .{},

    /// For code splitting
    cross_chunk_imports: BabyList(ChunkImport) = .{},

    content: Content,

    entry_point: Chunk.EntryPoint = .{},

    is_executable: bool = false,
    has_html_chunk: bool = false,

    output_source_map: sourcemap.SourceMapPieces,

    intermediate_output: IntermediateOutput = .{ .empty = {} },
    isolated_hash: u64 = std.math.maxInt(u64),

    renamer: renamer.Renamer = undefined,

    compile_results_for_chunk: []CompileResult = &.{},

    pub inline fn isEntryPoint(this: *const Chunk) bool {
        return this.entry_point.is_entry_point;
    }

    pub fn getJSChunkForHTML(this: *const Chunk, chunks: []Chunk) ?*Chunk {
        const entry_point_id = this.entry_point.entry_point_id;
        for (chunks) |*other| {
            if (other.content == .javascript) {
                if (other.entry_point.entry_point_id == entry_point_id) {
                    return other;
                }
            }
        }
        return null;
    }

    pub fn getCSSChunkForHTML(this: *const Chunk, chunks: []Chunk) ?*Chunk {
        const entry_point_id = this.entry_point.entry_point_id;
        for (chunks) |*other| {
            if (other.content == .css) {
                if (other.entry_point.entry_point_id == entry_point_id) {
                    return other;
                }
            }
        }
        return null;
    }

    pub inline fn entryBits(this: *const Chunk) *const AutoBitSet {
        return &this.entry_bits;
    }

    pub const Order = struct {
        source_index: Index.Int = 0,
        distance: u32 = 0,
        tie_breaker: u32 = 0,

        pub fn lessThan(_: @This(), a: Order, b: Order) bool {
            return (a.distance < b.distance) or
                (a.distance == b.distance and a.tie_breaker < b.tie_breaker);
        }

        /// Sort so files closest to an entry point come first. If two files are
        /// equidistant to an entry point, then break the tie by sorting on the
        /// stable source index derived from the DFS over all entry points.
        pub fn sort(a: []Order) void {
            std.sort.pdq(Order, a, Order{}, lessThan);
        }
    };

    /// TODO: rewrite this
    /// This implementation is just slow.
    /// Can we make the JSPrinter itself track this without increasing
    /// complexity a lot?
    pub const IntermediateOutput = union(enum) {
        /// If the chunk has references to other chunks, then "pieces" contains
        /// the contents of the chunk. Another joiner will have to be
        /// constructed later when merging the pieces together.
        ///
        /// See OutputPiece's documentation comment for more details.
        pieces: bun.BabyList(OutputPiece),

        /// If the chunk doesn't have any references to other chunks, then
        /// `joiner` contains the contents of the chunk. This is more efficient
        /// because it avoids doing a join operation twice.
        joiner: StringJoiner,

        empty: void,

        pub fn allocatorForSize(size: usize) std.mem.Allocator {
            if (size >= 512 * 1024)
                return std.heap.page_allocator
            else
                return bun.default_allocator;
        }

        pub const CodeResult = struct {
            buffer: []u8,
            shifts: []sourcemap.SourceMapShifts,
        };

        pub fn code(
            this: *IntermediateOutput,
            allocator_to_use: ?std.mem.Allocator,
            parse_graph: *const Graph,
            linker_graph: *const LinkerGraph,
            import_prefix: []const u8,
            chunk: *Chunk,
            chunks: []Chunk,
            display_size: ?*usize,
            enable_source_map_shifts: bool,
        ) !CodeResult {
            return switch (enable_source_map_shifts) {
                inline else => |source_map_shifts| this.codeWithSourceMapShifts(
                    allocator_to_use,
                    parse_graph,
                    linker_graph,
                    import_prefix,
                    chunk,
                    chunks,
                    display_size,
                    source_map_shifts,
                ),
            };
        }

        pub fn codeWithSourceMapShifts(
            this: *IntermediateOutput,
            allocator_to_use: ?std.mem.Allocator,
            graph: *const Graph,
            linker_graph: *const LinkerGraph,
            import_prefix: []const u8,
            chunk: *Chunk,
            chunks: []Chunk,
            display_size: ?*usize,
            comptime enable_source_map_shifts: bool,
        ) !CodeResult {
            const additional_files = graph.input_files.items(.additional_files);
            const unique_key_for_additional_files = graph.input_files.items(.unique_key_for_additional_file);
            switch (this.*) {
                .pieces => |*pieces| {
                    const entry_point_chunks_for_scb = linker_graph.files.items(.entry_point_chunk_index);

                    var shift = if (enable_source_map_shifts)
                        sourcemap.SourceMapShifts{
                            .after = .{},
                            .before = .{},
                        };
                    var shifts = if (enable_source_map_shifts)
                        try std.ArrayList(sourcemap.SourceMapShifts).initCapacity(bun.default_allocator, pieces.len + 1);

                    if (enable_source_map_shifts)
                        shifts.appendAssumeCapacity(shift);

                    var count: usize = 0;
                    var from_chunk_dir = std.fs.path.dirnamePosix(chunk.final_rel_path) orelse "";
                    if (strings.eqlComptime(from_chunk_dir, "."))
                        from_chunk_dir = "";

                    for (pieces.slice()) |piece| {
                        count += piece.data_len;

                        switch (piece.query.kind) {
                            .chunk, .asset, .scb => {
                                const index = piece.query.index;
                                const file_path = switch (piece.query.kind) {
                                    .asset => brk: {
                                        const files = additional_files[index];
                                        if (!(files.len > 0)) {
                                            Output.panic("Internal error: missing asset file", .{});
                                        }

                                        const output_file = files.last().?.output_file;

                                        break :brk graph.additional_output_files.items[output_file].dest_path;
                                    },
                                    .chunk => chunks[index].final_rel_path,
                                    .scb => chunks[entry_point_chunks_for_scb[index]].final_rel_path,
                                    .none => unreachable,
                                };

                                const cheap_normalizer = cheapPrefixNormalizer(
                                    import_prefix,
                                    if (from_chunk_dir.len == 0)
                                        file_path
                                    else
                                        bun.path.relativePlatform(from_chunk_dir, file_path, .posix, false),
                                );
                                count += cheap_normalizer[0].len + cheap_normalizer[1].len;
                            },
                            .none => {},
                        }
                    }

                    if (display_size) |amt| {
                        amt.* = count;
                    }

                    const debug_id_len = if (enable_source_map_shifts and FeatureFlags.source_map_debug_id)
                        std.fmt.count("\n//# debugId={}\n", .{bun.sourcemap.DebugIDFormatter{ .id = chunk.isolated_hash }})
                    else
                        0;

                    const total_buf = try (allocator_to_use orelse allocatorForSize(count)).alloc(u8, count + debug_id_len);
                    var remain = total_buf;

                    for (pieces.slice()) |piece| {
                        const data = piece.data();

                        if (enable_source_map_shifts) {
                            var data_offset = sourcemap.LineColumnOffset{};
                            data_offset.advance(data);
                            shift.before.add(data_offset);
                            shift.after.add(data_offset);
                        }

                        if (data.len > 0)
                            @memcpy(remain[0..data.len], data);

                        remain = remain[data.len..];

                        switch (piece.query.kind) {
                            .asset, .chunk, .scb => {
                                const index = piece.query.index;
                                const file_path = switch (piece.query.kind) {
                                    .asset => brk: {
                                        const files = additional_files[index];
                                        bun.assert(files.len > 0);

                                        const output_file = files.last().?.output_file;

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(unique_key_for_additional_files[index]);
                                        }

                                        break :brk graph.additional_output_files.items[output_file].dest_path;
                                    },
                                    .chunk => brk: {
                                        const piece_chunk = chunks[index];

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(piece_chunk.unique_key);
                                        }

                                        break :brk piece_chunk.final_rel_path;
                                    },
                                    .scb => brk: {
                                        const piece_chunk = chunks[entry_point_chunks_for_scb[index]];

                                        if (enable_source_map_shifts) {
                                            shift.before.advance(piece_chunk.unique_key);
                                        }

                                        break :brk piece_chunk.final_rel_path;
                                    },
                                    else => unreachable,
                                };

                                // normalize windows paths to '/'
                                bun.path.platformToPosixInPlace(u8, @constCast(file_path));
                                const cheap_normalizer = cheapPrefixNormalizer(
                                    import_prefix,
                                    if (from_chunk_dir.len == 0)
                                        file_path
                                    else
                                        bun.path.relativePlatform(from_chunk_dir, file_path, .posix, false),
                                );

                                if (cheap_normalizer[0].len > 0) {
                                    @memcpy(remain[0..cheap_normalizer[0].len], cheap_normalizer[0]);
                                    remain = remain[cheap_normalizer[0].len..];
                                    if (enable_source_map_shifts)
                                        shift.after.advance(cheap_normalizer[0]);
                                }

                                if (cheap_normalizer[1].len > 0) {
                                    @memcpy(remain[0..cheap_normalizer[1].len], cheap_normalizer[1]);
                                    remain = remain[cheap_normalizer[1].len..];
                                    if (enable_source_map_shifts)
                                        shift.after.advance(cheap_normalizer[1]);
                                }

                                if (enable_source_map_shifts)
                                    shifts.appendAssumeCapacity(shift);
                            },
                            .none => {},
                        }
                    }

                    if (enable_source_map_shifts and FeatureFlags.source_map_debug_id) {
                        // This comment must go before the //# sourceMappingURL comment
                        remain = remain[(std.fmt.bufPrint(
                            remain,
                            "\n//# debugId={}\n",
                            .{bun.sourcemap.DebugIDFormatter{ .id = chunk.isolated_hash }},
                        ) catch bun.outOfMemory()).len..];
                    }

                    bun.assert(remain.len == 0);
                    bun.assert(total_buf.len == count + debug_id_len);

                    return .{
                        .buffer = total_buf,
                        .shifts = if (enable_source_map_shifts)
                            shifts.items
                        else
                            &[_]sourcemap.SourceMapShifts{},
                    };
                },
                .joiner => |*joiner| {
                    const allocator = allocator_to_use orelse allocatorForSize(joiner.len);

                    if (display_size) |amt| {
                        amt.* = joiner.len;
                    }

                    const buffer = brk: {
                        if (enable_source_map_shifts and FeatureFlags.source_map_debug_id) {
                            // This comment must go before the //# sourceMappingURL comment
                            const debug_id_fmt = std.fmt.allocPrint(
                                graph.allocator,
                                "\n//# debugId={}\n",
                                .{bun.sourcemap.DebugIDFormatter{ .id = chunk.isolated_hash }},
                            ) catch bun.outOfMemory();

                            break :brk try joiner.doneWithEnd(allocator, debug_id_fmt);
                        }

                        break :brk try joiner.done(allocator);
                    };

                    return .{
                        .buffer = buffer,
                        .shifts = &[_]sourcemap.SourceMapShifts{},
                    };
                },
                .empty => return .{
                    .buffer = "",
                    .shifts = &[_]sourcemap.SourceMapShifts{},
                },
            }
        }
    };

    /// An issue with asset files and server component boundaries is they
    /// contain references to output paths, but those paths are not known until
    /// very late in the bundle. The solution is to have a magic word in the
    /// bundle text (BundleV2.unique_key, a random u64; impossible to guess).
    /// When a file wants a path to an emitted chunk, it emits the unique key
    /// in hex followed by the kind of path it wants:
    ///
    ///     `74f92237f4a85a6aA00000009` --> `./some-asset.png`
    ///      ^--------------^|^------- .query.index
    ///      unique_key      .query.kind
    ///
    /// An output piece is the concatenation of source code text and an output
    /// path, in that order. An array of pieces makes up an entire file.
    pub const OutputPiece = struct {
        /// Pointer and length split to reduce struct size
        data_ptr: [*]const u8,
        data_len: u32,
        query: Query,

        pub fn data(this: OutputPiece) []const u8 {
            return this.data_ptr[0..this.data_len];
        }

        pub const Query = packed struct(u32) {
            index: u30,
            kind: Kind,

            pub const Kind = enum(u2) {
                /// The last piece in an array uses this to indicate it is just data
                none,
                /// Given a source index, print the asset's output
                asset,
                /// Given a chunk index, print the chunk's output path
                chunk,
                /// Given a server component boundary index, print the chunk's output path
                scb,
            };

            pub const none: Query = .{ .index = 0, .kind = .none };
        };

        pub fn init(data_slice: []const u8, query: Query) OutputPiece {
            return .{
                .data_ptr = data_slice.ptr,
                .data_len = @intCast(data_slice.len),
                .query = query,
            };
        }
    };

    pub const OutputPieceIndex = OutputPiece.Query;

    pub const EntryPoint = packed struct(u64) {
        /// Index into `Graph.input_files`
        source_index: u32 = 0,
        entry_point_id: ID = 0,
        is_entry_point: bool = false,
        is_html: bool = false,

        /// so `EntryPoint` can be a u64
        pub const ID = u30;
    };

    pub const JavaScriptChunk = struct {
        files_in_chunk_order: []const Index.Int = &.{},
        parts_in_chunk_in_order: []const PartRange = &.{},

        // for code splitting
        exports_to_other_chunks: std.ArrayHashMapUnmanaged(Ref, string, Ref.ArrayHashCtx, false) = .{},
        imports_from_other_chunks: ImportsFromOtherChunks = .{},
        cross_chunk_prefix_stmts: BabyList(Stmt) = .{},
        cross_chunk_suffix_stmts: BabyList(Stmt) = .{},

        /// Indexes to CSS chunks. Currently this will only ever be zero or one
        /// items long, but smarter css chunking will allow multiple js entry points
        /// share a css file, or have an entry point contain multiple css files.
        ///
        /// Mutated while sorting chunks in `computeChunks`
        css_chunks: []u32 = &.{},
    };

    pub const CssChunk = struct {
        imports_in_chunk_in_order: BabyList(CssImportOrder),
        /// When creating a chunk, this is to be an uninitialized slice with
        /// length of `imports_in_chunk_in_order`
        ///
        /// Multiple imports may refer to the same file/stylesheet, but may need to
        /// wrap them in conditions (e.g. a layer).
        ///
        /// When we go through the `prepareCssAstsForChunk()` step, each import will
        /// create a shallow copy of the file's AST (just dereferencing the pointer).
        asts: []bun.css.BundlerStyleSheet,
    };

    const CssImportKind = enum {
        source_index,
        external_path,
        import_layers,
    };

    pub const CssImportOrder = struct {
        conditions: BabyList(bun.css.ImportConditions) = .{},
        condition_import_records: BabyList(ImportRecord) = .{},

        kind: union(enum) {
            /// Represents earlier imports that have been made redundant by later ones (see `isConditionalImportRedundant`)
            /// We don't want to redundantly print the rules of these redundant imports
            /// BUT, the imports may include layers.
            /// We'll just print layer name declarations so that the original ordering is preserved.
            layers: Layers,
            external_path: bun.fs.Path,
            source_index: Index,
        },

        const Layers = bun.ptr.Cow(bun.BabyList(bun.css.LayerName), struct {
            const Self = bun.BabyList(bun.css.LayerName);
            pub fn copy(self: *const Self, allocator: std.mem.Allocator) Self {
                return self.deepClone2(allocator);
            }

            pub fn deinit(self: *Self, a: std.mem.Allocator) void {
                // do shallow deinit since `LayerName` has
                // allocations in arena
                self.deinitWithAllocator(a);
            }
        });

        pub fn hash(this: *const CssImportOrder, hasher: anytype) void {
            // TODO: conditions, condition_import_records

            bun.writeAnyToHasher(hasher, std.meta.activeTag(this.kind));
            switch (this.kind) {
                .layers => |layers| {
                    for (layers.inner().sliceConst()) |layer| {
                        for (layer.v.slice(), 0..) |layer_name, i| {
                            const is_last = i == layers.inner().len - 1;
                            if (is_last) {
                                hasher.update(layer_name);
                            } else {
                                hasher.update(layer_name);
                                hasher.update(".");
                            }
                        }
                    }
                    hasher.update("\x00");
                },
                .external_path => |path| hasher.update(path.text),
                .source_index => |idx| bun.writeAnyToHasher(hasher, idx),
            }
        }

        pub fn fmt(this: *const CssImportOrder, ctx: *LinkerContext) CssImportOrderDebug {
            return .{
                .inner = this,
                .ctx = ctx,
            };
        }

        const CssImportOrderDebug = struct {
            inner: *const CssImportOrder,
            ctx: *LinkerContext,

            pub fn format(this: *const CssImportOrderDebug, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                try writer.print("{s} = ", .{@tagName(this.inner.kind)});
                switch (this.inner.kind) {
                    .layers => |layers| {
                        try writer.print("[", .{});
                        const l = layers.inner();
                        for (l.sliceConst(), 0..) |*layer, i| {
                            if (i > 0) try writer.print(", ", .{});
                            try writer.print("\"{}\"", .{layer});
                        }

                        try writer.print("]", .{});
                    },
                    .external_path => |path| {
                        try writer.print("\"{s}\"", .{path.pretty});
                    },
                    .source_index => |source_index| {
                        const source = this.ctx.parse_graph.input_files.items(.source)[source_index.get()];
                        try writer.print("{d} ({s})", .{ source_index.get(), source.path.text });
                    },
                }
            }
        };
    };

    pub const ImportsFromOtherChunks = std.AutoArrayHashMapUnmanaged(Index.Int, CrossChunkImport.Item.List);

    pub const Content = union(enum) {
        javascript: JavaScriptChunk,
        css: CssChunk,
        html,

        pub fn sourcemap(this: *const Content, default: options.SourceMapOption) options.SourceMapOption {
            return switch (this.*) {
                .javascript => default,
                .css => .none, // TODO: css source maps
                .html => .none,
            };
        }

        pub fn loader(this: *const Content) Loader {
            return switch (this.*) {
                .javascript => .js,
                .css => .css,
                .html => .html,
            };
        }

        pub fn ext(this: *const Content) string {
            return switch (this.*) {
                .javascript => "js",
                .css => "css",
                .html => "html",
            };
        }
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

        result.clearRetainingCapacity();
        try result.ensureTotalCapacity(imports_from_other_chunks.count());

        const import_items_list = imports_from_other_chunks.values();
        const chunk_indices = imports_from_other_chunks.keys();
        for (chunk_indices, import_items_list) |chunk_index, import_items| {
            var chunk = &chunks[chunk_index];

            // Sort imports from a single chunk by alias for determinism
            const exports_to_other_chunks = &chunk.content.javascript.exports_to_other_chunks;
            // TODO: do we need to clone this array?
            for (import_items.slice()) |*item| {
                item.export_alias = exports_to_other_chunks.get(item.ref).?;
                bun.assert(item.export_alias.len > 0);
            }
            std.sort.pdq(CrossChunkImport.Item, import_items.slice(), {}, CrossChunkImport.Item.lessThan);

            result.append(CrossChunkImport{
                .chunk_index = chunk_index,
                .sorted_import_items = import_items,
            }) catch unreachable;
        }

        std.sort.pdq(CrossChunkImport, result.items, {}, CrossChunkImport.lessThan);
    }
};

pub const CompileResult = union(enum) {
    javascript: struct {
        source_index: Index.Int,
        result: js_printer.PrintResult,
    },
    css: struct {
        result: bun.Maybe([]const u8, anyerror),
        source_index: Index.Int,
        source_map: ?bun.sourcemap.Chunk = null,
    },
    html: struct {
        source_index: Index.Int,
        code: []const u8,
        /// Offsets are used for DevServer to inject resources without re-bundling
        script_injection_offset: u32,
    },

    pub const empty = CompileResult{
        .javascript = .{
            .source_index = 0,
            .result = js_printer.PrintResult{
                .result = .{
                    .code = "",
                },
            },
        },
    };

    pub fn code(this: *const CompileResult) []const u8 {
        return switch (this.*) {
            .javascript => |r| switch (r.result) {
                .result => |r2| r2.code,
                else => "",
            },
            .css => |*c| switch (c.result) {
                .result => |v| v,
                .err => "",
            },
            .html => |*c| c.code,
        };
    }

    pub fn sourceMapChunk(this: *const CompileResult) ?sourcemap.Chunk {
        return switch (this.*) {
            .javascript => |r| switch (r.result) {
                .result => |r2| r2.source_map,
                else => null,
            },
            .css => |*c| c.source_map,
            .html => null,
        };
    }

    pub fn sourceIndex(this: *const CompileResult) Index.Int {
        return switch (this.*) {
            inline else => |*r| r.source_index,
        };
    }
};

const CompileResultForSourceMap = struct {
    source_map_chunk: sourcemap.Chunk,
    generated_offset: sourcemap.LineColumnOffset,
    source_index: u32,
};

pub const ContentHasher = struct {
    pub const Hash = std.hash.XxHash64;

    // xxhash64 outperforms Wyhash if the file is > 1KB or so
    hasher: Hash = .init(0),

    const log = bun.Output.scoped(.ContentHasher, true);

    pub fn write(self: *ContentHasher, bytes: []const u8) void {
        log("HASH_UPDATE {d}:\n{s}\n----------\n", .{ bytes.len, std.mem.sliceAsBytes(bytes) });
        self.hasher.update(std.mem.asBytes(&bytes.len));
        self.hasher.update(bytes);
    }

    pub fn run(bytes: []const u8) u64 {
        var hasher = ContentHasher{};
        hasher.write(bytes);
        return hasher.digest();
    }

    pub fn writeInts(self: *ContentHasher, i: []const u32) void {
        log("HASH_UPDATE: {any}\n", .{i});
        self.hasher.update(std.mem.sliceAsBytes(i));
    }

    pub fn digest(self: *ContentHasher) u64 {
        return self.hasher.final();
    }
};

// non-allocating
// meant to be fast but not 100% thorough
// users can correctly put in a trailing slash if they want
// this is just being nice
pub fn cheapPrefixNormalizer(prefix: []const u8, suffix: []const u8) [2]string {
    if (prefix.len == 0) {
        const suffix_no_slash = bun.strings.removeLeadingDotSlash(suffix);
        return .{
            if (strings.hasPrefixComptime(suffix_no_slash, "../")) "" else "./",
            suffix_no_slash,
        };
    }

    // There are a few cases here we want to handle:
    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"] => "/foo/bar.js"
    if (strings.endsWithChar(prefix, '/') or (Environment.isWindows and strings.endsWithChar(prefix, '\\'))) {
        if (strings.startsWithChar(suffix, '/') or (Environment.isWindows and strings.startsWithChar(suffix, '\\'))) {
            return .{
                prefix[0..prefix.len],
                suffix[1..suffix.len],
            };
        }

        // It gets really complicated if we try to deal with URLs more than this
        // These would be ideal:
        // - example.com + ./out.js => example.com/out.js
        // - example.com/foo + ./out.js => example.com/fooout.js
        // - example.com/bar/ + ./out.js => example.com/bar/out.js
        // But it's not worth the complexity to handle these cases right now.
    }

    return .{
        prefix,
        bun.strings.removeLeadingDotSlash(suffix),
    };
}

fn getRedirectId(id: u32) ?u32 {
    if (id == std.math.maxInt(u32)) {
        return null;
    }
    return id;
}

fn targetFromHashbang(buffer: []const u8) ?options.Target {
    if (buffer.len > "#!/usr/bin/env bun".len) {
        if (strings.hasPrefixComptime(buffer, "#!/usr/bin/env bun")) {
            switch (buffer["#!/usr/bin/env bun".len]) {
                '\n', ' ' => return options.Target.bun,
                else => {},
            }
        }
    }
    return null;
}

/// Utility to construct `Ast`s intended for generated code, such as the
/// boundary modules when dealing with server components. This is a saner
/// alternative to building a string, then sending it through `js_parser`
///
/// For in-depth details on the fields, most of these are documented
/// inside of `js_parser`
pub const AstBuilder = struct {
    allocator: std.mem.Allocator,
    source: *const Logger.Source,
    source_index: u31,
    stmts: std.ArrayListUnmanaged(Stmt),
    scopes: std.ArrayListUnmanaged(*Scope),
    symbols: std.ArrayListUnmanaged(Symbol),
    import_records: std.ArrayListUnmanaged(ImportRecord),
    named_imports: js_ast.Ast.NamedImports,
    named_exports: js_ast.Ast.NamedExports,
    import_records_for_current_part: std.ArrayListUnmanaged(u32),
    export_star_import_records: std.ArrayListUnmanaged(u32),
    current_scope: *Scope,
    log: Logger.Log,
    module_ref: Ref,
    declared_symbols: js_ast.DeclaredSymbol.List,
    /// When set, codegen is altered
    hot_reloading: bool,
    hmr_api_ref: Ref,

    // stub fields for ImportScanner duck typing
    comptime options: js_parser.Parser.Options = .{
        .jsx = .{},
        .bundle = true,
    },
    comptime import_items_for_namespace: struct {
        pub fn get(_: @This(), _: Ref) ?js_parser.ImportItemForNamespaceMap {
            return null;
        }
    } = .{},
    pub const parser_features = struct {
        pub const typescript = false;
    };

    pub fn init(allocator: std.mem.Allocator, source: *const Logger.Source, hot_reloading: bool) !AstBuilder {
        const scope = try allocator.create(Scope);
        scope.* = .{
            .kind = .entry,
            .label_ref = null,
            .parent = null,
            .generated = .{},
        };
        var ab: AstBuilder = .{
            .allocator = allocator,
            .current_scope = scope,
            .source = source,
            .source_index = @intCast(source.index.get()),
            .stmts = .{},
            .scopes = .{},
            .symbols = .{},
            .import_records = .{},
            .import_records_for_current_part = .{},
            .named_imports = .{},
            .named_exports = .{},
            .log = Logger.Log.init(allocator),
            .export_star_import_records = .{},
            .declared_symbols = .{},
            .hot_reloading = hot_reloading,
            .module_ref = undefined,
            .hmr_api_ref = undefined,
        };
        ab.module_ref = try ab.newSymbol(.other, "module");
        ab.hmr_api_ref = try ab.newSymbol(.other, "hmr");
        return ab;
    }

    pub fn pushScope(p: *AstBuilder, kind: Scope.Kind) *js_ast.Scope {
        try p.scopes.ensureUnusedCapacity(p.allocator, 1);
        try p.current_scope.children.ensureUnusedCapacity(p.allocator, 1);
        const scope = try p.allocator.create(Scope);
        scope.* = .{
            .kind = kind,
            .label_ref = null,
            .parent = p.current_scope,
            .generated = .{},
        };
        p.current_scope.children.appendAssumeCapacity(scope);
        p.scopes.appendAssumeCapacity(p.current_scope);
        p.current_scope = scope;
        return scope;
    }

    pub fn popScope(p: *AstBuilder) void {
        p.current_scope = p.scopes.pop();
    }

    pub fn newSymbol(p: *AstBuilder, kind: Symbol.Kind, identifier: []const u8) !Ref {
        const inner_index: Ref.Int = @intCast(p.symbols.items.len);
        try p.symbols.append(p.allocator, .{
            .kind = kind,
            .original_name = identifier,
        });
        const ref: Ref = .{
            .inner_index = inner_index,
            .source_index = p.source_index,
            .tag = .symbol,
        };
        try p.current_scope.generated.push(p.allocator, ref);
        try p.declared_symbols.append(p.allocator, .{
            .ref = ref,
            .is_top_level = p.scopes.items.len == 0 or p.current_scope == p.scopes.items[0],
        });
        return ref;
    }

    pub fn getSymbol(p: *AstBuilder, ref: Ref) *Symbol {
        bun.assert(ref.source_index == p.source.index.get());
        return &p.symbols.items[ref.inner_index];
    }

    pub fn addImportRecord(p: *AstBuilder, path: []const u8, kind: ImportKind) !u32 {
        const index = p.import_records.items.len;
        try p.import_records.append(p.allocator, .{
            .path = bun.fs.Path.init(path),
            .kind = kind,
            .range = .{},
        });
        return @intCast(index);
    }

    pub fn addImportStmt(
        p: *AstBuilder,
        path: []const u8,
        identifiers_to_import: anytype,
    ) ![identifiers_to_import.len]Expr {
        var out: [identifiers_to_import.len]Expr = undefined;

        const record = try p.addImportRecord(path, .stmt);

        var path_name = bun.fs.PathName.init(path);
        const name = try strings.append(p.allocator, "import_", try path_name.nonUniqueNameString(p.allocator));
        const namespace_ref = try p.newSymbol(.other, name);

        const clauses = try p.allocator.alloc(js_ast.ClauseItem, identifiers_to_import.len);

        inline for (identifiers_to_import, &out, clauses) |import_id_untyped, *out_ref, *clause| {
            const import_id: []const u8 = import_id_untyped; // must be given '[N][]const u8'
            const ref = try p.newSymbol(.import, import_id);
            if (p.hot_reloading) {
                p.getSymbol(ref).namespace_alias = .{
                    .namespace_ref = namespace_ref,
                    .alias = import_id,
                    .import_record_index = record,
                };
            }
            out_ref.* = p.newExpr(E.ImportIdentifier{ .ref = ref });
            clause.* = .{
                .name = .{ .loc = Logger.Loc.Empty, .ref = ref },
                .original_name = import_id,
                .alias = import_id,
            };
        }

        try p.appendStmt(S.Import{
            .namespace_ref = namespace_ref,
            .import_record_index = record,
            .items = clauses,
            .is_single_line = identifiers_to_import.len < 1,
        });

        return out;
    }

    pub fn appendStmt(p: *AstBuilder, data: anytype) !void {
        try p.stmts.ensureUnusedCapacity(p.allocator, 1);
        p.stmts.appendAssumeCapacity(p.newStmt(data));
    }

    pub fn newStmt(p: *AstBuilder, data: anytype) Stmt {
        _ = p;
        return Stmt.alloc(@TypeOf(data), data, Logger.Loc.Empty);
    }

    pub fn newExpr(p: *AstBuilder, data: anytype) Expr {
        _ = p;
        return Expr.init(@TypeOf(data), data, Logger.Loc.Empty);
    }

    pub fn newExternalSymbol(p: *AstBuilder, name: []const u8) !Ref {
        const ref = try p.newSymbol(.other, name);
        const sym = p.getSymbol(ref);
        sym.must_not_be_renamed = true;
        return ref;
    }

    pub fn toBundledAst(p: *AstBuilder, target: options.Target) !js_ast.BundledAst {
        // TODO: missing import scanner
        bun.assert(p.scopes.items.len == 0);
        const module_scope = p.current_scope;

        var parts = try Part.List.initCapacity(p.allocator, 2);
        parts.len = 2;
        parts.mut(0).* = .{};
        parts.mut(1).* = .{
            .stmts = p.stmts.items,
            .can_be_removed_if_unused = false,

            // pretend that every symbol was used
            .symbol_uses = uses: {
                var map: Part.SymbolUseMap = .{};
                try map.ensureTotalCapacity(p.allocator, p.symbols.items.len);
                for (0..p.symbols.items.len) |i| {
                    map.putAssumeCapacity(Ref{
                        .tag = .symbol,
                        .source_index = p.source_index,
                        .inner_index = @intCast(i),
                    }, .{ .count_estimate = 1 });
                }
                break :uses map;
            },
        };

        const single_u32 = try BabyList(u32).fromSlice(p.allocator, &.{1});

        var top_level_symbols_to_parts = js_ast.Ast.TopLevelSymbolToParts{};
        try top_level_symbols_to_parts.entries.setCapacity(p.allocator, module_scope.generated.len);
        top_level_symbols_to_parts.entries.len = module_scope.generated.len;
        const slice = top_level_symbols_to_parts.entries.slice();
        for (
            slice.items(.key),
            slice.items(.value),
            module_scope.generated.slice(),
        ) |*k, *v, ref| {
            k.* = ref;
            v.* = single_u32;
        }
        try top_level_symbols_to_parts.reIndex(p.allocator);

        // For more details on this section, look at js_parser.toAST
        // This is mimicking how it calls ImportScanner
        if (p.hot_reloading) {
            var hmr_transform_ctx = js_parser.ConvertESMExportsForHmr{
                .last_part = parts.last() orelse
                    unreachable, // was definitely allocated
                .is_in_node_modules = p.source.path.isNodeModule(),
            };
            try hmr_transform_ctx.stmts.ensureTotalCapacity(p.allocator, prealloc_count: {
                // get a estimate on how many statements there are going to be
                const count = p.stmts.items.len;
                break :prealloc_count count + 2;
            });

            _ = try js_parser.ImportScanner.scan(AstBuilder, p, p.stmts.items, false, true, &hmr_transform_ctx);

            try hmr_transform_ctx.finalize(p, parts.slice());
            const new_parts = parts.slice();
            // preserve original capacity
            parts.len = @intCast(new_parts.len);
            bun.assert(new_parts.ptr == parts.ptr);
        } else {
            const result = try js_parser.ImportScanner.scan(AstBuilder, p, p.stmts.items, false, false, {});
            parts.mut(1).stmts = result.stmts;
        }

        parts.mut(1).declared_symbols = p.declared_symbols;
        parts.mut(1).scopes = p.scopes.items;
        parts.mut(1).import_record_indices = BabyList(u32).fromList(p.import_records_for_current_part);

        return .{
            .parts = parts,
            .module_scope = module_scope.*,
            .symbols = js_ast.Symbol.List.fromList(p.symbols),
            .exports_ref = Ref.None,
            .wrapper_ref = Ref.None,
            .module_ref = p.module_ref,
            .import_records = ImportRecord.List.fromList(p.import_records),
            .export_star_import_records = &.{},
            .approximate_newline_count = 1,
            .exports_kind = .esm,
            .named_imports = p.named_imports,
            .named_exports = p.named_exports,
            .top_level_symbols_to_parts = top_level_symbols_to_parts,
            .char_freq = .{},
            .flags = .{},
            .target = target,
            .top_level_await_keyword = Logger.Range.None,
            // .nested_scope_slot_counts = if (p.options.features.minify_identifiers)
            //     renamer.assignNestedScopeSlots(p.allocator, p.scopes.items[0], p.symbols.items)
            // else
            //     js_ast.SlotCounts{},
        };
    }

    // stub methods for ImportScanner duck typing

    pub fn generateTempRef(ab: *AstBuilder, name: ?[]const u8) Ref {
        return ab.newSymbol(.other, name orelse "temp") catch bun.outOfMemory();
    }

    pub fn recordExport(p: *AstBuilder, _: Logger.Loc, alias: []const u8, ref: Ref) !void {
        if (p.named_exports.get(alias)) |_| {
            // Duplicate exports are an error
            Output.panic(
                "In generated file, duplicate export \"{s}\"",
                .{alias},
            );
        } else {
            try p.named_exports.put(p.allocator, alias, .{ .alias_loc = Logger.Loc.Empty, .ref = ref });
        }
    }

    pub fn recordExportedBinding(p: *AstBuilder, binding: Binding) void {
        switch (binding.data) {
            .b_missing => {},
            .b_identifier => |ident| {
                p.recordExport(binding.loc, p.symbols.items[ident.ref.innerIndex()].original_name, ident.ref) catch unreachable;
            },
            .b_array => |array| {
                for (array.items) |prop| {
                    p.recordExportedBinding(prop.binding);
                }
            },
            .b_object => |obj| {
                for (obj.properties) |prop| {
                    p.recordExportedBinding(prop.value);
                }
            },
        }
    }

    pub fn ignoreUsage(p: *AstBuilder, ref: Ref) void {
        _ = p;
        _ = ref;
    }

    pub fn panic(p: *AstBuilder, comptime fmt: []const u8, args: anytype) noreturn {
        _ = p;
        Output.panic(fmt, args);
    }

    pub fn @"module.exports"(p: *AstBuilder, loc: Logger.Loc) Expr {
        return p.newExpr(E.Dot{ .name = "exports", .name_loc = loc, .target = p.newExpr(E.Identifier{ .ref = p.module_ref }) });
    }
};

pub const CssEntryPointMeta = struct {
    /// When this is true, a stub file is added to the Server's IncrementalGraph
    imported_on_server: bool,
};

/// The lifetime of this structure is tied to the bundler's arena
pub const DevServerInput = struct {
    css_entry_points: std.AutoArrayHashMapUnmanaged(Index, CssEntryPointMeta),
};

/// The lifetime of this structure is tied to the bundler's arena
pub const DevServerOutput = struct {
    chunks: []Chunk,
    css_file_list: std.AutoArrayHashMapUnmanaged(Index, CssEntryPointMeta),
    html_files: std.AutoArrayHashMapUnmanaged(Index, void),

    pub fn jsPseudoChunk(out: DevServerOutput) *Chunk {
        return &out.chunks[0];
    }

    pub fn cssChunks(out: DevServerOutput) []Chunk {
        return out.chunks[1..][0..out.css_file_list.count()];
    }

    pub fn htmlChunks(out: DevServerOutput) []Chunk {
        return out.chunks[1 + out.css_file_list.count() ..][0..out.html_files.count()];
    }
};

pub fn generateUniqueKey() u64 {
    const key = std.crypto.random.int(u64) & @as(u64, 0x0FFFFFFF_FFFFFFFF);
    // without this check, putting unique_key in an object key would
    // sometimes get converted to an identifier. ensuring it starts
    // with a number forces that optimization off.
    if (Environment.isDebug) {
        var buf: [16]u8 = undefined;
        const hex = std.fmt.bufPrint(&buf, "{}", .{bun.fmt.hexIntLower(key)}) catch
            unreachable;
        switch (hex[0]) {
            '0'...'9' => {},
            else => Output.panic("unique key is a valid identifier: {s}", .{hex}),
        }
    }
    return key;
}

const ExternalFreeFunctionAllocator = struct {
    free_callback: *const fn (ctx: *anyopaque) callconv(.C) void,
    context: *anyopaque,

    const vtable: std.mem.Allocator.VTable = .{
        .alloc = &alloc,
        .free = &free,
        .resize = &std.mem.Allocator.noResize,
        .remap = &std.mem.Allocator.noRemap,
    };

    pub fn create(free_callback: *const fn (ctx: *anyopaque) callconv(.C) void, context: *anyopaque) std.mem.Allocator {
        return .{
            .ptr = bun.create(bun.default_allocator, ExternalFreeFunctionAllocator, .{
                .free_callback = free_callback,
                .context = context,
            }),
            .vtable = &vtable,
        };
    }

    fn alloc(_: *anyopaque, _: usize, _: std.mem.Alignment, _: usize) ?[*]u8 {
        return null;
    }

    fn free(ext_free_function: *anyopaque, _: []u8, _: std.mem.Alignment, _: usize) void {
        const info: *ExternalFreeFunctionAllocator = @alignCast(@ptrCast(ext_free_function));
        info.free_callback(info.context);
        bun.default_allocator.destroy(info);
    }
};
