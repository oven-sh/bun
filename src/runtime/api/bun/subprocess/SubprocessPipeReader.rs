use core::ptr::NonNull;

use crate::webcore::ReadableStream;
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::FilePollFlag;
use bun_io::LoopRef;
use bun_io::max_buf;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_ptr::{ParentRef, RefCount, RefPtr};

use super::readable::Readable;
use super::{StdioKind, StdioResult, Subprocess};

pub(crate) type IOReader = BufferedReader;

#[derive(Default)]
pub(crate) enum State {
    #[default]
    Pending,
    Done(Vec<u8>),
    /// The read failed. The bytes read before the error come first.
    Err(Vec<u8>, bun_sys::Error),
}

// Intrusive, single-thread ref-count; `deinit` runs when the last ref drops.
#[derive(bun_ptr::RefCounted)]
#[ref_count(debug_name = "PipeReader")]
pub(crate) struct PipeReader {
    pub(crate) reader: IOReader,
    // Backref to owning Subprocess; cleared when `Readable::Pipe` lets go of this reader.
    // `ParentRef` encapsulates the single unsafe deref behind a safe `Deref`/`get()`;
    // the Subprocess owns this PipeReader (via `Readable::Pipe`) and is guaranteed
    // live whenever `process.is_some()` — see `on_close_io`/`finalize` ordering.
    // `'static` erases the borrow-checker lifetime (Subprocess is heap-pinned).
    pub(crate) process: Option<ParentRef<Subprocess<'static>>>,
    // Long-lived borrow of the VM's event loop. The VM (and its embedded
    // `EventLoop`) outlives every PipeReader, so `BackRef` centralises the
    // single unsafe deref behind a safe `Deref`/`get()`.
    pub(crate) event_loop: bun_ptr::BackRef<EventLoop>,
    /// Typed enum mirror of `event_loop` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub(crate) event_loop_handle: bun_jsc::EventLoopHandle,
    ref_count: RefCount<PipeReader>,
    /// Held from `start()` until the read ends or moves into a stream.
    pub(crate) start_ref: Option<RefPtr<PipeReader>>,
    pub(crate) state: State,
    pub(crate) stdio_result: StdioResult,
}

impl PipeReader {
    pub(crate) fn memory_cost(&self) -> usize {
        self.reader.memory_cost()
    }

    pub(crate) fn has_pending_activity(&self) -> bool {
        if matches!(self.state, State::Pending) {
            return true;
        }
        self.reader.has_pending_activity()
    }

    pub(crate) fn create(
        event_loop: &EventLoop,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        limit: Option<&max_buf::OwnerRef>,
    ) -> RefPtr<PipeReader> {
        let mut this = Box::new(PipeReader {
            ref_count: RefCount::init(),
            start_ref: None,
            process: Some(ParentRef::from(process)),
            reader: IOReader::init::<PipeReader>(),
            event_loop: bun_ptr::BackRef::new(event_loop),
            event_loop_handle: event_loop.as_handle(),
            stdio_result: result,
            state: State::Pending,
        });
        this.reader.maxbuf = limit.map(max_buf::OwnerRef::for_reader);
        #[cfg(windows)]
        if let StdioResult::Buffer(pipe) = this.stdio_result.take() {
            this.reader.set_source(bun_io::Source::Pipe(pipe));
        }

        let raw: *mut PipeReader = bun_core::heap::into_raw(this);
        // SAFETY: `raw` is a valid, freshly-boxed PipeReader.
        unsafe {
            (*raw).reader.set_parent(raw.cast::<core::ffi::c_void>());
            RefPtr::from_raw(raw)
        }
    }

    pub(crate) fn read_all(&mut self) {
        if matches!(self.state, State::Pending) {
            // SAFETY: `self.reader` is live; `read` is the raw
            // re-entrancy-safe entry (its dispatch runs user JS).
            unsafe { IOReader::read(&raw mut self.reader) };
        }
    }

    /// `pipe` is a ref of the caller's own: a failure releases `start_ref` and the one in `Readable::Pipe`.
    pub(crate) fn start(
        pipe: &RefPtr<Self>,
        process: NonNull<Subprocess<'static>>,
        event_loop: &EventLoop,
        lazy: bool,
    ) {
        let start_ref = pipe.clone();
        let this = Readable::pipe_reader_mut(pipe);
        this.start_ref = Some(start_ref);
        this.process = Some(ParentRef::from(process));
        this.event_loop = bun_ptr::BackRef::new(event_loop);
        this.event_loop_handle = event_loop.as_handle();
        #[cfg(windows)]
        {
            if lazy {
                // Leave IS_PAUSED set (the init default) so uv_read_start is
                // deferred until JS first pulls; the kernel pipe buffer then
                // provides backpressure and the child blocks.
                let reader_ptr = core::ptr::from_mut(&mut this.reader).cast::<core::ffi::c_void>();
                if let Some(source) = this.reader.source.as_mut() {
                    source.set_data(reader_ptr);
                }
                this.reader
                    .flags
                    .remove(bun_io::pipe_reader::WindowsFlags::IS_DONE);
                return;
            }
            if let bun_sys::Result::Err(err) = this.reader.start_with_current_pipe() {
                // Route through the same teardown as a read-callback error
                // (matches POSIX's register_poll failure path): state=Err,
                // detach from the Subprocess via on_close_io, release the
                // start() ref, and let the caller proceed to the sibling pipe.
                // Returning Err would have the caller throw after try_kill
                // without unwinding this pipe or the never-started sibling.
                drop(this.on_reader_error(err));
            }
        }

        #[cfg(not(windows))]
        {
            if lazy {
                // Defer poll registration until JS first pulls so the kernel
                // pipe buffer provides backpressure and the child blocks.
                this.reader.flags.insert(PosixFlags::IS_PAUSED);
            }
            // PosixBufferedReader.start() always returns Ok(()); if poll
            // registration fails it synchronously invokes onReaderError() first.
            let fd = this.stdio_result.take().unwrap().into_raw();
            let _ = this.reader.start(fd, true);

            #[cfg(unix)]
            {
                if matches!(this.state, State::Err(..)) {
                    // onReaderError already ran.
                    return;
                }
                if let Some(poll) = this.reader.handle.get_poll() {
                    poll.set_flag(FilePollFlag::Socket);
                    poll.set_flag(FilePollFlag::Nonblocking);
                }
                this.reader
                    .flags
                    .insert(PosixFlags::SOCKET | PosixFlags::NONBLOCKING | PosixFlags::POLLABLE);
            }
        }
    }

