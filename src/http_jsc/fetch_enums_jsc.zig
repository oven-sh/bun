//! `toJS` bridges for the small `http_types/Fetch*` enums. The enum types
//! themselves stay in `http_types/`; only the JSC extern + wrapper live here
//! so `http_types/` has no `JSValue`/`JSGlobalObject` references.

extern "c" fn Bun__FetchRedirect__toJS(v: u8, global: *jsc.JSGlobalObject) jsc.JSValue;
pub fn fetchRedirectToJS(this: bun.http.FetchRedirect, global: *jsc.JSGlobalObject) jsc.JSValue {
    return Bun__FetchRedirect__toJS(@intFromEnum(this), global);
}

extern "c" fn Bun__FetchRequestMode__toJS(v: u8, global: *jsc.JSGlobalObject) jsc.JSValue;
pub fn fetchRequestModeToJS(this: bun.http.FetchRequestMode, global: *jsc.JSGlobalObject) jsc.JSValue {
    return Bun__FetchRequestMode__toJS(@intFromEnum(this), global);
}

extern "c" fn Bun__FetchCacheMode__toJS(v: u8, global: *jsc.JSGlobalObject) jsc.JSValue;
pub fn fetchCacheModeToJS(this: bun.http.FetchCacheMode, global: *jsc.JSGlobalObject) jsc.JSValue {
    return Bun__FetchCacheMode__toJS(@intFromEnum(this), global);
}

const bun = @import("bun");
const jsc = bun.jsc;
