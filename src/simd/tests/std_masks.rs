//! The names that come from std::simd::Mask, and the classes of ASCII.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn each(m: &Model, f: impl Fn(usize) -> bool) -> Lanes {
    m.mask(f)
}
fn ascii(m: &Model, f: fn(&u8) -> bool) -> Lanes {
    m.mask(|i| u8::try_from(m.a[i]).is_ok_and(|it| f(&it)))
}
fn case(x: i128, f: fn(&u8) -> u8) -> i128 {
    u8::try_from(x).map_or(x, |it| f(&it) as i128)
}

cases! {
    arrays all 0..=64, |d, a, b, _, io| {
        let mut lanes = a.to_mask().to_array();
        let seen: Vec<u8> = lanes.into_iter().map(u8::from).collect();
        lanes[io.up_to(d.lanes() - 1)] ^= true;
        (seen, [d.mask_from_array(lanes), b.to_mask()])
    } => |m| [m.each(|i| m.ma[i] as _), each(m, |i| m.ma[i] ^ (i == m.io.up_to(m.n - 1))), each(m, |i| m.mb[i])].concat();
    set sint 0..=64, |d, a, _, _, io| {
        let (mut x, mut y, i) = (a.is_negative(), a.is_negative(), io.up_to(d.lanes() - 1));
        x.set(i, io.n >> 9 & 1 == 1);
        y.set(d.lanes() - 1, true);
        y.set(0, false);
        [x, y]
    } => |m| [each(m, |i| if i == m.io.up_to(m.n - 1) { m.io.n >> 9 & 1 == 1 } else { m.ma[i] }), each(m, |i| i > 0 && (m.ma[i] || i == m.n - 1))].concat();
    moves sint 0..=64, |d, a, _, _, _| { let (x, n) = (a.is_negative(), d.lanes());
        [x.reverse(), x.rotate_elements_left::<0>(), x.rotate_elements_left::<1>(), x.rotate_elements_right::<1>(), x.swizzle(#[inline(always)] |i| i * 3 % n)] }
        => |m| [each(m, |i| m.ma[m.n - 1 - i]), each(m, |i| m.ma[i]), each(m, |i| m.ma[(i + 1) % m.n]), each(m, |i| m.ma[(i + m.n - 1) % m.n]), each(m, |i| m.ma[i * 3 % m.n])].concat();
    rotate_by_3 sint 32..=64, |d, a, _, _, _| [a.is_negative().rotate_elements_left::<3>(), a.is_negative().rotate_elements_right::<3>()]
        => |m| [each(m, |i| m.ma[(i + 3) % m.n]), each(m, |i| m.ma[(i + m.n - 3) % m.n])].concat();
    interleave sint 2 * LANE..=64, |d, a, b, _, _| (a.is_negative().interleave(b.is_negative()), a.is_negative().deinterleave(b.is_negative())) => |m| {
        let both = [&m.ma[..], &m.mb].concat();
        let of = |i: usize| if i % 2 == 0 { m.ma[i / 2] } else { m.mb[i / 2] };
        [each(m, of), each(m, |i| of(m.n + i)), each(m, |i| both[2 * i]), each(m, |i| both[2 * i + 1])].concat()
    };
    resize sint 0..=64, |d, a, _, _, _| { let x = a.is_negative(); ((x.resize::<B8>(), x.resize::<B16>()), (x.resize::<B32>(), (x.resize::<B64>(), x.resize::<B128>().count()))) } => |m| {
        let to = |bytes: usize| (0..bytes / m.t.size()).map(|i| -((i < m.n && m.ma[i]) as i128)).collect::<Lanes>();
        [to(8), to(16), to(32), to(64), vec![-to(128).iter().sum::<i128>()]].concat()
    };
    classes uint 0..=64, |d, a, _, _, _| [a.is_ascii(), a.is_ascii_alphabetic(), a.is_ascii_uppercase(), a.is_ascii_lowercase(), a.is_ascii_alphanumeric(), a.is_ascii_digit(),
        a.is_ascii_octdigit(), a.is_ascii_hexdigit(), a.is_ascii_punctuation(), a.is_ascii_graphic(), a.is_ascii_whitespace(), a.is_ascii_control()]
        => |m| [u8::is_ascii, u8::is_ascii_alphabetic, u8::is_ascii_uppercase, u8::is_ascii_lowercase, u8::is_ascii_alphanumeric, u8::is_ascii_digit,
            |it: &u8| matches!(it, b'0'..=b'7'), u8::is_ascii_hexdigit, u8::is_ascii_punctuation, u8::is_ascii_graphic, u8::is_ascii_whitespace, u8::is_ascii_control].map(|f| ascii(m, f)).concat();
    classes_of_small uint 0..=64, |d, a, _, _, _| { let a = a & T::of::<0xff>(); [a.is_ascii_alphanumeric(), a.is_ascii_hexdigit(), a.is_ascii_punctuation(), a.is_ascii_whitespace(), a.is_ascii_control()] }
        => |m| [u8::is_ascii_alphanumeric, u8::is_ascii_hexdigit, u8::is_ascii_punctuation, u8::is_ascii_whitespace, u8::is_ascii_control].map(|f| each(m, |i| f(&(m.a[i] as u8)))).concat();
    cases uint 0..=64, |d, a, b, c, _| { let (x, y) = (a & T::of::<0x7f>(), a & T::of::<0x7f>() ^ b & T::of::<0x20>() ^ c & b & T::of::<0x41>());
        ([a.to_ascii_lowercase(), a.to_ascii_uppercase(), x.to_ascii_lowercase(), x.to_ascii_uppercase()], [a.eq_ignore_ascii_case(b), x.eq_ignore_ascii_case(y)]) }
        => |m| [m.map1(|x| case(x, u8::to_ascii_lowercase)), m.map1(|x| case(x, u8::to_ascii_uppercase)), m.map1(|x| case(x & 0x7f, u8::to_ascii_lowercase)), m.map1(|x| case(x & 0x7f, u8::to_ascii_uppercase)),
            each(m, |i| case(m.a[i], u8::to_ascii_lowercase) == case(m.b[i], u8::to_ascii_lowercase)),
            each(m, |i| (m.a[i] as u8 & 0x7f).eq_ignore_ascii_case(&((m.a[i] & 0x7f ^ m.b[i] & 0x20 ^ m.c[i] & m.b[i] & 0x41) as u8)))].concat();
    case_of_a_number uint 0..=64, |d, a, b, c, _| { let (n, x) = (b & T::of::<0x7f>(), a & T::of::<0x21>() ^ (b & T::of::<0x7f>())[0]); [a.eq_ignore_ascii_case(c[0]), x.eq_ignore_ascii_case(n[0]), (a & T::of::<0x20>() ^ c[0]).eq_ignore_ascii_case(c[0])] }
        => |m| { let same = |x, y| case(x, u8::to_ascii_lowercase) == case(y, u8::to_ascii_lowercase);
            [each(m, |i| same(m.a[i], m.c[0])), each(m, |i| same(m.a[i] & 0x21 ^ m.b[0] & 0x7f, m.b[0] & 0x7f)), each(m, |i| same(m.a[i] & 0x20 ^ m.c[0], m.c[0]))].concat() };
}

#[test]
#[cfg_attr(not(panic = "unwind"), ignore = "needs unwinding")]
fn types() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let lanes: Bools<u32, B16> = [true, false, false, true];
        assert_eq!(mask32x4::from_array(lanes).to_bitmask(), 9);
        assert!(mask32x4::from_array(lanes).to_array()[3]);
        assert!(std::panic::catch_unwind(|| mask32x4::splat(true).set(4, true)).is_err());
    }
    on::<bun_simd::target::Baseline>()
}

#[test]
#[cfg_attr(not(panic = "unwind"), ignore = "needs unwinding")]
fn classes_from_members() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let mut x = 1u64;
        let mut next = || {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (x >> 33) as usize
        };
        let mut made = 0;
        for _ in 0..20000 {
            let (mut all, mut sets, mut free) = (ByteClasses::EMPTY, vec![], 0xffu8);
            while free != 0 {
                let bits = free & next() as u8 | free.isolate_lowest_one();
                let (rows, columns) = (next() % 16, next() % 16);
                let members: Vec<u8> =
                    (0..next() % 12).map(|_| (next() & rows << 4 | next() & columns) as u8).collect();
                free &= !bits;
                let different = |of: fn(u8) -> (u8, u8)| {
                    let mut all = [0u16; 16];
                    for &it in &members {
                        all[of(it).0 as usize] |= 1 << of(it).1
                    }
                    all.iter().filter(|it| **it != 0).collect::<std::collections::HashSet<_>>().len()
                };
                let enough = different(|it| (it >> 4, it & 15)).min(different(|it| (it & 15, it >> 4)))
                    <= bits.count_ones() as usize;
                match std::panic::catch_unwind(|| all.with(bits, ByteSet::of(&members))) {
                    Ok(more) => {
                        all = more;
                        sets.push((bits, members));
                        made += 1
                    }
                    Err(_) => assert!(!enough),
                }
            }
            for first in (0..=255).step_by(16) {
                let got = all.classes(u8x16::iota(first)).to_array();
                for (byte, got) in (first..=first + 15).zip(got) {
                    assert_eq!(got, all.classes_of(byte));
                    for (bits, members) in &sets {
                        assert_eq!(got & bits != 0, members.contains(&byte));
                    }
                }
            }
        }
        assert!(made > 20000);
        assert!(
            std::panic::catch_unwind(|| ByteClasses::EMPTY.with(3, ByteSet::of(b"a")).with(1, ByteSet::of(b"b")))
                .is_err()
        );
        // Nine different rows, of which one is the union of two others. And nine with four columns.
        ByteClasses::new(&[0..=0, 17..=17, 34..=34, 51..=51, 68..=68, 85..=85, 102..=102, 119..=119, 128..=129]);
        ByteClasses::EMPTY.with(15, ByteSet::of(&[0, 1, 0x11, 0x12, 0x22, 0x23, 0x30, 0x32, 0x41, 0x43, 0x50, 0x53]));
    }
    on::<bun_simd::target::Baseline>()
}
