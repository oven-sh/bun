//! Test-only bridge exposing `bun_collections::HashMap` to
//! `bun:internal-for-testing` (see `src/js/internal-for-testing.ts`).
//!
//! The map has no JS-visible surface of its own, and the cost of a lookup
//! shows from JS only as time. This bridge counts it instead: its hash context
//! gives every key the same fingerprint, so the map calls `ctx_eql` once for
//! each stored entry a lookup walks past, and the context counts those calls.
//!
//! Lives in `bun_runtime` (not `bun_collections`) because it needs the JSC
//! types.

use core::cell::Cell;

use bun_collections::{HashContext, HashMap};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

thread_local! {
    static COMPARISONS: Cell<u64> = const { Cell::new(0) };
}

struct CountingContext;

impl HashContext<u64> for CountingContext {
    fn ctx_hash(key: &u64) -> u64 {
        // The fingerprint is the top 7 bits of the hash: clear them.
        bun_wyhash::auto_hash(key) >> 7
    }
    fn ctx_eql(a: &u64, b: &u64) -> bool {
        COMPARISONS.set(COMPARISONS.get() + 1);
        a == b
    }
}

const MISSES: u64 = 1000;

/// `hashMapChurnProbe(live, cycles)`: inserts the keys `0..live`, then
/// `cycles` times removes the oldest key and inserts the next integer, so the
/// map always holds `live` entries. With no live key there is nothing to
/// replace. Then looks up 1,000 keys that were never inserted. Returns
/// `{ capacity, length, maxComparisons }`, where `maxComparisons` is the
/// largest number of stored entries that one of those lookups was compared
/// against.
pub(crate) fn churn_probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let live = frame.argument(0).coerce_to_i32(global)?.clamp(0, 1 << 20) as u64;
    let cycles = frame.argument(1).coerce_to_i32(global)?.clamp(0, 1 << 24) as u64;

    let mut map: HashMap<u64, (), CountingContext> = HashMap::new();
    for key in 0..live {
        map.insert(key, ());
    }
    if live > 0 {
        for cycle in 0..cycles {
            map.remove(&cycle);
            map.insert(live + cycle, ());
        }
    }

    let mut max_comparisons = 0;
    for miss in 0..MISSES {
        COMPARISONS.set(0);
        let found = map.contains_key(&(u64::MAX - miss));
        debug_assert!(!found);
        max_comparisons = max_comparisons.max(COMPARISONS.get());
    }

    let result = JSValue::create_empty_object(global, 3);
    result.put(
        global,
        b"capacity",
        JSValue::js_number(map.capacity() as f64),
    );
    result.put(global, b"length", JSValue::js_number(map.len() as f64));
    result.put(
        global,
        b"maxComparisons",
        JSValue::js_number(max_comparisons as f64),
    );
    Ok(result)
}
