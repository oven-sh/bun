//! `bun:internal-for-testing` probe for `bun_core::fast_random()` per-thread seeding.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc};

/// Returns the first `fast_random()` draw from `n` fresh threads as hex.
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
