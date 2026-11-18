use core::marker::PhantomData;
#[cfg(not(windows))]
use core::mem::MaybeUninit;
#[cfg(not(windows))]
use core::sync::atomic::{AtomicU8, Ordering};

use scopeguard::ScopeGuard;

#[cfg(not(windows))]
use crate::Error;
#[cfg(windows)]
use crate::io_order::{Key, Turn};
use crate::webcore::blob::store::{Data, File as FileStore};
use crate::webcore::blob::{Blob, SizeType, Store};
#[cfg(not(windows))]
use crate::webcore::blob::{ClosingState, FileCloser, FileOpener, MAX_SIZE};
#[cfg(windows)]
use crate::webcore::blob::{
    blocking::{Blocking, BlockingPart},
    job_file::{JobFile, Target, bare, is_device},
};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_core::String as BunString;
use bun_core::vec::append_with;
#[cfg(not(windows))]
use bun_core::vec::{BorrowedBuf, BorrowedCursor};
#[cfg(not(windows))]
use bun_io::{self as io, FileAction};
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, SystemError,
};
use bun_ptr::RefPtr;
#[cfg(not(windows))]
use bun_sys::Fd;
use bun_sys::Stat;
#[cfg(not(windows))]
use bun_threading::{IntrusiveWorkTask as _, WorkPool, WorkPoolTask};

#[cfg(not(windows))]
bun_output::declare_scope!(WriteFile, hidden);

