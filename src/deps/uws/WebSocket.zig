pub fn NewWebSocket(comptime ssl_flag: c_int) type {
    return opaque {
        const WebSocket = NewWebSocket(ssl_flag);

        pub fn raw(this: *WebSocket) *RawWebSocket {
            return @as(*RawWebSocket, @ptrCast(this));
        }
        pub fn as(this: *WebSocket, comptime Type: type) ?*Type {
            @setRuntimeSafety(false);
            return @as(?*Type, @ptrCast(@alignCast(c.uws_ws_get_user_data(ssl_flag, this.raw()))));
        }

        pub fn close(this: *WebSocket) void {
            return c.uws_ws_close(ssl_flag, this.raw());
        }
        pub fn send(this: *WebSocket, message: []const u8, opcode: Opcode) SendStatus {
            return c.uws_ws_send(ssl_flag, this.raw(), message.ptr, message.len, opcode);
        }
        pub fn sendWithOptions(this: *WebSocket, message: []const u8, opcode: Opcode, compress: bool, fin: bool) SendStatus {
            return c.uws_ws_send_with_options(ssl_flag, this.raw(), message.ptr, message.len, opcode, compress, fin);
        }

        pub fn memoryCost(this: *WebSocket) usize {
            return this.raw().memoryCost(ssl_flag);
        }

        pub fn sendLastFragment(this: *WebSocket, message: []const u8, compress: bool) SendStatus {
            return c.uws_ws_send_last_fragment(ssl_flag, this.raw(), message.ptr, message.len, compress);
        }
        pub fn end(this: *WebSocket, code: i32, message: []const u8) void {
            return c.uws_ws_end(ssl_flag, this.raw(), code, message.ptr, message.len);
        }
        pub fn cork(this: *WebSocket, ctx: anytype, comptime callback: anytype) void {
            const ContextType = @TypeOf(ctx);
            const Wrapper = struct {
                pub fn wrap(user_data: ?*anyopaque) callconv(.c) void {
                    @call(bun.callmod_inline, callback, .{bun.cast(ContextType, user_data.?)});
                }
            };

            return c.uws_ws_cork(ssl_flag, this.raw(), Wrapper.wrap, ctx);
        }
        pub fn subscribe(this: *WebSocket, topic: []const u8) bool {
            return c.uws_ws_subscribe(ssl_flag, this.raw(), topic.ptr, topic.len);
        }
        pub fn unsubscribe(this: *WebSocket, topic: []const u8) bool {
            return c.uws_ws_unsubscribe(ssl_flag, this.raw(), topic.ptr, topic.len);
        }
        pub fn isSubscribed(this: *WebSocket, topic: []const u8) bool {
            return c.uws_ws_is_subscribed(ssl_flag, this.raw(), topic.ptr, topic.len);
        }
        pub fn getTopicsAsJSArray(this: *WebSocket, globalObject: *JSGlobalObject) JSValue {
            return c.uws_ws_get_topics_as_js_array(ssl_flag, this.raw(), globalObject);
        }

        pub fn publish(this: *WebSocket, topic: []const u8, message: []const u8) bool {
            return c.uws_ws_publish(ssl_flag, this.raw(), topic.ptr, topic.len, message.ptr, message.len);
        }
        pub fn publishWithOptions(this: *WebSocket, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
            return c.uws_ws_publish_with_options(ssl_flag, this.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress);
        }
        pub fn getBufferedAmount(this: *WebSocket) u32 {
            return c.uws_ws_get_buffered_amount(ssl_flag, this.raw());
        }
        pub fn getRemoteAddress(this: *WebSocket, buf: []u8) []u8 {
            var ptr: [*]u8 = undefined;
            const len = c.uws_ws_get_remote_address(ssl_flag, this.raw(), &ptr);
            bun.copy(u8, buf, ptr[0..len]);
            return buf[0..len];
        }
    };
}

pub const RawWebSocket = opaque {
    pub fn memoryCost(this: *RawWebSocket, ssl_flag: i32) usize {
        return c.uws_ws_memory_cost(ssl_flag, this);
    }

    /// They're the same memory address.
    ///
    /// Equivalent to:
    ///
    ///   (struct us_socket_t *)socket
    pub fn asSocket(this: *RawWebSocket) *uws.Socket {
        return @as(*uws.Socket, @ptrCast(this));
    }
};

