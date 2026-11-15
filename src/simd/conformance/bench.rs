//! Each line has a name and two times in nanoseconds, separated by tabs.
#![allow(clippy::useless_conversion)] // to `Out` for Rust, and to the same type for Highway
use crate::pairs::{self, Pairs};
use crate::room::Room;
use crate::{Random, columns, highway, shared, write_line};
use bun_simd_kernels::{self as rust, Filter::Lanczos3};
use core::fmt::Arguments;
use core::hint::black_box as opaque;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;
use std::time::Instant;

/// Prints the best of many short runs of `run(is_second, times)`.
fn compare(name: Arguments<'_>, run: &mut dyn FnMut(bool, u32)) {
    let mut time = |side, times| {
        let start = Instant::now();
        run(side, times);
        start.elapsed().as_secs_f64() * 1e9 / f64::from(times)
    };
    let mut times = 1;
    while time(false, times).min(time(true, times)) * f64::from(times) < 2e5 {
        times *= 2;
    }
    let (mut best, start) = ([f64::MAX; 2], Instant::now());
    for turn in 0..40 {
        if turn >= 5 && start.elapsed().as_millis() > 200 {
            break;
        }
        best = [
            best[0].min(time(false, times)),
            best[1].min(time(true, times)),
        ];
    }
    write_line(format_args!("{name}\t{:.2}\t{:.2}", best[0], best[1]));
}

macro_rules! compare {
    // The same code, with `$k` as the name of either module.
    ($name:literal, |$k:ident| $code:expr) => {
        compare!(
            $name,
            {
                use highway as $k;
                $code
            },
            {
                use rust as $k;
                $code
            }
        )
    };
    ($name:literal, $first:expr, $second:expr) => {
        compare(format_args!($name), &mut |is_second, times| {
            if is_second {
                for _ in 0..times {
                    opaque($second);
                }
            } else {
                for _ in 0..times {
                    opaque($first);
                }
            }
        })
    };
}

impl<T> Pairs<T> for &[T] {
    fn pair<R>(&mut self, highway: impl Fn(&[T]) -> R, rust: impl Fn(&[T]) -> R) {
        let (name, n) = (pairs::name_of(&rust), self.len());
        compare!("{name} {n}", highway(opaque(self)), rust(opaque(self)));
    }
}

fn searches(plain: &[u8]) {
    for n in [16, 24, 48, 64, 100, 1000, 65536] {
        compare!("index_of_char miss {n}", |k| {
            k::index_of_char(opaque(&plain[..n]), b'x')
        });
    }
    for n in [64, 100, 65536] {
        let t = &plain[..n];
        compare!("last_index_of_char miss {n}", |k| {
            k::last_index_of_char(opaque(t), b'x')
        });
        compare!("any of 2 miss {n}", |k| {
            k::index_of_any_char(opaque(t), b"xy")
        });
        compare!("count_char {n}", |k| k::count_char(opaque(t), b'a'));
        compare!("string_literal miss {n}", |k| {
            k::index_of_interesting_character_in_string_literal(opaque(t), b'"')
        });
    }
    for n in [12, 64, 100, 16384] {
        let (t, wide) = (&plain[..n], &vec![u16::from(b'a'); n]);
        compare!("any of 6 miss {n}", |k| {
            k::index_of_any_char(opaque(t), opaque(b"<>&\"'\n"))
        });
        compare!("any of 6 known miss {n}", |k| {
            k::index_of_any_char(opaque(t), b"<>&\"'\n")
        });
        compare!("last of 3 miss {n}", |k| {
            k::last_index_of_any_char(opaque(t), b"\n\r\xE2")
        });
        compare!("index_of_not_char miss {n}", |k| {
            k::index_of_not_char(opaque(t), b'a')
        });
        compare!("memrmem miss {n}", |k| k::memrmem(
            opaque(t),
            opaque(b"xyz")
        ));
        compare!("index_of_char16 miss {n}", |k| k::index_of_char16(
            opaque(wide),
            1
        ));
        compare!(
            "last_index_of_char16 miss {n}",
            |k| k::last_index_of_char16(opaque(wide), 1)
        );
        compare!("memrmem16 miss {n}", |k| k::memrmem16(
            opaque(wide),
            opaque(&[1, 2, 3])
        ));
        compare!("common_prefix_length {n}", |k| {
            k::common_prefix_length(opaque(t), opaque(&plain[1..]))
        });
        compare!("template miss {n}", |k| {
            k::index_of_needs_escape_for_javascript_string(opaque(t), b'`')
        });
        let (mut t, mut wide) = (t, &wide[..]);
        t.pair(
            highway::index_of_newline_or_non_ascii,
            rust::index_of_newline_or_non_ascii,
        );
        t.pair(
            highway::index_of_newline_or_non_ascii_or_hash_or_at,
            rust::index_of_newline_or_non_ascii_or_hash_or_at,
        );
        pairs::of_bytes(&mut t);
        pairs::of_units(&mut wide);
    }
    for n in [1, 3, 1000] {
        let colored = &b"\x1B[1;31merror\x1B[0m: not found ".repeat(n);
        compare!("width of {n} colored words", |k| {
            k::visible_latin1_width_exclude_ansi(opaque(colored))
        });
        let links = &b"see \x1B]8;;https://bun.com/docs\x1B\\the docs\x1B]8;;\x1B\\ ".repeat(n);
        compare!("width of {n} links", |k| {
            k::visible_latin1_width_exclude_ansi(opaque(links))
        });
    }
}

