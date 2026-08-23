use core::marker::PhantomData;
#[cfg(not(windows))]
use core::mem::MaybeUninit;
use core::sync::atomic::AtomicU8;
#[cfg(not(windows))]
use core::sync::atomic::Ordering;

use crate::Error;
#[cfg(not(windows))]
use crate::webcore::blob::ClosingState;
use crate::webcore::blob::store::{Data, File as FileStore};
use crate::webcore::blob::{Blob, MAX_SIZE, SizeType, SourceBytes, Store};
#[cfg(not(windows))]
use crate::webcore::blob::{FileCloser, FileOpener};
use bun_core::String as BunString;
use bun_io as io;
#[cfg(windows)]
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
    fn call(b: &Blob, g: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue>;
}

/// Settles `promise` with `F(bytes)` once a file read finishes.
pub struct NewReadFileHandler<F: ReadFileToJs> {
    pub(crate) context: Blob,
    pub(crate) promise: JSPromiseStrong,
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    _f: PhantomData<F>,
}

impl<F: ReadFileToJs> NewReadFileHandler<F> {
    pub(crate) fn new(context: Blob, global_this: &JSGlobalObject) -> Self {
        Self {
            context,
            promise: JSPromiseStrong::init(global_this),
            global_this: bun_ptr::BackRef::new(global_this),
            _f: PhantomData,
        }
    }
}

/// Where a file read's bytes (or error) go, on the JS thread. Exactly one of
/// `run`/`cancel` is called, once.
pub trait ReadFileCompletion {
    fn run(self: Box<Self>, bytes: ReadFileResultType) -> JsResult<()>;
    /// The read will never complete (its VM stopped before it did).
    fn cancel(self: Box<Self>) {}
}

impl<F: ReadFileToJs> ReadFileCompletion for NewReadFileHandler<F> {
    fn run(self: Box<Self>, maybe_bytes: ReadFileResultType) -> JsResult<()> {
        let Self {
            context: blob,
            mut promise,
            global_this,
            ..
        } = *self;
        let global_this = global_this.get();
        // `swap()` releases the Strong's root; the promise cell stays alive on
        // the stack below.
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
                AnyPromise::Normal(promise).wrap(global_this, move |g| {
                    F::call(&blob, g, SourceBytes::Temporary(bytes))
                })?;
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

/// A `ReadFile`'s (or `ReadFileUV`'s) JS side: what to do with the bytes,
/// completed by `then`, or cancelled when dropped uncompleted (the job came
/// back to a VM that is no longer running script).
#[derive(bun_jsc::JsAffine)]
pub struct ReadFileOnDone(Option<jsc::job::JsCallback<dyn ReadFileCompletion>>);

impl ReadFileOnDone {
    pub fn new<C: ReadFileCompletion + 'static>(completion: C) -> Self {
        Self(Some(jsc::job::JsCallback(Box::new(completion))))
    }

    fn complete(mut self, bytes: ReadFileResultType) -> JsResult<()> {
        let completion = self.0.take().expect("a read completes once");
        completion.0.run(bytes)
    }
}

impl Drop for ReadFileOnDone {
    fn drop(&mut self) {
        if let Some(completion) = self.0.take() {
            completion.0.cancel();
        }
    }
}

pub struct ReadFileRead {
    /// The producer's read buffer, handed over whole.
    pub(crate) buf: Box<[u8]>,
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
    type Js = ReadFileOnDone;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        // Starts the read; finishes from the io loop via the token.
        this.run(done);
        None
    }
    fn then(this: Self, on_done: ReadFileOnDone, cx: &bun_jsc::JsThread<'_>) -> jsc::JsResult<()> {
        ReadFile::then(this, on_done, cx.global())
    }
}

