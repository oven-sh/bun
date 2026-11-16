use crate::dynamic_table::{DynamicTable, Name, Place};
use crate::{DEFAULT_TABLE_SIZE, Error, MAX_FIELD_LEN, Result, huffman, integer, static_table};

const MIN_SCRATCH_LEN: usize = 256;
const MAX_SCRATCH_LEN: usize = MAX_FIELD_LEN + huffman::SLACK;

/// The state of one direction of a connection. After an error it is out of step with the peer.
pub struct Decoder {
    table: DynamicTable<()>,
    /// What the peer may raise the size of the table to.
    size_limit: usize,
}

pub struct Field<'a> {
    /// Not empty.
    pub name: &'a [u8],
    pub value: &'a [u8],
    pub never_index: bool,
    /// Of an entry with this name if the peer referred to it, or 0.
    pub static_index: u8,
}

/// The fields of a header block, all of which have to be read.
#[must_use]
pub struct Fields<'a> {
    table: &'a mut DynamicTable<()>,
    scratch: &'a mut Vec<u8>,
    block: &'a [u8],
    rest: &'a [u8],
}

impl Decoder {
    pub fn new() -> Self {
        Self {
            table: DynamicTable::new(),
            size_limit: DEFAULT_TABLE_SIZE,
        }
    }

    /// For when the peer acknowledges a `SETTINGS_HEADER_TABLE_SIZE`.
    pub fn set_max_table_size(&mut self, max_table_size: u32) {
        self.size_limit = max_table_size as usize;
        self.table.set_max_size(self.size_limit);
    }

    /// Accepts size updates up to `max_table_size` ahead of that.
    pub fn allow_table_size(&mut self, max_table_size: u32) {
        self.size_limit = self.size_limit.max(max_table_size as usize);
    }

    /// `block` is a whole header block. `scratch` is only of use during it, so decoders can share one.
    #[inline]
    pub fn decode<'a>(&'a mut self, block: &'a [u8], scratch: &'a mut Vec<u8>) -> Fields<'a> {
        let rest = match block.first() {
            Some(0x20..0x40) => self.read_size_updates(block),
            _ => block,
        };
        Fields {
            table: &mut self.table,
            scratch,
            block,
            rest,
        }
    }

    /// Returns what follows them.
    #[inline(never)]
    fn read_size_updates<'a>(&mut self, mut rest: &'a [u8]) -> &'a [u8] {
        let (mut smallest, mut last) = (usize::MAX, self.table.max_size());
        while let &[first @ 0x20..0x40, ref after @ ..] = rest {
            let mut after = after;
            match integer::read(first, 5, &mut after) {
                Ok(size) if size <= self.size_limit => {
                    (smallest, last) = (smallest.min(size), size)
                }
                // For `next` to refuse, like any size update that it comes across.
                _ => break,
            }
            rest = after;
        }
        self.table.set_max_size(smallest.min(last));
        self.table.set_max_size(last);
        rest
    }
}

/// A string literal (RFC 7541 §5.2).
#[derive(Clone, Copy)]
struct Literal<'a> {
    bytes: &'a [u8],
    /// The block as far as the end of `bytes`.
    context: &'a [u8],
    is_huffman: bool,
}

impl<'a> Literal<'a> {
    /// The most that [`Self::decode`] needs.
    #[inline(always)]
    fn room(self) -> usize {
        if self.is_huffman {
            huffman::max_decoded_len(self.bytes.len()) + huffman::SLACK
        } else {
            0
        }
    }

