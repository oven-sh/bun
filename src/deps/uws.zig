pub const is_bindgen = false;
const bun = @import("root").bun;
const Api = bun.ApiSchema;
const std = @import("std");
const Environment = bun.Environment;
pub const u_int8_t = u8;
pub const u_int16_t = c_ushort;
pub const u_int32_t = c_uint;
pub const u_int64_t = c_ulonglong;
pub const LIBUS_LISTEN_DEFAULT: i32 = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: i32 = 1;
pub const LIBUS_SOCKET_ALLOW_HALF_OPEN: i32 = 2;
pub const LIBUS_SOCKET_REUSE_PORT: i32 = 4;
pub const LIBUS_SOCKET_IPV6_ONLY: i32 = 8;

pub const Socket = opaque {
    pub fn write2(this: *Socket, first: []const u8, second: []const u8) i32 {
        const rc = us_socket_write2(0, this, first.ptr, first.len, second.ptr, second.len);
        debug("us_socket_write2({d}, {d}) = {d}", .{ first.len, second.len, rc });
        return rc;
    }
    extern "C" fn us_socket_write2(ssl: i32, *Socket, header: ?[*]const u8, len: usize, payload: ?[*]const u8, usize) i32;
};
pub const ConnectingSocket = opaque {};
const debug = bun.Output.scoped(.uws, false);
const uws = @This();
const SSLWrapper = @import("../bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;
const TextEncoder = @import("../bun.js/webcore/encoding.zig").Encoder;
const JSC = bun.JSC;
const EventLoopTimer = @import("../bun.js//api//Timer.zig").EventLoopTimer;

pub const CloseCode = enum(i32) {
    normal = 0,
    failure = 1,
};

const BoringSSL = bun.BoringSSL;
fn NativeSocketHandleType(comptime ssl: bool) type {
    if (ssl) {
        return BoringSSL.SSL;
    } else {
        return anyopaque;
    }
}
pub const InternalLoopData = extern struct {
    pub const us_internal_async = opaque {};

    sweep_timer: ?*Timer,
    wakeup_async: ?*us_internal_async,
    last_write_failed: i32,
    head: ?*SocketContext,
    iterator: ?*SocketContext,
    closed_context_head: ?*SocketContext,
    recv_buf: [*]u8,
    send_buf: [*]u8,
    ssl_data: ?*anyopaque,
    pre_cb: ?*fn (?*Loop) callconv(.C) void,
    post_cb: ?*fn (?*Loop) callconv(.C) void,
    closed_udp_head: ?*udp.Socket,
    closed_head: ?*Socket,
    low_prio_head: ?*Socket,
    low_prio_budget: i32,
    dns_ready_head: *ConnectingSocket,
    closed_connecting_head: *ConnectingSocket,
    mutex: bun.Mutex.ReleaseImpl.Type,
    parent_ptr: ?*anyopaque,
    parent_tag: c_char,
    iteration_nr: usize,
    jsc_vm: ?*JSC.VM,

    pub fn recvSlice(this: *InternalLoopData) []u8 {
        return this.recv_buf[0..LIBUS_RECV_BUFFER_LENGTH];
    }

    pub fn setParentEventLoop(this: *InternalLoopData, parent: JSC.EventLoopHandle) void {
        switch (parent) {
            .js => |ptr| {
                this.parent_tag = 1;
                this.parent_ptr = ptr;
            },
            .mini => |ptr| {
                this.parent_tag = 2;
                this.parent_ptr = ptr;
            },
        }
    }

    pub fn getParent(this: *InternalLoopData) JSC.EventLoopHandle {
        const parent = this.parent_ptr orelse @panic("Parent loop not set - pointer is null");
        return switch (this.parent_tag) {
            0 => @panic("Parent loop not set - tag is zero"),
            1 => .{ .js = bun.cast(*JSC.EventLoop, parent) },
            2 => .{ .mini = bun.cast(*JSC.MiniEventLoop, parent) },
            else => @panic("Parent loop data corrupted - tag is invalid"),
        };
    }
};

pub const UpgradedDuplex = struct {
    pub const CertError = struct {
        error_no: i32 = 0,
        code: [:0]const u8 = "",
        reason: [:0]const u8 = "",

        pub fn deinit(this: *CertError) void {
            if (this.code.len > 0) {
                bun.default_allocator.free(this.code);
            }
            if (this.reason.len > 0) {
                bun.default_allocator.free(this.reason);
            }
        }
    };

    const WrapperType = SSLWrapper(*UpgradedDuplex);

    wrapper: ?WrapperType,
    origin: JSC.Strong = .{}, // any duplex
    ssl_error: CertError = .{},
    vm: *JSC.VirtualMachine,
    handlers: Handlers,

    onDataCallback: JSC.Strong = .{},
    onEndCallback: JSC.Strong = .{},
    onWritableCallback: JSC.Strong = .{},
    onCloseCallback: JSC.Strong = .{},
    event_loop_timer: EventLoopTimer = .{
        .next = .{},
        .tag = .UpgradedDuplex,
    },
    current_timeout: u32 = 0,

    pub const Handlers = struct {
        ctx: *anyopaque,
        onOpen: *const fn (*anyopaque) void,
        onHandshake: *const fn (*anyopaque, bool, uws.us_bun_verify_error_t) void,
        onData: *const fn (*anyopaque, []const u8) void,
        onClose: *const fn (*anyopaque) void,
        onEnd: *const fn (*anyopaque) void,
        onWritable: *const fn (*anyopaque) void,
        onError: *const fn (*anyopaque, JSC.JSValue) void,
        onTimeout: *const fn (*anyopaque) void,
    };

    const log = bun.Output.scoped(.UpgradedDuplex, false);
    fn onOpen(this: *UpgradedDuplex) void {
        log("onOpen", .{});
        this.handlers.onOpen(this.handlers.ctx);
    }

    fn onData(this: *UpgradedDuplex, decoded_data: []const u8) void {
        log("onData ({})", .{decoded_data.len});
        this.handlers.onData(this.handlers.ctx, decoded_data);
    }

    fn onHandshake(this: *UpgradedDuplex, handshake_success: bool, ssl_error: uws.us_bun_verify_error_t) void {
        log("onHandshake", .{});

        this.ssl_error = .{
            .error_no = ssl_error.error_no,
            .code = if (ssl_error.code == null or ssl_error.error_no == 0) "" else bun.default_allocator.dupeZ(u8, ssl_error.code[0..bun.len(ssl_error.code) :0]) catch bun.outOfMemory(),
            .reason = if (ssl_error.reason == null or ssl_error.error_no == 0) "" else bun.default_allocator.dupeZ(u8, ssl_error.reason[0..bun.len(ssl_error.reason) :0]) catch bun.outOfMemory(),
        };
        this.handlers.onHandshake(this.handlers.ctx, handshake_success, ssl_error);
    }

    fn onClose(this: *UpgradedDuplex) void {
        log("onClose", .{});
        defer this.deinit();

        this.handlers.onClose(this.handlers.ctx);
        // closes the underlying duplex
        this.callWriteOrEnd(null, false);
    }

    fn callWriteOrEnd(this: *UpgradedDuplex, data: ?[]const u8, msg_more: bool) void {
        if (this.vm.isShuttingDown()) {
            return;
        }
        if (this.origin.get()) |duplex| {
            const globalThis = this.origin.globalThis.?;
            const writeOrEnd = if (msg_more) duplex.getFunction(globalThis, "write") catch return orelse return else duplex.getFunction(globalThis, "end") catch return orelse return;
            if (data) |data_| {
                const buffer = JSC.BinaryType.toJS(.Buffer, data_, globalThis);
                buffer.ensureStillAlive();

                _ = writeOrEnd.call(globalThis, duplex, &.{buffer}) catch |err| {
                    this.handlers.onError(this.handlers.ctx, globalThis.takeException(err));
                };
            } else {
                _ = writeOrEnd.call(globalThis, duplex, &.{.null}) catch |err| {
                    this.handlers.onError(this.handlers.ctx, globalThis.takeException(err));
                };
            }
        }
    }

    fn internalWrite(this: *UpgradedDuplex, encoded_data: []const u8) void {
        this.resetTimeout();

        // Possible scenarios:
        // Scenario 1: will not write if vm is shutting down (we cannot do anything about it)
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        this.callWriteOrEnd(encoded_data, true);
    }

    pub fn flush(this: *UpgradedDuplex) void {
        if (this.wrapper) |*wrapper| {
            _ = wrapper.flush();
        }
    }

    fn onInternalReceiveData(this: *UpgradedDuplex, data: []const u8) void {
        if (this.wrapper) |*wrapper| {
            this.resetTimeout();
            wrapper.receiveData(data);
        }
    }

    fn onReceivedData(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        log("onReceivedData", .{});

        const function = callframe.callee();
        const args = callframe.arguments_old(1);

        if (JSC.getFunctionData(function)) |self| {
            const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));
            if (args.len >= 1) {
                const data_arg = args.ptr[0];
                if (this.origin.has()) {
                    if (data_arg.isEmptyOrUndefinedOrNull()) {
                        return JSC.JSValue.jsUndefined();
                    }
                    if (data_arg.asArrayBuffer(globalObject)) |array_buffer| {
                        // yay we can read the data
                        const payload = array_buffer.slice();
                        this.onInternalReceiveData(payload);
                    } else {
                        // node.js errors in this case with the same error, lets keep it consistent
                        const error_value = globalObject.ERR_STREAM_WRAP("Stream has StringDecoder set or is in objectMode", .{}).toJS();
                        error_value.ensureStillAlive();
                        this.handlers.onError(this.handlers.ctx, error_value);
                    }
                }
            }
        }
        return JSC.JSValue.jsUndefined();
    }

    fn onEnd(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) void {
        log("onEnd", .{});
        _ = globalObject;
        const function = callframe.callee();

        if (JSC.getFunctionData(function)) |self| {
            const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));

            if (this.wrapper != null) {
                this.handlers.onEnd(this.handlers.ctx);
            }
        }
    }

    fn onWritable(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        log("onWritable", .{});

        _ = globalObject;
        const function = callframe.callee();

        if (JSC.getFunctionData(function)) |self| {
            const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));
            // flush pending data
            if (this.wrapper) |*wrapper| {
                _ = wrapper.flush();
            }
            // call onWritable (will flush on demand)
            this.handlers.onWritable(this.handlers.ctx);
        }

        return JSC.JSValue.jsUndefined();
    }

    fn onCloseJS(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        log("onCloseJS", .{});

        _ = globalObject;
        const function = callframe.callee();

        if (JSC.getFunctionData(function)) |self| {
            const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));
            // flush pending data
            if (this.wrapper) |*wrapper| {
                _ = wrapper.shutdown(true);
            }
        }

        return JSC.JSValue.jsUndefined();
    }

    pub fn onTimeout(this: *UpgradedDuplex) EventLoopTimer.Arm {
        log("onTimeout", .{});

        const has_been_cleared = this.event_loop_timer.state == .CANCELLED or this.vm.scriptExecutionStatus() != .running;

        this.event_loop_timer.state = .FIRED;
        this.event_loop_timer.heap = .{};

        if (has_been_cleared) {
            return .disarm;
        }

        this.handlers.onTimeout(this.handlers.ctx);

        return .disarm;
    }

    pub fn from(
        globalThis: *JSC.JSGlobalObject,
        origin: JSC.JSValue,
        handlers: UpgradedDuplex.Handlers,
    ) UpgradedDuplex {
        return UpgradedDuplex{
            .vm = globalThis.bunVM(),
            .origin = JSC.Strong.create(origin, globalThis),
            .wrapper = null,
            .handlers = handlers,
        };
    }

    pub fn getJSHandlers(this: *UpgradedDuplex, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const array = JSC.JSValue.createEmptyArray(globalThis, 4);
        array.ensureStillAlive();

        {
            const callback = this.onDataCallback.get() orelse brk: {
                const dataCallback = JSC.NewFunctionWithData(
                    globalThis,
                    null,
                    0,
                    onReceivedData,
                    false,
                    this,
                );
                dataCallback.ensureStillAlive();

                JSC.setFunctionData(dataCallback, this);

                this.onDataCallback = JSC.Strong.create(dataCallback, globalThis);
                break :brk dataCallback;
            };
            array.putIndex(globalThis, 0, callback);
        }

        {
            const callback = this.onEndCallback.get() orelse brk: {
                const endCallback = JSC.NewFunctionWithData(
                    globalThis,
                    null,
                    0,
                    onReceivedData,
                    false,
                    this,
                );
                endCallback.ensureStillAlive();

                JSC.setFunctionData(endCallback, this);

                this.onEndCallback = JSC.Strong.create(endCallback, globalThis);
                break :brk endCallback;
            };
            array.putIndex(globalThis, 1, callback);
        }

        {
            const callback = this.onWritableCallback.get() orelse brk: {
                const writableCallback = JSC.NewFunctionWithData(
                    globalThis,
                    null,
                    0,
                    onWritable,
                    false,
                    this,
                );
                writableCallback.ensureStillAlive();

                JSC.setFunctionData(writableCallback, this);
                this.onWritableCallback = JSC.Strong.create(writableCallback, globalThis);
                break :brk writableCallback;
            };
            array.putIndex(globalThis, 2, callback);
        }

        {
            const callback = this.onCloseCallback.get() orelse brk: {
                const closeCallback = JSC.NewFunctionWithData(
                    globalThis,
                    null,
                    0,
                    onCloseJS,
                    false,
                    this,
                );
                closeCallback.ensureStillAlive();

                JSC.setFunctionData(closeCallback, this);
                this.onCloseCallback = JSC.Strong.create(closeCallback, globalThis);
                break :brk closeCallback;
            };
            array.putIndex(globalThis, 3, callback);
        }

        return array;
    }

    pub fn startTLS(this: *UpgradedDuplex, ssl_options: JSC.API.ServerConfig.SSLConfig, is_client: bool) !void {
        this.wrapper = try WrapperType.init(ssl_options, is_client, .{
            .ctx = this,
            .onOpen = UpgradedDuplex.onOpen,
            .onHandshake = UpgradedDuplex.onHandshake,
            .onData = UpgradedDuplex.onData,
            .onClose = UpgradedDuplex.onClose,
            .write = UpgradedDuplex.internalWrite,
        });

        this.wrapper.?.start();
    }

    pub fn encodeAndWrite(this: *UpgradedDuplex, data: []const u8, is_end: bool) i32 {
        log("encodeAndWrite (len: {} - is_end: {})", .{ data.len, is_end });
        if (this.wrapper) |*wrapper| {
            return @as(i32, @intCast(wrapper.writeData(data) catch 0));
        }
        return 0;
    }

    pub fn rawWrite(this: *UpgradedDuplex, encoded_data: []const u8, _: bool) i32 {
        this.internalWrite(encoded_data);
        return @intCast(encoded_data.len);
    }

    pub fn close(this: *UpgradedDuplex) void {
        if (this.wrapper) |*wrapper| {
            _ = wrapper.shutdown(true);
        }
    }

    pub fn shutdown(this: *UpgradedDuplex) void {
        if (this.wrapper) |*wrapper| {
            _ = wrapper.shutdown(false);
        }
    }

    pub fn shutdownRead(this: *UpgradedDuplex) void {
        if (this.wrapper) |*wrapper| {
            _ = wrapper.shutdownRead();
        }
    }

    pub fn isShutdown(this: *UpgradedDuplex) bool {
        if (this.wrapper) |wrapper| {
            return wrapper.isShutdown();
        }
        return true;
    }

    pub fn isClosed(this: *UpgradedDuplex) bool {
        if (this.wrapper) |wrapper| {
            return wrapper.isClosed();
        }
        return true;
    }

    pub fn isEstablished(this: *UpgradedDuplex) bool {
        return !this.isClosed();
    }

    pub fn ssl(this: *UpgradedDuplex) ?*BoringSSL.SSL {
        if (this.wrapper) |wrapper| {
            return wrapper.ssl;
        }
        return null;
    }

    pub fn sslError(this: *UpgradedDuplex) us_bun_verify_error_t {
        return .{
            .error_no = this.ssl_error.error_no,
            .code = @ptrCast(this.ssl_error.code.ptr),
            .reason = @ptrCast(this.ssl_error.reason.ptr),
        };
    }

    pub fn resetTimeout(this: *UpgradedDuplex) void {
        this.setTimeoutInMilliseconds(this.current_timeout);
    }
    pub fn setTimeoutInMilliseconds(this: *UpgradedDuplex, ms: c_uint) void {
        if (this.event_loop_timer.state == .ACTIVE) {
            this.vm.timer.remove(&this.event_loop_timer);
        }
        this.current_timeout = ms;

        // if the interval is 0 means that we stop the timer
        if (ms == 0) {
            return;
        }

        // reschedule the timer
        this.event_loop_timer.next = bun.timespec.msFromNow(ms);
        this.vm.timer.insert(&this.event_loop_timer);
    }
    pub fn setTimeout(this: *UpgradedDuplex, seconds: c_uint) void {
        log("setTimeout({d})", .{seconds});
        this.setTimeoutInMilliseconds(seconds * 1000);
    }

    pub fn deinit(this: *UpgradedDuplex) void {
        log("deinit", .{});
        // clear the timer
        this.setTimeout(0);

        if (this.wrapper) |*wrapper| {
            wrapper.deinit();
            this.wrapper = null;
        }

        this.origin.deinit();
        if (this.onDataCallback.get()) |callback| {
            JSC.setFunctionData(callback, null);
            this.onDataCallback.deinit();
        }
        if (this.onEndCallback.get()) |callback| {
            JSC.setFunctionData(callback, null);
            this.onEndCallback.deinit();
        }
        if (this.onWritableCallback.get()) |callback| {
            JSC.setFunctionData(callback, null);
            this.onWritableCallback.deinit();
        }
        if (this.onCloseCallback.get()) |callback| {
            JSC.setFunctionData(callback, null);
            this.onCloseCallback.deinit();
        }
        var ssl_error = this.ssl_error;
        ssl_error.deinit();
        this.ssl_error = .{};
    }
};