#[inline(always)]
fn each<R>(all: &[&[u8]], mut kernel: impl FnMut(&[u8]) -> R) {
    for piece in opaque(all) {
        opaque(kernel(piece));
    }
}

#[inline(always)]
fn branch_on(found: Option<usize>) {
    if let Some(at) = found {
        opaque(at);
    }
}

/// The words and the lines of a program, in their order.
fn pieces(js: &[u8]) {
    let words: fn(&u8) -> bool = |byte| !byte.is_ascii_alphanumeric();
    let lines: fn(&u8) -> bool = |byte| matches!(byte, b'\n' | b'\r');
    let out = &mut vec![0; 1 << 16];
    for (name, ends) in [("words", words), ("lines", lines)] {
        let all = js
            .split(ends)
            .filter(|piece| (1..1 << 15).contains(&piece.len()));
        let all: &Vec<_> = &all.take(20_000).collect();
        compare!("index_of_char of 20000 {name}", |k| {
            each(all, |t| k::index_of_char(t, b'e'))
        });
        compare!("last_index_of_char of 20000 {name}", |k| {
            each(all, |t| k::last_index_of_char(t, b'e'))
        });
        compare!("branch on index_of_char of 20000 {name}", |k| {
            each(all, |t| branch_on(k::index_of_char(t, b'e')))
        });
        compare!("branch on last_index_of_char of 20000 {name}", |k| {
            each(all, |t| branch_on(k::last_index_of_char(t, b'e')))
        });
        compare!("string_literal of 20000 {name}", |k| {
            each(all, |t| {
                k::index_of_interesting_character_in_string_literal(t, b'"')
            })
        });
        compare!("count_char of 20000 {name}", |k| {
            each(all, |t| k::count_char(t, b'e'))
        });
        compare!("memmem of 20000 {name}", |k| {
            each(all, |t| k::memmem(t, b"this"))
        });
        compare!("memrmem of 20000 {name}", |k| {
            each(all, |t| k::memrmem(t, b"this"))
        });
        compare!("any of 3 of 20000 {name}", |k| {
            each(all, |t| k::index_of_any_char(t, b"`\\$"))
        });
        compare!("any of 6 of 20000 {name}", |k| {
            each(all, |t| k::index_of_any_char(t, b"{}'\"`/"))
        });
        compare!("last_index_of_slash_or_dot of 20000 {name}", |k| {
            each(all, k::last_index_of_slash_or_dot)
        });
        compare!("index_of_untidy_slash of 20000 {name}", |k| {
            each(all, k::index_of_untidy_slash)
        });
        compare!("width of 20000 {name}", |k| {
            each(all, k::visible_latin1_width_exclude_ansi)
        });
        compare!("lower_ascii of 20000 {name}", |k| {
            each(all, |t| _ = k::lower_ascii(t, out.as_mut_slice().into()))
        });
        compare!("copy_ascii_prefix of 20000 {name}", |k| {
            each(all, |t| {
                _ = k::copy_ascii_prefix(t, out.as_mut_slice().into())
            })
        });
        compare!("fill_with_mask of 20000 {name}", |k| {
            each(all, |t| {
                _ = k::fill_with_mask([1, 2, 3, 4], out.as_mut_slice().into(), t)
            })
        });
        compare!("encode_hex_lower of 20000 {name}", |k| {
            each(all, |t| {
                _ = k::encode_hex_lower(t, out.as_chunks_mut().0.into())
            })
        });
    }
}

