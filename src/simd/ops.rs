//! The operations that LLVM has no portable form of. A target overrides the ones that it has instructions for.
//! All vectors are bytes here. `crate::Simd` gives them their types.

use crate::endian::ToBytes;
use crate::lane::Lane;
use crate::pattern as p;
use crate::raw::{Bits, Raw, RawOf};
use crate::shared::{self, Shared};
use crate::simd::prelude::*;
#[cfg(any(target_arch = "x86", target_arch = "x86_64", bun_simd_all_branches))]
use crate::sse2;
use crate::width::{B16, B32, B64, Repr, Width};
use core::sync::atomic::AtomicU8;

#[op]
pub fn low<const N: usize, const HALF: usize>(v: Simd<u8, N>) -> Simd<u8, HALF>
where
    u8: crate::simd::Fits<N> + crate::simd::Fits<HALF>,
{
    v.shuffle::<_, { p::PART }, 0>(v)
}
#[op]
pub fn high<const N: usize, const HALF: usize>(v: Simd<u8, N>) -> Simd<u8, HALF>
where
    u8: crate::simd::Fits<N> + crate::simd::Fits<HALF>,
{
    v.shuffle::<_, { p::PART }, 1>(v)
}
#[op]
pub fn join<const HALF: usize, const N: usize>(low: Simd<u8, HALF>, high: Simd<u8, HALF>) -> Simd<u8, N>
where
    u8: crate::simd::Fits<N> + crate::simd::Fits<HALF>,
{
    low.shuffle::<_, { p::PART }, 0>(high)
}
#[inline(always)]
fn lanes<T: Lane, W: Width>(v: W::U8) -> RawOf<T, W> {
    Bits::from_bytes(v)
}

#[op]
fn halves_of<const N: usize, const HALF: usize>(all: &Shared<N>) -> [&Shared<HALF>; 2] {
    [all.first_chunk().unwrap(), all.last_chunk().unwrap()]
}

#[rules]
macro_rules! shared_in_halves {
    ($n:ident $half:ident $v:ident $bytes:literal) => {
        #[op]
        fn ${concat(load_shared, $n)}(self, from: &Shared<$bytes>) -> $v {
            let [a, b] = halves_of(from);
            join(self.${concat(load_shared, $half)}(a), self.${concat(load_shared, $half)}(b))
        }
        #[op]
        fn ${concat(store_shared, $n)}(self, to: &Shared<$bytes>, v: $v) {
            let [a, b] = halves_of(to);
            self.${concat(store_shared, $half)}(a, low(v));
            self.${concat(store_shared, $half)}(b, high(v));
        }
    };
}

/// `name::<W>` calls `name_16`, `name_32` or `name_64`.
#[rules]
macro_rules! by_width {
    // For what doesn't stay within 64 bytes. The callers take wider vectors apart.
    (whole $name:ident($($a:ident),+ $(; $x:ident: $t:ty)?)) => {
        #[op]
        fn $name<W: Width>(self, $($a: W::U8),+ $(, $x: $t)?) -> W::U8 {
            match W::BYTES {
                128 | 256 | 512 => unreachable!(),
                64 => W::from64(self.${concat($name, _64)}($(W::to64($a)),+ $(, $x)?)),
                32 => W::from32(self.${concat($name, _32)}($(W::to32($a)),+ $(, $x)?)),
                _ => W::from16(self.${concat($name, _16)}($(W::to16($a)),+ $(, $x)?)),
            }
        }
    };
    ($name:ident($($a:ident),+ $(; $x:ident: $t:ty)?)) => {
        #[op]
        fn $name<W: Width>(self, $($a: W::U8),+ $(, $x: $t)?) -> W::U8 {
            match W::BYTES {
                128 | 256 | 512 => W::by_64([$($a),+], #[inline(always)] |[$($a),+]| self.${concat($name, _64)}($($a),+ $(, $x)?)),
                64 => W::from64(self.${concat($name, _64)}($(W::to64($a)),+ $(, $x)?)),
                32 => W::from32(self.${concat($name, _32)}($(W::to32($a)),+ $(, $x)?)),
                _ => W::from16(self.${concat($name, _16)}($(W::to16($a)),+ $(, $x)?)),
            }
        }
    };
}

/// Operations within blocks of 16 bytes. What a target doesn't override is done in halves.
#[rules]
macro_rules! in_blocks {
    ($(fn $name:ident($self:ident, $($a:ident),+) $body:block)*) => {$(
        #[op]
        fn ${concat($name, _16)}($self, $($a: u8x16),+) -> u8x16 $body
        #[op]
        fn ${concat($name, _32)}(self, $($a: u8x32),+) -> u8x32 {
            join(self.${concat($name, _16)}($(low($a)),+), self.${concat($name, _16)}($(high($a)),+))
        }
        #[op]
        fn ${concat($name, _64)}(self, $($a: u8x64),+) -> u8x64 {
            join(self.${concat($name, _32)}($(low($a)),+), self.${concat($name, _32)}($(high($a)),+))
        }
        by_width!($name($($a),+));
    )*};
}

/// The same, with a fallback that works at every width that the target has registers for.
#[rules]
macro_rules! in_blocks_at_any_width {
    ($(fn $name:ident<$w:ident>($self:ident, $($a:ident),+) $body:block)*) => {$(
        #[op]
        fn ${concat($name, _fallback)}<$w: Width>($self, $($a: $w::U8),+) -> $w::U8 $body
        #[op]
        fn ${concat($name, _16)}(self, $($a: u8x16),+) -> u8x16 { self.${concat($name, _fallback)}::<B16>($($a),+) }
        #[op]
        fn ${concat($name, _32)}(self, $($a: u8x32),+) -> u8x32 {
            return_if!(Self::REGISTER >= 32, self.${concat($name, _fallback)}::<B32>($($a),+));
            join(self.${concat($name, _16)}($(low($a)),+), self.${concat($name, _16)}($(high($a)),+))
        }
        #[op]
        fn ${concat($name, _64)}(self, $($a: u8x64),+) -> u8x64 {
            return_if!(Self::REGISTER >= 64, self.${concat($name, _fallback)}::<B64>($($a),+));
            join(self.${concat($name, _32)}($(low($a)),+), self.${concat($name, _32)}($(high($a)),+))
        }
        by_width!($name($($a),+));
    )*};
}

/// Lookups in one or two whole vectors, by way of the ones for bytes.
#[rules]
macro_rules! lane_lookups {
    ($($one:ident $two:ident $t:ident;)*) => {$(
        lane_lookups!(@at $one $two $t _16 u8x16 B16);
        lane_lookups!(@at $one $two $t _32 u8x32 B32);
        lane_lookups!(@at $one $two $t _64 u8x64 B64);
        by_width!(whole $one(table, indices));
        by_width!(whole $two(a, b, indices));
    )*};
    (@at $one:ident $two:ident $t:ident $n:ident $v:ident $w:ident) => {
        #[op]
        fn ${concat($one, $n)}(self, table: $v, indices: $v) -> $v {
            return_if!(Self::BY_HAND && $w::BYTES == 16 && size_of::<$t>() >= 4, $w::from16(sse2::lanes(size_of::<$t>(), $w::to16(table), $w::to16(indices))));
            return_if!(Self::LOOKS_UP_IN_MEMORY, lookup_lanes::<$t, $w, 1, _>([table], indices));
            return_if!(crate::X86 && Self::REGISTER == 32 && $w::BYTES == 64, {
                let (table, at) = ($w::to64(table), $w::to64(indices));
                $w::from64(join(self.${concat($two, _32)}(low(table), high(table), low(at)), self.${concat($two, _32)}(low(table), high(table), high(at))))
            });
            self.${concat(lookup8, $n)}(table, byte_indices::<$t, $w, _>(indices))
        }
        #[op]
        fn ${concat($two, $n)}(self, a: $v, b: $v, indices: $v) -> $v {
            return_if!(Self::LOOKS_UP_IN_MEMORY, lookup_lanes::<$t, $w, 2, _>([a, b], indices));
            return_if!(crate::X86 && Self::REGISTER == 32 && $w::BYTES == 64 && size_of::<$t>() >= 4, {
                let in_b = lanes::<$t, $w>(indices).shl_by($t::BITS - 1 - (64 / size_of::<$t>()).ilog2()).top_bits();
                Raw::select(in_b, lanes::<$t, $w>(self.${concat($one, $n)}(b, indices)), lanes::<$t, $w>(self.${concat($one, $n)}(a, indices))).to_bytes()
            });
            self.${concat(lookup8_in_two, $n)}(a, b, byte_indices::<$t, $w, _>(indices))
        }
    };
}

#[op]
fn lookup_lanes<T: crate::Int, W: Width, const K: usize, S: crate::simd::Cpu>(
    tables: [W::U8; K],
    indices: W::U8,
) -> W::U8
where
    crate::simd::Here: crate::simd::In<S>,
{
    if const { crate::simd::ARRAYS } {
        let both: RawOf<T, W::Twice> =
            lanes::<T, W>(tables[0]).shuffle::<_, { p::PART }, 0>(lanes::<T, W>(tables[K - 1]));
        let mut found = RawOf::<T, W>::zero();
        for (lane, at) in found.lanes_mut().iter_mut().zip(lanes::<T, W>(indices).lanes()) {
            *lane = both.lanes()[at.to_u64() as usize % (K * W::BYTES / size_of::<T>())];
        }
        return found.to_bytes();
    }
    let (n, mut both) = (W::BYTES / size_of::<T>(), [T::default(); 64]);
    both[..n].copy_from_slice(lanes::<T, W>(tables[0]).to_array().as_ref());
    both[(K - 1) * n..][..n].copy_from_slice(lanes::<T, W>(tables[K - 1]).to_array().as_ref());
    let mut all = lanes::<T, W>(indices).to_array();
    for lane in all.as_mut() {
        *lane = both[lane.to_u64() as usize % (K * n)];
    }
    RawOf::<T, W>::from_array(all).to_bytes()
}

#[op]
fn compress_lanes<T: crate::Int, S: crate::simd::Cpu>(v: u8x16, bits: u64) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    let n = 16 / size_of::<T>();
    let (set, mut indices) = (SET_BITS[bits as usize & !(!0 << n)].to_le_bytes(), lanes::<T, B16>(v).to_array());
    for (index, set) in indices.as_mut().iter_mut().zip(set) {
        *index = T::from_usize(set as usize | (set as usize / 128 * n));
    }
    lookup_lanes::<T, B16, 2, _>([v, Simd::splat(0)], RawOf::<T, B16>::from_array(indices).to_bytes())
}

#[op]
fn byte_indices<T: Lane, W: Width, S: crate::simd::Cpu>(indices: W::U8) -> W::U8
where
    crate::simd::Here: crate::simd::In<S>,
{
    let size = size_of::<T>() as u8;
    return_if!(cfg!(target_arch = "aarch64") && size_of::<T>() < 8, {
        let (ones, steps) = (0x0101_0101 * size as usize, 0x0302_0100);
        let (ones, steps) = (Raw::splat(T::from_usize(ones)), Raw::splat(T::from_usize(steps)));
        lanes::<T, W>(indices).mul(ones).add(steps).to_bytes()
    });
    let first = lanes::<u16, W>(indices).shl_by(size.trailing_zeros()).to_bytes();
    let first: W::U8 = match size {
        2 => first.shuffle::<_, { p::FIRST_OF_GROUP }, 2>(first),
        4 => first.shuffle::<_, { p::FIRST_OF_GROUP }, 4>(first),
        _ => first.shuffle::<_, { p::FIRST_OF_GROUP }, 8>(first),
    };
    first.or(W::U8::iota().and(Raw::splat(size - 1)))
}

