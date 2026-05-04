use core::cell::Cell;
use core::ptr::NonNull;

use bun_aio::Loop as AsyncLoop;
use bun_io::BufferedReader;
use bun_jsc::{self as jsc, EventLoop, JSGlobalObject, JSValue, JsResult, MarkedArrayBuffer};
use bun_ptr::IntrusiveRc;
use bun_runtime::webcore::ReadableStream;
use bun_sys;

use super::{MaxBuf, StdioKind, StdioResult, Subprocess};

pub type IOReader = BufferedReader;
pub type Poll = IOReader;

pub enum State {
    Pending,
    Done(Vec<u8>),
    Err(bun_sys::Error),
}

impl Default for State {
    fn default() -> Self {
        State::Pending
    }
}

pub struct PipeReader {
    pub reader: IOReader,
    // TODO(port): lifetime — backref to owning Subprocess; cleared in detach()/onReaderDone()/onReaderError()
    pub process: Option<NonNull<Subprocess>>,
    // TODO(port): lifetime — long-lived borrow of the VM's event loop
    pub event_loop: NonNull<EventLoop>,
    /// Intrusive refcount field for `bun_ptr::IntrusiveRc<PipeReader>`.
    pub ref_count: Cell<u32>,
    pub state: State,
    pub stdio_result: StdioResult,
}

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive, single-thread.
// TODO(port): wire `ref_count` field + `deinit` destructor into `bun_ptr::IntrusiveRc<PipeReader>`.
impl PipeReader {
    #[inline]
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    #[inline]
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: refcount hit zero; we are the last owner of this heap allocation
            // created in `create()` via Box::into_raw.
            unsafe { PipeReader::deinit(self as *const Self as *mut Self) };
        }
    }
}

impl PipeReader {
    pub fn memory_cost(&self) -> usize {
        self.reader.memory_cost()
    }

    pub fn has_pending_activity(&self) -> bool {
        if matches!(self.state, State::Pending) {
            return true;
        }
        self.reader.has_pending_activity()
    }

    pub fn detach(&mut self) {
        self.process = None;
        self.deref();
    }

    pub fn create(
        event_loop: NonNull<EventLoop>,
        process: NonNull<Subprocess>,
        result: StdioResult,
        limit: Option<&mut MaxBuf>,
    ) -> IntrusiveRc<PipeReader> {
        let mut this = Box::new(PipeReader {
            ref_count: Cell::new(1),
            process: Some(process),
            reader: IOReader::init::<PipeReader>(),
            event_loop,
            stdio_result: result,
            state: State::Pending,
        });
        MaxBuf::add_to_pipereader(limit, &mut this.reader.maxbuf);
        #[cfg(windows)]
        {
            this.reader.source = Some(bun_io::Source::Pipe(this.stdio_result.buffer));
        }

        let raw: *mut PipeReader = Box::into_raw(this);
        // SAFETY: `raw` is a valid, freshly-boxed PipeReader.
        unsafe {
            (*raw).reader.set_parent(raw);
            IntrusiveRc::from_raw(raw)
        }
    }

    pub fn read_all(&mut self) {
        if matches!(self.state, State::Pending) {
            self.reader.read();
        }
    }

