use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::{offset_of, MaybeUninit};
use core::sync::atomic::{AtomicU8, Ordering};

use bun_core::{self, Error};
use bun_io::{self as io, Action, Loop, Poll, Request};
use bun_jsc::{
    self as jsc, AnyPromise, EventLoop, JSGlobalObject, JSPromise, JSValue, JsResult, SystemError,
    WorkTask,
};
use bun_runtime::webcore::blob::{
    Blob, ClosingState, FileCloser, FileOpener, SizeType, Store,
};
use bun_runtime::webcore::blob::store::{Bytes as ByteStore, File as FileStore};
use bun_str::String as BunString;
use bun_sys::{self, Fd, Stat};
use bun_sys::windows::libuv;
use bun_threading::{self, ThreadPool, WorkPool, WorkPoolTask};

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
// TODO(port): comptime fn-value param — model `Function` as a trait so each
// instantiation monomorphizes like the Zig type-generator did.
pub trait ReadFileToJs {
    fn call(
        b: &mut Blob,
        g: &JSGlobalObject,
        by: &mut [u8],
        lifetime: jsc::Lifetime,
    ) -> JsResult<JSValue>;
}

pub struct NewReadFileHandler<'a, F: ReadFileToJs> {
    pub context: Blob,
    pub promise: JSPromise::Strong,
    pub global_this: &'a JSGlobalObject,
    _f: PhantomData<F>,
}