#[cfg(not(windows))]
macro_rules! bloblog {
    ($($t:tt)*) => { bun_output::scoped_log!(WriteFile, $($t)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// NewReadFileHandler
// ──────────────────────────────────────────────────────────────────────────

/// `F` provides the callback that converts the read bytes to a JSValue.
/// Modelled as a trait so each instantiation monomorphizes.
pub(crate) trait ReadFileToJs {
    fn from_owned(b: &Blob, g: &JSGlobalObject, by: Box<[u8]>) -> JsResult<JSValue>;
    /// SAFETY: `by` is a view of the store backing `b`.
    unsafe fn from_store(b: &Blob, g: &JSGlobalObject, by: *mut [u8]) -> JsResult<JSValue>;
}

pub(crate) struct NewReadFileHandler<F: ReadFileToJs> {
    pub(crate) context: Blob,
    pub(crate) promise: JSPromiseStrong,
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    _f: PhantomData<F>,
}

impl<F: ReadFileToJs> NewReadFileHandler<F> {
    pub(crate) fn new(context: Blob, global_this: &JSGlobalObject) -> Self {
        Self {
            context,
            promise: JSPromiseStrong::default(),
            global_this: bun_ptr::BackRef::new(global_this),
            _f: PhantomData,
        }
    }
}

/// A receiver for a file read's bytes. See [`PendingReadFileCompletion`].
pub(crate) trait ReadFileCompletion {
    fn run(self: Box<Self>, bytes: ReadFileResultType) -> JsResult<()>;
    /// The read will never complete (its VM stopped before it did). Exactly one of the two is called.
    fn cancel(self: Box<Self>) {}
}

impl<F: ReadFileToJs> ReadFileCompletion for NewReadFileHandler<F> {
    fn run(self: Box<Self>, maybe_bytes: ReadFileResultType) -> JsResult<()> {
        // The braces move the box: it is freed at the end of the `let`.
        let Self {
            context: blob,
            mut promise,
            global_this,
            ..
        } = *{ self };
        let global_this = global_this.get();
        let promise = promise.swap();
        match maybe_bytes {
            ReadFileResultType::Result(result) => {
                let bytes = result.buf;
                if blob.size.get() > 0 {
                    blob.size
                        .set((bytes.len() as SizeType).min(blob.size.get()));
                }
                // The `#[track_caller]` `to_js_host_call` inside `AnyPromise::wrap`
                // provides the source-location/exception-scope behaviour.
                AnyPromise::Normal(promise)
                    .wrap(global_this, move |g| F::from_owned(&blob, g, bytes))?;
            }
            ReadFileResultType::Err(err) => {
                let val = err.to_error_instance_with_async_stack(global_this, promise);
                promise.reject(global_this, Ok(val))?;
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Type aliases / result types
// ──────────────────────────────────────────────────────────────────────────

/// What a `ReadFile` does with the bytes (or the lack of them): `run` on completion,
/// `cancel` if it is dropped before completing. Exactly one of the two is invoked, once, on the JS
/// thread — it typically owns a promise and a Blob, so this is the job's JS side.
pub(crate) struct PendingReadFileCompletion(
    ScopeGuard<Box<dyn ReadFileCompletion>, fn(Box<dyn ReadFileCompletion>)>,
);

impl PendingReadFileCompletion {
    fn new(completion: Box<dyn ReadFileCompletion>) -> Self {
        Self(scopeguard::guard(completion, ReadFileCompletion::cancel))
    }

    fn complete(self, bytes: ReadFileResultType) -> JsResult<()> {
        ScopeGuard::into_inner(self.0).run(bytes)
    }
}

// SAFETY: it holds JS-thread state (promise, Blob); it is only ever completed or cancelled on
// the JS thread, as a Job's `Js` side.
unsafe impl bun_jsc::job::JsAffine for PendingReadFileCompletion {}

pub(crate) struct ReadFileRead {
    pub(crate) buf: Box<[u8]>,
}

/// Result-or-error union for a completed read.
// Constructed/matched in Blob.rs and Body.rs;
// boxing the Err arm would change the cross-file callback ABI for no real win.
#[allow(clippy::large_enum_variant)]
pub(crate) enum ReadFileResultType {
    Result(ReadFileRead),
    Err(SystemError),
}

/// The completion token a `ReadFile` keeps across its async I/O.
pub(crate) type ReadFileTask = bun_jsc::Completion<ReadFile>;

// SAFETY: file store / byte store / blob store ref (atomic), the read buffer and io-loop
// registration state — nothing thread-affine. What the bytes are delivered to lives in the job's
// JS side (`PendingReadFileCompletion`), never here.
unsafe impl Send for ReadFile {}

impl bun_jsc::JobContext for ReadFile {
    const CANCELLABLE: bool = true;
    const IS_FILE_IO: bool = true;
    type OffThread = Self;
    /// Where the bytes go: completed by `then`, or cancelled (its `Drop`) when the job comes
    /// back to a VM that is no longer running script and is released unrun.
    type Js = PendingReadFileCompletion;
    #[cfg(not(windows))]
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // Starts the read; finishes from the io loop via the token.
        this.run(done);
        None
    }
    #[cfg(windows)]
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.run(done)
    }
    fn then(
        this: Self,
        completion: PendingReadFileCompletion,
        cx: &bun_jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        ReadFile::then(this, completion, cx.global())
    }
    /// A read parked on a pipe/tty that never becomes readable is the one
    /// state this job can be stuck in; end that wait (the read fails with
    /// ECANCELED through the usual close path).
    #[cfg(not(windows))]
    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract; `io_parking` is atomic, and a `true` means no
        // other thread touches `io_request` until it is queued again here.
        unsafe {
            if (*this).io_parking.cancel() {
                io::IoRequestLoop::schedule(&mut (*this).io_request);
            }
        }
    }
    #[cfg(windows)]
    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. Nothing writes to the field.
        unsafe { &(*this).blocking_part }.cancel();
    }
}

impl ReadFile {
    /// JS thread: hand a prepared `ReadFile` and what to do with its bytes to the work pool (the
    /// job is its one heap allocation).
    pub(crate) fn schedule(
        this: ReadFile,
        completion: Box<dyn ReadFileCompletion>,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        let completion = PendingReadFileCompletion::new(completion);
        #[cfg(windows)]
        if let PathOrFileDescriptor::Fd(fd) = this.file_store.pathlike {
            let can_block = is_device(&this.file_store.pathlike);
            let key = if can_block {
                Key::device_input
            } else {
                Key::descriptor
            };
            return Turn::after_earlier(cx, key(fd), false, |turn| {
                let this = ReadFile {
                    turn: Some(turn),
                    ..this
                };
                bun_jsc::Job::<ReadFile>::create(cx, this, completion).for_device_if(can_block)
            });
        }
        bun_jsc::Job::<ReadFile>::schedule(cx, this, completion);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct ReadFile {
    pub(crate) file_store: FileStore,
    #[cfg(windows)]
    target: Target,
    #[cfg(windows)]
    turn: Option<Turn>,
    pub(crate) store: Option<RefPtr<Store>>,
    pub offset: SizeType,
    pub(crate) max_length: SizeType,
    #[cfg(not(windows))]
    pub(crate) total_size: SizeType,
    #[cfg(not(windows))]
    pub(crate) opened_fd: Fd,
    #[cfg(not(windows))]
    pub(crate) read_eof: bool,
    #[cfg(not(windows))]
    pub(crate) size: SizeType,
    pub(crate) buffer: Vec<u8>,
    #[cfg(not(windows))]
    pub task: WorkPoolTask,
    pub(crate) system_error: Option<SystemError>,
    #[cfg(not(windows))]
    pub(crate) errno: Option<Error>,
    #[cfg(not(windows))]
    pub(crate) io_task: Option<ReadFileTask>,
    #[cfg(not(windows))]
    pub(crate) io_poll: io::Poll,
    #[cfg(not(windows))]
    pub(crate) io_request: io::Request,
    #[cfg(not(windows))]
    pub(crate) io_parking: super::IoParking,
    #[cfg(not(windows))]
    pub(crate) could_block: bool,
    #[cfg(not(windows))]
    pub(crate) close_after_io: bool,
    #[cfg(not(windows))]
    pub(crate) state: AtomicU8, // ClosingState
    /// For the store, which `then` updates.
    #[cfg(windows)]
    last_modified: Option<jsc::JSTimeType>,
    #[cfg(windows)]
    blocking_part: BlockingPart<Vec<u8>>,
}

#[cfg(not(windows))]
bun_threading::intrusive_work_task!(ReadFile, task);
#[cfg(not(windows))]
bun_io::intrusive_io_request!(ReadFile, io_request);

// The default methods on the FileOpener/FileCloser traits provide the bodies.
#[cfg(not(windows))]
impl FileOpener for ReadFile {
    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn set_errno(&mut self, e: crate::Error) {
        self.errno = Some(e);
    }
    fn set_system_error(&mut self, e: jsc::SystemError) {
        self.system_error = Some(e);
    }
    fn pathlike(&self) -> &PathOrFileDescriptor<'static> {
        &self.file_store.pathlike
    }
}

#[cfg(not(windows))]
crate::webcore::blob::impl_file_closer!(ReadFile);

impl ReadFile {
    #[cfg(not(windows))]
    pub(crate) fn update(&mut self) {
        if self.state.load(Ordering::Relaxed) == ClosingState::Closing as u8 {
            self.on_finish();
        } else {
            self.do_read_loop();
        }
    }

    pub(crate) fn create(blob: &Blob) -> ReadFile {
        let store = blob.store().expect("infallible: store present").clone();
        let file_store = store.data.as_file().clone();
        ReadFile {
            #[cfg(windows)]
            target: Target::new(&file_store.pathlike),
            #[cfg(windows)]
            turn: None,
            file_store,
            store: Some(store),
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            #[cfg(not(windows))]
            total_size: MAX_SIZE,
            #[cfg(not(windows))]
            opened_fd: Fd::INVALID,
            #[cfg(not(windows))]
            read_eof: false,
            #[cfg(not(windows))]
            size: 0,
            buffer: Vec::new(),
            #[cfg(not(windows))]
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::do_read_loop_task,
            },
            system_error: None,
            #[cfg(not(windows))]
            errno: None,
            #[cfg(not(windows))]
            io_task: None,
            #[cfg(not(windows))]
            io_poll: io::Poll::default(),
            #[cfg(not(windows))]
            io_request: io::Request {
                next: bun_threading::Link::new(),
                callback: Self::on_request_readable,
                scheduled: false,
            },
            #[cfg(not(windows))]
            io_parking: super::IoParking::new(),
            #[cfg(not(windows))]
            could_block: false,
            #[cfg(not(windows))]
            close_after_io: false,
            #[cfg(not(windows))]
            state: AtomicU8::new(ClosingState::Running as u8),
            #[cfg(windows)]
            last_modified: None,
            #[cfg(windows)]
            blocking_part: BlockingPart::default(),
        }
    }
}

#[cfg(not(windows))]
impl ReadFile {
    pub(crate) const IO_TAG: io::Tag = io::Tag::ReadFile;

    pub(crate) fn on_ready(&mut self) {
        bloblog!("ReadFile.onReady");
        if !self.io_parking.fire() {
            return;
        }
        self.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_read_loop_task,
        };
        // On kqueue platforms we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        if bun_core::Environment::IS_KQUEUE {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io_request.scheduled;
        }

        WorkPool::schedule(&raw mut self.task);
    }

    pub(crate) fn on_io_error(&mut self, err: &bun_sys::Error) {
        bloblog!("ReadFile.onIOError");
        if !self.io_parking.fire() {
            return;
        }
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        self.system_error = Some(err.to_system_error().into());
        self.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_read_loop_task,
        };
        // On kqueue platforms we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        if bun_core::Environment::IS_KQUEUE {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io_request.scheduled;
        }
        WorkPool::schedule(&raw mut self.task);
    }

    /// Thunk matching `io::FileAction::on_error`'s `fn(*mut (), &sys::Error)` shape.
    fn on_io_error_thunk(ctx: *mut (), err: &bun_sys::Error) {
        // SAFETY: ctx is `self as *mut ReadFile` set in on_request_readable below.
        unsafe { (*ctx.cast::<ReadFile>()).on_io_error(err) }
    }

    pub(crate) fn on_request_readable(request: &mut io::Request) -> io::Action<'_> {
        bloblog!("ReadFile.onRequestReadable");
        request.scheduled = false;
        // SAFETY: request points to ReadFile.io_request (intrusive field); recover parent via offset_of.
        let this: &mut ReadFile = unsafe {
            &mut *(bun_core::from_field_ptr!(
                ReadFile,
                io_request,
                std::ptr::from_mut::<io::Request>(request)
            ))
        };
        if !this.io_parking.arm() {
            this.fail_cancelled();
            return <Self as crate::webcore::blob::FileCloser>::schedule_close(request);
        }
        io::Action::Readable(FileAction {
            on_error: Self::on_io_error_thunk,
            ctx: std::ptr::from_mut::<ReadFile>(this).cast::<()>(),
            fd: this.opened_fd,
            poll: &mut this.io_poll,
            tag: ReadFile::IO_TAG,
        })
    }

    /// The wait was cancelled (io thread: while parked — the close path that
    /// follows finishes the job; pool thread: before it could park — the
    /// caller finishes it): fail with ECANCELED.
    fn fail_cancelled(&mut self) {
        self.fail_wait(&bun_sys::Error::from_code(
            bun_sys::E::ECANCELED,
            bun_sys::Tag::read,
        ));
    }

    /// Records `err` when the wait on the io loop couldn't start. The caller finishes the job.
    fn fail_wait(&mut self, err: &bun_sys::Error) {
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        self.system_error = Some(err.to_system_error().into());
        self.state
            .store(ClosingState::Closing as u8, Ordering::SeqCst);
    }

    /// Pool thread: park on the io loop until the fd is readable (or finish
    /// now if the VM cancelled the job meanwhile). The caller returns without
    /// touching `self` again: from here the io thread has it.
    pub(crate) fn wait_for_readable(&mut self) {
        bloblog!("ReadFile.waitForReadable");
        if let Err(err) = io::IoRequestLoop::ensure_init() {
            self.fail_wait(&err);
            return self.on_finish();
        }
        if !self.io_parking.park() {
            self.fail_cancelled();
            return self.on_finish();
        }
        self.close_after_io = true;
        self.io_request
            .store_callback_seq_cst(Self::on_request_readable);
        io::IoRequestLoop::schedule(&mut self.io_request);
    }

    /// Never touches `self.buffer`; the caller moves it out for the duration.
    fn do_read(&mut self, buf: BorrowedCursor<'_, u8>, retry: &mut bool) -> bool {
        let result: bun_sys::Result<usize> = 'brk: {
            if bun_sys::S::ISSOCK(self.file_store.mode) {
                break 'brk bun_sys::recv_non_block_buf(self.opened_fd, buf);
            }
            break 'brk crate::node::fs::read_descriptor(self.opened_fd, buf);
        };

        loop {
            match &result {
                Ok(res) => {
                    self.read_eof = *res == 0;
                }
                Err(err) => {
                    match err.get_errno() {
                        e if e == io::RETRY => {
                            if !self.could_block {
                                // regular files cannot use epoll.
                                // this is fine on kqueue, but not on epoll.
                                continue;
                            }
                            *retry = true;
                            self.read_eof = false;
                            return true;
                        }
                        _ => {
                            self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
                            self.system_error = Some(err.to_system_error().into());
                            if self.system_error.as_ref().unwrap().path.is_empty() {
                                self.system_error.as_mut().unwrap().path =
                                    if self.file_store.pathlike.is_path() {
                                        BunString::clone_utf8(
                                            self.file_store.pathlike.path().slice(),
                                        )
                                    } else {
                                        BunString::EMPTY
                                    };
                            }
                            return false;
                        }
                    }
                }
            }
            break;
        }

        true
    }
}

