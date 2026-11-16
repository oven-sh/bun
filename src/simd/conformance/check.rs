//! Gives both the same random input. The slices for Rust are next to inaccessible pages.
use crate::pairs::{self, Pairs};
use crate::room::Room;
use crate::{Random, columns, highway, shared, write_line};
use bun_simd::{Out, SharedOutU8};
use bun_simd_kernels::{self as rust, ColumnsFilled, Filter, MappingsState};
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
    #[optimize(size)]
    fn unless(&mut self, is_ok: bool, kernel: &'static str) {
        if !is_ok {
            self.0.push(kernel);
        }
    }
}

/// The text for Highway, and its copy for Rust.
struct Same<'a, T>(&'a [T], &'a [T], &'a mut Failures);

impl<T> Pairs<T> for Same<'_, T> {
    #[optimize(size)]
    fn pair<R: PartialEq>(&mut self, highway: impl Fn(&[T]) -> R, rust: impl Fn(&[T]) -> R) {
        let is_same = highway(self.0) == rust(self.1);
        self.2.unless(is_same, pairs::name_of(&rust));
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
const ALPHABETS: [&[u8]; 12] = [
    b"",
    b"ab",
    b"abcdefghijklmnop \"'\\\n",
    b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
    b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ@[`{0123456789 abcdefghijklm<>&'\"/",
    HEX,
    JSON,
    b"////....ab",
    b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa//.\xE9*#@$` ,;\r",
    b"\x1B\x1B\x1B[[]]\\0;m a\x07\x18\x1A\x9B\x9C\x9D\x90P_(\x7F\xAD",
    b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000000000000000000000000000;;\x1B\x1B[]\x07m\x12\x92",
    b"<<>>=\"'&ab \t\n\r\x01\xEF\xEF\xBF\xBF\xBE",
];
/// Where a class of characters starts or ends.
const EDGES: &[u16] = &[
    0x1B, 0x20, 0x7E, 0x90, 0x98, 0x9B, 0x9F, 0xA0, 0xA9, 0xAD, 0xAE, 0x2FF, 0x370, 0x482, 0x48A,
    0x52F, 0x3041, 0x3096, 0x309B, 0x30FF, 0x3400, 0x4DBF, 0x4E00, 0x9FFF, 0xAC00, 0xD7A3, 0xD800,
    0xDBFF, 0xDC00, 0xDFFF, 0xFF01, 0xFF60, 0xFFFE,
];

impl Round<'_> {
    #[optimize(size)]
    fn some_byte(&mut self) -> u8 {
        match self.text {
            [_, ..] if self.random.below(2) == 0 => self.random.one_of(self.text),
            _ => self.random.next() as u8,
        }
    }

    #[optimize(size)]
    fn mostly_ascii(&mut self) -> Vec<u16> {
        let one_in = self.random.one_of(&[3, 30, 300]);
        let unit = |&byte: &u8| match self.random.below(one_in) {
            0 => u16::from(byte) | 0x80 << self.random.below(9),
            1 => self.random.one_of(EDGES) - 1 + self.random.below(3) as u16,
            _ => u16::from(byte & 0x7F),
        };
        self.text.iter().map(unit).collect()
    }

    #[optimize(size)]
    fn searches(&mut self) {
        let (text, byte, wide) = (self.text, self.some_byte(), &self.mostly_ascii()[..]);
        let (len, count) = (self.random.below(text.len() + 1), 2 + self.random.below(15));
        let chars = &(0..count).map(|_| self.some_byte()).collect::<Vec<_>>()[..];
        let mut other = text[..len].to_vec();
        if let Some(byte) = other.get_mut(self.random.below(text.len())) {
            *byte ^= 1;
        }
        let printable: &Vec<_> = &text
            .iter()
            .map(|&byte| byte - u8::from(byte == 0x7F))
            .collect();
        let [a, b, c, d, e, f] = &mut *self.rooms;
        let (fenced, fenced_chars) = (a.copy_of(text, self.offset), b.copy_of(chars, self.offset));
        let (fenced_wide, fenced_other) =
            (c.copy_of(wide, self.offset), e.copy_of(&other, self.offset));
        let fenced_printable = f.copy_of(printable, self.offset);
        let shared = shared(d.copy_of(text, self.offset));

        let failures = &mut self.failures;
        pairs::of_units(&mut Same(wide, fenced_wide, failures));
        Same(printable, fenced_printable, failures).pair(
            highway::index_of_newline_or_non_ascii_or_hash_or_at,
            rust::index_of_newline_or_non_ascii_or_hash_or_at,
        );
        let mut same = Same(text, fenced, failures);
        pairs::of_bytes(&mut same);
        same.pair(highway::line_starts, rust::line_starts);
        if !text.is_empty() {
            same.pair(
                highway::index_of_newline_or_non_ascii,
                rust::index_of_newline_or_non_ascii,
            );
        }
        let first = highway::index_of_char(text, byte);
        let last = highway::last_index_of_char(text, byte);
        let needs_escape = |quote| {
            highway::index_of_needs_escape_for_javascript_string(text, quote)
                == rust::index_of_needs_escape_for_javascript_string(fenced, quote)
        };
        #[rustfmt::skip]
        let results = [
            ("index_of_char", first == rust::index_of_char(fenced, byte)),
            ("index_of_char_shared", first == rust::index_of_char_shared(shared, byte)),
            ("index_of_char16", highway::index_of_char16(wide, byte.into())
                == rust::index_of_char16(fenced_wide, byte.into())),
            ("last_index_of_char16", highway::last_index_of_char16(wide, byte.into())
                == rust::last_index_of_char16(fenced_wide, byte.into())),
            ("last_index_of_char", last == rust::last_index_of_char(fenced, byte)),
            ("last_index_of_char_shared", last == rust::last_index_of_char_shared(shared, byte)),
            ("count_char", highway::count_char(text, byte) == rust::count_char(fenced, byte)),
            ("index_of_not_char", highway::index_of_not_char(text, byte)
                == rust::index_of_not_char(fenced, byte)),
            ("index_of_any_char", highway::index_of_any_char(text, chars)
                == rust::index_of_any_char(fenced, fenced_chars)),
            ("last_index_of_any_char", highway::last_index_of_any_char(text, chars)
                == rust::last_index_of_any_char(fenced, fenced_chars)),
            ("string_literal", highway::index_of_interesting_character_in_string_literal(text, b'"')
                == rust::index_of_interesting_character_in_string_literal(fenced, b'"')),
            ("needs_escape", needs_escape(b'\'') && needs_escape(b'`')),
            ("common_prefix_length", highway::common_prefix_length(text, &other)
                == rust::common_prefix_length(fenced, fenced_other)),
        ];
        for (kernel, is_same) in results {
            self.failures.unless(is_same, kernel);
        }
    }

    #[optimize(size)]
    fn memmem(&mut self) {
        let len = self.random.below(40.min(self.text.len() + 1));
        let at = self.random.below(self.text.len() - len + 1);
        let mut needle = self.text[at..at + len].to_vec();
        if self.random.below(3) == 0 {
            needle.reverse();
        }
        let period = self.random.one_of::<&[u8]>(&[b"a", b"ab", b"aab"]);
        let mut uniform = period.repeat(3000 / period.len());
        let mut almost = uniform[..period.len() * (3 + self.random.below(5)) + 1].to_vec();
        let changed = 1 + self.random.below(almost.len() - 2);
        almost[changed] ^= 3;
        if self.random.below(2) == 0 {
            uniform[self.random.below(2900)..][..almost.len()].copy_from_slice(&almost);
        }
        let [a, b, ..] = &mut *self.rooms;
        for (text, needle) in [(self.text, &needle), (&uniform, &almost)] {
            let (x, y) = (a.copy_of(text, self.offset), b.copy_of(needle, self.offset));
            let (first, last) = (
                highway::memmem(text, needle),
                highway::memrmem(text, needle),
            );
            self.failures.unless(first == rust::memmem(x, y), "memmem");
            self.failures.unless(last == rust::memrmem(x, y), "memrmem");
            let (x, y) = (shared(x), shared(y));
            let got = (rust::memmem_shared(x, y), rust::memrmem_shared(x, y));
            self.failures.unless((first, last) == got, "memmem_shared");

            let wide = |byte: &u8| u16::from(byte >> 1) | u16::from(byte & 1) << 8;
            let [text, needle] = [text, needle].map(|it| it.iter().map(wide).collect::<Vec<_>>());
            let (first, last) = (
                highway::memmem16(&text, &needle),
                highway::memrmem16(&text, &needle),
            );
            let got = rust::memrmem16(
                a.copy_of(&text, self.offset),
                b.copy_of(&needle, self.offset),
            );
            self.failures.unless(last == got, "memrmem16");
            let [text, needle] = [text, needle].map(|it| {
                it.iter()
                    .flat_map(|it| it.to_le_bytes())
                    .collect::<Vec<_>>()
            });
            let (x, y) = (
                a.copy_of(&text, self.offset),
                b.copy_of(&needle, self.offset),
            );
            let (x, y) = (shared(x).as_chunks().0, shared(y).as_chunks().0);
            let got = (rust::memmem16_shared(x, y), rust::memrmem16_shared(x, y));
            self.failures
                .unless((first, last) == got, "memmem16_shared");
        }
    }

    #[optimize(size)]
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

    #[optimize(size)]
    fn hashes(&mut self) {
        let (text, any) = (self.text, self.random.next());
        let (seed, fenced) = (
            self.random.one_of(&[0, any]),
            self.rooms[0].copy_of(text, self.offset),
        );
        let is_same =
            highway::xxhash3_64(seed, text) == rust::xxhash3_64_shared(seed, shared(fenced));
        self.failures.unless(is_same, "xxhash3_64_shared");
        let got = [
            rust::xxhash32(seed as u32, fenced),
            rust::xxhash32_shared(seed as u32, shared(fenced)),
        ];
        self.failures
            .unless([highway::xxhash32(seed as u32, text); 2] == got, "xxhash32");
        let (want, mut in_parts) = (
            highway::xxhash64(seed, text),
            rust::XxHash64State::new(seed),
        );
        let got = [
            rust::xxhash64(seed, fenced),
            rust::xxhash64_shared(seed, shared(fenced)),
        ];
        self.failures.unless([want; 2] == got, "xxhash64");
        for part in fenced.chunks(1 + self.random.below(100)) {
            in_parts.update(part);
        }
        self.failures
            .unless(want == in_parts.digest(), "XxHash64State");
    }

    #[optimize(size)]
    fn odd_blocks(&mut self) {
        let mut text = vec![b' '; 20 * self.text.len()];
        for &byte in self.text.iter().take(20) {
            text[self.random.below(20 * self.text.len())] = byte;
        }
        text.truncate(1 << 17);
        let ([a, b, ..], mut want) = (&mut *self.rooms, vec![]);
        highway::odd_blocks(&text, &mut want);
        let into = b.uninit(want.len(), self.offset).into();
        let got = rust::odd_blocks(a.copy_of(&text, self.offset), into);
        self.failures.unless(want == got, "odd_blocks");
    }

    #[optimize(size)]
    fn byte_set(&mut self) {
        // Each byte that is left out takes up to one pattern, and the full rows take one.
        let mut left_out: Vec<_> = (0..self.random.below(8))
            .map(|_| self.some_byte())
            .collect();
        left_out.retain(|byte| !self.text[..self.text.len() / 2].contains(byte));
        let members = (0..=255).filter(|byte| !left_out.contains(byte));
        let ranges: Vec<_> = members.map(|byte| byte..=byte).collect();
        let (first, second) = (highway::ByteSet::new(&ranges), rust::ByteSet::new(&ranges));
        let (byte, fenced) = (
            self.some_byte(),
            self.rooms[0].copy_of(self.text, self.offset),
        );
        let want = (first.prefix_len(self.text), first.contains(byte));
        let got = (second.prefix_len(fenced), second.contains(byte));
        self.failures.unless(want == got, "ByteSet");
    }

    /// `highway` returns how much it has written.
    #[optimize(size)]
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

    /// The same for output of which the rest has to stay as it is.
    #[optimize(size)]
    fn prefix<T: Copy>(
        &mut self,
        name: &'static str,
        from: &[T],
        highway: impl Fn(&[T], &mut [u8]) -> usize,
        rust: Option<for<'a> fn(&[T], Out<'a, u8>) -> &'a mut [u8]>,
        to_shared: fn(&[T], &[SharedOutU8]) -> usize,
    ) {
        let ([a, b, ..], mut want) = (&mut *self.rooms, vec![0; from.len()]);
        let (len, ones) = (highway(from, &mut want), vec![0xFF; from.len()]);
        want[len..].fill(0xFF);
        let (from, got) = (a.copy_of(from, self.offset), b.copy_of(&ones, self.offset));
        let is_same = rust.is_none_or(|rust| len == rust(from, got.into()).len() && want == got);
        got.fill(0xFF);
        let got_len = to_shared(from, Out::from(&mut *got).into_shared());
        self.failures
            .unless(is_same && len == got_len && want == got, name);
    }

    #[optimize(size)]
    fn in_place<const N: usize>(
        &mut self,
        name: &'static str,
        tolerance: u8,
        highway: &dyn Fn(&mut [[u8; N]]),
        rust: &dyn Fn(&mut [[u8; N]]),
    ) {
        let mut want = self.text.as_chunks().0.to_vec();
        let got = self.rooms[0].copy_of(&want, self.offset);
        highway(&mut want);
        rust(got);
        let mut pairs = want.as_flattened().iter().zip(got.as_flattened());
        self.failures
            .unless(pairs.all(|(a, b)| a.abs_diff(*b) <= tolerance), name);
    }

    #[optimize(size)]
    fn conversions(&mut self) {
        let (text, len, mask) = (self.text, self.text.len(), [1, self.some_byte(), 3, 4]);
        let any: Vec<u16> = (0..len).map(|_| self.random.next() as u16).collect();
        let ascii = self.mostly_ascii();
        self.prefix(
            "copy_u16_to_u8",
            &any,
            all(highway::copy_u16_to_u8),
            Some(rust::copy_u16_to_u8),
            rust::copy_u16_to_shared,
        );
        self.from_to(
            "lower_ascii16",
            (&ascii, len),
            all(highway::lower_ascii16),
            |from, to| rust::lower_ascii16(from, to),
        );
        self.from_to(
            "lower_ascii",
            (text, len),
            all(highway::lower_ascii),
            |from, to| rust::lower_ascii(from, to),
        );
        let copy = |from: &[_], to: &mut [_]| highway::copy_ascii_prefix(from, to).len();
        self.prefix(
            "copy_ascii_prefix",
            text,
            copy,
            None,
            rust::copy_ascii_prefix_to_shared,
        );
        self.prefix(
            "copy_short_ascii_prefix",
            text,
            copy,
            None,
            rust::copy_short_ascii_prefix_to_shared,
        );
        self.prefix(
            "copy_few_ascii",
            &text[..len % 17],
            |from, to| if from.is_ascii() { copy(from, to) } else { 0 },
            None,
            |from, to| from.len() * usize::from(rust::copy_few_ascii_to_shared(from, to)),
        );

        let hex = all(highway::encode_hex_lower);
        self.from_to("encode_hex_lower", (text, 2 * len), &hex, |from, to| {
            rust::encode_hex_lower(from, to)
        });
        self.from_to(
            "encode_hex_lower_shared",
            (text, 2 * len),
            &hex,
            |from, to| rust::encode_hex_lower_shared(shared(from), to),
        );
        let fill = all(|from, to| highway::fill_with_mask(mask, to, from));
        self.from_to("fill_with_mask", (text, len), &fill, |from, to| {
            rust::fill_with_mask(mask, to, from)
        });
        self.from_to(
            "fill_with_mask_from_shared",
            (text, len),
            &fill,
            |from, to| rust::fill_with_mask_from_shared(mask, to, shared(from)),
        );
        self.in_place::<1>(
            "mask_in_place",
            0,
            &|bytes| highway::mask_in_place(mask, bytes.as_flattened_mut()),
            &|bytes| rust::mask_in_place(mask, bytes.as_flattened_mut()),
        );

        let mut digits = self.random.bytes(len, HEX);
        if len > 0 && self.random.below(2) == 0 {
            digits[self.random.below(len)] = self.random.next() as u8;
        }
        let decode = |from: &[_], to: &mut [_]| highway::decode_hex(from, to).len();
        self.prefix(
            "decode_hex",
            digits.as_chunks().0,
            decode,
            Some(rust::decode_hex),
            rust::decode_hex_to_shared,
        );

        let digits: Vec<_> = digits
            .iter()
            .zip(&any)
            .map(|(&low, unit)| unit << 8 | u16::from(low))
            .collect();
        let decode = |from: &[_], to: &mut [_]| highway::decode_hex16(from, to).len();
        self.prefix(
            "decode_hex16",
            digits.as_chunks().0,
            decode,
            Some(rust::decode_hex16),
            rust::decode_hex16_to_shared,
        );

        for (name, highway, rust) in pairs::SWAPS {
            self.in_place::<1>(
                name,
                0,
                &|bytes| highway(bytes.as_flattened_mut()),
                &|bytes| rust(AtomicU8::from_mut_slice(bytes.as_flattened_mut())),
            );
        }
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

    #[optimize(size)]
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

    #[optimize(size)]
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

    #[optimize(size)]
    fn xml(&mut self) {
        let (text, wide) = (self.text, &self.mostly_ascii()[..]);
        let (room, is_open) = (text.len() + 64, self.random.next() & 1);
        let (mut index, [ef, bf]) = (
            Box::new_uninit_slice(room),
            [(); 2].map(|()| self.random.next()),
        );
        let [a, b, ..] = &mut *self.rooms;

        let [mut state, mut got_state] = [[is_open, ef, bf]; 2];
        let want = highway::xml_structural_index_chunk(text, 64, &mut index, &mut state);
        let (fenced, into) = (
            a.copy_of(text, self.offset),
            b.uninit(room, self.offset).into(),
        );
        let got = rust::xml_structural_index_chunk(fenced, 64, into, &mut got_state);
        let is_same = (want, state) == (got, got_state);
        self.failures.unless(is_same, "xml_structural_index_chunk");

        // A lead surrogate that the chunk before left open takes the place of one in this chunk.
        let [mut state, mut got_state] = [[is_open, ef & 1, 0]; 2];
        let wide = wide.get(1..).unwrap_or_default();
        let want = highway::xml_structural_index16_chunk(wide, 64, &mut index, &mut state);
        let (fenced, into) = (
            a.copy_of(wide, self.offset),
            b.uninit(room, self.offset).into(),
        );
        let got = rust::xml_structural_index16_chunk(fenced, 64, into, &mut got_state);
        let is_same = (want, state) == (got, got_state);
        self.failures
            .unless(is_same, "xml_structural_index16_chunk");
    }

    #[optimize(size)]
    fn moves(&mut self) {
        let (pixels, width) = (self.text.as_chunks().0, 1 + self.random.below(40));
        let color = [(); 4].map(|()| self.some_byte());
        let palette = &pixels[..pixels.len().min(256)];
        let got = rust::nearest_in_palette(self.rooms[0].copy_of(palette, self.offset), color);
        let is_same = highway::nearest_in_palette(palette, color) == got;
        self.failures.unless(is_same, "nearest_in_palette");

        let image = (
            &pixels[..pixels.len() / width * width],
            pixels.len() / width * width,
        );
        if image.1 == 0 {
            return;
        }
        for (name, highway, rust) in pairs::MOVES {
            let want = all(|from, to| highway(from, width, to));
            self.from_to(name, image, want, |from, to| rust(from, width, to));
        }
    }

    #[optimize(size)]
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

    #[optimize(size)]
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

    #[optimize(size)]
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

    #[optimize(size)]
    fn resize(&mut self) {
        let [src_w, src_h, dst_w, dst_h] = [(); 4].map(|()| 1 + self.random.below(60));
        let src = self.random.bytes(4 * src_w * src_h, b"");
        let (src, mut want) = (src.as_chunks().0, vec![[0; 4]; dst_w * dst_h]);
        let [a, b, ..] = &mut *self.rooms;
        let fenced = a.copy_of(src, self.offset);
        for filter in Filter::ALL {
            let into = b.uninit(want.len(), self.offset).into();
            highway::Resizer::default().resize(filter, src, src_w, &mut want, dst_w);
            let got = rust::Resizer::default().resize(filter, fenced, src_w, into, dst_w);
            // As in `modulate`, a weight may be rounded the other way.
            let tolerance = match filter {
                _ if cfg!(target_arch = "x86_64") => 0,
                Filter::Mitchell | Filter::CatmullRom | Filter::Mks2013 | Filter::Mks2021 => 2,
                _ => 0,
            };
            let mut pairs = want.as_flattened().iter().zip(got.as_flattened());
            let is_same = pairs.all(|(a, b)| a.abs_diff(*b) <= tolerance);
            self.failures
                .unless(is_same && want.len() == got.len(), "resize");
        }
    }
}

#[optimize(size)]
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
        round.odd_blocks();
        round.byte_set();
        round.hashes();
        round.conversions();
        round.words();
        round.json();
        round.xml();
        round.moves();
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
