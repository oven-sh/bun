use core::cell::Cell;
use core::sync::atomic::{AtomicI32, Ordering};

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{self, WriteResult, WriteStatus};
use bun_jsc::JsCell;
use bun_ptr::RefPtr;
use bun_sys::{self as sys, Fd, FdExt as _};

use crate::api::bun::process::Status as SpawnStatus;
use crate::webcore::jsc::{CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult};
use crate::webcore::readable_stream::{self, ReadableStream};
use crate::webcore::{self, AutoFlusher, PathOrFileDescriptor, streams};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::UvHandle as _;

bun_core::declare_scope!(FileSink, visible);

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

// R-2 (`&mut self` host-fn re-entrancy → noalias UB): JS-reachable host-fns
// take `&self` and mutate via `Cell`/`JsCell`. Paths that may drop the last
// ref (`finalize`, the PipeWriter IO callbacks, the promise handlers) take the
// canonical `*mut FileSink` instead of any receiver — see the `borrow = ptr`
// note on the `impl_streaming_writer_parent!` invocation below.
#[derive(bun_ptr::CellRefCounted)]
pub struct FileSink {
    ref_count: Cell<u32>,
    pub(crate) writer: JsCell<IOWriter>,
    pub(crate) event_loop_handle: EventLoopHandle,
    pub(crate) written: Cell<usize>,
    pub(crate) pending: JsCell<streams::WritablePending>,
    pub(crate) source: JsCell<streams::SourceHandle>,
    pub(crate) done: Cell<bool>,
    pub(crate) started: Cell<bool>,
    pub(crate) must_be_kept_alive_until_eof: Cell<bool>,
    /// `to_result` returned `Backpressure` to a ByteStream; drain callbacks resume it.
    pub(crate) source_pending_pull: Cell<bool>,

    // TODO: these fields are duplicated on writer()
    // we should not duplicate these fields...
    pub(crate) pollable: Cell<bool>,
    pub(crate) nonblocking: Cell<bool>,
    pub(crate) force_sync: Cell<bool>,

    pub(crate) is_socket: Cell<bool>,
    pub(crate) fd: Cell<Fd>,

    pub(crate) auto_flusher: JsCell<AutoFlusher>,
    pub(crate) run_pending_later: FlushPendingTask,

    /// Currently, only used when `stdin` in `Bun.spawn` is a ReadableStream.
    pub(crate) readable_stream: JsCell<readable_stream::Strong>,

    /// `pipe_stream`: settled from `on_close` with `stream_bytes`, or with the error that ended
    /// the stream or the write.
    stream_done: JsCell<bun_jsc::JSPromiseStrong>,
    stream_error: JsCell<Option<streams::StreamError>>,
    /// Bytes accepted since `pipe_stream` (`written` counts buffered bytes again when flushed).
    pub(crate) stream_bytes: Cell<Option<u64>>,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub(crate) js_sink_ref: JsCell<bun_jsc::strong::Optional>,
}

// `bun.ptr.RefCount(FileSink, "ref_count", deinit, .{})` — intrusive single-thread
// refcount derived via #[derive(CellRefCounted)] above. `*FileSink` crosses FFI
// (JSSink wrapper, `@fieldParentPtr`, `asPromisePtr`), so this stays intrusive
// rather than `Rc<T>`.

/// Count of live native FileSink instances. Incremented at allocation,
/// decremented in `deinit`. Exposed to tests via `bun:internal-for-testing`
/// so leak tests can detect native FileSink leaks that are invisible to
/// `heapStats()` (which only counts JS wrapper objects).
pub(crate) static LIVE_COUNT: AtomicI32 = AtomicI32::new(0);

pub mod testing_apis {
    use super::*;

    pub(crate) fn file_sink_live_count(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::js_number(LIVE_COUNT.load(Ordering::Relaxed) as f64))
    }
}
// `generated_js2native.rs` snake-cases `TestingAPIs` as `testing_ap_is`
// (acronym splitter treats `AP|Is` as two words); alias so both resolve.
pub use testing_apis as testing_ap_is;

/// `bun_sys` does not yet export
/// an isPollable helper, so re-derive it locally from `S_IFMT`. Windows always
/// returns `false`.
fn is_pollable(mode: sys::Mode) -> bool {
    #[cfg(windows)]
    {
        let _ = mode;
        false
    }
    #[cfg(unix)]
    {
        let fmt = mode & (libc::S_IFMT as sys::Mode);
        fmt == (libc::S_IFIFO as sys::Mode) || fmt == (libc::S_IFSOCK as sys::Mode)
    }
}

/// Streaming-writer vtable wiring: the
/// parent type implements the handler trait
/// (onClose / onWritable / onError / onWrite) directly.
pub type IOWriter = bun_io::StreamingWriter<FileSink>;
#[cfg(not(windows))]
pub(crate) type Poll = IOWriter;

// `StreamingWriter<P>` requires `P: PosixStreamingWriterParent` (POSIX) /
// `WindowsStreamingWriterParent` (Windows). The vtable methods forward to the
// FileSink state-machine handlers below.
//
// `borrow = ptr`: PipeWriter callbacks must NOT form `&FileSink`/`&mut
// FileSink` from the parent backref to dispatch the handler. The handler may
// drop the last intrusive ref mid-call (via `run_pending()` draining a
// promise, `writer.with_mut(|w| w.end()/w.close())` re-entering `on_close`,
// or the terminal `clear_keep_alive_ref()` → `FileSink::deref` →
// `deinit` → `bun_core::heap::take` = `Box::from_raw` → dealloc). A
// `&self`-derived `*mut FileSink` (the old `as_mut_ptr_for_rc` cast) carries
// only a SharedReadOnly Stacked-Borrows tag — deallocating through it is UB,
// and the compiler is then free to cache/reorder `*self` loads across those
// re-entrant freeing calls. A `&mut self`-derived ptr would instead place a Unique tag on
// the WHOLE FileSink (which embeds the writer), popping the writer's own
// `*mut Self` tag and tripping LLVM `noalias`. The fix: dispatch directly off
// the canonical `*mut FileSink` — the heap-allocation pointer with full
// write+dealloc provenance, the same one `init`/`create*` thread through
// `set_parent` and that the macro already holds raw before the call. The four
// callback methods + `run_pending`/`clear_keep_alive_ref` take `this: *mut
// FileSink` and only reborrow `(*this).field` per-statement (never holding any
// `&FileSink` across a re-entrant/freeing call). `ref_`/`deref` already take
// the raw ptr; `ref_` only touches `ref_count: Cell<u32>`.
bun_io::impl_streaming_writer_parent! {
    FileSink;
    poll_tag   = bun_io::posix_event_loop::poll_tag::FILE_SINK,
    borrow     = ptr,
    on_write   = on_write,
    on_error   = on_error,
    on_ready   = on_ready,
    on_close   = on_close,
    event_loop = |this| (*this).io_evtloop(),
    uws_loop   = |this| (*this).event_loop_handle.r#loop(),
    uv_loop    = |this| (*this).event_loop_handle.uv_loop(),
    ref_       = |this| (&*this).ref_(),
    deref      = |this| FileSink::deref(this),
}

pub struct Options {
    pub(crate) input_path: PathOrFileDescriptor,
    pub(crate) mode: bun_sys::Mode,
    /// `Bun.write(path, stream)`: replace the file's contents.
    pub(crate) truncate: bool,
    /// `Bun.write(path, stream)`: create missing parent directories.
    pub(crate) mkdirp: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            input_path: PathOrFileDescriptor::Fd(Fd::INVALID),
            mode: 0o664,
            truncate: false,
            mkdirp: false,
        }
    }
}

impl Options {
    pub(crate) fn flags(&self) -> i32 {
        let flags =
            bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY;
        if self.truncate {
            flags | bun_sys::O::TRUNC
        } else {
            flags
        }
    }
}

impl Drop for FileSink {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        if let Some(global) = self.js_global() {
            let vm = global.bun_vm().as_mut();
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self, vm);
        }
    }
}