impl ReadFile {
    pub(crate) fn then(
        this: Self,
        completion: PendingReadFileCompletion,
        _: &JSGlobalObject,
    ) -> JsResult<()> {
        let mut this = this;

        if this.store.is_none() && this.system_error.is_some() {
            let system_error = this.system_error.take().unwrap();
            drop(this);
            return completion.complete(ReadFileResultType::Err(system_error));
        } else if this.store.is_none() {
            drop(this);
            if cfg!(debug_assertions) {
                panic!("assertion failure - store should not be null");
            }
            return completion.complete(ReadFileResultType::Err(SystemError {
                code: BunString::static_("INTERNAL_ERROR"),
                message: BunString::static_("assertion failure - store should not be null"),
                syscall: BunString::static_("read"),
                ..Default::default()
            }));
        }

        let _store = this.store.take().unwrap();
        #[cfg(windows)]
        this.arrive(&_store);
        // reshaped for borrowck — take buffer out so it survives `drop(this)`.
        let buf = core::mem::take(&mut this.buffer);

        // `_store` is dropped at end of scope (= store.deref()).
        let system_error = this.system_error.take();
        drop(this);

        if let Some(err) = system_error {
            return completion.complete(ReadFileResultType::Err(err));
        }

        completion.complete(ReadFileResultType::Result(ReadFileRead {
            buf: buf.into_boxed_slice(),
        }))
    }

