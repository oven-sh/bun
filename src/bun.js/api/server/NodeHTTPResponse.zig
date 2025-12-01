const NodeHTTPResponse = @This();

const log = bun.Output.scoped(.NodeHTTPResponse, .visible);

pub const js = jsc.Codegen.JSNodeHTTPResponse;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,

raw_response: ?uws.AnyResponse,

flags: Flags = .{},

poll_ref: jsc.Ref = .{},

body_read_state: BodyReadState = .none,
body_read_ref: jsc.Ref = .{},
promise: jsc.Strong.Optional = .empty,
server: AnyServer,

/// When you call pause() on the node:http IncomingMessage
/// We might've already read from the socket.
/// So we need to buffer that data.
/// This should be pretty uncommon though.
buffered_request_body_data_during_pause: bun.ByteList = .{},
bytes_written: usize = 0,

upgrade_context: UpgradeCTX = .{},

auto_flusher: AutoFlusher = .{},

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

    /// Did the user end the request?
    pub fn isRequestedCompletedOrEnded(this: *const Flags) bool {
        return this.request_has_completed or this.ended;
    }

    pub fn isDone(this: *const Flags) bool {
        return this.isRequestedCompletedOrEnded() or this.socket_closed;
    }
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
                this.sec_websocket_key = bun.handleOom(bun.default_allocator.dupe(u8, sec_websocket_key));
            }
            if (sec_websocket_protocol.len > 0) {
                this.sec_websocket_protocol = bun.handleOom(bun.default_allocator.dupe(u8, sec_websocket_protocol));
            }
            if (sec_websocket_extensions.len > 0) {
                this.sec_websocket_extensions = bun.handleOom(bun.default_allocator.dupe(u8, sec_websocket_extensions));
            }
        }
    }
};

pub const BodyReadState = enum(u8) {
    none = 0,
    pending = 1,
    done = 2,
};

extern "C" fn Bun__getNodeHTTPResponseThisValue(bool, *anyopaque) jsc.JSValue;
pub fn getThisValue(this: *NodeHTTPResponse) jsc.JSValue {
    if (this.flags.socket_closed or this.flags.upgraded or this.raw_response == null) {
        return .zero;
    }

    return Bun__getNodeHTTPResponseThisValue(this.raw_response.? == .SSL, this.raw_response.?.socket());
}

extern "C" fn Bun__getNodeHTTPServerSocketThisValue(bool, *anyopaque) jsc.JSValue;
pub fn getServerSocketValue(this: *NodeHTTPResponse) jsc.JSValue {
    if (this.flags.socket_closed or this.flags.upgraded or this.raw_response == null) {
        return .zero;
    }
    return Bun__getNodeHTTPServerSocketThisValue(this.raw_response.? == .SSL, this.raw_response.?.socket());
}

pub fn pauseSocket(this: *NodeHTTPResponse) void {
    log("pauseSocket", .{});
    if (this.flags.socket_closed or this.flags.upgraded or this.raw_response == null or this.raw_response.?.isConnectRequest()) {
        return;
    }

    this.raw_response.?.pause();
}

