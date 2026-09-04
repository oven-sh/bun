use core::sync::atomic::AtomicU8;
#[cfg(not(windows))]
use core::sync::atomic::Ordering;

use crate::Error;
use bun_io as io;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, SystemError};
use bun_ptr::BackRef;
use bun_sys::{self as sys, Fd};
use bun_threading::{WorkPool, WorkPoolTask};

use crate::webcore::blob::{
    self, Blob, FileOpener, MkdirpTarget, Retry, SizeType, mkdir_if_not_exists,
};
#[cfg(not(windows))]
use crate::webcore::blob::{ClosingState, FileCloser};
use crate::webcore::body;

bun_output::declare_scope!(WriteFile, hidden);

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

/// The completion token a `WriteFile` keeps across its async I/O.
pub type WriteFileTask = bun_jsc::Completion<WriteFile>;

impl bun_jsc::JobContext for WriteFile {
    type OffThread = Self;
    /// The promise the outcome settles, on the JS thread.
    type Js = WriteFilePromise;
    /// As `ReadFile`: a write parked on a full pipe nobody drains is the one
    /// state this job can be stuck in.
    const PARKED_REQUEST: Option<bun_jsc::job::ParkedRequestOffset<Self>> = if cfg!(windows) {
        None
    } else {
        Some(bun_jsc::job::ParkedRequestOffset::INLINE)
    };
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // Starts the write; finishes from the io loop via the token.
        this.run(done);
        None
    }
    fn then(
        this: Self,
        promise: WriteFilePromise,
        _cx: &bun_jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        WriteFile::then(this, promise)
    }
}

impl WriteFile {
    /// JS thread: hand a prepared `WriteFile` to the work pool (the job is
    /// its one heap allocation); `promise` settles with the outcome.
    pub fn schedule(this: WriteFile, promise: WriteFilePromise, global: &JSGlobalObject) {
        bun_jsc::Job::<WriteFile>::schedule(&global.js_thread(), this, promise);
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
    /// The io-loop wait request and who owns this job while it may be parked
    /// (see [`io::ParkedRequest`]).
    pub(crate) io: io::ParkedRequest,
    pub(crate) state: AtomicU8, // ClosingState

    pub(crate) total_written: usize,

    #[cfg(not(windows))]
    pub(crate) could_block: bool,
    pub(crate) close_after_io: bool,
    pub(crate) mkdirp_if_not_exists: bool,
}

bun_threading::intrusive_work_task!(WriteFile, task);
bun_io::intrusive_io_request!(WriteFile, parked io);
bun_io::poll_owner!(WriteFile, io_poll, WriteFile);

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
    fn pathlike(&self) -> &jsc::node_path::PathOrFileDescriptor<'static> {
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

/// The pool re-enters a `WriteFile` through `task` after the io loop reports
/// its fd writable (or errored).
impl bun_threading::WorkTaskHandler for WriteFile {
    fn run_work_task(&mut self) {
        // On kqueue platforms we use one-shot mode, so we don't need to unregister.
        if bun_core::Environment::IS_KQUEUE {
            self.close_after_io = false;
        }
        self.do_write_loop();
    }
}

#[cfg(not(windows))]
impl io::IoRequestHandler for WriteFile {
    /// io thread: the wait request `wait_for_writable` queued was popped.
    fn on_io_request(&mut self) -> io::Action<'_> {
        bun_output::scoped_log!(WriteFile, "WriteFile.onRequestWritable()");
        if !self.io.arm() {
            self.fail_cancelled();
            return self.close_action();
        }
        let fd = self.opened_fd;
        io::Action::Writable(io::FileAction::new(self, fd))
    }
}

impl WriteFile {
    /// Hand the job back to the pool after the io loop is done with it.
    fn reschedule(&mut self) {
        self.task = bun_threading::work_task_for::<Self>();
        WorkPool::schedule(&raw mut self.task);
    }