#[op]
fn carryless_lane<O: Ops>(_ops: O, a: u8x16, b: u8x16, lane: usize) -> u8x16 {
    cfg_select! {
        all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)) => {
            _ops.clmul_by_bytes(a, b, 8 * lane as u8)
        }
        _ => crate::raw::copy::from_array(
            carryless(u64x2::from_le_bytes(a)[lane], u64x2::from_le_bytes(b)[lane]).to_le_bytes(),
        ),
    }
}
/// Usual products of every fifth bit. At most 13 are added, so the carries stay in the gaps. The time doesn't depend on the bits.
#[cfg(not(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri))))]
#[cfg_attr(target_pointer_width = "32", op)]
#[cfg_attr(not(target_pointer_width = "32"), inline)]
fn carryless(a: u64, b: u64) -> u128 {
    if cfg!(any(target_arch = "aarch64", target_arch = "x86_64", target_family = "wasm")) {
        // Every fourth bit is enough for the lower half: 16 are only added from bit 60 on. The upper half is that of the reversed bits.
        let lower = always!(|a: u64, b: u64| {
            let one = |i: usize, k: usize| {
                (a & 0x1111_1111_1111_1111 << i).wrapping_mul(b & 0x1111_1111_1111_1111 << ((k + 4 - i) % 4))
            };
            let sum = |k: usize| (one(0, k) ^ one(1, k) ^ one(2, k) ^ one(3, k)) & 0x1111_1111_1111_1111 << k;
            sum(0) | sum(1) | sum(2) | sum(3)
        });
        return lower(a, b) as u128 | ((lower(a.reverse_bits(), b.reverse_bits()).reverse_bits() >> 1) as u128) << 64;
    }
    if cfg!(target_pointer_width = "32") {
        // Of halves, at most 8 are added. Three such products are enough.
        let half = always!(|a: u32, b: u32| {
            let one =
                |i: usize, k: usize| (a & 0x1111_1111 << i) as u64 * (b & 0x1111_1111 << ((k + 4 - i) % 4)) as u64;
            let sum = |k: usize| (one(0, k) ^ one(1, k) ^ one(2, k) ^ one(3, k)) & 0x1111_1111_1111_1111 << k;
            sum(0) | sum(1) | sum(2) | sum(3)
        });
        let (low, high) = (half(a as u32, b as u32), half((a >> 32) as u32, (b >> 32) as u32));
        let middle = half((a ^ a >> 32) as u32, (b ^ b >> 32) as u32) ^ low ^ high;
        return (low ^ middle << 32) as u128 | ((high ^ middle >> 32) as u128) << 64;
    }
    const FIFTH: u128 = 0x2108_4210_8421_0842_1084_2108_4210_8421;
    let part = |x: u64, i: usize| (x & (FIFTH as u64) << i) as u128;
    let mut all = 0;
    macro_rules! sums { ($($k:literal)*) => {$(
        let one = |i: usize| part(a, i) * part(b, ($k + 5 - i) % 5);
        all |= (one(0) ^ one(1) ^ one(2) ^ one(3) ^ one(4)) & FIFTH << $k;
    )*}; }
    sums!(0 1 2 3 4);
    all
}

/// Looks up zero.
const NONE: u8 = 0x80;
/// `SET_BITS` for the upper half of 16 bytes.
pub(crate) const SET_BITS_UPPER: &[u64; 256] = &{
    let (mut table, mut bits) = (*SET_BITS, 0);
    while bits < 256 {
        table[bits] |= 0x0808_0808_0808_0808;
        bits += 1;
    }
    table
};
/// For each mask: the indices of the bytes of the lanes that are true, from the lowest byte on. A row builds on that without its lowest lane.
pub(crate) const fn true_lanes<const ROWS: usize>(size: usize) -> [u128; ROWS] {
    let (mut table, mut bits, lane) = ([0; ROWS], 1, (1 << (8 * size)) - 1);
    while bits < ROWS {
        let first = (bits.trailing_zeros() as usize * size) as u128;
        table[bits] = table[bits & (bits - 1)] << (8 * size) | (first * 0x0101_0101 + 0x0302_0100) & lane;
        bits += 1;
    }
    table
}
/// The positions of the set bits of the index, one per byte, and then `NONE`.
pub(crate) const SET_BITS: &[u64; 256] = &once!(
    [u64; 256] = {
        let (set, mut table, mut bits) = (true_lanes::<256>(1), [0; 256], 0usize);
        while bits < 256 {
            table[bits] = (set[bits] | u128::from_le_bytes([NONE; 16]) << (8 * bits.count_ones())) as u64;
            bits += 1;
        }
        table
    }
);

/// The same for the bytes of `LANES` lanes in `N` bytes.
const fn set_lanes<const N: usize, const LANES: usize, const ROWS: usize>() -> [Simd<u8, N>; ROWS]
where
    u8: crate::simd::Fits<N>,
{
    let (mut table, mut bits) = ([[NONE; N]; ROWS], 0);
    let mut vectors = [Simd::from_array([0; N]); ROWS];
    while bits < ROWS {
        let (mut byte, mut count) = (0, 0);
        while byte < N {
            if bits >> (byte / (N / LANES)) & 1 != 0 {
                table[bits][count] = byte as u8;
                count += 1;
            }
            byte += 1;
        }
        vectors[bits] = Simd::from_array(table[bits]);
        bits += 1;
    }
    vectors
}
const SET_LANES_16: &[u8x16; 256] = &once!(
    [u8x16; 256] = {
        let (set, mut table, mut bits) = (true_lanes::<256>(2), [Simd::from_array([0; 16]); 256], 0usize);
        while bits < 256 {
            let none = u128::from_le_bytes([NONE; 16]).unbounded_shl(16 * bits.count_ones());
            table[bits] = Simd::from_array((set[bits] | none).to_le_bytes());
            bits += 1;
        }
        table
    }
);
const SET_LANES_32: &[u8x16; 16] = &set_lanes::<16, 4, 16>();
const SET_LANES_32_32: &[u8x32; 256] = &once!([u8x32; 256] = set_lanes::<32, 8, 256>());
const SET_LANES_64: &[u8x16; 4] = &set_lanes::<16, 2, 4>();
const SET_LANES_64_32: &[u8x32; 16] = &set_lanes::<32, 4, 16>();
/// The first `n` bytes, and then those of the upper half.
const JOIN_HALVES: &[u8x16; 9] = &{
    let (mut table, mut n) = ([Simd::from_array([0; 16]); 9], 0);
    while n < 9 {
        let (mut row, mut i) = ([NONE; 16], 0);
        while i < n + 8 {
            row[i] = (if i < n { i } else { i - n + 8 }) as u8;
            i += 1;
        }
        table[n] = Simd::from_array(row);
        n += 1;
    }
    table
};

/// The number of bits that are set among the lowest `n`. AArch64 takes it through a vector register.
#[op]
pub fn count_bits_on<O: Ops>(bits: u64, n: usize) -> usize {
    // Loops that compress on AVX-512 were up to 30% faster, but for 16 lanes.
    let bits = if const { crate::X86 && O::COMPRESS[2] == 64 } && n != 16 { crate::regs::number(bits) } else { bits };
    choose! { O::NO_POPCNT => counted::<true>(bits, n), _ => counted::<false>(bits, n) }
}
#[op]
fn counted<const TABLE: bool>(bits: u64, n: usize) -> usize {
    // LLVM knows the range of an `enum` that it loads.
    macro_rules! counts { ($bits:ident $rows:literal $size:ident $($count:ident)*) => {{
        #[derive(Copy, Clone)]
        #[repr($size)]
        enum Count { $($count),* }
        const COUNTS: &[Count; $rows] = &{
            let (mut table, mut bits) = ([Count::A; $rows], 0usize);
            while bits < $rows {
                table[bits] = [$(Count::$count),*][bits.count_ones() as usize];
                bits += 1;
            }
            table
        };
        COUNTS[$bits as usize % $rows] as usize
    }}; }
    if cfg!(target_arch = "aarch64") | TABLE && n <= 8 {
        let bits = bits & !0 >> (64 - n);
        if n <= 2 {
            return (bits as usize + 1) >> 1;
        }
        return if n <= 4 { counts!(bits 16 u16 A B C D E) } else { counts!(bits 256 u8 A B C D E F G H I) }.min(n);
    }
    (bits & !0 >> (64 - n)).count_ones() as usize
}

#[op]
pub fn set_bits(bits: u64) -> u8x8 {
    crate::raw::copy::from_array::<u8, 8>(SET_BITS[bits as u8 as usize].to_le_bytes())
}

/// `set_bits` of the lowest four bits, each one twice.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
#[op]
pub fn set_pairs(bits: u64) -> u8x8 {
    const TABLE: &[u64; 16] = &{
        let (mut table, mut bits) = ([0; 16], 0);
        while bits < 16 {
            table[bits] = SET_BITS[((bits & 1) | (bits & 2) << 1 | (bits & 4) << 2 | (bits & 8) << 3) * 3];
            bits += 1;
        }
        table
    };
    crate::raw::copy::from_array::<u8, 8>(TABLE[bits as usize & 15].to_le_bytes())
}

/// From `32 - n` on: `n` negative numbers, and then 0, 1, 2..
const SLIDE: &[u8; 96] = &crate::access::InPage({
    let (mut table, mut i) = ([0x80; 96], 0);
    while i < 64 {
        table[32 + i] = i as u8;
        i += 1;
    }
    table
})
.0;

#[rules]
macro_rules! compress_in_halves {
    ($($name:ident $size:literal;)*) => {$(
        compress_in_halves!(@at $name $size _32 _16 u8x32 16);
        compress_in_halves!(@at $name $size _64 _32 u8x64 32);
        by_width!(whole $name(v; bits: u64));
    )*};
    (@at $name:ident $size:literal $n:ident $half:ident $v:ident $bytes:literal) => {
        #[op]
        fn ${concat($name, $n)}(self, v: $v, bits: u64) -> $v {
            let lower = bits & ((1 << ($bytes / $size)) - 1);
            let (first, second) =
                (self.${concat($name, $half)}(low(v), lower), self.${concat($name, $half)}(high(v), bits >> ($bytes / $size)));
            self.${concat(append, $n)}(first, lower.count_ones() as usize * $size, second)
        }
    };
}

macro_rules! crc {
    ($($name:ident $t:ty, $tables:ident;)*) => {$(
        #[op]
        fn $name(self, crc: u32, data: $t) -> u32 {
            const TABLES: &[[u32; 256]; size_of::<$t>()] = &{ *$tables.first_chunk().unwrap() };
            let (all, mut crc) = (crc as u64 ^ data as u64, crc.unbounded_shr(<$t>::BITS));
            unrolled!(8, for i in 0..(TABLES.len()) {
                crc ^= TABLES[TABLES.len() - 1 - i][(all >> (8 * i)) as u8 as usize];
            });
            crc
        }
    )*};
}
/// Of each byte, followed by no zeros, by one, and so on.
const fn crc_tables(polynomial: u32) -> [[u32; 256]; 8] {
    let (mut all, mut i) = ([[0; 256]; 8], 0);
    while i < 256 * 8 {
        all[i / 256][i % 256] = if i >= 256 {
            let shorter = all[i / 256 - 1][i % 256];
            shorter >> 8 ^ all[0][shorter as usize % 256]
        } else if i & i.wrapping_sub(1) != 0 {
            all[0][i & (i - 1)] ^ all[0][i & !(i - 1)]
        } else {
            let (mut crc, mut bit) = (i as u32, 0);
            while bit < 8 {
                (crc, bit) = (crc >> 1 ^ polynomial & (crc & 1).wrapping_neg(), bit + 1);
            }
            crc
        };
        i += 1;
    }
    all
}
const CRC32: [[u32; 256]; 8] = once!([[u32; 256]; 8] = crc_tables(0xedb8_8320));
const CRC32C: [[u32; 256]; 8] = once!([[u32; 256]; 8] = crc_tables(0x82f6_3b78));