pub fn resumeSocket(this: *NodeHTTPResponse) void {
    log("resumeSocket", .{});
    if (this.flags.socket_closed or this.flags.upgraded or this.raw_response == null or this.raw_response.?.isConnectRequest()) {
        return;
    }

    this.raw_response.?.@"resume"();
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

    const ws = ServerWebSocket.init(ws_handler, data_value, null);

    var sec_websocket_protocol_str: ?ZigString.Slice = null;
    defer if (sec_websocket_protocol_str) |*str| str.deinit();
    var sec_websocket_extensions_str: ?ZigString.Slice = null;
    defer if (sec_websocket_extensions_str) |*str| str.deinit();

    const sec_websocket_protocol_value = brk: {
        if (sec_websocket_protocol.isEmpty()) {
            if (this.upgrade_context.request) |request| {
                break :brk request.header("sec-websocket-protocol") orelse "";
            } else {
                break :brk this.upgrade_context.sec_websocket_protocol;
            }
        }
        sec_websocket_protocol_str = sec_websocket_protocol.toSlice(bun.default_allocator);
        break :brk sec_websocket_protocol_str.?.slice();
    };

    const sec_websocket_extensions_value = brk: {
        if (sec_websocket_extensions.isEmpty()) {
            if (this.upgrade_context.request) |request| {
                break :brk request.header("sec-websocket-extensions") orelse "";
            } else {
                break :brk this.upgrade_context.sec_websocket_extensions;
            }
        }
        sec_websocket_extensions_str = sec_websocket_extensions.toSlice(bun.default_allocator);
        break :brk sec_websocket_extensions_str.?.slice();
    };

    const websocket_key = if (this.upgrade_context.request) |request|
        request.header("sec-websocket-key") orelse ""
    else
        this.upgrade_context.sec_websocket_key;

    if (this.raw_response) |raw_response| {
        this.raw_response = null;
        this.flags.upgraded = true;
        // Unref the poll_ref since the socket is now upgraded to WebSocket
        // and will have its own lifecycle management
        this.poll_ref.unref(this.server.globalThis().bunVM());
        _ = raw_response.upgrade(*ServerWebSocket, ws, websocket_key, sec_websocket_protocol_value, sec_websocket_extensions_value, upgrade_ctx);
    }
    return true;
}
pub fn maybeStopReadingBody(this: *NodeHTTPResponse, vm: *jsc.VirtualMachine, thisValue: jsc.JSValue) void {
    this.upgrade_context.deinit(); // we can discard the upgrade context now

    if ((this.flags.upgraded or this.flags.socket_closed or this.flags.ended) and
        (this.body_read_ref.has or this.body_read_state == .pending) and
        (!this.flags.hasCustomOnData or js.onDataGetCached(thisValue) == null))
    {
        const had_ref = this.body_read_ref.has;
        if (!this.flags.upgraded and !this.flags.socket_closed) {
            log("clearOnData", .{});
            if (this.raw_response) |raw_response| {
                raw_response.clearOnData();
            }
        }

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

pub fn dumpRequestBody(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame, thisValue: jsc.JSValue) bun.JSError!jsc.JSValue {
    if (this.buffered_request_body_data_during_pause.cap > 0) {
        this.buffered_request_body_data_during_pause.clearAndFree(bun.default_allocator);
    }
    if (!this.flags.request_has_completed) {
        this.clearOnDataCallback(thisValue, globalObject);
    }

    return .js_undefined;
}

fn markRequestAsDone(this: *NodeHTTPResponse) void {
    log("markRequestAsDone()", .{});
    defer this.deref();
    this.flags.is_request_pending = false;

    this.clearOnDataCallback(this.getThisValue(), jsc.VirtualMachine.get().global);
    this.upgrade_context.deinit();

    this.buffered_request_body_data_during_pause.clearAndFree(bun.default_allocator);
    const server = this.server;
    this.poll_ref.unref(jsc.VirtualMachine.get());
    this.unregisterAutoFlush();

    server.onRequestComplete();
}

fn markRequestAsDoneIfNecessary(this: *NodeHTTPResponse) void {
    if (this.flags.is_request_pending and !this.shouldRequestBePending()) {
        this.markRequestAsDone();
    }
}

pub fn create(
    any_server_tag: u64,
    globalObject: *jsc.JSGlobalObject,
    has_body: *bool,
    request: *uws.Request,
    is_ssl: i32,
    response_ptr: *anyopaque,
    upgrade_ctx: ?*anyopaque,
    node_response_ptr: *?*NodeHTTPResponse,
) callconv(.c) jsc.JSValue {
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
    response.poll_ref.ref(vm);
    const js_this = response.toJS(globalObject);
    node_response_ptr.* = response;
    return js_this;
}

fn isDone(this: *const NodeHTTPResponse) bool {
    return this.flags.isDone();
}

fn isRequestedCompletedOrEnded(this: *const NodeHTTPResponse) bool {
    return this.flags.isRequestedCompletedOrEnded();
}

pub fn setOnAbortedHandler(this: *NodeHTTPResponse) void {
    if (this.flags.socket_closed) {
        return;
    }
    // Don't overwrite WebSocket user data
    if (!this.flags.upgraded) {
        if (this.raw_response) |raw_response| {
            raw_response.onTimeout(*NodeHTTPResponse, onTimeout, this);
        }
    }
    // detach and
    this.upgrade_context.preserveWebSocketHeadersIfNeeded();
}

pub fn getEnded(this: *const NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.flags.ended);
}

pub fn getFinished(this: *const NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.flags.request_has_completed);
}

