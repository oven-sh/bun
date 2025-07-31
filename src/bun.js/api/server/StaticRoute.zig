//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

const StaticRoute = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

// TODO: Remove optional. StaticRoute requires a server object or else it will
// not ensure it is alive while sending a large blob.
ref_count: RefCount,
server: ?AnyServer = null,
status_code: u16,
blob: AnyBlob,
cached_blob_size: u64,
has_content_disposition: bool = false,
headers: Headers = .{
    .allocator = bun.default_allocator,
},

pub const InitFromBytesOptions = struct {
    server: ?AnyServer,
    mime_type: ?*const bun.http.MimeType = null,
    status_code: u16 = 200,
    headers: ?*jsc.WebCore.FetchHeaders = null,
};

/// Ownership of `blob` is transferred to this function.
pub fn initFromAnyBlob(blob: *const AnyBlob, options: InitFromBytesOptions) *StaticRoute {
    var headers = Headers.from(options.headers, bun.default_allocator, .{ .body = blob }) catch bun.outOfMemory();
    if (options.mime_type) |mime_type| {
        if (headers.getContentType() == null) {
            headers.append("Content-Type", mime_type.value) catch bun.outOfMemory();
        }
    }

    // Generate ETag if not already present
    if (headers.get("etag") == null) {
        if (blob.slice().len > 0) {
            ETag.appendToHeaders(blob.slice(), &headers) catch bun.outOfMemory();
        }
    }

    return bun.new(StaticRoute, .{
        .ref_count = .init(),
        .blob = blob.*,
        .cached_blob_size = blob.size(),
        .has_content_disposition = false,
        .headers = headers,
        .server = options.server,
        .status_code = options.status_code,
    });
}

/// Create a static route to be used on a single response, freeing the bytes once sent.
pub fn sendBlobThenDeinit(resp: AnyResponse, blob: *const AnyBlob, options: InitFromBytesOptions) void {
    const temp_route = StaticRoute.initFromAnyBlob(blob, options);
    defer temp_route.deref();
    temp_route.on(resp);
}

fn deinit(this: *StaticRoute) void {
    this.blob.detach();
    this.headers.deinit();

    bun.destroy(this);
}

