//! Less than a register on NEON: two accesses that overlap, and a lookup.

use crate::{Aligned, B4, B16, Isa, Lane, Simd, Tag, Width};

/// For each length from 4 bytes on: from the first and the last 4 or 8 bytes to the order of memory, and zeros.
const JOIN: &Aligned<[[u8; 16]; 16]> = &Aligned({
    let (mut rows, mut len) = ([[0xff; 16]; 16], 4);
    while len < 16 {
        let (part, mut i) = (if len < 8 { 4 } else { 8 }, 0);
        while i < len {
            rows[len][i] = (if i < part { i } else { i + 2 * part - len }) as u8;
            i += 1;
        }
        len += 1;
    }
    rows
});
#[cfg(any(target_arch = "aarch64", bun_simd_all_branches))]
const IOTA: &Aligned<[u8; 64]> = &Aligned({
    let (mut all, mut i) = ([0; 64], 0);
    while i < 64 {
        (all[i], i) = (i as u8, i + 1);
    }
    all
});

const FIRST: &Aligned<[u8; 32]> = &Aligned({
    let (mut all, mut i) = ([0; 32], 0);
    while i < 16 {
        (all[i], i) = (255, i + 1);
    }
    all
});
/// The same from two vectors: the first 8 if there are as many, the last 4 and zeros; and the 4 from `len - 8` or 0.
const JOIN_THREE: &Aligned<[[u8; 16]; 16]> = &Aligned({
    let (mut rows, mut len) = ([[12; 16]; 16], 4usize);
    while len < 16 {
        let (at, mut i) = (len.saturating_sub(8), 0);
        while i < len {
            rows[len][i] = (if i >= len - 4 {
                8 + i + 4 - len
            } else if i >= at {
                16 + i - at
            } else {
                i
            }) as u8;
            i += 1;
        }
        len += 1;
    }
    rows
});

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    pub(crate) const BY_LOOKUP: bool =
        S::A64 && !S::PARTIAL && cfg!(target_endian = "little") && W::BYTES == 16 && size_of::<T>() <= 4;

    pub(crate) const BY_LAST_BLOCK: bool =
        S::A64 && !S::PARTIAL && cfg!(target_endian = "little") && (W::BYTES == 32 || W::BYTES == 64);

    /// From a block on without branches: each is loaded where it fits, and moved.
    #[on(A64)]
    #[op]
    pub(crate) fn load_by_last_block(self, from: &[T]) -> Simd<T, W, S> {
        let (d, from) = (self.simd().fixed::<T, B16>(), &from[..from.len().min(Self::LANES)]);
        let Some(last) = from.len().checked_sub(d.lanes()) else { return self.resize_bitcast(d.load_n(from)) };
        let block = always!(|i: usize| {
            let at = last.min(i * d.lanes());
            let moves = d.repartition::<u8>().load(&IOTA[(i * d.lanes() - at) * size_of::<T>()..]);
            d.load(&from[at..]).table_lookup_bytes(moves).bitcast::<T>()
        });
        let lower = d.load(from).concat(block(1));
        choose! { W::BYTES == 32 => self.resize_bitcast(lower), _ => self.resize_bitcast(lower.concat(block(2).concat(block(3)))) }
    }

    #[op]
    pub(crate) fn load_by_lookup(self, from: &[T]) -> Simd<T, W, S> {
        let (len, half) = (from.len(), self.half());
        if size_of::<T>() > 1 && is_known!(len) {
            return self.load_known(from);
        }
        let quarter = half.half();
        let join = always!(|v: Simd<T, W, S>| {
            v.table_lookup_bytes(self.repartition::<u8>().load(&JOIN[len * size_of::<T>() % 16])).bitcast::<T>()
        });
        if len >= Self::LANES {
            return self.load(from);
        }
        return_if!(size_of::<T>() == 4, {
            let Some(&last) = from.last() else { return self.zero() };
            // See `load_quarters`.
            let one = always!(|x: T| self.zero().with_lane_dyn(0, x).black_box());
            let pair = one(from[0]).interleave_lower(one(from[len / 2])).bitcast::<u64>();
            let all = pair.interleave_lower(one(last).bitcast()).bitcast::<T>();
            all & self.repartition::<u8>().load(&FIRST[16 - 4 * len..]).bitcast::<T>()
        });
        // One class for 4 to 15 bytes, as the lengths of text are hard to predict.
        if const { size_of::<T>() <= 2 } && len >= quarter.lanes() && !is_known!(len) {
            let bytes = crate::lane::Repr::bytes(from);
            let eight = core::hint::select_unpredictable(bytes.len() < 8, &JOIN_THREE[0][..8], bytes);
            let first = half.repartition::<u8>().load(eight).bitcast::<T>();
            let start = (bytes.len() - 4).saturating_sub(4);
            let word = always!(|at: usize| u32::from_ne_bytes(bytes[at..at + 4].try_into().unwrap()));
            let (d, moves) = (self.repartition::<u32>(), self.repartition::<u8>().load(&JOIN_THREE[bytes.len() % 16]));
            let last = d.zero().with_lane_dyn(0, word(bytes.len() - 4)).black_box().bitcast::<u64>();
            let ends = self.zero_extend(first).bitcast::<u64>().interleave_lower(last).bitcast::<u32>();
            return ends.two_tables_lookup_bytes(d.zero().with_lane_dyn(0, word(start)), moves).bitcast::<T>();
        }
        if len >= half.lanes() {
            return join(self.combine(half.load_last(from), half.load(from)));
        }
        if size_of::<T>() < 4 && len >= quarter.lanes() {
            return join(self.resize_bitcast(half.combine(quarter.load_last(from), quarter.load(from))));
        }
        if len == 0 {
            return self.zero();
        }
        if const { size_of::<T>() > 1 } {
            return self.load_known(&from[..1]);
        }
        let at = always!(|i: usize| (crate::Int::to_u64(T::unsigned(from)[i]) as u32) << (8 * i));
        self.resize_bitcast(self.simd().fixed::<u32, B4>().set(at(0) | at(len / 2) | at(len - 1)))
    }
}

