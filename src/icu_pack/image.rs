//! Writes resources as `.res` files have them, but without a header and keys. All offsets count from the start of the image.

use crate::keys::{Keys, longest_with_suffix};
use crate::resb::{Res, read_image};
use std::collections::{BTreeMap, BTreeSet};

const BINARY: u32 = 1;
const TABLE: u32 = 2;
const ALIAS: u32 = 3;
const TABLE16: u32 = 5;
const STRING_V2: u32 = 6;
const INT: u32 = 7;
const ARRAY: u32 = 8;
const ARRAY16: u32 = 9;
const INT_VECTOR: u32 = 14;

struct Image<'r, 'a> {
    keys: &'r Keys<'a>,
    bytes: Vec<u8>,
    /// What strings without a length can be the end of.
    owners: BTreeMap<&'r [u16], &'r [u16]>,
    strings: BTreeMap<&'r [u16], u32>,
    written: BTreeMap<&'r Res<'a>, u32>,
}

fn collect_strings<'r>(res: &'r Res, strings: &mut Vec<&'r [u16]>) {
    match res {
        Res::String(text) => strings.push(text),
        Res::Array(items) => items.iter().for_each(|it| collect_strings(it, strings)),
        Res::Table(items) => items.iter().for_each(|it| collect_strings(&it.1, strings)),
        _ => {}
    }
}

fn needs_length(text: &[u16]) -> bool {
    text.len() > 40 || matches!(text, [0xdc00..0xe000, ..]) || text.contains(&0)
}

impl<'r, 'a> Image<'r, 'a> {
    fn push16(&mut self, units: impl IntoIterator<Item = u16>) {
        (self.bytes).extend(units.into_iter().flat_map(u16::to_le_bytes));
    }

    fn push32(&mut self, words: impl IntoIterator<Item = u32>) {
        (self.bytes).extend(words.into_iter().flat_map(u32::to_le_bytes));
    }

    /// Returns the offset in units of `size` bytes.
    fn align(&mut self, size: usize) -> u32 {
        let length = self.bytes.len().next_multiple_of(size);
        self.bytes.resize(length, 0);
        (length / size) as u32
    }

    fn string(&mut self, text: &'r [u16]) -> u32 {
        if let Some(&offset) = self.strings.get(text) {
            return offset;
        }
        let offset = match self.owners.get(text).copied() {
            Some(owner) if owner.len() > text.len() => {
                self.string(owner) + (owner.len() - text.len()) as u32
            }
            owner => {
                let offset = self.align(2);
                match (owner, text.len() as u16) {
                    (Some(_), _) => {}
                    (None, length @ ..0x3ef) => self.push16([0xdc00 | length]),
                    (None, length) => self.push16([0xdfef, length]),
                }
                self.push16(text.iter().copied().chain([0]));
                offset
            }
        };
        self.strings.insert(text, offset);
        offset
    }

    fn write(&mut self, res: &'r Res<'a>) -> u32 {
        if let Some(&written) = self.written.get(res) {
            return written;
        }
        let as_strings16 = |items: &[u32]| -> Option<Vec<u16>> {
            let offset = |&item: &u32| u16::try_from(item ^ STRING_V2 << 28).ok();
            items.iter().map(offset).collect()
        };
        let (type_, offset) = match res {
            Res::String(text) => (STRING_V2, self.string(text)),
            Res::Int(value) => (INT, value.cast_unsigned() & 0x0fff_ffff),
            Res::Alias(text) => {
                let offset = self.align(4);
                self.push32([text.len() as u32]);
                self.push16(text.iter().copied().chain([0]));
                (ALIAS, offset)
            }
            Res::Ints(values) => {
                let offset = self.align(4);
                self.push32([values.len() as u32]);
                self.push32(values.iter().map(|value| value.cast_unsigned()));
                (INT_VECTOR, offset)
            }
            Res::Binary(bytes) => {
                let offset = self.align(4);
                self.push32([bytes.len() as u32]);
                self.bytes.extend(bytes);
                (BINARY, offset)
            }
            Res::Array(items) => {
                let items: Vec<u32> = items.iter().map(|item| self.write(item)).collect();
                if let Some(strings) = as_strings16(&items) {
                    let offset = self.align(2);
                    self.push16([items.len() as u16].into_iter().chain(strings));
                    (ARRAY16, offset)
                } else {
                    let offset = self.align(4);
                    self.push32([items.len() as u32].into_iter().chain(items));
                    (ARRAY, offset)
                }
            }
            Res::Table(entries) if entries.is_empty() => (TABLE, 0),
            Res::Table(entries) => {
                assert!(entries.is_sorted_by_key(|it| it.0));
                let items: Vec<u32> = entries.iter().map(|it| self.write(&it.1)).collect();
                let strings = as_strings16(&items);
                let offset = self.align(if strings.is_some() { 2 } else { 4 });
                let keys = self.keys;
                self.push16([items.len() as u16]);
                self.push16(entries.iter().map(|entry| keys.offset(entry.0)));
                if let Some(strings) = strings {
                    self.push16(strings);
                    (TABLE16, offset)
                } else {
                    self.align(4);
                    self.push32(items);
                    (TABLE, offset)
                }
            }
        };
        self.written.insert(res, type_ << 28 | offset);
        type_ << 28 | offset
    }
}

/// Returns the image and the resource for each of `roots`.
pub(crate) fn write_image(keys: &Keys, roots: &[&Res]) -> (Vec<u8>, Vec<u32>) {
    let mut strings = Vec::new();
    roots
        .iter()
        .for_each(|root| collect_strings(root, &mut strings));
    let distinct: BTreeSet<_> = strings.iter().copied().collect();
    let without_length = distinct.into_iter().filter(|text| !needs_length(text));
    let mut image = Image {
        keys,
        // The offset 0 stands for what is empty.
        bytes: vec![0; 2],
        owners: longest_with_suffix(without_length),
        strings: BTreeMap::from([(&[][..], 0)]),
        written: BTreeMap::new(),
    };
    // Offsets of 16 bits reach them all.
    strings.into_iter().for_each(|text| _ = image.string(text));
    let written: Vec<_> = roots.iter().map(|root| image.write(root)).collect();
    image.align(2);
    for (&root, &written) in roots.iter().zip(&written) {
        assert!(read_image(&image.bytes, &keys.bytes, written) == *root);
    }
    (image.bytes, written)
}