pub fn clone(this: *StaticRoute, globalThis: *jsc.JSGlobalObject) !*StaticRoute {
    var blob = this.blob.toBlob(globalThis);
    this.blob = .{ .Blob = blob };

    return bun.new(StaticRoute, .{
        .ref_count = .init(),
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

pub fn fromJS(globalThis: *jsc.JSGlobalObject, argument: jsc.JSValue) bun.JSError!?*StaticRoute {
    if (argument.as(jsc.WebCore.Response)) |response| {

        // The user may want to pass in the same Response object multiple endpoints
        // Let's let them do that.
        response.body.value.toBlobIfPossible();

        const blob: AnyBlob = brk: {
            switch (response.body.value) {
                .Used => {
                    return globalThis.throwInvalidArguments("Response body has already been used", .{});
                },

                .Null, .Empty => {
                    break :brk .{
                        .InternalBlob = .{
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

                else => {
                    return globalThis.throwInvalidArguments("Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body.", .{});
                },
            }
        };

        var has_content_disposition = false;

        if (response.init.headers) |headers| {
            has_content_disposition = headers.fastHas(.ContentDisposition);
            headers.fastRemove(.TransferEncoding);
            headers.fastRemove(.ContentLength);
        }

        var headers: Headers = if (response.init.headers) |h|
            Headers.from(h, bun.default_allocator, .{
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

        // Generate ETag if not already present
        if (headers.get("etag") == null) {
            if (blob.slice().len > 0) {
                try ETag.appendToHeaders(blob.slice(), &headers);
            }
        }

        return bun.new(StaticRoute, .{
            .ref_count = .init(),
            .blob = blob,
            .cached_blob_size = blob.size(),
            .has_content_disposition = has_content_disposition,
            .headers = headers,
            .server = null,
            .status_code = response.statusCode(),
        });
    }

    return null;
}

// HEAD requests have no body.
pub fn onHEADRequest(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) void {
    // Check If-None-Match for HEAD requests with 200 status
    if (this.status_code == 200) {
        if (this.render304NotModifiedIfNoneMatch(req, resp)) {
            return;
        }
    }

    // Continue with normal HEAD request handling
    req.setYield(false);
    this.onHEAD(resp);
}

pub fn onHEAD(this: *StaticRoute, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    resp.corked(renderMetadataAndEnd, .{ this, resp });
    this.onResponseComplete(resp);
}

fn renderMetadataAndEnd(this: *StaticRoute, resp: AnyResponse) void {
    this.renderMetadata(resp);
    resp.writeHeaderInt("Content-Length", this.cached_blob_size);
    resp.endWithoutBody(resp.shouldCloseConnection());
}

pub fn onRequest(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) void {
    const method = bun.http.Method.find(req.method()) orelse .GET;
    if (method == .GET) {
        this.onGET(req, resp);
    } else if (method == .HEAD) {
        this.onHEADRequest(req, resp);
    } else {
        // For other methods, use the original behavior
        req.setYield(false);
        this.on(resp);
    }
}

pub fn onGET(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) void {
    // Check If-None-Match for GET requests with 200 status
    if (this.status_code == 200) {
        if (this.render304NotModifiedIfNoneMatch(req, resp)) {
            return;
        }
    }

    // Handle Range requests for GET with 200 status
    if (this.status_code == 200) {
        if (req.header("range")) |range_header| {
            this.handleRangeRequest(req, resp, range_header);
            return;
        }
    }

    // Continue with normal GET request handling
    req.setYield(false);
    this.on(resp);
}

pub fn on(this: *StaticRoute, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);
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

fn toAsync(this: *StaticRoute, resp: AnyResponse) void {
    resp.onAborted(*StaticRoute, onAborted, this);
    resp.onWritable(*StaticRoute, onWritable, this);
}

fn onAborted(this: *StaticRoute, resp: AnyResponse) void {
    this.onResponseComplete(resp);
}

fn onResponseComplete(this: *StaticRoute, resp: AnyResponse) void {
    resp.clearAborted();
    resp.clearOnWritable();
    resp.clearTimeout();
    if (this.server) |server| {
        server.onStaticRequestComplete();
    }
    this.deref();
}

fn doRenderBlob(this: *StaticRoute, resp: AnyResponse, did_finish: *bool) void {
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

fn doRenderBlobCorked(this: *StaticRoute, resp: AnyResponse, did_finish: *bool) void {
    this.renderMetadata(resp);
    this.renderBytes(resp, did_finish);
}

fn onWritable(this: *StaticRoute, write_offset: u64, resp: AnyResponse) bool {
    if (this.server) |server| {
        resp.timeout(server.config().idleTimeout);
    }

    if (!this.onWritableBytes(write_offset, resp)) {
        return false;
    }

    this.onResponseComplete(resp);
    return true;
}

fn onWritableBytes(this: *StaticRoute, write_offset: u64, resp: AnyResponse) bool {
    const blob = this.blob;
    const all_bytes = blob.slice();

    const bytes = all_bytes[@min(all_bytes.len, write_offset)..];

    return resp.tryEnd(bytes, all_bytes.len, resp.shouldCloseConnection());
}

fn doWriteStatus(_: *StaticRoute, status: u16, resp: AnyResponse) void {
    switch (resp) {
        .SSL => |r| writeStatus(true, r, status),
        .TCP => |r| writeStatus(false, r, status),
    }
}

fn doWriteHeaders(this: *StaticRoute, resp: AnyResponse) void {
    switch (resp) {
        inline .SSL, .TCP => |s| {
            const entries = this.headers.entries.slice();
            const names: []const api.StringPointer = entries.items(.name);
            const values: []const api.StringPointer = entries.items(.value);
            const buf = this.headers.buf.items;

            for (names, values) |name, value| {
                s.writeHeader(name.slice(buf), value.slice(buf));
            }
        },
    }
}

fn renderBytes(this: *StaticRoute, resp: AnyResponse, did_finish: *bool) void {
    did_finish.* = this.onWritableBytes(0, resp);
}

fn renderMetadata(this: *StaticRoute, resp: AnyResponse) void {
    var status = this.status_code;
    const size = this.cached_blob_size;

    status = if (status == 200 and size == 0 and !this.blob.isDetached())
        204
    else
        status;

    this.doWriteStatus(status, resp);
    
    // Add Accept-Ranges header for 200 responses to indicate range support
    if (status == 200) {
        resp.writeHeader("Accept-Ranges", "bytes");
    }
    
    this.doWriteHeaders(resp);
}

pub fn onWithMethod(this: *StaticRoute, method: bun.http.Method, resp: AnyResponse) void {
    switch (method) {
        .GET => this.on(resp),
        .HEAD => this.onHEAD(resp),
        else => {
            this.doWriteStatus(405, resp); // Method not allowed
            resp.endWithoutBody(resp.shouldCloseConnection());
        },
    }
}

fn render304NotModifiedIfNoneMatch(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) bool {
    const if_none_match = req.header("if-none-match") orelse return false;
    const etag = this.headers.get("etag") orelse return false;
    if (if_none_match.len == 0 or etag.len == 0) {
        return false;
    }

    if (!ETag.ifNoneMatch(etag, if_none_match)) {
        return false;
    }

    // Return 304 Not Modified
    req.setYield(false);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    this.doWriteStatus(304, resp);
    this.doWriteHeaders(resp);
    resp.endWithoutBody(resp.shouldCloseConnection());
    this.onResponseComplete(resp);
    return true;
}

fn handleRangeRequest(this: *StaticRoute, req: *uws.Request, resp: AnyResponse, range_header: []const u8) void {
    const content_size = this.cached_blob_size;
    
    // Parse range requests
    const ranges = ContentRange.parseRangeHeader(range_header, bun.default_allocator) catch {
        // Invalid range header, serve full content
        req.setYield(false);
        this.on(resp);
        return;
    };
    defer bun.default_allocator.free(ranges);
    
    // Filter valid ranges
    const valid_ranges = ContentRange.filterValidRanges(ranges, content_size, bun.default_allocator) catch {
        // Memory allocation error, serve full content
        req.setYield(false);
        this.on(resp);
        return;
    };
    defer bun.default_allocator.free(valid_ranges);
    
    // If no valid ranges, return 416 Range Not Satisfiable
    if (valid_ranges.len == 0) {
        this.sendRangeNotSatisfiable(resp, content_size);
        return;
    }
    
    // For now, only handle single ranges (multipart ranges would need more complex implementation)
    if (valid_ranges.len > 1) {
        // Fall back to serving full content for multipart ranges
        req.setYield(false);
        this.on(resp);
        return;
    }
    
    const range = valid_ranges[0];
    
    // Check if this is actually a full content request
    if (range.start == 0 and range.actualEnd(content_size) == content_size - 1) {
        req.setYield(false);
        this.on(resp);
        return;
    }
    
    req.setYield(false);
    this.sendPartialContent(resp, range, content_size);
}

fn sendRangeNotSatisfiable(this: *StaticRoute, resp: AnyResponse, content_size: u64) void {
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    
    this.doWriteStatus(416, resp);
    
    // Add Content-Range header for unsatisfiable range
    const content_range_header = ContentRange.formatUnsatisfiableRangeHeader(content_size, bun.default_allocator) catch {
        // Fallback without Content-Range header
        this.doWriteHeaders(resp);
        resp.endWithoutBody(resp.shouldCloseConnection());
        this.onResponseComplete(resp);
        return;
    };
    defer bun.default_allocator.free(content_range_header);
    
    resp.writeHeader("Content-Range", content_range_header);
    this.doWriteHeaders(resp);
    resp.endWithoutBody(resp.shouldCloseConnection());
    this.onResponseComplete(resp);
}

fn sendPartialContent(this: *StaticRoute, resp: AnyResponse, range: ContentRange.Range, content_size: u64) void {
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    
    // Prepare headers for partial content
    var finished = false;
    this.doRenderPartialContent(resp, range, content_size, &finished);
    if (finished) {
        this.onResponseComplete(resp);
        return;
    }
    
    this.toAsyncPartial(resp, range, content_size);
}

fn doRenderPartialContent(this: *StaticRoute, resp: AnyResponse, range: ContentRange.Range, content_size: u64, did_finish: *bool) void {
    const range_length = range.length(content_size);
    
    // We are not corked
    // The range is small
    // Faster to do the memcpy than to do the two network calls
    if (range_length < 16384 - 1024) {
        resp.corked(doRenderPartialContentCorked, .{ this, resp, range, content_size, did_finish });
    } else {
        this.doRenderPartialContentCorked(resp, range, content_size, did_finish);
    }
}

fn doRenderPartialContentCorked(this: *StaticRoute, resp: AnyResponse, range: ContentRange.Range, content_size: u64, did_finish: *bool) void {
    this.renderPartialMetadata(resp, range, content_size);
    this.renderPartialBytes(resp, range, content_size, did_finish);
}

fn renderPartialMetadata(this: *StaticRoute, resp: AnyResponse, range: ContentRange.Range, content_size: u64) void {
    // Write 206 Partial Content status
    this.doWriteStatus(206, resp);
    
    // Add Content-Range header
    const content_range_header = ContentRange.formatContentRangeHeader(range, content_size, bun.default_allocator) catch {
        // Fallback without Content-Range header
        this.doWriteHeaders(resp);
        return;
    };
    defer bun.default_allocator.free(content_range_header);
    
    resp.writeHeader("Content-Range", content_range_header);
    
    // Add Accept-Ranges header to indicate range support
    resp.writeHeader("Accept-Ranges", "bytes");
    
    // Write original headers
    this.doWriteHeaders(resp);
    
    // Override Content-Length with range length
    const range_length = range.length(content_size);
    resp.writeHeaderInt("Content-Length", range_length);
}

fn renderPartialBytes(this: *StaticRoute, resp: AnyResponse, range: ContentRange.Range, content_size: u64, did_finish: *bool) void {
    _ = content_size;
    did_finish.* = this.onWritablePartialBytes(range, 0, resp);
}

fn toAsyncPartial(this: *StaticRoute, resp: AnyResponse, range: ContentRange.Range, content_size: u64) void {
    _ = content_size;
    
    const pending = bun.new(PendingRangeResponse, .{
        .range = range,
        .resp = resp,
        .route = this,
    });
    
    this.ref(); // Keep the route alive while the response is pending
    
    resp.onAborted(*PendingRangeResponse, PendingRangeResponse.onAborted, pending);
    resp.onWritable(*PendingRangeResponse, PendingRangeResponse.onWritable, pending);
}

const PendingRangeResponse = struct {
    range: ContentRange.Range,
    resp: AnyResponse,
    route: *StaticRoute,
    is_response_pending: bool = true,
    
    pub fn deinit(this: *PendingRangeResponse) void {
        if (this.is_response_pending) {
            this.resp.clearAborted();
            this.resp.clearOnWritable();
        }
        this.route.deref();
        bun.destroy(this);
    }
    
    pub fn onAborted(this: *PendingRangeResponse, _: AnyResponse) void {
        bun.debugAssert(this.is_response_pending == true);
        this.is_response_pending = false;
        this.route.onResponseComplete(this.resp);
        this.deinit();
    }
    
    pub fn onWritable(this: *PendingRangeResponse, write_offset: u64, resp: AnyResponse) bool {
        if (this.route.server) |server| {
            resp.timeout(server.config().idleTimeout);
        }
        
        if (!this.route.onWritablePartialBytes(this.range, write_offset, resp)) {
            return false;
        }
        
        this.is_response_pending = false;
        this.route.onResponseComplete(resp);
        this.deinit();
        return true;
    }
};

fn onWritablePartialBytes(this: *StaticRoute, range: ContentRange.Range, write_offset: u64, resp: AnyResponse) bool {
    const blob = this.blob;
    const all_bytes = blob.slice();
    
    // Calculate the actual slice for this range
    const range_start = @min(range.start, all_bytes.len);
    const range_end = @min(range.actualEnd(all_bytes.len), all_bytes.len - 1);
    
    if (range_start > range_end or range_start >= all_bytes.len) {
        // Empty range
        return resp.tryEnd(&[_]u8{}, 0, resp.shouldCloseConnection());
    }
    
    const range_bytes = all_bytes[range_start..range_end + 1];
    const bytes = range_bytes[@min(range_bytes.len, write_offset)..];
    
    return resp.tryEnd(bytes, range_bytes.len, resp.shouldCloseConnection());
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const api = bun.schema.api;
const AnyServer = jsc.API.AnyServer;
const writeStatus = bun.api.server.writeStatus;
const AnyBlob = jsc.WebCore.Blob.Any;

const ETag = bun.http.ETag;
const Headers = bun.http.Headers;
const ContentRange = bun.http.ContentRange;

const uws = bun.uws;
const AnyResponse = uws.AnyResponse;