impl<'a, F: ReadFileToJs> NewReadFileHandler<'a, F> {
    pub fn run(handler: *mut Self, maybe_bytes: ReadFileResultType) -> jsc::JsTerminatedResult<()> {
        // SAFETY: handler was Box::into_raw'd by doReadFile(); we take ownership here.
        let handler = unsafe { Box::from_raw(handler) };
        let mut promise = handler.promise.swap();
        let mut blob = handler.context.take_ownership();
        // `context` was populated via `this.dupe()` in doReadFile(), so it
        // owns a store ref, a name ref, and possibly a content_type copy.
        // (blob is dropped at end of scope — Drop handles deinit.)
        let global_this = handler.global_this;
        drop(handler);
        match maybe_bytes {
            ReadFileResultType::Result(result) => {
                let bytes = result.buf;
                if blob.size > 0 {
                    blob.size = (bytes.len() as SizeType).min(blob.size);
                }
                // Zig defined a local `WrappedFn` struct to adapt the comptime
                // `Function` into the `toJSHostCall` shape. In Rust we inline
                // the closure.
                let wrapped = |b: &mut Blob, g: &JSGlobalObject, by: &mut [u8]| -> JSValue {
                    // TODO(port): jsc.toJSHostCall(@src(), Function, ...) — need
                    // the Rust equivalent that records source location + catches.
                    jsc::to_js_host_call(g, F::call, (b, g, by, jsc::Lifetime::Temporary))
                };

                AnyPromise::wrap(
                    AnyPromise::Normal(promise),
                    global_this,
                    wrapped,
                    (&mut blob, global_this, bytes),
                )?;
            }
            ReadFileResultType::Err(err) => {
                promise.reject(
                    global_this,
                    err.to_error_instance_with_async_stack(global_this, &promise),
                )?;
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
    pub buf: &'static mut [u8], // TODO(port): lifetime — Zig `[]u8` owned by caller via is_temporary flag
    pub is_temporary: bool,
    pub total_size: SizeType,
}

impl Default for ReadFileRead {
    fn default() -> Self {
        Self { buf: &mut [], is_temporary: false, total_size: 0 }
    }
}

/// Zig: `SystemError.Maybe(ReadFileRead)`
pub enum ReadFileResultType {
    Result(ReadFileRead),
    Err(SystemError),
}

pub type ReadFileTask = WorkTask<ReadFile>;

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

pub struct ReadFile {
    pub file_store: FileStore,
    pub byte_store: ByteStore,
    pub store: Option<std::sync::Arc<Store>>,
    pub offset: SizeType,
    pub max_length: SizeType,
    pub total_size: SizeType,
    pub opened_fd: Fd,
    pub read_off: SizeType,
    pub read_eof: bool,
    pub size: SizeType,
    pub buffer: Vec<u8>,
    pub task: ThreadPool::Task,
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

impl ReadFile {
    // TODO(port): `pub const getFd = FileOpener(@This()).getFd;` — model
    // FileOpener/FileCloser as traits with default methods and impl them here.
    pub fn get_fd(&mut self, then: fn(&mut Self, Fd)) {
        FileOpener::<Self>::get_fd(self, then)
    }
    pub fn do_close(&mut self, is_allowed_to_close: bool) -> bool {
        FileCloser::<Self>::do_close(self, is_allowed_to_close)
    }

    pub fn update(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        // SAFETY: ClosingState is #[repr(u8)] with the same discriminants.
        match unsafe { core::mem::transmute::<u8, ClosingState>(self.state.load(Ordering::Relaxed)) }
        {
            ClosingState::Closing => {
                self.on_finish();
            }
            ClosingState::Running => self.do_read_loop(),
        }
    }

    pub fn create_with_ctx(
        store: std::sync::Arc<Store>,
        on_read_file_context: *mut c_void,
        on_complete_callback: ReadFileOnReadFileCallback,
        off: SizeType,
        max_len: SizeType,
    ) -> Result<Box<ReadFile>, Error> {
        // TODO(port): narrow error set
        #[cfg(windows)]
        {
            compile_error!("Do not call ReadFile.create_with_ctx on Windows, see ReadFileUV");
        }

        // store.ref() — handled by cloning the Arc before storing.
        let file_store = store.data.file.clone();
        let read_file = Box::new(ReadFile {
            file_store,
            byte_store: ByteStore::default(),
            store: Some(store),
            offset: off,
            max_length: max_len,
            total_size: Blob::MAX_SIZE,
            opened_fd: Fd::INVALID,
            read_off: 0,
            read_eof: false,
            size: 0,
            buffer: Vec::new(),
            task: ThreadPool::Task::default(), // TODO(port): was `undefined`
            system_error: None,
            errno: None,
            on_complete_ctx: on_read_file_context,
            on_complete_callback,
            io_task: None,
            io_poll: io::Poll::default(),
            io_request: io::Request::new(Self::on_request_readable),
            could_block: false,
            close_after_io: false,
            state: AtomicU8::new(ClosingState::Running as u8),
        });
        Ok(read_file)
    }

    pub fn create<C: 'static>(
        store: std::sync::Arc<Store>,
        off: SizeType,
        max_len: SizeType,
        context: *mut C,
        callback: fn(ctx: *mut C, bytes: ReadFileResultType) -> jsc::JsTerminatedResult<()>,
    ) -> Result<Box<ReadFile>, Error> {
        #[cfg(windows)]
        {
            compile_error!("dont call this function on windows");
        }

        // Zig used a local `Handler` struct to erase the type and swallow the
        // JSTerminated error. We do the same with a monomorphized shim.
        // TODO(port): properly propagate exception upwards (matches Zig TODO).
        //
        // Zig captured `callback` at comptime; Rust fn pointers cannot capture.
        // TODO(port): comptime callback capture — model `callback` as a trait
        // associated fn (or const-generic fn ptr once stable) so the shim is
        // monomorphized per call site. For now we stash the typed fn pointer
        // alongside ctx in a leaked pair so the erased shim can recover both.
        struct Erased<C> {
            ctx: *mut C,
            callback: fn(*mut C, ReadFileResultType) -> jsc::JsTerminatedResult<()>,
        }
        fn handler_run<C>(ctx: *mut c_void, bytes: ReadFileResultType) {
            // SAFETY: ctx was Box::into_raw'd from Erased<C> below; we reclaim it here.
            let erased = unsafe { Box::from_raw(ctx as *mut Erased<C>) };
            let _ = (erased.callback)(erased.ctx, bytes);
        }
        let erased = Box::into_raw(Box::new(Erased { ctx: context, callback }));

        ReadFile::create_with_ctx(
            store,
            erased as *mut c_void,
            handler_run::<C>,
            off,
            max_len,
        )
    }

    pub const IO_TAG: io::poll::Tag = io::poll::Tag::ReadFile;

    pub fn on_readable(request: *mut io::Request) {
        // SAFETY: request points to ReadFile.io_request (intrusive field).
        let this: &mut ReadFile = unsafe {
            &mut *((request as *mut u8)
                .sub(offset_of!(ReadFile, io_request))
                .cast::<ReadFile>())
        };
        this.on_ready();
    }

    pub fn on_ready(&mut self) {
        bloblog!("ReadFile.onReady");
        self.task = ThreadPool::Task { callback: Self::do_read_loop_task };
        // On macOS, we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        #[cfg(target_os = "macos")]
        {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io_request.scheduled;
        }

        WorkPool::schedule(&mut self.task);
    }

    pub fn on_io_error(&mut self, err: bun_sys::Error) {
        bloblog!("ReadFile.onIOError");
        self.errno = Some(bun_core::errno_to_err(err.errno));
        self.system_error = Some(err.to_system_error());
        self.task = ThreadPool::Task { callback: Self::do_read_loop_task };
        // On macOS, we use one-shot mode, so:
        // - we don't need to unregister
        // - we don't need to delete from kqueue
        #[cfg(target_os = "macos")]
        {
            // unless pending IO has been scheduled in-between.
            self.close_after_io = self.io_request.scheduled;
        }
        WorkPool::schedule(&mut self.task);
    }

    pub fn on_request_readable(request: *mut io::Request) -> io::Action {
        bloblog!("ReadFile.onRequestReadable");
        // SAFETY: caller passes a live *mut io::Request; we only touch the POD `scheduled` field.
        unsafe { (*request).scheduled = false };
        // SAFETY: request points to ReadFile.io_request (intrusive field); recover parent via offset_of.
        let this: &mut ReadFile = unsafe {
            &mut *((request as *mut u8)
                .sub(offset_of!(ReadFile, io_request))
                .cast::<ReadFile>())
        };
        io::Action::Readable {
            // TODO(port): @ptrCast(&onIOError) — fn pointer cast to erased signature
            on_error: Self::on_io_error as *const (),
            ctx: this as *mut ReadFile as *mut c_void,
            fd: this.opened_fd,
            poll: &mut this.io_poll,
            tag: ReadFile::IO_TAG,
        }
    }

    pub fn wait_for_readable(&mut self) {
        bloblog!("ReadFile.waitForReadable");
        self.close_after_io = true;
        // Zig: @atomicStore on the callback fn-pointer field.
        // TODO(port): io::Request.callback should be AtomicPtr-backed for this store.
        // SAFETY: io_request.callback is a plain fn-ptr field on a struct we uniquely own;
        // volatile write + SeqCst fence emulates Zig @atomicStore(.seq_cst).
        unsafe {
            core::ptr::write_volatile(
                &mut self.io_request.callback,
                Self::on_request_readable as _,
            );
            core::sync::atomic::fence(Ordering::SeqCst);
        }
        if !self.io_request.scheduled {
            io::Loop::get().schedule(&mut self.io_request);
        }
    }

    fn remaining_buffer<'b>(&'b self, stack_buffer: &'b mut [u8]) -> &'b mut [u8] {
        // PORT NOTE: reshaped for borrowck — Zig indexed raw ptr range
        // `items.ptr[items.len..capacity]`; Rust uses spare_capacity_mut().
        // SAFETY: we treat uninit spare capacity as &mut [u8]; bytes are POD
        // and we never read them before writing via read(2).
        let spare_len = self.buffer.capacity() - self.buffer.len();
        let remaining: &mut [u8] = if spare_len < stack_buffer.len() {
            stack_buffer
        } else {
            unsafe {
                core::slice::from_raw_parts_mut(
                    (self.buffer.as_ptr() as *mut u8).add(self.buffer.len()),
                    spare_len,
                )
            }
        };
        let cap = remaining
            .len()
            .min((self.max_length.saturating_sub(self.read_off)) as usize);
        &mut remaining[..cap]
    }

    pub fn do_read(&mut self, buffer: &mut [u8], read_len: &mut usize, retry: &mut bool) -> bool {
        let result: bun_sys::Result<usize> = 'brk: {
            if bun_sys::S::ISSOCK(self.file_store.mode) {
                break 'brk bun_sys::recv_non_block(self.opened_fd, buffer);
            }
            break 'brk bun_sys::read(self.opened_fd, buffer);
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
                            self.errno = Some(bun_core::errno_to_err(err.errno));
                            self.system_error = Some(err.to_system_error());
                            if self.system_error.as_ref().unwrap().path.is_empty() {
                                self.system_error.as_mut().unwrap().path =
                                    if self.file_store.pathlike.is_path() {
                                        BunString::clone_utf8(
                                            self.file_store.pathlike.path().slice(),
                                        )
                                    } else {
                                        BunString::empty()
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
            let system_error = this.system_error.clone().unwrap();
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

        // TODO(port): lifetime — Zig hands `buffer.items` as a raw slice with
        // `is_temporary = true`; receiver takes ownership of the allocation.
        // SAFETY: ownership of the boxed allocation is transferred to the callback via
        // is_temporary=true; the receiver is responsible for freeing it.
        let buf_slice: &'static mut [u8] = unsafe {
            let mut b = buf.into_boxed_slice();
            let ptr = b.as_mut_ptr();
            let len = b.len();
            core::mem::forget(b);
            core::slice::from_raw_parts_mut(ptr, len)
        };
        cb(
            cb_ctx,
            ReadFileResultType::Result(ReadFileRead {
                buf: buf_slice,
                total_size,
                is_temporary: true,
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
                // SAFETY: io_task is a valid back-pointer set in run_async().
                unsafe { (*io_task).on_finish() };
            }
        }
    }

    fn resolve_size_and_last_modified(&mut self, fd: Fd) {
        let stat: Stat = match bun_sys::fstat(fd) {
            Ok(result) => result,
            Err(err) => {
                self.errno = Some(bun_core::errno_to_err(err.errno));
                self.system_error = Some(err.to_system_error());
                return;
            }
        };

        if let Some(store) = &self.store {
            if store.data.is_file() {
                // TODO(port): Arc<Store> interior mutability — Zig mutates through *Store.
                store.data.file().last_modified =
                    jsc::to_js_time(stat.mtime().sec, stat.mtime().nsec);
            }
        }

        if bun_sys::S::ISDIR(u32::try_from(stat.mode).unwrap()) {
            self.errno = Some(bun_core::err!("EISDIR"));
            self.system_error = Some(SystemError {
                code: BunString::static_("EISDIR"),
                path: if self.file_store.pathlike.is_path() {
                    BunString::clone_utf8(self.file_store.pathlike.path().slice())
                } else {
                    BunString::empty()
                },
                message: BunString::static_("Directories cannot be read like files"),
                syscall: BunString::static_("read"),
                ..Default::default()
            });
            return;
        }

        self.could_block = !bun_sys::is_regular_file(stat.mode);
        self.total_size =
            SizeType::try_from(stat.size.max(0).min(Blob::MAX_SIZE as i64)).unwrap();

        if stat.size > 0 && !self.could_block {
            self.size = self.total_size.min(self.max_length);
            // read up to 4k at a time if
            // they didn't explicitly set a size and we're reading from something that's not a regular file
        } else if stat.size == 0 && self.could_block {
            self.size = self.max_length.min(4096);
        }

        if self.offset > 0 {
            // We DO support offset in Bun.file()
            match bun_sys::set_file_offset(fd, self.offset) {
                // we ignore errors because it should continue to work even if its a pipe
                Err(_) | Ok(_) => {}
            }
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
            self.byte_store = ByteStore::init(self.buffer.as_slice());

            self.on_finish();
            return;
        }

        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        if !self.could_block || (self.size > 0 && self.size != Blob::MAX_SIZE) {
            let want = (self.size as usize).saturating_add(16);
            let mut v = Vec::<u8>::new();
            if v.try_reserve_exact(want).is_err() {
                self.errno = Some(bun_core::err!("OutOfMemory"));
                self.system_error =
                    Some(bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::Read)
                        .to_system_error());
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
            if bun_io::is_readable(fd) == bun_io::Readable::NotReady {
                self.wait_for_readable();
                return;
            }
        }

        self.do_read_loop();
    }

    fn do_read_loop_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to ReadFile.task (intrusive field).
        let this: &mut ReadFile = unsafe {
            &mut *((task as *mut u8)
                .sub(offset_of!(ReadFile, task))
                .cast::<ReadFile>())
        };

        this.update();
    }

    fn do_read_loop(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        // SAFETY: ClosingState is #[repr(u8)]; the AtomicU8 stores only valid discriminants.
        while unsafe {
            core::mem::transmute::<u8, ClosingState>(self.state.load(Ordering::Relaxed))
        } == ClosingState::Running
        {
            // we hold a 64 KB stack buffer incase the amount of data to
            // be read is greater than the reported amount
            //
            // 64 KB is large, but since this is running in a thread
            // with it's own stack, it should have sufficient space.
            // SAFETY: [MaybeUninit<u8>; N] is itself a valid value when uninitialized;
            // no byte is read before being written by read(2).
            let mut stack_buffer: [MaybeUninit<u8>; 64 * 1024] =
                unsafe { MaybeUninit::uninit().assume_init() };
            // SAFETY: u8 is POD; treating uninit bytes as &mut [u8] for read(2) target is fine.
            let stack_buffer: &mut [u8] = unsafe {
                core::slice::from_raw_parts_mut(
                    stack_buffer.as_mut_ptr() as *mut u8,
                    stack_buffer.len(),
                )
            };
            // PORT NOTE: reshaped for borrowck — capture stack_buffer ptr to
            // compare against `read.ptr` after the &mut self call.
            let stack_ptr = stack_buffer.as_ptr();
            let buffer: *mut [u8] = self.remaining_buffer(stack_buffer);
            // SAFETY: buffer points either at stack_buffer or at self.buffer's spare capacity;
            // both outlive this loop iteration and are not aliased until set_len/extend below.
            let buffer: &mut [u8] = unsafe { &mut *buffer };

            if !buffer.is_empty() && self.errno.is_none() && !self.read_eof {
                let mut read_amount: usize = 0;
                let mut retry = false;
                let continue_reading = self.do_read(buffer, &mut read_amount, &mut retry);
                let read = &buffer[..read_amount];

                // We might read into the stack buffer, so we need to copy it into the heap.
                if read.as_ptr() == stack_ptr {
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
                    // SAFETY: read() wrote `read.len()` initialized bytes into spare capacity.
                    unsafe { self.buffer.set_len(self.buffer.len() + read.len()) };
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
                        match bun_io::is_readable(self.opened_fd) {
                            bun_io::Readable::NotReady => {}
                            bun_io::Readable::Ready | bun_io::Readable::Hup => continue,
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
        self.byte_store = ByteStore::init(self.buffer.as_slice());
        self.on_finish();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFileUV (Windows)
// ──────────────────────────────────────────────────────────────────────────

pub struct ReadFileUV<'a> {
    pub loop_: *mut libuv::uv_loop_t,
    pub event_loop: &'a EventLoop,
    pub file_store: FileStore,
    pub byte_store: ByteStore,
    pub store: std::sync::Arc<Store>,
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
}

impl<'a> ReadFileUV<'a> {
    // TODO(port): FileOpener/FileCloser trait impls (see ReadFile note above).
    pub fn get_fd(&mut self, then: fn(&mut Self, Fd)) {
        FileOpener::<Self>::get_fd(self, then)
    }
    pub fn do_close(&mut self, is_allowed_to_close: bool) -> bool {
        FileCloser::<Self>::do_close(self, is_allowed_to_close)
    }

    pub fn start<H>(
        event_loop: &'a EventLoop,
        store: std::sync::Arc<Store>,
        off: SizeType,
        max_len: SizeType,
        handler: *mut c_void,
    )
    where
        H: ReadFileUvHandler,
    {
        log!("ReadFileUV.start");
        let file_store = store.data.file.clone();
        let mut this = Box::new(ReadFileUV {
            loop_: event_loop.virtual_machine().uv_loop(),
            event_loop,
            file_store,
            byte_store: ByteStore::default(),
            store, // store.ref() — Arc clone owned here
            offset: off,
            max_length: max_len,
            total_size: Blob::MAX_SIZE,
            opened_fd: Fd::INVALID,
            read_len: 0,
            read_off: 0,
            read_eof: false,
            size: 0,
            buffer: Vec::new(),
            system_error: None,
            errno: None,
            on_complete_data: handler,
            // Zig: @ptrCast(&Handler.run) — erase the typed handler to the C ABI cb.
            on_complete_fn: H::run as ReadFileOnReadFileCallback,
            is_regular_file: false,
            // SAFETY: all-zero is a valid libuv fs_t (matches std.mem.zeroes).
            req: unsafe { core::mem::zeroed() },
        });
        // Keep the event loop alive while the async operation is pending
        event_loop.ref_concurrently();
        let this_ptr: *mut ReadFileUV = Box::into_raw(this);
        // SAFETY: this_ptr is freshly boxed and uniquely owned by the async op.
        unsafe { (*this_ptr).get_fd(Self::on_file_open) };
        // ownership now lives with the libuv request chain until finalize().
        let _ = this_ptr;
    }

    pub fn finalize(this: *mut Self) {
        log!("ReadFileUV.finalize");
        // SAFETY: `this` was Box::into_raw'd in start(); we reclaim ownership here.
        let mut this_box = unsafe { Box::from_raw(this) };
        let event_loop = this_box.event_loop;

        let cb = this_box.on_complete_fn;
        let cb_ctx = this_box.on_complete_data;

        let result = if let Some(err) = this_box.system_error.take() {
            ReadFileResultType::Err(err)
        } else {
            // Move byte_store out so dropping `this_box` below does not free the
            // buffer we hand to the callback.
            let byte_store = core::mem::take(&mut this_box.byte_store);
            let slice = byte_store.slice();
            let (ptr, len) = (slice.as_ptr() as *mut u8, slice.len());
            core::mem::forget(byte_store);
            ReadFileResultType::Result(ReadFileRead {
                // SAFETY: byte_store owned the allocation; ownership is transferred to the
                // callback via is_temporary=true (receiver frees it). The backing memory
                // outlives `this_box` because we forgot byte_store above.
                buf: unsafe { core::slice::from_raw_parts_mut(ptr, len) },
                total_size: this_box.total_size,
                is_temporary: true,
            })
        };

        // Zig order: cb() runs BEFORE the defer block (store.deref / req.deinit /
        // bun.destroy / event_loop.unref). Preserve that — cb may inspect store.
        cb(cb_ctx, result);

        // Zig defer block — Arc<Store> drops with the Box; req.deinit() runs in Drop below.
        // TODO(port): ensure libuv::fs_t has Drop calling uv_fs_req_cleanup.
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

        Self::finalize(self as *mut Self);
    }

    pub fn on_file_open(&mut self, opened_fd: Fd) {
        log!("ReadFileUV.onFileOpen");
        if self.errno.is_some() {
            self.on_finish();
            return;
        }

        self.req.deinit();
        self.req.data = self as *mut Self as *mut c_void;

        if let Some(errno) = libuv::uv_fs_fstat(
            self.loop_,
            &mut self.req,
            opened_fd.uv(),
            Some(Self::on_file_initial_stat),
        )
        .err_enum()
        {
            self.errno = Some(bun_core::errno_to_err(errno));
            self.system_error =
                Some(bun_sys::Error::from_code(errno, bun_sys::Tag::Fstat).to_system_error());
            self.on_finish();
            return;
        }

        self.req.data = self as *mut Self as *mut c_void;
    }

    extern "C" fn on_file_initial_stat(req: *mut libuv::fs_t) {
        log!("ReadFileUV.onFileInitialStat");
        // SAFETY: req.data was set to *mut Self in on_file_open().
        let this: &mut ReadFileUV = unsafe { &mut *((*req).data as *mut ReadFileUV) };

        if let Some(errno) = unsafe { (*req).result.err_enum() } {
            this.errno = Some(bun_core::errno_to_err(errno));
            this.system_error =
                Some(bun_sys::Error::from_code(errno, bun_sys::Tag::Fstat).to_system_error());
            this.on_finish();
            return;
        }

        let stat = unsafe { (*req).statbuf };

        // keep in sync with resolveSizeAndLastModified
        if this.store.data.is_file() {
            // TODO(port): Arc<Store> interior mutability — Zig mutates through *Store.
            this.store.data.file().last_modified =
                jsc::to_js_time(stat.mtime().sec, stat.mtime().nsec);
        }

        if bun_sys::S::ISDIR(u32::try_from(stat.mode).unwrap()) {
            this.errno = Some(bun_core::err!("EISDIR"));
            this.system_error = Some(SystemError {
                code: BunString::static_("EISDIR"),
                path: if this.file_store.pathlike.is_path() {
                    BunString::clone_utf8(this.file_store.pathlike.path().slice())
                } else {
                    BunString::empty()
                },
                message: BunString::static_("Directories cannot be read like files"),
                syscall: BunString::static_("read"),
                ..Default::default()
            });
            this.on_finish();
            return;
        }
        this.total_size =
            SizeType::try_from(stat.size.max(0).min(Blob::MAX_SIZE as i64)).unwrap();
        this.is_regular_file = bun_sys::is_regular_file(stat.mode);

        log!("is_regular_file: {}", this.is_regular_file);

        if stat.size > 0 && this.is_regular_file {
            this.size = this.total_size.min(this.max_length);
        } else if stat.size == 0 && !this.is_regular_file {
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
            this.byte_store = ByteStore::init(this.buffer.as_slice());
            this.on_finish();
            return;
        }
        // Out of memory we can't read more than 4GB at a time (ULONG) on Windows
        if this.size as usize > bun_sys::windows::ULONG::MAX as usize {
            this.errno = Some(bun_core::errno_to_err(bun_sys::E::NOMEM));
            this.system_error =
                Some(bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::Read)
                    .to_system_error());
            this.on_finish();
            return;
        }
        // add an extra 16 bytes to the buffer to avoid having to resize it for trailing extra data
        let want = ((this.size as usize).saturating_add(16))
            .min(bun_sys::windows::ULONG::MAX as usize);
        if this.buffer.try_reserve_exact(want).is_err() {
            this.errno = Some(bun_core::err!("OutOfMemory"));
            this.system_error =
                Some(bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::Read)
                    .to_system_error());
            this.on_finish();
            return;
        }
        this.read_len = 0;
        this.read_off = 0;

        this.req.deinit();

        this.queue_read();
    }

    fn remaining_buffer(&self) -> &mut [u8] {
        // SAFETY: spare capacity bytes are POD; libuv writes into them.
        let spare_len = self.buffer.capacity() - self.buffer.len();
        let ptr = unsafe { (self.buffer.as_ptr() as *mut u8).add(self.buffer.len()) };
        let remaining = unsafe { core::slice::from_raw_parts_mut(ptr, spare_len) };
        let cap = remaining
            .len()
            .min((self.max_length.saturating_sub(self.read_off)) as usize);
        // SAFETY: subslice of spare capacity.
        unsafe { core::slice::from_raw_parts_mut(ptr, cap) }
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
                        bun_sys::Error::from_code(bun_sys::E::NOMEM, bun_sys::Tag::Read)
                            .to_system_error(),
                    );
                    self.on_finish();
                    return;
                }
            }

            let buf = self.remaining_buffer();
            let mut bufs: [libuv::uv_buf_t; 1] = [libuv::uv_buf_t::init(buf)];
            self.req.assert_cleaned_up();
            let res = libuv::uv_fs_read(
                self.loop_,
                &mut self.req,
                self.opened_fd.uv(),
                bufs.as_mut_ptr(),
                bufs.len() as u32,
                i64::try_from(self.offset + self.read_off).unwrap(),
                Some(Self::on_read),
            );
            self.req.data = self as *mut Self as *mut c_void;
            if let Some(errno) = res.err_enum() {
                self.errno = Some(bun_core::errno_to_err(errno));
                self.system_error =
                    Some(bun_sys::Error::from_code(errno, bun_sys::Tag::Read).to_system_error());
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
        let this: &mut ReadFileUV = unsafe { &mut *((*req).data as *mut ReadFileUV) };

        let result = unsafe { (*req).result };

        if let Some(errno) = result.err_enum() {
            this.errno = Some(bun_core::errno_to_err(errno));
            this.system_error =
                Some(bun_sys::Error::from_code(errno, bun_sys::Tag::Read).to_system_error());
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

        this.read_off += SizeType::try_from(result.int()).unwrap();
        // SAFETY: libuv wrote result.int() initialized bytes into spare capacity.
        unsafe {
            this.buffer
                .set_len(this.buffer.len() + usize::try_from(result.int()).unwrap())
        };

        this.req.deinit();
        this.queue_read();
    }
}

/// Trait modeling the `comptime Handler: type` parameter of `ReadFileUV.start`.
pub trait ReadFileUvHandler {
    fn run(ctx: *mut c_void, bytes: ReadFileResultType);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/blob/read_file.zig (829 lines)
//   confidence: medium
//   todos:      15
//   notes:      FileOpener/FileCloser need trait modeling; Arc<Store> needs interior mutability for last_modified writes; ReadFile::create comptime-callback erasure boxed as (ctx, fn) pair pending trait rework.
// ──────────────────────────────────────────────────────────────────────────
