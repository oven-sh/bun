use std::collections::VecDeque;

use bun_hpack::dynamic_table::entry_size;
use bun_hpack::searchable_table::{Name, SearchableTable};
use bun_hpack::{Indexing, integer, literal, wrapped_mut};
use bun_wyhash::Wyhash;

use crate::input::{Input, MAX_INTEGER_LEN, Stop, read_instructions};
use crate::{Error, Result, static_table};

// The peer may allow more.
const MAX_TABLE_CAPACITY: u64 = 4096;
const MAX_BLOCKED_STREAMS: u64 = 100;

/// Further sections do without the dynamic table.
const MAX_UNACKNOWLEDGED: usize = 128;

const _: () = assert!(MAX_TABLE_CAPACITY <= u16::MAX as u64);

const PREFIX_ROOM: [u8; 16] = [0; _];

/// The state of one direction of a connection. After an error it is out of step with the peer.
pub struct Encoder {
    dynamic: Option<Box<Dynamic>>,
    instructions: Vec<u8>,
    partial: Vec<u8>,
}

struct Dynamic {
    /// With the low bits of [`Self::inserted_size`] before the entry. All names are stored.
    table: SearchableTable<u16>,
    fields: History,
    /// Of those that are in neither table.
    names: History,
    insert_count: usize,
    known_received_count: usize,
    /// Of all entries so far.
    inserted_size: usize,
    /// What that was, or would have been if there had been room, after the last entry that repeats no other.
    wanted_size: usize,
    /// What the Required Insert Count wraps around at.
    full_range: usize,
    max_blocked_streams: usize,
    /// By stream, then in the order of sending.
    unacknowledged: VecDeque<Unacknowledged>,
}

/// Short hashes of the latest of a kind, as many as the table can have entries.
struct History {
    hashes: [u16; MAX_TABLE_CAPACITY as usize / entry_size(0, 0)],
    next: usize,
}

impl History {
    fn new() -> Self {
        Self {
            hashes: [0; _],
            next: 0,
        }
    }

    #[inline(always)]
    fn add(&mut self, hash: u32) {
        *wrapped_mut(&mut self.hashes, self.next) = hash as u16;
        self.next += 1;
    }

    /// Returns whether it was there before.
    #[inline(never)]
    fn add_again(&mut self, hash: u32) -> bool {
        let hashes = self.hashes.iter();
        let is_repeated = hashes.fold(false, |found, &other| found | (other == hash as u16));
        self.add(hash);
        is_repeated
    }
}

/// A section that refers to the dynamic table.
struct Unacknowledged {
    stream_id: u64,
    required_insert_count: usize,
    /// The lowest absolute index that it refers to.
    oldest: usize,
}

/// A field section in the making. Not to finish it does no harm.
#[must_use]
pub struct Section<'a> {
    out: &'a mut Vec<u8>,
    lines_start: usize,
    references: Option<References<'a>>,
}

struct References<'a> {
    dynamic: &'a mut Dynamic,
    instructions: &'a mut Vec<u8>,
    credit: usize,
    section: Unacknowledged,
    base: usize,
    may_block: bool,
}

impl Encoder {
    /// Does without the dynamic table.
    pub fn new() -> Self {
        Self {
            dynamic: None,
            instructions: Vec::new(),
            partial: Vec::new(),
        }
    }

    /// For when the `SETTINGS` of the peer arrive, with `QPACK_MAX_TABLE_CAPACITY` and `QPACK_BLOCKED_STREAMS`.
    /// There is no changing them later.
    pub fn use_dynamic_table(&mut self, max_table_capacity: u64, max_blocked_streams: u64) {
        let max_entries = max_table_capacity as usize / entry_size(0, 0);
        if max_entries == 0 || self.dynamic.is_some() {
            return;
        }
        let capacity = max_table_capacity.min(MAX_TABLE_CAPACITY) as usize;
        integer::write(0x20, 5, capacity, |byte| self.instructions.push(byte));
        let mut table = SearchableTable::new();
        table.entries.set_max_size(capacity);
        self.dynamic = Some(Box::new(Dynamic {
            table,
            fields: History::new(),
            names: History::new(),
            insert_count: 0,
            known_received_count: 0,
            inserted_size: 0,
            wanted_size: 0,
            full_range: 2 * max_entries,
            max_blocked_streams: max_blocked_streams.min(MAX_BLOCKED_STREAMS) as usize,
            unacknowledged: VecDeque::new(),
        }));
    }

