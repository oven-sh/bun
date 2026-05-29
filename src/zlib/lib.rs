// @link "deps/zlib/libz.a"

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::size_of;

use bun_collections::VecExt as _;

// TODO(port): move externs to zlib_sys crate

pub const MIN_WBITS: c_int = 8;
pub const MAX_WBITS: c_int = 15;

unsafe extern "C" {
    pub safe fn zlibVersion() -> *const c_char;

    pub fn compress(
        dest: *mut Bytef,
        dest_len: *mut uLongf,
        source: *const Bytef,
        source_len: uLong,
    ) -> c_int;
    pub fn compress2(
        dest: *mut Bytef,
        dest_len: *mut uLongf,
        source: *const Bytef,
        source_len: uLong,
        level: c_int,
    ) -> c_int;
    pub safe fn compressBound(source_len: uLong) -> uLong;
    pub fn uncompress(
        dest: *mut Bytef,
        dest_len: *mut uLongf,
        source: *const Bytef,
        source_len: uLong,
    ) -> c_int;
}

#[allow(non_camel_case_types, unused_imports)]
pub use bun_zlib_sys::shared::{Byte, Bytef, gzFile, struct_gzFile_s, uInt, uLong, uLongf, voidpf};

// typedef voidpf (*alloc_func) OF((voidpf opaque, uInt items, uInt size));
// typedef void   (*free_func)  OF((voidpf opaque, voidpf address));

pub use crate::internal::z_stream;
pub use crate::internal::z_streamp;

pub use crate::internal::FlushValue;
pub use crate::internal::ReturnCode;

use crate::internal::{DataType, zStream_struct};

// ZEXTERN int ZEXPORT inflateInit OF((z_streamp strm));

unsafe extern "C" {
    /// Initializes the internal stream state for decompression. The fields next_in, avail_in, zalloc, zfree and opaque must be initialized before by the caller. In the current version of inflate, the provided input is not read or consumed. The allocation of a sliding window will be deferred to the first call of inflate (if the decompression does not complete on the first call). If zalloc and zfree are set to Z_NULL, inflateInit updates them to use default allocation functions.
    ///
    /// inflateInit returns Z_OK if success, Z_MEM_ERROR if there was not enough memory, Z_VERSION_ERROR if the zlib library version is incompatible with the version assumed by the caller, or Z_STREAM_ERROR if the parameters are invalid, such as a null pointer to the structure. msg is set to null if there is no error message. inflateInit does not perform any decompression. Actual decompression will be done by inflate(). So next_in, and avail_in, next_out, and avail_out are unused and unchanged. The current implementation of inflateInit() does not process any header information—that is deferred until inflate() is called.
    pub fn inflateInit_(strm: z_streamp, version: *const u8, stream_size: c_int) -> ReturnCode;
    pub fn inflateInit2_(
        strm: z_streamp,
        window_size: c_int,
        version: *const u8,
        stream_size: c_int,
    ) -> ReturnCode;

    pub fn deflateSetDictionary(
        strm: z_streamp,
        dictionary: *const u8,
        length: c_uint,
    ) -> ReturnCode;

    pub fn deflateParams(strm: z_streamp, level: c_int, strategy: c_int) -> ReturnCode;

    pub fn inflate(stream: *mut zStream_struct, flush: FlushValue) -> ReturnCode;

    /// inflateEnd returns Z_OK if success, or Z_STREAM_ERROR if the stream state was inconsistent.
    /// All dynamically allocated data structures for this stream are freed. This function discards any unprocessed input and does not flush any pending output.
    pub fn inflateEnd(stream: *mut zStream_struct) -> ReturnCode;

    pub fn inflateReset(stream: *mut zStream_struct) -> ReturnCode;

    pub fn crc32(crc: uLong, buf: *const Bytef, len: uInt) -> uLong;
}