pub fn getFlags(this: *const NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(u8, @bitCast(this.flags)));
}

pub fn getAborted(this: *const NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.flags.socket_closed);
}

pub fn getHasBody(this: *const NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
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

    return jsc.JSValue.jsNumber(result);
}

pub fn getBufferedAmount(this: *const NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    if (this.flags.request_has_completed or this.flags.socket_closed) {
        return jsc.JSValue.jsNumber(0);
    }
    if (this.raw_response) |raw_response| {
        return jsc.JSValue.jsNumber(raw_response.getBufferedAmount());
    }
    return jsc.JSValue.jsNumber(0);
}

pub fn jsRef(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (!this.isDone()) {
        this.poll_ref.ref(globalObject.bunVM());
    }
    return .js_undefined;
}

pub fn jsUnref(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (!this.isDone()) {
        this.poll_ref.unref(globalObject.bunVM());
    }
    return .js_undefined;
}

fn handleEndedIfNecessary(state: uws.State, globalObject: *jsc.JSGlobalObject) bun.JSError!void {
    if (!state.isResponsePending()) {
        return globalObject.ERR(.HTTP_HEADERS_SENT, "Stream is already ended", .{}).throw();
    }
}

extern "C" fn NodeHTTPServer__writeHead_http(
    globalObject: *jsc.JSGlobalObject,
    statusMessage: [*]const u8,
    statusMessageLength: usize,
    headersObjectValue: jsc.JSValue,
    response: *anyopaque,
) void;

extern "C" fn NodeHTTPServer__writeHead_https(
    globalObject: *jsc.JSGlobalObject,
    statusMessage: [*]const u8,
    statusMessageLength: usize,
    headersObjectValue: jsc.JSValue,
    response: *anyopaque,
) void;

pub fn writeHead(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsUndef(3).slice();

    if (this.isRequestedCompletedOrEnded()) {
        return globalObject.ERR(.STREAM_ALREADY_FINISHED, "Stream is already ended", .{}).throw();
    }

    if (this.flags.socket_closed or this.flags.upgraded or this.raw_response == null) {
        // We haven't emitted the "close" event yet.
        return .js_undefined;
    }

    const state = this.raw_response.?.state();
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
                writeHeadInternal(this.raw_response.?, globalObject, status_message, headers_object_value);
                break :do_it;
            }
        }

        const message = if (status_message_slice.len > 0) status_message_slice.slice() else "HM";
        const status_message = bun.handleOom(std.fmt.allocPrint(allocator, "{d} {s}", .{ status_code, message }));
        defer allocator.free(status_message);
        writeHeadInternal(this.raw_response.?, globalObject, status_message, headers_object_value);
        break :do_it;
    }

    return .js_undefined;
}

fn writeHeadInternal(response: uws.AnyResponse, globalObject: *jsc.JSGlobalObject, status_message: []const u8, headers: jsc.JSValue) void {
    log("writeHeadInternal({s})", .{status_message});
    switch (response) {
        .TCP => NodeHTTPServer__writeHead_http(globalObject, status_message.ptr, status_message.len, headers, @ptrCast(response.TCP)),
        .SSL => NodeHTTPServer__writeHead_https(globalObject, status_message.ptr, status_message.len, headers, @ptrCast(response.SSL)),
    }
}

pub fn writeContinue(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.isDone()) {
        return .js_undefined;
    }
    const raw_response = this.raw_response orelse return .js_undefined;
    const state = raw_response.state();
    try handleEndedIfNecessary(state, globalObject);

    raw_response.writeContinue();
    return .js_undefined;
}

pub const AbortEvent = enum(u8) {
    none = 0,
    abort = 1,
    timeout = 2,
};