impl FileSink {
    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
        self.writer.get().memory_cost()
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(
    _global: *mut JSGlobalObject,
    jsvalue: JSValue,
) {
    let Some(this_ptr) = JSSink::from_js(jsvalue) else {
        return;
    };
    // SAFETY: `from_js` returned a live `*mut JSSink<FileSink>` (= ThisSink); the
    // first field is `sink: FileSink`, so `&(*this_ptr).sink` recovers the
    // wrapped `*FileSink`.
    let this: &FileSink = unsafe { &(*this_ptr).sink };

    #[cfg(not(windows))]
    {
        this.force_sync.set(true);
        // SAFETY(JsCell): single-field write; does not call into JS.
        this.writer.with_mut(|w| w.force_sync = true);
        if this.fd.get() != Fd::INVALID {
            let _ = sys::update_nonblocking(this.fd.get(), false);
        }
    }
    #[cfg(windows)]
    {
        // SAFETY(JsCell): closure does not call into JS — pure libuv FFI.
        let did_set_blocking = this.writer.with_mut(|w| {
            if let Some(source) = w.source.as_mut() {
                match source {
                    bun_io::Source::Pipe(pipe) => {
                        // SAFETY: `pipe` is a live `Box<uv::Pipe>` owned by `writer.source`;
                        // `uv_pipe_t` is `#[repr(C)]` with `uv_stream_t` as its first field
                        // (libuv handle subtyping), so the pointer cast is valid.
                        let rc = unsafe {
                            uv::uv_stream_set_blocking(
                                (&mut **pipe) as *mut uv::Pipe as *mut uv::uv_stream_t,
                                1,
                            )
                        };
                        if rc == uv::ReturnCode::ZERO {
                            return true;
                        }
                    }
                    bun_io::Source::Tty(tty) => {
                        // SAFETY: `tty` is a live `BackRef<Tty>` (heap or static stdin tty);
                        // `Tty` (via its first field, `uv::uv_tty_t`) embeds `uv_stream_t` as
                        // its first member, so the cast is the libuv handle-subtype downcast.
                        let rc = unsafe {
                            uv::uv_stream_set_blocking(tty.as_ptr().cast::<uv::uv_stream_t>(), 1)
                        };
                        if rc == uv::ReturnCode::ZERO {
                            return true;
                        }
                    }
                    _ => {}
                }
            }
            false
        });
        if did_set_blocking {
            return;
        }

        // Fallback to WriteFile() if it fails.
        this.force_sync.set(true);
    }
}

/// `constructStdioWriteStream` just created a `process.stdout`/`process.stderr`
/// sink. Under `bun test --isolate` each test file's fresh global re-creates
/// these lazily over a new dup of the stdio fd (registered with the event
/// loop), and nothing ends the outgoing file's sink at the global swap — the
/// dups and their poll registrations accumulate per file, and a stale epoll
/// entry whose fd number gets reused over the same pipe makes a later
/// registration fail with EEXIST. Track the sink so
/// `stop_active_handles_for_test_isolation` ends it at the swap.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__trackProcessStdioSinkForTestIsolation(
    global: &JSGlobalObject,
    jsvalue: JSValue,
) {
    if !global.bun_vm().test_isolation_enabled {
        return;
    }
    let Some(this_ptr) = JSSink::from_js(jsvalue) else {
        return;
    };
    // SAFETY: `from_js` returned a live `*mut JSSink<FileSink>`; the wrapper is
    // `repr(transparent)` over `sink: FileSink`, so this recovers the canonical
    // `*mut FileSink`.
    let this: *mut FileSink = unsafe { &raw mut (*this_ptr).sink };
    // The registry's +1, released by `stop_tracked_stdio_sink`.
    // SAFETY: `this` is live — the JS wrapper holds its own +1.
    unsafe { (*this).ref_() };
    crate::jsc_hooks::ActiveHandle::ProcessStdioSink(core::ptr::NonNull::new(this).expect("sink"))
        .register();
}

