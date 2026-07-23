// @link "deps/zlib/libz.a"

pub mod error;
pub use error::{Error, Result};

use core::ffi::c_int;

use bun_collections::VecExt as _;

#[allow(non_camel_case_types, unused_imports)]
pub use bun_zlib_sys::{
    Byte, Bytef, DataType, FlushValue, ReturnCode, gzFile, raw::compressBound, raw::zlibVersion,
    struct_gzFile_s, uInt, uLong, uLongf, voidpf, z_stream, z_streamp, zStream_struct,
};

pub const MAX_WBITS: c_int = 15;

pub use bun_core::compress::State;
pub type ZlibReaderArrayListState = State;
pub type ZlibCompressorArrayListState = State;

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ZlibError {
    OutOfMemory,
    InvalidArgument,
    ZlibError,
    ShortRead,
}

bun_core::impl_tag_error!(ZlibError);

// zlib `alloc_func`/`free_func` thunks → mimalloc. Shared by
// `ZlibCompressorArrayList`. Intentionally `mi_malloc`, NOT `mi_calloc` (see
// `ZlibAllocator::alloc` for the zeroing heap-breakdown variant used by
// `ZlibReaderArrayList`).
use bun_alloc::c_thunks::{mi_free_opaque as zlib_mi_free, mi_malloc_items as zlib_mi_malloc};

#[allow(non_snake_case)]
mod ZlibAllocator {
    bun_alloc::c_thunks_for_zone!("zlib");
    pub(crate) use calloc_items as alloc;
}

/// A zeroed `z_stream` wired to the mimalloc zone allocator.
#[inline]
fn new_zstream() -> zStream_struct {
    zStream_struct::with_allocator(Some(ZlibAllocator::alloc), Some(ZlibAllocator::free))
}

/// Safe CRC-32 over an arbitrary-length slice. zlib's `crc32` takes a 32-bit
/// length, so inputs larger than `u32::MAX` are fed in chunks.
pub fn crc32_bytes(crc: u32, data: &[u8]) -> u32 {
    let mut crc: uLong = uLong::from(crc);
    for chunk in data.chunks(u32::MAX as usize) {
        // SAFETY: `chunk` is a valid slice with `len <= u32::MAX`.
        crc = unsafe { bun_zlib_sys::raw::crc32(crc, chunk.as_ptr(), chunk.len() as uInt) };
    }
    crc as u32
}

