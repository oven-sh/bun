//! Instance of the development server. Controls an event loop, web server,
//! bundling state, filesystem watcher, and JavaScript VM instance.
//!
//! All work is cached in-memory.
//!
//! TODO: Currently does not have a `deinit()`, as it was assumed to be alive for
//! the remainder of this process' lifespan. Later, it will be required to fully
//! clean up server state.
pub const DevServer = @This();
pub const debug = bun.Output.Scoped(.Bake, false);
pub const igLog = bun.Output.scoped(.IncrementalGraph, false);

pub const Options = struct {
    allocator: ?Allocator = null, // defaults to a named heap
    cwd: []u8,
    routes: []Route,
    framework: bake.Framework,
    listen_config: uws.AppListenConfig = .{ .port = 3000 },
    dump_sources: ?[]const u8 = if (Environment.isDebug) ".bake-debug" else null,
    verbose_watcher: bool = false,
    // TODO: make it required to inherit a js VM
};

// The fields `client_graph`, `server_graph`, and `directory_watchers` all
// use `@fieldParentPointer` to access DevServer's state. This pattern has
// made it easier to group related fields together, but one must remember
// those structures still depend on the DevServer pointer.

/// Used for all server-wide allocations. In debug, this shows up in
/// a separate named heap. Thread-safe.
allocator: Allocator,
/// Project root directory. For the HMR runtime, its
/// module IDs are strings relative to this.
cwd: []const u8,

// UWS App
app: *App,
routes: []Route,
address: struct {
    port: u16,
    hostname: [*:0]const u8,
},
listener: ?*App.ListenSocket,

// Server Runtime
server_global: *DevGlobalObject,
vm: *VirtualMachine,
/// This is a handle to the server_fetch_function, which is shared
/// across all loaded modules. Its type is `(Request, Id, Meta) => Response`
server_fetch_function_callback: JSC.Strong,
server_register_update_callback: JSC.Strong,

// Watching
bun_watcher: *JSC.Watcher,
directory_watchers: DirectoryWatchStore,
/// Only two hot-reload tasks exist ever. Memory is reused by swapping between the two.
/// These items are aligned to cache lines to reduce contention.
watch_events: [2]HotReloadTask.Aligned,
/// 0  - no watch
/// 1  - has fired additional watch
/// 2+ - new events available, watcher is waiting on bundler to finish
watch_state: std.atomic.Value(u32),
watch_current: u1 = 0,

// Bundling
generation: usize = 0,
client_graph: IncrementalGraph(.client),
server_graph: IncrementalGraph(.server),
route_lookup: AutoArrayHashMapUnmanaged(IncrementalGraph(.server).FileIndex, Route.Index),
incremental_result: IncrementalResult,
graph_safety_lock: bun.DebugThreadLock,
framework: bake.Framework,
// Each logical graph gets it's own bundler configuration
server_bundler: Bundler,
client_bundler: Bundler,
ssr_bundler: Bundler,
/// Stored and reused for bundling tasks
log: Log,

// Debugging
dump_dir: ?std.fs.Dir,
emit_visualizer_events: u32 = 0,

pub const internal_prefix = "/_bun";
pub const client_prefix = internal_prefix ++ "/client";

pub const Route = struct {
    pub const Index = bun.GenericIndex(u32, Route);

    // Config
    pattern: [:0]const u8,
    entry_point: []const u8,

    bundle: BundleState = .stale,
    module_name_string: ?bun.String = null,

    /// Assigned in DevServer.init
    dev: *DevServer = undefined,
    client_bundled_url: []u8 = undefined,

    pub fn clientPublicPath(route: *const Route) []const u8 {
        return route.client_bundled_url[0 .. route.client_bundled_url.len - "/client.js".len];
    }
};

/// Three-way maybe state
const BundleState = union(enum) {
    /// Bundled assets are not prepared
    stale,
    /// Build failure
    fail: Failure,

    ready: Bundle,

    fn reset(s: *BundleState) void {
        switch (s.*) {
            .stale => return,
            .fail => |f| f.deinit(),
            .ready => |b| b.deinit(),
        }
        s.* = .stale;
    }

    const NonStale = union(enum) {
        /// Build failure
        fail: Failure,
        ready: Bundle,
    };
};

const Bundle = struct {
    /// Backed by default_allocator.
    client_bundle: []const u8,
};

/// DevServer is stored on the heap, storing it's allocator.
pub fn init(options: Options) !*DevServer {
    const allocator = options.allocator orelse bun.default_allocator;
    bun.analytics.Features.kit_dev +|= 1;
    if (JSC.VirtualMachine.VMHolder.vm != null)
        @panic("Cannot initialize bake.DevServer on a thread with an active JSC.VirtualMachine");

    const dump_dir = if (options.dump_sources) |dir|
        std.fs.cwd().makeOpenPath(dir, .{}) catch |err| dir: {
            bun.handleErrorReturnTrace(err, @errorReturnTrace());
            Output.warn("Could not open directory for dumping sources: {}", .{err});
            break :dir null;
        }
    else
        null;

    const app = App.create(.{});

    const separate_ssr_graph = if (options.framework.server_components) |sc| sc.separate_ssr_graph else false;

    const dev = bun.create(allocator, DevServer, .{
        .allocator = allocator,

        .cwd = options.cwd,
        .app = app,
        .routes = options.routes,
        .address = .{
            .port = @intCast(options.listen_config.port),
            .hostname = options.listen_config.host orelse "localhost",
        },
        .directory_watchers = DirectoryWatchStore.empty,
        .server_fetch_function_callback = .{},
        .server_register_update_callback = .{},
        .listener = null,
        .generation = 0,
        .graph_safety_lock = .{},
        .log = Log.init(allocator),
        .dump_dir = dump_dir,
        .framework = options.framework,
        .watch_state = .{ .raw = 0 },
        .watch_current = 0,

        .client_graph = IncrementalGraph(.client).empty,
        .server_graph = IncrementalGraph(.server).empty,
        .incremental_result = IncrementalResult.empty,
        .route_lookup = .{},

        .server_bundler = undefined,
        .client_bundler = undefined,
        .ssr_bundler = undefined,

        .server_global = undefined,
        .vm = undefined,

        .bun_watcher = undefined,
        .watch_events = undefined,
    });
    errdefer allocator.destroy(dev);

    assert(dev.server_graph.owner() == dev);
    assert(dev.client_graph.owner() == dev);
    assert(dev.directory_watchers.owner() == dev);

    const fs = try bun.fs.FileSystem.init(options.cwd);

    dev.bun_watcher = try Watcher.init(DevServer, dev, fs, bun.default_allocator);
    errdefer dev.bun_watcher.deinit(false);
    try dev.bun_watcher.start();

    dev.server_bundler.resolver.watcher = dev.bun_watcher.getResolveWatcher();
    dev.client_bundler.resolver.watcher = dev.bun_watcher.getResolveWatcher();
    dev.ssr_bundler.resolver.watcher = dev.bun_watcher.getResolveWatcher();
    dev.watch_events = .{
        .{ .aligned = HotReloadTask.initEmpty(dev) },
        .{ .aligned = HotReloadTask.initEmpty(dev) },
    };

    try dev.initBundler(&dev.server_bundler, .server);
    try dev.initBundler(&dev.client_bundler, .client);
    if (separate_ssr_graph)
        try dev.initBundler(&dev.ssr_bundler, .ssr);

    dev.framework = dev.framework.resolve(
        &dev.server_bundler.resolver,
        &dev.client_bundler.resolver,
    ) catch {
        Output.errGeneric("Failed to resolve all imports required by the framework", .{});
        return error.FrameworkInitialization;
    };

    dev.vm = VirtualMachine.initKit(.{
        .allocator = bun.default_allocator,
        .args = std.mem.zeroes(bun.Schema.Api.TransformOptions),
    }) catch |err|
        Output.panic("Failed to create Global object: {}", .{err});
    dev.server_global = c.BakeCreateDevGlobal(dev, dev.vm.console);
    dev.vm.global = dev.server_global.js();
    dev.vm.regular_event_loop.global = dev.vm.global;
    dev.vm.jsc = dev.vm.global.vm();
    dev.vm.event_loop.ensureWaker();

    var has_fallback = false;

    for (options.routes, 0..) |*route, i| {
        app.any(route.pattern, *Route, route, onServerRequestInit);

        route.dev = dev;
        route.client_bundled_url = std.fmt.allocPrint(
            allocator,
            client_prefix ++ "/{d}/client.js",
            .{i},
        ) catch bun.outOfMemory();

        if (bun.strings.eqlComptime(route.pattern, "/*"))
            has_fallback = true;
    }

    app.get(client_prefix ++ "/:route/:asset", *DevServer, dev, onAssetRequestInit);

    app.ws(
        internal_prefix ++ "/hmr",
        dev,
        0,
        uws.WebSocketBehavior.Wrap(DevServer, DevWebSocket, false).apply(.{}),
    );

    app.get(internal_prefix ++ "/incremental_visualizer", *DevServer, dev, onIncrementalVisualizer);

    if (!has_fallback)
        app.any("/*", void, {}, onFallbackRoute);

    app.listenWithConfig(*DevServer, dev, onListen, options.listen_config);

    return dev;
}

fn deinit(dev: *DevServer) void {
    const allocator = dev.allocator;
    allocator.destroy(dev);
    bun.todoPanic(@src(), "bake.DevServer.deinit()");
}

fn initBundler(dev: *DevServer, bundler: *Bundler, comptime renderer: bake.Renderer) !void {
    const framework = dev.framework;

    bundler.* = try bun.Bundler.init(
        dev.allocator, // TODO: this is likely a memory leak
        &dev.log,
        std.mem.zeroes(bun.Schema.Api.TransformOptions),
        null, // TODO:
    );

    bundler.options.target = switch (renderer) {
        .client => .browser,
        .server, .ssr => .bun,
    };
    bundler.options.public_path = switch (renderer) {
        .client => client_prefix,
        .server, .ssr => dev.cwd,
    };
    bundler.options.entry_points = &.{};
    bundler.options.log = &dev.log;
    bundler.options.output_format = .internal_bake_dev;
    bundler.options.out_extensions = bun.StringHashMap([]const u8).init(bundler.allocator);
    bundler.options.hot_module_reloading = true;

    // force disable filesystem output, even though bundle_v2
    // is special cased to return before that code is reached.
    bundler.options.output_dir = "";

    // framework configuration
    bundler.options.react_fast_refresh = renderer == .client and framework.react_fast_refresh != null;
    bundler.options.server_components = framework.server_components != null;

    bundler.options.conditions = try bun.options.ESMConditions.init(dev.allocator, bundler.options.target.defaultConditions());
    if (renderer == .server and framework.server_components != null) {
        try bundler.options.conditions.appendSlice(&.{"react-server"});
    }

    bundler.options.tree_shaking = false;
    bundler.options.minify_syntax = true; // required for DCE
    bundler.options.minify_identifiers = false;
    bundler.options.minify_whitespace = false;

    bundler.options.dev_server = dev;
    bundler.options.framework = &dev.framework;

    bundler.configureLinker();
    try bundler.configureDefines();

    try bake.addImportMetaDefines(dev.allocator, bundler.options.define, .development, switch (renderer) {
        .client => .client,
        .server, .ssr => .server,
    });

    bundler.resolver.opts = bundler.options;
}

