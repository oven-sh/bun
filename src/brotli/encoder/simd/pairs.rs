use bun_simd::prelude::*;

targets!(Upto<B32>);

/// [`remove_pairs`] takes whole groups of this many.
pub(crate) const PAIR_GROUP: usize = 4;

/// Returns how many have neither of `gone`. One that costs less than the first, or as much with a smaller difference, trades places with it.
#[kernel]
#[inline(never)]
pub(crate) fn remove_pairs(costs: &mut [f64], pairs: &mut [[u32; 2]], gone: [u32; 2]) -> usize {
    let count = costs.len();
    assert!(count >= PAIR_GROUP && count == pairs.len() && count.is_multiple_of(PAIR_GROUP));
    let apart = |[first, second]: [u32; 2]| second.wrapping_sub(first) as i32;
    let mut best = (1e99, [u32::MAX; 2]);
    let (mut best_cost, mut best_apart) = (f64x4::splat(best.0), i32xN::zero());
    let (mut at, mut kept) = (0, 0);
    while at <= count - PAIR_GROUP {
        let our_costs = &mut costs[at..at + PAIR_GROUP];
        let our_pairs = &mut pairs[at..at + PAIR_GROUP];
        at += PAIR_GROUP;
        let (mut cost, mut pair) = (
            f64x4::load(our_costs),
            u32x8::load(our_pairs.as_flattened()),
        );
        let (is_cheaper, is_equal) = (cost.simd_lt(best_cost), cost.simd_eq(best_cost));
        let (stays, is_better) = if Native::<S>::BYTES >= 32 {
            let is_gone = pair.simd_eq(gone[0]) | pair.simd_eq(gone[1]);
            let stays = is_gone.to_simd::<u32>().bitcast::<u64>().simd_eq(0);
            let in_odd_lanes = (pair - (pair.bitcast::<u64>() << 32).bitcast()).cast_signed();
            let is_nearer = in_odd_lanes
                .simd_lt(best_apart.resize::<B32>())
                .to_simd::<i32>();
            let is_nearer = is_nearer.bitcast::<i64>().is_negative();
            let is_better = stays & (is_cheaper | (is_equal & is_nearer));
            (stays.to_bitmask(), is_better.any())
        } else {
            let [low, high] = pair.split();
            let [first, second] = low.deinterleave(high);
            let is_either = |ids: u32x4<S>| ids.simd_eq(gone[0]) | ids.simd_eq(gone[1]);
            let stays = !(is_either(first) | is_either(second));
            let is_nearer = (second - first)
                .cast_signed()
                .simd_lt(best_apart.resize::<B16>());
            let is_better =
                stays & (is_cheaper.cast::<i32>() | (is_equal.cast::<i32>() & is_nearer));
            (stays.to_bitmask(), is_better.any())
        };
        if is_better {
            core::hint::cold_path();
            for (i, (cost, pair)) in our_costs.iter_mut().zip(&mut *our_pairs).enumerate() {
                let is_nearer = || *cost == best.0 && apart(*pair) < apart(best.1);
                if stays >> i & 1 != 0 && (*cost < best.0 || is_nearer()) {
                    core::mem::swap(cost, &mut best.0);
                    core::mem::swap(pair, &mut best.1);
                }
            }
            (cost, pair) = (
                f64x4::load(our_costs),
                u32x8::load(our_pairs.as_flattened()),
            );
            (best_cost, best_apart) = (f64x4::splat(best.0), i32xN::splat(apart(best.1)));
        }
        // One comparison, where the ranges take two.
        assert!(kept <= count - PAIR_GROUP);
        let pair = pair.bitcast::<u64>().compress_relaxed(stays);
        (pair.bitcast()).store(pairs[kept..][..PAIR_GROUP].as_flattened_mut());
        kept += cost.compress_store(&mut costs[kept..], stays);
    }
    (costs[0], pairs[0]) = best;
    kept
}
