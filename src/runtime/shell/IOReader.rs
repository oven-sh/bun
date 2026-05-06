//! Similar to `IOWriter` but for reading.
//!
//! *NOTE* This type is reference counted (via `Arc` in the Rust port). The
//! Zig version queued deinitialization onto the event loop to prevent bugs;
//! see the `Drop` impl note for the Rust equivalent.

#![allow(dead_code)]

use core::cell::UnsafeCell;
use core::ffi::c_void;

use bun_sys::{self as sys, Fd};

use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

// ──────────────────────────────────────────────────────────────────────────
// ChildPtr (NodeId-arena port of Zig TaggedPointerUnion<{Cat}>)
// ──────────────────────────────────────────────────────────────────────────

/// In the NodeId-arena port, listeners are identified by `(NodeId, ReaderTag)`
/// — the node id of the owning Cmd plus a tag saying which builtin impl to
/// dispatch the `on_read_chunk`/`on_reader_done` callback to. Replaces the
/// Zig `TaggedPtrUnion<(Cat,)>`.
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

/// Spec: IOReader.zig `Readers = SmolList(ChildPtr, 4)`.
// PERF(port): was inline-4 small-vec — profile in Phase B.
type Readers = Vec<ChildPtr>;

// ──────────────────────────────────────────────────────────────────────────
// IOReader
// ──────────────────────────────────────────────────────────────────────────

/// Spec: IOReader.zig `ReaderImpl = bun.io.BufferedReader`.
pub type ReaderImpl = bun_io::BufferedReader;

struct State {
    fd: Fd,
    buf: Vec<u8>,
    readers: Readers,
    read: usize,
    err: Option<sys::SystemError>,
    /// The raw `sys::Error` that produced `err`. `SystemError` is not `Clone`
    /// in the Rust port yet, so we keep the source error to re-derive a fresh
    /// `SystemError` per callee in `on_reader_done_cb` (Spec IOReader.zig:189
    /// passes `this.err` ref'd to each child).
    raw_err: Option<sys::Error>,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_reading: bool,
    started: bool,
    /// Backref so async read callbacks can drive `Yield::run`. See
    /// `IOWriter::interp`.
    interp: *mut Interpreter,
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
unsafe impl Sync for IOReader {}

impl IOReader {
    /// Spec: IOReader.zig `__deinit` (body `AsyncDeinitReader` posts back to
    /// main). Drops the last strong ref so the underlying `BufferedReader`
    /// closes on the JS thread.
    pub fn deinit_on_main_thread(this: *mut IOReader) {
        // SAFETY: `this` is the `Arc::as_ptr` whose strong count was held by
        // the async-deinit task.
        unsafe { std::sync::Arc::decrement_strong_count(this) };
    }
}

impl IOReader {
    #[inline]
    fn state(&self) -> &mut State {
        // SAFETY: single-threaded; matches Zig `*IOReader` model.
        unsafe { &mut *self.state.get() }
    }

    pub fn init(fd: Fd, evtloop: EventLoopHandle) -> std::sync::Arc<IOReader> {
        let mut reader = ReaderImpl::init::<IOReader>();
        #[cfg(not(windows))]
        {
            reader.flags.remove(bun_io::pipe_reader::PosixFlags::CLOSE_HANDLE);
        }
        #[cfg(windows)]
        {
            reader.source = Some(bun_io::Source::open_file(fd));
        }
        let this = std::sync::Arc::new(IOReader {
            state: UnsafeCell::new(State {
                fd,
                reader,
                buf: Vec::new(),
                readers: Readers::new(),
                read: 0,
                err: None,
                raw_err: None,
                evtloop,
                #[cfg(windows)]
                is_reading: false,
                started: false,
                interp: core::ptr::null_mut(),
            }),
        });
        // PORT NOTE: set the parent backref after Arc allocation so the
        // address is stable.
        let parent = std::sync::Arc::as_ptr(&this) as *mut IOReader;
        // SAFETY: single owner; address stable for Arc lifetime.
        unsafe { (*parent).state().reader.set_parent(parent.cast()) };
        crate::shell_log!("IOReader(0x{:x}, fd={}) create", parent as usize, fd);
        this
    }

    #[inline]
    pub fn set_interp(&self, interp: *mut Interpreter) {
        self.state().interp = interp;
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

    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        bun_io::EventLoopHandle(self.state().evtloop.0 as *mut c_void)
    }

