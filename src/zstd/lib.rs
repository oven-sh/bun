#![feature(core_io_borrowed_buf)]
#![warn(unused_must_use)]
use core::ffi::{CStr, c_int, c_ulonglong, c_void};
use core::ptr::NonNull;

use bun_core::ZStr;
use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};

// ─── FFI bindings ─────────────────────────────────────────────────────────
// Externs stay in this crate per PORTING.md §FFI: "If your file has externs
// and isn't already *_sys, leave them in place".
#[allow(non_camel_case_types, non_upper_case_globals)]
pub mod c {
    use core::ffi::{c_char, c_int, c_uint, c_ulonglong, c_void};

    // `ZSTD_DStream` — opaque streaming-decompression context (Nomicon FFI pattern).
    //
    // `UnsafeCell` makes the type `!Freeze` so a `&ZSTD_DStream` does not assert
    // immutability of the C-owned state (zstd mutates internally on every call).
    bun_opaque::opaque_ffi! {
        pub(crate) struct ZSTD_DStream;
        /// `ZSTD_CCtx` — opaque streaming-compression context.
        pub(crate) struct ZSTD_CCtx;
    }

    /// `typedef ZSTD_DCtx ZSTD_DStream;` — same opaque object.
    pub(crate) type ZSTD_DCtx = ZSTD_DStream;

    // C enums passed by value across FFI — model as `c_uint` (their declared
    // underlying type) so callers can pass raw values without transmute.
    pub(crate) type ZSTD_ErrorCode = c_uint;
    pub(crate) type ZSTD_EndDirective = c_uint;
    pub(crate) type ZSTD_ResetDirective = c_uint;
    pub(crate) type ZSTD_cParameter = c_uint;
    pub(crate) type ZSTD_dParameter = c_uint;

    // ZSTD_EndDirective
    pub const ZSTD_e_continue: ZSTD_EndDirective = 0;

    // ZSTD_cParameter
    pub const ZSTD_c_compressionLevel: ZSTD_cParameter = 100;
    pub(crate) const ZSTD_c_stableInBuffer: ZSTD_cParameter = 1006;

    // ZSTD_dParameter
    pub(crate) const ZSTD_d_stableOutBuffer: ZSTD_dParameter = 1001;

    pub(crate) const ZSTD_reset_session_and_parameters: ZSTD_ResetDirective = 3;

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
    pub(crate) struct ZSTD_inBuffer {
        pub src: *const c_void,
        pub size: usize,
        pub pos: usize,
    }

    #[repr(C)]
    pub(crate) struct ZSTD_outBuffer {
        pub dst: *mut c_void,
        pub size: usize,
        pub pos: usize,
    }