    fn directory_error(&self) -> SystemError {
        SystemError {
            code: BunString::static_("EISDIR"),
            path: if self.file_store.pathlike.is_path() {
                BunString::clone_utf8(self.file_store.pathlike.path().slice())
            } else {
                BunString::EMPTY
            },
            message: BunString::static_("Directories cannot be read like files"),
            syscall: BunString::static_("read"),
            ..Default::default()
        }
    }
}

#[cfg(not(windows))]
impl ReadFile {
    pub(crate) fn run(&mut self, task: ReadFileTask) {
        self.run_async(task);
    }

    fn run_async(&mut self, task: ReadFileTask) {
        self.io_task = Some(task);

        if self.file_store.pathlike.is_fd() {
            self.opened_fd = self.file_store.pathlike.fd();
        }

        self.get_fd(Self::run_async_with_fd);
    }

    pub(crate) fn is_allowed_to_close(&self) -> bool {
        self.file_store.pathlike.is_path()
    }

    fn on_finish(&mut self) {
        let close_after_io = self.close_after_io;
        self.size = self.buffer.len() as SizeType;

        {
            if self.do_close(self.is_allowed_to_close()) {
                bloblog!("ReadFile.onFinish() = deferred");
                // we have to wait for the close to finish
                return;
            }
        }
        if !close_after_io {
            if let Some(io_task) = self.io_task.take() {
                bloblog!("ReadFile.onFinish() = immediately");
                io_task.finish();
            }
        }
    }

