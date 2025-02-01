// This is a description of what the build will be.
// It doesn't do the build.

ref_count: u32 = 1,
globalObject: *JSGlobalObject,
path: []const u8,
config: bun.JSC.API.JSBundler.Config,
plugins: union(enum) {
    pending: ?[]const []const u8,
    result: ?*bun.JSC.API.JSBundler.Plugin,
},
bunfig_dir: []const u8,

/// Initialize an HTMLBundle.a
///
/// `plugins` is array of serve plugins defined in the bunfig.toml file. They will be resolved and loaded.
/// `bunfig_path` is the path to the bunfig.toml configuration file. It used to resolve the plugins relative
/// to the bunfig.toml file.
pub fn init(
    globalObject: *JSGlobalObject,
    path: []const u8,
    bunfig_path: []const u8,
    plugins: ?[]const []const u8,
) !*HTMLBundle {
    var config = bun.JSC.API.JSBundler.Config{};
    try config.entry_points.insert(path);
    config.target = .browser;
    try config.public_path.appendChar('/');
    return HTMLBundle.new(.{
        .globalObject = globalObject,
        .path = try bun.default_allocator.dupe(u8, path),
        .config = config,
        .plugins = .{
            .pending = plugins,
        },
        .bunfig_dir = bun.path.dirname(bunfig_path, .auto),
    });
}

pub fn finalize(this: *HTMLBundle) void {
    this.deref();
}

pub fn deinit(this: *HTMLBundle) void {
    bun.default_allocator.free(this.path);
    this.config.deinit(bun.default_allocator);
    this.destroy();
}

pub fn getIndex(this: *HTMLBundle, globalObject: *JSGlobalObject) JSValue {
    var str = bun.String.createUTF8(this.path);
    return str.transferToJS(globalObject);
}