macro_rules! pack {
    ($a:ident, $b:ident, $from:ident, $both:ident, $to:ident) => {{
        let both: $both = $from::from_le_bytes($a).shuffle::<_, { p::PART }, 0>($from::from_le_bytes($b));
        let clamped = both.simd_clamp(Simd::splat($to::MIN as _), Simd::splat($to::MAX as _));
        clamped.cast::<$to, _>().to_le_bytes()
    }};
}

#[op]
fn products_i16<S: crate::simd::Cpu>(a: u8x16, b: u8x16) -> i32x8
where
    crate::simd::Here: crate::simd::In<S>,
{
    i16x8::from_le_bytes(a).cast::<i32, _>().mul(i16x8::from_le_bytes(b).cast::<i32, _>())
}

/// The lower and the upper half of each lane of `T`, extended with zeros or the sign.
#[op]
fn halves<T: Lane, W: Width, S: crate::simd::Cpu>(v: W::U8) -> (RawOf<T, W>, RawOf<T, W>)
where
    crate::simd::Here: crate::simd::In<S>,
{
    let (v, by) = (lanes::<T, W>(v), T::BITS / 2);
    (v.shl_by(by).shr_by(by), v.shr_by(by))
}
#[op]
fn sums_of_halves<T: Lane, W: Width, S: crate::simd::Cpu>(v: W::U8) -> W::U8
where
    crate::simd::Here: crate::simd::In<S>,
{
    let (even, odd) = halves::<T, W, _>(v);
    even.add(odd).to_bytes()
}
#[op]
fn dot<O: Ops, A: Lane, B: Lane, W: Width>(ops: O, a: W::U8, b: W::U8, sum: W::U8) -> W::U8 {
    let ((a0, a1), (b0, b1)) = (halves::<A, W, _>(a), halves::<B, W, _>(b));
    let even = ops.mul_add_i16::<W>(a0.to_bytes(), b0.to_bytes());
    let odd = ops.mul_add_i16::<W>(a1.to_bytes(), b1.to_bytes());
    lanes::<u32, W>(even).add(lanes::<u32, W>(odd)).add(lanes::<u32, W>(sum)).to_bytes()
}
#[op]
fn sign<T: Lane, W: Width, S: crate::simd::Cpu>(v: W::U8, of: W::U8) -> W::U8
where
    crate::simd::Here: crate::simd::In<S>,
{
    let v = lanes::<T, W>(v);
    return_if!(crate::WASM, {
        let sign = RawOf::<T, W>::from_mask(lanes::<T, W>(of).top_bits());
        v.xor(sign).sub(sign).to_bytes()
    });
    Raw::select(lanes::<T, W>(of).top_bits(), v.neg(), v).to_bytes()
}
/// Looks up in `table` what is in `first..first + 16`, and gives zero for the other indices.
#[op]
fn lookup_in_block<O: Ops, W: Width>(ops: O, table: W::U8, indices: W::U8, first: u8) -> W::U8 {
    return_if!(crate::WASM, ops.table_from::<W>(table, indices, (first, W::BYTES > 16)));
    ops.table::<W>(table, indices.sub(Raw::splat(first)).saturating_add(Raw::splat(O::TABLE_BIAS)))
}
#[op]
fn lookup_in_blocks<O: Ops, W: Width>(ops: O, table: W::U8, indices: W::U8, first: u8) -> W::U8 {
    macro_rules! block {
        ($k:literal) => {
            lookup_in_block::<O, W>(
                ops,
                table.shuffle::<_, { p::BROADCAST_BLOCK }, $k>(table),
                indices,
                first + 16 * $k,
            )
        };
    }
    choose! { W::BYTES == 64 => block!(0).or(block!(1)).or(block!(2).or(block!(3))), _ => block!(0).or(block!(1)) }
}
/// The same in one table or two, as `in_chain_or_zero`.
#[op]
fn lookup_in_chain<O: Ops, W: Width, const TWO: bool>(ops: O, a: W::U8, b: W::U8, indices: W::U8) -> W::U8 {
    // LLVM makes shuffles of these.
    if are_known!(indices) {
        let first = lookup_in_blocks::<O, W>(ops, a, indices, 0);
        return choose! { TWO => first.or(lookup_in_blocks::<O, W>(ops, b, indices, W::BYTES as u8)), _ => first };
    }
    macro_rules! chain { ($($from:ident $k:literal)*) => {{
        let (mut found, mut above, mut bias) = (W::U8::zero(), W::U8::zero(), 128 - 16 * [$($k),*].len() as u8);
        $(let block: W::U8 = $from.shuffle::<_, { p::BROADCAST_BLOCK }, $k>($from);
        found = found.xor(ops.table::<W>(block.xor(above), indices.saturating_add(Raw::splat(bias))));
        (above, bias) = (block, bias + 16);)*
        let _ = (above, bias);
        found
    }}; }
    choose! {
        W::BYTES == 64 && TWO => chain!(b 3 b 2 b 1 b 0 a 3 a 2 a 1 a 0),
        W::BYTES == 64 => chain!(a 3 a 2 a 1 a 0),
        TWO => chain!(b 1 b 0 a 1 a 0),
        _ => chain!(a 1 a 0),
    }
}

/// All bits are set in the lanes of `v` that are in `set`.
#[op]
fn matches<T: Lane, S: crate::simd::Cpu>(v: u8x16, set: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    let equal =
        always!(|set: u8x16| RawOf::<T, B16>::from_mask(lanes::<T, B16>(v).eq(lanes::<T, B16>(set))).to_bytes());
    return_if!(crate::X86, {
        // `pshufd` turns by four bytes.
        let four = always!(|by: u32| {
            let set = u32x4::from_le_bytes(set);
            let set = (if by == 0 { set } else { set << by | set >> (32 - by) }).to_le_bytes();
            equal(set)
                | equal(set.rotate_elements_left::<4>())
                | (equal(set.rotate_elements_left::<8>()) | equal(set.rotate_elements_left::<12>()))
        });
        choose! { size_of::<T>() == 1 => four(0) | four(8) | (four(16) | four(24)), _ => four(0) | four(16) }
    });
    macro_rules! turned { ($($k:literal)*) => { $(equal(set.rotate_elements_left::<$k>()))|* }; }
    let even = turned!(0 2 4 6) | turned!(8 10 12 14);
    choose! { size_of::<T>() == 1 => even | (turned!(1 3 5 7) | turned!(9 11 13 15)), _ => even }
}

/// Only called on targets that override them, and not done in halves.
#[rules]
macro_rules! whole {
($([$($on:tt)*] { $($rows:tt)* })+) => { $(here! { [$($on)*] whole [] $($rows)* })+ };
(@dead $($rows:tt)*) => { native! { @dead $($rows)* } };
(@live $($name:ident(v $(, $b:ident)? $(; $x:ident: $t:ty)?);)*) => {$(
    fn ${concat($name, _16)}(self, _: u8x16 $(, ${ignore($b)} _: u8x16)? $(, _: $t)?) -> u8x16 { unreachable!() }
    fn ${concat($name, _32)}(self, _: u8x32 $(, ${ignore($b)} _: u8x32)? $(, _: $t)?) -> u8x32 { unreachable!() }
    fn ${concat($name, _64)}(self, _: u8x64 $(, ${ignore($b)} _: u8x64)? $(, _: $t)?) -> u8x64 { unreachable!() }
    by_width!(whole $name(v $(, $b)? $(; $x: $t)?));
)*}; }

/// 1, 2, 4 and so on up to 128, again and again.
#[op]
fn lanes_of_bits<W: Width, S: crate::simd::Cpu>() -> W::U8
where
    crate::simd::Here: crate::simd::In<S>,
{
    W::from64(u64x8::splat(0x8040_2010_0804_0201).to_le_bytes())
}

/// From and to the lower half. LLVM calls a function for each lane on targets without the instructions.
#[rules]
macro_rules! half_floats { ($($n:ident $v:ident $lanes:literal;)*) => {$(
    #[op]
    fn ${concat(f16_to_f32, $n)}(self, v: $v) -> $v {
        return_if!(crate::X86 && $lanes == 16, {
            let v: u8x32 = v.resize();
            join::<32, 64>(self.f16_widened(low(v)), self.f16_widened(high(v))).resize()
        });
        let bits = Simd::<u16, $lanes>::from_le_bytes(low(v));
        bits.bits::<crate::simd::F16, $lanes>().cast::<f32, _>().to_le_bytes()
    }
    #[op]
    fn ${concat(f32_to_f16, $n)}(self, v: $v) -> $v {
        return_if!($lanes == 16 && Self::REGISTER == 32, self.f32_to_f16_by_32(v.resize()).resize());
        Simd::<f32, $lanes>::from_le_bytes(v).cast::<crate::simd::F16, _>().bits::<u16, $lanes>().to_le_bytes().resize()
    }
)*}; }

pub fn never<A, B>(_: A) -> B {
    unreachable!()
}

/// Only called on targets that override them. Their architectures are named as in `architectures!`.
#[rules]
macro_rules! native {
($([$($on:tt)*] { $($rows:tt)* })+) => { $(here! { [$($on)*] native [] $($rows)* })+ };
(@dead $($name:ident($($a:ident),+ $(; $x:ident: $t:ty)?);)*) => {$(
    fn $name<W: Width>(self, $(${ignore($a)} _: W::U8),+ $(, _: $t)?) -> W::U8 { unreachable!() }
)*};
($(@live)? $($name:ident($($a:ident),+ $(; $x:ident: $t:ty)?);)*) => {$(
    fn ${concat($name, _16)}(self, $($a: u8x16),+ $(, $x: $t)?) -> u8x16 { let _ = ($($a,)+ $($x)?); unreachable!() }
    #[op]
    fn ${concat($name, _32)}(self, $($a: u8x32),+ $(, $x: $t)?) -> u8x32 {
        join(self.${concat($name, _16)}($(low($a)),+ $(, $x)?), self.${concat($name, _16)}($(high($a)),+ $(, $x)?))
    }
    #[op]
    fn ${concat($name, _64)}(self, $($a: u8x64),+ $(, $x: $t)?) -> u8x64 {
        join(self.${concat($name, _32)}($(low($a)),+ $(, $x)?), self.${concat($name, _32)}($(high($a)),+ $(, $x)?))
    }
    by_width!($name($($a),+ $(; $x: $t)?));
)*}; }