    /// Returns `start_ref`, to be dropped once `self` is no longer borrowed.
    #[must_use]
    fn on_reader_done(&mut self) -> Option<RefPtr<Self>> {
        let start_ref = self.start_ref.take();
        let owned = self.to_owned_slice();
        self.state = State::Done(owned);
        if let Some(process) = self.process.take() {
            let kind = self.kind(process.get());
            process.on_close_io(kind);
        }
        start_ref
    }

    fn kind(&self, process: &Subprocess<'_>) -> StdioKind {
        if let Readable::Pipe(pipe) = process.stdout.get() {
            if core::ptr::eq(pipe.as_ptr(), self) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(pipe) = process.stderr.get() {
            if core::ptr::eq(pipe.as_ptr(), self) {
                return StdioKind::Stderr;
            }
        }

        unreachable!("We should be either stdout or stderr");
    }

    fn to_owned_slice(&mut self) -> Vec<u8> {
        if let State::Done(bytes) = core::mem::replace(&mut self.state, State::Pending) {
            // Take the bytes out and restore Pending — the caller immediately
            // overwrites the state anyway.
            return bytes;
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        let out = core::mem::take(&mut self.reader._buffer);

        if out.capacity() > 0 && out.is_empty() {
            drop(out);
            return Vec::new();
        }

        // Returning the Vec preserves capacity intentionally.
        out
    }

    pub(crate) fn update_ref(&mut self, add: bool) {
        self.reader.update_ref(add);
    }

    pub(crate) fn watch(&mut self) {
        if !self.reader.is_done() {
            self.reader.watch();
        }
    }

    pub(crate) fn to_js(&mut self, cx: &bun_jsc::JsThread<'_>) -> JsResult<JSValue> {
        let this_ptr: *mut PipeReader = self;
        match &self.state {
            State::Pending => {
                // `_parent` is unused in `from_pipe`; pass the raw ptr instead
                // of `self` so borrowck allows `&mut self.reader` alongside it.
                let stream = ReadableStream::from_pipe(cx, this_ptr, &mut self.reader);
                self.state = State::Done(Vec::new());
                stream
            }
            State::Done(_) => {
                // Take the payload only in this arm so the Pending arm above
                // observes `state == Pending` when `from_pipe` reads `self`.
                let State::Done(bytes) =
                    core::mem::replace(&mut self.state, State::Done(Vec::new()))
                else {
                    unreachable!()
                };
                ReadableStream::from_owned_slice(cx, bytes, 0)
            }
            State::Err(..) => {
                let State::Err(bytes, err) =
                    core::mem::replace(&mut self.state, State::Err(Vec::new(), Default::default()))
                else {
                    unreachable!()
                };
                ReadableStream::from_bytes_then_error(cx, bytes, err)
            }
        }
    }

    pub(crate) fn to_buffer(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match &mut self.state {
            State::Done(bytes) => {
                let bytes = core::mem::take(bytes);
                JSValue::create_buffer_from_box(global_this, bytes.into_boxed_slice())
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    /// Returns `start_ref`, like `on_reader_done`.
    #[must_use]
    fn on_reader_error(&mut self, err: bun_sys::Error) -> Option<RefPtr<Self>> {
        let start_ref = self.start_ref.take();
        let owned = self.to_owned_slice();
        // Release the fd now, as EOF does, so a child still writing gets EPIPE.
        self.reader.deinit();
        self.state = State::Err(owned, err);
        if let Some(process) = self.process.take() {
            let kind = self.kind(process.get());
            process.on_close_io(kind);
        }
        start_ref
    }

    pub(crate) fn close(&mut self) {
        match self.state {
            State::Pending => {
                self.reader.close();
            }
            State::Done(_) => {}
            State::Err(..) => {}
        }
    }

    #[cfg(unix)]
    fn loop_(&self) -> LoopRef {
        self.event_loop.native_loop()
    }

    #[cfg(windows)]
    fn loop_(&self) -> LoopRef {
        self.event_loop.vm_ref().uws_loop().uv_loop()
    }
}

impl Drop for PipeReader {
    fn drop(&mut self) {
        #[cfg(unix)]
        debug_assert!(self.reader.is_done() || matches!(self.state, State::Err(..)));
    }
}

// BufferedReader vtable parent: `onReaderDone`/`onReaderError`/`loop`/
// `eventLoop` (no `onReadChunk`).
// `on_reader_done`/`on_reader_error` are tail-position (the reader is finished
// with `self`), so `&mut *this` autoref is OK.
bun_io::impl_buffered_reader_parent! {
    SubprocessPipeReader for PipeReader;
    feature = Spawn;
    has_on_read_chunk = false;
    on_reader_done  = |this| drop((*this).on_reader_done());
    on_reader_error = |this, err| drop((*this).on_reader_error(err));
    loop_           = |this| (*this).loop_();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}
