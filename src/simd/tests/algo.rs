//! The loops and the handling of short slices, against plain code.
#![cfg(not(miri))]
#![forbid(unsafe_code)]
mod common;

use bun_simd::{Int, Matches, Out, SharedU8, SharedWriter, Sink, Source};
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

/// Whether to stop at this index.
type Visit<'a> = &'a mut dyn FnMut(usize) -> bool;

fn some(matches: Matches) -> Matches {
    assert_ne!(matches.count(), 0);
    matches
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
                let slice = black_box(view(&mut room[range.clone()]));
                assert_eq!(Vector::position(slice, test), first);
                assert_eq!(Vector::rposition(slice, test), last);
                room[range.clone()].fill(zero);
            }
            room[range].fill(one);
        }
    }

    /// Each index comes once and in its turn.
    fn matches<T: Int<N> + From<u8> + PartialEq, const N: usize>(alignments: usize) {
        let (zero, one, mut random) = (T::from(0), T::from(1), 1u32);
        let (mut a, mut b) = (Room::new(one), Room::new(one));
        let (a, b) = (a.all(), &mut b.all()[3..]);
        let (test, both) = (
            |v: Vector<T, N>| v.simd_eq(one),
            |a: Vector<T, N>, b: Vector<T, N>| (a & b).simd_eq(one),
        );
        for range in ranges::<T>(N, alignments) {
            for one_in in [1, 3, 5 * N as u32] {
                for at in range.clone() {
                    random = random.wrapping_mul(1664525).wrapping_add(1013904223);
                    a[at] = T::from(u8::from((random >> 8) % one_in == 0));
                    b[at] = if random >> 29 == 0 { zero } else { one };
                }
                let (a, longer) = black_box((&a[range.clone()], &b[range.start..]));
                let b = &longer[..a.len()];
                let in_a: Vec<_> = (0..a.len()).filter(|&i| a[i] == one).collect();
                let in_both: Vec<_> = in_a.iter().copied().filter(|&i| b[i] == one).collect();
                let in_both_from_end: Vec<_> = in_both.iter().copied().rev().collect();
                assert_eq!(Vector::rposition_near(a, test), in_a.last().copied());
                for stop_at in [0, in_both.len() / 2, usize::MAX] {
                    let check = |want: &[usize], run: &dyn Fn(Visit<'_>) -> Option<usize>| {
                        let mut seen = vec![];
                        let found = run(&mut |at| {
                            seen.push(at);
                            seen.len() > stop_at
                        });
                        assert_eq!(found, want.get(stop_at).copied());
                        assert_eq!(seen, want[..want.len().min(stop_at.saturating_add(1))]);
                    };
                    check(&in_a, &|f| {
                        Vector::find_map(a, test, |it| some(it).find(|&at| f(at)))
                    });
                    check(&in_both, &|f| {
                        Vector::zip_find_map(a, longer, both, |it| some(it).find(|&at| f(at)))
                    });
                    check(&in_both, &|f| {
                        Vector::zip_find_map_near(longer, a, both, |it| some(it).find(|&at| f(at)))
                    });
                    check(&in_both_from_end, &|f| {
                        Vector::zip_rfind_map(a, longer, both, |it| some(it).rfind(|&at| f(at)))
                    });
                }
            }
            a[range.clone()].fill(one);
            b[range].fill(one);
        }
    }

    fn counts<T, S, const N: usize>(alignments: usize, view: fn(&mut [T]) -> &[S])
    where
        T: Int<N> + From<u8>,
        S: Source<Lane = T>,
    {
        let (zero, one) = (T::from(0), T::from(1));
        let (mut room, test) = (Room::new(one), |v: Vector<T, N>| v.simd_eq(one));
        let room = room.all();
        for range in ranges::<T>(N, alignments) {
            for at in range.clone() {
                let slice = black_box(view(&mut room[range.clone()]));
                assert_eq!(Vector::count(slice, test), range.end - at);
                let both = Vector::count_each(slice, |v| [test(v), !test(v)]);
                assert_eq!(both, [range.end - at, at - range.start]);
                room[at] = zero;
            }
            room[range].fill(one);
        }
        let (len, long) = (600 * N + 5, &mut vec![one; 600 * N + 5]);
        assert_eq!(Vector::count(view(long), test), len);
        assert_eq!(
            Vector::count_each(view(long), |v| [!test(v), test(v)]),
            [0, len]
        );
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

    /// In each of the three ways.
    fn append_plus_one(from: &[u8], to: &mut impl Sink) {
        let from = &from[..from.len().min(to.remaining())];
        let (first, second) = from.split_at(from.len() / 2);
        for part in [first, second] {
            let done = U8::append_chunks(to, part, |at, chunk| {
                assert_eq!(part[at..].as_ptr(), chunk.as_ptr());
                (at < 2 * U8::LEN).then(|| U8::load(chunk) + 1)
            });
            let rest = &part[done..];
            let (short, rest) = rest.split_at(rest.len() % U8::LEN);
            if let Some(partial) = U8::load_partial(short) {
                (partial.lanes + 1).append_partial(to, short.len());
            }
            to.extend_with(rest, |byte| Some(byte + 1));
        }
        assert_eq!(to.len(), from.len());
    }

    fn shared_pairs(alignments: usize) {
        let (mut room, test) = (Room::new(1), |v: U16| (v & 0xFF).simd_eq(1));
        let room = room.all();
        for range in ranges::<u8>(U8::LEN, alignments).filter(|it| it.len() % 2 == 0) {
            room[range.clone()].fill(0);
            for at in (0..range.len()).step_by(2) {
                room[range.start + at..][..2].copy_from_slice(&[1, 2]);
                let bytes = SharedU8::from_slice(shared(&mut room[range.clone()]));
                let pairs: &[[_; 2]] = black_box(bytes.as_chunks().0);
                assert_eq!(pairs[at / 2].get(), 0x201);
                assert_eq!(U16::position(pairs, test), Some(at / 2));
                assert_eq!(U16::rposition(pairs, test), Some(at / 2));
                assert_eq!(U16::count(pairs, test), 1);
                room[range.start + at..][..2].fill(0);
            }
            room[range].fill(1);
        }
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
        shared_pairs(alignments);
        matches::<u8, { U8::LEN }>(alignments);
        matches::<u16, { U16::LEN }>(alignments);
        matches::<u64, { isa::U64::LEN }>(alignments);
        counts::<u8, _, { U8::LEN }>(alignments, plain);
        counts::<u8, _, { U8::LEN }>(alignments, shared);
        counts::<u16, _, { U16::LEN }>(alignments, plain);
    }

    #[export]
    pub fn all_maps(alignments: usize) {
        let bytes = || ranges::<u8>(U8::LEN, alignments);
        maps::<u8>(bytes(), |from, to| {
            let len = from.len().min(to.len());
            assert_eq!(U8::map(from, to.into(), |v| v + 1).len(), len);
        });
        maps(bytes(), |from, to| {
            U8::map(shared(from), to.into(), |v| v + 1);
        });
        maps(bytes(), |from, to| {
            U8::zip_in_place(copy(from, to), from, |a, b| a + a - b + 1)
        });
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
        maps(bytes(), |from, to| {
            append_plus_one(from, &mut Out::from(to).into_writer())
        });
        maps(bytes(), |from, to| {
            append_plus_one(from, &mut SharedWriter::new(shared(to)))
        });
        maps(bytes().filter(|it| it.len() >= 2 * U8::LEN), |from, to| {
            let both = shared(copy(from, to));
            U8::append_chunks(&mut SharedWriter::new(both), both, |_, it| {
                Some(U8::load(it) + 1)
            });
        });
        let words = || ranges::<u16>(U16::LEN, alignments);
        maps::<u16>(words(), |from, to| {
            U16::map(from, to.into(), |v| v + 1);
        });
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
        for range in ranges::<u8>(U8::LEN, U8::LEN).filter(|it| it.len() < U8::LEN) {
            let (slice, len) = (black_box(&from[range.clone()]), range.len());
            let Some(partial) = U8::load_partial(slice) else {
                assert_eq!(len, 0);
                continue;
            };
            for (i, &byte) in slice.iter().enumerate() {
                assert_eq!(partial.to_bitmask(partial.lanes.simd_eq(byte)), 1 << i);
            }
            let at = |index: u8| slice.get(usize::from(index)).copied().unwrap_or(0);
            assert_eq!(
                partial.indices().to_array().map(at),
                partial.lanes.to_array()
            );
            assert_eq!(partial.to_bitmask(partial.lanes.simd_eq(0)), 0);
            assert_eq!(
                partial.to_bitmask(partial.lanes.simd_lt(255)),
                (1 << len) - 1
            );
            if len < U16::LEN {
                let wide: Vec<u16> = slice.iter().map(|&byte| 0x700 | u16::from(byte)).collect();
                let lanes = U16::load_partial(black_box(&wide)).unwrap().lanes;
                let to = to[range].as_mut().into();
                assert_eq!(U8::narrow(lanes, lanes).store_partial(to), slice);
            }
        }
    }

    #[export]
    pub fn firsts_lasts_and_count(slice: &[AtomicU8], stays: usize) -> ([Option<usize>; 5], usize) {
        let (test, both) = (|v: U8| v.simd_eq(1), |a: U8, b: U8| (a & b).simd_eq(1));
        let found = [
            U8::position(slice, test),
            U8::rposition(slice, test),
            U8::zip_find_map(slice, slice, both, |mut it| it.find(|&at| at == stays)),
            U8::zip_find_map_near(slice, slice, both, |mut it| it.find(|&at| at == stays)),
            U8::zip_rfind_map(slice, slice, both, |mut it| it.rfind(|&at| at == stays)),
        ];
        (found, U8::count(slice, test))
    }

    #[export]
    pub fn append_a_whole_vector(to: &[AtomicU8]) {
        U8::zero().append_partial(&mut SharedWriter::new(to), U8::LEN);
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
#[should_panic]
fn append_a_whole_vector() {
    simd::append_a_whole_vector(shared(&mut [0; 100]));
}

#[test]
fn blocks() {
    let text: Vec<u16> = (1..200).collect();
    for len in 0..text.len() {
        let mut want = text[..len].to_vec();
        want.resize(len.next_multiple_of(64), 7000);
        let padding = &mut [7000; 64];
        let got: Vec<_> = bun_simd::blocks(&text[..len], padding).copied().collect();
        assert_eq!(got.as_flattened(), want);
    }
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
                    .map(|_| simd::firsts_lasts_and_count(&slice, stays))
                    .collect();
                is_done.store(true, Relaxed);
                found
            });
            for ([first, last, others @ ..], count) in found {
                assert!([Some(flickers.min(stays)), Some(stays)].contains(&first));
                assert!([Some(flickers.max(stays)), Some(stays)].contains(&last));
                assert_eq!(others, [Some(stays); 3]);
                assert!(matches!(count, 1 | 2));
            }
        }
    });
}
