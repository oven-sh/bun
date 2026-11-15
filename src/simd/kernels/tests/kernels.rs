//! Every kernel on every target, against plain loops or, where those are long, the portable target.
use bun_simd::{Target, limit_to};
use bun_simd_kernels as kernels;
use core::fmt::Debug;
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

fn targets() -> impl Iterator<Item = Target> {
    let supported = Target::ALL.iter().filter(|target| target.is_supported());
    supported.map(|&target| {
        limit_to(target);
        target
    })
}

/// Each in an allocation of its own size.
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

fn gives<T: PartialEq + Debug>(want: T, kernel: impl Fn() -> T) {
    for target in targets() {
        assert_eq!(kernel(), want, "{target:?}");
    }
}

fn gives_the_same_everywhere<T: PartialEq + Debug>(kernel: impl Fn() -> T) {
    limit_to(Target::portable);
    gives(kernel(), kernel);
}

fn shared(bytes: &[u8]) -> Vec<AtomicU8> {
    bytes.iter().map(|&byte| AtomicU8::new(byte)).collect()
}

fn plain(bytes: Vec<AtomicU8>) -> Vec<u8> {
    bytes.into_iter().map(AtomicU8::into_inner).collect()
}

fn filled<T>(len: usize, kernel: impl FnOnce(&mut [MaybeUninit<T>]) -> usize) -> Vec<T> {
    let mut out = Vec::with_capacity(len);
    let written = kernel(&mut out.spare_capacity_mut()[..len]);
    // SAFETY: what is tested. Miri tells if it is not so.
    unsafe { out.set_len(written) };
    out
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn searches() {
    for t in texts(MIXED).chain(texts(
        b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaF/<",
    )) {
        let first = |test: fn(u8) -> bool| t.iter().position(|&b| test(b));
        let last = |byte: u8| t.iter().rposition(|&b| b == byte);
        let (t, shared, half) = (&t[..], shared(&t), t.len() / 2);
        let count = t.iter().filter(|b| b"a".contains(b)).count();
        gives(first(|b| b == b'F'), || kernels::index_of_char(t, b'F'));
        gives(first(|b| b == b'F'), || {
            kernels::index_of_char_shared(&shared, b'F')
        });
        gives(first(|b| b == b'F').map_or(half, |at| at.min(half)), || {
            kernels::index_of_char_within(t, half, b'F')
        });
        gives(last(b'F'), || kernels::last_index_of_char(t, b'F'));
        gives(last(b'F'), || {
            kernels::last_index_of_char_shared(&shared, b'F')
        });
        gives(last(b'/'), || kernels::last_index_of_slash(t));
        gives(count, || kernels::count_char(t, b'a'));
        gives(count, || kernels::count_char_shared(&shared, b'a'));
        gives(first(|b| b"F0".contains(&b)), || {
            kernels::index_of_either(t, *b"F0")
        });
        gives(first(|b| b"F0\xff".contains(&b)), || {
            kernels::index_of_any_char(t, b"F0\xff")
        });
        gives(
            first(|b| b"\"\\".contains(&b) || !(0x20..=0x7E).contains(&b)),
            || kernels::index_of_interesting_character_in_string_literal(t, b'"'),
        );
        gives(first(|b| !(0x20..=0x7F).contains(&b)), || {
            kernels::index_of_newline_or_non_ascii(t)
        });
        let wide: Vec<u16> = t.iter().map(|&b| b.into()).collect();
        let html = first(|b| b"<>&'\"".contains(&b));
        gives(html, || kernels::index_of_html_escape_char8(t));
        gives(html, || kernels::index_of_html_escape_char16(&wide));
        gives(first(|b| b > 0x7F), || kernels::first_non_ascii16(&wide));
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
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
            gives(want, || kernels::memmem(&t, needle));
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn lines_and_runs() {
    for t in texts(MIXED) {
        let after_newlines = (1..=t.len()).filter(|&at| t[at - 1] == b'\n');
        let want: Vec<u32> = [0]
            .into_iter()
            .chain(after_newlines)
            .map(|at| at as u32)
            .collect();
        gives(want, || kernels::line_starts(&t));

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
        gives(want, || {
            let mut planes = [(); 3].map(|()| vec![[0; 8]; t.len().div_ceil(64)]);
            kernels::scanner_run_stops(&t, planes.each_mut().map(|plane| &mut plane[..]));
            planes
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn conversions() {
    for t in texts(MIXED) {
        let into = |len: usize, kernel: &dyn Fn(&mut [u8])| {
            let mut out = vec![0; len];
            kernel(&mut out);
            out
        };
        let len = t.len();
        let wide: Vec<u16> = t.iter().map(|&b| u16::from(b) | 0x100).collect();
        gives(t.clone(), || {
            into(len, &|out| kernels::copy_u16_to_u8(&wide, out))
        });
        gives(t[..len / 2].to_vec(), || {
            into(len / 2, &|out| kernels::copy_u16_to_u8(&wide, out))
        });

        let masked: Vec<u8> = (0..len).map(|i| t[i] ^ [1, 2, 3, 4][i % 4]).collect();
        gives(masked.clone(), || {
            into(len, &|out| kernels::fill_with_mask([1, 2, 3, 4], out, &t))
        });
        gives(masked, || {
            let out = shared(&vec![0; len]);
            kernels::fill_shared_with_mask([1, 2, 3, 4], &out, &t);
            plain(out)
        });

        let hex: Vec<u8> = t
            .iter()
            .flat_map(|b| format!("{b:02x}").into_bytes())
            .collect();
        gives(hex.clone(), || {
            into(2 * len, &|out| kernels::encode_hex_lower(&t, out))
        });
        gives(hex.clone(), || {
            into(2 * len, &|out| {
                kernels::encode_hex_lower_shared(&shared(&t), out)
            })
        });
        for (hex, valid) in [
            (hex.to_ascii_uppercase(), len),
            ([&hex[..len], b"g", &hex[..]].concat(), len / 2),
        ] {
            gives(t[..valid].to_vec(), || {
                let mut out = vec![0; len];
                let valid = kernels::decode_hex(&hex, &mut out);
                out.truncate(valid);
                out
            });
        }

        let wide: Vec<u16> = (0..len)
            .map(|i| u16::from(t[i]) | (i as u16 & 8) << 5)
            .collect();
        let lower =
            |&unit: &u16| u8::try_from(unit).map_or(unit, |b| b.to_ascii_lowercase().into());
        gives(wide.iter().map(lower).collect(), || {
            let mut out = vec![0; len];
            kernels::lower_ascii16(&wide, &mut out);
            out
        });

        let mut swapped = t.clone();
        swapped
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|word| word.reverse());
        gives(swapped.clone(), || {
            let mut out = t.clone();
            kernels::bswap32(out.as_chunks_mut().0);
            out
        });
        gives(swapped, || {
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
            let (mut controls, mut data) = (vec![0; words.len()], vec![0; 16 * words.len()]);
            let size = kernels::pack_words(&words, &mut controls, &mut data);
            data.truncate(size);
            (controls, data)
        };
        gives_the_same_everywhere(pack);
        let (controls, mut data) = pack();
        data.extend([0; 16]);
        gives(words.as_flattened().to_vec(), || {
            filled(4 * words.len(), |out| {
                4 * kernels::unpack_words(&controls, &data, out.as_chunks_mut().0).0
            })
        });
    }
}

#[test]
fn json() {
    for t in texts(b"{}[]:,\"\"\\ \n\tabc123\x01\xff") {
        gives_the_same_everywhere(|| {
            let (mut dirty, mut state, mut flags) = (vec![0; t.len().div_ceil(4096)], [0; 3], 0);
            let index = filled(t.len() + 66, |out| {
                let written;
                (written, flags) =
                    kernels::json_structural_index_chunk(&t, 4096, out, &mut dirty, &mut state);
                written
            });
            (index, dirty, state, flags)
        });
    }
    gives(vec![0, 1, 5, 6, 7, 8, 9, 10, 14, 15], || {
        filled(82, |out| {
            let text = br#"{"a\"":[1,true]}"#;
            kernels::json_structural_index_chunk(text, 0, out, &mut [0], &mut [0; 3]).0
        })
    });
}

#[test]
fn json_without_room() {
    let (text, room) = (&[b'['; 64], |len| Box::new_uninit_slice(len));
    let index = |len, dirty: &mut [u64]| {
        kernels::json_structural_index_chunk(text, 0, &mut room(len), dirty, &mut [0; 3])
    };
    gives([(64, 0), (0, 8), (0, 8)], || {
        [index(64, &mut [0]), index(63, &mut [0]), index(64, &mut [])]
    });
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn xxh3() {
    for t in texts(MIXED).filter(|t| t.len() > 240) {
        gives_the_same_everywhere(|| kernels::xxhash3_64_long(&t));
    }
    gives(None, || kernels::xxhash3_64_long(&[0; 240]));
    let counting: Vec<u8> = (0..2048).map(|i| (i % 251) as u8).collect();
    gives(Some(0x2533_9063_DB86_1586), || {
        kernels::xxhash3_64_long(&counting)
    });
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn png() {
    for row in texts(MIXED) {
        let flat = (0..row.len()).map(|i| (i / 128) as u8).collect();
        for above in [row.iter().rev().copied().collect::<Vec<u8>>(), flat] {
            let filter = || {
                let mut rows = [(); 4].map(|()| vec![0; row.len()]);
                let into = rows.each_mut().map(|row| &mut row[..]);
                (kernels::png_filter_rgba(&row, &above, into), rows)
            };
            gives_the_same_everywhere(filter);
            let pixels = ..row.len() & !3;
            for (filter_type, filtered) in (1..).zip(filter().1) {
                gives(row[pixels].to_vec(), || {
                    let mut back = filtered[pixels].to_vec();
                    kernels::png_unfilter4(filter_type, &mut back, &above[pixels]);
                    back
                });
            }
        }
    }
}

#[test]
fn mappings() {
    // What each adds to the column, and whether it ends the line.
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
                let mut original = vec![];
                let generated = filled(2 * count, |generated| {
                    original = filled(2 * count, |original| {
                        let columns = kernels::Columns {
                            generated: generated.as_chunks_mut().0,
                            original: original.as_chunks_mut().0,
                            src_idx: &mut Box::new_uninit_slice(count),
                            name_idx: Some(&mut Box::new_uninit_slice(count)),
                        };
                        let state = &mut Default::default();
                        let (rows, resume_at) = kernels::parse_mappings(&text, columns, 2, state);
                        assert!(text.len() - resume_at < 64, "{target:?}");
                        2 * rows
                    });
                    original.len()
                });
                let rows = generated.as_chunks().0.iter().zip(original.as_chunks().0);
                let got: Vec<_> = rows.map(|(&[a, b], &[c, d])| [a, b, c, d]).collect();
                assert_eq!(got, want[..got.len()], "{target:?}");
            }
        }
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn images() {
    for t in texts(MIXED) {
        let pixels: &[[u8; 4]] = t.as_chunks().0;
        let times = |a: u8, k: u8| ((u32::from(a) * u32::from(k) + 127) / 255) as u8;
        let rgba = |&[c, m, y, k]: &[u8; 4]| [times(c, k), times(m, k), times(y, k), 255];
        gives(pixels.iter().map(rgba).collect(), || {
            let mut out = pixels.to_vec();
            kernels::cmyk_to_rgba(&mut out);
            out
        });
        let grey_doubled = |&[r, _, _, a]: &[u8; 4]| {
            let doubled = r.saturating_mul(2);
            ([r, r, r, a], [doubled, doubled, doubled, a])
        };
        let (grey, doubled): (Vec<_>, Vec<_>) = pixels.iter().map(grey_doubled).unzip();
        gives(doubled, || {
            let mut out = grey.clone();
            kernels::modulate(&mut out, 2.0, 0.5);
            out
        });
        if let Some(height @ 1..) = pixels.len().checked_div(7) {
            gives_the_same_everywhere(|| {
                let mut out = vec![[0; 4]; 19 * 3];
                kernels::Resizer::default().lanczos3(&pixels[..7 * height], 7, &mut out, 19);
                out
            });
        }
    }
    gives(vec![[77; 4]; 13 * 5], || {
        let mut out = vec![[0; 4]; 13 * 5];
        kernels::Resizer::default().lanczos3(&[[77; 4]; 21 * 9], 21, &mut out, 13);
        out
    });
}

#[test]
fn next_to_a_writer() {
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
                kernels::encode_hex_lower_shared(&text, &mut vec![0; 2 * len]);
                kernels::fill_shared_with_mask([0; 4], &text, &vec![0; len]);
            }
        });
    }
}
