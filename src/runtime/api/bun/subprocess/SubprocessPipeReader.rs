use core::ptr::NonNull;

use bun_aio::Loop as AsyncLoop;
use bun_io::BufferedReader;
use bun_io::FilePollFlag;
use bun_io::max_buf::MaxBuf;
use bun_io::pipe_reader::{BufferedReaderParent, PosixFlags};
use bun_io::pipes::ReadState;
use bun_jsc::event_loop::EventLoop;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult, MarkedArrayBuffer};
use bun_ptr::{IntrusiveRc, RefCount, RefCounted};
use crate::webcore::ReadableStream;
use bun_sys;

use super::readable::Readable;
use super::{StdioKind, StdioResult, Subprocess};

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
    // TODO(port): lifetime — backref to owning Subprocess; cleared in detach()/onReaderDone()/onReaderError().
    // NonNull is a raw pointer; `'static` erases the borrow-checker lifetime since this is only
    // dereferenced unsafely while the owning Subprocess is known-live.
    pub process: Option<NonNull<Subprocess<'static>>>,
    // TODO(port): lifetime — long-lived borrow of the VM's event loop
    pub event_loop: NonNull<EventLoop>,
    /// Intrusive refcount field for `bun_ptr::IntrusiveRc<PipeReader>`.
    pub ref_count: RefCount<PipeReader>,
    pub state: State,
    pub stdio_result: StdioResult,
}

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive, single-thread.
impl RefCounted for PipeReader {
    type DestructorCtx = ();
    fn debug_name() -> &'static str {
        "PipeReader"
    }
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live PipeReader; field projection is in-bounds.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: refcount hit zero; we are the last owner of this heap allocation
        // created in `create()` via Box::into_raw.
        unsafe { PipeReader::deinit(this) };
    }
}

// `pub const ref/deref = RefCount.ref/deref` — thin forwarders so existing call
// sites (`self.r#ref()` / `PipeReader::deref(ptr)`) keep working.
impl PipeReader {
    #[inline]
    pub fn r#ref(&self) {
        // SAFETY: `self` is live; RefCount::ref_ only touches the interior-mutable
        // `ref_count` cell via raw-ptr field projection.
        unsafe { RefCount::<PipeReader>::ref_(self as *const Self as *mut Self) };
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
    /// via `Box::into_raw`) with `ref_count > 0`. No `&`/`&mut` borrows of `*this`
    /// may outlive this call on the zero path.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { RefCount::<PipeReader>::deref(this) };
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

    /// Clear the `process` backref and drop the ref it represented.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader`; may be freed on return (see `deref`).
    pub unsafe fn detach(this: *mut Self) {
        // SAFETY: `this` is live; raw-ptr field write avoids holding a `&mut` across deref.
        unsafe { (*this).process = None };
        unsafe { PipeReader::deref(this) };
    }

    pub fn create(
        event_loop: NonNull<EventLoop>,
        process: NonNull<Subprocess<'static>>,
        result: StdioResult,
        limit: Option<NonNull<MaxBuf>>,
    ) -> IntrusiveRc<PipeReader> {
        let mut this = Box::new(PipeReader {
            ref_count: RefCount::init(),
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
            (*raw).reader.set_parent(raw as *mut core::ffi::c_void);
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
        process: NonNull<Subprocess<'static>>,
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
            let this_ptr: *mut PipeReader = self;
            let guard = scopeguard::guard((), move |_| {
                // SAFETY: the extra ref taken above keeps `*this_ptr` alive until this
                // guard fires; deref may free it, but no borrow of `self` outlives the guard.
                unsafe { PipeReader::deref(this_ptr) };
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
                        // PORT NOTE: `PollOrFd` is an enum in the Rust port; the Zig
                        // `this.reader.handle.poll` field projection becomes a variant
                        // pattern. `FilePoll` is an opaque vtable-backed handle (Copy)
                        // with `set_flag` standing in for `poll.flags.insert(...)`.
                        if let Some(poll) = self.reader.handle.get_poll() {
                            poll.set_flag(FilePollFlag::Socket);
                            poll.set_flag(FilePollFlag::Nonblocking);
                        }
                        self.reader.flags.insert(
                            PosixFlags::SOCKET | PosixFlags::NONBLOCKING | PosixFlags::POLLABLE,
                        );
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
            unsafe { (*process.as_ptr()).on_close_io(kind) };
            // SAFETY: last use of `self`; raw ptr derived from `&mut self` carries
            // write provenance, and the caller (BufferedReader vtable) holds only a
            // raw parent pointer, so freeing here does not invalidate any live `&mut`.
            unsafe { PipeReader::deref(self) };
        }
    }

    pub fn kind(&self, process: &Subprocess<'_>) -> StdioKind {
        if let Readable::Pipe(pipe) = &process.stdout {
            if core::ptr::eq(pipe.data.as_ptr(), self) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(pipe) = &process.stderr {
            if core::ptr::eq(pipe.data.as_ptr(), self) {
                return StdioKind::Stderr;
            }
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
            unsafe { PipeReader::detach(this_ptr) };
        });

        match &self.state {
            State::Pending => {
                let stream = ReadableStream::from_pipe(global_object, self, &mut self.reader);
                self.state = State::Done(Vec::new());
                stream
            }
            State::Done(_) => {
                // PORT NOTE: reshaped for borrowck — take the payload only in this arm so the
                // Pending arm above observes `state == Pending` when `from_pipe` reads `self`.
                let State::Done(bytes) =
                    core::mem::replace(&mut self.state, State::Done(Vec::new()))
                else {
                    unreachable!()
                };
                ReadableStream::from_owned_slice(global_object, bytes.into_boxed_slice(), 0)
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
                // PORT NOTE: `MarkedArrayBuffer::from_bytes` takes a borrowed `&mut [u8]`
                // with `owns_buffer = true` (freed via mimalloc on the JS side); leak the
                // boxed slice so JS becomes the owner — same pattern as
                // `MarkedArrayBuffer::from_string`.
                let boxed = bytes.into_boxed_slice();
                let len = boxed.len();
                let ptr = Box::into_raw(boxed) as *mut u8;
                // SAFETY: ptr/len from Box::into_raw; backed by global mimalloc.
                let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
                MarkedArrayBuffer::from_bytes(slice, jsc::JSType::Uint8Array)
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
            unsafe { (*process.as_ptr()).on_close_io(kind) };
            // SAFETY: last use of `self`; see `on_reader_done` for rationale.
            unsafe { PipeReader::deref(self) };
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
        // SAFETY: event_loop is valid for the lifetime of this PipeReader; its
        // `virtual_machine` backref is set by the time a PipeReader is created.
        let vm = unsafe { self.event_loop.as_ref() }
            .virtual_machine
            .expect("event_loop.virtual_machine");
        let uws = unsafe { vm.as_ref() }.uws_loop();
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
