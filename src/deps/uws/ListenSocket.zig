pub const ListenSocket = opaque {
    pub fn close(this: *ListenSocket) void {
        c.us_listen_socket_close(this);
    }
    pub fn getLocalAddress(this: *ListenSocket, buf: []u8) ![]const u8 {
        return this.getSocket().localAddress(buf);
    }
    pub fn getLocalPort(this: *ListenSocket) i32 {
        return this.getSocket().localPort();
    }
    pub fn getSocket(this: *ListenSocket) *uws.us_socket_t {
        return @ptrCast(this);
    }
    pub fn socket(this: *ListenSocket, comptime is_ssl: bool) uws.NewSocketHandler(is_ssl) {
        return uws.NewSocketHandler(is_ssl).from(this.getSocket());
    }

    /// Group accepted sockets are linked into.
    pub fn group(this: *ListenSocket) *SocketGroup {
        return c.us_listen_socket_group(this);
    }

    pub fn ext(this: *ListenSocket, comptime T: type) *T {
        return @ptrCast(@alignCast(c.us_listen_socket_ext(this)));
    }

    pub fn fd(this: *ListenSocket) bun.FD {
        return .fromNative(c.us_listen_socket_get_fd(this));
    }

    /// `ssl_ctx` is up-ref'd via `us_ssl_ctx_t.ref_count`; the listener owns
    /// one ref until close. NOT a raw `SSL_CTX*` — the C side reads policy
    /// fields off the wrapper.
    pub fn addServerName(this: *ListenSocket, hostname: [*:0]const u8, ssl_ctx: *uws.SslCtx, user: ?*anyopaque) bool {
        return c.us_listen_socket_add_server_name(this, hostname, ssl_ctx, user) == 0;
    }

    pub fn removeServerName(this: *ListenSocket, hostname: [*:0]const u8) void {
        c.us_listen_socket_remove_server_name(this, hostname);
    }

    pub fn findServerNameUserdata(this: *ListenSocket, hostname: [*:0]const u8) ?*anyopaque {
        return c.us_listen_socket_find_server_name_userdata(this, hostname);
    }

    pub fn onServerName(this: *ListenSocket, cb: *const fn (*ListenSocket, [*:0]const u8) callconv(.c) void) void {
        c.us_listen_socket_on_server_name(this, cb);
    }
};

const c = struct {
    pub extern fn us_listen_socket_close(ls: *ListenSocket) void;
    pub extern fn us_listen_socket_group(ls: *ListenSocket) *SocketGroup;
    pub extern fn us_listen_socket_ext(ls: *ListenSocket) ?*anyopaque;
    pub extern fn us_listen_socket_get_fd(ls: *ListenSocket) uws.LIBUS_SOCKET_DESCRIPTOR;
    pub extern fn us_listen_socket_port(ls: *ListenSocket) c_int;
    pub extern fn us_listen_socket_add_server_name(ls: *ListenSocket, hostname: [*:0]const u8, ssl_ctx: ?*anyopaque, user: ?*anyopaque) c_int;
    pub extern fn us_listen_socket_remove_server_name(ls: *ListenSocket, hostname: [*:0]const u8) void;
    pub extern fn us_listen_socket_find_server_name_userdata(ls: *ListenSocket, hostname: [*:0]const u8) ?*anyopaque;
    pub extern fn us_listen_socket_on_server_name(ls: *ListenSocket, cb: *const fn (*ListenSocket, [*:0]const u8) callconv(.c) void) void;
};

const bun = @import("bun");

const uws = bun.uws;
const SocketGroup = uws.SocketGroup;
