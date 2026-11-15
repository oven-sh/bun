use core::cell::Cell;
use core::ffi::{CStr, c_int};
use core::ops::Range;

use scopeguard::ScopeGuard;

use bun_core::vec::{BorrowedBuf, BorrowedCursor};
use bun_jsc::bindgen::{JsLocal, JsPayload, JsScope, JsWrapper, StrongWrapper};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    ArrayBuffer, Completion, ErrorCode, JSGlobalObject, JSValue, Job, JobContext, JsError,
    JsResult, JsThread, PinnedArrayBuffer, ThreadIsolated, ThreadIsolatedArg,
};

// ─── type defs ────────────────────────────────────────────────────────────

pub(crate) struct Error {
    pub(crate) msg: &'static CStr,
    pub(crate) err: c_int,
    pub(crate) code: &'static CStr,
}

impl Error {
    pub(crate) const fn init(msg: &'static CStr, err: c_int, code: &'static CStr) -> Error {
        Error { msg, err, code }
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
    bun_zlib::crc32_bytes(value, data)
}

// ─── CompressionStream mixin trait ────────────────────────────────────────
// Each `Native{Zlib,Brotli,Zstd}` implements this
// trait to expose its fields + per-class codegen accessors.

/// Backing-stream surface used by [`CompressionStreamImpl`] (zlib / brotli / zstd
/// `Context` types).
pub(crate) trait CompressionContext: Send + 'static {
    fn set_flush(&mut self, flush: i32);
    fn flush_value_is_valid(flush: u32) -> bool;
    fn do_work(&mut self, input: &[u8], out: BorrowedCursor<'_, u8>);
    fn reset(&mut self) -> Result<(), Error>;
    /// `[avail_out, avail_in]`, the order `_writeState` holds them in, or why `do_work` failed.
    fn write_result(&self) -> Result<[u32; 2], Error>;
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
}

impl<C> Stream<C> {
    pub(crate) fn new(context: C) -> Box<Self> {
        Box::new(Self {
            context,
            input_copy: InputCopy::default(),
        })
    }
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
}

impl<T: CompressionStreamImpl> JobContext for PendingWrite<T> {
    type OffThread = Self;
    type Js = StrongWrapper<T>;

    /// The handle needs its stream back, and the callbacks carry their own context.
    const OUTLIVES_SCRIPT: bool = true;

    fn run(write: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        if done.ticket().script_allowed() {
            let (input, out) = write.buffers.slices(&write.stream.input_copy);
            let mut out = BorrowedBuf::from(out);
            write.stream.context.do_work(input, out.unfilled());
        }
        Some(done)
    }

