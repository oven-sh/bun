use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicI32, Ordering};

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{self, WriteResult, WriteStatus};
use bun_jsc::JsCell;
use bun_sys::{self as sys, Fd, FdExt as _};

use crate::webcore::jsc::{
    CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult, Strong, Task,
};
use crate::webcore::readable_stream::{self, ReadableStream};
use crate::webcore::{self, AutoFlusher, Blob, PathOrFileDescriptor, streams};
// TODO(port): verify module path for `bun.spawn.Status`
use crate::api::bun::process::Status as SpawnStatus;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::UvHandle as _;

bun_core::declare_scope!(FileSink, visible);

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

// R-2 (`&mut self` host-fn re-entrancy → noalias UB): JS-reachable host-fns
// take `&self` and mutate via `Cell`/`JsCell`. The codegen shim (Phase 1)
// still passes `&mut T`, but `&mut T` auto-derefs to `&T`, so this compiles
// today and becomes sound once the shim flips. Init-time / `finalize` paths
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
    /// #53265/#53570/#53753 probe: poisoned to `FILESINK_DEAD` immediately
    /// before `heap::take` in `destroy()`, so a second `finalize()` on the
    /// same `m_sinkPtr` (double-finalize from JS{FileSink,Controller} both
    /// dtor'ing, OR a stale wrapper after the slot was freed-but-not-reused)
    /// is detected before reading garbage. If the slot WAS reused by a fresh
    /// `FileSink::init()`, magic is `FILESINK_LIVE` again. Windows-only to
    /// keep posix layout (and the perf cost) unchanged. Remove with the rest
    /// of the probe once root-caused.
    #[cfg(windows)]
    magic: Cell<u32>,
    pub writer: JsCell<IOWriter>,
    pub event_loop_handle: EventLoopHandle,
    pub written: Cell<usize>,
    pub pending: JsCell<streams::WritablePending>,
    pub signal: JsCell<streams::Signal>,
    pub done: Cell<bool>,
    pub started: Cell<bool>,
    pub must_be_kept_alive_until_eof: Cell<bool>,

    // TODO: these fields are duplicated on writer()
    // we should not duplicate these fields...
    pub pollable: Cell<bool>,
    pub nonblocking: Cell<bool>,
    pub force_sync: Cell<bool>,

    pub is_socket: Cell<bool>,
    pub fd: Cell<Fd>,

    pub auto_flusher: JsCell<AutoFlusher>,
    pub run_pending_later: FlushPendingTask,

    /// Currently, only used when `stdin` in `Bun.spawn` is a ReadableStream.
    pub readable_stream: JsCell<readable_stream::Strong>,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub js_sink_ref: JsCell<bun_jsc::strong::Optional>,
}

// `bun.ptr.RefCount(FileSink, "ref_count", deinit, .{})` — intrusive single-thread
// refcount derived via #[derive(CellRefCounted)] above. `*FileSink` crosses FFI
// (JSSink wrapper, `@fieldParentPtr`, `asPromisePtr`), so this stays intrusive
// rather than `Rc<T>`.

/// RAII owner of one intrusive ref on a `FileSink`. Drops the ref (and frees
/// the allocation if it was the last) on scope exit. Replaces the Zig
/// `self.ref(); defer self.deref();` pair without borrowing `self`.
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
pub static LIVE_COUNT: AtomicI32 = AtomicI32::new(0);

#[cfg(windows)]
const FILESINK_LIVE: u32 = 0xF11E_51A1; // "FileSink" alive
#[cfg(windows)]
const FILESINK_DEAD: u32 = 0xDEAD_51A1;

/// #53265 probe v5 (UAF backtrace map): the v3/v4 probes proved
/// `m_sinkPtr` was a live FileSink at JSFileSink-ctor time (assertLive
/// passed) but its slot has been freed-then-reused by GC-sweep finalize
/// (magic=0x0, head bytes decode as a `UVFSRequest<_, args::Close, _>`).
/// To name the over-deref site, `deinit` records the *freeing* call stack
/// here keyed by `*mut FileSink as usize`; `finalize`'s bad-magic panic
/// looks it up so the next CI hit prints the actual `ref_count→0` path
/// instead of the (uninformative) lazy-sweep stack. Windows debug only;
/// removed with the rest of the probe once root-caused.
#[cfg(windows)]
static FREED_AT: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<usize, String>>,
> = std::sync::LazyLock::new(Default::default);

/// #53265 probe v4: called from the C++ `JSFileSink` / `JSReadableFileSinkController`
/// constructors immediately after `m_sinkPtr = sinkPtr` (see generate-jssink.ts).
/// v3 showed magic=0x0 at GC-sweep finalize — i.e. `m_sinkPtr` was never (or is no
/// longer) a `FileSink`. This moves the check to **store time** so the panic carries
/// the *creation* backtrace, naming whoever passed the bad pointer to
/// `FileSink__createObject` / `FileSink__assignToStream`. If this passes and v3's
/// finalize check still fires, the corruption is a write-after-store (UAF onto a
/// freed-then-reused slot) and we move to a ptr-registry probe.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn FileSink__assertLive(ptr: *const c_void) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: probe-only — reads `magic` at its repr(Rust) offset. Worst case
    // (non-FileSink ptr ≥ sizeof(FileSink) bytes from a page edge) is the very
    // bug we're catching; the panic that follows is the intended outcome.
    let magic = unsafe { (*ptr.cast::<FileSink>()).magic.get() };
    if magic != FILESINK_LIVE {
        let head: [u8; 64] = unsafe { core::ptr::read_unaligned(ptr.cast::<[u8; 64]>()) };
        // Full diagnostic to stderr first — `rust_panic_hook` formats into a
        // 1024-byte `BoundedArray` whose `write_str` is all-or-nothing, so a
        // long payload would emerge as an empty `panic:` line in CI. Keep the
        // panic message itself short enough to fit.
        eprintln!(
            "FileSink__assertLive: m_sinkPtr={:p} stored with bad magic {:#x} \
             (LIVE={:#x} DEAD={:#x}); head[0..64]={:02x?}",
            ptr, magic, FILESINK_LIVE, FILESINK_DEAD, head,
        );
        panic!(
            "FileSink__assertLive: bad magic {magic:#x} at m_sinkPtr={ptr:p} — \
             head[0..64] hexdump written to stderr above"
        );
    }
}
#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub extern "C" fn FileSink__assertLive(_ptr: *const c_void) {}

