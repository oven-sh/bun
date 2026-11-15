//! Every op of a target against what it means, and the drivers against plain loops.
#![cfg(not(miri))]
#![forbid(unsafe_code)]
use bun_simd::{Target, limit_to};
use std::hint::black_box as bb;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering::Relaxed};

pub struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    /// Mostly values that are next to a power of two.
    fn edgy(&mut self) -> u64 {
        let r = self.next();
        if r & 3 == 0 {
            self.next()
        } else {
            ((1u64 << (r >> 8 & 63))
                .wrapping_add(r >> 16 & 3)
                .wrapping_sub(2))
                ^ (r >> 20 & 1).wrapping_neg()
        }
    }
}

const ROOM: usize = 4 * 4096;

#[bun_simd::foreach_target]
mod simd {
    use bun_simd::Array;
    use isa::{Lane, Lanes, Vec, spec};

    fn filled<T: Lane>(mut f: impl FnMut(usize) -> u64) -> Lanes<T> {
        let mut lanes = Lanes::<T>::zeros();
        lanes
            .as_mut()
            .iter_mut()
            .enumerate()
            .for_each(|(i, lane)| *lane = T::from_bits(f(i)));
        lanes
    }

    /// An op on lanes against the same on numbers, for `a` in `firsts` and every `b`.
    macro_rules! lane_ops {
        ($name:ident $T:ty; $($op:literal |$a:ident, $b:ident| $vector:expr, $scalar:expr;)*) => {
            fn $name(firsts: core::ops::Range<u64>) {
                const N: usize = Vec::<$T>::LANES;
                for first in firsts {
                    for second in (0..1u64 << <$T>::BITS).step_by(N) {
                        let xs = bb(filled::<$T>(|_| first));
                        let ys = bb(filled::<$T>(|i| second + (i as u64 + first) % N as u64));
                        $({
                            let ($a, $b) = (Vec::<$T>::load(&xs), Vec::<$T>::load(&ys));
                            let got = bb($vector.lanes());
                            let want: Lanes<$T> = core::array::from_fn(|i| {
                                let ($a, $b) = (xs[i], ys[i]);
                                $scalar
                            });
                            assert!(got == want, "{} {xs:?} {ys:?}", $op);
                        })*
                    }
                }
            }
        };
    }

    macro_rules! for_ints {
        ($($name:ident $T:ty;)*) => {$(lane_ops! { $name $T;
            "and" |a, b| a & b, a & b;
            "or" |a, b| a | b, a | b;
            "xor" |a, b| a ^ b, a ^ b;
            "add" |a, b| a + b, a.wrapping_add(b);
            "sub" |a, b| a - b, a.wrapping_sub(b);
            "min" |a, b| a.min(b), a.min(b);
            "max" |a, b| a.max(b), a.max(b);
            "eq" |a, b| a.eq(b).to_vec(), if a == b { !0 } else { 0 };
            "ne" |a, b| a.ne(b).to_vec(), if a != b { !0 } else { 0 };
            "gt" |a, b| a.gt(b).to_vec(), if a > b { !0 } else { 0 };
            "lt" |a, b| a.lt(b).to_vec(), if a < b { !0 } else { 0 };
            "saturating_add" |a, b| a.saturating_add(b), a.saturating_add(b);
            "saturating_sub" |a, b| a.saturating_sub(b), a.saturating_sub(b);
            "and of masks" |a, b| (a.gt(b) & a.gt(3)).select(1, 0), (a > b && a > 3) as $T;
            "or of masks" |a, b| (a.gt(b) | b.gt(3)).select(1, 0), (a > b || b > 3) as $T;
            "xor, not" |a, b| (a.gt(3) ^ !b.gt(3)).select(1, 0), ((a > 3) != (b <= 3)) as $T;
            "shifts" |a, b| ((a << 3) ^ (b >> 2)), (a << 3) ^ (b >> 2);
            "select" |a, b| a.gt(b).select(a, b + 1), if a > b { a } else { b.wrapping_add(1) };
        })*};
    }

    for_ints! { all_u8 u8; all_i8 i8; all_u16 u16; all_i16 i16; }

