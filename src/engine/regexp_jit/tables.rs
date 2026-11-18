//! Data that the code reads. It is not in executable memory.

use bun_engine_regexp::set::{Latin1Set, LookupTable, Set};
use smallvec::SmallVec;

const BLOCK: usize = 256;
const VECTORS: usize = 12;

#[derive(Default)]
pub struct Tables {
    #[expect(clippy::vec_box, reason = "the code has the addresses")]
    blocks: Vec<Box<[u8; BLOCK]>>,
    words: Vec<Box<[u16]>>,
    lookups: Vec<LookupTable>,
    vectors: SmallVec<[Box<[u128]>; 1]>,
    /// In the last of them.
    vectors_taken: usize,
    /// The block whose bits are being given out, and how many are taken.
    membership: Option<(usize, u8)>,
    size: usize,
}

/// A character is a member if that bit is set in its byte.
#[derive(Clone, Copy)]
pub(crate) struct Membership {
    pub(crate) address: usize,
    pub(crate) bit: u8,
}

/// See [`LookupTable`].
#[derive(Clone, Copy)]
pub(crate) struct Lookup {
    pub(crate) index: usize,
    pub(crate) words: usize,
    pub(crate) limit: u32,
    pub(crate) contains_beyond_limit: bool,
}

impl From<&LookupTable> for Lookup {
    fn from(table: &LookupTable) -> Lookup {
        Lookup {
            index: table.index().as_ptr().expose_provenance(),
            words: table.words().as_ptr().expose_provenance(),
            limit: table.limit(),
            contains_beyond_limit: table.contains_beyond_limit(),
        }
    }
}

const fn ranges(ranges: &[(u8, u8)]) -> Latin1Set {
    let (mut set, mut index) = (Latin1Set::EMPTY, 0);
    while index < ranges.len() {
        set.insert_range(ranges[index].0, ranges[index].1);
        index += 1;
    }
    set
}

const DIGITS: (u8, u8) = (b'0', b'9');
const UPPER: (u8, u8) = (b'A', b'Z');
const LOWER: (u8, u8) = (b'a', b'z');
const LOW_LINE: (u8, u8) = (b'_', b'_');

const COMMON_SETS: [Latin1Set; 8] = [
    ranges(&[DIGITS, UPPER, LOW_LINE, LOWER]),
    Latin1Set::of(b"\t\n\x0b\x0c\r \xa0"),
    ranges(&[DIGITS, UPPER, LOWER]),
    ranges(&[DIGITS, (b'A', b'F'), (b'a', b'f')]),
    ranges(&[(b'-', b'-'), DIGITS, UPPER, LOW_LINE, LOWER]),
    ranges(&[(b'$', b'$'), DIGITS, UPPER, LOW_LINE, LOWER]),
    ranges(&[(b'-', b'.'), DIGITS, UPPER, LOW_LINE, LOWER]),
    ranges(&[DIGITS, LOWER]),
];

static COMMON_MEMBERSHIP: [u8; BLOCK] = {
    let (mut bytes, mut c) = ([0; BLOCK], 0);
    while c < BLOCK {
        let mut bit = 0;
        while bit < COMMON_SETS.len() {
            bytes[c] |= (COMMON_SETS[bit].contains(c as u8) as u8) << bit;
            bit += 1;
        }
        c += 1;
    }
    bytes
};

impl Tables {
    /// The bytes of memory that they hold.
    pub fn size(&self) -> usize {
        self.size
    }

    /// For the set or, if the second result says so, for its complement.
    pub(crate) fn membership(&mut self, set: &Latin1Set) -> (Membership, bool) {
        for (candidate, is_inverted) in [(*set, false), (!*set, true)] {
            if let Some(bit) = COMMON_SETS.iter().position(|it| *it == candidate) {
                let membership = Membership {
                    address: COMMON_MEMBERSHIP.as_ptr().expose_provenance(),
                    bit: 1 << bit,
                };
                return (membership, is_inverted);
            }
        }
        let (block, taken) = match self.membership {
            Some((block, taken @ ..8)) => (block, taken),
            _ => {
                self.blocks.push(Box::new([0; BLOCK]));
                self.size += BLOCK;
                (self.blocks.len() - 1, 0)
            }
        };
        self.membership = Some((block, taken + 1));
        let bytes = &mut self.blocks[block];
        for (bytes, word) in bytes.as_chunks_mut::<64>().0.iter_mut().zip(set.words()) {
            for (index, byte) in bytes.iter_mut().enumerate() {
                *byte |= ((word >> index & 1) as u8) << taken;
            }
        }
        let membership = Membership {
            address: bytes.as_ptr().expose_provenance(),
            bit: 1 << taken,
        };
        (membership, false)
    }

    /// Answers for the characters above U+00FF up to `max`, and for the others if the second result says so.
    pub(crate) fn lookup(&mut self, set: &Set, max: u32) -> Option<(Lookup, bool)> {
        if let Some(shared) = set.shared() {
            return Some((shared.table().into(), shared.latin1() == set.latin1()));
        }
        let table = set.build_table(max).ok()?;
        let lookup = Lookup::from(&table);
        self.size += size_of_val(table.index()) + size_of_val(table.words());
        self.lookups.push(table);
        Some((lookup, true))
    }

    /// Returns the address of the first.
    pub(crate) fn add_vectors(&mut self, new: impl ExactSizeIterator<Item = u128>) -> usize {
        let room = self.vectors.last().map_or(0, |it| it.len());
        if self.vectors_taken + new.len() > room {
            let length = new.len().max(VECTORS);
            self.vectors.push(vec![0; length].into_boxed_slice());
            (self.vectors_taken, self.size) = (0, self.size + length * size_of::<u128>());
        }
        let last = self.vectors.last_mut().map_or_default(|it| &mut **it);
        let free = &mut last[self.vectors_taken..];
        self.vectors_taken += new.len();
        free.iter_mut().zip(new).for_each(|(it, new)| *it = new);
        free.as_ptr().expose_provenance()
    }

    pub(crate) fn add_words(&mut self, words: Box<[u16]>) -> usize {
        let address = words.as_ptr().expose_provenance();
        self.size += size_of_val(&*words);
        self.words.push(words);
        address
    }
}
