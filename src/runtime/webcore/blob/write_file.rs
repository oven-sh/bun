use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::AtomicU8;
#[cfg(not(windows))]
use core::sync::atomic::Ordering;

use bun_core::Error;
use bun_core::ZigString;
use bun_io::{self as io, IntrusiveIoRequest as _};
use bun_jsc::ZigStringJsc as _;
use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, JsTerminated, SystemError};
use bun_sys::{self as sys, Fd};
use bun_threading::{IntrusiveWorkTask as _, WorkPool, WorkPoolTask};

use crate::webcore::blob::{self, Blob, ClosingState, MkdirpTarget, SizeType};
use crate::webcore::body;
#[cfg(not(windows))]
use crate::webcore::blob::{FileCloser, FileOpener, Retry, mkdir_if_not_exists};

bun_output::declare_scope!(WriteFile, hidden);

// A tagged result-or-error union. Modeled
// as a plain Rust enum: it only ever travels through the Rust fn-pointer
// callbacks below (`WriteFileOnWriteFileCallback`), never across FFI, so the
// layout is unconstrained.
pub enum WriteFileResultType {
    Result(SizeType),
    Err(Box<SystemError>),
}

pub type WriteFileOnWriteFileCallback =
    fn(ctx: *mut c_void, count: WriteFileResultType) -> Result<(), JsTerminated>;

pub type WriteFileTask = bun_jsc::work_task::WorkTask<WriteFile>;

