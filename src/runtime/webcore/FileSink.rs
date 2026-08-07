use core::cell::Cell;
use core::sync::atomic::{AtomicI32, Ordering};

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{self, WriteResult, WriteStatus};
use bun_jsc::JsCell;
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
// take `&self` and mutate via `Cell`/`JsCell`. Init-time / `finalize` paths
// keep `&mut self` for write+dealloc provenance (they reach `FileSink::deref`
// which may `heap::take`) — those derive `&mut self` from the codegen shim's
// `&mut T`, which carries a Unique tag over the whole allocation, so dealloc
// through them is sound. The PipeWriter IO callbacks do NOT use `&self`/`&mut
// self` at all: they take the canonical `*mut FileSink` (the heap-alloc
// pointer threaded through `set_parent`) directly — see the `borrow = ptr`
// note on the `impl_streaming_writer_parent!` invocation below.
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
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

    /// `Fd::stdout()` / `Fd::stderr()` when this is the per-VM stdio sink for
    /// that fd (see [`FileSink::create_stdio`]); `Fd::INVALID` otherwise.
    pub(crate) stdio: Cell<Fd>,
    /// The one `JSFileSink` wrapper for a stdio sink, shared by
    /// `process.stdout/stderr`, `Bun.stdout.writer()` and `Bun.file(1|2).writer()`.
    /// Cleared before JSC teardown in `__bun_stdio_sink_deinit`.
    pub(crate) stdio_js: JsCell<bun_jsc::strong::Optional>,
    /// A stdio sink's terminal write error (EPIPE, EIO, ...). Sticky: the fd
    /// is gone, so every later write reports the same error again — which is
    /// how Node's stdio streams behave (each write() re-fails) and what lets
    /// `'error'` fire per call instead of the sink going quietly inert.
    pub(crate) stdio_error: JsCell<Option<sys::Error>>,

    pub(crate) auto_flusher: JsCell<AutoFlusher>,
    pub(crate) run_pending_later: FlushPendingTask,

    /// Currently, only used when `stdin` in `Bun.spawn` is a ReadableStream.
    pub(crate) readable_stream: JsCell<readable_stream::Strong>,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub(crate) js_sink_ref: JsCell<bun_jsc::strong::Optional>,
}

// `bun.ptr.RefCount(FileSink, "ref_count", deinit, .{})` — intrusive single-thread
// refcount derived via #[derive(CellRefCounted)] above. `*FileSink` crosses FFI
// (JSSink wrapper, `@fieldParentPtr`, `asPromisePtr`), so this stays intrusive
// rather than `Rc<T>`.

/// RAII owner of one intrusive ref on a `FileSink`. Drops the ref (and frees
/// the allocation if it was the last) on scope exit, without borrowing `self`.
struct FileSinkRef(*mut FileSink);

impl FileSinkRef {
    /// Take a fresh ref on `this` for the guard's lifetime.
    ///
    /// # Safety
    /// `this` must point to a live `FileSink` with write+dealloc provenance
    /// (see [`FileSink::deref`]).
    #[inline]
    unsafe fn new_ref(this: *mut FileSink) -> Self {
        // SAFETY: caller contract — `this` is live; `ref_` only touches the
        // `Cell<u32>` field via shared borrow.
        unsafe { (*this).ref_() };
        Self(this)
    }

    /// Adopt an existing ref previously taken elsewhere (e.g. balanced against
    /// the `ref_()` in `run_pending_later`/`assign_to_stream`). Does not bump
    /// the count.
    ///
    /// # Safety
    /// `this` must point to a live `FileSink` and the caller must own one
    /// outstanding ref that is being transferred to this guard.
    #[inline]
    unsafe fn adopt(this: *mut FileSink) -> Self {
        Self(this)
    }
}

impl Drop for FileSinkRef {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: constructor contract — `self.0` is live and carries
        // write+dealloc provenance for `deref`'s potential `deinit`.
        unsafe { FileSink::deref(self.0) };
    }
}

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
    pub close: bool,
    pub(crate) mode: bun_sys::Mode,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            input_path: PathOrFileDescriptor::Fd(Fd::INVALID),
            close: false,
            mode: 0o664,
        }
    }
}

impl Options {
    pub(crate) fn flags(&self) -> i32 {
        let _ = self;
        bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY
    }
}

impl FileSink {
    pub(crate) fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
        self.writer.get().memory_cost()
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
            let _guard = FileSinkRef::new_ref(this);

