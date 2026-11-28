//! The text of a chunk: pieces from the model, and copies of other strings of the chunk, in this locale or in another one.

use crate::code::{Bits, Code};
use crate::model::{Map, Model, entry};
use crate::schema::{Chunk, Leaf, Node, Schema, Target};
use crate::words::Slots;
use core::hint::select_unpredictable;
use core::ops::Range;
use operation::*;

pub const MAX_LEAVES: usize = 256;
/// For the text of all levels and the image.
pub const MAX_CELLS: usize = 4352;

/// What an entry can do. The reference is the string of an earlier level at the same leaf.
pub mod operation {
    /// The next 16 bits.
    pub const UNIT: u16 = 0;
    pub const START_OF_REFERENCE: u16 = 1;
    /// From about the place that corresponds to the end of the text so far: the distance, the length.
    pub const PART_OF_REFERENCE: u16 = 2;
    pub const START_OF_PREVIOUS: u16 = 3;
    /// Which one, the length. It then counts as the previous one.
    pub const START_OF_EARLIER: u16 = 4;
    /// The length, then the cell in as many bits as the one to which it is copied has.
    pub const CELLS: u16 = 5;

    /// This leaf is absent, and so many more.
    pub const SKIP: u16 = 6;
    /// This leaf and all others are absent.
    pub const DONE: u16 = 7;
    pub const PREVIOUS: u16 = 8;
    /// The string so many before the previous but one.
    pub const EARLIER: u16 = 9;

    // These have the bit `entry::ENDS`.
    pub const END: u16 = 10;
    pub const REFERENCE: u16 = 11;
    pub const REST_OF_REFERENCE: u16 = 12;
    pub const END_OF_PREVIOUS: u16 = 13;
    /// Which one, counted from the previous one, the length.
    pub const END_OF_EARLIER: u16 = 14;
    pub const COUNT: usize = 15;
}

/// The codes of the numbers that follow operations: the first and the second of each.
pub type NumberCodes = [[Code; 2]; operation::COUNT];

/// Lengths are coded less this.
pub const MIN_COPY: usize = 2;

const LENGTH_LEAD: u16 = 0xdc00;
/// The number of cells that are copied at once.
const STEP: usize = 16;

type Cells = [u16; MAX_CELLS + STEP];

/// A string: its first cell, its length, and the last level that has it or 0.
#[derive(Clone, Copy, Default)]
struct Value(u32);

impl Value {
    #[inline]
    fn new(start: usize, end: usize, level: u8) -> Self {
        Self(start as u32 | ((end - start) as u32) << 16 | u32::from(level) << 24)
    }

    #[inline]
    fn start(self) -> usize {
        (self.0 as u16).into()
    }

    #[inline]
    fn length(self) -> usize {
        ((self.0 >> 16) as u8).into()
    }

    #[inline]
    fn end(self) -> usize {
        self.start() + self.length()
    }

    #[inline]
    fn level(self) -> u8 {
        (self.0 >> 24) as u8
    }
}

/// Reads a chunk of each locale on the way to the one that is asked for. Each is a level.
#[derive(Clone)]
pub struct Levels<'a> {
    chunk: Chunk<'a>,
    level: u8,
    values: [Value; MAX_LEAVES],
    /// The strings of the last level, in the order in which they have been read.
    history: [Value; MAX_LEAVES],
    /// A level is a free cell, then its strings, each between its length and a NUL.
    cells: Cells,
    start_of_level: usize,
    used: usize,
}

impl<'a> Levels<'a> {
    #[inline(always)]
    pub fn new(chunk: Chunk<'a>) -> Self {
        Self {
            chunk,
            level: 0,
            values: [Value::default(); _],
            history: [Value::default(); _],
            cells: [0; _],
            start_of_level: 0,
            used: 0,
        }
    }

    /// Keys are the first references: a code, or the city of a time zone.
    pub fn read_keys(&mut self, keys: &[u8]) {
        let mut used = 0;
        for (leaf, key) in self.chunk.keys() {
            let start = used;
            let key = keys.get(key.into()..).unwrap_or_default();
            for &byte in key.iter().take_while(|&&byte| byte != 0) {
                let byte = if byte == b'_' { b' ' } else { byte };
                self.cells.put(used, byte.into());
                used += 1;
            }
            self.values.put(leaf, Value::new(start, used, 0));
            used += 1;
        }
        self.used = used;
    }

