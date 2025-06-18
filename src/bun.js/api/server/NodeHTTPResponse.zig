const NodeHTTPResponse = @This();
const log = bun.Output.scoped(.NodeHTTPResponse, false);

pub const js = JSC.Codegen.JSNodeHTTPResponse;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,

raw_response: uws.AnyResponse,

flags: Flags = .{},

js_ref: JSC.Ref = .{},

body_read_state: BodyReadState = .none,
body_read_ref: JSC.Ref = .{},
promise: JSC.Strong.Optional = .empty,
server: AnyServer,

/// When you call pause() on the node:http IncomingMessage
/// We might've already read from the socket.
/// So we need to buffer that data.
/// This should be pretty uncommon though.
buffered_request_body_data_during_pause: bun.ByteList = .{},
bytes_written: usize = 0,

upgrade_context: UpgradeCTX = .{},

pub const Flags = packed struct(u8) {
    socket_closed: bool = false,
    request_has_completed: bool = false,
    ended: bool = false,
    upgraded: bool = false,
    hasCustomOnData: bool = false,
    is_request_pending: bool = true,
    is_data_buffered_during_pause: bool = false,
    /// Did we receive the last chunk of data during pause?
    is_data_buffered_during_pause_last: bool = false,
};

pub const UpgradeCTX = struct {
    context: ?*uws.SocketContext = null,
    // request will be detached when go async
    request: ?*uws.Request = null,

    // we need to store this, if we wanna to enable async upgrade
    sec_websocket_key: []const u8 = "",
    sec_websocket_protocol: []const u8 = "",
    sec_websocket_extensions: []const u8 = "",

    // this can be called multiple times
    pub fn deinit(this: *UpgradeCTX) void {
        const sec_websocket_key = this.sec_websocket_key;
        const sec_websocket_protocol = this.sec_websocket_protocol;
        const sec_websocket_extensions = this.sec_websocket_extensions;
        this.* = .{};
        if (sec_websocket_extensions.len > 0) bun.default_allocator.free(sec_websocket_extensions);
        if (sec_websocket_protocol.len > 0) bun.default_allocator.free(sec_websocket_protocol);
        if (sec_websocket_key.len > 0) bun.default_allocator.free(sec_websocket_key);
    }

    pub fn preserveWebSocketHeadersIfNeeded(this: *UpgradeCTX) void {
        if (this.request) |request| {
            this.request = null;

            const sec_websocket_key = request.header("sec-websocket-key") orelse "";
            const sec_websocket_protocol = request.header("sec-websocket-protocol") orelse "";
            const sec_websocket_extensions = request.header("sec-websocket-extensions") orelse "";

            if (sec_websocket_key.len > 0) {
                this.sec_websocket_key = bun.default_allocator.dupe(u8, sec_websocket_key) catch bun.outOfMemory();
            }
            if (sec_websocket_protocol.len > 0) {
                this.sec_websocket_protocol = bun.default_allocator.dupe(u8, sec_websocket_protocol) catch bun.outOfMemory();
            }
            if (sec_websocket_extensions.len > 0) {
                this.sec_websocket_extensions = bun.default_allocator.dupe(u8, sec_websocket_extensions) catch bun.outOfMemory();
            }
        }
    }
};

pub const BodyReadState = enum(u8) {
    none = 0,
    pending = 1,
    done = 2,
};

extern "C" fn Bun__getNodeHTTPResponseThisValue(bool, *anyopaque) JSC.JSValue;
pub fn getThisValue(this: *NodeHTTPResponse) JSC.JSValue {
    if (this.flags.socket_closed) {
        return .zero;
    }

    return Bun__getNodeHTTPResponseThisValue(this.raw_response == .SSL, this.raw_response.socket());
}

extern "C" fn Bun__getNodeHTTPServerSocketThisValue(bool, *anyopaque) JSC.JSValue;
pub fn getServerSocketValue(this: *NodeHTTPResponse) JSC.JSValue {
    if (this.flags.socket_closed) {
        return .zero;
    }

    return Bun__getNodeHTTPServerSocketThisValue(this.raw_response == .SSL, this.raw_response.socket());
}

pub fn pauseSocket(this: *NodeHTTPResponse) void {
    log("pauseSocket", .{});
    this.raw_response.pause();
}

