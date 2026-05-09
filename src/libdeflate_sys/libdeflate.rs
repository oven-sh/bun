use core::cell::UnsafeCell;
use core::ffi::{c_int, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};
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

unsafe extern "C" {
    // Allocation: scalar arg, no preconditions; returns null on OOM.
    pub safe fn libdeflate_alloc_compressor(compression_level: c_int) -> *mut Compressor;
    // NOT safe: `Options` carries caller-supplied `malloc_func`/`free_func`
    // callbacks that libdeflate will invoke and write through. A bogus callback
    // (constructible in 100% safe code) would cause UB inside the C library.
    pub fn libdeflate_alloc_compressor_ex(
        compression_level: c_int,
        options: *const Options,
    ) -> *mut Compressor;
    pub fn libdeflate_deflate_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    // Bound queries: opaque handle + scalar. The C API documents `compressor`
    // may be NULL (returns a library-wide upper bound), so expose it as
    // `Option<&mut Compressor>` (NPO-ABI-compatible with `*mut Compressor`).
    pub safe fn libdeflate_deflate_compress_bound(
        compressor: Option<&mut Compressor>,
        in_nbytes: usize,
    ) -> usize;
    pub fn libdeflate_zlib_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub safe fn libdeflate_zlib_compress_bound(compressor: Option<&mut Compressor>, in_nbytes: usize) -> usize;
    pub fn libdeflate_gzip_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub safe fn libdeflate_gzip_compress_bound(compressor: Option<&mut Compressor>, in_nbytes: usize) -> usize;
    pub fn libdeflate_free_compressor(compressor: *mut Compressor);
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

    /// # Safety
    /// `options.malloc_func`/`free_func` (if set) must be sound allocator
    /// callbacks — libdeflate writes through their return values.
    pub unsafe fn alloc_ex(compression_level: c_int, options: Option<&Options>) -> *mut Compressor {
        // SAFETY: caller upholds the callback contract; `Option<&T>` → `*const T` is NPO-compatible.
        unsafe {
            libdeflate_alloc_compressor_ex(
                compression_level,
                options.map_or(core::ptr::null(), |o| o),
            )
        }
    }

    /// Frees the compressor. `this` must not be used afterward.
    pub unsafe fn destroy(this: *mut Compressor) {
        // SAFETY: caller guarantees `this` was returned by libdeflate_alloc_compressor[_ex]
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
    pub safe fn libdeflate_alloc_decompressor() -> *mut Decompressor;
    // NOT safe: `Options` carries allocator callbacks (see `libdeflate_alloc_compressor_ex`).
    pub fn libdeflate_alloc_decompressor_ex(options: *const Options) -> *mut Decompressor;
}

pub const LIBDEFLATE_SUCCESS: c_uint = 0;
pub const LIBDEFLATE_BAD_DATA: c_uint = 1;
pub const LIBDEFLATE_SHORT_OUTPUT: c_uint = 2;
pub const LIBDEFLATE_INSUFFICIENT_SPACE: c_uint = 3;

// TODO(port): Zig uses `enum(c_uint)`; Rust cannot write `#[repr(c_uint)]`.
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
    pub fn libdeflate_deflate_decompress_ex(
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
    pub fn libdeflate_zlib_decompress_ex(
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
    pub fn libdeflate_gzip_decompress_ex(
        decompressor: *mut Decompressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
        actual_in_nbytes_ret: *mut usize,
        actual_out_nbytes_ret: *mut usize,
    ) -> Status;
    pub fn libdeflate_free_decompressor(decompressor: *mut Decompressor);
    pub fn libdeflate_adler32(adler: u32, buffer: *const c_void, len: usize) -> u32;
    pub fn libdeflate_crc32(crc: u32, buffer: *const c_void, len: usize) -> u32;
    pub fn libdeflate_set_memory_allocator(
        malloc_func: Option<unsafe extern "C" fn(usize) -> *mut c_void>,
        free_func: Option<unsafe extern "C" fn(*mut c_void)>,
    );
}

#[allow(non_camel_case_types)]
pub type libdeflate_compressor = Compressor;
#[allow(non_camel_case_types)]
pub type libdeflate_options = Options;
#[allow(non_camel_case_types)]
pub type libdeflate_decompressor = Decompressor;

// ported from: src/libdeflate_sys/libdeflate.zig
