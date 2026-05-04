use core::ffi::c_void;
use core::mem::offset_of;
use core::ptr::null_mut;
use core::sync::atomic::{AtomicU8, Ordering};

use bun_aio::{self as aio, KeepAlive};
use bun_core::{self, Error};
use bun_io as io;
use bun_jsc::{
    self as jsc, ConcurrentTask, EventLoop, JSGlobalObject, JSPromise, JSValue, JsTerminated,
    ManagedTask, SystemError, WorkPoolTask, WorkTask,
};
use bun_str::ZigString;
use bun_sys::{self as sys, windows::libuv as uv, Fd, INVALID_FD};
use bun_threading::{ThreadPool, WorkPool};

use crate::webcore::blob::{Blob, ClosingState, FileCloser, FileOpener, SizeType};
use crate::webcore::Body;

bun_output::declare_scope!(WriteFile, hidden);

// TODO(port): SystemError::Maybe(T) is a tagged { result: T } | { err: SystemError } union;
// modeled here as a plain Rust enum. Verify layout if it crosses FFI.
pub enum WriteFileResultType {
    Result(SizeType),
    Err(SystemError),
}

pub type WriteFileOnWriteFileCallback =
    fn(ctx: *mut c_void, count: WriteFileResultType) -> Result<(), JsTerminated>;

pub type WriteFileTask = WorkTask<WriteFile>;

pub struct WriteFile {
    pub file_blob: Blob,
    pub bytes_blob: Blob,

    pub opened_fd: Fd,
    pub system_error: Option<SystemError>,
    pub errno: Option<Error>,
    pub task: ThreadPool::Task,
    pub io_task: Option<*mut WriteFileTask>,
    pub io_poll: io::Poll,
    pub io_request: io::Request,
    pub state: AtomicU8, // std.atomic.Value(ClosingState)

    pub on_complete_ctx: *mut c_void,
    pub on_complete_callback: WriteFileOnWriteFileCallback,
    pub total_written: usize,

    pub could_block: bool,
    pub close_after_io: bool,
    pub mkdirp_if_not_exists: bool,
}

impl WriteFile {
    pub const IO_TAG: io::poll::Tag = io::poll::Tag::WriteFile;

    // TODO(port): `pub const getFd = FileOpener(@This()).getFd;` — mixin method from
    // Blob.FileOpener generic. Express as `impl FileOpener for WriteFile` in Phase B.
    // TODO(port): `pub const doClose = FileCloser(WriteFile).doClose;` — same, FileCloser trait.

    pub const OPEN_FLAGS: i32 =
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::NONBLOCK;

    pub fn on_writable(request: *mut io::Request) {
        // SAFETY: request points to WriteFile.io_request
        let this: &mut WriteFile = unsafe {
            &mut *(request as *mut u8)
                .sub(offset_of!(WriteFile, io_request))
                .cast::<WriteFile>()
        };
        this.on_ready();
    }

    pub fn on_ready(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onReady()");
        self.task = ThreadPool::Task { callback: Self::do_write_loop_task };
        WorkPool::schedule(&mut self.task);
    }

