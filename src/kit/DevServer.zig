//! Instance of the development server. Controls an event loop, web server,
//! bundling threads, and JavaScript VM instance. All data is held in memory.
//!
//! Currently does not have a `deinit()`, as it is assumed to be alive for the
//! remainder of this process' lifespan.
pub const DevServer = @This();

pub const Options = struct {
    cwd: []u8,
    routes: []Route,
    listen_config: uws.AppListenConfig = .{ .port = 3000 },
    dump_sources: ?[]const u8 = if (Environment.isDebug) ".kit-debug" else null,
    verbose_watcher: bool = false,
    // TODO: make it possible to inherit a js VM
};

/// Accepting a custom allocator for all of DevServer would be misleading
/// as there are many functions which will use default_allocator.
const default_allocator = bun.default_allocator;

cwd: []const u8,
dump_dir: ?std.fs.Dir,

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

// Bundling
bundle_thread: BundleThread,

// // Watch + HMR
// bun_watcher: *HotReloader.Watcher,
/// Required by `bun.JSC.NewHotReloader`
bundler: Bundler,
/// Required by `Bundler`
log_do_not_use: Log,

pub const internal_prefix = "/_bun";
pub const client_prefix = internal_prefix ++ "/client";

pub const Route = struct {
    // Config
    pattern: [:0]const u8,
    entry_point: []const u8,

    server_bundle: BundlePromise(ServerBundle) = .unqueued,
    client_bundle: BundlePromise(ClientBundle) = .unqueued,

    /// Assigned in DevServer.init
    dev: *DevServer = undefined,
    client_bundled_url: []u8 = undefined,

    pub fn clientPublicPath(route: *const Route) []const u8 {
        return route.client_bundled_url[0 .. route.client_bundled_url.len - "/client.js".len];
    }
};

/// Prepared server-side bundle and loaded JavaScript module
const ServerBundle = struct {
    files: []OutputFile,
    server_request_callback: JSC.JSValue,
};

/// Preparred client-side bundle.
/// Namespaced to URL: `/_bun/client/:route_index/:file_path`
const ClientBundle = struct {
    files: []OutputFile,
    /// Indexes into this are indexes into `files`.
    /// This is case insensitive because URL paths should be case insensitive.
    files_index: bun.CaseInsensitiveASCIIStringArrayHashMapUnmanaged(void),

    pub fn getFile(bundle: *ClientBundle, filename: []const u8) ?*OutputFile {
        return if (bundle.files_index.getIndex(filename)) |i|
            &bundle.files[i]
        else
            null;
    }
};

pub fn init(options: Options) *DevServer {
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

    const dev = bun.new(DevServer, .{
        .cwd = options.cwd,
        .app = app,
        .routes = options.routes,
        .address = .{
            .port = @intCast(options.listen_config.port),
            .hostname = options.listen_config.host orelse "localhost",
        },
        .listener = null,
        .bundle_thread = BundleThread.uninitialized,
        .server_global = undefined,
        .vm = undefined,
        .dump_dir = dump_dir,
        // .bun_watcher = undefined,
        .bundler = undefined,
        .log_do_not_use = Log.init(bun.failing_allocator),
    });

    dev.bundler = bun.Bundler.init(
        default_allocator,
        &dev.log_do_not_use,
        std.mem.zeroes(bun.Schema.Api.TransformOptions),
        null, // TODO:
    ) catch bun.outOfMemory();

    const loaders = bun.options.loadersFromTransformOptions(default_allocator, null, .bun) catch
        bun.outOfMemory();

    dev.bundler.options = .{
        .entry_points = &.{},
        .define = dev.bundler.options.define,
        .loaders = loaders,
        .log = &dev.log_do_not_use,
        .output_dir = "", // this disables filesystem output
        .output_format = .internal_kit_dev,
        .out_extensions = bun.StringHashMap([]const u8).init(bun.failing_allocator),

        // unused by all code
        .resolve_mode = .dev,
        // technically used (in macro) but should be removed
        .transform_options = std.mem.zeroes(bun.Schema.Api.TransformOptions),
    };
    dev.bundler.configureLinker();
    dev.bundler.resolver.opts = dev.bundler.options;

    // const fs = bun.fs.FileSystem.init(options.cwd) catch @panic("Failed to init FileSystem");
    // dev.bun_watcher = HotReloader.init(dev, fs, options.verbose_watcher, false);
    // dev.bundler.resolver.watcher = dev.bun_watcher.getResolveWatcher();

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

    _ = JSC.WorkPool.get();
    const thread = dev.bundle_thread.spawn() catch |err|
        Output.panic("Failed to spawn bundler thread: {}", .{err});
    thread.detach();

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
        @panic("TODO: handle listen failure");
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
    const asset_name = req.parameter(1);
    dev.getOrEnqueueBundle(resp, route, .client, .{ .file_name = asset_name });
}