impl FileSink {
    /// Ends a sink tracked by `ActiveHandle::ProcessStdioSink` (the
    /// `--isolate` global swap or VM teardown), flushing buffered output,
    /// closing the dup'd fd with its poll registration, and releasing the
    /// registration's +1.
    ///
    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` whose registration
    /// ref is still held; it must not be used after the call, which may free
    /// it.
    pub(crate) unsafe fn stop_tracked_stdio_sink(this: *mut FileSink) {
        // SAFETY: caller contract — the registry's +1 keeps `this` live until
        // the trailing `deref`, which is its last use.
        unsafe {
            let _ = (*this).end(None);
            FileSink::deref(this);
        }
    }
}

impl FileSink {
    /// `bun.spawn`'s subprocess exited while this `FileSink` was its stdin.
    ///
    /// Takes the canonical `*mut FileSink` (not `&mut self`): `writer.close()`
    /// re-enters `on_close` via the writer backref and `stream.cancel`/
    /// `run_pending` drain microtasks — any of which may drop the last ref and
    /// free `this`. A `&mut self` held across those calls would (a) carry a
    /// `noalias` LLVM attribute the re-entry violates and (b) place a Unique
    /// Stacked-Borrows tag on the whole struct, popping the writer's own
    /// `*mut Self` tag. The four PipeWriter callbacks have the same shape.
    ///
    /// # Safety
    /// `this` must be the canonical heap-allocation pointer (the one threaded
    /// through `set_parent` by `init`/`create*`), live, with write+dealloc
    /// provenance over the allocation.
    pub(crate) unsafe fn on_attached_process_exit(this: *mut FileSink, status: &SpawnStatus) {
        bun_core::scoped_log!(FileSink, "onAttachedProcessExit()");
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            // `writer.close()` below re-enters `onClose` which releases the
            // keep-alive ref, and `stream.cancel`/`runPending` drain microtasks
            // which may drop the JS wrapper's ref. Hold a local ref so `this`
            // stays valid for the rest of this function (same pattern as `onWrite`).
            let _guard = RefPtr::init_ref(this);

            (*this).done.set(true);
            let mut readable_stream = (*this)
                .readable_stream
                .replace(readable_stream::Strong::default());
            if readable_stream.has() {
                if let Some(global) = (*this).js_global() {
                    if let Some(stream) = readable_stream.get().as_mut() {
                        if !status.is_ok() {
                            // SAFETY: `bun_vm()` is non-null when `global_object()` was;
                            // `event_loop()` returns the live VM-owned `*mut EventLoop`.
                            let _entered = bun_jsc::event_loop::EventLoop::enter_scope(
                                global.bun_vm().as_mut().event_loop(),
                            );
                            crate::dispatch::fold(stream.cancel(global));
                        } else {
                            stream.done();
                        }
                    }
                }
                // Clean up the readable stream reference
                drop(readable_stream);
            }

            // SAFETY(JsCell): `IOWriter::close` does not call into JS directly; the
            // `on_close` re-entry it triggers goes via the stored `*mut FileSink`
            // backref, not through this `JsCell` borrow.
            (*this).writer.with_mut(|w| w.close());

            (*this).pending.with_mut(|p| {
                p.result = streams::Writable::Err(sys::Error::from_code(
                    sys::Errno::EPIPE,
                    sys::Tag::write,
                ));
            });
            FileSink::run_pending(this);

            // `writer.close()` → `onClose` already released this above; kept for
            // paths where `onClose` isn't reached (e.g. writer already closed).
            FileSink::clear_keep_alive_ref(this);
        }
    }

    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)). `WritablePending::run`
    /// may re-enter JS / drop refs / free `this` on the last `deref`; the body
    /// reborrows `(*this).field` per-statement only.
    unsafe fn run_pending(this: *mut FileSink) {
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            let _guard = RefPtr::init_ref(this);

            (*this).run_pending_later.has.set(false);

            let _entered = (*this).event_loop().entered();
            // SAFETY(JsCell): `WritablePending::run` resolves a JSPromise which may
            // re-enter JS, but no other path holds a borrow of `self.pending` for
            // the duration (host-fns gate on `pending.state != Pending` first).
            (*this).pending.get_mut().run();

            // Release the JS wrapper reference now that the pending operation is complete.
            // This was held to prevent GC from collecting the wrapper while the async
            // operation was in progress.
            (*this).js_sink_ref.with_mut(|r| r.deinit());
        }
    }

    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)).
    pub(crate) unsafe fn on_write(this: *mut FileSink, amount: usize, status: WriteStatus) {
        bun_core::scoped_log!(FileSink, "onWrite({}, {})", amount, status as u8);
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            // `runPending()` below drains microtasks and may drop the JS wrapper's
            // ref, and `writer.end()`/`writer.close()` re-enter `onClose` which
            // releases the keep-alive ref. Hold a local ref so `this` stays valid
            // for the rest of this function (same pattern as `runPending`/`onAutoFlush`).
            let _guard = RefPtr::init_ref(this);

            (*this).written.set((*this).written.get() + amount);

            // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
            // we should unify the behaviors to simplify this
            let has_pending_data = (*this).writer.get().has_pending_data();
            // Only keep the event loop ref'd while there's a pending write in progress.
            // If there's no pending write, no need to keep the event loop ref'd.
            // `with_mut`: Windows `update_ref` is `&mut self` (posix is `&self`).
            // Hoist `io_evtloop()` out of the closure so no raw deref appears inside it.
            let evtloop = (*this).io_evtloop();
            (*this)
                .writer
                .with_mut(|w| w.update_ref(evtloop, has_pending_data));

            if has_pending_data {
                if let Some(vm) = (*this).js_vm() {
                    if !vm.is_inside_deferred_task_queue.get() {
                        AutoFlusher::register_deferred_microtask_with_type::<Self>(&*this, vm);
                    }
                }
            }

            // if we are not done yet and has pending data we just wait so we do not runPending twice
            if status == WriteStatus::Pending && has_pending_data {
                return;
            }

            let was_pending = (*this).pending.get().state == streams::PendingState::Pending;
            if was_pending {
                // `consumed` was credited when the pending operation accepted its
                // bytes; `amount` is only what this drain pushed to the fd.
                let consumed = (*this).pending.get().consumed;
                // when "done" is true, we will never receive more data.
                if (*this).done.get() || status == WriteStatus::EndOfFile {
                    (*this)
                        .pending
                        .with_mut(|p| p.result = streams::Writable::OwnedAndDone(consumed));
                } else {
                    (*this)
                        .pending
                        .with_mut(|p| p.result = streams::Writable::Owned(consumed));
                }

                FileSink::run_pending(this);
            }

            if (was_pending || (status == WriteStatus::Drained && !has_pending_data))
                && (*this).source_pending_pull.replace(false)
            {
                let mut src = *(*this).source.get();
                src.ready(None, None);
            }

            // `end()`'s Pending flush branch leaves the writer running; finish the
            // teardown here regardless of `pending.state` (native path has no promise).
            //
            // Not on `status`: `run_pending`/`src.ready()` above can re-enter
            // `write()` (a short write buffers the tail) and then `end()` (flush
            // Pending, sets `done`). `status` predates that, so a close on a stale
            // `Drained` drops the tail. Re-read the buffer instead; draining the
            // tail calls back here and finishes the teardown.
            if (*this).done.get() && !(*this).writer.get().has_pending_data() {
                if status == WriteStatus::EndOfFile {
                    (*this).writer.with_mut(|w| w.close());
                } else {
                    (*this).end_writer();
                }
            }

            if status == WriteStatus::EndOfFile {
                let mut src = *(*this).source.get();
                src.close(None);
                FileSink::clear_keep_alive_ref(this);
            }
        }
    }

    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)).
    pub(crate) unsafe fn on_error(this: *mut FileSink, err: sys::Error) {
        bun_core::scoped_log!(FileSink, "onError({:?})", err);
        // The streaming writer follows every `onError` with `close()` →
        // `onClose` (on both platforms), which fires `source.close()` and
        // releases the keep-alive ref. Releasing the ref here instead could
        // drop the last reference and free `this` before that `close()` runs.
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            (*this).record_stream_error(streams::StreamError::Error(err.clone()));
            if (*this).pending.get().state == streams::PendingState::Pending {
                (*this)
                    .pending
                    .with_mut(|p| p.result = streams::Writable::Err(err));
                if let Some(vm) = (*this).js_vm() {
                    if vm.is_inside_deferred_task_queue.get() {
                        (*this).run_pending_later();
                        return;
                    }
                }

                FileSink::run_pending(this);
            }
        }
    }

    /// Serves both POSIX `on_ready` and the Windows `on_writable` slot.
    ///
    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)).
    pub unsafe fn on_ready(this: *mut FileSink) {
        bun_core::scoped_log!(FileSink, "onReady()");
        // SAFETY: caller contract — `this` is live; only `source` is reborrowed.
        unsafe {
            if (*this).source_pending_pull.replace(false) {
                let mut src = *(*this).source.get();
                src.ready(None, None);
            }
        }
    }

    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)). `clear_keep_alive_ref`
    /// at the end may free `this`.
    pub unsafe fn on_close(this: *mut FileSink) {
        bun_core::scoped_log!(FileSink, "onClose()");
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            // SAFETY(JsCell): `Strong::has`/`get` are read-only on the GC root.
            if (*this).readable_stream.get_mut().has() && (*this).js_global().is_some() {
                if let Some(stream) = (*this).readable_stream.get().get() {
                    stream.done();
                }
            }

            let mut src = *(*this).source.get();
            src.close(None);

            (*this).settle_stream_done();

            // The writer is fully closed; no further callbacks will arrive. Release
            // the ref taken when a write returned `.pending`. This must be the last
            // thing we do as it may free `this`.
            FileSink::clear_keep_alive_ref(this);
        }
    }

    /// `writer.end()`; `on_close` follows and may free `self`, except (Windows) for an fd the writer
    /// does not own, which is never closed: settle a piped stream here then.
    fn end_writer(&self) {
        #[cfg(windows)]
        if !self.writer.get().owns_fd {
            self.settle_stream_done();
        }
        self.writer.with_mut(|w| w.end());
    }

    fn settle_stream_done(&self) {
        let mut promise = self.stream_done.replace(bun_jsc::JSPromiseStrong::empty());
        if !promise.has_value() {
            return;
        }
        let Some(global) = self.js_global() else {
            return;
        };
        let result = match self.stream_error.replace(None) {
            Some(err) => promise.reject(global, Ok(err.to_js(global))),
            None => promise.resolve(
                global,
                JSValue::js_number(self.stream_bytes.get().unwrap_or(0) as f64),
            ),
        };
        crate::dispatch::fold(result);
    }

    /// Release the ref taken in `toResult`/`end`/`endFromJS` when a write
    /// returned `.pending` and we needed to stay alive until it completed.
    /// Idempotent via the flag check. May free `this`.
    ///
    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)). On rc→0 the
    /// terminal `deinit` reconstructs the `Box` from the original allocation
    /// pointer (= `this`), so this must be that pointer; it must not be used
    /// afterwards.
    unsafe fn clear_keep_alive_ref(this: *mut FileSink) {
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            if (*this).must_be_kept_alive_until_eof.get() {
                (*this).must_be_kept_alive_until_eof.set(false);
                FileSink::deref(this);
            }
        }
    }

    #[cfg(windows)]
    pub(crate) fn create_with_pipe(
        event_loop_: impl Into<EventLoopHandle>,
        pipe: *mut uv::Pipe,
    ) -> RefPtr<FileSink> {
        let evtloop: EventLoopHandle = event_loop_.into();

        // SAFETY: `pipe` is a live `*mut uv::Pipe` provided by the caller.
        // `UvHandle::fd()` returns the raw `uv_os_fd_t` (HANDLE on Windows);
        // INVALID_HANDLE_VALUE maps to `Fd::INVALID`, anything else is
        // tagged as a system handle.
        let fd = match unsafe { (*pipe).fd() } {
            h if h == uv::INVALID_HANDLE_VALUE => Fd::INVALID,
            h => Fd::from_system(h),
        };
        let this = RefPtr::new(FileSink::new(evtloop, fd));
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this.as_ptr()).writer.get_mut().set_pipe(pipe);
            (*this.as_ptr()).writer.get_mut().set_parent(this.as_ptr());
        }
        this
    }

    #[cfg(not(windows))]
    pub(crate) fn create(event_loop_: impl Into<EventLoopHandle>, fd: Fd) -> RefPtr<FileSink> {
        Self::init(fd, event_loop_)
    }

    pub(crate) fn setup(&self, options: &Options) -> sys::Result<()> {
        // SAFETY: JsCell — `Strong::has` is a read-only GC-root probe; no JS re-entry.
        if unsafe { self.readable_stream.get_mut() }.has() {
            // Already started.
            return sys::Result::Ok(());
        }

        // reshaped for borrowck — split into a local capture and apply after.
        // R-2: out-params for `bun_io::open_for_writing` are local then `Cell::set`.
        let mut force_sync_out = self.force_sync.get();
        let mut pollable_out = self.pollable.get();
        let mut is_socket_out = self.is_socket.get();
        let mut nonblocking_out = self.nonblocking.get();
        // `OpenForWritingInput` is impl'd for
        // `bun_io::PathOrFileDescriptor`, not `webcore::PathOrFileDescriptor`;
        // bridge by-value here. The borrowed slice is valid for the duration of
        // `open_for_writing` (the call only needs it for `openat_a`).
        let io_path = match &options.input_path {
            PathOrFileDescriptor::Fd(fd) => bun_io::PathOrFileDescriptor::Fd(*fd),
            PathOrFileDescriptor::Path(slice) => bun_io::PathOrFileDescriptor::Path(slice.slice()),
        };
        let open = |pollable_out: &mut bool,
                    is_socket_out: &mut bool,
                    nonblocking_out: &mut bool,
                    force_sync_out: &mut bool| {
            bun_io::open_for_writing(
                Fd::cwd(),
                &io_path,
                options.flags(),
                options.mode,
                pollable_out,
                is_socket_out,
                self.force_sync.get(),
                nonblocking_out,
                force_sync_out,
                |_fs: &mut bool| {
                    #[cfg(unix)]
                    {
                        *_fs = true;
                    }
                },
                is_pollable,
            )
        };
        let mut result = open(
            &mut pollable_out,
            &mut is_socket_out,
            &mut nonblocking_out,
            &mut force_sync_out,
        );
        if options.mkdirp {
            if let (sys::Result::Err(err), bun_io::PathOrFileDescriptor::Path(path)) =
                (&result, &io_path)
            {
                if err.get_errno() == sys::E::ENOENT {
                    result = match webcore::blob::mkdirp_parent(path) {
                        Ok(()) => open(
                            &mut pollable_out,
                            &mut is_socket_out,
                            &mut nonblocking_out,
                            &mut force_sync_out,
                        ),
                        Err(err) => Err(err),
                    };
                }
            }
        }
        self.pollable.set(pollable_out);
        self.is_socket.set(is_socket_out);
        self.nonblocking.set(nonblocking_out);
        #[cfg(unix)]
        if force_sync_out {
            self.force_sync.set(true);
            // SAFETY(JsCell): single-field write; does not call into JS.
            self.writer.with_mut(|w| w.force_sync = true);
        }

        let fd = match result {
            sys::Result::Err(err) => {
                return sys::Result::Err(err);
            }
            sys::Result::Ok(fd) => fd,
        };

        #[cfg(windows)]
        {
            if self.force_sync.get() {
                // SAFETY(JsCell): `start_sync` is pure I/O setup; no JS.
                match self
                    .writer
                    .with_mut(|w| w.start_sync(fd, self.pollable.get()))
                {
                    sys::Result::Err(err) => {
                        fd.close();
                        return sys::Result::Err(err);
                    }
                    sys::Result::Ok(()) => {
                        self.writer
                            .with_mut(|w| w.update_ref(self.io_evtloop(), false));
                    }
                }
                return sys::Result::Ok(());
            }
        }

        // SAFETY(JsCell): `start` is pure I/O setup; no JS.
        match self.writer.with_mut(|w| w.start(fd, self.pollable.get())) {
            sys::Result::Err(err) => {
                fd.close();
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {
                // Only keep the event loop ref'd while there's a pending write in progress.
                // If there's no pending write, no need to keep the event loop ref'd.
                self.writer
                    .with_mut(|w| w.update_ref(self.io_evtloop(), false));
                #[cfg(unix)]
                {
                    if self.nonblocking.get() {
                        self.writer
                            .get()
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Nonblocking);
                    }

                    if self.is_socket.get() {
                        self.writer
                            .get()
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Socket);
                    } else if self.pollable.get() {
                        self.writer
                            .get()
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Fifo);
                    }
                }
            }
        }

        sys::Result::Ok(())
    }

    pub(crate) fn event_loop(&self) -> EventLoopHandle {
        self.event_loop_handle
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_jsc::EventLoopHandle` so the (runtime-registered) vtable
    /// can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; the vtable consumers treat the pointee as read-only
        self.event_loop_handle.as_event_loop_ctx()
    }

    /// `EventLoopHandle::global_object()` returns an erased `*mut ()`; recover
    /// the typed `&JSGlobalObject` (None for the mini loop or null).
    #[inline]
    fn js_global(&self) -> Option<&JSGlobalObject> {
        let p = self.event_loop_handle.global_object();
        if p.is_null() {
            return None;
        }
        // S008: `JSGlobalObject` is an `opaque_ffi!` ZST handle — safe
        // `*mut → &` via `opaque_deref` (non-null checked above; the global
        // is owned by the VM and outlives this sink).
        Some(bun_opaque::opaque_deref(p.cast::<JSGlobalObject>()))
    }

    /// `EventLoopHandle::bun_vm()` returns an erased `*mut ()`; recover the
    /// typed `&mut VirtualMachine` (None for the mini loop or null).
    #[inline]
    #[allow(clippy::mut_from_ref)] // recovers `&mut` from a type-erased raw ptr (per-thread VM, not aliased)
    fn js_vm(&self) -> Option<&mut bun_jsc::VirtualMachineRef> {
        let p = self.event_loop_handle.bun_vm();
        if p.is_null() {
            return None;
        }
        // SAFETY: `bun_vm()` returns an erased `*mut VirtualMachine` for the
        // Js arm; non-null implies the per-thread VM, never aliased here.
        Some(unsafe { &mut *p.cast::<bun_jsc::VirtualMachineRef>() })
    }

    pub(crate) fn start(&self, stream_start: &streams::Start) -> sys::Result<()> {
        match stream_start {
            streams::Start::Err(err) => {
                return sys::Result::Err(err.clone());
            }
            streams::Start::FileSink(file)
                if !matches!(file.input_path, PathOrFileDescriptor::Fd(Fd::INVALID)) =>
            {
                match self.setup(file) {
                    sys::Result::Err(err) => {
                        return sys::Result::Err(err);
                    }
                    sys::Result::Ok(()) => {}
                }
            }
            _ => {}
        }

        self.done.set(false);
        self.started.set(true);
        self.source.with_mut(|s| s.start());
        sys::Result::Ok(())
    }

    pub(crate) fn run_pending_later(&self) {
        if self.run_pending_later.has.get() {
            return;
        }
        self.run_pending_later.has.set(true);
        if let EventLoopHandle::Js { owner } = self.event_loop() {
            self.ref_();
            // Ptr identity only — `run_from_js_thread` recovers `*mut FileSink`
            // via `from_field_ptr!` and never forms `&mut FileSink`.
            let task =
                bun_event_loop::Task::init(core::ptr::from_ref(&self.run_pending_later).cast_mut());
            owner.enqueue_task(task);
        }
    }

    /// `AutoFlusher` deferred-microtask tick. Takes the canonical `*mut
    /// FileSink` (not `&mut self`) for the same reason as the PipeWriter
    /// callbacks and `on_attached_process_exit`: `writer.flush()` re-enters
    /// `on_write` via the writer backref, and `run_pending_later()` enqueues a
    /// task that drains a promise — either may drop the last ref and free
    /// `this`. A `&mut self` held across those calls would carry a `noalias`
    /// LLVM attribute the re-entry violates and place a Unique Stacked-Borrows
    /// tag on the whole struct, popping the writer's own `*mut Self` tag. The
    /// body reborrows `(*this).field` per-statement only.
    ///
    /// # Safety
    /// `this` must be the canonical heap-allocation pointer (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)): live,
    /// with write+dealloc provenance over the allocation.
    pub(crate) unsafe fn on_auto_flush(this: *mut FileSink) -> bool {
        // SAFETY: caller contract — `this` is live with write+dealloc provenance.
        unsafe {
            if (*this).done.get() || !(*this).writer.get().has_pending_data() {
                (*this).update_ref(false);
                (*this).auto_flusher.with_mut(|a| a.registered.set(false));
                return false;
            }

            let _guard = RefPtr::init_ref(this);

            let amount_buffered = (*this).writer.get().outgoing.size();

            // SAFETY(JsCell): `IOWriter::flush` is pure I/O; the `on_write`
            // callback it may trigger goes via the stored `*mut FileSink` backref.
            match (*this).writer.with_mut(|w| w.flush()) {
                WriteResult::Err(err) => {
                    (*this).update_ref(false);
                    // `flush()` returns a write error without routing through the
                    // writer's `_on_error`, so the pending slot still holds the
                    // `Owned(consumed)` result `to_result` seeded and
                    // `run_pending_later()` alone would resolve it as if every
                    // buffered byte had reached the reader. Latch the error and
                    // move the sink to its terminal state (mirrors `end_from_js`).
                    (*this).record_stream_error(streams::StreamError::Error(err.clone()));
                    (*this).done.set(true);
                    if (*this).pending.get().state == streams::PendingState::Pending {
                        (*this)
                            .pending
                            .with_mut(|p| p.result = streams::Writable::Err(err));
                    }
                    (*this).writer.with_mut(|w| w.end());
                    (*this).run_pending_later();
                    (*this).auto_flusher.with_mut(|a| a.registered.set(false));
                    return false;
                }
                WriteResult::Done(_) => {
                    (*this).update_ref(false);
                    (*this).run_pending_later();
                }
                WriteResult::Wrote(amount_drained) => {
                    if amount_drained == amount_buffered {
                        (*this).update_ref(false);
                        (*this).run_pending_later();
                        // `flush()`'s drain bypasses `on_write(Drained)`; resume the parked ByteStream here.
                        if (*this).source_pending_pull.replace(false) {
                            let mut src = *(*this).source.get();
                            src.ready(None, None);
                        }
                    }
                }
                _ => {
                    return true;
                }
            }

            let is_registered = !(*this).writer.get().has_pending_data();
            (*this)
                .auto_flusher
                .with_mut(|a| a.registered.set(is_registered));
            is_registered
        }
    }

    pub fn flush(&self) -> sys::Result<()> {
        sys::Result::Ok(())
    }

    pub(crate) fn flush_from_js(
        &self,
        global_this: &JSGlobalObject,
        wait: bool,
    ) -> sys::Result<JSValue> {
        let _ = wait;

        if self.pending.get().state == streams::PendingState::Pending {
            if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future {
                return sys::Result::Ok(strong.value());
            }
        }

        if self.done.get() {
            return sys::Result::Ok(JSValue::UNDEFINED);
        }

        let had_buffered_data = self.writer.get().has_pending_data();
        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; no JS re-entry while
        // the `&mut IOWriter` is held.
        let rc = self.writer.with_mut(|w| w.flush());
        // `on_write` keeps the event loop alive while bytes sit in the buffer
        // and `on_auto_flush` releases that once it drains them. A flush from
        // JS that drained them has to release it too, or the loop still counts
        // as alive until the next deferred-task drain (a write()+flush() from a
        // 'beforeExit' listener then re-emits 'beforeExit').
        if had_buffered_data && !self.writer.get().has_pending_data() {
            self.update_ref(false);
        }
        let flushed = match rc {
            WriteResult::Done(written)
            | WriteResult::Pending(written)
            | WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                written as u64 // @truncate
            }
            WriteResult::Err(err) => {
                return sys::Result::Err(err);
            }
        };
        // A flush takes no new chunk from the caller; a pending one reports the
        // bytes it pushed out. It only reaches here when no write is pending.
        match self.to_result(rc, flushed) {
            streams::Writable::Err(_) => unreachable!(),
            result => sys::Result::Ok(result.to_js(global_this)),
        }
    }

    /// # Safety
    /// `this` is the live sink whose JS wrapper holds the +1 released here; it
    /// must not be used after the call, which may free it.
    pub(crate) unsafe fn finalize(this: *mut FileSink) {
        // Called from (a) `~JSFileSink` during lazy sweep, and (b) synchronously
        // from `${name}__doClose` (prototype `.close()`). Must satisfy both
        // contexts: no touching live JS cells (sweep), and no tearing down
        // state that in-flight IO still needs (close).

        // Shutdown never unwinds the writer: the loop stops ticking, so the
        // `onWrite`/`onClose`/EOF callbacks that balance these refs can no
        // longer arrive, and a queued FlushPendingFileSinkTask never runs.
        // Release them here (a piped stdout whose write once returned
        // `.pending` otherwise strands its keep-alive ref forever and the sink
        // leaks). Only under `is_shutting_down`: on a live VM those events
        // still arrive and must keep the sink alive past the wrapper.
        // `clear_keep_alive_ref` is flag-gated, so a (theoretical) late
        // `onClose` is a no-op.
        // SAFETY: caller contract — the wrapper's +1 is held until the trailing
        // `deref` below, so neither release here can free `this`.
        unsafe {
            if (*this).js_vm().is_some_and(|vm| vm.is_shutting_down()) {
                FileSink::clear_keep_alive_ref(this);
                if (*this).run_pending_later.has.replace(false) {
                    // Balances the `ref_()` taken in `run_pending_later()` for
                    // a task that will never run.
                    FileSink::deref(this);
                }
            }
        }

        // Per-wrapper accounting is on `ref_count` directly: each path that
        // hands `self` to C++ (`to_js` / `to_js_with_destructor`) takes a +1
        // via `self.ref_()`, and `finalize`'s `deref()` below releases it.
        // `JsSinkType::construct` allocates with `ref_count=1` and that +1
        // belongs to the wrapper it's about to be stored in, so no extra
        // `ref_()` there. Callers that allocate via `init`/`create` and then
        // `to_js()` must `deref()` once to release init's +1 (see
        // `Blob::get_writer`). `pending`/`readable_stream` are left for
        // `deinit` (Box drop) since in-flight IO may still need them.
        // SAFETY: as above; the `deref` is the last use of `this`.
        unsafe {
            (*this).js_sink_ref.with_mut(|r| r.deinit());
            FileSink::deref(this);
        }
    }

    /// Protect the JS wrapper object from GC collection while an async operation is pending.
    /// This should be called when endFromJS returns a pending Promise.
    /// The reference is released when runPending() completes.
    pub(crate) fn protect_js_wrapper(&self, global_this: &JSGlobalObject, js_wrapper: JSValue) {
        // SAFETY(JsCell): `Strong::set` is a JSC root-slot write; does not
        // re-enter user JS.
        self.js_sink_ref
            .with_mut(|r| r.set(global_this, js_wrapper));
    }

    pub(crate) fn init(fd: Fd, event_loop_handle: impl Into<EventLoopHandle>) -> RefPtr<FileSink> {
        let this = RefPtr::new(FileSink::new(event_loop_handle.into(), fd));
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe { (*this.as_ptr()).writer.get_mut().set_parent(this.as_ptr()) };
        this
    }

    // Called by JSSink codegen on a pre-allocated `m_ctx` slot via
    // `JsSinkType::construct(&mut MaybeUninit<Self>)`, which `write`s this
    // by-value result into the slot.
    pub(crate) fn construct() -> FileSink {
        // `construct` is only called from JSSink codegen on a thread that
        // already has a Bun VM (`get()` panics otherwise); `event_loop()` is
        // the live per-thread `jsc::EventLoop`.
        FileSink::new(
            EventLoopHandle::init(
                (*bun_jsc::VirtualMachineRef::get())
                    .event_loop()
                    .cast::<()>(),
            ),
            Fd::INVALID,
        )
    }

    pub fn write(&self, data: &streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.get().buffered_len();
        // SAFETY(JsCell): `IOWriter::write` buffers/writes to fd; does not call JS.
        let rc = self.writer.with_mut(|w| w.write(data.slice()));
        if self.counting_stream_bytes() {
            self.count_stream_bytes(&rc, data.slice().len());
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    fn count_stream_bytes(&self, rc: &WriteResult, encoded_len: usize) {
        let counted = self.stream_bytes.get().unwrap_or(0);
        match rc {
            WriteResult::Err(err) => {
                self.record_stream_error(streams::StreamError::Error(err.clone()))
            }
            WriteResult::Done(n) => self.stream_bytes.set(Some(counted + *n as u64)),
            _ => self.stream_bytes.set(Some(counted + encoded_len as u64)),
        }
    }

    /// Only `Bun.write(dest, stream)` reads the count; nothing else pays for the encoded length.
    fn counting_stream_bytes(&self) -> bool {
        self.stream_bytes.get().is_some()
    }

    fn record_stream_error(&self, err: streams::StreamError) {
        if self.stream_error.get().is_none() {
            self.stream_error.set(Some(err));
        }
    }

    pub(crate) fn write_latin1(&self, data: &streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.get().buffered_len();
        // SAFETY(JsCell): `IOWriter::write_latin1` buffers/writes; no JS.
        let rc = self.writer.with_mut(|w| w.write_latin1(data.slice()));
        if self.counting_stream_bytes() {
            self.count_stream_bytes(
                &rc,
                bun_core::strings::element_length_latin1_into_utf8(data.slice()),
            );
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    pub(crate) fn write_utf16(&self, data: &streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        let buffered_before = self.writer.get().buffered_len();
        // SAFETY(JsCell): `IOWriter::write_utf16` buffers/writes; no JS.
        let rc = self.writer.with_mut(|w| w.write_utf16(data.slice16()));
        if self.counting_stream_bytes() {
            self.count_stream_bytes(
                &rc,
                bun_core::strings::element_length_utf16_into_utf8(data.slice16()),
            );
        }
        let accepted = self.bytes_accepted(buffered_before, &rc);
        self.to_result(rc, accepted)
    }

    /// Native-path terminator called from `SinkHandle::end`. On upstream error
    /// (ByteStream source), close the writer without flushing — mirrors
    /// `handle_reject_stream` — so a truncated write is not committed as EOF.
    pub(crate) fn end_from_stream(&self, err: Option<streams::StreamError>) {
        let is_byte_stream = matches!(self.source.get(), streams::SourceHandle::ByteStream(_));
        if is_byte_stream {
            // Source drove this call and already cleared its own `sink` field;
            // detach so the writer's `on_close` → `source.close()` is a no-op.
            self.source.with_mut(|s| s.clear());
        }
        let errored = err.is_some();
        // A failed `write()` recorded its error before the source called back here.
        let write_failed = self.stream_error.get().is_some();
        let sys_err = match &err {
            Some(streams::StreamError::Error(e)) => Some(e.clone()),
            _ => None,
        };
        if let Some(err) = err {
            self.record_stream_error(err);
        }
        if !errored || !is_byte_stream {
            let _ = self.end(sys_err);
            return;
        }
        if self.done.get() {
            return;
        }
        self.done.set(true);
        // The source stopped because a write failed (it cleared its sink first): nothing reads
        // the rest, so cancel it. A source that failed on its own is already done.
        let readable_stream = self
            .readable_stream
            .replace(readable_stream::Strong::default());
        if write_failed {
            if let (Some(stream), Some(global)) = (readable_stream.get(), self.js_global()) {
                crate::dispatch::fold(stream.cancel(global));
            }
        }
        self.writer.with_mut(|w| w.close());
    }

    pub(crate) fn end(&self, _err: Option<sys::Error>) -> sys::Result<()> {
        if self.done.get() {
            return sys::Result::Ok(());
        }

        // A backpressured `write()` may have left its promise in `self.pending`;
        // `writer.end()` only re-enters `on_close`, which never touches it, so
        // every synchronous arm that tears the writer down here must settle it
        // (mirrors `on_auto_flush`). `js_close` can't hand the promise back, so
        // the outcome is delivered via `run_pending` and the call returns `Ok`.
        let has_pending = self.pending.get().state == streams::PendingState::Pending;

        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; any callback re-entry
        // goes via the stored `*mut FileSink` backref, not this borrow.
        match self.writer.with_mut(|w| w.flush()) {
            WriteResult::Done(written) | WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                if has_pending {
                    // `to_result` already seeded `Owned(consumed)`; just deliver it.
                    self.run_pending_later();
                }
                self.end_writer();
                sys::Result::Ok(())
            }
            WriteResult::Err(e) => {
                self.record_stream_error(streams::StreamError::Error(e.clone()));
                self.done.set(true);
                if has_pending {
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(e));
                    self.run_pending_later();
                    self.end_writer();
                    return sys::Result::Ok(());
                }
                self.end_writer();
                sys::Result::Err(e)
            }
            WriteResult::Pending(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                if !self.must_be_kept_alive_until_eof.get() {
                    self.must_be_kept_alive_until_eof.set(true);
                    self.ref_();
                }
                self.done.set(true);
                sys::Result::Ok(())
            }
        }
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // Wrapper's +1; balanced by `finalize` → `deref()`.
        self.ref_();
        JSSink::create_object(global_this, self, 0)
    }

    pub(crate) fn to_js_with_destructor(
        &mut self,
        global_this: &JSGlobalObject,
        // `sink::DestructorPtr` is `TaggedPtrUnion<(Detached, Detached)>`
        // which does not satisfy `bun_ptr::TypeList` yet (sibling Sink.rs); accept
        // the encoded usize directly until that lands.
        destructor: Option<usize>,
    ) -> JSValue {
        // Wrapper's +1; balanced by `finalize` → `deref()`.
        self.ref_();
        JSSink::create_object(global_this, self, destructor.unwrap_or(0))
    }

    pub(crate) fn end_from_js(&self, global_this: &JSGlobalObject) -> sys::Result<JSValue> {
        if self.done.get() {
            if self.pending.get().state == streams::PendingState::Pending {
                if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future
                {
                    return sys::Result::Ok(strong.value());
                }
            }
            return sys::Result::Ok(JSValue::js_number(self.written.get() as f64));
        }

        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; no JS while held.
        let flush_result = self.writer.with_mut(|w| w.flush());

        // `writer.end()` only re-enters `on_close`, which never touches
        // `self.pending`; every arm that tears the writer down here with a
        // backpressured `write()` outstanding must hand that promise back and
        // schedule `run_pending` to settle it.
        let has_pending = self.pending.get().state == streams::PendingState::Pending;

        match flush_result {
            WriteResult::Done(written) => {
                self.update_ref(false);
                self.writer.with_mut(|w| w.end());
                if has_pending {
                    // `to_result` already seeded `Owned(consumed)`.
                    // SAFETY: JsCell — `WritablePending::promise` allocates a
                    // JSPromise (may GC) but invokes no FileSink host-fn.
                    let promise = unsafe { self.pending.get_mut() }.promise(global_this);
                    self.run_pending_later();
                    // SAFETY: `WritablePending::promise()` never returns null.
                    return sys::Result::Ok(unsafe { (*promise).to_js() });
                }
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
            WriteResult::Err(err) => {
                self.done.set(true);
                if has_pending {
                    // A backpressured write() left its promise outstanding.
                    // Throwing here would report the failure to the caller and
                    // then let the auto-flush/error path reject that promise a
                    // second time — with nobody holding it when the caller
                    // discarded write()'s return value, that second delivery
                    // surfaces as an unhandledRejection. Deliver the error to
                    // the pending promise instead and hand the caller the same
                    // promise (exactly like the Pending arm), so the failure is
                    // reported once, to whichever await is watching. The latch
                    // and promise grab happen before `writer.end()`: its
                    // teardown can re-enter `on_error`/`run_pending`
                    // synchronously, and the slot must already hold the error
                    // and this caller's promise when that runs.
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(err));
                    // SAFETY: JsCell — `WritablePending::promise` allocates a
                    // JSPromise (may GC) but does not invoke any FileSink
                    // host-fn synchronously.
                    let promise_result = unsafe { self.pending.get_mut() }.promise(global_this);
                    self.writer.with_mut(|w| w.end());
                    self.run_pending_later();
                    // SAFETY: `WritablePending::promise()` never returns null.
                    return sys::Result::Ok(unsafe { (*promise_result).to_js() });
                }
                self.writer.with_mut(|w| w.end());
                sys::Result::Err(err)
            }
            WriteResult::Pending(pending_written) => {
                self.written
                    .set(self.written.get() + pending_written as usize); // @truncate
                if !self.must_be_kept_alive_until_eof.get() {
                    self.must_be_kept_alive_until_eof.set(true);
                    self.ref_();
                }
                self.done.set(true);
                self.pending.with_mut(|p| {
                    // A write already pending on this slot owns `consumed`; seed it
                    // only when `end()` is the call that opens the slot.
                    if p.state != streams::PendingState::Pending {
                        p.consumed += pending_written as u64; // @truncate
                    }
                    p.result = streams::Writable::Owned(p.consumed);
                });

                // SAFETY: JsCell — `WritablePending::promise` allocates a JSPromise
                // (may GC) but does not invoke any FileSink host-fn synchronously.
                let promise_result = unsafe { self.pending.get_mut() }.promise(global_this);

                // SAFETY: `WritablePending::promise()` never returns null.
                sys::Result::Ok(unsafe { (*promise_result).to_js() })
            }
            WriteResult::Wrote(written) => {
                self.writer.with_mut(|w| w.end());
                if has_pending {
                    // SAFETY: JsCell — see the `Done` arm above.
                    let promise = unsafe { self.pending.get_mut() }.promise(global_this);
                    self.run_pending_later();
                    // SAFETY: `WritablePending::promise()` never returns null.
                    return sys::Result::Ok(unsafe { (*promise).to_js() });
                }
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
        }
    }

    pub(crate) fn update_ref(&self, value: bool) {
        // `with_mut`: the Windows `BaseWindowsPipeWriter` impls take `&mut self`
        // (the posix `PosixStreamingWriter` impls are `&self`); `with_mut`
        // covers both. No JS re-entry — pure libuv ref/unref.
        self.writer.with_mut(|w| {
            if value {
                w.enable_keeping_process_alive(self.io_evtloop());
            } else {
                w.disable_keeping_process_alive(self.io_evtloop());
            }
        });
    }
}

// `Sink.JSSink(@This(), "FileSink")` — generic-fn-returning-type → monomorphized type alias.
pub(crate) type JSSink = crate::webcore::sink::JSSink<FileSink>;

crate::impl_js_sink_abi!(FileSink, "FileSink");

// `JsSinkType` impl: routes the codegen `FileSink__*` thunks (via
// `JSSink::<Self>::js_*`) into the inherent streaming methods. Mirrors
// `Sink.JSSink(@This(), "FileSink")`.
impl crate::webcore::sink::JsSinkType for FileSink {
    const NAME: &'static str = "FileSink";
    const HAS_CONSTRUCT: bool = true;
    const HAS_FLUSH_FROM_JS: bool = true;
    const HAS_PROTECT_JS_WRAPPER: bool = true;
    const HAS_UPDATE_REF: bool = true;
    const HAS_GET_FD: bool = true;
    const START_TAG: Option<streams::StartTag> = Some(streams::StartTag::FileSink);

    crate::impl_js_sink_forwarders!();

    unsafe fn finalize(this: *mut Self) {
        // SAFETY: same contract, forwarded.
        unsafe { Self::finalize(this) }
    }
    fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        // `Self::construct()` allocates with `ref_count=1`; that +1 belongs to
        // the C++ `JSFileSink` wrapper `js_construct` is about to create.
        this.write(Self::construct());
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn source(&mut self) -> Option<&mut streams::SourceHandle> {
        // SAFETY: JsCell — trait receiver is `&mut self`; sole borrow of `source`.
        Some(unsafe { self.source.get_mut() })
    }
    fn pending_state_is_pending(&self) -> bool {
        self.pending.get().state == streams::PendingState::Pending
    }
    fn protect_js_wrapper(&mut self, global: &JSGlobalObject, this_value: JSValue) {
        Self::protect_js_wrapper(self, global, this_value)
    }
    fn update_ref(&mut self, value: bool) {
        Self::update_ref(self, value)
    }
    fn get_fd(&self) -> i32 {
        Self::get_fd(self)
    }
}

impl FileSink {
    fn get_fd(&self) -> i32 {
        #[cfg(windows)]
        {
            match self.fd.get().decode_windows() {
                bun_sys::fd::DecodeWindows::Windows(_) => -1, // TODO:
                bun_sys::fd::DecodeWindows::Uv(num) => num,
            }
        }
        #[cfg(not(windows))]
        {
            self.fd.get().native()
        }
    }

    /// Bytes the writer took off our hands in the `write_*` call that produced
    /// `rc`: what reached the fd plus what it buffered for later. The writer
    /// never takes part of a chunk, so for a `Pending` result this is the
    /// chunk's own (encoded) byte count, not the partial `write(2)` return.
    fn bytes_accepted(&self, buffered_before: usize, rc: &WriteResult) -> u64 {
        let WriteResult::Pending(written) = rc else {
            return 0;
        };
        let buffered_after = self.writer.get().buffered_len();
        (buffered_after + written).saturating_sub(buffered_before) as u64 // @truncate
    }

    /// `accepted` is what the pending slot is credited with when `write_result`
    /// is `Pending`: a write's full chunk, or the bytes a flush pushed out. It
    /// is ignored for every other result.
    fn to_result(&self, write_result: WriteResult, accepted: u64) -> streams::Writable {
        match write_result {
            WriteResult::Done(amt) => {
                if amt > 0 {
                    return streams::Writable::OwnedAndDone(amt as u64);
                }
                streams::Writable::Done
            }
            WriteResult::Wrote(amt) => {
                if amt > 0 {
                    return streams::Writable::Owned(amt as u64);
                }
                streams::Writable::Temporary(amt as u64)
            }
            WriteResult::Err(err) => streams::Writable::Err(err),
            WriteResult::Pending(_) => {
                if !self.must_be_kept_alive_until_eof.get() {
                    self.must_be_kept_alive_until_eof.set(true);
                    self.ref_();
                }
                // A Windows uv_write is always async: Pending with an empty
                // outgoing buffer is not backpressure, so keep the source flowing.
                if !self.writer.get().is_backed_up() {
                    return streams::Writable::Owned(accepted);
                }
                self.source_pending_pull.set(true);
                if matches!(
                    self.source.get(),
                    streams::SourceHandle::ByteStream(_) | streams::SourceHandle::FileReader(_)
                ) {
                    return streams::Writable::Backpressure(accepted);
                }
                self.pending.with_mut(|p| {
                    p.consumed += accepted;
                    p.result = streams::Writable::Owned(p.consumed);
                });
                streams::Writable::Pending(self.pending.as_ptr())
            }
        }
    }

    // Helper for struct-init defaults. `EventLoopHandle` has
    // no `Default`, so `impl Default for FileSink` is not possible; kept private
    // to avoid exposing a half-initialized state.
    /// One ref, counted in `LIVE_COUNT`; the writer's parent/pipe are set by
    /// the caller once the sink has its final address.
    fn new(event_loop_handle: EventLoopHandle, fd: Fd) -> FileSink {
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        FileSink {
            ref_count: Cell::new(1),
            writer: JsCell::new(IOWriter::default()),
            event_loop_handle,
            written: Cell::new(0),
            pending: JsCell::new(streams::WritablePending {
                result: streams::Writable::Done,
                ..Default::default()
            }),
            source: JsCell::new(streams::SourceHandle::default()),
            done: Cell::new(false),
            started: Cell::new(false),
            must_be_kept_alive_until_eof: Cell::new(false),
            source_pending_pull: Cell::new(false),
            pollable: Cell::new(false),
            nonblocking: Cell::new(false),
            force_sync: Cell::new(false),
            is_socket: Cell::new(false),
            fd: Cell::new(fd),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            run_pending_later: FlushPendingTask::default(),
            readable_stream: JsCell::new(readable_stream::Strong::default()),
            stream_done: JsCell::new(bun_jsc::JSPromiseStrong::empty()),
            stream_error: JsCell::new(None),
            stream_bytes: Cell::new(None),
            js_sink_ref: JsCell::new(bun_jsc::strong::Optional::empty()),
        }
    }
}

#[derive(Default)]
pub struct FlushPendingTask {
    pub(crate) has: Cell<bool>,
}

impl bun_event_loop::Taskable for FlushPendingTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FlushPendingFileSinkTask;
    /// The embedded "flush later" flag of a `FileSink` that took a ref for the
    /// hop: clear it and drop that ref without flushing.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; `this` is `FileSink.run_pending_later`.
        unsafe {
            (*this).has.set(false);
            let sink: *mut FileSink = bun_core::from_field_ptr!(FileSink, run_pending_later, this);
            drop(RefPtr::from_raw(sink));
        }
    }
}