    /// Takes what it fills off `room`.
    #[inline(always)]
    fn decode(self, room: &mut &'a mut [u8]) -> Result<&'a [u8]> {
        if !self.is_huffman {
            return Ok(self.bytes);
        }
        let len = huffman::decode(self.bytes, self.context, room)?;
        Ok(room.split_off_mut(..len).unwrap_or_default())
    }
}

impl<'a> Fields<'a> {
    #[inline(always)]
    pub fn next(&mut self) -> Result<Option<Field<'_>>> {
        let Some(&first) = self.rest.split_off_first() else {
            return Ok(None);
        };
        if first < 0x80 {
            return self.read_literal(first).map(Some);
        }
        let (name, value, static_index) = match integer::read(first, 7, &mut self.rest)? {
            index @ 1..=static_table::LEN => {
                let index = index as u8;
                (static_table::name(index), static_table::value(index), index)
            }
            index => {
                let place = self.entry(index)?;
                let table = &*self.table;
                let name = table.name(place.name());
                (name, table.value(place), place.static_index)
            }
        };
        Ok(Some(Field {
            name,
            value,
            never_index: false,
            static_index,
        }))
    }

    #[inline(always)]
    fn entry(&self, index: usize) -> Result<Place> {
        let entry = self.table.get(index.wrapping_sub(static_table::LEN + 1));
        Ok(entry.ok_or(Error::Malformed)?.place)
    }

    #[inline(always)]
    fn read_string(&mut self) -> Result<Literal<'a>> {
        let &first = self.rest.split_off_first().ok_or(Error::Malformed)?;
        let len = integer::read(first, 7, &mut self.rest)?;
        let bytes = self.rest.split_off(..len).ok_or(Error::Malformed)?;
        let (context, _) = self.block.split_at(self.block.len() - self.rest.len());
        Ok(Literal {
            bytes,
            context,
            is_huffman: first >= 0x80,
        })
    }

    #[inline(never)]
    fn read_literal(&mut self, first: u8) -> Result<Field<'_>> {
        let index = match first {
            0x40.. => integer::read(first, 6, &mut self.rest)?,
            0x20.. => return Err(Error::Malformed),
            _ => integer::read(first, 4, &mut self.rest)?,
        };
        let static_index = match index {
            0 => return self.read_name_and_value(first),
            1..=static_table::LEN => index as u8,
            _ => match self.entry(index)?.name() {
                Name::Static(index) => index,
                name => return self.read_value(first, name),
            },
        };
        self.read_value(first, Name::Static(static_index))
    }

    #[inline(always)]
    fn read_name_and_value(&mut self, first: u8) -> Result<Field<'_>> {
        let (name, value) = (self.read_string()?, self.read_string()?);
        let mut room = room(self.scratch, name.room() + value.room());
        match name.decode(&mut room)? {
            [] => Err(Error::Malformed),
            name => field(self.table, first, Name::New(name), value.decode(&mut room)?),
        }
    }

    #[inline(always)]
    fn read_value(&mut self, first: u8, name: Name<'static>) -> Result<Field<'_>> {
        let value = self.read_string()?;
        let value = value.decode(&mut room(self.scratch, value.room()))?;
        field(self.table, first, name, value)
    }
}

#[inline(always)]
fn field<'a>(
    table: &'a mut DynamicTable<()>,
    first: u8,
    mut name: Name<'a>,
    value: &'a [u8],
) -> Result<Field<'a>> {
    if table.name(name).len() + value.len() > MAX_FIELD_LEN {
        return Err(Error::FieldTooLong);
    }
    if first >= 0x40
        && let Some(place) = table.insert(name, value, ())
        && let Name::Stored(..) = name
    {
        name = place.name();
    }
    Ok(Field {
        name: table.name(name),
        value,
        never_index: (0x10..0x20).contains(&first),
        static_index: name.static_index(),
    })
}

#[inline(always)]
fn room(scratch: &mut Vec<u8>, len: usize) -> &mut [u8] {
    if scratch.len() < len.min(MAX_SCRATCH_LEN) {
        let len = len.max(2 * scratch.len());
        *scratch = vec![0; len.clamp(MIN_SCRATCH_LEN, MAX_SCRATCH_LEN)];
    }
    scratch
}
