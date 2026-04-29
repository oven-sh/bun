//! Zig mirror of `struct us_socket_group_t`. Embedded by value in its owner
//! (Listener, VirtualMachine, uWS App, HTTPThread) — never heap-allocated on
//! its own. The loop links it lazily on first socket and unlinks on last, so
//! unused kinds cost nothing.
//!
//! `extern struct` so field order/padding match the C definition exactly — Zig
//! is free to reorder non-extern struct fields, and this is read/written
//! directly by C (loop.c walks `head_sockets`/`iterator`, context.c flips
//! `linked`).

pub const SocketGroup = extern struct {
    loop: ?*Loop = null,
    vtable: ?*const VTable = null,
    /// Embedding owner — typed access via `owner(T)`. `?*anyopaque` only
    /// because the C ABI slot is heterogenous (Listener / uWS App / RareData /
    /// null); never read this field directly.
    #ext: ?*anyopaque = null,
    head_sockets: ?*us_socket_t = null,
    head_connecting_sockets: ?*ConnectingSocket = null,
    head_listen_sockets: ?*uws.ListenSocket = null,
    iterator: ?*us_socket_t = null,
    prev: ?*SocketGroup = null,
    next: ?*SocketGroup = null,
    global_tick: u32 = 0,
    /// Sockets currently parked in `loop.data.low_prio_head` with
    /// `s->group == this`. They are NOT in `head_sockets` while queued, so
    /// `closeAll`/`deinit` must account for them separately.
    low_prio_count: u16 = 0,
    timestamp: u8 = 0,
    long_timestamp: u8 = 0,
    linked: u8 = 0,

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
        // Must match `struct us_socket_group_t` in libusockets.h.
        // 9 ptrs + u32 + u16 + 3×u8, padded to 8-byte alignment.
        if (@sizeOf(SocketGroup) != 9 * @sizeOf(*anyopaque) + 16)
            @compileError("SocketGroup layout drifted from us_socket_group_t");
        if (@sizeOf(VTable) != 12 * @sizeOf(*anyopaque))
            @compileError("VTable layout drifted from us_socket_vtable_t");
    }

    /// Initialise an embedded group. `owner_ptr` (any single-item pointer or
    /// `null`) is what `group.owner(T)` recovers inside handlers — pass the
    /// embedding struct so dispatch can find it from a raw `*us_socket_t`.
    pub fn init(self: *SocketGroup, loop_: *Loop, vt: ?*const VTable, owner_ptr: anytype) void {
        const P = @TypeOf(owner_ptr);
        const erased: ?*anyopaque = if (P == @TypeOf(null)) null else switch (@typeInfo(P)) {
            .pointer => |p| if (p.size == .one) @ptrCast(@constCast(owner_ptr)) else @compileError("SocketGroup.init owner must be a single-item pointer"),
            .optional => if (owner_ptr) |o| @ptrCast(@constCast(o)) else null,
            else => @compileError("SocketGroup.init owner must be a pointer or null"),
        };
        c.us_socket_group_init(self, loop_, vt, erased);
    }

    pub fn deinit(self: *SocketGroup) void {
        c.us_socket_group_deinit(self);
    }

    pub fn closeAll(self: *SocketGroup) void {
        c.us_socket_group_close_all(self);
    }

    /// Non-null after `init`. The fields stay `?*T` only because the struct is
    /// zero-init'd by default and read directly by C; these accessors encode
    /// the post-init invariant.
    pub fn getLoop(self: *const SocketGroup) *Loop {
        return self.loop.?;
    }

    /// Recover the embedding owner. Only valid for groups whose `init` passed a
    /// non-null owner (Listener, uWS App/Context). Per-kind VM groups in
    /// `RareData` pass `null`, so callers must know which they have.
    pub fn owner(self: *const SocketGroup, comptime T: type) *T {
        return @ptrCast(@alignCast(self.#ext.?));
    }

    pub fn isEmpty(self: *const SocketGroup) bool {
        return self.head_sockets == null and
            self.head_connecting_sockets == null and
            self.head_listen_sockets == null and
            self.low_prio_count == 0;
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
        // context.c writes 1 here on the synchronous path (DNS already resolved
        // → real `us_socket_t*` returned), 0 when it hands back a
        // `us_connecting_socket_t*` placeholder. Named to match the C side so
        // the branches read the right way round — see PR review #3161005603.
        var has_dns_resolved: c_int = 0;
        const ptr = c.us_socket_group_connect(self, @intFromEnum(kind), ssl_ctx, host, port, options, socket_ext_size, &has_dns_resolved) orelse return .failed;
        return if (has_dns_resolved != 0)
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

    pub fn pair(self: *SocketGroup, kind: SocketKind, ext_size: c_int, fds: *[2]uws.LIBUS_SOCKET_DESCRIPTOR) ?*us_socket_t {
        return c.us_socket_pair(self, @intFromEnum(kind), ext_size, fds);
    }

    pub fn nextInLoop(self: *SocketGroup) ?*SocketGroup {
        return c.us_socket_group_next(self);
    }
};

const c = struct {
    extern fn us_socket_group_init(*SocketGroup, *Loop, ?*const SocketGroup.VTable, ?*anyopaque) void;
    extern fn us_socket_group_deinit(*SocketGroup) void;
    extern fn us_socket_group_close_all(*SocketGroup) void;
    extern fn us_socket_group_timestamp(*SocketGroup) c_ushort;
    extern fn us_socket_group_loop(*SocketGroup) *Loop;
    extern fn us_socket_group_next(*SocketGroup) ?*SocketGroup;
    extern fn us_socket_group_listen(*SocketGroup, u8, ?*SslCtx, ?[*:0]const u8, c_int, c_int, c_int, *c_int) ?*uws.ListenSocket;
    extern fn us_socket_group_listen_unix(*SocketGroup, u8, ?*SslCtx, [*]const u8, usize, c_int, c_int, *c_int) ?*uws.ListenSocket;
    /// Returns `us_socket_t*` (fast path) OR `us_connecting_socket_t*` (slow
    /// path), discriminated by `*is_connecting`. The public `connect()` method
    /// turns this into the typed `ConnectResult` union — call that, not this.
    extern fn us_socket_group_connect(*SocketGroup, u8, ?*SslCtx, [*:0]const u8, c_int, c_int, c_int, *c_int) ?*anyopaque;
    extern fn us_socket_group_connect_unix(*SocketGroup, u8, ?*SslCtx, [*]const u8, usize, c_int, c_int) ?*us_socket_t;
    extern fn us_socket_from_fd(*SocketGroup, u8, ?*SslCtx, c_int, uws.LIBUS_SOCKET_DESCRIPTOR, c_int) ?*us_socket_t;
    extern fn us_socket_pair(*SocketGroup, u8, c_int, *[2]uws.LIBUS_SOCKET_DESCRIPTOR) ?*us_socket_t;
};

const bun = @import("bun");

const uws = bun.uws;
const ConnectingSocket = uws.ConnectingSocket;
const Loop = uws.Loop;
const SocketKind = uws.SocketKind;
const SslCtx = uws.SslCtx;
const us_socket_t = uws.us_socket_t;
