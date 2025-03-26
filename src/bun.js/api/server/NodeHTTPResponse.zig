raw_response: uws.AnyResponse,
onDataCallback: JSC.Strong = .empty,
onWritableCallback: JSC.Strong = .empty,

ref_count: u32 = 1,
js_ref: JSC.Ref = .{},
socket_closed: bool = false,
request_has_completed: bool = false,
ended: bool = false,
upgraded: bool = false,
hasCustomOnData: bool = false,
is_request_pending: bool = true,
body_read_state: BodyReadState = .none,
body_read_ref: JSC.Ref = .{},
promise: JSC.Strong = .empty,
server: AnyServer,

/// When you call pause() on the node:http IncomingMessage
/// We might've already read from the socket.
/// So we need to buffer that data.
/// This should be pretty uncommon though.
buffered_request_body_data_during_pause: bun.ByteList = .{},
is_data_buffered_during_pause: bool = false,
/// Did we receive the last chunk of data during pause?
is_data_buffered_during_pause_last: bool = false,

upgrade_context: UpgradeCTX = .{},

const log = bun.Output.scoped(.NodeHTTPResponse, false);
pub usingnamespace JSC.Codegen.JSNodeHTTPResponse;
pub usingnamespace bun.NewRefCounted(@This(), deinit, null);

pub const UpgradeCTX = struct {
    context: ?*uws.uws_socket_context_t = null,
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
    if (this.socket_closed) {
        return .zero;
    }

    return Bun__getNodeHTTPResponseThisValue(this.raw_response == .SSL, this.raw_response.socket());
}

extern "C" fn Bun__getNodeHTTPServerSocketThisValue(bool, *anyopaque) JSC.JSValue;
pub fn getServerSocketValue(this: *NodeHTTPResponse) JSC.JSValue {
    if (this.socket_closed) {
        return .zero;
    }

    return Bun__getNodeHTTPServerSocketThisValue(this.raw_response == .SSL, this.raw_response.socket());
}