pub const AnyWebSocket = union(enum) {
    ssl: *uws.NewApp(true).WebSocket,
    tcp: *uws.NewApp(false).WebSocket,

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
        return c.uws_ws_close(ssl_flag, this.raw());
    }

    pub fn send(this: AnyWebSocket, message: []const u8, opcode: Opcode, compress: bool, fin: bool) SendStatus {
        return switch (this) {
            .ssl => c.uws_ws_send_with_options(1, this.ssl.raw(), message.ptr, message.len, opcode, compress, fin),
            .tcp => c.uws_ws_send_with_options(0, this.tcp.raw(), message.ptr, message.len, opcode, compress, fin),
        };
    }
    pub fn sendLastFragment(this: AnyWebSocket, message: []const u8, compress: bool) SendStatus {
        switch (this) {
            .tcp => return c.uws_ws_send_last_fragment(0, this.raw(), message.ptr, message.len, compress),
            .ssl => return c.uws_ws_send_last_fragment(1, this.raw(), message.ptr, message.len, compress),
        }
    }
    pub fn end(this: AnyWebSocket, code: i32, message: []const u8) void {
        switch (this) {
            .tcp => c.uws_ws_end(0, this.tcp.raw(), code, message.ptr, message.len),
            .ssl => c.uws_ws_end(1, this.ssl.raw(), code, message.ptr, message.len),
        }
    }
    pub fn cork(this: AnyWebSocket, ctx: anytype, comptime callback: anytype) void {
        const ContextType = @TypeOf(ctx);
        const Wrapper = struct {
            pub fn wrap(user_data: ?*anyopaque) callconv(.c) void {
                @call(bun.callmod_inline, callback, .{bun.cast(ContextType, user_data.?)});
            }
        };

        switch (this) {
            .ssl => c.uws_ws_cork(1, this.raw(), Wrapper.wrap, ctx),
            .tcp => c.uws_ws_cork(0, this.raw(), Wrapper.wrap, ctx),
        }
    }
    pub fn subscribe(this: AnyWebSocket, topic: []const u8) bool {
        return switch (this) {
            .ssl => c.uws_ws_subscribe(1, this.ssl.raw(), topic.ptr, topic.len),
            .tcp => c.uws_ws_subscribe(0, this.tcp.raw(), topic.ptr, topic.len),
        };
    }
    pub fn unsubscribe(this: AnyWebSocket, topic: []const u8) bool {
        return switch (this) {
            .ssl => c.uws_ws_unsubscribe(1, this.raw(), topic.ptr, topic.len),
            .tcp => c.uws_ws_unsubscribe(0, this.raw(), topic.ptr, topic.len),
        };
    }
    pub fn isSubscribed(this: AnyWebSocket, topic: []const u8) bool {
        return switch (this) {
            .ssl => c.uws_ws_is_subscribed(1, this.raw(), topic.ptr, topic.len),
            .tcp => c.uws_ws_is_subscribed(0, this.raw(), topic.ptr, topic.len),
        };
    }
    pub fn getTopicsAsJSArray(this: AnyWebSocket, globalObject: *JSGlobalObject) JSValue {
        return switch (this) {
            .ssl => c.uws_ws_get_topics_as_js_array(1, this.raw(), globalObject),
            .tcp => c.uws_ws_get_topics_as_js_array(0, this.raw(), globalObject),
        };
    }
    // pub fn iterateTopics(this: AnyWebSocket) {
    //     return uws_ws_iterate_topics(ssl_flag, this.raw(), callback: ?*const fn ([*c]const u8, usize, ?*anyopaque) callconv(.c) void, user_data: ?*anyopaque) void;
    // }
    pub fn publish(this: AnyWebSocket, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
        return switch (this) {
            .ssl => c.uws_ws_publish_with_options(1, this.ssl.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress),
            .tcp => c.uws_ws_publish_with_options(0, this.tcp.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress),
        };
    }

    pub fn publishWithOptions(ssl: bool, app: *anyopaque, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
        return switch (ssl) {
            inline else => |tls| uws.NewApp(tls).publishWithOptions(@ptrCast(app), topic, message, opcode, compress),
        };
    }

    pub fn getBufferedAmount(this: AnyWebSocket) usize {
        return switch (this) {
            .ssl => c.uws_ws_get_buffered_amount(1, this.ssl.raw()),
            .tcp => c.uws_ws_get_buffered_amount(0, this.tcp.raw()),
        };
    }

    pub fn getRemoteAddress(this: AnyWebSocket, buf: []u8) []u8 {
        return switch (this) {
            .ssl => this.ssl.getRemoteAddress(buf),
            .tcp => this.tcp.getRemoteAddress(buf),
        };
    }
};

