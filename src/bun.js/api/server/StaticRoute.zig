//! StaticRoute stores and serves a static blob. This can be created out of a JS
//! Response object, or from globally allocated bytes.

const StaticRoute = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

/// Compressed variant of the static response
pub const CompressedVariant = struct {
    data: []u8,
    etag: []const u8,
    encoding: bun.http.Encoding,

    pub fn deinit(this: *CompressedVariant, allocator: std.mem.Allocator) void {
        allocator.free(this.data);
        allocator.free(this.etag);
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

// Lazy-initialized compressed variants (cached)
compressed_br: ?CompressedVariant = null,
compressed_gzip: ?CompressedVariant = null,
compressed_zstd: ?CompressedVariant = null,
compressed_deflate: ?CompressedVariant = null,

pub const InitFromBytesOptions = struct {
    server: ?AnyServer,
    mime_type: ?*const bun.http.MimeType = null,
    status_code: u16 = 200,
    headers: ?*jsc.WebCore.FetchHeaders = null,
};

/// Ownership of `blob` is transferred to this function.
pub fn initFromAnyBlob(blob: *const AnyBlob, options: InitFromBytesOptions) *StaticRoute {
    var headers = bun.handleOom(Headers.from(options.headers, bun.default_allocator, .{ .body = blob }));
    if (options.mime_type) |mime_type| {
        if (headers.getContentType() == null) {
            bun.handleOom(headers.append("Content-Type", mime_type.value));
        }
    }

    // Generate ETag if not already present
    if (headers.get("etag") == null) {
        if (blob.slice().len > 0) {
            bun.handleOom(ETag.appendToHeaders(blob.slice(), &headers));
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

    // Clean up compressed variants
    if (this.compressed_br) |*variant| variant.deinit(bun.default_allocator);
    if (this.compressed_gzip) |*variant| variant.deinit(bun.default_allocator);
    if (this.compressed_zstd) |*variant| variant.deinit(bun.default_allocator);
    if (this.compressed_deflate) |*variant| variant.deinit(bun.default_allocator);

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
    var cost = @sizeOf(StaticRoute) + this.blob.memoryCost() + this.headers.memoryCost();

    // Add compressed variant costs
    if (this.compressed_br) |variant| cost += variant.data.len + variant.etag.len;
    if (this.compressed_gzip) |variant| cost += variant.data.len + variant.etag.len;
    if (this.compressed_zstd) |variant| cost += variant.data.len + variant.etag.len;
    if (this.compressed_deflate) |variant| cost += variant.data.len + variant.etag.len;

    return cost;
}

pub fn fromJS(globalThis: *jsc.JSGlobalObject, argument: jsc.JSValue) bun.JSError!?*StaticRoute {
    if (argument.as(jsc.WebCore.Response)) |response| {

        // The user may want to pass in the same Response object multiple endpoints
        // Let's let them do that.
        const bodyValue = response.getBodyValue();
        bodyValue.toBlobIfPossible();

        const blob: AnyBlob = brk: {
            switch (bodyValue.*) {
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
                    if (bodyValue.* == .Blob and bodyValue.Blob.needsToReadFile()) {
                        return globalThis.throwTODO("TODO: support Bun.file(path) in static routes");
                    }
                    var blob = bodyValue.use();
                    blob.globalThis = globalThis;
                    bun.assertf(
                        !blob.isHeapAllocated(),
                        "expected blob not to be heap-allocated",
                        .{},
                    );
                    bodyValue.* = .{ .Blob = blob.dupe() };

                    break :brk .{ .Blob = blob };
                },

                else => {
                    return globalThis.throwInvalidArguments("Body must be fully buffered before it can be used in a static route. Consider calling new Response(await response.blob()) to buffer the body.", .{});
                },
            }
        };

        var has_content_disposition = false;

        if (response.getInitHeaders()) |headers| {
            has_content_disposition = headers.fastHas(.ContentDisposition);
            headers.fastRemove(.TransferEncoding);
            headers.fastRemove(.ContentLength);
        }

        var headers: Headers = if (response.getInitHeaders()) |h|
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

/// Try to serve a compressed variant if compression is enabled and conditions are met
///
/// NOTE: Streaming responses are NOT handled here - they're rejected at fromJS() line 160
/// and go through RequestContext instead. This only compresses fully buffered static responses.
fn tryServeCompressed(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) bool {
    const server = this.server orelse return false;
    const config = server.compressionConfig() orelse return false;

    // Check Accept-Encoding header (must be lowercase for uws)
    const accept_encoding = req.header("accept-encoding") orelse return false;
    if (accept_encoding.len == 0) return false;

    // Skip if localhost and configured to disable
    if (config.disable_for_localhost) {
        if (resp.getRemoteSocketInfo()) |addr| {
            if (isLocalhost(addr.ip)) return false;
        }
    }

    // Skip if too small
    if (this.cached_blob_size < config.threshold) return false;

    // Skip if wrong MIME type
    const content_type = this.headers.getContentType();
    if (!bun.http.Compressor.shouldCompressMIME(content_type)) return false;

    // Skip if already has Content-Encoding
    if (this.headers.get("Content-Encoding")) |_| return false;

    // Select best encoding
    const encoding = config.selectBestEncoding(accept_encoding) orelse return false;

    // Get or create compressed variant
    const variant = this.getOrCreateCompressed(encoding, config) catch return false;

    // Serve compressed response
    this.serveCompressed(variant, resp);
    return true;
}

/// Get or create a compressed variant (lazy compression with caching)
fn getOrCreateCompressed(
    this: *StaticRoute,
    encoding: bun.http.Encoding,
    config: *const bun.http.CompressionConfig,
) !*CompressedVariant {
    // Get pointer to the variant slot
    const variant_slot: *?CompressedVariant = switch (encoding) {
        .brotli => &this.compressed_br,
        .gzip => &this.compressed_gzip,
        .zstd => &this.compressed_zstd,
        .deflate => &this.compressed_deflate,
        else => return error.UnsupportedEncoding,
    };

    // Return cached if exists
    if (variant_slot.*) |*cached| {
        return cached;
    }

    // Compress the blob
    const level = switch (encoding) {
        .brotli => config.brotli.?.level,
        .gzip => config.gzip.?.level,
        .zstd => config.zstd.?.level,
        .deflate => config.deflate.?.level,
        else => unreachable,
    };

    const compressed_data = bun.http.Compressor.compress(
        bun.default_allocator,
        this.blob.slice(),
        encoding,
        level,
    );

    // Check if compression failed (empty slice returned)
    if (compressed_data.len == 0) {
        return error.CompressionFailed;
    }

    // Generate ETag for compressed variant by hashing the compressed data
    const compressed_etag = generateCompressedETag(compressed_data);

    // Store in cache
    variant_slot.* = .{
        .data = compressed_data,
        .etag = compressed_etag,
        .encoding = encoding,
    };

    return &variant_slot.*.?;
}

/// Generate ETag for compressed variant by hashing the compressed bytes
/// This ensures the ETag accurately represents the compressed content
fn generateCompressedETag(compressed_data: []const u8) []const u8 {
    const hash = std.hash.XxHash64.hash(0, compressed_data);
    var etag_buf: [40]u8 = undefined;
    const etag_str = std.fmt.bufPrint(&etag_buf, "\"{}\"", .{bun.fmt.hexIntLower(hash)}) catch unreachable;
    return bun.handleOom(bun.default_allocator.dupe(u8, etag_str));
}

/// Serve a compressed response
fn serveCompressed(this: *StaticRoute, variant: *CompressedVariant, resp: AnyResponse) void {
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }

    // Write status
    this.doWriteStatus(this.status_code, resp);

    // Write headers, but skip ETag and Content-Length (we'll set them for compressed data)
    this.doWriteHeadersExcluding(resp, &[_][]const u8{ "etag", "content-length" });

    // Add Vary: Accept-Encoding (critical for caching!)
    resp.writeHeader("Vary", "Accept-Encoding");

    // Set Content-Encoding
    resp.writeHeader("Content-Encoding", variant.encoding.toString());

    // Set ETag for compressed variant
    resp.writeHeader("ETag", variant.etag);

    // Set Content-Length for compressed data
    var content_length_buf: [64]u8 = undefined;
    const content_length = std.fmt.bufPrint(&content_length_buf, "{d}", .{variant.data.len}) catch unreachable;
    resp.writeHeader("Content-Length", content_length);

    // Send body
    resp.end(variant.data, resp.shouldCloseConnection());
    this.onResponseComplete(resp);
}

/// Check if remote address is localhost
fn isLocalhost(addr: []const u8) bool {
    if (addr.len == 0) return false;
    return bun.strings.hasPrefixComptime(addr, "127.") or
        bun.strings.eqlComptime(addr, "::1") or
        bun.strings.eqlComptime(addr, "localhost");
}

pub fn onGET(this: *StaticRoute, req: *uws.Request, resp: AnyResponse) void {
    // Check If-None-Match for GET requests with 200 status
    if (this.status_code == 200) {
        if (this.render304NotModifiedIfNoneMatch(req, resp)) {
            return;
        }
    }

    // Try compression if configured
    if (this.tryServeCompressed(req, resp)) {
        return;
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

fn doWriteHeadersExcluding(this: *StaticRoute, resp: AnyResponse, exclude: []const []const u8) void {
    switch (resp) {
        inline .SSL, .TCP => |s| {
            const entries = this.headers.entries.slice();
            const names: []const api.StringPointer = entries.items(.name);
            const values: []const api.StringPointer = entries.items(.value);
            const buf = this.headers.buf.items;

            for (names, values) |name, value| {
                const header_name = name.slice(buf);
                // Skip excluded headers (case-insensitive)
                var skip = false;
                for (exclude) |excluded| {
                    if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(header_name, excluded)) {
                        skip = true;
                        break;
                    }
                }
                if (!skip) {
                    s.writeHeader(header_name, value.slice(buf));
                }
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

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const api = bun.schema.api;
const AnyServer = jsc.API.AnyServer;
const writeStatus = bun.api.server.writeStatus;
const AnyBlob = jsc.WebCore.Blob.Any;

const ETag = bun.http.ETag;
const Headers = bun.http.Headers;

const uws = bun.uws;
const AnyResponse = uws.AnyResponse;
