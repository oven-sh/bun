#![allow(unused)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
use core::ffi::{c_char, c_int, c_uint, c_ulonglong, c_void};

use bun_core::ZStr;

// ─── FFI bindings ─────────────────────────────────────────────────────────
// TODO(port): move to zstd_sys once that crate exists. PORTING.md §FFI:
// "If your file has externs and isn't already *_sys, leave them in place".
#[allow(non_camel_case_types, non_snake_case, non_upper_case_globals)]
pub mod c {
    use core::cell::UnsafeCell;
    use core::ffi::{c_char, c_int, c_uint, c_ulonglong, c_void};
    use core::marker::{PhantomData, PhantomPinned};

    /// `ZSTD_DStream` — opaque streaming-decompression context (Nomicon FFI pattern).
    ///
    /// `UnsafeCell` makes the type `!Freeze` so a `&ZSTD_DStream` does not assert
    /// immutability of the C-owned state (zstd mutates internally on every call).
    bun_opaque::opaque_ffi! {
        pub struct ZSTD_DStream;
        /// `ZSTD_CCtx` — opaque streaming-compression context.
        pub struct ZSTD_CCtx;
    }

    /// `typedef ZSTD_DCtx ZSTD_DStream;` — same opaque object.
    pub type ZSTD_DCtx = ZSTD_DStream;

    // C enums passed by value across FFI — model as `c_uint` (their declared
    // underlying type) so callers can pass raw values without transmute.
    pub type ZSTD_ErrorCode = c_uint;
    pub type ZSTD_EndDirective = c_uint;
    pub type ZSTD_ResetDirective = c_uint;
    pub type ZSTD_cParameter = c_uint;
    pub type ZSTD_dParameter = c_uint;

    // ZSTD_EndDirective
    pub const ZSTD_e_continue: ZSTD_EndDirective = 0;
    pub const ZSTD_e_flush: ZSTD_EndDirective = 1;
    pub const ZSTD_e_end: ZSTD_EndDirective = 2;

    // ZSTD_ResetDirective
    pub const ZSTD_reset_session_only: ZSTD_ResetDirective = 1;
    pub const ZSTD_reset_parameters: ZSTD_ResetDirective = 2;
    pub const ZSTD_reset_session_and_parameters: ZSTD_ResetDirective = 3;

    // ZSTD_ErrorCode (zstd_errors.h) — only the public stable subset.
    pub const ZSTD_error_no_error: ZSTD_ErrorCode = 0;
    pub const ZSTD_error_GENERIC: ZSTD_ErrorCode = 1;
    pub const ZSTD_error_prefix_unknown: ZSTD_ErrorCode = 10;
    pub const ZSTD_error_version_unsupported: ZSTD_ErrorCode = 12;
    pub const ZSTD_error_frameParameter_unsupported: ZSTD_ErrorCode = 14;
    pub const ZSTD_error_frameParameter_windowTooLarge: ZSTD_ErrorCode = 16;
    pub const ZSTD_error_corruption_detected: ZSTD_ErrorCode = 20;
    pub const ZSTD_error_checksum_wrong: ZSTD_ErrorCode = 22;
    pub const ZSTD_error_literals_headerWrong: ZSTD_ErrorCode = 24;
    pub const ZSTD_error_dictionary_corrupted: ZSTD_ErrorCode = 30;
    pub const ZSTD_error_dictionary_wrong: ZSTD_ErrorCode = 32;
    pub const ZSTD_error_dictionaryCreation_failed: ZSTD_ErrorCode = 34;
    pub const ZSTD_error_parameter_unsupported: ZSTD_ErrorCode = 40;
    pub const ZSTD_error_parameter_combination_unsupported: ZSTD_ErrorCode = 41;
    pub const ZSTD_error_parameter_outOfBound: ZSTD_ErrorCode = 42;
    pub const ZSTD_error_tableLog_tooLarge: ZSTD_ErrorCode = 44;
    pub const ZSTD_error_maxSymbolValue_tooLarge: ZSTD_ErrorCode = 46;
    pub const ZSTD_error_maxSymbolValue_tooSmall: ZSTD_ErrorCode = 48;
    pub const ZSTD_error_stabilityCondition_notRespected: ZSTD_ErrorCode = 50;
    pub const ZSTD_error_stage_wrong: ZSTD_ErrorCode = 60;
    pub const ZSTD_error_init_missing: ZSTD_ErrorCode = 62;
    pub const ZSTD_error_memory_allocation: ZSTD_ErrorCode = 64;
    pub const ZSTD_error_workSpace_tooSmall: ZSTD_ErrorCode = 66;
    pub const ZSTD_error_dstSize_tooSmall: ZSTD_ErrorCode = 70;
    pub const ZSTD_error_srcSize_wrong: ZSTD_ErrorCode = 72;
    pub const ZSTD_error_dstBuffer_null: ZSTD_ErrorCode = 74;
    pub const ZSTD_error_noForwardProgress_destFull: ZSTD_ErrorCode = 80;
    pub const ZSTD_error_noForwardProgress_inputEmpty: ZSTD_ErrorCode = 82;

