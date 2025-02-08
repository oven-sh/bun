//! This object is a description of an HTML bundle. It is created by importing an
//! HTML file, and can be passed to the `static` option in `Bun.serve`. The build
//! is done lazily (state held in HTMLBundle.Route or DevServer.RouteBundle.HTML).
pub const HTMLBundle = @This();
pub usingnamespace JSC.Codegen.JSHTMLBundle;
// HTMLBundle can be owned by JavaScript as well as any number of Server instances.
pub usingnamespace bun.NewRefCounted(HTMLBundle, deinit, null);

ref_count: u32 = 1,
global: *JSGlobalObject,
path: []const u8,

/// Initialize an HTMLBundle given a path.
pub fn init(global: *JSGlobalObject, path: []const u8) !*HTMLBundle {
    return HTMLBundle.new(.{
        .global = global,
        .path = try bun.default_allocator.dupe(u8, path),
    });
}

pub fn finalize(this: *HTMLBundle) void {
    this.deref();
}

pub fn deinit(this: *HTMLBundle) void {
    bun.default_allocator.free(this.path);
    this.destroy();
}

pub fn getIndex(this: *HTMLBundle, globalObject: *JSGlobalObject) JSValue {
    var str = bun.String.createUTF8(this.path);
    return str.transferToJS(globalObject);
}