pub(crate) trait Ops: crate::simd::Cpu + Copy {
    native! {
        [x86] {
            class_f16(v; kind: core::num::FpCategory); class_f32(v; kind: core::num::FpCategory); class_f64(v; kind: core::num::FpCategory); mul_add52_lower(a, b, sum);
            mul_add52_upper(a, b, sum); exponent_f16(v); scale_f16(v, by); on_f16(a, b; op: crate::half::Op); adjacent_quads(a, b; offsets: u64); double_block_quads(a, b);
            fraction_f32(v); fraction_f64(v); majority(a, b, c); multi_shift(v, counts); galois_affine(v, matrix); galois_affine_inverse(v, matrix);
            shift_each(v, counts; how: (u32, bool)); shift_each16(v, counts; how: (u32, bool)); shift_all(v; how: (u32, bool, u32));
            funnel(high, low, counts; how: (u32, bool)); rotate16(v, right); rotate32(v, right); rotate64(v, right);
            // To signed integers of the same size: whether that is 64 bits, and whether it rounds to the nearest.
            saturated_int(v; how: (bool, bool));
            // Whether the floats have 64 bits, and whether it is the greater one.
            magnitude(a, b; how: (bool, bool));
            // Where `of` is NaN, that is taken.
            or_quiet_nan(v, of);
            // Zero where `by` is less than `least`.
            scale_from(v, by, least; double: bool);
            members(v, set; by: crate::asked::Intersect);
            // A bit for each lane of 32 bits before a lane: whether they are equal.
            conflicts(v);
            // On x86: LLVM knows nothing about the result.
            hidden(v);
        }
        [x86 A64] {
            min_f16(a, b); max_f16(a, b); fma_f16(a, b, c); approximate_reciprocal_f16(v); approximate_reciprocal_sqrt_f16(v);
            complex_mul_add_f16(a, b, sum); conjugate_mul_add_f16(a, b, sum); truncate_f16(v; signed: bool); nearest_f16(v; signed: bool); dot_bf16(a, b, sum);
            scale_f32(v, by); scale_f64(v, by); exponent_f32(v); exponent_f64(v); nearest_f32_u32(v); nearest_f64_u64(v);
            // In each block on Arm. On x86 in each register, and subnormal numbers count as zero.
            narrow_bf16(a, b);
        }
        [x86] {
            truncate_f32_u32(v); truncate_f64_i64(v); truncate_f64_u64(v);
        }
        [x86 A64] {
            fma_f32(a, b, c); fma_f64(a, b, c); sqrt_f32(v); sqrt_f64(v);
        }
        [x86] {
            truncate_f32_64(v; signed: bool); saturated_dot_i16(a, b, sum);
        }
        [x86] {
            dot_u16(a, b, sum);
        }
        [x86] {
            range_f32(a, b; max: bool); range_f64(a, b; max: bool);
        }
        [A64] {
            count_u8(v, set); xor3(a, b, c); add_pairs(a, b, sum; kind: (usize, bool, bool)); add_quads(a, b, sum; signed: bool);
            wide_mul_add_f16(a, b, sum; upper: bool); add_times_i_f16(a, b); sub_times_i_f16(a, b); fused_dot_bf16(a, b, sum);
            mat_mul_bf16(a, b, sum); mul_fixed_point_31_add(a, b, sum); complex_mul_add_f32(a, b, sum); complex_mul_add_f64(a, b, sum);
            conjugate_mul_add_f32(a, b, sum); conjugate_mul_add_f64(a, b, sum); add_times_i_f32(a, b); add_times_i_f64(a, b);
            sub_times_i_f32(a, b); sub_times_i_f64(a, b); mat_mul_i8_i8(a, b, sum); mat_mul_u8_u8(a, b, sum); mat_mul_u8_i8(a, b, sum);
            add_other_sign(a, b; how: (u32, bool)); saturated_shift(v, left; how: (u32, bool)); saturated_abs64(v);
            neg_f16(v); abs_f16(v); abs_le_f16(a, b); or_nan_f16(a, b; max: bool); add_pairs_f16(a, b); extreme_of_pairs_f16(v; max: bool);
            table_in_three(a, b, c, indices); f16_of(v; signed: bool); rotate_right16(v; count: u32); rotate_right64(v; count: u32); spread_bits(v); abs_le(a, b; bits: u32);
            abs_greater(a, b; bits: u32); power_of_64ths(v; bits: u32); move_bits(v, mask; how: (crate::asked::BitPerm, u32, bool));
            quotient_or_zero(a, b; how: (usize, bool)); lanes_at(v, at; how: (usize, bool)); unbounded_shift64(v, by; left: bool);
        }
        [A64 WASM] {
            // NaN if either is.
            min_or_nan_f32(a, b); max_or_nan_f32(a, b); min_or_nan_f64(a, b); max_or_nan_f64(a, b);
        }
        [A64] {
            rotate_right32(v; count: u32); saturated_mul_add_lower_i16(a, b, sum); shift8(v, left); shift16(v, left); shift32(v, left);
            shift64(v, left); mul_high_doubled32(a, b); saturated_abs8(v); saturated_abs16(v); saturated_abs32(v);
        }
        [A64] {
            mul_fixed_point_31(a, b);
        }
        [A64] {
            average_i16(a, b); average_i32(a, b); mul_high_doubled(a, b);
        }
        [A64] {
            pack_u16_u8(a, b); pack_u32_u16(a, b); pack_u64_u32(a, b); pack_i64_i32(a, b); pack_i64_u32(a, b);
        }
        [A64] {
            // To the right, by the negative of `left`.
            rounding_shift_u8(v, left); rounding_shift_i8(v, left); rounding_shift_u16(v, left); rounding_shift_i16(v, left);
            rounding_shift_u32(v, left); rounding_shift_i32(v, left); rounding_shift_u64(v, left); rounding_shift_i64(v, left);
        }
        [x86 A64] {
            nearest_f64_i64(v);
        }
        [A64] {
            mul_fixed_point_15_add(a, b, sum);
        }
        [A64 WASM] {
            mul_wide(a, b; kind: (usize, bool, bool));
        }
        [A64 WASM] {
            mul_high(a, b; kind: (usize, bool));
        }
        [WASM] {
            // The first operand. A constant leaves loops.
            hoisted(v, other);
            table_relaxed(table, indices);
            // Its first index, and whether it is one of many.
            table_from(table, indices; at: (u8, bool));
            extreme_relaxed(a, b; kind: (u32, bool));
            dot_u7_i8(a, b, sum);
            fma_relaxed(a, b, c; bits: u32);
        }
    }
    crate::sha::sha_ops!();
    whole! {
        [x86] {
            // For lanes of which `COMPRESS` is 64.
            partition8(v; bits: u64);
            // The narrower lanes are in the lower part. `how`: with a sign, and to the nearest.
            f16_to_32(v; how: (bool, bool)); nearest_f32_64(v; signed: bool); nearest_f64_u32(v);
        }
        [x86] {
            truncate_f64_u32(v);
        }
        [x86] {
            // For lanes of which `COMPRESS` is 64.
            expand8(v, or; bits: u64); expand16(v, or; bits: u64); expand32(v, or; bits: u64); expand64(v, or; bits: u64);
            compress_zero8(v; bits: u64); compress_zero16(v; bits: u64); compress_zero32(v; bits: u64); compress_zero64(v; bits: u64);
        }
        [A64] {
            min_across_f32(v); max_across_f32(v);
        }
    }
    /// The size of the widest vector registers.
    const REGISTER: usize;
    /// The same as a type.
    type Register: Width;
    /// With this added to the indices, `table` gives zero for those that were 16 or more.
    const TABLE_BIAS: u8 = 0x70;
    const HAS_MATCH: bool = false;
    /// Whether `table` is an instruction, and so takes the same time for all indices.
    const LOOKS_UP_IN_REGISTERS: bool = true;
    /// Whether `table` loads each byte, so that it is better to load lanes.
    const LOOKS_UP_IN_MEMORY: bool = Self::BY_HAND;
    const NO_POPCNT: bool = Self::BY_HAND && !cfg!(target_feature = "popcnt");
    /// Whether this is x86 before SSSE3.
    const BY_HAND: bool = crate::X86 && cfg!(target_feature = "sse2") && !Self::LOOKS_UP_IN_REGISTERS;

    /// The index of the first byte of `v` that is in `set`, if `HAS_MATCH`.
    #[op]
    fn first_match(self, v: u8x16, set: u8x16) -> Option<usize> {
        let _ = (v, set);
        unreachable!()
    }
    /// The widest vector of lanes of 1, 2, 4 and 8 bytes that is compressed without going through memory.
    const COMPRESS: [usize; 4] = [8, 16, 16, 16];

    #[op]
    fn load_shared_16(self, from: &Shared<16>) -> u8x16 {
        let [a, b] = halves_of(from);
        crate::raw::copy::from_array::<u64, 2>([shared::load_8(a), shared::load_8(b)]).to_le_bytes()
    }
    #[op]
    fn store_shared_16(self, to: &Shared<16>, v: u8x16) {
        let ([a, b], v) = (halves_of(to), u64x2::from_le_bytes(v));
        shared::store_8(a, v[0]);
        shared::store_8(b, v[1]);
    }
    shared_in_halves!(_32 _16 u8x32 32);
    shared_in_halves!(_64 _32 u8x64 64);
    #[op]
    fn load_shared_32x2(self, from: &Shared<64>) -> u8x64 {
        self.load_shared_64(from)
    }
    #[op]
    fn load_shared_32x4(self, from: &Shared<128>) -> [u8x32; 4] {
        let [a, b] = halves_of::<128, 64>(from);
        let ([a, b], [c, d]) = (halves_of(a), halves_of(b));
        [self.load_shared_32(a), self.load_shared_32(b), self.load_shared_32(c), self.load_shared_32(d)]
    }
    #[op]
    fn load_shared_64x2(self, from: &Shared<128>) -> [u8x64; 2] {
        let [a, b] = halves_of(from);
        [self.load_shared_64(a), self.load_shared_64(b)]
    }
    #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
    fn stream_16(self, _: crate::stream::Part<'_>, _: u8x16) {
        unreachable!()
    }
    #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
    fn stream_32(self, _: crate::stream::Part<'_>, _: u8x32) {
        unreachable!()
    }
    #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
    fn stream_64(self, _: crate::stream::Part<'_>, _: u8x64) {
        unreachable!()
    }
    // Only for targets of x86-64 with HAS_MASKED_MEMORY.
    fn load_shared_n_16(self, _: &[AtomicU8], _: usize) -> u8x16 {
        unreachable!()
    }
    fn load_shared_n_32(self, _: &[AtomicU8], _: usize) -> u8x32 {
        unreachable!()
    }
    fn load_shared_n_64(self, _: &[AtomicU8], _: usize) -> u8x64 {
        unreachable!()
    }
    fn store_shared_n_16(self, _: &[AtomicU8], _: u8x16) {
        unreachable!()
    }
    fn store_shared_n_32(self, _: &[AtomicU8], _: u8x32) {
        unreachable!()
    }
    fn store_shared_n_64(self, _: &[AtomicU8], _: u8x64) {
        unreachable!()
    }
    fn gather_four(self, _: &[u8], _: u8x64, _: usize) -> u8x64 {
        unreachable!()
    }
    fn gather_eight(self, _: &[u8], _: u8x32, _: usize) -> u8x64 {
        unreachable!()
    }
    fn gather_four_32(self, _: &[u8], _: u8x32, _: usize) -> u8x32 {
        unreachable!()
    }
    fn rounded(self, _: u8x64, _: u8x64, _: u8x64, _: (u8, bool, crate::Round)) -> u8x64 {
        unreachable!()
    }
    fn rounded_f16(self, _: u8x64, _: u8x64, _: u8x64, _: (u8, crate::Round)) -> u8x64 {
        unreachable!()
    }
    fn converted(self, _: u8x64, _: (u8, bool, bool, crate::Round)) -> u8x64 {
        unreachable!()
    }
    fn f16_widened(self, _: u8x16) -> u8x32 {
        unreachable!()
    }
    fn f16_toward(self, _: u8x32, _: crate::Round) -> u8x16 {
        unreachable!()
    }
    fn store_words_16(self, _: u8x16, _: &mut [u8]) {
        unreachable!()
    }
    fn store_words_32(self, _: u8x32, _: &mut [u8]) {
        unreachable!()
    }
    fn load_words_16(self, _: &[u8]) -> u8x16 {
        unreachable!()
    }
    fn load_words_32(self, _: &[u8]) -> u8x32 {
        unreachable!()
    }

