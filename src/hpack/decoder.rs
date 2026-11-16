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

    /// `block` is a whole header block.
    #[inline]
    pub fn decode<'a>(&'a mut self, block: &'a [u8]) -> Fields<'a> {
        let rest = match block.first() {
            Some(0x20..0x40) => self.read_size_updates(block),
            _ => block,
        };
        let table = &mut self.table;
        Fields { table, block, rest }
    }

    /// Returns what follows them.
    #[inline(never)]
    fn read_size_updates<'a>(&mut self, mut rest: &'a [u8]) -> &'a [u8] {
        while let &[first @ 0x20..0x40, ref after @ ..] = rest {
            let mut after = after;
            match integer::read(first, 5, &mut after) {
                Ok(size) if size <= self.size_limit => self.table.set_max_size(size),
                // For `next` to refuse, like any size update that it comes across.
                _ => break,
            }
            rest = after;
        }
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

impl Literal<'_> {
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
            return huffman::decode(self.bytes, self.context, out);
        }
        let out = out.get_mut(..self.bytes.len());
        out.ok_or(Error::FieldTooLong)?.copy_from_slice(self.bytes);
        Ok(self.bytes.len())
    }
}

impl<'a> Fields<'a> {
    #[inline(always)]
    pub fn next(&mut self) -> Result<Option<Field<'_>>> {
        let Some(&first) = self.rest.split_off_first() else {
            self.table.trim();
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
                (table.name(place), table.value(place), place.static_index)
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
        let is_for_table = first >= 0x40;
        let index = match first {
            0x40.. => integer::read(first, 6, &mut self.rest)?,
            0x20.. => return Err(Error::Malformed),
            _ => integer::read(first, 4, &mut self.rest)?,
        };
        let (with_name, name_len_in_room, value);
        if index == 0 {
            let name = self.read_string()?;
            value = self.read_string()?;
            self.make_room(name.max_len() + value.max_len());
            name_len_in_room = name.decode(self.table.room())?;
            if name_len_in_room == 0 {
                return Err(Error::Malformed);
            }
            with_name = self.table.place_in_room(0, name_len_in_room, 0);
        } else {
            with_name = match index {
                ..=static_table::LEN => self.table.place_in_room(index as u8, 0, 0),
                _ => self.entry(index)?,
            };
            value = self.read_string()?;
            name_len_in_room = if is_for_table {
                with_name.name_len as usize
            } else {
                0
            };
            self.make_room(name_len_in_room + value.max_len());
            if name_len_in_room != 0 {
                self.table.copy_name_to_room(with_name);
            }
        }
        let room = self.table.room().get_mut(name_len_in_room..);
        let value_len = value.decode(room.unwrap_or_default())?;
        if self.table.name(with_name).len() + value_len > MAX_FIELD_LEN {
            return Err(Error::FieldTooLong);
        }
        let static_index = with_name.static_index;
        let place = self
            .table
            .place_in_room(static_index, name_len_in_room, value_len);
        if is_for_table {
            self.table.insert(place, ());
        }
        Ok(Field {
            name: self.table.name(with_name),
            value: self.table.value(place),
            never_index: (0x10..0x20).contains(&first),
            static_index,
        })
    }

    #[inline(always)]
    fn make_room(&mut self, max_len: usize) {
        self.table
            .make_room(MAX_FIELD_LEN.min(max_len) + huffman::SLACK);
    }
}
