use bun_core::String;
pub use bun_url::whatwg::URL;

use crate::{JSGlobalObject, JSValue, JsResult};

/// JS-value entry points for [`URL`]; the rest of the API lives on
/// `bun_url::whatwg::URL`.
pub trait URLJsc {
    /// Percent-encodes the URL, punycode-encodes the hostname, and returns the
    /// result. If it fails, the tag is marked Dead.
    #[track_caller]
    fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        Ok(bun_url::href_from_string(&value.to_bun_string(global)?))
    }
}

impl URLJsc for URL {}
