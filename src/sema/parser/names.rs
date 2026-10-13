//! From the spelling of a name to its atom and its token kind, in one probe.
//!
//! A file repeats the same few hundred names. Tables that hold the spelling inline find them: a hit
//! touches one cache line and compares integers.
//!
//! The atoms are those of an interner that many files share, or the file's own.
//! - Shared: the tables are caches, which stay from file to file. A miss asks the interner.
//! - Own: the tables are the interner. The atoms with fixed numbers (`atom::known`) keep them, and
//!   every other text gets the next number where it first occurs. No memory is shared with another
//!   thread, little of it is touched, and the numbers are dense. The readers of the HIR ask
//!   [`FileAtoms`].

use crate::token::{KEYWORDS, T, keyword};
use bun_sema::atom::{Atom, Intern, KNOWN_TEXTS, NOT_IN_THE_FILE, OwnTexts, word};
use bun_sema::hir::mention_bit_of;
use bun_threading::Guarded;
use std::sync::OnceLock;

/// A text of at most 15 bytes, padded with zeros. It does not end with a zero byte, so the padded
/// bytes determine the length. An entry without bytes is free.
#[derive(Copy, Clone)]
struct Short {
    words: [u64; 2],
    atom: u32,
    kind: T,
}

/// A text of 16 to 32 bytes. An entry without a length is free.
#[derive(Copy, Clone)]
struct Long {
    /// The first and the last 16 bytes, which may overlap.
    words: [u64; 4],
    atom: u32,
    len: u8,
}

impl Long {
    /// Word by word: arrays are compared in memory.
    #[inline(always)]
    fn is(&self, words: [u64; 4], len: usize) -> bool {
        let [a, b, c, d] = self.words;
        (a ^ words[0]) | (b ^ words[1]) | (c ^ words[2]) | (d ^ words[3]) == 0
            && usize::from(self.len) == len
    }
}

const MENTIONED_WORDS: usize = bun_sema::hir::MENTIONED_BITS / 64;
const SHORT_BITS: u32 = 14;
const LONG_BITS: u32 = 12;
const KNOWN_BITS: u32 = 10;
const KNOWN_LONG_BITS: u32 = 6;
/// How many places a text can be at, from its first on.
const WINDOW: usize = 8;
/// In `Names::spans`: the text is in `Names::cooked`, not in the source.
const COOKED: u32 = OwnTexts::ELSEWHERE;
/// `Names::spans` of `KNOWN_TEXTS` where they are one after the other at the start of
/// `Names::cooked`, and the length of that.
const KNOWN_SPANS: ([(u32, u32); KNOWN_TEXTS.len()], usize) = {
    let mut spans = [(0, 0); KNOWN_TEXTS.len()];
    let (mut at, mut bytes) = (0, 0);
    while at < spans.len() {
        spans[at] = (bytes as u32 | COOKED, KNOWN_TEXTS[at].len() as u32);
        bytes += KNOWN_TEXTS[at].len();
        at += 1;
    }
    (spans, bytes)
};

// A search in `Names::known_long` ends at a free entry.
const _: () = {
    let (mut at, mut long) = (0, 0);
    while at < KNOWN_TEXTS.len() {
        if matches!(KNOWN_TEXTS[at].len(), 16..=32) {
            long += 1;
        }
        at += 1;
    }
    assert!(long * 2 <= 1 << KNOWN_LONG_BITS);
};