fn handleAbortOrTimeout(this: *NodeHTTPResponse, comptime event: AbortEvent, js_value: jsc.JSValue) void {
    defer {
        if (event == .abort) this.raw_response = null;
    }
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
        const globalThis = jsc.VirtualMachine.get().global;
        defer {
            if (event == .abort) {
                js.onAbortedSetCached(js_this, globalThis, .zero);
            }
        }

        const vm = globalThis.bunVM();
        const event_loop = vm.eventLoop();

        event_loop.runCallback(on_aborted, globalThis, js_this, &.{
            jsc.JSValue.jsNumber(@intFromEnum(event)),
        });
    }

    if (event == .abort) {
        this.onDataOrAborted("", true, .abort, js_this);
    }
}

pub fn onAbort(this: *NodeHTTPResponse, js_value: jsc.JSValue) void {
    log("onAbort", .{});
    this.handleAbortOrTimeout(.abort, js_value);
}

pub fn onTimeout(this: *NodeHTTPResponse, _: uws.AnyResponse) void {
    log("onTimeout", .{});
    this.handleAbortOrTimeout(.timeout, .zero);
}

pub fn doPause(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject, _: *jsc.CallFrame, _: jsc.JSValue) bun.JSError!jsc.JSValue {
    log("doPause", .{});
    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.ended or this.flags.upgraded or this.raw_response == null) {
        return .false;
    }
    this.flags.is_data_buffered_during_pause = true;
    this.raw_response.?.onData(*NodeHTTPResponse, onBufferRequestBodyWhilePaused, this);

    // TODO: figure out why windows is not emitting EOF with UV_DISCONNECT
    if (!Environment.isWindows) {
        pauseSocket(this);
    }
    return .true;
}

pub fn drainRequestBody(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.drainBufferedRequestBodyFromPause(globalObject) orelse .js_undefined;
}

fn drainBufferedRequestBodyFromPause(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject) ?jsc.JSValue {
    log("drainBufferedRequestBodyFromPause {d}", .{this.buffered_request_body_data_during_pause.len});
    if (this.buffered_request_body_data_during_pause.len > 0) {
        const result = jsc.JSValue.createBuffer(globalObject, this.buffered_request_body_data_during_pause.slice());
        this.buffered_request_body_data_during_pause = .{};
        return result;
    }
    return null;
}

pub fn doResume(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) jsc.JSValue {
    log("doResume", .{});
    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.ended or this.flags.upgraded or this.raw_response == null) {
        return .false;
    }
    this.setOnAbortedHandler();
    this.raw_response.?.onData(*NodeHTTPResponse, onData, this);
    this.flags.is_data_buffered_during_pause = false;
    var result: jsc.JSValue = .true;

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
    this.poll_ref.unref(jsc.VirtualMachine.get());

    this.markRequestAsDoneIfNecessary();
}

pub export fn Bun__NodeHTTPRequest__onResolve(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) jsc.JSValue {
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
        log("clearOnData", .{});
        if (this.raw_response) |raw_response| {
            raw_response.clearOnData();
            raw_response.clearOnWritable();
            raw_response.clearTimeout();
            if (raw_response.state().isResponsePending()) {
                raw_response.endWithoutBody(raw_response.state().isHttpConnectionClose());
            }
        }
        this.onRequestComplete();
    }

    return .js_undefined;
}

pub export fn Bun__NodeHTTPRequest__onReject(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) callconv(jsc.conv) jsc.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    const err = arguments[0];
    const this: *NodeHTTPResponse = arguments[1].as(NodeHTTPResponse).?;
    this.promise.deinit();
    this.maybeStopReadingBody(globalObject.bunVM(), arguments[1]);

    defer this.deref();

    if (!this.flags.request_has_completed and !this.flags.socket_closed and !this.flags.upgraded) {
        const this_value = this.getThisValue();
        if (this_value != .zero) {
            js.onAbortedSetCached(this_value, globalObject, .zero);
        }
        log("clearOnData", .{});
        if (this.raw_response) |raw_response| {
            raw_response.clearOnData();
            raw_response.clearOnWritable();
            raw_response.clearTimeout();
            if (!raw_response.state().isHttpStatusCalled()) {
                raw_response.writeStatus("500 Internal Server Error");
            }
            raw_response.endStream(raw_response.state().isHttpConnectionClose());
        }

        this.onRequestComplete();
    }

    _ = globalObject.bunVM().uncaughtException(globalObject, err, true);
    return .js_undefined;
}

