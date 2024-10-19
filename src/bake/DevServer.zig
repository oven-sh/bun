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
/// across all loaded modules.
/// (Request, Id, Meta) => Response
server_fetch_function_callback: JSC.Strong,
/// (modules: any, clientComponentsAdd: null|string[], clientComponentsRemove: null|string[]) => Promise<null|[string, any][]>
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
bundles_since_last_error: usize = 0,
/// All access into IncrementalGraph is guarded by this. This is only
/// a debug assertion since there is no actual contention.
graph_safety_lock: bun.DebugThreadLock,
client_graph: IncrementalGraph(.client),
server_graph: IncrementalGraph(.server),
/// All bundling failures are stored until a file is saved and rebuilt.
/// They are stored in the wire format the HMR runtime expects so that
/// serialization only happens once.
bundling_failures: std.ArrayHashMapUnmanaged(
    SerializedFailure,
    void,
    SerializedFailure.ArrayHashContextViaOwner,
    false,
) = .{},
/// Quickly retrieve a route's index from the entry point file.
route_lookup: AutoArrayHashMapUnmanaged(IncrementalGraph(.server).FileIndex, Route.Index),
/// State populated during bundling. Often cleared
incremental_result: IncrementalResult,
framework: bake.Framework,
// Each logical graph gets it's own bundler configuration
server_bundler: Bundler,
client_bundler: Bundler,
ssr_bundler: Bundler,
/// Stored and reused for bundling tasks
log: Log,

// Debugging
dump_dir: ?std.fs.Dir,
emit_visualizer_events: u32,

pub const internal_prefix = "/_bun";
pub const client_prefix = internal_prefix ++ "/client";

pub const Route = struct {
    pub const Index = bun.GenericIndex(u30, Route);

    // Config
    pattern: [:0]const u8,
    entry_point: []const u8,

    server_state: State = .unqueued,
    /// Cached to avoid looking up by filename in `server_graph`
    server_file: IncrementalGraph(.server).FileIndex.Optional = .none,
    /// Generated lazily when the client JS is requested (HTTP GET /_bun/client/*.js),
    /// which is only needed when a hard-reload is performed.
    ///
    /// Freed when a client module updates.
    client_bundle: ?[]const u8 = null,
    /// Contain the list of serialized failures. Hashmap allows for
    /// efficient lookup and removal of failing files.
    /// When state == .evaluation_failure, this is popualted with that error.
    evaluate_failure: ?SerializedFailure = null,

    /// Cached to avoid re-creating the string every request
    module_name_string: JSC.Strong = .{},

    /// Assigned in DevServer.init
    dev: *DevServer = undefined,
    client_bundled_url: []u8 = undefined,

    /// A union is not used so that `bundler_failure_logs` can re-use memory, as
    /// this state frequently changes between `loaded` and the failure variants.
    const State = enum {
        /// In development mode, routes are lazily built. This state implies a
        /// build of this route has never been run. It is possible to bundle the
        /// route entry point and still have an unqueued route if another route
        /// imports this one.
        unqueued,
        /// This route was flagged for bundling failures. There are edge cases
        /// where a route can be disconnected from it's failures, so the route
        /// imports has to be traced to discover if possible failures still
        /// exist.
        possible_bundling_failures,
        /// Loading the module at runtime had a failure.
        evaluation_failure,
        /// Calling the request function may error, but that error will not be
        /// at fault of bundling.
        loaded,
    };

    pub fn clientPublicPath(route: *const Route) []const u8 {
        return route.client_bundled_url[0 .. route.client_bundled_url.len - "/client.js".len];
    }
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

    const app = App.create(.{}) orelse {
        Output.prettyErrorln("Failed to create app", .{});
        return error.AppInitialization;
    };

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
        .emit_visualizer_events = 0,

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
        app.any(route.pattern, *Route, route, onServerRequest);

        route.dev = dev;
        route.client_bundled_url = std.fmt.allocPrint(
            allocator,
            client_prefix ++ "/{d}/client.js",
            .{i},
        ) catch bun.outOfMemory();

        if (bun.strings.eqlComptime(route.pattern, "/*"))
            has_fallback = true;
    }

    app.get(client_prefix ++ "/:route/:asset", *DevServer, dev, onAssetRequest);

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

    // Some indices at the start of the graph are reserved for framework files.
    {
        dev.graph_safety_lock.lock();
        defer dev.graph_safety_lock.unlock();

        assert(try dev.client_graph.insertStale(dev.framework.entry_client, false) == IncrementalGraph(.client).framework_entry_point_index);
        assert(try dev.server_graph.insertStale(dev.framework.entry_server, false) == IncrementalGraph(.server).framework_entry_point_index);

        if (dev.framework.react_fast_refresh) |rfr| {
            assert(try dev.client_graph.insertStale(rfr.import_source, false) == IncrementalGraph(.client).react_refresh_index);
        }

        try dev.client_graph.ensureStaleBitCapacity(true);
        try dev.server_graph.ensureStaleBitCapacity(true);

        const client_files = dev.client_graph.bundled_files.values();
        client_files[IncrementalGraph(.client).framework_entry_point_index.get()].flags.is_special_framework_file = true;
    }

    // Pre-bundle the framework code
    {
        // Since this will enter JavaScript to load code, ensure we have a lock.
        const lock = dev.vm.jsc.getAPILock();
        defer lock.release();

        dev.bundle(&.{
            BakeEntryPoint.init(dev.framework.entry_server, .server),
            BakeEntryPoint.init(dev.framework.entry_client, .client),
        }) catch |err| {
            _ = &err; // autofix
            bun.todoPanic(@src(), "handle error", .{});
        };
    }

    return dev;
}

fn deinit(dev: *DevServer) void {
    const allocator = dev.allocator;
    allocator.destroy(dev);
    bun.todoPanic(@src(), "bake.DevServer.deinit()");
}

