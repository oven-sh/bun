const std = @import("std");
const bun = @import("bun");
const uws = @import("../uws.zig");

const SocketContext = uws.SocketContext;

const debug = bun.Output.scoped(.uws, false);
const max_i32 = std.math.maxInt(i32);

/// Zig bindings for `us_socket_t`
pub const Socket = opaque {
    pub const CloseCode = enum(i32) {
        normal = 0,
        failure = 1,
    };

    pub fn open(this: *Socket, comptime is_ssl: bool, is_client: bool, ip_addr: ?[]const u8) void {
        debug("us_socket_open({d}, is_client: {})", .{ @intFromPtr(this), is_client });
        const ssl = @intFromBool(is_ssl);

        if (ip_addr) |ip| {
            bun.assert(ip.len < max_i32);
            _ = us_socket_open(ssl, this, @intFromBool(is_client), ip.ptr, @intCast(ip.len));
        } else {
            _ = us_socket_open(ssl, this, @intFromBool(is_client), null, 0);
        }
    }

    pub fn pause(this: *Socket, ssl: bool) void {
        debug("us_socket_pause({d})", .{@intFromPtr(this)});
        us_socket_pause(@intFromBool(ssl), this);
    }

    pub fn @"resume"(this: *Socket, ssl: bool) void {
        debug("us_socket_resume({d})", .{@intFromPtr(this)});
        us_socket_resume(@intFromBool(ssl), this);
    }

    pub fn close(this: *Socket, ssl: bool, code: CloseCode) void {
        debug("us_socket_close({d}, {s})", .{ @intFromPtr(this), @tagName(code) });
        _ = us_socket_close(@intFromBool(ssl), this, code, null);
    }

    pub fn shutdown(this: *Socket, ssl: bool) void {
        debug("us_socket_shutdown({d})", .{@intFromPtr(this)});
        us_socket_shutdown(@intFromBool(ssl), this);
    }

    pub fn shutdownRead(this: *Socket, ssl: bool) void {
        us_socket_shutdown_read(@intFromBool(ssl), this);
    }

    pub fn isClosed(this: *Socket, ssl: bool) bool {
        return us_socket_is_closed(@intFromBool(ssl), this) > 0;
    }

    pub fn isShutDown(this: *Socket, ssl: bool) bool {
        return us_socket_is_shut_down(@intFromBool(ssl), this) > 0;
    }

    pub fn localPort(this: *Socket, ssl: bool) i32 {
        return us_socket_local_port(@intFromBool(ssl), this);
    }

    pub fn remotePort(this: *Socket, ssl: bool) i32 {
        return us_socket_remote_port(@intFromBool(ssl), this);
    }

    /// Returned slice is a view into `buf`.
    pub fn localAddress(this: *Socket, ssl: bool, buf: []u8) ![]const u8 {
        var length: i32 = @intCast(buf.len);

        us_socket_local_address(@intFromBool(ssl), this, buf.ptr, &length);
        if (length < 0) {
            const errno = bun.sys.getErrno(length);
            bun.debugAssert(errno != .SUCCESS);
            return bun.errnoToZigErr(errno);
        }
        bun.unsafeAssert(buf.len >= length);

        return buf[0..@intCast(length)];
    }

    /// Returned slice is a view into `buf`. On error, `errno` should be set
    pub fn remoteAddress(this: *Socket, ssl: bool, buf: []u8) ![]const u8 {
        var length: i32 = @intCast(buf.len);

        us_socket_remote_address(@intFromBool(ssl), this, buf.ptr, &length);
        if (length < 0) {
            const errno = bun.sys.getErrno(length);
            bun.debugAssert(errno != .SUCCESS);
            return bun.errnoToZigErr(errno);
        }
        bun.unsafeAssert(buf.len >= length);

        return buf[0..@intCast(length)];
    }

    pub fn setTimeout(this: *Socket, ssl: bool, seconds: u32) void {
        us_socket_timeout(@intFromBool(ssl), this, @intCast(seconds));
    }

    pub fn setLongTimeout(this: *Socket, ssl: bool, minutes: u32) void {
        us_socket_long_timeout(@intFromBool(ssl), this, @intCast(minutes));
    }

    pub fn setNodelay(this: *Socket, enabled: bool) void {
        us_socket_nodelay(this, @intFromBool(enabled));
    }

    /// Returns error code. `0` on success. error codes depend on platform an
    /// configured event loop.
    pub fn setKeepalive(this: *Socket, enabled: bool, delay: u32) i32 {
        return us_socket_keepalive(this, @intFromBool(enabled), @intCast(delay));
    }

    pub fn getNativeHandle(this: *Socket, ssl: bool) ?*anyopaque {
        return us_socket_get_native_handle(@intFromBool(ssl), this);
    }

    pub fn ext(this: *Socket, ssl: bool) *anyopaque {
        @setRuntimeSafety(true);
        return us_socket_ext(@intFromBool(ssl), this).?;
    }

    pub fn context(this: *Socket, ssl: bool) *SocketContext {
        @setRuntimeSafety(true);
        return us_socket_context(@intFromBool(ssl), this).?;
    }

    pub fn write(this: *Socket, ssl: bool, data: []const u8, msg_more: bool) i32 {
        const rc = us_socket_write(@intFromBool(ssl), this, data.ptr, @intCast(data.len), @intFromBool(msg_more));
        debug("us_socket_write({d}, {d}) = {d}", .{ @intFromPtr(this), data.len, rc });
        return rc;
    }

    pub fn writeFd(this: *Socket, data: []const u8, file_descriptor: bun.FD) i32 {
        if (bun.Environment.isWindows) @compileError("TODO: implement writeFd on Windows");
        const rc = us_socket_ipc_write_fd(this, data.ptr, @intCast(data.len), file_descriptor.native());
        debug("us_socket_ipc_write_fd({d}, {d}, {d}) = {d}", .{ @intFromPtr(this), data.len, file_descriptor.native(), rc });
        return rc;
    }

    pub fn write2(this: *Socket, ssl: bool, first: []const u8, second: []const u8) i32 {
        const rc = us_socket_write2(@intFromBool(ssl), this, first.ptr, first.len, second.ptr, second.len);
        debug("us_socket_write2({d}, {d}, {d}) = {d}", .{ @intFromPtr(this), first.len, second.len, rc });
        return rc;
    }

    pub fn rawWrite(this: *Socket, ssl: bool, data: []const u8, msg_more: bool) i32 {
        debug("us_socket_raw_write({d}, {d})", .{ @intFromPtr(this), data.len });
        return us_socket_raw_write(@intFromBool(ssl), this, data.ptr, @intCast(data.len), @intFromBool(msg_more));
    }

    pub fn flush(this: *Socket, ssl: bool) void {
        us_socket_flush(@intFromBool(ssl), this);
    }

    pub fn sendFileNeedsMore(this: *Socket) void {
        us_socket_sendfile_needs_more(this);
    }

    pub fn getFd(this: *Socket) bun.FD {
        return .fromNative(us_socket_get_fd(this));
    }

    extern fn us_socket_get_native_handle(ssl: i32, s: ?*Socket) ?*anyopaque;

    extern fn us_socket_local_port(ssl: i32, s: ?*Socket) i32;
    extern fn us_socket_remote_port(ssl: i32, s: ?*Socket) i32;
    extern fn us_socket_remote_address(ssl: i32, s: ?*Socket, buf: [*c]u8, length: [*c]i32) void;
    extern fn us_socket_local_address(ssl: i32, s: ?*Socket, buf: [*c]u8, length: [*c]i32) void;
    extern fn us_socket_timeout(ssl: i32, s: ?*Socket, seconds: c_uint) void;
    extern fn us_socket_long_timeout(ssl: i32, s: ?*Socket, minutes: c_uint) void;
    extern fn us_socket_nodelay(s: ?*Socket, enable: c_int) void;
    extern fn us_socket_keepalive(s: ?*Socket, enable: c_int, delay: c_uint) c_int;

    extern fn us_socket_ext(ssl: i32, s: ?*Socket) ?*anyopaque; // nullish to be safe
    extern fn us_socket_context(ssl: i32, s: ?*Socket) ?*SocketContext;

    extern fn us_socket_write(ssl: i32, s: ?*Socket, data: [*c]const u8, length: i32, msg_more: i32) i32;
    extern fn us_socket_ipc_write_fd(s: ?*Socket, data: [*c]const u8, length: i32, fd: i32) i32;
    extern "c" fn us_socket_write2(ssl: i32, *Socket, header: ?[*]const u8, len: usize, payload: ?[*]const u8, usize) i32;
    extern fn us_socket_raw_write(ssl: i32, s: ?*Socket, data: [*c]const u8, length: i32, msg_more: i32) i32;
    extern fn us_socket_flush(ssl: i32, s: ?*Socket) void;

    // if a TLS socket calls this, it will start SSL instance and call open event will also do TLS handshake if required
    // will have no effect if the socket is closed or is not TLS
    extern fn us_socket_open(ssl: i32, s: ?*Socket, is_client: i32, ip: [*c]const u8, ip_length: i32) ?*Socket;
    extern fn us_socket_pause(ssl: i32, s: ?*Socket) void;
    extern fn us_socket_resume(ssl: i32, s: ?*Socket) void;
    extern fn us_socket_close(ssl: i32, s: ?*Socket, code: CloseCode, reason: ?*anyopaque) ?*Socket;
    extern fn us_socket_shutdown(ssl: i32, s: ?*Socket) void;
    extern fn us_socket_is_closed(ssl: i32, s: ?*Socket) i32;
    extern fn us_socket_shutdown_read(ssl: i32, s: ?*Socket) void;
    extern fn us_socket_is_shut_down(ssl: i32, s: ?*Socket) i32;

    extern fn us_socket_sendfile_needs_more(socket: *Socket) void;
    extern fn us_socket_get_fd(s: ?*Socket) LIBUS_SOCKET_DESCRIPTOR;
    const LIBUS_SOCKET_DESCRIPTOR = switch (bun.Environment.isWindows) {
        true => *anyopaque,
        false => i32,
    };
};
