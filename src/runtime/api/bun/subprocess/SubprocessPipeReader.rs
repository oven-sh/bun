use core::cell::Cell;
use core::ptr::NonNull;

use crate::webcore::ReadableStream;
#[cfg(unix)]
use bun_io::PosixFlags;
use bun_io::max_buf;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult};
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{JSValue, JsResult};
use bun_ptr::{ParentRef, RefCount, RefPtr};

use super::readable::Readable;
use super::{StdioResult, Subprocess};

// Intrusive, single-thread ref-count; `deinit` runs when the last ref drops.
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "PipeReader")]
pub(crate) struct PipeReader {
    reader: BufferedReader,
    // Backref to owning Subprocess; cleared when `Readable::Pipe` lets go of this reader.
    // `ParentRef` encapsulates the single unsafe deref behind a safe `Deref`/`get()`;
    // the Subprocess owns this PipeReader (via `Readable::Pipe`) and is guaranteed
    // live whenever `process.is_some()` — see `on_read_result`/`finalize` ordering.
    // `'static` erases the borrow-checker lifetime (Subprocess is heap-pinned).
    process: Cell<Option<ParentRef<Subprocess<'static>>>>,
    event_loop: bun_io::EventLoopCtx,
    ref_count: RefCount<PipeReader>,
    /// Held from `start()` until the read ends or moves into a stream.
    start_ref: Cell<Option<RefPtr<PipeReader>>>,
    /// Taken by `start()`.
    #[cfg(unix)]
    stdio_result: Cell<StdioResult>,
}

// The end of the read releases `start_ref` and the ref in `Readable::Pipe`.
impl PipeReader {
    pub(crate) fn memory_cost(&self) -> usize {
        self.reader.memory_cost()
    }

    pub(crate) fn create(
        event_loop: &EventLoop,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        limit: Option<&max_buf::OwnerRef>,
    ) -> RefPtr<PipeReader> {
        let mut reader = BufferedReader::init();
        if let Some(limit) = limit {
            reader.set_maxbuf(limit.for_reader());
        }
        let this = RefPtr::new(PipeReader {
            ref_count: RefCount::init(),
            start_ref: Cell::new(None),
            process: Cell::new(Some(ParentRef::from(process))),
            reader,
            event_loop: event_loop.event_loop_ctx(),
            #[cfg(unix)]
            stdio_result: Cell::new(result),
        });
        let owner = Owner::new(PollTag::SubprocessPipeReader, this.as_ptr().cast());
        // SAFETY: `owner` points to the heap allocation that holds this reader.
        unsafe { this.reader.set_owner(owner) };
        #[cfg(windows)]
        if let StdioResult::Buffer(pipe) = result {
            this.reader.set_source(bun_io::Source::Pipe(pipe));
        }
        this
    }

    /// # Safety
    /// `this` is live. It may be freed.
    pub(crate) unsafe fn on_io(this: *mut Self, event: IoEvent) {
        // SAFETY: fn contract. Filling the buffer releases no ref.
        let result = unsafe { (*this).reader.read((*this).event_loop, Some(event)) };
        if !matches!(result, ReadResult::Pending) {
            // SAFETY: fn contract.
            Self::on_read_result(&unsafe { RefPtr::init_ref(this) }, result);
        }
    }

    pub(crate) fn read_all(this: &RefPtr<Self>) {
        if this.process.get().is_some() {
            Self::on_read_result(this, this.reader.read(this.event_loop, None));
        }
    }

    /// `read_all` for a reader that may be paused.
    pub(crate) fn resume(this: &RefPtr<Self>) {
        if !this.reader.is_done() {
            Self::on_read_result(this, this.reader.unpause());
            Self::read_all(this);
        }
    }

    pub(crate) fn start(this: &RefPtr<Self>, lazy: bool) {
        this.start_ref.set(Some(this.clone()));
        #[cfg(windows)]
        {
            if lazy {
                // Leave IS_PAUSED set (the init default) so uv_read_start is
                // deferred until JS first pulls; the kernel pipe buffer then
                // provides backpressure and the child blocks.
                return;
            }
            if let bun_sys::Result::Err(err) = this.reader.start_with_current_pipe() {
                // As a read error, so that the caller proceeds to the sibling pipe.
                Self::on_read_result(this, ReadResult::Err(err));
            }
        }

        #[cfg(not(windows))]
        {
            // No poll until JS first pulls, so that the child blocks on the pipe.
            this.reader.update_flags(|f| {
                f.set(PosixFlags::IS_PAUSED, lazy);
                f.insert(PosixFlags::SOCKET | PosixFlags::NONBLOCKING);
            });
            let file = this.stdio_result.take().unwrap();
            let started = this.reader.start(this.event_loop, file.into(), true);
            Self::on_read_result(this, started.unwrap_or_else(ReadResult::Err));
        }
    }

    fn on_read_result(this: &RefPtr<Self>, result: ReadResult) {
        let output = match result {
            ReadResult::Pending => return,
            ReadResult::Done => Readable::Buffer(this.reader.take_buffer().into_boxed_slice()),
            ReadResult::Err(err) => {
                let bytes = this.reader.take_buffer().into_boxed_slice();
                // Release the fd now, as EOF does, so a child still writing gets EPIPE.
                this.reader.deinit();
                Readable::Errored(bytes, err)
            }
        };
        this.start_ref.set(None);
        if let Some(process) = this.process.take() {
            process.on_output_read(this, output);
        }
    }

    #[cfg(windows)]
    pub(super) fn inject_error(this: &RefPtr<Self>, err: bun_sys::Error) {
        this.reader.pause();
        Self::on_read_result(this, this.reader.fail(err));
    }

    #[cfg(unix)]
    pub(super) fn inject_error(this: &RefPtr<Self>, err: bun_sys::Error) {
        Self::on_read_result(this, ReadResult::Err(err));
    }

    pub(crate) fn update_ref(&self, add: bool) {
        self.reader.update_ref(add);
    }

    pub(crate) fn watch(this: &RefPtr<Self>) {
        if !this.reader.is_done() {
            Self::on_read_result(this, this.reader.watch(this.event_loop));
        }
    }

    pub(crate) fn close(this: &RefPtr<Self>) {
        Self::on_read_result(this, this.reader.close());
    }

    pub(crate) fn to_js(&self, cx: &bun_jsc::JsThread<'_>) -> JsResult<JSValue> {
        let stream = ReadableStream::from_pipe(cx, &self.reader);
        self.detach();
        self.start_ref.set(None);
        stream
    }

    pub(crate) fn finalize(&self) {
        self.detach();
        #[cfg(unix)]
        if self.start_ref.take().is_some() {
            self.reader.deinit();
        }
    }

    pub(crate) fn detach(&self) {
        self.process.set(None);
    }
}

impl Drop for PipeReader {
    fn drop(&mut self) {
        #[cfg(unix)]
        debug_assert!(self.reader.is_done());
    }
}
