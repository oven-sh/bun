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
    pub(crate) reader: IOReader,
    // Backref to owning Subprocess; cleared in detach()/finish().
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
    /// Intrusive refcount field for `bun_ptr::IntrusiveRc<PipeReader>`.
    pub(crate) ref_count: RefCount<PipeReader>,
    pub(crate) state: State,
    pub(crate) stdio_result: StdioResult,
}

// `pub const ref/deref = RefCount.ref/deref` — thin forwarders so existing call
// sites (`self.r#ref()` / `PipeReader::deref(ptr)`) keep working.
impl PipeReader {
    #[inline]
    fn r#ref(&self) {
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
    unsafe fn detach(this: *mut Self) {
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
                this.reader.set_source(bun_io::Source::Pipe(pipe));
            }
        }

        let raw: *mut PipeReader = bun_core::heap::into_raw(this);
        // SAFETY: `raw` is a valid, freshly-boxed PipeReader.
        unsafe {
            (*raw).reader.set_parent(raw.cast::<core::ffi::c_void>());
            IntrusiveRc::from_raw(raw)
        }
    }

    /// Drives the reader synchronously. EOF or an error inside the read
    /// reaches `on_reader_done`/`on_reader_error`, which may release the last
    /// ref, so `*this` may be gone on return.
    ///
    /// # Safety
    /// `this` must point to a live, started `PipeReader`; no `&`/`&mut` to
    /// `*this` may be live across the call.
    pub(crate) unsafe fn read_all(this: *mut Self) {
        // SAFETY: caller contract; nothing borrowed from `*this` is held when
        // `read` (the raw re-entrancy-safe entry, whose done/error dispatch may
        // free `*this`) runs.
        unsafe {
            if matches!((*this).state, State::Pending) {
                IOReader::read(&raw mut (*this).reader);
            }
        }
    }

    /// Takes the reader's own ref for the read in flight; `finish` releases it
    /// once the read ends. If registering the pipe fails, `finish` runs before
    /// this returns and `*this` is freed on return, so callers must re-read the
    /// `Readable` slot instead of reusing `this`.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader` from `create()`; no `&`/`&mut`
    /// to `*this` may be live across the call.
    pub(crate) unsafe fn start(
        this: *mut Self,
        process: NonNull<Subprocess<'static>>,
        event_loop: NonNull<EventLoop>,
        lazy: bool,
    ) {
        // SAFETY: caller contract; each borrow ends at its `;`.
        unsafe {
            (*this).r#ref();
            (*this).process = Some(ParentRef::from(process));
            (*this).event_loop = event_loop.into();
            (*this).event_loop_handle =
                bun_jsc::EventLoopHandle::init(event_loop.as_ptr().cast::<()>());
        }
        #[cfg(windows)]
        {
            if lazy {
                // Leave IS_PAUSED set (the init default) so uv_read_start is
                // deferred until JS first pulls; the kernel pipe buffer then
                // provides backpressure and the child blocks.
                // SAFETY: caller contract; only `reader` is borrowed, and the
                // borrow ends with the block.
                unsafe {
                    let reader = &raw mut (*this).reader;
                    if let Some(source) = (*reader).source.as_mut() {
                        source.set_data(reader.cast::<core::ffi::c_void>());
                    }
                    (*reader)
                        .flags
                        .remove(bun_io::pipe_reader::WindowsFlags::IS_DONE);
                }
                return;
            }
            // The failure path below releases both the Readable's ref (via
            // on_close_io) and the ref taken above; the guard keeps `*this`
            // allocated until this returns. Its drop is then the final
            // release, made through `this` with no borrow of `*this` live.
            //
            // SAFETY: caller contract.
            let _keepalive = unsafe { ScopedRef::new(this) };
            // SAFETY: caller contract; the `reader` borrow ends when the call
            // returns.
            let started = unsafe { (*this).reader.start_with_current_pipe() };
            if let bun_sys::Result::Err(err) = started {
                // Route through the same teardown as a read-callback error
                // (matches POSIX's register_poll failure path): state=Err,
                // detach from the Subprocess via on_close_io, release the
                // start() ref, and let the caller proceed to the sibling pipe.
                // Returning Err would have the caller throw after try_kill
                // without unwinding this pipe or the never-started sibling,
                // and on_process_exit's later drain then double-derefs them.
                //
                // SAFETY: `_keepalive` keeps `*this` live across the call; no
                // borrow of `*this` is live.
                unsafe { Self::on_reader_error(this, err) };
            }
        }

        #[cfg(not(windows))]
        {
            if lazy {
                // Defer poll registration until JS first pulls so the kernel
                // pipe buffer provides backpressure and the child blocks.
                //
                // SAFETY: caller contract; the borrow ends at the `;`.
                unsafe { (*this).reader.flags.insert(PosixFlags::IS_PAUSED) };
            }
            // PosixBufferedReader::start() always returns Ok(()); if poll
            // registration fails it dispatches on_reader_error synchronously,
            // which releases both the Readable's ref (via on_close_io) and the
            // ref taken above. The guard keeps `*this` allocated for the state
            // check below; its drop is then the final release, made through
            // `this` with no borrow of `*this` live.
            //
            // SAFETY: caller contract.
            let _keepalive = unsafe { ScopedRef::new(this) };

            // SAFETY: caller contract; the borrow ends at the `;`.
            let fd = unsafe { (*this).stdio_result.unwrap() };
            // SAFETY: caller contract. Only `reader` is borrowed for the call;
            // the on_reader_error it may dispatch reaches the other fields
            // through the raw parent pointer, and the borrow ends on return.
            let _ = unsafe { (*this).reader.start(fd, true) };

            #[cfg(unix)]
            {
                // SAFETY: `_keepalive` keeps `*this` live even if on_reader_error
                // ran inside start(); borrows end at each `;`.
                unsafe {
                    if matches!((*this).state, State::Err(_)) {
                        // on_reader_error already ran; `_keepalive`'s drop
                        // releases the last ref and deinit() closes the handle.
                        return;
                    }
                    if let Some(poll) = (*this).reader.handle.get_poll() {
                        poll.set_flag(FilePollFlag::Socket);
                        poll.set_flag(FilePollFlag::Nonblocking);
                    }
                    (*this).reader.flags.insert(
                        PosixFlags::SOCKET | PosixFlags::NONBLOCKING | PosixFlags::POLLABLE,
                    );
                }
            }
        }
    }

    // pub const toJS = toReadableStream;
    pub(crate) fn to_js(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_readable_stream(global_object)
    }

    /// `BufferedReaderParent::on_reader_done`; see [`Self::finish`] for why it
    /// takes the parent pointer the reader holds rather than `&mut self`.
    ///
    /// # Safety
    /// See [`Self::finish`].
    unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: caller contract; the `&mut` lasts for this call only, and
        // nothing it reaches touches `*this` through another pointer.
        let owned = unsafe { (*this).to_owned_slice() };
        // SAFETY: caller contract.
        unsafe { Self::finish(this, State::Done(owned)) };
    }

    /// `BufferedReaderParent::on_reader_error`; also the teardown `start()`
    /// runs when the pipe cannot be registered.
    ///
    /// # Safety
    /// See [`Self::finish`].
    unsafe fn on_reader_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: caller contract.
        unsafe { Self::finish(this, State::Err(err)) };
    }

    /// Records the terminal `state`, tells the Subprocess this pipe is closed
    /// (which drops the `Readable::Pipe` ref and takes the buffered output
    /// through the Readable's own pointer into `*this`), then releases the ref
    /// `start()` took. That release is normally the last one, so it has to be
    /// made through the pointer the reader registered as its parent: a `&mut
    /// self` receiver would still be live (and, as a function argument,
    /// protected) while the allocation is freed, and `on_close_io`'s access
    /// would alias it.
    ///
    /// # Safety
    /// `this` must point to a live `PipeReader` whose `start()` ref is still
    /// held, with no `&`/`&mut` to `*this` live across the call. `*this` may be
    /// freed on return.
    unsafe fn finish(this: *mut Self, state: State) {
        // SAFETY: caller contract: the guard owns the `start()` ref and
        // releases it when it drops, after the borrows below have ended.
        let _start_ref = unsafe { ScopedRef::adopt(this) };
        // A replaced `State::Done` buffer is freed by the assignment.
        // SAFETY: caller contract; both borrows end inside the block.
        let process = unsafe {
            (*this).state = state;
            (*this).process.take()
        };
        if let Some(process) = process {
            process.on_close_io(Self::kind(this, process.get()));
        }
    }

    /// Which of the Subprocess's slots holds this reader. Compares addresses
    /// only, so it never forms a reference to `*this`.
    fn kind(this: *const Self, process: &Subprocess<'_>) -> StdioKind {
        if let Readable::Pipe(pipe) = process.stdout.get() {
            if core::ptr::eq(pipe.data.as_ptr(), this) {
                return StdioKind::Stdout;
            }
        }

        if let Readable::Pipe(pipe) = process.stderr.get() {
            if core::ptr::eq(pipe.data.as_ptr(), this) {
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

    fn to_readable_stream(&mut self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
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

    pub(crate) fn to_buffer(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
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
            _ => Ok(JSValue::UNDEFINED),
        }
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

    fn loop_(&self) -> *mut AsyncLoop {
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
// `on_reader_done`/`on_reader_error` forward the raw `*mut Self` rather than
// autoref-ing it: they usually free `*this` (see `finish`), which must not
// happen under a `&mut self` receiver.
bun_io::impl_buffered_reader_parent! {
    SubprocessPipeReader for PipeReader;
    has_on_read_chunk = false;
    on_reader_done  = |this| PipeReader::on_reader_done(this);
    on_reader_error = |this, err| PipeReader::on_reader_error(this, err);
    loop_           = |this| (*this).loop_().cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}
