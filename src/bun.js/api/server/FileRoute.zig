const FileRoute = @This();

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,
server: ?AnyServer = null,
blob: Blob,
headers: Headers = .{ .allocator = bun.default_allocator },
status_code: u16,

pub const InitOptions = struct {
    server: ?AnyServer,
    status_code: u16 = 200,
};

pub fn initFromBlob(blob: Blob, opts: InitOptions) *FileRoute {
    var headers = Headers.from(null, bun.default_allocator, .{ .body = &.{ .Blob = blob } }) catch bun.outOfMemory();
    return bun.new(FileRoute, .{
        .ref_count = .init(),
        .server = opts.server,
        .blob = blob,
        .headers = headers,
        .status_code = opts.status_code,
    });
}

fn deinit(this: *FileRoute) void {
    this.blob.detach();
    this.headers.deinit();
    bun.destroy(this);
}

pub fn memoryCost(this: *const FileRoute) usize {
    return @sizeOf(FileRoute) + this.headers.memoryCost() + this.blob.memoryCost();
}

pub fn fromJS(globalThis: *JSC.JSGlobalObject, argument: JSC.JSValue) bun.JSError!?*FileRoute {
    if (argument.as(JSC.WebCore.Response)) |response| {
        response.body.value.toBlobIfPossible();
        if (response.body.value == .Blob and response.body.value.Blob.needsToReadFile()) {
            var blob = response.body.value.use();
            blob.globalThis = globalThis;
            blob.allocator = null;
            response.body.value = .{ .Blob = blob.dupe() };
            return bun.new(FileRoute, .{
                .ref_count = .init(),
                .server = null,
                .blob = blob,
                .headers = Headers.from(response.init.headers, bun.default_allocator, .{ .body = &.{ .Blob = blob } }) catch bun.outOfMemory(),
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
                .status_code = 200,
            });
        }
    }
    return null;
}

pub fn onHEADRequest(this: *FileRoute, req: *uws.Request, resp: AnyResponse) void {
    req.setYield(false);
    this.onHEAD(resp);
}

fn writeHeaders(this: *FileRoute, resp: AnyResponse) void {
    switch (resp) {
        inline .SSL, .TCP => |s| {
            const entries = this.headers.entries.slice();
            const names = entries.items(.name);
            const values = entries.items(.value);
            const buf = this.headers.buf.items;
            for (names, values) |name, value| {
                s.writeHeader(name.slice(buf), value.slice(buf));
            }
        },
    }
}

fn writeStatus(_: *FileRoute, status: u16, resp: AnyResponse) void {
    switch (resp) {
        .SSL => |r| writeStatus(true, r, status),
        .TCP => |r| writeStatus(false, r, status),
    }
}

pub fn onHEAD(this: *FileRoute, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    var size = this.blob.size();
    if (size == 0) this.blob.resolveSize();
    size = this.blob.size();
    this.writeStatus(this.status_code, resp);
    this.writeHeaders(resp);
    resp.writeHeaderInt("Content-Length", size);
    resp.endWithoutBody(resp.shouldCloseConnection());
    this.deref();
}

pub fn onRequest(this: *FileRoute, req: *uws.Request, resp: AnyResponse) void {
    req.setYield(false);
    this.on(resp);
}

pub fn on(this: *FileRoute, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);
    this.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    var path = this.blob.getFileName() orelse {
        this.writeStatus(404, resp);
        resp.endWithoutBody(true);
        this.deref();
        return;
    };

    var buf: bun.PathBuffer = undefined;
    const is_ssl = resp == .SSL;
    const fd_result = bun.sys.open(
        path.sliceZ(&buf),
        bun.O.RDONLY | bun.O.CLOEXEC | (if (is_ssl) bun.O.NONBLOCK else 0),
        0,
    );
    if (fd_result == .err) {
        this.writeStatus(404, resp);
        resp.endWithoutBody(true);
        this.deref();
        return;
    }

    const fd = fd_result.result;
    const stat = switch (bun.sys.fstat(fd)) {
        .result => |s| s,
        .err => |err| {
            fd.close();
            this.writeStatus(404, resp);
            resp.endWithoutBody(true);
            this.deref();
            return;
        },
    };
    if (bun.S.ISDIR(stat.mode)) {
        bun.Async.Closer.close(fd, {});
        this.writeStatus(404, resp);
        resp.endWithoutBody(true);
        this.deref();
        return;
    }

    var nonblocking = is_ssl;
    if (bun.S.ISREG(stat.mode)) {
        nonblocking = false;
    }
    const pollable = bun.sys.isPollable(stat.mode) or nonblocking;
    var file_type: FileType = if (bun.S.ISFIFO(stat.mode))
        .pipe
    else if (bun.S.ISSOCK(stat.mode))
        .socket
    else
        .file;
    if (nonblocking and file_type != .socket) {
        file_type = .nonblocking_pipe;
    }
    nonblocking = nonblocking or (pollable and file_type != .pipe);
    if (nonblocking and file_type == .pipe) {
        file_type = .nonblocking_pipe;
    }

    const size = @as(u64, @intCast(stat.size));
    this.writeStatus(this.status_code, resp);
    this.writeHeaders(resp);
    resp.writeHeaderInt("Content-Length", size);

    switch (resp) {
        .TCP => |r| {
            r.prepareForSendfile();
            const transfer = SendfileTransfer.create(fd, size, .{ .TCP = r }, this);
            transfer.start();
        },
        .SSL => |r| {
            const transfer = StreamTransfer.create(fd, r, this, pollable, nonblocking, file_type);
            transfer.start();
        },
    }
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
const linux = std.os.linux;
const Async = bun.Async;
const FileType = bun.io.FileType;

