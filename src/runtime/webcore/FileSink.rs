use core::cell::Cell;
use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicI32, Ordering};

use bun_jsc::{CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult, Strong, Task};
use bun_sys::{self as sys, Fd};
use bun_io::{self, WriteResult, WriteStatus};
use bun_output;

use crate::webcore::{self, streams, AutoFlusher, Blob, PathOrFileDescriptor, ReadableStream, Sink};
// TODO(port): verify module path for `bun.spawn.Status`
use crate::api::bun::spawn::Status as SpawnStatus;

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

bun_output::declare_scope!(FileSink, visible);

// ───────────────────────────────────────────────────────────────────────────
// FileSink
// ───────────────────────────────────────────────────────────────────────────

pub struct FileSink {
    ref_count: Cell<u32>,
    pub writer: IOWriter,
    pub event_loop_handle: EventLoopHandle,
    pub written: usize,
    pub pending: streams::result::writable::Pending,
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
    pub readable_stream: ReadableStream::Strong,

    /// Strong reference to the JS wrapper object to prevent GC from collecting it
    /// while an async operation is pending. This is set when endFromJS returns a
    /// pending Promise and cleared when the operation completes.
    pub js_sink_ref: Strong,
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

    #[inline]
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; we are the sole remaining reference and
            // `self` was allocated via `Box::into_raw` in `create*`/`init`.
            unsafe { Self::deinit(self as *const Self as *mut Self) };
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

    #[bun_jsc::host_fn]
    pub fn file_sink_live_count(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(LIVE_COUNT.load(Ordering::Relaxed)))
    }
}

/// `bun.io.StreamingWriter(@This(), opaque { onClose, onWritable, onError, onWrite })`.
/// The Zig passes a comptime vtable via an `opaque {}` with decls; in Rust the
/// parent type implements the handler trait directly.
pub type IOWriter = bun_io::StreamingWriter<FileSink>;
pub type Poll = IOWriter;

// TODO(port): exact trait name/signature lives in `bun_io`; wired in Phase B.
impl bun_io::StreamingWriterHandler for FileSink {
    fn on_close(&mut self) {
        FileSink::on_close(self)
    }
    fn on_writable(&mut self) {
        FileSink::on_ready(self)
    }
    fn on_error(&mut self, err: sys::Error) {
        FileSink::on_error(self, err)
    }
    fn on_write(&mut self, amount: usize, status: WriteStatus) {
        FileSink::on_write(self, amount, status)
    }
}

pub struct Options {
    pub chunk_size: Blob::SizeType,
    pub input_path: PathOrFileDescriptor,
    pub truncate: bool,
    pub close: bool,
    pub mode: bun_sys::Mode,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            chunk_size: 1024,
            input_path: PathOrFileDescriptor::default(),
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
    let Some(ptr) = JSSink::from_js(jsvalue) else {
        return;
    };
    // SAFETY: `JSSink::from_js` returns the `m_ctx` payload pointer for this wrapper.
    let this: &mut FileSink = unsafe { &mut *(ptr as *mut FileSink) };

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
        bun_output::scoped_log!(FileSink, "onAttachedProcessExit()");