fn onServerRequestInit(route: *Route, req: *Request, resp: *Response) void {
    _ = req;
    route.dev.getOrEnqueueBundle(resp, route, .server, .{});
}

// uws with bundle handlers

fn onAssetRequestWithBundle(route: *Route, resp: *Response, ctx: BundleKind.client.Context(), bundle: *ClientBundle) void {
    _ = route;

    const file = bundle.getFile(ctx.file_name) orelse
        return sendBuiltInNotFound(resp);

    sendOutputFile(file, resp);
}

fn onServerRequestWithBundle(route: *Route, resp: *Response, ctx: BundleKind.server.Context(), bundle: *ServerBundle) void {
    _ = ctx; // autofix
    const dev = route.dev;
    const global = dev.server_global.js();

    const context = JSValue.createEmptyObject(global, 1);
    context.put(
        dev.server_global.js(),
        bun.String.static("clientEntryPoint"),
        bun.String.init(route.client_bundled_url).toJS(global),
    );

    const result = bundle.server_request_callback.call(
        global,
        .undefined,
        &.{context},
    ) catch |err| {
        const exception = global.takeException(err);
        const fail: Failure = .{ .request_handler = exception };
        fail.printToConsole(route, .server);
        fail.sendAsHttpResponse(resp, route, .server);
        return;
    };

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
    if (bun_string.tag == .Dead) @panic("TODO NOT STRING");
    defer bun_string.deref();

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

fn sendBuiltInNotFound(resp: *Response) void {
    const message = "404 Not Found";
    resp.writeStatus("404 Not Found");
    resp.end(message, true);
}

// bundling

const BundleKind = enum {
    client,
    server,

    fn Bundle(kind: BundleKind) type {
        return switch (kind) {
            .client => ClientBundle,
            .server => ServerBundle,
        };
    }

    /// Routing information from uws.Request is stack allocated.
    /// This union has no type tag because it can be inferred from surrounding data.
    fn Context(kind: BundleKind) type {
        return switch (kind) {
            .client => struct { file_name: []const u8 },
            .server => struct {},
        };
    }

    inline fn completionFunction(comptime kind: BundleKind) fn (*Route, *Response, kind.Context(), *kind.Bundle()) void {
        return switch (kind) {
            .client => onAssetRequestWithBundle,
            .server => onServerRequestWithBundle,
        };
    }

    const AnyContext: type = @Type(.{
        .Union = .{
            .layout = .auto,
            .tag_type = null,
            .fields = &fields: {
                const values = std.enums.values(BundleKind);
                var fields: [values.len]std.builtin.Type.UnionField = undefined;
                for (&fields, values) |*field, kind| {
                    field.* = .{
                        .name = @tagName(kind),
                        .type = kind.Context(),
                        .alignment = @alignOf(kind.Context()),
                    };
                }
                break :fields fields;
            },
            .decls = &.{},
        },
    });

    inline fn initAnyContext(comptime kind: BundleKind, data: kind.Context()) AnyContext {
        return @unionInit(AnyContext, @tagName(kind), data);
    }
};

/// This will either immediately call `kind.completionFunction()`, or schedule a
/// task to call it when the bundle is ready. The completion function is allowed
/// to use yield.
fn getOrEnqueueBundle(
    dev: *DevServer,
    resp: *Response,
    route: *Route,
    comptime kind: BundleKind,
    ctx: kind.Context(),
) void {
    // const bundler = &dev.bundler;
    const bundle = switch (kind) {
        .client => &route.client_bundle,
        .server => &route.server_bundle,
    };

    switch (bundle.*) {
        .unqueued => {
            // TODO: use an object pool for this. `bun.ObjectPool` needs a refactor before it can be used
            const cb = BundleTask.DeferredRequest.newNode(resp, kind.initAnyContext(ctx));

            const task = bun.new(BundleTask, .{
                .owner = dev,
                .route = route,
                .kind = kind,
                .plugins = null,
                .handlers = .{ .first = cb },
            });
            bundle.* = .{ .pending = task };
            dev.bundle_thread.enqueue(task);
        },
        .pending => |task| {
            const cb = BundleTask.DeferredRequest.newNode(resp, kind.initAnyContext(ctx));
            // This is not a data race, since this list is drained on
            // the same thread as this function is called.
            task.handlers.prepend(cb);
        },
        .failed => |fail| {
            fail.sendAsHttpResponse(resp, route, kind);
        },
        .value => |*val| {
            kind.completionFunction()(route, resp, ctx, val);
        },
    }
}

const BundleThread = bun.bundle_v2.BundleThread(BundleTask);

/// A request to bundle something for development. Has one or more pending HTTP requests.
pub const BundleTask = struct {
    owner: *DevServer,
    route: *Route,
    kind: BundleKind,
    // env: *bun.DotEnv.Loader, // TODO
    plugins: ?*JSC.API.JSBundler.Plugin,
    handlers: DeferredRequest.List,

    next: ?*BundleTask = null,
    result: BundleV2.Result = .{ .pending = {} },

    // initialized in the task itself:
    concurrent_task: JSC.EventLoopTask = undefined,
    bundler: *BundleV2 = undefined,
    log: Log = undefined,

    /// There is no function pointer, route, or context on this struct as all of
    /// this information is inferable from the associated BundleTask
    const DeferredRequest = struct {
        /// When cancelled, this is set to null
        resp: ?*Response,
        /// Only valid if req is non-null
        ctx: BundleKind.AnyContext,

        fn newNode(resp: *Response, ctx: BundleKind.AnyContext) *DeferredRequest.List.Node {
            const node = bun.new(DeferredRequest.List.Node, .{
                .data = .{
                    .resp = resp,
                    .ctx = ctx,
                },
            });
            resp.onAborted(*DeferredRequest, onCancel, &node.data);
            return node;
        }

        fn onCancel(node: *DeferredRequest, resp: *Response) void {
            node.resp = null;
            node.ctx = undefined;
            _ = resp;
        }

        const List = std.SinglyLinkedList(DeferredRequest);
    };

    pub fn completeOnMainThread(task: *BundleTask) void {
        switch (task.kind) {
            inline else => |kind| task.completeOnMainThreadWithKind(kind),
        }
    }

    fn completeOnMainThreadWithKind(task: *BundleTask, comptime kind: BundleKind) void {
        const route = task.route;
        const bundle = switch (kind) {
            .client => &route.client_bundle,
            .server => &route.server_bundle,
        };

        assert(bundle.* == .pending);

        if (task.result == .err) {
            const fail = Failure.fromLog(&task.log);
            fail.printToConsole(route, kind);
            task.finishHttpRequestsFailure(&fail);
            bundle.* = .{ .failed = fail };
            return;
        }

        if (task.log.hasAny()) {
            Output.warn("Warnings {s} for {s}", .{
                @tagName(task.kind),
                route.pattern,
            });
            task.log.printForLogLevel(Output.errorWriter()) catch {};
        }

        const files = task.result.value.output_files.items;
        bun.assert(files.len > 0);

        const dev = route.dev;
        if (dev.dump_dir) |dump_dir| {
            dumpBundle(dump_dir, route, kind, files) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                Output.warn("Could not dump bundle: {}", .{err});
            };
        }

        switch (kind) {
            .client => {
                // Set the capacity to the exact size required to avoid over-allocation
                var files_index: bun.CaseInsensitiveASCIIStringArrayHashMapUnmanaged(void) = .{};
                files_index.entries.setCapacity(default_allocator, files.len) catch bun.outOfMemory();
                files_index.entries.len = files.len;
                for (files_index.keys(), files) |*index_key, file| {
                    var dest_path = file.dest_path;
                    if (bun.strings.hasPrefixComptime(dest_path, "./")) {
                        dest_path = dest_path[2..];
                    }
                    index_key.* = dest_path;
                }
                files_index.reIndex(default_allocator) catch bun.outOfMemory();

                bundle.* = .{ .value = .{
                    .files = files,
                    .files_index = files_index,
                } };
            },
            .server => {
                const entry_point = files[0];
                const code = entry_point.value.buffer.bytes;

                const server_code = c.KitLoadServerCode(dev.server_global, bun.String.createLatin1(code));
                dev.vm.waitForPromise(.{ .internal = server_code.promise });

                switch (server_code.promise.unwrap(dev.vm.jsc, .mark_handled)) {
                    .pending => unreachable, // promise is settled
                    .rejected => |err| {
                        const fail = Failure.fromJSServerLoad(err, dev.server_global.js());
                        fail.printToConsole(task.route, .server);
                        task.finishHttpRequestsFailure(&fail);
                        bundle.* = .{ .failed = fail };
                        return;
                    },
                    .fulfilled => |v| bun.assert(v == .undefined),
                }

                const handler = c.KitGetRequestHandlerFromModule(dev.server_global, server_code.key);

                if (!handler.isCallable(dev.vm.jsc)) {
                    @panic("TODO: handle not callable");
                }

                bundle.* = .{ .value = .{
                    .files = files,
                    .server_request_callback = handler,
                } };
            },
        }

        task.finishHttpRequestsSuccess(kind, &bundle.value);
    }

    fn finishHttpRequestsSuccess(task: *BundleTask, comptime kind: BundleKind, bundle: *kind.Bundle()) void {
        const func = comptime kind.completionFunction();

        while (task.handlers.popFirst()) |node| {
            defer bun.destroy(node);
            if (node.data.resp) |resp| {
                func(task.route, resp, @field(node.data.ctx, @tagName(kind)), bundle);
            }
        }
    }

    fn finishHttpRequestsFailure(task: *BundleTask, failure: *const Failure) void {
        while (task.handlers.popFirst()) |node| {
            defer bun.destroy(node);
            if (node.data.resp) |resp| {
                failure.sendAsHttpResponse(resp, task.route, task.kind);
            }
        }
    }

    pub fn configureBundler(task: *BundleTask, bundler: *Bundler, allocator: Allocator) !void {
        const dev = task.route.dev;

        bundler.* = try bun.Bundler.init(
            allocator,
            &task.log,
            std.mem.zeroes(bun.Schema.Api.TransformOptions),
            null, // TODO:
        );

        const define = bundler.options.define;
        bundler.options = dev.bundler.options;

        bundler.options.define = define;
        bundler.options.entry_points = (&task.route.entry_point)[0..1];
        bundler.options.log = &task.log;
        bundler.options.output_dir = ""; // this disables filesystem outpu;
        bundler.options.output_format = .internal_kit_dev;
        bundler.options.out_extensions = bun.StringHashMap([]const u8).init(bundler.allocator);
        bundler.options.react_fast_refresh = task.kind == .client;

        bundler.options.public_path = switch (task.kind) {
            .client => task.route.clientPublicPath(),
            .server => task.route.dev.cwd,
        };
        bundler.options.target = switch (task.kind) {
            .client => .browser,
            .server => .bun,
        };
        bundler.options.entry_naming = switch (task.kind) {
            // Always name it "client.{js/css}" so that the server can know
            // the entry-point script without waiting on a client bundle.
            .client => "client.[ext]",
            // For uniformity
            .server => "server.[ext]",
        };
        bundler.options.tree_shaking = false;
        bundler.options.minify_syntax = true;

        bundler.configureLinker();
        try bundler.configureDefines();

        // The following are from Vite: https://vitejs.dev/guide/env-and-mode
        // TODO: MODE, BASE_URL
        try bundler.options.define.insert(
            allocator,
            "import.meta.env.DEV",
            Define.Data.initBoolean(true),
        );
        try bundler.options.define.insert(
            allocator,
            "import.meta.env.PROD",
            Define.Data.initBoolean(false),
        );
        try bundler.options.define.insert(
            allocator,
            "import.meta.env.SSR",
            Define.Data.initBoolean(task.kind == .server),
        );

        bundler.resolver.opts = bundler.options;
        bundler.resolver.watcher = dev.bundler.resolver.watcher;
    }

    pub fn completeMini(task: *BundleTask, _: *void) void {
        task.completeOnMainThread();
    }

    pub fn completeOnBundleThread(task: *BundleTask) void {
        task.route.dev.vm.event_loop.enqueueTaskConcurrent(task.concurrent_task.js.from(task, .manual_deinit));
    }
};

