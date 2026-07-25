use core::ffi::{c_int, c_uint, c_void};
use core::mem::MaybeUninit;
use core::ptr::NonNull;
use std::sync::Once;

#[repr(C)]
pub struct Options {
    pub sizeof_options: usize,
    pub malloc_func: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
    pub free_func: Option<unsafe extern "C" fn(*mut c_void)>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            sizeof_options: core::mem::size_of::<Options>(),
            malloc_func: None,
            free_func: None,
        }
    }
}

/// Valid `compression_level` range for `libdeflate_alloc_compressor`. Values
/// outside this range make the allocator return NULL (indistinguishable from OOM),
/// so callers must range-check first.
pub const MIN_COMPRESSION_LEVEL: c_int = 0;
pub const MAX_COMPRESSION_LEVEL: c_int = 12;

unsafe extern "C" {
    // Allocation: scalar arg, no preconditions; returns null on OOM or
    // compression_level outside MIN..=MAX_COMPRESSION_LEVEL.
    pub(crate) safe fn libdeflate_alloc_compressor(compression_level: c_int) -> *mut Compressor;
    pub(crate) fn libdeflate_deflate_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    // Bound queries: opaque handle + scalar. The C API documents `compressor`
    // may be NULL (returns a library-wide upper bound), so expose it as
    // `Option<&mut Compressor>` (NPO-ABI-compatible with `*mut Compressor`).
    pub(crate) safe fn libdeflate_deflate_compress_bound(
        compressor: Option<&mut Compressor>,
        in_nbytes: usize,
    ) -> usize;
    pub(crate) fn libdeflate_zlib_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub(crate) safe fn libdeflate_zlib_compress_bound(
        compressor: Option<&mut Compressor>,
        in_nbytes: usize,
    ) -> usize;
    pub(crate) fn libdeflate_gzip_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub(crate) safe fn libdeflate_gzip_compress_bound(
        compressor: Option<&mut Compressor>,
        in_nbytes: usize,
    ) -> usize;
    pub(crate) fn libdeflate_free_compressor(compressor: *mut Compressor);
}

fn load_once() {
    // SAFETY: mi_malloc/mi_free are valid C-ABI allocator callbacks for libdeflate.
    unsafe {
        libdeflate_set_memory_allocator(
            Some(bun_alloc::mimalloc::mi_malloc),
            Some(bun_alloc::mimalloc::mi_free),
        );
    }
}

static LOADED_ONCE: Once = Once::new();

pub fn load() {
    LOADED_ONCE.call_once(load_once);
}

bun_opaque::opaque_ffi! {
    /// Opaque libdeflate compressor handle. `UnsafeCell` makes the type `!Freeze`
    /// so a `&Compressor` does not assert immutability of the C-owned state.
    pub struct Compressor;
}

impl Compressor {
    pub fn alloc(compression_level: c_int) -> *mut Compressor {
        libdeflate_alloc_compressor(compression_level)
    }

    /// Frees the compressor. `this` must not be used afterward.
    pub unsafe fn destroy(this: *mut Compressor) {
        // SAFETY: caller guarantees `this` was returned by libdeflate_alloc_compressor
        // and is not used after this call.
        unsafe { libdeflate_free_compressor(this) }
    }

    /// Compresses `input` into `output` and returns the number of bytes written.
    pub fn inflate(&mut self, input: &[u8], output: &mut [u8]) -> Result {
        // SAFETY: self is a valid *mut Compressor; slice ptr/len pairs are valid.
        let written = unsafe {
            libdeflate_deflate_compress(
                self,
                input.as_ptr().cast::<c_void>(),
                input.len(),
                output.as_mut_ptr().cast::<c_void>(),
                output.len(),
            )
        };
        Result {
            read: input.len(),
            written,
            status: Status::Success,
        }
    }

    pub fn max_bytes_needed(&mut self, input: &[u8], encoding: Encoding) -> usize {
        match encoding {
            Encoding::Deflate => libdeflate_deflate_compress_bound(Some(self), input.len()),
            Encoding::Zlib => libdeflate_zlib_compress_bound(Some(self), input.len()),
            Encoding::Gzip => libdeflate_gzip_compress_bound(Some(self), input.len()),
        }
    }

    pub fn compress(&mut self, input: &[u8], output: &mut [u8], encoding: Encoding) -> Result {
        match encoding {
            Encoding::Deflate => self.inflate(input, output),
            Encoding::Zlib => self.zlib(input, output),
            Encoding::Gzip => self.gzip(input, output),
        }
    }