impl FlushPendingTask {
    /// # Safety
    /// `flush_pending` must point to the `run_pending_later` field of a live
    /// `FileSink` that holds at least the ref taken in `run_pending_later()`
    /// when this task was enqueued (i.e. the canonical heap-allocation pointer
    /// with write+dealloc provenance is recoverable via `from_field_ptr!`).
    pub(crate) unsafe fn run_from_js_thread(flush_pending: *mut FlushPendingTask) {
        // SAFETY: caller contract — `flush_pending` points to
        // `FileSink.run_pending_later` of a live FileSink. `Cell::replace`
        // reads-then-clears in one step so only a single raw deref is needed.
        let had = unsafe { (*flush_pending).has.replace(false) };
        // SAFETY: `flush_pending` is the `run_pending_later` field of a `FileSink`.
        let this: *mut FileSink =
            unsafe { bun_core::from_field_ptr!(FileSink, run_pending_later, flush_pending) };
        // SAFETY: balances the `ref_()` taken in `run_pending_later()` when
        // this task was enqueued; `this` is live for at least that ref.
        let _guard = unsafe { RefPtr::from_raw(this) };
        if had {
            // SAFETY: `this` is the canonical `*mut FileSink` recovered via
            // `from_field_ptr!` from the embedded `run_pending_later` task;
            // `_guard` keeps it live for the call.
            unsafe { FileSink::run_pending(this) };
        }
    }
}

