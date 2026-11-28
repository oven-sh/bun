use bun_hpack::dynamic_table::{DynamicTable, Entry, Name, entry_size};
use bun_hpack::literal::Literal;
use bun_hpack::{huffman, integer};

use crate::input::{Input, MAX_INTEGER_LEN, Stop, read_instructions};
use crate::{Error, Result, static_table};

const MIN_BUFFER_LEN: usize = 1024;
const FEW_INSTRUCTIONS_LEN: usize = 32;
/// Some encoders that do without the table do not read them.
const MAX_IDLE_CANCELLATIONS: usize = 4096;

/// All names are stored.
type Table = DynamicTable<About>;

#[derive(Clone, Copy)]
struct About {
    /// The table takes all of a duplicate for a name.
    name_len: u32,
    static_index: Option<u8>,
}

impl About {
    #[inline(always)]
    fn new(name: &[u8], static_index: Option<u8>) -> Self {
        Self {
            name_len: name.len() as u32,
            static_index,
        }
    }
}

struct Blocked {
    stream_id: u64,
    required_insert_count: usize,
}

/// The state of one direction of a connection. After an error it is out of step with the peer.
pub struct Decoder {
    table: Table,
    insert_count: usize,
    /// As [`Self::instructions`] leave it.
    known_received_count: usize,
    /// Of the entries since [`Self::instructions`] were asked for.
    unreported_size: usize,
    max_table_capacity: usize,
    max_blocked_streams: usize,
    /// The next in line comes last.
    blocked: Vec<Blocked>,
    partial: Vec<u8>,
    instructions: Vec<u8>,
    /// Before the first sign that the table is in use.
    idle_cancellations: usize,
}

/// The fields of a section. What is left of them need not be read.
#[must_use]
pub struct Fields<'a> {
    table: &'a Table,
    input: Input<'a>,
    buffer: &'a mut Vec<u8>,
    kept: usize,
    /// The Required Insert Count less the Base, which wraps around.
    after_base: usize,
    /// Of the newest entry that the section requires.
    min_age: usize,
    is_newest_unused: bool,
}

pub struct Field<'a> {
    /// Of an entry with this name if the peer referred to it.
    pub static_index: Option<u8>,
    name_len: usize,
    /// What is yet to be copied to the start of `room`: nothing, the name or all of it.
    in_table: &'a [u8],
    room: &'a mut [u8],
    kept: &'a mut usize,
}

impl Decoder {
    /// With the values of our `SETTINGS_QPACK_MAX_TABLE_CAPACITY` and `SETTINGS_QPACK_BLOCKED_STREAMS`.
    pub fn new(max_table_capacity: u32, max_blocked_streams: u32) -> Self {
        let mut table = Table::new();
        table.set_max_size(0);
        Self {
            table,
            insert_count: 0,
            known_received_count: 0,
            unreported_size: 0,
            max_table_capacity: max_table_capacity as usize,
            max_blocked_streams: max_blocked_streams as usize,
            blocked: Vec::new(),
            partial: Vec::new(),
            instructions: Vec::new(),
            idle_cancellations: 0,
        }
    }

    /// `bytes` may end anywhere. `scratch` is only of use during the call, so decoders can share one.
    pub fn read_encoder_stream(&mut self, bytes: &[u8], scratch: &mut Vec<u8>) -> Result<()> {
        // No Huffman code is as long as four bytes.
        let max_len = 4 * self.max_table_capacity + MAX_INTEGER_LEN;
        let mut partial = core::mem::take(&mut self.partial);
        let result = read_instructions(&mut partial, bytes, max_len, |first, rest| {
            self.read_instruction(first, rest, scratch)
        });
        self.partial = partial;
        result.ok_or(Error::EncoderStream)
    }

