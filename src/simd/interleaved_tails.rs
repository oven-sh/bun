//! Interleaved values that don't fill their vectors.

use crate::raw::Raw;
use crate::{B16, B32, B64, Isa, Lane, Place, Readable, Region, Simd, Tag, Width, Writable};

type V<T, W, S> = Simd<T, W, S>;
type Four<W> = <<W as Width>::Twice as Width>::Twice;

/// Whether K vectors at the start of the slice are in a page that it reaches.
#[op]
fn in_one_page<E, W: Width, const K: usize>(slice: &[E]) -> bool {
    let is = !slice.is_empty() && slice.as_ptr().addr() % 4096 <= 4096 - K * W::BYTES;
    if !is {
        core::hint::cold_path();
    }
    is
}

/// LLVM would make shuffles of registers of ld3 and st3, and move single lanes for them.
#[op]
fn in_memory<T>(room: &mut [T]) {
    if !crate::X86 {
        core::hint::black_box(room);
    }
}

/// With the number of values in `K` vectors as a constant.
macro_rules! by_values { ($k:ident, $n:ident, $body:expr) => { by_values!($k, $n, $body, 2 3 4 6 8 12 16 24 32 48 64 96 128 192 256) };
    ($k:ident, $n:ident, $body:expr, $($each:literal)*) => {{
        $(return_if!($k * Self::LANES == $each, { const $n: usize = $each; $body });)*
        unreachable!()
    }};
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    pub(crate) const SPLIT: bool = W::BYTES > S::REGISTER && W::BYTES > 16;
    /// By way of memory, loads wait for stores.
    const IN_REGISTERS: bool =
        S::A64 && cfg!(target_endian = "little") && matches!(W::BYTES, 8 | 16) && Self::LANES > 1;
    /// Byte `i` of result `k` is in lane `lane(k * LANES + i / size)` of all three.
    #[on(A64)]
    #[op]
    fn of_three(self, [a, b, c]: [V<T, W, S>; 3], k: usize, lane: impl Fn(usize) -> usize) -> V<T, W, S> {
        let at = self.repartition::<u8>().from_fn(
            #[inline(always)]
            |i| (lane(k * Self::LANES + i / size_of::<T>()) * size_of::<T>() + i % size_of::<T>()) as u8,
        );
        a.with_bytes(self.simd().table_in_three::<W>(a.bytes(), b.bytes(), c.bytes(), at.bytes()))
    }
    #[on(A64)]
    #[op]
    fn load_and_part<const K: usize>(self, from: &[T]) -> [V<T, W, S>; K] {
        return_if!(
            W::BYTES < 16,
            crate::array::own::map(
                self.simd().fixed::<T, B16>().load_and_part(from),
                always!(|v| self.resize_bitcast(v))
            )
        );
        let n = Self::LANES;
        let part = always!(|a, b| [self.concat_even(b, a), self.concat_odd(b, a)]);
        let halves =
            always!(|v: V<T, B32, S>| [self.resize_bitcast(v.lower_half()), self.resize_bitcast(v.upper_half())]);
        return_if!(K == 2, {
            let [a, b] = halves(self.simd().fixed().load_n(from));
            *part(a, b).first_chunk().unwrap()
        });
        let all = self.simd().fixed::<T, B64>().load_n(from);
        let ([a, b], [c, d]) = (halves(all.lower_half()), halves(all.upper_half()));
        return_if!(K == 3, {
            let of = always!(|k| self.of_three([a, b, c], k, always!(|j: usize| j % n * 3 + j / n)));
            *[of(0), of(1), of(2)].first_chunk().unwrap()
        });
        let ([a, b], [c, d]) = (part(a, b), part(c, d));
        let ([a, c], [b, d]) = (part(a.barrier(), c.barrier()), part(b.barrier(), d.barrier()));
        *[a, b, c, d].first_chunk().unwrap()
    }
    /// For fewer values than `v` has.
    #[on(A64)]
    #[op]
    fn mix_and_store<const K: usize>(self, v: [V<T, W, S>; K], to: &mut [T]) {
        return_if!(W::BYTES < 16, {
            let d = self.simd().fixed::<T, B16>();
            d.mix_and_store(crate::array::own::map(v, always!(|v| d.resize_bitcast(v))), to)
        });
        let n = Self::LANES;
        let mix = always!(|a: V<T, W, S>, b| [a.interleave_lower(b), a.interleave_upper(b)]);
        return_if!(K == 2, {
            let [a, b] = mix(v[0], v[1]);
            a.concat(b).store_n(to)
        });
        return_if!(K == 3, {
            let of = always!(|k| self.of_three([v[0], v[1], v[2]], k, always!(|j: usize| j % 3 * n + j / 3)));
            of(0).concat(of(1)).concat(of(2).concat(of(2))).store_n(to)
        });
        let ([a, b], [c, d]) = (mix(v[0], v[2]), mix(v[1], v[K - 1]));
        let ([a, b], [c, d]) = (mix(a.barrier(), c.barrier()), mix(b.barrier(), d.barrier()));
        a.concat(b).concat(c.concat(d)).store_n(to)
    }
    const MASKMOV: bool = crate::X86 && S::REGISTER == 32 && size_of::<T>() >= 4;
    const fn one_mask<const K: usize>() -> bool {
        Self::BY_BITS && S::REGISTER == 64 && W::BYTES >= 16 && K != 3 && K * Self::LANES <= 64
    }
    /// Whether a load would be longer than a vector, and wait for several stores.
    const fn loads_more<const K: usize>() -> bool {
        let all = K.next_power_of_two();
        K * W::BYTES > 8 && (W::BYTES < 16 || all * W::BYTES <= S::REGISTER && all * size_of::<T>() <= 4)
    }
    const fn one_load<const K: usize>() -> bool {
        Self::one_mask::<K>()
            || W::BYTES == 16
                && (K == 2 && Self::MASKMOV || K == 3 && T::BITS != 16 && Self::BY_BITS && S::Native::BYTES == 64)
    }

    #[op]
    #[track_caller]
    pub(crate) fn load_interleaved_any<const K: usize, E: Readable<T>>(self, from: &[E]) -> [V<T, W, S>; K] {
        if const { K == 1 } {
            return live!(K == 1, [self.load_any(from); K]);
        }
        if const { K > 4 && !E::PLAIN } {
            let from = &from[..K * Self::LANES];
            return live!(K > 4 && !E::PLAIN, self.load_interleaved_n(from));
        }
        if const { (S::A64 && K > 2 || S::SSE2 || S::WASM) && K <= 4 && E::AT_ONCE } {
            let from = &from[..K * Self::LANES];
            return live!(K <= 4 && (S::A64 && K > 2 || S::SSE2 || S::WASM) && E::AT_ONCE, self.load_at_once(from));
        }
        if_here!(S::A64 && E::PLAIN && Self::in_place::<K>(), {
            return self.load_in_place(&E::plain(from)[..K * Self::LANES]);
        });
        self.staged(
            from,
            K * Self::LANES,
            #[inline(always)]
            |from| self.load_interleaved(from),
        )
    }
    const fn in_place<const K: usize>() -> bool {
        (K == 3 && W::BYTES >= 16 || K == 4 && W::BYTES == 8) && crate::OPTIMIZED && !cfg!(target_vendor = "apple")
    }
    /// If `ld3` and `ld4` also move the pointer, they take twice as long on Neoverse V1 and V2.
    #[on(A64)]
    #[op]
    fn load_in_place<const K: usize>(self, from: &[T]) -> [V<T, W, S>; K] {
        halves_if!(W::BYTES > 16, |this: Self = self, from: &[T] = from| {
            let (lower, upper) = from.split_at(K * Self::LANES / 2);
            let (lower, upper) = (this.half().load_in_place::<K>(lower), this.half().load_in_place::<K>(upper));
            crate::array::own::from_fn(#[inline(always)] |k| this.combine(upper[k], lower[k]))
        });
        let (from, last) = (&from[..K * Self::LANES], crate::regs::count(usize::MAX));
        // If `from` is an array and this place is known, LLVM loads from both and chooses among the values.
        let never = &crate::plain::read_as::<T>(&[0u64; 7])[last >> (usize::BITS - 1)..][..K * Self::LANES];
        let always = from.as_ptr() <= core::ptr::without_provenance(last);
        self.load_interleaved(core::hint::select_unpredictable(always, from, never))
    }
    /// `ld3` and `ld4` are made of one long load.
    #[op]
    fn load_at_once<const K: usize, E: Readable<T>>(self, from: &[E]) -> [V<T, W, S>; K] {
        return_if!(
            Self::SPLIT,
            apart!(self.simd(), {
                let (lower, upper) = from.split_at(K * Self::LANES / 2);
                let (lower, upper) = (self.half().load_at_once::<K, E>(lower), self.half().load_at_once::<K, E>(upper));
                crate::array::own::from_fn(
                    #[inline(always)]
                    |k| self.combine(upper[k], lower[k]),
                )
            })
        );
        by_values!(K, N, self.load_interleaved(&E::values::<N>(from)))
    }
    const fn at_once<const K: usize, P: Place<T>>() -> bool {
        S::A64 && P::AT_ONCE && !(P::CHANGES && K == 4 && W::BYTES < 16)
            || (S::SSE2 || S::WASM) && !P::SHARED && !(P::CHANGES && K * W::BYTES > 192)
    }
    #[op]
    fn write_at_once<const K: usize, P: Place<T>>(self, v: [V<T, W, S>; K], to: P) {
        by_values!(K, N, Self::write_values::<N, K, P>(v, to))
    }
    #[op]
    fn write_values<const N: usize, const K: usize, P: Place<T>>(v: [V<T, W, S>; K], mut to: P) {
        let mut all = [T::ZERO; N];
        let room: &mut [T] = &mut all;
        choose! { |v: [V<T, W, S>; K] = v, all: &mut [T] = room|
            S::A64 && P::CHANGES && K == 4 && W::BYTES == 16 => {
                let (a, b, c, d) = (v[0], v[1], v[2], v[K - 1]);
                let (ac, bd) = ([a.interleave_lower(c).black_box(), a.interleave_upper(c).black_box()], [b.interleave_lower(d).black_box(), b.interleave_upper(d).black_box()]);
                unrolled!(2, for k in 0..2 {
                    ac[k].interleave_lower(bd[k]).store(&mut all[2 * k * Self::LANES..]);
                    ac[k].interleave_upper(bd[k]).store(&mut all[(2 * k + 1) * Self::LANES..]);
                });
            },
            S::A64 && K == 3 => v[0].tag().store_interleaved(crate::array::own::map(v, #[inline(always)] |v| P::ahead(v)), all),
            _ => v[0].tag().store_interleaved(v, all),
        }
        to.write(0, all)
    }
    #[op]
    pub(crate) fn load_interleaved_n<const K: usize, E: Readable<T>>(self, from: &[E]) -> [V<T, W, S>; K] {
        return_if!(K == 1, [self.load_any_n(from); K]);
        let n = Self::LANES;
        return_if!(
            Self::SPLIT,
            apart!(self.simd(), {
                let (lower, upper) = from.split_at(from.len().min(K * n / 2));
                let (lower, upper) =
                    (self.half().load_interleaved_n::<K, E>(lower), self.half().load_interleaved_n::<K, E>(upper));
                crate::array::own::from_fn(
                    #[inline(always)]
                    |k| self.combine(upper[k], lower[k]),
                )
            })
        );
        return_if!(K > 4, self.load_records_n(from));
        return_if!(crate::X86 && Self::one_load::<K>() && E::PLAIN, self.load_as_one(from, false));
        let mut all = self.simd().fixed::<T, Four<W>>().zero().to_array();
        return_if!((Self::BY_BITS || Self::MASKMOV) && E::PLAIN && W::BYTES >= 16, {
            let (from, near) = (E::plain(from), in_one_page::<E, W, K>(from));
            let part = always!(|k: usize| &from[from.len().min(k * n)..]);
            let parts: [_; K] = if near {
                crate::array::own::from_fn(
                    #[inline(always)]
                    |k| {
                        V::new(
                            self.simd(),
                            choose! {
                                Self::BY_BITS => Raw::load_by_bits(self.simd(), part(k), 0, self.zero().raw),
                                _ => self.load_up_to(part(k)).raw,
                            },
                        )
                    },
                )
            } else {
                crate::array::own::from_fn(
                    #[inline(always)]
                    |k| self.load_n(part(k)),
                )
            };
            unrolled!(
                4,
                for k in 0..K {
                    parts[k].store(&mut all.as_mut()[k * n..]);
                }
            );
            self.load_interleaved(Self::elsewhere::<K, _>(&all).as_ref())
        });
        // The two ways meet before the vector is taken apart.
        return_if!(Self::BY_BITS && Self::loads_more::<K>() && K != 3, self.load_as_one(from, from.len() >= K * n));
        if from.len() >= K * n {
            return self.load_interleaved_any(from);
        }
        return_if!(S::A64 && Self::IN_REGISTERS && E::PLAIN, self.load_and_part(E::plain(from)));
        return_if!(crate::X86 && Self::loads_more::<K>(), self.load_as_one(from, false));
        let (room, mut rest, mut at) = (all.as_mut(), from, 0);
        while let Some(v) = self.read_from(&mut rest) {
            v.store(&mut room[at..]);
            at += n;
        }
        self.load_any_n(rest).store(&mut room[at..]);
        in_memory(room);
        self.load_interleaved(Self::elsewhere::<K, _>(&all).as_ref())
    }
    #[on(X86)]
    #[op]
    fn load_as_one<const K: usize>(self, from: &[impl Readable<T>], whole: bool) -> [V<T, W, S>; K] {
        macro_rules! at {
            ($w:ty) => {{
                let d = self.simd().fixed::<T, $w>();
                self.load_interleaved(if whole { d.load_any(from) } else { d.load_any_n(from) }.to_array().as_ref())
            }};
        }
        choose! { K == 2 => at!(W::Twice), _ => at!(Four<W>) }
    }
    /// Where blocks are loaded one by one, LLVM would move single lanes, or widen a load over two stores, for which it then waits.
    #[op]
    fn elsewhere<const K: usize, A>(room: &A) -> &A {
        choose! { crate::X86 && K > 2 && W::BYTES >= 32 && (T::BITS < 32 && W::BYTES == 32 && !crate::vector::two_tables::<S, T>() || T::BITS == 32 && K == 3 && S::REGISTER == 32) => core::hint::black_box(room), _ => room }
    }

    #[op]
    #[track_caller]
    pub(crate) fn store_interleaved_any<const K: usize, E: Writable<T>>(self, v: [V<T, W, S>; K], to: &mut [E]) {
        if const { K == 1 } {
            return live!(K == 1, v[0].store(to));
        }
        if const { E::BYTES } {
            let to = &mut to[..K * Self::LANES];
            return live!(E::BYTES, self.write_interleaved_n(v, E::place(to)));
        }
        live!(!E::BYTES, self.store_interleaved(v, self.cleared(to, K * Self::LANES)))
    }
    #[op]
    pub(crate) fn store_interleaved_n<const K: usize, E: Writable<T>>(self, v: [V<T, W, S>; K], to: &mut [E]) {
        return_if!(K == 1, v[0].store_partial(to));
        return_if!(Self::BY_BITS && !E::BYTES && !Self::SPLIT && W::BYTES >= 16 && K <= 4, {
            let (n, mut room) = (Self::LANES, self.simd().fixed::<T, Four<W>>().zero().to_array());
            self.store_interleaved(v, room.as_mut());
            let (room, len) = (room.as_ref(), to.len());
            return_if!(S::REGISTER == 64 && K == 2, self.simd().fixed::<T, W::Twice>().load(room).store_first(to));
            return_if!(Self::one_mask::<K>(), self.simd().fixed::<T, Four<W>>().load(room).store_first(to));
            if in_one_page::<E, W, K>(to) {
                unrolled!(
                    4,
                    for k in 0..K {
                        self.load(&room[k * n..]).store_by_bits(&mut to[len.min(k * n)..], 0);
                    }
                );
            } else {
                unrolled!(
                    4,
                    for k in 0..K {
                        self.load(&room[k * n..]).store_partial(&mut to[len.min(k * n)..]);
                    }
                );
            }
        });
        self.write_interleaved_n(v, E::place(to))
    }

    /// The same as the next, where they rarely all fit.
    #[op]
    pub(crate) fn write_interleaved_rest<const K: usize, P: Place<T>>(self, v: [V<T, W, S>; K], mut to: P) {
        return_if!(!P::SLICE, self.write_interleaved_n(v, to));
        when!(P::SLICE, self.store_interleaved_n(v, to.as_mut_slice().unwrap_or_default()))
    }
    /// As many values as fit.
    #[op]
    pub(crate) fn write_interleaved_n<const K: usize, P: Place<T>>(self, v: [V<T, W, S>; K], mut to: P) {
        let n = Self::LANES;
        return_if!(K == 1, if to.len() >= n { v[0].write(&mut to, 0) } else { v[0].write_n(&mut to, 0) });
        return_if!(
            Self::SPLIT,
            apart!(self.simd(), |to: P| {
                let mut to = to;
                let at = to.len().min(K * n / 2);
                self.half().write_interleaved_n(
                    crate::array::own::map(
                        v,
                        #[inline(always)]
                        |v| v.lower_half(),
                    ),
                    to.again().slice(0..at),
                );
                self.half().write_interleaved_n(
                    crate::array::own::map(
                        v,
                        #[inline(always)]
                        |v| v.upper_half(),
                    ),
                    to.skip(at),
                )
            })
        );
        return_if!(K > 4, self.write_records_n(v, to));
        let whole = to.len() >= K * n;
        if const { P::SLICE }
            && whole
            && let Some(to) = to.as_mut_slice()
        {
            return self.store_interleaved(v, to);
        }
        if const { !P::SLICE && Self::at_once::<K, P>() } && whole {
            return live!(!P::SLICE && Self::at_once::<K, P>(), self.write_at_once(v, to));
        }
        return_if!(
            S::A64 && Self::IN_REGISTERS && P::SLICE,
            self.mix_and_store(v, to.as_mut_slice().unwrap_or_default())
        );
        apart!(self.simd(), |to: P| {
            let mut to = to;
            let mut room = self.simd().fixed::<T, Four<W>>().zero().to_array();
            let room = room.as_mut();
            self.store_interleaved(v, room);
            in_memory(room);
            if const { !P::SLICE } && whole {
                unrolled!(
                    4,
                    for k in 0..K {
                        self.load(&room[k * n..]).write(&mut to, k * n);
                    }
                );
                return;
            }
            let mut rest = &*room;
            while to.len() >= n {
                self.load(rest).write(&mut to, 0);
                (rest, to) = (&rest[n..], to.skip(n));
            }
            self.load(rest).write_n(&mut to, 0)
        })
    }
}
