//! Every kernel on every target, against a plain loop or the portable target.
#![forbid(unsafe_code)]
use bun_simd::{Out, SharedU8, Target, limit_to};
use bun_simd_kernels::{self as kernels, Filter};
use core::fmt::Debug;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

fn targets() -> impl Iterator<Item = Target> {
    // Miri lacks some of the intrinsics.
    let is_skipped = |target| cfg!(miri) && target == Target::Neon;
    let all = Target::ALL.into_iter();
    let supported = all.filter(move |&it| it.is_supported() && !is_skipped(it));
    supported.inspect(|&target| limit_to(target))
}

/// Each has an allocation of its exact size.
fn texts(alphabet: &[u8]) -> impl Iterator<Item = Vec<u8>> {
    let mut x = 88172645463325252u64;
    let (step, longer): (_, &[_]) = match cfg!(miri) {
        true => (67, &[]),
        false => (1, &[255, 256, 257, 260, 1100, 4500]),
    };
    let lengths = (0..200).step_by(step).chain(longer.iter().copied());
    lengths.map(move |len| {
        let byte = |_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            alphabet[x as usize % alphabet.len()]
        };
        (0..len).map(byte).collect()
    })
}

const MIXED: &[u8] = b"abAZ\"\\\n {},0F</&\xff";

/// Miri gets one in `n`.
fn sample<T>(all: impl IntoIterator<Item = T>, n: usize) -> impl Iterator<Item = T> {
    all.into_iter().step_by(if cfg!(miri) { n } else { 1 })
}

fn check<T: PartialEq + Debug>(want: T, kernel: impl Fn() -> T) {
    for target in targets() {
        assert_eq!(kernel(), want, "{target:?}");
    }
}

