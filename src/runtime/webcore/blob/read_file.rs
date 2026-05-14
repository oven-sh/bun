use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::{MaybeUninit, offset_of};
use core::sync::atomic::{AtomicPtr, AtomicU8, Ordering};

use crate::webcore::Lifetime;
use crate::webcore::blob::store::{Bytes as ByteStore, Data, File as FileStore};
use crate::webcore::blob::{
    Blob, ClosingState, FileCloser, FileOpener, MAX_SIZE, SizeType, StoreRef,
};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_collections::ByteVecExt as _;
use bun_core::String as BunString;
use bun_core::{self, Error};
use bun_io::{self as io, FileAction};
#[cfg(windows)]
// `bun_jsc::EventLoop` is the *module*; the struct is one level deeper.
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, SysErrorJsc as _,
    SystemError,
};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd, Stat};
use bun_threading::{IntrusiveWorkTask as _, WorkPool, WorkPoolTask};

bun_output::declare_scope!(WriteFile, hidden);
bun_output::declare_scope!(ReadFile, hidden);

macro_rules! bloblog {
    ($($t:tt)*) => { bun_output::scoped_log!(WriteFile, $($t)*) };
}
macro_rules! log {
    ($($t:tt)*) => { bun_output::scoped_log!(ReadFile, $($t)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// NewReadFileHandler
// ──────────────────────────────────────────────────────────────────────────

/// Zig: `pub fn NewReadFileHandler(comptime Function: anytype) type`
///
/// `F` provides the comptime callback that converts the read bytes to a JSValue.
/// Modelled as a trait so each instantiation monomorphizes like the Zig
/// type-generator did.
pub trait ReadFileToJs {
    /// `by` carries the caller's allocation provenance unchanged:
    /// `Lifetime::Temporary` ⇒ a `Box::<[u8]>::into_raw` the callee MUST take
    /// ownership of (every `to_*_with_bytes::<Temporary>` arm reclaims it);
    /// otherwise a borrow valid for the call.
    fn call(b: &Blob, g: &JSGlobalObject, by: *mut [u8], lifetime: Lifetime) -> JsResult<JSValue>;
}

pub struct NewReadFileHandler<'a, F: ReadFileToJs> {
    pub context: Blob,
    pub promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    _f: PhantomData<F>,
}

impl<'a, F: ReadFileToJs> NewReadFileHandler<'a, F> {
    pub fn new(context: Blob, global_this: &'a JSGlobalObject) -> Self {
        Self {
            context,
            promise: JSPromiseStrong::default(),
            global_this,
            _f: PhantomData,
        }
    }
}

/// Models Zig's `comptime callback: fn(ctx: Context, bytes: ReadFileResultType) bun.JSTerminated!void`
/// (and `comptime Handler: type` for `ReadFileUV.start`). Monomorphized per
/// call-site type so the erased shim calls `C::run` directly and
/// `on_complete_ctx` carries the **raw** `*mut C` — no heap wrapper, matching
/// the Zig spec where any code introspecting `onCompleteCtx` sees the original
/// context pointer.
pub trait ReadFileCompletion {
    fn run(ctx: *mut Self, bytes: ReadFileResultType) -> jsc::JsTerminatedResult<()>;
}

impl<'a, F: ReadFileToJs> ReadFileCompletion for NewReadFileHandler<'a, F> {
    fn run(handler: *mut Self, maybe_bytes: ReadFileResultType) -> jsc::JsTerminatedResult<()> {
        // SAFETY: handler was heap-allocated by doReadFile(); we take ownership here.
        let mut handler = unsafe { bun_core::heap::take(handler) };
        // PORT NOTE: `Strong::swap()` ties the returned `&mut JSPromise` to
        // `&mut self`, but the promise is GC-heap-owned and outlives `handler`.
        // Decay to a raw pointer so `handler` can be dropped before resolution.
        let promise: *mut jsc::JSPromise = handler.promise.swap();
        let mut blob = core::mem::take(&mut handler.context);
        // `context` was populated via `this.dupe()` in doReadFile(), so it
        // owns a store ref, a name ref, and possibly a content_type copy.
        // (blob is dropped at end of scope — Drop handles deinit.)
        let global_this = handler.global_this;
        drop(handler);
        match maybe_bytes {
            ReadFileResultType::Result(result) => {
                let bytes = result.buf;
                if blob.size.get() > 0 {
                    blob.size
                        .set((bytes.len() as SizeType).min(blob.size.get()));
                }
                // Zig defined a local `WrappedFn` struct to adapt the comptime
                // `Function` into the `toJSHostCall` shape; Rust closures + the
                // `#[track_caller]` `to_js_host_call` inside `AnyPromise::wrap`
                // give the same source-location/exception-scope behaviour.
                AnyPromise::Normal(promise).wrap(global_this, move |g| {
                    F::call(&mut blob, g, bytes, Lifetime::Temporary)
                })?;
            }
            ReadFileResultType::Err(err) => {
                // SAFETY: `promise` was just swapped out of a live `Strong`
                // handle; the JS heap cell is kept alive by the caller's
                // `JSRef` over the ReadFile task.
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

pub type ReadFileOnReadFileCallback = fn(ctx: *mut c_void, bytes: ReadFileResultType);

pub struct ReadFileRead {
    /// Always a `Box::<[u8]>::into_raw` from the producer's read buffer
    /// (`Vec::into_boxed_slice()` so layout is exactly `(ptr, len)`). Every
    /// consumer reclaims via `heap::take` — there is no borrow case left
    /// (Zig's `is_temporary = false` arm is unreachable here; only the two
    /// finishers below construct this type and both hand off owned bytes).
    /// Stored as a raw pointer rather than `Box<[u8]>` because the
    /// `NewReadFileHandler` consumer forwards it straight into
    /// `to_*_with_bytes::<Temporary>(*mut [u8])`, which itself decides whether
    /// the bytes are freed locally or transferred to a JSC external string.
    pub buf: *mut [u8],
    pub total_size: SizeType,
}

/// Zig: `SystemError.Maybe(ReadFileRead)`
pub enum ReadFileResultType {
    Result(ReadFileRead),
    Err(SystemError),
}

pub type ReadFileTask = bun_jsc::work_task::WorkTask<ReadFile>;

impl bun_jsc::work_task::WorkTaskContext for ReadFile {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ReadFileTask;
    fn run(this: *mut Self, task: *mut bun_jsc::work_task::WorkTask<Self>) {
        // SAFETY: WorkTask::run_from_thread_pool guarantees `this` is live.
        unsafe { (*this).run(task) }
    }
    fn then(this: *mut Self, global: &jsc::JSGlobalObject) -> Result<(), jsc::JsTerminated> {
        // SAFETY: `this` was heap-allocated by the WorkTask flow; consumed here.
        ReadFile::then(unsafe { bun_core::heap::take(this) }, global)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

pub struct ReadFile {
    pub file_store: FileStore,
    pub byte_store: ByteStore,
    pub store: Option<StoreRef>,
    pub offset: SizeType,
    pub max_length: SizeType,
    pub total_size: SizeType,
    pub opened_fd: Fd,
    pub read_off: SizeType,
    pub read_eof: bool,
    pub size: SizeType,
    pub buffer: Vec<u8>,
    pub task: WorkPoolTask,
    pub system_error: Option<SystemError>,
    pub errno: Option<Error>,
    pub on_complete_ctx: *mut c_void,
    pub on_complete_callback: ReadFileOnReadFileCallback,
    pub io_task: Option<*mut ReadFileTask>,
    pub io_poll: io::Poll,
    pub io_request: io::Request,
    pub could_block: bool,
    pub close_after_io: bool,
    pub state: AtomicU8, // ClosingState
}

bun_threading::intrusive_work_task!(ReadFile, task);

// Zig: `pub const getFd = FileOpener(@This()).getFd;` / `doClose = FileCloser(@This()).doClose;`
// — modeled as trait impls; the default methods on the traits provide the bodies.
impl FileOpener for ReadFile {
    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn set_errno(&mut self, e: bun_core::Error) {
        self.errno = Some(e);
    }
    fn set_system_error(&mut self, e: jsc::SystemError) {
        self.system_error = Some(e);
    }
    fn pathlike(&self) -> &PathOrFileDescriptor {
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

impl FileCloser for ReadFile {
    const IO_TAG: bun_io::Tag = bun_io::Tag::ReadFile;
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
    fn io_request(&mut self) -> Option<&mut bun_io::Request> {
        Some(&mut self.io_request)
    }
    fn io_poll(&mut self) -> &mut bun_io::Poll {
        &mut self.io_poll
    }
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask {
        &mut self.task
    }
    fn update(&mut self) {
        ReadFile::update(self)
    }
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t {
        unreachable!()
    }

    fn schedule_close(request: &mut bun_io::Request) -> bun_io::Action<'_> {
        // SAFETY: request is &mut self.io_request (intrusive); recover parent.
        let this: &mut ReadFile = unsafe {
            &mut *(bun_core::from_field_ptr!(
                ReadFile,
                io_request,
                std::ptr::from_mut::<io::Request>(request)
            ))
        };
        fn on_done(ctx: *mut ()) {
            // SAFETY: ctx is `self as *mut ReadFile` set below.
            let this = unsafe { bun_ptr::callback_ctx::<ReadFile>(ctx.cast()) };
            <ReadFile as FileCloser>::on_io_request_closed(this);
        }
        // PORT NOTE: reshaped for borrowck — compute the parent raw pointer
        // before mutably borrowing `io_poll` so the two borrows do not overlap.
        let ctx = std::ptr::from_mut::<ReadFile>(this).cast::<()>();
        let fd = this.opened_fd;
        io::Action::Close(io::CloseAction {
            fd,
            poll: &mut this.io_poll,
            ctx,
            tag: <Self as FileCloser>::IO_TAG,
            on_done,
        })
    }

    fn on_close_io_request(task: *mut bun_jsc::WorkPoolTask) {
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
        // `&mut self.task` (intrusive) registered in `on_io_request_closed`;
        // recover parent.
        let this = unsafe { &mut *ReadFile::from_task_ptr(task) };
        this.close_after_io = false;
        ReadFile::update(this);
    }
}

impl ReadFile {
    pub fn update(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        if self.state.load(Ordering::Relaxed) == ClosingState::Closing as u8 {
            self.on_finish();
        } else {
            self.do_read_loop();
        }
    }

    // Zig: `if (Environment.isWindows) @compileError("…")` — Zig analyzes this
    // lazily (only fires if a Windows caller reaches it). Rust's `compile_error!`
    // is eager, so we gate the whole fn instead; Windows callers use ReadFileUV.
    #[cfg(not(windows))]
    pub fn create_with_ctx(
        store: StoreRef,
        on_read_file_context: *mut c_void,
        on_complete_callback: ReadFileOnReadFileCallback,
        off: SizeType,
        max_len: SizeType,
    ) -> Result<Box<ReadFile>, Error> {
        // TODO(port): narrow error set
        // store.ref() — `StoreRef` carries the +1; held in `self.store`.
        let file_store = store.data.as_file().clone();
        let read_file = Box::new(ReadFile {
            file_store,
            byte_store: ByteStore::default(),
            store: Some(store),
            offset: off,
            max_length: max_len,
            total_size: MAX_SIZE,
            opened_fd: Fd::INVALID,
            read_off: 0,
            read_eof: false,
            size: 0,
            buffer: Vec::new(),
            // TODO(port): was `undefined` — overwritten before first schedule.
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::do_read_loop_task,
            },
            system_error: None,
            errno: None,
            on_complete_ctx: on_read_file_context,
            on_complete_callback,
            io_task: None,
            io_poll: io::Poll::default(),
            io_request: io::Request {
                next: bun_threading::Link::new(),
                callback: Self::on_request_readable,
                scheduled: false,
            },
            could_block: false,
            close_after_io: false,
            state: AtomicU8::new(ClosingState::Running as u8),
        });
        Ok(read_file)
    }

    #[cfg(not(windows))]
    pub fn create<C: ReadFileCompletion>(
        store: StoreRef,
        off: SizeType,
        max_len: SizeType,
        context: *mut C,
    ) -> Result<Box<ReadFile>, Error> {
        // Zig used a local `Handler` struct whose `run` calls the comptime
        // `callback` and swallows the JSTerminated error. `ReadFileCompletion`
        // monomorphizes per `C`, so `handler_run::<C>` is that local struct's
        // `run` and `on_complete_ctx` is the unwrapped `*mut C` — exactly the
        // Zig layout (no extra heap box, nothing to leak on the `Err` path).
        fn handler_run<C: ReadFileCompletion>(ctx: *mut c_void, bytes: ReadFileResultType) {
            // TODO(port): properly propagate exception upwards (matches Zig TODO).
            let _ = C::run(ctx.cast::<C>(), bytes);
        }
        ReadFile::create_with_ctx(
            store,
            context.cast::<c_void>(),
            handler_run::<C>,
            off,
            max_len,
        )
    }

    pub const IO_TAG: io::Tag = io::Tag::ReadFile;

    pub fn on_readable(request: *mut io::Request) {
        // SAFETY: request points to ReadFile.io_request (intrusive field).
        let this: &mut ReadFile =
            unsafe { &mut *(bun_core::from_field_ptr!(ReadFile, io_request, request)) };
        this.on_ready();
    }

    pub fn on_ready(&mut self) {
        bloblog!("ReadFile.onReady");
        self.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_read_loop_task,
        };
        // On macOS, we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        #[cfg(target_os = "macos")]
        {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io_request.scheduled;
        }

        WorkPool::schedule(&raw mut self.task);
    }

    pub fn on_io_error(&mut self, err: bun_sys::Error) {
        bloblog!("ReadFile.onIOError");
        self.errno = Some(bun_core::errno_to_zig_err(err.errno as i32));
        self.system_error = Some(err.to_system_error().into());
        self.task = WorkPoolTask {
            node: Default::default(),
            callback: Self::do_read_loop_task,
        };
        // On macOS, we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        #[cfg(target_os = "macos")]
        {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io_request.scheduled;
        }
        WorkPool::schedule(&raw mut self.task);
    }

    /// Thunk matching `io::FileAction::on_error`'s `fn(*mut (), sys::Error)` shape.
    fn on_io_error_thunk(ctx: *mut (), err: bun_sys::Error) {
        // SAFETY: ctx is `self as *mut ReadFile` set in on_request_readable below.
        unsafe { (*ctx.cast::<ReadFile>()).on_io_error(err) }
    }

    pub fn on_request_readable(request: &mut io::Request) -> io::Action<'_> {
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
        io::Action::Readable(FileAction {
            on_error: Self::on_io_error_thunk,
            ctx: std::ptr::from_mut::<ReadFile>(this).cast::<()>(),
            fd: this.opened_fd,
            poll: &mut this.io_poll,
            tag: ReadFile::IO_TAG,
        })
    }

    pub fn wait_for_readable(&mut self) {
        bloblog!("ReadFile.waitForReadable");
        self.close_after_io = true;
        // Zig: @atomicStore on the callback fn-pointer field.
        self.io_request
            .store_callback_seq_cst(Self::on_request_readable);
        if !self.io_request.scheduled {
            io::IoRequestLoop::schedule(&mut self.io_request);
        }
    }

    /// Returns a raw `(ptr, len)` into either `stack_buffer` or
    /// `self.buffer`'s spare capacity. Raw (not `&mut [u8]`) so the caller in
    /// `do_read_loop` can carry it across the `&mut self` `do_read` call
    /// without two live `&mut` covering overlapping memory (Stacked-Borrows
    /// UB). The slice is materialised only at the syscall boundary.
    // PORT NOTE: Zig indexed raw ptr range `items.ptr[items.len..capacity]`.
    fn remaining_buffer(&mut self, stack_buffer: &mut [u8]) -> (*mut u8, usize) {
        // `spare_capacity_mut()` is the safe spelling of
        // `as_mut_ptr().add(len) .. as_mut_ptr().add(cap)`; we immediately
        // decay it to a raw `(ptr, len)` so the borrow does not outlive this
        // call (the caller carries the raw pair across `&mut self`).
        let spare = self.buffer.spare_capacity_mut();
        let (ptr, len) = if spare.len() < stack_buffer.len() {
            (stack_buffer.as_mut_ptr(), stack_buffer.len())
        } else {
            (spare.as_mut_ptr().cast::<u8>(), spare.len())
        };
        let cap = len.min((self.max_length.saturating_sub(self.read_off)) as usize);
        (ptr, cap)
    }

    /// `buffer` is passed raw because it may point into `self.buffer`'s spare
    /// capacity; holding it as `&mut [u8]` alongside `&mut self` would be two
    /// live `&mut` to overlapping memory. `do_read` never touches
    /// `self.buffer`, so the disjoint access is sound — we just keep the
    /// pointer raw across the `&mut self` borrow and materialise the slice
    /// only for the syscall.
    pub fn do_read(
        &mut self,
        buffer: (*mut u8, usize),
        read_len: &mut usize,
        retry: &mut bool,
    ) -> bool {
        let result: bun_sys::Result<usize> = 'brk: {
            // SAFETY: `buffer.0` points at either a stack array or this Vec's
            // spare capacity (write-valid via `as_mut_ptr()`); both are
            // exclusively owned by the caller for `buffer.1` bytes and outlive
            // this call. We never access `self.buffer` here, so no aliasing.
            let buf = unsafe { core::slice::from_raw_parts_mut(buffer.0, buffer.1) };
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
                            self.errno = Some(bun_core::errno_to_zig_err(err.errno as i32));
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

    pub fn then(this: Box<Self>, _: &JSGlobalObject) -> jsc::JsTerminatedResult<()> {
        let cb = this.on_complete_callback;
        let cb_ctx = this.on_complete_ctx;

        if this.store.is_none() && this.system_error.is_some() {
            let mut this = this;
            let system_error = this.system_error.take().unwrap();
            drop(this);
            cb(cb_ctx, ReadFileResultType::Err(system_error));
            return Ok(());
        } else if this.store.is_none() {
            drop(this);
            if cfg!(debug_assertions) {
                panic!("assertion failure - store should not be null");
            }
            cb(
                cb_ctx,
                ReadFileResultType::Err(SystemError {
                    code: BunString::static_("INTERNAL_ERROR"),
                    message: BunString::static_("assertion failure - store should not be null"),
                    syscall: BunString::static_("read"),
                    ..Default::default()
                }),
            );
            return Ok(());
        }

        let mut this = this;
        let _store = this.store.take().unwrap();
        // PORT NOTE: reshaped for borrowck — take buffer out so it survives `drop(this)`.
        let buf = core::mem::take(&mut this.buffer);

        // `_store` is dropped at end of scope (= store.deref()).
        let system_error = this.system_error.take();
        let total_size = this.total_size;
        drop(this);

        if let Some(err) = system_error {
            cb(cb_ctx, ReadFileResultType::Err(err));
            return Ok(());
        }

        // Zig hands `buffer.items` as a raw slice with `is_temporary = true`;
        // receiver takes ownership. Normalize to `Box<[u8]>` so every consumer
        // can reclaim via `heap::take` with a matching layout.
        cb(
            cb_ctx,
            ReadFileResultType::Result(ReadFileRead {
                buf: bun_core::heap::into_raw(buf.into_boxed_slice()),
                total_size,
            }),
        );
        Ok(())
    }

    pub fn run(&mut self, task: *mut ReadFileTask) {
        self.run_async(task);
    }

    fn run_async(&mut self, task: *mut ReadFileTask) {
        #[cfg(windows)]
        {
            return; // why
        }
        self.io_task = Some(task);

        if self.file_store.pathlike.is_fd() {
            self.opened_fd = self.file_store.pathlike.fd();
        }

        self.get_fd(Self::run_async_with_fd);
    }

    pub fn is_allowed_to_close(&self) -> bool {
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
                ReadFileTask::on_finish(io_task);
            }
        }
    }

    fn resolve_size_and_last_modified(&mut self, fd: Fd) {
        let stat: Stat = match bun_sys::fstat(fd) {
            Ok(result) => result,
            Err(err) => {
                self.errno = Some(bun_core::errno_to_zig_err(err.errno as i32));
                self.system_error = Some(err.to_system_error().into());
                return;
            }
        };

        if let Some(store) = &self.store {
            if let Data::File(file) = store.data_mut() {
                let mtime = bun_sys::PosixStat::init(&stat).mtime();
                file.last_modified = jsc::to_js_time(mtime.sec as isize, mtime.nsec as isize);
            }
        }

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.errno = Some(bun_core::err!("EISDIR"));
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
            // PORT NOTE: Zig wrote `byte_store = ByteStore.init(buffer.items, …)`
            // (a non-owning view); Rust `Bytes` owns its allocation, so leave it
            // default — `then()` reads `self.buffer` directly.
            self.byte_store = ByteStore::default();

            self.on_finish();
            return;
        }

        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        if !self.could_block || (self.size > 0 && self.size != MAX_SIZE) {
            let want = (self.size as usize).saturating_add(16);
            let mut v = Vec::<u8>::new();
            if v.try_reserve_exact(want).is_err() {
                self.errno = Some(bun_core::err!("OutOfMemory"));
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

    fn do_read_loop_task(task: *mut WorkPoolTask) {
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
        // `&mut self.task` (intrusive) registered in `on_writable`/`init`;
        // recover parent.
        let this = unsafe { &mut *ReadFile::from_task_ptr(task) };

        this.update();
    }

    fn do_read_loop(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        // we hold a 64 KB stack buffer incase the amount of data to
        // be read is greater than the reported amount
        //
        // 64 KB is large, but since this is running in a thread
        // with it's own stack, it should have sufficient space.
        // PORT NOTE: hoisted out of the loop and zero-initialized once — the
        // one-time 64 KB memset is negligible next to the per-iteration
        // syscall, and avoids the `MaybeUninit<u8>` → `&mut [u8]` cast (uninit
        // bytes behind a `&[u8]` is technically UB even when never read).
        let mut stack_buffer = [0u8; 64 * 1024];
        while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
            // PORT NOTE: reshaped for borrowck — keep the read target as a raw
            // (ptr, len) across the `&mut self` `do_read` call; no `&mut [u8]`
            // to `self.buffer`'s spare capacity is ever live alongside
            // `&mut self`.
            let stack_ptr = stack_buffer.as_mut_ptr();
            let (buf_ptr, buf_len) = self.remaining_buffer(&mut stack_buffer);

            if buf_len > 0 && self.errno.is_none() && !self.read_eof {
                let mut read_amount: usize = 0;
                let mut retry = false;
                let continue_reading =
                    self.do_read((buf_ptr, buf_len), &mut read_amount, &mut retry);

                // We might read into the stack buffer, so we need to copy it into the heap.
                if buf_ptr == stack_ptr {
                    // `do_read` wrote `read_amount` initialized bytes at
                    // `stack_buffer[..read_amount]`; the stack array is live
                    // for this iteration.
                    let read = &stack_buffer[..read_amount];
                    if self.buffer.capacity() == 0 {
                        // We need to allocate a new buffer
                        // In this case, we want to use `ensureTotalCapacityPrecise` so that it's an exact amount
                        // We want to avoid over-allocating incase it's a large amount of data sent in a single chunk followed by a 0 byte chunk.
                        self.buffer.reserve_exact(read.len());
                    } else {
                        self.buffer.reserve(read.len());
                    }
                    // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
                    self.buffer.extend_from_slice(read);
                } else {
                    // record the amount of data read
                    // SAFETY: read() wrote `read_amount` initialized bytes into spare capacity.
                    unsafe { bun_core::vec::commit_spare(&mut self.buffer, read_amount) };
                }
                // - If they DID set a max length, we should stop
                //   reading after that.
                //
                // - If they DID NOT set a max_length, then it will
                //   be Blob.max_size which is an impossibly large
                //   amount to read.
                if !self.read_eof && self.buffer.len() >= self.max_length as usize {
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
                    self.wait_for_readable();

                    return;
                }

                // There can be more to read
                continue;
            }

            // -- We are done reading.
            break;
        }

        if self.system_error.is_some() {
            self.buffer = Vec::new(); // clearAndFree
        }

        // If we over-allocated by a lot, we should shrink the buffer to conserve memory.
        if self.buffer.len() + 16_000 < self.buffer.capacity() {
            self.buffer.shrink_to_fit();
        }
        // PORT NOTE: Zig also wrote `byte_store = ByteStore.init(buffer.items, …)` —
        // a non-owning alias of `buffer`. Rust `Bytes` is owning, and `then()`
        // delivers `self.buffer` directly, so skip the alias to avoid a double-free.
        self.on_finish();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFileUV (Windows)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct ReadFileUV<'a> {
    pub loop_: *mut libuv::uv_loop_t,
    pub event_loop: &'a EventLoop,
    pub file_store: FileStore,
    pub byte_store: ByteStore,
    pub store: StoreRef,
    pub offset: SizeType,
    pub max_length: SizeType,
    pub total_size: SizeType,
    pub opened_fd: Fd,
    pub read_len: SizeType,
    pub read_off: SizeType,
    pub read_eof: bool,
    pub size: SizeType,
    pub buffer: Vec<u8>,
    pub system_error: Option<SystemError>,
    pub errno: Option<Error>,
    pub on_complete_data: *mut c_void,
    pub on_complete_fn: ReadFileOnReadFileCallback,
    pub is_regular_file: bool,

    pub req: libuv::fs_t,
    /// Stash for the open completion callback across the libuv async hop
    /// (Zig captured it at comptime in `FileOpener.getFdByOpening`).
    open_callback: fn(&mut Self, Fd),
}

// Zig: `pub const getFd = FileOpener(@This()).getFd;` /
//      `pub const doClose = FileCloser(@This()).doClose;`
#[cfg(windows)]
impl<'a> FileOpener for ReadFileUV<'a> {
    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn set_errno(&mut self, e: bun_core::Error) {
        self.errno = Some(e);
    }
    fn set_system_error(&mut self, e: jsc::SystemError) {
        self.system_error = Some(e);
    }
    fn pathlike(&self) -> &PathOrFileDescriptor {
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
    const IO_TAG: bun_io::Tag = bun_io::Tag::ReadFile;
    fn opened_fd(&self) -> Fd {
        self.opened_fd
    }
    fn set_opened_fd(&mut self, fd: Fd) {
        self.opened_fd = fd;
    }
    fn loop_(&self) -> *mut bun_libuv_sys::uv_loop_t {
        self.loop_
    }

    // Zig `FileCloser` gates the `close_after_io` / `io_request` / `io_poll` /
    // `state` / `task` accesses on `@hasField(This, "io_request")`, which is
    // **false** for `ReadFileUV` (its libuv request field is `req`, not
    // `io_request`). So `do_close` falls straight to the close-fd branch and
    // none of the methods below are ever reached — these mark genuinely dead
    // code paths, not unported stubs.
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
    fn io_poll(&mut self) -> &mut bun_io::Poll {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    fn update(&mut self) {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    fn schedule_close(_: &mut bun_io::Request) -> bun_io::Action<'_> {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
    fn on_close_io_request(_: *mut bun_jsc::WorkPoolTask) {
        unreachable!("@hasField(ReadFileUV, \"io_request\") == false")
    }
}

#[cfg(windows)]
impl<'a> ReadFileUV<'a> {
    /// Typed entry — mirrors Zig `start(event_loop, store, off, max_len,
    /// comptime Handler, handler: *anyopaque)`: caller passes the already-erased
    /// `*anyopaque`; `H` (via turbofish) supplies `Handler.run` through the
    /// `ReadFileUvHandler` blanket impl.
    pub fn start<H>(
        event_loop: *mut EventLoop,
        store: StoreRef,
        off: SizeType,
        max_len: SizeType,
        handler: *mut c_void,
    ) where
        H: ReadFileUvHandler,
    {
        Self::start_with_ctx(
            event_loop,
            store,
            off,
            max_len,
            // Zig: @ptrCast(&Handler.run) — erase the typed handler to the C ABI cb.
            H::run as ReadFileOnReadFileCallback,
            handler,
        )
    }

    /// Raw entry — caller already has the type-erased `(fn, *anyopaque)` pair
    /// (Zig `NewInternalReadFileHandler` path). Shares the body with `start`.
    pub fn start_with_ctx(
        event_loop: *mut EventLoop,
        store: StoreRef,
        off: SizeType,
        max_len: SizeType,
        on_complete_fn: ReadFileOnReadFileCallback,
        handler: *mut c_void,
    ) {
        log!("ReadFileUV.start");
        // SAFETY: `event_loop` is the per-thread `EventLoop` singleton owned by
        // the VM (`global.bun_vm().event_loop()`); it strictly outlives this
        // async op, which additionally pins it via `ref_concurrently()` below.
        let event_loop: &'a EventLoop = unsafe { &*event_loop };
        let file_store = store.data.as_file().clone();
        let this = Box::new(ReadFileUV {
            // Zig: `event_loop.virtual_machine.uvLoop()` — projected through the
            // helper to avoid materializing a `&VirtualMachine`.
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
            on_complete_data: handler,
            on_complete_fn,
            is_regular_file: false,
            req: bun_core::ffi::zeroed(),
            open_callback: Self::on_file_open,
        });
        // Keep the event loop alive while the async operation is pending
        event_loop.ref_concurrently();
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

        let cb = this_box.on_complete_fn;
        let cb_ctx = this_box.on_complete_data;

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
                total_size: this_box.total_size,
            })
        };

        // Zig order: cb() runs BEFORE the defer block (store.deref / req.deinit /
        // bun.destroy / event_loop.unref). Preserve that — cb may inspect store.
        cb(cb_ctx, result);

        // Zig defer block — store.deref runs via StoreRef's Drop when the Box drops.
        this_box.req.deinit();
        drop(this_box);
        // Release the event loop reference now that we're done
        event_loop.unref_concurrently();
        log!("ReadFileUV.finalize destroy");
    }

    pub fn is_allowed_to_close(&self) -> bool {
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

    pub fn on_file_open(&mut self, opened_fd: Fd) {
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
        if let Some(errno) = rc.err_enum_e() {
            self.errno = Some(bun_core::errno_to_zig_err(errno as i32));
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
        if let Some(errno) = this.req.result.err_enum_e() {
            this.errno = Some(bun_core::errno_to_zig_err(errno as i32));
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
        if let Data::File(file) = this.store.data_mut() {
            // `uv_timespec_t` fields are `c_long` (i32 on Windows); widen to the
            // platform-width `isize` `to_js_time` expects.
            file.last_modified =
                jsc::to_js_time(stat.mtime().sec as isize, stat.mtime().nsec as isize);
        }

        if bun_sys::S::ISDIR(u32::try_from(stat.mode()).expect("int cast")) {
            this.errno = Some(bun_core::err!("EISDIR"));
            this.system_error = Some(SystemError {
                code: BunString::static_("EISDIR"),
                path: if this.file_store.pathlike.is_path() {
                    BunString::clone_utf8(this.file_store.pathlike.path().slice())
                } else {
                    BunString::EMPTY
                },
                message: BunString::static_("Directories cannot be read like files"),
                syscall: BunString::static_("read"),
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
            // Zig: `ByteStore.init(this.buffer.items, ..)` — buffer is empty here,
            // so move it (Vec<u8>) into the owning ByteStore rather than borrow.
            this.byte_store = ByteStore::init(core::mem::take(&mut this.buffer));
            this.on_finish();
            return;
        }
        // Out of memory we can't read more than 4GB at a time (ULONG) on Windows
        if this.size as usize > bun_sys::windows::ULONG::MAX as usize {
            this.errno = Some(bun_core::errno_to_zig_err(bun_sys::E::NOMEM as i32));
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
            this.errno = Some(bun_core::err!("OutOfMemory"));
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

    pub fn queue_read(&mut self) {
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
                    self.errno = Some(bun_core::err!("OutOfMemory"));
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
            if let Some(errno) = res.err_enum_e() {
                self.errno = Some(bun_core::errno_to_zig_err(errno as i32));
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
            // PORT NOTE: Vec::into_boxed_slice cannot fail; Zig caught OOM here.
            self.byte_store = ByteStore::init_owned(owned);
            self.on_finish();
        }
    }

    pub extern "C" fn on_read(req: *mut libuv::fs_t) {
        // SAFETY: req.data was set to *mut Self in queue_read().
        let this: &mut ReadFileUV = unsafe { bun_ptr::callback_ctx::<ReadFileUV>((*req).data) };

        // `req` aliases `this.req`; once `&mut ReadFileUV` exists, going through the
        // raw `req` pointer would violate Stacked Borrows. Read via `this.req` instead.
        let result = this.req.result;

        if let Some(errno) = result.err_enum_e() {
            this.errno = Some(bun_core::errno_to_zig_err(errno as i32));
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
            // PORT NOTE: Vec::into_boxed_slice cannot fail; Zig caught OOM here.
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

/// Trait modeling the `comptime Handler: type` parameter of `ReadFileUV.start`.
/// Zig `@ptrCast(&Handler.run)` erases the typed ctx to `*anyopaque`; here the
/// implementor supplies the already-erased thunk.
pub trait ReadFileUvHandler {
    fn run(ctx: *mut c_void, bytes: ReadFileResultType);
}

/// Any `ReadFileCompletion` is usable as a `ReadFileUV` handler — the libuv
/// path stores the same `(ctx, run)` pair, just without the JSTerminated
/// return (Zig swallowed it via `catch {}` in the POSIX path; the UV path's
/// `Handler.run` is `void`-returning by contract).
impl<C: ReadFileCompletion> ReadFileUvHandler for C {
    fn run(ctx: *mut c_void, bytes: ReadFileResultType) {
        let _ = <C as ReadFileCompletion>::run(ctx.cast::<C>(), bytes);
    }
}

// ported from: src/runtime/webcore/blob/read_file.zig
