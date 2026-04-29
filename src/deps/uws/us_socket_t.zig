const debug = bun.Output.scoped(.uws, .visible);
const max_i32 = std.math.maxInt(i32);

/// Zig bindings for `us_socket_t`.
///
/// TLS is per-socket (`s->ssl != NULL` in C); there is no `int ssl` selector.
/// Dispatch is by `kind()` — see `SocketKind` and `dispatch.zig`.
///
/// Higher-level wrappers (`uws.SocketTCP`/`SocketTLS`) cover named pipes,
/// upgraded duplexes, and async DNS.
pub const us_socket_t = opaque {
    /// Raw externs. Prefer the typed methods; this is here so call sites that
    /// must hit the C ABI directly (spawn IPC handing a raw fd to
    /// `us_socket_from_fd`, the `handlers.zig` close path) can spell
    /// `uws.us_socket_t.c.X` without a separate import of this file.
    pub const c = c_externs;

    pub const CloseCode = enum(i32) {
        normal = 0,
        failure = 1,
    };

    pub fn open(this: *us_socket_t, is_client: bool, ip_addr: ?[]const u8) void {
        debug("us_socket_open({p}, is_client: {})", .{ this, is_client });
        if (ip_addr) |ip| {
            bun.assert(ip.len < max_i32);
            _ = c.us_socket_open(this, @intFromBool(is_client), ip.ptr, @intCast(@min(ip.len, max_i32)));
        } else {
            _ = c.us_socket_open(this, @intFromBool(is_client), null, 0);
        }
    }

    pub fn pause(this: *us_socket_t) void {
        debug("us_socket_pause({p})", .{this});
        c.us_socket_pause(this);
    }

    pub fn @"resume"(this: *us_socket_t) void {
        debug("us_socket_resume({p})", .{this});
        c.us_socket_resume(this);
    }

    pub fn close(this: *us_socket_t, code: CloseCode) void {
        debug("us_socket_close({p}, {s})", .{ this, @tagName(code) });
        _ = c.us_socket_close(this, code, null);
    }

    pub fn shutdown(this: *us_socket_t) void {
        debug("us_socket_shutdown({p})", .{this});
        c.us_socket_shutdown(this);
    }

    pub fn shutdownRead(this: *us_socket_t) void {
        c.us_socket_shutdown_read(this);
    }

    pub fn isClosed(this: *us_socket_t) bool {
        return c.us_socket_is_closed(this) > 0;
    }

    pub fn isShutdown(this: *us_socket_t) bool {
        return c.us_socket_is_shut_down(this) > 0;
    }

    pub fn isTLS(this: *us_socket_t) bool {
        return c.us_socket_is_tls(this) > 0;
    }

    pub fn localPort(this: *us_socket_t) i32 {
        return c.us_socket_local_port(this);
    }

    pub fn remotePort(this: *us_socket_t) i32 {
        return c.us_socket_remote_port(this);
    }

    /// Returned slice is a view into `buf`.
    pub fn localAddress(this: *us_socket_t, buf: []u8) ![]const u8 {
        var length: i32 = @intCast(@min(buf.len, max_i32));
        c.us_socket_local_address(this, buf.ptr, &length);
        if (length < 0) {
            const errno = bun.sys.getErrno(length);
            bun.debugAssert(errno != .SUCCESS);
            return bun.errnoToZigErr(errno);
        }
        bun.unsafeAssert(buf.len >= length);
        return buf[0..@intCast(length)];
    }

    /// Returned slice is a view into `buf`. On error, `errno` should be set.
    pub fn remoteAddress(this: *us_socket_t, buf: []u8) ![]const u8 {
        var length: i32 = @intCast(@min(buf.len, max_i32));
        c.us_socket_remote_address(this, buf.ptr, &length);
        if (length < 0) {
            const errno = bun.sys.getErrno(length);
            bun.debugAssert(errno != .SUCCESS);
            return bun.errnoToZigErr(errno);
        }
        bun.unsafeAssert(buf.len >= length);
        return buf[0..@intCast(length)];
    }

    pub fn setTimeout(this: *us_socket_t, seconds: u32) void {
        c.us_socket_timeout(this, seconds);
    }

    pub fn setLongTimeout(this: *us_socket_t, minutes: u32) void {
        c.us_socket_long_timeout(this, minutes);
    }

    pub fn setNodelay(this: *us_socket_t, enabled: bool) void {
        c.us_socket_nodelay(this, @intFromBool(enabled));
    }

    pub fn setKeepalive(this: *us_socket_t, enabled: bool, delay: u32) i32 {
        return c.us_socket_keepalive(this, @intFromBool(enabled), delay);
    }

    /// SSL* if TLS, else `(void*)(intptr_t)fd`.
    pub fn getNativeHandle(this: *us_socket_t) ?*anyopaque {
        return c.us_socket_get_native_handle(this);
    }

    pub fn ext(this: *us_socket_t, comptime T: type) *T {
        @setRuntimeSafety(true);
        return @ptrCast(@alignCast(c.us_socket_ext(this).?));
    }

    pub fn group(this: *us_socket_t) *SocketGroup {
        @setRuntimeSafety(true);
        return c.us_socket_group(this);
    }
    pub const rawGroup = group;

    pub fn kind(this: *us_socket_t) SocketKind {
        return @enumFromInt(c.us_socket_kind(this));
    }

    /// Re-stamp the dispatch kind in place. Used after `Listener.onCreate`
    /// stashes the `NewSocket*` in ext so subsequent events skip the listener
    /// arm and route straight to `BunSocket`.
    pub fn setKind(this: *us_socket_t, k: SocketKind) void {
        c.us_socket_set_kind(this, @intFromEnum(k));
    }

    /// Move this socket to a new group/kind, optionally resizing its ext.
    /// Returns the (possibly relocated) socket; `this` is invalid after.
    pub fn adopt(this: *us_socket_t, g: *SocketGroup, k: SocketKind, old_ext: i32, new_ext: i32) ?*us_socket_t {
        return c.us_socket_adopt(this, g, @intFromEnum(k), old_ext, new_ext);
    }

    /// `adopt` + attach a fresh `SSL*` from `ssl_ctx` (refcounted by the C
    /// side for the socket's lifetime). Does NOT kick the handshake — the
    /// caller must repoint `ext` first (so any dispatch lands in the new
    /// owner) and then call `startTLSHandshake`. Replaces
    /// `us_socket_upgrade_to_tls` / `wrapTLS`.
    pub fn adoptTLS(
        this: *us_socket_t,
        g: *SocketGroup,
        k: SocketKind,
        ssl_ctx: *uws.SslCtx,
        sni: ?[*:0]const u8,
        old_ext: i32,
        new_ext: i32,
    ) ?*us_socket_t {
        return c.us_socket_adopt_tls(this, g, @intFromEnum(k), ssl_ctx, sni, old_ext, new_ext);
    }

    /// Send ClientHello. Separate from `adoptTLS` so the ext slot can be
    /// repointed before any handshake/close dispatch can fire.
    pub fn startTLSHandshake(this: *us_socket_t) void {
        c.us_socket_start_tls_handshake(this);
    }

    pub fn write(this: *us_socket_t, data: []const u8) i32 {
        const rc = c.us_socket_write(this, data.ptr, @intCast(@min(data.len, max_i32)));
        debug("us_socket_write({p}, {d}) = {d}", .{ this, data.len, rc });
        return rc;
    }

    pub fn writeFd(this: *us_socket_t, data: []const u8, file_descriptor: bun.FD) i32 {
        if (bun.Environment.isWindows) @compileError("TODO: implement writeFd on Windows");
        const rc = c.us_socket_ipc_write_fd(this, data.ptr, @intCast(@min(data.len, max_i32)), file_descriptor.native());
        debug("us_socket_ipc_write_fd({p}, {d}, {d}) = {d}", .{ this, data.len, file_descriptor.native(), rc });
        return rc;
    }

    pub fn write2(this: *us_socket_t, first: []const u8, second: []const u8) i32 {
        const rc = c.us_socket_write2(this, first.ptr, first.len, second.ptr, second.len);
        debug("us_socket_write2({p}, {d}, {d}) = {d}", .{ this, first.len, second.len, rc });
        return rc;
    }

    /// Bypass TLS — raw bytes to the fd even if `isTLS()`.
    pub fn rawWrite(this: *us_socket_t, data: []const u8) i32 {
        debug("us_socket_raw_write({p}, {d})", .{ this, data.len });
        return c.us_socket_raw_write(this, data.ptr, @intCast(@min(data.len, max_i32)));
    }

    pub fn flush(this: *us_socket_t) void {
        c.us_socket_flush(this);
    }

    pub fn sendFileNeedsMore(this: *us_socket_t) void {
        c.us_socket_sendfile_needs_more(this);
    }

    pub fn getFd(this: *us_socket_t) bun.FD {
        return .fromNative(c.us_socket_get_fd(this));
    }

    pub fn getVerifyError(this: *us_socket_t) uws.us_bun_verify_error_t {
        return c.us_socket_verify_error(this);
    }

    pub fn getError(this: *us_socket_t) i32 {
        return c.us_socket_get_error(this);
    }

    pub fn isEstablished(this: *us_socket_t) bool {
        return c.us_socket_is_established(this) > 0;
    }
};

