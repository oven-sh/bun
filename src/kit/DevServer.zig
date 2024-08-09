//! Instance of the development server. Hosts a web server, controlling a bundler
//! thread and JavaScript VM. All bundles are held in memory.
//!
//! Currently does not have a `deinit()`, as it is assumed to be alive for the
//! remainder of this process' lifespan.
pub const DevServer = @This();

const Options = struct {
    event_loop: EventLoopHandle,
    // TODO: change this so that DevServer can patch the route list after being started
    routes: []Route,
    server_global: *JSC.JSGlobalObject,
    listen_config: uws.AppListenConfig = .{ .port = 3000 },
};

/// Accepting a custom allocator for all of DevServer would be misleading
/// as there are many functions which will use default_allocator.
const default_allocator = bun.default_allocator;

// UWS App
app: *App,
routes: []Route,
address: struct {
    port: u16,
    hostname: [*:0]const u8,
},
listener: ?*App.ListenSocket = null,

// Server Runtime
server_global: *JSC.JSGlobalObject,

// Bundling
event_loop: EventLoopHandle,
define: *Define,
loaders: bun.StringArrayHashMap(bun.options.Loader),
bundle_thread: BundleThread,

pub const Route = struct {
    // Config
    pattern: [:0]const u8,
    server_entry_point: []const u8,
    client_entry_point: []const u8,

    server_bundle: BundlePromise(ServerBundle) = .unqueued,
    client_bundle: BundlePromise(ClientBundle) = .unqueued,

    /// Assigned in DevServer.init
    dev: *DevServer = undefined,
};

/// Prepared server-side bundle and loaded JavaScript module
const ServerBundle = struct {
    files: []OutputFile,
    // server_module: JSC.Strong,
    // server_request_callback: JSC.JSValue,
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
    const app = App.create(.{});

    const define = Define.init(default_allocator, null, null) catch
        bun.outOfMemory();
    const loaders = bun.options.loadersFromTransformOptions(default_allocator, null, .bun) catch
        bun.outOfMemory();

    const dev = bun.new(DevServer, .{
        .app = app,
        .event_loop = options.event_loop,
        .routes = options.routes,
        .address = .{
            .port = @intCast(options.listen_config.port),
            .hostname = options.listen_config.host orelse "localhost",
        },
        .define = define,
        .loaders = loaders,
        .server_global = options.server_global,
        .bundle_thread = .{},
    });

    _ = JSC.WorkPool.get();
    const thread = dev.bundle_thread.spawn() catch |err|
        Output.panic("Failed to spawn bundler thread: {}", .{err});
    thread.detach();

    var has_fallback = false;

    for (options.routes) |*route| {
        route.dev = dev;
        app.any(route.pattern, *Route, route, onServerRequestInit);

        if (bun.strings.eqlComptime(route.pattern, "/*"))
            has_fallback = true;
    }

    app.get("/_bun/client/:route/:asset", *DevServer, dev, onAssetRequestInit);

    if (!has_fallback)
        app.any("/*", void, {}, onFallbackRoute);

    app.listenWithConfig(*DevServer, dev, onListen, options.listen_config);

    return dev;
}

// uws handlers