    /// RFC 9204 §4.3.
    #[inline(always)]
    fn read_instruction(
        &mut self,
        first: u8,
        input: &mut Input<'_>,
        scratch: &mut Vec<u8>,
    ) -> Result<(), Stop> {
        let capacity = self.table.max_size();
        let (name, value, about) = match first {
            0x80.. => {
                let index = input.integer(first, 6)?;
                let (name, about) = if first >= 0xc0 {
                    let name = static_table::get(index).ok_or(Stop::Invalid)?.name();
                    (Name::New(name), About::new(name, Some(index as u8)))
                } else {
                    let entry = self.table.get(index).ok_or(Stop::Invalid)?;
                    let (start, _) = entry.place.stored();
                    (Name::Stored(start, entry.links.name_len), entry.links)
                };
                let value = input.value()?;
                let mut room = room(scratch, 0, capacity.min(value.room()));
                (name, value.decode(&mut room)?, about)
            }
            0x40.. => {
                let (name, value) = (input.literal(first, 5)?, input.value()?);
                let mut room = room(scratch, 0, capacity.min(name.room() + value.room()));
                let (name, value) = (name.decode(&mut room)?, value.decode(&mut room)?);
                (Name::New(name), value, About::new(name, None))
            }
            0x20.. => {
                let capacity = input.integer(first, 5)?;
                if capacity > self.max_table_capacity {
                    return Err(Stop::Invalid);
                }
                self.table.set_max_size(capacity);
                return Ok(());
            }
            _ => {
                let entry = self.table.get(input.integer(first, 5)?);
                let entry = entry.ok_or(Stop::Invalid)?;
                let (start, len) = entry.place.stored();
                (Name::Stored(start, len), &[][..], entry.links)
            }
        };
        let place = self.table.insert(name, value, about).ok_or(Stop::Invalid)?;
        self.unreported_size += entry_size(place.stored().1 as usize, 0);
        self.insert_count += 1;
        Ok(())
    }

    /// A stream whose section [`Self::decode`] has what it takes for by now.
    #[inline]
    pub fn next_unblocked(&mut self) -> Option<u64> {
        let next = self
            .blocked
            .pop_if(|next| next.required_insert_count <= self.insert_count);
        next.map(|next| next.stream_id)
    }

    /// Returns `None` if the section has to wait for the encoder stream. `buffer` is written to from its start.
    #[inline]
    pub fn decode<'a>(
        &'a mut self,
        stream_id: u64,
        section: &'a [u8],
        buffer: &'a mut Vec<u8>,
    ) -> Result<Option<Fields<'a>>> {
        let mut input = Input::new(section);
        let prefix = self.read_prefix(&mut input);
        let (required_insert_count, after_base) = prefix.map_err(|_| Error::DecompressionFailed)?;
        let Some(min_age) = self.insert_count.checked_sub(required_insert_count) else {
            return self.block(stream_id, required_insert_count).map(|()| None);
        };
        if required_insert_count != 0 {
            self.blocked.retain(|other| other.stream_id != stream_id);
            integer::write(0x80, 7, stream_id as usize, |byte| {
                self.instructions.push(byte)
            });
            self.known_received_count = self.known_received_count.max(required_insert_count);
        }
        Ok(Some(Fields {
            table: &self.table,
            input,
            buffer,
            kept: 0,
            after_base,
            min_age,
            is_newest_unused: required_insert_count != 0,
        }))
    }

    /// RFC 9204 §4.5.1. Returns the Required Insert Count and [`Fields::after_base`].
    #[inline(always)]
    fn read_prefix(&self, input: &mut Input<'_>) -> Result<(usize, usize), Stop> {
        let first = input.byte()?;
        let required_insert_count = match input.integer(first, 8)? {
            0 => 0,
            encoded => {
                let max_entries = self.max_table_capacity / entry_size(0, 0);
                let (full_range, max_value) = (2 * max_entries, self.insert_count + max_entries);
                let complement = full_range.checked_sub(encoded).ok_or(Stop::Invalid)?;
                let below_max = (max_value + complement + 1) % full_range;
                if below_max >= max_value {
                    return Err(Stop::Invalid);
                }
                max_value - below_max
            }
        };
        let first = input.byte()?;
        let delta_base = input.integer(first, 7)?;
        match first {
            ..0x80 => Ok((required_insert_count, delta_base.wrapping_neg())),
            _ if delta_base < required_insert_count => Ok((required_insert_count, delta_base + 1)),
            _ => Err(Stop::Invalid),
        }
    }

    #[cold]
    #[inline(never)]
    fn block(&mut self, stream_id: u64, required_insert_count: usize) -> Result<()> {
        let requiring_more_than = |count| {
            let blocked = &self.blocked;
            blocked.partition_point(|other| other.required_insert_count > count)
        };
        let still_blocked = requiring_more_than(self.insert_count);
        let mut others = self.blocked.iter().take(still_blocked);
        if others.any(|other| other.stream_id == stream_id) {
            return Ok(());
        }
        if still_blocked >= self.max_blocked_streams {
            return Err(Error::DecompressionFailed);
        }
        let blocked = Blocked {
            stream_id,
            required_insert_count,
        };
        let at = requiring_more_than(required_insert_count);
        self.blocked.insert(at, blocked);
        Ok(())
    }

    /// For when a stream is reset or given up on before all of it has been read.
    pub fn cancel_stream(&mut self, stream_id: u64) {
        let is_idle =
            self.table.max_size() == 0 && self.insert_count == 0 && self.blocked.is_empty();
        self.idle_cancellations += usize::from(is_idle);
        self.blocked.retain(|other| other.stream_id != stream_id);
        if self.max_table_capacity != 0
            && (!is_idle || self.idle_cancellations <= MAX_IDLE_CANCELLATIONS)
        {
            integer::write(0x40, 6, stream_id as usize, |byte| {
                self.instructions.push(byte)
            });
        }
    }

    #[inline]
    pub fn has_instructions(&self) -> bool {
        !self.instructions.is_empty() || self.known_received_count != self.insert_count
    }

    /// Whether the encoder may have to do without the table until it has them (RFC 9204 §2.1.1 and §2.1.2).
    pub fn has_pressing_instructions(&self) -> bool {
        self.instructions.len() > FEW_INSTRUCTIONS_LEN
            || self.unreported_size > self.table.max_size() / 8
    }

    /// What is due on the decoder stream, for the caller to drain from the start and to keep within bounds.
    #[inline]
    pub fn instructions(&mut self) -> &mut Vec<u8> {
        self.unreported_size = 0;
        let increment = self.insert_count - self.known_received_count;
        if increment != 0 {
            integer::write(0x00, 6, increment, |byte| self.instructions.push(byte));
            self.known_received_count = self.insert_count;
        }
        &mut self.instructions
    }
}