    fn then(write: Self, handle: StrongWrapper<T>, cx: &JsThread<'_>) -> JsResult<()> {
        let (global, this, this_value) = (handle.global(), handle.payload(), handle.to_js());
        let Self {
            mut stream,
            buffers,
        } = write;

        drop(buffers);
        T::pending_input_set_cached(this_value, global, JSValue::ZERO);
        T::pending_output_set_cached(this_value, global, JSValue::ZERO);

        let result = stream.context.write_result();
        // The copy is only read again if some input is unconsumed, because JS then resends it.
        if let Ok([_, 0]) = result {
            stream.input_copy = InputCopy::default();
        }
        this.stream().set(Some(stream));

        match result {
            Ok(result) => T::flush_write_result(global, this_value, result),
            Err(err) => {
                this.emit_error(global, this_value, &err);
                return Ok(());
            }
        }

        // A handle whose `init()` was never called has no write callback.
        if let Some(write_callback) = T::write_callback_get_cached(this_value) {
            cx.vm().event_loop().run_callback(
                bun_event_loop::ContextId::NONE,
                write_callback,
                global,
                this_value,
                &[],
            );
        }

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
    #[inline]
    fn flush_write_result(global: &JSGlobalObject, this_value: JSValue, result: [u32; 2]) {
        let Some(write_result_value) = Self::write_result_get_cached(this_value) else {
            return;
        };
        if !write_result_value.is_cell() {
            return;
        }
        let Some(mut write_result_buf) = write_result_value.as_array_buffer(global) else {
            return;
        };
        let write_result = write_result_buf.as_u32();
        if write_result.len() < 2 {
            return;
        }
        write_result[..2].copy_from_slice(&result.map(bun_core::Unaligned::new));
    }

    fn pending_close(&self) -> &Cell<bool>;
    fn closed(&self) -> &Cell<bool>;

    // Per-class codegen (`T.js.*` cached-property accessors).
    fn write_result_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn write_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
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

        let (in_off, in_len): (u32, u32) = if in_js.is_null() {
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
            let (in_off, in_len) = (jsv_to_u32(in_off.to_js()), jsv_to_u32(in_len.to_js()));
            if in_buf.byte_len < in_off as usize + in_len as usize {
                return Err(global_this
                    .err(
                        ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "in_off + in_len ({}) exceeds input buffer length ({})",
                            in_off as usize + in_len as usize,
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
        let out_off: u32 = jsv_to_u32(out_off.to_js());
        let out_len: u32 = jsv_to_u32(out_len.to_js());
        if out_buf.byte_len < out_off as usize + out_len as usize {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "out_off + out_len ({}) exceeds output buffer length ({})",
                        out_off as usize + out_len as usize,
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
            in_off as usize..in_off as usize + in_len as usize,
            out_js,
            out_off as usize..out_off as usize + out_len as usize,
            &mut stream.input_copy,
        )?;
        stream
            .context
            .set_flush(i32::try_from(flush).expect("int cast"));

        Self::pending_input_set_cached(this_value.to_js(), global_this, in_js);
        Self::pending_output_set_cached(this_value.to_js(), global_this, out_js);

        Job::<PendingWrite<Self>>::schedule(
            &global_this.js_thread(global_this.bun_vm().root_context()),
            PendingWrite {
                stream: ScopeGuard::into_inner(stream),
                // SAFETY: the job roots the handle, whose fields root both buffers until `then`
                // has dropped this: no other write sets them while the job has the stream. A job
                // is dropped on the JS thread, and `run` makes no reference to the bytes.
                buffers: unsafe { ThreadIsolated::new(buffers) },
            },
            StrongWrapper::new(this_value, global_this),
        );

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
            let (in_off, in_len) = (jsv_to_u32(in_off.to_js()), jsv_to_u32(in_len.to_js()));
            if in_buf.byte_len < in_off as usize + in_len as usize {
                return Err(global_this
                    .err(
                        ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "in_off + in_len ({}) exceeds input buffer length ({})",
                            in_off as usize + in_len as usize,
                            in_buf.byte_len,
                        ),
                    )
                    .throw());
            }
            in_buf.narrow(in_off as usize, in_len as usize);
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
        let out_off: u32 = jsv_to_u32(out_off.to_js());
        let out_len: u32 = jsv_to_u32(out_len.to_js());
        if out_buf.byte_len < out_off as usize + out_len as usize {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "out_off + out_len ({}) exceeds output buffer length ({})",
                        out_off as usize + out_len as usize,
                        out_buf.byte_len,
                    ),
                )
                .throw());
        }
        out_buf.narrow(out_off as usize, out_len as usize);
        throw_if_overlapping(global_this, &in_buf, &out_buf)?;

        let mut stream = self.borrow_idle_stream(global_this)?;
        stream
            .context
            .set_flush(i32::try_from(flush).expect("int cast"));
        let mut out = BorrowedBuf::from(out_buf.byte_slice_mut());
        stream.context.do_work(in_buf.byte_slice(), out.unfilled());
        let result = stream.context.write_result();
        drop(stream);

        match result {
            Ok(result) => Self::flush_write_result(global_this, this_value.to_js(), result),
            Err(err) => self.emit_error(global_this, this_value.to_js(), &err),
        }
        Ok(())
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
        let result = stream.context.reset();
        stream.input_copy = InputCopy::default();
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
        drop(stream);
    }

    /// The callback can re-enter any member, so the stream has to be back in its cell.
    fn emit_error(&self, global_this: &JSGlobalObject, this_value: JSValue, err_: &Error) {
        let Ok(msg_value) = bun_string_jsc::create_utf8_for_js(global_this, err_.msg.to_bytes())
        else {
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