pub fn runLoopForever(dev: *DevServer) noreturn {
    const lock = dev.vm.jsc.getAPILock();
    defer lock.release();

    while (true) {
        dev.vm.tick();
        dev.vm.eventLoop().autoTickActive();
    }
}

// uws handlers

fn onListen(ctx: *DevServer, maybe_listen: ?*App.ListenSocket) void {
    const listen: *App.ListenSocket = maybe_listen orelse {
        bun.todoPanic(@src(), "handle listen failure", .{});
    };

    ctx.listener = listen;
    ctx.address.port = @intCast(listen.getLocalPort());

    Output.prettyErrorln("--\\> <green>http://{s}:{d}<r>\n", .{
        bun.span(ctx.address.hostname),
        ctx.address.port,
    });
    Output.flush();
}

fn onAssetRequestInit(dev: *DevServer, req: *Request, resp: *Response) void {
    const route = route: {
        const route_id = req.parameter(0);
        const i = std.fmt.parseInt(u16, route_id, 10) catch
            return req.setYield(true);
        if (i >= dev.routes.len)
            return req.setYield(true);
        break :route &dev.routes[i];
    };
    // const asset_name = req.parameter(1);
    switch (route.dev.getRouteBundle(route)) {
        .ready => |bundle| {
            sendJavaScriptSource(bundle.client_bundle, resp);
        },
        .fail => |fail| {
            fail.sendAsHttpResponse(resp, route);
        },
    }
}

fn onIncrementalVisualizer(_: *DevServer, _: *Request, resp: *Response) void {
    resp.corked(onIncrementalVisualizerCorked, .{resp});
}

fn onIncrementalVisualizerCorked(resp: *Response) void {
    const code = if (Environment.codegen_embed)
        @embedFile("incremental_visualizer.html")
    else
        bun.runtimeEmbedFile(.src_eager, "bake/incremental_visualizer.html");
    resp.writeHeaderInt("Content-Length", code.len);
    resp.end(code, false);
}

fn onServerRequestInit(route: *Route, req: *Request, resp: *Response) void {
    switch (route.dev.getRouteBundle(route)) {
        .ready => |ready| {
            onServerRequestWithBundle(route, ready, req, resp);
        },
        .fail => |fail| {
            fail.sendAsHttpResponse(resp, route);
        },
    }
}

fn getRouteBundle(dev: *DevServer, route: *Route) BundleState.NonStale {
    if (route.bundle == .stale) {
        var fail: Failure = undefined;
        route.bundle = bundle: {
            const success = dev.performBundleAndWaitInner(route, &fail) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                fail.printToConsole(route);
                break :bundle .{ .fail = fail };
            };
            break :bundle .{ .ready = success };
        };
    }
    return switch (route.bundle) {
        .stale => unreachable,
        .fail => |fail| .{ .fail = fail },
        .ready => |ready| .{ .ready = ready },
    };
}

fn performBundleAndWaitInner(dev: *DevServer, route: *Route, fail: *Failure) !Bundle {
    return dev.theRealBundlingFunction(
        &.{
            // TODO: only enqueue these two if they don't exist
            // tbh it would be easier just to pre-bundle the framework.
            BakeEntryPoint.init(dev.framework.entry_server.?, .server),
            BakeEntryPoint.init(dev.framework.entry_client.?, .client),
            // The route!
            BakeEntryPoint.route(
                route.entry_point,
                Route.Index.init(@intCast(bun.indexOfPointerInSlice(Route, dev.routes, route))),
            ),
        },
        route,
        .initial_response,
        fail,
    );
}

/// Error handling is done either by writing to `fail` with a specific failure,
/// or by appending to `dev.log`. The caller, `getRouteBundle`, will handle the
/// error, including replying to the request as well as console logging.
fn theRealBundlingFunction(
    dev: *DevServer,
    files: []const BakeEntryPoint,
    dependant_route: ?*Route,
    comptime client_chunk_kind: ChunkKind,
    fail: *Failure,
) !Bundle {
    // Ensure something is written to `fail` if something goes wrong
    fail.* = .{ .zig_error = error.FileNotFound };
    errdefer |err| if (fail.* == .zig_error) {
        if (dev.log.hasAny()) {
            // todo: clone to recycled
            fail.* = Failure.fromLog(&dev.log);
        } else {
            fail.* = .{ .zig_error = err };
        }
    };

    defer dev.emitVisualizerMessageIfNeeded() catch bun.outOfMemory();

    assert(files.len > 0);

    var heap = try ThreadlocalArena.init();
    defer heap.deinit();

    const allocator = heap.allocator();
    var ast_memory_allocator = try allocator.create(bun.JSAst.ASTMemoryAllocator);
    ast_memory_allocator.* = .{ .allocator = allocator };
    ast_memory_allocator.reset();
    ast_memory_allocator.push();

    if (dev.framework.server_components == null) {
        // The handling of the dependency graphs are SLIGHTLY different when
        // server components are disabled. It's subtle, but enough that it
        // would be incorrect to even try to run a build.
        bun.todoPanic(@src(), "support non-server components build", .{});
    }

    var timer = if (Environment.enable_logs) std.time.Timer.start() catch unreachable;

    dev.graph_safety_lock.lock();
    defer dev.graph_safety_lock.unlock();

    const bv2 = try BundleV2.init(
        &dev.server_bundler,
        if (dev.framework.server_components != null) .{
            .framework = dev.framework,
            .client_bundler = &dev.client_bundler,
            .ssr_bundler = &dev.ssr_bundler,
        } else @panic("TODO: support non-server components"),
        allocator,
        JSC.AnyEventLoop.init(allocator),
        false, // reloading is handled separately
        JSC.WorkPool.get(),
        heap,
    );
    bv2.bun_watcher = dev.bun_watcher;
    // this.plugins = completion.plugins;

    defer {
        if (bv2.graph.pool.pool.threadpool_context == @as(?*anyopaque, @ptrCast(bv2.graph.pool))) {
            bv2.graph.pool.pool.threadpool_context = null;
        }
        ast_memory_allocator.pop();
        bv2.deinit();
    }

    defer {
        dev.server_graph.reset();
        dev.client_graph.reset();
    }

    errdefer |e| brk: {
        // Wait for wait groups to finish. There still may be ongoing work.
        bv2.linker.source_maps.line_offset_wait_group.wait();
        bv2.linker.source_maps.quoted_contents_wait_group.wait();

        if (e == error.OutOfMemory) break :brk;

        // Since a bundle failed, track all files as stale. This allows
        // hot-reloading to remember the targets to rebuild for.
        for (bv2.graph.input_files.items(.source), bv2.graph.ast.items(.target)) |file, target| {
            const abs_path = file.path.text;
            if (!std.fs.path.isAbsolute(abs_path)) continue;

            switch (target.bakeRenderer()) {
                .server => {
                    _ = dev.server_graph.insertStale(abs_path, false) catch bun.outOfMemory();
                },
                .ssr => {
                    _ = dev.server_graph.insertStale(abs_path, true) catch bun.outOfMemory();
                },
                .client => {
                    _ = dev.client_graph.insertStale(abs_path, false) catch bun.outOfMemory();
                },
            }
        }

        dev.client_graph.ensureStaleBitCapacity(true) catch bun.outOfMemory();
        dev.server_graph.ensureStaleBitCapacity(true) catch bun.outOfMemory();
    }

    const output_files = try bv2.runFromJSInNewThread(&.{}, files);

    try dev.client_graph.ensureStaleBitCapacity(false);
    try dev.server_graph.ensureStaleBitCapacity(false);

    assert(output_files.items.len == 0);

    bv2.bundler.log.printForLogLevel(Output.errorWriter()) catch {};
    bv2.client_bundler.log.printForLogLevel(Output.errorWriter()) catch {};

    dev.generation +%= 1;
    if (Environment.enable_logs) {
        debug.log("Bundle Round {d}: {d} server, {d} client, {d} ms", .{
            dev.generation,
            dev.server_graph.current_chunk_parts.items.len,
            dev.client_graph.current_chunk_parts.items.len,
            @divFloor(timer.read(), std.time.ns_per_ms),
        });
    }

    const is_first_server_chunk = !dev.server_fetch_function_callback.has();

    const server_bundle = try dev.server_graph.takeBundle(if (is_first_server_chunk) .initial_response else .hmr_chunk);
    defer dev.allocator.free(server_bundle);

    const client_bundle = try dev.client_graph.takeBundle(client_chunk_kind);

    errdefer if (client_chunk_kind != .hmr_chunk) dev.allocator.free(client_bundle);
    defer if (client_chunk_kind == .hmr_chunk) dev.allocator.free(client_bundle);

    if (client_bundle.len > 0 and client_chunk_kind == .hmr_chunk) {
        assert(client_bundle[0] == '(');
        _ = dev.app.publish("*", client_bundle, .binary, true);
    }

    if (dev.log.hasAny()) {
        dev.log.printForLogLevel(Output.errorWriter()) catch {};
    }

    if (dependant_route) |route| {
        if (route.module_name_string == null) {
            route.module_name_string = bun.String.createUTF8(bun.path.relative(dev.cwd, route.entry_point));
        }
    }

    if (server_bundle.len > 0) {
        if (is_first_server_chunk) {
            const server_code = c.BakeLoadInitialServerCode(dev.server_global, bun.String.createLatin1(server_bundle)) catch |err| {
                fail.* = Failure.fromJSServerLoad(dev.server_global.js().takeException(err), dev.server_global.js());
                return error.ServerJSLoad;
            };
            dev.vm.waitForPromise(.{ .internal = server_code.promise });

            switch (server_code.promise.unwrap(dev.vm.jsc, .mark_handled)) {
                .pending => unreachable, // promise is settled
                .rejected => |err| {
                    fail.* = Failure.fromJSServerLoad(err, dev.server_global.js());
                    return error.ServerJSLoad;
                },
                .fulfilled => |v| bun.assert(v == .undefined),
            }

            const default_export = c.BakeGetRequestHandlerFromModule(dev.server_global, server_code.key);
            if (!default_export.isObject())
                @panic("Internal assertion failure: expected interface from HMR runtime to be an object");
            const fetch_function: JSValue = default_export.get(dev.server_global.js(), "handleRequest") orelse
                @panic("Internal assertion failure: expected interface from HMR runtime to contain handleRequest");
            bun.assert(fetch_function.isCallable(dev.vm.jsc));
            dev.server_fetch_function_callback = JSC.Strong.create(fetch_function, dev.server_global.js());
            const register_update = default_export.get(dev.server_global.js(), "registerUpdate") orelse
                @panic("Internal assertion failure: expected interface from HMR runtime to contain registerUpdate");
            dev.server_register_update_callback = JSC.Strong.create(register_update, dev.server_global.js());

            fetch_function.ensureStillAlive();
            register_update.ensureStillAlive();
        } else {
            const server_code = c.BakeLoadServerHmrPatch(dev.server_global, bun.String.createLatin1(server_bundle)) catch |err| {
                // No user code has been evaluated yet, since everything is to
                // be wrapped in a function clousure. This means that the likely
                // error is going to be a syntax error, or other mistake in the
                // bundler.
                dev.vm.printErrorLikeObjectToConsole(dev.server_global.js().takeException(err));
                @panic("Error thrown while evaluating server code. This is always a bug in the bundler.");
            };
            _ = dev.server_register_update_callback.get().?.call(
                dev.server_global.js(),
                dev.server_global.js().toJSValue(),
                &.{server_code},
            ) catch |err| {
                // One module replacement error should NOT prevent follow-up
                // module replacements to fail. It is the HMR runtime's
                // responsibility to handle these errors.
                dev.vm.printErrorLikeObjectToConsole(dev.server_global.js().takeException(err));
                @panic("Error thrown in Hot-module-replacement code. This is always a bug in the HMR runtime.");
            };
        }
    }

    return .{ .client_bundle = client_bundle };
}

