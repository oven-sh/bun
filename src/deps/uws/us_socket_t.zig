const std = @import("std");
const bun = @import("bun");
const uws = @import("../uws.zig");

const SocketContext = uws.SocketContext;

const debug = bun.Output.scoped(.uws, false);
const max_i32 = std.math.maxInt(i32);

/// Zig bindings for `us_socket_t`
///
/// This is lower-level, you generally want to use uws.SocketTCP or
/// uws.SocketTLS instead so that you can support named pipes, upgraded duplexes,
/// asynchronous DNS, etc.
pub const us_socket_t = opaque {
    pub const CloseCode = enum(i32) {
        normal = 0,
        failure = 1,
    };

    pub fn open(this: *us_socket_t, comptime is_ssl: bool, is_client: bool, ip_addr: ?[]const u8) void {
        debug("us_socket_open({d}, is_client: {})", .{ @intFromPtr(this), is_client });
        const ssl = @intFromBool(is_ssl);

        if (ip_addr) |ip| {
            bun.assert(ip.len < max_i32);
            _ = c.us_socket_open(ssl, this, @intFromBool(is_client), ip.ptr, @intCast(ip.len));
        } else {
            _ = c.us_socket_open(ssl, this, @intFromBool(is_client), null, 0);
        }
    }

    pub fn pause(this: *us_socket_t, ssl: bool) void {
        debug("us_socket_pause({d})", .{@intFromPtr(this)});
        c.us_socket_pause(@intFromBool(ssl), this);
    }

    pub fn @"resume"(this: *us_socket_t, ssl: bool) void {
        debug("us_socket_resume({d})", .{@intFromPtr(this)});
        c.us_socket_resume(@intFromBool(ssl), this);
    }

    pub fn close(this: *us_socket_t, ssl: bool, code: CloseCode) void {
        debug("us_socket_close({d}, {s})", .{ @intFromPtr(this), @tagName(code) });
        _ = c.us_socket_close(@intFromBool(ssl), this, code, null);
    }

    pub fn shutdown(this: *us_socket_t, ssl: bool) void {
        debug("us_socket_shutdown({d})", .{@intFromPtr(this)});
        c.us_socket_shutdown(@intFromBool(ssl), this);
    }

    pub fn shutdownRead(this: *us_socket_t, ssl: bool) void {
        c.us_socket_shutdown_read(@intFromBool(ssl), this);
    }

    pub fn isClosed(this: *us_socket_t, ssl: bool) bool {
        return c.us_socket_is_closed(@intFromBool(ssl), this) > 0;
    }

    pub fn isShutdown(this: *us_socket_t, ssl: bool) bool {
        return c.us_socket_is_shut_down(@intFromBool(ssl), this) > 0;
    }

    pub fn localPort(this: *us_socket_t, ssl: bool) i32 {
        return c.us_socket_local_port(@intFromBool(ssl), this);
    }

    pub fn remotePort(this: *us_socket_t, ssl: bool) i32 {
        return c.us_socket_remote_port(@intFromBool(ssl), this);
    }

    /// Returned slice is a view into `buf`.
    pub fn localAddress(this: *us_socket_t, ssl: bool, buf: []u8) ![]const u8 {
        var length: i32 = @intCast(buf.len);

        c.us_socket_local_address(@intFromBool(ssl), this, buf.ptr, &length);
        if (length < 0) {
            const errno = bun.sys.getErrno(length);
            bun.debugAssert(errno != .SUCCESS);
            return bun.errnoToZigErr(errno);
        }
        bun.unsafeAssert(buf.len >= length);

        return buf[0..@intCast(length)];
    }

    /// Returned slice is a view into `buf`. On error, `errno` should be set
    pub fn remoteAddress(this: *us_socket_t, ssl: bool, buf: []u8) ![]const u8 {
        var length: i32 = @intCast(buf.len);

        c.us_socket_remote_address(@intFromBool(ssl), this, buf.ptr, &length);
        if (length < 0) {
            const errno = bun.sys.getErrno(length);
            bun.debugAssert(errno != .SUCCESS);
            return bun.errnoToZigErr(errno);
        }
        bun.unsafeAssert(buf.len >= length);

        return buf[0..@intCast(length)];
    }

    pub fn setTimeout(this: *us_socket_t, ssl: bool, seconds: u32) void {
        c.us_socket_timeout(@intFromBool(ssl), this, @intCast(seconds));
    }

    pub fn setLongTimeout(this: *us_socket_t, ssl: bool, minutes: u32) void {
        c.us_socket_long_timeout(@intFromBool(ssl), this, @intCast(minutes));
    }

    pub fn setNodelay(this: *us_socket_t, enabled: bool) void {
        c.us_socket_nodelay(this, @intFromBool(enabled));
    }

    /// Returns error code. `0` on success. error codes depend on platform an
    /// configured event loop.
    pub fn setKeepalive(this: *us_socket_t, enabled: bool, delay: u32) i32 {
        return c.us_socket_keepalive(this, @intFromBool(enabled), @intCast(delay));
    }

    pub fn getNativeHandle(this: *us_socket_t, ssl: bool) ?*anyopaque {
        return c.us_socket_get_native_handle(@intFromBool(ssl), this);
    }

    pub fn ext(this: *us_socket_t, ssl: bool) *anyopaque {
        @setRuntimeSafety(true);
        return c.us_socket_ext(@intFromBool(ssl), this).?;
    }

    pub fn context(this: *us_socket_t, ssl: bool) *SocketContext {
        @setRuntimeSafety(true);
        return c.us_socket_context(@intFromBool(ssl), this).?;
    }

    pub fn write(this: *us_socket_t, ssl: bool, data: []const u8, msg_more: bool) i32 {
        const rc = c.us_socket_write(@intFromBool(ssl), this, data.ptr, @intCast(data.len), @intFromBool(msg_more));
        debug("us_socket_write({d}, {d}) = {d}", .{ @intFromPtr(this), data.len, rc });
        return rc;
    }

    pub fn writeFd(this: *us_socket_t, data: []const u8, file_descriptor: bun.FD) i32 {
        if (bun.Environment.isWindows) @compileError("TODO: implement writeFd on Windows");
        const rc = c.us_socket_ipc_write_fd(this, data.ptr, @intCast(data.len), file_descriptor.native());
        debug("us_socket_ipc_write_fd({d}, {d}, {d}) = {d}", .{ @intFromPtr(this), data.len, file_descriptor.native(), rc });
        return rc;
    }

    pub fn write2(this: *us_socket_t, ssl: bool, first: []const u8, second: []const u8) i32 {
        const rc = c.us_socket_write2(@intFromBool(ssl), this, first.ptr, first.len, second.ptr, second.len);
        debug("us_socket_write2({d}, {d}, {d}) = {d}", .{ @intFromPtr(this), first.len, second.len, rc });
        return rc;
    }

    pub fn rawWrite(this: *us_socket_t, ssl: bool, data: []const u8, msg_more: bool) i32 {
        debug("us_socket_raw_write({d}, {d})", .{ @intFromPtr(this), data.len });
        return c.us_socket_raw_write(@intFromBool(ssl), this, data.ptr, @intCast(data.len), @intFromBool(msg_more));
    }

    pub fn flush(this: *us_socket_t, ssl: bool) void {
        c.us_socket_flush(@intFromBool(ssl), this);
    }

    pub fn sendFileNeedsMore(this: *us_socket_t) void {
        c.us_socket_sendfile_needs_more(this);
    }

    pub fn getFd(this: *us_socket_t) bun.FD {
        return .fromNative(c.us_socket_get_fd(this));
    }

    pub fn getVerifyError(this: *us_socket_t, ssl: bool) uws.us_bun_verify_error_t {
        return c.us_socket_verify_error(@intFromBool(ssl), this);
    }

    pub fn upgrade(this: *us_socket_t, new_context: *SocketContext, sni: ?[*:0]const u8) ?*us_socket_t {
        return c.us_socket_upgrade_to_tls(this, new_context, sni);
    }

    pub fn fromFd(ctx: *SocketContext, ext_size: c_int, fd: uws.LIBUS_SOCKET_DESCRIPTOR, is_ipc: c_int) ?*us_socket_t {
        return c.us_socket_from_fd(ctx, ext_size, fd, is_ipc);
    }

    pub fn getError(this: *us_socket_t, ssl: bool) i32 {
        return c.us_socket_get_error(@intFromBool(ssl), this);
    }

    pub fn isEstablished(this: *us_socket_t, ssl: bool) bool {
        return c.us_socket_is_established(@intFromBool(ssl), this) > 0;
    }
};

