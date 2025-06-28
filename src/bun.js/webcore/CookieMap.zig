const bun = @import("bun");

pub const CookieMap = opaque {
    extern fn CookieMap__write(cookie_map: *CookieMap, global_this: *bun.JSC.JSGlobalObject, ssl_enabled: bool, uws_http_response: *anyopaque) void;
    pub const write = CookieMap__write;
    extern fn CookieMap__deref(cookie_map: *CookieMap) void;
    pub const deref = CookieMap__deref;
    extern fn CookieMap__ref(cookie_map: *CookieMap) void;
    pub const ref = CookieMap__ref;
};
