use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, SystemError};
#[cfg(not(windows))]
use bun_ptr::RefPtr;
use bun_sys::{self as sys, Fd};

#[cfg(not(windows))]
use crate::webcore::blob::Store;
#[cfg(not(windows))]
use crate::webcore::blob::fd_job::{self, FdJob, FdOp, Interest, JobFd, Step};
use crate::webcore::blob::{self, Blob, SizeType};
use crate::webcore::body;

#[cfg(windows)]
bun_output::declare_scope!(WriteFile, hidden);

#[cfg(not(windows))]
pub(crate) struct WriteFile {
    destination: RefPtr<Store>,
    source: RefPtr<Store>,
    /// Of the bytes of `source`.
    range: core::ops::Range<usize>,
    written: usize,
    could_block: bool,
    mkdirp: bool,
}

#[cfg(not(windows))]
impl WriteFile {
    /// `source` is the store of `source_blob`. Returns the promise.
    pub(crate) fn start(
        destination: RefPtr<Store>,
        source: RefPtr<Store>,
        source_blob: &Blob,
        mkdirp: bool,
        cx: &bun_jsc::JsThread<'_>,
    ) -> JSValue {
        let start = (source_blob.offset.get() as usize).min(source.shared_view().len());
        let write = WriteFile {
            range: start..start + source_blob.shared_view().len(),
            written: 0,
            could_block: false,
            mkdirp,
            destination,
            source,
        };
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let value = promise.value();
        FdJob::schedule(write, (promise, bun_ptr::BackRef::new(cx.global())), cx);
        value
    }
}

#[cfg(not(windows))]
impl FdOp for WriteFile {
    const INTEREST: Interest = Interest::Writable;
    const IO_TAG: bun_io::Tag = bun_io::Tag::WriteFile;
    /// With the global that the promise was made in.
    type Js = (jsc::JSPromiseStrong, bun_ptr::BackRef<JSGlobalObject>);

    fn open(&mut self) -> Result<(JobFd, Step), Box<SystemError>> {
        let file = self.destination.data.as_file();
        let pathlike = &file.pathlike;
        let fd = fd_job::open(
            pathlike,
            sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
            self.mkdirp,
        )?;

        // Only what the store knows by now: fstat() is expensive, and a path is opened with O_NONBLOCK.
        self.could_block =
            pathlike.is_fd() && file.seekable.is_some() && !sys::is_regular_file(file.mode);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        if !self.could_block && self.range.len() > 1024 {
            let _ = sys::preallocate_file(fd.get().native(), 0, self.range.len() as i64);
        }
        let step = self.step(fd.get(), false)?;
        Ok((fd, step))
    }

    fn step(&mut self, fd: Fd, mut ready: bool) -> Result<Step, Box<SystemError>> {
        let bytes = &self.source.shared_view()[self.range.clone()];
        let mut eof = false;
        loop {
            // After the last write too: scripts count on room in the pipe when the promise resolves.
            if self.could_block
                && !core::mem::take(&mut ready)
                && bun_core::is_writable(fd) == bun_core::Pollable::NotReady
            {
                return Ok(Step::Wait);
            }
            if eof || self.written >= bytes.len() {
                return Ok(Step::Done);
            }
            // Not pwrite(): the destination may not be seekable.
            match sys::write(fd, &bytes[self.written..]) {
                Ok(wrote) => {
                    self.written += wrote;
                    eof = wrote == 0;
                }
                Err(err) if err.get_errno() != sys::E::EAGAIN => return Err(err.into()),
                Err(_) if self.could_block => return Ok(Step::Wait),
                // Spins: https://github.com/oven-sh/bun/pull/35953
                Err(_) => {}
            }
        }
    }