#[inline(always)]
fn hop<T>(text: &[T], find: impl Fn(&[T]) -> Option<usize>) -> &[T] {
    let mut rest = opaque(text);
    while let Some(at) = find(rest) {
        rest = &rest[at + 1..];
    }
    rest
}

/// Many short searches in a long text, like those of a lexer.
fn hops(js: &[u8]) {
    compare!("index_of_char hops through 1 MB", |k| {
        hop(js, |t| k::index_of_char(t, b'\n'))
    });
    compare!("string_literal hops through 1 MB", |k| {
        hop(js, |t| {
            k::index_of_interesting_character_in_string_literal(t, b'"')
        })
    });
    compare!("any of 6 hops through 1 MB", |k| {
        hop(js, |t| k::index_of_any_char(t, b"{}'\"`/"))
    });
    compare!("memmem hops through 1 MB", |k| {
        hop(js, |t| k::memmem(t, b"function"))
    });
}

fn whole_files(js: &[u8], json: &[u8], map: &[u8]) {
    let url = b"//# sourceMappingURL=data:";
    compare!("memmem miss 1 MB", |k| k::memmem(opaque(js), opaque(url)));
    compare!("memmem miss 40", |k| {
        k::memmem(opaque(&js[..40]), opaque(b"xyz"))
    });
    for (period, times) in [(&b"a"[..], 3), (b"a", 15), (b"ab", 20), (b"ab", 400)] {
        let (text, needle) = (&period.repeat(1 << 15), &mut period.repeat(times));
        needle[times / 2 * period.len()] = b'b';
        let len = needle.len();
        compare!("memmem of {len} that almost match", |k| {
            k::memmem(opaque(text), opaque(needle))
        });
        compare!("memrmem of {len} that almost match", |k| {
            k::memrmem(opaque(text), opaque(needle))
        });
    }
    let sentence = b"the quick brown fox jumps over it";
    compare!("memmem of 33 miss 1 MB", |k| k::memmem(
        opaque(js),
        opaque(sentence)
    ));
    compare!("memmem of 33 miss 100", |k| {
        k::memmem(opaque(&js[..100]), opaque(sentence))
    });
    compare!("line_starts 1 MB", |k| k::line_starts(opaque(js)));
    let one_line = &vec![b'a'; js.len()];
    compare!("line_starts miss 1 MB", |k| k::line_starts(opaque(
        one_line
    )));
    for n in [3, 7, 12, 30, 100, 200, 300, 65536] {
        let text = &js[..n];
        compare!("xxhash32 {n}", |k| k::xxhash32(opaque(0), opaque(text)));
        compare!("xxhash64 {n}", |k| k::xxhash64(opaque(0), opaque(text)));
        compare!("xxhash64 of 100 parts of {n}", |k| {
            let mut state = k::XxHash64State::new(0);
            (0..100).for_each(|_| state.update(opaque(text)));
            state.digest()
        });
    }

    let (text, mut buffer) = (&js[..1 << 18], highway::ScannerStopsBuffer::default());
    let mut planes = [(); 3].map(|()| vec![[0; 8]; text.len() / 64]);
    compare!(
        "scanner_run_stops 256 KB",
        {
            opaque(buffer.find(opaque(text)));
        },
        rust::scanner_run_stops(opaque(text), planes.each_mut().map(|plane| &mut plane[..]))
    );

    let (index, dirty) = (&mut vec![MaybeUninit::uninit(); 8192 + 66], &mut [0; 2]);
    compare!("json 256 KB", |k| {
        let mut state = [0; 3];
        for (i, chunk) in opaque(&json[..1 << 18]).chunks(8192).enumerate() {
            opaque(k::json_structural_index_chunk(
                chunk,
                i * 8192,
                index.as_mut_slice().into(),
                dirty,
                &mut state,
            ));
        }
    });

    let xml = &b"<item id=\"7\" kind='a'>\n  <name>fish &amp; chips</name>\n</item>\n".repeat(120);
    compare!("xml 8 KB", |k| {
        k::xml_structural_index_chunk(opaque(xml), 0, index.as_mut_slice().into(), &mut [0; 3])
    });
    let xml: &Vec<u16> = &xml.iter().map(|&byte| byte.into()).collect();
    compare!("xml16 8 K", |k| {
        k::xml_structural_index16_chunk(opaque(xml), 0, index.as_mut_slice().into(), &mut [0; 3])
    });
    let marks = &mut vec![0; js.len() / 4096];
    compare!(
        "odd_blocks 1 MB",
        highway::odd_blocks(opaque(js), marks),
        rust::odd_blocks(opaque(js), marks.as_mut_slice().into())
    );

    let (random, segments) = (
        &mut Random(3),
        ["CAAC,", "EAAE,", "IAAI,", "gBAAgB,", "kCAAkC,"],
    );
    let one_line: String = (0..45_000).map(|_| random.one_of(&segments)).collect();
    for (name, map, has_names) in [
        ("of a bundle", map, true),
        ("of one line", one_line.as_bytes(), false),
        ("all alike", &b"CAAC,".repeat(50_000), false),
    ] {
        let cap = highway::count_mapping_delims(map) + 1;
        let mut pairs = [(); 2].map(|()| Box::new_uninit_slice(cap));
        let mut indices = [(); 2].map(|()| Box::new_uninit_slice(cap));
        let pairs = &mut pairs.each_mut().map(|column| &mut column[..]);
        let indices = &mut indices.each_mut().map(|column| &mut column[..]);
        compare!("mappings {name}", |k| {
            let out = columns(pairs, indices, has_names);
            k::parse_mappings(opaque(map), out, 1 << 20, &mut Default::default())
        });
    }
}

