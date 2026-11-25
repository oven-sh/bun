use core::cell::Cell;
use core::ffi::{CStr, c_int};
use core::ops::Range;
use std::collections::VecDeque;
use std::sync::Arc;

use scopeguard::ScopeGuard;

use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};
use bun_jsc::bindgen::{
    self, BufferSource, JsHeap, JsLocal, JsPayload, JsScope, JsWrapper, PinnedBytes, StrongWrapper,
};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    ArrayBuffer, Completion, ErrorCode, JSGlobalObject, JSValue, Job, JobContext, JsError,
    JsResult, JsThread, PinnedArrayBuffer, Strong, ThreadIsolated, ThreadIsolatedArg,
};

use crate::node::util::validators;

// ─── type defs ────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct Error {
    pub(crate) msg: &'static [u8],
    pub(crate) err: c_int,
    pub(crate) code: &'static CStr,
}

impl Error {
    pub(crate) const fn init(msg: &'static CStr, err: c_int, code: &'static CStr) -> Error {
        Error {
            msg: msg.to_bytes(),
            err,
            code,
        }
    }
}

pub(crate) const Z_BUF_ERROR: c_int = -5;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
#[allow(non_camel_case_types)] // names mirror Node.js zlib mode constants
pub(crate) enum NodeMode {
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
    /// The `NativeZlib`/`NativeBrotli`/`NativeZstd` constructors have validated the range.
    #[inline]
    pub(crate) const fn from_int(n: u8) -> Self {
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

// ─── local shims (upstream-crate gaps) ────────────────────────────────────

/// Local `JSValue::toU32` shim — `bun_jsc::JSValue` doesn't expose `to_u32()`
/// in this crate's view yet.
#[inline]
fn jsv_to_u32(v: JSValue) -> u32 {
    v.as_number() as u32
}

pub(crate) fn crc32(data: &[u8], value: u32) -> u32 {
    bun_highway::crc32(value, data)
}

// ─── CompressionStream mixin trait ────────────────────────────────────────
// Each `Native{Zlib,Brotli,Zstd}` implements this
// trait to expose its fields + per-class codegen accessors.

/// Backing-stream surface used by [`CompressionStreamImpl`] (zlib / brotli / zstd
/// `Context` types).
pub(crate) trait CompressionContext: Send + 'static {
    const SWAPS_MEMORY: bool = true;
    fn set_flush(&mut self, flush: i32);
    fn flush_value_is_valid(flush: u32) -> bool;
    fn do_work(&mut self, input: &[u8], out: BorrowedCursor<'_, u8>);
    fn reset(&mut self, dropped: Unseen) -> Result<(), Error>;
    /// `[avail_out, avail_in]`, the order `_writeState` holds them in, or why `do_work` failed.
    fn write_result(&self) -> Result<[usize; 2], Error>;
    fn can_do_all_work(&self, _in_len: usize) -> bool {
        true
    }
    /// What `input` claims to be decoded to, or 0.
    fn announced_len(&self, _input: &[u8]) -> usize {
        0
    }
    /// Right after `init()`: appends a whole stream's output and returns `avail_in`. After `None` it is as it was.
    fn do_all_work(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        max: usize,
    ) -> Option<Result<usize, Error>>;
    /// About how much input it works through in the time that it takes to get to another thread and back.
    fn quick_input_len(&self) -> Option<usize>;
    /// More is too much for one job.
    fn long_input_len(&self) -> usize {
        2048 * self.quick_input_len().unwrap_or(256)
    }
    /// `do_work` does not stop when `out` is full.
    fn fills_window_first(&self) -> bool {
        false
    }
    fn is_encoder(&self) -> bool;
    /// Before the first write, and again when it is done.
    fn swap_memory(&mut self, spare: &mut SpareCodecMemory);
    /// Until the next `init()`.
    fn free_state(&mut self);
}

/// What `do_work` came to, and nobody has asked for.
pub(crate) struct Unseen {
    pub(crate) output: bool,
    pub(crate) error: bool,
}

/// What the codecs of a VM pass on to each other. Setting it up takes long compared to a short stream.
#[derive(Default)]
pub(crate) struct SpareCodecMemory {
    pub(crate) brotli_decoder: bun_brotli::SpareTables,
    pub(crate) brotli_encoder: bun_brotli::SpareMemory,
    pub(crate) zstd_decoder: bun_zstd::SpareTables,
    pub(crate) zstd_encoder: bun_zstd::Spare,
    loans: Loan,
}

/// For a stream that has spare memory. It may be more than it needs, for any length of time.
pub(crate) type Loan = Arc<()>;

impl SpareCodecMemory {
    /// `f` runs no JavaScript.
    pub(crate) fn with<R>(f: impl FnOnce(&mut Self) -> R) -> R {
        (crate::jsc_hooks::runtime_state().spare_codec_memory).with_mut(f)
    }

    pub(crate) fn free() {
        Self::with(|spare| {
            let loans = Arc::clone(&spare.loans);
            *spare = Self {
                loans,
                ..Self::default()
            };
        });
        bun_zlib::inflate::free_spare_memory();
    }

    pub(crate) fn lend(take: impl FnOnce(&mut Self)) -> Option<Loan> {
        const MAX_LOANS: usize = 4;
        Self::with(|spare| {
            (Arc::strong_count(&spare.loans) <= MAX_LOANS).then(|| {
                take(spare);
                Arc::clone(&spare.loans)
            })
        })
    }
}

/// More output than this is not made on the JS thread for an asynchronous call.
pub(crate) const QUICK_OUTPUT_LEN: usize = 32 * 1024;

/// A Worker that is terminated waits for a job, and chunks do not have to move when a guess was too low.
const LONG_OUTPUT_LEN: usize = 64 * 1024 * 1024;

type WriteResult = Result<[usize; 2], Error>;

struct DoneWrite {
    out: Vec<u8>,
    read: usize,
    result: WriteResult,
}

/// Writes that are yet to be asked for: those that go on with the input of one that filled its output.
#[derive(Default)]
struct WorkAhead {
    /// All but the last filled their output.
    writes: VecDeque<DoneWrite>,
    flush: u32,
    last_count: usize,
}

impl WorkAhead {
    const MAX_LEN: usize = 64 * 1024;

    /// Twice as far each time, so that it is for streams whose reader keeps up.
    fn fill(&mut self, context: &mut impl CompressionContext, input: &[u8], out_len: usize) {
        self.last_count = (2 * self.last_count.max(1)).min(Self::MAX_LEN / out_len);
        if self.writes.try_reserve(self.last_count).is_err() {
            return;
        }
        for _ in 0..self.last_count {
            let (mut out, Ok([0, avail_in])) = (Vec::new(), context.write_result()) else {
                break;
            };
            if out.try_reserve_exact(out_len).is_err() {
                break;
            }
            let input = &input[input.len() - avail_in..];
            append_with(&mut out, out_len, |out| context.do_work(input, out));
            let result = context.write_result().inspect_err(|_| out.clear());
            let read = result.map_or(0, |[_, left]| avail_in - left);
            self.writes.push_back(DoneWrite { out, read, result });
        }
    }

    fn take_full(&mut self, out_len: usize) -> Option<DoneWrite> {
        (self.writes).pop_front_if(|it| it.out.len() == out_len && matches!(it.result, Ok([0, _])))
    }

    /// Whatever room there is. `None` if the context has to go on. Both have been advanced then.
    fn take(&mut self, flush: u32, input: &mut &[u8], out: &mut &mut [u8]) -> Option<WriteResult> {
        while let Some(DoneWrite { out: written, .. }) = self.writes.front_mut() {
            let len = written.len().min(out.len());
            out.split_off_mut(..len)?.copy_from_slice(&written[..len]);
            if len < written.len() {
                written.drain(..len);
                return Some(Ok([0, input.len()]));
            }
            let DoneWrite { read, result, .. } = self.writes.pop_front()?;
            let Ok([avail_out, avail_in]) = result else {
                return Some(result);
            };
            *input = input.get(read..).unwrap_or_default();
            let is_as_expected = (flush, input.len()) == (self.flush, avail_in);
            if out.is_empty() || (avail_out != 0 && is_as_expected) {
                return Some(Ok([out.len(), input.len()]));
            }
        }
        None
    }

    fn unseen(&self) -> Unseen {
        Unseen {
            output: self.writes.iter().any(|it| !it.out.is_empty()),
            error: self.writes.iter().any(|it| it.result.is_err()),
        }
    }
}

/// Stores a stream's copy of an input that `can_be_freed_while_pinned`.
/// Empty when the stream has no copy.
#[derive(Default)]
struct InputCopy {
    bytes: Vec<u8>,
    /// The copied view's address and length.
    from: (usize, usize),
}

impl InputCopy {
    /// `processCallback` resends one view with a growing `in_off`, so all of it is copied, once.
    fn fill(&mut self, global: &JSGlobalObject, view: &[u8]) -> JsResult<()> {
        let from = (view.as_ptr().addr(), view.len());
        if self.from != from {
            self.from = (0, 0);
            self.bytes.clear();
            self.bytes
                .try_reserve_exact(view.len())
                .map_err(|_| global.throw_out_of_memory())?;
            self.bytes.extend_from_slice(view);
            self.from = from;
            global.vm().report_extra_memory(self.bytes.len());
        }
        Ok(())
    }
}

/// The part of a handle that an async `write()` moves to the thread pool.
pub(crate) struct Stream<C> {
    pub(crate) context: C,
    input_copy: InputCopy,
    ahead: WorkAhead,
    /// The input since the last flush, which an encoder may have put aside.
    unflushed: usize,
    /// The output since a write last left room.
    unbroken: usize,
    /// Since `init()`.
    has_begun: bool,
    loan: Option<Loan>,
    is_set_up: bool,
}

impl<C> Stream<C> {
    pub(crate) fn new(context: C) -> Box<Self> {
        Box::new(Self {
            context,
            input_copy: InputCopy::default(),
            ahead: WorkAhead::default(),
            unflushed: 0,
            unbroken: 0,
            has_begun: false,
            loan: None,
            is_set_up: false,
        })
    }

    fn forget_writes(&mut self) {
        (self.ahead, self.unflushed, self.unbroken) = (WorkAhead::default(), 0, 0);
        self.is_set_up = false;
    }

    pub(crate) fn context_to_init(&mut self) -> &mut C {
        self.forget_writes();
        (self.has_begun, self.loan) = (false, None);
        &mut self.context
    }
}

impl<C: CompressionContext> Stream<C> {
    fn swap_memory(&mut self) {
        SpareCodecMemory::with(|spare| self.context.swap_memory(spare));
    }

    /// Returns whether it had not.
    fn begin(&mut self) -> bool {
        let is_first = !core::mem::replace(&mut self.has_begun, true);
        if is_first && C::SWAPS_MEMORY {
            self.loan = SpareCodecMemory::lend(|spare| self.context.swap_memory(spare));
            self.is_set_up = self.loan.is_some();
        }
        is_first
    }

    fn end_loan(&mut self) {
        if self.loan.take().is_some() {
            self.swap_memory();
        }
    }

    fn can_do_all_work(&self, input: &[u8], max: usize) -> bool {
        let needed = match self.context.is_encoder() {
            // It does not stop at `max`.
            true => input.len() + input.len() / 4 + 1024,
            false => self.context.announced_len(input),
        };
        needed <= max && self.context.can_do_all_work(input.len())
    }

    fn is_short(&self, in_len: usize, out_len: usize) -> bool {
        (self.context.quick_input_len())
            .is_some_and(|len| self.unflushed.saturating_add(in_len) <= len)
            && match self.context.is_encoder() {
                true => !C::SWAPS_MEMORY || self.is_set_up,
                false => self.unbroken + out_len <= QUICK_OUTPUT_LEN,
            }
    }

    /// The first write, in case it is a whole stream whose output fits.
    fn try_whole_stream(&mut self, flush: u32, input: &[u8], out_len: usize) {
        let mut out = Vec::new();
        if let Some(Ok(avail_in)) = self.context.do_all_work(input, &mut out, out_len) {
            let (read, result) = (input.len() - avail_in, Ok([out_len - out.len(), avail_in]));
            self.ahead.flush = flush;
            self.ahead.writes.push_back(DoneWrite { out, read, result });
        }
    }

    fn count(
        &mut self,
        flushes: bool,
        [out_len, in_len]: [usize; 2],
        [avail_out, avail_in]: [usize; 2],
    ) {
        let is_full = avail_out == 0;
        self.is_set_up |= flushes;
        self.unbroken = if is_full { self.unbroken + out_len } else { 0 };
        self.unflushed = match self.context.is_encoder() && (is_full || !flushes) {
            true => self.unflushed + in_len.saturating_sub(avail_in),
            false => 0,
        };
    }

    /// `next_out_len` is 0 if nothing is known about the next write.
    fn work(
        context: &mut C,
        ahead: &mut WorkAhead,
        flush: u32,
        mut input: &[u8],
        mut out: &mut [u8],
        next_out_len: usize,
    ) -> WriteResult {
        if let Some(result) = ahead.take(flush, &mut input, &mut out) {
            return result;
        }
        ahead.flush = flush;
        context.do_work(input, BorrowedBuf::from(out).unfilled());
        let result = context.write_result();
        match (result, next_out_len) {
            (Ok([0, _]), 1..) => ahead.fill(context, input, next_out_len),
            (_, 0) => ahead.last_count = 0,
            _ => {}
        }
        result
    }
}

/// Where a synchronous call writes its result.
pub(crate) struct OutputScratch(pub(crate) Vec<u8>);

impl OutputScratch {
    /// An encoder asks for much more room than it fills.
    pub(crate) fn for_encoder() -> Self {
        Self(VirtualMachine::get().rare_data().take_compression_scratch())
    }

    /// A decoder gets on while it waits for new memory, which a copy does not.
    pub(crate) fn for_decoder(input: &[u8]) -> Self {
        match input.len() {
            ..=512 => Self::for_encoder(),
            _ => Self(Vec::new()),
        }
    }

    pub(crate) fn finish<R>(
        mut self,
        copy: impl FnOnce(&[u8]) -> R,
        adopt: impl FnOnce(Box<[u8]>) -> R,
    ) -> R {
        /// Cheaper than an `ArrayBuffer`.
        const ALWAYS_COPIED: usize = 2048;
        // The allocator moves what fills less than half of its block, which may be an eighth larger than asked for.
        if self.0.len() <= ALWAYS_COPIED.max(self.0.capacity() / 16 * 9) {
            return copy(&self.0);
        }
        adopt(core::mem::take(&mut self.0).into_boxed_slice())
    }
}

impl Drop for OutputScratch {
    fn drop(&mut self) {
        if self.0.capacity() != 0 {
            let rare = VirtualMachine::get().rare_data();
            rare.put_back_compression_scratch(core::mem::take(&mut self.0));
        }
    }
}

/// So small that two can be added.
fn usize_from_js(value: JsLocal<'_>) -> usize {
    (value.to_js().as_number() as usize).min(1 << f64::MANTISSA_DIGITS)
}

/// `_writeState` has to be able to count it.
fn out_len_from_js(global: &JSGlobalObject, value: JsLocal<'_>) -> JsResult<usize> {
    let len = usize_from_js(value);
    if len > u32::MAX as usize {
        return Err(global
            .err(
                ErrorCode::OUT_OF_RANGE,
                format_args!("out_len must be <= {}", u32::MAX),
            )
            .throw());
    }
    Ok(len)
}

/// The codecs `memcpy` from `in` to `out`.
fn throw_if_overlapping(
    global: &JSGlobalObject,
    in_buf: &ArrayBuffer,
    out_buf: &ArrayBuffer,
) -> JsResult<()> {
    if in_buf.overlaps(out_buf) {
        return Err(global
            .err(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("The \"in\" and \"out\" ranges must not overlap"),
            )
            .throw());
    }
    Ok(())
}

fn throw_invalid_state(global: &JSGlobalObject, message: &str) -> JsError {
    global
        .err(ErrorCode::INVALID_STATE, format_args!("{message}"))
        .throw()
}

enum PendingInput {
    Empty,
    Pinned(PinnedArrayBuffer),
    /// In the stream's [`InputCopy`].
    Copied(Range<usize>),
}

/// The ranges an async `write()` reads and fills. They do not overlap.
struct PendingBuffers {
    input: PendingInput,
    out: PinnedArrayBuffer,
}

// SAFETY: `pin` pins both views, or copies the input. The handle's `pendingInput` and `pendingOutput` root them.
unsafe impl ThreadIsolatedArg for PendingBuffers {}

impl PendingBuffers {
    /// Materializing a FastTypedArray's backing store can fail on OOM.
    fn pin(
        global: &JSGlobalObject,
        in_js: JSValue,
        in_range: Range<usize>,
        out_js: JSValue,
        out_range: Range<usize>,
        input_copy: &mut InputCopy,
    ) -> JsResult<Self> {
        let pin = |value| {
            PinnedArrayBuffer::pin(global, value).ok_or_else(|| global.throw_out_of_memory())
        };
        let mut out = pin(out_js)?;
        out.narrow(out_range.start, out_range.len());
        if in_range.is_empty() {
            return Ok(Self {
                input: PendingInput::Empty,
                out,
            });
        }
        let mut in_buf = pin(in_js)?;
        // The pool thread reads the input later: it gets a copy if the pin can't keep the bytes mapped.
        let input = if in_buf.can_be_freed_while_pinned() {
            input_copy.fill(global, in_buf.byte_slice())?;
            PendingInput::Copied(in_range)
        } else {
            in_buf.narrow(in_range.start, in_range.len());
            throw_if_overlapping(global, &in_buf, &out)?;
            PendingInput::Pinned(in_buf)
        };
        Ok(Self { input, out })
    }

    fn slices<'a>(&'a mut self, input_copy: &'a InputCopy) -> (&'a [u8], &'a mut [u8]) {
        let input = match &self.input {
            PendingInput::Empty => &[],
            PendingInput::Pinned(buffer) => buffer.byte_slice(),
            PendingInput::Copied(range) => &input_copy.bytes[range.clone()],
        };
        (input, self.out.slice_mut())
    }
}

/// An async `write()`. It owns the handle's stream until it completes.
struct PendingWrite<T: CompressionStreamImpl> {
    stream: Box<Stream<T::Context>>,
    buffers: ThreadIsolated<PendingBuffers>,
    flush: u32,
    is_short: bool,
    next_out_len: usize,
    result: WriteResult,
    /// In the place of what goes to `buffers`.
    output: Option<Vec<u8>>,
}

impl<T: CompressionStreamImpl> JobContext for PendingWrite<T> {
    type OffThread = Self;
    type Js = StrongWrapper<T>;

