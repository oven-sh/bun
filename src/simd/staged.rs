//! The loads and stores whose code is for plain slices, for the other elements.

use crate::{Isa, Lane, MaskOf, Operand, Output, Readable, Simd, Tag, Unsigned, Width, Writable};
use core::mem::MaybeUninit;

type V<T, W, S> = Simd<T, W, S>;

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// `f` of `from`, or of a copy of its first `n` values, which are four vectors at the most.
    #[op]
    #[track_caller]
    pub(crate) fn staged<E: Readable<T>, R, F: FnOnce(&[T]) -> R>(self, from: &[E], n: usize, f: F) -> R {
        return_if!(E::PLAIN, |from: &[E] = from, f: F = f| f(E::plain(from)));
        let (mut room, mut rest) = ([MaybeUninit::uninit(); 2048], &from[..n]);
        let mut copy = Output::new(&mut room);
        while let Some(v) = self.read_from(&mut rest) {
            copy.push(v);
        }
        if !rest.is_empty() {
            copy.push_first(self.load_any_n(rest), rest.len());
        }
        f(copy.into_filled())
    }
    #[op]
    pub(crate) fn load_any_padded<E: Readable<T>>(self, from: &[E], pad: T) -> V<T, W, S> {
        return_if!(E::PLAIN, |d: Self = self, from: &[E] = from, pad: T = pad| d.load_padded(E::plain(from), pad));
        self.load_any_or(from, pad)
    }
    #[op]
    pub(crate) fn within_slice(self, mask: MaskOf<T, W, S>, len: usize) -> MaskOf<T, W, S> {
        if crate::arithmetic::known(len >= self.lanes()) { mask } else { mask & self.first_n(len) }
    }
    #[op]
    pub(crate) fn masked_load_any<E: Readable<T>>(self, mask: MaskOf<T, W, S>, from: &[E]) -> V<T, W, S> {
        return_if!(E::PLAIN, |d: Self = self, mask: MaskOf<T, W, S> = mask, from: &[E] = from| d.masked_load(mask, E::plain(from)));
        mask.if_then_else_zero(self.load_any_n(from))
    }
    #[op]
    #[track_caller]
    pub(crate) fn gather_any<U: Unsigned, X: Width, E: Readable<T>>(
        self,
        no: impl Operand<T, W, S>,
        mask: MaskOf<T, W, S>,
        table: &[E],
        indices: V<U, X, S>,
    ) -> V<T, W, S> {
        require!("there has to be one index for each lane", X::BYTES / size_of::<U>() == W::BYTES / size_of::<T>());
        let no = no.vector(self);
        #[cfg(all(target_arch = "arm", not(miri)))]
        let indices = choose! { T::BITS == 64 || T::IS_FLOAT && T::BITS == 32 => indices.black_box(), _ => indices };
        return_if!(E::PLAIN, |d: Self = self, no: V<T, W, S> = no, mask: MaskOf<T, W, S> = mask, table: &[E] = table, indices: V<U, X, S> = indices| {
            d.masked_gather_index_or(no, mask, E::plain(table), indices)
        });
        return_if!(!E::PLAIN && E::BYTES && size_of::<U>() <= 4 && Self::LANES <= 128, |d: Self = self, no: V<T, W, S> = no, mask: MaskOf<T, W, S> = mask, table: &[E] = table, indices: V<U, X, S> = indices| {
            d.gather_clamped_or(no, mask, table, indices)
        });
        let (mut lanes, indices) = (no.to_array(), indices.to_array());
        for (lane, at) in lanes.as_mut().iter_mut().zip(indices.as_ref()) {
            if let Some(it) = usize::try_from(at.to_u64()).ok().and_then(|at| table.get(at)) {
                *lane = it.value();
            }
        }
        mask.if_then_else(self.from_array(lanes), no)
    }
    /// `to`, or its first `n` values as zeros, which LLVM leaves out if they are overwritten.
    #[op]
    #[track_caller]
    pub(crate) fn cleared<E: Writable<T>>(self, to: &mut [E], n: usize) -> &mut [T] {
        match E::plain(to) {
            Ok(to) => to,
            Err(to) => {
                let mut all = Output::new(&mut to[..n]);
                for _ in 0..n / Self::LANES {
                    all.push(self.zero());
                }
                all.into_filled()
            }
        }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[op]
    pub(crate) fn lanes_to_uninit(
        self,
        mask: MaskOf<T, W, S>,
        to: &mut [impl Writable<T>],
        place: impl Fn(usize) -> u64,
    ) {
        let (lanes, enabled) = (self.to_array(), mask.to_vector().cast_unsigned().to_array());
        for (i, (&lane, &enabled)) in lanes.as_ref().iter().zip(enabled.as_ref()).enumerate() {
            if let Some(to) =
                usize::try_from(place(i)).ok().and_then(|at| to.get_mut(at)).filter(|_| enabled != Default::default())
            {
                Writable::write_lane(to, lane);
            }
        }
    }
}
