//! Owned `z_stream` reached only through a raw pointer: zlib-ng keeps its own
//! pointer to the stream from init on, so a `&mut` to it across a zlib call
//! is an aliasing violation (oven-sh/bun#46598).

use core::ffi::{CStr, c_int};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_core::vec::BorrowedCursor;
use bun_zlib_sys::shared::{DataType, ReturnCode, uInt, z_streamp, zStream_struct};

#[allow(non_snake_case)]
mod ZlibAllocator {
    bun_alloc::c_thunks_for_zone!(c"zlib");
    pub(crate) use malloc_items as alloc;
}

/// Heap-pinned `z_stream`. The owner ends the zlib state before this drops.
pub(crate) struct ZStream {
    ptr: NonNull<zStream_struct>,
}

// SAFETY: the stream and the zlib state behind it are heap memory that only `self` reaches, and
// their allocator frees on any thread.
unsafe impl Send for ZStream {}

impl ZStream {
    /// A zeroed stream with Bun's zlib allocator installed.
    pub(crate) fn new() -> Self {
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

    /// `next_in` and `next_out` dangle outside `with_buffers`: only for calls that dereference neither.
    #[inline]
    pub(crate) fn as_ptr(&self) -> z_streamp {
        self.ptr.as_ptr()
    }

    /// `deflateInit2_` against the linked zlib's version and struct size.
    pub(crate) fn deflate_init(
        &mut self,
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
    ) -> ReturnCode {
        const Z_DEFLATED: c_int = 8;
        // SAFETY: `ptr` is a live z_stream; version/size match the linked zlib.
        unsafe {
            crate::deflateInit2_(
                self.as_ptr(),
                level,
                Z_DEFLATED,
                window_bits,
                mem_level,
                strategy,
                crate::zlibVersion().cast::<u8>(),
                size_of::<zStream_struct>() as c_int,
            )
        }
    }

    /// `inflateInit2_` against the linked zlib's version and struct size.
    pub(crate) fn inflate_init(&mut self, window_bits: c_int) -> ReturnCode {
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
    pub(crate) fn avail_out(&self) -> uInt {
        // SAFETY: `ptr` is a live allocation owned by `self`, read through
        // the raw pointer only.
        unsafe { (*self.as_ptr()).avail_out }
    }

    /// `msg`, if zlib set one.
    pub(crate) fn error_message(&self) -> Option<&'static CStr> {
        // SAFETY: see `avail_out`. zlib only points `msg` at string literals.
        unsafe {
            let msg = (*self.as_ptr()).err_msg;
            (!msg.is_null()).then(|| bun_core::ffi::cstr(msg))
        }
    }

    /// Runs `call` on at most `u32::MAX` bytes of each buffer. Returns how much input it consumed.
    pub(crate) fn with_buffers(
        &mut self,
        input: &[u8],
        mut out: BorrowedCursor<'_, u8>,
        call: impl FnOnce(z_streamp) -> ReturnCode,
    ) -> (usize, ReturnCode) {
        let strm = self.as_ptr();
        let in_len = input.len().min(uInt::MAX as usize);
        let out_len = out.capacity().min(uInt::MAX as usize);
        // SAFETY: see `avail_out`. Only zlib lowers the two counts, `avail_out` by as many bytes as
        // it wrote at the start of `out`.
        unsafe {
            (*strm).next_in = input.as_ptr();
            (*strm).avail_in = in_len as uInt;
            (*strm).next_out = out.as_mut().as_mut_ptr().cast::<u8>();
            (*strm).avail_out = out_len as uInt;
            let rc = call(strm);
            out.advance(out_len - (*strm).avail_out as usize);
            (in_len - (*strm).avail_in as usize, rc)
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