pub fn abort(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.isDone()) {
        return .js_undefined;
    }

    this.flags.socket_closed = true;
    if (this.raw_response) |raw_response| {
        const state = raw_response.state();
        if (state.isHttpEndCalled()) {
            return .js_undefined;
        }
        resumeSocket(this);
        log("clearOnData", .{});
        raw_response.clearOnData();
        raw_response.clearOnWritable();
        raw_response.clearTimeout();
        raw_response.endWithoutBody(true);
    }
    this.onRequestComplete();
    return .js_undefined;
}

fn onBufferRequestBodyWhilePaused(this: *NodeHTTPResponse, chunk: []const u8, last: bool) void {
    log("onBufferRequestBodyWhilePaused({d}, {})", .{ chunk.len, last });
    bun.handleOom(this.buffered_request_body_data_during_pause.appendSlice(
        bun.default_allocator,
        chunk,
    ));
    if (last) {
        this.flags.is_data_buffered_during_pause_last = true;
        if (this.body_read_ref.has) {
            this.body_read_ref.unref(jsc.VirtualMachine.get());
            this.markRequestAsDoneIfNecessary();
        }
    }
}

fn getBytes(this: *NodeHTTPResponse, globalThis: *jsc.JSGlobalObject, chunk: []const u8) jsc.JSValue {
    // TODO: we should have a error event for this but is better than ignoring it
    // right now the socket instead of emitting an error event it will reportUncaughtException
    // this makes the behavior aligned with current implementation, but not ideal
    const bytes: jsc.JSValue = brk: {
        if (chunk.len > 0 and this.buffered_request_body_data_during_pause.len > 0) {
            const buffer = jsc.JSValue.createBufferFromLength(globalThis, chunk.len + this.buffered_request_body_data_during_pause.len) catch |err| {
                globalThis.reportUncaughtExceptionFromError(err);
                return .js_undefined;
            };

            const array_buffer = buffer.asArrayBuffer(globalThis).?;

            defer this.buffered_request_body_data_during_pause.clearAndFree(bun.default_allocator);
            var input = array_buffer.slice();
            @memcpy(input[0..this.buffered_request_body_data_during_pause.len], this.buffered_request_body_data_during_pause.slice());
            @memcpy(input[this.buffered_request_body_data_during_pause.len..], chunk);
            break :brk buffer;
        }

        if (this.drainBufferedRequestBodyFromPause(globalThis)) |buffered_data| {
            break :brk buffered_data;
        }

        if (chunk.len > 0) {
            break :brk jsc.ArrayBuffer.createBuffer(globalThis, chunk) catch |err| {
                globalThis.reportUncaughtExceptionFromError(err);
                return .js_undefined;
            };
        }
        break :brk .js_undefined;
    };
    return bytes;
}

fn onDataOrAborted(this: *NodeHTTPResponse, chunk: []const u8, last: bool, event: AbortEvent, thisValue: jsc.JSValue) void {
    log("onDataOrAborted({d}, {})", .{ chunk.len, last });
    if (last) {
        this.ref();
        this.body_read_state = .done;
    }

    defer {
        if (last) {
            if (this.body_read_ref.has) {
                this.body_read_ref.unref(jsc.VirtualMachine.get());
                this.markRequestAsDoneIfNecessary();
            }

            this.deref();
        }
    }

    if (js.onDataGetCached(thisValue)) |callback| {
        if (callback.isUndefined()) {
            return;
        }

        const globalThis = jsc.VirtualMachine.get().global;
        const event_loop = globalThis.bunVM().eventLoop();

        const bytes = this.getBytes(globalThis, chunk);

        event_loop.runCallback(callback, globalThis, .js_undefined, &.{
            bytes,
            jsc.JSValue.jsBoolean(last),
            jsc.JSValue.jsNumber(@intFromEnum(event)),
        });
    }
}
pub const BUN_DEBUG_REFCOUNT_NAME = "NodeHTTPServerResponse";
pub fn onData(this: *NodeHTTPResponse, chunk: []const u8, last: bool) void {
    log("onData({d} bytes, is_last = {d})", .{ chunk.len, @intFromBool(last) });

    onDataOrAborted(this, chunk, last, .none, this.getThisValue());
}