    in_blocks! {
        fn table(self, table, indices) {
            choose! { Self::BY_HAND => sse2::table(table, indices), crate::simd::ARRAYS => lookup_lanes::<u8, B16, 2, _>([table, Simd::zero()], indices & Simd::splat(15) | indices >> 7 << 4), _ => table.swizzle_dyn(indices & Simd::splat(0x8f)) }
        }
        fn mul_add_i16(self, a, b) {
            let products = products_i16(a, b);
            (simd_swizzle!(products, [0, 2, 4, 6]) + simd_swizzle!(products, [1, 3, 5, 7])).to_le_bytes()
        }
        fn mul_add_u8_i8(self, a, b) {
            return_if!(crate::simd::PACKED != 0, {
                let products = a.cast::<i32, _>().mul(b.bits::<i8, 16>().cast());
                let sums = simd_swizzle!(products, [0, 2, 4, 6, 8, 10, 12, 14]).add(simd_swizzle!(products, [1, 3, 5, 7, 9, 11, 13, 15]));
                sums.simd_clamp(Simd::splat(-0x8000), Simd::splat(0x7fff)).cast::<i16, _>().to_le_bytes()
            });
            let ((a0, a1), (b0, b1)) = (halves::<u16, B16, _>(a), halves::<i16, B16, _>(b));
            (a0.cast::<i16, _>() * b0).saturating_add(a1.cast::<i16, _>() * b1).to_le_bytes()
        }
        fn mul_fixed_point_15(self, a, b) {
            return_if!(Self::BY_HAND, {
                let (high, low) = (u16x8::from_le_bytes(self.mul_high_i16_16(a, b)), u16x8::from_le_bytes(a) * u16x8::from_le_bytes(b));
                (high + high + u16x8::from_le_bytes(self.average_u16_16((low >> 14).to_le_bytes(), Simd::splat(0)))).to_le_bytes()
            });
            products_i16(a, b).add(Simd::splat(0x4000)).shr_by(15).cast::<i16, _>().to_le_bytes()
        }
        fn mul_high_i16(self, a, b) { products_i16(a, b).shr_by(16).cast::<i16, _>().to_le_bytes() }
        fn mul_high_u16(self, a, b) {
            let wide = |v| u16x8::from_le_bytes(v).cast::<u32, _>();
            wide(a).mul(wide(b)).shr_by(16).cast::<u16, _>().to_le_bytes()
        }
        fn sums_of_8_abs_diff(self, a, b) {
            return_if!(crate::simd::PACKED != 0, {
                let v = a.abs_diff(b);
                u64x2::from_array([crate::simd::sum_of_8(v.resize()), crate::simd::sum_of_8(v.extract::<8, 8>())]).to_le_bytes()
            });
            sums_of_halves::<u64, B16, _>(sums_of_halves::<u32, B16, _>(sums_of_halves::<u16, B16, _>(a.abs_diff(b))))
        }
        fn pack_i16_i8(self, a, b) { pack!(a, b, i16x8, i16x16, i8) }
        fn pack_i16_u8(self, a, b) { pack!(a, b, i16x8, i16x16, u8) }
        fn pack_i32_i16(self, a, b) { pack!(a, b, i32x4, i32x8, i16) }
        fn pack_i32_u16(self, a, b) {
            return_if!(Self::BY_HAND, {
                let biased = always!(|v| { let v = i32x4::from_le_bytes(v); ((v & !(v >> 31)) - Simd::splat(0x8000)).to_le_bytes() });
                self.pack_i32_i16_16(biased(a), biased(b)) ^ u16x8::splat(0x8000).to_le_bytes()
            });
            pack!(a, b, i32x4, i32x8, u16)
        }
        fn aes_round(self, state, key) { crate::aes_fallback::round(self, state, key) }
        fn aes_last_round(self, state, key) { crate::aes_fallback::last_round(self, state, key) }
        fn aes_round_inv(self, state, key) { crate::aes_fallback::round_inv(self, state, key) }
        fn aes_last_round_inv(self, state, key) { crate::aes_fallback::last_round_inv(self, state, key) }
        fn aes_key_order(self, v) { simd_swizzle!(v, [4, 14, 14, 4, 5, 5, 15, 15, 12, 6, 6, 12, 13, 13, 7, 7]) }
        fn match_u8(self, v, set) { matches::<u8, _>(v, set) }
        fn match_u16(self, v, set) { matches::<u16, _>(v, set) }
        fn match_nonzero_u8(self, v, set) { self.match_u8_16(v, set) }
        fn match_nonzero_u16(self, v, set) { self.match_u16_16(v, set) }
        fn aes_inv_mix_columns(self, state) { crate::aes_fallback::inv_mix_columns::<Self>(state) }
        fn approximate_reciprocal(self, v) { (Simd::splat(1.0) / f32x4::from_le_bytes(v)).to_le_bytes() }
        fn approximate_reciprocal_sqrt(self, v) { (Simd::splat(1.0) / Raw::sqrt(f32x4::from_le_bytes(v))).to_le_bytes() }
        fn clmul_lower(self, a, b) { carryless_lane(self, a, b, 0) }
        fn clmul_upper(self, a, b) { carryless_lane(self, a, b, 1) }
        // Hides where `v` comes from until instructions are selected, and then disappears. It keeps `ld4` and the like whole.
        fn opaque(self, v) { v }
        fn opaque16(self, v) { v }
        fn opaque32(self, v) { v }
        fn opaque64(self, v) { v }
        // The same, and `kept` seems to be used.
        fn opaque_keeping(self, v, kept) { let _ = kept; v }
        fn truncate_f32_i32(self, v) { f32x4::from_le_bytes(v).cast::<i32, _>().to_le_bytes() }
        fn nearest_f32_i32(self, v) {
            (Raw::round_ties_even(f32x4::from_le_bytes(v))).cast::<i32, _>().to_le_bytes()
        }
    }

    in_blocks_at_any_width! {
        fn average_i8<W>(self, a, b) {
            let bias = Raw::splat(0x80);
            self.average_u8::<W>(a.xor(bias), b.xor(bias)).xor(bias)
        }
        fn approximate_reciprocal_f64<W>(self, v) { RawOf::<f64, W>::splat(1.0).div(lanes::<f64, W>(v)).to_bytes() }
        fn approximate_reciprocal_sqrt_f64<W>(self, v) { RawOf::<f64, W>::splat(1.0).div(lanes::<f64, W>(v).sqrt()).to_bytes() }
        fn galois_mul<W>(self, a, b) {
            let (mut product, mut b) = (W::U8::splat(0), b);
            macro_rules! bit { () => {
                let reduced = Raw::from_mask(product.top_bits());
                product = product.add(product).xor(W::U8::splat(0x1b).and(reduced)).xor(a.and(Raw::from_mask(b.top_bits())));
                b = b.add(b);
            }; }
            bit!(); bit!(); bit!(); bit!(); bit!(); bit!(); bit!(); bit!();
            let _ = b;
            product
        }
        fn bit_shuffle<W>(self, v, indices) {
            let iota = W::U8::iota();
            let bit = |of: W::U8| self.table::<W>(lanes_of_bits::<W, _>(), of.and(Raw::splat(7)));
            let bytes = self.table::<W>(v, indices.shr_by(3).or(iota.and(Raw::splat(8))));
            let clear = bytes.and(bit(indices)).eq(Raw::splat(0));
            self.sums_of_8_abs_diff::<W>(Raw::select(clear, Raw::splat(0), lanes_of_bits::<W, _>()), Raw::splat(0))
        }
        fn mul64<W>(self, a, b) { lanes::<u64, W>(a).mul(lanes::<u64, W>(b)).to_bytes() }
        fn average_u8<W>(self, a, b) { a.average_round(b) }
        fn average_u16<W>(self, a, b) { lanes::<u16, W>(a).average_round(lanes::<u16, W>(b)).to_bytes() }
        fn table_in_two<W>(self, a, b, indices) {
            return_if!(Self::BY_HAND, W::from16(sse2::bytes::<32, 16, _>(join(W::to16(a), W::to16(b)), W::to16(indices))));
            return_if!(crate::simd::ARRAYS, lookup_lanes::<u8, W, 2, _>([a, b], indices));
            self.table::<W>(a, indices.add(Raw::splat(Self::TABLE_BIAS))).or(self.table::<W>(b, indices.sub(Raw::splat(16))))
        }
        fn sign_i8<W>(self, v, of) { sign::<i8, W, _>(v, of) }
        fn sign_i16<W>(self, v, of) { sign::<i16, W, _>(v, of) }
        fn sign_i32<W>(self, v, of) { sign::<i32, W, _>(v, of) }
        fn floor_f32<W>(self, v) { lanes::<f32, W>(v).floor().to_bytes() }
        fn ceil_f32<W>(self, v) { lanes::<f32, W>(v).ceil().to_bytes() }
        fn trunc_f32<W>(self, v) { lanes::<f32, W>(v).trunc().to_bytes() }
        fn even_f32<W>(self, v) { lanes::<f32, W>(v).round_ties_even().to_bytes() }
        fn floor_f64<W>(self, v) { lanes::<f64, W>(v).floor().to_bytes() }
        fn ceil_f64<W>(self, v) { lanes::<f64, W>(v).ceil().to_bytes() }
        fn trunc_f64<W>(self, v) { lanes::<f64, W>(v).trunc().to_bytes() }
        fn even_f64<W>(self, v) { lanes::<f64, W>(v).round_ties_even().to_bytes() }
        fn min_f32<W>(self, a, b) { lanes::<f32, W>(a).min(lanes::<f32, W>(b)).to_bytes() }
        fn max_f32<W>(self, a, b) { lanes::<f32, W>(a).max(lanes::<f32, W>(b)).to_bytes() }
        fn min_f64<W>(self, a, b) { lanes::<f64, W>(a).min(lanes::<f64, W>(b)).to_bytes() }
        fn max_f64<W>(self, a, b) { lanes::<f64, W>(a).max(lanes::<f64, W>(b)).to_bytes() }
        fn mul_even_u32<W>(self, a, b) { halves::<u64, W, _>(a).0.mul(halves::<u64, W, _>(b).0).to_bytes() }
        fn mul_even_odd_u32<W>(self, a, b) { self.mul_even_u32::<W>(a, lanes::<u64, W>(b).shr_by(32).to_bytes()) }
        fn mul_even_i32<W>(self, a, b) {
            return_if!(Self::BY_HAND, {
                let (x, y) = (lanes::<i32, W>(a), lanes::<i32, W>(b));
                let excess = x.shr_by(31).and(y).add(y.shr_by(31).and(x));
                lanes::<u64, W>(self.mul_even_u32::<W>(a, b)).sub(lanes::<u64, W>(excess.to_bytes()).shl_by(32)).to_bytes()
            });
            halves::<i64, W, _>(a).0.mul(halves::<i64, W, _>(b).0).to_bytes()
        }
        fn sums_of_2_u8<W>(self, v) { sums_of_halves::<u16, W, _>(v) }
        fn sums_of_2_i8<W>(self, v) { sums_of_halves::<i16, W, _>(v) }
        fn sums_of_2_u16<W>(self, v) { sums_of_halves::<u32, W, _>(v) }
        fn sums_of_2_i16<W>(self, v) { sums_of_halves::<i32, W, _>(v) }
        fn sums_of_2_u32<W>(self, v) { sums_of_halves::<u64, W, _>(v) }
        fn sums_of_2_i32<W>(self, v) {
            return_if!(crate::X86, {
                // There is no arithmetic shift of 64 bits before AVX-512. To set the upper half is to clear it and to subtract both biases.
                let biased = lanes::<u64, W>(lanes::<u32, W>(v).xor(Raw::splat(1 << 31)).to_bytes());
                biased.or(Raw::splat(!0 << 32)).add(biased.shr_by(32)).to_bytes()
            });
            sums_of_halves::<i64, W, _>(v)
        }
        fn dot_u8_u8<W>(self, a, b, sum) { dot::<_, u16, u16, W>(self, a, b, sum) }
        fn dot_i8_i8<W>(self, a, b, sum) {
            return_if!(crate::X86 && Self::LOOKS_UP_IN_REGISTERS, {
                // The sign of `a` is worth -128. The negated sum of two products fits in 16 bits.
                let of = always!(|bits: u8| lanes::<i16, W>(self.mul_add_u8_i8::<W>(a.and(Raw::splat(bits)), b)));
                lanes::<u32, W>(sum).add(lanes::<u32, W>(self.mul_add_i16::<W>(of(0x80).sub(of(0x7f)).to_bytes(), Raw::splat(255)))).to_bytes()
            });
            dot::<_, i16, i16, W>(self, a, b, sum) }
        fn dot_u8_i8<W>(self, a, b, sum) {
            return_if!(crate::X86 && Self::LOOKS_UP_IN_REGISTERS, {
                let of = always!(|bits: u8| lanes::<u32, W>(self.sums_of_2_i16::<W>(self.mul_add_u8_i8::<W>(a.and(Raw::splat(bits)), b))));
                of(0x80).add(of(0x7f)).add(lanes::<u32, W>(sum)).to_bytes()
            });
            return_if!(crate::simd::PACKED != 0, {
                let (mut sum, a, b) = (lanes::<i32, W>(sum), a.to_array(), b.to_array());
                for i in 0..W::BYTES {
                    sum.lanes_mut()[i / 4] = sum.lanes()[i / 4].wrapping_add(a[i] as i32 * b[i] as i8 as i32);
                }
                sum.to_bytes()
            });
            dot::<_, u16, i16, W>(self, a, b, sum) }
    }