    lane_ops! { more_u8 u8;
        "widening_mul" |a, b| { let (x, y) = a.widening_mul(b); (x >> 4).truncate(y >> 4) },
            ((u16::from(a) * u16::from(b)) >> 4) as u8;
        "abs_diff" |a, b| a.abs_diff(b), a.abs_diff(b);
        "average_round" |a, b| a.average_round(b), (u16::from(a) + u16::from(b)).div_ceil(2) as u8;
    }

    fn sum_of_products(a: i16, b: i16) -> i16 {
        let ([a0, a1], [b0, b1]) = (a.to_le_bytes(), b.to_le_bytes().map(|b| b as i8));
        let sum = i32::from(a0) * i32::from(b0) + i32::from(a1) * i32::from(b1);
        sum.clamp(-32768, 32767) as i16
    }

    lane_ops! { more_i16 i16;
        "mul" |a, b| (a.cast::<u16>() * b.cast()).cast::<i16>(), a.wrapping_mul(b);
        "mul_add_pairs" |a, b| a.cast::<u8>().mul_add_pairs(b.cast()), sum_of_products(a, b);
    }

    #[export]
    pub fn pairs_of_16_bits(from: u64, to: u64) {
        all_u16(from..to);
        all_i16(from..to);
        more_i16(from..to);
    }

    /// The same text for the target and for the reference of its width.
    macro_rules! same {
        ($op:literal, |$m:ident| $e:expr) => {{
            let got = {
                use isa as $m;
                $e
            };
            let want = {
                use spec as $m;
                $e
            };
            assert!(got == want, "{}: {got:?} {want:?}", $op);
        }};
    }

    fn any_lanes<T: Lane + core::fmt::Debug>(r: &mut Rng) {
        use core::ops::{Add, BitAnd, BitOr, BitXor, Sub};
        let (a, b) = (bb(filled::<T>(|_| r.edgy())), bb(filled::<T>(|_| r.edgy())));
        let list = |lanes: Lanes<T>| lanes.as_ref().to_vec();
        macro_rules! both {
            ($($op:ident)*) => {
                $(same!("binary", |m| list(m::Vec::load(&a).$op(m::Vec::load(&b)).lanes()));)*
            };
        }
        both!(bitand bitor bitxor add sub min max saturating_add saturating_sub);
        macro_rules! tests {
            ($($op:ident)*) => {$(same!("test", |m| {
                let (a, b) = (m::Vec::<T>::load(&a), m::Vec::<T>::load(&b));
                let (mask, other) = (a.$op(b), (a + b).gt(b));
                let combined = [mask & other, mask | other, mask ^ other, !mask];
                (
                    list(mask.to_vec().lanes()),
                    [mask.any(), mask.all(), mask.none()],
                    [mask.first_true(), mask.last_true()],
                    combined.map(|mask| list(mask.select(a, b).lanes())),
                )
            });)*};
        }
        tests!(eq ne gt lt);
        same!("interleave", |m| {
            let (x, y) = m::Vec::<T>::load(&a).interleave(m::Vec::load(&b));
            [list(x.lanes()), list(y.lanes())]
        });
        same!("splat, iota", |m| [
            m::Vec::splat(a.as_ref()[0]),
            m::Vec::iota()
        ]
        .map(|v| list(v.lanes())));
        same!("cast", |m| (
            m::Vec::<T>::load(&a).cast::<u8>().lanes(),
            m::Vec::<T>::load(&a).cast::<u64>().lanes()
        ));
        for bits in 0..T::BITS {
            same!("shifts", |m| {
                let a = m::Vec::<T>::load(&a);
                [a << bb(bits), a >> bb(bits)].map(|v| list(v.lanes()))
            });
        }
    }

    #[export]
    pub fn pairs_of_bytes() {
        all_u8(0..256);
        all_i8(0..256);
        more_u8(0..256);
    }

