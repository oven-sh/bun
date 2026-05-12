use crate::postgres::any_postgres_error::AnyPostgresError;
use crate::postgres::protocol::new_reader::{NewReader, ReaderContext};
use crate::shared::data::Data;
use bun_core::strings;

// TODO(port): lifetime — `offset`/`message_start` are `*usize` fields not present in
// LIFETIMES.tsv; classified here as BORROW_PARAM by inspection (struct is named
// "StackReader" and is only ever constructed on the caller's stack via `init`).
pub struct StackReader<'a> {
    pub buffer: &'a [u8],
    pub offset: &'a mut usize,
    pub message_start: &'a mut usize,
}

impl<'a> StackReader<'a> {
    pub fn mark_message_start(&mut self) {
        *self.message_start = *self.offset;
    }

    pub fn ensure_length(&self, length: usize) -> bool {
        self.buffer.len() >= (*self.offset + length)
    }

    pub fn init(
        buffer: &'a [u8],
        offset: &'a mut usize,
        message_start: &'a mut usize,
    ) -> NewReader<StackReader<'a>> {
        NewReader {
            wrapped: StackReader {
                buffer,
                offset,
                message_start,
            },
        }
    }

    pub fn peek(&self) -> &[u8] {
        &self.buffer[*self.offset..]
    }

    pub fn skip(&mut self, count: usize) {
        if *self.offset + count > self.buffer.len() {
            *self.offset = self.buffer.len();
            return;
        }

        *self.offset += count;
    }

    pub fn ensure_capacity(&self, count: usize) -> bool {
        self.buffer.len() >= (*self.offset + count)
    }

    pub fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        let offset = *self.offset;
        if !self.ensure_capacity(count) {
            return Err(AnyPostgresError::ShortRead);
        }

        self.skip(count);
        // PORT NOTE: reshaped for borrowck — copy the &'a [u8] out before slicing so the
        // returned Data borrows 'a, not &mut self.
        let buffer: &'a [u8] = self.buffer;
        Ok(Data::Temporary(bun_ptr::RawSlice::new(
            &buffer[offset..*self.offset],
        )))
    }

    pub fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        // PORT NOTE: reshaped for borrowck — inline `peek()` so `remaining` borrows 'a
        // (via the Copy &'a [u8]) instead of &self, allowing `self.skip()` below.
        let buffer: &'a [u8] = self.buffer;
        let remaining = &buffer[*self.offset..];
        if let Some(zero) = strings::index_of_char(remaining, 0) {
            let zero = zero as usize;
            self.skip(zero + 1);
            return Ok(Data::Temporary(bun_ptr::RawSlice::new(&remaining[0..zero])));
        }

        Err(AnyPostgresError::ShortRead)
    }
}

impl<'a> ReaderContext for StackReader<'a> {
    fn mark_message_start(&mut self) {
        Self::mark_message_start(self)
    }
    fn peek(&self) -> &[u8] {
        Self::peek(self)
    }
    fn skip(&mut self, count: usize) {
        Self::skip(self, count)
    }
    fn ensure_length(&mut self, count: usize) -> bool {
        Self::ensure_length(self, count)
    }
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        Self::read(self, count)
    }
    fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        Self::read_z(self)
    }
}

// ported from: src/sql/postgres/protocol/StackReader.zig