fn conversions(js: &[u8]) {
    for n in [12, 32, 64, 100, 16384] {
        let (t, out, wide_out) = (&js[..n], &mut vec![0; 2 * n], &mut vec![0; n]);
        let wide: &Vec<u16> = &t.iter().map(|&byte| byte.into()).collect();
        compare!("copy_u16_to_u8 {n}", |k| {
            k::copy_u16_to_u8(opaque(wide), opaque(&mut out[..]).into())
        });
        compare!("lower_ascii16 {n}", |k| {
            k::lower_ascii16(opaque(wide), opaque(&mut wide_out[..]).into())
        });
        compare!("fill_with_mask {n}", |k| {
            k::fill_with_mask([1, 2, 3, 4], opaque(&mut out[..]).into(), opaque(t))
        });
        compare!("encode_hex_lower {n}", |k| {
            k::encode_hex_lower(opaque(t), opaque(out.as_chunks_mut().0).into())
        });
        let hex = &out.clone();
        compare!("decode_hex {n}", |k| {
            k::decode_hex(opaque(hex.as_chunks().0), opaque(&mut out[..]).into())
        });
        let hex: &Vec<u16> = &hex.iter().map(|&byte| byte.into()).collect();
        compare!("decode_hex16 {n}", |k| {
            k::decode_hex16(opaque(hex.as_chunks().0), opaque(&mut out[..]).into())
        });
        compare!("lower_ascii {n}", |k| {
            k::lower_ascii(opaque(t), opaque(&mut out[..]).into())
        });
        compare!("copy_ascii_prefix {n}", |k| {
            k::copy_ascii_prefix(opaque(t), opaque(&mut out[..]).into())
        });
        compare!("mask_in_place {n}", |k| {
            k::mask_in_place([1, 2, 3, 4], opaque(&mut out[..n]))
        });
    }
    let words = &Random(7).words_of_all_sizes(4096);
    let (controls, data) = (&mut vec![0; 4096], &mut vec![0; 16 * 4096]);
    compare!("pack_words 16384", |k| {
        k::pack_words(
            opaque(words),
            controls.as_mut_slice().into(),
            data.as_mut_slice().into(),
        )
    });
    let out = &mut vec![[0; 4]; 4096];
    compare!("unpack_words 16384", |k| {
        k::unpack_words(opaque(controls), data, out.as_mut_slice().into())
    });
}

