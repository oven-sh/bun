use core::mem;
use std::collections::VecDeque;

use bun_hpack::dynamic_table::entry_size;
use bun_hpack::searchable_table::{Name, SearchableTable};
use bun_hpack::{Indexing, integer, literal, wrapped, wrapped_mut};
use bun_wyhash::Wyhash;

use crate::input::{Input, MAX_INTEGER_LEN, Stop, read_instructions};
use crate::{Error, Result, static_table};

// The peer may allow more.
const MAX_TABLE_CAPACITY: u64 = 4096;
const MAX_BLOCKED_STREAMS: u64 = 100;

/// Further sections do without the dynamic table.
const MAX_UNACKNOWLEDGED: usize = 128;

const MAX_ENTRIES: usize = MAX_TABLE_CAPACITY as usize / entry_size(0, 0);

/// Of an instruction that repeats one of them or its name.
const MAX_RENEWAL_LEN: usize = 3;
const _: () = assert!(MAX_ENTRIES <= 63 + 128);

/// How many times over literals have to have cost what it takes to make room. The need may not last.
const PATIENCE: usize = 2;

/// An idle time that makes any entry minor.
const FOREVER: u32 = u32::MAX / 2;

const PREFIX_ROOM: [u8; 16] = [0; _];

/// The state of one direction of a connection. After an error it is out of step with the peer.
pub struct Encoder {
    dynamic: Option<Box<Dynamic>>,
    instructions: Vec<u8>,
    partial: Vec<u8>,
}

struct Dynamic {
    /// All names are stored.
    table: SearchableTable,
    /// By absolute index.
    entries: [About; MAX_ENTRIES],
    /// How many it has been given is the time.
    fields: History,
    /// Of those that are in neither table.
    names: History,
    insert_count: usize,
    known_received_count: usize,
    /// The entries below this index are draining (RFC 9204 §2.1.1.1).
    draining_count: usize,
    /// What room is being made for, or was last.
    wanted: Wanted,
    waiting: Waiting,
    /// Of the literals that there was no making room for. It halves with each section.
    refused_len: usize,
    section_start: usize,
    section_count: usize,
    /// How many sections followed the one that was acknowledged last until it was.
    lag: usize,
    /// What the Required Insert Count wraps around at.
    full_range: usize,
    max_blocked_streams: usize,
    /// By stream, then in the order of sending.
    unacknowledged: VecDeque<Unacknowledged>,
}

#[derive(Clone, Copy, Default)]
struct About {
    size: u32,
    last_use: u32,
}

/// An entry to be.
#[derive(Clone, Copy, Default)]
struct Wanted {
    size: usize,
    /// The time between two uses.
    interval: usize,
}

/// The state of making room, which lasts until a field is added.
#[derive(Default)]
struct Waiting {
    /// When the wanted entry is due again. Nothing smaller is added before.
    until: usize,
    /// Of the literals for want of room, less those that were to make room.
    missed_len: usize,
    /// The entries below this index are not referred to, so that they can go.
    let_go_count: usize,
    /// Whether the minor ones among them go for good.
    displaces: bool,
    /// How often letting go has been given up. Each time doubles the patience.
    failures: u32,
}

/// The entries to evict for a new one.
struct Way {
    /// The absolute index of the first that is not among them.
    end: usize,
    /// What there is room for in the end.
    room: usize,
    /// Of those that have to be repeated first.
    renewed_size: usize,
    /// Of the names and values of those that are in use, but are not repeated.
    displaced_len: usize,
}

/// Short hashes of the latest of a kind.
struct History {
    hashes: [u16; MAX_ENTRIES],
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

    /// How long before the latest it was added, and whether that may have been a repetition too.
    fn recall(&self, hash: u32) -> (usize, bool) {
        let (mut age, mut count) = (MAX_ENTRIES as u16 - 1, 0);
        for (offset, &other) in (2..).zip(&self.hashes) {
            let its_age = (self.next as u16).wrapping_sub(offset) % MAX_ENTRIES as u16;
            let is_same = other == hash as u16;
            age = age.min(if is_same { its_age } else { u16::MAX });
            count += u16::from(is_same);
        }
        let age = usize::from(age) + 1;
        (age, 2 * age >= MAX_ENTRIES || count > 2)
    }
}

/// A section that refers to the dynamic table.
struct Unacknowledged {
    stream_id: u64,
    required_insert_count: usize,
    /// The lowest absolute index that it refers to.
    oldest: usize,
    number: usize,
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
    last_section_start: usize,
    /// All the room that this section has for what is neither larger nor more frequent than that.
    limit: (usize, Wanted),
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

