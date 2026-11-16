#[cfg(not(windows))]
use core::ops::Range;

#[cfg(not(windows))]
use crate::Error;
#[cfg(not(windows))]
use bun_io as io;
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, SystemError};
#[cfg(not(windows))]
use bun_ptr::RefPtr;
use bun_sys::{self as sys, Fd};
#[cfg(not(windows))]
use bun_threading::{Link, OwnedQueue, OwnedTaskIn, WorkPoolTask};

#[cfg(not(windows))]
use crate::webcore::blob::io_parking::{IoParking, IoState, Parkable};
#[cfg(not(windows))]
use crate::webcore::blob::{ClosingState, FileOpener, MkdirpTarget, Retry, mkdir_if_not_exists};
use crate::webcore::blob::{SizeType, Store};

#[cfg(windows)]
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

pub(crate) enum WriteFileResultType {
    Result(SizeType),
    Err(Box<SystemError>),
}

/// The owner of a `WriteFile` that has left the JS thread.
#[cfg(not(windows))]
pub(crate) type WriteFileTask = bun_jsc::Completion<WriteFile>;

#[cfg(not(windows))]
impl bun_jsc::OwnedJobContext for WriteFile {
    const CANCELLABLE: bool = true;
    type OffThread = Self;
    /// Whom the write is reported to, and the global it was made in. (Dropped with the job when
    /// that is released unrun: the promise then stays pending.)
    type Js = (jsc::JSPromiseStrong, bun_ptr::BackRef<JSGlobalObject>);
    type Shared = IoParking;
    fn run(mut this: WriteFileTask) {
        let fd = this.get_fd();
        Self::run_with_fd(this, fd);
    }
    fn then(
        this: Self,
        (promise, global_this): Self::Js,
        _: &bun_jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        WriteFile::then(this, promise, &global_this)
    }
    /// As `ReadFile`: a write parked on a full pipe nobody drains is the one
    /// state this job can be stuck in.
    fn cancel(parking: &IoParking) {
        parking.cancel();
    }
}

#[cfg(not(windows))]
impl WriteFile {
    /// JS thread: hand a prepared `WriteFile` to the work pool (the job is
    /// its one heap allocation).
    pub(crate) fn schedule(
        this: WriteFile,
        promise: jsc::JSPromiseStrong,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        let global_this = bun_ptr::BackRef::new(cx.global());
        bun_jsc::Job::<WriteFile>::schedule(cx, this, (promise, global_this));
    }
}

#[cfg(not(windows))]
pub(crate) struct WriteFile {
    file_store: RefPtr<Store>,
    bytes_store: RefPtr<Store>,
    /// The part of `bytes_store` to write.
    window: Range<usize>,

    pub(crate) opened_fd: Fd,
    pub(crate) system_error: Option<SystemError>,
    pub(crate) errno: Option<Error>,
    pub task: WorkPoolTask,
    next: Link<WriteFile>,
    io: IoState,

    pub(crate) total_written: usize,

    pub(crate) could_block: bool,
    pub(crate) mkdirp_if_not_exists: bool,
}

#[cfg(not(windows))]
bun_threading::intrusive_work_task!(WriteFile, task);
#[cfg(not(windows))]
bun_core::intrusive_field!(WriteFile, next: Link<WriteFile>);

// ──────────────────────────────────────────────────────────────────────────
// FileOpener / Parkable
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
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
    fn pathlike(&self) -> PathOrFileDescriptor<'_> {
        self.file_store.data.as_file().pathlike()
    }
    fn try_mkdirp(&mut self, err: bun_sys::Error, path: &bun_core::ZStr) -> Retry {
        mkdir_if_not_exists(self, &err, path)
    }
}

#[cfg(not(windows))]
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

#[cfg(not(windows))]
impl Parkable for WriteFile {
    const IO_TAG: io::Tag = io::Tag::WriteFile;
    const SYSCALL: sys::Tag = sys::Tag::write;

    fn pending() -> &'static OwnedQueue<WriteFileTask> {
        static PENDING: OwnedQueue<WriteFileTask> = OwnedQueue::new();
        &PENDING
    }
    fn io_mut(&mut self) -> &mut IoState {
        &mut self.io
    }
    fn is_allowed_to_close(&self) -> bool {
        self.file_store.data.as_file().path().is_some()
    }
}

