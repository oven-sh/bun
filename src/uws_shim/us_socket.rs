//! JS stream buffer relocated from `bun_uws_sys::us_socket` (D1-deleted).
//! Lives above the core: `bun_usockets::write` deliberately does NOT define
//! it (api.md CHANGES 7). Module path mirrors the old crate for consumers.

use core::ptr;

#[repr(C)]
pub struct us_socket_stream_buffer_t {
    pub list_ptr: *mut u8,
    pub list_cap: usize,
    pub list_len: usize,
    pub total_bytes_written: usize,
    pub cursor: usize,
}

impl Default for us_socket_stream_buffer_t {
    fn default() -> Self {
        Self {
            list_ptr: ptr::null_mut(),
            list_cap: 0,
            list_len: 0,
            total_bytes_written: 0,
            cursor: 0,
        }
    }
}

/// Minimal structural mirror of `bun_io::StreamBuffer` for tier-0 interop.
/// The higher-tier `bun_io::StreamBuffer` is field-identical and converts via
/// `From`/`Into`.
pub struct StreamBuffer {
    pub list: Vec<u8>,
    pub cursor: usize,
}

impl us_socket_stream_buffer_t {
    pub fn update(&mut self, stream_buffer: StreamBuffer) {
        // Decompose the Vec<u8> backing `stream_buffer.list` into raw parts so
        // the C side can read ptr/len/cap directly.
        let mut list = core::mem::ManuallyDrop::new(stream_buffer.list);
        if list.capacity() > 0 {
            self.list_ptr = list.as_mut_ptr();
        } else {
            self.list_ptr = ptr::null_mut();
        }
        self.list_len = list.len();
        self.list_cap = list.capacity();
        self.cursor = stream_buffer.cursor;
    }

    pub fn wrote(&mut self, written: usize) {
        self.total_bytes_written = self.total_bytes_written.saturating_add(written);
    }

    pub fn to_stream_buffer(&self) -> StreamBuffer {
        StreamBuffer {
            list: if !self.list_ptr.is_null() {
                unsafe {
                    // SAFETY: list_ptr/list_len/list_cap were produced by decomposing a
                    // Vec<u8> in `update`; global allocator (mimalloc) matches.
                    Vec::from_raw_parts(self.list_ptr, self.list_len, self.list_cap)
                }
            } else {
                Vec::new()
            },
            cursor: self.cursor,
        }
    }

    /// Explicit teardown — this struct is `#[repr(C)]` and freed via the
    /// exported `us_socket_free_stream_buffer`, so no `Drop` impl.
    ///
    /// SAFETY: `this` must point to a live `us_socket_stream_buffer_t` whose
    /// `list_ptr`/`list_cap` were produced by `update` (decomposed `Vec<u8>` on
    /// the global mimalloc allocator). Not called more than once.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` is non-null and exclusively borrowed
        let this = unsafe { &mut *this };
        if !this.list_ptr.is_null() {
            unsafe {
                // SAFETY: list_ptr/list_cap came from a decomposed Vec<u8> (global mimalloc).
                drop(Vec::from_raw_parts(this.list_ptr, 0, this.list_cap));
            }
        }
    }
}

// Also #[no_mangle]-defined in src/uws_sys until D1 deletes that crate; the
// two crates must never both link into bun_bin (duplicate symbol).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn us_socket_free_stream_buffer(buffer: *mut us_socket_stream_buffer_t) {
    // SAFETY: caller (C) passes a live us_socket_stream_buffer_t*
    unsafe { us_socket_stream_buffer_t::destroy(buffer) };
}
