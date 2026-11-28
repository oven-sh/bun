use core::marker::PhantomData;
#[cfg(not(windows))]
use core::mem::MaybeUninit;

use scopeguard::ScopeGuard;

#[cfg(not(windows))]
use crate::webcore::blob::fd_job::{self, FdJob, FdOp, Step, Target};
#[cfg(not(windows))]
use crate::webcore::blob::store::Data;
use crate::webcore::blob::{Blob, SizeType};
#[cfg(not(windows))]
use crate::webcore::blob::{MAX_SIZE, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_core::String as BunString;
#[cfg(not(windows))]
use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};
#[cfg(not(windows))]
use bun_io::fd_wait::{Interest, JobFd};
#[cfg(not(windows))]
use bun_jsc as jsc;
use bun_jsc::{AnyPromise, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, SystemError};
#[cfg(not(windows))]
use bun_ptr::RefPtr;
#[cfg(not(windows))]
use bun_sys::Fd;

#[cfg(windows)]
pub(crate) use super::windows::ReadFile;

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

/// What a `ReadFile` does with the bytes (or the lack of them): `run` on completion,
/// `cancel` if it is dropped before completing. Exactly one of the two is invoked, once, on the JS
/// thread — it typically owns a promise and a Blob, so this is the job's JS side.
pub(crate) struct PendingReadFileCompletion(
    ScopeGuard<Box<dyn ReadFileCompletion>, fn(Box<dyn ReadFileCompletion>)>,
);

impl PendingReadFileCompletion {
    pub(super) fn new(completion: Box<dyn ReadFileCompletion>) -> Self {
        Self(scopeguard::guard(completion, ReadFileCompletion::cancel))
    }

    pub(super) fn complete(self, bytes: ReadFileResult) -> JsResult<()> {
        ScopeGuard::into_inner(self.0).run(bytes)
    }
}

// SAFETY: it holds JS-thread state (promise, Blob); it is only ever completed or cancelled on
// the JS thread, as a Job's `Js` side.
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
    type Js = PendingReadFileCompletion;

    fn open(&mut self) -> Result<(JobFd, Step), Box<SystemError>> {
        let fd = fd_job::open(&self.file.get(), bun_sys::O::RDONLY, false)?;
        let stat = bun_sys::fstat(fd.get())?;

        if let Data::File(file) = Store::data_mut(&self.store) {
            let mtime = bun_sys::PosixStat::init(&stat).mtime();
            file.last_modified = jsc::to_js_time(mtime.sec as isize, mtime.nsec as isize);
        }

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            return Err(directory_error(&self.file.get()));
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
        // Opening a FIFO lets its writer go on, and closing it at once would break that pipe.
        if self.max_length == 0
            && matches!(fd, JobFd::Opened(_))
            && bun_sys::S::ISFIFO(stat.st_mode as _)
            && self.must_wait(fd.get())
        {
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

    fn step(&mut self, fd: Fd, ready: bool) -> Result<Step, Box<SystemError>> {
        let mut stack_buffer = [const { MaybeUninit::uninit() }; 64 * 1024];
        loop {
            let max = (self.max_length as usize).saturating_sub(self.buffer.len());
            if max == 0 {
                break;
            }
            if !ready && self.must_wait(fd) {
                return Ok(Step::Wait);
            }
            match self.read_some(fd, max, &mut stack_buffer) {
                Ok(0) => break,
                // It may never end.
                Ok(_) if self.could_block => return Ok(Step::Again),
                Ok(_) => {}
                Err(err) if err.get_errno() != bun_sys::E::EAGAIN => {
                    self.buffer = Vec::new();
                    let mut err = Box::<SystemError>::from(err);
                    err.path = path_for_error(&self.file.get());
                    return Err(err);
                }
                Err(_) => {
                    self.could_block = true;
                    return Ok(Step::Again);
                }
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

fn path_for_error(file: &PathOrFileDescriptor<'_>) -> BunString {
    match file {
        PathOrFileDescriptor::Path(path) => BunString::clone_utf8(path.slice()),
        PathOrFileDescriptor::Fd(_) => BunString::EMPTY,
    }
}

pub(super) fn directory_error(file: &PathOrFileDescriptor<'_>) -> Box<SystemError> {
    Box::new(SystemError {
        code: BunString::static_("EISDIR"),
        path: path_for_error(file),
        message: BunString::static_("Directories cannot be read like files"),
        syscall: BunString::static_("read"),
        ..Default::default()
    })
}
