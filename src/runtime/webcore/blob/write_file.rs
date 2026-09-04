use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::AtomicU8;
#[cfg(not(windows))]
use core::sync::atomic::Ordering;

use crate::Error;
use bun_io as io;
#[cfg(not(windows))]
use bun_io::IntrusiveIoRequest as _;
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, SystemError};
use bun_sys::{self as sys, Fd};
use bun_threading::{IntrusiveWorkTask as _, WorkPool, WorkPoolTask};

use crate::webcore::blob::{
    self, Blob, FileOpener, MkdirpTarget, Retry, SizeType, mkdir_if_not_exists,
};
#[cfg(not(windows))]
use crate::webcore::blob::{ClosingState, FileCloser};
use crate::webcore::body;

bun_output::declare_scope!(WriteFile, hidden);

// A tagged result-or-error union. Modeled
// as a plain Rust enum: it only ever travels through the Rust fn-pointer
// callbacks below (`WriteFileOnWriteFileCallback`), never across FFI, so the
// layout is unconstrained.
/// One `write()` attempt on the pool thread.
#[cfg(not(windows))]
pub(crate) enum WriteStep {
    Wrote(usize),
    /// A pipe/socket is full: park on the io loop.
    WouldBlock,
    /// `errno`/`system_error` are set.
    Failed,
}

pub enum WriteFileResultType {
    Result(SizeType),
    Err(Box<SystemError>),
}

pub type WriteFileOnWriteFileCallback =
    fn(ctx: *mut c_void, count: WriteFileResultType) -> jsc::JsResult<()>;

/// The completion token a `WriteFile` keeps across its async I/O.
pub type WriteFileTask = bun_jsc::Completion<WriteFile>;

// SAFETY: the two blobs are native values holding store refs (atomic counts);
// io-loop registration state and an opaque completion ctx that only the
// JS-thread completion dereferences — nothing used off-thread is thread-affine.
unsafe impl Send for WriteFile {}

impl bun_jsc::JobContext for WriteFile {
    const CANCELLABLE: bool = cfg!(not(windows));
    type OffThread = Self;
    /// The completion is delivered through `on_complete_callback(ctx, ..)`.
    type Js = ();
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // Starts the write; finishes from the io loop via the token.
        this.run(done);
        None
    }
    fn then(this: Self, _: (), cx: &bun_jsc::JsThread<'_>) -> jsc::JsResult<()> {
        WriteFile::then(this, cx.global())
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
    pub fn schedule(this: WriteFile, global: &JSGlobalObject) {
        bun_jsc::Job::<WriteFile>::schedule(&global.js_thread(), this, ());
    }
}

pub struct WriteFile {
    pub(crate) file_blob: Blob,
    #[cfg(not(windows))]
    pub(crate) bytes_blob: Blob,

    pub(crate) opened_fd: Fd,
    pub(crate) system_error: Option<SystemError>,
    pub(crate) errno: Option<Error>,
    pub task: WorkPoolTask,
    #[cfg(not(windows))]
    pub(crate) io_task: Option<WriteFileTask>,
    pub(crate) io_poll: io::Poll,
    pub(crate) io_request: io::Request,
    #[cfg(not(windows))]
    pub(crate) io_parking: super::IoParking,
    pub(crate) state: AtomicU8, // ClosingState

