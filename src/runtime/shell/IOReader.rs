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

/// A listener: the node id of the owning Cmd plus a tag saying which builtin
/// impl to dispatch the `on_read_chunk`/`on_reader_done` callback to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChildPtr {
    pub node: NodeId,
    pub(crate) tag: ReaderTag,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReaderTag {
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
    readers: Readers,
    /// What the reader has failed with since it was last started; an
    /// `on_reader_done` after it carries it.
    raw_err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    /// Weak self-ref so `keepalive()` can bump the strong count from `&self`
    /// without unsafe Arc-pointer reconstruction. Set via `Arc::new_cyclic` in
    /// `init()` (the sole constructor).
    self_weak: std::sync::Weak<IOReader>,
    read_guards: Vec<std::sync::Arc<IOReader>>,
    /// The interpreter whose nodes `readers` names. It outlives this reader:
    /// every `Arc<IOReader>` is held by its `root_io`, by one of its nodes, or
    /// on the stack of a callback running under those, and nothing the reader
    /// has in flight holds one.
    interp: bun_ptr::ParentRef<Interpreter>,
}

pub struct IOReader {
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
        // MUST NOT be invoked from within a `BufferedReaderParent` vtable
        // callback (`on_read_chunk_cb`/`on_reader_done_cb`/`on_reader_error`):
        // the read loop already holds a live `&mut ReaderImpl` on its stack
        // while the callback runs (PipeReader.rs aliasing contract), so
        // re-deriving here would create two simultaneous `&mut` to the same
        // BufferedReader = Stacked-Borrows UB.
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

    /// A reader of `fd` (closed with it) whose listeners are nodes of `interp`.
    pub(crate) fn init(fd: Fd, interp: &Interpreter) -> std::sync::Arc<IOReader> {
        let this = std::sync::Arc::new_cyclic(|w| IOReader {
            reader: UnsafeCell::new(ReaderImpl::init::<IOReader>()),
            state: UnsafeCell::new(State {
                fd,
                readers: Readers::new(),
                raw_err: None,
                evtloop: interp.event_loop,
                self_weak: std::sync::Weak::clone(w),
                read_guards: Vec::new(),
                interp: bun_ptr::ParentRef::new(interp),
            }),
        });
        // `fd` stays this IOReader's to close. On Windows the reader closes
        // what it reads from: a HANDLE of its own (see `start_reader`).
        #[cfg(not(windows))]
        this.reader()
            .flags
            .remove(bun_io::pipe_reader::PosixFlags::CLOSE_HANDLE);
        // The parent backref is set after the Arc allocation so the address
        // is stable.
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

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.state().fd
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let s = self.state();
        core::mem::size_of::<IOReader>() + s.readers.capacity() * core::mem::size_of::<ChildPtr>()
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

    /// Idempotent function to start the reading. A reader that has reported
    /// EOF or an error reads again, for the listeners added since.
    pub(crate) fn start(&self) -> Yield {
        let r = self.reader();
        // The poll is one-shot: once it has delivered EOF nothing arms it again,
        // and it still counts as registered.
        #[cfg(not(windows))]
        let need_start = match &r.handle {
            bun_io::pipes::PollOrFd::Closed => true,
            bun_io::pipes::PollOrFd::Poll(p) => !p.is_watching(),
            bun_io::pipes::PollOrFd::Fd(_) => true,
        };
        // A source exists from the first read until EOF; after an error it is
        // still there, finished.
        #[cfg(windows)]
        let need_start =
            r.source.is_none() || r.flags.contains(bun_io::pipe_reader::PosixFlags::IS_DONE);
        if need_start {
            let s = self.state();
            s.raw_err = None;
            let fd = s.fd;
            if let Err(e) = Self::start_reader(r, fd) {
                self.on_reader_error(&e);
            }
        }
        Yield::suspended()
    }

    #[cfg(not(windows))]
    fn start_reader(r: &mut ReaderImpl, fd: Fd) -> sys::Result<()> {
        r.start(fd, true)
    }

    /// A Windows source releases its HANDLE only once the loop has collected
    /// its last operation, which can be after this `IOReader` (and `fd`) is
    /// gone, so it reads through a HANDLE of its own. What `fd` is (a file,
    /// a pipe of either kind, the console) is for the reader to find out.
    #[cfg(windows)]
    fn start_reader(r: &mut ReaderImpl, fd: Fd) -> sys::Result<()> {
        use bun_sys::FdExt as _;
        // Lets go of a source that ended with an error.
        r.deinit();
        let own = sys::dup(fd)?;
        let started = r.start(own, false);
        if started.is_err() {
            own.close();
        }
        started
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
            s.readers.swap_remove(idx);
        }
    }