pub mod testing_apis {
    use super::*;

    // TODO(port): #[bun_jsc::host_fn]
    pub fn file_sink_live_count(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(LIVE_COUNT.load(Ordering::Relaxed) as f64))
    }
}
// `generated_js2native.rs` snake-cases Zig's `TestingAPIs` as `testing_ap_is`
// (acronym splitter treats `AP|Is` as two words); alias so both resolve.
pub use testing_apis as testing_ap_is;

/// Port of `bun.sys.isPollable` (sys.zig:4162) — `bun_sys` does not yet export
/// this helper, so re-derive it locally from `S_IFMT`. Windows always returns
/// `false` (the spec gates on `bun.Environment.isWindows`).
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

/// `bun.io.StreamingWriter(@This(), opaque { onClose, onWritable, onError, onWrite })`.
/// The Zig passes a comptime vtable via an `opaque {}` with decls; in Rust the
/// parent type implements the handler trait directly.
pub type IOWriter = bun_io::StreamingWriter<FileSink>;
pub type Poll = IOWriter;

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
// re-entrant freeing calls (observed: `FileSink::finalize: bad magic` on
// Windows fs-promises tests, #53265 — probe v6 STATE shows
// `must_be_kept_alive=true` at deinit, impossible under balanced rc
// accounting). A `&mut self`-derived ptr would instead place a Unique tag on
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
    pub chunk_size: webcore::BlobSizeType,
    pub input_path: PathOrFileDescriptor,
    pub truncate: bool,
    pub close: bool,
    pub mode: bun_sys::Mode,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            chunk_size: 1024,
            input_path: PathOrFileDescriptor::Fd(Fd::INVALID),
            truncate: true,
            close: false,
            mode: 0o664,
        }
    }
}

impl Options {
    pub fn flags(&self) -> i32 {
        let _ = self;
        bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY
    }
}

impl FileSink {
    pub fn memory_cost(&self) -> usize {
        // Since this is a JSSink, the NewJSSink function does @sizeOf(JSSink) which includes @sizeOf(FileSink).
        self.writer.get().memory_cost()
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__ForceFileSinkToBeSynchronousForProcessObjectStdio(
    _global: *mut JSGlobalObject,
    jsvalue: JSValue,
) {
    let Some(this_ptr) = JSSink::from_js(jsvalue) else {
        return;
    };
    // SAFETY: `from_js` returned a live `*mut JSSink<FileSink>` (= ThisSink); the
    // first field is `sink: FileSink`, so `&(*this_ptr).sink` recovers the
    // wrapped `*FileSink` (Zig: `@ptrCast(@alignCast(JSSink.fromJS(...) orelse return))`).
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
                        // (libuv handle subtyping), so the pointer cast is valid (Zig: `@ptrCast(pipe)`).
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
                        // SAFETY: `tty` is a live `NonNull<uv_tty_t>` (heap or static stdin tty);
                        // `uv_tty_t` embeds `uv_stream_t` as its first field, so the cast is the
                        // libuv handle-subtype downcast (Zig: `@ptrCast(tty)`).
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
    pub unsafe fn on_attached_process_exit(this: *mut FileSink, status: &SpawnStatus) {
        bun_core::scoped_log!(FileSink, "onAttachedProcessExit()");
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
    pub unsafe fn on_write(this: *mut FileSink, amount: usize, status: WriteStatus) {
        bun_core::scoped_log!(FileSink, "onWrite({}, {})", amount, status as u8);
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

            if has_pending_data {
                if let Some(vm) = (*this).js_vm() {
                    if !vm.is_inside_deferred_task_queue.get() {
                        AutoFlusher::register_deferred_microtask_with_type::<Self>(&*this, vm);
                    }
                }
            }

            // if we are not done yet and has pending data we just wait so we do not runPending twice
            if status == WriteStatus::Pending && has_pending_data {
                if (*this).pending.get().state == streams::PendingState::Pending {
                    (*this).pending.with_mut(|p| p.consumed = amount as u64); // @truncate
                }
                return;
            }

            if (*this).pending.get().state == streams::PendingState::Pending {
                (*this).pending.with_mut(|p| p.consumed = amount as u64); // @truncate

                // when "done" is true, we will never receive more data.
                let consumed = (*this).pending.get().consumed;
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

                // this.done == true means ended was called
                let ended_and_done = (*this).done.get() && status == WriteStatus::EndOfFile;

                if (*this).done.get() && status == WriteStatus::Drained {
                    // if we call end/endFromJS and we have some pending returned from .flush() we should call writer.end()
                    (*this).writer.with_mut(|w| w.end());
                } else if ended_and_done && !has_pending_data {
                    (*this).writer.with_mut(|w| w.close());
                }
            }

            if status == WriteStatus::EndOfFile {
                (*this).signal.with_mut(|s| s.close(None));
                FileSink::clear_keep_alive_ref(this);
            }
        }
    }

    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)).
    pub unsafe fn on_error(this: *mut FileSink, err: sys::Error) {
        bun_core::scoped_log!(FileSink, "onError({:?})", err);
        unsafe {
            if (*this).pending.get().state == streams::PendingState::Pending {
                (*this)
                    .pending
                    .with_mut(|p| p.result = streams::Writable::Err(err));
                if let Some(vm) = (*this).js_vm() {
                    if vm.is_inside_deferred_task_queue.get() {
                        (*this).run_pending_later();
                        #[cfg(windows)]
                        FileSink::clear_keep_alive_ref(this);
                        return;
                    }
                }

                FileSink::run_pending(this);
            }

            // On POSIX, the streaming writer always calls `close()` → `onClose`
            // after `onError`, so `onClose` releases the keep-alive ref. Releasing
            // it here could drop the last ref and free `this` before the writer's
            // subsequent `close()` touches its (embedded) fields.
            //
            // On Windows, the pipe error paths call `closeWithoutReporting()` which
            // skips `onClose`, so release here. This is safe because those paths
            // always hold another ref (the in-flight write's ref via `defer
            // parent.deref()` in `onWriteComplete`, or the JS caller's ref when
            // reached synchronously from `write()`) through `closeWithoutReporting`.
            #[cfg(windows)]
            FileSink::clear_keep_alive_ref(this);
        }
    }