fn images() {
    const WIDTH: usize = 1024;
    let random = &mut Random(9);
    let pixel = |i: usize| {
        let (x, y, noise) = (i % WIDTH, i / WIDTH, random.below(6));
        [
            (x / 4 + noise) as u8,
            (y / 3 + noise) as u8,
            ((x + y) / 7) as u8,
            255,
        ]
    };
    let image: &Vec<[u8; 4]> = &(0..WIDTH * 768).map(pixel).collect();
    for n in [3, 16, 25, 4096, image.len()] {
        let pixels = &mut image[..n].to_vec();
        compare!("cmyk_to_rgba {n} px", |k| k::cmyk_to_rgba(opaque(pixels)));
        compare!("modulate {n} px", |k| k::modulate(opaque(pixels), 1.0, 1.0));
    }
    let [above, row] = [299, 300].map(|y| &image[y * WIDTH..][..WIDTH]);
    let rows = &mut [(); 4].map(|()| vec![[0; 4]; WIDTH]);
    for n in [3, 7, 15, WIDTH] {
        compare!("png_filter_rgba {n} px", |k| {
            let into = rows.each_mut().map(|row| &mut row[..n]);
            k::png_filter_rgba(opaque(&row[..n]), &above[..n], into)
        });
    }
    for size in [1, 2, 4, 6, 8] {
        let [above, row] = [above, row].map(|row| &row.as_flattened()[..4080]);
        for (filter_type, name) in (1..).zip(["sub", "up", "average", "paeth"]) {
            let row = &mut row.to_vec();
            compare!("png_unfilter {size} {name}", |k| {
                k::png_unfilter(filter_type, size, opaque(row), above)
            });
        }
    }
    for size in [1, 4, 8] {
        let row = &mut row.as_flattened().to_vec();
        compare!("png_unfilter {size} paeth below one color", |k| {
            k::png_unfilter(4, size, opaque(row), &[7; 4 * WIDTH])
        });
    }
    for n in [3, 8, 16, 256] {
        compare!("nearest_in_palette {n}", |k| {
            k::nearest_in_palette(opaque(&row[..n]), opaque([9, 8, 7, 255]))
        });
    }
    for (width, height) in [(30, 20), (1000, 750), (1024, 1024), (4032, 3024)] {
        let (image, out) = (
            &vec![[1; 4]; width * height],
            &mut vec![[0; 4]; width * height],
        );
        for (name, highway, rust) in pairs::MOVES {
            compare!(
                "{name} {width}x{height}",
                highway(opaque(image), width, out),
                rust(opaque(image), width, out.as_mut_slice().into())
            );
        }
    }
    let (mut a, mut b) = (highway::Resizer::default(), rust::Resizer::default());
    let out = &mut vec![[0; 4]; 400 * 300];
    compare!(
        "lanczos3 1024x768 to 400x300",
        a.resize(Lanczos3, opaque(image), WIDTH, out, 400),
        b.resize(
            Lanczos3,
            opaque(image),
            WIDTH,
            out.as_mut_slice().into(),
            400
        )
    );
}

