//! Each string once, for one payload or for many.
//!
//! A table is the number of strings, where each starts and where the last ends, and the characters.

use core::cell::OnceCell;

use bun_engine_text::{Atom, StringRef, Text};
use hashbrown::HashTable;
use smallvec::SmallVec;

use super::Payload;
use super::format::{put_units, spread};
use crate::bytes::{Reader, Sink};
use crate::code::TooLarge;

const IS_WIDE: u32 = 1 << 31;
const ATOMS_PER_PAGE: usize = 128;

/// What an order file calls a string: FNV-1a of its code units, mixed. Never one of the two highest values.
pub fn order_hash(text: Text<'_>) -> u64 {
    let bytes = text.code_units().flat_map(u16::to_le_bytes);
    let mut hash = bytes.fold(0xcbf2_9ce4_8422_2325, |hash: u64, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3)
    });
    for factor in [0xff51_afd7_ed55_8ccd, 0xc4ce_b9fe_1a85_ec53] {
        hash = (hash ^ hash >> 33).wrapping_mul(factor);
    }
    (hash ^ hash >> 33).min(u64::MAX - 2)
}

#[derive(Clone, Copy, Default)]
struct Added {
    start: u32,
    end: u32,
    is_wide: bool,
}

#[derive(Default)]
pub struct StringTableBuilder {
    characters: Sink<u8>,
    /// By ordinal. Empty for a hot string that has not come up.
    strings: Sink<Added>,
    /// The hash of the text and the ordinal.
    ordinals: HashTable<(u32, u32)>,
    hot_ordinals: HashTable<(u64, u32)>,
    is_out_of_memory: bool,
}

impl StringTableBuilder {
    /// The strings with these values of [`order_hash`] come first, in this order.
    pub fn new(hot: &[u64]) -> StringTableBuilder {
        let mut builder = StringTableBuilder::default();
        for &hash in hot {
            let entry = (builder.hot_ordinals).entry(hash, |it| it.0 == hash, |it| it.0);
            entry.or_insert_with(|| {
                builder.strings.push(Added::default());
                (hash, builder.strings.len() as u32 - 1)
            });
        }
        builder
    }

    pub(super) fn check(&self) -> Result<(), TooLarge> {
        self.characters.check()?;
        self.strings.check()?;
        (!self.is_out_of_memory).ok_or(TooLarge)
    }

    /// `text` is not empty and `hash` is `text.hash()`.
    pub(super) fn ordinal(&mut self, text: Text<'_>, hash: u32) -> u32 {
        let start = self.characters.len();
        let is_wide = put_units(&mut self.characters, text);
        let (known, new) = self.characters.split_at(start);
        let same = self
            .ordinals
            .find(spread(hash.into()), |&(other, ordinal)| {
                let added = self.strings[ordinal as usize];
                let units = added.start as usize..added.end as usize;
                other == hash && added.is_wide == is_wide && known[units] == *new
            });
        if let Some(&(_, ordinal)) = same {
            self.characters.truncate(start);
            return ordinal;
        }
        let ordinal = self.take_hot_ordinal(text).unwrap_or_else(|| {
            self.strings.push(Added::default());
            (self.strings.len() as u32).wrapping_sub(1)
        });
        self.is_out_of_memory |= self
            .ordinals
            .try_reserve(1, |it| spread(it.0.into()))
            .is_err();
        if self.check().is_err() {
            return 0;
        }
        self.strings[ordinal as usize] = Added {
            start: start as u32,
            end: self.characters.len() as u32,
            is_wide,
        };
        (self.ordinals).insert_unique(spread(hash.into()), (hash, ordinal), |it| {
            spread(it.0.into())
        });
        ordinal
    }

    fn take_hot_ordinal(&mut self, text: Text<'_>) -> Option<u32> {
        if self.hot_ordinals.is_empty() {
            return None;
        }
        let hash = order_hash(text);
        let entry = self.hot_ordinals.find_entry(hash, |it| it.0 == hash).ok()?;
        Some(entry.remove().0.1)
    }

    pub(super) fn size(&self) -> usize {
        size_of::<u32>() * (self.strings.len() + 2) + self.characters.len()
    }