#[cfg(target_arch = "aarch64")]
impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// The reverse of `load_by_last_block`. What doesn't fit goes to the last block, which is written again.
    #[op]
    pub(crate) fn store_by_last_block(self, to: &mut [T]) {
        let (d, len) = (self.s.fixed::<T, B16>(), to.len().min(Self::LANES));
        let (n, to) = (d.lanes(), &mut to[..len]);
        let Some(last) = len.checked_sub(n) else { return d.resize_bitcast(self).store_n(to) };
        if const { W::BYTES == 64 } {
            d.resize_bitcast(self.upper_half()).store_last(&mut to[..len.min(3 * n)]);
            d.resize_bitcast(self.lower_half().upper_half()).store_last(&mut to[..len.min(2 * n)]);
        }
        d.resize_bitcast(self).store(to);
        let moves = d.repartition::<u8>().load(&IOTA[last * size_of::<T>()..]);
        d.resize_bitcast(self.bitcast::<u8>().swizzle_dyn_relaxed(self.tag().repartition::<u8>().resize_bitcast(moves)))
            .store(&mut to[last..])
    }
    #[op]
    pub(crate) fn store_by_lookup<P: crate::memory::Place<T>>(self, to: &mut P, at: usize) {
        let (d, len, n) = (self.tag(), to.len() - at, Self::LANES);
        let from = always!(|lane: usize| {
            self.table_lookup_bytes(
                d.resize_bitcast(self.s.fixed::<u8, crate::B16>().load(&IOTA[lane * size_of::<T>() % 16..])),
            )
            .bitcast::<T>()
        });
        if len >= n {
            return self.write(to, at);
        }
        if const { size_of::<T>() == 4 && P::SLICE } {
            if len > 0 {
                to.write(at + len - 1, [self.lane_dyn(2)]);
                to.write(at + len / 2, [self.lane_dyn(1)]);
                to.write(at, [self.get_lane()]);
            }
            return;
        }
        if len >= n / 2 {
            self.lower_half().write(to, at);
            return from(len - n / 2).lower_half().write(to, at + len - n / 2);
        }
        if size_of::<T>() < 4 && len >= n / 4 {
            self.lower_half().lower_half().write(to, at);
            return from(len - n / 4).lower_half().lower_half().write(to, at + len - n / 4);
        }
        if len == 0 {
            return;
        }
        to.write(at, [self.get_lane()]);
        if const { size_of::<T>() == 1 } {
            let low = self.bitcast::<u32>().get_lane();
            let lane = always!(|i: usize| [T::of_unsigned(&[Lane::from_u64((low >> (8 * i)) as u8 as u64)])[0]]);
            to.write(at + len / 2, lane(len / 2));
            to.write(at + len - 1, lane(len - 1));
        }
    }
}