pub fn resumeSocket(this: *NodeHTTPResponse) void {
    log("resumeSocket", .{});
    this.raw_response.@"resume"();
}
pub fn upgrade(this: *NodeHTTPResponse, data_value: JSValue, sec_websocket_protocol: ZigString, sec_websocket_extensions: ZigString) bool {
    const upgrade_ctx = this.upgrade_context.context orelse return false;
    const ws_handler = this.server.webSocketHandler() orelse return false;
    const socketValue = this.getServerSocketValue();
    if (socketValue == .zero) {
        return false;
    }
    resumeSocket(this);

    defer {
        this.setOnAbortedHandler();
        this.upgrade_context.deinit();
    }
    data_value.ensureStillAlive();

    const ws = ServerWebSocket.new(.{
        .handler = ws_handler,
        .this_value = data_value,
    });

    var new_socket: ?*uws.Socket = null;
    defer if (new_socket) |socket| {
        this.flags.upgraded = true;
        Bun__setNodeHTTPServerSocketUsSocketValue(socketValue, socket);
        ServerWebSocket.js.socketSetCached(ws.getThisValue(), ws_handler.globalObject, socketValue);
        defer this.js_ref.unref(JSC.VirtualMachine.get());
        switch (this.raw_response) {
            .SSL => this.raw_response = uws.AnyResponse.init(uws.NewApp(true).Response.castRes(@alignCast(@ptrCast(socket)))),
            .TCP => this.raw_response = uws.AnyResponse.init(uws.NewApp(false).Response.castRes(@alignCast(@ptrCast(socket)))),
        }
    };

    if (this.upgrade_context.request) |request| {
        this.upgrade_context = .{};

        var sec_websocket_protocol_str: ?ZigString.Slice = null;
        var sec_websocket_extensions_str: ?ZigString.Slice = null;

        const sec_websocket_protocol_value = brk: {
            if (sec_websocket_protocol.isEmpty()) {
                break :brk request.header("sec-websocket-protocol") orelse "";
            }
            sec_websocket_protocol_str = sec_websocket_protocol.toSlice(bun.default_allocator);
            break :brk sec_websocket_protocol_str.?.slice();
        };

        const sec_websocket_extensions_value = brk: {
            if (sec_websocket_extensions.isEmpty()) {
                break :brk request.header("sec-websocket-extensions") orelse "";
            }
            sec_websocket_extensions_str = sec_websocket_protocol.toSlice(bun.default_allocator);
            break :brk sec_websocket_extensions_str.?.slice();
        };
        defer {
            if (sec_websocket_protocol_str) |str| str.deinit();
            if (sec_websocket_extensions_str) |str| str.deinit();
        }

        new_socket = this.raw_response.upgrade(
            *ServerWebSocket,
            ws,
            request.header("sec-websocket-key") orelse "",
            sec_websocket_protocol_value,
            sec_websocket_extensions_value,
            upgrade_ctx,
        );
        return true;
    }

    var sec_websocket_protocol_str: ?ZigString.Slice = null;
    var sec_websocket_extensions_str: ?ZigString.Slice = null;

    const sec_websocket_protocol_value = brk: {
        if (sec_websocket_protocol.isEmpty()) {
            break :brk this.upgrade_context.sec_websocket_protocol;
        }
        sec_websocket_protocol_str = sec_websocket_protocol.toSlice(bun.default_allocator);
        break :brk sec_websocket_protocol_str.?.slice();
    };

    const sec_websocket_extensions_value = brk: {
        if (sec_websocket_extensions.isEmpty()) {
            break :brk this.upgrade_context.sec_websocket_extensions;
        }
        sec_websocket_extensions_str = sec_websocket_protocol.toSlice(bun.default_allocator);
        break :brk sec_websocket_extensions_str.?.slice();
    };
    defer {
        if (sec_websocket_protocol_str) |str| str.deinit();
        if (sec_websocket_extensions_str) |str| str.deinit();
    }

    new_socket = this.raw_response.upgrade(
        *ServerWebSocket,
        ws,
        this.upgrade_context.sec_websocket_key,
        sec_websocket_protocol_value,
        sec_websocket_extensions_value,
        upgrade_ctx,
    );
    return true;
}
pub fn maybeStopReadingBody(this: *NodeHTTPResponse, vm: *JSC.VirtualMachine, thisValue: JSC.JSValue) void {
    this.upgrade_context.deinit(); // we can discard the upgrade context now

    if ((this.flags.socket_closed or this.flags.ended) and
        (this.body_read_ref.has or this.body_read_state == .pending) and
        (!this.flags.hasCustomOnData or js.onDataGetCached(thisValue) == null))
    {
        const had_ref = this.body_read_ref.has;
        this.raw_response.clearOnData();
        this.body_read_ref.unref(vm);
        this.body_read_state = .done;

        if (had_ref) {
            this.markRequestAsDoneIfNecessary();
        }
    }
}

pub fn shouldRequestBePending(this: *const NodeHTTPResponse) bool {
    if (this.flags.socket_closed) {
        return false;
    }

    if (this.flags.ended) {
        return this.body_read_state == .pending;
    }

    return true;
}

pub fn dumpRequestBody(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame, thisValue: JSC.JSValue) bun.JSError!JSC.JSValue {
    if (this.buffered_request_body_data_during_pause.cap > 0) {
        this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
    }
    if (!this.flags.request_has_completed) {
        this.clearOnDataCallback(thisValue, globalObject);
    }

    return .js_undefined;
}

fn markRequestAsDone(this: *NodeHTTPResponse) void {
    log("markRequestAsDone()", .{});
    this.flags.is_request_pending = false;

    this.clearOnDataCallback(this.getThisValue(), JSC.VirtualMachine.get().global);
    this.upgrade_context.deinit();

    this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
    const server = this.server;
    this.js_ref.unref(JSC.VirtualMachine.get());
    this.deref();
    server.onRequestComplete();
}