    /// The text of the levels so far, in which the next one finds what it copies.
    pub fn cells(&self) -> &[u16] {
        self.cells.get(..self.used).unwrap_or_default()
    }

    /// Where the reference for a leaf is in `cells`, and whether it is of the last level.
    pub fn reference(&self, leaf: usize) -> (Range<usize>, bool) {
        let value = self.values.at(leaf);
        let is_of_last = value.level() == self.level && self.level != 0;
        (value.start()..value.end(), is_of_last)
    }

    /// The first bit tells whether only the leaves of the last level can be present. Eight bytes follow what is read.
    /// `map` is for what is copied from earlier levels.
    pub fn read_level(
        &mut self,
        model: &Model,
        map: Map,
        numbers: &NumberCodes,
        coded: &[u8],
    ) -> Option<()> {
        let mut reader = Reader {
            bits: Bits::new(coded),
            model,
            numbers,
        };
        reader.bits.refill()?;
        let first_level = self.level * reader.bits.take(1) as u8;
        let (mut possible, mut count) = ([[0; 2]; MAX_LEAVES], 0);
        for (index, (&leaf, value)) in self.chunk.leaves().iter().zip(&self.values).enumerate() {
            possible.put(count % MAX_LEAVES, [index as u8, leaf]);
            let is_lacking = model.lacks >> Leaf::class(leaf) & 1 != 0;
            count += usize::from(!is_lacking & (value.level() >= first_level));
        }
        self.level += 1;
        self.start_of_level = self.used;
        self.used += 1;
        let end_of_mapped = if map.pairs.is_empty() {
            0
        } else {
            self.start_of_level
        };
        let (mut next, mut read) = (0, 0u8);
        while let Some(&[index, leaf]) = possible.get(..count)?.get(next) {
            let [at_start, _] = &model.codes;
            let (index, first) = (usize::from(index), reader.entry(at_start)?);
            next += 1;
            let value = match first.wrapping_sub(entry::FIRST_OPERATION) {
                ..SKIP | END.. => {
                    let is_mapped = leaf & Leaf::IS_VERBATIM == 0;
                    let mapped = (&map, select_unpredictable(is_mapped, end_of_mapped, 0));
                    self.read_string(&mut reader, first, self.values.at(index), read, mapped)?
                }
                SKIP => {
                    next += reader.number(SKIP, 0);
                    continue;
                }
                DONE => break,
                PREVIOUS => self.earlier(read, 1),
                EARLIER => self.earlier(read, 2 + reader.number(EARLIER, 0)),
            };
            self.values.put(index, value);
            self.history.put(read.into(), value);
            read = read.wrapping_add(1);
        }
        Some(())
    }

    #[inline(always)]
    fn earlier(&self, read: u8, distance: usize) -> Value {
        self.history.at(read.wrapping_sub(distance as u8).into())
    }

