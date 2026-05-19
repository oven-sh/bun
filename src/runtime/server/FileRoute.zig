const FileRoute = @This();

ref_count: RefCount,
server: ?AnyServer = null,
blob: Blob,
headers: Headers = .{ .allocator = bun.default_allocator },
status_code: u16,
stat_hash: bun.fs.StatHash = .{},
has_last_modified_header: bool,
has_content_length_header: bool,
has_content_range_header: bool,

pub const InitOptions = struct {
    server: ?AnyServer,
    status_code: u16 = 200,
    headers: ?*jsc.WebCore.FetchHeaders = null,
};

pub fn lastModifiedDate(this: *const FileRoute) bun.JSError!?u64 {
    if (this.has_last_modified_header) {
        if (this.headers.get("last-modified")) |last_modified| {
            var string = bun.String.init(last_modified);
            defer string.deref();
            const date_f64 = try bun.String.parseDate(&string, bun.jsc.VirtualMachine.get().global);
            if (!std.math.isNan(date_f64) and std.math.isFinite(date_f64)) {
                return @intFromFloat(date_f64);
            }
        }
    }

    if (this.stat_hash.last_modified_u64 > 0) {
        return this.stat_hash.last_modified_u64;
    }

    return null;
}

pub fn initFromBlob(blob: Blob, opts: InitOptions) *FileRoute {
    const headers = bun.handleOom(Headers.from(opts.headers, bun.default_allocator, .{ .body = &.{ .Blob = blob } }));
    return bun.new(FileRoute, .{
        .ref_count = .init(),
        .server = opts.server,
        .blob = blob,
        .headers = headers,
        .has_last_modified_header = headers.get("last-modified") != null,
        .has_content_length_header = headers.get("content-length") != null,
        .has_content_range_header = headers.get("content-range") != null,
        .status_code = opts.status_code,
    });
}

fn deinit(this: *FileRoute) void {
    this.blob.deinit();
    this.headers.deinit();
    bun.destroy(this);
}

pub fn memoryCost(this: *const FileRoute) usize {
    return @sizeOf(FileRoute) + this.headers.memoryCost() + this.blob.reported_estimated_size;
}

pub fn fromJS(globalThis: *jsc.JSGlobalObject, argument: jsc.JSValue) bun.JSError!?*FileRoute {
    if (argument.as(jsc.WebCore.Response)) |response| {
        const bodyValue = response.getBodyValue();
        bodyValue.toBlobIfPossible();
        if (bodyValue.* == .Blob and bodyValue.Blob.needsToReadFile()) {
            if (bodyValue.Blob.store.?.data.file.pathlike == .fd) {
                return globalThis.throwTODO("Support serving files from a file descriptor. Please pass a path instead.");
            }

            var blob = bodyValue.use();

            blob.globalThis = globalThis;
            bun.assertf(!blob.isHeapAllocated(), "expected blob not to be heap-allocated", .{});
            bodyValue.* = .{ .Blob = blob.dupe() };
            const headers = bun.handleOom(Headers.from(response.getInitHeaders(), bun.default_allocator, .{ .body = &.{ .Blob = blob } }));

            return bun.new(FileRoute, .{
                .ref_count = .init(),
                .server = null,
                .blob = blob,
                .headers = headers,
                .has_last_modified_header = headers.get("last-modified") != null,
                .has_content_length_header = headers.get("content-length") != null,
                .has_content_range_header = headers.get("content-range") != null,
                .status_code = response.statusCode(),
            });
        }
    }
    if (argument.as(Blob)) |blob| {
        if (blob.needsToReadFile()) {
            var b = blob.dupe();
            b.globalThis = globalThis;
            bun.assertf(!b.isHeapAllocated(), "expected blob not to be heap-allocated", .{});
            return bun.new(FileRoute, .{
                .ref_count = .init(),
                .server = null,
                .blob = b,
                .headers = bun.handleOom(Headers.from(null, bun.default_allocator, .{ .body = &.{ .Blob = b } })),
                .has_content_length_header = false,
                .has_last_modified_header = false,
                .has_content_range_header = false,
                .status_code = 200,
            });
        }
    }
    return null;
}

fn writeHeaders(this: *FileRoute, resp: AnyResponse) void {
    const entries = this.headers.entries.slice();
    const names = entries.items(.name);
    const values = entries.items(.value);
    const buf = this.headers.buf.items;

    switch (resp) {
        inline else => |s, tag| {
            for (names, values) |name, value| {
                s.writeHeader(name.slice(buf), value.slice(buf));
            }
            if (comptime tag != .H3) if (this.server) |srv| if (srv.h3AltSvc()) |alt|
                s.writeHeader("alt-svc", alt);
        },
    }

    if (!this.has_last_modified_header) {
        if (this.stat_hash.lastModified()) |last_modified| {
            resp.writeHeader("last-modified", last_modified);
        }
    }

    if (this.has_content_length_header) {
        resp.markWroteContentLengthHeader();
    }
}

