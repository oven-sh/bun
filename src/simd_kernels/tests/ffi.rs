//! What C++ calls, and the functions next to it, against plain loops on each target that the CPU has.

use bun_simd::target::{Target, reset_cpu, set_cpu};
use core::ptr::{null, null_mut};
use core::sync::atomic::{AtomicBool, AtomicU8, Ordering::Relaxed};

const ROUNDS: usize = if cfg!(miri) { 2 } else { 2000 };
const LONGEST: usize = if cfg!(miri) { 90 } else { 700 };
const NOT_FOUND: usize = usize::MAX;

type Scan<T> = unsafe extern "C" fn(*const T, usize) -> usize;
type Search = unsafe extern "C" fn(*const u8, usize, *const u8, usize) -> usize;
type Map<T, U> = unsafe extern "C" fn(*const T, usize, *mut U);

unsafe extern "C" {
    fn bun_simd_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize;
    fn bun_simd_last_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize;
    fn bun_simd_memmem(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_memrmem(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_memmem16(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_memrmem16(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_plain_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize;
    fn bun_simd_plain_last_index_of_char(haystack: *const u8, len: usize, needle: u8) -> usize;
    fn bun_simd_plain_memmem(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_plain_memrmem(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_plain_memmem16(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_plain_memrmem16(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> usize;
    fn bun_simd_bswap16(data: *mut u8, len: usize);
    fn bun_simd_bswap32(data: *mut u8, len: usize);
    fn bun_simd_bswap64(data: *mut u8, len: usize);
    fn bun_simd_first_non_ascii8(text: *const u8, len: usize) -> usize;
    fn bun_simd_first_non_ascii16(text: *const u16, len: usize) -> usize;
    fn bun_simd_index_of_escape_char8(text: *const u8, len: usize) -> usize;
    fn bun_simd_index_of_escape_char16(text: *const u16, len: usize) -> usize;
    fn bun_simd_index_of_first_ascii_upper8(text: *const u8, len: usize) -> usize;
    fn bun_simd_index_of_first_ascii_upper16(text: *const u16, len: usize) -> usize;
    fn bun_simd_index_of_html_escape_char8(text: *const u8, len: usize) -> usize;
    fn bun_simd_index_of_html_escape_char16(text: *const u16, len: usize) -> usize;
    fn bun_simd_count_printable_ascii16(text: *const u16, len: usize) -> usize;
    fn bun_simd_strip_csi8(from: *const u8, len: usize, to: *mut u8, written: &mut usize) -> usize;
    fn bun_simd_strip_csi16(
        from: *const u16,
        len: usize,
        to: *mut u16,
        written: &mut usize,
    ) -> usize;
    fn bun_simd_visible_utf16_width_exclude_ansi(
        text: *const u16,
        len: usize,
        width: &mut usize,
        done: &mut usize,
    ) -> usize;
    fn bun_simd_escape_html8(from: *const u8, len: usize, to: *mut u8, to_len: usize);
    fn bun_simd_escape_html16(from: *const u16, len: usize, to: *mut u16, to_len: usize);
    fn bun_simd_html_escape_extra_len8(text: *const u8, len: usize) -> usize;
    fn bun_simd_html_escape_extra_len16(text: *const u16, len: usize) -> usize;
    fn bun_simd_visible_latin1_width(text: *const u8, len: usize) -> usize;
    fn bun_simd_visible_latin1_width_exclude_ansi(text: *const u8, len: usize) -> usize;
    fn bun_simd_visible_utf16_width(text: *const u16, len: usize, width: &mut usize) -> usize;
    fn bun_simd_lower_ascii8(from: *const u8, len: usize, to: *mut u8);
    fn bun_simd_lower_ascii16(from: *const u16, len: usize, to: *mut u16);
    fn bun_simd_narrow_to_latin1(from: *const u16, len: usize, to: *mut u8);
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    fn memmem(a: *const u8, a_len: usize, b: *const u8, b_len: usize) -> *mut u8;
}

struct Random(u64);

impl Random {
    fn below(&mut self, limit: usize) -> usize {
        self.0 = self.0.wrapping_mul(0x5851_f42d_4c95_7f2d).wrapping_add(1);
        (self.0 >> 33) as usize % limit
    }

    /// Units of `common`, with those of `rare` here and there. The allocation is no larger.
    fn text<T: Copy>(&mut self, longest: usize, common: &[T], rare: &[T]) -> Box<[T]> {
        let (longest, every) = (longest >> self.below(5), 1 << self.below(9));
        (0..self.below(longest + 1))
            .map(|_| {
                let from = if self.below(every) == 0 { rare } else { common };
                from[self.below(from.len())]
            })
            .collect()
    }
}

/// Null if it is empty, as C++ has it.
fn start<T>(values: &[T]) -> *const T {
    if values.is_empty() {
        null()
    } else {
        values.as_ptr()
    }
}

fn scan<T>(f: Scan<T>, text: &[T]) -> usize {
    // SAFETY: a slice.
    unsafe { f(start(text), text.len()) }
}

/// To memory that is not initialized.
fn map<T, U>(f: Map<T, U>, from: &[T]) -> Box<[U]> {
    let mut to = Box::new_uninit_slice(from.len());
    let room = if to.is_empty() {
        null_mut()
    } else {
        to.as_mut_ptr()
    };
    // SAFETY: two slices of the same length, and `f` fills the second.
    unsafe {
        f(start(from), from.len(), room.cast());
        to.assume_init()
    }
}

/// What a buffer is made of, with a byte more at the start.
fn buffer(bytes: &[u8]) -> Box<[AtomicU8]> {
    [0].iter().chain(bytes).map(|&it| it.into()).collect()
}

fn search(f: Search, unit: usize, haystack: &[u8], needle: &[u8]) -> Option<usize> {
    let (a, b) = (haystack.len() / unit, needle.len() / unit);
    let (haystack, needle) = (buffer(haystack), buffer(needle));
    let (haystack, needle) = (start(&haystack[1..]), start(&needle[1..]));
    // SAFETY: two slices.
    let found = unsafe { f(haystack.cast(), a, needle.cast(), b) };
    (found != NOT_FOUND).then_some(found)
}

fn first<T: Copy + Into<u32>>(text: &[T], matches: impl Fn(u32) -> bool) -> usize {
    text.iter().take_while(|&&c| !matches(c.into())).count()
}

fn sum<T: Copy + Into<u32>>(text: &[T], weight: impl Fn(u32) -> usize) -> usize {
    text.iter().map(|&c| weight(c.into())).sum()
}

fn html_entity(c: u32) -> Option<&'static str> {
    Some(match char::from_u32(c)? {
        '"' => "&quot;",
        '\'' => "&#x27;",
        '&' => "&amp;",
        '<' => "&lt;",
        '>' => "&gt;",
        _ => return None,
    })
}

fn html_extra(c: u32) -> usize {
    html_entity(c).map_or(0, |it| it.len() - 1)
}

fn check_escape_html<T: Copy + PartialEq + From<u8> + Into<u32>>(
    f: unsafe extern "C" fn(*const T, usize, *mut T, usize),
    text: &[T],
) {
    let mut expected = Vec::with_capacity(6 * text.len());
    for &c in text {
        match html_entity(c.into()) {
            Some(entity) => expected.extend(entity.bytes().map(T::from)),
            None => expected.push(c),
        }
    }
    let mut to = Box::<[T]>::new_uninit_slice(expected.len());
    // SAFETY: two slices, and `f` fills the second.
    let escaped = unsafe {
        f(start(text), text.len(), to.as_mut_ptr().cast(), to.len());
        to.assume_init()
    };
    assert!(*escaped == *expected);
}

/// Where the units are that are not in a CSI, and whether another sequence can start after them.
fn outside_of_csi<T: Copy + Into<u32>>(text: &[T]) -> (Vec<usize>, bool) {
    let (mut at, mut outside, mut inside) = (0, Vec::new(), false);
    while let Some(&c) = text.get(at) {
        match (c.into(), text.get(at + 1).map(|&it| it.into())) {
            (0x1b, Some(0x5b)) => (at, inside) = (at + 1, true),
            (0x1b | 0x90..=0x9f, _) => return (outside, true),
            (0x40..=0x7e | 0x18 | 0x1a, _) if inside => inside = false,
            _ if inside => {}
            _ => outside.push(at),
        }
        at += 1;
    }
    (outside, false)
}

/// Whether there are only text and whole CSIs before `at`.
fn is_between_sequences<T: Copy + Into<u32>>(text: &[T], at: usize) -> bool {
    let before = text[..at].iter().map(|&c| c.into());
    let (outside, stops) = outside_of_csi(&before.chain([0x61]).collect::<Vec<u32>>());
    !stops && (outside.last() == Some(&at) || text.get(at).is_none_or(|&c| c.into() == 0x1b))
}

fn check_strip_csi<T: Copy + PartialEq + Into<u32>>(
    f: unsafe extern "C" fn(*const T, usize, *mut T, &mut usize) -> usize,
    text: &[T],
) {
    let (mut to, mut written): (Box<[T]>, _) = (text.iter().rev().copied().collect(), 0);
    // SAFETY: two slices of the same length.
    let done = unsafe { f(start(text), text.len(), to.as_mut_ptr(), &mut written) };
    let (mut outside, stops) = outside_of_csi(text);
    if text.len() <= 32 {
        assert!(outside.iter().all(|&at| at < done) && (stops || done == text.len()));
    }
    assert!(is_between_sequences(text, done));
    outside.retain(|&at| at < done);
    assert!(to[..written].iter().eq(outside.iter().map(|&at| &text[at])));
}

fn is_escape(c: u32) -> bool {
    matches!(c, 0x1b | 0x90 | 0x98 | 0x9b..=0x9f)
}

fn latin1_width(c: u32) -> usize {
    matches!(c, 0x20..=0x7e | 0xa0..=0xac | 0xae..=0xff).into()
}

fn utf16_width(c: u16) -> Option<usize> {
    match c {
        0x20..=0x7e | 0xa0..=0xa8 | 0xaa..=0xac | 0xaf..=0x2ff => Some(1),
        0x370..=0x482 | 0x48a..=0x52f | 0x2010..=0x2027 | 0x2500..=0x25a9 => Some(1),
        0x3000..=0x3029 | 0x3041..=0x3096 | 0x309b..=0x30ff | 0x3300..=0x9fff => Some(2),
        0xac00..=0xd7a3 | 0xff01..=0xff60 => Some(2),
        _ => None,
    }
}

fn width_without_ansi(text: &[u8]) -> usize {
    #[derive(Copy, Clone)]
    enum In {
        Text,
        Escape,
        Charset,
        Csi,
        Osc,
        Payload,
        EscapeInPayload,
    }
    let (mut state, mut width) = (In::Text, 0);
    for &c in text {
        state = match (state, c) {
            (In::Osc | In::Payload, 0x1b) => In::EscapeInPayload,
            (_, 0x1b) => In::Escape,
            (In::Charset, _) | (In::Osc, 0x07) | (In::EscapeInPayload, b'\\') => In::Text,
            (In::Csi, 0x40..=0x7e) => In::Text,
            (In::Csi | In::Osc | In::Payload, 0x18 | 0x1a | 0x9c) => In::Text,
            (In::Csi | In::Osc | In::Payload, _) => state,
            (In::Escape | In::EscapeInPayload, b'[') | (_, 0x9b) => In::Csi,
            (In::Escape | In::EscapeInPayload, b']') | (_, 0x9d) => In::Osc,
            (In::Escape | In::EscapeInPayload, b'P' | b'X' | b'^' | b'_') => In::Payload,
            (_, 0x90 | 0x98 | 0x9e | 0x9f) => In::Payload,
            (In::Escape | In::EscapeInPayload, 0x20..=0x2f) => In::Charset,
            (In::Escape | In::EscapeInPayload, 0x30..=0x7e) => In::Text,
            _ => {
                width += latin1_width(c.into());
                In::Text
            }
        };
    }
    width
}

fn check_latin1(text: &[u8]) {
    let upper = |c| matches!(c, 0x41..=0x5a);
    for (f, expected) in [
        (
            bun_simd_first_non_ascii8 as Scan<u8>,
            first(text, |c| c > 0x7f),
        ),
        (bun_simd_index_of_escape_char8, first(text, is_escape)),
        (bun_simd_index_of_first_ascii_upper8, first(text, upper)),
        (
            bun_simd_index_of_html_escape_char8,
            first(text, |c| html_extra(c) > 0),
        ),
        (bun_simd_html_escape_extra_len8, sum(text, html_extra)),
        (bun_simd_visible_latin1_width, sum(text, latin1_width)),
        (
            bun_simd_visible_latin1_width_exclude_ansi,
            width_without_ansi(text),
        ),
    ] {
        assert_eq!(scan(f, text), expected, "{text:?}");
    }
    check_escape_html(bun_simd_escape_html8, text);
    check_strip_csi(bun_simd_strip_csi8, text);
    assert_eq!(*map(bun_simd_lower_ascii8, text), text.to_ascii_lowercase());

    for room in [text.len() / 2, text.len(), text.len() + 3] {
        let (mut to, ascii) = (vec![0xf7; room], first(text, |c| c > 0x7f).min(room));
        assert_eq!(bun_simd_kernels::copy_ascii_prefix(text, &mut to), ascii);
        assert!(to[..ascii] == text[..ascii] && to[ascii..].iter().all(|&it| it == 0xf7));
    }
    let mut to = vec![7; text.len()];

    let mask = [1, 0x82, 0x43, 0xf4];
    let masked: Vec<u8> = text
        .iter()
        .zip(mask.iter().cycle())
        .map(|(a, b)| a ^ b)
        .collect();
    bun_simd_kernels::fill_with_skip_mask(mask, &mut to, text, false);
    assert_eq!(to, masked);
    bun_simd_kernels::fill_with_skip_mask_inplace(mask, &mut to, false);
    assert_eq!(to, text);
    to.push(7);
    bun_simd_kernels::fill_with_skip_mask(mask, &mut to, &masked, true);
    bun_simd_kernels::fill_with_skip_mask_inplace(mask, &mut to, true);
    assert_eq!(to.split_last(), Some((&7, &*masked)));
}

fn check_utf16(text: &[u16]) {
    let (upper, printable) = (
        |c| matches!(c, 0x41..=0x5a),
        |c| matches!(c, 0x20..=0x7e).into(),
    );
    for (f, expected) in [
        (
            bun_simd_first_non_ascii16 as Scan<u16>,
            first(text, |c| c > 0x7f),
        ),
        (bun_simd_index_of_escape_char16, first(text, is_escape)),
        (bun_simd_index_of_first_ascii_upper16, first(text, upper)),
        (
            bun_simd_index_of_html_escape_char16,
            first(text, |c| html_extra(c) > 0),
        ),
        (bun_simd_html_escape_extra_len16, sum(text, html_extra)),
        (bun_simd_count_printable_ascii16, sum(text, printable)),
    ] {
        assert_eq!(scan(f, text), expected, "{text:?}");
    }
    check_escape_html(bun_simd_escape_html16, text);
    check_strip_csi(bun_simd_strip_csi16, text);
    let mut odd: Vec<u8> = [0, 0]
        .into_iter()
        .chain(text.iter().flat_map(|c| c.to_ne_bytes()))
        .collect();
    let skip = 1 - odd.as_ptr().addr() % 2;
    odd.copy_within(2..2 + 2 * text.len(), skip);
    // SAFETY: as many units, at an odd address.
    let found = unsafe { bun_simd_first_non_ascii16(odd[skip..].as_ptr().cast(), text.len()) };
    assert_eq!(found, first(text, |c| c > 0x7f));

    let widths = text.iter().map_while(|&c| utf16_width(c));
    let mut width = 3;
    // SAFETY: a slice.
    let units = unsafe { bun_simd_visible_utf16_width(start(text), text.len(), &mut width) };
    assert_eq!(
        (units, width),
        (widths.clone().count(), 3 + widths.sum::<usize>())
    );

    let (before, mut width, mut done) = (units.min(100), 0, 0);
    // SAFETY: a slice.
    let units = unsafe {
        bun_simd_visible_utf16_width_exclude_ansi(start(text), text.len(), &mut width, &mut done)
    };
    assert!(is_between_sequences(text, done));
    let (outside, _) = outside_of_csi(&text[..units.max(done)]);
    let widths = outside.iter().map(|&at| utf16_width(text[at]));
    assert!(units >= before && units == outside.last().map_or(0, |at| at + 1));
    assert_eq!(widths.sum::<Option<usize>>(), Some(width));

    let lower = text
        .iter()
        .map(|&c| if upper(c.into()) { c | 0x20 } else { c });
    assert!(map(bun_simd_lower_ascii16, text).iter().copied().eq(lower));
    let narrow = text.iter().map(|&c| u8::try_from(c).unwrap_or(b'?'));
    assert!(
        map(bun_simd_narrow_to_latin1, text)
            .iter()
            .copied()
            .eq(narrow)
    );
    let mut to = vec![7; text.len()];
    bun_simd_kernels::copy_u16_to_u8(text, &mut to);
    assert!(to.iter().copied().eq(text.iter().map(|&c| c as u8)));
}

fn check_hex(bytes: &[u8], spoiled: usize) {
    let mut digits = vec![0; 2 * bytes.len()];
    bun_simd_kernels::encode_hex_lower(bytes, &mut digits);
    let digit = |it: u8| b"0123456789abcdef"[usize::from(it)];
    assert!(
        digits
            .iter()
            .copied()
            .eq(bytes.iter().flat_map(|it| [digit(it >> 4), digit(it & 15)]))
    );
    if let Some(it) = digits.get_mut(spoiled) {
        *it = b"/:@G`g\xc1\xb0"[bytes.len() % 8];
    }
    let wide: Vec<u16> = digits
        .iter()
        .map(|it| u16::from(it.to_ascii_uppercase()) | 0xff00)
        .collect();
    let (mut a, mut b, good) = (
        vec![7; bytes.len()],
        vec![7; bytes.len()],
        bytes.len().min(spoiled / 2),
    );
    assert_eq!(bun_simd_kernels::decode_hex(&digits, &mut a), good);
    assert_eq!(bun_simd_kernels::decode_hex_u16(&wide, &mut b), good);
    assert!(a[..good] == bytes[..good] && a[good..].iter().all(|&it| it == 7) && a == b);
}

/// Any text, and room that is too small or too large.
fn check_decode_hex(text: &[u8]) {
    let wide: Vec<u16> = text.iter().map(|&it| u16::from(it) | 0x3100).collect();
    let digit = |it: u8| char::from(it).to_digit(16);
    let pairs = text.as_chunks().0.iter();
    let bytes = pairs.map_while(|&[high, low]| Some((digit(high)? << 4 | digit(low)?) as u8));
    for room in [text.len() / 3, text.len() / 2, text.len()] {
        let mut expected: Vec<u8> = bytes.clone().take(room).collect();
        let (mut a, mut b, good) = (vec![7; room], vec![7; room], expected.len());
        expected.resize(room, 7);
        assert_eq!(bun_simd_kernels::decode_hex(text, &mut a), good);
        assert_eq!(bun_simd_kernels::decode_hex_u16(&wide, &mut b), good);
        assert!(a == expected && b == expected, "{text:?}");
    }
}

fn check_ansi(text: &[u8]) {
    let width = scan(bun_simd_visible_latin1_width_exclude_ansi, text);
    assert_eq!(width, width_without_ansi(text), "{text:?}");
    check_strip_csi(bun_simd_strip_csi8, text);
}

/// Sequences that start and end at the borders of vectors.
fn check_sequences(random: &mut Random) {
    let starts = [
        &b""[..],
        b"\x1b",
        b"\x1b(",
        b"\x1b[",
        b"\x1b]",
        b"\x1bP",
        b"\x9b",
    ];
    for start in starts {
        for byte in 0..=255 {
            for at in [0, 13, 14, 15, 29, 30, 31, 61, 62, 63] {
                for rest in [&b""[..], b"[m\x07aa", &[b'm'; 70], &[b'1'; 70]] {
                    let text = [&[b'a'; 63][..at], start, &[byte], rest].concat();
                    check_ansi(&text);
                    check_ansi(&[start, &[b'1'; 63][..at], &[byte], rest].concat());
                    if at % 16 != 15 {
                        for before in [&b""[..], b"aa", b"a\x1b[m"] {
                            let units = before.iter().chain(&text).map(|&it| it.into());
                            check_utf16(&units.collect::<Vec<_>>());
                        }
                    }
                }
            }
        }
    }
    for unit in 0..=256 {
        check_utf16(&[&[0x61, 0x61, unit, 0x61, 0x0a][..], &[0x61; 20]].concat());
    }
    check_utf16(&[0x61, 0x3000, 0x61]);
    check_ansi(&[&[0x1b; 64][..], b"[1m", &[b'a'; 64]].concat());
    check_ansi(b"\x1b[\x91m\x1b]aa");
    check_ansi(b"\x1b^1\x07aa\x1b]1\x07a");
    check_ansi(b"\x1c]\x1c\\aaaa\x91");
    check_ansi(&[&[0x9b][..], &[0xa0; 70]].concat());
    for len in 0..140 {
        check_ansi(&[&[b'a'; 140][..len], b"\x1b[m"].concat());
    }
    for (at, byte) in (0..700).zip(b"\x1f\n\x07\x7f\xad\x9c\x1b\x18\x1a".iter().cycle()) {
        for start in [&b"a"[..], b"\n", b"\x1b]"] {
            check_ansi(&[start, &[b'a'; 700][..at], &[*byte], &[0xe9; 130]].concat());
        }
    }
    for code in 0..7usize.pow(5) {
        let short = [0, 1, 2, 3, 4].map(|i| b"\x1b[]\\1m\x07"[code / 7usize.pow(i) % 7]);
        check_ansi(&short);
        check_ansi(&[b"aaa", &short[..]].concat());
        check_ansi(&[b"\x1b]", &short[..], &[b'1'; 70]].concat());
    }
    for code in 0..6usize.pow(5) {
        let short = [0, 1, 2, 3, 4].map(|i| b"\x1b[(7a\x9b"[code / 6usize.pow(i) % 6]);
        for at in [3, 11, 28, 60] {
            check_ansi(&[&[b'a'; 60][..at], &short].concat());
            check_ansi(&[&[b'a'; 60][..at], &short, &[b'1'; 70]].concat());
        }
    }
    for (at, byte) in (0..199).cycle().zip((0..=255).cycle()).take(199 * 256) {
        for start in starts {
            check_ansi(&[start, &[b'\n'; 200][..at], &[byte], &[b'1'; 130]].concat());
        }
    }
    let ends = [&b"m"[..], b"\x07", b"\x1b\\", b"", b"\x18"];
    for _ in 0..10 * ROUNDS {
        let (mut text, longest) = (Vec::new(), 1 << random.below(8));
        for _ in 0..random.below(30) {
            let is_osc = random.below(2);
            text.extend_from_slice([b"\x1b[", b"\x1b]"][is_osc]);
            text.resize(text.len() + random.below(longest), b'1');
            text.extend_from_slice(ends[[0, 0, 3, 4, 1, 2, 2, 3][4 * is_osc + random.below(4)]]);
            text.resize(text.len() + random.below(longest), b'2');
        }
        check_ansi(&text);
    }
    // Colors that are close to each other are all skipped.
    for plain in ["a", "世", "│"].into_iter().cycle().take(ROUNDS) {
        let parts = random.text(60, &["\x1b[0m", "\x1b[1;2m\x1b[m"], &["\x1b[K"]);
        let text = ["a\x1b[38;5;200;1;2;3;4ma", &parts.join(plain), "a\n"].concat();
        let (text, mut width): (Vec<u16>, _) = (text.encode_utf16().collect(), 0);
        // SAFETY: a slice.
        let units = unsafe {
            bun_simd_visible_utf16_width_exclude_ansi(text.as_ptr(), text.len(), &mut width, &mut 0)
        };
        assert_eq!(units, text.len() - 1);
        let (mut to, len) = (text.clone(), text.len());
        // SAFETY: two slices of the same length.
        let done = unsafe { bun_simd_strip_csi16(text.as_ptr(), len, to.as_mut_ptr(), &mut 0) };
        assert_eq!(done, len);
        check_utf16(&text);
    }
    for len in 0..140 {
        // The end is among other control characters.
        for start in [&b"\x1b]"[..], b"\x9d"] {
            check_ansi(&[start, &vec![b'\n'; len], b"\x07", &[b'\n'; 70], b"a"].concat());
        }
        check_ansi(&[b"\x1b[\x91", &vec![b'1'; len][..], &[b'm'; 70]].concat());
        // What is not in a run follows a color.
        check_utf16(
            &[
                &vec![0x61; len][..],
                &[0x1b, 0x5b, 0x6d, 0x301],
                &[0x61; 70],
            ]
            .concat(),
        );
    }
    // Far from the last one.
    for len in 150..330 {
        for unit in [0x61, 0x7e, 0x7f, 0x1f, 0xe9, 0x3000] {
            let mut text = vec![0x20; len];
            text[len / 2..].fill(unit);
            check_utf16(
                &[
                    &[0x61, 0x1b, 0x5b, 0x6d],
                    &text[..],
                    &[0x1b, 0x5b, 0x6d, unit],
                ]
                .concat(),
            );
            check_utf16(&[&[0x61, 0x1b, 0x5b], &text[..], &[0x6d, unit]].concat());
        }
    }
}

/// The needle is at one place only, among others that differ in the second unit.
fn check_each_place(len: usize, needle_len: usize, gap: usize, near: usize, skip: usize) {
    fn check<T: Copy>(
        hay: &mut [T],
        needle: &[T],
        at: usize,
        both: [fn(&[T], &[T]) -> Option<usize>; 2],
    ) {
        let before = hay[at..at + needle.len()].to_vec();
        hay[at..at + needle.len()].copy_from_slice(needle);
        assert_eq!(both.map(|f| f(hay, needle)), [Some(at); 2], "{}", hay.len());
        hay[at..at + needle.len()].copy_from_slice(&before);
    }
    let mut needle = vec![b'a'; needle_len];
    let miss = [&needle[..], &vec![b'-'; gap]].concat();
    let mut hay: Vec<u8> = miss.into_iter().cycle().take(skip + len).collect();
    needle[1] = 0xff;
    let wide = |it: &[u8]| it.iter().map(|&it| it.into()).collect::<Vec<u16>>();
    let (mut wide_hay, wide_needle, last) = (wide(&hay), wide(&needle), len - needle_len);
    for at in (0..=last).filter(|&at| at.min(last - at) < near) {
        use bun_simd_kernels::{memmem, memmem16, memrmem, memrmem16};
        check(&mut hay[skip..], &needle, at, [memmem, memrmem]);
        check(
            &mut wide_hay[skip..],
            &wide_needle,
            at,
            [memmem16, memrmem16],
        );
    }
}

fn check_edges() {
    // One unit, among others that differ in one bit. A tail can be padded with zeros.
    for unit in [0, 0x8001] {
        for len in 0..200 {
            let both = [bun_simd_kernels::memmem16, bun_simd_kernels::memrmem16];
            let mut hay: Vec<u16> = (0..len).map(|at| unit ^ (1 << (at % 16))).collect();
            assert_eq!(both.map(|f| f(&hay, &[unit])), [None; 2]);
            for at in (0..len).rev() {
                hay[at] = unit;
                assert_eq!(both.map(|f| f(&hay, &[unit])), [at, len - 1].map(Some));
            }
        }
    }
    for (needle_len, gap) in [(2, 0), (5, 0), (5, 9), (40, 1)] {
        for spare in 0..200 {
            check_each_place(needle_len + spare, needle_len, gap, 200, 0);
        }
        for skip in 0..64 {
            check_each_place(needle_len + 2300, needle_len, gap, 70, skip);
        }
    }
    for len in 60..130 {
        check_each_place(2100 + len, 2100, 0, 9, 0);
    }
    // All candidates are at one end.
    for needle_len in [6, 40, 2100] {
        let mut needle = vec![b'a'; needle_len];
        needle[2..4].fill(b'b');
        for spare in 0..70 {
            for at in [0, spare] {
                let mut run = vec![b'a'; needle_len + spare];
                run[at..][..needle_len].copy_from_slice(&needle);
                check_search(&[&[b'-'; 200][..], &run].concat(), &needle);
                check_search(&[&run[..], &[b'-'; 200]].concat(), &needle);
            }
        }
    }
    for skip in 0..64 {
        for len in [32, 64] {
            let text = [&vec![b'-'; skip + len][..], &[b'a'; 600]].concat();
            assert_eq!(bun_simd_kernels::memmem(&text[skip..], b"aa"), Some(len));
        }
    }
    for byte in 0..=255 {
        for len in [2, 31, 32, 64, 129] {
            for other in *b"1aF" {
                let (mut one, mut half) = (vec![other; len], vec![other; len]);
                one[usize::from(byte) % len] = byte;
                half[len / 2..].fill(byte);
                check_decode_hex(&one);
                check_decode_hex(&half);
                half.reverse();
                check_decode_hex(&half);
            }
            check_decode_hex(&vec![byte; len]);
        }
    }
    // The shortest entity at each place, where there is the least room.
    for len in 1..140 {
        for at in 0..len {
            let (mut bytes, mut units) = (vec![b'a'; len], vec![0x61; len]);
            (bytes[at], units[at]) = (b'<', 0x3c);
            check_escape_html(bun_simd_escape_html8, &bytes);
            check_escape_html(bun_simd_escape_html16, &units);
            for other in [0x80, b'A', 0x1b].into_iter().filter(|_| len < 70) {
                (bytes[at], units[at]) = (other, other.into());
                check_latin1(&bytes);
                check_utf16(&units);
            }
        }
    }
    // A needle at each place among its near misses.
    for needle in [
        &b"abca"[..],
        b"aab",
        b"abcdefghijklmnopqrstuvwxyz0123456789a",
    ] {
        let mut miss = needle.to_vec();
        miss[1] = b'-';
        let misses = miss.repeat(2400 / miss.len());
        for at in (0..misses.len() - needle.len()).filter(|at| (at + 140) % 800 < 280) {
            let mut haystack = misses.clone();
            haystack[at..][..needle.len()].copy_from_slice(needle);
            check_search(&haystack, needle);
        }
    }
    check_search(&[b'a'; 3000], b"aba");
    let noise: Vec<u8> = (0..700u32)
        .map(|it| (it * it * it % 1009 % 2) as u8)
        .collect();
    for at in 0..noise.len() - 20 {
        check_search(&noise, &noise[at..at + 20]);
    }
    // At each place of each length: one, and all from there on.
    for len in 0..200 {
        let (mut one, mut all) = (vec![1; len + 1], vec![0; len + 1]);
        for at in 0..=len {
            one[at] = 0;
            for text in [&one, &all] {
                // SAFETY: a part of a slice.
                assert_eq!(unsafe { bun_simd_index_of_char(text.as_ptr(), len, 0) }, at);
            }
            (one[at], all[at]) = (1, 1);
        }
    }
    // Far from the end, at each address: one, and all up to there.
    for skip in 0..64 {
        let (mut one, mut all, len) = (vec![1; 1700], vec![1; 1700], 1700 - 64);
        for at in 0..len {
            (one[skip + at], all[skip + at]) = (0, 0);
            for text in [&one, &all] {
                // SAFETY: a part of a slice.
                let found = unsafe { bun_simd_last_index_of_char(text[skip..].as_ptr(), len, 0) };
                assert_eq!(found, at);
            }
            one[skip + at] = 1;
        }
    }
    // Far behind control characters that are no escapes.
    for at in (1..9000).filter(|at| (at + 9) % 1024 < 80 || at % 97 == 0) {
        let mut text = vec![b'a'; 9000];
        (text[0], text[4102], text[at]) = (0x11, 0x91, 0x9b);
        assert_eq!(scan(bun_simd_index_of_escape_char8, &text), at);
    }
    let one = [&[0x11][..], &[b'a'; 9000]].concat();
    assert_eq!(scan(bun_simd_index_of_escape_char8, &one), one.len());
    let small = std::thread::Builder::new().stack_size(1 << 19);
    let found = small.spawn(|| scan(bun_simd_index_of_escape_char8, &vec![0x11; 1 << 26]));
    assert_eq!(found.unwrap().join().unwrap(), 1 << 26);
}

fn check_search(haystack: &[u8], needle: &[u8]) {
    fn both<T: PartialEq>(haystack: &[T], needle: &[T]) -> [Option<usize>; 2] {
        let mut starts = (0..=haystack.len()).filter(|&at| haystack[at..].starts_with(needle));
        let first = starts.next();
        [first, starts.next_back().or(first)]
    }
    let expected = both(haystack, needle);
    for pair in [
        [bun_simd_memmem as Search, bun_simd_memrmem],
        [bun_simd_plain_memmem, bun_simd_plain_memrmem],
    ] {
        let found = pair.map(|f| search(f, 1, haystack, needle));
        assert_eq!(found, expected, "{needle:?} in {haystack:?}");
    }
    let found = [bun_simd_kernels::memmem, bun_simd_kernels::memrmem].map(|f| f(haystack, needle));
    assert_eq!(found, expected, "{needle:?} in {haystack:?}");
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    {
        let (a, b) = (start(haystack), start(needle));
        // SAFETY: two slices.
        let found = unsafe { memmem(a, haystack.len(), b, needle.len()) };
        assert_eq!(
            found.cast_const(),
            expected[0].map_or(null(), |at| a.wrapping_add(at))
        );
    }

    let units = |bytes: &[u8]| -> Vec<u16> {
        bytes
            .as_chunks()
            .0
            .iter()
            .map(|&it| u16::from_ne_bytes(it))
            .collect()
    };
    let (a, b) = (units(haystack), units(needle));
    let expected = both(&a, &b);
    for pair in [
        [bun_simd_memmem16 as Search, bun_simd_memrmem16],
        [bun_simd_plain_memmem16, bun_simd_plain_memrmem16],
    ] {
        let found = pair.map(|f| search(f, 2, haystack, needle));
        assert_eq!(found, expected, "{needle:?} in {haystack:?}");
    }
    assert_eq!(
        [bun_simd_kernels::memmem16, bun_simd_kernels::memrmem16].map(|f| f(&a, &b)),
        expected
    );
}

fn check_buffer(bytes: &[u8]) {
    let shared = buffer(bytes);
    let (at, len) = (start(&shared[1..]).cast(), bytes.len());
    // SAFETY: a slice.
    let found = unsafe {
        [
            [
                bun_simd_index_of_char(at, len, 0),
                bun_simd_last_index_of_char(at, len, 0),
            ],
            [
                bun_simd_plain_index_of_char(at, len, 0),
                bun_simd_plain_last_index_of_char(at, len, 0),
            ],
        ]
    };
    let expected = [
        (0..len).find(|&at| bytes[at] == 0),
        (0..len).rfind(|&at| bytes[at] == 0),
    ];
    assert_eq!(found, [expected.map(|it| it.unwrap_or(len)); 2]);
    for from in [0, len / 2, len, len + 1, usize::MAX] {
        assert_eq!(
            bun_simd_kernels::SharedBytes::new(&shared[1..]).index_of_char(from, 0),
            (from..len).find(|&at| bytes[at] == 0)
        );
    }
    let (mut digits, mut expected) = (vec![0; 2 * len], vec![0; 2 * len]);
    bun_simd_kernels::SharedBytes::new(&shared[1..]).encode_hex_lower(&mut digits);
    bun_simd_kernels::encode_hex_lower(bytes, &mut expected);
    assert_eq!(digits, expected);
    for (f, size) in SWAPS {
        for skip in [0, len % size] {
            let mut data: Vec<u8> = (len..=2 * len).map(|at| (at * 77 % 251) as u8).collect();
            let mut expected = data.clone();
            expected[skip..len]
                .chunks_exact_mut(size)
                .for_each(<[u8]>::reverse);
            let at = if skip == len {
                null_mut()
            } else {
                data[skip..].as_mut_ptr()
            };
            // SAFETY: a slice.
            unsafe { f(at, len - skip) };
            assert_eq!(data, expected);
        }
    }
}

const SWAPS: [(unsafe extern "C" fn(*mut u8, usize), usize); 3] = [
    (bun_simd_bswap16, 2),
    (bun_simd_bswap32, 4),
    (bun_simd_bswap64, 8),
];

/// Around the start of a page, between units that match.
fn check_one_unit() {
    use bun_simd_kernels::{memmem16, memrmem16};
    for unit in [0, 10, 0x6100, 0xffff_u16] {
        let (mut data, other) = (vec![unit; 3 * 2048], unit.swap_bytes() ^ 0x100);
        let page = 2048 + data.as_ptr().addr().wrapping_neg() % 4096 / 2;
        for len in 0..200 {
            for end in [page - 31, page - 1, page, page + 1, page + len] {
                let text = &mut data[end - len..end];
                text.fill(other);
                let both = |text: &[u16]| [memmem16(text, &[unit]), memrmem16(text, &[unit])];
                assert_eq!(both(text), [None; 2], "{len}");
                for at in (0..len).rev() {
                    text[at] = unit;
                    assert_eq!(both(text), [Some(at); 2], "{len}");
                    text[at] = other;
                }
                for at in (0..len).rev() {
                    text[at] = unit;
                    assert_eq!(both(text), [Some(at), Some(len - 1)], "{len}");
                }
            }
        }
    }
}

/// Short and long ones, which end at each place around the start of a page.
fn check_swaps_across_pages() {
    let mut data: Vec<u8> = (0..3 * 4096).map(|at| (at * 77 % 251) as u8).collect();
    let page = 4096 + data.as_ptr().addr().wrapping_neg() % 4096;
    for (f, size) in SWAPS {
        for len in (0..200).chain(1020..1100) {
            for end in page - 9..page + 73 {
                let near = &mut data[end - len - 64..end + 64];
                let mut expected = near.to_vec();
                expected[64..][..len]
                    .chunks_exact_mut(size)
                    .for_each(<[u8]>::reverse);
                // SAFETY: a part of a slice.
                unsafe { f(near[64..].as_mut_ptr(), len) };
                assert_eq!(near, expected);
            }
        }
    }
}

/// Nothing panics, and the results are in range.
fn check_race(random: &mut Random) {
    let atomic = |text: Box<[u8]>| -> Vec<AtomicU8> { text.iter().map(|&it| it.into()).collect() };
    let haystack = atomic(random.text(4 * LONGEST, b"a", b"b"));
    let needle = atomic(random.text(LONGEST / 2, b"a", b"b"));
    let (done, mut other) = (AtomicBool::new(false), Random(random.0));
    std::thread::scope(|scope| {
        scope.spawn(|| {
            while !done.load(Relaxed) {
                for bytes in [&haystack, &needle] {
                    if let Some(it) = bytes.get(other.below(bytes.len() + 1)) {
                        it.store(b"aaab"[other.below(4)], Relaxed);
                    }
                }
            }
        });
        let (a, b) = (haystack.as_ptr().cast::<u8>(), needle.as_ptr().cast::<u8>());
        for (f, unit) in [
            (bun_simd_memmem as Search, 1),
            (bun_simd_memrmem, 1),
            (bun_simd_memmem16, 2),
            (bun_simd_memrmem16, 2),
        ] {
            let (a_len, b_len) = (haystack.len() / unit, needle.len() / unit);
            // SAFETY: two slices of atomic bytes.
            let found = unsafe { f(a, a_len, b, b_len) };
            assert!(found == NOT_FOUND || found + b_len <= a_len);
        }
        let len = haystack.len();
        // SAFETY: as above.
        unsafe {
            assert!(bun_simd_index_of_char(a, len, b'b') <= len);
            assert!(bun_simd_last_index_of_char(a, len, b'b') <= len);
            bun_simd_bswap16(a.cast_mut(), len & !1);
            bun_simd_bswap32(a.cast_mut(), len & !3);
            bun_simd_bswap64(a.cast_mut(), len & !7);
        }
        done.store(true, Relaxed);
    });
}

// One test, since the target is global.
#[test]
fn on_each_target() {
    let bytes: Vec<u8> = (0..=255).collect();
    let ends = [
        0x2ff, 0x370, 0x482, 0x48a, 0x52f, 0x3041, 0x3096, 0x309b, 0x30ff, 0x3300, 0x3000,
    ];
    let ends = ends.into_iter().chain([
        0x3029, 0x2010, 0x2027, 0x2500, 0x25a9, 0x9fff, 0xac00, 0xd7a3, 0xff01, 0xff60, 0x1b00,
        0x126,
    ]);
    let units: Vec<u16> = (0..=256)
        .chain(ends.flat_map(|it| [it - 1, it, it + 1]))
        .collect();
    let ansi = b"\x1b\x1b\x1b[[]\\m;\x07\x18\x9c\x9b\x9d\x90\x7f\xadP (0\n";
    let mut random = Random(1);
    for &target in Target::ALL {
        if !set_cpu(target) {
            continue;
        }
        if !cfg!(miri) {
            check_edges();
            check_swaps_across_pages();
            check_one_unit();
            check_sequences(&mut random);
        }
        for round in 0..ROUNDS {
            check_latin1(&random.text(LONGEST, b"abc 01;", &bytes));
            check_latin1(&random.text(LONGEST, b"abc 01;", ansi));
            check_latin1(&random.text(LONGEST, b"abc", b"\"'&<>"));
            let parts = ["a", "1;", "é", "│", "世", "\x1b[", "\x1b[0m"];
            let colored = random.text(LONGEST / 2, &parts, &["\x1b", "\u{9c}", "\x18", "ě[", "\n"]);
            let colored: Vec<u16> = colored.concat().encode_utf16().collect();
            check_utf16(&colored);
            check_latin1(&colored.iter().map(|&c| c as u8).collect::<Vec<_>>());
            let (link, digits) = (
                "\x1b]8;;https://example.com/a/b/c/d/e/f/g/h",
                "1;".repeat(40),
            );
            let parts = [
                "a",
                "é\n",
                link,
                &link[5..],
                &digits,
                "\x1b[",
                "m",
                "\x1b[0m",
            ];
            let long = random.text(LONGEST / 8, &parts, &["\x1b\\", "\u{9c}", "\x07", "\x1b(B"]);
            let long: Vec<u16> = long.concat().encode_utf16().collect();
            check_utf16(&long);
            check_latin1(&long.iter().map(|&c| c as u8).collect::<Vec<_>>());
            check_utf16(&random.text(LONGEST, &[0x61, 0x13c], &[0x22, 0x26, 0x27, 0x3c, 0x3e]));
            check_utf16(&random.text(LONGEST, &[0x61, 0x20, 0x7a], &units));
            check_utf16(&random.text(LONGEST, &[0x61, 0xe9, 0x3b1, 0x4e2d], &units));
            check_hex(
                &random.text(LONGEST, &bytes, &bytes),
                random.below(2 * LONGEST),
            );
            check_buffer(&random.text(LONGEST, b"abcdefghijk", b"\0"));
            let haystack = random.text(LONGEST, b"a", b"bc");
            check_search(&haystack, &random.text(40, b"a", b"bc"));
            let part = &haystack[random.below(haystack.len() + 1)..];
            check_search(&haystack, &part[..random.below(part.len() + 1)]);
            if round % 10 == 0 {
                check_race(&mut random);
            }
        }
        for at in (0..if cfg!(miri) { 0 } else { 1500 }).step_by(7) {
            let mut far = vec![b'a'; 1500 + at % 64];
            far[at] = 0;
            check_buffer(&far);
            let mut far = vec![b'a'; 5000];
            (far[0], far[3400 + at]) = (0x10, 0x1b);
            assert_eq!(scan(bun_simd_index_of_escape_char8, &far), 3400 + at);
            let text = random.text(9000, b"abcd", b"efg");
            check_search(
                &text,
                &text[text.len() / 2..][..text.len().min(at % 40) / 2],
            );
        }
        for unit in (0..=u16::MAX).step_by(if cfg!(miri) { 9999 } else { 1 }) {
            let (mut text, mut width, at) = ([0x61; 40], 0, usize::from(unit) % 39);
            text[at] = unit;
            // SAFETY: an array.
            let units = unsafe { bun_simd_visible_utf16_width(text.as_ptr(), 40, &mut width) };
            let expected = utf16_width(unit).map_or((at, at), |it| (40, 39 + it));
            assert_eq!((units, width), expected, "{unit:x}");
            let mut width = 0;
            // SAFETY: one unit.
            let units = unsafe { bun_simd_visible_utf16_width(&raw const unit, 1, &mut width) };
            assert_eq!((units == 1).then_some(width), utf16_width(unit));
        }
        // So many candidates that the filter gives up.
        let mut haystack = vec![b'a'; 301];
        check_search(&haystack, b"aaaaaabaaaaa");
        haystack[250..252].fill(b'b');
        check_search(&haystack, b"aaaaaabbaaaa");
        for len in [40, 90] {
            let mut haystack: Vec<u8> = (0..if cfg!(miri) { 200 } else { 5000 })
                .map(|i| b'a' + u8::from(i % len < 2))
                .collect();
            check_search(&haystack, &vec![b'a'; len]);
            let middle = haystack.len() / 2;
            haystack[middle..][..len].fill(b'a');
            check_search(&haystack, &vec![b'a'; len]);
        }
        check_utf16(&[u16::from(b'&'); 100]);
        check_latin1(&[b'"'; if cfg!(miri) { 100 } else { 20000 }]);
    }
    reset_cpu();
}
