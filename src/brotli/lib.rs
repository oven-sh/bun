#![feature(core_io_borrowed_buf)]
use core::ffi::c_uint;
use core::ptr::{self, NonNull};

use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};

pub mod error;
pub use error::{Error, InitError, Result};

pub mod c {
    pub(crate) use bun_brotli_sys::brotli_c::*;
    pub use bun_brotli_sys::brotli_c::{
        BROTLI_DEFAULT_WINDOW, BROTLI_MAX_QUALITY, BROTLI_MIN_QUALITY, BROTLI_PARAM_QUALITY,
        BrotliDecoderErrorCode2, BrotliDecoderResult, BrotliEncoderMode, BrotliEncoderOperation,
    };
}
use c::{BrotliDecoder, BrotliEncoder};

// ──────────────────────────────────────────────────────────────────────────
// BrotliAllocator
// ──────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case)]
mod BrotliAllocator {
    bun_alloc::c_thunks_for_zone!(c"brotli");
    pub(crate) use malloc_size as alloc;
}

/// What a decoder or an encoder allocates with.
#[derive(Clone, Copy)]
pub enum Allocator {
    Bun,
    Libc,
}

impl Allocator {
    fn hooks(self) -> (c::brotli_alloc_func, c::brotli_free_func) {
        match self {
            Self::Bun => (Some(BrotliAllocator::alloc), Some(BrotliAllocator::free)),
            Self::Libc => (None, None),
        }
    }
}

/// Brotli does not check the size of a raw dictionary, and adds copy lengths to it in an `int`.
const MAX_DICTIONARY_LEN: usize = 1 << 30;

/// Runs `call(available_in, next_in, available_out, next_out)` and returns how much input it consumed.
fn with_buffers<R>(
    input: &[u8],
    mut out: BorrowedCursor<'_, u8>,
    call: impl FnOnce(*mut usize, *mut *const u8, *mut usize, *mut *mut u8) -> R,
) -> (usize, R) {
    let capacity = out.capacity();
    let (mut available_in, mut next_in) = (input.len(), input.as_ptr());
    let mut available_out = capacity;
    // SAFETY: only brotli lowers `available_out`, by as many bytes as it wrote at the start of `out`.
    unsafe {
        let mut next_out = out.as_mut().as_mut_ptr().cast::<u8>();
        let result = call(
            &raw mut available_in,
            &raw mut next_in,
            &raw mut available_out,
            &raw mut next_out,
        );
        out.advance(capacity - available_out);
        (input.len() - available_in, result)
    }
}

pub struct OwnedDecoder {
    state: NonNull<BrotliDecoder>,
    /// `state` points into it.
    dictionary: Vec<u8>,
}

// SAFETY: heap state that only `self` reaches; both allocators free on any thread.
unsafe impl Send for OwnedDecoder {}

impl OwnedDecoder {
    pub fn new(allocator: Allocator) -> Option<Self> {
        let (alloc, free) = allocator.hooks();
        // SAFETY: the hooks match and ignore `opaque`.
        let state = unsafe { c::BrotliDecoderCreateInstance(alloc, free, ptr::null_mut()) };
        Some(Self {
            state: NonNull::new(state)?,
            dictionary: Vec::new(),
        })
    }

    /// Attaches a copy of `dictionary` as a raw dictionary, unless it is empty.
    pub fn with_dictionary(allocator: Allocator, dictionary: &[u8]) -> Result<Self, InitError> {
        let mut this = Self::new(allocator).ok_or(InitError::CreateInstance)?;
        if dictionary.is_empty() {
            return Ok(this);
        }
        if dictionary.len() > MAX_DICTIONARY_LEN {
            return Err(InitError::AttachDictionary);
        }
        this.dictionary = dictionary.to_vec();
        // SAFETY: created in `new`; the bytes drop after `state` is destroyed.
        let ok = unsafe {
            c::BrotliDecoderAttachDictionary(
                this.state.as_ptr(),
                c::BROTLI_SHARED_DICTIONARY_RAW as c::BrotliSharedDictionaryType,
                this.dictionary.len(),
                this.dictionary.as_ptr(),
            )
        };
        if ok == 0 {
            return Err(InitError::AttachDictionary);
        }
        Ok(this)
    }

