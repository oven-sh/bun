//! `to_js` bridges for the small `http_types/Fetch*` enums. The enum types
//! themselves stay in `http_types/`; only the JSC extern + wrapper live here
//! so `http_types/` has no `JSValue`/`JSGlobalObject` references.

use bun_http::{FetchCacheMode, FetchRedirect, FetchRequestMode};
use bun_jsc::{JSGlobalObject, JSValue};

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__FetchRedirect__toJS(v: u8, global: *mut JSGlobalObject) -> JSValue;
    fn Bun__FetchRequestMode__toJS(v: u8, global: *mut JSGlobalObject) -> JSValue;
    fn Bun__FetchCacheMode__toJS(v: u8, global: *mut JSGlobalObject) -> JSValue;
}

pub fn fetch_redirect_to_js(this: FetchRedirect, global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC bindings; `global` is a valid borrowed JSGlobalObject.
    unsafe { Bun__FetchRedirect__toJS(this as u8, global as *const _ as *mut _) }
}

pub fn fetch_request_mode_to_js(this: FetchRequestMode, global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC bindings; `global` is a valid borrowed JSGlobalObject.
    unsafe { Bun__FetchRequestMode__toJS(this as u8, global as *const _ as *mut _) }
}

pub fn fetch_cache_mode_to_js(this: FetchCacheMode, global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC bindings; `global` is a valid borrowed JSGlobalObject.
    unsafe { Bun__FetchCacheMode__toJS(this as u8, global as *const _ as *mut _) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/fetch_enums_jsc.zig (21 lines)
//   confidence: high
//   todos:      1
//   notes:      Fetch* enums imported via bun_http (Zig path); may need bun_http_types in Phase B
// ──────────────────────────────────────────────────────────────────────────