    pub fn start(
        &mut self,
        process: NonNull<Subprocess>,
        event_loop: NonNull<EventLoop>,
    ) -> bun_sys::Result<()> {
        self.r#ref();
        self.process = Some(process);
        self.event_loop = event_loop;
        #[cfg(windows)]
        {
            return self.reader.start_with_current_pipe();
        }

        #[cfg(not(windows))]
        {
            // PosixBufferedReader.start() always returns .result, but if poll
            // registration fails it synchronously invokes onReaderError() first,
            // which drops both the Readable.pipe ref (via onCloseIO) and the ref we
            // just took above. Hold one more ref so `this` survives long enough to
            // check state after start() returns.
            self.r#ref();
            let guard = scopeguard::guard((), |_| {
                // SAFETY: `self` outlives this scope because of the extra ref taken above.
                // TODO(port): self-deref pattern — verify borrowck permits this; may need raw ptr.
                self.deref();
            });

            // TODO(port): on POSIX `StdioResult` is `Option<Fd>`; `.unwrap()` mirrors Zig `.?`.
            match self.reader.start(self.stdio_result.unwrap(), true) {
                bun_sys::Result::Err(err) => {
                    drop(guard);
                    return bun_sys::Result::Err(err);
                }
                bun_sys::Result::Ok(()) => {
                    #[cfg(unix)]
                    {
                        if matches!(self.state, State::Err(_)) {
                            // onReaderError already ran; the guard deref on return
                            // will drop the last ref and deinit() closes the handle.
                            drop(guard);
                            return bun_sys::Result::Ok(());
                        }
                        let poll = &mut self.reader.handle.poll;
                        poll.flags.insert(bun_aio::PollFlag::Socket);
                        self.reader.flags.socket = true;
                        self.reader.flags.nonblocking = true;
                        self.reader.flags.pollable = true;
                        poll.flags.insert(bun_aio::PollFlag::Nonblocking);
                    }

                    drop(guard);
                    return bun_sys::Result::Ok(());
                }
            }
        }
    }

