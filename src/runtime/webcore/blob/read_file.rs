use core::ffi::c_void;
use core::marker::PhantomData;
#[cfg(windows)]
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;
#[cfg(not(windows))]
use core::sync::atomic::Ordering;

use crate::Error;
use crate::webcore::Lifetime;
#[cfg(not(windows))]
use crate::webcore::blob::ClosingState;
#[cfg(windows)]
use crate::webcore::blob::store::Bytes as ByteStore;
use crate::webcore::blob::store::{Data, File as FileStore};
use crate::webcore::blob::{Blob, FileCloser, FileOpener, MAX_SIZE, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_collections::ByteVecExt as _;
use bun_core;
use bun_core::String as BunString;
use bun_io as io;
#[cfg(windows)]
// `bun_jsc::EventLoop` is the *module*; the struct is one level deeper.
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, SystemError,
};
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(not(windows))]
use bun_sys::Stat;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd};
use bun_threading::{WorkPool, WorkPoolTask};

bun_output::declare_scope!(WriteFile, hidden);
bun_output::declare_scope!(ReadFile, hidden);

macro_rules! bloblog {
    ($($t:tt)*) => { bun_output::scoped_log!(WriteFile, $($t)*) };
}
#[cfg(windows)]
macro_rules! log {
    ($($t:tt)*) => { bun_output::scoped_log!(ReadFile, $($t)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// NewReadFileHandler
// ──────────────────────────────────────────────────────────────────────────

/// `F` provides the callback that converts the read bytes to a JSValue.
/// Modelled as a trait so each instantiation monomorphizes.
pub trait ReadFileToJs {
    /// `by` carries the caller's allocation provenance unchanged:
    /// `Lifetime::Temporary` ⇒ a `Box::<[u8]>::into_raw` the callee MUST take
    /// ownership of (every `to_*_with_bytes::<Temporary>` arm reclaims it);
    /// otherwise a borrow valid for the call.
    fn call(b: &Blob, g: &JSGlobalObject, by: *mut [u8], lifetime: Lifetime) -> JsResult<JSValue>;
}

pub struct NewReadFileHandler<'a, F: ReadFileToJs> {
    pub(crate) context: Blob,
    pub(crate) promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    _f: PhantomData<F>,
}

impl<'a, F: ReadFileToJs> NewReadFileHandler<'a, F> {
    pub(crate) fn new(context: Blob, global_this: &'a JSGlobalObject) -> Self {
        Self {
            context,
            promise: JSPromiseStrong::default(),
            global_this,
            _f: PhantomData,
        }
    }
}

/// A typed receiver for a file read's bytes. [`ReadFileCompletionFns::of`] erases it to the
/// `(ctx, run, cancel)` a `ReadFile` job carries as its JS side (or a `ReadFileUV` as a field): the
/// shims call `C::run` / `C::cancel` directly and `ctx` is the raw `*mut C`, no extra heap wrapper.
pub trait ReadFileCompletion {
    /// # Safety
    /// `ctx` must be a heap-allocated `Self` whose ownership is transferred to
    /// this call (it is reclaimed via `bun_core::heap::take`).
    unsafe fn run(ctx: *mut Self, bytes: ReadFileResultType) -> JsResult<()>;
    /// The read will never complete (its VM stopped before it did): release `ctx`.
    ///
    /// # Safety
    /// Same ownership transfer as `run`; exactly one of the two is called.
    unsafe fn cancel(ctx: *mut Self) {
        // SAFETY: per the trait contract `ctx` is the heap-allocated `Self` we now own.
        drop(unsafe { bun_core::heap::take(ctx) });
    }
}

impl<'a, F: ReadFileToJs> ReadFileCompletion for NewReadFileHandler<'a, F> {
    unsafe fn run(handler: *mut Self, maybe_bytes: ReadFileResultType) -> JsResult<()> {
        // SAFETY: handler was heap-allocated by doReadFile(); we take ownership here.
        let mut handler = unsafe { bun_core::heap::take(handler) };
        // `Strong::swap()` ties the returned `&mut JSPromise` to
        // `&mut self`, but the promise is GC-heap-owned and outlives `handler`.
        // Decay to a raw pointer so `handler` can be dropped before resolution.
        let promise: *mut jsc::JSPromise = handler.promise.swap();
        let blob = core::mem::take(&mut handler.context);
        let global_this = handler.global_this;
        drop(handler);
        match maybe_bytes {
            ReadFileResultType::Result(result) => {
                let bytes = result.buf;
                if blob.size.get() > 0 {
                    blob.size
                        .set((bytes.len() as SizeType).min(blob.size.get()));
                }
                // The `#[track_caller]` `to_js_host_call` inside `AnyPromise::wrap`
                // provides the source-location/exception-scope behaviour.
                AnyPromise::Normal(promise).wrap(global_this, move |g| {
                    F::call(&blob, g, bytes, Lifetime::Temporary)
                })?;
            }
            ReadFileResultType::Err(err) => {
                // SAFETY: `promise` was just swapped out of `handler.promise`,
                // the `JSPromiseStrong` that rooted it across the async read;
                // from here to `reject` it is a JS-thread stack local, kept
                // alive by JSC's conservative stack scan.
                let promise = unsafe { &mut *promise };
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

type ReadFileOnReadFileCallback = fn(ctx: *mut c_void, bytes: ReadFileResultType) -> JsResult<()>;
/// The read never completed; do with `ctx` what its owner needs (free it, or tell it).
type ReadFileOnCancelCallback = fn(ctx: *mut c_void);

/// What a `ReadFile`/`ReadFileUV` does with the bytes (or the lack of them): `run` on completion,
/// `cancel` if it is dropped before completing. Exactly one of the two is invoked, once, on the JS
/// thread — the ctx typically owns a promise and a Blob, so this is the job's JS side.
pub struct ReadFileCompletionFns {
    pub(crate) ctx: *mut c_void,
    pub(crate) run: ReadFileOnReadFileCallback,
    pub(crate) cancel: ReadFileOnCancelCallback,
}

impl ReadFileCompletionFns {
    /// Erase a typed `ReadFileCompletion`.
    pub(crate) fn of<C: ReadFileCompletion>(ctx: *mut C) -> Self {
        fn run<C: ReadFileCompletion>(ctx: *mut c_void, bytes: ReadFileResultType) -> JsResult<()> {
            // SAFETY: `ctx` is the `*mut C` erased below; ownership transfers per the trait.
            unsafe { C::run(ctx.cast::<C>(), bytes) }
        }
        fn cancel<C: ReadFileCompletion>(ctx: *mut c_void) {
            // SAFETY: as for `run`.
            unsafe { C::cancel(ctx.cast::<C>()) }
        }
        Self {
            ctx: ctx.cast::<c_void>(),
            run: run::<C>,
            cancel: cancel::<C>,
        }
    }

    fn complete(self, bytes: ReadFileResultType) -> JsResult<()> {
        let this = core::mem::ManuallyDrop::new(self);
        (this.run)(this.ctx, bytes)
    }
}

impl Drop for ReadFileCompletionFns {
    fn drop(&mut self) {
        (self.cancel)(self.ctx)
    }
}

// SAFETY: the ctx holds JS-thread state (promise, Blob); it is only ever completed or cancelled on
// the JS thread — as a Job's `Js` side, or inside the JS-thread-only ReadFileUV.
unsafe impl bun_jsc::job::JsAffine for ReadFileCompletionFns {}

pub struct ReadFileRead {
    /// Always a `Box::<[u8]>::into_raw` from the producer's read buffer
    /// (`Vec::into_boxed_slice()` so layout is exactly `(ptr, len)`). Every
    /// consumer reclaims via `heap::take` — there is no borrow case left
    /// (only the two finishers below construct this type and both hand off
    /// owned bytes).
    /// Stored as a raw pointer rather than `Box<[u8]>` because the
    /// `NewReadFileHandler` consumer forwards it straight into
    /// `to_*_with_bytes::<Temporary>(*mut [u8])`, which itself decides whether
    /// the bytes are freed locally or transferred to a JSC external string.
    pub(crate) buf: *mut [u8],
}

/// Result-or-error union for a completed read.
// Constructed/matched in Blob.rs and Body.rs;
// boxing the Err arm would change the cross-file callback ABI for no real win.
#[allow(clippy::large_enum_variant)]
pub enum ReadFileResultType {
    Result(ReadFileRead),
    Err(SystemError),
}

/// The completion token a `ReadFile` keeps across its async I/O.
pub type ReadFileTask = bun_jsc::Completion<ReadFile>;

// SAFETY: file store / byte store / blob store ref (atomic), the read buffer and io-loop
// registration state — nothing thread-affine. What the bytes are delivered to lives in the job's
// JS side (`ReadFileCompletionFns`), never here.
unsafe impl Send for ReadFile {}

impl bun_jsc::JobContext for ReadFile {
    type OffThread = Self;
    /// A read parked on a pipe/tty that never becomes readable is the one
    /// state this job can be stuck in; ending that wait fails the read with
    /// ECANCELED through the usual close path.
    const PARKED_REQUEST: Option<bun_jsc::job::ParkedRequestOffset<Self>> = if cfg!(windows) {
        None
    } else {
        Some(bun_jsc::job::ParkedRequestOffset::INLINE)
    };
    /// Where the bytes go: completed by `then`, or cancelled (its `Drop`) when the job comes
    /// back to a VM that is no longer running script and is released unrun.
    type Js = ReadFileCompletionFns;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // Starts the read; finishes from the io loop via the token.
        this.run(done);
        None
    }
    fn then(
        this: Self,
        completion: ReadFileCompletionFns,
        cx: &bun_jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        ReadFile::then(this, completion, cx.global())
    }
}

#[cfg(not(windows))]
impl ReadFile {
    /// JS thread: hand a prepared `ReadFile` and what to do with its bytes to the work pool (the
    /// job is its one heap allocation).
    pub(crate) fn schedule(
        this: ReadFile,
        completion: ReadFileCompletionFns,
        global: &JSGlobalObject,
    ) {
        bun_jsc::Job::<ReadFile>::schedule(&global.js_thread(), this, completion);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

pub struct ReadFile {
    pub(crate) file_store: FileStore,
    pub(crate) store: Option<RefPtr<Store>>,
    pub offset: SizeType,
    #[cfg(not(windows))]
    pub(crate) max_length: SizeType,
    #[cfg(not(windows))]
    pub(crate) total_size: SizeType,
    pub(crate) opened_fd: Fd,
    #[cfg(not(windows))]
    pub(crate) read_off: SizeType,
    #[cfg(not(windows))]
    pub(crate) read_eof: bool,
    #[cfg(not(windows))]
    pub(crate) size: SizeType,
    pub(crate) buffer: Vec<u8>,
    pub task: WorkPoolTask,
    pub(crate) system_error: Option<SystemError>,
    pub(crate) errno: Option<Error>,
    #[cfg(not(windows))]
    pub(crate) io_task: Option<ReadFileTask>,
    pub(crate) io_poll: io::Poll,
    /// The io-loop wait request and who owns this job while it may be parked
    /// (see [`io::ParkedRequest`]).
    pub(crate) io: io::ParkedRequest,
    #[cfg(not(windows))]
    pub(crate) could_block: bool,
    pub(crate) close_after_io: bool,
    pub(crate) state: AtomicU8, // ClosingState
}

bun_threading::intrusive_work_task!(ReadFile, task);
bun_io::intrusive_io_request!(ReadFile, parked io);
bun_io::poll_owner!(ReadFile, io_poll, ReadFile);

/// The pool re-enters a `ReadFile` through `task` after the io loop reports
/// its fd readable (or errored), and after its poll is closed.
impl bun_threading::WorkTaskHandler for ReadFile {
    fn run_work_task(&mut self) {
        self.update();
    }
}

#[cfg(not(windows))]
impl io::IoRequestHandler for ReadFile {
    /// io thread: the wait request `wait_for_readable` queued was popped.
    fn on_io_request(&mut self) -> io::Action<'_> {
        bloblog!("ReadFile.onRequestReadable");
        if !self.io.arm() {
            self.fail_cancelled();
            return self.close_action();
        }
        let fd = self.opened_fd;
        io::Action::Readable(io::FileAction::new(self, fd))
    }
}

// The default methods on the FileOpener/FileCloser traits provide the bodies.
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
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t {
        unreachable!("ReadFile is POSIX-only; see ReadFileUV")
    }
    #[cfg(windows)]
    fn req(&mut self) -> &mut bun_libuv_sys::uv_fs_t {
        unreachable!("ReadFile is POSIX-only; see ReadFileUV")
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

crate::webcore::blob::impl_file_closer!(ReadFile);

impl ReadFile {
    pub(crate) fn update(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        #[cfg(not(windows))]
        {
            if self.state.load(Ordering::Relaxed) == ClosingState::Closing as u8 {
                self.on_finish();
            } else {
                self.do_read_loop();
            }
        }
    }

    // Not for Windows; Windows callers use ReadFileUV.
    #[cfg(not(windows))]
    pub(crate) fn create(
        store: RefPtr<Store>,
        off: SizeType,
        max_len: SizeType,
    ) -> Result<ReadFile, Error> {
        let file_store = store.data.as_file().clone();
        let read_file = ReadFile {
            file_store,
            store: Some(store),
            offset: off,
            max_length: max_len,
            total_size: MAX_SIZE,
            opened_fd: Fd::INVALID,
            read_off: 0,
            read_eof: false,
            size: 0,
            buffer: Vec::new(),
            task: bun_threading::work_task_for::<Self>(),
            system_error: None,
            errno: None,
            io_task: None,
            io_poll: io::Poll::default(),
            io: io::ParkedRequest::new(io::io_request_callback::<Self>()),
            could_block: false,
            close_after_io: false,
            state: AtomicU8::new(ClosingState::Running as u8),
        };
        Ok(read_file)
    }

    pub fn on_ready(&mut self) {
        bloblog!("ReadFile.onReady");
        #[cfg(not(windows))]
        if !self.io.fire() {
            return;
        }
        self.task = bun_threading::work_task_for::<Self>();
        // On kqueue platforms we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        if bun_core::Environment::IS_KQUEUE {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io.request().scheduled;
        }

        WorkPool::schedule(&raw mut self.task);
    }

    pub(crate) fn on_io_error(&mut self, err: &bun_sys::Error) {
        bloblog!("ReadFile.onIOError");
        #[cfg(not(windows))]
        if !self.io.fire() {
            return;
        }
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        self.system_error = Some(err.to_system_error().into());
        self.task = bun_threading::work_task_for::<Self>();
        // On kqueue platforms we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        if bun_core::Environment::IS_KQUEUE {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io.request().scheduled;
        }
        WorkPool::schedule(&raw mut self.task);
    }

    /// The wait was cancelled (io thread: while parked — the close path that
    /// follows finishes the job; pool thread: before it could park — the
    /// caller finishes it): fail with ECANCELED.
    #[cfg(not(windows))]
    fn fail_cancelled(&mut self) {
        let err = bun_sys::Error::from_code(bun_sys::E::ECANCELED, bun_sys::Tag::read);
        self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
        self.system_error = Some(err.to_system_error().into());
        self.state
            .store(ClosingState::Closing as u8, Ordering::SeqCst);
    }

    /// Pool thread: park on the io loop until the fd is readable (or finish
    /// now if the VM cancelled the job meanwhile). The caller returns without
    /// touching `self` again: from here the io thread has it.
    #[cfg(not(windows))]
    pub(crate) fn wait_for_readable(&mut self) {
        bloblog!("ReadFile.waitForReadable");
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

    /// Pick the read target: `buffer`'s spare capacity if it is at least as
    /// large as `stack_buffer`, otherwise `stack_buffer`; capped by
    /// `max_length - read_off`. Returns `(use_stack, target)` so the caller
    /// keys its `extend_from_slice`/`commit_spare` decision off the same
    /// branch taken here.
    #[cfg(not(windows))]
    fn remaining_buffer<'a>(
        buffer: &'a mut Vec<u8>,
        stack_buffer: &'a mut [u8],
        max_length: SizeType,
        read_off: SizeType,
    ) -> (bool, &'a mut [u8]) {
        let cap = (max_length.saturating_sub(read_off)) as usize;
        let spare = buffer.spare_capacity_mut();
        if spare.len() < stack_buffer.len() {
            let n = stack_buffer.len().min(cap);
            (true, &mut stack_buffer[..n])
        } else {
            let n = spare.len().min(cap);
            // SAFETY: `spare` is `&mut [MaybeUninit<u8>]` over the Vec's spare
            // capacity. The bytes are only written by the `read()`/`recv()`
            // syscall below and `commit_spare` advances `len` by exactly the
            // kernel-reported initialized count; no uninit byte is ever read.
            let target =
                unsafe { core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u8>(), n) };
            (false, target)
        }
    }

    /// Never touches `self.buffer`; the caller moves it out for the duration.
    #[cfg(not(windows))]
    pub(crate) fn do_read(
        &mut self,
        buf: &mut [u8],
        read_len: &mut usize,
        retry: &mut bool,
    ) -> bool {
        let result: bun_sys::Result<usize> = 'brk: {
            if bun_sys::S::ISSOCK(self.file_store.mode) {
                break 'brk bun_sys::recv_non_block(self.opened_fd, buf);
            }
            break 'brk bun_sys::read(self.opened_fd, buf);
        };

        loop {
            match &result {
                Ok(res) => {
                    *read_len = *res as usize; // @truncate — usize→usize is identity here
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

    pub(crate) fn then(
        this: Self,
        completion: ReadFileCompletionFns,
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
        // reshaped for borrowck — take buffer out so it survives `drop(this)`.
        let buf = core::mem::take(&mut this.buffer);

        // `_store` is dropped at end of scope (= store.deref()).
        let system_error = this.system_error.take();
        drop(this);

        if let Some(err) = system_error {
            return completion.complete(ReadFileResultType::Err(err));
        }

        // The receiver takes ownership. Normalize to `Box<[u8]>` so every
        // consumer can reclaim via `heap::take` with a matching layout.
        completion.complete(ReadFileResultType::Result(ReadFileRead {
            buf: bun_core::heap::into_raw(buf.into_boxed_slice()),
        }))
    }

    pub(crate) fn run(&mut self, task: ReadFileTask) {
        self.run_async(task);
    }

    fn run_async(&mut self, task: ReadFileTask) {
        #[cfg(windows)]
        {
            // Windows reads go through ReadFileUV, never the pool.
            let _ = task;
            unreachable!("ReadFile on the work pool (Windows uses ReadFileUV)");
        }
        #[cfg(not(windows))]
        {
            self.io_task = Some(task);

            if self.file_store.pathlike.is_fd() {
                self.opened_fd = self.file_store.pathlike.fd();
            }

            self.get_fd(Self::run_async_with_fd);
        }
    }

    #[cfg(not(windows))]
    pub(crate) fn is_allowed_to_close(&self) -> bool {
        self.file_store.pathlike.is_path()
    }

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
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
            self.system_error = Some(SystemError {
                code: BunString::static_("EISDIR"),
                path: if self.file_store.pathlike.is_path() {
                    BunString::clone_utf8(self.file_store.pathlike.path().slice())
                } else {
                    BunString::EMPTY
                },
                message: BunString::static_("Directories cannot be read like files"),
                syscall: BunString::static_("read"),
                ..Default::default()
            });
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

    #[cfg(not(windows))]
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
        self.read_off = 0;

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

    #[cfg(not(windows))]
    fn do_read_loop(&mut self) {
        #[cfg(not(windows))]
        {
            // we hold a 64 KB stack buffer incase the amount of data to
            // be read is greater than the reported amount
            //
            // 64 KB is large, but since this is running in a thread
            // with it's own stack, it should have sufficient space.
            let mut stack_storage = bun_core::vec::UninitBuf::<{ 64 * 1024 }>::uninit();
            // SAFETY: only `do_read` writes into it and only `stack_buffer[..read_amount]` is read back.
            let stack_buffer = unsafe { stack_storage.as_bytes_mut() };
            // `do_read` never touches `self.buffer`; move it out so the read
            // target slice (which may point into its spare capacity) can be
            // held as a safe `&mut [u8]` across the `&mut self` call.
            let mut buffer = core::mem::take(&mut self.buffer);
            while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
                let (use_stack, buf) = Self::remaining_buffer(
                    &mut buffer,
                    stack_buffer,
                    self.max_length,
                    self.read_off,
                );

                if !buf.is_empty() && self.errno.is_none() && !self.read_eof {
                    let mut read_amount: usize = 0;
                    let mut retry = false;
                    let continue_reading = self.do_read(buf, &mut read_amount, &mut retry);

                    // We might read into the stack buffer, so we need to copy it into the heap.
                    if use_stack {
                        // `do_read` initialized exactly `stack_buffer[..read_amount]` (0 on error/retry).
                        let read = &stack_buffer[..read_amount];
                        if buffer.capacity() == 0 {
                            // We need to allocate a new buffer
                            // In this case, we want to use `ensureTotalCapacityPrecise` so that it's an exact amount
                            // We want to avoid over-allocating incase it's a large amount of data sent in a single chunk followed by a 0 byte chunk.
                            buffer.reserve_exact(read.len());
                        } else {
                            buffer.reserve(read.len());
                        }
                        buffer.extend_from_slice(read);
                    } else {
                        // record the amount of data read
                        // SAFETY: read() wrote `read_amount` initialized bytes into spare capacity.
                        unsafe { bun_core::vec::commit_spare(&mut buffer, read_amount) };
                    }
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
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFileUV (Windows)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct ReadFileUV<'a> {
    pub(crate) loop_: *mut libuv::uv_loop_t,
    pub(crate) event_loop: &'a EventLoop,
    pub(crate) file_store: FileStore,
    pub(crate) byte_store: ByteStore,
    pub(crate) store: RefPtr<Store>,
    pub offset: SizeType,
    pub(crate) max_length: SizeType,
    pub(crate) total_size: SizeType,
    pub(crate) opened_fd: Fd,
    pub(crate) read_len: SizeType,
    pub(crate) read_off: SizeType,
    pub(crate) read_eof: bool,
    pub(crate) size: SizeType,
    pub(crate) buffer: Vec<u8>,
    pub(crate) system_error: Option<SystemError>,
    pub(crate) errno: Option<Error>,
    /// `Some` until the read completes; a `ReadFileUV` dropped before that cancels it.
    pub(crate) completion: Option<ReadFileCompletionFns>,
    pub(crate) is_regular_file: bool,

    pub(crate) req: libuv::fs_t,
    /// Stash for the open completion callback across the libuv async hop.
    open_callback: fn(&mut Self, Fd),
}

#[cfg(windows)]
impl<'a> FileOpener for ReadFileUV<'a> {
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
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t {
        self.loop_
    }
    fn req(&mut self) -> &mut bun_libuv_sys::uv_fs_t {
        &mut self.req
    }
    fn set_open_callback(&mut self, cb: fn(&mut Self, Fd)) {
        self.open_callback = cb;
    }
    fn open_callback(&self) -> fn(&mut Self, Fd) {
        self.open_callback
    }
}

#[cfg(windows)]
impl<'a> FileCloser for ReadFileUV<'a> {
    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t {
        self.loop_
    }

    // `ReadFileUV` has no `io_request` field (its libuv request field is
    // `req`), so `do_close` falls straight to the close-fd branch and
    // none of the methods below are ever reached — these are genuinely dead
    // code paths.
    fn close_after_io(&self) -> bool {
        false
    }
    fn set_close_after_io(&mut self, _: bool) {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    fn state(&self) -> &AtomicU8 {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    fn io_request(&mut self) -> Option<&mut bun_io::Request> {
        None
    }
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    unsafe fn schedule_close(_: &mut bun_io::Request) -> bun_io::Action<'_> {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
}

#[cfg(windows)]
impl<'a> ReadFileUV<'a> {
    /// Typed entry: `C` supplies run/cancel for the erased completion.
    pub(crate) fn start<C: ReadFileCompletion>(
        event_loop: *mut EventLoop,
        store: RefPtr<Store>,
        off: SizeType,
        max_len: SizeType,
        handler: *mut C,
    ) {
        Self::start_with_ctx(
            event_loop,
            store,
            off,
            max_len,
            ReadFileCompletionFns::of(handler),
        )
    }

    /// Raw entry — caller already has the type-erased `(fn, *anyopaque)` pair
    /// Shares the body with `start`.
    pub(crate) fn start_with_ctx(
        event_loop: *mut EventLoop,
        store: RefPtr<Store>,
        off: SizeType,
        max_len: SizeType,
        completion: ReadFileCompletionFns,
    ) {
        log!("ReadFileUV.start");
        // SAFETY: `event_loop` is the per-thread `EventLoop` singleton owned by
        // the VM (`global.bun_vm().event_loop()`); it strictly outlives this
        // async op, which additionally holds a keep-alive on it below.
        let event_loop: &'a EventLoop = unsafe { &*event_loop };
        let file_store = store.data.as_file().clone();
        let this = Box::new(ReadFileUV {
            // Projected through the helper to avoid materializing a
            // `&VirtualMachine`.
            loop_: event_loop.uv_loop().cast(),
            event_loop,
            file_store,
            byte_store: ByteStore::default(),
            store, // store.ref() — Arc clone owned here
            offset: off,
            max_length: max_len,
            total_size: MAX_SIZE,
            opened_fd: Fd::INVALID,
            read_len: 0,
            read_off: 0,
            read_eof: false,
            size: 0,
            buffer: Vec::new(),
            system_error: None,
            errno: None,
            completion: Some(completion),
            is_regular_file: false,
            req: bun_core::ffi::zeroed(),
            open_callback: Self::on_file_open,
        });
        // Keep the event loop alive while the async operation is pending
        event_loop.ref_keep_alive();
        let this_ptr: *mut ReadFileUV = bun_core::heap::into_raw(this);
        // SAFETY: this_ptr is freshly boxed and uniquely owned by the async op.
        unsafe { (*this_ptr).get_fd(Self::on_file_open) };
        // ownership now lives with the libuv request chain until finalize().
        let _ = this_ptr;
    }

    pub fn finalize(this: *mut Self) {
        log!("ReadFileUV.finalize");
        // SAFETY: `this` was heap-allocated in start(); we reclaim ownership here.
        let mut this_box = unsafe { bun_core::heap::take(this) };
        let event_loop = this_box.event_loop;

        let completion = this_box
            .completion
            .take()
            .expect("a ReadFileUV completes once");

        let result = if let Some(err) = this_box.system_error.take() {
            ReadFileResultType::Err(err)
        } else {
            // Move byte_store out so dropping `this_box` below does not free the
            // buffer we hand to the callback. Normalize to `Box<[u8]>` so the
            // `is_temporary` consumer (Body.rs / Blob.rs) can soundly reclaim
            // via `heap::take` — handing out `(ptr, len)` from a ByteStore
            // whose `cap > len` would be a layout-mismatched dealloc.
            let boxed = core::mem::take(&mut this_box.byte_store).into_boxed_slice();
            ReadFileResultType::Result(ReadFileRead {
                buf: bun_core::heap::into_raw(boxed),
            })
        };

        // The completion must run BEFORE the cleanup below (store deref / req.deinit /
        // box drop / event_loop.unref) — it may inspect store. A libuv callback returns void: an
        // exception the JS side left pending is reported here (a termination just stands down).
        crate::dispatch::fold(completion.complete(result));

        this_box.req.deinit();
        drop(this_box);
        // Release the event loop reference now that we're done
        event_loop.unref_keep_alive();
        log!("ReadFileUV.finalize destroy");
    }

    pub(crate) fn is_allowed_to_close(&self) -> bool {
        self.file_store.pathlike.is_path()
    }

    fn on_finish(&mut self) {
        log!("ReadFileUV.onFinish");
        let fd = self.opened_fd;
        let needs_close = fd != Fd::INVALID;

        self.size = self.read_len.max(self.size);
        self.total_size = self.total_size.max(self.size);

        if needs_close {
            if self.do_close(self.is_allowed_to_close()) {
                // we have to wait for the close to finish
                return;
            }
        }

        Self::finalize(core::ptr::from_mut(self));
    }

    pub(crate) fn on_file_open(&mut self, opened_fd: Fd) {
        log!("ReadFileUV.onFileOpen");
        if self.errno.is_some() {
            self.on_finish();
            return;
        }

        self.req.deinit();
        self.req.data = core::ptr::from_mut(self).cast::<c_void>();

        // SAFETY: FFI — `loop_` is the live VM uv loop, `self.req` is a freshly
        // deinit'd `fs_t` owned by `self`, `opened_fd.uv()` is the just-opened fd,
        // and `on_file_initial_stat` is a valid `uv_fs_cb` that recovers `self`
        // from `req.data` (set above).
        let rc = unsafe {
            libuv::uv_fs_fstat(
                self.loop_,
                &mut self.req,
                opened_fd.uv(),
                Some(Self::on_file_initial_stat),
            )
        };
        if let Some(errno) = rc.errno() {
            self.errno = Some(bun_errno::from_errno(errno as i32).into());
            self.system_error = Some(
                bun_sys::Error::from_code(errno, bun_sys::Tag::fstat)
                    .to_system_error()
                    .into(),
            );
            self.on_finish();
            return;
        }

        self.req.data = core::ptr::from_mut(self).cast::<c_void>();
    }

    extern "C" fn on_file_initial_stat(req: *mut libuv::fs_t) {
        log!("ReadFileUV.onFileInitialStat");
        // SAFETY: req.data was set to *mut Self in on_file_open().
        let this: &mut ReadFileUV = unsafe { bun_ptr::callback_ctx::<ReadFileUV>((*req).data) };

        // `req` aliases `this.req`; once `&mut ReadFileUV` exists, going through the
        // raw `req` pointer would violate Stacked Borrows. Read via `this.req` instead.
        if let Some(errno) = this.req.result.errno() {
            this.errno = Some(bun_errno::from_errno(errno as i32).into());
            this.system_error = Some(
                bun_sys::Error::from_code(errno, bun_sys::Tag::fstat)
                    .to_system_error()
                    .into(),
            );
            this.on_finish();
            return;
        }

        let stat = this.req.statbuf;

        // keep in sync with resolveSizeAndLastModified
        if let Data::File(file) = Store::data_mut(&this.store) {
            // `uv_timespec_t` fields are `c_long` (i32 on Windows); widen to the
            // platform-width `isize` `to_js_time` expects.
            file.last_modified =
                jsc::to_js_time(stat.mtime().sec as isize, stat.mtime().nsec as isize);
        }

        if bun_sys::S::ISDIR(u32::try_from(stat.mode()).expect("int cast")) {
            this.errno = Some(crate::Error::Sys(bun_errno::SystemErrno::EISDIR));
            this.system_error = Some(SystemError {
                code: BunString::static_("EISDIR").into(),
                path: if this.file_store.pathlike.is_path() {
                    BunString::clone_utf8(this.file_store.pathlike.path().slice())
                } else {
                    BunString::EMPTY
                }
                .into(),
                message: BunString::static_("Directories cannot be read like files").into(),
                syscall: BunString::static_("read").into(),
                ..Default::default()
            });
            this.on_finish();
            return;
        }
        // `uv_stat_t::st_size` is `u64` (never negative); clamp to MAX_SIZE
        // without a signed detour so a hypothetical >i64::MAX value isn't
        // wrapped to negative and then floored to 0.
        this.total_size = stat.size().min(MAX_SIZE as u64) as SizeType;
        this.is_regular_file = bun_sys::is_regular_file(stat.mode() as bun_sys::Mode);

        log!("is_regular_file: {}", this.is_regular_file);

        if stat.size() > 0 && this.is_regular_file {
            this.size = this.total_size.min(this.max_length);
        } else if stat.size() == 0 && !this.is_regular_file {
            // read up to 4k at a time if they didn't explicitly set a size and
            // we're reading from something that's not a regular file.
            this.size = this.max_length.min(4096);
        }

        if this.offset > 0 {
            // We DO support offset in Bun.file()
            match bun_sys::set_file_offset(this.opened_fd, this.offset) {
                // we ignore errors because it should continue to work even if its a pipe
                Err(_) | Ok(_) => {}
            }
        }

        // Special files might report a size of > 0, and be wrong.
        // so we should check specifically that its a regular file before trusting the size.
        if this.size == 0 && this.is_regular_file {
            // buffer is empty here,
            // so move it (Vec<u8>) into the owning ByteStore rather than borrow.
            this.byte_store = ByteStore::init(core::mem::take(&mut this.buffer));
            this.on_finish();
            return;
        }
        // Out of memory we can't read more than 4GB at a time (ULONG) on Windows
        if this.size as usize > bun_sys::windows::ULONG::MAX as usize {
            this.errno = Some(bun_errno::from_errno(bun_sys::E::NOMEM as i32).into());
            this.system_error = Some(
                bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::read)
                    .to_system_error()
                    .into(),
            );
            this.on_finish();
            return;
        }
        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        let want =
            ((this.size as usize).saturating_add(16)).min(bun_sys::windows::ULONG::MAX as usize);
        if this.buffer.try_reserve_exact(want).is_err() {
            this.errno = Some(crate::Error::Alloc(bun_alloc::AllocError));
            this.system_error = Some(
                bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::read)
                    .to_system_error()
                    .into(),
            );
            this.on_finish();
            return;
        }
        this.read_len = 0;
        this.read_off = 0;

        this.req.deinit();

        this.queue_read();
    }

    fn remaining_buffer(&mut self) -> &mut [MaybeUninit<u8>] {
        // libuv writes into spare capacity before any read; callers only need
        // ptr/len, so expose the spare slice directly instead of materialising
        // a `&mut [u8]` over uninitialized bytes.
        let limit = (self.max_length.saturating_sub(self.read_off)) as usize;
        let spare = self.buffer.spare_capacity_mut();
        let take = spare.len().min(limit);
        &mut spare[..take]
    }

    pub(crate) fn queue_read(&mut self) {
        // if not a regular file, buffer capacity is arbitrary, and running out doesn't mean we're
        // at the end of the file
        if (!self.remaining_buffer().is_empty() || !self.is_regular_file)
            && self.errno.is_none()
            && !self.read_eof
        {
            log!(
                "ReadFileUV.queueRead - this.remainingBuffer().len = {}",
                self.remaining_buffer().len()
            );

            if !self.is_regular_file {
                // non-regular files have variable sizes, so we always ensure
                // theres at least 4096 bytes of free space. there has already
                // been an initial allocation done for us
                if self.buffer.try_reserve(4096).is_err() {
                    self.errno = Some(crate::Error::Alloc(bun_alloc::AllocError));
                    self.system_error = Some(
                        bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::read)
                            .to_system_error()
                            .into(),
                    );
                    self.on_finish();
                    return;
                }
            }

            let buf = self.remaining_buffer();
            // Construct uv_buf_t directly from `as_mut_ptr()` so the stored
            // `base` carries write provenance — `uv_buf_t::init` takes `&[u8]`
            // and would implicitly reborrow `buf` as shared, yielding a
            // SharedReadOnly-tagged pointer that libuv then *writes* through
            // (uv_fs_read fills this buffer), which is UB under Stacked Borrows.
            let mut bufs: [libuv::uv_buf_t; 1] = [libuv::uv_buf_t {
                len: buf.len() as libuv::ULONG,
                base: buf.as_mut_ptr().cast::<u8>(),
            }];
            self.req.assert_cleaned_up();
            // SAFETY: FFI — `loop_` is the live VM uv loop, `self.req` is a
            // cleaned-up `fs_t` owned by `self`, `bufs` points at a stack uv_buf
            // wrapping `self.buffer`'s spare capacity (libuv copies the iovec
            // descriptor before returning), `opened_fd.uv()` is the open fd, and
            // `on_read` is a valid `uv_fs_cb` that recovers `self` from `req.data`.
            let res = unsafe {
                libuv::uv_fs_read(
                    self.loop_,
                    &mut self.req,
                    self.opened_fd.uv(),
                    bufs.as_mut_ptr(),
                    bufs.len() as u32,
                    i64::try_from(self.offset + self.read_off).expect("int cast"),
                    Some(Self::on_read),
                )
            };
            self.req.data = core::ptr::from_mut(self).cast::<c_void>();
            if let Some(errno) = res.errno() {
                self.errno = Some(bun_errno::from_errno(errno as i32).into());
                self.system_error = Some(
                    bun_sys::Error::from_code(errno, bun_sys::Tag::read)
                        .to_system_error()
                        .into(),
                );
                self.on_finish();
            }
        } else {
            log!("ReadFileUV.queueRead done");

            // We are done reading.
            let owned = core::mem::take(&mut self.buffer).into_boxed_slice();
            self.byte_store = ByteStore::init_owned(owned);
            self.on_finish();
        }
    }

    pub(crate) extern "C" fn on_read(req: *mut libuv::fs_t) {
        // SAFETY: req.data was set to *mut Self in queue_read().
        let this: &mut ReadFileUV = unsafe { bun_ptr::callback_ctx::<ReadFileUV>((*req).data) };

        // `req` aliases `this.req`; once `&mut ReadFileUV` exists, going through the
        // raw `req` pointer would violate Stacked Borrows. Read via `this.req` instead.
        let result = this.req.result;

        if let Some(errno) = result.errno() {
            this.errno = Some(bun_errno::from_errno(errno as i32).into());
            this.system_error = Some(
                bun_sys::Error::from_code(errno, bun_sys::Tag::read)
                    .to_system_error()
                    .into(),
            );
            this.on_finish();
            return;
        }

        if result.int() == 0 {
            // We are done reading.
            let owned = core::mem::take(&mut this.buffer).into_boxed_slice();
            this.byte_store = ByteStore::init_owned(owned);
            this.on_finish();
            return;
        }

        this.read_off += SizeType::try_from(result.int()).expect("int cast");
        // SAFETY: libuv wrote result.int() bytes into remaining_buffer()'s spare slice.
        unsafe {
            this.buffer
                .uv_commit(usize::try_from(result.int()).expect("int cast"))
        };

        this.req.deinit();
        this.queue_read();
    }
}
