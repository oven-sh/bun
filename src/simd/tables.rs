//! `lookup` in large tables, and of values that have another size than the indices.

use crate::{B16, B32, B64, B128, B256, Isa, Lane, Simd, Tag, Unsigned, Width};

type V<S, T, W> = Simd<T, W, S>;

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    /// A table of more than 128 bytes takes a permutation for each 128. How many of its bytes there are for a lane of a register.
    const fn share<U, const N: usize>() -> usize {
        let (size, lanes) = (size_of::<U>(), W::BYTES / size_of::<T>());
        (N * size).div_ceil(if lanes == 0 {
            1
        } else if lanes * size < 64 {
            lanes
        } else {
            64 / size
        })
    }
    const fn by_permutations<U, const N: usize>() -> bool {
        crate::X86
            && S::REGISTER == 64
            && size_of::<U>() > 1
            && (W::BYTES / size_of::<T>() * size_of::<U>() >= 64 || Self::share::<U, N>() <= 64)
            && !(S::FAST_GATHER && Self::or_gather::<U, N>())
    }
    const fn or_gather<U, const N: usize>() -> bool {
        size_of::<U>() >= 4 && W::BYTES / size_of::<T>() * size_of::<U>() >= 64 && Self::share::<U, N>() > 32
    }
    /// A table for each byte of the values.
    const fn by_planes<U, const N: usize>() -> bool {
        size_of::<T>() == 1
            && size_of::<U>() > 1
            && cfg!(target_endian = "little")
            && S::LOOKS_UP_IN_REGISTERS
            && !S::AVX512VL
            && W::BYTES >= 16
            && N * size_of::<U>() <= if S::A64 || S::AVX2 { 256 } else { 128 }
            && !(S::AVX2 && size_of::<U>() == 4 && N <= 8)
    }

    /// The index counts modulo `N` if `EXACT`.
    #[op]
    #[track_caller]
    pub(crate) fn lookup_any<U: Lane, X: Width, const N: usize, const EXACT: bool>(self, table: &[U; N]) -> V<S, U, X> {
        require!(
            "there is no vector with as many lanes of that type: the widths are 2 to 512 bytes",
            X::BYTES / size_of::<U>() == W::BYTES / size_of::<T>()
        );
        self.lookup_fitting::<U, X, N, EXACT>(table)
    }
    #[op]
    fn lookup_fitting<U: Lane, X: Width, const N: usize, const EXACT: bool>(self, table: &[U; N]) -> V<S, U, X> {
        const fn small<U, const N: usize>() -> bool {
            N * size_of::<U>() <= 128 || N <= 256 && size_of::<U>() == 1
        }
        choose! {
            crate::X86 && size_of::<T>() == size_of::<U>() && Self::chains::<N>() => apart!(self.isa(), self.lookup_chained::<U, N, EXACT>(table).same()),
            size_of::<T>() == size_of::<U>() && small::<U, N>() => self.lookup_same::<U, N, EXACT>(table).same(),
            _ => apart!(self.isa(), {
                let d = Tag::<S, U, X>::new(self.isa());
                let within = always!(|| choose! { EXACT => self & T::from_usize(N - 1), _ => self });
                if const { Self::by_permutations::<U, N>() && Self::or_gather::<U, N>() } && crate::tuning::fast_gather() {
                    return live!(
                        S::AVX512F && Self::by_permutations::<U, N>() && Self::or_gather::<U, N>(),
                        d.gather_small(table, within().cast::<u32>())
                    );
                }
                choose! {
                    N == 0 => d.zero(),
                    Self::by_planes::<U, N>() => self.same::<u8, W>().lookup_planes::<U, X, N, EXACT>(table),
                    size_of::<T>() != size_of::<U>() && V::<S, U::Unsigned, X>::chains::<N>() => {
                        self.cast::<U::Unsigned>().same::<U::Unsigned, X>().lookup_fitting::<U, X, N, EXACT>(table)
                    },
                    small::<U, N>() || Self::by_permutations::<U, N>() => {
                        self.cast::<U::Unsigned>().same::<U::Unsigned, X>().lookup_same::<U, N, EXACT>(table)
                    },
                    size_of::<T>() == 8 && !N.is_power_of_two() => d.masked_gather_index_or(d.zero(), d.mask_true(), table, self.cast::<u32>().places_in::<N>()),
                    _ => d.masked_gather_index_or(d.zero(), d.mask_true(), table, self.places_in::<N>()),
                }
            }),
        }
    }
    /// Modulo `N` if that is a power of two, and else some index below it.
    #[op]
    pub(crate) fn places_in<const N: usize>(self) -> Self {
        choose! {
            N.is_power_of_two() => self & T::from_usize(N - 1),
            size_of::<T>() > 1 || N < 256 => self.simd_min(T::from_usize(N - 1)),
            _ => self,
        }
    }
    /// Whether a lookup of bytes gives zero for what is out of range.
    const fn zero_outside<U, const N: usize>() -> bool {
        size_of::<T>() == 1
            && size_of::<U>() == 1
            && ((S::A64 || S::SSSE3 && !S::AVX512VL) && N <= 128 || S::WASM && N <= 16)
    }
    #[op]
    #[track_caller]
    pub(crate) fn lookup_or_any<U: Lane, X: Width, const N: usize>(
        self,
        table: &[U; N],
        or: impl crate::Operand<U, X, S>,
    ) -> V<S, U, X> {
        require!(
            "there is no vector with as many lanes of that type: the widths are 2 to 512 bytes",
            X::BYTES / size_of::<U>() == W::BYTES / size_of::<T>()
        );
        self.lookup_or_fitting(table, or)
    }
    #[op]
    fn lookup_or_fitting<U: Lane, X: Width, const N: usize>(
        self,
        table: &[U; N],
        or: impl crate::Operand<U, X, S>,
    ) -> V<S, U, X> {
        let d = Tag::<S, U, X>::new(self.isa());
        return_if!(N == 0, or.vector(d));
        return_if!(size_of::<T>() == 1 && N >= 256, self.lookup_fitting::<U, X, N, false>(table));
        if_here!(
            (S::A64 || S::SSSE3 || S::WASM) && Self::zero_outside::<U, N>(),
            if let Some(or) = crate::Operand::number(or) {
                let or = crate::Int::to_u64(U::unsigned(&[or])[0]) as u8;
                return live!(
                    (S::A64 || S::SSSE3 || S::WASM) && Self::zero_outside::<U, N>(),
                    self.same::<u8, X>().lookup_or_byte(table, or).bitcast()
                );
            }
        );
        return_if!(
            S::A64 && size_of::<T>() == 1 && size_of::<U>() == 1 && N <= 64 && N % 16 == 0,
            self.same::<u8, X>().tbx(table, or.vector(d))
        );
        return_if!(crate::X86 && Self::IN_CHAINS && Self::zero_outside::<U, N>(), {
            let at = self.same::<u8, X>();
            let beyond = at.saturating_add(128 - N as u8).barrier().cast_signed().is_negative().retype::<U::Signed>();
            beyond.if_then_else(or, self.lookup_fitting::<U, X, N, false>(table))
        });
        let within: crate::MaskOf<U, X, S> = crate::raw::same(self.simd_lt(T::from_usize(N)).rebind::<U::Signed>());
        within.if_then_else(self.lookup_fitting::<U, X, N, false>(table), or)
    }
    /// By the highest bit of the index, from the lower or the upper part.
    #[op]
    pub(crate) fn lookup_parts<U: Lane>(self, table: &[U]) -> V<S, U, W> {
        halves_if!(W::BYTES > 64, |this: Self = self, table: &[U] = table| {
            this.tag().repartition::<U>().combine(this.upper_half().lookup_parts(table), this.lower_half().lookup_parts(table))
        });
        let (d, n) = (self.isa().fixed::<U, B64>(), 128 / size_of::<U>());
        let at = d.to_unsigned().resize_bitcast(self);
        let one = always!(|k: usize| {
            let from = &table[(k * n).min(table.len())..];
            d.load_known(from).concat_swizzle_dyn_relaxed(
                d.load_known(&from[(n / 2).min(from.len())..]),
                at & U::Unsigned::from_usize(n - 1),
            )
        });
        let has = always!(|bit: usize| at.any_bits(U::Unsigned::from_usize(bit)).retype::<U::Signed>());
        let two = always!(|k: usize| {
            let lower = one(k);
            if table.len() > (k + 1) * n { has(n).if_then_else(one(k + 1), lower) } else { lower }
        });
        let four = always!(|k: usize| {
            let lower = two(k);
            if table.len() > (k + 2) * n { has(2 * n).if_then_else(two(k + 2), lower) } else { lower }
        });
        let lower = four(0);
        let all = if table.len() > 4 * n { has(4 * n).if_then_else(four(4), lower) } else { lower };
        self.tag().repartition::<U>().resize_bitcast(all)
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    #[on(A64)]
    #[op]
    fn tbx<U: Lane, const N: usize>(self, table: &[U; N], or: V<S, U, W>) -> V<S, U, W> {
        halves_if!(W::BYTES > 16, |this: Self = self, table: &[U; N] = table, or: V<S, U, W> = or| {
            or.tag().combine(this.upper_half().tbx(table, or.upper_half()), this.lower_half().tbx(table, or.lower_half()))
        });
        let all = self.s.fixed::<U, B64>().load_known(table).bytes();
        or.with_bytes(W::from16(self.s.table_or(W::to16(or.bytes()), all, W::to16(self.bytes()), N / 16)))
    }
    #[op]
    pub(crate) fn lookup_planes<U: Lane, X: Width, const N: usize, const EXACT: bool>(
        self,
        table: &[U; N],
    ) -> V<S, U, X> {
        let d = Tag::<S, U, X>::new(self.isa());
        choose! {
            W::BYTES > S::REGISTER || W::BYTES > 32 => {
                let [lower, upper] = self.split();
                d.combine(upper.lookup_planes::<_, _, N, EXACT>(table), lower.lookup_planes::<_, _, N, EXACT>(table))
            },
            _ => self.lookup_planes_once::<U, X, N, EXACT>(table),
        }
    }
    #[op]
    fn lookup_planes_once<U: Lane, X: Width, const N: usize, const EXACT: bool>(self, table: &[U; N]) -> V<S, U, X> {
        let at = choose! { EXACT && N < 256 => self & (N - 1) as u8, _ => self };
        // So that the lanes end up in order without crossing blocks.
        let at = choose! {
            W::BYTES == 32 => at.swizzle(#[inline(always)] |i| {
                let group = 16 / size_of::<U>();
                (i % 16 / group * 2 + i / 16) * group + i % group
            }),
            _ => at,
        };
        macro_rules! planes {
            ($k:literal) => {
                choose! {
                    N <= 16 => planes!($k B16 16), N <= 32 => planes!($k B32 32), N <= 64 => planes!($k B64 64),
                    N <= 128 => planes!($k B128 128), _ => planes!($k B256 256),
                }
            };
            ($k:literal $w:ident $n:literal) => {{
                let all: [U; $n] = crate::array::own::from_fn(
                    #[inline(always)]
                    |i| table[i % N],
                );
                let planes: [V<S, u8, $w>; $k] = self.isa().fixed::<u8, $w>().load_interleaved_any(U::bytes(&all));
                crate::array::own::map(
                    planes,
                    #[inline(always)]
                    |it| at.lookup_fitting::<u8, W, $n, false>(it.as_ref().first_chunk().unwrap()),
                )
            }};
        }
        let zip = always!(|a: Self, b: Self| a.in_blocks().interleave(b));
        let zip2 = always!(|a: Self, b: Self| a.bitcast::<u16>().in_blocks().interleave(b.bitcast::<u16>()));
        choose! {
            size_of::<U>() == 2 => {
                let [a, b] = planes!(2);
                let [a, b] = zip(a, b);
                a.concat(b).bitcast::<U>().same()
            },
            size_of::<U>() == 4 => {
                let [a, b, c, d] = planes!(4);
                let ([a, b], [c, d]) = (zip(a, b), zip(c, d));
                let ([a, b], [c, d]) = (zip2(a, c), zip2(b, d));
                a.concat(b).concat(c.concat(d)).bitcast::<U>().same()
            },
            _ => {
                let [a, b, c, d, e, f, g, h] = planes!(8);
                let ([a, b], [c, d], [e, f], [g, h]) = (zip(a, b), zip(c, d), zip(e, f), zip(g, h));
                let ([a, b], [c, d], [e, f], [g, h]) = (zip2(a, c), zip2(b, d), zip2(e, g), zip2(f, h));
                let zip4 = always!(|a: V<S, u16, W>, b: V<S, u16, W>| {
                    let [a, b] = a.bitcast::<u32>().in_blocks().interleave(b.bitcast::<u32>());
                    a.concat(b)
                });
                zip4(a, e).concat(zip4(b, f)).concat(zip4(c, g).concat(zip4(d, h))).bitcast::<U>().same()
            },
        }
    }
}