    pub(super) fn write(&self, bytes: &mut Sink<u8>) {
        bytes.fixed(self.strings.len() as u32);
        let mut start = 0;
        for added in &*self.strings {
            bytes.fixed(start | (IS_WIDE * u32::from(added.is_wide)));
            start += added.end - added.start;
        }
        bytes.fixed(start);
        for added in &*self.strings {
            bytes.put(&self.characters[added.start as usize..added.end as usize]);
        }
    }

    /// For [`super::Embedding::strings`].
    pub fn finish(self) -> Result<Vec<u8>, TooLarge> {
        self.check()?;
        let mut bytes = Sink::with_size(self.size())?;
        self.write(&mut bytes);
        bytes.finish()
    }
}

/// Makes the atom for a string when it is first asked for, and keeps it.
pub(super) struct StringTable {
    payload: Payload,
    starts_at: usize,
    count: usize,
    pages: Box<[OnceCell<Box<[OnceCell<Atom>]>>]>,
}

impl StringTable {
    pub(super) fn new(payload: Payload, at: u32) -> Option<StringTable> {
        let mut reader = Reader::new(payload.bytes().get(at as usize..)?);
        let count = reader.fixed()? as usize;
        let mut last = Reader::new(reader.rest().get(count.checked_mul(size_of::<u32>())?..)?);
        (last.fixed()? as usize <= last.rest().len()).then_some(())?;
        let pages = (0..count.div_ceil(ATOMS_PER_PAGE)).map(|_| OnceCell::new());
        Some(StringTable {
            starts_at: at as usize + size_of::<u32>(),
            count,
            pages: pages.collect(),
            payload,
        })
    }

    /// The bytes, out of those of the payload, and whether a unit takes two.
    #[inline]
    fn units<'a>(&self, payload: &'a [u8], ordinal: u32) -> Option<(&'a [u8], bool)> {
        let (starts, characters) =
            payload[self.starts_at..].split_at(size_of::<u32>() * (self.count + 1));
        let starts = starts.as_chunks().0.get(ordinal as usize..)?;
        let [start, end] = starts.first_chunk()?.map(u32::from_le_bytes);
        let units = characters.get((start & !IS_WIDE) as usize..(end & !IS_WIDE) as usize)?;
        Some((units, start & IS_WIDE != 0))
    }

    fn with_text<T>(&self, ordinal: u32, use_text: impl FnOnce(Text<'_>) -> T) -> Option<T> {
        let (units, is_wide) = self.units(self.payload.bytes(), ordinal)?;
        if !is_wide {
            return Some(use_text(Text::Latin1(units)));
        }
        let units = units.as_chunks().0.iter().copied();
        let units: SmallVec<[u16; 32]> = units.map(u16::from_le_bytes).collect();
        Some(use_text(Text::Utf16(&units)))
    }

    fn cell(&self, ordinal: u32) -> Option<&OnceCell<Atom>> {
        let (page, index) = (
            ordinal as usize / ATOMS_PER_PAGE,
            ordinal as usize % ATOMS_PER_PAGE,
        );
        let cells = self.pages.get(page)?.get_or_init(|| {
            let len = ATOMS_PER_PAGE.min(self.count - page * ATOMS_PER_PAGE);
            (0..len).map(|_| OnceCell::new()).collect()
        });
        cells.get(index)
    }

    /// `is_read` is called if it has to be made.
    #[inline]
    pub(super) fn atom(&self, ordinal: u32, is_read: impl FnOnce(Text<'_>)) -> Option<&Atom> {
        let cell = self.cell(ordinal)?;
        cell.get().or_else(|| {
            let atom = self.with_text(ordinal, Atom::new)?;
            is_read(atom.text());
            Some(cell.get_or_init(|| atom))
        })
    }

    /// Makes no atom if the characters can be read where they are.
    pub(super) fn text(&self, ordinal: u32) -> Option<Text<'_>> {
        match self.units(self.payload.bytes(), ordinal)? {
            (units, false) => Some(Text::Latin1(units)),
            (_, true) => self.atom(ordinal, |_| {}).map(|atom| atom.text()),
        }
    }

    /// Does not copy what stays where it is.
    pub(super) fn string(&self, ordinal: u32) -> Option<StringRef> {
        if let Some(payload) = self.payload.static_bytes()
            && let (units, false) = self.units(payload, ordinal)?
        {
            return Some(StringRef::from_lasting_units(units));
        }
        self.with_text(ordinal, StringRef::try_from_text)?.ok()
    }
}