pub fn upgrade(this: *NodeHTTPResponse, data_value: JSValue, sec_websocket_protocol: ZigString, sec_websocket_extensions: ZigString) bool {
    const upgrade_ctx = this.upgrade_context.context orelse return false;
    const ws_handler = this.server.webSocketHandler() orelse return false;
    const socketValue = this.getServerSocketValue();
    if (socketValue == .zero) {
        return false;
    }

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
        this.upgraded = true;
        Bun__setNodeHTTPServerSocketUsSocketValue(socketValue, socket);
        ServerWebSocket.socketSetCached(ws.getThisValue(), ws_handler.globalObject, socketValue);
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
pub fn maybeStopReadingBody(this: *NodeHTTPResponse, vm: *JSC.VirtualMachine) void {
    this.upgrade_context.deinit(); // we can discard the upgrade context now

    if ((this.socket_closed or this.ended) and (this.body_read_ref.has or this.body_read_state == .pending) and (!this.hasCustomOnData or !this.onDataCallback.has())) {
        const had_ref = this.body_read_ref.has;
        this.raw_response.clearOnData();
        this.body_read_ref.unref(vm);
        this.body_read_state = .done;

        if (had_ref) {
            this.markRequestAsDoneIfNecessary();
        }

        this.deref();
    }
}

pub fn shouldRequestBePending(this: *const NodeHTTPResponse) bool {
    if (this.socket_closed) {
        return false;
    }

    if (this.ended) {
        return this.body_read_state == .pending;
    }

    return true;
}

pub fn dumpRequestBody(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalObject; // autofix
    _ = callframe; // autofix
    if (this.buffered_request_body_data_during_pause.len > 0) {
        this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
    }
    if (!this.request_has_completed) {
        this.clearOnDataCallback();
    }

    return .undefined;
}

fn markRequestAsDone(this: *NodeHTTPResponse) void {
    log("markRequestAsDone()", .{});
    this.is_request_pending = false;

    this.clearJSValues();
    this.clearOnDataCallback();
    this.upgrade_context.deinit();

    this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
    const server = this.server;
    this.js_ref.unref(JSC.VirtualMachine.get());
    this.deref();
    server.onRequestComplete();
}

fn markRequestAsDoneIfNecessary(this: *NodeHTTPResponse) void {
    if (this.is_request_pending and !this.shouldRequestBePending()) {
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
    if ((HTTP.Method.which(request.method()) orelse HTTP.Method.OPTIONS).hasRequestBody()) {
        const req_len: usize = brk: {
            if (request.header("content-length")) |content_length| {
                break :brk std.fmt.parseInt(usize, content_length, 10) catch 0;
            }

            break :brk 0;
        };

        has_body.* = req_len > 0 or request.header("transfer-encoding") != null;
    }

    const response = NodeHTTPResponse.new(.{
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
        // 1 - the HTTP response
        // 1 - the JS object
        // 1 - the Server handler.
        // 1 - the onData callback (request body)
        .ref_count = if (has_body.*) 4 else 3,
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
    if (this.socket_closed) {
        return;
    }
    // Don't overwrite WebSocket user data
    if (!this.upgraded) {
        this.raw_response.onTimeout(*NodeHTTPResponse, onTimeout, this);
    }
    // detach and
    this.upgrade_context.preserveWebSocketHeadersIfNeeded();
}

fn isDone(this: *const NodeHTTPResponse) bool {
    return this.request_has_completed or this.ended or this.socket_closed;
}

pub fn getEnded(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsBoolean(this.ended);
}

pub fn getFinished(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsBoolean(this.request_has_completed);
}

pub fn getAborted(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSValue.jsBoolean(this.socket_closed);
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
    if (this.is_data_buffered_during_pause_last) {
        result |= 1 << 2;
    }

    return JSC.JSValue.jsNumber(result);
}

pub fn getBufferedAmount(this: *const NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    if (this.request_has_completed or this.socket_closed) {
        return JSC.JSValue.jsNull();
    }

    return JSC.JSValue.jsNumber(this.raw_response.getBufferedAmount());
}

pub fn jsRef(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (!this.isDone()) {
        this.js_ref.ref(globalObject.bunVM());
    }
    return .undefined;
}

pub fn jsUnref(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (!this.isDone()) {
        this.js_ref.unref(globalObject.bunVM());
    }
    return .undefined;
}

fn handleEndedIfNecessary(state: uws.State, globalObject: *JSC.JSGlobalObject) bun.JSError!void {
    if (!state.isResponsePending()) {
        return globalObject.ERR_HTTP_HEADERS_SENT("Stream is already ended", .{}).throw();
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
        return globalObject.ERR_STREAM_ALREADY_FINISHED("Stream is already ended", .{}).throw();
    }

    const state = this.raw_response.state();
    try handleEndedIfNecessary(state, globalObject);

    const status_code_value = if (arguments.len > 0) arguments[0] else .undefined;
    const status_message_value = if (arguments.len > 1 and arguments[1] != .null) arguments[1] else .undefined;
    const headers_object_value = if (arguments.len > 2 and arguments[2] != .null) arguments[2] else .undefined;

    const status_code: i32 = brk: {
        if (status_code_value != .undefined) {
            break :brk globalObject.validateIntegerRange(status_code_value, i32, 200, .{
                .min = 100,
                .max = 599,
            }) catch return error.JSError;
        }

        break :brk 200;
    };

    var stack_fallback = std.heap.stackFallback(256, bun.default_allocator);
    const allocator = stack_fallback.get();
    const status_message_slice = if (status_message_value != .undefined)
        try status_message_value.toSlice(globalObject, allocator)
    else
        ZigString.Slice.empty;
    defer status_message_slice.deinit();

    if (globalObject.hasException()) {
        return error.JSError;
    }

    if (state.isHttpStatusCalled()) {
        return globalObject.ERR_HTTP_HEADERS_SENT("Stream already started", .{}).throw();
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

    return .undefined;
}

fn writeHeadInternal(response: uws.AnyResponse, globalObject: *JSC.JSGlobalObject, status_message: []const u8, headers: JSC.JSValue) void {
    log("writeHeadInternal({s})", .{status_message});
    switch (response) {
        .TCP => NodeHTTPServer__writeHead_http(globalObject, status_message.ptr, status_message.len, headers, @ptrCast(response.TCP)),
        .SSL => NodeHTTPServer__writeHead_https(globalObject, status_message.ptr, status_message.len, headers, @ptrCast(response.SSL)),
    }
}

pub fn writeContinue(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    _ = arguments; // autofix
    if (this.isDone()) {
        return .undefined;
    }

    const state = this.raw_response.state();
    try handleEndedIfNecessary(state, globalObject);

    this.raw_response.writeContinue();
    return .undefined;
}

pub const AbortEvent = enum(u8) {
    none = 0,
    abort = 1,
    timeout = 2,
};

fn handleAbortOrTimeout(this: *NodeHTTPResponse, comptime event: AbortEvent, js_value: JSC.JSValue) void {
    if (this.request_has_completed) {
        return;
    }

    if (event == .abort) {
        this.socket_closed = true;
    }

    this.ref();
    defer this.deref();
    defer if (event == .abort) this.markRequestAsDoneIfNecessary();

    const js_this: JSValue = if (js_value == .zero) this.getThisValue() else js_value;
    if (NodeHTTPResponse.onAbortedGetCached(js_this)) |on_aborted| {
        const globalThis = JSC.VirtualMachine.get().global;
        defer {
            if (event == .abort) {
                NodeHTTPResponse.onAbortedSetCached(js_this, globalThis, .zero);
            }
        }

        const vm = globalThis.bunVM();
        const event_loop = vm.eventLoop();

        event_loop.runCallback(on_aborted, globalThis, js_this, &.{
            JSC.JSValue.jsNumber(@intFromEnum(event)),
        });
    }

    if (event == .abort) {
        this.onDataOrAborted("", true, .abort);
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

pub fn doPause(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalObject; // autofix
    _ = callframe; // autofix
    if (this.request_has_completed or this.socket_closed) {
        return .false;
    }
    if (this.body_read_ref.has and !this.onDataCallback.has()) {
        this.is_data_buffered_during_pause = true;
        this.raw_response.onData(*NodeHTTPResponse, onBufferRequestBodyWhilePaused, this);
    }

    this.raw_response.pause();
    return .true;
}

pub fn drainRequestBody(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = callframe; // autofix
    return this.drainBufferedRequestBodyFromPause(globalObject) orelse .undefined;
}

fn drainBufferedRequestBodyFromPause(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject) ?JSC.JSValue {
    if (this.buffered_request_body_data_during_pause.len > 0) {
        const result = JSC.JSValue.createBuffer(globalObject, this.buffered_request_body_data_during_pause.slice(), bun.default_allocator);
        this.buffered_request_body_data_during_pause = .{};
        return result;
    }
    return null;
}

pub fn doResume(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = callframe; // autofix
    if (this.request_has_completed or this.socket_closed) {
        return .false;
    }

    var result = JSC.JSValue.true;
    if (this.is_data_buffered_during_pause) {
        this.raw_response.clearOnData();
        this.is_data_buffered_during_pause = false;
    }

    if (this.drainBufferedRequestBodyFromPause(globalObject)) |buffered_data| {
        result = buffered_data;
    }

    this.raw_response.@"resume"();
    return result;
}

pub fn onRequestComplete(this: *NodeHTTPResponse) void {
    if (this.request_has_completed) {
        return;
    }
    log("onRequestComplete", .{});
    this.request_has_completed = true;
    this.js_ref.unref(JSC.VirtualMachine.get());

    this.clearJSValues();
    this.markRequestAsDoneIfNecessary();
}

pub export fn Bun__NodeHTTPRequest__onResolve(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    log("onResolve", .{});
    const arguments = callframe.arguments_old(2).slice();
    const this: *NodeHTTPResponse = arguments[1].as(NodeHTTPResponse).?;
    this.promise.deinit();
    defer this.deref();
    this.maybeStopReadingBody(globalObject.bunVM());

    if (!this.request_has_completed and !this.socket_closed) {
        const this_value = this.getThisValue();
        if (this_value != .zero) {
            NodeHTTPResponse.onAbortedSetCached(this_value, globalObject, .zero);
        }
        this.clearJSValues();
        this.raw_response.clearOnData();
        this.raw_response.clearOnWritable();
        this.raw_response.clearTimeout();
        if (this.raw_response.state().isResponsePending()) {
            this.raw_response.endWithoutBody(this.raw_response.state().isHttpConnectionClose());
        }
        this.onRequestComplete();
    }

    return .undefined;
}

pub export fn Bun__NodeHTTPRequest__onReject(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    const err = arguments[0];
    const this: *NodeHTTPResponse = arguments[1].as(NodeHTTPResponse).?;
    this.promise.deinit();
    this.maybeStopReadingBody(globalObject.bunVM());

    defer this.deref();

    if (!this.request_has_completed and !this.socket_closed) {
        const this_value = this.getThisValue();
        if (this_value != .zero) {
            NodeHTTPResponse.onAbortedSetCached(this_value, globalObject, .zero);
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
    return .undefined;
}

pub fn clearJSValues(this: *NodeHTTPResponse) void {
    // Promise is handled separately.
    this.onWritableCallback.deinit();
}

pub fn abort(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    _ = globalObject; // autofix
    _ = callframe; // autofix
    if (this.isDone()) {
        return .undefined;
    }

    this.socket_closed = true;
    const state = this.raw_response.state();
    if (state.isHttpEndCalled()) {
        return .undefined;
    }

    this.raw_response.clearOnData();
    this.raw_response.clearOnWritable();
    this.raw_response.clearTimeout();
    this.raw_response.endWithoutBody(true);
    this.onRequestComplete();
    return .undefined;
}

fn onBufferRequestBodyWhilePaused(this: *NodeHTTPResponse, chunk: []const u8, last: bool) void {
    this.buffered_request_body_data_during_pause.append(bun.default_allocator, chunk) catch bun.outOfMemory();
    if (last) {
        this.is_data_buffered_during_pause_last = true;
        if (this.body_read_ref.has) {
            this.body_read_ref.unref(JSC.VirtualMachine.get());
            this.markRequestAsDoneIfNecessary();
            this.deref();
        }
    }
}

fn onDataOrAborted(this: *NodeHTTPResponse, chunk: []const u8, last: bool, event: AbortEvent) void {
    if (last) {
        this.ref();
        this.body_read_state = .done;
    }

    defer {
        if (last) {
            if (this.body_read_ref.has) {
                this.body_read_ref.unref(JSC.VirtualMachine.get());
                this.markRequestAsDoneIfNecessary();
                this.deref();
            }

            this.deref();
        }
    }

    if (this.onDataCallback.get()) |callback| {
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
            break :brk .undefined;
        };

        event_loop.runCallback(callback, globalThis, .undefined, &.{
            bytes,
            JSC.JSValue.jsBoolean(last),
            JSC.JSValue.jsNumber(@intFromEnum(event)),
        });
    }
}
pub const BUN_DEBUG_REFCOUNT_NAME = "NodeHTTPServerResponse";
pub fn onData(this: *NodeHTTPResponse, chunk: []const u8, last: bool) void {
    log("onData({d} bytes, is_last = {d})", .{ chunk.len, @intFromBool(last) });

    onDataOrAborted(this, chunk, last, .none);
}

fn onDrain(this: *NodeHTTPResponse, offset: u64, response: uws.AnyResponse) bool {
    log("onDrain({d})", .{offset});
    this.ref();
    defer this.deref();
    response.clearOnWritable();
    if (this.socket_closed or this.request_has_completed) {
        // return false means we don't have anything to drain
        return false;
    }
    const on_writable = this.onWritableCallback.trySwap() orelse return false;
    const globalThis = JSC.VirtualMachine.get().global;
    const vm = globalThis.bunVM();

    response.corked(JSC.EventLoop.runCallback, .{ vm.eventLoop(), on_writable, globalThis, .undefined, &.{JSC.JSValue.jsNumberFromUint64(offset)} });
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
        return globalObject.ERR_STREAM_WRITE_AFTER_END("Stream already ended", .{}).throw();
    }

    const state = this.raw_response.state();
    if (!state.isResponsePending()) {
        return globalObject.ERR_STREAM_WRITE_AFTER_END("Stream already ended", .{}).throw();
    }

    const input_value = if (arguments.len > 0) arguments[0] else .undefined;
    var encoding_value = if (arguments.len > 1) arguments[1] else .undefined;
    const callback_value = brk: {
        if ((encoding_value != .null and encoding_value != .undefined) and encoding_value.isCallable()) {
            encoding_value = .undefined;
            break :brk arguments[1];
        }

        if (arguments.len > 2 and arguments[2] != .undefined) {
            if (!arguments[2].isCallable()) {
                return globalObject.throwInvalidArgumentTypeValue("callback", "function", arguments[2]);
            }

            break :brk arguments[2];
        }

        break :brk .undefined;
    };

    const string_or_buffer: JSC.Node.StringOrBuffer = brk: {
        if (input_value == .null or input_value == .undefined) {
            break :brk JSC.Node.StringOrBuffer.empty;
        }

        var encoding: JSC.Node.Encoding = .utf8;
        if (encoding_value != .undefined and encoding_value != .null) {
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

    if (is_end) {
        // Discard the body read ref if it's pending and no onData callback is set at this point.
        // This is the equivalent of req._dump().
        if (this.body_read_ref.has and this.body_read_state == .pending and (!this.hasCustomOnData or !this.onDataCallback.has())) {
            this.body_read_ref.unref(JSC.VirtualMachine.get());
            this.deref();
            this.body_read_state = .none;
        }

        if (this_value != .zero) {
            NodeHTTPResponse.onAbortedSetCached(this_value, globalObject, .zero);
        }

        this.raw_response.clearAborted();
        this.raw_response.clearOnWritable();
        this.raw_response.clearTimeout();
        this.ended = true;
        if (!state.isHttpWriteCalled() or bytes.len > 0) {
            this.raw_response.end(bytes, state.isHttpConnectionClose());
        } else {
            this.raw_response.endStream(state.isHttpConnectionClose());
        }
        this.onRequestComplete();

        return JSC.JSValue.jsNumberFromUint64(bytes.len);
    } else {
        switch (this.raw_response.write(bytes)) {
            .want_more => |written| {
                this.raw_response.clearOnWritable();
                this.onWritableCallback.clearWithoutDeallocation();
                return JSC.JSValue.jsNumberFromUint64(written);
            },
            .backpressure => |written| {
                if (callback_value != .undefined) {
                    this.onWritableCallback.set(globalObject, callback_value.withAsyncContextIfNeeded(globalObject));
                    this.raw_response.onWritable(*NodeHTTPResponse, onDrain, this);
                }

                return JSC.JSValue.jsNumberFromInt64(-@as(i64, @intCast(@min(written, std.math.maxInt(i64)))));
            },
        }
    }
}

pub fn setOnWritable(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
    if (this.isDone() or value == .undefined) {
        this.onWritableCallback.clearWithoutDeallocation();
        return true;
    }

    this.onWritableCallback.set(globalObject, value.withAsyncContextIfNeeded(globalObject));
    return true;
}

pub fn getOnWritable(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return this.onWritableCallback.get() orelse .undefined;
}

pub fn getOnAbort(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    if (this.socket_closed) {
        return .undefined;
    }
    return NodeHTTPResponse.onAbortedGetCached(this.getThisValue()) orelse .undefined;
}

pub fn setOnAbort(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
    if (this.socket_closed) {
        return true;
    }

    if (this.isDone() or value == .undefined) {
        NodeHTTPResponse.onAbortedSetCached(this.getThisValue(), globalObject, .zero);
    } else {
        NodeHTTPResponse.onAbortedSetCached(this.getThisValue(), globalObject, value.withAsyncContextIfNeeded(globalObject));
    }

    return true;
}

pub fn getOnData(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return this.onDataCallback.get() orelse .undefined;
}

pub fn getHasCustomOnData(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.jsBoolean(this.hasCustomOnData);
}

pub fn getUpgraded(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.jsBoolean(this.upgraded);
}

pub fn setHasCustomOnData(this: *NodeHTTPResponse, _: *JSC.JSGlobalObject, value: JSValue) bool {
    this.hasCustomOnData = value.toBoolean();
    return true;
}

fn clearOnDataCallback(this: *NodeHTTPResponse) void {
    if (this.body_read_state != .none) {
        this.onDataCallback.deinit();
        if (!this.socket_closed)
            this.raw_response.clearOnData();
        if (this.body_read_state != .done) {
            this.body_read_state = .done;
            if (this.body_read_ref.has) {
                this.deref();
            }
        }
    }
}

pub fn setOnData(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, value: JSValue) bool {
    if (value == .undefined or this.ended or this.socket_closed or this.body_read_state == .none or this.is_data_buffered_during_pause_last) {
        this.onDataCallback.deinit();
        defer {
            if (this.body_read_ref.has) {
                this.body_read_ref.unref(globalObject.bunVM());
                this.deref();
            }
        }
        switch (this.body_read_state) {
            .pending, .done => {
                if (!this.request_has_completed and !this.socket_closed) {
                    this.raw_response.clearOnData();
                }
                this.body_read_state = .done;
            },
            .none => {},
        }
        return true;
    }

    this.onDataCallback.set(globalObject, value.withAsyncContextIfNeeded(globalObject));
    this.hasCustomOnData = true;
    this.raw_response.onData(*NodeHTTPResponse, onData, this);
    this.is_data_buffered_during_pause = false;

    if (!this.body_read_ref.has) {
        this.ref();
        this.body_read_ref.ref(globalObject.bunVM());
    }

    return true;
}

pub fn write(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(3).slice();

    return writeOrEnd(this, globalObject, arguments, .zero, false);
}

pub fn end(this: *NodeHTTPResponse, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(3).slice();
    return writeOrEnd(this, globalObject, arguments, callframe.this(), true);
}

fn handleCorked(globalObject: *JSC.JSGlobalObject, function: JSC.JSValue, result: *JSValue, is_exception: *bool) void {
    result.* = function.call(globalObject, .undefined, &.{}) catch |err| {
        result.* = globalObject.takeException(err);
        is_exception.* = true;
        return;
    };
}

pub fn setTimeout(this: *NodeHTTPResponse, seconds: u8) void {
    if (this.request_has_completed or this.socket_closed) {
        return;
    }

    this.raw_response.timeout(seconds);
}

export fn NodeHTTPResponse__setTimeout(this: *NodeHTTPResponse, seconds: JSC.JSValue, globalThis: *JSC.JSGlobalObject) bool {
    if (!seconds.isNumber()) {
        globalThis.throwInvalidArgumentTypeValue("timeout", "number", seconds) catch {};
        return false;
    }

    if (this.request_has_completed or this.socket_closed) {
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

    if (this.request_has_completed or this.socket_closed) {
        return globalObject.ERR_STREAM_ALREADY_FINISHED("Stream is already ended", .{}).throw();
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
        return .undefined;
    }

    return result;
}
pub fn finalize(this: *NodeHTTPResponse) void {
    this.clearJSValues();
    this.deref();
}

pub fn deinit(this: *NodeHTTPResponse) void {
    bun.debugAssert(!this.body_read_ref.has);
    bun.debugAssert(!this.js_ref.has);
    bun.debugAssert(!this.is_request_pending);
    bun.debugAssert(this.socket_closed or this.request_has_completed);

    this.buffered_request_body_data_during_pause.deinitWithAllocator(bun.default_allocator);
    this.js_ref.unref(JSC.VirtualMachine.get());
    this.body_read_ref.unref(JSC.VirtualMachine.get());

    this.onDataCallback.deinit();
    this.onWritableCallback.deinit();
    this.promise.deinit();
    this.destroy();
}

comptime {
    @export(&create, .{ .name = "NodeHTTPResponse__createForJS" });
}
extern "c" fn Bun__setNodeHTTPServerSocketUsSocketValue(JSC.JSValue, ?*anyopaque) void;

pub export fn Bun__NodeHTTPResponse_onClose(response: *NodeHTTPResponse, js_value: JSC.JSValue) void {
    response.onAbort(js_value);
}

pub export fn Bun__NodeHTTPResponse_setClosed(response: *NodeHTTPResponse) void {
    response.socket_closed = true;
}

const NodeHTTPResponse = @This();

const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = JSC.JSObject;
const JSValue = JSC.JSValue;
const JSC = bun.JSC;
const bun = @import("root").bun;
const string = []const u8;
const Bun = JSC.API.Bun;
const max_addressable_memory = bun.max_addressable_memory;
const Environment = bun.Environment;
const std = @import("std");
const assert = bun.assert;
const ZigString = JSC.ZigString;
const WebSocketServer = @import("../server.zig").WebSocketServer;
const uws = bun.uws;
const Output = bun.Output;
const AnyServer = JSC.API.AnyServer;
const HTTP = bun.http;
const HTTPStatusText = @import("../server.zig").HTTPStatusText;
const ServerWebSocket = JSC.API.ServerWebSocket;
