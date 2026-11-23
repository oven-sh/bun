//! What is pushed needs room for what counts, and no more.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::needless_borrows_for_generic_args)]
use bun_simd::{mem::*, prelude::*, text::Ascii};

/// In each room, all or nothing.
#[simd]
#[inline(never)]
fn exact<T: Copy + PartialEq + core::fmt::Debug>(piece: impl Piece<T>, first: T, expected: &[T]) {
    let rooms = expected.len().saturating_sub(2)..expected.len() + if cfg!(miri) { 2 } else { 70 };
    for room in rooms.chain([0, 2000]) {
        let mut all = Box::new_uninit_slice(1 + room);
        let mut out = Output::new(&mut all);
        out.push_one(first);
        let fits = expected.len() <= room;
        assert_eq!(out.try_push(piece).is_some(), fits, "{room}");
        assert_eq!(out.filled()[1..], expected[..if fits { expected.len() } else { 0 }], "{room}");
        if fits {
            out.truncate(1);
            out.push(piece);
            assert_eq!(out.filled()[1..], *expected, "{room}");
            out.truncate(1);
            out.room_for(room).unwrap().push(piece);
            assert_eq!(out.filled()[1..], *expected, "{room}");
        }
        assert_eq!(out.filled()[0], first);
    }
}

#[kernel]
fn vectors<T: Unsigned, W: Width>(n: usize, bits: u64) {
    let (v, one) = (Simd::<T, W, S>::iota(T::of::<3>()), T::of::<1>());
    let lanes = v.to_array();
    let (lanes, ones) = (lanes.as_ref(), [one; 9]);
    let first = &lanes[..n.min(lanes.len())];
    let kept: Vec<T> = (0..lanes.len()).filter(|i| bits >> i & 1 != 0).map(|i| lanes[i]).collect();
    exact(v, one, lanes);
    exact(v.first_n(n), one, first);
    exact(v.first_n(n).first_n(1), one, &first[..n.min(1)]);
    exact(v.selected(bits), one, &kept);
    exact((one, v.first_n(n), &ones, v.selected(bits)), one, &[&ones[..1], first, &ones, &kept].concat());
    exact([v.selected(bits); 3], one, &kept.repeat(3));
    exact((v.first_n(n), lanes), one, &[first, lanes].concat());
    exact((lanes.first_n(n), one), one, &[first, &ones[..1]].concat());
    exact([v.first_n(n); 17], one, &first.repeat(17));
}

#[test]
fn on_all_targets() {
    macro_rules! each { ($($t:ty, $w:ty;)*) => {$(
        for target in vectors::targets() {
            for (n, bits) in [(0, 0), (1, 1), (3, !0), (7, 0x8000_8001_8181_00f6), (9, 2), (33, !1), (usize::MAX, 0x5555_5555_5555_5555)] {
                vectors::to::<$t, $w>(target, n, bits);
            }
        }
    )*}; }
    each!(u8, B4; u8, B16; u16, B32; u64, B8;);
    #[cfg(not(miri))]
    each!(u8, B8; u8, B32; u8, B64; u16, B128; u32, B16; u32, B64; u64, B64;);
}