/// The tables of one thread.
pub(crate) struct Names {
    short: Box<[Short; 1 << SHORT_BITS]>,
    long: Box<[Long; 1 << LONG_BITS]>,
    /// The file's own atoms of all other texts, and of those that found no place above.
    other: Table,
    /// The bits of a place in `short` and in `long` that count: only the start of a table is in use
    /// for a file that is small, so that little memory is touched.
    short_mask: usize,
    long_mask: usize,
    /// `Intern::number` of the interner that the atoms are of.
    of: u64,
    is_own: bool,
    /// By atom of a file that has its own, where its text starts, and its length.
    spans: Vec<(u32, u32)>,
    /// `KNOWN_TEXTS`, and the texts that are not written in the source as they are.
    cooked: Vec<u8>,
    /// `hir::FileIn::mentioned` of the file, if the atoms are its own.
    mentioned: [u64; MENTIONED_WORDS],
    /// Which of `KNOWN_TEXTS` are in the file, likewise.
    known_in_file: [u64; KNOWN_TEXTS.len().div_ceil(64)],
    /// The keywords, and the short ones of `KNOWN_TEXTS`: the padded bytes, the atom if its number
    /// is fixed, and the token kind. An entry without bytes is free.
    known: Box<[([u64; 2], u32, T); 1 << KNOWN_BITS]>,
    /// Those of 16 to 32 bytes.
    known_long: Box<[Long; 1 << KNOWN_LONG_BITS]>,
    /// The others.
    known_others: Vec<(&'static [u8], u32)>,
    late: Late,
}

// All bytes of these are zero, so a table is filled with them fast.
const NO_SHORT: Short = Short {
    words: [0; 2],
    atom: 0,
    kind: T::Eof,
};
const NO_LONG: Long = Long {
    words: [0; 4],
    atom: 0,
    len: 0,
};

fn boxed<E: Copy, const N: usize>(entry: E) -> Box<[E; N]> {
    match vec![entry; N].into_boxed_slice().try_into() {
        Ok(array) => array,
        Err(_) => unreachable!(),
    }
}

impl Default for Names {
    fn default() -> Self {
        let mut known = boxed(([0; 2], u32::MAX, T::Identifier));
        let mut known_long = boxed(NO_LONG);
        let mut known_others = Vec::new();
        let with_numbers = KNOWN_TEXTS
            .iter()
            .zip(0u32..)
            .map(|(&text, atom)| (text, atom));
        let keywords = KEYWORDS.iter().map(|&(text, _)| (text, u32::MAX));
        for (text, atom) in with_numbers.chain(keywords) {
            if let (16..=32, Some(words)) = (text.len(), long_words(text)) {
                let mut at = long_place(words) >> (LONG_BITS - KNOWN_LONG_BITS);
                while known_long[at].len != 0 {
                    at = (at + 1) % known_long.len();
                }
                known_long[at] = Long {
                    words,
                    atom,
                    len: text.len() as u8,
                };
                continue;
            }
            if !is_short(text) {
                known_others.push((text, atom));
                continue;
            }
            let words = padded(text);
            let mut at = known_place(words);
            while known[at].0 != [0; 2] && known[at].0 != words {
                at = (at + 1) % known.len();
            }
            // A keyword whose number is fixed is there already.
            if known[at].0 != words {
                known[at] = (words, atom, keyword(text));
            }
        }
        Names {
            short: boxed(NO_SHORT),
            long: boxed(NO_LONG),
            other: Table::default(),
            short_mask: (1 << SHORT_BITS) - 1,
            long_mask: (1 << LONG_BITS) - 1,
            of: 0,
            is_own: false,
            spans: KNOWN_SPANS.0.to_vec(),
            cooked: KNOWN_TEXTS.concat(),
            mentioned: [0; MENTIONED_WORDS],
            known_in_file: Default::default(),
            known,
            known_long,
            known_others,
            late: Late::default(),
        }
    }
}

const MULTIPLIER: u64 = 0x9E37_79B9_7F4A_7C15;

/// By the number of bytes, masks for the leading bytes of two little endian words.
const LEADING: [[u64; 2]; 16] = {
    let mut masks = [[0; 2]; 16];
    let mut len = 0;
    while len < 8 {
        masks[len] = [(1u64 << (len * 8)) - 1, 0];
        masks[len + 8] = [u64::MAX, (1u64 << (len * 8)) - 1];
        len += 1;
    }
    masks
};

/// The first `len` bytes of `chunk` padded with zeros. `len` is less than 16.
#[inline(always)]
pub(crate) fn short_words(chunk: &[u8; 16], len: u32) -> [u64; 2] {
    let (low, high) = chunk.split_at(8);
    let low = u64::from_le_bytes(low.try_into().unwrap_or_default());
    let high = u64::from_le_bytes(high.try_into().unwrap_or_default());
    let masks = LEADING[(len & 15) as usize];
    [low & masks[0], high & masks[1]]
}

#[inline(always)]
fn short_hash(words: [u64; 2]) -> u64 {
    (words[0] ^ words[1].rotate_left(29)).wrapping_mul(MULTIPLIER)
}

#[inline(always)]
fn short_place(words: [u64; 2]) -> usize {
    const { assert!(1 << SHORT_BITS == bun_sema::hir::MENTIONED_BITS) };
    mention_bit_of(words, 0) as usize
}

#[inline(always)]
fn known_place(words: [u64; 2]) -> usize {
    (short_hash(words) >> (64 - KNOWN_BITS)) as usize
}

/// Whether `Short` can hold `text`.
#[inline]
fn is_short(text: &[u8]) -> bool {
    matches!(text.len(), 1..=15) && text.last() != Some(&0)
}

/// `text`, which is short, padded with zeros.
#[inline]
fn padded(text: &[u8]) -> [u64; 2] {
    [word(text, 0), word(text, 8)]
}

/// The first and the last 16 bytes of `text`, which has at least 16.
#[inline(always)]
fn long_words(text: &[u8]) -> Option<[u64; 4]> {
    let (first, last) = (text.first_chunk::<16>()?, text.last_chunk::<16>()?);
    let word = |bytes: &[u8]| u64::from_le_bytes(bytes.try_into().unwrap_or_default());
    Some([
        word(&first[..8]),
        word(&first[8..]),
        word(&last[..8]),
        word(&last[8..]),
    ])
}

#[inline(always)]
fn long_place(words: [u64; 4]) -> usize {
    let mixed = (words[0] ^ words[1].rotate_left(29)).wrapping_mul(MULTIPLIER)
        ^ (words[2] ^ words[3].rotate_left(29));
    (mixed.wrapping_mul(MULTIPLIER) >> (64 - LONG_BITS)) as usize
}

fn hash_of(text: &[u8]) -> u32 {
    let (whole, rest) = text.as_chunks::<8>();
    let mut hash = text.len() as u64;
    for bytes in whole {
        hash = (hash.rotate_left(5) ^ u64::from_le_bytes(*bytes)).wrapping_mul(MULTIPLIER);
    }
    hash = (hash.rotate_left(5) ^ word(rest, 0)).wrapping_mul(MULTIPLIER);
    (hash >> 32) as u32
}

/// A text, and the source of the file that is being parsed.
#[derive(Copy, Clone)]
pub(crate) struct Text<'a> {
    source: &'a [u8],
    /// Where the text starts in the source, if it is written there as it is.
    start: Option<u32>,
    text: &'a [u8],
}

