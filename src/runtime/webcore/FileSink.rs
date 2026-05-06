use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicI32, Ordering};

use bun_sys::{self as sys, Fd, FdExt as _};
use bun_io::{self, WriteResult, WriteStatus};

use crate::webcore::jsc::{CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult, Strong, Task};
use crate::webcore::{self, streams, AutoFlusher, Blob, PathOrFileDescriptor};
use crate::webcore::readable_stream::{self, ReadableStream};
// TODO(port): verify module path for `bun.spawn.Status`
use crate::api::bun::process::Status as SpawnStatus;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

bun_core::declare_scope!(FileSink, visible);

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

pub struct FileSink {
    ref_count: Cell<u32>,
    pub writer: IOWriter,
    pub event_loop_handle: EventLoopHandle,
    pub written: usize,
    pub pending: streams::WritablePending,
    pub signal: streams::Signal,
    pub done: bool,
    pub started: bool,
    pub must_be_kept_alive_until_eof: bool,

    // TODO: these fields are duplicated on writer()
    // we should not duplicate these fields...
    pub pollable: bool,
    pub nonblocking: bool,
    pub force_sync: bool,

    pub is_socket: bool,
    pub fd: Fd,

    pub auto_flusher: AutoFlusher,
    pub run_pending_later: FlushPendingTask,

    /// Currently, only used when `stdin` in `Bun.spawn` is a ReadableStream.
    pub readable_stream: readable_stream::Strong,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub js_sink_ref: bun_jsc::strong::Optional,
}

// `bun.ptr.RefCount(FileSink, "ref_count", deinit, .{})` — intrusive single-thread
// refcount. `*FileSink` crosses FFI (JSSink wrapper, `@fieldParentPtr`,
// `asPromisePtr`), so this stays intrusive rather than `Rc<T>`.
// TODO(port): replace hand-rolled ref/deref with `bun_ptr::IntrusiveRc<FileSink>` once available.
impl FileSink {
    #[inline]
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    /// Decrement the intrusive refcount; frees the allocation on zero.
    ///
    /// # Safety
    /// `this` must point to a live `FileSink` allocated via `Box::into_raw`
    /// (see `create*`/`init`) and must carry write+dealloc provenance — i.e.
    /// be derived from the original `*mut FileSink` or an `&mut FileSink`,
    /// never from a `&FileSink`. Taking `&self` here would strip write
    /// provenance and make the `deinit` path UB under Stacked Borrows.
    #[inline]
    pub unsafe fn deref(this: *const Self) {
        // SAFETY: caller contract — `this` is live; `ref_count` is `Cell<u32>`
        // so the shared borrow of just that field is sound.
        let rc = unsafe { &(*this).ref_count };
        let n = rc.get() - 1;
        rc.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; we hold the sole remaining reference.
            // `this` retains the caller's write provenance (no `&self` in the
            // chain), so the `*mut` cast is sound for `deinit` to write through
            // and `Box::from_raw` to reclaim.
            unsafe { Self::deinit(this as *mut Self) };
        }
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
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: BACKREF set via set_parent; unique access for callback duration.
        FileSink::on_close(unsafe { &mut *this })
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see on_close.
        unsafe { (*this).io_evtloop() }
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        // SAFETY: see on_close.
        unsafe { (*this).event_loop_handle.loop_().uv_loop }
    }
}

#[cfg(windows)]
impl bun_io::pipe_writer::WindowsStreamingWriterParent for FileSink {
    const HAS_ON_READY: bool = true;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: BACKREF set via set_parent; unique access for callback duration.
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
        self.writer.memory_cost()
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
    // first field is `sink: FileSink`, so `&mut (*this_ptr).sink` recovers the
    // wrapped `*FileSink` (Zig: `@ptrCast(@alignCast(JSSink.fromJS(...) orelse return))`).
    let this: &mut FileSink = unsafe { &mut (*this_ptr).sink };