pub const c = struct {
    pub extern fn us_socket_get_native_handle(ssl: i32, s: ?*us_socket_t) ?*anyopaque;

    pub extern fn us_socket_local_port(ssl: i32, s: ?*us_socket_t) i32;
    pub extern fn us_socket_remote_port(ssl: i32, s: ?*us_socket_t) i32;
    pub extern fn us_socket_remote_address(ssl: i32, s: ?*us_socket_t, buf: [*c]u8, length: [*c]i32) void;
    pub extern fn us_socket_local_address(ssl: i32, s: ?*us_socket_t, buf: [*c]u8, length: [*c]i32) void;
    pub extern fn us_socket_timeout(ssl: i32, s: ?*us_socket_t, seconds: c_uint) void;
    pub extern fn us_socket_long_timeout(ssl: i32, s: ?*us_socket_t, minutes: c_uint) void;
    pub extern fn us_socket_nodelay(s: ?*us_socket_t, enable: c_int) void;
    pub extern fn us_socket_keepalive(s: ?*us_socket_t, enable: c_int, delay: c_uint) c_int;

    pub extern fn us_socket_ext(ssl: i32, s: ?*us_socket_t) ?*anyopaque; // nullish to be safe
    pub extern fn us_socket_context(ssl: i32, s: ?*us_socket_t) ?*SocketContext;

    pub extern fn us_socket_write(ssl: i32, s: ?*us_socket_t, data: [*c]const u8, length: i32, msg_more: i32) i32;
    pub extern fn us_socket_ipc_write_fd(s: ?*us_socket_t, data: [*c]const u8, length: i32, fd: i32) i32;
    pub extern fn us_socket_write2(ssl: i32, *us_socket_t, header: ?[*]const u8, len: usize, payload: ?[*]const u8, usize) i32;
    pub extern fn us_socket_raw_write(ssl: i32, s: ?*us_socket_t, data: [*c]const u8, length: i32, msg_more: i32) i32;
    pub extern fn us_socket_flush(ssl: i32, s: ?*us_socket_t) void;

    // if a TLS socket calls this, it will start SSL instance and call open event will also do TLS handshake if required
    // will have no effect if the socket is closed or is not TLS
    pub extern fn us_socket_open(ssl: i32, s: ?*us_socket_t, is_client: i32, ip: [*c]const u8, ip_length: i32) ?*us_socket_t;
    pub extern fn us_socket_pause(ssl: i32, s: ?*us_socket_t) void;
    pub extern fn us_socket_resume(ssl: i32, s: ?*us_socket_t) void;
    pub extern fn us_socket_close(ssl: i32, s: ?*us_socket_t, code: us_socket_t.CloseCode, reason: ?*anyopaque) ?*us_socket_t;
    pub extern fn us_socket_shutdown(ssl: i32, s: ?*us_socket_t) void;
    pub extern fn us_socket_is_closed(ssl: i32, s: ?*us_socket_t) i32;
    pub extern fn us_socket_shutdown_read(ssl: i32, s: ?*us_socket_t) void;
    pub extern fn us_socket_is_shut_down(ssl: i32, s: ?*us_socket_t) i32;
    pub extern fn us_socket_sendfile_needs_more(socket: *us_socket_t) void;
    pub extern fn us_socket_get_fd(s: ?*us_socket_t) uws.LIBUS_SOCKET_DESCRIPTOR;
    pub extern fn us_socket_verify_error(ssl: i32, context: *us_socket_t) uws.us_bun_verify_error_t;
    pub extern fn us_socket_upgrade_to_tls(s: *us_socket_t, new_context: *SocketContext, sni: ?[*:0]const u8) ?*us_socket_t;
    pub extern fn us_socket_from_fd(
        ctx: *SocketContext,
        ext_size: c_int,
        fd: uws.LIBUS_SOCKET_DESCRIPTOR,
        is_ipc: c_int,
    ) ?*us_socket_t;
    pub extern fn us_socket_get_error(ssl: i32, s: *uws.us_socket_t) c_int;
    pub extern fn us_socket_is_established(ssl: i32, s: *uws.us_socket_t) i32;
};
