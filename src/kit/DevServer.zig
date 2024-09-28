//! Instance of the development server. Controls an event loop, web server,
//! bundling state, and JavaScript VM instance. All work is cached in-memory.
//!
//! Currently does not have a `deinit()`, as it is assumed to be alive for the
//! remainder of this process' lifespan.
pub const DevServer = @This();

pub const Options = struct {
    cwd: []u8,
    routes: []Route,
    framework: kit.Framework,
    listen_config: uws.AppListenConfig = .{ .port = 3000 },
    dump_sources: ?[]const u8 = if (Environment.isDebug) ".kit-debug" else null,
    verbose_watcher: bool = false,
    // TODO: make it required to inherit a js VM
};

/// Accepting a custom allocator for all of DevServer would be misleading
/// as there are many functions which will use default_allocator.
const default_allocator = bun.default_allocator;

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
/// across all loaded modules. Its type is `(Request, Id) => Response`
server_fetch_function_callback: JSC.Strong,
server_register_update_callback: JSC.Strong,

// Bundling
client_graph: IncrementalGraph(.client),
server_graph: IncrementalGraph(.server),
framework: kit.Framework,
bun_watcher: *JSC.Watcher,
server_bundler: Bundler,
client_bundler: Bundler,
ssr_bundler: Bundler,
/// Stored and reused for bundling tasks
log: Log,

/// To reduce complexity of BundleV2's return type being different on
/// compile-time logic, extra kit-specific metadata is returned through a
/// pointer to DevServer, and writing directly to this field.
///
/// Only one bundle is run at a time (batched with all files needed),
/// so there is never contention.
bundle_result: ?ExtraBundleData,

// Debugging
dump_dir: ?std.fs.Dir,

pub const internal_prefix = "/_bun";
pub const client_prefix = internal_prefix ++ "/client";