// Zig: `pub fn NewZlibReader(comptime Writer: type, comptime buffer_size: usize) type`
// `W: bun_io::Write` bound is applied on `read_all` (the only method that touches `context`).
pub struct ZlibReader<'a, W, const BUFFER_SIZE: usize> {
    pub context: W,
    pub input: &'a [u8],
    pub buf: [u8; BUFFER_SIZE],
    pub zlib: zStream_struct,
    // PORT NOTE: allocator field dropped (global mimalloc)
    pub state: ZlibReaderState,
}

pub use bun_core::compress::State;
pub type ZlibReaderState = State;
pub type ZlibReaderArrayListState = State;
pub type ZlibCompressorArrayListState = State;

impl<'a, W, const BUFFER_SIZE: usize> ZlibReader<'a, W, BUFFER_SIZE> {
    pub fn end(&mut self) {
        if self.state == ZlibReaderState::Inflating {
            // SAFETY: zlib was initialized via inflateInit2_; safe to end.
            unsafe { inflateEnd(&raw mut self.zlib) };
            self.state = ZlibReaderState::End;
        }
    }

    pub fn init(writer: W, input: &'a [u8]) -> Result<Box<Self>, ZlibError> {
        let mut zlib_reader = Box::new(Self {
            context: writer,
            input,
            buf: [0u8; BUFFER_SIZE],
            zlib: bun_core::ffi::zeroed(),
            state: ZlibReaderState::Uninitialized,
        });

        zlib_reader.zlib = zStream_struct {
            next_in: input.as_ptr(),
            avail_in: u32::try_from(input.len()).expect("int cast"),
            total_in: u32::try_from(input.len()).expect("int cast") as _,

            next_out: zlib_reader.buf.as_mut_ptr(),
            avail_out: BUFFER_SIZE as uInt,
            total_out: BUFFER_SIZE as _,

            err_msg: core::ptr::null(),
            alloc_func: Some(zlib_mi_malloc),
            free_func: Some(zlib_mi_free),

            internal_state: core::ptr::null_mut(),
            user_data: (&raw mut *zlib_reader).cast::<c_void>(),

            data_type: DataType::Unknown,
            adler: 0,
            reserved: 0,
        };

        // SAFETY: zlib_reader.zlib is fully initialized; version/size match the linked zlib.
        match unsafe {
            inflateInit2_(
                &raw mut zlib_reader.zlib,
                15 + 32,
                zlibVersion().cast::<u8>(),
                size_of::<zStream_struct>() as c_int,
            )
        } {
            ReturnCode::Ok => Ok(zlib_reader),
            ReturnCode::MemError => {
                drop(zlib_reader);
                Err(ZlibError::OutOfMemory)
            }
            ReturnCode::StreamError => {
                drop(zlib_reader);
                Err(ZlibError::InvalidArgument)
            }
            ReturnCode::VersionError => {
                drop(zlib_reader);
                Err(ZlibError::InvalidArgument)
            }
            _ => unreachable!(),
        }
    }

    pub fn error_message(&self) -> Option<&[u8]> {
        if !self.zlib.err_msg.is_null() {
            // SAFETY: err_msg is a NUL-terminated C string from zlib (static or stream-owned).
            return Some(
                unsafe { bun_core::ffi::cstr(self.zlib.err_msg.cast::<c_char>()) }.to_bytes(),
            );
        }
        None
    }

