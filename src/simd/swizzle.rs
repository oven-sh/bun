//! Permutations that the caller describes, transposes, and what acts on blocks.

use crate::raw::Raw;
use crate::{B8, B16, B32, B64, Isa, Lane, Simd, Tag, Width};

/// For each mask: the indices of the parts of the lanes that are true, and then those of the others.
pub(crate) const fn order<const PARTS: usize, const MASKS: usize>() -> [[u8; PARTS]; MASKS] {
    let size = PARTS / MASKS.trailing_zeros() as usize;
    let (set, mut table, mut mask) = (crate::ops::true_lanes::<MASKS>(size), [[0; PARTS]; MASKS], 0);
    while mask < MASKS {
        let both = set[mask] | set[MASKS - 1 - mask].unbounded_shl(8 * size as u32 * mask.count_ones());
        table[mask] = *both.to_le_bytes().first_chunk().unwrap();
        mask += 1;
    }
    table
}
const ORDER_4X4: &[[u8; 16]; 16] = &crate::Aligned(order()).0;
const ORDER_4X2: &[[u8; 8]; 16] = &crate::Aligned(order()).0;
const ORDER_8X1: &[[u8; 8]; 256] = &crate::Aligned(once!([[u8; 8]; 256] = order())).0;

/// No code is left of this if the indices are constants that fit.
#[op]
fn in_range(fits: bool) {
    if !fits {
        crate::out_of_range("an index of a shuffle is out of range")
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// The number of blocks. `Blocks`.
    #[inline(always)]
    pub(crate) const fn blocks_len(self) -> usize {
        W::BYTES.div_ceil(16)
    }
    /// The number of lanes in a block.
    #[inline(always)]
    pub(crate) const fn lanes_per_block(self) -> usize {
        Self::LANES / W::BYTES.div_ceil(16)
    }
    /// Lane `i` is `lane(i)`. What the compiler can compute becomes a constant.
    #[op]
    pub(crate) fn from_fn(self, mut lane: impl FnMut(usize) -> T) -> Simd<T, W, S> {
        // An array of this size would be put together in a general register.
        if const { crate::X86 && W::BYTES < 16 && !T::IS_FLOAT && (size_of::<T>() > 1 || S::SSE41) } {
            let mut v = self.zero();
            unrolled!(64 theirs, for i in 0..const (Self::LANES) {
                v.raw.lanes_mut()[i] = lane(i);
            });
            return v;
        }
        let mut lanes = self.zero().to_array();
        // Shuffles of several registers merge only if the constants are known early.
        if const { crate::X86 && S::REGISTER == 16 } {
            unrolled!(64 theirs, for i in 0..const (Self::LANES) {
                lanes.as_mut()[i] = lane(i);
            });
            return self.of_each(lanes);
        }
        unrolled!(64, for i in 0..const (Self::LANES) {
            lanes.as_mut()[i] = lane(i);
        });
        self.of_each(lanes)
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Without an instruction that looks up in a whole vector, LLVM merges selections better than lookups.
    const BY_BLOCKS: bool = crate::X86
        && W::BYTES > 16
        && if S::COMPRESS[2] == 64 {
            size_of::<T>() == 1 && S::COMPRESS[0] < 64
        } else {
            W::BYTES > S::REGISTER || size_of::<T>() < 4
        };
    /// LLVM doesn't see that a lookup with constant indices is a shuffle.
    const BY_LANES: bool = S::BY_HAND || S::SCALAR;
    /// For lanes of 2 bytes, LLVM prefers two shuffles to one lookup.
    pub(crate) const WORDS_BY_LOOKUP: bool =
        S::AVX2 && size_of::<T>() == 2 && W::BYTES >= 16 && W::BYTES <= S::REGISTER;
    /// Lane `source(i) % 8` of the block of lane `i`.
    #[op]
    pub(crate) fn words_in_blocks(self, source: impl Fn(usize) -> usize) -> Self {
        let from = self.tag().repartition::<u8>().from_fn(
            #[inline(always)]
            |i| (source(i / 2) % 8 * 2 + i % 2) as u8,
        );
        self.move_lanes(from.barrier())
    }
    #[op]
    fn indices(self, end: usize, source: impl Fn(usize) -> usize) -> Simd<T::Unsigned, W, S> {
        let mut fit = true;
        let indices = self.tag().to_unsigned().from_fn(
            #[inline(always)]
            |i| {
                let at = source(i);
                fit &= at < end;
                Lane::from_usize(at)
            },
        );
        in_range(fit);
        indices
    }
    /// Lane `i` of the result is lane `source(i)`. This is one shuffle if the compiler can compute the indices, and slow
    /// otherwise, from 256 bytes on also to compile: [`swizzle_dyn`](Self::swizzle_dyn) takes indices that vary. Panics if one is out of range.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x8::from(b"abcdefgh").swizzle(|i| i / 2), *b"aabbccdd");
    /// # } example()
    /// ```
    #[doc(alias("permute", "shuffle", "SetTableIndices"))]
    #[op]
    pub fn swizzle<F: Fn(usize) -> usize>(self, /* for arrays: swizzle_groups */ source: F) -> Self {
        return_if!(W::BYTES > 64 && !Self::BY_LANES, |this: Self = self, source: F = source| {
            let [a, b] = this.parts::<W>();
            let source = always!(|i| { let at = source(i); in_range(at < Self::LANES); at });
            this.tag().join(a.among(b, 0, 0, Self::LANES, &source), a.among(b, Self::LANES / 2, 0, Self::LANES, &source))
        });
        return_if!(
            Self::BY_REGISTERS && (S::BY_HAND || !Self::BY_LANES),
            on_x86!(self.by_registers::<false>(self, self.indices(Self::LANES, source)), swizzled())
        );
        return_if!(S::BY_HAND && W::BYTES < 16, |this: Self = self, source: F = source| {
            let source = always!(|i| if i < Self::LANES { let at = source(i); in_range(at < Self::LANES); at } else { i });
            this.tag().resize_any(this.s.fixed::<T, B16>().resize_any(this).swizzle(source))
        });
        return_if!(S::BY_HAND && W::BYTES == 16 && size_of::<T>() == 1, |this: Self = self, source: F = source| this.barrier().swizzle_dyn_relaxed(this.indices(16, source)));
        return_if!(Self::BY_LANES, {
            // LLVM would move the operation before this one to integer registers, or load each lane.
            let lanes = if const { S::BY_HAND } { live!(S::BY_HAND, self.barrier()) } else { self }.to_array();
            // Indexing an array is a call at opt-level z.
            let lanes = lanes.as_ref();
            let v = self.tag().from_fn(
                #[inline(always)]
                |i| lanes[source(i)],
            );
            on_x86!(v, picked())
        });
        return_if!(
            Self::BY_BLOCKS,
            self.concat_swizzle(
                self,
                #[inline(always)]
                |i| {
                    let at = source(i);
                    in_range(at < self.tag().lanes());
                    at
                }
            )
        );
        let from = self.indices(self.tag().lanes(), source);
        if_here!(S::A64 && crate::OPTIMIZED && size_of::<T>() == 4 && W::BYTES == 16, {
            let at = from.bitcast::<u32>();
            if crate::arithmetic::known(!crate::pattern::is_short(
                (at[0] | at[1] << 2 | at[2] << 4 | at[3] << 6) as usize,
            )) {
                return self.move_lanes((at * 0x0404_0404 + 0x0302_0100).bitcast::<u8>().barrier());
            }
        });
        on_x86!(self.swizzle_dyn_relaxed(from), swizzled())
    }
    /// [`swizzle`](Self::swizzle) from `self` followed by `other`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from(b"abcd").concat_swizzle(u8x4::from(b"efgh"), |i| 2 * i + 1), *b"bdfh");
    /// # } example()
    /// ```
    #[op]
    pub fn concat_swizzle<F: Fn(usize) -> usize>(self, other: impl crate::Operand<T, W, S>, source: F) -> Self {
        let other = self.like(other);
        return_if!(W::BYTES > 64 && !Self::BY_LANES, |this: Self = self, other: Self = other, source: F = source| {
            this.among(other, 0, 0, 2 * Self::LANES, &source)
        });
        self.concat_swizzle_64(other, source)
    }
    /// Lane `i` is lane `source(first + i) - base` of both, or unspecified if there is none.
    #[op]
    fn among(self, other: Self, first: usize, base: usize, end: usize, source: &impl Fn(usize) -> usize) -> Self {
        let n = Self::LANES;
        return_if!(
            W::BYTES <= 64,
            self.concat_swizzle_64(
                other,
                #[inline(always)]
                |i| source(first.wrapping_add(i)).wrapping_sub(base) & const { 2 * Self::LANES - 1 }
            )
        );
        let ([a, b], [c, d]) = (self.parts::<W>(), other.parts::<W>());
        let half = always!(|first: usize| {
            let mut fit = true;
            let later = a.tag().to_signed().from_fn(
                #[inline(always)]
                |i| {
                    let at = source(first.wrapping_add(i));
                    fit &= at < end;
                    Lane::from_i64(((at >= base.wrapping_add(n)) as i64).wrapping_neg())
                },
            );
            in_range(fit);
            later.to_mask().retype::<T::Signed>().if_then_else(
                again!(Simd::among, c, d, first, base + n, end, source),
                again!(Simd::among, a, b, first, base, end, source),
            )
        });
        self.tag().join(half(first), half(first + n / 2))
    }
    const BY_REGISTERS: bool = Self::BY_BLOCKS && W::BYTES > S::REGISTER && W::BYTES <= 64;
    /// LLVM does worse with the whole, and masks that are wider than a register hide their constants.
    #[op]
    fn by_registers<const TWO: bool>(self, other: Self, from: Simd<T::Unsigned, W, S>) -> Self {
        return_if!(Self::BY_REGISTERS, |this: Self = self, other: Self = other, from: Simd<T::Unsigned, W, S> = from| {
            let (a, b, c, d) = (this.lower_half(), this.upper_half(), other.lower_half(), other.upper_half());
            let half = always!(|at: Simd<T::Unsigned, W::Half, S>| {
                let within = at.with(at.raw.and(Raw::splat(Lane::from_usize(Self::LANES - 1))));
                let first = a.by_registers::<true>(b, within);
                choose! { TWO => a.with(Raw::select(crate::raw::same(at.raw.eq(within.raw)), first.raw, c.by_registers::<true>(d, within).raw)), _ => first }
            });
            on_x86!(this.tag().combine(half(from.upper_half()), half(from.lower_half())), assembled())
        });
        choose! {
            S::BY_HAND && size_of::<T>() == 1 => self.barrier().concat_swizzle_dyn_relaxed(other.barrier(), from),
            Self::BY_LANES => {
                let from = from.to_array();
                self.concat_swizzle_64(other, #[inline(always)] |i| crate::Int::to_u64(from.as_ref()[i]) as usize % const { 2 * Self::LANES })
            },
            Self::BY_BLOCKS && size_of::<T>() == 2 => {
                let at = from.bitcast::<u16>();
                let at = at.with(at.raw.mul(Raw::splat(0x0202)).add(Raw::splat(0x0100)));
                on_x86!(self.settled().by_blocks(other.settled(), at.bitcast()), picked())
            },
            Self::BY_BLOCKS => on_x86!(self.settled().by_blocks(other.settled(), from.bitcast()), picked()),
            _ => self.concat_swizzle_dyn_relaxed(other, from),
        }
    }
    #[inline(always)]
    fn concat_swizzle_64<F: Fn(usize) -> usize>(self, other: Self, source: F) -> Self {
        apart_unoptimized!(self.s, |source: F| {
            return_if!(Self::BY_REGISTERS, self.by_registers::<true>(other, self.indices(2 * Self::LANES, source)));
            return_if!(S::BY_HAND && W::BYTES < 16, |this: Self = self, other: Self = other, source: F = source| {
                let (d, n) = (this.s.fixed::<T, B16>(), Self::LANES);
                let source = always!(|i| if i < n { let at = source(i); in_range(at < 2 * n); at % n + at / n * d.lanes() } else { source(n - 1) % n });
                this.tag().resize_any(d.resize_any(this).concat_swizzle_64(d.resize_any(other), source))
            });
            return_if!(S::BY_HAND && W::BYTES == 16 && size_of::<T>() == 1, |this: Self = self, other: Self = other, source: F = source| {
                this.barrier().concat_swizzle_dyn_relaxed(other.barrier(), this.indices(2 * Self::LANES, source))
            });
            return_if!(Self::BY_LANES, {
                let (a, b) = choose! { S::BY_HAND => (self.barrier().to_array(), other.barrier().to_array()), _ => (self.to_array(), other.to_array()) };
                let (a, b) = (a.as_ref(), b.as_ref());
                let v = self.tag().from_fn(
                    #[inline(always)]
                    |i| {
                        let at = source(i);
                        if at < Self::LANES { a[at] } else { b[at - Self::LANES] }
                    },
                );
                on_x86!(v, picked())
            });
            return_if!(Self::BY_BLOCKS, {
                let (d, size) = (self.tag().repartition::<u8>(), size_of::<T>());
                let mut fit = true;
                let from = d.from_fn(
                    #[inline(always)]
                    |i| {
                        let at = source(i / size_of::<T>());
                        fit &= at < const { 2 * Self::LANES };
                        at.wrapping_mul(size).wrapping_add(i % size_of::<T>()) as u8
                    },
                );
                in_range(fit);
                on_x86!(self.settled().by_blocks(other.settled(), from), picked())
            });
            let from = self.indices(2 * self.tag().lanes(), source);
            if_here!(S::WASM && W::BYTES == 16 && size_of::<T>() <= 2 && crate::OPTIMIZED, {
                // These take less than two lookups.
                let (a, b) = (from.tag().iota(Lane::ZERO), from.tag().iota(Lane::from_usize(Self::LANES)));
                let ([lower, upper], [even, odd]) = (a.interleave(b), a.deinterleave(b));
                if from == lower || from == upper {
                    return self.interleave(other)[(from == upper) as usize];
                }
                if from == even || from == odd {
                    return self.deinterleave(other)[(from == odd) as usize];
                }
            });
            self.concat_swizzle_dyn_relaxed(other, from)
        })
    }
    /// `concat_swizzle` as one instruction of AVX-512.
    #[on(X86)]
    #[op]
    pub(crate) fn of_two(self, other: Self, source: impl Fn(usize) -> usize) -> Self {
        // Or it joins both in a longer register.
        let first = choose! { W::BYTES < 64 => self.unseen(), _ => self };
        first.concat_swizzle_dyn_relaxed(other, self.indices(2 * Self::LANES, source).unseen())
    }
    /// `swizzle` across blocks. From Sapphire Rapids on, `vpermw` is two operations, and `vpermb` one.
    #[op]
    pub(crate) fn of_one(self, source: impl Fn(usize) -> usize) -> Self {
        return_if!(S::AVX512VBMI && W::BYTES == 64 && size_of::<T>() == 2, {
            let v = self.reinterpret::<u8>();
            v.swizzle_dyn_relaxed(v.indices(64, always!(|i: usize| 2 * source(i / 2) + i % 2)).unseen()).reinterpret()
        });
        // LLVM can take two shuffles.
        return_if!(
            S::AVX512F && W::BYTES == 64 && size_of::<T>() == 4,
            self.swizzle_dyn_relaxed(self.indices(16, source).unseen())
        );
        self.swizzle(source)
    }
    /// Words of 8 bytes from `other` where a bit is set. This takes no port for shuffles.
    #[on(X86)]
    #[op]
    pub(crate) fn blend_words(self, other: Self, bits: u64) -> Self {
        let chosen = self.tag().repartition::<f64>().unseen_mask(bits);
        chosen.if_then_else(other.reinterpret::<u64>(), self.reinterpret::<u64>()).reinterpret()
    }
    #[inline(always)]
    fn by_blocks(self, other: Self, from: Simd<u8, W, S>) -> Self {
        apart!(self.s, {
            let within = from & 15;
            // Not by masks: those that are wider than a register hide their constants.
            let by = always!(|bit: u8, yes: Simd<u8, W, S>, no: Simd<u8, W, S>| {
                yes.with(Raw::select(Raw::eq((from & bit).raw, from.tag().zero().raw), no.raw, yes.raw))
            });
            let whole = always!(|v: Self| {
                let v = on_x86!(v.bitcast::<u8>(), to_look_up(from).settled());
                let pair = always!(|a: Simd<u8, W, S>, b: Simd<u8, W, S>| {
                    by(16, b.table_lookup_bytes(within), a.table_lookup_bytes(within))
                });
                // LLVM has to see through these.
                macro_rules! block { ($k:literal) => { choose! { crate::X86 && S::REGISTER == 64 && W::BYTES == 64 => {
                    let words = v.reinterpret::<u64>();
                    words.with(words.raw.shuffle::<_, { crate::pattern::BROADCAST_BLOCK }, $k>(words.raw)).reinterpret()
                }, _ => v.broadcast_block::<$k>() } }; }
                let low = pair(block!(0), block!(1));
                if const { W::BYTES == 32 } {
                    return low;
                }
                by(32, pair(block!(2), block!(3)), low)
            });
            by(W::BYTES as u8, whole(other), whole(self)).bitcast()
        })
    }
    /// In each group of `N` lanes, lane `i` of the result is lane `order[i]` of that group.
    #[op]
    pub(crate) fn permute_groups<const N: usize>(self, order: [usize; N]) -> Self {
        return_if!(W::BYTES > S::REGISTER && 2 * N * size_of::<T>() <= W::BYTES, |this: Self = self, order: [usize; N] = order| {
            this.tag().combine(this.upper_half().permute_groups(order), this.lower_half().permute_groups(order))
        });
        let source = always!(|i| {
            in_range(order[i % N] < N);
            i - i % N + order[i % N]
        });
        choose! { Self::WORDS_BY_LOOKUP && N <= 8 => self.words_in_blocks(source), _ => self.swizzle(source) }
    }
    /// [`swizzle_groups`](Self::swizzle_groups) from a group of `self`, followed by that of `other`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from(b"abcd").concat_swizzle_groups(u8x4::from(b"ABCD"), [1, 2]), *b"bAdC");
    /// # } example()
    /// ```
    #[doc(alias("shufps"))]
    #[op]
    #[track_caller]
    pub fn concat_swizzle_groups<const N: usize>(self, other: impl crate::Operand<T, W, S>, order: [usize; N]) -> Self {
        const {
            assert!(
                N.is_power_of_two(),
                "the length of a group has to be a power of two, since no vector has room for whole groups of another length"
            )
        };
        let other = crate::Operand::vector(other, crate::Tag::new(self.s));
        let n = self.tag().lanes();
        require!("the vector has too few lanes", N <= Self::LANES);
        apart_unoptimized!(self.s, {
            return_if!(W::BYTES > S::REGISTER && 2 * N * size_of::<T>() <= W::BYTES, |this: Self = self, other: Self = other, order: [usize; N] = order| {
                let upper = this.upper_half().concat_swizzle_groups(other.upper_half(), order);
                this.tag().combine(upper, this.lower_half().concat_swizzle_groups(other.lower_half(), order))
            });
            self.concat_swizzle(
                other,
                #[inline(always)]
                |i| {
                    in_range(order[i % N] < 2 * N);
                    i - i % N + order[i % N] % N + order[i % N] / N * n
                },
            )
        })
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Toward higher addresses, by whole blocks. `SlideUpBlocks`.
    #[op]
    pub(crate) fn slide_up_blocks<const K: usize>(self, other: Self) -> Self {
        return_if!(W::BYTES > 64 && K < W::BYTES / 16, |this: Self = self, other: Self = other| {
            let v = this.reinterpret::<u64>();
            v.shuffle::<{ crate::pattern::SLIDE_UP_BLOCKS }, K>(other.reinterpret()).reinterpret()
        });
        return_if!(S::REGISTER == 64 && W::BYTES == 64 && T::IS_FLOAT && (K == 1 || K == 3), |this: Self = self, other: Self = other| {
            let v = this.reinterpret::<f64>();
            choose! { K == 1 => v.shift_elements_right::<2>(other.reinterpret::<f64>()), _ => v.shift_elements_right::<6>(other.reinterpret::<f64>()) }.reinterpret()
        });
        let (d, v, w) = (self.tag().repartition::<u8>(), self.reinterpret(), other.reinterpret());
        match const { if K < W::BYTES.div_ceil(16) { K } else { usize::MAX } } {
            0 => self,
            usize::MAX => other,
            1 => d.combine_slide_up::<16>(v, w).reinterpret(),
            2 => d.combine_slide_up::<32>(v, w).reinterpret(),
            _ => d.combine_slide_up::<48>(v, w).reinterpret(),
        }
    }
    /// Toward lower addresses, by whole blocks. `SlideDownBlocks`.
    #[op]
    pub(crate) fn slide_down_blocks<const K: usize>(self, other: Self) -> Self {
        return_if!(W::BYTES > 64 && K < W::BYTES / 16, |this: Self = self, other: Self = other| {
            let v = this.reinterpret::<u64>();
            v.shuffle::<{ crate::pattern::SLIDE_DOWN_BLOCKS }, K>(other.reinterpret()).reinterpret()
        });
        let (d, v, w) = (self.tag().repartition::<u8>(), self.reinterpret(), other.reinterpret());
        match const { if K < W::BYTES.div_ceil(16) { K } else { usize::MAX } } {
            0 => self,
            usize::MAX => other,
            1 => d.combine_slide_down::<16>(w, v).reinterpret(),
            2 => d.combine_slide_down::<32>(w, v).reinterpret(),
            _ => d.combine_slide_down::<48>(w, v).reinterpret(),
        }
    }
    /// Alternating blocks from the lower halves. `InterleaveLowerBlocks`.
    #[op]
    pub(crate) fn interleave_lower_blocks(self, other: Self) -> Self {
        return_if!(W::BYTES < 64, self.interleave_even_blocks(other));
        self.shuffle::<{ crate::pattern::ZIP_BLOCKS }, 0>(other)
    }
    /// Alternating blocks from the upper halves. `InterleaveUpperBlocks`.
    #[op]
    pub(crate) fn interleave_upper_blocks(self, other: Self) -> Self {
        return_if!(W::BYTES < 64, self.interleave_odd_blocks(other));
        return_if!(W::BYTES > 64, |this: Self = self, other: Self = other| {
            this.bitcast::<u64>().shuffle::<{ crate::pattern::ZIP_UPPER_BLOCKS }, 0>(other.bitcast()).bitcast()
        });
        self.shuffle::<{ crate::pattern::ZIP_BLOCKS }, 2>(other)
    }
    /// The lanes where `mask` is true, and then the others, both in order. This is `Compress` where
    /// `CompressIsPartition`, for all types and targets.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u32x4::from([1, 2, 3, 4]);
    /// assert_eq!(v.partition(v.any_bits(1)), [1, 3, 2, 4]);
    /// # } example()
    /// ```
    #[op]
    pub fn partition(self, mask: impl crate::Keep<T, W, S>) -> Self {
        let (bits, mask, d) =
            (mask.kept(self.tag()) & Self::all_bits_of_lanes(), crate::Keep::as_mask(mask, self.s), self.tag());
        let s = d.simd();
        return_if!(S::SCALAR && Self::LANES > 8, {
            let (from, mut to, mut next) = (self.to_array(), self.to_array(), [bits.count_ones() as usize, 0]);
            unrolled!(16, for i in 0..const (Self::LANES) {
                let kept = (bits >> i & 1) as usize;
                to.as_mut()[core::hint::select_unpredictable(kept == 1, next[1], next[0]) % Self::LANES] = from.as_ref()[i];
                next = [next[0] + 1 - kept, next[1] + kept];
            });
            d.from_array(to)
        });
        if const { W::BYTES <= S::REGISTER } {
            if const { W::BYTES / size_of::<T>() == 1 } {
                return self;
            } else if const { W::BYTES / size_of::<T>() == 2 } {
                return live!(!(W::BYTES / size_of::<T>() == 1) && W::BYTES / size_of::<T>() == 2, {
                    let v = mask.to_vector().cast_unsigned();
                    v.dup_even()
                        .and_not(v.dup_odd())
                        .moved_mask()
                        .retype::<T::Signed>()
                        .if_then_else(self.swap_pairs(), self)
                });
            } else if const { W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 4 } {
                return live!(
                    !(W::BYTES / size_of::<T>() == 1)
                        && !(W::BYTES / size_of::<T>() == 2)
                        && W::BYTES / size_of::<T>() == 4
                        && size_of::<T>() == 4,
                    self.move_by_row(d.repartition::<u8>().load(&ORDER_4X4[bits as usize & 15]))
                );
            } else if const { W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 2 } {
                return live!(
                    !(W::BYTES / size_of::<T>() == 1)
                        && !(W::BYTES / size_of::<T>() == 2)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 4)
                        && W::BYTES / size_of::<T>() == 4
                        && size_of::<T>() == 2,
                    self.move_by_row(d.repartition::<u8>().load(&ORDER_4X2[bits as usize & 15]))
                );
            } else if const { W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 8 } {
                return live!(
                    !(W::BYTES / size_of::<T>() == 1)
                        && !(W::BYTES / size_of::<T>() == 2)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 4)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 2)
                        && W::BYTES / size_of::<T>() == 4
                        && size_of::<T>() == 8,
                    {
                        let order =
                            d.repartition::<u32>().promote_to(s.fixed::<u8, B8>().load(&ORDER_4X2[bits as usize & 15]));
                        self.reinterpret::<u32>().swizzle_dyn_relaxed(order).reinterpret()
                    }
                );
            } else if const { matches!(W::BYTES / size_of::<T>(), 4 | 8) && size_of::<T>() == 1 } {
                return live!(
                    !(W::BYTES / size_of::<T>() == 1)
                        && !(W::BYTES / size_of::<T>() == 2)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 4)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 2)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 8)
                        && matches!(W::BYTES / size_of::<T>(), 4 | 8)
                        && size_of::<T>() == 1,
                    self.move_by_row(d.repartition::<u8>().load(&ORDER_8X1[bits as u8 as usize]))
                );
            } else if const { W::BYTES / size_of::<T>() == 8 } {
                return live!(
                    !(W::BYTES / size_of::<T>() == 1)
                        && !(W::BYTES / size_of::<T>() == 2)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 4)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 2)
                        && !(W::BYTES / size_of::<T>() == 4 && size_of::<T>() == 8)
                        && !(matches!(W::BYTES / size_of::<T>(), 4 | 8) && size_of::<T>() == 1)
                        && W::BYTES / size_of::<T>() == 8,
                    self.swizzle_dyn_relaxed(
                        d.to_unsigned().promote_to(s.fixed::<u8, B8>().load(&ORDER_8X1[bits as u8 as usize]))
                    )
                );
            }
        }
        return_if!(
            W::BYTES == 2 * S::REGISTER && Self::LANES == 8 && S::LOOKS_UP_IN_REGISTERS,
            self.swizzle_dyn_relaxed(
                d.to_unsigned().promote_to(s.fixed::<u8, B8>().load(&ORDER_8X1[bits as u8 as usize]))
            )
        );
        return_if!(W::BYTES == 2 * S::REGISTER && W::BYTES == 32 && Self::LANES == 4 && S::LOOKS_UP_IN_REGISTERS, {
            let order = d.repartition::<u32>().promote_to(s.fixed::<u8, B8>().load(&ORDER_4X2[bits as usize & 15]));
            self.reinterpret::<u32>().swizzle_dyn_relaxed(order).reinterpret()
        });
        if_here!(crate::X86 && S::COMPRESS[0] == 64 && Self::LANES == 64 && W::BYTES == 64, {
            return self.with_bytes(s.partition8::<W>(self.bytes(), bits));
        });
        return_if!(
            crate::X86 && S::COMPRESS[0] == 64 && Self::LANES >= 16 && (W::BYTES == 64 || W::BYTES < S::Native::BYTES),
            {
                // One step does for all lanes twice in a row, or for their indices.
                let both = bits & !(!0 << d.lanes()) | !bits << d.lanes();
                return_if!(W::BYTES < 64, d.resize_bitcast(self.concat(self).compress_own(both)));
                let order = s.fixed::<u8, B64>().from_fn(
                    #[inline(always)]
                    |i| (i % d.lanes()) as u8,
                );
                let order = choose! {
                    size_of::<T>() == 2 => d.to_unsigned().resize_bitcast(s.fixed::<u16, B64>().promote_to(order.compress_own(both).lower_half())),
                    _ => d.to_unsigned().resize_bitcast(s.fixed::<u32, B64>().promote_to(order.lower_half().compress_own(both).lower_half())),
                };
                self.swizzle_dyn_relaxed(order)
            }
        );
        let count = choose! { S::NO_POPCNT => mask.count(), _ => crate::ops::count_bits_on::<S>(bits, Self::LANES) };
        return_if!(W::BYTES > 16 && W::BYTES > S::COMPRESS[size_of::<T>().trailing_zeros() as usize], {
            let mut buffer = [T::default(); 128];
            let all = &mut buffer[..2 * d.lanes()];
            self.compress_own_store(bits, all);
            self.compress_own_store(!bits, &mut all[count.min(d.lanes())..]);
            d.load(all)
        });
        d.first_n(count).if_then_else(self.compress_own(bits), self.compress_own(!bits).up_by(count))
    }
}

