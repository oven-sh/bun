//! Hashes what each kernel makes of random input next to missing pages. See `digests.txt`.
use crate::lists::{self, Each, Number};
use crate::room::Room;
use crate::webp_encoder::Case;
use crate::{Random, columns, shared, shared_out, write_line};
use bun_core::{NoUninit, strings};
use bun_simd::{Appender, Out};
use bun_simd_kernels::*;
use core::array::from_fn;
use core::cell::Cell;
use core::iter::repeat_n;
use core::sync::atomic::AtomicU8;
use std::collections::BTreeMap;

#[inline(never)]
fn hash_bytes(bytes: &[u8]) -> u64 {
    const ODD: u64 = 0x9E37_79B9_7F4A_7C15;
    let (words, rest) = bytes.as_chunks();
    let words = words.iter().map(|&word| u64::from_le_bytes(word));
    let all = words.chain(rest.iter().map(|&byte| byte.into()));
    all.fold(ODD ^ bytes.len() as u64, |hash, word| {
        let product = u128::from(hash ^ word) * u128::from(ODD);
        (product >> 64) as u64 ^ product as u64
    })
}

fn hash<T: NoUninit>(items: &[T]) -> u64 {
    hash_bytes(bun_core::slice_as_bytes(items))
}

#[derive(Default)]
struct Digests {
    /// By part and kernel.
    all: BTreeMap<[&'static str; 2], u64>,
    last: (&'static str, u64),
    round: u64,
    part: &'static str,
    failed: Vec<&'static str>,
    /// Prints each result of this kernel.
    traced: Vec<u8>,
    has_traced: bool,
}

impl Digests {
    #[inline(never)]
    fn add(&mut self, kernel: &'static str, result: u64) {
        let digest = self.all.entry([self.part, kernel]).or_default();
        (*digest, self.last) = (hash(&[*digest, result]), (kernel, result));
        self.trace(kernel, result);
    }

    /// For a kernel that has to return what was added last.
    fn same(&mut self, kernel: &'static str, result: u64) {
        self.trace(kernel, result);
        for either in [self.last.0, kernel] {
            self.fails_unless(result == self.last.1, either);
        }
    }

    #[inline(never)]
    fn trace(&mut self, kernel: &'static str, result: u64) {
        if self.traced == kernel.as_bytes() {
            self.has_traced = true;
            let Self { round, part, .. } = self;
            write_line(format_args!("round {round}, {part}: {result:x}"));
        }
    }

    #[inline(never)]
    fn fails_unless(&mut self, is_ok: bool, kernel: &'static str) {
        if !is_ok && !self.failed.contains(&kernel) {
            let Self { round, part, .. } = self;
            write_line(format_args!(
                "FAIL {kernel}, first in round {round}, {part}"
            ));
            self.failed.push(kernel);
        }
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn of_one_unit(&mut self, text: &mut [u8], wide: &[u16], byte: u8, unit: u16) {
        self.add("count_char", count_char(text, byte).number());
        self.add("index_of_char", index_of_char(text, byte).number());
        self.same("index_of_char_shared", index_of_char_shared(shared(text), byte).number());
        self.add("last_index_of_char", last_index_of_char(text, byte).number());
        self.same("last_index_of_char_shared", last_index_of_char_shared(shared(text), byte).number());
        self.add("index_of_char16", index_of_char16(wide, unit).number());
        self.add("last_index_of_char16", last_index_of_char16(wide, unit).number());
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn of_bytes(&mut self, text: &[u8]) {
        lists::of_bytes(&mut (text, &mut *self));
        for quote in *b"\"'`" {
            self.add("index_of_interesting_character_in_string_literal", index_of_interesting_character_in_string_literal(text, quote).number());
            self.add("index_of_needs_escape_for_javascript_string", index_of_needs_escape_for_javascript_string(text, quote).number());
        }
    }
}

impl<T> Each<T> for (&[T], &mut Digests) {
    #[optimize(size)]
    fn kernel<R: Number>(&mut self, name: &'static str, kernel: impl Fn(&[T]) -> R) {
        self.1.add(name, kernel(self.0).number());
    }
}

struct Round<'a> {
    random: Random,
    rooms: &'a mut [Room; 6],
    /// Of each slice in its room.
    offset: usize,
    text: &'a [u8],
    digests: &'a mut Digests,
    /// As the last round left it.
    scratch: &'a mut webp::Scratch,
}

/// Each one below it has a round at either end of the rooms. Then they repeat.
const SHORT_LENGTHS: u64 = 400;
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
/// What puts a terminal in each of its states.
const STATES: [&[u8]; 9] = [
    b"\x18", b"\x1B", b"\x1B[", b"\x1B]", b"\x1BP", b"\x1B(", b"\x9B", b"\x9D", b"\x90",
];
/// Where a class of characters starts or ends.
const EDGES: &[u16] = &[
    0x1B, 0x20, 0x7E, 0x80, 0x90, 0x98, 0x9B, 0x9F, 0xA0, 0xA9, 0xAD, 0xAE, 0x2FF, 0x370, 0x482,
    0x48A, 0x52F, 0x3041, 0x3096, 0x309B, 0x30FF, 0x3400, 0x4DBF, 0x4E00, 0x9FFF, 0xAC00, 0xD7A3,
    0xD800, 0xDBFF, 0xDC00, 0xDFFF, 0xFF01, 0xFF60, 0xFFFE,
];

/// To add to a length: 0 or `count`, and always 0 for a slice that ends with its room.
#[optimize(size)]
fn surplus(random: &mut Random, offset: usize, count: usize) -> usize {
    match offset {
        usize::MAX => 0,
        _ => random.one_of(&[0, count]),
    }
}

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
        let one_in = self.random.one_of(&[3, 30, 300, 3000]);
        let unit = |&byte: &u8| match self.random.below(one_in) {
            0 => u16::from(byte) | 0x80 << self.random.below(9),
            1 => self.random.one_of(EDGES) - 1 + self.random.below(3) as u16,
            _ => u16::from(byte & 0x7F),
        };
        self.text.iter().map(unit).collect()
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn searches(&mut self) {
        let (text, byte, wide) = (self.text, self.some_byte(), self.mostly_ascii());
        let (len, count) = (self.random.below(text.len() + 1), 4 + self.random.below(13));
        let unit = wide.get(self.random.below(2 * wide.len())).map_or_else(|| byte.into(), |&unit| unit);
        let bits = self.random.one_of(&[0x7F, 0xFF]);
        let chars: Vec<_> = (0..count).map(|_| self.some_byte() & bits).collect();
        let rare: Vec<_> = (0x8E..).map(|byte| byte & bits).take(count - 1).chain([0]).collect();
        let mut other = text[..len].to_vec();
        self.random.scatter(&mut other, &[0, 1, 1, 3]);
        let ([a, b, c, d, ..], at, digests) = (&mut *self.rooms, self.offset, &mut *self.digests);
        let (text, wide, other) = (a.copy_of(text, at), c.copy_of(&wide, at), d.copy_of(&other, at));

        lists::of_units(&mut (&*wide, &mut *digests));
        lists::of_units(&mut (&wide[wide.len().saturating_sub(count - 3)..], &mut *digests));
        digests.of_bytes(text);
        digests.add("line_starts", hash(&line_starts(text)));
        digests.add("index_of_not_char", index_of_not_char(text, byte).number());
        digests.add("common_prefix_len", common_prefix_len(text, other).number());
        digests.same("common_prefix_len", common_prefix_len(other, text).number());
        digests.add("common_prefix_len", common_prefix_len(text, text).number());
        // A short load is padded with 0.
        for (byte, unit, chars) in [(byte, unit, chars), (0, 0, rare)] {
            let chars = b.copy_of(&chars, at);
            digests.of_one_unit(text, wide, byte, unit);
            for chars in [chars, &chars[count - 3..], &chars[count - 2..]] {
                digests.add("index_of_any_char", index_of_any_char(text, chars).number());
                digests.add("last_index_of_any_char", last_index_of_any_char(text, chars).number());
            }
        }
    }

    /// Sums that do not fit in a byte, and blocks in which everything matches.
    #[optimize(size)]
    fn uniform(&mut self) {
        let Ok(byte) = self.digests.round.try_into() else {
            return;
        };
        let mut round = Round {
            text: &vec![byte; 16_500 + self.random.below(500)],
            random: Random(self.random.next()),
            rooms: self.rooms,
            digests: self.digests,
            scratch: self.scratch,
            ..*self
        };
        round.searches();
        round.xml();
    }

    /// The seams between the loops of a search.
    #[optimize(size)]
    #[rustfmt::skip]
    fn lone_match(&mut self) {
        if self.digests.round >= 3 * SHORT_LENGTHS {
            return;
        }
        let ([a, b, ..], len) = (&mut *self.rooms, self.text.len().min(1000));
        let text = a.copy_of(&vec![0; len], self.offset);
        let wide = b.copy_of(&vec![0; len], self.offset);
        for at in 0..len {
            (text[at], wide[at]) = (1, 1);
            for (name, found) in [
                ("index_of_char", index_of_char(text, 1)),
                ("index_of_char_shared", index_of_char_shared(shared(text), 1)),
                ("index_of_char16", index_of_char16(wide, 1)),
                ("index_of_not_char", index_of_not_char(text, 0)),
                ("last_index_of_char", last_index_of_char(text, 1)),
                ("last_index_of_char_shared", last_index_of_char_shared(shared(text), 1)),
                ("last_index_of_char16", last_index_of_char16(wide, 1)),
            ] {
                self.digests.fails_unless(found == Some(at), name);
            }
            (text[at], wide[at]) = (0, 0);
        }
    }

    /// The same for more kernels, at the ends and around multiples of 16.
    #[optimize(size)]
    #[rustfmt::skip]
    fn lone_stop(&mut self) {
        let (len, round) = (self.text.len().min(600), self.digests.round);
        let longer = (SHORT_LENGTHS + round / 3 % SHORT_LENGTHS) as usize;
        let alone = self.rooms[0].copy_of(&[round as u8], self.offset);
        self.digests.of_bytes(alone);
        let alone = self.rooms[0].copy_of(&[round as u16 % 256], self.offset);
        lists::of_units(&mut (&*alone, &mut *self.digests));
        let set = ByteSet::new(&[b'0'..=b'9', b'a'..=b'z']);
        for len in repeat_n(len, len.min(8)).chain([longer; 2]) {
            let stop = self.random.one_of(b"\x80\x1B\r\n \"#&'*,.///;<>@A\\");
            let next = self.random.one_of(&[&b""[..], b"", b"/", b".", b"./", b"..", b"../"]);
            let seam = (self.random.below(len) | 15) + self.random.below(4);
            let last = len.saturating_sub(next.len());
            let at = self.random.one_of(&[1, last, seam, seam]).clamp(1, len) - 1;
            let mut text = [&vec![b'a'; at][..], &[stop], next].concat();
            text.resize(len, b'a');
            self.ascii_prefix(&text);
            let (before, after) = (self.random.below(20).min(at), self.random.below(20).min(len - at));
            let ([a, b, c, ..], offset, digests) = (&mut *self.rooms, self.offset, &mut *self.digests);
            let wide = b.copy_of(&Vec::from_iter(text.iter().map(|&byte| byte.into())), offset);
            let (needle, text) = (c.copy_of(&text[at - before..at + after], offset), a.copy_of(&text, offset));
            lists::of_units(&mut (&*wide, &mut *digests));
            digests.of_bytes(text);
            digests.of_one_unit(text, wide, stop, stop.into());
            digests.add("index_of_not_char", index_of_not_char(text, b'a').number());
            digests.add("ByteSet", set.prefix_len(text).number());
            digests.add("memmem", memmem(text, needle).number());
            digests.add("memrmem", memrmem(text, needle).number());
        }
    }

    /// Copies of a needle, and the needle. It has a wrong byte, or each of them has.
    #[optimize(size)]
    fn near_misses(&mut self) -> [Vec<u8>; 2] {
        let random = &mut self.random;
        let (longest, any) = (
            random.one_of(&[12, 40, 200, 1000]),
            random.one_of(&ALPHABETS),
        );
        let alphabet = random.one_of(&[b"ab", any]);
        let len = 2 + random.below(longest);
        let period = random.one_of(&[1, 2, 3, 7, len]);
        let period = random.bytes(period, alphabet);
        let mut needle: Vec<_> = period.into_iter().cycle().take(len).collect();
        let room = random.one_of(&[3000, 3000, 4 * self.text.len()]);
        let mut copies = needle.repeat(room / len);
        let (first, spread) = (random.below(len), random.one_of(&[0, 1, 2, len]));
        match spread {
            0 => needle[first] ^= 3,
            _ => copies
                .chunks_mut(len)
                .for_each(|it| it[(first + random.below(spread)) % len] ^= 3),
        }
        if random.below(2) == 0 && !copies.is_empty() {
            let (last, inside) = (copies.len() - len, random.below(copies.len() - len));
            copies[random.one_of(&[0, inside, last])..][..len].copy_from_slice(&needle);
        }
        [copies, needle]
    }

    #[optimize(size)]
    fn memmem(&mut self) {
        let len = self.random.below(40.min(self.text.len() + 1));
        let at = self.random.below(self.text.len() - len + 1);
        let mut needle = self.text[at..at + len].to_vec();
        if self.random.below(3) == 0 {
            needle.reverse();
        }
        let [copies, original] = self.near_misses();
        // A short load is padded with 0.
        let [to_zero, low, high] = match self.random.next().to_le_bytes() {
            [..128, low, high, ..] => [0, low, high],
            _ => [needle.first().copied().unwrap_or(0), 0, 0],
        };
        let [text, needle] =
            [self.text, &needle].map(|it| Vec::from_iter(it.iter().map(|byte| byte ^ to_zero)));
        let zeros = &[0; 3][self.random.below(3)..];
        let past_the_end = [&text[text.len() - len..], zeros].concat();
        let around_a_block = (self.random.below(96) | 31) + self.random.below(4) - 1;
        let some = &copies[..around_a_block.min(copies.len())];
        let [at_start, at_end] = [[&original, some].concat(), [some, &original].concat()];
        let ([a, b, c, d, e, f], at) = (&mut *self.rooms, self.offset);
        let pair = |byte: &u8| [byte >> 1 ^ low, byte & 1 ^ high];
        let pairs = |it: &[u8]| -> Vec<_> { it.iter().map(pair).collect() };
        let units = |it: Vec<_>| -> Vec<_> { it.into_iter().map(u16::from_le_bytes).collect() };
        for (text, needle) in [
            (&text, &needle),
            (&text, &past_the_end),
            (&copies, &original),
            (&at_start, &original),
            (&at_end, &original),
        ] {
            let (x, y) = (a.copy_of(text, at), b.copy_of(needle, at));
            let (text, needle) = (pairs(text), pairs(needle));
            let [x2, y2] = [c.copy_of(&text, at), d.copy_of(&needle, at)]
                .map(|it| shared(it.as_flattened_mut()).as_chunks().0);
            let (x16, y16) = (e.copy_of(&units(text), at), f.copy_of(&units(needle), at));

            let digests = &mut *self.digests;
            digests.add("memmem", memmem(x, y).number());
            digests.same(
                "memmem_shared",
                memmem_shared(shared(x), shared(y)).number(),
            );
            digests.same("memmem16_shared", memmem16_shared(x2, y2).number());
            digests.add("memrmem", memrmem(x, y).number());
            digests.same(
                "memrmem_shared",
                memrmem_shared(shared(x), shared(y)).number(),
            );
            digests.same("memrmem16_shared", memrmem16_shared(x2, y2).number());
            digests.same("memrmem16", memrmem16(x16, y16).number());
        }
    }

    #[optimize(size)]
    fn paths(&mut self) {
        let alphabet = self
            .random
            .one_of(&[&b"////...abcdefgh\xE9"[..], b"//..a", b"/.....abc"]);
        let path = self.random.bytes(self.text.len() % 80, alphabet);
        let path = self.rooms[0].copy_of(&path, self.offset);
        lists::of_paths(&mut (&*path, &mut *self.digests));
    }

    /// Any byte in each state of a terminal, then some that tell the next state.
    #[optimize(size)]
    fn escapes(&mut self) {
        let (random, mut text) = (&mut self.random, Vec::new());
        let (most, longest) = (random.one_of(&[2, 8, 30]), random.one_of(&[8, 8, 200]));
        for _ in 0..1 + random.below(most) {
            let (state, len) = (random.one_of(&STATES), random.below(longest));
            text.extend(state);
            text.push(random.next() as u8);
            text.extend(random.bytes(len, b"[00a\x07"));
        }
        // 1 has no width and starts no sequence.
        let short = [1, self.digests.round.to_le_bytes()[0]];
        for text in [&text[random.below(2)..], &short] {
            let text = self.rooms[0].copy_of(text, self.offset);
            let width = visible_latin1_width_exclude_ansi(text).number();
            self.digests.add("visible_latin1_width_exclude_ansi", width);
        }
    }

    #[optimize(size)]
    fn scanner_run_stops(&mut self) {
        let [a, b, c, d, ..] = &mut *self.rooms;
        let junk = vec![[0xA5; 8]; self.text.len().div_ceil(64)];
        let mut planes = [b, c, d].map(|room| room.copy_of(&junk, self.offset));
        let into = planes.each_mut().map(|plane| &mut plane[..]);
        scanner_run_stops(a.copy_of(self.text, self.offset), into);
        let planes = planes.map(|plane| hash(plane));
        self.digests.add("scanner_run_stops", hash(&planes));
    }

    #[optimize(size)]
    fn hashes(&mut self) {
        let any = self.random.next();
        let seed = self.random.one_of(&[0, 0, 0, 0, 1, any, any, any]);
        let digests = &mut *self.digests;
        let text = self.rooms[0].copy_of(self.text, self.offset);
        digests.add("xxhash3_64_shared", xxhash3_64_shared(seed, shared(text)));
        digests.add("xxhash32", xxhash32(seed as u32, text).into());
        digests.same(
            "xxhash32_shared",
            xxhash32_shared(seed as u32, shared(text)).into(),
        );
        digests.add("xxhash64", xxhash64(seed, text));
        digests.same("xxhash64_shared", xxhash64_shared(seed, shared(text)));
        let mut in_parts = XxHash64State::new(seed);
        for part in text.chunks(1 + self.random.below(100)) {
            in_parts.update(part);
        }
        digests.same("XxHash64State", in_parts.digest());
    }

    #[optimize(size)]
    fn checksums(&mut self) {
        let (random, digests) = (&mut self.random, &mut *self.digests);
        let seams = [2048, 4096, 5376, 5504, 10_752, 11_008, 65_536, 100_000];
        let round = digests.round as usize;
        let len = seams[round % seams.len()] - 40 + round / seams.len() % 121;
        let some = random.one_of(&[b"", &b"\xFF"[..], b"\xFE\xFF"]);
        let [from, to, ..] = &mut *self.rooms;
        for (alphabet, offset) in [(some, self.offset.min(random.below(64))), (b"", usize::MAX)] {
            let long = random.bytes(257, alphabet).repeat(len.div_ceil(257));
            for text in [self.text, &long[..400 + round % 1201], &long[..len]] {
                let (text, crc) = (from.copy_of(text, offset), random.next() as u32);
                // From 16 KB on, the kernels align their loads.
                let seam = text.len().saturating_sub(16_384);
                let splits = [random.below(text.len()), seam];
                digests.add("crc32", crc32(crc, text).into());
                for (start, end) in splits.map(|at| text.split_at(at)) {
                    digests.same("crc32 in parts", crc32(crc32(crc, start), end).into());
                }
                let (start, end) = shared(text).split_at(seam);
                let sum = crc32_shared(crc32_shared(crc, start), end);
                digests.same("crc32_shared", sum.into());
                let (mut sum, room) = (crc, to.uninit(text.len(), offset));
                let copy = copy_and_crc32(&mut sum, text, room.into());
                digests.fails_unless(copy == text, "copy_and_crc32");
                digests.same("copy_and_crc32", sum.into());
                digests.add("adler32", adler32(1, text).into());
                for (start, end) in splits.map(|at| text.split_at(at)) {
                    digests.same("adler32 in parts", adler32(adler32(1, start), end).into());
                }
                let (start, end) = shared(text).split_at(seam);
                let sum = adler32_shared(adler32_shared(1, start), end);
                digests.same("adler32_shared", sum.into());
                let (mut sum, room) = (1, to.uninit(text.len(), offset));
                let copy = copy_and_adler32(&mut sum, text, room.into());
                digests.fails_unless(copy == text, "copy_and_adler32");
                digests.same("copy_and_adler32", sum.into());
            }
        }
    }

    #[optimize(size)]
    fn zlib(&mut self) {
        let [a, b, ..] = &mut *self.rooms;
        let amount = self.random.next() as u16;
        let values: Vec<_> = (0..self.text.len() % 9)
            .map(|_| from_fn(|_| self.random.next() as u16))
            .collect();
        let got = a.copy_of(&values, self.offset);
        zlib::subtract_saturating(got, amount);
        let want = values.as_flattened().iter();
        let is_ok =
            (want.map(|it| it.saturating_sub(amount))).eq(got.as_flattened().iter().copied());
        self.digests
            .fails_unless(is_ok, "zlib::subtract_saturating");

        let (distance, len) = (
            1 + self.digests.round as usize / 3 % 70,
            self.random.below(259),
        );
        let mut want = self.random.bytes(distance, b"");
        let mut vec = Vec::with_capacity(distance + zlib::MATCH_SPAN);
        vec.extend(&want);
        let all = b.copy_of(&[&want[..], &[0; zlib::MATCH_SPAN]].concat(), self.offset);
        (0..len).for_each(|at| want.push(want[at]));
        let cells = Cell::from_mut(&mut *all).as_slice_of_cells();
        if let (Some(from), Some(to)) = (cells.first_chunk(), cells.last_chunk()) {
            zlib::copy_match(from, to, distance, len, Some(zlib::NEXT_MATCH_OFFSET));
        }
        self.digests
            .fails_unless(all.starts_with(&want), "zlib::copy_match");
        let is_done = zlib::push_match(&mut Appender::new(&mut vec, distance, 999), distance, len);
        self.digests
            .fails_unless(is_done && vec == want, "zlib::push_match");
    }

    #[optimize(size)]
    fn zstd(&mut self) {
        let [a, b, c, ..] = &mut *self.rooms;
        let (random, digests) = (&mut self.random, &mut *self.digests);
        let exist = crate::simd::chosen_by_default() == "avx512_icl";
        let (text, mut want) = (a.copy_of(self.text, self.offset), [0; 256]);
        text.iter().for_each(|&byte| want[usize::from(byte)] += 1);
        let is_ok = zstd::count_bytes(text) == exist.then_some(want);
        digests.fails_unless(is_ok, "zstd::count_bytes");

        let (shortest, more) = random.one_of(&[(1, 0), (1, 2), (1, 11), (8, 0), (11, 1), (12, 0)]);
        let codes: [_; 256] = from_fn(|_| {
            let len = shortest + random.below(more + 1) as u16;
            (random.next() as u16) << (16 - len) | len
        });
        let (mut want, mut bits, mut bit_count, mut before_last) = (Vec::new(), 0, 0, 0);
        for (at, &symbol) in text.iter().enumerate().rev() {
            if at == 63 {
                before_last = want.len();
            }
            let code = u64::from(codes[usize::from(symbol)]);
            bits |= code >> (16 - code % 16) << bit_count;
            bit_count += code % 16;
            while bit_count >= 8 {
                want.push(bits as u8);
                (bits, bit_count) = (bits >> 8, bit_count - 8);
            }
        }
        let missing = random.below(2);
        let out = b.copy_of(&vec![0xA5; before_last + 128 - missing], self.offset);
        let codes = c.copy_of(&[codes], self.offset);
        let got = zstd::write_codes(text, &codes[0], out);
        let got = got.map(|it| (&out[..it.len], it.bits, it.bit_count));
        let fits = exist && (missing == 0 || text.is_empty());
        let is_ok = got == fits.then_some((&want[..], bits, bit_count));
        digests.fails_unless(is_ok, "zstd::write_codes");

        codes[0].fill_with(|| random.next() as u16);
        let out = b.copy_of(&vec![0xA5; random.below(2 * text.len() + 200)], self.offset);
        let got = zstd::write_codes(text, &codes[0], out);
        let is_ok = got.is_none_or(|it| it.len <= out.len() && it.bit_count < 8);
        digests.fails_unless(is_ok, "zstd::write_codes, of any codes");
    }

    #[optimize(size)]
    fn byte_bits(&mut self) {
        let byte = self.random.one_of(&[0, b'\n', b' ', 0xFF]);
        let mut want = vec![0; self.text.len().div_ceil(64)];
        for (at, &it) in self.text.iter().enumerate() {
            want[at / 64] |= u64::from(it == byte) << (at % 64);
        }
        let (text, mut bits) = (self.rooms[0].copy_of(self.text, self.offset), Vec::new());
        byte_bits(text, byte, &mut bits);
        self.digests.fails_unless(bits == want, "byte_bits");
    }

    #[optimize(size)]
    fn odd_blocks(&mut self) {
        let mut text = vec![b' '; 20 * self.text.len()];
        for &byte in self.text.iter().take(20) {
            text[self.random.below(20 * self.text.len())] = byte;
        }
        text.truncate(1 << 17);
        let len = text.len().div_ceil(64 * 64);
        let marks = self.from_to(&text, len, |from, to| odd_blocks(from, to));
        self.digests.add("odd_blocks", marks);
    }

    #[optimize(size)]
    fn byte_set(&mut self) {
        // Each byte that is left out takes up to one pattern, and the full rows take one.
        let (count, diagonal) = (self.random.below(8), self.random.next() as u8);
        let mut left_out: Vec<_> = match count {
            7 => (0..7).map(|i| diagonal.wrapping_add(0x11 * i)).collect(),
            _ => (0..count).map(|_| self.some_byte()).collect(),
        };
        left_out.retain(|byte| !self.text[..self.text.len() / 2].contains(byte));
        let members = (0..=255).filter(|byte| !left_out.contains(byte));
        let set = ByteSet::new(&Vec::from_iter(members.map(|byte| byte..=byte)));
        let members = hash(&from_fn::<_, 256, _>(|byte| set.contains(byte as u8)));
        let len = set.prefix_len(self.rooms[0].copy_of(self.text, self.offset));
        let both = [len.number(), members];
        self.digests.add("ByteSet", hash(&both));
    }

    #[optimize(size)]
    fn from_to<T: Copy, U: NoUninit>(
        &mut self,
        from: &[T],
        len: usize,
        kernel: impl for<'a> Fn(&mut [T], Out<'a, U>) -> &'a mut [U],
    ) -> u64 {
        let [a, b, ..] = &mut *self.rooms;
        let (from, to) = (a.copy_of(from, self.offset), b.uninit(len, self.offset));
        hash(kernel(from, to.into()))
    }

    /// For kernels that return the same count, and leave the rest of the output as it is.
    #[optimize(size)]
    fn prefix<T: Copy>(
        &mut self,
        from: &[T],
        all: &[(&'static str, fn(&[T], &mut [u8]) -> usize)],
    ) {
        let (any, [a, b, ..]) = (self.random.below(from.len() + 70), &mut *self.rooms);
        for room in [from.len(), any] {
            for (i, (name, kernel)) in all.iter().enumerate() {
                let to = b.copy_of(&vec![0xFF; room], self.offset);
                let len = kernel(a.copy_of(from, self.offset), to);
                let is_rest_kept = to
                    .get(len..)
                    .is_some_and(|rest| rest.iter().all(|&it| it == 0xFF));
                self.digests.fails_unless(is_rest_kept, name);
                let how = if i == 0 { Digests::add } else { Digests::same };
                how(self.digests, name, hash(&[len.number(), hash(to)]));
            }
        }
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn ascii_prefix(&mut self, text: &[u8]) {
        self.prefix(text, &[
            ("copy_ascii_prefix_to_shared", |from, to| copy_ascii_prefix_to_shared(from, shared_out(to))),
            ("copy_short_ascii_prefix_to_shared", |from, to| copy_short_ascii_prefix_to_shared(from, shared_out(to))),
        ]);
    }

    #[optimize(size)]
    fn in_place(&mut self, kernel: &dyn Fn(&mut [u8])) -> u64 {
        let bytes = self.rooms[0].copy_of(self.text, self.offset);
        kernel(bytes);
        hash(bytes)
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn conversions(&mut self) {
        let (text, len, mask) = (self.text, self.text.len(), [1, self.some_byte(), 3, 4]);
        let any: Vec<u16> = (0..len).map(|_| self.random.next() as u16).collect();
        let ascii = self.mostly_ascii();
        let mut digits = self.random.bytes(len, HEX);
        // Each byte has a round with an odd length.
        if len % 2 == 1 {
            digits[self.random.below(len - 1)] = (self.digests.round / 6 * 2 + self.digests.round % 3) as u8;
        }
        let with_high_byte = |(&low, unit): (&u8, &u16)| unit << 8 | u16::from(low);
        let digits16: Vec<_> = digits.iter().zip(&any).map(with_high_byte).collect();

        self.prefix(&any, &[
            ("copy_u16_to_u8", |from, to| copy_u16_to_u8(from, to.into()).len()),
            ("copy_u16_to_shared", |from, to| copy_u16_to_shared(from, shared_out(to))),
        ]);
        self.ascii_prefix(text);
        self.prefix(&text[..len % 20], &[
            ("copy_few_ascii_to_shared", |from, to| from.len() * usize::from(copy_few_ascii_to_shared(from, shared_out(to)))),
        ]);
        self.digests.fails_unless(copy_few_ascii_to_shared(&[], &[]), "copy_few_ascii_to_shared");
        self.prefix(digits.as_chunks().0, &[
            ("decode_hex", |from, to| decode_hex(from, to.into()).len()),
            ("decode_hex_to_shared", |from, to| decode_hex_to_shared(from, shared_out(to))),
        ]);
        self.prefix(digits16.as_chunks().0, &[
            ("decode_hex16", |from, to| decode_hex16(from, to.into()).len()),
            ("decode_hex16_to_shared", |from, to| decode_hex16_to_shared(from, shared_out(to))),
        ]);

        let add: fn(&mut _, _, _) = Digests::add;
        let same: fn(&mut _, _, _) = Digests::same;
        for [room, twice] in [[len, 2 * len], [len, 2 * len].map(|len| self.random.below(len + 70))] {
            for (how, name, result) in [
                (add, "lower_ascii", self.from_to(text, room, |from, to| lower_ascii(from, to))),
                (add, "lower_ascii16", self.from_to(&ascii, room, |from, to| lower_ascii16(from, to))),
                (add, "encode_hex_lower", self.from_to(text, twice, |from, to| encode_hex_lower(from, to))),
                (same, "encode_hex_lower_from_shared", self.from_to(text, twice, |from, to| encode_hex_lower_from_shared(shared(from), to))),
                (add, "websocket::mask", self.from_to(text, room, |from, to| websocket::mask(mask, from, to))),
                (same, "websocket::mask_from_shared", self.from_to(text, room, |from, to| websocket::mask_from_shared(mask, shared(from), to))),
            ] {
                how(self.digests, name, result);
            }
        }
        let masked = self.in_place(&|bytes| websocket::mask_in_place(mask, bytes));
        self.digests.add("websocket::mask_in_place", masked);
        for (name, kernel) in lists::SWAPS {
            let swapped = self.in_place(&|bytes| kernel(AtomicU8::from_mut_slice(bytes)));
            self.digests.add(name, swapped);
        }
    }

    /// Has no digest: some targets round a product before they add to it.
    #[optimize(size)]
    fn modulate(&mut self) {
        let [brightness, saturation] = match self.random.below(20) {
            0 => [1e9, 0.0],
            _ => [(); 2].map(|()| self.random.below(300) as f32 / 100.0),
        };
        let before = self.text.as_chunks().0;
        let after = self.rooms[0].copy_of(before, self.offset);
        image::modulate(after, brightness, saturation);
        self.digests.trace("image::modulate", hash(after));
        let is_rounded = |(before, after): (&[u8; 4], &mut [u8; 4])| {
            let [r, g, b, alpha] = before.map(f32::from);
            let y = 0.299 * r + 0.587 * g + 0.114 * b;
            let exact = |c: f32| (((c - y) * saturation + y) * brightness).clamp(0.0, 255.0);
            let mut pairs = [exact(r), exact(g), exact(b), alpha]
                .into_iter()
                .zip(*after);
            pairs.all(|(exact, got)| (exact - f32::from(got)).abs() < 0.501)
        };
        let is_ok = before.iter().zip(after).all(is_rounded);
        self.digests.fails_unless(is_ok, "image::modulate");
    }

    #[optimize(size)]
    fn words(&mut self) {
        let groups = self.text.len() / 4;
        let words = self.random.words_of_all_sizes(groups);
        let exact = [groups, 16 * groups, groups];
        let other = exact.map(|len| self.random.below(len + 70));
        let bits = self.random.one_of(&[0, u32::MAX]);
        let group = |_| from_fn(|_| self.random.next() as u32 & bits);
        let of_one_size = Vec::from_iter((0..groups).map(group));
        for (words, rooms) in [(&words, exact), (&words, other), (&of_one_size, exact)] {
            let [a, b, c, d, ..] = &mut *self.rooms;
            let (controls, data) = pack_words(
                a.copy_of(words, self.offset),
                b.uninit(rooms[0], self.offset).into(),
                c.uninit(rooms[1], self.offset).into(),
            );
            self.digests
                .add("pack_words", hash(&[hash(controls), hash(data)]));
            let (data, into) = (
                d.copy_of(data, self.offset),
                a.uninit(rooms[2], self.offset),
            );
            let (words, used) = unpack_words(controls, data, into.into());
            self.digests
                .add("unpack_words", hash(&[hash(words), used.number()]));
        }
    }

    #[optimize(size)]
    fn json(&mut self) {
        const GIVES_UP: u32 = 8;
        for len in [self.text.len(), self.text.len() & !63] {
            let alphabet = self.random.one_of(&[JSON, JSON, b"{}[]:,"]);
            let mut text = self.random.bytes(len, alphabet);
            self.random.scatter(&mut text, &[0, 8, 8, 30]);
            let [is_escaped, is_in_string, is_in_scalar] =
                [(); 3].map(|()| self.random.next() & 1 != 0);
            let [mut state, mut again] = [json::State {
                is_escaped,
                is_in_string,
                is_in_scalar,
            }; 2];
            let [a, b, c, d, ..] = &mut *self.rooms;
            let (text, into) = (
                a.copy_of(&text, self.offset),
                b.uninit(len + 66, self.offset),
            );
            let dirty = c.copy_of(&vec![0xA5; len.div_ceil(4096)], self.offset);
            let found = json::index_chunk(text, 4096, into.into(), dirty, &mut state);
            let (index, flags) = found.unwrap_or((&mut [], GIVES_UP));
            let [x, y, z] = [state.is_escaped, state.is_in_string, state.is_in_scalar];
            // The last word depends on the padding, after which nothing follows.
            let state = &[x.into(), u64::from(y).wrapping_neg(), z.into()];
            let state = &state[..2 + usize::from(len.is_multiple_of(64))];
            let all = [flags.into(), hash(index), hash(dirty), hash(state)];
            let all = &all[..if flags == GIVES_UP { 1 } else { 4 }];
            self.digests.add("json::index_chunk", hash(all));

            let less = (index.len() + self.random.below(132)).saturating_sub(66);
            let less = d.uninit(less, self.offset);
            let short = json::index_chunk(text, 4096, less.into(), dirty, &mut again);
            let is_ok = short.is_none_or(|short| short == (index, flags));
            self.digests.fails_unless(is_ok, "json::index_chunk");
        }
    }

    #[optimize(size)]
    fn xml(&mut self) {
        let (wide, room) = (self.mostly_ascii(), self.text.len() + 64);
        let [is_open, ef, bf] = [(); 3].map(|()| self.random.next());
        let ([a, b, ..], at) = (&mut *self.rooms, self.offset);

        let before = xml::State {
            is_open: is_open & 1 != 0,
            ef_and_bf: [ef, bf],
            ends_with_lead_surrogate: ef & 1 != 0,
        };

        let (mut state, into) = (before, b.uninit(room, at).into());
        let index = xml::index_chunk(a.copy_of(self.text, at), 64, into, &mut state);
        let [ef, bf] = state.ef_and_bf;
        let both = [hash(index), hash(&[state.is_open.into(), ef, bf])];
        self.digests.add("xml::index_chunk", hash(&both));

        // A lead surrogate that the chunk before left open takes the place of one in this chunk.
        let wide = a.copy_of(wide.get(1..).unwrap_or_default(), at);
        let (mut state, into) = (before, b.uninit(room, at).into());
        let index = xml::index_chunk16(wide, 64, into, &mut state);
        let has_changed = state.ef_and_bf != before.ef_and_bf;
        let state = [state.is_open, state.ends_with_lead_surrogate, has_changed];
        let both = [hash(index), hash(&state.map(u64::from))];
        self.digests.add("xml::index_chunk16", hash(&both));
    }

    #[optimize(size)]
    fn moves(&mut self) {
        let pixels = self.text.as_chunks().0;
        let color = [(); 4].map(|()| self.some_byte());
        let palette = self.rooms[0].copy_of(pixels, self.offset);
        let nearest = image::nearest_in_palette(palette, color);
        self.digests
            .add("image::nearest_in_palette", nearest.into());

        let longest = self.random.one_of(&[10, 10, 10, 70]);
        let (a, b) = (self.text.len() % 200, self.random.below(longest));
        let any = self.random.one_of(&[(1 + a, b), (1 + a, b), (1 + b, a)]);
        let round = self.digests.round as usize;
        for (width, height) in [any, (1 + round % 7, round / 7 % 7)] {
            let image = self.random.bytes(4 * width * height, b"");
            let image = image.as_chunks().0;
            let room = image.len() + surplus(&mut self.random, self.offset, 9);
            for (name, kernel) in lists::MOVES {
                let moved = self.from_to(image, room, |from, to| kernel(from, width, to));
                self.digests.add(name, moved);
            }
        }
    }

    #[optimize(size)]
    fn png(&mut self) {
        let (row, len, at) = (self.text, self.text.len(), self.offset);
        let above = match self.random.below(2) {
            0 => self.random.bytes(len, b""),
            _ => (0..len).map(|i| (i / 128) as u8).collect(),
        };
        let [a, b, others @ ..] = &mut *self.rooms;
        for bytes_per_pixel in [1, 2, 4, 6, 8] {
            let len = len - len % bytes_per_pixel;
            for filter_type in 1..=4 {
                let (row, above) = (a.copy_of(&row[..len], at), b.copy_of(&above[..len], at));
                png::unfilter(filter_type, bytes_per_pixel, row, above);
                self.digests.add("png::unfilter", hash(row));
            }
        }

        let (row, above, junk) = (
            row.as_chunks().0,
            above.as_chunks().0,
            vec![[0xA5; 4]; len / 4],
        );
        let mut filtered = others.each_mut().map(|room| room.copy_of(&junk, at));
        let into = filtered.each_mut().map(|row| &mut row[..]);
        let sums = png::filter_rgba(a.copy_of(row, at), b.copy_of(above, at), into);
        let both = [hash(&sums), hash(&filtered.map(|row| hash(row)))];
        self.digests.add("png::filter_rgba", hash(&both));
    }

    #[optimize(size)]
    fn jpeg_transforms(&mut self) {
        let (random, [a, b, c, d, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (count, gap) = (random.below(9), random.below(9));
        let (one_in, shift) = (random.one_of(&[1, 5, 60, 600]), random.below(15));
        let mut block = |one_in, shift: usize, bits| {
            jpeg::Block(from_fn(|i| match random.below(one_in) * i {
                0 => random.next() as i16 >> shift & bits,
                _ => 0,
            }))
        };
        let blocks: Vec<_> = (0..count).map(|_| block(one_in, shift, -1)).collect();
        let [quant, x, y] = [15 - shift / 2, 0, shift].map(|shift| block(1, shift, i16::MAX));
        let blocks = a.copy_of(&blocks, at);
        for block in &mut *blocks {
            block.0[0] *= i16::from(random.below(3) != 0);
            block.0[random.below(64)] |= random.below(2) as i16;
        }
        for size in [2, 3, 4, 5, 6, 7, 8, 10, 12, 14] {
            let stride = count * size + jpeg::ROW_SLACK + gap;
            let rows = b.copy_of(&vec![7; size * stride - gap], at);
            let fits = jpeg::inverse_transform(blocks, &quant, size, rows, stride).is_some();
            for row in rows.chunks_mut(stride) {
                row[count * size..][..jpeg::ROW_SLACK].fill(0);
            }
            self.digests.fails_unless(fits, "jpeg::inverse_transform");
            self.digests.add("jpeg::inverse_transform", hash(rows));
        }

        let alphabet = random.one_of(&[b"", &b"\0\xFF"[..], b"xyz"]);
        let stride = 8 * count + gap;
        let rows = b.copy_of(&random.bytes(8 * stride - gap, alphabet), at);
        let (junk, steps) = (vec![jpeg::Block([7; 64]); count], &[x, y]);
        let hash_of = |blocks: &[jpeg::Block]| hash(&Vec::from_iter(blocks.iter().map(|it| it.0)));
        let (blocks, masks) = (a.copy_of(&junk, at), c.copy_of(&vec![[7; 1]; count], at));
        let fits = jpeg::forward_transform(rows, stride, steps, blocks, masks).is_some();
        let first = [hash_of(blocks), hash(masks)];
        let (blocks, planes) = (a.copy_of(&junk, at), d.copy_of(&vec![[7; 4]; count], at));
        let fits = fits & jpeg::forward_transform(rows, stride, steps, blocks, planes).is_some();
        let both = [first, [hash_of(blocks), hash(planes)]];
        self.digests.fails_unless(fits, "jpeg::forward_transform");
        self.digests.add("jpeg::forward_transform", hash(&both));
    }

    #[optimize(size)]
    fn jpeg_colors(&mut self) {
        let (random, [a, b, c, d, e, f], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (width, alphabet) = (random.below(200), random.one_of(&[b"", &b"\0\x80\xFF"[..]]));
        let padded = width.next_multiple_of(jpeg::PIXEL_GROUP);
        let y = f.copy_of(&random.bytes(padded, alphabet), at);
        for kind in 0..3 {
            let len = if kind == 0 { padded } else { padded / 2 + 4 };
            let [cb, cr, far_cb, far_cr] = [&mut *a, &mut *b, &mut *c, &mut *d].map(|room| {
                let len = len + surplus(random, at, 40);
                &*room.copy_of(&random.bytes(len, alphabet), at)
            });
            let chroma = match kind {
                0 => jpeg::Chroma::Full { cb, cr },
                1 => jpeg::Chroma::HalfWidth { cb, cr },
                _ => jpeg::Chroma::HalfSize {
                    cb: [cb, far_cb],
                    cr: [cr, far_cr],
                },
            };
            let mut pixels = Vec::with_capacity(padded);
            let fits = jpeg::ycc_to_rgba(y, chroma, width, &mut pixels).is_some();
            self.digests.fails_unless(fits, "jpeg::ycc_to_rgba");
            self.digests.add("jpeg::ycc_to_rgba", hash(&pixels));
        }

        let (pairs, gap) = (1 + random.below(3), random.below(5));
        let (from, to) = (random.one_of(&[0, padded + gap]), padded / 2 + gap);
        let pixels = random.bytes(4 * ((2 * pairs - 1) * from + padded), alphabet);
        let chroma_len = to * pairs - gap;
        let mut planes = [
            (a, 4 * to * pairs - 2 * gap),
            (b, chroma_len),
            (c, chroma_len),
        ]
        .map(|(room, len)| room.copy_of(&vec![7; len], at));
        let into = planes.each_mut().map(|plane| &mut plane[..]);
        let pixels = e.copy_of(pixels.as_chunks().0, at);
        let fits = jpeg::rgba_to_ycc420(pixels, from, padded, pairs, into, to).is_some();
        let planes = planes.map(|plane| hash(plane));
        self.digests.fails_unless(fits, "jpeg::rgba_to_ycc420");
        self.digests.add("jpeg::rgba_to_ycc420", hash(&planes));
    }

    /// Each color is in one of the first 8192 rounds.
    #[optimize(size)]
    fn jpeg_many_colors(&mut self) {
        const COUNT: usize = (1 << 24) / 8192;
        let round @ ..8192 = self.digests.round as usize else {
            return;
        };
        // Neither step maps two numbers to one.
        let colors = Vec::from_iter((COUNT * round..).take(COUNT).map(|i| {
            let product = (i * 0x9E_3779 % (1 << 24)) as u32;
            (product ^ product >> 12).to_le_bytes()
        }));
        let ([a, b, c, d, e, _], at) = (&mut *self.rooms, self.offset);
        let [y, cb, cr] = [(a, 0), (b, 1), (c, 2)]
            .map(|(room, i)| room.copy_of(&Vec::from_iter(colors.iter().map(|it| it[i])), at));
        let mut pixels = Vec::with_capacity(COUNT);
        let fits =
            jpeg::ycc_to_rgba(y, jpeg::Chroma::Full { cb, cr }, COUNT, &mut pixels).is_some();
        self.digests.fails_unless(fits, "jpeg::ycc_to_rgba");
        self.digests.add("jpeg::ycc_to_rgba", hash(&pixels));

        // The four pixels that are averaged have the same color.
        let row = d.copy_of(&Vec::from_iter(colors.iter().flat_map(|&it| [it; 2])), at);
        let y = e.copy_of(&vec![7; 4 * COUNT], at);
        let into = [&mut *y, &mut *cb, &mut *cr];
        let fits = jpeg::rgba_to_ycc420(row, 0, 2 * COUNT, 1, into, COUNT).is_some();
        let planes = [hash(y), hash(cb), hash(cr)];
        self.digests.fails_unless(fits, "jpeg::rgba_to_ycc420");
        self.digests.add("jpeg::rgba_to_ycc420", hash(&planes));
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn brotli_blocks(&mut self) {
        let (random, [a, b, c, d, e, _], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (groups, alphabet, step) = (1 + random.below(16), 1 + random.below(20), random.one_of(&[1.0, 0.37]));
        let len = if random.below(99) == 0 { 2100 } else { self.text.len() % 70 };
        let symbols = a.copy_of(&Vec::from_iter((0..len).map(|_| random.below(alphabet) as u16)), at);
        let mut costs = |count| Vec::from_iter((0..count).map(|_| from_fn(|_| random.below(9) as f64 * step)));
        let (added, sums) = (b.copy_of(&costs(alphabet * groups), at), c.copy_of(&costs(groups), at));
        let (switches, cheapest) = (d.copy_of(&vec![7; len * groups], at), e.copy_of(&vec![7; len], at));
        brotli::find_switches(symbols, added, 13.5, sums, switches, cheapest);
        self.digests.add("brotli::find_switches", hash(&[hash(sums), hash(switches), hash(cheapest)]));

        let (count, ids, kinds) = (4 + self.text.len() % 50 * 4, 2 + random.below(20), random.one_of(&[2, 5, 999]));
        let costs = a.copy_of(&Vec::from_iter((0..count).map(|_| random.below(kinds) as f64 * 0.3 - 1.0)), at);
        let mut pair = |_| [random.below(ids) as u32, (ids + random.below(ids)) as u32];
        let (pairs, merged) = (b.copy_of(&Vec::from_iter((0..count).map(&mut pair)), at), pair(0));
        let kept = brotli::remove_pairs(costs, pairs, merged);
        self.digests.add("brotli::remove_pairs", hash(&[kept.number(), hash(&costs[..kept.max(1)]), hash(&pairs[..kept.max(1)])]));

        let (count, kinds) = (self.text.len() % random.one_of(&[60, 300, 706]), random.one_of(&[2, 60, 32767, 40000]));
        let leaves = Vec::from_iter((0..count + brotli::LEAF_SLACK).map(|i| (random.below(kinds) << 32 | i) as u64));
        for like_shell_sort in [false, true] {
            let sorted = b.copy_of(&vec![7; leaves.len()], at);
            let did = brotli::sort_leaves(a.copy_of(&leaves, at), count, like_shell_sort, sorted);
            self.digests.add("brotli::sort_leaves", hash(&[did.number(), hash(&sorted[..count])]));
        }
    }

    /// What is not in the table is a power of two, whose logarithm is the same in each C library.
    #[optimize(size)]
    #[rustfmt::skip]
    fn brotli_costs(&mut self) {
        const KNOWN: u32 = 1024;
        let (random, [a, b, c, d, e, f], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let size = random.one_of(&[64, 256, 544, 704, 64 + self.text.len() % 81 * 8]);
        let (mut used, mut totals, mut gaps) = ([0; 11], [0; 4], [[0; 4]; 2]);
        let mut sums: [_; 4] = from_fn(|lane| {
            let (mut counts, one_in) = (vec![0; size], random.one_of(&[1, 2, 5, 30, 999]));
            let (bits, mut zeros) = (random.below(21), 0);
            (0..5).for_each(|i| counts[size / 5 * i + random.below(size / 5)] = 1);
            for (i, count) in counts.iter_mut().enumerate() {
                if random.below(one_in) == 0 {
                    let power = 1 << random.below(bits + 1);
                    *count = power + if power < KNOWN { random.below(power as usize) as u32 } else { 0 };
                }
                if *count == 0 {
                    zeros += 1;
                    continue;
                }
                gaps[usize::from(zeros > 2)][lane] += if zeros > 2 { 1 } else { zeros };
                (used[i / 64], totals[lane], zeros) = (used[i / 64] | 1 << (i % 64), totals[lane] + *count, 0);
            }
            counts
        });
        let common = Vec::from_iter((0..size).map(|i| sums.iter().fold(9, |least, sum| sum[i].min(least))));
        sums.iter_mut().for_each(|sum| sum.iter_mut().zip(&common).for_each(|(sum, common)| *sum -= common));
        let totals = totals.map(|it| if it < KNOWN { it } else { it.next_power_of_two() });
        let entry = |n: u32| [f64::from(n.ilog2()) + 1.01 * (f64::from(n) / f64::from(1 << n.ilog2()) - 1.0), n.into()];
        let table = Vec::from_iter([[1e6, 0.0]].into_iter().chain((1..KNOWN + brotli::SPARE_LOGARITHMS as u32).map(entry)));
        let others = [&*b.copy_of(&sums[0], at), c.copy_of(&sums[1], at), d.copy_of(&sums[2], at), e.copy_of(&sums[3], at)];
        let costs = brotli::estimate_costs(a.copy_of(&common, at), others, &used, &totals, &gaps, f.copy_of(&table, at));
        self.digests.add("brotli::estimate_costs", hash(&costs));
    }

    #[optimize(size)]
    #[rustfmt::skip]
    fn brotli_matches(&mut self) {
        let (random, [a, b, c, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let place = brotli::Place {
            ring: a.copy_of(&random.bytes(self.text.len() % 150, b"ab"), at),
            ring_mask: random.one_of(&[63, 127, 255]),
            position: random.below(999) as u32,
            pair: from_fn(|_| random.one_of(b"ab")),
        };
        let some: [[i32; 4]; 3] = from_fn(|_| from_fn(|_| random.below(200) as i32));
        let distances = from_fn(|_| random.one_of(&some));
        let ranked = from_fn(|_| u64::from(random.one_of(&[-3f32, -2.0, -1.0, 1e38]).to_bits()) << 32 | random.next() >> 32);
        self.digests.add("brotli::short_codes", brotli::short_codes(place, &some[0]).into());
        let (best, others) = brotli::short_codes_of_five(place, &distances, &ranked, -2.0);
        self.digests.add("brotli::short_codes_of_five", hash(&[best.into(), others]));

        let (mut longest, count, offset) = (from_fn::<_, 4, _>(|_| random.below(70)), 1 + random.below(4), random.below(9));
        longest[..count].sort_unstable();
        let (lengths, step) = (random.below(40)..longest[count - 1] + 1, random.one_of(&[0.5, 0.37]));
        let matches = longest.map(|it| (it as u64) << brotli::LENGTH_SHIFT | (1 + (random.next() >> (34 + random.below(30)))));
        let mut cost = |below| random.below(below) as f32 * step;
        let (tables, distance_costs): ([_; 3], _) = (from_fn(|_| from_fn(|_| cost(8))), from_fn(|_| cost(8)));
        let starts = [1, 2].map(|i| brotli::Start { cost: cost(40) - 15.0, symbol_costs: &tables[i], insert: i as u32 });
        let known = Vec::from_iter((0..offset + lengths.end + 3).map(|_| cost(60)));
        for name in ["brotli::try_lengths", "brotli::try_lengths_at_cost", "brotli::try_matches"] {
            let (costs, nodes) = (b.copy_of(&known, at), c.copy_of(&vec![7; 3 * known.len()], at));
            let (ways, lengths, mut taken) = (brotli::Ways { costs, nodes, offset: offset as u32 }, lengths.clone(), 0);
            match name {
                "brotli::try_lengths" => brotli::try_lengths(ways, lengths, &tables[0], starts[0], 5),
                "brotli::try_matches" => brotli::try_matches(ways, lengths, &tables[0], starts, &matches, count, &distance_costs),
                _ => taken = brotli::try_lengths_at_cost(ways, lengths, 9.0, 5, 6),
            }
            self.digests.add(name, hash(&[taken.number(), hash(costs), hash(nodes)]));
        }
    }

    /// Next to steps in the results that the other parts seldom get to.
    #[optimize(size)]
    #[rustfmt::skip]
    fn brotli_steps(&mut self) {
        let (random, [a, b, c, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (gaps, count, first) = (&[132, 57, 23, 10, 4][..random.below(6)], random.one_of(&[48, 209, 400, 704, 705]), random.one_of(&[0, 0, 5, 16]));
        let mut leaves = vec![0; count + brotli::LEAF_SLACK];
        // The first passes leave the leaf at `first` before all that are no sum of their gaps away.
        for i in 0..count {
            leaves[i] = u64::from(i == first || gaps.iter().any(|&gap| i >= gap && leaves[i - gap] >> 32 != 0)) << 32 | i as u64;
        }
        leaves[random.one_of(&[0, 20, count - 1])] |= random.one_of(&[0, 0, 0, 0, 0x7FFF << 32, 1 << 63]);
        let sorted = b.copy_of(&vec![7; leaves.len()], at);
        let did = brotli::sort_leaves(a.copy_of(&leaves, at), count, true, sorted);
        self.digests.add("brotli::sort_leaves", hash(&[did.number(), hash(&sorted[..count])]));

        let (count, ids, lowest) = (random.one_of(&[4, 40]), random.one_of(&[1, 2, 12]), random.one_of(&[0, (1 << 31) - 6]));
        let costs = a.copy_of(&Vec::from_iter((0..count).map(|_| random.below(2) as f64)), at);
        let mut pair = |_| { let it = lowest + random.below(ids) as u32; [it, it + 1 + random.below(ids) as u32] };
        let (pairs, merged) = (b.copy_of(&Vec::from_iter((0..count).map(&mut pair)), at), pair(0));
        let kept = brotli::remove_pairs(costs, pairs, merged);
        self.digests.add("brotli::remove_pairs", hash(&[kept.number(), hash(&costs[..kept.max(1)]), hash(&pairs[..kept.max(1)])]));

        let (zeros, each) = (random.one_of(&[0, 2, 9, 65, 513, 698]) + random.below(2), random.one_of(&[1, 256]));
        let (mut counts, mut gaps) = ([0; 704], [[0; 4]; 2]);
        match random.below(4) {
            0 => counts[..512].fill(each),
            // 256 codes in each lane.
            1 => (counts, gaps[0]) = (from_fn(|i| u32::from(i < 256 && i % 2 == 0 || i == 255)), [127; 4]),
            _ => {
                (counts[0], gaps[usize::from(zeros > 2)]) = (252, [if zeros > 2 { 1 } else { zeros as u32 }; 4]);
                counts[1 + zeros..][..4].fill(1);
            }
        }
        let used = from_fn(|word| (0..64).map(|i| u64::from(counts[64 * word + i] != 0) << i).sum());
        let entry = |n: u32| [if n < 256 { f64::from(n.ilog2()) + 0.37 } else { 99.0 }, n.into()];
        // One more, as QEMU reads 32 bytes for a `vinsertf128`, which takes 16.
        let table = Vec::from_iter([[1e6, 0.0]].into_iter().chain((1..=256 + brotli::SPARE_LOGARITHMS as u32).map(entry)));
        let (totals, others) = ([counts.iter().sum(); 4], [&*b.copy_of(&[0; 704], at); 4]);
        let costs = brotli::estimate_costs(a.copy_of(&counts, at), others, &used, &totals, &gaps, &mut c.copy_of(&table, at)[..table.len() - 1]);
        self.digests.add("brotli::estimate_costs", hash(&costs));

        let place = brotli::Place { ring: a.copy_of(&random.bytes(72, b"ab"), at), ring_mask: 63, position: random.next() as u32, pair: *b"ab" };
        let ranked = from_fn(|_| u64::from(random.one_of(&[-3f32, -0.5, -0.0, 1e-9]).to_bits()) << 32 | random.next() >> 32);
        let distances = from_fn(|_| from_fn(|_| random.next() as i32));
        let (best, others) = brotli::short_codes_of_five(place, &distances, &ranked, -2.0);
        self.digests.add("brotli::short_codes_of_five", hash(&[best.into(), others]));

        let (count, longest, table) = (1 + random.below(4), [9, 20, 33, 69], &from_fn(|i| i as f32 * 0.37));
        let matches = from_fn(|i| match random.next() {
            any if i >= count => any,
            any => longest[i] << brotli::LENGTH_SHIFT | any >> 59 << 32 | ((8 << (any % 28)) - 4 + (any >> 8) % 3),
        });
        let (costs, nodes) = (b.copy_of(&[1e9; 73], at), c.copy_of(&[7; 3 * 73], at));
        let (ways, starts) = (brotli::Ways { costs, nodes, offset: 0 }, [brotli::Start { cost: 1.0, symbol_costs: table, insert: 5 }; 2]);
        brotli::try_matches(ways, 2..longest[count - 1] as usize + 1, table, starts, &matches, count, &from_fn(|i| i as f32));
        self.digests.add("brotli::try_matches", hash(&[hash(costs), hash(nodes)]));
    }

    #[optimize(size)]
    fn webp_alphabet(&mut self) -> Vec<u8> {
        let (first, count) = (self.random.next() as u8, self.random.one_of(&[4, 13, 64]));
        let near = Vec::from_iter((first..=255).take(count));
        let (far, ends) = (
            b"\0\x10\x3F\x40\x7F\x80\x81\xC0\xEF\xFF",
            b"\0\x01\x02\xFD\xFE\xFF",
        );
        self.random
            .one_of(&[b"", &near[..], &near, far, ends])
            .to_vec()
    }

    #[optimize(size)]
    fn webp_macroblocks(&mut self) {
        let alphabet = self.webp_alphabet();
        let (random, [a, b, c, d, e, f], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (non_zero, shift) = ((random.next() & random.next()) as u32, random.below(15));
        let far = random.one_of(&[0, 0, 0, i16::MAX]);
        let blocks: [[_; 64]; 6] = from_fn(|y| {
            let bits = non_zero >> (4 * y) & 15;
            from_fn(|i| match bits == 0 || bits >> (i % 16 / 4) & 1 != 0 {
                true if i < 16 && i % 4 == 0 => random.next() as i16 >> shift ^ far,
                true => random.next() as i16 >> shift,
                false => 0,
            })
        });
        let residuals = &f.copy_of(&[*blocks.last_chunk().unwrap()], at)[0];
        let blocks = &mut a.copy_of(&[blocks], at)[0];
        webp::inverse_dct(blocks, non_zero);
        self.digests.add("webp::inverse_dct", hash(blocks));

        let above = &b.copy_of(random.bytes(16, &alphabet).as_chunks().0, at)[0];
        let left = &c.copy_of(random.bytes(20, &alphabet).as_chunks().0, at)[0];
        let right = random.bytes(4, &alphabet).as_chunks().0[0];
        let modes = &d.copy_of(&[from_fn(|_| from_fn(|_| random.below(12) as u8))], at)[0];
        let samples = &mut e.copy_of(&[[[7; 16]; 16]], at)[0];
        webp::reconstruct_subblocks(above, right, left, modes, residuals, samples);
        self.digests
            .add("webp::reconstruct_subblocks", hash(samples));
    }

    #[optimize(size)]
    fn webp_filters(&mut self) {
        let alphabet = self.webp_alphabet();
        let (random, [a, b, c, d, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (count, shift, has_above) = (random.below(6), random.below(6), random.below(4) != 0);
        let gap = random.below(2) * random.below(9);
        let strength = |_| webp::FilterStrength {
            edge_limit: random.next() as u8 >> (shift / 2),
            interior_limit: random.next() as u8 >> shift,
            high_variance_threshold: random.next() as u8 >> (2 + shift),
            filters_inner_edges: random.below(3) != 0,
        };
        let strengths = d.copy_of(&Vec::from_iter((0..count).map(strength)), at);
        for (name, is_simple) in [
            ("webp::filter_normally", false),
            ("webp::filter_simply", true),
        ] {
            let (above, chroma) = if is_simple { (2, 0) } else { (4, 8) };
            let stride = |size| size * count + 2 * webp::ROW_SLACK + gap;
            // QEMU reads 32 bytes for a `vinserti128`, which takes 16.
            let shapes = [
                (&mut *a, 16, 0),
                (&mut *b, chroma, 16),
                (&mut *c, chroma, 16),
            ];
            let mut planes = shapes.map(|(room, size, more)| {
                let len = (above + size) * stride(size);
                (
                    room.copy_of(&random.bytes(len + more, &alphabet), at),
                    len,
                    stride(size),
                )
            });
            let [y, u, v] = planes.each_mut().map(|(samples, len, stride)| webp::Plane {
                samples: &mut samples[..*len],
                stride: *stride,
                start: above * *stride + webp::ROW_SLACK,
            });
            let fits = match is_simple {
                true => webp::filter_simply(y, strengths, has_above),
                false => webp::filter_normally([y, u, v], strengths, has_above),
            };
            self.digests.fails_unless(fits.is_some(), name);
            self.digests.add(name, hash(&planes.map(|it| hash(it.0))));
        }
    }

    #[optimize(size)]
    fn webp_colors(&mut self) {
        let (random, [a, b, c, d, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (width, alphabet) = (
            self.text.len() % 200,
            random.one_of(&[b"", &b"\0\x80\xFF"[..]]),
        );
        let padded = width.next_multiple_of(webp::ROW_STEP);
        let distance = random.below(2) * random.below(padded + 2);
        let from = a.copy_of(&random.bytes(distance + padded + 1, alphabet), at);
        let to = b.copy_of(&vec![7; 4 * padded], at);
        let fits = webp::upsample(from, distance, to, width).is_some();
        self.digests.fails_unless(fits, "webp::upsample");
        let both = [0, 2 * padded].map(|start| hash(&to[start..][..2 * width]));
        self.digests.add("webp::upsample", hash(&both));

        let yuva = [a, b, c, d].map(|it| &*it.copy_of(&random.bytes(padded, alphabet), at));
        let (start, more) = (random.below(9), random.below(2 * width + 1));
        let spare = random.below(2) * random.below(2 * webp::ROW_STEP);
        let mut pixels = Vec::with_capacity(start + width.max(more) + spare);
        pixels.resize(start + more, [7; 4]);
        let fits = webp::yuv_to_rgba(yuva, &mut pixels, start, width).is_some();
        self.digests.fails_unless(fits, "webp::yuv_to_rgba");
        self.digests.add("webp::yuv_to_rgba", hash(&pixels));
    }

    #[optimize(size)]
    fn webp_transforms(&mut self) {
        let (random, [a, b, c, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (width, bits) = (1 + self.text.len() % 200, random.below(10) as u32);
        let alphabet = random.one_of(&[b"", &b"\0\x80\xFF"[..], b"\0\x01"]);
        let row = a.copy_of(random.bytes(4 * width, alphabet).as_chunks().0, at);
        let above = b.copy_of(random.bytes(4 * width, alphabet).as_chunks().0, at);
        let flat = random.below(width);
        above[flat..][..random.below(width - flat)].fill([9; 4]);
        let tiles = random.bytes(4 * width.div_ceil(1 << bits), b"");
        let tiles = c.copy_of(tiles.as_chunks().0, at);
        let fits = webp::undo_prediction(row, above, tiles, bits).is_some();
        self.digests.fails_unless(fits, "webp::undo_prediction");
        self.digests.add("webp::undo_prediction", hash(row));
        let fits = webp::undo_cross_color(above, tiles, bits).is_some();
        self.digests.fails_unless(fits, "webp::undo_cross_color");
        self.digests.add("webp::undo_cross_color", hash(above));
    }

    /// Hashes all that the encoder reads.
    #[optimize(size)]
    #[rustfmt::skip]
    fn webp_encoder(&mut self) {
        fn of<const PAIRS: usize>(it: &webp::Candidates<PAIRS>, first: usize, end: usize) -> [u64; 3] {
            let edges = it.edges.map(|pair| pair.map(|it| u64::from_le_bytes(it) << 8));
            let (levels, symbols) = (it.levels.map(|it| hash(&it[first..end])), it.symbols.map(|it| hash(&it[first..end])));
            [hash(&levels), hash(&symbols), hash(&edges[first..end])]
        }
        let of_modes = |it: &webp::SubblockCandidates, first: usize, end: usize| {
            hash(&[hash(&of(&it.block, first / 2, end / 2)), hash(&it.ends[first..end]), hash(&it.distortions[first..end])])
        };
        let (random, digests, to) = (&mut self.random, &mut *self.digests, &mut *self.scratch);
        let (noise, any) = (random.one_of(&[1, 3, 12, 60, 255, 256]), 4 + random.below(281) as u16);
        let step = random.one_of(&[4, 5, 16, any, 284]);
        let ranges = [(); 2].map(|()| random.one_of(&[(0, 255), (0, 255), (0, 255), (0, 0), (0, 7), (248, 255), (255, 255)]));
        let case = Case::new(random, noise, step, ranges);

        let (pixels, mut converted) = (self.rooms[0].copy_of(&case.pixels, self.offset), webp::Macroblock::default());
        webp::convert(&from_fn(|y| &pixels[y]), &case.colors, &case.gamma, &mut converted);
        digests.add("webp::convert", hash(&[hash(&converted.luma), hash(&converted.chroma)]));
        let histograms = webp::analyze(&case.samples, &case.edges[0], &case.edges[1]);
        digests.add("webp::analyze", hash(&histograms.map(|it| [it.highest_count, it.last_bin])));

        let (flags, it) = (case.try_luma_modes(to), &to.luma);
        let blocks = [hash(&it.blocks.each_ref().map(|it| of(it, 0, 2))), hash(&it.ends), flags.blocks.into()];
        let y2 = [hash(&of(&it.y2, 0, 2)[..2]), hash(&it.y2_ends.map(|it| it[0])), flags.y2.into()];
        let sums = [hash(&it.squared_errors), hash(&it.texture_differences), 0];
        digests.add("webp::try_luma_modes", hash(&[blocks, y2, sums]));

        let lambda = (50 * i32::from(step)) >> 5;
        for i in 0..16 {
            let bytes = random.one_of(&[case.samples.luma[i].as_flattened(), case.samples.chroma[0].as_flattened(), &case.edges[0].above]);
            let (edge, it) = (u128::from_le_bytes(*bytes.as_array().unwrap()) >> 24, &mut to.subblock);
            let last = webp::try_straight_modes(edge, case.context, i, &to.source, &case.luma, lambda, it);
            let straight = of_modes(it, 0, 4);
            digests.add("webp::try_straight_modes", hash(&[last.into(), straight]));
            let last = webp::try_diagonal_modes(edge, case.context, i, &to.source, &case.luma, lambda, it);
            digests.add("webp::try_diagonal_modes", hash(&[last.into(), of_modes(it, 4, 10)]));
            digests.fails_unless(of_modes(it, 0, 4) == straight, "webp::try_diagonal_modes");
        }

        for diffuses in [false, true] {
            let before = to.chroma.dc_errors;
            let (flag, it) = (case.try_chroma_modes(diffuses, to), &to.chroma);
            digests.fails_unless(diffuses || it.dc_errors == before, "webp::try_chroma_modes");
            let blocks = [hash(&it.blocks.each_ref().map(|it| of(it, 0, 2))), hash(&it.ends), flag.into()];
            let errors = [hash(&it.dc_errors[0]), hash(&it.dc_errors[1].map(|it| it[0])), 0].map(|it| it * u64::from(diffuses));
            let sums = [hash(&it.ac_counts.map(|it| it[0])), hash(&it.squared_errors), 0];
            digests.add("webp::try_chroma_modes", hash(&[blocks, errors, sums]));
        }
    }

    #[optimize(size)]
    fn some_mappings(&mut self) -> Vec<u8> {
        let (random, mut text) = (&mut self.random, Vec::new());
        let (is_plain, has_sources) = (random.below(3) == 0, random.below(4) == 0);
        let fields: &[_] = match random.below(8) {
            0 => &[1],
            _ => &[4, 4, 4, 4, 4, 4, 4, 4, 5, 1],
        };
        let sizes = random.one_of(&[&[3, 3, 3, 8, 14][..], &[8, 8, 14], &[3, 3, 3, 19, 24]]);
        let has_long = random.below(4) == 0;
        let delimiter = random.one_of(b",,,,,,,;");
        while text.len() < self.text.len() {
            let fields = match is_plain {
                true => 4 + usize::from(random.below(30) == 0),
                false => random.one_of(fields),
            };
            for field in 0..fields {
                let bits = match has_long && random.below(30) == 0 {
                    true => random.one_of(&[29, 34, 39]),
                    false if is_plain => 3,
                    false => random.one_of(sizes),
                };
                let is_negative = random.below(if field == 0 { 60 } else { 8 }) == 0;
                let number = random.below(1 << bits) << 1 | usize::from(is_negative);
                let source =
                    random.one_of(&[0, 2, 3]) * usize::from(has_sources && random.below(16) == 0);
                let mut rest = if field == 1 { source } else { number };
                while rest >= 32 {
                    text.push(BASE64[rest & 31 | 32]);
                    rest >>= 5;
                }
                text.push(BASE64[rest]);
            }
            match is_plain || random.below(12) != 0 {
                true => text.push(delimiter),
                false => text.extend(b";".repeat(random.one_of(&[1, 1, 1, 2, 3, 40]))),
            }
        }
        random.scatter(&mut text, &[0, 0, 0, 1]);
        text
    }

    #[optimize(size)]
    fn mappings(&mut self) {
        let byte = &self.digests.round.to_le_bytes()[..1];
        for text in [
            self.some_mappings(),
            [b"AAAA", byte, b","].concat(),
            [b"AAAA", byte, b"A,"].concat(),
            [byte, &b"AAAA,".repeat(16)[1..]].concat(),
        ] {
            self.mappings_in(&text);
        }
    }

    /// Where a call stops depends on the width of the vectors, so this goes on segment by segment.
    #[optimize(size)]
    fn mappings_in(&mut self, text: &[u8]) {
        let cap = match self.random.below(4) {
            0 => 1 + self.random.below(60),
            _ => text.len() + 1,
        };
        let has_names = self.random.below(2) == 0;
        let sources = self.random.one_of(&[2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 0]);
        let [gen_col, orig_line, orig_col, name_idx] =
            [(); 4].map(|()| self.random.one_of(&[0, 1 << 20, 1 << 20, i32::MAX - 999]));
        let mut state = sourcemap::MappingsState {
            gen_col,
            orig_line,
            orig_col,
            name_idx,
            ..Default::default()
        };
        let mut more = [surplus(&mut self.random, self.offset, 20); 4];
        more[self.random.below(3 + usize::from(has_names))] = 0;
        let ([a, b, c, d, e, _], at, mut rows) = (&mut *self.rooms, self.offset, Vec::new());
        let mut parse = |text: &[u8], cap: usize| {
            let pairs = &mut [b.uninit(cap + more[0], at), c.uninit(cap + more[1], at)];
            let indices = &mut [d.uninit(cap + more[2], at), e.uninit(cap + more[3], at)];
            let into = columns(pairs, indices, has_names);
            let (got, used) =
                sourcemap::parse_mappings(a.copy_of(text, at), into, sources, &mut state);
            for (i, &source) in got.src_idx.iter().enumerate() {
                let name = got.name_idx.as_ref().map_or(i32::MIN, |names| names[i]);
                rows.push([got.generated[i], got.original[i], [source, name]]);
            }
            (used, got.src_idx.len())
        };

        let (mut done, mut refused) = (0, Vec::new());
        while done < text.len() && refused.len() < 8 {
            let (at_once, filled) = parse(&text[done..], cap);
            let stop = done + at_once;
            done = stop;
            for segment in text[stop..].split_inclusive(|byte| b",;".contains(byte)) {
                let is_near = done - stop < 64 || cap - filled < 16;
                self.digests
                    .fails_unless(is_near, "sourcemap::parse_mappings");
                // Segments that change nothing and have no row fill the vector.
                let (used, _) = parse(&[segment, &b"A,".repeat(32)].concat(), 16);
                done += segment.len();
                if used < segment.len() {
                    refused.push(done.number());
                    break;
                }
            }
        }
        let lines = [
            state.gen_line,
            state.gen_col,
            state.orig_line,
            state.orig_col,
        ];
        let flags = [state.needs_sort, state.has_names].map(i32::from);
        let state = [&lines[..], &[state.src_idx, state.name_idx], &flags].concat();
        let all = [hash(&rows), hash(&state), hash(&refused)];
        self.digests.add("sourcemap::parse_mappings", hash(&all));
    }

    #[optimize(size)]
    fn resize(&mut self) {
        if !self.digests.round.is_multiple_of(20) {
            return;
        }
        let [w, h] = self
            .random
            .one_of(&[[60, 60], [60, 60], [2000, 5], [5, 2000]]);
        let [src_w, src_h, dst_w, dst_h] = [w, h, 60, 60].map(|longest| {
            let longest = self.random.one_of(&[5, longest, longest]);
            1 + self.random.below(longest)
        });
        let src = self.random.bytes(4 * src_w * src_h, b"");
        for filter in image::Filter::ALL {
            let resized = self.from_to(src.as_chunks().0, dst_w * dst_h, |from, to| {
                image::resize(filter, from, src_w, to, dst_w).unwrap()
            });
            self.digests.add("image::resize", resized);
        }
    }

    /// The seams between bands of rows.
    #[optimize(size)]
    fn resize_rows(&mut self) {
        let [src_w, dst_h] = [(); 2].map(|()| 1 + self.random.below(5));
        let (dst_w, src_h) = match self.digests.round {
            round if round.is_multiple_of(3) => (40 + self.random.below(25), 1 + self.text.len()),
            round if round % 48 == 2 => (800 + self.random.below(500), 9 + self.text.len() % 20),
            _ => return,
        };
        let filter = self.random.one_of(&image::Filter::ALL);
        let src = self.random.bytes(4 * src_w * src_h, b"");
        let resized = self.from_to(src.as_chunks().0, dst_w * dst_h, |from, to| {
            image::resize(filter, from, src_w, to, dst_w).unwrap()
        });
        self.digests.add("image::resize", resized);
    }
}

/// Runs the parts whose names start with `only`, or are in the range if it is like `j..m`.
#[optimize(size)]
pub(crate) fn run(rounds: u64, only: &[u8], traced: Vec<u8>) -> bool {
    let (rooms, digests) = (&mut [(); 6].map(|()| Room::new()), &mut Digests::default());
    let scratch = &mut *Box::default();
    digests.traced = traced;
    let is_chosen = |name: &[u8]| match strings::split_once(only, b"..") {
        Some((from, to)) => (from..to).contains(&name),
        None => name.starts_with(only),
    };
    for number in 0..rounds {
        let mut random = Random(hash(&[number]) | 1);
        let (short, inside) = ((number / 3 % SHORT_LENGTHS) as usize, random.below(8192));
        let longest = random.one_of(&[400, 400, 400, 2000, 2000, 2000, 2000, 20_000]);
        let (len, offset) = match number % 3 {
            0 => (short, usize::MAX),
            1 => (short, 0),
            _ => (
                random.below(longest),
                random.one_of(&[0, inside, inside, usize::MAX]),
            ),
        };
        let alphabet = random.one_of(&ALPHABETS);
        let mut text = random.bytes(len, alphabet);
        // So that a search gets far.
        let (start, end) = text.split_at_mut(random.below(len));
        match random.below(4) {
            0 => start.fill(b'a'),
            1 => end.fill(b'a'),
            _ => {}
        }
        random.scatter(&mut text, &[0, 0, 1, 8]);
        digests.round = number;
        let mut round = Round {
            text: &text,
            offset,
            random,
            rooms,
            digests,
            scratch,
        };
        // The digests of a part depend on all of its input: add input as a new part.
        let parts: [(_, fn(&mut _)); _] = [
            ("searches", Round::searches),
            ("memmem", Round::memmem),
            ("scanner_run_stops", Round::scanner_run_stops),
            ("byte_bits", Round::byte_bits),
            ("odd_blocks", Round::odd_blocks),
            ("checksums", Round::checksums),
            ("hashes", Round::hashes),
            ("conversions", Round::conversions),
            ("modulate", Round::modulate),
            ("words", Round::words),
            ("json", Round::json),
            ("xml", Round::xml),
            ("moves", Round::moves),
            ("png", Round::png),
            ("mappings", Round::mappings),
            ("resize", Round::resize),
            ("byte_set", Round::byte_set),
            ("lone_match", Round::lone_match),
            ("jpeg_transforms", Round::jpeg_transforms),
            ("jpeg_colors", Round::jpeg_colors),
            ("paths", Round::paths),
            ("escapes", Round::escapes),
            ("lone_stop", Round::lone_stop),
            ("webp_macroblocks", Round::webp_macroblocks),
            ("webp_filters", Round::webp_filters),
            ("webp_colors", Round::webp_colors),
            ("webp_transforms", Round::webp_transforms),
            ("webp_encoder", Round::webp_encoder),
            ("uniform", Round::uniform),
            ("resize_rows", Round::resize_rows),
            ("jpeg_many_colors", Round::jpeg_many_colors),
            ("brotli_blocks", Round::brotli_blocks),
            ("brotli_costs", Round::brotli_costs),
            ("brotli_matches", Round::brotli_matches),
            ("brotli_steps", Round::brotli_steps),
            ("zlib", Round::zlib),
            ("zstd", Round::zstd),
        ];
        for (name, part) in parts.into_iter().filter(|it| is_chosen(it.0.as_bytes())) {
            round.random = Random(hash(&[number, hash(name.as_bytes())]) | 1);
            round.digests.part = name;
            part(&mut round);
        }
    }
    let start = format!("{rounds} ");
    let recorded = strings::split(include_bytes!("digests.txt"), b"\n");
    let mut recorded: Vec<_> = recorded
        .filter(|it| it.starts_with(start.as_bytes()))
        .collect();
    let mut is_ok = digests.failed.is_empty();
    for (fails, why) in [
        (
            recorded.is_empty(),
            "nothing is recorded for that many rounds",
        ),
        (
            rounds > 0 && digests.part.is_empty(),
            "no part by that name",
        ),
        (
            !digests.traced.is_empty() && !digests.has_traced,
            "no results by that name",
        ),
    ] {
        if fails {
            write_line(format_args!("FAIL: {why}"));
            is_ok = false;
        }
    }
    recorded.retain(|it| is_chosen(&it[start.len()..]));
    for ([part, kernel], digest) in &digests.all {
        let line = format!("{start}{part} {kernel} {digest:016x}");
        match recorded.iter().position(|&it| it == line.as_bytes()) {
            Some(at) => _ = recorded.remove(at),
            None => {
                write_line(format_args!("+{line}"));
                is_ok = false;
            }
        }
    }
    for line in &recorded {
        write_line(format_args!("-{}", line.escape_ascii()));
    }
    write_line(format_args!("rounds: {rounds}"));
    is_ok && recorded.is_empty()
}