    fn then(
        self,
        result: Result<(), Box<SystemError>>,
        (mut promise, global_this): Self::Js,
    ) -> jsc::JsResult<()> {
        let result = result.map(|()| {
            note_written(&self.destination);
            self.written as SizeType
        });
        drop(self);
        settle(promise.swap(), &global_this, result)
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
pub(crate) use self::windows_impl::WriteFileWindows;

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use crate::dispatch::fold;
    use crate::server::file_response_stream::StreamFd;
    use bun_io::{IntrusiveUvFs as _, JsKeepAlive};
    // `bun_jsc::EventLoop` is a *module* (namespace re-export); the struct
    // lives one level deeper.
    use bun_jsc::event_loop::EventLoop;
    use bun_sys::ReturnCodeExt as _;
    use bun_sys::windows::libuv as uv;

    /// One owner at a time: a `Box` here, or libuv and the pool while they work for it.
    pub(crate) struct WriteFileWindows {
        pub(crate) io_request: uv::fs_t,
        pub(crate) file_blob: Blob,
        pub(crate) bytes_blob: Blob,
        pub(crate) promise: jsc::JSPromiseStrong,
        /// The global `promise` was made in.
        pub(crate) global_this: bun_ptr::BackRef<JSGlobalObject>,
        /// The context of the script that asked for the write.
        pub(crate) context: bun_jsc::ContextId,
        pub(crate) mkdirp_if_not_exists: bool,

        pub(crate) fd: StreamFd,
        pub(crate) err: Option<sys::Error>,
        pub(crate) total_written: usize,
        pub(crate) event_loop: &'static EventLoop,
        _keep_alive: JsKeepAlive,
    }

    bun_io::intrusive_uv_fs!(WriteFileWindows, io_request);

    impl crate::node::fs::async_::AsyncMkdirpTarget for WriteFileWindows {
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
            let mut write_file = Box::new(WriteFileWindows {
                file_blob,
                bytes_blob,
                promise,
                global_this: bun_ptr::BackRef::new(global_this),
                context: script_context.id(),
                mkdirp_if_not_exists: mkdirp,
                io_request: bun_core::ffi::zeroed::<uv::fs_t>(),
                event_loop,
                fd: StreamFd::borrowed(Fd::INVALID),
                err: None,
                total_written: 0,
                _keep_alive: JsKeepAlive::active(),
            });
            write_file.io_request.loop_ = event_loop.uv_loop();

            let store = write_file.file_blob.store.get().as_ref().unwrap();
            let PathOrFileDescriptor::Fd(fd) = &store.data.as_file().pathlike else {
                return write_file.open();
            };
            write_file.fd = StreamFd::borrowed(Fd::from_uv(fd.uv()));

            write_file.do_write_loop()
        }

        fn path(&self) -> &[u8] {
            let store = self.file_blob.store.get().as_ref().unwrap();
            store.data.as_file().pathlike.path().slice()
        }

        fn open(self: Box<Self>) -> jsc::JsResult<()> {
            let Ok(posix_path) = sys::to_posix_path(self.path()) else {
                return self.throw(sys::Error {
                    errno: sys::E::NAMETOOLONG as _,
                    syscall: sys::Tag::open,
                    ..Default::default()
                });
            };
            let loop_ = self.event_loop.uv_loop();
            let this = bun_core::heap::into_raw(self);
            // SAFETY: the VM's loop outlives the request, libuv copies the NUL-terminated path
            // before it returns, and it has `this` until `on_open`.
            let rc = unsafe {
                uv::uv_fs_open(
                    loop_,
                    &raw mut (*this).io_request,
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

            if let Some(err) = rc.to_error(sys::Tag::open) {
                debug_assert!(err.get_errno() != sys::E::NOENT);
                // SAFETY: libuv keeps nothing of a request that it refuses.
                return unsafe { bun_core::heap::take(this) }.throw(err);
            }
            Ok(())
        }

        extern "C" fn on_open(req: *mut uv::fs_t) {
            // SAFETY: `req` is the `io_request` of the box that `open` left to libuv.
            let mut this = unsafe { WriteFileWindows::take_from_uv_fs(req) };
            let rc = this.io_request.result;
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
                    this.mkdirp();
                    return;
                }

                fold(this.throw(sys::Error::from_code(err, sys::Tag::open)));
                return;
            }

            this.fd = sys::File::from_fd(Fd::from_uv(rc.to_fd())).into();

            fold(this.do_write_loop());
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

        extern "C" fn on_write_complete(req: *mut uv::fs_t) {
            // SAFETY: `req` is the `io_request` of the box that `do_write_loop` left to libuv.
            let mut this = unsafe { WriteFileWindows::take_from_uv_fs(req) };
            let rc = this.io_request.result;
            if let Some(err) = rc.to_error(sys::Tag::write) {
                fold(this.throw(err));
                return;
            }

            this.total_written += usize::try_from(rc.int()).expect("int cast");
            fold(this.do_write_loop());
        }

        fn on_finish(mut self: Box<Self>) -> jsc::JsResult<()> {
            let _exit = self.event_loop.enter_scope();

            let (mut promise, global_this) = (self.promise.take(), self.global_this);
            let _context =
                bun_jsc::virtual_machine::VirtualMachine::get().enter_context(self.context);

            let result = if let Some(err) = self.to_system_error() {
                Err(Box::new(err))
            } else {
                if let Some(store) = self.file_blob.store() {
                    note_written(store);
                }
                Ok(self.total_written as SizeType)
            };
            drop(self);

            settle(promise.swap(), &global_this, result)
        }

        fn throw(mut self: Box<Self>, err: sys::Error) -> jsc::JsResult<()> {
            debug_assert!(self.err.is_none());
            self.err = Some(err);
            self.on_finish()
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

        fn do_write_loop(mut self: Box<Self>) -> jsc::JsResult<()> {
            let remain_full = self.bytes_blob.shared_view();
            let off = self.total_written.min(remain_full.len());
            let remain = &remain_full[off..];

            if remain.is_empty() {
                return self.on_finish();
            }

            let buf = uv::uv_buf_t {
                base: remain.as_ptr().cast_mut(),
                len: remain.len() as u32,
            };
            self.io_request.deinit();

            let (loop_, fd) = (self.event_loop.uv_loop(), self.fd.get().uv());
            let this = bun_core::heap::into_raw(self);
            // SAFETY: the VM's loop outlives the request, libuv copies `buf` before it returns, and
            // it has `this`, whose blob keeps the bytes, until `on_write_complete`.
            let rc = unsafe {
                uv::uv_fs_write(
                    loop_,
                    &raw mut (*this).io_request,
                    fd,
                    &raw const buf,
                    1,
                    -1,
                    Some(Self::on_write_complete),
                )
            };
            if rc.int() == 0 {
                // EINPROGRESS
                return Ok(());
            }

            let Some(err) = rc.to_error(sys::Tag::write) else {
                bun_core::Output::panic(format_args!(
                    "unexpected return code from uv_fs_write: {}",
                    rc.int()
                ));
            };
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.throw(err)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// Reports a finished write to its promise.
fn settle(
    promise: &mut JSPromise,
    global_this: &JSGlobalObject,
    count: Result<SizeType, Box<SystemError>>,
) -> jsc::JsResult<()> {
    let value = promise.to_js();
    value.ensure_still_alive();
    match count {
        Err(err) => {
            let err_js = err.to_error_instance_with_async_stack(global_this, promise);
            promise.reject(global_this, Ok(err_js))?;
        }
        Ok(wrote) => {
            promise.resolve(global_this, JSValue::js_number_from_uint64(wrote as u64))?;
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────

fn note_written(destination: &blob::Store) {
    if let blob::store::Data::File(file) = &destination.data
        && let PathOrFileDescriptor::Path(path) = &file.pathlike
    {
        crate::node::fs::note_opened_for_write(path.slice(), true);
    }
}

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
        let global_ref = this.global_this;
        let global_this = global_ref.get();
        let context = global_this.bun_vm().context_of(this.context);
        match value {
            body::Value::Error(err_ref) => {
                let err = err_ref.to_js(global_this);
                let _ = value.use_();
                this.promise
                    .get()
                    .reject_with_async_stack(global_this, Ok(err))?;
            }
            body::Value::Used => {
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
                    &global_this.js_thread(context),
                    &mut blob,
                    &mut this.file_blob,
                    &blob::WriteFileOptions {
                        mkdirp_if_not_exists: Some(this.mkdirp_if_not_exists),
                        ..Default::default()
                    },
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        this.promise.get().reject(global_this, Err(err))?;
                        return Ok(());
                    }
                };

                if let Some(p) = new_promise.as_any_promise() {
                    let promise = this.promise.get();
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
                locked.on_receive_value = Some(Self::then_wrap);
                locked.task = Some(bun_core::heap::into_raw_nn(this).cast::<c_void>());
            }
        }
        Ok(())
    }
}
