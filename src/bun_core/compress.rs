//! Shared by the streaming (de)compressors in `bun_brotli` / `bun_zlib` / `bun_zstd`.

use core::marker::PhantomData;
use core::ptr;

use crate::vec::BorrowedCursor;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum State {
    Uninitialized,
    Inflating,
    End,
    Error,
}

/// The input and the output of one call to a C codec.
///
/// # Safety
/// Until `advance`, the input of `as_raw` is valid for reads and its output for writes. They do not overlap.
pub unsafe trait Buffers {
    fn as_raw(&mut self) -> (*const [u8], *mut [u8]);
    /// # Safety
    /// Neither count exceeds the length of its buffer, and the first `written` bytes of the output are initialized.
    unsafe fn advance(&mut self, consumed: usize, written: usize);
}

// SAFETY: a shared and an exclusive borrow.
unsafe impl Buffers for (&[u8], BorrowedCursor<'_, u8>) {
    fn as_raw(&mut self) -> (*const [u8], *mut [u8]) {
        // SAFETY: nothing is written here.
        (self.0, unsafe { &raw mut *self.1.as_mut() } as *mut [u8])
    }
    unsafe fn advance(&mut self, _: usize, written: usize) {
        // SAFETY: fn contract.
        unsafe { self.1.advance(written) };
    }
}

/// A codec's unread input and unwritten output. Pointers, because script can write to both during the call.
pub struct RawBuffers<'a> {
    input: *const [u8],
    out: *mut [u8],
    _borrow: PhantomData<&'a mut [u8]>,
}

impl<'a> RawBuffers<'a> {
    pub fn new(input: &'a [u8], out: &'a mut [u8]) -> Self {
        // SAFETY: a shared and an exclusive borrow.
        unsafe { Self::from_raw(input, out) }
    }

    /// # Safety
    /// For `'a`, `input` is valid for reads and `out` for writes. Neither is null, and they do not overlap.
    pub unsafe fn from_raw(input: *const [u8], out: *mut [u8]) -> Self {
        Self {
            input,
            out,
            _borrow: PhantomData,
        }
    }

    pub fn avail_in(&self) -> usize {
        self.input.len()
    }

    pub fn avail_out(&self) -> usize {
        self.out.len()
    }

    pub fn input_byte(&self, index: usize) -> Option<u8> {
        let input = self.input.cast::<u8>();
        // SAFETY: in bounds. Volatile, because script may be storing to the byte.
        (index < self.input.len()).then(|| unsafe { input.add(index).read_volatile() })
    }
}

// SAFETY: the contracts of `from_raw` and of `advance`.
unsafe impl Buffers for &mut RawBuffers<'_> {
    fn as_raw(&mut self) -> (*const [u8], *mut [u8]) {
        (self.input, self.out)
    }
    unsafe fn advance(&mut self, consumed: usize, written: usize) {
        self.input = ptr::slice_from_raw_parts(
            self.input.cast::<u8>().wrapping_add(consumed),
            self.input.len() - consumed,
        );
        self.out = ptr::slice_from_raw_parts_mut(
            self.out.cast::<u8>().wrapping_add(written),
            self.out.len() - written,
        );
    }
}
