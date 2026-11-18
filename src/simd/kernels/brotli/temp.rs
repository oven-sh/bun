//! Temporary: forms of `remove_pairs` for 128 bits, to time them.
use super::{PAIR_GROUP, TOO_MUCH};
use crate::Aligned;
use core::array::from_fn;
use core::hint::cold_path;

pub use simd::{form_1, form_2, form_3, form_4, form_5, form_6, form_7};

const fn part(mut bits: usize, i: usize) -> u8 {
    let mut lane = 0;
    while lane < i / 8 {
        (bits, lane) = (bits & bits.wrapping_sub(1), lane + 1);
    }
    (bits.trailing_zeros() as usize % 4 * 8 + i % 8) as u8
}

static BYTES: Aligned<[[u8; 32]; 16]> =
    Aligned(from_fn(const |bits| from_fn(const |i| part(bits, i))));
const LANES_IN: [u8; 16] = from_fn(const |bits| bits.count_ones() as u8);

#[bun_simd::foreach_target(sse4, neon, portable)]
mod simd {
    use isa::x256::{F64, U64};
    use isa::{Mask, x128, x256};

    #[inline(always)]
    fn from_two_tables(v: U64, bits: usize) -> U64 {
        let [first, second] = v.bitcast::<x256::U8>().halves();
        let [a, b] = x256::U8::from_array(BYTES.0[bits % 16]).halves();
        x256::U8::from_halves([first.lookup2(second, a), first.lookup2(second, b)]).bitcast()
    }

    /// `HOW`: two moves, a move and `any`, or one move.
    #[inline(always)]
    fn form<const HOW: u8, const SCALAR: bool, const TWO: bool, const IN_ORDER: bool>(
        costs: &mut [f64],
        pairs: &mut [[u32; 2]],
        [a, b]: [u32; 2],
    ) -> usize {
        let count = costs.len();
        assert!(count >= PAIR_GROUP && count == pairs.len() && count.is_multiple_of(PAIR_GROUP));
        let (mut best_cost, mut best_pair) = (F64::splat(TOO_MUCH), !U64::zero());
        let (mut best_apart, mut at, mut kept) = (x128::I32::zero(), 0, 0);
        let last = count - PAIR_GROUP;
        while at <= last {
            let mut cost = F64::from_slice(&costs[at..]);
            let mut pair: U64 = x256::U32::from_slice(pairs[at..].as_flattened()).bitcast();
            let [low, high] = pair.bitcast::<x256::U32>().halves();
            let (first, second) = low.deinterleave(high);
            let have = |id: u32| first.simd_eq(id) | second.simd_eq(id);
            let (is_gone, apart) = (have(a) | have(b), (second - first).bitcast::<x128::I32>());
            let wins = |cost: F64, best_cost: F64, best_apart: x128::I32| -> Mask<u32, 4> {
                let is_tie = cost.bitcast::<U64>().simd_eq(best_cost.bitcast::<U64>());
                cost.simd_lt(best_cost).cast() | is_tie.cast() & apart.simd_lt(best_apart).cast()
            };
            let won = wins(cost, best_cost, best_apart);
            let (staying, is_rare) = match HOW {
                0 => {
                    let staying = is_gone.to_bitmask() ^ 15;
                    (staying, won.to_bitmask() & staying != 0)
                }
                1 => (is_gone.to_bitmask() ^ 15, (won & !is_gone).any()),
                _ => {
                    let own_bit = x128::U32::from_array([1, 2, 4, 8]);
                    let both = is_gone.select(own_bit, won.select(own_bit << 4, 0));
                    let bits = both.bitcast::<x128::I32>().reduce_sum() as u64;
                    (!bits & 15, bits > 15)
                }
            };
            if is_rare {
                cold_path();
                if SCALAR {
                    let mut best = (
                        best_cost[0],
                        [best_pair[0] as u32, (best_pair[0] >> 32) as u32],
                    );
                    let apart = |[a, b]: [u32; 2]| b.wrapping_sub(a) as i32;
                    let (costs, pairs) = (&mut costs[at..][..4], &mut pairs[at..][..4]);
                    for i in 0..4 {
                        let is_better = costs[i] < best.0
                            || costs[i] == best.0 && apart(pairs[i]) < apart(best.1);
                        if is_better && staying >> i & 1 != 0 {
                            core::mem::swap(&mut costs[i], &mut best.0);
                            core::mem::swap(&mut pairs[i], &mut best.1);
                        }
                    }
                    cost = F64::from_slice(costs);
                    pair = x256::U32::from_slice(pairs.as_flattened()).bitcast();
                    best_cost = F64::splat(best.0);
                    best_pair = U64::splat(u64::from(best.1[1]) << 32 | u64::from(best.1[0]));
                    best_apart = x128::I32::splat(apart(best.1));
                } else {
                    let mut found = won.to_bitmask() & staying;
                    while found != 0 {
                        let lane = found.trailing_zeros();
                        let is_lane = U64::iota().simd_eq(u64::from(lane));
                        cost = is_lane.cast().select(best_cost, cost);
                        pair = is_lane.select(best_pair, pair);
                        let [first, second] = pairs[at..][..4][lane as usize % 4];
                        best_cost = F64::splat(costs[at..][..4][lane as usize % 4]);
                        best_pair = U64::splat(u64::from(second) << 32 | u64::from(first));
                        best_apart = x128::I32::splat(second.wrapping_sub(first) as i32);
                        found = wins(cost, best_cost, best_apart).to_bitmask() & staying;
                    }
                }
            }
            let staying = staying as usize % 16;
            let keep = |v: U64| match TWO {
                true => from_two_tables(v, staying),
                false => v.compress(staying),
            };
            let (cost, ids): (F64, x256::U32) =
                (keep(cost.bitcast()).bitcast(), keep(pair).bitcast());
            assert!(kept <= last);
            if IN_ORDER {
                let ([a, b], [c, d]) = (cost.halves(), ids.halves());
                let (costs, pairs) = (&mut costs[kept..][..4], &mut pairs[kept..][..4]);
                a.copy_to_slice(costs);
                b.copy_to_slice(&mut costs[2..]);
                c.copy_to_slice(pairs.as_flattened_mut());
                d.copy_to_slice(pairs[2..].as_flattened_mut());
            } else {
                cost.copy_to_slice(&mut costs[kept..]);
                ids.copy_to_slice(pairs[kept..].as_flattened_mut());
            }
            kept += usize::from(LANES_IN[staying]);
            at += PAIR_GROUP;
        }
        costs[0] = best_cost[0];
        pairs[0] = [best_pair[0] as u32, (best_pair[0] >> 32) as u32];
        kept
    }

    #[export]
    pub fn form_1(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<0, false, false, false>(costs, pairs, merged)
    }

    #[export]
    pub fn form_2(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<1, true, true, false>(costs, pairs, merged)
    }

    #[export]
    pub fn form_3(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<2, false, false, false>(costs, pairs, merged)
    }

    #[export]
    pub fn form_4(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<2, true, false, false>(costs, pairs, merged)
    }

    #[export]
    pub fn form_5(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<0, false, true, true>(costs, pairs, merged)
    }

    #[export]
    pub fn form_6(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<2, true, true, true>(costs, pairs, merged)
    }

    #[export]
    pub fn form_7(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        form::<1, true, true, true>(costs, pairs, merged)
    }
}
