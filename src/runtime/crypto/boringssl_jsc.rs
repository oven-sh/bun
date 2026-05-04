//! JSC bridge for BoringSSL error formatting. Keeps `src/boringssl/` free of JSC types.

use bun_boringssl_sys as boring;
use bun_jsc::{JSGlobalObject, JSValue};

const PREFIX: &[u8] = b"BoringSSL ";

pub fn err_to_js(global: &JSGlobalObject, err_code: u32) -> JSValue {
    let mut outbuf = [0u8; 128 + 1 + PREFIX.len()];
    outbuf[..PREFIX.len()].copy_from_slice(PREFIX);
    let message_buf = &mut outbuf[PREFIX.len()..];

    // SAFETY: message_buf is a valid writable buffer of message_buf.len() bytes.
    unsafe {
        boring::ERR_error_string_n(
            err_code,
            message_buf.as_mut_ptr().cast::<core::ffi::c_char>(),
            message_buf.len(),
        );
    }

    let error_message: &[u8] = bun_str::slice_to_nul(&outbuf[..]);
    if error_message.len() == PREFIX.len() {
        // TODO(port): globalThis.ERR(.BORINGSSL, ...) builder — confirm bun_jsc API shape
        return global
            .err(bun_jsc::ErrorCode::BORINGSSL, format_args!("An unknown BoringSSL error occurred: {}", err_code))
            .to_js();
    }

    // TODO(port): globalThis.ERR(.BORINGSSL, ...) builder — confirm bun_jsc API shape
    global
        .err(bun_jsc::ErrorCode::BORINGSSL, format_args!("{}", bstr::BStr::new(error_message)))
        .to_js()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/boringssl_jsc.zig (21 lines)
//   confidence: medium
//   todos:      2
//   notes:      `globalThis.ERR(tag, fmt, args).toJS()` mapped to provisional `global.err(ErrorCode, format_args!).to_js()`; verify bun_jsc error-builder API in Phase B.
// ──────────────────────────────────────────────────────────────────────────
