/// Zig wrapper around uws::Response<bool isSSL> from µWebSockets.
///
/// This provides a type-safe Zig interface to the underlying C++ uws::Response template.
/// The `ssl_flag` parameter determines whether this wraps uws::Response<true> (SSL/TLS)
/// or uws::Response<false> (plain HTTP).
///
/// The wrapper:
/// - Uses opaque types to hide the C++ implementation details
/// - Provides compile-time SSL/TLS specialization via the ssl_flag parameter
/// - Offers safe casting between Zig and C representations
/// - Maintains zero-cost abstractions over the underlying µWebSockets API
pub fn NewResponse(ssl_flag: i32) type {
    return opaque {
        const Response = NewResponse(ssl_flag);
        const ssl = ssl_flag == 1;

        pub inline fn castRes(res: *c.uws_res) *Response {
            return @as(*Response, @ptrCast(@alignCast(res)));
        }

        pub inline fn downcast(res: *Response) *c.uws_res {
            return @as(*c.uws_res, @ptrCast(@alignCast(res)));
        }

        pub inline fn downcastSocket(res: *Response) *bun.uws.us_socket_t {
            return @as(*bun.uws.us_socket_t, @ptrCast(@alignCast(res)));
        }

        pub fn end(res: *Response, data: []const u8, close_connection: bool) void {
            c.uws_res_end(ssl_flag, res.downcast(), data.ptr, data.len, close_connection);
        }

        pub fn tryEnd(res: *Response, data: []const u8, total: usize, close_: bool) bool {
            return c.uws_res_try_end(ssl_flag, res.downcast(), data.ptr, data.len, total, close_);
        }

        pub fn flushHeaders(res: *Response) void {
            c.uws_res_flush_headers(ssl_flag, res.downcast());
        }

        pub fn state(res: *const Response) State {
            return c.uws_res_state(ssl_flag, @as(*const c.uws_res, @ptrCast(@alignCast(res))));
        }

        pub fn shouldCloseConnection(this: *const Response) bool {
            return this.state().isHttpConnectionClose();
        }

        pub fn prepareForSendfile(res: *Response) void {
            c.uws_res_prepare_for_sendfile(ssl_flag, res.downcast());
        }

        pub fn uncork(_: *Response) void {
            // c.uws_res_uncork(
            //     ssl_flag,
            //     res.downcast(),
            // );
        }
        pub fn pause(res: *Response) void {
            c.uws_res_pause(ssl_flag, res.downcast());
        }
        pub fn @"resume"(res: *Response) void {
            c.uws_res_resume(ssl_flag, res.downcast());
        }
        pub fn writeContinue(res: *Response) void {
            c.uws_res_write_continue(ssl_flag, res.downcast());
        }
        pub fn writeStatus(res: *Response, status: []const u8) void {
            c.uws_res_write_status(ssl_flag, res.downcast(), status.ptr, status.len);
        }
        pub fn writeHeader(res: *Response, key: []const u8, value: []const u8) void {
            c.uws_res_write_header(ssl_flag, res.downcast(), key.ptr, key.len, value.ptr, value.len);
        }
        pub fn writeHeaderInt(res: *Response, key: []const u8, value: u64) void {
            c.uws_res_write_header_int(ssl_flag, res.downcast(), key.ptr, key.len, value);
        }
        pub fn endWithoutBody(res: *Response, close_connection: bool) void {
            c.uws_res_end_without_body(ssl_flag, res.downcast(), close_connection);
        }
        pub fn endSendFile(res: *Response, write_offset: u64, close_connection: bool) void {
            c.uws_res_end_sendfile(ssl_flag, res.downcast(), write_offset, close_connection);
        }
        pub fn timeout(res: *Response, seconds: u8) void {
            c.uws_res_timeout(ssl_flag, res.downcast(), seconds);
        }
        pub fn resetTimeout(res: *Response) void {
            c.uws_res_reset_timeout(ssl_flag, res.downcast());
        }
        pub fn getBufferedAmount(res: *Response) u64 {
            return c.uws_res_get_buffered_amount(ssl_flag, res.downcast());
        }
        pub fn write(res: *Response, data: []const u8) WriteResult {
            var len: usize = data.len;
            return switch (c.uws_res_write(ssl_flag, res.downcast(), data.ptr, &len)) {
                true => .{ .want_more = len },
                false => .{ .backpressure = len },
            };
        }
        pub fn getWriteOffset(res: *Response) u64 {
            return c.uws_res_get_write_offset(ssl_flag, res.downcast());
        }
        pub fn overrideWriteOffset(res: *Response, offset: anytype) void {
            c.uws_res_override_write_offset(ssl_flag, res.downcast(), @as(u64, @intCast(offset)));
        }
        pub fn hasResponded(res: *Response) bool {
            return c.uws_res_has_responded(ssl_flag, res.downcast());
        }

        pub fn markWroteContentLengthHeader(res: *Response) void {
            c.uws_res_mark_wrote_content_length_header(ssl_flag, res.downcast());
        }

        pub fn writeMark(res: *Response) void {
            c.uws_res_write_mark(ssl_flag, res.downcast());
        }

        pub fn getNativeHandle(res: *Response) bun.FileDescriptor {
            if (comptime Environment.isWindows) {
                // on windows uSockets exposes SOCKET
                return .fromNative(@ptrCast(c.uws_res_get_native_handle(ssl_flag, res.downcast())));
            }

            return .fromNative(@intCast(@intFromPtr(c.uws_res_get_native_handle(ssl_flag, res.downcast()))));
        }
        pub fn getRemoteAddressAsText(res: *Response) ?[]const u8 {
            var buf: [*]const u8 = undefined;
            const size = c.uws_res_get_remote_address_as_text(ssl_flag, res.downcast(), &buf);
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
            address.ip.len = c.uws_res_get_remote_address_info(
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
                pub fn handle(this: *c.uws_res, amount: u64, data: ?*anyopaque) callconv(.C) bool {
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
            c.uws_res_on_writable(ssl_flag, res.downcast(), Wrapper.handle, user_data);
        }

        pub fn clearOnWritable(res: *Response) void {
            c.uws_res_clear_on_writable(ssl_flag, res.downcast());
        }
        pub inline fn markNeedsMore(res: *Response) void {
            if (!ssl) {
                c.us_socket_mark_needs_more_not_ssl(res.downcast());
            }
        }
        pub fn onAborted(res: *Response, comptime UserDataType: type, comptime handler: fn (UserDataType, *Response) void, optional_data: UserDataType) void {
            const Wrapper = struct {
                pub fn handle(this: *c.uws_res, user_data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserDataType == void) {
                        @call(bun.callmod_inline, handler, .{ {}, castRes(this), {} });
                    } else {
                        @call(bun.callmod_inline, handler, .{ @as(UserDataType, @ptrCast(@alignCast(user_data.?))), castRes(this) });
                    }
                }
            };
            c.uws_res_on_aborted(ssl_flag, res.downcast(), Wrapper.handle, optional_data);
        }

        pub fn clearAborted(res: *Response) void {
            c.uws_res_on_aborted(ssl_flag, res.downcast(), null, null);
        }
        pub fn onTimeout(res: *Response, comptime UserDataType: type, comptime handler: fn (UserDataType, *Response) void, optional_data: UserDataType) void {
            const Wrapper = struct {
                pub fn handle(this: *c.uws_res, user_data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserDataType == void) {
                        @call(bun.callmod_inline, handler, .{ {}, castRes(this) });
                    } else {
                        @call(bun.callmod_inline, handler, .{ @as(UserDataType, @ptrCast(@alignCast(user_data.?))), castRes(this) });
                    }
                }
            };
            c.uws_res_on_timeout(ssl_flag, res.downcast(), Wrapper.handle, optional_data);
        }

        pub fn clearTimeout(res: *Response) void {
            c.uws_res_on_timeout(ssl_flag, res.downcast(), null, null);
        }
        pub fn clearOnData(res: *Response) void {
            c.uws_res_on_data(ssl_flag, res.downcast(), null, null);
        }

        pub fn onData(
            res: *Response,
            comptime UserDataType: type,
            comptime handler: fn (UserDataType, *Response, chunk: []const u8, last: bool) void,
            optional_data: UserDataType,
        ) void {
            const Wrapper = struct {
                const handler_fn = handler;
                pub fn handle(this: *c.uws_res, chunk_ptr: [*c]const u8, len: usize, last: bool, user_data: ?*anyopaque) callconv(.C) void {
                    if (comptime UserDataType == void) {
                        @call(bun.callmod_inline, handler_fn, .{
                            {},
                            castRes(this),
                            if (len > 0) chunk_ptr[0..len] else "",
                            last,
                        });
                    } else {
                        @call(bun.callmod_inline, handler_fn, .{
                            @as(UserDataType, @ptrCast(@alignCast(user_data.?))),
                            castRes(this),
                            if (len > 0) chunk_ptr[0..len] else "",
                            last,
                        });
                    }
                }
            };

            c.uws_res_on_data(ssl_flag, res.downcast(), Wrapper.handle, optional_data);
        }

        pub fn endStream(res: *Response, close_connection: bool) void {
            c.uws_res_end_stream(ssl_flag, res.downcast(), close_connection);
        }

        pub fn corked(
            res: *Response,
            comptime handler: anytype,
            args_tuple: std.meta.ArgsTuple(@TypeOf(handler)),
        ) void {
            const Wrapper = struct {
                const handler_fn = handler;
                const Args = *@TypeOf(args_tuple);
                pub fn handle(user_data: ?*anyopaque) callconv(.C) void {
                    const args: Args = @alignCast(@ptrCast(user_data.?));
                    @call(.always_inline, handler_fn, args.*);
                }
            };

            c.uws_res_cork(ssl_flag, res.downcast(), @constCast(@ptrCast(&args_tuple)), Wrapper.handle);
        }

        pub fn runCorkedWithType(
            res: *Response,
            comptime UserDataType: type,
            comptime handler: fn (UserDataType) void,
            optional_data: UserDataType,
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

            c.uws_res_cork(ssl_flag, res.downcast(), optional_data, Wrapper.handle);
        }

        pub fn upgrade(
            res: *Response,
            comptime Data: type,
            data: Data,
            sec_web_socket_key: []const u8,
            sec_web_socket_protocol: []const u8,
            sec_web_socket_extensions: []const u8,
            ctx: ?*uws.SocketContext,
        ) *Socket {
            return c.uws_res_upgrade(
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
}

pub const TCPResponse = NewResponse(0);
pub const TLSResponse = NewResponse(1);

pub const AnyResponse = union(enum) {
    SSL: *uws.NewApp(true).Response,
    TCP: *uws.NewApp(false).Response,

    pub fn markNeedsMore(this: AnyResponse) void {
        return switch (this) {
            inline else => |resp| resp.markNeedsMore(),
        };
    }

    pub fn markWroteContentLengthHeader(this: AnyResponse) void {
        return switch (this) {
            inline else => |resp| resp.markWroteContentLengthHeader(),
        };
    }

    pub fn writeMark(this: AnyResponse) void {
        return switch (this) {
            inline else => |resp| resp.writeMark(),
        };
    }

    pub fn endSendFile(this: AnyResponse, write_offset: u64, close_connection: bool) void {
        return switch (this) {
            inline else => |resp| resp.endSendFile(write_offset, close_connection),
        };
    }

    pub fn socket(this: AnyResponse) *c.uws_res {
        return switch (this) {
            inline else => |resp| resp.downcast(),
        };
    }
    pub fn getRemoteSocketInfo(this: AnyResponse) ?SocketAddress {
        return switch (this) {
            inline else => |resp| resp.getRemoteSocketInfo(),
        };
    }
    pub fn flushHeaders(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.flushHeaders(),
        }
    }
    pub fn getWriteOffset(this: AnyResponse) u64 {
        return switch (this) {
            inline else => |resp| resp.getWriteOffset(),
        };
    }

    pub fn getBufferedAmount(this: AnyResponse) u64 {
        return switch (this) {
            inline else => |resp| resp.getBufferedAmount(),
        };
    }

    pub fn writeContinue(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.writeContinue(),
        }
    }

    pub fn state(this: AnyResponse) State {
        return switch (this) {
            inline else => |resp| resp.state(),
        };
    }

    pub inline fn init(response: anytype) AnyResponse {
        return switch (@TypeOf(response)) {
            *uws.NewApp(true).Response => .{ .SSL = response },
            *uws.NewApp(false).Response => .{ .TCP = response },
            else => @compileError(unreachable),
        };
    }

    pub fn timeout(this: AnyResponse, seconds: u8) void {
        switch (this) {
            inline else => |resp| resp.timeout(seconds),
        }
    }

    pub fn onData(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType, []const u8, bool) void, optional_data: UserDataType) void {
        switch (this) {
            inline .SSL, .TCP => |resp, ssl| resp.onData(UserDataType, struct {
                pub fn onDataCallback(user_data: UserDataType, _: *uws.NewApp(ssl == .SSL).Response, data: []const u8, last: bool) void {
                    @call(.always_inline, handler, .{ user_data, data, last });
                }
            }.onDataCallback, optional_data),
        }
    }

    pub fn writeStatus(this: AnyResponse, status: []const u8) void {
        switch (this) {
            inline else => |resp| resp.writeStatus(status),
        }
    }

    pub fn writeHeader(this: AnyResponse, key: []const u8, value: []const u8) void {
        switch (this) {
            inline else => |resp| resp.writeHeader(key, value),
        }
    }

    pub fn write(this: AnyResponse, data: []const u8) WriteResult {
        return switch (this) {
            inline else => |resp| resp.write(data),
        };
    }

    pub fn end(this: AnyResponse, data: []const u8, close_connection: bool) void {
        switch (this) {
            inline else => |resp| resp.end(data, close_connection),
        }
    }

    pub fn shouldCloseConnection(this: AnyResponse) bool {
        return switch (this) {
            inline else => |resp| resp.shouldCloseConnection(),
        };
    }

    pub fn tryEnd(this: AnyResponse, data: []const u8, total_size: usize, close_connection: bool) bool {
        return switch (this) {
            inline else => |resp| resp.tryEnd(data, total_size, close_connection),
        };
    }

    pub fn pause(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.pause(),
        }
    }

    pub fn @"resume"(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.@"resume"(),
        }
    }

    pub fn writeHeaderInt(this: AnyResponse, key: []const u8, value: u64) void {
        switch (this) {
            inline else => |resp| resp.writeHeaderInt(key, value),
        }
    }

    pub fn endWithoutBody(this: AnyResponse, close_connection: bool) void {
        switch (this) {
            inline else => |resp| resp.endWithoutBody(close_connection),
        }
    }

    pub fn forceClose(this: AnyResponse) void {
        switch (this) {
            .SSL => |resp| resp.downcastSocket().close(true, .failure),
            .TCP => |resp| resp.downcastSocket().close(false, .failure),
        }
    }

    pub fn onWritable(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType, u64, AnyResponse) bool, optional_data: UserDataType) void {
        const wrapper = struct {
            pub fn ssl_handler(user_data: UserDataType, offset: u64, resp: *uws.NewApp(true).Response) bool {
                return handler(user_data, offset, .{ .SSL = resp });
            }

            pub fn tcp_handler(user_data: UserDataType, offset: u64, resp: *uws.NewApp(false).Response) bool {
                return handler(user_data, offset, .{ .TCP = resp });
            }
        };
        switch (this) {
            .SSL => |resp| resp.onWritable(UserDataType, wrapper.ssl_handler, optional_data),
            .TCP => |resp| resp.onWritable(UserDataType, wrapper.tcp_handler, optional_data),
        }
    }

    pub fn onTimeout(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType, AnyResponse) void, optional_data: UserDataType) void {
        const wrapper = struct {
            pub fn ssl_handler(user_data: UserDataType, resp: *uws.NewApp(true).Response) void {
                handler(user_data, .{ .SSL = resp });
            }
            pub fn tcp_handler(user_data: UserDataType, resp: *uws.NewApp(false).Response) void {
                handler(user_data, .{ .TCP = resp });
            }
        };

        switch (this) {
            .SSL => |resp| resp.onTimeout(UserDataType, wrapper.ssl_handler, optional_data),
            .TCP => |resp| resp.onTimeout(UserDataType, wrapper.tcp_handler, optional_data),
        }
    }

    pub fn onAborted(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType, AnyResponse) void, optional_data: UserDataType) void {
        const wrapper = struct {
            pub fn ssl_handler(user_data: UserDataType, resp: *uws.NewApp(true).Response) void {
                handler(user_data, .{ .SSL = resp });
            }
            pub fn tcp_handler(user_data: UserDataType, resp: *uws.NewApp(false).Response) void {
                handler(user_data, .{ .TCP = resp });
            }
        };
        switch (this) {
            .SSL => |resp| resp.onAborted(UserDataType, wrapper.ssl_handler, optional_data),
            .TCP => |resp| resp.onAborted(UserDataType, wrapper.tcp_handler, optional_data),
        }
    }

    pub fn clearAborted(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.clearAborted(),
        }
    }
    pub fn clearTimeout(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.clearTimeout(),
        }
    }

    pub fn clearOnWritable(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.clearOnWritable(),
        }
    }

    pub fn clearOnData(this: AnyResponse) void {
        switch (this) {
            inline else => |resp| resp.clearOnData(),
        }
    }

    pub fn endStream(this: AnyResponse, close_connection: bool) void {
        switch (this) {
            inline else => |resp| resp.endStream(close_connection),
        }
    }

    pub fn corked(this: AnyResponse, comptime handler: anytype, args_tuple: std.meta.ArgsTuple(@TypeOf(handler))) void {
        switch (this) {
            inline else => |resp| resp.corked(handler, args_tuple),
        }
    }

    pub fn runCorkedWithType(this: AnyResponse, comptime UserDataType: type, comptime handler: fn (UserDataType) void, optional_data: UserDataType) void {
        switch (this) {
            inline else => |resp| resp.runCorkedWithType(UserDataType, handler, optional_data),
        }
    }

    pub fn upgrade(
        this: AnyResponse,
        comptime Data: type,
        data: Data,
        sec_web_socket_key: []const u8,
        sec_web_socket_protocol: []const u8,
        sec_web_socket_extensions: []const u8,
        ctx: ?*uws.SocketContext,
    ) *Socket {
        return switch (this) {
            inline else => |resp| resp.upgrade(Data, data, sec_web_socket_key, sec_web_socket_protocol, sec_web_socket_extensions, ctx),
        };
    }
};

