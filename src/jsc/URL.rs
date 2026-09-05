use core::ptr::NonNull;

use bun_core::String;
pub use bun_url::whatwg::{Parsed, URL};

use crate::{JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    safe fn URL__fromJS(value: JSValue, global: &JSGlobalObject) -> *mut URL;
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
    safe fn Bun__fileURLToPath(global: &JSGlobalObject, value: JSValue) -> String;
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

    /// `Bun.fileURLToPath()`: throws Node's errors for anything that is not a
    /// plain `file:` URL, where `bun_url::path_from_file_url` converts blindly.
    #[track_caller]
    fn file_url_to_path_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        crate::call_check_slow(global, || Bun__fileURLToPath(global, value))
    }

    #[track_caller]
    fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Parsed>> {
        crate::call_check_slow(global, || URL__fromJS(value, global))
            // SAFETY: `URL__fromJS` returns a fresh heap `WTF::URL` (or null).
            .map(|p| NonNull::new(p).map(|p| unsafe { Parsed::from_raw(p) }))
    }
}

impl URLJsc for URL {}
