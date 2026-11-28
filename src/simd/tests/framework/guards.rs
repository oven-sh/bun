//! Whatever takes a slice touches nothing else: all lengths and alignments, next to pages that can't be accessed.
//! The unsafe code only makes these pages. A failure is a segmentation fault.
//! The tests are in several files, which are compiled in parallel.
use crate::framework::*;
use bun_simd::{mem::Output, target::*, *};
use core::{cell::Cell, mem::MaybeUninit};

/// A multiple of the size of a page.
const ROOM: usize = 1 << 16;

type Offset = cfg_select! {
    all(target_pointer_width = "32", any(target_env = "gnu", target_os = "android")) => i32,
    _ => i64,
};

unsafe extern "C" {
    fn mmap(at: *mut u8, len: usize, protection: i32, flags: i32, fd: i32, offset: Offset) -> *mut u8;
    fn mprotect(at: *mut u8, len: usize, protection: i32) -> i32;
}

/// Zeros that are never freed, between two guards.
fn guarded<T: Lane>() -> &'static mut [T] {
    let private_anonymous = if cfg!(any(target_arch = "mips", target_arch = "mips64")) {
        0x802
    } else if cfg!(any(target_os = "linux", target_os = "android")) {
        0x22
    } else {
        0x1002
    };
    // SAFETY: a new mapping, aligned to a page, of which the middle part is readable and writable. Zero is a value of each lane.
    unsafe {
        let all = mmap(core::ptr::null_mut(), 3 * ROOM, 0, private_anonymous, -1, 0);
        assert!(all.addr() != usize::MAX && mprotect(all.add(ROOM), ROOM, 3) == 0);
        core::slice::from_raw_parts_mut(all.add(ROOM).cast(), ROOM / size_of::<T>())
    }
}

/// No value is zero or has the highest bit, and they are the same in all types.
fn value<T: Lane>(i: usize) -> T {
    T::from_usize(1 + i * 7 % 120)
}
const OUTSIDE: usize = 127;