    /// The handle needs its stream back, and the callbacks carry their own context.
    const OUTLIVES_SCRIPT: bool = true;

    fn run(write: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        if done.ticket().script_allowed() {
            let stream = &mut *write.stream;
            let (input, out) = write.buffers.slices(&stream.input_copy);
            let (context, ahead) = (&mut stream.context, &mut stream.ahead);
            let lens = [out.len(), input.len()];
            let full = (write.next_out_len == out.len()).then(|| ahead.take_full(out.len()));
            (write.output, write.result) = match full.flatten() {
                Some(it) => (Some(it.out), Ok([0, input.len().saturating_sub(it.read)])),
                None => {
                    let next_out_len = if write.is_short {
                        0
                    } else {
                        write.next_out_len
                    };
                    let result =
                        Stream::work(context, ahead, write.flush, input, out, next_out_len);
                    (None, result)
                }
            };
            if let Ok(left) = write.result {
                stream.count(write.flush != 0, lens, left);
            }
        }
        Some(done)
    }

    fn then(write: Self, handle: StrongWrapper<T>, cx: &JsThread<'_>) -> JsResult<()> {
        let (global, this, this_value) = (handle.global(), handle.payload(), handle.to_js());
        let Self {
            mut stream,
            buffers,
            result,
            output,
            ..
        } = write;

        drop(buffers);
        T::pending_input_set_cached(this_value, global, JSValue::ZERO);
        T::pending_output_set_cached(this_value, global, JSValue::ZERO);

        // The copy is only read again if some input is unconsumed, because JS then resends it.
        if let Ok([_, 0]) = result {
            stream.input_copy = InputCopy::default();
        }
        this.stream().set(Some(stream));

        let uncounted = match result {
            Ok(result) => T::flush_write_result(global, this_value, result),
            Err(err) => {
                this.emit_error(global, this_value, &err);
                return Ok(());
            }
        };

        let arguments = [
            uncounted.map_or(JSValue::UNDEFINED, JSValue::js_number),
            output.map_or(Ok(JSValue::UNDEFINED), |output| {
                JSValue::create_buffer(global, output)
            })?,
        ];

        // A handle whose `init()` was never called has no write callback.
        if let Some(write_callback) = T::write_callback_get_cached(this_value) {
            cx.vm().event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                write_callback,
                global,
                this_value,
                &arguments,
            );
        }