    /// Like [`compress`](Self::compress) but writes into a possibly-uninitialized
    /// output buffer (e.g. `Vec::spare_capacity_mut()`). libdeflate only writes
    /// to `output`, never reads, so `MaybeUninit<u8>` is the correct element type
    /// and avoids the UB of materializing `&mut [u8]` over uninitialized bytes.
    /// On return, `output[..result.written]` is initialized.
    pub fn compress_into(
        &mut self,
        input: &[u8],
        output: &mut [MaybeUninit<u8>],
        encoding: Encoding,
    ) -> Result {
        let in_ptr = input.as_ptr().cast::<c_void>();
        let in_len = input.len();
        let out_ptr = output.as_mut_ptr().cast::<c_void>();
        let out_len = output.len();
        // SAFETY: self is a valid *mut Compressor; ptr/len pairs are valid for the
        // FFI contract (input read-only, output write-only for `out_len` bytes).
        let written = unsafe {
            match encoding {
                Encoding::Deflate => {
                    libdeflate_deflate_compress(self, in_ptr, in_len, out_ptr, out_len)
                }
                Encoding::Zlib => libdeflate_zlib_compress(self, in_ptr, in_len, out_ptr, out_len),
                Encoding::Gzip => libdeflate_gzip_compress(self, in_ptr, in_len, out_ptr, out_len),
            }
        };
        Result {
            read: in_len,
            written,
            status: Status::Success,
        }
    }

    /// Compress `input` into `out`'s **spare capacity** (append mode).
    ///
    /// Does not clear `out`; on [`Status::Success`] `out.len()` is advanced by
    /// `result.written`. libdeflate compress never returns `InsufficientSpace`
    /// when `out` was sized via [`max_bytes_needed`](Self::max_bytes_needed),
    /// so callers need no retry loop.
    ///
    /// Safe replacement for the open-coded
    /// `compress_into(out.spare_capacity_mut()) + unsafe { set_len }` pattern,
    /// and for the zero-init `vec![0u8; bound]` + `truncate` form.
    pub fn compress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
    ) -> Result {
        let result = self.compress_into(input, out.spare_capacity_mut(), encoding);
        if result.status == Status::Success {
            // SAFETY: result.written ≤ spare.len() and libdeflate has
            // initialized spare[..result.written].
            unsafe { out.set_len(out.len() + result.written) };
        }
        result
    }

    pub fn zlib(&mut self, input: &[u8], output: &mut [u8]) -> Result {
        // SAFETY: self is a valid *mut Compressor; slice ptr/len pairs are valid.
        let result = unsafe {
            libdeflate_zlib_compress(
                self,
                input.as_ptr().cast::<c_void>(),
                input.len(),
                output.as_mut_ptr().cast::<c_void>(),
                output.len(),
            )
        };
        Result {
            read: input.len(),
            written: result,
            status: Status::Success,
        }
    }

    pub fn gzip(&mut self, input: &[u8], output: &mut [u8]) -> Result {
        // SAFETY: self is a valid *mut Compressor; slice ptr/len pairs are valid.
        let result = unsafe {
            libdeflate_gzip_compress(
                self,
                input.as_ptr().cast::<c_void>(),
                input.len(),
                output.as_mut_ptr().cast::<c_void>(),
                output.len(),
            )
        };
        Result {
            read: input.len(),
            written: result,
            status: Status::Success,
        }
    }
}

/// Owned RAII libdeflate compressor. Frees on drop.
///
/// `#[repr(transparent)]` over `NonNull` so `Option<OwnedCompressor>` has the
/// same layout as `*mut Compressor` (all-zero = `None`).
#[repr(transparent)]
pub struct OwnedCompressor(NonNull<Compressor>);

impl OwnedCompressor {
    /// Allocate a compressor at `level` ([`MIN_COMPRESSION_LEVEL`]..=[`MAX_COMPRESSION_LEVEL`]).
    /// Returns `None` on OOM or if `level` is out of range.
    #[inline]
    pub fn new(level: c_int) -> Option<Self> {
        NonNull::new(Compressor::alloc(level)).map(Self)
    }
}

impl core::ops::Deref for OwnedCompressor {
    type Target = Compressor;
    #[inline]
    fn deref(&self) -> &Compressor {
        // SAFETY: non-null, allocated by libdeflate, exclusively owned by `self`.
        unsafe { self.0.as_ref() }
    }
}

impl core::ops::DerefMut for OwnedCompressor {
    #[inline]
    fn deref_mut(&mut self) -> &mut Compressor {
        // SAFETY: non-null, allocated by libdeflate, exclusively owned by `self`.
        unsafe { self.0.as_mut() }
    }
}

