//! Hashes what each kernel makes of random input, which is next to inaccessible pages.
//! The digests are the same on every target, and have to be those in `digests.txt`.
use crate::lists::{self, Each, Number};
use crate::room::Room;
use crate::{Random, columns, shared, shared_out, write_line};
use bun_core::{NoUninit, strings};
use bun_simd::Out;
use bun_simd_kernels::*;
use core::array::from_fn;
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
        let mut other = text[..len].to_vec();
        self.random.scatter(&mut other, &[0, 1, 1, 3]);
        let ([a, b, c, d, ..], at, digests) = (&mut *self.rooms, self.offset, &mut *self.digests);
        let (text, chars) = (a.copy_of(text, at), b.copy_of(&chars, at));
        let (wide, other) = (c.copy_of(&wide, at), d.copy_of(&other, at));

        lists::of_units(&mut (&*wide, &mut *digests));
        lists::of_units(&mut (&wide[wide.len().saturating_sub(count - 3)..], &mut *digests));
        lists::of_bytes(&mut (&*text, &mut *digests));
        digests.add("line_starts", hash(&line_starts(text)));
        digests.add("count_char", count_char(text, byte).number());
        digests.add("common_prefix_length", common_prefix_length(text, other).number());
        digests.add("common_prefix_length", common_prefix_length(text, text).number());
        digests.add("index_of_char", index_of_char(text, byte).number());
        digests.same("index_of_char_shared", index_of_char_shared(shared(text), byte).number());
        digests.add("last_index_of_char", last_index_of_char(text, byte).number());
        digests.same("last_index_of_char_shared", last_index_of_char_shared(shared(text), byte).number());
        digests.add("index_of_char16", index_of_char16(wide, unit).number());
        digests.add("last_index_of_char16", last_index_of_char16(wide, unit).number());
        digests.add("index_of_not_char", index_of_not_char(text, byte).number());
        for chars in [chars, &chars[count - 3..], &chars[count - 2..]] {
            digests.add("index_of_any_char", index_of_any_char(text, chars).number());
            digests.add("last_index_of_any_char", last_index_of_any_char(text, chars).number());
        }
        for quote in *b"\"'`" {
            digests.add("index_of_interesting_character_in_string_literal", index_of_interesting_character_in_string_literal(text, quote).number());
            digests.add("index_of_needs_escape_for_javascript_string", index_of_needs_escape_for_javascript_string(text, quote).number());
        }
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
        let len = self.text.len().min(600);
        let alone = self.rooms[0].copy_of(&[self.digests.round as u8], self.offset);
        lists::of_bytes(&mut (&*alone, &mut *self.digests));
        let set = ByteSet::new(&[b'0'..=b'9', b'a'..=b'z']);
        for _ in 0..len.min(8) {
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
            lists::of_bytes(&mut (&*text, &mut *digests));
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
        let ([a, b, c, d, e, f], at) = (&mut *self.rooms, self.offset);
        let [low, high, ..] = self.random.next().to_le_bytes();
        let pair = |byte: &u8| [byte >> 1 ^ low, byte & 1 ^ high];
        let pairs = |it: &[u8]| -> Vec<_> { it.iter().map(pair).collect() };
        let units = |it: Vec<_>| -> Vec<_> { it.into_iter().map(u16::from_le_bytes).collect() };
        for (text, needle) in [(self.text, &needle[..]), (&copies, &original)] {
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
        let text = self.rooms[0].copy_of(&text[random.below(2)..], self.offset);
        let width = visible_latin1_width_exclude_ansi(text).number();
        self.digests.add("visible_latin1_width_exclude_ansi", width);
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
        let (seed, digests) = (self.random.one_of(&[0, any]), &mut *self.digests);
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
        let mut left_out: Vec<_> = (0..self.random.below(8))
            .map(|_| self.some_byte())
            .collect();
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
        self.random.scatter(&mut digits, &[len % 2]);
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
                (same, "encode_hex_lower_shared", self.from_to(text, twice, |from, to| encode_hex_lower_shared(shared(from), to))),
                (add, "fill_with_mask", self.from_to(text, room, |from, to| fill_with_mask(mask, to, from))),
                (same, "fill_with_mask_from_shared", self.from_to(text, room, |from, to| fill_with_mask_from_shared(mask, to, shared(from)))),
            ] {
                how(self.digests, name, result);
            }
        }
        let masked = self.in_place(&|bytes| mask_in_place(mask, bytes));
        self.digests.add("mask_in_place", masked);
        for (name, kernel) in lists::SWAPS {
            let swapped = self.in_place(&|bytes| kernel(AtomicU8::from_mut_slice(bytes)));
            self.digests.add(name, swapped);
        }
    }

    /// Has no digest: some targets round a product before they add to it.
    #[optimize(size)]
    fn modulate(&mut self) {
        let [brightness, saturation] = [(); 2].map(|()| self.random.below(300) as f32 / 100.0);
        let before = self.text.as_chunks().0;
        let after = self.rooms[0].copy_of(before, self.offset);
        modulate(after, brightness, saturation);
        self.digests.trace("modulate", hash(after));
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
        self.digests.fails_unless(is_ok, "modulate");
    }

    #[optimize(size)]
    fn words(&mut self) {
        let groups = self.text.len() / 4;
        let words = self.random.words_of_all_sizes(groups);
        let exact = [groups, 16 * groups, groups];
        for rooms in [exact, exact.map(|len| self.random.below(len + 70))] {
            let [a, b, c, d, ..] = &mut *self.rooms;
            let (controls, data) = pack_words(
                a.copy_of(&words, self.offset),
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
        for len in [self.text.len(), self.text.len() & !63] {
            let mut text = self.random.bytes(len, JSON);
            self.random.scatter(&mut text, &[0, 8, 8, 30]);
            let [escaped, in_string, scalar] = [(); 3].map(|()| self.random.next() & 1);
            let mut state = [escaped, in_string.wrapping_neg(), scalar];
            let [a, b, c, ..] = &mut *self.rooms;
            let (text, into) = (
                a.copy_of(&text, self.offset),
                b.uninit(len + 66, self.offset),
            );
            let dirty = c.copy_of(&vec![0xA5; len.div_ceil(4096)], self.offset);
            let (index, flags) =
                json_structural_index_chunk(text, 4096, into.into(), dirty, &mut state);
            // The last word depends on the padding, after which nothing follows.
            let state = &state[..2 + usize::from(len.is_multiple_of(64))];
            let all = [flags.into(), hash(index), hash(dirty), hash(state)];
            let has_given_up = flags & 8 != 0;
            let all = &all[..if has_given_up { 1 } else { 4 }];
            self.digests.add("json_structural_index_chunk", hash(all));
        }
    }

    #[optimize(size)]
    fn xml(&mut self) {
        let (wide, room) = (self.mostly_ascii(), self.text.len() + 64);
        let [is_open, ef, bf] = [(); 3].map(|()| self.random.next());
        let ([a, b, ..], at) = (&mut *self.rooms, self.offset);

        let (mut state, into) = ([is_open & 1, ef, bf], b.uninit(room, at).into());
        let index = xml_structural_index_chunk(a.copy_of(self.text, at), 64, into, &mut state);
        let both = [hash(index), hash(&state)];
        self.digests.add("xml_structural_index_chunk", hash(&both));

        // A lead surrogate that the chunk before left open takes the place of one in this chunk.
        let wide = a.copy_of(wide.get(1..).unwrap_or_default(), at);
        let (mut state, into) = ([is_open & 1, ef & 1, 0], b.uninit(room, at).into());
        let index = xml_structural_index16_chunk(wide, 64, into, &mut state);
        let both = [hash(index), hash(&state)];
        self.digests
            .add("xml_structural_index16_chunk", hash(&both));
    }

    #[optimize(size)]
    fn moves(&mut self) {
        let pixels = self.text.as_chunks().0;
        let color = [(); 4].map(|()| self.some_byte());
        let palette = self.rooms[0].copy_of(&pixels[..pixels.len().min(256)], self.offset);
        let nearest = nearest_in_palette(palette, color);
        self.digests.add("nearest_in_palette", nearest.into());

        let longest = self.random.one_of(&[10, 10, 10, 70]);
        let (a, b) = (self.text.len() % 200, self.random.below(longest));
        let (width, height) = self.random.one_of(&[(1 + a, b), (1 + a, b), (1 + b, a)]);
        let image = self.random.bytes(4 * width * height, b"");
        let image = image.as_chunks().0;
        for (name, kernel) in lists::MOVES {
            let moved = self.from_to(image, image.len(), |from, to| kernel(from, width, to));
            self.digests.add(name, moved);
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
                png_unfilter(filter_type, bytes_per_pixel, row, above);
                self.digests.add("png_unfilter", hash(row));
            }
        }

        let (row, above, junk) = (
            row.as_chunks().0,
            above.as_chunks().0,
            vec![[0xA5; 4]; len / 4],
        );
        let mut filtered = others.each_mut().map(|room| room.copy_of(&junk, at));
        let into = filtered.each_mut().map(|row| &mut row[..]);
        let sums = png_filter_rgba(a.copy_of(row, at), b.copy_of(above, at), into);
        let both = [hash(&sums), hash(&filtered.map(|row| hash(row)))];
        self.digests.add("png_filter_rgba", hash(&both));
    }

    #[optimize(size)]
    fn jpeg_transforms(&mut self) {
        let (random, [a, b, c, d, ..], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (count, gap) = (random.below(9), random.below(9));
        let (one_in, shift) = (random.one_of(&[1, 5, 60, 600]), random.below(15));
        let mut block = |one_in, shift: usize, bits| {
            JpegBlock(from_fn(|i| match random.below(one_in) * i {
                0 => random.next() as i16 >> shift & bits,
                _ => 0,
            }))
        };
        let blocks: Vec<_> = (0..count).map(|_| block(one_in, shift, -1)).collect();
        let [quant, x, y] = [15 - shift / 2, 0, shift].map(|shift| block(1, shift, i16::MAX));
        let blocks = a.copy_of(&blocks, at);
        for block in &mut *blocks {
            block.0[random.below(64)] |= random.below(2) as i16;
        }
        for size in [2, 3, 4, 5, 6, 7, 8, 10, 12, 14] {
            let stride = count * size + JPEG_ROW_SLACK + gap;
            let rows = b.copy_of(&vec![7; size * stride - gap], at);
            let fits = jpeg_inverse_transform(blocks, &quant, size, rows, stride).is_some();
            for row in rows.chunks_mut(stride) {
                row[count * size..][..JPEG_ROW_SLACK].fill(0);
            }
            self.digests.fails_unless(fits, "jpeg_inverse_transform");
            self.digests.add("jpeg_inverse_transform", hash(rows));
        }

        let alphabet = random.one_of(&[b"", &b"\0\xFF"[..], b"xyz"]);
        let stride = 8 * count + gap;
        let rows = b.copy_of(&random.bytes(8 * stride - gap, alphabet), at);
        let (junk, steps) = (vec![JpegBlock([7; 64]); count], &[x, y]);
        let hash_of = |blocks: &[JpegBlock]| hash(&Vec::from_iter(blocks.iter().map(|it| it.0)));
        let (blocks, masks) = (a.copy_of(&junk, at), c.copy_of(&vec![[7; 1]; count], at));
        let fits = jpeg_forward_transform(rows, stride, steps, blocks, masks).is_some();
        let first = [hash_of(blocks), hash(masks)];
        let (blocks, planes) = (a.copy_of(&junk, at), d.copy_of(&vec![[7; 4]; count], at));
        let fits = fits & jpeg_forward_transform(rows, stride, steps, blocks, planes).is_some();
        let both = [first, [hash_of(blocks), hash(planes)]];
        self.digests.fails_unless(fits, "jpeg_forward_transform");
        self.digests.add("jpeg_forward_transform", hash(&both));
    }

    #[optimize(size)]
    fn jpeg_colors(&mut self) {
        let (random, [a, b, c, d, e, f], at) = (&mut self.random, &mut *self.rooms, self.offset);
        let (width, alphabet) = (random.below(200), random.one_of(&[b"", &b"\0\x80\xFF"[..]]));
        let padded = width.next_multiple_of(JPEG_PIXEL_GROUP);
        let y = f.copy_of(&random.bytes(padded, alphabet), at);
        for kind in 0..3 {
            let len = if kind == 0 { padded } else { padded / 2 + 4 };
            let [cb, cr, far_cb, far_cr] = [&mut *a, &mut *b, &mut *c, &mut *d]
                .map(|room| &*room.copy_of(&random.bytes(len, alphabet), at));
            let chroma = match kind {
                0 => JpegChroma::Full { cb, cr },
                1 => JpegChroma::HalfWidth { cb, cr },
                _ => JpegChroma::HalfSize {
                    cb: [cb, far_cb],
                    cr: [cr, far_cr],
                },
            };
            let mut pixels = Vec::with_capacity(padded);
            let fits = jpeg_ycc_to_rgba(y, chroma, width, &mut pixels).is_some();
            self.digests.fails_unless(fits, "jpeg_ycc_to_rgba");
            self.digests.add("jpeg_ycc_to_rgba", hash(&pixels));
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
        let fits = jpeg_rgba_to_ycc420(pixels, from, padded, pairs, into, to).is_some();
        let planes = planes.map(|plane| hash(plane));
        self.digests.fails_unless(fits, "jpeg_rgba_to_ycc420");
        self.digests.add("jpeg_rgba_to_ycc420", hash(&planes));
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
        let byte = &[self.digests.round as u8][..];
        for text in [
            self.some_mappings(),
            [b"AAAA", byte, b","].concat(),
            [b"AAAA", byte, b"A,"].concat(),
            [byte, &b"AAAA,".repeat(16)[1..]].concat(),
        ] {
            self.mappings_in(&text);
        }
    }

    /// Where a call stops depends on the width of the vectors, so this goes on segment by segment,
    /// and starts again after one that is refused.
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
        let mut state = MappingsState {
            gen_col,
            orig_line,
            orig_col,
            name_idx,
            ..Default::default()
        };
        let ([a, b, c, d, e, _], at, mut rows) = (&mut *self.rooms, self.offset, Vec::new());
        let mut parse = |text: &[u8], cap: usize| {
            let pairs = &mut [&mut *b, &mut *c].map(|room| room.uninit(cap, at));
            let indices = &mut [&mut *d, &mut *e].map(|room| room.uninit(cap, at));
            let into = columns(pairs, indices, has_names);
            let (got, used) = parse_mappings(a.copy_of(text, at), into, sources, &mut state);
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
                self.digests.fails_unless(is_near, "parse_mappings");
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
        self.digests.add("parse_mappings", hash(&all));
    }

    #[optimize(size)]
    fn resize(&mut self) {
        if self.random.below(20) != 0 {
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
        for filter in Filter::ALL {
            let resized = self.from_to(src.as_chunks().0, dst_w * dst_h, |from, to| {
                resize(filter, from, src_w, to, dst_w).unwrap()
            });
            self.digests.add("resize", resized);
        }
    }
}

#[optimize(size)]
pub(crate) fn run(rounds: u64, traced: Vec<u8>) -> bool {
    let (rooms, digests) = (&mut [(); 6].map(|()| Room::new()), &mut Digests::default());
    digests.traced = traced;
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
        };
        // The digests of a part depend on all of its input: add input as a new part.
        let parts: [(_, fn(&mut _)); _] = [
            ("searches", Round::searches),
            ("memmem", Round::memmem),
            ("scanner_run_stops", Round::scanner_run_stops),
            ("odd_blocks", Round::odd_blocks),
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
        ];
        for (name, part) in parts {
            round.random = Random(hash(&[number, hash(name.as_bytes())]) | 1);
            round.digests.part = name;
            part(&mut round);
        }
    }
    if !digests.traced.is_empty() && !digests.has_traced {
        write_line(format_args!("FAIL: no results by that name"));
        return false;
    }
    let start = format!("{rounds} ");
    let recorded = strings::split(include_bytes!("digests.txt"), b"\n");
    let mut recorded: Vec<_> = recorded
        .filter(|it| it.starts_with(start.as_bytes()))
        .collect();
    let mut is_ok = digests.failed.is_empty();
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
