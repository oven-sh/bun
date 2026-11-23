//! Three channels of bytes on x86, by selections and one shuffle within blocks for each channel.
//!
//! Of 48 bytes in three blocks, byte `p` of block `k` belongs to the channel `(k + p) % 3`. So each channel has each
//! position in exactly one block.

use crate::{B4, B8, B16, B32, Isa, Lane, Simd, Tag, Width};

type V<S, W> = Simd<u8, W, S>;

/// LLVM would merge these steps with those of the caller, up to code that moves single bytes.
#[op]
pub(crate) fn apart<S: Isa, W: Width>(v: V<S, W>) -> V<S, W> {
    choose! { crate::X86 => v.barriers(), _ => v.midpoint_up(v) }
}

/// Byte `p` is from `of[(first + step * p) % 3]`.
#[on(X86)]
#[op]
fn select<const N: usize, S: Isa, W: Width>(of: [V<S, W>; 3], first: usize, step: usize) -> V<S, W> {
    let is = always!(|i| {
        of[0]
            .tag()
            .from_fn(
                #[inline(always)]
                |p| ((first + step * (p % N)) % 3 == i) as u8,
            )
            .simd_eq(1)
    });
    apart(is(2).if_then_else(of[2], apart(is(1).if_then_else(of[1], of[0]))))
}

#[on(X86)]
#[op]
pub(crate) fn load<S: Isa, W: Width>(d: Tag<S, u8, W>, blocks: impl Fn(usize) -> V<S, B16>) -> [V<S, W>; 3] {
    let third = always!(|k: usize| {
        let mut v = d.resize_bitcast(blocks(k));
        when!(W::BYTES >= 32, v = v.with_block::<1>(blocks(3 + k)));
        when!(W::BYTES == 64, v = v.with_block::<2>(blocks(6 + k)).with_block::<3>(blocks(9 + k)));
        apart(v)
    });
    let all = [third(0), third(1), third(2)];
    let channel = always!(|c: usize| {
        apart(select::<16, _, _>(all, c, 2).table_lookup_bytes(d.from_fn(
            #[inline(always)]
            |i| ((3 * (i % 16) + c) % 16) as u8,
        )))
    });
    [channel(0), channel(1), channel(2)]
}

#[on(X86)]
#[op]
pub(crate) fn store<S: Isa, W: Width>(channels: [V<S, W>; 3], mut block: impl FnMut(usize, V<S, B16>)) {
    let d = channels[0].tag();
    // 3 * 11 is 1 modulo 16.
    let spread = always!(|c: usize| {
        apart(apart(channels[c]).table_lookup_bytes(d.from_fn(
            #[inline(always)]
            |p| (11 * (p % 16 + 16 - c) % 16) as u8,
        )))
    });
    let all = [spread(0), spread(1), spread(2)];
    macro_rules! third { ($($k:literal)*) => {$(
        let v = select::<16, _, _>(all, $k, 1);
        block($k, v.block::<0>());
        when!(W::BYTES >= 32, {
            block(3 + $k, v.block::<1>());
        });
        when!(W::BYTES == 64, {
            block(6 + $k, v.block::<2>());
            block(9 + $k, v.block::<3>());
        });
    )*}; }
    third!(0 1 2);
}

/// Lanes of 32 bits, by their position in the block.
#[op]
fn blend<S: Isa, W: Width>(positions: u32, yes: V<S, W>, no: V<S, W>) -> V<S, W> {
    let mask = yes
        .tag()
        .repartition::<u32>()
        .from_fn(
            #[inline(always)]
            |i| positions >> (i % 4) & 1,
        )
        .simd_eq(1);
    apart(mask.if_then_else(yes.bitcast::<u32>(), no.bitcast::<u32>()).bitcast())
}
#[inline(always)]
fn turn<S: Isa, W: Width>(v: V<S, W>, by: usize) -> V<S, W> {
    apart(v.bitcast::<u32>().permute_groups([by, (by + 1) % 4, (by + 2) % 4, (by + 3) % 4]).bitcast())
}

