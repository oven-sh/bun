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

/// The C objects themselves. Only the extern declarations below name these
/// types; all Rust code uses the owning [`Compressor`] / [`Decompressor`] handles.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `struct libdeflate_compressor`. `&Self` is ABI-identical to a
        /// non-null `libdeflate_compressor*` and carries no `noalias`/`readonly`
        /// — libdeflate mutates the compressor's scratch state through it.
        pub struct Compressor;
        /// `struct libdeflate_decompressor`. `&Self` is ABI-identical to a
        /// non-null `libdeflate_decompressor*` and carries no `noalias`/`readonly`
        /// — libdeflate mutates the decompressor's scratch state through it.
        pub struct Decompressor;
    }
}

// `libdeflate_alloc_compressor[_ex]` allocates and hands back the object. One
// `Compressor` handle owns exactly that one allocation.
bun_opaque::foreign_owned!(sys::Compressor, libdeflate_free_compressor);

unsafe extern "C" {
    // Allocation: scalar arg, no preconditions; returns null on OOM.
    pub(crate) safe fn libdeflate_alloc_compressor(
        compression_level: c_int,
    ) -> *mut sys::Compressor;
    // NOT safe: `Options` carries caller-supplied `malloc_func`/`free_func`
    // callbacks that libdeflate will invoke and write through. A bogus callback
    // (constructible in 100% safe code) would cause UB inside the C library.
    pub(crate) fn libdeflate_alloc_compressor_ex(
        compression_level: c_int,
        options: *const Options,
    ) -> *mut sys::Compressor;
    // NOT `safe fn`: `in_`/`out` are raw pointers libdeflate reads/writes. Safe
    // Rust can forge a `*const c_void`, so the call carries the obligation.
    pub(crate) fn libdeflate_deflate_compress(
        compressor: &sys::Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    // Bound queries: opaque handle + scalar. The C API documents `compressor`
    // may be NULL (returns a library-wide upper bound), so expose it as
    // `Option<&sys::Compressor>` (NPO-ABI-compatible with the raw pointer).
    pub(crate) safe fn libdeflate_deflate_compress_bound(
        compressor: Option<&sys::Compressor>,
        in_nbytes: usize,
    ) -> usize;
    pub(crate) fn libdeflate_zlib_compress(
        compressor: &sys::Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub(crate) safe fn libdeflate_zlib_compress_bound(
        compressor: Option<&sys::Compressor>,
        in_nbytes: usize,
    ) -> usize;
    pub(crate) fn libdeflate_gzip_compress(
        compressor: &sys::Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub(crate) safe fn libdeflate_gzip_compress_bound(
        compressor: Option<&sys::Compressor>,
        in_nbytes: usize,
    ) -> usize;
    // safe: C frees the allocation. Freeing is not exclusive access in Rust's
    // model, so the receiver is `&`, as `ForeignOwned::release` requires.
    pub(crate) safe fn libdeflate_free_compressor(compressor: &sys::Compressor);
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

/// Owned handle to a libdeflate compressor; `Drop` frees it.
///
/// Every method takes `&self`: `sys::Compressor` is `UnsafeCell`-backed, so a
/// `&` carries no `noalias`/`readonly` and libdeflate freely mutates the
/// compressor's scratch state through it. `#[repr(transparent)]` over `NonNull`,
/// so `Option<Compressor>` is pointer-sized with all-zero = `None`.
#[repr(transparent)]
pub struct Compressor(bun_opaque::ForeignRef<sys::Compressor>);

/// Ownership plumbing.
impl Compressor {
    /// Adopt an allocation returned by libdeflate.
    ///
    /// # Safety
    /// `ptr` must come from `libdeflate_alloc_compressor[_ex]` and must not be
    /// freed by any other handle.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<sys::Compressor>) -> Self {
        // SAFETY: caller transfers the allocation.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// Adopt a nullable allocation; `None` on OOM.
    #[inline]
    fn adopt_ptr(ptr: *mut sys::Compressor) -> Option<Self> {
        // SAFETY: libdeflate returns a fresh allocation or null.
        NonNull::new(ptr).map(|p| unsafe { Self::adopt(p) })
    }

    /// The libdeflate pointer, still owned by `self`.
    #[inline]
    pub fn as_ptr(&self) -> *mut sys::Compressor {
        self.0.as_ptr()
    }

    /// Hand the allocation to a foreign owner. Pairs with a later [`Self::adopt`].
    #[inline]
    pub fn leak(self) -> NonNull<sys::Compressor> {
        self.0.leak()
    }

    #[inline]
    fn raw(&self) -> &sys::Compressor {
        &self.0
    }
}

/// Constructors. libdeflate allocates; each returns an owned handle.
impl Compressor {
    /// Allocate a compressor at `level` (0..=12). Returns `None` on OOM.
    #[inline]
    pub fn new(level: c_int) -> Option<Self> {
        Self::adopt_ptr(libdeflate_alloc_compressor(level))
    }

    /// # Safety
    /// `options.malloc_func`/`free_func` (if set) must be sound allocator
    /// callbacks — libdeflate writes through their return values.
    pub unsafe fn new_ex(level: c_int, options: Option<&Options>) -> Option<Self> {
        // SAFETY: caller upholds the callback contract; `Option<&T>` → `*const T` is NPO-compatible.
        Self::adopt_ptr(unsafe {
            libdeflate_alloc_compressor_ex(level, options.map_or(core::ptr::null(), |o| o))
        })
    }
}

/// Compression. `&self` throughout: libdeflate mutates through the handle.
impl Compressor {
    /// Compresses `input` into `output` and returns the number of bytes written.
    pub fn inflate(&self, input: &[u8], output: &mut [u8]) -> Result {
        // SAFETY: slice ptr/len pairs are valid; libdeflate reads `input` and
        // writes at most `output.len()` bytes.
        let written = unsafe {
            libdeflate_deflate_compress(
                self.raw(),
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

    pub fn max_bytes_needed(&self, input: &[u8], encoding: Encoding) -> usize {
        match encoding {
            Encoding::Deflate => libdeflate_deflate_compress_bound(Some(self.raw()), input.len()),
            Encoding::Zlib => libdeflate_zlib_compress_bound(Some(self.raw()), input.len()),
            Encoding::Gzip => libdeflate_gzip_compress_bound(Some(self.raw()), input.len()),
        }
    }

    pub fn compress(&self, input: &[u8], output: &mut [u8], encoding: Encoding) -> Result {
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
        &self,
        input: &[u8],
        output: &mut [MaybeUninit<u8>],
        encoding: Encoding,
    ) -> Result {
        let in_ptr = input.as_ptr().cast::<c_void>();
        let in_len = input.len();
        let out_ptr = output.as_mut_ptr().cast::<c_void>();
        let out_len = output.len();
        let this = self.raw();
        // SAFETY: ptr/len pairs are valid for the FFI contract (input read-only,
        // output write-only for `out_len` bytes).
        let written = unsafe {
            match encoding {
                Encoding::Deflate => {
                    libdeflate_deflate_compress(this, in_ptr, in_len, out_ptr, out_len)
                }
                Encoding::Zlib => libdeflate_zlib_compress(this, in_ptr, in_len, out_ptr, out_len),
                Encoding::Gzip => libdeflate_gzip_compress(this, in_ptr, in_len, out_ptr, out_len),
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
    pub fn compress_to_vec(&self, input: &[u8], out: &mut Vec<u8>, encoding: Encoding) -> Result {
        let result = self.compress_into(input, out.spare_capacity_mut(), encoding);
        if result.status == Status::Success {
            // SAFETY: result.written ≤ spare.len() and libdeflate has
            // initialized spare[..result.written].
            unsafe { out.set_len(out.len() + result.written) };
        }
        result
    }

    pub fn zlib(&self, input: &[u8], output: &mut [u8]) -> Result {
        // SAFETY: slice ptr/len pairs are valid; libdeflate reads `input` and
        // writes at most `output.len()` bytes.
        let result = unsafe {
            libdeflate_zlib_compress(
                self.raw(),
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

    pub fn gzip(&self, input: &[u8], output: &mut [u8]) -> Result {
        // SAFETY: slice ptr/len pairs are valid; libdeflate reads `input` and
        // writes at most `output.len()` bytes.
        let result = unsafe {
            libdeflate_gzip_compress(
                self.raw(),
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

// `libdeflate_alloc_decompressor[_ex]` allocates and hands back the object. One
// `Decompressor` handle owns exactly that one allocation.
bun_opaque::foreign_owned!(sys::Decompressor, libdeflate_free_decompressor);

/// Owned handle to a libdeflate decompressor; `Drop` frees it.
///
/// Every method takes `&self`: `sys::Decompressor` is `UnsafeCell`-backed, so a
/// `&` carries no `noalias`/`readonly` and libdeflate freely mutates the
/// decompressor's scratch state through it. `#[repr(transparent)]` over `NonNull`,
/// so `Option<Decompressor>` is pointer-sized with all-zero = `None`.
#[repr(transparent)]
pub struct Decompressor(bun_opaque::ForeignRef<sys::Decompressor>);

/// Ownership plumbing.
impl Decompressor {
    /// Adopt an allocation returned by libdeflate.
    ///
    /// # Safety
    /// `ptr` must come from `libdeflate_alloc_decompressor[_ex]` and must not be
    /// freed by any other handle.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<sys::Decompressor>) -> Self {
        // SAFETY: caller transfers the allocation.
        Self(unsafe { bun_opaque::ForeignRef::adopt(ptr) })
    }

    /// Adopt a nullable allocation; `None` on OOM.
    #[inline]
    fn adopt_ptr(ptr: *mut sys::Decompressor) -> Option<Self> {
        // SAFETY: libdeflate returns a fresh allocation or null.
        NonNull::new(ptr).map(|p| unsafe { Self::adopt(p) })
    }

    /// The libdeflate pointer, still owned by `self`.
    #[inline]
    pub fn as_ptr(&self) -> *mut sys::Decompressor {
        self.0.as_ptr()
    }

    /// Hand the allocation to a foreign owner. Pairs with a later [`Self::adopt`].
    #[inline]
    pub fn leak(self) -> NonNull<sys::Decompressor> {
        self.0.leak()
    }

    #[inline]
    fn raw(&self) -> &sys::Decompressor {
        &self.0
    }
}

/// Constructor. libdeflate allocates; returns an owned handle.
impl Decompressor {
    /// Allocate a decompressor. Returns `None` on OOM.
    #[inline]
    pub fn new() -> Option<Self> {
        Self::adopt_ptr(libdeflate_alloc_decompressor())
    }
}

/// Decompression. `&self` throughout: libdeflate mutates through the handle.
impl Decompressor {
    pub fn deflate(&self, input: &[u8], output: &mut [u8]) -> Result {
        let mut actual_in_bytes_ret: usize = input.len();
        let mut actual_out_bytes_ret: usize = output.len();
        // SAFETY: slice ptr/len pairs and out-params are valid; libdeflate reads
        // `input` and writes at most `output.len()` bytes.
        let result = unsafe {
            libdeflate_deflate_decompress_ex(
                self.raw(),
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

    pub fn zlib(&self, input: &[u8], output: &mut [u8]) -> Result {
        let mut actual_in_bytes_ret: usize = input.len();
        let mut actual_out_bytes_ret: usize = output.len();
        // SAFETY: slice ptr/len pairs and out-params are valid; libdeflate reads
        // `input` and writes at most `output.len()` bytes.
        let result = unsafe {
            libdeflate_zlib_decompress_ex(
                self.raw(),
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

    pub fn gzip(&self, input: &[u8], output: &mut [u8]) -> Result {
        let mut actual_in_bytes_ret: usize = input.len();
        let mut actual_out_bytes_ret: usize = output.len();
        // SAFETY: slice ptr/len pairs and out-params are valid; libdeflate reads
        // `input` and writes at most `output.len()` bytes.
        let result = unsafe {
            libdeflate_gzip_decompress_ex(
                self.raw(),
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

    pub fn decompress(&self, input: &[u8], output: &mut [u8], encoding: Encoding) -> Result {
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
        &self,
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
        let this = self.raw();
        // SAFETY: ptr/len pairs are valid for the FFI contract (input read-only,
        // output write-only for `out_len` bytes); out-params are valid `*mut usize`.
        let status = unsafe {
            match encoding {
                Encoding::Deflate => libdeflate_deflate_decompress_ex(
                    this,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
                Encoding::Zlib => libdeflate_zlib_decompress_ex(
                    this,
                    in_ptr,
                    in_len,
                    out_ptr,
                    out_len,
                    &raw mut read,
                    &raw mut written,
                ),
                Encoding::Gzip => libdeflate_gzip_decompress_ex(
                    this,
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
    pub fn decompress_to_vec(&self, input: &[u8], out: &mut Vec<u8>, encoding: Encoding) -> Result {
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
    /// [`Status::InsufficientSpace`] until success, hard error, or
    /// `out.capacity() > max_capacity` (returned as the final
    /// `InsufficientSpace`). On success, `out.len() == result.written`.
    pub fn decompress_to_vec_grow(
        &self,
        input: &[u8],
        out: &mut Vec<u8>,
        encoding: Encoding,
        max_capacity: usize,
    ) -> Result {
        loop {
            out.clear();
            let result = self.decompress_to_vec(input, out, encoding);
            if result.status != Status::InsufficientSpace || out.capacity() > max_capacity {
                return result;
            }
            let new_cap = out.capacity().max(1) * 2;
            out.reserve(new_cap.saturating_sub(out.len()));
        }
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
    pub(crate) safe fn libdeflate_alloc_decompressor() -> *mut sys::Decompressor;
    // NOT safe: `Options` carries allocator callbacks (see `libdeflate_alloc_compressor_ex`).
    pub fn libdeflate_alloc_decompressor_ex(options: *const Options) -> *mut sys::Decompressor;
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
    // NOT `safe fn`: `in_`/`out` are raw pointers libdeflate reads/writes. Safe
    // Rust can forge a `*const c_void`, so the call carries the obligation.
    pub fn libdeflate_deflate_decompress(
        decompressor: &sys::Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_deflate_decompress_ex(
        decompressor: &sys::Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub fn libdeflate_zlib_decompress(
        decompressor: &sys::Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_zlib_decompress_ex(
        decompressor: &sys::Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub fn libdeflate_gzip_decompress(
        decompressor: &sys::Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub(crate) fn libdeflate_gzip_decompress_ex(
        decompressor: &sys::Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    // safe: C frees the allocation. Freeing is not exclusive access in Rust's
    // model, so the receiver is `&`, as `ForeignOwned::release` requires.
    pub(crate) safe fn libdeflate_free_decompressor(decompressor: &sys::Decompressor);
    pub fn libdeflate_adler32(adler: u32, buffer: *const c_void, len: usize) -> u32;
    pub fn libdeflate_crc32(crc: u32, buffer: *const c_void, len: usize) -> u32;
    pub(crate) fn libdeflate_set_memory_allocator(
        malloc_func: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        free_func: Option<unsafe extern "C" fn(*mut c_void)>,
    );
}
