//! Test-only bridge exposing `bun_collections::LinearFifo::ordered_remove_item`
//! to `bun:internal-for-testing` (see `src/js/internal-for-testing.ts`).
//!
//! `LinearFifo` is an internal Rust ring buffer with no JS-visible surface of
//! its own; its only in-tree caller (the bake dev server's source-map weak-ref
//! store) drives it with CSPRNG keys and an async expiry timer, so the
//! wrapped-buffer branch of `ordered_remove_item` can't be reached
//! deterministically from a normal test. This bridge reconstructs the exact
//! wrapped states from issue #31563 and returns the resulting FIFO contents so
//! a JS test can assert FIFO order is preserved across a wrapped removal.
//!
//! Lives in `bun_runtime` (not `bun_collections`) because it needs the JSC
//! types; `bun_runtime` already depends on both `bun_collections` and
//! `bun_jsc`. Registered via `$newRustFunction("collections/linear_fifo.rs",
//! "TestingAPIs.orderedRemoveProbe", 1)` — the path is only the codegen key;
//! the implementation is this Rust function (see `dispatch_js2native.rs`).

use bun_collections::linear_fifo::{LinearFifo, StaticBuffer};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

/// A 16-slot static buffer matches the real `weak_refs` FIFO in the dev
/// server's source-map store and makes `POWERS_OF_TWO` true.
type ProbeFifo = LinearFifo<i32, StaticBuffer<i32, 16>>;

/// Builds a wrapped `LinearFifo` for the requested scenario, removes one item,
/// and returns the live items (FIFO order) as a JS `number[]`.
///
/// Scenarios mirror issue #31563:
///   0 — tail sub-branch (`index >= head`), `head < count`:
///       write 12, read 8, write 10 → head=8 count=14, remove offset 6.
///   1 — wrapped-prefix sub-branch (`index < head`), `head > count`:
///       write 12, read 12, write 8 → head=12 count=8, remove offset 5.
///
/// Any other scenario value returns an empty array.
pub fn ordered_remove_probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let scenario = frame.argument(0).to_int32();

    let mut fifo = ProbeFifo::init();
    match scenario {
        0 => {
            for v in 0..12 {
                fifo.write_item(v).unwrap();
            }
            for _ in 0..8 {
                fifo.read_item().unwrap();
            }
            for v in 100..110 {
                fifo.write_item(v).unwrap();
            }
            fifo.ordered_remove_item(6);
        }
        1 => {
            for v in 0..12 {
                fifo.write_item(v).unwrap();
            }
            for _ in 0..12 {
                fifo.read_item().unwrap();
            }
            for v in 200..208 {
                fifo.write_item(v).unwrap();
            }
            fifo.ordered_remove_item(5);
        }
        _ => {}
    }

    let len = fifo.readable_length();
    let array = JSValue::create_empty_array(global, len)?;
    for i in 0..len {
        array.put_index(
            global,
            i as u32,
            JSValue::js_number_from_int32(fifo.peek_item(i)),
        )?;
    }
    Ok(array)
}
