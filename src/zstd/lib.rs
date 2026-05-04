use core::ffi::{c_int, c_ulonglong, c_void};

use bun_str::ZStr;

// `bun.c.ZSTD_*` → raw FFI bindings live in the area's *_sys crate.
// LIFETIMES.tsv prescribes `zstd_sys::` as the path.
use zstd_sys as c;

// -----------------------------------

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
            level.unwrap_or_else(|| {
                // SAFETY: pure FFI fn, no preconditions.
                unsafe { c::ZSTD_defaultCLevel() }
            }),
        )
    };
    // SAFETY: pure FFI fn, no preconditions.
    if unsafe { c::ZSTD_isError(result) } != 0 {
        // SAFETY: ZSTD_getErrorName returns a static NUL-terminated string.
        return Result::Err(unsafe { ZStr::from_ptr(c::ZSTD_getErrorName(result)) });
    }
    Result::Success(result)
}

pub fn compress_bound(src_size: usize) -> usize {
    // SAFETY: pure function on a size value.
    unsafe { c::ZSTD_compressBound(src_size) }
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
    // SAFETY: pure FFI fn, no preconditions.
    if unsafe { c::ZSTD_isError(result) } != 0 {
        // SAFETY: ZSTD_getErrorName returns a static NUL-terminated string.
        return Result::Err(unsafe { ZStr::from_ptr(c::ZSTD_getErrorName(result)) });
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
    unsafe { ZSTD_findDecompressedSize(src.as_ptr().cast::<c_void>(), src.len()) as usize }
}

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
// TODO(port): move to zstd_sys
unsafe extern "C" {
    pub fn ZSTD_findDecompressedSize(src: *const c_void, src_size: usize) -> c_ulonglong;
}

pub enum Result {
    Success(usize),
    // Zig `[:0]const u8` field, always assigned from ZSTD_getErrorName (static C string).
    Err(&'static ZStr),
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ZstdError {
    #[error("InvalidZstdData")]
    InvalidZstdData,
    #[error("DecompressionFailed")]
    DecompressionFailed,
    #[error("ZstdFailedToCreateInstance")]
    ZstdFailedToCreateInstance,
    #[error("ZstdDecompressionError")]
    ZstdDecompressionError,
    #[error("ShortRead")]
    ShortRead,
}

impl From<ZstdError> for bun_core::Error {
    fn from(e: ZstdError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

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

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum State {
    Uninitialized,
    Inflating,
    End,
    Error,
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
        // SAFETY: ZSTD_createDStream has no preconditions; returns null on failure.
        let zstd = unsafe { c::ZSTD_createDStream() };
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

            // PORT NOTE: reshaped for borrowck — capture spare-capacity ptr/len, then
            // drop the borrow before calling set_len below.
            let mut unused_len = self.list_ptr.spare_capacity_mut().len();
            if unused_len < 4096 {
                self.list_ptr.reserve(4096);
                unused_len = self.list_ptr.spare_capacity_mut().len();
            }
            let unused_ptr = self.list_ptr.spare_capacity_mut().as_mut_ptr().cast::<u8>();

            let mut in_buf = c::ZSTD_inBuffer {
                src: if !next_in.is_empty() {
                    next_in.as_ptr().cast::<c_void>()
                } else {
                    core::ptr::null()
                },
                size: next_in.len(),
                pos: 0,
            };
            let mut out_buf = c::ZSTD_outBuffer {
                dst: if unused_len > 0 {
                    unused_ptr.cast::<c_void>()
                } else {
                    core::ptr::null_mut()
                },
                size: unused_len,
                pos: 0,
            };

            // SAFETY: self.zstd is a valid DStream (state != End); in_buf/out_buf point
            // into live slices with correct sizes.
            let rc = unsafe { c::ZSTD_decompressStream(self.zstd, &mut out_buf, &mut in_buf) };
            // SAFETY: pure FFI fn, no preconditions.
            if unsafe { c::ZSTD_isError(rc) } != 0 {
                self.state = State::Error;
                return Err(ZstdError::ZstdDecompressionError);
            }

            let bytes_written = out_buf.pos;
            let bytes_read = in_buf.pos;
            // SAFETY: ZSTD_decompressStream wrote exactly `bytes_written` initialized bytes
            // into the spare capacity starting at the previous len.
            unsafe {
                let new_len = self.list_ptr.len() + bytes_written;
                self.list_ptr.set_len(new_len);
            }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/zstd/zstd.zig (275 lines)
//   confidence: medium
//   todos:      2
//   notes:      list/list_ptr cache collapsed to single &mut Vec<u8>; zstd_sys crate assumed for FFI bindings
// ──────────────────────────────────────────────────────────────────────────