    pub fn set_parameter(&mut self, param: c_uint, value: u32) -> bool {
        // SAFETY: created in `new`; brotli takes any values.
        unsafe { c::BrotliDecoderSetParameter(self.state.as_ptr(), param, value) != 0 }
    }

    /// One `BrotliDecoderDecompressStream()` call. Returns how much input it consumed.
    pub fn step(
        &mut self,
        input: &[u8],
        out: BorrowedCursor<'_, u8>,
    ) -> (usize, c::BrotliDecoderResult) {
        // SAFETY: created in `new`; `with_buffers` passes valid pointers.
        with_buffers(
            input,
            out,
            |avail_in, next_in, avail_out, next_out| unsafe {
                c::BrotliDecoderDecompressStream(
                    self.state.as_ptr(),
                    avail_in,
                    next_in,
                    avail_out,
                    next_out,
                    ptr::null_mut(),
                )
            },
        )
    }

    /// True when decoded bytes are still held in the decoder's ring buffer.
    pub fn has_more_output(&self) -> bool {
        // SAFETY: created in `new`.
        unsafe { c::BrotliDecoderHasMoreOutput(self.state.as_ptr()) != 0 }
    }

    pub fn error_code(&self) -> c::BrotliDecoderErrorCode2 {
        // SAFETY: created in `new`.
        unsafe { c::BrotliDecoderGetErrorCode(self.state.as_ptr()) }
    }
}

impl Drop for OwnedDecoder {
    fn drop(&mut self) {
        // SAFETY: created in `new`, destroyed once.
        unsafe { c::BrotliDecoderDestroyInstance(self.state.as_ptr()) }
    }
}

pub struct OwnedEncoder {
    state: NonNull<BrotliEncoder>,
    /// `state` points into it.
    dictionary: Option<PreparedDictionary>,
}

// SAFETY: as for `OwnedDecoder`.
unsafe impl Send for OwnedEncoder {}

impl OwnedEncoder {
    pub fn new(allocator: Allocator) -> Option<Self> {
        let (alloc, free) = allocator.hooks();
        // SAFETY: the hooks match and ignore `opaque`.
        let state = unsafe { c::BrotliEncoderCreateInstance(alloc, free, ptr::null_mut()) };
        Some(Self {
            state: NonNull::new(state)?,
            dictionary: None,
        })
    }

    /// Attaches a copy of `dictionary` as a raw dictionary, unless it is empty.
    pub fn with_dictionary(allocator: Allocator, dictionary: &[u8]) -> Result<Self, InitError> {
        let mut this = Self::new(allocator).ok_or(InitError::CreateInstance)?;
        if dictionary.is_empty() {
            return Ok(this);
        }
        let prepared = PreparedDictionary::new(dictionary).ok_or(InitError::PrepareDictionary)?;
        // SAFETY: created in `new`; the dictionary drops after `state` is destroyed.
        let ok = unsafe {
            c::BrotliEncoderAttachPreparedDictionary(
                this.state.as_ptr(),
                this.dictionary.insert(prepared).prepared.as_ptr(),
            )
        };
        if ok == 0 {
            return Err(InitError::AttachDictionary);
        }
        Ok(this)
    }

    pub fn set_parameter(&mut self, param: c_uint, value: u32) -> bool {
        // SAFETY: created in `new`; brotli refuses, clamps or ignores what is out of range.
        unsafe { c::BrotliEncoderSetParameter(self.state.as_ptr(), param, value) != 0 }
    }

    /// One `BrotliEncoderCompressStream()` call. Returns how much input it consumed, and whether it succeeded.
    pub fn step(
        &mut self,
        input: &[u8],
        out: BorrowedCursor<'_, u8>,
        op: c::BrotliEncoderOperation,
    ) -> (usize, bool) {
        // SAFETY: created in `new`; `with_buffers` passes valid pointers.
        with_buffers(
            input,
            out,
            |avail_in, next_in, avail_out, next_out| unsafe {
                c::BrotliEncoderCompressStream(
                    self.state.as_ptr(),
                    op,
                    avail_in,
                    next_in,
                    avail_out,
                    next_out,
                    ptr::null_mut(),
                ) != 0
            },
        )
    }
}

