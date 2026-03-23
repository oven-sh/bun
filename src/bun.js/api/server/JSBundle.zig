//! This object is a description of a JS/TS bundle. It is created by importing a
//! JS/TS file with `{ type: "bundle" }`, and can be passed to the `static` option
//! in `Bun.serve`. In dev mode, a DevServer handles building + HMR. In prod mode,
//! a one-shot BundleV2 build produces static output files.
pub const JSBundle = @This();
pub const js = jsc.Codegen.JSJSBundle;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

/// JSBundle can be owned by JavaScript as well as any number of Server instances.
const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,
global: *JSGlobalObject,
path: []const u8,
/// Actual entrypoint path determined after build (e.g., "/index.js").
/// null before the build completes.
actual_entrypoint: ?[]const u8 = null,
/// Cached JS array of BundleFile objects, populated after build.
files_value: jsc.Strong.Optional = .empty,
/// Cached entrypoint BundleFile JS value.
entrypoint_value: jsc.Strong.Optional = .empty,
/// Per-bundle config from import attributes (splitting, minify, sourcemap).
config: BundleImportConfig = .{},

/// Initialize a JSBundle given a path and optional config from import attributes.
pub fn init(global: *JSGlobalObject, path: []const u8, bundle_config: ?BundleImportConfig) !*JSBundle {
    return bun.new(JSBundle, .{
        .ref_count = .init(),
        .global = global,
        .path = try bun.default_allocator.dupe(u8, path),
        .config = bundle_config orelse .{},
    });
}

pub fn finalize(this: *JSBundle) void {
    this.deref();
}

fn deinit(this: *JSBundle) void {
    if (this.actual_entrypoint) |ep| bun.default_allocator.free(ep);
    this.files_value.deinit();
    this.entrypoint_value.deinit();
    bun.default_allocator.free(this.path);
    bun.destroy(this);
}

/// Returns the entrypoint BundleFile after build, or undefined before build.
pub fn getEntrypoint(this: *JSBundle, _: *JSGlobalObject) bun.JSError!JSValue {
    if (this.entrypoint_value.get()) |v| return v;
    return .js_undefined;
}

/// Returns the list of BundleFile objects after build, or an empty array before build.
pub fn getFiles(this: *JSBundle, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    if (this.files_value.get()) |v| return v;
    // Return empty array before build completes
    const array = try jsc.JSValue.createEmptyArray(globalObject, 0);
    return array;
}