    pub(crate) on_complete_ctx: *mut c_void,
    pub(crate) on_complete_callback: WriteFileOnWriteFileCallback,
    pub(crate) total_written: usize,

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
    const OPEN_FLAGS: i32 =
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::NONBLOCK;

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
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t {
        unreachable!("WriteFile is POSIX-only; see WriteFileWindows")
    }
    #[cfg(windows)]
    fn req(&mut self) -> &mut bun_libuv_sys::uv_fs_t {
        unreachable!("WriteFile is POSIX-only")
    }
    #[cfg(windows)]
    fn set_open_callback(&mut self, _cb: fn(&mut Self, Fd)) {
        unreachable!()
    }
    #[cfg(windows)]
    fn open_callback(&self) -> fn(&mut Self, Fd) {
        unreachable!()
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

    pub fn on_ready(&mut self) {
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
        this.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        this.system_error = Some(err.to_system_error().into());
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
        let err = sys::Error::from_code(sys::E::ECANCELED, sys::Tag::write);
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        self.system_error = Some(err.to_system_error().into());
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

    #[cfg(not(windows))]
    pub(crate) fn create_with_ctx(
        file_blob: Blob,
        bytes_blob: Blob,
        on_write_file_context: *mut c_void,
        on_complete_callback: WriteFileOnWriteFileCallback,
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
            io_request: io::Request::new(Self::on_request_writable),
            #[cfg(not(windows))]
            io_parking: super::IoParking::new(),
            state: AtomicU8::new(ClosingState::Running as u8),
            on_complete_ctx: on_write_file_context,
            on_complete_callback,
            total_written: 0,
            could_block: false,
            close_after_io: false,
            mkdirp_if_not_exists,
        };
        Ok(write_file)
    }

    #[cfg(not(windows))]
    pub(crate) fn create<C>(
        file_blob: Blob,
        bytes_blob: Blob,
        context: *mut C,
        callback: WriteFileOnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) -> Result<WriteFile, Error> {
        // The caller supplies a
        // `*mut c_void`-typed callback directly (see `WriteFilePromise::run`),
        // so this is just a `.cast()` on `context`.
        WriteFile::create_with_ctx(
            file_blob,
            bytes_blob,
            context.cast::<c_void>(),
            callback,
            mkdirp_if_not_exists,
        )
    }

    // reshaped for borrowck — take (off, len) here and re-derive the slice
    // internally so callers don't hold a borrow of self across the &mut self call.
    #[cfg(not(windows))]
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
                Err(err) if err.get_errno() == io::RETRY && !self.could_block => continue,
                Err(err) if err.get_errno() == io::RETRY => return WriteStep::WouldBlock,
                Err(err) => {
                    self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
                    self.system_error = Some(err.to_system_error().into());
                    return WriteStep::Failed;
                }
            }
        }
    }

    pub(crate) fn then(mut this: WriteFile, _global: &JSGlobalObject) -> jsc::JsResult<()> {
        let cb = this.on_complete_callback;
        let cb_ctx = this.on_complete_ctx;
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
        #[cfg(windows)]
        {
            // Windows writes go through WriteFileWindows, never the pool.
            let _ = task;
            unreachable!("WriteFile on the work pool (Windows uses WriteFileWindows)");
        }
        #[cfg(not(windows))]
        {
            self.io_task = Some(task);
            self.run_async();
        }
    }

    #[cfg(not(windows))]
    fn run_async(&mut self) {
        self.get_fd(Self::run_with_fd);
    }

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
    fn run_with_fd(&mut self, fd_: Fd) {
        if fd_ == Fd::INVALID || self.errno.is_some() {
            self.on_finish();
            return;
        }

        let fd = self.opened_fd;

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
        #[cfg(windows)]
        {
            return; // why
        }
        #[cfg(not(windows))]
        self.do_write_loop_posix();
    }

    #[cfg(not(windows))]
    fn do_write_loop_posix(&mut self) {
        while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
            let remain_full = self.bytes_blob.shared_view();
            // reshaped for borrowck — capture len/offset before mut borrow
            let off = self.total_written.min(remain_full.len());
            let remain_len = remain_full.len() - off;

            if remain_len > 0 && self.errno.is_none() {
                let wrote = match self.do_write(off, remain_len) {
                    WriteStep::Wrote(n) => n,
                    WriteStep::WouldBlock => return self.wait_for_writable(),
                    WriteStep::Failed => return self.on_finish(),
                };

                // Do not immediately attempt to write again if it's not a regular file.
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
// WriteFileWindows
//
// libuv-backed write path used by `Blob.writeFileInternal` on Windows. The
// whole impl is `#[cfg(windows)]`-gated because `bun_sys::windows::libuv`
// (and the libuv `fs_t`/`uv_buf_t` types) only exist when targeting Windows.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub(crate) use self::windows_impl::{WriteFileWindows, WriteFileWindowsError};

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use core::ptr::null_mut;

    use bun_io::{self as aio, IntrusiveUvFs as _, KeepAlive};
    // `bun_jsc::EventLoop`/`ManagedTask` are *modules* (namespace
    // re-exports); the structs live one level deeper.
    use bun_jsc::{ConcurrentTask, ManagedTask::ManagedTask, event_loop::EventLoop};
    use bun_sys::ReturnCodeExt as _;
    use bun_sys::windows::libuv as uv;

    pub(crate) struct WriteFileWindows {
        pub(crate) io_request: uv::fs_t,
        pub(crate) file_blob: Blob,
        pub(crate) bytes_blob: Blob,
        pub(crate) on_complete_callback: WriteFileOnWriteFileCallback,
        pub(crate) on_complete_ctx: *mut c_void,
        pub(crate) mkdirp_if_not_exists: bool,
        pub(crate) uv_bufs: [uv::uv_buf_t; 1],

        pub(crate) fd: uv::uv_file,
        pub(crate) err: Option<sys::Error>,
        pub(crate) total_written: usize,
        pub(crate) event_loop: *mut EventLoop,
        pub poll_ref: KeepAlive,

        pub(crate) owned_fd: bool,
    }

    bun_io::intrusive_uv_fs!(WriteFileWindows, io_request);

    #[derive(thiserror::Error, Debug)]
    pub(crate) enum WriteFileWindowsError {
        #[error("WriteFileWindowsDeinitialized")]
        WriteFileWindowsDeinitialized,
        /// Delivering the result entered JS (settled the promise) and an exception is pending.
        #[error("JSError")]
        Js(jsc::JsError),
    }

    impl From<jsc::JsError> for WriteFileWindowsError {
        fn from(err: jsc::JsError) -> Self {
            WriteFileWindowsError::Js(err)
        }
    }

    impl WriteFileWindows {
        pub(crate) fn create_with_ctx(
            file_blob: Blob,
            bytes_blob: Blob,
            event_loop: *mut EventLoop,
            on_write_file_context: *mut c_void,
            on_complete_callback: WriteFileOnWriteFileCallback,
            mkdirp_if_not_exists: bool,
        ) -> Result<*mut WriteFileWindows, WriteFileWindowsError> {
            let mkdirp = mkdirp_if_not_exists
                && file_blob
                    .store
                    .get()
                    .as_ref()
                    .unwrap()
                    .data
                    .as_file()
                    .pathlike
                    .is_path();
            let write_file = Self::new(WriteFileWindows {
                file_blob,
                bytes_blob,
                on_complete_ctx: on_write_file_context,
                on_complete_callback,
                mkdirp_if_not_exists: mkdirp,
                io_request: bun_core::ffi::zeroed::<uv::fs_t>(),
                uv_bufs: [uv::uv_buf_t {
                    base: null_mut(),
                    len: 0,
                }],
                event_loop,
                fd: -1,
                err: None,
                total_written: 0,
                poll_ref: KeepAlive::default(),
                owned_fd: false,
            });
            // SAFETY: just allocated, sole owner until returned.
            // `open`/`do_write_loop` may free `*write_file` on the `Err` path,
            // so we operate through the raw `write_file` pointer rather than
            // holding a `&mut` across those calls (Stacked Borrows: a `&mut`
            // local would dangle once `deinit` reclaims the Box).
            unsafe {
                (*write_file).io_request.loop_ = (*event_loop).uv_loop();
                (*write_file).io_request.data = write_file.cast::<c_void>();

                match &(*write_file)
                    .file_blob
                    .store
                    .get()
                    .as_ref()
                    .unwrap()
                    .data
                    .as_file()
                    .pathlike
                {
                    PathOrFileDescriptor::Path(_) => {
                        Self::open(write_file)?;
                    }
                    PathOrFileDescriptor::Fd(fd) => {
                        (*write_file).fd = 'brk: {
                            // `EventLoop.virtual_machine` is `Option<NonNull<VirtualMachine>>`;
                            // `RareData::std{out,err,in}_store` is type-erased
                            // `Option<NonNull<c_void>>` — compare on raw pointer identity.
                            if let Some(vm) = (*event_loop).virtual_machine {
                                if let Some(rare) = (*vm.as_ptr()).rare_data.as_ref() {
                                    let store_ptr = (*write_file)
                                        .file_blob
                                        .store
                                        .get()
                                        .as_ref()
                                        .unwrap()
                                        .as_ptr()
                                        .cast::<c_void>();
                                    if rare.stdout_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                                        break 'brk 1;
                                    } else if rare.stderr_store.map(|p| p.as_ptr())
                                        == Some(store_ptr)
                                    {
                                        break 'brk 2;
                                    } else if rare.stdin_store.map(|p| p.as_ptr())
                                        == Some(store_ptr)
                                    {
                                        break 'brk 0;
                                    }
                                }
                            }

                            // The file stored descriptor is not stdin, stdout, or stderr.
                            fd.uv()
                        };

                        Self::do_write_loop(write_file, (*write_file).loop_())?;
                    }
                }

                (*write_file)
                    .poll_ref
                    .ref_(jsc::VirtualMachineRef::event_loop_ctx(
                        (*(*write_file).event_loop)
                            .virtual_machine
                            .unwrap()
                            .as_ptr(),
                    ));
            }
            Ok(write_file)
        }

        #[inline]
        pub(crate) fn loop_(&self) -> *mut uv::Loop {
            // SAFETY: event_loop is the VM-owned EventLoop with process lifetime.
            unsafe { (*self.event_loop).uv_loop() }
        }

        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via [`Self::new`].
        /// On `Err` return, `*this` has been freed (via [`Self::throw`] → [`Self::deinit`])
        /// and must not be accessed again.
        pub(crate) unsafe fn open(this: *mut Self) -> Result<(), WriteFileWindowsError> {
            // SAFETY: caller contract — `this` is live.
            unsafe { (*this).io_request.data = this.cast::<c_void>() };
            // SAFETY: caller contract — `this` is live; the borrow is released
            // before any path that may free `*this`.
            let path = unsafe { &(*this).file_blob }
                .store
                .get()
                .as_ref()
                .unwrap()
                .data
                .as_file()
                .pathlike
                .path()
                .slice();
            let posix_path = match sys::to_posix_path(path) {
                Ok(p) => p,
                Err(_) => {
                    // SAFETY: caller contract — `this` is live; `throw` consumes it.
                    return Err(unsafe {
                        Self::throw(
                            this,
                            sys::Error {
                                errno: sys::E::NAMETOOLONG as _,
                                syscall: sys::Tag::open,
                                ..Default::default()
                            },
                        )
                    });
                }
            };
            // SAFETY: (*this).io_request is a valid uv_fs_t embedded in a Box-allocated WriteFileWindows;
            // (*this).loop_() is the VM's libuv loop which outlives this request; posix_path is NUL-terminated.
            let rc = unsafe {
                uv::uv_fs_open(
                    (*this).loop_(),
                    &mut (*this).io_request,
                    posix_path.as_ptr(),
                    uv::O::CREAT
                        | uv::O::WRONLY
                        | uv::O::NOCTTY
                        | uv::O::NONBLOCK
                        | uv::O::SEQUENTIAL
                        | uv::O::TRUNC,
                    0o644,
                    Some(Self::on_open),
                )
            };

            // libuv always returns 0 when a callback is specified
            if let Some(err) = rc.to_error(sys::Tag::open) {
                debug_assert!(err.get_errno() != sys::E::NOENT);
                // SAFETY: caller contract — `this` is live; `throw` consumes it.
                return Err(unsafe { Self::throw(this, err.with_path(path)) });
            } else {
                // SAFETY: caller contract — `this` is live on the Ok path.
                unsafe { (*this).owned_fd = true };
            }
            Ok(())
        }

        pub(crate) extern "C" fn on_open(req: *mut uv::fs_t) {
            // SAFETY: req points to WriteFileWindows.io_request. Kept as a raw
            // pointer (NOT `&mut`) because the paths below may free `*this`
            // (`throw`/`do_write_loop` → `deinit`), and a `&mut` argument/local
            // would be invalidated by that deallocation (Stacked Borrows).
            let this: *mut WriteFileWindows = unsafe { WriteFileWindows::from_uv_fs(req) };
            debug_assert!(core::ptr::eq(
                this,
                // SAFETY: req == &(*this).io_request; data was set to `this` in create_with_ctx/open.
                unsafe { (*req).data }.cast::<WriteFileWindows>()
            ));
            // SAFETY: `this` is live (libuv invokes us with the req we registered).
            let rc = unsafe { (*this).io_request.result };
            #[cfg(debug_assertions)]
            bun_output::scoped_log!(
                WriteFile,
                "onOpen({}) = {}",
                bstr::BStr::new(
                    // SAFETY: `this` is live.
                    unsafe { &(*this).file_blob }
                        .store
                        .get()
                        .as_ref()
                        .unwrap()
                        .data
                        .as_file()
                        .pathlike
                        .path()
                        .slice()
                ),
                rc
            );

            if let Some(err) = rc.errno() {
                // SAFETY: `this` is live.
                if err == sys::E::NOENT && unsafe { (*this).mkdirp_if_not_exists } {
                    // cleanup the request so we can reuse it later.
                    // SAFETY: req points to (*this).io_request (valid uv_fs_t); libuv permits cleanup
                    // between uses to reuse the same req struct.
                    unsafe { (*req).deinit() };

                    // attempt to create the directory on another thread
                    // SAFETY: `this` is live; `mkdirp` does not free `*this`.
                    unsafe { (*this).mkdirp() };
                    return;
                }

                // SAFETY: `this` is live; borrow released before `throw` consumes `*this`.
                let path = unsafe { &(*this).file_blob }
                    .store
                    .get()
                    .as_ref()
                    .unwrap()
                    .data
                    .as_file()
                    .pathlike
                    .path()
                    .slice()
                    .into();
                // SAFETY: `this` is live; `throw` consumes it.
                match unsafe {
                    Self::throw(
                        this,
                        sys::Error {
                            errno: err as _,
                            path,
                            syscall: sys::Tag::open,
                            ..Default::default()
                        },
                    )
                } {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
                return;
            }

            // SAFETY: `this` is live.
            unsafe { (*this).fd = i32::try_from(rc.int()).expect("int cast") };

            // the loop must be copied
            // SAFETY: `this` is live; on `Err`, `*this` has been freed and is not accessed again.
            if let Err(e) = unsafe { Self::do_write_loop(this, (*this).loop_()) } {
                match e {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
            }
        }

        fn mkdirp(&mut self) {
            bun_output::scoped_log!(WriteFile, "mkdirp");
            self.mkdirp_if_not_exists = false;

            // Compute the raw self pointer first so the immutable borrow of
            // `path` (into `self.file_blob.store`) does not conflict with the
            // `&mut self` reborrow needed by `from_mut`.
            let ctx = core::ptr::from_mut(self).cast::<()>();
            let path = self
                .file_blob
                .store
                .get()
                .as_ref()
                .unwrap()
                .data
                .as_file()
                .pathlike
                .path()
                .slice();
            crate::node::fs::async_::AsyncMkdirp::schedule(crate::node::fs::async_::AsyncMkdirp {
                completion: Self::on_mkdirp_complete_concurrent,
                completion_ctx: ctx,
                // BORROW: AsyncMkdirp.path is `*const [u8]` (not owned); `path`
                // points into `self.file_blob.store`, which outlives the mkdirp
                // task (it's released only in `deinit()`).
                path: bun_core::dirname(path)
                    // this shouldn't happen
                    .unwrap_or(path) as *const [u8],
                ticket: bun_jsc::virtual_machine::VirtualMachine::get().ticket(),
                task: Default::default(),
            });
        }

        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via [`Self::new`].
        /// `*this` may be freed by the time this returns (via `throw`/`open` → `deinit`).
        unsafe fn on_mkdirp_complete(this: *mut Self) {
            // SAFETY: caller contract — `this` is live.
            let err = unsafe { (*this).err.take() };
            if let Some(err_) = err {
                // `sys::Error.path` is an owned `Box<[u8]>` freed by its Drop;
                // no explicit free needed.
                // SAFETY: caller contract — `this` is live; `throw` consumes it.
                match unsafe { Self::throw(this, err_) } {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
                return;
            }

            // SAFETY: caller contract — `this` is live; on `Err`, `*this` has been freed.
            if let Err(e) = unsafe { Self::open(this) } {
                match e {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
            }
        }

        /// `ManagedTask`-shaped trampoline for [`on_mkdirp_complete`]: takes
        /// `*mut Self` and returns the event-loop `jsc::JsResult<()>` (always `Ok`: the inner body
        /// reports a delivery exception itself).
        fn on_mkdirp_complete_task(this: *mut WriteFileWindows) -> bun_event_loop::JsResult<()> {
            // SAFETY: `this` is the live Box-allocated `WriteFileWindows` whose
            // pointer was stashed in `on_mkdirp_complete_concurrent` below;
            // the JS thread is the sole accessor at this point. `*this` may be
            // freed inside; not accessed afterward.
            unsafe { Self::on_mkdirp_complete(this) };
            Ok(())
        }

        fn on_mkdirp_complete_concurrent(
            ctx: *mut (),
            err_: bun_sys::Result<()>,
            ticket: &bun_jsc::Ticket,
        ) {
            // SAFETY: `ctx` is the `*mut Self` stored in `AsyncMkdirp.completion_ctx`
            // by `mkdirp` above; sole owner on this concurrent path.
            let this = unsafe { bun_ptr::callback_ctx::<WriteFileWindows>(ctx.cast()) };
            bun_output::scoped_log!(WriteFile, "mkdirp complete");
            debug_assert!(this.err.is_none());
            this.err = match err_ {
                bun_sys::Result::Err(e) => Some(e),
                bun_sys::Result::Ok(()) => None,
            };
            ticket.post(ConcurrentTask::create(
                ManagedTask::new::<WriteFileWindows>(this, Self::on_mkdirp_complete_task),
            ));
        }

        extern "C" fn on_write_complete(req: *mut uv::fs_t) {
            // SAFETY: req points to WriteFileWindows.io_request. Kept as a raw
            // pointer (NOT `&mut`) because the paths below may free `*this`
            // (`throw`/`do_write_loop` → `deinit`), and a `&mut` would be
            // invalidated by that deallocation (Stacked Borrows).
            let this: *mut WriteFileWindows = unsafe { WriteFileWindows::from_uv_fs(req) };
            debug_assert!(core::ptr::eq(
                this,
                // SAFETY: req == &(*this).io_request; data was set to `this` in do_write_loop.
                unsafe { (*req).data }.cast::<WriteFileWindows>()
            ));
            // SAFETY: `this` is live (libuv invokes us with the req we registered).
            let rc = unsafe { (*this).io_request.result };
            if let Some(err) = rc.to_error(sys::Tag::write) {
                // SAFETY: `this` is live; `throw` consumes it.
                match unsafe { Self::throw(this, err) } {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
                return;
            }

            // SAFETY: `this` is live.
            unsafe { (*this).total_written += usize::try_from(rc.int()).expect("int cast") };
            // SAFETY: `this` is live; on `Err`, `*this` has been freed and is not accessed again.
            if let Err(e) = unsafe { Self::do_write_loop(this, (*this).loop_()) } {
                match e {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
            }
        }

        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via [`Self::new`].
        /// On return, `*this` has been freed and must not be accessed again.
        pub(crate) unsafe fn on_finish(this: *mut Self) -> WriteFileWindowsError {
            // SAFETY: VM-owned EventLoop lives for process lifetime; the guard
            // forms short-lived `&mut` only at the enter/exit call sites (see
            // EventLoopEnterGuard docs) so it does not alias `*this`.
            let _exit = unsafe { jsc::event_loop::EventLoop::enter_scope((*this).event_loop) };

            // We don't need to enqueue task since this is already in a task.
            // SAFETY: caller contract — `this` is live; consumed here.
            unsafe { Self::run_from_js_thread(this) }
        }

        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via [`Self::new`].
        /// On return, `*this` has been freed and must not be accessed again.
        pub(crate) unsafe fn run_from_js_thread(this: *mut Self) -> WriteFileWindowsError {
            // SAFETY: caller contract — `this` is live; copy out everything we
            // need before `deinit` frees the allocation.
            let (cb, cb_ctx) = unsafe { ((*this).on_complete_callback, (*this).on_complete_ctx) };

            // SAFETY: caller contract — `this` is live.
            if let Some(err) = unsafe { (*this).to_system_error() } {
                // SAFETY: caller contract — `this` is live; consumed here.
                unsafe { Self::deinit(this) };
                if let Err(e) = cb(cb_ctx, WriteFileResultType::Err(Box::new(err))) {
                    return e.into();
                }
            } else {
                // SAFETY: caller contract — `this` is live.
                let wrote = unsafe { (*this).total_written };
                // SAFETY: caller contract — `this` is live; consumed here.
                unsafe { Self::deinit(this) };
                if let Err(e) = cb(cb_ctx, WriteFileResultType::Result(wrote as SizeType)) {
                    return e.into();
                }
            }

            WriteFileWindowsError::WriteFileWindowsDeinitialized
        }

        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via [`Self::new`].
        /// On return, `*this` has been freed and must not be accessed again.
        pub(crate) unsafe fn throw(this: *mut Self, err: sys::Error) -> WriteFileWindowsError {
            // SAFETY: caller contract — `this` is live.
            unsafe {
                debug_assert!((*this).err.is_none());
                (*this).err = Some(err);
                Self::on_finish(this)
            }
        }

        pub(crate) fn to_system_error(&self) -> Option<SystemError> {
            if let Some(err) = &self.err {
                let mut sys_err = err.clone();
                sys_err = match &self
                    .file_blob
                    .store
                    .get()
                    .as_ref()
                    .unwrap()
                    .data
                    .as_file()
                    .pathlike
                {
                    PathOrFileDescriptor::Path(path) => sys_err.with_path(path.slice()),
                    PathOrFileDescriptor::Fd(fd) => sys_err.with_fd(*fd),
                };

                return Some(sys_err.to_system_error().into());
            }
            None
        }

        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via [`Self::new`].
        /// On `Err` return, `*this` has been freed (via `on_finish`/`throw` → `deinit`)
        /// and must not be accessed again. On `Ok`, `*this` remains live.
        pub(crate) unsafe fn do_write_loop(
            this: *mut Self,
            uv_loop: *mut uv::Loop,
        ) -> Result<(), WriteFileWindowsError> {
            // SAFETY: caller contract — `this` is live.
            let remain_full = unsafe { (*this).bytes_blob.shared_view() };
            // SAFETY: caller contract — `this` is live.
            let off = unsafe { (*this).total_written }.min(remain_full.len());
            let remain = &remain_full[off..];

            // SAFETY: caller contract — `this` is live.
            if remain.is_empty() || unsafe { (*this).err.is_some() } {
                // SAFETY: caller contract — `this` is live; consumed here.
                return Err(unsafe { Self::on_finish(this) });
            }

            // SAFETY: caller contract — `this` is live.
            unsafe {
                (*this).uv_bufs[0].base = remain.as_ptr().cast_mut();
                (*this).uv_bufs[0].len = remain.len() as u32;
            }

            // SAFETY: (*this).io_request is a valid uv_fs_t embedded in this Box-allocated struct;
            // cleanup is safe to call between uses of the same req.
            unsafe { uv::uv_fs_req_cleanup(&mut (*this).io_request) };
            // SAFETY: uv_loop is the VM's libuv loop (outlives `*this`); io_request/uv_bufs are
            // embedded in `*this` which stays alive until on_write_complete fires; fd is open.
            let rc = unsafe {
                uv::uv_fs_write(
                    uv_loop,
                    &mut (*this).io_request,
                    (*this).fd,
                    (*this).uv_bufs.as_mut_ptr(),
                    1,
                    -1,
                    Some(Self::on_write_complete),
                )
            };
            // SAFETY: caller contract — `this` is live.
            unsafe { (*this).io_request.data = this.cast::<c_void>() };
            if rc.int() == 0 {
                // EINPROGRESS
                return Ok(());
            }

            if let Some(err) = rc.to_error(sys::Tag::write) {
                // SAFETY: caller contract — `this` is live; consumed here.
                return Err(unsafe { Self::throw(this, err) });
            }

            if rc.int() != 0 {
                bun_core::Output::panic(format_args!(
                    "unexpected return code from uv_fs_write: {}",
                    rc.int()
                ));
            }
            Ok(())
        }

        pub(crate) fn new(init: WriteFileWindows) -> *mut WriteFileWindows {
            bun_core::heap::into_raw(Box::new(init))
        }

        /// # Safety
        /// `this` must be the unique live pointer to a `WriteFileWindows`
        /// allocated via [`Self::new`]. Consumes the allocation; `*this` is
        /// freed and must not be accessed after this returns.
        ///
        /// Takes a raw pointer (not `&mut self`) because reclaiming the `Box`
        /// while a `&mut self` argument is on the stack is a Stacked Borrows
        /// protector violation (deallocating memory a protected reference
        /// points into is UB even if the reference is never used again).
        pub(crate) unsafe fn deinit(this: *mut Self) {
            // SAFETY: caller contract — `this` is live.
            unsafe {
                let fd = (*this).fd;
                if fd > 0 && (*this).owned_fd {
                    aio::Closer::close(Fd::from_uv(fd), (*this).io_request.loop_);
                }
                (*this).poll_ref.disable();
                // (*this).io_request is a valid uv_fs_t embedded in this struct; uv_fs_req_cleanup
                // is safe on a zeroed or previously-used req.
                uv::uv_fs_req_cleanup(&mut (*this).io_request);
                // `this` was allocated via Self::new (heap::into_raw); reclaim and drop here.
                drop(bun_core::heap::take(this));
            }
        }

        pub(crate) fn create<C>(
            event_loop: *mut EventLoop,
            file_blob: Blob,
            bytes_blob: Blob,
            context: *mut C,
            callback: WriteFileOnWriteFileCallback,
            mkdirp_if_not_exists: bool,
        ) -> Result<*mut WriteFileWindows, WriteFileWindowsError> {
            // see `WriteFile::create` — caller supplies an erased
            // `*mut c_void` callback directly; `context` is just `.cast()`ed.
            WriteFileWindows::create_with_ctx(
                file_blob,
                bytes_blob,
                event_loop,
                context.cast::<c_void>(),
                callback,
                mkdirp_if_not_exists,
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct WriteFilePromise {
    pub(crate) promise: jsc::JSPromiseStrong,
    pub global_this: *const JSGlobalObject,
}

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

pub struct WriteFileWaitFromLockedValueTask {
    pub(crate) file_blob: Blob,
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
            body::Value::HTMLBundle(_) => {
                file_blob.detach();
                let _ = value.use_();
                drop(this);
                // SAFETY: GC-owned promise cell; exclusive borrow scoped to the call.
                unsafe {
                    (*promise).reject(
                        global_this,
                        Ok(global_this.create_type_error_instance(format_args!(
                            "An HTMLBundle body can only be sent by Bun.serve()"
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
                    global_this,
                    &mut blob,
                    &mut file_blob,
                    &blob::WriteFileOptions {
                        mkdirp_if_not_exists: Some(this.mkdirp_if_not_exists),
                        ..Default::default()
                    },
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
