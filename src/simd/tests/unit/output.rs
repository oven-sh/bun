//! The checks before unsafe code that no caller in this crate fails.

use crate::Output;
use core::mem::MaybeUninit;

fn copy_back(room: usize, distance: usize, n: usize) -> Vec<u8> {
    // What is after the output takes the writes if a check is missing.
    let mut all = [MaybeUninit::new(0u64); 128];
    let mut out = Output::new(&mut all[32..][..8 + room]);
    out.extend_from_slice(&b"abcdefgh".map(u64::from));
    out.copy_back::<4>(distance, n, room % 4 == 1);
    out.filled()[8..].iter().map(|&it| it as u8).collect()
}

#[test]
fn far_from_the_end() {
    let mut all = [MaybeUninit::new(()); usize::MAX - 1];
    assert!(Output::new(&mut all).far(usize::MAX).is_none());
    assert!(Output::new(&mut all[..2]).far(3).is_none());
}
#[test]
fn copies() {
    assert_eq!(
        [copy_back(13, 4, 9), copy_back(4, 1, 0), copy_back(5, 1, 1), copy_back(7, 8, 3)],
        [&b"efghefghe"[..], b"", b"h", b"abc"]
    );
}
#[test]
#[should_panic = "assertion failed"]
fn steps_of_another_size() {
    let mut all = [MaybeUninit::new(0u8); 128];
    let mut out = Output::new(&mut all[32..][..16]);
    out.extend_from_slice(b"abcdefgh");
    out.copy_back::<4>(4, 4, false);
}
#[test]
#[should_panic = "assertion failed"]
fn from_the_end() {
    copy_back(20, 0, 0);
}
#[test]
#[should_panic = "assertion failed"]
fn from_before_the_start() {
    copy_back(20, 9, 1);
}
#[test]
#[should_panic = "assertion failed"]
fn from_what_is_not_written() {
    copy_back(20, 3, 4);
}
#[test]
#[should_panic = "assertion failed"]
fn without_room_for_the_last_step() {
    copy_back(12, 4, 9);
}

#[test]
#[should_panic = "assertion failed"]
fn a_gap_before_a_masked_store() {
    Output::new(&mut [MaybeUninit::uninit(); 8]).put_masked::<crate::Portable>(
        1,
        8,
        crate::simd::u8x16::repeated(1),
        0,
        3,
    )
}

#[cfg(all(target_arch = "x86_64", target_feature = "sse2", panic = "unwind", not(miri)))]
mod stream {
    use crate::Aligned;
    use std::panic::{AssertUnwindSafe, catch_unwind};

    use crate::__Targets;
    #[crate::kernel]
    fn store(to: &mut [u8], n: usize) {
        let s = S::default();
        if !S::PORTABLE {
            crate::stream::streaming(
                #[inline(always)]
                |scope| s.stream_16(crate::stream::Part::of(scope.lend(&mut to[..n])), crate::simd::u8x16::repeated(1)),
            )
        }
    }

    #[test]
    fn only_whole_and_aligned() {
        for target in store::targets().filter(|it| *it != crate::Target::Portable) {
            for (at, n) in [(16, 16), (16, 8), (16, 32), (8, 16), (17, 16)] {
                let mut all = Aligned([0; 64]);
                let failed = catch_unwind(AssertUnwindSafe(|| store::to(target, &mut all.0[at..], n)))
                    .unwrap_or_else(|why| {
                        assert!(why.downcast_ref::<&str>().is_some_and(|it| it.starts_with("assertion failed")));
                        None
                    })
                    .is_none();
                assert_eq!(
                    (failed, all.0.iter().sum::<u8>()),
                    if (at, n) == (16, 16) { (false, 16) } else { (true, 0) }
                );
            }
        }
    }
}