    #[repr(C)]
    pub struct ZSTD_inBuffer {
        pub src: *const c_void,
        pub size: usize,
        pub pos: usize,
    }

    #[repr(C)]
    pub struct ZSTD_outBuffer {
        pub dst: *mut c_void,
        pub size: usize,
        pub pos: usize,
    }

    unsafe extern "C" {
        pub fn ZSTD_compress(
            dst: *mut c_void,
            dst_capacity: usize,
            src: *const c_void,
            src_size: usize,
            compression_level: c_int,
        ) -> usize;
        pub safe fn ZSTD_compressBound(src_size: usize) -> usize;
        pub fn ZSTD_decompress(
            dst: *mut c_void,
            dst_capacity: usize,
            src: *const c_void,
            compressed_size: usize,
        ) -> usize;
        // Pure scalar fns — no preconditions.
        pub safe fn ZSTD_isError(code: usize) -> c_uint;
        pub safe fn ZSTD_getErrorName(code: usize) -> *const c_char;
        pub safe fn ZSTD_defaultCLevel() -> c_int;

        pub safe fn ZSTD_createDStream() -> *mut ZSTD_DStream;
        pub fn ZSTD_freeDStream(zds: *mut ZSTD_DStream) -> usize;
        pub fn ZSTD_initDStream(zds: *mut ZSTD_DStream) -> usize;
        pub fn ZSTD_decompressStream(
            zds: *mut ZSTD_DStream,
            output: *mut ZSTD_outBuffer,
            input: *mut ZSTD_inBuffer,
        ) -> usize;

        // ZSTD_findDecompressedSize() :
        // `src` should point to the start of a series of ZSTD encoded and/or skippable frames
        // `srcSize` must be the _exact_ size of this series
        //      (i.e. there should be a frame boundary at `src + srcSize`)
        // @return : - decompressed size of all data in all successive frames
        //           - if the decompressed size cannot be determined: ZSTD_CONTENTSIZE_UNKNOWN
        //           - if an error occurred: ZSTD_CONTENTSIZE_ERROR
        //
        // note 1 : decompressed size is an optional field, that may not be present, especially in streaming mode.
        //          When `return==ZSTD_CONTENTSIZE_UNKNOWN`, data to decompress could be any size.
        //          In which case, it's necessary to use streaming mode to decompress data.
        // note 2 : decompressed size is always present when compression is done with ZSTD_compress()
        // note 3 : decompressed size can be very large (64-bits value),
        //          potentially larger than what local system can handle as a single memory segment.
        //          In which case, it's necessary to use streaming mode to decompress data.
        // note 4 : If source is untrusted, decompressed size could be wrong or intentionally modified.
        //          Always ensure result fits within application's authorized limits.
        //          Each application can set its own limits.
        // note 5 : ZSTD_findDecompressedSize handles multiple frames, and so it must traverse the input to
        //          read each contained frame header.  This is fast as most of the data is skipped,
        //          however it does mean that all frame data must be present and valid. */
        pub fn ZSTD_findDecompressedSize(src: *const c_void, src_size: usize) -> c_ulonglong;

        // ── streaming-compress / advanced API (used by NativeZstd) ───────
        pub safe fn ZSTD_createCCtx() -> *mut ZSTD_CCtx;
        pub fn ZSTD_freeCCtx(cctx: *mut ZSTD_CCtx) -> usize;
        pub safe fn ZSTD_createDCtx() -> *mut ZSTD_DCtx;
        pub fn ZSTD_freeDCtx(dctx: *mut ZSTD_DCtx) -> usize;
        pub fn ZSTD_CCtx_setPledgedSrcSize(
            cctx: *mut ZSTD_CCtx,
            pledged_src_size: c_ulonglong,
        ) -> usize;
        pub fn ZSTD_CCtx_setParameter(
            cctx: *mut ZSTD_CCtx,
            param: ZSTD_cParameter,
            value: c_int,
        ) -> usize;
        pub fn ZSTD_DCtx_setParameter(
            dctx: *mut ZSTD_DCtx,
            param: ZSTD_dParameter,
            value: c_int,
        ) -> usize;
        pub fn ZSTD_CCtx_reset(cctx: *mut ZSTD_CCtx, reset: ZSTD_ResetDirective) -> usize;
        pub fn ZSTD_DCtx_reset(dctx: *mut ZSTD_DCtx, reset: ZSTD_ResetDirective) -> usize;
        pub fn ZSTD_compressStream2(
            cctx: *mut ZSTD_CCtx,
            output: *mut ZSTD_outBuffer,
            input: *mut ZSTD_inBuffer,
            end_op: ZSTD_EndDirective,
        ) -> usize;
        pub safe fn ZSTD_getErrorCode(function_result: usize) -> ZSTD_ErrorCode;
        pub safe fn ZSTD_getErrorString(code: ZSTD_ErrorCode) -> *const c_char;
    }
}

