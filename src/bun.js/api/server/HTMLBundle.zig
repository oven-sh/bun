//! This object is a description of an HTML bundle. It is created by importing an
//! HTML file, and can be passed to the `static` option in `Bun.serve`. The build
//! is done lazily (state held in HTMLBundle.Route or DevServer.RouteBundle.HTML).
pub const HTMLBundle = @This();
pub const js = jsc.Codegen.JSHTMLBundle;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

/// HTMLBundle can be owned by JavaScript as well as any number of Server instances.
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,
global: *JSGlobalObject,
path: []const u8,

/// Initialize an HTMLBundle given a path.
pub fn init(global: *JSGlobalObject, path: []const u8) !*HTMLBundle {
    return bun.new(HTMLBundle, .{
        .ref_count = .init(),
        .global = global,
        .path = try bun.default_allocator.dupe(u8, path),
    });
}

pub fn finalize(this: *HTMLBundle) void {
    this.deref();
}

fn deinit(this: *HTMLBundle) void {
    bun.default_allocator.free(this.path);
    bun.destroy(this);
}

pub fn getIndex(this: *HTMLBundle, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return bun.String.createUTF8ForJS(globalObject, this.path);
}

/// Deprecated: use Route instead.
pub const HTMLBundleRoute = Route;

/// An HTMLBundle can be used across multiple server instances, an
/// HTMLBundle.Route can only be used on one server, but is also
/// reference-counted because a server can have multiple instances of the same
/// html file on multiple endpoints.
pub const Route = struct {
    /// One HTMLBundle.Route can be specified multiple times
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", Route.deinit, .{ .debug_name = "HTMLBundleRoute" });
    pub const ref = Route.RefCount.ref;
    pub const deref = Route.RefCount.deref;

    bundle: RefPtr(HTMLBundle),
    ref_count: Route.RefCount,
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

    method: union(enum) {
        any: void,
        method: bun.http.Method.Set,
    } = .any,

    pub fn memoryCost(this: *const Route) usize {
        var cost: usize = 0;
        cost += @sizeOf(Route);
        cost += this.pending_responses.items.len * @sizeOf(PendingResponse);
        cost += this.state.memoryCost();
        return cost;
    }

    pub fn init(html_bundle: *HTMLBundle) RefPtr(Route) {
        return .new(.{
            .bundle = .initRef(html_bundle),
            .pending_responses = .{},
            .ref_count = .init(),
            .server = null,
            .state = .pending,
        });
    }

    fn deinit(this: *Route) void {
        bun.assert(this.pending_responses.items.len == 0); // pending responses keep a ref to the route
        this.pending_responses.deinit(bun.default_allocator);
        this.bundle.deref();
        this.state.deinit();
        bun.destroy(this);
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

    pub fn onRequest(this: *Route, req: *uws.Request, resp: HTTPResponse) void {
        this.onAnyRequest(req, resp, false);
    }

    pub fn onHEADRequest(this: *Route, req: *uws.Request, resp: HTTPResponse) void {
        this.onAnyRequest(req, resp, true);
    }

    fn onAnyRequest(this: *Route, req: *uws.Request, resp: HTTPResponse, is_head: bool) void {
        this.ref();
        defer this.deref();
        const server: AnyServer = this.server orelse {
            resp.endWithoutBody(true);
            return;
        };

        if (server.config().isDevelopment()) {
            if (server.devServer()) |dev| {
                bun.handleOom(dev.respondForHTMLBundle(this, req, resp));
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
                bun.handleOom(this.scheduleBundle(server));
                continue :state this.state;
            },
            .building => {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - building", .{req.url()});

                // create the PendingResponse, add it to the list
                const pending = bun.new(PendingResponse, .{
                    .method = bun.http.Method.which(req.method()) orelse {
                        resp.writeStatus("405 Method Not Allowed");
                        resp.endWithoutBody(true);
                        return;
                    },
                    .resp = resp,
                    .server = this.server,
                    .route = this,
                });

                bun.handleOom(this.pending_responses.append(bun.default_allocator, pending));

                this.ref();
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
    fn scheduleBundle(this: *Route, server: AnyServer) !void {
        switch (server.getOrLoadPlugins(.{ .html_bundle_route = this })) {
            .err => this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) },
            .ready => |plugins| try onPluginsResolved(this, plugins),
            .pending => this.state = .{ .building = null },
        }
    }

    pub fn onPluginsResolved(this: *Route, plugins: ?*jsc.API.JSBundler.Plugin) !void {
        const global = this.bundle.data.global;
        const server = this.server.?;
        const development = server.config().development;
        const vm = global.bunVM();

        var config: JSBundler.Config = .{};
        errdefer config.deinit(bun.default_allocator);
        try config.entry_points.insert(this.bundle.data.path);
        if (vm.transpiler.options.transform_options.serve_public_path) |public_path| {
            if (public_path.len > 0) {
                try config.public_path.appendSlice(public_path);
            } else {
                try config.public_path.appendChar('/');
            }
        } else {
            try config.public_path.appendChar('/');
        }

        if (vm.transpiler.options.transform_options.serve_env_behavior != ._none) {
            config.env_behavior = vm.transpiler.options.transform_options.serve_env_behavior;

            if (config.env_behavior == .prefix) {
                try config.env_prefix.appendSlice(vm.transpiler.options.transform_options.serve_env_prefix orelse "");
            }
        }

        if (vm.transpiler.options.transform_options.serve_splitting) {
            config.code_splitting = vm.transpiler.options.transform_options.serve_splitting;
        }

        config.target = .browser;
        const is_development = development.isDevelopment();

        if (bun.cli.Command.get().args.serve_minify_identifiers) |minify_identifiers| {
            config.minify.identifiers = minify_identifiers;
        } else if (!is_development) {
            config.minify.identifiers = true;
        }

        if (bun.cli.Command.get().args.serve_minify_whitespace) |minify_whitespace| {
            config.minify.whitespace = minify_whitespace;
        } else if (!is_development) {
            config.minify.whitespace = true;
        }

        if (bun.cli.Command.get().args.serve_minify_syntax) |minify_syntax| {
            config.minify.syntax = minify_syntax;
        } else if (!is_development) {
            config.minify.syntax = true;
        }

        if (bun.cli.Command.get().args.serve_define) |define| {
            bun.assert(define.keys.len == define.values.len);
            try config.define.map.ensureUnusedCapacity(define.keys.len);
            config.define.map.unmanaged.entries.len = define.keys.len;
            @memcpy(config.define.map.keys(), define.keys);
            for (config.define.map.values(), define.values) |*to, from| {
                to.* = bun.handleOom(config.define.map.allocator.dupe(u8, from));
            }
            try config.define.map.reIndex();
        }

        if (!is_development) {
            bun.handleOom(config.define.put("process.env.NODE_ENV", "\"production\""));
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
        completion_task.started_at_ns = bun.getRoughTickCount(.allow_mocked_time).ns();
        completion_task.html_build_task = this;
        this.state = .{ .building = completion_task };

        // While we're building, ensure this doesn't get freed.
        this.ref();
    }

    pub fn onPluginsRejected(this: *Route) !void {
        debug("HTMLBundleRoute(0x{x}) plugins rejected", .{@intFromPtr(this)});
        this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) };
        this.resumePendingResponses();
    }

    pub fn onComplete(this: *Route, completion_task: *bun.BundleV2.JSBundleCompletionTask) void {
        // For the build task.
        defer this.deref();

        switch (completion_task.result) {
            .err => |err| {
                if (bun.Environment.enable_logs)
                    debug("onComplete: err - {s}", .{@errorName(err)});
                this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) };
                bun.handleOom(completion_task.log.cloneToWithRecycled(&this.state.err, true));

                if (this.server) |server| {
                    if (server.config().isDevelopment()) {
                        switch (bun.Output.enable_ansi_colors_stderr) {
                            inline else => |enable_ansi_colors| {
                                const writer = bun.Output.errorWriterBuffered();
                                this.state.err.printWithEnableAnsiColors(writer, enable_ansi_colors) catch {};
                                writer.flush() catch {};
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

                if (server.config().isDevelopment()) {
                    const now = bun.getRoughTickCount(.allow_mocked_time).ns();
                    const duration = now - completion_task.started_at_ns;
                    var duration_f64: f64 = @floatFromInt(duration);
                    duration_f64 /= std.time.ns_per_s;

                    bun.Output.printElapsed(duration_f64);
                    var byte_length: u64 = 0;
                    for (output_files) |*output_file| {
                        byte_length += output_file.size_without_sourcemap;
                    }

                    bun.Output.prettyErrorln(" <green>bundle<r> {s} <d>{d:.2} KB<r>", .{ std.fs.path.basename(this.bundle.data.path), @as(f64, @floatFromInt(byte_length)) / 1000.0 });
                    bun.Output.flush();
                }

                var this_html_route: ?*StaticRoute = null;

                // Create static routes for each output file
                for (output_files) |*output_file| {
                    const blob = jsc.WebCore.Blob.Any{ .Blob = bun.handleOom(output_file.toBlob(bun.default_allocator, globalThis)) };
                    var headers = bun.http.Headers{ .allocator = bun.default_allocator };
                    const content_type = blob.Blob.contentTypeOrMimeType() orelse brk: {
                        bun.debugAssert(false); // should be populated by `output_file.toBlob`
                        break :brk output_file.loader.toMimeType(&.{}).value;
                    };
                    bun.handleOom(headers.append("Content-Type", content_type));
                    // Do not apply etags to html.
                    if (output_file.loader != .html and output_file.value == .buffer) {
                        var hashbuf: [64]u8 = undefined;
                        const etag_str = std.fmt.bufPrint(
                            &hashbuf,
                            "{f}",
                            .{bun.fmt.hexIntLower(output_file.hash)},
                        ) catch |err| switch (err) {
                            error.NoSpaceLeft => unreachable,
                        };
                        bun.handleOom(headers.append("ETag", etag_str));
                        if (!server.config().isDevelopment() and (output_file.output_kind == .chunk))
                            bun.handleOom(headers.append("Cache-Control", "public, max-age=31536000"));
                    }

                    // Add a SourceMap header if we have a source map index
                    // and it's in development mode.
                    if (server.config().isDevelopment()) {
                        if (output_file.source_map_index != std.math.maxInt(u32)) {
                            var route_path = output_files[output_file.source_map_index].dest_path;
                            if (strings.hasPrefixComptime(route_path, "./") or strings.hasPrefixComptime(route_path, ".\\")) {
                                route_path = route_path[1..];
                            }
                            bun.handleOom(headers.append("SourceMap", route_path));
                        }
                    }

                    const static_route = bun.new(StaticRoute, .{
                        .ref_count = .init(),
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

                    bun.handleOom(server.appendStaticRoute(route_path, .{ .static = static_route }, .any));
                }

                const html_route: *StaticRoute = this_html_route orelse @panic("Internal assertion failure: HTML entry point not found in HTMLBundle.");
                const html_route_clone = bun.handleOom(html_route.clone(globalThis));
                this.state = .{ .html = html_route_clone };

                if (!bun.handleOom(server.reloadStaticRoutes())) {
                    // Server has shutdown, so it won't receive any new requests
                    // TODO: handle this case
                }
            },
            .pending => unreachable,
        }

        // Handle pending responses
        this.resumePendingResponses();
    }

    pub fn resumePendingResponses(this: *Route) void {
        var pending = this.pending_responses;
        defer pending.deinit(bun.default_allocator);
        this.pending_responses = .{};
        for (pending.items) |pending_response| {
            defer pending_response.deinit();

            const resp = pending_response.resp;
            const method = pending_response.method;
            if (!pending_response.is_response_pending) {
                // Aborted
                continue;
            }
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
                    if (this.server.?.config().isDevelopment()) {
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
        is_response_pending: bool = true,
        server: ?AnyServer = null,
        route: *Route,

        pub fn deinit(this: *PendingResponse) void {
            if (this.is_response_pending) {
                this.resp.clearAborted();
                this.resp.clearOnWritable();
                this.resp.endWithoutBody(true);
            }
            this.route.deref();
            bun.destroy(this);
        }

        pub fn onAborted(this: *PendingResponse, _: HTTPResponse) void {
            bun.debugAssert(this.is_response_pending == true);
            this.is_response_pending = false;

            // Technically, this could be the final ref count, but we don't want to risk it
            this.route.ref();
            defer this.route.deref();

            while (std.mem.indexOfScalar(*PendingResponse, this.route.pending_responses.items, this)) |index| {
                _ = this.route.pending_responses.orderedRemove(index);
                this.route.deref();
            }
        }
    };
};

const debug = bun.Output.scoped(.HTMLBundle, .hidden);

const StaticRoute = @import("./StaticRoute.zig");
const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const RefPtr = bun.ptr.RefPtr;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const AnyServer = jsc.API.AnyServer;
const JSBundler = jsc.API.JSBundler;

const uws = bun.uws;
const HTTPResponse = bun.uws.AnyResponse;
