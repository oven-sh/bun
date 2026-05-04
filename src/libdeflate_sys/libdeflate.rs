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
    pub fn libdeflate_alloc_compressor(compression_level: c_int) -> *mut Compressor;
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
    pub fn libdeflate_deflate_compress_bound(
        compressor: *mut Compressor,
        in_nbytes: usize,
    ) -> usize;
    pub fn libdeflate_zlib_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub fn libdeflate_zlib_compress_bound(compressor: *mut Compressor, in_nbytes: usize) -> usize;
    pub fn libdeflate_gzip_compress(
        compressor: *mut Compressor,
        in_: *const c_void,
        in_nbytes: usize,
        out: *mut c_void,
        out_nbytes_avail: usize,
    ) -> usize;
    pub fn libdeflate_gzip_compress_bound(compressor: *mut Compressor, in_nbytes: usize) -> usize;
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

#[repr(C)]
pub struct Compressor {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Compressor {
    pub fn alloc(compression_level: c_int) -> *mut Compressor {
        // SAFETY: FFI call; returns null on failure.
        unsafe { libdeflate_alloc_compressor(compression_level) }
    }

    pub fn alloc_ex(compression_level: c_int, options: Option<&Options>) -> *mut Compressor {
        // SAFETY: FFI call; options pointer is valid for the call duration or null.
        unsafe {
            libdeflate_alloc_compressor_ex(
                compression_level,
                options.map_or(core::ptr::null(), |o| o as *const Options),
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
                input.as_ptr() as *const c_void,
                input.len(),
                output.as_mut_ptr() as *mut c_void,
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
        // SAFETY: self is a valid *mut Compressor.
        unsafe {
            match encoding {
                Encoding::Deflate => libdeflate_deflate_compress_bound(self, input.len()),
                Encoding::Zlib => libdeflate_zlib_compress_bound(self, input.len()),
                Encoding::Gzip => libdeflate_gzip_compress_bound(self, input.len()),
            }
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
                input.as_ptr() as *const c_void,
                input.len(),
                output.as_mut_ptr() as *mut c_void,
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
                input.as_ptr() as *const c_void,
                input.len(),
                output.as_mut_ptr() as *mut c_void,
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

#[repr(C)]
pub struct Decompressor {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Decompressor {
    pub fn alloc() -> *mut Decompressor {
        // SAFETY: FFI call; returns null on failure.
        unsafe { libdeflate_alloc_decompressor() }
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
                input.as_ptr() as *const c_void,
                input.len(),
                output.as_mut_ptr() as *mut c_void,
                output.len(),
                &mut actual_in_bytes_ret,
                &mut actual_out_bytes_ret,
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
                input.as_ptr() as *const c_void,
                input.len(),
                output.as_mut_ptr() as *mut c_void,
                output.len(),
                &mut actual_in_bytes_ret,
                &mut actual_out_bytes_ret,
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
                input.as_ptr() as *const c_void,
                input.len(),
                output.as_mut_ptr() as *mut c_void,
                output.len(),
                &mut actual_in_bytes_ret,
                &mut actual_out_bytes_ret,
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
    pub fn libdeflate_alloc_decompressor() -> *mut Decompressor;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/libdeflate_sys/libdeflate.zig (150 lines)
//   confidence: high
//   todos:      1
//   notes:      opaque FFI handles keep explicit unsafe destroy (no Drop); Status uses #[repr(u32)] for c_uint; mi_malloc/mi_free path assumed in bun_alloc::mimalloc
// ──────────────────────────────────────────────────────────────────────────
