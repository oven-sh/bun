//! Each allocation has its exact size and is not initialized, for Miri.
#![feature(portable_simd)]
#![forbid(unsafe_code)]
use bun_simd_trusted::{Out, extend_vec, quarters, spare_capacity};
use core::simd::Simd;
use core::sync::atomic::{AtomicPtr, Ordering::Relaxed};
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
    }
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
        out.finish()
    });
    assert_eq!(got, counting(12));
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
    assert_eq!(vec, [1, 2, 3]);
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
#[should_panic]
fn more_than_the_spare_capacity() {
    let mut vec = vec![(); usize::MAX - 1];
    spare_capacity(&mut vec).1.append(&mut [(); 2]);
}

#[test]
#[should_panic]
fn not_from_the_start_of_a_writer() {
    Out::from(&mut [0; 2][..])
        .into_writer()
        .append(|rest| &mut pushed(rest, [1, 2])[1..]);
}