    // TODO(port): narrow error set — Zig inferred error union includes Writer's error set.
    pub fn read_all(&mut self, is_done: bool) -> Result<(), bun_core::Error>
    where
        W: bun_io::Write,
    {
        while self.state == ZlibReaderState::Uninitialized
            || self.state == ZlibReaderState::Inflating
        {
            if self.zlib.avail_out == 0 {
                // PORT NOTE: Zig did `var written = try ctx.write(&buf); while (written < avail_out) ...`
                // but avail_out == 0 here so the loop never ran; bun_io::Write::write_all is the
                // canonical full-buffer write and subsumes the partial-write retry loop.
                self.context.write_all(&self.buf)?;
                self.zlib.avail_out = BUFFER_SIZE as uInt;
                self.zlib.next_out = self.buf.as_mut_ptr();
            }

            // Try to inflate even if avail_in is 0, as this could be a valid empty gzip stream
            // SAFETY: self.zlib was initialized via inflateInit2_.
            let rc = unsafe { inflate(&raw mut self.zlib, FlushValue::NoFlush) };
            self.state = ZlibReaderState::Inflating;

            match rc {
                ReturnCode::StreamEnd => {
                    self.state = ZlibReaderState::End;
                    let remainder = &self.buf[0..BUFFER_SIZE - self.zlib.avail_out as usize];
                    // PORT NOTE: Zig's partial-write retry loop collapses to write_all under bun_io::Write.
                    self.context.write_all(remainder)?;
                    self.end();
                    return Ok(());
                }
                ReturnCode::MemError => {
                    self.state = ZlibReaderState::Error;
                    return Err(bun_core::err!("OutOfMemory"));
                }
                ReturnCode::BufError => {
                    // BufError with avail_in == 0 means we need more input data
                    if self.zlib.avail_in == 0 {
                        if is_done {
                            // Stream is truncated - we're at EOF but decoder needs more data
                            self.state = ZlibReaderState::Error;
                            return Err(bun_core::err!("ZlibError"));
                        }
                        // Not at EOF - we can retry with more data
                        return Err(bun_core::err!("ShortRead"));
                    }
                    self.state = ZlibReaderState::Error;
                    return Err(bun_core::err!("ZlibError"));
                }
                ReturnCode::StreamError
                | ReturnCode::DataError
                | ReturnCode::NeedDict
                | ReturnCode::VersionError
                | ReturnCode::ErrNo => {
                    self.state = ZlibReaderState::Error;
                    return Err(bun_core::err!("ZlibError"));
                }
                ReturnCode::Ok => {}
            }
        }
        Ok(())
    }
}

impl<'a, W, const BUFFER_SIZE: usize> Drop for ZlibReader<'a, W, BUFFER_SIZE> {
    fn drop(&mut self) {
        // Zig deinit: end() then allocator.destroy(this) — destroy is implicit Box drop.
        self.end();
    }
}

// TODO(port): thiserror not in workspace deps; manual Display impl below.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ZlibError {
    OutOfMemory,
    InvalidArgument,
    ZlibError,
    ShortRead,
}

bun_core::impl_tag_error!(ZlibError);

bun_core::named_error_set!(ZlibError);

pub(crate) use bun_alloc::c_thunks::{
    mi_free_opaque as zlib_mi_free, mi_malloc_items as zlib_mi_malloc,
};

#[allow(non_snake_case)]
mod ZlibAllocator {
    bun_alloc::c_thunks_for_zone!("zlib");
    pub(crate) use calloc_items as alloc;
}

pub struct ZlibReaderArrayList<'a> {
    pub input: &'a [u8],
    pub list_ptr: &'a mut Vec<u8>,
    pub zlib: zStream_struct,
    // PORT NOTE: allocator field dropped (global mimalloc)
    pub state: ZlibReaderArrayListState,
    /// Decompression-bomb guard: `read_all` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub max_output_size: usize,
}

impl<'a> Drop for ZlibReaderArrayList<'a> {
    fn drop(&mut self) {
        // Zig deinit: end() then allocator.destroy(this) — destroy is implicit Box drop.
        self.end();
    }
}

impl<'a> ZlibReaderArrayList<'a> {
    pub fn end(&mut self) {
        // always free with `inflateEnd`
        if self.state != ZlibReaderArrayListState::End {
            // SAFETY: zlib was initialized via inflateInit2_; safe to end.
            unsafe { inflateEnd(&raw mut self.zlib) };
            self.state = ZlibReaderArrayListState::End;
        }
    }

    pub fn init(input: &'a [u8], list: &'a mut Vec<u8>) -> Result<Box<Self>, ZlibError> {
        let options = Options {
            window_bits: 15 + 32,
            ..Default::default()
        };

        Self::init_with_options(input, list, options)
    }