// TODO: Rename to `Route`
/// An HTMLBundle can be used across multiple server instances, an
/// HTMLBundle.Route can only be used on one server, but is also
/// reference-counted because a server can have multiple instances of the same
/// html file on multiple endpoints.
pub const HTMLBundleRoute = struct {
    /// Rename to `bundle`
    html_bundle: *HTMLBundle,
    ref_count: u32 = 1,
    // TODO: attempt to remove the null case. null is only present during server
    // initialization as only a ServerConfig object is present.
    server: ?AnyServer = null,
    /// When using DevServer, this value is never read or written to.
    state: State,
    /// Written and read by DevServer to identify if this route has been
    /// registered with the bundler.
    dev_server_id: bun.bake.DevServer.RouteBundle.Index.Optional = .none,
    /// When state == .pending, incomplete responses are stored here.
    pending_responses: std.ArrayListUnmanaged(*PendingResponse) = .{},

    /// One HTMLBundle.Route can be specified multiple times
    pub usingnamespace bun.NewRefCounted(@This(), _deinit, null);

    pub fn memoryCost(this: *const HTMLBundleRoute) usize {
        var cost: usize = 0;
        cost += @sizeOf(HTMLBundleRoute);
        cost += this.pending_responses.items.len * @sizeOf(PendingResponse);
        cost += this.state.memoryCost();
        return cost;
    }

    pub fn init(html_bundle: *HTMLBundle) *HTMLBundleRoute {
        html_bundle.ref();
        return HTMLBundleRoute.new(.{
            .html_bundle = html_bundle,
            .pending_responses = .{},
            .ref_count = 1,
            .server = null,
            .state = .pending,
        });
    }

    pub const State = union(enum) {
        pending,
        building: ?*bun.BundleV2.JSBundleCompletionTask,
        err: bun.logger.Log,
        html: *StaticRoute,

        pub fn deinit(this: *State) void {
            switch (this.*) {
                .err => |*log| {
                    log.deinit();
                },
                .building => |completion| if (completion) |c| {
                    c.cancelled = true;
                    c.deref();
                },
                .html => {
                    this.html.deref();
                },
                .pending => {},
            }
        }

        pub fn memoryCost(this: *const State) usize {
            return switch (this.*) {
                .pending => 0,
                .building => 0,
                .err => |log| log.memoryCost(),
                .html => |html| html.memoryCost(),
            };
        }
    };

    fn _deinit(this: *HTMLBundleRoute) void {
        for (this.pending_responses.items) |pending_response| {
            pending_response.deref();
        }
        this.pending_responses.deinit(bun.default_allocator);
        this.html_bundle.deref();
        this.state.deinit();
        this.destroy();
    }

    pub fn onRequest(this: *HTMLBundleRoute, req: *uws.Request, resp: HTTPResponse) void {
        this.onAnyRequest(req, resp, false);
    }

    pub fn onHEADRequest(this: *HTMLBundleRoute, req: *uws.Request, resp: HTTPResponse) void {
        this.onAnyRequest(req, resp, true);
    }

    fn onAnyRequest(this: *HTMLBundleRoute, req: *uws.Request, resp: HTTPResponse, is_head: bool) void {
        this.ref();
        defer this.deref();
        const server: AnyServer = this.server orelse {
            resp.endWithoutBody(true);
            return;
        };

        if (server.config().development) {
            if (server.devServer()) |dev| {
                dev.respondForHTMLBundle(this, req, resp) catch bun.outOfMemory();
                return;
            }

            // Simpler development workflow which rebundles on every request.
            if (this.state == .html) {
                this.state.html.deref();
                this.state = .pending;
            } else if (this.state == .err) {
                this.state.err.deinit();
                this.state = .pending;
            }
        }

        state: switch (this.state) {
            .pending => {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - pending", .{req.url()});
                this.scheduleBundle(server) catch bun.outOfMemory();
                continue :state this.state;
            },
            .building => {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - building", .{req.url()});

                // create the PendingResponse, add it to the list
                var pending = PendingResponse.new(.{
                    .method = bun.http.Method.which(req.method()) orelse {
                        resp.writeStatus("405 Method Not Allowed");
                        resp.endWithoutBody(true);
                        return;
                    },
                    .resp = resp,
                    .server = this.server,
                    .route = this,
                    .ref_count = 1,
                });

                this.pending_responses.append(bun.default_allocator, pending) catch bun.outOfMemory();

                this.ref();
                pending.ref();
                resp.onAborted(*PendingResponse, PendingResponse.onAborted, pending);
                req.setYield(false);
            },
            .err => |log| {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - err", .{req.url()});
                _ = log; // TODO: use the code from DevServer.zig to render the error
                resp.endWithoutBody(true);
            },
            .html => |html| {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - html", .{req.url()});
                if (is_head) {
                    html.onHEADRequest(req, resp);
                } else {
                    html.onRequest(req, resp);
                }
            },
        }
    }

    /// Schedule a bundle to be built.
    /// If success, bumps the ref count and returns true;
    fn scheduleBundle(this: *HTMLBundleRoute, server: AnyServer) !void {
        switch (server.getOrLoadPlugins(.{ .html_bundle_route = this })) {
            .err => this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) },
            .ready => |plugins| try onPluginsResolved(this, plugins),
            .pending => this.state = .{ .building = null },
        }
    }

    pub fn onPluginsResolved(this: *HTMLBundleRoute, plugins: ?*bun.JSC.API.JSBundler.Plugin) !void {
        const global = this.html_bundle.global;
        const server = this.server.?;
        const development = server.config().development;
        const vm = global.bunVM();

        var config: JSBundler.Config = .{};
        errdefer config.deinit(bun.default_allocator);
        try config.entry_points.insert(this.html_bundle.path);
        try config.public_path.appendChar('/');
        config.target = .browser;

        if (bun.CLI.Command.get().args.serve_minify_identifiers) |minify_identifiers| {
            config.minify.identifiers = minify_identifiers;
        } else if (!development) {
            config.minify.identifiers = true;
        }

        if (bun.CLI.Command.get().args.serve_minify_whitespace) |minify_whitespace| {
            config.minify.whitespace = minify_whitespace;
        } else if (!development) {
            config.minify.whitespace = true;
        }

        if (bun.CLI.Command.get().args.serve_minify_syntax) |minify_syntax| {
            config.minify.syntax = minify_syntax;
        } else if (!development) {
            config.minify.syntax = true;
        }

        if (!development) {
            config.define.put("process.env.NODE_ENV", "\"production\"") catch bun.outOfMemory();
            config.jsx.development = false;
        } else {
            config.force_node_env = .development;
            config.jsx.development = true;
        }
        config.source_map = .linked;

        const completion_task = try bun.BundleV2.createAndScheduleCompletionTask(
            config,
            plugins,
            global,
            vm.eventLoop(),
            bun.default_allocator,
        );
        completion_task.started_at_ns = bun.getRoughTickCount().ns();
        completion_task.html_build_task = this;
        this.state = .{ .building = completion_task };

        // While we're building, ensure this doesn't get freed.
        this.ref();
    }

    pub fn onPluginsRejected(this: *HTMLBundleRoute) !void {
        debug("HTMLBundleRoute(0x{x}) plugins rejected", .{@intFromPtr(this)});
        this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) };
        this.resumePendingResponses();
    }

    pub fn onComplete(this: *HTMLBundleRoute, completion_task: *bun.BundleV2.JSBundleCompletionTask) void {
        // For the build task.
        defer this.deref();

        switch (completion_task.result) {
            .err => |err| {
                if (bun.Environment.enable_logs)
                    debug("onComplete: err - {s}", .{@errorName(err)});
                this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) };
                completion_task.log.cloneToWithRecycled(&this.state.err, true) catch bun.outOfMemory();

                if (this.server) |server| {
                    if (server.config().development) {
                        switch (bun.Output.enable_ansi_colors_stderr) {
                            inline else => |enable_ansi_colors| {
                                var writer = bun.Output.errorWriterBuffered();
                                this.state.err.printWithEnableAnsiColors(&writer, enable_ansi_colors) catch {};
                                writer.context.flush() catch {};
                            },
                        }
                    }
                }
            },
            .value => |bundle| {
                if (bun.Environment.enable_logs)
                    debug("onComplete: success", .{});
                // Find the HTML entry point and create static routes
                const server: AnyServer = this.server orelse return;
                const globalThis = server.globalThis();
                const output_files = bundle.output_files.items;

                if (server.config().development) {
                    const now = bun.getRoughTickCount().ns();
                    const duration = now - completion_task.started_at_ns;
                    var duration_f64: f64 = @floatFromInt(duration);
                    duration_f64 /= std.time.ns_per_s;

                    bun.Output.printElapsed(duration_f64);
                    var byte_length: u64 = 0;
                    for (output_files) |*output_file| {
                        byte_length += output_file.size_without_sourcemap;
                    }

                    bun.Output.prettyErrorln(" <green>bundle<r> {s} <d>{d:.2} KB<r>", .{ std.fs.path.basename(this.html_bundle.path), @as(f64, @floatFromInt(byte_length)) / 1000.0 });
                    bun.Output.flush();
                }

                var this_html_route: ?*StaticRoute = null;

                // Create static routes for each output file
                for (output_files) |*output_file| {
                    const blob = JSC.WebCore.AnyBlob{ .Blob = output_file.toBlob(bun.default_allocator, globalThis) catch bun.outOfMemory() };
                    var headers = JSC.WebCore.Headers{ .allocator = bun.default_allocator };
                    headers.append("Content-Type", blob.Blob.contentTypeOrMimeType() orelse output_file.loader.toMimeType().value) catch bun.outOfMemory();
                    // Do not apply etags to html.
                    if (output_file.loader != .html and output_file.value == .buffer) {
                        var hashbuf: [64]u8 = undefined;
                        const etag_str = std.fmt.bufPrint(&hashbuf, "{}", .{bun.fmt.hexIntLower(output_file.hash)}) catch bun.outOfMemory();
                        headers.append("ETag", etag_str) catch bun.outOfMemory();
                        if (!server.config().development and (output_file.output_kind == .chunk))
                            headers.append("Cache-Control", "public, max-age=31536000") catch bun.outOfMemory();
                    }

                    // Add a SourceMap header if we have a source map index
                    // and it's in development mode.
                    if (server.config().development) {
                        if (output_file.source_map_index != std.math.maxInt(u32)) {
                            var route_path = output_files[output_file.source_map_index].dest_path;
                            if (strings.hasPrefixComptime(route_path, "./") or strings.hasPrefixComptime(route_path, ".\\")) {
                                route_path = route_path[1..];
                            }
                            headers.append("SourceMap", route_path) catch bun.outOfMemory();
                        }
                    }

                    const static_route = StaticRoute.new(.{
                        .blob = blob,
                        .server = server,
                        .status_code = 200,
                        .headers = headers,
                        .cached_blob_size = blob.size(),
                    });

                    if (this_html_route == null and output_file.output_kind == .@"entry-point") {
                        if (output_file.loader == .html) {
                            this_html_route = static_route;
                        }
                    }

                    var route_path = output_file.dest_path;

                    // The route path gets cloned inside of appendStaticRoute.
                    if (strings.hasPrefixComptime(route_path, "./") or strings.hasPrefixComptime(route_path, ".\\")) {
                        route_path = route_path[1..];
                    }

                    server.appendStaticRoute(route_path, .{ .StaticRoute = static_route }) catch bun.outOfMemory();
                }

                const html_route: *StaticRoute = this_html_route orelse @panic("Internal assertion failure: HTML entry point not found in HTMLBundle.");
                const html_route_clone = html_route.clone(globalThis) catch bun.outOfMemory();
                this.state = .{ .html = html_route_clone };

                if (!(server.reloadStaticRoutes() catch bun.outOfMemory())) {
                    // Server has shutdown, so it won't receive any new requests
                    // TODO: handle this case
                }
            },
            .pending => unreachable,
        }

        // Handle pending responses
        this.resumePendingResponses();
    }

    pub fn resumePendingResponses(this: *HTMLBundleRoute) void {
        var pending = this.pending_responses;
        defer pending.deinit(bun.default_allocator);
        this.pending_responses = .{};
        for (pending.items) |pending_response| {
            defer pending_response.deref(); // First ref for being in the pending items array.

            const resp = pending_response.resp;
            const method = pending_response.method;
            if (!pending_response.is_response_pending) {
                // Aborted
                continue;
            }
            // Second ref for UWS abort callback.
            defer pending_response.deref();

            pending_response.is_response_pending = false;
            resp.clearAborted();

            switch (this.state) {
                .html => |html| {
                    if (method == .HEAD) {
                        html.onHEAD(resp);
                    } else {
                        html.on(resp);
                    }
                },
                .err => |log| {
                    if (this.server.?.config().development) {
                        _ = log; // TODO: use the code from DevServer.zig to render the error
                    } else {
                        // To protect privacy, do not show errors to end users in production.
                        // TODO: Show a generic error page.
                    }
                    resp.writeStatus("500 Build Failed");
                    resp.endWithoutBody(false);
                },
                else => {
                    resp.endWithoutBody(false);
                },
            }
        }
    }

    /// Represents an in-flight response before the bundle has finished building.
    pub const PendingResponse = struct {
        method: bun.http.Method,
        resp: HTTPResponse,
        ref_count: u32 = 1,
        is_response_pending: bool = true,
        server: ?AnyServer = null,
        route: *HTMLBundleRoute,

        pub usingnamespace bun.NewRefCounted(@This(), destroyInternal, null);

        fn destroyInternal(this: *PendingResponse) void {
            if (this.is_response_pending) {
                this.resp.clearAborted();
                this.resp.clearOnWritable();
                this.resp.endWithoutBody(true);
            }
            this.route.deref();
            this.destroy();
        }

        pub fn onAborted(this: *PendingResponse, resp: HTTPResponse) void {
            _ = resp; // autofix
            bun.debugAssert(this.is_response_pending == true);
            this.is_response_pending = false;

            // Technically, this could be the final ref count, but we don't want to risk it
            this.route.ref();
            defer this.route.deref();

            while (std.mem.indexOfScalar(*PendingResponse, this.route.pending_responses.items, this)) |index| {
                _ = this.route.pending_responses.orderedRemove(index);
                this.route.deref();
            }

            this.deref();
        }
    };
};

const bun = @import("root").bun;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSString = JSC.JSString;
const JSValueRef = JSC.JSValueRef;
const JSBundler = JSC.API.JSBundler;
const HTTPResponse = bun.uws.AnyResponse;
const uws = bun.uws;
const AnyServer = JSC.API.AnyServer;
const StaticRoute = @import("./StaticRoute.zig");

const debug = bun.Output.scoped(.HTMLBundle, true);
const strings = bun.strings;
