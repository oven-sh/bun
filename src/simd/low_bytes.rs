//! Lanes of which only the lowest bytes are in memory.

use crate::{B16, Isa, Simd, Tag, Unsigned, Width};

macro_rules! makers { ($then:ident $target:ident $S:ty) => { crate::make::$then! { $target;
    /// The reverse of [`store_low_bytes`](crate::Simd::store_low_bytes): the other bytes of a lane are zero. It also returns how many bytes
    /// the lanes took, at least one each. Panics if `from` has fewer bytes than the vector. It is `expand` on `icelake`, from 32 bytes on,
    /// and else a lookup in a table for each block.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut bytes = [0; 16];
    /// bytes[..7].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7]);
    /// let (v, n) = u32x4::load_low_bytes(&bytes, 0b10_00_01_00u64);
    /// assert_eq!((v.to_array(), n), ([1, 0x0302, 4, 0x070605], 7));
    /// # } example()
    /// ```
    #[doc(alias("varint", "streamvbyte", "vpexpandb"))]
    load_low_bytes[](from: &(impl crate::Slice<Item = impl crate::Readable<u8>> + ?Sized), more: impl crate::MoreBytes<T, W, $S>) -> (crate::Simd<T, W, $S>, usize) where [T: crate::Unsigned] = const assert!(size_of::<T>() > 1, "the lanes have 2 bytes or more"); |d| d.repartition::<u8>().staged(crate::whole::has::<crate::whole::Bytes<T, W>, _>(from), W::BYTES, #[inline(always)] |from| d.load_low_bytes(from, more));
} }; }
pub(crate) use makers;

/// How many bytes of each lane count, after the first: a vector, modulo the size of a lane, or a `u64` with 1, 2 or 3 bits for each lane of
/// 2, 4 or 8 bytes. With a mask, all bytes count where it is true. Constants are fastest as a `u64`.
#[diagnostic::on_unimplemented(message = "`{Self}` is neither a vector of this type, nor its mask, nor a `u64`")]
pub trait MoreBytes<T: Unsigned, W: Width, S: Isa>: Copy + crate::seals::MoreBytes<T, W, S> {
    #[doc(hidden)]
    const PACKED: bool = false;
    #[doc(hidden)]
    fn packed(self) -> u64;
    #[doc(hidden)]
    fn counting(self, d: Tag<S, u8, W>) -> u64;
}
pub(crate) const fn bits<T>() -> usize {
    size_of::<T>().trailing_zeros() as usize
}
/// A bit for each byte, from the number of its lane in each byte.
#[op]
fn counting<T, W: Width, S: Isa>(more: Simd<u8, W, S>) -> u64 {
    let last = size_of::<T>() as u8 - 1;
    (more.tag().iota(0) & last).simd_le(more & last).own_bits()
}

#[sealed]
impl<T: Unsigned, W: Width, S: Isa> MoreBytes<T, W, S> for u64 {
    const PACKED: bool = true;
    #[inline(always)]
    fn packed(self) -> u64 {
        self
    }
    #[op]
    fn counting(self, d: Tag<S, u8, W>) -> u64 {
        return_if!(size_of::<T>() == 2, {
            let all = !0 >> (64 - W::BYTES.min(64));
            d.simd().deposit(self, 0xaaaa_aaaa_aaaa_aaaa & all) | 0x5555_5555_5555_5555 & all
        });
        // The number goes to the highest bits of each byte, so that the others don't matter. 32 bits hold all numbers.
        let at = d.from_fn(
            #[inline(always)]
            |i| ((i / size_of::<T>() + 1) * bits::<T>() + 56) as u8 % 64,
        );
        let least = d.from_fn(
            #[inline(always)]
            |i| ((i % size_of::<T>()) << (8 - bits::<T>())) as u8,
        );
        let all = d.repartition::<u32>().set(self as u32);
        least.simd_le(at.with_bytes(d.simd().multi_shift::<W>(all.bytes(), at.bytes()))).own_bits()
    }
}
#[sealed]
impl<T: Unsigned, W: Width, S: Isa> MoreBytes<T, W, S> for Simd<T, W, S> {
    #[op]
    fn packed(self) -> u64 {
        choose! { |v: Self = self|
            size_of::<T>() == 2 => (v << 15).to_mask().to_bitmask(),
            size_of::<T>() == 4 => (v << 15 & T::from_u64(0xffff) | v << 30).bitcast::<u16>().to_mask().to_bitmask(),
            W::BYTES > 16 => v.lower_half().packed() | v.upper_half().packed() << (3 * Self::LANES / 2),
            _ => v.get_lane().to_u64() & 7 | (v.lane_dyn(Self::LANES - 1).to_u64() & 7) << (3 * Self::LANES - 3),
        }
    }
    #[op]
    fn counting(self, d: Tag<S, u8, W>) -> u64 {
        counting::<T, _, _>(self.table_lookup_bytes(d.from_fn(
            #[inline(always)]
            |i| (i % 16 / size_of::<T>() * size_of::<T>()) as u8,
        )))
    }
}

#[sealed]
impl<T: Unsigned, W: Width, S: Isa> MoreBytes<T, W, S> for crate::MaskOf<T, W, S> {
    #[op]
    fn packed(self) -> u64 {
        choose! { size_of::<T>() == 2 => self.to_bitmask(), _ => self.to_vector().bitcast::<T>().packed() }
    }
    #[op]
    fn counting(self, _: Tag<S, u8, W>) -> u64 {
        (self.to_vector().bitcast::<T>() | T::from_u64(0x80)).bitcast::<u8>().to_mask().own_bits()
    }
}

/// 1 to 16. LLVM knows the range of an `enum` that it loads.
#[derive(Copy, Clone)]
enum Count {
    A = 1,
    B,
    C,
    D,
    E,
    F,
    G,
    H,
    I,
    J,
    K,
    L,
    M,
    N,
    O,
    P,
}
#[derive(Copy, Clone)]
struct Tables<const ROWS: usize> {
    pack: [[u8; 16]; ROWS],
    unpack: [[u8; 16]; ROWS],
    count: [Count; ROWS],
}
const fn tables<const ROWS: usize>(size: usize) -> Tables<ROWS> {
    const ONES: u128 = !0 / 255;
    const STEPS: u128 = 0x0706_0504_0302_0100;
    // One lane after the other. The rows for the lanes before are read until they are overwritten.
    let (mut rows, mut before, mut at) = ([(0x80 * ONES, 0x80 * ONES, 0); ROWS], 1, 0);
    while at < 16 {
        let mut row = before * size;
        while row > 0 {
            row -= 1;
            let ((pack, unpack, count), n) = (rows[row % before], row / before + 1);
            let these = (1 << (8 * n)) - 1;
            rows[row] = (
                pack ^ (((0x80 + at as u128) * ONES + STEPS) & these) << (8 * count),
                unpack ^ (((0x80 + count as u128) * ONES + STEPS) & these) << (8 * at),
                count + n,
            );
        }
        (before, at) = (before * size, at + size);
    }
    let mut all = Tables { pack: [[0; 16]; ROWS], unpack: [[0; 16]; ROWS], count: [Count::A; ROWS] };
    while before > 0 {
        use Count::*;
        before -= 1;
        (all.pack[before], all.unpack[before]) = (rows[before].0.to_le_bytes(), rows[before].1.to_le_bytes());
        all.count[before] = [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P][rows[before].2 - 1];
    }
    all
}
const OF_2: Tables<256> = once!(Tables<256> = tables(2));
const OF_4: Tables<256> = once!(Tables<256> = tables(4));
const OF_8: Tables<64> = once!(Tables<64> = tables(8));
macro_rules! tables { ($($name:ident $t:ty, $field:ident;)*) => {$(
    #[op]
    fn $name<T>(row: u64) -> &'static $t {
        choose! {
            size_of::<T>() == 2 => {
                const IT: &[$t; 256] = &crate::Aligned(OF_2.$field).0; &IT[row as u8 as usize]
            },
            size_of::<T>() == 4 => {
                const IT: &[$t; 256] = &crate::Aligned(OF_4.$field).0; &IT[row as u8 as usize]
            },
            _ => {
                const IT: &[$t; 64] = &crate::Aligned(OF_8.$field).0; &IT[row as usize & 63]
            },
        }
    }
)*}; }
tables! { pack [u8; 16], pack; unpack [u8; 16], unpack; count Count, count; }

