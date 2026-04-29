//! Zig mirror of `struct us_socket_group_t`. Embedded by value in its owner
//! (Listener, VirtualMachine, uWS App, HTTPThread) — never heap-allocated on
//! its own. The loop links it lazily on first socket and unlinks on last, so
//! unused kinds cost nothing.
const SocketGroup = @This();

loop: ?*Loop = null,
vtable: ?*const VTable = null,
ext: ?*anyopaque = null,
head_sockets: ?*us_socket_t = null,
head_connecting_sockets: ?*ConnectingSocket = null,
iterator: ?*us_socket_t = null,
prev: ?*SocketGroup = null,
next: ?*SocketGroup = null,
global_tick: u32 = 0,
timestamp: u8 = 0,
long_timestamp: u8 = 0,
linked: u8 = 0,
// (1 byte tail padding to 8-byte alignment)

pub const VTable = extern struct {
    on_open: ?*const fn (*us_socket_t, c_int, [*c]u8, c_int) callconv(.c) ?*us_socket_t = null,
    on_data: ?*const fn (*us_socket_t, [*c]u8, c_int) callconv(.c) ?*us_socket_t = null,
    on_fd: ?*const fn (*us_socket_t, c_int) callconv(.c) ?*us_socket_t = null,
    on_writable: ?*const fn (*us_socket_t) callconv(.c) ?*us_socket_t = null,
    on_close: ?*const fn (*us_socket_t, c_int, ?*anyopaque) callconv(.c) ?*us_socket_t = null,
    on_timeout: ?*const fn (*us_socket_t) callconv(.c) ?*us_socket_t = null,
    on_long_timeout: ?*const fn (*us_socket_t) callconv(.c) ?*us_socket_t = null,
    on_end: ?*const fn (*us_socket_t) callconv(.c) ?*us_socket_t = null,
    on_connect_error: ?*const fn (*us_socket_t, c_int) callconv(.c) ?*us_socket_t = null,
    on_connecting_error: ?*const fn (*ConnectingSocket, c_int) callconv(.c) ?*ConnectingSocket = null,
    on_handshake: ?*const fn (*us_socket_t, c_int, uws.us_bun_verify_error_t, ?*anyopaque) callconv(.c) void = null,
    is_low_prio: ?*const fn (*us_socket_t) callconv(.c) c_int = null,
};

comptime {
    // Must match `struct us_socket_group_t` in libusockets.h. 8 ptrs + u32 + 3×u8.
    if (@sizeOf(SocketGroup) != 8 * @sizeOf(*anyopaque) + 8)
        @compileError("SocketGroup layout drifted from us_socket_group_t");
    if (@sizeOf(VTable) != 12 * @sizeOf(*anyopaque))
        @compileError("VTable layout drifted from us_socket_vtable_t");
}

/// Initialise an embedded group. `Ext` is the owner type recovered by
/// `group.owner(Ext)` inside handlers.
pub fn init(self: *SocketGroup, loop: *Loop, vt: ?*const VTable, owner_ptr: ?*anyopaque) void {
    c.us_socket_group_init(self, loop, vt, owner_ptr);
}

pub fn deinit(self: *SocketGroup) void {
    c.us_socket_group_deinit(self);
}

pub fn closeAll(self: *SocketGroup) void {
    c.us_socket_group_close_all(self);
}

pub fn owner(self: *const SocketGroup, comptime T: type) *T {
    return @ptrCast(@alignCast(self.ext.?));
}

pub fn isEmpty(self: *const SocketGroup) bool {
    return self.head_sockets == null and self.head_connecting_sockets == null;
}

pub fn listen(
    self: *SocketGroup,
    kind: SocketKind,
    ssl_ctx: ?*SslCtx,
    host: ?[*:0]const u8,
    port: c_int,
    options: c_int,
    socket_ext_size: c_int,
    err: *c_int,
) ?*uws.ListenSocket {
    return c.us_socket_group_listen(self, @intFromEnum(kind), ssl_ctx, host, port, options, socket_ext_size, err);
}

