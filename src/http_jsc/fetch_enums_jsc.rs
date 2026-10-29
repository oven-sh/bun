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
    // SAFETY: the enums are `#[repr(u8)]` with the values of their C++
    // `enum class : uint8_t` twins; `JSGlobalObject` is an opaque `UnsafeCell`-backed
    // handle, so the C++ side's lazy init of a common string is invisible to Rust.
    safe fn Bun__FetchRedirect__toJS(v: FetchRedirect, global: &JSGlobalObject) -> JSValue;
    safe fn Bun__FetchRequestMode__toJS(v: FetchRequestMode, global: &JSGlobalObject) -> JSValue;
    safe fn Bun__FetchCacheMode__toJS(v: FetchCacheMode, global: &JSGlobalObject) -> JSValue;
}

pub fn fetch_redirect_to_js(this: FetchRedirect, global: &JSGlobalObject) -> JSValue {
    Bun__FetchRedirect__toJS(this, global)
}

pub fn fetch_request_mode_to_js(this: FetchRequestMode, global: &JSGlobalObject) -> JSValue {
    Bun__FetchRequestMode__toJS(this, global)
}

pub fn fetch_cache_mode_to_js(this: FetchCacheMode, global: &JSGlobalObject) -> JSValue {
    Bun__FetchCacheMode__toJS(this, global)
}
