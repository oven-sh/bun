const FileRoute = @This();

ref_count: RefCount,
server: ?AnyServer = null,
blob: Blob,
headers: Headers = .{ .allocator = bun.default_allocator },
status_code: u16,
stat_hash: bun.fs.StatHash = .{},
has_last_modified_header: bool,
has_content_length_header: bool,

pub const InitOptions = struct {
    server: ?AnyServer,
    status_code: u16 = 200,
};

pub fn lastModifiedDate(this: *const FileRoute) ?u64 {
    if (this.has_last_modified_header) {
        if (this.headers.get("last-modified")) |last_modified| {
            var string = bun.String.init(last_modified);
            defer string.deref();
            const date_f64 = bun.String.parseDate(&string, bun.JSC.VirtualMachine.get().global);
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
    const headers = Headers.from(null, bun.default_allocator, .{ .body = &.{ .Blob = blob } }) catch bun.outOfMemory();
    return bun.new(FileRoute, .{
        .ref_count = .init(),
        .server = opts.server,
        .blob = blob,
        .headers = headers,
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

pub fn fromJS(globalThis: *JSC.JSGlobalObject, argument: JSC.JSValue) bun.JSError!?*FileRoute {
    if (argument.as(JSC.WebCore.Response)) |response| {
        response.body.value.toBlobIfPossible();
        if (response.body.value == .Blob and response.body.value.Blob.needsToReadFile()) {
            if (response.body.value.Blob.store.?.data.file.pathlike == .fd) {
                return globalThis.throwTODO("Support serving files from a file descriptor. Please pass a path instead.");
            }

            var blob = response.body.value.use();

            blob.globalThis = globalThis;
            blob.allocator = null;
            response.body.value = .{ .Blob = blob.dupe() };
            const headers = Headers.from(response.init.headers, bun.default_allocator, .{ .body = &.{ .Blob = blob } }) catch bun.outOfMemory();

            return bun.new(FileRoute, .{
                .ref_count = .init(),
                .server = null,
                .blob = blob,
                .headers = headers,
                .has_last_modified_header = headers.get("last-modified") != null,
                .has_content_length_header = headers.get("content-length") != null,
                .status_code = response.statusCode(),
            });
        }
    }
    if (argument.as(Blob)) |blob| {
        if (blob.needsToReadFile()) {
            var b = blob.dupe();
            b.globalThis = globalThis;
            b.allocator = null;
            return bun.new(FileRoute, .{
                .ref_count = .init(),
                .server = null,
                .blob = b,
                .headers = Headers.from(null, bun.default_allocator, .{ .body = &.{ .Blob = b } }) catch bun.outOfMemory(),
                .has_content_length_header = false,
                .has_last_modified_header = false,
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
        inline .SSL, .TCP => |s| {
            for (names, values) |name, value| {
                s.writeHeader(name.slice(buf), value.slice(buf));
            }
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
    }
}

pub fn onHEADRequest(this: *FileRoute, req: *uws.Request, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);

    this.on(req, resp, .HEAD);
}

pub fn onRequest(this: *FileRoute, req: *uws.Request, resp: AnyResponse) void {
    this.on(req, resp, bun.http.Method.find(req.method()) orelse .GET);
}

pub fn on(this: *FileRoute, req: *uws.Request, resp: AnyResponse, method: bun.http.Method) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    const path = this.blob.store.?.getPath() orelse {
        req.setYield(true);
        this.deref();
        return;
    };

    const open_flags = bun.O.RDONLY | bun.O.CLOEXEC | bun.O.NONBLOCK;
    const fd_result = bun.sys.openA(
        path,
        open_flags,
        0,
    );
    if (fd_result == .err) {
        req.setYield(true);
        this.deref();
        return;
    }

    const fd = fd_result.result.makeLibUVOwned() catch {
        req.setYield(true);
        this.deref();
        return;
    };

    const input_if_modified_since_date: ?u64 = req.dateForHeader("if-modified-since");

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
        bun.Async.Closer.close(fd, if (bun.Environment.isWindows) bun.windows.libuv.Loop.get());
        req.setYield(true);
        this.deref();
        return;
    }

    const status_code: u16 = brk: {
        // Unlike If-Unmodified-Since, If-Modified-Since can only be used with a
        // GET or HEAD. When used in combination with If-None-Match, it is
        // ignored, unless the server doesn't support If-None-Match.
        if (input_if_modified_since_date) |requested_if_modified_since| {
            if (method == .HEAD or method == .GET) {
                if (this.lastModifiedDate()) |actual_last_modified_at| {
                    if (actual_last_modified_at <= requested_if_modified_since) {
                        break :brk 304;
                    }
                }
            }
        }

        if (size == 0 and file_type == .file and this.status_code == 200) {
            break :brk 204;
        }

        break :brk this.status_code;
    };

    req.setYield(false);

    this.writeStatusCode(status_code, resp);
    resp.writeMark();
    this.writeHeaders(resp);

    switch (status_code) {
        204, 205, 304, 307, 308 => {
            resp.endWithoutBody(resp.shouldCloseConnection());
            this.deref();
            return;
        },
        else => {},
    }

    if (file_type == .file and !resp.state().hasWrittenContentLengthHeader()) {
        resp.writeHeaderInt("content-length", size);
        resp.markWroteContentLengthHeader();
    }

    if (method == .HEAD) {
        resp.endWithoutBody(resp.shouldCloseConnection());
        this.deref();
        return;
    }

    const transfer = StreamTransfer.create(fd, resp, this, pollable, file_type != .file, file_type);
    transfer.start(
        if (file_type == .file) this.blob.offset else 0,
        if (file_type == .file and this.blob.size > 0) @intCast(size) else null,
    );
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

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const uws = bun.uws;
const Headers = bun.http.Headers;
const AnyServer = JSC.API.AnyServer;
const Blob = JSC.WebCore.Blob;
const writeStatus = @import("../server.zig").writeStatus;
const AnyResponse = uws.AnyResponse;
const Async = bun.Async;
const FileType = bun.io.FileType;
const Output = bun.Output;

const StreamTransfer = struct {
    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(StreamTransfer),
    fd: bun.FileDescriptor,
    resp: AnyResponse,
    route: *FileRoute,

    defer_deinit: ?*bool = null,
    max_size: ?u64 = null,

    state: packed struct(u8) {
        waiting_for_readable: bool = false,
        waiting_for_writable: bool = false,
        has_ended_response: bool = false,
        has_reader_closed: bool = false,
        _: u4 = 0,
    } = .{},
    const log = Output.scoped(.StreamTransfer, true);

    pub fn create(
        fd: bun.FileDescriptor,
        resp: AnyResponse,
        route: *FileRoute,
        pollable: bool,
        nonblocking: bool,
        file_type: FileType,
    ) *StreamTransfer {
        var t = bun.new(StreamTransfer, .{
            .fd = fd,
            .resp = resp,
            .route = route,
        });
        t.reader.flags.close_handle = true;
        t.reader.flags.pollable = pollable;
        t.reader.flags.nonblocking = nonblocking;
        if (comptime bun.Environment.isPosix) {
            if (file_type == .socket) {
                t.reader.flags.socket = true;
            }
        }
        t.reader.setParent(t);
        return t;
    }

    fn start(this: *StreamTransfer, start_offset: usize, size: ?usize) void {
        log("start", .{});

        var scope: DeinitScope = undefined;
        scope.enter(this);
        defer scope.exit();

        this.state.waiting_for_readable = true;
        this.state.waiting_for_writable = true;
        this.max_size = size;

        switch (if (start_offset > 0)
            this.reader.startFileOffset(this.fd, this.reader.flags.pollable, start_offset)
        else
            this.reader.start(this.fd, this.reader.flags.pollable)) {
            .err => {
                this.finish();
                return;
            },
            .result => {},
        }

        this.reader.updateRef(true);

        if (bun.Environment.isPosix) {
            if (this.reader.handle.getPoll()) |poll| {
                if (this.reader.flags.nonblocking) {
                    poll.flags.insert(.nonblocking);
                }

                switch (this.reader.getFileType()) {
                    .socket => poll.flags.insert(.socket),
                    .nonblocking_pipe, .pipe => poll.flags.insert(.fifo),
                    .file => {},
                }
            }
        }

        this.reader.read();

        if (!scope.deinit_called) {
            // This clones some data so we could avoid that if we're already done.
            this.resp.onAborted(*StreamTransfer, onAborted, this);
        }
    }

    pub fn onReadChunk(this: *StreamTransfer, chunk_: []const u8, state_: bun.io.ReadState) bool {
        log("onReadChunk", .{});

        var scope: DeinitScope = undefined;
        scope.enter(this);
        defer scope.exit();

        if (this.state.has_ended_response) {
            this.state.waiting_for_readable = false;
            this.finish();
            return false;
        }

        const chunk, const state = brk: {
            if (this.max_size) |*max_size| {
                if (chunk_.len >= max_size.*) {
                    const limited_chunk = chunk_[0..max_size.*];
                    max_size.* = 0;
                    break :brk .{ limited_chunk, .eof };
                } else {
                    max_size.* -= chunk_.len;
                    break :brk .{ chunk_, state_ };
                }
                if (state_ != .eof and max_size.* == 0) {
                    break :brk .{ chunk, .eof };
                }

                break :brk .{ chunk, state_ };
            }

            break :brk .{ chunk_, state_ };
        };

        if (state == .eof and !this.state.waiting_for_writable) {
            this.state.waiting_for_readable = false;
            this.state.has_ended_response = true;
            const resp = this.resp;
            const route = this.route;
            route.onResponseComplete(resp);
            resp.end(chunk, resp.shouldCloseConnection());
            this.finish();
            return false;
        }

        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }

        switch (this.resp.write(chunk)) {
            .backpressure => {
                this.resp.onWritable(*StreamTransfer, onWritable, this);
                this.reader.pause();
                this.resp.markNeedsMore();
                this.state.waiting_for_writable = true;
                this.state.waiting_for_readable = false;
                return false;
            },
            .want_more => {
                this.state.waiting_for_readable = true;
                this.state.waiting_for_writable = false;

                if (state_ == .eof) {
                    this.state.waiting_for_readable = false;
                    this.finish();
                    return false;
                }

                if (bun.Environment.isWindows)
                    this.reader.unpause();

                return true;
            },
        }
    }

    pub fn onReaderDone(this: *StreamTransfer) void {
        log("onReaderDone", .{});
        this.state.waiting_for_readable = false;
        this.state.has_reader_closed = true;

        var scope: DeinitScope = undefined;
        scope.enter(this);
        defer scope.exit();

        this.finish();
    }

    pub fn onReaderError(this: *StreamTransfer, _: bun.sys.Error) void {
        log("onReaderError", .{});
        this.state.waiting_for_readable = false;

        var scope: DeinitScope = undefined;
        scope.enter(this);
        defer scope.exit();

        this.finish();
    }

    pub fn eventLoop(this: *StreamTransfer) JSC.EventLoopHandle {
        return JSC.EventLoopHandle.init(this.route.server.?.vm().eventLoop());
    }

    pub fn loop(this: *StreamTransfer) *Async.Loop {
        return this.eventLoop().loop();
    }

    fn onWritable(this: *StreamTransfer, _: u64, _: AnyResponse) bool {
        log("onWritable", .{});

        var scope: DeinitScope = undefined;
        scope.enter(this);
        defer scope.exit();

        if (this.reader.isDone()) {
            @branchHint(.unlikely);
            this.finish();
            return true;
        }

        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }

        this.state.waiting_for_writable = false;
        this.state.waiting_for_readable = true;
        this.reader.read();
        return true;
    }

    fn finish(this: *StreamTransfer) void {
        log("finish", .{});
        if (!this.state.has_ended_response) {
            this.state.has_ended_response = true;
            this.state.waiting_for_writable = false;
            const resp = this.resp;
            const route = this.route;
            route.onResponseComplete(resp);
            resp.endWithoutBody(resp.shouldCloseConnection());
        }

        if (!this.state.has_reader_closed) {
            this.reader.close();
            return;
        }

        this.deinit();
    }

    fn onAborted(this: *StreamTransfer, resp: AnyResponse) void {
        log("onAborted", .{});
        var scope: DeinitScope = undefined;
        scope.enter(this);
        defer scope.exit();

        this.state.has_ended_response = true;
        this.route.onResponseComplete(resp);
        this.finish();
    }

    fn deinit(this: *StreamTransfer) void {
        if (this.defer_deinit) |defer_deinit| {
            defer_deinit.* = true;
            log("deinit deferred", .{});
            return;
        }

        log("deinit", .{});
        this.reader.deinit();
        bun.destroy(this);
    }
};

const DeinitScope = struct {
    stream: *StreamTransfer,
    prev_defer_deinit: ?*bool,
    deinit_called: bool = false,

    /// This has to be an instance method to avoid a use-after-stack.
    pub fn enter(this: *DeinitScope, stream: *StreamTransfer) void {
        this.stream = stream;
        this.deinit_called = false;
        this.prev_defer_deinit = this.stream.defer_deinit;
        if (this.prev_defer_deinit == null) {
            this.stream.defer_deinit = &this.deinit_called;
        }
    }

    pub fn exit(this: *DeinitScope) void {
        if (this.prev_defer_deinit == null and &this.deinit_called == this.stream.defer_deinit) {
            this.stream.defer_deinit = this.prev_defer_deinit;

            if (this.deinit_called) {
                this.stream.deinit();
            }
        }
    }
};

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;
