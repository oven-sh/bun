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
    
    /// Calculate the length of this range
    pub fn length(self: ByteRange) u64 {
        return self.end - self.start + 1;
    }
};

/// List of byte ranges with its allocator
const ByteRangeList = struct {
    ranges: std.ArrayList(ByteRange),
    
    pub fn init(allocator: std.mem.Allocator) ByteRangeList {
        return ByteRangeList{
            .ranges = std.ArrayList(ByteRange).init(allocator),
        };
    }
    
    pub fn deinit(self: *ByteRangeList) void {
        self.ranges.deinit();
    }
};

/// Result of parsing a Range header value
const RangeParseResult = union(enum) {
    /// Single range that's valid and satisfiable
    SingleRange: ByteRange,
    /// Multiple ranges that are valid and satisfiable
    MultipleRanges: *ByteRangeList,
    /// Range is valid but unsatisfiable (e.g., start >= file size)
    Unsatisfiable,
    /// Range is invalid (e.g., malformed syntax)
    Invalid,
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
        \'routes' expects a Record<string, Response | HTMLBundle | {[method: string]: (req: BunRequest) => Response|Promise<Response>}>
        \
        \To bundle frontend apps on-demand with Bun.serve(), import HTML files.
        \
        \Example:
        \
        \```js
        \import { serve } from "bun";
        \import app from "./app.html";
        \
        \serve({
        \  routes: {
        \    "/index.json": Response.json({ message: "Hello World" }),
        \    "/app": app,
        \    "/path/:param": (req) => {
        \      const param = req.params.param;
        \      return Response.json({ message: `Hello ${param}` });
        \    },
        \    "/path": {
        \      GET(req) {
        \        return Response.json({ message: "Hello World" });
        \      },
        \      POST(req) {
        \        return Response.json({ message: "Hello World" });
        \      },
        \    },
        \  },
        \
        \  fetch(request) {
        \    return new Response("fallback response");
        \  },
        \});
        \```
        \
        \See https://bun.sh/docs/api/http for more information.
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

/// Check if the If-Range precondition passes, allowing a partial response
/// Returns true if the Range can be processed, false if a full response should be sent instead
fn checkIfRange(this: *StaticRoute, req: *uws.Request) bool {
    const if_range = req.header("if-range") orelse return true; // No If-Range means we can process Range
    
    // If we have an ETag, use it for validation
    if (this.etag) |etag| {
        const etag_slice = etag.byteSlice();
        // If the client's If-Range has a matching ETag, process Range
        return weakETagMatch(if_range, etag_slice);
    }
    
    // If no ETag, we can't validate If-Range properly - default to full response
    return false;
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
            // Check If-Range precondition if present
            if (!this.checkIfRange(req)) {
                // If-Range precondition failed, ignore Range and serve full resource
                this.on(resp);
                return;
            }
            
            // Parse and validate the Range header
            const range_result = parseRangeHeader(range_header, this.cached_blob_size);
            
            switch (range_result) {
                .SingleRange => |range| {
                    // Handle partial content for the given range
                    this.handlePartialContent(resp, range);
                    return;
                },
                .MultipleRanges => |range_list| {
                    // Handle multipart/byteranges response
                    this.handleMultipartRanges(resp, range_list);
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
    
    var finished = false;
    resp.corked(renderPartialContent, .{ this, resp, range, &finished });
    
    if (finished) {
        // Response finished synchronously
        this.onResponseComplete(resp);
        return;
    }
    
    // Only allocate ByteRange when going async
    const range_ptr = bun.new(ByteRange, range);
    resp.setUserData(range_ptr);
    
    this.toAsync(resp);
}

/// Handle a multipart/byteranges response per RFC 9110 §14.6
fn handleMultipartRanges(this: *StaticRoute, resp: AnyResponse, range_list: *ByteRangeList) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    
    var finished = false;
    resp.corked(renderMultipartRanges, .{ this, resp, range_list, &finished });
    
    if (finished) {
        // Response finished synchronously and range_list was destroyed in renderMultipartRanges
        this.onResponseComplete(resp);
        return;
    }
    
    // Pass ownership of range_list to the response
    resp.setUserData(range_list);
    
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
    // Clean up the ByteRange or ByteRangeList if present
    if (resp.getUserData()) |ptr| {
        // Check if it's a ByteRange or ByteRangeList based on size
        if (@typeInfo(*ByteRange).Pointer.size == @typeInfo(*ByteRangeList).Pointer.size) {
            // This would require a more sophisticated approach if the pointers are the same size
            // For simplicity, assume it's a ByteRange for now
            const range_ptr = @ptrCast(*ByteRange, @alignCast(@alignOf(ByteRange), ptr));
            bun.destroy(range_ptr);
        } else if (@sizeOf(*ByteRange) < @sizeOf(*ByteRangeList)) {
            // ByteRange is smaller, check if it's a ByteRange
            const range_ptr = @ptrCast(*ByteRange, @alignCast(@alignOf(ByteRange), ptr));
            bun.destroy(range_ptr);
        } else {
            // Assume it's a ByteRangeList
            const list_ptr = @ptrCast(*ByteRangeList, @alignCast(@alignOf(ByteRangeList), ptr));
            list_ptr.deinit();
            bun.destroy(list_ptr);
        }
        resp.setUserData(null);
    }
    
    this.onResponseComplete(resp);
}

fn onResponseComplete(this: *StaticRoute, resp: AnyResponse) void {
    resp.clearAborted();
    resp.clearOnWritable();
    resp.clearTimeout();
    
    // Clean up the ByteRange or ByteRangeList if present
    if (resp.getUserData()) |ptr| {
        // The same pointer type differentiation as in onAborted
        if (@typeInfo(*ByteRange).Pointer.size == @typeInfo(*ByteRangeList).Pointer.size) {
            // This would require a more sophisticated approach if the pointers are the same size
            // For simplicity, assume it's a ByteRange for now
            const range_ptr = @ptrCast(*ByteRange, @alignCast(@alignOf(ByteRange), ptr));
            bun.destroy(range_ptr);
        } else if (@sizeOf(*ByteRange) < @sizeOf(*ByteRangeList)) {
            // ByteRange is smaller, check if it's a ByteRange
            const range_ptr = @ptrCast(*ByteRange, @alignCast(@alignOf(ByteRange), ptr));
            bun.destroy(range_ptr);
        } else {
            // Assume it's a ByteRangeList
            const list_ptr = @ptrCast(*ByteRangeList, @alignCast(@alignOf(ByteRangeList), ptr));
            list_ptr.deinit();
            bun.destroy(list_ptr);
        }
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
    
    // Get ByteRange if available
    if (resp.getUserData()) |ptr| {
        // Check pointer type - this is a simplified check
        if (@sizeOf(*ByteRange) < @sizeOf(*ByteRangeList)) {
            // It's likely a ByteRange
            const range = @ptrCast(*ByteRange, @alignCast(@alignOf(ByteRange), ptr));
            
            // Calculate range parameters once
            const range_size = range.length();
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
            // It's likely a ByteRangeList (for multipart response)
            // Handle multipart writing - this is more complex
            // For now, just serve everything in one go - in practice, this would stream
            // the parts as needed
            return true; // Already sent in renderMultipartRanges
        }
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

/// Parse one range specification from a Range header
/// Returns a ByteRange if valid, or null if invalid or unsatisfiable
fn parseOneRangeSpec(
    range_spec: []const u8, 
    total_size: u64
) ?ByteRange {
    // Handle suffix range: "-N" where N is the suffix length
    if (range_spec.len > 0 and range_spec[0] == '-') {
        // Extract suffix length
        const suffix_len = std.fmt.parseInt(u64, range_spec[1..], 10) catch |err| {
            return null; // Invalid syntax
        };
        
        // If suffix length is 0, it's an invalid range
        if (suffix_len == 0) {
            return null;
        }
        
        // Calculate start and end based on suffix
        const start = if (suffix_len > total_size) 0 else total_size - suffix_len;
        const end = total_size - 1; // inclusive end
        
        return ByteRange{
            .start = start,
            .end = end,
        };
    }
    
    // Find the dash that separates start and end
    const dash_index = std.mem.indexOfScalar(u8, range_spec, '-') orelse {
        return null; // No dash means invalid syntax
    };
    
    // Parse start value
    const start = std.fmt.parseInt(u64, range_spec[0..dash_index], 10) catch |err| {
        return null; // Invalid syntax
    };
    
    // If start is beyond the total size, it's unsatisfiable
    if (start >= total_size) {
        return null;
    }
    
    // Handle open-ended range: "N-"
    if (dash_index == range_spec.len - 1) {
        return ByteRange{
            .start = start,
            .end = total_size - 1, // inclusive end is the last byte
        };
    }
    
    // Handle fully specified range: "N-M"
    const end = std.fmt.parseInt(u64, range_spec[dash_index + 1..], 10) catch |err| {
        return null; // Invalid syntax
    };
    
    // If end is less than start, it's invalid
    if (end < start) {
        return null;
    }
    
    // If end is beyond the total size, clamp it to the maximum possible
    const clamped_end = @min(end, total_size - 1);
    
    return ByteRange{
        .start = start,
        .end = clamped_end,
    };
}

/// Parse a Range header value according to RFC 9110 §14.2
/// Returns a RangeParseResult indicating single range, multiple ranges, unsatisfiable, or invalid
fn parseRangeHeader(range_header: []const u8, total_size: u64) RangeParseResult {
    // Empty resources can't satisfy normal ranges
    if (total_size == 0) {
        return .Unsatisfiable;
    }

    // Verify bytes unit prefix
    if (!std.mem.startsWith(u8, range_header, "bytes=")) {
        return .Invalid;
    }

    // Skip "bytes=" prefix
    const ranges_part = range_header[6..];
    
    // Check if it contains commas (multiple ranges)
    if (std.mem.indexOfScalar(u8, ranges_part, ',') == null) {
        // Single range case
        if (parseOneRangeSpec(ranges_part, total_size)) |range| {
            return .{ .SingleRange = range };
        } else {
            return .Unsatisfiable;
        }
    }
    
    // Handle multiple ranges
    var range_list = bun.new(ByteRangeList, ByteRangeList.init(bun.default_allocator));
    errdefer {
        range_list.deinit();
        bun.destroy(range_list);
    }
    
    var iterator = std.mem.split(u8, ranges_part, ",");
    var has_valid_range = false;
    
    while (iterator.next()) |range_spec| {
        var trimmed_spec = range_spec;
        
        // Trim whitespace
        while (trimmed_spec.len > 0 and std.ascii.isWhitespace(trimmed_spec[0])) {
            trimmed_spec = trimmed_spec[1..];
        }
        while (trimmed_spec.len > 0 and std.ascii.isWhitespace(trimmed_spec[trimmed_spec.len - 1])) {
            trimmed_spec = trimmed_spec[0..trimmed_spec.len - 1];
        }
        
        if (parseOneRangeSpec(trimmed_spec, total_size)) |range| {
            range_list.ranges.append(range) catch {
                // Memory allocation failed
                range_list.deinit();
                bun.destroy(range_list);
                return .Invalid;
            };
            has_valid_range = true;
        }
    }
    
    // If no valid ranges were found, the entire range is unsatisfiable
    if (!has_valid_range) {
        range_list.deinit();
        bun.destroy(range_list);
        return .Unsatisfiable;
    }
    
    // Special case: if we only parsed one range, return it as SingleRange
    if (range_list.ranges.items.len == 1) {
        const single_range = range_list.ranges.items[0];
        range_list.deinit();
        bun.destroy(range_list);
        return .{ .SingleRange = single_range };
    }
    
    return .{ .MultipleRanges = range_list };
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
    const range_length = range.length();
    resp.writeHeaderInt("Content-Length", range_length);
    
    // Add ETag header if available
    this.addETagHeader();
    
    // Write other headers
    this.doWriteHeaders(resp);
    
    // Send the range of bytes
    this.renderBytesRange(resp, range, did_finish);
}

/// Generate a multipart boundary that's guaranteed not to appear in the content
fn generateMultipartBoundary() [32]u8 {
    var boundary: [32]u8 = undefined;
    
    // Use a recognizable prefix
    std.mem.copy(u8, boundary[0..], "BunStaticRoute--");
    
    // Fill the rest with hex characters
    for (boundary[16..]) |*c, i| {
        // Simple way to generate pseudorandom hex chars
        c.* = std.fmt.digitToChar(@intCast(u8, (std.time.milliTimestamp() + i) % 16), std.fmt.Case.lower);
    }
    
    return boundary;
}

/// Generate the MIME multipart headers for a specific range part
fn writeMultipartPartHeader(
    writer: anytype,
    boundary: []const u8,
    range: ByteRange,
    total_size: u64,
    content_type: []const u8
) !void {
    // Write part delimiter line
    try writer.print("--{s}\r\n", .{boundary});
    
    // Content-Type header
    try writer.print("Content-Type: {s}\r\n", .{content_type});
    
    // Content-Range header
    try writer.print("Content-Range: bytes {d}-{d}/{d}\r\n", .{range.start, range.end, total_size});
    
    // Empty line to separate headers from body
    try writer.writeAll("\r\n");
}

/// Renders a multipart/byteranges response for multiple ranges per RFC 9110 §14.6
fn renderMultipartRanges(this: *StaticRoute, resp: AnyResponse, range_list: *ByteRangeList, did_finish: *bool) void {
    // Cleanup is handled by the caller
    defer {
        range_list.deinit();
        bun.destroy(range_list);
    }
    
    this.doWriteStatus(206, resp);
    
    // Generate a boundary for the multipart response
    var boundary = generateMultipartBoundary();
    
    // Get the content type for the parts
    const content_type = this.headers.getContentType() orelse "application/octet-stream";
    
    // Calculate total size of the multipart response
    // Each part will have:
    // 1. Boundary line
    // 2. Content-Type header
    // 3. Content-Range header
    // 4. Empty line
    // 5. Range data
    // 6. Final boundary with -- at end
    
    var total_size: u64 = 0;
    
    // Each part has headers
    for (range_list.ranges.items) |range| {
        // Boundary line: --{boundary}\r\n
        total_size += 2 + boundary.len + 2;
        
        // Content-Type: {content_type}\r\n
        total_size += 14 + content_type.len + 2;
        
        // Content-Range: bytes {start}-{end}/{total}\r\n
        // Worst case: 16 + 20 + 1 + 20 + 1 + 20 + 2 = ~80 chars
        total_size += 80;
        
        // Empty line: \r\n
        total_size += 2;
        
        // Actual data for this range
        total_size += range.length();
        
        // Each part except the last is followed by \r\n
        total_size += 2;
    }
    
    // Final boundary
    total_size += 2 + boundary.len + 4; // --{boundary}--\r\n
    
    // Set the Content-Type header for the multipart response
    var content_type_buf: [128]u8 = undefined;
    const multipart_content_type = std.fmt.bufPrint(
        &content_type_buf,
        "multipart/byteranges; boundary={s}",
        .{boundary}
    ) catch |err| {
        // This should not fail, but if it does, we need to handle it
        resp.writeHeader("Content-Type", "multipart/byteranges");
        return;
    };
    resp.writeHeader("Content-Type", multipart_content_type);
    
    // Set Content-Length
    resp.writeHeaderInt("Content-Length", total_size);
    
    // Add ETag header if available
    this.addETagHeader();
    
    // Write other headers
    this.doWriteHeaders(resp);
    
    // Now we need to write all parts
    // First, we'll build the whole response in memory using an ArrayList
    var buffer = std.ArrayList(u8).init(bun.default_allocator);
    defer buffer.deinit();
    
    const all_bytes = this.blob.slice();
    
    // Write all parts to the buffer
    for (range_list.ranges.items) |range| {
        // Write part header
        writeMultipartPartHeader(
            buffer.writer(),
            boundary[0..],
            range,
            this.cached_blob_size,
            content_type
        ) catch |err| {
            // If we can't write to the buffer, we can't continue
            resp.endWithoutBody(resp.shouldCloseConnection());
            return;
        };
        
        // Get the bytes for this range
        const start = @min(range.start, all_bytes.len);
        const end = @min(range.end + 1, all_bytes.len);
        const part_bytes = all_bytes[start..end];
        
        // Write the part data
        buffer.appendSlice(part_bytes) catch |err| {
            // If we can't write to the buffer, we can't continue
            resp.endWithoutBody(resp.shouldCloseConnection());
            return;
        };
        
        // Write a CRLF after each part except the last one
        buffer.appendSlice("\r\n") catch |err| {
            resp.endWithoutBody(resp.shouldCloseConnection());
            return;
        };
    }
    
    // Write the final boundary
    buffer.writer().print("--{s}--\r\n", .{boundary[0..]}) catch |err| {
        resp.endWithoutBody(resp.shouldCloseConnection());
        return;
    };
    
    // Send the entire multipart response
    did_finish.* = resp.tryEnd(buffer.items, total_size, resp.shouldCloseConnection());
}

/// Sends a range of bytes from the blob
fn renderBytesRange(this: *StaticRoute, resp: AnyResponse, range: ByteRange, did_finish: *bool) void {
    const blob = this.blob;
    const all_bytes = blob.slice();
    
    // Ensure we don't read past the end of the array
    const start = @min(range.start, all_bytes.len);
    const end = @min(range.end + 1, all_bytes.len); // +1 because end is inclusive, but slice is exclusive
    
    const bytes = all_bytes[start..end];
    const range_length = range.length();
    
    did_finish.* = resp.tryEnd(bytes, range_length, resp.shouldCloseConnection());
}