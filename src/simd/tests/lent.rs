//! What is lent or split.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use core::mem::MaybeUninit;
use std::panic::{AssertUnwindSafe, catch_unwind};

fn panics<R>(f: impl FnOnce() -> R) -> bool {
    catch_unwind(AssertUnwindSafe(f)).is_err()
}

#[test]
fn all_that_is_lent() {
    #[bun_simd::simd]
    fn on() {
        let (mut slice, mut array, mut vec, mut boxed) =
            ([0u16; 40], [0u16; 40], vec![0u16; 40], Box::<[u16]>::from([0; 40]));
        let (mut room, mut image) = ([MaybeUninit::<u16>::uninit(); 40], [0u16; 40]);
        let sum = streaming(|s: Streaming<'_, '_>| {
            fn lent<'a, L: Lendable<'a>>(s: Streaming<'a, '_>, to: L) -> L::Lent {
                s.lend(to)
            }
            let all: [&[Streamed<u16>]; 5] =
                [lent(s, &mut slice[..]), s.lend(&mut array), s.lend(&mut vec), s.lend(&mut boxed), s.lend(&mut room)];
            for mut to in all {
                let copy = to;
                (0..8).for_each(|at| u16x8::splat(0).store_at(&mut to, at));
                u16x8::iota(1).store_at(&mut to, 0);
                u16x8::iota(2).store_at(&mut &copy.as_chunks::<8>().0[1], 0);
                u16x8::iota(3).store_partial_at(&mut to, 35);
                to.part(..).write(20, [7, 8]);
                over(&[9u16; 9]).map_into(&mut &to[24..33], |v| {
                    u16x2::splat(4).store_at(&mut { copy }, 33);
                    v
                });
            }
            let (left, right) = RowsMut::new(&mut image, 10, 10, 4).split_at_column(4);
            let (left, right) = (s.lend(left), s.lend(right));
            (0..4).for_each(|y| u16x4::splat(1).store_at(&mut left.row(y), 0));
            (0..4).for_each(|y| u16x8::splat(2).store_partial_at(&mut right.row(y), 1));
            all.len()
        });
        assert_eq!(sum, 5);
        assert!(slice == array && slice == *vec && slice == *boxed);
        assert_eq!(slice[..24], [1, 2, 3, 4, 5, 6, 7, 8, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 0, 7, 8, 0, 0]);
        assert_eq!(slice[24..], [9, 9, 9, 9, 9, 9, 9, 9, 9, 4, 4, 3, 4, 5, 6, 7]);
        assert_eq!(image[30..], [1, 1, 1, 1, 0, 2, 2, 2, 2, 2]);
    }
    on::<bun_simd::target::Baseline>()
}

#[test]
#[cfg_attr(not(panic = "unwind"), ignore = "needs unwinding")]
fn too_short() {
    #[bun_simd::simd]
    fn on() {
        let mut to = [0u32; 7];
        assert!(panics(|| streaming(|s| u32x8::splat(1).store_at(&mut s.lend(&mut to), 0))));
        assert!(panics(|| streaming(|s| u32x4::splat(1).store_at(&mut s.lend(&mut to), usize::MAX))));
        assert!(panics(|| streaming(|s| u32x4::splat(1).store_partial_at(&mut s.lend(&mut to), 8))));
        assert!(panics(|| streaming(|s| s.lend(&mut to).part(..).write(6, [1u32, 2]))));
        assert!(panics(|| streaming(|s| over(&[1u32; 8]).map_into(&mut s.lend(&mut to), |v| v))));
        assert_eq!(to, [0; 7]);
    }
    on::<bun_simd::target::Baseline>()
}

/// Each value is in one part.
#[test]
fn parts_of_rows() {
    fn count(rows: RowsMut<'_, u8>, steps: &[(bool, usize)]) {
        let Some((&(column, at), steps)) = steps.split_first() else {
            let mut rows = rows;
            return (0..rows.height()).for_each(|y| rows.row(y).iter_mut().for_each(|it| *it += 1));
        };
        let (a, b) = if column {
            let at = at.min(rows.width());
            rows.split_at_column(at)
        } else {
            let at = at.min(rows.height());
            rows.split_at_row(at)
        };
        if cfg!(target_family = "wasm") {
            return [a, b].into_iter().for_each(|it| count(it, steps));
        }
        std::thread::scope(|threads| {
            threads.spawn(|| count(a, steps));
            count(b, steps);
        });
    }
    for (stride, width, height) in
        [(5, 5, 4), (7, 3, 3), (0, 6, 1), (3, 0, 2), (0, 0, 5), (4, 4, 0), (usize::MAX, 2, 1)]
    {
        for steps in
            [[(true, 2), (false, 1)], [(false, 0), (true, 9)], [(false, 9), (false, 2)], [(true, 0), (true, 1)]]
        {
            let mut all = [0; 20];
            count(RowsMut::new(&mut all, stride, width, height), &steps);
            let within = |i: usize| (0..height).any(|y| (y * stride..y * stride + width).contains(&i));
            assert!((0..20).all(|i| all[i] == within(i) as u8));
        }
    }
}

#[test]
fn several_rows() {
    let mut all: Vec<String> = (0..20).map(|it| it.to_string()).collect();
    let (mut left, right) = RowsMut::new(&mut all, 5, 5, 4).split_at_column(2);
    let read = right.rows();
    let [a, b, c] = left.rows_mut(1);
    core::mem::swap(&mut a[0], &mut c[1]);
    b[1].push_str(&read.row(3)[0]);
    let [] = left.rows_mut(4);
    assert_eq!(
        format!("{left:?} {:?}", read.at(1, 0, 1, 2)),
        r#"[["0", "1"], ["16", "6"], ["10", "1117"], ["15", "5"]] [["3"], ["8"]]"#
    );
    let mut nothing = [(); usize::MAX];
    let (a, mut b) = RowsMut::new(&mut nothing, usize::MAX / 2, 7, 2).split_at_row(1);
    assert_eq!((a.height(), b.row(0).len()), (1, 7));
}

#[test]
#[cfg_attr(not(panic = "unwind"), ignore = "needs unwinding")]
fn rows_that_overlap() {
    let mut all = [0u8; 20];
    assert!(panics(|| RowsMut::new(&mut all, 3, 4, 2).split_at_row(1)));
    assert!(panics(|| RowsMut::new(&mut all, 3, 4, 2).split_at_column(1)));
    assert!(panics(|| RowsMut::new(&mut all, 3, 4, 2).rows_mut::<2>(0).len()));
    assert_eq!(RowsMut::new(&mut all, 3, 4, 2).rows_mut::<1>(1)[0].len(), 4);
    assert_eq!(RowsMut::new(&mut all, 3, 4, 2).at(1, 0, 3, 2).split_at_row(1).1.height(), 1);
    assert!(panics(|| RowsMut::new(&mut all, 4, 4, 2).split_at_row(3)));
    assert!(panics(|| RowsMut::new(&mut all, 4, 4, 2).split_at_column(5)));
    assert!(panics(|| RowsMut::new(&mut all, 4, 4, 2).rows_mut::<2>(1).len()));
    assert!(panics(|| RowsMut::new(&mut all, 4, 4, 2).rows_mut::<1>(usize::MAX).len()));
    assert!(panics(|| RowsMut::new(&mut all, usize::MAX / 2 + 1, 1, 3)));
    assert!(panics(|| RowsMut::new(&mut all, 1, usize::MAX, 2)));
    assert!(panics(|| RowsMut::new(&mut all, usize::MAX, 2, 2)));
}