fn markRequestAsDoneIfNecessary(this: *NodeHTTPResponse) void {
    if (this.flags.is_request_pending and !this.shouldRequestBePending()) {
        this.markRequestAsDone();
    }
}

pub fn create(
    any_server_tag: u64,
    globalObject: *JSC.JSGlobalObject,
    has_body: *bool,
    request: *uws.Request,
    is_ssl: i32,
    response_ptr: *anyopaque,
    upgrade_ctx: ?*anyopaque,
    node_response_ptr: *?*NodeHTTPResponse,
) callconv(.C) JSC.JSValue {
    const vm = globalObject.bunVM();
    const method = HTTP.Method.which(request.method()) orelse HTTP.Method.OPTIONS;
    // GET in node.js can have a body
    if (method.hasRequestBody() or method == HTTP.Method.GET) {
        const req_len: usize = brk: {
            if (request.header("content-length")) |content_length| {
                log("content-length: {s}", .{content_length});
                break :brk std.fmt.parseInt(usize, content_length, 10) catch 0;
            }

            break :brk 0;
        };

        has_body.* = req_len > 0 or request.header("transfer-encoding") != null;
    }

    const response = bun.new(NodeHTTPResponse, .{
        // 1 - the HTTP response
        // 1 - the JS object
        // 1 - the Server handler.
        .ref_count = .initExactRefs(3),
        .upgrade_context = .{
            .context = @ptrCast(upgrade_ctx),
            .request = request,
        },
        .server = AnyServer{ .ptr = AnyServer.Ptr.from(@ptrFromInt(any_server_tag)) },
        .raw_response = switch (is_ssl != 0) {
            true => uws.AnyResponse{ .SSL = @ptrCast(response_ptr) },
            false => uws.AnyResponse{ .TCP = @ptrCast(response_ptr) },
        },
        .body_read_state = if (has_body.*) .pending else .none,
    });
    if (has_body.*) {
        response.body_read_ref.ref(vm);
    }
    response.js_ref.ref(vm);
    const js_this = response.toJS(globalObject);
    node_response_ptr.* = response;
    return js_this;
}

pub fn setOnAbortedHandler(this: *NodeHTTPResponse) void {
    if (this.flags.socket_closed) {
        return;
    }
    // Don't overwrite WebSocket user data
    if (!this.flags.upgraded) {
        this.raw_response.onTimeout(*NodeHTTPResponse, onTimeout, this);
    }
    // detach and
    this.upgrade_context.preserveWebSocketHeadersIfNeeded();
}

fn isDone(this: *const NodeHTTPResponse) bool {
    return this.flags.request_has_completed or this.flags.ended or this.flags.socket_closed;
}

pub fn getEnded(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsBoolean(this.flags.ended);
}

pub fn getFinished(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsBoolean(this.flags.request_has_completed);
}

pub fn getFlags(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsNumber(@as(u8, @bitCast(this.flags)));
}

pub fn getAborted(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsBoolean(this.flags.socket_closed);
}

pub fn getHasBody(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    var result: i32 = 0;
    switch (this.body_read_state) {
        .none => {},
        .pending => result |= 1 << 1,
        .done => result |= 1 << 2,
    }
    if (this.buffered_request_body_data_during_pause.len > 0) {
        result |= 1 << 3;
    }
    if (this.flags.is_data_buffered_during_pause_last) {
        result |= 1 << 2;
    }

    return JSC.JSValue.jsNumber(result);
}

pub fn getBufferedAmount(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    if (this.flags.request_has_completed or this.flags.socket_closed) {
        return JSC.JSValue.jsNumber(0);
    }

    return JSC.JSValue.jsNumber(this.raw_response.getBufferedAmount());
}

pub fn jsRef(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (!this.isDone()) {
        this.js_ref.ref(globalObject.bunVM());
    }
    return .js_undefined;
}

pub fn jsUnref(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (!this.isDone()) {
        this.js_ref.unref(globalObject.bunVM());
    }
    return .js_undefined;
}

fn handleEndedIfNecessary(state: uws.State, globalObject: *JSC.JSGlobalObject) bun.JSError!void {
    if (!state.isResponsePending()) {
        return globalObject.ERR(.HTTP_HEADERS_SENT, "Stream is already ended", .{}).throw();
    }
}

extern "C" fn NodeHTTPServer__writeHead_http(
    globalObject: *JSC.JSGlobalObject,
    statusMessage: [*]const u8,
    statusMessageLength: usize,
    headersObjectValue: JSC.JSValue,
    response: *anyopaque,
) void;

extern "C" fn NodeHTTPServer__writeHead_https(
    globalObject: *JSC.JSGlobalObject,
    statusMessage: [*]const u8,
    statusMessageLength: usize,
    headersObjectValue: JSC.JSValue,
    response: *anyopaque,
) void;

