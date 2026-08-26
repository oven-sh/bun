use bun_core::String;
pub use bun_url::whatwg::{Parsed, URL};

use crate::{JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
}

/// JS-value entry point for [`URL`]; the rest of the API lives on
/// `bun_url::whatwg::URL`.
pub trait URLJsc {
    /// Percent-encodes the URL, punycode-encodes the hostname, and returns the
    /// result. If it fails, the tag is marked Dead.
    #[track_caller]
    fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        crate::call_check_slow(global, || URL__getHrefFromJS(value, global))
    }
}

impl URLJsc for URL {}
