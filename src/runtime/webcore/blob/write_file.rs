use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU8, Ordering};

use crate::Error;
use bun_io as io;
#[cfg(not(windows))]
use bun_io::IntrusiveIoRequest as _;
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, SystemError};
use bun_sys::{self as sys, Fd};
use bun_threading::{IntrusiveWorkTask as _, WorkPool, WorkPoolTask};

use crate::webcore::blob::{
    self, Blob, ClosingState, FileCloser, FileOpener, MkdirpTarget, Retry, SizeType,
    mkdir_if_not_exists,
};
use crate::webcore::body;

bun_output::declare_scope!(WriteFile, hidden);

// A tagged result-or-error union. Modeled
// as a plain Rust enum: it only ever travels through the Rust fn-pointer
// callbacks below (`WriteFileOnWriteFileCallback`), never across FFI, so the
// layout is unconstrained.
/// One `write()` attempt on the pool thread.
pub(crate) enum WriteStep {
    Wrote(usize),
    /// A pipe/socket is full: park on the io loop.
    #[cfg(not(windows))]
    WouldBlock,
    /// `errno`/`system_error` are set.
    Failed,
}

pub(crate) enum WriteFileResultType {
    Result(SizeType),
    Err(Box<SystemError>),
}

pub(crate) type WriteFileOnWriteFileCallback =
    fn(ctx: *mut c_void, count: WriteFileResultType) -> jsc::JsResult<()>;

/// The completion token a `WriteFile` keeps across its async I/O.
pub(crate) type WriteFileTask = bun_jsc::Completion<WriteFile>;

// SAFETY: the two blobs are native values holding store refs (atomic counts);
// io-loop registration state and an opaque completion ctx that only the
// JS-thread completion dereferences — nothing used off-thread is thread-affine.
unsafe impl Send for WriteFile {}

impl bun_jsc::JobContext for WriteFile {
    const CANCELLABLE: bool = cfg!(not(windows));
    type OffThread = Self;
    /// Whom the write is reported to. (Dropped with the job when that is released unrun: the
    /// promise then stays pending.)
    type Js = Box<WriteFilePromise>;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // Starts the write; finishes from the io loop via the token.
        this.run(done);
        None
    }
    fn then(
        this: Self,
        promise: Box<WriteFilePromise>,
        _: &bun_jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        WriteFile::then(this, promise)
    }
    /// As `ReadFile`: a write parked on a full pipe nobody drains is the one
    /// state this job can be stuck in.
    #[cfg(not(windows))]
    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract; see `ReadFile::cancel`.
        unsafe {
            if (*this).io_parking.cancel() {
                io::IoRequestLoop::schedule(&mut (*this).io_request);
            }
        }
    }
}

impl WriteFile {
    /// JS thread: hand a prepared `WriteFile` to the work pool (the job is
    /// its one heap allocation).
    pub(crate) fn schedule(
        this: WriteFile,
        promise: Box<WriteFilePromise>,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        bun_jsc::Job::<WriteFile>::schedule(cx, this, promise);
    }
}

pub(crate) struct WriteFile {
    pub(crate) file_blob: Blob,
    pub(crate) bytes_blob: Blob,

    pub(crate) opened_fd: Fd,
    pub(crate) system_error: Option<SystemError>,
    pub(crate) errno: Option<Error>,
    pub task: WorkPoolTask,
    pub(crate) io_task: Option<WriteFileTask>,
    pub(crate) io_poll: io::Poll,
    pub(crate) io_request: io::Request,
    #[cfg(not(windows))]
    pub(crate) io_parking: super::IoParking,
    pub(crate) state: AtomicU8, // ClosingState

    pub(crate) total_written: usize,

    /// POSIX: the destination is a pipe/socket/tty whose writes can need to
    /// wait for readiness on the io thread. A Windows file handle has no
    /// readiness; a write there blocks the pool thread instead.
    #[cfg(not(windows))]
    pub(crate) could_block: bool,
    pub(crate) close_after_io: bool,
    pub(crate) mkdirp_if_not_exists: bool,
}

bun_threading::intrusive_work_task!(WriteFile, task);
bun_io::intrusive_io_request!(WriteFile, io_request);

// ──────────────────────────────────────────────────────────────────────────
// FileOpener / FileCloser
// ──────────────────────────────────────────────────────────────────────────

