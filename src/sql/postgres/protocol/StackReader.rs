use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::protocol::new_reader::NewReader;
use bun_sql::shared::data::Data;
use bun_str::strings;

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
        // TODO(port): Data is a Zig union(enum); assuming Rust enum variant `Temporary(&[u8])`.
        Ok(Data::Temporary(&buffer[offset..*self.offset]))
    }

    pub fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        // PORT NOTE: reshaped for borrowck — inline `peek()` so `remaining` borrows 'a
        // (via the Copy &'a [u8]) instead of &self, allowing `self.skip()` below.
        let buffer: &'a [u8] = self.buffer;
        let remaining = &buffer[*self.offset..];
        if let Some(zero) = strings::index_of_char(remaining, 0) {
            let zero = zero as usize;
            self.skip(zero + 1);
            return Ok(Data::Temporary(&remaining[0..zero]));
        }

        Err(AnyPostgresError::ShortRead)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/StackReader.zig (65 lines)
//   confidence: medium
//   todos:      2
//   notes:      *usize fields not in LIFETIMES.tsv → assumed BORROW_PARAM (<'a>); Data variant shape assumed
// ──────────────────────────────────────────────────────────────────────────