/// Highway has the same kernels for shared memory.
fn from_shared(js: &[u8]) {
    for n in [12, 64, 100, 1000, 65536] {
        let (t, out) = (&mut vec![b'a'; n], &mut vec![0; 2 * n]);
        compare!(
            "shared: index_of_char miss {n}",
            highway::index_of_char(opaque(t), b'x'),
            rust::index_of_char_shared(shared(opaque(t)), b'x')
        );
        compare!(
            "shared: last_index_of_char miss {n}",
            highway::last_index_of_char(opaque(t), b'x'),
            rust::last_index_of_char_shared(shared(opaque(t)), b'x')
        );
        for needle in [&b"xyz"[..], b"\r\n--boundary-of-24-bytes"] {
            let (len, needle) = (needle.len(), &mut needle.to_vec());
            compare!(
                "shared: memmem of {len} miss {n}",
                highway::memmem(opaque(t), opaque(needle)),
                rust::memmem_shared(shared(opaque(t)), shared(opaque(needle)))
            );
            compare!(
                "shared: memrmem of {len} miss {n}",
                highway::memrmem(opaque(t), opaque(needle)),
                rust::memrmem_shared(shared(opaque(t)), shared(opaque(needle)))
            );
        }
        let (wide, needle) = (&vec![0x6161; n / 2], &mut [1, 0, 2, 0, 3, 0]);
        compare!(
            "shared: memmem16 miss {n}",
            highway::memmem16(opaque(wide), opaque(&[1, 2, 3])),
            rust::memmem16_shared(
                shared(opaque(t)).as_chunks().0,
                shared(needle).as_chunks().0
            )
        );
        compare!(
            "shared: memrmem16 miss {n}",
            highway::memrmem16(opaque(wide), opaque(&[1, 2, 3])),
            rust::memrmem16_shared(
                shared(opaque(t)).as_chunks().0,
                shared(needle).as_chunks().0
            )
        );
        compare!(
            "shared: encode_hex_lower {n}",
            highway::encode_hex_lower(opaque(t), out.as_chunks_mut().0),
            rust::encode_hex_lower_shared(shared(opaque(t)), out.as_chunks_mut().0.into())
        );
        compare!(
            "shared: fill_with_mask {n}",
            highway::fill_with_mask([1; 4], out, opaque(t)),
            rust::fill_with_mask_from_shared([1; 4], out.as_mut_slice().into(), shared(opaque(t)))
        );
    }
    let (t, needle) = (&mut js.to_vec(), &mut b"function".to_vec());
    compare!(
        "shared: memmem hops through 1 MB",
        hop(t, |t| highway::memmem(t, needle)).len(),
        {
            let needle = shared(needle);
            hop(shared(t), |t| rust::memmem_shared(t, needle)).len()
        }
    );
    for n in [3, 7, 12, 30, 100, 200, 300, 65536] {
        let t = &mut js[..n].to_vec();
        for seed in [0, 1] {
            compare!(
                "shared: xxhash3 with seed {seed} {n}",
                highway::xxhash3_64(opaque(seed), opaque(t)),
                rust::xxhash3_64_shared(opaque(seed), shared(opaque(t)))
            );
        }
        compare!(
            "shared: xxhash32 {n}",
            highway::xxhash32(opaque(0), opaque(t)),
            rust::xxhash32_shared(opaque(0), shared(opaque(t)))
        );
        compare!(
            "shared: xxhash64 {n}",
            highway::xxhash64(opaque(0), opaque(t)),
            rust::xxhash64_shared(opaque(0), shared(opaque(t)))
        );
    }
}

