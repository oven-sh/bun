use core::ptr;

use bun_core::ffi::FfiSlice;

pub mod error;
pub use error::{Error, Result};

pub use bun_brotli_sys::brotli_c as c;
use c::BrotliDecoder;

// ──────────────────────────────────────────────────────────────────────────
// BrotliAllocator
// ──────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case)]
pub mod BrotliAllocator {
    bun_alloc::c_thunks_for_zone!("brotli");
    pub use malloc_size as alloc;
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
    brotli: ptr::NonNull<c::BrotliDecoder>,
    pub(crate) state: ReaderState,
    /// Decompression-bomb guard: `decompress` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub(crate) max_output_size: usize,
}

impl StreamingDecoder {
    pub fn new(options: &DecoderOptions) -> crate::Result<Self> {
        if !BrotliDecoder::initialize_brotli() {
            return Err(crate::Error::BrotliFailedToLoad);
        }
        // SAFETY: brotli FFI constructor; alloc/free are valid extern "C"
        // fns and opaque is null (unused by our allocator).
        let brotli = unsafe {
            BrotliDecoder::create_instance(
                Some(BrotliAllocator::alloc),
                Some(BrotliAllocator::free),
                ptr::null_mut(),
            )
        }
        .ok_or(crate::Error::BrotliFailedToCreateInstance)?;

        if options.params.large_window {
            let _ =
                BrotliDecoder::set_parameter(brotli, c::BrotliDecoderParameter::LARGE_WINDOW, 1);
        }
        if options.params.disable_ring_buffer_reallocation {
            let _ = BrotliDecoder::set_parameter(
                brotli,
                c::BrotliDecoderParameter::DISABLE_RING_BUFFER_REALLOCATION,
                1,
            );
        }

        Ok(Self {
            brotli: ptr::NonNull::from(brotli),
            state: ReaderState::Uninitialized,
            max_output_size: usize::MAX,
        })
    }

    #[inline]
    fn brotli_mut(&mut self) -> &mut c::BrotliDecoder {
        // SAFETY: non-null, exclusively owned, freed only in Drop.
        unsafe { self.brotli.as_mut() }
    }

