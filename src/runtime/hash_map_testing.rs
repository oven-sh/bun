//! `hashMapChurnProbe` in `bun:internal-for-testing` (in `bun_runtime` for the JSC types).

use core::cell::Cell;

use bun_collections::{HashContext, HashMap};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

thread_local! {
    static COMPARISONS: Cell<u64> = const { Cell::new(0) };
}

/// Gives every key one fingerprint, so `ctx_eql` runs for each stored entry a lookup passes.
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

/// Keeps `live` keys, replaces the oldest `cycles` times, then looks up 1,000 absent keys.
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