    #[export]
    pub fn ops_on_all_inputs() {
        const N: usize = isa::BYTES;
        let distinct = filled::<u8>(|i| 100 + i as u64);

        for first in 0..=255 {
            for last in first..=255 {
                if last - first < 255 {
                    for from in (0..256).step_by(N) {
                        same!("in_range", |m| (m::U8::iota() + (from as u8))
                            .in_range(bb(first), bb(last))
                            .bits());
                    }
                }
            }
        }
        for index in (0..16).chain(128..=255) {
            for lane in 0..N {
                let indices = filled::<u8>(|i| if i == lane { index } else { 3 });
                same!("lookup", |m| m::U8::load(&distinct)
                    .lookup(m::U8::load(&indices))
                    .lanes());
            }
        }
        for bits in 0..1u64 << (N / 4) {
            same!("compress", |m| (m::U32::iota() + 7)
                .compress(bb(bits | 0b101 << (N / 4)))
                .lanes()[..bits.count_ones() as usize]
                .to_vec());
        }
        for lanes in 0..N / 4 {
            same!("slide_up", |m| m::U8::load(&distinct)
                .cast::<u32>()
                .slide_up(bb(lanes))
                .lanes());
        }
        for from in (0..1 << 16).step_by(N) {
            let (a, b) = (
                filled::<u16>(|i| (from + i) as u64),
                filled::<u16>(|i| (from + N / 2 + i) as u64),
            );
            same!("narrowing", |m| {
                let (a, b) = (m::U16::load(&a), m::U16::load(&b));
                (
                    a.truncate(b).lanes(),
                    a.cast::<i16>().demote(b.cast()).lanes(),
                )
            });
            for bits in 0..16 {
                same!("shr", |m| (
                    (m::U16::load(&a) >> bb(bits)).lanes(),
                    (m::U16::load(&b).cast::<i16>() >> bb(bits)).lanes()
                ));
            }
        }
        // All masks of 16 lanes, in each place.
        for bits in 0..1u64 << 16 {
            for at in (0..N).step_by(16) {
                let set = filled::<u8>(|i| bits << at >> i & 1);
                same!("masks", |m| {
                    let k = m::U8::load(&set).eq(1);
                    (
                        k.bits(),
                        k.any(),
                        k.all(),
                        k.first_true(),
                        k.last_true(),
                        (!k).bits(),
                    )
                });
            }
        }
        for len in 0..N {
            let text = &distinct[..len];
            same!("load_first", |m| m::U8::load_first(bb(text)).lanes());
            same!("store_first", |m| {
                let mut to = vec![0; len];
                m::U8::load(&distinct).store_first(bb(&mut to));
                to
            });
            same!("Short", |m| m::Short::load(bb(text)).map(|short| {
                let mut to = vec![0; len];
                m::Short::store(short.lanes + 1, &mut to);
                let each: std::vec::Vec<_> = text
                    .iter()
                    .map(|&b| {
                        let k = short.lanes.eq(b);
                        (short.bits(k), short.first(k), short.last(k))
                    })
                    .collect();
                (to, each, short.lanes.lanes())
            }));
        }
    }

