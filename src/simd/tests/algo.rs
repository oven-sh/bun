//! The loops and the handling of short slices, against plain code.
#![cfg(not(miri))]
#![forbid(unsafe_code)]
mod common;

use bun_simd::{Int, Source};
use common::on_each_target;
use std::fmt::Debug;
use std::hint::black_box;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering::Relaxed};

const PAGE: usize = 4096;

/// Memory in which a page ends after 128 bytes.
struct Room<T>(Vec<T>);

impl<T: Copy> Room<T> {
    fn new(fill: T) -> Self {
        Self(vec![fill; 3 * PAGE])
    }

    fn all(&mut self) -> &mut [T] {
        let end_of_page = 2 * PAGE - self.0.as_ptr().addr() % PAGE;
        &mut self.0[(end_of_page - 128) / size_of::<T>()..][..1024]
    }
}

/// Every length below `13 * n`, far from the end of the page and next to it.
fn ranges<T>(n: usize, alignments: usize) -> impl Iterator<Item = Range<usize>> {
    let near = 128 / size_of::<T>() - n - 1;
    let aligned = move |from| (from..from + n).step_by(n.div_ceil(alignments));
    let starts = aligned(1).chain(aligned(near));
    starts.flat_map(move |start| (start..start + 13 * n).map(move |end| start..end))
}

fn plain<T>(slice: &mut [T]) -> &[T] {
    slice
}

fn shared(slice: &mut [u8]) -> &[AtomicU8] {
    AtomicU8::from_mut_slice(slice)
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{U8, U16, Vector};

    /// The lanes around the slice match too, so a look outside of it changes the result.
    fn searches<T, S, const N: usize>(alignments: usize, view: fn(&mut [T]) -> &[S])
    where
        T: Int<N> + From<u8>,
        S: Source<Lane = T>,
    {
        let (mut room, zero, one) = (Room::new(T::from(1)), T::from(0), T::from(1));
        let room = room.all();
        let test = |v: Vector<T, N>| v.simd_eq(one);
        for range in ranges::<T>(N, alignments) {
            let len = range.len();
            room[range.clone()].fill(zero);
            for first in (0..len).map(Some).chain([None]) {
                let last = first.map(|first| first + (len - first) / 2);
                let mut set = |lane| {
                    for at in first.into_iter().chain(last) {
                        room[range.start + at] = lane;
                    }
                };
                set(one);
                let longer = black_box(view(&mut room[range.start..]));
                let slice = &longer[..len];
                assert_eq!(Vector::position(slice, test), first);
                assert_eq!(Vector::rposition(slice, test), last);
                assert_eq!(Vector::position_within(longer, len, test), first);
                assert_eq!(Vector::position_within(slice, len + 3, test), first);
                let in_half = first.filter(|&at| at < len / 2);
                assert_eq!(Vector::position_within(slice, len / 2, test), in_half);
                room[range.clone()].fill(zero);
            }
            room[range].fill(one);
        }
    }

    fn counts<S: Source<Lane = u8>>(alignments: usize, view: fn(&mut [u8]) -> &[S]) {
        let mut room = Room::new(1);
        let room = room.all();
        for range in ranges::<u8>(U8::LEN, alignments) {
            for at in range.clone() {
                let count = U8::count(black_box(view(&mut room[range.clone()])), |v| v.simd_eq(1));
                assert_eq!(count, range.end - at);
                room[at] = 0;
            }
            room[range].fill(1);
        }
        let long = &mut vec![1; 600 * U8::LEN + 5];
        assert_eq!(U8::count(view(long), |v| v.simd_eq(1)), long.len());
    }

    /// `run(from, to)` has to add 1.
    fn maps<T: From<u8> + Copy + PartialEq + Debug>(
        ranges: impl Iterator<Item = Range<usize>>,
        run: impl Fn(&mut [T], &mut [T]),
    ) {
        let (mut from, mut to) = (Room::new(T::from(0)), Room::new(T::from(0)));
        let (from, to) = (from.all(), to.all());
        let lane = |i: usize, plus: u8| T::from((i % 251) as u8 + plus);
        for (i, from) in from.iter_mut().enumerate() {
            *from = lane(i, 0);
        }
        for Range { start, end } in ranges {
            let half = start.midpoint(end);
            for (from_end, to_end) in [(end, end), (half, end), (end, half)] {
                to.fill(T::from(255));
                run(&mut from[start..from_end], &mut to[start..to_end]);
                let done = start..from_end.min(to_end);
                let want = |i| {
                    if done.contains(&i) {
                        lane(i, 1)
                    } else {
                        T::from(255)
                    }
                };
                assert!(
                    to.iter().enumerate().all(|(i, &got)| got == want(i)),
                    "{done:?}"
                );
            }
        }
    }

    fn copy<'a, T: Copy>(from: &[T], to: &'a mut [T]) -> &'a mut [T] {
        let len = from.len().min(to.len());
        to[..len].copy_from_slice(&from[..len]);
        &mut to[..len]
    }

    #[export]
    pub fn all_searches(alignments: usize) {
        searches::<u8, _, { U8::LEN }>(alignments, plain);
        searches::<u8, _, { U8::LEN }>(alignments, shared);
        searches::<u8, _, 16>(alignments, plain);
        searches::<u8, _, 16>(alignments, shared);
        searches::<u16, _, { U16::LEN }>(alignments, plain);
        searches::<u32, _, { isa::U32::LEN }>(alignments, plain);
        searches::<u64, _, { isa::U64::LEN }>(alignments, plain);
        counts(alignments, plain);
        counts(alignments, shared);
    }

    #[export]
    pub fn all_maps(alignments: usize) {
        let bytes = || ranges::<u8>(U8::LEN, alignments);
        maps(bytes(), |from, to| U8::map(from, to, |v| v + 1));
        maps(bytes(), |from, to| U8::map(shared(from), to, |v| v + 1));
        maps(bytes(), |from, to| {
            U8::map_in_place(copy(from, to), |v| v + 1)
        });
        maps(bytes(), |from, to| {
            U8::map_to_shared(from, shared(to), |v| v + 1)
        });
        maps(bytes(), |from, to| {
            let both = shared(copy(from, to));
            U8::map_to_shared(both, both, |v| v + 1);
        });
        let words = || ranges::<u16>(U16::LEN, alignments);
        maps(words(), |from, to| U16::map(from, to, |v| v + 1));
        maps(words(), |from, to| {
            U16::map_in_place(copy(from, to), |v| v + 1)
        });
    }

    #[export]
    pub fn short_slices() {
        let (mut from, mut to) = (Room::new(0), Room::new(0));
        let (from, to) = (from.all(), to.all());
        for (i, from) in from.iter_mut().enumerate() {
            *from = 1 + (i % 251) as u8;
        }
        for range in ranges::<u8>(U8::LEN, U8::LEN).filter(|it| it.len() < U8::LEN + 2) {
            let (slice, len) = (black_box(&from[range.clone()]), range.len().min(U8::LEN));
            let lanes = U8::load_or_default(slice);
            let want = std::array::from_fn(|i| slice.get(i).copied().unwrap_or(0));
            assert_eq!(lanes.to_array(), want);
            to.fill(0);
            (lanes | U8::iota().simd_ge(len as u8).to_vector()).store_first(&mut to[range.clone()]);
            assert_eq!(to[range.start..][..len], slice[..len]);
            assert_eq!(to.iter().filter(|&&byte| byte != 0).count(), len);
            if len == U8::LEN {
                continue;
            }
            let Some(partial) = U8::load_partial(slice) else {
                assert_eq!(len, 0);
                continue;
            };
            for (i, &byte) in slice.iter().enumerate() {
                assert_eq!(partial.to_bitmask(partial.lanes.simd_eq(byte)), 1 << i);
            }
            assert_eq!(partial.to_bitmask(partial.lanes.simd_eq(0)), 0);
            assert_eq!(
                partial.to_bitmask(partial.lanes.simd_lt(255)),
                (1 << len) - 1
            );
            if len < U16::LEN {
                let wide: Vec<u16> = slice.iter().map(|&byte| 0x700 | u16::from(byte)).collect();
                let lanes = U16::load_partial(black_box(&wide)).unwrap().lanes;
                U8::narrow(lanes, lanes).store_partial(&mut to[range.clone()]);
                assert_eq!(to[range], *slice);
            }
        }
    }

    #[export]
    pub fn first_last_and_count(slice: &[AtomicU8]) -> [Option<usize>; 3] {
        let test = |v: U8| v.simd_eq(1);
        let count = U8::count(slice, test);
        [
            U8::position(slice, test),
            U8::rposition(slice, test),
            Some(count),
        ]
    }
}

