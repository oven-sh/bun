//! `Output::resume` and `extend_from_back`, in allocations of the exact size. For Miri, too.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::generic::*;
use std::panic::{AssertUnwindSafe, catch_unwind};

#[kernel(targets = Targets::ALL)]
fn extend<T: Lane>(out: &mut Output<'_, T>, distance: usize, n: usize) {
    out.extend_from_back(distance, n).unwrap()
}

fn start<T: Lane>(len: usize, room: usize) -> Vec<T> {
    let mut all = Vec::with_capacity(len + room);
    all.extend((0..len).map(|i| T::from_usize(1 + i * i % 113)));
    all
}

fn all_distances<T: Lane>() {
    let lanes = 32 / size_of::<T>();
    let lengths = || {
        (0..if cfg!(miri) { 2 } else { 2 * lanes + 2 }).chain([
            lanes - 1,
            lanes + 1,
            3 * lanes,
            3 * lanes + 1,
            7 * lanes,
            9 * lanes + 5,
            12 * lanes - 1,
            12 * lanes,
            13 * lanes + 1,
            40 * lanes + 3,
        ])
    };
    for target in extend::targets().take(if cfg!(miri) { 1 } else { 99 }) {
        for (history, distance) in [1, 3, lanes / 2 - 1, lanes / 2, 2 * lanes + 3]
            .into_iter()
            .flat_map(|it| (1..=it).step_by(if cfg!(miri) { lanes / 2 + 1 } else { 1 }).map(move |d| (it, d)))
            .chain([3 * lanes + 1, 5 * lanes, 8 * lanes - 1, 8 * lanes, 8 * lanes + 1, 17 * lanes].map(|d| (d, d)))
        {
            for (n, more) in lengths().flat_map(|n| [0, 1, lanes - 1, lanes, 3 * lanes].map(|more| (n, more))) {
                if cfg!(miri)
                    && (n > 10 * lanes || distance > 3 * lanes)
                    && (n, distance) != (13 * lanes + 1, lanes + 3)
                {
                    continue;
                }
                let mut want = start::<T>(history + 2, n);
                for _ in 0..n {
                    want.push(want[want.len() - distance])
                }
                let mut vec = start::<T>(history + 2, n + more);
                extend::to(target, &mut Output::resume(&mut vec, history, n + more), distance, n).unwrap();
                assert_eq!(vec, want, "{target:?} {history} {distance} {n} {more}");
                // What was initialized stays so.
                let mut plain = vec![T::from_usize(120); history + n + more];
                let mut out = Output::overwrite(&mut plain);
                out.push(&want[2..][..history]);
                extend::to(target, &mut out, distance, n).unwrap();
                assert!(plain[..history + n] == want[2..] && plain.iter().all(|&it| it != T::default()));
            }
        }
    }
}

#[test]
fn bytes() {
    all_distances::<u8>()
}
#[test]
fn words() {
    all_distances::<i16>()
}
#[test]
fn pixels() {
    all_distances::<u32>()
}
#[test]
fn doubles() {
    all_distances::<f64>()
}

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs unwinding")]
fn out_of_range() {
    for (distance, n) in [
        (0, 0),
        (0, 1),
        (41, 0),
        (41, 1),
        (usize::MAX, 1),
        (1, 101),
        (40, 101),
        (1, usize::MAX),
        (40, usize::MAX),
        (40, usize::MAX - 31),
    ] {
        let mut vec = start::<u8>(50, 100);
        assert!(
            catch_unwind(AssertUnwindSafe(|| Output::resume(&mut vec, 40, 100)
                .extend_from_back::<Baseline>(distance, n)
                .unwrap()))
            .is_err(),
            "{distance} {n}"
        );
        assert_eq!(vec, start::<u8>(50, 0));
    }
}

#[test]
fn resumes() {
    for (history, seen) in [(0, 0), (2, 2), (5, 5), (6, 5), (usize::MAX, 5)] {
        let mut vec = vec![1, 2, 3, 4, 5];
        let mut out = Output::resume(&mut vec, history, 3);
        assert_eq!((out.filled(), out.room(), out.capacity()), (&[1, 2, 3, 4, 5][5 - seen..], 3, seen + 3));
        assert!(
            out.room_for(0).is_some()
                && out.room_for(3).is_some()
                && !out.room_for(4).is_some()
                && !out.room_for(usize::MAX).is_some()
        );
        out.push_one(6);
        drop(out);
        assert_eq!(vec, [1, 2, 3, 4, 5, 6]);
    }
    let mut vec = vec![1, 2, 3, 4, 5];
    Output::resume(&mut vec, 3, 0).truncate(1);
    assert_eq!(vec, [1, 2, 3]);
    // The length stays if it doesn't come back.
    core::mem::forget(Output::resume(&mut vec, 1, 0));
    *Output::resume(&mut vec, 1, 0) = Output::new(&mut []);
    assert_eq!(vec, [1, 2, 3]);
    let mut out = Output::resume(&mut vec, 3, 200);
    out.truncate(1);
    out.extend_from_back::<Baseline>(1, 1).unwrap();
    core::mem::forget(out);
    assert!(vec.len() == 3 && vec[..2] == [1, 1] && [1, 2, 3].contains(&vec[2]));
    // What comes back is a part of what was taken out, which goes on.
    let mut out = Output::resume(&mut vec, 3, 60);
    let mut real = core::mem::replace(&mut *out, Output::new(&mut []));
    real.clear();
    let mut out = { out };
    *out = core::mem::replace(&mut *real.limit(63), Output::new(&mut []));
    out.push(&[4; 9]);
    drop(out);
    real.push(&[4; 2]);
    real.extend_from_back::<Baseline>(2, 1).unwrap();
    assert_eq!(vec, [4; 9]);
    let mut units = vec![(); usize::MAX - 1];
    Output::resume(&mut units, usize::MAX, 1).push_one(());
    assert_eq!(units.len(), usize::MAX);
}