    unsafe extern "C" {
        pub(crate) fn ZSTD_compress(
            dst: *mut c_void,
            dst_capacity: usize,
            src: *const c_void,
            src_size: usize,
            compression_level: c_int,
        ) -> usize;
        pub(crate) safe fn ZSTD_compressBound(src_size: usize) -> usize;
        pub(crate) fn ZSTD_decompress(
            dst: *mut c_void,
            dst_capacity: usize,
            src: *const c_void,
            compressed_size: usize,
        ) -> usize;
        // Pure scalar fns — no preconditions.
        pub(crate) safe fn ZSTD_isError(code: usize) -> c_uint;
        pub(crate) safe fn ZSTD_defaultCLevel() -> c_int;

        pub(crate) fn ZSTD_decompressStream(
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
        pub(crate) fn ZSTD_findDecompressedSize(src: *const c_void, src_size: usize)
        -> c_ulonglong;

        // ── streaming-compress / advanced API ────────────────────────────
        pub(crate) safe fn ZSTD_createCCtx() -> *mut ZSTD_CCtx;
        pub(crate) fn ZSTD_freeCCtx(cctx: *mut ZSTD_CCtx) -> usize;
        pub(crate) safe fn ZSTD_createDCtx() -> *mut ZSTD_DCtx;
        pub(crate) fn ZSTD_freeDCtx(dctx: *mut ZSTD_DCtx) -> usize;
        pub(crate) fn ZSTD_CCtx_setPledgedSrcSize(
            cctx: *mut ZSTD_CCtx,
            pledged_src_size: c_ulonglong,
        ) -> usize;
        /// Copies the dictionary into the context, so `dict` need not outlive
        /// the call (unlike the `_byReference` variant).
        pub(crate) fn ZSTD_CCtx_loadDictionary(
            cctx: *mut ZSTD_CCtx,
            dict: *const c_void,
            dict_size: usize,
        ) -> usize;
        /// Copies the dictionary into the context; see `ZSTD_CCtx_loadDictionary`.
        pub(crate) fn ZSTD_DCtx_loadDictionary(
            dctx: *mut ZSTD_DCtx,
            dict: *const c_void,
            dict_size: usize,
        ) -> usize;
        /// References `prefix` as the raw content dictionary of the next frame only. It is not
        /// copied, so it has to outlive the decompression of that frame.
        pub(crate) fn ZSTD_DCtx_refPrefix(
            dctx: *mut ZSTD_DCtx,
            prefix: *const c_void,
            prefix_size: usize,
        ) -> usize;
        pub(crate) fn ZSTD_decompressDCtx(
            dctx: *mut ZSTD_DCtx,
            dst: *mut c_void,
            dst_capacity: usize,
            src: *const c_void,
            src_size: usize,
        ) -> usize;
        pub(crate) fn ZSTD_CCtx_setParameter(
            cctx: *mut ZSTD_CCtx,
            param: ZSTD_cParameter,
            value: c_int,
        ) -> usize;
        pub(crate) fn ZSTD_DCtx_setParameter(
            dctx: *mut ZSTD_DCtx,
            param: ZSTD_dParameter,
            value: c_int,
        ) -> usize;
        pub(crate) fn ZSTD_DCtx_reset(dctx: *mut ZSTD_DCtx, reset: ZSTD_ResetDirective) -> usize;
        pub(crate) fn ZSTD_compressStream2(
            cctx: *mut ZSTD_CCtx,
            output: *mut ZSTD_outBuffer,
            input: *mut ZSTD_inBuffer,
            end_op: ZSTD_EndDirective,
        ) -> usize;
        pub(crate) safe fn ZSTD_getErrorCode(function_result: usize) -> ZSTD_ErrorCode;
        pub(crate) safe fn ZSTD_getErrorString(code: ZSTD_ErrorCode) -> *const c_char;
    }
}

// -----------------------------------

/// Why a call on a context failed: one of `c::ZSTD_error_*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorCode(pub c::ZSTD_ErrorCode);

impl ErrorCode {
    fn check(rc: usize) -> core::result::Result<usize, ErrorCode> {
        if is_error(rc) {
            return Err(ErrorCode(c::ZSTD_getErrorCode(rc)));
        }
        Ok(rc)
    }

    pub fn is_alloc_failure(self) -> bool {
        self.0 == c::ZSTD_error_memory_allocation
    }

    pub fn message(self) -> &'static CStr {
        // SAFETY: zstd returns a string literal for every value.
        unsafe { bun_core::ffi::cstr(c::ZSTD_getErrorString(self.0)) }
    }
}

/// The input bytes a step consumed, and zstd's hint of what is left: 0 once a frame or a flush is complete.
type StepResult = (usize, core::result::Result<usize, ErrorCode>);

fn with_buffers(
    input: &[u8],
    mut out: BorrowedCursor<'_, u8>,
    call: impl FnOnce(*mut c::ZSTD_outBuffer, *mut c::ZSTD_inBuffer) -> usize,
) -> StepResult {
    let mut in_buf = c::ZSTD_inBuffer {
        src: input.as_ptr().cast::<c_void>(),
        size: input.len(),
        pos: 0,
    };
    // SAFETY: only zstd raises `out_buf.pos`, by as many bytes as it wrote at the start of `out`.
    unsafe {
        let mut out_buf = c::ZSTD_outBuffer {
            size: out.capacity(),
            dst: out.as_mut().as_mut_ptr().cast::<c_void>(),
            pos: 0,
        };
        let rc = call(&raw mut out_buf, &raw mut in_buf);
        out.advance(out_buf.pos);
        (in_buf.pos, ErrorCode::check(rc))
    }
}