    #[export]
    pub fn ops_on_random_inputs(rounds: u64) {
        const N: usize = isa::BYTES;
        let r = &mut Rng(88172645463325252);
        for _ in 0..rounds {
            any_lanes::<u8>(r);
            any_lanes::<i8>(r);
            any_lanes::<u16>(r);
            any_lanes::<i16>(r);
            any_lanes::<u32>(r);
            any_lanes::<i32>(r);
            any_lanes::<u64>(r);
            any_lanes::<i64>(r);
            let (a, b) = (
                bb(filled::<u64>(|_| r.edgy())),
                bb(filled::<u64>(|_| r.edgy())),
            );
            same!("u64", |m| {
                let (a, b) = (m::U64::load(&a), m::U64::load(&b));
                (
                    a.mul_low32(b).lanes(),
                    a.swap_pairs().lanes(),
                    a.reduce_sum(),
                )
            });
            same!("u8", |m| {
                let (a, b) = (m::U64::load(&a).cast::<u8>(), m::U64::load(&b).cast::<u8>());
                let (x, y) = a.deinterleave(b);
                (x.lanes(), y.lanes(), a.sums_of_8().lanes())
            });
            same!("i16", |m| m::U64::load(&a)
                .cast::<i16>()
                .mul_add_pairs(m::U64::load(&b).cast())
                .lanes());
            same!("32 bits", |m| {
                let (a, b) = (
                    m::U64::load(&a).cast::<i32>(),
                    m::U64::load(&b).cast::<i32>(),
                );
                (
                    a.min(b).lanes(),
                    a.max(b).lanes(),
                    a.cast::<u32>().min(b.cast()).lanes(),
                    a.cast::<u32>().max(b.cast()).lanes(),
                    (a >> 20).clamped_to_bytes(),
                    a.clamped_to_bytes(),
                )
            });
            let (first, last) = (r.edgy() as u16, r.edgy() as u16);
            let (first, last) = (first.min(last).max(1), first.max(last).max(1));
            same!("in_range", |m| m::U64::load(&a)
                .cast::<u16>()
                .in_range(first, last)
                .to_vec()
                .lanes());
            same!("f32", |m| {
                let (x, y) = (
                    m::F32::from_i32(m::U64::load(&a).cast::<i32>() >> 12),
                    m::F32::from_i32(m::U64::load(&b).cast::<i32>() >> 20),
                );
                let third = m::F32::splat(0.333);
                [
                    x + y,
                    x - y,
                    x * third,
                    x.mul_add(third, y),
                    x.clamp(-5.5, 300.25),
                ]
                .map(|v| (v * m::F32::splat(64.0)).to_i32().lanes())
            });
            same!("store_interleaved", |m| {
                let mut to = [[0; 2]; N];
                m::U64::load(&a)
                    .cast::<u8>()
                    .store_interleaved(m::U64::load(&b).cast(), &mut to);
                to
            });
            let bits = (r.next() & 63) as u32;
            same!("shr", |m| {
                let a = m::U64::load(&a);
                (
                    (a >> bits).lanes(),
                    (a.cast::<u32>() >> (bits & 31)).lanes(),
                    (a.cast::<i32>() >> (bits & 31)).lanes(),
                    (a.cast::<u8>() >> (bits & 7)).lanes(),
                )
            });
            let block: [u8; 64] = core::array::from_fn(|_| r.next() as u8);
            same!("bytes", |m| (
                m::bits_of(&block, |v| [v.gt(100), (v & 3).eq(0)]),
                m::U8::table(block.first_chunk().unwrap()).lanes(),
                m::I32::load_bytes(block.first_chunk().unwrap()).lanes(),
                m::prefix_xor(a[0])
            ));
            same!("whole", |m| {
                let v = m::U8::load(block.first_chunk().unwrap());
                (
                    v.widen_lower().lanes(),
                    v.cast::<u32>().first(),
                    v.cast::<u32>().splat_last().lanes(),
                    m::U32::from_first(a[0] as u32).lanes(),
                )
            });
            same!("128 bits", |m| {
                let v = m::x128::U8::load(block.first_chunk().unwrap());
                (
                    v.widen_lower().lanes(),
                    v.cast::<u32>().first(),
                    v.cast::<u32>().splat_last().lanes(),
                    m::x128::U32::from_first(a[0] as u32).lanes(),
                )
            });
        }
    }

    /// A page ends 128 bytes into it.
    #[inline(never)]
    fn around_end_of_page<T>(room: &mut [T]) -> &mut [T] {
        let end = (4096 - room.as_ptr().addr() % 4096 + 4096) / size_of::<T>();
        &mut room[end - 128 / size_of::<T>()..][..128 + 14 * isa::BYTES]
    }

    /// Far from the end of the page, and near it.
    fn starts(alignments: usize) -> impl Iterator<Item = usize> {
        let of_vector =
            move |from: usize| (from..from + isa::BYTES).step_by(isa::BYTES / alignments);
        of_vector(1).chain(of_vector(127 - isa::BYTES))
    }

