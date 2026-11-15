//! Each allocation has its exact size and is not initialized, for Miri.
#![feature(portable_simd)]
#![forbid(unsafe_code)]
use bun_simd_trusted::{Out, extend_vec, load_masked_to_last, spare_capacity};
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
    for (len, room) in (0..10).flat_map(|len| [(len, len), (len, 9), (9, len)]) {
        let (from, both) = (counting(len), len.min(room));
        for stop in 0..10 {
            let got = filled(room, |out| {
                out.fill_chunks(&from, |at, &chunk: &[_; 4]| {
                    assert_eq!(usize::from(chunk[0]), at);
                    (!chunk.contains(&stop)).then_some(chunk)
                })
            });
            let want = match usize::from(stop) {
                _ if both < 4 => 0,
                stop if stop < both => stop / 4 * 4,
                _ => both,
            };
            assert_eq!(got, from[..want]);
        }
    }
}

#[test]
fn fill_ends() {
    for len in 0..9 {
        let got = filled(len, |out| match out.fill_ends([1; 3], [2; 3]) {
            Ok(filled) => filled,
            Err(out) => {
                assert_eq!(out.len(), len);
                &mut []
            }
        });
        let want = if (3..=6).contains(&len) {
            &[1, 1, 1, 2, 2, 2][6 - len..]
        } else {
            &[]
        };
        assert_eq!(got, want);
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
fn last_lanes() {
    let lanes: [u8; 64] = core::array::from_fn(|i| i as u8);
    for len in [0, 1, 2, 3, 63, 64, 65, 256, 257] {
        let got = filled(len, |out| {
            out.fill_masked_from_last(Simd::from_array(lanes))
        });
        assert_eq!(got, lanes[64 - len.min(64)..]);
        let got = filled(len, |out| {
            out.fill_masked_from_last(Simd::from_array([5u64, 6]))
        });
        assert_eq!(got, [5, 6][2 - len.min(2)..]);
        let got: Simd<u16, 4> = load_masked_to_last(&counting(len + 1)[1..].to_vec());
        assert_eq!(got.as_array(), &[0, 0, 0, 0, 1, 2, 3, 4][len.min(4)..][..4]);
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
        out.append(|rest| rest.take(2).fill_ends([6], [7]).unwrap_or_default());
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
    extend_vec(&mut vec, 40, |out| {
        out.take(2).fill_ends([2], [3]).unwrap_or_default()
    });
    assert_eq!(vec, [1, 2, 3]);
}

#[test]
fn into_chunks() {
    let got = filled(5, |out| {
        let pairs = out.into_chunks().fill_ends([[1, 2]], [[3, 4]]);
        pairs.unwrap_or_default().as_flattened_mut()
    });
    assert_eq!(got, [1, 2, 3, 4]);
}

#[test]
fn spare_capacity_of_two() {
    let (mut a, mut b) = (Vec::with_capacity(3), Vec::with_capacity(2));
    a.push(1);
    let ((out_a, rest_a), (out_b, rest_b)) = (spare_capacity(&mut a), spare_capacity(&mut b));
    let filled_a = out_a.fill_ends([2], [3]).unwrap_or_default();
    rest_b.append(out_b.take(1).fill_ends([4], [4]).unwrap_or_default());
    rest_a.append(filled_a);
    spare_capacity(&mut b).1.append(&mut []);
    assert_eq!((a, b), (vec![1, 2, 3], vec![4]));
}

#[test]
#[should_panic]
fn spare_capacity_of_another() {
    let (mut a, mut b) = (Vec::with_capacity(1), Vec::with_capacity(1));
    let filled = spare_capacity(&mut a).0.fill_ends([1], [1]);
    spare_capacity(&mut b).1.append(filled.unwrap_or_default());
}

#[test]
#[should_panic]
fn spare_capacity_not_from_the_start() {
    let mut vec = Vec::with_capacity(2);
    let (out, rest) = spare_capacity(&mut vec);
    rest.append(&mut out.fill_ends([1], [2]).unwrap_or_default()[1..]);
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
#[should_panic]
fn not_from_the_start() {
    filled(2, |out| {
        &mut out.fill_ends([1], [2]).unwrap_or_default()[1..]
    });
}

#[test]
#[should_panic]
fn more_than_there_was_room_for() {
    Out::from(&mut [(); 2][..])
        .into_writer()
        .append(|_| vec![(); 3].leak());
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
        .append(|rest| &mut rest.fill_ends([1], [2]).unwrap_or_default()[1..]);
}