    /// The `BufferedReader.onReadChunk` hook. The last listener gets `chunk`
    /// itself, to take the bytes if it wants them; the ones before it a view.
    fn on_read_chunk_cb(
        &self,
        chunk: bun_io::pipes::Chunk<'_>,
        has_more: bun_io::ReadState,
    ) -> bool {
        // `dispatch_read_chunk` → `Cat::on_io_reader_chunk` may drop the last
        // external Arc; hold one across the whole body.
        let _keepalive = self.keepalive();
        let interp = self.state().interp;
        // No `&mut State` is held across a dispatch: the callee may re-enter
        // `add_reader`/`remove_reader`.
        let mut remaining = self.state().readers.len();
        let mut chunk = Some(chunk);
        let mut i = 0usize;
        while remaining > 0 {
            remaining -= 1;
            let Some(&r) = self.state().readers.get(i) else {
                break;
            };
            let piece = if remaining == 0 {
                chunk.take()
            } else {
                chunk.as_deref().map(bun_io::pipes::Chunk::Scratch)
            };
            let Some(piece) = piece else { break };
            let mut remove = false;
            self.run_yield(dispatch_read_chunk(r, piece, &mut remove, &interp));
            let readers = &mut self.state().readers;
            if readers.get(i) != Some(&r) {
                // It took itself off the list.
                continue;
            }
            if remove {
                readers.swap_remove(i);
            } else {
                i += 1;
            }
        }

        // No explicit re-arm here: that would re-derive a second
        // `&mut ReaderImpl` while the bun_io read loop still holds one on its
        // stack (PipeReader.rs aliasing contract). The read loop continues by
        // itself after the callback returns.
        has_more != bun_io::ReadState::Eof
    }

    fn on_reader_error(&self, err: &sys::Error) {
        // `dispatch_reader_done` may drop the last external Arc; keep `self`
        // alive across the loop.
        let _keepalive = self.keepalive();
        let s = self.state();
        s.raw_err = Some(err.clone());
        // Copied out: a callee may add or remove listeners.
        let readers: Vec<ChildPtr> = s.readers.clone();
        let interp = s.interp;
        for r in readers {
            self.run_yield(dispatch_reader_done(r, Some(err), &interp));
        }
    }

    fn on_reader_done_cb(&self) {
        // `dispatch_reader_done` → `Cat::on_io_reader_done` drops Cat's
        // `Arc<IOReader>`, which may be the last external one: hold a strong
        // ref across the body.
        let _keepalive = self.keepalive();
        let s = self.state();
        let readers: Vec<ChildPtr> = s.readers.clone();
        let interp = s.interp;
        let raw_err = s.raw_err.clone();
        for r in readers {
            self.run_yield(dispatch_reader_done(r, raw_err.as_ref(), &interp));
        }
    }

    fn run_yield(&self, y: Yield) {
        if matches!(y, Yield::Done | Yield::Suspended) {
            return;
        }
        let interp = self.state().interp;
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
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk_cb(chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done_cb();
    on_reader_error = |this, err| (*this).on_reader_error(&err);
    loop_           = |this| (*this).io_evtloop().loop_();
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
        // Without `CLOSE_HANDLE` (see `init`) the reader's `Drop` does not
        // return the FilePoll to its pool; do that here, leaving the fd open
        // for the `close` below.
        #[cfg(not(windows))]
        if matches!(r.handle, bun_io::pipes::PollOrFd::Poll(_)) {
            r.handle.close_impl(None, None::<fn(*mut c_void)>, false);
        }
        let _ = sys::close(s.fd);
        r.disable_keeping_process_alive(());
        // `reader` Drop handles its own deinit.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Dispatch to a listener by tag
// ──────────────────────────────────────────────────────────────────────────

fn dispatch_read_chunk(
    child: ChildPtr,
    chunk: bun_io::pipes::Chunk<'_>,
    remove: &mut bool,
    interp: &Interpreter,
) -> Yield {
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_chunk(interp, child.node, chunk, remove)
        }
    }
}

fn dispatch_reader_done(child: ChildPtr, err: Option<&sys::Error>, interp: &Interpreter) -> Yield {
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_done(interp, child.node, err)
        }
    }
}