impl<'a> Text<'a> {
    #[inline(always)]
    pub(crate) fn of_source(source: &'a [u8], start: usize, end: usize) -> Self {
        Text {
            source,
            start: Some(start as u32),
            text: source.get(start..end).unwrap_or_default(),
        }
    }

    #[inline(always)]
    pub(crate) fn elsewhere(source: &'a [u8], text: &'a [u8]) -> Self {
        Text {
            source,
            start: None,
            text,
        }
    }
}

impl Names {
    /// Before a file is parsed whose atoms are those of `atoms`.
    pub(crate) fn belong_to(&mut self, atoms: &dyn Intern) {
        if self.of != atoms.number() {
            self.short.fill(NO_SHORT);
            self.long.fill(NO_LONG);
            self.of = atoms.number();
            self.is_own = false;
            self.short_mask = self.short.len() - 1;
            self.long_mask = self.long.len() - 1;
        }
    }

    /// Before a file of `len` bytes is parsed that has its own atoms.
    pub(crate) fn begin_own(&mut self, len: usize) {
        // A place in `short` for every 8 bytes of the text.
        let bits = (len / 8)
            .next_power_of_two()
            .trailing_zeros()
            .clamp(8, SHORT_BITS);
        self.short_mask = (1 << bits) - 1;
        self.long_mask = self.short_mask >> (SHORT_BITS - LONG_BITS);
        self.short[..=self.short_mask].fill(NO_SHORT);
        self.long[..=self.long_mask].fill(NO_LONG);
        self.of = bun_sema::atom::next_interner_number();
        self.is_own = true;
        self.spans.clear();
        self.spans.extend_from_slice(&KNOWN_SPANS.0);
        self.cooked.truncate(KNOWN_SPANS.1);
        self.other.clear();
        self.mentioned = [0; MENTIONED_WORDS];
        self.known_in_file = Default::default();
    }

    #[inline(always)]
    pub(crate) fn is_own(&self) -> bool {
        self.is_own
    }

    /// `hir::FileIn::mentioned`
    pub(crate) fn mentioned(&self) -> &[u64] {
        match self.is_own {
            true => &self.mentioned,
            false => &[],
        }
    }