impl FileSink {
    /// Does not ref or unref.
    fn handle_resolve_stream(&self) {
        if let Some(stream) = self.readable_stream.get().get().as_mut() {
            stream.done();
        }

        if !self.done.get() {
            self.writer.with_mut(|w| w.close());
        }
    }

    /// Does not ref or unref.
    fn handle_reject_stream(&self, global_this: &JSGlobalObject, _err: JSValue) -> JsResult<()> {
        if let Some(stream) = self.readable_stream.get().get().as_mut() {
            let aborted = stream.abort(global_this);
            self.readable_stream.set(readable_stream::Strong::default());
            aborted?;
        }

        if !self.done.get() {
            self.writer.with_mut(|w| w.close());
        }
        Ok(())
    }
}

fn on_resolve_stream(_global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onResolveStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this guard balances it.
    let _guard = unsafe { RefPtr::from_raw(this) };
    // SAFETY: `as_promise_ptr` recovers the `*mut FileSink` stashed by `assign_to_stream`.
    unsafe { (*this).handle_resolve_stream() };
    Ok(JSValue::UNDEFINED)
}

fn on_reject_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onRejectStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    let err = args[0];
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this guard balances it.
    let _guard = unsafe { RefPtr::from_raw(this) };
    // SAFETY: `as_promise_ptr` recovers the `*mut FileSink` stashed by `assign_to_stream`.
    unsafe { (*this).handle_reject_stream(global_this, err)? };
    Ok(JSValue::UNDEFINED)
}

