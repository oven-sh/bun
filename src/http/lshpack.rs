use core::ffi::{c_int, c_uint, c_void};

#[repr(C)]
struct lshpack_header {
    name: *const u8,
    name_len: usize,
    value: *const u8,
    value_len: usize,
    never_index: bool,
    hpack_index: u16,
}

impl Default for lshpack_header {
    fn default() -> Self {
        Self {
            name: core::ptr::null(),
            name_len: 0,
            value: core::ptr::null(),
            value_len: 0,
            never_index: false,
            hpack_index: 255,
        }
    }
}

/// wrapper implemented at src/jsc/bindings/c-bindings.cpp
#[repr(C)]
pub struct HPACK {
    self_: *mut c_void,
}

pub struct DecodeResult {
    // TODO(port): lifetime — name/value point into an FFI thread_local shared buffer,
    // valid only until the next decode/encode call. Phase B: consider `DecodeResult<'a>`.
    pub name: &'static [u8],
    pub value: &'static [u8],
    pub never_index: bool,
    pub well_know: u16,
    /// offset of the next header position in src
    pub next: usize,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum HpackError {
    #[error("UnableToDecode")]
    UnableToDecode,
    #[error("EmptyHeaderName")]
    EmptyHeaderName,
    #[error("UnableToEncode")]
    UnableToEncode,
}
// TODO(port): impl From<HpackError> for bun_core::Error

impl HPACK {
    pub const LSHPACK_MAX_HEADER_SIZE: usize = 65536;

    pub fn init(max_capacity: u32) -> *mut HPACK {
        // SAFETY: FFI call into c-bindings.cpp; mi_malloc/mi_free are valid C-ABI fn pointers.
        let ptr = unsafe {
            lshpack_wrapper_init(
                Some(bun_alloc::mi_malloc),
                Some(bun_alloc::mi_free),
                max_capacity as usize,
            )
        };
        if ptr.is_null() {
            bun_core::out_of_memory();
        }
        ptr
        // TODO(port): wrap in an owning newtype with Drop instead of returning a raw *mut HPACK
    }

    /// DecodeResult name and value uses a thread_local shared buffer and should be copy/cloned before the next decode/encode call
    pub fn decode(&mut self, src: &[u8]) -> Result<DecodeResult, HpackError> {
        let mut header = lshpack_header::default();
        // SAFETY: self is a valid *HPACK from lshpack_wrapper_init; header is a #[repr(C)] out-param.
        let offset = unsafe {
            lshpack_wrapper_decode(self as *mut HPACK, src.as_ptr(), src.len(), &mut header)
        };
        if offset == 0 {
            return Err(HpackError::UnableToDecode);
        }
        if header.name_len == 0 {
            return Err(HpackError::EmptyHeaderName);
        }

        // SAFETY: lshpack_wrapper_decode writes valid (ptr, len) pairs into header pointing at a
        // thread_local buffer that lives until the next decode/encode call on this thread.
        let (name, value) = unsafe {
            (
                core::slice::from_raw_parts(header.name, header.name_len),
                core::slice::from_raw_parts(header.value, header.value_len),
            )
        };

        Ok(DecodeResult {
            name,
            value,
            next: offset,
            never_index: header.never_index,
            well_know: header.hpack_index,
        })
    }

    /// encode name, value with never_index option into dst_buffer
    /// if name + value length is greater than LSHPACK_MAX_HEADER_SIZE this will return UnableToEncode
    pub fn encode(
        &mut self,
        name: &[u8],
        value: &[u8],
        never_index: bool,
        dst_buffer: &mut [u8],
        dst_buffer_offset: usize,
    ) -> Result<usize, HpackError> {
        // SAFETY: self is a valid *HPACK; all slices outlive the call.
        let offset = unsafe {
            lshpack_wrapper_encode(
                self as *mut HPACK,
                name.as_ptr(),
                name.len(),
                value.as_ptr(),
                value.len(),
                never_index as c_int,
                dst_buffer.as_mut_ptr(),
                dst_buffer.len(),
                dst_buffer_offset,
            )
        };
        // PORT NOTE: Zig compared `offset <= 0` on a usize; only `== 0` is reachable.
        if offset == 0 {
            return Err(HpackError::UnableToEncode);
        }
        Ok(offset)
    }

    /// Adjust the encoder's dynamic-table capacity after init. Evicts entries
    /// to fit; the caller is responsible for emitting the RFC 7541 §6.3
    /// Dynamic Table Size Update opcode at the start of the next header block
    /// so the peer's decoder evicts in lockstep.
    pub fn set_encoder_max_capacity(&mut self, max_capacity: u32) {
        // SAFETY: self is a valid *HPACK from lshpack_wrapper_init.
        unsafe { lshpack_wrapper_enc_set_max_capacity(self as *mut HPACK, max_capacity as c_uint) };
    }

    /// # Safety
    /// `this` must have been returned by [`HPACK::init`] and not yet destroyed.
    pub unsafe fn destroy(this: *mut HPACK) {
        // SAFETY: caller contract — this was allocated by lshpack_wrapper_init.
        unsafe { lshpack_wrapper_deinit(this) };
    }
}

type lshpack_wrapper_alloc = Option<unsafe extern "C" fn(size: usize) -> *mut c_void>;
type lshpack_wrapper_free = Option<unsafe extern "C" fn(ptr: *mut c_void)>;

// TODO(port): move to bun_http_sys
unsafe extern "C" {
    fn lshpack_wrapper_init(
        alloc: lshpack_wrapper_alloc,
        free: lshpack_wrapper_free,
        capacity: usize,
    ) -> *mut HPACK;
    fn lshpack_wrapper_enc_set_max_capacity(self_: *mut HPACK, max_capacity: c_uint);
    fn lshpack_wrapper_deinit(self_: *mut HPACK);
    fn lshpack_wrapper_decode(
        self_: *mut HPACK,
        src: *const u8,
        src_len: usize,
        output: *mut lshpack_header,
    ) -> usize;
    fn lshpack_wrapper_encode(
        self_: *mut HPACK,
        name: *const u8,
        name_len: usize,
        value: *const u8,
        value_len: usize,
        never_index: c_int,
        buffer: *mut u8,
        buffer_len: usize,
        buffer_offset: usize,
    ) -> usize;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/lshpack.zig (75 lines)
//   confidence: high
//   todos:      3
//   notes:      DecodeResult slices borrow FFI thread_local storage (faked as 'static); init() returns raw *mut — Phase B should wrap in Drop newtype.
// ──────────────────────────────────────────────────────────────────────────