    /// The atom of a text that is in no table yet. `bit`: its `hir::mention_bit`. `known`: its
    /// number if that is fixed.
    #[inline]
    fn new_atom(
        &mut self,
        text: Text<'_>,
        bit: usize,
        known: Option<u32>,
        atoms: &dyn Intern,
    ) -> Atom {
        match (self.is_own, known, text.start) {
            (true, None, Some(start)) => {
                self.mention(text.text, bit);
                self.spans.push((start, text.text.len() as u32));
                Atom(self.spans.len() as u32 - 1)
            }
            _ => self.new_atom_in_general(text, bit, known, atoms),
        }
    }

    #[inline(never)]
    fn new_atom_in_general(
        &mut self,
        text: Text<'_>,
        bit: usize,
        known: Option<u32>,
        atoms: &dyn Intern,
    ) -> Atom {
        if !self.is_own {
            return atoms.intern(text.text);
        }
        self.mention(text.text, bit);
        if let Some(known) = known {
            self.known_in_file[known as usize / 64] |= 1 << (known % 64);
            if let (Some(start), Some(span)) = (text.start, self.spans.get_mut(known as usize)) {
                span.0 = start;
            }
            return Atom(known);
        }
        let start = text.start.unwrap_or_else(|| {
            let start = self.cooked.len() as u32;
            self.cooked.extend_from_slice(text.text);
            start | COOKED
        });
        self.spans.push((start, text.text.len() as u32));
        Atom(self.spans.len() as u32 - 1)
    }

    /// Enters `text` in `mentioned`. `bit`: its `hir::mention_bit`.
    #[inline]
    fn mention(&mut self, text: &[u8], bit: usize) {
        self.mentioned[bit / 64 % MENTIONED_WORDS] |= 1 << (bit % 64);
        if let [b'u', b's', b'e', rest @ ..] = text
            && matches!(rest.first(), None | Some(b'A'..=b'Z' | b'0'..=b'9'))
        {
            const BIT: usize = bun_sema::hir::MENTION_OF_A_HOOK as usize;
            self.mentioned[BIT / 64] |= 1 << (BIT % 64);
        }
    }

    /// The number of `text` if it is fixed.
    fn known(&self, text: &[u8]) -> Option<u32> {
        if is_short(text) {
            return self.known_short(padded(text)).0;
        }
        if let (16..=32, Some(words)) = (text.len(), long_words(text)) {
            return self.known_long(words, long_place(words), text.len());
        }
        self.known_other(text)
    }

    fn known_other(&self, text: &[u8]) -> Option<u32> {
        let found = self.known_others.iter().find(|it| it.0 == text);
        found.map(|it| it.1).filter(|&atom| atom != u32::MAX)
    }

    /// The number of the text of `len` bytes, 16 to 32, with the words `words` if it is fixed.
    /// `place`: their `long_place`.
    #[inline]
    fn known_long(&self, words: [u64; 4], place: usize, len: usize) -> Option<u32> {
        let mut at = place >> (LONG_BITS - KNOWN_LONG_BITS);
        loop {
            let entry = &self.known_long[at];
            if entry.len == 0 {
                return None;
            }
            if entry.is(words, len) {
                return (entry.atom != u32::MAX).then_some(entry.atom);
            }
            at = (at + 1) % self.known_long.len();
        }
    }

    /// The number of the text with the padded bytes `words` if it is fixed, and its token kind.
    #[inline]
    fn known_short(&self, words: [u64; 2]) -> (Option<u32>, T) {
        let mut at = known_place(words);
        loop {
            match self.known[at] {
                ([0, 0], ..) => return (None, T::Identifier),
                (known, atom, kind) if known == words => {
                    return ((atom != u32::MAX).then_some(atom), kind);
                }
                _ => at = (at + 1) % self.known.len(),
            }
        }
    }

    /// The atom and the token kind of the name with the padded bytes `words`, if it is at its first
    /// place.
    #[inline(always)]
    pub(crate) fn find_short(&self, words: [u64; 2]) -> Option<(Atom, T)> {
        let entry = &self.short[short_place(words) & self.short_mask];
        (entry.words == words).then_some((Atom(entry.atom), entry.kind))
    }