pub const HotUpdateContext = struct {
    /// bundle_v2.Graph.input_files.items(.source)
    sources: []bun.logger.Source,
    /// bundle_v2.Graph.ast.items(.import_records)
    import_records: []bun.ImportRecord.List,
    /// bundle_v2.Graph.server_component_boundaries.slice()
    scbs: bun.JSAst.ServerComponentBoundary.List.Slice,
    /// Which files have a server-component boundary.
    server_to_client_bitset: DynamicBitSetUnmanaged,

    /// Used to reduce calls to the IncrementalGraph hash table.
    ///
    /// Caller initializes a slice with `sources.len * 2` items
    /// all initialized to `std.math.maxInt(u32)`
    ///
    /// The first half of this slice is for the client graph,
    /// second half is for server. Interact with this via
    /// `getCachedIndex`
    resolved_index_cache: []u32,
    /// Used to tell if the server should replace or append import records.
    server_seen_bit_set: DynamicBitSetUnmanaged,

    pub fn getCachedIndex(
        rc: *const HotUpdateContext,
        comptime side: bake.Side,
        i: bun.JSAst.Index,
    ) *IncrementalGraph(side).FileIndex {
        const start = switch (side) {
            .client => 0,
            .server => rc.sources.len,
        };

        const subslice = rc.resolved_index_cache[start..][0..rc.sources.len];

        comptime assert(@alignOf(IncrementalGraph(side).FileIndex.Optional) == @alignOf(u32));
        comptime assert(@sizeOf(IncrementalGraph(side).FileIndex.Optional) == @sizeOf(u32));
        return @ptrCast(&subslice[i.get()]);
    }
};

/// Called at the end of BundleV2 to index bundle contents into the `IncrementalGraph`s
pub fn finalizeBundle(
    dev: *DevServer,
    linker: *bun.bundle_v2.LinkerContext,
    chunk: *bun.bundle_v2.Chunk,
) !void {
    const input_file_sources = linker.parse_graph.input_files.items(.source);
    const import_records = linker.parse_graph.ast.items(.import_records);
    const targets = linker.parse_graph.ast.items(.target);
    const scbs = linker.parse_graph.server_component_boundaries.slice();

    var sfa = std.heap.stackFallback(4096, linker.allocator);
    const stack_alloc = sfa.get();
    var scb_bitset = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(stack_alloc, input_file_sources.len);
    for (scbs.list.items(.ssr_source_index)) |ssr_index| {
        scb_bitset.set(ssr_index);
    }

    const resolved_index_cache = try linker.allocator.alloc(u32, input_file_sources.len * 2);

    var ctx: bun.bake.DevServer.HotUpdateContext = .{
        .import_records = import_records,
        .sources = input_file_sources,
        .scbs = scbs,
        .server_to_client_bitset = scb_bitset,
        .resolved_index_cache = resolved_index_cache,
        .server_seen_bit_set = undefined,
    };

    // Pass 1, update the graph's nodes, resolving every bundler source
    // index into it's `IncrementalGraph(...).FileIndex`
    for (
        chunk.content.javascript.parts_in_chunk_in_order,
        chunk.compile_results_for_chunk,
    ) |part_range, compile_result| {
        try dev.receiveChunk(
            &ctx,
            part_range.source_index,
            targets[part_range.source_index.get()].bakeRenderer(),
            compile_result,
        );
    }

    dev.client_graph.affected_by_update = try DynamicBitSetUnmanaged.initEmpty(linker.allocator, dev.client_graph.bundled_files.count());
    defer dev.client_graph.affected_by_update = .{};
    dev.server_graph.affected_by_update = try DynamicBitSetUnmanaged.initEmpty(linker.allocator, dev.server_graph.bundled_files.count());
    defer dev.client_graph.affected_by_update = .{};

    ctx.server_seen_bit_set = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(linker.allocator, dev.server_graph.bundled_files.count());

    // Pass 2, update the graph's edges by performing import diffing on each
    // changed file, removing dependencies. This pass also flags what routes
    // have been modified.
    for (chunk.content.javascript.parts_in_chunk_in_order) |part_range| {
        try dev.processChunkDependencies(
            &ctx,
            part_range.source_index,
            targets[part_range.source_index.get()].bakeRenderer(),
            linker.allocator,
        );
    }
}

pub fn receiveChunk(
    dev: *DevServer,
    ctx: *HotUpdateContext,
    index: bun.JSAst.Index,
    side: bake.Renderer,
    chunk: bun.bundle_v2.CompileResult,
) !void {
    return switch (side) {
        .server => dev.server_graph.receiveChunk(ctx, index, chunk, false),
        .ssr => dev.server_graph.receiveChunk(ctx, index, chunk, true),
        .client => dev.client_graph.receiveChunk(ctx, index, chunk, false),
    };
}

pub fn processChunkDependencies(
    dev: *DevServer,
    ctx: *HotUpdateContext,
    index: bun.JSAst.Index,
    side: bake.Renderer,
    temp_alloc: Allocator,
) !void {
    return switch (side) {
        .server, .ssr => dev.server_graph.processChunkDependencies(ctx, index, temp_alloc),
        .client => dev.client_graph.processChunkDependencies(ctx, index, temp_alloc),
    };
}

pub fn isFileStale(dev: *DevServer, path: []const u8, side: bake.Renderer) bool {
    switch (side) {
        inline else => |side_comptime| {
            const g = switch (side_comptime) {
                .client => &dev.client_graph,
                .server => &dev.server_graph,
                .ssr => &dev.server_graph,
            };
            const index = g.bundled_files.getIndex(path) orelse
                return true; // non-existent files are considered stale
            return g.stale_files.isSet(index);
        },
    }
}

// uws with bundle handlers

fn onServerRequestWithBundle(route: *Route, bundle: Bundle, req: *Request, resp: *Response) void {
    const dev = route.dev;
    _ = bundle;

    // TODO: this does not move the body, reuse memory, and many other things
    // that server.zig does.
    const url_bun_string = bun.String.init(req.url());
    defer url_bun_string.deref();

    const headers = JSC.FetchHeaders.createFromUWS(req);
    const request_object = JSC.WebCore.Request.init(
        url_bun_string,
        headers,
        dev.vm.initRequestBodyValue(.Null) catch bun.outOfMemory(),
        bun.http.Method.which(req.method()) orelse .GET,
    ).new();

    const js_request = request_object.toJS(dev.server_global.js());

    const global = dev.server_global.js();

    const server_request_callback = dev.server_fetch_function_callback.get() orelse
        unreachable; // did not bundle

    // TODO: use a custom class for this metadata type + revise the object structure too
    const meta = JSValue.createEmptyObject(global, 1);
    meta.put(
        dev.server_global.js(),
        bun.String.static("clientEntryPoint"),
        bun.String.init(route.client_bundled_url).toJS(global),
    );

    var result = server_request_callback.call(
        global,
        .undefined,
        &.{
            js_request,
            meta,
            route.module_name_string.?.toJS(dev.server_global.js()),
        },
    ) catch |err| {
        const exception = global.takeException(err);
        const fail: Failure = .{ .request_handler = exception };
        fail.printToConsole(route);
        fail.sendAsHttpResponse(resp, route);
        return;
    };

    if (result.asAnyPromise()) |promise| {
        dev.vm.waitForPromise(promise);
        switch (promise.unwrap(dev.vm.jsc, .mark_handled)) {
            .pending => unreachable, // was waited for
            .fulfilled => |r| result = r,
            .rejected => |e| {
                const fail: Failure = .{ .request_handler = e };
                fail.printToConsole(route);
                fail.sendAsHttpResponse(resp, route);
                return;
            },
        }
    }

    // TODO: This interface and implementation is very poor. It is fine as
    // the runtime currently emulates returning a `new Response`
    //
    // It probably should use code from `server.zig`, but most importantly it should
    // not have a tie to DevServer, but instead be generic with a context structure
    // containing just a *uws.App, *JSC.EventLoop, and JSValue response object.
    //
    // This would allow us to support all of the nice things `new Response` allows

    const bun_string = result.toBunString(dev.server_global.js());
    defer bun_string.deref();
    if (bun_string.tag == .Dead) {
        bun.todoPanic(@src(), "Bake: support non-string return value", .{});
    }

    const utf8 = bun_string.toUTF8(dev.allocator);
    defer utf8.deinit();

    resp.writeStatus("200 OK");
    resp.writeHeader("Content-Type", MimeType.html.value);
    resp.end(utf8.slice(), true); // TODO: You should never call res.end(huge buffer)
}

fn onFallbackRoute(_: void, _: *Request, resp: *Response) void {
    sendBuiltInNotFound(resp);
}

// http helper functions

fn sendOutputFile(file: *const OutputFile, resp: *Response) void {
    switch (file.value) {
        .buffer => |buffer| {
            if (buffer.bytes.len == 0) {
                resp.writeStatus("202 No Content");
                resp.writeHeaderInt("Content-Length", 0);
                resp.end("", true);
                return;
            }

            resp.writeStatus("200 OK");
            // TODO: CSS, Sourcemap
            resp.writeHeader("Content-Type", MimeType.javascript.value);
            resp.end(buffer.bytes, true); // TODO: You should never call res.end(huge buffer)
        },
        else => |unhandled_tag| Output.panic("TODO: unhandled tag .{s}", .{@tagName(unhandled_tag)}),
    }
}

fn sendJavaScriptSource(code: []const u8, resp: *Response) void {
    if (code.len == 0) {
        resp.writeStatus("202 No Content");
        resp.writeHeaderInt("Content-Length", 0);
        resp.end("", true);
        return;
    }

    resp.writeStatus("200 OK");
    // TODO: CSS, Sourcemap
    resp.writeHeader("Content-Type", MimeType.javascript.value);
    resp.end(code, true); // TODO: You should never call res.end(huge buffer)
}