    /// Starts a field section, which is appended to `out`. It does not make [`Self::instructions`] longer than
    /// `credit`, which is how much flow control lets through on the encoder stream (RFC 9204 §2.1.3).
    #[inline]
    pub fn section<'a>(
        &'a mut self,
        stream_id: u64,
        out: &'a mut Vec<u8>,
        credit: usize,
    ) -> Section<'a> {
        out.extend_from_slice(&PREFIX_ROOM);
        let dynamic = self.dynamic.as_deref_mut();
        let dynamic = dynamic.filter(|dynamic| dynamic.unacknowledged.len() < MAX_UNACKNOWLEDGED);
        Section {
            lines_start: out.len(),
            out,
            references: dynamic.map(|dynamic| References {
                instructions: &mut self.instructions,
                credit,
                section: Unacknowledged {
                    stream_id,
                    required_insert_count: 0,
                    oldest: usize::MAX,
                },
                base: dynamic.insert_count,
                may_block: dynamic.may_block(),
                dynamic,
            }),
        }
    }

    /// What is due on the encoder stream, for the caller to drain from the start.
    #[inline]
    pub fn instructions(&mut self) -> &mut Vec<u8> {
        &mut self.instructions
    }

    /// `bytes` may end anywhere.
    pub fn read_decoder_stream(&mut self, bytes: &[u8]) -> Result<()> {
        let result = read_instructions(&mut self.partial, bytes, MAX_INTEGER_LEN, |first, rest| {
            read_instruction(self.dynamic.as_deref_mut(), first, rest)
        });
        result.ok_or(Error::DecoderStream)
    }
}

/// RFC 9204 §4.4.
#[inline(always)]
fn read_instruction(
    dynamic: Option<&mut Dynamic>,
    first: u8,
    input: &mut Input<'_>,
) -> Result<(), Stop> {
    let number = input.integer(first, if first >= 0x80 { 7 } else { 6 })?;
    match (first, dynamic) {
        (0x40..0x80, None) => {}
        (0x40..0x80, Some(dynamic)) => while dynamic.take_section(number as u64).is_some() {},
        (_, None) => return Err(Stop::Invalid),
        (0x80.., Some(dynamic)) => {
            let section = dynamic.take_section(number as u64).ok_or(Stop::Invalid)?;
            let count = &mut dynamic.known_received_count;
            *count = section.required_insert_count.max(*count);
        }
        (_, Some(dynamic)) => {
            if !(1..=dynamic.unacknowledged_entries()).contains(&number) {
                return Err(Stop::Invalid);
            }
            dynamic.known_received_count += number;
        }
    }
    Ok(())
}

impl Dynamic {
    /// The earliest of the stream.
    fn take_section(&mut self, stream_id: u64) -> Option<Unacknowledged> {
        let sections = &mut self.unacknowledged;
        let at = sections.partition_point(|section| section.stream_id < stream_id);
        sections
            .get(at)
            .filter(|section| section.stream_id == stream_id)?;
        sections.remove(at)
    }

    #[inline(always)]
    fn unacknowledged_entries(&self) -> usize {
        self.insert_count - self.known_received_count
    }

    /// RFC 9204 §2.1.2. Takes every section for a stream of its own.
    fn may_block(&self) -> bool {
        let sections = self.unacknowledged.iter();
        sections.len() < self.max_blocked_streams
            || sections
                .filter(|section| section.required_insert_count > self.known_received_count)
                .count()
                < self.max_blocked_streams
    }

    /// Of an entry and those that are newer.
    #[inline(always)]
    fn size_up_to(&self, age: usize) -> usize {
        let before = self.table.entries.get(age).map(|entry| entry.links.extra);
        let now = self.inserted_size as u16;
        before.map_or(0, |before| now.wrapping_sub(before).into())
    }

    /// RFC 9204 §2.1.1.1.
    #[inline(always)]
    fn is_draining(&self, age: usize) -> bool {
        let lasting_size = self.table.entries.max_size() / 4 * 3;
        self.size_up_to(age) + self.wanted_size > self.inserted_size + lasting_size
    }

    fn insert(&mut self, name: &Name<'_>, value: &[u8], hash: u32) {
        let before = self.inserted_size as u16;
        self.table.insert(name, value, hash, before);
        self.inserted_size += entry_size(name.bytes.len(), value.len());
        self.insert_count += 1;
    }
}

#[inline(always)]
fn field_hash(name: &Name<'_>, value: &[u8]) -> u32 {
    Wyhash::hash(name.hash.into(), value) as u32
}