/// Four channels, of which each has four bytes in each block. Block `k` puts those of channel `c` at the position `(c + k) % 4`.
/// That takes 7 shuffles, and not 12 or more, of which Haswell to Cascade Lake do one in a cycle.
#[on(X86)]
#[op]
pub(crate) fn load4<S: Isa, T: Lane, W: Width>(d: Tag<S, T, W>, from: &[T]) -> [Simd<T, W, S>; 4] {
    let (bytes, block, size) = (d.repartition::<u8>(), d.simd().fixed::<T, B16>(), size_of::<T>());
    let part = always!(|k: usize| {
        let mut v = bytes.resize_bitcast(block.load(&from[16 / size * k..]));
        when!(W::BYTES == 32, v = v.with_block::<1>(block.load(&from[16 / size * (4 + k)..]).bitcast()));
        apart(apart(v).table_lookup_bytes(bytes.from_fn(
            #[inline(always)]
            |i| ((i % 4 / size * 4 + (i / 4 + 4 - k) % 4) * size + i % size) as u8,
        )))
    });
    let (a, b, c, e) = (part(0), part(1), part(2), part(3));
    let (ab, ba, ce, ec) = (blend(0b0101, a, b), blend(0b0101, b, a), blend(0b0101, c, e), blend(0b0101, e, c));
    [
        blend(0b0011, ab, ce).bitcast(),
        turn(blend(0b0110, ba, ec), 1).bitcast(),
        turn(blend(0b0011, ce, ab), 2).bitcast(),
        turn(blend(0b0110, ec, ba), 3).bitcast(),
    ]
}

/// The reverse. It doesn't win for smaller lanes.
#[op]
pub(crate) fn store4<S: Isa, T: Lane, W: Width>([a, b, c, e]: [V<S, W>; 4], to: &mut [T]) {
    let (a, b, c, e, size) = (apart(a), turn(apart(b), 3), turn(apart(c), 2), turn(apart(e), 1), size_of::<T>());
    let (ab, ce, ba, ec) = (blend(0b0011, a, c), blend(0b0011, c, a), blend(0b0110, b, e), blend(0b0110, e, b));
    let mut part = always!(|k: usize, v: V<S, W>| {
        let v = apart(v.table_lookup_bytes(v.tag().from_fn(
            #[inline(always)]
            |i| ((i / size + k) % 4 * 4 + i % 16 / (4 * size) * size + i % size) as u8,
        )));
        v.block::<0>().bitcast().store(&mut to[16 / size * k..]);
        when!(W::BYTES == 32, {
            v.block::<1>().bitcast().store(&mut to[16 / size * (4 + k)..]);
        });
    });
    part(0, blend(0b0101, ab, ba));
    part(1, blend(0b0101, ba, ab));
    part(2, blend(0b0101, ce, ec));
    part(3, blend(0b0101, ec, ce));
}

/// `shufps`, or another move of four lanes in each block.
#[inline(always)]
pub(crate) fn two_of_each<S: Isa, T: Lane, W: Width>(
    a: Simd<T, W, S>,
    b: Simd<T, W, S>,
    order: [usize; 4],
) -> Simd<T, W, S> {
    apart_unoptimized!(a.s, {
        a.reinterpret::<f32>().concat_swizzle_groups(b.reinterpret(), order).barrier().reinterpret()
    })
}

/// Three channels of 32 bits, with five shuffles. The loads put the blocks in place.
#[op]
pub(crate) fn load_words<S: Isa, T: Lane, W: Width>(d: Tag<S, T, W>, from: &[T]) -> [Simd<T, W, S>; 3] {
    let (from, block) = (&from[..3 * W::BYTES / 4], d.simd().fixed::<T, B16>());
    let third =
        always!(|k: usize| { d.from_parts(0, &mut passed!(|i| block.load(&from[12 * i + 4 * k..])),).barrier() });
    let (a, b, c) = (third(0), third(1), third(2));
    let (xy, yz) = (two_of_each(b, c, [2, 3, 5, 6]), two_of_each(a, b, [1, 2, 4, 5]));
    [two_of_each(a, xy, [0, 3, 4, 6]), two_of_each(yz, xy, [0, 2, 5, 7]), two_of_each(yz, c, [1, 3, 4, 7])]
}