    /// Only does things on windows. Spec: IOReader.zig `setReading`.
    #[inline]
    fn set_reading(&self, reading: bool) {
        #[cfg(windows)]
        {
            self.state().is_reading = reading;
        }
        let _ = reading;
    }

    /// Idempotent function to start the reading. Spec: IOReader.zig `start`.
    pub fn start(&self) -> Yield {
        let s = self.state();
        s.started = true;
        #[cfg(not(windows))]
        {
            let need_start = match &s.reader.handle {
                bun_io::pipes::PollOrFd::Closed => true,
                bun_io::pipes::PollOrFd::Poll(p) => !p.is_registered(),
                bun_io::pipes::PollOrFd::Fd(_) => true,
            };
            if need_start {
                if let Err(e) = s.reader.start(s.fd, true) {
                    self.on_reader_error(e);
                }
            }
            return Yield::suspended();
        }
        #[cfg(windows)]
        {
            if s.is_reading {
                return Yield::suspended();
            }
            s.is_reading = true;
            if let Err(e) = s.reader.start_with_current_pipe() {
                self.on_reader_error(e);
                return Yield::failed();
            }
            Yield::suspended()
        }
    }

    /// Spec: IOReader.zig `addReader`. Only adds if not already present.
    pub fn add_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if !s.readers.contains(&reader) {
            s.readers.push(reader);
        }
    }

    /// Spec: IOReader.zig `removeReader`.
    pub fn remove_reader(&self, reader: ChildPtr) {
        let s = self.state();
        if let Some(idx) = s.readers.iter().position(|r| *r == reader) {
            s.readers.swap_remove(idx);
        }
    }

    /// Spec: IOReader.zig `onReadChunk` (the `BufferedReader.onReadChunk` hook).
    fn on_read_chunk_cb(&self, chunk: &[u8], has_more: bun_io::ReadState) -> bool {
        self.set_reading(false);
        // PORT NOTE: reshaped for borrowck — `dispatch_read_chunk`/`run_yield`
        // both re-derive `state()` (and the interpreter callback may re-enter
        // `add_reader`/`remove_reader`), so we must NOT hold a long-lived
        // `&mut State` across the dispatch. Re-derive `state()` per access
        // instead, mirroring Zig's `this.readers.len()`/`this.readers.get(i)`
        // pattern (IOReader.zig:143-153).
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
        let s = self.state();
        if should_continue && !s.readers.is_empty() {
            self.set_reading(true);
            #[cfg(not(windows))]
            {
                s.reader.register_poll();
            }
            #[cfg(windows)]
            {
                if let Err(e) = s.reader.start_with_current_pipe() {
                    self.on_reader_error(e);
                    return false;
                }
            }
        }
        should_continue
    }

    /// Spec: IOReader.zig `onReaderError`.
    fn on_reader_error(&self, err: sys::Error) {
        self.set_reading(false);
        let s = self.state();
        s.err = Some(err.to_shell_system_error());
        s.raw_err = Some(err.clone());
        // PORT NOTE: reshaped for borrowck — copy out before dispatching.
        let readers: Vec<ChildPtr> = s.readers.clone();
        let interp = s.interp;
        for r in readers {
            // Spec: `e.ref()` then pass — re-derive a fresh SystemError per
            // callee instead (see IOWriter.on_error note).
            let ee = err.to_shell_system_error();
            self.run_yield(dispatch_reader_done(r, Some(ee), interp));
        }
    }

    /// Spec: IOReader.zig `onReaderDone`.
    fn on_reader_done_cb(&self) {
        self.set_reading(false);
        let s = self.state();
        let readers: Vec<ChildPtr> = s.readers.clone();
        let interp = s.interp;
        // Spec IOReader.zig:189-193: pass `this.err` (ref'd) if set.
        // `SystemError` isn't `Clone` in the Rust port yet, so we kept the
        // source `sys::Error` (which IS `Clone`) and re-derive a fresh
        // `SystemError` per callee — same approach as `on_reader_error`.
        let raw_err = s.raw_err.clone();
        for r in readers {
            let ee = raw_err.as_ref().map(|e| e.to_shell_system_error());
            self.run_yield(dispatch_reader_done(r, ee, interp));
        }
    }

