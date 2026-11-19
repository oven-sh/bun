//! Every kernel on every target, against a plain loop or the portable target.
#![forbid(unsafe_code)]
mod common;
use bun_simd::{Appender, Out, SharedOutU8, SharedU8, Target};
use bun_simd::{extend_vec, limit_to, limit_to_with};
use bun_simd_kernels::image::{self, Filter};
use bun_simd_kernels::sourcemap::{self, Columns, MappingsState};
use bun_simd_kernels::zlib::{MATCH_SPAN, copy_match, push_match, subtract_saturating};
use bun_simd_kernels::{self as kernels, json, png, websocket, xml};
use common::{check, check_against_portable, random, sample, targets};
use core::array::from_fn;
use core::cell::Cell;
use core::f64::consts::PI;
use core::fmt::Debug;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};
use std::sync::Arc;

/// Each has an allocation of its exact size.
fn texts(alphabet: &[u8]) -> impl Iterator<Item = Vec<u8>> {
    let mut below = random();
    let (short, longer): (_, &[_]) = match cfg!(miri) {
        true => (1, &[5, 70]),
        false => (200, &[255, 256, 257, 260, 1100, 4500]),
    };
    let lengths = (0..short).chain(longer.iter().copied());
    lengths.map(move |len| (0..len).map(|_| alphabet[below(alphabet.len())]).collect())
}

fn all_bytes() -> Vec<u8> {
    (0..=255).collect()
}

const MIXED: &[u8] = b"abAZ\"\\\n {},0F</&\xff";

fn atomic(bytes: &[u8]) -> Vec<AtomicU8> {
    bytes.iter().map(|&byte| AtomicU8::new(byte)).collect()
}

fn from_shared<R>(bytes: &[u8], kernel: impl FnOnce(&[SharedU8]) -> R) -> R {
    kernel(SharedU8::from_slice(&atomic(bytes)))
}

/// The result, and what has become of `bytes`.
fn to_shared<R>(bytes: &[u8], kernel: impl FnOnce(&[AtomicU8]) -> R) -> (R, Vec<u8>) {
    let bytes = atomic(bytes);
    (
        kernel(&bytes),
        bytes.into_iter().map(AtomicU8::into_inner).collect(),
    )
}

/// In an allocation of that size, which is not initialized.
fn filled<T: Copy>(len: usize, kernel: impl for<'a> FnOnce(Out<'a, T>) -> &'a mut [T]) -> Vec<T> {
    let mut out = Vec::with_capacity(len);
    bun_simd::extend_vec(&mut out, len, kernel);
    out
}

/// What it returns, if it leaves the rest of the room as it is.
fn prefix<T: Copy + PartialEq + Debug>(
    mut room: Vec<T>,
    kernel: impl for<'a> FnOnce(Out<'a, T>) -> &'a mut [T],
) -> Vec<T> {
    let before = room.clone();
    let len = kernel(room[..].as_mut().into()).len();
    assert_eq!(room[len..], before[len..]);
    room.truncate(len);
    room
}

/// Some have the low byte of a character that they are not.
fn widened(bytes: &[u8]) -> Vec<u16> {
    let unit = |(i, &byte): (usize, &u8)| u16::from(byte) | u16::from(i % 5 == 4) << (8 + i % 8);
    bytes.iter().enumerate().map(unit).collect()
}

