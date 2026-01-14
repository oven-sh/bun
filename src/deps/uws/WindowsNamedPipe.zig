/// Wrapper that provides a socket-like API for Windows Named Pipes.
///
/// This allows us to use the same networking interface and event handling
/// patterns across platforms, treating Named Pipes as if they were regular
/// sockets. The wrapper translates between µWebSockets' socket-based API
/// and Windows Named Pipe operations, enabling seamless cross-platform
/// IPC without requiring separate code paths for Windows vs Unix domain sockets.
///
/// Integration with µWebSockets/uSockets:
/// - Uses the same event loop and timer mechanisms as other socket types
/// - Implements compatible handlers (onOpen, onData, onClose, etc.) that match uSockets callbacks
/// - Supports SSL/TLS wrapping through the same BoringSSL integration used by TCP sockets
/// - Provides streaming writer interface that mirrors uSockets' write operations
/// - Maintains the same connection lifecycle and state management as network sockets
/// - Enables transparent use of Named Pipes in contexts expecting standard socket APIs
///
/// Uses libuv for the underlying Named Pipe operations while maintaining compatibility
/// with µWebSockets, bridging the gap between libuv's pipe handling and uSockets'
/// unified socket interface.
const WindowsNamedPipe = @This();

wrapper: ?WrapperType,
pipe: if (Environment.isWindows) ?*uv.Pipe else void, // any duplex
vm: *bun.jsc.VirtualMachine, //TODO: create a timeout version that dont need the jsc VM

writer: bun.io.StreamingWriter(WindowsNamedPipe, .{
    .onClose = onClose,
    .onWritable = onWritable,
    .onError = onError,
    .onWrite = onWrite,
}) = .{},

incoming: bun.ByteList = .{}, // Maybe we should use IPCBuffer here as well
ssl_error: CertError = .{},
handlers: Handlers,
connect_req: uv.uv_connect_t = std.mem.zeroes(uv.uv_connect_t),

event_loop_timer: EventLoopTimer = .{
    .next = .epoch,
    .tag = .WindowsNamedPipe,
},
current_timeout: u32 = 0,
flags: Flags = .{},

pub const Flags = packed struct(u8) {
    disconnected: bool = true,
    is_closed: bool = false,
    is_client: bool = false,
    is_ssl: bool = false,
    _: u4 = 0,
};
pub const Handlers = struct {
    ctx: *anyopaque,
    onOpen: *const fn (*anyopaque) void,
    onHandshake: *const fn (*anyopaque, bool, uws.us_bun_verify_error_t) void,
    onData: *const fn (*anyopaque, []const u8) void,
    onClose: *const fn (*anyopaque) void,
    onEnd: *const fn (*anyopaque) void,
    onWritable: *const fn (*anyopaque) void,
    onError: *const fn (*anyopaque, bun.sys.Error) void,
    onTimeout: *const fn (*anyopaque) void,
};

fn onWritable(
    this: *WindowsNamedPipe,
) void {
    log("onWritable", .{});
    // flush pending data
    this.flush();
    // call onWritable (will flush on demand)
    this.handlers.onWritable(this.handlers.ctx);
}

fn onPipeClose(this: *WindowsNamedPipe) void {
    log("onPipeClose", .{});
    this.flags.disconnected = true;
    this.pipe = null;
    this.onClose();
}

fn onReadAlloc(this: *WindowsNamedPipe, suggested_size: usize) []u8 {
    var available = this.incoming.unusedCapacitySlice();
    if (available.len < suggested_size) {
        bun.handleOom(this.incoming.ensureUnusedCapacity(bun.default_allocator, suggested_size));
        available = this.incoming.unusedCapacitySlice();
    }
    return available.ptr[0..suggested_size];
}

