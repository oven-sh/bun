//! store_partial_at to text: each length, width and target.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{mem::*, target::*, text::Ascii, *};
use core::mem::MaybeUninit;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn put<G: Sink<u8>>(width: usize, from: &[u8; 128], mut to: G, at: usize) {
    let s: S = bun_simd::prelude::isa();
    macro_rules! by { ($($n:literal $w:ident)*) => { match width { $($n => s.load::<u8, $w>(from).store_partial_at(&mut to, at),)* _ => unreachable!() } }; }
    by!(2 B2 4 B4 8 B8 16 B16 32 B32 64 B64 128 B128)
}

#[test]
fn each_length() {
    let from = core::array::from_fn(|i| (i * 37 + 11) as u8);
    let mark = bun_simd::text::Ascii::from_u8(b'#').unwrap();
    for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
        for width in [2, 4, 8, 16, 32, 64, 128] {
            for room in 0..=width + 2 {
                for at in [0, 1, 5] {
                    let want: Vec<u8> =
                        [&b"#####"[..at], &from[..room.min(width)]].concat().iter().map(|it| it & 127).collect();
                    let mut slice = vec![mark; at + room + 1];
                    if put::to(target, width, &from, &mut slice[..at + room], at).is_none() {
                        continue;
                    }
                    assert_eq!(Ascii::as_str(&slice[..want.len()]).as_bytes(), want, "{target:?} {width} {room} {at}");
                    assert!(slice[want.len()..].iter().all(|it| *it == mark), "{target:?} {width} {room} {at}");

                    let mut text = String::from("é");
                    let mut out = Output::append(&mut text, at + room);
                    out.push(&vec![mark; at + room]);
                    out.truncate(at);
                    put::to(target, width, &from, Sink::<u8>::part(&mut *out, ..), 0);
                    drop(out);
                    assert_eq!(text.as_bytes()[2..], want, "{target:?} {width} {room} {at}");

                    // A part ends before the room does, and forgets what came after.
                    let mut uninit = vec![MaybeUninit::<Ascii>::uninit(); at + room + 3];
                    let mut out = Output::new(&mut uninit);
                    let mut part = Sink::<u8>::part(&mut out, ..at + room);
                    for i in 0..at + room {
                        part.write(i, *b"#")
                    }
                    put::to(target, width, &from, part, at);
                    assert_eq!(out.into_str().as_bytes(), want, "{target:?} {width} {room} {at}");
                }
            }
        }
    }
}

#[test]
#[should_panic]
fn no_gap() {
    put(16, &[65; 128], &mut Output::append(&mut String::new(), 8), 1)
}

#[test]
#[should_panic]
fn not_past_the_end() {
    put(16, &[65; 128], &mut [bun_simd::text::Ascii::from_u8(b'#').unwrap(); 4][..], 5)
}
