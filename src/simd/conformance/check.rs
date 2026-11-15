//! Gives both the same random input. The slices for Rust are next to inaccessible pages.
use crate::room::Room;
use crate::{Random, columns, highway, write_line};
use bun_simd::Out;
use bun_simd_kernels::{self as rust, ColumnsFilled, MappingsState};
use core::sync::atomic::AtomicU8;

struct Round<'a> {
    random: &'a mut Random,
    rooms: &'a mut [Room; 6],
    /// Of each slice in its room.
    offset: usize,
    text: &'a [u8],
    failures: Failures,
}

#[derive(Default)]
struct Failures(Vec<&'static str>);

impl Failures {
    fn unless(&mut self, is_ok: bool, kernel: &'static str) {
        if !is_ok {
            self.0.push(kernel);
        }
    }
}

fn all<T, U>(kernel: impl Fn(&[T], &mut [U])) -> impl Fn(&[T], &mut [U]) -> usize {
    move |from, to| {
        kernel(from, to);
        to.len()
    }
}

const HEX: &[u8] = b"0123456789abcdefABCDEF";
const JSON: &[u8] = b"{}[]:,\"\"\\ \n\tabc123\x01\xff";
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ALPHABETS: [&[u8]; 7] = [
    b"",
    b"ab",
    b"abcdefghijklmnop \"'\\\n",
    b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@[`{0123456789 abcdefghijklm<>&'\"/",
    HEX,
    JSON,
];

impl Round<'_> {
    fn some_byte(&mut self) -> u8 {
        match self.text {
            [_, ..] if self.random.below(2) == 0 => self.random.one_of(self.text),
            _ => self.random.next() as u8,
        }
    }

    fn mostly_ascii(&mut self) -> Vec<u16> {
        let unit = |&byte: &u8| match self.random.below(200) {
            0 => u16::from(byte) | 0x80 << self.random.below(9),
            _ => u16::from(byte & 0x7F),
        };
        self.text.iter().map(unit).collect()
    }

    fn searches(&mut self) {
        let (text, byte, wide) = (self.text, self.some_byte(), self.mostly_ascii());
        let (len, count) = (self.random.below(text.len() + 1), 2 + self.random.below(15));
        let chars = self.random.bytes(count, b"");
        let [a, b, c, d, ..] = &mut *self.rooms;
        let (fenced, fenced_chars) = (a.copy_of(text, self.offset), b.copy_of(&chars, self.offset));
        let fenced_wide = c.copy_of(&wide, self.offset);
        let shared = &*AtomicU8::from_mut_slice(d.copy_of(text, self.offset));
        let (first, last) = (
            highway::index_of_char(text, byte),
            highway::last_index_of_char(text, byte),
        );
        let count = highway::count_char(text, byte);
        #[rustfmt::skip]
        let results = [
            ("index_of_char", first == rust::index_of_char(fenced, byte)),
            ("index_of_char_shared", first == rust::index_of_char_shared(shared, byte)),
            ("index_of_char_within", first.filter(|&at| at < len)
                == rust::index_of_char_within(fenced, len, byte)),
            ("last_index_of_char", last == rust::last_index_of_char(fenced, byte)),
            ("last_index_of_char_shared", last == rust::last_index_of_char_shared(shared, byte)),
            ("count_char", count == rust::count_char(fenced, byte)),
            ("count_char_shared", count == rust::count_char_shared(shared, byte)),
            ("index_of_either", highway::index_of_either(text, [byte, b'b'])
                == rust::index_of_either(fenced, [byte, b'b'])),
            ("index_of_any_char", highway::index_of_any_char(text, &chars)
                == rust::index_of_any_char(fenced, fenced_chars)),
            ("string_literal", highway::index_of_interesting_character_in_string_literal(text, b'"')
                == rust::index_of_interesting_character_in_string_literal(fenced, b'"')),
            ("index_of_newline_or_non_ascii", text.is_empty()
                || highway::index_of_newline_or_non_ascii(text)
                    == rust::index_of_newline_or_non_ascii(fenced)),
            ("index_of_html_escape_char8", highway::index_of_html_escape_char8(text)
                == rust::index_of_html_escape_char8(fenced)),
            ("index_of_html_escape_char16", highway::index_of_html_escape_char16(&wide)
                == rust::index_of_html_escape_char16(fenced_wide)),
            ("first_non_ascii16", highway::first_non_ascii16(&wide)
                == rust::first_non_ascii16(fenced_wide)),
            ("last_index_of_slash", highway::last_index_of_slash(text)
                == rust::last_index_of_slash(fenced)),
            ("line_starts", highway::line_starts(text) == rust::line_starts(fenced)),
            ("xxhash3_64_long", text.len() <= 240
                || highway::xxhash3_64_long(text) == rust::xxhash3_64_long(fenced)),
        ];
        for (kernel, is_same) in results {
            self.failures.unless(is_same, kernel);
        }
    }

    fn memmem(&mut self) {
        let len = self.random.below(40.min(self.text.len() + 1));
        let at = self.random.below(self.text.len() - len + 1);
        let mut needle = self.text[at..at + len].to_vec();
        if self.random.below(3) == 0 {
            needle.reverse();
        }
        let (mut uniform, mut almost) = (vec![b'a'; 3000], vec![b'a'; 3 + self.random.below(13)]);
        almost[1] = b'b';
        if self.random.below(2) == 0 {
            uniform[self.random.below(2900)..][..almost.len()].copy_from_slice(&almost);
        }
        let [a, b, ..] = &mut *self.rooms;
        for (text, needle) in [(self.text, &needle), (&uniform, &almost)] {
            let got = rust::memmem(a.copy_of(text, self.offset), b.copy_of(needle, self.offset));
            self.failures
                .unless(highway::memmem(text, needle) == got, "memmem");
        }
    }

    fn scanner_run_stops(&mut self) {
        let [a, b, c, d, ..] = &mut *self.rooms;
        let zeros = vec![[0; 8]; self.text.len().div_ceil(64)];
        let mut planes = [b, c, d].map(|room| room.copy_of(&zeros, self.offset));
        let into = planes.each_mut().map(|plane| &mut plane[..]);
        rust::scanner_run_stops(a.copy_of(self.text, self.offset), into);
        let mut buffer = highway::ScannerStopsBuffer::default();
        let stops = buffer.find(self.text);
        let stops = [stops.after_name, stops.after_blanks, stops.in_string];
        for (stops, plane) in stops.into_iter().zip(planes) {
            let is_set = |at: usize| plane.as_flattened()[at / 8] >> (at % 8) & 1 != 0;
            let agree = (0..self.text.len()).all(|at| (stops.run(at) == 0) == is_set(at));
            self.failures.unless(agree, "scanner_run_stops");
        }
    }

    /// `highway` returns how much it has written.
    fn from_to<T: Copy, U: Copy + Default + PartialEq>(
        &mut self,
        name: &'static str,
        (from, len): (&[T], usize),
        highway: impl Fn(&[T], &mut [U]) -> usize,
        rust: impl for<'a> Fn(&mut [T], Out<'a, U>) -> &'a mut [U],
    ) {
        let ([a, b, ..], mut want) = (&mut *self.rooms, vec![U::default(); len]);
        let written = highway(from, &mut want);
        let got = rust(
            a.copy_of(from, self.offset),
            b.uninit(len, self.offset).into(),
        );
        self.failures.unless(want[..written] == *got, name);
    }

    fn in_place(
        &mut self,
        name: &'static str,
        tolerance: u8,
        highway: &dyn Fn(&mut [[u8; 4]]),
        rust: &dyn Fn(&mut [[u8; 4]]),
    ) {
        let mut want = self.text.as_chunks().0.to_vec();
        let got = self.rooms[0].copy_of(&want, self.offset);
        highway(&mut want);
        rust(got);
        let mut pairs = want.as_flattened().iter().zip(got.as_flattened());
        self.failures
            .unless(pairs.all(|(a, b)| a.abs_diff(*b) <= tolerance), name);
    }

    fn conversions(&mut self) {
        let (text, len, mask) = (self.text, self.text.len(), [1, self.some_byte(), 3, 4]);
        let any: Vec<u16> = (0..len).map(|_| self.random.next() as u16).collect();
        let ascii = self.mostly_ascii();
        let shared = AtomicU8::from_mut_slice;
        self.from_to(
            "copy_u16_to_u8",
            (&any, len),
            all(highway::copy_u16_to_u8),
            |from, to| rust::copy_u16_to_u8(from, to),
        );
        self.from_to(
            "lower_ascii16",
            (&ascii, len),
            all(highway::lower_ascii16),
            |from, to| rust::lower_ascii16(from, to),
        );
        let hex = all(highway::encode_hex_lower);
        self.from_to("encode_hex_lower", (text, len), &hex, |from, to| {
            rust::encode_hex_lower(from, to)
        });
        self.from_to("encode_hex_lower_shared", (text, len), &hex, |from, to| {
            rust::encode_hex_lower_shared(shared(from), to)
        });
        let fill = all(|from, to| highway::fill_with_mask(mask, to, from));
        self.from_to("fill_with_mask", (text, len), fill, |from, to| {
            rust::fill_with_mask(mask, to, from)
        });
        let ([a, b, ..], mut want) = (&mut *self.rooms, vec![0; len]);
        let got = b.copy_of(&want, self.offset);
        highway::fill_with_mask(mask, &mut want, text);
        rust::fill_shared_with_mask(mask, shared(got), a.copy_of(text, self.offset));
        self.failures.unless(want == got, "fill_shared_with_mask");

        let mut digits = self.random.bytes(len, HEX);
        if len > 0 && self.random.below(2) == 0 {
            digits[self.random.below(len)] = self.random.next() as u8;
        }
        let decode = |from: &[_], to: &mut [_]| highway::decode_hex(from, to).len();
        self.from_to(
            "decode_hex",
            (digits.as_chunks().0, len / 2),
            decode,
            |from, to| rust::decode_hex(from, to),
        );

        self.in_place("bswap32", 0, &highway::bswap32, &rust::bswap32);
        self.in_place("bswap32_shared", 0, &highway::bswap32, &|words| {
            rust::bswap32_shared(shared(words.as_flattened_mut()))
        });
        self.in_place(
            "cmyk_to_rgba",
            0,
            &highway::cmyk_to_rgba,
            &rust::cmyk_to_rgba,
        );
        let [x, y] = [(); 2].map(|()| self.random.below(300) as f32 / 100.0);
        // One may fuse a multiplication and an addition that the other rounds separately.
        self.in_place(
            "modulate",
            1,
            &|pixels| highway::modulate(pixels, x, y),
            &|pixels| rust::modulate(pixels, x, y),
        );
    }

    fn words(&mut self) {
        let groups = self.text.len() / 4;
        let words = self.random.words_of_all_sizes(groups);
        let [a, b, c, ..] = &mut *self.rooms;
        let (mut controls, mut data) = (vec![0; groups], vec![0; 16 * groups]);
        let size = highway::pack_words(&words, &mut controls, &mut data);
        let (got_controls, got) = rust::pack_words(
            a.copy_of(&words, self.offset),
            b.uninit(groups, self.offset).into(),
            c.uninit(16 * groups, self.offset).into(),
        );
        let is_same = (&controls[..], &data[..size]) == (got_controls, got);
        self.failures.unless(is_same, "pack_words");

        let mut want = vec![[0; 4]; groups];
        let want = highway::unpack_words(&controls, &data[..size], &mut want);
        let data = c.copy_of(&data[..size], self.offset);
        let got = rust::unpack_words(got_controls, data, a.uninit(groups, self.offset).into());
        self.failures.unless(want == got, "unpack_words");
    }

    fn json(&mut self) {
        let len = self.text.len() & self.random.one_of(&[!0, !63]);
        let text = self.random.bytes(len, JSON);
        let [a, b, c, ..] = &mut *self.rooms;
        let [escaped, in_string, scalar] = [(); 3].map(|()| self.random.next() & 1);
        let mut state = [escaped, in_string.wrapping_neg(), scalar];
        let (mut index, mut dirty) = (Box::new_uninit_slice(len + 66), vec![0; len.div_ceil(4096)]);
        let (got, got_dirty) = (
            b.uninit(len + 66, self.offset),
            c.copy_of(&dirty, self.offset),
        );
        let (fenced, mut got_state) = (a.copy_of(&text, self.offset), state);
        let want =
            highway::json_structural_index_chunk(&text, 4096, &mut index, &mut dirty, &mut state);
        let got =
            rust::json_structural_index_chunk(fenced, 4096, got.into(), got_dirty, &mut got_state);
        // The last word depends on the padding, after which nothing follows.
        let words = if len.is_multiple_of(64) { 3 } else { 2 };
        let is_same = (want, &dirty[..], &state[..words]) == (got, got_dirty, &got_state[..words]);
        self.failures.unless(is_same, "json_structural_index_chunk");
    }

    fn png(&mut self) {
        let (row, len) = (self.text, self.text.len());
        let above = match self.random.below(2) {
            0 => self.random.bytes(len, b""),
            _ => (0..len).map(|i| (i / 128) as u8).collect(),
        };
        let [a, b, others @ ..] = &mut *self.rooms;
        for bytes_per_pixel in [1, 2, 4, 6, 8] {
            let len = len - len % bytes_per_pixel;
            let (row, above) = (&row[..len], &above[..len]);
            for filter_type in 1..=4 {
                let (mut want, got) = (row.to_vec(), a.copy_of(row, self.offset));
                highway::png_unfilter(filter_type, bytes_per_pixel, &mut want, above);
                let above = b.copy_of(above, self.offset);
                rust::png_unfilter(filter_type, bytes_per_pixel, got, above);
                self.failures.unless(want == got, "png_unfilter");
            }
        }

        let (row, above) = (row.as_chunks().0, above.as_chunks().0);
        let mut want = [(); 4].map(|()| vec![[0; 4]; row.len()]);
        let mut got = others
            .each_mut()
            .map(|room| room.copy_of(&want[0], self.offset));
        let sums = highway::png_filter_rgba(row, above, want.each_mut().map(|row| &mut row[..]));
        let got_sums = rust::png_filter_rgba(
            a.copy_of(row, self.offset),
            b.copy_of(above, self.offset),
            got.each_mut().map(|row| &mut row[..]),
        );
        self.failures
            .unless(sums == got_sums && want == got, "png_filter_rgba");
    }

    fn some_mappings(&mut self) -> Vec<u8> {
        let (random, mut text) = (&mut *self.random, Vec::new());
        let (is_plain, has_sources) = (random.below(3) == 0, random.below(4) == 0);
        let fields: &[_] = match random.below(8) {
            0 => &[1],
            _ => &[4, 4, 4, 4, 4, 4, 4, 4, 5, 1],
        };
        while text.len() < self.text.len() {
            let fields = if is_plain { 4 } else { random.one_of(fields) };
            for field in 0..fields {
                let bits = if is_plain {
                    3
                } else {
                    random.one_of(&[3, 3, 3, 8, 14])
                };
                let number = random.below(1 << bits) << 1 | usize::from(random.below(8) == 0);
                let source =
                    random.one_of(&[0, 2, 3]) * usize::from(has_sources && random.below(16) == 0);
                let mut rest = if field == 1 { source } else { number };
                while rest >= 32 {
                    text.push(BASE64[rest & 31 | 32]);
                    rest >>= 5;
                }
                text.push(BASE64[rest]);
            }
            text.push(if !is_plain && random.below(12) == 0 {
                b';'
            } else {
                b','
            });
        }
        if !text.is_empty() && random.below(4) == 0 {
            let at = random.below(text.len());
            text[at] = random.next() as u8;
        }
        text
    }

    fn mappings(&mut self) {
        let text = self.some_mappings();
        let cap = match self.random.below(4) {
            0 => 1 + self.random.below(60),
            _ => text.len() + 1,
        };
        let has_names = self.random.below(2) == 0;
        let sources = self.random.one_of(&[2, 2, 2, 2, 2, 2, 2, 0]);
        let rows = |columns: ColumnsFilled<'_>| -> Vec<_> {
            let name = |i: usize| columns.name_idx.as_ref().map(|names| names[i]);
            let row = |i| {
                (
                    columns.generated[i],
                    columns.original[i],
                    columns.src_idx[i],
                    name(i),
                )
            };
            (0..columns.src_idx.len()).map(row).collect()
        };
        let by_highway = |text: &[u8], mut state: MappingsState| {
            let mut pairs = [(); 2].map(|()| Box::new_uninit_slice(text.len() + 1));
            let mut indices = [(); 2].map(|()| Box::new_uninit_slice(text.len() + 1));
            let pairs = &mut pairs.each_mut().map(|column| &mut column[..]);
            let indices = &mut indices.each_mut().map(|column| &mut column[..]);
            let into = columns(pairs, indices, has_names);
            (
                rows(highway::parse_mappings(text, into, sources, &mut state)),
                state,
            )
        };
        let [a, b, c, d, e, _] = &mut *self.rooms;
        let pairs = &mut [b, c].map(|room| room.uninit(cap, self.offset));
        let indices = &mut [d, e].map(|room| room.uninit(cap, self.offset));
        let (fenced, mut state) = (a.copy_of(&text, self.offset), MappingsState::default());
        let into = columns(pairs, indices, has_names);
        let (got, resume_at) = rust::parse_mappings(fenced, into, sources, &mut state);
        let (got, (done, rest)) = (rows(got), text.split_at(resume_at));

        let (want, _) = by_highway(&text, MappingsState::default());
        let (more, _) = by_highway(rest, state);
        // Each leaves the rows that do not fill a vector to the scalar decoder.
        let is_complete =
            got.len() + 15 >= want.len().min(cap) && got.len() + more.len() + 13 >= want.len();
        let resumes = got.iter().chain(&more).zip(&want).all(|(a, b)| a == b);

        let (want, want_state) =
            by_highway(&[done, &[b';'; 64]].concat(), MappingsState::default());
        (state.gen_line, state.gen_col) = (want_state.gen_line, want_state.gen_col);
        let is_same = (got, state) == (want, want_state);
        self.failures
            .unless(is_complete && resumes && is_same, "parse_mappings");
    }

    fn resize(&mut self) {
        let [src_w, src_h, dst_w, dst_h] = [(); 4].map(|()| 1 + self.random.below(60));
        let src = self.random.bytes(4 * src_w * src_h, b"");
        let (src, mut want) = (src.as_chunks().0, vec![[0; 4]; dst_w * dst_h]);
        let [a, b, ..] = &mut *self.rooms;
        let into = b.uninit(want.len(), self.offset).into();
        highway::Resizer::default().lanczos3(src, src_w, &mut want, dst_w);
        let got =
            rust::Resizer::default().lanczos3(a.copy_of(src, self.offset), src_w, into, dst_w);
        self.failures.unless(want == got, "lanczos3");
    }
}

pub(crate) fn run(seed: u64, rounds: u64) -> bool {
    let random = &mut Random(0x9E37_79B9_7F4A_7C15u64.wrapping_mul(2 * seed + 1));
    let (rooms, mut failures) = (&mut [(); 6].map(|()| Room::new()), 0);
    for number in 0..rounds {
        let len = random.below(if number % 50 == 0 { 20_000 } else { 400 });
        let alphabet = random.one_of(&ALPHABETS);
        let text = &random.bytes(len, alphabet);
        let inside = random.below(8192);
        let offset = random.one_of(&[0, inside, usize::MAX, usize::MAX]);
        let mut round = Round {
            random,
            rooms,
            offset,
            text,
            failures: Failures::default(),
        };
        round.searches();
        round.memmem();
        round.scanner_run_stops();
        round.conversions();
        round.words();
        round.json();
        round.png();
        round.mappings();
        if number % 20 == 0 {
            round.resize();
        }
        for kernel in &round.failures.0 {
            write_line(format_args!("FAIL {kernel} in round {number}"));
        }
        failures += round.failures.0.len();
    }
    write_line(format_args!("rounds: {rounds}"));
    failures == 0
}