impl Drop for OwnedCompressor {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: allocated by `libdeflate_alloc_compressor`; freed exactly once here.
        unsafe { libdeflate_free_compressor(self.0.as_ptr()) }
    }
}

bun_opaque::opaque_ffi! {
    /// Opaque libdeflate decompressor handle. `UnsafeCell` makes the type `!Freeze`.
    pub struct Decompressor;
}

impl Decompressor {
    pub fn alloc() -> *mut Decompressor {
        libdeflate_alloc_decompressor()
    }

    /// Frees the decompressor. `this` must not be used afterward.
    pub unsafe fn destroy(this: *mut Decompressor) {
        // SAFETY: caller guarantees `this` was returned by libdeflate_alloc_decompressor[_ex]
        // and is not used after this call.
        unsafe { libdeflate_free_decompressor(this) }
    }

    pub fn deflate(&mut self, input: &[u8], output: &mut [u8]) -> Result {
        let mut actual_in_bytes_ret: usize = input.len();
        let mut actual_out_bytes_ret: usize = output.len();
        // SAFETY: self is a valid *mut Decompressor; slice ptr/len pairs and out-params are valid.
        let result = unsafe {
            libdeflate_deflate_decompress_ex(
                self,
                input.as_ptr().cast::<c_void>(),
                input.len(),
                output.as_mut_ptr().cast::<c_void>(),
                output.len(),
                &raw mut actual_in_bytes_ret,
                &raw mut actual_out_bytes_ret,
            )
        };
        Result {
            read: actual_in_bytes_ret,
            written: actual_out_bytes_ret,
            status: result,
        }
    }

    pub fn zlib(&mut self, input: &[u8], output: &mut [u8]) -> Result {
        let mut actual_in_bytes_ret: usize = input.len();
        let mut actual_out_bytes_ret: usize = output.len();
        // SAFETY: self is a valid *mut Decompressor; slice ptr/len pairs and out-params are valid.
        let result = unsafe {
            libdeflate_zlib_decompress_ex(
                self,
                input.as_ptr().cast::<c_void>(),
                input.len(),
                output.as_mut_ptr().cast::<c_void>(),
                output.len(),
                &raw mut actual_in_bytes_ret,
                &raw mut actual_out_bytes_ret,
            )
        };
        Result {
            read: actual_in_bytes_ret,
            written: actual_out_bytes_ret,
            status: result,
        }
    }

    pub fn gzip(&mut self, input: &[u8], output: &mut [u8]) -> Result {
        let mut actual_in_bytes_ret: usize = input.len();
        let mut actual_out_bytes_ret: usize = output.len();
        // SAFETY: self is a valid *mut Decompressor; slice ptr/len pairs and out-params are valid.
        let result = unsafe {
            libdeflate_gzip_decompress_ex(
                self,
                input.as_ptr().cast::<c_void>(),
                input.len(),
                output.as_mut_ptr().cast::<c_void>(),
                output.len(),
                &raw mut actual_in_bytes_ret,
                &raw mut actual_out_bytes_ret,
            )
        };
        Result {
            read: actual_in_bytes_ret,
            written: actual_out_bytes_ret,
            status: result,
        }
    }

    pub fn decompress(&mut self, input: &[u8], output: &mut [u8], encoding: Encoding) -> Result {
        match encoding {
            Encoding::Deflate => self.deflate(input, output),
            Encoding::Zlib => self.zlib(input, output),
            Encoding::Gzip => self.gzip(input, output),
        }
    }