// -----------------------------------

pub enum Result {
    Success(usize),
    // Zig `[:0]const u8` field, always assigned from ZSTD_getErrorName (static C string).
    Err(&'static ZStr),
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum ZstdError {
    InvalidZstdData,
    DecompressionFailed,
    ZstdFailedToCreateInstance,
    ZstdDecompressionError,
    ShortRead,
}

bun_core::impl_tag_error!(ZstdError);

bun_core::named_error_set!(ZstdError);

/// ZSTD_compress() :
///  Compresses `src` content as a single zstd compressed frame into already allocated `dst`.
///  NOTE: Providing `dstCapacity >= ZSTD_compressBound(srcSize)` guarantees that zstd will have
///        enough space to successfully compress the data.
///  @return : compressed size written into `dst` (<= `dstCapacity),
///            or an error code if it fails (which can be tested using ZSTD_isError()). */
// ZSTDLIB_API size_t ZSTD_compress( void* dst, size_t dstCapacity,
//                             const void* src, size_t srcSize,
//                                   int compressionLevel);
pub fn compress(dest: &mut [u8], src: &[u8], level: Option<i32>) -> Result {
    // SAFETY: dest/src are valid for their lengths; ZSTD_compress reads src and writes dest.
    let result = unsafe {
        c::ZSTD_compress(
            dest.as_mut_ptr().cast::<c_void>(),
            dest.len(),
            src.as_ptr().cast::<c_void>(),
            src.len(),
            // Not redundant_closure: extern "C" fn items don't implement FnOnce
            // (Fn* traits are only blanket-impl'd for the Rust ABI).
            level.unwrap_or_else(|| c::ZSTD_defaultCLevel()),
        )
    };
    if c::ZSTD_isError(result) != 0 {
        // SAFETY: ZSTD_getErrorName returns a static NUL-terminated string.
        return Result::Err(unsafe { ZStr::from_c_ptr(c::ZSTD_getErrorName(result)) });
    }
    Result::Success(result)
}

pub fn compress_bound(src_size: usize) -> usize {
    c::ZSTD_compressBound(src_size)
}

/// ZSTD_decompress() :
/// `compressedSize` : must be the _exact_ size of some number of compressed and/or skippable frames.
/// `dstCapacity` is an upper bound of originalSize to regenerate.
/// If user cannot imply a maximum upper bound, it's better to use streaming mode to decompress data.
/// @return : the number of bytes decompressed into `dst` (<= `dstCapacity`),
///           or an errorCode if it fails (which can be tested using ZSTD_isError()). */
// ZSTDLIB_API size_t ZSTD_decompress( void* dst, size_t dstCapacity,
//   const void* src, size_t compressedSize);
pub fn decompress(dest: &mut [u8], src: &[u8]) -> Result {
    // SAFETY: dest/src are valid for their lengths; ZSTD_decompress reads src and writes dest.
    let result = unsafe {
        c::ZSTD_decompress(
            dest.as_mut_ptr().cast::<c_void>(),
            dest.len(),
            src.as_ptr().cast::<c_void>(),
            src.len(),
        )
    };
    if c::ZSTD_isError(result) != 0 {
        // SAFETY: ZSTD_getErrorName returns a static NUL-terminated string.
        return Result::Err(unsafe { ZStr::from_c_ptr(c::ZSTD_getErrorName(result)) });
    }
    Result::Success(result)
}

/// Decompress data, automatically allocating the output buffer.
/// Returns owned slice that must be freed by the caller.
/// Handles both frames with known and unknown content sizes.
/// For safety, if the reported decompressed size exceeds 16MB, streaming decompression is used instead.
pub fn decompress_alloc(src: &[u8]) -> core::result::Result<Vec<u8>, ZstdError> {
    // TODO(port): narrow error set
    let size = get_decompressed_size(src);

    const ZSTD_CONTENTSIZE_UNKNOWN: usize = c_ulonglong::MAX as usize; // 0ULL - 1
    const ZSTD_CONTENTSIZE_ERROR: usize = (c_ulonglong::MAX - 1) as usize; // 0ULL - 2
    const MAX_PREALLOCATE_SIZE: usize = 16 * 1024 * 1024; // 16MB safety limit

    if size == ZSTD_CONTENTSIZE_ERROR {
        return Err(ZstdError::InvalidZstdData);
    }

    // Use streaming decompression if:
    // 1. Content size is unknown, OR
    // 2. Reported size exceeds safety limit (to prevent malicious inputs claiming huge sizes)
    if size == ZSTD_CONTENTSIZE_UNKNOWN || size > MAX_PREALLOCATE_SIZE {
        let mut list: Vec<u8> = Vec::new();
        // PORT NOTE: Zig's `errdefer list.deinit(allocator)` is implicit — `list` drops on `?`.
        let mut reader = ZstdReaderArrayList::init(src, &mut list)?;

        reader.read_all(true)?;
        drop(reader);
        return Ok(list);
        // PORT NOTE: Zig `.toOwnedSlice()` → just return the Vec; caller owns it.
    }

    // Fast path: size is known and within reasonable limits
    let mut output = vec![0u8; size];
    // PORT NOTE: `errdefer allocator.free(output)` is implicit via Vec Drop.

    match decompress(&mut output, src) {
        Result::Success(actual_size) => {
            output.truncate(actual_size);
            Ok(output)
        }
        // `output` is freed by Drop above.
        Result::Err(_) => Err(ZstdError::DecompressionFailed),
    }
}

pub fn get_decompressed_size(src: &[u8]) -> usize {
    // SAFETY: src is valid for src.len() bytes.
    unsafe { c::ZSTD_findDecompressedSize(src.as_ptr().cast::<c_void>(), src.len()) as usize }
}

pub use bun_core::compress::State;

pub struct ZstdReaderArrayList<'a> {
    pub input: &'a [u8],
    // PORT NOTE: reshaped for borrowck — Zig kept a by-value copy of the
    // ArrayListUnmanaged in `list` and wrote it back through `list_ptr` at the
    // end of `readAll`. In Rust we operate on the caller's Vec directly via
    // the `&mut` borrow; the redundant `list` cache field is dropped.
    pub list_ptr: &'a mut Vec<u8>,
    // PORT NOTE: `list_allocator` / `allocator` params deleted — global mimalloc.
    pub zstd: *mut c::ZSTD_DStream,
    pub state: State,
    pub total_out: usize,
    pub total_in: usize,
}

impl<'a> ZstdReaderArrayList<'a> {
    // PORT NOTE: `pub const new = bun.TrivialNew(...)` → Box::new; no associated const needed.