impl<'a> Fields<'a> {
    #[inline(always)]
    pub fn next(&mut self) -> Result<Option<Field<'_>>> {
        match self.input.byte() {
            Ok(first) => match self.read(first) {
                Ok(field) => Ok(Some(field)),
                Err(_) => Err(Error::DecompressionFailed),
            },
            Err(_) if self.is_newest_unused => Err(Error::DecompressionFailed),
            Err(_) => Ok(None),
        }
    }

    /// RFC 9204 §4.5.2 to §4.5.6.
    #[inline(always)]
    fn read(&mut self, first: u8) -> Result<Field<'_>, Stop> {
        let entry = match first {
            0xc0.. => {
                let index = self.input.integer(first, 6)?;
                let entry = static_table::get(index).ok_or(Stop::Invalid)?;
                let name_len = entry.name_len.into();
                return Ok(self.indexed(entry.field, name_len, Some(index as u8)));
            }
            0x80.. => self.before_base(first, 6)?,
            0x10..0x20 => self.after_base(first, 4)?,
            _ => return self.read_literal(first),
        };
        let ((start, len), about) = (entry.place.stored(), entry.links);
        let field = self.table.name(Name::Stored(start, len));
        Ok(self.indexed(field, about.name_len as usize, about.static_index))
    }

    #[inline(always)]
    fn read_literal(&mut self, first: u8) -> Result<Field<'_>, Stop> {
        let entry = match first {
            0x50..0x60 | 0x70.. => {
                let index = self.input.integer(first, 4)?;
                let entry = static_table::get(index).ok_or(Stop::Invalid)?;
                return self.read_value(entry.name(), Some(index as u8));
            }
            0x40.. => self.before_base(first, 4)?,
            0x20.. => return self.read_name_and_value(first),
            _ => self.after_base(first, 3)?,
        };
        let ((start, _), about) = (entry.place.stored(), entry.links);
        let name = self.table.name(Name::Stored(start, about.name_len));
        self.read_value(name, about.static_index)
    }

    #[inline(always)]
    fn before_base(&mut self, first: u8, prefix_bits: u32) -> Result<&'a Entry<About>, Stop> {
        let index = self.input.integer(first, prefix_bits)?;
        self.entry(self.after_base.wrapping_add(index))
    }

    #[inline(always)]
    fn after_base(&mut self, first: u8, prefix_bits: u32) -> Result<&'a Entry<About>, Stop> {
        let index = self.input.integer(first, prefix_bits)?;
        self.entry(self.after_base.wrapping_sub(index + 1))
    }

    /// `distance` is from the newest entry that the section requires. It has wrapped around for a newer one.
    #[inline(always)]
    fn entry(&mut self, distance: usize) -> Result<&'a Entry<About>, Stop> {
        self.is_newest_unused &= distance != 0;
        let entry = self.table.get(distance.saturating_add(self.min_age));
        entry.ok_or(Stop::Invalid)
    }

    #[inline(always)]
    fn indexed(&mut self, field: &'a [u8], name_len: usize, static_index: Option<u8>) -> Field<'_> {
        Field {
            static_index,
            name_len,
            in_table: field,
            room: room(self.buffer, self.kept, field.len()),
            kept: &mut self.kept,
        }
    }

    #[inline(always)]
    fn read_value(&mut self, name: &'a [u8], static_index: Option<u8>) -> Result<Field<'_>, Stop> {
        let value = self.input.value()?;
        let room = room(self.buffer, self.kept, name.len() + max_len(value));
        let len = name.len() + store(value, room, name.len())?;
        Ok(Field {
            static_index,
            name_len: name.len(),
            in_table: name,
            room: room.get_mut(..len).unwrap_or_default(),
            kept: &mut self.kept,
        })
    }

    #[inline(always)]
    fn read_name_and_value(&mut self, first: u8) -> Result<Field<'_>, Stop> {
        let (name, value) = (self.input.literal(first, 3)?, self.input.value()?);
        let room = room(self.buffer, self.kept, max_len(name) + max_len(value));
        let name_len = store(name, room, 0)?;
        let len = name_len + store(value, room, name_len)?;
        Ok(Field {
            static_index: None,
            name_len,
            in_table: &[],
            room: room.get_mut(..len).unwrap_or_default(),
            kept: &mut self.kept,
        })
    }
}