pub const HTMLBundleRoute = struct {
    html_bundle: *HTMLBundle,
    pending_responses: std.ArrayListUnmanaged(*PendingResponse) = .{},
    ref_count: u32 = 1,
    server: ?AnyServer = null,
    value: Value = .pending_plugins,

    pub fn memoryCost(this: *const HTMLBundleRoute) usize {
        var cost: usize = 0;
        cost += @sizeOf(HTMLBundleRoute);
        cost += this.pending_responses.items.len * @sizeOf(PendingResponse);
        cost += this.value.memoryCost();
        return cost;
    }

    pub fn init(html_bundle: *HTMLBundle) *HTMLBundleRoute {
        return HTMLBundleRoute.new(.{
            .html_bundle = html_bundle,
            .pending_responses = .{},
            .ref_count = 1,
            .server = null,
            .value = .pending_plugins,
        });
    }

    pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

    pub const Value = union(enum) {
        pending_plugins,
        pending: void,
        building: *bun.BundleV2.JSBundleCompletionTask,
        err: bun.logger.Log,
        html: *StaticRoute,

        pub fn deinit(this: *Value) void {
            switch (this.*) {
                .err => |*log| {
                    log.deinit();
                },
                .pending_plugins => {},
                .building => |completion| {
                    completion.cancelled = true;
                    completion.deref();
                },
                .html => {
                    this.html.deref();
                },
                .pending => {},
            }
        }

        pub fn memoryCost(this: *const Value) usize {
            return switch (this.*) {
                .pending_plugins => 0,
                .pending => 0,
                .building => 0,
                .err => |log| log.memoryCost(),
                .html => |html| html.memoryCost(),
            };
        }
    };

    pub fn deinit(this: *HTMLBundleRoute) void {
        for (this.pending_responses.items) |pending_response| {
            pending_response.deref();
        }
        this.pending_responses.deinit(bun.default_allocator);
        this.html_bundle.deref();
        this.value.deinit();
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
            // TODO: actually implement proper watch mode instead of "rebuild on every request"
            if (this.value == .html) {
                this.value.html.deref();
                this.value = .pending_plugins;
            } else if (this.value == .err) {
                this.value.err.deinit();
                this.value = .pending_plugins;
            }
        }

        if (this.value == .pending_plugins) out_of_pending_plugins: {
            var plugins: ?*bun.JSC.API.JSBundler.Plugin = null;
            switch (this.html_bundle.plugins) {
                .pending => |raw_plugins| have_plugins: {
                    if (raw_plugins == null or raw_plugins.?.len == 0) {
                        break :have_plugins;
                    }

                    switch (server.getPlugins()) {
                        .pending => {},
                        .err => {
                            this.value = .{ .err = bun.logger.Log.init(bun.default_allocator) };
                            break :out_of_pending_plugins;
                        },
                        .found => |result| {
                            plugins = result;
                            break :have_plugins;
                        },
                    }

                    this.value = .pending_plugins;
                    break :out_of_pending_plugins;
                },
                .result => |existing_plugins| {
                    plugins = existing_plugins;
                },
            }
            debug("HTMLBundleRoute(0x{x}) plugins resolved", .{@intFromPtr(this)});
            this.html_bundle.plugins = .{ .result = plugins };
            this.value = .pending;
        }

        if (this.value == .pending) {
            if (bun.Environment.enable_logs)
                debug("onRequest: {s} - pending", .{req.url()});

            const success = this.scheduleBundle(server);
            if (!success) {
                resp.endWithoutBody(true);
                bun.outOfMemory();
                return;
            }
        }

        switch (this.value) {
            .pending => unreachable,

            .building, .pending_plugins => {
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

                this.pending_responses.append(bun.default_allocator, pending) catch {
                    pending.deref();
                    resp.endWithoutBody(true);
                    bun.outOfMemory();
                    return;
                };

                this.ref();
                pending.ref();
                resp.onAborted(*PendingResponse, PendingResponse.onAborted, pending);
                req.setYield(false);

                if (this.value == .pending_plugins) {
                    const raw_plugins = this.html_bundle.plugins.pending.?;
                    const bunfig_folder = this.html_bundle.bunfig_dir;
                    this.ref();
                    debug("HTMLBundleRoute(0x{x}) resolving plugins...", .{@intFromPtr(this)});
                    server.loadAndResolvePlugins(this, raw_plugins, bunfig_folder);
                }
            },
            .err => |log| {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - err", .{req.url()});
                _ = log; // autofix
                // use the code from server.zig to render the error
                resp.endWithoutBody(true);
            },
            .html => |html| {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - html", .{req.url()});
                // we already have the html, so we can just serve it
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
    /// Returns false if the bundle task could not be scheduled.
    fn scheduleBundle(this: *HTMLBundleRoute, server: AnyServer) bool {
        const globalThis = server.globalThis();
        const vm = globalThis.bunVM();
        const plugins = this.html_bundle.plugins.result;

        var config = this.html_bundle.config;
        config.entry_points = config.entry_points.clone() catch bun.outOfMemory();
        config.public_path = config.public_path.clone() catch bun.outOfMemory();
        config.define = config.define.clone() catch bun.outOfMemory();

        if (bun.CLI.Command.get().args.serve_minify_identifiers) |minify_identifiers| {
            config.minify.identifiers = minify_identifiers;
        } else if (!server.config().development) {
            config.minify.identifiers = true;
        }

        if (bun.CLI.Command.get().args.serve_minify_whitespace) |minify_whitespace| {
            config.minify.whitespace = minify_whitespace;
        } else if (!server.config().development) {
            config.minify.whitespace = true;
        }

        if (bun.CLI.Command.get().args.serve_minify_syntax) |minify_syntax| {
            config.minify.syntax = minify_syntax;
        } else if (!server.config().development) {
            config.minify.syntax = true;
        }

        if (!server.config().development) {
            config.define.put("process.env.NODE_ENV", "\"production\"") catch bun.outOfMemory();
        }

        config.source_map = .linked;

        const completion_task = bun.BundleV2.createAndScheduleCompletionTask(
            config,
            plugins,
            globalThis,
            vm.eventLoop(),
            bun.default_allocator,
        ) catch {
            return false;
        };
        completion_task.started_at_ns = bun.getRoughTickCount().ns();
        completion_task.html_build_task = this;
        this.value = .{ .building = completion_task };

        // While we're building, ensure this doesn't get freed.
        this.ref();
        return true;
    }

    pub fn onPluginsResolved(this: *HTMLBundleRoute, plugins: ?*bun.JSC.API.JSBundler.Plugin) void {
        debug("HTMLBundleRoute(0x{x}) plugins resolved", .{@intFromPtr(this)});
        this.html_bundle.plugins = .{ .result = plugins };
        // TODO: is this even possible?
        if (this.value != .pending_plugins) {
            return;
        }

        const server: AnyServer = this.server orelse return;
        const success = this.scheduleBundle(server);

        if (!success) {
            var pending = this.pending_responses;
            defer pending.deinit(bun.default_allocator);
            this.pending_responses = .{};
            for (pending.items) |pending_response| {
                // for the list of pending responses
                defer pending_response.deref();
                pending_response.resp.endWithoutBody(true);
            }
        }
    }

    pub fn onPluginsRejected(this: *HTMLBundleRoute) void {
        debug("HTMLBundleRoute(0x{x}) plugins rejected", .{@intFromPtr(this)});
        this.value = .{ .err = bun.logger.Log.init(bun.default_allocator) };

        this.resumePendingResponses();
    }

    pub fn onComplete(this: *HTMLBundleRoute, completion_task: *bun.BundleV2.JSBundleCompletionTask) void {
        // To ensure it stays alive for the deuration of this function.
        this.ref();
        defer this.deref();

        // For the build task.
        defer this.deref();

        switch (completion_task.result) {
            .err => |err| {
                if (bun.Environment.enable_logs)
                    debug("onComplete: err - {s}", .{@errorName(err)});
                this.value = .{ .err = bun.logger.Log.init(bun.default_allocator) };
                completion_task.log.cloneToWithRecycled(&this.value.err, true) catch bun.outOfMemory();

                if (this.server) |server| {
                    if (server.config().development) {
                        switch (bun.Output.enable_ansi_colors_stderr) {
                            inline else => |enable_ansi_colors| {
                                var writer = bun.Output.errorWriterBuffered();
                                this.value.err.printWithEnableAnsiColors(&writer, enable_ansi_colors) catch {};
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
                this.value = .{ .html = html_route_clone };

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
            // for the list of pending responses
            defer pending_response.deref();

            const resp = pending_response.resp;
            const method = pending_response.method;

            if (!pending_response.is_response_pending) {
                // request already aborted
                continue;
            }

            pending_response.is_response_pending = false;
            resp.clearAborted();

            switch (this.value) {
                .pending_plugins => {
                    // this.onAnyRequest(req: *uws.Request, resp: HTTPResponse, is_head: bool)
                },
                .html => |html| {
                    if (method == .HEAD) {
                        html.onHEAD(resp);
                    } else {
                        html.on(resp);
                    }
                },
                .err => |log| {
                    _ = log; // autofix
                    resp.writeStatus("500 Build Failed");
                    resp.endWithoutBody(false);
                },
                else => {
                    resp.endWithoutBody(false);
                },
            }

            // for the HTTP response.
            pending_response.deref();
        }
    }

    // Represents an in-flight response before the bundle has finished building.
    pub const PendingResponse = struct {
        method: bun.http.Method,
        resp: HTTPResponse,
        ref_count: u32 = 1,
        is_response_pending: bool = true,
        server: ?AnyServer = null,
        route: *HTMLBundleRoute,

        pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

        pub fn deinit(this: *PendingResponse) void {
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

pub usingnamespace JSC.Codegen.JSHTMLBundle;
pub usingnamespace bun.NewRefCounted(HTMLBundle, deinit);
const bun = @import("root").bun;
const std = @import("std");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSString = JSC.JSString;
const JSValueRef = JSC.JSValueRef;
const HTMLBundle = @This();
const JSBundler = JSC.API.JSBundler;
const HTTPResponse = bun.uws.AnyResponse;
const uws = bun.uws;
const AnyServer = JSC.API.AnyServer;
const StaticRoute = @import("./StaticRoute.zig");

const debug = bun.Output.scoped(.HTMLBundle, true);
const strings = bun.strings;