impl Drop for OwnedEncoder {
    fn drop(&mut self) {
        // SAFETY: created in `new`, destroyed once.
        unsafe { c::BrotliEncoderDestroyInstance(self.state.as_ptr()) }
    }
}

/// A raw dictionary prepared for an encoder, and the bytes it points into.
struct PreparedDictionary {
    prepared: NonNull<c::BrotliEncoderPreparedDictionary>,
    _bytes: Vec<u8>,
}

impl PreparedDictionary {
    fn new(dictionary: &[u8]) -> Option<Self> {
        if dictionary.len() > MAX_DICTIONARY_LEN {
            return None;
        }
        let bytes = dictionary.to_vec();
        let (alloc, free) = Allocator::Bun.hooks();
        // SAFETY: `bytes` drops after `prepared` is destroyed; the hooks match and ignore `opaque`.
        let prepared = unsafe {
            c::BrotliEncoderPrepareDictionary(
                c::BROTLI_SHARED_DICTIONARY_RAW as c::BrotliSharedDictionaryType,
                bytes.len(),
                bytes.as_ptr(),
                c::BROTLI_MAX_QUALITY,
                alloc,
                free,
                ptr::null_mut(),
            )
        };
        Some(Self {
            prepared: NonNull::new(prepared)?,
            _bytes: bytes,
        })
    }
}

