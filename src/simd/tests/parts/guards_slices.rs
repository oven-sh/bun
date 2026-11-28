use bun_simd::{mem::*, *};
use core::sync::atomic::AtomicU8;
use framework::*;

#[inline(always)]
fn shared<S: Isa, T: Test, W: Width, const N: usize>(s: S, from: &[T], to: &mut [T])
where
    for<'a> &'a [Shared<N>]: Sink<T>,
    Shared<N>: Readable<T>,
{
    let (d, len) = (s.of::<T, W>(), from.len());
    let (n, other) = (d.lanes(), T::from_usize(125));
    // SAFETY: the bytes of lanes, which are borrowed for as long.
    fn view<T: Lane, const N: usize>(it: &mut [T]) -> &[Shared<N>] {
        unsafe { core::slice::from_raw_parts(it.as_mut_ptr().cast(), size_of_val(it) / N) }
    }
    for at in [0, len / 2, len.saturating_sub(n), len] {
        to.copy_from_slice(from);
        let v = d.load_or_default(&view(to)[at..]);
        assert!((0..n).all(|i| v[i] == *from.get(at + i).unwrap_or(&T::default())), "read_n");
        d.splat(other).store_partial_at(&mut view(to), at);
        assert!((0..len).all(|i| to[i] == if (at..at + n).contains(&i) { other } else { from[i] }), "write_n");
        if at + n <= len {
            d.load(&from[at..]).store_at(&mut view(to), at);
            assert_eq!(from, to, "write");
            assert_eq!(d.load_at(view(to), at).to_array().as_ref(), &from[at..][..n], "read");
        }
    }
    to.fill(other);
    d.over(from).map_into(
        &mut view(to),
        #[inline(always)]
        |v| v,
    );
    assert_eq!(from, to, "transform");
}

#[inline(always)]
fn bytes<S: Isa, W: Width>(s: S, from: &[u8], to: &mut [u8], at: usize) {
    let (d, len) = (s.of::<u8, W>(), from.len());
    let n = d.lanes();
    // SAFETY: as above.
    fn view(it: &mut [u8]) -> &[AtomicU8] {
        unsafe { core::slice::from_raw_parts(it.as_mut_ptr().cast(), it.len()) }
    }
    to.copy_from_slice(from);
    let v = d.load_or_default(&view(to)[at..]);
    assert!((0..n).all(|i| v[i] == *from.get(at + i).unwrap_or(&0)), "read_n");
    d.splat(125).store_partial_at(&mut view(to), at);
    assert!((0..len).all(|i| to[i] == if (at..at + n).contains(&i) { 125 } else { from[i] }), "write_n");
    if at + n <= len {
        d.load(&from[at..]).store_at(&mut view(to), at);
        assert_eq!(from, to, "write");
        assert_eq!(d.load_at(view(to), at).to_array().as_ref(), &from[at..][..n], "read");
    }
    to.copy_from_slice(from);
    let want = to.get_mut(at).map(|it| {
        *it = 127;
        at
    });
    assert_eq!(d.over(to).position_of_any(&[0, 127, 200]), want, "find_any_of");
    // The set is next to a guard.
    assert_eq!(d.over(&[127, 126, 1]).position_of_any(from), (len > 0).then_some(2), "find_any_of");
    let (all, matches) = (
        view(to),
        #[inline(always)]
        |v: Simd<u8, W, S>| v.simd_eq(127) | v.simd_eq(0),
    );
    assert_eq!(
        (d.over(all).position(matches), d.over(all).rposition(matches), d.over(all).count(matches)),
        (want, want, want.is_some() as usize)
    );
    d.over(all).map_into(
        &mut { all },
        #[inline(always)]
        |v| v + 1,
    );
    assert!((0..len).all(|i| to[i] == if i == at { 128 } else { from[i] + 1 }), "transform");
}