#[cfg(not(windows))]
impl OwnedTaskIn<WriteFileTask> for WriteFile {
    fn run(this: WriteFileTask) {
        Self::do_write_loop(this);
    }
}

#[cfg(not(windows))]
impl WriteFile {
    pub(crate) fn create(
        file_store: RefPtr<Store>,
        bytes_store: RefPtr<Store>,
        window: Range<usize>,
        mkdirp_if_not_exists: bool,
    ) -> Result<WriteFile, Error> {
        let write_file = WriteFile {
            file_store,
            bytes_store,
            window,
            opened_fd: Fd::INVALID,
            system_error: None,
            errno: None,
            task: WorkPoolTask::default(),
            next: Link::new(),
            io: IoState::default(),
            total_written: 0,
            could_block: false,
            mkdirp_if_not_exists,
        };
        Ok(write_file)
    }

    fn bytes(&self) -> &[u8] {
        &self.bytes_store.shared_view()[self.window.clone()]
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
            match sys::write(fd, &self.bytes()[off..off + len]) {
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

    pub(crate) fn then(
        mut this: WriteFile,
        mut promise: jsc::JSPromiseStrong,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        let system_error = this.system_error.take();
        let total_written = this.total_written;
        if system_error.is_none() {
            note_written(&this.file_store);
        }
        drop(this);

        if let Some(err) = system_error {
            return settle(
                &promise.swap(global_this),
                global_this,
                WriteFileResultType::Err(Box::new(err)),
            );
        }

        settle(
            &promise.swap(global_this),
            global_this,
            WriteFileResultType::Result(total_written as SizeType),
        )
    }

    fn run_with_fd(mut this: WriteFileTask, fd_: Fd) {
        if fd_ == Fd::INVALID || this.errno.is_some() {
            Self::on_finish(this);
            return;
        }

        let fd = this.opened_fd;

        // A path is opened with O_NONBLOCK. This is for pipes passed to the process, such as stdout, and costs no fstat().
        let file = this.file_store.data.as_file();
        this.could_block = file.fd().is_some() && file.seekable() == Some(false);

        // We have never supported offset in Bun.write().
        // and properly adding support means we need to also support it
        // with splice, sendfile, and the other cases.

        if this.could_block && bun_core::is_writable(fd) == bun_core::Pollable::NotReady {
            Self::wait_for_io(this);
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
            if !this.could_block && this.window.len() > 1024 {
                let _ = sys::preallocate_file(
                    fd.native(),
                    0,
                    i64::try_from(this.window.len()).expect("int cast"),
                ); // we don't care if it fails.
            }
        }

        Self::do_write_loop(this);
    }

    fn do_write_loop(mut this: WriteFileTask) {
        while this.io.state == ClosingState::Running {
            let off = this.total_written.min(this.window.len());
            let remain_len = this.window.len() - off;

            if remain_len > 0 && this.errno.is_none() {
                let wrote = match this.do_write(off, remain_len) {
                    WriteStep::Wrote(n) => n,
                    WriteStep::WouldBlock => return Self::wait_for_io(this),
                    WriteStep::Failed => return Self::on_finish(this),
                };

                // Do not immediately attempt to write again if it's not a regular file.
                if this.could_block
                    && bun_core::is_writable(this.opened_fd) == bun_core::Pollable::NotReady
                {
                    Self::wait_for_io(this);
                    return;
                }

                if wrote == 0 {
                    // we are done, we received EOF
                    Self::on_finish(this);
                    return;
                }

                continue;
            }

            break;
        }

        Self::on_finish(this);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WriteFileWindows
//
// libuv-backed write path used by `Blob.writeFileInternal` on Windows. The
// whole impl is `#[cfg(windows)]`-gated because `bun_sys::windows::libuv`
// only exists when targeting Windows.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub(crate) use self::windows_impl::WriteFileWindows;

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use crate::dispatch::fold;
    use crate::webcore::blob::Blob;
    use bun_io::{self as aio, JsKeepAlive};
    // `bun_jsc::EventLoop` is a *module* (namespace re-export); the struct
    // lives one level deeper.
    use bun_jsc::event_loop::EventLoop;
    use bun_sys::ReturnCodeExt as _;
    use bun_sys::windows::libuv as uv;

    /// One owner at a time: a `Box` here, or libuv and the pool while they work for it.
    pub(crate) struct WriteFileWindows {
        io_request: uv::fs::Request,
        pub(crate) file_blob: Blob,
        pub(crate) bytes_blob: Blob,
        pub(crate) promise: jsc::JSPromiseStrong,
        /// The global `promise` was made in.
        pub(crate) global_this: bun_ptr::BackRef<JSGlobalObject>,
        /// The context of the script that asked for the write.
        pub(crate) context: bun_jsc::ContextId,
        pub(crate) mkdirp_if_not_exists: bool,

        pub(crate) fd: uv::uv_file,
        pub(crate) err: Option<sys::Error>,
        pub(crate) total_written: usize,
        pub(crate) event_loop: &'static EventLoop,
        _keep_alive: JsKeepAlive,

        pub(crate) owned_fd: bool,
    }

    bun_core::intrusive_field!(WriteFileWindows, io_request: uv::fs::Request);

    // SAFETY: the path of a store does not change, and `err` owns its bytes.
    unsafe impl crate::node::fs::async_::AsyncMkdirpTarget for WriteFileWindows {
        fn directory(&self) -> &[u8] {
            let path = self.path();
            bun_core::dirname(path).unwrap_or(path)
        }
        fn set_error(&mut self, err: sys::Error) {
            self.err = Some(err);
        }
    }

    /// `mkdirp` finished on the work pool: the hop back to the JS thread.
    impl bun_event_loop::BoxedTask for WriteFileWindows {
        const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WriteFileWindowsMkdirp;
        fn release_unrun(self: Box<Self>) {}
        /// Enters no context.
        fn context(&self) -> bun_event_loop::ContextId {
            bun_event_loop::ContextId::NONE
        }
    }

    impl WriteFileWindows {
        pub(crate) fn start(
            event_loop: &'static EventLoop,
            script_context: &bun_jsc::ScriptExecutionContext,
            file_blob: Blob,
            bytes_blob: Blob,
            promise: jsc::JSPromiseStrong,
            global_this: &JSGlobalObject,
            mkdirp_if_not_exists: bool,
        ) -> jsc::JsResult<()> {
            let mkdirp = mkdirp_if_not_exists && file_blob.file().unwrap().path().is_some();
            let mut write_file = Box::new(WriteFileWindows {
                file_blob,
                bytes_blob,
                promise,
                global_this: bun_ptr::BackRef::new(global_this),
                context: script_context.id(),
                mkdirp_if_not_exists: mkdirp,
                io_request: Default::default(),
                event_loop,
                fd: -1,
                err: None,
                total_written: 0,
                _keep_alive: JsKeepAlive::active(),
                owned_fd: false,
            });

            let store = write_file.file_blob.store().unwrap();
            let Some(fd) = store.data.as_file().fd() else {
                return write_file.open();
            };
            write_file.fd = fd.uv();

            write_file.do_write_loop()
        }

        fn path(&self) -> &[u8] {
            let store = self.file_blob.store().unwrap();
            store.data.as_file().path().unwrap()
        }

        fn open(mut self: Box<Self>) -> jsc::JsResult<()> {
            let Ok(posix_path) = sys::to_posix_path(self.path()) else {
                return self.throw(sys::Error {
                    errno: sys::E::NAMETOOLONG as _,
                    syscall: sys::Tag::open,
                    ..Default::default()
                });
            };
            self.owned_fd = true;
            let loop_ = self.event_loop.uv_loop();
            let started = uv::fs::open(
                self,
                loop_,
                bun_core::ZStr::from_cstr(&posix_path),
                uv::O::CREAT
                    | uv::O::WRONLY
                    | uv::O::NOCTTY
                    | uv::O::NONBLOCK
                    | uv::O::SEQUENTIAL
                    | uv::O::TRUNC,
                0o644,
                Self::on_open,
            );

            if let Err((this, rc)) = started {
                let err = sys::Error::from_uv(rc, sys::Tag::open);
                debug_assert!(err.get_errno() != sys::E::NOENT);
                return this.throw(err);
            }
            Ok(())
        }

        fn on_open(mut self: Box<Self>, rc: uv::ReturnCodeI64) {
            #[cfg(debug_assertions)]
            bun_output::scoped_log!(
                WriteFile,
                "onOpen({}) = {}",
                bstr::BStr::new(self.path()),
                rc
            );

            if let Some(err) = rc.errno() {
                if err == sys::E::NOENT && self.mkdirp_if_not_exists {
                    // attempt to create the directory on another thread
                    self.mkdirp();
                    return;
                }

                fold(self.throw(sys::Error::from_code(err, sys::Tag::open)));
                return;
            }

            self.fd = i32::try_from(rc.int()).expect("int cast");

            fold(self.do_write_loop());
        }

        fn mkdirp(mut self: Box<Self>) {
            bun_output::scoped_log!(WriteFile, "mkdirp");
            self.mkdirp_if_not_exists = false;
            crate::node::fs::async_::AsyncMkdirp::schedule(self);
        }

        pub(crate) fn on_mkdirp_complete(mut self: Box<Self>) {
            fold(match self.err.take() {
                Some(err) => self.throw(err),
                None => self.open(),
            });
        }

        fn on_write_complete(mut self: Box<Self>, rc: uv::ReturnCodeI64) {
            if let Some(err) = rc.to_error(sys::Tag::write) {
                fold(self.throw(err));
                return;
            }

            self.total_written += usize::try_from(rc.int()).expect("int cast");
            fold(self.do_write_loop());
        }

        fn on_finish(mut self: Box<Self>) -> jsc::JsResult<()> {
            let _exit = self.event_loop.enter_scope();

            let (mut promise, global_this) = (self.promise.take(), self.global_this);
            let _context =
                bun_jsc::virtual_machine::VirtualMachine::get().enter_context(self.context);

            let result = if let Some(err) = self.to_system_error() {
                WriteFileResultType::Err(Box::new(err))
            } else {
                note_written(self.file_blob.store().unwrap());
                WriteFileResultType::Result(self.total_written as SizeType)
            };
            drop(self);

            settle(&promise.swap(&global_this), &global_this, result)
        }

        fn throw(mut self: Box<Self>, err: sys::Error) -> jsc::JsResult<()> {
            debug_assert!(self.err.is_none());
            self.err = Some(err);
            self.on_finish()
        }

        pub(crate) fn to_system_error(&self) -> Option<SystemError> {
            if let Some(err) = &self.err {
                let mut sys_err = err.clone();
                sys_err = match &self.file_blob.store().unwrap().data.as_file().pathlike() {
                    PathOrFileDescriptor::Path(path) => sys_err.with_path(path.slice()),
                    PathOrFileDescriptor::Fd(fd) => sys_err.with_fd(*fd),
                };

                return Some(sys_err.to_system_error().into());
            }
            None
        }

        fn remaining(&self) -> &[u8] {
            let bytes = self.bytes_blob.shared_view();
            &bytes[self.total_written.min(bytes.len())..]
        }

        fn do_write_loop(self: Box<Self>) -> jsc::JsResult<()> {
            if self.remaining().is_empty() {
                return self.on_finish();
            }

            let (loop_, fd) = (self.event_loop.uv_loop(), self.fd);
            let started = uv::fs::write(
                self,
                loop_,
                fd,
                Self::remaining,
                -1,
                Self::on_write_complete,
            );
            if let Err((this, rc)) = started {
                return this.throw(sys::Error::from_uv(rc, sys::Tag::write));
            }
            Ok(())
        }
    }

    impl Drop for WriteFileWindows {
        fn drop(&mut self) {
            if self.fd > 0 && self.owned_fd {
                aio::Closer::close(Fd::from_uv(self.fd), self.event_loop.uv_loop());
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// Reports a finished write to its promise.
fn settle(
    promise: &JSPromise,
    global_this: &JSGlobalObject,
    count: WriteFileResultType,
) -> jsc::JsResult<()> {
    let value = promise.to_js();
    value.ensure_still_alive();
    match count {
        WriteFileResultType::Err(err) => {
            let err_js = err.to_error_instance_with_async_stack(global_this, promise);
            promise.reject(global_this, Ok(err_js))?;
        }
        WriteFileResultType::Result(wrote) => {
            promise.resolve(global_this, JSValue::js_number_from_uint64(wrote as u64))?;
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────

pub(super) fn note_written(file_store: &Store) {
    if let Some(path) = file_store.data.as_file().path() {
        crate::node::fs::note_opened_for_write(path, true);
    }
}
