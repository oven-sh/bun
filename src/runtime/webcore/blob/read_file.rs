use core::marker::PhantomData;
use core::mem::MaybeUninit;

use scopeguard::ScopeGuard;

#[cfg(windows)]
use crate::node::types::PathLikeExt as _;
#[cfg(windows)]
use crate::server::file_response_stream::StreamFd;
#[cfg(not(windows))]
use crate::webcore::blob::fd_job::{self, FdJob, FdOp, Interest, JobFd, Step, Target};
use crate::webcore::blob::store::Data;
#[cfg(windows)]
use crate::webcore::blob::store::File as FileStore;
use crate::webcore::blob::{Blob, MAX_SIZE, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_collections::ByteVecExt as _;
use bun_core::String as BunString;
#[cfg(not(windows))]
use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};
#[cfg(windows)]
use bun_io::IntrusiveUvFs as _;
use bun_jsc::{
    self as jsc, AnyPromise, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, SystemError,
};
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd};

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
    fn run(self: Box<Self>, bytes: ReadFileResult) -> JsResult<()>;
    /// The read will never complete (its VM stopped before it did). Exactly one of the two is called.
    fn cancel(self: Box<Self>) {}
}

impl<F: ReadFileToJs> ReadFileCompletion for NewReadFileHandler<F> {
    fn run(self: Box<Self>, maybe_bytes: ReadFileResult) -> JsResult<()> {
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
            Ok(bytes) => {
                if blob.size.get() > 0 {
                    blob.size
                        .set((bytes.len() as SizeType).min(blob.size.get()));
                }
                // The `#[track_caller]` `to_js_host_call` inside `AnyPromise::wrap`
                // provides the source-location/exception-scope behaviour.
                AnyPromise::Normal(promise)
                    .wrap(global_this, move |g| F::from_owned(&blob, g, bytes))?;
            }
            Err(err) => {
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

    fn complete(self, bytes: ReadFileResult) -> JsResult<()> {
        ScopeGuard::into_inner(self.0).run(bytes)
    }
}

// SAFETY: it holds JS-thread state (promise, Blob); it is only ever completed or cancelled on
// the JS thread, as a Job's `Js` side.
#[cfg(not(windows))]
unsafe impl bun_jsc::job::JsAffine for PendingReadFileCompletion {}

pub(crate) type ReadFileResult = Result<Box<[u8]>, Box<SystemError>>;

// ──────────────────────────────────────────────────────────────────────────
// ReadFile
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) struct ReadFile {
    store: RefPtr<Store>,
    file: Target,
    /// What the store knew when the read was asked for.
    cached_mode: bun_sys::Mode,
    offset: SizeType,
    max_length: SizeType,
    buffer: Vec<u8>,
    could_block: bool,
}

#[cfg(not(windows))]
impl ReadFile {
    pub(crate) fn start(
        blob: &Blob,
        completion: Box<dyn ReadFileCompletion>,
        cx: &bun_jsc::JsThread<'_>,
    ) {
        let store = blob.store().expect("infallible: store present").clone();
        let read = ReadFile {
            file: Target::of(&store),
            cached_mode: store.data.as_file().mode,
            store,
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            buffer: Vec::new(),
            could_block: false,
        };
        FdJob::schedule(read, PendingReadFileCompletion::new(completion), cx);
    }

    fn path_for_error(&self) -> BunString {
        match self.file.get() {
            PathOrFileDescriptor::Path(path) => BunString::clone_utf8(path.slice()),
            PathOrFileDescriptor::Fd(_) => BunString::EMPTY,
        }
    }

    /// The descriptor of stdin, for one, blocks in read().
    fn must_wait(&self, fd: Fd) -> bool {
        self.could_block && bun_core::is_readable(fd) == bun_core::Pollable::NotReady
    }

    /// One read of up to `max` bytes, appended to `buffer`.
    fn read_some(
        &mut self,
        fd: Fd,
        max: usize,
        stack_buffer: &mut [MaybeUninit<u8>],
    ) -> bun_sys::Result<usize> {
        let is_socket = bun_sys::S::ISSOCK(self.cached_mode);
        let read = |buf: BorrowedCursor<'_, u8>| {
            if is_socket {
                bun_sys::recv_non_block_buf(fd, buf)
            } else {
                crate::node::fs::read_descriptor(fd, buf)
            }
        };

        let buffer = &mut self.buffer;
        if buffer.capacity() - buffer.len() >= stack_buffer.len() {
            return append_with(buffer, max, read);
        }
        let len = stack_buffer.len().min(max);
        let mut chunk = BorrowedBuf::from(&mut stack_buffer[..len]);
        let result = read(chunk.unfilled());
        if buffer.capacity() == 0 {
            // It may be all there is.
            buffer.reserve_exact(chunk.len());
        }
        buffer.extend_from_slice(chunk.filled());
        result
    }
}

#[cfg(not(windows))]
impl FdOp for ReadFile {
    const INTEREST: Interest = Interest::Readable;
    const IO_TAG: bun_io::Tag = bun_io::Tag::ReadFile;
    type Js = PendingReadFileCompletion;

    fn open(&mut self) -> Result<(JobFd, Step), Box<SystemError>> {
        let fd = fd_job::open(&self.file.get(), bun_sys::O::RDONLY, false)?;
        let stat = bun_sys::fstat(fd.get())?;

        if let Data::File(file) = Store::data_mut(&self.store) {
            let mtime = bun_sys::PosixStat::init(&stat).mtime();
            file.last_modified = jsc::to_js_time(mtime.sec as isize, mtime.nsec as isize);
        }

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            return Err(Box::new(SystemError {
                code: BunString::static_("EISDIR"),
                path: self.path_for_error(),
                message: BunString::static_("Directories cannot be read like files"),
                syscall: BunString::static_("read"),
                ..Default::default()
            }));
        }