impl FileSink {
    /// `Bun.write(file, stream)`: wire `stream`'s native source straight to this sink and return a
    /// promise for the byte count once the file is closed. `None` if the stream is not a native
    /// source; the caller falls back to the JS pump.
    pub fn pipe_stream(
        &mut self,
        stream: &ReadableStream,
        global_this: &JSGlobalObject,
    ) -> Option<JSValue> {
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { RefPtr::init_ref(std::ptr::from_mut::<FileSink>(self)) };

        self.stream_bytes.set(Some(0));
        self.stream_done
            .set(bun_jsc::JSPromiseStrong::init(global_this));
        let promise = self.stream_done.get().value();
        self.readable_stream
            .set(readable_stream::Strong::init(*stream, global_this));

        match stream.wire_native_sink(
            global_this,
            webcore::SinkHandle::FileSink(bun_ptr::BackRef::new(&*self)),
            JSValue::UNDEFINED,
            |src| self.source.set(src),
        ) {
            readable_stream::NativeWireResult::Wired => {
                // A synchronous source (FileReader over a regular file) may have run to the
                // end inside `wire_native_sink`; the promise is settled then.
                if self.stream_done.get().has_value() && !self.done.get() {
                    self.writer
                        .with_mut(|w| w.enable_keeping_process_alive(self.io_evtloop()));
                    if !self.must_be_kept_alive_until_eof.get() {
                        self.must_be_kept_alive_until_eof.set(true);
                        self.ref_();
                    }
                }
                Some(promise)
            }
            readable_stream::NativeWireResult::EndedInline(err) => {
                self.source.set(streams::SourceHandle::None);
                self.end_from_stream(err);
                Some(promise)
            }
            readable_stream::NativeWireResult::NotNative => {
                self.stream_done.set(bun_jsc::JSPromiseStrong::empty());
                self.readable_stream.set(readable_stream::Strong::default());
                None
            }
        }
    }

