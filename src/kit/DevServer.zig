//! Instance of development server. Currently does not have a `deinit()`, as it
//! is assumed to be alive for the remainder of this process' lifespan.
pub const DevServer = @This();

const Options = struct {
    event_loop: AnyEventLoop,
    routes: []Route,
    server_global: *JSC.JSGlobalObject,
    listen_config: uws.AppListenConfig = .{ .port = 3000 },
};

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

/// `Bundler` states are shared between bundles with the assumption that
/// there is one bundle at once.
// bundle_arena: bun.ArenaAllocator,
// bundler: Bundler,
// log: bun.logger.Log,
event_loop: AnyEventLoop,
define: *Define,
loaders: bun.StringArrayHashMap(bun.options.Loader),
bundle_thread: BundleThread,

const Route = struct {
    pattern: [:0]const u8,
    server_entry_point: []const u8,

    server_bundle: ?BundledRoute = null,

    /// Assigned in DevServer.init
    dev: *DevServer = undefined,
};

const BundledRoute = struct {
    files: ?[]OutputFile,
};

pub fn init(options: Options) *DevServer {
    // Accepting a custom allocator in this function would be misleading
    // as there are some hidden allocations using `default_allocator`.
    const alloc = bun.default_allocator;

    // Ensure this exists before we spawn the bundler thread
    _ = JSC.WorkPool.get();

    const app = App.create(.{});

    const define = Define.init(alloc, null, null) catch
        bun.outOfMemory();
    const loaders = bun.options.loadersFromTransformOptions(alloc, null, .bun) catch
        bun.outOfMemory();

    const dev = bun.new(DevServer, .{
        .app = app,
        .event_loop = options.event_loop,
        .routes = options.routes,
        .address = .{
            .port = @intCast(options.listen_config.port),
            .hostname = options.listen_config.host orelse "localhost",
        },
        .bundle_thread = .{},
        // .log = bun.logger.Log.init(alloc),
        .define = define,
        .loaders = loaders,
        .server_global = options.server_global,
    });

    // dev.bundler = Bundler.init(
    //     alloc,
    //     &dev.log,
    //     std.mem.zeroes(bun.Schema.Api.TransformOptions),
    //     null,
    // ) catch |err| switch (err) {
    //     error.OutOfMemory => bun.outOfMemory(),
    //     else => Output.panic("Failed to start: {}", .{err}),
    // };
    // dev.bundler.configureLinker();

    dev.bundle_thread.spawn();

    for (options.routes) |*route| {
        route.dev = dev;
        app.any("/", *Route, route, onRequest);
    }

    app.get("/_bun/client/:asset", *DevServer, dev, onRequest);

    app.listenWithConfig(*DevServer, dev, onListen, options.listen_config);

    return dev;
}

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

fn onRequest(route: *Route, req: *Request, resp: *Response) void {
    _ = req; // autofix

    const dev = route.dev;
    const bundle = dev.getServerBundle(route) catch {
        resp.writeStatus("500 Internal Server Error");
        resp.end("", true);
        return;
    };

    resp.writeStatus("202 OK");
    resp.writeHeader("content-type", MimeType.text.value);

    const content = bundle.outputs.value.buffer.bytes;
    resp.writeHeaderInt("content-length", content.len);
    resp.end(content, true);
}

fn getServerBundle(dev: *DevServer, route: *Route) !*BundledRoute {
    if (route.server_bundle) |*ptr| return ptr;

    const bundler = &dev.bundler;

    var timer = std.time.Timer.start() catch null;

    bundler.options = .{
        .entry_points = &.{route.server_entry_point},
        .define = dev.define,
        .loaders = dev.loaders,
        .log = &dev.log,
        .output_dir = "",
        .public_path = "/_kit/", // write no files to disk
        .out_extensions = bun.StringHashMap([]const u8).init(bundler.allocator),

        // unused by all code
        .resolve_mode = .dev,
        // technically used (in macro) but should be removed
        .transform_options = std.mem.zeroes(bun.Schema.Api.TransformOptions),
    };

    bundler.resolver.opts = bundler.options;

    defer dev.log.reset();

    var useless_duration: u64 = 0;
    var input_code_length: u64 = 0;
    var reachable_file_count: usize = 0;
    const outputs = BundleV2.generateFromCLI(
        bundler,
        bundler.allocator,
        dev.event_loop,
        std.crypto.random.int(u64),
        false, // TODO: watch
        &reachable_file_count,
        &useless_duration,
        &input_code_length,
    ) catch |err| {
        bun.handleErrorReturnTrace(err, @errorReturnTrace());

        if (dev.log.hasAny()) {
            dev.log.printForLogLevel(Output.errorWriter()) catch {};
        } else {
            // Reaching this path is always a bug or Out of memory.
            Output.err(err, "Bundle failed but with no error messages", .{});
        }

        Output.flush();

        return err;
    };

    if (timer) |*t| {
        Output.println("Bundle in {d}ms\n", .{
            @divFloor(t.read(), std.time.ns_per_ms),
        });
        Output.flush();
    }

    route.server_bundle = .{
        .files = outputs.items,
    };

    return &route.server_bundle.?;
}

///
const BundleThread = struct {
    waker: ?bun.Async.Waker = null,
    queue: bun.UnboundedQueue(BundleTask, .next) = .{},

    fn spawn(thread: *BundleThread) void {
        assert(thread.waker == null);
    }

    fn devServer(thread: *BundleThread) *DevServer {
        return @fieldParentPtr("bundle_thread", thread);
    }

    fn main(thread: *BundleThread) void {
        _ = thread; // autofix
        Output.Source.configureNamedThread("Bundle Manager");
    }
};

pub const BundleTask = struct {
    owner: *DevServer,
    log: Log,
    next: ?*BundleTask = null,
};

fn enqueueBundleTask() void {}

const std = @import("std");

const bun = @import("root").bun;
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
const AnyEventLoop = bun.JSC.AnyEventLoop;