/// For Miri and Valgrind.
#[test]
fn holes() {
    for (distance, n) in [(3, 2), (3, 3), (5, 40), (33, 70)] {
        for more in [0, 31, 32, 50] {
            let (mut memory, mut room) = ([2u8; 200], [core::mem::MaybeUninit::uninit(); 200]);
            let all = 7..47 + n + more;
            for mut out in [Output::overwrite(&mut memory[all.clone()]), Output::new(&mut room[all])] {
                out.push(&[2; 40]);
                out.extend_from_back::<Baseline>(distance, n).unwrap();
                out.truncate(35);
                out.extend_from_back::<Baseline>(3, 2).unwrap();
                assert_eq!(out.filled(), [2; 37]);
            }
            assert_eq!(memory, [2; 200]);
        }
    }
    let mut vec = vec![1u8; 10];
    let mut out = Output::resume(&mut vec, 4, 200);
    out.streams::<2, _>(40, |[a, b]| {
        b.push(&[1; 3]);
        b.extend_from_back::<Baseline>(3, 37).unwrap();
        a.push(&[1; 6]);
        a.extend_from_back::<Baseline>(6, 2).unwrap();
        a.extend_from_back::<Baseline>(8, 32).unwrap();
    });
    drop(out);
    assert_eq!(vec, [1; 90]);
}

/// Each step on the room and on a `Vec`. Whatever was reserved, the results are those of the output.
#[kernel(targets = Targets::ALL)]
fn reserved<'a, T: Lane>(out: &mut Output<'a, T>, other: &mut Output<'a, T>, next: &mut dyn FnMut(usize) -> usize) {
    let (mut want, mut other_want) = (out.filled().to_vec(), Vec::new());
    for _ in 0..next(6) {
        let (free, x) = (out.room(), T::from_usize(1 + next(99)));
        assert!(out.room_for(free + 1).is_none() && out.room_for(usize::MAX).is_none());
        let mut room = out.room_for([free, next(free + 1), 0][next(3)]).unwrap();
        for _ in 0..next(9) {
            let (free, v, lanes) = (room.room(), SimdN::<T, S>::splat(x), SimdN::<T, S>::LANES);
            let n = [next(free + 2), next(40), free, free + 1, usize::MAX - next(40)][next(5)];
            let (added, count) = match next(9) {
                0 => (room.try_push(v), lanes),
                1 => (room.try_push((v.first_n(n), &[x; 3])), n.min(lanes) + 3),
                2 => (room.try_push(&vec![x; n.min(999)][..]), n.min(999)),
                3 if cfg!(panic = "abort") && n.min(lanes) > free => continue,
                3 => (catch_unwind(AssertUnwindSafe(|| room.push(v.first_n(n)))).ok(), n.min(lanes)),
                4 => {
                    core::mem::swap(&mut *room, other);
                    core::mem::swap(&mut want, &mut other_want);
                    continue;
                }
                5 => (room.room_for(n).map(|mut it| it.push(&vec![x; n][..])), n),
                6 => {
                    room.truncate(n);
                    want.truncate(n);
                    continue;
                }
                _ => {
                    let distance = [next(want.len() + 2), next(34), want.len(), want.len() + 1, usize::MAX][next(5)];
                    let is_added = room.extend_from_back(distance, n).is_some();
                    assert_eq!(is_added, (1..=want.len()).contains(&distance) && n <= free);
                    for _ in (0..n).take_while(|_| is_added) {
                        want.push(want[want.len() - distance]);
                    }
                    (Some(()), 0)
                }
            };
            assert_eq!(added.is_some(), count <= free);
            want.extend(vec![x; added.map_or(0, |()| count)]);
            assert!(*room.filled() == want);
        }
    }
    assert!(*out.filled() == want && *other.filled() == other_want);
}

fn rooms<T: Lane>() {
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    let mut next = |below: usize| {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as usize % below.max(1)
    };
    for target in reserved::targets().take(if cfg!(miri) { 1 } else { 99 }) {
        for _ in 0..if cfg!(miri) { 60 } else { 5000 } {
            let (len, history, room) = (next(50), next(50), next(300));
            let (mut vec, mut plain) = (start::<T>(len, room), vec![T::from_usize(120); next(99) + 64]);
            let end = plain.len() - 64;
            let mut other = Output::overwrite(&mut plain[..end]);
            reserved::to(target, &mut Output::resume(&mut vec, history, room), &mut other, &mut next).unwrap();
            assert!(vec.iter().chain(&plain).all(|&it| it != T::from_usize(125)));
            assert!(plain[end..] == [T::from_usize(120); 64]);
        }
    }
}

#[test]
fn what_is_reserved_changes_no_result() {
    rooms::<u8>();
    rooms::<u16>();
    rooms::<f32>();
    rooms::<u64>();
}

#[test]
fn any_number_of_nothing_is_reserved() {
    for n in [0, 1, usize::MAX / 2, usize::MAX / 2 + 1, usize::MAX] {
        let mut all = Vec::new();
        let mut out = Output::append(&mut all, usize::MAX);
        let mut room = out.room_for(n).unwrap();
        assert!(room.try_push(&[(); 3]).is_some() && room.try_push(&[(); usize::MAX - 2]).is_none());
        assert!(room.try_push(&[(); usize::MAX - 3]).is_some() && room.try_push(&[()]).is_none());
    }
}
