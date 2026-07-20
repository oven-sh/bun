use core::ptr;

pub mod error;
pub use error::{Error, Result};

pub use bun_brotli_sys::brotli_c as c;
use c::{BrotliDecoder, BrotliEncoder};

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
    pub params: DecoderParams,
}

/// One `bool` per `BrotliDecoderParameter` variant, default `false`.
#[derive(Default)]
pub struct DecoderParams {
    pub large_window: bool,
    pub disable_ring_buffer_reallocation: bool,
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

// ──────────────────────────────────────────────────────────────────────────
// BrotliReaderArrayList
// ──────────────────────────────────────────────────────────────────────────

pub struct BrotliReaderArrayList<'a> {
    pub input: &'a [u8],
    pub list_ptr: &'a mut Vec<u8>,
    pub brotli: *mut c::BrotliDecoder,
    pub state: ReaderState,
    pub total_out: usize,
    pub total_in: usize,
    /// Decompression-bomb guard: `read_all` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub max_output_size: usize,
    pub flush_op: c::BrotliEncoderOperation,
    pub finish_flush_op: c::BrotliEncoderOperation,
    pub full_flush_op: c::BrotliEncoderOperation,
}

pub use bun_core::compress::State as ReaderState;

impl<'a> BrotliReaderArrayList<'a> {
    #[inline]
    pub fn new(value: Self) -> Box<Self> {
        Box::new(value)
    }

    /// Shared access to the owned brotli decoder instance.
    #[inline]
    fn brotli(&self) -> &c::BrotliDecoder {
        // SAFETY: `self.brotli` is set exactly once in `init_with_options`
        // from `BrotliDecoder::create_instance` (never null), is never
        // reassigned, and is freed only in `Drop`. The brotli C API does not
        // call back into Rust, so no re-entrant aliasing is possible.
        unsafe { &*self.brotli }
    }

    /// Exclusive access to the owned brotli decoder instance.
    #[inline]
    fn brotli_mut(&mut self) -> &mut c::BrotliDecoder {
        // SAFETY: see `brotli()`. `&mut self` guarantees no other Rust
        // reference to the decoder is live.
        unsafe { &mut *self.brotli }
    }

    pub fn new_with_options(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: &DecoderOptions,
    ) -> crate::Result<Box<Self>> {
        Ok(Self::new(Self::init_with_options(
            input,
            list,
            options,
            c::BrotliEncoderOperation::process,
            c::BrotliEncoderOperation::finish,
            c::BrotliEncoderOperation::flush,
        )?))
    }

    pub fn init_with_options(
        input: &'a [u8],
        list: &'a mut Vec<u8>,
        options: &DecoderOptions,
        flush_op: c::BrotliEncoderOperation,
        finish_flush_op: c::BrotliEncoderOperation,
        full_flush_op: c::BrotliEncoderOperation,
    ) -> crate::Result<Self> {
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

        debug_assert!(list.as_ptr() != input.as_ptr());

        Ok(Self {
            input,
            list_ptr: list,
            brotli,
            state: ReaderState::Uninitialized,
            total_out: 0,
            total_in: 0,
            max_output_size: usize::MAX,
            flush_op,
            finish_flush_op,
            full_flush_op,
        })
    }

    pub fn end(&mut self) {
        self.state = ReaderState::End;
    }