/// Safe `compress2` into a caller-supplied buffer. Returns the number of
/// bytes written on `Z_OK`, or the zlib return code otherwise.
pub fn compress2_into(
    dest: &mut [u8],
    source: &[u8],
    level: c_int,
) -> core::result::Result<usize, ReturnCode> {
    // `uLong` is 32-bit on LLP64 Windows; refuse rather than silently
    // compressing a truncated prefix.
    let source_len = uLong::try_from(source.len()).map_err(|_| ReturnCode::BufError)?;
    let mut dest_len = uLong::try_from(dest.len()).map_err(|_| ReturnCode::BufError)?;
    // SAFETY: `dest`/`source` are valid slices; `dest_len` is a local.
    let rc = unsafe {
        bun_zlib_sys::raw::compress2(
            dest.as_mut_ptr(),
            &raw mut dest_len,
            source.as_ptr(),
            source_len,
            level,
        )
    };
    match rc {
        ReturnCode::Ok => Ok(dest_len as usize),
        _ => Err(rc),
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct ZlibReaderArrayList<'a> {
    pub input: &'a [u8],
    pub list_ptr: &'a mut Vec<u8>,
    pub zlib: zStream_struct,
    pub state: ZlibReaderArrayListState,
    /// Decompression-bomb guard: `read_all` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub max_output_size: usize,
}

impl<'a> Drop for ZlibReaderArrayList<'a> {
    fn drop(&mut self) {
        self.end();
    }
}

impl<'a> ZlibReaderArrayList<'a> {
    pub fn end(&mut self) {
        // always free with `inflateEnd`
        if self.state != ZlibReaderArrayListState::End {
            self.zlib.inflate_end();
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

    pub fn init_with_options_and_list_allocator(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: Options,
    ) -> Result<Box<Self>, ZlibError> {
        let mut zlib_reader = Box::new(Self {
            input,
            list_ptr: list,
            zlib: new_zstream(),
            state: ZlibReaderArrayListState::Uninitialized,
            max_output_size: usize::MAX,
        });

        let list_len = zlib_reader.list_ptr.len();
        // SAFETY: invariant (B) — `input` is borrowed for `'a` and `list_ptr` is
        // exclusively borrowed for `'a`, both outliving `self.zlib`. The
        // output window is re-pointed on every `list_ptr` reallocation in
        // `read_all`, so `next_out` never dangles.
        unsafe {
            zlib_reader
                .zlib
                .set_input(input.as_ptr(), input.len() as uInt);
            zlib_reader
                .zlib
                .set_output(zlib_reader.list_ptr.as_mut_ptr(), list_len as uInt);
        }

        match zlib_reader.zlib.inflate_init2(options.window_bits) {
            ReturnCode::Ok => Ok(zlib_reader),
            ReturnCode::MemError => Err(ZlibError::OutOfMemory),
            ReturnCode::StreamError | ReturnCode::VersionError => Err(ZlibError::InvalidArgument),
            _ => unreachable!(),
        }
    }

    pub fn error_message(&self) -> Option<&[u8]> {
        self.zlib.err_msg().map(|s| s.to_bytes())
    }

    pub fn read_all(&mut self, is_done: bool) -> Result<(), ZlibError> {
        let result = (|| -> Result<(), ZlibError> {
            while self.state == ZlibReaderArrayListState::Uninitialized
                || self.state == ZlibReaderArrayListState::Inflating
            {
                if self.zlib.avail_out() == 0 {
                    let produced = self.zlib.total_out as usize;
                    let remaining_budget = self.max_output_size.saturating_sub(produced);
                    if remaining_budget == 0 {
                        self.state = ZlibReaderArrayListState::Error;
                        return Err(ZlibError::ZlibError);
                    }
                    // SAFETY: zlib writes the tail; len is truncated to
                    // `total_out` before any read (epilogue below).
                    let (next_out, avail_out) = unsafe {
                        self.list_ptr
                            .reserve_expand_tail(remaining_budget.min(4096))
                    };
                    // Clamp so a single inflate call cannot write past
                    // `max_output_size`.
                    let avail_out = avail_out.min(remaining_budget) as uInt;
                    // SAFETY: invariant (B) — `(next_out, avail_out)` is
                    // `list_ptr`'s freshly-grown tail; `list_ptr` is
                    // exclusively borrowed by `self`.
                    unsafe { self.zlib.set_output(next_out, avail_out) };
                }

                // Try to inflate even if avail_in is 0: may be a valid empty
                // gzip stream.
                let rc = self.zlib.inflate(FlushValue::NoFlush);
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
                        if self.zlib.avail_in() == 0 {
                            if is_done {
                                self.state = ZlibReaderArrayListState::Error;
                                return Err(ZlibError::ZlibError);
                            }
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
            // SAFETY: zlib has written `total_out` bytes into list_ptr's
            // buffer.
            unsafe { self.list_ptr.set_len(total_out) };
        }

        result
    }
}

#[derive(Clone, Copy)]
pub struct Options {
    pub gzip: bool,
    pub level: c_int,
    pub window_bits: c_int,
    pub mem_level: c_int,
    pub strategy: c_int,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            gzip: false,
            level: 6,
            window_bits: 15,
            mem_level: 8,
            strategy: 0,
        }
    }
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
    pub state: ZlibCompressorArrayListState,
}

impl<'a> ZlibCompressorArrayList<'a> {
    pub fn end(&mut self) {
        if self.state != ZlibCompressorArrayListState::End {
            self.zlib.deflate_end();
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

    pub fn init_with_list_allocator(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: Options,
    ) -> Result<Box<Self>, ZlibError> {
        let mut zlib_reader = Box::new(Self {
            input,
            list_ptr: list,
            zlib: zStream_struct::with_allocator(Some(zlib_mi_malloc), Some(zlib_mi_free)),
            state: ZlibCompressorArrayListState::Uninitialized,
        });

        match zlib_reader.zlib.deflate_init2(
            options.level,
            if !options.gzip {
                -options.window_bits
            } else {
                options.window_bits + 16
            },
            options.mem_level,
            options.strategy,
        ) {
            ReturnCode::Ok => {
                let bound = zlib_reader
                    .zlib
                    .deflate_bound(uLong::try_from(input.len()).expect("int cast"));
                let need = (bound as usize).saturating_sub(zlib_reader.list_ptr.len());
                zlib_reader.list_ptr.reserve_exact(need);
                let cap = zlib_reader.list_ptr.capacity() as uInt;
                // SAFETY: invariant (B) — `input` is borrowed for `'a`;
                // `list_ptr` is exclusively borrowed for `'a` and was just
                // (re)allocated, so its buffer is live for `cap` bytes. The
                // output window is re-pointed on every reallocation in
                // `read_all`.
                unsafe {
                    zlib_reader
                        .zlib
                        .set_input(input.as_ptr(), input.len() as uInt);
                    zlib_reader
                        .zlib
                        .set_output(zlib_reader.list_ptr.as_mut_ptr(), cap);
                }
                Ok(zlib_reader)
            }
            ReturnCode::MemError => Err(ZlibError::OutOfMemory),
            ReturnCode::StreamError | ReturnCode::VersionError => Err(ZlibError::InvalidArgument),
            _ => unreachable!(),
        }
    }

    pub fn error_message(&self) -> Option<&[u8]> {
        self.zlib.err_msg().map(|s| s.to_bytes())
    }

    pub fn read_all(&mut self) -> Result<(), ZlibError> {
        let result = (|| -> Result<(), ZlibError> {
            while self.state == ZlibCompressorArrayListState::Uninitialized
                || self.state == ZlibCompressorArrayListState::Inflating
            {
                if self.zlib.avail_out() == 0 {
                    // SAFETY: zlib writes the tail; len is truncated to
                    // `total_out` before any read.
                    let (next_out, avail_out) = unsafe { self.list_ptr.reserve_expand_tail(4096) };
                    // SAFETY: invariant (B) — `list_ptr`'s freshly-grown tail.
                    unsafe { self.zlib.set_output(next_out, avail_out as uInt) };
                }

                if self.zlib.avail_out() == 0 {
                    return Err(ZlibError::ShortRead);
                }

                let rc = self.zlib.deflate(FlushValue::Finish);
                self.state = ZlibCompressorArrayListState::Inflating;

                match rc {
                    ReturnCode::StreamEnd => {
                        // SAFETY: zlib has written `total_out` bytes into
                        // list_ptr's buffer.
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

        // epilogue (runs unconditionally): sync the output length back.
        self.list_ptr.truncate(self.zlib.total_out as usize);

        result
    }
}

impl<'a> Drop for ZlibCompressorArrayList<'a> {
    fn drop(&mut self) {
        self.end();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Owned streaming encoder/decoder — RAII z_stream with no borrowed buffers.
//
// Unlike `Zlib*ArrayList<'a>` above, these hold only the z_stream and its
// C-side `internal_state`. Input and output are passed per call, so callers
// can hold a decoder across multiple chunks without lifetime erasure.
//
// The `z_stream` is boxed because zlib-ng's `inflate_state`/`deflate_state`
// store a back-pointer to it (checked in `inflateStateCheck` /
// `deflateStateCheck`), so it must not move after init.
// ──────────────────────────────────────────────────────────────────────────

/// RAII deflate (compression) stream. `deflateEnd` on drop.
pub struct DeflateEncoder {
    strm: Box<zStream_struct>,
}

impl DeflateEncoder {
    pub fn new(
        level: c_int,
        window_bits: c_int,
        mem_level: c_int,
        strategy: c_int,
    ) -> Result<Self, ZlibError> {
        let mut this = Self {
            strm: Box::new(new_zstream()),
        };
        match this
            .strm
            .deflate_init2(level, window_bits, mem_level, strategy)
        {
            ReturnCode::Ok => Ok(this),
            ReturnCode::MemError => Err(ZlibError::OutOfMemory),
            _ => Err(ZlibError::InvalidArgument),
        }
    }

    #[inline]
    pub fn avail_in(&self) -> u32 {
        self.strm.avail_in() as u32
    }

    #[inline]
    pub fn avail_out(&self) -> u32 {
        self.strm.avail_out() as u32
    }

    pub fn reset(&mut self) -> ReturnCode {
        self.strm.deflate_reset()
    }

    /// One `deflate()` call writing into `out`'s spare capacity.
    ///
    /// Reserves at least `reserve` spare bytes in `out`, points
    /// `next_in`/`avail_in` at `input` and `next_out`/`avail_out` at the
    /// spare, calls `deflate(flush)`, and advances `out.len()` by the bytes
    /// produced. Returns `(bytes_consumed_from_input, return_code)`. Inputs
    /// larger than `u32::MAX` are clamped; callers loop and advance `input`
    /// by `consumed`.
    pub fn step(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        reserve: usize,
        flush: FlushValue,
    ) -> (usize, ReturnCode) {
        step_into_vec(&mut self.strm, input, out, reserve, flush, true)
    }
}

impl Drop for DeflateEncoder {
    fn drop(&mut self) {
        self.strm.deflate_end();
    }
}

/// RAII inflate (decompression) stream. `inflateEnd` on drop.
pub struct InflateDecoder {
    strm: Box<zStream_struct>,
    pub state: State,
    /// Decompression-bomb guard for [`decompress`](Self::decompress).
    pub max_output_size: usize,
    /// RFC 1952 §2.2: a gzip file is a sequence of members. When true (set
    /// for gzip-only `window_bits`), [`decompress`](Self::decompress) resets
    /// on `Z_STREAM_END` and continues if input remains, so concatenated
    /// members are all decoded instead of silently dropped after the first.
    multi_member: bool,
}

impl InflateDecoder {
    pub fn new(window_bits: c_int) -> Result<Self, ZlibError> {
        let mut this = Self {
            strm: Box::new(new_zstream()),
            state: State::Uninitialized,
            max_output_size: usize::MAX,
            // `MAX_WBITS | 16` selects gzip-only decode (zlib manual).
            multi_member: (16..32).contains(&window_bits),
        };
        match this.strm.inflate_init2(window_bits) {
            ReturnCode::Ok => Ok(this),
            ReturnCode::MemError => Err(ZlibError::OutOfMemory),
            _ => Err(ZlibError::InvalidArgument),
        }
    }

    #[inline]
    pub fn avail_in(&self) -> u32 {
        self.strm.avail_in() as u32
    }

    #[inline]
    pub fn avail_out(&self) -> u32 {
        self.strm.avail_out() as u32
    }

    pub fn reset(&mut self) -> ReturnCode {
        let rc = self.strm.inflate_reset();
        if rc == ReturnCode::Ok {
            self.state = State::Uninitialized;
        }
        rc
    }

    /// One `inflate()` call writing into `out`'s spare capacity. Same
    /// contract as [`DeflateEncoder::step`].
    pub fn step(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        reserve: usize,
        flush: FlushValue,
    ) -> (usize, ReturnCode) {
        step_into_vec(&mut self.strm, input, out, reserve, flush, false)
    }

    /// Consume all of `input`, appending decompressed output to `out`
    /// (growing by 4096-byte steps, capped at `max_output_size`). Returns
    /// `ShortRead` when more input is required and `is_done` is false.
    ///
    /// The stream state persists across calls so this can be driven one
    /// body chunk at a time.
    pub fn decompress(
        &mut self,
        mut input: &[u8],
        out: &mut Vec<u8>,
        is_done: bool,
    ) -> Result<(), ZlibError> {
        if matches!(self.state, State::Error) {
            return Ok(());
        }
        if matches!(self.state, State::End) {
            // A prior call completed a gzip member at the chunk boundary.
            // Only resume when the next byte is the gzip magic ID1 (RFC 1952
            // §2.3.1); any other trailing bytes are tolerated as garbage so
            // stray CRLF/footer junk does not turn into a decode error.
            if self.multi_member && input.first() == Some(&0x1f) {
                if self.reset() != ReturnCode::Ok {
                    self.state = State::Error;
                    return Err(ZlibError::ZlibError);
                }
            } else {
                return Ok(());
            }
        }
        loop {
            let remaining = self.max_output_size.saturating_sub(out.len());
            if remaining == 0 {
                self.state = State::Error;
                return Err(ZlibError::ZlibError);
            }
            let reserve = remaining.min(4096);
            let (consumed, rc) = self.step(input, out, reserve, FlushValue::NoFlush);
            input = &input[consumed..];
            self.state = State::Inflating;
            if out.len() > self.max_output_size {
                self.state = State::Error;
                return Err(ZlibError::ZlibError);
            }
            match rc {
                ReturnCode::StreamEnd => {
                    self.state = State::End;
                    // Continue only when the next byte is the gzip magic ID1
                    // (0x1f). Anything else is trailing garbage/padding and
                    // ends the stream, keeping prior tolerance for origins
                    // that append stray bytes after a valid member.
                    if self.multi_member && input.first() == Some(&0x1f) {
                        if self.reset() != ReturnCode::Ok {
                            self.state = State::Error;
                            return Err(ZlibError::ZlibError);
                        }
                        continue;
                    }
                    return Ok(());
                }
                ReturnCode::MemError => {
                    self.state = State::Error;
                    return Err(ZlibError::OutOfMemory);
                }
                ReturnCode::BufError => {
                    if input.is_empty() && self.strm.avail_in() == 0 {
                        if is_done {
                            self.state = State::Error;
                            return Err(ZlibError::ZlibError);
                        }
                        return Err(ZlibError::ShortRead);
                    }
                    self.state = State::Error;
                    return Err(ZlibError::ZlibError);
                }
                ReturnCode::Ok => {
                    // More output may be pending; loop.
                }
                ReturnCode::StreamError
                | ReturnCode::DataError
                | ReturnCode::NeedDict
                | ReturnCode::VersionError
                | ReturnCode::ErrNo => {
                    self.state = State::Error;
                    return Err(ZlibError::ZlibError);
                }
            }
        }
    }
}

impl Drop for InflateDecoder {
    fn drop(&mut self) {
        self.strm.inflate_end();
    }
}

/// Shared body of [`DeflateEncoder::step`] / [`InflateDecoder::step`].
#[inline]
fn step_into_vec(
    strm: &mut zStream_struct,
    input: &[u8],
    out: &mut Vec<u8>,
    reserve: usize,
    flush: FlushValue,
    deflate: bool,
) -> (usize, ReturnCode) {
    let in_len = input.len().min(u32::MAX as usize) as uInt;

    out.reserve(reserve);
    let spare = out.spare_capacity_mut();
    let out_len = spare.len().min(u32::MAX as usize) as uInt;

    // SAFETY: invariant (B) — `input` is readable for `in_len` bytes and
    // `spare` is writable for `out_len` bytes for the duration of this call;
    // zlib reads/writes at most that many bytes and does not retain the
    // pointers (`avail_*` reach 0 or we re-set them on the next call).
    unsafe {
        strm.set_input(input.as_ptr(), in_len);
        strm.set_output(spare.as_mut_ptr().cast::<u8>(), out_len);
    }
    let rc = if deflate {
        strm.deflate(flush)
    } else {
        strm.inflate(flush)
    };

    let produced = out_len as usize - strm.avail_out() as usize;
    // SAFETY: zlib has initialized `produced` bytes at the start of spare.
    unsafe { bun_core::vec::commit_spare(out, produced) };
    let consumed = in_len as usize - strm.avail_in() as usize;
    (consumed, rc)
}