impl FileOpener for WriteFile {
    const OPEN_FLAGS: i32 = bun_sys::O::WRONLY
        | bun_sys::O::CREAT
        | bun_sys::O::TRUNC
        | bun_sys::O::NONBLOCK
        | bun_sys::O::SEQUENTIAL;

    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn set_errno(&mut self, e: Error) {
        self.errno = Some(e);
    }
    fn set_system_error(&mut self, e: SystemError) {
        self.system_error = Some(e);
    }
    fn pathlike(&self) -> &PathOrFileDescriptor<'static> {
        &self
            .file_blob
            .store
            .get()
            .as_ref()
            .unwrap()
            .data
            .as_file()
            .pathlike
    }
    fn try_mkdirp(
        &mut self,
        err: bun_sys::Error,
        path: &bun_core::ZStr,
        display_path: &[u8],
    ) -> Retry {
        mkdir_if_not_exists(self, &err, path, display_path)
    }
}

impl MkdirpTarget for WriteFile {
    fn mkdirp_if_not_exists(&self) -> bool {
        self.mkdirp_if_not_exists
    }
    fn set_mkdirp_if_not_exists(&mut self, v: bool) {
        self.mkdirp_if_not_exists = v;
    }
    fn set_system_error(&mut self, e: bun_sys::SystemError) {
        self.system_error = Some(e.into());
    }
    fn set_errno_if_present(&mut self, e: Error) {
        self.errno = Some(e);
    }
    fn set_opened_fd_if_present(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
}

crate::webcore::blob::impl_file_closer!(WriteFile);

impl WriteFile {
    #[cfg(not(windows))]
    pub(crate) const IO_TAG: io::Tag = io::Tag::WriteFile;

    /// Record `err` as why the write failed. The error names the destination
    /// the way the caller did: by path, or by the fd it passed.
    fn fail(&mut self, err: &sys::Error) {
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        let err = match self.pathlike() {
            PathOrFileDescriptor::Path(path) => err.with_path(path.slice()),
            PathOrFileDescriptor::Fd(fd) => err.with_fd(*fd),
        };
        self.system_error = Some(err.to_system_error().into());
    }

    pub(crate) fn on_ready(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onReady()");
        #[cfg(not(windows))]
        if !self.io_parking.fire() {
            return;
        }
        self.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_write_loop_task,
        };
        WorkPool::schedule(&raw mut self.task);
    }

