//! A generic wrapper for the HTTP(s) Server`RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.
const AnyRequestContext = @This();

pub const Pointer = bun.TaggedPointerUnion(.{
    HTTPServer.RequestContext,
    HTTPSServer.RequestContext,
    DebugHTTPServer.RequestContext,
    DebugHTTPSServer.RequestContext,
});

tagged_pointer: Pointer,

pub const Null: @This() = .{ .tagged_pointer = Pointer.Null };

pub fn init(request_ctx: anytype) AnyRequestContext {
    return .{ .tagged_pointer = Pointer.init(request_ctx) };
}

pub fn memoryCost(self: AnyRequestContext) usize {
    if (self.tagged_pointer.isNull()) {
        return 0;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPServer.RequestContext).memoryCost();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPSServer.RequestContext).memoryCost();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPServer.RequestContext).memoryCost();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).memoryCost();
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

pub fn get(self: AnyRequestContext, comptime T: type) ?*T {
    return self.tagged_pointer.get(T);
}

pub fn setTimeout(self: AnyRequestContext, seconds: c_uint) bool {
    if (self.tagged_pointer.isNull()) {
        return false;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPServer.RequestContext).setTimeout(seconds);
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPSServer.RequestContext).setTimeout(seconds);
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPServer.RequestContext).setTimeout(seconds);
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).setTimeout(seconds);
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
    return false;
}

pub fn setCookies(self: AnyRequestContext, cookie_map: ?*JSC.WebCore.CookieMap) void {
    if (self.tagged_pointer.isNull()) {
        return;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPServer.RequestContext).setCookies(cookie_map);
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPSServer.RequestContext).setCookies(cookie_map);
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPServer.RequestContext).setCookies(cookie_map);
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).setCookies(cookie_map);
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

pub fn enableTimeoutEvents(self: AnyRequestContext) void {
    if (self.tagged_pointer.isNull()) {
        return;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPServer.RequestContext).setTimeoutHandler();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPSServer.RequestContext).setTimeoutHandler();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPServer.RequestContext).setTimeoutHandler();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).setTimeoutHandler();
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

pub fn getRemoteSocketInfo(self: AnyRequestContext) ?uws.SocketAddress {
    if (self.tagged_pointer.isNull()) {
        return null;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPServer.RequestContext).getRemoteSocketInfo();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPSServer.RequestContext).getRemoteSocketInfo();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPServer.RequestContext).getRemoteSocketInfo();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).getRemoteSocketInfo();
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

pub fn detachRequest(self: AnyRequestContext) void {
    if (self.tagged_pointer.isNull()) {
        return;
    }
    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            self.tagged_pointer.as(HTTPServer.RequestContext).req = null;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            self.tagged_pointer.as(HTTPSServer.RequestContext).req = null;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            self.tagged_pointer.as(DebugHTTPServer.RequestContext).req = null;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            self.tagged_pointer.as(DebugHTTPSServer.RequestContext).req = null;
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

/// Wont actually set anything if `self` is `.none`
pub fn setRequest(self: AnyRequestContext, req: *uws.Request) void {
    if (self.tagged_pointer.isNull()) {
        return;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            self.tagged_pointer.as(HTTPServer.RequestContext).req = req;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            self.tagged_pointer.as(HTTPSServer.RequestContext).req = req;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            self.tagged_pointer.as(DebugHTTPServer.RequestContext).req = req;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            self.tagged_pointer.as(DebugHTTPSServer.RequestContext).req = req;
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

pub fn getRequest(self: AnyRequestContext) ?*uws.Request {
    if (self.tagged_pointer.isNull()) {
        return null;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPServer.RequestContext).req;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(HTTPSServer.RequestContext).req;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPServer.RequestContext).req;
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            return self.tagged_pointer.as(DebugHTTPSServer.RequestContext).req;
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

pub fn deref(self: AnyRequestContext) void {
    if (self.tagged_pointer.isNull()) {
        return;
    }

    switch (self.tagged_pointer.tag()) {
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPServer.RequestContext))) => {
            self.tagged_pointer.as(HTTPServer.RequestContext).deref();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(HTTPSServer.RequestContext))) => {
            self.tagged_pointer.as(HTTPSServer.RequestContext).deref();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPServer.RequestContext))) => {
            self.tagged_pointer.as(DebugHTTPServer.RequestContext).deref();
        },
        @field(Pointer.Tag, bun.meta.typeBaseName(@typeName(DebugHTTPSServer.RequestContext))) => {
            self.tagged_pointer.as(DebugHTTPSServer.RequestContext).deref();
        },
        else => @panic("Unexpected AnyRequestContext tag"),
    }
}

const bun = @import("bun");
const JSC = bun.JSC;
const uws = bun.uws;
const HTTPServer = @import("../server.zig").HTTPServer;
const HTTPSServer = @import("../server.zig").HTTPSServer;
const DebugHTTPServer = @import("../server.zig").DebugHTTPServer;
const DebugHTTPSServer = @import("../server.zig").DebugHTTPSServer;