    /// What the targets share with the reference, against plain code.
    #[export]
    pub fn shared_with_spec() {
        use isa::{Short, U8};
        const N: usize = isa::BYTES;
        let distinct = filled::<u8>(|i| 100 + i as u64);
        for len in 0..N {
            let (text, mut to) = (&distinct[..len], vec![0; len]);
            assert_eq!(
                U8::load_first(bb(text)).lanes(),
                filled::<u8>(|i| if i < len { 100 + i as u64 } else { 0 })
            );
            U8::load(&distinct).store_first(bb(&mut to));
            assert_eq!(to, text);
            let Some(short) = Short::load(bb(text)) else {
                assert_eq!(len, 0);
                continue;
            };
            Short::store(short.lanes + 1, &mut to);
            assert!(to.iter().zip(text).all(|(&to, &from)| to == from + 1));
            for i in 0..len {
                let k = short.lanes.eq(text[i]);
                assert_eq!(
                    (short.bits(k), short.first(k), short.last(k)),
                    (1 << i, Some(i), Some(i))
                );
            }
            let (none, all) = (short.lanes.lt(100), short.lanes.lt(200));
            assert_eq!(
                (short.bits(none), short.first(none), short.last(none)),
                (0, None, None)
            );
            assert_eq!(
                (short.bits(all), short.first(all), short.last(all)),
                ((1 << len) - 1, Some(0), Some(len - 1))
            );
            if len < N / 2 {
                let wide: std::vec::Vec<u16> = text.iter().map(|&b| 0x700 | u16::from(b)).collect();
                let lanes = Short::load(bb(&wide[..])).unwrap().lanes;
                Short::store(lanes.truncate(lanes), &mut to);
                assert_eq!(to, text);
            }
        }
        assert_eq!(
            (
                isa::U32::iota().splat_last().lanes(),
                (isa::U32::iota() + 5).first()
            ),
            ([N as u32 / 4 - 1; N / 4], 5)
        );
        let (x, y) = (isa::F32::splat(bb(7.0)), isa::F32::splat(bb(2.0)));
        assert_eq!(
            [x + y, x - y, x * y].map(|v| v.to_i32().lanes()[0]),
            [9, 5, 14]
        );
        let mut pairs = [[0; 2]; N];
        U8::load(&distinct).store_interleaved(U8::iota(), bb(&mut pairs));
        assert_eq!(pairs, core::array::from_fn(|i| [distinct[i], i as u8]));
        assert_eq!(
            U8::load(&distinct).cast::<u64>().reduce_sum(),
            distinct
                .as_chunks()
                .0
                .iter()
                .fold(0u64, |sum, &w| sum.wrapping_add(u64::from_le_bytes(w)))
        );
        let quads: [[u8; 4]; N] =
            core::array::from_fn(|i| core::array::from_fn(|c| (c * N + i) as u8));
        let (planes, mut back) = (U8::load_interleaved4(bb(&quads)), [[0; 4]; N]);
        for c in 0..4 {
            assert_eq!(planes[c].lanes(), filled::<u8>(|i| (c * N + i) as u64));
        }
        U8::store_interleaved4(planes, bb(&mut back));
        assert_eq!(back, quads);
        for bit in 0..64 {
            let block = core::array::from_fn(|i| u8::from(i == bit));
            assert_eq!(
                isa::bits_of(bb(&block), |v| [v.eq(1), v.eq(0)]),
                [1 << bit, !(1 << bit)]
            );
            assert_eq!(isa::prefix_xor(bb(1 << bit)), u64::MAX << bit);
        }
    }

