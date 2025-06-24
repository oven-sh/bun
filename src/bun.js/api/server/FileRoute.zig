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
    headers: ?*JSC.WebCore.FetchHeaders = null,
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
    const headers = Headers.from(opts.headers, bun.default_allocator, .{ .body = &.{ .Blob = blob } }) catch bun.outOfMemory();
    return bun.new(FileRoute, .{
        .ref_count = .init(),
        .server = opts.server,
        .blob = blob,
        .headers = headers,
        .has_last_modified_header = headers.get("last-modified") != null,
        .has_content_length_header = headers.get("content-length") != null,
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
        this.deref();
        return;
    }

    const fd = fd_result.result;

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
    const StreamTransferRefCount = bun.ptr.RefCount(@This(), "ref_count", StreamTransfer.deinit, .{});
    pub const ref = StreamTransferRefCount.ref;
    pub const deref = StreamTransferRefCount.deref;

    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(StreamTransfer),
    ref_count: StreamTransferRefCount,
    fd: bun.FileDescriptor,
    resp: AnyResponse,
    route: *FileRoute,

    max_size: ?u64 = null,

    eof_task: ?JSC.AnyTask = null,

    state: packed struct(u8) {
        has_ended_response: bool = false,
        _: u7 = 0,
    } = .{},
    const log = Output.scoped(.StreamTransfer, false);

    pub fn create(
        fd: bun.FileDescriptor,
        resp: AnyResponse,
        route: *FileRoute,
        pollable: bool,
        nonblocking: bool,
        file_type: FileType,
    ) *StreamTransfer {
        var t = bun.new(StreamTransfer, .{
            .ref_count = .init(),
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

        this.ref();
        defer this.deref();

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
        // the socket maybe open for some time before so we reset the timeout here
        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }
        // we connection aborts/closes so we need to be notified
        this.resp.onAborted(*StreamTransfer, onAborted, this);

        // we are reading so increase the ref count until onReaderDone/onReaderError
        this.ref();
        this.reader.read();
    }

    pub fn onReadChunk(this: *StreamTransfer, chunk_: []const u8, state_: bun.io.ReadState) bool {
        log("onReadChunk", .{});

        this.ref();
        defer this.deref();

        if (this.state.has_ended_response) {
            return false;
        }

        const chunk, const state = brk: {
            if (this.max_size) |*max_size| {
                const chunk = chunk_[0..@min(chunk_.len, max_size.*)];
                max_size.* -|= chunk.len;
                if (state_ != .eof and max_size.* == 0) {
                    // artificially end the stream aka max_size reached
                    log("max_size reached, ending stream", .{});
                    if (this.route.server) |server| {
                        // dont need to ref because we are already holding a ref and will be derefed in onReaderDone
                        this.reader.pause();
                        // we cannot free inside onReadChunk this would be UAF so we schedule it to be done in the next event loop tick
                        this.eof_task = JSC.AnyTask.New(StreamTransfer, StreamTransfer.onReaderDone).init(this);
                        server.vm().enqueueTask(JSC.Task.init(&this.eof_task.?));
                    }
                    break :brk .{ chunk, .eof };
                }

                break :brk .{ chunk, state_ };
            }

            break :brk .{ chunk_, state_ };
        };

        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }

        if (state == .eof) {
            this.state.has_ended_response = true;
            const resp = this.resp;
            const route = this.route;
            route.onResponseComplete(resp);
            resp.end(chunk, resp.shouldCloseConnection());
            log("end: {}", .{chunk.len});
            return false;
        }

        switch (this.resp.write(chunk)) {
            .backpressure => {
                // pause the reader so deref until onWritable
                defer this.deref();
                this.resp.onWritable(*StreamTransfer, onWritable, this);
                this.reader.pause();
                return false;
            },
            .want_more => {
                return true;
            },
        }
    }

    pub fn onReaderDone(this: *StreamTransfer) void {
        log("onReaderDone", .{});
        // deref the ref because reader is done
        defer this.deref();

        this.finish();
    }

    pub fn onReaderError(this: *StreamTransfer, err: bun.sys.Error) void {
        log("onReaderError {any}", .{err});
        defer this.deref(); // deref the ref because reader is done

        if (!this.state.has_ended_response) {
            // we need to signal to the client that something went wrong, so close the connection
            // sending the end chunk would be a lie and could cause issues
            this.state.has_ended_response = true;
            const resp = this.resp;
            const route = this.route;
            route.onResponseComplete(resp);
            this.resp.forceClose();
        }
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

        this.ref();
        defer this.deref();

        if (this.reader.isDone()) {
            @branchHint(.unlikely);
            log("finish inside onWritable", .{});
            this.finish();
            return true;
        }

        // reset the socket timeout before reading more data
        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }

        // we are reading so increase the ref count until onReaderDone/onReaderError
        this.ref();
        this.reader.read();
        return true;
    }

    fn finish(this: *StreamTransfer) void {
        log("finish", .{});
        // lets make sure that we detach the response
        this.resp.clearOnWritable();
        this.resp.clearAborted();
        this.resp.clearTimeout();

        if (!this.state.has_ended_response) {
            this.state.has_ended_response = true;
            const resp = this.resp;
            const route = this.route;
            route.onResponseComplete(resp);
            log("endWithoutBody", .{});
            resp.endWithoutBody(resp.shouldCloseConnection());
        }
        // deref this indicates the main thing is done, the reader may be holding a ref and will be derefed in onReaderDone/onReaderError
        this.deref();
    }

    fn onAborted(this: *StreamTransfer, _: AnyResponse) void {
        log("onAborted", .{});
        this.state.has_ended_response = true;
        this.finish();
    }

    pub fn deinit(this: *StreamTransfer) void {
        log("deinit", .{});
        // deinit will close the reader if it is not already closed (this will not trigger onReaderDone/onReaderError)
        this.reader.deinit();
        bun.destroy(this);
    }
};

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;
