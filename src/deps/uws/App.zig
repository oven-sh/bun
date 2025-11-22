pub fn NewApp(comptime ssl: bool) type {
    // TODO: change to `opaque` when https://github.com/ziglang/zig/issues/22869 is fixed
    // This file provides Zig bindings for the uWebSockets App class.
    // It wraps the C API exposed in libuwsockets.cpp which provides a C interface
    // to the C++ uWebSockets library defined in App.h.
    //
    // The architecture is:
    // 1. App.h - C++ uWebSockets library with TemplatedApp<SSL> class
    //    - Defines the main TemplatedApp<bool SSL> template class
    //    - Provides HTTP/WebSocket server functionality with SSL/non-SSL variants
    //    - Contains WebSocketBehavior struct for configuring WebSocket handlers
    //    - Implements routing methods (get, post, put, delete, etc.)
    //    - Manages WebSocket contexts, topic trees for pub/sub, and compression
    //    - Handles server name (SNI) support for SSL contexts
    //    - Provides listen() methods for binding to ports/unix sockets
    //
    // 2. libuwsockets.cpp - C wrapper functions that call the C++ methods
    //    - Exposes C functions like uws_create_app(), uws_app_get(), etc.
    //    - Handles SSL/non-SSL branching with if(ssl) checks
    //    - Converts between C types (char*, size_t) and C++ types (string_view)
    //    - Manages memory and object lifetime for C callers
    //    - Provides callback wrappers that convert C function pointers to C++ lambdas
    //    - Functions like uws_app_connect(), uws_app_trace() mirror C++ methods
    //
    // 3. App.zig - Zig bindings that call the C wrapper functions
    //    - NewApp() function returns a generic struct parameterized by SSL boolean
    //    - Methods like create(), destroy(), close() call corresponding C functions
    //    - Type-safe wrappers around raw C pointers and function calls
    //    - Converts Zig slices to C pointer/length pairs
    //    - Provides compile-time SSL flag selection via @intFromBool(ssl)
    //    - RouteHandler() provides type-safe callback mechanism for HTTP routes
    //
    // This layered approach allows Zig code to use high-performance uWebSockets
    // functionality while maintaining memory safety and Zig's type system benefits.
    // The C layer handles the impedance mismatch between Zig and C++, while the
    // Zig layer provides idiomatic APIs for Zig developers.
    return struct {
        pub const is_ssl = ssl;
        const ssl_flag: i32 = @intFromBool(ssl);
        const ThisApp = @This();

        pub fn close(this: *ThisApp) void {
            return c.uws_app_close(ssl_flag, @as(*uws_app_s, @ptrCast(this)));
        }

        pub fn closeIdleConnections(this: *ThisApp) void {
            return c.uws_app_close_idle(ssl_flag, @as(*uws_app_s, @ptrCast(this)));
        }

        pub fn create(opts: BunSocketContextOptions) ?*ThisApp {
            return @ptrCast(c.uws_create_app(ssl_flag, opts));
        }

        pub fn destroy(app: *ThisApp) void {
            return c.uws_app_destroy(ssl_flag, @as(*uws_app_s, @ptrCast(app)));
        }

        pub fn setFlags(this: *ThisApp, require_host_header: bool, use_strict_method_validation: bool) void {
            return c.uws_app_set_flags(ssl_flag, @as(*uws_app_t, @ptrCast(this)), require_host_header, use_strict_method_validation);
        }

        pub fn setMaxHTTPHeaderSize(this: *ThisApp, max_header_size: u64) void {
            return c.uws_app_set_max_http_header_size(ssl_flag, @as(*uws_app_t, @ptrCast(this)), max_header_size);
        }

        pub fn clearRoutes(app: *ThisApp) void {
            return c.uws_app_clear_routes(ssl_flag, @as(*uws_app_t, @ptrCast(app)));
        }

        pub fn publishWithOptions(app: *ThisApp, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
            return c.uws_publish(
                @intFromBool(ssl),
                @ptrCast(app),
                topic.ptr,
                topic.len,
                message.ptr,
                message.len,
                opcode,
                compress,
            );
        }

        fn RouteHandler(comptime UserDataType: type, comptime handler: fn (UserDataType, *Request, *Response) void) type {
            return struct {
                pub fn handle(res: *uws.uws_res, req: *Request, user_data: ?*anyopaque) callconv(.c) void {
                    if (comptime UserDataType == void) {
                        return @call(
                            bun.callmod_inline,
                            handler,
                            .{
                                {},
                                req,
                                @as(*Response, @ptrCast(@alignCast(res))),
                            },
                        );
                    } else {
                        return @call(
                            bun.callmod_inline,
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
                return @as(*uws.ListenSocket, @ptrCast(this)).close(ssl);
            }
            pub inline fn getLocalPort(this: *ThisApp.ListenSocket) i32 {
                return @as(*uws.ListenSocket, @ptrCast(this)).getLocalPort(ssl);
            }

            pub fn socket(this: *ThisApp.ListenSocket) uws.NewSocketHandler(ssl) {
                return uws.NewSocketHandler(ssl).from(@ptrCast(this));
            }
        };

        pub fn get(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_get(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn post(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_post(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn options(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_options(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn delete(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_delete(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn patch(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_patch(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn put(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_put(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn head(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_head(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn connect(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_connect(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn trace(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_trace(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn method(
            app: *ThisApp,
            method_: bun.http.Method,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            switch (method_) {
                .GET => app.get(pattern, UserDataType, user_data, handler),
                .POST => app.post(pattern, UserDataType, user_data, handler),
                .PUT => app.put(pattern, UserDataType, user_data, handler),
                .DELETE => app.delete(pattern, UserDataType, user_data, handler),
                .PATCH => app.patch(pattern, UserDataType, user_data, handler),
                .OPTIONS => app.options(pattern, UserDataType, user_data, handler),
                .HEAD => app.head(pattern, UserDataType, user_data, handler),
                .CONNECT => app.connect(pattern, UserDataType, user_data, handler),
                .TRACE => app.trace(pattern, UserDataType, user_data, handler),
                else => {},
            }
        }
        pub fn any(
            app: *ThisApp,
            pattern: []const u8,
            comptime UserDataType: type,
            user_data: UserDataType,
            comptime handler: (fn (UserDataType, *Request, *Response) void),
        ) void {
            c.uws_app_any(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern.ptr, pattern.len, RouteHandler(UserDataType, handler).handle, if (UserDataType == void) null else user_data);
        }
        pub fn domain(app: *ThisApp, pattern: [:0]const u8) void {
            c.uws_app_domain(ssl_flag, @as(*uws_app_t, @ptrCast(app)), pattern);
        }
        pub fn run(app: *ThisApp) void {
            return c.uws_app_run(ssl_flag, @as(*uws_app_t, @ptrCast(app)));
        }
        pub fn listen(
            app: *ThisApp,
            port: i32,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ThisApp.ListenSocket, c.uws_app_listen_config_t) void,
        ) void {
            const Wrapper = struct {
                pub fn handle(socket: ?*uws.ListenSocket, conf: c.uws_app_listen_config_t, data: ?*anyopaque) callconv(.c) void {
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
            return c.uws_app_listen(ssl_flag, @as(*uws_app_t, @ptrCast(app)), port, Wrapper.handle, user_data);
        }

        pub fn onClientError(
            app: *ThisApp,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (data: UserData, socket: *us_socket_t, error_code: u8, rawPacket: []const u8) void,
        ) void {
            const Wrapper = struct {
                pub fn handle(data: *anyopaque, _: c_int, socket: *us_socket_t, error_code: u8, raw_packet: ?[*]u8, raw_packet_length: c_int) callconv(.c) void {
                    @call(bun.callmod_inline, handler, .{
                        @as(UserData, @ptrCast(@alignCast(data))),
                        socket,
                        error_code,
                        if (raw_packet) |bytes| bytes[0..(@max(raw_packet_length, 0))] else "",
                    });
                }
            };
            return c.uws_app_set_on_clienterror(ssl_flag, @ptrCast(app), Wrapper.handle, @ptrCast(user_data));
        }

        pub fn listenWithConfig(
            app: *ThisApp,
            comptime UserData: type,
            user_data: UserData,
            comptime handler: fn (UserData, ?*ThisApp.ListenSocket) void,
            config: c.uws_app_listen_config_t,
        ) void {
            const Wrapper = struct {
                pub fn handle(socket: ?*uws.ListenSocket, data: ?*anyopaque) callconv(.c) void {
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
            return c.uws_app_listen_with_config(ssl_flag, @as(*uws_app_t, @ptrCast(app)), config.host, @as(u16, @intCast(config.port)), config.options, Wrapper.handle, user_data);
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
                pub fn handle(socket: ?*uws.ListenSocket, _: [*:0]const u8, _: i32, data: *anyopaque) callconv(.c) void {
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
            return c.uws_app_listen_domain_with_options(
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
            return c.uws_constructor_failed(ssl_flag, app);
        }
        pub fn numSubscribers(app: *ThisApp, topic: []const u8) u32 {
            return c.uws_num_subscribers(ssl_flag, @as(*uws_app_t, @ptrCast(app)), topic.ptr, topic.len);
        }
        pub fn publish(app: *ThisApp, topic: []const u8, message: []const u8, opcode: Opcode, compress: bool) bool {
            return c.uws_publish(ssl_flag, @as(*uws_app_t, @ptrCast(app)), topic.ptr, topic.len, message.ptr, message.len, opcode, compress);
        }
        pub fn getNativeHandle(app: *ThisApp) ?*anyopaque {
            return c.uws_get_native_handle(ssl_flag, app);
        }
        pub fn removeServerName(app: *ThisApp, hostname_pattern: [*:0]const u8) void {
            return c.uws_remove_server_name(ssl_flag, @as(*uws_app_t, @ptrCast(app)), hostname_pattern);
        }
        pub fn addServerName(app: *ThisApp, hostname_pattern: [*:0]const u8) void {
            return c.uws_add_server_name(ssl_flag, @as(*uws_app_t, @ptrCast(app)), hostname_pattern);
        }
        pub fn addServerNameWithOptions(app: *ThisApp, hostname_pattern: [*:0]const u8, opts: BunSocketContextOptions) !void {
            if (c.uws_add_server_name_with_options(ssl_flag, @as(*uws_app_t, @ptrCast(app)), hostname_pattern, opts) != 0) {
                return error.FailedToAddServerName;
            }
        }
        pub fn missingServerName(app: *ThisApp, handler: c.uws_missing_server_handler, user_data: ?*anyopaque) void {
            return c.uws_missing_server_name(ssl_flag, @as(*uws_app_t, @ptrCast(app)), handler, user_data);
        }
        pub fn filter(app: *ThisApp, handler: c.uws_filter_handler, user_data: ?*anyopaque) void {
            return c.uws_filter(ssl_flag, @as(*uws_app_t, @ptrCast(app)), handler, user_data);
        }
        pub fn ws(app: *ThisApp, pattern: []const u8, ctx: *anyopaque, id: usize, behavior_: WebSocketBehavior) void {
            var behavior = behavior_;
            uws_ws(ssl_flag, @as(*uws_app_t, @ptrCast(app)), ctx, pattern.ptr, pattern.len, id, &behavior);
        }

        /// HTTP response object for handling HTTP responses.
        ///
        /// This wraps the uWS HttpResponse template class from HttpResponse.h, providing
        /// methods for writing response data, setting headers, handling timeouts, and
        /// managing the response lifecycle. The response object supports both regular
        /// HTTP responses and chunked transfer encoding, and can handle large data
        /// writes by automatically splitting them into appropriately sized chunks.
        ///
        /// Key features:
        /// - Write response data with automatic chunking for large payloads
        /// - Set HTTP status codes and headers
        /// - Handle response timeouts and aborted requests
        /// - Support for WebSocket upgrades
        /// - Cork/uncork functionality for efficient batched writes
        /// - Automatic handling of Connection: close semantics
        pub const Response = @import("./Response.zig").NewResponse(ssl_flag);
        pub const WebSocket = @import("./WebSocket.zig").NewWebSocket(ssl_flag);
        const uws_ws = @import("./WebSocket.zig").c.uws_ws;
    };
}

pub const uws_app_s = opaque {};
pub const uws_app_t = uws_app_s;

pub const c = struct {
    pub const uws_listen_handler = ?*const fn (?*uws.ListenSocket, ?*anyopaque) callconv(.c) void;
    pub const uws_method_handler = ?*const fn (*uws.uws_res, *Request, ?*anyopaque) callconv(.c) void;
    pub const uws_filter_handler = ?*const fn (*uws.uws_res, i32, ?*anyopaque) callconv(.c) void;
    pub const uws_missing_server_handler = ?*const fn ([*c]const u8, ?*anyopaque) callconv(.c) void;

    pub extern fn uws_app_close(ssl: i32, app: *uws_app_s) void;
    pub extern fn uws_app_close_idle(ssl: i32, app: *uws_app_s) void;
    pub extern fn uws_app_set_on_clienterror(ssl: c_int, app: *uws_app_s, handler: *const fn (*anyopaque, c_int, *us_socket_t, u8, ?[*]u8, c_int) callconv(.c) void, user_data: *anyopaque) void;
    pub extern fn uws_create_app(ssl: i32, options: BunSocketContextOptions) ?*uws_app_t;
    pub extern fn uws_app_destroy(ssl: i32, app: *uws_app_t) void;
    pub extern fn uws_app_set_flags(ssl: i32, app: *uws_app_t, require_host_header: bool, use_strict_method_validation: bool) void;
    pub extern fn uws_app_set_max_http_header_size(ssl: i32, app: *uws_app_t, max_header_size: u64) void;
    pub extern fn uws_app_get(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_post(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_options(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_delete(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_patch(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_put(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_head(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_connect(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_trace(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_any(ssl: i32, app: *uws_app_t, pattern: [*]const u8, pattern_len: usize, handler: uws_method_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_run(ssl: i32, *uws_app_t) void;
    pub extern fn uws_app_domain(ssl: i32, app: *uws_app_t, domain: [*c]const u8) void;
    pub extern fn uws_app_listen(ssl: i32, app: *uws_app_t, port: i32, handler: uws_listen_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_app_listen_with_config(
        ssl: i32,
        app: *uws_app_t,
        host: [*c]const u8,
        port: u16,
        options: i32,
        handler: uws_listen_handler,
        user_data: ?*anyopaque,
    ) void;
    pub extern fn uws_constructor_failed(ssl: i32, app: *uws_app_t) bool;
    pub extern fn uws_num_subscribers(ssl: i32, app: *uws_app_t, topic: [*c]const u8, topic_length: usize) c_uint;
    pub extern fn uws_publish(ssl: i32, app: *uws_app_t, topic: [*c]const u8, topic_length: usize, message: [*c]const u8, message_length: usize, opcode: Opcode, compress: bool) bool;
    pub extern fn uws_get_native_handle(ssl: i32, app: *anyopaque) ?*anyopaque;
    pub extern fn uws_remove_server_name(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
    pub extern fn uws_add_server_name(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8) void;
    pub extern fn uws_add_server_name_with_options(ssl: i32, app: *uws_app_t, hostname_pattern: [*c]const u8, options: BunSocketContextOptions) i32;
    pub extern fn uws_missing_server_name(ssl: i32, app: *uws_app_t, handler: uws_missing_server_handler, user_data: ?*anyopaque) void;
    pub extern fn uws_filter(ssl: i32, app: *uws_app_t, handler: uws_filter_handler, user_data: ?*anyopaque) void;

    pub const uws_app_listen_config_t = extern struct {
        port: c_int,
        host: ?[*:0]const u8 = null,
        options: c_int = 0,
    };

    pub extern fn uws_app_listen_domain_with_options(
        ssl_flag: c_int,
        app: *uws_app_t,
        domain: [*:0]const u8,
        pathlen: usize,
        i32,
        *const (fn (*ListenSocket, domain: [*:0]const u8, i32, *anyopaque) callconv(.c) void),
        ?*anyopaque,
    ) void;

    pub extern fn uws_app_clear_routes(ssl_flag: c_int, app: *uws_app_t) void;
};

const bun = @import("bun");

const uws = bun.uws;
const ListenSocket = bun.uws.ListenSocket;
const Opcode = bun.uws.Opcode;
const Request = bun.uws.Request;
const WebSocketBehavior = bun.uws.WebSocketBehavior;
const us_socket_t = bun.uws.us_socket_t;
const BunSocketContextOptions = bun.uws.SocketContext.BunSocketContextOptions;