    pub fn init_with_options(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: Options,
    ) -> Result<Box<Self>, ZlibError> {
        Self::init_with_options_and_list_allocator(input, list, options)
    }

    // PORT NOTE: list_allocator/allocator params dropped (global mimalloc).
    pub fn init_with_options_and_list_allocator(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: Options,
    ) -> Result<Box<Self>, ZlibError> {
        let mut zlib_reader = Box::new(Self {
            input,
            list_ptr: list,
            zlib: bun_core::ffi::zeroed(),
            state: ZlibReaderArrayListState::Uninitialized,
            max_output_size: usize::MAX,
        });

        let list_len = zlib_reader.list_ptr.len();
        zlib_reader.zlib = zStream_struct {
            next_in: input.as_ptr(),
            avail_in: input.len() as uInt,
            total_in: input.len() as _,

            next_out: zlib_reader.list_ptr.as_mut_ptr(),
            avail_out: list_len as uInt,
            total_out: list_len as _,

            err_msg: core::ptr::null(),
            alloc_func: Some(ZlibAllocator::alloc),
            free_func: Some(ZlibAllocator::free),

            internal_state: core::ptr::null_mut(),
            user_data: (&raw mut *zlib_reader).cast::<c_void>(),

            data_type: DataType::Unknown,
            adler: 0,
            reserved: 0,
        };

        // SAFETY: zlib_reader.zlib is fully initialized; version/size match the linked zlib.
        match unsafe {
            inflateInit2_(
                &raw mut zlib_reader.zlib,
                options.window_bits,
                zlibVersion().cast::<u8>(),
                size_of::<zStream_struct>() as c_int,
            )
        } {
            ReturnCode::Ok => Ok(zlib_reader),
            ReturnCode::MemError => {
                drop(zlib_reader);
                Err(ZlibError::OutOfMemory)
            }
            ReturnCode::StreamError => {
                drop(zlib_reader);
                Err(ZlibError::InvalidArgument)
            }
            ReturnCode::VersionError => {
                drop(zlib_reader);
                Err(ZlibError::InvalidArgument)
            }
            _ => unreachable!(),
        }
    }

    pub fn error_message(&self) -> Option<&[u8]> {
        if !self.zlib.err_msg.is_null() {
            // SAFETY: err_msg is a NUL-terminated C string from zlib.
            return Some(
                unsafe { bun_core::ffi::cstr(self.zlib.err_msg.cast::<c_char>()) }.to_bytes(),
            );
        }
        None
    }