/// Runs `call(dst, dst_capacity)`, which returns an error code or how many bytes zstd wrote.
fn fill(
    mut out: BorrowedCursor<'_, u8>,
    call: impl FnOnce(*mut c_void, usize) -> usize,
) -> core::result::Result<usize, ErrorCode> {
    let capacity = out.capacity();
    // SAFETY: zstd only writes initialized bytes, on success `written` of them at the start of `out`.
    unsafe {
        let written = ErrorCode::check(call(out.as_mut().as_mut_ptr().cast::<c_void>(), capacity))?;
        out.advance(written);
        Ok(written)
    }
}

pub struct OwnedCCtx {
    ptr: NonNull<c::ZSTD_CCtx>,
    /// A failed step leaves the context undefined: it can still point at that step's input.
    error: Option<ErrorCode>,
}

// SAFETY: heap state that only `self` reaches, and the workers it starts and joins itself.
unsafe impl Send for OwnedCCtx {}

impl OwnedCCtx {
    pub fn new() -> Option<Self> {
        NonNull::new(c::ZSTD_createCCtx()).map(|ptr| Self { ptr, error: None })
    }

    fn try_as_ptr(&self) -> core::result::Result<*mut c::ZSTD_CCtx, ErrorCode> {
        match self.error {
            Some(err) => Err(err),
            None => Ok(self.ptr.as_ptr()),
        }
    }

    pub fn load_dictionary(&mut self, dictionary: &[u8]) -> core::result::Result<(), ErrorCode> {
        let cctx = self.try_as_ptr()?;
        // SAFETY: `cctx` is live and has not failed; zstd copies `dictionary`.
        ErrorCode::check(unsafe {
            c::ZSTD_CCtx_loadDictionary(cctx, dictionary.as_ptr().cast(), dictionary.len())
        })
        .map(drop)
    }

    pub fn set_pledged_src_size(&mut self, size: u64) -> core::result::Result<(), ErrorCode> {
        let cctx = self.try_as_ptr()?;
        // SAFETY: `cctx` is live and has not failed.
        ErrorCode::check(unsafe { c::ZSTD_CCtx_setPledgedSrcSize(cctx, size) }).map(drop)
    }

    pub fn set_parameter(
        &mut self,
        param: c::ZSTD_cParameter,
        value: c_int,
    ) -> core::result::Result<(), ErrorCode> {
        if param == c::ZSTD_c_stableInBuffer && value != 0 {
            return Err(ErrorCode(c::ZSTD_error_parameter_unsupported));
        }
        let cctx = self.try_as_ptr()?;
        // SAFETY: `cctx` is live and has not failed. zstd checks both values, and no other
        // parameter makes it read a step's buffers after the step.
        ErrorCode::check(unsafe { c::ZSTD_CCtx_setParameter(cctx, param, value) }).map(drop)
    }

    /// One `ZSTD_compressStream2()` call. After an error, every call returns that error.
    pub fn step(
        &mut self,
        input: &[u8],
        out: BorrowedCursor<'_, u8>,
        end_op: c::ZSTD_EndDirective,
    ) -> StepResult {
        let cctx = match self.try_as_ptr() {
            Ok(cctx) => cctx,
            Err(err) => return (0, Err(err)),
        };
        // SAFETY: `cctx` is live and has not failed, `with_buffers` passes valid pointers, and zstd checks `end_op`.
        let (consumed, result) = with_buffers(input, out, |out, input| unsafe {
            c::ZSTD_compressStream2(cctx, out, input, end_op)
        });
        self.error = result.err();
        (consumed, result)
    }
}

impl Drop for OwnedCCtx {
    fn drop(&mut self) {
        // SAFETY: created in `new`, freed once.
        unsafe { c::ZSTD_freeCCtx(self.ptr.as_ptr()) };
    }
}

pub struct OwnedDCtx {
    ptr: NonNull<c::ZSTD_DCtx>,
    /// A failed step leaves the context undefined until it is reset.
    error: Option<ErrorCode>,
}

// SAFETY: heap state that only `self` reaches.
unsafe impl Send for OwnedDCtx {}

impl OwnedDCtx {
    pub fn new() -> Option<Self> {
        NonNull::new(c::ZSTD_createDCtx()).map(|ptr| Self { ptr, error: None })
    }