    pub fn on_ready(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onReady()");
        #[cfg(not(windows))]
        if !self.io.fire() {
            return;
        }
        self.reschedule();
    }

    pub(crate) fn on_io_error(&mut self, err: &sys::Error) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onIOError()");
        #[cfg(not(windows))]
        if !self.io.fire() {
            return;
        }
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        self.system_error = Some(err.to_system_error().into());
        self.reschedule();
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
        if !self.io.park() {
            self.fail_cancelled();
            return self.on_finish();
        }
        self.close_after_io = true;
        self.io
            .request()
            .store_callback_seq_cst(io::io_request_callback::<Self>());
        io::IoRequestLoop::schedule(self.io.request());
    }

    #[cfg(not(windows))]
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
            task: bun_threading::work_task_for::<Self>(),
            io_task: None,
            io_poll: io::Poll::default(),
            io: io::ParkedRequest::new(io::io_request_callback::<Self>()),
            state: AtomicU8::new(ClosingState::Running as u8),
            total_written: 0,
            could_block: false,
            close_after_io: false,
            mkdirp_if_not_exists,
        };
        Ok(write_file)
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

    pub(crate) fn then(mut this: WriteFile, promise: WriteFilePromise) -> jsc::JsResult<()> {
        let system_error = this.system_error.take();
        let total_written = this.total_written;
        drop(this);

        if let Some(err) = system_error {
            return promise.settle(WriteFileResultType::Err(Box::new(err)));
        }

        promise.settle(WriteFileResultType::Result(total_written as SizeType))
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

    use bun_io::{self as aio, KeepAlive};
    use bun_jsc::EventLoopHandle;
    use bun_jsc::node_path::PathOrFileDescriptor;
    use bun_jsc::virtual_machine::VirtualMachine;
    use bun_sys::ReturnCodeExt as _;
    use bun_sys::windows::libuv as uv;

    /// Owned as a `Box` by whoever drives the next step: the creator, libuv
    /// while an open/write is in flight (`bun_io::uv_fs`), the mkdirp hop, or
    /// the JS-thread task it posts back. Finishing drops the box.
    pub(crate) struct WriteFileWindows {
        pub(crate) io_request: uv::fs_t,
        pub(crate) file_blob: Blob,
        pub(crate) bytes_blob: Blob,
        promise: Option<WriteFilePromise>,
        pub(crate) mkdirp_if_not_exists: bool,

        pub(crate) fd: uv::uv_file,
        pub(crate) err: Option<sys::Error>,
        pub(crate) total_written: usize,
        pub(crate) event_loop: EventLoopHandle,
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
        /// Start the write; `promise` settles with the outcome. `Err` means it
        /// already finished (and settled) synchronously.
        pub(crate) fn create(
            vm: &VirtualMachine,
            file_blob: Blob,
            bytes_blob: Blob,
            promise: WriteFilePromise,
            mkdirp_if_not_exists: bool,
        ) -> Result<(), WriteFileWindowsError> {
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
            let mut this = Box::new(WriteFileWindows {
                file_blob,
                bytes_blob,
                promise: Some(promise),
                mkdirp_if_not_exists: mkdirp,
                io_request: bun_core::ffi::zeroed::<uv::fs_t>(),
                event_loop: EventLoopHandle::init(vm.event_loop().cast::<()>()),
                fd: -1,
                err: None,
                total_written: 0,
                poll_ref: KeepAlive::default(),
                owned_fd: false,
            });
            this.io_request.loop_ = uv::Loop::get();
            // Taken before the first step, which may finish (and `disable()`
            // this) synchronously.
            this.poll_ref.ref_(aio::js_vm_ctx());

            let is_path = matches!(
                this.file_blob
                    .store
                    .get()
                    .as_ref()
                    .unwrap()
                    .data
                    .as_file()
                    .pathlike,
                PathOrFileDescriptor::Path(_)
            );
            if is_path {
                return Self::open(this);
            }

            this.fd = {
                let store = this.file_blob.store.get();
                let store = store.as_ref().unwrap();
                let PathOrFileDescriptor::Fd(fd) = &store.data.as_file().pathlike else {
                    unreachable!()
                };
                // `RareData::std{out,err,in}_store` is type-erased
                // `Option<NonNull<c_void>>` — compare on raw pointer identity.
                let store_ptr = store.as_ptr().cast::<core::ffi::c_void>();
                match vm.rare_data.as_ref() {
                    Some(rare) if rare.stdout_store.map(|p| p.as_ptr()) == Some(store_ptr) => 1,
                    Some(rare) if rare.stderr_store.map(|p| p.as_ptr()) == Some(store_ptr) => 2,
                    Some(rare) if rare.stdin_store.map(|p| p.as_ptr()) == Some(store_ptr) => 0,
                    // The file stored descriptor is not stdin, stdout, or stderr.
                    _ => fd.uv(),
                }
            };

            Self::do_write_loop(this)
        }

        fn path(&self) -> &[u8] {
            self.file_blob
                .store
                .get()
                .as_ref()
                .unwrap()
                .data
                .as_file()
                .pathlike
                .path()
                .slice()
        }

        /// On `Err` return, `this` has finished and been dropped.
        pub(crate) fn open(mut this: Box<Self>) -> Result<(), WriteFileWindowsError> {
            let posix_path = match sys::to_posix_path(this.path()) {
                Ok(p) => p,
                Err(_) => {
                    return Err(Self::throw(
                        this,
                        sys::Error {
                            errno: sys::E::NAMETOOLONG as _,
                            syscall: sys::Tag::open,
                            ..Default::default()
                        },
                    ));
                }
            };
            this.owned_fd = true;
            match aio::uv_fs::open(
                this,
                &posix_path,
                uv::O::CREAT
                    | uv::O::WRONLY
                    | uv::O::NOCTTY
                    | uv::O::NONBLOCK
                    | uv::O::SEQUENTIAL
                    | uv::O::TRUNC,
                0o644,
            ) {
                Ok(()) => Ok(()),
                // libuv always returns 0 when a callback is specified
                Err((mut this, rc)) => {
                    this.owned_fd = false;
                    let err = rc.to_error(sys::Tag::open).expect("negative rc");
                    debug_assert!(err.get_errno() != sys::E::NOENT);
                    let path = this.path();
                    let err = err.with_path(path);
                    Err(Self::throw(this, err))
                }
            }
        }

        fn mkdirp(mut this: Box<Self>) {
            bun_output::scoped_log!(WriteFile, "mkdirp");
            this.mkdirp_if_not_exists = false;

            let path = this.path();
            // BORROW: AsyncMkdirp.path is `*const [u8]` (not owned); `path`
            // points into `this.file_blob.store`, which the box keeps alive
            // (at a fixed address) across the mkdirp task.
            let path = bun_core::dirname(path)
                // this shouldn't happen
                .unwrap_or(path) as *const [u8];
            let ticket = VirtualMachine::get().ticket();
            crate::node::fs::async_::AsyncMkdirp::schedule(this, path, ticket);
        }

        /// On return, `this` has finished and been dropped.
        pub(crate) fn on_finish(this: Box<Self>) -> WriteFileWindowsError {
            let _exit = this.event_loop.entered();

            // We don't need to enqueue task since this is already in a task.
            Self::run_from_js_thread(this)
        }

        /// On return, `this` has been dropped.
        pub(crate) fn run_from_js_thread(mut this: Box<Self>) -> WriteFileWindowsError {
            let promise = this.promise.take().expect("settled once");

            if let Some(err) = this.to_system_error() {
                drop(this);
                if let Err(e) = promise.settle(WriteFileResultType::Err(Box::new(err))) {
                    return e.into();
                }
            } else {
                let wrote = this.total_written;
                drop(this);
                if let Err(e) = promise.settle(WriteFileResultType::Result(wrote as SizeType)) {
                    return e.into();
                }
            }

            WriteFileWindowsError::WriteFileWindowsDeinitialized
        }

        /// On return, `this` has finished and been dropped.
        pub(crate) fn throw(mut this: Box<Self>, err: sys::Error) -> WriteFileWindowsError {
            debug_assert!(this.err.is_none());
            this.err = Some(err);
            Self::on_finish(this)
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

        /// The next chunk to submit: what is left, capped at what one
        /// `uv_buf_t` can describe.
        fn remaining(&self) -> &[u8] {
            let all = self.bytes_blob.shared_view();
            let rest = &all[self.total_written.min(all.len())..];
            &rest[..rest.len().min(u32::MAX as usize)]
        }

        /// On `Err` return, `this` has finished (via `on_finish`/`throw`) and
        /// been dropped. On `Ok`, libuv has it until the write completes.
        pub(crate) fn do_write_loop(mut this: Box<Self>) -> Result<(), WriteFileWindowsError> {
            if this.remaining().is_empty() || this.err.is_some() {
                return Err(Self::on_finish(this));
            }

            this.io_request.cleanup();
            let fd = this.fd;
            match aio::uv_fs::write(this, fd, Self::remaining, -1) {
                // EINPROGRESS
                Ok(()) => Ok(()),
                Err((this, rc)) => {
                    if let Some(err) = rc.to_error(sys::Tag::write) {
                        return Err(Self::throw(this, err));
                    }
                    bun_core::Output::panic(format_args!(
                        "unexpected return code from uv_fs_write: {}",
                        rc.int()
                    ));
                }
            }
        }
    }

    impl aio::uv_fs::OnFsOpen for WriteFileWindows {
        fn on_fs_open(mut this: Box<Self>, rc: uv::ReturnCodeI64) {
            #[cfg(debug_assertions)]
            bun_output::scoped_log!(
                WriteFile,
                "onOpen({}) = {}",
                bstr::BStr::new(this.path()),
                rc
            );

            if let Some(err) = rc.errno() {
                if err == sys::E::NOENT && this.mkdirp_if_not_exists {
                    // cleanup the request so we can reuse it later.
                    this.io_request.deinit();

                    // attempt to create the directory on another thread
                    Self::mkdirp(this);
                    return;
                }

                let path = this.path();
                let err = sys::Error::from_code(err, sys::Tag::open).with_path(path);
                match Self::throw(this, err) {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
                return;
            }

            this.fd = i32::try_from(rc.int()).expect("int cast");

            if let Err(e) = Self::do_write_loop(this) {
                match e {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
            }
        }
    }

    impl aio::uv_fs::OnFsWrite for WriteFileWindows {
        fn on_fs_write(mut this: Box<Self>, rc: uv::ReturnCodeI64) {
            if let Some(err) = rc.to_error(sys::Tag::write) {
                match Self::throw(this, err) {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
                return;
            }

            this.total_written += usize::try_from(rc.int()).expect("int cast");
            if let Err(e) = Self::do_write_loop(this) {
                match e {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::Js(err) => crate::dispatch::fold(Err(err)),
                }
            }
        }
    }

    /// JS thread: the mkdirp hop came back.
    impl crate::node::fs::async_::MkdirpCompletion for Box<WriteFileWindows> {
        fn on_mkdirp_done(self, result: bun_sys::Result<()>) {
            bun_output::scoped_log!(WriteFile, "mkdirp complete");
            debug_assert!(self.err.is_none());
            // A delivery exception is reported here rather than returned.
            let finished = match result {
                Err(err) => Err(WriteFileWindows::throw(self, err)),
                Ok(()) => WriteFileWindows::open(self),
            };
            match finished {
                Ok(()) | Err(WriteFileWindowsError::WriteFileWindowsDeinitialized) => {}
                Err(WriteFileWindowsError::Js(err)) => crate::dispatch::fold(Err(err)),
            }
        }
    }

    impl Drop for WriteFileWindows {
        fn drop(&mut self) {
            let fd = self.fd;
            if fd >= 0 && self.owned_fd {
                aio::Closer::close(Fd::from_uv(fd), self.io_request.loop_);
            }
            self.poll_ref.disable();
            self.io_request.cleanup();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// The promise a `Bun.write` settles once its `WriteFile`/`WriteFileWindows`
/// finishes.
#[derive(bun_jsc::JsAffine)]
pub struct WriteFilePromise {
    promise: jsc::JSPromiseStrong,
    global_this: BackRef<JSGlobalObject>,
}

impl WriteFilePromise {
    pub(crate) fn new(global_this: &JSGlobalObject) -> Self {
        Self {
            promise: jsc::JSPromiseStrong::init(global_this),
            global_this: BackRef::new(global_this),
        }
    }

    pub(crate) fn value(&self) -> JSValue {
        self.promise.value()
    }

    pub(crate) fn settle(mut self, count: WriteFileResultType) -> jsc::JsResult<()> {
        let global_this = self.global_this;
        // `swap()` releases the Strong's root; the promise cell stays alive on
        // the stack below.
        let promise = self.promise.swap();
        let value = promise.to_js();
        value.ensure_still_alive();
        match count {
            WriteFileResultType::Err(err) => {
                let err_js = err.to_error_instance_with_async_stack(&global_this, promise);
                promise.reject(&global_this, Ok(err_js))?;
            }
            WriteFileResultType::Result(wrote) => {
                promise.resolve(&global_this, JSValue::js_number_from_uint64(wrote as u64))?;
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// `Bun.write(file, response)` whose body is still pending: waits for the
/// body's value, then writes it.
pub struct WriteFileWaitFromLockedValueTask {
    pub(crate) file_blob: Blob,
    /// JSC_BORROW: process-lifetime global.
    pub global_this: BackRef<JSGlobalObject>,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
}

impl WriteFileWaitFromLockedValueTask {
    /// `PendingValue::on_receive_value` — the body resolved (or failed).
    pub(crate) fn receive(self: Box<Self>, value: &mut body::Value) {
        let _ = Self::then(self, value);
        // TODO: properly propagate exception upwards
    }

    pub(crate) fn then(
        mut this: Box<WriteFileWaitFromLockedValueTask>,
        value: &mut body::Value,
    ) -> jsc::JsResult<()> {
        let global_ref = this.global_this;
        let global_this = global_ref.get();
        let mut file_blob = core::mem::take(&mut this.file_blob);
        match value {
            body::Value::Error(err_ref) => {
                let err = err_ref.to_js(global_this);
                file_blob.detach();
                let _ = value.use_();
                this.promise
                    .get()
                    .reject_with_async_stack(global_this, Ok(err))?;
            }
            body::Value::Used => {
                file_blob.detach();
                let _ = value.use_();
                this.promise.get().reject(
                    global_this,
                    Ok(global_this.create_error_instance(format_args!(
                        "Body was used after it was consumed"
                    ))),
                )?;
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
                        this.promise.get().reject(global_this, Err(err))?;
                        return Ok(());
                    }
                };

                let _g = scopeguard::guard((), |()| file_blob.detach());

                if let Some(p) = new_promise.as_any_promise() {
                    match p.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                        // Fulfill the new promise using the pending promise
                        jsc::PromiseResult::Pending => {
                            this.promise.get().resolve(global_this, new_promise)?
                        }
                        jsc::PromiseResult::Rejected(err) => {
                            this.promise.get().reject(global_this, Ok(err))?
                        }
                        jsc::PromiseResult::Fulfilled(result) => {
                            this.promise.get().resolve(global_this, result)?
                        }
                    }
                }
            }
            body::Value::Locked(locked) => {
                // Re-registering for a future callback — `this` stays alive.
                // Restore the moved-out blob so the next `then()` has its store.
                this.file_blob = file_blob;
                locked.on_receive_value = Some(body::ReceiveValue::WriteFile(this));
            }
        }
        Ok(())
    }
}