impl References<'_> {
    /// Of the entries that the section may refer to.
    #[inline(always)]
    fn min_age(&self) -> usize {
        if self.may_block {
            0
        } else {
            self.dynamic.unacknowledged_entries()
        }
    }

    /// An instruction is shorter than the `size` of the entry that it adds.
    fn has_credit(&self, size: usize) -> bool {
        self.instructions.len() + size <= self.credit
    }

    /// RFC 9204 §2.1.1. `to_stay` is an absolute index that is not to be evicted either.
    fn has_room(&self, size: usize, to_stay: usize) -> bool {
        let dynamic = &*self.dynamic;
        let capacity = dynamic.table.entries.max_size();
        if dynamic.table.entries.size() + size <= capacity {
            return true;
        }
        let sections = dynamic.unacknowledged.iter().chain([&self.section]);
        let to_stay = to_stay.min(dynamic.known_received_count);
        let to_stay = sections.fold(to_stay, |oldest, section| oldest.min(section.oldest));
        dynamic.size_up_to(dynamic.insert_count.wrapping_sub(to_stay + 1)) + size <= capacity
    }

    /// Returns the age of the new entry if there is one that the section may refer to.
    #[inline(never)]
    fn add(
        &mut self,
        name: &Name<'_>,
        static_index: Option<u8>,
        value: &[u8],
        hash: u32,
    ) -> Option<usize> {
        let size = entry_size(name.bytes.len(), value.len());
        if size > self.dynamic.table.entries.max_size() || !self.has_credit(size) {
            return None;
        }
        let dynamic = &mut *self.dynamic;
        dynamic.wanted_size = dynamic.wanted_size.max(dynamic.inserted_size + size);
        if !self.has_room(size, usize::MAX) {
            return None;
        }
        let out = &mut *self.instructions;
        if let Some(index) = static_index {
            integer::write(0xc0, 6, index.into(), |byte| out.push(byte));
        } else if let Some(age) = self.dynamic.table.find_name(name, 0) {
            integer::write(0x80, 6, age, |byte| out.push(byte));
        } else {
            write_name(0x40, 5, name.bytes, out);
        }
        literal::write(value, out);
        self.dynamic.insert(name, value, hash);
        self.may_block.then_some(0)
    }

    /// Repeats a draining entry, or its name if there is no `value`. Returns the age of the entry to refer to.
    #[inline(never)]
    fn renew(&mut self, age: usize, name: &Name<'_>, value: Option<&[u8]>) -> Option<usize> {
        let (pattern, prefix_bits) = if value.is_some() {
            (0x00, 5)
        } else {
            (0x80, 6)
        };
        let size = entry_size(name.bytes.len(), value.map_or(0, <[u8]>::len));
        let index = self.dynamic.insert_count - 1 - age;
        let to_stay = if self.may_block { usize::MAX } else { index };
        if self.has_credit(size) && self.has_room(size, to_stay) {
            integer::write(pattern, prefix_bits, age, |byte| {
                self.instructions.push(byte)
            });
            if value.is_none() {
                self.instructions.push(0);
            }
            let value = value.unwrap_or_default();
            self.dynamic.insert(name, value, field_hash(name, value));
            return Some(if self.may_block { 0 } else { age + 1 });
        }
        // Not to refer to it lets it go, and that makes room for what is worth more.
        let is_in_the_way = self.dynamic.wanted_size > self.dynamic.inserted_size + 2 * size;
        (!is_in_the_way).then_some(age)
    }

    /// Returns the age of an entry to refer to.
    #[inline(always)]
    fn find_field(
        &mut self,
        name: &Name<'_>,
        static_index: Option<u8>,
        value: &[u8],
        indexing: Indexing,
    ) -> Option<usize> {
        let (size, min_age) = (entry_size(name.bytes.len(), value.len()), self.min_age());
        let Dynamic { table, fields, .. } = &mut *self.dynamic;
        if indexing == Indexing::Never || size > table.entries.max_size() {
            return None;
        }
        let hash = field_hash(name, value);
        let Some(newest) = table.find_field(name, value, hash, 0) else {
            let is_worth_it = fields.add_again(hash)
                || (self.may_block
                    && table.entries.size() + size <= table.entries.max_size()
                    && table.find_name(name, 0).is_none());
            if is_worth_it && indexing == Indexing::Allowed {
                return self.add(name, static_index, value, hash);
            }
            return None;
        };
        fields.add(hash);
        if newest < min_age {
            table.find_field(name, value, hash, min_age)
        } else if indexing == Indexing::Allowed && self.dynamic.is_draining(newest) {
            self.renew(newest, name, Some(value))
        } else {
            Some(newest)
        }
    }

    /// Returns the age of an entry to refer to.
    #[inline(always)]
    fn find_name(&mut self, name: &Name<'_>, indexing: Indexing) -> Option<usize> {
        let min_age = self.min_age();
        let Dynamic { table, names, .. } = &mut *self.dynamic;
        let Some(newest) = table.find_name(name, 0) else {
            if indexing == Indexing::Allowed && names.add_again(name.hash) {
                return self.add(name, None, &[], field_hash(name, &[]));
            }
            return None;
        };
        if newest < min_age {
            table.find_name(name, min_age)
        } else if indexing == Indexing::Allowed && self.dynamic.is_draining(newest) {
            self.renew(newest, name, None)
        } else {
            Some(newest)
        }
    }

    /// Takes the pattern and the length of the prefix for an entry before the Base, then for one after it.
    #[inline(always)]
    fn refer(&mut self, age: usize, before: (u8, u32), after: (u8, u32), out: &mut Vec<u8>) {
        let index = self.dynamic.insert_count - 1 - age;
        let section = &mut self.section;
        section.required_insert_count = section.required_insert_count.max(index + 1);
        section.oldest = section.oldest.min(index);
        match index.checked_sub(self.base) {
            None => integer::write(before.0, before.1, self.base - 1 - index, |byte| {
                out.push(byte)
            }),
            Some(index) => integer::write(after.0, after.1, index, |byte| out.push(byte)),
        }
    }

    /// RFC 9204 §4.5.1.
    #[inline(never)]
    fn finish(self, room: &mut [u8]) -> usize {
        let Self {
            dynamic,
            section,
            base,
            ..
        } = self;
        let count = section.required_insert_count;
        let (mut prefix, mut len) = (PREFIX_ROOM, 0);
        let mut put = |byte| {
            *wrapped_mut(&mut prefix, len) = byte;
            len += 1;
        };
        integer::write(0x00, 8, count % dynamic.full_range + 1, &mut put);
        match base.checked_sub(count) {
            Some(delta_base) => integer::write(0x00, 7, delta_base, &mut put),
            None => integer::write(0x80, 7, count - base - 1, &mut put),
        }
        let pairs = room.iter_mut().rev().zip(prefix.iter().take(len).rev());
        pairs.for_each(|(to, &from)| *to = from);

        let sections = &mut dynamic.unacknowledged;
        let at = sections.partition_point(|other| other.stream_id <= section.stream_id);
        sections.insert(at, section);
        len
    }
}

