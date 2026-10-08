//! From the spelling of a name to its atom and its token kind, in one probe.
//!
//! A file repeats the same few hundred names, and the files of a project share most of them. Two
//! direct-mapped caches hold the spelling inline, so a hit touches one cache line and compares
//! integers. A collision overwrites the entry. A miss asks the interner.

use crate::token::{T, keyword};
use bun_sema::atom::{Atom, Intern};

/// A text of at most 15 bytes, padded with zeros. No name contains a zero byte, so the padded
/// bytes determine the length.
#[derive(Copy, Clone)]
struct Short {
    words: [u64; 2],
    atom: u32,
    kind: T,
}

/// A text of 16 to 32 bytes.
#[derive(Copy, Clone)]
struct Long {
    /// The first and the last 16 bytes, which may overlap.
    words: [u64; 4],
    len: u32,
    atom: u32,
}

const SHORT_BITS: u32 = 14;
const LONG_BITS: u32 = 12;

/// The caches of one thread. They belong to one interner at a time.
pub(crate) struct Names {
    short: Box<[Short; 1 << SHORT_BITS]>,
    long: Box<[Long; 1 << LONG_BITS]>,
    /// `Intern::number` of the interner that the atoms are of. 0: none.
    of: u64,
}

const NO_SHORT: Short = Short {
    words: [0; 2],
    atom: u32::MAX,
    kind: T::Identifier,
};
const NO_LONG: Long = Long {
    words: [0; 4],
    len: 0,
    atom: u32::MAX,
};

fn boxed<E: Copy, const N: usize>(entry: E) -> Box<[E; N]> {
    match vec![entry; N].into_boxed_slice().try_into() {
        Ok(array) => array,
        Err(_) => unreachable!(),
    }
}

impl Default for Names {
    fn default() -> Self {
        Names {
            short: boxed(NO_SHORT),
            long: boxed(NO_LONG),
            of: 0,
        }
    }
}

const MULTIPLIER: u64 = 0x9E37_79B9_7F4A_7C15;

/// By the number of bytes, a mask for the leading bytes of a little endian word.
const LEADING: [u64; 16] = {
    let mut masks = [u64::MAX; 16];
    let mut len = 0;
    while len < 8 {
        masks[len] = (1u64 << (len * 8)) - 1;
        len += 1;
    }
    masks
};

/// The first `len` bytes of `word`, which is little endian. `len` is at most 8.
#[inline(always)]
fn leading_bytes(word: u64, len: u32) -> u64 {
    word & LEADING[(len & 15) as usize]
}

/// The first `len` bytes of `chunk` padded with zeros. `len` is at most 16.
#[inline(always)]
pub(crate) fn short_words(chunk: &[u8; 16], len: u32) -> [u64; 2] {
    let (low, high) = chunk.split_at(8);
    let low = u64::from_le_bytes(low.try_into().unwrap_or_default());
    let high = u64::from_le_bytes(high.try_into().unwrap_or_default());
    if len >= 8 {
        [low, leading_bytes(high, len - 8)]
    } else {
        [leading_bytes(low, len), 0]
    }
}

#[inline(always)]
fn short_place(words: [u64; 2]) -> usize {
    let hash = (words[0] ^ words[1].rotate_left(29)).wrapping_mul(MULTIPLIER);
    (hash >> (64 - SHORT_BITS)) as usize
}

/// `text` padded with zeros to `N` words.
#[inline]
fn padded<const N: usize>(text: &[u8]) -> [u64; N] {
    let mut words = [0u64; N];
    let (whole, rest) = text.as_chunks::<8>();
    for (word, bytes) in words.iter_mut().zip(whole) {
        *word = u64::from_le_bytes(*bytes);
    }
    if let Some(word) = words.get_mut(whole.len()) {
        let mut last = [0u8; 8];
        last[..rest.len()].copy_from_slice(rest);
        *word = u64::from_le_bytes(last);
    }
    words
}

impl Names {
    /// Before a file is parsed: `atoms` is the interner of that file.
    pub(crate) fn belong_to(&mut self, atoms: &dyn Intern) {
        if self.of != atoms.number() {
            if self.of != 0 {
                self.short.fill(NO_SHORT);
                self.long.fill(NO_LONG);
            }
            self.of = atoms.number();
        }
    }

    /// The atom and the token kind of the name with the padded bytes `words`, if it is in the cache.
    #[inline(always)]
    pub(crate) fn find_short(&self, words: [u64; 2]) -> Option<(Atom, T)> {
        let entry = &self.short[short_place(words)];
        (entry.words == words).then_some((Atom(entry.atom), entry.kind))
    }

    /// Puts the name `text`, whose padded bytes are `words`, into the cache.
    pub(crate) fn add_short(
        &mut self,
        words: [u64; 2],
        text: &[u8],
        atoms: &dyn Intern,
    ) -> (Atom, T) {
        let (atom, kind) = (atoms.intern(text), keyword(text));
        self.short[short_place(words)] = Short {
            words,
            atom: atom.0,
            kind,
        };
        (atom, kind)
    }

    #[inline]
    fn short_words(&mut self, words: [u64; 2], text: &[u8], atoms: &dyn Intern) -> (Atom, T) {
        match self.find_short(words) {
            Some(found) => found,
            None => self.add_short(words, text, atoms),
        }
    }

    /// The atom of any text: a name of any length, the value of a string.
    #[inline]
    pub(crate) fn atom(&mut self, text: &[u8], atoms: &dyn Intern) -> Atom {
        match text.len() {
            0 => bun_sema::atom::known::empty,
            // Its last byte tells a text from a shorter one that is padded.
            _ if text.last() == Some(&0) => atoms.intern(text),
            1..=15 => self.short_words(padded::<2>(text), text, atoms).0,
            16..=32 => self.long(text, atoms),
            _ => atoms.intern(text),
        }
    }

    /// The atom of a text of 16 to 32 bytes.
    pub(crate) fn long(&mut self, text: &[u8], atoms: &dyn Intern) -> Atom {
        // The first and the last 16 bytes, which may overlap, and the length determine it.
        let (Some(first), Some(last)) = (text.first_chunk::<16>(), text.last_chunk::<16>()) else {
            return atoms.intern(text);
        };
        let word = |bytes: &[u8]| u64::from_le_bytes(bytes.try_into().unwrap_or_default());
        let words = [
            word(&first[..8]),
            word(&first[8..]),
            word(&last[..8]),
            word(&last[8..]),
        ];
        let mixed = (words[0] ^ words[1].rotate_left(29)).wrapping_mul(MULTIPLIER)
            ^ (words[2] ^ words[3].rotate_left(29));
        let hash = mixed.wrapping_mul(MULTIPLIER);
        let entry = &mut self.long[(hash >> (64 - LONG_BITS)) as usize];
        if entry.words == words && entry.len == text.len() as u32 {
            return Atom(entry.atom);
        }
        let atom = atoms.intern(text);
        *entry = Long {
            words,
            len: text.len() as u32,
            atom: atom.0,
        };
        atom
    }
}
