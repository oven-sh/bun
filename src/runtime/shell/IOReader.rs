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
pub struct ChildPtr {
    pub node: NodeId,
    pub tag: ReaderTag,
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
    buf: Vec<u8>,
    readers: Readers,
    err: Option<sys::SystemError>,
    /// The raw `sys::Error` that produced `err`. `SystemError` is not `Clone`
    /// in the Rust port yet, so we keep the source error to re-derive a fresh
    /// `SystemError` per callee in `on_reader_done_cb`.
    raw_err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_reading: bool,
    started: bool,
    /// Weak self-ref so `keepalive()` can bump the strong count from `&self`
    /// without unsafe Arc-pointer reconstruction. Set via `Arc::new_cyclic` in
    /// `init()` (the sole constructor).
    self_weak: std::sync::Weak<IOReader>,
    /// Backref so async read callbacks can drive `Yield::run`. See
    /// `IOWriter::interp`.
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
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
    /// Drops the last strong ref so the underlying `BufferedReader`
    /// closes on the JS thread.
    ///
    /// # Safety
    /// `this` must be the `Arc::as_ptr` of a live `Arc<IOReader>` whose
    /// strong count was held by the async-deinit task.
    // Forwards `this` to `Arc::decrement_strong_count` without dereferencing;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn deinit_on_main_thread(this: *mut IOReader) {
        // SAFETY: precondition above.
        unsafe { std::sync::Arc::decrement_strong_count(this) };
    }
}

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

    pub fn init(fd: Fd, evtloop: EventLoopHandle) -> std::sync::Arc<IOReader> {
        let mut reader = ReaderImpl::init::<IOReader>();
        #[cfg(not(windows))]
        {
            reader
                .flags
                .remove(bun_io::pipe_reader::PosixFlags::CLOSE_HANDLE);
        }
        #[cfg(windows)]
        {
            reader.source = Some(bun_io::Source::File(bun_io::Source::open_file(fd)));
        }
        let this = std::sync::Arc::new_cyclic(|w| IOReader {
            reader: UnsafeCell::new(reader),
            state: UnsafeCell::new(State {
                fd,
                buf: Vec::new(),
                readers: Readers::new(),
                err: None,
                raw_err: None,
                evtloop,
                #[cfg(windows)]
                is_reading: false,
                started: false,
                self_weak: std::sync::Weak::clone(w),
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
    // Forwards `interp` to `ParentRef::from_nullable_mut` without dereferencing;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn set_interp(&self, interp: *mut Interpreter) {
        // SAFETY: precondition above.
        self.state().interp = unsafe { bun_ptr::ParentRef::from_nullable_mut(interp) };
    }

    #[inline]
    pub fn fd(&self) -> Fd {
        self.state().fd
    }

    #[inline]
    pub fn evtloop(&self) -> EventLoopHandle {
        self.state().evtloop
    }

    pub fn memory_cost(&self) -> usize {
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

    /// Idempotent function to start the reading.
    pub fn start(&self) -> Yield {
        self.state().started = true;
        #[cfg(not(windows))]
        {
            let r = self.reader();
            let need_start = match &r.handle {
                bun_io::pipes::PollOrFd::Closed => true,
                bun_io::pipes::PollOrFd::Poll(p) => !p.is_registered(),
                bun_io::pipes::PollOrFd::Fd(_) => true,
            };
            if need_start {
                let fd = self.state().fd;
                if let Err(e) = r.start(fd, true) {
                    self.on_reader_error(&e);
                }
            }
            return Yield::suspended();
        }
        #[cfg(windows)]
        {
            let s = self.state();
            if s.is_reading {
                return Yield::suspended();
            }
            s.is_reading = true;
            if let Err(e) = self.reader().start_with_current_pipe() {
                self.on_reader_error(&e);
                return Yield::failed();
            }
            Yield::suspended()
        }
    }

    /// Only adds if not already present.
    pub fn add_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if !s.readers.contains(&reader) {
            s.readers.push(reader);
        }
    }

    /// Unregister a listener; no-op if it was never added.
    pub fn remove_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if let Some(idx) = s.readers.iter().position(|r| *r == reader) {
            s.readers.swap_remove(idx);
        }
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
        while i < self.state().readers.len() {
            let r = self.state().readers[i];
            let interp = self.state().interp;
            let mut remove = false;
            self.run_yield(dispatch_read_chunk(r, chunk, &mut remove, interp));
            if remove {
                self.state().readers.swap_remove(i);
            } else {
                i += 1;
            }
        }

        let should_continue = has_more != bun_io::ReadState::Eof;
        if should_continue && !self.state().readers.is_empty() {
            self.set_reading(true);
            // NOTE: no explicit re-arm (`registerPoll()` on posix /
            // `startWithCurrentPipe()` on windows) here: that would re-derive
            // a second `&mut ReaderImpl` while the bun_io read loop still
            // holds one on its stack (PipeReader.rs aliasing contract) —
            // Stacked-Borrows UB.
            // On posix the re-arm is redundant: the read loop re-registers
            // itself after the callback returns based on the `bool` we return
            // (PipeReader.rs:731/755/846/920/986). On Windows the re-arm is
            // also handled by the caller (`on_file_read`'s defer block /
            // `uv_read_start` for streams) — but `startWithCurrentPipe()` had
            // a SECOND load-bearing side effect: `buffer().clearRetainingCapacity()`,
            // which keeps `WindowsBufferedReader._buffer` bounded between
            // chunks. That clear is now performed by
            // `WindowsBufferedReader::on_read` after the streaming chunk is
            // consumed, so we still do nothing here.
        }
        should_continue
    }

    fn on_reader_error(&self, err: &sys::Error) {
        // `dispatch_reader_done` may drop the last external Arc; keep `self`
        // alive across the loop.
        let _keepalive = self.keepalive();
        self.set_reading(false);
        let s = self.state();
        if let Some(old) = s.err.take() {
            old.deref();
        }
        s.err = Some(err.to_shell_system_error());
        s.raw_err = Some(err.clone());
        // NOTE: reshaped for borrowck — copy out before dispatching.
        let readers: Vec<ChildPtr> = s.readers.clone();
        let interp = s.interp;
        for r in readers {
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
        let readers: Vec<ChildPtr> = s.readers.clone();
        let interp = s.interp;
        // `SystemError` isn't `Clone` yet, so we keep the source `sys::Error`
        // (which IS `Clone`) and re-derive a fresh `SystemError` per callee —
        // same approach as `on_reader_error`.
        let raw_err = s.raw_err.clone();
        for r in readers {
            let ee = raw_err.as_ref().map(|e| e.to_shell_system_error());
            self.run_yield(dispatch_reader_done(r, ee, interp));
        }
    }

    fn run_yield(&self, y: Yield) {
        let Some(interp) = self.state().interp else {
            if let Yield::OnIoWriterChunk { err: Some(e), .. } = &y {
                e.deref();
            }
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
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk_cb(chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done_cb();
    on_reader_error = |this, err| (*this).on_reader_error(&err);
    loop_           = |this| (*this).io_evtloop().native_loop();
    event_loop      = |this| (*this).io_evtloop();
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOReader {
    fn drop(&mut self) {
        // With `Arc` the last ref drops after the callback returns, so this
        // does not run from inside a read callback while BufferedReader is
        // still iterating.
        // TODO: revisit if a child callback can drop the last Arc while
        // BufferedReader is still on the stack — would need the
        // EventLoopTask hop once the shell EventLoopHandle shim is real.
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
        if let Some(e) = s.err.take() {
            e.deref();
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
        if let Some(e) = err {
            e.deref();
        }
        return Yield::suspended();
    };
    let interp = interp.get();
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_done(interp, child.node, err)
        }
    }
}
