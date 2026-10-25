use core::cell::Cell;
use core::ffi::{c_char, c_int};
use core::ptr::NonNull;

use bun_ptr::{ParentRef, RefPtr};

use bun_event_loop::Taskable;
use bun_io::KeepAlive;
use bun_jsc::ConcurrentTask::{ConcurrentTask, Task};
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, ErrorCode, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional, WorkPoolTask,
};
use bun_threading::work_pool::WorkPool;

bun_output::declare_scope!(zlib, hidden);

// ─── type defs ────────────────────────────────────────────────────────────

#[derive(Default)]
pub(crate) struct CountedKeepAlive {
    pub(crate) keep_alive: KeepAlive,
    pub(crate) ref_count: u32,
}

impl Drop for CountedKeepAlive {
    fn drop(&mut self) {
        self.keep_alive.disable();
    }
}

/// `msg` / `code` are nullable NUL-terminated C strings.
/// Kept as raw `*const c_char` (not `&'static str`) because zlib (`z_stream.msg`)
/// and zstd (`ZSTD_getErrorString`) hand back runtime C pointers.
#[derive(Clone, Copy)]
pub(crate) struct Error {
    pub(crate) msg: *const c_char,
    pub(crate) err: c_int,
    pub(crate) code: *const c_char,
}

impl Error {
    pub(crate) const OK: Error = Error {
        msg: core::ptr::null(),
        err: 0,
        code: core::ptr::null(),
    };

    #[inline]
    pub(crate) const fn ok() -> Error {
        Self::OK
    }

    pub(crate) const fn init(msg: *const c_char, err: c_int, code: *const c_char) -> Error {
        Error { msg, err, code }
    }

    pub(crate) fn is_error(&self) -> bool {
        !self.msg.is_null()
    }
}

// ─── local shims (upstream-crate gaps) ────────────────────────────────────

/// Local `JSValue::toU32` shim — `bun_jsc::JSValue` doesn't expose `to_u32()`
/// in this crate's view yet.
#[inline]
fn jsv_to_u32(v: JSValue) -> u32 {
    v.as_number() as u32
}

impl CountedKeepAlive {
    fn ref_(&mut self, _vm: &VirtualMachine) {
        if self.ref_count == 0 {
            self.keep_alive.ref_(bun_io::js_vm_ctx());
        }
        self.ref_count += 1;
    }

    fn unref(&mut self, _vm: &VirtualMachine) {
        self.ref_count -= 1;
        if self.ref_count == 0 {
            self.keep_alive.unref(bun_io::js_vm_ctx());
        }
    }
}

pub(crate) fn crc32(data: &[u8], value: u32) -> u32 {
    bun_zlib::crc32_bytes(value, data)
}

// ─── CompressionStream mixin trait ────────────────────────────────────────
// Each `Native{Zlib,Brotli,Zstd}` implements this
// trait to expose its fields + per-class codegen accessors.

/// Backing-stream surface used by [`CompressionStreamImpl`] (zlib / brotli / zstd
/// `Context` types).
pub(crate) trait CompressionContext {
    fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>);
    fn set_flush(&mut self, flush: i32);
    fn flush_value_is_valid(flush: u32) -> bool;
    fn do_work(&mut self);
    fn reset(&mut self) -> Error;
    fn close(&mut self);
    fn get_error_info(&mut self) -> Error;
    fn update_write_result(&mut self, avail_in: &mut u32, avail_out: &mut u32);
}

/// Stores a stream's copy of an input that `can_be_freed_while_pinned`.
/// Empty when the stream has no copy.
#[derive(Default)]
pub(crate) struct InputCopy {
    bytes: Vec<u8>,
    /// The copied view's pointer and length. Only compared, never dereferenced.
    from: (*const u8, usize),
}

