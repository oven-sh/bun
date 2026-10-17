//! Similar to `IOWriter` but for reading.
//!
//! *NOTE* This type is reference counted via `Arc`; see the `Drop` impl note.

use core::cell::UnsafeCell;
#[cfg(not(windows))]
use core::ffi::c_void;

use bun_sys::{self as sys, Fd};

use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

// ──────────────────────────────────────────────────────────────────────────
// ChildPtr
// ──────────────────────────────────────────────────────────────────────────

/// In the NodeId-arena port, listeners are identified by `(NodeId, ReaderTag)`
/// — the node id of the owning Cmd plus a tag saying which builtin impl to
/// dispatch the `on_read_chunk`/`on_reader_done` callback to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct ChildPtr {
    pub node: NodeId,
    pub(crate) tag: ReaderTag,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ReaderTag {
    Cat,
}

// PERF: an inline small-vec may be worth it — profile if hot.
type Readers = Vec<ChildPtr>;

// ──────────────────────────────────────────────────────────────────────────
// IOReader
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type ReaderImpl = bun_io::BufferedReader;

struct State {
    fd: Fd,
    /// Bytes read while `readers` was empty. `start()` hands them to the next listener.
    buf: Vec<u8>,
    readers: Readers,
    /// A read error that arrived while `readers` was empty. The next listener gets it in place of its next EOF.
    raw_err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_reading: bool,
    /// The reader reported EOF. The Windows reader closes its source (and the fd) there, so a later listener has nothing to read.
    #[cfg(windows)]
    reached_eof: bool,
    /// `ReaderImpl::start()` is on the stack, and `on_reader_error` keeps what it reports in `start_err`.
    #[cfg(not(windows))]
    starting: bool,
    #[cfg(not(windows))]
    start_err: Option<sys::Error>,
    /// Weak self-ref so `keepalive()` can bump the strong count from `&self`
    /// without unsafe Arc-pointer reconstruction. Set via `Arc::new_cyclic` in
    /// `init()` (the sole constructor).
    self_weak: std::sync::Weak<IOReader>,
    read_guards: Vec<std::sync::Arc<IOReader>>,
    /// Backref so async read callbacks can drive `Yield::run`. See
    /// `IOWriter::interp`.
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
}

pub(crate) struct IOReader {
    /// Its own cell, so that `state()` never overlaps a `&mut ReaderImpl`. `reader()` says which callbacks may reach it.
    reader: UnsafeCell<ReaderImpl>,
    state: UnsafeCell<State>,
}

// SAFETY: shell is single-threaded; `Arc` is used purely for refcounting.
unsafe impl Send for IOReader {}
// SAFETY: shell is single-threaded; `Arc` is used purely for refcounting.
unsafe impl Sync for IOReader {}