    fn try_as_ptr(&self) -> core::result::Result<*mut c::ZSTD_DCtx, ErrorCode> {
        match self.error {
            Some(err) => Err(err),
            None => Ok(self.ptr.as_ptr()),
        }
    }

    pub fn load_dictionary(&mut self, dictionary: &[u8]) -> core::result::Result<(), ErrorCode> {
        let dctx = self.try_as_ptr()?;
        // SAFETY: `dctx` is live and has not failed; zstd copies `dictionary`.
        ErrorCode::check(unsafe {
            c::ZSTD_DCtx_loadDictionary(dctx, dictionary.as_ptr().cast(), dictionary.len())
        })
        .map(drop)
    }

    pub fn set_parameter(
        &mut self,
        param: c::ZSTD_dParameter,
        value: c_int,
    ) -> core::result::Result<(), ErrorCode> {
        if param == c::ZSTD_d_stableOutBuffer && value != 0 {
            return Err(ErrorCode(c::ZSTD_error_parameter_unsupported));
        }
        let dctx = self.try_as_ptr()?;
        // SAFETY: `dctx` is live and has not failed. zstd checks both values, and no other
        // parameter makes it read a step's buffers after the step.
        ErrorCode::check(unsafe { c::ZSTD_DCtx_setParameter(dctx, param, value) }).map(drop)
    }

    /// Forgets the frame in progress, the dictionary and the parameters.
    pub fn reset(&mut self) {
        // SAFETY: created in `new`; a reset is defined in every state.
        unsafe { c::ZSTD_DCtx_reset(self.ptr.as_ptr(), c::ZSTD_reset_session_and_parameters) };
        self.error = None;
    }

    /// One `ZSTD_decompressStream()` call. After an error, every call returns that error until [`reset`](Self::reset).
    pub fn step(&mut self, input: &[u8], out: BorrowedCursor<'_, u8>) -> StepResult {
        let dctx = match self.try_as_ptr() {
            Ok(dctx) => dctx,
            Err(err) => return (0, Err(err)),
        };
        // SAFETY: `dctx` is live and has not failed, and `with_buffers` passes valid pointers.
        let (consumed, result) = with_buffers(input, out, |out, input| unsafe {
            c::ZSTD_decompressStream(dctx, out, input)
        });
        self.error = result.err();
        (consumed, result)
    }
}

impl Drop for OwnedDCtx {
    fn drop(&mut self) {
        // SAFETY: created in `new`, freed once.
        unsafe { c::ZSTD_freeDCtx(self.ptr.as_ptr()) };
    }
}

pub enum Result {
    Success(usize),
    Err(&'static ZStr),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum ZstdError {
    /// The output, or the decoder state the frame's window size dictates, could not be allocated.
    OutOfMemory,
    InvalidZstdData,
    DecompressionFailed,
    ZstdFailedToCreateInstance,
    ZstdDecompressionError,
    ShortRead,
}

bun_core::impl_tag_error!(ZstdError);

impl ZstdError {
    /// The error for a failed decompression call; `other` is the non-allocation failure.
    fn for_decompression(code: ErrorCode, other: ZstdError) -> ZstdError {
        if code.is_alloc_failure() {
            ZstdError::OutOfMemory
        } else {
            other
        }
    }
}

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
    compress_into(BorrowedBuf::from(dest).unfilled(), src, level)
}

fn compress_into(dest: BorrowedCursor<'_, u8>, src: &[u8], level: Option<i32>) -> Result {
    // SAFETY: dst/src are valid for their lengths; ZSTD_compress reads src and writes dst.
    let result = fill(dest, |dst, dst_capacity| unsafe {
        c::ZSTD_compress(
            dst,
            dst_capacity,
            src.as_ptr().cast::<c_void>(),
            src.len(),
            level.unwrap_or_else(c::ZSTD_defaultCLevel),
        )
    });
    match result {
        Ok(written) => Result::Success(written),
        Err(code) => Result::Err(ZStr::from_cstr(code.message())),
    }
}

pub fn compress_bound(src_size: usize) -> usize {
    c::ZSTD_compressBound(src_size)
}

/// [`compress`] into `out`'s spare capacity (append mode). On success
/// `out.len()` is advanced by the compressed size. Callers must ensure
/// `out.spare_capacity_mut().len() >= compress_bound(src.len())` to
/// guarantee success.
pub fn compress_append(out: &mut Vec<u8>, src: &[u8], level: Option<i32>) -> Result {
    append_with(out, usize::MAX, |dest| compress_into(dest, src, level))
}