fn to_shared() {
    let shared = AtomicU8::from_mut_slice;
    for n in [12, 32, 64, 100, 1000, 65536] {
        let (t, wide, out) = (&vec![b'a'; 2 * n], &vec![0x61; 2 * n], &mut vec![0; n]);
        compare!(
            "to shared: decode_hex {n}",
            highway::decode_hex(opaque(t).as_chunks().0, out).len(),
            rust::decode_hex_to_shared(opaque(t).as_chunks().0, shared(out))
        );
        compare!(
            "to shared: decode_hex16 {n}",
            highway::decode_hex16(opaque(wide).as_chunks().0, out).len(),
            rust::decode_hex16_to_shared(opaque(wide).as_chunks().0, shared(out))
        );
        compare!(
            "to shared: copy_u16_to_u8 {n}",
            highway::copy_u16_to_u8(opaque(&wide[..n]), out),
            rust::copy_u16_to_shared(opaque(&wide[..n]), shared(out))
        );
        compare!(
            "to shared: copy_ascii_prefix {n}",
            highway::copy_ascii_prefix(opaque(&t[..n]), out).len(),
            rust::copy_ascii_prefix_to_shared(opaque(&t[..n]), shared(out))
        );
        for (name, highway, rust) in pairs::SWAPS {
            compare!(
                "shared: {name} {n}",
                highway(opaque(out)),
                rust(shared(opaque(out)))
            );
        }
    }
}

/// Highway, then Rust.
pub(crate) fn against_highway(js: &[u8], json: &[u8], map: &[u8]) {
    let js = &js[js.len() / 2..][..1 << 20];
    searches(&vec![b'a'; 1 << 16]);
    pieces(js);
    hops(js);
    whole_files(js, json, map);
    conversions(js);
    images();
    from_shared(js);
    to_shared();
}

fn both<R>(name: &str, texts: &mut [&mut [u8]; 2], mut kernel: impl FnMut(&mut [u8]) -> R) {
    let name = format_args!("{name} {}", texts[0].len());
    compare(name, &mut |is_second, times| {
        for _ in 0..times {
            opaque(kernel(opaque(texts[usize::from(is_second)])));
        }
    });
}

/// In the middle of a page, then before an inaccessible page.
pub(crate) fn at_the_end_of_a_page() {
    let [mut a, mut b] = [(); 2].map(|()| Room::new());
    for n in [5, 20, 40] {
        let (text, wide) = (&vec![b'a'; n], &vec![1; n]);
        let texts = &mut [a.copy_of(text, 2000), b.copy_of(text, usize::MAX)];
        both("index_of_char", texts, |t| rust::index_of_char(t, b'x'));
        both("last_index_of_char", texts, |t| {
            rust::last_index_of_char(t, b'x')
        });
        both("count_char", texts, |t| rust::count_char(t, b'x'));
        both("memmem", texts, |t| rust::memmem(t, b"xy"));
        both("line_starts", texts, |t| rust::line_starts(t));
        both("shared", texts, |t| {
            rust::index_of_char_shared(shared(t), b'x')
        });
        both("fill_with_mask", texts, |t| {
            rust::fill_with_mask([0; 4], t.into(), text);
        });
        both("copy_u16_to_u8", texts, |t| {
            _ = rust::copy_u16_to_u8(wide, t.into())
        });
        both("encode_hex_lower", texts, |t| {
            rust::encode_hex_lower(text, t.as_chunks_mut().0.into());
        });
        both("png_unfilter", texts, |t| rust::png_unfilter(2, 1, t, text));
    }
}

/// A step of scalar code alone, then with a short search every so many steps.
pub(crate) fn of_scalar_code_between_searches() {
    const STEPS: u32 = 1 << 24;
    let text = &[b'a'; 256];
    for steps_between in [1 << 13, 1 << 16, 1 << 19] {
        let time = |searches: bool| {
            let (start, mut x) = (Instant::now(), 3u64);
            for _ in 0..STEPS / steps_between {
                if searches {
                    opaque(crate::simd::search_on_any_target(opaque(text)));
                }
                for _ in 0..steps_between {
                    x = x.wrapping_mul(x) | 1;
                }
            }
            opaque(x);
            start.elapsed().as_secs_f64() * 1e9 / f64::from(STEPS)
        };
        let mut times = [[0.0; 15]; 2];
        for turn in 0..15 {
            (times[0][turn], times[1][turn]) = (time(false), time(true));
        }
        let [alone, between] =
            times.map(|mut times| *times.select_nth_unstable_by(7, f64::total_cmp).1);
        write_line(format_args!(
            "a search every {steps_between} steps\t{alone:.4}\t{between:.4}"
        ));
    }
}