    pub fn read_all(&mut self, is_done: bool) -> crate::Result<()> {
        if self.state == ReaderState::End || self.state == ReaderState::Error {
            return Ok(());
        }

        debug_assert!(self.list_ptr.as_ptr() != self.input.as_ptr());

        while self.state == ReaderState::Uninitialized || self.state == ReaderState::Inflating {
            // SAFETY: write-only spare; brotli initializes the bytes it consumes.
            let spare = unsafe { bun_core::vec::reserve_spare_bytes(self.list_ptr, 4096) };
            let out_len = spare.len();
            let mut next_out_ptr: *mut u8 = spare.as_mut_ptr();
            // `spare` borrow ends here (NLL); only raw ptr/len survive across FFI.

            let next_in = &self.input[self.total_in..];
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
                &mut next_out_ptr,
                None,
            );

            let bytes_written = out_len.saturating_sub(out_remaining);
            let bytes_read = in_len.saturating_sub(in_remaining);

            // SAFETY: brotli wrote `bytes_written` initialized bytes into the
            // spare-capacity region starting at the previous `len()`.
            unsafe { bun_core::vec::commit_spare(self.list_ptr, bytes_written) };
            self.total_in += bytes_read;

            // Enforce the cap after every write so a chunk that ends the
            // stream (`success`) cannot push the output past the limit.
            if self.list_ptr.len() > self.max_output_size {
                self.state = ReaderState::Error;
                return Err(crate::Error::BrotliDecompressionError);
            }

            match result {
                c::BrotliDecoderResult::success => {
                    debug_assert!(BrotliDecoder::is_finished(self.brotli()));
                    self.end();
                    return Ok(());
                }
                c::BrotliDecoderResult::err => {
                    self.state = ReaderState::Error;
                    if cfg!(debug_assertions) {
                        let code = BrotliDecoder::get_error_code(self.brotli());
                        bun_core::debug_warn!("Brotli error: {:?} ({})", code, code as i32);
                    }

                    return Err(crate::Error::BrotliDecompressionError);
                }

                c::BrotliDecoderResult::needs_more_input => {
                    if in_remaining > 0 {
                        panic!("Brotli wants more data");
                    }
                    self.state = ReaderState::Inflating;
                    if is_done {
                        // Stream is truncated - we're at EOF but decoder needs more data
                        self.state = ReaderState::Error;
                        return Err(crate::Error::BrotliDecompressionError);
                    }
                    // Not at EOF - we can retry with more data
                    return Err(crate::Error::ShortRead);
                }
                c::BrotliDecoderResult::needs_more_output => {
                    if self.list_ptr.len() >= self.max_output_size {
                        self.state = ReaderState::Error;
                        return Err(crate::Error::BrotliDecompressionError);
                    }
                    let target = self.list_ptr.capacity() + 4096;
                    self.list_ptr
                        .reserve(target.saturating_sub(self.list_ptr.len()));
                    self.state = ReaderState::Inflating;
                }
            }
        }

        Ok(())
    }
}