        // `writer.close()` below re-enters `onClose` which releases the
        // keep-alive ref, and `stream.cancel`/`runPending` drain microtasks
        // which may drop the JS wrapper's ref. Hold a local ref so `this`
        // stays valid for the rest of this function (same pattern as `onWrite`).
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());
        // PORT NOTE: reshaped for borrowck — `defer self.deref()` via scopeguard.

        self.done = true;
        let mut readable_stream = core::mem::take(&mut self.readable_stream);
        if readable_stream.has() {
            if let Some(global) = self.event_loop_handle.global_object() {
                if let Some(stream) = readable_stream.get(global).as_mut() {
                    if !status.is_ok() {
                        let event_loop = global.bun_vm().event_loop();
                        event_loop.enter();
                        let _exit = scopeguard::guard((), |_| event_loop.exit());
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

        self.pending.result = streams::result::Writable::Err(sys::Error::from_code(
            sys::Errno::PIPE,
            sys::Tag::write,
        ));
        self.run_pending();

        // `writer.close()` → `onClose` already released this above; kept for
        // paths where `onClose` isn't reached (e.g. writer already closed).
        self.clear_keep_alive_ref();
    }

    fn run_pending(&mut self) {
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());

        self.run_pending_later.has = false;
        let l = self.event_loop();

        l.enter();
        let _exit = scopeguard::guard((), |_| l.exit());
        self.pending.run();

        // Release the JS wrapper reference now that the pending operation is complete.
        // This was held to prevent GC from collecting the wrapper while the async
        // operation was in progress.
        self.js_sink_ref.deinit();
    }

    pub fn on_write(&mut self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(FileSink, "onWrite({}, {:?})", amount, status);

        // `runPending()` below drains microtasks and may drop the JS wrapper's
        // ref, and `writer.end()`/`writer.close()` re-enter `onClose` which
        // releases the keep-alive ref. Hold a local ref so `this` stays valid
        // for the rest of this function (same pattern as `runPending`/`onAutoFlush`).
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());

        self.written += amount;

        // TODO: on windows done means ended (no pending data on the buffer) on unix we can still have pending data on the buffer
        // we should unify the behaviors to simplify this
        let has_pending_data = self.writer.has_pending_data();
        // Only keep the event loop ref'd while there's a pending write in progress.
        // If there's no pending write, no need to keep the event loop ref'd.
        self.writer.update_ref(self.event_loop(), has_pending_data);

        if has_pending_data {
            if let Some(vm) = self.event_loop_handle.bun_vm() {
                if !vm.is_inside_deferred_task_queue {
                    AutoFlusher::register_deferred_microtask_with_type::<Self>(self, vm);
                }
            }
        }

        // if we are not done yet and has pending data we just wait so we do not runPending twice
        if status == WriteStatus::Pending && has_pending_data {
            if self.pending.state == streams::result::writable::PendingState::Pending {
                self.pending.consumed = amount as u32; // @truncate
            }
            return;
        }

        if self.pending.state == streams::result::writable::PendingState::Pending {
            self.pending.consumed = amount as u32; // @truncate

            // when "done" is true, we will never receive more data.
            if self.done || status == WriteStatus::EndOfFile {
                self.pending.result = streams::result::Writable::OwnedAndDone(self.pending.consumed);
            } else {
                self.pending.result = streams::result::Writable::Owned(self.pending.consumed);
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
        bun_output::scoped_log!(FileSink, "onError({:?})", err);
        if self.pending.state == streams::result::writable::PendingState::Pending {
            self.pending.result = streams::result::Writable::Err(err);
            if let Some(vm) = self.event_loop().bun_vm() {
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
        bun_output::scoped_log!(FileSink, "onReady()");
        self.signal.ready(None, None);
    }

    pub fn on_close(&mut self) {
        bun_output::scoped_log!(FileSink, "onClose()");
        if self.readable_stream.has() {
            if let Some(global) = self.event_loop_handle.global_object() {
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
            self.deref();
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
            event_loop_handle: EventLoopHandle::init(evtloop),
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
            event_loop_handle: EventLoopHandle::init(evtloop),
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

        let result = bun_io::open_for_writing(
            Fd::cwd(),
            &options.input_path,
            options.flags(),
            options.mode,
            &mut self.pollable,
            &mut self.is_socket,
            self.force_sync,
            &mut self.nonblocking,
            self,
            |fs: &mut FileSink| {
                #[cfg(unix)]
                {
                    fs.force_sync = true;
                    fs.writer.force_sync = true;
                }
            },
            sys::is_pollable,
        );

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
                        self.writer.update_ref(self.event_loop(), false);
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
                self.writer.update_ref(self.event_loop(), false);
                #[cfg(unix)]
                {
                    if self.nonblocking {
                        self.writer.get_poll().unwrap().flags.insert(bun_aio::PollFlags::nonblocking);
                    }

                    if self.is_socket {
                        self.writer.get_poll().unwrap().flags.insert(bun_aio::PollFlags::socket);
                    } else if self.pollable {
                        self.writer.get_poll().unwrap().flags.insert(bun_aio::PollFlags::fifo);
                    }
                }
            }
        }

        sys::Result::Ok(())
    }

    pub fn loop_(&self) -> *mut bun_aio::Loop {
        #[cfg(windows)]
        {
            self.event_loop_handle.loop_().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.loop_()
        }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop_handle
    }

    pub fn connect(&mut self, signal: streams::Signal) {
        self.signal = signal;
    }

    pub fn start(&mut self, stream_start: streams::Start) -> sys::Result<()> {
        match stream_start {
            streams::Start::FileSink(ref file) => match self.setup(file) {
                sys::Result::Err(err) => {
                    return sys::Result::Err(err);
                }
                sys::Result::Ok(()) => {}
            },
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
        let event_loop = self.event_loop();
        if let EventLoopHandle::Js(js) = event_loop {
            self.ref_();
            js.enqueue_task(Task::init(&mut self.run_pending_later));
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        if self.done || !self.writer.has_pending_data() {
            self.update_ref(false);
            self.auto_flusher.registered = false;
            return false;
        }

        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());

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

        if self.pending.state == streams::result::writable::PendingState::Pending {
            return sys::Result::Ok(self.pending.future.promise.strong.value());
        }

        if self.done {
            return sys::Result::init_result(JSValue::UNDEFINED);
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
            streams::result::Writable::Err(_) => unreachable!(),
            result => sys::Result::init_result(result.to_js(global_this)),
        }
    }

    pub fn finalize(&mut self) {
        // TODO(port): `.classes.ts` finalize — see PORTING.md §JSC. Runs during
        // lazy sweep; must not touch live JS cells.
        self.readable_stream.deinit();
        self.pending.deinit();
        self.js_sink_ref.deinit();
        self.deref();
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
            event_loop_handle: EventLoopHandle::init(event_loop_handle),
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
            event_loop_handle: EventLoopHandle::init(bun_jsc::VirtualMachine::get().event_loop()),
            ..FileSink::default_fields()
        };
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        this
    }

    pub fn write(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.done {
            return streams::result::Writable::Done;
        }
        self.to_result(self.writer.write(data.slice()))
    }

    #[inline]
    pub fn write_bytes(&mut self, data: streams::Result) -> streams::result::Writable {
        self.write(data)
    }

    pub fn write_latin1(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.done {
            return streams::result::Writable::Done;
        }
        self.to_result(self.writer.write_latin1(data.slice()))
    }

    pub fn write_utf16(&mut self, data: streams::Result) -> streams::result::Writable {
        if self.done {
            return streams::result::Writable::Done;
        }
        self.to_result(self.writer.write_utf16(data.slice16()))
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
        self_.pending.deinit();
        self_.writer.deinit();
        self_.readable_stream.deinit();
        self_.js_sink_ref.deinit();
        if let Some(global) = self_.event_loop_handle.global_object() {
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self_, global.bun_vm());
        }
        // SAFETY: `this` was produced by `Box::into_raw` in the constructors.
        drop(unsafe { Box::from_raw(this) });
        // TODO(port): field `.deinit()` calls above may double-drop once those
        // types gain `Drop` impls; revisit in Phase B.
    }

    pub fn to_js(&mut self, global_this: &JSGlobalObject) -> JSValue {
        JSSink::create_object(global_this, self, 0)
    }

    pub fn to_js_with_destructor(
        &mut self,
        global_this: &JSGlobalObject,
        destructor: Option<Sink::DestructorPtr>,
    ) -> JSValue {
        JSSink::create_object(
            global_this,
            self,
            destructor.map(|dest| dest.ptr() as usize).unwrap_or(0),
        )
    }

    pub fn end_from_js(&mut self, global_this: &JSGlobalObject) -> sys::Result<JSValue> {
        if self.done {
            if self.pending.state == streams::result::writable::PendingState::Pending {
                return sys::Result::Ok(self.pending.future.promise.strong.value());
            }
            return sys::Result::Ok(JSValue::js_number(self.written));
        }

        let flush_result = self.writer.flush();

        match flush_result {
            WriteResult::Done(written) => {
                self.update_ref(false);
                self.writer.end();
                sys::Result::Ok(JSValue::js_number(written))
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
                self.pending.result = streams::result::Writable::Owned(pending_written as u32);

                let promise_result = self.pending.promise(global_this);

                sys::Result::Ok(promise_result.to_js())
            }
            WriteResult::Wrote(written) => {
                self.writer.end();
                sys::Result::Ok(JSValue::js_number(written))
            }
        }
    }

    pub fn sink(&mut self) -> Sink {
        Sink::init(self)
    }

    pub fn update_ref(&mut self, value: bool) {
        if value {
            self.writer.enable_keeping_process_alive(self.event_loop_handle);
        } else {
            self.writer.disable_keeping_process_alive(self.event_loop_handle);
        }
    }
}

// `Sink.JSSink(@This(), "FileSink")` — generic-fn-returning-type → monomorphized type alias.
pub type JSSink = Sink::JSSink<FileSink>;
// TODO(port): the second arg `"FileSink"` is a comptime string used for codegen
// symbol naming; encode via associated const or attribute in Phase B.

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

    fn to_result(&mut self, write_result: WriteResult) -> streams::result::Writable {
        match write_result {
            WriteResult::Done(amt) => {
                if amt > 0 {
                    return streams::result::Writable::OwnedAndDone(amt as u32);
                }
                streams::result::Writable::Done
            }
            WriteResult::Wrote(amt) => {
                if amt > 0 {
                    return streams::result::Writable::Owned(amt as u32);
                }
                streams::result::Writable::Temporary(amt as u32)
            }
            WriteResult::Err(err) => streams::result::Writable::Err(err),
            WriteResult::Pending(pending_written) => {
                if !self.must_be_kept_alive_until_eof {
                    self.must_be_kept_alive_until_eof = true;
                    self.ref_();
                }
                self.pending.consumed += pending_written as u32; // @truncate
                self.pending.result = streams::result::Writable::Owned(pending_written as u32);
                streams::result::Writable::Pending(&mut self.pending)
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
            event_loop_handle: EventLoopHandle::default(), // overwritten by caller
            written: 0,
            pending: streams::result::writable::Pending {
                result: streams::result::Writable::Done,
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
            readable_stream: ReadableStream::Strong::default(),
            js_sink_ref: Strong::EMPTY,
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
        let _guard = scopeguard::guard((), move |_| unsafe { (*this).deref() });
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
            self.readable_stream.deinit();
        }

        if !self.done {
            self.writer.close();
        }
    }
}

#[bun_jsc::host_fn]
fn on_resolve_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(FileSink, "onResolveStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this deref balances it.
    let _guard = scopeguard::guard((), move |_| unsafe { (*this).deref() });
    // SAFETY: `as_promise_ptr` recovers the `*mut FileSink` stashed by `assign_to_stream`.
    unsafe { (*this).handle_resolve_stream(global_this) };
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_reject_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(FileSink, "onRejectStream");
    let args = callframe.arguments();
    let this: *mut FileSink = args[args.len() - 1].as_promise_ptr::<FileSink>();
    let err = args[0];
    // SAFETY: `this` is kept alive by the ref taken in `assign_to_stream`; this deref balances it.
    let _guard = scopeguard::guard((), move |_| unsafe { (*this).deref() });
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
        *signal = JSSink::SinkSignal::init(JSValue::ZERO);
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();

        self.readable_stream = ReadableStream::Strong::init(*stream, global_this);
        // PORT NOTE: reshaped for borrowck — re-borrow `signal` after assigning
        // `readable_stream`.
        let signal_ptr: *mut *mut c_void = &mut self.signal.ptr as *mut _ as *mut *mut c_void;
        let promise_result =
            JSSink::assign_to_stream(global_this, stream.value, self, signal_ptr);

        if let Some(err) = promise_result.to_error() {
            self.readable_stream.deinit();
            self.readable_stream = ReadableStream::Strong::default();
            return err;
        }

        if !promise_result.is_empty_or_undefined_or_null() {
            if let Some(promise) = promise_result.as_any_promise() {
                match promise.status() {
                    bun_jsc::PromiseStatus::Pending => {
                        self.writer.enable_keeping_process_alive(self.event_loop_handle);
                        self.ref_();
                        let _ = promise_result.then(
                            global_this,
                            self,
                            on_resolve_stream,
                            on_reject_stream,
                        ); // TODO: properly propagate exception upwards
                    }
                    bun_jsc::PromiseStatus::Fulfilled => {
                        // These don't ref().
                        self.handle_resolve_stream(global_this);
                    }
                    bun_jsc::PromiseStatus::Rejected => {
                        // These don't ref().
                        self.handle_reject_stream(global_this, promise.result(global_this.vm()));
                    }
                }
            }
        }

        promise_result
    }
}

// `comptime { @export(&jsc.toJSHostFn(onResolveStream), ...) }`
// The `#[bun_jsc::host_fn]` attribute above emits the `callconv(jsc.conv)` shim;
// re-export under the C symbol names the C++ side expects.
// TODO(port): gate on `export_cpp_apis` feature in Phase B.
#[unsafe(no_mangle)]
pub static Bun__FileSink__onResolveStream: bun_jsc::JSHostFn = on_resolve_stream::SHIM;
#[unsafe(no_mangle)]
pub static Bun__FileSink__onRejectStream: bun_jsc::JSHostFn = on_reject_stream::SHIM;
// TODO(port): exact mechanism for exporting host-fn shims by name TBD in `bun_jsc`.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/FileSink.zig (862 lines)
//   confidence: medium
//   todos:      10
//   notes:      intrusive refcount + @fieldParentPtr kept raw; scopeguard used for ref/deref defers; JSSink/StreamingWriter generic instantiation and host-fn export wiring need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
