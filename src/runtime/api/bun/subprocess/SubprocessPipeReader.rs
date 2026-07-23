use core::ptr::NonNull;

use crate::webcore::ReadableStream;
use bun_io::BufferedReader;
#[cfg(unix)]
use bun_io::FilePollFlag;
use bun_io::Loop as AsyncLoop;
use bun_io::max_buf::MaxBuf;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult, MarkedArrayBuffer};
#[cfg(not(windows))]
use bun_ptr::ScopedRef;
use bun_ptr::{IntrusiveRc, ParentRef, RefCount};
use bun_sys;

use super::readable::Readable;
use super::{StdioKind, StdioResult, Subprocess};

pub type IOReader = BufferedReader;

#[derive(Default)]
pub enum State {
    #[default]
    Pending,
    Done(Vec<u8>),
    Err(bun_sys::Error),
}

// Intrusive, single-thread ref-count; `deinit` runs when the last ref drops.
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = PipeReader::deinit, debug_name = "PipeReader")]
pub struct PipeReader {
    pub reader: IOReader,
    // Backref to owning Subprocess; cleared in detach()/onReaderDone()/onReaderError().
    // `ParentRef` encapsulates the single unsafe deref behind a safe `Deref`/`get()`;
    // the Subprocess owns this PipeReader (via `Readable::Pipe`) and is guaranteed
    // live whenever `process.is_some()` — see `on_close_io`/`finalize` ordering.
    // `'static` erases the borrow-checker lifetime (Subprocess is heap-pinned).
    pub process: Option<ParentRef<Subprocess<'static>>>,
    // Long-lived borrow of the VM's event loop. The VM (and its embedded
    // `EventLoop`) outlives every PipeReader, so `BackRef` centralises the
    // single unsafe deref behind a safe `Deref`/`get()`.
    pub event_loop: bun_ptr::BackRef<EventLoop>,
    /// Typed enum mirror of `event_loop` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,
    /// Intrusive refcount field for `bun_ptr::IntrusiveRc<PipeReader>`.
    pub ref_count: RefCount<PipeReader>,
    pub state: State,
    pub stdio_result: StdioResult,
}

