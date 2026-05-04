use core::ffi::c_void;
use core::ptr;

use bun_brotli_sys as c;
use c::{BrotliDecoder, BrotliEncoder};

use bun_core::{self as bun, err, Error};

// ──────────────────────────────────────────────────────────────────────────
// BrotliAllocator
// ──────────────────────────────────────────────────────────────────────────

pub struct BrotliAllocator;

impl BrotliAllocator {
    pub extern "C" fn alloc(_: *mut c_void, len: usize) -> *mut c_void {
        #[cfg(feature = "heap_breakdown")]
        {
            // TODO(port): bun.heap_breakdown is macOS-only malloc-zone tagging
            let zone = bun_core::heap_breakdown::get_zone(b"brotli");
            return zone
                .malloc_zone_malloc(len)
                .unwrap_or_else(|| bun_core::out_of_memory());
        }

        #[cfg(not(feature = "heap_breakdown"))]
        {
            // SAFETY: mi_malloc is sound for any len; null-checked below.
            let p = unsafe { bun_alloc::mimalloc::mi_malloc(len) };
            if p.is_null() {
                bun_core::out_of_memory();
            }
            p
        }
    }

    pub extern "C" fn free(_: *mut c_void, data: *mut c_void) {
        #[cfg(feature = "heap_breakdown")]
        {
            let zone = bun_core::heap_breakdown::get_zone(b"brotli");
            zone.malloc_zone_free(data);
            return;
        }

        #[cfg(not(feature = "heap_breakdown"))]
        // SAFETY: data was allocated by mi_malloc in BrotliAllocator::alloc (or
        // is null, which mi_free accepts).
        unsafe {
            bun_alloc::mimalloc::mi_free(data);
        }
    }
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
    pub brotli: *mut c::BrotliDecoderState,
    pub state: ReaderState,
    pub total_out: usize,
    pub total_in: usize,
    pub flush_op: c::BrotliEncoderOperation,
    pub finish_flush_op: c::BrotliEncoderOperation,
    pub full_flush_op: c::BrotliEncoderOperation,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReaderState {
    Uninitialized,
    Inflating,
    End,
    Error,
}

impl<'a> BrotliReaderArrayList<'a> {
    // Zig: `pub const new = bun.TrivialNew(BrotliReaderArrayList);`
    #[inline]
    pub fn new(value: Self) -> Box<Self> {
        Box::new(value)
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
            c::BrotliEncoderOperation::Process,
            c::BrotliEncoderOperation::Finish,
            c::BrotliEncoderOperation::Flush,
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

        let brotli = BrotliDecoder::create_instance(
            Some(BrotliAllocator::alloc),
            Some(BrotliAllocator::free),
            ptr::null_mut(),
        )
        .ok_or(err!("BrotliFailedToCreateInstance"))?;

        if options.params.large_window {
            // SAFETY: brotli is a freshly created non-null decoder instance.
            unsafe {
                let _ = BrotliDecoder::set_parameter(
                    brotli,
                    c::BrotliDecoderParameter::LARGE_WINDOW,
                    1,
                );
            }
        }
        if options.params.disable_ring_buffer_reallocation {
            // SAFETY: brotli is a freshly created non-null decoder instance.
            unsafe {
                let _ = BrotliDecoder::set_parameter(
                    brotli,
                    c::BrotliDecoderParameter::DISABLE_RING_BUFFER_REALLOCATION,
                    1,
                );
            }
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
            let mut unused_capacity = self.list_ptr.spare_capacity_mut();

            if unused_capacity.len() < 4096 {
                self.list_ptr.reserve(4096);
                unused_capacity = self.list_ptr.spare_capacity_mut();
            }

            debug_assert!(unused_capacity.len() > 0);

            let next_in = &self.input[self.total_in..];

            let mut in_remaining = next_in.len();
            let mut out_remaining = unused_capacity.len();

            let mut next_in_ptr: *const u8 = next_in.as_ptr();
            let mut next_out_ptr: *mut u8 = unused_capacity.as_mut_ptr().cast::<u8>();

            // https://github.com/google/brotli/blob/fef82ea10435abb1500b615b1b2c6175d429ec6c/go/cbrotli/reader.go#L15-L27
            // SAFETY: self.brotli is a live decoder instance; the in/out
            // pointers reference valid buffers of the given lengths.
            let result = unsafe {
                BrotliDecoder::decompress_stream(
                    self.brotli,
                    &mut in_remaining,
                    &mut next_in_ptr,
                    &mut out_remaining,
                    &mut next_out_ptr,
                    ptr::null_mut(),
                )
            };

            let bytes_written = unused_capacity.len().saturating_sub(out_remaining);
            let bytes_read = next_in.len().saturating_sub(in_remaining);

            // SAFETY: brotli wrote `bytes_written` initialized bytes into the
            // spare-capacity region starting at the previous `len()`.
            unsafe {
                let new_len = self.list_ptr.len() + bytes_written;
                self.list_ptr.set_len(new_len);
            }
            self.total_in += bytes_read;

            match result {
                c::BrotliDecoderResult::Success => {
                    if cfg!(debug_assertions) {
                        // SAFETY: self.brotli is a live decoder instance.
                        debug_assert!(unsafe { BrotliDecoder::is_finished(self.brotli) });
                    }
                    self.end();
                    return Ok(());
                }
                c::BrotliDecoderResult::Error => {
                    self.state = ReaderState::Error;
                    if cfg!(debug_assertions) {
                        // SAFETY: self.brotli is a live decoder instance.
                        let code = unsafe { BrotliDecoder::get_error_code(self.brotli) };
                        bun_core::Output::debug_warn(format_args!(
                            "Brotli error: {} ({})",
                            <&'static str>::from(code),
                            code as i32,
                        ));
                    }

                    return Err(err!("BrotliDecompressionError"));
                }

                c::BrotliDecoderResult::NeedsMoreInput => {
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
                c::BrotliDecoderResult::NeedsMoreOutput => {
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
        // SAFETY: self.brotli was created by BrotliDecoder::create_instance and
        // is destroyed exactly once here.
        unsafe {
            BrotliDecoder::destroy_instance(self.brotli);
        }
        // PORT NOTE: Zig's `bun.destroy(this)` is implicit — callers hold a
        // `Box<Self>` and dropping it frees the allocation.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BrotliCompressionStream
// ──────────────────────────────────────────────────────────────────────────

pub struct BrotliCompressionStream {
    pub brotli: *mut c::BrotliEncoderState,
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

    pub fn write_chunk(&mut self, input: &[u8], last: bool) -> Result<&[u8], Error> {
        // TODO(port): narrow error set
        self.total_in += input.len();
        // SAFETY: self.brotli is a live encoder instance; `input` is valid for
        // the duration of the call.
        let result = unsafe {
            BrotliEncoder::compress_stream(
                self.brotli,
                if last { self.finish_flush_op } else { self.flush_op },
                input,
            )
        };

        if !result.success {
            self.state = CompressionState::Error;
            return Err(err!("BrotliCompressionError"));
        }

        // TODO(port): lifetime — `result.output` borrows brotli's internal
        // buffer, valid until the next compress_stream/destroy call. Zig
        // returned `[]const u8`; we return `&[u8]` tied to `&mut self` here.
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
        // Zig's `defer this.state = .End` runs on BOTH ok and error paths, so
        // assign unconditionally after computing the result.
        // TODO(port): borrowck — returned slice borrows encoder buffer via
        // &mut self; Phase B resolve (scopeguard on disjoint field or change
        // return type).
        let result = self.write(b"", true);
        self.state = CompressionState::End;
        result
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
        // SAFETY: self.brotli was created by BrotliEncoder::create_instance and
        // is destroyed exactly once here.
        unsafe {
            BrotliEncoder::destroy_instance(self.brotli);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/brotli/brotli.zig (287 lines)
//   confidence: medium
//   todos:      14
//   notes:      list/list_ptr by-value-copy dance collapsed to &mut Vec<u8>; brotli_sys API surface (Operation/Result/State names, compress_stream return shape) assumed — verify in Phase B
// ──────────────────────────────────────────────────────────────────────────