    pub fn read_all(&mut self, is_done: bool) -> Result<(), ZlibError> {
        let result = (|| -> Result<(), ZlibError> {
            while self.state == ZlibReaderArrayListState::Uninitialized
                || self.state == ZlibReaderArrayListState::Inflating
            {
                if self.zlib.avail_out == 0 {
                    let produced = self.zlib.total_out as usize;
                    let remaining_budget = self.max_output_size.saturating_sub(produced);
                    if remaining_budget == 0 {
                        self.state = ZlibReaderArrayListState::Error;
                        return Err(ZlibError::ZlibError);
                    }
                    // SAFETY: zlib writes the tail; len is truncated to `total_out` before any read.
                    let (next_out, avail_out) = unsafe {
                        self.list_ptr
                            .reserve_expand_tail(remaining_budget.min(4096))
                    };
                    self.zlib.next_out = next_out;
                    // Clamp so a single inflate call cannot write past `max_output_size`.
                    self.zlib.avail_out = avail_out.min(remaining_budget) as uInt;
                }

                // Try to inflate even if avail_in is 0, as this could be a valid empty gzip stream
                // SAFETY: self.zlib was initialized via inflateInit2_.
                let rc = unsafe { inflate(&raw mut self.zlib, FlushValue::NoFlush) };
                self.state = ZlibReaderArrayListState::Inflating;

                match rc {
                    ReturnCode::StreamEnd => {
                        self.end();
                        return Ok(());
                    }
                    ReturnCode::MemError => {
                        self.state = ZlibReaderArrayListState::Error;
                        return Err(ZlibError::OutOfMemory);
                    }
                    ReturnCode::BufError => {
                        // BufError with avail_in == 0 means we need more input data
                        if self.zlib.avail_in == 0 {
                            if is_done {
                                // Stream is truncated - we're at EOF but decoder needs more data
                                self.state = ZlibReaderArrayListState::Error;
                                return Err(ZlibError::ZlibError);
                            }
                            // Not at EOF - we can retry with more data
                            return Err(ZlibError::ShortRead);
                        }
                        self.state = ZlibReaderArrayListState::Error;
                        return Err(ZlibError::ZlibError);
                    }
                    ReturnCode::StreamError
                    | ReturnCode::DataError
                    | ReturnCode::NeedDict
                    | ReturnCode::VersionError
                    | ReturnCode::ErrNo => {
                        self.state = ZlibReaderArrayListState::Error;
                        return Err(ZlibError::ZlibError);
                    }
                    ReturnCode::Ok => {}
                }
            }
            Ok(())
        })();

        // defer epilogue (runs unconditionally):
        let total_out = self.zlib.total_out as usize;
        if self.list_ptr.len() > total_out {
            self.list_ptr.truncate(total_out);
        } else if total_out < self.list_ptr.capacity() {
            // SAFETY: zlib has written `total_out` bytes into list_ptr's buffer.
            unsafe { self.list_ptr.set_len(total_out) };
        }

        result
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub gzip: bool,
    pub level: c_int,
    pub method: c_int,
    pub window_bits: c_int,
    pub mem_level: c_int,
    pub strategy: c_int,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            gzip: false,
            level: 6,
            method: 8,
            window_bits: 15,
            mem_level: 8,
            strategy: 0,
        }
    }
}

unsafe extern "C" {
    pub fn deflateInit_(
        strm: z_streamp,
        level: c_int,
        version: *const c_char,
        stream_size: c_int,
    ) -> ReturnCode;

    pub fn deflate(strm: z_streamp, flush: FlushValue) -> ReturnCode;

    pub fn deflateEnd(stream: z_streamp) -> ReturnCode;

    pub fn deflateReset(stream: z_streamp) -> ReturnCode;

    pub fn deflateBound(strm: z_streamp, source_len: uLong) -> uLong;

    pub fn deflateInit2_(
        strm: z_streamp,
        level: c_int,
        method: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
        version: *const u8,
        stream_size: c_int,
    ) -> ReturnCode;

    /// Initializes the decompression dictionary from the given uncompressed byte sequence. This function must be called immediately after a call of inflate, if that call returned Z_NEED_DICT. The dictionary chosen by the compressor can be determined from the Adler-32 value returned by that call of inflate. The compressor and decompressor must use exactly the same dictionary (see deflateSetDictionary). For raw inflate, this function can be called at any time to set the dictionary. If the provided dictionary is smaller than the window and there is already data in the window, then the provided dictionary will amend what's there. The application must insure that the dictionary that was used for compression is provided.
    ///
    /// inflateSetDictionary returns Z_OK if success, Z_STREAM_ERROR if a parameter is invalid (such as NULL dictionary) or the stream state is inconsistent, Z_DATA_ERROR if the given dictionary doesn't match the expected one (incorrect Adler-32 value). inflateSetDictionary does not perform any decompression: this will be done by subsequent calls of inflate().
    pub fn inflateSetDictionary(
        strm: z_streamp,
        dictionary: *const u8,
        length: c_uint,
    ) -> ReturnCode;
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
#[allow(non_camel_case_types)] // names mirror Node.js zlib mode constants
pub enum NodeMode {
    NONE = 0,
    DEFLATE = 1,
    INFLATE = 2,
    GZIP = 3,
    GUNZIP = 4,
    DEFLATERAW = 5,
    INFLATERAW = 6,
    UNZIP = 7,
    BROTLI_DECODE = 8,
    BROTLI_ENCODE = 9,
    ZSTD_COMPRESS = 10,
    ZSTD_DECOMPRESS = 11,
}

impl NodeMode {
    /// Decode from the JS-side mode int. Range-validated by the caller
    /// (`NativeZlib`/`NativeBrotli`/`NativeZstd` constructors); out-of-range
    /// values map to `NONE` rather than UB (RUST_PATTERNS.md §18).
    #[inline]
    pub const fn from_int(n: u8) -> Self {
        match n {
            1 => Self::DEFLATE,
            2 => Self::INFLATE,
            3 => Self::GZIP,
            4 => Self::GUNZIP,
            5 => Self::DEFLATERAW,
            6 => Self::INFLATERAW,
            7 => Self::UNZIP,
            8 => Self::BROTLI_DECODE,
            9 => Self::BROTLI_ENCODE,
            10 => Self::ZSTD_COMPRESS,
            11 => Self::ZSTD_DECOMPRESS,
            _ => Self::NONE,
        }
    }
}

/// Not for streaming!
pub struct ZlibCompressorArrayList<'a> {
    pub input: &'a [u8],
    pub list_ptr: &'a mut Vec<u8>,
    pub zlib: zStream_struct,
    // PORT NOTE: allocator field dropped (global mimalloc)
    pub state: ZlibCompressorArrayListState,
}