fn sendBuiltInNotFound(resp: *Response) void {
    const message = "404 Not Found";
    resp.writeStatus("404 Not Found");
    resp.end(message, true);
}

/// The paradigm of Bake's incremental state is to store a separate list of files
/// than the Graph in bundle_v2. When watch events happen, the bundler is run on
/// the changed files, excluding non-stale files via `isFileStale`.
///
/// Upon bundle completion, both `client_graph` and `server_graph` have their
/// `receiveChunk` methods called with all new chunks, counting the total length
/// needed. A call to `takeBundle` joins all of the chunks, resulting in the
/// code to send to client or evaluate on the server.
///
/// Then, `processChunkDependencies` is called on each chunk to update the
/// list of imports. When a change in imports is detected, the dependencies
/// are updated accordingly.
///
/// Since all routes share the two graphs, bundling a new route that shared
/// a module from a previously bundled route will perform the same exclusion
/// behavior that rebuilds use. This also ensures that two routes on the server
/// do not emit duplicate dependencies. By tracing `imports` on each file in
/// the module graph recursively, the full bundle for any given route can
/// be re-materialized (required when pressing Cmd+R after any client update)
pub fn IncrementalGraph(side: bake.Side) type {
    return struct {
        // Unless otherwise mentioned, all data structures use DevServer's allocator.

        /// Key contents are owned by `default_allocator`
        bundled_files: bun.StringArrayHashMapUnmanaged(File),
        /// Track bools for files which are "stale", meaning they should be
        /// re-bundled before being used. Resizing this is usually deferred
        /// until after a bundle, since resizing the bit-set requires an
        /// exact size, instead of the log approach that dynamic arrays use.
        stale_files: DynamicBitSetUnmanaged,

        /// Start of the 'dependencies' linked list. These are the other files
        /// that import used by this file. Walk this list to discover what
        /// files are to be reloaded when something changes.
        first_dep: ArrayListUnmanaged(EdgeIndex.Optional),
        /// Start of the 'imports' linked list. These are the files that this
        /// file imports.
        first_import: ArrayListUnmanaged(EdgeIndex.Optional),
        /// `File` objects act as nodes in a directional many-to-many graph,
        /// where edges represent the imports between modules. An 'dependency'
        /// is a file that must to be notified when it `imported` changes. This
        /// is implemented using an array of `Edge` objects that act as linked
        /// list nodes; each file stores the first imports and dependency.
        edges: ArrayListUnmanaged(Edge),
        /// HMR Dependencies are added and removed very frequently, but indexes
        /// must remain stable. This free list allows re-use of freed indexes,
        /// so garbage collection can run less often.
        edges_free_list: ArrayListUnmanaged(EdgeIndex),

        /// Used during an incremental update to determine what "HMR roots"
        /// are affected. Set for all `bundled_files` that have been visited
        /// by the dependency tracing logic.
        ///
        /// Outside of an incremental bundle, this is empty.
        /// Backed by the bundler thread's arena allocator.
        affected_by_update: DynamicBitSetUnmanaged,

        /// Byte length of every file queued for concatenation
        current_chunk_len: usize = 0,
        /// All part contents
        current_chunk_parts: ArrayListUnmanaged(switch (side) {
            .client => FileIndex,
            // These slices do not outlive the bundler, and must
            // be joined before its arena is deinitialized.
            .server => []const u8,
        }),

        const empty: @This() = .{
            .bundled_files = .{},
            .stale_files = .{},

            .first_dep = .{},
            .first_import = .{},
            .edges = .{},
            .edges_free_list = .{},

            .affected_by_update = .{},

            .current_chunk_len = 0,
            .current_chunk_parts = .{},
        };

        pub const File = switch (side) {
            // The server's incremental graph does not store previously bundled
            // code because there is only one instance of the server. Instead,
            // it stores which module graphs it is a part of. This makes sure
            // that recompilation knows what bundler options to use.
            .server => struct {
                // .server => packed struct(u8) {
                /// Is this file built for the Server graph.
                is_rsc: bool,
                /// Is this file built for the SSR graph.
                is_ssr: bool,
                /// This is a file is an entry point to the framework.
                /// Changing this will always cause a full page reload.
                is_special_framework_file: bool,
                /// Changing code in a client component should rebuild code for
                /// SSR, but it should not count as changing the server code
                /// since a connected client can hot-update these files.
                is_client_to_server_component_boundary: bool,
                /// If this file is a route root, the route can be looked up in
                /// the route list. This also stops dependency propagation.
                is_route: bool,

                unused: enum(u3) { unused = 0 } = .unused,

                fn stopsPropagation(flags: @This()) bool {
                    return flags.is_special_framework_file or
                        flags.is_route or
                        flags.is_client_to_server_component_boundary;
                }
            },
            .client => struct {
                /// Allocated by default_allocator
                code: []const u8,

                inline fn stopsPropagation(_: @This()) bool {
                    return false;
                }
            },
        };

        // If this data structure is not clear, see `DirectoryWatchStore.Dep`
        // for a simpler example. It is more complicated here because this
        // structure is two-way.
        pub const Edge = struct {
            /// The file with the `import` statement
            dependency: FileIndex,
            /// The file that `dependency` is importing
            imported: FileIndex,

            next_import: EdgeIndex.Optional,
            next_dependency: EdgeIndex.Optional,
            prev_dependency: EdgeIndex.Optional,
        };

        /// An index into `bundled_files`, `stale_files`, `first_dep`, `first_import`, or `affected_by_update`
        pub const FileIndex = bun.GenericIndex(u32, File);

        /// An index into `edges`
        const EdgeIndex = bun.GenericIndex(u32, Edge);

        /// Tracks a bundled code chunk for cross-bundle chunks,
        /// ensuring it has an entry in `bundled_files`.
        ///
        /// For client, takes ownership of the code slice (must be default allocated)
        ///
        /// For server, the code is temporarily kept in the
        /// `current_chunk_parts` array, where it must live until
        /// takeChunk is called. Then it can be freed.
        pub fn receiveChunk(
            g: *@This(),
            ctx: *const HotUpdateContext,
            index: bun.JSAst.Index,
            chunk: bun.bundle_v2.CompileResult,
            is_ssr_graph: bool,
        ) !void {
            g.owner().graph_safety_lock.assertLocked();

            const abs_path = ctx.sources[index.get()].path.text;

            const code = chunk.code();
            if (Environment.allow_assert) {
                if (bun.strings.isAllWhitespace(code)) {
                    // Should at least contain the function wrapper
                    bun.Output.panic("Empty chunk is impossible: {s} {s}", .{
                        abs_path,
                        switch (side) {
                            .client => "client",
                            .server => if (is_ssr_graph) "ssr" else "server",
                        },
                    });
                }
            }

            g.current_chunk_len += code.len;

            if (g.owner().dump_dir) |dump_dir| {
                const cwd = g.owner().cwd;
                var a: bun.PathBuffer = undefined;
                var b: [bun.MAX_PATH_BYTES * 2]u8 = undefined;
                const rel_path = bun.path.relativeBufZ(&a, cwd, abs_path);
                const size = std.mem.replacementSize(u8, rel_path, "../", "_.._/");
                _ = std.mem.replace(u8, rel_path, "../", "_.._/", &b);
                const rel_path_escaped = b[0..size];
                dumpBundle(dump_dir, switch (side) {
                    .client => .client,
                    .server => if (is_ssr_graph) .ssr else .server,
                }, rel_path_escaped, code, true) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                    Output.warn("Could not dump bundle: {}", .{err});
                };
            }

            const gop = try g.bundled_files.getOrPut(g.owner().allocator, abs_path);

            if (!gop.found_existing) {
                gop.key_ptr.* = try bun.default_allocator.dupe(u8, abs_path);
                try g.first_dep.append(g.owner().allocator, .none);
                try g.first_import.append(g.owner().allocator, .none);
            } else {
                if (g.stale_files.bit_length > gop.index) {
                    g.stale_files.unset(gop.index);
                }
            }

            ctx.getCachedIndex(side, index).* = FileIndex.init(@intCast(gop.index));

            switch (side) {
                .client => {
                    if (gop.found_existing) {
                        bun.default_allocator.free(gop.value_ptr.code);
                    }
                    gop.value_ptr.* = .{
                        .code = code,
                    };
                    try g.current_chunk_parts.append(g.owner().allocator, FileIndex.init(@intCast(gop.index)));
                },
                .server => {
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = false,
                            .is_client_to_server_component_boundary = ctx.server_to_client_bitset.isSet(index.get()),
                            .is_special_framework_file = false, // TODO: set later
                        };
                    } else {
                        if (is_ssr_graph) {
                            gop.value_ptr.is_ssr = true;
                        } else {
                            gop.value_ptr.is_rsc = true;
                        }
                        if (ctx.server_to_client_bitset.isSet(index.get())) {
                            gop.value_ptr.is_client_to_server_component_boundary = true;
                        } else if (gop.value_ptr.is_client_to_server_component_boundary) {
                            // TODO: free the other graph's file
                            gop.value_ptr.is_client_to_server_component_boundary = false;
                        }
                    }
                    try g.current_chunk_parts.append(g.owner().allocator, chunk.code());
                },
            }
        }

        const TempLookup = extern struct {
            edge_index: EdgeIndex,
            seen: bool,

            const HashTable = AutoArrayHashMapUnmanaged(FileIndex, TempLookup);
        };

        /// Second pass of IncrementalGraph indexing
        /// - Updates dependency information for each file
        /// - Resolves what the HMR roots are
        pub fn processChunkDependencies(
            g: *@This(),
            ctx: *HotUpdateContext,
            bundle_graph_index: bun.JSAst.Index,
            temp_alloc: Allocator,
        ) bun.OOM!void {
            const log = bun.Output.scoped(.processChunkDependencies, false);
            const file_index: FileIndex = ctx.getCachedIndex(side, bundle_graph_index).*;
            log("index id={d} {}:", .{
                file_index.get(),
                bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
            });

            var quick_lookup: TempLookup.HashTable = .{};
            defer quick_lookup.deinit(temp_alloc);

            {
                var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
                while (it) |edge_index| {
                    const dep = g.edges.items[edge_index.get()];
                    it = dep.next_import.unwrap();
                    assert(dep.dependency == file_index);
                    try quick_lookup.putNoClobber(temp_alloc, dep.imported, .{
                        .seen = false,
                        .edge_index = edge_index,
                    });
                }
            }

            var new_imports: EdgeIndex.Optional = .none;
            defer g.first_import.items[file_index.get()] = new_imports;

            if (side == .server) {
                if (ctx.server_seen_bit_set.isSet(file_index.get())) return;

                const file = &g.bundled_files.values()[file_index.get()];

                // Process both files in the server-components graph at the same
                // time. If they were done separately, the second would detach
                // the edges the first added.
                if (file.is_rsc and file.is_ssr) {
                    // The non-ssr file is always first.
                    // const ssr_index = ctx.scbs.getSSRIndex(bundle_graph_index.get()) orelse {
                    //     @panic("Unexpected missing server-component-boundary entry");
                    // };
                    // try g.processChunkImportRecords(ctx, &quick_lookup, &new_imports, file_index, bun.JSAst.Index.init(ssr_index));
                }
            }

            try g.processChunkImportRecords(ctx, &quick_lookup, &new_imports, file_index, bundle_graph_index);

            // '.seen = false' means an import was removed and should be freed
            for (quick_lookup.values()) |val| {
                if (!val.seen) {
                    // Unlink from dependency list. At this point the edge is
                    // already detached from the import list.
                    const edge = &g.edges.items[val.edge_index.get()];
                    log("detach edge={d} | id={d} {} -> id={d} {}", .{
                        val.edge_index.get(),
                        edge.dependency.get(),
                        bun.fmt.quote(g.bundled_files.keys()[edge.dependency.get()]),
                        edge.imported.get(),
                        bun.fmt.quote(g.bundled_files.keys()[edge.imported.get()]),
                    });
                    if (edge.prev_dependency.unwrap()) |prev| {
                        const prev_dependency = &g.edges.items[prev.get()];
                        prev_dependency.next_dependency = edge.next_dependency;
                    } else {
                        assert(g.first_dep.items[edge.imported.get()].unwrap() == val.edge_index);
                        g.first_dep.items[edge.imported.get()] = .none;
                    }
                    if (edge.next_dependency.unwrap()) |next| {
                        const next_dependency = &g.edges.items[next.get()];
                        next_dependency.prev_dependency = edge.prev_dependency;
                    }

                    // With no references to this edge, it can be freed
                    try g.freeEdge(val.edge_index);
                }
            }

            // Follow this node to it's HMR root
            try g.propagateHotUpdate(file_index);
        }

        fn processChunkImportRecords(
            g: *@This(),
            ctx: *HotUpdateContext,
            quick_lookup: *TempLookup.HashTable,
            new_imports: *EdgeIndex.Optional,
            file_index: FileIndex,
            index: bun.JSAst.Index,
        ) !void {
            const log = bun.Output.scoped(.processChunkDependencies, false);
            for (ctx.import_records[index.get()].slice()) |import_record| {
                if (!import_record.source_index.isRuntime()) try_index_record: {
                    const imported_file_index = if (import_record.source_index.isInvalid())
                        if (std.fs.path.isAbsolute(import_record.path.text))
                            FileIndex.init(@intCast(
                                g.bundled_files.getIndex(import_record.path.text) orelse break :try_index_record,
                            ))
                        else
                            break :try_index_record
                    else
                        ctx.getCachedIndex(side, import_record.source_index).*;

                    if (quick_lookup.getPtr(imported_file_index)) |lookup| {
                        // If the edge has already been seen, it will be skipped
                        // to ensure duplicate edges never exist.
                        if (lookup.seen) continue;
                        lookup.seen = true;

                        const dep = &g.edges.items[lookup.edge_index.get()];
                        dep.next_import = new_imports.*;
                        new_imports.* = lookup.edge_index.toOptional();
                    } else {
                        // A new edge is needed to represent the dependency and import.
                        const first_dep = &g.first_dep.items[imported_file_index.get()];
                        const edge = try g.newEdge(.{
                            .next_import = new_imports.*,
                            .next_dependency = first_dep.*,
                            .prev_dependency = .none,
                            .imported = imported_file_index,
                            .dependency = file_index,
                        });
                        if (first_dep.*.unwrap()) |dep| {
                            g.edges.items[dep.get()].prev_dependency = edge.toOptional();
                        }
                        new_imports.* = edge.toOptional();
                        first_dep.* = edge.toOptional();

                        log("attach edge={d} | id={d} {} -> id={d} {}", .{
                            edge.get(),
                            file_index.get(),
                            bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                            imported_file_index.get(),
                            bun.fmt.quote(g.bundled_files.keys()[imported_file_index.get()]),
                        });
                    }
                }
            }
        }

        fn propagateHotUpdate(g: *@This(), file_index: FileIndex) !void {
            if (Environment.enable_logs) {
                igLog("propagateHotUpdate(.{s}, {}{s})", .{
                    @tagName(side),
                    bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                    if (g.affected_by_update.isSet(file_index.get())) " [already visited]" else "",
                });
            }

            if (g.affected_by_update.isSet(file_index.get()))
                return;
            g.affected_by_update.set(file_index.get());

            const file = g.bundled_files.values()[file_index.get()];

            switch (side) {
                .server => {
                    if (file.is_route) {
                        const route_index = g.owner().route_lookup.get(file_index) orelse
                            Output.panic("Route not in lookup index: {d} {}", .{ file_index.get(), bun.fmt.quote(g.bundled_files.keys()[file_index.get()]) });
                        igLog("\\<- Route", .{});
                        try g.owner().incremental_result.routes_affected.append(g.owner().allocator, route_index);
                    }
                },
                .client => {
                    // igLog("\\<- client side track", .{});
                },
            }

            // Certain files do not propagate updates to dependencies.
            // This is how updating a client component doesn't cause
            // a server-side reload.
            if (file.stopsPropagation()) {
                igLog("\\<- this file stops propagation", .{});
                return;
            }

            // Recurse
            var it: ?EdgeIndex = g.first_dep.items[file_index.get()].unwrap();
            while (it) |dep_index| {
                const edge = g.edges.items[dep_index.get()];
                it = edge.next_dependency.unwrap();
                try g.propagateHotUpdate(edge.dependency);
            }
        }

        /// Never takes ownership of `abs_path`
        /// Marks a chunk but without any content. Used to track dependencies to files that don't exist.
        pub fn insertStale(g: *@This(), abs_path: []const u8, is_ssr_graph: bool) bun.OOM!FileIndex {
            return g.insertStaleExtra(abs_path, is_ssr_graph, false, {});
        }

        pub fn insertStaleExtra(
            g: *@This(),
            abs_path: []const u8,
            is_ssr_graph: bool,
            comptime is_route: bool,
            route_index: if (is_route) Route.Index else void,
        ) bun.OOM!FileIndex {
            g.owner().graph_safety_lock.assertLocked();

            debug.log("Insert stale: {s}", .{abs_path});
            const gop = try g.bundled_files.getOrPut(g.owner().allocator, abs_path);
            const file_index = FileIndex.init(@intCast(gop.index));

            if (!gop.found_existing) {
                gop.key_ptr.* = try bun.default_allocator.dupe(u8, abs_path);
                try g.first_dep.append(g.owner().allocator, .none);
                try g.first_import.append(g.owner().allocator, .none);
            } else {
                if (g.stale_files.bit_length > gop.index) {
                    g.stale_files.set(gop.index);
                }
                if (side == .server) {
                    if (is_route) gop.value_ptr.*.is_route = is_route;
                }
            }

            if (is_route) {
                try g.owner().route_lookup.put(g.owner().allocator, file_index, route_index);
            }

            switch (side) {
                .client => {
                    gop.value_ptr.* = .{ .code = "" };
                },
                .server => {
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = is_route,
                            .is_client_to_server_component_boundary = false,
                            .is_special_framework_file = false,
                        };
                    } else if (is_ssr_graph) {
                        gop.value_ptr.is_ssr = true;
                    } else {
                        gop.value_ptr.is_rsc = true;
                    }
                },
            }

            return file_index;
        }

        pub fn ensureStaleBitCapacity(g: *@This(), val: bool) !void {
            try g.stale_files.resize(g.owner().allocator, @max(g.bundled_files.count(), g.stale_files.bit_length), val);
        }

        pub fn invalidate(g: *@This(), paths: []const []const u8, out_paths: *std.ArrayList(BakeEntryPoint)) !void {
            g.owner().graph_safety_lock.assertLocked();
            const values = g.bundled_files.values();
            for (paths) |path| {
                const index = g.bundled_files.getIndex(path) orelse {
                    // cannot enqueue because we don't know what targets to
                    // bundle for. instead, a failing bundle must retrieve the
                    // list of files and add them as stale.
                    continue;
                };
                g.stale_files.set(index);
                switch (side) {
                    .client => try out_paths.append(BakeEntryPoint.init(path, .client)),
                    .server => {
                        const data = &values[index];
                        if (data.is_rsc)
                            try out_paths.append(BakeEntryPoint.init(path, .server));
                        if (data.is_ssr)
                            try out_paths.append(BakeEntryPoint.init(path, .ssr));
                    },
                }
            }
        }

        fn reset(g: *@This()) void {
            g.current_chunk_len = 0;
            g.current_chunk_parts.clearRetainingCapacity();
        }

        pub fn takeBundle(g: *@This(), kind: ChunkKind) ![]const u8 {
            g.owner().graph_safety_lock.assertLocked();
            if (g.current_chunk_len == 0) return "";

            const runtime = switch (kind) {
                .initial_response => bun.bake.getHmrRuntime(side),
                .hmr_chunk => "({\n",
            };

            // A small amount of metadata is present at the end of the chunk
            // to inform the HMR runtime some crucial entry-point info. The
            // exact upper bound of this can be calculated, but is not to
            // avoid worrying about windows paths.
            var end_sfa = std.heap.stackFallback(65536, g.owner().allocator);
            var end_list = std.ArrayList(u8).initCapacity(end_sfa.get(), 65536) catch unreachable;
            defer end_list.deinit();
            const end = end: {
                const w = end_list.writer();
                switch (kind) {
                    .initial_response => {
                        const fw = g.owner().framework;
                        try w.writeAll("}, {\n  main: ");
                        const entry = switch (side) {
                            .server => fw.entry_server,
                            .client => fw.entry_client,
                        } orelse bun.todoPanic(@src(), "non-framework provided entry-point", .{});
                        try bun.js_printer.writeJSONString(
                            bun.path.relative(g.owner().cwd, entry),
                            @TypeOf(w),
                            w,
                            .utf8,
                        );
                        switch (side) {
                            .client => {
                                if (fw.react_fast_refresh) |rfr| {
                                    try w.writeAll(",\n  refresh: ");
                                    try bun.js_printer.writeJSONString(
                                        bun.path.relative(g.owner().cwd, rfr.import_source),
                                        @TypeOf(w),
                                        w,
                                        .utf8,
                                    );
                                }
                            },
                            .server => {
                                if (fw.server_components) |sc| {
                                    if (sc.separate_ssr_graph) {
                                        try w.writeAll(",\n  separateSSRGraph: true");
                                    }
                                }
                            },
                        }
                        try w.writeAll("\n})");
                    },
                    .hmr_chunk => {
                        try w.writeAll("\n})");
                    },
                }
                break :end end_list.items;
            };

            const files = g.bundled_files.values();

            // This function performs one allocation, right here
            var chunk = try ArrayListUnmanaged(u8).initCapacity(
                g.owner().allocator,
                g.current_chunk_len + runtime.len + end.len,
            );

            chunk.appendSliceAssumeCapacity(runtime);
            for (g.current_chunk_parts.items) |entry| {
                chunk.appendSliceAssumeCapacity(switch (side) {
                    // entry is an index into files
                    .client => files[entry.get()].code,
                    // entry is the '[]const u8' itself
                    .server => entry,
                });
            }
            chunk.appendSliceAssumeCapacity(end);
            // bun.assert_eql(chunk.capacity, chunk.items.len);

            if (g.owner().dump_dir) |dump_dir| {
                const rel_path_escaped = "latest_chunk.js";
                dumpBundle(dump_dir, switch (side) {
                    .client => .client,
                    .server => .server,
                }, rel_path_escaped, chunk.items, false) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                    Output.warn("Could not dump bundle: {}", .{err});
                };
            }

            return chunk.items;
        }

        fn newEdge(g: *@This(), edge: Edge) !EdgeIndex {
            if (g.edges_free_list.popOrNull()) |index| {
                g.edges.items[index.get()] = edge;
                return index;
            }

            const index = EdgeIndex.init(@intCast(g.edges.items.len));
            try g.edges.append(g.owner().allocator, edge);
            return index;
        }

        /// Does nothing besides release the `Edge` for reallocation by `newEdge`
        /// Caller must detach the dependency from the linked list it is in.
        fn freeEdge(g: *@This(), dep_index: EdgeIndex) !void {
            if (Environment.isDebug) {
                g.edges.items[dep_index.get()] = undefined;
            }

            if (dep_index.get() == (g.edges.items.len - 1)) {
                g.edges.items.len -= 1;
            } else {
                try g.edges_free_list.append(g.owner().allocator, dep_index);
            }
        }

        pub fn owner(g: *@This()) *DevServer {
            return @alignCast(@fieldParentPtr(@tagName(side) ++ "_graph", g));
        }
    };
}