impl<S: Isa, T: Unsigned, W: Width> Tag<S, T, W> {
    const AT_ONCE: bool = Self::bytes_at_once::<u64>();
    /// For one block and a number, the tables take half the time.
    const fn bytes_at_once<M: MoreBytes<T, W, S>>() -> bool {
        S::COMPRESS[0] == 64 && W::BYTES >= (if M::PACKED { 32 } else { 16 }) && W::BYTES <= 64
    }

    /// The row of the tables, and the number of bytes.
    #[op]
    fn row(self, more: u64) -> (u64, usize) {
        let more = choose! { W::BYTES < 16 => more & !(!0 << (Self::LANES * bits::<T>())), _ => more };
        let all = *count::<T>(more) as usize;
        (more, choose! { W::BYTES < 16 => (all - (16 - W::BYTES.min(16)) / size_of::<T>()).min(W::BYTES), _ => all })
    }
    #[op]
    #[track_caller]
    pub(crate) fn load_low_bytes<M: MoreBytes<T, W, S>>(self, from: &[u8], more: M) -> (Simd<T, W, S>, usize) {
        require!(
            "a `u64` has too few bits for so many lanes, which have 2 bytes or more",
            Self::LANES * bits::<T>() <= 64
        );
        let from = &from[..W::BYTES];
        if const { Self::bytes_at_once::<M>() } {
            let d = self.repartition::<u8>();
            let counting = more.counting(d);
            return (d.load(from).expand(d.mask_from_bits(counting)).bitcast(), counting.count_ones() as usize);
        }
        self.unpack(from, more.packed())
    }
    #[op]
    fn unpack(self, from: &[u8], more: u64) -> (Simd<T, W, S>, usize) {
        return_if!(Self::AT_ONCE, |d: Self = self, from: &[u8] = from, more: u64 = more| d.load_low_bytes(from, more));
        return_if!(W::BYTES > 16, |d: Self = self, from: &[u8] = from, more: u64 = more| {
            let (lower, n) = d.half().unpack(from, more);
            let (upper, m) = d.half().unpack(&from[n..], more >> (Self::LANES / 2 * bits::<T>()));
            (d.combine(upper, lower), n + m)
        });
        let ((row, n), block) = (self.row(more), self.simd().fixed::<u8, B16>());
        (
            self.resize_any(
                block.resize_any(self.repartition::<u8>().load(from)).permute_bytes(block.load(unpack::<T>(row))),
            ),
            n,
        )
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    /// Stores the lowest byte of each lane and [`more`](MoreBytes) after it, without gaps, and returns how many: UTF-8, escapes, numbers of
    /// variable length. `to` needs room for the whole vector, and all of that can change.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (latin1, mut utf8) = (u8x4::from(b"caf\xe9").cast::<u16>(), [0; 8]);
    /// let two = latin1.simd_gt(0x7f);
    /// let n = two.select(latin1 >> 6 | (latin1 & 0x3f) << 8 | 0x80c0, latin1).store_low_bytes(&mut utf8, two.to_bitmask());
    /// assert_eq!(&utf8[..n], "café".as_bytes());
    /// # } example()
    /// ```
    #[doc(alias("varint", "streamvbyte", "vpcompressb", "escape"))]
    #[op]
    #[track_caller]
    pub fn store_low_bytes(
        self,
        to: &mut (impl crate::SliceMut<Item = impl crate::Writable<u8>> + ?Sized),
        more: impl MoreBytes<T, W, S>,
    ) -> usize {
        require!("a `u64` has too few bits for so many lanes, which have 2 bytes or more", Self::LANES * bits::<T>() <= 64, at any width size_of::<T>() > 1);
        self.store_low(&mut crate::whole::has_room::<crate::whole::Bytes<T, W>, _>(to)[..W::BYTES], more)
    }
    #[op]
    fn store_low<M: MoreBytes<T, W, S>>(self, to: &mut [impl crate::Writable<u8>], more: M) -> usize {
        if const { Tag::<S, T, W>::bytes_at_once::<M>() } {
            return self.bitcast::<u8>().compress_own_store(more.counting(self.tag().repartition()), to);
        }
        self.pack(self.tag().repartition().cleared(to, W::BYTES), more.packed())
    }
    #[inline(always)]
    fn pack(self, to: &mut [u8], more: u64) -> usize {
        apart!(self.s, |to: &mut [u8]| {
            return_if!(Tag::<S, T, W>::AT_ONCE, |v: Self = self, to: &mut [u8] = to, more: u64 = more| v.store_low_bytes(to, more));
            return_if!(W::BYTES > 16, |v: Self = self, to: &mut [u8] = to, more: u64 = more| {
                let n = v.lower_half().pack(to, more);
                n + v.upper_half().pack(&mut to[n..], more >> (Self::LANES / 2 * bits::<T>()))
            });
            let ((row, n), block) = (self.tag().row(more), self.s.fixed::<u8, B16>());
            self.tag()
                .repartition::<u8>()
                .resize_any(block.resize_any(self).permute_bytes(block.load(pack::<T>(row))))
                .store(to);
            n
        })
    }
}

impl crate::Output<'_, u8> {
    /// It needs room for the whole vector.
    #[op]
    #[track_caller]
    pub(crate) fn push_low<T: Unsigned, W: Width, S: Isa, M: MoreBytes<T, W, S>>(&mut self, v: Simd<T, W, S>, more: M) {
        if const { Tag::<S, T, W>::bytes_at_once::<M>() } {
            return self.push_compressed_bits(v.bitcast::<u8>(), more.counting(v.tag().repartition()));
        }
        self.window(W::BYTES).push_packed(v, more.packed())
    }
    #[op]
    fn push_packed<T: Unsigned, W: Width, S: Isa>(&mut self, v: Simd<T, W, S>, more: u64) {
        return_if!(Tag::<S, T, W>::AT_ONCE, self.push_low(v, more));
        return_if!(W::BYTES > 16, {
            self.push_packed(v.lower_half(), more);
            self.push_packed(v.upper_half(), more >> (Simd::<T, W, S>::LANES / 2 * bits::<T>()))
        });
        let ((row, n), block) = (v.tag().row(more), v.s.fixed::<u8, B16>());
        self.push_first(
            v.tag().repartition::<u8>().resize_any(block.resize_any(v).permute_bytes(block.load(pack::<T>(row)))),
            n,
        )
    }
}