#[cfg(not(windows))]
impl ReadFile {
    /// JS thread: hand a prepared `ReadFile` and what to do with its bytes to the work pool (the
    /// job is its one heap allocation).
    pub(crate) fn schedule(this: ReadFile, on_done: ReadFileOnDone, global: &JSGlobalObject) {
        bun_jsc::Job::<ReadFile>::schedule(&global.js_thread(), this, on_done);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

#[cfg_attr(windows, allow(dead_code))] // Windows reads go through `ReadFileUV`
pub struct ReadFile {
    /// The file store being read (a `Data::File`); its `File` is
    /// [`file_store`](Self::file_store).
    pub(crate) store: RefPtr<Store>,
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
    fn pathlike(&self) -> &crate::webcore::node_types::PathOrFileDescriptor<'static> {
        &self.file_store().pathlike
    }
}

#[cfg(not(windows))]
crate::webcore::blob::impl_file_closer!(ReadFile);

impl ReadFile {
    #[cfg(not(windows))]
    #[inline]
    pub(crate) fn file_store(&self) -> &FileStore {
        self.store.data.as_file()
    }

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
    pub(crate) fn create(store: RefPtr<Store>, off: SizeType, max_len: SizeType) -> ReadFile {
        // store.ref() — `RefPtr<Store>` carries the +1; held in `self.store`.
        ReadFile {
            store,
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
        }
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

    /// One `read()`/`recv()` into `target`: `buffer`'s spare capacity, or
    /// `stack` when that is the roomier of the two — capped by
    /// `max_length - read_off`. Returns the byte count (`0` with
    /// `*retry == true` when a non-blocking source had nothing yet) or `None`
    /// after recording the error. Never touches `self.buffer`; the caller
    /// moves it out for the duration.
    #[cfg(not(windows))]
    fn do_read(
        &mut self,
        buffer: &mut Vec<u8>,
        stack: &mut [MaybeUninit<u8>],
        retry: &mut bool,
    ) -> Option<usize> {
        let cap = (self.max_length.saturating_sub(self.read_off)) as usize;
        let is_socket = bun_sys::S::ISSOCK(self.file_store().mode);
        let result: bun_sys::Result<usize> = if buffer.spare_capacity_mut().len() < stack.len() {
            let room = stack.len().min(cap);
            let stack = &mut stack[..room];
            let filled = if is_socket {
                bun_sys::recv_non_block_uninit(self.opened_fd, stack)
            } else {
                bun_sys::read_uninit(self.opened_fd, stack)
            };
            // We read into the stack buffer, so we need to copy it into the heap.
            filled.map(|read| {
                if buffer.capacity() == 0 {
                    // We need to allocate a new buffer
                    // In this case, we want to use `ensureTotalCapacityPrecise` so that it's an exact amount
                    // We want to avoid over-allocating incase it's a large amount of data sent in a single chunk followed by a 0 byte chunk.
                    buffer.reserve_exact(read.len());
                } else {
                    buffer.reserve(read.len());
                }
                buffer.extend_from_slice(read);
                read.len()
            })
        } else if is_socket {
            bun_sys::recv_non_block_to_spare(self.opened_fd, buffer, cap)
        } else {
            bun_sys::read_to_spare(self.opened_fd, buffer, cap)
        };

        loop {
            match &result {
                Ok(res) => {
                    self.read_eof = *res == 0;
                    return Some(*res);
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
                            return Some(0);
                        }
                        _ => {
                            self.errno = Some(bun_errno::from_errno(err.errno as i32).into());
                            self.system_error = Some(err.to_system_error().into());
                            if self.system_error.as_ref().unwrap().path.is_empty() {
                                let path = if self.file_store().pathlike.is_path() {
                                    BunString::clone_utf8(self.file_store().pathlike.path().slice())
                                } else {
                                    BunString::EMPTY
                                };
                                self.system_error.as_mut().unwrap().path = path;
                            }
                            return None;
                        }
                    }
                }
            }
        }
    }