fn onListen(ctx: *DevServer, maybe_listen: ?*App.ListenSocket) void {
    const listen: *App.ListenSocket = maybe_listen orelse {
        @panic("TODO: handle listen failure");
    };

    ctx.listener = listen;
    ctx.address.port = @intCast(listen.getLocalPort());

    Output.prettyErrorln("--\\> <cyan>http://{s}:{d}<r>\n", .{
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
    _ = req; // autofix
    route.dev.getOrEnqueueBundle(resp, route, .server, .{});
}

// uws with bundle handlers

fn onAssetRequestWithBundle(route: *Route, resp: *Response, ctx: BundleKind.client.Context(), bundle: *ClientBundle) void {
    _ = route;
    std.debug.print("hello {s}\n", .{ctx.file_name});

    for (bundle.files_index.keys()) |k| {
        std.debug.print("w {s}\n", .{k});
    }

    const file = bundle.getFile(ctx.file_name) orelse
        return sendBuiltInNotFound(resp);

    sendOutputFile(file, resp);
}

fn onServerRequestWithBundle(route: *Route, resp: *Response, ctx: BundleKind.server.Context(), bundle: *ServerBundle) void {
    _ = ctx; // autofix
    _ = route; // autofix
    _ = resp; // autofix
    _ = bundle; // autofix
    std.debug.print("TODO", .{});
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

fn sendFailure(fail: *const Failure, resp: *Response) void {
    resp.writeStatus("500 Internal Server Error");
    var buffer: [32768]u8 = undefined;

    const message = message: {
        var fbs = std.io.fixedBufferStream(&buffer);
        const writer = fbs.writer();

        writer.print("{}\n\n", .{fail.err}) catch
            break :message null;

        fail.log.printForLogLevelWithEnableAnsiColors(writer, false) catch
            break :message null;

        break :message fbs.getWritten();
    } orelse message: {
        const suffix = "...truncated";
        @memcpy(buffer[buffer.len - suffix.len ..], suffix);
        break :message &buffer;
    };
    resp.end(message, true); // TODO: "You should never call res.end(huge buffer)"
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
            dev.bundle_thread.queue.push(task);
            dev.bundle_thread.waker.?.wake();
        },
        .pending => |task| {
            const cb = BundleTask.DeferredRequest.newNode(resp, kind.initAnyContext(ctx));
            // This is not a data race, since this list is drained on
            // the same thread as this function is called.
            task.handlers.prepend(cb);
        },
        .failed => @panic("TODO: Show bundle failure to browser"),
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

    // initialzied in the task itself

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
        defer assert(bundle.* != .pending and bundle.* != .unqueued);
        defer assert(task.handlers.first == null);

        if (task.result == .err) {
            // Only log to console once
            Output.err(task.result.err, "Failed to bundle {s} for {s}", .{
                @tagName(task.kind),
                route.pattern,
            });
            task.log.printForLogLevel(Output.errorWriter()) catch {};
            Output.flush();

            // Store the log to print in the browser
            bundle.* = .{ .failed = .{ .log = task.log, .err = task.result.err } };

            task.finishHttpRequestsFailure(&bundle.failed);
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
                @panic("TODO");
            },
        }

        task.finishHttpRequestsSuccess(kind, &bundle.value);
    }

    fn finishHttpRequestsSuccess(
        task: *BundleTask,
        comptime kind: BundleKind,
        bundle: *kind.Bundle(),
    ) void {
        const func = comptime kind.completionFunction();

        while (task.handlers.popFirst()) |node| {
            defer bun.destroy(node);
            if (node.data.resp) |resp| {
                func(task.route, resp, @field(node.data.ctx, @tagName(kind)), bundle);
            }
        }
    }

    fn finishHttpRequestsFailure(
        task: *BundleTask,
        failure: *const Failure,
    ) void {
        while (task.handlers.popFirst()) |node| {
            defer bun.destroy(node);
            if (node.data.resp) |resp| {
                sendFailure(failure, resp);
            }
        }
    }

    pub fn configureBundler(task: *BundleTask, bundler: *Bundler, allocator: Allocator) !void {
        bundler.* = try bun.Bundler.init(
            allocator,
            &task.log,
            std.mem.zeroes(bun.Schema.Api.TransformOptions),
            null, // TODO:
        );

        bundler.options = .{
            .entry_points = undefined,
            .define = task.route.dev.define,
            .loaders = task.route.dev.loaders,
            .log = &task.log,
            .output_dir = "", // this disables filesystem output
            .public_path = "/_kit/",
            .out_extensions = bun.StringHashMap([]const u8).init(bundler.allocator),

            // unused by all code
            .resolve_mode = .dev,
            // technically used (in macro) but should be removed
            .transform_options = std.mem.zeroes(bun.Schema.Api.TransformOptions),
        };

        bundler.configureLinker();

        // don't use &.{ ... }
        bundler.options.entry_points = switch (task.kind) {
            .client => (&task.route.client_entry_point)[0..1],
            .server => (&task.route.server_entry_point)[0..1],
        };

        bundler.resolver.opts = bundler.options;
    }

    pub fn completeMini(task: *BundleTask, _: *void) void {
        task.completeOnMainThread();
    }

    pub fn completeOnBundleThread(task: *BundleTask) void {
        const dev = task.route.dev;
        task.concurrent_task = switch (dev.event_loop) {
            .js => .{ .js = undefined },
            .mini => .{ .mini = undefined },
        };
        if (dev.event_loop == .js) {
            dev.event_loop.js.enqueueTaskConcurrent(task.concurrent_task.js.from(task, .manual_deinit));
        } else {
            dev.event_loop.mini.enqueueTaskConcurrent(task.concurrent_task.mini.from(task, "completeMini"));
        }
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

        pub fn deinit(r: T) void {
            switch (r) {
                .unqueued, .failed => {},
                .pending => @panic("TODO"),
                .value => |v| v.deinit(),
            }
        }
    };
}

/// Represents an error and it's associated log.
/// These are stored to provide in-browser error messages.
const Failure = struct {
    log: Log,
    err: anyerror,

    fn deinit(fail: Failure) void {
        fail.log.deinit();
    }
};

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
const Request = uws.Request;
const Response = App.Response;
const MimeType = bun.http.MimeType;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const EventLoopHandle = bun.JSC.EventLoopHandle;