    /// Serves both POSIX `on_ready` and the Windows `on_writable` slot.
    ///
    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)).
    pub unsafe fn on_ready(this: *mut FileSink) {
        bun_core::scoped_log!(FileSink, "onReady()");
        unsafe { (*this).signal.with_mut(|s| s.ready(None, None)) };
    }

    /// # Safety
    /// `this` must be the canonical live `*mut FileSink` (see
    /// [`on_attached_process_exit`](Self::on_attached_process_exit)). `clear_keep_alive_ref`
    /// at the end may free `this`.
    pub unsafe fn on_close(this: *mut FileSink) {
        bun_core::scoped_log!(FileSink, "onClose()");
        unsafe {
            // SAFETY(JsCell): `Strong::has`/`get` are read-only on the GC root.
            if (*this).readable_stream.get_mut().has() {
                if let Some(global) = (*this).js_global() {
                    if let Some(stream) = (*this).readable_stream.get().get(global) {
                        stream.done(global);
                    }
                }
            }

            (*this).signal.with_mut(|s| s.close(None));

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
        unsafe {
            if (*this).must_be_kept_alive_until_eof.get() {
                (*this).must_be_kept_alive_until_eof.set(false);
                FileSink::deref(this);
            }
        }
    }

    #[cfg(windows)]
    pub fn create_with_pipe(
        event_loop_: impl Into<EventLoopHandle>,
        pipe: *mut uv::Pipe,
    ) -> *mut FileSink {
        let evtloop: EventLoopHandle = event_loop_.into();

        let this = bun_core::heap::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            event_loop_handle: evtloop,
            // SAFETY: `pipe` is a live `*mut uv::Pipe` provided by the caller.
            // `UvHandle::fd()` returns the raw `uv_os_fd_t` (HANDLE on Windows);
            // Zig's `HandleMixin.fd` maps INVALID_HANDLE_VALUE → `bun.invalid_fd`
            // and otherwise tags kind=system via `.fromNative`.
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

    // No `#[cfg(not(windows))]` arm: Zig's `@compileError` is lazy (fires only if
    // called on POSIX), but Rust's `compile_error!` is eager. Omitting the fn on
    // POSIX yields the equivalent "no associated function" compile error at call sites.

    pub fn create(event_loop_: impl Into<EventLoopHandle>, fd: Fd) -> *mut FileSink {
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

    pub fn setup(&self, options: &Options) -> sys::Result<()> {
        // SAFETY(JsCell): `Strong::has` is a read-only GC-root probe.
        if unsafe { self.readable_stream.get_mut() }.has() {
            // Already started.
            return sys::Result::Ok(());
        }

        // PORT NOTE: reshaped for borrowck — Zig passed `self` + a closure that
        // mutated `self.force_sync`. Split into a local capture and apply after.
        // R-2: out-params for `bun_io::open_for_writing` are local then `Cell::set`.
        let mut force_sync_out = self.force_sync.get();
        let mut pollable_out = self.pollable.get();
        let mut is_socket_out = self.is_socket.get();
        let mut nonblocking_out = self.nonblocking.get();
        // `OpenForWritingInput` is impl'd for
        // `bun_io::PathOrFileDescriptor`, not `webcore::PathOrFileDescriptor`;
        // bridge by-value here. `PathString::init` borrows `slice.slice()` for
        // the duration of `open_for_writing` (the call only needs it for
        // `openat_a`).
        let io_path = match &options.input_path {
            PathOrFileDescriptor::Fd(fd) => bun_io::PathOrFileDescriptor::Fd(*fd),
            PathOrFileDescriptor::Path(slice) => {
                bun_io::PathOrFileDescriptor::Path(bun_core::PathString::init(slice.slice()))
            }
        };
        let result = bun_io::open_for_writing(
            Fd::cwd(),
            io_path,
            options.flags(),
            options.mode,
            &mut pollable_out,
            &mut is_socket_out,
            self.force_sync.get(),
            &mut nonblocking_out,
            &mut force_sync_out,
            |fs: &mut bool| {
                #[cfg(unix)]
                {
                    *fs = true;
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

    /// Returns the platform's `bun.Async.Loop` (`uv_loop_t*` on Windows,
    /// `us_loop_t*` on POSIX). `bun_io::Loop` is the cfg-aliased nominal that
    /// resolves to the correct one per target — see `aio/{posix,windows}_event_loop.rs`.
    pub fn loop_(&self) -> *mut bun_io::Loop {
        self.event_loop_handle.native_loop()
    }

    pub fn event_loop(&self) -> EventLoopHandle {
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
    fn js_vm(&self) -> Option<&mut bun_jsc::VirtualMachineRef> {
        let p = self.event_loop_handle.bun_vm();
        if p.is_null() {
            return None;
        }
        // SAFETY: `bun_vm()` returns an erased `*mut VirtualMachine` for the
        // Js arm; non-null implies the per-thread VM, never aliased here.
        Some(unsafe { &mut *p.cast::<bun_jsc::VirtualMachineRef>() })
    }

    pub fn connect(&self, signal: streams::Signal) {
        self.signal.set(signal);
    }

    pub fn start(&self, stream_start: streams::Start) -> sys::Result<()> {
        match stream_start {
            streams::Start::FileSink(ref file) => {
                // PORT NOTE: `streams::FileSinkOptions` mirrors `file_sink::Options`
                // but is a distinct draft type; bridge by-field until streams.rs
                // aliases to this module's `Options`.
                let opts = Options {
                    chunk_size: file.chunk_size as webcore::BlobSizeType,
                    input_path: match &file.input_path {
                        crate::webcore::PathOrFileDescriptor::Fd(fd) => {
                            PathOrFileDescriptor::Fd(*fd)
                        }
                        crate::webcore::PathOrFileDescriptor::Path(p) => {
                            // `ZigStringSlice` is non-`Clone` (owns/WTF-refs its
                            // bytes); borrow the bytes for the duration of
                            // `setup(&opts)` — `stream_start` (and thus `p`)
                            // outlives `opts` within this match arm.
                            PathOrFileDescriptor::Path(
                                bun_core::zig_string::Slice::from_utf8_never_free(p.slice()),
                            )
                        }
                    },
                    ..Options::default()
                };
                match self.setup(&opts) {
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
        self.signal.with_mut(|s| s.start());
        sys::Result::Ok(())
    }

    pub fn run_pending_later(&self) {
        if self.run_pending_later.has.get() {
            return;
        }
        self.run_pending_later.has.set(true);
        if let EventLoopHandle::Js { owner } = self.event_loop() {
            self.ref_();
            // `jsc.Task.init(&this.run_pending_later)` — the comptime type→tag
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
    pub unsafe fn on_auto_flush(this: *mut FileSink) -> bool {
        unsafe {
            if (*this).done.get() || !(*this).writer.get().has_pending_data() {
                (*this).update_ref(false);
                (*this).auto_flusher.with_mut(|a| a.registered.set(false));
                return false;
            }

            let _guard = FileSinkRef::new_ref(this);

            let amount_buffered = (*this).writer.get().outgoing.size();

            // SAFETY(JsCell): `IOWriter::flush` is pure I/O; the `on_write`
            // callback it may trigger goes via the stored `*mut FileSink` backref.
            match (*this).writer.with_mut(|w| w.flush()) {
                WriteResult::Err(_) | WriteResult::Done(_) => {
                    (*this).update_ref(false);
                    (*this).run_pending_later();
                }
                WriteResult::Wrote(amount_drained) => {
                    if amount_drained == amount_buffered {
                        (*this).update_ref(false);
                        (*this).run_pending_later();
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

    pub fn flush_from_js(&self, global_this: &JSGlobalObject, wait: bool) -> sys::Result<JSValue> {
        let _ = wait;

        if self.pending.get().state == streams::PendingState::Pending {
            if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future {
                return sys::Result::Ok(strong.value());
            }
        }

        if self.done.get() {
            return sys::Result::Ok(JSValue::UNDEFINED);
        }

        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; no JS re-entry while
        // the `&mut IOWriter` is held.
        let rc = self.writer.with_mut(|w| w.flush());
        match rc {
            WriteResult::Done(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
            }
            WriteResult::Pending(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
            }
            WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
            }
            WriteResult::Err(err) => {
                return sys::Result::Err(err);
            }
        }
        match self.to_result(rc) {
            streams::Writable::Err(_) => unreachable!(),
            result => sys::Result::Ok(result.to_js(global_this)),
        }
    }

    pub fn finalize(&mut self) {
        // TODO(port): `.classes.ts` finalize — see PORTING.md §JSC. Runs during
        // lazy sweep; must not touch live JS cells.

        // ── #53265 magic check (must be FIRST — before any field deref) ──────
        #[cfg(windows)]
        {
            let m = self.magic.get();
            if m != FILESINK_LIVE {
                // Freed-then-finalized-again, OR m_sinkPtr never pointed at a
                // FileSink. Dump first 64 bytes so the next CI log shows what
                // type's bytes are actually here. DO NOT deref any other field.
                // SAFETY: `self` is at minimum a valid-for-read 64-byte region
                // (mimalloc never hands out <64B for a 520B alloc class).
                let head = unsafe {
                    core::slice::from_raw_parts(
                        (self as *const Self).cast::<u8>(),
                        64,
                    )
                };
                // ── probe v5: decode the slot reuse + recover the deinit backtrace ──
                // head layout observed in CI matches `UVFSRequest<_, args::Close, _>`:
                //   @0  u64 tracker.id
                //   @8  u64 args::Close{fd}  (Fd::from_uv(n) sets bit 63)
                //   @16 *mut self (req.data)
                //   @24 u32 req.type_ (uv_req_type; 6 = UV_FS)
                let w = |i: usize| u64::from_ne_bytes(head[i..i + 8].try_into().unwrap());
                let fd_raw = w(8);
                let fd_decoded = if fd_raw & (1u64 << 63) != 0 {
                    format!("Fd::from_uv({})", (fd_raw & !(1u64 << 63)) as i64)
                } else {
                    format!("{fd_raw:#x}")
                };
                let req_type = u32::from_ne_bytes(head[24..28].try_into().unwrap());
                let reuse = if req_type == 6 {
                    "slot reused by UVFSRequest (uv_req_type=UV_FS)"
                } else {
                    "slot reuse type unknown"
                };
                #[cfg(windows)]
                let freed_bt = FREED_AT
                    .lock()
                    .ok()
                    .and_then(|m| m.get(&(self as *const _ as usize)).cloned())
                    .unwrap_or_else(|| "<no deinit backtrace recorded>".into());
                #[cfg(not(windows))]
                let freed_bt = String::from("<no FREED_AT entry — never reached deinit; m_sinkPtr was bogus from start OR deinit not called>");
                // Full diagnostic to stderr, then a SHORT panic.
                //
                // `rust_panic_hook` (src/crash_handler/lib.rs) formats the panic
                // payload into a 1024-byte `BoundedArray`, and `BoundedArray`'s
                // `core::fmt::Write::write_str` is **all-or-nothing** — if
                // `len + s.len() > 1024` it writes ZERO bytes. The previous
                // single-`panic!` payload here (≈250B prose + ≈260B hexdump +
                // decode line + multi-KB `freed_bt`) overflowed atomically, so
                // CI #53811/#53852 printed an empty `panic:` line and the
                // bun.report `0…` segment encoded the empty string — defeating
                // the probe. 0ad014d3de61's 2KB cap on `freed_bt` targeted the
                // wrong buffer (the limit is `msg_buf`'s 1024B, not the
                // backtrace string). Fix: dump everything via `eprintln!` (no
                // size limit) and keep the actual panic message well under 1KB
                // so the crash handler captures it.
                eprintln!(
                    "FileSink::finalize: bad magic {m:#x} (LIVE={:#x} DEAD={:#x}) at self={:p}; \
                     m_sinkPtr is stale (UAF). head[0..64]={:02x?} | decode: @8 fd={} @16 data={:#x} \
                     @24 req_type={} ({}) | freed at:\n{}",
                    FILESINK_LIVE,
                    FILESINK_DEAD,
                    self as *const _,
                    head,
                    fd_decoded,
                    w(16),
                    req_type,
                    reuse,
                    freed_bt,
                );
                panic!(
                    "FileSink::finalize UAF: bad magic {m:#x} at self={:p} — \
                     full FREED_AT backtrace + slot decode written to stderr above",
                    self as *const _,
                );
            }
        }
        // Per-wrapper accounting is on `ref_count` directly: each path that
        // hands `self` to C++ (`to_js` / `to_js_with_destructor` /
        // `assign_to_stream`) takes a +1 via `self.ref_()`, and `finalize`'s
        // `deref()` below releases it. `JsSinkType::construct` allocates with
        // `ref_count=1` and that +1 belongs to the wrapper it's about to be
        // stored in, so no extra `ref_()` there.
        //
        // PORT NOTE: Zig's `FileSink.toJS` does *not* `self.ref()` — it relies
        // on the caller's existing +1 transferring to the wrapper. The Rust
        // port makes the per-wrapper +1 explicit so the protocol is locally
        // verifiable (N wrappers ⇒ N `ref_()` ⇒ N `finalize` ⇒ N `deref()`),
        // **but** that means callers that allocate via `init`/`create` and
        // then `to_js()` must `deref()` once to release init's +1 (see
        // `Blob::get_writer`). #53265 was init's +1 leaking on that path.

        // ── #53265/#53570 Windows Strong-corruption probe ────────────────────
        // The shared Strong::Impl::destroy panic tail can't distinguish which
        // of the 3 Optional fields holds a small-integer "handle". Probe each
        // here with the field name + neighbouring fields so the next CI crash
        // localizes the overwrite. Remove once root-caused.
        #[cfg(windows)]
        {
            #[inline(never)]
            fn probe(name: &'static str, p: *const (), this: &FileSink) {
                let addr = p as usize;
                if addr != 0 && addr < 0x10000 {
                    // #53753 probe pass 1 showed (heap_ptr, 0x1) at
                    // [fd@480, readable_stream@488] with all other fields ==
                    // default_fields(). Layout offsets verified unchanged vs
                    // f0dc9e332 (writer@16/sz336 fd@480 rs@488 jsr@496 sink520;
                    // writer.source@0 parent@128 write_req@136) — NOT a
                    // dedup-r2 a2d742b2 stale-offset regression. Dump
                    // writer.{parent,source-tag,is_done} + js_sink_ref to
                    // distinguish: (a) wrong-self set_parent (parent != self),
                    // (b) source written to wrong addr (source still None →
                    // start never ran on THIS writer), (c) 24B overrun
                    // (js_sink_ref also non-null).
                    let w = this.writer.get();
                    let src_tag: i8 = match &w.source {
                        None => -1,
                        Some(bun_io::source::Source::Pipe(_)) => 0,
                        Some(bun_io::source::Source::Tty(_)) => 1,
                        Some(bun_io::source::Source::File(_)) => 2,
                        Some(bun_io::source::Source::SyncFile(_)) => 3,
                    };
                    panic!(
                        "FileSink::finalize: Strong field `{}` corrupted ({:p}); \
                         self={:p} fd={:?} written={} ref_count={} done={} pending.state={:?} \
                         signal.ptr={:?} | writer.parent={:p} (==self? {}) writer.source_tag={} \
                         writer.is_done={} writer.owns_fd={} js_sink_ref={:p} started={}",
                        name,
                        p,
                        this as *const _,
                        this.fd.get(),
                        this.written.get(),
                        this.ref_count.get(),
                        this.done.get(),
                        this.pending.get().state as u8,
                        this.signal.get().ptr,
                        w.parent,
                        core::ptr::eq(w.parent.cast_const(), this as *const _),
                        src_tag,
                        w.is_done,
                        w.owns_fd,
                        this.js_sink_ref.get().handle_ptr(),
                        this.started.get(),
                    );
                }
            }
            probe(
                "readable_stream.held",
                self.readable_stream.get().held_handle_ptr(),
                self,
            );
            probe("js_sink_ref", self.js_sink_ref.get().handle_ptr(), self);
            // pending.future is an enum; only probe when it's the Promise arm.
            if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future {
                probe("pending.future.Promise.strong", strong.handle_ptr(), self);
            }
        }

        self.readable_stream.set(readable_stream::Strong::default());
        self.pending.set(streams::WritablePending::default());
        self.js_sink_ref.with_mut(|r| r.deinit());
        // SAFETY: `&mut self` carries write provenance over the whole
        // allocation; this is the last use of `self` in `finalize`.
        unsafe { FileSink::deref(std::ptr::from_mut::<Self>(self)) };
    }

    /// Protect the JS wrapper object from GC collection while an async operation is pending.
    /// This should be called when endFromJS returns a pending Promise.
    /// The reference is released when runPending() completes.
    pub fn protect_js_wrapper(&self, global_this: &JSGlobalObject, js_wrapper: JSValue) {
        // SAFETY(JsCell): `Strong::set` is a JSC root-slot write; does not
        // re-enter user JS.
        self.js_sink_ref
            .with_mut(|r| r.set(global_this, js_wrapper));
    }

    pub fn init(fd: Fd, event_loop_handle: impl Into<EventLoopHandle>) -> *mut FileSink {
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

    // TODO(port): in-place init — `construct` is called by JSSink codegen on a
    // pre-allocated `m_ctx` slot. Phase B may need `&mut MaybeUninit<Self>`.
    pub fn construct() -> FileSink {
        let this = FileSink {
            ref_count: Cell::new(1),
            // SAFETY: `construct` is only called from JSSink codegen on a thread
            // that already has a Bun VM; `get()` panics otherwise.
            event_loop_handle: EventLoopHandle::init(
                unsafe { (*bun_jsc::VirtualMachineRef::get()).event_loop() }.cast::<()>(),
            ),
            ..FileSink::default_fields()
        };
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        this
    }

    pub fn write(&self, data: streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        // SAFETY(JsCell): `IOWriter::write` buffers/writes to fd; does not call JS.
        let rc = self.writer.with_mut(|w| w.write(data.slice()));
        self.to_result(rc)
    }

    #[inline]
    pub fn write_bytes(&self, data: streams::Result) -> streams::Writable {
        self.write(data)
    }

    pub fn write_latin1(&self, data: streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        // SAFETY(JsCell): `IOWriter::write_latin1` buffers/writes; no JS.
        let rc = self.writer.with_mut(|w| w.write_latin1(data.slice()));
        self.to_result(rc)
    }

    pub fn write_utf16(&self, data: streams::Result) -> streams::Writable {
        if self.done.get() {
            return streams::Writable::Done;
        }
        // SAFETY(JsCell): `IOWriter::write_utf16` buffers/writes; no JS.
        let rc = self.writer.with_mut(|w| w.write_utf16(data.slice16()));
        self.to_result(rc)
    }

    pub fn end(&self, _err: Option<sys::Error>) -> sys::Result<()> {
        if self.done.get() {
            return sys::Result::Ok(());
        }

        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; any callback re-entry
        // goes via the stored `*mut FileSink` backref, not this borrow.
        match self.writer.with_mut(|w| w.flush()) {
            WriteResult::Done(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                self.writer.with_mut(|w| w.end());
                sys::Result::Ok(())
            }
            WriteResult::Err(e) => {
                self.writer.with_mut(|w| w.close());
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
            WriteResult::Wrote(written) => {
                self.written.set(self.written.get() + written as usize); // @truncate
                self.writer.with_mut(|w| w.end());
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
        // SAFETY: caller contract — `this` is valid and uniquely owned.
        let self_ = unsafe { &mut *this };
        // #53265 probe v5: record the freeing call stack BEFORE poisoning, so a
        // later finalize-on-stale-m_sinkPtr can name the over-deref site (the
        // GC-sweep stack at finalize time is uninformative). See `FREED_AT`.
        #[cfg(windows)]
        if let Ok(mut m) = FREED_AT.lock() {
            // Probe v6: snapshot full state at deinit so the next CI hit can
            // distinguish (a) keep-alive cleared (must_be_kept_alive=false) +
            // wrapper finalize already ran, vs (b) keep-alive still set →
            // process_send's ref was the only one, vs (c) `done` never set →
            // end_from_js Wrote arm took a different path. The 3-tracer audit
            // (w9qxc9jg1) verified the static ladder is balanced 4:4 with
            // Zig; this captures the dynamic state.
            let state = format!(
                "STATE: must_be_kept_alive={} done={} started={} fd={:?} written={} \
                 pending.state={} owns_fd={} writer.is_done={} writer.has_pending={} \
                 js_sink_ref.has={}\n",
                self_.must_be_kept_alive_until_eof.get(),
                self_.done.get(),
                self_.started.get(),
                self_.fd.get(),
                self_.written.get(),
                self_.pending.get().state as u8,
                self_.writer.get().owns_fd,
                self_.writer.get().is_done,
                self_.writer.get().has_pending_data(),
                self_.js_sink_ref.get().has(),
            );
            m.insert(
                this as usize,
                state + &std::backtrace::Backtrace::force_capture().to_string(),
            );
        }
        #[cfg(windows)]
        self_.magic.set(FILESINK_DEAD);
        // PORT NOTE: pending/readable_stream/js_sink_ref are dropped by Box drop
        // below; explicit `.deinit()` calls from the Zig are subsumed.
        if let Some(global) = self_.js_global() {
            // SAFETY: `bun_vm()` is non-null when `js_global()` returned Some.
            let vm = global.bun_vm().as_mut();
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self_, vm);
        }
        // SAFETY: `this` was produced by `heap::alloc` in the constructors.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // Wrapper's +1; balanced by `finalize` → `deref()`.
        self.ref_();
        JSSink::create_object(global_this, self, 0)
    }

    pub fn to_js_with_destructor(
        &mut self,
        global_this: &JSGlobalObject,
        // PORT NOTE: `sink::DestructorPtr` is `TaggedPtrUnion<(Detached, Detached)>`
        // which does not satisfy `bun_ptr::TypeList` yet (sibling Sink.rs); accept
        // the encoded usize directly until that lands.
        destructor: Option<usize>,
    ) -> JSValue {
        // Wrapper's +1; balanced by `finalize` → `deref()`.
        self.ref_();
        JSSink::create_object(global_this, self, destructor.unwrap_or(0))
    }

    pub fn end_from_js(&self, global_this: &JSGlobalObject) -> sys::Result<JSValue> {
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

        match flush_result {
            WriteResult::Done(written) => {
                self.update_ref(false);
                self.writer.with_mut(|w| w.end());
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
            WriteResult::Err(err) => {
                self.writer.with_mut(|w| w.close());
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
                self.pending
                    .with_mut(|p| p.result = streams::Writable::Owned(pending_written as u64));

                // SAFETY(JsCell): `WritablePending::promise` allocates a JSPromise
                // (may GC) but does not invoke any FileSink host-fn synchronously.
                let promise_result = unsafe { self.pending.get_mut() }.promise(global_this);

                // SAFETY: `WritablePending::promise()` never returns null.
                sys::Result::Ok(unsafe { (*promise_result).to_js() })
            }
            WriteResult::Wrote(written) => {
                self.writer.with_mut(|w| w.end());
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
        }
    }

    pub fn sink(&mut self) -> crate::webcore::sink::Sink<'_> {
        crate::webcore::sink::Sink::init(self)
    }

    pub fn update_ref(&self, value: bool) {
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
pub type JSSink = crate::webcore::sink::JSSink<FileSink>;
pub type SinkSignal = crate::webcore::sink::SinkSignal<FileSink>;

crate::impl_sink_handler!(FileSink);
crate::impl_js_sink_abi!(FileSink, "FileSink");

// `JsSinkType` impl: routes the codegen `FileSink__*` thunks (via
// `JSSink::<Self>::js_*`) into the inherent streaming methods. Mirrors
// `Sink.JSSink(@This(), "FileSink")`.
impl crate::webcore::sink::JsSinkType for FileSink {
    const NAME: &'static str = "FileSink";
    const HAS_CONSTRUCT: bool = true;
    const HAS_SIGNAL: bool = true;
    const HAS_DONE: bool = true;
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
    fn write_bytes(&mut self, data: streams::Result) -> streams::result::Writable {
        Self::write(self, data)
    }
    fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable {
        Self::write_utf16(self, data)
    }
    fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable {
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
        Self::start(self, config)
    }
    fn signal(&mut self) -> Option<&mut streams::Signal> {
        // SAFETY(JsCell): trait receiver is `&mut self`; sole borrow.
        Some(unsafe { self.signal.get_mut() })
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

    fn to_result(&self, write_result: WriteResult) -> streams::Writable {
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
            WriteResult::Pending(pending_written) => {
                if !self.must_be_kept_alive_until_eof.get() {
                    self.must_be_kept_alive_until_eof.set(true);
                    self.ref_();
                }
                self.pending.with_mut(|p| {
                    p.consumed += pending_written as u64; // @truncate
                    p.result = streams::Writable::Owned(pending_written as u64);
                });
                streams::Writable::Pending(self.pending.as_ptr())
            }
        }
    }

    // Helper for struct-init defaults (Zig field defaults).
    // TODO(port): replace with `impl Default for FileSink` once all field types
    // implement `Default`; kept private to avoid exposing a half-initialized state.
    fn default_fields() -> FileSink {
        FileSink {
            ref_count: Cell::new(1),
            #[cfg(windows)]
            magic: Cell::new(FILESINK_LIVE),
            writer: JsCell::new(IOWriter::default()),
            // PORT NOTE: `EventLoopHandle` has no `Default`; null Js variant is the
            // closest sentinel — every constructor overwrites this field.
            event_loop_handle: EventLoopHandle::init(core::ptr::null_mut()),
            written: Cell::new(0),
            pending: JsCell::new(streams::WritablePending {
                result: streams::Writable::Done,
                ..Default::default()
            }),
            signal: JsCell::new(streams::Signal::default()),
            done: Cell::new(false),
            started: Cell::new(false),
            must_be_kept_alive_until_eof: Cell::new(false),
            pollable: Cell::new(false),
            nonblocking: Cell::new(false),
            force_sync: Cell::new(false),
            is_socket: Cell::new(false),
            fd: Cell::new(Fd::INVALID),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            run_pending_later: FlushPendingTask::default(),
            readable_stream: JsCell::new(readable_stream::Strong::default()),
            js_sink_ref: JsCell::new(bun_jsc::strong::Optional::empty()),
        }
    }
}

#[derive(Default)]
pub struct FlushPendingTask {
    pub has: Cell<bool>,
}

impl FlushPendingTask {
    pub fn run_from_js_thread(flush_pending: *mut FlushPendingTask) {
        // SAFETY: `flush_pending` points to `FileSink.run_pending_later` of a
        // live FileSink (the task was enqueued from `run_pending_later()` which
        // took a ref on the parent). `Cell::replace` reads-then-clears in one
        // step so only a single raw deref is needed.
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

// TODO(port): #[bun_jsc::host_fn]
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

// TODO(port): #[bun_jsc::host_fn]
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
        self.signal.set(SinkSignal::init(JSValue::ZERO));
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) };

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        self.signal.with_mut(|s| s.clear());

        self.readable_stream
            .set(readable_stream::Strong::init(*stream, global_this));
        // PORT NOTE: reshaped for borrowck — re-derive `signal_ptr` after
        // assigning `readable_stream`. `JsCell::as_ptr` yields the stable
        // address of the inner `Signal` (`#[repr(transparent)]` over
        // `UnsafeCell`).
        // SAFETY: project to `signal.ptr` without forming a reference;
        // `Option<NonNull<c_void>>` is ABI-identical to `*mut c_void` (see
        // const-asserts on `Signal` in streams.rs), so FFI may write the
        // JSValue bits back through this `void**`.
        let signal_ptr: *mut *mut c_void =
            unsafe { (&raw mut (*self.signal.as_ptr()).ptr).cast::<*mut c_void>() };
        // Zig parity (FileSink.zig:801-802): only the transient `_guard` above
        // — NO per-wrapper +1 for the controller. df4f2c44 added a `ref_()`
        // here under the (false) premise that Zig refs per-wrapper; it does
        // not. The JS builtins always call `controller.end()`/`.close()`
        // (`${controller}__end/close` → `controller->detach()` → m_sinkPtr=null)
        // before GC, so the controller's dtor never reaches `finalize` and
        // that +1 was never balanced — pure leak on every `assign_to_stream`,
        // plus an unconditional leak on the `to_error()` early-return below
        // (the controller IS allocated before the throwing JS call). The
        // 3-ladder #53265 audit (blob-writer / iowriter-callbacks /
        // to_result-ref) found no over-deref this could be masking.
        let promise_result = JSSink::assign_to_stream(global_this, stream.value, self, signal_ptr);

        if let Some(err) = promise_result.to_error() {
            self.readable_stream.set(readable_stream::Strong::default());
            return err;
        }

        if !promise_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = promise_result.as_any_promise() {
                // PORT NOTE: `bun_jsc::AnyPromise` (the active raw-ptr variant in
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
                        // PORT NOTE: `JSValue::then` takes already-wrapped C-ABI
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

// `comptime { @export(&jsc.toJSHostFn(onResolveStream), ...) }`
// `#[bun_jsc::host_fn]` proc-macro is not yet ported, so emit the
// `callconv(jsc.conv)` shim by hand and export under the C symbol names the
// C++ side expects.
//
// IMPORTANT: these MUST be exported as *function* symbols (not as `static`
// function-pointer variables). C++ declares them via
// `BUN_DECLARE_HOST_FUNCTION(Bun__FileSink__onResolveStream)` and compares the
// resulting symbol address against the handler passed to `JSValue::then` in
// `Zig::GlobalObject::promiseHandlerID`. A `pub static …: JSHostFn = shim`
// exports the address of an 8-byte data slot, which never equals the shim's
// code address → RELEASE_ASSERT_NOT_REACHED at runtime.
//
// TODO(port): gate on `export_cpp_apis` feature in Phase B; replace with
// `#[bun_jsc::host_fn]` once the proc-macro lands.
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

// ported from: src/runtime/webcore/FileSink.zig

// ─── DIAGNOSTIC: FileSink layout probe (Windows fs-promises Strong corruption) ───
