//! The loops and the handling of short slices, against plain code.
#![forbid(unsafe_code)]
mod common;

use bun_simd::{Int, Matches, Out, SharedOutU8, SharedU8, SharedWriter, Sink, Source, extend_vec};
use common::on_each_target;
use std::cell::Cell;
use std::fmt::Debug;
use std::hint::black_box;
use std::mem::replace;
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

fn shared(slice: &mut [u8]) -> &[SharedU8] {
    in_place(slice).0
}

fn shared_out(slice: &mut [u8]) -> &[SharedOutU8] {
    Out::from(slice).into_shared()
}

fn in_place(slice: &mut [u8]) -> (&[SharedU8], &[SharedOutU8]) {
    let slice = AtomicU8::from_mut_slice(slice);
    (SharedU8::from_slice(slice), SharedOutU8::from_slice(slice))
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{U8, U16, U32, U64, Vector, x128};

    /// The lanes around the slice match too, so a look outside of it changes the result.
    fn searches<T, S, const N: usize>(alignments: usize, view: fn(&mut [T]) -> &[S])
    where
        T: Int<N> + From<u8>,
        S: Source<Lane = T>,
    {
        let (padding, other, suspect) = (T::from(0), T::from(1), T::from(2));
        let mut room = Room::new(padding);
        let room = room.all();
        let test = |v: Vector<T, N>| v.simd_eq(padding);
        for range in ranges::<T>(N, alignments) {
            let len = range.len();
            for first in (0..len).map(Some).chain([None]) {
                room[range.clone()].fill(other);
                for at in range.clone().step_by(5 * N) {
                    room[at] = suspect;
                }
                let last = first.map(|first| first + (len - first) / 2);
                for at in first.into_iter().chain(last) {
                    room[range.start + at] = padding;
                }
                let slice = black_box(view(&mut room[range.clone()]));
                assert_eq!(Vector::position(slice, test), first);
                assert_eq!(
                    Vector::position_refined(slice, |v| [v.simd_ne(other), test(v)]),
                    first
                );
                assert_eq!(Vector::rposition(slice, test), last);
                let near = [
                    Vector::position_near([slice], |[v]| test(v)),
                    Vector::rposition_near([slice], |[v]| test(v)),
                ];
                assert_eq!(near, [first, last]);
            }
            room[range].fill(padding);
        }
    }

    /// They are in the same vector, or in the same lane of different ones.
    fn two_matches<T, S, const N: usize>(alignments: usize, view: fn(&mut [T]) -> &[S])
    where
        T: Int<N> + From<u8>,
        S: Source<Lane = T>,
    {
        let (mut room, zero, one) = (Room::new(T::from(0)), T::from(0), T::from(1));
        let room = room.all();
        let test = |v: Vector<T, N>| v.simd_eq(one);
        let lens = [2 * N - 1, 4 * N - 1, 13 * N - 1];
        for range in ranges::<T>(N, alignments).filter(|it| lens.contains(&it.len())) {
            let slice = &mut room[range];
            for apart in [0, 1, N, 2 * N, 3 * N] {
                for first in 0..slice.len().saturating_sub(apart) {
                    (slice[first], slice[first + apart]) = (one, one);
                    let found = Vector::position(black_box(view(slice)), test);
                    assert_eq!(found, Some(first));
                    let found = Vector::rposition(black_box(view(slice)), test);
                    assert_eq!(found, Some(first + apart));
                    (slice[first], slice[first + apart]) = (zero, zero);
                }
            }
        }
    }

    fn matches<T: Int<N> + From<u8> + PartialEq, const N: usize>(alignments: usize) {
        let (zero, one, mut random) = (T::from(0), T::from(1), 1u32);
        let (mut a, mut b) = (Room::new(one), Room::new(one));
        let (a, b) = (a.all(), &mut b.all()[3..]);
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
                from_either_end::<T, N, true>([a, longer], &in_a, &in_both);
                from_either_end::<T, N, false>([a, longer], &in_a, &in_both);
            }
            a[range.clone()].fill(one);
            b[range].fill(one);
        }
    }

    fn from_either_end<T: Int<N> + From<u8>, const N: usize, const FORWARD: bool>(
        both: [&[T]; 2],
        in_a: &[usize],
        in_both: &[usize],
    ) {
        let (one, len, block) = (T::from(1), both[0].len(), Vector::<T, N>::BLOCK_LEN);
        let test = |[a, b]: [Vector<T, N>; 2]| (a & b).simd_eq(one);
        let turn = |at: usize| if FORWARD { at } else { len - 1 - at };
        let next = |all: &[usize], from| {
            all.iter()
                .map(|&at| turn(at))
                .filter(|&it| it >= from)
                .min()
        };
        // How many are up to and in the block.
        let check = |matches: Matches| {
            let start = matches.start();
            let want = || {
                in_both
                    .iter()
                    .copied()
                    .filter(|at| (start..start + block).contains(at))
            };
            let cuts = [0, 1, 2, 32, 64, 65, 66, usize::MAX / 2 + 2];
            for cut in cuts.map(|it| (start + it).wrapping_sub(1)) {
                let [mut above, mut below] = [matches.clone(), matches.clone()];
                above.cut_at(cut, true);
                below.cut_at(cut, false);
                assert!(above.eq(want().filter(|&at| at >= cut)));
                assert!(below.eq(want().filter(|&at| at <= cut)));
            }
            assert!(matches.clone().eq(want()) && matches.rev().eq(want().rev()));
            if FORWARD {
                len.min(start + block)
            } else {
                len - start
            }
        };
        let near = Vector::matches_near::<T, 2, FORWARD>(both, test);
        assert_eq!(check(near), len.min(block));
        let near = match FORWARD {
            true => Vector::position_near([both[1], both[0]], test),
            false => Vector::rposition_near([both[1], both[0]], test),
        };
        assert_eq!(near.map(turn), next(in_both, 0));
        let near = match FORWARD {
            true => Vector::<T, N>::position_near([both[0]], |[v]| v.simd_eq(one)),
            false => Vector::<T, N>::rposition_near([both[0]], |[v]| v.simd_eq(one)),
        };
        assert_eq!(near.map(turn), next(in_a, 0));
        for from in [
            0,
            1,
            len / 3,
            len / 2,
            len.saturating_sub(N),
            len.saturating_sub(1),
            len,
            len + block + 1,
        ] {
            for until in [0, from, from + block, from + 3 * block + 5, usize::MAX] {
                let (mut seen, until_end) = (from, until.min(len));
                let has_none = |from, to| next(in_both, from).is_none_or(|first| first >= to);
                for matches in Vector::matches_in::<T, 2, FORWARD>(both, from..until, test) {
                    assert!(len >= block && !matches.is_empty());
                    let now = check(matches);
                    assert!(seen < now && now <= until_end && has_none(seen, now - block));
                    assert!(now == until_end || (now - from) % block == 0);
                    seen = now;
                }
                assert!(if until_end < block {
                    seen == from
                } else {
                    has_none(seen, until_end)
                });
            }
            let mut none = Vector::matches_in::<T, 2, FORWARD>(both, !from..usize::MAX, test);
            assert!(none.next().is_none());
            if from <= len.saturating_sub(N) {
                let skipped = Vector::skip::<T, FORWARD>(both[0], from, |v| [v.simd_eq(one); 2]);
                let first = next(in_a, skipped.min(from)).unwrap_or(len);
                assert!(from < skipped + N && (skipped..skipped + 4 * N).contains(&first));
            }
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
                assert_eq!(Vector::count(slice, |v| !test(v)), at - range.start);
                room[at] = zero;
            }
            room[range].fill(one);
        }
        let (len, long) = (600 * N + 5, &mut vec![one; 600 * N + 5]);
        assert_eq!(Vector::count(view(long), test), len);
        assert_eq!(Vector::count(view(long), |v| !test(v)), 0);
    }

    fn sums(alignments: usize) {
        let (mut bytes, mut words) = (Room::new(7), Room::new(0x0707));
        let (bytes, words) = (bytes.all(), words.all());
        for range in ranges::<u8>(U8::LEN, alignments) {
            let slice = black_box(&bytes[range]);
            assert_eq!(U8::sum_of_bytes::<_, 7>(slice, |v| v), 7 * slice.len());
        }
        for range in ranges::<u16>(U16::LEN, alignments) {
            let slice = black_box(&words[range]);
            let sum = U16::sum_of_bytes::<_, 7>(slice, |v| v.bitcast());
            assert_eq!(sum, 14 * slice.len());
        }
        let long = &vec![63; 600 * U8::LEN + 5];
        assert_eq!(U8::sum_of_bytes::<_, 63>(long, |v| v), 63 * long.len());
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

    /// In both ways.
    fn append_plus_one(from: &[u8], to: &mut impl Sink) {
        let from: Vec<u16> = from.iter().map(|&byte| byte.into()).collect();
        let len = from.len().min(to.remaining());
        let plus_one = |from: &[u16]| {
            let [low, high] = U16::load_or_zero(from);
            U8::narrow(low, high) + 1
        };
        let (first, second) = from.split_at(len / 2);
        for (part, chunks) in [(first, len % 8), (second, usize::MAX)] {
            let (start, left) = (to.len(), Cell::new(chunks));
            U8::append_chunks(part, to, |chunk| {
                left.set(left.get().checked_sub(1)?);
                Some(plus_one(chunk))
            });
            let part = &part[..part.len().min(len - start)];
            let want = match part.len() {
                len if len < U8::LEN / 2 => 0,
                len if len.div_ceil(U8::LEN) > chunks => chunks * U8::LEN,
                len => len,
            };
            assert_eq!(to.len() - start, want);
            let mut rest = &part[want..];
            while rest.len() >= U8::LEN {
                plus_one(rest).append_partial(to, U8::LEN - 1);
                rest = &rest[U8::LEN - 1..];
            }
            // At the very end, there is no room for more.
            let is_last = rest.len() == to.remaining();
            plus_one(rest).append_partial(to, if is_last { U8::LEN - 1 } else { rest.len() });
        }
        assert_eq!(to.len(), len);
    }

    /// `view` gives the input.
    fn stops<S: Source<Lane = u8>>(alignments: usize, view: fn(&mut [u8]) -> &[S]) {
        let (mut from, mut to) = (Room::new(0), Room::new(7));
        let (from, to) = (from.all(), to.all());
        for range in ranges::<u8>(U8::LEN, alignments).filter(|it| it.len() < 10 * U8::LEN) {
            let (start, len) = (range.start, range.len());
            from[range.clone()].fill(1);
            for at in (0..=len).rev() {
                from[start + at] = 0;
                let (input, output) = (view(&mut from[range.clone()]), &mut to[range.clone()]);
                let got =
                    U8::map_to_shared_until(input, shared_out(output), |v| v + 1, |v| v.simd_eq(0));
                assert_eq!(got, at);
                assert!(output[..at].iter().all(|&byte| byte == 2));
                output[..at].fill(7);
                assert!(to[..start + len + U8::LEN].iter().all(|&byte| byte == 7));
                let mut both = from[range.clone()].to_vec();
                let (input, output) = in_place(&mut both);
                let got = U8::map_to_shared_until(input, output, |v| v + 1, |v| v.simd_eq(0));
                assert_eq!((got, &both[at..]), (at, &from[start + at..start + len]));
                assert!(both[..at].iter().all(|&byte| byte == 2));
                from[start + at] = u8::from(at < len && at % 3 != 0);
            }
            from[range].fill(0);
        }
    }

    /// One alone, or two in the same lane of different vectors.
    fn two_stops() {
        let (mut from, to) = ([1; 9 * U8::LEN], &mut [0; 9 * U8::LEN]);
        let to = shared_out(to);
        for apart in [0, U8::LEN, 2 * U8::LEN, 3 * U8::LEN] {
            for at in 0..from.len() - apart {
                (from[at], from[at + apart]) = (0, 0);
                let got = U8::map_to_shared_until(&from, to, |v| v, |v| v.simd_eq(0));
                assert_eq!(got, at);
                (from[at], from[at + apart]) = (1, 1);
            }
        }
    }

    fn shared_pairs(alignments: usize) {
        let (mut room, test) = (Room::new(1), |v: U16| (v & 0xFF).simd_eq(1));
        let room = room.all();
        for range in ranges::<u8>(U8::LEN, alignments).filter(|it| it.len() % 2 == 0) {
            room[range.clone()].fill(0);
            for at in (0..range.len()).step_by(2) {
                room[range.start + at..][..2].copy_from_slice(&[1, 2]);
                let bytes = shared(&mut room[range.clone()]);
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
        searches::<u8, _, 32>(alignments, plain);
        searches::<u16, _, 8>(alignments, plain);
        searches::<u16, _, 16>(alignments, plain);
        searches::<u16, _, { U16::LEN }>(alignments, plain);
        searches::<u32, _, { U32::LEN }>(alignments, plain);
        searches::<u64, _, { U64::LEN }>(alignments, plain);
        shared_pairs(alignments);
        two_matches::<u8, _, { U8::LEN }>(alignments, plain);
        two_matches::<u8, _, { U8::LEN }>(alignments, shared);
        two_matches::<u16, _, { U16::LEN }>(alignments, plain);
        matches::<u8, { U8::LEN }>(alignments);
        matches::<u16, { U16::LEN }>(alignments);
        matches::<u64, { U64::LEN }>(alignments);
        counts::<u8, _, { U8::LEN }>(alignments, plain);
        counts::<u8, _, { U8::LEN }>(alignments, shared);
        counts::<u16, _, { U16::LEN }>(alignments, plain);
        sums(alignments);
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
            let to = copy(from, to);
            U8::map_in_place(to, |v| v + v + 1);
            U8::zip_in_place(to, from, |a, b| a - b)
        });
        maps(bytes(), |from, to| {
            U8::map_in_place(copy(from, to), |v| v + 1)
        });
        maps(bytes(), |from, to| {
            U8::map_to_shared(from, shared_out(to), |v| v + 1)
        });
        maps(bytes(), |from, to| {
            let (from, to) = in_place(copy(from, to));
            U8::map_to_shared(from, to, |v| v + 1);
        });
        maps(bytes(), |from, to| {
            append_plus_one(from, &mut Out::from(to).into_writer())
        });
        maps(bytes(), |from, to| {
            append_plus_one(from, &mut SharedWriter::new(shared_out(to)))
        });
        stops(alignments, plain);
        stops(alignments, shared);
        two_stops();
        maps(ranges::<u8>(16, alignments), |from, to| {
            x128::U8::map_to_shared(from, shared_out(to), |v| v + 1)
        });
        plain_maps::<u8, 16>(alignments);
        plain_maps::<u8, 32>(alignments);
        plain_maps::<u16, { U16::LEN }>(alignments);
        plain_maps::<u32, { U32::LEN }>(alignments);
        plain_maps::<u64, { U64::LEN }>(alignments);
    }

    fn plain_maps<T: Int<N> + From<u8> + PartialEq + Debug, const N: usize>(alignments: usize) {
        let (ranges, one) = (|| ranges::<T>(N, alignments), T::from(1));
        maps::<T>(ranges(), |from, to| {
            Vector::map(from, to.into(), |v: Vector<T, N>| v + one);
        });
        maps(ranges(), |from, to| {
            Vector::map_in_place(copy(from, to), |v: Vector<T, N>| v + one)
        });
        maps(ranges(), |from, to| {
            let to = copy(from, to);
            Vector::map_in_place(to, |v: Vector<T, N>| v + v + one);
            Vector::zip_in_place(to, from, |a: Vector<T, N>, b| a - b)
        });
    }

    fn pairs_stay_together<T: Int<N> + From<u8> + PartialEq + Debug, const N: usize>() {
        for len in (0..80).step_by(2) {
            let from: Vec<T> = (0..len).map(T::from).collect();
            let want: Vec<T> = (0..len).map(|i| T::from(i ^ 1)).collect();
            let (mut a, mut b) = (from.clone(), from.clone());
            Vector::map(&from, a[..].as_mut().into(), Vector::<T, N>::swap_pairs);
            Vector::map_in_place(&mut b, Vector::<T, N>::swap_pairs);
            assert_eq!([&a, &b], [&want; 2]);
        }
    }

    fn padded<T, S, const N: usize>(view: fn(&mut [T]) -> &[S])
    where
        T: Int<N> + From<u8> + PartialEq + Debug,
        S: Source<Lane = T>,
    {
        let mut room = Room::new(T::from(0));
        let room = room.all();
        for (i, lane) in room.iter_mut().enumerate() {
            *lane = T::from(1 + (i % 251) as u8);
        }
        for range in ranges::<T>(N, N).filter(|it| it.len() < N) {
            let (mut want, len) = ([T::from(0); N], range.len());
            want[..len].copy_from_slice(&room[range.clone()]);
            let (mut to, lanes) = (Room::new(T::from(0)), Vector::<T, N>::iota() + T::from(1));
            let to = to.all();
            let stored = lanes.store_partial(to[range.clone()].as_mut().into());
            assert_eq!(stored, &lanes.to_array()[..len]);
            stored.fill(T::from(0));
            assert!(to.iter().all(|&lane| lane == T::from(0)));
            let Some(padded) = Vector::<T, N>::load_padded(black_box(view(&mut room[range])))
            else {
                assert_eq!(len, 0);
                continue;
            };
            assert_eq!(padded.lanes.to_array(), want);
            let is_padding = padded.lanes.simd_eq(T::from(0));
            let all = is_padding | !is_padding;
            assert_eq!(
                [is_padding, all].map(|it| padded.first_set(it)),
                [None, Some(0)]
            );
            assert_eq!(
                [is_padding, all].map(|it| padded.last_set(it)),
                [None, Some(len - 1)]
            );
            assert_eq!([is_padding, all].map(|it| padded.count(it)), [0, len]);
            assert_eq!(
                [is_padding, all].map(|it| padded.to_bitmask(it)),
                [0, u64::MAX >> (64 - len)]
            );
        }
    }

    #[export]
    pub fn groups_stay_together() {
        pairs_stay_together::<u16, { U16::LEN }>();
        pairs_stay_together::<u32, { U32::LEN }>();
        pairs_stay_together::<u64, { U64::LEN }>();
        for (size, count) in [2, 4, 8]
            .into_iter()
            .flat_map(|it| (0..40).map(move |n| (it, n)))
        {
            let reverse = |v: U8| v.lookup(U8::iota() & 15 ^ (size - 1));
            let len = usize::from(size) * count;
            let from: Vec<u8> = (0..len).map(|i| i as u8).collect();
            let want: Vec<u8> = from.iter().map(|i| i ^ (size - 1)).collect();
            let [mut a, mut b, mut c] = [vec![0; len], from.clone(), from.clone()];
            U8::map(&from, a[..].as_mut().into(), reverse);
            U8::map_in_place(&mut b, reverse);
            let (from, to) = in_place(&mut c);
            U8::map_to_shared(from, to, reverse);
            assert_eq!([&a, &b, &c], [&want; 3]);
        }
    }

    fn narrow_and_shared<const N: usize>() {
        let mut bytes = Vec::from_iter(0..4 * N as u8);
        let four = Vector::<u8, N>::load4(shared(&mut bytes).as_chunks().0.as_array().unwrap());
        assert_eq!(four.map(Vector::to_array).as_flattened(), bytes);
        let mut seven = Vec::from_iter(0..7 * N as u8);
        for (at, &want) in seven.clone().as_chunks::<N>().0.iter().enumerate() {
            let got = Vector::load_at(shared(&mut seven).as_chunks().0, at);
            assert_eq!(got.to_array(), want);
            assert_eq!(Vector::load_at(seven.as_chunks().0, at).to_array(), want);
        }
        four[1].store_shared(shared_out(&mut bytes).first_chunk().unwrap());
        assert_eq!(bytes[..2 * N], four[1].to_array().repeat(2));
    }

    #[export]
    pub fn short_slices() {
        narrow_and_shared::<2>();
        narrow_and_shared::<4>();
        narrow_and_shared::<8>();
        narrow_and_shared::<16>();
        padded::<u8, _, { U8::LEN }>(plain);
        padded::<u8, _, { U8::LEN }>(shared);
        padded::<u8, _, 16>(plain);
        padded::<u8, _, 32>(plain);
        padded::<u16, _, 16>(plain);
        padded::<u16, _, { U16::LEN }>(plain);
        padded::<u32, _, { U32::LEN }>(plain);
        padded::<u64, _, { U64::LEN }>(plain);
        let mut from = Room::new(0);
        let from = from.all();
        for (i, from) in from.iter_mut().enumerate() {
            *from = 1 + (i % 251) as u8;
        }
        for range in ranges::<u8>(64, 64).filter(|it| it.len() < 64) {
            let mut want = [0; 64];
            want[..range.len()].copy_from_slice(&from[range.clone()]);
            assert_eq!(U8::pad_block(black_box(&from[range])), want);
        }
        for range in ranges::<u8>(U8::LEN, 2).filter(|it| it.len() <= 5 * U8::LEN) {
            let (mut want, len) = ([[0; U8::LEN]; 4], range.len().min(4 * U8::LEN));
            want.as_flattened_mut()[..len].copy_from_slice(&from[range.start..][..len]);
            let got: [_; 4] = U8::load_or_zero(black_box(&from[range.clone()]));
            assert_eq!(got.map(U8::to_array), want);
            let [a, b] = U8::load_or_zero(shared(&mut from[range]));
            assert_eq!([a.to_array(), b.to_array()], want[..2]);
        }
    }

    /// The results have allocations of their exact size.
    #[export]
    pub fn each_loop_once(from: &mut [u8]) {
        let (len, plus_one) = (from.len(), |v: U8| v + 1);
        let want: Vec<u8> = from.iter().map(|byte| byte + 1).collect();
        let [mut a, mut b, mut c] = [(); 3].map(|()| Vec::with_capacity(len));
        extend_vec(&mut a, len, |to| U8::map(from, to, plus_one));
        extend_vec(&mut b, len, |to| U8::map(shared(from), to, plus_one));
        extend_vec(&mut c, len, |to| {
            let mut to = to.into_writer();
            append_plus_one(from, &mut to);
            to.finish()
        });
        let [mut d, mut e, mut f, mut g] = [(); 4].map(|()| from.to_vec());
        U8::map_in_place(&mut d, plus_one);
        U8::zip_in_place(&mut e, from, |a, b| a + a - b + 1);
        U8::map_to_shared(from, shared_out(&mut f), plus_one);
        append_plus_one(from, &mut SharedWriter::new(shared_out(&mut g)));
        assert_eq!([&a, &b, &c, &d, &e, &f, &g], [&want; 7]);
        let stop = from.last().map_or(0, |last| last / 2);
        let copied = U8::map_to_shared_until(from, shared_out(&mut g), |v| v, |v| v.simd_eq(stop));
        assert_eq!(
            copied,
            from.iter().take_while(|&&byte| byte != stop).count()
        );
        assert_eq!(g, [&from[..copied], &want[copied..]].concat());
        let ((slice, to), test) = (in_place(from), |v: U8| v.simd_eq(255));
        assert_eq!(U8::position(slice, test), None);
        assert_eq!(U8::rposition(slice, test), None);
        assert_eq!(U8::position_near([slice; 2], |[a, b]| test(a & b)), None);
        assert_eq!(U8::rposition_near([slice; 2], |[a, b]| test(a & b)), None);
        assert_eq!(U8::count(slice, test), 0);
        finds_no_255::<true>(slice);
        finds_no_255::<false>(slice);
        U8::map_to_shared(slice, to, |v| v - 1);
        U8::map_in_place(from, |v| v + 2);
        assert_eq!(from, want);
    }

    fn finds_no_255<const FORWARD: bool>(slice: &[SharedU8]) {
        let (pair, test) = ([slice; 2], |[a, b]: [U8; 2]| (a & b).simd_eq(255));
        assert!(U8::matches_near::<_, 2, FORWARD>(pair, test).is_empty());
        let mut blocks = U8::matches_in::<_, 2, FORWARD>(pair, 1..usize::MAX, test);
        assert!(blocks.next().is_none());
        let skipped = U8::skip::<_, FORWARD>(slice, 1, |v| [v.simd_eq(255); 2]);
        assert!(slice.len() - skipped < 4 * U8::LEN);
    }

    /// As if another thread wrote between two reads.
    #[export]
    pub fn matches_that_go_once_they_are_seen() {
        let bytes = &mut [0; 13 * U8::LEN];
        let ((slice, to), last) = (in_place(bytes), 13 * U8::LEN - 1);
        for (goes, stays) in (0..=last).flat_map(|at| [(at, last / 3), (at, last - last / 3)]) {
            let test = |v: U8| {
                if v.simd_eq(1).any() {
                    to[goes].set(0);
                }
                v.simd_ne(0)
            };
            let check = |or: usize, run: &dyn Fn() -> Option<usize>| {
                to[goes].set(1);
                to[stays].set(2);
                assert!([Some(or), Some(stays)].contains(&run()));
            };
            check(goes.min(stays), &|| U8::position(slice, test));
            check(goes.max(stays), &|| U8::rposition(slice, test));
            let first = |mut it: Matches| it.find(|&at| at == stays);
            let last = |mut it: Matches| it.rfind(|&at| at == stays);
            let tests: [&dyn Fn([U8; 2]) -> _; 2] = [&|[v, _]| test(v), &|[_, v]| test(v)];
            for (pair, test) in tests.map(|test| ([slice; 2], test)) {
                check(goes.min(stays), &|| U8::position_near(pair, test));
                check(goes.max(stays), &|| U8::rposition_near(pair, test));
                check(stays, &|| {
                    U8::matches_in::<_, 2, true>(pair, 0..usize::MAX, test).find_map(first)
                });
                check(stays, &|| {
                    U8::matches_in::<_, 2, false>(pair, 0..usize::MAX, test).find_map(last)
                });
            }
            to[goes].set(0);
            to[stays].set(0);
        }
    }

    #[export]
    pub fn stop_that_goes_once_it_is_seen() {
        for len in 1..=U8::LEN {
            let (from, mut to, is_seen) = (vec![1; len], vec![0; len], Cell::new(false));
            let stops = |v: U8| v.simd_eq(if is_seen.replace(true) { 2 } else { 1 });
            let got = U8::map_to_shared_until(&from, shared_out(&mut to), |v| v, stops);
            assert_eq!(to[..got], from[..len.min(U8::LEN - 1)]);
        }
    }

    #[export]
    pub fn firsts_lasts_and_count(
        slice: &[SharedU8],
        stays: usize,
    ) -> ([[Option<usize>; 2]; 3], usize) {
        let (test, both) = (|v: U8| v.simd_eq(1), |[a, b]: [U8; 2]| (a & b).simd_eq(1));
        let (pair, all, is_it) = ([slice; 2], 0..usize::MAX, |&at: &usize| at == stays);
        let after_others = match slice.len() {
            ..64 => [
                U8::matches_near::<_, 2, true>(pair, both).find(is_it),
                U8::matches_near::<_, 2, false>(pair, both).rfind(is_it),
            ],
            _ => [
                U8::matches_in::<_, 2, true>(pair, all.clone(), both)
                    .find_map(|mut it| it.find(is_it)),
                U8::matches_in::<_, 2, false>(pair, all, both).find_map(|mut it| it.rfind(is_it)),
            ],
        };
        let near = [
            U8::position_near(pair, both),
            U8::rposition_near(pair, both),
        ];
        let found = [
            [U8::position(slice, test), U8::rposition(slice, test)],
            near,
            after_others,
        ];
        (found, U8::count(slice, test))
    }

    #[export]
    pub fn swap_pairs(bytes: &[AtomicU8]) {
        let (from, to) = (SharedU8::from_slice(bytes), SharedOutU8::from_slice(bytes));
        U8::map_to_shared(from, to, U8::swap_pairs);
    }

    #[export]
    pub fn load_a_whole_vector() {
        U8::load_padded(&[0; U8::LEN]);
    }

    #[export]
    pub fn store_a_whole_vector() {
        U8::zero().store_partial([0; U8::LEN][..].as_mut().into());
    }

    #[export]
    pub fn append_a_whole_vector(to: &[SharedOutU8]) {
        U8::zero().append_partial(&mut SharedWriter::new(to), U8::LEN);
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn searches() {
    on_each_target(|| simd::all_searches(2));
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn maps() {
    on_each_target(|| simd::all_maps(2));
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn groups_stay_together() {
    on_each_target(simd::groups_stay_together);
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn short_slices() {
    on_each_target(simd::short_slices);
}

/// For Miri.
#[test]
fn each_loop_once() {
    on_each_target(|| {
        for len in [0, 1, 2, 3, 4, 7, 8, 15, 16, 17, 31, 40, 63, 64, 100, 254] {
            simd::each_loop_once(&mut Vec::from_iter(0..len));
        }
        for near_end_of_page in [127..128, 120..125, 110..140, 65..128] {
            simd::each_loop_once(&mut Room::new(7).all()[near_end_of_page]);
        }
    });
}

#[test]
fn shared_pair() {
    let pair = [1, 2].map(AtomicU8::new);
    assert_eq!(SharedU8::from_slice(&pair).as_chunks().0[0].get(), 0x0201);
}

#[test]
#[should_panic(expected = "len < N")]
#[cfg_attr(miri, ignore = "compares only lengths")]
fn append_a_whole_vector() {
    simd::append_a_whole_vector(shared_out(&mut [0; 100]));
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "compares only lengths")]
fn load_a_whole_vector() {
    simd::load_a_whole_vector();
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "compares only lengths")]
fn store_a_whole_vector() {
    simd::store_a_whole_vector();
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "compares only lengths")]
fn store_a_whole_vector_without_a_mask() {
    bun_simd::limit_to(bun_simd::Target::Portable);
    simd::store_a_whole_vector();
}

#[test]
fn readers_see_only_old_and_new_values() {
    let loads = if cfg!(miri) { 140 } else { 1 << 22 };
    on_each_target(|| {
        for len in [2, 6, 18, 70] {
            let bytes: Vec<_> = (0..len).map(|i| AtomicU8::new(1 + i % 2)).collect();
            let mut first = 0;
            // Only those passes count that have met a write.
            let has_changed = |_: &usize| {
                assert!(bytes.iter().all(|byte| byte.load(Relaxed) != 0));
                replace(&mut first, bytes[0].load(Relaxed)) != first
            };
            let mut passes = (0..loads / bytes.len()).filter(has_changed);
            std::thread::scope(|scope| {
                let reader = scope.spawn(|| passes.nth(10_000));
                simd::swap_pairs(&bytes);
                while !reader.is_finished() {
                    simd::swap_pairs(&bytes);
                }
            });
        }
    });
}

#[test]
#[cfg(all(target_arch = "x86_64", not(miri)))]
fn order_of_accesses_with_one_last_lane() {
    #[inline(never)]
    #[target_feature(enable = "avx512bw")]
    fn masked_load(stores: bool, keeps: bool, kept: &mut u8) {
        let mut bytes = black_box([1u8; 16]);
        let loaded = bun_simd_trusted::shared::load64_masked::<true>(&bytes[..1]);
        if stores {
            bytes[0] = 0;
        }
        if keeps {
            *kept = loaded[63];
        }
        black_box(&mut bytes);
    }
    #[inline(never)]
    #[target_feature(enable = "avx512bw")]
    fn masked_store(stores: bool, keeps: bool, kept: &mut u8) {
        let mut bytes = black_box([1u8; 16]);
        let loaded = bytes[0];
        if stores {
            Out::from(&mut bytes[..1]).fill_from_last(Default::default());
        }
        if keeps {
            *kept = loaded;
        }
        black_box(&mut bytes);
    }
    type Run = fn(bool, bool, &mut u8);
    let load = bun_simd::if_supported!(["avx512bw"], Run, masked_load);
    let store = bun_simd::if_supported!(["avx512bw"], Run, masked_store);
    for run in load.into_iter().chain(store) {
        let mut kept = 0;
        black_box(run)(true, true, &mut kept);
        assert_eq!(kept, 1);
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
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

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn matches_that_go_once_they_are_seen() {
    on_each_target(simd::matches_that_go_once_they_are_seen);
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn stop_that_goes_once_it_is_seen() {
    on_each_target(simd::stop_that_goes_once_it_is_seen);
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
    let (cases, rounds) = if cfg!(miri) { (4, 1) } else { (6, 2000) };
    on_each_target(|| {
        for &[len, flickers, stays] in &LEN_FLICKERS_STAYS[..cases] {
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
                let found: Vec<_> = (0..rounds)
                    .map(|_| simd::firsts_lasts_and_count(SharedU8::from_slice(&slice), stays))
                    .collect();
                is_done.store(true, Relaxed);
                found
            });
            for ([nearest @ .., after_others], count) in found {
                for [first, last] in nearest {
                    assert!([Some(flickers.min(stays)), Some(stays)].contains(&first));
                    assert!([Some(flickers.max(stays)), Some(stays)].contains(&last));
                }
                assert_eq!(after_others, [Some(stays); 2]);
                assert!(matches!(count, 1 | 2));
            }
        }
    });
}