    // pub const toJS = toReadableStream;
    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_readable_stream(global_object)
    }

    pub fn on_reader_done(&mut self) {
        let owned = self.to_owned_slice();
        self.state = State::Done(owned);
        if let Some(process) = self.process.take() {
            // SAFETY: `process` backref is valid while set; cleared before deref.
            let kind = self.kind(unsafe { process.as_ref() });
            unsafe { process.as_ref().on_close_io(kind) };
            self.deref();
        }
    }

    pub fn kind(&self, process: &Subprocess) -> StdioKind {
        if process.stdout.is_pipe() && core::ptr::eq(process.stdout.pipe(), self) {
            return StdioKind::Stdout;
        }

        if process.stderr.is_pipe() && core::ptr::eq(process.stderr.pipe(), self) {
            return StdioKind::Stderr;
        }

        unreachable!("We should be either stdout or stderr");
    }

    pub fn to_owned_slice(&mut self) -> Vec<u8> {
        if let State::Done(bytes) = core::mem::replace(&mut self.state, State::Pending) {
            // PORT NOTE: reshaped for borrowck — Zig reads `state.done` in place; here we
            // take it out and restore Pending (caller immediately overwrites state anyway).
            return bytes;
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        let out = core::mem::take(&mut self.reader._buffer);

        if out.capacity() > 0 && out.is_empty() {
            drop(out);
            return Vec::new();
        }

        // PERF(port): Zig returns `out.items` (len-only slice) without shrinking capacity;
        // returning the Vec preserves capacity, which is the same intent.
        out
    }

    pub fn update_ref(&mut self, add: bool) {
        self.reader.update_ref(add);
    }

    pub fn watch(&mut self) {
        if !self.reader.is_done() {
            self.reader.watch();
        }
    }

    pub fn to_readable_stream(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // `defer this.detach()` — detach may drop the last ref, so run it after computing the result.
        // TODO(port): self-deref at scope exit; ensure no `&mut self` borrow outlives detach().
        let this_ptr: *mut PipeReader = self;
        let _guard = scopeguard::guard((), move |_| {
            // SAFETY: `self` is valid for the duration of this call; detach() may free it,
            // but only after the guard fires at scope exit when no other borrow remains.
            unsafe { (*this_ptr).detach() };
        });

        match &self.state {
            State::Pending => {
                let stream = ReadableStream::from_pipe(global_object, self, &mut self.reader);
                self.state = State::Done(Vec::new());
                Ok(stream)
            }
            State::Done(_) => {
                // PORT NOTE: reshaped for borrowck — take the payload only in this arm so the
                // Pending arm above observes `state == Pending` when `from_pipe` reads `self`.
                let State::Done(bytes) =
                    core::mem::replace(&mut self.state, State::Done(Vec::new()))
                else {
                    unreachable!()
                };
                Ok(ReadableStream::from_owned_slice(global_object, bytes, 0))
            }
            State::Err(_err) => {
                let empty = ReadableStream::empty(global_object)?;
                ReadableStream::cancel(
                    &ReadableStream::from_js(empty, global_object)?.unwrap(),
                    global_object,
                );
                Ok(empty)
            }
        }
    }

    pub fn to_buffer(&mut self, global_this: &JSGlobalObject) -> JSValue {
        match &mut self.state {
            State::Done(bytes) => {
                let bytes = core::mem::take(bytes);
                // `defer this.state = .{ .done = &.{} }` — state.done is now empty via take().
                MarkedArrayBuffer::from_bytes(bytes, jsc::TypedArrayType::Uint8Array)
                    .to_node_buffer(global_this)
            }
            _ => JSValue::UNDEFINED,
        }
    }

    pub fn on_reader_error(&mut self, err: bun_sys::Error) {
        // Zig: if state == .done, free state.done — handled by Drop of the replaced Vec.
        self.state = State::Err(err);
        if let Some(process) = self.process.take() {
            // SAFETY: `process` backref is valid while set; cleared before deref.
            let kind = self.kind(unsafe { process.as_ref() });
            unsafe { process.as_ref().on_close_io(kind) };
            self.deref();
        }
    }

    pub fn close(&mut self) {
        match self.state {
            State::Pending => {
                self.reader.close();
            }
            State::Done(_) => {}
            State::Err(_) => {}
        }
    }

    pub fn event_loop(&self) -> NonNull<EventLoop> {
        self.event_loop
    }

    // TODO(port): `loop` is a Rust keyword; renamed to `loop_`. Callers (BufferedReader vtable) must match.
    pub fn loop_(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            // SAFETY: event_loop is valid for the lifetime of this PipeReader.
            unsafe { self.event_loop.as_ref() }
                .virtual_machine
                .uws_loop()
                .uv_loop
        }
        #[cfg(not(windows))]
        {
            // SAFETY: event_loop is valid for the lifetime of this PipeReader.
            unsafe { self.event_loop.as_ref() }
                .virtual_machine
                .uws_loop()
        }
    }

    /// Called when ref_count hits zero. Consumes the Box allocation.
    unsafe fn deinit(this: *mut PipeReader) {
        // SAFETY: caller guarantees `this` is the unique owner (refcount == 0).
        let this_ref = unsafe { &mut *this };

        #[cfg(unix)]
        {
            debug_assert!(this_ref.reader.is_done() || matches!(this_ref.state, State::Err(_)));
        }

        #[cfg(windows)]
        {
            // WindowsBufferedReader.onError() never closes the source, and
            // WindowsBufferedReader.deinit() nulls this.source before calling
            // closeImpl so it never actually closes either. Close it here on
            // the error path so the uv.Pipe handle doesn't leak.
            if matches!(this_ref.state, State::Err(_))
                && this_ref.reader.source.is_some()
                && !this_ref.reader.source.as_ref().unwrap().is_closed()
            {
                this_ref.reader.close_impl(false);
            }
            debug_assert!(
                this_ref.reader.source.is_none()
                    || this_ref.reader.source.as_ref().unwrap().is_closed()
            );
        }

        // Zig: if state == .done, free state.done — handled by Drop of `state` when Box drops.
        // Zig: this.reader.deinit() — handled by Drop of `reader` field when Box drops.

        // SAFETY: `this` was created via Box::into_raw in `create()`.
        drop(unsafe { Box::from_raw(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/SubprocessPipeReader.zig (251 lines)
//   confidence: medium
//   todos:      7
//   notes:      intrusive refcount + self-deref patterns (detach/start guard) need raw-ptr review; LIFETIMES.tsv had no rows so process/event_loop use NonNull backrefs
// ──────────────────────────────────────────────────────────────────────────
