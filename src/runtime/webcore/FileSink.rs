use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicI32, Ordering};

use bun_sys::{self as sys, Fd, FdExt as _};
use bun_io::{self, WriteResult, WriteStatus};
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_jsc::JsCell;

use crate::webcore::jsc::{CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult, Strong, Task};
use crate::webcore::{self, streams, AutoFlusher, Blob, PathOrFileDescriptor};
use crate::webcore::readable_stream::{self, ReadableStream};
// TODO(port): verify module path for `bun.spawn.Status`
use crate::api::bun::process::Status as SpawnStatus;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
#[cfg(windows)]
use bun_sys::windows::libuv::UvHandle as _;

bun_core::declare_scope!(FileSink, visible);

/// Local shim for `JSValue.asPromisePtr` (not yet exported from `bun_jsc`):
/// recover the `*mut T` smuggled through `Promise.then`'s trailing context arg.
trait JSValuePromisePtrExt {
    fn as_promise_ptr<T>(self) -> *mut T;
}
impl JSValuePromisePtrExt for JSValue {
    #[inline]
    fn as_promise_ptr<T>(self) -> *mut T {
        // PORT NOTE: Zig `asPromisePtr` does `@ptrFromInt(@intFromFloat(asNumber()))`.
        self.as_number() as usize as *mut T
    }
}

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

// R-2 (`&mut self` host-fn re-entrancy → noalias UB): JS-reachable host-fns
// take `&self` and mutate via `Cell`/`JsCell`. The codegen shim (Phase 1)
// still passes `&mut T`, but `&mut T` auto-derefs to `&T`, so this compiles
// today and becomes sound once the shim flips. Init-time / IO-callback /
// finalize paths keep `&mut self` for write+dealloc provenance (they reach
// `FileSink::deref` which may `heap::take`).
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct FileSink {
    ref_count: Cell<u32>,
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
#[cfg(unix)]
impl bun_io::pipe_writer::PosixStreamingWriterParent for FileSink {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::posix_event_loop::poll_tag::FILE_SINK;
    const HAS_ON_READY: bool = true;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: `this` is the BACKREF set via set_parent; the StreamingWriter
        // never materializes `&mut FileSink`, so this is the unique access path
        // for the callback's duration.
        FileSink::on_write(unsafe { &mut *this }, amount, status)
    }
    unsafe fn on_error(this: *mut Self, err: sys::Error) {
        // SAFETY: see on_write.
        FileSink::on_error(unsafe { &mut *this }, err)
    }
    unsafe fn on_ready(this: *mut Self) {
        // SAFETY: see on_write.
        FileSink::on_ready(unsafe { &mut *this })
    }
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: see on_write.
        FileSink::on_close(unsafe { &mut *this })
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see on_write. Shared-only read of event_loop_handle.
        unsafe { (*this).io_evtloop() }
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        // SAFETY: see on_write. Shared-only read of event_loop_handle.
        unsafe { (*this).event_loop_handle.r#loop() }
    }
}

#[cfg(windows)]
impl bun_io::pipe_writer::WindowsWriterParent for FileSink {
    unsafe fn loop_(this: *mut Self) -> *mut bun_libuv_sys::Loop {
        // SAFETY: BACKREF set via set_parent; shared-only read of
        // `event_loop_handle`.
        unsafe { (*this).event_loop_handle.uv_loop() }
    }
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: see loop_. Intrusive single-thread refcount bump.
        unsafe { &*this }.ref_()
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see loop_. May free `this`.
        unsafe { FileSink::deref(this) }
    }
}

