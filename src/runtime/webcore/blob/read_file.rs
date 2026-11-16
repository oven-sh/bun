use core::marker::PhantomData;
use core::mem::MaybeUninit;

use scopeguard::ScopeGuard;

#[cfg(not(windows))]
use crate::Error;
#[cfg(windows)]
use crate::node::types::PathLikeExt as _;
#[cfg(not(windows))]
use crate::webcore::blob::io_parking::{IoParking, IoState, Parkable};
#[cfg(not(windows))]
use crate::webcore::blob::store::File as FileStore;
use crate::webcore::blob::{Blob, MAX_SIZE, SizeType, Store};
#[cfg(not(windows))]
use crate::webcore::blob::{ClosingState, FileOpener};
#[cfg(not(windows))]
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_core::String as BunString;
#[cfg(not(windows))]
use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};
#[cfg(not(windows))]
use bun_io as io;
#[cfg(windows)]
use bun_io::IntrusiveUvFs as _;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, SystemError};
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(not(windows))]
use bun_sys::Stat;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd};
#[cfg(not(windows))]
use bun_threading::{Link, OwnedQueue, OwnedTaskIn, WorkPoolTask};

#[cfg(windows)]
bun_output::declare_scope!(ReadFile, hidden);

#[cfg(windows)]
macro_rules! log {
    ($($t:tt)*) => { bun_output::scoped_log!(ReadFile, $($t)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// NewReadFileHandler
// ──────────────────────────────────────────────────────────────────────────

/// `F` provides the callback that converts the read bytes to a JSValue.
/// Modelled as a trait so each instantiation monomorphizes.
pub(crate) trait ReadFileToJs {
    fn from_owned(b: &Blob, g: &JSGlobalObject, by: Vec<u8>) -> JsResult<JSValue>;
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
        let promise = promise.swap(global_this);
        match maybe_bytes {
            ReadFileResultType::Result(result) => {
                let bytes = result.buf;
                if blob.size.get() > 0 {
                    blob.size
                        .set((bytes.len() as SizeType).min(blob.size.get()));
                }
                // The `#[track_caller]` `to_js_host_call` inside `JSPromise::settle_with`
                // provides the source-location/exception-scope behaviour.
                promise.settle_with(global_this, move |g| {
                    F::from_owned(&blob, g, bytes.into_vec())
                })?;
            }
            ReadFileResultType::Err(err) => {
                let val = err.to_error_instance_with_async_stack(global_this, &promise);
                promise.reject(global_this, Ok(val))?;
            }
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Type aliases / result types
// ──────────────────────────────────────────────────────────────────────────

/// What a `ReadFile`/`ReadFileUV` does with the bytes (or the lack of them): `run` on completion,
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
#[cfg(not(windows))]
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

fn path_for_error(store: &Store) -> BunString {
    store
        .get_path()
        .map_or(BunString::EMPTY, BunString::clone_utf8)
}

/// The owner of a `ReadFile` that has left the JS thread.
#[cfg(not(windows))]
pub(crate) type ReadFileTask = bun_jsc::Completion<ReadFile>;

#[cfg(not(windows))]
impl bun_jsc::OwnedJobContext for ReadFile {
    const CANCELLABLE: bool = true;
    type OffThread = Self;
    /// Where the bytes go: completed by `then`, or cancelled (its `Drop`) when the job comes
    /// back to a VM that is no longer running script and is released unrun.
    type Js = PendingReadFileCompletion;
    type Shared = IoParking;
    fn run(mut this: ReadFileTask) {
        let fd = this.get_fd();
        Self::run_async_with_fd(this, fd);
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
    fn cancel(parking: &IoParking) {
        parking.cancel();
    }
}

#[cfg(not(windows))]
impl ReadFile {
    /// JS thread: hand a prepared `ReadFile` and what to do with its bytes to the work pool (the
    /// job is its one heap allocation).
    pub(crate) fn schedule(
        this: ReadFile,
        completion: Box<dyn ReadFileCompletion>,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        bun_jsc::Job::<ReadFile>::schedule(cx, this, PendingReadFileCompletion::new(completion));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) struct ReadFile {
    pub(crate) store: RefPtr<Store>,
    /// What the store had cached when the read was asked for.
    cached_mode: bun_sys::Mode,
    pub offset: SizeType,
    pub(crate) max_length: SizeType,
    pub(crate) total_size: SizeType,
    pub(crate) opened_fd: Fd,
    pub(crate) read_eof: bool,
    pub(crate) size: SizeType,
    pub(crate) buffer: Vec<u8>,
    pub task: WorkPoolTask,
    pub(crate) system_error: Option<SystemError>,
    pub(crate) errno: Option<Error>,
    next: Link<ReadFile>,
    io: IoState,
    pub(crate) could_block: bool,
}

#[cfg(not(windows))]
bun_threading::intrusive_work_task!(ReadFile, task);
#[cfg(not(windows))]
bun_core::intrusive_field!(ReadFile, next: Link<ReadFile>);

// The default methods on the FileOpener trait provide the bodies.
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
    fn pathlike(&self) -> PathOrFileDescriptor<'_> {
        self.file().pathlike()
    }
}

#[cfg(not(windows))]
impl Parkable for ReadFile {
    const IO_TAG: io::Tag = io::Tag::ReadFile;
    const SYSCALL: bun_sys::Tag = bun_sys::Tag::read;

    fn pending() -> &'static OwnedQueue<ReadFileTask> {
        static PENDING: OwnedQueue<ReadFileTask> = OwnedQueue::new();
        &PENDING
    }
    fn io_mut(&mut self) -> &mut IoState {
        &mut self.io
    }
    fn is_allowed_to_close(&self) -> bool {
        self.file().path().is_some()
    }
}

#[cfg(not(windows))]
impl OwnedTaskIn<ReadFileTask> for ReadFile {
    fn run(this: ReadFileTask) {
        if this.io.state == ClosingState::Closing {
            Self::on_finish(this);
        } else {
            Self::do_read_loop(this);
        }
    }
}

#[cfg(not(windows))]
impl ReadFile {
    pub(crate) fn create(blob: &Blob) -> ReadFile {
        let store = blob.store().expect("infallible: store present").clone();
        ReadFile {
            cached_mode: store.data.as_file().mode(),
            store,
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            total_size: MAX_SIZE,
            opened_fd: Fd::INVALID,
            read_eof: false,
            size: 0,
            buffer: Vec::new(),
            task: WorkPoolTask::default(),
            system_error: None,
            errno: None,
            next: Link::new(),
            io: IoState::default(),
            could_block: false,
        }
    }

    fn file(&self) -> &FileStore {
        self.store.data.as_file()
    }

    /// Never touches `self.buffer`; the caller moves it out for the duration.
    fn do_read(&mut self, buf: BorrowedCursor<'_, u8>, retry: &mut bool) -> bool {
        let result: bun_sys::Result<usize> = 'brk: {
            if bun_sys::S::ISSOCK(self.cached_mode) {
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
                                    path_for_error(&self.store);
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
        completion: PendingReadFileCompletion,
        _: &JSGlobalObject,
    ) -> JsResult<()> {
        let mut this = this;

        // reshaped for borrowck — take buffer out so it survives `drop(this)`.
        let buf = core::mem::take(&mut this.buffer);
        let system_error = this.system_error.take();
        drop(this);

        if let Some(err) = system_error {
            return completion.complete(ReadFileResultType::Err(err));
        }

        completion.complete(ReadFileResultType::Result(ReadFileRead {
            buf: buf.into_boxed_slice(),
        }))
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

        self.file()
            .set_last_modified(super::stat_to_js_mtime(&stat));

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.errno = Some(crate::Error::Sys(bun_errno::SystemErrno::EISDIR));
            self.system_error = Some(SystemError {
                code: BunString::static_("EISDIR"),
                path: path_for_error(&self.store),
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

    fn run_async_with_fd(mut this: ReadFileTask, fd: Fd) {
        if this.errno.is_some() {
            Self::on_finish(this);
            return;
        }

        this.resolve_size_and_last_modified(fd);
        if this.errno.is_some() {
            return Self::on_finish(this);
        }

        // Special files might report a size of > 0, and be wrong.
        // so we should check specifically that its a regular file before trusting the size.
        if this.size == 0 && bun_sys::is_regular_file(this.cached_mode) {
            this.buffer = Vec::new();

            Self::on_finish(this);
            return;
        }

        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        if !this.could_block || (this.size > 0 && this.size != MAX_SIZE) {
            let want = (this.size as usize).saturating_add(16);
            let mut v = Vec::<u8>::new();
            if v.try_reserve_exact(want).is_err() {
                this.errno = Some(crate::Error::Alloc(bun_alloc::AllocError));
                this.system_error = Some(
                    bun_sys::Error::from_code(bun_sys::E::ENOMEM, bun_sys::Tag::read)
                        .to_system_error()
                        .into(),
                );
                Self::on_finish(this);
                return;
            }
            this.buffer = v;
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
        if this.could_block {
            if bun_core::is_readable(fd) == bun_core::Pollable::NotReady {
                Self::wait_for_io(this);
                return;
            }
        }

        Self::do_read_loop(this);
    }

    fn do_read_loop(mut this: ReadFileTask) {
        // we hold a 64 KB stack buffer incase the amount of data to
        // be read is greater than the reported amount
        //
        // 64 KB is large, but since this is running in a thread
        // with it's own stack, it should have sufficient space.
        let mut stack_buffer = [const { MaybeUninit::uninit() }; 64 * 1024];
        let mut buffer = core::mem::take(&mut this.buffer);
        while this.io.state == ClosingState::Running {
            let max = (this.max_length as usize).saturating_sub(buffer.len());

            if max != 0 && this.errno.is_none() && !this.read_eof {
                let mut retry = false;
                let continue_reading = if buffer.capacity() - buffer.len() >= stack_buffer.len() {
                    append_with(&mut buffer, max, |spare| this.do_read(spare, &mut retry))
                } else {
                    let len = stack_buffer.len().min(max);
                    let mut read = BorrowedBuf::from(&mut stack_buffer[..len]);
                    let continue_reading = this.do_read(read.unfilled(), &mut retry);
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
                if !this.read_eof && buffer.len() >= this.max_length as usize {
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
                    || (this.could_block
                        // If we received EOF, we can skip the poll() system
                        // call. We already know it's done.
                        && !this.read_eof)
                {
                    if this.could_block
                        // If we received EOF, we can skip the poll() system
                        // call. We already know it's done.
                        && !this.read_eof
                    {
                        match bun_core::is_readable(this.opened_fd) {
                            bun_core::Pollable::NotReady => {}
                            bun_core::Pollable::Ready | bun_core::Pollable::Hup => continue,
                        }
                    }
                    this.read_eof = false;
                    this.buffer = buffer;
                    Self::wait_for_io(this);

                    return;
                }

                // There can be more to read
                continue;
            }

            // -- We are done reading.
            break;
        }
        this.buffer = buffer;

        if this.system_error.is_some() {
            this.buffer = Vec::new(); // clearAndFree
        }

        // If we over-allocated by a lot, we should shrink the buffer to conserve memory.
        if this.buffer.len() + 16_000 < this.buffer.capacity() {
            this.buffer.shrink_to_fit();
        }
        Self::on_finish(this);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFileUV (Windows)
// ──────────────────────────────────────────────────────────────────────────

/// One owner at a time: a `Box` here, or libuv while it works for it.
#[cfg(windows)]
pub(crate) struct ReadFileUV {
    pub(crate) loop_: &'static libuv::uv_loop_t,
    _keep_alive: bun_io::JsKeepAlive,
    pub(crate) store: RefPtr<Store>,
    pub offset: SizeType,
    pub(crate) max_length: SizeType,
    pub(crate) opened_fd: Fd,
    pub(crate) read_off: SizeType,
    pub(crate) buffer: Vec<u8>,
    pub(crate) system_error: Option<SystemError>,
    /// `Some` until the read completes; a `ReadFileUV` dropped before that cancels it.
    pub(crate) completion: Option<PendingReadFileCompletion>,
    pub(crate) is_regular_file: bool,
    /// The context of the script that asked for the read.
    pub(crate) context: jsc::ContextId,

    pub(crate) req: libuv::fs_t,
}

#[cfg(windows)]
bun_io::intrusive_uv_fs!(ReadFileUV, req);

#[cfg(windows)]
impl ReadFileUV {
    pub(crate) fn start(
        blob: &Blob,
        completion: Box<dyn ReadFileCompletion>,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        log!("ReadFileUV.start");
        let store = blob.store().expect("infallible: store present").clone();
        let mut this = Box::new(ReadFileUV {
            loop_: cx.global().bun_vm().event_loop().uv_loop(),
            _keep_alive: bun_io::JsKeepAlive::active(),
            store, // store.ref() — Arc clone owned here
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            opened_fd: Fd::INVALID,
            read_off: 0,
            buffer: Vec::new(),
            system_error: None,
            completion: Some(PendingReadFileCompletion::new(completion)),
            is_regular_file: false,
            context: cx.context().id(),
            req: bun_core::ffi::zeroed(),
        });
        // A request that libuv refuses completes inside this call: the checkpoint is the caller's.
        let _caller =
            jsc::virtual_machine::VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
        if let Some(fd) = this.store.data.as_file().fd() {
            this.opened_fd = fd;
            this.queue_stat();
        } else {
            this.open();
        }
    }

    fn open(self: Box<Self>) {
        let mut buf = bun_paths::path_buffer_pool::get();
        let file = self.store.data.as_file();
        let path = file.pathlike().path().slice_z(&mut buf).as_ptr();

        let loop_ = self.loop_;
        let this = bun_core::heap::into_raw(self);
        // SAFETY: the VM's loop outlives the request, libuv copies the NUL-terminated path before
        // it returns, and it has `this` until `on_open`.
        let rc = unsafe {
            libuv::uv_fs_open(
                loop_,
                &raw mut (*this).req,
                path,
                bun_sys::O::RDONLY | bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC,
                crate::node::fs::DEFAULT_PERMISSION as i32,
                Some(Self::on_open),
            )
        };
        if let Some(errno) = rc.errno() {
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.on_open_error(errno);
        }
    }

    extern "C" fn on_open(req: *mut libuv::fs_t) {
        // SAFETY: `req` is that of the box that `open` left to libuv.
        let mut this = unsafe { Self::take_from_uv_fs(req) };

        let result = this.req.result;
        if let Some(errno) = result.errno() {
            this.on_open_error(errno);
            return;
        }

        this.opened_fd = Fd::from_uv(result.to_fd());
        this.queue_stat();
    }

    fn on_open_error(mut self: Box<Self>, errno: bun_sys::E) {
        let pathlike = self.store.data.as_file().pathlike();
        let path = pathlike.path();
        let err = crate::node::fs::error_for_caller(
            [Some(path), None],
            bun_sys::Error::from_code(errno, bun_sys::Tag::open).with_path(path.slice()),
        );
        self.system_error = Some(err.to_system_error().into());
        self.on_finish();
    }

    fn finalize(mut self: Box<Self>) {
        log!("ReadFileUV.finalize");

        let completion = self.completion.take().expect("a ReadFileUV completes once");
        let vm = jsc::virtual_machine::VirtualMachine::get();
        let _context = vm.enter_context(self.context);
        let _scope = vm.enter_event_loop_scope();

        let result = if let Some(err) = self.system_error.take() {
            ReadFileResultType::Err(err)
        } else {
            let boxed = core::mem::take(&mut self.buffer).into_boxed_slice();
            ReadFileResultType::Result(ReadFileRead { buf: boxed })
        };

        // The completion must run BEFORE the cleanup below (store deref /
        // box drop / keep-alive) — it may inspect store. A libuv callback returns void: an
        // exception the JS side left pending is reported here (a termination just stands down).
        crate::dispatch::fold(completion.complete(result));

        drop(self);
        log!("ReadFileUV.finalize destroy");
    }

    fn on_finish(self: Box<Self>) {
        log!("ReadFileUV.onFinish");
        let fd = self.opened_fd;
        if self.store.data.as_file().path().is_some()
            && fd != Fd::INVALID
            && fd.stdio_tag().is_none()
        {
            bun_io::Closer::close(fd, self.loop_);
        }

        self.finalize();
    }

    fn on_error(mut self: Box<Self>, errno: bun_sys::E, syscall: bun_sys::Tag) {
        let err = bun_sys::Error::from_code(errno, syscall);
        self.system_error = Some(err.to_system_error().into());
        self.on_finish();
    }

    fn queue_stat(mut self: Box<Self>) {
        log!("ReadFileUV.queueStat");
        self.req.deinit();

        let (loop_, fd) = (self.loop_, self.opened_fd.uv());
        let this = bun_core::heap::into_raw(self);
        // SAFETY: the VM's loop outlives the request, and libuv has `this` until
        // `on_file_initial_stat`.
        let rc = unsafe {
            libuv::uv_fs_fstat(
                loop_,
                &raw mut (*this).req,
                fd,
                Some(Self::on_file_initial_stat),
            )
        };
        if let Some(errno) = rc.errno() {
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.on_error(errno, bun_sys::Tag::fstat);
        }
    }

    extern "C" fn on_file_initial_stat(req: *mut libuv::fs_t) {
        log!("ReadFileUV.onFileInitialStat");
        // SAFETY: `req` is that of the box that `queue_stat` left to libuv.
        let mut this = unsafe { Self::take_from_uv_fs(req) };

        if let Some(errno) = this.req.result.errno() {
            this.on_error(errno, bun_sys::Tag::fstat);
            return;
        }

        let stat = this.req.statbuf;

        // keep in sync with resolveSizeAndLastModified
        let file = this.store.data.as_file();
        file.set_last_modified(super::stat_to_js_mtime(&stat));

        if bun_sys::S::ISDIR(u32::try_from(stat.mode()).expect("int cast")) {
            this.system_error = Some(SystemError {
                code: BunString::static_("EISDIR").into(),
                path: path_for_error(&this.store).into(),
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
        let total_size = stat.size().min(MAX_SIZE as u64) as SizeType;
        this.is_regular_file = bun_sys::is_regular_file(stat.mode() as bun_sys::Mode);

        log!("is_regular_file: {}", this.is_regular_file);

        let size = if stat.size() > 0 && this.is_regular_file {
            total_size.min(this.max_length)
        } else if stat.size() == 0 && !this.is_regular_file {
            // Up to 4k at a time if no size was set and this is not a regular file.
            this.max_length.min(4096)
        } else {
            0
        };

        if this.offset > 0 {
            // We DO support offset in Bun.file()
            match bun_sys::set_file_offset(this.opened_fd, this.offset) {
                // we ignore errors because it should continue to work even if its a pipe
                Err(_) | Ok(_) => {}
            }
        }

        // Special files might report a size of > 0, and be wrong.
        // so we should check specifically that its a regular file before trusting the size.
        if size == 0 && this.is_regular_file {
            this.on_finish();
            return;
        }
        // Out of memory we can't read more than 4GB at a time (ULONG) on Windows
        if size as usize > bun_sys::windows::ULONG::MAX as usize {
            this.on_error(bun_sys::E::NOMEM, bun_sys::Tag::read);
            return;
        }
        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        let want = ((size as usize).saturating_add(16)).min(bun_sys::windows::ULONG::MAX as usize);
        if this.buffer.try_reserve_exact(want).is_err() {
            this.on_error(bun_sys::E::NOMEM, bun_sys::Tag::read);
            return;
        }

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

    fn queue_read(mut self: Box<Self>) {
        // if not a regular file, buffer capacity is arbitrary, and running out doesn't mean we're
        // at the end of the file
        if !self.remaining_buffer().is_empty() || !self.is_regular_file {
            log!(
                "ReadFileUV.queueRead - this.remainingBuffer().len = {}",
                self.remaining_buffer().len()
            );

            if !self.is_regular_file {
                // non-regular files have variable sizes, so we always ensure
                // theres at least 4096 bytes of free space. there has already
                // been an initial allocation done for us
                if self.buffer.try_reserve(4096).is_err() {
                    self.on_error(bun_sys::E::NOMEM, bun_sys::Tag::read);
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
            let position = i64::try_from(self.offset + self.read_off).expect("int cast");

            let (loop_, fd) = (self.loop_, self.opened_fd.uv());
            let this = bun_core::heap::into_raw(self);
            // SAFETY: the VM's loop outlives the request, libuv copies `bufs` before it returns, and
            // it has `this`, whose `buffer` has the spare capacity they name, until `on_read`.
            let rc = unsafe {
                libuv::uv_fs_read(
                    loop_,
                    &raw mut (*this).req,
                    fd,
                    bufs.as_mut_ptr(),
                    bufs.len() as u32,
                    position,
                    Some(Self::on_read),
                )
            };
            if let Some(errno) = rc.errno() {
                // SAFETY: libuv keeps nothing of a request that it refuses.
                unsafe { bun_core::heap::take(this) }.on_error(errno, bun_sys::Tag::read);
            }
        } else {
            log!("ReadFileUV.queueRead done");

            // We are done reading.
            self.on_finish();
        }
    }

    extern "C" fn on_read(req: *mut libuv::fs_t) {
        // SAFETY: `req` is that of the box that `queue_read` left to libuv.
        let mut this = unsafe { Self::take_from_uv_fs(req) };

        let result = this.req.result;

        if let Some(errno) = result.errno() {
            this.on_error(errno, bun_sys::Tag::read);
            return;
        }

        if result.int() == 0 {
            // We are done reading.
            this.on_finish();
            return;
        }

        this.read_off += SizeType::try_from(result.int()).expect("int cast");
        // SAFETY: libuv wrote result.int() bytes into remaining_buffer()'s spare slice.
        unsafe {
            bun_core::vec::commit_spare(
                &mut this.buffer,
                usize::try_from(result.int()).expect("int cast"),
            )
        };

        this.req.deinit();
        this.queue_read();
    }
}