#[test]
fn searches() {
    on_each_target(|| simd::all_searches(2));
}

#[test]
fn maps() {
    on_each_target(|| simd::all_maps(2));
}

#[test]
fn short_slices() {
    on_each_target(simd::short_slices);
}

#[test]
#[ignore = "slow"]
fn more_alignments() {
    on_each_target(|| {
        simd::all_searches(16);
        simd::all_maps(16);
    });
}

/// One match comes and goes, and one stays.
#[test]
fn searches_with_a_concurrent_writer() {
    const LEN_FLICKERS_STAYS: [[usize; 3]; 6] = [
        [3, 0, 2],
        [7, 5, 1],
        [13, 2, 9],
        [40, 30, 3],
        [1200, 500, 900],
        [1200, 700, 300],
    ];
    on_each_target(|| {
        for [len, flickers, stays] in LEN_FLICKERS_STAYS {
            let slice: Vec<_> = (0..len)
                .map(|i| AtomicU8::new((i == stays).into()))
                .collect();
            let is_done = AtomicBool::new(false);
            let found = std::thread::scope(|scope| {
                scope.spawn(|| {
                    while !is_done.load(Relaxed) {
                        slice[flickers].fetch_xor(1, Relaxed);
                    }
                });
                let found: Vec<_> = (0..2000)
                    .map(|_| simd::first_last_and_count(&slice))
                    .collect();
                is_done.store(true, Relaxed);
                found
            });
            for [first, last, count] in found {
                assert!([Some(flickers.min(stays)), Some(stays)].contains(&first));
                assert!([Some(flickers.max(stays)), Some(stays)].contains(&last));
                assert!(matches!(count, Some(1 | 2)));
            }
        }
    });
}