impl<'a> ZlibCompressorArrayList<'a> {
    pub fn end(&mut self) {
        if self.state != ZlibCompressorArrayListState::End {
            // SAFETY: zlib was initialized via deflateInit2_; safe to end.
            unsafe { deflateEnd(&raw mut self.zlib) };
            self.state = ZlibCompressorArrayListState::End;
        }
    }

    pub fn init(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: Options,
    ) -> Result<Box<Self>, ZlibError> {
        Self::init_with_list_allocator(input, list, options)
    }

    // PORT NOTE: allocator/list_allocator params dropped (global mimalloc).
    pub fn init_with_list_allocator(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: Options,
    ) -> Result<Box<Self>, ZlibError> {
        let mut zlib_reader = Box::new(Self {
            input,
            list_ptr: list,
            zlib: bun_core::ffi::zeroed(),
            state: ZlibCompressorArrayListState::Uninitialized,
        });

        let list_len = zlib_reader.list_ptr.len();
        zlib_reader.zlib = zStream_struct {
            next_in: input.as_ptr(),
            avail_in: input.len() as uInt,
            total_in: input.len() as _,

            next_out: zlib_reader.list_ptr.as_mut_ptr(),
            avail_out: list_len as uInt,
            total_out: list_len as _,

            err_msg: core::ptr::null(),
            alloc_func: Some(zlib_mi_malloc),
            free_func: Some(zlib_mi_free),

            internal_state: core::ptr::null_mut(),
            user_data: (&raw mut *zlib_reader).cast::<c_void>(),

            data_type: DataType::Unknown,
            adler: 0,
            reserved: 0,
        };

        // SAFETY: zlib_reader.zlib is fully initialized; version/size match the linked zlib.
        match unsafe {
            deflateInit2_(
                &raw mut zlib_reader.zlib,
                options.level,
                options.method,
                if !options.gzip {
                    -options.window_bits
                } else {
                    options.window_bits + 16
                },
                options.mem_level,
                options.strategy,
                zlibVersion().cast::<u8>(),
                size_of::<zStream_struct>() as c_int,
            )
        } {
            ReturnCode::Ok => {
                // SAFETY: zlib initialized; deflateBound returns upper bound on output.
                let bound = unsafe {
                    deflateBound(
                        &raw mut zlib_reader.zlib,
                        uLong::try_from(input.len()).expect("int cast"),
                    )
                };
                // ensureTotalCapacityPrecise → reserve_exact
                let need = (bound as usize).saturating_sub(zlib_reader.list_ptr.len());
                zlib_reader.list_ptr.reserve_exact(need);
                // PORT NOTE: Zig caught alloc OOM here; Rust Vec aborts on OOM.
                zlib_reader.zlib.avail_out = zlib_reader.list_ptr.capacity() as uInt;
                zlib_reader.zlib.next_out = zlib_reader.list_ptr.as_mut_ptr();

                Ok(zlib_reader)
            }
            ReturnCode::MemError => {
                drop(zlib_reader);
                Err(ZlibError::OutOfMemory)
            }
            ReturnCode::StreamError => {
                drop(zlib_reader);
                Err(ZlibError::InvalidArgument)
            }
            ReturnCode::VersionError => {
                drop(zlib_reader);
                Err(ZlibError::InvalidArgument)
            }
            _ => unreachable!(),
        }
    }