fn initBundler(dev: *DevServer, bundler: *Bundler, comptime renderer: bake.Graph) !void {
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

    bundler.options.experimental_css = true;

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

fn onAssetRequest(dev: *DevServer, req: *Request, resp: *Response) void {
    const route = route: {
        const route_id = req.parameter(0);
        const i = std.fmt.parseInt(u16, route_id, 10) catch
            return req.setYield(true);
        if (i >= dev.routes.len)
            return req.setYield(true);
        break :route &dev.routes[i];
    };

    const js_source = route.client_bundle orelse code: {
        if (route.server_state == .unqueued) {
            dev.bundleRouteFirstTime(route);
        }

        switch (route.server_state) {
            .unqueued => bun.assertWithLocation(false, @src()),
            .possible_bundling_failures => {
                if (dev.bundling_failures.count() > 0) {
                    resp.corked(sendSerializedFailures, .{
                        dev,
                        resp,
                        dev.bundling_failures.keys(),
                        .bundler,
                    });
                    return;
                } else {
                    route.server_state = .loaded;
                }
            },
            .evaluation_failure => {
                resp.corked(sendSerializedFailures, .{
                    dev,
                    resp,
                    &.{route.evaluate_failure orelse @panic("missing error")},
                    .evaluation,
                });
                return;
            },
            .loaded => {},
        }

        // TODO: there can be stale files in this if you request an asset after
        // a watch but before the bundle task starts.

        const out = dev.generateClientBundle(route) catch bun.outOfMemory();
        route.client_bundle = out;
        break :code out;
    };
    sendJavaScriptSource(js_source, resp);
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

/// `route.server_state` must be `.unenqueued`
fn bundleRouteFirstTime(dev: *DevServer, route: *Route) void {
    if (Environment.allow_assert) switch (route.server_state) {
        .unqueued => {},
        .possible_bundling_failures => unreachable, // should watch affected files and bundle on save
        .evaluation_failure => unreachable, // bundling again wont fix this issue
        .loaded => unreachable, // should not be bundling since it already passed
    };

    if (dev.bundle(&.{
        BakeEntryPoint.route(
            route.entry_point,
            Route.Index.init(@intCast(bun.indexOfPointerInSlice(Route, dev.routes, route))),
        ),
    })) |_| {
        route.server_state = .loaded;
    } else |err| switch (err) {
        error.OutOfMemory => bun.outOfMemory(),
        error.BuildFailed => assert(route.server_state == .possible_bundling_failures),
        error.ServerLoadFailed => route.server_state = .evaluation_failure,
    }
}

fn onServerRequest(route: *Route, req: *Request, resp: *Response) void {
    const dev = route.dev;

    if (route.server_state == .unqueued) {
        dev.bundleRouteFirstTime(route);
    }

    switch (route.server_state) {
        .unqueued => bun.assertWithLocation(false, @src()),
        .possible_bundling_failures => {
            // TODO: perform a graph trace to find just the errors that are needed
            if (dev.bundling_failures.count() > 0) {
                resp.corked(sendSerializedFailures, .{
                    dev,
                    resp,
                    dev.bundling_failures.keys(),
                    .bundler,
                });
                return;
            } else {
                route.server_state = .loaded;
            }
        },
        .evaluation_failure => {
            resp.corked(sendSerializedFailures, .{
                dev,
                resp,
                (&(route.evaluate_failure orelse @panic("missing error")))[0..1],
                .evaluation,
            });
            return;
        },
        .loaded => {},
    }

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
            route.module_name_string.get() orelse str: {
                const js = bun.String.createUTF8(
                    bun.path.relative(dev.cwd, route.entry_point),
                ).toJS(dev.server_global.js());
                route.module_name_string = JSC.Strong.create(js, dev.server_global.js());
                break :str js;
            },
        },
    ) catch |err| {
        const exception = global.takeException(err);
        dev.vm.printErrorLikeObjectToConsole(exception);
        // const fail = try SerializedFailure.initFromJs(.none, exception);
        // defer fail.deinit();
        // dev.sendSerializedFailures(resp, &.{fail}, .runtime);
        dev.sendStubErrorMessage(route, resp, exception);
        return;
    };

    if (result.asAnyPromise()) |promise| {
        dev.vm.waitForPromise(promise);
        switch (promise.unwrap(dev.vm.jsc, .mark_handled)) {
            .pending => unreachable, // was waited for
            .fulfilled => |r| result = r,
            .rejected => |exception| {
                dev.vm.printErrorLikeObjectToConsole(exception);
                dev.sendStubErrorMessage(route, resp, exception);
                // const fail = try SerializedFailure.initFromJs(.none, e);
                // defer fail.deinit();
                // dev.sendSerializedFailures(resp, &.{fail}, .runtime);
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

const BundleError = error{
    OutOfMemory,
    /// Graph entry points will be annotated with failures to display.
    BuildFailed,

    ServerLoadFailed,
};

fn bundle(dev: *DevServer, files: []const BakeEntryPoint) BundleError!void {
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

    dev.client_graph.reset();
    dev.server_graph.reset();

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

            switch (target.bakeGraph()) {
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

    const chunk = bv2.runFromBakeDevServer(files) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());

        bv2.bundler.log.printForLogLevel(Output.errorWriter()) catch {};

        Output.warn("BundleV2.runFromBakeDevServer returned error.{s}", .{@errorName(err)});

        return;
    };

    bv2.bundler.log.printForLogLevel(Output.errorWriter()) catch {};

    try dev.finalizeBundle(bv2, &chunk);

    try dev.client_graph.ensureStaleBitCapacity(false);
    try dev.server_graph.ensureStaleBitCapacity(false);

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

    if (dev.server_graph.current_chunk_len > 0) {
        const server_bundle = try dev.server_graph.takeBundle(if (is_first_server_chunk) .initial_response else .hmr_chunk);
        defer dev.allocator.free(server_bundle);

        if (is_first_server_chunk) {
            const server_code = c.BakeLoadInitialServerCode(dev.server_global, bun.String.createLatin1(server_bundle)) catch |err| {
                dev.vm.printErrorLikeObjectToConsole(dev.server_global.js().takeException(err));
                {
                    // TODO: document the technical reasons this should not be allowed to fail
                    bun.todoPanic(@src(), "First Server Load Fails. This should become a bundler bug.", .{});
                }
                _ = &err; // autofix
                // fail.* = Failure.fromJSServerLoad(dev.server_global.js().takeException(err), dev.server_global.js());
                return error.ServerLoadFailed;
            };
            dev.vm.waitForPromise(.{ .internal = server_code.promise });

            switch (server_code.promise.unwrap(dev.vm.jsc, .mark_handled)) {
                .pending => unreachable, // promise is settled
                .rejected => |err| {
                    dev.vm.printErrorLikeObjectToConsole(err);
                    {
                        bun.todoPanic(@src(), "First Server Load Fails. This should become a bundler bug.", .{});
                    }
                    _ = &err; // autofix
                    // fail.* = Failure.fromJSServerLoad(err, dev.server_global.js());
                    return error.ServerLoadFailed;
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
            const server_modules = c.BakeLoadServerHmrPatch(dev.server_global, bun.String.createLatin1(server_bundle)) catch |err| {
                // No user code has been evaluated yet, since everything is to
                // be wrapped in a function clousure. This means that the likely
                // error is going to be a syntax error, or other mistake in the
                // bundler.
                dev.vm.printErrorLikeObjectToConsole(dev.server_global.js().takeException(err));
                @panic("Error thrown while evaluating server code. This is always a bug in the bundler.");
            };
            const errors = dev.server_register_update_callback.get().?.call(
                dev.server_global.js(),
                dev.server_global.js().toJSValue(),
                &.{
                    server_modules,
                    dev.makeArrayForServerComponentsPatch(dev.server_global.js(), dev.incremental_result.client_components_added.items),
                    dev.makeArrayForServerComponentsPatch(dev.server_global.js(), dev.incremental_result.client_components_removed.items),
                },
            ) catch |err| {
                // One module replacement error should NOT prevent follow-up
                // module replacements to fail. It is the HMR runtime's
                // responsibility to collect all module load errors, and
                // bubble them up.
                dev.vm.printErrorLikeObjectToConsole(dev.server_global.js().takeException(err));
                @panic("Error thrown in Hot-module-replacement code. This is always a bug in the HMR runtime.");
            };
            _ = errors; // TODO:
        }
    }

    if (dev.incremental_result.failures_added.items.len > 0) {
        dev.bundles_since_last_error = 0;
        return error.BuildFailed;
    }
}

fn indexFailures(dev: *DevServer) !void {
    var sfa_state = std.heap.stackFallback(65536, dev.allocator);
    const sfa = sfa_state.get();

    if (dev.incremental_result.failures_added.items.len > 0) {
        var total_len: usize = @sizeOf(MessageId) + @sizeOf(u32);

        for (dev.incremental_result.failures_added.items) |fail| {
            total_len += fail.data.len;
        }

        total_len += dev.incremental_result.failures_removed.items.len * @sizeOf(u32);

        dev.server_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(sfa, dev.server_graph.bundled_files.count());
        defer dev.server_graph.affected_by_trace.deinit(sfa);

        dev.client_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(sfa, dev.client_graph.bundled_files.count());
        defer dev.client_graph.affected_by_trace.deinit(sfa);

        var payload = try std.ArrayList(u8).initCapacity(sfa, total_len);
        defer payload.deinit();
        payload.appendAssumeCapacity(MessageId.errors.char());
        const w = payload.writer();

        try w.writeInt(u32, @intCast(dev.incremental_result.failures_removed.items.len), .little);

        for (dev.incremental_result.failures_removed.items) |removed| {
            try w.writeInt(u32, @bitCast(removed.getOwner().encode()), .little);
            removed.deinit();
        }

        for (dev.incremental_result.failures_added.items) |added| {
            try w.writeAll(added.data);

            switch (added.getOwner()) {
                .none, .route => unreachable,
                .server => |index| try dev.server_graph.traceDependencies(index, .no_stop),
                .client => |index| try dev.client_graph.traceDependencies(index, .no_stop),
            }
        }

        for (dev.incremental_result.routes_affected.items) |route_index| {
            const route = &dev.routes[route_index.get()];
            route.server_state = .possible_bundling_failures;
        }

        _ = dev.app.publish(DevWebSocket.global_channel, payload.items, .binary, false);
    } else if (dev.incremental_result.failures_removed.items.len > 0) {
        if (dev.bundling_failures.count() == 0) {
            _ = dev.app.publish(DevWebSocket.global_channel, &.{MessageId.errors_cleared.char()}, .binary, false);
            for (dev.incremental_result.failures_removed.items) |removed| {
                removed.deinit();
            }
        } else {
            var payload = try std.ArrayList(u8).initCapacity(sfa, @sizeOf(MessageId) + @sizeOf(u32) + dev.incremental_result.failures_removed.items.len * @sizeOf(u32));
            defer payload.deinit();
            payload.appendAssumeCapacity(MessageId.errors.char());
            const w = payload.writer();

            try w.writeInt(u32, @intCast(dev.incremental_result.failures_removed.items.len), .little);

            for (dev.incremental_result.failures_removed.items) |removed| {
                try w.writeInt(u32, @bitCast(removed.getOwner().encode()), .little);
                removed.deinit();
            }

            _ = dev.app.publish(DevWebSocket.global_channel, payload.items, .binary, false);
        }
    }

    dev.incremental_result.failures_removed.clearRetainingCapacity();
}

/// Used to generate the entry point. Unlike incremental patches, this always
/// contains all needed files for a route.
fn generateClientBundle(dev: *DevServer, route: *Route) bun.OOM![]const u8 {
    assert(route.client_bundle == null);
    assert(route.server_state == .loaded); // page is unfit to load

    dev.graph_safety_lock.lock();
    defer dev.graph_safety_lock.unlock();

    // Prepare bitsets
    var sfa_state = std.heap.stackFallback(65536, dev.allocator);

    const sfa = sfa_state.get();
    dev.server_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(sfa, dev.server_graph.bundled_files.count());
    defer dev.server_graph.affected_by_trace.deinit(sfa);

    dev.client_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(sfa, dev.client_graph.bundled_files.count());
    defer dev.client_graph.affected_by_trace.deinit(sfa);

    // Run tracing
    dev.client_graph.reset();

    // Framework entry point is always needed.
    try dev.client_graph.traceImports(IncrementalGraph(.client).framework_entry_point_index);

    // If react fast refresh is enabled, it will be imported by the runtime instantly.
    if (dev.framework.react_fast_refresh != null) {
        try dev.client_graph.traceImports(IncrementalGraph(.client).react_refresh_index);
    }

    // Trace the route to the client components
    try dev.server_graph.traceImports(
        route.server_file.unwrap() orelse
            Output.panic("File index for route not present", .{}),
    );

    return dev.client_graph.takeBundle(.initial_response);
}

fn makeArrayForServerComponentsPatch(dev: *DevServer, global: *JSC.JSGlobalObject, items: []const IncrementalGraph(.server).FileIndex) JSValue {
    if (items.len == 0) return .null;
    const arr = JSC.JSArray.createEmpty(global, items.len);
    const names = dev.server_graph.bundled_files.keys();
    for (items, 0..) |item, i| {
        const str = bun.String.createUTF8(bun.path.relative(dev.cwd, names[item.get()]));
        defer str.deref();
        arr.putIndex(global, @intCast(i), str.toJS(global));
    }
    return arr;
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
    bv2: *bun.bundle_v2.BundleV2,
    chunk: *const [2]bun.bundle_v2.Chunk,
) !void {
    const input_file_sources = bv2.graph.input_files.items(.source);
    const import_records = bv2.graph.ast.items(.import_records);
    const targets = bv2.graph.ast.items(.target);
    const scbs = bv2.graph.server_component_boundaries.slice();

    var sfa = std.heap.stackFallback(4096, bv2.graph.allocator);
    const stack_alloc = sfa.get();
    var scb_bitset = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(stack_alloc, input_file_sources.len);
    for (
        scbs.list.items(.source_index),
        scbs.list.items(.ssr_source_index),
        scbs.list.items(.reference_source_index),
    ) |source_index, ssr_index, ref_index| {
        scb_bitset.set(source_index);
        scb_bitset.set(ssr_index);
        scb_bitset.set(ref_index);
    }

    const resolved_index_cache = try bv2.graph.allocator.alloc(u32, input_file_sources.len * 2);

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
        chunk[0].content.javascript.parts_in_chunk_in_order,
        chunk[0].compile_results_for_chunk,
    ) |part_range, compile_result| {
        try dev.receiveChunk(
            &ctx,
            part_range.source_index,
            targets[part_range.source_index.get()].bakeGraph(),
            compile_result,
        );
    }

    _ = chunk[1].content.css; // TODO: Index CSS files

    dev.client_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(bv2.graph.allocator, dev.client_graph.bundled_files.count());
    defer dev.client_graph.affected_by_trace = .{};
    dev.server_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(bv2.graph.allocator, dev.server_graph.bundled_files.count());
    defer dev.client_graph.affected_by_trace = .{};

    ctx.server_seen_bit_set = try bun.bit_set.DynamicBitSetUnmanaged.initEmpty(bv2.graph.allocator, dev.server_graph.bundled_files.count());

    // Pass 2, update the graph's edges by performing import diffing on each
    // changed file, removing dependencies. This pass also flags what routes
    // have been modified.
    for (chunk[0].content.javascript.parts_in_chunk_in_order) |part_range| {
        try dev.processChunkDependencies(
            &ctx,
            part_range.source_index,
            targets[part_range.source_index.get()].bakeGraph(),
            bv2.graph.allocator,
        );
    }

    // Index all failed files now that the incremental graph has been updated.
    try dev.indexFailures();
}

pub fn handleParseTaskFailure(
    dev: *DevServer,
    graph: bake.Graph,
    abs_path: []const u8,
    log: *Log,
) bun.OOM!void {
    // Print each error only once
    Output.prettyErrorln("<red><b>Errors while bundling '{s}':<r>", .{
        bun.path.relative(dev.cwd, abs_path),
    });
    Output.flush();
    log.printForLogLevel(Output.errorWriter()) catch {};

    return switch (graph) {
        .server => dev.server_graph.insertFailure(abs_path, log, false),
        .ssr => dev.server_graph.insertFailure(abs_path, log, true),
        .client => dev.client_graph.insertFailure(abs_path, log, false),
    };
}

pub fn receiveChunk(
    dev: *DevServer,
    ctx: *HotUpdateContext,
    index: bun.JSAst.Index,
    side: bake.Graph,
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
    side: bake.Graph,
    temp_alloc: Allocator,
) !void {
    return switch (side) {
        .server, .ssr => dev.server_graph.processChunkDependencies(ctx, index, temp_alloc),
        .client => dev.client_graph.processChunkDependencies(ctx, index, temp_alloc),
    };
}

pub fn isFileStale(dev: *DevServer, path: []const u8, side: bake.Graph) bool {
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

fn onFallbackRoute(_: void, _: *Request, resp: *Response) void {
    sendBuiltInNotFound(resp);
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

const ErrorPageKind = enum {
    /// Modules failed to bundle
    bundler,
    /// Modules failed to evaluate
    evaluation,
    /// Request handler threw
    runtime,
};

fn sendSerializedFailures(
    dev: *DevServer,
    resp: *Response,
    failures: []const SerializedFailure,
    kind: ErrorPageKind,
) void {
    resp.writeStatus("500 Internal Server Error");
    resp.writeHeader("Content-Type", MimeType.html.value);

    // TODO: what to do about return values here?
    _ = resp.write(switch (kind) {
        inline else => |k| std.fmt.comptimePrint(
            \\<!doctype html>
            \\<html lang="en">
            \\<head>
            \\<meta charset="UTF-8" />
            \\<meta name="viewport" content="width=device-width, initial-scale=1.0" />
            \\<title>Bun - {[page_title]s}</title>
            \\<style>:root{{color-scheme:light dark}}body{{background:light-dark(white,black)}}</style>
            \\</head>
            \\<body>
            \\<noscript><p style="font:24px sans-serif;">Bun requires JavaScript enabled in the browser to receive hot reloading events.</p></noscript>
            \\<script>let error=Uint8Array.from(atob("
        ,
            .{ .page_title = switch (k) {
                .bundler => "Bundling Error",
                .evaluation, .runtime => "Runtime Error",
            } },
        ),
    });

    var sfb = std.heap.stackFallback(65536, dev.allocator);
    var arena_state = std.heap.ArenaAllocator.init(sfb.get());
    defer arena_state.deinit();

    for (failures) |fail| {
        // TODO: make this entirely use stack memory.
        const len = bun.base64.encodeLen(fail.data);
        const buf = arena_state.allocator().alloc(u8, len) catch bun.outOfMemory();
        const encoded = buf[0..bun.base64.encode(buf, fail.data)];
        _ = resp.write(encoded);

        _ = arena_state.reset(.retain_capacity);
    }

    const pre = "\"),c=>c.charCodeAt(0));";
    const post = "</script></body></html>";

    if (Environment.codegen_embed) {
        _ = resp.end(pre ++ @embedFile("bake-codegen/bake.error.js") ++ post, false);
    } else {
        _ = resp.write(pre);
        _ = resp.write(bun.runtimeEmbedFile(.codegen_eager, "bake.error.js"));
        _ = resp.end(post, false);
    }
}

fn sendBuiltInNotFound(resp: *Response) void {
    const message = "404 Not Found";
    resp.writeStatus("404 Not Found");
    resp.end(message, true);
}

fn sendStubErrorMessage(dev: *DevServer, route: *Route, resp: *Response, err: JSValue) void {
    var sfb = std.heap.stackFallback(65536, dev.allocator);
    var a = std.ArrayList(u8).initCapacity(sfb.get(), 65536) catch bun.outOfMemory();

    a.writer().print("Server route handler for '{s}' threw while loading\n\n", .{
        route.pattern,
    }) catch bun.outOfMemory();
    route.dev.vm.printErrorLikeObjectSimple(err, a.writer(), false);

    resp.writeStatus("500 Internal Server Error");
    resp.end(a.items, true); // TODO: "You should never call res.end(huge buffer)"
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
        affected_by_trace: DynamicBitSetUnmanaged,

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

            .affected_by_trace = .{},

            .current_chunk_len = 0,
            .current_chunk_parts = .{},
        };

        pub const File = switch (side) {
            // The server's incremental graph does not store previously bundled
            // code because there is only one instance of the server. Instead,
            // it stores which module graphs it is a part of. This makes sure
            // that recompilation knows what bundler options to use.
            .server => struct { // TODO: make this packed(u8), i had compiler crashes before
                /// Is this file built for the Server graph.
                is_rsc: bool,
                /// Is this file built for the SSR graph.
                is_ssr: bool,
                /// If set, the client graph contains a matching file.
                /// The server
                is_client_component_boundary: bool,
                /// If this file is a route root, the route can be looked up in
                /// the route list. This also stops dependency propagation.
                is_route: bool,
                /// If the file has an error, the failure can be looked up
                /// in the `.failures` map.
                failed: bool,

                unused: enum(u2) { unused = 0 } = .unused,

                fn stopsDependencyTrace(flags: @This()) bool {
                    return flags.is_client_component_boundary;
                }
            },
            .client => struct {
                /// Allocated by default_allocator. Access with `.code()`
                code_ptr: [*]const u8,
                /// Separated from the pointer to reduce struct size.
                /// Parser does not support files >4gb anyways.
                code_len: u32,
                flags: Flags,

                const Flags = struct {
                    /// If the file has an error, the failure can be looked up
                    /// in the `.failures` map.
                    failed: bool,
                    /// If set, the client graph contains a matching file.
                    is_component_root: bool,
                    /// This is a file is an entry point to the framework.
                    /// Changing this will always cause a full page reload.
                    is_special_framework_file: bool,

                    kind: enum { js, css },
                };

                comptime {
                    assert(@sizeOf(@This()) == @sizeOf(usize) * 2);
                    assert(@alignOf(@This()) == @alignOf([*]u8));
                }

                fn init(code_slice: []const u8, flags: Flags) @This() {
                    return .{
                        .code_ptr = code_slice.ptr,
                        .code_len = @intCast(code_slice.len),
                        .flags = flags,
                    };
                }

                fn code(file: @This()) []const u8 {
                    return file.code_ptr[0..file.code_len];
                }

                inline fn stopsDependencyTrace(_: @This()) bool {
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

        /// An index into `bundled_files`, `stale_files`, `first_dep`, `first_import`, or `affected_by_trace`
        /// Top bits cannot be relied on due to `SerializedFailure.Owner.Packed`
        pub const FileIndex = bun.GenericIndex(u30, File);
        pub const framework_entry_point_index = FileIndex.init(0);
        pub const react_refresh_index = if (side == .client) FileIndex.init(1);

        /// An index into `edges`
        const EdgeIndex = bun.GenericIndex(u32, Edge);

        fn getFileIndex(g: *@This(), path: []const u8) ?FileIndex {
            return if (g.bundled_files.getIndex(path)) |i| FileIndex.init(@intCast(i)) else null;
        }

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
            ctx: *HotUpdateContext,
            index: bun.JSAst.Index,
            chunk: bun.bundle_v2.CompileResult,
            is_ssr_graph: bool,
        ) !void {
            const dev = g.owner();
            dev.graph_safety_lock.assertLocked();

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

            if (dev.dump_dir) |dump_dir| {
                const cwd = dev.cwd;
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

            const gop = try g.bundled_files.getOrPut(dev.allocator, abs_path);
            const file_index = FileIndex.init(@intCast(gop.index));

            if (!gop.found_existing) {
                gop.key_ptr.* = try bun.default_allocator.dupe(u8, abs_path);
                try g.first_dep.append(dev.allocator, .none);
                try g.first_import.append(dev.allocator, .none);
            }

            if (g.stale_files.bit_length > gop.index) {
                g.stale_files.unset(gop.index);
            }

            ctx.getCachedIndex(side, index).* = FileIndex.init(@intCast(gop.index));

            switch (side) {
                .client => {
                    if (gop.found_existing) {
                        bun.default_allocator.free(gop.value_ptr.code());

                        if (gop.value_ptr.flags.failed) {
                            const kv = dev.bundling_failures.fetchSwapRemoveAdapted(
                                SerializedFailure.Owner{ .client = file_index },
                                SerializedFailure.ArrayHashAdapter{},
                            ) orelse
                                Output.panic("Missing failure in IncrementalGraph", .{});
                            try dev.incremental_result.failures_removed.append(
                                dev.allocator,
                                kv.key,
                            );
                        }
                    }
                    gop.value_ptr.* = File.init(code, .{
                        .failed = false,
                        .is_component_root = ctx.server_to_client_bitset.isSet(index.get()),
                        .is_special_framework_file = false,
                        .kind = .js,
                    });
                    try g.current_chunk_parts.append(dev.allocator, file_index);
                },
                .server => {
                    if (!gop.found_existing) {
                        const client_component_boundary = ctx.server_to_client_bitset.isSet(index.get());

                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = false,
                            .is_client_component_boundary = client_component_boundary,
                            .failed = false,
                        };

                        if (client_component_boundary) {
                            try dev.incremental_result.client_components_added.append(dev.allocator, file_index);
                        }
                    } else {
                        if (is_ssr_graph) {
                            gop.value_ptr.is_ssr = true;
                        } else {
                            gop.value_ptr.is_rsc = true;
                        }

                        if (ctx.server_to_client_bitset.isSet(index.get())) {
                            gop.value_ptr.is_client_component_boundary = true;
                            try dev.incremental_result.client_components_added.append(dev.allocator, file_index);
                        } else if (gop.value_ptr.is_client_component_boundary) {
                            const client_graph = &g.owner().client_graph;
                            const client_index = client_graph.getFileIndex(gop.key_ptr.*) orelse
                                Output.panic("Client graph's SCB was already deleted", .{});
                            try dev.incremental_result.delete_client_files_later.append(g.owner().allocator, client_index);
                            gop.value_ptr.is_client_component_boundary = false;

                            try dev.incremental_result.client_components_removed.append(dev.allocator, file_index);
                        }

                        if (gop.value_ptr.failed) {
                            gop.value_ptr.failed = false;
                            const kv = dev.bundling_failures.fetchSwapRemoveAdapted(
                                SerializedFailure.Owner{ .server = file_index },
                                SerializedFailure.ArrayHashAdapter{},
                            ) orelse
                                Output.panic("Missing failure in IncrementalGraph", .{});
                            try dev.incremental_result.failures_removed.append(
                                dev.allocator,
                                kv.key,
                            );
                        }
                    }
                    try g.current_chunk_parts.append(dev.allocator, chunk.code());
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
                    g.disconnectEdgeFromDependencyList(val.edge_index);

                    // With no references to this edge, it can be freed
                    g.freeEdge(val.edge_index);
                }
            }

            if (side == .server) {
                // Follow this file to the route to mark it as stale.
                try g.traceDependencies(file_index, .stop_at_boundary);
            } else {
                // TODO: Follow this file to the HMR root (info to determine is currently not stored)
                // without this, changing a client-only file will not mark the route's client bundle as stale
            }
        }

        fn disconnectEdgeFromDependencyList(g: *@This(), edge_index: EdgeIndex) void {
            const edge = &g.edges.items[edge_index.get()];
            igLog("detach edge={d} | id={d} {} -> id={d} {}", .{
                edge_index.get(),
                edge.dependency.get(),
                bun.fmt.quote(g.bundled_files.keys()[edge.dependency.get()]),
                edge.imported.get(),
                bun.fmt.quote(g.bundled_files.keys()[edge.imported.get()]),
            });
            if (edge.prev_dependency.unwrap()) |prev| {
                const prev_dependency = &g.edges.items[prev.get()];
                prev_dependency.next_dependency = edge.next_dependency;
            } else {
                assert(g.first_dep.items[edge.imported.get()].unwrap() == edge_index);
                g.first_dep.items[edge.imported.get()] = .none;
            }
            if (edge.next_dependency.unwrap()) |next| {
                const next_dependency = &g.edges.items[next.get()];
                next_dependency.prev_dependency = edge.prev_dependency;
            }
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

        const TraceDependencyKind = enum {
            stop_at_boundary,
            no_stop,
        };

        fn traceDependencies(g: *@This(), file_index: FileIndex, trace_kind: TraceDependencyKind) !void {
            g.owner().graph_safety_lock.assertLocked();

            if (Environment.enable_logs) {
                igLog("traceDependencies(.{s}, {}{s})", .{
                    @tagName(side),
                    bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                    if (g.affected_by_trace.isSet(file_index.get())) " [already visited]" else "",
                });
            }

            if (g.affected_by_trace.isSet(file_index.get()))
                return;
            g.affected_by_trace.set(file_index.get());

            const file = g.bundled_files.values()[file_index.get()];

            switch (side) {
                .server => {
                    const dev = g.owner();
                    if (file.is_route) {
                        const route_index = dev.route_lookup.get(file_index) orelse
                            Output.panic("Route not in lookup index: {d} {}", .{ file_index.get(), bun.fmt.quote(g.bundled_files.keys()[file_index.get()]) });
                        igLog("\\<- Route", .{});

                        try dev.incremental_result.routes_affected.append(dev.allocator, route_index);
                    }
                    if (file.is_client_component_boundary) {
                        try dev.incremental_result.client_components_affected.append(dev.allocator, file_index);
                    }
                },
                .client => {
                    if (file.flags.is_component_root) {
                        const dev = g.owner();
                        const key = g.bundled_files.keys()[file_index.get()];
                        const index = dev.server_graph.getFileIndex(key) orelse
                            Output.panic("Server Incremental Graph is missing component for {}", .{bun.fmt.quote(key)});
                        try dev.server_graph.traceDependencies(index, trace_kind);
                    }
                },
            }

            // Certain files do not propagate updates to dependencies.
            // This is how updating a client component doesn't cause
            // a server-side reload.
            if (trace_kind == .stop_at_boundary) {
                if (file.stopsDependencyTrace()) {
                    igLog("\\<- this file stops propagation", .{});
                    return;
                }
            }

            // Recurse
            var it: ?EdgeIndex = g.first_dep.items[file_index.get()].unwrap();
            while (it) |dep_index| {
                const edge = g.edges.items[dep_index.get()];
                it = edge.next_dependency.unwrap();
                try g.traceDependencies(edge.dependency, trace_kind);
            }
        }

        fn traceImports(g: *@This(), file_index: FileIndex) !void {
            g.owner().graph_safety_lock.assertLocked();

            if (Environment.enable_logs) {
                igLog("traceImports(.{s}, {}{s})", .{
                    @tagName(side),
                    bun.fmt.quote(g.bundled_files.keys()[file_index.get()]),
                    if (g.affected_by_trace.isSet(file_index.get())) " [already visited]" else "",
                });
            }

            if (g.affected_by_trace.isSet(file_index.get()))
                return;
            g.affected_by_trace.set(file_index.get());

            const file = g.bundled_files.values()[file_index.get()];

            switch (side) {
                .server => {
                    if (file.is_client_component_boundary) {
                        const dev = g.owner();
                        const key = g.bundled_files.keys()[file_index.get()];
                        const index = dev.client_graph.getFileIndex(key) orelse
                            Output.panic("Client Incremental Graph is missing component for {}", .{bun.fmt.quote(key)});
                        try dev.client_graph.traceImports(index);
                    }
                },
                .client => {
                    assert(!g.stale_files.isSet(file_index.get())); // should not be left stale
                    try g.current_chunk_parts.append(g.owner().allocator, file_index);
                    g.current_chunk_len += file.code_len;
                },
            }

            // Recurse
            var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
            while (it) |dep_index| {
                const edge = g.edges.items[dep_index.get()];
                it = edge.next_import.unwrap();
                try g.traceImports(edge.imported);
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
                if (side == .server) {
                    if (is_route) gop.value_ptr.*.is_route = is_route;
                }
            }

            if (is_route) {
                g.owner().routes[route_index.get()].server_file = file_index.toOptional();
            }

            if (g.stale_files.bit_length > gop.index) {
                g.stale_files.set(gop.index);
            }

            if (is_route) {
                try g.owner().route_lookup.put(g.owner().allocator, file_index, route_index);
            }

            switch (side) {
                .client => {
                    gop.value_ptr.* = File.init("", .{
                        .failed = false,
                        .is_component_root = false,
                        .is_special_framework_file = false,
                        .kind = .js,
                    });
                },
                .server => {
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = is_route,
                            .is_client_component_boundary = false,
                            .failed = false,
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

        pub fn insertFailure(
            g: *@This(),
            abs_path: []const u8,
            log: *const Log,
            is_ssr_graph: bool,
        ) bun.OOM!void {
            g.owner().graph_safety_lock.assertLocked();

            debug.log("Insert stale: {s}", .{abs_path});
            const gop = try g.bundled_files.getOrPut(g.owner().allocator, abs_path);
            const file_index = FileIndex.init(@intCast(gop.index));

            if (!gop.found_existing) {
                gop.key_ptr.* = try bun.default_allocator.dupe(u8, abs_path);
                try g.first_dep.append(g.owner().allocator, .none);
                try g.first_import.append(g.owner().allocator, .none);
            }

            if (g.stale_files.bit_length > gop.index) {
                g.stale_files.set(gop.index);
            }

            switch (side) {
                .client => {
                    gop.value_ptr.* = File.init("", .{
                        .failed = true,
                        .is_component_root = false,
                        .is_special_framework_file = false,
                        .kind = .js,
                    });
                },
                .server => {
                    if (!gop.found_existing) {
                        gop.value_ptr.* = .{
                            .is_rsc = !is_ssr_graph,
                            .is_ssr = is_ssr_graph,
                            .is_route = false,
                            .is_client_component_boundary = false,
                            .failed = true,
                        };
                    } else {
                        if (is_ssr_graph) {
                            gop.value_ptr.is_ssr = true;
                        } else {
                            gop.value_ptr.is_rsc = true;
                        }
                        gop.value_ptr.failed = true;
                    }
                },
            }

            const dev = g.owner();

            const fail_owner: SerializedFailure.Owner = switch (side) {
                .server => .{ .server = file_index },
                .client => .{ .client = file_index },
            };
            const failure = try SerializedFailure.initFromLog(
                fail_owner,
                bun.path.relative(dev.cwd, abs_path),
                log.msgs.items,
            );
            const fail_gop = try dev.bundling_failures.getOrPut(dev.allocator, failure);
            try dev.incremental_result.failures_added.append(dev.allocator, failure);
            if (fail_gop.found_existing) {
                try dev.incremental_result.failures_removed.append(dev.allocator, fail_gop.key_ptr.*);
                fail_gop.key_ptr.* = failure;
            }
        }

        pub fn ensureStaleBitCapacity(g: *@This(), val: bool) !void {
            try g.stale_files.resize(
                g.owner().allocator,
                std.mem.alignForward(
                    usize,
                    @max(g.bundled_files.count(), g.stale_files.bit_length),
                    // allocate 8 in 8 usize chunks
                    std.mem.byte_size_in_bits * @sizeOf(usize) * 8,
                ),
                val,
            );
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
                const data = &values[index];
                switch (side) {
                    .client => {
                        // When re-bundling SCBs, only bundle the server. Otherwise
                        // the bundler gets confused and bundles both sides without
                        // knowledge of the boundary between them.
                        if (!data.flags.is_component_root)
                            try out_paths.append(BakeEntryPoint.init(path, .client));
                    },
                    .server => {
                        if (data.is_rsc)
                            try out_paths.append(BakeEntryPoint.init(path, .server));
                        if (data.is_ssr and !data.is_client_component_boundary)
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
            // initial bundle needs at least the entry point
            // hot updates shouldnt be emitted if there are no chunks
            assert(g.current_chunk_len > 0);

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
                        };
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
                    .client => files[entry.get()].code(),
                    // entry is the '[]const u8' itself
                    .server => entry,
                });
            }
            chunk.appendSliceAssumeCapacity(end);

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

        fn disconnectAndDeleteFile(g: *@This(), file_index: FileIndex) void {
            const last = FileIndex.init(@intCast(g.bundled_files.count() - 1));

            bun.assert(g.bundled_files.count() > 1); // never remove all files

            bun.assert(g.first_dep.items[file_index.get()] == .none); // must have no dependencies

            // Disconnect all imports
            {
                var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
                while (it) |edge_index| {
                    const dep = g.edges.items[edge_index.get()];
                    it = dep.next_import.unwrap();
                    assert(dep.dependency == file_index);

                    g.disconnectEdgeFromDependencyList(edge_index);
                    g.freeEdge(edge_index);
                }
            }

            g.bundled_files.swapRemoveAt(file_index.get());

            // Move out-of-line data from `last` to replace `file_index`
            _ = g.first_dep.swapRemove(file_index.get());
            _ = g.first_import.swapRemove(file_index.get());

            if (file_index != last) {
                g.stale_files.setValue(file_index.get(), g.stale_files.isSet(last.get()));

                // This set is not always initialized, so ignore if it's empty
                if (g.affected_by_trace.bit_length > 0) {
                    g.affected_by_trace.setValue(file_index.get(), g.affected_by_trace.isSet(last.get()));
                }

                // Adjust all referenced edges to point to the new file
                {
                    var it: ?EdgeIndex = g.first_import.items[file_index.get()].unwrap();
                    while (it) |edge_index| {
                        const dep = &g.edges.items[edge_index.get()];
                        it = dep.next_import.unwrap();
                        assert(dep.dependency == last);
                        dep.dependency = file_index;
                    }
                }
                {
                    var it: ?EdgeIndex = g.first_dep.items[file_index.get()].unwrap();
                    while (it) |edge_index| {
                        const dep = &g.edges.items[edge_index.get()];
                        it = dep.next_dependency.unwrap();
                        assert(dep.imported == last);
                        dep.imported = file_index;
                    }
                }
            }
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
        fn freeEdge(g: *@This(), edge_index: EdgeIndex) void {
            if (Environment.isDebug) {
                g.edges.items[edge_index.get()] = undefined;
            }

            if (edge_index.get() == (g.edges.items.len - 1)) {
                g.edges.items.len -= 1;
            } else {
                g.edges_free_list.append(g.owner().allocator, edge_index) catch {
                    // Leak an edge object; Ok since it may get cleaned up by
                    // the next incremental graph garbage-collection cycle.
                };
            }
        }

        pub fn owner(g: *@This()) *DevServer {
            return @alignCast(@fieldParentPtr(@tagName(side) ++ "_graph", g));
        }
    };
}

const IncrementalResult = struct {
    /// When tracing a file's dependencies via `traceDependencies`, this is
    /// populated with the hit routes. Tracing is used for many purposes.
    routes_affected: ArrayListUnmanaged(Route.Index),

    // Following three fields are populated during `receiveChunk`

    /// Components to add to the client manifest
    client_components_added: ArrayListUnmanaged(IncrementalGraph(.server).FileIndex),
    /// Components to add to the client manifest
    client_components_removed: ArrayListUnmanaged(IncrementalGraph(.server).FileIndex),
    /// This list acts as a free list. The contents of these slices must remain
    /// valid; they have to be so the affected routes can be cleared of the
    /// failures and potentially be marked valid. At the end of an
    /// incremental update, the slices are freed.
    failures_removed: ArrayListUnmanaged(SerializedFailure),

    /// Client boundaries that have been added or modified. At the end of a hot
    /// update, these are traced to their route to mark the bundles as stale (to
    /// be generated on Cmd+R)
    ///
    /// Populated during `traceDependencies`
    client_components_affected: ArrayListUnmanaged(IncrementalGraph(.server).FileIndex),

    /// The list of failures which will have to be traced to their route. Such
    /// tracing is deferred until the second pass of finalizeBundler as the
    /// dependency graph may not fully exist at the time the failure is indexed.
    ///
    /// Populated from within the bundler via `handleParseTaskFailure`
    failures_added: ArrayListUnmanaged(SerializedFailure),

    /// Removing files clobbers indices, so removing anything is deferred.
    delete_client_files_later: ArrayListUnmanaged(IncrementalGraph(.client).FileIndex),

    const empty: IncrementalResult = .{
        .routes_affected = .{},
        .failures_removed = .{},
        .failures_added = .{},
        .client_components_added = .{},
        .client_components_removed = .{},
        .client_components_affected = .{},
        .delete_client_files_later = .{},
    };

    fn reset(result: *IncrementalResult) void {
        result.routes_affected.clearRetainingCapacity();
        assert(result.failures_removed.items.len == 0);
        result.failures_added.clearRetainingCapacity();
        result.client_components_added.clearRetainingCapacity();
        result.client_components_removed.clearRetainingCapacity();
        result.client_components_affected.clearRetainingCapacity();
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
        renderer: bake.Graph,
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

/// Errors sent to the HMR client in the browser are serialized. The same format
/// is used for thrown JavaScript exceptions as well as bundler errors.
/// Serialized failures contain a handle on what file or route they came from,
/// which allows the bundler to dismiss or update stale failures via index as
/// opposed to re-sending a new payload. This also means only changed files are
/// rebuilt, instead of all of the failed files.
///
/// The HMR client in the browser is expected to sort the final list of errors
/// for deterministic output; there is code in DevServer that uses `swapRemove`.
pub const SerializedFailure = struct {
    /// Serialized data is always owned by default_allocator
    /// The first 32 bits of this slice contain the owner
    data: []u8,

    pub fn deinit(f: SerializedFailure) void {
        bun.default_allocator.free(f.data);
    }

    /// The metaphorical owner of an incremental file error. The packed variant
    /// is given to the HMR runtime as an opaque handle.
    pub const Owner = union(enum) {
        none,
        route: Route.Index,
        client: IncrementalGraph(.client).FileIndex,
        server: IncrementalGraph(.server).FileIndex,

        pub fn encode(owner: Owner) Packed {
            return switch (owner) {
                .none => .{ .kind = .none, .data = 0 },
                .client => |data| .{ .kind = .client, .data = data.get() },
                .server => |data| .{ .kind = .server, .data = data.get() },
                .route => |data| .{ .kind = .route, .data = data.get() },
            };
        }

        pub const Packed = packed struct(u32) {
            kind: enum(u2) { none, route, client, server },
            data: u30,

            pub fn decode(owner: Packed) Owner {
                return switch (owner.kind) {
                    .none => .none,
                    .client => .{ .client = IncrementalGraph(.client).FileIndex.init(owner.data) },
                    .server => .{ .server = IncrementalGraph(.server).FileIndex.init(owner.data) },
                    .route => .{ .route = Route.Index.init(owner.data) },
                };
            }
        };
    };

    fn getOwner(failure: SerializedFailure) Owner {
        return std.mem.bytesAsValue(Owner.Packed, failure.data[0..4]).decode();
    }

    /// This assumes the hash map contains only one SerializedFailure per owner.
    /// This is okay since SerializedFailure can contain more than one error.
    const ArrayHashContextViaOwner = struct {
        pub fn hash(_: ArrayHashContextViaOwner, k: SerializedFailure) u32 {
            return std.hash.uint32(@bitCast(k.getOwner().encode()));
        }

        pub fn eql(_: ArrayHashContextViaOwner, a: SerializedFailure, b: SerializedFailure, _: usize) bool {
            return @as(u32, @bitCast(a.getOwner().encode())) == @as(u32, @bitCast(b.getOwner().encode()));
        }
    };

    const ArrayHashAdapter = struct {
        pub fn hash(_: ArrayHashAdapter, own: Owner) u32 {
            return std.hash.uint32(@bitCast(own.encode()));
        }

        pub fn eql(_: ArrayHashAdapter, a: Owner, b: SerializedFailure, _: usize) bool {
            return @as(u32, @bitCast(a.encode())) == @as(u32, @bitCast(b.getOwner().encode()));
        }
    };

    const ErrorKind = enum(u8) {
        // A log message. The `logger.Kind` is encoded here.
        bundler_log_err = 0,
        bundler_log_warn = 1,
        bundler_log_note = 2,
        bundler_log_debug = 3,
        bundler_log_verbose = 4,

        /// new Error(message)
        js_error,
        /// new TypeError(message)
        js_error_type,
        /// new RangeError(message)
        js_error_range,
        /// Other forms of `Error` objects, including when an error has a
        /// `code`, and other fields.
        js_error_extra,
        /// Non-error with a stack trace
        js_primitive_exception,
        /// Non-error JS values
        js_primitive,
        /// new AggregateError(errors, message)
        js_aggregate,
    };

    pub fn initFromJs(owner: Owner, value: JSValue) !SerializedFailure {
        {
            _ = value;
            @panic("TODO");
        }
        // Avoid small re-allocations without requesting so much from the heap
        var sfb = std.heap.stackFallback(65536, bun.default_allocator);
        var payload = std.ArrayList(u8).initCapacity(sfb.get(), 65536) catch
            unreachable; // enough space
        const w = payload.writer();

        try w.writeInt(u32, @bitCast(owner.encode()), .little);
        // try writeJsValue(value);

        // Avoid-recloning if it is was moved to the hap
        const data = if (payload.items.ptr == &sfb.buffer)
            try bun.default_allocator.dupe(u8, payload.items)
        else
            payload.items;

        return .{ .data = data };
    }

    pub fn initFromLog(
        owner: Owner,
        owner_display_name: []const u8,
        messages: []const bun.logger.Msg,
    ) !SerializedFailure {
        assert(messages.len > 0);

        // Avoid small re-allocations without requesting so much from the heap
        var sfb = std.heap.stackFallback(65536, bun.default_allocator);
        var payload = std.ArrayList(u8).initCapacity(sfb.get(), 65536) catch
            unreachable; // enough space
        const w = payload.writer();

        try w.writeInt(u32, @bitCast(owner.encode()), .little);

        try writeString32(owner_display_name, w);

        try w.writeInt(u32, @intCast(messages.len), .little);

        for (messages) |*msg| {
            try writeLogMsg(msg, w);
        }

        // Avoid-recloning if it is was moved to the hap
        const data = if (payload.items.ptr == &sfb.buffer)
            try bun.default_allocator.dupe(u8, payload.items)
        else
            payload.items;

        return .{ .data = data };
    }

    // All "write" functions get a corresponding "read" function in ./client/error.ts

    const Writer = std.ArrayList(u8).Writer;

    fn writeLogMsg(msg: *const bun.logger.Msg, w: Writer) !void {
        try w.writeByte(switch (msg.kind) {
            inline else => |k| @intFromEnum(@field(ErrorKind, "bundler_log_" ++ @tagName(k))),
        });
        try writeLogData(msg.data, w);
        const notes = msg.notes orelse &.{};
        try w.writeInt(u32, @intCast(notes.len), .little);
        for (notes) |note| {
            try writeLogData(note, w);
        }
    }

    fn writeLogData(data: bun.logger.Data, w: Writer) !void {
        try writeString32(data.text, w);
        if (data.location) |loc| {
            assert(loc.line >= 0); // one based and not negative
            assert(loc.column >= 0); // zero based and not negative

            try w.writeInt(u32, @intCast(loc.line), .little);
            try w.writeInt(u32, @intCast(loc.column), .little);
            try w.writeInt(u32, @intCast(loc.length), .little);

            // TODO: syntax highlighted line text + give more context lines
            try writeString32(loc.line_text orelse "", w);

            // The file is not specified here. Since the bundler runs every file
            // in isolation, it would be impossible to reference any other file
            // in this Log. Thus, it is not serialized.
        } else {
            try w.writeInt(u32, 0, .little);
        }
    }

    fn writeString32(data: []const u8, w: Writer) !void {
        try w.writeInt(u32, @intCast(data.len), .little);
        try w.writeAll(data);
    }

    // fn writeJsValue(value: JSValue, global: *JSC.JSGlobalObject, w: *Writer) !void {
    //     if (value.isAggregateError(global)) {
    //         //
    //     }
    //     if (value.jsType() == .DOMWrapper) {
    //         if (value.as(JSC.BuildMessage)) |build_error| {
    //             _ = build_error; // autofix
    //             //
    //         } else if (value.as(JSC.ResolveMessage)) |resolve_error| {
    //             _ = resolve_error; // autofix
    //             @panic("TODO");
    //         }
    //     }
    //     _ = w; // autofix

    //     @panic("TODO");
    // }
};

// For debugging, it is helpful to be able to see bundles.
fn dumpBundle(dump_dir: std.fs.Dir, side: bake.Graph, rel_path: []const u8, chunk: []const u8, wrap: bool) !void {
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
            try w.writeByte(@intFromBool(g.stale_files.isSet(i) or switch (side) {
                .server => v.failed,
                .client => v.flags.failed,
            }));
            try w.writeByte(@intFromBool(side == .server and v.is_rsc));
            try w.writeByte(@intFromBool(side == .server and v.is_ssr));
            try w.writeByte(@intFromBool(side == .server and v.is_route));
            try w.writeByte(@intFromBool(side == .client and v.flags.is_special_framework_file));
            try w.writeByte(@intFromBool(switch (side) {
                .server => v.is_client_component_boundary,
                .client => v.flags.is_component_root,
            }));
        }
    }
    inline for (.{ &dev.client_graph, &dev.server_graph }) |g| {
        const G = @TypeOf(g.*);

        try w.writeInt(u32, @intCast(g.edges.items.len - g.edges_free_list.items.len), .little);
        for (g.edges.items, 0..) |edge, i| {
            if (std.mem.indexOfScalar(G.EdgeIndex, g.edges_free_list.items, G.EdgeIndex.init(@intCast(i))) != null)
                continue;

            try w.writeInt(u32, @intCast(edge.dependency.get()), .little);
            try w.writeInt(u32, @intCast(edge.imported.get()), .little);
        }
    }

    _ = dev.app.publish(DevWebSocket.visualizer_channel, payload.items, .binary, false);
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

pub const MessageId = enum(u8) {
    /// Version packet
    version = 'V',
    /// When visualization mode is enabled, this packet contains
    /// the entire serialized IncrementalGraph state.
    visualizer = 'v',
    /// Sent on a successful bundle, containing client code.
    hot_update = '(',
    /// Sent on a successful bundle, containing a list of
    /// routes that are updated.
    route_update = 'R',
    /// Sent when the list of errors changes.
    errors = 'E',
    /// Sent when all errors are cleared. Semi-redundant
    errors_cleared = 'c',

    pub fn char(id: MessageId) u8 {
        return @intFromEnum(id);
    }
};

const DevWebSocket = struct {
    dev: *DevServer,
    emit_visualizer_events: bool,

    pub const global_channel = "*";
    pub const visualizer_channel = "v";

    pub fn onOpen(dw: *DevWebSocket, ws: AnyWebSocket) void {
        _ = dw;
        // TODO: append hash of the framework config
        _ = ws.send(.{MessageId.version.char()} ++ bun.Global.package_json_version_with_revision, .binary, false, true);
        _ = ws.subscribe(global_channel);
    }

    pub fn onMessage(dw: *DevWebSocket, ws: AnyWebSocket, msg: []const u8, opcode: uws.Opcode) void {
        _ = opcode;

        if (msg.len == 1 and msg[0] == MessageId.visualizer.char() and !dw.emit_visualizer_events) {
            dw.emit_visualizer_events = true;
            dw.dev.emit_visualizer_events += 1;
            _ = ws.subscribe(visualizer_channel);
            dw.dev.emitVisualizerMessageIfNeeded() catch bun.outOfMemory();
        }
    }

    pub fn onClose(dw: *DevWebSocket, ws: AnyWebSocket, exit_code: i32, message: []const u8) void {
        _ = ws;
        _ = exit_code;
        _ = message;

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

    var timer = std.time.Timer.start() catch
        @panic("timers unsupported");

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

    const reload_file_list = bun.Output.Scoped(.reload_file_list, false);

    if (reload_file_list.isVisible()) {
        reload_file_list.log("Hot update hits {d} files", .{files.items.len});
        for (files.items) |f| {
            reload_file_list.log("- {s} (.{s})", .{ f.path, @tagName(f.graph) });
        }
    }

    dev.incremental_result.reset();
    defer {
        // Remove files last to start, to avoid issues where removing a file
        // invalidates the last file index.
        std.sort.pdq(
            IncrementalGraph(.client).FileIndex,
            dev.incremental_result.delete_client_files_later.items,
            {},
            IncrementalGraph(.client).FileIndex.sortFnDesc,
        );
        for (dev.incremental_result.delete_client_files_later.items) |client_index| {
            dev.client_graph.disconnectAndDeleteFile(client_index);
        }
        dev.incremental_result.delete_client_files_later.clearRetainingCapacity();
    }

    dev.bundle(files.items) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());
        return;
    };

    dev.graph_safety_lock.lock();
    defer dev.graph_safety_lock.unlock();

    if (dev.client_graph.current_chunk_len > 0) {
        const client = try dev.client_graph.takeBundle(.hmr_chunk);
        defer dev.allocator.free(client);
        assert(client[0] == '(');
        _ = dev.app.publish(DevWebSocket.global_channel, client, .binary, true);
    }

    // This list of routes affected excludes client code. This means changing
    // a client component wont count as a route to trigger a reload on.
    if (dev.incremental_result.routes_affected.items.len > 0) {
        var sfb2 = std.heap.stackFallback(65536, bun.default_allocator);
        var payload = std.ArrayList(u8).initCapacity(sfb2.get(), 65536) catch
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

        _ = dev.app.publish(DevWebSocket.global_channel, payload.items, .binary, true);
    }

    // When client component roots get updated, the `client_components_affected`
    // list contains the server side versions of these roots. These roots are
    // traced to the routes so that the client-side bundles can be properly
    // invalidated.
    if (dev.incremental_result.client_components_affected.items.len > 0) {
        dev.incremental_result.routes_affected.clearRetainingCapacity();
        dev.server_graph.affected_by_trace.setAll(false);

        var sfa_state = std.heap.stackFallback(65536, dev.allocator);
        const sfa = sfa_state.get();
        dev.server_graph.affected_by_trace = try DynamicBitSetUnmanaged.initEmpty(sfa, dev.server_graph.bundled_files.count());
        defer dev.server_graph.affected_by_trace.deinit(sfa);

        for (dev.incremental_result.client_components_affected.items) |index| {
            try dev.server_graph.traceDependencies(index, .no_stop);
        }

        for (dev.incremental_result.routes_affected.items) |route| {
            // Free old bundles
            if (dev.routes[route.get()].client_bundle) |old| {
                dev.allocator.free(old);
            }
            dev.routes[route.get()].client_bundle = null;
        }
    }

    // TODO: improve this visual feedback
    if (dev.bundling_failures.count() == 0) {
        const clear_terminal = true;
        if (clear_terminal) {
            Output.flush();
            Output.disableBuffering();
            Output.resetTerminalAll();
        }

        dev.bundles_since_last_error += 1;
        if (dev.bundles_since_last_error > 1) {
            Output.prettyError("<cyan>[x{d}]<r> ", .{dev.bundles_since_last_error});
        }

        Output.prettyError("<green>Reloaded in {d}ms<r><d>:<r> {s}", .{ @divFloor(timer.read(), std.time.ns_per_ms), bun.path.relative(dev.cwd, changed_file_paths[0]) });
        if (changed_file_paths.len > 1) {
            Output.prettyError(" <d>+ {d} more<r>", .{files.items.len - 1});
        }
        Output.prettyError("\n", .{});
        Output.flush();
    } else {}
}

pub const HotReloadTask = struct {
    /// Align to cache lines to reduce contention.
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

const ThreadlocalArena = @import("../mimalloc_arena.zig").Arena;