fn onRead(this: *WindowsNamedPipe, buffer: []const u8) void {
    log("onRead ({})", .{buffer.len});
    this.incoming.len += @as(u32, @truncate(buffer.len));
    bun.assert(this.incoming.len <= this.incoming.cap);
    bun.assert(bun.isSliceInBuffer(buffer, this.incoming.allocatedSlice()));

    const data = this.incoming.slice();

    this.resetTimeout();

    if (this.wrapper) |*wrapper| {
        wrapper.receiveData(data);
    } else {
        this.handlers.onData(this.handlers.ctx, data);
    }
    this.incoming.len = 0;
}

fn onWrite(this: *WindowsNamedPipe, amount: usize, status: bun.io.WriteStatus) void {
    log("onWrite {d} {}", .{ amount, status });

    switch (status) {
        .pending => {},
        .drained => {
            // unref after sending all data
            if (this.writer.source) |source| {
                source.pipe.unref();
            }
        },
        .end_of_file => {
            // we send FIN so we close after this
            this.writer.close();
        },
    }
}

fn onReadError(this: *WindowsNamedPipe, err: bun.sys.E) void {
    log("onReadError", .{});
    if (err == .EOF) {
        // we received FIN but we dont allow half-closed connections right now
        this.handlers.onEnd(this.handlers.ctx);
    } else {
        this.onError(bun.sys.Error.fromCode(err, .read));
    }
    this.writer.close();
}

fn onError(this: *WindowsNamedPipe, err: bun.sys.Error) void {
    log("onError", .{});
    this.handlers.onError(this.handlers.ctx, err);
    this.close();
}

fn onOpen(this: *WindowsNamedPipe) void {
    log("onOpen", .{});
    this.handlers.onOpen(this.handlers.ctx);
}

fn onData(this: *WindowsNamedPipe, decoded_data: []const u8) void {
    log("onData ({})", .{decoded_data.len});
    this.handlers.onData(this.handlers.ctx, decoded_data);
}

fn onHandshake(this: *WindowsNamedPipe, handshake_success: bool, ssl_error: uws.us_bun_verify_error_t) void {
    log("onHandshake", .{});

    this.ssl_error = .{
        .error_no = ssl_error.error_no,
        .code = if (ssl_error.code == null or ssl_error.error_no == 0) "" else bun.handleOom(bun.default_allocator.dupeZ(u8, ssl_error.code[0..bun.len(ssl_error.code) :0])),
        .reason = if (ssl_error.reason == null or ssl_error.error_no == 0) "" else bun.handleOom(bun.default_allocator.dupeZ(u8, ssl_error.reason[0..bun.len(ssl_error.reason) :0])),
    };
    this.handlers.onHandshake(this.handlers.ctx, handshake_success, ssl_error);
}

fn onClose(this: *WindowsNamedPipe) void {
    log("onClose", .{});
    if (!this.flags.is_closed) {
        this.flags.is_closed = true; // only call onClose once
        this.handlers.onClose(this.handlers.ctx);
        this.deinit();
    }
}

fn callWriteOrEnd(this: *WindowsNamedPipe, data: ?[]const u8, msg_more: bool) void {
    if (data) |bytes| {
        if (bytes.len > 0) {
            // ref because we have pending data
            if (this.writer.source) |source| {
                source.pipe.ref();
            }
            if (this.flags.disconnected) {
                // enqueue to be sent after connecting
                bun.handleOom(this.writer.outgoing.write(bytes));
            } else {
                // write will enqueue the data if it cannot be sent
                _ = this.writer.write(bytes);
            }
        }
    }

    if (!msg_more) {
        if (this.wrapper) |*wrapper| {
            _ = wrapper.shutdown(false);
        }
        this.writer.end();
    }
}

fn internalWrite(this: *WindowsNamedPipe, encoded_data: []const u8) void {
    this.resetTimeout();

    // Possible scenarios:
    // Scenario 1: will not write if is not connected yet but will enqueue the data
    // Scenario 2: will not write if a exception is thrown (will be handled by onError)
    // Scenario 3: will be queued in memory and will be flushed later
    // Scenario 4: no write/end function exists (will be handled by onError)
    this.callWriteOrEnd(encoded_data, true);
}