fn onDrainCorked(this: *NodeHTTPResponse, offset: u64) void {
    log("onDrainCorked({d})", .{offset});
    this.ref();
    defer this.deref();

    const thisValue = this.getThisValue();
    const on_writable = js.onWritableGetCached(thisValue) orelse return;
    const globalThis = jsc.VirtualMachine.get().global;
    js.onWritableSetCached(thisValue, globalThis, .js_undefined); // TODO(@heimskr): is this necessary?
    const vm = globalThis.bunVM();

    vm.eventLoop().runCallback(on_writable, globalThis, .js_undefined, &.{jsc.JSValue.jsNumberFromUint64(offset)});
}

fn onDrain(this: *NodeHTTPResponse, offset: u64, response: uws.AnyResponse) bool {
    log("onDrain({d})", .{offset});

    if (this.flags.socket_closed or this.flags.request_has_completed or this.flags.upgraded) {
        // return false means we don't have anything to drain
        return false;
    }

    response.corked(onDrainCorked, .{ this, offset });
    // return true means we may have something to drain
    return true;
}

fn writeOrEnd(
    this: *NodeHTTPResponse,
    globalObject: *jsc.JSGlobalObject,
    arguments: []const jsc.JSValue,
    this_value: jsc.JSValue,
    comptime is_end: bool,
) bun.JSError!jsc.JSValue {
    if (this.isRequestedCompletedOrEnded()) {
        return globalObject.ERR(.STREAM_WRITE_AFTER_END, "Stream already ended", .{}).throw();
    }

    // Loosely mimicking this code:
    //      function _writeRaw(data, encoding, callback, size) {
    //        const conn = this[kSocket];
    //        if (conn?.destroyed) {
    //          // The socket was destroyed. If we're still trying to write to it,
    //          // then we haven't gotten the 'close' event yet.
    //          return false;
    //        }
    if (this.flags.socket_closed or this.raw_response == null) {
        return if (is_end) .js_undefined else jsc.JSValue.jsNumber(0);
    }

    const raw_response = this.raw_response.?;

    const state = raw_response.state();
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

    const string_or_buffer: jsc.Node.StringOrBuffer = brk: {
        if (input_value.isUndefinedOrNull()) {
            break :brk jsc.Node.StringOrBuffer.empty;
        }

        var encoding: jsc.Node.Encoding = .utf8;
        if (!encoding_value.isUndefinedOrNull()) {
            if (!encoding_value.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("encoding", "string", encoding_value);
            }

            encoding = try jsc.Node.Encoding.fromJS(encoding_value, globalObject) orelse {
                return globalObject.throwInvalidArguments("Invalid encoding", .{});
            };
        }

        const result = try jsc.Node.StringOrBuffer.fromJSWithEncoding(globalObject, bun.default_allocator, input_value, encoding);
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
            this.body_read_ref.unref(jsc.VirtualMachine.get());
            this.body_read_state = .none;
        }

        if (this_value != .zero) {
            js.onAbortedSetCached(this_value, globalObject, .zero);
        }

        raw_response.clearAborted();
        raw_response.clearOnWritable();
        raw_response.clearTimeout();
        this.flags.ended = true;
        if (!state.isHttpWriteCalled() or bytes.len > 0) {
            raw_response.end(bytes, state.isHttpConnectionClose());
        } else {
            raw_response.endStream(state.isHttpConnectionClose());
        }
        this.onRequestComplete();

        return jsc.JSValue.jsNumberFromUint64(bytes.len);
    } else {
        const js_this = if (this_value != .zero) this_value else this.getThisValue();
        switch (raw_response.write(bytes)) {
            .want_more => |written| {
                raw_response.clearOnWritable();
                js.onWritableSetCached(js_this, globalObject, .js_undefined);
                return jsc.JSValue.jsNumberFromUint64(written);
            },
            .backpressure => |written| {
                if (!callback_value.isUndefined()) {
                    js.onWritableSetCached(js_this, globalObject, callback_value.withAsyncContextIfNeeded(globalObject));
                    raw_response.onWritable(*NodeHTTPResponse, onDrain, this);
                }

                return jsc.JSValue.jsNumberFromInt64(-@as(i64, @intCast(@min(written, std.math.maxInt(i64)))));
            },
        }
    }
}

