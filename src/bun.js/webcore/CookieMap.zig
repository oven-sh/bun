pub const CookieMap = opaque {
    extern fn CookieMap__write(cookie_map: *CookieMap, global_this: *bun.jsc.JSGlobalObject, kind: i32, uws_http_response: *anyopaque) void;

    /// kind: 0=TCP, 1=SSL, 2=H3.
    pub fn write(cookie_map: *CookieMap, globalThis: *bun.jsc.JSGlobalObject, kind: i32, uws_http_response: *anyopaque) bun.JSError!void {
        return bun.jsc.fromJSHostCallGeneric(globalThis, @src(), CookieMap__write, .{ cookie_map, globalThis, kind, uws_http_response });
    }

    extern fn CookieMap__deref(cookie_map: *CookieMap) void;

    pub const deref = CookieMap__deref;

    extern fn CookieMap__ref(cookie_map: *CookieMap) void;

    pub const ref = CookieMap__ref;
};

const bun = @import("bun");
