use core::ffi::{c_int, c_uint, c_void};
use core::ptr::NonNull;

use bun_alloc::AllocError;
use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};

/// Valid `compression_level` range for `libdeflate_alloc_compressor_ex`. Values
/// outside this range make the allocator return NULL (indistinguishable from OOM),
/// so callers must range-check first.
pub const MIN_COMPRESSION_LEVEL: c_int = 0;
pub const MAX_COMPRESSION_LEVEL: c_int = 12;

unsafe extern "C" {
    // Returns null on OOM or compression_level outside MIN..=MAX_COMPRESSION_LEVEL.
    fn libdeflate_alloc_compressor_ex(
        compression_level: c_int,
        options: *const Options,
    ) -> *mut Compressor;
    fn libdeflate_deflate_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    fn libdeflate_deflate_compress_bound(compressor: *mut Compressor, in_nbytes: usize) -> usize;
    fn libdeflate_zlib_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    fn libdeflate_zlib_compress_bound(compressor: *mut Compressor, in_nbytes: usize) -> usize;
    fn libdeflate_gzip_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    fn libdeflate_gzip_compress_bound(compressor: *mut Compressor, in_nbytes: usize) -> usize;
    fn libdeflate_free_compressor(compressor: *mut Compressor);
}

/// `struct libdeflate_options`
#[repr(C)]
struct Options {
    sizeof_options: usize,
    malloc_func: unsafe extern "C" fn(usize) -> *mut c_void,
    free_func: unsafe extern "C" fn(*mut c_void),
}

static OPTIONS: Options = Options {
    sizeof_options: size_of::<Options>(),
    malloc_func: bun_alloc::mimalloc::mi_malloc,
    free_func: bun_alloc::mimalloc::mi_free,
};

bun_opaque::opaque_ffi! {
    struct Compressor;
    struct Decompressor;
}

/// Frees on drop. `#[repr(transparent)]`, so an all-zero `Option<OwnedCompressor>` is `None`.
#[repr(transparent)]
pub struct OwnedCompressor(NonNull<Compressor>);

impl OwnedCompressor {
    /// `None` on OOM, or if `level` is outside [`MIN_COMPRESSION_LEVEL`]..=[`MAX_COMPRESSION_LEVEL`].
    #[inline]
    pub fn new(level: c_int) -> Option<Self> {
        // SAFETY: the allocator functions match.
        NonNull::new(unsafe { libdeflate_alloc_compressor_ex(level, &raw const OPTIONS) }).map(Self)
    }

    pub fn max_bytes_needed(&mut self, input: &[u8], encoding: Encoding) -> usize {
        let compressor = self.0.as_ptr();
        // SAFETY: allocated in `new`.
        unsafe {
            match encoding {
                Encoding::Deflate => libdeflate_deflate_compress_bound(compressor, input.len()),
                Encoding::Zlib => libdeflate_zlib_compress_bound(compressor, input.len()),
                Encoding::Gzip => libdeflate_gzip_compress_bound(compressor, input.len()),
            }
        }
    }

    pub fn compress(&mut self, input: &[u8], output: &mut [u8], encoding: Encoding) -> Result {
        self.compress_into(input, BorrowedBuf::from(output).unfilled(), encoding)
    }

    fn compress_into(
        &mut self,
        input: &[u8],
        mut output: BorrowedCursor<'_, u8>,
        encoding: Encoding,
    ) -> Result {
        let compressor = self.0.as_ptr();
        let in_ptr = input.as_ptr().cast::<c_void>();
        let in_len = input.len();
        let out_len = output.capacity();
        // SAFETY: allocated in `new`; libdeflate returns how many bytes it wrote at the start of `output`.
        let written = unsafe {
            let out_ptr = output.as_mut().as_mut_ptr().cast::<c_void>();
            let written = match encoding {
                Encoding::Deflate => {
                    libdeflate_deflate_compress(compressor, in_ptr, in_len, out_ptr, out_len)
                }
                Encoding::Zlib => {
                    libdeflate_zlib_compress(compressor, in_ptr, in_len, out_ptr, out_len)
                }
                Encoding::Gzip => {
                    libdeflate_gzip_compress(compressor, in_ptr, in_len, out_ptr, out_len)
                }
            };
            output.advance(written);
            written
        };
        Result {
            read: in_len,
            written,
            // libdeflate's one-shot compressors return 0 when the output buffer is too small.
            status: if written == 0 {
                Status::InsufficientSpace
            } else {
                Status::Success
            },
        }
    }

    /// Compress `input` onto the end of `out`, reserving the bound first; `Err` if that allocation fails.
    pub fn compress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
    ) -> core::result::Result<Result, AllocError> {
        out.try_reserve_exact(self.max_bytes_needed(input, encoding))
            .map_err(|_| AllocError)?;
        Ok(append_with(out, usize::MAX, |out| {
            self.compress_into(input, out, encoding)
        }))
    }
}

impl Drop for OwnedCompressor {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: allocated in `new`; freed exactly once here.
        unsafe { libdeflate_free_compressor(self.0.as_ptr()) }
    }
}