    /// Consume all of `input`, appending decompressed bytes to `out`
    /// (growing in 4096-byte steps). Returns `ShortRead` when more input is
    /// required and `is_done` is false.
    pub fn decompress(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        is_done: bool,
    ) -> crate::Result<()> {
        if matches!(self.state, ReaderState::End | ReaderState::Error) {
            return Ok(());
        }
        debug_assert!(out.as_ptr() != input.as_ptr());

        let mut total_in = 0usize;
        while matches!(
            self.state,
            ReaderState::Uninitialized | ReaderState::Inflating
        ) {
            if out.try_reserve(4096).is_err() {
                self.state = ReaderState::Error;
                return Err(crate::Error::OutOfMemory);
            }
            let spare = out.spare_capacity_mut();
            let out_len = spare.len();
            let mut next_out: *mut u8 = spare.as_mut_ptr().cast::<u8>();

            let next_in = &input[total_in..];
            let in_len = next_in.len();
            let mut in_remaining = in_len;
            let mut out_remaining = out_len;
            let mut next_in_ptr: *const u8 = next_in.as_ptr();

            // https://github.com/google/brotli/blob/fef82ea10435abb1500b615b1b2c6175d429ec6c/go/cbrotli/reader.go#L15-L27
            let result = BrotliDecoder::decompress_stream(
                self.brotli_mut(),
                &mut in_remaining,
                &mut next_in_ptr,
                &mut out_remaining,
                &mut next_out,
                None,
            );

            let bytes_written = out_len.saturating_sub(out_remaining);
            let bytes_read = in_len.saturating_sub(in_remaining);
            // SAFETY: brotli wrote `bytes_written` initialized bytes into the
            // spare-capacity region starting at the previous `len()`.
            unsafe { bun_core::vec::commit_spare(out, bytes_written) };
            total_in += bytes_read;

            if out.len() > self.max_output_size {
                self.state = ReaderState::Error;
                return Err(crate::Error::BrotliDecompressionError);
            }

            match result {
                c::BrotliDecoderResult::success => {
                    self.state = ReaderState::End;
                    return Ok(());
                }
                c::BrotliDecoderResult::err => {
                    self.state = ReaderState::Error;
                    return Err(
                        if c::BrotliDecoderGetErrorCode(self.brotli_mut()).is_alloc_failure() {
                            crate::Error::OutOfMemory
                        } else {
                            crate::Error::BrotliDecompressionError
                        },
                    );
                }
                c::BrotliDecoderResult::needs_more_input => {
                    self.state = ReaderState::Inflating;
                    // Brotli reports `needs_more_input` even with output left in its ring buffer.
                    if bytes_written > 0 && BrotliDecoder::has_more_output(self.brotli_mut()) {
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
        Ok(())
    }
}

impl Drop for StreamingDecoder {
    fn drop(&mut self) {
        BrotliDecoder::destroy_instance(self.brotli_mut());
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
    let mut out_len = output.len();
    // SAFETY: input/output slices are valid for their lengths;
    // BrotliEncoderCompress only reads `input` and writes up to `out_len`
    // bytes into `output`, updating `out_len` to bytes written.
    let ok = unsafe {
        c::BrotliEncoderCompress(
            quality,
            lgwin,
            mode,
            input.len(),
            input.as_ptr(),
            &raw mut out_len,
            output.as_mut_ptr(),
        )
    };
    (ok != 0).then_some(out_len)
}

/// [`encode`] into `out`'s spare capacity (callers reserve the bound first), advancing `out.len()`.
pub fn encode_append(
    quality: core::ffi::c_int,
    lgwin: core::ffi::c_int,
    mode: c::BrotliEncoderMode,
    input: &[u8],
    out: &mut Vec<u8>,
) -> Option<usize> {
    let spare = out.spare_capacity_mut();
    let mut out_len = spare.len();
    // SAFETY: input/spare are valid for their lengths; BrotliEncoderCompress
    // only reads `input` and writes at most `out_len` bytes into spare,
    // updating `out_len` to the number written.
    let ok = unsafe {
        c::BrotliEncoderCompress(
            quality,
            lgwin,
            mode,
            input.len(),
            input.as_ptr(),
            &raw mut out_len,
            spare.as_mut_ptr().cast::<u8>(),
        )
    };
    if ok == 0 {
        return None;
    }
    // SAFETY: brotli initialized the first `out_len` bytes of spare.
    unsafe { bun_core::vec::commit_spare(out, out_len) };
    Some(out_len)
}

// ──────────────────────────────────────────────────────────────────────────
// Owned streaming encoder / decoder — one codec call per `step`, output
// into a `Vec`'s spare capacity with a caller-chosen limit.
// ──────────────────────────────────────────────────────────────────────────

/// What one [`EncoderStream::step`] / [`DecoderStream::step`] call did.
#[derive(Clone, Copy, Debug)]
pub struct Step<R> {
    /// Bytes of `input` the codec consumed.
    pub consumed: usize,
    /// Bytes appended to `out`.
    pub written: usize,
    /// Bytes of the offered output window left unused (`available_out` after the call).
    pub avail_out: usize,
    pub result: R,
}

/// One brotli call over `input` into `out[len..]`, offering at most `out_limit` bytes.
#[inline]
fn stream_step<R>(
    input: FfiSlice<'_>,
    out: &mut Vec<u8>,
    out_limit: usize,
    call: impl FnOnce(&mut usize, &mut *const u8, &mut usize, &mut *mut u8) -> R,
) -> Step<R> {
    let spare = out.spare_capacity_mut();
    let offered = spare.len().min(out_limit);
    let mut next_out: *mut u8 = spare.as_mut_ptr().cast::<u8>();
    let mut avail_out = offered;
    let mut next_in: *const u8 = input.as_ptr();
    let mut avail_in = input.len();
    let result = call(&mut avail_in, &mut next_in, &mut avail_out, &mut next_out);
    let written = offered - avail_out;
    // SAFETY: brotli wrote `written <= offered <= spare.len()` initialized
    // bytes at the start of the spare capacity.
    unsafe { bun_core::vec::commit_spare(out, written) };
    Step {
        consumed: input.len() - avail_in,
        written,
        avail_out,
        result,
    }
}

/// An owned `BrotliEncoderState` with default parameters; destroyed on drop.
pub struct EncoderStream(ptr::NonNull<c::BrotliEncoder>);

// SAFETY: the encoder state is private heap memory with no thread affinity;
// it is only reached through `&mut self`.
unsafe impl Send for EncoderStream {}

impl EncoderStream {
    pub fn new() -> Option<Self> {
        // SAFETY: allocator hooks are valid `extern "C"` fns; `opaque` is unused by them.
        ptr::NonNull::new(unsafe {
            c::BrotliEncoderCreateInstance(
                Some(BrotliAllocator::alloc),
                Some(BrotliAllocator::free),
                ptr::null_mut(),
            )
        })
        .map(Self)
    }

    /// One `BrotliEncoderCompressStream(op)` call. `result` is `false` if the
    /// encoder reported an error.
    pub fn step(
        &mut self,
        op: c::BrotliEncoderOperation,
        input: FfiSlice<'_>,
        out: &mut Vec<u8>,
        out_limit: usize,
    ) -> Step<bool> {
        stream_step(
            input,
            out,
            out_limit,
            |avail_in, next_in, avail_out, next_out| {
                // SAFETY: live encoder; the four in/out params describe `input` and
                // the spare window for this one call.
                unsafe {
                    c::BrotliEncoderCompressStream(
                        self.0.as_ptr(),
                        op,
                        avail_in,
                        next_in,
                        avail_out,
                        next_out,
                        ptr::null_mut(),
                    ) != 0
                }
            },
        )
    }
}

impl Drop for EncoderStream {
    fn drop(&mut self) {
        // SAFETY: created by `BrotliEncoderCreateInstance`, destroyed exactly once.
        unsafe { c::BrotliEncoderDestroyInstance(self.0.as_ptr()) }
    }
}

/// An owned `BrotliDecoderState` with default parameters; destroyed on drop.
pub struct DecoderStream(ptr::NonNull<c::BrotliDecoder>);

// SAFETY: as for `EncoderStream`.
unsafe impl Send for DecoderStream {}

impl DecoderStream {
    pub fn new() -> Option<Self> {
        // SAFETY: allocator hooks are valid `extern "C"` fns; `opaque` is unused by them.
        ptr::NonNull::new(unsafe {
            c::BrotliDecoderCreateInstance(
                Some(BrotliAllocator::alloc),
                Some(BrotliAllocator::free),
                ptr::null_mut(),
            )
        })
        .map(Self)
    }

    /// One `BrotliDecoderDecompressStream` call.
    pub fn step(
        &mut self,
        input: FfiSlice<'_>,
        out: &mut Vec<u8>,
        out_limit: usize,
    ) -> Step<c::BrotliDecoderResult> {
        stream_step(
            input,
            out,
            out_limit,
            |avail_in, next_in, avail_out, next_out| {
                // SAFETY: live decoder; the four in/out params describe `input` and
                // the spare window for this one call.
                unsafe {
                    c::BrotliDecoderDecompressStream(
                        self.0.as_ptr(),
                        avail_in,
                        next_in,
                        avail_out,
                        next_out,
                        ptr::null_mut(),
                    )
                }
            },
        )
    }

    pub fn error_code(&self) -> c::BrotliDecoderErrorCode2 {
        // SAFETY: live decoder.
        c::BrotliDecoderGetErrorCode(unsafe { self.0.as_ref() })
    }
}

impl Drop for DecoderStream {
    fn drop(&mut self) {
        // SAFETY: created by `BrotliDecoderCreateInstance`, destroyed exactly once.
        unsafe { c::BrotliDecoderDestroyInstance(self.0.as_ptr()) }
    }
}

/// `BrotliDecoderErrorString`: the `_ERROR_...` name of `code`.
pub fn decoder_error_string(code: c::BrotliDecoderErrorCode2) -> &'static core::ffi::CStr {
    // SAFETY: brotli returns a pointer to a static NUL-terminated string for every code.
    unsafe { core::ffi::CStr::from_ptr(c::BrotliDecoderErrorString(code)) }
}
