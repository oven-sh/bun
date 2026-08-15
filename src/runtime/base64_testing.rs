//! Test-only bridge exposing `bun_base64::encode` / `encode_url_safe` with a
//! caller-chosen destination length to `bun:internal-for-testing` (see
//! `src/js/internal-for-testing.ts`).
//!
//! Every in-tree caller sizes its destination with the matching length helper,
//! so no JS API can hand the encoders a destination that is too short. The
//! encoders' contract for that case (panic before simdutf writes past the end
//! of the slice, see `simdutf::base64::encode`) therefore needs a probe to be
//! exercised against the built binary, including release builds, where a
//! `debug_assert!` would have compiled out. Registered via
//! `$newRustFunction("runtime/base64_testing.rs", "encodeProbe", 3)`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

/// `base64EncodeProbe(inputLength, destinationLength, urlSafe)`: encodes the
/// bytes `0, 1, .., inputLength - 1` (truncated to `u8`) into a destination of
/// `destinationLength` bytes and returns the bytes the encoder reported
/// writing, as a string.
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
        // The panic this provokes is the behavior under test; keep CI free of
        // core dumps from it, as the crash_handler test hooks do.
        bun_crash_handler::suppress_core_dumps_if_necessary();
    }

    let written = if url_safe {
        bun_base64::encode_url_safe(&mut destination, &input)
    } else {
        bun_base64::encode(&mut destination, &input)
    };
    bun_core::String::clone_latin1(&destination[..written]).to_js(global)
}