pub const State = enum(u8) {
    HTTP_STATUS_CALLED = 1,
    HTTP_WRITE_CALLED = 2,
    HTTP_END_CALLED = 4,
    HTTP_RESPONSE_PENDING = 8,
    HTTP_CONNECTION_CLOSE = 16,
    HTTP_WROTE_CONTENT_LENGTH_HEADER = 32,

    _,

    pub inline fn isResponsePending(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_RESPONSE_PENDING) != 0;
    }

    pub inline fn hasWrittenContentLengthHeader(this: State) bool {
        return @intFromEnum(this) & @intFromEnum(State.HTTP_WROTE_CONTENT_LENGTH_HEADER) != 0;
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

pub const WriteResult = union(enum) {
    want_more: usize,
    backpressure: usize,
};

pub const uws_res = c.uws_res;

const c = struct {
    pub const uws_res = opaque {};
    pub extern fn uws_res_mark_wrote_content_length_header(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_write_mark(ssl: i32, res: *c.uws_res) void;
    pub extern fn us_socket_mark_needs_more_not_ssl(socket: ?*c.uws_res) void;
    pub extern fn uws_res_state(ssl: c_int, res: *const c.uws_res) State;
    pub extern fn uws_res_get_remote_address_info(res: *c.uws_res, dest: *[*]const u8, port: *i32, is_ipv6: *bool) usize;
    pub extern fn uws_res_uncork(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_end(ssl: i32, res: *c.uws_res, data: [*c]const u8, length: usize, close_connection: bool) void;
    pub extern fn uws_res_flush_headers(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_pause(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_resume(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_write_continue(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_write_status(ssl: i32, res: *c.uws_res, status: [*c]const u8, length: usize) void;
    pub extern fn uws_res_write_header(ssl: i32, res: *c.uws_res, key: [*c]const u8, key_length: usize, value: [*c]const u8, value_length: usize) void;
    pub extern fn uws_res_write_header_int(ssl: i32, res: *c.uws_res, key: [*c]const u8, key_length: usize, value: u64) void;
    pub extern fn uws_res_end_without_body(ssl: i32, res: *c.uws_res, close_connection: bool) void;
    pub extern fn uws_res_end_sendfile(ssl: i32, res: *c.uws_res, write_offset: u64, close_connection: bool) void;
    pub extern fn uws_res_timeout(ssl: i32, res: *c.uws_res, timeout: u8) void;
    pub extern fn uws_res_reset_timeout(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_get_buffered_amount(ssl: i32, res: *c.uws_res) u64;
    pub extern fn uws_res_write(ssl: i32, res: *c.uws_res, data: ?[*]const u8, length: *usize) bool;
    pub extern fn uws_res_get_write_offset(ssl: i32, res: *c.uws_res) u64;
    pub extern fn uws_res_override_write_offset(ssl: i32, res: *c.uws_res, u64) void;
    pub extern fn uws_res_has_responded(ssl: i32, res: *c.uws_res) bool;
    pub extern fn uws_res_on_writable(ssl: i32, res: *c.uws_res, handler: ?*const fn (*c.uws_res, u64, ?*anyopaque) callconv(.C) bool, user_data: ?*anyopaque) void;
    pub extern fn uws_res_clear_on_writable(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_on_aborted(ssl: i32, res: *c.uws_res, handler: ?*const fn (*c.uws_res, ?*anyopaque) callconv(.C) void, optional_data: ?*anyopaque) void;
    pub extern fn uws_res_on_timeout(ssl: i32, res: *c.uws_res, handler: ?*const fn (*c.uws_res, ?*anyopaque) callconv(.C) void, optional_data: ?*anyopaque) void;
    pub extern fn uws_res_try_end(
        ssl: i32,
        res: *c.uws_res,
        data: ?[*]const u8,
        length: usize,
        total: usize,
        close: bool,
    ) bool;
    pub extern fn uws_res_end_stream(ssl: i32, res: *c.uws_res, close_connection: bool) void;
    pub extern fn uws_res_prepare_for_sendfile(ssl: i32, res: *c.uws_res) void;
    pub extern fn uws_res_get_native_handle(ssl: i32, res: *c.uws_res) *Socket;
    pub extern fn uws_res_get_remote_address_as_text(ssl: i32, res: *c.uws_res, dest: *[*]const u8) usize;

    pub extern fn uws_res_on_data(
        ssl: i32,
        res: *c.uws_res,
        handler: ?*const fn (*c.uws_res, [*c]const u8, usize, bool, ?*anyopaque) callconv(.C) void,
        optional_data: ?*anyopaque,
    ) void;
    pub extern fn uws_res_upgrade(
        ssl: i32,
        res: *c.uws_res,
        data: ?*anyopaque,
        sec_web_socket_key: [*c]const u8,
        sec_web_socket_key_length: usize,
        sec_web_socket_protocol: [*c]const u8,
        sec_web_socket_protocol_length: usize,
        sec_web_socket_extensions: [*c]const u8,
        sec_web_socket_extensions_length: usize,
        ws: ?*uws.SocketContext,
    ) *Socket;
    pub extern fn uws_res_cork(i32, res: *c.uws_res, ctx: *anyopaque, corker: *const (fn (?*anyopaque) callconv(.C) void)) void;
};

const std = @import("std");
const bun = @import("bun");
const uws = bun.uws;
const Socket = uws.Socket;
const SocketContext = uws.SocketContext;
const Environment = bun.Environment;

const SocketAddress = uws.SocketAddress;