        if this.pending_close().get() {
            this.close();
        }
        Ok(())
    }
}

/// A `writeAll()`.
struct PendingWriteAll<T: CompressionStreamImpl> {
    stream: Box<Stream<T::Context>>,
    input: PinnedBytes,
    max: usize,
    /// The output and `avail_in`.
    result: Option<Result<(Vec<u8>, usize), Error>>,
}

impl<T: CompressionStreamImpl> PendingWriteAll<T> {
    fn work(&mut self, max: usize) {
        let mut out = Vec::new();
        let result = (self.stream.context).do_all_work(&self.input, &mut out, max.min(self.max));
        self.result = result.map(|result| {
            let (avail_in, mut exact) = (result?, Vec::new());
            if out.len() < out.capacity() / 2 && exact.try_reserve_exact(out.len()).is_ok() {
                exact.extend_from_slice(&out);
                out = exact;
            }
            Ok((out, avail_in))
        });
    }
}

impl<T: CompressionStreamImpl> JobContext for PendingWriteAll<T> {
    type OffThread = Self;
    type Js = (StrongWrapper<T>, Strong);

    /// As for [`PendingWrite`].
    const OUTLIVES_SCRIPT: bool = true;

    fn run(write: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        if done.ticket().script_allowed() && write.result.is_none() {
            write.work(write.max);
        }
        Some(done)
    }

