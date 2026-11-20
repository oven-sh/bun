//! Each allocation has its exact size and is not initialized, for Miri.
#![feature(core_io, core_io_borrowed_buf, portable_simd)]
#![forbid(unsafe_code)]
use bun_simd_trusted::{Out, SharedOutU8, SharedU8, quarters};
use bun_simd_trusted::{copy_from_shared, copy_to_shared, from_array, load_or_default, windows};
use bun_simd_trusted::{extend_cursor, extend_vec, spare_capacity};
use core::io::BorrowedBuf;
use core::simd::{Simd, num::SimdUint};
use core::sync::atomic::{AtomicPtr, AtomicU8, Ordering::Relaxed};
use std::panic::{AssertUnwindSafe, catch_unwind, resume_unwind};

fn filled<T: Copy>(len: usize, fill: impl for<'a> FnOnce(Out<'a, T>) -> &'a mut [T]) -> Vec<T> {
    let mut vec = Vec::with_capacity(len);
    extend_vec(&mut vec, len, fill);
    vec
}

fn counting(len: usize) -> Vec<u16> {
    (0..len as u16).collect()
}

#[test]
fn fill_chunks() {
    for (len, room) in (0..32).flat_map(|len| [(len, len), (len, 31), (31, len)]) {
        let (from, both) = (counting(len), len.min(room));
        for stop in [0, 5, 11, 14, 22, 26, 29, 30, 31] {
            let got = filled(room, |out| {
                out.fill_chunks(&from, |at, &chunk: &[_; 3]| {
                    assert_eq!(usize::from(chunk[0]), at);
                    (!chunk.contains(&stop)).then_some(chunk)
                })
            });
            let want = match usize::from(stop) {
                _ if both < 3 => 0,
                stop if stop < both => stop / 3 * 3,
                _ => both,
            };
            assert_eq!(got, from[..want]);
        }
    }
}

#[test]
fn fill_quarters() {
    for len in 0..15 {
        let at = quarters(len.max(3), 3).map(|at| at as u16);
        let got = filled(len, |out| {
            out.fill_quarters(at.map(|at| [at, at + 1, at + 2]))
        });
        assert_eq!(got, counting(if (3..=12).contains(&len) { len } else { 0 }));
    }
}

fn pushed<T: Copy, const N: usize>(out: Out<'_, T>, values: [T; N]) -> &mut [T] {
    let mut out = out.into_writer();
    out.push(values);
    out.finish()
}

#[test]
fn truncate() {
    for len in 0..5 {
        let got = filled(6, |out| {
            let mut out = out.into_writer();
            out.push([1; 3]);
            out.truncate(len);
            out.push([2; 3]);
            out.finish()
        });
        assert_eq!(got, [1, 1, 1, 2, 2, 2][3 - len.min(3)..]);
    }
}

#[test]
fn fill_masked() {
    let lanes: [u8; 64] = core::array::from_fn(|i| i as u8);
    for len in [0, 1, 2, 3, 63, 64, 65, 256, 257] {
        let got = filled(len, |out| out.fill_masked(Simd::from_array(lanes)));
        assert_eq!(got, lanes[..len.min(64)]);
        let got = filled(len, |out| out.fill_masked(Simd::from_array([5u64, 6])));
        assert_eq!(got, [5, 6][..len.min(2)]);
        let got = filled(len, |out| out.fill_masked(Simd::from_array([0u16, 1, 2])));
        assert_eq!(got, counting(len.min(3)));
    }
}

#[test]
fn loads() {
    assert_eq!(from_array([1u16, 2, 3]), Simd::from_array([1, 2, 3]));
    for len in [0, 1, 2, 3, 63, 64, 65, 256, 257, 1 << 16] {
        let (bytes, words) = (vec![5u8; len], [5u16; 1 << 16][..len].to_vec());
        let want = Simd::<_, 64>::load_or_default(&bytes);
        assert_eq!(load_or_default(&bytes), want);
        assert_eq!(load_or_default(&words), want.cast());
        let (x32, x64): (Box<[u32]>, Box<[u64]>) =
            ((1..5).take(len).collect(), (1..5).take(len).collect());
        let want = Simd::<_, 3>::load_or_default(&[1u8, 2, 3][..len.min(3)]);
        assert_eq!(load_or_default(&x32), want.cast());
        assert_eq!(load_or_default(&x64), want.cast());
    }
}