    fn resolve_size_and_last_modified(&mut self, fd: Fd) {
        let stat: Stat = match bun_sys::fstat(fd) {
            Ok(result) => result,
            Err(err) => {
                self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
                self.system_error = Some(err.to_system_error().into());
                return;
            }
        };

        if let Some(store) = &self.store {
            if let Data::File(file) = Store::data_mut(store) {
                let mtime = bun_sys::PosixStat::init(&stat).mtime();
                file.last_modified = jsc::to_js_time(mtime.sec as isize, mtime.nsec as isize);
            }
        }

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.errno = Some(crate::Error::Sys(bun_errno::SystemErrno::EISDIR));
            self.system_error = Some(self.directory_error());
            return;
        }

        self.could_block = !bun_sys::is_regular_file(stat.st_mode as _);
        self.total_size =
            SizeType::try_from((stat.st_size as i64).max(0).min(MAX_SIZE as i64)).unwrap();

        if stat.st_size > 0 && !self.could_block {
            self.size = self.total_size.min(self.max_length);
            // read up to 4k at a time if
            // they didn't explicitly set a size and we're reading from something that's not a regular file
        } else if stat.st_size == 0 && self.could_block {
            self.size = self.max_length.min(4096);
        }

        if self.offset > 0 {
            // We DO support offset in Bun.file()
            // we ignore errors because it should continue to work even if its a pipe
            let _ = bun_sys::set_file_offset(fd, self.offset);
        }
    }

    fn run_async_with_fd(&mut self, fd: Fd) {
        if self.errno.is_some() {
            self.on_finish();
            return;
        }

        self.resolve_size_and_last_modified(fd);
        if self.errno.is_some() {
            return self.on_finish();
        }

        // Special files might report a size of > 0, and be wrong.
        // so we should check specifically that its a regular file before trusting the size.
        if self.size == 0 && bun_sys::is_regular_file(self.file_store.mode) {
            self.buffer = Vec::new();

            self.on_finish();
            return;
        }

        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        if !self.could_block || (self.size > 0 && self.size != MAX_SIZE) {
            let want = (self.size as usize).saturating_add(16);
            let mut v = Vec::<u8>::new();
            if v.try_reserve_exact(want).is_err() {
                self.errno = Some(crate::Error::Alloc(bun_alloc::AllocError));
                self.system_error = Some(
                    bun_sys::Error::from_code(bun_sys::E::ENOMEM, bun_sys::Tag::read)
                        .to_system_error()
                        .into(),
                );
                self.on_finish();
                return;
            }
            self.buffer = v;
        }

        // If it's not a regular file, it might be something
        // which would block on the next read. So we should
        // avoid immediately reading again until the next time
        // we're scheduled to read.
        //
        // An example of where this happens is stdin.
        //
        //    await Bun.stdin.text();
        //
        // If we immediately call read(), it will block until stdin is
        // readable.
        if self.could_block {
            if bun_core::is_readable(fd) == bun_core::Pollable::NotReady {
                self.wait_for_readable();
                return;
            }
        }

        self.do_read_loop();
    }

    fn do_read_loop_task(task: *mut WorkPoolTask) {
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
        // `&mut self.task` (intrusive) registered in `on_writable`/`init`;
        // recover parent.
        let this = unsafe { &mut *ReadFile::from_task_ptr(task) };

        this.update();
    }

    fn do_read_loop(&mut self) {
        // we hold a 64 KB stack buffer incase the amount of data to
        // be read is greater than the reported amount
        //
        // 64 KB is large, but since this is running in a thread
        // with it's own stack, it should have sufficient space.
        let mut stack_buffer = [const { MaybeUninit::uninit() }; 64 * 1024];
        let mut buffer = core::mem::take(&mut self.buffer);
        while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
            let max = (self.max_length as usize).saturating_sub(buffer.len());

            if max != 0 && self.errno.is_none() && !self.read_eof {
                let mut retry = false;
                let continue_reading = if buffer.capacity() - buffer.len() >= stack_buffer.len() {
                    append_with(&mut buffer, max, |spare| self.do_read(spare, &mut retry))
                } else {
                    let len = stack_buffer.len().min(max);
                    let mut read = BorrowedBuf::from(&mut stack_buffer[..len]);
                    let continue_reading = self.do_read(read.unfilled(), &mut retry);
                    if buffer.capacity() == 0 {
                        // We need to allocate a new buffer
                        // In this case, we want to use `ensureTotalCapacityPrecise` so that it's an exact amount
                        // We want to avoid over-allocating incase it's a large amount of data sent in a single chunk followed by a 0 byte chunk.
                        buffer.reserve_exact(read.len());
                    } else {
                        buffer.reserve(read.len());
                    }
                    buffer.extend_from_slice(read.filled());
                    continue_reading
                };
                // - If they DID set a max length, we should stop
                //   reading after that.
                //
                // - If they DID NOT set a max_length, then it will
                //   be Blob.max_size which is an impossibly large
                //   amount to read.
                if !self.read_eof && buffer.len() >= self.max_length as usize {
                    break;
                }

                if !continue_reading {
                    // Stop reading, we errored
                    break;
                }

                // If it's not a regular file, it might be something
                // which would block on the next read. So we should
                // avoid immediately reading again until the next time
                // we're scheduled to read.
                //
                // An example of where this happens is stdin.
                //
                //    await Bun.stdin.text();
                //
                // If we immediately call read(), it will block until stdin is
                // readable.
                if retry
                    || (self.could_block
                        // If we received EOF, we can skip the poll() system
                        // call. We already know it's done.
                        && !self.read_eof)
                {
                    if self.could_block
                        // If we received EOF, we can skip the poll() system
                        // call. We already know it's done.
                        && !self.read_eof
                    {
                        match bun_core::is_readable(self.opened_fd) {
                            bun_core::Pollable::NotReady => {}
                            bun_core::Pollable::Ready | bun_core::Pollable::Hup => continue,
                        }
                    }
                    self.read_eof = false;
                    self.buffer = buffer;
                    self.wait_for_readable();

                    return;
                }

                // There can be more to read
                continue;
            }

            // -- We are done reading.
            break;
        }
        self.buffer = buffer;

        if self.system_error.is_some() {
            self.buffer = Vec::new(); // clearAndFree
        }

        // If we over-allocated by a lot, we should shrink the buffer to conserve memory.
        if self.buffer.len() + 16_000 < self.buffer.capacity() {
            self.buffer.shrink_to_fit();
        }
        self.on_finish();
    }
}