pub const c_externs = struct {
    pub extern fn us_socket_get_native_handle(s: ?*us_socket_t) ?*anyopaque;

    pub extern fn us_socket_local_port(s: ?*us_socket_t) i32;
    pub extern fn us_socket_remote_port(s: ?*us_socket_t) i32;
    pub extern fn us_socket_remote_address(s: ?*us_socket_t, buf: [*c]u8, length: [*c]i32) void;
    pub extern fn us_socket_local_address(s: ?*us_socket_t, buf: [*c]u8, length: [*c]i32) void;
    pub extern fn us_socket_timeout(s: ?*us_socket_t, seconds: c_uint) void;
    pub extern fn us_socket_long_timeout(s: ?*us_socket_t, minutes: c_uint) void;
    pub extern fn us_socket_nodelay(s: ?*us_socket_t, enable: c_int) void;
    pub extern fn us_socket_keepalive(s: ?*us_socket_t, enable: c_int, delay: c_uint) c_int;

    pub extern fn us_socket_ext(s: ?*us_socket_t) ?*anyopaque;
    pub extern fn us_socket_group(s: ?*us_socket_t) *SocketGroup;
    pub extern fn us_socket_kind(s: ?*us_socket_t) u8;
    pub extern fn us_socket_set_kind(s: ?*us_socket_t, kind: u8) void;
    pub extern fn us_socket_is_tls(s: ?*us_socket_t) i32;

    pub extern fn us_socket_write(s: ?*us_socket_t, data: [*c]const u8, length: i32) i32;
    pub extern fn us_socket_ipc_write_fd(s: ?*us_socket_t, data: [*c]const u8, length: i32, fd: i32) i32;
    pub extern fn us_socket_write2(*us_socket_t, header: ?[*]const u8, len: usize, payload: ?[*]const u8, usize) i32;
    pub extern fn us_socket_raw_write(s: ?*us_socket_t, data: [*c]const u8, length: i32) i32;
    pub extern fn us_socket_flush(s: ?*us_socket_t) void;

    pub extern fn us_socket_open(s: ?*us_socket_t, is_client: i32, ip: [*c]const u8, ip_length: i32) ?*us_socket_t;
    pub extern fn us_socket_pause(s: ?*us_socket_t) void;
    pub extern fn us_socket_resume(s: ?*us_socket_t) void;
    pub extern fn us_socket_close(s: ?*us_socket_t, code: us_socket_t.CloseCode, reason: ?*anyopaque) ?*us_socket_t;
    pub extern fn us_socket_shutdown(s: ?*us_socket_t) void;
    pub extern fn us_socket_is_closed(s: ?*us_socket_t) i32;
    pub extern fn us_socket_shutdown_read(s: ?*us_socket_t) void;
    pub extern fn us_socket_is_shut_down(s: ?*us_socket_t) i32;
    pub extern fn us_socket_sendfile_needs_more(socket: *us_socket_t) void;
    pub extern fn us_socket_get_fd(s: ?*us_socket_t) uws.LIBUS_SOCKET_DESCRIPTOR;
    pub extern fn us_socket_verify_error(s: *us_socket_t) uws.us_bun_verify_error_t;
    pub extern fn us_socket_get_error(s: *us_socket_t) c_int;
    pub extern fn us_socket_is_established(s: *us_socket_t) i32;

    pub extern fn us_socket_adopt(s: *us_socket_t, group: *SocketGroup, kind: u8, old_ext_size: i32, ext_size: i32) ?*us_socket_t;
    pub extern fn us_socket_adopt_tls(s: *us_socket_t, group: *SocketGroup, kind: u8, ssl_ctx: ?*anyopaque, sni: ?[*:0]const u8, old_ext_size: i32, ext_size: i32) ?*us_socket_t;
    pub extern fn us_socket_start_tls_handshake(s: *us_socket_t) void;
    pub extern fn us_socket_from_fd(group: *SocketGroup, kind: u8, ssl_ctx: ?*anyopaque, ext_size: c_int, fd: uws.LIBUS_SOCKET_DESCRIPTOR, is_ipc: c_int) ?*us_socket_t;
    pub extern fn us_socket_pair(group: *SocketGroup, kind: u8, ext_size: c_int, fds: *[2]uws.LIBUS_SOCKET_DESCRIPTOR) ?*us_socket_t;

    const us_socket_stream_buffer_t = extern struct {
        list_ptr: ?[*]u8 = null,
        list_cap: usize = 0,
        list_len: usize = 0,
        total_bytes_written: usize = 0,
        cursor: usize = 0,

        pub fn update(this: *us_socket_stream_buffer_t, stream_buffer: bun.io.StreamBuffer) void {
            if (stream_buffer.list.capacity > 0) {
                this.list_ptr = stream_buffer.list.items.ptr;
            } else {
                this.list_ptr = null;
            }
            this.list_len = stream_buffer.list.items.len;
            this.list_cap = stream_buffer.list.capacity;
            this.cursor = stream_buffer.cursor;
        }
        pub fn wrote(this: *us_socket_stream_buffer_t, written: usize) void {
            this.total_bytes_written +|= written;
        }

        pub fn toStreamBuffer(this: *us_socket_stream_buffer_t) bun.io.StreamBuffer {
            return .{
                .list = if (this.list_ptr) |buffer_ptr| .{
                    .allocator = bun.default_allocator,
                    .items = buffer_ptr[0..this.list_len],
                    .capacity = this.list_cap,
                } else .{
                    .allocator = bun.default_allocator,
                    .items = &.{},
                    .capacity = 0,
                },
                .cursor = this.cursor,
            };
        }

        pub fn deinit(this: *us_socket_stream_buffer_t) void {
            if (this.list_ptr) |buffer| {
                bun.default_allocator.free(buffer[0..this.list_cap]);
            }
        }
    };

    export fn us_socket_free_stream_buffer(buffer: *us_socket_stream_buffer_t) void {
        buffer.deinit();
    }
    export fn us_socket_buffered_js_write(
        socket: *uws.us_socket_t,
        // kept for ABI parity with the C++ caller; TLS is now per-socket
        _: bool,
        ended: bool,
        buffer: *us_socket_stream_buffer_t,
        globalObject: *jsc.JSGlobalObject,
        data: jsc.JSValue,
        encoding: jsc.JSValue,
    ) jsc.JSValue {
        var stream_buffer = buffer.toStreamBuffer();
        var total_written: usize = 0;
        defer {
            buffer.update(stream_buffer);
            buffer.wrote(total_written);
        }

        var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
        const node_buffer: jsc.Node.BlobOrStringOrBuffer = if (data.isUndefined())
            jsc.Node.BlobOrStringOrBuffer{ .string_or_buffer = jsc.Node.StringOrBuffer.empty }
        else
            jsc.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueAllowRequestResponse(globalObject, stack_fallback.get(), data, encoding, true) catch {
                return .zero;
            } orelse {
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentTypeValue("data", "string, buffer, or blob", data) catch .zero;
                }
                return .zero;
            };

        defer node_buffer.deinit();
        if (node_buffer == .blob and node_buffer.blob.needsToReadFile()) {
            return globalObject.throw("File blob not supported yet in this function.", .{}) catch .zero;
        }

        const data_slice = node_buffer.slice();
        if (stream_buffer.isNotEmpty()) {
            const to_flush = stream_buffer.slice();
            const written: u32 = @max(0, socket.write(to_flush));
            stream_buffer.wrote(written);
            total_written +|= written;
            if (written < to_flush.len) {
                if (data_slice.len > 0) {
                    bun.handleOom(stream_buffer.write(data_slice));
                }
                return JSValue.jsBoolean(false);
            }
        }

        if (data_slice.len > 0) {
            const written: u32 = @max(0, socket.write(data_slice));
            total_written +|= written;
            if (written < data_slice.len) {
                bun.handleOom(stream_buffer.write(data_slice[written..]));
                return JSValue.jsBoolean(false);
            }
        }
        if (ended) {
            socket.shutdown();
        }
        return JSValue.jsBoolean(true);
    }
};

const bun = @import("bun");
const std = @import("std");

const uws = @import("../uws.zig");
const SocketGroup = uws.SocketGroup;
const SocketKind = uws.SocketKind;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
