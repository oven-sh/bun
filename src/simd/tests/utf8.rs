//! Text from bytes, against `core`. src/simd/utf8.rs has the tests that go through all windows of four bytes.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
mod framework;
use bun_simd::{text::*, *};
use core::str::Utf8Error;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn after(bytes: &[u8], blocks: usize) -> Result<&str, Utf8Error> {
    let s: S = bun_simd::prelude::isa();
    let mut text = s.over(bytes).utf8();
    for (i, v) in text.by_ref().take(blocks).enumerate() {
        assert!(v == s.load::<u8, B64>(&bytes[64 * i..]));
    }
    assert_eq!(text.rest(), &bytes[64 * blocks.min(bytes.len() / 64)..]);
    text.finish()
}

#[test]
fn each_piece_at_each_place() {
    let pieces: [&[u8]; 22] = [
        b"", b"\xc2\x80", b"\xdf\xbf", b"\xe0\xa0\x80", b"\xed\x9f\xbf", b"\xef\xbf\xbf", b"\xf0\x90\x80\x80",
        b"\xf4\x8f\xbf\xbf", b"\x80", b"\xc1\xbf", b"\xc2", b"\xe0\x9f\xbf", b"\xe1\x80", b"\xe1", b"\xed\xa0\x80",
        b"\xf0\x8f\xbf\xbf", b"\xf1\x80\x80", b"\xf1\x80", b"\xf1", b"\xf4\x90\x80\x80", b"\xff", b"\xc2\x80\x80",
    ];
    let targets = if cfg!(miri) {
        framework::targets().split_off(0).into_iter().rev().take(1).collect()
    } else {
        framework::targets()
    };
    for (before, piece) in (0..200).step_by(if cfg!(miri) { 127 } else { 1 }).flat_map(|n| pieces.map(|it| (n, it))) {
        for (first, after_it, last) in ["", "é"].into_iter().flat_map(|a| {
            [0, 1, 2, 3, 15, 30, 61, 64, 130, 320].into_iter().flat_map(move |n| ["", "€"].map(|b| (a, n, b)))
        }) {
            let text = [first.as_bytes(), &vec![b'a'; before], piece, &vec![0; after_it], last.as_bytes()].concat();
            if cfg!(miri) && (after_it % 64 > 0 || after_it > 64 || first.is_empty() != last.is_empty()) {
                continue;
            }
            if cfg!(miri) && piece.len() % 3 > 0 {
                continue;
            }
            let want = core::str::from_utf8(&text);
            for &target in &targets {
                for blocks in [0, 1, 2, 9].into_iter().step_by(if cfg!(miri) { 3 } else { 1 }) {
                    assert_eq!(after::to(target, &text, blocks), Some(want), "{target:?} {text:?}");
                }
            }
            assert_eq!(from_utf8(&text), want);
            assert_eq!(target::baseline().over(&text).to_str(), want);
            assert_eq!(string_from_utf8(text.clone()), String::from_utf8(text));
        }
    }
}

#[test]
fn type_has_a_name() {
    let text: Utf8<'_, target::Portable> = target::Portable::new().over(b"a").utf8();
    assert_eq!(text.finish(), Ok("a"));
}

/// Quick enough for builds without optimization.
#[test]
fn an_error_in_each_block() {
    for (target, at, blocks) in framework::targets().into_iter().flat_map(|it| {
        [0, 63, 64, 130, 199].into_iter().flat_map(move |at| [0, 1, 2, 9].map(|blocks| (it, at, blocks)))
    }) {
        if cfg!(miri) && (at % 64 > 7 || blocks % 9 > 0) {
            continue;
        }
        let mut text = "é".repeat(50).into_bytes();
        text.extend((0..100).map(|i| b'0' + i % 64));
        assert_eq!(after::to(target, &text, blocks), Some(core::str::from_utf8(&text)), "{target:?}");
        text[at] = 0xff;
        assert_eq!(after::to(target, &text, blocks), Some(core::str::from_utf8(&text)), "{target:?} {at}");
        assert!(from_utf8(&text).is_err() && string_from_utf8(text).is_err());
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn long_texts() {
    for (target, len) in
        framework::targets().into_iter().flat_map(|it| [1279, 1280, 1345, 2367, 2432, 3600].map(|n| (it, n)))
    {
        for skip in 0..4 {
            let text = [&b"abc"[..skip], "😀é€".repeat(len / 9).as_bytes(), &b"012345678"[..len % 9]].concat();
            assert_eq!(after::to(target, &text, skip % 2), Some(core::str::from_utf8(&text)), "{target:?}");
            for at in (0..len).filter(|at| (at + 2) % 64 < 4) {
                let mut text = text.clone();
                text[at] ^= 0x40;
                assert_eq!(after::to(target, &text, skip % 2), Some(core::str::from_utf8(&text)), "{target:?} {at}");
            }
        }
    }
}