    pub fn assign_to_stream(
        &mut self,
        stream: &mut ReadableStream,
        global_this: &JSGlobalObject,
    ) -> JSValue {
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { RefPtr::init_ref(std::ptr::from_mut::<FileSink>(self)) };

        self.readable_stream
            .set(readable_stream::Strong::init(*stream, global_this));

        // Native ByteStream/FileReader fast-path: wire the SinkHandle
        // directly, skipping the JS pump.
        match stream.wire_native_sink(
            global_this,
            webcore::SinkHandle::FileSink(bun_ptr::BackRef::new(&*self)),
            JSValue::UNDEFINED,
            |src| self.source.set(src),
        ) {
            readable_stream::NativeWireResult::Wired => {
                // A synchronous producer may have driven `end_from_stream`
                // (clears `source`) inline; no keepalive then.
                if !matches!(self.source.get(), streams::SourceHandle::None) {
                    self.writer
                        .with_mut(|w| w.enable_keeping_process_alive(self.io_evtloop()));
                    if !self.must_be_kept_alive_until_eof.get() {
                        self.must_be_kept_alive_until_eof.set(true);
                        self.ref_();
                    }
                }
                return JSValue::UNDEFINED;
            }
            readable_stream::NativeWireResult::EndedInline(err) => {
                self.source.set(streams::SourceHandle::None);
                match err {
                    Some(err) => self.end_from_stream(Some(err)),
                    None => {
                        let _ = self.end(None);
                    }
                }
                return JSValue::UNDEFINED;
            }
            readable_stream::NativeWireResult::NotNative => {}
        }

        // No per-wrapper +1 for the controller (only the transient `_guard`
        // above): the JS builtins always call `controller.end()`/`.close()`
        // (`${controller}__end/close` → `controller->detach()` → m_sinkPtr=null)
        // before GC, so the controller's dtor never reaches `finalize`.
        let promise_result = JSSink::assign_to_stream(
            global_this,
            stream.value,
            core::ptr::NonNull::from(&mut *self),
        );

        if let Some(err) = promise_result.to_error() {
            self.readable_stream.set(readable_stream::Strong::default());
            return err;
        }

        if !promise_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = promise_result.as_any_promise() {
                // `bun_jsc::AnyPromise` (the active raw-ptr variant in
                // lib.rs) does not yet expose `status()`/`result()`; recover the
                // underlying `JSPromise` (JSInternalPromise subclasses JSPromise
                // in C++, so the cast is layout-safe).
                let js_promise: *mut bun_jsc::JSPromise = match promise {
                    bun_jsc::AnyPromise::Normal(p) => p,
                    bun_jsc::AnyPromise::Internal(p) => p.cast::<bun_jsc::JSPromise>(),
                };
                // SAFETY: `as_any_promise` returned non-null.
                match unsafe { (*js_promise).status() } {
                    bun_jsc::js_promise::Status::Pending => {
                        self.writer
                            .with_mut(|w| w.enable_keeping_process_alive(self.io_evtloop()));
                        self.ref_();
                        // TODO: properly propagate exception upwards
                        // `JSValue::then` takes already-wrapped C-ABI
                        // host fns; the `toJSHostFunction` step is the manual
                        // shims at the bottom of this file.
                        promise_result.then(
                            global_this,
                            std::ptr::from_mut::<FileSink>(self),
                            on_resolve_stream_shim,
                            on_reject_stream_shim,
                        );
                    }
                    bun_jsc::js_promise::Status::Fulfilled => {
                        // These don't ref().
                        self.handle_resolve_stream();
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        // These don't ref().
                        // SAFETY: `js_promise` is non-null (`as_any_promise`).
                        let result = unsafe { (*js_promise).result(global_this.vm()) };
                        crate::dispatch::fold(self.handle_reject_stream(global_this, result));
                    }
                }
            }
        }

