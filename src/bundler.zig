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
const schema = @import("api/schema.zig");
const Api = schema.Api;
const _resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ThreadSafeHashMap = @import("./thread_safe_hash_map.zig");
const ImportRecord = @import("./import_record.zig").ImportRecord;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const runtime = @import("./runtime.zig");
const Timer = @import("./timer.zig");
const hash_map = @import("hash_map.zig");
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const DebugLogs = _resolver.DebugLogs;
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const Router = @import("./router.zig");
const isPackagePath = _resolver.isPackagePath;
const Css = @import("css_scanner.zig");
const DotEnv = @import("./env_loader.zig");
const Lock = @import("./lock.zig").Lock;
const NewBunQueue = @import("./bun_queue.zig").NewBunQueue;
const NodeFallbackModules = @import("./node_fallbacks.zig");
const CacheEntry = @import("./cache.zig").FsCacheEntry;

// How it works end-to-end
// 1. Resolve a file path from input using the resolver
// 2. Look at the extension of that file path, and determine a loader
// 3. If the loader is .js, .jsx, .ts, .tsx, or .json, run it through our JavaScript Parser
// IF serving via HTTP and it's parsed without errors:
// 4. If parsed without errors, generate a strong ETag & write the output to a buffer that sends to the in the Printer.
// 4. Else, write any errors to error page (which doesn't exist yet)
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
//          memory-saving recycling logic since that could be many many ASTs.
//  5. Once all files are written, determine the shortest common path
//  6. Move all the temporary files to their intended destinations
// IF writing to disk AND it's a file-like loader
// 4. Hash the contents
//     - rewrite_paths.put(absolute_path, hash(file(absolute_path)))
// 5. Resolve any imports of this file to that hash(file(absolute_path))
// 6. Append to the files array with the new filename
// 7. When parsing & resolving is over, just copy the file.
//     - on macOS, ensure it does an APFS shallow clone so that doesn't use disk space (only possible if file doesn't already exist)
//          fclonefile
// IF serving via HTTP AND it's a file-like loader:
// 4. Use os.sendfile so copying/reading the file happens in the kernel instead of in Bun.
//      This unfortunately means content hashing for HTTP server is unsupported, but metadata etags work
// For each imported file, GOTO 1.

pub const ParseResult = struct {
    source: logger.Source,
    loader: options.Loader,
    ast: js_ast.Ast,
    input_fd: ?StoredFileDescriptorType = null,
    empty: bool = false,
};