pub const WindowsNamedPipe = if (Environment.isWindows) struct {
    pub const CertError = UpgradedDuplex.CertError;

    const WrapperType = SSLWrapper(*WindowsNamedPipe);
    const uv = bun.windows.libuv;
    wrapper: ?WrapperType,
    pipe: if (Environment.isWindows) ?*uv.Pipe else void, // any duplex
    vm: *bun.JSC.VirtualMachine, //TODO: create a timeout version that dont need the JSC VM

    writer: bun.io.StreamingWriter(WindowsNamedPipe, onWrite, onError, onWritable, onPipeClose) = .{},

    incoming: bun.ByteList = .{}, // Maybe we should use IPCBuffer here as well
    ssl_error: CertError = .{},
    handlers: Handlers,
    connect_req: uv.uv_connect_t = std.mem.zeroes(uv.uv_connect_t),

    event_loop_timer: EventLoopTimer = .{
        .next = .{},
        .tag = .WindowsNamedPipe,
    },
    current_timeout: u32 = 0,
    flags: Flags = .{},

    pub const Flags = packed struct {
        disconnected: bool = true,
        is_closed: bool = false,
        is_client: bool = false,
        is_ssl: bool = false,
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

    const log = bun.Output.scoped(.WindowsNamedPipe, false);

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
        var available = this.incoming.available();
        if (available.len < suggested_size) {
            this.incoming.ensureUnusedCapacity(bun.default_allocator, suggested_size) catch bun.outOfMemory();
            available = this.incoming.available();
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

    fn onReadError(this: *WindowsNamedPipe, err: bun.C.E) void {
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
            .code = if (ssl_error.code == null or ssl_error.error_no == 0) "" else bun.default_allocator.dupeZ(u8, ssl_error.code[0..bun.len(ssl_error.code) :0]) catch bun.outOfMemory(),
            .reason = if (ssl_error.reason == null or ssl_error.error_no == 0) "" else bun.default_allocator.dupeZ(u8, ssl_error.reason[0..bun.len(ssl_error.reason) :0]) catch bun.outOfMemory(),
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
                    this.writer.outgoing.write(bytes) catch bun.outOfMemory();
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

    pub fn onTimeout(this: *WindowsNamedPipe) EventLoopTimer.Arm {
        log("onTimeout", .{});

        const has_been_cleared = this.event_loop_timer.state == .CANCELLED or this.vm.scriptExecutionStatus() != .running;

        this.event_loop_timer.state = .FIRED;
        this.event_loop_timer.heap = .{};

        if (has_been_cleared) {
            return .disarm;
        }

        this.handlers.onTimeout(this.handlers.ctx);

        return .disarm;
    }

    pub fn from(
        pipe: *uv.Pipe,
        handlers: WindowsNamedPipe.Handlers,
        vm: *JSC.VirtualMachine,
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

    pub fn getAcceptedBy(this: *WindowsNamedPipe, server: *uv.Pipe, ssl_ctx: ?*BoringSSL.SSL_CTX) JSC.Maybe(void) {
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
                        .errno = @intFromEnum(bun.C.E.PIPE),
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
        return .{ .result = {} };
    }
    pub fn open(this: *WindowsNamedPipe, fd: bun.FileDescriptor, ssl_options: ?JSC.API.ServerConfig.SSLConfig) JSC.Maybe(void) {
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
                        .errno = @intFromEnum(bun.C.E.PIPE),
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
        return .{ .result = {} };
    }

    pub fn connect(this: *WindowsNamedPipe, path: []const u8, ssl_options: ?JSC.API.ServerConfig.SSLConfig) JSC.Maybe(void) {
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
                        .errno = @intFromEnum(bun.C.E.PIPE),
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
    pub fn startTLS(this: *WindowsNamedPipe, ssl_options: JSC.API.ServerConfig.SSLConfig, is_client: bool) !void {
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
            this.onError(bun.sys.Error.fromCode(bun.C.E.PIPE, .read));
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

    pub fn encodeAndWrite(this: *WindowsNamedPipe, data: []const u8, is_end: bool) i32 {
        log("encodeAndWrite (len: {} - is_end: {})", .{ data.len, is_end });
        if (this.wrapper) |*wrapper| {
            return @as(i32, @intCast(wrapper.writeData(data) catch 0));
        } else {
            this.internalWrite(data);
        }
        return @intCast(data.len);
    }

    pub fn rawWrite(this: *WindowsNamedPipe, encoded_data: []const u8, _: bool) i32 {
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
        this.event_loop_timer.next = bun.timespec.msFromNow(ms);
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
} else void;

pub const InternalSocket = union(enum) {
    connected: *Socket,
    connecting: *ConnectingSocket,
    detached: void,
    upgradedDuplex: *UpgradedDuplex,
    pipe: *WindowsNamedPipe,

    pub fn pauseResume(this: InternalSocket, comptime ssl: bool, comptime pause: bool) bool {
        switch (this) {
            .detached => return true,
            .connected => |socket| {
                if (pause) {
                    // Pause
                    us_socket_pause(@intFromBool(ssl), socket);
                } else {
                    // Resume
                    us_socket_resume(@intFromBool(ssl), socket);
                }
                return true;
            },
            .connecting => |_| {
                // always return false for connecting sockets
                return false;
            },
            .upgradedDuplex => |_| {
                // TODO: pause and resume upgraded duplex
                return false;
            },
            .pipe => |pipe| {
                if (Environment.isWindows) {
                    if (pause) {
                        return pipe.pauseStream();
                    }
                    return pipe.resumeStream();
                }
                return false;
            },
        }
    }
    pub fn isDetached(this: InternalSocket) bool {
        return this == .detached;
    }
    pub fn isNamedPipe(this: InternalSocket) bool {
        return this == .pipe;
    }
    pub fn detach(this: *InternalSocket) void {
        this.* = .detached;
    }
    pub fn setNoDelay(this: InternalSocket, enabled: bool) bool {
        switch (this) {
            .pipe, .upgradedDuplex, .connecting, .detached => return false,
            .connected => |socket| {
                // only supported by connected sockets
                us_socket_nodelay(socket, @intFromBool(enabled));
                return true;
            },
        }
    }
    pub fn setKeepAlive(this: InternalSocket, enabled: bool, delay: u32) bool {
        switch (this) {
            .pipe, .upgradedDuplex, .connecting, .detached => return false,
            .connected => |socket| {
                // only supported by connected sockets and can fail
                return us_socket_keepalive(socket, @intFromBool(enabled), delay) == 0;
            },
        }
    }
    pub fn close(this: InternalSocket, comptime is_ssl: bool, code: CloseCode) void {
        switch (this) {
            .detached => {},
            .connected => |socket| {
                debug("us_socket_close({d})", .{@intFromPtr(socket)});
                _ = us_socket_close(
                    comptime @intFromBool(is_ssl),
                    socket,
                    code,
                    null,
                );
            },
            .connecting => |socket| {
                debug("us_connecting_socket_close({d})", .{@intFromPtr(socket)});
                _ = us_connecting_socket_close(
                    comptime @intFromBool(is_ssl),
                    socket,
                );
            },
            .upgradedDuplex => |socket| {
                socket.close();
            },
            .pipe => |pipe| {
                if (Environment.isWindows) pipe.close();
            },
        }
    }

    pub fn isClosed(this: InternalSocket, comptime is_ssl: bool) bool {
        return switch (this) {
            .connected => |socket| us_socket_is_closed(@intFromBool(is_ssl), socket) > 0,
            .connecting => |socket| us_connecting_socket_is_closed(@intFromBool(is_ssl), socket) > 0,
            .detached => true,
            .upgradedDuplex => |socket| socket.isClosed(),
            .pipe => |pipe| if (Environment.isWindows) pipe.isClosed() else true,
        };
    }

    pub fn get(this: @This()) ?*Socket {
        return switch (this) {
            .connected => this.connected,
            .connecting => null,
            .detached => null,
            .upgradedDuplex => null,
            .pipe => null,
        };
    }

    pub fn eq(this: @This(), other: @This()) bool {
        return switch (this) {
            .connected => switch (other) {
                .connected => this.connected == other.connected,
                .upgradedDuplex, .connecting, .detached, .pipe => false,
            },
            .connecting => switch (other) {
                .upgradedDuplex, .connected, .detached, .pipe => false,
                .connecting => this.connecting == other.connecting,
            },
            .detached => switch (other) {
                .detached => true,
                .upgradedDuplex, .connected, .connecting, .pipe => false,
            },
            .upgradedDuplex => switch (other) {
                .upgradedDuplex => this.upgradedDuplex == other.upgradedDuplex,
                .connected, .connecting, .detached, .pipe => false,
            },
            .pipe => switch (other) {
                .pipe => if (Environment.isWindows) other.pipe == other.pipe else false,
                .connected, .connecting, .detached, .upgradedDuplex => false,
            },
        };
    }
};

pub fn NewSocketHandler(comptime is_ssl: bool) type {
    return struct {
        const ssl_int: i32 = @intFromBool(is_ssl);
        socket: InternalSocket,
        const ThisSocket = @This();
        pub const detached: NewSocketHandler(is_ssl) = NewSocketHandler(is_ssl){ .socket = .{ .detached = {} } };
        pub fn setNoDelay(this: ThisSocket, enabled: bool) bool {
            return this.socket.setNoDelay(enabled);
        }
        pub fn setKeepAlive(this: ThisSocket, enabled: bool, delay: u32) bool {
            return this.socket.setKeepAlive(enabled, delay);
        }
        pub fn pauseStream(this: ThisSocket) bool {
            return this.socket.pauseResume(is_ssl, true);
        }
        pub fn resumeStream(this: ThisSocket) bool {
            return this.socket.pauseResume(is_ssl, false);
        }
        pub fn detach(this: *ThisSocket) void {
            this.socket.detach();
        }
        pub fn isDetached(this: ThisSocket) bool {
            return this.socket.isDetached();
        }
        pub fn isNamedPipe(this: ThisSocket) bool {
            return this.socket.isNamedPipe();
        }
        pub fn verifyError(this: ThisSocket) us_bun_verify_error_t {
            switch (this.socket) {
                .connected => |socket| return uws.us_socket_verify_error(comptime ssl_int, socket),
                .upgradedDuplex => |socket| return socket.sslError(),
                .pipe => |pipe| if (Environment.isWindows) return pipe.sslError() else return std.mem.zeroes(us_bun_verify_error_t),
                .connecting, .detached => return std.mem.zeroes(us_bun_verify_error_t),
            }
        }

        pub fn isEstablished(this: ThisSocket) bool {
            switch (this.socket) {
                .connected => |socket| return us_socket_is_established(comptime ssl_int, socket) > 0,
                .upgradedDuplex => |socket| return socket.isEstablished(),
                .pipe => |pipe| if (Environment.isWindows) return pipe.isEstablished() else return false,
                .connecting, .detached => return false,
            }
        }

        pub fn timeout(this: ThisSocket, seconds: c_uint) void {
            switch (this.socket) {
                .upgradedDuplex => |socket| socket.setTimeout(seconds),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(seconds),
                .connected => |socket| us_socket_timeout(comptime ssl_int, socket, seconds),
                .connecting => |socket| us_connecting_socket_timeout(comptime ssl_int, socket, seconds),
                .detached => {},
            }
        }

        pub fn setTimeout(this: ThisSocket, seconds: c_uint) void {
            switch (this.socket) {
                .connected => |socket| {
                    if (seconds > 240) {
                        us_socket_timeout(comptime ssl_int, socket, 0);
                        us_socket_long_timeout(comptime ssl_int, socket, seconds / 60);
                    } else {
                        us_socket_timeout(comptime ssl_int, socket, seconds);
                        us_socket_long_timeout(comptime ssl_int, socket, 0);
                    }
                },
                .connecting => |socket| {
                    if (seconds > 240) {
                        us_connecting_socket_timeout(comptime ssl_int, socket, 0);
                        us_connecting_socket_long_timeout(comptime ssl_int, socket, seconds / 60);
                    } else {
                        us_connecting_socket_timeout(comptime ssl_int, socket, seconds);
                        us_connecting_socket_long_timeout(comptime ssl_int, socket, 0);
                    }
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.setTimeout(seconds),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(seconds),
            }
        }

        pub fn setTimeoutMinutes(this: ThisSocket, minutes: c_uint) void {
            switch (this.socket) {
                .connected => |socket| {
                    us_socket_timeout(comptime ssl_int, socket, 0);
                    us_socket_long_timeout(comptime ssl_int, socket, minutes);
                },
                .connecting => |socket| {
                    us_connecting_socket_timeout(comptime ssl_int, socket, 0);
                    us_connecting_socket_long_timeout(comptime ssl_int, socket, minutes);
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.setTimeout(minutes * 60),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(minutes * 60),
            }
        }

        pub fn startTLS(this: ThisSocket, is_client: bool) void {
            const socket = this.socket.get() orelse return;
            _ = us_socket_open(comptime ssl_int, socket, @intFromBool(is_client), null, 0);
        }

        pub fn ssl(this: ThisSocket) ?*BoringSSL.SSL {
            if (comptime is_ssl) {
                if (this.getNativeHandle()) |handle| {
                    return @as(*BoringSSL.SSL, @ptrCast(handle));
                }
                return null;
            }
            return null;
        }

        // Note: this assumes that the socket is non-TLS and will be adopted and wrapped with a new TLS context
        // context ext will not be copied to the new context, new context will contain us_wrapped_socket_context_t on ext
        pub fn wrapTLS(
            this: ThisSocket,
            options: us_bun_socket_context_options_t,
            socket_ext_size: i32,
            comptime deref: bool,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) ?NewSocketHandler(true) {
            const TLSSocket = NewSocketHandler(true);
            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);
                const deref_ = deref;
                const ValueType = if (deref) ContextType else *ContextType;
                fn getValue(socket: *Socket) ValueType {
                    if (comptime ContextType == anyopaque) {
                        return us_socket_ext(1, socket);
                    }

                    if (comptime deref_) {
                        return (TLSSocket.from(socket)).ext(ContextType).?.*;
                    }

                    return (TLSSocket.from(socket)).ext(ContextType);
                }

                pub fn on_open(socket: *Socket, is_client: i32, _: [*c]u8, _: i32) callconv(.C) ?*Socket {
                    if (comptime @hasDecl(Fields, "onCreate")) {
                        if (is_client == 0) {
                            Fields.onCreate(
                                TLSSocket.from(socket),
                            );
                        }
                    }
                    Fields.onOpen(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_close(socket: *Socket, code: i32, reason: ?*anyopaque) callconv(.C) ?*Socket {
                    Fields.onClose(
                        getValue(socket),
                        TLSSocket.from(socket),
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *Socket, buf: ?[*]u8, len: i32) callconv(.C) ?*Socket {
                    Fields.onData(
                        getValue(socket),
                        TLSSocket.from(socket),
                        buf.?[0..@as(usize, @intCast(len))],
                    );
                    return socket;
                }
                pub fn on_writable(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onWritable(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onTimeout(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_long_timeout(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onLongTimeout(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *Socket, code: i32) callconv(.C) ?*Socket {
                    Fields.onConnectError(
                        TLSSocket.from(socket).ext(ContextType).?.*,
                        TLSSocket.from(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_connect_error_connecting_socket(socket: *ConnectingSocket, code: i32) callconv(.C) ?*ConnectingSocket {
                    Fields.onConnectError(
                        @as(*align(alignment) ContextType, @ptrCast(@alignCast(us_connecting_socket_ext(1, socket)))).*,
                        TLSSocket.fromConnecting(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onEnd(
                        getValue(socket),
                        TLSSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_handshake(socket: *Socket, success: i32, verify_error: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {
                    Fields.onHandshake(getValue(socket), TLSSocket.from(socket), success, verify_error);
                }
            };

            const events: us_socket_events_t = .{
                .on_open = SocketHandler.on_open,
                .on_close = SocketHandler.on_close,
                .on_data = SocketHandler.on_data,
                .on_writable = SocketHandler.on_writable,
                .on_timeout = SocketHandler.on_timeout,
                .on_connect_error = SocketHandler.on_connect_error,
                .on_connect_error_connecting_socket = SocketHandler.on_connect_error_connecting_socket,
                .on_end = SocketHandler.on_end,
                .on_handshake = SocketHandler.on_handshake,
                .on_long_timeout = SocketHandler.on_long_timeout,
            };

            const this_socket = this.socket.get() orelse return null;

            const socket = us_socket_wrap_with_tls(ssl_int, this_socket, options, events, socket_ext_size) orelse return null;
            return NewSocketHandler(true).from(socket);
        }

        pub fn getNativeHandle(this: ThisSocket) ?*NativeSocketHandleType(is_ssl) {
            return @ptrCast(switch (this.socket) {
                .connected => |socket| us_socket_get_native_handle(comptime ssl_int, socket),
                .connecting => |socket| us_connecting_socket_get_native_handle(comptime ssl_int, socket),
                .detached => null,
                .upgradedDuplex => |socket| if (is_ssl) @as(*anyopaque, @ptrCast(socket.ssl() orelse return null)) else null,
                .pipe => |socket| if (is_ssl and Environment.isWindows) @as(*anyopaque, @ptrCast(socket.ssl() orelse return null)) else null,
            } orelse return null);
        }

        pub inline fn fd(this: ThisSocket) bun.FileDescriptor {
            if (comptime is_ssl) {
                @compileError("SSL sockets do not have a file descriptor accessible this way");
            }
            const socket = this.socket.get() orelse return bun.invalid_fd;
            return if (comptime Environment.isWindows)
                // on windows uSockets exposes SOCKET
                bun.toFD(@as(bun.FDImpl.System, @ptrCast(us_socket_get_native_handle(0, socket))))
            else
                bun.toFD(@as(i32, @intCast(@intFromPtr(us_socket_get_native_handle(0, socket)))));
        }

        pub fn markNeedsMoreForSendfile(this: ThisSocket) void {
            if (comptime is_ssl) {
                @compileError("SSL sockets do not support sendfile yet");
            }
            const socket = this.socket.get() orelse return;
            us_socket_sendfile_needs_more(socket);
        }

        pub fn ext(this: ThisSocket, comptime ContextType: type) ?*ContextType {
            const alignment = if (ContextType == *anyopaque)
                @sizeOf(usize)
            else
                std.meta.alignment(ContextType);

            const ptr = switch (this.socket) {
                .connected => |sock| us_socket_ext(comptime ssl_int, sock),
                .connecting => |sock| us_connecting_socket_ext(comptime ssl_int, sock),
                .detached => return null,
                .upgradedDuplex => return null,
                .pipe => return null,
            };

            return @as(*align(alignment) ContextType, @ptrCast(@alignCast(ptr)));
        }

        /// This can be null if the socket was closed.
        pub fn context(this: ThisSocket) ?*SocketContext {
            switch (this.socket) {
                .connected => |socket| return us_socket_context(comptime ssl_int, socket),
                .connecting => |socket| return us_connecting_socket_context(comptime ssl_int, socket),
                .detached => return null,
                .upgradedDuplex => return null,
                .pipe => return null,
            }
        }

        pub fn flush(this: ThisSocket) void {
            switch (this.socket) {
                .upgradedDuplex => |socket| {
                    return socket.flush();
                },
                .pipe => |pipe| {
                    return if (Environment.isWindows) pipe.flush() else return;
                },
                .connected => |socket| {
                    return us_socket_flush(
                        comptime ssl_int,
                        socket,
                    );
                },
                .connecting, .detached => return,
            }
        }

        pub fn write(this: ThisSocket, data: []const u8, msg_more: bool) i32 {
            switch (this.socket) {
                .upgradedDuplex => |socket| {
                    return socket.encodeAndWrite(data, msg_more);
                },
                .pipe => |pipe| {
                    return if (Environment.isWindows) pipe.encodeAndWrite(data, msg_more) else 0;
                },
                .connected => |socket| {
                    const result = us_socket_write(
                        comptime ssl_int,
                        socket,
                        data.ptr,
                        // truncate to 31 bits since sign bit exists
                        @as(i32, @intCast(@as(u31, @truncate(data.len)))),
                        @as(i32, @intFromBool(msg_more)),
                    );

                    if (comptime Environment.allow_assert) {
                        debug("us_socket_write({*}, {d}) = {d}", .{ this.getNativeHandle(), data.len, result });
                    }

                    return result;
                },
                .connecting, .detached => return 0,
            }
        }

        pub fn rawWrite(this: ThisSocket, data: []const u8, msg_more: bool) i32 {
            switch (this.socket) {
                .connected => |socket| {
                    return us_socket_raw_write(
                        comptime ssl_int,
                        socket,
                        data.ptr,
                        // truncate to 31 bits since sign bit exists
                        @as(i32, @intCast(@as(u31, @truncate(data.len)))),
                        @as(i32, @intFromBool(msg_more)),
                    );
                },
                .connecting, .detached => return 0,
                .upgradedDuplex => |socket| {
                    return socket.rawWrite(data, msg_more);
                },
                .pipe => |pipe| {
                    return if (Environment.isWindows) pipe.rawWrite(data, msg_more) else 0;
                },
            }
        }
        pub fn shutdown(this: ThisSocket) void {
            // debug("us_socket_shutdown({d})", .{@intFromPtr(this.socket)});
            switch (this.socket) {
                .connected => |socket| {
                    return us_socket_shutdown(
                        comptime ssl_int,
                        socket,
                    );
                },
                .connecting => |socket| {
                    return us_connecting_socket_shutdown(
                        comptime ssl_int,
                        socket,
                    );
                },
                .detached => {},
                .upgradedDuplex => |socket| {
                    socket.shutdown();
                },
                .pipe => |pipe| {
                    if (Environment.isWindows) pipe.shutdown();
                },
            }
        }

        pub fn shutdownRead(this: ThisSocket) void {
            switch (this.socket) {
                .connected => |socket| {
                    // debug("us_socket_shutdown_read({d})", .{@intFromPtr(socket)});
                    return us_socket_shutdown_read(
                        comptime ssl_int,
                        socket,
                    );
                },
                .connecting => |socket| {
                    // debug("us_connecting_socket_shutdown_read({d})", .{@intFromPtr(socket)});
                    return us_connecting_socket_shutdown_read(
                        comptime ssl_int,
                        socket,
                    );
                },
                .detached => {},
                .upgradedDuplex => |socket| {
                    socket.shutdownRead();
                },
                .pipe => |pipe| {
                    if (Environment.isWindows) pipe.shutdownRead();
                },
            }
        }

        pub fn isShutdown(this: ThisSocket) bool {
            switch (this.socket) {
                .connected => |socket| {
                    return us_socket_is_shut_down(
                        comptime ssl_int,
                        socket,
                    ) > 0;
                },
                .connecting => |socket| {
                    return us_connecting_socket_is_shut_down(
                        comptime ssl_int,
                        socket,
                    ) > 0;
                },
                .detached => return true,
                .upgradedDuplex => |socket| {
                    return socket.isShutdown();
                },
                .pipe => |pipe| {
                    return if (Environment.isWindows) pipe.isShutdown() else false;
                },
            }
        }

        pub fn isClosedOrHasError(this: ThisSocket) bool {
            if (this.isClosed() or this.isShutdown()) {
                return true;
            }

            return this.getError() != 0;
        }

        pub fn getError(this: ThisSocket) i32 {
            switch (this.socket) {
                .connected => |socket| {
                    return us_socket_get_error(
                        comptime ssl_int,
                        socket,
                    );
                },
                .connecting => |socket| {
                    return us_connecting_socket_get_error(
                        comptime ssl_int,
                        socket,
                    );
                },
                .detached => return 0,
                .upgradedDuplex => |socket| {
                    return socket.sslError().error_no;
                },
                .pipe => |pipe| {
                    return if (Environment.isWindows) pipe.sslError().error_no else 0;
                },
            }
        }

        pub fn isClosed(this: ThisSocket) bool {
            return this.socket.isClosed(comptime is_ssl);
        }

        pub fn close(this: ThisSocket, code: CloseCode) void {
            return this.socket.close(comptime is_ssl, code);
        }
        pub fn localPort(this: ThisSocket) i32 {
            switch (this.socket) {
                .connected => |socket| {
                    return us_socket_local_port(
                        comptime ssl_int,
                        socket,
                    );
                },
                .pipe, .upgradedDuplex, .connecting, .detached => return 0,
            }
        }
        pub fn remoteAddress(this: ThisSocket, buf: [*]u8, length: *i32) void {
            switch (this.socket) {
                .connected => |socket| {
                    return us_socket_remote_address(
                        comptime ssl_int,
                        socket,
                        buf,
                        length,
                    );
                },
                .pipe, .upgradedDuplex, .connecting, .detached => return {
                    length.* = 0;
                },
            }
        }

        /// Get the local address of a socket in binary format.
        ///
        /// # Arguments
        /// - `buf`: A buffer to store the binary address data.
        ///
        /// # Returns
        /// This function returns a slice of the buffer on success, or null on failure.
        pub fn localAddressBinary(this: ThisSocket, buf: []u8) ?[]const u8 {
            switch (this.socket) {
                .connected => |socket| {
                    var length: i32 = @intCast(buf.len);
                    us_socket_local_address(
                        comptime ssl_int,
                        socket,
                        buf.ptr,
                        &length,
                    );

                    if (length <= 0) {
                        return null;
                    }
                    return buf[0..@intCast(length)];
                },
                .pipe, .upgradedDuplex, .connecting, .detached => return null,
            }
        }

        /// Get the local address of a socket in text format.
        ///
        /// # Arguments
        /// - `buf`: A buffer to store the text address data.
        /// - `is_ipv6`: A pointer to a boolean representing whether the address is IPv6.
        ///
        /// # Returns
        /// This function returns a slice of the buffer on success, or null on failure.
        pub fn localAddressText(this: ThisSocket, buf: []u8, is_ipv6: *bool) ?[]const u8 {
            const addr_v4_len = @sizeOf(std.meta.FieldType(std.posix.sockaddr.in, .addr));
            const addr_v6_len = @sizeOf(std.meta.FieldType(std.posix.sockaddr.in6, .addr));

            var sa_buf: [addr_v6_len + 1]u8 = undefined;
            const binary = this.localAddressBinary(&sa_buf) orelse return null;
            const addr_len: usize = binary.len;
            sa_buf[addr_len] = 0;

            var ret: ?[*:0]const u8 = null;
            if (addr_len == addr_v4_len) {
                ret = bun.c_ares.ares_inet_ntop(std.posix.AF.INET, &sa_buf, buf.ptr, @as(u32, @intCast(buf.len)));
                is_ipv6.* = false;
            } else if (addr_len == addr_v6_len) {
                ret = bun.c_ares.ares_inet_ntop(std.posix.AF.INET6, &sa_buf, buf.ptr, @as(u32, @intCast(buf.len)));
                is_ipv6.* = true;
            }

            if (ret) |_| {
                const length: usize = @intCast(bun.len(bun.cast([*:0]u8, buf)));
                return buf[0..length];
            }
            return null;
        }

        pub fn connect(
            host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: Context,
            comptime socket_field_name: []const u8,
            allowHalfOpen: bool,
        ) ?*Context {
            debug("connect({s}, {d})", .{ host, port });

            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();

            // remove brackets from IPv6 addresses, as getaddrinfo doesn't understand them
            const clean_host = if (host.len > 1 and host[0] == '[' and host[host.len - 1] == ']')
                host[1 .. host.len - 1]
            else
                host;

            const host_ = allocator.dupeZ(u8, clean_host) catch bun.outOfMemory();
            defer allocator.free(host);

            var did_dns_resolve: i32 = 0;
            const socket = us_socket_context_connect(comptime ssl_int, socket_ctx, host_, port, if (allowHalfOpen) LIBUS_SOCKET_ALLOW_HALF_OPEN else 0, @sizeOf(Context), &did_dns_resolve) orelse return null;
            const socket_ = if (did_dns_resolve == 1)
                ThisSocket{
                    .socket = .{ .connected = @ptrCast(socket) },
                }
            else
                ThisSocket{
                    .socket = .{ .connecting = @ptrCast(socket) },
                };

            var holder = socket_.ext(Context);
            holder.* = ctx;
            @field(holder, socket_field_name) = socket_;
            return holder;
        }

        pub fn connectPtr(
            host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: *Context,
            comptime socket_field_name: []const u8,
            allowHalfOpen: bool,
        ) !*Context {
            const this_socket = try connectAnon(host, port, socket_ctx, ctx, allowHalfOpen);
            @field(ctx, socket_field_name) = this_socket;
            return ctx;
        }

        pub fn fromDuplex(
            duplex: *UpgradedDuplex,
        ) ThisSocket {
            return ThisSocket{ .socket = .{ .upgradedDuplex = duplex } };
        }

        pub fn fromNamedPipe(
            pipe: *WindowsNamedPipe,
        ) ThisSocket {
            if (Environment.isWindows) {
                return ThisSocket{ .socket = .{ .pipe = pipe } };
            }
            @compileError("WindowsNamedPipe is only available on Windows");
        }

        pub fn fromFd(
            ctx: *SocketContext,
            handle: bun.FileDescriptor,
            comptime This: type,
            this: *This,
            comptime socket_field_name: ?[]const u8,
        ) ?ThisSocket {
            const socket_ = ThisSocket{ .socket = .{ .connected = us_socket_from_fd(ctx, @sizeOf(*anyopaque), bun.socketcast(handle)) orelse return null } };

            if (socket_.ext(*anyopaque)) |holder| {
                holder.* = this;
            }

            if (comptime socket_field_name) |field| {
                @field(this, field) = socket_;
            }

            return socket_;
        }

        pub fn connectUnixPtr(
            path: []const u8,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: *Context,
            comptime socket_field_name: []const u8,
        ) !*Context {
            const this_socket = try connectUnixAnon(path, socket_ctx, ctx);
            @field(ctx, socket_field_name) = this_socket;
            return ctx;
        }

        pub fn connectUnixAnon(
            path: []const u8,
            socket_ctx: *SocketContext,
            ctx: *anyopaque,
            allowHalfOpen: bool,
        ) !ThisSocket {
            debug("connect(unix:{s})", .{path});
            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();
            const path_ = allocator.dupeZ(u8, path) catch bun.outOfMemory();
            defer allocator.free(path_);

            const socket = us_socket_context_connect_unix(comptime ssl_int, socket_ctx, path_, path_.len, if (allowHalfOpen) LIBUS_SOCKET_ALLOW_HALF_OPEN else 0, 8) orelse
                return error.FailedToOpenSocket;

            const socket_ = ThisSocket{ .socket = .{ .connected = socket } };
            if (socket_.ext(*anyopaque)) |holder| {
                holder.* = ctx;
            }
            return socket_;
        }

        pub fn connectAnon(
            raw_host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            ptr: *anyopaque,
            allowHalfOpen: bool,
        ) !ThisSocket {
            debug("connect({s}, {d})", .{ raw_host, port });
            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();

            // remove brackets from IPv6 addresses, as getaddrinfo doesn't understand them
            const clean_host = if (raw_host.len > 1 and raw_host[0] == '[' and raw_host[raw_host.len - 1] == ']')
                raw_host[1 .. raw_host.len - 1]
            else
                raw_host;

            const host = allocator.dupeZ(u8, clean_host) catch bun.outOfMemory();
            defer allocator.free(host);

            var did_dns_resolve: i32 = 0;
            const socket_ptr = us_socket_context_connect(
                comptime ssl_int,
                socket_ctx,
                host.ptr,
                port,
                if (allowHalfOpen) LIBUS_SOCKET_ALLOW_HALF_OPEN else 0,
                @sizeOf(*anyopaque),
                &did_dns_resolve,
            ) orelse return error.FailedToOpenSocket;
            const socket = if (did_dns_resolve == 1)
                ThisSocket{
                    .socket = .{ .connected = @ptrCast(socket_ptr) },
                }
            else
                ThisSocket{
                    .socket = .{ .connecting = @ptrCast(socket_ptr) },
                };
            if (socket.ext(*anyopaque)) |holder| {
                holder.* = ptr;
            }
            return socket;
        }

        pub fn unsafeConfigure(
            ctx: *SocketContext,
            comptime ssl_type: bool,
            comptime deref: bool,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) void {
            const SocketHandlerType = NewSocketHandler(ssl_type);
            const ssl_type_int: i32 = @intFromBool(ssl_type);
            const Type = comptime if (@TypeOf(Fields) != type) @TypeOf(Fields) else Fields;

            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);
                const deref_ = deref;
                const ValueType = if (deref) ContextType else *ContextType;
                fn getValue(socket: *Socket) ValueType {
                    if (comptime ContextType == anyopaque) {
                        return us_socket_ext(ssl_type_int, socket).?;
                    }

                    if (comptime deref_) {
                        return (SocketHandlerType.from(socket)).ext(ContextType).?.*;
                    }

                    return (SocketHandlerType.from(socket)).ext(ContextType);
                }

                pub fn on_open(socket: *Socket, is_client: i32, _: [*c]u8, _: i32) callconv(.C) ?*Socket {
                    if (comptime @hasDecl(Fields, "onCreate")) {
                        if (is_client == 0) {
                            Fields.onCreate(
                                SocketHandlerType.from(socket),
                            );
                        }
                    }
                    Fields.onOpen(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_close(socket: *Socket, code: i32, reason: ?*anyopaque) callconv(.C) ?*Socket {
                    Fields.onClose(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *Socket, buf: ?[*]u8, len: i32) callconv(.C) ?*Socket {
                    Fields.onData(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                        buf.?[0..@as(usize, @intCast(len))],
                    );
                    return socket;
                }
                pub fn on_writable(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onWritable(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onTimeout(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_connect_error_connecting_socket(socket: *ConnectingSocket, code: i32) callconv(.C) ?*ConnectingSocket {
                    const val = if (comptime ContextType == anyopaque)
                        us_connecting_socket_ext(comptime ssl_int, socket)
                    else if (comptime deref_)
                        SocketHandlerType.fromConnecting(socket).ext(ContextType).?.*
                    else
                        SocketHandlerType.fromConnecting(socket).ext(ContextType);
                    Fields.onConnectError(
                        val,
                        SocketHandlerType.fromConnecting(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *Socket, code: i32) callconv(.C) ?*Socket {
                    const val = if (comptime ContextType == anyopaque)
                        us_socket_ext(comptime ssl_int, socket)
                    else if (comptime deref_)
                        SocketHandlerType.from(socket).ext(ContextType).?.*
                    else
                        SocketHandlerType.from(socket).ext(ContextType);
                    Fields.onConnectError(
                        val,
                        SocketHandlerType.from(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onEnd(
                        getValue(socket),
                        SocketHandlerType.from(socket),
                    );
                    return socket;
                }
                pub fn on_handshake(socket: *Socket, success: i32, verify_error: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {
                    Fields.onHandshake(getValue(socket), SocketHandlerType.from(socket), success, verify_error);
                }
            };

            if (comptime @hasDecl(Type, "onOpen") and @typeInfo(@TypeOf(Type.onOpen)) != .Null)
                us_socket_context_on_open(ssl_int, ctx, SocketHandler.on_open);
            if (comptime @hasDecl(Type, "onClose") and @typeInfo(@TypeOf(Type.onClose)) != .Null)
                us_socket_context_on_close(ssl_int, ctx, SocketHandler.on_close);
            if (comptime @hasDecl(Type, "onData") and @typeInfo(@TypeOf(Type.onData)) != .Null)
                us_socket_context_on_data(ssl_int, ctx, SocketHandler.on_data);
            if (comptime @hasDecl(Type, "onWritable") and @typeInfo(@TypeOf(Type.onWritable)) != .Null)
                us_socket_context_on_writable(ssl_int, ctx, SocketHandler.on_writable);
            if (comptime @hasDecl(Type, "onTimeout") and @typeInfo(@TypeOf(Type.onTimeout)) != .Null)
                us_socket_context_on_timeout(ssl_int, ctx, SocketHandler.on_timeout);
            if (comptime @hasDecl(Type, "onConnectError") and @typeInfo(@TypeOf(Type.onConnectError)) != .Null) {
                us_socket_context_on_socket_connect_error(ssl_int, ctx, SocketHandler.on_connect_error);
                us_socket_context_on_connect_error(ssl_int, ctx, SocketHandler.on_connect_error_connecting_socket);
            }
            if (comptime @hasDecl(Type, "onEnd") and @typeInfo(@TypeOf(Type.onEnd)) != .Null)
                us_socket_context_on_end(ssl_int, ctx, SocketHandler.on_end);
            if (comptime @hasDecl(Type, "onHandshake") and @typeInfo(@TypeOf(Type.onHandshake)) != .Null)
                us_socket_context_on_handshake(ssl_int, ctx, SocketHandler.on_handshake, null);
        }

        pub fn configure(
            ctx: *SocketContext,
            comptime deref: bool,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) void {
            const Type = comptime if (@TypeOf(Fields) != type) @TypeOf(Fields) else Fields;

            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);
                const deref_ = deref;
                const ValueType = if (deref) ContextType else *ContextType;
                fn getValue(socket: *Socket) ValueType {
                    if (comptime ContextType == anyopaque) {
                        return us_socket_ext(comptime ssl_int, socket);
                    }

                    if (comptime deref_) {
                        return (ThisSocket.from(socket)).ext(ContextType).?.*;
                    }

                    return (ThisSocket.from(socket)).ext(ContextType);
                }

                pub fn on_open(socket: *Socket, is_client: i32, _: [*c]u8, _: i32) callconv(.C) ?*Socket {
                    if (comptime @hasDecl(Fields, "onCreate")) {
                        if (is_client == 0) {
                            Fields.onCreate(
                                ThisSocket.from(socket),
                            );
                        }
                    }
                    Fields.onOpen(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_close(socket: *Socket, code: i32, reason: ?*anyopaque) callconv(.C) ?*Socket {
                    Fields.onClose(
                        getValue(socket),
                        ThisSocket.from(socket),
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *Socket, buf: ?[*]u8, len: i32) callconv(.C) ?*Socket {
                    Fields.onData(
                        getValue(socket),
                        ThisSocket.from(socket),
                        buf.?[0..@as(usize, @intCast(len))],
                    );
                    return socket;
                }
                pub fn on_writable(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onWritable(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onTimeout(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_long_timeout(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onLongTimeout(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_connect_error_connecting_socket(socket: *ConnectingSocket, code: i32) callconv(.C) ?*ConnectingSocket {
                    const val = if (comptime ContextType == anyopaque)
                        us_connecting_socket_ext(comptime ssl_int, socket)
                    else if (comptime deref_)
                        ThisSocket.fromConnecting(socket).ext(ContextType).?.*
                    else
                        ThisSocket.fromConnecting(socket).ext(ContextType);
                    Fields.onConnectError(
                        val,
                        ThisSocket.fromConnecting(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *Socket, code: i32) callconv(.C) ?*Socket {
                    const val = if (comptime ContextType == anyopaque)
                        us_socket_ext(comptime ssl_int, socket)
                    else if (comptime deref_)
                        ThisSocket.from(socket).ext(ContextType).?.*
                    else
                        ThisSocket.from(socket).ext(ContextType);

                    // We close immediately in this case
                    // uSockets doesn't know if this is a TLS socket or not.
                    // So we need to close it like a TCP socket.
                    NewSocketHandler(false).from(socket).close(.failure);

                    Fields.onConnectError(
                        val,
                        ThisSocket.from(socket),
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onEnd(
                        getValue(socket),
                        ThisSocket.from(socket),
                    );
                    return socket;
                }
                pub fn on_handshake(socket: *Socket, success: i32, verify_error: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {
                    Fields.onHandshake(getValue(socket), ThisSocket.from(socket), success, verify_error);
                }
            };

            if (comptime @hasDecl(Type, "onOpen") and @typeInfo(@TypeOf(Type.onOpen)) != .Null)
                us_socket_context_on_open(ssl_int, ctx, SocketHandler.on_open);
            if (comptime @hasDecl(Type, "onClose") and @typeInfo(@TypeOf(Type.onClose)) != .Null)
                us_socket_context_on_close(ssl_int, ctx, SocketHandler.on_close);
            if (comptime @hasDecl(Type, "onData") and @typeInfo(@TypeOf(Type.onData)) != .Null)
                us_socket_context_on_data(ssl_int, ctx, SocketHandler.on_data);
            if (comptime @hasDecl(Type, "onWritable") and @typeInfo(@TypeOf(Type.onWritable)) != .Null)
                us_socket_context_on_writable(ssl_int, ctx, SocketHandler.on_writable);
            if (comptime @hasDecl(Type, "onTimeout") and @typeInfo(@TypeOf(Type.onTimeout)) != .Null)
                us_socket_context_on_timeout(ssl_int, ctx, SocketHandler.on_timeout);
            if (comptime @hasDecl(Type, "onConnectError") and @typeInfo(@TypeOf(Type.onConnectError)) != .Null) {
                us_socket_context_on_socket_connect_error(ssl_int, ctx, SocketHandler.on_connect_error);
                us_socket_context_on_connect_error(ssl_int, ctx, SocketHandler.on_connect_error_connecting_socket);
            }
            if (comptime @hasDecl(Type, "onEnd") and @typeInfo(@TypeOf(Type.onEnd)) != .Null)
                us_socket_context_on_end(ssl_int, ctx, SocketHandler.on_end);
            if (comptime @hasDecl(Type, "onHandshake") and @typeInfo(@TypeOf(Type.onHandshake)) != .Null)
                us_socket_context_on_handshake(ssl_int, ctx, SocketHandler.on_handshake, null);
            if (comptime @hasDecl(Type, "onLongTimeout") and @typeInfo(@TypeOf(Type.onLongTimeout)) != .Null)
                us_socket_context_on_long_timeout(ssl_int, ctx, SocketHandler.on_long_timeout);
        }

        pub fn from(socket: *Socket) ThisSocket {
            return ThisSocket{ .socket = .{ .connected = socket } };
        }

        pub fn fromConnecting(connecting: *ConnectingSocket) ThisSocket {
            return ThisSocket{ .socket = .{ .connecting = connecting } };
        }

        pub fn fromAny(socket: InternalSocket) ThisSocket {
            return ThisSocket{ .socket = socket };
        }

        pub fn adoptPtr(
            socket: *Socket,
            socket_ctx: *SocketContext,
            comptime Context: type,
            comptime socket_field_name: []const u8,
            ctx: *Context,
        ) bool {
            // ext_size of -1 means we want to keep the current ext size
            // in particular, we don't want to allocate a new socket
            const new_socket = us_socket_context_adopt_socket(comptime ssl_int, socket_ctx, socket, -1) orelse return false;
            bun.assert(new_socket == socket);
            var adopted = ThisSocket.from(new_socket);
            if (adopted.ext(*anyopaque)) |holder| {
                holder.* = ctx;
            }
            @field(ctx, socket_field_name) = adopted;
            return true;
        }
    };
}
pub const SocketTCP = NewSocketHandler(false);
pub const SocketTLS = NewSocketHandler(true);

pub const Timer = opaque {
    pub fn create(loop: *Loop, ptr: anytype) *Timer {
        const Type = @TypeOf(ptr);

        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
        return us_create_timer(loop, 0, @sizeOf(Type)) orelse std.debug.panic("us_create_timer: returned null: {d}", .{std.c._errno().*});
    }

    pub fn createFallthrough(loop: *Loop, ptr: anytype) *Timer {
        const Type = @TypeOf(ptr);

        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
        return us_create_timer(loop, 1, @sizeOf(Type)) orelse std.debug.panic("us_create_timer: returned null: {d}", .{std.c._errno().*});
    }

    pub fn set(this: *Timer, ptr: anytype, cb: ?*const fn (*Timer) callconv(.C) void, ms: i32, repeat_ms: i32) void {
        us_timer_set(this, cb, ms, repeat_ms);
        const value_ptr = us_timer_ext(this);
        @setRuntimeSafety(false);
        @as(*@TypeOf(ptr), @ptrCast(@alignCast(value_ptr))).* = ptr;
    }

    pub fn deinit(this: *Timer, comptime fallthrough: bool) void {
        debug("Timer.deinit()", .{});
        us_timer_close(this, @intFromBool(fallthrough));
    }

    pub fn ext(this: *Timer, comptime Type: type) ?*Type {
        return @as(*Type, @ptrCast(@alignCast(us_timer_ext(this).*.?)));
    }

    pub fn as(this: *Timer, comptime Type: type) Type {
        @setRuntimeSafety(false);
        return @as(*?Type, @ptrCast(@alignCast(us_timer_ext(this)))).*.?;
    }
};

pub const SocketContext = opaque {
    pub fn getNativeHandle(this: *SocketContext, comptime ssl: bool) *anyopaque {
        return us_socket_context_get_native_handle(@intFromBool(ssl), this).?;
    }

    fn _deinit_ssl(this: *SocketContext) void {
        us_socket_context_free(@as(i32, 1), this);
    }

    fn _deinit(this: *SocketContext) void {
        us_socket_context_free(@as(i32, 0), this);
    }

    pub fn ref(this: *SocketContext, comptime ssl: bool) *SocketContext {
        us_socket_context_ref(@intFromBool(ssl), this);
        return this;
    }

    pub fn cleanCallbacks(ctx: *SocketContext, is_ssl: bool) void {
        const ssl_int: i32 = @intFromBool(is_ssl);
        // replace callbacks with dummy ones
        const DummyCallbacks = struct {
            fn open(socket: *Socket, _: i32, _: [*c]u8, _: i32) callconv(.C) ?*Socket {
                return socket;
            }
            fn close(socket: *Socket, _: i32, _: ?*anyopaque) callconv(.C) ?*Socket {
                return socket;
            }
            fn data(socket: *Socket, _: [*c]u8, _: i32) callconv(.C) ?*Socket {
                return socket;
            }
            fn writable(socket: *Socket) callconv(.C) ?*Socket {
                return socket;
            }
            fn timeout(socket: *Socket) callconv(.C) ?*Socket {
                return socket;
            }
            fn connect_error(socket: *ConnectingSocket, _: i32) callconv(.C) ?*ConnectingSocket {
                return socket;
            }
            fn socket_connect_error(socket: *Socket, _: i32) callconv(.C) ?*Socket {
                return socket;
            }
            fn end(socket: *Socket) callconv(.C) ?*Socket {
                return socket;
            }
            fn handshake(_: *Socket, _: i32, _: us_bun_verify_error_t, _: ?*anyopaque) callconv(.C) void {}
            fn long_timeout(socket: *Socket) callconv(.C) ?*Socket {
                return socket;
            }
        };
        us_socket_context_on_open(ssl_int, ctx, DummyCallbacks.open);
        us_socket_context_on_close(ssl_int, ctx, DummyCallbacks.close);
        us_socket_context_on_data(ssl_int, ctx, DummyCallbacks.data);
        us_socket_context_on_writable(ssl_int, ctx, DummyCallbacks.writable);
        us_socket_context_on_timeout(ssl_int, ctx, DummyCallbacks.timeout);
        us_socket_context_on_connect_error(ssl_int, ctx, DummyCallbacks.connect_error);
        us_socket_context_on_socket_connect_error(ssl_int, ctx, DummyCallbacks.socket_connect_error);
        us_socket_context_on_end(ssl_int, ctx, DummyCallbacks.end);
        us_socket_context_on_handshake(ssl_int, ctx, DummyCallbacks.handshake, null);
        us_socket_context_on_long_timeout(ssl_int, ctx, DummyCallbacks.long_timeout);
    }

    fn getLoop(this: *SocketContext, ssl: bool) ?*Loop {
        return us_socket_context_loop(@intFromBool(ssl), this);
    }

    /// closes and deinit the SocketContexts
    pub fn deinit(this: *SocketContext, ssl: bool) void {
        // we clean the callbacks to avoid UAF because we are deiniting
        this.cleanCallbacks(ssl);
        this.close(ssl);
        //always deinit in next iteration
        if (ssl) {
            Loop.get().nextTick(*SocketContext, this, SocketContext._deinit_ssl);
        } else {
            Loop.get().nextTick(*SocketContext, this, SocketContext._deinit);
        }
    }

    pub fn close(this: *SocketContext, ssl: bool) void {
        debug("us_socket_context_close({d})", .{@intFromPtr(this)});
        us_socket_context_close(@intFromBool(ssl), this);
    }

    pub fn ext(this: *SocketContext, ssl: bool, comptime ContextType: type) ?*ContextType {
        const alignment = if (ContextType == *anyopaque)
            @sizeOf(usize)
        else
            std.meta.alignment(ContextType);

        const ptr = us_socket_context_ext(
            @intFromBool(ssl),
            this,
        ) orelse return null;

        return @as(*align(alignment) ContextType, @ptrCast(@alignCast(ptr)));
    }
};
pub const PosixLoop = extern struct {
    internal_loop_data: InternalLoopData align(16),

    /// Number of non-fallthrough polls in the loop
    num_polls: i32,

    /// Number of ready polls this iteration
    num_ready_polls: i32,

    /// Current index in list of ready polls
    current_ready_poll: i32,

    /// Loop's own file descriptor
    fd: i32,

    /// Number of polls owned by Bun
    active: u32 = 0,

    /// The list of ready polls
    ready_polls: [1024]EventType align(16),

    const EventType = switch (Environment.os) {
        .linux => std.os.linux.epoll_event,
        .mac => std.posix.system.kevent64_s,
        // TODO:
        .windows => *anyopaque,
        else => @compileError("Unsupported OS"),
    };

    const log = bun.Output.scoped(.Loop, false);

    pub fn iterationNumber(this: *const PosixLoop) u64 {
        return this.internal_loop_data.iteration_nr;
    }

    pub fn inc(this: *PosixLoop) void {
        this.num_polls += 1;
    }

    pub fn dec(this: *PosixLoop) void {
        this.num_polls -= 1;
    }

    pub fn ref(this: *PosixLoop) void {
        log("ref {d} + 1 = {d}", .{ this.num_polls, this.num_polls + 1 });
        this.num_polls += 1;
        this.active += 1;
    }

    pub fn unref(this: *PosixLoop) void {
        log("unref {d} - 1 = {d}", .{ this.num_polls, this.num_polls - 1 });
        this.num_polls -= 1;
        this.active -|= 1;
    }

    pub fn isActive(this: *const Loop) bool {
        return this.active > 0;
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn addActive(this: *PosixLoop, value: u32) void {
        log("add {d} + {d} = {d}", .{ this.active, value, this.active +| value });
        this.active +|= value;
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn subActive(this: *PosixLoop, value: u32) void {
        log("sub {d} - {d} = {d}", .{ this.active, value, this.active -| value });
        this.active -|= value;
    }

    pub fn unrefCount(this: *PosixLoop, count: i32) void {
        log("unref x {d}", .{count});
        this.num_polls -|= count;
        this.active -|= @as(u32, @intCast(count));
    }

    pub fn get() *Loop {
        return uws_get_loop();
    }

    pub fn create(comptime Handler: anytype) *Loop {
        return us_create_loop(
            null,
            Handler.wakeup,
            if (@hasDecl(Handler, "pre")) Handler.pre else null,
            if (@hasDecl(Handler, "post")) Handler.post else null,
            0,
        ).?;
    }

    pub fn wakeup(this: *PosixLoop) void {
        return us_wakeup_loop(this);
    }

    pub const wake = wakeup;

    pub fn tick(this: *PosixLoop) void {
        us_loop_run_bun_tick(this, null);
    }

    pub fn tickWithoutIdle(this: *PosixLoop) void {
        const timespec = bun.timespec{ .sec = 0, .nsec = 0 };
        us_loop_run_bun_tick(this, &timespec);
    }

    pub fn tickWithTimeout(this: *PosixLoop, timespec: ?*const bun.timespec) void {
        us_loop_run_bun_tick(this, timespec);
    }

    extern fn us_loop_run_bun_tick(loop: ?*Loop, timouetMs: ?*const bun.timespec) void;

    pub fn nextTick(this: *PosixLoop, comptime UserType: type, user_data: UserType, comptime deferCallback: fn (ctx: UserType) void) void {
        const Handler = struct {
            pub fn callback(data: *anyopaque) callconv(.C) void {
                deferCallback(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
        uws_loop_defer(this, user_data, Handler.callback);
    }

    fn NewHandler(comptime UserType: type, comptime callback_fn: fn (UserType) void) type {
        return struct {
            loop: *Loop,
            pub fn removePost(handler: @This()) void {
                return uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn removePre(handler: @This()) void {
                return uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn callback(data: *anyopaque, _: *Loop) callconv(.C) void {
                callback_fn(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
    }

    pub fn addPostHandler(this: *PosixLoop, comptime UserType: type, ctx: UserType, comptime callback: fn (UserType) void) NewHandler(UserType, callback) {
        const Handler = NewHandler(UserType, callback);

        uws_loop_addPostHandler(this, ctx, Handler.callback);
        return Handler{
            .loop = this,
        };
    }

    pub fn addPreHandler(this: *PosixLoop, comptime UserType: type, ctx: UserType, comptime callback: fn (UserType) void) NewHandler(UserType, callback) {
        const Handler = NewHandler(UserType, callback);

        uws_loop_addPreHandler(this, ctx, Handler.callback);
        return Handler{
            .loop = this,
        };
    }

    pub fn run(this: *PosixLoop) void {
        us_loop_run(this);
    }
};

extern fn uws_loop_defer(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque) callconv(.C) void)) void;

extern fn us_create_timer(loop: ?*Loop, fallthrough: i32, ext_size: c_uint) ?*Timer;
extern fn us_timer_ext(timer: ?*Timer) *?*anyopaque;
extern fn us_timer_close(timer: ?*Timer, fallthrough: i32) void;
extern fn us_timer_set(timer: ?*Timer, cb: ?*const fn (*Timer) callconv(.C) void, ms: i32, repeat_ms: i32) void;
extern fn us_timer_loop(t: ?*Timer) ?*Loop;
pub const us_socket_context_options_t = extern struct {
    key_file_name: [*c]const u8 = null,
    cert_file_name: [*c]const u8 = null,
    passphrase: [*c]const u8 = null,
    dh_params_file_name: [*c]const u8 = null,
    ca_file_name: [*c]const u8 = null,
    ssl_ciphers: [*c]const u8 = null,
    ssl_prefer_low_memory_usage: i32 = 0,
};

pub const us_bun_socket_context_options_t = extern struct {
    key_file_name: [*c]const u8 = null,
    cert_file_name: [*c]const u8 = null,
    passphrase: [*c]const u8 = null,
    dh_params_file_name: [*c]const u8 = null,
    ca_file_name: [*c]const u8 = null,
    ssl_ciphers: [*c]const u8 = null,
    ssl_prefer_low_memory_usage: i32 = 0,
    key: ?[*]?[*:0]const u8 = null,
    key_count: u32 = 0,
    cert: ?[*]?[*:0]const u8 = null,
    cert_count: u32 = 0,
    ca: ?[*]?[*:0]const u8 = null,
    ca_count: u32 = 0,
    secure_options: u32 = 0,
    reject_unauthorized: i32 = 0,
    request_cert: i32 = 0,
    client_renegotiation_limit: u32 = 3,
    client_renegotiation_window: u32 = 600,
};
pub extern fn create_ssl_context_from_bun_options(options: us_bun_socket_context_options_t) ?*BoringSSL.SSL_CTX;

pub const create_bun_socket_error_t = enum(i32) {
    none = 0,
    load_ca_file,
    invalid_ca_file,
    invalid_ca,

    pub fn toJS(this: create_bun_socket_error_t, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this) {
            .none => brk: {
                bun.debugAssert(false);
                break :brk .null;
            },
            .load_ca_file => globalObject.ERR_BORINGSSL("Failed to load CA file", .{}).toJS(),
            .invalid_ca_file => globalObject.ERR_BORINGSSL("Invalid CA file", .{}).toJS(),
            .invalid_ca => globalObject.ERR_BORINGSSL("Invalid CA", .{}).toJS(),
        };
    }
};

pub const us_bun_verify_error_t = extern struct {
    error_no: i32 = 0,
    code: [*c]const u8 = null,
    reason: [*c]const u8 = null,

    pub fn toJS(this: *const us_bun_verify_error_t, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        const code = if (this.code == null) "" else this.code[0..bun.len(this.code)];
        const reason = if (this.reason == null) "" else this.reason[0..bun.len(this.reason)];

        const fallback = JSC.SystemError{
            .code = bun.String.createUTF8(code),
            .message = bun.String.createUTF8(reason),
        };

        return fallback.toErrorInstance(globalObject);
    }
};
pub extern fn us_ssl_socket_verify_error_from_ssl(ssl: *BoringSSL.SSL) us_bun_verify_error_t;

pub const us_socket_events_t = extern struct {
    on_open: ?*const fn (*Socket, i32, [*c]u8, i32) callconv(.C) ?*Socket = null,
    on_data: ?*const fn (*Socket, [*c]u8, i32) callconv(.C) ?*Socket = null,
    on_writable: ?*const fn (*Socket) callconv(.C) ?*Socket = null,
    on_close: ?*const fn (*Socket, i32, ?*anyopaque) callconv(.C) ?*Socket = null,

    on_timeout: ?*const fn (*Socket) callconv(.C) ?*Socket = null,
    on_long_timeout: ?*const fn (*Socket) callconv(.C) ?*Socket = null,
    on_end: ?*const fn (*Socket) callconv(.C) ?*Socket = null,
    on_connect_error: ?*const fn (*Socket, i32) callconv(.C) ?*Socket = null,
    on_connect_error_connecting_socket: ?*const fn (*ConnectingSocket, i32) callconv(.C) ?*ConnectingSocket = null,
    on_handshake: ?*const fn (*Socket, i32, us_bun_verify_error_t, ?*anyopaque) callconv(.C) void = null,
};

pub extern fn us_socket_wrap_with_tls(ssl: i32, s: *Socket, options: us_bun_socket_context_options_t, events: us_socket_events_t, socket_ext_size: i32) ?*Socket;
extern fn us_socket_verify_error(ssl: i32, context: *Socket) us_bun_verify_error_t;
extern fn SocketContextimestamp(ssl: i32, context: ?*SocketContext) c_ushort;
pub extern fn us_socket_context_add_server_name(ssl: i32, context: ?*SocketContext, hostname_pattern: [*c]const u8, options: us_socket_context_options_t, ?*anyopaque) void;
pub extern fn us_socket_context_remove_server_name(ssl: i32, context: ?*SocketContext, hostname_pattern: [*c]const u8) void;
extern fn us_socket_context_on_server_name(ssl: i32, context: ?*SocketContext, cb: ?*const fn (?*SocketContext, [*c]const u8) callconv(.C) void) void;
extern fn us_socket_context_get_native_handle(ssl: i32, context: ?*SocketContext) ?*anyopaque;
pub extern fn us_create_socket_context(ssl: i32, loop: ?*Loop, ext_size: i32, options: us_socket_context_options_t) ?*SocketContext;
pub extern fn us_create_bun_socket_context(ssl: i32, loop: ?*Loop, ext_size: i32, options: us_bun_socket_context_options_t, err: *create_bun_socket_error_t) ?*SocketContext;
pub extern fn us_bun_socket_context_add_server_name(ssl: i32, context: ?*SocketContext, hostname_pattern: [*c]const u8, options: us_bun_socket_context_options_t, ?*anyopaque) void;
pub extern fn us_socket_context_free(ssl: i32, context: ?*SocketContext) void;
pub extern fn us_socket_context_ref(ssl: i32, context: ?*SocketContext) void;
pub extern fn us_socket_context_unref(ssl: i32, context: ?*SocketContext) void;
extern fn us_socket_context_on_open(ssl: i32, context: ?*SocketContext, on_open: *const fn (*Socket, i32, [*c]u8, i32) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_close(ssl: i32, context: ?*SocketContext, on_close: *const fn (*Socket, i32, ?*anyopaque) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_data(ssl: i32, context: ?*SocketContext, on_data: *const fn (*Socket, [*c]u8, i32) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_writable(ssl: i32, context: ?*SocketContext, on_writable: *const fn (*Socket) callconv(.C) ?*Socket) void;

extern fn us_socket_context_on_handshake(ssl: i32, context: ?*SocketContext, on_handshake: *const fn (*Socket, i32, us_bun_verify_error_t, ?*anyopaque) callconv(.C) void, ?*anyopaque) void;

extern fn us_socket_context_on_timeout(ssl: i32, context: ?*SocketContext, on_timeout: *const fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_long_timeout(ssl: i32, context: ?*SocketContext, on_timeout: *const fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_connect_error(ssl: i32, context: ?*SocketContext, on_connect_error: *const fn (*ConnectingSocket, i32) callconv(.C) ?*ConnectingSocket) void;
extern fn us_socket_context_on_socket_connect_error(ssl: i32, context: ?*SocketContext, on_connect_error: *const fn (*Socket, i32) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_end(ssl: i32, context: ?*SocketContext, on_end: *const fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_ext(ssl: i32, context: ?*SocketContext) ?*anyopaque;

pub extern fn us_socket_context_listen(ssl: i32, context: ?*SocketContext, host: ?[*:0]const u8, port: i32, options: i32, socket_ext_size: i32, err: *c_int) ?*ListenSocket;
pub extern fn us_socket_context_listen_unix(ssl: i32, context: ?*SocketContext, path: [*:0]const u8, pathlen: usize, options: i32, socket_ext_size: i32, err: *c_int) ?*ListenSocket;
pub extern fn us_socket_context_connect(ssl: i32, context: ?*SocketContext, host: [*:0]const u8, port: i32, options: i32, socket_ext_size: i32, has_dns_resolved: *i32) ?*anyopaque;
pub extern fn us_socket_context_connect_unix(ssl: i32, context: ?*SocketContext, path: [*c]const u8, pathlen: usize, options: i32, socket_ext_size: i32) ?*Socket;
pub extern fn us_socket_is_established(ssl: i32, s: ?*Socket) i32;
pub extern fn us_socket_context_loop(ssl: i32, context: ?*SocketContext) ?*Loop;
pub extern fn us_socket_context_adopt_socket(ssl: i32, context: ?*SocketContext, s: ?*Socket, ext_size: i32) ?*Socket;
pub extern fn us_create_child_socket_context(ssl: i32, context: ?*SocketContext, context_ext_size: i32) ?*SocketContext;

pub const Poll = opaque {
    pub fn create(
        loop: *Loop,
        comptime Data: type,
        file: i32,
        val: Data,
        fallthrough: bool,
        flags: Flags,
    ) ?*Poll {
        var poll = us_create_poll(loop, @as(i32, @intFromBool(fallthrough)), @sizeOf(Data));
        if (comptime Data != void) {
            poll.data(Data).* = val;
        }
        var flags_int: i32 = 0;
        if (flags.read) {
            flags_int |= Flags.read_flag;
        }

        if (flags.write) {
            flags_int |= Flags.write_flag;
        }
        us_poll_init(poll, file, flags_int);
        return poll;
    }

    pub fn stop(self: *Poll, loop: *Loop) void {
        us_poll_stop(self, loop);
    }

    pub fn change(self: *Poll, loop: *Loop, events: i32) void {
        us_poll_change(self, loop, events);
    }

    pub fn getEvents(self: *Poll) i32 {
        return us_poll_events(self);
    }

    pub fn data(self: *Poll, comptime Data: type) *Data {
        return us_poll_ext(self).?;
    }

    pub fn fd(self: *Poll) std.posix.fd_t {
        return us_poll_fd(self);
    }

    pub fn start(self: *Poll, loop: *Loop, flags: Flags) void {
        var flags_int: i32 = 0;
        if (flags.read) {
            flags_int |= Flags.read_flag;
        }

        if (flags.write) {
            flags_int |= Flags.write_flag;
        }

        us_poll_start(self, loop, flags_int);
    }

    pub const Flags = struct {
        read: bool = false,
        write: bool = false,

        //#define LIBUS_SOCKET_READABLE
        pub const read_flag = if (Environment.isLinux) std.os.linux.EPOLL.IN else 1;
        // #define LIBUS_SOCKET_WRITABLE
        pub const write_flag = if (Environment.isLinux) std.os.linux.EPOLL.OUT else 2;
    };

    pub fn deinit(self: *Poll, loop: *Loop) void {
        us_poll_free(self, loop);
    }

    // (void* userData, int fd, int events, int error, struct us_poll_t *poll)
    pub const CallbackType = *const fn (?*anyopaque, i32, i32, i32, *Poll) callconv(.C) void;
    extern fn us_create_poll(loop: ?*Loop, fallthrough: i32, ext_size: c_uint) *Poll;
    extern fn us_poll_set(poll: *Poll, events: i32, callback: CallbackType) *Poll;
    extern fn us_poll_free(p: ?*Poll, loop: ?*Loop) void;
    extern fn us_poll_init(p: ?*Poll, fd: i32, poll_type: i32) void;
    extern fn us_poll_start(p: ?*Poll, loop: ?*Loop, events: i32) void;
    extern fn us_poll_change(p: ?*Poll, loop: ?*Loop, events: i32) void;
    extern fn us_poll_stop(p: ?*Poll, loop: ?*Loop) void;
    extern fn us_poll_events(p: ?*Poll) i32;
    extern fn us_poll_ext(p: ?*Poll) ?*anyopaque;
    extern fn us_poll_fd(p: ?*Poll) std.posix.fd_t;
    extern fn us_poll_resize(p: ?*Poll, loop: ?*Loop, ext_size: c_uint) ?*Poll;
};

extern fn us_socket_get_native_handle(ssl: i32, s: ?*Socket) ?*anyopaque;
extern fn us_connecting_socket_get_native_handle(ssl: i32, s: ?*ConnectingSocket) ?*anyopaque;

extern fn us_socket_timeout(ssl: i32, s: ?*Socket, seconds: c_uint) void;
extern fn us_socket_long_timeout(ssl: i32, s: ?*Socket, seconds: c_uint) void;
extern fn us_socket_ext(ssl: i32, s: ?*Socket) *anyopaque;
extern fn us_socket_context(ssl: i32, s: ?*Socket) ?*SocketContext;
extern fn us_socket_flush(ssl: i32, s: ?*Socket) void;
extern fn us_socket_write(ssl: i32, s: ?*Socket, data: [*c]const u8, length: i32, msg_more: i32) i32;
extern fn us_socket_raw_write(ssl: i32, s: ?*Socket, data: [*c]const u8, length: i32, msg_more: i32) i32;
extern fn us_socket_shutdown(ssl: i32, s: ?*Socket) void;
extern fn us_socket_shutdown_read(ssl: i32, s: ?*Socket) void;
extern fn us_socket_is_shut_down(ssl: i32, s: ?*Socket) i32;
extern fn us_socket_is_closed(ssl: i32, s: ?*Socket) i32;
extern fn us_socket_close(ssl: i32, s: ?*Socket, code: CloseCode, reason: ?*anyopaque) ?*Socket;

extern fn us_socket_nodelay(s: ?*Socket, enable: c_int) void;
extern fn us_socket_keepalive(s: ?*Socket, enable: c_int, delay: c_uint) c_int;
extern fn us_socket_pause(ssl: i32, s: ?*Socket) void;
extern fn us_socket_resume(ssl: i32, s: ?*Socket) void;

extern fn us_connecting_socket_timeout(ssl: i32, s: ?*ConnectingSocket, seconds: c_uint) void;
extern fn us_connecting_socket_long_timeout(ssl: i32, s: ?*ConnectingSocket, seconds: c_uint) void;
extern fn us_connecting_socket_ext(ssl: i32, s: ?*ConnectingSocket) *anyopaque;
extern fn us_connecting_socket_context(ssl: i32, s: ?*ConnectingSocket) ?*SocketContext;
extern fn us_connecting_socket_shutdown(ssl: i32, s: ?*ConnectingSocket) void;
extern fn us_connecting_socket_is_closed(ssl: i32, s: ?*ConnectingSocket) i32;
extern fn us_connecting_socket_close(ssl: i32, s: ?*ConnectingSocket) void;
extern fn us_connecting_socket_shutdown_read(ssl: i32, s: ?*ConnectingSocket) void;
extern fn us_connecting_socket_is_shut_down(ssl: i32, s: ?*ConnectingSocket) i32;
extern fn us_connecting_socket_get_error(ssl: i32, s: ?*ConnectingSocket) i32;

pub extern fn us_connecting_socket_get_loop(s: *ConnectingSocket) *Loop;

// if a TLS socket calls this, it will start SSL instance and call open event will also do TLS handshake if required
// will have no effect if the socket is closed or is not TLS
extern fn us_socket_open(ssl: i32, s: ?*Socket, is_client: i32, ip: [*c]const u8, ip_length: i32) ?*Socket;

extern fn us_socket_local_port(ssl: i32, s: ?*Socket) i32;
extern fn us_socket_remote_address(ssl: i32, s: ?*Socket, buf: [*c]u8, length: [*c]i32) void;
extern fn us_socket_local_address(ssl: i32, s: ?*Socket, buf: [*c]u8, length: [*c]i32) void;
pub const uws_app_s = opaque {};
pub const uws_req_s = opaque {};
pub const uws_header_iterator_s = opaque {};
pub const uws_app_t = uws_app_s;

pub const uws_socket_context_s = opaque {};
pub const uws_socket_context_t = uws_socket_context_s;
pub const AnyWebSocket = union(enum) {
    ssl: *NewApp(true).WebSocket,
    tcp: *NewApp(false).WebSocket,

    pub fn raw(this: AnyWebSocket) *RawWebSocket {
        return switch (this) {
            .ssl => this.ssl.raw(),
            .tcp => this.tcp.raw(),
        };
    }
    pub fn as(this: AnyWebSocket, comptime Type: type) ?*Type {
        @setRuntimeSafety(false);
        return switch (this) {
            .ssl => this.ssl.as(Type),
            .tcp => this.tcp.as(Type),
        };
    }

    pub fn memoryCost(this: AnyWebSocket) usize {
        return switch (this) {
            .ssl => this.ssl.memoryCost(),
            .tcp => this.tcp.memoryCost(),
        };
    }

    pub fn close(this: AnyWebSocket) void {
        const ssl_flag = @intFromBool(this == .ssl);
        return uws_ws_close(ssl_flag, this.raw());
    }

    pub fn send(this: AnyWebSocket, message: []const u8, opcode: Opcode, compress: bool, fin: bool) SendStatus {
        return switch (this) {
            .ssl => uws_ws_send_with_options(1, this.ssl.raw(), message.ptr, message.len, opcode, compress, fin),
            .tcp => uws_ws_send_with_options(0, this.tcp.raw(), message.ptr, message.len, opcode, compress, fin),
        };
    }
    pub fn sendLastFragment(this: AnyWebSocket, message: []const u8, compress: bool) SendStatus {
        switch (this) {
            .tcp => return uws_ws_send_last_fragment(0, this.raw(), message.ptr, message.len, compress),
            .ssl => return uws_ws_send_last_fragment(1, this.raw(), message.ptr, message.len, compress),
        }
    }
    pub fn end(this: AnyWebSocket, code: i32, message: []const u8) void {
        switch (this) {
            .tcp => uws_ws_end(0, this.tcp.raw(), code, message.ptr, message.len),
            .ssl => uws_ws_end(1, this.ssl.raw(), code, message.ptr, message.len),
        }
    }
    pub fn cork(this: AnyWebSocket, ctx: anytype, comptime callback: anytype) void {
        const ContextType = @TypeOf(ctx);
        const Wrapper = struct {
            pub fn wrap(user_data: ?*anyopaque) callconv(.C) void {
                @call(bun.callmod_inline, callback, .{bun.cast(ContextType, user_data.?)});
            }
        };

        switch (this) {
            .ssl => uws_ws_cork(1, this.raw(), Wrapper.wrap, ctx),
            .tcp => uws_ws_cork(0, this.raw(), Wrapper.wrap, ctx),
        }
    }
    pub fn subscribe(this: AnyWebSocket, topic: []const u8) bool {
        return switch (this) {
            .ssl => uws_ws_subscribe(1, this.ssl.raw(), topic.ptr, topic.len),
            .tcp => uws_ws_subscribe(0, this.tcp.raw(), topic.ptr, topic.len),
        };
    }
    pub fn unsubscribe(this: AnyWebSocket, topic: []const u8) bool {
        return switch (this) {
            .ssl => uws_ws_unsubscribe(1, this.raw(), topic.ptr, topic.len),
            .tcp => uws_ws_unsubscribe(0, this.raw(), topic.ptr, topic.len),
        };
    }
    pub fn isSubscribed(this: AnyWebSocket, topic: []const u8) bool {
        return switch (this) {
            .ssl => uws_ws_is_subscribed(1, this.raw(), topic.ptr, topic.len),
            .tcp => uws_ws_is_subscribed(0, this.raw(), topic.ptr, topic.len),
        };
    }
    // pub fn iterateTopics(this: AnyWebSocket) {
    //     return uws_ws_iterate_topics(ssl_flag, this.raw(), callback: ?*const fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
    // }
    pub fn publish(this: AnyWebSocket, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
        return switch (this) {
            .ssl => uws_ws_publish_with_options(1, this.ssl.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress),
            .tcp => uws_ws_publish_with_options(0, this.tcp.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress),
        };
    }
    pub fn publishWithOptions(ssl: bool, app: *anyopaque, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
        return uws_publish(
            @intFromBool(ssl),
            @as(*uws_app_t, @ptrCast(app)),
            topic.ptr,
            topic.len,
            message.ptr,
            message.len,
            opcode,
            compress,
        );
    }
    pub fn getBufferedAmount(this: AnyWebSocket) u32 {
        return switch (this) {
            .ssl => uws_ws_get_buffered_amount(1, this.ssl.raw()),
            .tcp => uws_ws_get_buffered_amount(0, this.tcp.raw()),
        };
    }

    pub fn getRemoteAddress(this: AnyWebSocket, buf: []u8) []u8 {
        return switch (this) {
            .ssl => this.ssl.getRemoteAddress(buf),
            .tcp => this.tcp.getRemoteAddress(buf),
        };
    }
};

pub const RawWebSocket = opaque {
    pub fn memoryCost(this: *RawWebSocket, ssl_flag: i32) usize {
        return uws_ws_memory_cost(ssl_flag, this);
    }

    extern fn uws_ws_memory_cost(ssl: i32, ws: *RawWebSocket) usize;
};

pub const uws_websocket_handler = ?*const fn (*RawWebSocket) callconv(.C) void;
pub const uws_websocket_message_handler = ?*const fn (*RawWebSocket, [*c]const u8, usize, Opcode) callconv(.C) void;
pub const uws_websocket_close_handler = ?*const fn (*RawWebSocket, i32, [*c]const u8, usize) callconv(.C) void;
pub const uws_websocket_upgrade_handler = ?*const fn (*anyopaque, *uws_res, *Request, *uws_socket_context_t, usize) callconv(.C) void;

pub const uws_websocket_ping_pong_handler = ?*const fn (*RawWebSocket, [*c]const u8, usize) callconv(.C) void;

pub const WebSocketBehavior = extern struct {
    compression: uws_compress_options_t = 0,
    maxPayloadLength: c_uint = std.math.maxInt(u32),
    idleTimeout: c_ushort = 120,
    maxBackpressure: c_uint = 1024 * 1024,
    closeOnBackpressureLimit: bool = false,
    resetIdleTimeoutOnSend: bool = true,
    sendPingsAutomatically: bool = true,
    maxLifetime: c_ushort = 0,
    upgrade: uws_websocket_upgrade_handler = null,
    open: uws_websocket_handler = null,
    message: uws_websocket_message_handler = null,
    drain: uws_websocket_handler = null,
    ping: uws_websocket_ping_pong_handler = null,
    pong: uws_websocket_ping_pong_handler = null,
    close: uws_websocket_close_handler = null,

    pub fn Wrap(
        comptime ServerType: type,
        comptime Type: type,
        comptime ssl: bool,
    ) type {
        return extern struct {
            const is_ssl = ssl;
            const WebSocket = NewApp(is_ssl).WebSocket;
            const Server = ServerType;

            const active_field_name = if (is_ssl) "ssl" else "tcp";

            pub fn onOpen(raw_ws: *RawWebSocket) callconv(.C) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onOpen, .{
                    this,
                    ws,
                });
            }

            pub fn onMessage(raw_ws: *RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode) callconv(.C) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(.always_inline, Type.onMessage, .{
                    this,
                    ws,
                    if (length > 0) message[0..length] else "",
                    opcode,
                });
            }

            pub fn onDrain(raw_ws: *RawWebSocket) callconv(.C) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onDrain, .{
                    this,
                    ws,
                });
            }

            pub fn onPing(raw_ws: *RawWebSocket, message: [*c]const u8, length: usize) callconv(.C) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onPing, .{
                    this,
                    ws,
                    if (length > 0) message[0..length] else "",
                });
            }

            pub fn onPong(raw_ws: *RawWebSocket, message: [*c]const u8, length: usize) callconv(.C) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onPong, .{
                    this,
                    ws,
                    if (length > 0) message[0..length] else "",
                });
            }

            pub fn onClose(raw_ws: *RawWebSocket, code: i32, message: [*c]const u8, length: usize) callconv(.C) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(.always_inline, Type.onClose, .{
                    this,
                    ws,
                    code,
                    if (length > 0 and message != null) message[0..length] else "",
                });
            }

            pub fn onUpgrade(ptr: *anyopaque, res: *uws_res, req: *Request, context: *uws_socket_context_t, id: usize) callconv(.C) void {
                @call(.always_inline, Server.onWebSocketUpgrade, .{
                    bun.cast(*Server, ptr),
                    @as(*NewApp(is_ssl).Response, @ptrCast(res)),
                    req,
                    context,
                    id,
                });
            }

            pub fn apply(behavior: WebSocketBehavior) WebSocketBehavior {
                return .{
                    .compression = behavior.compression,
                    .maxPayloadLength = behavior.maxPayloadLength,
                    .idleTimeout = behavior.idleTimeout,
                    .maxBackpressure = behavior.maxBackpressure,
                    .closeOnBackpressureLimit = behavior.closeOnBackpressureLimit,
                    .resetIdleTimeoutOnSend = behavior.resetIdleTimeoutOnSend,
                    .sendPingsAutomatically = behavior.sendPingsAutomatically,
                    .maxLifetime = behavior.maxLifetime,
                    .upgrade = onUpgrade,
                    .open = onOpen,
                    .message = if (@hasDecl(Type, "onMessage")) onMessage else null,
                    .drain = if (@hasDecl(Type, "onDrain")) onDrain else null,
                    .ping = if (@hasDecl(Type, "onPing")) onPing else null,
                    .pong = if (@hasDecl(Type, "onPong")) onPong else null,
                    .close = onClose,
                };
            }
        };
    }
};
pub const uws_listen_handler = ?*const fn (?*ListenSocket, ?*anyopaque) callconv(.C) void;
pub const uws_method_handler = ?*const fn (*uws_res, *Request, ?*anyopaque) callconv(.C) void;
pub const uws_filter_handler = ?*const fn (*uws_res, i32, ?*anyopaque) callconv(.C) void;
pub const uws_missing_server_handler = ?*const fn ([*c]const u8, ?*anyopaque) callconv(.C) void;

pub const Request = opaque {
    pub fn isAncient(req: *Request) bool {
        return uws_req_is_ancient(req);
    }
    pub fn getYield(req: *Request) bool {
        return uws_req_get_yield(req);
    }
    pub fn setYield(req: *Request, yield: bool) void {
        uws_req_set_yield(req, yield);
    }
    pub fn url(req: *Request) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..req.uws_req_get_url(&ptr)];
    }
    pub fn method(req: *Request) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..req.uws_req_get_method(&ptr)];
    }
    pub fn header(req: *Request, name: []const u8) ?[]const u8 {
        bun.assert(std.ascii.isLower(name[0]));

        var ptr: [*]const u8 = undefined;
        const len = req.uws_req_get_header(name.ptr, name.len, &ptr);
        if (len == 0) return null;
        return ptr[0..len];
    }
    pub fn query(req: *Request, name: []const u8) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..req.uws_req_get_query(name.ptr, name.len, &ptr)];
    }
    pub fn parameter(req: *Request, index: u16) []const u8 {
        var ptr: [*]const u8 = undefined;
        return ptr[0..req.uws_req_get_parameter(@as(c_ushort, @intCast(index)), &ptr)];
    }

    extern fn uws_req_is_ancient(res: *Request) bool;
    extern fn uws_req_get_yield(res: *Request) bool;
    extern fn uws_req_set_yield(res: *Request, yield: bool) void;
    extern fn uws_req_get_url(res: *Request, dest: *[*]const u8) usize;
    extern fn uws_req_get_method(res: *Request, dest: *[*]const u8) usize;
    extern fn uws_req_get_header(res: *Request, lower_case_header: [*]const u8, lower_case_header_length: usize, dest: *[*]const u8) usize;
    extern fn uws_req_get_query(res: *Request, key: [*c]const u8, key_length: usize, dest: *[*]const u8) usize;
    extern fn uws_req_get_parameter(res: *Request, index: c_ushort, dest: *[*]const u8) usize;
};

pub const ListenSocket = opaque {
    pub fn close(this: *ListenSocket, ssl: bool) void {
        us_listen_socket_close(@intFromBool(ssl), this);
    }
    pub fn getLocalPort(this: *ListenSocket, ssl: bool) i32 {
        return us_socket_local_port(@intFromBool(ssl), @as(*uws.Socket, @ptrCast(this)));
    }
};
extern fn us_listen_socket_close(ssl: i32, ls: *ListenSocket) void;
extern fn uws_app_close(ssl: i32, app: *uws_app_s) void;
extern fn us_socket_context_close(ssl: i32, ctx: *anyopaque) void;

pub const SocketAddress = struct {
    ip: []const u8,
    port: i32,
    is_ipv6: bool,
};

pub const AnyResponse = union(enum) {
    SSL: *NewApp(true).Response,
    TCP: *NewApp(false).Response,

    pub fn init(response: anytype) AnyResponse {
        return switch (@TypeOf(response)) {
            *NewApp(true).Response => .{ .SSL = response },
            *NewApp(false).Response => .{ .TCP = response },
            else => @compileError(unreachable),
        };
    }

    pub fn timeout(this: AnyResponse, seconds: u8) void {
        switch (this) {
            .SSL => |resp| resp.timeout(seconds),
            .TCP => |resp| resp.timeout(seconds),
        }
    }

    pub fn writeStatus(this: AnyResponse, status: []const u8) void {
        return switch (this) {
            .SSL => |resp| resp.writeStatus(status),
            .TCP => |resp| resp.writeStatus(status),
        };
    }

    pub fn writeHeader(this: AnyResponse, key: []const u8, value: []const u8) void {
        return switch (this) {
            .SSL => |resp| resp.writeHeader(key, value),
            .TCP => |resp| resp.writeHeader(key, value),
        };
    }

    pub fn write(this: AnyResponse, data: []const u8) void {
        return switch (this) {
            .SSL => |resp| resp.write(data),
            .TCP => |resp| resp.write(data),
        };
    }

    pub fn end(this: AnyResponse, data: []const u8, close_connection: bool) void {
        return switch (this) {
            .SSL => |resp| resp.end(data, close_connection),
            .TCP => |resp| resp.end(data, close_connection),
        };
    }

    pub fn shouldCloseConnection(this: AnyResponse) bool {
        return switch (this) {
            .SSL => |resp| resp.shouldCloseConnection(),
            .TCP => |resp| resp.shouldCloseConnection(),
        };
    }

    pub fn tryEnd(this: AnyResponse, data: []const u8, total_size: usize, close_connection: bool) bool {
        return switch (this) {
            .SSL => |resp| resp.tryEnd(data, total_size, close_connection),
            .TCP => |resp| resp.tryEnd(data, total_size, close_connection),
        };
    }

    pub fn pause(this: AnyResponse) void {
        return switch (this) {
            .SSL => |resp| resp.pause(),
            .TCP => |resp| resp.pause(),
        };
    }

    pub fn @"resume"(this: AnyResponse) void {
        return switch (this) {
            .SSL => |resp| resp.@"resume"(),
            .TCP => |resp| resp.@"resume"(),
        };
    }

    pub fn writeHeaderInt(this: AnyResponse, key: []const u8, value: u64) void {
        return switch (this) {
            .SSL => |resp| resp.writeHeaderInt(key, value),
            .TCP => |resp| resp.writeHeaderInt(key, value),
        };
    }

    pub fn endWithoutBody(this: AnyResponse, close_connection: bool) void {
        return switch (this) {
            .SSL => |resp| resp.endWithoutBody(close_connection),
            .TCP => |resp| resp.endWithoutBody(close_connection),
        };
    }

    pub fn onWritable(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType, u64, AnyResponse) bool, opcional_data: UserDataType) void {
        const wrapper = struct {
            pub fn ssl_handler(user_data: UserDataType, offset: u64, resp: *NewApp(true).Response) bool {
                return handler(user_data, offset, .{ .SSL = resp });
            }

            pub fn tcp_handler(user_data: UserDataType, offset: u64, resp: *NewApp(false).Response) bool {
                return handler(user_data, offset, .{ .TCP = resp });
            }
        };
        return switch (this) {
            .SSL => |resp| resp.onWritable(UserDataType, wrapper.ssl_handler, opcional_data),
            .TCP => |resp| resp.onWritable(UserDataType, wrapper.tcp_handler, opcional_data),
        };
    }

    pub fn onAborted(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType, AnyResponse) void, opcional_data: UserDataType) void {
        const wrapper = struct {
            pub fn ssl_handler(user_data: UserDataType, resp: *NewApp(true).Response) void {
                handler(user_data, .{ .SSL = resp });
            }
            pub fn tcp_handler(user_data: UserDataType, resp: *NewApp(false).Response) void {
                handler(user_data, .{ .TCP = resp });
            }
        };
        return switch (this) {
            .SSL => |resp| resp.onAborted(UserDataType, wrapper.ssl_handler, opcional_data),
            .TCP => |resp| resp.onAborted(UserDataType, wrapper.tcp_handler, opcional_data),
        };
    }

    pub fn clearAborted(this: AnyResponse) void {
        return switch (this) {
            .SSL => |resp| resp.clearAborted(),
            .TCP => |resp| resp.clearAborted(),
        };
    }
    pub fn clearTimeout(this: AnyResponse) void {
        return switch (this) {
            .SSL => |resp| resp.clearTimeout(),
            .TCP => |resp| resp.clearTimeout(),
        };
    }

    pub fn clearOnWritable(this: AnyResponse) void {
        return switch (this) {
            .SSL => |resp| resp.clearOnWritable(),
            .TCP => |resp| resp.clearOnWritable(),
        };
    }

    pub fn clearOnData(this: AnyResponse) void {
        return switch (this) {
            .SSL => |resp| resp.clearOnData(),
            .TCP => |resp| resp.clearOnData(),
        };
    }

    pub fn endStream(this: AnyResponse, close_connection: bool) void {
        return switch (this) {
            .SSL => |resp| resp.endStream(close_connection),
            .TCP => |resp| resp.endStream(close_connection),
        };
    }

    pub fn corked(this: AnyResponse, comptime handler: anytype, args_tuple: anytype) void {
        return switch (this) {
            .SSL => |resp| resp.corked(handler, args_tuple),
            .TCP => |resp| resp.corked(handler, args_tuple),
        };
    }

    pub fn runCorkedWithType(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType) void, opcional_data: UserDataType) void {
        return switch (this) {
            .SSL => |resp| resp.runCorkedWithType(UserDataType, handler, opcional_data),
            .TCP => |resp| resp.runCorkedWithType(UserDataType, handler, opcional_data),
        };
    }
};
pub fn NewApp(comptime ssl: bool) type {
    return opaque {
        const ssl_flag = @as(i32, @intFromBool(ssl));
        const ThisApp = @This();

        pub fn close(this: *ThisApp) void {
            return uws_app_close(ssl_flag, @as(*uws_app_s, @ptrCast(this)));
        }

        pub fn create(opts: us_bun_socket_context_options_t) ?*ThisApp {
            return @ptrCast(uws_create_app(ssl_flag, opts));
        }
        pub fn destroy(app: *ThisApp) void {
            return uws_app_destroy(ssl_flag, @as(*uws_app_s, @ptrCast(app)));
        }

        pub fn clearRoutes(app: *ThisApp) void {
            if (comptime is_bindgen) {
                unreachable;
            }

            return uws_app_clear_routes(ssl_flag, @as(*uws_app_t, @ptrCast(app)));
        }

        fn RouteHandler(comptime UserDataType: type, comptime handler: fn (UserDataType, *Request, *Response) void) type {
            return struct {
                pub fn handle(res: *uws_res, req: *Request, user_data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserDataType == void) {
                        return @call(
                            .always_inline,
                            handler,
                            .{
                                {},
                                req,
                                @as(*Response, @ptrCast(@alignCast(res))),
                            },
                        );
                    } else {
                        return @call(
                            .always_inline,
                            handler,
                            .{
                                @as(UserDataType, @ptrCast(@alignCast(user_data.?))),
                                req,
                                @as(*Response, @ptrCast(@alignCast(res))),
                            },
                        );
                    }
                }
            };
        }

        pub const ListenSocket = opaque {
            pub inline fn close(this: *ThisApp.ListenSocket) void {
                return us_listen_socket_close(ssl_flag, @as(*uws.ListenSocket, @ptrCast(this)));
            }
            pub inline fn getLocalPort(this: *ThisApp.ListenSocket) i32 {
                return us_socket_local_port(ssl_flag, @as(*uws.Socket, @ptrCast(this)));
            }

            pub fn socket(this: *@This()) NewSocketHandler(ssl) {
                return NewSocketHandler(ssl).from(@ptrCast(this));
            }
        };

        pub fn get(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_get(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn post(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_post(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn options(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_options(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn delete(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_delete(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn patch(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_patch(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn put(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_put(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn head(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_head(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn connect(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_connect(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn trace(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_trace(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn any(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_any(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn domain(app: *ThisApp, pattern: [:0]const u8) void {
            uws_app_domain(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern);
        }
        pub fn run(app: *ThisApp) void {
            return uws_app_run(ssl_flag, @as(*uws_app_t, @ptrCast(app)));
        }
        pub fn listen(
            app: *ThisApp,
            port: i32,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ThisApp.ListenSocket, uws_app_listen_config_t) void,
        ) void {
            const Wrapper = struct {
                pub fn handle(socket: ?*uws.ListenSocket, conf: uws_app_listen_config_t, data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserData == void) {
                        @call(bun.callmod_inline, handler, .{ {}, @as(?*ThisApp.ListenSocket, @ptrCast(socket)), conf });
                    } else {
                        @call(bun.callmod_inline, handler, .{
                            @as(UserData, @ptrCast(@alignCast(data.?))),
                            @as(?*ThisApp.ListenSocket, @ptrCast(socket)),
                            conf,
                        });
                    }
                }
            };
            return uws_app_listen(ssl_flag, @as(*uws_app_t, @ptrCast(app)), port, Wrapper.handle, user_data);
        }

        pub fn listenWithConfig(
            app: *ThisApp,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ThisApp.ListenSocket) void,
            config: uws_app_listen_config_t,
        ) void {
            const Wrapper = struct {
                pub fn handle(socket: ?*uws.ListenSocket, data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserData == void) {
                        @call(bun.callmod_inline, handler, .{ {}, @as(?*ThisApp.ListenSocket, @ptrCast(socket)) });
                    } else {
                        @call(bun.callmod_inline, handler, .{
                            @as(UserData, @ptrCast(@alignCast(data.?))),
                            @as(?*ThisApp.ListenSocket, @ptrCast(socket)),
                        });
                    }
                }
            };
            return uws_app_listen_with_config(ssl_flag, @as(*uws_app_t, @ptrCast(app)), config.host, @as(u16, @intCast(config.port)), config.options, Wrapper.handle, user_data);
        }

        pub fn listenOnUnixSocket(
            app: *ThisApp,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ThisApp.ListenSocket) void,
            domain_name: [:0]const u8,
            flags: i32,
        ) void {
            const Wrapper = struct {
                pub fn handle(socket: ?*uws.ListenSocket, _: [*:0]const u8, _: i32, data: *anyopaque) callconv(.C) void {
                    if (comptime UserData == void) {
                        @call(bun.callmod_inline, handler, .{ {}, @as(?*ThisApp.ListenSocket, @ptrCast(socket)) });
                    } else {
                        @call(bun.callmod_inline, handler, .{
                            @as(UserData, @ptrCast(@alignCast(data))),
                            @as(?*ThisApp.ListenSocket, @ptrCast(socket)),
                        });
                    }
                }
            };
            return uws_app_listen_domain_with_options(
                ssl_flag,
                @as(*uws_app_t, @ptrCast(app)),
                domain_name.ptr,
                domain_name.len,
                flags,
                Wrapper.handle,
                user_data,
            );
        }

        pub fn constructorFailed(app: *ThisApp) bool {
            return uws_constructor_failed(ssl_flag, app);
        }
        pub fn numSubscribers(app: *ThisApp, topic: []const u8) u32 {
            return uws_num_subscribers(ssl_flag, @as(*uws_app_t, @ptrCast(app)), topic.ptr, topic.len);
        }
        pub fn publish(app: *ThisApp, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
            return uws_publish(ssl_flag, @as(*uws_app_t, @ptrCast(app)), topic.ptr, topic.len, message.ptr, message.len, opcode, compress);
        }
        pub fn getNativeHandle(app: *ThisApp) ?*anyopaque {
            return uws_get_native_handle(ssl_flag, app);
        }
        pub fn removeServerName(app: *ThisApp, hostname_pattern: [*:0]const u8) void {
            return uws_remove_server_name(ssl_flag, @as(*uws_app_t, @ptrCast(app)), hostname_pattern);
        }
        pub fn addServerName(app: *ThisApp, hostname_pattern: [*:0]const u8) void {
            return uws_add_server_name(ssl_flag, @as(*uws_app_t, @ptrCast(app)), hostname_pattern);
        }
        pub fn addServerNameWithOptions(app: *ThisApp, hostname_pattern: [*:0]const u8, opts: us_bun_socket_context_options_t) !void {
            if (uws_add_server_name_with_options(ssl_flag, @as(*uws_app_t, @ptrCast(app)), hostname_pattern, opts) != 0) {
                return error.FailedToAddServerName;
            }
        }
        pub fn missingServerName(app: *ThisApp, handler: uws_missing_server_handler, user_data: ?*anyopaque) void {
            return uws_missing_server_name(ssl_flag, @as(*uws_app_t, @ptrCast(app)), handler, user_data);
        }
        pub fn filter(app: *ThisApp, handler: uws_filter_handler, user_data: ?*anyopaque) void {
            return uws_filter(ssl_flag, @as(*uws_app_t, @ptrCast(app)), handler, user_data);
        }
        pub fn ws(app: *ThisApp, pattern: []const u8, ctx: *anyopaque, id: usize, behavior_: WebSocketBehavior) void {
            var behavior = behavior_;
            uws_ws(ssl_flag, @as(*uws_app_t, @ptrCast(app)), ctx, pattern.ptr, pattern.len, id, &behavior);
        }

        pub const Response = opaque {
            inline fn castRes(res: *uws_res) *Response {
                return @as(*Response, @ptrCast(@alignCast(res)));
            }

            pub inline fn downcast(res: *Response) *uws_res {
                return @as(*uws_res, @ptrCast(@alignCast(res)));
            }

            pub fn end(res: *Response, data: []const u8, close_connection: bool) void {
                uws_res_end(ssl_flag, res.downcast(), data.ptr, data.len, close_connection);
            }

            pub fn tryEnd(res: *Response, data: []const u8, total: usize, close_: bool) bool {
                return uws_res_try_end(ssl_flag, res.downcast(), data.ptr, data.len, total, close_);
            }

            pub fn state(res: *const Response) State {
                return uws_res_state(ssl_flag, @as(*const uws_res, @ptrCast(@alignCast(res))));
            }

            pub fn shouldCloseConnection(this: *const Response) bool {
                return this.state().isHttpConnectionClose();
            }

            pub fn prepareForSendfile(res: *Response) void {
                return uws_res_prepare_for_sendfile(ssl_flag, res.downcast());
            }

            pub fn uncork(_: *Response) void {
                // uws_res_uncork(
                //     ssl_flag,
                //     res.downcast(),
                // );
            }
            pub fn pause(res: *Response) void {
                uws_res_pause(ssl_flag, res.downcast());
            }
            pub fn @"resume"(res: *Response) void {
                uws_res_resume(ssl_flag, res.downcast());
            }
            pub fn writeContinue(res: *Response) void {
                uws_res_write_continue(ssl_flag, res.downcast());
            }
            pub fn writeStatus(res: *Response, status: []const u8) void {
                uws_res_write_status(ssl_flag, res.downcast(), status.ptr, status.len);
            }
            pub fn writeHeader(res: *Response, key: []const u8, value: []const u8) void {
                uws_res_write_header(ssl_flag, res.downcast(), key.ptr, key.len, value.ptr, value.len);
            }
            pub fn writeHeaderInt(res: *Response, key: []const u8, value: u64) void {
                uws_res_write_header_int(ssl_flag, res.downcast(), key.ptr, key.len, value);
            }
            pub fn endWithoutBody(res: *Response, close_connection: bool) void {
                uws_res_end_without_body(ssl_flag, res.downcast(), close_connection);
            }
            pub fn endSendFile(res: *Response, write_offset: u64, close_connection: bool) void {
                uws_res_end_sendfile(ssl_flag, res.downcast(), write_offset, close_connection);
            }
            pub fn timeout(res: *Response, seconds: u8) void {
                uws_res_timeout(ssl_flag, res.downcast(), seconds);
            }
            pub fn resetTimeout(res: *Response) void {
                uws_res_reset_timeout(ssl_flag, res.downcast());
            }
            pub fn write(res: *Response, data: []const u8) bool {
                return uws_res_write(ssl_flag, res.downcast(), data.ptr, data.len);
            }
            pub fn getWriteOffset(res: *Response) u64 {
                return uws_res_get_write_offset(ssl_flag, res.downcast());
            }
            pub fn overrideWriteOffset(res: *Response, offset: anytype) void {
                uws_res_override_write_offset(ssl_flag, res.downcast(), @as(u64, @intCast(offset)));
            }
            pub fn hasResponded(res: *Response) bool {
                return uws_res_has_responded(ssl_flag, res.downcast());
            }

            pub fn getNativeHandle(res: *Response) bun.FileDescriptor {
                if (comptime Environment.isWindows) {
                    // on windows uSockets exposes SOCKET
                    return bun.toFD(@as(bun.FDImpl.System, @ptrCast(uws_res_get_native_handle(ssl_flag, res.downcast()))));
                }

                return bun.toFD(@as(i32, @intCast(@intFromPtr(uws_res_get_native_handle(ssl_flag, res.downcast())))));
            }
            pub fn getRemoteAddressAsText(res: *Response) ?[]const u8 {
                var buf: [*]const u8 = undefined;
                const size = uws_res_get_remote_address_as_text(ssl_flag, res.downcast(), &buf);
                return if (size > 0) buf[0..size] else null;
            }
            pub fn getRemoteSocketInfo(res: *Response) ?SocketAddress {
                var address = SocketAddress{
                    .ip = undefined,
                    .port = undefined,
                    .is_ipv6 = undefined,
                };
                // This function will fill in the slots and return len.
                // if len is zero it will not fill in the slots so it is ub to
                // return the struct in that case.
                address.ip.len = uws_res_get_remote_address_info(
                    res.downcast(),
                    &address.ip.ptr,
                    &address.port,
                    &address.is_ipv6,
                );
                return if (address.ip.len > 0) address else null;
            }
            pub fn onWritable(
                res: *Response,
                comptime UserDataType: type,
                comptime handler: fn (UserDataType, u64, *Response) bool,
                user_data: UserDataType,
            ) void {
                const Wrapper = struct {
                    pub fn handle(this: *uws_res, amount: u64, data: ?*anyopaque) callconv(.C) bool {
                        if (comptime UserDataType == void) {
                            return @call(bun.callmod_inline, handler, .{ {}, amount, castRes(this) });
                        } else {
                            return @call(bun.callmod_inline, handler, .{
                                @as(UserDataType, @ptrCast(@alignCast(data.?))),
                                amount,
                                castRes(this),
                            });
                        }
                    }
                };
                uws_res_on_writable(ssl_flag, res.downcast(), Wrapper.handle, user_data);
            }

            pub fn clearOnWritable(res: *Response) void {
                uws_res_clear_on_writable(ssl_flag, res.downcast());
            }
            pub inline fn markNeedsMore(res: *Response) void {
                if (!ssl) {
                    us_socket_mark_needs_more_not_ssl(res.downcast());
                }
            }
            pub fn onAborted(res: *Response, comptime UserDataType: type, comptime handler: fn (UserDataType, *Response) void, opcional_data: UserDataType) void {
                const Wrapper = struct {
                    pub fn handle(this: *uws_res, user_data: ?*anyopaque) callconv(.C) void {
                        if (comptime UserDataType == void) {
                            @call(bun.callmod_inline, handler, .{ {}, castRes(this), {} });
                        } else {
                            @call(bun.callmod_inline, handler, .{ @as(UserDataType, @ptrCast(@alignCast(user_data.?))), castRes(this) });
                        }
                    }
                };
                uws_res_on_aborted(ssl_flag, res.downcast(), Wrapper.handle, opcional_data);
            }

            pub fn clearAborted(res: *Response) void {
                uws_res_on_aborted(ssl_flag, res.downcast(), null, null);
            }
            pub fn onTimeout(res: *Response, comptime UserDataType: type, comptime handler: fn (UserDataType, *Response) void, opcional_data: UserDataType) void {
                const Wrapper = struct {
                    pub fn handle(this: *uws_res, user_data: ?*anyopaque) callconv(.C) void {
                        if (comptime UserDataType == void) {
                            @call(bun.callmod_inline, handler, .{ {}, castRes(this) });
                        } else {
                            @call(bun.callmod_inline, handler, .{ @as(UserDataType, @ptrCast(@alignCast(user_data.?))), castRes(this) });
                        }
                    }
                };
                uws_res_on_timeout(ssl_flag, res.downcast(), Wrapper.handle, opcional_data);
            }

            pub fn clearTimeout(res: *Response) void {
                uws_res_on_timeout(ssl_flag, res.downcast(), null, null);
            }
            pub fn clearOnData(res: *Response) void {
                uws_res_on_data(ssl_flag, res.downcast(), null, null);
            }

            pub fn onData(
                res: *Response,
                comptime UserDataType: type,
                comptime handler: fn (UserDataType, *Response, chunk: []const u8, last: bool) void,
                opcional_data: UserDataType,
            ) void {
                const Wrapper = struct {
                    pub fn handle(this: *uws_res, chunk_ptr: [*c]const u8, len: usize, last: bool, user_data: ?*anyopaque) callconv(.C) void {
                        if (comptime UserDataType == void) {
                            @call(bun.callmod_inline, handler, .{
                                {},
                                castRes(this),
                                if (len > 0) chunk_ptr[0..len] else "",
                                last,
                            });
                        } else {
                            @call(bun.callmod_inline, handler, .{
                                @as(UserDataType, @ptrCast(@alignCast(user_data.?))),
                                castRes(this),
                                if (len > 0) chunk_ptr[0..len] else "",
                                last,
                            });
                        }
                    }
                };

                uws_res_on_data(ssl_flag, res.downcast(), Wrapper.handle, opcional_data);
            }

            pub fn endStream(res: *Response, close_connection: bool) void {
                uws_res_end_stream(ssl_flag, res.downcast(), close_connection);
            }

            pub fn corked(
                res: *Response,
                comptime handler: anytype,
                args_tuple: anytype,
            ) void {
                const Wrapper = struct {
                    const handler_fn = handler;
                    const Args = *@TypeOf(args_tuple);
                    pub fn handle(user_data: ?*anyopaque) callconv(.C) void {
                        const args: Args = @alignCast(@ptrCast(user_data.?));
                        @call(.always_inline, handler_fn, args.*);
                    }
                };

                uws_res_cork(ssl_flag, res.downcast(), @constCast(@ptrCast(&args_tuple)), Wrapper.handle);
            }

            pub fn runCorkedWithType(
                res: *Response,
                comptime UserDataType: type,
                comptime handler: fn (UserDataType) void,
                opcional_data: UserDataType,
            ) void {
                const Wrapper = struct {
                    pub fn handle(user_data: ?*anyopaque) callconv(.C) void {
                        if (comptime UserDataType == void) {
                            @call(bun.callmod_inline, handler, .{
                                {},
                            });
                        } else {
                            @call(bun.callmod_inline, handler, .{
                                @as(UserDataType, @ptrCast(@alignCast(user_data.?))),
                            });
                        }
                    }
                };

                uws_res_cork(ssl_flag, res.downcast(), opcional_data, Wrapper.handle);
            }

            // pub fn onSocketWritable(
            //     res: *Response,
            //     comptime UserDataType: type,
            //     comptime handler: fn (UserDataType, fd: i32) void,
            //     opcional_data: UserDataType,
            // ) void {
            //     const Wrapper = struct {
            //         pub fn handle(user_data: ?*anyopaque, fd: i32) callconv(.C) void {
            //             if (comptime UserDataType == void) {
            //                 @call(bun.callmod_inline, handler, .{
            //                     {},
            //                     fd,
            //                 });
            //             } else {
            //                 @call(bun.callmod_inline, handler, .{
            //                     @ptrCast(
            //                         UserDataType,
            //                         @alignCast( user_data.?),
            //                     ),
            //                     fd,
            //                 });
            //             }
            //         }
            //     };

            //     const OnWritable = struct {
            //         pub fn handle(socket: *Socket) callconv(.C) ?*Socket {
            //             if (comptime UserDataType == void) {
            //                 @call(bun.callmod_inline, handler, .{
            //                     {},
            //                     fd,
            //                 });
            //             } else {
            //                 @call(bun.callmod_inline, handler, .{
            //                     @ptrCast(
            //                         UserDataType,
            //                         @alignCast( user_data.?),
            //                     ),
            //                     fd,
            //                 });
            //             }

            //             return socket;
            //         }
            //     };

            //     var socket_ctx = us_socket_context(ssl_flag, uws_res_get_native_handle(ssl_flag, res)).?;
            //     var child = us_create_child_socket_context(ssl_flag, socket_ctx, 8);

            // }

            pub fn writeHeaders(
                res: *Response,
                names: []const Api.StringPointer,
                values: []const Api.StringPointer,
                buf: []const u8,
            ) void {
                uws_res_write_headers(ssl_flag, res.downcast(), names.ptr, values.ptr, values.len, buf.ptr);
            }

            pub fn upgrade(
                res: *Response,
                comptime Data: type,
                data: Data,
                sec_web_socket_key: []const u8,
                sec_web_socket_protocol: []const u8,
                sec_web_socket_extensions: []const u8,
                ctx: ?*uws_socket_context_t,
            ) void {
                uws_res_upgrade(
                    ssl_flag,
                    res.downcast(),
                    data,
                    sec_web_socket_key.ptr,
                    sec_web_socket_key.len,
                    sec_web_socket_protocol.ptr,
                    sec_web_socket_protocol.len,
                    sec_web_socket_extensions.ptr,
                    sec_web_socket_extensions.len,
                    ctx,
                );
            }
        };

        pub const WebSocket = opaque {
            pub fn raw(this: *WebSocket) *RawWebSocket {
                return @as(*RawWebSocket, @ptrCast(this));
            }
            pub fn as(this: *WebSocket, comptime Type: type) ?*Type {
                @setRuntimeSafety(false);
                return @as(?*Type, @ptrCast(@alignCast(uws_ws_get_user_data(ssl_flag, this.raw()))));
            }

            pub fn close(this: *WebSocket) void {
                return uws_ws_close(ssl_flag, this.raw());
            }
            pub fn send(this: *WebSocket, message: []const u8, opcode: Opcode) SendStatus {
                return uws_ws_send(ssl_flag, this.raw(), message.ptr, message.len, opcode);
            }
            pub fn sendWithOptions(this: *WebSocket, message: []const u8, opcode: Opcode, compress: bool, fin: bool) SendStatus {
                return uws_ws_send_with_options(ssl_flag, this.raw(), message.ptr, message.len, opcode, compress, fin);
            }

            pub fn memoryCost(this: *WebSocket) usize {
                return this.raw().memoryCost(ssl_flag);
            }

            // pub fn sendFragment(this: *WebSocket, message: []const u8) SendStatus {
            //     return uws_ws_send_fragment(ssl_flag, this.raw(), message: [*c]const u8, length: usize, compress: bool);
            // }
            // pub fn sendFirstFragment(this: *WebSocket, message: []const u8) SendStatus {
            //     return uws_ws_send_first_fragment(ssl_flag, this.raw(), message: [*c]const u8, length: usize, compress: bool);
            // }
            // pub fn sendFirstFragmentWithOpcode(this: *WebSocket, message: []const u8, opcode: u32, compress: bool) SendStatus {
            //     return uws_ws_send_first_fragment_with_opcode(ssl_flag, this.raw(), message: [*c]const u8, length: usize, opcode: Opcode, compress: bool);
            // }
            pub fn sendLastFragment(this: *WebSocket, message: []const u8, compress: bool) SendStatus {
                return uws_ws_send_last_fragment(ssl_flag, this.raw(), message.ptr, message.len, compress);
            }
            pub fn end(this: *WebSocket, code: i32, message: []const u8) void {
                return uws_ws_end(ssl_flag, this.raw(), code, message.ptr, message.len);
            }
            pub fn cork(this: *WebSocket, ctx: anytype, comptime callback: anytype) void {
                const ContextType = @TypeOf(ctx);
                const Wrapper = struct {
                    pub fn wrap(user_data: ?*anyopaque) callconv(.C) void {
                        @call(bun.callmod_inline, callback, .{bun.cast(ContextType, user_data.?)});
                    }
                };

                return uws_ws_cork(ssl_flag, this.raw(), Wrapper.wrap, ctx);
            }
            pub fn subscribe(this: *WebSocket, topic: []const u8) bool {
                return uws_ws_subscribe(ssl_flag, this.raw(), topic.ptr, topic.len);
            }
            pub fn unsubscribe(this: *WebSocket, topic: []const u8) bool {
                return uws_ws_unsubscribe(ssl_flag, this.raw(), topic.ptr, topic.len);
            }
            pub fn isSubscribed(this: *WebSocket, topic: []const u8) bool {
                return uws_ws_is_subscribed(ssl_flag, this.raw(), topic.ptr, topic.len);
            }
            // pub fn iterateTopics(this: *WebSocket) {
            //     return uws_ws_iterate_topics(ssl_flag, this.raw(), callback: ?*const fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
            // }
            pub fn publish(this: *WebSocket, topic: []const u8, message: []const u8) bool {
                return uws_ws_publish(ssl_flag, this.raw(), topic.ptr, topic.len, message.ptr, message.len);
            }
            pub fn publishWithOptions(this: *WebSocket, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
                return uws_ws_publish_with_options(ssl_flag, this.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress);
            }
            pub fn getBufferedAmount(this: *WebSocket) u32 {
                return uws_ws_get_buffered_amount(ssl_flag, this.raw());
            }
            pub fn getRemoteAddress(this: *WebSocket, buf: []u8) []u8 {
                var ptr: [*]u8 = undefined;
                const len = uws_ws_get_remote_address(ssl_flag, this.raw(), &ptr);
                bun.copy(u8, buf, ptr[0..len]);
                return buf[0..len];
            }
        };
    };
}
extern fn uws_res_end_stream(ssl: i32, res: *uws_res, close_connection: bool) void;
extern fn uws_res_prepare_for_sendfile(ssl: i32, res: *uws_res) void;
extern fn uws_res_get_native_handle(ssl: i32, res: *uws_res) *Socket;
extern fn uws_res_get_remote_address_as_text(ssl: i32, res: *uws_res, dest: *[*]const u8) usize;
extern fn uws_create_app(ssl: i32, options: us_bun_socket_context_options_t) ?*uws_app_t;
extern fn uws_app_destroy(ssl: i32, app: *uws_app_t) void;
extern fn uws_app_get(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_post(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_options(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_delete(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_patch(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_put(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_head(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_connect(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_trace(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_any(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_run(ssl: i32, *uws_app_t) void;
extern fn uws_app_domain(ssl: i32, app: *uws_app_t, domain: [*c]const u8) void;
extern fn uws_app_listen(ssl: i32, app: *uws_app_t, port: i32, handler: uws_listen_handler, user_data: ?*anyopaque) void;
extern fn uws_app_listen_with_config(
    ssl: i32,
    app: *uws_app_t,
    host: [*c]const u8,
    port: u16,
    options: i32,
    handler: uws_listen_handler,
    user_data: ?*anyopaque,
) void;
extern fn uws_constructor_failed(ssl: i32, app: *uws_app_t) bool;
extern fn uws_num_subscribers(ssl: i32, app: *uws_app_t, topic: [*c]const u8, topic_length: usize) c_uint;
extern fn uws_publish(ssl: i32, app: *uws_app_t, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: Opcode, compress: bool) bool;
extern fn uws_get_native_handle(ssl: i32, app: *anyopaque) ?*anyopaque;
extern fn uws_remove_server_name(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
extern fn uws_add_server_name(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
extern fn uws_add_server_name_with_options(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8, options: us_bun_socket_context_options_t) i32;
extern fn uws_missing_server_name(ssl: i32, app: *uws_app_t, handler: uws_missing_server_handler, user_data: ?*anyopaque) void;
extern fn uws_filter(ssl: i32, app: *uws_app_t, handler: uws_filter_handler, user_data: ?*anyopaque) void;
extern fn uws_ws(ssl: i32, app: *uws_app_t, ctx: *anyopaque, pattern: [*]const u8, pattern_len: usize, id: usize, behavior: *const WebSocketBehavior) void;

extern fn uws_ws_get_user_data(ssl: i32, ws: ?*RawWebSocket) ?*anyopaque;
extern fn uws_ws_close(ssl: i32, ws: ?*RawWebSocket) void;
extern fn uws_ws_send(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode) SendStatus;
extern fn uws_ws_send_with_options(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode, compress: bool, fin: bool) SendStatus;
extern fn uws_ws_send_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
extern fn uws_ws_send_first_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
extern fn uws_ws_send_first_fragment_with_opcode(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode, compress: bool) SendStatus;
extern fn uws_ws_send_last_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
extern fn uws_ws_end(ssl: i32, ws: ?*RawWebSocket, code: i32, message: [*c]const u8, length: usize) void;
extern fn uws_ws_cork(ssl: i32, ws: ?*RawWebSocket, handler: ?*const fn (?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
extern fn uws_ws_subscribe(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_unsubscribe(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_is_subscribed(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_iterate_topics(ssl: i32, ws: ?*RawWebSocket, callback: ?*const fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
extern fn uws_ws_publish(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize) bool;
extern fn uws_ws_publish_with_options(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: Opcode, compress: bool) bool;
extern fn uws_ws_get_buffered_amount(ssl: i32, ws: ?*RawWebSocket) c_uint;
extern fn uws_ws_get_remote_address(ssl: i32, ws: ?*RawWebSocket, dest: *[*]u8) usize;
extern fn uws_ws_get_remote_address_as_text(ssl: i32, ws: ?*RawWebSocket, dest: *[*]u8) usize;
extern fn uws_res_get_remote_address_info(res: *uws_res, dest: *[*]const u8, port: *i32, is_ipv6: *bool) usize;

const uws_res = opaque {};
extern fn uws_res_uncork(ssl: i32, res: *uws_res) void;
extern fn uws_res_end(ssl: i32, res: *uws_res, data: [*c]const u8, length: usize, close_connection: bool) void;
extern fn uws_res_try_end(
    ssl: i32,
    res: *uws_res,
    data: [*c]const u8,
    length: usize,
    total: usize,
    close: bool,
) bool;
extern fn uws_res_pause(ssl: i32, res: *uws_res) void;
extern fn uws_res_resume(ssl: i32, res: *uws_res) void;
extern fn uws_res_write_continue(ssl: i32, res: *uws_res) void;
extern fn uws_res_write_status(ssl: i32, res: *uws_res, status: [*c]const u8, length: usize) void;
extern fn uws_res_write_header(ssl: i32, res: *uws_res, key: [*c]const u8, key_length: usize, value: [*c]const u8, value_length: usize) void;
extern fn uws_res_write_header_int(ssl: i32, res: *uws_res, key: [*c]const u8, key_length: usize, value: u64) void;
extern fn uws_res_end_without_body(ssl: i32, res: *uws_res, close_connection: bool) void;
extern fn uws_res_end_sendfile(ssl: i32, res: *uws_res, write_offset: u64, close_connection: bool) void;
extern fn uws_res_timeout(ssl: i32, res: *uws_res, timeout: u8) void;
extern fn uws_res_reset_timeout(ssl: i32, res: *uws_res) void;
extern fn uws_res_write(ssl: i32, res: *uws_res, data: [*c]const u8, length: usize) bool;
extern fn uws_res_get_write_offset(ssl: i32, res: *uws_res) u64;
extern fn uws_res_override_write_offset(ssl: i32, res: *uws_res, u64) void;
extern fn uws_res_has_responded(ssl: i32, res: *uws_res) bool;
extern fn uws_res_on_writable(ssl: i32, res: *uws_res, handler: ?*const fn (*uws_res, u64, ?*anyopaque) callconv(.C) bool, user_data: ?*anyopaque) void;
extern fn uws_res_clear_on_writable(ssl: i32, res: *uws_res) void;
extern fn uws_res_on_aborted(ssl: i32, res: *uws_res, handler: ?*const fn (*uws_res, ?*anyopaque) callconv(.C) void, opcional_data: ?*anyopaque) void;
extern fn uws_res_on_timeout(ssl: i32, res: *uws_res, handler: ?*const fn (*uws_res, ?*anyopaque) callconv(.C) void, opcional_data: ?*anyopaque) void;

extern fn uws_res_on_data(
    ssl: i32,
    res: *uws_res,
    handler: ?*const fn (*uws_res, [*c]const u8, usize, bool, ?*anyopaque) callconv(.C) void,
    opcional_data: ?*anyopaque,
) void;
extern fn uws_res_upgrade(
    ssl: i32,
    res: *uws_res,
    data: ?*anyopaque,
    sec_web_socket_key: [*c]const u8,
    sec_web_socket_key_length: usize,
    sec_web_socket_protocol: [*c]const u8,
    sec_web_socket_protocol_length: usize,
    sec_web_socket_extensions: [*c]const u8,
    sec_web_socket_extensions_length: usize,
    ws: ?*uws_socket_context_t,
) void;
extern fn uws_res_cork(i32, res: *uws_res, ctx: *anyopaque, corker: *const (fn (?*anyopaque) callconv(.C) void)) void;
extern fn uws_res_write_headers(i32, res: *uws_res, names: [*]const Api.StringPointer, values: [*]const Api.StringPointer, count: usize, buf: [*]const u8) void;
pub const LIBUS_RECV_BUFFER_LENGTH = 524288;
pub const LIBUS_TIMEOUT_GRANULARITY = @as(i32, 4);
pub const LIBUS_RECV_BUFFER_PADDING = @as(i32, 32);
pub const LIBUS_EXT_ALIGNMENT = @as(i32, 16);
pub const LIBUS_SOCKET_DESCRIPTOR = std.posix.socket_t;

pub const _COMPRESSOR_MASK: i32 = 255;
pub const _DECOMPRESSOR_MASK: i32 = 3840;
pub const DISABLED: i32 = 0;
pub const SHARED_COMPRESSOR: i32 = 1;
pub const SHARED_DECOMPRESSOR: i32 = 256;
pub const DEDICATED_DECOMPRESSOR_32KB: i32 = 3840;
pub const DEDICATED_DECOMPRESSOR_16KB: i32 = 3584;
pub const DEDICATED_DECOMPRESSOR_8KB: i32 = 3328;
pub const DEDICATED_DECOMPRESSOR_4KB: i32 = 3072;
pub const DEDICATED_DECOMPRESSOR_2KB: i32 = 2816;
pub const DEDICATED_DECOMPRESSOR_1KB: i32 = 2560;
pub const DEDICATED_DECOMPRESSOR_512B: i32 = 2304;
pub const DEDICATED_DECOMPRESSOR: i32 = 3840;
pub const DEDICATED_COMPRESSOR_3KB: i32 = 145;
pub const DEDICATED_COMPRESSOR_4KB: i32 = 146;
pub const DEDICATED_COMPRESSOR_8KB: i32 = 163;
pub const DEDICATED_COMPRESSOR_16KB: i32 = 180;
pub const DEDICATED_COMPRESSOR_32KB: i32 = 197;
pub const DEDICATED_COMPRESSOR_64KB: i32 = 214;
pub const DEDICATED_COMPRESSOR_128KB: i32 = 231;
pub const DEDICATED_COMPRESSOR_256KB: i32 = 248;
pub const DEDICATED_COMPRESSOR: i32 = 248;
pub const uws_compress_options_t = i32;
pub const CONTINUATION: i32 = 0;
pub const TEXT: i32 = 1;
pub const BINARY: i32 = 2;
pub const CLOSE: i32 = 8;
pub const PING: i32 = 9;
pub const PONG: i32 = 10;

pub const Opcode = enum(i32) {
    continuation = 0,
    text = 1,
    binary = 2,
    close = 8,
    ping = 9,
    pong = 10,
    _,
};

pub const SendStatus = enum(c_uint) {
    backpressure = 0,
    success = 1,
    dropped = 2,
};
pub const uws_app_listen_config_t = extern struct {
    port: c_int,
    host: ?[*:0]const u8 = null,
    options: c_int = 0,
};
pub const AppListenConfig = uws_app_listen_config_t;

extern fn us_socket_mark_needs_more_not_ssl(socket: ?*uws_res) void;

extern fn uws_res_state(ssl: c_int, res: *const uws_res) State;

pub const State = enum(u8) {
    HTTP_STATUS_CALLED = 1,
    HTTP_WRITE_CALLED = 2,
    HTTP_END_CALLED = 4,
    HTTP_RESPONSE_PENDING = 8,
    HTTP_CONNECTION_CLOSE = 16,

    _,

    pub inline fn isResponsePending(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_RESPONSE_PENDING) != 0;
    }

    pub inline fn isHttpEndCalled(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_END_CALLED) != 0;
    }

    pub inline fn isHttpWriteCalled(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_WRITE_CALLED) != 0;
    }

    pub inline fn isHttpStatusCalled(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_STATUS_CALLED) != 0;
    }

    pub inline fn isHttpConnectionClose(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_CONNECTION_CLOSE) != 0;
    }
};

extern fn us_socket_sendfile_needs_more(socket: *Socket) void;

extern fn uws_app_listen_domain_with_options(
    ssl_flag: c_int,
    app: *uws_app_t,
    domain: [*:0]const u8,
    pathlen: usize,
    i32,
    *const (fn (*ListenSocket, domain: [*:0]const u8, i32, *anyopaque) callconv(.C) void),
    ?*anyopaque,
) void;

/// This extends off of uws::Loop on Windows
pub const WindowsLoop = extern struct {
    const uv = bun.windows.libuv;

    internal_loop_data: InternalLoopData align(16),

    uv_loop: *uv.Loop,
    is_default: c_int,
    pre: *uv.uv_prepare_t,
    check: *uv.uv_check_t,

    pub fn get() *WindowsLoop {
        return uws_get_loop_with_native(bun.windows.libuv.Loop.get());
    }

    extern fn uws_get_loop_with_native(*anyopaque) *WindowsLoop;

    pub fn iterationNumber(this: *const WindowsLoop) u64 {
        return this.internal_loop_data.iteration_nr;
    }

    pub fn addActive(this: *const WindowsLoop, val: u32) void {
        this.uv_loop.addActive(val);
    }

    pub fn subActive(this: *const WindowsLoop, val: u32) void {
        this.uv_loop.subActive(val);
    }

    pub fn isActive(this: *const WindowsLoop) bool {
        return this.uv_loop.isActive();
    }

    pub fn wakeup(this: *WindowsLoop) void {
        us_wakeup_loop(this);
    }

    pub const wake = wakeup;

    pub fn tickWithTimeout(this: *WindowsLoop, _: ?*const bun.timespec) void {
        us_loop_run(this);
    }

    pub fn tickWithoutIdle(this: *WindowsLoop) void {
        us_loop_pump(this);
    }

    pub fn create(comptime Handler: anytype) *WindowsLoop {
        return us_create_loop(
            null,
            Handler.wakeup,
            if (@hasDecl(Handler, "pre")) Handler.pre else null,
            if (@hasDecl(Handler, "post")) Handler.post else null,
            0,
        ).?;
    }

    pub fn run(this: *WindowsLoop) void {
        us_loop_run(this);
    }

    // TODO: remove these two aliases
    pub const tick = run;
    pub const wait = run;

    pub fn inc(this: *WindowsLoop) void {
        this.uv_loop.inc();
    }

    pub fn dec(this: *WindowsLoop) void {
        this.uv_loop.dec();
    }

    pub const ref = inc;
    pub const unref = dec;

    pub fn nextTick(this: *Loop, comptime UserType: type, user_data: UserType, comptime deferCallback: fn (ctx: UserType) void) void {
        const Handler = struct {
            pub fn callback(data: *anyopaque) callconv(.C) void {
                deferCallback(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
        uws_loop_defer(this, user_data, Handler.callback);
    }

    fn NewHandler(comptime UserType: type, comptime callback_fn: fn (UserType) void) type {
        return struct {
            loop: *Loop,
            pub fn removePost(handler: @This()) void {
                return uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn removePre(handler: @This()) void {
                return uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn callback(data: *anyopaque, _: *Loop) callconv(.C) void {
                callback_fn(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
    }
};

pub const Loop = if (bun.Environment.isWindows) WindowsLoop else PosixLoop;

extern fn uws_get_loop() *Loop;
extern fn us_create_loop(
    hint: ?*anyopaque,
    wakeup_cb: ?*const fn (*Loop) callconv(.C) void,
    pre_cb: ?*const fn (*Loop) callconv(.C) void,
    post_cb: ?*const fn (*Loop) callconv(.C) void,
    ext_size: c_uint,
) ?*Loop;
extern fn us_loop_free(loop: ?*Loop) void;
extern fn us_loop_ext(loop: ?*Loop) ?*anyopaque;
extern fn us_loop_run(loop: ?*Loop) void;
extern fn us_loop_pump(loop: ?*Loop) void;
extern fn us_wakeup_loop(loop: ?*Loop) void;
extern fn us_loop_integrate(loop: ?*Loop) void;
extern fn us_loop_iteration_number(loop: ?*Loop) c_longlong;
extern fn uws_loop_addPostHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
extern fn uws_loop_removePostHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
extern fn uws_loop_addPreHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
extern fn uws_loop_removePreHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
extern fn us_socket_pair(
    ctx: *SocketContext,
    ext_size: c_int,
    fds: *[2]LIBUS_SOCKET_DESCRIPTOR,
) ?*Socket;

pub extern fn us_socket_from_fd(
    ctx: *SocketContext,
    ext_size: c_int,
    fd: LIBUS_SOCKET_DESCRIPTOR,
) ?*Socket;

pub fn newSocketFromPair(ctx: *SocketContext, ext_size: c_int, fds: *[2]LIBUS_SOCKET_DESCRIPTOR) ?SocketTCP {
    return SocketTCP{
        .socket = us_socket_pair(ctx, ext_size, fds) orelse return null,
    };
}

extern fn us_socket_get_error(ssl_flag: c_int, socket: *Socket) c_int;

pub const AnySocket = union(enum) {
    SocketTCP: SocketTCP,
    SocketTLS: SocketTLS,

    pub fn setTimeout(this: AnySocket, seconds: c_uint) void {
        switch (this) {
            .SocketTCP => this.SocketTCP.setTimeout(seconds),
            .SocketTLS => this.SocketTLS.setTimeout(seconds),
        }
    }

    pub fn shutdown(this: AnySocket) void {
        debug("us_socket_shutdown({d})", .{@intFromPtr(this.socket())});
        return us_socket_shutdown(
            @intFromBool(this.isSSL()),
            this.socket(),
        );
    }
    pub fn shutdownRead(this: AnySocket) void {
        debug("us_socket_shutdown_read({d})", .{@intFromPtr(this.socket())});
        return us_socket_shutdown_read(
            @intFromBool(this.isSSL()),
            this.socket(),
        );
    }
    pub fn isShutdown(this: AnySocket) bool {
        return switch (this) {
            .SocketTCP => this.SocketTCP.isShutdown(),
            .SocketTLS => this.SocketTLS.isShutdown(),
        };
    }
    pub fn isClosed(this: AnySocket) bool {
        return switch (this) {
            inline else => |s| s.isClosed(),
        };
    }
    pub fn close(this: AnySocket) void {
        switch (this) {
            inline else => |s| s.close(.normal),
        }
    }

    pub fn terminate(this: AnySocket) void {
        switch (this) {
            inline else => |s| s.close(.failure),
        }
    }

    pub fn write(this: AnySocket, data: []const u8, msg_more: bool) i32 {
        return switch (this) {
            .SocketTCP => return this.SocketTCP.write(data, msg_more),
            .SocketTLS => return this.SocketTLS.write(data, msg_more),
        };
    }

    pub fn getNativeHandle(this: AnySocket) ?*anyopaque {
        return switch (this.socket()) {
            .connected => |sock| us_socket_get_native_handle(
                @intFromBool(this.isSSL()),
                sock,
            ).?,
            else => null,
        };
    }

    pub fn localPort(this: AnySocket) i32 {
        return us_socket_local_port(
            @intFromBool(this.isSSL()),
            this.socket(),
        );
    }

    pub fn isSSL(this: AnySocket) bool {
        return switch (this) {
            .SocketTCP => false,
            .SocketTLS => true,
        };
    }

    pub fn socket(this: AnySocket) InternalSocket {
        return switch (this) {
            .SocketTCP => this.SocketTCP.socket,
            .SocketTLS => this.SocketTLS.socket,
        };
    }

    pub fn ext(this: AnySocket, comptime ContextType: type) ?*ContextType {
        const ptr = us_socket_ext(
            this.isSSL(),
            this.socket(),
        ) orelse return null;

        return @ptrCast(@alignCast(ptr));
    }
    pub fn context(this: AnySocket) *SocketContext {
        return us_socket_context(
            this.isSSL(),
            this.socket(),
        ).?;
    }
};

pub const udp = struct {
    pub const Socket = opaque {
        const This = @This();

        pub fn create(loop: *Loop, data_cb: *const fn (*This, *PacketBuffer, c_int) callconv(.C) void, drain_cb: *const fn (*This) callconv(.C) void, close_cb: *const fn (*This) callconv(.C) void, host: [*c]const u8, port: c_ushort, user_data: ?*anyopaque) ?*This {
            return us_create_udp_socket(loop, data_cb, drain_cb, close_cb, host, port, user_data);
        }

        pub fn send(this: *This, payloads: []const [*]const u8, lengths: []const usize, addresses: []const ?*const anyopaque) c_int {
            bun.assert(payloads.len == lengths.len and payloads.len == addresses.len);
            return us_udp_socket_send(this, payloads.ptr, lengths.ptr, addresses.ptr, @intCast(payloads.len));
        }

        pub fn user(this: *This) ?*anyopaque {
            return us_udp_socket_user(this);
        }

        pub fn bind(this: *This, hostname: [*c]const u8, port: c_uint) c_int {
            return us_udp_socket_bind(this, hostname, port);
        }

        pub fn boundPort(this: *This) c_int {
            return us_udp_socket_bound_port(this);
        }

        pub fn boundIp(this: *This, buf: [*c]u8, length: *i32) void {
            return us_udp_socket_bound_ip(this, buf, length);
        }

        pub fn remoteIp(this: *This, buf: [*c]u8, length: *i32) void {
            return us_udp_socket_remote_ip(this, buf, length);
        }

        pub fn close(this: *This) void {
            return us_udp_socket_close(this);
        }

        pub fn connect(this: *This, hostname: [*c]const u8, port: c_uint) c_int {
            return us_udp_socket_connect(this, hostname, port);
        }

        pub fn disconnect(this: *This) c_int {
            return us_udp_socket_disconnect(this);
        }
    };

    extern fn us_create_udp_socket(loop: ?*Loop, data_cb: *const fn (*udp.Socket, *PacketBuffer, c_int) callconv(.C) void, drain_cb: *const fn (*udp.Socket) callconv(.C) void, close_cb: *const fn (*udp.Socket) callconv(.C) void, host: [*c]const u8, port: c_ushort, user_data: ?*anyopaque) ?*udp.Socket;
    extern fn us_udp_socket_connect(socket: ?*udp.Socket, hostname: [*c]const u8, port: c_uint) c_int;
    extern fn us_udp_socket_disconnect(socket: ?*udp.Socket) c_int;
    extern fn us_udp_socket_send(socket: ?*udp.Socket, [*c]const [*c]const u8, [*c]const usize, [*c]const ?*const anyopaque, c_int) c_int;
    extern fn us_udp_socket_user(socket: ?*udp.Socket) ?*anyopaque;
    extern fn us_udp_socket_bind(socket: ?*udp.Socket, hostname: [*c]const u8, port: c_uint) c_int;
    extern fn us_udp_socket_bound_port(socket: ?*udp.Socket) c_int;
    extern fn us_udp_socket_bound_ip(socket: ?*udp.Socket, buf: [*c]u8, length: [*c]i32) void;
    extern fn us_udp_socket_remote_ip(socket: ?*udp.Socket, buf: [*c]u8, length: [*c]i32) void;
    extern fn us_udp_socket_close(socket: ?*udp.Socket) void;

    pub const PacketBuffer = opaque {
        const This = @This();

        pub fn getPeer(this: *This, index: c_int) *std.posix.sockaddr.storage {
            return us_udp_packet_buffer_peer(this, index);
        }

        pub fn getPayload(this: *This, index: c_int) []u8 {
            const payload = us_udp_packet_buffer_payload(this, index);
            const len = us_udp_packet_buffer_payload_length(this, index);
            return payload[0..@as(usize, @intCast(len))];
        }
    };

    extern fn us_udp_packet_buffer_peer(buf: ?*PacketBuffer, index: c_int) *std.posix.sockaddr.storage;
    extern fn us_udp_packet_buffer_payload(buf: ?*PacketBuffer, index: c_int) [*]u8;
    extern fn us_udp_packet_buffer_payload_length(buf: ?*PacketBuffer, index: c_int) c_int;
};

extern fn bun_clear_loop_at_thread_exit() void;
pub fn onThreadExit() void {
    bun_clear_loop_at_thread_exit();
}

extern fn uws_app_clear_routes(ssl_flag: c_int, app: *uws_app_t) void;

pub extern fn us_socket_upgrade_to_tls(s: *Socket, new_context: *SocketContext, sni: ?[*:0]const u8) ?*Socket;