/// Frees on drop. `#[repr(transparent)]`, so an all-zero `Option<OwnedDecompressor>` is `None`.
#[repr(transparent)]
pub struct OwnedDecompressor(NonNull<Decompressor>);

impl OwnedDecompressor {
    /// Allocate a decompressor. Returns `None` on OOM.
    #[inline]
    pub fn new() -> Option<Self> {
        // SAFETY: the allocator functions match.
        NonNull::new(unsafe { libdeflate_alloc_decompressor_ex(&raw const OPTIONS) }).map(Self)
    }

    pub fn decompress(&self, input: &[u8], output: &mut [u8], encoding: Encoding) -> Result {
        self.decompress_into(input, BorrowedBuf::from(output).unfilled(), encoding)
    }

    /// Fills `output` only on `Status::Success`.
    fn decompress_into(
        &self,
        input: &[u8],
        mut output: BorrowedCursor<'_, u8>,
        encoding: Encoding,
    ) -> Result {
        let decompressor = self.0.as_ptr();
        let in_ptr = input.as_ptr().cast::<c_void>();
        let in_len = input.len();
        let out_len = output.capacity();
        let mut read: usize = in_len;
        let mut written: usize = out_len;
        // SAFETY: allocated in `new`, and no other call is using it: `Self` is not `Sync`, and
        // libdeflate does not call back. On success it reports how many bytes it wrote at the
        // start of `output`.
        let status = unsafe {
            let out_ptr = output.as_mut().as_mut_ptr().cast::<c_void>();
            let status = match encoding {
                Encoding::Deflate => libdeflate_deflate_decompress_ex(
                    decompressor,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
                Encoding::Zlib => libdeflate_zlib_decompress_ex(
                    decompressor,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
                Encoding::Gzip => libdeflate_gzip_decompress_ex(
                    decompressor,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
            };
            if status == Status::Success {
                output.advance(written);
            }
            status
        };
        Result {
            read,
            written,
            status,
        }
    }

    /// Decompress `input` into `out`'s **spare capacity** (append mode).
    ///
    /// - Does **not** clear `out`; existing contents are preserved and the
    ///   decompressed bytes land after them.
    /// - Does **not** retry or grow `out`.
    /// - On [`Status::Success`], `out.len()` is advanced by `result.written`.
    ///   On any other status, `out.len()` is left unchanged (libdeflate does
    ///   not define `actual_out_nbytes_ret` on failure).
    pub fn decompress_to_vec(&self, input: &[u8], out: &mut Vec<u8>, encoding: Encoding) -> Result {
        append_with(out, usize::MAX, |out| {
            self.decompress_into(input, out, encoding)
        })
    }

    /// [`decompress_to_vec`](Self::decompress_to_vec) with a doubling retry loop.
    ///
    /// Clears `out` first (libdeflate restarts decompression from scratch on
    /// each call), then repeatedly doubles `out`'s capacity on
    /// [`Status::InsufficientSpace`] — clamped at `max_capacity` — until
    /// success, hard error, or `out.capacity() >= max_capacity` (returned as
    /// the final `InsufficientSpace`). On success, `out.len() == result.written`.
    /// `Err` when a growth step cannot be allocated.
    pub fn decompress_to_vec_grow(
        &self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
        max_capacity: usize,
    ) -> core::result::Result<Result, AllocError> {
        loop {
            out.clear();
            let result = self.decompress_to_vec(input, out, encoding);
            if result.status != Status::InsufficientSpace || out.capacity() >= max_capacity {
                return Ok(result);
            }
            let new_cap = out.capacity().max(1).saturating_mul(2).min(max_capacity);
            out.try_reserve_exact(new_cap.saturating_sub(out.len()))
                .map_err(|_| AllocError)?;
        }
    }
}

impl Drop for OwnedDecompressor {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: allocated in `new`; freed exactly once here.
        unsafe { libdeflate_free_decompressor(self.0.as_ptr()) }
    }
}

pub struct Result {
    pub read: usize,
    pub written: usize,
    pub status: Status,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Encoding {
    Deflate,
    Zlib,
    Gzip,
}

unsafe extern "C" {
    fn libdeflate_alloc_decompressor_ex(options: *const Options) -> *mut Decompressor;
}

const LIBDEFLATE_SUCCESS: c_uint = 0;
const LIBDEFLATE_BAD_DATA: c_uint = 1;
const LIBDEFLATE_SHORT_OUTPUT: c_uint = 2;
const LIBDEFLATE_INSUFFICIENT_SPACE: c_uint = 3;

// `u32` matches `c_uint` on all Bun targets.
#[repr(u32)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Status {
    Success = LIBDEFLATE_SUCCESS,
    BadData = LIBDEFLATE_BAD_DATA,
    ShortOutput = LIBDEFLATE_SHORT_OUTPUT,
    InsufficientSpace = LIBDEFLATE_INSUFFICIENT_SPACE,
}

unsafe extern "C" {
    fn libdeflate_deflate_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    fn libdeflate_zlib_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    fn libdeflate_gzip_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    fn libdeflate_free_decompressor(decompressor: *mut Decompressor);
}