    #[inline(always)]
    fn read_string(
        &mut self,
        reader: &mut Reader,
        first: u16,
        reference: Value,
        read: u8,
        (map, end_of_mapped): (&Map, usize),
    ) -> Option<Value> {
        let start = self.used + 1;
        let (mut used, mut next) = (start, first);
        let mut previous = self.earlier(read, 1);
        // What leads from a cell of this string to the one that corresponds to it in the reference.
        let mut to_reference = reference.start().wrapping_sub(start);
        loop {
            if next < entry::FIRST_OPERATION {
                let offset = next >> entry::OFFSET_SHIFT;
                let text: &[_; entry::MAX_LENGTH] = reader.model.words.chunk_at(offset.into())?;
                *self.cells.get_mut(used..)?.first_chunk_mut()? = text.map(u16::from_le_bytes);
                used += 1 + usize::from(next % entry::ENDS);
            } else {
                let (from, length) = match next - entry::FIRST_OPERATION {
                    UNIT => {
                        self.cells.put(used, reader.bits.take(16) as u16);
                        used += 1;
                        (used, 0)
                    }
                    START_OF_REFERENCE => (reference.start(), reader.length(START_OF_REFERENCE, 0)),
                    PART_OF_REFERENCE => {
                        to_reference = to_reference.wrapping_add(reader.signed(PART_OF_REFERENCE));
                        let length = reader.length(PART_OF_REFERENCE, 1);
                        (used.wrapping_add(to_reference), length)
                    }
                    START_OF_PREVIOUS => (previous.start(), reader.length(START_OF_PREVIOUS, 0)),
                    START_OF_EARLIER => {
                        previous = self.earlier(read, 2 + reader.number(START_OF_EARLIER, 0));
                        (previous.start(), reader.length(START_OF_EARLIER, 1))
                    }
                    CELLS => {
                        let length = reader.length(CELLS, 0);
                        (reader.bits.take((used | 1).ilog2() + 1), length)
                    }
                    REFERENCE => (reference.start(), reference.length()),
                    REST_OF_REFERENCE => {
                        let distance = reader.signed(REST_OF_REFERENCE);
                        let from = used.wrapping_add(to_reference).wrapping_add(distance);
                        (from, reference.end().checked_sub(from)?)
                    }
                    END_OF_PREVIOUS => {
                        let length = reader.length(END_OF_PREVIOUS, 0);
                        (previous.end().wrapping_sub(length), length)
                    }
                    END_OF_EARLIER => {
                        let earlier = self.earlier(read, 1 + reader.number(END_OF_EARLIER, 0));
                        let length = reader.length(END_OF_EARLIER, 1);
                        (earlier.end().wrapping_sub(length), length)
                    }
                    _ => (used, 0),
                };
                copy_cells(&mut self.cells, from, used, length)?;
                if from < end_of_mapped {
                    map.apply(self.cells.get_mut(used..used + length)?);
                }
                used += length;
            }
            if next & entry::ENDS != 0 {
                break;
            }
            let [_, within] = &reader.model.codes;
            next = reader.entry(within)?;
        }
        (self.cells).put(start - 1, LENGTH_LEAD | (used - start) as u16);
        self.cells.put(used, 0);
        self.used = used + 1;
        Some(Value::new(start, used, self.level))
    }
}

/// The cells end before `to`. Overwrites some after the copy.
#[inline(always)]
fn copy_cells(cells: &mut Cells, from: usize, to: usize, length: usize) -> Option<()> {
    let mut done = 0;
    loop {
        let source: [_; STEP] = *cells.get(from.wrapping_add(done)..)?.first_chunk()?;
        *cells.get_mut(to + done..)?.first_chunk_mut()? = source;
        done += STEP;
        if done >= length {
            return Some(());
        }
    }
}

struct Reader<'a> {
    bits: Bits<'a>,
    model: &'a Model<'a>,
    numbers: &'a NumberCodes,
}

impl Reader<'_> {
    /// Leaves enough bits for the numbers that follow.
    #[inline(always)]
    fn entry(&mut self, code: &Code) -> Option<u16> {
        // Perf: the slot does not wait for the refill.
        let slot = self.bits.slot(code);
        self.bits.refill()?;
        self.model.words.get(self.bits.take_value(slot))
    }

    #[inline(always)]
    fn number(&mut self, operation: u16, index: usize) -> usize {
        let code = (self.numbers.get(usize::from(operation))).and_then(|it| it.get(index));
        code.map_or(0, |code| self.bits.take_value(self.bits.slot(code)))
    }

    #[inline(always)]
    fn length(&mut self, operation: u16, index: usize) -> usize {
        MIN_COPY + self.number(operation, index)
    }

    #[inline(always)]
    fn signed(&mut self, operation: u16) -> usize {
        let number = self.number(operation, 0);
        number >> 1 ^ (number & 1).wrapping_neg()
    }
}

/// An item of an image: the kind, and the offset of the value in the image. 0 is no value.
pub mod item {
    pub const KIND_SHIFT: u32 = 14;
    pub const OFFSET_MASK: u16 = (1 << KIND_SHIFT) - 1;

    pub const STRING: u16 = 0;
    pub const TABLE: u16 = 1;
    pub const ARRAY: u16 = 2;
    pub const SWITCHES: u16 = 3;

    pub(super) fn new(kind: u16, offset: usize) -> u16 {
        kind << KIND_SHIFT | offset as u16
    }

    /// An image begins with its length and ends with the items of the slots, the first one last.
    #[inline]
    pub fn index_of(slot: usize, length_of_image: usize) -> usize {
        length_of_image.wrapping_sub(1 + slot)
    }
}

/// For the slots and the containers that are being written.
type Children = [u16; MAX_LEAVES + Target::MAX_SLOTS + STEP];

