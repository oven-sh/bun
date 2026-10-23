//! Owned `z_stream` that Rust reaches only through a raw pointer.
//!
//! zlib-ng keeps a back-pointer to the `z_stream` in its internal state from
//! init on (`deflate.c`: `s->strm = strm`, `inflate.c`: `state->strm = strm`)
//! and reads and writes `avail_in`, `next_out`, `avail_out`, `total_out`
//! through it inside every later call. A `&mut zStream_struct` (or a `&mut`
//! to a struct that holds one inline) that is alive across such a call makes
//! that access a foreign access to a protected borrow, which is undefined
//! behaviour under both Stacked Borrows and Tree Borrows, and lets LLVM treat
//! the parameter as `noalias` under cross-language LTO. rust-lang/flate2-rs#392
//! is the same bug against the same library.
//!
//! [`ZStream`] is the one place every stream owner goes through. It never
//! hands out a reference to the stream: field access is a read or write
//! through the stored pointer, and the C calls take [`ZStream::as_ptr`].

use core::ffi::{c_char, c_int};
use core::ptr::NonNull;

use bun_zlib_sys::shared::{DataType, uInt, uLong, zStream_struct};

#[allow(non_snake_case)]
mod ZlibAllocator {
    bun_alloc::c_thunks_for_zone!("zlib");
    pub(crate) use malloc_items as alloc;
}

/// Heap-pinned `z_stream`. The owner calls `deflateEnd`/`inflateEnd` on
/// [`as_ptr`](Self::as_ptr) before this drops. `Drop` frees only the
/// `z_stream` allocation itself.
pub struct ZStream {
    ptr: NonNull<zStream_struct>,
}

impl Default for ZStream {
    fn default() -> Self {
        Self::new()
    }
}

impl ZStream {
    /// A zeroed stream with Bun's zlib allocator installed. Ready for
    /// `deflateInit2_`/`inflateInit2_`.
    pub fn new() -> Self {
        let ptr = bun_core::heap::alloc_nn(zStream_struct {
            next_in: core::ptr::null(),
            avail_in: 0,
            total_in: 0,
            next_out: core::ptr::null_mut(),
            avail_out: 0,
            total_out: 0,
            err_msg: core::ptr::null(),
            alloc_func: Some(ZlibAllocator::alloc),
            free_func: Some(ZlibAllocator::free),
            internal_state: core::ptr::null_mut(),
            user_data: core::ptr::null_mut(),
            data_type: DataType::Unknown as c_int,
            adler: 0,
            reserved: 0,
        });
        Self { ptr }
    }

    /// The pointer to hand to zlib. Every call into zlib for this stream
    /// uses this same pointer, so the back-pointer zlib stores at init stays
    /// valid for the life of the stream.
    #[inline]
    pub fn as_ptr(&self) -> *mut zStream_struct {
        self.ptr.as_ptr()
    }

    #[inline]
    pub fn next_in(&self) -> *const u8 {
        // SAFETY: `ptr` is a live allocation owned by `self`. No reference to
        // the stream exists, so a read through the raw pointer is the only
        // Rust-side access.
        unsafe { (*self.as_ptr()).next_in }
    }

    #[inline]
    pub fn avail_in(&self) -> uInt {
        // SAFETY: see `next_in`.
        unsafe { (*self.as_ptr()).avail_in }
    }

    #[inline]
    pub fn avail_out(&self) -> uInt {
        // SAFETY: see `next_in`.
        unsafe { (*self.as_ptr()).avail_out }
    }

    #[inline]
    pub fn total_out(&self) -> uLong {
        // SAFETY: see `next_in`.
        unsafe { (*self.as_ptr()).total_out }
    }

    #[inline]
    pub fn err_msg(&self) -> *const c_char {
        // SAFETY: see `next_in`.
        unsafe { (*self.as_ptr()).err_msg }
    }

    /// `msg` as bytes, if zlib set one. zlib only ever points `msg` at a
    /// static string.
    pub fn error_message(&self) -> Option<&[u8]> {
        let msg = self.err_msg();
        if msg.is_null() {
            return None;
        }
        // SAFETY: zlib sets `msg` to a NUL-terminated static C string.
        Some(unsafe { bun_core::ffi::cstr(msg) }.to_bytes())
    }

    /// Point `next_in`/`avail_in` at the next input chunk. `avail_in` is
    /// 32 bits; the caller clamps and loops.
    #[inline]
    pub fn set_input(&mut self, next_in: *const u8, avail_in: uInt) {
        // SAFETY: see `next_in`. The write goes through the raw pointer, so
        // it does not retag the stream.
        unsafe {
            (*self.as_ptr()).next_in = next_in;
            (*self.as_ptr()).avail_in = avail_in;
        }
    }

    /// Point `next_out`/`avail_out` at the next output window.
    #[inline]
    pub fn set_output(&mut self, next_out: *mut u8, avail_out: uInt) {
        // SAFETY: see `set_input`.
        unsafe {
            (*self.as_ptr()).next_out = next_out;
            (*self.as_ptr()).avail_out = avail_out;
        }
    }
}

impl Drop for ZStream {
    fn drop(&mut self) {
        // SAFETY: `ptr` came from `heap::alloc_nn` in `new` and is freed once,
        // here. The owner has already ended the zlib state, so zlib holds no
        // live pointer into it.
        unsafe { bun_core::heap::destroy(self.ptr.as_ptr()) };
    }
}