    /// With what the `SETTINGS` of the peer allow. There is no changing it later.
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
            entries: [About::default(); _],
            fields: History::new(),
            names: History::new(),
            insert_count: 0,
            known_received_count: 0,
            draining_count: 0,
            wanted: Wanted::default(),
            waiting: Waiting::default(),
            refused_len: 0,
            section_start: 0,
            section_count: 0,
            lag: 0,
            full_range: 2 * max_entries,
            max_blocked_streams: max_blocked_streams.min(MAX_BLOCKED_STREAMS) as usize,
            unacknowledged: VecDeque::new(),
        }));
    }

    /// Appends to `out`. `credit` is how long flow control lets [`Self::instructions`] become (RFC 9204 §2.1.3).
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
            references: dynamic.map(|dynamic| {
                dynamic.section_count += 1;
                dynamic.refused_len /= 2;
                let now = dynamic.fields.next;
                References {
                    instructions: &mut self.instructions,
                    credit,
                    section: Unacknowledged {
                        stream_id,
                        required_insert_count: 0,
                        oldest: usize::MAX,
                        number: dynamic.section_count,
                    },
                    base: dynamic.insert_count,
                    may_block: dynamic.may_block(),
                    last_section_start: mem::replace(&mut dynamic.section_start, now),
                    limit: Default::default(),
                    dynamic,
                }
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
            dynamic.lag = dynamic.section_count - section.number;
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

    /// The lowest absolute index, in the sections that at least `later` others have followed.
    fn oldest_referred_to(&self, later: usize) -> usize {
        let sections = self.unacknowledged.iter();
        let sections = sections.filter(|section| self.section_count - section.number >= later);
        sections.fold(usize::MAX, |oldest, section| oldest.min(section.oldest))
    }

    fn dropped_count(&self) -> usize {
        self.insert_count - self.table.entries.count()
    }

    fn room(&self) -> usize {
        self.table.entries.max_size() - self.table.entries.size()
    }

    fn size_of(&self, index: usize) -> usize {
        wrapped(&self.entries, index).size as usize
    }

    fn idle_time(&self, index: usize) -> usize {
        let last_use = wrapped(&self.entries, index).last_use;
        (self.fields.next as u32).wrapping_sub(last_use) as usize
    }

    #[inline(always)]
    fn set_idle_time(&mut self, index: usize, time: u32) {
        let last_use = (self.fields.next as u32).wrapping_sub(time);
        wrapped_mut(&mut self.entries, index).last_use = last_use;
    }

    /// Whether an entry saves clearly less over time. The margin keeps two fields from replacing each other in turn.
    fn is_minor(&self, index: usize, wanted: Wanted) -> bool {
        let interval = wanted.interval.max(self.idle_time(index));
        3 * self.size_of(index) * wanted.interval <= 2 * wanted.size * interval
    }

    /// Whether an entry need not be repeated.
    fn is_idle(&self, index: usize, wanted: Wanted) -> bool {
        let size = wanted.size.max(self.refused_len);
        self.idle_time(index) >= wanted.interval && self.is_minor(index, Wanted { size, ..wanted })
    }

    fn is_waiting(&self) -> bool {
        self.fields.next <= self.waiting.until
    }

    fn is_let_go(&self, age: usize) -> bool {
        age + self.waiting.let_go_count >= self.insert_count
    }

    fn way(&self, wanted: Wanted, displaces: bool) -> Way {
        let mut way = Way {
            end: self.dropped_count(),
            room: self.room(),
            renewed_size: 0,
            displaced_len: 0,
        };
        while way.room < wanted.size && way.end < self.insert_count {
            let size = self.size_of(way.end);
            if self.is_idle(way.end, wanted) {
                way.room += size;
            } else if displaces && self.is_minor(way.end, wanted) {
                way.room += size;
                way.displaced_len += size - entry_size(0, 0);
            } else {
                way.renewed_size += size;
            }
            way.end += 1;
        }
        way
    }

    fn insert(&mut self, name: &Name<'_>, value: &[u8], hash: u32) {
        self.table.insert(name, value, hash);
        *wrapped_mut(&mut self.entries, self.insert_count) = About {
            size: entry_size(name.bytes.len(), value.len()) as u32,
            last_use: self.fields.next as u32,
        };
        self.insert_count += 1;
    }

    /// For after the addition of an entry, so that what is in use gets repeated while there is room for that.
    fn drain(&mut self, size: usize) {
        let capacity = self.table.entries.max_size();
        let lasting_size = size.max(capacity.saturating_sub((capacity / 4).max(3 * size)));
        let (mut index, mut rest) = (self.dropped_count(), self.table.entries.size());
        while rest > lasting_size {
            rest -= self.size_of(index);
            index += 1;
        }
        self.draining_count = self.draining_count.max(index);
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

    fn has_credit(&self, len: usize) -> bool {
        self.instructions.len() + len <= self.credit
    }

    /// The time since the start of the section before.
    fn section_interval(&self) -> usize {
        (self.dynamic.fields.next - self.last_section_start).max(1)
    }

    /// RFC 9204 §2.1.1. `to_stay` is an absolute index that is not to be evicted either.
    fn has_room(&self, wanted: Wanted, to_stay: usize) -> bool {
        let dynamic = &*self.dynamic;
        let (mut end, mut room) = (dynamic.dropped_count(), dynamic.room());
        if wanted.size <= room {
            return true;
        }
        let to_stay = to_stay.min(dynamic.known_received_count.min(self.section.oldest));
        while room < wanted.size {
            if end >= to_stay || !dynamic.is_idle(end, wanted) {
                return false;
            }
            room += dynamic.size_of(end);
            end += 1;
        }
        end <= dynamic.oldest_referred_to(0)
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
        let dynamic = &*self.dynamic;
        let capacity = dynamic.table.entries.max_size();
        let gives_way = dynamic.is_waiting() && size < dynamic.wanted.size;
        // The instruction is shorter than that.
        if size > capacity || gives_way || !self.has_credit(size) {
            return None;
        }
        let saved = if value.is_empty() { name.bytes } else { value };
        if size > dynamic.room() && !self.make_room(size, hash, saved.len()) {
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
        self.dynamic.drain(size);
        self.dynamic.waiting = Waiting::default();
        self.may_block.then_some(0)
    }

    /// Returns whether there is room, or else works towards it for the next time.
    fn make_room(&mut self, size: usize, hash: u32, saved_len: usize) -> bool {
        let (section_interval, (room, limited)) = (self.section_interval(), self.limit);
        let (interval, is_missed) = self.dynamic.fields.recall(hash);
        if (room + 1..=limited.size).contains(&size) && limited.interval <= interval {
            self.dynamic.refused_len += saved_len;
            return false;
        }
        let wanted = Wanted { size, interval };
        if self.has_room(wanted, usize::MAX) {
            self.dynamic.wanted = wanted;
            return true;
        }
        let dynamic = &mut *self.dynamic;
        let under_way = dynamic.unacknowledged.len();
        // From one use to the next, or a few more.
        let sections = (2 * interval / section_interval).max(1);
        // What it takes to let an entry go. Without blocking, its copy has to be acknowledged as well.
        let for_copy = if self.may_block { 0 } else { under_way + 1 };
        let literals = sections.max(under_way + for_copy);
        let markup = (PATIENCE << dynamic.waiting.failures) * literals;
        let mut way = dynamic.way(wanted, false);
        // Entries that seem idle every now and then keep coming back.
        let is_overdue = dynamic.waiting.missed_len > markup * (size + way.renewed_size);
        let displaces = is_overdue || way.room < size;
        if displaces {
            self.limit = (way.room, wanted);
            way = dynamic.way(wanted, true);
        }
        if way.room < size {
            self.limit.0 = way.room;
            dynamic.refused_len += saved_len;
            return false;
        }
        // There is no telling when a section gets acknowledged that is so late.
        if way.end > dynamic.oldest_referred_to(2 * under_way.max(dynamic.lag) + 1) {
            return false;
        }
        let waiting = &mut dynamic.waiting;
        if is_missed {
            waiting.missed_len += saved_len.saturating_sub(sections * way.displaced_len);
        }
        let price = markup * (way.renewed_size + way.displaced_len);
        if (price != 0 || is_overdue) && waiting.missed_len > price {
            waiting.let_go_count = waiting.let_go_count.max(way.end);
            waiting.displaces |= displaces;
        }
        if !displaces || waiting.let_go_count >= way.end {
            dynamic.wanted = wanted;
            waiting.until = dynamic.fields.next + interval.max(section_interval);
            dynamic.draining_count = dynamic.draining_count.max(way.end);
        }
        false
    }

    /// Repeats a draining entry, or just its name if `value` is empty. Returns the age of the entry to refer to.
    #[inline(never)]
    fn renew(&mut self, age: usize, name: &Name<'_>, value: &[u8]) -> Option<usize> {
        let has_credit = self.has_credit(MAX_RENEWAL_LEN);
        let len = name.bytes.len() + value.len();
        let interval = self.section_interval().max(self.dynamic.wanted.interval);
        let dynamic = &mut *self.dynamic;
        let (size, index) = (entry_size(len, 0), dynamic.insert_count - 1 - age);
        let is_whole = size == dynamic.size_of(index);
        // A name is a small price for a value that is longer.
        if !is_whole && dynamic.is_waiting() && size + len <= dynamic.wanted.size {
            return None;
        }
        let is_let_go = has_credit && dynamic.is_let_go(age) && len <= dynamic.waiting.missed_len;
        let is_displaced =
            is_let_go && dynamic.waiting.displaces && dynamic.is_minor(index, dynamic.wanted);
        // The copy can have its room.
        if is_whole {
            dynamic.set_idle_time(index, FOREVER);
        }
        if !is_displaced {
            let may_go = self.may_block || is_let_go;
            let to_stay = if may_go { usize::MAX } else { index };
            if has_credit && self.has_room(Wanted { size, interval }, to_stay) {
                let out = &mut *self.instructions;
                if is_whole {
                    integer::write(0x00, 5, age, |byte| out.push(byte));
                } else {
                    integer::write(0x80, 6, age, |byte| out.push(byte));
                    out.push(0);
                }
                let hash = field_hash(name, value);
                self.dynamic.insert(name, value, hash);
                let age = if self.may_block { 0 } else { age + 1 };
                return (self.may_block || !is_let_go).then_some(age);
            }
            if is_whole {
                self.dynamic.set_idle_time(index, 0);
            }
        }
        let waiting = &mut self.dynamic.waiting;
        if is_let_go {
            waiting.missed_len -= len;
            return None;
        }
        if index < waiting.let_go_count {
            waiting.let_go_count = 0;
            waiting.failures += 1;
        }
        Some(age)
    }

    /// Returns the age of an entry to refer to.
    #[inline(always)]
    fn find_field(
        &mut self,
        name: &Name<'_>,
        static_index: Option<u8>,
        value: &[u8],
    ) -> Option<usize> {
        let (size, min_age) = (entry_size(name.bytes.len(), value.len()), self.min_age());
        let Dynamic { table, fields, .. } = &mut *self.dynamic;
        if size > table.entries.max_size() {
            fields.add(0);
            return None;
        }
        let hash = field_hash(name, value);
        let Some(newest) = table.find_field(name, value, hash, 0) else {
            let is_worth_it = fields.add_again(hash)
                || (self.may_block
                    && table.entries.size() + size <= table.entries.max_size()
                    && table.find_name(name, 0).is_none());
            if is_worth_it {
                return self.add(name, static_index, value, hash);
            }
            return None;
        };
        fields.add(hash);
        let index = self.dynamic.insert_count - 1 - newest;
        if newest >= min_age && index < self.dynamic.draining_count {
            return self.renew(newest, name, value);
        }
        self.dynamic.set_idle_time(index, 0);
        if newest < min_age {
            let age = self.dynamic.table.find_field(name, value, hash, min_age);
            age.filter(|&age| !self.dynamic.is_let_go(age))
        } else {
            Some(newest)
        }
    }

    /// Returns the age of an entry to refer to.
    #[inline(always)]
    fn find_name(&mut self, name: &Name<'_>) -> Option<usize> {
        let min_age = self.min_age();
        let dynamic = &mut *self.dynamic;
        let Some(newest) = dynamic.table.find_name(name, 0) else {
            if dynamic.names.add_again(name.hash) {
                // `fields` does not recall it, so it passes for rare.
                return self.add(name, None, &[], field_hash(name, &[]));
            }
            return None;
        };
        let index = dynamic.insert_count - 1 - newest;
        if dynamic.size_of(index) == entry_size(name.bytes.len(), 0) {
            dynamic.set_idle_time(index, 0);
        }
        if newest < min_age {
            let age = dynamic.table.find_name(name, min_age);
            age.filter(|&age| !dynamic.is_let_go(age))
        } else if index < dynamic.draining_count {
            self.renew(newest, name, &[])
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
        if indexing == Indexing::Allowed
            && let Some(references) = &mut self.references
        {
            let name = Name {
                bytes: name,
                static_index: 0,
                hash: static_index.map_or_else(|| Wyhash::hash(0, name) as u32, u32::from),
            };
            if let Some(age) = references.find_field(&name, static_index, value) {
                return references.refer(age, (0x80, 6), (0x10, 4), out);
            }
            if static_index.is_none()
                && let Some(age) = references.find_name(&name)
            {
                references.refer(age, (0x40, 4), (0x00, 3), out);
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