pub const WebSocketBehavior = extern struct {
    compression: c.uws_compress_options_t = 0,
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

            pub fn onOpen(raw_ws: *RawWebSocket) callconv(.c) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onOpen, .{
                    this,
                    ws,
                });
            }

            pub fn onMessage(raw_ws: *RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode) callconv(.c) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onMessage, .{
                    this,
                    ws,
                    if (length > 0) message[0..length] else "",
                    opcode,
                });
            }

            pub fn onDrain(raw_ws: *RawWebSocket) callconv(.c) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onDrain, .{
                    this,
                    ws,
                });
            }

            pub fn onPing(raw_ws: *RawWebSocket, message: [*c]const u8, length: usize) callconv(.c) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onPing, .{
                    this,
                    ws,
                    if (length > 0) message[0..length] else "",
                });
            }

            pub fn onPong(raw_ws: *RawWebSocket, message: [*c]const u8, length: usize) callconv(.c) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onPong, .{
                    this,
                    ws,
                    if (length > 0) message[0..length] else "",
                });
            }

            pub fn onClose(raw_ws: *RawWebSocket, code: i32, message: [*c]const u8, length: usize) callconv(.c) void {
                const ws = @unionInit(AnyWebSocket, active_field_name, @as(*WebSocket, @ptrCast(raw_ws)));
                const this = ws.as(Type).?;
                @call(bun.callmod_inline, Type.onClose, .{
                    this,
                    ws,
                    code,
                    if (length > 0 and message != null) message[0..length] else "",
                });
            }

            pub fn onUpgrade(ptr: *anyopaque, res: *uws_res, req: *Request, context: *uws.SocketContext, id: usize) callconv(.c) void {
                @call(bun.callmod_inline, Server.onWebSocketUpgrade, .{
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

    const uws_websocket_handler = ?*const fn (*RawWebSocket) callconv(.c) void;
    const uws_websocket_message_handler = ?*const fn (*RawWebSocket, [*c]const u8, usize, Opcode) callconv(.c) void;
    const uws_websocket_close_handler = ?*const fn (*RawWebSocket, i32, [*c]const u8, usize) callconv(.c) void;
    const uws_websocket_upgrade_handler = ?*const fn (*anyopaque, *uws_res, *Request, *SocketContext, usize) callconv(.c) void;
    const uws_websocket_ping_pong_handler = ?*const fn (*RawWebSocket, [*c]const u8, usize) callconv(.c) void;
};

pub const c = struct {
    pub extern fn uws_ws_memory_cost(ssl: i32, ws: *RawWebSocket) usize;
    pub extern fn uws_ws(ssl: i32, app: *uws_app_t, ctx: *anyopaque, pattern: [*]const u8, pattern_len: usize, id: usize, behavior: *const WebSocketBehavior) void;
    pub extern fn uws_ws_get_user_data(ssl: i32, ws: ?*RawWebSocket) ?*anyopaque;
    pub extern fn uws_ws_close(ssl: i32, ws: ?*RawWebSocket) void;
    pub extern fn uws_ws_send(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode) SendStatus;
    pub extern fn uws_ws_send_with_options(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode, compress: bool, fin: bool) SendStatus;
    pub extern fn uws_ws_send_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
    pub extern fn uws_ws_send_first_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
    pub extern fn uws_ws_send_first_fragment_with_opcode(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: Opcode, compress: bool) SendStatus;
    pub extern fn uws_ws_send_last_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
    pub extern fn uws_ws_end(ssl: i32, ws: ?*RawWebSocket, code: i32, message: [*c]const u8, length: usize) void;
    pub extern fn uws_ws_cork(ssl: i32, ws: ?*RawWebSocket, handler: ?*const fn (?*anyopaque) callconv(.c) void, user_data: ?*anyopaque) void;
    pub extern fn uws_ws_subscribe(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
    pub extern fn uws_ws_unsubscribe(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
    pub extern fn uws_ws_is_subscribed(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
    pub extern fn uws_ws_iterate_topics(ssl: i32, ws: ?*RawWebSocket, callback: ?*const fn ([*c]const u8, usize, ?*anyopaque) callconv(.c) void, user_data: ?*anyopaque) void;
    pub extern fn uws_ws_get_topics_as_js_array(ssl: i32, ws: *RawWebSocket, globalObject: *JSGlobalObject) JSValue;
    pub extern fn uws_ws_publish(ssl: i32, ws: ?*RawWebSocket, topic: [*]const u8, topic_length: usize, message: [*]const u8, message_length: usize) bool;
    pub extern fn uws_ws_publish_with_options(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: Opcode, compress: bool) bool;
    pub extern fn uws_ws_get_buffered_amount(ssl: i32, ws: ?*RawWebSocket) usize;
    pub extern fn uws_ws_get_remote_address(ssl: i32, ws: ?*RawWebSocket, dest: *[*]u8) usize;
    pub extern fn uws_ws_get_remote_address_as_text(ssl: i32, ws: ?*RawWebSocket, dest: *[*]u8) usize;

    pub const uws_compress_options_t = i32;
};

const bun = @import("bun");
const std = @import("std");
const uws_app_t = @import("./App.zig").uws_app_t;

const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const uws = bun.uws;
const NewApp = uws.NewApp;
const Opcode = uws.Opcode;
const Request = uws.Request;
const SendStatus = uws.SendStatus;
const SocketContext = uws.SocketContext;
const uws_res = uws.uws_res;