impl<S: Isa, T: crate::Float, W: Width> Tag<S, T, W> {
    /// For speed: a constant that LLVM doesn't know on AVX-512. Unlike `asm!`, it is always moved out of loops.
    #[op]
    pub(crate) fn unseen_mask(self, bits: u64) -> crate::MaskOf<T, W, S> {
        self.from_fn(always!(|i: usize| T::from_f64(if bits >> i & 1 == 1 { f64::INFINITY } else { 0.0 })))
            .is_infinite()
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    fn perfect_shuffles<const N: usize>(
        mut rows: [Simd<T, W, S>; N],
        step: usize,
        count: usize,
        zip: impl Fn(Simd<T, W, S>, Simd<T, W, S>) -> [Simd<T, W, S>; 2],
    ) -> [Simd<T, W, S>; N] {
        // Among each `count` rows that are `step` apart.
        unrolled!(8, for round in 0..const (N.next_power_of_two().ilog2() as usize) {
            if 1 << round >= count {
                return;
            }
            let before = rows;
            unrolled!(32, for pair in 0..const (N / 2) {
                let (offset, i, group) = (pair % step, pair / step % (count / 2), pair / step / (count / 2));
                let first = group * count * step + offset;
                [rows[first + 2 * i * step], rows[first + (2 * i + 1) * step]] =
                    zip(before[first + i * step], before[first + (i + count / 2) * step]);
            });
        });
        rows
    }
    /// Transposes the square in each block: lane `j` of row `i` goes to lane `i` of row `j`. `N` is the number of lanes
    /// in a block, or a multiple for several squares.
    #[op]
    #[track_caller]
    pub(crate) fn transpose_in_blocks<const N: usize>(self, rows: [Simd<T, W, S>; N]) -> [Simd<T, W, S>; N] {
        require!(
            "the number of rows has to be a multiple of the lanes in a block",
            N.is_multiple_of(Self::LANES / W::BYTES.div_ceil(16))
        );
        // LLVM would repeat a shuffle of bytes that is before, for both halves.
        let rows = choose! {
            S::SSE41 && !T::IS_FLOAT && T::BITS > 8 && W::BYTES >= 16 => crate::array::own::map(rows, #[inline(always)] |v: Simd<T, W, S>| v.barrier()),
            _ => rows,
        };
        // From Ice Lake on, two ports have `shufps`, and one has `unpcklps`.
        return_if!(S::AVX2 && T::IS_FLOAT && T::BITS == 32 && matches!(W::BYTES, 16 | 32), {
            let round = always!(|rows: [Simd<T, W, S>; N]| crate::array::own::from_fn(
                #[inline(always)]
                |i| rows[i / 4 * 4 + i % 2 * 2].in_blocks().deinterleave(rows[i / 4 * 4 + i % 2 * 2 + 1])[i / 2 % 2],
            ));
            round(round(rows))
        });
        Self::perfect_shuffles(
            rows,
            1,
            self.lanes_per_block(),
            #[inline(always)]
            |a, b| [a.interleave_lower(b), a.interleave_upper(b)],
        )
    }
    #[op]
    pub(crate) fn squares_of_blocks<const N: usize>(self, rows: [Simd<T, W, S>; N]) -> [Simd<T, W, S>; N] {
        // These shuffles need no indices in registers.
        return_if!(S::AVX512F && W::BYTES == 64, {
            let halves: [_; N] = crate::array::own::from_fn(
                #[inline(always)]
                |i| match i % 2 {
                    0 => rows[i].concat_halves::<0, 0>(rows[i + 1]),
                    _ => rows[i - 1].concat_halves::<1, 1>(rows[i]),
                },
            );
            crate::array::own::from_fn(
                #[inline(always)]
                |i| {
                    let at = i / 4 * 4 + i / 2 % 2;
                    halves[at].as_u128s().concat_swizzle(
                        halves[at + 2],
                        #[inline(always)]
                        |block| 2 * block + i % 2,
                    )
                },
            )
        });
        Self::perfect_shuffles(
            rows,
            1,
            self.blocks_len(),
            #[inline(always)]
            |a, b| [a.interleave_lower_blocks(b), a.interleave_upper_blocks(b)],
        )
    }
    /// Transposes a square of as many rows as there are lanes.
    #[op]
    #[track_caller]
    pub(crate) fn transpose<const N: usize>(self, rows: [Simd<T, W, S>; N]) -> [Simd<T, W, S>; N] {
        require!("there have to be as many rows as lanes", N == Self::LANES);
        return_if!(S::AVX2 && W::BYTES == 16 && size_of::<T>() == 1 && N == 16, {
            // After the first round, columns `i` and `i + 8` share a register.
            let d = self.simd().fixed::<T, B32>();
            let pairs: [_; 8] = crate::array::own::from_fn(
                #[inline(always)]
                |i| {
                    let (a, b) = (rows[i], rows[i + 8]);
                    d.combine(a.interleave_upper(b).barrier().same(), a.interleave_lower(b).barrier().same()).barrier()
                },
            );
            let pairs = Tag::perfect_shuffles(
                pairs,
                1,
                8,
                #[inline(always)]
                |a, b| [a.interleave_lower(b), a.interleave_upper(b)],
            );
            crate::array::own::from_fn(
                #[inline(always)]
                |i| if i < 8 { pairs[i % 8].lower_half() } else { pairs[i % 8].upper_half() }.same(),
            )
        });
        let rows = self.transpose_in_blocks(rows);
        return_if!(S::AVX512F && W::BYTES == 64, {
            let step = N / 4;
            let rows = self.squares_of_blocks::<N>(crate::array::own::from_fn(
                #[inline(always)]
                |i| rows[i % 4 * step + i / 4],
            ));
            crate::array::own::from_fn(
                #[inline(always)]
                |i| rows[i % step * 4 + i / step],
            )
        });
        Self::perfect_shuffles(
            rows,
            self.lanes_per_block(),
            self.blocks_len(),
            #[inline(always)]
            |a, b| [a.interleave_lower_blocks(b), a.interleave_upper_blocks(b)],
        )
    }
    #[op]
    fn lookup_at<X: Width>(self, table: &[T], indices: Simd<T::Unsigned, W, S>) -> Simd<T, W, S> {
        let d = self.simd().fixed::<T, X>();
        let indices = d.to_unsigned().resize_bitcast(indices);
        self.resize_bitcast(if table.len() <= d.lanes() {
            d.load_known(table).swizzle_dyn_relaxed(indices)
        } else {
            d.load(table).concat_swizzle_dyn_relaxed(d.load_known(&table[d.lanes()..]), indices)
        })
    }
    /// `table[index]` for each lane, from registers. The table has up to 128 bytes. The result is unspecified for an
    /// index that is out of range. `Lookup8`, for any `N`.
    #[inline(always)]
    pub(crate) fn lookup<const N: usize>(self, table: &[T; N], indices: Simd<T::Unsigned, W, S>) -> Simd<T, W, S> {
        apart!(self.simd(), {
            let bytes = size_of_val(table);
            return_if!(N == 0, self.zero());
            return_if!(W::BYTES > S::REGISTER, |this: Self = self, table: &[T; N] = table, indices: Simd<T::Unsigned, W, S> = indices| {
                let half = this.half();
                this.combine(half.lookup(table, indices.upper_half()), half.lookup(table, indices.lower_half()))
            });
            return_if!(!S::LOOKS_UP_IN_REGISTERS && (N > 16 || size_of::<T>() > 1), {
                // Once for each lane, and not for each block of the table too.
                let at = indices.to_array();
                self.from_fn(
                    #[inline(always)]
                    |i| table[(crate::lane::Int::to_u64(at.as_ref()[i]) as usize).min(N - 1)],
                )
            });
            return_if!(S::A64 && size_of::<T>() == 1, indices.bitcast::<u8>().lookup_or_byte(table, 0).bitcast());
            if const { size_of::<T>() == 1 && (N <= 32 && W::BYTES > 16 && S::COMPRESS[0] < 64 || N <= 16) } {
                let block = |from: &[T]| self.dup(self.simd().fixed::<T, B16>().load_known(from));
                if const { N > 16 } {
                    return block(table).two_tables_lookup_bytes(block(&table[16..]), indices).bitcast();
                }
                return_if!(W::BYTES >= 16, block(table).table_lookup_bytes(indices).bitcast());
            }
            if const { size_of::<T>() == 2 && N <= 8 && S::REGISTER == 32 && W::BYTES == 32 } {
                let at = indices.bitcast::<u16>() * 0x0202 + 0x0100;
                return self.dup(self.simd().fixed::<T, B16>().load_known(table)).table_lookup_bytes(at).bitcast();
            }
            let enough =
                |width: usize| width >= W::BYTES && (bytes <= width || bytes <= 2 * width && width >= S::REGISTER);
            if enough(16) {
                self.lookup_at::<B16>(table, indices)
            } else if enough(32) {
                self.lookup_at::<B32>(table, indices)
            } else {
                self.lookup_at::<B64>(table, indices)
            }
        })
    }
    #[op]
    pub(crate) fn dup(self, block: Simd<T, B16, S>) -> Simd<T, W, S> {
        self.resize_bitcast(block).broadcast_block::<0>()
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// For instructions that give zero out of range: with up to 128 bytes on NEON, and else 16.
    #[on(X86 A64 WASM)]
    #[op]
    pub(crate) fn lookup_or_byte<T: Lane>(self, table: &[T], or: u8) -> Self {
        let d = self.tag();
        halves_if!(W::BYTES > S::REGISTER, |this: Self = self, table: &[T] = table, or: u8 = or| {
            this.tag().combine(this.upper_half().lookup_or_byte(table, or), this.lower_half().lookup_or_byte(table, or))
        });
        return_if!(W::BYTES < 16, d.resize_any(self.s.fixed::<u8, B16>().resize_any(self).lookup_or_byte(table, or)));
        let block = always!(|i: usize| {
            let (block, from) = (self.s.fixed::<T, B16>(), &table[16 * i..]);
            let within = block.repartition::<u8>().iota(0).simd_lt(from.len() as u8);
            block.load_known(from).bitcast::<u8>() ^ within.if_then_else_zero(or)
        });
        return_if!(S::WASM, d.dup(block(0)).swizzle_dyn(self) ^ or);
        return_if!(
            crate::X86,
            self.in_chain_or_zero(table.len().div_ceil(16), &passed!(|i| d.dup(block(i)).as_table())) ^ or
        );
        return_if!(S::A64, {
            // With the fewest registers. `tbx` with four takes longer than `tbl` and `orr`.
            let tbl = always!(|at: Simd<u8, B16, S>, i: usize| match table.len() - 16 * i {
                ..=16 => block(i).table_lookup_bytes(at),
                17..=32 => block(i).two_tables_lookup_bytes(block(i + 1), at),
                33..=48 => at.with_bytes(at.s.table_in_three::<B16>(
                    block(i).bytes(),
                    block(i + 1).bytes(),
                    block(i + 2).bytes(),
                    at.bytes(),
                )),
                _ => {
                    let all = block(i).concat(block(i + 1)).concat(block(i + 2).concat(block(i + 3)));
                    all.swizzle_dyn_relaxed(all.tag().resize_bitcast(at)).resize()
                }
            });
            let at = self.same::<u8, B16>();
            (if table.len() > 64 { tbl(at, 0) | tbl(at ^ 64, 4) } else { tbl(at, 0) } ^ or).same()
        });
        unreachable!()
    }
}

impl<S: Isa, W: Width> Simd<u64, W, S> {
    /// Bit `j` of lane `i` is the bit of that lane at `indices[8 * i + j]`, for `j < 8`. The others are zero. The index
    /// counts modulo 64.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let reversed = u64x2::from([0b0000_0011, 0b1000_0000]).bit_shuffle(u8x16::repeat(&[7, 6, 5, 4, 3, 2, 1, 0]));
    /// assert_eq!(reversed, [0b1100_0000, 0b0000_0001]);
    /// # } example()
    /// ```
    #[doc(alias("BitShuffle", "vpshufbitqmb"))]
    #[op]
    pub fn bit_shuffle(self, indices: impl crate::Operand<u8, W, S>) -> Self {
        let indices = crate::Operand::vector(indices, crate::Tag::new(self.s));
        return_if!(S::SCALAR, {
            let (lanes, at) = (self.to_array(), indices.to_array());
            let bit =
                always!(|i: usize, k: usize| (lanes.as_ref()[i].wrapping_shr(at.as_ref()[8 * i + k] as u32) & 1) << k);
            self.tag().from_fn(
                #[inline(always)]
                |i| bit(i, 0) | bit(i, 1) | bit(i, 2) | bit(i, 3) | bit(i, 4) | bit(i, 5) | bit(i, 6) | bit(i, 7),
            )
        });
        let indices = choose! { S::AVX512BITALG => indices, _ => indices & 63 };
        self.with_bytes(self.s.bit_shuffle::<W>(self.bytes(), indices.bytes()))
    }
}
