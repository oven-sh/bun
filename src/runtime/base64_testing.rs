//! `bun:internal-for-testing` probe for test/internal/base64-encode-output-bounds.test.ts: the base64 encoders with a caller-chosen destination length.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

/// `base64EncodeProbe(inputLength, destinationLength, urlSafe)`: encodes the bytes `0..inputLength` and returns what was written.
pub(crate) fn encode_probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let input: Vec<u8> = (0..frame.argument(0).to_u32()).map(|i| i as u8).collect();
    let mut destination = vec![0u8; frame.argument(1).to_u32() as usize];
    let url_safe = frame.argument(2).to_boolean();

    let needed = if url_safe {
        bun_base64::url_safe_encode_len(&input)
    } else {
        bun_base64::encode_len(&input)
    };
    if destination.len() < needed {
        // The panic below is the expected result; don't leave a core dump behind in CI.
        bun_crash_handler::suppress_core_dumps_if_necessary();
    }

    let written = if url_safe {
        bun_base64::encode_url_safe(&mut destination, &input)
    } else {
        bun_base64::encode(&mut destination, &input)
    };
    bun_core::String::clone_latin1(&destination[..written]).to_js(global)
}