impl Drop for PreparedDictionary {
    fn drop(&mut self) {
        // SAFETY: created in `new`, destroyed once.
        unsafe { c::BrotliEncoderDestroyPreparedDictionary(self.prepared.as_ptr()) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DecoderOptions
// ──────────────────────────────────────────────────────────────────────────

pub struct DecoderOptions {
    pub(crate) params: DecoderParams,
}

/// One `bool` per `BrotliDecoderParameter` variant, default `false`.
#[derive(Default)]
struct DecoderParams {
    pub(crate) large_window: bool,
    pub(crate) disable_ring_buffer_reallocation: bool,
}

impl Default for DecoderOptions {
    fn default() -> Self {
        Self {
            params: DecoderParams {
                large_window: true,
                disable_ring_buffer_reallocation: false,
            },
        }
    }
}

use bun_core::compress::State as ReaderState;

// ──────────────────────────────────────────────────────────────────────────
// StreamingDecoder
// ──────────────────────────────────────────────────────────────────────────

/// Streaming brotli decoder that owns only the C decoder state. It stores
/// no `&'a [u8]` / `&'a mut Vec<u8>` borrows — input and output are passed to
/// [`decompress`](Self::decompress) per call, so callers can hold the decoder across multiple body chunks
/// without lifetime erasure.
pub struct StreamingDecoder {
    brotli: OwnedDecoder,
    pub(crate) state: ReaderState,
    /// Decompression-bomb guard: `decompress` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub(crate) max_output_size: usize,
}

impl StreamingDecoder {
    pub fn new(options: &DecoderOptions) -> crate::Result<Self> {
        let mut brotli =
            OwnedDecoder::new(Allocator::Bun).ok_or(crate::Error::BrotliFailedToCreateInstance)?;

        if options.params.large_window {
            brotli.set_parameter(c::BrotliDecoderParameter::LARGE_WINDOW as c_uint, 1);
        }
        if options.params.disable_ring_buffer_reallocation {
            brotli.set_parameter(
                c::BrotliDecoderParameter::DISABLE_RING_BUFFER_REALLOCATION as c_uint,
                1,
            );
        }

        Ok(Self {
            brotli,
            state: ReaderState::Uninitialized,
            max_output_size: usize::MAX,
        })
    }

    #[inline]
    pub fn is_inflating(&self) -> bool {
        matches!(self.state, ReaderState::Inflating)
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
    ) -> crate::Result<usize> {
        if matches!(self.state, ReaderState::End | ReaderState::Error) {
            return Ok(input.len());
        }
        debug_assert!(out.as_ptr() != input.as_ptr());

        let mut total_in = 0usize;
        while matches!(
            self.state,
            ReaderState::Uninitialized | ReaderState::Inflating
        ) {
            if out.len() >= max_output {
                return Ok(total_in);
            }
            if out.try_reserve(4096).is_err() {
                self.state = ReaderState::Error;
                return Err(crate::Error::OutOfMemory);
            }
            let len_before = out.len();
            let (bytes_read, result) = append_with(out, max_output - len_before, |out| {
                self.brotli.step(&input[total_in..], out)
            });
            total_in += bytes_read;

            if out.len() > self.max_output_size {
                self.state = ReaderState::Error;
                return Err(crate::Error::BrotliDecompressionError);
            }

            match result {
                c::BrotliDecoderResult::success => {
                    self.state = ReaderState::End;
                    return Ok(input.len());
                }
                c::BrotliDecoderResult::err => {
                    self.state = ReaderState::Error;
                    return Err(if self.brotli.error_code().is_alloc_failure() {
                        crate::Error::OutOfMemory
                    } else {
                        crate::Error::BrotliDecompressionError
                    });
                }
                c::BrotliDecoderResult::needs_more_input => {
                    self.state = ReaderState::Inflating;
                    // Brotli reports `needs_more_input` even with output left in its ring buffer.
                    if out.len() > len_before && self.brotli.has_more_output() {
                        continue;
                    }
                    if is_done {
                        self.state = ReaderState::Error;
                        return Err(crate::Error::BrotliDecompressionError);
                    }
                    return Err(crate::Error::ShortRead);
                }
                c::BrotliDecoderResult::needs_more_output => {
                    if out.len() >= self.max_output_size {
                        self.state = ReaderState::Error;
                        return Err(crate::Error::BrotliDecompressionError);
                    }
                    self.state = ReaderState::Inflating;
                }
            }
        }
        Ok(total_in)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// One-shot encode
// ──────────────────────────────────────────────────────────────────────────

/// Safe one-shot `BrotliEncoderCompress`. Writes compressed bytes into
/// `output[..]` and returns the number of bytes written, or `None` if the
/// output buffer was too small or encoding failed.
pub fn encode(
    quality: core::ffi::c_int,
    lgwin: core::ffi::c_int,
    mode: c::BrotliEncoderMode,
    input: &[u8],
    output: &mut [u8],
) -> Option<usize> {
    let mut output = BorrowedBuf::from(output);
    encode_into(quality, lgwin, mode, input, output.unfilled())
}

/// [`encode`] into `out`'s spare capacity (callers reserve the bound first), advancing `out.len()`.
pub fn encode_append(
    quality: core::ffi::c_int,
    lgwin: core::ffi::c_int,
    mode: c::BrotliEncoderMode,
    input: &[u8],
    out: &mut Vec<u8>,
) -> Option<usize> {
    append_with(out, usize::MAX, |output| {
        encode_into(quality, lgwin, mode, input, output)
    })
}

fn encode_into(
    quality: core::ffi::c_int,
    lgwin: core::ffi::c_int,
    mode: c::BrotliEncoderMode,
    input: &[u8],
    mut output: BorrowedCursor<'_, u8>,
) -> Option<usize> {
    let mut out_len = output.capacity();
    // SAFETY: input/output are valid for their lengths; BrotliEncoderCompress
    // only reads `input` and writes up to `out_len` bytes into `output`,
    // updating `out_len` to the number written.
    unsafe {
        let ok = c::BrotliEncoderCompress(
            quality,
            lgwin,
            mode,
            input.len(),
            input.as_ptr(),
            &raw mut out_len,
            output.as_mut().as_mut_ptr().cast::<u8>(),
        );
        if ok == 0 {
            return None;
        }
        output.advance(out_len);
    }
    Some(out_len)
}

/// `BrotliEncoderMaxCompressedSize()`: `None` if the bound overflows.
pub fn encode_bound(input_len: usize) -> Option<usize> {
    match c::BrotliEncoderMaxCompressedSize(input_len) {
        0 => None,
        bound => Some(bound),
    }
}