impl IOReader {
    #[inline]
    #[allow(clippy::mut_from_ref)] // interior mutability via UnsafeCell; single-threaded
    fn state(&self) -> &mut State {
        // SAFETY: shell is single-threaded; no overlapping borrow of `state`
        // escapes a callback (see struct doc comment).
        unsafe { &mut *self.state.get() }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)] // interior mutability via UnsafeCell; single-threaded
    fn reader(&self) -> &mut ReaderImpl {
        // SAFETY: single-threaded, and never overlapping `state()` (separate cells). The POSIX read loop dispatches its callbacks through a raw pointer and holds no borrow of the reader across them, so a callback may pause it and a command started from a callback may `start()` it; the one dispatch under a `&mut ReaderImpl`, a registration failure reported from inside `ReaderImpl::start()`, is deferred by `on_reader_error`. The Windows reader calls back under its `&mut self`: `on_read_chunk` launders it, so a chunk callback may pause or restart the reader, and after EOF `start()` does not come here. A command started from an error notification does, under the receiver of `WindowsBufferedReader::on_read` (see the note there).
        unsafe { &mut *self.reader.get() }
    }

    /// Bump our own Arc strong count. Held across re-entrant `run_yield` calls
    /// whose child callback may drop the last external ref and free us
    /// mid-method.
    #[inline]
    fn keepalive(&self) -> std::sync::Arc<IOReader> {
        self.state()
            .self_weak
            .upgrade()
            .expect("IOReader::keepalive after last Arc dropped")
    }

    fn push_read_guard(&self) {
        let guard = self.keepalive();
        self.state().read_guards.push(guard);
    }

    fn pop_read_guard(&self) -> Option<std::sync::Arc<IOReader>> {
        self.state().read_guards.pop()
    }

    pub(crate) fn init(fd: Fd, evtloop: EventLoopHandle) -> std::sync::Arc<IOReader> {
        let mut reader = ReaderImpl::init::<IOReader>();
        #[cfg(not(windows))]
        {
            reader
                .flags
                .remove(bun_io::pipe_reader::PosixFlags::CLOSE_HANDLE);
        }
        #[cfg(windows)]
        {
            reader.set_source(bun_io::Source::File(bun_io::Source::open_file(fd)));
        }
        let this = std::sync::Arc::new_cyclic(|w| IOReader {
            reader: UnsafeCell::new(reader),
            state: UnsafeCell::new(State {
                fd,
                buf: Vec::new(),
                readers: Readers::new(),
                raw_err: None,
                evtloop,
                #[cfg(windows)]
                is_reading: false,
                #[cfg(windows)]
                reached_eof: false,
                #[cfg(not(windows))]
                starting: false,
                #[cfg(not(windows))]
                start_err: None,
                self_weak: std::sync::Weak::clone(w),
                read_guards: Vec::new(),
                interp: None,
            }),
        });
        // NOTE: set the parent backref after Arc allocation so the
        // address is stable.
        let parent: *const IOReader = std::sync::Arc::as_ptr(&this);
        // SAFETY: `Arc::as_ptr` yields `*const IOReader`, but every field of
        // `IOReader` is `UnsafeCell`, so all mutation flows through interior
        // mutability (SharedReadWrite). The `*mut` cast exists solely to satisfy
        // `set_parent`'s `*mut` signature for the vtable backref; the
        // `BufferedReaderParent` callbacks only ever reborrow it as `&Self` to
        // call `&self` methods — no `&mut IOReader` is materialized from it.
        unsafe { (*this.reader.get()).set_parent(parent.cast_mut().cast()) };
        crate::shell_log!("IOReader(0x{:x}, fd={}) create", parent as usize, fd);
        this
    }

    /// # Safety
    /// `interp` must be null or point to the live owning `Interpreter` (it
    /// owns the IO struct that holds this `Arc`) for the lifetime of this
    /// reader; single-threaded.
    #[inline]
    pub(crate) fn set_interp(&self, interp: *mut Interpreter) {
        // SAFETY: precondition above.
        self.state().interp = unsafe { bun_ptr::ParentRef::from_nullable(interp) };
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.state().fd
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let s = self.state();
        core::mem::size_of::<IOReader>()
            + s.buf.capacity()
            + s.readers.capacity() * core::mem::size_of::<ChildPtr>()
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_event_loop::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; vtable consumers treat the pointee as read-only
        self.state().evtloop.as_event_loop_ctx()
    }

    /// Only does things on windows.
    #[inline]
    fn set_reading(&self, reading: bool) {
        #[cfg(windows)]
        {
            self.state().is_reading = reading;
        }
        let _ = reading;
    }

    /// Idempotent function to start the reading for the listeners that `add_reader` registered.
    pub(crate) fn start(&self) -> Yield {
        #[cfg(not(windows))]
        {
            let r = self.reader();
            r.unpause();
            // A `cat` that starts after a failed read reads the fd again.
            r.flags.remove(bun_io::pipe_reader::PosixFlags::READ_FAILED);
            if !r.has_pending_read() {
                let fd = self.state().fd;
                self.state().starting = true;
                let started = r.start(fd, true);
                let s = self.state();
                s.starting = false;
                if let Some(e) = s.start_err.take().or_else(|| started.err()) {
                    return self.complete_listeners(Some(&e));
                }
            }
            self.hand_over_parked()
        }
        #[cfg(windows)]
        {
            let s = self.state();
            if s.reached_eof {
                return self.complete_listeners(None);
            }
            if s.is_reading {
                return Yield::suspended();
            }
            s.is_reading = true;
            if let Err(e) = self.reader().start_with_current_pipe() {
                self.set_reading(false);
                return self.complete_listeners(Some(&e));
            }
            self.hand_over_parked()
        }
    }

    /// Only adds if not already present.
    pub(crate) fn add_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if !s.readers.contains(&reader) {
            s.readers.push(reader);
        }
    }

    /// Unregister a listener; no-op if it was never added.
    pub(crate) fn remove_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if let Some(idx) = s.readers.iter().position(|r| *r == reader) {
            // Keeps the order: `deliver` relies on it.
            s.readers.remove(idx);
            if s.readers.is_empty() {
                self.pause();
            }
        }
    }

    /// Stops the reads while nobody listens, so that unread input stays in the fd for the next reader. Only `start()` resumes.
    fn pause(&self) {
        // A read that is out cannot be taken back: its chunk is parked when it completes.
        #[cfg(windows)]
        if self.reader().has_pending_read() {
            return;
        }
        self.reader().pause();
    }

    /// The `BufferedReader.onReadChunk` hook.
    fn on_read_chunk_cb(&self, chunk: &[u8], has_more: bun_io::ReadState) -> bool {
        // `dispatch_read_chunk` → `Cat::on_io_reader_chunk` may drop the last
        // external Arc; hold one across the whole body so the trailing
        // `state()` accesses (and `run_yield`'s re-read of `interp`) see live
        // memory.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        if self.state().readers.is_empty() {
            // Read with nobody listening: by the POSIX drain after a hang-up, or by a Windows read that was out when the last listener left.
            self.state().buf.extend_from_slice(chunk);
            self.pause();
            return false;
        }
        let last = self.deliver(chunk);
        self.run_yield(last);

        let should_continue =
            has_more != bun_io::ReadState::Eof && !self.state().readers.is_empty();
        if should_continue {
            self.set_reading(true);
            // No re-arm here: the POSIX read loop re-arms from the `bool` returned below, and on Windows `on_file_read` issues the next read unless the reader is paused (`WindowsBufferedReader::on_read` also clears the chunk buffer).
        }
        should_continue
    }

    fn on_reader_error(&self, err: &sys::Error) {
        #[cfg(not(windows))]
        if self.state().starting {
            // Reported from inside `ReaderImpl::start()`, under its `&mut self`: `start()` completes the listeners when that call has returned.
            self.state().start_err = Some(err.clone());
            return;
        }
        // `dispatch_reader_done` may drop the last external Arc; keep `self`
        // alive across the loop.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        let s = self.state();
        s.raw_err = s.readers.is_empty().then(|| err.clone());
        let interp = s.interp;
        for r in self.take_readers() {
            // Re-derive a fresh SystemError per callee (see
            // IOWriter.on_error note).
            let ee = err.to_shell_system_error();
            self.run_yield(dispatch_reader_done(r, Some(ee), interp));
        }
    }

    fn on_reader_done_cb(&self) {
        // `dispatch_reader_done` → `Cat::on_io_reader_done` drops Cat's
        // `Arc<IOReader>`; if that was the last external ref, `self` is freed
        // mid-loop and `run_yield`'s `state().interp` reads 0xdfdf poison.
        // Hold a strong ref across the body.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        let s = self.state();
        // Set before any notification: the next `cat` can start from inside one.
        #[cfg(windows)]
        {
            s.reached_eof = true;
        }
        if s.readers.is_empty() {
            return;
        }
        let interp = s.interp;
        // `SystemError` isn't `Clone` yet, so we keep the source `sys::Error`
        // (which IS `Clone`) and re-derive a fresh `SystemError` per callee —
        // same approach as `on_reader_error`.
        let raw_err = s.raw_err.take();
        for r in self.take_readers() {
            let ee = raw_err.as_ref().map(|e| e.to_shell_system_error());
            self.run_yield(dispatch_reader_done(r, ee, interp));
        }
    }

    /// Completes every listener from inside `start()`, with `err` or with EOF. The last completion is returned for the caller's trampoline, so `cat`s that complete one after the other from `start()` do not nest one `Yield::run` each.
    fn complete_listeners(&self, err: Option<&sys::Error>) -> Yield {
        let _keepalive = self.keepalive();
        let interp = self.state().interp;
        let mut readers = self.take_readers();
        let last = readers.pop();
        let complete = |r: ChildPtr| {
            let ee = err.map(sys::Error::to_shell_system_error);
            dispatch_reader_done(r, ee, interp)
        };
        for r in readers {
            self.run_yield(complete(r));
        }
        last.map_or(Yield::suspended(), complete)
    }

    /// Gives `chunk` to the listeners that are registered now, and returns the dispatch to the last one for the caller to run. A dispatch can remove its own listener (the ones behind it move up), and a command it starts can add one at the end, which does not get this chunk.
    fn deliver(&self, chunk: &[u8]) -> Yield {
        let mut end = self.state().readers.len();
        let mut i = 0usize;
        while i < end {
            // `state()` is derived again for each access: a dispatch re-enters `add_reader` and `remove_reader`.
            let Some(&r) = self.state().readers.get(i) else {
                break;
            };
            let interp = self.state().interp;
            let mut remove = false;
            let dispatch = dispatch_read_chunk(r, chunk, &mut remove, interp);
            if remove {
                self.remove_reader(r);
            }
            if i + 1 == end {
                return dispatch;
            }
            self.run_yield(dispatch);
            if self.state().readers.get(i) == Some(&r) {
                i += 1;
            } else {
                end -= 1;
            }
        }
        Yield::suspended()
    }

    /// Gives the bytes read with nobody listening to the listeners that `start()` was called for.
    fn hand_over_parked(&self) -> Yield {
        let s = self.state();
        if s.buf.is_empty() || s.readers.is_empty() {
            return Yield::suspended();
        }
        let parked = core::mem::take(&mut s.buf);
        self.deliver(&parked)
    }

    /// The listeners of the read that just ended. They leave the list before they are notified: a notification can start the next `cat`, and an entry left behind would be notified again under a recycled `NodeId`.
    fn take_readers(&self) -> Readers {
        let readers = core::mem::take(&mut self.state().readers);
        // Not on Windows: there these callbacks run under the reader's `&mut self`, and it reads nothing more after EOF or an error.
        #[cfg(not(windows))]
        self.pause();
        readers
    }

    fn run_yield(&self, y: Yield) {
        let Some(interp) = self.state().interp else {
            debug_assert!(
                matches!(y, Yield::Done | Yield::Suspended),
                "IOReader async callback fired without interp backref"
            );
            return;
        };
        // `ParentRef: Deref<Target=Interpreter>` — the interpreter owns the IO
        // struct holding this Arc and outlives every IOReader. Single-threaded.
        y.run(&interp);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderParent — wires the bun_io BufferedReader vtable
// ──────────────────────────────────────────────────────────────────────────

// Derefs `this` only to call `&self` methods, so no `&mut IOReader` is materialized. `reader()` says what the callbacks may do with the reader.
bun_io::impl_buffered_reader_parent! {
    ShellIoReader for IOReader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk_cb(&chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done_cb();
    on_reader_error = |this, err| (*this).on_reader_error(&err);
    loop_           = |this| (*this).io_evtloop().native_loop();
    event_loop      = |this| (*this).io_evtloop();
    ref_            = |this| (*this).push_read_guard();
    deref           = |this| drop((*this).pop_read_guard());
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOReader {
    fn drop(&mut self) {
        // The bun_io read loop brackets every event-loop entry with the
        // parent `ref_`/`deref` hooks (`read_guards`), so the last ref never
        // drops while BufferedReader is still iterating.
        let s = self.state.get_mut();
        let r = self.reader.get_mut();
        if s.fd != Fd::INVALID {
            #[cfg(windows)]
            {
                // windows reader closes the file descriptor
                if r.source.is_some() && !r.source.as_ref().is_some_and(|src| src.is_closed()) {
                    r.close_impl::<false>();
                }
            }
            #[cfg(not(windows))]
            {
                // We cleared CLOSE_HANDLE in init(), so reader Drop will not
                // return the FilePoll to its pool. Do it explicitly (without
                // closing the fd — we own that and close it ourselves below).
                if matches!(r.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                    r.handle.close_impl(None, None::<fn(*mut c_void)>, false);
                }
                let _ = sys::close(s.fd);
            }
        }
        r.disable_keeping_process_alive(());
        // `reader` Drop handles its own deinit.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Hoisted dispatch (NodeId-arena port of `IOReaderChildPtr.onReadChunk` /
// `.onReaderDone`)
// ──────────────────────────────────────────────────────────────────────────

fn dispatch_read_chunk(
    child: ChildPtr,
    chunk: &[u8],
    remove: &mut bool,
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
) -> Yield {
    let Some(interp) = interp else {
        return Yield::suspended();
    };
    let interp = interp.get();
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_chunk(interp, child.node, chunk, remove)
        }
    }
}

fn dispatch_reader_done(
    child: ChildPtr,
    err: Option<sys::SystemError>,
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
) -> Yield {
    let Some(interp) = interp else {
        return Yield::suspended();
    };
    let interp = interp.get();
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_done(interp, child.node, err)
        }
    }
}