    // By the number in lane 0 of `count`. From 64 on, the result is zero.
    #[on(X86)]
    #[op]
    fn shift_left_u64_16(self, v: u8x16, count: u8x16) -> u8x16 {
        let by = u64x2::from_le_bytes(count)[0];
        if by < 64 { (u64x2::from_le_bytes(v) << by).to_le_bytes() } else { Simd::splat(0) }
    }
    #[on(X86)]
    #[op]
    fn shift_right_u64_16(self, v: u8x16, count: u8x16) -> u8x16 {
        let by = u64x2::from_le_bytes(count)[0];
        if by < 64 { (u64x2::from_le_bytes(v) >> by).to_le_bytes() } else { Simd::splat(0) }
    }

    /// The lowest `n` bits, for `n` below 256.
    #[op]
    fn low_bits(self, n: u32) -> u64 {
        crate::partial::first_bits(n as usize, 64)
    }
    // Only for AVX2 on x86-64.
    fn deposit(self, _bits: u64, _at: u64) -> u64 {
        unreachable!()
    }
    fn extract(self, _bits: u64, _at: u64) -> u64 {
        unreachable!()
    }

    // The highest bit of each lane. `to_bitmask` pads to eight lanes first, and LLVM doesn't always undo that.
    #[op]
    fn sign_bits32_16(self, v: u8x16) -> u64 {
        i32x4::from_le_bytes(v).is_negative().to_bitmask()
    }
    #[op]
    fn sign_bits64_16(self, v: u8x16) -> u64 {
        i64x2::from_le_bytes(v).is_negative().to_bitmask()
    }
    fn sign_bits64_32(self, _v: u8x32) -> u64 {
        unreachable!()
    }
    #[on(BY_MASK)]
    fn by_mask(self, _v: u8x16, _mask: u8x16, _bits: u32) -> u8x16 {
        unreachable!()
    }
    // All bits of a lane are equal. `size` is that of a lane.
    fn mask_bits_16(self, _v: u8x16, _size: usize) -> u64 {
        unreachable!()
    }
    #[on(SVE2 WASM)]
    fn mask_none_16(self, _v: u8x16) -> bool {
        unreachable!()
    }
    #[on(SVE2)]
    fn mask_all_16(self, _v: u8x16) -> bool {
        unreachable!()
    }
    // Only for SVE2.
    #[on(SVE2)]
    fn first_lanes(self, _n: usize, _size: usize) -> u8x16 {
        unreachable!()
    }
    #[on(NEON)]
    fn opaque_8(self, _: u8x8) -> u8x8 {
        unreachable!()
    }
    #[on(A64)]
    fn long_products(self, _a: u8x16, _b: u8x16, _signed: bool) -> u8x16 {
        unreachable!()
    }
    #[on(A64)]
    fn products(self, _a: u8x16, _b: u8x16, _size: usize, _signed: bool) -> [u8x16; 2] {
        unreachable!()
    }
    #[on(A64)]
    fn opaque_lanes_8(self, _: u8x8, _size: usize) -> u8x8 {
        unreachable!()
    }
    #[on(A64)]
    fn mul64_pair(self, _: u8x32, _: u8x32) -> u8x32 {
        unreachable!()
    }
    #[cfg(target_arch = "aarch64")]
    fn clmul_by_bytes(self, _a: u8x16, _b: u8x16, _from: u8) -> u8x16 {
        unreachable!()
    }
    #[cfg(target_arch = "aarch64")]
    fn shuffle_two(self, _a: u8x16, _b: u8x16, _indices: u8x16) -> u8x16 {
        unreachable!()
    }
    #[on(A64)]
    fn table_or(self, _or: u8x16, _table: u8x64, _indices: u8x16, _blocks: usize) -> u8x16 {
        unreachable!()
    }
    #[on(SVE2)]
    fn up_to_first(self, _mask: u8x16, _size: usize, _with: bool) -> u8x16 {
        unreachable!()
    }
    #[on(SVE2)]
    fn compact(self, _v: u8x16, _mask: u8x16, _size: usize) -> (u8x16, usize) {
        unreachable!()
    }
    #[on(SVE2)]
    fn count_lanes(self, _mask: u8x16, _size: usize) -> usize {
        unreachable!()
    }
    #[on(SVE2)]
    fn leading_lanes(self, _mask: u8x16, _size: usize) -> usize {
        unreachable!()
    }
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
    fn load_lanes(self, _from: crate::sve::Lanes<'_, false>) -> u8x16 {
        unreachable!()
    }
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
    fn load_lanes_or(self, _from: crate::sve::Lanes<'_, false>, _or: u8x16) -> u8x16 {
        unreachable!()
    }
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
    fn load_lanes_masked(self, _from: crate::sve::Lanes<'_, false>, _mask: u8x16) -> u8x16 {
        unreachable!()
    }
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
    fn store_lanes(self, _to: crate::sve::Lanes<'_, true>, _v: u8x16, _mask: Option<u8x16>) {
        unreachable!()
    }
    #[on(SVE2)]
    #[op]
    fn load_first<T: Lane>(self, _from: &[T], _or: Option<u8x16>) -> u8x16 {
        cfg_select! {
            all(target_arch = "aarch64", target_feature = "neon", target_endian = "little") => {
                let from = crate::sve::Lanes::<false>::of(_from);
                if let Some(or) = _or { self.load_lanes_or(from, or) } else { self.load_lanes(from) }
            }
            _ => unreachable!(),
        }
    }
    #[on(SVE2)]
    #[op]
    fn store_first<T: Lane>(self, _to: Result<&mut [T], &mut [core::mem::MaybeUninit<T>]>, _v: u8x16) {
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
        self.store_lanes(crate::sve::Lanes::<true>::of(_to), _v, None)
    }
    #[on(SVE2)]
    #[op]
    fn load_masked<T: Lane>(self, _from: &[T], _mask: u8x16) -> u8x16 {
        cfg_select! {
            all(target_arch = "aarch64", target_feature = "neon", target_endian = "little") => {
                self.load_lanes_masked(crate::sve::Lanes::<false>::of(_from), _mask)
            }
            _ => unreachable!(),
        }
    }
    #[on(SVE2)]
    #[op]
    fn store_masked<T: Lane>(self, _to: &mut [T], _v: u8x16, _mask: u8x16) {
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
        self.store_lanes(crate::sve::Lanes::<true>::of(Ok(_to)), _v, Some(_mask))
    }

    fn any_subnormal_f32_16(self, _: u8x16, _: u8x16) -> bool {
        unreachable!()
    }
    fn any_subnormal_f32_32(self, _: u8x32, _: u8x32) -> bool {
        unreachable!()
    }
    fn any_subnormal_f32_64(self, _: u8x64, _: u8x64) -> bool {
        unreachable!()
    }
    #[op]
    fn any_subnormal_f32<W: Width>(self, a: W::U8, b: W::U8) -> bool {
        choose! {
            W::BYTES == 64 => self.any_subnormal_f32_64(W::to64(a), W::to64(b)),
            W::BYTES == 32 => self.any_subnormal_f32_32(W::to32(a), W::to32(b)),
            _ => self.any_subnormal_f32_16(W::to16(a), W::to16(b)),
        }
    }

    // The result is in the lower half.
    #[op]
    fn truncate_f64_i32_16(self, v: u8x16) -> u8x16 {
        f64x2::from_le_bytes(v).cast::<i32, _>().to_le_bytes().resize()
    }
    #[op]
    fn truncate_f64_i32_32(self, v: u8x32) -> u8x32 {
        let (a, b) = (self.truncate_f64_i32_16(low(v)), self.truncate_f64_i32_16(high(v)));
        a.shuffle::<u8x16, { p::LOWER_LOWER }, 0>(b).resize()
    }
    #[op]
    fn truncate_f64_i32_64(self, v: u8x64) -> u8x64 {
        let (a, b) = (self.truncate_f64_i32_32(low(v)), self.truncate_f64_i32_32(high(v)));
        a.shuffle::<u8x32, { p::LOWER_LOWER }, 0>(b).resize()
    }
    by_width!(whole truncate_f64_i32(v));
    fn nearest_f64_i32_16(self, _: u8x16) -> u8x16 {
        unreachable!()
    }
    #[op]
    fn nearest_f64_i32_32(self, v: u8x32) -> u8x32 {
        let (a, b) = (self.nearest_f64_i32_16(low(v)), self.nearest_f64_i32_16(high(v)));
        a.shuffle::<u8x16, { p::LOWER_LOWER }, 0>(b).resize()
    }
    #[op]
    fn nearest_f64_i32_64(self, v: u8x64) -> u8x64 {
        let (a, b) = (self.nearest_f64_i32_32(low(v)), self.nearest_f64_i32_32(high(v)));
        a.shuffle::<u8x32, { p::LOWER_LOWER }, 0>(b).resize()
    }
    by_width!(whole nearest_f64_i32(v));
    fn odd_f64_f32_16(self, _: u8x16) -> u8x16 {
        unreachable!()
    }
    fn odd_f64_f32_32(self, _: u8x32) -> u8x32 {
        unreachable!()
    }
    #[op]
    fn odd_f64_f32_64(self, v: u8x64) -> u8x64 {
        let (a, b) = (self.odd_f64_f32_32(low(v)), self.odd_f64_f32_32(high(v)));
        a.shuffle::<u8x32, { p::LOWER_LOWER }, 0>(b).resize()
    }
    by_width!(whole odd_f64_f32(v));
    half_floats! { _16 u8x16 4; _32 u8x32 8; _64 u8x64 16; }
    #[op]
    fn f32_to_f16_by_32(self, v: u8x64) -> u8x64 {
        self.f32_to_f16_32(low(v)).shuffle::<u8x32, { p::LOWER_LOWER }, 0>(self.f32_to_f16_32(high(v))).resize()
    }
    by_width!(whole f16_to_f32(v));
    by_width!(whole f32_to_f16(v));