    /// What surrounds the text matches too, so that looking at it shows.
    #[export]
    pub fn drivers(alignments: usize, step: usize) {
        const N: usize = isa::BYTES;
        let (mut buffer, mut out) = (vec![1u8; ROOM], vec![9u8; ROOM]);
        let (buffer, out) = (
            around_end_of_page(&mut buffer),
            around_end_of_page(&mut out),
        );
        for start in starts(alignments) {
            for len in (0..13 * N).step_by(step) {
                buffer[start..start + len].fill(0);
                for at in 0..=len {
                    let other = at + (len - at) / 2;
                    let hits = if at == len {
                        0
                    } else {
                        (buffer[start + at], buffer[start + other]) = (1, 1);
                        1 + usize::from(other != at)
                    };
                    let text = bb(&buffer[start..start + len]);
                    assert_eq!(isa::find_first(text, |v| v.eq(1)), at);
                    assert_eq!(isa::find_last(text, |v| v.eq(1)), other);
                    assert_eq!(isa::count(text, |v| v.eq(1)), hits);
                    assert_eq!(
                        isa::find_first_within(&buffer[start..], len, |v| v.eq(1)),
                        at
                    );
                    assert_eq!(isa::find_first_within(text, len + 3, |v| v.eq(1)), at);
                    assert_eq!(
                        isa::find_first_within(text, len / 2, |v| v.eq(1)),
                        at.min(len / 2)
                    );
                    if at != len {
                        (buffer[start + at], buffer[start + other]) = (0, 0);
                    }
                }
                let from: std::vec::Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
                for (from_len, to_len) in [(len, len), (len / 2, len), (len, len / 2)] {
                    out.fill(255);
                    isa::map(
                        bb(&from[..from_len]),
                        &mut out[start..start + to_len],
                        |v| v + 1,
                    );
                    let done = from_len.min(to_len);
                    assert!(out.iter().enumerate().all(|(i, &b)| b
                        == if (start..start + done).contains(&i) {
                            from[i - start] + 1
                        } else {
                            255
                        }));
                }
                buffer[start..start + len].fill(1);
            }
        }
        let mut wide = vec![1u16; ROOM];
        let wide = around_end_of_page(&mut wide);
        for start in starts(alignments).map(|start| start / 2) {
            for len in (0..6 * N).step_by(step) {
                wide[start..start + len].fill(0);
                for at in 0..=len {
                    if at != len {
                        wide[start + at] = 1;
                    }
                    let text = bb(&wide[start..start + len]);
                    assert_eq!(
                        (
                            isa::find_first(text, |v| v.eq(1)),
                            isa::find_last(text, |v| v.eq(1))
                        ),
                        (at, at)
                    );
                    if at != len {
                        wide[start + at] = 0;
                    }
                }
                let from: std::vec::Vec<u16> = (0..len).map(|i| 300 + i as u16).collect();
                isa::map(bb(&from), &mut wide[start..start + len], |v| v + 1);
                isa::map_in_place(bb(&mut wide[start..start + len]), |v| v + 1);
                assert!(wide.iter().enumerate().all(|(i, &w)| w
                    == if (start..start + len).contains(&i) {
                        from[i - start] + 2
                    } else {
                        1
                    }));
                wide[start..start + len].fill(1);
            }
        }
        let long = vec![1u8; 600 * N + 5];
        assert_eq!(isa::count(bb(&long), |v| v.eq(1)), long.len());
    }

    /// The same for memory that other threads may write to.
    #[export]
    pub fn drivers_on_shared_memory(alignments: usize, step: usize) {
        const N: usize = isa::BYTES;
        let (mut buffer, mut out) = (vec![1u8; ROOM], vec![9u8; ROOM]);
        let buffer = &*AtomicU8::from_mut_slice(around_end_of_page(&mut buffer));
        let out = &*AtomicU8::from_mut_slice(around_end_of_page(&mut out));
        let fill =
            |bytes: &[AtomicU8], byte: u8| bytes.iter().for_each(|to| to.store(byte, Relaxed));
        for start in starts(alignments) {
            for len in (0..13 * N).step_by(step) {
                let text = bb(&buffer[start..start + len]);
                fill(text, 0);
                for at in 0..=len {
                    let other = at + (len - at) / 2;
                    let set = |byte| {
                        if at != len {
                            text[at].store(byte, Relaxed);
                            text[other].store(byte, Relaxed);
                        }
                    };
                    set(1);
                    let hits = if at == len {
                        0
                    } else {
                        1 + usize::from(other != at)
                    };
                    assert_eq!(
                        (
                            isa::find_first(text, |v| v.eq(1)),
                            isa::find_last(text, |v| v.eq(1)),
                            isa::count(text, |v| v.eq(1))
                        ),
                        (at, other, hits)
                    );
                    set(0);
                }
                let from: std::vec::Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
                for (from_len, to_len) in [(len, len), (len / 2, len), (len, len / 2)] {
                    fill(out, 255);
                    let done = from_len.min(to_len);
                    isa::map_to_shared(bb(&from[..from_len]), &out[start..start + to_len], |v| {
                        v + 1
                    });
                    isa::map_to_shared(
                        bb(&out[start..start + done]),
                        &out[start..start + done],
                        |v| v + 1,
                    );
                    assert!(out.iter().enumerate().all(|(i, b)| b.load(Relaxed)
                        == if (start..start + done).contains(&i) {
                            from[i - start] + 2
                        } else {
                            255
                        }));
                    let mut back = vec![255; len];
                    isa::map(bb(&out[start..start + done]), &mut back, |v| v - 2);
                    assert!(back[..done] == from[..done] && back[done..].iter().all(|&b| b == 255));
                }
                fill(text, 1);
            }
        }
        let long: std::vec::Vec<_> = (0..600 * N + 5).map(|_| AtomicU8::new(1)).collect();
        assert_eq!(isa::count(bb(&long[..]), |v| v.eq(1)), long.len());
    }