struct Image<'l> {
    schema: Schema<'l>,
    /// By leaf: the item of the string.
    strings: [u16; MAX_LEAVES],
    next_leaf: u8,
    cells: &'l mut Cells,
    start: usize,
    end: usize,
    keys: Children,
    items: Children,
}

/// Overwrites some cells after the copy.
#[inline(always)]
fn copy_children(children: &Children, from: Range<usize>, cells: &mut Cells, to: usize) {
    let (mut from, end, mut to) = (from.start, from.end, to);
    while let Some(source) = children.get(from..from + STEP)
        && let Some(target) = cells.get_mut(to..to + STEP)
    {
        target.copy_from_slice(source);
        (from, to) = (from + STEP, to + STEP);
        if from >= end {
            break;
        }
    }
}

impl Image<'_> {
    #[inline]
    fn push(&mut self, unit: u16) {
        self.cells.put(self.end, unit);
        self.end += 1;
    }

    /// Returns the item. The children from `free` on are not in use.
    #[inline(always)]
    fn write(&mut self, node: Node, free: usize) -> u16 {
        if node.is_container() {
            return self.write_container(node, free);
        }
        let string = self.strings.at(self.next_leaf.into());
        self.next_leaf = self.next_leaf.wrapping_add(1);
        if node.is_string() {
            string
        } else {
            self.write_switches(string)
        }
    }

    fn write_container(&mut self, node: Node, first: usize) -> u16 {
        let (kind, children) = self.schema.container(node);
        let mut free = first;
        for (key, child) in children {
            let item = self.write(child, free);
            self.keys.put(free, key);
            self.items.put(free, item);
            free += usize::from(item != 0);
        }
        let (count, offset) = (free - first, self.end - self.start);
        if count == 0 {
            return 0;
        }
        if kind == Node::EITHER {
            return self.items.at(first);
        }
        self.push(count as u16);
        copy_children(&self.keys, first..free, self.cells, self.end);
        self.end += if kind == item::ARRAY { 0 } else { count };
        copy_children(&self.items, first..free, self.cells, self.end);
        self.end += count;
        item::new(kind, offset)
    }

    #[cold]
    fn write_switches(&mut self, string: u16) -> u16 {
        if string == 0 {
            return 0;
        }
        let offset = self.end - self.start;
        let bits = self.cells.at(self.start + usize::from(string) + 1);
        for unit in [2, 0, bits & 1, 0, bits >> 1 & 1, 0] {
            self.push(unit);
        }
        item::new(item::SWITCHES, offset)
    }
}

impl Levels<'_> {
    /// Writes the last level again.
    #[cold]
    fn insert_leads(&mut self, lead: u16) {
        self.start_of_level = self.used;
        self.used += 1;
        for value in self.values.iter_mut().filter(|it| it.level() == self.level) {
            let start = self.used + 1;
            let mut used = start;
            for at in value.start()..value.end() {
                let unit = self.cells.at(at);
                self.cells.put(used, lead);
                used += usize::from(unit >> 10 == 0xdc00 >> 10);
                self.cells.put(used, unit);
                used += 1;
            }
            (self.cells).put(start - 1, LENGTH_LEAD | (used - start) as u16);
            self.cells.put(used, 0);
            (*value, self.used) = (Value::new(start, start, self.level), used + 1);
        }
    }

    /// Returns the last level in the form in which it is read: tables, arrays and strings as `.res` files have them in 16-bit units.
    pub fn image(&mut self, model: &Model) -> &[u16] {
        if model.lead != 0 {
            self.insert_leads(model.lead);
        }
        let start = self.start_of_level;
        let mut image = Image {
            schema: self.chunk.schema,
            strings: [0; _],
            next_leaf: 0,
            cells: &mut self.cells,
            start,
            end: self.used,
            keys: [0; _],
            items: [0; _],
        };
        let values = self.values.iter().take(self.chunk.leaves().len());
        for (string, value) in image.strings.iter_mut().zip(values) {
            let offset = value.start().wrapping_sub(1 + start) as u16;
            *string = if value.level() == self.level {
                offset
            } else {
                0
            };
        }
        let slots = self.chunk.slots().len();
        for (index, slot) in self.chunk.slots().enumerate() {
            let item = image.write(slot, slots);
            image.items.put(slots - 1 - index, item);
        }
        copy_children(&image.items, 0..slots, image.cells, image.end);
        let end = image.end + slots;
        self.cells.put(start, (end - start) as u16);
        self.cells.get(start..end).unwrap_or_default()
    }
}