const SendfileTransfer = struct {
    fd: bun.FileDescriptor,
    remain: u64,
    resp: AnyResponse,
    route: *FileRoute,
    offset: u64 = 0,
    has_listener: bool = false,

    pub fn create(fd: bun.FileDescriptor, size: u64, resp: AnyResponse, route: *FileRoute) *SendfileTransfer {
        return bun.new(SendfileTransfer, .{ .fd = fd, .remain = size, .resp = resp, .route = route });
    }

    fn start(this: *SendfileTransfer) void {
        this.resp.onAborted(*SendfileTransfer, onAborted, this);
        this.send();
    }

    fn send(this: *SendfileTransfer) void {
        while (this.remain > 0) {
            const start = this.offset;
            var signed: i64 = @as(i64, @intCast(this.offset));
            const rc = linux.sendfile(
                this.resp.TCP.getNativeHandle().cast(),
                this.fd.cast(),
                &signed,
                this.remain,
            );
            this.offset = @as(u64, @intCast(signed));
            const errcode = bun.sys.getErrno(rc);
            this.remain -= @min(this.remain, this.offset - start);

            if (errcode == .SUCCESS and this.remain == 0) {
                this.finish();
                return;
            }

            if (errcode == .AGAIN) {
                if (!this.has_listener) {
                    this.has_listener = true;
                    this.resp.onWritable(*SendfileTransfer, onWritable, this);
                }
                this.resp.TCP.markNeedsMore();
                return;
            }

            this.finish();
            return;
        }
        this.finish();
    }

    fn onWritable(this: *SendfileTransfer, _: u64, _: AnyResponse) bool {
        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }
        this.send();
        return this.remain == 0;
    }

    fn finish(this: *SendfileTransfer) void {
        this.resp.TCP.endSendFile(this.offset, this.resp.shouldCloseConnection());
        this.fd.close();
        this.route.onResponseComplete(.{ .TCP = this.resp.TCP });
        bun.destroy(this);
    }

    fn onAborted(this: *SendfileTransfer, resp: AnyResponse) void {
        _ = resp;
        this.fd.close();
        this.route.onResponseComplete(.{ .TCP = this.resp.TCP });
        bun.destroy(this);
    }
};

const StreamTransfer = struct {
    reader: bun.io.BufferedReader = bun.io.BufferedReader.init(StreamTransfer),
    fd: bun.FileDescriptor,
    resp: *uws.NewApp(true).Response,
    route: *FileRoute,
    pollable: bool,
    nonblocking: bool,
    file_type: FileType,
    has_listener: bool = false,

    pub fn create(
        fd: bun.FileDescriptor,
        resp: *uws.NewApp(true).Response,
        route: *FileRoute,
        pollable: bool,
        nonblocking: bool,
        file_type: FileType,
    ) *StreamTransfer {
        var t = bun.new(StreamTransfer, .{
            .fd = fd,
            .resp = resp,
            .route = route,
            .pollable = pollable,
            .nonblocking = nonblocking,
            .file_type = file_type,
        });
        t.reader.flags.close_handle = false;
        t.reader.flags.pollable = pollable;
        t.reader.flags.nonblocking = nonblocking;
        if (file_type == .socket) {
            t.reader.flags.socket = true;
        }
        t.reader.setParent(t);
        return t;
    }

    fn start(this: *StreamTransfer) void {
        this.resp.onAborted(*StreamTransfer, onAborted, this);
        switch (this.reader.start(this.fd, this.pollable)) {
            .err => {
                this.finish();
                return;
            },
            .result => {},
        }
        if (this.reader.handle.getPoll()) |poll| {
            if (this.file_type == .socket or this.reader.flags.socket) {
                poll.flags.insert(.socket);
            } else {
                poll.flags.insert(.fifo);
            }
            if (this.reader.flags.nonblocking) {
                poll.flags.insert(.nonblocking);
            }
        }
        this.reader.read();
    }

    fn onReadChunk(this: *StreamTransfer, chunk: []const u8, state: bun.io.ReadState) bool {
        if (chunk.len > 0) {
            switch (this.resp.write(chunk)) {
                .backpressure => {
                    if (!this.has_listener) {
                        this.has_listener = true;
                        this.resp.onWritable(*StreamTransfer, onWritable, this);
                    }
                    this.reader.pause();
                    this.resp.markNeedsMore();
                    return false;
                },
                .want_more => {},
            }
        }

        if (state == .eof) {
            this.finish();
            return false;
        }

        return true;
    }

    fn onReaderDone(this: *StreamTransfer) void {
        this.finish();
    }

    fn onReaderError(this: *StreamTransfer, _: bun.sys.Error) void {
        this.finish();
    }

    fn eventLoop(this: *StreamTransfer) JSC.EventLoopHandle {
        return this.route.server.?.vm().eventLoop();
    }

    fn loop(this: *StreamTransfer) *Async.Loop {
        return this.eventLoop().loop();
    }

    fn onWritable(this: *StreamTransfer, _: u64, _: AnyResponse) bool {
        if (this.route.server) |server| {
            this.resp.timeout(server.config().idleTimeout);
        }
        this.has_listener = false;
        this.reader.read();
        return false;
    }

    fn finish(this: *StreamTransfer) void {
        this.resp.endWithoutBody(this.resp.shouldCloseConnection());
        this.reader.close();
        this.fd.close();
        this.route.onResponseComplete(.{ .SSL = this.resp });
        bun.destroy(this);
    }

    fn onAborted(this: *StreamTransfer, resp: AnyResponse) void {
        _ = resp;
        this.reader.close();
        this.fd.close();
        this.route.onResponseComplete(.{ .SSL = this.resp });
        bun.destroy(this);
    }
};
