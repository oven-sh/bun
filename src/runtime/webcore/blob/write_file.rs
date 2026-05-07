use core::ffi::c_void;
use core::mem::offset_of;
use core::sync::atomic::{AtomicU8, Ordering};

use bun_core::Error;
use bun_io as io;
use bun_jsc::{
    self as jsc, JSGlobalObject, JSPromise, JSValue, JsTerminated, SystemError, SysErrorJsc,
};
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::ZigStringJsc as _;
use bun_str::ZigString;
use bun_sys::{self as sys, Fd};
use bun_threading::{WorkPool, WorkPoolTask};

use crate::webcore::blob::{
    self, mkdir_if_not_exists, Blob, ClosingState, FileCloser, FileOpener, MkdirpTarget, Retry,
    SizeType,
};
use crate::webcore::body;

bun_output::declare_scope!(WriteFile, hidden);

// TODO(port): SystemError::Maybe(T) is a tagged { result: T } | { err: SystemError } union;
// modeled here as a plain Rust enum. Verify layout if it crosses FFI.
pub enum WriteFileResultType {
    Result(SizeType),
    Err(SystemError),
}

pub type WriteFileOnWriteFileCallback =
    fn(ctx: *mut c_void, count: WriteFileResultType) -> Result<(), JsTerminated>;

pub type WriteFileTask = bun_jsc::work_task::WorkTask<WriteFile>;

impl bun_jsc::work_task::WorkTaskContext for WriteFile {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WriteFileTask;
    fn run(this: *mut Self, task: *mut bun_jsc::work_task::WorkTask<Self>) {
        // SAFETY: WorkTask::run_from_thread_pool guarantees `this` is live.
        unsafe { (*this).run(task) }
    }
    fn then(this: *mut Self, global: &jsc::JSGlobalObject) -> Result<(), JsTerminated> {
        WriteFile::then(this, global)
    }
}

pub struct WriteFile {
    pub file_blob: Blob,
    pub bytes_blob: Blob,

    pub opened_fd: Fd,
    pub system_error: Option<SystemError>,
    pub errno: Option<Error>,
    pub task: WorkPoolTask,
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

// ──────────────────────────────────────────────────────────────────────────
// Zig: `pub const getFd = FileOpener(@This()).getFd;`
//      `pub const doClose = FileCloser(WriteFile).doClose;`
// ──────────────────────────────────────────────────────────────────────────

impl FileOpener for WriteFile {
    const OPEN_FLAGS: i32 =
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::NONBLOCK;

    fn opened_fd(&self) -> Fd { self.opened_fd }
    fn set_opened_fd(&mut self, fd: Fd) { self.opened_fd = fd; }
    fn set_errno(&mut self, e: Error) { self.errno = Some(e); }
    fn set_system_error(&mut self, e: SystemError) { self.system_error = Some(e); }
    fn pathlike(&self) -> &PathOrFileDescriptor {
        &self.file_blob.store.as_ref().unwrap().data.as_file().pathlike
    }
    fn try_mkdirp(
        &mut self,
        err: bun_sys::Error,
        path: &bun_str::ZStr,
        display_path: &[u8],
    ) -> Retry {
        // Zig: `if (@hasField(This, "mkdirp_if_not_exists")) switch (mkdirIfNotExists(...)) { ... }`
        mkdir_if_not_exists(self, err, path, display_path)
    }
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t { unreachable!("WriteFile is POSIX-only; see WriteFileWindows") }
    #[cfg(windows)]
    fn req(&mut self) -> &mut bun_libuv_sys::uv_fs_t { unreachable!("WriteFile is POSIX-only") }
    #[cfg(windows)]
    fn set_open_callback(&mut self, _cb: fn(&mut Self, Fd)) { unreachable!() }
    #[cfg(windows)]
    fn open_callback(&self) -> fn(&mut Self, Fd) { unreachable!() }
}

impl MkdirpTarget for WriteFile {
    fn mkdirp_if_not_exists(&self) -> bool { self.mkdirp_if_not_exists }
    fn set_mkdirp_if_not_exists(&mut self, v: bool) { self.mkdirp_if_not_exists = v; }
    fn set_system_error(&mut self, e: bun_sys::SystemError) { self.system_error = Some(e.into()); }
    fn set_errno_if_present(&mut self, e: Error) { self.errno = Some(e); }
    fn set_opened_fd_if_present(&mut self, fd: Fd) { self.opened_fd = fd; }
}

impl FileCloser for WriteFile {
    const IO_TAG: io::Tag = io::Tag::WriteFile;
    fn opened_fd(&self) -> Fd { self.opened_fd }
    fn set_opened_fd(&mut self, fd: Fd) { self.opened_fd = fd; }
    fn close_after_io(&self) -> bool { self.close_after_io }
    fn set_close_after_io(&mut self, v: bool) { self.close_after_io = v; }
    fn state(&self) -> &AtomicU8 { &self.state }
    fn io_request(&mut self) -> Option<&mut io::Request> { Some(&mut self.io_request) }
    fn io_poll(&mut self) -> &mut io::Poll { &mut self.io_poll }
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask { &mut self.task }
    fn update(&mut self) { WriteFile::update(self) }
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t { unreachable!() }