    pub(crate) fn then(this: Self, on_done: ReadFileOnDone, _: &JSGlobalObject) -> JsResult<()> {
        let mut this = this;
        // reshaped for borrowck — take buffer out so it survives `drop(this)`.
        let buf = core::mem::take(&mut this.buffer);
        let system_error = this.system_error.take();
        // Held across the completion (it may inspect the store); released after.
        let _store = this.store.clone();
        drop(this);

        if let Some(err) = system_error {
            return on_done.complete(ReadFileResultType::Err(err));
        }

        on_done.complete(ReadFileResultType::Result(ReadFileRead {
            buf: buf.into_boxed_slice(),
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

            if self.file_store().pathlike.is_fd() {
                self.opened_fd = self.file_store().pathlike.fd();
            }

            self.get_fd(Self::run_async_with_fd);
        }
    }

    #[cfg(not(windows))]
    pub(crate) fn is_allowed_to_close(&self) -> bool {
        self.file_store().pathlike.is_path()
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

        if let Data::File(file) = Store::data_mut(&self.store) {
            let mtime = bun_sys::PosixStat::init(&stat).mtime();
            file.last_modified = jsc::to_js_time(mtime.sec as isize, mtime.nsec as isize);
        }

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.errno = Some(crate::Error::Sys(bun_errno::SystemErrno::EISDIR));
            self.system_error = Some(SystemError {
                code: BunString::static_("EISDIR"),
                path: if self.file_store().pathlike.is_path() {
                    BunString::clone_utf8(self.file_store().pathlike.path().slice())
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
        if self.size == 0 && bun_sys::is_regular_file(self.file_store().mode) {
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
        // we hold a 64 KB stack buffer incase the amount of data to
        // be read is greater than the reported amount
        //
        // 64 KB is large, but since this is running in a thread
        // with it's own stack, it should have sufficient space.
        let mut stack_buffer = [MaybeUninit::<u8>::uninit(); 64 * 1024];
        // `do_read` appends to the buffer it is handed; move ours out so it
        // can sit beside `&mut self`.
        let mut buffer = core::mem::take(&mut self.buffer);
        while self.state.load(Ordering::Relaxed) == ClosingState::Running as u8 {
            let room = (self.max_length.saturating_sub(self.read_off) as usize)
                .min(buffer.spare_capacity_mut().len().max(stack_buffer.len()));

            if room > 0 && self.errno.is_none() && !self.read_eof {
                let mut retry = false;
                let read = self.do_read(&mut buffer, &mut stack_buffer, &mut retry);

                // - If they DID set a max length, we should stop
                //   reading after that.
                //
                // - If they DID NOT set a max_length, then it will
                //   be Blob.max_size which is an impossibly large
                //   amount to read.
                if !self.read_eof && buffer.len() >= self.max_length as usize {
                    break;
                }

                if read.is_none() {
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

// ──────────────────────────────────────────────────────────────────────────
// ReadFileUV (Windows)
//
// Owned as a `Box` by whoever drives the next step: libuv while an
// open/fstat/read is in flight (`bun_io::uv_fs`), otherwise the code below.
// Finishing drops the box.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct ReadFileUV {
    pub(crate) event_loop: bun_ptr::BackRef<EventLoop>,
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
    pub(crate) on_done: Option<ReadFileOnDone>,
    pub(crate) is_regular_file: bool,

    pub(crate) req: libuv::fs_t,
}

#[cfg(windows)]
bun_io::intrusive_uv_fs!(ReadFileUV, req);

#[cfg(windows)]
impl ReadFileUV {
    pub(crate) fn start(
        event_loop: &EventLoop,
        store: RefPtr<Store>,
        off: SizeType,
        max_len: SizeType,
        on_done: ReadFileOnDone,
    ) {
        log!("ReadFileUV.start");
        let mut this = Box::new(ReadFileUV {
            event_loop: bun_ptr::BackRef::new(event_loop),
            store, // store.ref() — the +1 owned here
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
            on_done: Some(on_done),
            is_regular_file: false,
            req: bun_core::ffi::zeroed(),
        });
        this.req.loop_ = event_loop.uv_loop().cast();
        // Keep the event loop alive while the async operation is pending
        event_loop.ref_keep_alive();
        Self::get_fd(this);
    }

    #[inline]
    fn file_store(&self) -> &FileStore {
        self.store.data.as_file()
    }

    /// On return, `this` has been dropped.
    fn finalize(mut this: Box<Self>) {
        log!("ReadFileUV.finalize");
        let event_loop = this.event_loop;

        let on_done = this.on_done.take().expect("a ReadFileUV completes once");

        let result = if let Some(err) = this.system_error.take() {
            ReadFileResultType::Err(err)
        } else {
            ReadFileResultType::Result(ReadFileRead {
                buf: core::mem::take(&mut this.buffer).into_boxed_slice(),
            })
        };

        // The completion must run BEFORE the cleanup below (store deref / req.deinit /
        // box drop / event_loop.unref) — it may inspect store. A libuv callback returns void: an
        // exception the JS side left pending is reported here (a termination just stands down).
        crate::dispatch::fold(on_done.complete(result));

        // store.deref runs via RefPtr<Store>'s Drop when the Box drops.
        this.req.deinit();
        drop(this);
        // Release the event loop reference now that we're done
        event_loop.unref_keep_alive();
        log!("ReadFileUV.finalize destroy");
    }

    pub(crate) fn is_allowed_to_close(&self) -> bool {
        self.file_store().pathlike.is_path()
    }

    /// On return, `this` has been dropped.
    fn on_finish(mut this: Box<Self>) {
        log!("ReadFileUV.onFinish");
        let fd = this.opened_fd;
        let needs_close = fd != Fd::INVALID;

        this.size = this.read_len.max(this.size);
        this.total_size = this.total_size.max(this.size);

        if needs_close && this.is_allowed_to_close() && fd.stdio_tag().is_none() {
            bun_io::Closer::close(fd, this.req.loop_);
            this.opened_fd = Fd::INVALID;
        }

        Self::finalize(this);
    }

    fn fail(mut this: Box<Self>, errno: bun_sys::E, syscall: bun_sys::Tag) {
        this.errno = Some(bun_errno::from_errno(errno as i32).into());
        this.system_error = Some(
            bun_sys::Error::from_code(errno, syscall)
                .to_system_error()
                .into(),
        );
        Self::on_finish(this);
    }

    fn get_fd(mut this: Box<Self>) {
        if let crate::webcore::node_types::PathOrFileDescriptor::Fd(fd) = this.file_store().pathlike
        {
            this.opened_fd = fd;
            return Self::on_file_open(this);
        }
        use crate::node::types::PathLikeExt as _;
        let mut buf = bun_paths::PathBuffer::uninit();
        // Force-copied so the result lives in `buf`, not `this`.
        let len = this
            .file_store()
            .pathlike
            .path()
            .slice_z_with_force_copy::<true>(&mut buf)
            .len();
        let path = bun_core::ZStr::from_buf(&buf[..], len);
        if let Err((this, rc)) = bun_io::uv_fs::open(
            this,
            path.as_cstr(),
            bun_sys::O::RDONLY | bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC,
            crate::node::fs::DEFAULT_PERMISSION as i32,
        ) {
            let errno = rc.errno().expect("negative rc");
            Self::fail_open(this, errno);
        }
    }

    fn fail_open(mut this: Box<Self>, errno: bun_sys::E) {
        this.errno = Some(bun_errno::from_errno(errno as i32).into());
        this.system_error = Some(
            bun_sys::Error::from_code(errno, bun_sys::Tag::open)
                .with_path(this.file_store().pathlike.path().slice())
                .to_system_error()
                .into(),
        );
        this.opened_fd = Fd::INVALID;
        Self::on_finish(this);
    }

    fn on_file_open(mut this: Box<Self>) {
        log!("ReadFileUV.onFileOpen");
        this.req.deinit();
        let fd = this.opened_fd.uv();
        if let Err((this, rc)) = bun_io::uv_fs::fstat(this, fd) {
            let errno = rc.errno().expect("negative rc");
            Self::fail(this, errno, bun_sys::Tag::fstat);
        }
    }

    fn spare_room(&self) -> usize {
        (self.max_length.saturating_sub(self.read_off) as usize)
            .min(self.buffer.capacity() - self.buffer.len())
    }

    pub(crate) fn queue_read(mut this: Box<Self>) {
        // if not a regular file, buffer capacity is arbitrary, and running out doesn't mean we're
        // at the end of the file
        if (this.spare_room() > 0 || !this.is_regular_file)
            && this.errno.is_none()
            && !this.read_eof
        {
            log!(
                "ReadFileUV.queueRead - this.remainingBuffer().len = {}",
                this.spare_room()
            );

            if !this.is_regular_file {
                // non-regular files have variable sizes, so we always ensure
                // theres at least 4096 bytes of free space. there has already
                // been an initial allocation done for us
                if this.buffer.try_reserve(4096).is_err() {
                    this.errno = Some(crate::Error::Alloc(bun_alloc::AllocError));
                    this.system_error = Some(
                        bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::read)
                            .to_system_error()
                            .into(),
                    );
                    return Self::on_finish(this);
                }
            }

            this.req.assert_cleaned_up();
            let fd = this.opened_fd.uv();
            let max = this.max_length.saturating_sub(this.read_off) as usize;
            let offset = i64::try_from(this.offset + this.read_off).expect("int cast");
            if let Err((this, rc)) =
                bun_io::uv_fs::read(this, fd, |t: &mut Self| &mut t.buffer, max, offset)
            {
                let errno = rc.errno().expect("negative rc");
                Self::fail(this, errno, bun_sys::Tag::read);
            }
        } else {
            log!("ReadFileUV.queueRead done");

            // We are done reading.
            Self::on_finish(this);
        }
    }
}

#[cfg(windows)]
impl bun_io::uv_fs::OnFsOpen for ReadFileUV {
    fn on_fs_open(mut this: Box<Self>, rc: libuv::ReturnCodeI64) {
        this.req.cleanup();
        if let Some(errno) = rc.errno() {
            return Self::fail_open(this, errno);
        }
        this.opened_fd = Fd::from_uv(rc.to_fd());
        Self::on_file_open(this);
    }
}

#[cfg(windows)]
impl bun_io::uv_fs::OnFsStat for ReadFileUV {
    fn on_fs_stat(mut this: Box<Self>, rc: libuv::ReturnCodeI64) {
        log!("ReadFileUV.onFileInitialStat");
        if let Some(errno) = rc.errno() {
            return Self::fail(this, errno, bun_sys::Tag::fstat);
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
                path: if this.file_store().pathlike.is_path() {
                    BunString::clone_utf8(this.file_store().pathlike.path().slice())
                } else {
                    BunString::EMPTY
                }
                .into(),
                message: BunString::static_("Directories cannot be read like files").into(),
                syscall: BunString::static_("read").into(),
                ..Default::default()
            });
            return Self::on_finish(this);
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
            return Self::on_finish(this);
        }
        // Out of memory we can't read more than 4GB at a time (ULONG) on Windows
        if this.size as usize > bun_sys::windows::ULONG::MAX as usize {
            return Self::fail(this, bun_sys::E::NOMEM, bun_sys::Tag::read);
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
            return Self::on_finish(this);
        }
        this.read_len = 0;
        this.read_off = 0;

        this.req.deinit();

        Self::queue_read(this);
    }
}

#[cfg(windows)]
impl bun_io::uv_fs::OnFsRead for ReadFileUV {
    fn on_fs_read(mut this: Box<Self>, result: libuv::ReturnCodeI64) {
        if let Some(errno) = result.errno() {
            return Self::fail(this, errno, bun_sys::Tag::read);
        }

        if result.int() == 0 {
            // We are done reading.
            return Self::on_finish(this);
        }

        // `uv_fs::read` already appended the bytes to `buffer`.
        this.read_off += SizeType::try_from(result.int()).expect("int cast");

        this.req.deinit();
        Self::queue_read(this);
    }
}