/// The reverse, with six.
#[op]
pub(crate) fn store_words<S: Isa, T: Lane, W: Width>([x, y, z]: [Simd<T, W, S>; 3], to: &mut [T]) {
    let to = &mut to[..3 * W::BYTES / 4];
    let (xy, yz, zx) =
        (two_of_each(x, y, [0, 2, 4, 6]), two_of_each(y, z, [1, 3, 5, 7]), two_of_each(z, x, [0, 2, 5, 7]));
    let mut third = always!(|k: usize, v: Simd<T, W, S>| {
        v.for_each_part(
            #[inline(always)]
            |i, part: Simd<T, B16, S>| part.store(&mut to[12 * i + 4 * k..]),
        )
    });
    third(0, two_of_each(xy, zx, [0, 2, 4, 6]));
    third(1, two_of_each(yz, xy, [0, 2, 5, 7]));
    third(2, two_of_each(zx, yz, [1, 3, 5, 7]));
}

/// Four channels of 32 bits.
#[on(X86)]
#[op]
pub(crate) fn load4_words<S: Isa, T: Lane, W: Width>(d: Tag<S, T, W>, from: &[T]) -> [Simd<T, W, S>; 4] {
    let (from, block) = (&from[..W::BYTES], d.simd().fixed::<T, B16>());
    let row = always!(|k: usize| { d.from_parts(0, &mut passed!(|i| block.load(&from[16 * i + 4 * k..])),).barrier() });
    d.transpose_in_blocks([row(0), row(1), row(2), row(3)])
}

/// The order of the channels in the blocks of even and of odd vectors, so that blends join them.
const TURNS: [[usize; 4]; 2] = [[0, 2, 1, 3], [2, 0, 3, 1]];

/// Four channels in 64 bytes each, with 8 shuffles that are one operation each.
#[on(X86)]
#[op]
pub(crate) fn split4<S: Isa, T: Lane, W: Width>(all: [Simd<T, W, S>; 4]) -> [Simd<T, W, S>; 4] {
    let n = all[0].tag().lanes() / 4;
    let part = always!(|k: usize| all[k].of_one(
        #[inline(always)]
        |i| i % n * 4 + TURNS[k % 2][i / n]
    ));
    let (a, b, c, d) = (part(0), part(1), part(2), part(3));
    let (p, q) = (a.blend_words(b, 0xcc).as_u128s(), b.blend_words(a, 0xcc).as_u128s());
    let (r, s) = (c.blend_words(d, 0xcc), d.blend_words(c, 0xcc));
    [
        p.concat_swizzle(r, always!(|i: usize| [0, 1, 4, 5][i])),
        p.concat_swizzle(r, always!(|i: usize| [2, 3, 6, 7][i])),
        q.concat_swizzle(s, always!(|i: usize| [1, 0, 5, 4][i])),
        q.concat_swizzle(s, always!(|i: usize| [3, 2, 7, 6][i])),
    ]
}

/// The reverse. Small lanes tend to come from a shuffle, which LLVM merges with the first step of the other way.
#[on(X86)]
#[op]
pub(crate) fn merge4<S: Isa, T: Lane, W: Width>([a, b, c, d]: [Simd<T, W, S>; 4]) -> [Simd<T, W, S>; 4] {
    let (n, a, c) = (a.tag().lanes() / 4, a.as_u128s(), c.as_u128s());
    let p = a.concat_swizzle(b, always!(|i: usize| [0, 1, 4, 5][i]));
    let r = a.concat_swizzle(b, always!(|i: usize| [2, 3, 6, 7][i]));
    let q = c.concat_swizzle(d, always!(|i: usize| [1, 0, 5, 4][i]));
    let s = c.concat_swizzle(d, always!(|i: usize| [3, 2, 7, 6][i]));
    let part = always!(|v: Simd<T, W, S>, odd: usize| v.of_one(
        #[inline(always)]
        |i| (TURNS[0][i % 4] ^ odd) * n + i / 4
    ));
    [
        part(p.blend_words(q, 0xcc), 0),
        part(q.blend_words(p, 0xcc), 1),
        part(r.blend_words(s, 0xcc), 0),
        part(s.blend_words(r, 0xcc), 1),
    ]
}