pub fn NewBundler(cache_files: bool) type {
    return struct {
        pub const Linker = if (cache_files) linker.Linker else linker.ServeLinker;
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
        router: ?Router = null,

        linker: Linker,
        timer: Timer = Timer{},
        env: *DotEnv.Loader,

        // must be pointer array because we can't we don't want the source to point to invalid memory if the array size is reallocated
        virtual_modules: std.ArrayList(*ClientEntryPoint),

        pub const isCacheEnabled = cache_files;

        pub fn clone(this: *ThisBundler, allocator: *std.mem.Allocator, to: *ThisBundler) !void {
            to.* = this.*;
            to.setAllocator(allocator);
            to.log = try allocator.create(logger.Log);
            to.log.* = logger.Log.init(allocator);
            to.setLog(to.log);
        }

        pub fn setLog(this: *ThisBundler, log: *logger.Log) void {
            this.log = log;
            this.linker.log = log;
            this.resolver.log = log;
        }

        pub fn setAllocator(this: *ThisBundler, allocator: *std.mem.Allocator) void {
            this.allocator = allocator;
            this.linker.allocator = allocator;
            this.resolver.allocator = allocator;
        }

        // to_bundle:

        // thread_pool: *ThreadPool,

        pub fn init(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            opts: Api.TransformOptions,
            existing_bundle: ?*NodeModuleBundle,
            env_loader_: ?*DotEnv.Loader,
        ) !ThisBundler {
            js_ast.Expr.Data.Store.create(allocator);
            js_ast.Stmt.Data.Store.create(allocator);
            var fs = try Fs.FileSystem.init1(
                allocator,
                opts.absolute_working_dir,
            );
            const bundle_options = try options.BundleOptions.fromApi(
                allocator,
                fs,
                log,
                opts,
                existing_bundle,
            );

            var env_loader = env_loader_ orelse brk: {
                var map = try allocator.create(DotEnv.Map);
                map.* = DotEnv.Map.init(allocator);

                var loader = try allocator.create(DotEnv.Loader);
                loader.* = DotEnv.Loader.init(map, allocator);
                break :brk loader;
            };
            // var pool = try allocator.create(ThreadPool);
            // try pool.init(ThreadPool.InitConfig{
            //     .allocator = allocator,
            // });
            var resolve_results = try allocator.create(ResolveResults);
            resolve_results.* = ResolveResults.init(allocator);
            return ThisBundler{
                .options = bundle_options,
                .fs = fs,
                .allocator = allocator,
                .resolver = Resolver.init1(allocator, log, fs, bundle_options),
                .log = log,
                // .thread_pool = pool,
                .linker = undefined,
                .result = options.TransformResult{ .outbase = bundle_options.output_dir },
                .resolve_results = resolve_results,
                .resolve_queue = ResolveQueue.init(allocator),
                .output_files = std.ArrayList(options.OutputFile).init(allocator),
                .virtual_modules = std.ArrayList(*ClientEntryPoint).init(allocator),
                .env = env_loader,
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

        pub fn runEnvLoader(this: *ThisBundler) !void {
            switch (this.options.env.behavior) {
                .prefix, .load_all => {
                    // Step 1. Load the project root.
                    var dir: *Fs.FileSystem.DirEntry = ((this.resolver.readDirInfo(this.fs.top_level_dir) catch return) orelse return).getEntries() orelse return;

                    // Process always has highest priority.
                    this.env.loadProcess();
                    if (this.options.production) {
                        try this.env.load(&this.fs.fs, dir, false);
                    } else {
                        try this.env.load(&this.fs.fs, dir, true);
                    }
                },
                else => {},
            }
        }

        // This must be run after a framework is configured, if a framework is enabled
        pub fn configureDefines(this: *ThisBundler) !void {
            if (this.options.defines_loaded) {
                return;
            }

            try this.runEnvLoader();

            js_ast.Expr.Data.Store.create(this.allocator);
            js_ast.Stmt.Data.Store.create(this.allocator);
            defer js_ast.Expr.Data.Store.reset();
            defer js_ast.Stmt.Data.Store.reset();

            if (this.options.framework) |framework| {
                if (this.options.platform.isClient()) {
                    try this.options.loadDefines(this.allocator, this.env, &framework.client.env);
                } else {
                    try this.options.loadDefines(this.allocator, this.env, &framework.server.env);
                }
            } else {
                try this.options.loadDefines(this.allocator, this.env, &this.options.env);
            }
        }

        pub fn configureFramework(
            this: *ThisBundler,
            comptime load_defines: bool,
        ) !void {
            if (this.options.framework) |*framework| {
                if (framework.needsResolveFromPackage()) {
                    var route_config = this.options.routes;
                    var pair = PackageJSON.FrameworkRouterPair{ .framework = framework, .router = &route_config };

                    if (framework.development) {
                        try this.resolver.resolveFramework(framework.package, &pair, .development, load_defines);
                    } else {
                        try this.resolver.resolveFramework(framework.package, &pair, .production, load_defines);
                    }

                    if (this.options.areDefinesUnset()) {
                        if (this.options.platform.isClient()) {
                            this.options.env = framework.client.env;
                        } else {
                            this.options.env = framework.server.env;
                        }
                    }

                    if (pair.loaded_routes) {
                        this.options.routes = route_config;
                    }
                    framework.resolved = true;
                    this.options.framework = framework.*;
                } else if (!framework.resolved) {
                    Global.panic("directly passing framework path is not implemented yet!", .{});
                }
            }
        }

        pub fn configureFrameworkWithResolveResult(this: *ThisBundler, comptime client: bool) !?_resolver.Result {
            if (this.options.framework != null) {
                try this.configureFramework(true);
                if (comptime client) {
                    if (this.options.framework.?.client.isEnabled()) {
                        return try this.resolver.resolve(this.fs.top_level_dir, this.options.framework.?.client.path, .stmt);
                    }

                    if (this.options.framework.?.fallback.isEnabled()) {
                        return try this.resolver.resolve(this.fs.top_level_dir, this.options.framework.?.fallback.path, .stmt);
                    }
                } else {
                    if (this.options.framework.?.server.isEnabled()) {
                        return try this.resolver.resolve(this.fs.top_level_dir, this.options.framework.?.server, .stmt);
                    }
                }
            }

            return null;
        }

        pub fn configureRouter(this: *ThisBundler, comptime load_defines: bool) !void {
            try this.configureFramework(load_defines);
            defer {
                if (load_defines) {
                    this.configureDefines() catch {};
                }
            }

            // if you pass just a directory, activate the router configured for the pages directory
            // for now:
            // - "." is not supported
            // - multiple pages directories is not supported
            if (!this.options.routes.routes_enabled and this.options.entry_points.len == 1 and !this.options.serve) {

                // When inferring:
                // - pages directory with a file extension is not supported. e.g. "pages.app/" won't work.
                //     This is a premature optimization to avoid this magical auto-detection we do here from meaningfully increasing startup time if you're just passing a file
                //     readDirInfo is a recursive lookup, top-down instead of bottom-up. It opens each folder handle and potentially reads the package.jsons
                // So it is not fast! Unless it's already cached.
                var paths = [_]string{std.mem.trimLeft(u8, this.options.entry_points[0], "./")};
                if (std.mem.indexOfScalar(u8, paths[0], '.') == null) {
                    var pages_dir_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                    var entry = this.fs.absBuf(&paths, &pages_dir_buf);

                    if (std.fs.path.extension(entry).len == 0) {
                        allocators.constStrToU8(entry).ptr[entry.len] = '/';

                        // Only throw if they actually passed in a route config and the directory failed to load
                        var dir_info_ = this.resolver.readDirInfo(entry) catch return;
                        var dir_info = dir_info_ orelse return;

                        this.options.routes.dir = dir_info.abs_path;
                        this.options.routes.extensions = std.mem.span(&options.RouteConfig.DefaultExtensions);
                        this.options.routes.routes_enabled = true;
                        this.router = try Router.init(this.fs, this.allocator, this.options.routes);
                        try this.router.?.loadRoutes(
                            dir_info,
                            Resolver,
                            &this.resolver,
                            std.math.maxInt(u16),
                            true,
                        );
                        this.router.?.routes.client_framework_enabled = this.options.isFrontendFrameworkEnabled();
                        return;
                    }
                }
            } else if (this.options.routes.routes_enabled) {
                var dir_info_ = try this.resolver.readDirInfo(this.options.routes.dir);
                var dir_info = dir_info_ orelse return error.MissingRoutesDir;

                this.options.routes.dir = dir_info.abs_path;

                this.router = try Router.init(this.fs, this.allocator, this.options.routes);
                try this.router.?.loadRoutes(dir_info, Resolver, &this.resolver, std.math.maxInt(u16), true);
                this.router.?.routes.client_framework_enabled = this.options.isFrontendFrameworkEnabled();
                return;
            }

            // If we get this far, it means they're trying to run the bundler without a preconfigured router
            if (this.options.entry_points.len > 0) {
                this.options.routes.routes_enabled = false;
            }

            if (this.router) |*router| {
                router.routes.client_framework_enabled = this.options.isFrontendFrameworkEnabled();
            }
        }

        pub fn resetStore(bundler: *ThisBundler) void {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();
        }

        pub const GenerateNodeModuleBundle = struct {
            const BunQueue = NewBunQueue(_resolver.Result);

            pub const ThreadPool = struct {
                // Hardcode 512 as max number of threads for now.
                workers: [512]Worker = undefined,
                workers_used: u32 = 0,
                cpu_count: u32 = 0,
                started_workers: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
                stopped_workers: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
                completed_count: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
                pub fn start(this: *ThreadPool, generator: *GenerateNodeModuleBundle) !void {
                    generator.bundler.env.loadProcess();

                    this.cpu_count = @truncate(u32, @divFloor((try std.Thread.getCpuCount()) + 1, 2));

                    if (generator.bundler.env.map.get("GOMAXPROCS")) |max_procs| {
                        if (std.fmt.parseInt(u32, max_procs, 10)) |cpu_count| {
                            this.cpu_count = std.math.min(this.cpu_count, cpu_count);
                        } else |err| {}
                    }

                    if (this.cpu_count <= 1) return;

                    while (this.workers_used < this.cpu_count) : (this.workers_used += 1) {
                        try this.workers[this.workers_used].init(generator);
                    }
                }

                pub fn wait(this: *ThreadPool, generator: *GenerateNodeModuleBundle) !void {
                    if (this.cpu_count <= 1) {
                        var worker = generator.allocator.create(Worker) catch unreachable;
                        worker.* = Worker{
                            .generator = generator,
                            .allocator = generator.allocator,
                            .data = generator.allocator.create(Worker.WorkerData) catch unreachable,
                            .thread_id = undefined,
                            .thread = undefined,
                        };
                        worker.data.shared_buffer = try MutableString.init(generator.allocator, 0);
                        worker.data.scan_pass_result = js_parser.ScanPassResult.init(generator.allocator);
                        worker.data.log = generator.log.*;

                        defer {
                            generator.log.* = worker.data.log;
                            worker.data.deinit(generator.allocator);
                        }

                        while (generator.queue.next()) |item| {
                            try generator.processFile(worker, item);
                        }
                        return;
                    }

                    while (generator.queue.count.load(.SeqCst) != generator.pool.completed_count.load(.SeqCst)) {
                        var j: usize = 0;
                        while (j < 100) : (j += 1) {}
                        std.atomic.spinLoopHint();
                    }

                    for (this.workers[0..this.workers_used]) |*worker| {
                        worker.data.log.appendTo(generator.log) catch {};
                    }

                    for (this.workers[0..this.workers_used]) |*worker| {
                        @atomicStore(bool, &worker.quit, true, .Release);
                    }

                    while (this.stopped_workers.load(.Acquire) != this.workers_used) {
                        var j: usize = 0;
                        while (j < 100) : (j += 1) {}
                        std.atomic.spinLoopHint();
                    }

                    for (this.workers[0..this.workers_used]) |*worker| {
                        worker.thread.join();
                    }
                }

                pub const Task = struct {
                    result: _resolver.Result,
                    generator: *GenerateNodeModuleBundle,
                };

                pub const Worker = struct {
                    thread_id: std.Thread.Id,
                    thread: std.Thread,

                    allocator: *std.mem.Allocator,
                    generator: *GenerateNodeModuleBundle,
                    data: *WorkerData = undefined,
                    quit: bool = false,

                    has_notify_started: bool = false,

                    pub const WorkerData = struct {
                        shared_buffer: MutableString = undefined,
                        scan_pass_result: js_parser.ScanPassResult = undefined,
                        log: logger.Log,

                        pub fn deinit(this: *WorkerData, allocator: *std.mem.Allocator) void {
                            this.shared_buffer.deinit();
                            this.scan_pass_result.named_imports.deinit();
                            this.scan_pass_result.import_records.deinit();
                            allocator.destroy(this);
                        }
                    };

                    pub fn init(worker: *Worker, generator: *GenerateNodeModuleBundle) !void {
                        worker.generator = generator;
                        worker.thread = try std.Thread.spawn(.{}, Worker.run, .{worker});
                    }

                    pub fn notifyStarted(this: *Worker) void {
                        if (!this.has_notify_started) {
                            this.has_notify_started = true;
                            _ = this.generator.pool.started_workers.fetchAdd(1, .Release);
                            std.Thread.Futex.wake(&this.generator.pool.started_workers, std.math.maxInt(u32));
                        }
                    }

                    pub fn run(this: *Worker) void {
                        Output.Source.configureThread();
                        this.thread_id = std.Thread.getCurrentId();
                        if (isDebug) {
                            Output.prettyln("Thread started.\n", .{});
                        }
                        defer {
                            if (isDebug) {
                                Output.prettyln("Thread stopped.\n", .{});
                            }
                            Output.flush();
                        }

                        this.loop() catch |err| {
                            Output.prettyErrorln("<r><red>Error: {s}<r>", .{@errorName(err)});
                        };
                    }

                    pub fn loop(this: *Worker) anyerror!void {
                        defer {
                            _ = this.generator.pool.stopped_workers.fetchAdd(1, .Release);
                            this.notifyStarted();

                            std.Thread.Futex.wake(&this.generator.pool.stopped_workers, 1);
                            // std.Thread.Futex.wake(&this.generator.queue.len, std.math.maxInt(u32));
                        }

                        js_ast.Expr.Data.Store.create(this.generator.allocator);
                        js_ast.Stmt.Data.Store.create(this.generator.allocator);
                        this.data = this.generator.allocator.create(WorkerData) catch unreachable;
                        this.data.* = WorkerData{
                            .log = logger.Log.init(this.generator.allocator),
                        };
                        this.data.shared_buffer = try MutableString.init(this.generator.allocator, 0);
                        this.data.scan_pass_result = js_parser.ScanPassResult.init(this.generator.allocator);

                        defer {
                            this.data.deinit(this.generator.allocator);
                        }

                        this.notifyStarted();

                        while (!@atomicLoad(bool, &this.quit, .Acquire)) {
                            while (this.generator.queue.next()) |item| {
                                defer {
                                    _ = this.generator.pool.completed_count.fetchAdd(1, .Release);
                                }

                                try this.generator.processFile(this, item);
                            }
                        }
                    }
                };
            };
            write_lock: Lock,

            module_list: std.ArrayList(Api.JavascriptBundledModule),
            package_list: std.ArrayList(Api.JavascriptBundledPackage),
            header_string_buffer: MutableString,

            // Just need to know if we've already enqueued this one
            package_list_map: std.AutoHashMap(u64, u32),
            queue: *BunQueue,
            bundler: *ThisBundler,
            allocator: *std.mem.Allocator,
            tmpfile: std.fs.File,
            log: *logger.Log,
            pool: *ThreadPool,
            tmpfile_byte_offset: u32 = 0,
            code_end_byte_offset: u32 = 0,
            has_jsx: bool = false,

            work_waiter: std.atomic.Atomic(u32) = std.atomic.Atomic(u32).init(0),
            list_lock: Lock = Lock.init(),

            pub const current_version: u32 = 1;
            const dist_index_js_string_pointer = Api.StringPointer{ .length = "dist/index.js".len };
            const index_js_string_pointer = Api.StringPointer{ .length = "index.js".len, .offset = "dist/".len };

            pub fn enqueueItem(this: *GenerateNodeModuleBundle, resolve: _resolver.Result) !void {
                var result = resolve;
                var path = result.path() orelse return;

                const loader = this.bundler.options.loaders.get(path.name.ext) orelse .file;
                if (!loader.isJavaScriptLikeOrJSON()) return;
                path.* = try path.dupeAlloc(this.allocator);

                if (BundledModuleData.get(this, &result)) |mod| {
                    try this.queue.upsert(mod.module_id, result);
                } else {
                    try this.queue.upsert(result.hash(this.bundler.fs.top_level_dir, loader), result);
                }
            }

            // The Bun Bundle Format
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

            pub fn appendHeaderString(generator: *GenerateNodeModuleBundle, str: string) !Api.StringPointer {
                // This is so common we might as well just reuse it
                // Plus this is one machine word so it's a quick comparison
                if (strings.eqlComptime(str, "index.js")) {
                    return index_js_string_pointer;
                } else if (strings.eqlComptime(str, "dist/index.js")) {
                    return dist_index_js_string_pointer;
                }

                var offset = generator.header_string_buffer.list.items.len;
                try generator.header_string_buffer.append(str);
                return Api.StringPointer{
                    .offset = @truncate(u32, offset),
                    .length = @truncate(u32, str.len),
                };
            }

            pub fn generate(
                bundler: *ThisBundler,
                allocator: *std.mem.Allocator,
                framework_config: ?Api.LoadedFramework,
                route_config: ?Api.LoadedRouteConfig,
                destination: [*:0]const u8,
            ) !?Api.JavascriptBundleContainer {
                var tmpdir: std.fs.Dir = try bundler.fs.fs.openTmpDir();
                var tmpname_buf: [64]u8 = undefined;
                bundler.resetStore();
                try bundler.configureDefines();

                const tmpname = try bundler.fs.tmpname(
                    ".bun",
                    std.mem.span(&tmpname_buf),
                    std.hash.Wyhash.hash(0, std.mem.span(destination)),
                );

                var tmpfile = try tmpdir.createFileZ(tmpname, .{ .read = isDebug, .exclusive = true });

                errdefer {
                    tmpfile.close();
                    tmpdir.deleteFile(std.mem.span(tmpname)) catch {};
                }

                var generator = try allocator.create(GenerateNodeModuleBundle);
                var queue = try BunQueue.init(allocator);
                defer allocator.destroy(generator);
                generator.* = GenerateNodeModuleBundle{
                    .module_list = std.ArrayList(Api.JavascriptBundledModule).init(allocator),
                    .package_list = std.ArrayList(Api.JavascriptBundledPackage).init(allocator),
                    .header_string_buffer = try MutableString.init(allocator, "dist/index.js".len),
                    .allocator = allocator,
                    .queue = queue,
                    // .resolve_queue = queue,
                    .bundler = bundler,
                    .tmpfile = tmpfile,
                    .log = bundler.log,
                    .package_list_map = std.AutoHashMap(u64, u32).init(allocator),
                    .pool = undefined,
                    .write_lock = Lock.init(),
                };
                // dist/index.js appears more common than /index.js
                // but this means we can store both "dist/index.js" and "index.js" in one.
                try generator.header_string_buffer.append("dist/index.js");
                try generator.package_list_map.ensureTotalCapacity(128);
                var pool = try allocator.create(ThreadPool);
                pool.* = ThreadPool{};
                generator.pool = pool;

                var this = generator;
                // Always inline the runtime into the bundle
                try generator.appendBytes(&initial_header);
                // If we try to be smart and rely on .written, it turns out incorrect
                const code_start_pos = try this.tmpfile.getPos();
                if (isDebug) {
                    try generator.appendBytes(runtime.Runtime.sourceContent());
                    try generator.appendBytes("\n\n");
                } else {
                    try generator.appendBytes(comptime runtime.Runtime.sourceContent() ++ "\n\n");
                }

                if (bundler.log.level == .verbose) {
                    bundler.resolver.debug_logs = try DebugLogs.init(allocator);
                }
                const include_refresh_runtime = !this.bundler.options.production and this.bundler.options.jsx.supports_fast_refresh and bundler.options.platform.isWebLike();

                const resolve_queue_estimate = bundler.options.entry_points.len +
                    @intCast(usize, @boolToInt(framework_config != null)) +
                    @intCast(usize, @boolToInt(include_refresh_runtime)) +
                    @intCast(usize, @boolToInt(bundler.options.jsx.parse));

                if (bundler.router) |router| {
                    defer this.bundler.resetStore();

                    const entry_points = try router.getEntryPoints(allocator);
                    for (entry_points) |entry_point| {
                        const source_dir = bundler.fs.top_level_dir;
                        const resolved = try bundler.linker.resolver.resolve(source_dir, entry_point, .entry_point);
                        try this.enqueueItem(resolved);
                    }
                    this.bundler.resetStore();
                } else {}

                for (bundler.options.entry_points) |entry_point| {
                    if (bundler.options.platform == .bun) continue;
                    defer this.bundler.resetStore();

                    const entry_point_path = bundler.normalizeEntryPointPath(entry_point);
                    const source_dir = bundler.fs.top_level_dir;
                    const resolved = try bundler.linker.resolver.resolve(source_dir, entry_point, .entry_point);
                    try this.enqueueItem(resolved);
                }

                if (framework_config) |conf| {
                    defer this.bundler.resetStore();

                    try this.bundler.configureFramework(true);
                    if (bundler.options.framework) |framework| {
                        if (bundler.options.platform == .bun) {
                            if (framework.server.isEnabled()) {
                                const resolved = try bundler.linker.resolver.resolve(
                                    bundler.fs.top_level_dir,
                                    framework.server.path,
                                    .entry_point,
                                );
                                try this.enqueueItem(resolved);
                            }
                        } else {
                            if (framework.client.isEnabled()) {
                                const resolved = try bundler.linker.resolver.resolve(
                                    bundler.fs.top_level_dir,
                                    framework.client.path,
                                    .entry_point,
                                );
                                try this.enqueueItem(resolved);
                            }

                            if (framework.fallback.isEnabled()) {
                                const resolved = try bundler.linker.resolver.resolve(
                                    bundler.fs.top_level_dir,
                                    framework.fallback.path,
                                    .entry_point,
                                );
                                try this.enqueueItem(resolved);
                            }
                        }
                    }
                } else {}

                // Normally, this is automatic
                // However, since we only do the parsing pass, it may not get imported automatically.
                if (bundler.options.jsx.parse) {
                    defer this.bundler.resetStore();
                    if (this.bundler.resolver.resolve(
                        this.bundler.fs.top_level_dir,
                        this.bundler.options.jsx.import_source,
                        .require,
                    )) |new_jsx_runtime| {
                        try this.enqueueItem(new_jsx_runtime);
                    } else |err| {}
                }

                if (include_refresh_runtime) {
                    defer this.bundler.resetStore();

                    if (this.bundler.resolver.resolve(
                        this.bundler.fs.top_level_dir,
                        this.bundler.options.jsx.refresh_runtime,
                        .require,
                    )) |refresh_runtime| {
                        try this.enqueueItem(refresh_runtime);
                    } else |err| {}
                }

                this.bundler.resetStore();

                try this.pool.start(this);
                try this.pool.wait(this);

                if (this.log.errors > 0) {
                    tmpfile.close();
                    tmpdir.deleteFile(std.mem.span(tmpname)) catch {};
                    // We stop here because if there are errors we don't know if the bundle is valid
                    // This manifests as a crash when sorting through the module list because we may have added files to the bundle which were never actually finished being added.
                    return null;
                }

                // Ensure we never overflow
                this.code_end_byte_offset = @truncate(
                    u32,
                    // Doing this math ourself seems to not necessarily produce correct results
                    (try this.tmpfile.getPos()),
                );

                var javascript_bundle_container = std.mem.zeroes(Api.JavascriptBundleContainer);

                std.sort.sort(
                    Api.JavascriptBundledModule,
                    this.module_list.items,
                    this,
                    GenerateNodeModuleBundle.sortJavascriptModuleByPath,
                );
                var hasher = std.hash.Wyhash.init(0);

                // We want to sort the packages as well as the files
                // The modules sort the packages already
                // So can just copy it in the below loop.
                var sorted_package_list = try allocator.alloc(Api.JavascriptBundledPackage, this.package_list.items.len);

                // At this point, the module_list is sorted.
                if (this.module_list.items.len > 0) {
                    var package_id_i: u32 = 0;
                    var i: usize = 0;
                    // Assumption: node_modules are immutable
                    // Assumption: module files are immutable
                    // (They're not. But, for our purposes that's okay)
                    // The etag is:
                    // - The hash of each module's path in sorted order
                    // - The hash of each module's code size in sorted order
                    // - hash(hash(package_name, package_version))
                    // If this doesn't prove strong enough, we will do a proper content hash
                    // But I want to avoid that overhead unless proven necessary.
                    // There's a good chance we don't even strictly need an etag here.
                    var bytes: [4]u8 = undefined;
                    while (i < this.module_list.items.len) {
                        var current_package_id = this.module_list.items[i].package_id;
                        this.module_list.items[i].package_id = package_id_i;
                        var offset = @truncate(u32, i);

                        i += 1;

                        while (i < this.module_list.items.len and this.module_list.items[i].package_id == current_package_id) : (i += 1) {
                            this.module_list.items[i].package_id = package_id_i;
                            // Hash the file path
                            hasher.update(this.metadataStringPointer(this.module_list.items[i].path));
                            // Then the length of the code
                            std.mem.writeIntNative(u32, &bytes, this.module_list.items[i].code.length);
                            hasher.update(&bytes);
                        }

                        this.package_list.items[current_package_id].modules_offset = offset;
                        this.package_list.items[current_package_id].modules_length = @truncate(u32, i) - offset;

                        // Hash the hash of the package name
                        // it's hash(hash(package_name, package_version))
                        std.mem.writeIntNative(u32, &bytes, this.package_list.items[current_package_id].hash);
                        hasher.update(&bytes);

                        sorted_package_list[package_id_i] = this.package_list.items[current_package_id];
                        package_id_i += 1;
                    }
                }

                var javascript_bundle = std.mem.zeroes(Api.JavascriptBundle);
                javascript_bundle.modules = this.module_list.items;
                javascript_bundle.packages = sorted_package_list;
                javascript_bundle.manifest_string = this.header_string_buffer.list.items;
                const etag_u64 = hasher.final();
                // We store the etag as a ascii hex encoded u64
                // This is so we can send the bytes directly in the HTTP server instead of formatting it as hex each time.
                javascript_bundle.etag = try std.fmt.allocPrint(allocator, "{x}", .{etag_u64});
                javascript_bundle.generated_at = @truncate(u32, @intCast(u64, std.time.milliTimestamp()));

                const basename = std.fs.path.basename(std.mem.span(destination));
                const extname = std.fs.path.extension(basename);
                javascript_bundle.import_from_name = try std.fmt.allocPrint(
                    this.allocator,
                    "/{s}.{x}.bun",
                    .{
                        basename[0 .. basename.len - extname.len],
                        etag_u64,
                    },
                );

                javascript_bundle_container.bundle_format_version = current_version;
                javascript_bundle_container.bundle = javascript_bundle;
                javascript_bundle_container.code_length = this.code_end_byte_offset;
                javascript_bundle_container.framework = framework_config;
                javascript_bundle_container.routes = route_config;

                var start_pos = try this.tmpfile.getPos();
                var tmpwriter = std.io.bufferedWriter(this.tmpfile.writer());
                const SchemaWriter = schema.Writer(@TypeOf(tmpwriter.writer()));
                var schema_file_writer = SchemaWriter.init(tmpwriter.writer());
                try javascript_bundle_container.encode(&schema_file_writer);
                try tmpwriter.flush();

                // sanity check
                if (isDebug) {
                    try this.tmpfile.seekTo(start_pos);
                    var contents = try allocator.alloc(u8, (try this.tmpfile.getEndPos()) - start_pos);
                    var read_bytes = try this.tmpfile.read(contents);
                    var buf = contents[0..read_bytes];
                    var reader = schema.Reader.init(buf, allocator);

                    var decoder = try Api.JavascriptBundleContainer.decode(
                        &reader,
                    );
                    std.debug.assert(decoder.code_length.? == javascript_bundle_container.code_length.?);
                }

                var code_length_bytes: [4]u8 = undefined;
                std.mem.writeIntNative(u32, &code_length_bytes, this.code_end_byte_offset);
                _ = try std.os.pwrite(this.tmpfile.handle, &code_length_bytes, magic_bytes.len);

                // Without his mutex, we get a crash at this location:
                // try std.os.renameat(tmpdir.fd, tmpname, top_dir.fd, destination);
                // ^
                const top_dir = try std.fs.openDirAbsolute(Fs.FileSystem.instance.top_level_dir, .{});
                _ = C.fchmod(
                    this.tmpfile.handle,
                    // chmod 777
                    0000010 | 0000100 | 0000001 | 0001000 | 0000040 | 0000004 | 0000002 | 0000400 | 0000200 | 0000020,
                );
                try std.os.renameatZ(tmpdir.fd, tmpname, top_dir.fd, destination);

                // Print any errors at the end
                // try this.log.print(Output.errorWriter());
                return javascript_bundle_container;
            }

            pub fn metadataStringPointer(this: *GenerateNodeModuleBundle, ptr: Api.StringPointer) string {
                return this.header_string_buffer.list.items[ptr.offset .. ptr.offset + ptr.length];
            }

            // Since we trim the prefixes, we must also compare the package name and version
            pub fn sortJavascriptModuleByPath(ctx: *GenerateNodeModuleBundle, a: Api.JavascriptBundledModule, b: Api.JavascriptBundledModule) bool {
                if (comptime isDebug) {
                    const a_pkg: Api.JavascriptBundledPackage = ctx.package_list.items[a.package_id];
                    const b_pkg: Api.JavascriptBundledPackage = ctx.package_list.items[b.package_id];
                    const a_name = ctx.metadataStringPointer(a_pkg.name);
                    const b_name = ctx.metadataStringPointer(b_pkg.name);
                    const a_version = ctx.metadataStringPointer(a_pkg.version);
                    const b_version = ctx.metadataStringPointer(b_pkg.version);
                    const a_path = ctx.metadataStringPointer(a.path);
                    const b_path = ctx.metadataStringPointer(b.path);

                    std.debug.assert(a_name.len > 0);
                    std.debug.assert(b_name.len > 0);
                    std.debug.assert(a_version.len > 0);
                    std.debug.assert(b_version.len > 0);
                    std.debug.assert(a_path.len > 0);
                    std.debug.assert(b_path.len > 0);

                    if (strings.eql(a_name, b_name)) {
                        if (strings.eql(a_version, b_version)) {
                            std.debug.assert(a_pkg.hash == b_pkg.hash); // hash collision
                            std.debug.assert(a.package_id == b.package_id); // duplicate package
                            std.debug.assert(!strings.eql(a_path, b_path)); // duplicate module
                        } else {
                            std.debug.assert(a_pkg.hash != b_pkg.hash); // incorrectly generated hash
                        }
                    } else {
                        std.debug.assert(a_pkg.hash != b_pkg.hash); // incorrectly generated hash
                    }
                }

                return switch (std.mem.order(
                    u8,
                    ctx.metadataStringPointer(
                        ctx.package_list.items[a.package_id].name,
                    ),
                    ctx.metadataStringPointer(
                        ctx.package_list.items[b.package_id].name,
                    ),
                )) {
                    .eq => switch (std.mem.order(
                        u8,
                        ctx.metadataStringPointer(
                            ctx.package_list.items[a.package_id].version,
                        ),
                        ctx.metadataStringPointer(
                            ctx.package_list.items[b.package_id].version,
                        ),
                    )) {
                        .eq => std.mem.order(
                            u8,
                            ctx.metadataStringPointer(a.path),
                            ctx.metadataStringPointer(b.path),
                        ) == .lt,
                        .lt => true,
                        else => false,
                    },
                    .lt => true,
                    else => false,
                };
            }

            // pub fn sortJavascriptPackageByName(ctx: *GenerateNodeModuleBundle, a: Api.JavascriptBundledPackage, b: Api.JavascriptBundledPackage) bool {
            //     return std.mem.order(u8, ctx.metadataStringPointer(a.name), ctx.metadataStringPointer(b.name)) == .lt;
            // }

            pub fn appendBytes(generator: *GenerateNodeModuleBundle, bytes: anytype) !void {
                try generator.tmpfile.writeAll(bytes);
                generator.tmpfile_byte_offset += @truncate(u32, bytes.len);
            }

            const BundledModuleData = struct {
                import_path: string,
                package_path: string,
                package: *const PackageJSON,
                module_id: u32,

                pub fn get(this: *GenerateNodeModuleBundle, resolve_result: *const _resolver.Result) ?BundledModuleData {
                    const path = resolve_result.pathConst() orelse return null;
                    if (strings.eqlComptime(path.namespace, "node")) {
                        const _import_path = path.text["/bun-vfs/node_modules/".len..][resolve_result.package_json.?.name.len + 1 ..];
                        return BundledModuleData{
                            .import_path = _import_path,
                            .package_path = path.text["/bun-vfs/node_modules/".len..],
                            .package = resolve_result.package_json.?,
                            .module_id = resolve_result.package_json.?.hashModule(_import_path),
                        };
                    }

                    var base_path = path.text;

                    const package_json: *const PackageJSON = this.bundler.resolver.rootNodeModulePackageJSON(
                        resolve_result,
                        &base_path,
                    ) orelse return null;
                    const package_base_path = package_json.source.path.sourceDir();
                    const import_path = base_path[package_base_path.len..];
                    const package_path = base_path[package_base_path.len - package_json.name.len - 1 ..];

                    return BundledModuleData{
                        .import_path = import_path,
                        .package_path = package_path,
                        .package = package_json,
                        .module_id = package_json.hashModule(package_path),
                    };
                }
            };

            fn processImportRecord(this: *GenerateNodeModuleBundle, import_record: ImportRecord) !void {}

            pub fn processFile(this: *GenerateNodeModuleBundle, worker: *ThreadPool.Worker, _resolve: _resolver.Result) !void {
                const resolve = _resolve;
                if (resolve.is_external) return;

                var shared_buffer = &worker.data.shared_buffer;
                var scan_pass_result = &worker.data.scan_pass_result;

                const is_from_node_modules = resolve.isLikelyNodeModule();
                var file_path = (resolve.pathConst() orelse unreachable).*;
                const source_dir = file_path.sourceDir();
                const loader = this.bundler.options.loader(file_path.name.ext);
                var bundler = this.bundler;
                defer scan_pass_result.reset();
                defer shared_buffer.reset();
                defer this.bundler.resetStore();
                var log = &worker.data.log;

                // If we're in a node_module, build that almost normally
                if (is_from_node_modules) {
                    switch (loader) {
                        .jsx,
                        .tsx,
                        .js,
                        .ts,
                        => {
                            var written: usize = undefined;
                            var code_offset: u32 = 0;

                            const entry: CacheEntry = brk: {
                                if (!strings.eqlComptime(file_path.namespace, "node"))
                                    break :brk try bundler.resolver.caches.fs.readFileShared(
                                        bundler.fs,
                                        file_path.text,
                                        resolve.dirname_fd,
                                        if (resolve.file_fd != 0) resolve.file_fd else null,
                                        shared_buffer,
                                    );

                                var module_name = file_path.text["/bun-vfs/node_modules/".len..];
                                module_name = module_name[0..strings.indexOfChar(module_name, '/').?];

                                if (NodeFallbackModules.Map.get(module_name)) |mod| {
                                    break :brk CacheEntry{ .contents = mod.code.* };
                                }

                                break :brk CacheEntry{
                                    .contents = "",
                                };
                            };

                            const module_data = BundledModuleData.get(this, &resolve) orelse {
                                const source = logger.Source.initPathString(file_path.text, entry.contents);
                                log.addResolveError(
                                    &source,
                                    logger.Range.None,
                                    this.allocator,
                                    "Bug while resolving: \"{s}\"",
                                    .{file_path.text},
                                    resolve.import_kind,
                                ) catch {};
                                return error.ResolveError;
                            };
                            const module_id = module_data.module_id;
                            const package = module_data.package;
                            const package_relative_path = module_data.import_path;
                            file_path.pretty = module_data.package_path;

                            // Handle empty files
                            // We can't just ignore them. Sometimes code will try to import it. Often because of TypeScript types.
                            // So we just say it's an empty object. Empty object mimicks what "browser": false does as well.
                            // TODO: optimize this so that all the exports for these are done in one line instead of writing repeatedly
                            if (entry.contents.len == 0 or (entry.contents.len < 33 and strings.trim(entry.contents, " \n\r").len == 0)) {
                                this.write_lock.lock();
                                defer this.write_lock.unlock();
                                code_offset = @truncate(u32, try this.tmpfile.getPos());
                                var writer = this.tmpfile.writer();
                                var buffered = std.io.bufferedWriter(writer);

                                var bufwriter = buffered.writer();
                                try bufwriter.writeAll("// ");
                                try bufwriter.writeAll(package_relative_path);
                                try bufwriter.writeAll("\nexport var $");
                                std.fmt.formatInt(module_id, 16, .lower, .{}, bufwriter) catch unreachable;
                                try bufwriter.writeAll(" = () => ({});\n");
                                try buffered.flush();
                                this.tmpfile_byte_offset = @truncate(u32, try this.tmpfile.getPos());
                            } else {
                                const source = logger.Source.initRecycledFile(
                                    Fs.File{
                                        .path = file_path,
                                        .contents = entry.contents,
                                    },
                                    bundler.allocator,
                                ) catch return null;

                                var jsx = bundler.options.jsx;
                                jsx.parse = loader.isJSX();

                                var opts = js_parser.Parser.Options.init(jsx, loader);
                                opts.transform_require_to_import = false;
                                opts.enable_bundling = true;
                                opts.warn_about_unbundled_modules = false;

                                var ast: js_ast.Ast = (try bundler.resolver.caches.js.parse(
                                    bundler.allocator,
                                    opts,
                                    bundler.options.define,
                                    log,
                                    &source,
                                )) orelse return;
                                if (ast.import_records.len > 0) {
                                    for (ast.import_records) |*import_record, record_id| {

                                        // Don't resolve the runtime
                                        if (import_record.is_internal or import_record.is_unused) {
                                            continue;
                                        }

                                        if (bundler.linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                                            if (_resolved_import.is_external) {
                                                continue;
                                            }
                                            var path = _resolved_import.path() orelse {
                                                import_record.path.is_disabled = true;
                                                import_record.is_bundled = true;
                                                continue;
                                            };

                                            const loader_ = bundler.options.loader(path.name.ext);

                                            if (!loader_.isJavaScriptLikeOrJSON()) {
                                                import_record.path.is_disabled = true;
                                                import_record.is_bundled = true;
                                                continue;
                                            }

                                            // if (_resolved_import.package_json == null) |pkg_json| {
                                            //     _resolved_import.package_json = if (pkg_json.hash == resolve.package_json.?.hash)
                                            //         resolve.package_json
                                            //     else
                                            //         _resolved_import.package_json;
                                            // }

                                            const resolved_import: *const _resolver.Result = _resolved_import;

                                            const _module_data = BundledModuleData.get(this, resolved_import) orelse unreachable;
                                            import_record.module_id = _module_data.module_id;
                                            std.debug.assert(import_record.module_id != 0);
                                            import_record.is_bundled = true;

                                            path.* = try path.dupeAlloc(this.allocator);

                                            import_record.path = path.*;

                                            try this.queue.upsert(
                                                _module_data.module_id,
                                                _resolved_import.*,
                                            );
                                        } else |err| {
                                            if (comptime isDebug) {
                                                Output.prettyErrorln("\n<r><red>{s}<r> on resolving \"{s}\" from \"{s}\"", .{
                                                    @errorName(err),
                                                    import_record.path.text,
                                                    file_path.text,
                                                });
                                            }

                                            switch (err) {
                                                error.ModuleNotFound => {
                                                    if (isPackagePath(import_record.path.text)) {
                                                        if (this.bundler.options.platform.isWebLike() and options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                                            try log.addResolveErrorWithTextDupe(
                                                                &source,
                                                                import_record.range,
                                                                this.allocator,
                                                                "Could not resolve Node.js builtin: \"{s}\".",
                                                                .{import_record.path.text},
                                                                import_record.kind,
                                                            );
                                                        } else {
                                                            try log.addResolveErrorWithTextDupe(
                                                                &source,
                                                                import_record.range,
                                                                this.allocator,
                                                                "Could not resolve: \"{s}\". Maybe you need to \"npm install\" (or yarn/pnpm)?",
                                                                .{import_record.path.text},
                                                                import_record.kind,
                                                            );
                                                        }
                                                    } else {
                                                        try log.addResolveErrorWithTextDupe(
                                                            &source,
                                                            import_record.range,
                                                            this.allocator,
                                                            "Could not resolve: \"{s}\"",
                                                            .{
                                                                import_record.path.text,
                                                            },
                                                            import_record.kind,
                                                        );
                                                    }
                                                },
                                                // assume other errors are already in the log
                                                else => {},
                                            }
                                        }
                                    }
                                }

                                // const load_from_symbol_ref = ast.runtime_imports.$$r.?;
                                // const reexport_ref = ast.runtime_imports.__reExport.?;
                                const register_ref = ast.runtime_imports.register.?;
                                const E = js_ast.E;
                                const Expr = js_ast.Expr;
                                const Stmt = js_ast.Stmt;

                                var prepend_part: js_ast.Part = undefined;
                                var needs_prepend_part = false;
                                if (ast.parts.len > 1) {
                                    for (ast.parts) |part| {
                                        if (part.tag != .none and part.stmts.len > 0) {
                                            prepend_part = part;
                                            needs_prepend_part = true;
                                            break;
                                        }
                                    }
                                }

                                if (ast.parts.len == 0) {
                                    if (comptime isDebug) {
                                        Output.prettyErrorln("Missing AST for file: {s}", .{file_path.text});
                                        Output.flush();
                                    }
                                }

                                var part = &ast.parts[ast.parts.len - 1];
                                var new_stmts: [1]Stmt = undefined;
                                var register_args: [3]Expr = undefined;

                                var package_json_string = E.String{ .utf8 = package.name };
                                var module_path_string = E.String{ .utf8 = module_data.import_path };
                                var target_identifier = E.Identifier{ .ref = register_ref };
                                var cjs_args: [2]js_ast.G.Arg = undefined;
                                var module_binding = js_ast.B.Identifier{ .ref = ast.module_ref.? };
                                var exports_binding = js_ast.B.Identifier{ .ref = ast.exports_ref.? };

                                // if (!ast.uses_module_ref) {
                                //     var symbol = &ast.symbols[ast.module_ref.?.inner_index];
                                //     symbol.original_name = "_$$";
                                // }

                                cjs_args[0] = js_ast.G.Arg{
                                    .binding = js_ast.Binding{
                                        .loc = logger.Loc.Empty,
                                        .data = .{ .b_identifier = &module_binding },
                                    },
                                };
                                cjs_args[1] = js_ast.G.Arg{
                                    .binding = js_ast.Binding{
                                        .loc = logger.Loc.Empty,
                                        .data = .{ .b_identifier = &exports_binding },
                                    },
                                };

                                var closure = E.Arrow{
                                    .args = &cjs_args,
                                    .body = .{
                                        .loc = logger.Loc.Empty,
                                        .stmts = part.stmts,
                                    },
                                };

                                // $$m(12345, "react", "index.js", function(module, exports) {

                                // })
                                register_args[0] = Expr{ .loc = .{ .start = 0 }, .data = .{ .e_string = &package_json_string } };
                                register_args[1] = Expr{ .loc = .{ .start = 0 }, .data = .{ .e_string = &module_path_string } };
                                register_args[2] = Expr{ .loc = .{ .start = 0 }, .data = .{ .e_arrow = &closure } };

                                var call_register = E.Call{
                                    .target = Expr{
                                        .data = .{ .e_identifier = &target_identifier },
                                        .loc = logger.Loc{ .start = 0 },
                                    },
                                    .args = &register_args,
                                };
                                var register_expr = Expr{ .loc = call_register.target.loc, .data = .{ .e_call = &call_register } };
                                var decls: [1]js_ast.G.Decl = undefined;
                                var bundle_export_binding = js_ast.B.Identifier{ .ref = ast.bundle_export_ref.? };
                                var binding = js_ast.Binding{
                                    .loc = register_expr.loc,
                                    .data = .{ .b_identifier = &bundle_export_binding },
                                };
                                decls[0] = js_ast.G.Decl{
                                    .value = register_expr,
                                    .binding = binding,
                                };
                                var export_var = js_ast.S.Local{
                                    .decls = &decls,
                                    .is_export = true,
                                };
                                new_stmts[0] = Stmt{ .loc = register_expr.loc, .data = .{ .s_local = &export_var } };
                                part.stmts = &new_stmts;

                                var writer = js_printer.NewFileWriter(this.tmpfile);
                                var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

                                // It should only have one part.
                                ast.parts = ast.parts[ast.parts.len - 1 ..];

                                const write_result =
                                    try js_printer.printCommonJSThreaded(
                                    @TypeOf(writer),
                                    writer,
                                    ast,
                                    js_ast.Symbol.Map.initList(symbols),
                                    &source,
                                    false,
                                    js_printer.Options{
                                        .to_module_ref = Ref.RuntimeRef,
                                        .bundle_export_ref = ast.bundle_export_ref.?,
                                        .source_path = file_path,
                                        .externals = ast.externals,
                                        .indent = 0,
                                        .module_hash = module_id,
                                        .runtime_imports = ast.runtime_imports,
                                        .prepend_part_value = &prepend_part,
                                        .prepend_part_key = if (needs_prepend_part) closure.body.stmts.ptr else null,
                                    },
                                    Linker,
                                    &bundler.linker,
                                    &this.write_lock,
                                    std.fs.File,
                                    this.tmpfile,
                                    std.fs.File.getPos,
                                );

                                code_offset = write_result.off;
                                written = write_result.len;

                                // Faster to _not_ do the syscall
                                // But there's some off-by-one error somewhere and more reliable to just do the lseek
                                this.tmpfile_byte_offset = write_result.end_off;
                            }

                            if (comptime isDebug) {
                                Output.prettyln("{s}@{s}/{s} - {d}:{d} \n", .{ package.name, package.version, package_relative_path, package.hash, module_id });
                                Output.flush();
                                std.debug.assert(package_relative_path.len > 0);
                            }

                            this.list_lock.lock();
                            defer this.list_lock.unlock();

                            const code_length = this.tmpfile_byte_offset - code_offset;

                            if (comptime isDebug) {
                                std.debug.assert(code_length > 0);
                                std.debug.assert(package.hash != 0);
                                std.debug.assert(package.version.len > 0);
                                std.debug.assert(package.name.len > 0);
                                std.debug.assert(module_id > 0);
                            }

                            var package_get_or_put_entry = try this.package_list_map.getOrPut(package.hash);

                            if (!package_get_or_put_entry.found_existing) {
                                package_get_or_put_entry.value_ptr.* = @truncate(u32, this.package_list.items.len);
                                try this.package_list.append(
                                    Api.JavascriptBundledPackage{
                                        .name = try this.appendHeaderString(package.name),
                                        .version = try this.appendHeaderString(package.version),
                                        .hash = package.hash,
                                    },
                                );
                                this.has_jsx = this.has_jsx or strings.eql(package.name, this.bundler.options.jsx.package_name);
                            }

                            var path_extname_length = @truncate(u8, std.fs.path.extension(package_relative_path).len);
                            try this.module_list.append(
                                Api.JavascriptBundledModule{
                                    .path = try this.appendHeaderString(
                                        package_relative_path,
                                    ),
                                    .path_extname_length = path_extname_length,
                                    .package_id = package_get_or_put_entry.value_ptr.*,
                                    .id = module_id,
                                    .code = Api.StringPointer{
                                        .length = @truncate(u32, code_length),
                                        .offset = @truncate(u32, code_offset),
                                    },
                                },
                            );
                        },
                        else => {},
                    }
                } else {
                    // If it's app code, scan but do not fully parse.
                    switch (loader) {
                        .jsx,
                        .tsx,
                        .js,
                        .ts,
                        => {
                            const entry = bundler.resolver.caches.fs.readFileShared(
                                bundler.fs,
                                file_path.text,
                                resolve.dirname_fd,
                                if (resolve.file_fd != 0) resolve.file_fd else null,
                                shared_buffer,
                            ) catch return;
                            if (entry.contents.len == 0 or (entry.contents.len < 33 and strings.trim(entry.contents, " \n\r").len == 0)) return;

                            const source = logger.Source.initRecycledFile(Fs.File{ .path = file_path, .contents = entry.contents }, bundler.allocator) catch return null;

                            var jsx = bundler.options.jsx;
                            jsx.parse = loader.isJSX();
                            var opts = js_parser.Parser.Options.init(jsx, loader);

                            try bundler.resolver.caches.js.scan(
                                bundler.allocator,
                                scan_pass_result,
                                opts,
                                bundler.options.define,
                                log,
                                &source,
                            );

                            {
                                for (scan_pass_result.import_records.items) |*import_record, i| {
                                    if (import_record.is_internal or import_record.is_unused) {
                                        continue;
                                    }

                                    if (bundler.linker.resolver.resolve(source_dir, import_record.path.text, import_record.kind)) |*_resolved_import| {
                                        if (_resolved_import.is_external) {
                                            continue;
                                        }

                                        var path = _resolved_import.path() orelse continue;

                                        const loader_ = this.bundler.options.loader(path.name.ext);
                                        if (!loader_.isJavaScriptLikeOrJSON()) continue;
                                        path.* = try path.dupeAlloc(this.allocator);

                                        if (BundledModuleData.get(this, _resolved_import)) |mod| {
                                            std.debug.assert(mod.module_id != 0);
                                            try this.queue.upsert(
                                                mod.module_id,
                                                _resolved_import.*,
                                            );
                                        } else {
                                            try this.queue.upsert(
                                                _resolved_import.hash(
                                                    this.bundler.fs.top_level_dir,
                                                    loader_,
                                                ),
                                                _resolved_import.*,
                                            );
                                        }
                                    } else |err| {
                                        switch (err) {
                                            error.ModuleNotFound => {
                                                if (isPackagePath(import_record.path.text)) {
                                                    if (this.bundler.options.platform.isWebLike() and options.ExternalModules.isNodeBuiltin(import_record.path.text)) {
                                                        try log.addResolveErrorWithTextDupe(
                                                            &source,
                                                            import_record.range,
                                                            this.allocator,
                                                            "Could not resolve Node.js builtin: \"{s}\".",
                                                            .{import_record.path.text},
                                                            import_record.kind,
                                                        );
                                                    } else {
                                                        try log.addResolveErrorWithTextDupe(
                                                            &source,
                                                            import_record.range,
                                                            this.allocator,
                                                            "Could not resolve: \"{s}\". Maybe you need to \"npm install\" (or yarn/pnpm)?",
                                                            .{import_record.path.text},
                                                            import_record.kind,
                                                        );
                                                    }
                                                } else {
                                                    try log.addResolveErrorWithTextDupe(
                                                        &source,
                                                        import_record.range,
                                                        this.allocator,
                                                        "Could not resolve: \"{s}\"",
                                                        .{
                                                            import_record.path.text,
                                                        },
                                                        import_record.kind,
                                                    );
                                                }
                                            },
                                            // assume other errors are already in the log
                                            else => {},
                                        }
                                    }
                                }
                            }
                        },
                        // TODO:
                        else => {
                            return;
                        },
                    }
                }
            }
        };

        pub const BuildResolveResultPair = struct {
            written: usize,
            input_fd: ?StoredFileDescriptorType,
        };
        pub fn buildWithResolveResult(
            bundler: *ThisBundler,
            resolve_result: _resolver.Result,
            allocator: *std.mem.Allocator,
            loader: options.Loader,
            comptime Writer: type,
            writer: Writer,
            comptime import_path_format: options.BundleOptions.ImportPathFormat,
            file_descriptor: ?StoredFileDescriptorType,
            filepath_hash: u32,
            comptime WatcherType: type,
            watcher: *WatcherType,
            client_entry_point: ?*ClientEntryPoint,
        ) !BuildResolveResultPair {
            if (resolve_result.is_external) {
                return BuildResolveResultPair{
                    .written = 0,
                    .input_fd = null,
                };
            }

            errdefer bundler.resetStore();

            var file_path = (resolve_result.pathConst() orelse {
                return BuildResolveResultPair{
                    .written = 0,
                    .input_fd = null,
                };
            }).*;

            if (strings.indexOf(file_path.text, bundler.fs.top_level_dir)) |i| {
                file_path.pretty = file_path.text[i + bundler.fs.top_level_dir.len ..];
            } else if (!file_path.is_symlink) {
                file_path.pretty = allocator.dupe(u8, bundler.fs.relativeTo(file_path.text)) catch unreachable;
            }

            var old_bundler_allocator = bundler.allocator;
            bundler.allocator = allocator;
            defer bundler.allocator = old_bundler_allocator;
            var old_linker_allocator = bundler.linker.allocator;
            defer bundler.linker.allocator = old_linker_allocator;
            bundler.linker.allocator = allocator;

            switch (loader) {
                .css => {
                    const CSSBundlerHMR = Css.NewBundler(
                        Writer,
                        @TypeOf(&bundler.linker),
                        @TypeOf(&bundler.resolver.caches.fs),
                        WatcherType,
                        @TypeOf(bundler.fs),
                        true,
                    );

                    const CSSBundler = Css.NewBundler(
                        Writer,
                        @TypeOf(&bundler.linker),
                        @TypeOf(&bundler.resolver.caches.fs),
                        WatcherType,
                        @TypeOf(bundler.fs),
                        false,
                    );

                    return BuildResolveResultPair{
                        .written = brk: {
                            if (bundler.options.hot_module_reloading) {
                                break :brk (try CSSBundlerHMR.bundle(
                                    file_path.text,
                                    bundler.fs,
                                    writer,
                                    watcher,
                                    &bundler.resolver.caches.fs,
                                    filepath_hash,
                                    file_descriptor,
                                    allocator,
                                    bundler.log,
                                    &bundler.linker,
                                )).written;
                            } else {
                                break :brk (try CSSBundler.bundle(
                                    file_path.text,
                                    bundler.fs,
                                    writer,
                                    watcher,
                                    &bundler.resolver.caches.fs,
                                    filepath_hash,
                                    file_descriptor,
                                    allocator,
                                    bundler.log,
                                    &bundler.linker,
                                )).written;
                            }
                        },
                        .input_fd = file_descriptor,
                    };
                },
                else => {
                    var result = bundler.parse(
                        allocator,
                        file_path,
                        loader,
                        resolve_result.dirname_fd,
                        file_descriptor,
                        filepath_hash,
                        client_entry_point,
                    ) orelse {
                        bundler.resetStore();
                        return BuildResolveResultPair{
                            .written = 0,
                            .input_fd = null,
                        };
                    };

                    if (result.empty) {
                        return BuildResolveResultPair{ .written = 0, .input_fd = result.input_fd };
                    }

                    try bundler.linker.link(file_path, &result, import_path_format, false);

                    return BuildResolveResultPair{
                        .written = try bundler.print(
                            result,
                            Writer,
                            writer,
                            .esm,
                        ),
                        .input_fd = result.input_fd,
                    };
                },
            }
        }

        pub fn buildWithResolveResultEager(
            bundler: *ThisBundler,
            resolve_result: _resolver.Result,
            comptime import_path_format: options.BundleOptions.ImportPathFormat,
            comptime Outstream: type,
            outstream: Outstream,
            client_entry_point_: ?*ClientEntryPoint,
        ) !?options.OutputFile {
            if (resolve_result.is_external) {
                return null;
            }

            var file_path = (resolve_result.pathConst() orelse return null).*;

            // Step 1. Parse & scan
            const loader = bundler.options.loader(file_path.name.ext);

            if (client_entry_point_) |client_entry_point| {
                file_path = client_entry_point.source.path;
            }

            file_path.pretty = Linker.relative_paths_list.append(string, bundler.fs.relativeTo(file_path.text)) catch unreachable;

            var output_file = options.OutputFile{
                .input = file_path,
                .loader = loader,
                .value = undefined,
            };

            var file: std.fs.File = undefined;

            if (Outstream == std.fs.Dir) {
                const output_dir = outstream;

                if (std.fs.path.dirname(file_path.pretty)) |dirname| {
                    try output_dir.makePath(dirname);
                }
                file = try output_dir.createFile(file_path.pretty, .{});
            } else {
                file = outstream;
            }

            switch (loader) {
                .jsx, .tsx, .js, .ts, .json => {
                    var result = bundler.parse(
                        bundler.allocator,
                        file_path,
                        loader,
                        resolve_result.dirname_fd,
                        null,
                        null,
                        client_entry_point_,
                    ) orelse {
                        return null;
                    };

                    try bundler.linker.link(
                        file_path,
                        &result,
                        import_path_format,
                        false,
                    );

                    output_file.size = try bundler.print(
                        result,
                        js_printer.FileWriter,
                        js_printer.NewFileWriter(file),
                        .esm,
                    );

                    var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                    file_op.fd = file.handle;

                    file_op.is_tmpdir = false;

                    if (Outstream == std.fs.Dir) {
                        file_op.dir = outstream.fd;

                        if (bundler.fs.fs.needToCloseFiles()) {
                            file.close();
                            file_op.fd = 0;
                        }
                    }

                    output_file.value = .{ .move = file_op };
                },
                .css => {
                    const CSSWriter = Css.NewWriter(
                        std.fs.File,
                        @TypeOf(&bundler.linker),
                        import_path_format,
                        void,
                    );
                    const entry = bundler.resolver.caches.fs.readFile(
                        bundler.fs,
                        file_path.text,
                        resolve_result.dirname_fd,
                        !cache_files,
                        null,
                    ) catch return null;

                    const _file = Fs.File{ .path = file_path, .contents = entry.contents };
                    var source = try logger.Source.initFile(_file, bundler.allocator);
                    source.contents_is_recycled = !cache_files;
                    var css_writer = CSSWriter.init(
                        &source,
                        file,
                        &bundler.linker,
                        bundler.log,
                    );
                    try css_writer.run(bundler.log, bundler.allocator);
                    output_file.size = css_writer.written;
                    var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                    file_op.fd = file.handle;

                    file_op.is_tmpdir = false;

                    if (Outstream == std.fs.Dir) {
                        file_op.dir = outstream.fd;

                        if (bundler.fs.fs.needToCloseFiles()) {
                            file.close();
                            file_op.fd = 0;
                        }
                    }

                    output_file.value = .{ .move = file_op };
                },
                .file => {
                    var hashed_name = try bundler.linker.getHashedFilename(file_path, null);
                    var pathname = try bundler.allocator.alloc(u8, hashed_name.len + file_path.name.ext.len);
                    std.mem.copy(u8, pathname, hashed_name);
                    std.mem.copy(u8, pathname[hashed_name.len..], file_path.name.ext);
                    const dir = if (bundler.options.output_dir_handle) |output_handle| output_handle.fd else 0;

                    output_file.value = .{
                        .copy = options.OutputFile.FileOperation{
                            .pathname = pathname,
                            .dir = dir,
                            .is_outdir = true,
                        },
                    };
                },

                // // TODO:
                // else => {},
            }

            return output_file;
        }

        pub fn print(
            bundler: *ThisBundler,
            result: ParseResult,
            comptime Writer: type,
            writer: Writer,
            comptime format: js_printer.Format,
        ) !usize {
            const ast = result.ast;
            var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

            return switch (format) {
                .cjs => try js_printer.printCommonJS(
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
                        .require_ref = ast.require_ref,
                        .css_import_behavior = bundler.options.cssImportBehavior(),
                    },
                    Linker,
                    &bundler.linker,
                ),
                .esm => try js_printer.printAst(
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
                        .require_ref = ast.require_ref,

                        .css_import_behavior = bundler.options.cssImportBehavior(),
                    },
                    Linker,
                    &bundler.linker,
                ),
            };
        }

        pub fn parse(
            bundler: *ThisBundler,
            allocator: *std.mem.Allocator,
            path: Fs.Path,
            loader: options.Loader,
            // only used when file_descriptor is null
            dirname_fd: StoredFileDescriptorType,
            file_descriptor: ?StoredFileDescriptorType,
            file_hash: ?u32,
            client_entry_point_: anytype,
        ) ?ParseResult {
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
            var input_fd: ?StoredFileDescriptorType = null;

            const source: logger.Source = brk: {
                if (client_entry_point_) |client_entry_point| {
                    if (@hasField(std.meta.Child(@TypeOf(client_entry_point)), "source")) {
                        break :brk client_entry_point.source;
                    }
                }

                const entry = bundler.resolver.caches.fs.readFile(
                    bundler.fs,
                    path.text,
                    dirname_fd,
                    true,
                    file_descriptor,
                ) catch |err| {
                    bundler.log.addErrorFmt(null, logger.Loc.Empty, bundler.allocator, "{s} reading \"{s}\"", .{ @errorName(err), path.text }) catch {};
                    return null;
                };
                input_fd = entry.fd;
                break :brk logger.Source.initRecycledFile(Fs.File{ .path = path, .contents = entry.contents }, bundler.allocator) catch return null;
            };

            if (source.contents.len == 0 or (source.contents.len < 33 and std.mem.trim(u8, source.contents, "\n\r ").len == 0)) {
                return ParseResult{ .source = source, .input_fd = input_fd, .loader = loader, .empty = true, .ast = js_ast.Ast.empty };
            }

            switch (loader) {
                .js,
                .jsx,
                .ts,
                .tsx,
                => {
                    var jsx = bundler.options.jsx;
                    jsx.parse = loader.isJSX();
                    var opts = js_parser.Parser.Options.init(jsx, loader);
                    opts.enable_bundling = false;
                    opts.transform_require_to_import = true;
                    opts.can_import_from_bundle = bundler.options.node_modules_bundle != null;

                    // HMR is enabled when devserver is running
                    // unless you've explicitly disabled it
                    // or you're running in SSR
                    // or the file is a node_module
                    opts.features.hot_module_reloading = bundler.options.hot_module_reloading and
                        bundler.options.platform != .bun and
                        (!opts.can_import_from_bundle or
                        (opts.can_import_from_bundle and !path.isNodeModule()));
                    opts.features.react_fast_refresh = opts.features.hot_module_reloading and
                        jsx.parse and
                        bundler.options.jsx.supports_fast_refresh;
                    opts.filepath_hash_for_hmr = file_hash orelse 0;
                    opts.warn_about_unbundled_modules = bundler.options.platform != .bun;
                    const value = (bundler.resolver.caches.js.parse(
                        allocator,
                        opts,
                        bundler.options.define,
                        bundler.log,
                        &source,
                    ) catch null) orelse return null;
                    return ParseResult{
                        .ast = value,
                        .source = source,
                        .loader = loader,
                        .input_fd = input_fd,
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
                        .input_fd = input_fd,
                    };
                },
                .css => {},
                else => Global.panic("Unsupported loader {s} for path: {s}", .{ loader, source.path.text }),
            }

            return null;
        }

        // This is public so it can be used by the HTTP handler when matching against public dir.
        pub threadlocal var tmp_buildfile_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        threadlocal var tmp_buildfile_buf2: [std.fs.MAX_PATH_BYTES]u8 = undefined;

        // We try to be mostly stateless when serving
        // This means we need a slightly different resolver setup
        pub fn buildFile(
            bundler: *ThisBundler,
            log: *logger.Log,
            allocator: *std.mem.Allocator,
            relative_path: string,
            _extension: string,
            comptime client_entry_point_enabled: bool,
        ) !ServeResult {
            var extension = _extension;
            var old_log = bundler.log;
            var old_allocator = bundler.allocator;

            bundler.setLog(log);
            defer bundler.setLog(old_log);

            if (strings.eqlComptime(relative_path, "__runtime.js")) {
                return ServeResult{
                    .file = options.OutputFile.initBuf(runtime.Runtime.sourceContent(), "__runtime.js", .js),
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

            const resolved = if (comptime !client_entry_point_enabled) (try bundler.resolver.resolve(bundler.fs.top_level_dir, absolute_path, .stmt)) else brk: {
                const absolute_pathname = Fs.PathName.init(absolute_path);

                const loader_for_ext = bundler.options.loader(absolute_pathname.ext);

                // The expected pathname looks like:
                // /pages/index.entry.tsx
                // /pages/index.entry.js
                // /pages/index.entry.ts
                // /pages/index.entry.jsx
                if (loader_for_ext.supportsClientEntryPoint()) {
                    const absolute_pathname_pathname = Fs.PathName.init(absolute_pathname.base);

                    if (strings.eqlComptime(absolute_pathname_pathname.ext, ".entry")) {
                        const trail_dir = absolute_pathname.dirWithTrailingSlash();
                        var len: usize = trail_dir.len;
                        std.mem.copy(u8, tmp_buildfile_buf2[0..len], trail_dir);

                        std.mem.copy(u8, tmp_buildfile_buf2[len..], absolute_pathname_pathname.base);
                        len += absolute_pathname_pathname.base.len;
                        std.mem.copy(u8, tmp_buildfile_buf2[len..], absolute_pathname.ext);
                        len += absolute_pathname.ext.len;
                        std.debug.assert(len > 0);
                        const decoded_entry_point_path = tmp_buildfile_buf2[0..len];
                        break :brk (try bundler.resolver.resolve(bundler.fs.top_level_dir, decoded_entry_point_path, .entry_point));
                    }
                }

                break :brk (try bundler.resolver.resolve(bundler.fs.top_level_dir, absolute_path, .stmt));
            };

            const path = (resolved.pathConst() orelse return error.ModuleNotFound);

            const loader = bundler.options.loader(path.name.ext);
            const mime_type_ext = bundler.options.out_extensions.get(path.name.ext) orelse path.name.ext;

            switch (loader) {
                .js, .jsx, .ts, .tsx, .css => {
                    return ServeResult{
                        .file = options.OutputFile.initPending(loader, resolved),
                        .mime_type = MimeType.byLoader(
                            loader,
                            mime_type_ext[1..],
                        ),
                    };
                },
                .json => {
                    return ServeResult{
                        .file = options.OutputFile.initPending(loader, resolved),
                        .mime_type = MimeType.transpiled_json,
                    };
                },
                else => {
                    var abs_path = path.text;
                    const file = try std.fs.openFileAbsolute(abs_path, .{ .read = true });
                    var stat = try file.stat();
                    return ServeResult{
                        .file = options.OutputFile.initFile(file, abs_path, stat.size),
                        .mime_type = MimeType.byLoader(
                            loader,
                            mime_type_ext[1..],
                        ),
                    };
                },
            }
        }

        pub fn normalizeEntryPointPath(bundler: *ThisBundler, _entry: string) string {
            var paths = [_]string{_entry};
            var entry = bundler.fs.abs(&paths);

            std.fs.accessAbsolute(entry, .{}) catch |err| {
                return _entry;
            };

            entry = bundler.fs.relativeTo(entry);

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
                var __entry = bundler.allocator.alloc(u8, "./".len + entry.len) catch unreachable;
                __entry[0] = '.';
                __entry[1] = '/';
                std.mem.copy(u8, __entry[2..__entry.len], entry);
                entry = __entry;
            }

            return entry;
        }

        fn enqueueEntryPoints(bundler: *ThisBundler, entry_points: []_resolver.Result, comptime normalize_entry_point: bool) usize {
            var entry_point_i: usize = 0;

            for (bundler.options.entry_points) |_entry| {
                var entry: string = if (comptime normalize_entry_point) bundler.normalizeEntryPointPath(_entry) else _entry;

                defer {
                    js_ast.Expr.Data.Store.reset();
                    js_ast.Stmt.Data.Store.reset();
                }

                const result = bundler.resolver.resolve(bundler.fs.top_level_dir, entry, .entry_point) catch |err| {
                    Output.prettyError("Error resolving \"{s}\": {s}\n", .{ entry, @errorName(err) });
                    continue;
                };

                if (result.pathConst() == null) {
                    Output.prettyError("\"{s}\" is disabled due to \"browser\" field in package.json.\n", .{
                        entry,
                    });
                    continue;
                }

                if (bundler.linker.enqueueResolveResult(&result) catch unreachable) {
                    entry_points[entry_point_i] = result;
                    entry_point_i += 1;
                }
            }

            return entry_point_i;
        }

        pub fn bundle(
            allocator: *std.mem.Allocator,
            log: *logger.Log,
            opts: Api.TransformOptions,
        ) !options.TransformResult {
            var bundler = try ThisBundler.init(allocator, log, opts, null, null);
            bundler.configureLinker();
            try bundler.configureRouter(false);
            try bundler.configureDefines();

            var skip_normalize = false;
            var load_from_routes = false;
            if (bundler.options.routes.routes_enabled and bundler.options.entry_points.len == 0) {
                if (bundler.router) |router| {
                    bundler.options.entry_points = try router.getEntryPoints(allocator);
                    skip_normalize = true;
                    load_from_routes = true;
                }
            }

            if (bundler.options.write and bundler.options.output_dir.len > 0) {}

            //  100.00 µs std.fifo.LinearFifo(resolver.Result,std.fifo.LinearFifoBufferType { .Dynamic = {}}).writeItemAssumeCapacity
            if (bundler.options.resolve_mode != .lazy) {
                try bundler.resolve_queue.ensureUnusedCapacity(3);
            }

            var entry_points = try allocator.alloc(_resolver.Result, bundler.options.entry_points.len);
            if (skip_normalize) {
                entry_points = entry_points[0..bundler.enqueueEntryPoints(entry_points, false)];
            } else {
                entry_points = entry_points[0..bundler.enqueueEntryPoints(entry_points, true)];
            }

            if (log.level == .verbose) {
                bundler.resolver.debug_logs = try DebugLogs.init(allocator);
            }

            var did_start = false;

            if (bundler.options.output_dir_handle == null) {
                const outstream = std.io.getStdOut();

                if (load_from_routes) {
                    if (bundler.options.framework) |*framework| {
                        if (framework.client.isEnabled()) {
                            did_start = true;
                            try switch (bundler.options.import_path_format) {
                                .relative => bundler.processResolveQueue(.relative, true, @TypeOf(outstream), outstream),
                                .relative_nodejs => bundler.processResolveQueue(.relative_nodejs, true, @TypeOf(outstream), outstream),
                                .absolute_url => bundler.processResolveQueue(.absolute_url, true, @TypeOf(outstream), outstream),
                                .absolute_path => bundler.processResolveQueue(.absolute_path, true, @TypeOf(outstream), outstream),
                                .package_path => bundler.processResolveQueue(.package_path, true, @TypeOf(outstream), outstream),
                            };
                        }
                    }
                }

                if (!did_start) {
                    try switch (bundler.options.import_path_format) {
                        .relative => bundler.processResolveQueue(.relative, false, @TypeOf(outstream), outstream),
                        .relative_nodejs => bundler.processResolveQueue(.relative_nodejs, false, @TypeOf(outstream), outstream),
                        .absolute_url => bundler.processResolveQueue(.absolute_url, false, @TypeOf(outstream), outstream),
                        .absolute_path => bundler.processResolveQueue(.absolute_path, false, @TypeOf(outstream), outstream),
                        .package_path => bundler.processResolveQueue(.package_path, false, @TypeOf(outstream), outstream),
                    };
                }
            } else {
                const output_dir = bundler.options.output_dir_handle orelse {
                    Output.printError("Invalid or missing output directory.", .{});
                    Output.flush();
                    Global.crash();
                };

                if (load_from_routes) {
                    if (bundler.options.framework) |*framework| {
                        if (framework.client.isEnabled()) {
                            did_start = true;
                            try switch (bundler.options.import_path_format) {
                                .relative => bundler.processResolveQueue(.relative, true, std.fs.Dir, output_dir),
                                .relative_nodejs => bundler.processResolveQueue(.relative_nodejs, true, std.fs.Dir, output_dir),
                                .absolute_url => bundler.processResolveQueue(.absolute_url, true, std.fs.Dir, output_dir),
                                .absolute_path => bundler.processResolveQueue(.absolute_path, true, std.fs.Dir, output_dir),
                                .package_path => bundler.processResolveQueue(.package_path, true, std.fs.Dir, output_dir),
                            };
                        }
                    }
                }

                if (!did_start) {
                    try switch (bundler.options.import_path_format) {
                        .relative => bundler.processResolveQueue(.relative, false, std.fs.Dir, output_dir),
                        .relative_nodejs => bundler.processResolveQueue(.relative_nodejs, false, std.fs.Dir, output_dir),
                        .absolute_url => bundler.processResolveQueue(.absolute_url, false, std.fs.Dir, output_dir),
                        .absolute_path => bundler.processResolveQueue(.absolute_path, false, std.fs.Dir, output_dir),
                        .package_path => bundler.processResolveQueue(.package_path, false, std.fs.Dir, output_dir),
                    };
                }
            }

            // if (log.level == .verbose) {
            //     for (log.msgs.items) |msg| {
            //         try msg.writeFormat(std.io.getStdOut().writer());
            //     }
            // }

            if (bundler.linker.any_needs_runtime) {
                try bundler.output_files.append(
                    options.OutputFile.initBuf(runtime.Runtime.sourceContent(), bundler.linker.runtime_source_path, .js),
                );
            }

            if (FeatureFlags.tracing) {
                Output.prettyErrorln(
                    "<r><d>\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n<r>",
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

        // pub fn processResolveQueueWithThreadPool(bundler)

        pub fn processResolveQueue(
            bundler: *ThisBundler,
            comptime import_path_format: options.BundleOptions.ImportPathFormat,
            comptime wrap_entry_point: bool,
            comptime Outstream: type,
            outstream: Outstream,
        ) !void {
            // var count: u8 = 0;
            while (bundler.resolve_queue.readItem()) |item| {
                js_ast.Expr.Data.Store.reset();
                js_ast.Stmt.Data.Store.reset();

                // defer count += 1;

                if (comptime wrap_entry_point) {
                    var path = item.pathConst() orelse unreachable;
                    const loader = bundler.options.loader(path.name.ext);

                    if (item.import_kind == .entry_point and loader.supportsClientEntryPoint()) {
                        var client_entry_point = try bundler.allocator.create(ClientEntryPoint);
                        client_entry_point.* = ClientEntryPoint{};
                        try client_entry_point.generate(ThisBundler, bundler, path.name, bundler.options.framework.?.client.path);
                        try bundler.virtual_modules.append(client_entry_point);

                        const entry_point_output_file = bundler.buildWithResolveResultEager(
                            item,
                            import_path_format,
                            Outstream,
                            outstream,
                            client_entry_point,
                        ) catch continue orelse continue;
                        bundler.output_files.append(entry_point_output_file) catch unreachable;

                        js_ast.Expr.Data.Store.reset();
                        js_ast.Stmt.Data.Store.reset();

                        // At this point, the entry point will be de-duped.
                        // So we just immediately build it.
                        var item_not_entrypointed = item;
                        item_not_entrypointed.import_kind = .stmt;
                        const original_output_file = bundler.buildWithResolveResultEager(
                            item_not_entrypointed,
                            import_path_format,
                            Outstream,
                            outstream,
                            null,
                        ) catch continue orelse continue;
                        bundler.output_files.append(original_output_file) catch unreachable;

                        continue;
                    }
                }

                const output_file = bundler.buildWithResolveResultEager(
                    item,
                    import_path_format,
                    Outstream,
                    outstream,
                    null,
                ) catch continue orelse continue;
                bundler.output_files.append(output_file) catch unreachable;

                // if (count >= 3) return try bundler.processResolveQueueWithThreadPool(import_path_format, wrap_entry_point, Outstream, outstream);
            }
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
        const platform = options.Platform.from(opts.platform);

        var define = try options.definesFromTransformOptions(
            allocator,
            log,
            opts.define,
            false,
            platform,
            null,
            null,
        );

        const cwd = if (opts.absolute_working_dir) |workdir| try std.fs.realpathAlloc(allocator, workdir) else try std.process.getCwdAlloc(allocator);

        const output_dir_parts = [_]string{ try std.process.getCwdAlloc(allocator), opts.output_dir orelse "out" };
        const output_dir = try std.fs.path.join(allocator, &output_dir_parts);
        var output_files = try std.ArrayList(options.OutputFile).initCapacity(allocator, opts.entry_points.len);
        const out_extensions = platform.outExtensions(allocator);

        var loader_map = try options.loadersFromTransformOptions(allocator, opts.loaders);
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

                var parser_opts = js_parser.Parser.Options.init(jsx.*, loader);
                file_op.is_tmpdir = false;
                output_file.value = .{ .move = file_op };

                if (_output_dir) |output_dir| {
                    file_op.dir = output_dir.fd;
                }

                file_op.fd = file.handle;
                var parser = try js_parser.Parser.init(parser_opts, log, _source, transformer.define, allocator);
                parser_opts.can_import_from_bundle = false;
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

pub const ServeResult = struct {
    file: options.OutputFile,
    mime_type: MimeType,
};

pub const FallbackEntryPoint = struct {
    code_buffer: [8096]u8 = undefined,
    path_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined,
    source: logger.Source = undefined,
    built_code: string = "",

    pub fn generate(
        entry: *FallbackEntryPoint,
        input_path: string,
        comptime BundlerType: type,
        bundler: *BundlerType,
    ) !void {
        // This is *extremely* naive.
        // The basic idea here is this:
        // --
        // import * as EntryPoint from 'entry-point';
        // import boot from 'framework';
        // boot(EntryPoint);
        // --
        // We go through the steps of printing the code -- only to then parse/transpile it because
        // we want it to go through the linker and the rest of the transpilation process

        const dir_to_use: string = bundler.fs.top_level_dir;
        const disable_css_imports = bundler.options.framework.?.client_css_in_js != .auto_onimportcss;

        var code: string = undefined;

        if (disable_css_imports) {
            const fmt =
                \\globalThis.Bun_disableCSSImports = true;
                \\import boot from '{s}';
                \\boot(globalThis.__BUN_DATA__);
            ;

            const args = .{
                input_path,
            };

            const count = std.fmt.count(fmt, args);
            if (count < entry.code_buffer.len) {
                code = try std.fmt.bufPrint(&entry.code_buffer, fmt, args);
            } else {
                code = try std.fmt.allocPrint(bundler.allocator, fmt, args);
            }
        } else {
            const fmt =
                \\import boot from '{s}';
                \\boot(globalThis.__BUN_DATA__);
            ;

            const args = .{
                input_path,
            };

            const count = std.fmt.count(fmt, args);
            if (count < entry.code_buffer.len) {
                code = try std.fmt.bufPrint(&entry.code_buffer, fmt, args);
            } else {
                code = try std.fmt.allocPrint(bundler.allocator, fmt, args);
            }
        }

        entry.source = logger.Source.initPathString(input_path, code);
        entry.source.path.namespace = "fallback-entry";
    }
};

pub const ClientEntryPoint = struct {
    code_buffer: [8096]u8 = undefined,
    path_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined,
    source: logger.Source = undefined,

    pub fn isEntryPointPath(extname: string) bool {
        return strings.startsWith("entry.", extname);
    }

    pub fn generateEntryPointPath(outbuffer: []u8, original_path: Fs.PathName) string {
        var joined_base_and_dir_parts = [_]string{ original_path.dir, original_path.base };
        var generated_path = Fs.FileSystem.instance.absBuf(&joined_base_and_dir_parts, outbuffer);

        std.mem.copy(u8, outbuffer[generated_path.len..], ".entry");
        generated_path = outbuffer[0 .. generated_path.len + ".entry".len];
        std.mem.copy(u8, outbuffer[generated_path.len..], original_path.ext);
        return outbuffer[0 .. generated_path.len + original_path.ext.len];
    }

    pub fn decodeEntryPointPath(outbuffer: []u8, original_path: Fs.PathName) string {
        var joined_base_and_dir_parts = [_]string{ original_path.dir, original_path.base };
        var generated_path = Fs.FileSystem.instance.absBuf(&joined_base_and_dir_parts, outbuffer);
        var original_ext = original_path.ext;
        if (strings.indexOf(original_path.ext, "entry")) |entry_i| {
            original_ext = original_path.ext[entry_i + "entry".len ..];
        }

        std.mem.copy(u8, outbuffer[generated_path.len..], original_ext);

        return outbuffer[0 .. generated_path.len + original_ext.len];
    }

    pub fn generate(entry: *ClientEntryPoint, comptime BundlerType: type, bundler: *BundlerType, original_path: Fs.PathName, client: string) !void {

        // This is *extremely* naive.
        // The basic idea here is this:
        // --
        // import * as EntryPoint from 'entry-point';
        // import boot from 'framework';
        // boot(EntryPoint);
        // --
        // We go through the steps of printing the code -- only to then parse/transpile it because
        // we want it to go through the linker and the rest of the transpilation process

        const dir_to_use: string = original_path.dirWithTrailingSlash();
        const disable_css_imports = bundler.options.framework.?.client_css_in_js != .auto_onimportcss;

        var code: string = undefined;

        if (disable_css_imports) {
            code = try std.fmt.bufPrint(
                &entry.code_buffer,
                \\globalThis.Bun_disableCSSImports = true;
                \\var lastErrorHandler = globalThis.onerror;
                \\var loaded = {{boot: false, entry: false, onError: null}};
                \\if (!lastErrorHandler || !lastErrorHandler.__onceTag) {{
                \\  globalThis.onerror = function (evt) {{
                \\      if (this.onError && typeof this.onError == 'function') {{
                \\          this.onError(evt, loaded);
                \\      }}
                \\      console.error(evt.error);
                \\      debugger;
                \\  }};
                \\  globalThis.onerror.__onceTag = true;
                \\  globalThis.onerror.loaded = loaded;
                \\}}
                \\
                \\import boot from '{s}';
                \\loaded.boot = true;
                \\if ('setLoaded' in boot) boot.setLoaded(loaded);
                \\import * as EntryPoint from '{s}{s}';
                \\loaded.entry = true;
                \\
                \\if (!boot) {{
                \\ const now = Date.now();
                \\ debugger;
                \\ const elapsed = Date.now() - now;
                \\ if (elapsed < 1000) {{
                \\   throw new Error('Expected framework to export default a function. Instead, framework exported:', Object.keys(boot));
                \\ }}
                \\}}
                \\
                \\boot(EntryPoint, loaded);
            ,
                .{
                    client,
                    dir_to_use,
                    original_path.filename,
                },
            );
        } else {
            code = try std.fmt.bufPrint(
                &entry.code_buffer,
                \\var lastErrorHandler = globalThis.onerror;
                \\var loaded = {{boot: false, entry: false, onError: null}};
                \\if (!lastErrorHandler || !lastErrorHandler.__onceTag) {{
                \\  globalThis.onerror = function (evt) {{
                \\      if (this.onError && typeof this.onError == 'function') {{
                \\          this.onError(evt, loaded);
                \\      }}
                \\      console.error(evt.error);
                \\      debugger;
                \\  }};
                \\  globalThis.onerror.__onceTag = true;
                \\  globalThis.onerror.loaded = loaded;
                \\}}
                \\
                \\import boot from '{s}';
                \\loaded.boot = true;
                \\if ('setLoaded' in boot) boot.setLoaded(loaded);
                \\import * as EntryPoint from '{s}{s}';
                \\loaded.entry = true;
                \\
                \\if (!boot) {{
                \\ const now = Date.now();
                \\ debugger;
                \\ const elapsed = Date.now() - now;
                \\ if (elapsed < 1000) {{
                \\   throw new Error('Expected framework to export default a function. Instead, framework exported:', Object.keys(boot));
                \\ }}
                \\}}
                \\
                \\boot(EntryPoint, loaded);
            ,
                .{
                    client,
                    dir_to_use,
                    original_path.filename,
                },
            );
        }

        entry.source = logger.Source.initPathString(generateEntryPointPath(&entry.path_buffer, original_path), code);
        entry.source.path.namespace = "client-entry";
    }
};

pub const ServerEntryPoint = struct {
    code_buffer: [std.fs.MAX_PATH_BYTES * 2 + 500]u8 = undefined,
    output_code_buffer: [std.fs.MAX_PATH_BYTES * 8 + 500]u8 = undefined,
    source: logger.Source = undefined,

    pub fn generate(
        entry: *ServerEntryPoint,
        comptime BundlerType: type,
        bundler: *BundlerType,
        original_path: Fs.PathName,
        name: string,
    ) !void {

        // This is *extremely* naive.
        // The basic idea here is this:
        // --
        // import * as EntryPoint from 'entry-point';
        // import boot from 'framework';
        // boot(EntryPoint);
        // --
        // We go through the steps of printing the code -- only to then parse/transpile it because
        // we want it to go through the linker and the rest of the transpilation process

        const dir_to_use: string = original_path.dirWithTrailingSlash();

        const code = try std.fmt.bufPrint(
            &entry.code_buffer,
            \\//Auto-generated file
            \\import * as start from '{s}{s}';
            \\export * from '{s}{s}';
            \\if ('default' in start && typeof start.default == 'function') {{
            \\  start.default();
            \\}}
        ,
            .{
                dir_to_use,
                original_path.filename,
                dir_to_use,
                original_path.filename,
            },
        );

        entry.source = logger.Source.initPathString(name, code);
        entry.source.path.text = name;
        entry.source.path.namespace = "server-entry";
    }
};

pub const ResolveResults = std.AutoHashMap(
    u64,
    void,
);
pub const ResolveQueue = std.fifo.LinearFifo(
    _resolver.Result,
    std.fifo.LinearFifoBufferType.Dynamic,
);
