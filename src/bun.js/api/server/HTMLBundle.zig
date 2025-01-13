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
    return HTMLBundle.new(.{
        .globalObject = globalObject,
        .path = try bun.default_allocator.dupe(u8, path),
        .config = config,
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

    pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

    pub const Value = union(enum) {
        pending: void,
        building: *bun.BundleV2.JSBundleCompletionTask,
        err: bun.logger.Log,
        html: *StaticRoute,
    };

    pub fn deinit(this: *HTMLBundleRoute) void {
        for (this.pending_responses.items) |pending_response| {
            pending_response.deref();
        }
        this.pending_responses.deinit(bun.default_allocator);
        this.html_bundle.deref();
        this.destroy();
    }

    pub fn onRequest(this: *HTMLBundleRoute, req: *uws.Request, resp: HTTPResponse) void {
        if (this.value == .pending) {
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
                // create the PendingResponse, add it to the list
                var pending = bun.default_allocator.create(PendingResponse) catch {
                    resp.endWithoutBody(true);
                    bun.outOfMemory();
                    return;
                };

                pending.* = .{
                    .method = req.getMethod(),
                    .resp = resp,
                    .server = this.server,
                    .route = this,
                };

                this.pending_responses.append(bun.default_allocator, pending) catch {
                    pending.destroy();
                    resp.endWithoutBody(true);
                    bun.outOfMemory();
                    return;
                };

                resp.onAborted(*PendingResponse, PendingResponse.onAborted, pending);
            },
            .err => |log| {
                _ = log; // autofix
                // use the code from server.zig to render the error
            },
            .html => |html| {
                // we already have the html, so we can just serve it
                html.onRequest(req, resp);
            },
        }
    }

    pub fn onComplete(this: *HTMLBundleRoute, completion_task: *bun.BundleV2.JSBundleCompletionTask) void {
        defer completion_task.deref();

        switch (completion_task.result) {
            .err => |*log| {
                this.value = .{ .err = log.* };
                log.* = .{};
            },
            .value => |bundle| {
                // Find the HTML entry point and create static routes
                const server = this.server orelse return;
                const output_files = bundle.output_files.items;

                // 1. Find the HTML entry point
                for (output_files) |output_file| {
                    if (output_file.output_kind == .@"entry-point") {
                        if (output_file.input_loader == .html) {
                            // Create a StaticRoute for the HTML file
                            var blob = output_file.toBlob(bundle.graph.allocator) catch {
                                bun.outOfMemory();
                                return;
                            };

                            const static_route = StaticRoute.new(.{
                                .blob = blob,
                                .cached_blob_size = 0,
                                .server = server,
                                .status_code = 200,
                            }) catch {
                                blob.detach();
                                bun.outOfMemory();
                                return;
                            };

                            this.value = .{ .html = static_route };
                            break;
                        }
                    }
                }

                // 2. Add the rest of the files as static routes to the server.
                for (output_files) |output_file| {
                    const static_route = StaticRoute.new(.{
                        .blob = JSC.WebCore.AnyBlob{ .Blob = output_file.toBlob(bun.default_allocator) catch bun.outOfMemory() },
                        .server = server,
                        .status_code = 200,
                    }) catch {
                        bun.outOfMemory();
                        return;
                    };

                    const route_path = output_file.dest_path;

                    server.appendStaticRoute(route_path, static_route);
                }
            },
        }

        // Handle pending responses
        var pending = this.pending_responses;
        defer pending.deinit(bun.default_allocator);
        this.pending_responses = .{};
        for (pending.items) |pending_response| {
            const resp = pending_response.resp;
            const method = pending_response.method;
            pending_response.is_response_pending = false;
            defer pending_response.deref();

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
                this.resp.endWithoutBody();
            }
            this.route.deref();
            this.destroy();
        }

        pub fn onAborted(this: *PendingResponse, resp: HTTPResponse) void {
            _ = resp; // autofix
            bun.debugAssert(this.aborted == false);
            this.aborted = true;
            while (std.mem.indexOfScalar(this.route.pending_responses.items, this)) |index| {
                this.route.pending_responses.orderedRemove(index);
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