/// Three channels of 32 or 64 bits. Each shuffle takes two of them, and each result has lanes of two shuffles.
#[on(X86)]
#[op]
pub(crate) fn merge_words<S: Isa, T: Lane, W: Width>(all: [Simd<T, W, S>; 3]) -> [Simd<T, W, S>; 3] {
    let n = all[0].tag().lanes();
    let pair = always!(|c: usize| all[c].of_two(
        all[(c + 1) % 3],
        #[inline(always)]
        |i| {
            let at = n * (c + 3 - i % 3 / 2) % 3 * n + i;
            at / 3 + if at % 3 == c { 0 } else { n }
        }
    ));
    let pairs = [pair(0), pair(1), pair(2)];
    let part = always!(|k: usize| pairs[n * k % 3].concat_swizzle(
        pairs[(n * k + 1) % 3],
        #[inline(always)]
        |i| i % 3 / 2 * n + i
    ));
    [part(0), part(1), part(2)]
}

/// As `load`, with vectors of 64 bytes in the place of blocks. A blend and `vpermb` take less than `vpermt2b`.
#[on(X86)]
#[op]
pub(crate) fn split<S: Isa, W: Width>(all: [V<S, W>; 3]) -> [V<S, W>; 3] {
    let channel = always!(|c: usize| {
        apart(select::<64, _, _>(all, c, 2).unseen().swizzle(
            #[inline(always)]
            |i| (3 * i + c) % 64,
        ))
    });
    [channel(0), channel(1), channel(2)]
}

