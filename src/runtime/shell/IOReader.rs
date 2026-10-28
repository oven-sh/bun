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

impl ChildPtr {
    /// What a listener that left becomes in a list a loop is walking.
    const GONE: ChildPtr = ChildPtr {
        node: NodeId::NONE,
        tag: ReaderTag::Cat,
    };
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
    buf: Vec<u8>,
    /// Listeners for the in-flight read.
    readers: Readers,
    /// A chunk is being handed to `readers`: a listener that leaves is blanked in place, so the loop keeps its index.
    in_chunk_loop: bool,
    /// Listeners of a read that ended, while they are told. One that leaves is blanked, and the loop skips it.
    delivering: Readers,
    /// Listeners a stop of the script withdrew (`cancel`): each is owed the done that ends it (`next_cancelled`).
    cancelled: Readers,
    /// True while `start()` is on the stack. An error reported meanwhile goes to `start_err`.
    starting: bool,
    start_err: Option<sys::Error>,
    /// The reader is paused until a listener calls `resume()` (see `nobody_ready`).
    paused: bool,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_reading: bool,
    /// True after EOF. The Windows reader closes its source and the fd at EOF, so later listeners can't read.
    #[cfg(windows)]
    reached_eof: bool,
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
    /// Split out of `State` so `state()`'s `&mut State` never overlaps the
    /// `&mut ReaderImpl` the read-loop caller holds while invoking vtable
    /// callbacks (see `BufferedReaderParent` aliasing contract). Both cells
    /// root at SharedReadWrite; callbacks touch only `state` fields.
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
        // SAFETY: single-threaded. Split into its own cell so a `&mut ReaderImpl`
        // held by the bun_io read loop never overlaps a `&mut State` derived in a
        // vtable callback (see struct doc comment).
        //
        // Don't call this from the done/error callback bodies below. `WindowsBufferedReader`
        // (and `PosixBufferedReader::start()` when registration fails synchronously)
        // invokes them while a `&mut ReaderImpl` is live. The POSIX poll dispatch
        // doesn't borrow the reader (raw pointer, copied vtable), so a command
        // started from a done/error notification can `start()` a new read.
        // Both readers dispatch the chunk callback through a raw pointer, so it can pause.
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
                in_chunk_loop: false,
                delivering: Readers::new(),
                cancelled: Readers::new(),
                starting: false,
                start_err: None,
                paused: false,
                evtloop,
                #[cfg(windows)]
                is_reading: false,
                #[cfg(windows)]
                reached_eof: false,
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

    /// Idempotent function to start the reading. The caller's trampoline is on the stack,
    /// so a failure to start is returned as a continuation (see `finish_listeners`).
    pub(crate) fn start(&self) -> Yield {
        #[cfg(windows)]
        if self.state().reached_eof {
            return self.finish_listeners(None);
        }
        self.state().paused = false;
        self.state().starting = true;
        let result = self.start_impl();
        let s = self.state();
        s.starting = false;
        match s.start_err.take().map_or(result, Err) {
            Ok(()) => Yield::suspended(),
            Err(e) => {
                self.set_reading(false);
                self.finish_listeners(Some(&e))
            }
        }
    }

    #[cfg(not(windows))]
    fn start_impl(&self) -> sys::Result<()> {
        let r = self.reader();
        r.unpause();
        // After a read finishes, the one-shot poll has fired but is still registered,
        // so checking `is_registered()` would skip the read a later listener needs.
        if r.has_pending_read() {
            return Ok(());
        }
        let fd = self.state().fd;
        r.start(fd, true)
    }

    #[cfg(windows)]
    fn start_impl(&self) -> sys::Result<()> {
        let s = self.state();
        if s.is_reading {
            return Ok(());
        }
        s.is_reading = true;
        self.reader().start_with_current_pipe()
    }

    /// A listener has written the chunks it got. Reads on if the reader was paused for that.
    pub(crate) fn resume(&self) -> Yield {
        if !self.state().paused {
            return Yield::suspended();
        }
        self.start()
    }

    /// Nobody is left to read for, or every listener still writes the chunks it got. Reading on would drop input, or queue it without bound.
    fn nobody_ready(&self) -> bool {
        let s = self.state();
        s.readers.iter().all(|r| awaits_write(*r, s.interp))
    }