// `pub const ref/deref = RefCount.ref/deref` — thin forwarders so existing call
// sites (`self.r#ref()` / `PipeReader::deref(ptr)`) keep working.
impl PipeReader {
    #[inline]
    pub(crate) fn r#ref(&self) {
        // SAFETY: `self` is live; RefCount::ref_ only touches the interior-mutable
        // `ref_count` cell via raw-ptr field projection.
        unsafe { RefCount::<PipeReader>::ref_(std::ptr::from_ref::<Self>(self).cast_mut()) };
    }

    /// Decrement the intrusive refcount; frees the allocation when it hits zero.
    ///
    /// Takes a raw `*mut Self` (not `&self`) because the final deref destroys the
    /// allocation — materializing a `&self`/`&mut self` and then writing/freeing
    /// through a pointer derived from it is UB under Stacked Borrows. Callers must
    /// treat `this` as potentially dangling after return.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader` created by `create()` (i.e. boxed
    /// via `heap::alloc`) with `ref_count > 0`. No `&`/`&mut` borrows of `*this`
    /// may outlive this call on the zero path.
    #[inline]
    pub(crate) unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { RefCount::<PipeReader>::deref(this) };
    }
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

    /// Clear the `process` backref and drop the ref it represented.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader`; may be freed on return (see `deref`).
    pub(crate) unsafe fn detach(this: *mut Self) {
        // SAFETY: `this` is live; raw-ptr field write avoids holding a `&mut` across deref.
        unsafe { (*this).process = None };
        // SAFETY: caller contract — `this` is live with refcount > 0; no borrow of `*this` outlives this call.
        unsafe { PipeReader::deref(this) };
    }

    pub(crate) fn create(
        event_loop: NonNull<EventLoop>,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        limit: Option<NonNull<MaxBuf>>,
    ) -> IntrusiveRc<PipeReader> {
        let mut this = Box::new(PipeReader {
            ref_count: RefCount::init(),
            process: Some(ParentRef::from(process)),
            reader: IOReader::init::<PipeReader>(),
            event_loop: event_loop.into(),
            event_loop_handle: bun_jsc::EventLoopHandle::init(event_loop.as_ptr().cast::<()>()),
            stdio_result: result,
            state: State::Pending,
        });
        MaxBuf::add_to_pipereader(limit, &mut this.reader.maxbuf);
        #[cfg(windows)]
        {
            // On Windows `StdioResult` is the `WindowsStdioResult` enum and the
            // `.buffer` payload is a heap-allocated `uv::Pipe`. Ownership
            // transfers to `reader.source`; `stdio_result` is left `Unavailable`.
            if let StdioResult::Buffer(pipe) = this.stdio_result.take() {
                this.reader.source = Some(bun_io::Source::Pipe(pipe));
            }
        }

        let raw: *mut PipeReader = bun_core::heap::into_raw(this);
        // SAFETY: `raw` is a valid, freshly-boxed PipeReader.
        unsafe {
            (*raw).reader.set_parent(raw.cast::<core::ffi::c_void>());
            IntrusiveRc::from_raw(raw)
        }
    }

    pub(crate) fn read_all(&mut self) {
        if matches!(self.state, State::Pending) {
            self.reader.read();
        }
    }

    pub(crate) fn start(
        &mut self,
        process: NonNull<Subprocess<'static>>,
        event_loop: NonNull<EventLoop>,
        lazy: bool,
    ) -> bun_sys::Result<()> {
        self.r#ref();
        self.process = Some(ParentRef::from(process));
        self.event_loop = event_loop.into();
        self.event_loop_handle = bun_jsc::EventLoopHandle::init(event_loop.as_ptr().cast::<()>());
        #[cfg(windows)]
        {
            if lazy {
                // Leave IS_PAUSED set (the init default) so uv_read_start is
                // deferred until JS first pulls; the kernel pipe buffer then
                // provides backpressure and the child blocks.
                let reader_ptr = core::ptr::from_mut(&mut self.reader).cast::<core::ffi::c_void>();
                if let Some(source) = self.reader.source.as_mut() {
                    source.set_data(reader_ptr);
                }
                self.reader
                    .flags
                    .remove(bun_io::pipe_reader::WindowsFlags::IS_DONE);
                return bun_sys::Result::Ok(());
            }
            return self.reader.start_with_current_pipe();
        }

        #[cfg(not(windows))]
        {
            if lazy {
                // Defer poll registration until JS first pulls so the kernel
                // pipe buffer provides backpressure and the child blocks.
                self.reader.flags.insert(PosixFlags::IS_PAUSED);
            }
            // PosixBufferedReader.start() always returns .result, but if poll
            // registration fails it synchronously invokes onReaderError() first,
            // which drops both the Readable.pipe ref (via onCloseIO) and the ref we
            // just took above. Hold one more ref so `this` survives long enough to
            // check state after start() returns.
            //
            // SAFETY: `self` is live; ScopedRef bumps the intrusive refcount and
            // derefs on Drop. The deref may free `*self`, but no borrow of `self`
            // outlives the guard's drop on return.
            let _keepalive = unsafe { ScopedRef::new(std::ptr::from_mut::<PipeReader>(self)) };

            match self.reader.start(self.stdio_result.unwrap(), true) {
                bun_sys::Result::Err(err) => {
                    return bun_sys::Result::Err(err);
                }
                bun_sys::Result::Ok(()) => {
                    #[cfg(unix)]
                    {
                        if matches!(self.state, State::Err(_)) {
                            // onReaderError already ran; `_keepalive`'s Drop on return
                            // will drop the last ref and deinit() closes the handle.
                            return bun_sys::Result::Ok(());
                        }
                        if let Some(poll) = self.reader.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                            poll.set_flag(FilePollFlag::Nonblocking);
                        }
                        self.reader.flags.insert(
                            PosixFlags::SOCKET | PosixFlags::NONBLOCKING | PosixFlags::POLLABLE,
                        );
                    }

                    return bun_sys::Result::Ok(());
                }
            }
        }
    }

    // pub const toJS = toReadableStream;
    pub(crate) fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_readable_stream(global_object)
    }

    pub(crate) fn on_reader_done(&mut self) {
        let owned = self.to_owned_slice();
        self.state = State::Done(owned);
        if let Some(process) = self.process.take() {
            // `process` backref is valid while set; cleared before deref.
            let kind = self.kind(process.get());
            process.on_close_io(kind);
        }
        // SAFETY: last use of `self`; caller holds only a raw parent pointer,
        // so freeing here does not invalidate any live `&mut`.
        unsafe { PipeReader::deref(self) };
    }

    pub(crate) fn kind(&self, process: &Subprocess<'_>) -> StdioKind {
        if let Readable::Pipe(pipe) = process.stdout.get() {
            if core::ptr::eq(pipe.data.as_ptr(), self) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(pipe) = process.stderr.get() {
            if core::ptr::eq(pipe.data.as_ptr(), self) {
                return StdioKind::Stderr;
            }
        }

        unreachable!("We should be either stdout or stderr");
    }

    pub(crate) fn to_owned_slice(&mut self) -> Vec<u8> {
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

    pub(crate) fn to_readable_stream(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        // detach() at scope exit = clear `process` backref + deref. The deref
        // may drop the last ref, so it must run after the result is computed; the backref
        // clear must also wait (from_pipe hands `&mut self.reader` to JS, which may
        // re-enter on_reader_done/on_reader_error and consult `self.process`). Compound
        // side-effect, not pure refcount → defer! is the RAII shape here.
        let this_ptr: *mut PipeReader = self;
        scopeguard::defer! {
            // SAFETY: `self` is valid for the duration of this call; detach() may free it,
            // but only after this defer fires at scope exit when no other borrow remains.
            unsafe { PipeReader::detach(this_ptr) };
        }

        match &self.state {
            State::Pending => {
                // `_parent` is unused in `from_pipe`; pass the raw ptr instead
                // of `self` so borrowck allows `&mut self.reader` alongside it.
                let stream = ReadableStream::from_pipe(global_object, this_ptr, &mut self.reader);
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
                ReadableStream::from_owned_slice(global_object, bytes, 0)
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

    pub(crate) fn to_buffer(&mut self, global_this: &JSGlobalObject) -> JSValue {
        match &mut self.state {
            State::Done(bytes) => {
                let bytes = core::mem::take(bytes);
                // `state.done` is now empty via `take()`.
                // `MarkedArrayBuffer::from_bytes` takes a borrowed `&mut [u8]`
                // with `owns_buffer = true` (freed via mimalloc on the JS side); leak the
                // boxed slice so JS becomes the owner — same pattern as
                // `MarkedArrayBuffer::from_string`.
                let slice: &'static mut [u8] = Box::leak(bytes.into_boxed_slice());
                MarkedArrayBuffer::from_bytes(slice, jsc::JSType::Uint8Array)
                    .to_node_buffer(global_this)
            }
            _ => JSValue::UNDEFINED,
        }
    }

    pub(crate) fn on_reader_error(&mut self, err: bun_sys::Error) {
        // A previous `State::Done` buffer is freed by Drop of the replaced Vec.
        self.state = State::Err(err);
        if let Some(process) = self.process.take() {
            // `process` backref is valid while set; cleared before deref.
            let kind = self.kind(process.get());
            process.on_close_io(kind);
        }
        // SAFETY: last use of `self`; see `on_reader_done`.
        unsafe { PipeReader::deref(self) };
    }

    pub(crate) fn close(&mut self) {
        match self.state {
            State::Pending => {
                self.reader.close();
            }
            State::Done(_) => {}
            State::Err(_) => {}
        }
    }

    pub(crate) fn loop_(&self) -> *mut AsyncLoop {
        // `event_loop.virtual_machine` is set by the time a PipeReader is
        // created. The VM is the per-thread singleton owning `event_loop`, so
        // the `BackRef` invariant (pointee outlives holder) trivially holds.
        let vm = self
            .event_loop
            .virtual_machine
            .map(bun_ptr::BackRef::from)
            .expect("event_loop.virtual_machine");
        let uws = vm.uws_loop();
        #[cfg(windows)]
        {
            // SAFETY: uws loop pointer is live for the VM lifetime.
            unsafe { (*uws).uv_loop }
        }
        #[cfg(not(windows))]
        {
            uws.cast()
        }
    }

    /// Called when ref_count hits zero. Consumes the Box allocation.
    ///
    /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    /// whose generated trait `destructor` upholds the sole-owner contract.
    fn deinit(this: *mut PipeReader) {
        #[cfg(unix)]
        {
            // SAFETY: refcount == 0 ⇒ `this` is the unique owner.
            let this_ref = unsafe { &*this };
            debug_assert!(this_ref.reader.is_done() || matches!(this_ref.state, State::Err(_)));
        }

        // The `state` buffer and `reader` are freed by Drop when the Box drops.

        // SAFETY: `this` was created via heap::alloc in `create()`.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

// BufferedReader vtable parent: `onReaderDone`/`onReaderError`/`loop`/
// `eventLoop` (no `onReadChunk`).
// `on_reader_done`/`on_reader_error` are tail-position (the reader is finished
// with `self`), so `&mut *this` autoref is OK.
bun_io::impl_buffered_reader_parent! {
    SubprocessPipeReader for PipeReader;
    has_on_read_chunk = false;
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(err);
    loop_           = |this| (*this).loop_().cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}