    pub fn init(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
    ) -> core::result::Result<Box<ZstdReaderArrayList<'a>>, ZstdError> {
        Self::init_with_list_allocator(input, list)
    }

    pub fn init_with_list_allocator(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        // PORT NOTE: list_allocator / allocator params deleted (global mimalloc).
    ) -> core::result::Result<Box<ZstdReaderArrayList<'a>>, ZstdError> {
        let zstd = c::ZSTD_createDStream();
        if zstd.is_null() {
            return Err(ZstdError::ZstdFailedToCreateInstance);
        }
        // SAFETY: zstd is a freshly created non-null DStream.
        let _ = unsafe { c::ZSTD_initDStream(zstd) };

        Ok(Box::new(ZstdReaderArrayList {
            input,
            list_ptr: list,
            zstd,
            state: State::Uninitialized,
            total_out: 0,
            total_in: 0,
        }))
    }

    pub fn end(&mut self) {
        if self.state != State::End {
            // SAFETY: self.zstd was created by ZSTD_createDStream and has not been freed
            // (guarded by state != End).
            let _ = unsafe { c::ZSTD_freeDStream(self.zstd) };
            self.state = State::End;
        }
    }

    pub fn read_all(&mut self, is_done: bool) -> core::result::Result<(), ZstdError> {
        // PORT NOTE: Zig's `defer this.list_ptr.* = this.list;` is unnecessary —
        // we mutate the caller's Vec through `list_ptr` directly.

        if self.state == State::End || self.state == State::Error {
            return Ok(());
        }

        while self.state == State::Uninitialized || self.state == State::Inflating {
            let next_in = &self.input[self.total_in..];

            // If we have no input to process
            if next_in.is_empty() {
                if is_done {
                    // If we're in the middle of inflating and stream is done, it's truncated
                    if self.state == State::Inflating {
                        self.state = State::Error;
                        return Err(ZstdError::ZstdDecompressionError);
                    }
                    // No more input and stream is done, we can end
                    self.end();
                }
                return Ok(());
            }

            // SAFETY: write-only spare; ZSTD_decompressStream initializes the
            // first `out_buf.pos` bytes.
            let spare = unsafe { bun_core::vec::reserve_spare_bytes(self.list_ptr, 4096) };
            let mut in_buf = c::ZSTD_inBuffer {
                src: next_in.as_ptr().cast::<c_void>(),
                size: next_in.len(),
                pos: 0,
            };
            let mut out_buf = c::ZSTD_outBuffer {
                dst: spare.as_mut_ptr().cast::<c_void>(),
                size: spare.len(),
                pos: 0,
            };

            // SAFETY: self.zstd is a valid DStream (state != End); in_buf/out_buf point
            // into live slices with correct sizes.
            let rc =
                unsafe { c::ZSTD_decompressStream(self.zstd, &raw mut out_buf, &raw mut in_buf) };
            if c::ZSTD_isError(rc) != 0 {
                self.state = State::Error;
                return Err(ZstdError::ZstdDecompressionError);
            }

            let bytes_written = out_buf.pos;
            let bytes_read = in_buf.pos;
            // SAFETY: ZSTD_decompressStream wrote exactly `bytes_written` initialized bytes
            // into the spare capacity starting at the previous len.
            unsafe { bun_core::vec::commit_spare(self.list_ptr, bytes_written) };
            self.total_in += bytes_read;
            self.total_out += bytes_written;

            if rc == 0 {
                // Frame is complete
                self.state = State::Uninitialized; // Reset state since frame is complete

                // Check if there's more input (multiple frames)
                if self.total_in >= self.input.len() {
                    // We've consumed all available input
                    if is_done {
                        // No more data coming, we can end the stream
                        self.end();
                        return Ok(());
                    }
                    // Frame is complete and no more input available right now.
                    // Just return normally - the caller can provide more data later if they have it.
                    return Ok(());
                }
                // More input available, reset for the next frame
                // ZSTD_initDStream() safely resets the stream state without needing cleanup
                // It's designed to be called multiple times on the same DStream object
                // SAFETY: self.zstd is a valid DStream.
                let _ = unsafe { c::ZSTD_initDStream(self.zstd) };
                continue;
            }

            // If rc > 0, decompressor needs more data
            if rc > 0 {
                self.state = State::Inflating;
            }

            if bytes_read == next_in.len() {
                // We've consumed all available input
                if bytes_written > 0 {
                    // We wrote some output, continue to see if we need more output space
                    continue;
                }

                if is_done {
                    // Stream is truncated - we're at EOF but need more data
                    self.state = State::Error;
                    return Err(ZstdError::ZstdDecompressionError);
                }
                // Not at EOF - we can retry with more data
                return Err(ZstdError::ShortRead);
            }
        }
        Ok(())
    }
}

impl Drop for ZstdReaderArrayList<'_> {
    fn drop(&mut self) {
        // Zig `deinit`: end() then allocator.destroy(this). Box handles the destroy.
        self.end();
    }
}

// ported from: src/zstd/zstd.zig
