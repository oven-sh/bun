//! `lookup` by `pshufb` and `vpermd`, without the permutations of AVX-512.

use crate::{B16, B32, Isa, Lane, Simd, Tag, Unsigned, Width};

type V<S, T, W> = Simd<T, W, S>;

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// LLVM would take the differences first, and repeat them by shuffles, not by loads.
    #[on(X86)]
    #[op]
    pub(crate) fn as_table(self) -> Self {
        choose! { S::AVX2 && W::BYTES == 32 => self.barrier_unless_known(), _ => self }
    }
    /// In the blocks from `first` to `end`. Each but the first is taken as its difference to the one before, for the indices that reach it.
    #[on(X86)]
    #[op]
    fn up_from(self, first: usize, end: usize, block: &impl Fn(usize) -> Self) -> Self {
        let mut found = block(first).table_lookup_bytes(self);
        unrolled!(
            8,
            for k in 1..(end - first) {
                found ^= (block(first + k - 1) ^ block(first + k)).table_lookup_bytes(self - 16 * k as u8);
            }
        );
        found
    }
    /// In up to 16 blocks of 16 bytes. The index counts modulo `n` if `EXACT`.
    #[on(X86)]
    #[op]
    pub(crate) fn in_chain<const EXACT: bool>(self, n: usize, block: &impl Fn(usize) -> Self) -> Self {
        let blocks = n.div_ceil(16);
        if blocks <= 6 {
            return choose! { EXACT => self & (n - 1) as u8, _ => self }.up_from(0, blocks, block);
        }
        let (within, odd) = (self & 63, (self + self).barrier().cast_signed().is_negative());
        let four = always!(|k: usize| within.up_from(k, blocks.min(k + 4), block));
        let eight = always!(|k: usize| if blocks > k + 4 { odd.if_then_else(four(k + 4), four(k)) } else { four(k) });
        if blocks > 8 { self.cast_signed().is_negative().if_then_else(eight(8), eight(0)) } else { eight(0) }
    }
    /// In up to 8, from the last one down. It is zero beyond them.
    #[on(X86)]
    #[op]
    pub(crate) fn in_chain_or_zero(self, blocks: usize, block: &impl Fn(usize) -> Self) -> Self {
        let below = always!(|k: usize| self.saturating_add(128 - 16 * k as u8));
        let mut found = block(blocks - 1).table_lookup_bytes(below(blocks));
        unrolled!(
            8,
            for k in 1..(blocks) {
                found ^= (block(k - 1) ^ block(k)).table_lookup_bytes(below(k));
            }
        );
        found
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    pub(crate) const IN_CHAINS: bool = crate::X86
        && S::SSE41
        && W::BYTES >= 16
        && (S::REGISTER < 64 && !S::AVX512VL || size_of::<T>() == 1 && W::BYTES <= 32 && !S::AVX512VBMI);
    /// The lanes fill a register as bytes.
    const fn packs<const N: usize>() -> bool {
        Self::LANES >= S::REGISTER
            && match size_of::<T>() {
                2 => N > 8 && N <= if S::AVX2 { 256 } else { 128 },
                4 => N > S::REGISTER / 4 && N <= 2 * S::REGISTER,
                _ => false,
            }
    }
    /// Whether `lookup_chained` has a way for values of the size of the indices.
    pub(crate) const fn chains<const N: usize>() -> bool {
        Self::IN_CHAINS
            && (Self::packs::<N>()
                || match size_of::<T>() {
                    1 => N > if S::AVX512VL { 32 } else { 16 } && N <= 256,
                    2 => N > 8 && N <= if S::AVX2 && W::BYTES >= 32 { 128 } else { 64 },
                    4 => S::AVX2 && W::BYTES >= 32 && N > 16 && N <= 32,
                    _ => false,
                })
    }
    /// Unless it is a constant, to prepare the table takes longer than a few loads.
    const fn large<const N: usize>() -> bool {
        size_of::<T>() > 1 && N * size_of::<T>() > if W::BYTES >= 32 { 128 } else { 64 }
    }
    #[on(X86)]
    #[op]
    pub(crate) fn lookup_chained<U: Lane, const N: usize, const EXACT: bool>(self, table: &[U; N]) -> V<S, U, W> {
        // Unless `EXACT`, the indices of large tables are clamped.
        choose! { Self::large::<N>() && !EXACT => self.simd_min(T::from_usize(N - 1)), _ => self }
            .chained::<U, N, EXACT>(table)
    }
    #[on(X86)]
    #[op]
    fn chained<U: Lane, const N: usize, const EXACT: bool>(self, table: &[U; N]) -> V<S, U, W> {
        let d = self.tag().repartition::<U>();
        if const { Self::large::<N>() } && !is_known!(crate::Int::to_u64(U::unsigned(table)[N - 1])) {
            return_if!(N * size_of::<T>() <= 128, self.lookup_same::<U, N, EXACT>(table));
            return live!(
                Self::large::<N>(),
                d.masked_gather_index_or(d.zero(), d.mask_true(), table, self.places_in::<N>())
            );
        }
        return_if!(Self::packs::<N>(), {
            let at = choose! { EXACT => self & T::from_usize(N - 1), _ => self }.cast_signed().saturating_cast::<u8>();
            at.lookup_planes::<U, W, N, false>(table)
        });
        halves_if!(W::BYTES > S::REGISTER, |this: Self = self, table: &[U; N] = table| {
            let [lower, upper] = this.split();
            this.tag().repartition::<U>().combine(upper.lookup_chained::<_, N, EXACT>(table), lower.lookup_chained::<_, N, EXACT>(table))
        });
        let (bytes, block) = (d.repartition::<u8>(), self.isa().fixed::<u8, B16>());
        return_if!(size_of::<T>() == 1, {
            let each = passed!(|k: usize| bytes.dup(block.load_known(&U::bytes(table)[16 * k..])).as_table());
            self.bitcast::<u8>().in_chain::<EXACT>(N, &each).bitcast()
        });
        return_if!(size_of::<T>() == 4, {
            let (at, d) = (self.same::<u32, B32>(), Tag::<S, U, B32>::new(self.isa()));
            let one = always!(|k: usize| d.load_known(&table[8 * k..]).bitcast::<u32>().swizzle_dyn_relaxed(at));
            let odd = (at << 28).barrier().cast_signed().is_negative();
            let two = always!(|k: usize| odd.if_then_else(one(k + 1), one(k)));
            let upper = choose! { N > 24 => two(2), _ => one(2) };
            (at << 27).cast_signed().is_negative().if_then_else(upper, two(0)).bitcast::<U>().same()
        });
        // The lower and the upper bytes of 8 values, and of 8 more.
        let planes = always!(|k: usize| {
            let both = self.isa().fixed::<u8, B32>().load_known(&U::bytes(table)[32 * k..]);
            both.shuffle::<{ crate::pattern::EVEN_ODD_IN_BLOCK }, 0>(both).as_table().bitcast::<u64>()
        });
        return_if!(W::BYTES == 32 && N > 32, {
            // One in each block.
            let at = self.same::<u16, B32>();
            let at = choose! { EXACT => at & (N - 1) as u16, _ => at }.cast_signed();
            let cross = always!(|v: V<S, u8, B32>| v.bitcast::<u64>().shuffle4::<0b11_01_10_00>().bitcast::<u8>());
            let found = cross(at.in_blocks().saturating_narrow::<u8>(at))
                .in_chain::<false>(N, &passed!(|k: usize| cross(planes(k).bitcast())));
            cross(found)
                .barrier()
                .swizzle(
                    #[inline(always)]
                    |i| i / 16 * 16 + i % 16 / 2 + i % 2 * 8,
                )
                .bitcast::<U>()
                .same()
        });
        let of = always!(|i: usize| {
            let each = passed!(|k: usize| {
                let both = planes(k);
                bytes.resize_bitcast(if i == 0 {
                    both.shuffle4::<0b10_00_10_00>()
                } else {
                    both.shuffle4::<0b11_01_11_01>()
                })
            });
            self.bitcast::<u8>().in_chain::<EXACT>(N, &each).bitcast::<u16>()
        });
        (of(0) & 255 | of(1) << 8).bitcast()
    }
}
