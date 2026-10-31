//! `hashMapChurnProbe` in `bun:internal-for-testing` (in `bun_runtime`: `bun_collections` has no bindings).

use core::cell::Cell;

use bun_collections::{HashContext, HashMap};

use crate::generated_bindgen::hash_map_testing::ChurnProbeResult;

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
pub(crate) fn churn_probe(live: u32, cycles: u32) -> ChurnProbeResult {
    let (live, cycles) = (u64::from(live), u64::from(cycles));

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

    ChurnProbeResult {
        capacity: map.capacity(),
        length: map.len(),
        max_comparisons: max_comparisons as usize,
    }
}
