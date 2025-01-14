// This is a description of what the build will be.
// It doesn't do the build.

ref_count: u32 = 1,
globalObject: *JSGlobalObject,
path: []const u8,
config: bun.JSC.API.JSBundler.Config,
plugins: ?*bun.JSC.API.JSBundler.Plugin,

pub fn init(globalObject: *JSGlobalObject, path: []const u8) !*HTMLBundle {
    var config = bun.JSC.API.JSBundler.Config{};
    try config.entry_points.insert(path);
    config.experimental.html = true;
    config.experimental.css = true;
    config.target = .browser;
    try config.public_path.appendChar('/');
    return HTMLBundle.new(.{
        .globalObject = globalObject,
        .path = try bun.default_allocator.dupe(u8, path),
        .config = config,
        .plugins = null,
    });
}

pub fn finalize(this: *HTMLBundle) void {
    this.deref();
}

pub fn deinit(this: *HTMLBundle) void {
    bun.default_allocator.free(this.path);
    this.config.deinit(bun.default_allocator);
    if (this.plugins) |plugin| {
        plugin.deinit();
    }
    this.destroy();
}

pub fn getPath(this: *HTMLBundle, globalObject: *JSGlobalObject) JSValue {
    var str = bun.String.createUTF8(this.path);
    return str.transferToJS(globalObject);
}

// When you call .write on
pub fn write(this: *HTMLBundle, globalObject: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    _ = this; // autofix
    const args_ = callframe.arguments_old(1);
    var args = JSC.Node.ArgumentsSlice.init(globalObject.bunVM(), args_.slice());
    defer args.deinit();
    const destination_path = (try JSC.Node.PathLike.fromJS(globalObject, &args)) orelse {
        return globalObject.throwMissingArgumentsValue(&.{"path"});
    };
    _ = destination_path; // autofix
    return globalObject.throwTODO("Finish implementing HTMLBundle.write");
}

pub const HTMLBundleRoute = struct {
    html_bundle: *HTMLBundle,
    pending_responses: std.ArrayListUnmanaged(*PendingResponse) = .{},
    ref_count: u32 = 1,
    server: ?AnyServer = null,
    value: Value = .pending,

    pub fn init(html_bundle: *HTMLBundle) *HTMLBundleRoute {
        return HTMLBundleRoute.new(.{
            .html_bundle = html_bundle,
            .pending_responses = .{},
            .ref_count = 1,
            .server = null,
            .value = .pending,
        });
    }

    pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

    pub const Value = union(enum) {
        pending: void,
        building: *bun.BundleV2.JSBundleCompletionTask,
        err: bun.logger.Log,
        html: *StaticRoute,

        pub fn deinit(this: *Value) void {
            switch (this.*) {
                .err => |*log| {
                    log.deinit();
                },
                .building => {},
                .html => {
                    this.html.deref();
                },
                .pending => {},
            }
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
        if (this.value == .pending) {
            if (bun.Environment.enable_logs)
                debug("onRequest: {s} - pending", .{req.url()});
            const server: AnyServer = this.server orelse {
                resp.endWithoutBody(true);
                this.deref();
                return;
            };
            const globalThis = server.globalThis();

            const vm = globalThis.bunVM();

            const completion_task = bun.BundleV2.createAndScheduleCompletionTask(
                this.html_bundle.config,
                this.html_bundle.plugins,
                globalThis,
                vm.eventLoop(),
                bun.default_allocator,
            ) catch {
                resp.endWithoutBody(true);
                bun.outOfMemory();
                return;
            };
            this.ref();
            completion_task.html_build_task = this;
            this.value = .{ .building = completion_task };
        }

        switch (this.value) {
            .pending => unreachable,
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

                this.pending_responses.append(bun.default_allocator, pending) catch {
                    pending.deref();
                    resp.endWithoutBody(true);
                    bun.outOfMemory();
                    return;
                };

                pending.ref();
                resp.onAborted(*PendingResponse, PendingResponse.onAborted, pending);
                req.setYield(false);
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

    pub fn onComplete(this: *HTMLBundleRoute, completion_task: *bun.BundleV2.JSBundleCompletionTask) void {
        this.ref();
        defer this.deref();

        switch (completion_task.result) {
            .err => |err| {
                if (bun.Environment.enable_logs)
                    debug("onComplete: err - {s}", .{@errorName(err)});
                this.value = .{ .err = bun.logger.Log.init(bun.default_allocator) };
                completion_task.log.cloneToWithRecycled(&this.value.err, true) catch bun.outOfMemory();
            },
            .value => |bundle| {
                if (bun.Environment.enable_logs)
                    debug("onComplete: success", .{});
                // Find the HTML entry point and create static routes
                const server: AnyServer = this.server orelse return;
                const globalThis = server.globalThis();
                const output_files = bundle.output_files.items;

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
                        headers.append("Cache-Control", "public, max-age=31536000, immutable") catch bun.outOfMemory();
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

                if (this_html_route) |html_route| {
                    html_route.ref();
                    this.value = .{ .html = html_route };
                } else {
                    @panic("Internal assertion failure: HTML entry point not found in HTMLBundle.");
                }

                if (!(server.reloadStaticRoutes() catch bun.outOfMemory())) {
                    // Server has shutdown, so it won't receive any new requests
                    // TODO: handle this case
                }
            },
            .pending => unreachable,
        }

        // Handle pending responses
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
                .html => |html| {
                    if (method == .HEAD) {
                        html.onHEAD(resp);
                    } else {
                        html.on(resp);
                    }
                },
                .err => |log| {
                    _ = log; // autofix
                    // TODO: Implement error rendering
                    resp.endWithoutBody(true);
                },
                else => {
                    resp.endWithoutBody(true);
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