pub fn setOnWritable(this: *NodeHTTPResponse, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
    if (this.isDone() or value.isUndefined()) {
        js.onWritableSetCached(thisValue, globalObject, .js_undefined);
    } else {
        js.onWritableSetCached(thisValue, globalObject, value.withAsyncContextIfNeeded(globalObject));
    }
}

pub fn getOnWritable(_: *NodeHTTPResponse, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    return js.onWritableGetCached(thisValue) orelse .js_undefined;
}

pub fn getOnAbort(this: *NodeHTTPResponse, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    if (this.flags.socket_closed or this.flags.upgraded) {
        return .js_undefined;
    }
    return js.onAbortedGetCached(thisValue) orelse .js_undefined;
}

pub fn setOnAbort(this: *NodeHTTPResponse, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
    if (this.flags.socket_closed or this.flags.upgraded) {
        return;
    }

    if (this.isRequestedCompletedOrEnded() or value.isUndefined()) {
        js.onAbortedSetCached(thisValue, globalObject, .zero);
    } else {
        js.onAbortedSetCached(thisValue, globalObject, value.withAsyncContextIfNeeded(globalObject));
    }
}

pub fn getOnData(_: *NodeHTTPResponse, thisValue: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
    return js.onDataGetCached(thisValue) orelse .js_undefined;
}

pub fn getHasCustomOnData(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    return .jsBoolean(this.flags.hasCustomOnData);
}

pub fn getUpgraded(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject) jsc.JSValue {
    return .jsBoolean(this.flags.upgraded);
}

pub fn setHasCustomOnData(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject, value: JSValue) void {
    this.flags.hasCustomOnData = value.toBoolean();
}

fn clearOnDataCallback(this: *NodeHTTPResponse, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject) void {
    log("clearOnDataCallback", .{});
    if (this.body_read_state != .none) {
        if (thisValue != .zero) {
            js.onDataSetCached(thisValue, globalObject, .js_undefined);
        }
        if (!this.flags.socket_closed and !this.flags.upgraded) {
            log("clearOnData", .{});
            if (this.raw_response) |raw_response| {
                raw_response.clearOnData();
            }
        }
        if (this.body_read_state != .done) {
            this.body_read_state = .done;
        }
    }
}

pub fn setOnData(this: *NodeHTTPResponse, thisValue: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: JSValue) void {
    if (value.isUndefined() or this.flags.ended or this.flags.socket_closed or this.body_read_state == .none or this.flags.is_data_buffered_during_pause_last or this.flags.upgraded) {
        js.onDataSetCached(thisValue, globalObject, .js_undefined);
        defer {
            if (this.body_read_ref.has) {
                this.body_read_ref.unref(globalObject.bunVM());
            }
        }
        switch (this.body_read_state) {
            .pending, .done => {
                if (!this.flags.request_has_completed and !this.flags.socket_closed and !this.flags.upgraded) {
                    log("clearOnData", .{});
                    if (this.raw_response) |raw_response| {
                        raw_response.clearOnData();
                    }
                }
                this.body_read_state = .done;
            },
            .none => {},
        }
        return;
    }

    js.onDataSetCached(thisValue, globalObject, value.withAsyncContextIfNeeded(globalObject));
    this.flags.hasCustomOnData = true;
    if (this.raw_response) |raw_response| {
        raw_response.onData(*NodeHTTPResponse, onData, this);
    }
    this.flags.is_data_buffered_during_pause = false;

    if (!this.body_read_ref.has) {
        this.ref();
        this.body_read_ref.ref(globalObject.bunVM());
    }
}

pub fn write(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();

    return writeOrEnd(this, globalObject, arguments, .zero, false);
}

pub fn onAutoFlush(this: *NodeHTTPResponse) bool {
    defer this.deref();
    if (!this.flags.socket_closed and !this.flags.upgraded and this.raw_response != null) {
        this.raw_response.?.uncork();
    }
    this.auto_flusher.registered = false;
    return false;
}

fn registerAutoFlush(this: *NodeHTTPResponse) void {
    if (this.auto_flusher.registered) return;
    this.ref();
    AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(NodeHTTPResponse, this, jsc.VirtualMachine.get());
}