const IncrementalResult = struct {
    routes_affected: ArrayListUnmanaged(Route.Index),

    const empty: IncrementalResult = .{
        .routes_affected = .{},
    };

    fn reset(result: *IncrementalResult) void {
        result.routes_affected.clearRetainingCapacity();
    }
};

/// When a file fails to import a relative path, directory watchers are added so
/// that when a matching file is created, the dependencies can be rebuilt. This
/// handles HMR cases where a user writes an import before creating the file,
/// or moves files around.
///
/// This structure manages those watchers, including releasing them once
/// import resolution failures are solved.
const DirectoryWatchStore = struct {
    /// This guards all store state
    lock: Mutex,

    /// List of active watchers. Can be re-ordered on removal
    watches: bun.StringArrayHashMapUnmanaged(Entry),
    dependencies: ArrayListUnmanaged(Dep),
    /// Dependencies cannot be re-ordered. This list tracks what indexes are free.
    dependencies_free_list: ArrayListUnmanaged(Dep.Index),

    const empty: DirectoryWatchStore = .{
        .lock = .{},
        .watches = .{},
        .dependencies = .{},
        .dependencies_free_list = .{},
    };

    pub fn owner(store: *DirectoryWatchStore) *DevServer {
        return @alignCast(@fieldParentPtr("directory_watchers", store));
    }

    pub fn trackResolutionFailure(
        store: *DirectoryWatchStore,
        import_source: []const u8,
        specifier: []const u8,
        renderer: bake.Renderer,
    ) bun.OOM!void {
        store.lock.lock();
        defer store.lock.unlock();

        // When it does not resolve to a file path, there is
        // nothing to track. Bake does not watch node_modules.
        if (!(bun.strings.startsWith(specifier, "./") or
            bun.strings.startsWith(specifier, "../"))) return;
        if (!std.fs.path.isAbsolute(import_source)) return;

        const joined = bun.path.joinAbs(bun.path.dirname(import_source, .auto), .auto, specifier);
        const dir = bun.path.dirname(joined, .auto);

        // `import_source` is not a stable string. let's share memory with the file graph.
        // this requires that
        const dev = store.owner();
        const owned_file_path = switch (renderer) {
            .client => path: {
                const index = try dev.client_graph.insertStale(import_source, false);
                break :path dev.client_graph.bundled_files.keys()[index.get()];
            },
            .server, .ssr => path: {
                const index = try dev.client_graph.insertStale(import_source, renderer == .ssr);
                break :path dev.client_graph.bundled_files.keys()[index.get()];
            },
        };

        store.insert(dir, owned_file_path, specifier) catch |err| switch (err) {
            error.Ignore => {}, // ignoring watch errors.
            error.OutOfMemory => |e| return e,
        };
    }

    /// `dir_name_to_watch` is cloned
    /// `file_path` must have lifetime that outlives the watch
    /// `specifier` is cloned
    fn insert(
        store: *DirectoryWatchStore,
        dir_name_to_watch: []const u8,
        file_path: []const u8,
        specifier: []const u8,
    ) !void {
        // TODO: watch the parent dir too.
        const dev = store.owner();

        debug.log("DirectoryWatchStore.insert({}, {}, {})", .{
            bun.fmt.quote(dir_name_to_watch),
            bun.fmt.quote(file_path),
            bun.fmt.quote(specifier),
        });

        if (store.dependencies_free_list.items.len == 0)
            try store.dependencies.ensureUnusedCapacity(dev.allocator, 1);

        const gop = try store.watches.getOrPut(dev.allocator, dir_name_to_watch);
        if (gop.found_existing) {
            const specifier_cloned = try dev.allocator.dupe(u8, specifier);
            errdefer dev.allocator.free(specifier_cloned);

            // TODO: check for dependency

            const dep = store.appendDepAssumeCapacity(.{
                .next = gop.value_ptr.first_dep.toOptional(),
                .source_file_path = file_path,
                .specifier = specifier_cloned,
            });
            gop.value_ptr.first_dep = dep;

            return;
        }
        errdefer store.watches.swapRemoveAt(gop.index);

        // Try to use an existing open directory handle
        const cache_fd = if (dev.server_bundler.resolver.readDirInfo(dir_name_to_watch) catch null) |cache| fd: {
            const fd = cache.getFileDescriptor();
            break :fd if (fd == .zero) null else fd;
        } else null;

        const fd, const owned_fd = if (cache_fd) |fd|
            .{ fd, false }
        else
            .{
                switch (bun.sys.open(
                    &(std.posix.toPosixPath(dir_name_to_watch) catch |err| switch (err) {
                        error.NameTooLong => return, // wouldn't be able to open, ignore
                    }),
                    bun.O.DIRECTORY,
                    0,
                )) {
                    .result => |fd| fd,
                    .err => |err| switch (err.getErrno()) {
                        // If this directory doesn't exist, a watcher should be
                        // placed on the parent directory. Then, if this
                        // directory is later created, the watcher can be
                        // properly initialized. This would happen if you write
                        // an import path like `./dir/whatever/hello.tsx` and
                        // `dir` does not exist, Bun must place a watcher on
                        // `.`, see the creation of `dir`, and repeat until it
                        // can open a watcher on `whatever` to see the creation
                        // of `hello.tsx`
                        .NOENT => {
                            // TODO: implement that. for now it ignores
                            return;
                        },
                        .NOTDIR => return error.Ignore, // ignore
                        else => {
                            bun.todoPanic(@src(), "log watcher error", .{});
                        },
                    },
                },
                true,
            };
        errdefer _ = if (owned_fd) bun.sys.close(fd);

        debug.log("-> fd: {} ({s})", .{
            fd,
            if (owned_fd) "from dir cache" else "owned fd",
        });

        const dir_name = try dev.allocator.dupe(u8, dir_name_to_watch);
        errdefer dev.allocator.free(dir_name);

        gop.key_ptr.* = dir_name;

        const specifier_cloned = try dev.allocator.dupe(u8, specifier);
        errdefer dev.allocator.free(specifier_cloned);

        const watch_index = switch (dev.bun_watcher.addDirectory(fd, dir_name, bun.JSC.GenericWatcher.getHash(dir_name), false)) {
            .err => return error.Ignore,
            .result => |id| id,
        };
        const dep = store.appendDepAssumeCapacity(.{
            .next = .none,
            .source_file_path = file_path,
            .specifier = specifier_cloned,
        });
        store.watches.putAssumeCapacity(dir_name, .{
            .dir = fd,
            .dir_fd_owned = owned_fd,
            .first_dep = dep,
            .watch_index = watch_index,
        });
    }

    /// Caller must detach the dependency from the linked list it is in.
    fn freeDependencyIndex(store: *DirectoryWatchStore, alloc: Allocator, index: Dep.Index) !void {
        alloc.free(store.dependencies.items[index.get()].specifier);

        if (Environment.isDebug) {
            store.dependencies.items[index.get()] = undefined;
        }

        if (index.get() == (store.dependencies.items.len - 1)) {
            store.dependencies.items.len -= 1;
        } else {
            try store.dependencies_free_list.append(alloc, index);
        }
    }

    /// Expects dependency list to be already freed
    fn freeEntry(store: *DirectoryWatchStore, entry_index: usize) void {
        const entry = store.watches.values()[entry_index];

        debug.log("DirectoryWatchStore.freeEntry({d}, {})", .{
            entry_index,
            entry.dir,
        });

        store.owner().bun_watcher.removeAtIndex(entry.watch_index, 0, &.{}, .file);

        defer _ = if (entry.dir_fd_owned) bun.sys.close(entry.dir);
        store.watches.swapRemoveAt(entry_index);

        if (store.watches.entries.len == 0) {
            assert(store.dependencies.items.len == 0);
            store.dependencies_free_list.clearRetainingCapacity();
        }
    }

    fn appendDepAssumeCapacity(store: *DirectoryWatchStore, dep: Dep) Dep.Index {
        if (store.dependencies_free_list.popOrNull()) |index| {
            store.dependencies.items[index.get()] = dep;
            return index;
        }

        const index = Dep.Index.init(@intCast(store.dependencies.items.len));
        store.dependencies.appendAssumeCapacity(dep);
        return index;
    }

    const Entry = struct {
        /// The directory handle the watch is placed on
        dir: bun.FileDescriptor,
        dir_fd_owned: bool,
        /// Files which request this import index
        first_dep: Dep.Index,
        /// To pass to Watcher.remove
        watch_index: u16,
    };

    const Dep = struct {
        next: Index.Optional,
        /// The file used
        source_file_path: []const u8,
        /// The specifier that failed. Before running re-build, it is resolved for, as
        /// creating an unrelated file should not re-emit another error. Default-allocator
        specifier: []const u8,

        const Index = bun.GenericIndex(u32, Dep);
    };
};