pub fn writeHead(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.argumentsUndef(3).slice();

    if (this.isDone()) {
        return globalObject.ERR(.STREAM_ALREADY_FINISHED, "Stream is already ended", .{}).throw();
    }

    const state = this.raw_response.state();
    try handleEndedIfNecessary(state, globalObject);

    const status_code_value: JSValue = if (arguments.len > 0) arguments[0] else .js_undefined;
    const status_message_value: JSValue = if (arguments.len > 1 and arguments[1] != .null) arguments[1] else .js_undefined;
    const headers_object_value: JSValue = if (arguments.len > 2 and arguments[2] != .null) arguments[2] else .js_undefined;

    const status_code: i32 = brk: {
        if (!status_code_value.isUndefined()) {
            break :brk globalObject.validateIntegerRange(status_code_value, i32, 200, .{
                .min = 100,
                .max = 999,
                .field_name = "statusCode",
            }) catch return error.JSError;
        }

        break :brk 200;
    };

    var stack_fallback = std.heap.stackFallback(256, bun.default_allocator);
    const allocator = stack_fallback.get();
    const status_message_slice = if (!status_message_value.isUndefined())
        try status_message_value.toSlice(globalObject, allocator)
    else
        ZigString.Slice.empty;
    defer status_message_slice.deinit();

    if (globalObject.hasException()) {
        return error.JSError;
    }

    if (state.isHttpStatusCalled()) {
        return globalObject.ERR(.HTTP_HEADERS_SENT, "Stream already started", .{}).throw();
    }

    do_it: {
        if (status_message_slice.len == 0) {
            if (HTTPStatusText.get(@intCast(status_code))) |status_message| {
                writeHeadInternal(this.raw_response, globalObject, status_message, headers_object_value);
                break :do_it;
            }
        }

        const message = if (status_message_slice.len > 0) status_message_slice.slice() else "HM";
        const status_message = std.fmt.allocPrint(allocator, "{d} {s}", .{ status_code, message }) catch bun.outOfMemory();
        defer allocator.free(status_message);
        writeHeadInternal(this.raw_response, globalObject, status_message, headers_object_value);
        break :do_it;
    }

    return .js_undefined;
}

fn writeHeadInternal(response: uws.AnyResponse, globalObject: *JSC.JSGlobalObject, status_message: []const u8, headers: JSC.JSValue) void {
    log("writeHeadInternal({s})", .{status_message});
    switch (response) {
        .TCP => NodeHTTPServer__writeHead_http(globalObject, status_message.ptr, status_message.len, headers, @ptrCast(response.TCP)),
        .SSL => NodeHTTPServer__writeHead_https(globalObject, status_message.ptr, status_message.len, headers, @ptrCast(response.SSL)),
    }
}

pub fn writeContinue(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (this.isDone()) {
        return .js_undefined;
    }

    const state = this.raw_response.state();
    try handleEndedIfNecessary(state, globalObject);

    this.raw_response.writeContinue();
    return .js_undefined;
}

pub const AbortEvent = enum(u8) {
    none = 0,
    abort = 1,
    timeout = 2,
};

fn handleAbortOrTimeout(this: *NodeHTTPResponse, comptime event: AbortEvent, js_value: JSC.JSValue) void {
    if (this.flags.request_has_completed) {
        return;
    }

    if (event == .abort) {
        this.flags.socket_closed = true;
    }

    this.ref();
    defer this.deref();
    defer if (event == .abort) this.markRequestAsDoneIfNecessary();

    const js_this: JSValue = if (js_value == .zero) this.getThisValue() else js_value;
    if (js.onAbortedGetCached(js_this)) |on_aborted| {
        const globalThis = JSC.VirtualMachine.get().global;
        defer {
            if (event == .abort) {
                js.onAbortedSetCached(js_this, globalThis, .zero);
            }
        }

        const vm = globalThis.bunVM();
        const event_loop = vm.eventLoop();

        event_loop.runCallback(on_aborted, globalThis, js_this, &.{
            JSC.JSValue.jsNumber(@intFromEnum(event)),
        });
    }

    if (event == .abort) {
        this.onDataOrAborted("", true, .abort, js_this);
    }
}

pub fn onAbort(this: *NodeHTTPResponse, js_value: JSC.JSValue) void {
    log("onAbort", .{});
    this.handleAbortOrTimeout(.abort, js_value);
}

pub fn onTimeout(this: *NodeHTTPResponse, _: uws.AnyResponse) void {
    log("onTimeout", .{});
    this.handleAbortOrTimeout(.timeout, .zero);
}

pub fn doPause(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject, _: *JSC.CallFrame, thisValue: JSC.JSValue) bun.JSError!JSC.JSValue {
    log("doPause", .{});
    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.ended) {
        return .false;
    }
    if (this.body_read_ref.has and js.onDataGetCached(thisValue) == null) {
        this.flags.is_data_buffered_during_pause = true;
        this.raw_response.onData(*NodeHTTPResponse, onBufferRequestBodyWhilePaused, this);
    }

    if (!Environment.isWindows) {
        // TODO: figure out why windows is not emitting EOF with UV_DISCONNECT
        pauseSocket(this);
    }
    return .true;
}

