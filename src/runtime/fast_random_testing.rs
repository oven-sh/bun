//! Test-only bridge exposing `bun_core::fast_random()` per-thread behaviour
//! to `bun:internal-for-testing`.
//!
//! `fast_random()` backs internal temp-name suffixes on worker threads
//! (install `.old-{HEX}`, isolated-install tmp, bundler unique keys) and has
//! no JS-visible surface, so the invariant that each thread gets an
//! independently-seeded PRNG can only be observed through this probe.
//!
//! Lives in `bun_runtime` (not `bun_core`) because it needs the JSC types.
//! Registered via `$newRustFunction("bun_core/util.rs",
//! "TestingAPIs.fastRandomThreadProbe", 1)`; see `dispatch_js2native.rs`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

/// Spawns `n` fresh threads, collects the first `fast_random()` value from
/// each, and returns them as a JS `string[]` of 16-char lowercase hex (full
/// `u64` precision; JS `number` would truncate above 2^53).
pub fn fast_random_thread_probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let n = frame.argument(0).to_int32().clamp(0, 256) as usize;

    let mut values = vec![0u64; n];
    std::thread::scope(|s| {
        let mut handles = Vec::with_capacity(n);
        for _ in 0..n {
            handles.push(s.spawn(bun_core::fast_random));
        }
        for (slot, h) in values.iter_mut().zip(handles) {
            *slot = h.join().unwrap();
        }
    });

    let array = JSValue::create_empty_array(global, values.len())?;
    for (i, v) in values.iter().enumerate() {
        let hex = format!("{v:016x}");
        array.put_index(
            global,
            i as u32,
            bun_core::String::borrow_utf8(hex.as_bytes()).to_js(global)?,
        )?;
    }
    Ok(array)
}