#[cfg(windows)]
const MAX_BUFFER: usize = bun_jsc::ArrayBuffer::MAX_SIZE as usize;

#[cfg(windows)]
impl ReadFile {
    fn run(&mut self, done: ReadFileTask) -> Option<ReadFileTask> {
        let turn = self.turn.take();
        let Some((file, stat)) = self.open() else {
            return Some(done);
        };
        if !bun_sys::S::ISREG(stat.st_mode as _) {
            let max_length = self.max_length as usize;
            return (self.blocking_part).run(done, move |blocking| {
                let _turn = turn;
                read_stream(&file, max_length, blocking)
            });
        }
        if let Err(err) = self.read_regular_file(&file, stat.st_size) {
            self.fail(&bare(&err));
        }
        Some(done)
    }

    /// JS thread.
    fn arrive(&mut self, store: &RefPtr<Store>) {
        if let (Some(last_modified), Data::File(file)) =
            (self.last_modified, Store::data_mut(store))
        {
            file.last_modified = last_modified;
        }
        match self.blocking_part.take_result() {
            Some(Ok(bytes)) => self.buffer = bytes,
            Some(Err(err)) => self.fail(&bare(&err)),
            None => {}
        }
    }

    fn fail(&mut self, err: &bun_sys::Error) {
        self.system_error = Some(err.to_system_error().into());
    }