    /// Only adds if not already present.
    pub(crate) fn add_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if !s.readers.contains(&reader) {
            s.readers.push(reader);
        }
    }

    /// Unregister a listener; no-op if it was never added. A done that is on its way to it is not delivered.
    pub(crate) fn remove_reader(&self, reader: ChildPtr) {
        self.leave(reader);
        let s = self.state();
        s.cancelled.retain(|owed| *owed != reader);
        for told in &mut s.delivering {
            if *told == reader {
                *told = ChildPtr::GONE;
            }
        }
    }

    /// A stop of the script withdraws `listener`: it gets no more input, and `next_cancelled` owes it an `ECANCELED` done. Not when a done is already on its way to it.
    pub(crate) fn cancel(&self, listener: ChildPtr) {
        if self.leave(listener) {
            self.state().cancelled.push(listener);
        }
    }

    /// Tells the next listener `cancel` withdrew that its input ended, or `None` when none is left. The caller's trampoline continues with what it returns.
    pub(crate) fn next_cancelled(&self) -> Option<Yield> {
        let s = self.state();
        let listener = s.cancelled.pop()?;
        let err = sys::Error::from_code(sys::E::ECANCELED, sys::Tag::read);
        let interp = s.interp;
        Some(dispatch_reader_done(
            listener,
            Some(err.to_shell_system_error()),
            interp,
        ))
    }

    /// Takes `listener` out of `readers`; `false` when it is not there.
    fn leave(&self, listener: ChildPtr) -> bool {
        let s = self.state();
        let Some(idx) = s.readers.iter().position(|r| *r == listener) else {
            return false;
        };
        if s.in_chunk_loop {
            s.readers[idx] = ChildPtr::GONE;
            return true;
        }
        s.readers.swap_remove(idx);
        // Nobody is left to read for, so the fd is left to the process. (A loop that is telling the listeners is not reading.)
        if s.readers.is_empty() && s.delivering.is_empty() {
            s.paused = true;
            self.set_reading(false);
            self.reader().pause();
        }
        true
    }

    /// The `BufferedReader.onReadChunk` hook.
    fn on_read_chunk_cb(&self, chunk: &[u8], has_more: bun_io::ReadState) -> bool {
        // `dispatch_read_chunk` → `Cat::on_io_reader_chunk` may drop the last
        // external Arc; hold one across the whole body so the trailing
        // `state()` accesses (and `run_yield`'s re-read of `interp`) see live
        // memory.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        // NOTE: reshaped for borrowck — `dispatch_read_chunk`/`run_yield`
        // both re-derive `state()` (and the interpreter callback may re-enter
        // `add_reader`/`remove_reader`), so we must NOT hold a long-lived
        // `&mut State` across the dispatch. Re-derive `state()` per access
        // instead.
        let mut i = 0usize;
        self.state().in_chunk_loop = true;
        while i < self.state().readers.len() {
            let r = self.state().readers[i];
            i += 1;
            if r == ChildPtr::GONE {
                continue;
            }
            let interp = self.state().interp;
            let mut remove = false;
            self.run_yield(dispatch_read_chunk(r, chunk, &mut remove, interp));
            if remove {
                self.leave(r);
            }
        }
        let s = self.state();
        s.in_chunk_loop = false;
        s.readers.retain(|r| *r != ChildPtr::GONE);

        let should_continue = has_more != bun_io::ReadState::Eof;
        if should_continue && self.nobody_ready() {
            self.state().paused = true;
            self.reader().pause();
            return false;
        }
        if should_continue {
            self.set_reading(true);
            // Don't re-arm here (Windows doesn't allow it, see `reader()`). The
            // caller re-arms after we return (on posix, based on the `bool` below),
            // and `WindowsBufferedReader::on_read` clears the chunk buffer.
        }
        should_continue
    }

    fn on_reader_error(&self, err: &sys::Error) {
        // `dispatch_reader_done` may drop the last external Arc; keep `self`
        // alive across the loop.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        if self.state().starting {
            self.state().start_err = Some(err.clone());
            return;
        }
        let tail = self.deliver(Some(err), false);
        debug_assert!(matches!(tail, Yield::Suspended));
    }

    fn on_reader_done_cb(&self) {
        // `dispatch_reader_done` → `Cat::on_io_reader_done` drops Cat's
        // `Arc<IOReader>`; if that was the last external ref, `self` is freed
        // mid-loop and `run_yield`'s `state().interp` reads 0xdfdf poison.
        // Hold a strong ref across the body.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        // Set this before notifying listeners, because a notification can start the next `cat`.
        #[cfg(windows)]
        {
            self.state().reached_eof = true;
        }
        let tail = self.deliver(None, false);
        debug_assert!(matches!(tail, Yield::Suspended));
    }

    /// Reports EOF (`None`) or an error to the listeners from under `start()`. Returns the last
    /// continuation instead of running it, so consecutive `cat`s don't nest `Yield::run` calls.
    fn finish_listeners(&self, err: Option<&sys::Error>) -> Yield {
        let _keepalive = self.keepalive();
        self.deliver(err, true)
    }

    /// Tells the listeners that the read ended (`None` is EOF), after moving them out of `readers`: the next read must not tell a recycled `NodeId`. With `return_last`, the caller's trampoline tells the last one.
    fn deliver(&self, err: Option<&sys::Error>, return_last: bool) -> Yield {
        let s = self.state();
        let interp = s.interp;
        // A delivery that nests in another one (a done starts a `cat` whose reader fails to start) gets its own range.
        let base = s.delivering.len();
        if base == 0 {
            core::mem::swap(&mut s.delivering, &mut s.readers);
        } else {
            let mut ended = core::mem::take(&mut s.readers);
            s.delivering.append(&mut ended);
        }
        let end = s.delivering.len();
        let done = |r| dispatch_reader_done(r, err.map(sys::Error::to_shell_system_error), interp);
        let nested = if return_last {
            end.saturating_sub(1).max(base)
        } else {
            end
        };
        for i in base..nested {
            let r = self.state().delivering[i];
            if r != ChildPtr::GONE {
                self.run_yield(done(r));
            }
        }
        let s = self.state();
        let last = s.delivering[nested..end].first().copied();
        s.delivering.truncate(base);
        match last {
            Some(r) if r != ChildPtr::GONE => done(r),
            _ => Yield::suspended(),
        }
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

// Derefs `this` only to call `&self` inherent methods (autoref → `&*this`);
// no `&mut IOReader` is materialized, satisfying the init() *const→*mut
// invariant. Aliasing with the caller's live `&mut ReaderImpl` is handled by
// the state/reader UnsafeCell split — callbacks touch only `state`, never
// `reader()`.
bun_io::impl_buffered_reader_parent! {
    ShellIoReader for IOReader;
    feature = Shell;
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

fn awaits_write(child: ChildPtr, interp: Option<bun_ptr::ParentRef<Interpreter>>) -> bool {
    let Some(interp) = interp else {
        return false;
    };
    match child.tag {
        ReaderTag::Cat => crate::shell::builtins::cat::Cat::awaits_write(interp.get(), child.node),
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