#[cfg(windows)]
impl bun_io::pipe_writer::WindowsStreamingWriterParent for FileSink {
    // Zig: `onReady = FileSink.onReady` — the Windows StreamingWriter calls this
    // hook `onWritable`; map FileSink's `on_ready` onto it.
    const HAS_ON_WRITABLE: bool = true;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: BACKREF set via set_parent; unique access for callback duration.
        FileSink::on_write(unsafe { &mut *this }, amount, status)
    }
    unsafe fn on_error(this: *mut Self, err: sys::Error) {
        // SAFETY: see on_write.
        FileSink::on_error(unsafe { &mut *this }, err)
    }
    unsafe fn on_writable(this: *mut Self) {
        // SAFETY: see on_write.
        FileSink::on_ready(unsafe { &mut *this })
    }
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: see on_write.
        FileSink::on_close(unsafe { &mut *this })
    }
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
    pub fn on_attached_process_exit(&mut self, status: &SpawnStatus) {
        bun_core::scoped_log!(FileSink, "onAttachedProcessExit()");

        // `writer.close()` below re-enters `onClose` which releases the
        // keep-alive ref, and `stream.cancel`/`runPending` drain microtasks
        // which may drop the JS wrapper's ref. Hold a local ref so `this`
        // stays valid for the rest of this function (same pattern as `onWrite`).
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) };

        self.done.set(true);
        let mut readable_stream = self.readable_stream.replace(readable_stream::Strong::default());
        if readable_stream.has() {
            if let Some(global) = self.js_global() {
                if let Some(stream) = readable_stream.get(global).as_mut() {
                    if !status.is_ok() {
                        // SAFETY: `bun_vm()` is non-null when `global_object()` was;
                        // `event_loop()` returns the live VM-owned `*mut EventLoop`.
                        let _entered = unsafe {
                            bun_jsc::event_loop::EventLoop::enter_scope(
                                global.bun_vm().as_mut().event_loop(),
                            )
                        };
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
        self.writer.with_mut(|w| w.close());

        self.pending.with_mut(|p| {
            p.result = streams::Writable::Err(sys::Error::from_code(
                sys::Errno::EPIPE,
                sys::Tag::write,
            ));
        });
        self.run_pending();

        // `writer.close()` → `onClose` already released this above; kept for
        // paths where `onClose` isn't reached (e.g. writer already closed).
        self.clear_keep_alive_ref();
    }

    fn run_pending(&mut self) {
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) };

        self.run_pending_later.has.set(false);

        let _entered = self.event_loop().entered();
        // SAFETY(JsCell): `WritablePending::run` resolves a JSPromise which may
        // re-enter JS, but no other path holds a borrow of `self.pending` for
        // the duration (host-fns gate on `pending.state != Pending` first).
        unsafe { self.pending.get_mut() }.run();

        // Release the JS wrapper reference now that the pending operation is complete.
        // This was held to prevent GC from collecting the wrapper while the async
        // operation was in progress.
        self.js_sink_ref.with_mut(|r| r.deinit());
    }

    pub fn on_write(&mut self, amount: usize, status: WriteStatus) {
        bun_core::scoped_log!(FileSink, "onWrite({}, {})", amount, status as u8);

        // `runPending()` below drains microtasks and may drop the JS wrapper's
        // ref, and `writer.end()`/`writer.close()` re-enter `onClose` which
        // releases the keep-alive ref. Hold a local ref so `this` stays valid
        // for the rest of this function (same pattern as `runPending`/`onAutoFlush`).
        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) };

        self.written.set(self.written.get() + amount);

        // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
        // we should unify the behaviors to simplify this
        let has_pending_data = self.writer.get().has_pending_data();
        // Only keep the event loop ref'd while there's a pending write in progress.
        // If there's no pending write, no need to keep the event loop ref'd.
        // `with_mut`: Windows `update_ref` is `&mut self` (posix is `&self`).
        self.writer.with_mut(|w| w.update_ref(self.io_evtloop(), has_pending_data));

        if has_pending_data {
            // PORT NOTE: inline `js_vm()` to avoid holding an immutable borrow of
            // `self` (via the returned `&VirtualMachine`) across the `&mut self`
            // needed by `register_deferred_microtask_with_type`.
            let vm_ptr = self.event_loop_handle.bun_vm().cast::<bun_jsc::VirtualMachineRef>();
            if !vm_ptr.is_null() {
                // SAFETY: `bun_vm()` non-null implies the per-thread VM; never aliased here.
                let vm = unsafe { &*vm_ptr };
                if !vm.is_inside_deferred_task_queue.get() {
                    AutoFlusher::register_deferred_microtask_with_type::<Self>(self, vm);
                }
            }
        }

        // if we are not done yet and has pending data we just wait so we do not runPending twice
        if status == WriteStatus::Pending && has_pending_data {
            if self.pending.get().state == streams::PendingState::Pending {
                self.pending.with_mut(|p| p.consumed = amount as u64); // @truncate
            }
            return;
        }

        if self.pending.get().state == streams::PendingState::Pending {
            self.pending.with_mut(|p| p.consumed = amount as u64); // @truncate

            // when "done" is true, we will never receive more data.
            let consumed = self.pending.get().consumed;
            if self.done.get() || status == WriteStatus::EndOfFile {
                self.pending.with_mut(|p| p.result = streams::Writable::OwnedAndDone(consumed));
            } else {
                self.pending.with_mut(|p| p.result = streams::Writable::Owned(consumed));
            }

            self.run_pending();

            // this.done == true means ended was called
            let ended_and_done = self.done.get() && status == WriteStatus::EndOfFile;

            if self.done.get() && status == WriteStatus::Drained {
                // if we call end/endFromJS and we have some pending returned from .flush() we should call writer.end()
                self.writer.with_mut(|w| w.end());
            } else if ended_and_done && !has_pending_data {
                self.writer.with_mut(|w| w.close());
            }
        }

        if status == WriteStatus::EndOfFile {
            self.signal.with_mut(|s| s.close(None));
            self.clear_keep_alive_ref();
        }
    }

    pub fn on_error(&mut self, err: sys::Error) {
        bun_core::scoped_log!(FileSink, "onError({:?})", err);
        if self.pending.get().state == streams::PendingState::Pending {
            self.pending.with_mut(|p| p.result = streams::Writable::Err(err));
            if let Some(vm) = self.js_vm() {
                if vm.is_inside_deferred_task_queue.get() {
                    self.run_pending_later();
                    #[cfg(windows)]
                    self.clear_keep_alive_ref();
                    return;
                }
            }

            self.run_pending();
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
        self.clear_keep_alive_ref();
    }

    pub fn on_ready(&mut self) {
        bun_core::scoped_log!(FileSink, "onReady()");
        self.signal.with_mut(|s| s.ready(None, None));
    }

    pub fn on_close(&mut self) {
        bun_core::scoped_log!(FileSink, "onClose()");
        // SAFETY(JsCell): `Strong::has`/`get` are read-only on the GC root.
        if unsafe { self.readable_stream.get_mut() }.has() {
            if let Some(global) = self.js_global() {
                if let Some(stream) = self.readable_stream.get().get(global) {
                    stream.done(global);
                }
            }
        }

        self.signal.with_mut(|s| s.close(None));

        // The writer is fully closed; no further callbacks will arrive. Release
        // the ref taken when a write returned `.pending`. This must be the last
        // thing we do as it may free `this`.
        self.clear_keep_alive_ref();
    }

    /// Release the ref taken in `toResult`/`end`/`endFromJS` when a write
    /// returned `.pending` and we needed to stay alive until it completed.
    /// Idempotent via the flag check. May free `this`.
    fn clear_keep_alive_ref(&mut self) {
        if self.must_be_kept_alive_until_eof.get() {
            self.must_be_kept_alive_until_eof.set(false);
            // SAFETY: `&mut self` carries write provenance over the whole
            // allocation; this is the last use of `self` in this fn.
            unsafe { FileSink::deref(std::ptr::from_mut::<Self>(self)) };
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
                bun_io::PathOrFileDescriptor::Path(bun_string::PathString::init(slice.slice()))
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
                match self.writer.with_mut(|w| w.start_sync(fd, self.pollable.get())) {
                    sys::Result::Err(err) => {
                        fd.close();
                        return sys::Result::Err(err);
                    }
                    sys::Result::Ok(()) => {
                        self.writer.with_mut(|w| w.update_ref(self.io_evtloop(), false));
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
                self.writer.with_mut(|w| w.update_ref(self.io_evtloop(), false));
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
        #[cfg(windows)]
        {
            self.event_loop_handle.uv_loop()
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop()
        }
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
        if p.is_null() { return None; }
        // SAFETY: `global_object()` returns an erased `*mut JSGlobalObject` for
        // the Js arm; non-null implies a live global owned by the VM.
        Some(unsafe { &*p.cast::<JSGlobalObject>() })
    }

    /// `EventLoopHandle::bun_vm()` returns an erased `*mut ()`; recover the
    /// typed `&mut VirtualMachine` (None for the mini loop or null).
    #[inline]
    fn js_vm(&self) -> Option<&mut bun_jsc::VirtualMachineRef> {
        let p = self.event_loop_handle.bun_vm();
        if p.is_null() { return None; }
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
                                bun_str::zig_string::Slice::from_utf8_never_free(p.slice()),
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

    pub fn run_pending_later(&mut self) {
        if self.run_pending_later.has.get() {
            return;
        }
        self.run_pending_later.has.set(true);
        if let EventLoopHandle::Js { owner } = self.event_loop() {
            self.ref_();
            // `jsc.Task.init(&this.run_pending_later)` — the comptime type→tag
            // map lives in `crate::dispatch`; the resolved tag for
            // `*FlushPendingTask` is `task_tag::FlushPendingFileSinkTask`.
            let task = bun_event_loop::Task::new(
                bun_event_loop::task_tag::FlushPendingFileSinkTask,
                (&raw mut self.run_pending_later).cast::<()>(),
            );
            owner.enqueue_task(task);
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        if self.done.get() || !self.writer.get().has_pending_data() {
            self.update_ref(false);
            self.auto_flusher.with_mut(|a| a.registered = false);
            return false;
        }

        // SAFETY: `&mut self` carries write+dealloc provenance over the allocation.
        let _guard = unsafe { FileSinkRef::new_ref(std::ptr::from_mut::<FileSink>(self)) };

        let amount_buffered = self.writer.get().outgoing.size();

        // SAFETY(JsCell): `IOWriter::flush` is pure I/O; the `on_write`
        // callback it may trigger goes via the stored `*mut FileSink` backref.
        match self.writer.with_mut(|w| w.flush()) {
            WriteResult::Err(_) | WriteResult::Done(_) => {
                self.update_ref(false);
                self.run_pending_later();
            }
            WriteResult::Wrote(amount_drained) => {
                if amount_drained == amount_buffered {
                    self.update_ref(false);
                    self.run_pending_later();
                }
            }
            _ => {
                return true;
            }
        }

        let is_registered = !self.writer.get().has_pending_data();
        self.auto_flusher.with_mut(|a| a.registered = is_registered);
        is_registered
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
        self.js_sink_ref.with_mut(|r| r.set(global_this, js_wrapper));
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
            event_loop_handle: EventLoopHandle::init(unsafe {
                (*bun_jsc::VirtualMachineRef::get()).event_loop()
            }.cast::<()>()),
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
        JSSink::create_object(global_this, self, destructor.unwrap_or(0))
    }

    pub fn end_from_js(&self, global_this: &JSGlobalObject) -> sys::Result<JSValue> {
        if self.done.get() {
            if self.pending.get().state == streams::PendingState::Pending {
                if let streams::WritableFuture::Promise { strong, .. } = &self.pending.get().future {
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
                self.written.set(self.written.get() + pending_written as usize); // @truncate
                if !self.must_be_kept_alive_until_eof.get() {
                    self.must_be_kept_alive_until_eof.set(true);
                    self.ref_();
                }
                self.done.set(true);
                self.pending.with_mut(|p| p.result = streams::Writable::Owned(pending_written as u64));

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

// `SinkHandler` impl: bridges `Sink::init(self)` (vtable-erased writer). The
// inherent `connect` returns `()`; trait wants `sys::Result<()>` to unify with
// other sink types' fallible connect.
impl crate::webcore::sink::SinkHandler for FileSink {
    fn write(&mut self, data: streams::Result) -> streams::Writable {
        FileSink::write(self, data)
    }
    fn write_latin1(&mut self, data: streams::Result) -> streams::Writable {
        FileSink::write_latin1(self, data)
    }
    fn write_utf16(&mut self, data: streams::Result) -> streams::Writable {
        FileSink::write_utf16(self, data)
    }
    fn end(&mut self, err: Option<sys::Error>) -> sys::Result<()> {
        FileSink::end(self, err)
    }
    fn connect(&mut self, signal: streams::Signal) -> sys::Result<()> {
        FileSink::connect(self, signal);
        sys::Result::Ok(())
    }
}

// The second `Sink.JSSink(@This(), "FileSink")` arg is a comptime string used
// for codegen symbol naming; Rust can't drive `#[link_name]` from a const
// generic, so the resolved externs are spelled out here and surfaced via
// `JsSinkAbi` so the generic `JSSink<FileSink>` can dispatch.
unsafe extern "C" {
    #[link_name = "FileSink__fromJS"]
    safe fn FileSink__fromJS(value: JSValue) -> usize;
    #[link_name = "FileSink__createObject"]
    // `&JSGlobalObject` discharges the only deref'd-param precondition;
    // `object`/`destructor` are stored opaquely in the JS wrapper.
    safe fn FileSink__createObject(
        global: &JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue;
    #[link_name = "FileSink__setDestroyCallback"]
    safe fn FileSink__setDestroyCallback(value: JSValue, callback: usize);
    #[link_name = "FileSink__assignToStream"]
    fn FileSink__assignToStream(
        global: *mut JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue;
    #[link_name = "FileSink__onClose"]
    safe fn FileSink__onClose(ptr: JSValue, reason: JSValue);
    #[link_name = "FileSink__onReady"]
    safe fn FileSink__onReady(ptr: JSValue, amount: JSValue, offset: JSValue);
}

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

impl crate::webcore::sink::JsSinkAbi for FileSink {
    fn from_js_extern(value: JSValue) -> usize {
        FileSink__fromJS(value)
    }
    fn create_object_extern(
        global: &JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue {
        FileSink__createObject(global, object, destructor)
    }
    fn set_destroy_callback_extern(value: JSValue, callback: usize) {
        FileSink__setDestroyCallback(value, callback)
    }
    fn assign_to_stream_extern(
        global: &JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue {
        // SAFETY: FFI into generated C++ sink glue; `global.as_ptr()` is the
        // sanctioned &self → *mut for opaque JSC handles.
        unsafe { FileSink__assignToStream(global.as_ptr(), stream, ptr, jsvalue_ptr) }
    }
    fn on_close_extern(ptr: JSValue, reason: JSValue) {
        FileSink__onClose(ptr, reason)
    }
    fn on_ready_extern(ptr: JSValue, amount: JSValue, offset: JSValue) {
        FileSink__onReady(ptr, amount, offset)
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
        // took a ref on the parent).
        let had = unsafe { (*flush_pending).has.get() };
        unsafe { (*flush_pending).has.set(false) };
        // SAFETY: `flush_pending` is the `run_pending_later` field of a `FileSink`.
        let this: *mut FileSink = unsafe {
            bun_core::from_field_ptr!(FileSink, run_pending_later, flush_pending)
        };
        // SAFETY: balances the `ref_()` taken in `run_pending_later()` when
        // this task was enqueued; `this` is live for at least that ref.
        let _guard = unsafe { FileSinkRef::adopt(this) };
        if had {
            unsafe { (*this).run_pending() };
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

        self.readable_stream.set(readable_stream::Strong::init(*stream, global_this));
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
        let promise_result =
            JSSink::assign_to_stream(global_this, stream.value, self, signal_ptr);

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
                        self.writer.with_mut(|w| w.enable_keeping_process_alive(self.io_evtloop()));
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
        // SAFETY: JSC guarantees both pointers are valid for the call. Kept as
        // raw `JsHostFn` shape so the fn-item coerces to `.then()`'s `JsHostFn`
        // pointer slot without a transmute.
        match on_resolve_stream(unsafe { &*g }, unsafe { &*cf }) {
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
        // SAFETY: JSC guarantees both pointers are valid for the call.
        match on_reject_stream(unsafe { &*g }, unsafe { &*cf }) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}

// ported from: src/runtime/webcore/FileSink.zig