    #[op]
    fn lookup8_16(self, table: u8x16, indices: u8x16) -> u8x16 {
        choose! { Self::BY_HAND => sse2::permute(table, indices), _ => self.table_16(table, indices) }
    }
    #[op]
    fn lookup8_32(self, table: u8x32, indices: u8x32) -> u8x32 {
        return_if!(cfg!(all(target_arch = "aarch64", not(miri))) && Self::LOOKS_UP_IN_REGISTERS, {
            let half = always!(|at| self.lookup8_in_two_16(low(table), high(table), at));
            join(half(low(indices)), half(high(indices)))
        });
        return_if!(
            Self::BY_HAND,
            join(sse2::bytes::<32, 16, _>(table, low(indices)), sse2::bytes::<32, 16, _>(table, high(indices)))
        );
        return_if!(crate::X86 && Self::REGISTER >= 32, {
            // The highest bit is set where the index is in the other block.
            let here = indices.add(join(u8x16::splat(0x70), u8x16::splat(0xf0)));
            let swapped = table.shuffle::<u8x32, { p::SWAP_BLOCKS }, 0>(table);
            self.table_32(table, here).or(self.table_32(swapped, here.xor(Simd::splat(0x80))))
        });
        return_if!(
            crate::X86 && Self::LOOKS_UP_IN_REGISTERS,
            lookup_in_chain::<_, B32, false>(self, table, table, indices)
        );
        lookup_in_blocks::<_, B32>(self, table, indices, 0)
    }
    #[op]
    fn lookup8_64(self, table: u8x64, indices: u8x64) -> u8x64 {
        return_if!(Self::BY_HAND, {
            let half = always!(|indices: u8x32| {
                join::<16, 32>(
                    sse2::bytes::<64, 32, _>(table, low(indices)),
                    sse2::bytes::<64, 32, _>(table, high(indices)),
                )
            });
            join(half(low(indices)), half(high(indices)))
        });
        return_if!(crate::X86 && Self::REGISTER == 64, {
            macro_rules! block {
                ($k:literal) => {
                    self.table_64(table.shuffle::<u8x64, { p::BROADCAST_BLOCK }, $k>(table), indices)
                };
            }
            let bit = always!(|by: u32| u16x32::from_le_bytes(indices).shl_by(by).to_le_bytes().top_bits());
            let (odd, upper) = (bit(3), bit(2));
            upper.select(odd.select(block!(3), block!(2)), odd.select(block!(1), block!(0)))
        });
        return_if!(
            crate::X86 && Self::LOOKS_UP_IN_REGISTERS,
            lookup_in_chain::<_, B64, false>(self, table, table, indices)
        );
        lookup_in_blocks::<_, B64>(self, table, indices, 0)
    }
    #[op]
    fn lookup8_in_two_16(self, a: u8x16, b: u8x16, indices: u8x16) -> u8x16 {
        return_if!(Self::LOOKS_UP_IN_MEMORY && !Self::BY_HAND, lookup_lanes::<u8, B16, 2, _>([a, b], indices));
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if are_known!(indices) && u128::from_ne_bytes(indices.to_array()) & (!0 / 255 * 0xe0) == 0 {
            return self.shuffle_two(a, b, indices);
        }
        self.table_in_two_16(a, b, indices)
    }
    #[op]
    fn lookup8_in_two_32(self, a: u8x32, b: u8x32, indices: u8x32) -> u8x32 {
        return_if!(
            Self::BY_HAND,
            join(
                sse2::bytes::<64, 32, _>(join(a, b), low(indices)),
                sse2::bytes::<64, 32, _>(join(a, b), high(indices))
            )
        );
        return_if!(crate::X86 && Self::REGISTER >= 32, {
            let (within, in_b) = (indices.and(Simd::splat(31)), u16x16::from_le_bytes(indices).shl_by(2).to_le_bytes());
            Raw::select(in_b.top_bits(), self.lookup8_32(b, within), self.lookup8_32(a, within))
        });
        return_if!(crate::X86 && Self::LOOKS_UP_IN_REGISTERS, lookup_in_chain::<_, B32, true>(self, a, b, indices));
        lookup_in_blocks::<_, B32>(self, a, indices, 0).or(lookup_in_blocks::<_, B32>(self, b, indices, 32))
    }
    #[op]
    fn lookup8_in_two_64(self, a: u8x64, b: u8x64, indices: u8x64) -> u8x64 {
        return_if!(Self::BY_HAND, {
            let both = [a.to_array(), b.to_array()];
            let table: &[u8; 128] = both.as_flattened().first_chunk().unwrap();
            let half = always!(|indices: u8x32| {
                join::<16, 32>(sse2::by_memory(table, low(indices)), sse2::by_memory(table, high(indices)))
            });
            join(half(low(indices)), half(high(indices)))
        });
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if !are_known!(indices) {
            return self.lookup8_64(a, indices).or(self.lookup8_64(b, indices.xor(Simd::splat(64))));
        }
        return_if!(
            crate::WASM,
            lookup_in_blocks::<_, B64>(self, a, indices, 0).or(lookup_in_blocks::<_, B64>(self, b, indices, 64))
        );
        return_if!(
            crate::X86 && Self::LOOKS_UP_IN_REGISTERS && Self::REGISTER < 64,
            lookup_in_chain::<_, B64, true>(self, a, b, indices)
        );
        let within = indices.and(Simd::splat(63));
        let found = indices.simd_lt(Simd::splat(64)).select(self.lookup8_64(a, within), self.lookup8_64(b, within));
        // As above.
        if cfg!(target_arch = "aarch64") { indices.top_bits().select(Simd::splat(0), found) } else { found }
    }
    by_width!(whole lookup8(table, indices));
    by_width!(whole lookup8_in_two(a, b, indices));
    lane_lookups! { lookup16 lookup16_in_two u16; lookup32 lookup32_in_two u32; lookup64 lookup64_in_two u64; }

    /// `table_16` for indices below 16 and `NONE`.
    #[op]
    fn listed(self, v: u8x16, indices: u8x16) -> u8x16 {
        choose! { Self::BY_HAND => sse2::permute(v, indices), _ => self.table_16(v, indices) }
    }
    #[op]
    fn compress8_8(self, v: u8x16, bits: u64) -> u8x16 {
        return_if!(Self::BY_HAND, sse2::compress8::<false>(v, bits));
        self.listed(v, crate::raw::copy::from_array::<u64, 2>([SET_BITS[bits as u8 as usize], 0]).to_le_bytes())
    }
    #[op]
    fn compress8_16(self, v: u8x16, bits: u64) -> u8x16 {
        return_if!(Self::BY_HAND, {
            let (halves, by) =
                (sse2::compress8::<true>(v, bits), u64x2::from_array([8 * count_bits_on::<Self>(bits, 8) as u64, 0]));
            let upper = halves.shift_elements_left::<8>();
            let beyond =
                self.shift_right_u64_16(upper, (Simd::splat(64) - by).to_le_bytes()).shift_elements_right::<8>();
            halves.resize::<8>().resize() | self.shift_left_u64_16(upper, by.to_le_bytes()) | beyond
        });
        let (lower, upper) = (SET_BITS[bits as u8 as usize], (bits >> 8) as u8 as usize);
        let upper = choose! { crate::X86 => SET_BITS_UPPER[upper], _ => SET_BITS[upper] | 0x0808_0808_0808_0808 };
        let halves = self.listed(v, crate::raw::copy::from_array::<u64, 2>([lower, upper]).to_le_bytes());
        self.listed(halves, JOIN_HALVES[count_bits_on::<Self>(bits, 8)])
    }
    #[op]
    fn compress16_16(self, v: u8x16, bits: u64) -> u8x16 {
        return_if!(Self::BY_HAND, sse2::compress16(v, bits));
        choose! { Self::LOOKS_UP_IN_MEMORY => compress_lanes::<u16, _>(v, bits), _ => self.listed(v, SET_LANES_16[bits as u8 as usize]) }
    }
    #[op]
    fn compress32_16(self, v: u8x16, bits: u64) -> u8x16 {
        return_if!(Self::BY_HAND, sse2::compress32(v, bits));
        choose! { Self::LOOKS_UP_IN_MEMORY => compress_lanes::<u32, _>(v, bits), _ => self.listed(v, SET_LANES_32[bits as usize & 15]) }
    }
    #[op]
    fn compress64_16(self, v: u8x16, bits: u64) -> u8x16 {
        return_if!(Self::BY_HAND, sse2::compress64(v, bits));
        choose! { Self::LOOKS_UP_IN_MEMORY => compress_lanes::<u64, _>(v, bits), _ => self.listed(v, SET_LANES_64[bits as usize & 3]) }
    }
    // The first `n` bytes of `first`, and then `second`. Two stores and a load would stall for 14 to 25 cycles.
    #[op]
    fn append_32(self, first: u8x16, n: usize, second: u8x16) -> u8x32 {
        // The rest of `first` is zero, and so is that of the result.
        return_if!(crate::X86 && Self::LOOKS_UP_IN_REGISTERS, {
            const BLOCK: &[u8; 48] = &crate::Aligned({
                let (mut table, mut i) = ([0x80; 48], 0);
                while i < 16 {
                    table[16 + i] = i as u8;
                    i += 1;
                }
                table
            })
            .0;
            let indices = crate::raw::copy::from_slice::<u8, 32>(&BLOCK[16 - n.min(16)..]);
            self.table_32(join(second, second), indices).or(join(first, Simd::splat(0)))
        });
        let indices = crate::raw::copy::from_slice::<u8, 32>(&SLIDE[32 - n.min(16)..]);
        indices.top_bits().select(first.resize(), self.table_32(join(second, second), indices))
    }
    #[op]
    fn append_64(self, first: u8x32, n: usize, second: u8x32) -> u8x64 {
        let indices = crate::raw::copy::from_slice::<u8, 64>(&SLIDE[32 - n.min(32)..]);
        let (lower, upper): (u8x32, u8x32) = (low(indices), high(indices));
        join(lower.top_bits().select(first, self.lookup8_32(second, lower)), self.lookup8_32(second, upper))
    }
    compress_in_halves! { compress8 1; compress16 2; }
    #[op]
    fn compress32_32(self, v: u8x32, bits: u64) -> u8x32 {
        return_if!(
            cfg!(target_arch = "aarch64") && !Self::LOOKS_UP_IN_MEMORY,
            self.lookup8_32(v, SET_LANES_32_32[bits as u8 as usize])
        );
        return_if!(crate::X86 && Self::LOOKS_UP_IN_REGISTERS, {
            let n = 4 * (bits & 15).count_ones() as usize;
            self.append_32(self.compress32_16(low(v), bits), n, self.compress32_16(high(v), bits >> 4))
        });
        self.lookup32_32(v, set_bits(bits).cast::<u32, _>().to_le_bytes())
    }
    #[op]
    fn compress64_32(self, v: u8x32, bits: u64) -> u8x32 {
        self.lookup8_32(v, SET_LANES_64_32[bits as usize & 15])
    }
    compress_in_halves!(@at compress32 4 _64 _32 u8x64 32);
    compress_in_halves!(@at compress64 8 _64 _32 u8x64 32);
    by_width!(whole compress32(v; bits: u64));
    by_width!(whole compress64(v; bits: u64));

