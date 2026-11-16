use crate::dynamic_table::{DynamicTable, Place};
use crate::{DEFAULT_TABLE_SIZE, Error, MAX_FIELD_LEN, Result, huffman, integer, static_table};

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
pub struct Fields<'a> {
    table: &'a mut DynamicTable<()>,
    rest: &'a [u8],
}

impl Decoder {
    pub fn new() -> Self {
        Self {
            table: DynamicTable::new(DEFAULT_TABLE_SIZE),
            size_limit: DEFAULT_TABLE_SIZE,
        }
    }

    /// For when the peer acknowledges a `SETTINGS_HEADER_TABLE_SIZE`.
    pub fn set_max_table_size(&mut self, max_table_size: u32) {
        self.size_limit = max_table_size as usize;
        self.table.set_max_size(self.size_limit);
    }

    /// `block` is a whole header block.
    pub fn decode<'a>(&'a mut self, block: &'a [u8]) -> Fields<'a> {
        let mut rest = block;
        while let &[first @ 0x20..0x40, ref after @ ..] = rest {
            let mut after = after;
            match integer::read(first, 5, &mut after) {
                Ok(size) if size <= self.size_limit => self.table.set_max_size(size),
                // For `next` to refuse, like any size update that it comes across.
                _ => break,
            }
            rest = after;
        }
        let table = &mut self.table;
        Fields { table, rest }
    }
}

/// A string literal (RFC 7541 §5.2).
#[derive(Clone, Copy)]
struct Literal<'a> {
    bytes: &'a [u8],
    is_huffman: bool,
}

impl<'a> Literal<'a> {
    #[inline(always)]
    fn read(rest: &mut &'a [u8]) -> Result<Self> {
        let &first = rest.split_off_first().ok_or(Error::Malformed)?;
        let len = integer::read(first, 7, rest)?;
        Ok(Self {
            bytes: rest.split_off(..len).ok_or(Error::Malformed)?,
            is_huffman: first >= 0x80,
        })
    }

    #[inline(always)]
    fn max_len(self) -> usize {
        if self.is_huffman {
            huffman::max_decoded_len(self.bytes.len())
        } else {
            self.bytes.len()
        }
    }

    #[inline(always)]
    fn decode(self, out: &mut [u8]) -> Result<usize> {
        if self.is_huffman {
            return huffman::decode(self.bytes, out);
        }
        let out = out.get_mut(..self.bytes.len());
        out.ok_or(Error::FieldTooLong)?.copy_from_slice(self.bytes);
        Ok(self.bytes.len())
    }
}

impl Fields<'_> {
    #[inline]
    pub fn next(&mut self) -> Result<Option<Field<'_>>> {
        let Some(&first) = self.rest.split_off_first() else {
            let usual_size = self.table.max_size().max(DEFAULT_TABLE_SIZE);
            self.table.trim(usual_size.saturating_mul(4));
            return Ok(None);
        };
        let place = match first {
            0x80.. => match integer::read(first, 7, &mut self.rest)? {
                index @ 1..=static_table::LEN => {
                    return Ok(Some(Field {
                        name: static_table::name(index as u8),
                        value: static_table::value(index as u8),
                        never_index: false,
                        static_index: index as u8,
                    }));
                }
                index => self.entry(index)?,
            },
            0x40.. => {
                let place = self.read_literal(first, 6)?;
                self.table.insert(place, ());
                place
            }
            0x20.. => return Err(Error::Malformed),
            _ => self.read_literal(first, 4)?,
        };
        let (name, value) = self.table.field(place);
        Ok(Some(Field {
            name,
            value,
            never_index: (0x10..0x20).contains(&first),
            static_index: place.static_index,
        }))
    }

    #[inline(always)]
    fn entry(&self, index: usize) -> Result<Place> {
        let entry = self.table.get(index.wrapping_sub(static_table::LEN + 1));
        Ok(entry.ok_or(Error::Malformed)?.place)
    }

    /// Writes the field to the room of the table.
    #[inline(always)]
    fn read_literal(&mut self, first: u8, prefix_bits: u32) -> Result<Place> {
        enum Name<'a> {
            Static(u8),
            Stored { start: usize },
            Literal(Literal<'a>),
        }
        let (name, max_name_len) = match integer::read(first, prefix_bits, &mut self.rest)? {
            0 => {
                let name = Literal::read(&mut self.rest)?;
                (Name::Literal(name), name.max_len())
            }
            index @ ..=static_table::LEN => (Name::Static(index as u8), 0),
            index => match self.entry(index)? {
                Place {
                    static_index: 0,
                    start,
                    name_len,
                    ..
                } => (Name::Stored { start }, name_len as usize),
                place => (Name::Static(place.static_index), 0),
            },
        };
        let value = Literal::read(&mut self.rest)?;

        let max_len = MAX_FIELD_LEN.min(max_name_len + value.max_len());
        let moved = self.table.make_room(max_len + huffman::SLACK);
        let (static_index, name_len) = match name {
            Name::Static(index) => (index, 0),
            Name::Stored { start } => {
                self.table.copy_to_room(start - moved, max_name_len);
                (0, max_name_len)
            }
            Name::Literal(name) => match name.decode(self.table.room().0)? {
                0 => return Err(Error::Malformed),
                len => (0, len),
            },
        };
        let (room, start) = self.table.room();
        let value_len = value.decode(room.get_mut(name_len..).unwrap_or_default())?;
        if static_table::name(static_index).len() + name_len + value_len > MAX_FIELD_LEN {
            return Err(Error::FieldTooLong);
        }
        Ok(Place {
            start,
            name_len: name_len as u32,
            value_len: value_len as u32,
            static_index,
        })
    }
}
