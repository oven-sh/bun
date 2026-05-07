//! `to_js` bridges for the small `http_types/Fetch*` enums. The enum types
//! themselves stay in `http_types/`; only the JSC extern + wrapper live here
//! so `http_types/` has no `JSValue`/`JSGlobalObject` references.

use bun_http_types::FetchCacheMode::FetchCacheMode;
use bun_http_types::FetchRedirect::FetchRedirect;
use bun_http_types::FetchRequestMode::FetchRequestMode;
use bun_jsc::{FromJsEnum, JSGlobalObject, JSValue, JsResult};

// TODO(port): move to <area>_sys
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

// ── FromJsEnum impls (Zig: `JSValue.toEnum` → `Enum.Map.fromJS`) ───────────
// These live here (not in `http_types/`) because `FromJsEnum` names `JSValue`
// / `JSGlobalObject`. Each impl mirrors `JSValue.toEnumFromMap` (JSValue.zig:1703):
// non-string → "<prop> must be a string"; unknown string → "<prop> must be one of …".

impl FromJsEnum for FetchRedirect {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, prop: &'static str) -> JsResult<Self> {
        if !v.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("{prop} must be a string")));
        }
        match bun_http_types::FetchRedirect::MAP.from_js(global, v)? {
            Some(e) => Ok(e),
            None => Err(global.throw_invalid_arguments(format_args!(
                "{prop} must be one of 'follow', 'manual' or 'error'"
            ))),
        }
    }
}

impl FromJsEnum for FetchCacheMode {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, prop: &'static str) -> JsResult<Self> {
        if !v.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("{prop} must be a string")));
        }
        match FetchCacheMode::MAP.from_js(global, v)? {
            Some(e) => Ok(e),
            None => Err(global.throw_invalid_arguments(format_args!(
                "{prop} must be one of 'default', 'no-store', 'reload', 'no-cache', 'force-cache' or 'only-if-cached'"
            ))),
        }
    }
}

impl FromJsEnum for FetchRequestMode {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, prop: &'static str) -> JsResult<Self> {
        if !v.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("{prop} must be a string")));
        }
        match FetchRequestMode::MAP.from_js(global, v)? {
            Some(e) => Ok(e),
            None => Err(global.throw_invalid_arguments(format_args!(
                "{prop} must be one of 'same-origin', 'no-cors', 'cors' or 'navigate'"
            ))),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `FromJsEnum` impls — orphan-rule home for `bun_http_types` enums × `bun_jsc`
// trait. Powers `JSValue::get_optional_enum::<FetchRedirect>()` etc. in
// `Request::construct_into` and `fetch.rs`.
// ──────────────────────────────────────────────────────────────────────────

impl FromJsEnum for FetchRedirect {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, property_name: &'static str) -> JsResult<Self> {
        v.to_enum_from_map(
            global,
            property_name,
            &bun_http_types::FetchRedirect::MAP,
            "\"follow\", \"manual\", \"error\"",
        )
    }
}

impl FromJsEnum for FetchCacheMode {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, property_name: &'static str) -> JsResult<Self> {
        v.to_enum_from_map(
            global,
            property_name,
            &FetchCacheMode::MAP,
            "\"default\", \"no-store\", \"reload\", \"no-cache\", \"force-cache\", \"only-if-cached\"",
        )
    }
}

impl FromJsEnum for FetchRequestMode {
    fn from_js_value(v: JSValue, global: &JSGlobalObject, property_name: &'static str) -> JsResult<Self> {
        v.to_enum_from_map(
            global,
            property_name,
            &FetchRequestMode::MAP,
            "\"same-origin\", \"no-cors\", \"cors\", \"navigate\"",
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_jsc/fetch_enums_jsc.zig (21 lines)
//   confidence: high
//   todos:      1
//   notes:      Fetch* enums imported via bun_http (Zig path); may need bun_http_types in Phase B
// ──────────────────────────────────────────────────────────────────────────