    /// Like [`decompress`](Self::decompress) but writes into a possibly-uninitialized
    /// output buffer (e.g. `Vec::spare_capacity_mut()`). libdeflate only writes
    /// to `output`, never reads, so `MaybeUninit<u8>` is the correct element type
    /// and avoids the UB of materializing `&mut [u8]` over uninitialized bytes.
    /// On `Status::Success`, `output[..result.written]` is initialized.
    pub fn decompress_into(
        &mut self,
        input: &[u8],
        output: &mut [MaybeUninit<u8>],
        encoding: Encoding,
    ) -> Result {
        let in_ptr = input.as_ptr().cast::<c_void>();
        let in_len = input.len();
        let out_ptr = output.as_mut_ptr().cast::<c_void>();
        let out_len = output.len();
        let mut read: usize = in_len;
        let mut written: usize = out_len;
        // SAFETY: self is a valid *mut Decompressor; ptr/len pairs are valid for the
        // FFI contract (input read-only, output write-only for `out_len` bytes);
        // out-params are valid `*mut usize`.
        let status = unsafe {
            match encoding {
                Encoding::Deflate => libdeflate_deflate_decompress_ex(
                    self,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
                Encoding::Zlib => libdeflate_zlib_decompress_ex(
                    self,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
                Encoding::Gzip => libdeflate_gzip_decompress_ex(
                    self,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
            }
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
    ///
    /// Safe replacement for the open-coded
    /// `decompress_into(out.spare_capacity_mut()) + unsafe { set_len }` pattern,
    /// and for the UB-adjacent `slice_mut(ptr, capacity)` form that materialized
    /// `&mut [u8]` over uninitialized bytes.
    pub fn decompress_to_vec(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
    ) -> Result {
        let result = self.decompress_into(input, out.spare_capacity_mut(), encoding);
        if result.status == Status::Success {
            // SAFETY: result.written ≤ spare.len() and libdeflate has
            // initialized spare[..result.written].
            unsafe { out.set_len(out.len() + result.written) };
        }
        result
    }

    /// [`decompress_to_vec`](Self::decompress_to_vec) with a doubling retry loop.
    ///
    /// Clears `out` first (libdeflate restarts decompression from scratch on
    /// each call), then repeatedly doubles `out`'s capacity on
    /// [`Status::InsufficientSpace`] — clamped at `max_capacity` — until
    /// success, hard error, or `out.capacity() >= max_capacity` (returned as
    /// the final `InsufficientSpace`). On success, `out.len() == result.written`.
    pub fn decompress_to_vec_grow(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
        max_capacity: usize,
    ) -> Result {
        loop {
            out.clear();
            let result = self.decompress_to_vec(input, out, encoding);
            if result.status != Status::InsufficientSpace || out.capacity() >= max_capacity {
                return result;
            }
            let new_cap = out.capacity().max(1).saturating_mul(2).min(max_capacity);
            out.reserve_exact(new_cap.saturating_sub(out.len()));
        }
    }
}

/// Owned RAII libdeflate decompressor. Frees on drop.
///
/// `#[repr(transparent)]` over `NonNull` so `Option<OwnedDecompressor>` has the
/// same layout as `*mut Decompressor` (all-zero = `None`).
#[repr(transparent)]
pub struct OwnedDecompressor(NonNull<Decompressor>);

impl OwnedDecompressor {
    /// Allocate a decompressor. Returns `None` on OOM.
    #[inline]
    pub fn new() -> Option<Self> {
        NonNull::new(Decompressor::alloc()).map(Self)
    }
}

impl core::ops::Deref for OwnedDecompressor {
    type Target = Decompressor;
    #[inline]
    fn deref(&self) -> &Decompressor {
        // SAFETY: non-null, allocated by libdeflate, exclusively owned by `self`.
        unsafe { self.0.as_ref() }
    }
}

impl core::ops::DerefMut for OwnedDecompressor {
    #[inline]
    fn deref_mut(&mut self) -> &mut Decompressor {
        // SAFETY: non-null, allocated by libdeflate, exclusively owned by `self`.
        unsafe { self.0.as_mut() }
    }
}

impl Drop for OwnedDecompressor {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: allocated by `libdeflate_alloc_decompressor`; freed exactly once here.
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
    pub(crate) safe fn libdeflate_alloc_decompressor() -> *mut Decompressor;
    // NOT safe: `Options` carries caller-supplied `malloc_func`/`free_func`
    // callbacks that libdeflate will invoke and write through.
    pub fn libdeflate_alloc_decompressor_ex(options: *const Options) -> *mut Decompressor;
}

pub(crate) const LIBDEFLATE_SUCCESS: c_uint = 0;
pub(crate) const LIBDEFLATE_BAD_DATA: c_uint = 1;
pub(crate) const LIBDEFLATE_SHORT_OUTPUT: c_uint = 2;
pub(crate) const LIBDEFLATE_INSUFFICIENT_SPACE: c_uint = 3;

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
    pub fn libdeflate_deflate_decompress(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_deflate_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub fn libdeflate_zlib_decompress(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_zlib_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub fn libdeflate_gzip_decompress(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_gzip_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_free_decompressor(decompressor: *mut Decompressor);
    pub fn libdeflate_adler32(adler: u32, buffer: *const c_void, len: usize) -> u32;
    pub fn libdeflate_crc32(crc: u32, buffer: *const c_void, len: usize) -> u32;
    pub(crate) fn libdeflate_set_memory_allocator(
        malloc_func: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        free_func: Option<unsafe extern "C" fn(*mut c_void)>,
    );
}