pub const Route = struct {
    // Config
    pattern: [:0]const u8,
    entry_point: []const u8,

    bundle: BundleState = .stale,
    client_files: std.AutoArrayHashMapUnmanaged(IncrementalGraph(.client).Index, void) = .{},
    server_files: std.AutoArrayHashMapUnmanaged(IncrementalGraph(.server).Index, void) = .{},
    module_name_string: ?bun.String = null,

    /// Assigned in DevServer.init
    dev: *DevServer = undefined,
    client_bundled_url: []u8 = undefined,

    pub fn clientPublicPath(route: *const Route) []const u8 {
        return route.client_bundled_url[0 .. route.client_bundled_url.len - "/client.js".len];
    }

    pub const Index = enum(u32) { _ };
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

pub fn init(options: Options) !*DevServer {
    {
        @panic("Behavior Regressed due to Watcher Changes");
    }

    bun.analytics.Features.kit_dev +|= 1;
    if (JSC.VirtualMachine.VMHolder.vm != null)
        @panic("Cannot initialize kit.DevServer on a thread with an active JSC.VirtualMachine");

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

    const dev = bun.new(DevServer, .{
        .cwd = options.cwd,
        .app = app,
        .routes = options.routes,
        .address = .{
            .port = @intCast(options.listen_config.port),
            .hostname = options.listen_config.host orelse "localhost",
        },
        .server_fetch_function_callback = .{},
        .server_register_update_callback = .{},
        .listener = null,
        .log = Log.init(default_allocator),
        .client_graph = undefined,
        .server_graph = undefined,
        .dump_dir = dump_dir,
        .framework = options.framework,
        .bundle_result = null,

        .server_global = undefined,
        .vm = undefined,
        .bun_watcher = undefined,
        .server_bundler = undefined,
        .client_bundler = undefined,
        .ssr_bundler = undefined,
    });

    dev.server_graph = .{ .owner = dev };
    dev.client_graph = .{ .owner = dev };

    // const fs = try bun.fs.FileSystem.init(options.cwd);
    // dev.bun_watcher = HotReloader.init(dev, fs, options.verbose_watcher, false);
    // dev.server_bundler.resolver.watcher = dev.bun_watcher.getResolveWatcher();
    // dev.client_bundler.resolver.watcher = dev.bun_watcher.getResolveWatcher();

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
        .allocator = default_allocator,
        .args = std.mem.zeroes(bun.Schema.Api.TransformOptions),
    }) catch |err|
        Output.panic("Failed to create Global object: {}", .{err});
    dev.server_global = c.KitCreateDevGlobal(dev, dev.vm.console);
    dev.vm.global = dev.server_global.js();
    dev.vm.regular_event_loop.global = dev.vm.global;
    dev.vm.jsc = dev.vm.global.vm();
    dev.vm.event_loop.ensureWaker();

    var has_fallback = false;

    for (options.routes, 0..) |*route, i| {
        app.any(route.pattern, *Route, route, onServerRequestInit);

        route.dev = dev;
        route.client_bundled_url = std.fmt.allocPrint(
            default_allocator,
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

    if (!has_fallback)
        app.any("/*", void, {}, onFallbackRoute);

    app.listenWithConfig(*DevServer, dev, onListen, options.listen_config);

    return dev;
}

fn initBundler(dev: *DevServer, bundler: *Bundler, comptime renderer: kit.Renderer) !void {
    const framework = dev.framework;

    bundler.* = try bun.Bundler.init(
        default_allocator, // TODO: this is likely a memory leak
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
    bundler.options.output_dir = ""; // this disables filesystem output;
    bundler.options.entry_naming = "bundle.js"; // unused output file generation is skipped
    bundler.options.output_format = .internal_kit_dev;
    bundler.options.out_extensions = bun.StringHashMap([]const u8).init(bundler.allocator);
    bundler.options.hot_module_reloading = true;

    bundler.options.react_fast_refresh = renderer == .client and framework.react_fast_refresh != null;
    bundler.options.server_components = framework.server_components != null;

    bundler.options.conditions = try bun.options.ESMConditions.init(default_allocator, bundler.options.target.defaultConditions());
    if (renderer == .server and framework.server_components != null) {
        try bundler.options.conditions.appendSlice(&.{"react-server"});
    }

    bundler.options.tree_shaking = false;
    bundler.options.minify_syntax = true;
    bundler.options.minify_identifiers = false;
    bundler.options.minify_whitespace = false;
    bundler.options.kit = dev;

    bundler.configureLinker();
    try bundler.configureDefines();

    try kit.addImportMetaDefines(default_allocator, bundler.options.define, .development, switch (renderer) {
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

    Output.prettyErrorln("--\\> <magenta>http://{s}:{d}<r>\n", .{
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

const ExtraBundleData = struct {};

fn getRouteBundle(dev: *DevServer, route: *Route) BundleState.NonStale {
    if (route.bundle == .stale) {
        var fail: Failure = .{
            .zig_error = error.FileNotFound,
        };
        route.bundle = bundle: {
            const success = dev.performBundleAndWaitInner(route, &fail) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                if (fail == .zig_error) {
                    if (dev.log.hasAny()) {
                        fail = Failure.fromLog(&dev.log);
                    } else {
                        fail = .{ .zig_error = err };
                    }
                }
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

/// Error handling is done either by writing to `fail` with a specific failure,
/// or by appending to `dev.log`. The caller, `getRouteBundle`, will handle the
/// error, including replying to the request as well as console logging.
fn performBundleAndWaitInner(dev: *DevServer, route: *Route, fail: *Failure) !Bundle {
    var heap = try ThreadlocalArena.init();
    defer heap.deinit();

    const allocator = heap.allocator();
    var ast_memory_allocator = try allocator.create(bun.JSAst.ASTMemoryAllocator);
    ast_memory_allocator.* = .{ .allocator = allocator };
    ast_memory_allocator.reset();
    ast_memory_allocator.push();

    if (dev.framework.server_components == null) {
        // The handling of the dependency graph is SLIGHTLY different. It's
        // enough that it would be incorrect to let the current code execute at
        // all.
        bun.todoPanic(@src(), "support non-server components build", .{});
    }

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

    errdefer {
        // Wait for wait groups to finish. There still may be ongoing work.
        bv2.linker.source_maps.line_offset_wait_group.wait();
        bv2.linker.source_maps.quoted_contents_wait_group.wait();
    }

    const output_files = try bv2.runFromJSInNewThread(&.{
        route.entry_point,
        dev.framework.entry_server.?,
    }, &.{
        dev.framework.entry_client.?,
    });

    try dev.client_graph.ensureStaleBitCapacity();
    try dev.server_graph.ensureStaleBitCapacity();

    assert(output_files.items.len == 0);

    bv2.bundler.log.printForLogLevel(Output.errorWriter()) catch {};
    bv2.client_bundler.log.printForLogLevel(Output.errorWriter()) catch {};

    const server_bundle = try dev.server_graph.takeBundle(.initial_response);
    defer default_allocator.free(server_bundle);

    const client_bundle = try dev.client_graph.takeBundle(.initial_response);
    errdefer default_allocator.free(client_bundle);

    if (dev.log.hasAny()) {
        dev.log.printForLogLevel(Output.errorWriter()) catch {};
    }

    const server_code = c.KitLoadServerCode(dev.server_global, bun.String.createLatin1(server_bundle));
    dev.vm.waitForPromise(.{ .internal = server_code.promise });

    switch (server_code.promise.unwrap(dev.vm.jsc, .mark_handled)) {
        .pending => unreachable, // promise is settled
        .rejected => |err| {
            fail.* = Failure.fromJSServerLoad(err, dev.server_global.js());
            return error.ServerJSLoad;
        },
        .fulfilled => |v| bun.assert(v == .undefined),
    }

    if (route.module_name_string == null) {
        route.module_name_string = bun.String.createUTF8(bun.path.relative(dev.cwd, route.entry_point));
    }

    if (!dev.server_fetch_function_callback.has()) {
        const default_export = c.KitGetRequestHandlerFromModule(dev.server_global, server_code.key);
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
        bun.todoPanic(@src(), "Kit: server's secondary bundle", .{});
    }

    return .{
        .client_bundle = client_bundle,
    };
}

pub fn receiveChunk(
    dev: *DevServer,
    abs_path: []const u8,
    side: kit.Renderer,
    chunk: bun.bundle_v2.CompileResult,
) !void {
    return switch (side) {
        .server => dev.server_graph.addChunk(abs_path, chunk, false),
        .ssr => dev.server_graph.addChunk(abs_path, chunk, true),
        .client => dev.client_graph.addChunk(abs_path, chunk, false),
    };
}

// uws with bundle handlers

fn onServerRequestWithBundle(route: *Route, bundle: Bundle, req: *Request, resp: *Response) void {
    _ = bundle;
    _ = req;
    const dev = route.dev;
    const global = dev.server_global.js();

    const server_request_callback = dev.server_fetch_function_callback.get() orelse
        unreachable; // did not bundle

    const context = JSValue.createEmptyObject(global, 1);
    context.put(
        dev.server_global.js(),
        bun.String.static("clientEntryPoint"),
        bun.String.init(route.client_bundled_url).toJS(global),
    );

    var result = server_request_callback.call(
        global,
        .undefined,
        &.{
            context,
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

    // TODO: This interface and implementation is very poor. but fine until API
    // considerations become important (as of writing, there are 3 dozen todo
    // items before it)
    //
    // It probably should use code from `server.zig`, but most importantly it should
    // not have a tie to DevServer, but instead be generic with a context structure
    // containing just a *uws.App, *JSC.EventLoop, and JSValue response object.
    //
    // This would allow us to support all of the nice things `new Response` allows

    const bun_string = result.toBunString(dev.server_global.js());
    defer bun_string.deref();
    if (bun_string.tag == .Dead) {
        bun.todoPanic(@src(), "Kit: support non-string return value", .{});
    }

    const utf8 = bun_string.toUTF8(default_allocator);
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

/// The paradigm of Kit's incremental state is to store a separate list of files
/// than the Graph in bundle_v2. When watch events happen, the bundler is run on
/// the changed files, excluding non-stale files via `isFileStale`.
///
/// Upon bundle completion, both `client_graph` and `server_graph` have their
/// `addChunk` methods called with all new chunks, counting the total length
/// needed. A call to `takeBundle` joins all of the chunks, resulting in the
/// code to send to client or evaluate on the server.
///
/// This approach was selected as it resulted in the fewest changes in the
/// bundler. It also allows the bundler to avoid memory buildup by ensuring its
/// arenas don't live too long.
///
/// Since all routes share the two graphs, bundling a new route that shared
/// a module from a previously bundled route will perform the same exclusion
/// behavior that rebuilds use. This also ensures that two routes on the server
/// do not emit duplicate dependencies. By tracing `imports` on each file in
/// the module graph recursively, the full bundle for any given route can
/// be re-materialized (required when pressing Cmd+R after any client update)
pub fn IncrementalGraph(side: kit.Side) type {
    return struct {
        owner: *DevServer,

        bundled_files: bun.StringArrayHashMapUnmanaged(File) = .{},
        stale_files: bun.bit_set.DynamicBitSetUnmanaged = .{},

        server_is_rsc: if (side == .server) bun.bit_set.DynamicBitSetUnmanaged else void =
            if (side == .server) .{},
        server_is_ssr: if (side == .server) bun.bit_set.DynamicBitSetUnmanaged else void =
            if (side == .server) .{},

        /// Byte length of every file queued for concatenation
        current_incremental_chunk_len: usize = 0,
        current_incremental_chunk_parts: std.ArrayListUnmanaged(switch (side) {
            .client => Index,
            // these slices do not outlive the bundler, and must be joined
            // before its arena is deinitialized.
            .server => []const u8,
        }) = .{},

        /// An index into `bundled_files` or `stale_files`
        pub const Index = enum(u32) { _ };

        pub const File = switch (side) {
            // The server's incremental graph does not store previously bundled
            // code because there is only one instance of the server. Instead,
            // it stores which
            .server => struct {},
            .client => struct {
                /// allocated by default_allocator
                code: []const u8,
                // /// To re-assemble a stale bundle (browser hard-reload), follow this recursively
                // imports: []Index,

                // routes: u32,
            },
        };

        pub fn addChunk(
            g: *@This(),
            abs_path: []const u8,
            chunk: bun.bundle_v2.CompileResult,
            is_ssr_graph: bool,
        ) !void {
            const code = chunk.code();
            if (code.len == 0) return;

            g.current_incremental_chunk_len += code.len;

            if (g.owner.dump_dir) |dump_dir| {
                const cwd = g.owner.cwd;
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

            const gop = try g.bundled_files.getOrPut(default_allocator, abs_path);

            switch (side) {
                .client => {
                    if (gop.found_existing) {
                        bun.default_allocator.free(gop.value_ptr.code);
                    }
                    gop.value_ptr.* = .{
                        .code = chunk.code(),
                        // .imports = &.{},
                    };
                    try g.current_incremental_chunk_parts.append(default_allocator, @enumFromInt(gop.index));
                },
                .server => {
                    // TODO: THIS ALLOCATION STRATEGY SUCKS. IT DOESNT DESERVE TO SHIP
                    if (!gop.found_existing) {
                        try g.server_is_ssr.resize(default_allocator, gop.index + 1, false);
                        try g.server_is_rsc.resize(default_allocator, gop.index + 1, false);
                    }

                    try g.current_incremental_chunk_parts.append(default_allocator, chunk.code());

                    const bitset = switch (is_ssr_graph) {
                        true => &g.server_is_ssr,
                        false => &g.server_is_rsc,
                    };
                    bitset.set(gop.index);
                },
            }
        }

        pub fn ensureStaleBitCapacity(g: *@This()) !void {
            try g.stale_files.resize(default_allocator, g.bundled_files.count(), false);
        }

        pub fn invalidate(g: *@This(), paths: []const []const u8, hashes: []const u32, out_paths: *DualArray([]const u8)) void {
            for (paths, hashes) |path, hash| {
                const ctx: bun.StringArrayHashMapContext.Prehashed = .{
                    .value = hash,
                    .input = path,
                };
                const index = g.bundled_files.getIndexAdapted(path, ctx) orelse
                    continue;
                g.stale_files.set(index);
                switch (side) {
                    .client => out_paths.appendLeft(path),
                    .server => out_paths.appendRight(path),
                }
            }
        }

        const ChunkKind = enum {
            initial_response,
            hmr_chunk,
        };

        fn reset(g: *@This()) void {
            g.current_incremental_chunk_len = 0;
            g.current_incremental_chunk_parts.clearRetainingCapacity();
        }

        pub fn takeBundle(g: *@This(), kind: ChunkKind) ![]const u8 {
            const runtime = switch (kind) {
                .initial_response => bun.kit.getHmrRuntime(side),
                .hmr_chunk => "({\n",
            };

            // A small amount of metadata is present at the end of the chunk
            // to inform the HMR runtime some crucial entry-point info. The
            // upper bound of this can be calculated, but 64kb is given to
            // ensure no problems.
            //
            // TODO: is a higher upper bound required on Windows?
            // Alternate solution: calculate the upper bound by summing
            // framework paths and then reusing that allocation.
            var end_buf: [65536]u8 = undefined;
            const end = end: {
                var fbs = std.io.fixedBufferStream(&end_buf);
                const w = fbs.writer();
                switch (kind) {
                    .initial_response => {
                        w.writeAll("}, {\n  main: ") catch unreachable;
                        const entry = switch (side) {
                            .server => g.owner.framework.entry_server,
                            .client => g.owner.framework.entry_client,
                        } orelse bun.todoPanic(@src(), "non-framework provided entry-point", .{});
                        bun.js_printer.writeJSONString(
                            bun.path.relative(g.owner.cwd, entry),
                            @TypeOf(w),
                            w,
                            .utf8,
                        ) catch unreachable;
                        w.writeAll("\n});") catch unreachable;
                    },
                    .hmr_chunk => {
                        w.writeAll("\n})") catch unreachable;
                    },
                }
                break :end fbs.getWritten();
            };

            const files = g.bundled_files.values();

            // This function performs one allocation, right here
            var chunk = try std.ArrayListUnmanaged(u8).initCapacity(
                default_allocator,
                g.current_incremental_chunk_len + runtime.len + end.len,
            );

            chunk.appendSliceAssumeCapacity(runtime);
            for (g.current_incremental_chunk_parts.items) |entry| {
                chunk.appendSliceAssumeCapacity(switch (side) {
                    // entry is an index into files
                    .client => files[@intFromEnum(entry)].code,
                    // entry is the '[]const u8' itself
                    .server => entry,
                });
            }
            chunk.appendSliceAssumeCapacity(end);
            assert(chunk.capacity == chunk.items.len);

            if (g.owner.dump_dir) |dump_dir| {
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
    };
}

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
fn dumpBundle(dump_dir: std.fs.Dir, side: kit.Renderer, rel_path: []const u8, chunk: []const u8, wrap: bool) !void {
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

pub fn isFileStale(dev: *DevServer, path: []const u8, side: kit.Renderer) bool {
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

/// This function is required by `HotReloader`
pub fn eventLoop(dev: *DevServer) *JSC.EventLoop {
    return dev.vm.eventLoop();
}

pub fn onWebSocketUpgrade(
    dev: *DevServer,
    res: *Response,
    req: *Request,
    upgrade_ctx: *uws.uws_socket_context_t,
    id: usize,
) void {
    assert(id == 0);

    const dw = bun.new(DevWebSocket, .{ .dev = dev });
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

    pub fn onOpen(dw: *DevWebSocket, ws: AnyWebSocket) void {
        _ = dw; // autofix
        _ = ws.send("bun!", .text, false, true);
        _ = ws.subscribe("TODO");
    }

    pub fn onMessage(dw: *DevWebSocket, ws: AnyWebSocket, msg: []const u8, opcode: uws.Opcode) void {
        _ = dw; // autofix
        _ = ws; // autofix
        _ = msg; // autofix
        _ = opcode; // autofix
    }

    pub fn onClose(dw: *DevWebSocket, ws: AnyWebSocket, exit_code: i32, message: []const u8) void {
        _ = ws; // autofix
        _ = exit_code; // autofix
        _ = message; // autofix
        defer bun.destroy(dw);
    }
};

/// Kit uses a special global object extending Zig::GlobalObject
pub const DevGlobalObject = opaque {
    /// Safe downcast to use other Bun APIs
    pub fn js(ptr: *DevGlobalObject) *JSC.JSGlobalObject {
        return @ptrCast(ptr);
    }

    pub fn vm(ptr: *DevGlobalObject) *JSC.VM {
        return ptr.js().vm();
    }
};

pub const KitSourceProvider = opaque {};

pub const c = struct {
    // KitDevGlobalObject.cpp
    extern fn KitCreateDevGlobal(owner: *DevServer, console: *JSC.ConsoleObject) *DevGlobalObject;

    // KitSourceProvider.cpp
    const LoadServerCodeResult = extern struct { promise: *JSInternalPromise, key: *JSC.JSString };
    extern fn KitLoadServerCode(global: *DevGlobalObject, code: bun.String) LoadServerCodeResult;
    extern fn KitGetRequestHandlerFromModule(global: *DevGlobalObject, module: *JSC.JSString) JSValue;
};

pub fn reload(dev: *DevServer, reload_task: *const HotReloadTask) void {
    dev.reloadWrap(reload_task) catch bun.todoPanic(@src(), "handle hot-reloading error", .{});
}

pub fn reloadWrap(dev: *DevServer, reload_task: *const HotReloadTask) !void {
    const sfb = default_allocator;

    const changed_file_paths = reload_task.paths[0..reload_task.count];
    const changed_hashes = reload_task.hashes[0..reload_task.count];

    defer for (changed_file_paths) |path| default_allocator.free(path);

    var files_to_bundle = try DualArray([]const u8).initCapacity(sfb, changed_file_paths.len * 2);
    defer files_to_bundle.deinit(sfb);
    inline for (.{ &dev.server_graph, &dev.client_graph }) |g| {
        g.invalidate(changed_file_paths, changed_hashes, &files_to_bundle);
    }

    bun.todoPanic(@src(), "rewire hot-bundling code", .{});

    // const route = &dev.routes[0];

    // const bundle_task = bun.new(BundleTask, .{
    //     .owner = dev,
    //     .route = route,
    //     .kind = .client,
    //     .plugins = null,
    //     .handlers = .{ .first = null },
    // });
    // assert(route.client_bundle != .pending); // todo: rapid reloads
    // route.client_bundle = .{ .pending = bundle_task };
    // dev.bundle_thread.enqueue(bundle_task);
}

pub fn bustDirCache(dev: *DevServer, path: []const u8) bool {
    const a = dev.server_bundler.resolver.bustDirCache(path);
    const b = dev.client_bundler.resolver.bustDirCache(path);
    return a or b;
}

pub fn getLoaders(dev: *DevServer) *bun.options.Loader.HashTable {
    // The watcher needs to know what loader to use for a file,
    // therefore, we must ensure that server and client options
    // use the same loader set.
    return &dev.server_bundler.options.loaders;
}

/// A data structure to represent two arrays that share a known upper bound.
/// The "left" array starts at the allocation start, and the "right" array
/// starts at the allocation end.
///
/// An example use-case is having a list of files, but categorizing them
/// into server/client. The total number of files is known.
pub fn DualArray(T: type) type {
    return struct {
        items: []T,
        left_end: u32,
        right_start: u32,

        pub fn initCapacity(allocator: Allocator, cap: usize) !@This() {
            return .{
                .items = try allocator.alloc(T, cap),
                .left_end = 0,
                .right_start = @intCast(cap),
            };
        }

        pub fn deinit(a: @This(), allocator: Allocator) void {
            allocator.free(a.items);
        }

        fn hasAny(a: @This()) bool {
            return a.left_end != 0 or a.right_start != a.items.len;
        }

        pub fn left(a: @This()) []T {
            return a.items[0..a.left_end];
        }

        pub fn right(a: @This()) []T {
            return a.items[a.right_start..];
        }

        pub fn appendLeft(a: *@This(), item: T) void {
            assert(a.left_end < a.right_start);
            a.items[a.left_end] = item;
            a.left_end += 1;
        }

        pub fn appendRight(a: *@This(), item: T) void {
            assert(a.right_start > a.left_end);
            a.right_start -= 1;
            a.items[a.right_start] = item;
        }
    };
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("root").bun;
const Environment = bun.Environment;
const assert = bun.assert;

const kit = bun.kit;

const Log = bun.logger.Log;

const Bundler = bun.bundler.Bundler;
const BundleV2 = bun.bundle_v2.BundleV2;
const Define = bun.options.Define;
const OutputFile = bun.options.OutputFile;

const Output = bun.Output;

const uws = bun.uws;
const App = uws.NewApp(false);
const AnyWebSocket = uws.AnyWebSocket;
const Request = uws.Request;
const Response = App.Response;

const MimeType = bun.http.MimeType;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;
const JSModuleLoader = JSC.JSModuleLoader;
const EventLoopHandle = JSC.EventLoopHandle;
const JSInternalPromise = JSC.JSInternalPromise;

pub const HotReloader = JSC.NewHotReloader(DevServer, JSC.EventLoop, false);
pub const HotReloadTask = HotReloader.HotReloadTask;

const ThreadlocalArena = @import("../mimalloc_arena.zig").Arena;
