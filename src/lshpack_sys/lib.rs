//! HPACK (RFC 7541) encoder/decoder over the `lshpack_wrapper_*` shim in
//! `src/jsc/bindings/c-bindings.cpp` (ls-hpack).

use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use bun_core::ffi::{FfiSlice, FfiSliceMut};

bun_opaque::opaque_ffi! {
    /// `lshpack_wrapper` (encoder + decoder pair), allocated by the C shim.
    struct Raw;
}

/// Offsets into the decode buffer, as written by `lshpack_wrapper_decode`.
#[repr(C)]
#[derive(Default)]
struct RawHeader {
    name_offset: usize,
    name_len: usize,
    value_offset: usize,
    value_len: usize,
    never_index: bool,
    hpack_index: u16,
}

type Alloc = extern "C" fn(size: usize) -> *mut c_void;
type Free = unsafe extern "C" fn(ptr: *mut c_void);

unsafe extern "C" {
    safe fn lshpack_wrapper_init(alloc: Alloc, free: Free, capacity: c_uint) -> *mut Raw;
    safe fn lshpack_wrapper_enc_set_max_capacity(this: &Raw, max_capacity: c_uint);
    /// Frees `this`.
    fn lshpack_wrapper_deinit(this: *mut Raw);
    safe fn lshpack_wrapper_decode(
        this: &Raw,
        src: FfiSlice<'_>,
        dst: FfiSliceMut<'_>,
        output: &mut RawHeader,
    ) -> isize;
    safe fn lshpack_wrapper_encode(
        this: &Raw,
        name: FfiSlice<'_>,
        value: FfiSlice<'_>,
        never_index: c_int,
        buffer: FfiSliceMut<'_>,
        buffer_offset: usize,
    ) -> usize;
}

/// ls-hpack's largest encodable/decodable header (name + value).
pub const MAX_HEADER_SIZE: usize = 65536;
const INITIAL_DECODE_BUFFER: usize = 512;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum HpackError {
    #[error("UnableToDecode")]
    UnableToDecode,
    #[error("EmptyHeaderName")]
    EmptyHeaderName,
    #[error("UnableToEncode")]
    UnableToEncode,
}

/// One decoded header field. `name`/`value` borrow the decoder and are
/// overwritten by its next `decode`.
pub struct DecodeResult<'a> {
    pub name: &'a [u8],
    pub value: &'a [u8],
    pub never_index: bool,
    /// Index into the HPACK static table (0-based), or 255 if not a
    /// well-known field.
    pub well_know: u16,
    /// Bytes of input consumed: the offset of the next field in `src`.
    pub next: usize,
}

/// An HPACK encoder/decoder pair with its own dynamic tables.
pub struct Hpack {
    raw: NonNull<Raw>,
    /// Decoded name/value bytes land here; grown on demand up to
    /// [`MAX_HEADER_SIZE`].
    decode_buffer: Vec<u8>,
}

/// Older name.
pub type HpackHandle = Hpack;
pub type HPACK = Hpack;

impl Hpack {
    pub fn new(max_capacity: u32) -> Self {
        let raw = lshpack_wrapper_init(
            bun_alloc::mimalloc::mi_malloc,
            bun_alloc::mimalloc::mi_free,
            max_capacity as c_uint,
        );
        let Some(raw) = NonNull::new(raw) else {
            bun_core::out_of_memory();
        };
        Self {
            raw,
            decode_buffer: Vec::new(),
        }
    }

    #[inline]
    fn raw(&self) -> &Raw {
        Raw::opaque_ref(self.raw.as_ptr())
    }

    /// Decode the header field at the start of `src`.
    pub fn decode(&mut self, src: &[u8]) -> Result<DecodeResult<'_>, HpackError> {
        if self.decode_buffer.is_empty() {
            self.decode_buffer.resize(INITIAL_DECODE_BUFFER, 0);
        }
        let mut header = RawHeader::default();
        let consumed = loop {
            let rc = lshpack_wrapper_decode(
                Raw::opaque_ref(self.raw.as_ptr()),
                FfiSlice::new(src),
                FfiSliceMut::new(&mut self.decode_buffer),
                &mut header,
            );
            if rc > 0 {
                break rc as usize;
            }
            if rc == 0 {
                return Err(HpackError::UnableToDecode);
            }
            let need = rc.unsigned_abs().min(MAX_HEADER_SIZE);
            if need <= self.decode_buffer.len() {
                return Err(HpackError::UnableToDecode);
            }
            let new_len = need
                .checked_next_power_of_two()
                .unwrap_or(MAX_HEADER_SIZE)
                .min(MAX_HEADER_SIZE);
            self.decode_buffer.resize(new_len, 0);
        };
        if header.name_len == 0 {
            return Err(HpackError::EmptyHeaderName);
        }
        let buf = self.decode_buffer.as_slice();
        let name = buf
            .get(header.name_offset..header.name_offset + header.name_len)
            .ok_or(HpackError::UnableToDecode)?;
        let value = buf
            .get(header.value_offset..header.value_offset + header.value_len)
            .ok_or(HpackError::UnableToDecode)?;
        Ok(DecodeResult {
            name,
            value,
            never_index: header.never_index,
            well_know: header.hpack_index,
            next: consumed,
        })
    }

    /// Encode `name: value` into `dst_buffer[dst_buffer_offset..]`, returning
    /// the number of bytes written. Fails if the pair exceeds
    /// [`MAX_HEADER_SIZE`] or does not fit.
    pub fn encode(
        &mut self,
        name: &[u8],
        value: &[u8],
        never_index: bool,
        dst_buffer: &mut [u8],
        dst_buffer_offset: usize,
    ) -> Result<usize, HpackError> {
        let written = lshpack_wrapper_encode(
            self.raw(),
            FfiSlice::new(name),
            FfiSlice::new(value),
            c_int::from(never_index),
            FfiSliceMut::new(dst_buffer),
            dst_buffer_offset,
        );
        if written == 0 {
            return Err(HpackError::UnableToEncode);
        }
        Ok(written)
    }

    /// Adjust the encoder's dynamic-table capacity after init. Evicts entries
    /// to fit; the caller is responsible for emitting the RFC 7541 §6.3
    /// Dynamic Table Size Update opcode at the start of the next header block
    /// so the peer's decoder evicts in lockstep.
    pub fn set_encoder_max_capacity(&mut self, max_capacity: u32) {
        lshpack_wrapper_enc_set_max_capacity(self.raw(), max_capacity as c_uint);
    }
}

impl Drop for Hpack {
    fn drop(&mut self) {
        // SAFETY: `raw` came from `lshpack_wrapper_init` and is owned solely by
        // this value; freed once, here.
        unsafe { lshpack_wrapper_deinit(self.raw.as_ptr()) };
    }
}

// SAFETY: the C state has no thread affinity and is only reached through
// `&mut self` / `&self` of this unique owner.
unsafe impl Send for Hpack {}