/// `ZSTD_isError` — true when a `size_t` return value (including from
/// [`compress_bound`], see zstd.h: "ZSTD_compressBound() itself can fail, if
/// `srcSize >= ZSTD_MAX_INPUT_SIZE`") is an error code rather than a size.
/// Error codes are near `usize::MAX`, so treating one as a size requests an
/// absurd allocation.
pub fn is_error(code: usize) -> bool {
    c::ZSTD_isError(code) != 0
}

/// `ZSTD_decompress` into `out`'s spare capacity, which is the output bound; commits the bytes written.
fn decompress_append(out: &mut Vec<u8>, src: &[u8]) -> core::result::Result<(), ZstdError> {
    append_with(out, usize::MAX, |out| {
        // SAFETY: dst/src are valid for their lengths; ZSTD_decompress reads src and writes dst.
        fill(out, |dst, dst_capacity| unsafe {
            c::ZSTD_decompress(dst, dst_capacity, src.as_ptr().cast::<c_void>(), src.len())
        })
    })
    .map(drop)
    .map_err(|code| ZstdError::for_decompression(code, ZstdError::DecompressionFailed))
}

/// Decompress data, automatically allocating the output buffer.
/// Returns owned slice that must be freed by the caller.
/// Handles both frames with known and unknown content sizes.
/// For safety, if the reported decompressed size exceeds 16MB, streaming decompression is used instead.
/// Output allocations fail with [`ZstdError::OutOfMemory`] instead of aborting.
pub fn decompress_alloc(src: &[u8]) -> core::result::Result<Vec<u8>, ZstdError> {
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
        let initial_capacity = if size == ZSTD_CONTENTSIZE_UNKNOWN {
            // A frame's output is rarely smaller than its input.
            src.len().clamp(STREAMING_OUTPUT_STEP, MAX_PREALLOCATE_SIZE)
        } else {
            // The header size is untrusted: reserve no more than the fast path below would.
            MAX_PREALLOCATE_SIZE
        };
        let mut list: Vec<u8> = Vec::new();
        list.try_reserve_exact(initial_capacity)
            .map_err(|_| ZstdError::OutOfMemory)?;
        StreamingDecoder::new()?.decompress(src, &mut list, usize::MAX, true)?;
        return Ok(list);
    }

    // Fast path: size is known and within reasonable limits
    let mut output: Vec<u8> = Vec::new();
    output
        .try_reserve_exact(size)
        .map_err(|_| ZstdError::OutOfMemory)?;

    decompress_append(&mut output, src)?;
    Ok(output)
}

/// Decompresses one frame that was compressed with `prefix` as its raw content dictionary, which is
/// referenced and not copied. The size has to be in the header of the frame, and at most 16 MB.
pub fn decompress_alloc_with_prefix(
    src: &[u8],
    prefix: &[u8],
) -> core::result::Result<Vec<u8>, ZstdError> {
    const MAX_SIZE: usize = 16 * 1024 * 1024;
    let size = get_decompressed_size(src);
    // Also if it is unknown or invalid, which are the two largest values.
    if size > MAX_SIZE {
        return Err(ZstdError::InvalidZstdData);
    }
    let mut output: Vec<u8> = Vec::new();
    output
        .try_reserve_exact(size)
        .map_err(|_| ZstdError::OutOfMemory)?;
    let dctx = OwnedDCtx::new().ok_or(ZstdError::OutOfMemory)?;
    append_with(&mut output, usize::MAX, |out| {
        // SAFETY: `prefix`, `src` and `dst` are valid for their lengths, and `dctx` is not used after this.
        fill(out, |dst, dst_capacity| unsafe {
            let rc = c::ZSTD_DCtx_refPrefix(
                dctx.ptr.as_ptr(),
                prefix.as_ptr().cast::<c_void>(),
                prefix.len(),
            );
            if is_error(rc) {
                return rc;
            }
            c::ZSTD_decompressDCtx(
                dctx.ptr.as_ptr(),
                dst,
                dst_capacity,
                src.as_ptr().cast::<c_void>(),
                src.len(),
            )
        })
    })
    .map_err(|code| ZstdError::for_decompression(code, ZstdError::DecompressionFailed))?;
    Ok(output)
}