const ChunkKind = enum {
    initial_response,
    hmr_chunk,
};

/// Represents an error from loading or server sided runtime. Information on
/// what this error is from, such as the associated Route, is inferred from
/// surrounding context.
///
/// In the case a route was not able to fully compile, the `Failure` is stored
/// so that a browser refreshing the page can display this failure.
const Failure = union(enum) {
    zig_error: anyerror,
    /// Bundler and module resolution use `bun.logger` to report multiple errors at once.
    bundler: std.ArrayList(bun.logger.Msg),
    /// Thrown JavaScript exception while loading server code.
    server_load: JSC.Strong,
    /// Never stored; the current request handler threw an error.
    request_handler: JSValue,

    /// Consumes the Log data, resetting it.
    pub fn fromLog(log: *Log) Failure {
        const fail: Failure = .{ .bundler = log.msgs };
        log.* = .{
            .msgs = std.ArrayList(bun.logger.Msg).init(log.msgs.allocator),
            .level = log.level,
        };
        return fail;
    }

    pub fn fromJSServerLoad(js: JSValue, global: *JSC.JSGlobalObject) Failure {
        return .{ .server_load = JSC.Strong.create(js, global) };
    }

    // TODO: deduplicate the two methods here. that isnt trivial because one has to
    // style with ansi codes, and the other has to style with HTML.

    fn printToConsole(fail: *const Failure, route: *const Route) void {
        // TODO: remove dependency on `route`
        defer Output.flush();

        Output.prettyErrorln("", .{});

        switch (fail.*) {
            .bundler => |msgs| {
                Output.prettyErrorln("<red>Errors while bundling '{s}'<r>", .{
                    route.pattern,
                });
                Output.flush();

                var log: Log = .{ .msgs = msgs, .errors = 1, .level = .err };
                log.printForLogLevelColorsRuntime(
                    Output.errorWriter(),
                    Output.enable_ansi_colors_stderr,
                ) catch {};
            },
            .zig_error => |err| {
                Output.prettyErrorln("<red>Error while bundling '{s}': {s}<r>", .{
                    route.pattern,
                    @errorName(err),
                });
                Output.flush();
            },
            .server_load => |strong| {
                Output.prettyErrorln("<red>Server route handler for '{s}' threw while loading<r>", .{
                    route.pattern,
                });
                Output.flush();

                const err = strong.get() orelse unreachable;
                route.dev.vm.printErrorLikeObjectToConsole(err);
            },
            .request_handler => |err| {
                Output.prettyErrorln("<red>Request to handler '{s}' failed SSR<r>", .{
                    route.pattern,
                });
                Output.flush();

                route.dev.vm.printErrorLikeObjectToConsole(err);
            },
        }
    }

    fn sendAsHttpResponse(fail: *const Failure, resp: *Response, route: *const Route) void {
        resp.writeStatus("500 Internal Server Error");
        var buffer: [32768]u8 = undefined;

        const message = message: {
            var fbs = std.io.fixedBufferStream(&buffer);
            const writer = fbs.writer();

            switch (fail.*) {
                .bundler => |msgs| {
                    writer.print("Errors while bundling '{s}'\n\n", .{
                        route.pattern,
                    }) catch break :message null;

                    var log: Log = .{ .msgs = msgs, .errors = 1, .level = .err };
                    log.printForLogLevelWithEnableAnsiColors(writer, false) catch
                        break :message null;
                },
                .zig_error => |err| {
                    writer.print("Error while bundling '{s}': {s}\n", .{ route.pattern, @errorName(err) }) catch break :message null;
                },
                .server_load => |strong| {
                    writer.print("Server route handler for '{s}' threw while loading\n\n", .{
                        route.pattern,
                    }) catch break :message null;
                    const err = strong.get() orelse unreachable;
                    route.dev.vm.printErrorLikeObjectSimple(err, writer, false);
                },
                .request_handler => |err| {
                    writer.print("Server route handler for '{s}' threw while loading\n\n", .{
                        route.pattern,
                    }) catch break :message null;
                    route.dev.vm.printErrorLikeObjectSimple(err, writer, false);
                },
            }

            break :message fbs.getWritten();
        } orelse message: {
            const suffix = "...truncated";
            @memcpy(buffer[buffer.len - suffix.len ..], suffix);
            break :message &buffer;
        };
        resp.end(message, true); // TODO: "You should never call res.end(huge buffer)"
    }
};