/// Bundling should be concurrent, deduplicated, and cached.
/// This acts as a sort of "native promise"
fn BundlePromise(T: type) type {
    return union(enum) {
        unqueued,
        pending: *BundleTask,
        failed: Failure,
        value: T,
    };
}

/// Represents an error from loading or server sided runtime. Information on
/// what this error is from, such as the associated Route, is inferred from
/// surrounding context.
///
/// In the case a route was not able to fully compile, the `Failure` is stored
/// so that a browser refreshing the page can display this failure.
const Failure = union(enum) {
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

    fn printToConsole(fail: *const Failure, route: *const Route, kind: BundleKind) void {
        defer Output.flush();

        Output.prettyErrorln("", .{});

        switch (fail.*) {
            .bundler => |msgs| {
                Output.prettyErrorln("<red>Errors while bundling {s}-side for '{s}'<r>", .{
                    @tagName(kind),
                    route.pattern,
                });
                Output.flush();

                var log: Log = .{ .msgs = msgs, .errors = 1, .level = .err };
                log.printForLogLevelColorsRuntime(
                    Output.errorWriter(),
                    Output.enable_ansi_colors_stderr,
                ) catch {};
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

    fn sendAsHttpResponse(fail: *const Failure, resp: *Response, route: *const Route, kind: BundleKind) void {
        resp.writeStatus("500 Internal Server Error");
        var buffer: [32768]u8 = undefined;

        const message = message: {
            var fbs = std.io.fixedBufferStream(&buffer);
            const writer = fbs.writer();

            switch (fail.*) {
                .bundler => |msgs| {
                    writer.print("Errors while bundling {s}-side for '{s}'\n\n", .{
                        @tagName(kind),
                        route.pattern,
                    }) catch break :message null;

                    var log: Log = .{ .msgs = msgs, .errors = 1, .level = .err };
                    log.printForLogLevelWithEnableAnsiColors(writer, false) catch
                        break :message null;
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
fn dumpBundle(dump_dir: std.fs.Dir, route: *Route, kind: BundleKind, files: []OutputFile) !void {
    for (files) |file| {
        const name = bun.path.joinAbsString("/", &.{
            route.pattern,
            @tagName(kind),
            file.dest_path,
        }, .auto)[1..];
        var inner_dir = try dump_dir.makeOpenPath(bun.Dirname.dirname(u8, name).?, .{});
        defer inner_dir.close();

        switch (file.value) {
            .buffer => |buf| {
                try inner_dir.writeFile(.{ .data = buf.bytes, .sub_path = bun.path.basename(name) });
            },
            else => |t| Output.panic("TODO: implement dumping .{s}", .{@tagName(t)}),
        }
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
        _ = ws.send("bun!", .binary, false, false);
        std.debug.print("open {*} {}\n", .{ dw, ws });
    }

    pub fn onMessage(dw: *DevWebSocket, ws: AnyWebSocket, msg: []const u8, opcode: uws.Opcode) void {
        std.debug.print("message {*} {} {} '{s}'\n", .{ dw, ws, opcode, msg });
    }

    pub fn onClose(dw: *DevWebSocket, ws: AnyWebSocket, exit_code: i32, message: []const u8) void {
        defer bun.destroy(dw);

        std.debug.print("close {*} {} {} '{s}'\n", .{ dw, ws, exit_code, message });
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

pub fn reload(dev: *DevServer) void {
    // TODO: given no arguments, this method is absolutely useless. The watcher
    // must be augmented with more information.
    _ = dev;
    Output.warn("TODO: initiate hot reload", .{});
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("root").bun;
const Environment = bun.Environment;
const assert = bun.assert;

const Log = bun.logger.Log;

const Bundler = bun.bundler.Bundler;
const BundleV2 = bun.bundle_v2.BundleV2;
const Define = bun.options.Define;
const OutputFile = bun.options.OutputFile;

// TODO: consider if using system output is not fit
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