/// What is read, what is written, and a number from 0 to the length.
#[inline(always)]
pub fn check<S: Isa, T: Test, W: Width>(s: S, from: &[T], to: &mut [T], at: usize) {
    let (d, len, zero) = (s.of::<T, W>(), from.len(), T::default());
    let (n, other) = (d.lanes(), T::from_usize(125));
    let (some, v) = (len.min(n), d.iota(T::from_usize(1)));
    let lanes = |v: Simd<T, W, S>| v.to_array().as_ref().to_vec();
    let padded = |with: T| (0..n).map(|i| *from.get(i).unwrap_or(&with)).collect::<Vec<_>>();
    let reset = |to: &mut [T]| to.fill(other);
    let written = |to: &[T], f: &dyn Fn(usize) -> Option<usize>| {
        to.iter().enumerate().all(|(i, &it)| it == f(i).map_or(other, |k| T::from_usize(1 + k)))
    };

    // The rest needs a bit for each lane.
    if const { W::BYTES / size_of::<T>() > 64 } && at != 0 {
        return;
    }
    if at == 0 {
        assert_eq!(lanes(d.load_or_default(from)), padded(zero), "load_n");
        assert_eq!(lanes(d.load_or(from, other)), padded(other), "load_n_or");
        assert_eq!(lanes(d.load_select_or_default(from, d.mask_splat(true))), padded(zero), "masked_load");
        reset(to);
        v.store_partial(to);
        assert!(written(to, &|i| (i < n).then_some(i)), "store_n");
        let mut room = vec![MaybeUninit::new(other); len];
        v.store_partial(&mut room);
        // SAFETY: all were initialized.
        assert!(room.iter().zip(&*to).all(|(it, to)| unsafe { it.assume_init() } == *to), "store_n to room");
        if const { W::BYTES / size_of::<T>() > 64 } {
            return;
        }
        reset(to);
        assert_eq!(v.compress_store_exact(to, d.mask_first_n(some)), some);
        assert_eq!(
            v.compress_store_exact(to, d.mask_first_n(some).to_bitmask() | (!0u64).unbounded_shl(d.lanes() as u32)),
            some
        );
        assert!(written(to, &|i| (i < n).then_some(i)), "compress_store_exact");
        if len < n {
            d.load_short(from).store_short(to);
            assert_eq!(from, to, "short");
        }
        if len >= n {
            assert_eq!(lanes(d.load(from)), from[..n], "load");
            assert_eq!(lanes(d.load_last(from)), from[len - n..], "load_last");
            assert_eq!(lanes(d.load_at(from, len - n)), from[len - n..], "load_at");
            assert_eq!(lanes(d.load_at(from, len - n)), from[len - n..], "read");
            reset(to);
            v.store(to);
            assert!(written(to, &|i| (i < n).then_some(i)), "store");
            reset(to);
            v.store_last(to);
            assert!(written(to, &|i| i.checked_sub(len - n)), "store_last");
            reset(to);
            v.store_select(to, !d.mask_first_n(1));
            assert!(written(to, &|i| (0 < i && i < n).then_some(i)), "store_select");
            for bits in [0, 1, !0, !1, 0x5555_5555_5555_5555, !0 << (n / 2), !(!0 << (n / 2))] {
                let count = v.compress_store(&mut to[len - n..], bits);
                let kept = (0..n).filter(|i| bits >> i & 1 == 1).map(|i| T::from_usize(1 + i));
                assert!(to[len - n..][..count].iter().copied().eq(kept), "compress_bits_store");
            }
        }
        if len * size_of::<T>() == 16 {
            assert!(lanes(d.load_block(from)).iter().enumerate().all(|(i, &it)| it == from[i % len]), "load_dup128");
        }
        if len == 2 * n {
            let [a, b] = d.load_interleaved::<2>(from);
            a.isa().store_interleaved([a, b], to);
            assert_eq!(from, to, "interleaved2");
        }
        if len == 3 * n {
            let [a, b, c] = d.load_interleaved::<3>(from);
            a.isa().store_interleaved([a, b, c], to);
            assert_eq!(from, to, "interleaved3");
        }
        if len == 4 * n {
            let [a, b, c, e] = d.load_interleaved::<4>(from);
            a.isa().store_interleaved([a, b, c, e], to);
            assert_eq!(from, to, "interleaved4");
        }
        // Indices around the end, and far from it.
        for first in [len.saturating_sub(n / 2), len, usize::MAX / 2 - 1, usize::MAX - n] {
            let indices = d.to_unsigned().iota(Lane::from_usize(first));
            let index = |i: usize| indices[i].to_u64() as usize;
            let want: Vec<T> = (0..n).map(|i| *from.get(index(i)).unwrap_or(&zero)).collect();
            assert_eq!(lanes(d.gather_or_default(from, indices)), want, "gather_index");
            v.scatter(to, indices);
        }
        let mut all = vec![];
        for (block, bits) in d.over(from).padded() {
            all.extend_from_slice(&lanes(block)[..bits.count_ones() as usize])
        }
        assert_eq!(all, from, "blocks");
        let (chunks, rest) = d.over(from).exact();
        assert_eq!([chunks.flat_map(lanes).collect(), rest.to_vec()].concat(), from, "chunks");
        let one = T::from_usize(1);
        let more =
            |to: &[T], by: usize| to.iter().enumerate().all(|(i, &it)| it == T::from_usize(1 + i * 7 % 120 + by));
        d.over(from).map_into(
            to,
            #[inline(always)]
            |v| v + one,
        );
        assert!(more(to, 1), "transform");
        assert_eq!(
            d.over(from).map_until(
                to,
                #[inline(always)]
                |v| v.simd_eq(zero),
                #[inline(always)]
                |v| v + one
            ),
            len
        );
        assert!(
            more(to, 1)
                && !d.over(from).any(
                    #[inline(always)]
                    |v| v.simd_eq(zero)
                ),
            "transform_until, any_if"
        );
        d.over_mut(to).map(
            #[inline(always)]
            |v| v + one,
        );
        assert!(more(to, 2), "transform_in_place");
        d.over(from).map_into(
            &mut Cell::from_mut(to).as_slice_of_cells(),
            #[inline(always)]
            |v| v + one,
        );
        assert!(more(to, 1), "transform to cells");
        let cells = Cell::from_mut(&mut *to).as_slice_of_cells();
        d.over(cells).map_into(
            &mut &*cells,
            #[inline(always)]
            |v| v + one,
        );
        assert_eq!(
            lanes(d.load_or_default(cells))[..some],
            cells[..some].iter().map(Cell::get).collect::<Vec<_>>(),
            "load_n from cells"
        );
        assert!(more(to, 2), "transform in cells");
        d.over(from).map_into(
            &mut Output::overwrite(to),
            #[inline(always)]
            |v| v + one,
        );
        assert!(more(to, 1), "transform to an output");
        reset(to);
        v.store_partial_at(&mut Cell::from_mut(&mut *to).as_slice_of_cells(), 0);
        assert!(written(to, &|i| (i < n).then_some(i)), "store_n to cells");
        assert_eq!(
            d.over(from).count(
                #[inline(always)]
                |v| v.simd_ne(other)
            ),
            len,
            "count_if"
        );
        assert_eq!(
            d.over(from).count(
                #[inline(always)]
                |v| v.simd_eq(zero)
            ),
            0,
            "count_if"
        );
    }

    let some = (len - at).min(n);
    for keep in [some, some / 2, if some == n { usize::MAX } else { 0 }] {
        reset(to);
        let mut out = Output::overwrite(to);
        out.push(&from[..at]);
        out.push(v.first_n(keep));
        assert!(
            out.len() == at + keep.min(n)
                && out.filled()[..at] == from[..at]
                && out.filled()[at..] == lanes(v)[..keep.min(n)],
            "push_partial"
        );
    }
    reset(to);
    let mut out = Output::overwrite(to);
    out.push(&from[..at]);
    v.store_partial_at(&mut out, 0);
    assert!(out.filled()[at..] == lanes(v)[..some], "store_partial_at");
    if n <= 64 {
        let (bound, mut kept) = (T::from_usize(1 + at * 11 % 120), from.to_vec());
        kept.retain(|&it| it >= bound);
        reset(to);
        let mut out = Output::overwrite(&mut to[len - kept.len()..]);
        assert_eq!(
            d.over(from).filter_into(
                &mut out,
                #[inline(always)]
                |v| v.simd_ge(bound)
            ),
            kept.len()
        );
        assert_eq!(out.filled(), kept, "filter_into");
    }

    // The only match is at each position, or nowhere. What lies around the slice matches too, and so does padding.
    to.copy_from_slice(from);
    let want = to.get_mut(at).map(|it| {
        *it = T::from_usize(OUTSIDE);
        at
    });
    let matches = |v: Simd<T, W, S>| v.simd_eq(T::from_usize(OUTSIDE)) | v.simd_eq(zero);
    assert_eq!(d.over(&*to).position(matches), want, "find_if");
    assert_eq!(d.over(&*to).rposition(matches), want, "find_last_if");
    assert_eq!(d.over(&*to).count(matches), want.is_some() as usize, "count_if");
}