pub fn resumeStream(this: *WindowsNamedPipe) bool {
    const stream = this.writer.getStream() orelse {
        return false;
    };
    const readStartResult = stream.readStart(this, onReadAlloc, onReadError, onRead);
    if (readStartResult == .err) {
        return false;
    }
    return true;
}

pub fn pauseStream(this: *WindowsNamedPipe) bool {
    const pipe = this.pipe orelse {
        return false;
    };
    pipe.readStop();
    return true;
}

pub fn flush(this: *WindowsNamedPipe) void {
    if (this.wrapper) |*wrapper| {
        _ = wrapper.flush();
    }
    if (!this.flags.disconnected) {
        _ = this.writer.flush();
    }
}

fn onInternalReceiveData(this: *WindowsNamedPipe, data: []const u8) void {
    if (this.wrapper) |*wrapper| {
        this.resetTimeout();
        wrapper.receiveData(data);
    }
}

pub fn onTimeout(this: *WindowsNamedPipe) void {
    log("onTimeout", .{});

    const has_been_cleared = this.event_loop_timer.state == .CANCELLED or this.vm.scriptExecutionStatus() != .running;

    this.event_loop_timer.state = .FIRED;
    this.event_loop_timer.heap = .{};

    if (has_been_cleared) {
        return;
    }

    this.handlers.onTimeout(this.handlers.ctx);
}

pub fn from(
    pipe: *uv.Pipe,
    handlers: WindowsNamedPipe.Handlers,
    vm: *jsc.VirtualMachine,
) WindowsNamedPipe {
    if (Environment.isPosix) {
        @compileError("WindowsNamedPipe is not supported on POSIX systems");
    }
    return WindowsNamedPipe{
        .vm = vm,
        .pipe = pipe,
        .wrapper = null,
        .handlers = handlers,
    };
}
fn onConnect(this: *WindowsNamedPipe, status: uv.ReturnCode) void {
    if (this.pipe) |pipe| {
        _ = pipe.unref();
    }

    if (status.toError(.connect)) |err| {
        this.onError(err);
        return;
    }

    this.flags.disconnected = false;
    if (this.start(true)) {
        if (this.isTLS()) {
            if (this.wrapper) |*wrapper| {
                // trigger onOpen and start the handshake
                wrapper.start();
            }
        } else {
            // trigger onOpen
            this.onOpen();
        }
    }
    this.flush();
}

pub fn getAcceptedBy(this: *WindowsNamedPipe, server: *uv.Pipe, ssl_ctx: ?*BoringSSL.SSL_CTX) bun.sys.Maybe(void) {
    bun.assert(this.pipe != null);
    this.flags.disconnected = true;

    if (ssl_ctx) |tls| {
        this.flags.is_ssl = true;
        this.wrapper = WrapperType.initWithCTX(tls, false, .{
            .ctx = this,
            .onOpen = WindowsNamedPipe.onOpen,
            .onHandshake = WindowsNamedPipe.onHandshake,
            .onData = WindowsNamedPipe.onData,
            .onClose = WindowsNamedPipe.onClose,
            .write = WindowsNamedPipe.internalWrite,
        }) catch {
            return .{
                .err = .{
                    .errno = @intFromEnum(bun.sys.E.PIPE),
                    .syscall = .connect,
                },
            };
        };
        // ref because we are accepting will unref when wrapper deinit
        _ = BoringSSL.SSL_CTX_up_ref(tls);
    }
    const initResult = this.pipe.?.init(this.vm.uvLoop(), false);
    if (initResult == .err) {
        return initResult;
    }

    const openResult = server.accept(this.pipe.?);
    if (openResult == .err) {
        return openResult;
    }

    this.flags.disconnected = false;
    if (this.start(false)) {
        if (this.isTLS()) {
            if (this.wrapper) |*wrapper| {
                // trigger onOpen and start the handshake
                wrapper.start();
            }
        } else {
            // trigger onOpen
            this.onOpen();
        }
    }
    return .success;
}
pub fn open(this: *WindowsNamedPipe, fd: bun.FileDescriptor, ssl_options: ?jsc.API.ServerConfig.SSLConfig) bun.sys.Maybe(void) {
    bun.assert(this.pipe != null);
    this.flags.disconnected = true;

    if (ssl_options) |tls| {
        this.flags.is_ssl = true;
        this.wrapper = WrapperType.init(tls, true, .{
            .ctx = this,
            .onOpen = WindowsNamedPipe.onOpen,
            .onHandshake = WindowsNamedPipe.onHandshake,
            .onData = WindowsNamedPipe.onData,
            .onClose = WindowsNamedPipe.onClose,
            .write = WindowsNamedPipe.internalWrite,
        }) catch {
            return .{
                .err = .{
                    .errno = @intFromEnum(bun.sys.E.PIPE),
                    .syscall = .connect,
                },
            };
        };
    }
    const initResult = this.pipe.?.init(this.vm.uvLoop(), false);
    if (initResult == .err) {
        return initResult;
    }

    const openResult = this.pipe.?.open(fd);
    if (openResult == .err) {
        return openResult;
    }

    onConnect(this, uv.ReturnCode.zero);
    return .success;
}