/// A JSBundle.Route is created per Bun.serve() instance for each JSBundle.
/// It manages the DevServer (dev mode) or BundleV2 build (prod mode) and
/// serves the resulting JS bundle to clients.
pub const Route = struct {
    const RouteRefCount = bun.ptr.RefCount(@This(), "ref_count", Route.deinit, .{ .debug_name = "JSBundleRoute" });
    pub const ref = Route.RouteRefCount.ref;
    pub const deref = Route.RouteRefCount.deref;

    bundle: RefPtr(JSBundle),
    ref_count: Route.RouteRefCount,
    server: ?AnyServer = null,
    state: State,
    dev_server: ?*bun.bake.DevServer = null,
    /// When state == .pending or .building, incomplete responses are stored here.
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

    pub fn init(js_bundle: *JSBundle) RefPtr(Route) {
        return .new(.{
            .bundle = .initRef(js_bundle),
            .pending_responses = .{},
            .ref_count = .init(),
            .server = null,
            .dev_server = null,
            .state = .pending,
        });
    }

    fn deinit(this: *Route) void {
        bun.assert(this.pending_responses.items.len == 0);
        this.pending_responses.deinit(bun.default_allocator);
        this.bundle.deref();
        this.state.deinit();
        if (this.dev_server) |dev| {
            dev.deinit();
            this.dev_server = null;
        }
        bun.destroy(this);
    }

    pub const State = union(enum) {
        pending,
        building: ?*bun.BundleV2.JSBundleCompletionTask,
        err: bun.logger.Log,
        built: *StaticRoute,

        pub fn deinit(this: *State) void {
            switch (this.*) {
                .err => |*log| {
                    log.deinit();
                },
                .building => |completion| if (completion) |c| {
                    c.cancelled = true;
                    c.deref();
                },
                .built => {
                    this.built.deref();
                },
                .pending => {},
            }
        }

        pub fn memoryCost(this: *const State) usize {
            return switch (this.*) {
                .pending => 0,
                .building => 0,
                .err => |log| log.memoryCost(),
                .built => |built| built.memoryCost(),
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

        if (this.server == null) {
            resp.endWithoutBody(true);
            return;
        }

        // In dev mode, check if DevServer has rebuilt and invalidate cache
        if (this.dev_server) |dev| {
            if (dev.standalone_client_bundle == null and this.state == .built) {
                this.state.built.deref();
                this.state = .pending;
            }
        }

        state: switch (this.state) {
            .pending => {
                if (this.dev_server) |dev| {
                    // Generate bundle from DevServer
                    const payload = dev.generateStandaloneClientBundle() catch |err| bun.handleOom(err);
                    if (payload.len == 0) {
                        // Build hasn't completed yet — queue as pending response
                        this.queuePendingResponse(req, resp);
                        return;
                    }
                    const server = this.server.?;
                    const route = StaticRoute.initFromAnyBlob(
                        &.fromOwnedSlice(dev.allocator(), payload),
                        .{
                            .mime_type = &.javascript,
                            .server = server,
                        },
                    );
                    this.state = .{ .built = route };
                    // Set entrypoint in dev mode so bundle.files works
                    this.updateDevEntrypoint();
                    continue :state this.state;
                } else {
                    // Production mode: schedule a BundleV2 build
                    const server = this.server.?;
                    bun.handleOom(this.scheduleBundle(server));
                    continue :state this.state;
                }
            },
            .building => {
                if (bun.Environment.enable_logs)
                    debug("onRequest: {s} - building", .{req.url()});
                this.queuePendingResponse(req, resp);
            },
            .err => {
                resp.writeStatus("500 Build Failed");
                resp.endWithoutBody(true);
            },
            .built => |built| {
                if (is_head) {
                    built.onHEAD(resp);
                } else {
                    built.on(resp);
                }
            },
        }
    }

    /// Schedule a production bundle build.
    fn scheduleBundle(this: *Route, server: AnyServer) !void {
        switch (server.getOrLoadPlugins(.{ .js_bundle_route = this })) {
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

        // Apply per-bundle config overrides from import attributes
        const bundle_cfg = this.bundle.data.config;
        if (bundle_cfg.splitting) |s| config.code_splitting = s;
        if (bundle_cfg.minify) |m| {
            config.minify.syntax = m;
            config.minify.whitespace = m;
            config.minify.identifiers = m;
        }
        if (bundle_cfg.sourcemap) |s| config.source_map = s;

        const completion_task = try bun.BundleV2.createAndScheduleCompletionTask(
            config,
            plugins,
            global,
            vm.eventLoop(),
            bun.default_allocator,
        );
        completion_task.started_at_ns = bun.getRoughTickCount(.allow_mocked_time).ns();
        completion_task.js_bundle_build_task = this;
        this.state = .{ .building = completion_task };

        // While we're building, ensure this doesn't get freed.
        this.ref();
    }

    pub fn onPluginsRejected(this: *Route) !void {
        debug("JSBundleRoute(0x{x}) plugins rejected", .{@intFromPtr(this)});
        this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) };
        this.resumePendingResponses();
    }

    /// Called when a production BundleV2 build completes.
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
                const server: AnyServer = this.server orelse return;
                const globalThis = server.globalThis();
                const output_files = bundle.output_files.items;

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

                var this_js_route: ?*StaticRoute = null;

                // Create BundleFile objects and static routes for each output file
                const files_array = jsc.JSValue.createEmptyArray(globalThis, output_files.len) catch null;
                var bundle_file_index: u32 = 0;
                var entrypoint_js_value: ?JSValue = null;

                for (output_files) |*output_file| {
                    const blob = jsc.WebCore.Blob.Any{ .Blob = bun.handleOom(output_file.toBlob(bun.default_allocator, globalThis)) };
                    var headers = bun.http.Headers{ .allocator = bun.default_allocator };
                    const content_type = blob.Blob.contentTypeOrMimeType() orelse brk: {
                        bun.debugAssert(false);
                        break :brk output_file.loader.toMimeType(&.{}).value;
                    };
                    bun.handleOom(headers.append("Content-Type", content_type));
                    // Do not apply etags to the entry point JS file.
                    if (output_file.value == .buffer) {
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

                    // Find the JS entry point
                    if (this_js_route == null and output_file.output_kind == .@"entry-point") {
                        if (output_file.loader.isJavaScriptLike() or output_file.loader == .css) {
                            this_js_route = static_route;
                        }
                    }

                    var route_path = output_file.dest_path;

                    // The route path gets cloned inside of appendStaticRoute.
                    if (strings.hasPrefixComptime(route_path, "./") or strings.hasPrefixComptime(route_path, ".\\")) {
                        route_path = route_path[1..];
                    }

                    // Create a BundleFile for this output
                    const file_name = if (route_path.len > 0 and route_path[0] == '/') route_path[1..] else route_path;
                    const bundle_file_kind: BundleFile.OutputKind = switch (output_file.output_kind) {
                        .@"entry-point" => .@"entry-point",
                        .chunk => .chunk,
                        .asset => .asset,
                        .sourcemap => .sourcemap,
                        else => .asset,
                    };
                    const bundle_file = BundleFile.init(
                        file_name,
                        bundle_file_kind,
                        content_type,
                        output_file.size_without_sourcemap,
                        blob.Blob.dupe(),
                    );
                    const bundle_file_js = BundleFile.toJS(bundle_file, globalThis);

                    // Track entrypoint
                    if (output_file.output_kind == .@"entry-point" and (output_file.loader.isJavaScriptLike() or output_file.loader == .css)) {
                        entrypoint_js_value = bundle_file_js;
                    }

                    // Add to files array
                    if (files_array) |arr| {
                        arr.putIndex(globalThis, bundle_file_index, bundle_file_js) catch {};
                    }
                    bundle_file_index += 1;

                    bun.handleOom(server.appendStaticRoute(route_path, .{ .static = static_route }, .any));
                }

                // Store BundleFile objects on the JSBundle
                if (files_array) |arr| {
                    this.bundle.data.files_value = .create(arr, globalThis);
                }
                if (entrypoint_js_value) |ep_val| {
                    this.bundle.data.entrypoint_value = .create(ep_val, globalThis);
                }

                if (this_js_route) |js_route| {
                    // Update the actual entrypoint path on the JSBundle
                    for (output_files) |*output_file| {
                        if (output_file.output_kind == .@"entry-point" and (output_file.loader.isJavaScriptLike() or output_file.loader == .css)) {
                            var ep = output_file.dest_path;
                            if (strings.hasPrefixComptime(ep, "./") or strings.hasPrefixComptime(ep, ".\\")) {
                                ep = ep[2..];
                            } else if (ep.len > 0 and ep[0] == '/') {
                                ep = ep[1..];
                            }
                            if (this.bundle.data.actual_entrypoint) |old| bun.default_allocator.free(old);
                            this.bundle.data.actual_entrypoint = bun.handleOom(bun.default_allocator.dupe(u8, ep));
                            break;
                        }
                    }

                    const js_route_clone = bun.handleOom(js_route.clone(globalThis));
                    this.state = .{ .built = js_route_clone };

                    if (!bun.handleOom(server.reloadStaticRoutes())) {
                        // Server has shutdown
                    }
                } else {
                    // No JS entry point found — this shouldn't happen but handle gracefully
                    debug("onComplete: no JS entry point found in bundle output", .{});
                    this.state = .{ .err = bun.logger.Log.init(bun.default_allocator) };
                }
            },
            .pending => unreachable,
        }

        // Handle pending responses
        this.resumePendingResponses();
    }

    fn queuePendingResponse(this: *Route, req: *uws.Request, resp: HTTPResponse) void {
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
                continue;
            }
            pending_response.is_response_pending = false;
            resp.clearAborted();

            switch (this.state) {
                .built => |built| {
                    if (method == .HEAD) {
                        built.onHEAD(resp);
                    } else {
                        built.on(resp);
                    }
                },
                .err => {
                    resp.writeStatus("500 Build Failed");
                    resp.endWithoutBody(false);
                },
                else => {
                    resp.endWithoutBody(false);
                },
            }
        }
    }

    /// Set actual_entrypoint from the source path in dev mode.
    /// In dev mode there's one output file derived from the source filename.
    /// Also creates BundleFile objects for entrypoint and files.
    pub fn updateDevEntrypoint(this: *Route) void {
        const base = bun.path.basename(this.bundle.data.path);
        const dot_pos = std.mem.lastIndexOfScalar(u8, base, '.') orelse base.len;
        const name = base[0..dot_pos];
        var buf: [512]u8 = undefined;
        const ep = std.fmt.bufPrint(&buf, "{s}.js", .{name}) catch return;
        if (this.bundle.data.actual_entrypoint) |old| bun.default_allocator.free(old);
        this.bundle.data.actual_entrypoint = bun.handleOom(bun.default_allocator.dupe(u8, ep));

        // Invalidate cached values so they get regenerated
        this.bundle.data.files_value.deinit();
        this.bundle.data.files_value = .empty;
        this.bundle.data.entrypoint_value.deinit();
        this.bundle.data.entrypoint_value = .empty;

        // Create BundleFile for the dev entrypoint.
        // When built, use the real blob/size/type. Otherwise create with empty blob
        // so that bundle.entrypoint.name is available before the first build completes.
        const globalThis = this.bundle.data.global;
        var blob: jsc.WebCore.Blob = undefined;
        var content_type: []const u8 = "application/javascript";
        var file_size: u64 = 0;

        if (this.state == .built) {
            const built = this.state.built;
            // Use pointer so toBlob() transfers ownership from the StaticRoute's
            // blob field, preventing double-free when BundleFile and StaticRoute
            // are freed independently.
            const blob_ptr: *jsc.WebCore.Blob.Any = &built.blob;
            blob = blob_ptr.toBlob(globalThis);
            content_type = blob.contentTypeOrMimeType() orelse "application/javascript";
            file_size = blob.size;
        } else {
            blob = jsc.WebCore.Blob.initEmpty(globalThis);
        }

        const bundle_file = BundleFile.init(
            ep,
            .@"entry-point",
            content_type,
            file_size,
            blob,
        );
        const bundle_file_js = BundleFile.toJS(bundle_file, globalThis);
        this.bundle.data.entrypoint_value = .create(bundle_file_js, globalThis);

        // files = [entrypoint]
        if (jsc.JSValue.createEmptyArray(globalThis, 1)) |arr| {
            arr.putIndex(globalThis, 0, bundle_file_js) catch {};
            this.bundle.data.files_value = .create(arr, globalThis);
        } else |_| {}
    }

    /// Called by DevServer after a build completes in standalone mode.
    pub fn onDevServerBuildComplete(ctx: *anyopaque, dev: *bun.bake.DevServer, success: bool) void {
        const this: *Route = @ptrCast(@alignCast(ctx));
        _ = success;

        // Invalidate cached bundle so next request regenerates it
        if (this.state == .built) {
            this.state.built.deref();
            this.state = .pending;
        }

        // Regenerate the bundle and set state to .built so that
        // updateDevEntrypoint can create BundleFile objects.
        const payload = dev.generateStandaloneClientBundle() catch |err| bun.handleOom(err);
        if (payload.len > 0) {
            const server = this.server orelse return;
            const route = StaticRoute.initFromAnyBlob(
                &.fromOwnedSlice(dev.allocator(), payload),
                .{
                    .mime_type = &.javascript,
                    .server = server,
                },
            );
            this.state = .{ .built = route };

            // Set entrypoint/files now that state is .built
            this.updateDevEntrypoint();

            // If there are pending responses, serve them now
            this.resumePendingResponses();
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

            this.route.ref();
            defer this.route.deref();

            while (std.mem.indexOfScalar(*PendingResponse, this.route.pending_responses.items, this)) |index| {
                _ = this.route.pending_responses.orderedRemove(index);
                this.route.deref();
            }
        }
    };
};

const debug = bun.Output.scoped(.JSBundle, .hidden);

const BundleFile = @import("./BundleFile.zig");
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
const BundleImportConfig = bun.ImportRecord.BundleImportConfig;

const uws = bun.uws;
const HTTPResponse = bun.uws.AnyResponse;