fn texts_to_search() -> impl Iterator<Item = Vec<u8>> {
    let rare =
        b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaF/<.;*$`#\x1B\x9B\x91'";
    let bytes = sample(0..=255, 256).map(|byte| vec![b'a', byte]);
    texts(MIXED).chain(texts(rare)).chain(bytes)
}

#[test]
fn searches() {
    type First = fn(&[u8]) -> Option<usize>;
    #[rustfmt::skip]
    let firsts: [(First, fn(u8) -> bool); 17] = [
        (|t| from_shared(t, |t| kernels::index_of_char_shared(t, b'F')), |b| b == b'F'),
        (|t| kernels::index_of_char(t, b'F'), |b| b == b'F'),
        (|t| kernels::index_of_not_char(t, b'a'), |b| b != b'a'),
        (|t| kernels::index_of_any_char(t, b"F0"), |b| b"F0".contains(&b)),
        (|t| kernels::index_of_any_char(t, b"F0\xff"), |b| b"F0\xff".contains(&b)),
        (|t| kernels::index_of_any_char(t, b"F0,<"), |b| b"F0,<".contains(&b)),
        (|t| kernels::index_of_any_char(t, b"F\x91,\xff"), |b| b"F\x91,\xff".contains(&b)),
        (|t| kernels::index_of_interesting_character_in_string_literal(t, b'"'),
            |b| b"\"\\".contains(&b) || !(0x20..=0x7E).contains(&b)),
        (|t| kernels::index_of_needs_escape_for_javascript_string(t, b'\''),
            |b| b"'\\".contains(&b) || !(0x20..=0x7E).contains(&b)),
        (|t| kernels::index_of_needs_escape_for_javascript_string(t, b'`'),
            |b| b"`$\\".contains(&b) || !(0x20..=0x7E).contains(&b)),
        (kernels::index_of_interesting_character_in_multiline_comment,
            |b| b"*\r\n".contains(&b) || b > 0x7F),
        (kernels::index_of_newline_or_non_ascii, |b| !(0x20..=0x7F).contains(&b)),
        (kernels::index_of_space_or_newline_or_non_ascii, |b| !(0x21..=0x7F).contains(&b)),
        (kernels::index_of_newline_or_non_ascii_or_hash_or_at,
            |b| b"#@".contains(&b) || !(0x20..=0x7F).contains(&b)),
        (kernels::index_of_non_ascii, |b| b > 0x7F),
        (kernels::index_of_ascii_upper, |b| b.is_ascii_uppercase()),
        (kernels::index_of_html_escape, |b| b"<>&'\"".contains(&b)),
    ];
    #[rustfmt::skip]
    let lasts: [(First, &[u8]); 8] = [
        (|t| from_shared(t, |t| kernels::last_index_of_char_shared(t, b'F')), b"F"),
        (|t| kernels::last_index_of_char(t, b'F'), b"F"),
        (|t| kernels::last_index_of_any_char(t, b"F0"), b"F0"),
        (|t| kernels::last_index_of_any_char(t, b"F0<"), b"F0<"),
        (|t| kernels::last_index_of_any_char(t, b"F0,<"), b"F0,<"),
        (|t| kernels::last_index_of_any_char(t, b"F\x91,\xff"), b"F\x91,\xff"),
        (kernels::last_index_of_slash, b"/"),
        (kernels::last_index_of_slash_or_dot, b"/."),
    ];
    #[rustfmt::skip]
    let counts: [(fn(&[u8]) -> usize, &[u8]); 3] = [
        (|t| kernels::count_char(t, b'a'), b"a"),
        (kernels::count_slashes, b"/"),
        (sourcemap::count_delimiters, b",;"),
    ];
    // Miri gets those that read shared memory, as they come first.
    for t in texts_to_search() {
        for (kernel, test) in sample(firsts, 8) {
            check(t.iter().position(|&b| test(b)), || kernel(&t));
        }
        for (kernel, set) in sample(lasts, 6) {
            check(t.iter().rposition(|b| set.contains(b)), || kernel(&t));
        }
        for (kernel, set) in sample(counts, 3) {
            check(t.iter().filter(|b| set.contains(b)).count(), || kernel(&t));
        }
        check(
            t.iter()
                .any(|b| !(0x20..=0x7F).contains(b) || b"\"".contains(b)),
            || kernels::contains_newline_or_non_ascii_or_quote(&t),
        );
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn searches_in_both_encodings() {
    let escapes = *b"\x1B\x90\x98\x9B\x9C\x9D\x9E\x9F";
    let is_escape = |unit: &u16| escapes.map(u16::from).contains(unit);
    let extra = |&unit: &u16| match u8::try_from(unit) {
        Ok(b'<' | b'>') => 3,
        Ok(b'&') => 4,
        Ok(b'"' | b'\'') => 5,
        _ => 0,
    };
    // Far from the start, a cheaper test comes first. It holds for none or all of the others.
    let among = |it| [b'a', 0x11].map(|other| [&[other; 600][..], &[it], &[other; 300]].concat());
    let far = escapes.into_iter().flat_map(among);
    for t in texts_to_search().chain(far).chain([vec![b'"'; 1100]]) {
        let latin1: Vec<u16> = t.iter().map(|&b| b.into()).collect();
        check(latin1.iter().position(is_escape), || {
            kernels::index_of_ansi_escape(&t)
        });
        check(latin1.iter().map(extra).sum(), || {
            kernels::html_escape_extra_len(&t)
        });
        for wide in [latin1, widened(&t)] {
            check(wide.iter().position(|&unit| unit == 0x46), || {
                kernels::index_of_char16(&wide, 0x46)
            });
            check(wide.iter().rposition(|&unit| unit == 0x46), || {
                kernels::last_index_of_char16(&wide, 0x46)
            });
            check(wide.iter().position(is_escape), || {
                kernels::index_of_ansi_escape16(&wide)
            });
            check(wide.iter().map(extra).sum(), || {
                kernels::html_escape_extra_len16(&wide)
            });
            check(wide.iter().position(|unit| extra(unit) != 0), || {
                kernels::index_of_html_escape16(&wide)
            });
            check(wide.iter().position(|&unit| unit > 0x7F), || {
                kernels::index_of_non_ascii16(&wide)
            });
            check(
                wide.iter().position(|unit| (0x41..=0x5A).contains(unit)),
                || kernels::index_of_ascii_upper16(&wide),
            );
            check(
                wide.iter()
                    .filter(|unit| (0x20..=0x7E).contains(*unit))
                    .count(),
                || kernels::count_printable_ascii16(&wide),
            );
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn sets() {
    let all = all_bytes();
    let both = |text: &[u8], set: &[u8]| {
        let first = kernels::index_of_any_char(text, set);
        (first, kernels::last_index_of_any_char(text, set))
    };
    for (at, &byte) in all.iter().enumerate() {
        for len in 1..=5 {
            check((Some(at), Some(at)), || both(&all, &vec![byte; len]));
        }
        check((Some(at), Some(255)), || both(&all, &[byte, 255, 255, 255]));
        check((Some(at), Some(255)), || both(&all, &[byte, byte, 255]));
        check((Some(at), Some(255)), || both(&all, &[255, byte, byte]));
        check((Some(0), Some(at)), || both(&all, &[0, 0, 0, byte]));
        let others = [&all[..at], &all[at + 1..]].concat();
        check((None, None), || both(&[byte; 40], &others));
    }
    check((None, None), || both(&all, &[]));
}

/// At an odd address.
fn in_pairs<R>(units: &[u16], kernel: impl FnOnce(&[[SharedU8; 2]]) -> R) -> R {
    let bytes = units.iter().flat_map(|unit| unit.to_le_bytes());
    let bytes: Vec<u8> = [0].into_iter().chain(bytes).collect();
    from_shared(&bytes, |it| kernel(it[1..].as_chunks().0))
}

/// Forward and back.
type Searches<T> = [&'static [fn(&[T], &[T]) -> Option<usize>]; 2];

const SEARCHES: Searches<u8> = [
    &[kernels::memmem, |a, b| {
        from_shared(a, |a| from_shared(b, |b| kernels::memmem_shared(a, b)))
    }],
    &[kernels::memrmem, |a, b| {
        from_shared(a, |a| from_shared(b, |b| kernels::memrmem_shared(a, b)))
    }],
];

const SEARCHES16: Searches<u16> = [
    &[|a, b| in_pairs(a, |a| in_pairs(b, |b| kernels::memmem16_shared(a, b)))],
    &[kernels::memrmem16, |a, b| {
        in_pairs(a, |a| in_pairs(b, |b| kernels::memrmem16_shared(a, b)))
    }],
];

fn check_memmem<T: PartialEq>(widen: fn(u8) -> T, [forward, back]: Searches<T>) {
    let check_both = |text: &[u8], needle: &[u8]| {
        let [text, needle] =
            [text, needle].map(|it| it.iter().map(|&b| widen(b)).collect::<Vec<_>>());
        let places = || (0..=text.len()).filter(|&at| text[at..].starts_with(&needle));
        for (want, kernels) in [(places().next(), forward), (places().next_back(), back)] {
            kernels
                .iter()
                .for_each(|kernel| check(want, || kernel(&text, &needle)));
        }
    };
    for t in texts(b"ab").chain(texts(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab")) {
        for len in sample([0, 1, 2, 3, 5, 9, 16, 17, 32, 33, 40], 4).map(|len| t.len().min(len)) {
            check_both(&t, &t[..len]);
            check_both(&t, &t[t.len() - len..]);
        }
        check_both(&t, b"bb");
        check_both(&t, b"aaaaabbaaaaa");
        check_both(&t, b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac");
    }
    // All but one unit match.
    for (len, at) in (1..40).flat_map(|len| (0..len).map(move |at| (len, at))) {
        let (needle, mut almost) = (&all_bytes()[1..=len], all_bytes()[..=len + 1].to_vec());
        almost[1 + at] = 0;
        check_both(&almost, needle);
        check_both(&[&almost, &[0; 700][..], &almost].concat(), needle);
    }
    // The ends match all the time, and parts of the needle follow.
    let mut below = random();
    for _ in 0..1500 {
        let period: Vec<u8> = (0..=below(8))
            .map(|i| b"abc"[below(3).min(2 * i)])
            .collect();
        let len = 16usize.next_multiple_of(period.len()) + 1;
        let (mut needle, mut text) = (period.repeat(len)[..len].to_vec(), vec![b'a'; 90]);
        needle[1 + below(len - 2)] ^= [0, 3][below(2)];
        while text.len() < 156 {
            let from = below(2) * below(len);
            text.extend(&needle[from..=from + below(len - from)]);
        }
        text.truncate(156);
        text.extend(&needle[..below(2) * len]);
        check_both(&[&text, &[b'a'; 90][..]].concat(), &needle);
    }
    // Far from both ends, with units that are rare, common, and common only alone.
    for needle in [
        &b"xy"[..],
        b"ax",
        b"xa",
        b"aaxaa",
        b"abxab",
        b"bb",
        b"aabaaaaaaaaaaaaaaaaaaaxb",
    ] {
        for at in sample([1500, 1535, 1536, 1537, 2047, 2300, 2999], 3) {
            for before in 0..3 {
                let mut text = b"ab".repeat(2500 + at % 40);
                text[at..][..needle.len()].copy_from_slice(needle);
                check_both(&text[before..], needle);
                text[at + needle.len() / 2] = b'c';
                check_both(&text[before..], needle);
            }
        }
    }
    // Where one part of the search hands over to the next.
    let near = (20..140).chain(
        [96, 160, 192, 288, 320, 576]
            .map(|at| at - 4..at + 4)
            .into_iter()
            .flatten(),
    );
    for at in near.chain((0..2).flat_map(|i| 1990 << i..2100 << i)) {
        for (other, failed) in [(0, 0), (1, 0), (40, 1), (700, 0), (700, 2), (70, 50)] {
            let mut text = [&vec![b'x'; at][..], b"xyz", &vec![b'x'; other]].concat();
            (2..at)
                .step_by(31)
                .take(failed)
                .for_each(|i| text[i] = b'z');
            check_both(&text, b"xyz");
            text.reverse();
            check_both(&text, b"zyx");
        }
    }
    // It does so only if much follows.
    for (at, other) in (0..2).flat_map(|i| (1990 << i..2100 << i).map(move |at| (at, 6500 << i))) {
        for other in [other - at % 600, other] {
            let mut text = [&vec![b'x'; at][..], b"xyz", &vec![b'x'; other]].concat();
            check_both(&text, b"xyz");
            text.reverse();
            check_both(&text, b"zyx");
        }
    }
    // One unit is rare, wherever it is.
    for (letters, len) in [
        (&b"ab"[..], 33),
        (b"aaaaaaab", 64),
        (b"abcd", 300),
        (b"ab", 9),
    ] {
        for at in sample([0, 1, len / 2, len - 2, len - 1], 2) {
            let mut needle: Vec<u8> = (0..len).map(|_| letters[below(letters.len())]).collect();
            needle[at] = b'x';
            for before in [0, 70, 300, 2000, 9000] {
                let mut side = |len| (0..len).map(|_| letters[below(letters.len())]).collect();
                let [a, b]: [Vec<u8>; 2] = [side(before), side(before)];
                check_both(&[&a[..], &needle, &b].concat(), &needle);
                check_both(&[&a[..], &needle[1..], &b, b"x"].concat(), &needle);
            }
        }
    }
    // Records that start alike.
    for (alike, len) in sample([(3, 9), (8, 20), (16, 17), (16, 40), (20, 30), (70, 80)], 3) {
        let unit = |i: usize| {
            if i < alike {
                b'a' + i as u8
            } else {
                b"01"[below(2)]
            }
        };
        let text: Vec<u8> = (0..len).cycle().take(80 * len).map(unit).collect();
        for (at, records) in (0..77).step_by(4).zip([1, 2, 3].into_iter().cycle()) {
            check_both(&text, &text[at * len..][..records * len]);
            check_both(&text, &text[at * len + alike..][..records * len]);
        }
    }
    // No unit is rare.
    for letters in [&b"abcd"[..], b"0123456789abcdef"] {
        let text: Vec<u8> = (0..6000).map(|_| letters[below(letters.len())]).collect();
        for (at, len) in (0..5900)
            .step_by(59)
            .zip([3, 6, 9, 16, 17, 40].into_iter().cycle())
        {
            check_both(&text, &text[at..][..len]);
        }
    }
    // No two units tell the places apart, so it goes on with another algorithm.
    for len in sample([4, 7, 8, 9, 15, 16, 17, 18, 25, 33, 40, 70], 3) {
        for period in [&b"a"[..], b"ab", b"aab"] {
            let needle = &period.repeat(len)[..len];
            let broken = [&needle[1..], b"c", &needle[..len - 1], b"c"]
                .concat()
                .repeat(1500 / len);
            check_both(&broken, needle);
            check_both(&[&broken[..], needle, &broken].concat(), needle);
            let ends = [b"b", needle, b"b"].concat();
            check_both(&[&broken[..], &ends, &broken].concat(), &ends);
        }
    }
    for (end, joined) in (0..6).flat_map(|end| (0..500).map(move |joined| (end, joined))) {
        let mut text = b"aaaaac".repeat(500);
        text[6 * joined + 5] = b'a';
        check_both(&text[end..3000 - end], b"aaaaaa");
    }
    for (len, joined) in [40, 150]
        .into_iter()
        .flat_map(|len| (0..60).map(move |it| (len, it)))
    {
        let mut text = [&vec![b'a'; len - 1][..], b"c"].concat().repeat(60);
        text[len * joined + len - 1] = b'a';
        check_both(&text, &vec![b'a'; len]);
        let needle = &b"abcdefghijklm".repeat(12)[..len];
        let mut text = b"abcdefghijklm".repeat(5 * len);
        (0..text.len())
            .step_by(len - 13)
            .for_each(|i| text[i] = b'#');
        text.splice(len * joined..len * joined, needle.iter().copied());
        check_both(&text, needle);
    }
    // Where it is split depends on the direction.
    for (len, runs) in [51, 107, 203]
        .map(|len| (1..30).map(move |it| (len, it)))
        .into_iter()
        .flatten()
    {
        let needle = &b"aabb".repeat(51)[..len];
        let side = [&needle[..len - 4], b"#"].concat().repeat(runs);
        check_both(&[&side, needle, b"#", &side].concat(), needle);
    }
    for (at, copies) in [67, 135]
        .map(|at| (10..60).step_by(3).map(move |it| (at, it)))
        .into_iter()
        .flatten()
    {
        let mut needle = [b'a'; 203];
        needle[at] = b'b';
        let mut side = needle.repeat(copies);
        (0..copies).for_each(|i| side[204 * i + 67] ^= 3);
        check_both(&[&side[..], &needle, &side].concat(), &needle);
    }
    let runs = b"aaaaaaaaaaaaaaaaaaac".repeat(100);
    (600..2000).for_each(|len| check_both(&runs[7..len], &[b'a'; 20]));
    // The unit that is rare in the text is not rare in the needle.
    let needle = [vec![0; 150], vec![1; 300], vec![0; 150]].concat();
    for one_in in [2, 3, 32] {
        let noise = (0..20_000).map(|_| 2 * u8::from(below(one_in) == 0));
        let noise: Vec<u8> = noise.collect();
        check_both(&[&noise[..], &needle, &noise].concat(), &needle);
    }
    for _ in 0..400 {
        let (len, period, letters) = (20 + below(20), 1 + below(40), 2 + below(2));
        let needle: Vec<u8> = (0..period).map(|_| b"abc"[below(letters)]).collect();
        let mut needle = needle.repeat(len)[..len].to_vec();
        needle[len - 1 - below(16)] = b"abc"[below(3)];
        for is_forward in [true, false] {
            let (mut almost, mut parts) = (vec![], vec![]);
            for i in 0..90 {
                almost.extend(&needle);
                almost[(i + 1) * len - 1 - i % (len - 16)] = b'x';
            }
            while parts.len() < 200 {
                let (from, to) = (below(2) * below(len), len - below(2) * below(len));
                let start = parts.len();
                parts.extend(&needle[from.min(to)..to.max(from)]);
                if let Some(it) = parts.get_mut(start + below(2 * len)) {
                    *it = b'a';
                }
            }
            let mut both = [almost, parts];
            both.rotate_left(usize::from(!is_forward));
            check_both(&both.concat(), &needle);
        }
    }
    for period in sample([&b"ab"[..], b"abb", b"abcabd"], 3) {
        let (text, mut needle) = (period.repeat(200), period.repeat(10));
        needle[5 * period.len()] = b'b';
        check_both(&text, &needle);
        check_both(&[&text[..], &needle, &text].concat(), &needle);
        check_both(
            &[&text[..], &needle, &needle, &text].concat(),
            &needle.repeat(2),
        );
    }
    check_both(&all_bytes().repeat(2), &all_bytes()[236..]);
    // Many near copies, then the needle.
    let fib = b"abaababaabaababaababaabaababaa";
    let (near, dots) = ([&b"#"[..], &fib[1..]].concat().repeat(60), vec![b'.'; 7024]);
    check_both(&[&near[..], &dots, fib].concat(), fib);
    check_both(&[fib, &dots[..], &near].concat(), fib);
    let needle = &b"bcaab".repeat(13)[..63];
    let cut = |i: usize| &needle[..62 - i % 7];
    let ends: Vec<u8> = (0..100).flat_map(|i| [cut(i), b"#"].concat()).collect();
    check_both(&[&ends[..], needle].concat(), needle);
    let middles: Vec<u8> = (0..100)
        .flat_map(|i| [&needle[..31], b"#", &cut(i)[32..]].concat())
        .collect();
    check_both(&[needle, &middles[..]].concat(), needle);
    // After many false candidates: several matches next to each other, and one near either end.
    for (len, rest) in [3, 9, 31, 33, 70, 140]
        .map(|len| (0..70).map(move |it| (len, it)))
        .into_iter()
        .flatten()
    {
        let needle = [
            &vec![b'a'; len / 2][..],
            b"b",
            &vec![b'a'; len - len / 2 - 1],
        ]
        .concat();
        let (many, few) = (vec![b'a'; 700], vec![b'a'; rest]);
        check_both(&[&many[..], &needle, &few].concat(), &needle);
        check_both(&[&few[..], &needle, &many].concat(), &needle);
        check_both(
            &[&many[..], &needle, &few, &needle, &needle, &many].concat(),
            &needle,
        );
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn memmem() {
    check_memmem(|b| b, SEARCHES);
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn memmem16() {
    check_memmem(|b| u16::from(b) << 7, SEARCHES16);
    check_memmem(|b| u16::from(b) | 0x8000, SEARCHES16);
}

/// Does not end unless the time is linear.
fn check_long_needles<T: Copy + From<u8>>(searches: Searches<T>) {
    let [a, b, c] = b"abc".map(T::from);
    let mut needle = [a, b].repeat(1 << 20);
    let text = needle.repeat(4);
    needle.swap(1 << 20, (1 << 20) + 1);
    for search in searches.concat() {
        check(None, || search(&text, &needle));
    }

    let (needle, mut text) = (&text[..=1 << 21], text.clone());
    (1..=4).for_each(|i| text[(i << 21) - 1] = c);
    for search in searches.concat() {
        check(None, || search(&text, needle));
    }

    let mut text = b"defghijklmnopqrs".map(T::from).repeat(1 << 19);
    let needle = text[..1 << 21].to_vec();
    (1..=4).for_each(|i| text[(i << 21) - 100] = c);
    for search in searches.concat() {
        check(None, || search(&text, &needle));
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn memmem_of_long_needles() {
    check_long_needles(SEARCHES);
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn memmem16_of_long_needles() {
    check_long_needles(SEARCHES16);
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn paths() {
    let ends = (0..=255).flat_map(|it| [[b'a', it, b'a'], [b'a', b'/', it], [b'/', b'.', it]]);
    let ends = ends.flat_map(|end| [0, 70].map(|len| [&vec![b'a'; len][..], &end].concat()));
    let mixed = texts(b"//..ab").chain(texts(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/.\xE9"));
    let parts: [&[u8]; 7] = [b"\xE9", b"/", b"//", b"/.", b"/..", b"/.a/..", b"/...\xE9"];
    let parts = (0..140).flat_map(|len| parts.map(|end| [&vec![b'a'; len][..], end].concat()));
    let untidy = |t: &[u8], or_non_ascii: bool| {
        let is_untidy = |at: usize| {
            let part = t[at + 1..].iter().take_while(|&&b| b != b'/');
            let is_dots = [&b""[..], b".", b".."].contains(&&part.copied().collect::<Vec<_>>()[..]);
            t[at] == b'/' && at + 1 < t.len() && is_dots || or_non_ascii && t[at] > 0x7F
        };
        (0..t.len()).find(|&at| is_untidy(at))
    };
    for t in mixed.chain(ends).chain(parts) {
        check(untidy(&t, false), || kernels::index_of_untidy_slash(&t));
        check(untidy(&t, true), || {
            kernels::index_of_untidy_slash_or_non_ascii(&t)
        });
        for len in [t.len(), t.len() / 2, t.len() / 7] {
            check(len, || kernels::common_prefix_len(&t, &t[..len]));
            check(len, || kernels::common_prefix_len(&t[..len], &t));
            check(len, || {
                let other = t.get(len).map_or(0, |byte| byte ^ 1 << (len % 8));
                kernels::common_prefix_len(&[&t[..len], &[other], &t].concat(), &t)
            });
        }
    }
    // As `path.normalize` calls it: once more after each part that it finds.
    for t in texts(b"//..ab/.a/a/aa") {
        let mut rest = &t[..];
        while let Some(at) = untidy(rest, false) {
            check(Some(at), || kernels::index_of_untidy_slash(rest));
            rest = &rest[at + 1..];
        }
        check(None, || kernels::index_of_untidy_slash(rest));
    }
}

fn is_visible(byte: u8) -> bool {
    !matches!(byte, ..0x20 | 0x7F..0xA0 | 0xAD)
}

fn width_without_escapes(mut text: &[u8]) -> usize {
    let mut width = 0;
    while let [first, rest @ ..] = text {
        let (ends, body): (fn(u8) -> bool, _) = match text {
            [0x1B, b'[', body @ ..] | [0x9B, body @ ..] => (|b| (0x40..=0x7E).contains(&b), body),
            [0x1B, b']', body @ ..] | [0x9D, body @ ..] => (|b| b == 7, body),
            [0x1B, b'P' | b'X' | b'^' | b'_', body @ ..] => (|_| false, body),
            [0x90 | 0x98 | 0x9E | 0x9F, body @ ..] => (|_| false, body),
            [0x1B, 0x20..=0x2F, body @ ..] => (|_| true, body),
            [0x1B, 0x30..=0x7E, ..] => (|_| true, rest),
            _ => {
                (width, text) = (width + usize::from(is_visible(*first)), rest);
                continue;
            }
        };
        let end = body
            .iter()
            .position(|&b| ends(b) || [0x18, 0x1A, 0x1B, 0x9C].contains(&b));
        text = match end.map(|end| &body[end..]) {
            Some(next @ [0x1B, ..]) | Some([_, next @ ..]) => next,
            _ => &[],
        };
    }
    width
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn widths() {
    let dense = b"\x1B\x1B\x1B[[]]\\0;m a\x07\x18\x1A\x9B\x9C\x9D\x90\x91P_(\x7F\xAD\xE9";
    let sparse =
        b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000000000000000000000000000;;\x1B\x1B[]P\x07\x9B";
    let others = [all_bytes(), [&[0x1B; 64][..], b"[mab"].concat()];
    for t in texts(dense).chain(texts(sparse)).chain(others) {
        check(t.iter().filter(|&&b| is_visible(b)).count(), || {
            kernels::visible_latin1_width(&t)
        });
        check(width_without_escapes(&t), || {
            kernels::visible_latin1_width_exclude_ansi(&t)
        });
    }
    // Each kind starts at each place around the end of a block, also inside of another.
    let starts: [&[u8]; 14] = [
        b"\x1B[",
        b"\x1B]",
        b"\x1BP",
        b"\x1B(",
        b"\x1B",
        b"\x9B",
        b"\x9D",
        b"\x90",
        b"\x9D\x9D",
        b"\x9D\x9B",
        b"\x9B\x9D",
        b"\x90\x9B",
        b"\x1B\x9D",
        b"\x1B(\x9B",
    ];
    let ends: [&[u8]; 3] = [b"m\x07z\x1B\\yy", b"mz\x07y\x1B\\yy", b"\x070mz\x1B\\yy"];
    for (start, end) in starts.iter().flat_map(|start| ends.map(|end| (start, end))) {
        for (before, len) in sample((60..66).flat_map(|it| [(it, 0), (it, 150)]), 7) {
            for first in [&b""[..], b"\x01"] {
                let t = [first, &vec![b'a'; before], start, &vec![b'0'; len], end].concat();
                check(width_without_escapes(&t), || {
                    kernels::visible_latin1_width_exclude_ansi(&t)
                });
            }
        }
    }

    let width = |unit: u16| match unit {
        0xA9 | 0xAD | 0xAE => 0,
        0x20..=0x7E | 0xA0..=0x2FF | 0x370..=0x482 | 0x48A..=0x52F => 1,
        0x3041..=0x3096 | 0x309B..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF => 2,
        0xAC00..=0xD7A3 | 0xFF01..=0xFF60 => 2,
        _ => 0,
    };
    let all_units: Vec<u16> = sample(0..=u16::MAX, 3001).collect();
    let mut rest = &all_units[..];
    while !rest.is_empty() {
        let len = rest.iter().take_while(|&&unit| width(unit) != 0).count();
        let want = (len, rest[..len].iter().map(|&unit| width(unit)).sum());
        check(want, || kernels::visible_utf16_width(rest));
        check(want, || kernels::visible_utf16_width(&rest[..len]));
        rest = &rest[rest.len().min(len + 1)..];
    }
    for (ascii, unit) in [0, 1, 3, 6, 7, 8, 16, 33, 150]
        .into_iter()
        .flat_map(|ascii| all_units.iter().map(move |&unit| (ascii, unit)))
    {
        let t = [vec![0x61; ascii], vec![unit]].concat();
        let want = (ascii + width(unit).min(1), ascii + width(unit));
        check(want, || kernels::visible_utf16_width(&t));
    }
    for t in texts(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbb\n") {
        let wide: Vec<u16> = t
            .iter()
            .map(|&b| u16::from(b) + u16::from(b == b'b') * 0x4E00)
            .collect();
        let len = wide.iter().take_while(|&&unit| width(unit) != 0).count();
        check(
            (len, wide[..len].iter().map(|&unit| width(unit)).sum()),
            || kernels::visible_utf16_width(&wide),
        );
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn each_byte_in_each_escape() {
    let after_esc = (*b"[]PX^_(\\7").map(|byte| vec![0x1B, byte]);
    let alone = (*b"\x1B\x90\x98\x9B\x9D\x9E\x9F[a").map(|byte| vec![byte]);
    for start in after_esc.into_iter().chain(alone) {
        for (before, byte) in (0..=255).flat_map(|byte| [0, 61, 62, 63, 64].map(|it| (it, byte))) {
            for first in [&b""[..], b"\x01"] {
                let t = [
                    first,
                    &vec![b'a'; before],
                    &start,
                    &[byte][..],
                    b"0z\x070\x1B\\yy",
                ];
                let t = t.concat();
                check(width_without_escapes(&t), || {
                    kernels::visible_latin1_width_exclude_ansi(&t)
                });
            }
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn one_escape_at_each_place() {
    let lengths = (60..200).chain([255, 256, 257, 258, 319, 320, 321, 512, 513, 514, 577]);
    for (len, line) in lengths.flat_map(|len| [(len, 7), (len, 999)]) {
        let plain = Vec::from_iter((1..=len).map(|i| if i % line == 0 { b'\n' } else { b'a' }));
        for (at, odd) in (0..len).flat_map(|at| [(at, &b"\t"[..]), (at, b"\x1B[1m")]) {
            let t = [&plain[..at], odd, &plain[at..]].concat();
            check(width_without_escapes(&t[..len]), || {
                kernels::visible_latin1_width_exclude_ansi(&t[..len])
            });
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn each_byte_far_from_escapes() {
    let around = [(0, 0), (1, 0), (0, 1), (20, 41), (20, 42), (70, 300)];
    for (byte, (before, after)) in (0..=255).flat_map(|byte| around.map(|it| (byte, it))) {
        for other in *b"a\n" {
            let t = [vec![other; before], vec![byte], vec![other; after]].concat();
            check(t.iter().filter(|&&b| is_visible(b)).count(), || {
                kernels::visible_latin1_width(&t)
            });
            check(width_without_escapes(&t), || {
                kernels::visible_latin1_width_exclude_ansi(&t)
            });
        }
    }
    for (start, len) in (62..66).flat_map(|len| (*b"]P").map(|it| (it, len))) {
        let t = [&[0x1B, start][..], &vec![b'0'; len], b"\x91", &[b'0'; 40]].concat();
        check(0, || kernels::visible_latin1_width_exclude_ansi(&t));
    }
    for len in 500..756 {
        let t = [vec![b'a'; len], vec![1; 600]].concat();
        check(len, || kernels::visible_latin1_width_exclude_ansi(&t));
    }
    // Four in one lane.
    for (start, last) in [(0x1B, 50), (0x1B, 52), (0x9B, 50), (0x9B, 52)] {
        let mut t = [b'a'; 62];
        [4, 20, 36, last].into_iter().for_each(|at| t[at] = start);
        check(54, || kernels::visible_latin1_width_exclude_ansi(&t));
    }
}

#[test]
fn lines_and_runs() {
    for t in texts(MIXED).chain([all_bytes()]) {
        let after_newlines = (1..=t.len()).filter(|&at| t[at - 1] == b'\n');
        let want: Vec<u32> = [0]
            .into_iter()
            .chain(after_newlines)
            .map(|at| at as u32)
            .collect();
        check(want, || kernels::line_starts(&t));

        let stops = |goes_on: fn(u8) -> bool| {
            let mut plane = vec![[0; 8]; t.len().div_ceil(64)];
            for at in 0..64 * plane.len() {
                let is_stop = !t.get(at).is_some_and(|&b| goes_on(b));
                plane.as_flattened_mut()[at / 8] |= u8::from(is_stop) << (at % 8);
            }
            plane
        };
        let want = [
            stops(|b| b.is_ascii_alphanumeric() || b"_$".contains(&b)),
            stops(|b| b" \t".contains(&b)),
            stops(|b| (0x20..0x80).contains(&b) && !b"\"'`$\\".contains(&b)),
        ];
        check(want, || {
            let mut planes = [(); 3].map(|()| vec![[0; 8]; t.len().div_ceil(64)]);
            kernels::scanner_run_stops(&t, planes.each_mut().map(|plane| &mut plane[..]));
            planes
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn long_line() {
    let t = [vec![b'a'; 1 << 22], vec![b'\n']].concat();
    check(vec![0, t.len() as u32], || kernels::line_starts(&t));
}

#[test]
fn byte_bits() {
    for t in texts(MIXED).chain([all_bytes(), vec![0; 70], vec![0xFF; 70]]) {
        for byte in [0, b'\n', 0xFF] {
            let mut want = vec![0; t.len().div_ceil(64)];
            for (at, &it) in t.iter().enumerate() {
                want[at / 64] |= u64::from(it == byte) << (at % 64);
            }
            check(want, || {
                let mut bits = vec![0xA5; 3];
                kernels::byte_bits(&t, byte, &mut bits);
                bits
            });
        }
    }
}

#[test]
fn odd_blocks() {
    let odd = (0..=255)
        .map(|byte| (byte, 70))
        .chain([63, 64, 4095, 4096, 4200].map(|at| (1, at)));
    for (byte, at) in sample(odd, 256) {
        let (mut t, mut want) = (vec![b'a'; at + 1], vec![0; at / 4096 + 1]);
        let is_plain = (0x20..=0x7E).contains(&byte) && byte != b'\\' || b"\t\n\r".contains(&byte);
        (t[at], want[at / 4096]) = (byte, u64::from(!is_plain) << (at / 64 % 64));
        check(want, || {
            filled(at / 4096 + 1, |out| kernels::odd_blocks(&t, out))
        });
    }
    check(vec![0b111], || {
        filled(1, |out| kernels::odd_blocks(&[1; 130], out))
    });
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn byte_set() {
    let ranges = [9..=9, 32..=33, 35..=91, 93..=126, 128..=250, 252..=255];
    let set = kernels::ByteSet::new(&ranges);
    for byte in 0..=255 {
        let is_member = ranges.iter().any(|range| range.contains(&byte));
        assert_eq!(set.contains(byte), is_member, "{byte}");
        for at in [0, 15, 16, 63, 64, 130] {
            let mut t = vec![b'a'; at + 1];
            t[at] = byte;
            check(at + usize::from(is_member), || set.prefix_len(&t));
        }
    }
    for len in 0..210 {
        for at in 0..=len {
            let t = [vec![b'a'; at], vec![b'\r'; len - at]].concat();
            check(at, || set.prefix_len(&t));
        }
    }
}

#[test]
fn byte_set_of_ranges_that_overlap() {
    let set = kernels::ByteSet::new(&[3..=40, 30..=50]);
    for byte in 0..=255 {
        assert_eq!(set.contains(byte), (3..=50).contains(&byte));
    }
}

fn diagonal(rows: u8) -> kernels::ByteSet {
    kernels::ByteSet::new(&Vec::from_iter((0..rows).map(|row| 17 * row..=17 * row)))
}

#[test]
fn byte_set_with_eight_patterns() {
    let set = diagonal(8);
    for byte in 0..=255 {
        assert_eq!(set.contains(byte), byte % 17 == 0 && byte < 8 * 17);
    }
}

#[test]
#[should_panic = "bits < 8"]
fn byte_set_with_nine_patterns() {
    diagonal(9);
}

fn check_swap<const N: usize>(t: &[u8], kernel: fn(&[AtomicU8])) {
    let mut swapped = t.to_vec();
    swapped
        .as_chunks_mut::<N>()
        .0
        .iter_mut()
        .for_each(|word| word.reverse());
    check(swapped, || to_shared(t, kernel).1);
}

fn rooms(len: usize) -> [usize; 4] {
    [len, len / 2, len + 3, len + 70]
}

/// What follows the result stays as it is.
fn check_written<T>(want: &[u8], from: &[T], kernel: impl Fn(&[T], &mut [u8]) -> usize) {
    for room in sample(rooms(from.len()), 4) {
        let (want, ones) = (&want[..room.min(want.len())], vec![0xFF; room]);
        check((want.len(), [want, &ones[want.len()..]].concat()), || {
            let mut out = ones.clone();
            (kernel(from, &mut out), out)
        });
    }
}

fn check_shared_prefix<T>(want: &[u8], from: &[T], kernel: fn(&[T], &[SharedOutU8]) -> usize) {
    check_written(want, from, |from, out| {
        kernel(from, Out::from(out).into_shared())
    });
}

fn check_prefix<T>(
    want: &[u8],
    from: &[T],
    kernel: for<'a> fn(&[T], Out<'a, u8>) -> &'a mut [u8],
    kernel_to_shared: fn(&[T], &[SharedOutU8]) -> usize,
) {
    for room in sample(rooms(from.len()).into_iter().rev(), 2) {
        check(want[..room.min(want.len())].to_vec(), || {
            filled(room, |out| kernel(from, out))
        });
    }
    check_written(want, from, |from, out| kernel(from, out.into()).len());
    check_shared_prefix(want, from, kernel_to_shared);
}

#[test]
fn conversions() {
    for t in texts(MIXED) {
        let len = t.len();
        let wide: Vec<u16> = t.iter().map(|&b| u16::from(b) | 0x100).collect();
        let masked: Vec<u8> = (0..len).map(|i| t[i] ^ [1, 2, 3, 4][i % 4]).collect();
        check_prefix(
            &t,
            &wide,
            kernels::copy_u16_to_u8,
            kernels::copy_u16_to_shared,
        );
        for room in sample([len / 2, len, len + 3], 2) {
            check(masked[..room.min(len)].to_vec(), || {
                filled(room, |out| websocket::mask([1, 2, 3, 4], &t, out))
            });
            check(masked[..room.min(len)].to_vec(), || {
                filled(room, |out| {
                    from_shared(&t, |t| websocket::mask_from_shared([1, 2, 3, 4], t, out))
                })
            });
        }
        check(masked, || {
            let mut out = t.clone();
            websocket::mask_in_place([1, 2, 3, 4], &mut out);
            out
        });

        let hex: Vec<u8> = t
            .iter()
            .flat_map(|b| format!("{b:02x}").into_bytes())
            .collect();
        check(hex.clone(), || {
            filled(2 * len, |out| kernels::encode_hex_lower(&t, out))
        });
        check(hex.clone(), || {
            filled(2 * len, |out| {
                from_shared(&t, |t| kernels::encode_hex_lower_from_shared(t, out))
            })
        });
        for (hex, valid) in [
            (hex.to_ascii_uppercase(), len),
            ([&hex[..len], b"g", &hex[..]].concat(), len / 2),
        ] {
            let (want, wide) = (&t[..valid], widened(&hex));
            check_prefix(
                want,
                hex.as_chunks().0,
                kernels::decode_hex,
                kernels::decode_hex_to_shared,
            );
            check_prefix(
                want,
                wide.as_chunks().0,
                kernels::decode_hex16,
                kernels::decode_hex16_to_shared,
            );
        }
        check(t.to_ascii_lowercase(), || {
            filled(len, |out| kernels::lower_ascii(&t, out))
        });
        let ascii: Vec<u8> = t.iter().map(|b| b & 0x7F).collect();
        for kernel in [
            kernels::copy_ascii_prefix_to_shared,
            kernels::copy_short_ascii_prefix_to_shared,
        ] {
            check_shared_prefix(&ascii, &ascii, kernel);
            for prefix in sample([len, len / 9, len / 2], 2) {
                let from = [&ascii[..prefix], b"\x80", &ascii[prefix..]].concat();
                check_shared_prefix(&ascii[..prefix], &from, kernel);
            }
        }

        let wide: Vec<u16> = (0..len)
            .map(|i| u16::from(t[i]) | (i as u16 & 8) << 5)
            .collect();
        let lower =
            |&unit: &u16| u8::try_from(unit).map_or(unit, |b| b.to_ascii_lowercase().into());
        check(wide.iter().map(lower).collect(), || {
            filled(len, |out| kernels::lower_ascii16(&wide, out))
        });

        check_swap::<2>(&t, kernels::swap16_shared);
        check_swap::<4>(&t, kernels::swap32_shared);
        check_swap::<8>(&t, kernels::swap64_shared);
    }
}

#[test]
fn few_ascii() {
    let ones = [0xFF; 20];
    for len in sample(0..=18, 3) {
        for not_ascii in sample((0..=len).rev(), 7) {
            let mut from = b"abcdefghijklmnopqr"[..len].to_vec();
            if let Some(byte) = from.get_mut(not_ascii) {
                *byte = 0x80;
            }
            for room in [len.saturating_sub(1), len, 20] {
                let is_copied = from.is_ascii() && len <= room.min(16);
                let copied = if is_copied { len } else { 0 };
                let all = [&from[..copied], &ones[copied..room]].concat();
                check((is_copied, all), || {
                    to_shared(&ones[..room], |out| {
                        kernels::copy_few_ascii_to_shared(&from, SharedOutU8::from_slice(out))
                    })
                });
            }
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn nothing_after_a_prefix() {
    use kernels::*;
    for (at, len) in (0..140).flat_map(|at| [at + 1, at + 40, 2 * at + 2, 200].map(|it| (at, it))) {
        let (mut text, mut hex) = (vec![0x7F; len], vec![*b"7f"; len]);
        (text[at / 2], hex[at / 2]) = (0, *b"00");
        let wide: Vec<u16> = text.iter().map(|&byte| byte.into()).collect();
        check_prefix(&text, &wide, copy_u16_to_u8, copy_u16_to_shared);
        check_prefix(&text, &hex, decode_hex, decode_hex_to_shared);
        for room in [at, 2 * at + 1, 2 * len, 2 * len + 141] {
            check(hex[..len.min(room / 2)].concat(), || {
                prefix(vec![1; room], |out| encode_hex_lower(&text, out))
            });
        }
        (text[at], hex[at][at % 2]) = (0x80, b'g');
        let wide: Vec<[u16; 2]> = hex.iter().map(|pair| pair.map(u16::from)).collect();
        let want = &text[..at].to_vec();
        check_shared_prefix(want, &text, copy_ascii_prefix_to_shared);
        check_prefix(want, &hex, decode_hex, decode_hex_to_shared);
        check_prefix(want, &wide, decode_hex16, decode_hex16_to_shared);
        text[len - 1] = 0x80;
        check_shared_prefix(want, &text, copy_ascii_prefix_to_shared);
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn each_byte_converted() {
    let all = all_bytes();
    check(all.to_ascii_lowercase(), || {
        filled(256, |out| kernels::lower_ascii(&all, out))
    });
    let wide: Vec<u16> = all.iter().map(|&byte| byte.into()).collect();
    let lower = all.iter().map(|byte| byte.to_ascii_lowercase().into());
    check(lower.collect(), || {
        filled(256, |out| kernels::lower_ascii16(&wide, out))
    });
    let hex = |byte| format!("{byte:02x}").into_bytes();
    for part in [&all[..], &all[..15], &all[0xA0..0xAF], &all[0xF1..]] {
        check(part.iter().flat_map(hex).collect(), || {
            filled(2 * part.len(), |out| kernels::encode_hex_lower(part, out))
        });
    }
}

#[test]
fn hex_digits() {
    for byte in sample(0..=255, 97) {
        let mut hex = [*b"00"; 70];
        hex[33][1] = byte;
        let want = match char::from(byte).to_digit(16) {
            Some(digit) => [&[0; 33][..], &[digit as u8], &[0; 36]].concat(),
            None => vec![0; 33],
        };
        check(want[30..want.len().min(40)].to_vec(), || {
            filled(10, |out| kernels::decode_hex(&hex[30..40], out))
        });
        check(want, || filled(70, |out| kernels::decode_hex(&hex, out)));
    }
    for apart in sample([8, 16, 32], 3) {
        let mut hex = [*b"00"; 70];
        (hex[1][0], hex[1 + apart][0]) = (b'g', b'g');
        check(vec![0], || filled(70, |out| kernels::decode_hex(&hex, out)));
    }
}

#[test]
fn words_that_take_all_the_room() {
    for len in sample(0..20, 15) {
        let (words, data) = (vec![[1 << 31; 4]; len], vec![255; 16 * len]);
        check(data.clone(), || {
            filled(16 * len, |data| {
                kernels::pack_words(&words, vec![0; len][..].as_mut().into(), data).1
            })
        });
        check(words, || {
            filled(len, |out| kernels::unpack_words(&data[..len], &data, out).0)
        });
    }
}

#[test]
fn words() {
    for t in texts(MIXED) {
        let word = |b: u8| (i32::from(b as i8) << (b & 24)) as u32;
        let words: Vec<[u32; 4]> = t.as_chunks().0.iter().map(|four| four.map(word)).collect();
        let pack = || {
            let mut controls = vec![];
            let data = filled(16 * words.len(), |data| {
                let into = &mut Box::new_uninit_slice(words.len())[..];
                let (filled_controls, data) = kernels::pack_words(&words, into.into(), data);
                controls = filled_controls.to_vec();
                data
            });
            (controls, data)
        };
        check_against_portable(pack);
        let (controls, mut data) = pack();
        let size = |&word: &u32| match (word << 1 ^ (word as i32 >> 31) as u32).leading_zeros() {
            32 => 0,
            24.. => 1,
            16.. => 2,
            _ => 4,
        };
        assert_eq!(data.len(), words.as_flattened().iter().map(size).sum());
        data.extend([0; 16]);
        for room in [words.len(), words.len() / 2] {
            check(words[..room].to_vec(), || {
                filled(room, |out| kernels::unpack_words(&controls, &data, out).0)
            });
        }
    }
}

#[test]
fn words_of_each_size() {
    // The least and the greatest of 0, 1, 2 and 4 bytes.
    let words = [[0; 2], [-1, -128], [128, -32768], [32768, i32::MIN]];
    let bytes: [[&[u8]; 2]; 4] = [
        [&[], &[]],
        [&[1], &[255]],
        [&[0, 1], &[255; 2]],
        [&[0, 0, 1, 0], &[255; 4]],
    ];
    let controls: Vec<u8> = sample(0..=255, 29).collect();
    let codes = |control: u8| [0, 2, 4, 6].map(|shift| usize::from(control >> shift & 3));
    for which in [0, 1] {
        let group = |&control: &u8| codes(control).map(|code| words[code][which] as u32);
        let groups: Vec<[u32; 4]> = controls.iter().map(group).collect();
        let data_of = |count| -> Vec<u8> {
            let codes = controls[..count].iter().flat_map(|&control| codes(control));
            codes.flat_map(|code| bytes[code][which]).copied().collect()
        };
        let len = groups.len();
        for (room, data_room, count) in [(len, 16 * len, len), (5, 96, 5), (9, 95, 5)] {
            check((controls[..count].to_vec(), data_of(count)), || {
                let (mut into, mut data) = (vec![0; room], vec![0; data_room]);
                let (into, data) = (into[..].as_mut().into(), data[..].as_mut().into());
                let (controls, data) = kernels::pack_words(&groups, into, data);
                (controls.to_vec(), data.to_vec())
            });
        }
        let data = data_of(len);
        for data in sample(0..100, 33).map(|less| &data[..data.len().saturating_sub(less)]) {
            let count = (0..len).take_while(|&it| data_of(it).len() + 16 <= data.len());
            let count = count.count();
            check((groups[..count].to_vec(), data_of(count).len()), || {
                let mut used = 0;
                let groups = filled(len, |out| {
                    let groups;
                    (groups, used) = kernels::unpack_words(&controls, data, out);
                    groups
                });
                (groups, used)
            });
        }
    }
}

type Json = (Vec<u32>, Vec<u64>, json::State, u32);

/// `None` for a comment or a single quote.
fn json_structure(text: &[u8], base: usize, state: json::State) -> Option<Json> {
    let (mut is_escaped, mut is_in_string) = (state.is_escaped, state.is_in_string);
    let mut is_scalar = state.is_in_scalar;
    let (mut index, mut dirty, mut flags) = (vec![], vec![0; text.len().div_ceil(4096)], 0);
    for i in 0..text.len().next_multiple_of(64) {
        let (byte, was_scalar) = (*text.get(i).unwrap_or(&b' '), is_scalar);
        let is_quote = byte == b'"' && !is_escaped;
        is_escaped = byte == b'\\' && !is_escaped;
        is_in_string ^= is_quote;
        is_scalar = !is_in_string && !is_quote && !b"{}[]:, \t\n\r".contains(&byte);
        if is_in_string {
            flags |= u32::from(byte == b'\\') | u32::from(byte < 0x20) << 1;
            dirty[i / 4096] |= u64::from(byte == b'\\' || byte < 0x20) << (i / 64 % 64);
        } else if b"'/".contains(&byte) {
            return None;
        }
        if is_quote || !is_in_string && b"{}[]:,".contains(&byte) || is_scalar && !was_scalar {
            index.push((base + i) as u32);
        }
    }
    let state = json_state([is_escaped, is_in_string, is_scalar]);
    Some((index, dirty, state, flags))
}

fn json_state([is_escaped, is_in_string, is_in_scalar]: [bool; 3]) -> json::State {
    json::State {
        is_escaped,
        is_in_string,
        is_in_scalar,
    }
}

fn json_index(text: &[u8], base: usize, before: json::State) -> Option<Json> {
    let (mut dirty, mut state, mut flags) = (vec![7; text.len().div_ceil(4096)], before, None);
    let index = filled(text.len() + 64, |out| {
        let index;
        (index, flags) = json::index_chunk(text, base, out, &mut dirty, &mut state).unzip();
        index.unwrap_or_default()
    });
    assert!(flags.is_some() || state == before);
    Some((index, dirty, state, flags?))
}

fn check_json(text: &[u8], before: json::State) {
    check(json_structure(text, 1 << 31, before), || {
        json_index(text, 1 << 31, before)
    });
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn json_against_a_loop() {
    let states = (0..8).map(|bits| json_state([1, 2, 4].map(|bit| bits & bit != 0)));
    for state in states {
        for t in texts(b"{}[]:,\"\"\\\\ \n\tabc123\x01\xff") {
            check_json(&t, state);
            check_json(&t[..t.len() & !63], state);
        }
        for byte in 0..=255 {
            check_json(&[byte, b'a', b' ', byte, byte, b'"', byte], state);
            check_json(&[byte], state);
            check_json(&[&[byte][..], &[b'a'; 63]].concat().repeat(2), state);
        }
        for (before, len) in (0..66).flat_map(|it| (0..70).map(move |len| (it, len))) {
            let t = [&vec![b' '; before], &vec![b'\\'; len], &b"\"a,"[..]].concat();
            check_json(&t, state);
            check_json(&t[..t.len().min(64)], state);
        }
    }
    for at in [1, 64, 4095, 4096, 8191, 8192, 8200] {
        let mut t = vec![b'a'; 8256];
        (t[0], t[at]) = (b'"', b'\n');
        for len in [at + 1, 8192, 8256] {
            check_json(&t[..len], Default::default());
        }
    }
    for blocks in 0..130 {
        check_json(&vec![b'\n'; 64 * blocks], json_state([false, true, false]));
    }
}

#[test]
fn json() {
    for t in texts(b"{}[]:,\"\"\\ \n\tabc123\x01\xff") {
        check_against_portable(|| json_index(&t, 4096, Default::default()));
    }
    check(vec![0, 1, 5, 6, 7, 8, 9, 10, 14, 15], || {
        json_index(br#"{"a\"":[1,true]}"#, 0, Default::default())
            .unwrap()
            .0
    });
}

#[test]
fn byte_classes() {
    use {kernels::json::class as json, kernels::xml::class as xml};
    for byte in 0..=u8::MAX {
        let is_in = |set: &[u8]| set.contains(&byte);
        let has = |class| json::OF_BYTE[usize::from(byte)] & class != 0;
        assert_eq!(has(json::STRUCTURAL), is_in(b"{}[]:,"), "{byte}");
        assert_eq!(has(json::WHITESPACE), is_in(b" \t\n\r"), "{byte}");
        let (oddity, control) = (0x20, 0x40);
        assert_eq!(has(oddity), is_in(b"/'"), "{byte}");
        assert_eq!(has(control), byte < b' ', "{byte}");

        let has = |class| xml::OF_BYTE[usize::from(byte)] & class != 0;
        let is_control = byte < 0x20 && !is_in(b"\t\n");
        assert_eq!(has(xml::ANYWHERE), is_control || byte == b'&', "{byte}");
        assert_eq!(has(xml::IN_TAG), is_in(b"\t\n\"'="), "{byte}");
        assert_eq!((has(xml::LT), has(xml::GT)), (byte == b'<', byte == b'>'));
    }
}

#[test]
fn json_without_room() {
    let index = |len, dirty: &mut [u64]| {
        let (text, room) = (&[b'['; 64], &mut vec![0; len][..]);
        let found = json::index_chunk(text, 0, room.into(), dirty, &mut Default::default());
        found.map(|(index, flags)| (index.len(), flags))
    };
    check([Some((64, 0)), None, None], || {
        [index(64, &mut [0]), index(63, &mut [0]), index(64, &mut [])]
    });
}

/// `odd(i)` tells whether the encoding makes it structural.
fn xml_structure(units: &[u16], odd: impl Fn(usize) -> bool) -> Vec<u32> {
    let mut is_in_tag = false;
    let is_structural = |&i: &usize| {
        let byte = u8::try_from(units[i]).unwrap_or(b'a');
        is_in_tag = byte == b'<' || is_in_tag && byte != b'>';
        let is_control = byte < 0x20 && !b"\t\n".contains(&byte);
        is_control || b"<>&".contains(&byte) || is_in_tag && b"\t\n=\"'".contains(&byte) || odd(i)
    };
    (0..units.len())
        .filter(is_structural)
        .map(|i| i as u32)
        .collect()
}

/// In two calls, with a whole block in the first.
fn xml_index<T>(
    text: &[T],
    kernel: for<'a> fn(&[T], usize, Out<'a, u32>, &mut xml::State) -> &'a mut [u32],
) -> Vec<u32> {
    let ((first, second), state) = (text.split_at(text.len().min(64)), &mut Default::default());
    let first = filled(first.len() + 64, |out| kernel(first, 0, out, state));
    [
        first,
        filled(second.len() + 64, |out| kernel(second, 64, out, state)),
    ]
    .concat()
}

#[test]
fn xml() {
    for t in texts(b"<<>>=\"'&ab \t\n\r\x01\xEF\xEF\xBF\xBF\xBE") {
        let latin1: Vec<u16> = t.iter().map(|&b| b.into()).collect();
        let ends_no_char = |i| matches!(t[..=i], [.., 0xEF, 0xBF, 0xBE | 0xBF]);
        check(xml_structure(&latin1, ends_no_char), || {
            xml_index(&t, xml::index_chunk)
        });

        let unit = |(&byte, &other): (&u8, &u8)| match (byte, other) {
            (0xEF, _) => 0xD800 | u16::from(other) << 2,
            (0xBF, _) => 0xDC00 | u16::from(other) << 2,
            (0xBE, b'<') => 0xFFFE,
            (0xBE, b'>') => 0xFFFF,
            (0xBE, _) => 0x100 | u16::from(other),
            _ => byte.into(),
        };
        let mut wide: Vec<u16> = t.iter().zip(t.iter().rev()).map(unit).collect();
        wide.push(b'a'.into());
        let is_odd = |i: usize| match wide[i] {
            0xD800..0xDC00 => !(0xDC00..0xE000).contains(&wide[i + 1]),
            0xDC00..0xE000 => !matches!(wide[..i], [.., 0xD800..0xDC00]),
            unit => unit >= 0xFFFE,
        };
        check(xml_structure(&wide, is_odd), || {
            xml_index(&wide, xml::index_chunk16)
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn xml_of_each_unit() {
    let check_bytes = |t: &[u8]| {
        let latin1: Vec<u16> = t.iter().map(|&b| b.into()).collect();
        let ends_no_char = |i| matches!(t[..=i], [.., 0xEF, 0xBF, 0xBE | 0xBF]);
        check(xml_structure(&latin1, ends_no_char), || {
            xml_index(t, xml::index_chunk)
        });
        check(xml_structure(&latin1, |_| false), || {
            xml_index(&latin1, xml::index_chunk16)
        });
    };
    check_bytes(&[&[b'a'; 70_000][..], b"<"].concat());
    for len in 60..66 {
        for byte in [0xEF, 0xBF] {
            check_bytes(&[&vec![byte; len][..], b"\xEF\xBF\xBE<"].concat());
        }
        for unit in [0xD800, 0xDC00] {
            let (lone, all) = ([vec![unit; len], vec![0x20; 2]].concat(), 0..len as u32);
            check(all.collect(), || xml_index(&lone, xml::index_chunk16));
        }
    }
    for byte in 0..=255 {
        check_bytes(&[byte, b'=', b'>', b'<', byte, b'=']);
        for before in (60..65).chain(124..129) {
            for at in 0..3 {
                let mut t = [&vec![b'a'; before][..], b"\xEF\xBF\xBE<"].concat();
                t[before + at] = byte;
                check_bytes(&t);
            }
        }
    }
    for units in (0x100..=u16::MAX).collect::<Vec<_>>().chunks(31) {
        let apart: Vec<u16> = units.iter().flat_map(|&unit| [unit, 0x20]).collect();
        let is_odd = |i: usize| matches!(apart[i], 0xD800..0xE000 | 0xFFFE..);
        check(xml_structure(&apart, is_odd), || {
            xml_index(&apart, xml::index_chunk16)
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn surrogates_at_the_end_of_a_block() {
    const LEAD: u16 = 0xD83D;
    const TRAIL: u16 = 0xDE00;
    for at in [63, 127] {
        for (units, want) in [
            (&[LEAD, TRAIL][..], &[][..]),
            (&[LEAD, LEAD, TRAIL], &[at]),
            (&[LEAD, 0x20], &[at]),
            (&[0x20, TRAIL], &[at + 1]),
            (&[0x20, LEAD], &[at + 1]),
        ] {
            let t = [&vec![0x20; at as usize], units].concat();
            check(want.to_vec(), || xml_index(&t, xml::index_chunk16));
        }
    }
    for (at, want, ends_with_lead_surrogate) in [(62, vec![62], false), (63, vec![], true)] {
        let after = xml::State {
            ends_with_lead_surrogate,
            ..Default::default()
        };
        check((want, after), || {
            let (text, mut state) = ([&vec![0x20; at], &[LEAD][..]].concat(), Default::default());
            let index = filled(128, |out| xml::index_chunk16(&text, 0, out, &mut state));
            (index, state)
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn xxhash() {
    let counting: Vec<u8> = (0..70001).map(|i| (i % 251) as u8).collect();
    for (len, seed, xxh32, xxh64, xxh3) in [
        (0, 0, 0x02cc5d05, 0xef46db3751d8e999, 0x2d06800538d394c2),
        (0, 7, 0xd7adaff8, 0x95f0626f6f0a4409, 0x913ae0873e9b7eb8),
        (1, 7, 0x59a1de0e, 0xd90df86c76f52e13, 0x2c45aa60ff5dc0e5),
        (3, 7, 0x9c580eec, 0x5ab1230478ca6310, 0x3868dcb498f6507c),
        (4, 7, 0x9db73bfa, 0x6ae497162d0610d7, 0x312ac60c453a7ed6),
        (8, 7, 0x30944c03, 0x3072f8c5cba43e9a, 0xdb86d781f5b8bd4a),
        (9, 7, 0x9c82bd6f, 0x7058c3b0fbd3bd85, 0xfb95f5a370f00403),
        (16, 7, 0xb9a86583, 0x506df9181e2573e0, 0xee0b9003ece2cff1),
        (17, 7, 0x17efb85e, 0xbec504d5da0140b0, 0xce3f6da0a1ce63a2),
        (33, 7, 0xa46e00d1, 0x0c43e57754c778d9, 0x0c5256d396622d02),
        (65, 7, 0x06cab0ac, 0x68dc3663487eb225, 0x575815c22d2bb16a),
        (97, 7, 0xb7231e01, 0x6766b2c4c97287db, 0x63393587fd4b6522),
        (128, 7, 0x44e52114, 0xeef67f772a4c8815, 0x0de8157dd7737803),
        (129, 7, 0xb0cb9f75, 0x67ae19d54e1a6c21, 0x7445cdd6c2d37b03),
        (240, 7, 0x0789eddd, 0xa54b1e5d2178d521, 0x7c241a22d405c084),
        (241, 7, 0x50c41e2f, 0xafa3a124a71ae685, 0xd8f2ad256b03a316),
        (2048, 0, 0x64a8e425, 0xa69e05a7eff57800, 0x25339063db861586),
        (2048, 7, 0x97aaf2a5, 0xb59eb111a307393c, 0x8d1c0283d793714b),
        (70001, 7, 0xba005a56, 0xd3fd5fd660c364a3, 0xdf6c27417bcf0879),
    ] {
        check(xxh32, || kernels::xxhash32(seed, &counting[..len]));
        check(xxh64, || kernels::xxhash64(seed.into(), &counting[..len]));
        check(xxh64, || {
            let mut state = kernels::XxHash64State::new(seed.into());
            state.update(&counting[..len]);
            state.digest()
        });
        from_shared(&counting[..len], |t| {
            check(xxh32, || kernels::xxhash32_shared(seed, t));
            check(xxh64, || kernels::xxhash64_shared(seed.into(), t));
            check(xxh3, || kernels::xxhash3_64_shared(seed.into(), t));
        });
    }
    for t in texts(MIXED) {
        check_against_portable(|| {
            from_shared(&t, |t| {
                [0, 7].map(|seed| kernels::xxhash3_64_shared(seed, t))
            })
        });
        for size in [1, 31, 32, 33, 100] {
            check(kernels::xxhash64(7, &t), || {
                let mut state = kernels::XxHash64State::new(7);
                t.chunks(size).for_each(|part| state.update(part));
                state.digest()
            });
        }
    }
}

fn crc32_by_bits(crc: u32, bytes: &[u8]) -> u32 {
    let step = |crc: u32, _| crc >> 1 ^ if crc & 1 != 0 { 0xEDB8_8320 } else { 0 };
    !(bytes.iter()).fold(!crc, |crc, &byte| (0..8).fold(crc ^ u32::from(byte), step))
}

fn adler32_by_bytes(adler: u32, bytes: &[u8]) -> u32 {
    let (mut low, mut high) = (adler & 0xFFFF, adler >> 16);
    for &byte in bytes {
        low = (low + u32::from(byte)) % 65521;
        high = (high + low) % 65521;
    }
    high << 16 | low
}

type CopyAndSum = for<'a> fn(&mut u32, &[u8], Out<'a, u8>) -> &'a mut [u8];

#[test]
fn checksums() {
    #[track_caller]
    fn check(len: usize, want: u32, kernel: impl Fn() -> u32) {
        let more = "pclmulqdq avx512vl vpclmulqdq crc crc+aes dotprod";
        for target in targets() {
            assert_eq!(kernel(), want, "{len} {target:?}");
            for more in more.split(' ').filter(|_| target.arch().is_some()) {
                limit_to_with(target, more.split('+'));
                assert_eq!(kernel(), want, "{len} {target:?}+{more}");
            }
        }
    }
    fn copied(mut sum: u32, bytes: &[u8], spare: usize, kernel: CopyAndSum) -> u32 {
        let mut copy = Vec::with_capacity(bytes.len() + spare);
        extend_vec(&mut copy, bytes.len() + spare, |to| {
            kernel(&mut sum, bytes, to)
        });
        assert!(copy == bytes);
        sum
    }
    assert_eq!(crc32_by_bits(0, b"123456789"), 0xCBF4_3926);
    assert_eq!(adler32_by_bytes(1, b"Wikipedia"), 0x11E6_0398);
    let lengths: Vec<usize> = match cfg!(miri) {
        true => vec![3, 40, 700],
        false => (0..2600)
            // At 4097 and 4112, the last correction of the upper sum crosses 2^31.
            .chain([4096, 4097, 4112, 5503, 5504, 5505, 5552, 5553, 5900, 11_100])
            .chain([
                16_383, 16_384, 65_535, 65_536, 65_537, 65_599, 70_001, 140_001,
            ])
            .collect(),
    };
    let mut below = random();
    for len in lengths {
        let any = (0..len + 63).map(|_| below(256) as u8).collect();
        for all in sample([any, vec![255; len + 63]], 2) {
            let start = below(64);
            // Up to each place in a cache line, which decides where they are split.
            let starts = match len {
                16_384 | 65_599 => 0..=63,
                _ => start..=start,
            };
            from_shared(&all, |shared| {
                for start in starts {
                    let (bytes, shared) = (&all[start..][..len], &shared[start..][..len]);
                    let spare = below(2) * below(300);
                    let crc = [0, below(1 << 31) as u32 * 2 + 1][start % 2];
                    let want = crc32_by_bits(crc, bytes);
                    check(len, want, || kernels::crc32(crc, bytes));
                    check(len, want, || kernels::crc32_shared(crc, shared));
                    check(len, want, || {
                        copied(crc, bytes, spare, kernels::copy_and_crc32)
                    });
                    for adler in sample([0xFFF0_FFF0, 1], 2) {
                        let want = adler32_by_bytes(adler, bytes);
                        check(len, want, || kernels::adler32(adler, bytes));
                        check(len, want, || kernels::adler32_shared(adler, shared));
                        check(len, want, || {
                            copied(adler, bytes, spare, kernels::copy_and_adler32)
                        });
                    }
                }
            });
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn adler32_with_weights_of_one_sign() {
    for (run, first) in [16, 32, 64, 128]
        .into_iter()
        .flat_map(|it| [(it, 0), (it, 255)])
    {
        #[repr(align(64))]
        struct NotSplit([u8; 65536]);
        let NotSplit(bytes) = &NotSplit(from_fn(|i| [first, !first][i / run % 2]));
        check(adler32_by_bytes(1, bytes), || kernels::adler32(1, bytes));
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn checksums_of_copies_without_room() {
    let kernels: [CopyAndSum; 2] = [kernels::copy_and_crc32, kernels::copy_and_adler32];
    for len in [1, 5, 16, 100, 128, 256, 400, 3000, 70_000] {
        for (target, kernel) in targets().flat_map(|target| kernels.map(|it| (target, it))) {
            limit_to_with(target, ["pclmulqdq", "vpclmulqdq", "crc", "aes", "dotprod"]);
            let copy = || _ = kernel(&mut 1, &vec![0; len], vec![0; len - 1][..].as_mut().into());
            assert!(std::panic::catch_unwind(copy).is_err(), "{len} {target:?}");
        }
    }
}

const LONGEST_MATCH: usize = MATCH_SPAN - 31;

fn lengths_of_matches() -> impl Iterator<Item = usize> {
    (0..=MATCH_SPAN).chain([usize::MAX])
}

/// Its spare capacity is not initialized.
fn history(len: usize, room: usize) -> Vec<u8> {
    let mut vec = Vec::with_capacity(len + room);
    vec.extend((0..len).map(|at| (at * at % 251) as u8));
    vec
}

#[test]
fn any_match_is_copied_with_little_too_much() {
    let cases = (0..=65).flat_map(|distance| lengths_of_matches().map(move |len| (distance, len)));
    for (distance, len) in sample(cases, 2003) {
        let mut bytes: [u8; 65 + MATCH_SPAN] = from_fn(|at| (at % 251) as u8);
        let before = bytes;
        let cells = Cell::from_mut(&mut bytes[..]).as_slice_of_cells();
        let span = |at: usize| cells[at..].first_chunk().unwrap();
        copy_match(
            span(65 - distance),
            span(65),
            distance,
            len,
            Some(!distance),
        );
        let end = 65 + len.min(LONGEST_MATCH);
        // Without a distance, the first byte is repeated.
        assert!((66..end).all(|at| bytes[at] == bytes[at - distance.max(1)]));
        let untouched = (end + 32).min(bytes.len());
        assert!(bytes[..65] == before[..65] && bytes[untouched..] == before[untouched..]);
        assert!(len == 0 || bytes[65] == before[65 - distance]);
    }
}

#[test]
fn a_match_from_elsewhere() {
    for (distance, len) in [(300, 258), (32, 32), (5, 5), (1, 1)] {
        let (from, to) = (from_fn(|at| Cell::new(at as u8)), from_fn(|_| Cell::new(0)));
        copy_match(&from, &to, distance, len, None);
        assert_eq!(from[..len], to[..len]);
    }
}

#[test]
fn matches_repeat_what_is_there() {
    let cases = (1..=65).flat_map(|distance| lengths_of_matches().map(move |len| (distance, len)));
    for (distance, len) in sample(cases, 2003) {
        let mut vec = history(65, MATCH_SPAN);
        let mut want = vec.clone();
        assert!(push_match(
            &mut Appender::new(&mut vec, 65, usize::MAX),
            distance,
            len
        ));
        for _ in 0..len.min(LONGEST_MATCH) {
            want.push(want[want.len() - distance]);
        }
        assert_eq!(vec, want, "{distance} {len}");
    }
}

#[test]
fn no_match_is_added_that_is_out_of_range() {
    let mut vec = history(40, 999);
    for (seen, reach) in [(0, 0), (9, 9), (usize::MAX, 40)] {
        for distance in [0, reach + 1, 1 << 16, u32::MAX as usize, usize::MAX] {
            for len in [0, 9, 258] {
                let to = &mut Appender::new(&mut vec, seen, usize::MAX);
                assert!(!push_match(to, distance, len));
            }
        }
    }
    for distance in [1, 40] {
        assert!(!push_match(
            &mut Appender::new(&mut vec, 40, MATCH_SPAN - 1),
            distance,
            9
        ));
    }
    assert_eq!(vec, history(40, 0));
}

#[test]
fn what_follows_a_match_replaces_its_surplus() {
    let mut vec = history(5, 999);
    let mut to = Appender::new(&mut vec, 2, 700);
    to.push([1, 1, 2, 3, 4, 1, 2, 3, 4, 5], 9);
    for (distance, len) in [(9, 2), (3, 7), (20, 1)] {
        assert!(push_match(&mut to, distance, len));
    }
    assert_eq!((to.position(), to.room()), (21, 681));
    drop(to);
    let added = [1, 1, 2, 3, 4, 1, 2, 3, 4, 1, 1, 4, 1, 1, 4, 1, 1, 4, 9];
    assert_eq!(vec[5..], added);
}

#[test]
fn hash_table_entries_are_lowered() {
    let values: [[u16; 64]; 3] = from_fn(|i| from_fn(|k| ((64 * i + k) * 343) as u16));
    for (groups, amount) in [(0, 1), (1, 0), (2, 343), (3, 32768), (3, u16::MAX)] {
        let mut want = values;
        for value in want[..groups].as_flattened_mut() {
            *value = value.saturating_sub(amount);
        }
        check(want, || {
            let mut got = values;
            subtract_saturating(&mut got[..groups], amount);
            got
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn xxhash_of_each_length() {
    fn sum<T>(bytes: &[T], hash: impl Fn(u64, &[T]) -> u64) -> u64 {
        let seed = |len: usize| (len as u64 % 3).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        let hashes = (0..=bytes.len()).map(|len| hash(seed(len), &bytes[..len]));
        hashes.fold(0, u64::wrapping_add)
    }
    let counting: Vec<u8> = (0..3100).map(|i| (i % 251) as u8).collect();
    check(0x606_88ad_89c9, || {
        sum(&counting, |seed, t| {
            kernels::xxhash32(seed as u32, t).into()
        })
    });
    check(0x5b38_37bf_69e3_e093, || sum(&counting, kernels::xxhash64));
    from_shared(&counting, |t| {
        check(0x606_88ad_89c9, || {
            sum(t, |seed, t| kernels::xxhash32_shared(seed as u32, t).into())
        });
        check(0x5b38_37bf_69e3_e093, || sum(t, kernels::xxhash64_shared));
        check(0xb3b5_0c44_a8cd_22f2, || sum(t, kernels::xxhash3_64_shared));
    });
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn xxhash_wraps_around() {
    // Each adds up to all ones with a constant of the hashes.
    let seeds = [0, 0x27D4_EB2F_1656_67C5, 0x1656_67B1, 0x6782_737B_EA42_39B9].map(|it| !it);
    let sum = |hash: &dyn Fn(u64, &[u8]) -> u64| {
        let of = |seed| (0..=40).map(move |len| hash(seed, &[0; 40][..len]));
        seeds.into_iter().flat_map(of).fold(0, u64::wrapping_add)
    };
    check(0x50_79a4_a962, || {
        sum(&|seed, t| kernels::xxhash32(seed as u32, t).into())
    });
    check(0x108b_1a1c_9eaf_c9d5, || sum(&kernels::xxhash64));
    check(0x108b_1a1c_9eaf_c9d5, || {
        sum(&|seed, t| {
            let mut state = kernels::XxHash64State::new(seed);
            state.update(t);
            state.digest()
        })
    });
    check(0x4483_2bee_5cad_6b4b, || {
        sum(&|seed, t| from_shared(t, |t| kernels::xxhash3_64_shared(seed, t)))
    });
}

/// What the filter subtracts from a byte with these to the left, above, and above to the left.
fn png_prediction(filter_type: u8, [a, b, c]: [u8; 3]) -> u8 {
    let [wide_a, wide_b, wide_c] = [a, b, c].map(i32::from);
    let distance = |&byte: &u8| (wide_a + wide_b - wide_c).abs_diff(byte.into());
    match filter_type {
        0 => 0,
        1 => a,
        2 => b,
        3 => a.midpoint(b),
        _ => [a, b, c].into_iter().min_by_key(distance).unwrap(),
    }
}

#[test]
fn png() {
    for row in texts(MIXED) {
        let flat = (0..row.len() + 9).map(|i| (i / 128 * 99) as u8).collect();
        let falling = (0..row.len()).map(|i| 2 >> (i / 4).min(2)).collect();
        let reversed: Vec<u8> = row.iter().rev().copied().collect();
        for above in sample([reversed, falling, flat], 3) {
            let filtered = |filter_type, size: usize| -> Vec<u8> {
                let byte = |i: usize| {
                    let left = |row: &[u8]| i.checked_sub(size).map_or(0, |at| row[at]);
                    let around = [left(&row), above[i], left(&above)];
                    row[i].wrapping_sub(png_prediction(filter_type, around))
                };
                (0..row.len() / size * size).map(byte).collect()
            };
            for size in sample([4, 1, 2, 6, 8], 5) {
                for filter_type in 0..5 {
                    let filtered = filtered(filter_type, size);
                    check(row[..filtered.len()].to_vec(), || {
                        let mut back = filtered.clone();
                        png::unfilter(filter_type, size, &mut back, &above);
                        back
                    });
                }
            }
            let distance = |&byte: &u8| u64::from((byte as i8).unsigned_abs());
            let sums = [0, 1, 2, 3, 4].map(|it| filtered(it, 4).iter().map(distance).sum());
            check((sums, [1, 2, 3, 4].map(|it| filtered(it, 4))), || {
                let mut rows = [(); 4].map(|()| vec![0; row.len() & !3]);
                let into = rows.each_mut().map(|row| row.as_chunks_mut().0);
                let (row, above) = (row.as_chunks().0, above.as_chunks().0);
                (png::filter_rgba(row, above, into), rows)
            });
        }
    }
}

/// The second pixel has all values to the left, above, and above to the left.
fn check_paeth<const SIZE: usize>() {
    for (b, c) in (0..=255).flat_map(|b| (0..=255).map(move |c| (b, c))) {
        let above = [&[c; SIZE][..], &[b; 16]].concat();
        for a in (0..=255).step_by(SIZE) {
            let left: [u8; SIZE] = core::array::from_fn(|i| a + i as u8);
            let mut row = [&left.map(|a| a.wrapping_sub(c))[..], &[0; 16]].concat();
            png::unfilter(4, SIZE, &mut row[..16], &above);
            assert_eq!(
                row[SIZE..][..SIZE],
                left.map(|a| png_prediction(4, [a, b, c]))
            );
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn paeth_predictions() {
    for target in [Target::ALL[0], Target::Portable] {
        limit_to(target);
        check_paeth::<2>();
        check_paeth::<4>();
        check_paeth::<8>();
    }
}

#[test]
#[ignore = "slow"]
fn paeth_predictions_of_bytes() {
    for _ in targets() {
        check_paeth::<1>();
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn paeth_predictions_of_the_encoder() {
    let row: Vec<u8> = (0..512).map(|i| (i / 8 * 4 + i % 4) as u8).collect();
    for (b, c) in (0..=255).flat_map(|b| (0..=255).map(move |c| (b, c))) {
        let above = [[c; 4], [b; 4]].repeat(64);
        let filtered = |a: u8| a.wrapping_sub(png_prediction(4, [a, b, c]));
        check((0..=255).map(filtered).collect::<Vec<_>>(), || {
            let mut rows = [[[0; 4]; 128]; 4];
            let into = rows.each_mut().map(|it| &mut it[..]);
            png::filter_rgba(row.as_chunks().0, &above, into);
            rows[3]
                .as_chunks::<2>()
                .0
                .iter()
                .flat_map(|it| it[1])
                .collect()
        });
    }
}

#[test]
fn png_of_other_kinds() {
    for (filter_type, size) in [(0, 4), (5, 4), (1, 3), (2, 3), (3, 3), (4, 3), (2, 0)] {
        check([1; 40], || {
            let mut row = [1; 40];
            png::unfilter(filter_type, size, &mut row, &[2; 40]);
            row
        });
    }
}

#[test]
fn mappings() {
    // The text, what it adds to the column, and whether it ends the line.
    let mixed: &[(&[u8], i32, bool)] = &[
        (b"CAAC,", 1, false),
        (b"gBAAgB,", 16, false),
        (b"CAACC;", 1, true),
        (b"ggBAAggB,", 512, false),
    ];
    for segments in [mixed, &mixed[..1], &mixed[..2]] {
        for count in if cfg!(miri) { 25..26 } else { 0..120 } {
            let segments = || segments.iter().cycle().take(count);
            let text: Vec<u8> = segments().flat_map(|segment| segment.0).copied().collect();
            let (mut line, mut column, mut original, mut want) = (0, 0, 0, vec![]);
            for &(_, step, ends_line) in segments() {
                (column, original) = (column + step, original + step);
                want.push([line, column, 0, original]);
                if ends_line {
                    (line, column) = (line + 1, 0);
                }
            }
            for target in targets() {
                let mut pairs = [(); 2].map(|()| Box::new_uninit_slice(count));
                let mut indices = [(); 2].map(|()| Box::new_uninit_slice(count));
                let ([generated, original], [src_idx, name_idx]) = (&mut pairs, &mut indices);
                let columns = Columns {
                    generated: generated.as_mut().into(),
                    original: original.as_mut().into(),
                    src_idx: src_idx.as_mut().into(),
                    name_idx: Some(name_idx.as_mut().into()),
                };
                let state = &mut Default::default();
                let (rows, resume_at) = sourcemap::parse_mappings(&text, columns, 1, state);
                let left = count - rows.src_idx.len();
                assert!(text.len() - resume_at < 64 || left < 16, "{target:?}");
                let pairs = rows.generated.iter().zip(rows.original);
                let got: Vec<_> = pairs.map(|(&[a, b], &mut [c, d])| [a, b, c, d]).collect();
                assert_eq!(got, want[..got.len()], "{target:?}");
                assert_eq!(rows.src_idx, vec![0; got.len()], "{target:?}");
            }
        }
    }
}

#[test]
fn mappings_without_sources() {
    let text = b"C,".repeat(100);
    check((0, 96), || {
        let (pairs, indices) = (&mut [[[0; 2]; 16]; 2], &mut [0; 16]);
        let [generated, original] = pairs.each_mut().map(|pairs| pairs[..].as_mut().into());
        let src_idx = indices[..].as_mut().into();
        let columns = Columns {
            generated,
            original,
            src_idx,
            name_idx: None,
        };
        let mut state = MappingsState::default();
        let (rows, _) = sourcemap::parse_mappings(&text, columns, 0, &mut state);
        (rows.src_idx.len(), state.gen_col)
    });
}

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn push_vlq(text: &mut Vec<u8>, number: i32) {
    let mut rest = u64::from(number.unsigned_abs()) << 1 | u64::from(number < 0);
    while rest >= 32 {
        text.push(BASE64[(rest & 31 | 32) as usize]);
        rest >>= 5;
    }
    text.push(BASE64[rest as usize]);
}

type Row = ([i32; 2], [i32; 2], i32, i32);

/// The rows, the state after them, and where it stops.
fn parsed(text: &[u8], mut state: MappingsState, room: usize) -> (Vec<Row>, MappingsState, usize) {
    // One of the columns is the shortest.
    let room = |column| room + 20 * usize::from(text.len() % 4 != column);
    let (pairs, indices) = (
        &mut [0, 1].map(|column| vec![[0; 2]; room(column)]),
        &mut [2, 3].map(|column| vec![0; room(column)]),
    );
    let [generated, original] = pairs.each_mut().map(|it| it[..].as_mut().into());
    let [src_idx, name_idx] = indices.each_mut().map(|it| it[..].as_mut().into());
    let columns = Columns {
        generated,
        original,
        src_idx,
        name_idx: Some(name_idx),
    };
    let (rows, resume_at) = sourcemap::parse_mappings(text, columns, 3, &mut state);
    let names = rows.name_idx.unwrap();
    let lens = [
        rows.generated.len(),
        rows.original.len(),
        rows.src_idx.len(),
    ];
    assert_eq!(lens, [names.len(); 3]);
    let row = |i| {
        (
            rows.generated[i],
            rows.original[i],
            rows.src_idx[i],
            names[i],
        )
    };
    ((0..names.len()).map(row).collect(), state, resume_at)
}

/// Each place at which it may stop, with the number of rows and the state there.
struct Mappings {
    text: Vec<u8>,
    rows: Vec<Row>,
    stops: Vec<(usize, usize, MappingsState)>,
}

impl Mappings {
    fn new(state: MappingsState) -> Self {
        let (text, rows, stops) = (vec![], vec![], vec![(0, 0, state)]);
        Self { text, rows, stops }
    }

    fn state(&self) -> MappingsState {
        self.stops[self.stops.len() - 1].2
    }

    fn push_segment(&mut self, deltas: &[i32], lines: usize) {
        let mut now = self.state();
        let fields = [
            &mut now.gen_col,
            &mut now.src_idx,
            &mut now.orig_line,
            &mut now.orig_col,
            &mut now.name_idx,
        ];
        for (field, &delta) in fields.into_iter().zip(deltas) {
            *field = field.wrapping_add(delta);
            push_vlq(&mut self.text, delta);
        }
        now.needs_sort |= deltas[0] < 0;
        now.has_names |= deltas.len() == 5;
        if deltas.len() > 1 {
            let name = if now.has_names { now.name_idx } else { -1 };
            let pairs = ([now.gen_line, now.gen_col], [now.orig_line, now.orig_col]);
            self.rows.push((pairs.0, pairs.1, now.src_idx, name));
        }
        self.text.extend(&b","[lines.min(1)..]);
        self.stops.push((self.text.len(), self.rows.len(), now));
        for _ in 0..lines {
            (now.gen_line, now.gen_col) = (now.gen_line + 1, 0);
            self.text.push(b';');
            self.stops.push((self.text.len(), self.rows.len(), now));
        }
    }

    /// `rest` starts with something that is left to the scalar decoder, or is empty.
    fn check(&self, rest: &[u8], room: usize) {
        let text = [&self.text, rest].concat();
        for target in targets() {
            let (rows, state, at) = parsed(&text, self.stops[0].2, room);
            assert!(self.stops.contains(&(at, rows.len(), state)), "{target:?}");
            assert_eq!(rows, self.rows[..rows.len()], "{target:?}");
            let is_full = room - rows.len() < 16;
            assert!(self.text.len() - at < 64 || is_full, "{target:?}");
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn mappings_of_all_kinds() {
    let mut below = random();
    for round in 0..400 {
        let mut mappings = Mappings::new(MappingsState {
            gen_line: 5,
            gen_col: 1 << 20,
            orig_line: 2 << 20,
            orig_col: 3 << 20,
            src_idx: 1,
            name_idx: 9,
            needs_sort: round % 7 == 0,
            has_names: round % 5 == 0,
        });
        let (fields, bits, lines): (&[_], &[_], &[_]) = match round % 4 {
            0 => (&[4], &[4], &[0]),
            1 => (&[4, 4, 4, 5], &[4, 4, 9], &[0, 0, 0, 0, 1]),
            2 => (&[4, 5, 1], &[4, 4, 4, 9, 14], &[0, 0, 0, 1, 2, 70]),
            _ => (&[1], &[4, 9, 14, 19, 24], &[0, 1]),
        };
        for _ in 0..below(60) {
            let (now, mut deltas) = (mappings.state(), [0; 5]);
            let long = below(5);
            for (i, delta) in deltas.iter_mut().enumerate() {
                let bits = bits[below(bits.len())].min(if i == long { 24 } else { 9 });
                *delta = below(2 << bits) as i32 - (1 << bits) + 1;
            }
            deltas[0] = deltas[0].max(if round % 3 == 0 { 0 } else { -now.gen_col });
            deltas[1] = below(3) as i32 - now.src_idx;
            let fields = fields[below(fields.len())];
            mappings.push_segment(&deltas[..fields], lines[below(lines.len())]);
        }
        mappings.check(b"", 80);
        mappings.check(b"", round % 40);
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn mappings_left_to_the_scalar_decoder() {
    check_odd_mappings(0, 8);
    check_odd_mappings(5000, 0);
}

fn check_odd_mappings(start: i32, step: i32) {
    let odd = [
        &b"AAAg,"[..],
        b"AAAAg,",
        b"gAAA,",
        b",AAA,",
        b"gggggggA,",
        b"gAgAgAgAggA,",
    ];
    let mut odd: Vec<Vec<u8>> = odd.map(Vec::from).into();
    for fields in [0, 2, 3, 6, 7, 8, 9, 10, 11, 70] {
        odd.push([&vec![b'A'; fields][..], b","].concat());
    }
    for byte in (0..=255).filter(|byte| !BASE64.contains(byte) && !b",;".contains(byte)) {
        odd.push(vec![b'A', byte, b'A', b'A', b',']);
        odd.extend([&b","[..], b"A,"].map(|end| [b"AAAA", &[byte][..], end].concat()));
    }
    // Out of range for one or two segments, and back.
    let below = -1 - start - step;
    for (fields, field, delta) in [
        (1, 0, below),
        (4, 0, below),
        (4, 1, -2),
        (4, 1, 2),
        (4, 2, below),
        (4, 3, below),
        (4, 0, i32::MAX),
        (4, 3, i32::MAX),
    ] {
        for signs in [&[1, -1][..], &[1, 0, -1]] {
            let mut text = vec![];
            for sign in signs {
                (0..fields).for_each(|i| push_vlq(&mut text, i32::from(i == field) * sign * delta));
                text.push(b',');
            }
            odd.push(text);
        }
    }
    for (first, count) in [&[0; 4][..], &[0; 5]]
        .into_iter()
        .flat_map(|it| (0..15).map(move |n| (it, n)))
    {
        let mut mappings = Mappings::new(MappingsState {
            gen_col: start,
            orig_line: start,
            orig_col: start,
            ..Default::default()
        });
        mappings.push_segment(&[step, 1, step, step], 0);
        mappings.push_segment(first, 0);
        for _ in 0..count {
            mappings.push_segment(&[0; 4], 0);
        }
        for odd in &odd {
            mappings.check(&[odd, &b"AAAA,".repeat(14)[..]].concat(), 80);
        }
        mappings.push_segment(&[0; 4], 1);
        mappings.check(&b",AAAA".repeat(14), 80);
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn mappings_at_the_limits() {
    let mut mappings = Mappings::new(MappingsState {
        name_idx: i32::MAX,
        ..Default::default()
    });
    for _ in 0..9 {
        mappings.push_segment(&[i32::MAX, 2, 0, 0], 0);
        mappings.push_segment(&[-i32::MAX], 0);
        mappings.push_segment(&[0, -2, i32::MAX, 0], 0);
        mappings.push_segment(&[0, 0, -i32::MAX, 0], 0);
        mappings.push_segment(&[0, 0, 0, i32::MAX], 0);
        mappings.push_segment(&[0, 0, 0, -i32::MAX], 0);
        mappings.push_segment(&[511, 0, 511, 511, -511], 0);
        mappings.push_segment(&[-511, 0, -511, -511, 512], 0);
    }
    mappings.check(b"", 80);
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "cuts only a slice")]
fn line_above_is_too_short() {
    png::unfilter(1, 4, &mut [0; 8], &[0; 7]);
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "cuts only a slice")]
fn filtered_row_is_too_short() {
    let [a, b, c] = &mut [[[0; 4]; 2]; 3];
    png::filter_rgba(&[[0; 4]; 2], &[[0; 4]; 2], [a, b, c, &mut [[0; 4]]]);
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "cuts only a slice")]
fn plane_is_too_short() {
    let [a, b] = &mut [[[0; 8]; 2]; 2];
    kernels::scanner_run_stops(&[0; 65], [a, b, &mut [[0; 8]]]);
}

#[test]
fn images() {
    for t in texts(MIXED) {
        let pixels: &[[u8; 4]] = t.as_chunks().0;
        let grey_doubled = |&[r, _, _, a]: &[u8; 4]| {
            let doubled = r.saturating_mul(2);
            ([r, r, r, a], [doubled, doubled, doubled, a])
        };
        let (grey, doubled): (Vec<_>, Vec<_>) = pixels.iter().map(grey_doubled).unzip();
        check(doubled, || {
            let mut out = grey.clone();
            image::modulate(&mut out, 2.0, 0.5);
            out
        });
        // Miri adds random errors to `sin`.
        if !cfg!(miri)
            && let height @ 1.. = pixels.len() / 7
        {
            check_against_portable(|| {
                filled(19 * 3, |out| {
                    image::resize(Filter::Lanczos3, &pixels[..7 * height], 7, out, 19).unwrap()
                })
            });
        }
    }
    for filter in sample(Filter::ALL, 9) {
        check(vec![[77; 4]; 13 * 5], || {
            filled(13 * 5, |out| {
                image::resize(filter, &[[77; 4]; 21 * 9], 21, out, 13).unwrap()
            })
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn modulated_pixels() {
    let mut below = random();
    let pixels: Vec<[u8; 4]> = (0..2000)
        .map(|_| [(); 4].map(|()| below(256) as u8))
        .collect();
    for (brightness, saturation) in [(1.0, 0.0), (0.7, 1.9), (3.0, 0.2), (0.0, 1e4), (1e4, 1e4)] {
        let exact = |pixel: [u8; 4], i: usize| {
            let [r, g, b, _] = pixel.map(f64::from);
            let luma = 0.299 * r + 0.587 * g + 0.114 * b;
            let channel = luma + (f64::from(pixel[i]) - luma) * f64::from(saturation);
            (channel * f64::from(brightness)).clamp(0.0, 255.0)
        };
        for target in targets() {
            let mut out = pixels.clone();
            image::modulate(&mut out, brightness, saturation);
            for (got, &pixel) in out.iter().zip(&pixels) {
                let is_near = |i| (f64::from(got[i]) - exact(pixel, i)).abs() < 0.5001;
                assert!(
                    (0..3).all(is_near) && got[3] == pixel[3],
                    "{target:?} {pixel:?}"
                );
            }
        }
    }
}

/// The radius, and the weight at a distance.
fn filter_at(filter: Filter, x: f64) -> (f64, f64) {
    let sinc = |x: f64| {
        if x == 0.0 {
            1.0
        } else {
            (PI * x).sin() / (PI * x)
        }
    };
    let cubic = |near: [f64; 4], far: [f64; 4]| {
        let by_power = if x.abs() < 1.0 { near } else { far };
        by_power.iter().fold(0.0, |sum, it| sum * x.abs() + it)
    };
    let magic = |x: f64| match x.abs() {
        ..0.5 => 0.75 - x * x,
        x => (1.5 - x).max(0.0).powi(2) / 2.0,
    };
    let sharpened = |by_distance: &[f64]| -> f64 {
        let term = |(i, it): (usize, &f64)| it * (magic(x - i as f64) + magic(x + i as f64));
        by_distance.iter().enumerate().map(term).sum()
    };
    let (radius, weight) = match filter {
        Filter::Box | Filter::Nearest => (0.5, f64::from(x > -0.5)),
        Filter::Bilinear => (1.0, 1.0 - x.abs()),
        Filter::Lanczos2 => (2.0, sinc(x) * sinc(x / 2.0)),
        Filter::Lanczos3 => (3.0, sinc(x) * sinc(x / 3.0)),
        Filter::Mitchell => (2.0, cubic([21., -36., 0., 16.], [-7., 36., -60., 32.])),
        Filter::CatmullRom => (2.0, cubic([3., -5., 0., 2.], [-1., 5., -8., 4.])),
        Filter::Mks2013 => (2.5, sharpened(&[3.0, -1.0])),
        Filter::Mks2021 => (4.5, sharpened(&[102.0, -35.0, 6.0, -1.0])),
    };
    (radius, if x.abs() <= radius { weight } else { 0.0 })
}

fn resampled(filter: Filter, line: &[[u8; 4]], len: usize) -> Vec<[f64; 4]> {
    let scale = len as f64 / line.len() as f64;
    let stretch = if filter == Filter::Nearest {
        1.0
    } else {
        scale.min(1.0)
    };
    let reach = (filter_at(filter, 0.0).0 / stretch).min(127.0);
    let pixel = |i: usize| {
        let center = (i as f64 + 0.5) / scale - 0.5;
        let [first, last] = [-reach, reach].map(|it| (center + it + 0.5).floor().max(0.0) as usize);
        let weight = |at: usize| filter_at(filter, (at as f64 - center) * stretch).1;
        let taps = || first..line.len().min(last + 1);
        let sum = |k: usize| {
            taps()
                .map(|at| weight(at) * f64::from(line[at][k]))
                .sum::<f64>()
        };
        [0, 1, 2, 3].map(|k| (sum(k) / taps().map(weight).sum::<f64>()).clamp(0.0, 255.0))
    };
    (0..len).map(pixel).collect()
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn resized_lines() {
    let mut below = random();
    for (from, to) in [
        (11, 170),
        (11, 11),
        (40, 39),
        (170, 11),
        (3, 7),
        (1, 5),
        (1001, 1),
    ] {
        let [peak, step] = [usize::eq, usize::gt].map(|is| move |i| u8::from(is(&i, &(from / 2))));
        let ramp = |i| (255 * i / from) as u8;
        let pixel = |i| {
            [
                below(256) as u8,
                60 + 190 * peak(i),
                30 + 190 * step(i),
                ramp(i),
            ]
        };
        let line: Vec<_> = (0..from).map(pixel).collect();
        let columns: Vec<_> = line.iter().flat_map(|&pixel| [pixel; 7]).collect();
        for filter in Filter::ALL {
            let want = resampled(filter, &line, to);
            for target in targets() {
                let row = filled(to, |out| {
                    image::resize(filter, &line, from, out, to).unwrap()
                });
                assert_eq!(row.len(), to);
                for (&got, want) in row.as_flattened().iter().zip(want.as_flattened()) {
                    let error = (f64::from(got) - want).abs();
                    assert!(error < 0.7, "{target:?} {filter:?} {from} {to} {error}");
                }
                assert_eq!(
                    filled(7 * to, |out| image::resize(filter, &columns, 7, out, 7)
                        .unwrap()),
                    row.iter().flat_map(|&pixel| [pixel; 7]).collect::<Vec<_>>(),
                );
            }
        }
    }
    let mut long = vec![[255; 4]; 140_001];
    long[70_000 - 127..=70_000 + 127].fill([7; 4]);
    check(vec![[7; 4]], || {
        filled(1, |out| {
            image::resize(Filter::Box, &long, long.len(), out, 1).unwrap()
        })
    });
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn resized_images() {
    let mut below = random();
    let src: Vec<[u8; 4]> = (0..37 * 29)
        .map(|_| [(); 4].map(|()| below(256) as u8))
        .collect();
    let want = [
        4277632343, 3629949458, 1543785201, 3287213300, 1079276594, 3212018015, 2368773617,
        3102709088, 1063204064,
    ];
    check(want, || {
        Filter::ALL.map(|filter| {
            let resize = |[src_w, w, h]: [usize; 3]| {
                filled(w * h, |out| {
                    image::resize(filter, &src, src_w, out, w).unwrap()
                })
            };
            let all = [
                [37, 90, 70],
                [37, 13, 5],
                [37, 5, 61],
                [1073, 3, 1],
                [1, 2, 4],
                // Weights half way between two, near where a filter changes, and cut off.
                [123, 1, 256],
                [213, 369, 2],
                [884, 2, 1],
            ]
            .map(resize)
            .concat();
            kernels::xxhash32(0, all.as_flattened())
        })
    });
}

#[test]
fn resized_without_memory() {
    let mut out = [[0; 4]];
    let out = out.as_mut().into();
    assert!(image::resize(Filter::Box, &[[0; 4]], 1, out, usize::MAX / 2).is_err());
}

#[test]
fn moved_pixels() {
    let sizes = [1, 2, 3, 4, 5, 15, 16, 17, 64, 65, 67, 68, 70, 135];
    let all = sizes.iter().flat_map(|&w| sizes.map(|h| (w, h)));
    for (w, h) in sample(all.chain([(41, 9001), (5, 70_000), (5, 0)]), 57) {
        // What follows the last whole row does not count.
        let src: Vec<_> = (0..(w * h + w / 2) as u32).map(u32::to_le_bytes).collect();
        let room = w * h + (w + h) % 2 * 9;
        let image = |width: usize, from: &dyn Fn(usize, usize) -> [usize; 2]| -> Vec<_> {
            let places = (0..w * h).map(|i| from(i % width, i / width));
            places.map(|[x, y]| src[y * w + x]).collect()
        };
        check(image(h, &|x, y| [y, h - 1 - x]), || {
            filled(room, |out| image::rotate_90(&src, w, out))
        });
        check(image(w, &|x, y| [w - 1 - x, h - 1 - y]), || {
            filled(room, |out| image::rotate_180(&src[..w * h], out))
        });
        check(image(h, &|x, y| [w - 1 - y, x]), || {
            filled(room, |out| image::rotate_270(&src, w, out))
        });
        check(image(w, &|x, y| [w - 1 - x, y]), || {
            filled(room, |out| image::flip_horizontally(&src, w, out))
        });
        check(image(w, &|x, y| [x, h - 1 - y]), || {
            filled(room, |out| image::flip_vertically(&src, w, out))
        });
    }
}

#[test]
#[should_panic]
fn moved_pixels_without_room() {
    image::rotate_180(&[[0; 4]; 8], [[0; 4]; 7][..].as_mut().into());
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "compares only lengths")]
fn rotated_pixels_without_room() {
    image::rotate_90(&[[0; 4]; 6], 3, [[0; 4]; 5][..].as_mut().into());
}

#[test]
#[should_panic]
#[cfg_attr(miri, ignore = "compares only lengths")]
fn flipped_pixels_without_room() {
    image::flip_horizontally(&[[0; 4]; 3], 3, [[0; 4]; 2][..].as_mut().into());
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn palettes() {
    for t in texts(b"\0\x01\x7F\xFF").filter(|t| t.len() <= 1100) {
        let palette = &t.as_chunks().0[..256.min(t.len() / 4)];
        for color in [[0; 4], [255; 4], [1, 200, 3, 128]] {
            let distance = |&i: &usize| -> i32 {
                let [a, b]: [[u8; 4]; 2] = [palette[i], color];
                (0..4)
                    .map(|k| (i32::from(a[k]) - i32::from(b[k])).pow(2))
                    .sum()
            };
            check(
                (0..palette.len()).min_by_key(distance).unwrap_or(0) as u8,
                || image::nearest_in_palette(palette, color),
            );
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn distance_between_colors() {
    for len in [2, 4, 16] {
        let mut palette = vec![[5, 5, 5, 0]; len];
        palette[1] = [8, 0, 0, 0];
        check(1, || image::nearest_in_palette(&palette, [0; 4]));
        palette[1] = [9, 0, 0, 0];
        check(0, || image::nearest_in_palette(&palette, [0; 4]));
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn palettes_end_after_256_colors() {
    let mut palette = [[0; 4]; 300];
    (palette[255], palette[256], palette[280]) = ([8; 4], [9; 4], [9; 4]);
    check(255, || image::nearest_in_palette(&palette, [9; 4]));
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn memmem_with_a_concurrent_writer() {
    // `stays` has the first and the last match that is always there.
    let race = |text: &[u8], needle: &[u8], flickering: [usize; 2], stays: [usize; 2]| {
        let can_match = |at: usize| {
            let mut pairs = (at..).zip(needle);
            pairs.all(|(i, &unit)| text[i] == unit || flickering.contains(&i))
        };
        let wide = |it: &[u8]| atomic(&it.iter().flat_map(|&unit| [unit, 0]).collect::<Vec<_>>());
        let (text, needle) = (&[atomic(text), wide(text)], [atomic(needle), wide(needle)]);
        std::thread::scope(|s| {
            let reader = Arc::new(());
            let reader_if_alive = Arc::downgrade(&reader);
            s.spawn(move || {
                while reader_if_alive.strong_count() > 0 {
                    for at in flickering {
                        text[0][at].fetch_xor(1, Relaxed);
                        text[1][2 * at].fetch_xor(1, Relaxed);
                    }
                }
            });
            let [a, b] = [&text[0], &needle[0]].map(|it| SharedU8::from_slice(it));
            let [c, d] = [&text[1], &needle[1]].map(|it| SharedU8::from_slice(it).as_chunks().0);
            for _ in targets().flat_map(|_| 0..100) {
                for first in [kernels::memmem_shared(a, b), kernels::memmem16_shared(c, d)] {
                    assert!(first.is_some_and(|at| at <= stays[0] && can_match(at)));
                }
                for last in [
                    kernels::memrmem_shared(a, b),
                    kernels::memrmem16_shared(c, d),
                ] {
                    assert!(last.is_some_and(|at| at >= stays[1] && can_match(at)));
                }
            }
        });
    };
    for len in [3, 9, 23, 40, 150] {
        let needle = &b"a needle of some length".repeat(7)[..len];
        for unit in *b"ax" {
            let mut text = vec![unit; 12_000];
            for at in [100, 5000, 7000, 9000, 11_000] {
                text[at..][..len].copy_from_slice(needle);
                text[at + len / 2] ^= u8::from(at != 7000);
            }
            race(
                &text,
                needle,
                [5000, 9000].map(|at| at + len / 2),
                [7000; 2],
            );
        }
        let mut runs = [&vec![b'b'; len - 1][..], b"c"]
            .concat()
            .repeat(12_000 / len);
        let [before, joint, after] = [5000, 7000, 9000].map(|at| at / len * len - 1);
        runs[joint] = b'b';
        race(
            &runs,
            &vec![b'b'; len],
            [before, after],
            [joint + 1 - len, joint],
        );
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn memmem_of_a_needle_that_changes() {
    for (len, period) in [
        (9, &b"b"[..]),
        (40, b"b"),
        (150, b"bd"),
        (700, b"bdfhjlnprtvxz"),
    ] {
        let (needle, changes) = (period.repeat(len), [0, len / 3, len - 2]);
        let mut text = period.repeat(20_000 / period.len());
        (0..text.len())
            .step_by(len - 1)
            .for_each(|i| text[i] = b'#');
        let (text, needle) = (atomic(&text), &atomic(&needle[..len]));
        std::thread::scope(|s| {
            let reader = Arc::new(());
            let reader_if_alive = Arc::downgrade(&reader);
            s.spawn(move || {
                for at in changes.into_iter().cycle() {
                    needle[at].fetch_xor(1, Relaxed);
                    if reader_if_alive.strong_count() == 0 {
                        break;
                    }
                }
            });
            let [a, b] = [&text, needle].map(|it| SharedU8::from_slice(it));
            for _ in targets().flat_map(|_| 0..100) {
                assert_eq!(kernels::memmem_shared(a, b), None);
                assert_eq!(kernels::memrmem_shared(a, b), None);
            }
        });
    }
}

#[test]
fn with_a_concurrent_writer() {
    let lens: &[_] = match cfg!(miri) {
        true => &[3, 13, 70, 400],
        false => &[1, 3, 7, 13, 31, 40, 70, 600],
    };
    for &len in lens {
        let bytes = atomic(&vec![0; len]);
        let (text, needle) = (SharedU8::from_slice(&bytes), atomic(&[2, 0]));
        std::thread::scope(|s| {
            s.spawn(|| (0..40).for_each(|_| _ = bytes[len / 2].fetch_xor(2, Relaxed)));
            for _ in targets() {
                let needle = SharedU8::from_slice(&needle);
                for found in [
                    kernels::index_of_char_shared(text, 2),
                    kernels::last_index_of_char_shared(text, 2),
                    kernels::memmem_shared(text, needle),
                    kernels::memrmem_shared(text, needle),
                ] {
                    assert!(found.is_none_or(|at| at == len / 2));
                }
                kernels::memmem_shared(text, &text[len / 3..]);
                kernels::memmem16_shared(text.as_chunks().0, text[len / 3..].as_chunks().0);
                kernels::xxhash3_64_shared(0, text);
                kernels::xxhash64_shared(0, text);
                filled(len, |out| kernels::encode_hex_lower_from_shared(text, out));
                let out = SharedOutU8::from_slice(&bytes);
                kernels::copy_ascii_prefix_to_shared(&vec![0; len], out);
                kernels::decode_hex_to_shared(&vec![*b"00"; len], out);
            }
        });
    }
}