fn writeStatusCode(_: *FileRoute, status: u16, resp: AnyResponse) void {
    switch (resp) {
        .SSL => |r| writeStatus(true, r, status),
        .TCP => |r| writeStatus(false, r, status),
        inline .H3, .H2 => |r| {
            var b: [16]u8 = undefined;
            r.writeStatus(std.fmt.bufPrint(&b, "{d}", .{status}) catch unreachable);
        },
    }
}

pub fn onHEADRequest(this: *FileRoute, req: uws.AnyRequest, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);

    this.on(req, resp, .HEAD);
}

pub fn onRequest(this: *FileRoute, req: uws.AnyRequest, resp: AnyResponse) void {
    this.on(req, resp, bun.http.Method.find(req.method()) orelse .GET);
}

pub fn on(this: *FileRoute, req: uws.AnyRequest, resp: AnyResponse, method: bun.http.Method) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    const path = this.blob.store.?.getPath() orelse {
        req.setYield(true);
        this.onResponseComplete(resp);
        return;
    };

    const open_flags = bun.O.RDONLY | bun.O.CLOEXEC | bun.O.NONBLOCK;

    const fd_result = brk: {
        if (bun.Environment.isWindows) {
            var path_buffer: bun.PathBuffer = undefined;
            @memcpy(path_buffer[0..path.len], path);
            path_buffer[path.len] = 0;
            break :brk bun.sys.open(
                path_buffer[0..path.len :0],
                open_flags,
                0,
            );
        }
        break :brk bun.sys.openA(
            path,
            open_flags,
            0,
        );
    };

    if (fd_result == .err) {
        req.setYield(true);
        this.onResponseComplete(resp);
        return;
    }

    const fd = fd_result.result;

    // `fd_owned` tracks whether this function is still responsible for
    // closing the file descriptor and releasing the route ref. Every
    // non-streaming return — bodiless status codes (304/204/205/307/308),
    // HEAD, non-streamable files, and the two JS-exception `catch return`
    // paths below — hits this defer, so neither the fd nor the route ref
    // (or the server's pending_requests counter) can leak regardless of
    // which branch runs. The streaming path clears `fd_owned` right
    // before handing ownership to `FileResponseStream`.
    var fd_owned = true;
    defer if (fd_owned) {
        bun.Async.Closer.close(fd, if (bun.Environment.isWindows) bun.windows.libuv.Loop.get());
        this.onResponseComplete(resp);
    };

    const input_if_modified_since_date: ?u64 = req.dateForHeader("if-modified-since") catch return; // TODO: properly propagate exception upwards

    const can_serve_file: bool, const size: u64, const file_type: bun.io.FileType, const pollable: bool = brk: {
        const stat = switch (bun.sys.fstat(fd)) {
            .result => |s| s,
            .err => break :brk .{ false, 0, undefined, false },
        };

        const stat_size: u64 = @intCast(@max(stat.size, 0));
        const _size: u64 = @min(stat_size, @as(u64, this.blob.size));

        if (bun.S.ISDIR(@intCast(stat.mode))) {
            break :brk .{ false, 0, undefined, false };
        }

        this.stat_hash.hash(stat, path);

        if (bun.S.ISFIFO(@intCast(stat.mode)) or bun.S.ISCHR(@intCast(stat.mode))) {
            break :brk .{ true, _size, .pipe, true };
        }

        if (bun.S.ISSOCK(@intCast(stat.mode))) {
            break :brk .{ true, _size, .socket, true };
        }

        break :brk .{ true, _size, .file, false };
    };

    if (!can_serve_file) {
        req.setYield(true);
        return;
    }

    // Range applies to the slice the route was configured with, not the
    // underlying file: a Bun.file(p).slice(a,b) route exposes only [a,b).
    // RFC 9110 §14.2: Range is only defined for GET (HEAD mirrors GET's
    // headers). Skip if the route has a non-200 status or the user already
    // set Content-Range — they're managing partial responses themselves.
    const range: RangeRequest.Result = if ((method == .GET or method == .HEAD) and file_type == .file and this.status_code == 200 and !this.has_content_range_header)
        RangeRequest.fromRequest(req, size)
    else
        .none;

    const status_code: u16 = brk: {
        // RFC 9110 §13.2.2: conditional preconditions are evaluated before
        // Range. If-Modified-Since on an unmodified resource yields 304 even
        // when a Range header is present (without If-Range).
        // Unlike If-Unmodified-Since, If-Modified-Since can only be used with a
        // GET or HEAD. When used in combination with If-None-Match, it is
        // ignored, unless the server doesn't support If-None-Match.
        if (input_if_modified_since_date) |requested_if_modified_since| {
            if (method == .HEAD or method == .GET) {
                if (this.lastModifiedDate() catch return) |actual_last_modified_at| { // TODO: properly propagate exception upwards
                    // Compare at second precision: the Last-Modified header we
                    // emit is second-granular (HTTP-date), so a sub-second
                    // mtime would otherwise never satisfy `<=` against the
                    // client's echoed value.
                    if (actual_last_modified_at / 1000 <= requested_if_modified_since / 1000) {
                        break :brk 304;
                    }
                }
            }
        }

        if (range == .unsatisfiable) break :brk 416;
        if (range == .satisfiable) break :brk 206;

        if (size == 0 and file_type == .file and this.status_code == 200) {
            break :brk 204;
        }

        break :brk this.status_code;
    };

    req.setYield(false);

    this.writeStatusCode(status_code, resp);
    resp.writeMark();
    this.writeHeaders(resp);

    // Bodiless statuses end here — before the range switch, so a 304 (which
    // can win over a satisfiable Range per RFC 9110 §13.2.2) doesn't emit
    // Content-Range.
    switch (status_code) {
        204, 205, 304, 307, 308 => {
            resp.endWithoutBody(resp.shouldCloseConnection());
            return;
        },
        else => {},
    }

    const body_offset: u64, const body_len: ?u64 = switch (range) {
        .satisfiable => |r| brk: {
            var crbuf: [96]u8 = undefined;
            resp.writeHeader("content-range", std.fmt.bufPrint(&crbuf, "bytes {d}-{d}/{d}", .{ r.start, r.end, size }) catch unreachable);
            resp.writeHeader("accept-ranges", "bytes");
            break :brk .{ this.blob.offset + r.start, r.end - r.start + 1 };
        },
        .unsatisfiable => {
            var crbuf: [64]u8 = undefined;
            resp.writeHeader("content-range", std.fmt.bufPrint(&crbuf, "bytes */{d}", .{size}) catch unreachable);
            resp.writeHeader("accept-ranges", "bytes");
            resp.end("", resp.shouldCloseConnection());
            return;
        },
        .none => .{
            if (file_type == .file) this.blob.offset else 0,
            if (file_type == .file and this.blob.size > 0) @as(u64, @intCast(size)) else null,
        },
    };

    if (file_type == .file and !resp.state().hasWrittenContentLengthHeader()) {
        resp.writeHeaderInt("content-length", body_len orelse size);
        resp.markWroteContentLengthHeader();
    }

    if (method == .HEAD) {
        resp.endWithoutBody(resp.shouldCloseConnection());
        return;
    }

    // Hand ownership of the fd to FileResponseStream; disable the defer close.
    // The route ref taken at the top of on() is released in onStreamComplete.
    fd_owned = false;
    FileResponseStream.start(.{
        .fd = fd,
        .auto_close = true,
        .resp = resp,
        .vm = this.server.?.vm(),
        .file_type = file_type,
        .pollable = pollable,
        .offset = body_offset,
        .length = body_len,
        .idle_timeout = this.server.?.config().idleTimeout,
        .ctx = this,
        .on_complete = onStreamComplete,
        .on_error = onStreamError,
    });
}

fn onStreamComplete(ctx: *anyopaque, resp: AnyResponse) void {
    const this: *FileRoute = @ptrCast(@alignCast(ctx));
    this.onResponseComplete(resp);
}

fn onStreamError(ctx: *anyopaque, resp: AnyResponse, _: bun.sys.Error) void {
    const this: *FileRoute = @ptrCast(@alignCast(ctx));
    this.onResponseComplete(resp);
}

fn onResponseComplete(this: *FileRoute, resp: AnyResponse) void {
    resp.clearAborted();
    resp.clearOnWritable();
    resp.clearTimeout();
    if (this.server) |server| {
        server.onStaticRequestComplete();
    }
    this.deref();
}

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const Headers = bun.http.Headers;
const AnyServer = jsc.API.AnyServer;
const Blob = jsc.WebCore.Blob;

const FileResponseStream = bun.api.server.FileResponseStream;
const RangeRequest = bun.api.server.RangeRequest;
const writeStatus = bun.api.server.writeStatus;

const uws = bun.uws;
const AnyResponse = uws.AnyResponse;
