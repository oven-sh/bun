//! The same random input for both. What Rust gets is next to pages that cannot be touched.
use crate::room::Room;
use crate::{Random, highway};
use bun_simd_kernels::{self as rust, Columns, MappingsState};
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;

struct Round<'a> {
    random: &'a mut Random,
    rooms: &'a mut [Room; 6],
    /// Of everything in its room.
    offset: usize,
    text: &'a [u8],
    differing: Vec<&'static str>,
}

macro_rules! same {
    ($round:ident, $name:expr, $highway:expr, $rust:expr) => {
        if $highway != $rust {
            $round.differing.push($name);
        }
    };
}

fn written<T>(out: &[MaybeUninit<T>], len: usize) -> &[T] {
    // SAFETY: the kernel says so. All memory in here has been written to before, in any case.
    unsafe { out[..len].assume_init_ref() }
}

fn zeroed<T: Copy + Default>(len: usize) -> Vec<MaybeUninit<T>> {
    vec![MaybeUninit::new(T::default()); len]
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
            0 => u16::from(byte) | self.random.next() as u16 & 0xFF80,
            _ => u16::from(byte & 0x7F),
        };
        self.text.iter().map(unit).collect()
    }

    fn searches(&mut self) {
        let (text, byte, wide) = (self.text, self.some_byte(), self.mostly_ascii());
        let (len, count) = (self.random.below(text.len() + 1), 2 + self.random.below(15));
        let chars = self.random.bytes(count, b"");
        let [a, b, c, ..] = &mut *self.rooms;
        let (fenced, fenced_chars) = (a.copy_of(text, self.offset), b.copy_of(&chars, self.offset));
        macro_rules! searches {
            ($($kernel:ident($($highway:expr, $rust:expr)?);)*) => {$(
                let highway = highway::$kernel(text $(, $highway)?);
                same!(self, stringify!($kernel), highway, rust::$kernel(fenced $(, $rust)?));
            )*};
        }
        searches! {
            index_of_char(byte, byte);
            last_index_of_char(byte, byte);
            count_char(byte, byte);
            index_of_either([byte, b'b'], [byte, b'b']);
            index_of_any_char(&chars, fenced_chars);
            index_of_interesting_character_in_string_literal(b'"', b'"');
            index_of_html_escape_char8();
            last_index_of_slash();
            line_starts();
        }
        if !text.is_empty() {
            searches! { index_of_newline_or_non_ascii(); }
        }
        if text.len() > 240 {
            searches! { xxhash3_64_long(); }
        }
        let within = highway::index_of_char(&text[..len], byte).unwrap_or(len);
        same!(
            self,
            "index_of_char_within",
            within,
            rust::index_of_char_within(fenced, len, byte)
        );

        let shared = &*AtomicU8::from_mut_slice(fenced);
        let first = highway::index_of_char(text, byte);
        same!(
            self,
            "index_of_char_shared",
            first,
            rust::index_of_char_shared(shared, byte)
        );
        let last = highway::last_index_of_char(text, byte);
        same!(
            self,
            "last_index_of_char_shared",
            last,
            rust::last_index_of_char_shared(shared, byte)
        );
        let count = highway::count_char(text, byte);
        same!(
            self,
            "count_char_shared",
            count,
            rust::count_char_shared(shared, byte)
        );

        let (text, fenced) = (&wide[..], c.copy_of(&wide, self.offset));
        let html = highway::index_of_html_escape_char16(text);
        same!(
            self,
            "index_of_html_escape_char16",
            html,
            rust::index_of_html_escape_char16(fenced)
        );
        let first = highway::first_non_ascii16(text);
        same!(
            self,
            "first_non_ascii16",
            first,
            rust::first_non_ascii16(fenced)
        );
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
            same!(self, "memmem", highway::memmem(text, needle), got);
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
            same!(self, "scanner_run_stops", true, agree);
        }
    }

    fn from_to<T: Copy, U: Copy + Default + PartialEq>(
        &mut self,
        name: &'static str,
        (from, len): (&[T], usize),
        highway: &dyn Fn(&[T], &mut [U]),
        rust: &dyn Fn(&mut [T], &mut [U]),
    ) {
        let ([a, b, ..], mut want) = (&mut *self.rooms, vec![U::default(); len]);
        let got = b.copy_of(&want, self.offset);
        highway(from, &mut want);
        rust(a.copy_of(from, self.offset), got);
        same!(self, name, want, got);
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
        same!(
            self,
            name,
            true,
            pairs.all(|(a, b)| a.abs_diff(*b) <= tolerance)
        );
    }

    fn conversions(&mut self) {
        let (text, len, mask) = (self.text, self.text.len(), [1, self.some_byte(), 3, 4]);
        let any: Vec<u16> = (0..len).map(|_| self.random.next() as u16).collect();
        let ascii = self.mostly_ascii();
        let shared = AtomicU8::from_mut_slice;
        self.from_to(
            "copy_u16_to_u8",
            (&any, len),
            &highway::copy_u16_to_u8,
            &|from, to| rust::copy_u16_to_u8(from, to),
        );
        self.from_to(
            "lower_ascii16",
            (&ascii, len),
            &highway::lower_ascii16,
            &|from, to| rust::lower_ascii16(from, to),
        );
        let hex = &highway::encode_hex_lower;
        self.from_to("encode_hex_lower", (text, 2 * len), hex, &|from, to| {
            rust::encode_hex_lower(from, to)
        });
        self.from_to(
            "encode_hex_lower_shared",
            (text, 2 * len),
            hex,
            &|from, to| rust::encode_hex_lower_shared(shared(from), to),
        );
        let fill = &|from: &[u8], to: &mut [u8]| highway::fill_with_mask(mask, to, from);
        self.from_to("fill_with_mask", (text, len), fill, &|from, to| {
            rust::fill_with_mask(mask, to, from)
        });
        self.from_to("fill_shared_with_mask", (text, len), fill, &|from, to| {
            rust::fill_shared_with_mask(mask, shared(to), from)
        });

        let mut digits = self.random.bytes(len, HEX);
        if len > 0 && self.random.below(2) == 0 {
            digits[self.random.below(len)] = self.random.next() as u8;
        }
        let up_to_error = |decode: fn(&[u8], &mut [u8]) -> usize| {
            move |from: &[u8], to: &mut [u8]| {
                let valid = decode(from, to);
                to[valid..].fill(0xA5);
            }
        };
        let (highway, rust) = (
            up_to_error(highway::decode_hex),
            up_to_error(rust::decode_hex),
        );
        self.from_to("decode_hex", (&digits, len / 2), &highway, &|from, to| {
            rust(from, to)
        });

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
        // One of them may round once where the other rounds twice.
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
        let (got_controls, got) = (
            b.copy_of(&controls, self.offset),
            c.copy_of(&data, self.offset),
        );
        let size = highway::pack_words(&words, &mut controls, &mut data);
        let got_size = rust::pack_words(a.copy_of(&words, self.offset), got_controls, got);
        same!(
            self,
            "pack_words",
            (&controls[..], &data[..size]),
            (got_controls, &got[..got_size])
        );

        let (mut want, got) = (zeroed(4 * groups), a.uninit(4 * groups, self.offset));
        let done = highway::unpack_words(&controls, &data[..size], want.as_chunks_mut().0);
        let data = c.copy_of(&data[..size], self.offset);
        let got_done = rust::unpack_words(got_controls, data, got.as_chunks_mut().0);
        let (want, got) = (written(&want, 4 * done.0), written(got, 4 * got_done.0));
        same!(self, "unpack_words", (done, want), (got_done, got));
    }

    fn json(&mut self) {
        let len = self.text.len();
        let text = self.random.bytes(len, JSON);
        let [a, b, c, ..] = &mut *self.rooms;
        let [escaped, in_string, scalar] = [(); 3].map(|()| self.random.next() & 1);
        let mut state = [escaped, in_string.wrapping_neg(), scalar];
        let (mut index, mut dirty) = (zeroed(len + 66), vec![0; len.div_ceil(4096)]);
        let (got, got_dirty) = (
            b.uninit(len + 66, self.offset),
            c.copy_of(&dirty, self.offset),
        );
        let (fenced, mut got_state) = (a.copy_of(&text, self.offset), state);
        let result =
            highway::json_structural_index_chunk(&text, 4096, &mut index, &mut dirty, &mut state);
        let got_result =
            rust::json_structural_index_chunk(fenced, 4096, got, got_dirty, &mut got_state);
        same!(
            self,
            "json_structural_index_chunk",
            (result, written(&index, result.0), &dirty[..], state),
            (
                got_result,
                written(got, got_result.0),
                &*got_dirty,
                got_state
            )
        );
    }

    fn png(&mut self) {
        let (row, len) = (self.text, self.text.len());
        let above = match self.random.below(2) {
            0 => self.random.bytes(len, b""),
            _ => (0..len).map(|i| (i / 128) as u8).collect(),
        };
        let [a, b, others @ ..] = &mut *self.rooms;
        let mut want = [(); 4].map(|()| vec![0; len]);
        let mut got = others
            .each_mut()
            .map(|room| room.copy_of(&want[0], self.offset));
        let sums = highway::png_filter_rgba(row, &above, want.each_mut().map(|row| &mut row[..]));
        let got_sums = rust::png_filter_rgba(
            a.copy_of(row, self.offset),
            b.copy_of(&above, self.offset),
            got.each_mut().map(|row| &mut row[..]),
        );
        same!(self, "png_filter_rgba", sums, got_sums);
        same!(self, "png_filter_rgba", want, got);

        let (row, above) = (&row[..len & !3], &above[..len & !3]);
        for filter_type in 1..=4 {
            let (mut want, got) = (row.to_vec(), a.copy_of(row, self.offset));
            highway::png_unfilter4(filter_type, &mut want, above);
            rust::png_unfilter4(filter_type, got, b.copy_of(above, self.offset));
            same!(self, "png_unfilter4", want, got);
        }
    }

    fn some_mappings(&mut self) -> Vec<u8> {
        let (random, mut text) = (&mut *self.random, Vec::new());
        let is_plain = random.below(3) == 0;
        while text.len() < self.text.len() {
            let fields = if is_plain {
                4
            } else {
                random.one_of(&[4, 4, 4, 4, 4, 4, 4, 4, 5, 1])
            };
            for field in 0..fields {
                let bits = if is_plain {
                    3
                } else {
                    random.one_of(&[3, 3, 3, 8, 14])
                };
                let number = random.below(1 << bits) << 1 | usize::from(random.below(8) == 0);
                let mut rest = if field == 1 { 0 } else { number };
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
            0 => 1 + self.random.below(20),
            _ => text.len() + 1,
        };
        let has_names = self.random.below(2) == 0;
        fn columns<'a>(of: &'a mut [&mut [MaybeUninit<i32>]; 4], has_names: bool) -> Columns<'a> {
            let [generated, original, src_idx, name_idx] = of;
            Columns {
                generated: generated.as_chunks_mut().0,
                original: original.as_chunks_mut().0,
                src_idx,
                name_idx: has_names.then_some(name_idx),
            }
        }
        let [a, b, c, d, e, _] = &mut *self.rooms;
        let by_highway = |text: &[u8], state: &MappingsState| {
            let mut out = [2, 2, 1, 1].map(|per_row| zeroed(per_row * (text.len() + 1)));
            let mut into = out.each_mut().map(|column| &mut column[..]);
            let rows = highway::parse_mappings(text, columns(&mut into, has_names), 3, state);
            (rows, out)
        };
        let mut got = [(b, 2), (c, 2), (d, 1), (e, 1)]
            .map(|(room, per_row)| room.uninit(per_row * cap, self.offset));
        let (fenced, mut state) = (a.copy_of(&text, self.offset), MappingsState::default());
        let (rows, want) = by_highway(&text, &state);
        let into = columns(&mut got, has_names);
        let (got_rows, resume_at) = rust::parse_mappings(fenced, into, 3, &mut state);
        // Each leaves what is too short for its vectors: up to 13 rows.
        same!(self, "parse_mappings", true, got_rows + 13 >= rows.min(cap));
        let (more_rows, more) = by_highway(&text[resume_at..], &state);
        for (i, per_row) in [2, 2, 1, usize::from(has_names)].into_iter().enumerate() {
            let got = written(got[i], per_row * got_rows).iter();
            let got = got.chain(written(&more[i], per_row * more_rows));
            let mut pairs = got.zip(written(&want[i], per_row * rows));
            same!(self, "parse_mappings", true, pairs.all(|(a, b)| a == b));
        }
    }

    fn resize(&mut self) {
        let [src_w, src_h, dst_w, dst_h] = [(); 4].map(|()| 1 + self.random.below(60));
        let src = self.random.bytes(4 * src_w * src_h, b"");
        self.from_to(
            "lanczos3",
            (src.as_chunks().0, dst_w * dst_h),
            &|src, dst| highway::Resizer::default().lanczos3(src, src_w, dst, dst_w),
            &|src, dst| rust::Resizer::default().lanczos3(src, src_w, dst, dst_w),
        );
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
            differing: Vec::new(),
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
        for kernel in &round.differing {
            output_line!("FAIL {kernel} in round {number}");
        }
        failures += round.differing.len();
    }
    output_line!("rounds: {rounds}");
    failures == 0
}