impl<'a> Drop for BrotliReaderArrayList<'a> {
    fn drop(&mut self) {
        if !self.brotli.is_null() {
            // Created by BrotliDecoder::create_instance; destroyed exactly once here.
            BrotliDecoder::destroy_instance(self.brotli_mut());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StreamingDecoder
// ──────────────────────────────────────────────────────────────────────────

/// Streaming brotli decoder that owns only the C decoder state. Unlike
/// [`BrotliReaderArrayList`] it stores no `&'a [u8]` / `&'a mut Vec<u8>`
/// borrows — input and output are passed to [`decompress`](Self::decompress)
/// per call, so callers can hold the decoder across multiple body chunks
/// without lifetime erasure.
pub struct StreamingDecoder {
    brotli: ptr::NonNull<c::BrotliDecoder>,
    pub state: ReaderState,
    /// Decompression-bomb guard: `decompress` errors instead of growing the
    /// output past this many bytes. Defaults to unbounded.
    pub max_output_size: usize,
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
            out.reserve(4096);
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
                    return Err(crate::Error::BrotliDecompressionError);
                }
                c::BrotliDecoderResult::needs_more_input => {
                    self.state = ReaderState::Inflating;
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

// ──────────────────────────────────────────────────────────────────────────
// BrotliCompressionStream
// ──────────────────────────────────────────────────────────────────────────

pub struct BrotliCompressionStream {
    pub brotli: *mut c::BrotliEncoder,
    pub state: CompressionState,
    pub total_out: usize,
    pub total_in: usize,
    pub flush_op: c::BrotliEncoderOperation,
    pub finish_flush_op: c::BrotliEncoderOperation,
    pub full_flush_op: c::BrotliEncoderOperation,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CompressionState {
    Inflating,
    End,
    Error,
}

impl BrotliCompressionStream {
    pub fn init(
        flush_op: c::BrotliEncoderOperation,
        finish_flush_op: c::BrotliEncoderOperation,
        full_flush_op: c::BrotliEncoderOperation,
    ) -> crate::Result<Self> {
        // SAFETY: brotli FFI constructor; alloc/free are valid extern "C"
        // fns and opaque is null (unused by our allocator).
        let instance = unsafe {
            BrotliEncoder::create_instance(
                Some(BrotliAllocator::alloc),
                Some(BrotliAllocator::free),
                ptr::null_mut(),
            )
        }
        .ok_or(crate::Error::BrotliFailedToCreateInstance)?;

        Ok(Self {
            brotli: instance,
            state: CompressionState::Inflating,
            total_out: 0,
            total_in: 0,
            flush_op,
            finish_flush_op,
            full_flush_op,
        })
    }

    /// Exclusive access to the owned brotli encoder instance.
    #[inline]
    fn brotli_mut(&mut self) -> &mut c::BrotliEncoder {
        // SAFETY: `self.brotli` is set exactly once in `init` from
        // `BrotliEncoder::create_instance` (never null), is never reassigned,
        // and is freed only in `Drop`. The brotli C API does not call back
        // into Rust, so no re-entrant aliasing is possible. `&mut self`
        // guarantees no other Rust reference to the encoder is live.
        unsafe { &mut *self.brotli }
    }

    // The returned slice borrows brotli's internal buffer, valid until the
    // next compress_stream/destroy call. Tying it to `&mut self` prevents
    // overlapping calls that would invalidate it.
    pub fn write_chunk(&mut self, input: &[u8], last: bool) -> crate::Result<&[u8]> {
        self.total_in += input.len();
        let op = if last {
            self.finish_flush_op
        } else {
            self.flush_op
        };
        // NOTE: cannot use `self.brotli_mut()` here — `result.output` borrows
        // the encoder for the return lifetime, and the error branch must write
        // `self.state` while that borrow is conditionally live (NLL problem
        // case #3). Deref the raw field directly so the encoder borrow stays
        // disjoint from `self.state`.
        // SAFETY: see `brotli_mut()` invariant.
        let result = BrotliEncoder::compress_stream(unsafe { &mut *self.brotli }, op, input);

        if !result.success {
            self.state = CompressionState::Error;
            return Err(crate::Error::BrotliCompressionError);
        }

        Ok(result.output)
    }

    pub fn write(&mut self, input: &[u8], last: bool) -> crate::Result<&[u8]> {
        if self.state == CompressionState::End || self.state == CompressionState::Error {
            return Ok(b"");
        }

        self.write_chunk(input, last)
    }

    pub fn end(&mut self) -> crate::Result<&[u8]> {
        // `state` ends up `End` on both ok and error paths; set it before
        // calling `compress_stream` because its output borrows
        // `&mut *self.brotli`.
        if matches!(self.state, CompressionState::End | CompressionState::Error) {
            self.state = CompressionState::End;
            return Ok(b"");
        }
        self.state = CompressionState::End;

        let op = self.finish_flush_op;
        let result = BrotliEncoder::compress_stream(self.brotli_mut(), op, b"");

        if !result.success {
            return Err(crate::Error::BrotliCompressionError);
        }

        Ok(result.output)
    }

    pub fn writer_context<W: bun_io::Write>(&mut self, writable: W) -> BrotliWriter<'_, W> {
        BrotliWriter::init(self, writable)
    }

    // The returned `BrotliWriter` implements `bun_io::Write` itself, so this
    // is just an alias for `writer_context()`.
    pub fn writer<W: bun_io::Write>(&mut self, writable: W) -> BrotliWriter<'_, W> {
        self.writer_context(writable)
    }
}

impl Drop for BrotliCompressionStream {
    fn drop(&mut self) {
        if !self.brotli.is_null() {
            // Created by BrotliEncoder::create_instance; destroyed exactly once here.
            BrotliEncoder::destroy_instance(self.brotli_mut());
        }
    }
}

pub struct BrotliWriter<'a, W> {
    pub compressor: &'a mut BrotliCompressionStream,
    pub input_writer: W,
}

impl<'a, W: bun_io::Write> BrotliWriter<'a, W> {
    pub fn init(compressor: &'a mut BrotliCompressionStream, input_writer: W) -> Self {
        Self {
            compressor,
            input_writer,
        }
    }

    pub fn write(&mut self, to_compress: &[u8]) -> crate::Result<usize> {
        let decompressed = self.compressor.write(to_compress, false)?;
        self.input_writer.write_all(decompressed)?;
        Ok(to_compress.len())
    }

    pub fn end(&mut self) -> crate::Result<()> {
        let decompressed = self.compressor.end()?;
        self.input_writer.write_all(decompressed)?;
        Ok(())
    }
}

impl<W: bun_io::Write> bun_io::Write for BrotliWriter<'_, W> {
    fn write_all(&mut self, buf: &[u8]) -> bun_io::Result<()> {
        self.write(buf)
            .map(|_| ())
            .map_err(|_| bun_core::Error::WriteFailed)
    }

    fn flush(&mut self) -> bun_io::Result<()> {
        // Drain the encoder first so compressed-so-far bytes reach the sink:
        // an empty write runs `compress_stream` with the stream's configured
        // `flush_op` (emits pending output for FLUSH-configured streams; a
        // no-op for PROCESS). `end()` is still required to finalize.
        let out = self
            .compressor
            .write(b"", false)
            .map_err(|_| bun_core::Error::WriteFailed)?;
        self.input_writer.write_all(out)?;
        self.input_writer.flush()
    }
}