pub fn drainRequestBody(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return this.drainBufferedRequestBodyFromPause(globalObject) orelse .js_undefined;
}

fn drainBufferedRequestBodyFromPause(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject) ?JSC.JSValue {
    if (this.buffered_request_body_data_during_pause.len > 0) {
        const result = JSC.JSValue.createBuffer(globalObject, this.buffered_request_body_data_during_pause.slice(), bun.default_allocator);
        this.buffered_request_body_data_during_pause = .{};
        return result;
    }
    return null;
}

pub fn doResume(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    log("doResume", .{});
    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.ended) {
        return .false;
    }

    var result = JSC.JSValue.true;
    if (this.flags.is_data_buffered_during_pause) {
        this.raw_response.clearOnData();
        this.flags.is_data_buffered_during_pause = false;
    }

    if (this.drainBufferedRequestBodyFromPause(globalObject)) |buffered_data| {
        result = buffered_data;
    }

    resumeSocket(this);
    return result;
}

pub fn onRequestComplete(this: *NodeHTTPResponse) void {
    if (this.flags.request_has_completed) {
        return;
    }
    log("onRequestComplete", .{});
    this.flags.request_has_completed = true;
    this.js_ref.unref(JSC.VirtualMachine.get());

    this.markRequestAsDoneIfNecessary();
}

pub export fn Bun__NodeHTTPRequest__onResolve(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    log("onResolve", .{});
    const arguments = callframe.arguments_old(2).slice();
    const this: *NodeHTTPResponse = arguments[1].as(NodeHTTPResponse).?;
    this.promise.deinit();
    defer this.deref();
    this.maybeStopReadingBody(globalObject.bunVM(), arguments[1]);

    if (!this.flags.request_has_completed and !this.flags.socket_closed) {
        const this_value = this.getThisValue();
        if (this_value != .zero) {
            js.onAbortedSetCached(this_value, globalObject, .zero);
        }
        this.raw_response.clearOnData();
        this.raw_response.clearOnWritable();
        this.raw_response.clearTimeout();
        if (this.raw_response.state().isResponsePending()) {
            this.raw_response.endWithoutBody(this.raw_response.state().isHttpConnectionClose());
        }
        this.onRequestComplete();
    }

    return .js_undefined;
}

pub export fn Bun__NodeHTTPRequest__onReject(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    const err = arguments[0];
    const this: *NodeHTTPResponse = arguments[1].as(NodeHTTPResponse).?;
    this.promise.deinit();
    this.maybeStopReadingBody(globalObject.bunVM(), arguments[1]);

    defer this.deref();

    if (!this.flags.request_has_completed and !this.flags.socket_closed) {
        const this_value = this.getThisValue();
        if (this_value != .zero) {
            js.onAbortedSetCached(this_value, globalObject, .zero);
        }
        this.raw_response.clearOnData();
        this.raw_response.clearOnWritable();
        this.raw_response.clearTimeout();
        if (!this.raw_response.state().isHttpStatusCalled()) {
            this.raw_response.writeStatus("500 Internal Server Error");
        }
        this.raw_response.endStream(this.raw_response.state().isHttpConnectionClose());
        this.onRequestComplete();
    }

    _ = globalObject.bunVM().uncaughtException(globalObject, err, true);
    return .js_undefined;
}

pub fn abort(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (this.isDone()) {
        return .js_undefined;
    }

    this.flags.socket_closed = true;
    const state = this.raw_response.state();
    if (state.isHttpEndCalled()) {
        return .js_undefined;
    }
    resumeSocket(this);
    this.raw_response.clearOnData();
    this.raw_response.clearOnWritable();
    this.raw_response.clearTimeout();
    this.raw_response.endWithoutBody(true);
    this.onRequestComplete();
    return .js_undefined;
}

fn onBufferRequestBodyWhilePaused(this: *NodeHTTPResponse, chunk: []const u8, last: bool) void {
    log("onBufferRequestBodyWhilePaused({d}, {})", .{ chunk.len, last });
    this.buffered_request_body_data_during_pause.append(bun.default_allocator, chunk) catch bun.outOfMemory();
    if (last) {
        this.flags.is_data_buffered_during_pause_last = true;
        if (this.body_read_ref.has) {
            this.body_read_ref.unref(JSC.VirtualMachine.get());
            this.markRequestAsDoneIfNecessary();
        }
    }
}