    fn schedule_close(request: &mut io::Request) -> io::Action<'_> {
        // SAFETY: request is &mut self.io_request (intrusive); recover parent.
        let this: &mut WriteFile = unsafe {
            &mut *(std::ptr::from_mut::<io::Request>(request).cast::<u8>()
                .sub(offset_of!(WriteFile, io_request))
                .cast::<WriteFile>())
        };
        fn on_done(ctx: *mut ()) {
            // SAFETY: ctx is `self as *mut WriteFile` set below.
            let this = unsafe { &mut *ctx.cast::<WriteFile>() };
            <WriteFile as FileCloser>::on_io_request_closed(this);
        }
        // PORT NOTE: reshaped for borrowck — compute the parent raw pointer
        // before mutably borrowing `io_poll` so the two borrows do not overlap.
        let ctx = std::ptr::from_mut::<WriteFile>(this).cast::<()>();
        let fd = this.opened_fd;
        io::Action::Close(io::CloseAction {
            fd,
            poll: &mut this.io_poll,
            ctx,
            tag: <Self as FileCloser>::IO_TAG,
            on_done,
        })
    }

    unsafe fn on_close_io_request(task: *mut bun_jsc::WorkPoolTask) {
        // SAFETY: task is &mut self.task (intrusive); recover parent.
        let this: &mut WriteFile = unsafe {
            &mut *(task.cast::<u8>().sub(offset_of!(WriteFile, task)).cast::<WriteFile>())
        };
        this.close_after_io = false;
        WriteFile::update(this);
    }
}

impl WriteFile {
    pub const IO_TAG: io::Tag = io::Tag::WriteFile;

    pub const OPEN_FLAGS: i32 =
        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::NONBLOCK;

    pub fn on_writable(request: &mut io::Request) {
        // SAFETY: request points to WriteFile.io_request
        let this: &mut WriteFile = unsafe {
            &mut *std::ptr::from_mut::<io::Request>(request).cast::<u8>()
                .sub(offset_of!(WriteFile, io_request))
                .cast::<WriteFile>()
        };
        this.on_ready();
    }

    pub fn on_ready(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onReady()");
        self.task = WorkPoolTask { node: Default::default(), callback: Self::do_write_loop_task };
        WorkPool::schedule(&raw mut self.task);
    }

