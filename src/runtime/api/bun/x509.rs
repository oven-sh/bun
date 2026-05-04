use bun_boringssl_sys::X509;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

#[inline]
pub fn is_safe_alt_name(name: &[u8], utf8: bool) -> bool {
    for &c in name {
        match c {
            b'"'
            | b'\\'
            // These mess with encoding rules.
            // Fall through.
            | b','
            // Commas make it impossible to split the list of subject alternative
            // names unambiguously, which is why we have to escape.
            // Fall through.
            | b'\'' => {
                // Single quotes are unlikely to appear in any legitimate values, but they
                // could be used to make a value look like it was escaped (i.e., enclosed
                // in single/double quotes).
                return false;
            }
            _ => {
                if utf8 {
                    // In UTF8 strings, we require escaping for any ASCII control character,
                    // but NOT for non-ASCII characters. Note that all bytes of any code
                    // point that consists of more than a single byte have their MSB set.
                    if c < b' ' || c == 0x7f {
                        return false;
                    }
                } else {
                    // Check if the char is a control character or non-ASCII character. Note
                    // that char may or may not be a signed type. Regardless, non-ASCII
                    // values will always be outside of this range.
                    if c < b' ' || c > b'~' {
                        return false;
                    }
                }
            }
        }
    }
    true
}

pub fn to_js(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // TODO(port): @src() has no direct Rust equivalent; from_js_host_call may take Location::caller() or drop it
    bun_jsc::from_js_host_call(
        global_object,
        Bun__X509__toJSLegacyEncoding,
        (cert as *mut X509, global_object),
    )
}

pub fn to_js_object(cert: &mut X509, global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // SAFETY: cert is a valid X509* owned by the caller; global_object is a live JSC global
    Ok(unsafe { Bun__X509__toJS(cert as *mut X509, global_object) })
}

// TODO(port): move to runtime_sys (or bun_boringssl_sys)
unsafe extern "C" {
    fn Bun__X509__toJSLegacyEncoding(cert: *mut X509, global_object: *const JSGlobalObject) -> JSValue;
    fn Bun__X509__toJS(cert: *mut X509, global_object: *const JSGlobalObject) -> JSValue;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/x509.zig (57 lines)
//   confidence: medium
//   todos:      2
//   notes:      from_js_host_call signature/@src() mapping needs Phase B; X509 taken as &mut (raw *mut only at extern "C" boundary)
// ──────────────────────────────────────────────────────────────────────────