#[on(X86)]
#[op]
pub(crate) fn merge<S: Isa, W: Width>(channels: [V<S, W>; 3]) -> [V<S, W>; 3] {
    let spread = always!(|c: usize| {
        apart(apart(channels[c]).swizzle(
            #[inline(always)]
            |p| 43 * (p + 64 - c) % 64,
        ))
    });
    let all = [spread(0), spread(1), spread(2)];
    [select::<64, _, _>(all, 0, 1), select::<64, _, _>(all, 1, 1), select::<64, _, _>(all, 2, 1)]
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// Three values for each four lanes, and zero in the fourth: RGB to RGBA, samples of 24 bits, Base64. For lanes of up
    /// to 32 bits, in 16 bytes or more. It is best from 32 bytes on. Panics if `from` has fewer values than that.
    #[op]
    #[track_caller]
    pub(crate) fn load_3_of_4(self, from: &[T]) -> Simd<T, W, S> {
        require!("this takes lanes of up to 32 bits, in 16 bytes or more", W::BYTES >= 16 && size_of::<T>() <= 4);
        let (s, size, from) = (self.simd(), size_of::<T>(), &from[..Self::LANES / 4 * 3]);
        let v = if const { W::BYTES == 16 } {
            self.combine(
                self.half().resize_bitcast(s.fixed::<T, B4>().load_last(from)),
                self.half().resize_bitcast(s.fixed::<T, B8>().load(from)),
            )
        } else if const { W::BYTES == 32 } {
            self.combine(self.half().load_last(from), self.half().load(from))
        } else if const { S::REGISTER == W::BYTES } {
            let v = self.resize_bitcast(s.fixed::<T, B32>().load(from)).with_block::<2>(s.fixed().load_last(from));
            // The last block is zero.
            if_here!(crate::vector::two_tables::<S, T>(), {
                return v.unseen().of_one(always!(|i: usize| if i % 4 < 3 {
                    i / 4 * 3 + i % 4
                } else {
                    Self::LANES - 1
                }));
            });
            v.reinterpret::<u32>()
                .swizzle(
                    #[inline(always)]
                    |i| (i / 4 * 3 + i % 4).min(11),
                )
                .reinterpret()
        } else {
            return self.combine(
                again!(Tag::load_3_of_4, self.half(), &from[from.len() / 2..]),
                again!(Tag::load_3_of_4, self.half(), from),
            );
        };
        v.move_lanes(self.repartition::<u8>().from_fn(
            #[inline(always)]
            |i| {
                let (group, at, skip) =
                    (i % 16 / (4 * size), i % (4 * size), if W::BYTES == 32 { i / 16 * 4 } else { 0 });
                if at < 3 * size { (skip + group * 3 * size + at) as u8 } else { 0x80 }
            },
        ))
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// The first three of each four lanes. This is the reverse of [`load_3_of_4`](crate::Simd::load_3_of_4). It writes just these, and panics if `to` is shorter.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut rgb = [0; 12];
    /// u8x16::from(b"RGBArgbaRGBArgba").store_3_of_4(&mut rgb);
    /// assert_eq!(&rgb, b"RGBrgbRGBrgb");
    /// # } example()
    /// ```
    #[doc(alias("i24", "u24", "24bit", "rgb"))]
    #[op]
    #[track_caller]
    pub fn store_3_of_4(self, to: &mut (impl crate::SliceMut<Item = impl crate::Writable<T>> + ?Sized)) {
        require!("this takes lanes of up to 32 bits, in 16 bytes or more", W::BYTES >= 16 && size_of::<T>() <= 4);
        self.store_three(crate::whole::has_room::<crate::whole::ThreeOfFour<T, W>, _>(to))
    }
    #[op]
    #[track_caller]
    fn store_three(self, to: &mut [impl crate::Writable<T>]) {
        let (d, s, size) = (self.tag(), self.s, size_of::<T>());
        let to = &mut to[..d.lanes() / 4 * 3];
        apart_unoptimized!(self.s, |to: &mut [_]| {
            let from = always!(|i: usize| i / (3 * size) * 4 * size + i % (3 * size));
            if_here!(S::A64 && W::BYTES == 32, {
                let v = self.reinterpret::<u8>();
                let at = v.tag().from_fn(
                    #[inline(always)]
                    |i| (from(i % 24) % if i < 16 { 32 } else { 16 }) as u8,
                );
                v.lower_half()
                    .two_tables_lookup_bytes(v.upper_half(), at.lower_half().barrier())
                    .reinterpret::<T>()
                    .store(to);
                let last = v.upper_half().table_lookup_bytes(at.upper_half()).reinterpret::<T>();
                return s.fixed::<T, B8>().resize_bitcast(last).store_last(to);
            });
            if const { W::BYTES >= 64 && S::REGISTER < W::BYTES } {
                let (lower, upper) = to.split_at_mut(d.lanes() / 8 * 3);
                again!(Simd::store_3_of_4, self.lower_half(), lower);
                return again!(Simd::store_3_of_4, self.upper_half(), upper);
            }
            let v = self
                .move_lanes(d.repartition::<u8>().from_fn(
                    #[inline(always)]
                    |i| if S::BY_HAND && i % 16 >= 12 { 0x80 } else { (from(i % 16) % 16) as u8 },
                ))
                .reinterpret::<u32>();
            if const { W::BYTES == 16 } {
                s.fixed::<T, B8>().resize_bitcast(v.reinterpret::<T>()).store(to);
                s.fixed::<T, B4>().resize_bitcast(v.upper_half().reinterpret::<T>()).store_last(to);
            } else if const { W::BYTES == 32 && S::REGISTER == 16 } {
                v.lower_half().reinterpret().store(to);
                let upper = v.upper_half();
                s.fixed::<T, B8>().resize_bitcast(upper.reinterpret::<T>()).store(&mut to[12 / size..]);
                s.fixed::<T, B4>().resize_bitcast(upper.upper_half().reinterpret::<T>()).store_last(to);
            } else if const { W::BYTES == 32 } {
                // The halves overlap. To store the upper one takes no shuffle.
                let v = v
                    .swizzle(
                        #[inline(always)]
                        |i| [0, 1, 2, 4, 2, 4, 5, 6][i % 8],
                    )
                    .barrier()
                    .reinterpret::<T>();
                v.lower_half().store(to);
                v.upper_half().store_last(to);
            } else {
                let v = v
                    .swizzle(
                        #[inline(always)]
                        |i| (i / 3 * 4 + i % 3) % (W::BYTES / 4),
                    )
                    .reinterpret::<T>();
                v.lower_half().store(to);
                v.upper_half().lower_half().store_last(to);
            }
        })
    }
}