            (*this).done.set(true);
            let mut readable_stream = (*this)
                .readable_stream
                .replace(readable_stream::Strong::default());
            if readable_stream.has() {
                if let Some(global) = (*this).js_global() {
                    if let Some(stream) = readable_stream.get(global).as_mut() {
                        if !status.is_ok() {
                            // SAFETY: `bun_vm()` is non-null when `global_object()` was;
                            // `event_loop()` returns the live VM-owned `*mut EventLoop`.
                            let _entered = bun_jsc::event_loop::EventLoop::enter_scope(
                                global.bun_vm().as_mut().event_loop(),
                            );
                            stream.cancel(global);
                        } else {
                            stream.done(global);
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
            let _guard = FileSinkRef::new_ref(this);

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
            let _guard = FileSinkRef::new_ref(this);

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
            #[cfg(not(windows))]
            if !has_pending_data && (*this).is_stdio() {
                (*this).writer.with_mut(|w| w.unregister_poll());
            }

            if has_pending_data {
                if let Some(vm) = (*this).js_vm() {
                    if !vm.is_inside_deferred_task_queue.get() {
                        AutoFlusher::register_deferred_microtask_with_type::<Self>(&*this, vm);
                    }
                }
            }

            // Bytes still queued (backed up, or a small write coalesced behind an
            // earlier remainder): whoever is waiting on the pending promise keeps
            // waiting until they are actually out, so `'drain'` can't fire early.
            // (Windows reports per completed `uv_write`; its queue drains through
            // further `on_write`s, see the TODO above.)
            #[cfg(not(windows))]
            if has_pending_data && status != WriteStatus::EndOfFile {
                return;
            }
            #[cfg(windows)]
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
            if (*this).done.get() && status == WriteStatus::Drained {
                (*this).writer.with_mut(|w| w.end());
            } else if (*this).done.get() && status == WriteStatus::EndOfFile && !has_pending_data {
                (*this).writer.with_mut(|w| w.close());
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
            let err = if (*this).is_stdio() {
                (*this).stdio_latch_error(err)
            } else {
                err
            };
            if (*this).pending.get().state == streams::PendingState::Pending {
                (*this)
                    .pending
                    .with_mut(|p| p.result = streams::Writable::Err(err));
                // A stdio sink can get here from inside `drain_sync` /
                // `write_all_sync` (console.log, exit) with the writer borrowed
                // and the stdio lock held: settle on the next tick, never here.
                let defer = (*this).is_stdio()
                    || (*this)
                        .js_vm()
                        .is_some_and(|vm| vm.is_inside_deferred_task_queue.get());
                if defer {
                    (*this).run_pending_later();
                    return;
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
            if (*this).readable_stream.get_mut().has() {
                if let Some(global) = (*this).js_global() {
                    if let Some(stream) = (*this).readable_stream.get().get(global) {
                        stream.done(global);
                    }
                }
            }

            let mut src = *(*this).source.get();
            src.close(None);

            // The writer is fully closed; no further callbacks will arrive. Release
            // the ref taken when a write returned `.pending`. This must be the last
            // thing we do as it may free `this`.
            FileSink::clear_keep_alive_ref(this);
        }
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
    ) -> *mut FileSink {
        let evtloop: EventLoopHandle = event_loop_.into();

        let this = bun_core::heap::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            event_loop_handle: evtloop,
            // SAFETY: `pipe` is a live `*mut uv::Pipe` provided by the caller.
            // `UvHandle::fd()` returns the raw `uv_os_fd_t` (HANDLE on Windows);
            // INVALID_HANDLE_VALUE maps to `Fd::INVALID`, anything else is
            // tagged as a system handle.
            fd: Cell::new(match unsafe { (*pipe).fd() } {
                h if h == uv::INVALID_HANDLE_VALUE => Fd::INVALID,
                h => Fd::from_system(h),
            }),
            ..FileSink::default_fields()
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this).writer.get_mut().set_pipe(pipe);
            (*this).writer.get_mut().set_parent(this);
        }
        this
    }

    #[cfg(not(windows))]
    pub(crate) fn create(event_loop_: impl Into<EventLoopHandle>, fd: Fd) -> *mut FileSink {
        let evtloop: EventLoopHandle = event_loop_.into();
        let this = bun_core::heap::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            event_loop_handle: evtloop,
            fd: Cell::new(fd),
            ..FileSink::default_fields()
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this).writer.get_mut().set_parent(this);
        }
        this
    }

    // ── stdio sinks ────────────────────────────────────────────────────────
    //
    // One `FileSink` per (VM, fd ∈ {1, 2}) is *the* owner of every byte this
    // JS thread sends to that fd: `console.*` formats a whole message and hands
    // it to `write_all_sync`, `process.stdout`/`stderr`, `Bun.stdout.writer()`
    // and `Bun.write(Bun.stdout, ..)` are JS façades over the same object, and
    // `process.exit()` / fatal-error printing call `drain_sync` first. That is
    // what gives Node's ordering guarantees (console.log is literally
    // `process.stdout.write` there) without routing the console through JS.
    //
    // fd mode is decided once here and nowhere else:
    //   tty / regular file / anything else → blocking `write(2)`, description
    //     flags left untouched;
    //   FIFO → eager (syscall on every write) but non-blocking so a slow
    //     reader queues + `'drain'`s instead of stalling the loop — via
    //     `RWF_NOWAIT` where the kernel has it, else `O_NONBLOCK` (restored at
    //     exit by `bun_restore_stdio`, cleared for children by spawn);
    //   socket → `send(MSG_DONTWAIT)`, no description flag needed;
    //   Windows → the existing synchronous `SyncFile` path for everything.
    // Every write loop below treats `EAGAIN` as "wait for POLLOUT", so nothing
    // here depends on the description actually being in the mode we chose.

    /// Whether this sink is the VM's stdout/stderr sink.
    #[inline]
    pub fn is_stdio(&self) -> bool {
        self.stdio.get() != Fd::INVALID
    }

    /// stdio sinks report every fd error as `syscall: 'write'` (Node's stdio
    /// streams do; ours may have used `send(2)`/`pwritev2(2)` underneath) and
    /// latch the first one — see `stdio_error`.
    fn stdio_latch_error(&self, mut err: sys::Error) -> sys::Error {
        debug_assert!(self.is_stdio());
        err.syscall = sys::Tag::write;
        if self.stdio_error.get().is_none() {
            self.stdio_error.with_mut(|e| *e = Some(err.clone()));
        }
        err
    }

    /// The latched terminal error of a stdio sink, if any.
    #[inline]
    pub fn stdio_error(&self) -> Option<sys::Error> {
        let e = self.stdio_error.get();
        if e.is_none() { None } else { e.clone() }
    }

    /// The shared JS wrapper for a stdio sink (created on first request, and
    /// again if a previous holder `close()`d — which detaches the wrapper but,
    /// for stdio, only flushes the sink).
    ///
    /// Handing out a JS writer is also the point where a FIFO goes
    /// non-blocking: `process.stdout.write()` / `FileSink.write()` promise
    /// Node's "returns false, emits 'drain'" instead of stalling the loop, and
    /// that needs `EAGAIN` from the kernel. Console-only programs never get
    /// here and keep a plain blocking fd (nothing shared with a parent shell
    /// or sibling process changes under them).
    ///
    /// # Safety
    /// `this` is the canonical live stdio sink pointer held by `RareData`.
    pub unsafe fn stdio_js(this: *mut FileSink, global: &JSGlobalObject) -> JSValue {
        // SAFETY: caller contract; each access is a scoped reborrow.
        unsafe {
            debug_assert!((*this).is_stdio());
            if let Some(v) = (*this).stdio_js.get().get() {
                if JSSink::from_js(v).is_some() {
                    return v;
                }
            }
            #[cfg(not(windows))]
            (*this).stdio_go_nonblocking();
            let v = (*this).to_js(global);
            // SAFETY(JsCell): `Strong::set` is a root-slot write; no JS re-entry.
            (*this).stdio_js.with_mut(|s| s.set(global, v));
            v
        }
    }

    /// Forget the cached wrapper (it stays valid for whoever holds it; the next
    /// `stdio_js` makes a new one in the then-current global).
    pub fn release_stdio_js(&self) {
        self.stdio_js.with_mut(|s| s.deinit());
    }

    /// Something (spawn with inherited stdio) put our description back into
    /// blocking mode after [`stdio_go_nonblocking`](Self::stdio_go_nonblocking):
    /// stop treating the fd as `EAGAIN`-capable so a full pipe is handled by the
    /// blocking-pipe strategy (`poll` before `write`) instead of a write that
    /// was expected to return early. One relaxed load when nothing happened.
    #[inline]
    fn refresh_stdio_mode(&self) {
        #[cfg(not(windows))]
        if self.nonblocking.get() && self.is_stdio() && sys::stdio_made_blocking(self.stdio.get()) {
            self.nonblocking.set(false);
            if let Some(poll) = self.writer.get().get_poll() {
                poll.clear_flag(bun_io::FilePollFlag::Nonblocking);
            }
        }
    }

    /// See [`stdio_js`](Self::stdio_js). FIFO only; sockets get per-call
    /// `MSG_DONTWAIT`, Linux ≥ 6.4 pipes honour `RWF_NOWAIT` on a blocking
    /// description (torvalds/linux@afed6271f5b0, "pipe: set FMODE_NOWAIT on
    /// pipes"), and ttys / files stay blocking as in Node.
    #[cfg(not(windows))]
    fn stdio_go_nonblocking(&self) {
        if self.nonblocking.get() || !self.pollable.get() || self.is_socket.get() {
            return;
        }
        let fd = self.writer.get().get_fd();
        if fd == Fd::INVALID {
            return;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let v = bun_core::linux_kernel_version();
            if (v.major > 6 || (v.major == 6 && v.minor >= 4))
                && sys::linux::RWFFlagSupport::is_maybe_supported()
                && sys::is_on_pipefs(fd)
            {
                return;
            }
        }
        let already = sys::get_fcntl_flags(fd)
            .map(|f| f as i32 & sys::O::NONBLOCK != 0)
            .unwrap_or(false);
        if already || sys::set_nonblocking(fd).is_ok() {
            self.nonblocking.set(true);
            if let Some(poll) = self.writer.get().get_poll() {
                poll.set_flag(bun_io::FilePollFlag::Nonblocking);
            }
        }
    }

    /// Build the stdio sink for `stdio_fd` (1 or 2). Returns a +1 ref.
    #[cfg(not(windows))]
    pub fn create_stdio(
        event_loop: impl Into<EventLoopHandle>,
        stdio_fd: Fd,
    ) -> sys::Result<*mut FileSink> {
        debug_assert!(stdio_fd == Fd::stdout() || stdio_fd == Fd::stderr());

        // Our own fd number for the same description, so a JS `close()`/GC can
        // close *something* without ever closing 1/2, and so the poll has an
        // fd it owns.
        let fd = sys::dup(stdio_fd)?;
        let (pollable, is_socket) = match sys::fstat(fd) {
            Ok(st) => {
                let mode = st.st_mode as sys::Mode;
                (
                    sys::S::ISFIFO(mode) || sys::S::ISSOCK(mode),
                    sys::S::ISSOCK(mode),
                )
            }
            Err(_) => (false, false),
        };

        let this = Self::create(event_loop, fd);
        // SAFETY: `this` was just allocated and is the sole reference.
        unsafe {
            (*this).stdio.set(stdio_fd);
            (*this).pollable.set(pollable);
            (*this).is_socket.set(is_socket);
            (*this).force_sync.set(!pollable);
            (*this).writer.with_mut(|w| {
                w.force_sync = !pollable;
                // Idle stdio sinks keep no poll registered; `AutoFlusher`
                // flushes coalesced `Bun.stdout.writer()` writes at end of tick.
                w.poll_flushes_buffer = false;
            });
            (*this).nonblocking.set(
                pollable
                    && !is_socket
                    && sys::get_fcntl_flags(fd).is_ok_and(|f| f as i32 & sys::O::NONBLOCK != 0),
            );

            // Registered with the loop only while backed up (see `start_lazy`).
            if let Err(err) = (*this).writer.with_mut(|w| w.start_lazy(fd, pollable)) {
                // The writer may or may not have adopted `fd`; make teardown the
                // single owner of closing it.
                (*this).writer.with_mut(|w| {
                    if w.get_fd() == Fd::INVALID {
                        w.handle = bun_io::pipes::PollOrFd::Fd(fd);
                    }
                });
                FileSink::deref(this);
                return Err(err);
            }
            if let Some(poll) = (*this).writer.get().get_poll() {
                poll.set_flag(if is_socket {
                    bun_io::FilePollFlag::Socket
                } else if (*this).nonblocking.get() {
                    bun_io::FilePollFlag::Nonblocking
                } else {
                    bun_io::FilePollFlag::Fifo
                });
            }
            (*this).started.set(true);
        }
        Ok(this)
    }

    #[cfg(windows)]
    pub fn create_stdio(
        event_loop: impl Into<EventLoopHandle>,
        stdio_fd: Fd,
    ) -> sys::Result<*mut FileSink> {
        debug_assert!(stdio_fd == Fd::stdout() || stdio_fd == Fd::stderr());
        let this = Self::init(stdio_fd, event_loop);
        // SAFETY: `this` was just allocated and is the sole reference.
        unsafe {
            (*this).stdio.set(stdio_fd);
            (*this).force_sync.set(true);
            (*this).writer.with_mut(|w| w.owns_fd = false);
            if let Err(err) = (*this).writer.with_mut(|w| w.start_sync(stdio_fd, false)) {
                FileSink::deref(this);
                return Err(err);
            }
            let evtloop = (*this).io_evtloop();
            (*this).writer.with_mut(|w| w.update_ref(evtloop, false));
            (*this).started.set(true);
        }
        Ok(this)
    }

    /// Write everything queued in the writer to the fd *now*, blocking (via
    /// `poll`) if the description is non-blocking and the reader is slow. Used
    /// before console output, before fatal-error printing and at exit, so that
    /// bytes `process.stdout.write()` had to queue never come out after (or get
    /// dropped in favour of) what follows.
    ///
    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)); settling
    /// a pending write schedules a task but never re-enters JS synchronously.
    pub unsafe fn drain_sync(this: *mut FileSink) -> sys::Result<()> {
        // SAFETY: caller contract.
        unsafe {
            if !(*this).writer.get().has_pending_data() {
                return Ok(());
            }
            (*this).refresh_stdio_mode();
            let _lock = bun_io::StdioLock::acquire((*this).stdio.get());
            let _guard = FileSinkRef::new_ref(this);

            let mut result = Ok(());
            loop {
                if !(*this).writer.get().has_pending_data() {
                    break;
                }
                // SAFETY(JsCell): `flush` is pure I/O; `drain_buffered_data`
                // does not call `on_write`. It may call the writer's
                // `on_error` (→ `FileSink::on_error`, which only schedules).
                match (*this).writer.with_mut(|w| w.flush()) {
                    WriteResult::Err(err) => {
                        let err = (*this).stdio_latch_error(err);
                        if (*this).pending.get().state == streams::PendingState::Pending {
                            (*this)
                                .pending
                                .with_mut(|p| p.result = streams::Writable::Err(err.clone()));
                            (*this).run_pending_later();
                        }
                        (*this).writer.with_mut(|w| w.end());
                        result = Err(err);
                        break;
                    }
                    WriteResult::Done(n) => {
                        (*this).written.set((*this).written.get() + n);
                        break;
                    }
                    WriteResult::Wrote(n) | WriteResult::Pending(n) => {
                        (*this).written.set((*this).written.get() + n);
                        if (*this).writer.get().has_pending_data() {
                            #[cfg(unix)]
                            {
                                let fd = (*this).writer.get().get_fd();
                                if fd == Fd::INVALID || !sys::wait_until_writable(fd) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // The queue is empty (or the fd is gone): whatever JS was waiting
            // on backpressure is settled on the next tick, never from here.
            (*this).update_ref(false);
            #[cfg(not(windows))]
            (*this).writer.with_mut(|w| w.unregister_poll());
            if result.is_ok() && (*this).pending.get().state == streams::PendingState::Pending {
                (*this).run_pending_later();
            }
            if (*this).source_pending_pull.replace(false) {
                let mut src = *(*this).source.get();
                src.ready(None, None);
            }
            // `drain_buffered_data` reports a write that failed part-way as the
            // bytes it did push (routing the error through `on_error`); the
            // latch is what says the rest never made it.
            match (result, (*this).stdio_error()) {
                (Ok(()), Some(err)) => Err(err),
                (result, _) => result,
            }
        }
    }

    /// The console path: one fully formatted message (or a spilled part of
    /// one), delivered before this returns. Anything already queued goes out
    /// first (ordering), then `bytes` are written straight from the caller's
    /// buffer. The caller holds [`bun_io::StdioLock`] for this fd for the whole
    /// message.
    ///
    /// # Safety
    /// Same contract as [`drain_sync`](Self::drain_sync).
    pub unsafe fn write_all_sync(this: *mut FileSink, bytes: &[u8]) -> sys::Result<()> {
        // SAFETY: caller contract.
        unsafe {
            if (*this).writer.get().has_pending_data() {
                FileSink::drain_sync(this)?;
            }
            if let Some(err) = (*this).stdio_error() {
                return Err(err);
            }

            #[cfg(windows)]
            {
                // `SyncFile` writes are already a blocking loop.
                match (*this).writer.with_mut(|w| w.write(bytes)) {
                    WriteResult::Err(err) => Err((*this).stdio_latch_error(err)),
                    _ => {
                        (*this).written.set((*this).written.get() + bytes.len());
                        Ok(())
                    }
                }
            }

            #[cfg(not(windows))]
            {
                let mut bytes = bytes;
                let fd = (*this).writer.get().get_fd();
                if fd == Fd::INVALID {
                    return Ok(());
                }
                while !bytes.is_empty() {
                    match sys::write_retrying(fd, bytes) {
                        Ok(0) => {
                            // No progress on a non-empty buffer: report it
                            // rather than pretend the tail went out.
                            let e = (*this).stdio_latch_error(sys::Error::from_code(
                                sys::E::EIO,
                                sys::Tag::write,
                            ));
                            (*this).writer.with_mut(|w| w.fail(e.clone()));
                            return Err(e);
                        }
                        Ok(n) => {
                            bytes = &bytes[n..];
                            (*this).written.set((*this).written.get() + n);
                        }
                        Err(e) => {
                            // Through the writer's error path, so the sink ends
                            // up exactly where a failed queued write would leave
                            // it (fd closed, error latched via `on_error`).
                            let e = (*this).stdio_latch_error(e);
                            (*this).writer.with_mut(|w| w.fail(e.clone()));
                            return Err(e);
                        }
                    }
                }
                Ok(())
            }
        }
    }

    /// A caller that got `Writable::Pending` back but settles the operation
    /// itself (synchronously, via `drain_sync`) instead of taking the pending
    /// promise gives its byte credit back, so the next real waiter's count is
    /// its own.
    pub fn uncredit_pending(&self, accepted: u64) {
        self.pending
            .with_mut(|p| p.consumed = p.consumed.saturating_sub(accepted));
    }

    /// `write()` for a JS `data` value that is a string / ArrayBuffer(View);
    /// `Ok(None)` for anything else so the caller can take its general path.
    /// `now`: attempt the syscall immediately (`IOWriter::write_now`) rather
    /// than coalescing small chunks until end of tick. `count`: also return
    /// this call's UTF-8 byte count (a pass over the string; only `Bun.write`
    /// wants it) — otherwise the second element is unspecified.
    pub fn write_js_value(
        &self,
        global: &JSGlobalObject,
        data: JSValue,
        now: bool,
        count: bool,
    ) -> JsResult<Option<(streams::Writable, u64)>> {
        if let Some(buffer) = data.as_array_buffer(global) {
            let _keep = bun_jsc::EnsureStillAlive(data);
            let bytes = buffer.slice();
            if bytes.is_empty() {
                return Ok(Some((streams::Writable::Owned(0), 0)));
            }
            return Ok(Some(self.write_with(Some(bytes.len() as u64), |w| {
                if now {
                    w.write_now(bytes)
                } else {
                    w.write(bytes)
                }
            })));
        }
        if !data.is_string() {
            return Ok(None);
        }
        let str_ = data.to_js_string(global)?;
        let view = str_.view(global);
        if view.is_empty() {
            return Ok(Some((streams::Writable::Owned(0), 0)));
        }
        let _keep = bun_jsc::EnsureStillAlive(str_.to_js());
        if view.is_16bit() {
            let utf16 = view.utf16_slice_aligned();
            let len =
                count.then(|| bun_core::strings::element_length_utf16_into_utf8(utf16) as u64);
            return Ok(Some(self.write_with(len, |w| {
                if now {
                    w.write_utf16_now(utf16)
                } else {
                    w.write_utf16(utf16)
                }
            })));
        }
        let latin1 = view.slice();
        let len = count.then(|| bun_core::strings::element_length_latin1_into_utf8(latin1) as u64);
        Ok(Some(self.write_with(len, |w| {
            if now {
                w.write_latin1_now(latin1)
            } else {
                w.write_latin1(latin1)
            }
        })))
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
        let result = bun_io::open_for_writing(
            Fd::cwd(),
            &io_path,
            options.flags(),
            options.mode,
            &mut pollable_out,
            &mut is_socket_out,
            self.force_sync.get(),
            &mut nonblocking_out,
            &mut force_sync_out,
            |_fs: &mut bool| {
                #[cfg(unix)]
                {
                    *_fs = true;
                }
            },
            is_pollable,
        );
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
            // The type→tag
            // map lives in `crate::dispatch`; the resolved tag for
            // `*FlushPendingTask` is `task_tag::FlushPendingFileSinkTask`.
            // Ptr identity only — `run_from_js_thread` recovers `*mut FileSink`
            // via `from_field_ptr!` and never forms `&mut FileSink`.
            let task = bun_event_loop::Task::new(
                bun_event_loop::task_tag::FlushPendingFileSinkTask,
                core::ptr::from_ref(&self.run_pending_later)
                    .cast_mut()
                    .cast::<()>(),
            );
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
            (*this).refresh_stdio_mode();

            let _guard = FileSinkRef::new_ref(this);

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
                    // move the sink to its terminal state (mirrors `end_from_js`);
                    // a stdio sink stays "open" and re-fails per call instead.
                    let err = if (*this).is_stdio() {
                        (*this).stdio_latch_error(err)
                    } else {
                        (*this).done.set(true);
                        err
                    };
                    if (*this).pending.get().state == streams::PendingState::Pending {
                        (*this)
                            .pending
                            .with_mut(|p| p.result = streams::Writable::Err(err.clone()));
                    }
                    #[cfg(not(windows))]
                    if (*this).is_stdio() {
                        (*this).writer.with_mut(|w| w.fail(err));
                    } else {
                        (*this).writer.with_mut(|w| w.end());
                    }
                    #[cfg(windows)]
                    {
                        let _ = err;
                        (*this).writer.with_mut(|w| w.end());
                    }
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

        self.refresh_stdio_mode();
        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; no JS re-entry while
        // the `&mut IOWriter` is held.
        let rc = self.writer.with_mut(|w| w.flush());
        let flushed = match rc {
            WriteResult::Done(written)
            | WriteResult::Pending(written)
            | WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                written as u64 // @truncate
            }
            WriteResult::Err(err) if self.is_stdio() => {
                return sys::Result::Err(self.stdio_latch_error(err));
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

    pub fn finalize(&mut self) {
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
        if let Some(vm) = self.js_vm() {
            if vm.is_shutting_down() {
                let this = std::ptr::from_mut::<Self>(self);
                // SAFETY: `this` is the canonical allocation pointer (finalize
                // receives the wrapper's `m_ctx`); the wrapper's +1 is still
                // held until the trailing `deref` below, so neither release
                // can free `this` mid-body. `clear_keep_alive_ref` is
                // flag-gated, so a (theoretical) late `onClose` is a no-op.
                unsafe { FileSink::clear_keep_alive_ref(this) };
                if self.run_pending_later.has.get() {
                    self.run_pending_later.has.set(false);
                    // SAFETY: as above; balances the `ref_()` taken in
                    // `run_pending_later()` for a task that will never run.
                    unsafe { FileSink::deref(this) };
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
        self.js_sink_ref.with_mut(|r| r.deinit());
        // SAFETY: `&mut self` carries write provenance over the whole
        // allocation; this is the last use of `self` in `finalize`.
        unsafe { FileSink::deref(std::ptr::from_mut::<Self>(self)) };
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

    pub(crate) fn init(fd: Fd, event_loop_handle: impl Into<EventLoopHandle>) -> *mut FileSink {
        let this = bun_core::heap::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            writer: JsCell::new(IOWriter::default()),
            fd: Cell::new(fd),
            event_loop_handle: event_loop_handle.into(),
            ..FileSink::default_fields()
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this).writer.get_mut().set_parent(this);
        }
        this
    }

    // Called by JSSink codegen on a pre-allocated `m_ctx` slot via
    // `JsSinkType::construct(&mut MaybeUninit<Self>)`, which `write`s this
    // by-value result into the slot.
    pub(crate) fn construct() -> FileSink {
        let this = FileSink {
            ref_count: Cell::new(1),
            // SAFETY: `construct` is only called from JSSink codegen on a thread
            // that already has a Bun VM (`get()` panics otherwise); `event_loop()`
            // is the live per-thread `jsc::EventLoop`.
            event_loop_handle: EventLoopHandle::init(
                (*bun_jsc::VirtualMachineRef::get())
                    .event_loop()
                    .cast::<()>(),
            ),
            ..FileSink::default_fields()
        };
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        this
    }

    pub fn write(&self, data: &streams::Result) -> streams::Writable {
        self.write_with(None, |w| w.write(data.slice())).0
    }

    pub(crate) fn write_latin1(&self, data: &streams::Result) -> streams::Writable {
        self.write_with(None, |w| w.write_latin1(data.slice())).0
    }

    pub(crate) fn write_utf16(&self, data: &streams::Result) -> streams::Writable {
        self.write_with(None, |w| w.write_utf16(data.slice16())).0
    }

    /// The result, plus how many UTF-8 bytes *this call* handed the writer:
    /// exact when the caller supplied `encoded_len` (the writer accepts all of
    /// its input or errors), else only meaningful for `Pending`.
    #[inline]
    fn write_with(
        &self,
        encoded_len: Option<u64>,
        f: impl FnOnce(&mut IOWriter) -> WriteResult,
    ) -> (streams::Writable, u64) {
        if let Some(err) = self.stdio_error() {
            return (streams::Writable::Err(err), 0);
        }
        self.refresh_stdio_mode();
        if self.done.get() {
            return (streams::Writable::Done, 0);
        }
        let buffered_before = self.writer.get().buffered_len();
        // SAFETY(JsCell): `IOWriter::write*` buffers/writes to fd; does not call JS.
        let rc = self.writer.with_mut(f);
        // What `to_result` credits a pending operation with.
        let pending_credit = self.bytes_accepted(buffered_before, &rc);
        let accepted = match rc {
            WriteResult::Err(_) => 0,
            // `n` may include bytes coalesced by earlier calls and flushed now,
            // or be a partial write with the rest queued: not this call's count.
            WriteResult::Wrote(n) | WriteResult::Done(n) => encoded_len.unwrap_or(n as u64),
            WriteResult::Pending(_) => encoded_len.unwrap_or(pending_credit),
        };
        (self.to_result(rc, pending_credit), accepted)
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
        if err.is_none() || !is_byte_stream {
            let sys_err = match err {
                Some(streams::StreamError::Error(e)) => Some(e),
                _ => None,
            };
            let _ = self.end(sys_err);
            return;
        }
        if self.done.get() {
            return;
        }
        self.done.set(true);
        self.readable_stream
            .with_mut(|rs| *rs = readable_stream::Strong::default());
        self.writer.with_mut(|w| w.close());
    }

    pub(crate) fn end(&self, _err: Option<sys::Error>) -> sys::Result<()> {
        if self.done.get() {
            return sys::Result::Ok(());
        }
        if self.is_stdio() {
            // The stdio sink outlives any one JS handle to it: ending
            // `Bun.stdout.writer()` flushes, it does not take stdout away from
            // `console.log` / `process.stdout`.
            // SAFETY: `self` is the canonical RareData-held stdio sink.
            return unsafe { FileSink::drain_sync(core::ptr::from_ref(self).cast_mut()) };
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
                self.writer.with_mut(|w| w.end());
                if has_pending {
                    // `to_result` already seeded `Owned(consumed)`; just deliver it.
                    self.run_pending_later();
                }
                sys::Result::Ok(())
            }
            WriteResult::Err(e) => {
                self.done.set(true);
                if has_pending {
                    self.pending
                        .with_mut(|p| p.result = streams::Writable::Err(e));
                    self.writer.with_mut(|w| w.end());
                    self.run_pending_later();
                    return sys::Result::Ok(());
                }
                self.writer.with_mut(|w| w.end());
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

    /// Called when the intrusive refcount reaches zero. Frees `self`.
    ///
    /// # Safety
    /// `this` must have been allocated via `heap::alloc` (see `create`/`init`)
    /// and the caller must hold the last reference.
    unsafe fn deinit(this: *mut FileSink) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        // pending/readable_stream/js_sink_ref are dropped by Box drop below.
        // SAFETY: caller contract — `this` is valid and uniquely owned; scoped shared access.
        if let Some(global) = unsafe { (*this).js_global() } {
            // SAFETY: `bun_vm()` is non-null when `js_global()` returned Some.
            let vm = global.bun_vm().as_mut();
            // SAFETY: as above — shared borrow scoped to the unregister call.
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(unsafe { &*this }, vm);
        }
        // SAFETY: `this` was produced by `heap::alloc` in the constructors.
        drop(unsafe { bun_core::heap::take(this) });
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
        if self.is_stdio() {
            // See `end()`: flush, report, stay open.
            // SAFETY: `self` is the canonical RareData-held stdio sink.
            unsafe { FileSink::drain_sync(core::ptr::from_ref(self).cast_mut()) }?;
            return sys::Result::Ok(JSValue::js_number(self.written.get() as f64));
        }
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

    fn memory_cost(&self) -> usize {
        Self::memory_cost(self)
    }
    fn finalize(&mut self) {
        Self::finalize(self)
    }
    fn construct(this: &mut core::mem::MaybeUninit<Self>) {
        // `Self::construct()` allocates with `ref_count=1`; that +1 belongs to
        // the C++ `JSFileSink` wrapper `js_construct` is about to create.
        this.write(Self::construct());
    }
    fn write_bytes(&mut self, data: &streams::Result) -> streams::result::Writable {
        Self::write(self, data)
    }
    fn write_utf16(&mut self, data: &streams::Result) -> streams::result::Writable {
        Self::write_utf16(self, data)
    }
    fn write_latin1(&mut self, data: &streams::Result) -> streams::result::Writable {
        Self::write_latin1(self, data)
    }
    fn end(&mut self, err: Option<sys::Error>) -> sys::Result<()> {
        Self::end(self, err)
    }
    fn end_from_js(&mut self, global: &JSGlobalObject) -> sys::Result<JSValue> {
        Self::end_from_js(self, global)
    }
    fn flush(&mut self) -> sys::Result<()> {
        Self::flush(self)
    }
    fn flush_from_js(&mut self, global: &JSGlobalObject, wait: bool) -> sys::Result<JSValue> {
        Self::flush_from_js(self, global, wait)
    }
    fn start(&mut self, config: streams::Start) -> sys::Result<()> {
        Self::start(self, &config)
    }
    fn source(&mut self) -> Option<&mut streams::SourceHandle> {
        // SAFETY: JsCell — trait receiver is `&mut self`; sole borrow of `source`.
        Some(unsafe { self.source.get_mut() })
    }
    fn done(&self) -> bool {
        self.done.get()
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
            WriteResult::Err(err) => {
                if self.is_stdio() {
                    return streams::Writable::Err(self.stdio_latch_error(err));
                }
                streams::Writable::Err(err)
            }
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
    fn default_fields() -> FileSink {
        FileSink {
            ref_count: Cell::new(1),
            writer: JsCell::new(IOWriter::default()),
            // `EventLoopHandle` has no `Default`; null Js variant is the
            // closest sentinel — every constructor overwrites this field.
            // SAFETY: sentinel only; never dispatched (overwritten before use).
            event_loop_handle: EventLoopHandle::init(core::ptr::null_mut()),
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
            fd: Cell::new(Fd::INVALID),
            stdio: Cell::new(Fd::INVALID),
            stdio_js: JsCell::new(bun_jsc::strong::Optional::empty()),
            stdio_error: JsCell::new(None),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            run_pending_later: FlushPendingTask::default(),
            readable_stream: JsCell::new(readable_stream::Strong::default()),
            js_sink_ref: JsCell::new(bun_jsc::strong::Optional::empty()),
        }
    }
}

#[derive(Default)]
pub struct FlushPendingTask {
    pub(crate) has: Cell<bool>,
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
        let _guard = unsafe { FileSinkRef::adopt(this) };
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
    fn handle_resolve_stream(&self, global_this: &JSGlobalObject) {
        if let Some(stream) = self.readable_stream.get().get(global_this).as_mut() {
            stream.done(global_this);
        }

        if !self.done.get() {
            self.writer.with_mut(|w| w.close());
        }
    }

    /// Does not ref or unref.
    fn handle_reject_stream(&self, global_this: &JSGlobalObject, _err: JSValue) {
        if let Some(stream) = self.readable_stream.get().get(global_this).as_mut() {
            stream.abort(global_this);
            self.readable_stream.set(readable_stream::Strong::default());
        }

        if !self.done.get() {
            self.writer.with_mut(|w| w.close());
        }
    }
}

fn on_resolve_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onResolveStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this guard balances it.
    let _guard = unsafe { FileSinkRef::adopt(this) };
    // SAFETY: `as_promise_ptr` recovers the `*mut FileSink` stashed by `assign_to_stream`.
    unsafe { (*this).handle_resolve_stream(global_this) };
    Ok(JSValue::UNDEFINED)
}

fn on_reject_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onRejectStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    let err = args[0];
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this guard balances it.
    let _guard = unsafe { FileSinkRef::adopt(this) };
    // SAFETY: `as_promise_ptr` recovers the `*mut FileSink` stashed by `assign_to_stream`.
    unsafe { (*this).handle_reject_stream(global_this, err) };
    Ok(JSValue::UNDEFINED)
}

impl FileSink {
    pub fn assign_to_stream(
        &mut self,
        stream: &mut ReadableStream,
        global_this: &JSGlobalObject,
    ) -> JSValue {
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) };

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
                        self.handle_resolve_stream(global_this);
                    }
                    bun_jsc::js_promise::Status::Rejected => {
                        // These don't ref().
                        // SAFETY: `js_promise` is non-null (`as_any_promise`).
                        let result = unsafe { (*js_promise).result(global_this.vm()) };
                        self.handle_reject_stream(global_this, result);
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

// ───────────────────────────────────────────────────────────────────────────
// Per-VM stdio sinks: accessor + the link-time externs the lower tiers call.
// ───────────────────────────────────────────────────────────────────────────

#[inline]
fn stdio_slot(fd: Fd) -> usize {
    debug_assert!(fd == Fd::stdout() || fd == Fd::stderr());
    (fd == Fd::stderr()) as usize
}

/// The stdio sink for `fd` (1 or 2) on this VM, created on first use. `None`
/// only if the sink could not be created (e.g. `dup` failed because fd 1/2 is
/// closed), in which case callers write to the fd directly.
pub fn stdio_sink_for(vm: &mut bun_jsc::VirtualMachineRef, fd: Fd) -> Option<*mut FileSink> {
    if let Some(existing) = existing_stdio_sink(vm, fd) {
        return Some(existing);
    }
    let event_loop = EventLoopHandle::init(vm.event_loop().cast::<()>());
    match FileSink::create_stdio(event_loop, fd) {
        Ok(sink) => {
            vm.rare_data().stdio_sinks[stdio_slot(fd)] = core::ptr::NonNull::new(sink.cast());
            Some(sink)
        }
        Err(err) => {
            bun_core::scoped_log!(FileSink, "create_stdio({}) failed: {:?}", fd, err);
            None
        }
    }
}

/// The stdio sink for `fd` if it already exists on this VM (never creates).
pub fn existing_stdio_sink(vm: &mut bun_jsc::VirtualMachineRef, fd: Fd) -> Option<*mut FileSink> {
    let rare = vm.rare_data.as_deref_mut()?;
    rare.stdio_sinks[stdio_slot(fd)].map(|p| p.as_ptr().cast())
}

/// `$newRustFunction("runtime/webcore/FileSink.rs", "writeNow", 2)` — `(sink, chunk)`: the
/// stdio streams' `_write`. Same contract and return values as
/// `FileSink.prototype.write`, except the syscall is attempted immediately
/// instead of coalescing small chunks until end of tick (Node's
/// `process.stdout.write` is a `write(2)` per call, and a child spawned right
/// after must find the bytes already there).
#[bun_jsc::host_fn]
pub(crate) fn write_now(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [sink_value, data] = frame.arguments_as_array::<2>();
    let Some(this) = JSSink::from_js(sink_value) else {
        return Err(global.throw(format_args!("This FileSink has already been closed.")));
    };
    // SAFETY: `from_js` returned the live `m_ctx` of a `JSFileSink` wrapper.
    // (FileSink has no `get_pending_error`, unlike the socket sinks.)
    let sink: &FileSink = unsafe { &(*this).sink };
    let _keep = bun_jsc::EnsureStillAlive(data);
    match sink.write_js_value(global, data, true, false)? {
        Some((result, _)) => Ok(result.to_js(global)),
        // Same errors as `FileSink.prototype.write` (Sink.rs `js_write`).
        None => Err(global.throw_value(global.to_type_error(
            if data.is_empty_or_undefined_or_null() {
                bun_jsc::ErrorCode::STREAM_NULL_VALUES
            } else {
                bun_jsc::ErrorCode::INVALID_ARG_TYPE
            },
            format_args!("write() expects a string, ArrayBufferView, or ArrayBuffer"),
        ))),
    }
}

/// `JSSink.cpp` `FileSink__doClose`: is this the shared per-thread stdio sink?
#[unsafe(no_mangle)]
extern "C" fn FileSink__isStdio(ptr: *const FileSink) -> bool {
    // SAFETY: `ptr` is the live `m_ctx` of a `JSFileSink` wrapper.
    unsafe { (*ptr).is_stdio() }
}

/// `bun_jsc::rare_data::__bun_stdio_sink_deinit` body: release `RareData`'s ref.
#[unsafe(no_mangle)]
unsafe fn __bun_stdio_sink_deinit(ptr: *mut ()) {
    if ptr.is_null() {
        return;
    }
    let this = ptr.cast::<FileSink>();
    // SAFETY: `ptr` is the exact +1 `*mut FileSink` `stdio_sink_for` stored;
    // JSC is still alive when `release_stdio_sinks` runs, so dropping the
    // wrapper root here is sound (the wrapper's own +1 is released by its
    // finalizer).
    unsafe {
        (*this).stdio_js.with_mut(|s| s.deinit());
        // A stdio sink never reaches EOF/close, so a backpressure episode's
        // keep-alive ref (`to_result` → `must_be_kept_alive_until_eof`) is
        // still held; drop it with RareData's.
        FileSink::clear_keep_alive_ref(this);
        // User code that closes fds by number behind our back (and anything
        // that then reuses and closes that number) can leave our dup already
        // closed; tearing down must not trip close()'s use-after-close check.
        #[cfg(not(windows))]
        {
            let fd = (*this).writer.get().get_fd();
            if fd != Fd::INVALID && sys::get_fcntl_flags(fd).is_err() {
                (*this).writer.with_mut(|w| {
                    w.handle
                        .close_impl(None, None::<fn(*mut core::ffi::c_void)>, false)
                });
                (*this).fd.set(Fd::INVALID);
            }
        }
        FileSink::deref(this);
    }
}

/// `bun_jsc::virtual_machine::__bun_stdio_sink_release_js` body: a new global
/// is taking over this VM (`bun test` isolation); the old global's wrapper must
/// not be what the new one's `process.stdout` is built over, nor keep the old
/// realm alive from a VM-lifetime root.
///
/// # Safety
/// `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
unsafe fn __bun_stdio_sink_release_js(vm: *mut bun_jsc::VirtualMachineRef) {
    // SAFETY: caller contract.
    let vm = unsafe { &mut *vm };
    for fd in [Fd::stdout(), Fd::stderr()] {
        if let Some(sink) = existing_stdio_sink(vm, fd) {
            // SAFETY: canonical live pointer held by RareData.
            unsafe { (*sink).release_stdio_js() };
        }
    }
}

/// `Bun.file(1|2).writer()` / `Bun.stdout.writer()` / `process.stdout`'s sink:
/// the shared wrapper over this VM's stdio sink, or `None` to fall back to an
/// ordinary FileSink when the stdio sink can't be created.
pub fn stdio_sink_js(global: &JSGlobalObject, fd: Fd) -> Option<JSValue> {
    // SAFETY: `bun_vm()` is the live VM owning `global`.
    let vm = global.bun_vm().as_mut();
    let sink = stdio_sink_for(vm, fd)?;
    // SAFETY: canonical live pointer held by RareData.
    Some(unsafe { FileSink::stdio_js(sink, global) })
}

/// `bun_jsc::console_object::__bun_stdio_sink_write` body — the console fast
/// path. Delivers `bytes` to fd `fd` through this VM's stdio sink before
/// returning (see [`FileSink::write_all_sync`]). Caller holds `StdioLock(fd)`.
///
/// # Safety
/// `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
unsafe fn __bun_stdio_sink_write(
    vm: *mut bun_jsc::VirtualMachineRef,
    fd: Fd,
    bytes: &[u8],
) -> Result<(), sys::Error> {
    // SAFETY: caller contract.
    let vm = unsafe { &mut *vm };
    match stdio_sink_for(vm, fd) {
        // SAFETY: `sink` is the canonical live pointer held by RareData.
        Some(sink) => match unsafe { FileSink::write_all_sync(sink, bytes) } {
            Ok(()) => Ok(()),
            Err(err) => {
                // Node: a console write that fails surfaces as 'error' on
                // process.stdout/stderr *if someone is listening* (the console
                // itself swallows it). Same here; never an uncaught exception.
                report_stdio_error(vm.global(), fd, &err);
                Err(err)
            }
        },
        None => {
            // No sink (fd 1/2 could not be dup'd): best effort straight to the
            // fd; there is no stream to report a failure on.
            let _ = sys::write_all_retrying(fd, bytes);
            Ok(())
        }
    }
}

unsafe extern "C" {
    /// `BunProcess.cpp` — `stream.destroy(err)` on Bun's `process.stdout`/
    /// `stderr` object for `fd` iff it exists and has an `'error'` listener.
    fn Bun__Process__reportStdioSinkError(global: &JSGlobalObject, fd: i32, err: JSValue);
}

/// See `__bun_stdio_sink_write`.
fn report_stdio_error(global: &JSGlobalObject, fd: Fd, err: &sys::Error) {
    use bun_sys_jsc::ErrorJsc as _;
    let Ok(js_err) = err.clone().to_js(global) else {
        return;
    };
    let n = if fd == Fd::stdout() { 1 } else { 2 };
    // SAFETY: `js_err` is a fresh error object; the C++ side runs a builtin
    // under a top-level exception scope and reports (never propagates) a throw.
    unsafe { Bun__Process__reportStdioSinkError(global, n, js_err) };
}

/// [`bun_sys::set_stdio_write_hook`] target; installed once per process from
/// `init_runtime_state`. Runs on whatever thread `Output` is writing from, so
/// it only ever looks at *that* thread's VM.
pub fn before_output_write(fd: Fd) {
    let Some(vm) = bun_jsc::VirtualMachineRef::get_or_null() else {
        return;
    };
    // SAFETY: the thread-local VM pointer is live for the thread's lifetime;
    // `existing_stdio_sink` only reads `rare_data`.
    let vm = unsafe { &mut *vm };
    if let Some(sink) = existing_stdio_sink(vm, fd) {
        // SAFETY: canonical live pointer held by RareData; `drain_sync` is a
        // no-op unless something is queued.
        let _ = unsafe { FileSink::drain_sync(sink) };
    }
}

/// `bun_jsc::virtual_machine::__bun_stdio_sink_drain` body: synchronously drain
/// whatever `process.stdout`/`stderr` writes are still queued on this VM, so
/// what the caller prints next (a fatal error, the exit) cannot overtake or
/// discard them. No-op — not even an allocation — when the sinks were never
/// created.
///
/// # Safety
/// `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
unsafe fn __bun_stdio_sink_drain(vm: *mut bun_jsc::VirtualMachineRef) {
    // SAFETY: caller contract.
    let vm = unsafe { &mut *vm };
    for fd in [Fd::stdout(), Fd::stderr()] {
        if let Some(sink) = existing_stdio_sink(vm, fd) {
            // SAFETY: canonical live pointer held by RareData.
            let _ = unsafe { FileSink::drain_sync(sink) };
        }
    }
}