#[test]
fn windows_stay_inside() {
    let starts = Simd::from_array([1, 0, u32::MAX, 1 << 31]);
    let all: Box<[u16]> = (0..5).collect();
    let want = [&[1, 2, 3], &[0, 1, 2], &[2, 3, 4], &[2, 3, 4]];
    assert_eq!(windows(&all, starts), Some(want));
    let [a, b, c, d] = want;
    assert_eq!(windows(&all, starts.reverse()), Some([d, c, b, a]));
    assert_eq!(windows(&all, starts), Some([&[0, 1, 2, 3, 4]; 4]));
    assert_eq!(windows::<_, 6>(&all, starts), None);
    assert_eq!(windows(&all[5..], starts), Some([&[]; 4]));
    assert_eq!(windows(&[(); usize::MAX], starts), Some([&[(); 2]; 4]));
    let (all, starts) = (vec![0u8; 1 << 20], [0xF_0E0D, 0x1_0203, 0xF_FFF8, 0x8_0000]);
    let got = windows::<_, 8>(&all, Simd::from_array(starts)).unwrap();
    let got = got.map(|it| (it.as_ptr().addr() - all.as_ptr().addr()) as u32);
    assert_eq!(got, starts);
}

#[test]
#[ignore = "needs 4 GiB of addresses"]
fn windows_in_more_than_a_lane_can_count() {
    let all = vec![0u8; (1 << 32) + 9];
    let got = windows::<_, 8>(&all, Simd::from_array([u32::MAX, 0, 1 << 31, 5])).unwrap();
    let got = got.map(|it| it.as_ptr().addr() - all.as_ptr().addr());
    assert_eq!(got, [(1 << 32) - 1, 0, 1 << 31, 5]);
}

#[test]
fn writer() {
    let got = filled(13, |out| {
        let mut out = out.into_writer();
        assert!(out.is_empty());
        out.push([0, 1]);
        out.push_first([2, 9, 9], 1);
        out.push_first([3, 4], usize::MAX);
        out.extend_from_slice(&[5]);
        out.append(|rest| pushed(rest.take(2), [6, 7]));
        out.append(|_| &mut []);
        out.extend_with([8, 0, 9], |it| (it != 0).then_some([it]));
        assert_eq!((out.len(), out.remaining()), (9, 4));
        out.extend_with(3.., |it| Some([3 * it, 3 * it + 1, 3 * it + 2]));
        assert_eq!(out.len(), 12);
        out.push([12]);
        out.finish()
    });
    assert_eq!(got, counting(13));
}

#[test]
fn extend_with_more_than_one_item() {
    for (items, room, want) in [(3, 7, 6), (4, 7, 6), (2, 7, 4), (3, 1, 0), (0, 7, 0)] {
        let got = filled(room, |out| {
            let mut out = out.into_writer();
            out.extend_with(0..items, |it| Some([2 * it, 2 * it + 1]));
            out.finish()
        });
        assert_eq!(got, counting(want));
    }
}

#[test]
fn a_panic_adds_nothing() {
    let mut vec = vec![1];
    let fill = AssertUnwindSafe(|| {
        extend_vec(&mut vec, 4, |out| {
            out.into_writer().push([2, 3]);
            resume_unwind(Box::new(()))
        })
    });
    assert!(catch_unwind(fill).is_err());
    assert_eq!(vec, [1]);

    let got = filled(4, |out| {
        let mut out = out.into_writer();
        let item = |it| {
            (it < 2)
                .then_some([it])
                .or_else(|| resume_unwind(Box::new(())))
        };
        assert!(catch_unwind(AssertUnwindSafe(|| out.extend_with(0.., item))).is_err());
        out.finish()
    });
    assert_eq!(got, [0; 0]);
}

