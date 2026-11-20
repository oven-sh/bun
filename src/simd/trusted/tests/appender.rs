//! Each allocation has its exact size, and its spare capacity is not initialized, for Miri.
#![forbid(unsafe_code)]
use bun_simd_trusted::Appender;
use core::mem::ManuallyDrop;
use std::panic::{AssertUnwindSafe, catch_unwind};

fn start(len: usize, room: usize) -> Vec<u8> {
    let mut vec = Vec::with_capacity(len + room);
    vec.extend(1..=len as u8);
    vec
}

#[test]
fn push() {
    let mut vec = start(5, 14);
    let mut to = Appender::new(&mut vec, 2, 13);
    assert_eq!((to.position(), to.room()), (2, 13));
    let first = to.as_ptr();
    for count in [0, 1, 4, usize::MAX, 2] {
        to.push([6, 7, 8, 9], count);
    }
    assert_eq!((to.position(), to.room()), (13, 2));
    assert_eq!(to.as_ptr(), first.wrapping_add(11));
    to.push([0; 3], 1);
    to.push([0; 0], 1);
    drop(to);
    assert_eq!(vec[5..], [6, 6, 7, 8, 9, 6, 7, 8, 9, 6, 7]);
}

#[test]
fn no_more_than_there_is() {
    let mut vec = start(3, 4);
    let to = Appender::new(&mut vec, usize::MAX, usize::MAX);
    assert_eq!((to.position(), to.room()), (3, 4));
    let _ = ManuallyDrop::new(to);
    assert_eq!(vec, [1, 2, 3]);
    let mut nothing = Vec::new();
    let mut to = Appender::new(&mut nothing, 9, 9);
    to.push([1], 1);
    assert!(!to.push_every::<1, 1>(1, [1], 1));
    assert_eq!(to.peek::<1>(1), None);
    assert!(!to.push_again::<1, 0>(1, 0, |_| {}));
}

#[test]
fn push_every() {
    for (step, count) in (0..6).flat_map(|it| (0..11).chain([usize::MAX]).map(move |n| (it, n))) {
        let mut vec = start(0, 12);
        for room in [11, 12] {
            let mut to = Appender::new(&mut vec, 0, room);
            assert_eq!(to.push_every::<4, 3>(step, [1, 2, 3, 4], count), room == 12);
        }
        let want = (1..=step.clamp(1, 4) as u8).cycle().take(count.min(9));
        assert_eq!(vec, Vec::from_iter(want), "{step} {count}");
    }
}

#[test]
fn peek() {
    let mut vec = start(6, 4);
    let to = Appender::new(&mut vec, 5, 4);
    assert_eq!(to.peek(5), Some([2, 3, 4, 5]));
    assert_eq!(to.peek(4), Some([3, 4, 5, 6]));
    assert_eq!(to.peek(1), Some([6, 0, 0, 0]));
    for distance in [0, 6, 7, usize::MAX] {
        assert_eq!(to.peek::<4>(distance), None);
    }
    assert_eq!(to.peek::<5>(5), None);
    drop(to);
    assert_eq!(vec, start(6, 0));
}

#[test]
fn push_again() {
    let few = || (0..15).chain([usize::MAX]);
    for (distance, count) in few().flat_map(|it| few().map(move |n| (it, n))) {
        let (mut vec, mut want, mut chunks) = (start(10, 12), start(10, 12), vec![]);
        assert!(!Appender::new(&mut vec, 9, 11).push_again::<4, 3>(distance, count, |_| {}));
        let mut to = Appender::new(&mut vec, 9, 12);
        let is_done = to.push_again::<4, 3>(distance, count, |i| chunks.push(i));
        drop(to);
        assert_eq!(is_done, (count.clamp(1, 4)..=9).contains(&distance));
        let added = if is_done { count.min(12) } else { 0 };
        for _ in 0..added {
            want.push(want[want.len() - distance]);
        }
        assert_eq!(vec, want, "{distance} {count}");
        assert_eq!(chunks, Vec::from_iter(1..added.div_ceil(4)));
    }
}

#[test]
fn a_panic_adds_nothing() {
    let mut vec = start(4, 8);
    let calls: [fn(&mut Appender<'_>); _] = [
        |to| _ = to.push_again::<4, 2>(4, 8, |_| panic!()),
        |to| _ = to.push_again::<4, 0>(4, 8, |_| {}),
        |to| _ = to.push_again::<0, 2>(4, 8, |_| {}),
        |to| _ = to.push_every::<4, 0>(4, [0; 4], 8),
        |to| _ = to.push_every::<0, 2>(4, [], 8),
    ];
    for call in calls {
        let result = catch_unwind(AssertUnwindSafe(|| {
            call(&mut Appender::new(&mut vec, 4, 8))
        }));
        assert!(result.is_err());
        assert_eq!(vec, start(4, 0));
    }
}