    pub fn on_io_error(this: *mut (), err: sys::Error) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onIOError()");
        // SAFETY: ctx was set to `self as *mut WriteFile` in `on_request_writable`.
        let this = unsafe { &mut *this.cast::<WriteFile>() };
        this.errno = Some(bun_core::errno_to_zig_err(err.errno as i32));
        this.system_error = Some(err.to_system_error().into());
        this.task = WorkPoolTask { node: Default::default(), callback: Self::do_write_loop_task };
        WorkPool::schedule(&raw mut this.task);
    }

    pub fn on_request_writable(request: &mut io::Request) -> io::Action<'_> {
        bun_output::scoped_log!(WriteFile, "WriteFile.onRequestWritable()");
        request.scheduled = false;
        // SAFETY: request points to WriteFile.io_request (intrusive); recover parent.
        let this: &mut WriteFile = unsafe {
            &mut *std::ptr::from_mut::<io::Request>(request).cast::<u8>()
                .sub(offset_of!(WriteFile, io_request))
                .cast::<WriteFile>()
        };
        io::Action::Writable(io::FileAction {
            on_error: Self::on_io_error,
            ctx: std::ptr::from_mut::<WriteFile>(this).cast::<()>(),
            fd: this.opened_fd,
            poll: &mut this.io_poll,
            tag: WriteFile::IO_TAG,
        })
    }

    pub fn wait_for_writable(&mut self) {
        self.close_after_io = true;
        // Zig: `@atomicStore(?*const fn, &self.io_request.callback, &onRequestWritable, .seq_cst)`.
        self.io_request.store_callback_seq_cst(Self::on_request_writable);
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
        let write_file = Box::into_raw(Box::new(WriteFile {
            file_blob,
            bytes_blob,
            opened_fd: Fd::INVALID,
            system_error: None,
            errno: None,
            task: WorkPoolTask { node: Default::default(), callback: Self::do_write_loop_task },
            io_task: None,
            io_poll: io::Poll::default(),
            io_request: io::Request::new(Self::on_request_writable),
            state: AtomicU8::new(ClosingState::Running as u8),
            on_complete_ctx: on_write_file_context,
            on_complete_callback,
            total_written: 0,
            could_block: false,
            close_after_io: false,
            mkdirp_if_not_exists,
        }));
        // PORT NOTE: Zig follows with `file_blob.store.?.ref()` because the Zig
        // caller bitwise-copies `Blob` (no ref bump, no dtor) and `bun.destroy`
        // in `then` does not deref. In Rust the caller passes a `+1` Blob (via
        // `borrowed_view()`'s `StoreRef::clone`) and `Box::from_raw(this)` in
        // `then` runs `StoreRef::drop`, so the explicit ref/deref pair is
        // folded into RAII.
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
        debug_assert!(fd != Fd::INVALID);

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
                        self.errno = Some(bun_core::errno_to_zig_err(err.errno as i32));
                        self.system_error = Some(err.to_system_error().into());
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
            system_error = (*this).system_error.take();
            total_written = (*this).total_written;
            // PORT NOTE: Zig `bytes_blob.store.?.deref()` / `file_blob.store.?.deref()`
            // are subsumed by `StoreRef::drop` when the Box is reclaimed (paired
            // with the RAII note in `create_with_ctx`).
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
        self.get_fd(Self::run_with_fd);
    }

    pub fn is_allowed_to_close(&self) -> bool {
        self.file_blob
            .store
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
                // SAFETY: io_task is a backref set in run(); WorkTask owns lifetime.
                unsafe { bun_jsc::work_task::WorkTask::on_finish(io_task) };
            }
        }
    }

    fn run_with_fd(&mut self, fd_: Fd) {
        if fd_ == Fd::INVALID || self.errno.is_some() {
            self.on_finish();
            return;
        }

        let fd = self.opened_fd;

        self.could_block = 'brk: {
            if let Some(store) = self.file_blob.store.as_ref() {
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

        if self.could_block && bun_core::is_writable(fd) == bun_core::Pollable::NotReady {
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
                    fd.native(),
                    0,
                    i64::try_from(self.bytes_blob.shared_view().len()).expect("int cast"),
                ); // we don't care if it fails.
            }
        }

        self.do_write_loop();
    }

    unsafe fn do_write_loop_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to WriteFile.task
        let this: &mut WriteFile = unsafe {
            &mut *task.cast::<u8>()
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
pub use self::windows_impl::{WriteFileWindows, WriteFileWindowsError};

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use core::ptr::null_mut;

    use bun_aio::{self as aio, KeepAlive};
    // `bun_jsc::EventLoop`/`ManagedTask` are *modules* (Zig-style namespace
    // re-exports); the structs live one level deeper.
    use bun_jsc::{ConcurrentTask, event_loop::EventLoop, ManagedTask::ManagedTask};
    use bun_sys::windows::libuv as uv;
    use bun_sys::ReturnCodeExt as _;

    pub struct WriteFileWindows {
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
        pub event_loop: *mut EventLoop,
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

    impl WriteFileWindows {
        pub fn create_with_ctx(
            file_blob: Blob,
            bytes_blob: Blob,
            event_loop: *mut EventLoop,
            on_write_file_context: *mut c_void,
            on_complete_callback: WriteFileOnWriteFileCallback,
            mkdirp_if_not_exists: bool,
        ) -> Result<*mut WriteFileWindows, WriteFileWindowsError> {
            let mkdirp = mkdirp_if_not_exists
                && file_blob.store.as_ref().unwrap().data.as_file().pathlike.is_path();
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
            // SAFETY: just allocated, sole owner until returned.
            // PORT NOTE: Zig's `file_blob.store.?.ref()` / `bytes_blob.store.?.ref()`
            // are omitted — the Rust caller passes `+1` Blobs via
            // `borrowed_view()` and `deinit` releases them via
            // `Box::from_raw → StoreRef::drop`.
            unsafe {
                let wf = &mut *write_file;
                wf.io_request.loop_ = (*event_loop).virtual_machine.event_loop_handle.unwrap();
                wf.io_request.data = write_file.cast::<c_void>();

                match &wf.file_blob.store.as_ref().unwrap().data.as_file().pathlike {
                    PathOrFileDescriptor::Path(_) => {
                        wf.open()?;
                    }
                    PathOrFileDescriptor::Fd(fd) => {
                        wf.fd = 'brk: {
                            if let Some(rare) = (*event_loop).virtual_machine.rare_data.as_ref() {
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

                wf.poll_ref.ref_((*wf.event_loop).virtual_machine);
            }
            Ok(write_file)
        }

        #[inline]
        pub fn loop_(&self) -> *mut uv::Loop {
            // SAFETY: event_loop is the VM-owned EventLoop with process lifetime.
            unsafe { (*self.event_loop).virtual_machine.event_loop_handle.unwrap() }
        }

        pub fn open(&mut self) -> Result<(), WriteFileWindowsError> {
            let path = self
                .file_blob
                .store
                .as_ref()
                .unwrap()
                .data
                .as_file()
                .pathlike
                .path()
                .slice();
            self.io_request.data = (core::ptr::from_mut(self)).cast::<c_void>();
            let posix_path = match sys::to_posix_path(path) {
                Ok(p) => p,
                Err(_) => {
                    return Err(self.throw(sys::Error {
                        errno: sys::E::NAMETOOLONG as _,
                        syscall: sys::Tag::open,
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
            if let Some(err) = rc.err_enum_e() {
                debug_assert!(err != sys::E::NOENT);

                return Err(self.throw(sys::Error {
                    errno: err as _,
                    path: path.into(),
                    syscall: sys::Tag::open,
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
                &mut *req.cast::<u8>()
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
                        .as_file()
                        .pathlike
                        .path()
                        .slice()
                ),
                rc
            );

            if let Some(err) = rc.err_enum_e() {
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
                        .as_file()
                        .pathlike
                        .path()
                        .slice()
                        .into(),
                    syscall: sys::Tag::open,
                    ..Default::default()
                }) {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
                }
                return;
            }

            this.fd = i32::try_from(rc.int()).expect("int cast");

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
                .as_file()
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
                completion_ctx: (core::ptr::from_mut(self)).cast::<c_void>(),
                path: bun_core::dirname(path)
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
            // SAFETY: event_loop is the VM-owned EventLoop with process lifetime.
            unsafe {
                (*self.event_loop).enqueue_task_concurrent(ConcurrentTask::create(
                    ManagedTask::new::<WriteFileWindows>(self, Self::on_mkdirp_complete),
                ));
            }
        }

        extern "C" fn on_write_complete(req: *mut uv::fs_t) {
            // SAFETY: req points to WriteFileWindows.io_request
            let this: &mut WriteFileWindows = unsafe {
                &mut *req.cast::<u8>()
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
                    errno: i32::try_from(err).expect("int cast"),
                    syscall: sys::Tag::write,
                    ..Default::default()
                }) {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
                }
                return;
            }

            this.total_written += usize::try_from(rc.int()).expect("int cast");
            if let Err(e) = this.do_write_loop(this.loop_()) {
                match e {
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => {}
                    WriteFileWindowsError::JSTerminated => {} // TODO: properly propagate exception upwards
                }
            }
        }

        pub fn on_finish(&mut self) -> WriteFileWindowsError {
            // SAFETY: VM-owned EventLoop lives for process lifetime; the guard
            // forms short-lived `&mut` only at the enter/exit call sites (see
            // EventLoopEnterGuard docs) so it does not alias `self`.
            let _exit = unsafe { jsc::event_loop::EventLoop::enter_scope(self.event_loop) };

            // We don't need to enqueue task since this is already in a task.
            self.run_from_js_thread()
        }

        pub fn run_from_js_thread(&mut self) -> WriteFileWindowsError {
            let cb = self.on_complete_callback;
            let cb_ctx = self.on_complete_ctx;

            if let Some(err) = self.to_system_error() {
                self.deinit();
                if let Err(e) = cb(cb_ctx, WriteFileResultType::Err(err)) {
                    return e.into();
                }
            } else {
                let wrote = self.total_written;
                self.deinit();
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
                sys_err = match &self.file_blob.store.as_ref().unwrap().data.as_file().pathlike {
                    PathOrFileDescriptor::Path(path) => sys_err.with_path(path.slice()),
                    PathOrFileDescriptor::Fd(fd) => sys_err.with_fd(*fd),
                };

                return Some(sys_err.to_system_error());
            }
            None
        }

        pub fn do_write_loop(
            &mut self,
            uv_loop: *mut uv::Loop,
        ) -> Result<(), WriteFileWindowsError> {
            let remain_full = self.bytes_blob.shared_view();
            let off = self.total_written.min(remain_full.len());
            let remain = &remain_full[off..];

            if remain.is_empty() || self.err.is_some() {
                return Err(self.on_finish());
            }

            self.uv_bufs[0].base = remain.as_ptr().cast_mut();
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
            self.io_request.data = (core::ptr::from_mut(self)).cast::<c_void>();
            if rc.int() == 0 {
                // EINPROGRESS
                return Ok(());
            }

            if let Some(err) = rc.errno() {
                return Err(self.throw(sys::Error {
                    errno: err as _,
                    syscall: sys::Tag::write,
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

        pub fn new(init: WriteFileWindows) -> *mut WriteFileWindows {
            Box::into_raw(Box::new(init))
        }

        pub fn deinit(&mut self) {
            let fd = self.fd;
            if fd > 0 && self.owned_fd {
                aio::Closer::close(Fd::from_uv(fd), self.io_request.loop_);
            }
            // PORT NOTE: Zig `file_blob.store.?.deref()` / `bytes_blob.store.?.deref()`
            // are subsumed by `StoreRef::drop` when the Box is reclaimed below
            // (paired with the RAII note in `create_with_ctx`).
            self.poll_ref.disable();
            // SAFETY: self.io_request is a valid uv_fs_t embedded in this struct; uv_fs_req_cleanup
            // is safe on a zeroed or previously-used req.
            unsafe { uv::uv_fs_req_cleanup(&mut self.io_request) };
            // SAFETY: self was allocated via Self::new (Box::into_raw); reclaim and drop here.
            // self must not be used after this line.
            unsafe { drop(Box::from_raw(core::ptr::from_mut(self))) };
        }

        pub fn create<C>(
            event_loop: *mut EventLoop,
            file_blob: Blob,
            bytes_blob: Blob,
            context: *mut C,
            callback: fn(ctx: *mut C, bytes: WriteFileResultType) -> Result<(), JsTerminated>,
            mkdirp_if_not_exists: bool,
        ) -> Result<*mut WriteFileWindows, WriteFileWindowsError> {
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
}

// ──────────────────────────────────────────────────────────────────────────

pub struct WriteFilePromise {
    pub promise: jsc::JSPromiseStrong,
    pub global_this: *const JSGlobalObject,
}

impl WriteFilePromise {
    pub fn run(handler: *mut Self, count: WriteFileResultType) -> Result<(), JsTerminated> {
        // SAFETY: handler is a Box-allocated WriteFilePromise (see Blob.zig:1172); consumed here.
        // `swap()` releases the Strong's handle slot and yields a GC-owned `*mut JSPromise`,
        // which stays valid past `drop(Box::from_raw(handler))`.
        let (promise, global_this): (*mut JSPromise, &JSGlobalObject) = unsafe {
            let h = &mut *handler;
            let promise = std::ptr::from_mut::<JSPromise>(h.promise.swap());
            let global_this = &*h.global_this;
            drop(Box::from_raw(handler));
            (promise, global_this)
        };
        // SAFETY: GC-owned cell; sole `&mut` borrow at each call site.
        let promise = unsafe { &mut *promise };
        let value = promise.to_js();
        value.ensure_still_alive();
        match count {
            WriteFileResultType::Err(err) => {
                promise.reject(
                    global_this,
                    Ok(err.to_error_instance_with_async_stack(global_this, promise)),
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

pub struct WriteFileWaitFromLockedValueTask {
    pub file_blob: Blob,
    pub global_this: *const JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub mkdirp_if_not_exists: bool,
}

impl WriteFileWaitFromLockedValueTask {
    pub fn then_wrap(this: *mut c_void, value: &mut body::Value) {
        let _ = Self::then(this.cast::<WriteFileWaitFromLockedValueTask>(), value);
        // TODO: properly propagate exception upwards
    }

    pub fn then(
        this: *mut WriteFileWaitFromLockedValueTask,
        value: &mut body::Value,
    ) -> Result<(), JsTerminated> {
        // SAFETY: this is a Box-allocated task (see Blob.zig:1581).
        let this_ref = unsafe { &mut *this };
        // SAFETY: sole `&mut JSPromise` borrow in this scope; `get()` returns a
        // GC-owned cell, valid past `Box::from_raw(this)`.
        let promise: *mut JSPromise = unsafe { this_ref.promise.get() };
        // SAFETY: `global_this` was set from a live `&JSGlobalObject` when this
        // task was scheduled; the global outlives every `Body::Value` callback.
        let global_this = unsafe { &*this_ref.global_this };
        // PORT NOTE: Zig `var file_blob = this.file_blob;` is a non-owning
        // bitwise copy — both bindings alias the same `*Store` with no ref
        // bump, and `bun.destroy(this)` later frees raw memory without running
        // field destructors. In Rust `Box::from_raw(this)` *does* drop fields,
        // so leaving the `StoreRef` in `this.file_blob` would double-deref it.
        // Move ownership out instead; the `Locked` arm — the only path that
        // keeps `this` alive for a future callback — moves it back so the next
        // `then()` invocation sees an intact `file_blob`. This also avoids the
        // throwaway `content_type`/`name` clones that `Blob::dupe()` performs.
        let mut file_blob = core::mem::take(&mut this_ref.file_blob);
        match value {
            body::Value::Error(err_ref) => {
                let err = err_ref.to_js(global_this);
                file_blob.detach();
                let _ = value.use_();
                // SAFETY: consume Box allocation (drops `promise`/`file_blob` Strongs).
                unsafe { drop(Box::from_raw(this)) };
                // SAFETY: GC-owned cell; sole `&mut` borrow.
                unsafe { &mut *promise }.reject_with_async_stack(global_this, Ok(err))?;
            }
            body::Value::Used => {
                file_blob.detach();
                let _ = value.use_();
                // SAFETY: consume Box allocation.
                unsafe { drop(Box::from_raw(this)) };
                // SAFETY: GC-owned cell; sole `&mut` borrow.
                unsafe { &mut *promise }.reject(
                    global_this,
                    Ok(ZigString::init(b"Body was used after it was consumed")
                        .to_error_instance(global_this)),
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
                        mkdirp_if_not_exists: Some(this_ref.mkdirp_if_not_exists),
                        ..Default::default()
                    },
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        file_blob.detach();
                        // SAFETY: consume Box allocation.
                        unsafe { drop(Box::from_raw(this)) };
                        // SAFETY: GC-owned cell; sole `&mut` borrow.
                        unsafe { &mut *promise }.reject(global_this, Err(err))?;
                        return Ok(());
                    }
                };

                // PORT NOTE: Zig `defer bun.destroy(this); defer this.promise.deinit();
                // defer file_blob.detach();` — defers run in reverse order at scope
                // exit. Reclaim the Box now so it drops last; `file_blob` (a local
                // declared after) drops first.
                // SAFETY: `this` was Box-allocated (see Self::new). `this_ref` is dead
                // past this point — all further field access goes through `_this_box`.
                let _this_box = unsafe { Box::from_raw(this) };
                let _g = scopeguard::guard((), |()| file_blob.detach());

                if let Some(p) = new_promise.as_any_promise() {
                    match p.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                        // Fulfill the new promise using the pending promise
                        jsc::PromiseResult::Pending => {
                            // SAFETY: GC-owned cell; sole `&mut` borrow.
                            unsafe { &mut *promise }.resolve(global_this, new_promise)?
                        }
                        jsc::PromiseResult::Rejected(err) => {
                            // SAFETY: GC-owned cell; sole `&mut` borrow.
                            unsafe { &mut *promise }.reject(global_this, Ok(err))?
                        }
                        jsc::PromiseResult::Fulfilled(result) => {
                            // SAFETY: GC-owned cell; sole `&mut` borrow.
                            unsafe { &mut *promise }.resolve(global_this, result)?
                        }
                    }
                }
            }
            body::Value::Locked(locked) => {
                // Re-registering for a future callback — `this` stays alive.
                // Restore the moved-out blob so the next `then()` has its store.
                this_ref.file_blob = file_blob;
                locked.on_receive_value = Some(Self::then_wrap);
                locked.task = Some(this.cast::<c_void>());
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/blob/write_file.zig (757 lines)
//   confidence: medium
//   notes:      FileOpener/FileCloser modeled as traits (matching ReadFile);
//               WriteFileWindows is `#[cfg(windows)]`-gated since libuv types
//               are Windows-only in the Rust crate graph.
// ──────────────────────────────────────────────────────────────────────────