fn onDataOrAborted(this: *NodeHTTPResponse, chunk: []const u8, last: bool, event: AbortEvent, thisValue: JSC.JSValue) void {
    if (last) {
        this.ref();
        this.body_read_state = .done;
    }

    defer {
        if (last) {
            if (this.body_read_ref.has) {
                this.body_read_ref.unref(JSC.VirtualMachine.get());
                this.markRequestAsDoneIfNecessary();
            }

            this.deref();
        }
    }

    if (js.onDataGetCached(thisValue)) |callback| {
        if (callback.isUndefined()) {
            return;
        }

        const globalThis = JSC.VirtualMachine.get().global;
        const event_loop = globalThis.bunVM().eventLoop();

        const bytes: JSC.JSValue = brk: {
            if (chunk.len > 0 and this.buffered_request_body_data_during_pause.len > 0) {
                const buffer = JSC.JSValue.createBufferFromLength(globalThis, chunk.len + this.buffered_request_body_data_during_pause.len);
                this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
                if (buffer.asArrayBuffer(globalThis)) |array_buffer| {
                    var input = array_buffer.slice();
                    @memcpy(input[0..this.buffered_request_body_data_during_pause.len], this.buffered_request_body_data_during_pause.slice());
                    @memcpy(input[this.buffered_request_body_data_during_pause.len..], chunk);
                    break :brk buffer;
                }
            }

            if (this.drainBufferedRequestBodyFromPause(globalThis)) |buffered_data| {
                break :brk buffered_data;
            }

            if (chunk.len > 0) {
                break :brk JSC.ArrayBuffer.createBuffer(globalThis, chunk);
            }
            break :brk .js_undefined;
        };

        event_loop.runCallback(callback, globalThis, .js_undefined, &.{
            bytes,
            JSC.JSValue.jsBoolean(last),
            JSC.JSValue.jsNumber(@intFromEnum(event)),
        });
    }
}
pub const BUN_DEBUG_REFCOUNT_NAME = "NodeHTTPServerResponse";
pub fn onData(this: *NodeHTTPResponse, chunk: []const u8, last: bool) void {
    log("onData({d} bytes, is_last = {d})", .{ chunk.len, @intFromBool(last) });

    onDataOrAborted(this, chunk, last, .none, this.getThisValue());
}

fn onDrain(this: *NodeHTTPResponse, offset: u64, response: uws.AnyResponse) bool {
    log("onDrain({d})", .{offset});
    this.ref();
    defer this.deref();
    response.clearOnWritable();
    if (this.flags.socket_closed or this.flags.request_has_completed) {
        // return false means we don't have anything to drain
        return false;
    }
    const thisValue = this.getThisValue();
    const on_writable = js.onWritableGetCached(thisValue) orelse return false;
    const globalThis = JSC.VirtualMachine.get().global;
    js.onWritableSetCached(thisValue, globalThis, .js_undefined); // TODO(@heimskr): is this necessary?
    const vm = globalThis.bunVM();

    response.corked(JSC.EventLoop.runCallback, .{ vm.eventLoop(), on_writable, globalThis, .js_undefined, &.{JSC.JSValue.jsNumberFromUint64(offset)} });
    // return true means we may have something to drain
    return true;
}

