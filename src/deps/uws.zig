const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const Environment = @import("../env.zig");
pub const u_int8_t = u8;
pub const u_int16_t = c_ushort;
pub const u_int32_t = c_uint;
pub const u_int64_t = c_ulonglong;
pub const LIBUS_LISTEN_DEFAULT: c_int = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: c_int = 1;
pub const Socket = opaque {};
pub const us_timer_t = opaque {};
pub const us_socket_context_t = opaque {};
pub const Loop = opaque {
    pub fn get() ?*Loop {
        return uws_get_loop();
    }

    pub fn wakeup(this: *Loop) void {
        return us_wakeup_loop(this);
    }

    pub fn tick(this: *Loop) void {
        us_loop_tick(this);
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
            pub fn remove(handler: @This()) void {
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

    extern fn uws_loop_defer(loop: *Loop, ctx: *anyopaque, cb: fn (ctx: *anyopaque) callconv(.C) void) void;

    extern fn uws_get_loop() ?*Loop;
    extern fn us_create_loop(hint: ?*anyopaque, wakeup_cb: ?fn (?*Loop) callconv(.C) void, pre_cb: ?fn (?*Loop) callconv(.C) void, post_cb: ?fn (?*Loop) callconv(.C) void, ext_size: c_uint) ?*Loop;
    extern fn us_loop_free(loop: ?*Loop) void;
    extern fn us_loop_ext(loop: ?*Loop) ?*anyopaque;
    extern fn us_loop_run(loop: ?*Loop) void;
    extern fn us_loop_tick(loop: ?*Loop) void;
    extern fn us_wakeup_loop(loop: ?*Loop) void;
    extern fn us_loop_integrate(loop: ?*Loop) void;
    extern fn us_loop_iteration_number(loop: ?*Loop) c_longlong;
    extern fn uws_loop_addPostHandler(loop: *Loop, ctx: *anyopaque, cb: (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
    extern fn uws_loop_removePostHandler(loop: *Loop, ctx: *anyopaque, cb: (fn (ctx: *anyopaque, loop: *Loop) callconv(.C) void)) void;
};
const uintmax_t = c_ulong;

extern fn us_create_timer(loop: ?*Loop, fallthrough: c_int, ext_size: c_uint) ?*us_timer_t;
extern fn us_timer_ext(timer: ?*us_timer_t) ?*anyopaque;
extern fn us_timer_close(timer: ?*us_timer_t) void;
extern fn us_timer_set(timer: ?*us_timer_t, cb: ?fn (?*us_timer_t) callconv(.C) void, ms: c_int, repeat_ms: c_int) void;
extern fn us_timer_loop(t: ?*us_timer_t) ?*Loop;
pub const us_socket_context_options_t = extern struct {
    key_file_name: [*c]const u8 = null,
    cert_file_name: [*c]const u8 = null,
    passphrase: [*c]const u8 = null,
    dh_params_file_name: [*c]const u8 = null,
    ca_file_name: [*c]const u8 = null,
    ssl_prefer_low_memory_usage: c_int = 0,
};

extern fn us_socket_context_timestamp(ssl: c_int, context: ?*us_socket_context_t) c_ushort;
extern fn us_socket_context_add_server_name(ssl: c_int, context: ?*us_socket_context_t, hostname_pattern: [*c]const u8, options: us_socket_context_options_t) void;
extern fn us_socket_context_remove_server_name(ssl: c_int, context: ?*us_socket_context_t, hostname_pattern: [*c]const u8) void;
extern fn us_socket_context_on_server_name(ssl: c_int, context: ?*us_socket_context_t, cb: ?fn (?*us_socket_context_t, [*c]const u8) callconv(.C) void) void;
extern fn us_socket_context_get_native_handle(ssl: c_int, context: ?*us_socket_context_t) ?*anyopaque;
extern fn us_create_socket_context(ssl: c_int, loop: ?*Loop, ext_size: c_int, options: us_socket_context_options_t) ?*us_socket_context_t;
extern fn us_socket_context_free(ssl: c_int, context: ?*us_socket_context_t) void;
extern fn us_socket_context_on_open(ssl: c_int, context: ?*us_socket_context_t, on_open: ?fn (?*Socket, c_int, [*c]u8, c_int) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_close(ssl: c_int, context: ?*us_socket_context_t, on_close: ?fn (?*Socket, c_int, ?*anyopaque) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_data(ssl: c_int, context: ?*us_socket_context_t, on_data: ?fn (?*Socket, [*c]u8, c_int) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_writable(ssl: c_int, context: ?*us_socket_context_t, on_writable: ?fn (*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_timeout(ssl: c_int, context: ?*us_socket_context_t, on_timeout: ?fn (?*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_connect_error(ssl: c_int, context: ?*us_socket_context_t, on_connect_error: ?fn (?*Socket, c_int) callconv(.C) ?*Socket) void;
extern fn us_socket_context_on_end(ssl: c_int, context: ?*us_socket_context_t, on_end: ?fn (?*Socket) callconv(.C) ?*Socket) void;
extern fn us_socket_context_ext(ssl: c_int, context: ?*us_socket_context_t) ?*anyopaque;

extern fn us_socket_context_listen(ssl: c_int, context: ?*us_socket_context_t, host: [*c]const u8, port: c_int, options: c_int, socket_ext_size: c_int) ?*listen_socket_t;

extern fn us_socket_context_connect(ssl: c_int, context: ?*us_socket_context_t, host: [*c]const u8, port: c_int, source_host: [*c]const u8, options: c_int, socket_ext_size: c_int) ?*Socket;
extern fn us_socket_is_established(ssl: c_int, s: ?*Socket) c_int;
extern fn us_socket_close_connecting(ssl: c_int, s: ?*Socket) ?*Socket;
extern fn us_socket_context_loop(ssl: c_int, context: ?*us_socket_context_t) ?*Loop;
extern fn us_socket_context_adopt_socket(ssl: c_int, context: ?*us_socket_context_t, s: ?*Socket, ext_size: c_int) ?*Socket;
extern fn us_create_child_socket_context(ssl: c_int, context: ?*us_socket_context_t, context_ext_size: c_int) ?*us_socket_context_t;

pub const Poll = opaque {
    pub fn create(
        loop: *Loop,
        comptime Data: type,
        file: c_int,
        val: Data,
        fallthrough: bool,
        flags: Flags,
        callback: CallbackType,
    ) ?*Poll {
        var poll = us_create_callback(loop, @as(c_int, @boolToInt(fallthrough)), file, @sizeOf(Data));
        if (comptime Data != void) {
            poll.data(Data).* = val;
        }
        var flags_int: c_int = 0;
        if (flags.read) {
            flags_int |= Flags.read_flag;
        }

        if (flags.write) {
            flags_int |= Flags.write_flag;
        }

        us_callback_set(poll, flags_int, callback);
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

    pub fn start(self: *Poll, poll_type: Flags) void {
        // us_poll_start(self, loop: ?*Loop, events: c_int)
        _ = self;
        _ = poll_type;
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
    pub const CallbackType = fn (?*anyopaque, c_int, c_int, c_int, *Poll) void;
    extern fn us_create_callback(loop: ?*Loop, fallthrough: c_int, fd: c_int, ext_size: c_uint) *Poll;
    extern fn us_callback_set(poll: *Poll, events: c_int, callback: CallbackType) *Poll;
    extern fn us_poll_free(p: ?*Poll, loop: ?*Loop) void;
    extern fn us_poll_init(p: ?*Poll, fd: c_int, poll_type: c_int) void;
    extern fn us_poll_start(p: ?*Poll, loop: ?*Loop, events: c_int) void;
    extern fn us_poll_change(p: ?*Poll, loop: ?*Loop, events: c_int) void;
    extern fn us_poll_stop(p: ?*Poll, loop: ?*Loop) void;
    extern fn us_poll_events(p: ?*Poll) c_int;
    extern fn us_poll_ext(p: ?*Poll) ?*anyopaque;
    extern fn us_poll_fd(p: ?*Poll) c_int;
    extern fn us_poll_resize(p: ?*Poll, loop: ?*Loop, ext_size: c_uint) ?*Poll;
};

extern fn us_socket_get_native_handle(ssl: c_int, s: ?*Socket) ?*anyopaque;
extern fn us_socket_write(ssl: c_int, s: ?*Socket, data: [*c]const u8, length: c_int, msg_more: c_int) c_int;
extern fn Socketimeout(ssl: c_int, s: ?*Socket, seconds: c_uint) void;
extern fn us_socket_ext(ssl: c_int, s: ?*Socket) ?*anyopaque;
extern fn us_socket_context(ssl: c_int, s: ?*Socket) ?*us_socket_context_t;
extern fn us_socket_flush(ssl: c_int, s: ?*Socket) void;
extern fn us_socket_shutdown(ssl: c_int, s: ?*Socket) void;
extern fn us_socket_shutdown_read(ssl: c_int, s: ?*Socket) void;
extern fn us_socket_is_shut_down(ssl: c_int, s: ?*Socket) c_int;
extern fn us_socket_is_closed(ssl: c_int, s: ?*Socket) c_int;
extern fn us_socket_close(ssl: c_int, s: ?*Socket, code: c_int, reason: ?*anyopaque) ?*Socket;
extern fn us_socket_local_port(ssl: c_int, s: ?*Socket) c_int;
extern fn us_socket_remote_address(ssl: c_int, s: ?*Socket, buf: [*c]u8, length: [*c]c_int) void;
pub const uws_app_s = opaque {};
pub const uws_req_s = opaque {};
pub const uws_websocket_s = opaque {};
pub const uws_header_iterator_s = opaque {};
pub const uws_app_t = uws_app_s;

pub const uws_socket_context_s = opaque {};
pub const uws_socket_context_t = uws_socket_context_s;
pub const uws_websocket_t = uws_websocket_s;
pub const uws_websocket_handler = ?fn (?*uws_websocket_t) callconv(.C) void;
pub const uws_websocket_message_handler = ?fn (?*uws_websocket_t, [*c]const u8, usize, uws_opcode_t) callconv(.C) void;
pub const uws_websocket_ping_pong_handler = ?fn (?*uws_websocket_t, [*c]const u8, usize) callconv(.C) void;
pub const uws_websocket_close_handler = ?fn (?*uws_websocket_t, c_int, [*c]const u8, usize) callconv(.C) void;
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
pub const uws_listen_handler = ?fn (?*listen_socket_t, uws_app_listen_config_t, ?*anyopaque) callconv(.C) void;
pub const uws_method_handler = ?fn (*uws_res, *Request, ?*anyopaque) callconv(.C) void;
pub const uws_filter_handler = ?fn (*uws_res, c_int, ?*anyopaque) callconv(.C) void;
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
extern fn us_listen_socket_close(ssl: c_int, ls: *listen_socket_t) void;

pub fn NewApp(comptime ssl: bool) type {
    return opaque {
        const ssl_flag = @as(c_int, @boolToInt(ssl));
        const ThisApp = @This();

        pub fn create(opts: us_socket_context_options_t) *ThisApp {
            return @ptrCast(*ThisApp, uws_create_app(ssl_flag, opts));
        }
        pub fn destroy(app: *ThisApp) void {
            return uws_app_destroy(ssl_flag, @ptrCast(*uws_app_s, app));
        }

        fn RouteHandler(comptime UserDataType: type, comptime handler: fn (UserDataType, *Request, *Response) void) type {
            return struct {
                pub fn handle(res: *uws_res, req: *Request, user_data: ?*anyopaque) callconv(.C) void {
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
            uws_app_get(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn post(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_post(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn options(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_options(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn delete(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_delete(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn patch(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_patch(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn put(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_put(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn head(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_head(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn connect(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_connect(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn trace(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_trace(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn any(
            app: *ThisApp,
            pattern: [:0]const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            uws_app_any(ssl_flag, @ptrCast(*uws_app_t, app), pattern, RouteHandler(UserDataType, handler).handle, user_data);
        }
        pub fn run(app: *ThisApp) void {
            return uws_app_run(ssl_flag, @ptrCast(*uws_app_t, app));
        }
        pub fn listen(
            app: *ThisApp,
            port: c_int,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ListenSocket, uws_app_listen_config_t) void,
        ) void {
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
            comptime handler: fn (UserData, ?*ListenSocket, uws_app_listen_config_t) void,
            config: uws_app_listen_config_t,
        ) void {
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
            return uws_app_listen_with_config(ssl_flag, @ptrCast(*uws_app_t, app), config, Wrapper.handle, user_data);
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

            pub fn tryEnd(res: *Response, data: []const u8, total: usize) bool {
                return uws_res_try_end(ssl_flag, res.downcast(), data.ptr, data.len, total);
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
            pub fn endWithoutBody(res: *Response) void {
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

            pub fn runCorked(
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
        };
    };
}
extern fn uws_res_prepare_for_sendfile(ssl: c_int, res: *uws_res) void;
extern fn uws_res_get_native_handle(ssl: c_int, res: *uws_res) *Socket;
extern fn uws_create_app(ssl: c_int, options: us_socket_context_options_t) *uws_app_t;
extern fn uws_app_destroy(ssl: c_int, app: *uws_app_t) void;
extern fn uws_app_get(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_post(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_options(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_delete(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_patch(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_put(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_head(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_connect(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_trace(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_any(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, handler: uws_method_handler, user_data: ?*anyopaque) void;
extern fn uws_app_run(ssl: c_int, *uws_app_t) void;
extern fn uws_app_listen(ssl: c_int, app: *uws_app_t, port: c_int, handler: uws_listen_handler, user_data: ?*anyopaque) void;
extern fn uws_app_listen_with_config(ssl: c_int, app: *uws_app_t, config: uws_app_listen_config_t, handler: uws_listen_handler, user_data: ?*anyopaque) void;
extern fn uws_constructor_failed(ssl: c_int, app: *uws_app_t) bool;
extern fn uws_num_subscribers(ssl: c_int, app: *uws_app_t, topic: [*c]const u8) c_uint;
extern fn uws_publish(ssl: c_int, app: *uws_app_t, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: uws_opcode_t, compress: bool) bool;
extern fn uws_get_native_handle(ssl: c_int, app: *uws_app_t) ?*anyopaque;
extern fn uws_remove_server_name(ssl: c_int, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
extern fn uws_add_server_name(ssl: c_int, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
extern fn uws_add_server_name_with_options(ssl: c_int, app: *uws_app_t, hostname_pattern: [*c]const u8, options: us_socket_context_options_t) void;
extern fn uws_missing_server_name(ssl: c_int, app: *uws_app_t, handler: uws_missing_server_handler, user_data: ?*anyopaque) void;
extern fn uws_filter(ssl: c_int, app: *uws_app_t, handler: uws_filter_handler, user_data: ?*anyopaque) void;
extern fn uws_ws(ssl: c_int, app: *uws_app_t, pattern: [*c]const u8, behavior: uws_socket_behavior_t) void;

extern fn uws_ws_get_user_data(ssl: c_int, ws: ?*uws_websocket_t) ?*anyopaque;
extern fn uws_ws_close(ssl: c_int, ws: ?*uws_websocket_t) void;
extern fn uws_ws_send(ssl: c_int, ws: ?*uws_websocket_t, message: [*c]const u8, length: usize, opcode: uws_opcode_t) uws_sendstatus_t;
extern fn uws_ws_send_with_options(ssl: c_int, ws: ?*uws_websocket_t, message: [*c]const u8, length: usize, opcode: uws_opcode_t, compress: bool, fin: bool) uws_sendstatus_t;
extern fn uws_ws_send_fragment(ssl: c_int, ws: ?*uws_websocket_t, message: [*c]const u8, length: usize, compress: bool) uws_sendstatus_t;
extern fn uws_ws_send_first_fragment(ssl: c_int, ws: ?*uws_websocket_t, message: [*c]const u8, length: usize, compress: bool) uws_sendstatus_t;
extern fn uws_ws_send_first_fragment_with_opcode(ssl: c_int, ws: ?*uws_websocket_t, message: [*c]const u8, length: usize, opcode: uws_opcode_t, compress: bool) uws_sendstatus_t;
extern fn uws_ws_send_last_fragment(ssl: c_int, ws: ?*uws_websocket_t, message: [*c]const u8, length: usize, compress: bool) uws_sendstatus_t;
extern fn uws_ws_end(ssl: c_int, ws: ?*uws_websocket_t, code: c_int, message: [*c]const u8, length: usize) void;
extern fn uws_ws_cork(ssl: c_int, ws: ?*uws_websocket_t, handler: ?fn (?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
extern fn uws_ws_subscribe(ssl: c_int, ws: ?*uws_websocket_t, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_unsubscribe(ssl: c_int, ws: ?*uws_websocket_t, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_is_subscribed(ssl: c_int, ws: ?*uws_websocket_t, topic: [*c]const u8, length: usize) bool;
extern fn uws_ws_iterate_topics(ssl: c_int, ws: ?*uws_websocket_t, callback: ?fn ([*c]const u8, usize, ?*anyopaque) callconv(.C) void, user_data: ?*anyopaque) void;
extern fn uws_ws_publish(ssl: c_int, ws: ?*uws_websocket_t, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize) bool;
extern fn uws_ws_publish_with_options(ssl: c_int, ws: ?*uws_websocket_t, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: uws_opcode_t, compress: bool) bool;
extern fn uws_ws_get_buffered_amount(ssl: c_int, ws: ?*uws_websocket_t) c_uint;
extern fn uws_ws_get_remote_address(ssl: c_int, ws: ?*uws_websocket_t, dest: [*c][*c]const u8) usize;
extern fn uws_ws_get_remote_address_as_text(ssl: c_int, ws: ?*uws_websocket_t, dest: [*c][*c]const u8) usize;
const uws_res = opaque {};
extern fn uws_res_uncork(ssl: c_int, res: *uws_res) void;
extern fn uws_res_end(ssl: c_int, res: *uws_res, data: [*c]const u8, length: usize, close_connection: bool) void;
extern fn uws_res_try_end(ssl: c_int, res: *uws_res, data: [*c]const u8, length: usize, total: usize) bool;
extern fn uws_res_pause(ssl: c_int, res: *uws_res) void;
extern fn uws_res_resume(ssl: c_int, res: *uws_res) void;
extern fn uws_res_write_continue(ssl: c_int, res: *uws_res) void;
extern fn uws_res_write_status(ssl: c_int, res: *uws_res, status: [*c]const u8, length: usize) void;
extern fn uws_res_write_header(ssl: c_int, res: *uws_res, key: [*c]const u8, key_length: usize, value: [*c]const u8, value_length: usize) void;
extern fn uws_res_write_header_int(ssl: c_int, res: *uws_res, key: [*c]const u8, key_length: usize, value: u64) void;
extern fn uws_res_end_without_body(ssl: c_int, res: *uws_res) void;
extern fn uws_res_write(ssl: c_int, res: *uws_res, data: [*c]const u8, length: usize) bool;
extern fn uws_res_get_write_offset(ssl: c_int, res: *uws_res) uintmax_t;
extern fn uws_res_set_write_offset(ssl: c_int, res: *uws_res, uintmax_t) void;
extern fn uws_res_has_responded(ssl: c_int, res: *uws_res) bool;
extern fn uws_res_on_writable(ssl: c_int, res: *uws_res, handler: ?fn (*uws_res, uintmax_t, ?*anyopaque) callconv(.C) bool, user_data: ?*anyopaque) void;
extern fn uws_res_on_aborted(ssl: c_int, res: *uws_res, handler: ?fn (*uws_res, ?*anyopaque) callconv(.C) void, opcional_data: ?*anyopaque) void;
extern fn uws_res_on_data(
    ssl: c_int,
    res: *uws_res,
    handler: ?fn (*uws_res, [*c]const u8, usize, bool, ?*anyopaque) callconv(.C) void,
    opcional_data: ?*anyopaque,
) void;
extern fn uws_res_upgrade(
    ssl: c_int,
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
extern fn uws_res_cork(c_int, res: *uws_res, ctx: *anyopaque, corker: fn (?*anyopaque) callconv(.C) void) void;
extern fn uws_res_write_headers(c_int, res: *uws_res, names: [*]const Api.StringPointer, values: [*]const Api.StringPointer, count: usize, buf: [*]const u8) void;
pub const LIBUS_RECV_BUFFER_LENGTH = @import("std").zig.c_translation.promoteIntLiteral(c_int, 524288, .decimal);
pub const LIBUS_TIMEOUT_GRANULARITY = @as(c_int, 4);
pub const LIBUS_RECV_BUFFER_PADDING = @as(c_int, 32);
pub const LIBUS_EXT_ALIGNMENT = @as(c_int, 16);
pub const LIBUS_SOCKET_DESCRIPTOR = c_int;

pub const _COMPRESSOR_MASK: c_int = 255;
pub const _DECOMPRESSOR_MASK: c_int = 3840;
pub const DISABLED: c_int = 0;
pub const SHARED_COMPRESSOR: c_int = 1;
pub const SHARED_DECOMPRESSOR: c_int = 256;
pub const DEDICATED_DECOMPRESSOR_32KB: c_int = 3840;
pub const DEDICATED_DECOMPRESSOR_16KB: c_int = 3584;
pub const DEDICATED_DECOMPRESSOR_8KB: c_int = 3328;
pub const DEDICATED_DECOMPRESSOR_4KB: c_int = 3072;
pub const DEDICATED_DECOMPRESSOR_2KB: c_int = 2816;
pub const DEDICATED_DECOMPRESSOR_1KB: c_int = 2560;
pub const DEDICATED_DECOMPRESSOR_512B: c_int = 2304;
pub const DEDICATED_DECOMPRESSOR: c_int = 3840;
pub const DEDICATED_COMPRESSOR_3KB: c_int = 145;
pub const DEDICATED_COMPRESSOR_4KB: c_int = 146;
pub const DEDICATED_COMPRESSOR_8KB: c_int = 163;
pub const DEDICATED_COMPRESSOR_16KB: c_int = 180;
pub const DEDICATED_COMPRESSOR_32KB: c_int = 197;
pub const DEDICATED_COMPRESSOR_64KB: c_int = 214;
pub const DEDICATED_COMPRESSOR_128KB: c_int = 231;
pub const DEDICATED_COMPRESSOR_256KB: c_int = 248;
pub const DEDICATED_COMPRESSOR: c_int = 248;
pub const uws_compress_options_t = c_uint;
pub const CONTINUATION: c_int = 0;
pub const TEXT: c_int = 1;
pub const BINARY: c_int = 2;
pub const CLOSE: c_int = 8;
pub const PING: c_int = 9;
pub const PONG: c_int = 10;
pub const uws_opcode_t = c_uint;
pub const BACKPRESSURE: c_int = 0;
pub const SUCCESS: c_int = 1;
pub const DROPPED: c_int = 2;
pub const uws_sendstatus_t = c_uint;
pub const uws_app_listen_config_t = extern struct {
    port: c_int,
    host: [*c]const u8 = null,
    options: c_int,
};

extern fn us_socket_mark_needs_more_not_ssl(socket: ?*uws_res) void;