    pub fn error_message(&self) -> Option<&[u8]> {
        if !self.zlib.err_msg.is_null() {
            // SAFETY: err_msg is a NUL-terminated C string from zlib.
            return Some(
                unsafe { bun_core::ffi::cstr(self.zlib.err_msg.cast::<c_char>()) }.to_bytes(),
            );
        }
        None
    }

    pub fn read_all(&mut self) -> Result<(), ZlibError> {
        let result = (|| -> Result<(), ZlibError> {
            while self.state == ZlibCompressorArrayListState::Uninitialized
                || self.state == ZlibCompressorArrayListState::Inflating
            {
                if self.zlib.avail_out == 0 {
                    // SAFETY: zlib writes the tail; len is truncated to `total_out` before any read.
                    let (next_out, avail_out) = unsafe { self.list_ptr.reserve_expand_tail(4096) };
                    self.zlib.next_out = next_out;
                    self.zlib.avail_out = avail_out as uInt;
                }

                if self.zlib.avail_out == 0 {
                    return Err(ZlibError::ShortRead);
                }

                // SAFETY: self.zlib was initialized via deflateInit2_.
                let rc = unsafe { deflate(&raw mut self.zlib, FlushValue::Finish) };
                self.state = ZlibCompressorArrayListState::Inflating;

                match rc {
                    ReturnCode::StreamEnd => {
                        // SAFETY: zlib has written `total_out` bytes into list_ptr's buffer.
                        unsafe { self.list_ptr.set_len(self.zlib.total_out as usize) };
                        self.end();

                        return Ok(());
                    }
                    ReturnCode::MemError => {
                        self.end();
                        self.state = ZlibCompressorArrayListState::Error;
                        return Err(ZlibError::OutOfMemory);
                    }
                    ReturnCode::StreamError
                    | ReturnCode::DataError
                    | ReturnCode::BufError
                    | ReturnCode::NeedDict
                    | ReturnCode::VersionError
                    | ReturnCode::ErrNo => {
                        self.end();
                        self.state = ZlibCompressorArrayListState::Error;
                        return Err(ZlibError::ZlibError);
                    }
                    ReturnCode::Ok => {}
                }
            }
            Ok(())
        })();

        // defer epilogue (runs unconditionally):
        // Zig: this.list.shrinkRetainingCapacity(this.zlib.total_out); this.list_ptr.* = this.list;
        self.list_ptr.truncate(self.zlib.total_out as usize);

        result
    }
}

impl<'a> Drop for ZlibCompressorArrayList<'a> {
    fn drop(&mut self) {
        // Zig deinit: end() then allocator.destroy(this) — destroy is implicit Box drop.
        self.end();
    }
}

// Zig: `@import("zlib-internal")` → `src/zlib_sys/{posix,win32}.zig` (see build.zig).
// Re-export from bun_zlib_sys, platform-selected to match build.zig.
mod internal {
    #[cfg(not(windows))]
    pub(super) use bun_zlib_sys::posix::{DataType, zStream_struct};
    #[cfg(not(windows))]
    pub use bun_zlib_sys::posix::{FlushValue, ReturnCode, z_stream, z_streamp};
    #[cfg(windows)]
    pub(super) use bun_zlib_sys::win32::{DataType, zStream_struct};
    #[cfg(windows)]
    pub use bun_zlib_sys::win32::{FlushValue, ReturnCode, z_stream, z_streamp};
}

// ported from: src/zlib/zlib.zig