        self.could_block = !bun_sys::is_regular_file(stat.st_mode as _);
        let expected = match (self.could_block, stat.st_size as i64) {
            (false, size @ 1..) => (size as SizeType).min(MAX_SIZE).min(self.max_length),
            (true, 0) => self.max_length.min(4096),
            _ => 0,
        };

        if self.offset > 0 {
            // A pipe cannot seek, and is read anyway.
            let _ = bun_sys::set_file_offset(fd.get(), self.offset);
        }

        // procfs reports 0 for files that have content, so fstat() alone does not make it empty.
        if expected == 0 && bun_sys::is_regular_file(self.cached_mode) {
            return Ok((fd, Step::Done));
        }
        // An empty read waits like any other.
        if self.max_length == 0 && self.must_wait(fd.get()) {
            return Ok((fd, Step::Wait));
        }
        if !self.could_block || expected > 0 {
            // The extra bytes avoid a resize for a little trailing data.
            self.buffer
                .try_reserve_exact((expected as usize).saturating_add(16))
                .map_err(|_| bun_sys::Error::from_code(bun_sys::E::ENOMEM, bun_sys::Tag::read))?;
        }
        let step = self.step(fd.get(), false)?;
        Ok((fd, step))
    }

    fn step(&mut self, fd: Fd, mut ready: bool) -> Result<Step, Box<SystemError>> {
        let mut stack_buffer = [const { MaybeUninit::uninit() }; 64 * 1024];
        loop {
            let max = (self.max_length as usize).saturating_sub(self.buffer.len());
            if max == 0 {
                break;
            }
            if !core::mem::take(&mut ready) && self.must_wait(fd) {
                return Ok(Step::Wait);
            }
            match self.read_some(fd, max, &mut stack_buffer) {
                Ok(0) => break,
                Ok(_) => {}
                Err(err) if err.get_errno() != bun_sys::E::EAGAIN => {
                    self.buffer = Vec::new();
                    let mut err = Box::<SystemError>::from(err);
                    err.path = self.path_for_error();
                    return Err(err);
                }
                Err(_) => self.could_block = true,
            }
        }
        if self.buffer.len() + 16_000 < self.buffer.capacity() {
            self.buffer.shrink_to_fit();
        }
        Ok(Step::Done)
    }

    fn then(
        self,
        result: Result<(), Box<SystemError>>,
        completion: PendingReadFileCompletion,
    ) -> JsResult<()> {
        completion.complete(result.map(|()| self.buffer.into_boxed_slice()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ReadFileUV (Windows)
// ──────────────────────────────────────────────────────────────────────────

/// One owner at a time: a `Box` here, or libuv while it works for it.
#[cfg(windows)]
pub(crate) struct ReadFileUV {
    pub(crate) loop_: *mut libuv::uv_loop_t,
    _keep_alive: bun_io::JsKeepAlive,
    pub(crate) file_store: FileStore,
    pub(crate) store: RefPtr<Store>,
    pub offset: SizeType,
    pub(crate) max_length: SizeType,
    pub(crate) opened_fd: StreamFd,
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
        let file_store = store.data.as_file().clone();
        let mut this = Box::new(ReadFileUV {
            loop_: cx.global().bun_vm().event_loop().uv_loop().cast(),
            _keep_alive: bun_io::JsKeepAlive::active(),
            file_store,
            store, // store.ref() — Arc clone owned here
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            opened_fd: StreamFd::borrowed(Fd::INVALID),
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
        if let PathOrFileDescriptor::Fd(fd) = this.file_store.pathlike {
            this.opened_fd = StreamFd::borrowed(fd);
            this.queue_stat();
        } else {
            this.open();
        }
    }

    fn open(self: Box<Self>) {
        let mut buf = bun_paths::path_buffer_pool::get();
        let path = self.file_store.pathlike.path().slice_z(&mut buf).as_ptr();

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

        this.opened_fd = bun_sys::File::from_fd(Fd::from_uv(result.to_fd())).into();
        this.queue_stat();
    }

    fn on_open_error(mut self: Box<Self>, errno: bun_sys::E) {
        let path = self.file_store.pathlike.path();
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
            Err(Box::new(err))
        } else {
            Ok(core::mem::take(&mut self.buffer).into_boxed_slice())
        };

        // The completion must run BEFORE the cleanup below (store deref /
        // box drop / keep-alive) — it may inspect store. A libuv callback returns void: an
        // exception the JS side left pending is reported here (a termination just stands down).
        crate::dispatch::fold(completion.complete(result));

        drop(self);
        log!("ReadFileUV.finalize destroy");
    }

    fn on_finish(mut self: Box<Self>) {
        log!("ReadFileUV.onFinish");
        self.opened_fd = StreamFd::borrowed(Fd::INVALID);
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

        let (loop_, fd) = (self.loop_, self.opened_fd.get().uv());
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

        // keep in sync with ReadFile::open
        if let Data::File(file) = Store::data_mut(&this.store) {
            // `uv_timespec_t` fields are `c_long` (i32 on Windows); widen to the
            // platform-width `isize` `to_js_time` expects.
            file.last_modified =
                jsc::to_js_time(stat.mtime().sec as isize, stat.mtime().nsec as isize);
        }

        if bun_sys::S::ISDIR(u32::try_from(stat.mode()).expect("int cast")) {
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
            match bun_sys::set_file_offset(this.opened_fd.get(), this.offset) {
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

            let (loop_, fd) = (self.loop_, self.opened_fd.get().uv());
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
            this.buffer
                .uv_commit(usize::try_from(result.int()).expect("int cast"))
        };

        this.req.deinit();
        this.queue_read();
    }
}