pub fn at_width<T: Test, W: Width>(run: fn(Target, &[T], &mut [T], usize) -> Option<()>) {
    let n = W::BYTES / size_of::<T>();
    let all = std::env::var("EXHAUSTIVE").is_ok_and(|it| it.contains("guards"));
    let (from, to) = (guarded::<T>(), guarded::<T>());
    let room = from.len();
    to.fill(T::from_usize(OUTSIDE));
    // The searches have their last special case at 21 vectors.
    let lens = if all {
        (0..=23 * n).collect()
    } else {
        (0..=4 * n + 1).chain((5..23).map(|k| k * n + k % n)).collect::<Vec<_>>()
    };
    for len in lens {
        let gaps = if all { 64 / size_of::<T>() } else { 2 };
        for start in (0..gaps).flat_map(|gap| [gap, room - len - gap]) {
            from[start..][..len].iter_mut().enumerate().for_each(|(i, it)| *it = value(i));
            // In long slices, all positions only next to a guard.
            let step = if len <= 5 * n || all && (start == 0 || start + len == room) { 1 } else { n + 1 };
            for target in targets() {
                for at in (0..len).step_by(step).chain([len]) {
                    run(target, &from[start..][..len], &mut to[start..][..len], at).unwrap();
                }
                let around = to[start.saturating_sub(64)..start].iter().chain(to[start + len..].iter().take(64));
                assert!(
                    around.into_iter().all(|&it| it == T::from_usize(OUTSIDE)),
                    "{:?} {} {target:?} {len} {start}",
                    T::TY,
                    W::BYTES
                );
            }
            to[start..][..len].fill(T::from_usize(OUTSIDE));
        }
    }
}

macro_rules! tests { ($($name:ident $t:ident [$($test:ident $w:ident)*])*) => {$(mod $name { $(mod $test {
    use crate::guards::*;
    use bun_simd::*;
    #[bun_simd::kernel(targets = crate::framework::OF_CASES)]
    fn case((from, to, at): (&[$t], &mut [$t], usize)) { let s: S = bun_simd::prelude::isa(); check::<S, $t, $w>(s, from, to, at) }
    #[test]
    fn test() { at_width::<$t, $w>(|target, from, to, at| case::to(target, (from, to, at))) }
})* })*}; }
#[test]
fn guards_are_there() {
    if std::env::var_os("TOUCH_GUARD").is_some() {
        // SAFETY: none. The process is meant to die.
        unsafe { guarded::<u8>().as_ptr_range().end.read_volatile() };
        return;
    }
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .arg("guards_are_there")
        .env("TOUCH_GUARD", "1")
        .output();
    // It can't be started under an emulator.
    if let Ok(child) = child {
        assert!(!child.status.success())
    }
}
