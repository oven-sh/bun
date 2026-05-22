use super::new_writer::{NewWriter, WriterContext};
use crate::postgres::AnyPostgresError;

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
// `WriterContext` requires `Copy`, so the context wraps a `BackRef` to the
// caller's `Vec<u8>`; the `'a` borrow is the safety invariant (Vec outlives ctx).
#[derive(Clone, Copy)]
pub struct ArrayListCtx<'a> {
    array: bun_ptr::BackRef<Vec<u8>>,
    _p: core::marker::PhantomData<&'a mut Vec<u8>>,
}

impl<'a> ArrayListCtx<'a> {
    #[inline]
    pub fn new(array: &'a mut Vec<u8>) -> Self {
        Self {
            array: bun_ptr::BackRef::new_mut(array),
            _p: core::marker::PhantomData,
        }
    }

    /// One audited `BackRef::get_mut` so the `WriterContext` impl below stays
    /// `unsafe`-free at the call sites (nonnull-asref accessor pattern).
    #[inline]
    fn array_mut(&mut self) -> &mut Vec<u8> {
        // SAFETY: 'a guarantees the Vec outlives this ctx; constructed via
        // `new_mut` (write provenance); `WriterContext` is used single-threaded
        // with no overlapping `&`/`&mut` to the same Vec while the returned
        // borrow is live.
        unsafe { self.array.get_mut() }
    }
}

impl<'a> WriterContext for ArrayListCtx<'a> {
    fn offset(self) -> usize {
        self.array.len()
    }
    fn write(mut self, bytes: &[u8]) -> Result<(), AnyPostgresError> {
        self.array_mut().extend_from_slice(bytes);
        Ok(())
    }
    fn pwrite(mut self, bytes: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        let arr = self.array_mut();
        arr[i..i + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }
}

pub type Writer<'a> = NewWriter<ArrayListCtx<'a>>;

// ported from: src/sql/postgres/protocol/ArrayList.zig