#[inline(always)]
fn slices<S: Isa, T: Test, W: Width>(s: S, from: &[T], to: &mut [T], at: usize) {
    let (d, len, mark) = (s.of::<T, W>(), from.len(), T::from_usize(127));
    if at == 0 {
        let sum: usize = (0..len).map(|i| 1 + i * 7 % 120).sum();
        assert_eq!(d.over(from).sum(), T::from_usize(sum), "sum");
        d.over(from).zip(from).map_into(
            to,
            #[inline(always)]
            |(a, b)| a + b,
        );
        d.over_mut(to).zip(from).map(
            #[inline(always)]
            |(a, b)| a - b,
        );
        assert_eq!(from, to, "transform2");
        assert!(
            d.over(from).zip(&*to).all(
                #[inline(always)]
                |(a, b)| a.simd_eq(b)
            ) && !d.over(&*to).zip(from).any(
                #[inline(always)]
                |(a, b)| a.simd_ne(b)
            ),
            "pairs"
        );
        d.over_mut(to).fill_with(
            #[inline(always)]
            |i| i.bitcast(),
        );
        assert!((0..len).all(|i| to[i].to_bits() == T::from_bits(i as u64).to_bits()), "generate");
        for limit in [0, 30, 90, 126].map(T::from_usize) {
            let want: Vec<T> = from.iter().copied().filter(|&it| it < limit).collect();
            assert_eq!(
                d.over(from).filter_into(
                    &mut to[len - want.len()..],
                    #[inline(always)]
                    |v| v.simd_lt(limit)
                ),
                want.len()
            );
            assert_eq!(to[len - want.len()..], want, "copy_if");
            to.copy_from_slice(from);
            let count = d.over_mut(to).retain(
                #[inline(always)]
                |v| v.simd_lt(limit),
            );
            assert_eq!(to[..count], want, "retain");
        }
        if size_of::<T>() > 1 && W::BYTES == 16 {
            to.copy_from_slice(from);
            s.over_mut(to).sort();
            let mut want = from.to_vec();
            want.sort_by(|a, b| a.partial_cmp(b).unwrap());
            assert_eq!(to, want, "sort");
        }
    }
    if at < len {
        to.copy_from_slice(from);
        to[at] = mark;
        assert_eq!(
            (
                d.over(to).max(),
                d.over(to).position_max(),
                d.over(to).position(
                    #[inline(always)]
                    |v| v.simd_eq(mark)
                ),
                d.over(to).count(
                    #[inline(always)]
                    |v| v.simd_eq(mark)
                )
            ),
            (Some(mark), Some(at), Some(at), 1)
        );
        d.over_mut(to).map(
            #[inline(always)]
            |v| v.simd_eq(mark).select(T::default(), v),
        );
        assert_eq!((d.over(to).min(), d.over(to).position_min()), (Some(T::default()), Some(at)));
        assert_eq!(d.over(to).min_max().map(|it| it.0), Some(T::default()));
    }
}

macro_rules! tests { ($($name:ident $t:ident $w:ident |$s:ident, $from:ident, $to:ident, $at:ident| $body:expr;)*) => {$(
    #[test]
    fn $name() {
        #[kernel(targets = bun_simd::target::Targets::ALL)]
        fn case<W: Width>($from: &[$t], $to: &mut [$t], $at: usize) { let ($s, _): (S, _) = (bun_simd::prelude::isa(), W::BYTES); $body }
        // rustc goes through all that a dead branch calls, so the types choose.
        struct If<const WANTED: bool>;
        impl If<false> { fn run<K>() {} }
        impl If<true> {
            fn run<K: Width>() {
                guards::at_width::<$t, $w>(case::to::<K>)
            }
        }
        If::<{ in_part($w::BYTES) }>::run::<$w>()
    }
)*}; }
macro_rules! widths { ($($m:ident $w:ident)*) => {$(mod $m {
    use super::*;
    tests! {
        shared_u8 u8 $w |s, from, to, at| bytes::<_, $w>(s, from, to, at);
        shared_u16 u16 $w |s, from, to, at| if at == 0 { shared::<_, _, $w, 2>(s, from, to) };
        slices_u8 u8 $w |s, from, to, at| slices::<_, _, $w>(s, from, to, at);
    }
})*}; }
widths!(b2 B2 b4 B4 b8 B8 b16 B16 b32 B32 b64 B64);
macro_rules! wide { ($($m:ident $w:ident)*) => {$(mod $m {
    use super::*;
    tests! {
        shared_f32 f32 $w |s, from, to, at| if at == 0 { shared::<_, _, $w, 4>(s, from, to) };
        shared_u64 u64 $w |s, from, to, at| if at == 0 { shared::<_, _, $w, 8>(s, from, to) };
        slices_i16 i16 $w |s, from, to, at| slices::<_, _, $w>(s, from, to, at);
        slices_f32 f32 $w |s, from, to, at| slices::<_, _, $w>(s, from, to, at);
        slices_u64 u64 $w |s, from, to, at| slices::<_, _, $w>(s, from, to, at);
    }
})*}; }
wide!(w16 B16 w32 B32 w64 B64);