pub fn connect(this: *WindowsNamedPipe, path: []const u8, ssl_options: ?jsc.API.ServerConfig.SSLConfig) bun.sys.Maybe(void) {
    bun.assert(this.pipe != null);
    this.flags.disconnected = true;
    // ref because we are connecting
    _ = this.pipe.?.ref();

    if (ssl_options) |tls| {
        this.flags.is_ssl = true;
        this.wrapper = WrapperType.init(tls, true, .{
            .ctx = this,
            .onOpen = WindowsNamedPipe.onOpen,
            .onHandshake = WindowsNamedPipe.onHandshake,
            .onData = WindowsNamedPipe.onData,
            .onClose = WindowsNamedPipe.onClose,
            .write = WindowsNamedPipe.internalWrite,
        }) catch {
            return .{
                .err = .{
                    .errno = @intFromEnum(bun.sys.E.PIPE),
                    .syscall = .connect,
                },
            };
        };
    }
    const initResult = this.pipe.?.init(this.vm.uvLoop(), false);
    if (initResult == .err) {
        return initResult;
    }

    this.connect_req.data = this;
    return this.pipe.?.connect(&this.connect_req, path, this, onConnect);
}
pub fn startTLS(this: *WindowsNamedPipe, ssl_options: jsc.API.ServerConfig.SSLConfig, is_client: bool) !void {
    this.flags.is_ssl = true;
    if (this.start(is_client)) {
        this.wrapper = try WrapperType.init(ssl_options, is_client, .{
            .ctx = this,
            .onOpen = WindowsNamedPipe.onOpen,
            .onHandshake = WindowsNamedPipe.onHandshake,
            .onData = WindowsNamedPipe.onData,
            .onClose = WindowsNamedPipe.onClose,
            .write = WindowsNamedPipe.internalWrite,
        });

        this.wrapper.?.start();
    }
}

pub fn start(this: *WindowsNamedPipe, is_client: bool) bool {
    this.flags.is_client = is_client;
    if (this.pipe == null) {
        return false;
    }
    _ = this.pipe.?.unref();
    this.writer.setParent(this);
    const startPipeResult = this.writer.startWithPipe(this.pipe.?);
    if (startPipeResult == .err) {
        this.onError(startPipeResult.err);
        return false;
    }
    const stream = this.writer.getStream() orelse {
        this.onError(bun.sys.Error.fromCode(bun.sys.E.PIPE, .read));
        return false;
    };

    const readStartResult = stream.readStart(this, onReadAlloc, onReadError, onRead);
    if (readStartResult == .err) {
        this.onError(readStartResult.err);
        return false;
    }
    return true;
}

pub fn isTLS(this: *WindowsNamedPipe) bool {
    return this.flags.is_ssl;
}

pub fn loop(this: *WindowsNamedPipe) *bun.Async.Loop {
    return this.vm.uvLoop();
}