    /// The same if it is not, for the name of `len` bytes at `start` in `source`.
    #[inline]
    pub(crate) fn short_name_elsewhere(
        &mut self,
        words: [u64; 2],
        source: &[u8],
        (start, len): (usize, u32),
        atoms: &dyn Intern,
    ) -> (Atom, T) {
        let bit = short_place(words);
        let at = bit & self.short_mask;
        // Mostly the file has not had the name yet, and its place is free.
        if self.is_own
            && self.short[at].words == [0; 2]
            && let (None, kind) = self.known_short(words)
        {
            self.mention(&words[0].to_le_bytes()[..(len as usize).min(8)], bit);
            self.spans.push((start as u32, len));
            let atom = self.spans.len() as u32 - 1;
            self.short[at] = Short { words, atom, kind };
            return (Atom(atom), kind);
        }
        let text = Text::of_source(source, start, start + len as usize);
        self.short_elsewhere(words, text, atoms)
    }

    /// The same if it is not.
    pub(crate) fn short_elsewhere(
        &mut self,
        words: [u64; 2],
        text: Text<'_>,
        atoms: &dyn Intern,
    ) -> (Atom, T) {
        let bit = short_place(words);
        let (first, mask) = (bit & self.short_mask, self.short_mask);
        let mut free = None;
        for at in (first..first + WINDOW).map(|at| at & mask) {
            let entry = &self.short[at];
            if entry.words == [0; 2] {
                free = Some(at);
                break;
            }
            if entry.words == words {
                return (Atom(entry.atom), entry.kind);
            }
        }
        let (known, kind) = self.known_short(words);
        let at = match free {
            Some(at) => at,
            None if self.is_own => return (self.other(text, atoms), kind),
            None => first,
        };
        // `short_place` is `hir::mention_bit_of`.
        let atom = self.new_atom(text, bit, known, atoms);
        self.short[at] = Short {
            words,
            atom: atom.0,
            kind,
        };
        (atom, kind)
    }

    /// The atom of any text: a name of any length, the value of a string.
    #[inline]
    pub(crate) fn atom(&mut self, text: Text<'_>, atoms: &dyn Intern) -> Atom {
        match text.text.len() {
            _ if is_short(text.text) => {
                let words = padded(text.text);
                match self.find_short(words) {
                    Some((atom, _)) => atom,
                    None => self.short_elsewhere(words, text, atoms).0,
                }
            }
            16..=32 => self.long(text, atoms),
            _ => self.other(text, atoms),
        }
    }

    /// The atom of a text of 16 to 32 bytes.
    #[inline]
    pub(crate) fn long(&mut self, text: Text<'_>, atoms: &dyn Intern) -> Atom {
        if let Some(words) = long_words(text.text) {
            let entry = &self.long[long_place(words) & self.long_mask];
            if entry.is(words, text.text.len()) {
                return Atom(entry.atom);
            }
        }
        self.long_elsewhere(text, atoms)
    }

    /// The same if it is not at its first place.
    #[inline(never)]
    fn long_elsewhere(&mut self, text: Text<'_>, atoms: &dyn Intern) -> Atom {
        let Some(words) = long_words(text.text) else {
            return self.other(text, atoms);
        };
        let place = long_place(words);
        let (first, mask) = (place & self.long_mask, self.long_mask);
        let mut free = None;
        for at in (first..first + WINDOW).map(|at| at & mask) {
            let entry = &self.long[at];
            if entry.len == 0 {
                free = Some(at);
                break;
            }
            if entry.is(words, text.text.len()) {
                return Atom(entry.atom);
            }
        }
        let at = match free {
            Some(at) => at,
            None if self.is_own => return self.other(text, atoms),
            None => first,
        };
        let bit = mention_bit_of([words[0], words[1]], text.text.len()) as usize;
        let known = self.known_long(words, place, text.text.len());
        let atom = self.new_atom(text, bit, known, atoms);
        self.long[at] = Long {
            words,
            atom: atom.0,
            len: text.text.len() as u8,
        };
        atom
    }

    /// The atom of a text that `short` and `long` do not hold.
    pub(crate) fn other(&mut self, text: Text<'_>, atoms: &dyn Intern) -> Atom {
        if !self.is_own {
            return atoms.intern(text.text);
        }
        let hash = hash_of(text.text);
        let found = (self.other).find(hash, |atom| {
            self.bytes(Atom(atom), text.source) == text.text
        });
        if let Some(atom) = found {
            return Atom(atom);
        }
        let bit = match long_words(text.text) {
            Some(words) => mention_bit_of([words[0], words[1]], text.text.len()),
            None => bun_sema::hir::mention_bit(text.text),
        };
        let atom = self.new_atom(text, bit as usize, self.known(text.text), atoms);
        self.other.insert(hash, atom.0);
        atom
    }