// For debugging, it is helpful to be able to see bundles.
fn dumpBundle(dump_dir: std.fs.Dir, side: bake.Renderer, rel_path: []const u8, chunk: []const u8, wrap: bool) !void {
    const name = bun.path.joinAbsString("/", &.{
        @tagName(side),
        rel_path,
    }, .auto)[1..];
    var inner_dir = try dump_dir.makeOpenPath(bun.Dirname.dirname(u8, name).?, .{});
    defer inner_dir.close();

    const file = try inner_dir.createFile(bun.path.basename(name), .{});
    defer file.close();

    var bufw = std.io.bufferedWriter(file.writer());

    try bufw.writer().print("// {s} bundled for {s}\n", .{
        bun.fmt.quote(rel_path),
        @tagName(side),
    });
    try bufw.writer().print("// Bundled at {d}, Bun " ++ bun.Global.package_json_version_with_canary ++ "\n", .{
        std.time.nanoTimestamp(),
    });

    // Wrap in an object to make it valid syntax. Regardless, these files
    // are never executable on their own as they contain only a single module.

    if (wrap)
        try bufw.writer().writeAll("({\n");

    try bufw.writer().writeAll(chunk);

    if (wrap)
        try bufw.writer().writeAll("});\n");

    try bufw.flush();
}

fn emitVisualizerMessageIfNeeded(dev: *DevServer) !void {
    if (dev.emit_visualizer_events == 0) return;

    var sfb = std.heap.stackFallback(65536, bun.default_allocator);
    var payload = try std.ArrayList(u8).initCapacity(sfb.get(), 65536);
    defer payload.deinit();
    payload.appendAssumeCapacity('v');
    const w = payload.writer();

    inline for (
        [2]bake.Side{ .client, .server },
        .{ &dev.client_graph, &dev.server_graph },
    ) |side, g| {
        try w.writeInt(u32, @intCast(g.bundled_files.count()), .little);
        for (
            g.bundled_files.keys(),
            g.bundled_files.values(),
            0..,
        ) |k, v, i| {
            try w.writeInt(u32, @intCast(k.len), .little);
            if (k.len == 0) continue;
            try w.writeAll(k);
            try w.writeByte(@intFromBool(g.stale_files.isSet(i)));
            try w.writeByte(@intFromBool(side == .server and v.is_rsc));
            try w.writeByte(@intFromBool(side == .server and v.is_ssr));
            try w.writeByte(@intFromBool(side == .server and v.is_route));
            try w.writeByte(@intFromBool(side == .server and v.is_special_framework_file));
            try w.writeByte(@intFromBool(side == .server and v.is_client_to_server_component_boundary));
        }
    }
    inline for (.{ &dev.client_graph, &dev.server_graph }) |g| {
        try w.writeInt(u32, @intCast(g.edges.items.len), .little);
        for (g.edges.items) |edge| {
            try w.writeInt(u32, @intCast(edge.dependency.get()), .little);
            try w.writeInt(u32, @intCast(edge.imported.get()), .little);
        }
    }

    _ = dev.app.publish("v", payload.items, .binary, false);
}

pub fn onWebSocketUpgrade(
    dev: *DevServer,
    res: *Response,
    req: *Request,
    upgrade_ctx: *uws.uws_socket_context_t,
    id: usize,
) void {
    assert(id == 0);

    const dw = bun.create(dev.allocator, DevWebSocket, .{
        .dev = dev,
        .emit_visualizer_events = false,
    });
    res.upgrade(
        *DevWebSocket,
        dw,
        req.header("sec-websocket-key") orelse "",
        req.header("sec-websocket-protocol") orelse "",
        req.header("sec-websocket-extension") orelse "",
        upgrade_ctx,
    );
}

const DevWebSocket = struct {
    dev: *DevServer,
    emit_visualizer_events: bool,

    pub fn onOpen(dw: *DevWebSocket, ws: AnyWebSocket) void {
        _ = dw; // autofix
        // TODO: append hash of the framework config
        _ = ws.send("V" ++ bun.Global.package_json_version_with_revision, .binary, false, true);
        _ = ws.subscribe("*");
    }

    pub fn onMessage(dw: *DevWebSocket, ws: AnyWebSocket, msg: []const u8, opcode: uws.Opcode) void {
        if (msg.len == 1 and msg[0] == 'v' and !dw.emit_visualizer_events) {
            dw.emit_visualizer_events = true;
            dw.dev.emit_visualizer_events += 1;
            _ = ws.subscribe("v");
            dw.dev.emitVisualizerMessageIfNeeded() catch bun.outOfMemory();
        }
        _ = opcode; // autofix
    }

    pub fn onClose(dw: *DevWebSocket, ws: AnyWebSocket, exit_code: i32, message: []const u8) void {
        _ = ws; // autofix
        _ = exit_code; // autofix
        _ = message; // autofix

        if (dw.emit_visualizer_events) {
            dw.dev.emit_visualizer_events -= 1;
        }

        defer dw.dev.allocator.destroy(dw);
    }
};

/// Bake uses a special global object extending Zig::GlobalObject
pub const DevGlobalObject = opaque {
    /// Safe downcast to use other Bun APIs
    pub fn js(ptr: *DevGlobalObject) *JSC.JSGlobalObject {
        return @ptrCast(ptr);
    }

    pub fn vm(ptr: *DevGlobalObject) *JSC.VM {
        return ptr.js().vm();
    }
};

pub const BakeSourceProvider = opaque {};

const c = struct {
    // BakeDevGlobalObject.cpp
    extern fn BakeCreateDevGlobal(owner: *DevServer, console: *JSC.ConsoleObject) *DevGlobalObject;

    // BakeSourceProvider.cpp
    extern fn BakeGetRequestHandlerFromModule(global: *DevGlobalObject, module: *JSC.JSString) JSValue;

    const LoadServerCodeResult = struct {
        promise: *JSInternalPromise,
        key: *JSC.JSString,
    };

    fn BakeLoadServerHmrPatch(global: *DevGlobalObject, code: bun.String) !JSValue {
        const f = @extern(*const fn (*DevGlobalObject, bun.String) callconv(.C) JSValue, .{
            .name = "BakeLoadServerHmrPatch",
        });
        const result = f(global, code);
        if (result == .zero) {
            if (Environment.allow_assert) assert(global.js().hasException());
            return error.JSError;
        }
        return result;
    }

    fn BakeLoadInitialServerCode(global: *DevGlobalObject, code: bun.String) bun.JSError!LoadServerCodeResult {
        const Return = extern struct {
            promise: ?*JSInternalPromise,
            key: *JSC.JSString,
        };
        const f = @extern(*const fn (*DevGlobalObject, bun.String) callconv(.C) Return, .{
            .name = "BakeLoadInitialServerCode",
        });
        const result = f(global, code);
        return .{
            .promise = result.promise orelse {
                if (Environment.allow_assert) assert(global.js().hasException());
                return error.JSError;
            },
            .key = result.key,
        };
    }
};

