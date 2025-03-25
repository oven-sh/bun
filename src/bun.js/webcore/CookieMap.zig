const std = @import("std");
const bun = @import("root").bun;

pub const CookieMap = opaque {
    extern fn CookieMap__write(cookie_map: *CookieMap, global_this: *bun.JSC.JSGlobalObject, ssl_enabled: bool, uws_http_response: *anyopaque) void;
    pub const write = CookieMap__write;
    extern fn CookieMap__deref(cookie_map: *CookieMap) void;
    pub const deref = CookieMap__deref;
    extern fn CookieMap__ref(cookie_map: *CookieMap) void;
    pub const ref = CookieMap__ref;
};

const CookieMap2 = struct {
    original_cookies_buf: std.ArrayListUnmanaged(u8),
    original_cookies: std.ArrayHashMapUnmanaged(struct { offset: u32, len: u32 }, struct { offset: u32, len: u32 }, struct {}, std.hash_map.default_max_load_percentage),
    modified_cookies: std.StringHashMap(std.Cookie),
};
