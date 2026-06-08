use core::ptr::NonNull;

use bun_core::String;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

// The JSC-agnostic surface (constructors, getters, `destroy`, the
// whole-string conversions) lives in `bun_url::whatwg`; only the entry
// points that need `JSValue`/`JSGlobalObject` stay in this crate, as the
// `UrlJsc` extension trait.
pub use bun_url::whatwg::URL;

unsafe extern "C" {
    safe fn URL__fromJS(value: JSValue, global: &JSGlobalObject) -> *mut URL;
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
}

pub trait UrlJsc: Sized {
    /// This percent-encodes the URL, punycode-encodes the hostname, and returns the result.
    /// If it fails, the tag is marked Dead.
    fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String>;
    /// Returns an owned C++ heap pointer that the caller must `destroy()`.
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<NonNull<Self>>>;
}

impl UrlJsc for URL {
    #[track_caller]
    fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        crate::call_check_slow(global, || URL__getHrefFromJS(value, global))
    }

    #[track_caller]
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<NonNull<URL>>> {
        crate::call_check_slow(global, || URL__fromJS(value, global)).map(NonNull::new)
    }
}
