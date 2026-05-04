use core::cell::Cell;

use bun_str::strings;

use super::any_mysql_error::Error as AnyMySQLError;
use super::new_reader::NewReader;
use crate::shared::data::Data;

// TODO(port): lifetime — `offset`/`message_start` are caller-owned `usize` on the
// stack (LIFETIMES.tsv has no entry; classified BORROW_PARAM). Zig passes `@This()`
// by value (Copy) and mutates through `*usize`; modeled here as `&'a Cell<usize>`
// to keep `Copy` + interior mutability without `unsafe`.
#[derive(Clone, Copy)]
pub struct StackReader<'a> {
    pub buffer: &'a [u8],
    pub offset: &'a Cell<usize>,
    pub message_start: &'a Cell<usize>,
}

impl<'a> StackReader<'a> {
    pub fn mark_message_start(&self) {
        self.message_start.set(self.offset.get());
    }

    pub fn set_offset_from_start(&self, offset: usize) {
        self.offset.set(self.message_start.get() + offset);
    }

    pub fn ensure_capacity(&self, length: usize) -> bool {
        self.buffer.len() >= (self.offset.get() + length)
    }

    pub fn init(
        buffer: &'a [u8],
        offset: &'a Cell<usize>,
        message_start: &'a Cell<usize>,
    ) -> NewReader<StackReader<'a>> {
        // TODO(port): NewReader field name assumed `wrapped` per Zig struct literal
        NewReader {
            wrapped: StackReader {
                buffer,
                offset,
                message_start,
            },
        }
    }

    pub fn peek(&self) -> &'a [u8] {
        &self.buffer[self.offset.get()..]
    }

    pub fn skip(&self, count: isize) {
        if count < 0 {
            let abs_count = count.unsigned_abs();
            if abs_count > self.offset.get() {
                self.offset.set(0);
                return;
            }
            self.offset.set(self.offset.get() - abs_count);
            return;
        }

        let ucount: usize = usize::try_from(count).unwrap();
        if self.offset.get() + ucount > self.buffer.len() {
            self.offset.set(self.buffer.len());
            return;
        }

        self.offset.set(self.offset.get() + ucount);
    }

    pub fn read(&self, count: usize) -> Result<Data, AnyMySQLError> {
        let offset = self.offset.get();
        if !self.ensure_capacity(count) {
            return Err(AnyMySQLError::ShortRead);
        }

        self.skip(isize::try_from(count).unwrap());
        // TODO(port): Data is a union(enum) → Rust enum; `.temporary` variant holds a borrowed slice
        Ok(Data::Temporary(&self.buffer[offset..self.offset.get()]))
    }

    pub fn read_z(&self) -> Result<Data, AnyMySQLError> {
        let remaining = self.peek();
        if let Some(zero) = strings::index_of_char(remaining, 0) {
            self.skip(isize::try_from(zero + 1).unwrap());
            return Ok(Data::Temporary(&remaining[0..zero as usize]));
        }

        Err(AnyMySQLError::ShortRead)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/mysql/protocol/StackReader.zig (78 lines)
//   confidence: medium
//   todos:      3
//   notes:      *usize fields modeled as &Cell<usize> (no LIFETIMES.tsv entry); Data/NewReader shapes assumed
// ──────────────────────────────────────────────────────────────────────────
