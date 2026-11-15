//! Every kernel on every target, against a plain loop or the portable target.
#![forbid(unsafe_code)]
use bun_simd::{Out, Target, limit_to};
use bun_simd_kernels as kernels;
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

fn check<T: PartialEq + Debug>(want: T, kernel: impl Fn() -> T) {
    for target in targets() {
        assert_eq!(kernel(), want, "{target:?}");
    }
}

fn check_against_portable<T: PartialEq + Debug>(kernel: impl Fn() -> T) {
    limit_to(Target::Portable);
    check(kernel(), kernel);
}

fn shared(bytes: &[u8]) -> Vec<AtomicU8> {
    bytes.iter().map(|&byte| AtomicU8::new(byte)).collect()
}

fn plain(bytes: Vec<AtomicU8>) -> Vec<u8> {
    bytes.into_iter().map(AtomicU8::into_inner).collect()
}

/// In an allocation of that size, which is not initialized.
fn filled<T: Copy>(len: usize, kernel: impl for<'a> FnOnce(Out<'a, T>) -> &'a mut [T]) -> Vec<T> {
    let mut out = Vec::with_capacity(len);
    bun_simd::extend_vec(&mut out, len, kernel);
    out
}

#[test]
fn searches() {
    for t in texts(MIXED).chain(texts(
        b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaF/<",
    )) {
        let first = |test: fn(u8) -> bool| t.iter().position(|&b| test(b));
        let last = |byte: u8| t.iter().rposition(|&b| b == byte);
        let (t, shared, half) = (&t[..], shared(&t), t.len() / 2);
        let count = t.iter().filter(|b| b"a".contains(b)).count();
        check(first(|b| b == b'F'), || kernels::index_of_char(t, b'F'));
        check(first(|b| b == b'F'), || {
            kernels::index_of_char_shared(&shared, b'F')
        });
        check(first(|b| b == b'F').filter(|&at| at < half), || {
            kernels::index_of_char_within(t, half, b'F')
        });
        check(last(b'F'), || kernels::last_index_of_char(t, b'F'));
        check(last(b'F'), || {
            kernels::last_index_of_char_shared(&shared, b'F')
        });
        check(last(b'/'), || kernels::last_index_of_slash(t));
        check(count, || kernels::count_char(t, b'a'));
        check(count, || kernels::count_char_shared(&shared, b'a'));
        check(first(|b| b"F0".contains(&b)), || {
            kernels::index_of_either(t, *b"F0")
        });
        check(first(|b| b"F0\xff".contains(&b)), || {
            kernels::index_of_any_char(t, b"F0\xff")
        });
        check(
            first(|b| b"\"\\".contains(&b) || !(0x20..=0x7E).contains(&b)),
            || kernels::index_of_interesting_character_in_string_literal(t, b'"'),
        );
        check(first(|b| !(0x20..=0x7F).contains(&b)), || {
            kernels::index_of_newline_or_non_ascii(t)
        });
        let wide: Vec<u16> = t.iter().map(|&b| b.into()).collect();
        let html = first(|b| b"<>&'\"".contains(&b));
        check(html, || kernels::index_of_html_escape_char8(t));
        check(html, || kernels::index_of_html_escape_char16(&wide));
        check(first(|b| b > 0x7F), || kernels::first_non_ascii16(&wide));
    }
}

#[test]
fn memmem() {
    for t in texts(b"ab").chain(texts(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab")) {
        let from_end = [0, 1, 2, 5, 16, 17, 40].map(|len| &t[t.len().saturating_sub(len)..]);
        let others: [&[u8]; 3] = [
            b"bb",
            b"aaaaabbaaaaa",
            b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaac",
        ];
        for needle in from_end.into_iter().chain(others) {
            let want = (0..=t.len()).find(|&at| t[at..].starts_with(needle));
            check(want, || kernels::memmem(&t, needle));
        }
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
fn conversions() {
    for t in texts(MIXED) {
        let len = t.len();
        let wide: Vec<u16> = t.iter().map(|&b| u16::from(b) | 0x100).collect();
        let masked: Vec<u8> = (0..len).map(|i| t[i] ^ [1, 2, 3, 4][i % 4]).collect();
        for room in [len, len / 2, len + 3] {
            check(t[..room.min(len)].to_vec(), || {
                filled(room, |out| kernels::copy_u16_to_u8(&wide, out))
            });
            check(masked[..room.min(len)].to_vec(), || {
                filled(room, |out| kernels::fill_with_mask([1, 2, 3, 4], out, &t))
            });
        }
        check(masked, || {
            let out = shared(&vec![0; len]);
            kernels::fill_shared_with_mask([1, 2, 3, 4], &out, &t);
            plain(out)
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
                kernels::encode_hex_lower_shared(&shared(&t), out)
            })
        });
        for (hex, valid) in [
            (hex.to_ascii_uppercase(), len),
            ([&hex[..len], b"g", &hex[..]].concat(), len / 2),
        ] {
            check(t[..valid].to_vec(), || {
                filled(len, |out| kernels::decode_hex(hex.as_chunks().0, out))
            });
        }

        let wide: Vec<u16> = (0..len)
            .map(|i| u16::from(t[i]) | (i as u16 & 8) << 5)
            .collect();
        let lower =
            |&unit: &u16| u8::try_from(unit).map_or(unit, |b| b.to_ascii_lowercase().into());
        check(wide.iter().map(lower).collect(), || {
            filled(len, |out| kernels::lower_ascii16(&wide, out))
        });

        let mut swapped = t.clone();
        swapped
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|word| word.reverse());
        check(swapped.clone(), || {
            let mut out = t.clone();
            kernels::bswap32(out.as_chunks_mut().0);
            out
        });
        check(swapped, || {
            let out = shared(&t);
            kernels::bswap32_shared(&out);
            plain(out)
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

#[test]
fn xxh3() {
    for t in texts(MIXED).filter(|t| t.len() > 240) {
        check_against_portable(|| kernels::xxhash3_64_long(&t));
    }
    check(None, || kernels::xxhash3_64_long(&[0; 240]));
    let counting: Vec<u8> = (0..2048).map(|i| (i % 251) as u8).collect();
    check(Some(0x2533_9063_DB86_1586), || {
        kernels::xxhash3_64_long(&counting)
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
            let sizes: &[_] = if cfg!(miri) { &[4] } else { &[1, 2, 4, 6, 8] };
            for &size in sizes {
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
                    kernels::Resizer::default().lanczos3(&pixels[..7 * height], 7, out, 19)
                })
            });
        }
    }
    check(vec![[77; 4]; 13 * 5], || {
        filled(13 * 5, |out| {
            kernels::Resizer::default().lanczos3(&[[77; 4]; 21 * 9], 21, out, 13)
        })
    });
}

#[test]
fn with_a_concurrent_writer() {
    for len in [1, 3, 7, 13, 31, 40, 70, 600] {
        let text = shared(&vec![0; len]);
        std::thread::scope(|s| {
            s.spawn(|| (0..40).for_each(|_| _ = text[len / 2].fetch_xor(2, Relaxed)));
            for _ in targets() {
                let is_there_or_not = |found: Option<usize>| found.is_none_or(|at| at == len / 2);
                assert!(is_there_or_not(kernels::index_of_char_shared(&text, 2)));
                assert!(is_there_or_not(kernels::last_index_of_char_shared(
                    &text, 2
                )));
                assert!(kernels::count_char_shared(&text, 2) <= 1);
                filled(len, |out| kernels::encode_hex_lower_shared(&text, out));
                kernels::fill_shared_with_mask([0; 4], &text, &vec![0; len]);
            }
        });
    }
}