/// Called on DevServer thread via HotReloadTask
pub fn reload(dev: *DevServer, reload_task: *HotReloadTask) bun.OOM!void {
    defer reload_task.files.clearRetainingCapacity();

    const changed_file_paths = reload_task.files.keys();
    // TODO: check for .delete and remove items from graph. this has to be done
    // with care because some editors save by deleting and recreating the file.
    // delete events are not to be trusted at face value. also, merging of
    // events can cause .write and .delete to be true at the same time.
    const changed_file_attributes = reload_task.files.values();
    _ = changed_file_attributes;

    // std.time.sleep(50 * std.time.ns_per_ms);

    var sfb = std.heap.stackFallback(4096, bun.default_allocator);
    const temp_alloc = sfb.get();

    // pre-allocate a few files worth of strings. it is unlikely but supported
    // to change more than 8 files in the same bundling round.
    var files = std.ArrayList(BakeEntryPoint).initCapacity(temp_alloc, 8) catch unreachable;
    defer files.deinit();

    {
        dev.graph_safety_lock.lock();
        defer dev.graph_safety_lock.unlock();

        inline for (.{ &dev.server_graph, &dev.client_graph }) |g| {
            g.invalidate(changed_file_paths, &files) catch bun.outOfMemory();
        }
    }

    if (files.items.len == 0) {
        Output.debugWarn("nothing to bundle?? this is a bug?", .{});
        return;
    }

    dev.incremental_result.reset();

    var fail: Failure = undefined;
    const bundle = dev.theRealBundlingFunction(
        files.items,
        null,
        .hmr_chunk,
        &fail,
    ) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());
        fail.printToConsole(&dev.routes[0]);
        return;
    };

    if (dev.incremental_result.routes_affected.items.len > 0) {
        var sfb2 = std.heap.stackFallback(4096, bun.default_allocator);
        var payload = std.ArrayList(u8).initCapacity(sfb2.get(), 4096) catch
            unreachable; // enough space
        defer payload.deinit();
        payload.appendAssumeCapacity('R');
        const w = payload.writer();
        try w.writeInt(u32, @intCast(dev.incremental_result.routes_affected.items.len), .little);

        for (dev.incremental_result.routes_affected.items) |route| {
            try w.writeInt(u32, route.get(), .little);
            const pattern = dev.routes[route.get()].pattern;
            try w.writeInt(u16, @intCast(pattern.len), .little);
            try w.writeAll(pattern);
        }

        _ = dev.app.publish("*", payload.items, .binary, true);
    }

    _ = bundle; // already sent to client
}

pub const HotReloadTask = struct {
    const Aligned = struct { aligned: HotReloadTask align(std.atomic.cache_line) };

    dev: *DevServer,
    concurrent_task: JSC.ConcurrentTask = undefined,

    files: bun.StringArrayHashMapUnmanaged(Watcher.Event.Op),

    /// I am sorry.
    state: std.atomic.Value(u32),

    pub fn initEmpty(dev: *DevServer) HotReloadTask {
        return .{
            .dev = dev,
            .files = .{},
            .state = .{ .raw = 0 },
        };
    }

    pub fn append(
        task: *HotReloadTask,
        allocator: Allocator,
        file_path: []const u8,
        op: Watcher.Event.Op,
    ) void {
        const gop = task.files.getOrPut(allocator, file_path) catch bun.outOfMemory();
        if (gop.found_existing) {
            gop.value_ptr.* = gop.value_ptr.merge(op);
        } else {
            gop.value_ptr.* = op;
        }
    }

    pub fn run(initial: *HotReloadTask) void {
        debug.log("HMR Task start", .{});
        defer debug.log("HMR Task end", .{});

        // TODO: audit the atomics with this reloading strategy
        // It was not written by an expert.

        const dev = initial.dev;
        if (Environment.allow_assert) {
            assert(initial.state.load(.seq_cst) == 0);
        }

        // const start_timestamp = std.time.nanoTimestamp();
        dev.reload(initial) catch bun.outOfMemory();

        // if there was a pending run, do it now
        if (dev.watch_state.swap(0, .seq_cst) > 1) {
            // debug.log("dual event fire", .{});
            const current = if (initial == &dev.watch_events[0].aligned)
                &dev.watch_events[1].aligned
            else
                &dev.watch_events[0].aligned;
            if (current.state.swap(1, .seq_cst) == 0) {
                // debug.log("case 1 (run now)", .{});
                dev.reload(current) catch bun.outOfMemory();
                current.state.store(0, .seq_cst);
            } else {
                // Watcher will emit an event since it reads watch_state 0
                // debug.log("case 2 (run later)", .{});
            }
        }
    }
};

/// Called on watcher's thread; Access to dev-server state restricted.
pub fn onFileUpdate(dev: *DevServer, events: []Watcher.Event, changed_files: []?[:0]u8, watchlist: Watcher.ItemList) void {
    debug.log("onFileUpdate start", .{});
    defer debug.log("onFileUpdate end", .{});

    _ = changed_files;
    const slice = watchlist.slice();
    const file_paths = slice.items(.file_path);
    const counts = slice.items(.count);
    const kinds = slice.items(.kind);

    // TODO: audit the atomics with this reloading strategy
    // It was not written by an expert.

    // Get a Hot reload task pointer
    var ev: *HotReloadTask = &dev.watch_events[dev.watch_current].aligned;
    if (ev.state.swap(1, .seq_cst) == 1) {
        debug.log("work got stolen, must guarantee the other is free", .{});
        dev.watch_current +%= 1;
        ev = &dev.watch_events[dev.watch_current].aligned;
        bun.assert(ev.state.swap(1, .seq_cst) == 0);
    }
    defer {
        // Submit the Hot reload task for bundling
        if (ev.files.entries.len > 0) {
            const prev_state = dev.watch_state.fetchAdd(1, .seq_cst);
            ev.state.store(0, .seq_cst);
            debug.log("prev_state={d}", .{prev_state});
            if (prev_state == 0) {
                ev.concurrent_task = .{ .auto_delete = false, .next = null, .task = JSC.Task.init(ev) };
                dev.vm.event_loop.enqueueTaskConcurrent(&ev.concurrent_task);
                dev.watch_current +%= 1;
            } else {
                // DevServer thread is notified.
            }
        } else {
            ev.state.store(0, .seq_cst);
        }
    }

    defer dev.bun_watcher.flushEvictions();

    // TODO: alot of code is missing
    // TODO: story for busting resolution cache smartly?
    for (events) |event| {
        const file_path = file_paths[event.index];
        const update_count = counts[event.index] + 1;
        counts[event.index] = update_count;
        const kind = kinds[event.index];

        debug.log("{s} change: {s} {}", .{ @tagName(kind), file_path, event.op });

        switch (kind) {
            .file => {
                if (event.op.delete or event.op.rename) {
                    dev.bun_watcher.removeAtIndex(event.index, 0, &.{}, .file);
                }

                ev.append(dev.allocator, file_path, event.op);
            },
            .directory => {
                // bust the directory cache since this directory has changed
                _ = dev.server_bundler.resolver.bustDirCache(file_path);

                // if a directory watch exists for resolution
                // failures, check those now.
                dev.directory_watchers.lock.lock();
                defer dev.directory_watchers.lock.unlock();
                if (dev.directory_watchers.watches.getIndex(file_path)) |watcher_index| {
                    const entry = &dev.directory_watchers.watches.values()[watcher_index];
                    var new_chain: DirectoryWatchStore.Dep.Index.Optional = .none;
                    var it: ?DirectoryWatchStore.Dep.Index = entry.first_dep;

                    while (it) |index| {
                        const dep = &dev.directory_watchers.dependencies.items[index.get()];
                        it = dep.next.unwrap();
                        if ((dev.server_bundler.resolver.resolve(
                            bun.path.dirname(dep.source_file_path, .auto),
                            dep.specifier,
                            .stmt,
                        ) catch null) != null) {
                            // the resolution result is not preserved as safely
                            // transferring it into BundleV2 is too complicated. the
                            // resolution is cached, anyways.
                            ev.append(dev.allocator, dep.source_file_path, .{ .write = true });
                            dev.directory_watchers.freeDependencyIndex(dev.allocator, index) catch bun.outOfMemory();
                        } else {
                            // rebuild a new linked list for unaffected files
                            dep.next = new_chain;
                            new_chain = index.toOptional();
                        }
                    }

                    if (new_chain.unwrap()) |new_first_dep| {
                        entry.first_dep = new_first_dep;
                    } else {
                        // without any files to depend on this watcher is freed
                        dev.directory_watchers.freeEntry(watcher_index);
                    }
                }
            },
        }
    }
}

pub fn onWatchError(_: *DevServer, err: bun.sys.Error) void {
    // TODO: how to recover? the watcher can't just ... crash????????
    Output.err(@as(bun.C.E, @enumFromInt(err.errno)), "Watcher crashed", .{});
    if (bun.Environment.isDebug) {
        bun.todoPanic(@src(), "Watcher crash", .{});
    }
}

/// TODO: deprecated
pub fn bustDirCache(dev: *DevServer, path: []const u8) bool {
    debug.log("bustDirCache {s}\n", .{path});
    const server = dev.server_bundler.resolver.bustDirCache(path);
    const client = dev.client_bundler.resolver.bustDirCache(path);
    const ssr = dev.ssr_bundler.resolver.bustDirCache(path);
    return server or client or ssr;
}

/// TODO: deprecated
pub fn getLoaders(dev: *DevServer) *bun.options.Loader.HashTable {
    // The watcher needs to know what loader to use for a file,
    // therefore, we must ensure that server and client options
    // use the same loader set.
    return &dev.server_bundler.options.loaders;
}

const std = @import("std");
const Allocator = std.mem.Allocator;
const Mutex = std.Thread.Mutex;
const ArrayListUnmanaged = std.ArrayListUnmanaged;
const AutoArrayHashMapUnmanaged = std.AutoArrayHashMapUnmanaged;

const bun = @import("root").bun;
const Environment = bun.Environment;
const assert = bun.assert;
const DynamicBitSetUnmanaged = bun.bit_set.DynamicBitSetUnmanaged;

const bake = bun.bake;

const Log = bun.logger.Log;
const Output = bun.Output;

const Bundler = bun.bundler.Bundler;
const BundleV2 = bun.bundle_v2.BundleV2;
const BakeEntryPoint = bun.bundle_v2.BakeEntryPoint;

const Define = bun.options.Define;
const OutputFile = bun.options.OutputFile;

const uws = bun.uws;
const App = uws.NewApp(false);
const AnyWebSocket = uws.AnyWebSocket;
const Request = uws.Request;
const Response = App.Response;

const MimeType = bun.http.MimeType;

const JSC = bun.JSC;
const Watcher = bun.JSC.Watcher;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;
const JSModuleLoader = JSC.JSModuleLoader;
const EventLoopHandle = JSC.EventLoopHandle;
const JSInternalPromise = JSC.JSInternalPromise;

const StringPointer = bun.Schema.Api.StringPointer;

const ThreadlocalArena = @import("../mimalloc_arena.zig").Arena;
