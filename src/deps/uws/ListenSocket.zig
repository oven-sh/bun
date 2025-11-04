pub const ListenSocket = opaque {
    pub fn close(this: *ListenSocket, ssl: bool) void {
        c.us_listen_socket_close(@intFromBool(ssl), this);
    }
    pub fn getLocalAddress(this: *ListenSocket, ssl: bool, buf: []u8) ![]const u8 {
        return this.getSocket().localAddress(ssl, buf);
    }
    pub fn getLocalPort(this: *ListenSocket, ssl: bool) i32 {
        return this.getSocket().localPort(ssl);
    }
    pub fn getSocket(this: *ListenSocket) *uws.us_socket_t {
        return @ptrCast(this);
    }
};

const c = struct {
    pub extern fn us_listen_socket_close(ssl: i32, ls: *ListenSocket) void;
};

const bun = @import("bun");
const uws = bun.uws;
