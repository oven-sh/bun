//! The check in vectors by itself. What it refuses goes to `core`, so that no caller sees if it refuses too much.

extern crate std;
use crate::Target;
use crate::WithToken;
use crate::utf8::Check;
use std::{vec, vec::Vec};

#[crate::kernel(targets = crate::Targets::ALL)]
fn accepts(bytes: &[u8], blocks: usize) -> bool {
    let s = S::default();
    let (mut check, (blocks, rest)) = (Check::new(s), bytes.split_at(64 * blocks.min(bytes.len() / 64)));
    for block in blocks.as_chunks::<64>().0 {
        check.block(s.from(block));
    }
    check.ends_with(rest)
}

fn check(text: &[u8], blocks: usize) {
    let want = core::str::from_utf8(text).is_ok();
    for target in accepts::targets() {
        let always = target != Target::Portable
            || cfg!(any(
                target_feature = "sse2",
                all(target_arch = "aarch64", target_feature = "neon", target_endian = "little")
            ));
        let got = accepts::to(target, text, blocks).unwrap();
        assert!(got == want || !always && !got, "{target:?} {blocks} {text:?}");
    }
}

const PIECES: [&[u8]; 30] = [
    b"", b"\x7f", b"\xc2\x80", b"\xdf\xbf", b"\xdf\xbfa", b"\xe0\xa0\x80", b"\xed\x9f\xbf", b"\xee\x80\x80",
    b"\xef\xbf\xbf", b"\xef\xbf\xbfa", b"\xf0\x90\x80\x80", b"\xf4\x8f\xbf\xbf", b"\x80", b"\xc0\x80", b"\xc1\xbf",
    b"\xc2", b"\xe0\x9f\xbf", b"\xe0\xa0", b"\xe1", b"\xed\xa0\x80", b"\xf0\x8f\xbf\xbf", b"\xf0\x90\x80", b"\xf1\x80",
    b"\xf1", b"\xf4\x90\x80\x80", b"\xf5\x80\x80\x80", b"\xff", b"\xc2\x80\x80", b"\xdf\xbf\x80", b"\xef\xbf\xbf\x80",
];

#[test]
fn around_the_ends_of_registers() {
    for (i, (piece, end)) in
        PIECES.into_iter().flat_map(|it| [0usize, 16, 32, 48, 64, 128].map(|end| (it, end))).enumerate()
    {
        for (k, before) in (end.max(4) - 4..=end).enumerate().step_by(if cfg!(miri) { 5 } else { 1 }) {
            let (first, after, last) =
                (["", "é"][(i / 6 + k) % 2], [0, 1, 64, 70][(i / 6 + k) / 2 % 4], ["", "€"][(i / 6 + i + k) / 3 % 2]);
            let before = vec![b'a'; before.saturating_sub(first.len())];
            check(&[first.as_bytes(), &before, piece].concat(), (i + k) % 3);
            check(&[first.as_bytes(), &before, piece, &vec![0; after], last.as_bytes()].concat(), (i + k + 1) % 3);
        }
    }
}

#[test]
fn all_pairs() {
    for [a, b] in (0..=u16::MAX)
        .step_by(if cfg!(miri) { 4099 } else { 1 })
        .map(u16::to_le_bytes)
        .filter(|[a, b]| *a >= 0xc0 && b % 16 == a % 2 * 15)
    {
        check(&[&[a, b][..], &[0x80; 2][..a.leading_ones().clamp(2, 4) as usize - 2]].concat(), 0);
    }
}