fn check_against_portable<T: PartialEq + Debug>(kernel: impl Fn() -> T) {
    limit_to(Target::Portable);
    check(kernel(), kernel);
}

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
        (|t| kernels::index_of_char(t, b'F'), |b| b == b'F'),
        (|t| from_shared(t, |t| kernels::index_of_char_shared(t, b'F')), |b| b == b'F'),
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
        (kernels::first_non_ascii8, |b| b > 0x7F),
        (kernels::index_of_first_ascii_upper, |b| b.is_ascii_uppercase()),
        (kernels::index_of_html_escape_char8, |b| b"<>&'\"".contains(&b)),
    ];
    #[rustfmt::skip]
    let lasts: [(First, &[u8]); 7] = [
        (|t| kernels::last_index_of_char(t, b'F'), b"F"),
        (|t| from_shared(t, |t| kernels::last_index_of_char_shared(t, b'F')), b"F"),
        (|t| kernels::last_index_of_any_char(t, b"F0"), b"F0"),
        (|t| kernels::last_index_of_any_char(t, b"F0<"), b"F0<"),
        (|t| kernels::last_index_of_any_char(t, b"F\x91,\xff"), b"F\x91,\xff"),
        (kernels::last_index_of_slash, b"/"),
        (kernels::last_index_of_slash_or_dot, b"/."),
    ];
    #[rustfmt::skip]
    let counts: [(fn(&[u8]) -> usize, &[u8]); 3] = [
        (|t| kernels::count_char(t, b'a'), b"a"),
        (kernels::count_slashes, b"/"),
        (kernels::count_mapping_delims, b",;"),
    ];
    for t in texts_to_search() {
        for (kernel, test) in firsts {
            check(t.iter().position(|&b| test(b)), || kernel(&t));
        }
        for (kernel, set) in lasts {
            check(t.iter().rposition(|b| set.contains(b)), || kernel(&t));
        }
        for (kernel, set) in counts {
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
    let is_escape = |unit: &u16| [0x1B, 0x90, 0x98, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F].contains(unit);
    let extra = |&unit: &u16| match u8::try_from(unit) {
        Ok(b'<' | b'>') => 3,
        Ok(b'&') => 4,
        Ok(b'"' | b'\'') => 5,
        _ => 0,
    };
    for t in texts_to_search() {
        let latin1: Vec<u16> = t.iter().map(|&b| b.into()).collect();
        check(latin1.iter().position(is_escape), || {
            kernels::index_of_escape_char8(&t)
        });
        check(latin1.iter().map(extra).sum(), || {
            kernels::html_escape_extra_len8(&t)
        });
        for wide in [latin1, widened(&t)] {
            check(wide.iter().position(|&unit| unit == 0x46), || {
                kernels::index_of_char16(&wide, 0x46)
            });
            check(wide.iter().rposition(|&unit| unit == 0x46), || {
                kernels::last_index_of_char16(&wide, 0x46)
            });
            check(wide.iter().position(is_escape), || {
                kernels::index_of_escape_char16(&wide)
            });
            check(wide.iter().map(extra).sum(), || {
                kernels::html_escape_extra_len16(&wide)
            });
            check(wide.iter().position(|unit| extra(unit) != 0), || {
                kernels::index_of_html_escape_char16(&wide)
            });
            check(wide.iter().position(|&unit| unit > 0x7F), || {
                kernels::first_non_ascii16(&wide)
            });
            check(
                wide.iter().position(|unit| (0x41..=0x5A).contains(unit)),
                || kernels::index_of_first_ascii_upper16(&wide),
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

type Searches<'a, T> = &'a [fn(&[T], &[T]) -> Option<usize>];

fn check_memmem<T: PartialEq>(widen: fn(u8) -> T, forward: Searches<'_, T>, back: Searches<'_, T>) {
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
    // The rarest units match all the time, so it goes on with another algorithm.
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
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn memmem() {
    check_memmem(
        |b| b,
        &[kernels::memmem, |a, b| {
            from_shared(a, |a| from_shared(b, |b| kernels::memmem_shared(a, b)))
        }],
        &[kernels::memrmem, |a, b| {
            from_shared(a, |a| from_shared(b, |b| kernels::memrmem_shared(a, b)))
        }],
    );
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn memmem16() {
    /// At an odd address.
    fn in_pairs<R>(units: &[u16], kernel: impl FnOnce(&[[SharedU8; 2]]) -> R) -> R {
        let bytes = units.iter().flat_map(|unit| unit.to_le_bytes());
        let bytes: Vec<u8> = [0].into_iter().chain(bytes).collect();
        from_shared(&bytes, |it| kernel(it[1..].as_chunks().0))
    }
    check_memmem(
        |b| u16::from(b) << 7,
        &[|a, b| in_pairs(a, |a| in_pairs(b, |b| kernels::memmem16_shared(a, b)))],
        &[kernels::memrmem16, |a, b| {
            in_pairs(a, |a| in_pairs(b, |b| kernels::memrmem16_shared(a, b)))
        }],
    );
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn paths() {
    for t in texts(b"//..ab").chain(texts(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/.\xE9")) {
        let is_untidy = |&at: &usize| {
            let part = t[at + 1..]
                .iter()
                .take_while(|b| !b"/".contains(b))
                .copied();
            let is_dots = [&b""[..], b".", b".."].contains(&&part.collect::<Vec<u8>>()[..]);
            t[at] == b'/' && at + 1 < t.len() && is_dots
        };
        check((0..t.len()).find(is_untidy), || {
            kernels::index_of_untidy_slash(&t)
        });
        check(
            (0..t.len()).find(|at| is_untidy(at) || t[*at] > 0x7F),
            || kernels::index_of_untidy_slash_or_non_ascii(&t),
        );
        for len in [t.len(), t.len() / 2, t.len() / 7] {
            check(len, || kernels::common_prefix_length(&t, &t[..len]));
            check(len, || {
                kernels::common_prefix_length(&[&t[..len], b"x", &t].concat(), &t)
            });
        }
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
    let all_bytes = (0..=255).collect();
    for t in texts(dense).chain(texts(sparse)).chain([all_bytes]) {
        check(t.iter().filter(|&&b| is_visible(b)).count(), || {
            kernels::visible_latin1_width(&t)
        });
        check(width_without_escapes(&t), || {
            kernels::visible_latin1_width_exclude_ansi(&t)
        });
    }
    // Each kind starts at each place before the end of a block, and goes on for more than one.
    for start in [
        &b"\x1B["[..],
        b"\x1B]",
        b"\x1BP",
        b"\x1B(",
        b"\x1B",
        b"\x9B",
        b"\x9D",
        b"\x90",
    ] {
        for (before, len) in sample((60..66).flat_map(|it| [(it, 0), (it, 150)]), 7) {
            let t = [
                &vec![b'a'; before],
                start,
                &vec![b'0'; len],
                b"m\x07z\x1B\\yy",
            ]
            .concat();
            check(width_without_escapes(&t), || {
                kernels::visible_latin1_width_exclude_ansi(&t)
            });
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
fn lines_and_runs() {
    for t in texts(MIXED) {
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
}

fn check_bswap<const N: usize>(t: &[u8], kernel: fn(&[AtomicU8])) {
    let mut swapped = t.to_vec();
    swapped
        .as_chunks_mut::<N>()
        .0
        .iter_mut()
        .for_each(|word| word.reverse());
    check(swapped, || to_shared(t, kernel).1);
}

/// What follows the result stays as it is.
fn check_prefix<T>(
    want: &[u8],
    from: &[T],
    kernel: for<'a> fn(&[T], Out<'a, u8>) -> &'a mut [u8],
    kernel_to_shared: fn(&[T], &[AtomicU8]) -> usize,
) {
    let rooms = [from.len(), from.len() / 2, from.len() + 3];
    for room in rooms {
        check(want[..room.min(want.len())].to_vec(), || {
            filled(room, |out| kernel(from, out))
        });
    }
    for room in sample(rooms, 3) {
        let (want, ones) = (&want[..room.min(want.len())], vec![0xFF; room]);
        let all = [want, &ones[want.len()..]].concat();
        check((want.len(), all.clone()), || {
            let mut out = ones.clone();
            (kernel(from, out[..].as_mut().into()).len(), out)
        });
        check((want.len(), all), || {
            to_shared(&ones, |out| kernel_to_shared(from, out))
        });
    }
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
        for room in [len, len / 2, len + 3] {
            check(masked[..room.min(len)].to_vec(), || {
                filled(room, |out| kernels::fill_with_mask([1, 2, 3, 4], out, &t))
            });
            check(masked[..room.min(len)].to_vec(), || {
                filled(room, |out| {
                    from_shared(&t, |t| {
                        kernels::fill_with_mask_from_shared([1, 2, 3, 4], out, t)
                    })
                })
            });
        }
        check(masked, || {
            let mut out = t.clone();
            kernels::mask_in_place([1, 2, 3, 4], &mut out);
            out
        });

        let hex: Vec<u8> = t
            .iter()
            .flat_map(|b| format!("{b:02x}").into_bytes())
            .collect();
        check(hex.as_chunks().0.to_vec(), || {
            filled(len, |out| kernels::encode_hex_lower(&t, out))
        });
        check(hex.as_chunks().0.to_vec(), || {
            filled(len, |out| {
                from_shared(&t, |t| kernels::encode_hex_lower_shared(t, out))
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
        for prefix in [len, len / 2, len / 9] {
            let from = [&ascii[..prefix], b"\x80", &ascii[prefix..]].concat();
            check_prefix(
                &ascii[..prefix],
                &from,
                kernels::copy_ascii_prefix,
                kernels::copy_ascii_prefix_to_shared,
            );
        }

        let wide: Vec<u16> = (0..len)
            .map(|i| u16::from(t[i]) | (i as u16 & 8) << 5)
            .collect();
        let lower =
            |&unit: &u16| u8::try_from(unit).map_or(unit, |b| b.to_ascii_lowercase().into());
        check(wide.iter().map(lower).collect(), || {
            filled(len, |out| kernels::lower_ascii16(&wide, out))
        });

        check_bswap::<2>(&t, kernels::bswap16_shared);
        check_bswap::<4>(&t, kernels::bswap32_shared);
        check_bswap::<8>(&t, kernels::bswap64_shared);
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
        check(want, || filled(70, |out| kernels::decode_hex(&hex, out)));
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
fn json() {
    for t in texts(b"{}[]:,\"\"\\ \n\tabc123\x01\xff") {
        check_against_portable(|| {
            let (mut dirty, mut state, mut flags) = (vec![0; t.len().div_ceil(4096)], [0; 3], 0);
            let index = filled(t.len() + 66, |out| {
                let index;
                (index, flags) =
                    kernels::json_structural_index_chunk(&t, 4096, out, &mut dirty, &mut state);
                index
            });
            (index, dirty, state, flags)
        });
    }
    check(vec![0, 1, 5, 6, 7, 8, 9, 10, 14, 15], || {
        filled(82, |out| {
            let text = br#"{"a\"":[1,true]}"#;
            kernels::json_structural_index_chunk(text, 0, out, &mut [0], &mut [0; 3]).0
        })
    });
}

#[test]
fn json_without_room() {
    let index = |len, dirty: &mut [u64]| {
        let (text, room) = (&[b'['; 64], &mut vec![0; len][..]);
        let (index, flags) =
            kernels::json_structural_index_chunk(text, 0, room.into(), dirty, &mut [0; 3]);
        (index.len(), flags)
    };
    check([(64, 0), (0, 8), (0, 8)], || {
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
    kernel: for<'a> fn(&[T], usize, Out<'a, u32>, &mut [u64; 3]) -> &'a mut [u32],
) -> Vec<u32> {
    let ((first, second), state) = (text.split_at(text.len().min(64)), &mut [0; 3]);
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
            xml_index(&t, kernels::xml_structural_index_chunk)
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
            xml_index(&wide, kernels::xml_structural_index16_chunk)
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "reads only a slice")]
fn xxhash() {
    let counting: Vec<u8> = (0..2048).map(|i| (i % 251) as u8).collect();
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
    ] {
        check(xxh32, || kernels::xxhash32(seed, &counting[..len]));
        check(xxh64, || kernels::xxhash64(seed.into(), &counting[..len]));
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
        let flat = (0..row.len()).map(|i| (i / 128) as u8).collect();
        for above in [row.iter().rev().copied().collect::<Vec<u8>>(), flat] {
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
                        kernels::png_unfilter(filter_type, size, &mut back, &above);
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
                (kernels::png_filter_rgba(row, above, into), rows)
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
            kernels::png_unfilter(4, SIZE, &mut row[..16], &above);
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
    check_paeth::<4>();
    check_paeth::<8>();
}

#[test]
fn png_of_other_kinds() {
    for (filter_type, size) in [(0, 4), (5, 4), (1, 3), (2, 3), (3, 3), (4, 3), (2, 0)] {
        check([1; 40], || {
            let mut row = [1; 40];
            kernels::png_unfilter(filter_type, size, &mut row, &[2; 40]);
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
                let columns = kernels::Columns {
                    generated: generated.as_mut().into(),
                    original: original.as_mut().into(),
                    src_idx: src_idx.as_mut().into(),
                    name_idx: Some(name_idx.as_mut().into()),
                };
                let state = &mut Default::default();
                let (rows, resume_at) = kernels::parse_mappings(&text, columns, 2, state);
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
        let columns = kernels::Columns {
            generated,
            original,
            src_idx,
            name_idx: None,
        };
        let mut state = kernels::MappingsState::default();
        let (rows, _) = kernels::parse_mappings(&text, columns, 0, &mut state);
        (rows.src_idx.len(), state.gen_col)
    });
}

#[test]
#[should_panic]
fn line_above_is_too_short() {
    kernels::png_unfilter(1, 4, &mut [0; 8], &[0; 7]);
}

#[test]
#[should_panic]
fn filtered_row_is_too_short() {
    let [a, b, c] = &mut [[[0; 4]; 2]; 3];
    kernels::png_filter_rgba(&[[0; 4]; 2], &[[0; 4]; 2], [a, b, c, &mut [[0; 4]]]);
}

#[test]
#[should_panic]
fn plane_is_too_short() {
    let [a, b] = &mut [[[0; 8]; 2]; 2];
    kernels::scanner_run_stops(&[0; 65], [a, b, &mut [[0; 8]]]);
}

#[test]
fn images() {
    for t in texts(MIXED) {
        let pixels: &[[u8; 4]] = t.as_chunks().0;
        let times = |a: u8, k: u8| ((u32::from(a) * u32::from(k) + 127) / 255) as u8;
        let rgba = |&[c, m, y, k]: &[u8; 4]| [times(c, k), times(m, k), times(y, k), 255];
        check(pixels.iter().map(rgba).collect(), || {
            let mut out = pixels.to_vec();
            kernels::cmyk_to_rgba(&mut out);
            out
        });
        let grey_doubled = |&[r, _, _, a]: &[u8; 4]| {
            let doubled = r.saturating_mul(2);
            ([r, r, r, a], [doubled, doubled, doubled, a])
        };
        let (grey, doubled): (Vec<_>, Vec<_>) = pixels.iter().map(grey_doubled).unzip();
        check(doubled, || {
            let mut out = grey.clone();
            kernels::modulate(&mut out, 2.0, 0.5);
            out
        });
        // Miri adds random errors to `sin`.
        if !cfg!(miri)
            && let height @ 1.. = pixels.len() / 7
        {
            check_against_portable(|| {
                filled(19 * 3, |out| {
                    kernels::Resizer::default().resize(
                        Filter::Lanczos3,
                        &pixels[..7 * height],
                        7,
                        out,
                        19,
                    )
                })
            });
        }
    }
    for filter in sample(Filter::ALL, 9) {
        check(vec![[77; 4]; 13 * 5], || {
            filled(13 * 5, |out| {
                kernels::Resizer::default().resize(filter, &[[77; 4]; 21 * 9], 21, out, 13)
            })
        });
    }
}

#[test]
fn moved_pixels() {
    let sizes = [1, 2, 3, 4, 5, 15, 16, 17, 64, 65, 70, 135];
    let all = sizes.iter().flat_map(|&w| sizes.map(|h| (w, h)));
    for (w, h) in sample(all.chain([(41, 9001), (5, 70_000)]), 51) {
        // What follows the last whole row does not count.
        let src: Vec<_> = (0..(w * h + w / 2) as u32).map(u32::to_le_bytes).collect();
        let image = |width: usize, from: &dyn Fn(usize, usize) -> [usize; 2]| -> Vec<_> {
            let places = (0..w * h).map(|i| from(i % width, i / width));
            places.map(|[x, y]| src[y * w + x]).collect()
        };
        check(image(h, &|x, y| [y, h - 1 - x]), || {
            filled(w * h, |out| kernels::rotate_90(&src, w, out))
        });
        check(image(w, &|x, y| [w - 1 - x, h - 1 - y]), || {
            filled(w * h, |out| kernels::rotate_180(&src[..w * h], out))
        });
        check(image(h, &|x, y| [w - 1 - y, x]), || {
            filled(w * h, |out| kernels::rotate_270(&src, w, out))
        });
        check(image(w, &|x, y| [w - 1 - x, y]), || {
            filled(w * h, |out| kernels::flip_horizontally(&src, w, out))
        });
        check(image(w, &|x, y| [x, h - 1 - y]), || {
            filled(w * h, |out| kernels::flip_vertically(&src, w, out))
        });
    }
}

#[test]
#[should_panic]
fn moved_pixels_without_room() {
    kernels::rotate_180(&[[0; 4]; 6], [[0; 4]; 3][..].as_mut().into());
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
                || kernels::nearest_in_palette(palette, color),
            );
        }
    }
}

#[test]
fn with_a_concurrent_writer() {
    for len in [1, 3, 7, 13, 31, 40, 70, 600] {
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
                filled(len, |out| kernels::encode_hex_lower_shared(text, out));
                kernels::copy_ascii_prefix_to_shared(&vec![0; len], &bytes);
                kernels::decode_hex_to_shared(&vec![*b"00"; len], &bytes);
            }
        });
    }
}