    fn run_yield(&self, y: Yield) {
        let interp = self.state().interp;
        if interp.is_null() {
            debug_assert!(
                matches!(y, Yield::Done | Yield::Suspended),
                "IOReader async callback fired without interp backref"
            );
            return;
        }
        // SAFETY: interp outlives every IOReader. Single-threaded.
        y.run(unsafe { &mut *interp });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderParent — wires the bun_io BufferedReader vtable
// ──────────────────────────────────────────────────────────────────────────

impl bun_io::pipe_reader::BufferedReaderParent for IOReader {
    const HAS_ON_READ_CHUNK: bool = true;
    // SAFETY (all): see `BufferedReaderParent` aliasing contract — `this` is the
    // `*mut Self` registered via `set_parent`; a `&mut` to the embedded reader
    // may be live on the caller's stack. These reborrow `&mut *this` only to
    // forward to inherent impls; further aliasing audit lives with those impls.
    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], has_more: bun_io::ReadState) -> bool {
        unsafe { (*this).on_read_chunk_cb(chunk, has_more) }
    }
    unsafe fn on_reader_done(this: *mut Self) {
        unsafe { (*this).on_reader_done_cb() };
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        unsafe { (*this).on_reader_error(err) };
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        unsafe { (*this).io_evtloop() }.loop_().cast()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        unsafe { (*this).io_evtloop() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Drop (replaces Zig RefCount.deref → asyncDeinit → asyncDeinitCallback)
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOReader {
    fn drop(&mut self) {
        // Spec: IOReader.zig `asyncDeinitCallback`. The async hop guarded
        // against being deref'd from inside a read callback while
        // BufferedReader is still iterating; with `Arc` the last ref drops
        // after the callback returns.
        // TODO(port): revisit if a child callback can drop the last Arc while
        // BufferedReader is still on the stack — would need the
        // EventLoopTask hop once the shell EventLoopHandle shim is real.
        let s = self.state.get_mut();
        if s.fd != Fd::INVALID {
            #[cfg(windows)]
            {
                // windows reader closes the file descriptor
                if s.reader.source.is_some()
                    && !s.reader.source.as_ref().is_some_and(|src| src.is_closed())
                {
                    s.reader.close_impl::<false>();
                }
            }
            #[cfg(not(windows))]
            {
                // We cleared CLOSE_HANDLE in init(), so reader Drop will not
                // return the FilePoll to its pool. Do it explicitly (without
                // closing the fd — we own that and close it ourselves below).
                if matches!(s.reader.handle, bun_io::pipes::PollOrFd::Poll(_)) {
                    s.reader
                        .handle
                        .close_impl(None, None::<fn(*mut c_void)>, false);
                }
                let _ = sys::close(s.fd);
            }
        }
        s.reader.disable_keeping_process_alive(());
        // `s.reader` Drop handles its own deinit.
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
    interp: *mut Interpreter,
) -> Yield {
    if interp.is_null() {
        return Yield::suspended();
    }
    // SAFETY: interp outlives the reader.
    let interp = unsafe { &mut *interp };
    match child.tag {
        ReaderTag::Cat => crate::shell::builtins::cat::Cat::on_io_reader_chunk(
            interp, child.node, chunk, remove,
        ),
    }
}

fn dispatch_reader_done(
    child: ChildPtr,
    err: Option<sys::SystemError>,
    interp: *mut Interpreter,
) -> Yield {
    if interp.is_null() {
        return Yield::suspended();
    }
    // SAFETY: interp outlives the reader.
    let interp = unsafe { &mut *interp };
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_done(interp, child.node, err)
        }
    }
}

/// Public hoisted dispatch (kept for parity with `io_writer::on_io_writer_chunk`).
pub fn on_read_chunk(interp: &mut Interpreter, child: ChildPtr, chunk: &[u8]) -> Yield {
    let mut remove = false;
    match child.tag {
        ReaderTag::Cat => crate::shell::builtins::cat::Cat::on_io_reader_chunk(
            interp, child.node, chunk, &mut remove,
        ),
    }
}

pub fn on_reader_done(
    interp: &mut Interpreter,
    child: ChildPtr,
    err: Option<sys::SystemError>,
) -> Yield {
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_done(interp, child.node, err)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/IOReader.zig (312 lines)
//   confidence: medium
//   notes:      RefCount→Arc; UnsafeCell interior; *mut Interpreter backref
//               for async callbacks (set_interp must be wired by
//               interpreter.rs); AsyncDeinit hop folded into Drop;
//               SystemError ref/Clone pending bun_sys.
// ──────────────────────────────────────────────────────────────────────────
