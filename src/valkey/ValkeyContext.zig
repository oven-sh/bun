tcp: ?*uws.SocketContext = null,
unix: ?*uws.SocketContext = null,
tls: ?*uws.SocketContext = null,
tls_unix: ?*uws.SocketContext = null,

pub fn deinit(this: *@This()) void {
    if (this.tcp) |ctx| {
        this.tcp = null;
        ctx.deinit(false);
    }
    if (this.unix) |ctx| {
        this.unix = null;
        ctx.deinit(false);
    }
    if (this.tls) |ctx| {
        this.tls = null;
        ctx.deinit(true);
    }
    if (this.tls_unix) |ctx| {
        this.tls_unix = null;
        ctx.deinit(true);
    }
}

const bun = @import("bun");
const uws = bun.uws;
