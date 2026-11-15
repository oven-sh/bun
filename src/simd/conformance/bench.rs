//! Each line has a name and two times in nanoseconds, with tabs between them.
use crate::room::Room;
use crate::{Random, highway};
use bun_simd_kernels::{self as rust, Columns};
use core::fmt::Arguments;
use core::hint::black_box as opaque;
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;
use std::time::Instant;

/// `run(side, times)`. The best of many short turns.
fn compare(name: Arguments<'_>, run: &mut dyn FnMut(bool, u32)) {
    let mut time = |side, times| {
        let start = Instant::now();
        run(side, times);
        start.elapsed().as_secs_f64() * 1e9 / f64::from(times)
    };
    let mut times = 1;
    while time(false, times).min(time(true, times)) * f64::from(times) < 5e5 {
        times *= 2;
    }
    let mut best = [f64::MAX; 2];
    for _ in 0..40 {
        best = [
            best[0].min(time(false, times)),
            best[1].min(time(true, times)),
        ];
    }
    output_line!("{name}\t{:.2}\t{:.2}", best[0], best[1]);
}

macro_rules! compare {
    ([$($name:tt)*], $first:expr, $second:expr) => {
        compare(format_args!($($name)*), &mut |is_second, times| {
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
    // The same text for both.
    ([$($name:tt)*], |$side:ident| $code:expr) => {
        compare!([$($name)*], { use highway as $side; $code }, { use rust as $side; $code })
    };
}

fn searches(plain: &[u8]) {
    for n in [16, 24, 48, 64, 100, 1000, 65536] {
        compare!(["index_of_char miss {n}"], |k| k::index_of_char(
            opaque(&plain[..n]),
            b'x'
        ));
    }
    for n in [64, 100, 65536] {
        let t = &plain[..n];
        compare!(["last_index_of_char miss {n}"], |k| k::last_index_of_char(
            opaque(t),
            b'x'
        ));
        compare!(["index_of_either miss {n}"], |k| k::index_of_either(
            opaque(t),
            *b"xy"
        ));
        compare!(["count_char {n}"], |k| k::count_char(opaque(t), b'a'));
        compare!(["string_literal miss {n}"], |k| {
            k::index_of_interesting_character_in_string_literal(opaque(t), b'"')
        });
    }
    for n in [12, 64, 100, 16384] {
        let (t, wide) = (&plain[..n], &vec![u16::from(b'a'); n]);
        compare!(
            ["html_escape8 miss {n}"],
            |k| k::index_of_html_escape_char8(opaque(t))
        );
        compare!(["html_escape16 miss {n}"], |k| {
            k::index_of_html_escape_char16(opaque(wide))
        });
        compare!(["first_non_ascii16 miss {n}"], |k| k::first_non_ascii16(
            opaque(wide)
        ));
        compare!(["any of 6 miss {n}"], |k| k::index_of_any_char(
            opaque(t),
            opaque(b"<>&\"'\n")
        ));
        compare!(
            ["last_index_of_slash miss {n}"],
            |k| k::last_index_of_slash(opaque(t))
        );
    }
}

/// Slices as long as the words or the lines of a program, in the order they come in.
fn pieces(js: &[u8]) {
    let words: fn(&u8) -> bool = |byte| !byte.is_ascii_alphanumeric();
    let lines: fn(&u8) -> bool = |byte| matches!(byte, b'\n' | b'\r');
    let out = &mut vec![0; 1 << 16];
    for (name, ends) in [("words", words), ("lines", lines)] {
        let all = js
            .split(ends)
            .filter(|piece| (1..1 << 15).contains(&piece.len()));
        let all: &Vec<_> = &all.take(20_000).collect();
        macro_rules! each {
            ($kernel:literal, |$side:ident, $t:ident| $code:expr) => {
                compare!(["{} of 20000 {name}", $kernel], |$side| {
                    for &$t in opaque(all) {
                        opaque($code);
                    }
                })
            };
        }
        each!("index_of_char", |k, t| k::index_of_char(t, b'e'));
        each!("last_index_of_char", |k, t| k::last_index_of_char(t, b'e'));
        each!("branch on index_of_char", |k, t| {
            if let Some(at) = k::index_of_char(t, b'e') {
                opaque(at);
            }
        });
        each!("branch on last_index_of_char", |k, t| {
            if let Some(at) = k::last_index_of_char(t, b'e') {
                opaque(at);
            }
        });
        each!("string_literal", |k, t| {
            k::index_of_interesting_character_in_string_literal(t, b'"')
        });
        each!("count_char", |k, t| k::count_char(t, b'e'));
        each!("memmem", |k, t| k::memmem(t, b"this"));
        each!("fill_with_mask", |k, t| k::fill_with_mask(
            [1, 2, 3, 4],
            out,
            t
        ));
        each!("encode_hex_lower", |k, t| k::encode_hex_lower(t, out));
    }
}

/// Many short hops through a long text, as a lexer takes them.
fn hops(js: &[u8]) {
    macro_rules! hops {
        ($kernel:literal, |$side:ident, $t:ident| $code:expr) => {
            compare!(["{} hops through 1 MB", $kernel], |$side| {
                let mut $t = opaque(js);
                while let Some(at) = $code {
                    $t = &$t[at + 1..];
                }
                $t
            })
        };
    }
    hops!("index_of_char", |k, t| k::index_of_char(t, b'\n'));
    hops!("string_literal", |k, t| {
        k::index_of_interesting_character_in_string_literal(t, b'"')
    });
    hops!("memmem", |k, t| k::memmem(t, b"function"));
}

fn whole_files(js: &[u8], json: &[u8], map: &[u8]) {
    let url = b"//# sourceMappingURL=data:";
    compare!(["memmem miss 1 MB"], |k| k::memmem(opaque(js), opaque(url)));
    compare!(["memmem miss 40"], |k| k::memmem(
        opaque(&js[..40]),
        opaque(b"xyz")
    ));
    compare!(["line_starts 1 MB"], |k| k::line_starts(opaque(js)));
    for n in [300, 65536] {
        compare!(["xxhash3 {n}"], |k| k::xxhash3_64_long(opaque(&js[..n])));
    }

    let (text, mut buffer) = (&js[..1 << 18], highway::ScannerStopsBuffer::default());
    let mut planes = [(); 3].map(|()| vec![[0; 8]; text.len() / 64]);
    compare!(
        ["scanner_run_stops 256 KB"],
        {
            opaque(buffer.find(opaque(text)));
        },
        { rust::scanner_run_stops(opaque(text), planes.each_mut().map(|plane| &mut plane[..])) }
    );

    let (index, dirty) = (&mut vec![MaybeUninit::uninit(); 8192 + 66], &mut [0; 2]);
    compare!(["json 256 KB"], |k| {
        let mut state = [0; 3];
        for (i, chunk) in opaque(&json[..1 << 18]).chunks(8192).enumerate() {
            opaque(k::json_structural_index_chunk(
                chunk,
                i * 8192,
                index,
                dirty,
                &mut state,
            ));
        }
    });

    for (name, map, has_names) in [
        ("of a bundle", map, true),
        ("all alike", &b"CAAC,".repeat(50_000), false),
    ] {
        let cap = highway::count_mapping_delims(map) + 1;
        let (mut pairs, mut singles) = (
            Box::new_uninit_slice(4 * cap),
            Box::new_uninit_slice(2 * cap),
        );
        macro_rules! columns {
            () => {{
                let (generated, original) = pairs.as_chunks_mut().0.split_at_mut(cap);
                let (src_idx, names) = singles.split_at_mut(cap);
                let name_idx = has_names.then_some(names);
                Columns {
                    generated,
                    original,
                    src_idx,
                    name_idx,
                }
            }};
        }
        compare!(
            ["mappings {name}"],
            highway::parse_mappings(opaque(map), columns!(), 1 << 20, &Default::default()),
            rust::parse_mappings(opaque(map), columns!(), 1 << 20, &mut Default::default())
        );
    }
}

fn conversions(js: &[u8]) {
    for n in [12, 32, 64, 100, 16384] {
        let (t, out, wide_out) = (&js[..n], &mut vec![0; 2 * n], &mut vec![0; n]);
        let wide: &Vec<u16> = &t.iter().map(|&byte| byte.into()).collect();
        compare!(["copy_u16_to_u8 {n}"], |k| k::copy_u16_to_u8(
            opaque(wide),
            opaque(out)
        ));
        compare!(["lower_ascii16 {n}"], |k| k::lower_ascii16(
            opaque(wide),
            opaque(wide_out)
        ));
        compare!(["fill_with_mask {n}"], |k| k::fill_with_mask(
            [1, 2, 3, 4],
            opaque(out),
            opaque(t)
        ));
        compare!(["encode_hex_lower {n}"], |k| k::encode_hex_lower(
            opaque(t),
            opaque(out)
        ));
        let hex = &out.clone();
        compare!(["decode_hex {n}"], |k| k::decode_hex(
            opaque(hex),
            opaque(out)
        ));
        compare!(["bswap32 {n}"], |k| k::bswap32(
            opaque(&mut out[..n]).as_chunks_mut().0
        ));
    }
    let words = &Random(7).words_of_all_sizes(4096);
    let (controls, data) = (&mut vec![0; 4096], &mut vec![0; 16 * 4096]);
    compare!(["pack_words 16384"], |k| k::pack_words(
        opaque(words),
        controls,
        data
    ));
    let out = &mut vec![[MaybeUninit::uninit(); 4]; 4096];
    compare!(["unpack_words 16384"], |k| k::unpack_words(
        opaque(controls),
        data,
        out
    ));
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
        compare!(["cmyk_to_rgba {n} px"], |k| k::cmyk_to_rgba(opaque(pixels)));
        compare!(["modulate {n} px"], |k| k::modulate(
            opaque(pixels),
            1.0,
            1.0
        ));
    }
    let [above, row] = [299, 300].map(|y| image[y * WIDTH..][..WIDTH].as_flattened());
    let rows = &mut [(); 4].map(|()| vec![0; 4 * WIDTH]);
    for n in [15, WIDTH] {
        compare!(["png_filter_rgba {n} px"], |k| {
            let into = rows.each_mut().map(|row| &mut row[..4 * n]);
            k::png_filter_rgba(opaque(&row[..4 * n]), &above[..4 * n], into)
        });
    }
    for (filter_type, name) in (1..).zip(["sub", "up", "average", "paeth"]) {
        let row = &mut row.to_vec();
        compare!(["png_unfilter4 {name}"], |k| k::png_unfilter4(
            filter_type,
            opaque(row),
            above
        ));
    }
    let (mut a, mut b) = (highway::Resizer::default(), rust::Resizer::default());
    let out = &mut vec![[0; 4]; 400 * 300];
    compare!(
        ["lanczos3 1024x768 to 400x300"],
        a.lanczos3(opaque(image), WIDTH, out, 400),
        { b.lanczos3(opaque(image), WIDTH, out, 400) }
    );
}

/// Highway's kernels are the same for memory that other threads write to.
fn shared() {
    let shared = AtomicU8::from_mut_slice;
    for n in [12, 64, 100, 1000, 65536] {
        let (t, out) = (&mut vec![b'a'; n], &mut vec![0; 2 * n]);
        compare!(
            ["shared: index_of_char miss {n}"],
            highway::index_of_char(opaque(t), b'x'),
            { rust::index_of_char_shared(shared(opaque(t)), b'x') }
        );
        compare!(
            ["shared: last_index_of_char miss {n}"],
            { highway::last_index_of_char(opaque(t), b'x') },
            { rust::last_index_of_char_shared(shared(opaque(t)), b'x') }
        );
        compare!(
            ["shared: count_char {n}"],
            highway::count_char(opaque(t), b'a'),
            { rust::count_char_shared(shared(opaque(t)), b'a') }
        );
        compare!(
            ["shared: encode_hex_lower {n}"],
            highway::encode_hex_lower(opaque(t), out),
            { rust::encode_hex_lower_shared(shared(opaque(t)), out) }
        );
        compare!(
            ["shared: fill_with_mask {n}"],
            highway::fill_with_mask([1; 4], out, opaque(t)),
            { rust::fill_shared_with_mask([1; 4], shared(out), opaque(t)) }
        );
        compare!(
            ["shared: bswap32 {n}"],
            highway::bswap32(opaque(&mut *t).as_chunks_mut().0),
            { rust::bswap32_shared(shared(opaque(t))) }
        );
    }
}

/// Highway, and Rust.
pub(crate) fn against_highway(js: &[u8], json: &[u8], map: &[u8]) {
    let js = &js[js.len() / 2..][..1 << 20];
    searches(&vec![b'a'; 1 << 16]);
    pieces(js);
    hops(js);
    whole_files(js, json, map);
    conversions(js);
    images();
    shared();
}

/// In the middle of a page, and where the next page is missing.
pub(crate) fn at_the_end_of_a_page() {
    let [mut a, mut b] = [(); 2].map(|()| Room::new());
    for n in [5, 20, 40] {
        let (text, wide) = (&vec![b'a'; n], &vec![1; n]);
        let (middle, end) = (a.copy_of(text, 2000), b.copy_of(text, usize::MAX));
        macro_rules! both {
            ($kernel:literal, |$t:ident| $code:expr) => {
                compare!(
                    ["{} {n}", $kernel],
                    {
                        let $t = opaque(&mut *middle);
                        $code
                    },
                    {
                        let $t = opaque(&mut *end);
                        $code
                    }
                )
            };
        }
        both!("index_of_char", |t| rust::index_of_char(t, b'x'));
        both!("last_index_of_char", |t| rust::last_index_of_char(t, b'x'));
        both!("count_char", |t| rust::count_char(t, b'x'));
        both!("memmem", |t| rust::memmem(t, b"xy"));
        both!("line_starts", |t| rust::line_starts(t));
        both!("shared", |t| rust::index_of_char_shared(
            AtomicU8::from_mut_slice(t),
            b'x'
        ));
        both!("fill_with_mask", |t| rust::fill_with_mask([0; 4], t, text));
        both!("copy_u16_to_u8", |t| rust::copy_u16_to_u8(wide, t));
        both!("encode_hex_lower", |t| rust::encode_hex_lower(text, t));
        both!("png_unfilter4", |t| rust::png_unfilter4(2, t, text));
    }
}

/// A step of scalar code on its own, and with a short search every so often.
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
        output_line!("a search every {steps_between} steps\t{alone:.4}\t{between:.4}");
    }
}