    /// The text of `atom`, which is the own of the file with the text `source`.
    pub(crate) fn bytes<'a>(&'a self, atom: Atom, source: &'a [u8]) -> &'a [u8] {
        let Some(&(start, len)) = self.spans.get(atom.0 as usize) else {
            return match atom.0.checked_sub(NOT_IN_THE_FILE) {
                Some(late) => self.late.bytes(late),
                None => b"",
            };
        };
        let (from, start) = match start & COOKED != 0 {
            true => (&self.cooked[..], (start & !COOKED) as usize),
            false => (source, start as usize),
        };
        from.get(start..start + len as usize).unwrap_or_default()
    }

    /// The atom of `text` if it is in the file with the text `source`, whose atoms are its own.
    /// `Err`: it is not, with its number if that is fixed.
    fn find(&self, text: &[u8], source: &[u8]) -> Result<Atom, Option<u32>> {
        let known = if is_short(text) {
            let words = padded(text);
            let known = self.known_short(words).0;
            if known.is_none() {
                let (first, mask) = (short_place(words) & self.short_mask, self.short_mask);
                for at in (first..first + WINDOW).map(|at| at & mask) {
                    let entry = &self.short[at];
                    if entry.words == [0; 2] {
                        return Err(None);
                    }
                    if entry.words == words {
                        return Ok(Atom(entry.atom));
                    }
                }
            }
            known
        } else if let (16..=32, Some(words)) = (text.len(), long_words(text)) {
            let place = long_place(words);
            let known = self.known_long(words, place, text.len());
            if known.is_none() {
                let (first, mask) = (place & self.long_mask, self.long_mask);
                for at in (first..first + WINDOW).map(|at| at & mask) {
                    let entry = &self.long[at];
                    if entry.len == 0 {
                        return Err(None);
                    }
                    if entry.is(words, text.len()) {
                        return Ok(Atom(entry.atom));
                    }
                }
            }
            known
        } else {
            self.known_other(text)
        };
        if let Some(known) = known {
            let word = self.known_in_file[known as usize / 64];
            return match word >> (known % 64) & 1 != 0 {
                true => Ok(Atom(known)),
                false => Err(Some(known)),
            };
        }
        (self.other)
            .find(hash_of(text), |atom| self.bytes(Atom(atom), source) == text)
            .map(Atom)
            .ok_or(None)
    }

    /// The atoms of the file with the text `source`, which was parsed last and has its own.
    pub(crate) fn of_file<'a>(&'a self, source: &'a [u8]) -> FileAtoms<'a> {
        FileAtoms {
            names: self,
            source,
        }
    }
}

/// From the hash of a text to a number, for texts that are kept elsewhere. It grows.
#[derive(Default)]
struct Table {
    /// Their number is a power of two, or 0. At most half of them are taken.
    slots: Vec<Slot>,
    taken: usize,
    /// A slot of another generation is free. Never 0 once there are slots.
    generation: u16,
}

#[derive(Copy, Clone, Default)]
struct Slot {
    hash: u32,
    number: u32,
    generation: u16,
}

impl Table {
    fn clear(&mut self) {
        self.taken = 0;
        self.generation = match self.generation.checked_add(1) {
            Some(next) => next,
            None => {
                self.slots.fill(Slot::default());
                1
            }
        };
    }

    #[inline]
    fn find(&self, hash: u32, mut is_it: impl FnMut(u32) -> bool) -> Option<u32> {
        let mask = self.slots.len().checked_sub(1)?;
        let mut at = hash as usize & mask;
        loop {
            let slot = self.slots[at];
            if slot.generation != self.generation {
                return None;
            }
            if slot.hash == hash && is_it(slot.number) {
                return Some(slot.number);
            }
            at = (at + 1) & mask;
        }
    }

