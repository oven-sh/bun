const std = @import("std");

server: ?AnyServer = null,
status_code: u16,
blob: AnyBlob,
cached_blob_size: u64 = 0,
has_content_disposition: bool = false,
headers: Headers = .{
    .allocator = bun.default_allocator,
},
ref_count: u32 = 1,

pub usingnamespace bun.NewRefCounted(@This(), deinit);

fn deinit(this: *StaticRoute) void {
    this.blob.detach();
    this.headers.deinit();

    this.destroy();
}

pub fn clone(this: *StaticRoute, globalThis: *JSC.JSGlobalObject) !*StaticRoute {
    var blob = this.blob.toBlob(globalThis);
    this.blob = .{ .Blob = blob };

    return StaticRoute.new(.{
        .blob = .{ .Blob = blob.dupe() },
        .cached_blob_size = this.cached_blob_size,
        .has_content_disposition = this.has_content_disposition,
        .headers = try this.headers.clone(),
        .server = this.server,
        .status_code = this.status_code,
    });
}

pub fn memoryCost(this: *const StaticRoute) usize {
    return @sizeOf(StaticRoute) + this.blob.memoryCost() + this.headers.memoryCost();
}

pub fn fromJS(globalThis: *JSC.JSGlobalObject, argument: JSC.JSValue) bun.JSError!*StaticRoute {
    if (argument.as(JSC.WebCore.Response)) |response| {

        // The user may want to pass in the same Response object multiple endpoints
        // Let's let them do that.
        response.body.value.toBlobIfPossible();

        var blob: AnyBlob = brk: {
            switch (response.body.value) {
                .Used => {
                    return globalThis.throwInvalidArguments("Response body has already been used", .{});
                },

                else => {
                    return globalThis.throwInvalidArguments("Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body.", .{});
                },
                .Null, .Empty => {
                    break :brk AnyBlob{
                        .InternalBlob = JSC.WebCore.InternalBlob{
                            .bytes = std.ArrayList(u8).init(bun.default_allocator),
                        },
                    };
                },

                .Blob, .InternalBlob, .WTFStringImpl => {
                    if (response.body.value == .Blob and response.body.value.Blob.needsToReadFile()) {
                        return globalThis.throwTODO("TODO: support Bun.file(path) in static routes");
                    }
                    var blob = response.body.value.use();
                    blob.globalThis = globalThis;
                    blob.allocator = null;
                    response.body.value = .{ .Blob = blob.dupe() };

                    break :brk .{ .Blob = blob };
                },
            }
        };

        var has_content_disposition = false;

        if (response.init.headers) |headers| {
            has_content_disposition = headers.fastHas(.ContentDisposition);
            headers.fastRemove(.TransferEncoding);
            headers.fastRemove(.ContentLength);
        }

        const headers: Headers = if (response.init.headers) |headers|
            Headers.from(headers, bun.default_allocator, .{
                .body = &blob,
            }) catch {
                blob.detach();
                globalThis.throwOutOfMemory();
                return error.JSError;
            }
        else
            .{
                .allocator = bun.default_allocator,
            };

        return StaticRoute.new(.{
            .blob = blob,
            .cached_blob_size = blob.size(),
            .has_content_disposition = has_content_disposition,
            .headers = headers,
            .server = null,
            .status_code = response.statusCode(),
        });
    }

    return globalThis.throwInvalidArguments(
        \\'static' expects a Record<string, Response | HTMLBundle>
        \\
        \\To bundle frontend apps on-demand with Bun.serve(), import HTML files.
        \\
        \\Example:
        \\
        \\```js
        \\import { serve } from "bun";
        \\import app from "./app.html";
        \\
        \\serve({
        \\  static: {
        \\    "/index.json": Response.json({ message: "Hello World" }),
        \\    "/app": app,
        \\  },
        \\
        \\  fetch(request) {
        \\    return new Response("fallback response");
        \\  },
        \\});
        \\```
        \\
        \\See https://bun.sh/docs/api/http for more information.
    ,
        .{},
    );
}

// HEAD requests have no body.
pub fn onHEADRequest(this: *StaticRoute, req: *uws.Request, resp: HTTPResponse) void {
    req.setYield(false);
    this.onHEAD(resp);
}

pub fn onHEAD(this: *StaticRoute, resp: HTTPResponse) void {
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    resp.corked(renderMetadataAndEnd, .{ this, resp });
    this.onResponseComplete(resp);
}