pub fn listenUnix(
    self: *SocketGroup,
    kind: SocketKind,
    ssl_ctx: ?*SslCtx,
    path: [*]const u8,
    pathlen: usize,
    options: c_int,
    socket_ext_size: c_int,
    err: *c_int,
) ?*uws.ListenSocket {
    return c.us_socket_group_listen_unix(self, @intFromEnum(kind), ssl_ctx, path, pathlen, options, socket_ext_size, err);
}

pub const ConnectResult = union(enum) {
    socket: *us_socket_t,
    connecting: *ConnectingSocket,
    failed,
};

pub fn connect(
    self: *SocketGroup,
    kind: SocketKind,
    ssl_ctx: ?*SslCtx,
    host: [*:0]const u8,
    port: c_int,
    options: c_int,
    socket_ext_size: c_int,
) ConnectResult {
    var is_connecting: c_int = 0;
    const ptr = c.us_socket_group_connect(self, @intFromEnum(kind), ssl_ctx, host, port, options, socket_ext_size, &is_connecting) orelse return .failed;
    return if (is_connecting != 0)
        .{ .socket = @ptrCast(@alignCast(ptr)) }
    else
        .{ .connecting = @ptrCast(@alignCast(ptr)) };
}

pub fn connectUnix(
    self: *SocketGroup,
    kind: SocketKind,
    ssl_ctx: ?*SslCtx,
    path: [*]const u8,
    pathlen: usize,
    options: c_int,
    socket_ext_size: c_int,
) ?*us_socket_t {
    return c.us_socket_group_connect_unix(self, @intFromEnum(kind), ssl_ctx, path, pathlen, options, socket_ext_size);
}

pub fn fromFd(
    self: *SocketGroup,
    kind: SocketKind,
    ssl_ctx: ?*SslCtx,
    socket_ext_size: c_int,
    fd: uws.LIBUS_SOCKET_DESCRIPTOR,
    ipc: bool,
) ?*us_socket_t {
    return c.us_socket_from_fd(self, @intFromEnum(kind), ssl_ctx, socket_ext_size, fd, @intFromBool(ipc));
}

pub const c = struct {
    pub extern fn us_socket_group_init(*SocketGroup, *Loop, ?*const VTable, ?*anyopaque) void;
    pub extern fn us_socket_group_deinit(*SocketGroup) void;
    pub extern fn us_socket_group_close_all(*SocketGroup) void;
    pub extern fn us_socket_group_timestamp(*SocketGroup) c_ushort;
    pub extern fn us_socket_group_loop(*SocketGroup) *Loop;
    pub extern fn us_socket_group_ext(*SocketGroup) ?*anyopaque;
    pub extern fn us_socket_group_next(*SocketGroup) ?*SocketGroup;
    pub extern fn us_socket_group_listen(*SocketGroup, u8, ?*anyopaque, ?[*:0]const u8, c_int, c_int, c_int, *c_int) ?*uws.ListenSocket;
    pub extern fn us_socket_group_listen_unix(*SocketGroup, u8, ?*anyopaque, [*]const u8, usize, c_int, c_int, *c_int) ?*uws.ListenSocket;
    pub extern fn us_socket_group_connect(*SocketGroup, u8, ?*anyopaque, [*:0]const u8, c_int, c_int, c_int, *c_int) ?*anyopaque;
    pub extern fn us_socket_group_connect_unix(*SocketGroup, u8, ?*anyopaque, [*]const u8, usize, c_int, c_int) ?*us_socket_t;
    pub extern fn us_socket_from_fd(*SocketGroup, u8, ?*anyopaque, c_int, uws.LIBUS_SOCKET_DESCRIPTOR, c_int) ?*us_socket_t;
    pub extern fn us_socket_pair(*SocketGroup, u8, c_int, *[2]uws.LIBUS_SOCKET_DESCRIPTOR) ?*us_socket_t;
};

const bun = @import("bun");
const uws = bun.uws;
const Loop = uws.Loop;
const us_socket_t = uws.us_socket_t;
const ConnectingSocket = uws.ConnectingSocket;
const SocketKind = uws.SocketKind;
const SslCtx = uws.SslCtx;