fn writeOrEnd(
    this: *NodeHTTPResponse,
    globalObject: *JSC.JSGlobalObject,
    arguments: []const JSC.JSValue,
    this_value: JSC.JSValue,
    comptime is_end: bool,
) bun.JSError!JSC.JSValue {
    if (this.isDone()) {
        return globalObject.ERR(.STREAM_WRITE_AFTER_END, "Stream already ended", .{}).throw();
    }

    const state = this.raw_response.state();
    if (!state.isResponsePending()) {
        return globalObject.ERR(.STREAM_WRITE_AFTER_END, "Stream already ended", .{}).throw();
    }

    const input_value: JSValue = if (arguments.len > 0) arguments[0] else .js_undefined;
    var encoding_value: JSValue = if (arguments.len > 1) arguments[1] else .js_undefined;
    const callback_value: JSValue = brk: {
        if (!encoding_value.isUndefinedOrNull() and encoding_value.isCallable()) {
            encoding_value = .js_undefined;
            break :brk arguments[1];
        }

        if (arguments.len > 2 and !arguments[2].isUndefined()) {
            if (!arguments[2].isCallable()) {
                return globalObject.throwInvalidArgumentTypeValue("callback", "function", arguments[2]);
            }

            break :brk arguments[2];
        }

        break :brk .js_undefined;
    };

    const strict_content_length: ?u64 = brk: {
        if (arguments.len > 3 and arguments[3].isNumber()) {
            break :brk @max(arguments[3].toInt64(), 0);
        }
        break :brk null;
    };

    const string_or_buffer: JSC.Node.StringOrBuffer = brk: {
        if (input_value.isUndefinedOrNull()) {
            break :brk JSC.Node.StringOrBuffer.empty;
        }

        var encoding: JSC.Node.Encoding = .utf8;
        if (!encoding_value.isUndefinedOrNull()) {
            if (!encoding_value.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("encoding", "string", encoding_value);
            }

            encoding = try JSC.Node.Encoding.fromJS(encoding_value, globalObject) orelse {
                return globalObject.throwInvalidArguments("Invalid encoding", .{});
            };
        }

        const result = try JSC.Node.StringOrBuffer.fromJSWithEncoding(globalObject, bun.default_allocator, input_value, encoding);
        break :brk result orelse {
            return globalObject.throwInvalidArgumentTypeValue("input", "string or buffer", input_value);
        };
    };
    defer string_or_buffer.deinit();

    if (globalObject.hasException()) {
        return error.JSError;
    }

    const bytes = string_or_buffer.slice();

    if (comptime is_end) {
        log("end('{s}', {d})", .{ bytes[0..@min(bytes.len, 128)], bytes.len });
    } else {
        log("write('{s}', {d})", .{ bytes[0..@min(bytes.len, 128)], bytes.len });
    }
    if (strict_content_length) |content_length| {
        const bytes_written = this.bytes_written + bytes.len;

        if (is_end) {
            if (bytes_written != content_length) {
                return globalObject.ERR(.HTTP_CONTENT_LENGTH_MISMATCH, "Content-Length mismatch", .{}).throw();
            }
        } else if (bytes_written > content_length) {
            return globalObject.ERR(.HTTP_CONTENT_LENGTH_MISMATCH, "Content-Length mismatch", .{}).throw();
        }
        this.bytes_written = bytes_written;
    } else {
        this.bytes_written +|= bytes.len;
    }
    if (is_end) {

        // Discard the body read ref if it's pending and no onData callback is set at this point.
        // This is the equivalent of req._dump().
        if (this.body_read_ref.has and this.body_read_state == .pending and (!this.flags.hasCustomOnData or js.onDataGetCached(this_value) == null)) {
            this.body_read_ref.unref(JSC.VirtualMachine.get());
            this.body_read_state = .none;
        }

        if (this_value != .zero) {
            js.onAbortedSetCached(this_value, globalObject, .zero);
        }

        this.raw_response.clearAborted();
        this.raw_response.clearOnWritable();
        this.raw_response.clearTimeout();
        this.flags.ended = true;
        if (!state.isHttpWriteCalled() or bytes.len > 0) {
            this.raw_response.end(bytes, state.isHttpConnectionClose());
        } else {
            this.raw_response.endStream(state.isHttpConnectionClose());
        }
        this.onRequestComplete();

        return JSC.JSValue.jsNumberFromUint64(bytes.len);
    } else {
        const js_this = if (this_value != .zero) this_value else this.getThisValue();
        switch (this.raw_response.write(bytes)) {
            .want_more => |written| {
                this.raw_response.clearOnWritable();
                js.onWritableSetCached(js_this, globalObject, .js_undefined);
                return JSC.JSValue.jsNumberFromUint64(written);
            },
            .backpressure => |written| {
                if (!callback_value.isUndefined()) {
                    js.onWritableSetCached(js_this, globalObject, callback_value.withAsyncContextIfNeeded(globalObject));
                    this.raw_response.onWritable(*NodeHTTPResponse, onDrain, this);
                }

                return JSC.JSValue.jsNumberFromInt64(-@as(i64, @intCast(@min(written, std.math.maxInt(i64)))));
            },
        }
    }
}

pub fn setOnWritable(this: *NodeHTTPResponse, thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) void {
    if (this.isDone() or value.isUndefined()) {
        js.onWritableSetCached(thisValue, globalObject, .js_undefined);
    } else {
        js.onWritableSetCached(thisValue, globalObject, value.withAsyncContextIfNeeded(globalObject));
    }
}

pub fn getOnWritable(_: *NodeHTTPResponse, thisValue: JSC.JSValue, _: *JSC.JSGlobalObject) JSC.JSValue {
    return js.onWritableGetCached(thisValue) orelse .js_undefined;
}

pub fn getOnAbort(this: *NodeHTTPResponse, thisValue: JSC.JSValue, _: *JSC.JSGlobalObject) JSC.JSValue {
    if (this.flags.socket_closed) {
        return .js_undefined;
    }
    return js.onAbortedGetCached(thisValue) orelse .js_undefined;
}

pub fn setOnAbort(this: *NodeHTTPResponse, thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) void {
    if (this.flags.socket_closed) {
        return;
    }

    if (this.isDone() or value.isUndefined()) {
        js.onAbortedSetCached(thisValue, globalObject, .zero);
    } else {
        js.onAbortedSetCached(thisValue, globalObject, value.withAsyncContextIfNeeded(globalObject));
    }
}

pub fn getOnData(_: *NodeHTTPResponse, thisValue: JSC.JSValue, _: *JSC.JSGlobalObject) JSC.JSValue {
    return js.onDataGetCached(thisValue) orelse .js_undefined;
}

pub fn getHasCustomOnData(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.jsBoolean(this.flags.hasCustomOnData);
}

pub fn getUpgraded(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.jsBoolean(this.flags.upgraded);
}

pub fn setHasCustomOnData(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject, value: JSValue) void {
    this.flags.hasCustomOnData = value.toBoolean();
}

fn clearOnDataCallback(this: *NodeHTTPResponse, thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject) void {
    if (this.body_read_state != .none) {
        if (thisValue != .zero) {
            js.onDataSetCached(thisValue, globalObject, .js_undefined);
        }
        if (!this.flags.socket_closed)
            this.raw_response.clearOnData();
        if (this.body_read_state != .done) {
            this.body_read_state = .done;
        }
    }
}