pub(crate) trait CompressionStreamImpl:
    Sized + Taskable + bun_ptr::CellRefCounted + bun_ptr::AnyRefCounted + 'static
{
    type Stream: CompressionContext;

    /// The global outlives this payload.
    /// Implementations store a `BackRef<JSGlobalObject>`; the single unsafe
    /// deref lives in `BackRef::get`, so callers and impls are safe.
    fn global_this(&self) -> &JSGlobalObject;
    /// The in-flight write's ticket: set in `write` before the task leaves
    /// the thread, moved out by the pool thread before it posts back.
    fn ticket(&self) -> &Cell<Option<bun_jsc::Ticket>>;
    fn stream(&self) -> &JsCell<Self::Stream>;

    /// Write `(avail_out, avail_in)` into the JS-owned 2-element `Uint32Array`
    /// (`this._writeState`), re-resolving the cached `writeResult` typed array
    /// on every call so a detached, resized, or replaced backing store is
    /// skipped instead of written through a stale pointer.
    #[inline]
    fn flush_write_result(&self, global: &JSGlobalObject, this_value: JSValue) {
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
        let (r0, r1) = write_result.split_at_mut(1);
        self.stream()
            .with_mut(|s| s.update_write_result(&mut r1[0], &mut r0[0]));
    }

    fn poll_ref(&self) -> &JsCell<CountedKeepAlive>;
    fn this_value(&self) -> &JsCell<StrongOptional>;
    fn task(&self) -> &JsCell<WorkPoolTask>;
    fn write_in_progress(&self) -> &Cell<bool>;
    fn pinned_buffers(&self) -> &Cell<u8>;
    /// Returns the copy that [`borrow_input_copy`](Self::borrow_input_copy) fills and reuses.
    fn input_copy(&self) -> &JsCell<InputCopy>;
    fn pending_close(&self) -> &Cell<bool>;
    fn closed(&self) -> &Cell<bool>;

    /// Recover `*mut Self` from the embedded `WorkPoolTask`.
    /// SAFETY: caller guarantees `task` points at the `task` field of a live `Self`.
    unsafe fn from_task(task: *mut WorkPoolTask) -> *mut Self;

    // Per-class codegen (`T.js.*` cached-property accessors).
    fn write_result_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn write_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn error_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn error_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue);
    fn pending_input_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn pending_output_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
    fn pending_input_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn pending_output_get_cached(this_value: JSValue) -> Option<JSValue>;

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

    /// Rejects a call on a handle that cannot accept a new operation: an async
    /// write still holds `&mut Context` on a worker thread, a pending close is
    /// about to tear it down, or a closed one already did (`mode` is `NONE`).
    fn throw_unless_idle(&self, global_this: &JSGlobalObject) -> JsResult<()> {
        if self.write_in_progress().get() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!("Write already in progress"),
                )
                .throw());
        }
        if self.pending_close().get() {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Pending close"))
                .throw());
        }
        if self.closed().get() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!("zlib binding closed"),
                )
                .throw());
        }
        Ok(())
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
        let (global_this, this_value) = (cx.global(), this_value.to_js());
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
        if !<Self::Stream as CompressionContext>::flush_value_is_valid(flush) {
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

        self.throw_unless_idle(global_this)?;
        // Pin both buffers before mutating any state: materializing a
        // FastTypedArray's backing store can fail on OOM, and failing here
        // leaves nothing to unwind.
        let in_buf: Option<jsc::ArrayBuffer> = if in_js.is_null() {
            None
        } else {
            let Some(buf) = in_js.as_pinned_arraybuffer(global_this) else {
                return Err(global_this.throw_out_of_memory());
            };
            Some(buf)
        };
        let Some(mut out_buf) = out_js.as_pinned_arraybuffer(global_this) else {
            if let Some(buf) = &in_buf {
                buf.unpin();
            }
            return Err(global_this.throw_out_of_memory());
        };
        let mut in_: Option<&[u8]> = in_buf
            .as_ref()
            .map(|b| &b.byte_slice()[in_off as usize..in_off as usize + in_len as usize]);
        // The pool thread reads the input after this call returns, so give it
        // a copy if the pin can't keep the bytes mapped.
        if let Some(buf) = in_buf.as_ref().filter(|b| b.can_be_freed_while_pinned()) {
            let Some(copied) = self.borrow_input_copy(
                global_this,
                buf.byte_slice(),
                in_off as usize,
                in_len as usize,
            ) else {
                buf.unpin();
                out_buf.unpin();
                return Err(global_this.throw_out_of_memory());
            };
            in_ = Some(copied);
        }
        self.pinned_buffers().set(
            u8::from(in_buf.as_ref().is_some_and(|b| b.pinned)) | (u8::from(out_buf.pinned) << 1),
        );
        let out: Option<&mut [u8]> = Some(
            &mut out_buf.byte_slice_mut()[out_off as usize..out_off as usize + out_len as usize],
        );

        self.write_in_progress().set(true);
        self.ref_();

        Self::pending_input_set_cached(this_value, global_this, in_js);
        Self::pending_output_set_cached(this_value, global_this, out_js);

        self.stream().with_mut(|s| {
            s.set_buffers(in_, out);
            s.set_flush(i32::try_from(flush).expect("int cast"));
        });

        // Only create the strong handle when we have a pending write
        // And make sure to clear it when we are done.
        self.this_value()
            .with_mut(|v| v.set(global_this, this_value));

        let vm = global_this.bun_vm();
        self.task().set(WorkPoolTask {
            node: Default::default(),
            callback: async_job_run_task::<Self>,
        });
        self.poll_ref().with_mut(|p| p.ref_(vm));
        self.ticket().set(Some(vm.ticket()));
        WorkPool::schedule(self.task().as_ptr());

        Ok(())
    }

    /// Returns `view[in_off..in_off + in_len]` from the stream's copy of `view`, or
    /// `None` if the copy can't be allocated.
    ///
    /// `processCallback` resends the same view with a larger `in_off` for each output
    /// chunk, so the whole view is copied once and reused until a different view arrives.
    fn borrow_input_copy(
        &self,
        global: &JSGlobalObject,
        view: &[u8],
        in_off: usize,
        in_len: usize,
    ) -> Option<&[u8]> {
        // Once the input is consumed, each further output chunk is a write with no input.
        if in_len == 0 {
            return Some(&[]);
        }
        self.input_copy().with_mut(|copy| {
            if copy.from != (view.as_ptr(), view.len()) {
                copy.from = (core::ptr::null(), 0);
                copy.bytes.clear();
                if copy.bytes.try_reserve_exact(view.len()).is_err() {
                    return None;
                }
                copy.bytes.extend_from_slice(view);
                copy.from = (view.as_ptr(), view.len());
                global.vm().report_extra_memory(copy.bytes.len());
            }
            let chunk = copy.bytes.get(in_off..in_off + in_len)?;
            // SAFETY: `write()`, `reset()` and `close()` throw or are deferred while a write
            // is in progress, and the completion frees the copy only after the input is
            // consumed, so the bytes outlive the job that reads them.
            Some(unsafe { core::slice::from_raw_parts(chunk.as_ptr(), chunk.len()) })
        })
    }

    /// Releases the pins `write()` took; the cached slots keep rooting the values either way.
    fn unpin_pending_buffers(&self, this_value: JSValue) {
        let pinned = self.pinned_buffers().replace(0);
        if pinned & 1 != 0 {
            if let Some(value) = Self::pending_input_get_cached(this_value) {
                value.unpin_array_buffer();
            }
        }
        if pinned & 2 != 0 {
            if let Some(value) = Self::pending_output_get_cached(this_value) {
                value.unpin_array_buffer();
            }
        }
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
        let (global_this, this_value) = (cx.global(), this_value.to_js());
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
        if !<Self::Stream as CompressionContext>::flush_value_is_valid(flush) {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Invalid flush value"),
                )
                .throw());
        }

        // Hoisted so `in_` can borrow it past the `else` arm (mirrors `out_buf`).
        let in_buf: jsc::ArrayBuffer;
        let in_: Option<&[u8]> = if in_js.is_null() {
            // just a flush
            None
        } else {
            in_buf = match in_js.as_array_buffer(global_this) {
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
            // Bounds checked above; `byte_slice` is the safe accessor for the JS
            // ArrayBuffer's backing store (rooted via `in_js` on the call stack).
            Some(&in_buf.byte_slice()[in_off as usize..in_off as usize + in_len as usize])
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
        // Bounds checked above; `byte_slice_mut` is the safe accessor for the JS
        // ArrayBuffer's backing store (rooted via `out_js` on the call stack).
        let out: Option<&mut [u8]> = Some(
            &mut out_buf.byte_slice_mut()[out_off as usize..out_off as usize + out_len as usize],
        );

        self.throw_unless_idle(global_this)?;
        self.write_in_progress().set(true);
        // Can never hit zero while the JS wrapper's +1 is live (we are
        // synchronously inside a host-fn invoked through that wrapper).
        // SAFETY: `self` is the live payload.
        let _guard = unsafe { RefPtr::init_ref(std::ptr::from_ref::<Self>(self).cast_mut()) };

        self.stream().with_mut(|s| {
            s.set_buffers(in_, out);
            s.set_flush(i32::try_from(flush).expect("int cast"));
        });

        self.stream().with_mut(|s| s.do_work());
        if self.check_error(global_this, this_value) {
            self.flush_write_result(global_this, this_value);
            self.write_in_progress().set(false);
        }
        Ok(())
    }

    fn reset(&self, this_value: JsWrapper<'_, Self>, cx: &mut JsScope<'_>) -> JsResult<()> {
        let global_this = cx.global();
        // reset() destroys and re-creates the brotli/zstd encoder state (or
        // mutates the z_stream). Doing so while an async write is running on
        // the threadpool would be a use-after-free / data race, so node throws
        // a plain Error here rather than touching live state.
        if self.write_in_progress().get() {
            return Err(
                global_this.throw_value(global_this.create_error_instance(format_args!(
                    "Cannot reset zlib stream while a write is in progress"
                ))),
            );
        }
        if self.closed().get() {
            return Ok(());
        }
        let err = self.stream().with_mut(|s| s.reset());
        // Free the copy before `emit_error`. Its callback can call `write()`, which makes a copy the pool thread reads.
        self.input_copy().set(InputCopy::default());
        if err.is_error() {
            self.emit_error(global_this, this_value.to_js(), err);
        }
        Ok(())
    }

    fn close(&self) {
        if self.write_in_progress().get() {
            self.pending_close().set(true);
            return;
        }
        self.pending_close().set(false);
        self.closed().set(true);
        self.this_value().with_mut(|v| v.deinit());
        self.stream().with_mut(|s| s.close());
        self.input_copy().set(InputCopy::default());
    }

    /// returns true if no error was detected/emitted
    fn check_error(&self, global_this: &JSGlobalObject, this_value: JSValue) -> bool {
        let err = self.stream().with_mut(|s| s.get_error_info());
        if !err.is_error() {
            return true;
        }
        self.emit_error(global_this, this_value, err);
        false
    }

    fn emit_error(&self, global_this: &JSGlobalObject, this_value: JSValue, err_: Error) {
        // `&Self` over `Cell`/`JsCell`-backed fields — the onerror
        // `run_callback` below runs user JS which can re-enter via a fresh
        // `&Self` from the wrapper (e.g. `write()` flips
        // `write_in_progress` / `pending_*`). Interior mutability makes the
        // re-entry sound and the post-callback reads observe the updated
        // values without `noalias`-laundering.

        // Clear write_in_progress *before* invoking the onerror callback.
        // The callback may re-enter write(), which sets write_in_progress=true
        // and schedules a WorkPool task. If we cleared the flag after the
        // callback, we would clobber that state and close()
        // below could free the native zlib/brotli/zstd state while a task is
        // still queued, leading to a use-after-free when the worker thread
        // runs doWork().
        self.write_in_progress().set(false);

        let msg_bytes: &[u8] = if err_.msg.is_null() {
            b""
        } else {
            // SAFETY: `err_.msg` is non-null (checked above) and points at a NUL-terminated
            // C string (static literal or zlib/zstd-owned buffer valid for this call).
            unsafe { bun_core::ffi::cstr(err_.msg) }.to_bytes()
        };
        let msg_value = match bun_string_jsc::create_utf8_for_js(global_this, msg_bytes) {
            Ok(v) => v,
            Err(_) => return,
        };
        let err_value: JSValue = JSValue::js_number(f64::from(err_.err));
        let code_bytes: &[u8] = if err_.code.is_null() {
            b""
        } else {
            // SAFETY: `err_.code` is non-null (checked above) and points at a NUL-terminated
            // C string (static literal or zlib/zstd-owned buffer valid for this call).
            unsafe { bun_core::ffi::cstr(err_.code) }.to_bytes()
        };
        let code_value = match bun_string_jsc::create_utf8_for_js(global_this, code_bytes) {
            Ok(v) => v,
            Err(_) => return,
        };

        // The `zlib.ts` wrapper installs `onerror` right after construction,
        // but a handle driven directly has none; there is nobody to notify.
        // The pending close handling below still runs either way.
        if let Some(callback) = Self::error_callback_get_cached(this_value) {
            let vm = global_this.bun_vm();
            vm.event_loop_ref().run_callback(
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

// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
// struct-init site in `write` above.
fn async_job_run_task<T: CompressionStreamImpl>(task: *mut WorkPoolTask) {
    // SAFETY: `task` points to `T.task` — only ever invoked by the thread
    // pool against a `T` scheduled in `write`, so provenance covers the
    // full `T` allocation. Recover *mut T via container_of
    // (`CompressionStreamImpl::from_task`). The task field is a
    // `JsCell<WorkPoolTask>` — `#[repr(transparent)]` over the value, so
    // `offset_of!(T, task)` is the value's offset.
    let this: *mut T = unsafe { T::from_task(task) };
    async_job_run(this);
}

fn async_job_run<T: CompressionStreamImpl>(this: *mut T) {
    // `this` is the live heap payload (kept alive by the `ref_()` in `write()`).
    let this_ref = ParentRef::from(NonNull::new(this).expect("async_job_run: this"));

    // The stream reads and writes JS ArrayBuffer backing stores, alive
    // while the ticket is held; skip the work once the VM is stopping.
    // Either way the completion goes back to the JS thread, which finishes
    // or releases the write there.
    let ticket = this_ref
        .ticket()
        .take()
        .expect("scheduled zlib write holds a ticket");
    if ticket.script_allowed() {
        this_ref.stream().with_mut(|s| s.do_work());
    }
    // `this` may be freed by the JS thread the moment this is queued.
    ticket.post(ConcurrentTask::create(Task::init(this)));
}

/// VM teardown, JS thread, heap alive: a completion that was queued but
/// will not run. The cleanup half of `run_from_js_thread`, no callbacks.
///
/// # Safety
/// As [`run_from_js_thread`].
pub(crate) unsafe fn release_unrun<T: CompressionStreamImpl>(this_ptr: *mut T) {
    let this = ParentRef::from(NonNull::new(this_ptr).expect("release_unrun: this"));
    let global: &JSGlobalObject = this.global_this();
    let vm = global.bun_vm();
    this.write_in_progress().set(false);
    if let Some(this_value) = this.this_value().with_mut(|v| v.try_swap()) {
        this.unpin_pending_buffers(this_value);
    }
    this.poll_ref().with_mut(|p| p.unref(vm));
    // SAFETY: fn contract — the write's ref.
    unsafe { T::deref(this_ptr) };
}

/// Dispatched from `dispatch.rs` when the worker-thread `do_work()` posts
/// the completion task back to the JS thread.
///
/// R-2: takes `*mut T` (full allocation provenance from `Task.ptr`) so the
/// trailing `T::deref(this_ptr)` may free the box if it hits zero. All
/// field access goes through `&*this_ptr` and the `&self` accessor surface;
/// every accessed field is `Cell`/`JsCell`-backed so re-entry via the
/// onerror / write callbacks is sound (no `noalias` to violate, no
/// `black_box` launders needed).
///
/// SAFETY: `this_ptr` is the live heap payload; the matching
/// `ref_()` in `write()` keeps it alive until the trailing `deref()`.
pub(crate) unsafe fn run_from_js_thread<T: CompressionStreamImpl>(this_ptr: *mut T) {
    // See the fn-level contract.
    let this = ParentRef::from(NonNull::new(this_ptr).expect("run_from_js_thread: this"));
    let global: &JSGlobalObject = this.global_this();
    let vm = global.bun_vm();
    // `this.deref()` and `this.poll_ref.unref(vm)` must run on every
    // return path; we call them explicitly.

    this.write_in_progress().set(false);

    // Clear the strong handle before we call any callbacks.
    let Some(this_value) = this.this_value().with_mut(|v| v.try_swap()) else {
        bun_output::scoped_log!(zlib, "this_value is null in runFromJSThread");
        this.poll_ref().with_mut(|p| p.unref(vm));
        // SAFETY: matching `ref_()` in `write()`; `this_ptr` is the heap
        // payload and is not accessed after this call.
        unsafe { T::deref(this_ptr) };
        return;
    };

    this_value.ensure_still_alive();

    this.unpin_pending_buffers(this_value);
    T::pending_input_set_cached(this_value, global, JSValue::ZERO);
    T::pending_output_set_cached(this_value, global, JSValue::ZERO);

    if !this.check_error(global, this_value) {
        this.poll_ref().with_mut(|p| p.unref(vm));
        // SAFETY: see above.
        unsafe { T::deref(this_ptr) };
        return;
    }

    this.flush_write_result(global, this_value);
    this_value.ensure_still_alive();

    // The copy is only read again if some input is unconsumed, because JS then resends it.
    let (mut avail_in, mut avail_out) = (0, 0);
    this.stream()
        .with_mut(|s| s.update_write_result(&mut avail_in, &mut avail_out));
    if avail_in == 0 {
        this.input_copy().set(InputCopy::default());
    }

    // `init()` caches the JS write callback; a handle whose `init()` was
    // never called has none, so there is nothing to notify.
    if let Some(write_callback) = T::write_callback_get_cached(this_value) {
        vm.event_loop_ref().run_callback(
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

    this.poll_ref().with_mut(|p| p.unref(vm));
    // SAFETY: matching `ref_()` in `write()`; `this_ptr` is the heap payload
    // and is not accessed after this call.
    unsafe { T::deref(this_ptr) };
}

/// Implements [`CompressionContext`] for a `Context` type and
/// [`CompressionStreamImpl`] for its owning `Native*` struct by delegating to
/// the inherent methods / fields that already exist on each.
///
/// All three `Native{Zlib,Brotli,Zstd}` structs share the exact field layout
/// (`global_this`, `stream`, `poll_ref`, `this_value`,
/// `write_in_progress`, `pending_close`, `closed`, `task`,
/// `ref_count`), so the macro can stamp the impls uniformly.
///
/// `$js` is the class's generated module, which has the accessors for its internal fields.
#[macro_export]
#[doc(hidden)]
macro_rules! __impl_compression_stream {
    ($native:ident, $ctx:ty, $js:ident) => {
        impl ::bun_event_loop::Taskable for $native {
            const TAG: ::bun_event_loop::TaskTag = ::bun_event_loop::task_tag::$native;
            /// An async write whose completion will not run: unpin, unref, drop
            /// the write's ref — no callbacks.
            unsafe fn release_unrun(this: *mut Self) {
                // SAFETY: fn contract — the stream the pool posted (write's ref held).
                unsafe { $crate::node::node_zlib_binding::release_unrun(this) }
            }
            /// The write always completes (its buffers are unpinned); the callbacks it reports to carry
            /// the async context of the script that set them.
            unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
                bun_event_loop::ContextId::NONE
            }
        }

        use $crate::generated_bindgen::node_zlib_binding::$js as js;

        impl $crate::node::node_zlib_binding::CompressionContext for $ctx {
            #[inline]
            fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
                Self::set_buffers(self, in_, out)
            }
            #[inline]
            fn set_flush(&mut self, flush: i32) {
                Self::set_flush(self, flush)
            }
            #[inline]
            fn flush_value_is_valid(flush: u32) -> bool {
                Self::flush_value_is_valid(flush)
            }
            #[inline]
            fn do_work(&mut self) {
                Self::do_work(self)
            }
            #[inline]
            fn reset(&mut self) -> $crate::node::node_zlib_binding::Error {
                Self::reset(self)
            }
            #[inline]
            fn close(&mut self) {
                Self::close(self)
            }
            #[inline]
            fn get_error_info(&mut self) -> $crate::node::node_zlib_binding::Error {
                Self::get_error_info(self)
            }
            #[inline]
            fn update_write_result(&mut self, avail_in: &mut u32, avail_out: &mut u32) {
                Self::update_write_result(self, avail_in, avail_out)
            }
        }

        impl $crate::node::node_zlib_binding::CompressionStreamImpl for $native {
            type Stream = $ctx;

            #[inline]
            fn global_this(&self) -> &::bun_jsc::JSGlobalObject {
                self.global_this.get()
            }
            #[inline]
            fn ticket(&self) -> &::core::cell::Cell<Option<::bun_jsc::Ticket>> {
                &self.ticket
            }
            #[inline]
            fn stream(&self) -> &::bun_jsc::JsCell<Self::Stream> {
                &self.stream
            }
            #[inline]
            fn poll_ref(
                &self,
            ) -> &::bun_jsc::JsCell<$crate::node::node_zlib_binding::CountedKeepAlive> {
                &self.poll_ref
            }
            #[inline]
            fn this_value(&self) -> &::bun_jsc::JsCell<::bun_jsc::StrongOptional> {
                &self.this_value
            }
            #[inline]
            fn task(&self) -> &::bun_jsc::JsCell<::bun_jsc::WorkPoolTask> {
                &self.task
            }
            #[inline]
            fn write_in_progress(&self) -> &::core::cell::Cell<bool> {
                &self.write_in_progress
            }
            #[inline]
            fn pinned_buffers(&self) -> &::core::cell::Cell<u8> {
                &self.pinned_buffers
            }
            #[inline]
            fn input_copy(&self) -> &::bun_jsc::JsCell<$crate::node::node_zlib_binding::InputCopy> {
                &self.input_copy
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
            unsafe fn from_task(task: *mut ::bun_jsc::WorkPoolTask) -> *mut Self {
                // SAFETY: `task` points at the `task` field of a live `Self`;
                // `from_field_ptr!`
                // computes the byte offset via `offset_of!(Self, task)`.
                unsafe { ::bun_core::from_field_ptr!(Self, task, task) }
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
            #[inline]
            fn pending_input_get_cached(
                this_value: ::bun_jsc::JSValue,
            ) -> Option<::bun_jsc::JSValue> {
                js::pending_input_get_cached(this_value)
            }
            #[inline]
            fn pending_output_get_cached(
                this_value: ::bun_jsc::JSValue,
            ) -> Option<::bun_jsc::JSValue> {
                js::pending_output_get_cached(this_value)
            }
        }
    };
}
