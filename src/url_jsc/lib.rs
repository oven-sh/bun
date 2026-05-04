//! JSC bridges for `url/url.zig` `URL`. The struct + parser stay in `url/`.

use bun_jsc::{JSGlobalObject, JSValue};
use bun_str as str_;
use bun_url::URL;

pub fn url_from_js(js_value: JSValue, global: &JSGlobalObject) -> Result<URL, bun_core::Error> {
    // TODO(port): narrow error set (InvalidURL | OOM)
    let href = bun_jsc::Url::href_from_js(global, js_value);
    if href.tag() == str_::Tag::Dead {
        return Err(bun_core::err!("InvalidURL"));
    }

    Ok(URL::parse(href.to_owned_slice()?))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/url_jsc/url_jsc.zig (16 lines)
//   confidence: medium
//   todos:      1
//   notes:      allocator param dropped; bun_jsc::Url + bun_str::Tag::Dead names may need fixup
// ──────────────────────────────────────────────────────────────────────────