impl Field<'_> {
    #[inline(always)]
    pub fn name(&self) -> &[u8] {
        let name = self.in_table.get(..self.name_len);
        name.or_else(|| self.room.get(..self.name_len))
            .unwrap_or_default()
    }

    #[inline(always)]
    pub fn value(&self) -> &[u8] {
        let field = if self.in_table.len() > self.name_len {
            self.in_table
        } else {
            &*self.room
        };
        field.get(self.name_len..).unwrap_or_default()
    }

    /// Leaves the name and, right after it, the value in the buffer. Returns where they start.
    #[inline(always)]
    pub fn keep(self) -> usize {
        let room = self.room.get_mut(..self.in_table.len());
        room.unwrap_or_default().copy_from_slice(self.in_table);
        let start = *self.kept;
        *self.kept += self.room.len();
        start
    }
}

/// The most room that [`store`] needs.
#[inline(always)]
fn max_len(literal: Literal<'_>) -> usize {
    literal.room().max(literal.bytes.len())
}

/// Returns the length of the result.
#[inline(always)]
fn store(literal: Literal<'_>, room: &mut [u8], start: usize) -> Result<usize, Stop> {
    let room = room.get_mut(start..).unwrap_or_default();
    if literal.is_huffman {
        return Ok(huffman::decode(literal.bytes, literal.context, room)?);
    }
    let room = room.get_mut(..literal.bytes.len()).unwrap_or_default();
    room.copy_from_slice(literal.bytes);
    Ok(room.len())
}

#[inline(always)]
fn room(buffer: &mut Vec<u8>, start: usize, len: usize) -> &mut [u8] {
    if buffer.len() < start + len {
        grow(buffer, start + len);
    }
    buffer.get_mut(start..start + len).unwrap_or_default()
}

#[cold]
#[inline(never)]
fn grow(buffer: &mut Vec<u8>, len: usize) {
    buffer.resize(len.max(2 * buffer.len()).max(MIN_BUFFER_LEN), 0);
}
