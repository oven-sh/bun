//! Gathers that clamp the indices.

use crate::{Isa, Lane, MaskOf, Readable, Simd, Tag, Unsigned, Width};

type V<S, T, W> = Simd<T, W, S>;

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// There is an instruction, and on some CPU with this target it pays. To ask costs the others up to 14% with vectors of 32 bytes.
    pub(crate) const CLAMPS: bool = S::AVX2
        && size_of::<T>() >= 4
        && usize::BITS == 64
        && !cfg!(miri)
        && (W::BYTES >= 64 && S::REGISTER == 64
            || W::BYTES >= 32 && size_of::<T>() == 4 && (S::FAST_GATHER || S::AVXVNNI));
    /// A load of four bytes to all lanes takes no shuffle, and one of fewer does.
    pub(crate) const BY_FOURS: bool = S::AVX2 && size_of::<T>() < 4 && W::BYTES / size_of::<T>() >= 16;

    #[op]
    pub(crate) fn gathers_are_fast(self, len: usize) -> bool {
        (len <= 1 << 31)
            & (const { S::FAST_GATHER || S::REGISTER == 64 && !S::AVX512VBMI && size_of::<T>() <= 4 }
                || crate::tuning::fast_gather())
    }

    /// `lane` of each index, or of `len - n` if that is less. It has to read the lane that starts at this element. Panics if `n > len`.
    #[inline(always)]
    fn clamped<X: Width, E: Readable<U>, U: Lane>(
        self,
        table: &[E],
        n: usize,
        at: V<S, u32, X>,
        lane: &impl Fn(usize) -> T::Unsigned,
    ) -> V<S, T, W> {
        apart!(self.simd(), {
            if const { Self::CLAMPS && E::BYTES } && self.gathers_are_fast(table.len()) {
                return live!(
                    S::AVX2 && Self::CLAMPS && E::BYTES,
                    self.clamped_at_once(E::bytes(table), size_of::<E>(), at)
                );
            }
            choose! { S::AVX2 && Self::BY_FOURS && E::BYTES && (S::REGISTER == 64 || S::AVXVNNI || S::FAST_GATHER) => {
                let bytes = E::bytes(table);
                if bytes.len() < 4 || bytes.len() > 1 << 31 {
                    core::hint::cold_path();
                    let (mut lanes, at, last) = (self.to_unsigned().zero().to_array(), at.to_array(), table.len() - n);
                    for (it, &at) in lanes.as_mut().iter_mut().zip(at.as_ref()) {
                        *it = lane((at as usize).min(last));
                    }
                    return self.to_unsigned().from_array(lanes).reinterpret();
                }
                let at = at.simd_min((table.len() - n) as u32) * size_of::<E>() as u32;
                // The last lanes are further up in the last four bytes.
                let beyond = at - at.simd_min((bytes.len() - 4) as u32);
                let four = at.tag().gather_bytes(bytes, at) >> (beyond << 3);
                four.cast::<T::Unsigned>().same::<T::Unsigned, W>().reinterpret()
            }, _ => self.by_loads(table.len(), n, at, lane) }
        })
    }
    #[op]
    pub(crate) fn by_loads<X: Width>(
        self,
        len: usize,
        n: usize,
        at: V<S, u32, X>,
        lane: &impl Fn(usize) -> T::Unsigned,
    ) -> V<S, T, W> {
        return_if!(X::BYTES > 64 || W::BYTES > 64, {
            let ([lower, upper], half) = (at.split(), self.half());
            self.combine(half.by_loads(len, n, upper, lane), half.by_loads(len, n, lower, lane))
        });
        let at = at.below(len, n);
        self.to_unsigned().lane_by_lane(0, &passed!(|i: usize| lane(at[i]))).reinterpret()
    }
    #[on(X86)]
    #[op]
    fn clamped_at_once<X: Width>(self, bytes: &[u8], step: usize, at: V<S, u32, X>) -> V<S, T, W> {
        return_if!(W::BYTES > S::REGISTER, {
            let ([lower, upper], half) = (at.split(), self.half());
            self.combine(half.clamped_at_once(bytes, step, upper), half.clamped_at_once(bytes, step, lower))
        });
        let s = self.simd();
        self.zero().with_bytes(choose! {
            size_of::<T>() == 8 => W::from64(s.gather_eight(bytes, X::to32(at.bytes()), step)),
            W::BYTES == 64 => W::from64(s.gather_four(bytes, X::to64(at.bytes()), step)),
            _ => W::from32(s.gather_four_32(bytes, X::to32(at.bytes()), step)),
        })
    }
    /// `gather_clamped` from a short table, for a caller that knows that gathers are fast.
    #[on(X86)]
    #[op]
    pub(crate) fn gather_small<X: Width, const N: usize>(self, table: &[T; N], at: V<S, u32, X>) -> V<S, T, W> {
        choose! {
            S::AVX2 && Self::CLAMPS => apart!(self.simd(), self.clamped_at_once(<T as Readable<T>>::bytes(table), size_of::<T>(), at)),
            _ => self.gather_clamped(table, at),
        }
    }
    #[op]
    pub(crate) fn gather_clamped<X: Width, E: Readable<T>>(self, table: &[E], at: V<S, u32, X>) -> V<S, T, W> {
        self.clamped(
            table,
            1,
            at,
            &passed!(|i: usize| choose! { E::PLAIN => T::unsigned(E::plain(table))[i], _ => T::unsigned(&[table[i].value()])[0] }),
        )
    }
    /// `no` where `mask` is false or the index, which has up to 32 bits, is out of bounds.
    #[op]
    pub(crate) fn gather_clamped_or<U: Unsigned, X: Width, E: Readable<T>>(
        self,
        no: V<S, T, W>,
        mask: MaskOf<T, W, S>,
        table: &[E],
        indices: V<S, U, X>,
    ) -> V<S, T, W> {
        let Some(last) = table.len().checked_sub(1) else { return no };
        self.or(no, mask, last, indices, self.gather_clamped(table, indices.cast::<u32>()))
    }
    /// The same by the instruction, for 1 to 2^31 values.
    #[on(X86)]
    #[op]
    pub(crate) fn gather_at_once_or<U: Unsigned, X: Width>(
        self,
        no: V<S, T, W>,
        mask: MaskOf<T, W, S>,
        table: &[T],
        indices: V<S, U, X>,
    ) -> V<S, T, W> {
        self.or(
            no,
            mask,
            table.len() - 1,
            indices,
            self.clamped_at_once(T::bytes(table), size_of::<T>(), indices.cast::<u32>()),
        )
    }
    #[op]
    fn or<U: Unsigned, X: Width>(
        self,
        no: V<S, T, W>,
        mask: MaskOf<T, W, S>,
        last: usize,
        indices: V<S, U, X>,
        all: V<S, T, W>,
    ) -> V<S, T, W> {
        if_here!(
            S::A64 && crate::OPTIMIZED,
            if indices.known_at_most(last) {
                return mask.if_then_else(all, no);
            }
        );
        let within = indices.simd_le(U::from_u64((last as u64).min(U::MAX.to_u64())));
        let within: MaskOf<T, W, S> = crate::raw::same(within.rebind::<T::Signed>());
        (if crate::OPTIMIZED && crate::arithmetic::known(mask.all()) { within } else { mask & within })
            .if_then_else(all, no)
    }
    #[op]
    #[track_caller]
    pub(crate) fn gather_bytes<X: Width, E: Readable<u8>>(self, bytes: &[E], at: V<S, u32, X>) -> V<S, T, W> {
        require!("there has to be one index for each lane", X::BYTES / 4 == W::BYTES / size_of::<T>());
        assert!(bytes.len() >= size_of::<T>());
        self.clamped(
            bytes,
            size_of::<T>(),
            at,
            &passed!(|i: usize| {
                let from = &bytes[i..];
                T::Unsigned::from_u64(choose! {
                    size_of::<T>() == 1 => from[0].value() as u64,
                    size_of::<T>() == 2 => u16::from_le_bytes(E::values(from)) as u64,
                    size_of::<T>() == 4 => u32::from_le_bytes(E::values(from)) as u64,
                    _ => u64::from_le_bytes(E::values(from)),
                })
            }),
        )
    }
}

impl<S: Isa, U: Unsigned, X: Width> Simd<U, X, S> {
    /// Whether LLVM knows that no lane is above `last`.
    #[on(A64)]
    #[op]
    pub(crate) fn known_at_most(self, last: usize) -> bool {
        use crate::raw::{Raw, RawMask};
        is_known!(last)
            && crate::arithmetic::known(self.raw.le(Raw::splat(U::from_u64((last as u64).min(U::MAX.to_u64())))).all())
    }
}
