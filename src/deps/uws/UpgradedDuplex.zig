//! UpgradedDuplex provides TLS/SSL encryption for Node.js-style duplex streams.
//!
//! This is used when you need to add TLS encryption to streams that are not traditional
//! network sockets. In Node.js, you can have duplex streams that represent arbitrary
//! read/write channels - these could be in-memory streams, custom transport protocols,
//! or any other bidirectional data flow that implements the duplex stream interface.
//!
//! Since these duplex streams don't have native SSL support (they're not actual socket
//! file descriptors),
//!
//! The duplex stream manages the SSL handshake, certificate validation, encryption/decryption,
//! and integrates with Bun's event loop for timeouts and async operations. It maintains
//! JavaScript callbacks for handling connection events and errors.

const UpgradedDuplex = @This();

wrapper: ?WrapperType,
origin: jsc.Strong.Optional = .empty, // any duplex
global: ?*jsc.JSGlobalObject = null,
ssl_error: CertError = .{},
vm: *jsc.VirtualMachine,
handlers: Handlers,
onDataCallback: jsc.Strong.Optional = .empty,
onEndCallback: jsc.Strong.Optional = .empty,
onWritableCallback: jsc.Strong.Optional = .empty,
onCloseCallback: jsc.Strong.Optional = .empty,
event_loop_timer: EventLoopTimer = .{
    .next = .epoch,
    .tag = .UpgradedDuplex,
},
current_timeout: u32 = 0,

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

pub const Handlers = struct {
    ctx: *anyopaque,
    onOpen: *const fn (*anyopaque) void,
    onHandshake: *const fn (*anyopaque, bool, uws.us_bun_verify_error_t) void,
    onData: *const fn (*anyopaque, []const u8) void,
    onClose: *const fn (*anyopaque) void,
    onEnd: *const fn (*anyopaque) void,
    onWritable: *const fn (*anyopaque) void,
    onError: *const fn (*anyopaque, jsc.JSValue) void,
    onTimeout: *const fn (*anyopaque) void,
};

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
        .code = if (ssl_error.code == null or ssl_error.error_no == 0) "" else bun.handleOom(bun.default_allocator.dupeZ(u8, ssl_error.code[0..bun.len(ssl_error.code) :0])),
        .reason = if (ssl_error.reason == null or ssl_error.error_no == 0) "" else bun.handleOom(bun.default_allocator.dupeZ(u8, ssl_error.reason[0..bun.len(ssl_error.reason) :0])),
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
        const globalThis = this.global.?;
        const writeOrEnd = if (msg_more) duplex.getFunction(globalThis, "write") catch return orelse return else duplex.getFunction(globalThis, "end") catch return orelse return;
        if (data) |data_| {
            const buffer = jsc.ArrayBuffer.BinaryType.toJS(.Buffer, data_, globalThis) catch |err| {
                this.handlers.onError(this.handlers.ctx, globalThis.takeException(err));
                return;
            };
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
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    log("onReceivedData", .{});

    const function = callframe.callee();
    const args = callframe.arguments_old(1);

    if (jsc.host_fn.getFunctionData(function)) |self| {
        const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));
        if (args.len >= 1) {
            const data_arg = args.ptr[0];
            if (this.origin.has()) {
                if (data_arg.isEmptyOrUndefinedOrNull()) {
                    return .js_undefined;
                }
                if (data_arg.asArrayBuffer(globalObject)) |array_buffer| {
                    // yay we can read the data
                    const payload = array_buffer.slice();
                    this.onInternalReceiveData(payload);
                } else {
                    // node.js errors in this case with the same error, lets keep it consistent
                    const error_value = globalObject.ERR(.STREAM_WRAP, "Stream has StringDecoder set or is in objectMode", .{}).toJS();
                    error_value.ensureStillAlive();
                    this.handlers.onError(this.handlers.ctx, error_value);
                }
            }
        }
    }
    return .js_undefined;
}

fn onEnd(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) void {
    log("onEnd", .{});
    _ = globalObject;
    const function = callframe.callee();

    if (jsc.host_fn.getFunctionData(function)) |self| {
        const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));

        if (this.wrapper != null) {
            this.handlers.onEnd(this.handlers.ctx);
        }
    }
}

fn onWritable(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    log("onWritable", .{});

    _ = globalObject;
    const function = callframe.callee();

    if (jsc.host_fn.getFunctionData(function)) |self| {
        const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));
        // flush pending data
        if (this.wrapper) |*wrapper| {
            _ = wrapper.flush();
        }
        // call onWritable (will flush on demand)
        this.handlers.onWritable(this.handlers.ctx);
    }

    return .js_undefined;
}

