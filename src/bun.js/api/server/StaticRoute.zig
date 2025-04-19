//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.
const StaticRoute = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

/// Represents a parsed byte range from a Range header
const ByteRange = struct {
    /// Start position (inclusive)
    start: u64,
    /// End position (inclusive)
    end: u64,
};

/// Result of parsing a Range header value
const RangeParseResult = union(enum) {
    /// Range is valid and satisfiable
    Valid: ByteRange,
    /// Range is valid but unsatisfiable (e.g., start >= file size)
    Unsatisfiable,
    /// Range is invalid (e.g., malformed syntax)
    Invalid,
};

/// StreamContext tracks additional information needed for a response stream
/// It's allocated separately and associated with a response via its userData field
const StreamContext = struct {
    /// The byte range for partial content responses, if applicable
    byte_range: ?ByteRange = null,
    
    /// Allocate a new StreamContext
    pub fn create() *StreamContext {
        return bun.new(StreamContext, .{});
    }
    
    /// Free a StreamContext
    pub fn destroy(ctx: *StreamContext) void {
        bun.destroy(ctx);
    }
};

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
etag: ?bun.String = null,

pub const InitFromBytesOptions = struct {
    server: ?AnyServer,
    mime_type: ?*const bun.http.MimeType = null,
    status_code: u16 = 200,
    etag: ?bun.String = null,
};

/// Ownership of `blob` is transferred to this function.
pub fn initFromAnyBlob(blob: *const AnyBlob, options: InitFromBytesOptions) *StaticRoute {
    var headers = Headers.from(null, bun.default_allocator, .{ .body = blob }) catch bun.outOfMemory();
    if (options.mime_type) |mime_type| {
        if (headers.getContentType() == null) {
            headers.append("Content-Type", mime_type.value) catch bun.outOfMemory();
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
        .etag = options.etag,
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
    
    if (this.etag) |etag| {
        etag.deref();
    }

    bun.destroy(this);
}

pub fn clone(this: *StaticRoute, globalThis: *JSC.JSGlobalObject) !*StaticRoute {
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
        .etag = this.etag,
    });
}

pub fn memoryCost(this: *const StaticRoute) usize {
    var cost = @sizeOf(StaticRoute) + this.blob.memoryCost() + this.headers.memoryCost();
    if (this.etag) |etag| {
        cost += etag.byteSlice().len;
    }
    return cost;
}