    crc! {
        crc32_u8 u8, CRC32; crc32_u16 u16, CRC32; crc32_u32 u32, CRC32; crc32_u64 u64, CRC32;
        crc32c_u8 u8, CRC32C; crc32c_u16 u16, CRC32C; crc32c_u32 u32, CRC32C; crc32c_u64 u64, CRC32C;
    }
}

/// Defines a group of operations that need the same features, and a value of size zero that proves them.
///
/// The compiler checks that the features are enough for each body, and that the callers of `new` have them. `forward!` expands in
/// `gate::tokens`, and has the one thing that it can't check.
#[allow(unused_macros)]
#[rules]
macro_rules! proof {
    ($arch:ident $name:ident $features:literal $($op:ident($($arg:ident: $t:ty),*) -> $result:ty = $body:expr;)*) => {
        #[allow(non_camel_case_types, unused_imports, unused_macros, unused_variables)]
        pub(crate) mod ${concat($name, _ops)} {
            use super::*;
            #[derive(Copy, Clone)]
            pub(crate) struct Proof(());
            impl Proof {
                #[inline]
                #[target_feature(enable = $features)]
                pub(crate) fn new() -> Self { Self(()) }
                // With inline(always), four operations get longer.
                $(#[inline] #[target_feature(enable = $features)] pub(crate) fn $op<S: crate::simd::Cpu>(self, $($arg: $t),*) -> $result { $body })*
            }

            macro_rules! forward { () => {$(
                #[inline(always)]
                fn $op(self, $($arg: $t),*) -> $result {
                    // SAFETY: this is a safe function but for its features. They are those of `new`, which made the first argument.
                    #[allow(unsafe_code, unused_unsafe)]
                    unsafe { crate::$arch::${concat($name, _ops)}::Proof::$op::<Self>(self.$name, $($arg),*) }
                }
            )*}; }
            pub(crate) use forward;
        }
    };
}

macro_rules! scales {
    () => {
        type Upto32 = <Self::Native as crate::Width>::Min<crate::B32>;
        type Half = <Self::Native as crate::Width>::Half;
        type Quarter = <<Self::Native as crate::Width>::Half as crate::Width>::Half;
        type Eighth = <<<Self::Native as crate::Width>::Half as crate::Width>::Half as crate::Width>::Half;
        type Twice = <Self::Native as crate::Width>::Twice;
        type Four = <<Self::Native as crate::Width>::Twice as crate::Width>::Twice;
        type Eight = <<<Self::Native as crate::Width>::Twice as crate::Width>::Twice as crate::Width>::Twice;
    };
}
/// A derive asks for its trait of each parameter.
macro_rules! for_derives {
    ($name:ident) => {
        impl<M: crate::gate::More> PartialEq for $name<M> {
            #[inline(always)]
            fn eq(&self, _: &Self) -> bool {
                true
            }
        }
        impl<M: crate::gate::More> Eq for $name<M> {}
        impl<M: crate::gate::More> PartialOrd for $name<M> {
            #[inline(always)]
            fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
                Some(self.cmp(other))
            }
        }
        impl<M: crate::gate::More> Ord for $name<M> {
            #[inline(always)]
            fn cmp(&self, _: &Self) -> core::cmp::Ordering {
                core::cmp::Ordering::Equal
            }
        }
        impl<M: crate::gate::More> core::hash::Hash for $name<M> {
            #[inline(always)]
            fn hash<H: core::hash::Hasher>(&self, _: &mut H) {}
        }
    };
}
/// Defines a token, which holds the groups of its target. The compiler checks that the features are enough for them.
#[allow(unused_macros)]
#[rules]
macro_rules! define_token {
    ($arch:ident $name:ident $text:expr, [$($feature:tt)*] [$($group:ident)*] $words:tt) => {
        #[doc = concat!("The token of ", $text, ".")]
        #[derive(Copy, Clone)]
        pub struct $name<M = ()> { $($group: crate::$arch::${concat($group, _ops)}::Proof,)* more: core::marker::PhantomData<M> }

        impl<M> $name<M> {
            /// For a function that has all features of the target.
            #[inline]
            $(#[target_feature(enable = $feature)])*
            pub fn here() -> Self {
                Self { $($group: crate::$arch::${concat($group, _ops)}::Proof::new(),)* more: core::marker::PhantomData }
            }
        }

        impl<M: crate::gate::More> crate::simd::Ambient for $name<M> { type It = crate::simd::Here; }
        const _: () = {
            const LEVEL: u8 = crate::simd::level(&[$($feature),*]);
            impl<M: crate::gate::More> crate::simd::Cpu for $name<M> { const LEVEL: u8 = LEVEL; type At = crate::simd::At<LEVEL>; }
        };
        impl<M: crate::gate::More> crate::ops::Ops for $name<M> {
            const REGISTER: usize = Named::$name.register();
            type Register = <() as Of<{ Named::$name.register() }>>::Width;
            const TABLE_BIAS: u8 = crate::$arch::TABLE_BIAS;
            #[cfg(target_arch = "wasm32")]
            crate::wasm::lend! {}
            const LOOKS_UP_IN_REGISTERS: bool = crate::$arch::LOOKS_UP_IN_REGISTERS && !matches!(Named::$name, Named::sse2);
            const HAS_MATCH: bool = <Self as crate::kernel::Has>::SVE2;
            const COMPRESS: [usize; 4] = crate::ops::compress::<Self>();
            $(crate::$arch::${concat($group, _ops)}::forward! {})*
        }

        crate::only::of_token!([M] $name<M> $words);
        #[diagnostic::do_not_recommend] impl<M: crate::gate::More> crate::Isa for $name<M> {
            const TARGET: Target = Target::of(Named::$name, &[]);
            const LISTED: Target = Self::TARGET.and::<M>();
            type Native = <() as Of<{ crate::width::native(Named::$name.bytes()) }>>::Width;
            crate::ops::scales!();
        }

        crate::ops::for_derives!($name);
        impl<M: crate::gate::More> Default for $name<M> {
            #[inline(always)]
            fn default() -> Self { <Self as crate::gate::Enter>::here() }
        }
        impl<M: crate::gate::More> core::fmt::Debug for $name<M> {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { f.write_str($text) }
        }
    };
}
#[allow(unused_imports)]
pub(crate) use {define_token, for_derives, proof, scales};

pub(crate) const fn compress<S: crate::Isa>() -> [usize; 4] {
    match () {
        _ if S::AVX512VBMI2 => [64; 4],
        _ if S::NARROW => [8, 16, 64, 64],
        _ if S::AVX512F => [16, 32, 64, 64],
        _ if S::AVX2 => [8, 16, 32, 32],
        _ => [8, 16, 16, 16],
    }
}

/// Uses only what the whole program is compiled for. Every CPU has it.
#[derive(Copy, Clone)]
pub struct Portable<M = ()>(core::marker::PhantomData<M>);

impl Portable {
    /// Any code can make this token.
    #[inline(always)]
    pub const fn new() -> Self {
        Self(core::marker::PhantomData)
    }
}

const PORTABLE: u8 = crate::simd::level(&[]);
macro_rules! portable { ($P:ident $named:ident [$($word:ident)*] $W:ty) => {
impl<M> $P<M> {
    /// As for the other tokens.
    #[inline(always)]
    pub(crate) fn here() -> Self {
        Self(core::marker::PhantomData)
    }
}

impl<M: crate::gate::More> Default for $P<M> {
    fn default() -> Self {
        Self::here()
    }
}

impl<M> core::fmt::Debug for $P<M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("portable")
    }
}

impl<M: crate::gate::More> crate::simd::Ambient for $P<M> { type It = crate::simd::Here; }
impl<M: crate::gate::More> crate::simd::Cpu for $P<M> { const LEVEL: u8 = PORTABLE; type At = crate::simd::At<PORTABLE>; }
impl<M: crate::gate::More> Ops for $P<M> {
    const LOOKS_UP_IN_REGISTERS: bool = cfg!(any(
        all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"),
        all(target_feature = "sse4.2", target_feature = "popcnt", not(miri)),
        all(target_arch = "wasm32", target_feature = "simd128"),
    ));
    const LOOKS_UP_IN_MEMORY: bool = !Self::LOOKS_UP_IN_REGISTERS && !cfg!(target_feature = "simd128");
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
    const TABLE_BIAS: u8 = crate::arm::TABLE_BIAS;
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    const TABLE_BIAS: u8 = crate::wasm::TABLE_BIAS;
    const REGISTER: usize = 16;
    type Register = B16;
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
    crate::x86::lend! { sse2 }
    #[cfg(all(target_feature = "sse4.2", target_feature = "popcnt", not(miri)))]
    crate::x86::lend! { sse4 }
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
    crate::arm::neon_lent::lend! {}
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
    crate::arm::no_dot_lent::lend! {}
    #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
    crate::arm::shared_lent::lend! {}
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    crate::wasm::lend! {}
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    #[inline(always)]
    fn mul_fixed_point_15_16(self, a: u8x16, b: u8x16) -> u8x16 {
        core::arch::wasm32::i16x8_q15mulr_sat(a.into(), b.into()).into()
    }
}

crate::only::of_token!([M] $P<M> [$($word)*]);
const _: () = assert!(crate::Named::$named.has_words(&[$(stringify!($word)),*]));
#[diagnostic::do_not_recommend] impl<M: crate::gate::More> crate::Isa for $P<M> {
    const TARGET: crate::Target = crate::Target::Portable;
    const LISTED: crate::Target = Self::TARGET.and::<M>();
    const WORDS: crate::Target = crate::Target::of(crate::Named::$named, &[]).and::<M>();
    type Native = $W;
    scales!();
}
for_derives!($P);
}; }
type Bytes<const N: usize> = <() as crate::width::Of<N>>::Width;
portable!(Portable Portable [portable] Bytes<{ crate::width::native(16) }>);
macro_rules! like { ($($alias:ident $P:ident $named:ident $words:tt $bytes:expr;)*) => {
    $(
        /// The same as [Portable], but for the width and the words: for constants that depend on them.
        #[derive(Clone, Copy)]
        pub struct $P<M = ()>(core::marker::PhantomData<M>);
        portable!($P $named $words Bytes<{ $bytes }>);
    )*
    #[allow(non_camel_case_types)]
    #[doc(hidden)]
    pub mod like { $(pub type $alias = super::$P<()>;)* }
}; }
like! {
    narrow LikeNarrow avx512_narrow [sse2 sse4 avx2 avx512 bmi crc32c fma masked narrow] crate::width::native(32);
    icelake LikeIcelake icelake [sse2 sse4 avx2 avx512 icelake aes bmi crc32c fma gfni ifma masked vaes vnni] crate::width::native(64);
    avx512 LikeAvx512 avx512 [sse2 sse4 avx2 avx512 bmi crc32c fma masked] crate::width::native(64);
    avx2 LikeAvx2 avx2 [sse2 sse4 avx2 bmi crc32c fma] crate::width::native(32);
    sse4 LikeSse4 sse4 [sse2 sse4 crc32c] crate::width::native(16);
    neon LikeNeon neon [neon fma] crate::width::native(16);
    B64 LikeB64 Portable [portable] 64;
    B32 LikeB32 Portable [portable] 32;
    B16 LikeB16 Portable [portable] 16;
}