impl Section<'_> {
    /// `hint` is the index of any entry of the static table with this name, which then is not looked at.
    pub fn field(&mut self, name: &[u8], hint: Option<u8>, value: &[u8], indexing: Indexing) {
        let (name, static_index) = match hint.and_then(|index| static_table::get(index.into())) {
            Some(entry) => (entry.name(), Some(entry.first)),
            None => (name, static_table::find_name(name)),
        };
        let out = &mut *self.out;
        let never = u8::from(indexing == Indexing::Never);
        if never == 0
            && let Some(index) = static_index
            && let Some(index) = static_table::find_field(index, value)
        {
            return integer::write(0xc0, 6, index.into(), |byte| out.push(byte));
        }
        let mut has_name = false;
        if let Some(references) = &mut self.references {
            let name = Name {
                bytes: name,
                static_index: 0,
                hash: static_index.map_or_else(|| Wyhash::hash(0, name) as u32, u32::from),
            };
            if let Some(age) = references.find_field(&name, static_index, value, indexing) {
                return references.refer(age, (0x80, 6), (0x10, 4), out);
            }
            if static_index.is_none()
                && let Some(age) = references.find_name(&name, indexing)
            {
                references.refer(age, (0x40 | never << 5, 4), (never << 3, 3), out);
                has_name = true;
            }
        }
        if let Some(index) = static_index {
            integer::write(0x50 | never << 5, 4, index.into(), |byte| out.push(byte));
        } else if !has_name {
            write_name(0x20 | never << 4, 3, name, out);
        }
        literal::write(value, out);
    }

    /// Returns where in `out` the section starts. What it has appended before that is free to be overwritten.
    #[inline]
    #[must_use]
    pub fn finish(self) -> usize {
        let prefix_len = match self.references {
            Some(references) if references.section.required_insert_count != 0 => {
                references.finish(self.out.get_mut(..self.lines_start).unwrap_or_default())
            }
            _ => 2,
        };
        self.lines_start - prefix_len
    }
}

#[inline(never)]
fn write_name(pattern: u8, prefix_bits: u32, name: &[u8], out: &mut Vec<u8>) {
    literal::write_with_prefix(pattern, prefix_bits, name, out);
}
