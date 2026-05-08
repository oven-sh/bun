//! `to_js` bridges for the small `http_types/Fetch*` enums. The enum types
//! themselves stay in `http_types/`; only the JSC extern + wrapper live here
//! so `http_types/` has no `JSValue`/`JSGlobalObject` references.
//!
//! The reverse direction (`FromJsEnum` impls powering
//! `JSValue::get_optional_enum::<FetchRedirect>()` etc.) lives in `bun_jsc`
//! itself — orphan rules require the impl in either the trait crate or the
//! type crate, and `bun_http_types` is jsc-free.

use bun_http_types::FetchCacheMode::FetchCacheMode;
use bun_http_types::FetchRedirect::FetchRedirect;
use bun_http_types::FetchRequestMode::FetchRequestMode;
use bun_jsc::{JSGlobalObject, JSValue};

unsafe extern "C" {
    fn Bun__FetchRedirect__toJS(v: u8, global: *mut JSGlobalObject) -> JSValue;
    fn Bun__FetchRequestMode__toJS(v: u8, global: *mut JSGlobalObject) -> JSValue;
    fn Bun__FetchCacheMode__toJS(v: u8, global: *mut JSGlobalObject) -> JSValue;
}

pub fn fetch_redirect_to_js(this: FetchRedirect, global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC bindings; `global` is a valid borrowed JSGlobalObject.
    // `as_mut_ptr` routes through `UnsafeCell::get` so the `*mut` carries write
    // provenance even though we hold `&JSGlobalObject` (the C++ side allocates).
    unsafe { Bun__FetchRedirect__toJS(this as u8, global.as_mut_ptr()) }
}

pub fn fetch_request_mode_to_js(this: FetchRequestMode, global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC bindings; `global` is a valid borrowed JSGlobalObject.
    // `as_mut_ptr` routes through `UnsafeCell::get` for sound interior mutability.
    unsafe { Bun__FetchRequestMode__toJS(this as u8, global.as_mut_ptr()) }
}

pub fn fetch_cache_mode_to_js(this: FetchCacheMode, global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into JSC bindings; `global` is a valid borrowed JSGlobalObject.
    // `as_mut_ptr` routes through `UnsafeCell::get` for sound interior mutability.
    unsafe { Bun__FetchCacheMode__toJS(this as u8, global.as_mut_ptr()) }
}

// ported from: src/http_jsc/fetch_enums_jsc.zig
