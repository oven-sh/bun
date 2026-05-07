use crate::postgres::AnyPostgresError;
use super::new_writer::{NewWriter, WriterContext};

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

// PORT NOTE: Zig methods took `@This()` by value (a `*ArrayList(u8)` is Copy).
// `WriterContext` requires `Copy`, so the context wraps a raw pointer to the
// caller's `Vec<u8>` and the `'a` borrow is the safety invariant.
#[derive(Clone, Copy)]
pub struct ArrayListCtx<'a> {
    array: *mut Vec<u8>,
    _p: core::marker::PhantomData<&'a mut Vec<u8>>,
}

impl<'a> ArrayListCtx<'a> {
    #[inline]
    pub fn new(array: &'a mut Vec<u8>) -> Self {
        Self { array: std::ptr::from_mut::<Vec<u8>>(array), _p: core::marker::PhantomData }
    }
}

impl<'a> WriterContext for ArrayListCtx<'a> {
    fn offset(self) -> usize {
        // SAFETY: 'a guarantees the Vec outlives this ctx; no aliasing &mut held.
        unsafe { (&*self.array).len() }
    }
    fn write(self, bytes: &[u8]) -> Result<(), AnyPostgresError> {
        // SAFETY: same as above.
        unsafe { (&mut *self.array).extend_from_slice(bytes) };
        Ok(())
    }
    fn pwrite(self, bytes: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        // SAFETY: same as above.
        unsafe { (&mut *self.array)[i..i + bytes.len()].copy_from_slice(bytes) };
        Ok(())
    }
}

pub type Writer<'a> = NewWriter<ArrayListCtx<'a>>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/protocol/ArrayList.zig (19 lines)
//   confidence: medium
//   todos:      1
//   notes:      Zig methods took `@This()` by value (Copy ptr); reshaped to `&mut self`. NewWriter<T> assumed to be a generic struct (Phase B: verify trait bounds).
// ──────────────────────────────────────────────────────────────────────────