pub fn setOnData(this: *NodeHTTPResponse, thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSValue) void {
    if (value.isUndefined() or this.flags.ended or this.flags.socket_closed or this.body_read_state == .none or this.flags.is_data_buffered_during_pause_last) {
        js.onDataSetCached(thisValue, globalObject, .js_undefined);
        defer {
            if (this.body_read_ref.has) {
                this.body_read_ref.unref(globalObject.bunVM());
            }
        }
        switch (this.body_read_state) {
            .pending, .done => {
                if (!this.flags.request_has_completed and !this.flags.socket_closed) {
                    this.raw_response.clearOnData();
                }
                this.body_read_state = .done;
            },
            .none => {},
        }
        return;
    }

    js.onDataSetCached(thisValue, globalObject, value.withAsyncContextIfNeeded(globalObject));
    this.flags.hasCustomOnData = true;
    this.raw_response.onData(*NodeHTTPResponse, onData, this);
    this.flags.is_data_buffered_during_pause = false;

    if (!this.body_read_ref.has) {
        this.ref();
        this.body_read_ref.ref(globalObject.bunVM());
    }
}

pub fn write(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments();

    return writeOrEnd(this, globalObject, arguments, .zero, false);
}

pub fn flushHeaders(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    this.raw_response.flushHeaders();
    return .js_undefined;
}

pub fn end(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments();
    //We dont wanna a paused socket when we call end, so is important to resume the socket
    resumeSocket(this);
    return writeOrEnd(this, globalObject, arguments, callframe.this(), true);
}

pub fn getBytesWritten(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
    return JSC.JSValue.jsNumber(this.bytes_written);
}

fn handleCorked(globalObject: *JSC.JSGlobalObject, function: JSC.JSValue, result: *JSValue, is_exception: *bool) void {
    result.* = function.call(globalObject, .js_undefined, &.{}) catch |err| {
        result.* = globalObject.takeException(err);
        is_exception.* = true;
        return;
    };
}

pub fn setTimeout(this: *NodeHTTPResponse, seconds: u8) void {
    if (this.flags.request_has_completed or this.flags.socket_closed) {
        return;
    }

    this.raw_response.timeout(seconds);
}

export fn NodeHTTPResponse__setTimeout(this: *NodeHTTPResponse, seconds: JSC.JSValue, globalThis: *JSC.JSGlobalObject) bool {
    if (!seconds.isNumber()) {
        globalThis.throwInvalidArgumentTypeValue("timeout", "number", seconds) catch {};
        return false;
    }

    if (this.flags.request_has_completed or this.flags.socket_closed) {
        return false;
    }

    this.raw_response.timeout(@intCast(@min(seconds.to(c_uint), 255)));
    return true;
}

pub fn cork(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("cork", 1, 0);
    }

    if (!arguments[0].isCallable()) {
        return globalObject.throwInvalidArgumentTypeValue("cork", "function", arguments[0]);
    }

    if (this.flags.request_has_completed or this.flags.socket_closed) {
        return globalObject.ERR(.STREAM_ALREADY_FINISHED, "Stream is already ended", .{}).throw();
    }

    var result: JSC.JSValue = .zero;
    var is_exception: bool = false;
    this.ref();
    defer this.deref();

    this.raw_response.corked(handleCorked, .{ globalObject, arguments[0], &result, &is_exception });

    if (is_exception) {
        if (result != .zero) {
            return globalObject.throwValue(result);
        } else {
            return globalObject.throw("unknown error", .{});
        }
    }

    if (result == .zero) {
        return .js_undefined;
    }

    return result;
}
pub fn finalize(this: *NodeHTTPResponse) void {
    this.deref();
}

fn deinit(this: *NodeHTTPResponse) void {
    bun.debugAssert(!this.body_read_ref.has);
    bun.debugAssert(!this.js_ref.has);
    bun.debugAssert(!this.flags.is_request_pending);
    bun.debugAssert(this.flags.socket_closed or this.flags.request_has_completed);

    this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
    this.js_ref.unref(JSC.VirtualMachine.get());
    this.body_read_ref.unref(JSC.VirtualMachine.get());

    this.promise.deinit();
    bun.destroy(this);
}

comptime {
    @export(&create, .{ .name = "NodeHTTPResponse__createForJS" });
}
extern "c" fn Bun__setNodeHTTPServerSocketUsSocketValue(JSC.JSValue, ?*anyopaque) void;

pub export fn Bun__NodeHTTPResponse_onClose(response: *NodeHTTPResponse, js_value: JSC.JSValue) void {
    response.onAbort(js_value);
}

pub export fn Bun__NodeHTTPResponse_setClosed(response: *NodeHTTPResponse) void {
    response.flags.socket_closed = true;
}

const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSC = bun.JSC;
const bun = @import("bun");
const string = []const u8;
const Environment = bun.Environment;
const std = @import("std");
const ZigString = JSC.ZigString;
const uws = bun.uws;
const Output = bun.Output;
const AnyServer = JSC.API.AnyServer;
const HTTP = bun.http;
const HTTPStatusText = @import("../server.zig").HTTPStatusText;
const ServerWebSocket = JSC.API.ServerWebSocket;