pub fn get_decompressed_size(src: &[u8]) -> usize {
    // SAFETY: src is valid for src.len() bytes.
    unsafe { c::ZSTD_findDecompressedSize(src.as_ptr().cast::<c_void>(), src.len()) as usize }
}

pub use bun_core::compress::State;

/// Minimum spare output capacity offered to `ZSTD_decompressStream` per call.
const STREAMING_OUTPUT_STEP: usize = 4096;

// ──────────────────────────────────────────────────────────────────────────
// StreamingDecoder
// ──────────────────────────────────────────────────────────────────────────

/// Streaming zstd decoder that owns only the `ZSTD_DStream`, and no `&'a [u8]` / `&'a mut Vec<u8>`
/// borrows — input and output are passed to [`decompress`](Self::decompress)
/// per call, so callers can hold the decoder across multiple body chunks
/// without lifetime erasure.
pub struct StreamingDecoder {
    stream: OwnedDCtx,
    pub(crate) state: State,
    /// Decompression-bomb guard: `decompress` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub(crate) max_output_size: usize,
    /// zstd filled its last window and may hold more. `max_output` can end a call there.
    output_full: bool,
}

impl StreamingDecoder {
    pub fn new() -> core::result::Result<Self, ZstdError> {
        Ok(Self {
            stream: OwnedDCtx::new().ok_or(ZstdError::ZstdFailedToCreateInstance)?,
            state: State::Uninitialized,
            max_output_size: usize::MAX,
            output_full: false,
        })
    }

    #[inline]
    pub fn is_inflating(&self) -> bool {
        matches!(self.state, State::Inflating)
    }

    /// Append decompressed bytes to `out` (growing in 4096-byte steps) until `input` is
    /// consumed or `out.len()` reaches `max_output`. Returns the input bytes consumed.
    /// Returns `ShortRead` when more input is required and `is_done` is false.
    pub fn decompress(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        max_output: usize,
        is_done: bool,
    ) -> core::result::Result<usize, ZstdError> {
        if matches!(self.state, State::End | State::Error) {
            return Ok(input.len());
        }

        let mut total_in = 0usize;
        while matches!(self.state, State::Uninitialized | State::Inflating) {
            let next_in = &input[total_in..];

            // Call zstd again with no input until it leaves the window short.
            if next_in.is_empty() && !self.output_full {
                if is_done {
                    if self.state == State::Inflating {
                        self.state = State::Error;
                        return Err(ZstdError::ZstdDecompressionError);
                    }
                    self.state = State::End;
                }
                return Ok(total_in);
            }

            if out.len() >= max_output {
                return Ok(total_in);
            }

            let remaining_output = self.max_output_size.saturating_sub(out.len());
            if remaining_output == 0 {
                self.state = State::Error;
                return Err(ZstdError::ZstdDecompressionError);
            }

            if out.try_reserve(STREAMING_OUTPUT_STEP).is_err() {
                self.state = State::Error;
                return Err(ZstdError::OutOfMemory);
            }
            let budget = remaining_output.min(max_output - out.len());
            let (bytes_read, rc) = append_with(out, budget, |mut out| {
                let step = self.stream.step(next_in, out.reborrow());
                self.output_full = out.capacity() == 0;
                step
            });
            let rc = rc.map_err(|code| {
                self.state = State::Error;
                ZstdError::for_decompression(code, ZstdError::ZstdDecompressionError)
            })?;
            total_in += bytes_read;

            if rc == 0 {
                // Frame complete, and fully flushed.
                self.state = State::Uninitialized;
                self.output_full = false;
                if total_in >= input.len() {
                    if is_done {
                        self.state = State::End;
                    }
                    return Ok(total_in);
                }
                // More input available — reinitialize for the next frame.
                self.stream.reset();
                continue;
            }

            self.state = State::Inflating;

            if bytes_read == next_in.len() {
                if self.output_full {
                    continue;
                }
                if is_done {
                    self.state = State::Error;
                    return Err(ZstdError::ZstdDecompressionError);
                }
                return Err(ZstdError::ShortRead);
            }
        }
        Ok(total_in)
    }
}