fn renderMetadataAndEnd(this: *StaticRoute, resp: HTTPResponse) void {
    this.renderMetadata(resp);
    resp.writeHeaderInt("Content-Length", this.cached_blob_size);
    resp.endWithoutBody(resp.shouldCloseConnection());
}

pub fn onRequest(this: *StaticRoute, req: *uws.Request, resp: HTTPResponse) void {
    req.setYield(false);
    this.on(resp);
}

pub fn on(this: *StaticRoute, resp: HTTPResponse) void {
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    var finished = false;
    this.doRenderBlob(resp, &finished);
    if (finished) {
        this.onResponseComplete(resp);
        return;
    }

    this.toAsync(resp);
}

fn toAsync(this: *StaticRoute, resp: HTTPResponse) void {
    resp.onAborted(*StaticRoute, onAborted, this);
    resp.onWritable(*StaticRoute, onWritableBytes, this);
}

fn onAborted(this: *StaticRoute, resp: HTTPResponse) void {
    this.onResponseComplete(resp);
}

fn onResponseComplete(this: *StaticRoute, resp: HTTPResponse) void {
    resp.clearAborted();
    resp.clearOnWritable();
    resp.clearTimeout();

    if (this.server) |server| {
        server.onStaticRequestComplete();
    }

    this.deref();
}

pub fn doRenderBlob(this: *StaticRoute, resp: HTTPResponse, did_finish: *bool) void {
    // We are not corked
    // The body is small
    // Faster to do the memcpy than to do the two network calls
    // We are not streaming
    // This is an important performance optimization
    if (this.blob.fastSize() < 16384 - 1024) {
        resp.corked(doRenderBlobCorked, .{ this, resp, did_finish });
    } else {
        this.doRenderBlobCorked(resp, did_finish);
    }
}

pub fn doRenderBlobCorked(this: *StaticRoute, resp: HTTPResponse, did_finish: *bool) void {
    this.renderMetadata(resp);
    this.renderBytes(resp, did_finish);
}

fn onWritable(this: *StaticRoute, write_offset: u64, resp: HTTPResponse) void {
    if (this.server) |server| {
        resp.timeout(server.config().idleTimeout);
    }

    if (!this.onWritableBytes(write_offset, resp)) {
        this.toAsync(resp);
        return;
    }

    this.onResponseComplete(resp);
}

fn onWritableBytes(this: *StaticRoute, write_offset: u64, resp: HTTPResponse) bool {
    const blob = this.blob;
    const all_bytes = blob.slice();

    const bytes = all_bytes[@min(all_bytes.len, @as(usize, @truncate(write_offset)))..];

    if (!resp.tryEnd(
        bytes,
        all_bytes.len,
        resp.shouldCloseConnection(),
    )) {
        return false;
    }

    return true;
}

fn doWriteStatus(_: *StaticRoute, status: u16, resp: HTTPResponse) void {
    switch (resp) {
        .SSL => |r| writeStatus(true, r, status),
        .TCP => |r| writeStatus(false, r, status),
    }
}

fn doWriteHeaders(this: *StaticRoute, resp: HTTPResponse) void {
    switch (resp) {
        inline .SSL, .TCP => |s| {
            const entries = this.headers.entries.slice();
            const names: []const Api.StringPointer = entries.items(.name);
            const values: []const Api.StringPointer = entries.items(.value);
            const buf = this.headers.buf.items;

            for (names, values) |name, value| {
                s.writeHeader(name.slice(buf), value.slice(buf));
            }
        },
    }
}

fn renderBytes(this: *StaticRoute, resp: HTTPResponse, did_finish: *bool) void {
    did_finish.* = this.onWritableBytes(0, resp);
}

fn renderMetadata(this: *StaticRoute, resp: HTTPResponse) void {
    var status = this.status_code;
    const size = this.cached_blob_size;

    status = if (status == 200 and size == 0 and !this.blob.isDetached())
        204
    else
        status;

    this.doWriteStatus(status, resp);
    this.doWriteHeaders(resp);
}

const StaticRoute = @This();

const bun = @import("root").bun;

const Api = @import("../../../api/schema.zig").Api;
const JSC = bun.JSC;
const uws = bun.uws;
const Headers = JSC.WebCore.Headers;
const AnyServer = JSC.API.AnyServer;
const AnyBlob = JSC.WebCore.AnyBlob;
const writeStatus = @import("../server.zig").writeStatus;
const HTTPResponse = uws.AnyResponse;