#[test]
fn initialized_memory_keeps_the_rest() {
    let mut memory = [7; 4];
    let mut out = Out::from(&mut memory[..]).into_writer();
    out.push([1]);
    assert_eq!(out.finish(), [1]);
    assert_eq!(memory, [1, 7, 7, 7]);
}

#[test]
fn extend_vec_keeps_the_start() {
    let mut vec = vec![1];
    extend_vec(&mut vec, 40, |out| pushed(out.take(2), [2, 3]));
    extend_vec(&mut vec, 1, |out| out.fill_masked(Simd::from_array([4, 5])));
    assert_eq!(vec, [1, 2, 3, 4]);
}

#[test]
fn extend_cursor_by_what_is_filled() {
    let mut room = Box::new_uninit_slice(4);
    let mut buf = BorrowedBuf::from(&mut *room);
    extend_cursor(buf.unfilled(), |out| &mut pushed(out, [1, 2, 9])[..2]);
    extend_cursor(buf.unfilled(), |_| &mut []);
    let elsewhere = || extend_cursor(buf.unfilled(), |out| &mut pushed(out, [8, 9])[1..]);
    assert!(catch_unwind(AssertUnwindSafe(elsewhere)).is_err());
    extend_cursor(buf.unfilled(), |out| pushed(out, [3, 4]));
    extend_cursor(buf.unfilled(), |out| pushed(out, []));
    assert_eq!(buf.filled(), [1, 2, 3, 4]);
}

#[test]
fn into_chunks() {
    let got = filled(5, |out| {
        let pairs = pushed(out.into_chunks(), [[1, 2], [3, 4]]);
        pairs.as_flattened_mut()
    });
    assert_eq!(got, [1, 2, 3, 4]);
}

#[test]
fn spare_capacity_of_two() {
    let (mut a, mut b) = (Vec::with_capacity(3), Vec::with_capacity(2));
    a.push(1);
    let ((out_a, rest_a), (out_b, rest_b)) = (spare_capacity(&mut a), spare_capacity(&mut b));
    let filled_a = pushed(out_a, [2, 3]);
    rest_b.append(pushed(out_b.take(1), [4]));
    rest_a.append(filled_a);
    spare_capacity(&mut b).1.append(&mut []);
    assert_eq!((a, b), (vec![1, 2, 3], vec![4]));
}

#[test]
#[should_panic]
fn spare_capacity_of_another() {
    let (mut a, mut b) = (Vec::with_capacity(1), Vec::with_capacity(1));
    let filled = pushed(spare_capacity(&mut a).0, [1]);
    spare_capacity(&mut b).1.append(filled);
}

#[test]
#[should_panic]
fn spare_capacity_not_from_the_start() {
    let mut vec = Vec::with_capacity(2);
    let (out, rest) = spare_capacity(&mut vec);
    rest.append(&mut pushed(out, [1, 2])[1..]);
}

#[test]
#[should_panic]
fn push_without_room() {
    filled(1, |out| {
        out.into_writer().push_first([1, 2], 0);
        &mut []
    });
}

#[test]
#[should_panic]
fn extend_from_slice_without_room() {
    filled(1, |out| {
        out.into_writer().extend_from_slice(&[1, 2]);
        &mut []
    });
}

#[test]
#[should_panic = "chunk size must be non-zero"]
fn fill_chunks_of_nothing() {
    filled(1, |out| out.fill_chunks(&[1], |_, _: &[_; 0]| Some([0; 0])));
}

#[test]
#[should_panic = "chunk size must be non-zero"]
fn extend_with_nothing() {
    filled(1, |out| {
        out.into_writer().extend_with([1], |_| Some([0; 0]));
        &mut []
    });
}

