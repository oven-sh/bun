//! High-level socket wrapper over `us_socket_t` / `ConnectingSocket` /
//! `UpgradedDuplex` / `WindowsNamedPipe`. The `comptime is_ssl` parameter is
//! kept so callers can pick `*BoringSSL.SSL` vs `fd` for `getNativeHandle`
//! and `fd()`, but it is NOT forwarded to C — TLS is per-socket there.
//!
//! Callback wiring (`configure`/`unsafeConfigure`/`wrapTLS`) and
//! per-connection `SocketContext` creation (`connect*`/`adoptPtr`) are gone:
//! see `SocketGroup`, `SocketKind`, `vtable.zig`, `dispatch.zig`.

pub fn NewSocketHandler(comptime is_ssl: bool) type {
    return struct {
        socket: InternalSocket,

        const ThisSocket = @This();

        pub const detached: NewSocketHandler(is_ssl) = NewSocketHandler(is_ssl){ .socket = .{ .detached = {} } };

        pub fn setNoDelay(this: ThisSocket, enabled: bool) bool {
            return this.socket.setNoDelay(enabled);
        }

        pub fn setKeepAlive(this: ThisSocket, enabled: bool, delay: u32) bool {
            return this.socket.setKeepAlive(enabled, delay);
        }

        pub fn pauseStream(this: ThisSocket) bool {
            return this.socket.pauseResume(true);
        }

        pub fn resumeStream(this: ThisSocket) bool {
            return this.socket.pauseResume(false);
        }

        pub fn detach(this: *ThisSocket) void {
            this.socket.detach();
        }

        pub fn isDetached(this: ThisSocket) bool {
            return this.socket.isDetached();
        }

        pub fn isNamedPipe(this: ThisSocket) bool {
            return this.socket.isNamedPipe();
        }

        pub fn getVerifyError(this: ThisSocket) uws.us_bun_verify_error_t {
            switch (this.socket) {
                .connected => |socket| return socket.getVerifyError(),
                .upgradedDuplex => |socket| return socket.sslError(),
                .pipe => |pipe| if (Environment.isWindows) return pipe.sslError() else return std.mem.zeroes(us_bun_verify_error_t),
                .connecting, .detached => return std.mem.zeroes(us_bun_verify_error_t),
            }
        }

        pub fn isEstablished(this: ThisSocket) bool {
            switch (this.socket) {
                .connected => |socket| return socket.isEstablished(),
                .upgradedDuplex => |socket| return socket.isEstablished(),
                .pipe => |pipe| if (Environment.isWindows) return pipe.isEstablished() else return false,
                .connecting, .detached => return false,
            }
        }

        pub fn timeout(this: ThisSocket, seconds: c_uint) void {
            switch (this.socket) {
                .upgradedDuplex => |socket| socket.setTimeout(seconds),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(seconds),
                .connected => |socket| socket.setTimeout(seconds),
                .connecting => |socket| socket.timeout(seconds),
                .detached => {},
            }
        }

        pub fn setTimeout(this: ThisSocket, seconds: c_uint) void {
            switch (this.socket) {
                .connected => |socket| {
                    if (seconds > 240) {
                        socket.setTimeout(0);
                        socket.setLongTimeout(seconds / 60);
                    } else {
                        socket.setTimeout(seconds);
                        socket.setLongTimeout(0);
                    }
                },
                .connecting => |socket| {
                    if (seconds > 240) {
                        socket.timeout(0);
                        socket.longTimeout(seconds / 60);
                    } else {
                        socket.timeout(seconds);
                        socket.longTimeout(0);
                    }
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.setTimeout(seconds),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(seconds),
            }
        }

        pub fn setTimeoutMinutes(this: ThisSocket, minutes: c_uint) void {
            switch (this.socket) {
                .connected => |socket| {
                    socket.setTimeout(0);
                    socket.setLongTimeout(minutes);
                },
                .connecting => |socket| {
                    socket.timeout(0);
                    socket.longTimeout(minutes);
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.setTimeout(minutes * 60),
                .pipe => |pipe| if (Environment.isWindows) pipe.setTimeout(minutes * 60),
            }
        }

        pub fn startTLS(this: ThisSocket, is_client: bool) void {
            if (this.socket.get()) |socket| socket.open(is_client, null);
        }

        pub fn ssl(this: ThisSocket) ?*BoringSSL.SSL {
            if (comptime is_ssl) {
                if (this.getNativeHandle()) |handle| {
                    return @as(*BoringSSL.SSL, @ptrCast(handle));
                }
                return null;
            }
            return null;
        }

        pub fn getNativeHandle(this: ThisSocket) ?*NativeSocketHandleType(is_ssl) {
            return @ptrCast(switch (this.socket) {
                .connected => |socket| socket.getNativeHandle(),
                .connecting => |socket| socket.getNativeHandle(),
                .detached => null,
                .upgradedDuplex => |socket| if (is_ssl) @as(*anyopaque, @ptrCast(socket.ssl() orelse return null)) else null,
                .pipe => |socket| if (is_ssl and Environment.isWindows) @as(*anyopaque, @ptrCast(socket.ssl() orelse return null)) else null,
            } orelse return null);
        }

        pub inline fn fd(this: ThisSocket) bun.FD {
            const socket = this.socket.get() orelse return bun.invalid_fd;
            // Same fd regardless of TLS — read it directly off the poll.
            return socket.getFd();
        }

        pub fn markNeedsMoreForSendfile(this: ThisSocket) void {
            if (comptime is_ssl) {
                @compileError("SSL sockets do not support sendfile yet");
            }
            const socket = this.socket.get() orelse return;
            socket.sendFileNeedsMore();
        }

        pub fn ext(this: ThisSocket, comptime ContextType: type) ?*ContextType {
            return switch (this.socket) {
                .connected => |sock| sock.ext(ContextType),
                .connecting => |sock| sock.ext(ContextType),
                .detached, .upgradedDuplex, .pipe => null,
            };
        }

        /// Group this socket is linked into. Null for non-uSockets transports.
        pub fn group(this: ThisSocket) ?*SocketGroup {
            switch (this.socket) {
                .connected => |socket| return socket.group(),
                .connecting => |socket| return socket.group(),
                .detached, .upgradedDuplex, .pipe => return null,
            }
        }

        pub fn flush(this: ThisSocket) void {
            switch (this.socket) {
                .upgradedDuplex => |socket| socket.flush(),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.flush(),
                .connected => |socket| socket.flush(),
                .connecting, .detached => return,
            }
        }

        pub fn write(this: ThisSocket, data: []const u8) i32 {
            return switch (this.socket) {
                .upgradedDuplex => |socket| socket.encodeAndWrite(data),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.encodeAndWrite(data) else 0,
                .connected => |socket| socket.write(data),
                .connecting, .detached => 0,
            };
        }

        pub fn writeFd(this: ThisSocket, data: []const u8, file_descriptor: bun.FD) i32 {
            return switch (this.socket) {
                .upgradedDuplex, .pipe => this.write(data),
                .connected => |socket| socket.writeFd(data, file_descriptor),
                .connecting, .detached => 0,
            };
        }

        pub fn rawWrite(this: ThisSocket, data: []const u8) i32 {
            return switch (this.socket) {
                .connected => |socket| socket.rawWrite(data),
                .connecting, .detached => 0,
                .upgradedDuplex => |socket| socket.rawWrite(data),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.rawWrite(data) else 0,
            };
        }

        pub fn shutdown(this: ThisSocket) void {
            switch (this.socket) {
                .connected => |socket| socket.shutdown(),
                .connecting => |socket| {
                    debug("us_connecting_socket_shutdown({d})", .{@intFromPtr(socket)});
                    return socket.shutdown();
                },
                .detached => {},
                .upgradedDuplex => |socket| socket.shutdown(),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.shutdown(),
            }
        }

        pub fn shutdownRead(this: ThisSocket) void {
            switch (this.socket) {
                .connected => |socket| socket.shutdownRead(),
                .connecting => |socket| {
                    debug("us_connecting_socket_shutdown_read({d})", .{@intFromPtr(socket)});
                    return socket.shutdownRead();
                },
                .upgradedDuplex => |socket| socket.shutdownRead(),
                .pipe => |pipe| if (comptime Environment.isWindows) pipe.shutdownRead(),
                .detached => {},
            }
        }

        pub fn isShutdown(this: ThisSocket) bool {
            return switch (this.socket) {
                .connected => |socket| socket.isShutdown(),
                .connecting => |socket| blk: {
                    debug("us_connecting_socket_is_shut_down({d})", .{@intFromPtr(socket)});
                    break :blk socket.isShutdown();
                },
                .upgradedDuplex => |socket| socket.isShutdown(),
                .pipe => |pipe| return if (Environment.isWindows) pipe.isShutdown() else false,
                .detached => true,
            };
        }

        pub fn isClosedOrHasError(this: ThisSocket) bool {
            if (this.isClosed() or this.isShutdown()) {
                return true;
            }
            return this.getError() != 0;
        }

        pub fn getError(this: ThisSocket) i32 {
            switch (this.socket) {
                .connected => |socket| {
                    debug("us_socket_get_error({d})", .{@intFromPtr(socket)});
                    return socket.getError();
                },
                .connecting => |socket| {
                    debug("us_connecting_socket_get_error({d})", .{@intFromPtr(socket)});
                    return socket.getError();
                },
                .detached => return 0,
                .upgradedDuplex => |socket| return socket.sslError().error_no,
                .pipe => |pipe| return if (Environment.isWindows) pipe.sslError().error_no else 0,
            }
        }

        pub fn isClosed(this: ThisSocket) bool {
            return this.socket.isClosed();
        }

        pub fn close(this: ThisSocket, code: us_socket_t.CloseCode) void {
            return this.socket.close(code);
        }

        pub fn localPort(this: ThisSocket) i32 {
            return switch (this.socket) {
                .connected => |socket| socket.localPort(),
                .pipe, .upgradedDuplex, .connecting, .detached => 0,
            };
        }

        pub fn remotePort(this: ThisSocket) i32 {
            return switch (this.socket) {
                .connected => |socket| socket.remotePort(),
                .pipe, .upgradedDuplex, .connecting, .detached => 0,
            };
        }

        pub fn remoteAddress(this: ThisSocket, buf: []u8) ?[]const u8 {
            return switch (this.socket) {
                .connected => |sock| sock.remoteAddress(buf) catch |e| {
                    bun.Output.panic("Failed to get socket's remote address: {s}", .{@errorName(e)});
                },
                .pipe, .upgradedDuplex, .connecting, .detached => null,
            };
        }

        pub fn localAddress(this: ThisSocket, buf: []u8) ?[]const u8 {
            return switch (this.socket) {
                .connected => |sock| sock.localAddress(buf) catch |e| {
                    bun.Output.panic("Failed to get socket's local address: {s}", .{@errorName(e)});
                },
                .pipe, .upgradedDuplex, .connecting, .detached => null,
            };
        }

        pub fn fromDuplex(duplex: *UpgradedDuplex) ThisSocket {
            return ThisSocket{ .socket = .{ .upgradedDuplex = duplex } };
        }

        pub fn fromNamedPipe(pipe: *WindowsNamedPipe) ThisSocket {
            if (Environment.isWindows) {
                return ThisSocket{ .socket = .{ .pipe = pipe } };
            }
            @compileError("WindowsNamedPipe is only available on Windows");
        }

        /// Wrap an already-open fd. Ext stores `*This`; the socket is linked
        /// into `g` with kind `k`.
        pub fn fromFd(
            g: *SocketGroup,
            k: SocketKind,
            handle: bun.FD,
            comptime This: type,
            this: *This,
            comptime socket_field_name: ?[]const u8,
            is_ipc: bool,
        ) ?ThisSocket {
            const raw = g.fromFd(k, null, @sizeOf(?*This), handle.native(), is_ipc) orelse return null;
            const socket_ = ThisSocket{ .socket = .{ .connected = raw } };

            raw.ext(?*This).* = this;
            if (comptime socket_field_name) |field| {
                @field(this, field) = socket_;
            }
            return socket_;
        }

        /// Connect via a `SocketGroup` and stash `owner` in the socket ext.
        /// Replaces the deleted `connectAnon`/`connectPtr`.
        pub fn connectGroup(
            g: *SocketGroup,
            kind: SocketKind,
            ssl_ctx: ?*uws.SslCtx,
            raw_host: []const u8,
            port: anytype,
            owner: anytype,
            allow_half_open: bool,
        ) !ThisSocket {
            const Owner = @typeInfo(@TypeOf(owner)).pointer.child;
            const opts: c_int = if (allow_half_open) uws.LIBUS_SOCKET_ALLOW_HALF_OPEN else 0;
            // getaddrinfo doesn't understand bracketed IPv6 literals; URL
            // parsing leaves them in (`[::1]`), so strip here like the old
            // connectAnon did.
            const host = if (raw_host.len > 1 and raw_host[0] == '[' and raw_host[raw_host.len - 1] == ']')
                raw_host[1 .. raw_host.len - 1]
            else
                raw_host;
            // SocketGroup.connect needs a NUL-terminated host.
            var stack: [256]u8 = undefined;
            const hostZ: [:0]const u8 = if (host.len < stack.len) blk: {
                @memcpy(stack[0..host.len], host);
                stack[host.len] = 0;
                break :blk stack[0..host.len :0];
            } else bun.handleOom(bun.default_allocator.dupeZ(u8, host));
            defer if (hostZ.ptr != &stack) bun.default_allocator.free(hostZ);

            return switch (g.connect(kind, ssl_ctx, hostZ, @intCast(port), opts, @sizeOf(?*Owner))) {
                .failed => error.FailedToOpenSocket,
                .socket => |s| blk: {
                    s.ext(?*Owner).* = owner;
                    break :blk .{ .socket = .{ .connected = s } };
                },
                .connecting => |cs| blk: {
                    cs.ext(?*Owner).* = owner;
                    break :blk .{ .socket = .{ .connecting = cs } };
                },
            };
        }

        pub fn connectUnixGroup(
            g: *SocketGroup,
            kind: SocketKind,
            ssl_ctx: ?*uws.SslCtx,
            path: []const u8,
            owner: anytype,
            allow_half_open: bool,
        ) !ThisSocket {
            const Owner = @typeInfo(@TypeOf(owner)).pointer.child;
            const opts: c_int = if (allow_half_open) uws.LIBUS_SOCKET_ALLOW_HALF_OPEN else 0;
            const s = g.connectUnix(kind, ssl_ctx, path.ptr, path.len, opts, @sizeOf(?*Owner)) orelse
                return error.FailedToOpenSocket;
            s.ext(?*Owner).* = owner;
            return .{ .socket = .{ .connected = s } };
        }

        /// Move an open socket into a new group/kind, stashing `owner` in the
        /// ext. Replaces `Socket.adoptPtr`.
        pub fn adoptGroup(
            tcp: *us_socket_t,
            g: *SocketGroup,
            kind: SocketKind,
            comptime Owner: type,
            comptime field: []const u8,
            owner: *Owner,
        ) bool {
            const new_s = tcp.adopt(g, kind, @sizeOf(*anyopaque), @sizeOf(*anyopaque)) orelse return false;
            new_s.ext(*anyopaque).* = owner;
            @field(owner, field) = .{ .socket = .{ .connected = new_s } };
            return true;
        }

        pub fn from(socket: *us_socket_t) ThisSocket {
            return ThisSocket{ .socket = .{ .connected = socket } };
        }

        pub fn fromConnecting(connecting: *ConnectingSocket) ThisSocket {
            return ThisSocket{ .socket = .{ .connecting = connecting } };
        }

        pub fn fromAny(socket: InternalSocket) ThisSocket {
            return ThisSocket{ .socket = socket };
        }
    };
}
pub const SocketTCP = NewSocketHandler(false);
pub const SocketTLS = NewSocketHandler(true);

pub const InternalSocket = union(enum) {
    connected: *us_socket_t,
    connecting: *ConnectingSocket,
    detached: void,
    upgradedDuplex: *uws.UpgradedDuplex,
    pipe: if (Environment.isWindows) *uws.WindowsNamedPipe else void,

    pub fn pauseResume(this: InternalSocket, pause: bool) bool {
        switch (this) {
            .detached => return true,
            .connected => |socket| {
                if (pause) socket.pause() else socket.@"resume"();
                return true;
            },
            .connecting => |_| return false,
            .upgradedDuplex => |_| return false, // TODO: pause/resume upgraded duplex
            .pipe => |pipe| {
                if (Environment.isWindows) {
                    return if (pause) pipe.pauseStream() else pipe.resumeStream();
                }
                return false;
            },
        }
    }
    pub fn isDetached(this: InternalSocket) bool {
        return this == .detached;
    }
    pub fn isNamedPipe(this: InternalSocket) bool {
        return this == .pipe;
    }
    pub fn detach(this: *InternalSocket) void {
        this.* = .detached;
    }
    pub fn setNoDelay(this: InternalSocket, enabled: bool) bool {
        switch (this) {
            .pipe, .upgradedDuplex, .connecting, .detached => return false,
            .connected => |socket| {
                socket.setNodelay(enabled);
                return true;
            },
        }
    }
    pub fn setKeepAlive(this: InternalSocket, enabled: bool, delay: u32) bool {
        switch (this) {
            .pipe, .upgradedDuplex, .connecting, .detached => return false,
            .connected => |socket| return socket.setKeepalive(enabled, delay) == 0,
        }
    }
    pub fn close(this: InternalSocket, code: us_socket_t.CloseCode) void {
        switch (this) {
            .detached => {},
            .connected => |socket| socket.close(code),
            .connecting => |socket| socket.close(),
            .upgradedDuplex => |socket| socket.close(),
            .pipe => |pipe| if (Environment.isWindows) pipe.close(),
        }
    }

    pub fn isClosed(this: InternalSocket) bool {
        return switch (this) {
            .connected => |socket| socket.isClosed(),
            .connecting => |socket| socket.isClosed(),
            .detached => true,
            .upgradedDuplex => |socket| socket.isClosed(),
            .pipe => |pipe| if (Environment.isWindows) pipe.isClosed() else true,
        };
    }

    pub fn get(this: @This()) ?*us_socket_t {
        return switch (this) {
            .connected => this.connected,
            .connecting, .detached, .upgradedDuplex, .pipe => null,
        };
    }

    pub fn eq(this: @This(), other: @This()) bool {
        return switch (this) {
            .connected => switch (other) {
                .connected => this.connected == other.connected,
                .upgradedDuplex, .connecting, .detached, .pipe => false,
            },
            .connecting => switch (other) {
                .upgradedDuplex, .connected, .detached, .pipe => false,
                .connecting => this.connecting == other.connecting,
            },
            .detached => switch (other) {
                .detached => true,
                .upgradedDuplex, .connected, .connecting, .pipe => false,
            },
            .upgradedDuplex => switch (other) {
                .upgradedDuplex => this.upgradedDuplex == other.upgradedDuplex,
                .connected, .connecting, .detached, .pipe => false,
            },
            .pipe => switch (other) {
                .pipe => if (Environment.isWindows) this.pipe == other.pipe else false,
                .connected, .connecting, .detached, .upgradedDuplex => false,
            },
        };
    }
};

/// TODO: rename to ConnectedSocket
pub const AnySocket = union(enum) {
    SocketTCP: SocketTCP,
    SocketTLS: SocketTLS,

    pub fn setTimeout(this: AnySocket, seconds: c_uint) void {
        switch (this) {
            .SocketTCP => this.SocketTCP.setTimeout(seconds),
            .SocketTLS => this.SocketTLS.setTimeout(seconds),
        }
    }

    pub fn shutdown(this: AnySocket) void {
        switch (this) {
            .SocketTCP => |sock| sock.shutdown(),
            .SocketTLS => |sock| sock.shutdown(),
        }
    }

    pub fn shutdownRead(this: AnySocket) void {
        switch (this) {
            .SocketTCP => |sock| sock.shutdownRead(),
            .SocketTLS => |sock| sock.shutdownRead(),
        }
    }

    pub fn isShutdown(this: AnySocket) bool {
        return switch (this) {
            .SocketTCP => this.SocketTCP.isShutdown(),
            .SocketTLS => this.SocketTLS.isShutdown(),
        };
    }
    pub fn isClosed(this: AnySocket) bool {
        return switch (this) {
            inline else => |s| s.isClosed(),
        };
    }
    pub fn close(this: AnySocket) void {
        switch (this) {
            inline else => |s| s.close(.normal),
        }
    }

    pub fn terminate(this: AnySocket) void {
        switch (this) {
            inline else => |s| s.close(.failure),
        }
    }

    pub fn write(this: AnySocket, data: []const u8) i32 {
        return switch (this) {
            .SocketTCP => |sock| sock.write(data),
            .SocketTLS => |sock| sock.write(data),
        };
    }

    pub fn getNativeHandle(this: AnySocket) ?*anyopaque {
        return switch (this.socket()) {
            .connected => |sock| sock.getNativeHandle(),
            else => null,
        };
    }

    pub fn localPort(this: AnySocket) i32 {
        switch (this) {
            .SocketTCP => |sock| sock.localPort(),
            .SocketTLS => |sock| sock.localPort(),
        }
    }

    pub fn isSSL(this: AnySocket) bool {
        return switch (this) {
            .SocketTCP => false,
            .SocketTLS => true,
        };
    }

    pub fn socket(this: AnySocket) InternalSocket {
        return switch (this) {
            .SocketTCP => this.SocketTCP.socket,
            .SocketTLS => this.SocketTLS.socket,
        };
    }

    pub fn ext(this: AnySocket, comptime ContextType: type) ?*ContextType {
        return switch (this) {
            inline else => |s| s.ext(ContextType),
        };
    }

    pub fn group(this: AnySocket) *SocketGroup {
        @setRuntimeSafety(true);
        return switch (this) {
            .SocketTCP => |sock| sock.group(),
            .SocketTLS => |sock| sock.group(),
        }.?;
    }
};

fn NativeSocketHandleType(comptime ssl: bool) type {
    if (ssl) {
        return BoringSSL.SSL;
    } else {
        return anyopaque;
    }
}

const debug = bun.Output.scoped(.uws, .visible);

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const BoringSSL = bun.BoringSSL.c;

const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const SocketGroup = uws.SocketGroup;
const SocketKind = uws.SocketKind;
const UpgradedDuplex = uws.UpgradedDuplex;
const WindowsNamedPipe = uws.WindowsNamedPipe;
const us_bun_verify_error_t = uws.us_bun_verify_error_t;
const us_socket_t = uws.us_socket_t;