    fn then(write: Self, (handle, callback): Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        let (global, this, this_value) = (handle.global(), handle.payload(), handle.to_js());
        let input_len = write.input.len();
        drop(write.input);
        this.stream().set(Some(write.stream));

        let arguments = match write.result {
            Some(Ok((out, avail_in))) => [
                JSValue::create_buffer(global, out)?,
                JSValue::js_number((input_len - avail_in) as f64),
            ],
            None => [JSValue::UNDEFINED; 2],
            Some(Err(err)) => {
                this.emit_error(global, this_value, &err);
                return Ok(());
            }
        };
        cx.vm().event_loop().run_callback(
            bun_event_loop::ContextId::NONE,
            callback.get(),
            global,
            this_value,
            &arguments,
        );

        if this.pending_close().get() {
            this.close();
        }
        Ok(())
    }
}

pub(crate) trait CompressionStreamImpl: JsPayload {
    type Context: CompressionContext;

    /// `None` while a write has it, and once the handle is closed.
    fn stream(&self) -> &Cell<Option<Box<Stream<Self::Context>>>>;

    /// Write `(avail_out, avail_in)` into the JS-owned 2-element `Uint32Array`
    /// (`this._writeState`), re-resolving the cached `writeResult` typed array
    /// on every call so a detached, resized, or replaced backing store is
    /// skipped instead of written through a stale pointer.
    ///
    /// An input can be longer than the array can count. Returns what to add to `avail_in` then.
    #[inline]
    fn flush_write_result(
        global: &JSGlobalObject,
        this_value: JSValue,
        result: [usize; 2],
    ) -> Option<f64> {
        let write_result_value = Self::write_result_get_cached(this_value)?;
        if !write_result_value.is_cell() {
            return None;
        }
        let mut write_result_buf = write_result_value.as_array_buffer(global)?;
        let counted = result.map(|n| u32::try_from(n).unwrap_or(u32::MAX));
        (write_result_buf.as_u32().get_mut(..2)?)
            .copy_from_slice(&counted.map(bun_core::Unaligned::new));
        let uncounted = result[1] - counted[1] as usize;
        (uncounted != 0).then_some(uncounted as f64)
    }

