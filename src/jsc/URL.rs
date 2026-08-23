use core::ptr::NonNull;

use bun_core::String;
pub use bun_url::whatwg::URL;

use crate::{JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    safe fn URL__fromJS(value: JSValue, global: &JSGlobalObject) -> *mut URL;
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
}

/// JS-value entry points for [`URL`]; the rest of the API lives on
/// `bun_url::whatwg::URL`.
pub trait URLJsc {
    /// Percent-encodes the URL, punycode-encodes the hostname, and returns the
    /// result. If it fails, the tag is marked Dead.
    #[track_caller]
    fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        crate::call_check_slow(global, || URL__getHrefFromJS(value, global))
    }

    /// Returns an owned C++ heap pointer the caller must [`URL::destroy`].
    #[track_caller]
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<NonNull<URL>>> {
        crate::call_check_slow(global, || URL__fromJS(value, global)).map(NonNull::new)
    }
}

impl URLJsc for URL {}
