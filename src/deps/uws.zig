pub const is_bindgen = @import("std").meta.globalOption("bindgen", bool) orelse false;
const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const Environment = @import("../env.zig");
pub const u_int8_t = u8;
pub const u_int16_t = c_ushort;
pub const u_int32_t = c_uint;
pub const u_int64_t = c_ulonglong;
pub const LIBUS_LISTEN_DEFAULT: i32 = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: i32 = 1;
pub const Socket = opaque {};
const bun = @import("../global.zig");

const BoringSSL = @import("boringssl");
fn NativeSocketHandleType(comptime ssl: bool) type {
    if (ssl) {
        return BoringSSL.SSL;
    } else {
        return anyopaque;
    }
}
pub fn NewSocketHandler(comptime ssl: bool) type {
    return struct {
        const ssl_int: i32 = @boolToInt(ssl);
        socket: *Socket,
        const ThisSocket = @This();

        pub fn isEstablished(this: ThisSocket) bool {
            return us_socket_is_established(comptime ssl_int, this.socket) > 0;
        }

        pub fn timeout(this: ThisSocket, seconds: c_uint) void {
            return us_socket_timeout(comptime ssl_int, this.socket, seconds);
        }

        pub fn getNativeHandle(this: ThisSocket) *NativeSocketHandleType(ssl) {
            return @ptrCast(*NativeSocketHandleType(ssl), us_socket_get_native_handle(comptime ssl_int, this.socket).?);
        }
        pub fn ext(this: ThisSocket, comptime ContextType: type) ?*ContextType {
            const alignment = if (ContextType == *anyopaque)
                @sizeOf(usize)
            else
                std.meta.alignment(ContextType);

            var ptr = us_socket_ext(
                comptime ssl_int,
                this.socket,
            ) orelse return null;

            return @ptrCast(*ContextType, @alignCast(alignment, ptr));
        }
        pub fn context(this: ThisSocket) *SocketContext {
            return us_socket_context(
                comptime ssl_int,
                this.socket,
            );
        }
        pub fn flush(this: ThisSocket) void {
            return us_socket_flush(
                comptime ssl_int,
                this.socket,
            );
        }
        pub fn write(this: ThisSocket, data: []const u8, msg_more: bool) i32 {
            return us_socket_write(
                comptime ssl_int,
                this.socket,
                data.ptr,
                // truncate to 31 bits since sign bit exists
                @intCast(i32, @truncate(u31, data.len)),
                @as(i32, @boolToInt(msg_more)),
            );
        }
        pub fn shutdown(this: ThisSocket) void {
            return us_socket_shutdown(
                comptime ssl_int,
                this.socket,
            );
        }
        pub fn shutdownRead(this: ThisSocket) void {
            return us_socket_shutdown_read(
                comptime ssl_int,
                this.socket,
            );
        }
        pub fn isShutdown(this: ThisSocket) bool {
            return us_socket_is_shut_down(
                comptime ssl_int,
                this.socket,
            ) > 0;
        }
        pub fn isClosed(this: ThisSocket) bool {
            return us_socket_is_closed(
                comptime ssl_int,
                this.socket,
            ) > 0;
        }
        pub fn close(this: ThisSocket, code: i32, reason: ?*anyopaque) void {
            _ = us_socket_close(
                comptime ssl_int,
                this.socket,
                code,
                reason,
            );
        }
        pub fn localPort(this: ThisSocket) i32 {
            return us_socket_local_port(
                comptime ssl_int,
                this.socket,
            );
        }
        pub fn remoteAddress(this: ThisSocket, buf: [*]u8, length: [*c]i32) void {
            return us_socket_remote_address(
                comptime ssl_int,
                this.socket,
                buf,
                length,
            );
        }

        pub fn connect(
            host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            comptime Context: type,
            ctx: Context,
            comptime socket_field_name: []const u8,
        ) ?*Context {
            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();
            var host_ = allocator.dupeZ(u8, host) catch return null;
            defer allocator.free(host_);

            var socket = us_socket_context_connect(comptime ssl_int, socket_ctx, host_, port, null, 0, @sizeOf(Context)) orelse return null;
            const socket_ = ThisSocket{ .socket = socket };
            var holder = socket_.ext(Context) orelse {
                if (comptime bun.Environment.allow_assert) unreachable;
                _ = us_socket_close_connecting(comptime ssl_int, socket);
                return null;
            };
            holder.* = ctx;
            @field(holder, socket_field_name) = socket_;
            return holder;
        }

        pub fn connectAnon(
            host: []const u8,
            port: i32,
            socket_ctx: *SocketContext,
            ptr: *anyopaque,
        ) ?ThisSocket {
            var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
            var allocator = stack_fallback.get();
            var host_ = allocator.dupeZ(u8, host) catch return null;
            defer allocator.free(host_);

            var socket = us_socket_context_connect(comptime ssl_int, socket_ctx, host_, port, null, 0, @sizeOf(*anyopaque)) orelse return null;
            const socket_ = ThisSocket{ .socket = socket };
            var holder = socket_.ext(*anyopaque) orelse {
                if (comptime bun.Environment.allow_assert) unreachable;
                _ = us_socket_close_connecting(comptime ssl_int, socket);
                return null;
            };
            holder.* = ptr;
            return socket_;
        }

        pub fn configure(
            ctx: *SocketContext,
            comptime ContextType: type,
            comptime Fields: anytype,
        ) void {
            const field_type = comptime if (@TypeOf(Fields) != type) @TypeOf(Fields) else Fields;

            const SocketHandler = struct {
                const alignment = if (ContextType == anyopaque)
                    @sizeOf(usize)
                else
                    std.meta.alignment(ContextType);

                pub fn on_open(socket: *Socket, _: i32, _: [*c]u8, _: i32) callconv(.C) ?*Socket {
                    Fields.onOpen(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                    );
                    return socket;
                }
                pub fn on_close(socket: *Socket, code: i32, reason: ?*anyopaque) callconv(.C) ?*Socket {
                    Fields.onClose(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                        code,
                        reason,
                    );
                    return socket;
                }
                pub fn on_data(socket: *Socket, buf: ?[*]u8, len: i32) callconv(.C) ?*Socket {
                    Fields.onData(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                        buf.?[0..@intCast(usize, len)],
                    );
                    return socket;
                }
                pub fn on_writable(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onWritable(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                    );
                    return socket;
                }
                pub fn on_timeout(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onTimeout(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                    );
                    return socket;
                }
                pub fn on_connect_error(socket: *Socket, code: i32) callconv(.C) ?*Socket {
                    Fields.onConnectError(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                        code,
                    );
                    return socket;
                }
                pub fn on_end(socket: *Socket) callconv(.C) ?*Socket {
                    Fields.onEnd(
                        @ptrCast(*ContextType, @alignCast(alignment, us_socket_ext(comptime ssl_int, socket).?)),
                        ThisSocket{ .socket = socket },
                    );
                    return socket;
                }
            };

            if (comptime @hasDecl(field_type, "onOpen") and @typeInfo(@TypeOf(field_type.onOpen)) != .Null)
                us_socket_context_on_open(ssl_int, ctx, SocketHandler.on_open);
            if (comptime @hasDecl(field_type, "onClose") and @typeInfo(@TypeOf(field_type.onClose)) != .Null)
                us_socket_context_on_close(ssl_int, ctx, SocketHandler.on_close);
            if (comptime @hasDecl(field_type, "onData") and @typeInfo(@TypeOf(field_type.onData)) != .Null)
                us_socket_context_on_data(ssl_int, ctx, SocketHandler.on_data);
            if (comptime @hasDecl(field_type, "onWritable") and @typeInfo(@TypeOf(field_type.onWritable)) != .Null)
                us_socket_context_on_writable(ssl_int, ctx, SocketHandler.on_writable);
            if (comptime @hasDecl(field_type, "onTimeout") and @typeInfo(@TypeOf(field_type.onTimeout)) != .Null)
                us_socket_context_on_timeout(ssl_int, ctx, SocketHandler.on_timeout);
            if (comptime @hasDecl(field_type, "onConnectError") and @typeInfo(@TypeOf(field_type.onConnectError)) != .Null)
                us_socket_context_on_connect_error(ssl_int, ctx, SocketHandler.on_connect_error);
            if (comptime @hasDecl(field_type, "onEnd") and @typeInfo(@TypeOf(field_type.onEnd)) != .Null)
                us_socket_context_on_end(ssl_int, ctx, SocketHandler.on_end);
        }

        pub fn adopt(
            socket: *Socket,
            socket_ctx: *SocketContext,
            comptime Context: type,
            comptime socket_field_name: []const u8,
            ctx: Context,
        ) ?*Context {
            var adopted = ThisSocket{ .socket = us_socket_context_adopt_socket(comptime ssl_int, socket_ctx, socket, @sizeOf(Context)) orelse return null };
            var holder = adopted.ext(Context) orelse {
                if (comptime bun.Environment.allow_assert) unreachable;
                _ = us_socket_close(comptime ssl_int, socket, 0, null);
                return null;
            };
            holder.* = ctx;
            @field(holder, socket_field_name) = adopted;
            return holder;
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
        return us_create_timer(loop, 0, @sizeOf(Type));
    }

    pub fn set(this: *Timer, ptr: anytype, cb: ?fn (*Timer) callconv(.C) void, ms: i32, repeat_ms: i32) void {
        us_timer_set(this, cb, ms, repeat_ms);
        var value_ptr = us_timer_ext(this);
        @setRuntimeSafety(false);
        @ptrCast(*@TypeOf(ptr), @alignCast(@alignOf(*@TypeOf(ptr)), value_ptr)).* = ptr;
    }

    pub fn deinit(this: *Timer) void {
        us_timer_close(this);
    }

    pub fn ext(this: *Timer, comptime Type: type) ?*Type {
        return @ptrCast(*Type, @alignCast(@alignOf(Type), us_timer_ext(this).*.?));
    }

    pub fn as(this: *Timer, comptime Type: type) Type {
        @setRuntimeSafety(false);
        return @ptrCast(*?Type, @alignCast(@alignOf(Type), us_timer_ext(this))).*.?;
    }
};
pub const SocketContext = opaque {
    pub fn getNativeHandle(this: *SocketContext, comptime ssl: bool) *anyopaque {
        return us_socket_context_get_native_handle(comptime @as(i32, @boolToInt(ssl)), this).?;
    }
};
pub const Loop = extern struct {
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
    ready_polls: [1024]EventType,

    const EventType = if (Environment.isLinux) std.os.linux.epoll_event else if (Environment.isMac) std.os.system.kevent64_s;

    pub const InternalLoopData = extern struct {
        pub const us_internal_async = opaque {};

        sweep_timer: ?*Timer,
        wakeup_async: ?*us_internal_async,
        last_write_failed: i32,
        head: ?*SocketContext,
        iterator: ?*SocketContext,
        recv_buf: [*]u8,
        ssl_data: ?*anyopaque,
        pre_cb: ?fn (?*Loop) callconv(.C) void,
        post_cb: ?fn (?*Loop) callconv(.C) void,
        closed_head: ?*Socket,
        low_prio_head: ?*Socket,
        low_prio_budget: i32,
        iteration_nr: c_longlong,
    };

    pub fn get() ?*Loop {
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

    pub fn wakeup(this: *Loop) void {
        return us_wakeup_loop(this);
    }

    pub fn tick(this: *Loop) void {
        us_loop_run_bun_tick(this);
    }

    pub fn nextTick(this: *Loop, comptime UserType: type, user_data: UserType, comptime deferCallback: fn (ctx: UserType) void) void {
        const Handler = struct {
            pub fn callback(data: *anyopaque) callconv(.C) void {
                deferCallback(@ptrCast(UserType, @alignCast(@alignOf(std.meta.Child(UserType)), data)));
            }
        };
        uws_loop_defer(this, user_data, Handler.callback);
    }

    fn NewHandler(comptime UserType: type, comptime callback: fn (UserType) void) type {
        return struct {
            loop: *Loop,
            pub fn removePost(handler: @This()) void {
                return uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn removePre(handler: @This()) void {
                return uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn callback(data: *anyopaque, _: *Loop) callconv(.C) void {
                callback(@ptrCast(UserType, @alignCast(@alignOf(std.meta.Child(UserType)), data)));
            }
        };
    }

    pub fn addPostHandler(this: *Loop, comptime UserType: type, ctx: UserType, comptime callback: fn (UserType) void) NewHandler(UserType, callback) {
        const Handler = NewHandler(UserType, callback);

        uws_loop_addPostHandler(this, ctx, Handler.callback);
        return Handler{
            .loop = this,
        };
    }

    pub fn addPreHandler(this: *Loop, comptime UserType: type, ctx: UserType, comptime callback: fn (UserType) void) NewHandler(UserType, callback) {
        const Handler = NewHandler(UserType, callback);

        uws_loop_addPreHandler(this, ctx, Handler.callback);
        return Handler{
            .loop = this,
        };
    }

    pub fn run(this: *Loop) void {
        us_loop_run(this);
    }

    extern fn uws_loop_defer(loop: *Loop, ctx: *anyopaque, cb: fn (ctx: *anyopaque) callconv(.C) void) void;

    extern fn uws_get_loop() ?*Loop;
    extern fn us_create_loop(hint: ?*anyopaque, wakeup_cb: ?fn (*Loop) callconv(.C) void, pre_cb: ?fn (*Loop) callconv(.C) void, post_cb: ?fn (*Loop) callconv(.C) void, ext_size: c_uint) ?*Loop;
    extern fn us_loop_free(loop: ?*Loop) void;
    extern fn us_loop_ext(loop: ?*Loop) ?*anyopaque;
    extern fn us_loop_run(loop: ?*Loop) void;
    extern fn us_loop_run_bun_tick(loop: ?*Loop) void;
    extern fn us_wakeup_loop(loop: ?*Loop) void;
    extern fn us_loop_integrate(loop: ?*Loop) void;
    extern fn us_loop_iteration_number(loop: ?*Loop) c_longlong;
    extern fn uws_loop_addPostHandler(loop: *Loop, ctx: *anyopaque, cb: (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
    extern fn uws_loop_removePostHandler(loop: *Loop, ctx: *anyopaque, cb: (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
    extern fn uws_loop_addPreHandler(loop: *Loop, ctx: *anyopaque, cb: (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
    extern fn uws_loop_removePreHandler(loop: *Loop, ctx: *anyopaque, cb: (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
};
const uintmax_t = c_ulong;

extern fn us_create_timer(loop: ?*Loop, fallthrough: i32, ext_size: c_uint) *Timer;
extern fn us_timer_ext(timer: ?*Timer) *?*anyopaque;
extern fn us_timer_close(timer: ?*Timer) void;
extern fn us_timer_set(timer: ?*Timer, cb: ?fn (*Timer) callconv(.C) void, ms: i32, repeat_ms: i32) void;
extern fn us_timer_loop(t: ?*Timer) ?*Loop;
pub const us_socket_context_options_t = extern struct {
    key_file_name: [*c]const u8 = null,
    cert_file_name: [*c]const u8 = null,
    passphrase: [*c]const u8 = null,
    dh_params_file_name: [*c]const u8 = null,
    ca_file_name: [*c]const u8 = null,
    ssl_prefer_low_memory_usage: i32 = 0,
};

extern fn SocketContextimestamp(ssl: i32, context: ?*SocketContext) c_ushort;
extern fn us_socket_context_add_server_name(ssl: i32, context: ?*SocketContext, hostname_pattern: [*c]const u8, options: us_socket_context_options_t) void;
extern fn us_socket_context_remove_server_name(ssl: i32, context: ?*SocketContext, hostname_pattern: [*c]const u8) void;
extern fn us_socket_context_on_server_name(ssl: i32, context: ?*SocketContext, cb: ?fn (?*SocketContext, [*c]const u8) callconv(.C) void) void;
extern fn us_socket_context_get_native_handle(ssl: i32, context: ?*SocketContext) ?*anyopaque;
pub extern fn us_create_socket_context(ssl: i32, loop: ?*Loop, ext_size: i32, options: us_socket_context_options_t) ?*SocketContext;
extern fn us_socket_context_free(ssl: i32, context: ?*SocketContext) void;
extern fn us_socket_context_on_open(ssl: i32, context: ?*SocketContext, on_open: fn (*Socket, i32, [*c]u8, i32) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_close(ssl: i32, context: ?*SocketContext, on_close: fn (*Socket, i32, ?*anyopaque) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_data(ssl: i32, context: ?*SocketContext, on_data: fn (*Socket, [*c]u8, i32) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_writable(ssl: i32, context: ?*SocketContext, on_writable: fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_timeout(ssl: i32, context: ?*SocketContext, on_timeout: fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_connect_error(ssl: i32, context: ?*SocketContext, on_connect_error: fn (*Socket, i32) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_end(ssl: i32, context: ?*SocketContext, on_end: fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_ext(ssl: i32, context: ?*SocketContext) ?*anyopaque;

extern fn us_socket_context_listen(ssl: i32, context: ?*SocketContext, host: [*c]const u8, port: i32, options: i32, socket_ext_size: i32) ?*listen_socket_t;

pub extern fn us_socket_context_connect(ssl: i32, context: ?*SocketContext, host: [*c]const u8, port: i32, source_host: [*c]const u8, options: i32, socket_ext_size: i32) ?*Socket;
pub extern fn us_socket_is_established(ssl: i32, s: ?*Socket) i32;
pub extern fn us_socket_close_connecting(ssl: i32, s: ?*Socket) ?*Socket;
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
        var poll = us_create_poll(loop, @as(i32, @boolToInt(fallthrough)), @sizeOf(Data));
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

    pub fn data(self: *Poll, comptime Data: type) *Data {
        return us_poll_ext(self).?;
    }

    pub fn fd(self: *Poll) @import("std").os.fd_t {
        return @intCast(@import("std").os.fd_t, us_poll_fd(self));
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

    pub fn deinit(self: *Poll) void {
        us_poll_free(self);
    }

    // (void* userData, int fd, int events, int error, struct us_poll_t *poll)
    pub const CallbackType = fn (?*anyopaque, i32, i32, i32, *Poll) callconv(.C) void;
    extern fn us_create_poll(loop: ?*Loop, fallthrough: i32, ext_size: c_uint) *Poll;
    extern fn us_poll_set(poll: *Poll, events: i32, callback: CallbackType) *Poll;
    extern fn us_poll_free(p: ?*Poll, loop: ?*Loop) void;
    extern fn us_poll_init(p: ?*Poll, fd: i32, poll_type: i32) void;
    extern fn us_poll_start(p: ?*Poll, loop: ?*Loop, events: i32) void;
    extern fn us_poll_change(p: ?*Poll, loop: ?*Loop, events: i32) void;
    extern fn us_poll_stop(p: ?*Poll, loop: ?*Loop) void;
    extern fn us_poll_events(p: ?*Poll) i32;
    extern fn us_poll_ext(p: ?*Poll) ?*anyopaque;
    extern fn us_poll_fd(p: ?*Poll) i32;
    extern fn us_poll_resize(p: ?*Poll, loop: ?*Loop, ext_size: c_uint) ?*Poll;
};

extern fn us_socket_get_native_handle(ssl: i32, s: ?*Socket) ?*anyopaque;

extern fn us_socket_timeout(ssl: i32, s: ?*Socket, seconds: c_uint) void;
extern fn us_socket_ext(ssl: i32, s: ?*Socket) ?*anyopaque;
extern fn us_socket_context(ssl: i32, s: ?*Socket) ?*SocketContext;
extern fn us_socket_flush(ssl: i32, s: ?*Socket) void;
extern fn us_socket_write(ssl: i32, s: ?*Socket, data: [*c]const u8, length: i32, msg_more: i32) i32;
extern fn us_socket_shutdown(ssl: i32, s: ?*Socket) void;
extern fn us_socket_shutdown_read(ssl: i32, s: ?*Socket) void;
extern fn us_socket_is_shut_down(ssl: i32, s: ?*Socket) i32;
extern fn us_socket_is_closed(ssl: i32, s: ?*Socket) i32;
extern fn us_socket_close(ssl: i32, s: ?*Socket, code: i32, reason: ?*anyopaque) ?*Socket;
extern fn us_socket_local_port(ssl: i32, s: ?*Socket) i32;
extern fn us_socket_remote_address(ssl: i32, s: ?*Socket, buf: [*c]u8, length: [*c]i32) void;
pub const uws_app_s = opaque {};
pub const uws_req_s = opaque {};
pub const uws_header_iterator_s = opaque {};
pub const uws_app_t = uws_app_s;

pub const uws_socket_context_s = opaque {};
pub const uws_socket_context_t = uws_socket_context_s;
pub const RawWebSocket = opaque {};
pub const uws_websocket_handler = ?fn (?*RawWebSocket) callconv(.C) void;
pub const uws_websocket_message_handler = ?fn (?*RawWebSocket, [*c]const u8, usize, uws_opcode_t) callconv(.C) void;
pub const uws_websocket_ping_pong_handler = ?fn (?*RawWebSocket, [*c]const u8, usize) callconv(.C) void;
pub const uws_websocket_close_handler = ?fn (?*RawWebSocket, i32, [*c]const u8, usize) callconv(.C) void;
pub const uws_websocket_upgrade_handler = ?fn (*uws_res, ?*Request, ?*uws_socket_context_t) callconv(.C) void;
pub const uws_socket_behavior_t = extern struct {
    compression: uws_compress_options_t,
    maxPayloadLength: c_uint,
    idleTimeout: c_ushort,
    maxBackpressure: c_uint,
    closeOnBackpressureLimit: bool,
    resetIdleTimeoutOnSend: bool,
    sendPingsAutomatically: bool,
    maxLifetime: c_ushort,
    upgrade: uws_websocket_upgrade_handler,
    open: uws_websocket_handler,
    message: uws_websocket_message_handler,
    drain: uws_websocket_handler,
    ping: uws_websocket_ping_pong_handler,
    pong: uws_websocket_ping_pong_handler,
    close: uws_websocket_close_handler,
};
pub const uws_listen_handler = ?fn (?*listen_socket_t, ?*anyopaque) callconv(.C) void;
pub const uws_method_handler = ?fn (*uws_res, *Request, ?*anyopaque) callconv(.C) void;
pub const uws_filter_handler = ?fn (*uws_res, i32, ?*anyopaque) callconv(.C) void;
pub const uws_missing_server_handler = ?fn ([*c]const u8, ?*anyopaque) callconv(.C) void;

pub const Request = opaque {
    pub fn isAncient(req: *Request) bool {
        return uws_req_is_ancient(req);
    }
    pub fn getYield(req: *Request) bool {
        return uws_req_get_yield(req);
    }
    pub fn setYield(req: *Request, yield: bool) void {
        uws_req_set_field(req, yield);
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
        return ptr[0..req.uws_req_get_parameter(@intCast(c_ushort, index), &ptr)];
    }

    extern fn uws_req_is_ancient(res: *Request) bool;
    extern fn uws_req_get_yield(res: *Request) bool;
    extern fn uws_req_set_field(res: *Request, yield: bool) void;
    extern fn uws_req_get_url(res: *Request, dest: *[*]const u8) usize;
    extern fn uws_req_get_method(res: *Request, dest: *[*]const u8) usize;
    extern fn uws_req_get_header(res: *Request, lower_case_header: [*]const u8, lower_case_header_length: usize, dest: *[*]const u8) usize;
    extern fn uws_req_get_query(res: *Request, key: [*c]const u8, key_length: usize, dest: *[*]const u8) usize;
    extern fn uws_req_get_parameter(res: *Request, index: c_ushort, dest: *[*]const u8) usize;
};

const listen_socket_t = opaque {};
extern fn us_listen_socket_close(ssl: i32, ls: *listen_socket_t) void;

pub fn NewApp(comptime ssl: bool) type {
    return opaque {
        const ssl_flag = @as(i32, @boolToInt(ssl));
        const ThisApp = @This();

        pub fn create(opts: us_socket_context_options_t) *ThisApp {
            if (comptime is_bindgen) {
                unreachable;
            }
            return @ptrCast(*ThisApp, uws_create_app(ssl_flag, opts));
        }
        pub fn destroy(app: *ThisApp) void {
            if (comptime is_bindgen) {
                unreachable;
            }

            return uws_app_destroy(ssl_flag, @ptrCast(*uws_app_s, app));
        }

        fn RouteHandler(comptime UserDataType: type, comptime handler: fn (UserDataType, *Request, *Response) void) type {
            return struct {
                pub fn handle(res: *uws_res, req: *Request, user_data: ?*anyopaque) callconv(.C) void {
                    if (comptime is_bindgen) {
                        unreachable;
                    }

                    if (comptime UserDataType == void) {
                        return @call(
                            .{ .modifier = .always_inline },
                            handler,
                            .{
                                void{},
                                req,
                                @ptrCast(*Response, @alignCast(@alignOf(*Response), res)),
                            },
                        );
                    } else {
                        return @call(
                            .{ .modifier = .always_inline },
                            handler,
                            .{
                                @ptrCast(UserDataType, @alignCast(@alignOf(UserDataType), user_data.?)),
                                req,
                                @ptrCast(*Response, @alignCast(@alignOf(*Response), res)),
                            },
                        );
                    }
                }
            };
        }

        pub const ListenSocket = opaque {
            pub inline fn close(this: *ListenSocket) void {
                if (comptime is_bindgen) {
                    unreachable;
                }
                return us_listen_socket_close(ssl_flag, @ptrCast(*listen_socket_t, this));
            }
        };

        pub fn get(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_get(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn post(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_post(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn options(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_options(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn delete(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_delete(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn patch(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_patch(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn put(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_put(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn head(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_head(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn connect(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_connect(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn trace(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_trace(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn any(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            uws_app_any(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn run(app: *ThisApp) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            return uws_app_run(ssl_flag, @ptrCast(*uws_app_t, app));
        }
        pub fn listen(
            app: *ThisApp,
            port: i32,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ListenSocket, uws_app_listen_config_t) void,
        ) void {
            if (comptime is_bindgen) {
                unreachable;
            }
            const Wrapper = struct {
                pub fn handle(socket: ?*listen_socket_t, conf: uws_app_listen_config_t, data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserData == void) {
                        @call(.{ .modifier = .always_inline }, handler, .{ void{}, @ptrCast(?*ListenSocket, socket), conf });
                    } else {
                        @call(.{ .modifier = .always_inline }, handler, .{
                            @ptrCast(UserData, @alignCast(@alignOf(UserData), data.?)),
                            @ptrCast(?*ListenSocket, socket),
                            conf,
                        });
                    }
                }
            };
            return uws_app_listen(ssl_flag, @ptrCast(*uws_app_t, app), port, Wrapper.handle, user_data);
        }

        pub fn listenWithConfig(
            app: *ThisApp,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ListenSocket) void,
            config: uws_app_listen_config_t,
        ) void {
            const Wrapper = struct {
                pub fn handle(socket: ?*listen_socket_t, data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserData == void) {
                        @call(.{ .modifier = .always_inline }, handler, .{ void{}, @ptrCast(?*ListenSocket, socket) });
                    } else {
                        @call(.{ .modifier = .always_inline }, handler, .{
                            @ptrCast(UserData, @alignCast(@alignOf(UserData), data.?)),
                            @ptrCast(?*ListenSocket, socket),
                        });
                    }
                }
            };
            return uws_app_listen_with_config(ssl_flag, @ptrCast(*uws_app_t, app), config.host, @intCast(u16, config.port), config.options, Wrapper.handle, user_data);
        }
        pub fn constructorFailed(app: *ThisApp) bool {
            return uws_constructor_failed(ssl_flag, app);
        }
        pub fn num_subscribers(app: *ThisApp, topic: [:0]const u8) c_uint {
            return uws_num_subscribers(ssl_flag, @ptrCast(*uws_app_t, app), topic);
        }
        pub fn publish(app: *ThisApp, topic: []const u8, message: []const u8, opcode: uws_opcode_t, compress: bool) bool {
            return uws_publish(ssl_flag, @ptrCast(*uws_app_t, app), topic.ptr, topic.len, message.ptr, message.len, opcode, compress);
        }
        pub fn getNativeHandle(app: *ThisApp) ?*anyopaque {
            return uws_get_native_handle(ssl_flag, app);
        }
        pub fn removeServerName(app: *ThisApp, hostname_pattern: [*:0]const u8) void {
            return uws_remove_server_name(ssl_flag, @ptrCast(*uws_app_t, app), hostname_pattern);
        }
        pub fn addServerName(app: *ThisApp, hostname_pattern: [*:0]const u8) void {
            return uws_add_server_name(ssl_flag, @ptrCast(*uws_app_t, app), hostname_pattern);
        }
        pub fn addServerNameWithOptions(app: *ThisApp, hostname_pattern: [:0]const u8, opts: us_socket_context_options_t) void {
            return uws_add_server_name_with_options(ssl_flag, @ptrCast(*uws_app_t, app), hostname_pattern, opts);
        }
        pub fn missingServerName(app: *ThisApp, handler: uws_missing_server_handler, user_data: ?*anyopaque) void {
            return uws_missing_server_name(ssl_flag, @ptrCast(*uws_app_t, app), handler, user_data);
        }
        pub fn filter(app: *ThisApp, handler: uws_filter_handler, user_data: ?*anyopaque) void {
            return uws_filter(ssl_flag, @ptrCast(*uws_app_t, app), handler, user_data);
        }
        pub fn ws(app: *ThisApp, pattern: [:0]const u8, behavior: uws_socket_behavior_t) void {
            return uws_ws(ssl_flag, @ptrCast(*uws_app_t, app), pattern, behavior);
        }

        pub const Response = opaque {
            inline fn castRes(res: *uws_res) *Response {
                return @ptrCast(*Response, @alignCast(@alignOf(*Response), res));
            }

            pub inline fn downcast(res: *Response) *uws_res {
                return @ptrCast(*uws_res, @alignCast(@alignOf(*uws_res), res));
            }

            pub fn end(res: *Response, data: []const u8, close_connection: bool) void {
                uws_res_end(ssl_flag, res.downcast(), data.ptr, data.len, close_connection);
            }

            pub fn tryEnd(res: *Response, data: []const u8, total: usize, close: bool) bool {
                return uws_res_try_end(ssl_flag, res.downcast(), data.ptr, data.len, total, close);
            }

            pub fn state(res: *const Response) State {
                return uws_res_state(ssl_flag, @ptrCast(*const uws_res, @alignCast(@alignOf(*const uws_res), res)));
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
            pub fn endWithoutBody(res: *Response, _: bool) void {
                uws_res_end_without_body(ssl_flag, res.downcast());
            }
            pub fn write(res: *Response, data: []const u8) bool {
                return uws_res_write(ssl_flag, res.downcast(), data.ptr, data.len);
            }
            pub fn getWriteOffset(res: *Response) uintmax_t {
                return uws_res_get_write_offset(ssl_flag, res.downcast());
            }
            pub fn setWriteOffset(res: *Response, offset: anytype) void {
                uws_res_set_write_offset(ssl_flag, res.downcast(), @intCast(uintmax_t, offset));
            }
            pub fn hasResponded(res: *Response) bool {
                return uws_res_has_responded(ssl_flag, res.downcast());
            }

            pub fn getNativeHandle(res: *Response) i32 {
                return @intCast(i32, @ptrToInt(uws_res_get_native_handle(ssl_flag, res.downcast())));
            }
            pub fn onWritable(
                res: *Response,
                comptime UserDataType: type,
                comptime handler: fn (UserDataType, uintmax_t, *Response) callconv(.C) bool,
                user_data: UserDataType,
            ) void {
                const Wrapper = struct {
                    pub fn handle(this: *uws_res, amount: uintmax_t, data: ?*anyopaque) callconv(.C) bool {
                        if (comptime UserDataType == void) {
                            return @call(.{ .modifier = .always_inline }, handler, .{ void{}, amount, castRes(this) });
                        } else {
                            return @call(.{ .modifier = .always_inline }, handler, .{
                                @ptrCast(UserDataType, @alignCast(@alignOf(UserDataType), data.?)),
                                amount,
                                castRes(this),
                            });
                        }
                    }
                };
                uws_res_on_writable(ssl_flag, res.downcast(), Wrapper.handle, user_data);
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
                            @call(.{ .modifier = .always_inline }, handler, .{ void{}, castRes(this), void{} });
                        } else {
                            @call(.{ .modifier = .always_inline }, handler, .{ @ptrCast(UserDataType, @alignCast(@alignOf(UserDataType), user_data.?)), castRes(this) });
                        }
                    }
                };
                uws_res_on_aborted(ssl_flag, res.downcast(), Wrapper.handle, opcional_data);
            }

            pub fn clearAborted(res: *Response) void {
                uws_res_on_aborted(ssl_flag, res.downcast(), null, null);
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
                            @call(.{ .modifier = .always_inline }, handler, .{
                                void{},
                                castRes(this),
                                if (len > 0) chunk_ptr[0..len] else "",
                                last,
                            });
                        } else {
                            @call(.{ .modifier = .always_inline }, handler, .{
                                @ptrCast(UserDataType, @alignCast(@alignOf(UserDataType), user_data.?)),
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
                comptime Function: anytype,
                args: anytype,
            ) @typeInfo(@TypeOf(Function)).Fn.return_type.? {
                const Wrapper = struct {
                    opts: @TypeOf(args),
                    result: @typeInfo(@TypeOf(Function)).Fn.return_type.? = undefined,
                    pub fn run(this: *@This()) void {
                        this.result = @call(.{}, Function, this.opts);
                    }
                };
                var wrapped = Wrapper{
                    .opts = args,
                    .result = undefined,
                };
                runCorkedWithType(res, *Wrapper, Wrapper.run, &wrapped);
                return wrapped.result;
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
                            @call(.{ .modifier = .always_inline }, handler, .{
                                void{},
                            });
                        } else {
                            @call(.{ .modifier = .always_inline }, handler, .{
                                @ptrCast(UserDataType, @alignCast(@alignOf(UserDataType), user_data.?)),
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
            //                 @call(.{ .modifier = .always_inline }, handler, .{
            //                     void{},
            //                     fd,
            //                 });
            //             } else {
            //                 @call(.{ .modifier = .always_inline }, handler, .{
            //                     @ptrCast(
            //                         UserDataType,
            //                         @alignCast(@alignOf(UserDataType), user_data.?),
            //                     ),
            //                     fd,
            //                 });
            //             }
            //         }
            //     };

            //     const OnWritable = struct {
            //         pub fn handle(socket: *Socket) callconv(.C) ?*Socket {
            //             if (comptime UserDataType == void) {
            //                 @call(.{ .modifier = .always_inline }, handler, .{
            //                     void{},
            //                     fd,
            //                 });
            //             } else {
            //                 @call(.{ .modifier = .always_inline }, handler, .{
            //                     @ptrCast(
            //                         UserDataType,
            //                         @alignCast(@alignOf(UserDataType), user_data.?),
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

            pub const WebSocket = opaque {
                pub fn raw(this: *WebSocket) *RawWebSocket {
                    return @ptrCast(*RawWebSocket, this);
                }
                pub fn as(this: *WebSocket, comptime Type: type) ?*Type {
                    @setRuntimeSafety(false);
                    return @ptrCast(*?Type, @alignCast(@alignOf(Type), uws_ws_get_user_data(this))).*;
                }

                pub fn close(this: *WebSocket) void {
                    return uws_ws_close(ssl_flag, this.raw());
                }
                pub fn send(this: *WebSocket, message: []const u8, opcode: uws_opcode_t) SendStatus {
                    return uws_ws_send(ssl_flag, this.raw(), message.ptr, message.len, opcode);
                }
                pub fn sendWithOptions(this: *WebSocket, message: []const u8, opcode: uws_opcode_t, compress: bool, fin: bool) SendStatus {
                    return uws_ws_send_with_options(ssl_flag, this.raw(), message.ptr, message.len, opcode, compress, fin);
                }
                // pub fn sendFragment(this: *WebSocket, message: []const u8) SendStatus {
                //     return uws_ws_send_fragment(ssl_flag, this.raw(), message: [*c]const u8, length: usize, compress: bool);
                // }
                // pub fn sendFirstFragment(this: *WebSocket, message: []const u8) SendStatus {
                //     return uws_ws_send_first_fragment(ssl_flag, this.raw(), message: [*c]const u8, length: usize, compress: bool);
                // }
                // pub fn sendFirstFragmentWithOpcode(this: *WebSocket, message: []const u8, opcode: u32, compress: bool) SendStatus {
                //     return uws_ws_send_first_fragment_with_opcode(ssl_flag, this.raw(), message: [*c]const u8, length: usize, opcode: uws_opcode_t, compress: bool);
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
                            @call(.{ .modifier = .always_inline }, callback, .{bun.cast(ContextType, user_data.?)});
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
                //     return uws_ws_iterate_topics(ssl_flag, this.raw(), callback: ?fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
                // }
                pub fn publish(this: *WebSocket, topic: []const u8, message: []const u8) bool {
                    return uws_ws_publish(ssl_flag, this.raw(), topic.ptr, topic.len, message.ptr, message.len);
                }
                pub fn publishWithOptions(this: *WebSocket, topic: []const u8, message: []const u8, opcode: uws_opcode_t, compress: bool) bool {
                    return uws_ws_publish_with_options(ssl_flag, this.raw(), topic.ptr, topic.len, message.ptr, message.len, opcode, compress);
                }
                pub fn getBufferedAmount(this: *WebSocket) u32 {
                    return uws_ws_get_buffered_amount(ssl_flag, this.raw());
                }
                pub fn getRemoteAddress(this: *WebSocket, buf: []u8) []u8 {
                    return buf[0..uws_ws_get_remote_address(ssl_flag, this.raw(), &buf.ptr)];
                }

                pub fn getRemoteAddressAsText(this: *WebSocket, buf: []u8) []u8 {
                    return buf[0..uws_ws_get_remote_address_as_text(ssl_flag, this.raw(), &buf.ptr)];
                }
            };
        };
    };
}
extern fn uws_res_end_stream(ssl: i32, res: *uws_res, close_connection: bool) void;
extern fn uws_res_prepare_for_sendfile(ssl: i32, res: *uws_res) void;
extern fn uws_res_get_native_handle(ssl: i32, res: *uws_res) *Socket;
extern fn uws_create_app(ssl: i32, options: us_socket_context_options_t) *uws_app_t;
extern fn uws_app_destroy(ssl: i32, app: *uws_app_t) void;
extern fn uws_app_get(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_post(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_options(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_delete(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_patch(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_put(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_head(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_connect(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_trace(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_any(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_run(ssl: i32, *uws_app_t) void;
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
extern fn uws_num_subscribers(ssl: i32, app: *uws_app_t, topic: [*c]const u8) c_uint;
extern fn uws_publish(ssl: i32, app: *uws_app_t, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: uws_opcode_t, compress: bool) bool;
extern fn uws_get_native_handle(ssl: i32, app: *uws_app_t) ?*anyopaque;
extern fn uws_remove_server_name(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
extern fn uws_add_server_name(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
extern fn uws_add_server_name_with_options(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8, options: us_socket_context_options_t) void;
extern fn uws_missing_server_name(ssl: i32, app: *uws_app_t, handler: uws_missing_server_handler, user_data: ?*anyopaque) void;
extern fn uws_filter(ssl: i32, app: *uws_app_t, handler: uws_filter_handler, user_data: ?*anyopaque) void;
extern fn uws_ws(ssl: i32, app: *uws_app_t, pattern: [*c]const u8, behavior: uws_socket_behavior_t) void;

extern fn uws_ws_get_user_data(ssl: i32, ws: ?*RawWebSocket) ?*anyopaque;
extern fn uws_ws_close(ssl: i32, ws: ?*RawWebSocket) void;
extern fn uws_ws_send(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: uws_opcode_t) SendStatus;
extern fn uws_ws_send_with_options(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: uws_opcode_t, compress: bool, fin: bool) SendStatus;
extern fn uws_ws_send_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
extern fn uws_ws_send_first_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
extern fn uws_ws_send_first_fragment_with_opcode(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, opcode: uws_opcode_t, compress: bool) SendStatus;
extern fn uws_ws_send_last_fragment(ssl: i32, ws: ?*RawWebSocket, message: [*c]const u8, length: usize, compress: bool) SendStatus;
extern fn uws_ws_end(ssl: i32, ws: ?*RawWebSocket, code: i32, message: [*c]const u8, length: usize) void;
extern fn uws_ws_cork(ssl: i32, ws: ?*RawWebSocket, handler: ?fn (?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
extern fn uws_ws_subscribe(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_unsubscribe(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_is_subscribed(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_iterate_topics(ssl: i32, ws: ?*RawWebSocket, callback: ?fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
extern fn uws_ws_publish(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize) bool;
extern fn uws_ws_publish_with_options(ssl: i32, ws: ?*RawWebSocket, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: uws_opcode_t, compress: bool) bool;
extern fn uws_ws_get_buffered_amount(ssl: i32, ws: ?*RawWebSocket) c_uint;
extern fn uws_ws_get_remote_address(ssl: i32, ws: ?*RawWebSocket, dest: [*c][*c]const u8) usize;
extern fn uws_ws_get_remote_address_as_text(ssl: i32, ws: ?*RawWebSocket, dest: [*c][*c]const u8) usize;
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
extern fn uws_res_end_without_body(ssl: i32, res: *uws_res) void;
extern fn uws_res_write(ssl: i32, res: *uws_res, data: [*c]const u8, length: usize) bool;
extern fn uws_res_get_write_offset(ssl: i32, res: *uws_res) uintmax_t;
extern fn uws_res_set_write_offset(ssl: i32, res: *uws_res, uintmax_t) void;
extern fn uws_res_has_responded(ssl: i32, res: *uws_res) bool;
extern fn uws_res_on_writable(ssl: i32, res: *uws_res, handler: ?fn (*uws_res, uintmax_t, ?*anyopaque) callconv(.C) bool, user_data: ?*anyopaque) void;
extern fn uws_res_on_aborted(ssl: i32, res: *uws_res, handler: ?fn (*uws_res, ?*anyopaque) callconv(.C) void, opcional_data: ?*anyopaque) void;
extern fn uws_res_on_data(
    ssl: i32,
    res: *uws_res,
    handler: ?fn (*uws_res, [*c]const u8, usize, bool, ?*anyopaque) callconv(.C) void,
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
extern fn uws_res_cork(i32, res: *uws_res, ctx: *anyopaque, corker: fn (?*anyopaque) callconv(.C) void) void;
extern fn uws_res_write_headers(i32, res: *uws_res, names: [*]const Api.StringPointer, values: [*]const Api.StringPointer, count: usize, buf: [*]const u8) void;
pub const LIBUS_RECV_BUFFER_LENGTH = @import("std").zig.c_translation.promoteIntLiteral(i32, 524288, .decimal);
pub const LIBUS_TIMEOUT_GRANULARITY = @as(i32, 4);
pub const LIBUS_RECV_BUFFER_PADDING = @as(i32, 32);
pub const LIBUS_EXT_ALIGNMENT = @as(i32, 16);
pub const LIBUS_SOCKET_DESCRIPTOR = i32;

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
pub const uws_compress_options_t = c_uint;
pub const CONTINUATION: i32 = 0;
pub const TEXT: i32 = 1;
pub const BINARY: i32 = 2;
pub const CLOSE: i32 = 8;
pub const PING: i32 = 9;
pub const PONG: i32 = 10;
pub const uws_opcode_t = c_uint;
pub const SendStatus = enum(c_uint) {
    backpressure = 0,
    success = 1,
    dropped = 2,
};
pub const uws_app_listen_config_t = extern struct {
    port: i32,
    host: [*c]const u8 = null,
    options: i32,
};

extern fn us_socket_mark_needs_more_not_ssl(socket: ?*uws_res) void;

extern fn uws_res_state(ssl: c_int, res: *const uws_res) State;

pub const State = enum(i32) {
    HTTP_STATUS_CALLED = 1,
    HTTP_WRITE_CALLED = 2,
    HTTP_END_CALLED = 4,
    HTTP_RESPONSE_PENDING = 8,
    HTTP_CONNECTION_CLOSE = 16,

    _,

    pub inline fn isResponsePending(this: State) bool {
        return @enumToInt(this) & @enumToInt(State.HTTP_RESPONSE_PENDING) != 0;
    }

    pub inline fn isHttpEndCalled(this: State) bool {
        return @enumToInt(this) & @enumToInt(State.HTTP_END_CALLED) != 0;
    }

    pub inline fn isHttpWriteCalled(this: State) bool {
        return @enumToInt(this) & @enumToInt(State.HTTP_WRITE_CALLED) != 0;
    }

    pub inline fn isHttpStatusCalled(this: State) bool {
        return @enumToInt(this) & @enumToInt(State.HTTP_STATUS_CALLED) != 0;
    }

    pub inline fn isHttpConnectionClose(this: State) bool {
        return @enumToInt(this) & @enumToInt(State.HTTP_CONNECTION_CLOSE) != 0;
    }
};