    fn pending_close(&self) -> &Cell<bool>;
    fn closed(&self) -> &Cell<bool>;

    // Per-class codegen (`T.js.*` cached-property accessors).
    fn write_result_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn write_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn write_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue);
    fn error_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn error_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue);
    fn pending_input_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn pending_output_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);

    // Members shared by the classes in `node_zlib_binding.bind.ts`, with their helpers.
    #[inline]
    fn set_onerror(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        let (global, value) = (cx.global(), value.to_js());
        if value.is_function() {
            Self::error_callback_set_cached(
                this_value.to_js(),
                global,
                value.with_async_context_if_needed(global),
            );
        }
    }
    #[inline]
    fn get_onerror(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        Self::error_callback_get_cached(this_value.to_js()).unwrap_or(JSValue::UNDEFINED)
    }

    /// Takes the stream until the guard drops. Throws if a write has it, or the handle is closing or closed.
    fn borrow_idle_stream(
        &self,
        global_this: &JSGlobalObject,
    ) -> JsResult<ScopeGuard<Box<Stream<Self::Context>>, impl FnOnce(Box<Stream<Self::Context>>)>>
    {
        let Some(stream) = self.stream().take() else {
            let message = if self.closed().get() {
                "zlib binding closed"
            } else {
                "Write already in progress"
            };
            return Err(throw_invalid_state(global_this, message));
        };
        let stream = scopeguard::guard(stream, |stream| self.stream().set(Some(stream)));
        if self.pending_close().get() {
            return Err(throw_invalid_state(global_this, "Pending close"));
        }
        Ok(stream)
    }

    fn throw_unless_idle(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        self.borrow_idle_stream(global_this).map(drop)
    }

    fn write(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        flush: JsLocal<'_>,
        in_: JsLocal<'_>,
        in_off: JsLocal<'_>,
        in_len: JsLocal<'_>,
        out: JsLocal<'_>,
        out_off: JsLocal<'_>,
        out_len: JsLocal<'_>,
        next_out_len: f64,
    ) -> JsResult<()> {
        let global_this = cx.global();
        let (flush, in_js, out_js) = (flush.to_js(), in_.to_js(), out.to_js());

        if flush.is_undefined() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("flush value is required"),
                )
                .throw());
        }
        let flush: u32 = jsv_to_u32(flush);
        if !<Self::Context as CompressionContext>::flush_value_is_valid(flush) {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Invalid flush value"),
                )
                .throw());
        }

        let (in_off, in_len): (usize, usize) = if in_js.is_null() {
            // just a flush
            (0, 0)
        } else {
            let in_buf = match in_js.as_array_buffer(global_this) {
                Some(b) => b,
                None => {
                    return Err(global_this
                        .err(
                            ErrorCode::INVALID_ARG_TYPE,
                            format_args!("The \"in\" argument must be a TypedArray or DataView"),
                        )
                        .throw());
                }
            };
            // Growable SharedArrayBuffer only grows in place; the captured
            // (ptr, len) stays valid. Only non-shared resizable can shrink.
            if in_buf.resizable && !in_buf.shared {
                return Err(global_this
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!(
                            "The \"in\" argument must not be backed by a resizable ArrayBuffer"
                        ),
                    )
                    .throw());
            }
            let (in_off, in_len) = (usize_from_js(in_off), usize_from_js(in_len));
            if in_buf.byte_len < in_off + in_len {
                return Err(global_this
                    .err(
                        ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "in_off + in_len ({}) exceeds input buffer length ({})",
                            in_off + in_len,
                            in_buf.byte_len,
                        ),
                    )
                    .throw());
            }
            (in_off, in_len)
        };

        let Some(out_buf) = out_js.as_array_buffer(global_this) else {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"out\" argument must be a TypedArray or DataView"),
                )
                .throw());
        };
        let out_off = usize_from_js(out_off);
        let out_len = out_len_from_js(global_this, out_len)?;
        if out_buf.byte_len < out_off + out_len {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "out_off + out_len ({}) exceeds output buffer length ({})",
                        out_off + out_len,
                        out_buf.byte_len,
                    ),
                )
                .throw());
        }
        // The pool thread writes to `out` after this call returns.
        if out_buf.can_be_freed_while_pinned() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The \"out\" argument must not be backed by a resizable ArrayBuffer or a WebAssembly.Memory"
                    ),
                )
                .throw());
        }

        let mut stream = self.borrow_idle_stream(global_this)?;
        let buffers = PendingBuffers::pin(
            global_this,
            in_js,
            in_off..in_off + in_len,
            out_js,
            out_off..out_off + out_len,
            &mut stream.input_copy,
        )?;
        stream
            .context
            .set_flush(i32::try_from(flush).expect("int cast"));

        Self::pending_input_set_cached(this_value.to_js(), global_this, in_js);
        Self::pending_output_set_cached(this_value.to_js(), global_this, out_js);

        let is_first = stream.begin();
        let mut is_short = stream.is_short(in_len, out_len);
        if is_short && stream.context.fills_window_first() && in_len + stream.unbroken != 0 {
            is_short = false;
            if let (true, PendingInput::Pinned(input)) = (is_first, &buffers.input) {
                stream.try_whole_stream(flush, input.byte_slice(), out_len);
            }
        }
        let is_done = !stream.ahead.writes.is_empty();
        let thread = global_this.js_thread(global_this.bun_vm().root_context());
        let write = PendingWrite {
            flush,
            next_out_len: next_out_len as usize,
            is_short,
            output: None,
            result: stream.context.write_result(),
            stream: ScopeGuard::into_inner(stream),
            // SAFETY: the job roots the handle, whose fields root both buffers until `then`
            // has dropped this: no other write sets them while the job has the stream. A job
            // is dropped on the JS thread, and `run` makes no reference to the bytes.
            buffers: unsafe { ThreadIsolated::new(buffers) },
        };
        let handle = StrongWrapper::new(this_value, global_this);
        if is_short || is_done {
            Job::<PendingWrite<Self>>::run_here(&thread, write, handle);
        } else {
            Job::<PendingWrite<Self>>::schedule(&thread, write, handle);
        }

        Ok(())
    }

    fn write_sync(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        flush: JsLocal<'_>,
        in_: JsLocal<'_>,
        in_off: JsLocal<'_>,
        in_len: JsLocal<'_>,
        out: JsLocal<'_>,
        out_off: JsLocal<'_>,
        out_len: JsLocal<'_>,
    ) -> JsResult<Option<f64>> {
        let global_this = cx.global();
        let (flush, in_js, out_js) = (flush.to_js(), in_.to_js(), out.to_js());

        if flush.is_undefined() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("flush value is required"),
                )
                .throw());
        }
        let flush: u32 = jsv_to_u32(flush);
        if !<Self::Context as CompressionContext>::flush_value_is_valid(flush) {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Invalid flush value"),
                )
                .throw());
        }

        let in_buf = if in_js.is_null() {
            // just a flush
            ArrayBuffer::default()
        } else {
            let Some(mut in_buf) = in_js.as_array_buffer(global_this) else {
                return Err(global_this
                    .err(
                        ErrorCode::INVALID_ARG_TYPE,
                        format_args!("The \"in\" argument must be a TypedArray or DataView"),
                    )
                    .throw());
            };
            let (in_off, in_len) = (usize_from_js(in_off), usize_from_js(in_len));
            if in_buf.byte_len < in_off + in_len {
                return Err(global_this
                    .err(
                        ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "in_off + in_len ({}) exceeds input buffer length ({})",
                            in_off + in_len,
                            in_buf.byte_len,
                        ),
                    )
                    .throw());
            }
            in_buf.narrow(in_off, in_len);
            in_buf
        };

        let Some(mut out_buf) = out_js.as_array_buffer(global_this) else {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"out\" argument must be a TypedArray or DataView"),
                )
                .throw());
        };
        let out_off = usize_from_js(out_off);
        let out_len = out_len_from_js(global_this, out_len)?;
        if out_buf.byte_len < out_off + out_len {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "out_off + out_len ({}) exceeds output buffer length ({})",
                        out_off + out_len,
                        out_buf.byte_len,
                    ),
                )
                .throw());
        }
        out_buf.narrow(out_off, out_len);
        throw_if_overlapping(global_this, &in_buf, &out_buf)?;

        let mut stream = self.borrow_idle_stream(global_this)?;
        stream.begin();
        let Stream { context, ahead, .. } = &mut **stream;
        context.set_flush(i32::try_from(flush).expect("int cast"));
        let (input, out) = (in_buf.byte_slice(), out_buf.byte_slice_mut());
        let result = Stream::work(context, ahead, flush, input, out, 0);
        drop(stream);

        Ok(match result {
            Ok(result) => Self::flush_write_result(global_this, this_value.to_js(), result),
            Err(err) => {
                self.emit_error(global_this, this_value.to_js(), &err);
                None
            }
        })
    }

    /// Calls back with the output and the number of bytes read, or with nothing if it takes writes after all.
    fn write_all(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        input: PinnedBytes,
        max_output_length: f64,
        callback: JsLocal<'_>,
    ) -> JsResult<bool> {
        let global_this = cx.global();
        let callback = validators::validate_function(global_this, "callback", callback.to_js())?;
        let callback = callback.with_async_context_if_needed(global_this);
        let max = (max_output_length as usize).min(LONG_OUTPUT_LEN);
        let mut stream = self.borrow_idle_stream(global_this)?;
        let quick_len = stream.context.quick_input_len();
        if input.len() > stream.context.long_input_len()
            || input.is_copy()
            || !stream.can_do_all_work(&input, max)
            || !stream.begin()
        {
            return Ok(false);
        }
        let mut write = PendingWriteAll::<Self> {
            stream: ScopeGuard::into_inner(stream),
            input,
            max,
            result: None,
        };
        if quick_len.is_some_and(|len| write.input.len() <= len)
            && write.stream.can_do_all_work(&write.input, QUICK_OUTPUT_LEN)
        {
            write.work(QUICK_OUTPUT_LEN);
        }
        let thread = global_this.js_thread(global_this.bun_vm().root_context());
        let js = (
            StrongWrapper::new(this_value, global_this),
            Strong::create(callback, global_this),
        );
        if write.result.is_some() {
            write.stream.end_loan();
            write.stream.context.free_state();
            Job::<PendingWriteAll<Self>>::run_here(&thread, write, js);
        } else {
            Job::<PendingWriteAll<Self>>::schedule(&thread, write, js);
        }
        Ok(true)
    }

    /// The output, or nothing if it takes writes. The handle keeps nothing of the call.
    fn write_all_sync<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        input: &[u8],
        max_output_length: f64,
    ) -> bindgen::Result<'a, Option<JsLocal<'a, BufferSource>>> {
        // SAFETY: it is for a throw, which is returned at once, and for a write barrier.
        let global_this = unsafe { heap.global() };
        let max = (max_output_length as usize).min(ArrayBuffer::MAX_SIZE);
        let mut stream = self.borrow_idle_stream(global_this)?;
        if stream.has_begun {
            return Ok(None);
        }
        Self::write_callback_set_cached(this_value.to_js(), global_this, JSValue::ZERO);
        let mut out = match stream.context.is_encoder() {
            true => OutputScratch::for_encoder(),
            false => OutputScratch::for_decoder(input),
        };
        let mut result = None;
        if stream.can_do_all_work(input, max) {
            let likely = input.len().saturating_mul(32).max(LONG_OUTPUT_LEN);
            let max = max.min(likely.max(stream.context.announced_len(input)));
            stream.swap_memory();
            result = stream.context.do_all_work(input, &mut out.0, max);
            stream.swap_memory();
        }
        stream.context.free_state();
        drop(stream);
        if !matches!(result, Some(Ok(_))) || out.0.len() > max {
            return Ok(None);
        }
        out.finish(
            |out| heap.create_buffer(out),
            |out| heap.create_buffer_from_box(out),
        )
        .map(Some)
    }

    fn reset(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<()> {
        let global_this = cx.global();
        if self.closed().get() {
            return Ok(());
        }
        let Some(mut stream) = self.stream().take() else {
            // Node throws a plain `Error` here.
            return Err(
                global_this.throw_value(global_this.create_error_instance(format_args!(
                    "Cannot reset zlib stream while a write is in progress"
                ))),
            );
        };
        let result = stream.context.reset(stream.ahead.unseen());
        stream.input_copy = InputCopy::default();
        if result.is_ok() {
            stream.forget_writes();
        }
        self.stream().set(Some(stream));
        if let Err(err) = result {
            self.emit_error(global_this, this_value.to_js(), &err);
        }
        Ok(())
    }

    fn close(&self) {
        let stream = self.stream().take();
        if stream.is_none() && !self.closed().get() {
            self.pending_close().set(true);
            return;
        }
        self.pending_close().set(false);
        self.closed().set(true);
        if let Some(mut stream) = stream {
            stream.end_loan();
        }
    }

    /// The callback can re-enter any member, so the stream has to be back in its cell.
    fn emit_error(&self, global_this: &JSGlobalObject, this_value: JSValue, err_: &Error) {
        let Ok(msg_value) = bun_string_jsc::create_utf8_for_js(global_this, err_.msg) else {
            return;
        };
        let err_value: JSValue = JSValue::js_number(f64::from(err_.err));
        let Ok(code_value) = bun_string_jsc::create_utf8_for_js(global_this, err_.code.to_bytes())
        else {
            return;
        };

        // The `zlib.ts` wrapper installs `onerror` right after construction,
        // but a handle driven directly has none; there is nobody to notify.
        // The pending close handling below still runs either way.
        if let Some(callback) = Self::error_callback_get_cached(this_value) {
            let vm = global_this.bun_vm();
            vm.event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                callback,
                global_this,
                this_value,
                &[msg_value, err_value, code_value],
            );
        }

        if self.pending_close().get() {
            self.close();
        }
    }
}