    /// `number` is that of a text with the hash `hash`, which is not in the table.
    fn insert(&mut self, hash: u32, number: u32) {
        if self.generation == 0 {
            self.generation = 1;
        }
        if (self.taken + 1) * 2 > self.slots.len() {
            let old = std::mem::take(&mut self.slots);
            self.slots = vec![Slot::default(); (old.len() * 2).max(256)];
            let generation = self.generation;
            for slot in old.iter().filter(|it| it.generation == generation) {
                self.put(*slot);
            }
        }
        self.taken += 1;
        self.put(Slot {
            hash,
            number,
            generation: self.generation,
        });
    }

    fn put(&mut self, slot: Slot) {
        let mask = self.slots.len() - 1;
        let mut at = slot.hash as usize & mask;
        while self.slots[at].generation == self.generation {
            at = (at + 1) & mask;
        }
        self.slots[at] = slot;
    }
}

/// The texts that are asked about and are not in the file at hand: the names that a rule of a
/// linter looks for. They stay from file to file, and are entered while others are read.
#[derive(Default)]
struct Late {
    numbers: Guarded<Table>,
    texts: Chunk,
}

/// A list that grows while its elements are borrowed. Each chunk has twice the room of the one
/// before it, so that few are passed on the way to an element.
struct Chunk {
    texts: Box<[OnceLock<Box<[u8]>>]>,
    next: OnceLock<Box<Chunk>>,
}

impl Chunk {
    fn with_room(room: usize) -> Self {
        Chunk {
            texts: (0..room).map(|_| OnceLock::new()).collect(),
            next: OnceLock::new(),
        }
    }
}

impl Default for Chunk {
    fn default() -> Self {
        Chunk::with_room(64)
    }
}

impl Late {
    fn place(&self, number: u32) -> &OnceLock<Box<[u8]>> {
        let (mut chunk, mut number) = (&self.texts, number as usize);
        while number >= chunk.texts.len() {
            let room = chunk.texts.len();
            number -= room;
            chunk = chunk
                .next
                .get_or_init(|| Box::new(Chunk::with_room(room * 2)));
        }
        &chunk.texts[number]
    }

    fn bytes(&self, number: u32) -> &[u8] {
        let (mut chunk, mut number) = (&self.texts, number as usize);
        while number >= chunk.texts.len() {
            number -= chunk.texts.len();
            match chunk.next.get() {
                Some(next) => chunk = next,
                None => return b"",
            }
        }
        chunk.texts[number].get().map_or(b"", |text| text)
    }

    fn intern(&self, text: &[u8]) -> u32 {
        let hash = hash_of(text);
        let mut numbers = self.numbers.lock();
        if let Some(number) = numbers.find(hash, |number| self.bytes(number) == text) {
            return number;
        }
        let number = numbers.taken as u32;
        let _ = self.place(number).set(text.into());
        numbers.insert(hash, number);
        number
    }
}

/// The atoms of a file that has its own. It is as if an interner had seen the texts of the file.
/// What it is asked for from now on is numbered from `NOT_IN_THE_FILE`.
pub struct FileAtoms<'a> {
    names: &'a Names,
    source: &'a [u8],
}

// Called through `dyn Intern`. With `#[inline]` each crate that makes the table would have its copy.
impl Intern for FileAtoms<'_> {
    fn intern(&self, text: &[u8]) -> Atom {
        match self.names.find(text, self.source) {
            Ok(atom) => atom,
            Err(Some(known)) => Atom(known),
            Err(None) => Atom(NOT_IN_THE_FILE + self.names.late.intern(text)),
        }
    }

    fn find(&self, text: &[u8]) -> Option<Atom> {
        self.names.find(text, self.source).ok()
    }

    fn bytes(&self, atom: Atom) -> &[u8] {
        self.names.bytes(atom, self.source)
    }

    fn number(&self) -> u64 {
        self.names.of
    }

    fn of_this_thread(&self) -> &dyn Intern {
        self
    }

    fn own_texts(&self) -> OwnTexts<'_> {
        OwnTexts::new(&self.names.spans, self.source)
    }
}

/// Stands where an interner is expected and the atoms are the file's own.
pub(crate) struct NoInterner;

impl Intern for NoInterner {
    fn intern(&self, _: &[u8]) -> Atom {
        Atom::NONE
    }
    fn find(&self, _: &[u8]) -> Option<Atom> {
        None
    }
    fn bytes(&self, _: Atom) -> &[u8] {
        b""
    }
    fn number(&self) -> u64 {
        0
    }
    fn of_this_thread(&self) -> &dyn Intern {
        self
    }
}