pub fn fromJS(globalThis: *JSC.JSGlobalObject, argument: JSC.JSValue) bun.JSError!*StaticRoute {
    if (argument.as(JSC.WebCore.Response)) |response| {
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

                else => {
                    return globalThis.throwInvalidArguments("Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body.", .{});
                },
            }
        };

        var has_content_disposition = false;
        var etag: ?bun.String = null;

        if (response.init.headers) |headers| {
            has_content_disposition = headers.fastHas(.ContentDisposition);
            headers.fastRemove(.TransferEncoding);
            headers.fastRemove(.ContentLength);
            
            // Extract ETag if present
            if (headers.fastGet(.ETag)) |etag_value| {
                // Convert ZigString to Bun String
                etag = bun.String.fromBytes(etag_value.slice());
            }
        }

        const headers: Headers = if (response.init.headers) |headers|
            Headers.from(headers, bun.default_allocator, .{
                .body = &blob,
            }) catch {
                blob.detach();
                if (etag) |e| e.deref();
                globalThis.throwOutOfMemory();
                return error.JSError;
            }
        else
            .{
                .allocator = bun.default_allocator,
            };

        return bun.new(StaticRoute, .{
            .ref_count = .init(),
            .blob = blob,
            .cached_blob_size = blob.size(),
            .has_content_disposition = has_content_disposition,
            .headers = headers,
            .server = null,
            .status_code = response.statusCode(),
            .etag = etag,
        });
    }

    return globalThis.throwInvalidArguments(
        \\'routes' expects a Record<string, Response | HTMLBundle | {[method: string]: (req: BunRequest) => Response|Promise<Response>}>
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
        \\  routes: {
        \\    "/index.json": Response.json({ message: "Hello World" }),
        \\    "/app": app,
        \\    "/path/:param": (req) => {
        \\      const param = req.params.param;
        \\      return Response.json({ message: `Hello ${param}` });
        \\    },
        \\    "/path": {
        \\      GET(req) {
        \\        return Response.json({ message: "Hello World" });
        \\      },
        \\      POST(req) {
        \\        return Response.json({ message: "Hello World" });
        \\      },
        \\    },
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
pub fn onHEADRequest(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) void {
    req.setYield(false);
    
    // Check for If-None-Match header for conditional HEAD
    if (this.checkIfNoneMatch(req, resp)) {
        return; // If-None-Match check resulted in 304 response
    }
    
    // Note: We intentionally do not process Range headers for HEAD requests
    // Per RFC 9110, Range is primarily for GET requests
    // Simply ignore Range header for HEAD and process as normal HEAD request
    
    this.onHEAD(resp);
}

/// Handle a successful conditional request by returning 304 Not Modified
fn handleConditionalRequest(this: *StaticRoute, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    resp.corked(renderNotModified, .{ this, resp });
    this.onResponseComplete(resp);
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
    req.setYield(false);
    
    // Check for If-None-Match header for conditional GET/HEAD
    if (this.checkIfNoneMatch(req, resp)) {
        return; // If-None-Match check resulted in 304 response
    }
    
    // Range header handling (only for GET requests, not for HEAD)
    // Only process Range if blob has content and status is 200 (OK)
    if (this.cached_blob_size > 0 and this.status_code == 200) {
        if (req.header("range")) |range_header| {
            // Parse and validate the Range header
            const range_result = parseRangeHeader(range_header, this.cached_blob_size);
            
            switch (range_result) {
                .Valid => |range| {
                    // Handle partial content for the given range
                    this.handlePartialContent(resp, range);
                    return;
                },
                .Unsatisfiable => {
                    // Handle unsatisfiable range
                    this.handleRangeNotSatisfiable(resp);
                    return;
                },
                .Invalid => {
                    // Invalid Range header, proceed with normal 200 OK response
                },
            }
        }
    }
    
    // If we get here, proceed with normal request handling
    this.on(resp);
}

/// Handle a Range Not Satisfiable request by returning 416
fn handleRangeNotSatisfiable(this: *StaticRoute, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    resp.corked(renderRangeNotSatisfiable, .{ this, resp });
    this.onResponseComplete(resp);
}

/// Handle a Partial Content request by returning 206 with the requested range
fn handlePartialContent(this: *StaticRoute, resp: AnyResponse, range: ByteRange) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    
    // Create StreamContext and store the range
    const stream_ctx = StreamContext.create();
    stream_ctx.byte_range = range;
    resp.setUserData(stream_ctx);
    
    var finished = false;
    resp.corked(renderPartialContent, .{ this, resp, range, &finished });
    
    if (finished) {
        // Clean up the StreamContext
        if (resp.getUserData()) |ptr| {
            const ctx = @ptrCast(*StreamContext, @alignCast(@alignOf(StreamContext), ptr));
            StreamContext.destroy(ctx);
            resp.setUserData(null);
        }
        
        this.onResponseComplete(resp);
        return;
    }
    
    this.toAsync(resp);
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
    // Clean up the StreamContext if present
    if (resp.getUserData()) |ptr| {
        const ctx = @ptrCast(*StreamContext, @alignCast(@alignOf(StreamContext), ptr));
        StreamContext.destroy(ctx);
        resp.setUserData(null);
    }
    
    this.onResponseComplete(resp);
}

fn onResponseComplete(this: *StaticRoute, resp: AnyResponse) void {
    resp.clearAborted();
    resp.clearOnWritable();
    resp.clearTimeout();
    
    // Clean up the StreamContext if present
    if (resp.getUserData()) |ptr| {
        const ctx = @ptrCast(*StreamContext, @alignCast(@alignOf(StreamContext), ptr));
        StreamContext.destroy(ctx);
        resp.setUserData(null);
    }
    
    if (this.server) |server| {
        server.onStaticRequestComplete();
    }
    this.deref();
}

pub fn doRenderBlob(this: *StaticRoute, resp: AnyResponse, did_finish: *bool) void {
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

pub fn doRenderBlobCorked(this: *StaticRoute, resp: AnyResponse, did_finish: *bool) void {
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
    
    // Get StreamContext if available
    const stream_ctx = if (resp.getUserData()) |ptr| @ptrCast(*StreamContext, @alignCast(@alignOf(StreamContext), ptr)) else null;
    
    // Check if this is a range request
    if (stream_ctx != null and stream_ctx.?.byte_range != null) {
        const range = stream_ctx.?.byte_range.?;
        
        // Get the range-relative offset
        const range_size = range.end - range.start + 1;
        const range_offset = range.start + @min(write_offset, range_size);
        
        // Ensure the offset isn't past the end
        if (range_offset > range.end) {
            return true; // We've sent everything
        }
        
        // Calculate remaining bytes in range
        const bytes_to_send = @min(all_bytes.len - range_offset, range.end + 1 - range_offset);
        const bytes = all_bytes[range_offset..][0..bytes_to_send];
        
        return resp.tryEnd(bytes, range_size, resp.shouldCloseConnection());
    } else {
        // Regular (non-range) request
        const bytes = all_bytes[@min(all_bytes.len, write_offset)..];
        return resp.tryEnd(bytes, all_bytes.len, resp.shouldCloseConnection());
    }
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
            const names: []const Api.StringPointer = entries.items(.name);
            const values: []const Api.StringPointer = entries.items(.value);
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
    
    // Add ETag header if available
    this.addETagHeader();
    
    // Add Accept-Ranges header for GET requests if serving a blob with size > 0
    // This advertises that we support Range requests
    if (size > 0) {
        // Use fastHas for efficient lookup instead of linear scan
        if (!this.headers.fastHas(.AcceptRanges)) {
            this.headers.append("Accept-Ranges", "bytes") catch {};
        }
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

const std = @import("std");
const bun = @import("bun");

const Api = @import("../../../api/schema.zig").Api;
const JSC = bun.JSC;
const uws = bun.uws;
const Headers = JSC.WebCore.Headers;
const AnyServer = JSC.API.AnyServer;
const AnyBlob = JSC.WebCore.AnyBlob;
const writeStatus = @import("../server.zig").writeStatus;
const AnyResponse = uws.AnyResponse;

/// Compare two ETags using weak comparison per RFC 9110 §8.8.3.2
/// Returns true if they match
fn weakETagMatch(etag1: []const u8, etag2: []const u8) bool {
    // If either is empty, no match
    if (etag1.len == 0 or etag2.len == 0) {
        return false;
    }

    // Extract the actual tag content, skipping the W/ prefix if present
    var actual_etag1 = etag1;
    var actual_etag2 = etag2;

    // Check for W/ prefix (weak ETag) and skip it
    if (actual_etag1.len >= 3 and std.mem.eql(u8, actual_etag1[0..2], "W/")) {
        actual_etag1 = actual_etag1[2..];
    }
    if (actual_etag2.len >= 3 and std.mem.eql(u8, actual_etag2[0..2], "W/")) {
        actual_etag2 = actual_etag2[2..];
    }

    // Compare the actual entity-tags
    return std.mem.eql(u8, actual_etag1, actual_etag2);
}

/// Helper function to check If-None-Match header and determine if a 304 Not Modified response should be sent
/// Returns true if a 304 was sent, false if processing should continue
fn checkIfNoneMatch(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) bool {
    if (this.etag == null or this.status_code != 200) {
        return false;
    }
    
    const if_none_match = req.header("if-none-match") orelse return false;
    const etag_slice = this.etag.?.byteSlice();
    
    // Check if the header value is "*" - matches any existing resource
    if (std.mem.eql(u8, if_none_match, "*")) {
        // Resource exists, so return 304 Not Modified
        this.handleConditionalRequest(resp);
        return true;
    }
    
    // Parse and check for ETag matches
    var current_etag_start: usize = 0;
    var i: usize = 0;
    
    // Process comma-separated list of ETags
    while (i <= if_none_match.len) {
        const is_end = i == if_none_match.len;
        const is_separator = if (!is_end) if_none_match[i] == ',' else false;
        
        if (is_end or is_separator) {
            var etag_value = if_none_match[current_etag_start..i];
            
            // Trim whitespace
            while (etag_value.len > 0 and std.ascii.isWhitespace(etag_value[0])) {
                etag_value = etag_value[1..];
            }
            while (etag_value.len > 0 and std.ascii.isWhitespace(etag_value[etag_value.len - 1])) {
                etag_value = etag_value[0 .. etag_value.len - 1];
            }
            
            // If any ETag matches, return 304 Not Modified
            if (weakETagMatch(etag_value, etag_slice)) {
                this.handleConditionalRequest(resp);
                return true;
            }
            
            current_etag_start = i + 1; // Skip the separator
        }
        
        i += 1;
    }
    
    return false; // Continue with normal processing
}

/// Helper function to add the ETag header if it's not already present in the headers
fn addETagHeader(this: *StaticRoute) void {
    if (this.etag) |etag| {
        const etag_slice = etag.byteSlice();
        if (etag_slice.len > 0) {
            // Use fastHas for efficient lookup instead of linear scan
            if (!this.headers.fastHas(.ETag)) {
                this.headers.append("ETag", etag_slice) catch {};
            }
        }
    }
}

/// Parse a Range header value according to RFC 9110 §14.2
/// LIMITATIONS: 
/// - Only supports 'bytes' unit
/// - Only supports SINGLE ranges (no multipart/byteranges support) - if multiple 
///   ranges are requested (with commas), this will return Invalid and the request
///   will fallback to a normal 200 OK response with the full content
/// - Expects well-formed input with proper syntax
/// 
/// Note: This approach is a deliberate simplification for the initial implementation.
/// 
/// TODO: Support multiple ranges with multipart/byteranges responses (RFC 9110 §14.6)
/// TODO: Implement If-Range support for conditional range requests (RFC 9110 §13.1.5)
/// TODO: Consider support for If-Match and If-Unmodified-Since preconditions
/// TODO: Support Last-Modified based conditional requests via If-Modified-Since
/// 
/// Returns a RangeParseResult indicating valid, unsatisfiable, or invalid
fn parseRangeHeader(range_header: []const u8, total_size: u64) RangeParseResult {
    // Verify bytes unit prefix
    if (!std.mem.startsWith(u8, range_header, "bytes=")) {
        return .Invalid;
    }

    // Skip "bytes=" prefix
    const ranges_part = range_header[6..];
    
    // We currently only support a single range
    if (std.mem.indexOfScalar(u8, ranges_part, ',') != null) {
        // TODO: Support multiple ranges with multipart/byteranges response type (RFC 9110 §14.6)
        // Multiple ranges requested, which we don't support yet - proceed with 200 OK
        return .Invalid;
    }
    
    const range_spec = ranges_part;
    
    // Handle suffix range: "bytes=-N" where N is the suffix length
    if (range_spec.len > 0 and range_spec[0] == '-') {
        // Extract suffix length
        const suffix_len = std.fmt.parseInt(u64, range_spec[1..], 10) catch |err| {
            // Any parsing error (invalid chars, overflow, etc) results in Invalid
            return .Invalid;
        };
        
        // If suffix length is 0, or larger than the total size, it's unsatisfiable
        if (suffix_len == 0 or suffix_len > total_size) {
            return .Unsatisfiable;
        }
        
        // Calculate start and end based on suffix
        const start = total_size - suffix_len;
        const end = total_size - 1; // inclusive end
        
        return .{ .Valid = .{
            .start = start,
            .end = end,
        }};
    }
    
    // Handle range with start: "bytes=N-" or "bytes=N-M"
    const dash_index = std.mem.indexOfScalar(u8, range_spec, '-') orelse {
        return .Invalid;
    };
    
    // Parse start value
    const start = std.fmt.parseInt(u64, range_spec[0..dash_index], 10) catch |err| {
        // Any parsing error (invalid chars, overflow, etc) results in Invalid
        return .Invalid;
    };
    
    // If start is beyond the total size, it's unsatisfiable
    if (start >= total_size) {
        return .Unsatisfiable;
    }
    
    // Handle open-ended range: "bytes=N-"
    if (dash_index == range_spec.len - 1) {
        return .{ .Valid = .{
            .start = start,
            .end = total_size - 1, // inclusive end is the last byte
        }};
    }
    
    // Handle fully specified range: "bytes=N-M"
    const end = std.fmt.parseInt(u64, range_spec[dash_index + 1..], 10) catch |err| {
        // Any parsing error (invalid chars, overflow, etc) results in Invalid
        return .Invalid;
    };
    
    // If end is less than start, it's invalid
    if (end < start) {
        return .Invalid;
    }
    
    // If end is beyond the total size, clamp it to the maximum possible
    const clamped_end = @min(end, total_size - 1);
    
    return .{ .Valid = .{
        .start = start,
        .end = clamped_end,
    }};
}

/// Renders a 304 Not Modified response
fn renderNotModified(this: *StaticRoute, resp: AnyResponse) void {
    this.doWriteStatus(304, resp);
    
    // Add ETag header if available
    this.addETagHeader();
    
    this.doWriteHeaders(resp);
    resp.endWithoutBody(resp.shouldCloseConnection());
}

/// Renders a 416 Range Not Satisfiable response
fn renderRangeNotSatisfiable(this: *StaticRoute, resp: AnyResponse) void {
    this.doWriteStatus(416, resp);
    
    // Add Content-Range header indicating total size (e.g., Content-Range: bytes */1000)
    var content_range_buf: [64]u8 = undefined;
    const content_range = std.fmt.bufPrint(&content_range_buf, "bytes */{d}", .{this.cached_blob_size}) catch |err| {
        // This should not fail since 64 bytes is plenty for any reasonable size,
        // but if it does, we still need to set a reasonable Content-Range header
        resp.writeHeader("Content-Range", "bytes */0");
        return;
    };
    resp.writeHeader("Content-Range", content_range);
    
    // Add ETag header if available
    this.addETagHeader();
    
    this.doWriteHeaders(resp);
    resp.endWithoutBody(resp.shouldCloseConnection());
}

/// Renders a 206 Partial Content response with the specified byte range
fn renderPartialContent(this: *StaticRoute, resp: AnyResponse, range: ByteRange, did_finish: *bool) void {
    this.doWriteStatus(206, resp);
    
    // Add Content-Range header indicating the range being sent and total size
    var content_range_buf: [128]u8 = undefined;
    const content_range = std.fmt.bufPrint(&content_range_buf, "bytes {d}-{d}/{d}", .{
        range.start, range.end, this.cached_blob_size
    }) catch |err| {
        // This should not fail since 128 bytes is plenty for any reasonable size,
        // but if it does, fallback to a simpler format
        resp.writeHeader("Content-Range", "bytes 0-0/0");
        return;
    };
    resp.writeHeader("Content-Range", content_range);
    
    // Set Content-Length to the size of the range being sent
    const range_length = range.end - range.start + 1;
    resp.writeHeaderInt("Content-Length", range_length);
    
    // Add ETag header if available
    this.addETagHeader();
    
    // Write other headers
    this.doWriteHeaders(resp);
    
    // Send the range of bytes
    this.renderBytesRange(resp, range, did_finish);
}

/// Sends a range of bytes from the blob
fn renderBytesRange(this: *StaticRoute, resp: AnyResponse, range: ByteRange, did_finish: *bool) void {
    const blob = this.blob;
    const all_bytes = blob.slice();
    
    // Ensure we don't read past the end of the array
    const start = @min(range.start, all_bytes.len);
    const end = @min(range.end + 1, all_bytes.len); // +1 because end is inclusive, but slice is exclusive
    
    const bytes = all_bytes[start..end];
    const range_length = range.end - range.start + 1;
    
    did_finish.* = resp.tryEnd(bytes, range_length, resp.shouldCloseConnection());
}