// ── compressed embedded assets ────────────────────────────────────────────

/// Embed an asset zstd-compressed and inflate it on first use. Only for bytes
/// Bun never executes or parses itself: the shell completion scripts and the
/// JS/CSS bundles that are shipped to a browser (dev-server client runtime,
/// error overlay/page). Anything that runs inside Bun stays uncompressed.
///
/// The exception is text that only `bun lint`, `bun fmt` and `bun check`
/// read. It may be compressed because it isn't on the path of running a program.
///
/// Release (`bun_codegen_embed`) builds include the `.zst` twin that
/// `scripts/build/codegen.ts` (`emitCompressedEmbeds`) writes to
/// `<codegen>/compressed/<name>.zst`; other builds evaluate `$fallback`.
#[macro_export]
macro_rules! embed_compressed {
    // A codegen output (`<codegen>/$sub`); debug builds read it at runtime.
    (codegen $sub:literal) => {
        $crate::embed_compressed!(
            ("codegen/", $sub),
            ::bun_core::runtime_embed_file!(Codegen, $sub).as_bytes()
        )
    };
    // Same, with a trailing NUL included in the slice (for C-string consumers).
    (codegen_nul $sub:literal) => {{
        #[allow(unexpected_cfgs)]
        let __bytes: &'static [u8] = {
            #[cfg(bun_codegen_embed)]
            {
                static __INFLATED: ::bun_core::Once<::std::boxed::Box<[u8]>> = ::bun_core::Once::new();
                __INFLATED
                    .get_or_init(|| {
                        $crate::inflate_embedded_nul(::core::include_bytes!(::core::concat!(
                            ::core::env!("BUN_CODEGEN_DIR"),
                            "/compressed/codegen/",
                            $sub,
                            ".zst"
                        )))
                    })
            }
            #[cfg(not(bun_codegen_embed))]
            {
                static __COPY: ::std::sync::OnceLock<::std::boxed::Box<[u8]>> = ::std::sync::OnceLock::new();
                &__COPY.get_or_init(|| {
                    let text = ::bun_core::runtime_embed_file!(Codegen, $sub).as_bytes();
                    let mut copy = ::std::vec::Vec::with_capacity(text.len() + 1);
                    copy.extend_from_slice(text);
                    copy.push(0);
                    copy.into_boxed_slice()
                })[..]
            }
        };
        __bytes
    }};
    // A file under `src/`; debug builds read it from the source tree at runtime.
    (src $sub:literal) => {
        $crate::embed_compressed!(("src/", $sub), ::bun_core::runtime_embed_file!(Src, $sub).as_bytes())
    };
    ($name:literal, $fallback:expr) => {
        $crate::embed_compressed!(($name), $fallback)
    };
    (($($name:literal),+), $fallback:expr) => {{
        #[allow(unexpected_cfgs)]
        let __bytes: &'static [u8] = {
            #[cfg(bun_codegen_embed)]
            {
                static __INFLATED: ::bun_core::Once<::std::boxed::Box<[u8]>> = ::bun_core::Once::new();
                __INFLATED
                    .get_or_init(|| {
                        $crate::inflate_embedded(::core::include_bytes!(::core::concat!(
                            ::core::env!("BUN_CODEGEN_DIR"),
                            "/compressed/",
                            $($name,)+
                            ".zst"
                        )))
                    })
            }
            #[cfg(not(bun_codegen_embed))]
            {
                $fallback
            }
        };
        __bytes
    }};
}

/// Cold, shared body of [`embed_compressed!`]'s release arm.
#[cold]
#[inline(never)]
pub fn inflate_embedded(compressed: &'static [u8]) -> Box<[u8]> {
    decompress_alloc(compressed)
        .expect("embedded asset: invalid zstd frame")
        .into_boxed_slice()
}

/// [`inflate_embedded`] plus a trailing NUL byte.
#[cold]
#[inline(never)]
pub fn inflate_embedded_nul(compressed: &'static [u8]) -> Box<[u8]> {
    let mut inflated = decompress_alloc(compressed).expect("embedded asset: invalid zstd frame");
    inflated.reserve_exact(1);
    inflated.push(0);
    inflated.into_boxed_slice()
}
