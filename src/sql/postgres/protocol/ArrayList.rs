use crate::postgres::AnyPostgresError;
use super::new_writer::NewWriter;

pub struct ArrayList<'a> {
    // TODO(port): lifetime — Zig `*std.array_list.Managed(u8)`; classified as BORROW_PARAM (mutable borrow of caller's buffer)
    pub array: &'a mut Vec<u8>,
}

impl<'a> ArrayList<'a> {
    pub fn offset(&self) -> usize {
        self.array.len()
    }

    pub fn write(&mut self, bytes: &[u8]) -> Result<(), AnyPostgresError> {
        self.array.extend_from_slice(bytes);
        Ok(())
    }

    pub fn pwrite(&mut self, bytes: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        self.array[i..i + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }
}

pub type Writer<'a> = NewWriter<ArrayList<'a>>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/ArrayList.zig (19 lines)
//   confidence: medium
//   todos:      1
//   notes:      Zig methods took `@This()` by value (Copy ptr); reshaped to `&mut self`. NewWriter<T> assumed to be a generic struct (Phase B: verify trait bounds).
// ──────────────────────────────────────────────────────────────────────────