    #[cfg(not(windows))]
    {
        this.force_sync = true;
        this.writer.force_sync = true;
        if this.fd != Fd::INVALID {
            let _ = sys::update_nonblocking(this.fd, false);
        }
    }
    #[cfg(windows)]
    {
        if let Some(source) = this.writer.source.as_mut() {
            match source {
                bun_io::Source::Pipe(pipe) => {
                    if uv::uv_stream_set_blocking((*pipe) as *mut _ as *mut uv::uv_stream_t, 1)
                        == uv::ReturnCode::ZERO
                    {
                        return;
                    }
                }
                bun_io::Source::Tty(tty) => {
                    if uv::uv_stream_set_blocking((*tty) as *mut _ as *mut uv::uv_stream_t, 1)
                        == uv::ReturnCode::ZERO
                    {
                        return;
                    }
                }
                _ => {}
            }
        }

        // Fallback to WriteFile() if it fails.
        this.force_sync = true;
    }
}

impl FileSink {
    pub fn on_attached_process_exit(&mut self, status: &SpawnStatus) {
        bun_core::scoped_log!(FileSink, "onAttachedProcessExit()");

        // `writer.close()` below re-enters `onClose` which releases the
        // keep-alive ref, and `stream.cancel`/`runPending` drain microtasks
        // which may drop the JS wrapper's ref. Hold a local ref so `this`
        // stays valid for the rest of this function (same pattern as `onWrite`).
        // PORT NOTE: reshaped for borrowck — `defer self.deref()` via raw-ptr
        // scopeguard so the closure does not borrow `self`.
        self.ref_();
        let this_ptr = self as *mut FileSink;
        let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this_ptr) });

        self.done = true;
        let mut readable_stream = core::mem::take(&mut self.readable_stream);
        if readable_stream.has() {
            if let Some(global) = self.js_global() {
                if let Some(stream) = readable_stream.get(global).as_mut() {
                    if !status.is_ok() {
                        // SAFETY: `bun_vm()` is non-null when `global_object()` was.
                        let event_loop = unsafe { (*global.bun_vm()).event_loop() };
                        // SAFETY: `event_loop()` returns a live `*mut EventLoop`.
                        unsafe { (*event_loop).enter() };
                        let _exit = scopeguard::guard((), move |_| unsafe { (*event_loop).exit() });
                        stream.cancel(global);
                    } else {
                        stream.done(global);
                    }
                }
            }
            // Clean up the readable stream reference
            drop(readable_stream);
        }

        self.writer.close();

        self.pending.result = streams::Writable::Err(sys::Error::from_code(
            sys::Errno::EPIPE,
            sys::Tag::write,
        ));
        self.run_pending();

        // `writer.close()` → `onClose` already released this above; kept for
        // paths where `onClose` isn't reached (e.g. writer already closed).
        self.clear_keep_alive_ref();
    }

    fn run_pending(&mut self) {
        self.ref_();
        let this_ptr = self as *mut FileSink;
        let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this_ptr) });

        self.run_pending_later.has = false;
        let l = self.event_loop();

        l.enter();
        let _exit = scopeguard::guard((), move |_| l.exit());
        self.pending.run();

        // Release the JS wrapper reference now that the pending operation is complete.
        // This was held to prevent GC from collecting the wrapper while the async
        // operation was in progress.
        self.js_sink_ref.deinit();
    }

    pub fn on_write(&mut self, amount: usize, status: WriteStatus) {
        bun_core::scoped_log!(FileSink, "onWrite({}, {})", amount, status as u8);

        // `runPending()` below drains microtasks and may drop the JS wrapper's
        // ref, and `writer.end()`/`writer.close()` re-enter `onClose` which
        // releases the keep-alive ref. Hold a local ref so `this` stays valid
        // for the rest of this function (same pattern as `runPending`/`onAutoFlush`).
        self.ref_();
        let this_ptr = self as *mut FileSink;
        let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this_ptr) });

        self.written += amount;

        // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
        // we should unify the behaviors to simplify this
        let has_pending_data = self.writer.has_pending_data();
        // Only keep the event loop ref'd while there's a pending write in progress.
        // If there's no pending write, no need to keep the event loop ref'd.
        self.writer.update_ref(self.io_evtloop(), has_pending_data);

        if has_pending_data {
            if let Some(vm) = self.js_vm() {
                if !vm.is_inside_deferred_task_queue {
                    AutoFlusher::register_deferred_microtask_with_type::<Self>(self, vm);
                }
            }
        }

        // if we are not done yet and has pending data we just wait so we do not runPending twice
        if status == WriteStatus::Pending && has_pending_data {
            if self.pending.state == streams::PendingState::Pending {
                self.pending.consumed = amount as u32; // @truncate
            }
            return;
        }

        if self.pending.state == streams::PendingState::Pending {
            self.pending.consumed = amount as u32; // @truncate

            // when "done" is true, we will never receive more data.
            if self.done || status == WriteStatus::EndOfFile {
                self.pending.result = streams::Writable::OwnedAndDone(self.pending.consumed);
            } else {
                self.pending.result = streams::Writable::Owned(self.pending.consumed);
            }

            self.run_pending();

            // this.done == true means ended was called
            let ended_and_done = self.done && status == WriteStatus::EndOfFile;

            if self.done && status == WriteStatus::Drained {
                // if we call end/endFromJS and we have some pending returned from .flush() we should call writer.end()
                self.writer.end();
            } else if ended_and_done && !has_pending_data {
                self.writer.close();
            }
        }

        if status == WriteStatus::EndOfFile {
            self.signal.close(None);
            self.clear_keep_alive_ref();
        }
    }

    pub fn on_error(&mut self, err: sys::Error) {
        bun_core::scoped_log!(FileSink, "onError({:?})", err);
        if self.pending.state == streams::PendingState::Pending {
            self.pending.result = streams::Writable::Err(err);
            if let Some(vm) = self.js_vm() {
                if vm.is_inside_deferred_task_queue {
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
        self.signal.ready(None, None);
    }

    pub fn on_close(&mut self) {
        bun_core::scoped_log!(FileSink, "onClose()");
        if self.readable_stream.has() {
            if let Some(global) = self.js_global() {
                if let Some(stream) = self.readable_stream.get(global) {
                    stream.done(global);
                }
            }
        }

        self.signal.close(None);

        // The writer is fully closed; no further callbacks will arrive. Release
        // the ref taken when a write returned `.pending`. This must be the last
        // thing we do as it may free `this`.
        self.clear_keep_alive_ref();
    }

    /// Release the ref taken in `toResult`/`end`/`endFromJS` when a write
    /// returned `.pending` and we needed to stay alive until it completed.
    /// Idempotent via the flag check. May free `this`.
    fn clear_keep_alive_ref(&mut self) {
        if self.must_be_kept_alive_until_eof {
            self.must_be_kept_alive_until_eof = false;
            // SAFETY: `&mut self` carries write provenance over the whole
            // allocation; this is the last use of `self` in this fn.
            unsafe { FileSink::deref(self as *mut Self) };
        }
    }

    #[cfg(windows)]
    pub fn create_with_pipe(
        event_loop_: impl Into<EventLoopHandle>,
        pipe: *mut uv::Pipe,
    ) -> *mut FileSink {
        let evtloop: EventLoopHandle = event_loop_.into();

        let this = Box::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            event_loop_handle: evtloop,
            // SAFETY: `pipe` is a live `*mut uv::Pipe` provided by the caller.
            fd: unsafe { (*pipe).fd() },
            ..FileSink::default_fields()
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this).writer.set_pipe(pipe);
            (*this).writer.set_parent(this);
        }
        this
    }

    // No `#[cfg(not(windows))]` arm: Zig's `@compileError` is lazy (fires only if
    // called on POSIX), but Rust's `compile_error!` is eager. Omitting the fn on
    // POSIX yields the equivalent "no associated function" compile error at call sites.

    pub fn create(event_loop_: impl Into<EventLoopHandle>, fd: Fd) -> *mut FileSink {
        let evtloop: EventLoopHandle = event_loop_.into();
        let this = Box::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            event_loop_handle: evtloop,
            fd,
            ..FileSink::default_fields()
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this).writer.set_parent(this);
        }
        this
    }

    pub fn setup(&mut self, options: &Options) -> sys::Result<()> {
        if self.readable_stream.has() {
            // Already started.
            return sys::Result::Ok(());
        }

        // PORT NOTE: reshaped for borrowck — Zig passed `self` + a closure that
        // mutated `self.force_sync`. Split into a local capture and apply after.
        let mut force_sync_out = self.force_sync;
        // CYCLEBREAK(TYPE_ONLY): `OpenForWritingInput` is impl'd for
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
            &mut self.pollable,
            &mut self.is_socket,
            self.force_sync,
            &mut self.nonblocking,
            &mut force_sync_out,
            |fs: &mut bool| {
                #[cfg(unix)]
                {
                    *fs = true;
                }
            },
            is_pollable,
        );
        #[cfg(unix)]
        if force_sync_out {
            self.force_sync = true;
            self.writer.force_sync = true;
        }

        let fd = match result {
            sys::Result::Err(err) => {
                return sys::Result::Err(err);
            }
            sys::Result::Ok(fd) => fd,
        };

        #[cfg(windows)]
        {
            if self.force_sync {
                match self.writer.start_sync(fd, self.pollable) {
                    sys::Result::Err(err) => {
                        fd.close();
                        return sys::Result::Err(err);
                    }
                    sys::Result::Ok(()) => {
                        self.writer.update_ref(self.io_evtloop(), false);
                    }
                }
                return sys::Result::Ok(());
            }
        }

        match self.writer.start(fd, self.pollable) {
            sys::Result::Err(err) => {
                fd.close();
                return sys::Result::Err(err);
            }
            sys::Result::Ok(()) => {
                // Only keep the event loop ref'd while there's a pending write in progress.
                // If there's no pending write, no need to keep the event loop ref'd.
                self.writer.update_ref(self.io_evtloop(), false);
                #[cfg(unix)]
                {
                    if self.nonblocking {
                        self.writer
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Nonblocking);
                    }

                    if self.is_socket {
                        self.writer
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Socket);
                    } else if self.pollable {
                        self.writer
                            .get_poll()
                            .unwrap()
                            .set_flag(bun_io::FilePollFlag::Fifo);
                    }
                }
            }
        }

        sys::Result::Ok(())
    }

    pub fn loop_(&self) -> *mut bun_uws_sys::Loop {
        #[cfg(windows)]
        {
            self.event_loop_handle.r#loop().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop()
        }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop_handle
    }

    /// CYCLEBREAK: `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the
    /// io-layer `FilePollVTable` round-trips back to the runtime. We pass the
    /// address of the stored `bun_jsc::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; the vtable consumers treat the pointee as read-only
        // (`*const bun_jsc::EventLoopHandle`) to recover the loop pointer and
        // never write through it. The `as *mut` is an erasure cast, not a
        // mutability claim — the field itself is never mutated via this path.
        bun_io::EventLoopHandle(&self.event_loop_handle as *const _ as *mut c_void)
    }

    /// `EventLoopHandle::global_object()` returns an erased `*mut ()`; recover
    /// the typed `&JSGlobalObject` (None for the mini loop or null).
    #[inline]
    fn js_global(&self) -> Option<&JSGlobalObject> {
        let p = self.event_loop_handle.global_object();
        if p.is_null() { return None; }
        // SAFETY: `global_object()` returns an erased `*mut JSGlobalObject` for
        // the Js arm; non-null implies a live global owned by the VM.
        Some(unsafe { &*(p as *const JSGlobalObject) })
    }

    /// `EventLoopHandle::bun_vm()` returns an erased `*mut ()`; recover the
    /// typed `&mut VirtualMachine` (None for the mini loop or null).
    #[inline]
    fn js_vm(&self) -> Option<&mut bun_jsc::VirtualMachineRef> {
        let p = self.event_loop_handle.bun_vm();
        if p.is_null() { return None; }
        // SAFETY: `bun_vm()` returns an erased `*mut VirtualMachine` for the
        // Js arm; non-null implies the per-thread VM, never aliased here.
        Some(unsafe { &mut *(p as *mut bun_jsc::VirtualMachineRef) })
    }

    pub fn connect(&mut self, signal: streams::Signal) {
        self.signal = signal;
    }

    pub fn start(&mut self, stream_start: streams::Start) -> sys::Result<()> {
        match stream_start {
            streams::Start::FileSink(ref file) => {
                // PORT NOTE: `streams::FileSinkOptions` mirrors `file_sink::Options`
                // but is a distinct draft type; bridge by-field until streams.rs
                // aliases to this module's `Options`.
                let opts = Options {
                    chunk_size: file.chunk_size,
                    input_path: match &file.input_path {
                        crate::webcore::PathOrFileDescriptor::Fd(fd) => {
                            PathOrFileDescriptor::Fd(*fd)
                        }
                        crate::webcore::PathOrFileDescriptor::Path(p) => {
                            PathOrFileDescriptor::Path(p.clone())
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

        self.done = false;
        self.started = true;
        self.signal.start();
        sys::Result::Ok(())
    }

    pub fn run_pending_later(&mut self) {
        if self.run_pending_later.has {
            return;
        }
        self.run_pending_later.has = true;
        if let EventLoopHandle::Js { owner, vtable } = self.event_loop() {
            self.ref_();
            // `jsc.Task.init(&this.run_pending_later)` — the comptime type→tag
            // map lives in `crate::dispatch`; the resolved tag for
            // `*FlushPendingTask` is `task_tag::FlushPendingFileSinkTask`.
            let task = bun_event_loop::Task::new(
                bun_event_loop::task_tag::FlushPendingFileSinkTask,
                &mut self.run_pending_later as *mut FlushPendingTask as *mut (),
            );
            // SAFETY: vtable registered by `crate::init()`; `owner` is the
            // erased `*mut jsc::EventLoop` for the Js arm.
            unsafe { (vtable.enqueue_task)(owner, task) };
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        if self.done || !self.writer.has_pending_data() {
            self.update_ref(false);
            self.auto_flusher.registered = false;
            return false;
        }

        self.ref_();
        let this_ptr = self as *mut FileSink;
        let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this_ptr) });

        let amount_buffered = self.writer.outgoing.size();

        match self.writer.flush() {
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

        let is_registered = !self.writer.has_pending_data();
        self.auto_flusher.registered = is_registered;
        is_registered
    }

    pub fn flush(&mut self) -> sys::Result<()> {
        sys::Result::Ok(())
    }

    pub fn flush_from_js(&mut self, global_this: &JSGlobalObject, wait: bool) -> sys::Result<JSValue> {
        let _ = wait;

        if self.pending.state == streams::PendingState::Pending {
            if let streams::WritableFuture::Promise { strong, .. } = &self.pending.future {
                return sys::Result::Ok(strong.value());
            }
        }

        if self.done {
            return sys::Result::Ok(JSValue::UNDEFINED);
        }

        let rc = self.writer.flush();
        match rc {
            WriteResult::Done(written) => {
                self.written += written as usize; // @truncate
            }
            WriteResult::Pending(written) => {
                self.written += written as usize; // @truncate
            }
            WriteResult::Wrote(written) => {
                self.written += written as usize; // @truncate
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
        self.readable_stream = readable_stream::Strong::default();
        self.pending = streams::WritablePending::default();
        self.js_sink_ref.deinit();
        // SAFETY: `&mut self` carries write provenance over the whole
        // allocation; this is the last use of `self` in `finalize`.
        unsafe { FileSink::deref(self as *mut Self) };
    }

    /// Protect the JS wrapper object from GC collection while an async operation is pending.
    /// This should be called when endFromJS returns a pending Promise.
    /// The reference is released when runPending() completes.
    pub fn protect_js_wrapper(&mut self, global_this: &JSGlobalObject, js_wrapper: JSValue) {
        self.js_sink_ref.set(global_this, js_wrapper);
    }

    pub fn init(fd: Fd, event_loop_handle: impl Into<EventLoopHandle>) -> *mut FileSink {
        let this = Box::into_raw(Box::new(FileSink {
            ref_count: Cell::new(1),
            writer: IOWriter::default(),
            fd,
            event_loop_handle: event_loop_handle.into(),
            ..FileSink::default_fields()
        }));
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        // SAFETY: `this` was just allocated above and is the sole reference.
        unsafe {
            (*this).writer.set_parent(this);
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
            } as *mut ()),
            ..FileSink::default_fields()
        };
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        this
    }

    pub fn write(&mut self, data: streams::Result) -> streams::Writable {
        if self.done {
            return streams::Writable::Done;
        }
        let rc = self.writer.write(data.slice());
        self.to_result(rc)
    }

    #[inline]
    pub fn write_bytes(&mut self, data: streams::Result) -> streams::Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: streams::Result) -> streams::Writable {
        if self.done {
            return streams::Writable::Done;
        }
        let rc = self.writer.write_latin1(data.slice());
        self.to_result(rc)
    }

    pub fn write_utf16(&mut self, data: streams::Result) -> streams::Writable {
        if self.done {
            return streams::Writable::Done;
        }
        let rc = self.writer.write_utf16(data.slice16());
        self.to_result(rc)
    }

    pub fn end(&mut self, _err: Option<sys::Error>) -> sys::Result<()> {
        if self.done {
            return sys::Result::Ok(());
        }

        match self.writer.flush() {
            WriteResult::Done(written) => {
                self.written += written as usize; // @truncate
                self.writer.end();
                sys::Result::Ok(())
            }
            WriteResult::Err(e) => {
                self.writer.close();
                sys::Result::Err(e)
            }
            WriteResult::Pending(written) => {
                self.written += written as usize; // @truncate
                if !self.must_be_kept_alive_until_eof {
                    self.must_be_kept_alive_until_eof = true;
                    self.ref_();
                }
                self.done = true;
                sys::Result::Ok(())
            }
            WriteResult::Wrote(written) => {
                self.written += written as usize; // @truncate
                self.writer.end();
                sys::Result::Ok(())
            }
        }
    }

    /// Called when the intrusive refcount reaches zero. Frees `self`.
    ///
    /// # Safety
    /// `this` must have been allocated via `Box::into_raw` (see `create`/`init`)
    /// and the caller must hold the last reference.
    unsafe fn deinit(this: *mut FileSink) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        // SAFETY: caller contract — `this` is valid and uniquely owned.
        let self_ = unsafe { &mut *this };
        // PORT NOTE: pending/readable_stream/js_sink_ref are dropped by Box drop
        // below; explicit `.deinit()` calls from the Zig are subsumed.
        if let Some(global) = self_.js_global() {
            // SAFETY: `bun_vm()` is non-null when `js_global()` returned Some.
            let vm = unsafe { &mut *global.bun_vm() };
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self_, vm);
        }
        // SAFETY: `this` was produced by `Box::into_raw` in the constructors.
        drop(unsafe { Box::from_raw(this) });
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

    pub fn end_from_js(&mut self, global_this: &JSGlobalObject) -> sys::Result<JSValue> {
        if self.done {
            if self.pending.state == streams::PendingState::Pending {
                if let streams::WritableFuture::Promise { strong, .. } = &self.pending.future {
                    return sys::Result::Ok(strong.value());
                }
            }
            return sys::Result::Ok(JSValue::js_number(self.written as f64));
        }

        let flush_result = self.writer.flush();

        match flush_result {
            WriteResult::Done(written) => {
                self.update_ref(false);
                self.writer.end();
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
            WriteResult::Err(err) => {
                self.writer.close();
                sys::Result::Err(err)
            }
            WriteResult::Pending(pending_written) => {
                self.written += pending_written as usize; // @truncate
                if !self.must_be_kept_alive_until_eof {
                    self.must_be_kept_alive_until_eof = true;
                    self.ref_();
                }
                self.done = true;
                self.pending.result = streams::Writable::Owned(pending_written as u32);

                let promise_result = self.pending.promise(global_this);

                // SAFETY: `WritablePending::promise()` never returns null.
                sys::Result::Ok(unsafe { (*promise_result).to_js() })
            }
            WriteResult::Wrote(written) => {
                self.writer.end();
                sys::Result::Ok(JSValue::js_number(written as f64))
            }
        }
    }

    pub fn sink(&mut self) -> crate::webcore::sink::Sink<'_> {
        crate::webcore::sink::Sink::init(self)
    }

    pub fn update_ref(&mut self, value: bool) {
        if value {
            self.writer.enable_keeping_process_alive(self.io_evtloop());
        } else {
            self.writer.disable_keeping_process_alive(self.io_evtloop());
        }
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
    fn FileSink__fromJS(value: JSValue) -> usize;
    #[link_name = "FileSink__createObject"]
    fn FileSink__createObject(
        global: *mut JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue;
    #[link_name = "FileSink__setDestroyCallback"]
    fn FileSink__setDestroyCallback(value: JSValue, callback: usize);
    #[link_name = "FileSink__assignToStream"]
    fn FileSink__assignToStream(
        global: *mut JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue;
    #[link_name = "FileSink__onClose"]
    fn FileSink__onClose(ptr: JSValue, reason: JSValue);
    #[link_name = "FileSink__onReady"]
    fn FileSink__onReady(ptr: JSValue, amount: JSValue, offset: JSValue);
}

impl crate::webcore::sink::JsSinkAbi for FileSink {
    unsafe fn from_js_extern(value: JSValue) -> usize {
        unsafe { FileSink__fromJS(value) }
    }
    unsafe fn create_object_extern(
        global: *mut JSGlobalObject,
        object: *mut c_void,
        destructor: usize,
    ) -> JSValue {
        unsafe { FileSink__createObject(global, object, destructor) }
    }
    unsafe fn set_destroy_callback_extern(value: JSValue, callback: usize) {
        unsafe { FileSink__setDestroyCallback(value, callback) }
    }
    unsafe fn assign_to_stream_extern(
        global: *mut JSGlobalObject,
        stream: JSValue,
        ptr: *mut c_void,
        jsvalue_ptr: *mut *mut c_void,
    ) -> JSValue {
        unsafe { FileSink__assignToStream(global, stream, ptr, jsvalue_ptr) }
    }
    unsafe fn on_close_extern(ptr: JSValue, reason: JSValue) {
        unsafe { FileSink__onClose(ptr, reason) }
    }
    unsafe fn on_ready_extern(ptr: JSValue, amount: JSValue, offset: JSValue) {
        unsafe { FileSink__onReady(ptr, amount, offset) }
    }
}

impl FileSink {
    fn get_fd(&self) -> i32 {
        #[cfg(windows)]
        {
            match self.fd.decode_windows() {
                bun_sys::WindowsFd::Windows(_) => -1, // TODO:
                bun_sys::WindowsFd::Uv(num) => num,
            }
        }
        #[cfg(not(windows))]
        {
            self.fd.cast()
        }
    }

    fn to_result(&mut self, write_result: WriteResult) -> streams::Writable {
        match write_result {
            WriteResult::Done(amt) => {
                if amt > 0 {
                    return streams::Writable::OwnedAndDone(amt as u32);
                }
                streams::Writable::Done
            }
            WriteResult::Wrote(amt) => {
                if amt > 0 {
                    return streams::Writable::Owned(amt as u32);
                }
                streams::Writable::Temporary(amt as u32)
            }
            WriteResult::Err(err) => streams::Writable::Err(err),
            WriteResult::Pending(pending_written) => {
                if !self.must_be_kept_alive_until_eof {
                    self.must_be_kept_alive_until_eof = true;
                    self.ref_();
                }
                self.pending.consumed += pending_written as u32; // @truncate
                self.pending.result = streams::Writable::Owned(pending_written as u32);
                streams::Writable::Pending(&mut self.pending as *mut _)
            }
        }
    }

    // Helper for struct-init defaults (Zig field defaults).
    // TODO(port): replace with `impl Default for FileSink` once all field types
    // implement `Default`; kept private to avoid exposing a half-initialized state.
    fn default_fields() -> FileSink {
        FileSink {
            ref_count: Cell::new(1),
            writer: IOWriter::default(),
            // PORT NOTE: `EventLoopHandle` has no `Default`; null Js variant is the
            // closest sentinel — every constructor overwrites this field.
            event_loop_handle: EventLoopHandle::init(core::ptr::null_mut()),
            written: 0,
            pending: streams::WritablePending {
                result: streams::Writable::Done,
                ..Default::default()
            },
            signal: streams::Signal::default(),
            done: false,
            started: false,
            must_be_kept_alive_until_eof: false,
            pollable: false,
            nonblocking: false,
            force_sync: false,
            is_socket: false,
            fd: Fd::INVALID,
            auto_flusher: AutoFlusher::default(),
            run_pending_later: FlushPendingTask::default(),
            readable_stream: readable_stream::Strong::default(),
            js_sink_ref: bun_jsc::strong::Optional::empty(),
        }
    }
}

#[derive(Default)]
pub struct FlushPendingTask {
    pub has: bool,
}

impl FlushPendingTask {
    pub fn run_from_js_thread(flush_pending: *mut FlushPendingTask) {
        // SAFETY: `flush_pending` points to `FileSink.run_pending_later` of a
        // live FileSink (the task was enqueued from `run_pending_later()` which
        // took a ref on the parent).
        let had = unsafe { (*flush_pending).has };
        unsafe { (*flush_pending).has = false };
        // SAFETY: `flush_pending` is the `run_pending_later` field of a `FileSink`.
        let this: *mut FileSink = unsafe {
            (flush_pending as *mut u8)
                .sub(offset_of!(FileSink, run_pending_later))
                .cast::<FileSink>()
        };
        let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this) });
        if had {
            unsafe { (*this).run_pending() };
        }
    }
}

impl FileSink {
    /// Does not ref or unref.
    fn handle_resolve_stream(&mut self, global_this: &JSGlobalObject) {
        if let Some(stream) = self.readable_stream.get(global_this).as_mut() {
            stream.done(global_this);
        }

        if !self.done {
            self.writer.close();
        }
    }

    /// Does not ref or unref.
    fn handle_reject_stream(&mut self, global_this: &JSGlobalObject, _err: JSValue) {
        if let Some(stream) = self.readable_stream.get(global_this).as_mut() {
            stream.abort(global_this);
            self.readable_stream = readable_stream::Strong::default();
        }

        if !self.done {
            self.writer.close();
        }
    }
}

// TODO(port): #[bun_jsc::host_fn]
fn on_resolve_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_core::scoped_log!(FileSink, "onResolveStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this deref balances it.
    let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this) });
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
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this deref balances it.
    let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this) });
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
        let signal = &mut self.signal;
        *signal = SinkSignal::init(JSValue::ZERO);
        self.ref_();
        let this_ptr = self as *mut FileSink;
        let _guard = scopeguard::guard((), move |_| unsafe { FileSink::deref(this_ptr) });

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        self.signal.clear();

        self.readable_stream = readable_stream::Strong::init(stream, global_this);
        // PORT NOTE: reshaped for borrowck — re-borrow `signal` after assigning
        // `readable_stream`.
        let signal_ptr: *mut *mut c_void = &mut self.signal.ptr as *mut _ as *mut *mut c_void;
        let promise_result =
            JSSink::assign_to_stream(global_this, stream.value, self, signal_ptr);

        if let Some(err) = promise_result.to_error() {
            self.readable_stream = readable_stream::Strong::default();
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
                    bun_jsc::AnyPromise::Internal(p) => p as *mut bun_jsc::JSPromise,
                };
                // SAFETY: `as_any_promise` returned non-null.
                match unsafe { (*js_promise).status() } {
                    bun_jsc::js_promise::Status::Pending => {
                        self.writer.enable_keeping_process_alive(self.io_evtloop());
                        self.ref_();
                        // TODO: properly propagate exception upwards
                        // PORT NOTE: `JSValue::then` takes already-wrapped C-ABI
                        // host fns; the `toJSHostFunction` step is the manual
                        // shims at the bottom of this file.
                        promise_result.then(
                            global_this,
                            self as *mut FileSink,
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
// TODO(port): gate on `export_cpp_apis` feature in Phase B; replace with
// `#[bun_jsc::host_fn]` once the proc-macro lands.
unsafe extern "C" fn on_resolve_stream_shim(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    // SAFETY: JSC guarantees both pointers are valid for the call.
    match on_resolve_stream(unsafe { &*global }, unsafe { &*callframe }) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}
unsafe extern "C" fn on_reject_stream_shim(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    // SAFETY: JSC guarantees both pointers are valid for the call.
    match on_reject_stream(unsafe { &*global }, unsafe { &*callframe }) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}
#[unsafe(no_mangle)]
pub static Bun__FileSink__onResolveStream: bun_jsc::JSHostFn = on_resolve_stream_shim;
#[unsafe(no_mangle)]
pub static Bun__FileSink__onRejectStream: bun_jsc::JSHostFn = on_reject_stream_shim;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/FileSink.zig (862 lines)
//   confidence: medium
//   todos:      10
//   notes:      intrusive refcount + @fieldParentPtr kept raw; scopeguard used for ref/deref defers; JSSink/StreamingWriter generic instantiation and host-fn export wiring need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