fn onCloseJS(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    log("onCloseJS", .{});

    _ = globalObject;
    const function = callframe.callee();

    if (jsc.host_fn.getFunctionData(function)) |self| {
        const this = @as(*UpgradedDuplex, @ptrCast(@alignCast(self)));
        // flush pending data
        if (this.wrapper) |*wrapper| {
            _ = wrapper.shutdown(true);
        }
    }

    return .js_undefined;
}

pub fn onTimeout(this: *UpgradedDuplex) void {
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
    globalThis: *jsc.JSGlobalObject,
    origin: jsc.JSValue,
    handlers: UpgradedDuplex.Handlers,
) UpgradedDuplex {
    return UpgradedDuplex{
        .vm = globalThis.bunVM(),
        .origin = .create(origin, globalThis),
        .global = globalThis,
        .wrapper = null,
        .handlers = handlers,
    };
}

pub fn getJSHandlers(this: *UpgradedDuplex, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const array = try jsc.JSValue.createEmptyArray(globalThis, 4);
    array.ensureStillAlive();

    {
        const callback = this.onDataCallback.get() orelse brk: {
            const dataCallback = jsc.host_fn.NewFunctionWithData(
                globalThis,
                null,
                0,
                onReceivedData,
                this,
            );
            dataCallback.ensureStillAlive();

            jsc.host_fn.setFunctionData(dataCallback, this);

            this.onDataCallback = .create(dataCallback, globalThis);
            break :brk dataCallback;
        };
        try array.putIndex(globalThis, 0, callback);
    }

    {
        const callback = this.onEndCallback.get() orelse brk: {
            const endCallback = jsc.host_fn.NewFunctionWithData(
                globalThis,
                null,
                0,
                onReceivedData,
                this,
            );
            endCallback.ensureStillAlive();

            jsc.host_fn.setFunctionData(endCallback, this);

            this.onEndCallback = .create(endCallback, globalThis);
            break :brk endCallback;
        };
        try array.putIndex(globalThis, 1, callback);
    }

    {
        const callback = this.onWritableCallback.get() orelse brk: {
            const writableCallback = jsc.host_fn.NewFunctionWithData(
                globalThis,
                null,
                0,
                onWritable,
                this,
            );
            writableCallback.ensureStillAlive();

            jsc.host_fn.setFunctionData(writableCallback, this);
            this.onWritableCallback = .create(writableCallback, globalThis);
            break :brk writableCallback;
        };
        try array.putIndex(globalThis, 2, callback);
    }

    {
        const callback = this.onCloseCallback.get() orelse brk: {
            const closeCallback = jsc.host_fn.NewFunctionWithData(
                globalThis,
                null,
                0,
                onCloseJS,
                this,
            );
            closeCallback.ensureStillAlive();

            jsc.host_fn.setFunctionData(closeCallback, this);
            this.onCloseCallback = .create(closeCallback, globalThis);
            break :brk closeCallback;
        };
        try array.putIndex(globalThis, 3, callback);
    }

    return array;
}

pub fn startTLS(this: *UpgradedDuplex, ssl_options: jsc.API.ServerConfig.SSLConfig, is_client: bool) !void {
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

pub fn encodeAndWrite(this: *UpgradedDuplex, data: []const u8) i32 {
    log("encodeAndWrite (len: {})", .{data.len});
    if (this.wrapper) |*wrapper| {
        return @as(i32, @intCast(wrapper.writeData(data) catch 0));
    }
    return 0;
}

pub fn rawWrite(this: *UpgradedDuplex, encoded_data: []const u8) i32 {
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
    this.event_loop_timer.next = bun.timespec.msFromNow(.allow_mocked_time, ms);
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
        jsc.host_fn.setFunctionData(callback, null);
        this.onDataCallback.deinit();
    }
    if (this.onEndCallback.get()) |callback| {
        jsc.host_fn.setFunctionData(callback, null);
        this.onEndCallback.deinit();
    }
    if (this.onWritableCallback.get()) |callback| {
        jsc.host_fn.setFunctionData(callback, null);
        this.onWritableCallback.deinit();
    }
    if (this.onCloseCallback.get()) |callback| {
        jsc.host_fn.setFunctionData(callback, null);
        this.onCloseCallback.deinit();
    }
    var ssl_error = this.ssl_error;
    ssl_error.deinit();
    this.ssl_error = .{};
}

const log = bun.Output.scoped(.UpgradedDuplex, .visible);

const SSLWrapper = @import("../../bun.js/api/bun/ssl_wrapper.zig").SSLWrapper;

const bun = @import("bun");
const jsc = bun.jsc;
const BoringSSL = bun.BoringSSL.c;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const uws = bun.uws;
const us_bun_verify_error_t = uws.us_bun_verify_error_t;