    pub fn on_io_error(&mut self, err: sys::Error) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onIOError()");
        self.errno = Some(sys::errno_to_error(err.errno));
        self.system_error = Some(err.to_system_error());
        self.task = ThreadPool::Task { callback: Self::do_write_loop_task };
        WorkPool::schedule(&mut self.task);
    }

    pub fn on_request_writable(request: *mut io::Request) -> io::Action {
        bun_output::scoped_log!(WriteFile, "WriteFile.onRequestWritable()");
        // SAFETY: request points to WriteFile.io_request
        unsafe {
            (*request).scheduled = false;
            let this: *mut WriteFile = (request as *mut u8)
                .sub(offset_of!(WriteFile, io_request))
                .cast::<WriteFile>();
            io::Action::Writable(io::action::Writable {
                on_error: core::mem::transmute::<
                    fn(&mut WriteFile, sys::Error),
                    io::action::OnErrorFn,
                >(Self::on_io_error as fn(&mut WriteFile, sys::Error)),
                ctx: this.cast::<c_void>(),
                fd: (*this).opened_fd,
                poll: &mut (*this).io_poll,
                tag: WriteFile::IO_TAG,
            })
        }
    }

    pub fn wait_for_writable(&mut self) {
        self.close_after_io = true;
        // SAFETY: matching Zig @atomicStore on a fn-pointer-sized field
        unsafe {
            core::ptr::write_volatile(
                &mut self.io_request.callback,
                Self::on_request_writable as fn(*mut io::Request) -> io::Action,
            );
            core::sync::atomic::fence(Ordering::SeqCst);
        }
        // TODO(port): Zig used @atomicStore on a fn pointer; Rust has no AtomicFnPtr —
        // using volatile write + SeqCst fence. Revisit in Phase B (likely AtomicPtr<()> in io::Request).
        if !self.io_request.scheduled {
            io::Loop::get().schedule(&mut self.io_request);
        }
    }

    pub fn create_with_ctx(
        file_blob: Blob,
        bytes_blob: Blob,
        on_write_file_context: *mut c_void,
        on_complete_callback: WriteFileOnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) -> Result<*mut WriteFile, Error> {
        // TODO(port): narrow error set
        let write_file = Box::into_raw(Box::new(WriteFile {
            file_blob,
            bytes_blob,
            opened_fd: INVALID_FD,
            system_error: None,
            errno: None,
            task: ThreadPool::Task { callback: Self::do_write_loop_task },
            io_task: None,
            io_poll: io::Poll::default(),
            io_request: io::Request { callback: Self::on_request_writable, ..Default::default() },
            state: AtomicU8::new(ClosingState::Running as u8),
            on_complete_ctx: on_write_file_context,
            on_complete_callback,
            total_written: 0,
            could_block: false,
            close_after_io: false,
            mkdirp_if_not_exists,
        }));
        // SAFETY: just allocated
        unsafe {
            (*write_file).file_blob.store.as_ref().unwrap().ref_();
            (*write_file).bytes_blob.store.as_ref().unwrap().ref_();
        }
        Ok(write_file)
    }

    pub fn create<C>(
        file_blob: Blob,
        bytes_blob: Blob,
        context: *mut C,
        callback: fn(ctx: *mut C, bytes: WriteFileResultType) -> Result<(), JsTerminated>,
        mkdirp_if_not_exists: bool,
    ) -> Result<*mut WriteFile, Error> {
        // SAFETY: erasing *mut C to *mut c_void in the first param; fn-pointer ABI is identical.
        // Mirrors Zig's Handler.run thunk which is a no-op cast wrapper.
        let erased: WriteFileOnWriteFileCallback = unsafe {
            core::mem::transmute::<
                fn(*mut C, WriteFileResultType) -> Result<(), JsTerminated>,
                WriteFileOnWriteFileCallback,
            >(callback)
        };
        WriteFile::create_with_ctx(
            file_blob,
            bytes_blob,
            context.cast::<c_void>(),
            erased,
            mkdirp_if_not_exists,
        )
    }

    // PORT NOTE: reshaped for borrowck — Zig passed `buffer: []const u8` borrowed from
    // self.bytes_blob alongside &mut self. Take (off, len) here and re-derive the slice
    // internally so callers don't hold a borrow of self across the &mut self call.
    pub fn do_write(&mut self, off: usize, len: usize, wrote: &mut usize) -> bool {
        let fd = self.opened_fd;
        debug_assert!(fd != INVALID_FD);

        // We do not use pwrite() because the file may not be
        // seekable (such as stdout)
        //
        // On macOS, it is an error to use pwrite() on a
        // non-seekable file.
        let result: bun_sys::Result<usize> =
            sys::write(fd, &self.bytes_blob.shared_view()[off..off + len]);

        loop {
            match &result {
                bun_sys::Result::Ok(res) => {
                    *wrote = *res;
                    self.total_written += *res;
                }
                bun_sys::Result::Err(err) => {
                    if err.get_errno() == io::RETRY {
                        if !self.could_block {
                            // regular files cannot use epoll.
                            // this is fine on kqueue, but not on epoll.
                            continue;
                        }
                        self.wait_for_writable();
                        return false;
                    } else {
                        self.errno = Some(sys::errno_to_error(err.get_errno() as _));
                        self.system_error = Some(err.to_system_error());
                        return false;
                    }
                }
            }
            break;
        }

        true
    }

    pub fn then(this: *mut WriteFile, _global: &JSGlobalObject) -> Result<(), JsTerminated> {
        // SAFETY: `this` is a Box-allocated WriteFile owned by the WorkTask flow; we consume it here.
        let cb;
        let cb_ctx;
        let system_error;
        let total_written;
        unsafe {
            cb = (*this).on_complete_callback;
            cb_ctx = (*this).on_complete_ctx;

            (*this).bytes_blob.store.as_ref().unwrap().deref();
            (*this).file_blob.store.as_ref().unwrap().deref();

            system_error = (*this).system_error.take();
            total_written = (*this).total_written;
            drop(Box::from_raw(this));
        }

        if let Some(err) = system_error {
            cb(cb_ctx, WriteFileResultType::Err(err))?;
            return Ok(());
        }

        cb(cb_ctx, WriteFileResultType::Result(total_written as SizeType))?;
        Ok(())
    }

    pub fn run(&mut self, task: *mut WriteFileTask) {
        #[cfg(windows)]
        {
            panic!("todo");
        }
        self.io_task = Some(task);
        self.run_async();
    }

    fn run_async(&mut self) {
        // TODO(port): get_fd is provided by FileOpener(@This()) mixin
        self.get_fd(Self::run_with_fd);
    }

    pub fn is_allowed_to_close(&self) -> bool {
        matches!(
            self.file_blob.store.as_ref().unwrap().data.file().pathlike,
            crate::webcore::blob::PathOrFd::Path(_)
        )
        // TODO(port): exact match of `store.data.file.pathlike == .path`; verify Store/PathLike shape in Phase B
    }

    fn on_finish(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onFinish()");

        let close_after_io = self.close_after_io;
        // TODO(port): do_close is provided by FileCloser(WriteFile) mixin
        if self.do_close(self.is_allowed_to_close()) {
            return;
        }
        if !close_after_io {
            if let Some(io_task) = self.io_task.take() {
                // SAFETY: io_task is a backref set in run(); WorkTask owns lifetime.
                unsafe { (*io_task).on_finish() };
            }
        }
    }

    fn run_with_fd(&mut self, fd_: Fd) {
        if fd_ == INVALID_FD || self.errno.is_some() {
            self.on_finish();
            return;
        }

        let fd = self.opened_fd;

        self.could_block = 'brk: {
            if let Some(store) = self.file_blob.store.as_ref() {
                if store.data.is_file() && store.data.file().pathlike.is_fd() {
                    // If seekable was set, then so was mode
                    if store.data.file().seekable.is_some() {
                        // This is mostly to handle pipes which were passsed to the process somehow
                        // such as stderr, stdout. Bun.stdin and Bun.stderr will automatically set `mode` for us.
                        break 'brk !bun_sys::is_regular_file(store.data.file().mode);
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
        //
        // if (this.file_blob.offset > 0) {
        //     // if we start at an offset in the file
        //     // example code:
        //     //
        //     //    Bun.write(Bun.file("/tmp/lol.txt").slice(10), "hello world");
        //     //
        //     // it should write "hello world" to /tmp/lol.txt starting at offset 10
        //     switch (bun.sys.setFileOffset(fd, this.file_blob.offset)) {
        //         // we ignore errors because it should continue to work even if its a pipe
        //         .err, .result => {},
        //     }
        // }

        if self.could_block && bun_sys::is_writable(fd) == bun_sys::Writable::NotReady {
            self.wait_for_writable();
            return;
        }

        #[cfg(target_os = "linux")]
        {
            // If it's a potentially large file, lets attempt to
            // preallocate the saved filesystem size.
            //
            // We only do this on Linux because the equivalent on macOS
            // seemed to have zero performance impact in
            // microbenchmarks.
            if !self.could_block && self.bytes_blob.shared_view().len() > 1024 {
                let _ = sys::preallocate_file(
                    fd.cast(),
                    0,
                    i64::try_from(self.bytes_blob.shared_view().len()).unwrap(),
                ); // we don't care if it fails.
            }
        }

        self.do_write_loop();
    }

    fn do_write_loop_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to WriteFile.task
        let this: &mut WriteFile = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(WriteFile, task))
                .cast::<WriteFile>()
        };
        // On macOS, we use one-shot mode, so we don't need to unregister.
        #[cfg(target_os = "macos")]
        {
            this.close_after_io = false;
        }
        this.do_write_loop();
    }

    pub fn update(&mut self) {
        self.do_write_loop();
    }

    fn do_write_loop(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
            let remain_full = self.bytes_blob.shared_view();
            // PORT NOTE: reshaped for borrowck — capture len/offset before mut borrow
            let off = self.total_written.min(remain_full.len());
            let remain_len = remain_full.len() - off;

            if remain_len > 0 && self.errno.is_none() {
                let mut wrote: usize = 0;
                let continue_writing = self.do_write(off, remain_len, &mut wrote);
                if !continue_writing {
                    // Stop writing, we errored
                    if self.errno.is_some() {
                        self.on_finish();
                        return;
                    }

                    // Stop writing, we need to wait for it to become writable.
                    return;
                }

                // Do not immediately attempt to write again if it's not a regular file.
                if self.could_block
                    && bun_sys::is_writable(self.opened_fd) == bun_sys::Writable::NotReady
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

pub struct WriteFileWindows<'a> {
    pub io_request: uv::fs_t,
    pub file_blob: Blob,
    pub bytes_blob: Blob,
    pub on_complete_callback: WriteFileOnWriteFileCallback,
    pub on_complete_ctx: *mut c_void,
    pub mkdirp_if_not_exists: bool,
    pub uv_bufs: [uv::uv_buf_t; 1],

    pub fd: uv::uv_file,
    pub err: Option<sys::Error>,
    pub total_written: usize,
    pub event_loop: &'a EventLoop,
    pub poll_ref: KeepAlive,

    pub owned_fd: bool,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WriteFileWindowsError {
    #[error("WriteFileWindowsDeinitialized")]
    WriteFileWindowsDeinitialized,
    #[error("JSTerminated")]
    JSTerminated,
}

impl From<JsTerminated> for WriteFileWindowsError {
    fn from(_: JsTerminated) -> Self {
        WriteFileWindowsError::JSTerminated
    }
}

impl<'a> WriteFileWindows<'a> {
    pub fn create_with_ctx(
        file_blob: Blob,
        bytes_blob: Blob,
        event_loop: &'a EventLoop,
        on_write_file_context: *mut c_void,
        on_complete_callback: WriteFileOnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) -> Result<*mut WriteFileWindows<'a>, WriteFileWindowsError> {
        let mkdirp = mkdirp_if_not_exists
            && file_blob.store.as_ref().unwrap().data.file().pathlike.is_path();
        let write_file = Self::new(WriteFileWindows {
            file_blob,
            bytes_blob,
            on_complete_ctx: on_write_file_context,
            on_complete_callback,
            mkdirp_if_not_exists: mkdirp,
            // SAFETY: all-zero is a valid uv::fs_t (C struct)
            io_request: unsafe { core::mem::zeroed::<uv::fs_t>() },
            uv_bufs: [uv::uv_buf_t { base: null_mut(), len: 0 }],
            event_loop,
            fd: -1,
            err: None,
            total_written: 0,
            poll_ref: KeepAlive::default(),
            owned_fd: false,
        });
        // SAFETY: just allocated, sole owner until returned
        unsafe {
            let wf = &mut *write_file;
            wf.file_blob.store.as_ref().unwrap().ref_();
            wf.bytes_blob.store.as_ref().unwrap().ref_();
            wf.io_request.loop_ = event_loop.virtual_machine.event_loop_handle.unwrap();
            wf.io_request.data = write_file.cast::<c_void>();

            match &wf.file_blob.store.as_ref().unwrap().data.file().pathlike {
                crate::webcore::blob::PathOrFd::Path(_) => {
                    wf.open()?;
                }
                crate::webcore::blob::PathOrFd::Fd(fd) => {
                    wf.fd = 'brk: {
                        if let Some(rare) = event_loop.virtual_machine.rare_data.as_ref() {
                            if wf.file_blob.store == rare.stdout_store {
                                break 'brk 1;
                            } else if wf.file_blob.store == rare.stderr_store {
                                break 'brk 2;
                            } else if wf.file_blob.store == rare.stdin_store {
                                break 'brk 0;
                            }
                        }

                        // The file stored descriptor is not stdin, stdout, or stderr.
                        fd.uv()
                    };

                    wf.do_write_loop(wf.loop_())?;
                }
            }

            wf.poll_ref.ref_(wf.event_loop.virtual_machine);
        }
        Ok(write_file)
    }

    #[inline]
    pub fn loop_(&self) -> *mut uv::Loop {
        self.event_loop.virtual_machine.event_loop_handle.unwrap()
    }

    pub fn open(&mut self) -> Result<(), WriteFileWindowsError> {
        let path = self
            .file_blob
            .store
            .as_ref()
            .unwrap()
            .data
            .file()
            .pathlike
            .path()
            .slice();
        self.io_request.data = (self as *mut Self).cast::<c_void>();
        let posix_path = match sys::to_posix_path(path) {
            Ok(p) => p,
            Err(_) => {
                return Err(self.throw(sys::Error {
                    errno: sys::E::NAMETOOLONG as _,
                    syscall: sys::Syscall::Open,
                    ..Default::default()
                }));
            }
        };
        // SAFETY: self.io_request is a valid uv_fs_t embedded in a Box-allocated WriteFileWindows;
        // self.loop_() is the VM's libuv loop which outlives this request; posix_path is NUL-terminated.
        let rc = unsafe {
            uv::uv_fs_open(
                self.loop_(),
                &mut self.io_request,
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
        if let Some(err) = rc.err_enum() {
            debug_assert!(err != sys::E::NOENT);

            return Err(self.throw(sys::Error {
                errno: err as _,
                path: path.into(),
                syscall: sys::Syscall::Open,
                ..Default::default()
            }));
        } else {
            self.owned_fd = true;
        }
        Ok(())
    }

    pub extern "C" fn on_open(req: *mut uv::fs_t) {
        // SAFETY: req points to WriteFileWindows.io_request
        let this: &mut WriteFileWindows = unsafe {
            &mut *(req as *mut u8)
                .sub(offset_of!(WriteFileWindows, io_request))
                .cast::<WriteFileWindows>()
        };
        debug_assert!(core::ptr::eq(
            this,
            // SAFETY: req == &this.io_request; data was set to `this` in create_with_ctx/open.
            unsafe { (*req).data }.cast::<WriteFileWindows>()
        ));
        let rc = this.io_request.result;
        #[cfg(debug_assertions)]
        bun_output::scoped_log!(
            WriteFile,
            "onOpen({}) = {}",
            bstr::BStr::new(
                this.file_blob
                    .store
                    .as_ref()
                    .unwrap()
                    .data
                    .file()
                    .pathlike
                    .path()
                    .slice()
            ),
            rc
        );

        if let Some(err) = rc.err_enum() {
            if err == sys::E::NOENT && this.mkdirp_if_not_exists {
                // cleanup the request so we can reuse it later.
                // SAFETY: req points to this.io_request (valid uv_fs_t); libuv permits cleanup
                // between uses to reuse the same req struct.
                unsafe { (*req).deinit() };

                // attempt to create the directory on another thread
                this.mkdirp();
                return;
            }

            match this.throw(sys::Error {
                errno: err as _,
                path: this
                    .file_blob
                    .store
                    .as_ref()
                    .unwrap()
                    .data
                    .file()
                    .pathlike
                    .path()
                    .slice()
                    .into(),
                syscall: sys::Syscall::Open,
                ..Default::default()
            }) {
                WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
            }
            return;
        }

        this.fd = i32::try_from(rc.int()).unwrap();

        // the loop must be copied
        if let Err(e) = this.do_write_loop(this.loop_()) {
            match e {
                WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
            }
        }
    }

    fn mkdirp(&mut self) {
        bun_output::scoped_log!(WriteFile, "mkdirp");
        self.mkdirp_if_not_exists = false;

        let path = self
            .file_blob
            .store
            .as_ref()
            .unwrap()
            .data
            .file()
            .pathlike
            .path()
            .slice();
        crate::node::fs::async_::AsyncMkdirp::new(crate::node::fs::async_::AsyncMkdirp {
            // SAFETY: erasing &mut Self to *mut c_void for the completion ctx; ABI-compatible cast.
            completion: unsafe {
                core::mem::transmute::<
                    fn(&mut WriteFileWindows, bun_sys::Result<()>),
                    crate::node::fs::async_::CompletionFn,
                >(Self::on_mkdirp_complete_concurrent)
            },
            completion_ctx: (self as *mut Self).cast::<c_void>(),
            path: bun_paths::dirname(path)
                // this shouldn't happen
                .unwrap_or(path)
                .into(),
        })
        .schedule();
    }

    fn on_mkdirp_complete(&mut self) {
        let err = self.err.take();
        if let Some(err_) = err {
            // PORT NOTE: Zig `defer bun.default_allocator.free(err_.path)` — handled by Drop of
            // sys::Error.path (owned Box<[u8]>); no explicit free needed.
            match self.throw(err_) {
                WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
            }
            return;
        }

        if let Err(e) = self.open() {
            match e {
                WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
            }
        }
    }

    fn on_mkdirp_complete_concurrent(&mut self, err_: bun_sys::Result<()>) {
        bun_output::scoped_log!(WriteFile, "mkdirp complete");
        debug_assert!(self.err.is_none());
        self.err = match err_ {
            bun_sys::Result::Err(e) => Some(e),
            bun_sys::Result::Ok(()) => None,
        };
        self.event_loop.enqueue_task_concurrent(ConcurrentTask::create(
            ManagedTask::new::<WriteFileWindows, _>(Self::on_mkdirp_complete, self),
        ));
        // TODO(port): ManagedTask.New(T, fn).init(this) generic — verify bun_jsc::ManagedTask API
    }

    extern "C" fn on_write_complete(req: *mut uv::fs_t) {
        // SAFETY: req points to WriteFileWindows.io_request
        let this: &mut WriteFileWindows = unsafe {
            &mut *(req as *mut u8)
                .sub(offset_of!(WriteFileWindows, io_request))
                .cast::<WriteFileWindows>()
        };
        debug_assert!(core::ptr::eq(
            this,
            // SAFETY: req == &this.io_request; data was set to `this` in do_write_loop.
            unsafe { (*req).data }.cast::<WriteFileWindows>()
        ));
        let rc = this.io_request.result;
        if let Some(err) = rc.errno() {
            match this.throw(sys::Error {
                errno: i32::try_from(err).unwrap(),
                syscall: sys::Syscall::Write,
                ..Default::default()
            }) {
                WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
            }
            return;
        }

        this.total_written += usize::try_from(rc.int()).unwrap();
        if let Err(e) = this.do_write_loop(this.loop_()) {
            match e {
                WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
            }
        }
    }

    pub fn on_finish(&mut self) -> WriteFileWindowsError {
        let event_loop = self.event_loop;
        event_loop.enter();
        let _exit = scopeguard::guard((), |_| event_loop.exit());

        // We don't need to enqueue task since this is already in a task.
        self.run_from_js_thread()
    }

    pub fn run_from_js_thread(&mut self) -> WriteFileWindowsError {
        let cb = self.on_complete_callback;
        let cb_ctx = self.on_complete_ctx;

        if let Some(err) = self.to_system_error() {
            // SAFETY: self was allocated via Self::new (Box::into_raw); reclaim and drop here.
            // self must not be used after this line.
            unsafe { drop(Box::from_raw(self as *mut Self)) };
            if let Err(e) = cb(cb_ctx, WriteFileResultType::Err(err)) {
                return e.into();
            }
        } else {
            let wrote = self.total_written;
            // SAFETY: self was allocated via Self::new (Box::into_raw); reclaim and drop here.
            // self must not be used after this line.
            unsafe { drop(Box::from_raw(self as *mut Self)) };
            if let Err(e) = cb(cb_ctx, WriteFileResultType::Result(wrote as SizeType)) {
                return e.into();
            }
        }

        WriteFileWindowsError::WriteFileWindowsDeinitialized
    }

    pub fn throw(&mut self, err: sys::Error) -> WriteFileWindowsError {
        debug_assert!(self.err.is_none());
        self.err = Some(err);
        self.on_finish()
    }

    pub fn to_system_error(&self) -> Option<SystemError> {
        if let Some(err) = &self.err {
            let mut sys_err = err.clone();
            sys_err = match &self.file_blob.store.as_ref().unwrap().data.file().pathlike {
                crate::webcore::blob::PathOrFd::Path(path) => sys_err.with_path(path.slice()),
                crate::webcore::blob::PathOrFd::Fd(fd) => sys_err.with_fd(*fd),
            };

            return Some(sys_err.to_system_error());
        }
        None
    }

    pub fn do_write_loop(&mut self, uv_loop: *mut uv::Loop) -> Result<(), WriteFileWindowsError> {
        let remain_full = self.bytes_blob.shared_view();
        let off = self.total_written.min(remain_full.len());
        let remain = &remain_full[off..];

        if remain.is_empty() || self.err.is_some() {
            return Err(self.on_finish());
        }

        self.uv_bufs[0].base = remain.as_ptr() as *mut u8;
        self.uv_bufs[0].len = remain.len() as u32;

        // SAFETY: self.io_request is a valid uv_fs_t embedded in this Box-allocated struct;
        // cleanup is safe to call between uses of the same req.
        unsafe { uv::uv_fs_req_cleanup(&mut self.io_request) };
        // SAFETY: uv_loop is the VM's libuv loop (outlives self); io_request/uv_bufs are
        // embedded in self which stays alive until on_write_complete fires; fd is open.
        let rc = unsafe {
            uv::uv_fs_write(
                uv_loop,
                &mut self.io_request,
                self.fd,
                self.uv_bufs.as_mut_ptr(),
                1,
                -1,
                Some(Self::on_write_complete),
            )
        };
        self.io_request.data = (self as *mut Self).cast::<c_void>();
        if rc.int() == 0 {
            // EINPROGRESS
            return Ok(());
        }

        if let Some(err) = rc.errno() {
            return Err(self.throw(sys::Error {
                errno: err as _,
                syscall: sys::Syscall::Write,
                ..Default::default()
            }));
        }

        if rc.int() != 0 {
            bun_core::Output::panic(format_args!(
                "unexpected return code from uv_fs_write: {}",
                rc.int()
            ));
        }
        Ok(())
    }

    pub fn new(init: WriteFileWindows<'a>) -> *mut WriteFileWindows<'a> {
        Box::into_raw(Box::new(init))
    }

    pub fn create<C>(
        event_loop: &'a EventLoop,
        file_blob: Blob,
        bytes_blob: Blob,
        context: *mut C,
        callback: fn(ctx: *mut C, bytes: WriteFileResultType) -> Result<(), JsTerminated>,
        mkdirp_if_not_exists: bool,
    ) -> Result<*mut WriteFileWindows<'a>, WriteFileWindowsError> {
        // SAFETY: erasing *mut C → *mut c_void in first param; fn-pointer ABI identical.
        let erased: WriteFileOnWriteFileCallback = unsafe {
            core::mem::transmute::<
                fn(*mut C, WriteFileResultType) -> Result<(), JsTerminated>,
                WriteFileOnWriteFileCallback,
            >(callback)
        };
        WriteFileWindows::create_with_ctx(
            file_blob,
            bytes_blob,
            event_loop,
            context.cast::<c_void>(),
            erased,
            mkdirp_if_not_exists,
        )
    }
}

impl Drop for WriteFileWindows<'_> {
    fn drop(&mut self) {
        let fd = self.fd;
        if fd > 0 && self.owned_fd {
            aio::Closer::close(Fd::from_uv(fd), self.io_request.loop_);
        }
        self.file_blob.store.as_ref().unwrap().deref();
        self.bytes_blob.store.as_ref().unwrap().deref();
        self.poll_ref.disable();
        // SAFETY: self.io_request is a valid uv_fs_t embedded in this struct; uv_fs_req_cleanup
        // is safe on a zeroed or previously-used req.
        unsafe { uv::uv_fs_req_cleanup(&mut self.io_request) };
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct WriteFilePromise<'a> {
    pub promise: jsc::JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
}

impl<'a> WriteFilePromise<'a> {
    pub fn run(handler: *mut Self, count: WriteFileResultType) -> Result<(), JsTerminated> {
        // SAFETY: handler is a Box-allocated WriteFilePromise (see Blob.zig:1172); consumed here.
        let (mut promise, global_this) = unsafe {
            let h = &mut *handler;
            let promise = h.promise.swap();
            let global_this = h.global_this;
            drop(Box::from_raw(handler));
            (promise, global_this)
        };
        let value = promise.to_js();
        value.ensure_still_alive();
        match count {
            WriteFileResultType::Err(err) => {
                promise.reject(
                    global_this,
                    err.to_error_instance_with_async_stack(global_this, &promise),
                )?;
            }
            WriteFileResultType::Result(wrote) => {
                promise.resolve(global_this, JSValue::js_number_from_uint64(wrote as u64))?;
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────

pub struct WriteFileWaitFromLockedValueTask<'a> {
    pub file_blob: Blob,
    pub global_this: &'a JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub mkdirp_if_not_exists: bool,
}

impl<'a> WriteFileWaitFromLockedValueTask<'a> {
    pub fn then_wrap(this: *mut c_void, value: &mut Body::Value) {
        let _ = Self::then(this.cast::<WriteFileWaitFromLockedValueTask>(), value);
        // TODO: properly propagate exception upwards
    }

    pub fn then(
        this: *mut WriteFileWaitFromLockedValueTask<'a>,
        value: &mut Body::Value,
    ) -> Result<(), JsTerminated> {
        // SAFETY: this is a Box-allocated task (see Blob.zig:1581).
        let this_ref = unsafe { &mut *this };
        let mut promise = this_ref.promise.get();
        let global_this = this_ref.global_this;
        let mut file_blob = this_ref.file_blob.clone();
        // TODO(port): Zig copied `var file_blob = this.file_blob;` by value (Blob is a value type
        // in Zig). In Rust this likely needs an explicit shallow copy/clone — verify Blob semantics.
        match value {
            Body::Value::Error(err_ref) => {
                file_blob.detach();
                let _ = value.use_();
                this_ref.promise.deinit();
                // SAFETY: consume Box allocation
                unsafe { drop(Box::from_raw(this)) };
                promise.reject_with_async_stack(global_this, err_ref.to_js(global_this))?;
            }
            Body::Value::Used => {
                file_blob.detach();
                let _ = value.use_();
                this_ref.promise.deinit();
                // SAFETY: consume Box allocation
                unsafe { drop(Box::from_raw(this)) };
                promise.reject(
                    global_this,
                    ZigString::init(b"Body was used after it was consumed")
                        .to_error_instance(global_this),
                )?;
            }
            Body::Value::WTFStringImpl(_)
            | Body::Value::InternalBlob(_)
            | Body::Value::Null
            | Body::Value::Empty
            | Body::Value::Blob(_) => {
                let mut blob = value.use_();
                // TODO: this should be one promise not two!
                let new_promise = match Blob::write_file_with_source_destination(
                    global_this,
                    &mut blob,
                    &mut file_blob,
                    crate::webcore::blob::WriteFileOptions {
                        mkdirp_if_not_exists: this_ref.mkdirp_if_not_exists,
                        ..Default::default()
                    },
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        file_blob.detach();
                        this_ref.promise.deinit();
                        // SAFETY: consume Box allocation
                        unsafe { drop(Box::from_raw(this)) };
                        promise.reject(global_this, err)?;
                        return Ok(());
                    }
                };

                // PORT NOTE: Zig `defer bun.destroy(this); defer this.promise.deinit(); defer file_blob.detach();`
                // — defers run in reverse order at scope exit. Use scopeguard to mirror.
                let _g1 = scopeguard::guard((), |_| unsafe { drop(Box::from_raw(this)) });
                let _g2 = scopeguard::guard(&mut this_ref.promise, |p| p.deinit());
                let _g3 = scopeguard::guard(&mut file_blob, |fb| fb.detach());
                // TODO(port): scopeguard captures overlap with `this_ref`/`this` — Phase B may need
                // to inline cleanup at each return point instead.

                if let Some(p) = new_promise.as_any_promise() {
                    match p.unwrap(global_this.vm(), jsc::UnwrapMode::MarkHandled) {
                        // Fulfill the new promise using the pending promise
                        jsc::PromiseResult::Pending => {
                            promise.resolve(global_this, new_promise)?
                        }
                        jsc::PromiseResult::Rejected(err) => {
                            promise.reject(global_this, err)?
                        }
                        jsc::PromiseResult::Fulfilled(result) => {
                            promise.resolve(global_this, result)?
                        }
                    }
                }
            }
            Body::Value::Locked(locked) => {
                locked.on_receive_value = Some(Self::then_wrap);
                locked.task = this.cast::<c_void>();
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/blob/write_file.zig (757 lines)
//   confidence: medium
//   todos:      11
//   notes:      Heavy intrusive-ptr/@fieldParentPtr patterns kept raw; FileOpener/FileCloser mixins need trait impls; WriteFileWindows<'a> lifetime + extern "C" callbacks may conflict in Phase B; Blob/Store/PathLike accessor names guessed.
// ──────────────────────────────────────────────────────────────────────────