#[kernel]
fn others(n: usize) {
    let (text, none): (&[u8], [u8; 0]) = (b"0123456789abcdefghij", []);
    let first = &text[..n.min(20)];
    exact(7u8, 1, &[7]);
    exact(7u8.first_n(n), 1, &[7][..n.min(1)]);
    exact(none, 1, &[]);
    exact((&none).first_n(n), 1, &[]);
    exact([text; 0], 1, &[]);
    let some = text.first_n(n);
    exact([some; 0], 1, &[]);
    exact(text, 1, text);
    let (vec, boxed, mut plain) = (first.to_vec(), Box::<[u8]>::from(first), first.to_vec());
    exact((&vec, &boxed, &first, &&mut plain[..]), 1, &first.repeat(4));
    exact(((&vec).first_n(3), (&boxed).first_n(3)), 1, &first[..n.min(3)].repeat(2));
    exact(text.first_n(n), 1, first);
    exact([text.first_n(n); 2], 1, &first.repeat(2));
    exact([[1u8, 2], [3, 4]], 1, &[1, 2, 3, 4]);
    exact(b"0123456789abcdefghij".first_n(n), 1, first);
    exact((&[5u8; 65]).first_n(n), 1, &[5; 65][..n.min(65)]);
    exact((&[5u8; 512]).first_n(n), 1, &[5; 512][..n.min(512)]);
    exact(&[5u8; 600], 1, &[5; 600]);
    exact((&[5u8; 600], 5u8.first_n(n)), 1, &[5; 601][..600 + n.min(1)]);
    exact(((1u8, 2), (3, (4, 5)), 6, 7, 8, 9), 1, &[1, 2, 3, 4, 5, 6, 7, 8, 9]);
    exact((&[[1u8, 2, 3]; 5]).first_n(n), [0; 3], &[[1, 2, 3]; 5][..n.min(5)]);
    exact((&[(); 5]).first_n(n), (), &[(); 5][..n.min(5)]);
    exact((&[(1u8, 2u32); 5]).first_n(n), (0, 0), &[(1, 2); 5][..n.min(5)]);
    let large = [[7u64; 3]; 5];
    exact(((&large).first_n(n), &large), [0; 3], &[[7; 3]; 10][..5 + n.min(5)]);
    let wide = u16x8::from([0x41, 0x4342, 0x44, 0x45, 0x4746, 0x48, 0x49, 0x4b4a]);
    exact(wide.low_bytes(wide.simd_gt(255)), 1, b"ABCDEFGHIJK");
    exact(wide.first_n(n).low_bytes(wide.simd_gt(255)), 1, &b"ABCDEFGHIJK"[..[0, 1, 3, 4, 5, 7, 8, 9, 11][n.min(8)]]);
    let (mut all, v) = (String::new(), u8x16::load(text) | 128);
    Output::<Ascii>::append(&mut all, 16 + n.min(16)).push((v.ascii(), v.ascii().first_n(n)));
    assert_eq!(all.as_bytes(), [&text[..16], &text[..n.min(16)]].concat());
}

#[test]
fn values_and_slices() {
    for target in others::targets() {
        for n in (0..23).step_by(if cfg!(miri) { 9 } else { 1 }).chain([511, usize::MAX]) {
            others::to(target, n);
        }
    }
}

#[test]
fn a_room_is_a_sink_and_is_used_up() {
    #[kernel]
    fn fill(out: &mut Output<'_, u8>) {
        let mut room = out.room_for(16).unwrap();
        over(&[7; 14]).map_into(&mut room, |v| v);
        room.push(u8x16::splat(8).first_n(2));
        assert_eq!(room.try_push(9), None);
    }
    let mut all = [0; 20];
    fill(&mut Output::overwrite(&mut all[..16]));
    assert_eq!(all[12..], [7, 7, 8, 8, 0, 0, 0, 0]);
}

#[test]
#[cfg_attr(target_family = "wasm", ignore = "needs unwinding")]
fn a_panic_leaves_no_part() {
    let mut all = Vec::new();
    let push = std::panic::AssertUnwindSafe(|| Output::append(&mut all, 2).push((1u8, &[2, 3][..])));
    assert!(std::panic::catch_unwind(push).is_err() && all.is_empty());
}

#[test]
fn more_than_a_room_counts_at_once() {
    static LONG: [u8; 65537] = [7; 65537];
    let mut all = Vec::new();
    let mut out = Output::append(&mut all, 2 * LONG.len() + 1);
    let mut room = out.room_for(2 * LONG.len()).unwrap();
    assert!(room.try_push(&LONG).is_some());
    let mut room = out.room_for(2).unwrap();
    room.push(&LONG);
    assert!(room.try_push(&LONG).is_none() && room.len() == 2 * LONG.len());
}