    /// One byte comes and goes, and one stays. The search comes from the side of the first.
    #[export]
    pub fn race(
        text: &[AtomicU8],
        flickers: usize,
        rounds: usize,
    ) -> std::vec::Vec<(usize, usize)> {
        let is_before = text[flickers + 1..]
            .iter()
            .any(|byte| byte.load(Relaxed) == 1);
        let mut found = std::vec::Vec::new();
        for _ in 0..rounds {
            let at = if is_before {
                isa::find_first(text, |v| v.eq(1))
            } else {
                isa::find_last(text, |v| v.eq(1))
            };
            found.push((at, isa::count(text, |v| v.eq(1))));
        }
        found
    }
}

/// Runs `test` on each target that this machine has.
fn on_each_target(test: impl Fn(Target) + Sync) {
    std::thread::scope(|s| {
        for &target in Target::ALL.iter().filter(|target| target.is_supported()) {
            let test = &test;
            let thread = std::thread::Builder::new().name(target.name().into());
            let run = move || {
                limit_to(target);
                test(target);
            };
            thread.spawn_scoped(s, run).unwrap();
        }
    });
}

#[test]
fn pairs_of_bytes() {
    on_each_target(|_| simd::pairs_of_bytes());
}

#[test]
fn ops_on_all_inputs() {
    on_each_target(|_| simd::ops_on_all_inputs());
}

#[test]
fn ops_on_random_inputs() {
    on_each_target(|_| simd::ops_on_random_inputs(300));
}

#[test]
fn shared_with_spec() {
    on_each_target(|_| simd::shared_with_spec());
}

#[test]
fn some_pairs_of_16_bits() {
    on_each_target(|_| {
        for first in [0, 0x7F, 0xFF, 0x7FFE, 0xFF7F, 0xFFFC] {
            simd::pairs_of_16_bits(first, first + 4);
        }
    });
}

#[test]
#[ignore = "takes minutes"]
fn all_pairs_of_16_bits() {
    const PARTS: u64 = 16;
    std::thread::scope(|s| {
        for part in 0..PARTS {
            let [from, to] = [part, part + 1].map(|part| (part << 16) / PARTS);
            s.spawn(move || {
                on_each_target(|target| {
                    if !is_portable(target) {
                        simd::pairs_of_16_bits(from, to);
                    }
                })
            });
        }
    });
}

fn is_portable(target: Target) -> bool {
    target.name().starts_with("portable")
}

/// From one length to the next. The portable targets are slow.
fn step(target: Target) -> usize {
    if is_portable(target) { 29 } else { 1 }
}

#[test]
fn drivers() {
    on_each_target(|target| simd::drivers(2, step(target)));
}

#[test]
fn drivers_on_shared_memory() {
    on_each_target(|target| simd::drivers_on_shared_memory(2, step(target)));
}

#[test]
#[ignore = "takes minutes"]
fn more_of_the_others() {
    on_each_target(|target| {
        simd::ops_on_random_inputs(100_000);
        simd::drivers(16, step(target));
        simd::drivers_on_shared_memory(16, step(target));
    });
}

#[test]
fn searches_next_to_a_writer() {
    const CASES: [(usize, usize, usize); 6] = [
        (3, 0, 2),
        (7, 5, 1),
        (13, 2, 9),
        (40, 30, 3),
        (1200, 500, 900),
        (1200, 700, 300),
    ];
    on_each_target(|_| {
        for (len, flickers, stays) in CASES {
            let text: Vec<_> = (0..len)
                .map(|i| AtomicU8::new(u8::from(i == stays)))
                .collect();
            let done = AtomicBool::new(false);
            let found = std::thread::scope(|s| {
                s.spawn(|| {
                    while !done.load(Relaxed) {
                        text[flickers].fetch_xor(1, Relaxed);
                    }
                });
                let found = simd::race(&text, flickers, 2000);
                done.store(true, Relaxed);
                found
            });
            for (at, count) in found {
                assert!(at == flickers || at == stays, "{at}");
                assert!(count == 1 || count == 2, "{count}");
            }
        }
    });
}