    pub(crate) fn on_io_error(this: *mut (), err: &sys::Error) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onIOError()");
        // SAFETY: ctx was set to `self as *mut WriteFile` in `on_request_writable`.
        let this = unsafe { bun_ptr::callback_ctx::<WriteFile>(this.cast()) };
        #[cfg(not(windows))]
        if !this.io_parking.fire() {
            return;
        }
        this.fail(err);
        this.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_write_loop_task,
        };
        WorkPool::schedule(&raw mut this.task);
    }

    #[cfg(not(windows))]
    pub(crate) fn on_request_writable(request: &mut io::Request) -> io::Action<'_> {
        bun_output::scoped_log!(WriteFile, "WriteFile.onRequestWritable()");
        request.scheduled = false;
        // SAFETY: `request` points to WriteFile.io_request (intrusive); recover parent.
        let this = unsafe { WriteFile::from_io_request(std::ptr::from_mut(request)) };
        // SAFETY: `this` is the live parent (see above); io thread owns it while parked.
        if !unsafe { (*this).io_parking.arm() } {
            // SAFETY: as above.
            unsafe { (*this).fail_cancelled() };
            return <Self as crate::webcore::blob::FileCloser>::schedule_close(request);
        }
        // SAFETY: `request` points to WriteFile.io_request (intrusive), so `this` is the
        // live parent; `fd` copy and the `io_poll` field borrow are the only borrows formed.
        let (fd, poll) = unsafe { ((*this).opened_fd, &mut (*this).io_poll) };
        io::Action::Writable(io::FileAction {
            on_error: Self::on_io_error,
            ctx: this.cast::<()>(),
            fd,
            poll,
            tag: WriteFile::IO_TAG,
        })
    }

    /// See `ReadFile::fail_cancelled`.
    #[cfg(not(windows))]
    fn fail_cancelled(&mut self) {
        self.fail(&sys::Error::from_code(sys::E::ECANCELED, sys::Tag::write));
        self.state
            .store(ClosingState::Closing as u8, Ordering::SeqCst);
    }

    /// See `ReadFile::wait_for_readable`: the caller returns without touching
    /// `self` again.
    #[cfg(not(windows))]
    pub(crate) fn wait_for_writable(&mut self) {
        if !self.io_parking.park() {
            self.fail_cancelled();
            return self.on_finish();
        }
        self.close_after_io = true;
        self.io_request
            .store_callback_seq_cst(Self::on_request_writable);
        io::IoRequestLoop::schedule(&mut self.io_request);
    }

    pub(crate) fn create(
        file_blob: Blob,
        bytes_blob: Blob,
        mkdirp_if_not_exists: bool,
    ) -> Result<WriteFile, Error> {
        let write_file = WriteFile {
            file_blob,
            bytes_blob,
            opened_fd: Fd::INVALID,
            system_error: None,
            errno: None,
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::do_write_loop_task,
            },
            io_task: None,
            io_poll: io::Poll::default(),
            #[cfg(not(windows))]
            io_request: io::Request::new(Self::on_request_writable),
            #[cfg(windows)]
            io_request: io::Request::new(<Self as FileCloser>::schedule_close),
            #[cfg(not(windows))]
            io_parking: super::IoParking::new(),
            state: AtomicU8::new(ClosingState::Running as u8),
            total_written: 0,
            #[cfg(not(windows))]
            could_block: false,
            close_after_io: false,
            mkdirp_if_not_exists,
        };
        Ok(write_file)
    }

    // reshaped for borrowck — take (off, len) here and re-derive the slice
    // internally so callers don't hold a borrow of self across the &mut self call.
    pub(crate) fn do_write(&mut self, off: usize, len: usize) -> WriteStep {
        let fd = self.opened_fd;
        debug_assert!(fd != Fd::INVALID);

        // We do not use pwrite() because the file may not be
        // seekable (such as stdout)
        //
        // On macOS, it is an error to use pwrite() on a
        // non-seekable file.
        loop {
            match sys::write(fd, &self.bytes_blob.shared_view()[off..off + len]) {
                Ok(wrote) => {
                    self.total_written += wrote;
                    return WriteStep::Wrote(wrote);
                }
                // regular files cannot use epoll.
                // this is fine on kqueue, but not on epoll.
                #[cfg(not(windows))]
                Err(err) if err.get_errno() == io::RETRY && !self.could_block => continue,
                #[cfg(not(windows))]
                Err(err) if err.get_errno() == io::RETRY => return WriteStep::WouldBlock,
                Err(err) => {
                    self.fail(&err);
                    return WriteStep::Failed;
                }
            }
        }
    }

    pub(crate) fn then(mut this: WriteFile, promise: Box<WriteFilePromise>) -> jsc::JsResult<()> {
        let cb: WriteFileOnWriteFileCallback = WriteFilePromise::run;
        let cb_ctx = bun_core::heap::into_raw(promise).cast::<c_void>();
        let system_error = this.system_error.take();
        let total_written = this.total_written;
        drop(this);

        if let Some(err) = system_error {
            cb(cb_ctx, WriteFileResultType::Err(Box::new(err)))?;
            return Ok(());
        }

        cb(
            cb_ctx,
            WriteFileResultType::Result(total_written as SizeType),
        )?;
        Ok(())
    }

    pub(crate) fn run(&mut self, task: WriteFileTask) {
        self.io_task = Some(task);
        self.run_async();
    }

    fn run_async(&mut self) {
        self.get_fd(Self::run_with_fd);
    }

    pub(crate) fn is_allowed_to_close(&self) -> bool {
        self.file_blob
            .store
            .get()
            .as_ref()
            .unwrap()
            .data
            .as_file()
            .pathlike
            .is_path()
    }

    fn on_finish(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onFinish()");

        let close_after_io = self.close_after_io;
        if self.do_close(self.is_allowed_to_close()) {
            return;
        }
        if !close_after_io {
            if let Some(io_task) = self.io_task.take() {
                io_task.finish();
            }
        }
    }

    fn run_with_fd(&mut self, fd_: Fd) {
        if fd_ == Fd::INVALID || self.errno.is_some() {
            self.on_finish();
            return;
        }

        #[cfg(not(windows))]
        let fd = self.opened_fd;

        #[cfg(not(windows))]
        {
            self.could_block = 'brk: {
                if let Some(store) = self.file_blob.store.get().as_ref() {
                    if let blob::store::Data::File(file) = &store.data {
                        if file.pathlike.is_fd() {
                            // If seekable was set, then so was mode
                            if file.seekable.is_some() {
                                // This is mostly to handle pipes which were passsed to the process somehow
                                // such as stderr, stdout. Bun.stdin and Bun.stderr will automatically set `mode` for us.
                                break 'brk !bun_sys::is_regular_file(file.mode);
                            }
                        }
                    }
                }

                // We opened the file descriptor with O_NONBLOCK, so we
                // shouldn't have to worry about blocking reads/writes
                //
                // We do not call fstat() because that is very expensive.
                false
            };

            // We have never supported offset in Bun.write().
            // and properly adding support means we need to also support it
            // with splice, sendfile, and the other cases.

            if self.could_block && bun_core::is_writable(fd) == bun_core::Pollable::NotReady {
                self.wait_for_writable();
                return;
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // If it's a potentially large file, lets attempt to
            // preallocate the saved filesystem size.
            //
            // We only do this on Linux because the equivalent on macOS
            // seemed to have zero performance impact in
            // microbenchmarks.
            if !self.could_block && self.bytes_blob.shared_view().len() > 1024 {
                let _ = sys::preallocate_file(
                    fd.native(),
                    0,
                    i64::try_from(self.bytes_blob.shared_view().len()).expect("int cast"),
                ); // we don't care if it fails.
            }
        }

        self.do_write_loop();
    }

    fn do_write_loop_task(task: *mut WorkPoolTask) {
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` = `&mut self.task`
        // (intrusive) registered in `on_writable`/`init`; recover parent.
        let this = unsafe { WriteFile::from_task_ptr(task) };
        // On kqueue platforms we use one-shot mode, so we don't need to unregister.
        if bun_core::Environment::IS_KQUEUE {
            // SAFETY: `this` is the live parent (see above); scoped access.
            unsafe { (*this).close_after_io = false };
        }
        // SAFETY: `this` is the live parent (see above); exclusive borrow scoped to the call.
        unsafe { (*this).do_write_loop() };
    }

    pub(crate) fn update(&mut self) {
        self.do_write_loop();
    }

    fn do_write_loop(&mut self) {
        while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
            let remain_full = self.bytes_blob.shared_view();
            // reshaped for borrowck — capture len/offset before mut borrow
            let off = self.total_written.min(remain_full.len());
            let remain_len = remain_full.len() - off;

            if remain_len > 0 && self.errno.is_none() {
                let wrote = match self.do_write(off, remain_len) {
                    WriteStep::Wrote(n) => n,
                    #[cfg(not(windows))]
                    WriteStep::WouldBlock => return self.wait_for_writable(),
                    WriteStep::Failed => return self.on_finish(),
                };

                // Do not immediately attempt to write again if it's not a regular file.
                #[cfg(not(windows))]
                if self.could_block
                    && bun_core::is_writable(self.opened_fd) == bun_core::Pollable::NotReady
                {
                    self.wait_for_writable();
                    return;
                }

                if wrote == 0 {
                    // we are done, we received EOF
                    self.on_finish();
                    return;
                }

                continue;
            }

            break;
        }

        self.on_finish();
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct WriteFilePromise {
    pub(crate) promise: jsc::JSPromiseStrong,
    pub global_this: *const JSGlobalObject,
}

// SAFETY: a promise handle and the global it was made in: used and dropped on that global's
// JS thread only (a job's `Js` half).
unsafe impl bun_jsc::job::JsAffine for WriteFilePromise {}

impl WriteFilePromise {
    pub(crate) fn run(handler: *mut c_void, count: WriteFileResultType) -> jsc::JsResult<()> {
        let handler = handler.cast::<Self>();
        // SAFETY: handler is the Box-allocated WriteFilePromise created in
        // Blob.rs (`heap::into_raw(Box::new(WriteFilePromise { .. }))`); consumed here.
        // `swap()` releases the Strong's handle slot and yields a GC-owned `*mut JSPromise`,
        // which stays valid past `drop(heap::take(handler))`.
        let (promise, global_this): (*mut JSPromise, &JSGlobalObject) = unsafe {
            let h = &mut *handler;
            let promise = std::ptr::from_mut::<JSPromise>(h.promise.swap());
            let global_this = &*h.global_this;
            drop(bun_core::heap::take(handler));
            (promise, global_this)
        };
        // SAFETY: GC-owned cell (kept alive below); scoped shared access.
        let value = unsafe { (*promise).to_js() };
        value.ensure_still_alive();
        match count {
            WriteFileResultType::Err(err) => {
                // SAFETY: GC-owned cell; the error build's shared borrow ends before the
                // scoped exclusive `reject` borrow.
                unsafe {
                    let err_js = err.to_error_instance_with_async_stack(global_this, &*promise);
                    (*promise).reject(global_this, Ok(err_js))?;
                }
            }
            WriteFileResultType::Result(wrote) => {
                // SAFETY: GC-owned cell; exclusive borrow scoped to the call.
                unsafe {
                    (*promise)
                        .resolve(global_this, JSValue::js_number_from_uint64(wrote as u64))?;
                }
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct WriteFileWaitFromLockedValueTask {
    pub(crate) file_blob: Blob,
    /// The context of the script that asked for the write.
    pub(crate) context: bun_jsc::ContextId,
    /// JSC_BORROW: process-lifetime global; `BackRef` so the deref is safe and
    /// (being `Copy`) detaches from `&self` for use across `&mut self` and
    /// past `heap::take(this)`.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
}

impl WriteFileWaitFromLockedValueTask {
    pub(crate) fn then_wrap(this: NonNull<c_void>, value: &mut body::Value) {
        // SAFETY: `this` is the Box-allocated task registered as `locked.task` below;
        // ownership is reclaimed here (the `Locked` arm re-leaks it).
        let this = unsafe {
            bun_core::heap::take(this.cast::<WriteFileWaitFromLockedValueTask>().as_ptr())
        };
        let _ = Self::then(this, value);
        // TODO: properly propagate exception upwards
    }

    pub(crate) fn then(
        mut this: Box<WriteFileWaitFromLockedValueTask>,
        value: &mut body::Value,
    ) -> jsc::JsResult<()> {
        let promise: *mut JSPromise = std::ptr::from_mut(this.promise.get());
        let global_ref = this.global_this;
        let global_this = global_ref.get();
        let context = global_this.bun_vm().context_of(this.context);
        let mut file_blob = core::mem::take(&mut this.file_blob);
        match value {
            body::Value::Error(err_ref) => {
                let err = err_ref.to_js(global_this);
                file_blob.detach();
                let _ = value.use_();
                drop(this);
                JSPromise::opaque_mut(promise).reject_with_async_stack(global_this, Ok(err))?;
            }
            body::Value::Used => {
                file_blob.detach();
                let _ = value.use_();
                drop(this);
                // SAFETY: GC-owned promise cell; exclusive borrow scoped to the call.
                unsafe {
                    (*promise).reject(
                        global_this,
                        Ok(global_this.create_error_instance(format_args!(
                            "Body was used after it was consumed"
                        ))),
                    )?;
                }
            }
            body::Value::WTFStringImpl(_)
            | body::Value::InternalBlob(_)
            | body::Value::Null
            | body::Value::Empty
            | body::Value::Blob(_) => {
                let mut blob = value.use_();
                // TODO: this should be one promise not two!
                let new_promise = match blob::write_file_with_source_destination(
                    &global_this.js_thread(context),
                    &mut blob,
                    &mut file_blob,
                    &blob::WriteFileOptions {
                        mkdirp_if_not_exists: Some(this.mkdirp_if_not_exists),
                        ..Default::default()
                    },
                    None,
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        file_blob.detach();
                        drop(this);
                        JSPromise::opaque_mut(promise).reject(global_this, Err(err))?;
                        return Ok(());
                    }
                };

                let _this_box = this;
                let _g = scopeguard::guard((), |()| file_blob.detach());

                if let Some(p) = new_promise.as_any_promise() {
                    // SAFETY: GC-owned promise cell; exclusive borrows scoped per call.
                    unsafe {
                        match p.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                            // Fulfill the new promise using the pending promise
                            jsc::PromiseResult::Pending => {
                                (*promise).resolve(global_this, new_promise)?
                            }
                            jsc::PromiseResult::Rejected(err) => {
                                (*promise).reject(global_this, Ok(err))?
                            }
                            jsc::PromiseResult::Fulfilled(result) => {
                                (*promise).resolve(global_this, result)?
                            }
                        }
                    }
                }
            }
            body::Value::Locked(locked) => {
                // Re-registering for a future callback — `this` stays alive.
                // Restore the moved-out blob so the next `then()` has its store.
                this.file_blob = file_blob;
                locked.on_receive_value = Some(Self::then_wrap);
                locked.task = Some(
                    NonNull::new(bun_core::heap::into_raw(this))
                        .unwrap()
                        .cast::<c_void>(),
                );
            }
        }
        Ok(())
    }
}
