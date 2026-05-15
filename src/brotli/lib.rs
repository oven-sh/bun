#![warn(unreachable_pub)]
use core::ptr;

pub use bun_brotli_sys::brotli_c as c;
use c::{BrotliDecoder, BrotliEncoder};

#[allow(unused_imports)]
use bun_core::{self as bun, Error, err};

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

/// Zig: `std.enums.EnumFieldStruct(c.BrotliDecoderParameter, bool, false)` —
/// one `bool` per `BrotliDecoderParameter` variant, default `false`.
// TODO(port): if BrotliDecoderParameter grows more variants, mirror them here.
pub struct DecoderParams {
    pub large_window: bool,
    pub disable_ring_buffer_reallocation: bool,
}

impl Default for DecoderParams {
    fn default() -> Self {
        Self {
            large_window: false,
            disable_ring_buffer_reallocation: false,
        }
    }
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
    // PORT NOTE: reshaped for borrowck — Zig kept a by-value copy of the
    // ArrayListUnmanaged in `list` and wrote it back to `*list_ptr` on every
    // `readAll` (defer). `Vec<u8>` is not `Copy`, so we operate on `list_ptr`
    // directly and drop the redundant `list` + `list_allocator` fields.
    pub list_ptr: &'a mut Vec<u8>,
    pub brotli: *mut c::BrotliDecoder,
    pub state: ReaderState,
    pub total_out: usize,
    pub total_in: usize,
    pub flush_op: c::BrotliEncoderOperation,
    pub finish_flush_op: c::BrotliEncoderOperation,
    pub full_flush_op: c::BrotliEncoderOperation,
}

pub use bun_core::compress::State as ReaderState;

impl<'a> BrotliReaderArrayList<'a> {
    // Zig: `pub const new = bun.TrivialNew(BrotliReaderArrayList);`
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
        options: DecoderOptions,
    ) -> Result<Box<Self>, Error> {
        // TODO(port): narrow error set
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
        options: DecoderOptions,
        flush_op: c::BrotliEncoderOperation,
        finish_flush_op: c::BrotliEncoderOperation,
        full_flush_op: c::BrotliEncoderOperation,
    ) -> Result<Self, Error> {
        // TODO(port): narrow error set
        if !BrotliDecoder::initialize_brotli() {
            return Err(err!("BrotliFailedToLoad"));
        }

        // SAFETY: brotli FFI constructor; alloc/free are valid extern "C"
        // fns and opaque is null (unused by our allocator).
        let brotli = BrotliDecoder::create_instance(
            Some(BrotliAllocator::alloc),
            Some(BrotliAllocator::free),
            ptr::null_mut(),
        )
        .ok_or(err!("BrotliFailedToCreateInstance"))?;

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
            flush_op,
            finish_flush_op,
            full_flush_op,
        })
    }

    pub fn end(&mut self) {
        self.state = ReaderState::End;
    }

    pub fn read_all(&mut self, is_done: bool) -> Result<(), Error> {
        // TODO(port): narrow error set
        // PORT NOTE: Zig's `defer this.list_ptr.* = this.list;` is gone — we
        // mutate through `list_ptr` directly (see field note above).

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
                        bun_core::Output::debug_warn(&format_args!(
                            "Brotli error: {:?} ({})",
                            code, code as i32
                        ));
                    }

                    return Err(err!("BrotliDecompressionError"));
                }

                c::BrotliDecoderResult::needs_more_input => {
                    if in_remaining > 0 {
                        panic!("Brotli wants more data");
                    }
                    self.state = ReaderState::Inflating;
                    if is_done {
                        // Stream is truncated - we're at EOF but decoder needs more data
                        self.state = ReaderState::Error;
                        return Err(err!("BrotliDecompressionError"));
                    }
                    // Not at EOF - we can retry with more data
                    return Err(err!("ShortRead"));
                }
                c::BrotliDecoderResult::needs_more_output => {
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
        // PORT NOTE: Zig's `bun.destroy(this)` is implicit — callers hold a
        // `Box<Self>` and dropping it frees the allocation.
    }
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
    ) -> Result<Self, Error> {
        // TODO(port): narrow error set
        let instance = BrotliEncoder::create_instance(
            Some(BrotliAllocator::alloc),
            Some(BrotliAllocator::free),
            ptr::null_mut(),
        )
        .ok_or(err!("BrotliFailedToCreateInstance"))?;

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
    pub fn write_chunk(&mut self, input: &[u8], last: bool) -> Result<&[u8], Error> {
        // TODO(port): narrow error set
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
            return Err(err!("BrotliCompressionError"));
        }

        Ok(result.output)
    }

    pub fn write(&mut self, input: &[u8], last: bool) -> Result<&[u8], Error> {
        // TODO(port): narrow error set
        if self.state == CompressionState::End || self.state == CompressionState::Error {
            return Ok(b"");
        }

        self.write_chunk(input, last)
    }

    pub fn end(&mut self) -> Result<&[u8], Error> {
        // TODO(port): narrow error set
        // Zig: `defer this.state = .End` — runs on BOTH ok and error paths.
        // PORT NOTE: reshaped for borrowck — `compress_stream`'s output borrows
        // `&mut *self.brotli`, so we set `self.state` first and inline
        // write/write_chunk("", true). Net state matches Zig (defer overrides
        // any intermediate `Error` back to `End`).
        if matches!(self.state, CompressionState::End | CompressionState::Error) {
            self.state = CompressionState::End;
            return Ok(b"");
        }
        self.state = CompressionState::End;

        let op = self.finish_flush_op;
        let result = BrotliEncoder::compress_stream(self.brotli_mut(), op, b"");

        if !result.success {
            return Err(err!("BrotliCompressionError"));
        }

        Ok(result.output)
    }

    pub fn writer_context<W: bun_io::Write>(&mut self, writable: W) -> BrotliWriter<'_, W> {
        BrotliWriter::init(self, writable)
    }

    // TODO(port): Zig's `writer()` returned a `std.Io.GenericWriter` adapter.
    // Rust callers should use `writer_context()` directly (it impls Write).
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

// Zig: `fn NewWriter(comptime InputWriter: type) type { return struct {...} }`
pub struct BrotliWriter<'a, W> {
    pub compressor: &'a mut BrotliCompressionStream,
    pub input_writer: W,
}

impl<'a, W: bun_io::Write> BrotliWriter<'a, W> {
    // Zig: `WriteError = error{BrotliCompressionError} || InputWriter.Error`
    // TODO(port): error-set union — using bun_core::Error in Phase A.

    pub fn init(compressor: &'a mut BrotliCompressionStream, input_writer: W) -> Self {
        Self {
            compressor,
            input_writer,
        }
    }

    pub fn write(&mut self, to_compress: &[u8]) -> Result<usize, Error> {
        let decompressed = self.compressor.write(to_compress, false)?;
        self.input_writer.write_all(decompressed)?;
        Ok(to_compress.len())
    }

    pub fn end(&mut self) -> Result<(), Error> {
        // PORT NOTE: Zig declared `!usize` but the body has no return — the
        // Zig fn would fail to compile if ever instantiated. Port as `()`.
        let decompressed = self.compressor.end()?;
        self.input_writer.write_all(decompressed)?;
        Ok(())
    }

    // TODO(port): `std.Io.GenericWriter` adapter — provide `impl bun_io::Write`
    // in Phase B if any caller needs the trait object.
}

// ported from: src/brotli/brotli.zig