        promise_result
    }
}

// `#[bun_jsc::host_fn]` proc-macro is not yet ported, so emit the
// JSC host-function ABI shim by hand and export under the C symbol names the
// C++ side expects.
//
// IMPORTANT: these MUST be exported as *function* symbols (not as `static`
// function-pointer variables). C++ declares them via
// `BUN_DECLARE_HOST_FUNCTION(Bun__FileSink__onResolveStream)` and compares the
// resulting symbol address against the handler passed to `JSValue::then` in
// `Zig::GlobalObject::promiseHandlerID`. A `pub static …: JSHostFn = shim`
// exports the address of an 8-byte data slot, which never equals the shim's
// code address → RELEASE_ASSERT_NOT_REACHED at runtime.
bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__FileSink__onResolveStream")]
    unsafe fn on_resolve_stream_shim(
        g: *mut JSGlobalObject,
        cf: *mut CallFrame,
    ) -> JSValue {
        // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
        // safe `*mut → &` via `opaque_deref`. Kept as raw `JsHostFn` shape so
        // the fn-item coerces to `.then()`'s `JsHostFn` pointer slot without a
        // transmute.
        match on_resolve_stream(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(export_name = "Bun__FileSink__onRejectStream")]
    unsafe fn on_reject_stream_shim(
        g: *mut JSGlobalObject,
        cf: *mut CallFrame,
    ) -> JSValue {
        // S008: `JSGlobalObject`/`CallFrame` are `opaque_ffi!` ZST handles —
        // safe `*mut → &` via `opaque_deref`.
        match on_reject_stream(bun_opaque::opaque_deref(g), bun_opaque::opaque_deref(cf)) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}