fn unregisterAutoFlush(this: *NodeHTTPResponse) void {
    if (!this.auto_flusher.registered) return;
    AutoFlusher.unregisterDeferredMicrotaskWithTypeUnchecked(NodeHTTPResponse, this, jsc.VirtualMachine.get());
    this.deref();
}

pub fn flushHeaders(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (!this.flags.socket_closed and !this.flags.upgraded and this.raw_response != null) {
        const raw_response = this.raw_response.?;
        // Don’t flush immediately; queue a microtask to uncork the socket.
        raw_response.flushHeaders(false);
        if (raw_response.isCorked()) {
            this.registerAutoFlush();
        }
    }

    return .js_undefined;
}

pub fn end(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    //We dont wanna a paused socket when we call end, so is important to resume the socket
    resumeSocket(this);
    return writeOrEnd(this, globalObject, arguments, callframe.this(), true);
}

pub fn getBytesWritten(this: *NodeHTTPResponse, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) jsc.JSValue {
    return jsc.JSValue.jsNumber(this.bytes_written);
}

fn handleCorked(globalObject: *jsc.JSGlobalObject, function: jsc.JSValue, result: *JSValue, is_exception: *bool) void {
    result.* = function.call(globalObject, .js_undefined, &.{}) catch |err| {
        result.* = globalObject.takeException(err);
        is_exception.* = true;
        return;
    };
}

pub fn setTimeout(this: *NodeHTTPResponse, seconds: u8) void {
    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.upgraded or this.raw_response == null) {
        return;
    }

    this.raw_response.?.timeout(seconds);
}

export fn NodeHTTPResponse__setTimeout(this: *NodeHTTPResponse, seconds: jsc.JSValue, globalThis: *jsc.JSGlobalObject) bool {
    if (!seconds.isNumber()) {
        globalThis.throwInvalidArgumentTypeValue("timeout", "number", seconds) catch {};
        return false;
    }

    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.upgraded or this.raw_response == null) {
        return false;
    }

    this.raw_response.?.timeout(@intCast(@min(seconds.to(c_uint), 255)));
    return true;
}

pub fn cork(this: *NodeHTTPResponse, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    if (arguments.len == 0) {
        return globalObject.throwNotEnoughArguments("cork", 1, 0);
    }

    if (!arguments[0].isCallable()) {
        return globalObject.throwInvalidArgumentTypeValue("cork", "function", arguments[0]);
    }

    if (this.flags.request_has_completed or this.flags.socket_closed or this.flags.upgraded) {
        return globalObject.ERR(.STREAM_ALREADY_FINISHED, "Stream is already ended", .{}).throw();
    }

    var result: jsc.JSValue = .zero;
    var is_exception: bool = false;
    this.ref();
    defer this.deref();

    if (this.raw_response) |raw_response| {
        raw_response.corked(handleCorked, .{ globalObject, arguments[0], &result, &is_exception });
    } else {
        handleCorked(globalObject, arguments[0], &result, &is_exception);
    }
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
    bun.debugAssert(!this.poll_ref.has);
    bun.debugAssert(!this.flags.is_request_pending);
    bun.debugAssert(this.flags.socket_closed or this.flags.request_has_completed);

    this.buffered_request_body_data_during_pause.deinit(bun.default_allocator);
    this.poll_ref.unref(jsc.VirtualMachine.get());
    this.body_read_ref.unref(jsc.VirtualMachine.get());

    this.promise.deinit();
    bun.destroy(this);
}

comptime {
    @export(&create, .{ .name = "NodeHTTPResponse__createForJS" });
}

pub export fn Bun__NodeHTTPResponse_onClose(response: *NodeHTTPResponse, js_value: jsc.JSValue) void {
    response.onAbort(js_value);
}

pub export fn Bun__NodeHTTPResponse_setClosed(response: *NodeHTTPResponse) void {
    response.flags.socket_closed = true;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const HTTP = bun.http;
const Output = bun.Output;
const uws = bun.uws;
const HTTPStatusText = bun.api.server.HTTPStatusText;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const AutoFlusher = jsc.WebCore.AutoFlusher;

const AnyServer = jsc.API.AnyServer;
const ServerWebSocket = jsc.API.ServerWebSocket;