    fn open(&mut self) -> Option<(JobFile, Stat)> {
        let file = JobFile::source(core::mem::take(&mut self.target), &self.file_store.pathlike);
        let file = file.inspect_err(|err| self.fail(err)).ok()?;
        let stat = file.stat().inspect_err(|err| self.fail(&bare(err))).ok()?;
        self.last_modified = Some(super::stat_to_js_mtime(&stat));
        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.system_error = Some(self.directory_error());
            return None;
        }
        Some((file, stat))
    }

    fn read_regular_file(&mut self, file: &JobFile, size: u64) -> bun_sys::Result<()> {
        let len = size.saturating_sub(self.offset).min(self.max_length) as usize;
        if file.is_lent() && self.offset > 0 {
            // The descriptor is left at the start of the slice.
            let _ = file.seek_to(self.offset);
        }
        if len == 0 {
            return Ok(());
        }
        if len > MAX_BUFFER || self.buffer.try_reserve_exact(len).is_err() {
            return Err(bun_sys::Error::oom());
        }
        append_with(&mut self.buffer, len, |spare| {
            if file.is_lent() {
                return file.pread_all_buf(spare, self.offset);
            }
            if self.offset > 0 {
                file.seek_to(self.offset)?;
            }
            file.read_all_buf(spare)
        })?;
        Ok(())
    }
}

#[cfg(windows)]
fn read_stream(file: &JobFile, max_length: usize, blocking: &Blocking) -> bun_sys::Result<Vec<u8>> {
    const MIN_READ: usize = 64 * 1024;
    /// The system touches every page of the buffer in front of each read.
    const MAX_READ: usize = 1024 * 1024;

    let mut bytes = Vec::new();
    while bytes.len() < max_length {
        let left = max_length - bytes.len();
        if bytes.len() > MAX_BUFFER || bytes.try_reserve(left.min(MIN_READ)).is_err() {
            return Err(bun_sys::Error::oom());
        }
        let read = append_with(&mut bytes, left.min(MAX_READ), |spare| {
            blocking.read(file.fd(), spare)
        })?;
        if read == 0 {
            break;
        }
    }
    bytes.shrink_to_fit();
    Ok(bytes)
}
