//! Owned `z_stream` reached only through a raw pointer: zlib-ng keeps its own
//! pointer to the stream from init on, so a `&mut` to it across a zlib call
//! is an aliasing violation (oven-sh/bun#46598).

use core::ffi::{c_char, c_int};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_zlib_sys::shared::{DataType, ReturnCode, uInt, uLong, zStream_struct};

#[allow(non_snake_case)]
mod ZlibAllocator {
    bun_alloc::c_thunks_for_zone!("zlib");
    pub(crate) use malloc_items as alloc;
}

/// Heap-pinned `z_stream`. The owner ends the zlib state before this drops.
pub struct ZStream {
    ptr: NonNull<zStream_struct>,
}

impl Default for ZStream {
    fn default() -> Self {
        Self::new()
    }
}

impl ZStream {
    /// A zeroed stream with Bun's zlib allocator installed.
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

    /// The pointer to hand to zlib.
    #[inline]
    pub fn as_ptr(&self) -> *mut zStream_struct {
        self.ptr.as_ptr()
    }

    /// `deflateInit2_` against the linked zlib's version and struct size.
    pub fn deflate_init(
        &mut self,
        level: c_int,
        method: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
    ) -> ReturnCode {
        // SAFETY: `ptr` is a live z_stream; version/size match the linked zlib.
        unsafe {
            crate::deflateInit2_(
                self.as_ptr(),
                level,
                method,
                window_bits,
                mem_level,
                strategy,
                crate::zlibVersion().cast::<u8>(),
                size_of::<zStream_struct>() as c_int,
            )
        }
    }

    /// `inflateInit2_` against the linked zlib's version and struct size.
    pub fn inflate_init(&mut self, window_bits: c_int) -> ReturnCode {
        // SAFETY: `ptr` is a live z_stream; version/size match the linked zlib.
        unsafe {
            crate::inflateInit2_(
                self.as_ptr(),
                window_bits,
                crate::zlibVersion().cast::<u8>(),
                size_of::<zStream_struct>() as c_int,
            )
        }
    }

    #[inline]
    pub fn next_in(&self) -> *const u8 {
        // SAFETY: `ptr` is a live allocation owned by `self`, read through
        // the raw pointer only.
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

    /// `msg` as bytes, if zlib set one.
    pub fn error_message(&self) -> Option<&[u8]> {
        let msg = self.err_msg();
        if msg.is_null() {
            return None;
        }
        // SAFETY: zlib sets `msg` to a NUL-terminated static C string.
        Some(unsafe { bun_core::ffi::cstr(msg) }.to_bytes())
    }

    /// Point `next_in`/`avail_in` at the next input chunk.
    #[inline]
    pub fn set_input(&mut self, next_in: *const u8, avail_in: uInt) {
        // SAFETY: see `next_in`.
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
        // here, after the owner ended the zlib state.
        unsafe { bun_core::heap::destroy(self.ptr.as_ptr()) };
    }
}