// `WorkTaskContext` fixes `run`/`then` to take `*mut Self`; the trait method
// cannot be marked `unsafe fn` and the parameter type cannot change, so the
// lint is unsatisfiable here. The pointers come from the work-pool hand-off
// and are guaranteed live (see SAFETY notes below).
#[allow(clippy::not_unsafe_ptr_arg_deref)]
impl bun_jsc::work_task::WorkTaskContext for WriteFile {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WriteFileTask;
    fn run(this: *mut Self, task: *mut bun_jsc::work_task::WorkTask<Self>) {
        // SAFETY: WorkTask::run_from_thread_pool guarantees `this` is live.
        unsafe { (*this).run(task) }
    }
    fn then(this: *mut Self, global: &jsc::JSGlobalObject) -> Result<(), JsTerminated> {
        // SAFETY: `this` was heap-allocated by the WorkTask flow; consumed here.
        WriteFile::then(unsafe { bun_core::heap::take(this) }, global)
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
    pub state: AtomicU8, // ClosingState

    pub on_complete_ctx: *mut c_void,
    pub on_complete_callback: WriteFileOnWriteFileCallback,
    pub total_written: usize,

    pub could_block: bool,
    pub close_after_io: bool,
    pub mkdirp_if_not_exists: bool,
}

bun_threading::intrusive_work_task!(WriteFile, task);
bun_io::intrusive_io_request!(WriteFile, io_request);

// ──────────────────────────────────────────────────────────────────────────
// FileOpener / FileCloser
// ──────────────────────────────────────────────────────────────────────────

// POSIX-only: the Windows path (`WriteFileWindows`) opens/closes synchronously
// on the work pool and never goes through these traits.
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
    fn pathlike(&self) -> &PathOrFileDescriptor {
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

#[cfg(not(windows))]
impl FileCloser for WriteFile {
    const IO_TAG: io::Tag = io::Tag::WriteFile;
    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn close_after_io(&self) -> bool {
        self.close_after_io
    }
    fn set_close_after_io(&mut self, v: bool) {
        self.close_after_io = v;
    }
    fn state(&self) -> &AtomicU8 {
        &self.state
    }
    fn io_request(&mut self) -> Option<&mut io::Request> {
        Some(&mut self.io_request)
    }
    fn io_poll(&mut self) -> &mut io::Poll {
        &mut self.io_poll
    }
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask {
        &mut self.task
    }
    fn update(&mut self) {
        WriteFile::update(self)
    }

    fn schedule_close(request: &mut io::Request) -> io::Action<'_> {
        // SAFETY: request is &mut self.io_request (intrusive); recover parent.
        let this = unsafe { &mut *WriteFile::from_io_request(std::ptr::from_mut(request)) };
        fn on_done(ctx: *mut ()) {
            // SAFETY: ctx is `self as *mut WriteFile` set below.
            let this = unsafe { bun_ptr::callback_ctx::<WriteFile>(ctx.cast()) };
            <WriteFile as FileCloser>::on_io_request_closed(this);
        }
        // reshaped for borrowck — compute the parent raw pointer
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

    // `FileCloser` fixes `on_close_io_request` to take `*mut WorkPoolTask`;
    // the trait method cannot be marked `unsafe fn`, so the lint is
    // unsatisfiable here. The pointer is the intrusive `&mut self.task` set
    // in `on_io_request_closed` and is guaranteed live.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    fn on_close_io_request(task: *mut bun_jsc::WorkPoolTask) {
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
        // `&mut self.task` (intrusive) registered in `on_io_request_closed`;
        // recover parent.
        let this = unsafe { &mut *WriteFile::from_task_ptr(task) };
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
        let this = unsafe { &mut *WriteFile::from_io_request(std::ptr::from_mut(request)) };
        this.on_ready();
    }

    pub fn on_ready(&mut self) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onReady()");
        self.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_write_loop_task,
        };
        WorkPool::schedule(&raw mut self.task);
    }

    pub fn on_io_error(this: *mut (), err: &sys::Error) {
        bun_output::scoped_log!(WriteFile, "WriteFile.onIOError()");
        // SAFETY: ctx was set to `self as *mut WriteFile` in `on_request_writable`.
        let this = unsafe { bun_ptr::callback_ctx::<WriteFile>(this.cast()) };
        this.errno = Some(bun_core::errno_to_zig_err(err.errno as i32));
        this.system_error = Some(err.to_system_error().into());
        this.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_write_loop_task,
        };
        WorkPool::schedule(&raw mut this.task);
    }

    pub fn on_request_writable(request: &mut io::Request) -> io::Action<'_> {
        bun_output::scoped_log!(WriteFile, "WriteFile.onRequestWritable()");
        request.scheduled = false;
        // SAFETY: request points to WriteFile.io_request (intrusive); recover parent.
        let this = unsafe { &mut *WriteFile::from_io_request(std::ptr::from_mut(request)) };
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
        self.io_request
            .store_callback_seq_cst(Self::on_request_writable);
        if !self.io_request.scheduled {
            io::IoRequestLoop::schedule(&mut self.io_request);
        }
    }

    pub fn create_with_ctx(
        file_blob: Blob,
        bytes_blob: Blob,
        on_write_file_context: *mut c_void,
        on_complete_callback: WriteFileOnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) -> Result<*mut WriteFile, Error> {
        let write_file = bun_core::heap::into_raw(Box::new(WriteFile {
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
            state: AtomicU8::new(ClosingState::Running as u8),
            on_complete_ctx: on_write_file_context,
            on_complete_callback,
            total_written: 0,
            could_block: false,
            close_after_io: false,
            mkdirp_if_not_exists,
        }));
        // No explicit store ref bump: the caller passes a `+1` Blob (via
        // `borrowed_view()`'s `StoreRef::clone`) and `heap::take(this)` in
        // `then` runs `StoreRef::drop`, so the ref/deref pair is
        // folded into RAII.
        Ok(write_file)
    }

    pub fn create<C>(
        file_blob: Blob,
        bytes_blob: Blob,
        context: *mut C,
        callback: WriteFileOnWriteFileCallback,
        mkdirp_if_not_exists: bool,
    ) -> Result<*mut WriteFile, Error> {
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

    pub fn then(mut this: Box<WriteFile>, _global: &JSGlobalObject) -> Result<(), JsTerminated> {
        let cb = this.on_complete_callback;
        let cb_ctx = this.on_complete_ctx;
        let system_error = this.system_error.take();
        let total_written = this.total_written;
        // Cleanup is RAII: dropping the `Box` runs `WriteFile`'s field-drop
        // glue, which drops `bytes_blob.store`/`file_blob.store: Option<
        // StoreRef>` → `Store::deref()` — exactly one deref each.
        // (An earlier explicit `detach()` here was a no-op; the
        // bun-write-leak.test.ts failure was the ASAN debug build's ~320 MB
        // baseline RSS exceeding the fixture's 256 MB absolute threshold,
        // not an unbalanced ref.)
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

    pub fn run(&mut self, task: *mut WriteFileTask) {
        #[cfg(windows)]
        {
            let _ = task;
            unreachable!("WriteFile is POSIX-only; see WriteFileWindows");
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

    pub fn is_allowed_to_close(&self) -> bool {
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
                // SAFETY: io_task is a backref set in run(); WorkTask owns lifetime.
                bun_jsc::work_task::WorkTask::on_finish(unsafe { &mut *io_task });
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
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
        // `&mut self.task` (intrusive) registered in `on_writable`/`init`;
        // recover parent.
        let this = unsafe { &mut *WriteFile::from_task_ptr(task) };
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
            unreachable!("WriteFile is POSIX-only; see WriteFileWindows");
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
// Windows write path used by `Blob.writeFileInternal`: one WorkPool task that
// performs the whole blocking sequence (open → write loop → close) with
// `bun_sys` syscalls, then completes back to the JS thread via the event
// loop's concurrent task queue — the same execution model as the POSIX
// `WriteFile` and node_fs's `AsyncFSTask`.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub use self::windows_impl::{WriteFileWindows, WriteFileWindowsError};

#[cfg(windows)]
mod windows_impl {
    use super::*;

    use bun_io::KeepAlive;
    // `bun_jsc::EventLoop`/`ManagedTask` are *modules* (namespace
    // re-exports); the structs live one level deeper.
    use bun_jsc::{ConcurrentTask, ManagedTask::ManagedTask, event_loop::EventLoop};
    

    pub struct WriteFileWindows {
        pub file_blob: Blob,
        pub bytes_blob: Blob,
        pub on_complete_callback: WriteFileOnWriteFileCallback,
        pub on_complete_ctx: *mut c_void,
        pub mkdirp_if_not_exists: bool,

        pub fd: Fd,
        pub owned_fd: bool,
        pub err: Option<sys::Error>,
        pub total_written: usize,
        /// BACKREF — the VM-owned `EventLoop` outlives every in-flight write;
        /// the op additionally pins the VM via `poll_ref` until `deinit`.
        pub event_loop: bun_ptr::BackRef<EventLoop>,
        pub poll_ref: KeepAlive,
        pub task: WorkPoolTask,
    }

    bun_threading::intrusive_work_task!(WriteFileWindows, task);

    const OPEN_FLAGS: i32 = bun_sys::O::WRONLY
        | bun_sys::O::CREAT
        | bun_sys::O::TRUNC
        | bun_sys::O::NONBLOCK
        | bun_sys::O::NOCTTY;

    #[derive(thiserror::Error, Debug)]
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
// `event_loop` is the VM-owned per-thread singleton (see the SAFETY
// comments below); the raw-pointer parameter is the bindings ABI.
#[allow(clippy::not_unsafe_ptr_arg_deref)]
        pub fn create_with_ctx(
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
            // SAFETY: `event_loop` is the per-thread `EventLoop` singleton
            // owned by the VM; it strictly outlives this async op.
            let event_loop_ref = bun_ptr::BackRef::new(unsafe { &*event_loop });
            // Resolve the fd-backed variant up front (on the JS thread — the
            // rare-data stdio comparison must not race the VM).
            let fd = 'brk: {
                let pathlike = &file_blob
                    .store
                    .get()
                    .as_ref()
                    .unwrap()
                    .data
                    .as_file()
                    .pathlike;
                let PathOrFileDescriptor::Fd(fd) = pathlike else {
                    break 'brk Fd::INVALID;
                };
                // `EventLoop.virtual_machine` is `Option<NonNull<VirtualMachine>>`;
                // `RareData::std{out,err,in}_store` is type-erased
                // `Option<NonNull<c_void>>` — compare on raw pointer identity.
                // SAFETY: VM-owned EventLoop/VirtualMachine live for the
                // process lifetime; read-only access on the JS thread.
                unsafe {
                    if let Some(vm) = (*event_loop).virtual_machine {
                        if let Some(rare) = (*vm.as_ptr()).rare_data.as_ref() {
                            let store_ptr = file_blob
                                .store
                                .get()
                                .as_ref()
                                .unwrap()
                                .as_ptr()
                                .cast::<c_void>();
                            if rare.stdout_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                                break 'brk Fd::stdout();
                            } else if rare.stderr_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                                break 'brk Fd::stderr();
                            } else if rare.stdin_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                                break 'brk Fd::stdin();
                            }
                        }
                    }
                }

                // The file stored descriptor is not stdin, stdout, or stderr.
                *fd
            };
            // No explicit store ref bumps — the caller passes `+1` Blobs via
            // `borrowed_view()` and `deinit` releases them via
            // `heap::take → StoreRef::drop`.
            let write_file = Self::new(WriteFileWindows {
                file_blob,
                bytes_blob,
                on_complete_ctx: on_write_file_context,
                on_complete_callback,
                mkdirp_if_not_exists: mkdirp,
                event_loop: event_loop_ref,
                fd,
                owned_fd: false,
                err: None,
                total_written: 0,
                poll_ref: KeepAlive::default(),
                task: WorkPoolTask {
                    node: Default::default(),
                    callback: Self::run_from_work_pool,
                },
            });
            // SAFETY: just allocated, sole owner until the work pool takes
            // over; the VM pointer is live (see BackRef note above).
            unsafe {
                (*write_file)
                    .poll_ref
                    .ref_(jsc::VirtualMachineRef::event_loop_ctx(
                        (*event_loop).virtual_machine.unwrap().as_ptr(),
                    ));
                WorkPool::schedule(&raw mut (*write_file).task);
            }
            Ok(write_file)
        }

        fn run_from_work_pool(task: *mut WorkPoolTask) {
            // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
            // `&mut self.task` (intrusive) registered in `create_with_ctx`;
            // recover parent.
            let this = unsafe { &mut *WriteFileWindows::from_task_ptr(task) };
            this.run_on_pool();

            fn complete_task(this: *mut WriteFileWindows) -> bun_event_loop::JsResult<()> {
                // SAFETY: the JS thread is the sole accessor now; consumed by
                // `run_from_js_thread` on every path.
                match unsafe { WriteFileWindows::run_from_js_thread(this) } {
                    WriteFileWindowsError::JSTerminated => Err(JsTerminated::JSTerminated.into()),
                    WriteFileWindowsError::WriteFileWindowsDeinitialized => Ok(()),
                }
            }
            let event_loop = this.event_loop;
            event_loop.enqueue_task_concurrent(ConcurrentTask::create(ManagedTask::new::<
                WriteFileWindows,
            >(
                this, complete_task
            )));
        }

        /// The blocking open → write loop → close sequence, on the pool.
        fn run_on_pool(&mut self) {
            if self.fd == Fd::INVALID {
                self.open_on_pool();
            }
            if self.err.is_none() && self.fd != Fd::INVALID {
                self.do_write_loop_on_pool();
            }
            if self.owned_fd && self.fd != Fd::INVALID {
                let _ = bun_sys::close(self.fd);
                self.fd = Fd::INVALID;
            }
        }

        /// Open the destination path, with the mkdirp-and-retry-once dance the
        /// async path used to do (`mkdir -p dirname` on ENOENT, then one
        /// retry). Records the failure in `self.err`.
        fn open_on_pool(&mut self) {
            let path_string = match &self
                .file_blob
                .store
                .get()
                .as_ref()
                .unwrap()
                .data
                .as_file()
                .pathlike
            {
                PathOrFileDescriptor::Path(p) => p.clone(),
                PathOrFileDescriptor::Fd(_) => unreachable!(),
            };
            let mut buf = bun_paths::path_buffer_pool::get();
            let s = path_string.slice();
            buf.0[..s.len()].copy_from_slice(s);
            buf.0[s.len()] = 0;
            let path = bun_core::ZStr::from_buf(&buf.0[..], s.len());
            loop {
                match bun_sys::open(path, OPEN_FLAGS, 0o644) {
                    Ok(fd) => {
                        bun_output::scoped_log!(
                            WriteFile,
                            "open({}) = {:?}",
                            bstr::BStr::new(path_string.slice()),
                            fd
                        );
                        self.fd = fd;
                        self.owned_fd = true;
                        return;
                    }
                    Err(err) => {
                        if err.get_errno() == sys::E::NOENT && self.mkdirp_if_not_exists {
                            self.mkdirp_if_not_exists = false;
                            bun_output::scoped_log!(WriteFile, "mkdirp");
                            let path_slice = path_string.slice();
                            let dirname = bun_core::dirname(path_slice)
                                // this shouldn't happen
                                .unwrap_or(path_slice);
                            let mut node_fs = crate::node::fs::NodeFS::default();
                            match node_fs.mkdir_recursive(&crate::node::fs::args::Mkdir {
                                path: crate::node::PathLike::String(
                                    bun_ptr::cow_slice::CowSlice::init_unchecked(dirname, false),
                                ),
                                recursive: true,
                                ..Default::default()
                            }) {
                                Ok(_) => {
                                    bun_output::scoped_log!(WriteFile, "mkdirp complete");
                                    continue;
                                }
                                Err(mkdir_err) => {
                                    self.err = Some(mkdir_err);
                                    return;
                                }
                            }
                        }

                        // `to_system_error()` attaches the destination
                        // path/fd at completion.
                        self.err = Some(err);
                        return;
                    }
                }
            }
        }

        fn do_write_loop_on_pool(&mut self) {
            loop {
                let total_len = self.bytes_blob.shared_view().len();
                let off = self.total_written.min(total_len);
                if off >= total_len {
                    return;
                }

                // We do not use pwrite() because the file may not be seekable
                // (such as stdout).
                let result = sys::write(self.fd, &self.bytes_blob.shared_view()[off..]);
                match result {
                    Ok(0) => return, // we are done, we received EOF
                    Ok(wrote) => self.total_written += wrote,
                    Err(err) => {
                        self.err = Some(err);
                        return;
                    }
                }
            }
        }

        /// JS-thread completion: deliver the result and release everything.
        ///
        /// # Safety
        /// `this` must point to a live `WriteFileWindows` allocated via
        /// [`Self::new`]. On return, `*this` has been freed and must not be
        /// accessed again.
        pub unsafe fn run_from_js_thread(this: *mut Self) -> WriteFileWindowsError {
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

        pub fn to_system_error(&self) -> Option<SystemError> {
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

        pub fn new(init: WriteFileWindows) -> *mut WriteFileWindows {
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
        pub unsafe fn deinit(this: *mut Self) {
            // Path-opened fds are closed on the pool after the write loop;
            // nothing fd-related is left to release here.
            // SAFETY: caller contract — `this` is live.
            unsafe {
                // The store derefs happen via `StoreRef::drop` when the Box is
                // reclaimed below (paired with the RAII note in `create_with_ctx`).
                (*this).poll_ref.disable();
                // `this` was allocated via Self::new (heap::into_raw); reclaim and drop here.
                drop(bun_core::heap::take(this));
            }
        }

        pub fn create<C>(
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
    pub promise: jsc::JSPromiseStrong,
    pub global_this: *const JSGlobalObject,
}

impl WriteFilePromise {
    pub fn run(handler: *mut c_void, count: WriteFileResultType) -> Result<(), JsTerminated> {
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
    /// JSC_BORROW: process-lifetime global; `BackRef` so the deref is safe and
    /// (being `Copy`) detaches from `&self` for use across `&mut self` and
    /// past `heap::take(this)`.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub promise: jsc::JSPromiseStrong,
    pub mkdirp_if_not_exists: bool,
}

impl WriteFileWaitFromLockedValueTask {
    pub fn then_wrap(this: *mut c_void, value: &mut body::Value) {
        // SAFETY: `this` is the Box-allocated task registered as `locked.task` below.
        let _ = Self::then(
            NonNull::new(this.cast::<WriteFileWaitFromLockedValueTask>()).unwrap(),
            value,
        );
        // TODO: properly propagate exception upwards
    }

    /// # Safety
    /// `this` must point to a live Box-allocated `WriteFileWaitFromLockedValueTask`.
    /// On every arm except `body::Value::Locked`, the allocation is consumed.
    pub fn then(
        this: NonNull<WriteFileWaitFromLockedValueTask>,
        value: &mut body::Value,
    ) -> Result<(), JsTerminated> {
        let this = this.as_ptr();
        // SAFETY: this is the Box-allocated task created in Blob.rs
        // (`heap::into_raw(Box::new(WriteFileWaitFromLockedValueTask { .. }))`).
        let this_ref = unsafe { &mut *this };
        // `get()` returns a GC-owned cell, valid past `heap::take(this)`.
        let promise: &mut JSPromise = &mut *this_ref.promise.get();
        // Copy the `BackRef` out so the borrow is detached from `this_ref`
        // (must coexist with `&mut this_ref` and survive `heap::take(this)`).
        let global_ref = this_ref.global_this;
        let global_this = global_ref.get();
        // `heap::take(this)` drops fields,
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
                unsafe { drop(bun_core::heap::take(this)) };
                promise.reject_with_async_stack(global_this, Ok(err))?;
            }
            body::Value::Used => {
                file_blob.detach();
                let _ = value.use_();
                // SAFETY: consume Box allocation.
                unsafe { drop(bun_core::heap::take(this)) };
                promise.reject(
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
                        unsafe { drop(bun_core::heap::take(this)) };
                        promise.reject(global_this, Err(err))?;
                        return Ok(());
                    }
                };

                // Reclaim the Box now so it drops last; `file_blob` (a local
                // declared after) drops first.
                // SAFETY: `this` was Box-allocated (see Self::new). `this_ref` is dead
                // past this point — all further field access goes through `_this_box`.
                let _this_box = unsafe { bun_core::heap::take(this) };
                let _g = scopeguard::guard((), |()| file_blob.detach());

                if let Some(p) = new_promise.as_any_promise() {
                    match p.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                        // Fulfill the new promise using the pending promise
                        jsc::PromiseResult::Pending => promise.resolve(global_this, new_promise)?,
                        jsc::PromiseResult::Rejected(err) => {
                            promise.reject(global_this, Ok(err))?
                        }
                        jsc::PromiseResult::Fulfilled(result) => {
                            promise.resolve(global_this, result)?
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
