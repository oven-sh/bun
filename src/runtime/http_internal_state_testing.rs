//! Test-only bridge exposing `bun_http::InternalState` body-buffer accessors
//! to `bun:internal-for-testing` (see `src/js/internal-for-testing.ts`).
//!
//! `InternalState` is the HTTP client's per-request state; its
//! `get_body_buffer()` / `chunked_decoder_and_body_buffer()` /
//! `process_body_buffer()` accessors are only reached via the HTTP thread's
//! `on_data` callback, so the `body_out_str == None` branch (the state after
//! `Default`, before `start()` has attached the caller-owned response buffer)
//! can't be driven deterministically from a normal `fetch()` test. This
//! bridge constructs a default `InternalState` and calls each accessor so a
//! JS test can assert they don't panic (Sentry BUN-3BZF).
//!
//! Lives in `bun_runtime` (not `bun_http`) because it needs the JSC types;
//! `bun_runtime` already depends on both. Registered via
//! `$newZigFunction("runtime/http_internal_state_testing.zig",
//! "bodyBufferProbe", 0)` — the `.zig` path is only the codegen key; the
//! implementation is this Rust function (see `dispatch_js2native.rs`).

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// Constructs an `InternalState` with `body_out_str == None` (the `Default`
/// state) and exercises each body-buffer accessor. Returns `true` on
/// success; a panic in any accessor aborts the process.
pub fn body_buffer_probe(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let mut state = bun_http::InternalState::default();
    debug_assert!(state.body_out_str.is_none());

    // `get_body_buffer()` with no owner buffer and identity encoding: must
    // not unwrap None.
    {
        let buf = state.get_body_buffer();
        buf.append_slice(b"hello").unwrap();
    }

    // `chunked_decoder_and_body_buffer()` with no owner buffer: both halves
    // must be valid.
    {
        let (decoder, body_buf) = state.chunked_decoder_and_body_buffer();
        decoder.consume_trailer = 1;
        body_buf.append_slice(b" world").unwrap();
    }

    // `process_body_buffer()` with no owner buffer: must return Ok(false)
    // (no progress to deliver) rather than unwrapping None.
    let buffer = core::mem::take(&mut state.get_body_buffer().list);
    let processed = state.process_body_buffer(buffer, true).unwrap();

    // The fallback buffer retained what was written above and was handed
    // back by `process_body_buffer`.
    let len = state.get_body_buffer().list.len();

    Ok(JSValue::js_boolean(!processed && len == b"hello world".len()))
}