/// The first bytes of a character end a block, and the others come after ASCII.
#[test]
fn with_a_gap() {
    for (whole, cut) in ["é", "€", "😀"].into_iter().flat_map(|it| (1..it.len()).map(move |cut| (it.as_bytes(), cut)))
    {
        for gap in [0, 1, 2, 3, 15, 16, 17, 31, 32, 33, 62, 63, 64, 65, 66, 127, 128, 129]
            .into_iter()
            .step_by(if cfg!(miri) { 7 } else { 1 })
        {
            for (blocks, after) in [0, 1, 2, 3].into_iter().flat_map(|it| [(it, 0), (it, 70)]) {
                check(
                    &[&vec![b'a'; 64 - cut], &whole[..cut], &vec![b'b'; gap], &whole[cut..], &vec![b'c'; after]]
                        .concat(),
                    blocks,
                );
                check(&[&vec![b'a'; 64 - cut], &whole[..cut], &vec![b'b'; gap]].concat(), blocks);
            }
        }
    }
}

/// One error doesn't undo another one in the same lane.
#[test]
fn twice() {
    for (piece, step, at) in PIECES
        .into_iter()
        .flat_map(|it| [64, 128].into_iter().flat_map(move |step| [5, 64 - it.len()].map(|at| (it, step, at))))
    {
        let mut text = vec![b'a'; 64 + 2 * step];
        for k in 0..2 {
            text[at + k * step..][..piece.len()].copy_from_slice(piece);
        }
        check(&text, 0);
        check(&text, 9);
    }
}

#[test]
fn long_texts() {
    let text: Vec<u8> = (0..400u32)
        .filter_map(|i| char::from_u32((i * 40503 % 0x110000) >> (i % 4 * 5)))
        .collect::<std::string::String>()
        .into();
    for len in (0..300).step_by(if cfg!(miri) { 99 } else { 1 }) {
        check(&text[..len], len % 4);
        check(&text[text.len() - len..], len % 4);
    }
}

/// From 256 bytes on, the blocks after the first are read at their places.
#[test]
fn at_each_place_of_a_long_text() {
    let pieces: [&[u8]; 9] = [
        b"\xc3\xa9", b"\xe2\x82\xac", b"\xf0\x9f\x98\x80", b"\x80", b"\xc3", b"\xe2\x82", b"\xf0\x9f\x98",
        b"\xed\xa0\x80", b"\xff",
    ];
    for (at, piece) in (58..200).step_by(if cfg!(miri) { 71 } else { 1 }).flat_map(|at| pieces.map(|it| (at, it))) {
        let mut text = vec![b'a'; 330];
        text[..2].copy_from_slice("é".as_bytes());
        text[at..][..piece.len()].copy_from_slice(piece);
        check(&text, 0);
        // No block is ASCII.
        for block in [64, 128, 192] {
            let free = block + 8 + at % 3 * 20;
            if free + 2 <= at || at + piece.len() <= free {
                text[free..][..2].copy_from_slice("ß".as_bytes());
            }
        }
        check(&text, 0);
    }
    for len in [255, 256, 257, 319, 320, 321, 383, 384, 385, 511, 512] {
        let text = "é€".repeat(103).into_bytes();
        check(&text[..len], 0);
        check(&text[text.len() - len..], 1);
        check(&[&text[..len - len % 5], b"\x80"].concat(), 0);
    }
}

/// Nor does one in the same lane of another register of a block, with only ASCII around them.
#[test]
fn twice_in_a_block() {
    for (at, step) in (64..192).step_by(if cfg!(miri) { 61 } else { 5 }).flat_map(|at| [16, 32, 48].map(|it| (at, it)))
    {
        let mut text = vec![b'a'; 400];
        text[..2].copy_from_slice("é".as_bytes());
        (text[at], text[at + step]) = (0x80, 0x80);
        check(&text, 0);
        check(&text, 9);
    }
}

/// Only ASCII comes after it, which is not looked at byte by byte.
#[test]
fn each_byte_at_the_end_of_a_block() {
    for (byte, at) in
        (0x80..=0xff).step_by(if cfg!(miri) { 64 } else { 1 }).flat_map(|it| [60, 61, 62, 63].map(|at| (it, at)))
    {
        let mut text = vec![b'a'; 128];
        text[at..64].fill(0x80);
        text[at] = byte;
        check(&text, 0);
        check(&text, 2);
        check(&text[..64], 1);
    }
}