#[test]
#[should_panic]
fn another_slice() {
    // Miri does not report what a static points to as a leak.
    static KEPT: AtomicPtr<u8> = AtomicPtr::new(core::ptr::null_mut());
    let other = vec![0; 2].leak();
    KEPT.store(other.as_mut_ptr(), Relaxed);
    filled(2, |_| other);
}

#[test]
fn the_slice_that_follows() {
    static KEPT: AtomicPtr<u8> = AtomicPtr::new(core::ptr::null_mut());
    let both = vec![0; 2].leak();
    KEPT.store(both.as_mut_ptr(), Relaxed);
    let (first, second) = both.split_at_mut(1);
    let mut out = Out::from(first).into_writer();
    out.push([1]);
    out.append(|_| second);
    assert_eq!(out.finish(), [1]);
}

#[test]
#[should_panic]
fn not_from_the_start() {
    filled(2, |out| &mut pushed(out, [1, 2])[1..]);
}

#[test]
fn more_than_there_was_room_for() {
    let mut out = Out::from(vec![(); 2].leak()).into_writer();
    out.append(|_| vec![(); 3].leak());
    assert_eq!(out.len(), 2);
}

#[test]
#[should_panic(expected = "assertion failed")]
fn more_than_the_spare_capacity() {
    let mut vec = vec![(); usize::MAX - 1];
    spare_capacity(&mut vec).1.append(vec![(); 2].leak());
}

#[test]
#[should_panic]
fn not_from_the_start_of_a_writer() {
    Out::from(&mut [0; 2][..])
        .into_writer()
        .append(|rest| &mut pushed(rest, [1, 2])[1..]);
}

#[test]
fn into_shared() {
    let mut bytes = [1u8, 2, 3];
    Out::from(&mut bytes[..]).into_shared()[1].set(7);
    assert_eq!(bytes, [1, 7, 3]);
    let mut words = [0u16; 2];
    Out::from(&mut words[..]).into_shared()[3].set(1);
    assert_eq!(words, [0, u16::from_ne_bytes([0, 1])]);
}

#[test]
fn copies() {
    for (len, room) in (0..5).flat_map(|len| (0..5).map(move |room| (len, room))) {
        let (from, both) = (Vec::from_iter(1..=len as u8), len.min(room));
        let shared = Vec::from_iter((0..room).map(|_| AtomicU8::new(9)));
        assert_eq!(
            copy_to_shared(&from, SharedOutU8::from_slice(&shared)),
            both
        );
        let copy = |room| {
            filled(room, |out| {
                copy_from_shared(SharedU8::from_slice(&shared), out)
            })
        };
        assert_eq!(copy(len), from[..both]);
        assert_eq!(
            copy(room + 1),
            [&from[..both], &[9; 5][both..room]].concat()
        );
    }
}

#[test]
fn copies_that_overlap() {
    for (from, to) in [(0, 2), (2, 0), (1, 1)] {
        let (bytes, mut want) = ([1, 2, 3, 4, 5, 6].map(AtomicU8::new), [1, 2, 3, 4, 5, 6]);
        let source = SharedU8::from_slice(&bytes[from..from + 4]);
        copy_to_shared(source, SharedOutU8::from_slice(&bytes[to..]));
        want.copy_within(from..from + 4, to);
        assert_eq!(bytes.map(AtomicU8::into_inner), want);
    }
}

#[test]
fn copies_that_race() {
    let rounds = if cfg!(miri) { 3 } else { 10_000 };
    for len in [1, 5, 40] {
        let shared = Vec::from_iter((0..len).map(|_| AtomicU8::new(1)));
        std::thread::scope(|scope| {
            for byte in [1, 2] {
                let shared = &shared;
                scope.spawn(move || {
                    for _ in 0..rounds {
                        copy_to_shared(&vec![byte; len], SharedOutU8::from_slice(shared));
                        let from = SharedU8::from_slice(shared);
                        let got = filled(len, |out| copy_from_shared(from, out));
                        assert!(got.iter().all(|byte| matches!(byte, 1 | 2)));
                    }
                });
            }
        });
    }
}
