//! Temporary: forms of `remove_pairs`, to time them.
use super::{PAIR_GROUP, TOO_MUCH};
use core::array::from_fn;
use core::hint::cold_path;

pub use simd::{form_1, form_2, form_3, form_4, form_5, form_6, form_7};

const LANES_IN: [u8; 16] = from_fn(const |bits| bits.count_ones() as u8);

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::x256::{F64, I64, U64};
    use isa::{I8, Mask, x128, x256};

    const PAIRS_FIT: bool = I8::LEN > 16;

    #[inline(always)]
    fn have(pairs: U64, [a, b]: [u32; 2]) -> Mask<u32, 4> {
        let ids: x256::U32 = pairs.bitcast();
        if PAIRS_FIT {
            let has_one: U64 = (ids.simd_eq(a) | ids.simd_eq(b)).to_vector().bitcast();
            return has_one.simd_ne(0).cast();
        }
        let [low, high] = ids.halves();
        let (first, second) = low.deinterleave(high);
        let have = |id: u32| first.simd_eq(id) | second.simd_eq(id);
        have(a) | have(b)
    }

    #[inline(always)]
    fn differences(pairs: U64) -> I64 {
        if PAIRS_FIT {
            return (pairs - (pairs << 32)).bitcast();
        }
        let [low, high] = pairs.bitcast::<x256::U32>().halves();
        let (first, second) = low.deinterleave(high);
        I64::from_halves([(second - first).bitcast(); 2])
    }

    #[inline(always)]
    fn is_nearer(differences: I64, limit: I64) -> Mask<f64, 4> {
        if PAIRS_FIT {
            return differences.simd_lt(limit).cast();
        }
        let four = |all: I64| all.halves()[0].bitcast::<x128::I32>();
        four(differences).simd_lt(four(limit)).cast()
    }

    #[inline(always)]
    fn form<const ONE_MOVE: bool, const RARE: u8>(
        costs: &mut [f64],
        pairs: &mut [[u32; 2]],
        merged: [u32; 2],
    ) -> usize {
        let count = costs.len();
        assert!(count >= PAIR_GROUP && count == pairs.len() && count.is_multiple_of(PAIR_GROUP));
        let (mut best_cost, mut best_pair) = (F64::splat(TOO_MUCH), !U64::zero());
        let (mut best_apart, mut at, mut kept, last) = (I64::zero(), 0, 0, count - PAIR_GROUP);
        while at <= last {
            let mut cost = F64::from_slice(&costs[at..]);
            let mut pair: U64 = x256::U32::from_slice(pairs[at..].as_flattened()).bitcast();
            let (is_gone, apart) = (have(pair, merged), differences(pair));
            let wins = |cost: F64, best_cost: F64, best_apart: I64| {
                let is_tie = cost.bitcast::<U64>().simd_eq(best_cost.bitcast::<U64>());
                cost.simd_lt(best_cost) | is_tie.cast() & is_nearer(apart, best_apart)
            };
            let won = wins(cost, best_cost, best_apart);
            let (staying, mut found) = if ONE_MOVE {
                let own_bit = x128::U32::from_array([1, 2, 4, 8]);
                let both = is_gone.select(own_bit, won.cast().select(own_bit << 4, 0));
                let bits = both.bitcast::<x128::I32>().reduce_sum() as u64;
                (!bits & 15, bits >> 4)
            } else {
                let staying = (!is_gone).to_bitmask();
                (staying, won.to_bitmask() & staying)
            };
            if found != 0 {
                cold_path();
                let (costs, pairs) = (&mut costs[at..][..4], &mut pairs[at..][..4]);
                let ids = |both: u64| [both as u32, (both >> 32) as u32];
                let apart = |[a, b]: [u32; 2]| b.wrapping_sub(a) as i32;
                let splat = |[a, b]: [u32; 2]| U64::splat(u64::from(b) << 32 | u64::from(a));
                let high = if PAIRS_FIT { -1 << 32 } else { -1 };
                let is_better = |it: (f64, [u32; 2]), best: (f64, [u32; 2])| {
                    it.0 < best.0 || it.0 == best.0 && apart(it.1) < apart(best.1)
                };
                let mut best = (best_cost[0], ids(best_pair[0]));
                match RARE {
                    0 => {
                        while found != 0 {
                            let lane = found.trailing_zeros() as usize;
                            let is_lane = U64::iota().simd_eq(lane as u64);
                            cost = is_lane.cast().select(best_cost, cost);
                            pair = is_lane.select(best_pair, pair);
                            best_cost = F64::splat(costs[lane % 4]);
                            best_pair = splat(pairs[lane % 4]);
                            best_apart = differences(best_pair) & high;
                            found = wins(cost, best_cost, best_apart).to_bitmask() & staying;
                        }
                    }
                    1 => {
                        for i in 0..4 {
                            if is_better((costs[i], pairs[i]), best) && staying >> i & 1 != 0 {
                                core::mem::swap(&mut costs[i], &mut best.0);
                                core::mem::swap(&mut pairs[i], &mut best.1);
                            }
                        }
                        cost = F64::from_slice(costs);
                        pair = x256::U32::from_slice(pairs.as_flattened()).bitcast();
                    }
                    2 => {
                        while found != 0 {
                            let lane = found.trailing_zeros() as usize;
                            found &= found - 1;
                            let it = (costs[lane % 4], pairs[lane % 4]);
                            if is_better(it, best) {
                                let is_lane = U64::iota().simd_eq(lane as u64);
                                cost = is_lane.cast().select(best.0, cost);
                                pair = is_lane.select(splat(best.1), pair);
                                best = it;
                            }
                        }
                    }
                    _ =>
                    {
                        #[rustc_unroll(full)]
                        for lane in 0..4 {
                            let it = (costs[lane], pairs[lane]);
                            if found >> lane & 1 != 0 && is_better(it, best) {
                                let is_lane = U64::iota().simd_eq(lane as u64);
                                cost = is_lane.cast().select(best.0, cost);
                                pair = is_lane.select(splat(best.1), pair);
                                best = it;
                            }
                        }
                    }
                }
                if RARE != 0 {
                    (best_cost, best_pair) = (F64::splat(best.0), splat(best.1));
                    best_apart = differences(best_pair) & high;
                }
            }
            let staying = staying as usize % 16;
            let cost: F64 = cost.bitcast::<U64>().compress(staying).bitcast();
            let ids: x256::U32 = pair.compress(staying).bitcast();
            assert!(kept <= last);
            cost.copy_to_slice(&mut costs[kept..]);
            ids.copy_to_slice(pairs[kept..].as_flattened_mut());
            kept += usize::from(LANES_IN[staying]);
            at += PAIR_GROUP;
        }
        costs[0] = best_cost[0];
        pairs[0] = [best_pair[0] as u32, (best_pair[0] >> 32) as u32];
        kept
    }

    #[export]
    pub fn form_1(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<false, 0>(costs, pairs, merged)
    }

    #[export]
    pub fn form_2(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<true, 1>(costs, pairs, merged)
    }

    #[export]
    pub fn form_3(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<false, 1>(costs, pairs, merged)
    }

    #[export]
    pub fn form_4(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<false, 2>(costs, pairs, merged)
    }

    #[export]
    pub fn form_5(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<true, 2>(costs, pairs, merged)
    }

    #[export]
    pub fn form_6(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<false, 3>(costs, pairs, merged)
    }

    #[export]
    pub fn form_7(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<true, 3>(costs, pairs, merged)
    }
}