pub fn encodeAndWrite(this: *WindowsNamedPipe, data: []const u8) i32 {
    log("encodeAndWrite (len: {})", .{data.len});
    if (this.wrapper) |*wrapper| {
        return @as(i32, @intCast(wrapper.writeData(data) catch 0));
    } else {
        this.internalWrite(data);
    }
    return @intCast(data.len);
}

pub fn rawWrite(this: *WindowsNamedPipe, encoded_data: []const u8) i32 {
    this.internalWrite(encoded_data);
    return @intCast(encoded_data.len);
}

pub fn close(this: *WindowsNamedPipe) void {
    if (this.wrapper) |*wrapper| {
        _ = wrapper.shutdown(false);
    }
    this.writer.end();
}

pub fn shutdown(this: *WindowsNamedPipe) void {
    if (this.wrapper) |*wrapper| {
        _ = wrapper.shutdown(false);
    }
}

pub fn shutdownRead(this: *WindowsNamedPipe) void {
    if (this.wrapper) |*wrapper| {
        _ = wrapper.shutdownRead();
    } else {
        if (this.writer.getStream()) |stream| {
            _ = stream.readStop();
        }
    }
}

pub fn isShutdown(this: *WindowsNamedPipe) bool {
    if (this.wrapper) |wrapper| {
        return wrapper.isShutdown();
    }

    return this.flags.disconnected or this.writer.is_done;
}

pub fn isClosed(this: *WindowsNamedPipe) bool {
    if (this.wrapper) |wrapper| {
        return wrapper.isClosed();
    }
    return this.flags.disconnected;
}

pub fn isEstablished(this: *WindowsNamedPipe) bool {
    return !this.isClosed();
}

pub fn ssl(this: *WindowsNamedPipe) ?*BoringSSL.SSL {
    if (this.wrapper) |wrapper| {
        return wrapper.ssl;
    }
    return null;
}

pub fn sslError(this: *WindowsNamedPipe) us_bun_verify_error_t {
    return .{
        .error_no = this.ssl_error.error_no,
        .code = @ptrCast(this.ssl_error.code.ptr),
        .reason = @ptrCast(this.ssl_error.reason.ptr),
    };
}

pub fn resetTimeout(this: *WindowsNamedPipe) void {
    this.setTimeoutInMilliseconds(this.current_timeout);
}
pub fn setTimeoutInMilliseconds(this: *WindowsNamedPipe, ms: c_uint) void {
    if (this.event_loop_timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.event_loop_timer);
    }
    this.current_timeout = ms;

    // if the interval is 0 means that we stop the timer
    if (ms == 0) {
        return;
    }

    // reschedule the timer
    this.event_loop_timer.next = bun.timespec.msFromNow(.allow_mocked_time, ms);
    this.vm.timer.insert(&this.event_loop_timer);
}
pub fn setTimeout(this: *WindowsNamedPipe, seconds: c_uint) void {
    log("setTimeout({d})", .{seconds});
    this.setTimeoutInMilliseconds(seconds * 1000);
}
/// Free internal resources, it can be called multiple times
pub fn deinit(this: *WindowsNamedPipe) void {
    log("deinit", .{});
    // clear the timer
    this.setTimeout(0);
    if (this.writer.getStream()) |stream| {
        _ = stream.readStop();
    }
    this.writer.deinit();
    if (this.wrapper) |*wrapper| {
        wrapper.deinit();
        this.wrapper = null;
    }
    var ssl_error = this.ssl_error;
    ssl_error.deinit();
    this.ssl_error = .{};
}

pub const CertError = UpgradedDuplex.CertError;
const WrapperType = SSLWrapper(*WindowsNamedPipe);
const log = bun.Output.scoped(.WindowsNamedPipe, .visible);

const std = @import("std");
const SSLWrapper = @import("../../bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const BoringSSL = bun.BoringSSL.c;
const uv = bun.windows.libuv;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const uws = bun.uws;
const UpgradedDuplex = uws.UpgradedDuplex;
const us_bun_verify_error_t = uws.us_bun_verify_error_t;