/// Implements [`CompressionStreamImpl`] for a `Native*` struct by delegating to its fields.
///
/// All three `Native{Zlib,Brotli,Zstd}` structs have `stream`, `pending_close` and `closed`.
///
/// `$js` is the class's generated module, which has the accessors for its internal fields.
#[macro_export]
#[doc(hidden)]
macro_rules! __impl_compression_stream {
    ($native:ident, $ctx:ty, $js:ident) => {
        use $crate::generated_bindgen::node_zlib_binding::$js as js;

        impl $crate::node::node_zlib_binding::CompressionStreamImpl for $native {
            type Context = $ctx;

            #[inline]
            fn stream(
                &self,
            ) -> &::core::cell::Cell<Option<Box<$crate::node::node_zlib_binding::Stream<$ctx>>>>
            {
                &self.stream
            }
            #[inline]
            fn pending_close(&self) -> &::core::cell::Cell<bool> {
                &self.pending_close
            }
            #[inline]
            fn closed(&self) -> &::core::cell::Cell<bool> {
                &self.closed
            }

            #[inline]
            fn write_result_get_cached(
                this_value: ::bun_jsc::JSValue,
            ) -> Option<::bun_jsc::JSValue> {
                js::write_result_get_cached(this_value)
            }
            #[inline]
            fn write_callback_get_cached(
                this_value: ::bun_jsc::JSValue,
            ) -> Option<::bun_jsc::JSValue> {
                js::write_callback_get_cached(this_value)
            }
            #[inline]
            fn write_callback_set_cached(
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
                cb: ::bun_jsc::JSValue,
            ) {
                js::write_callback_set_cached(this_value, global, cb)
            }
            #[inline]
            fn error_callback_get_cached(
                this_value: ::bun_jsc::JSValue,
            ) -> Option<::bun_jsc::JSValue> {
                js::error_callback_get_cached(this_value)
            }
            #[inline]
            fn error_callback_set_cached(
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
                cb: ::bun_jsc::JSValue,
            ) {
                js::error_callback_set_cached(this_value, global, cb)
            }
            #[inline]
            fn pending_input_set_cached(
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
                value: ::bun_jsc::JSValue,
            ) {
                js::pending_input_set_cached(this_value, global, value)
            }
            #[inline]
            fn pending_output_set_cached(
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
                value: ::bun_jsc::JSValue,
            ) {
                js::pending_output_set_cached(this_value, global, value)
            }
        }
    };
}
