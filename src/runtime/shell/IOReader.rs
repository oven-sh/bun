//! Similar to `IOWriter` but for reading.
//!
//! *NOTE* This type is reference counted via `Rc`; see the `Drop` impl note.

use bun_jsc::JsCell;
use bun_ptr::{CellRefCounted as _, RefPtr, ThisPtr};
use core::cell::{Cell, RefCell};
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

/// Read callbacks re-enter the reader (`add_reader`/`remove_reader` from a
/// child's chunk handler), so every field is interior-mutable behind `&self`
/// and no borrow is held across a callback.
#[derive(bun_ptr::CellRefCounted)]
pub struct IOReader {
    ref_count: Cell<u32>,
    self_root: bun_ptr::SelfRoot<IOReader>,
    /// The io-layer reader. Its callbacks arrive while the read loop holds a
    /// `&mut` to it (see the `BufferedReaderParent` aliasing contract), so it
    /// sits in its own cell that the callbacks never touch.
    reader: JsCell<ReaderImpl>,
    fd: Fd,
    buf: RefCell<Vec<u8>>,
    readers: RefCell<Readers>,
    /// The raw `sys::Error`. `SystemError` is not `Clone`
    /// in the Rust port yet, so we keep the source error to re-derive a fresh
    /// `SystemError` per callee in `on_reader_done_cb`.
    raw_err: RefCell<Option<sys::Error>>,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_reading: Cell<bool>,
    /// Backref so async read callbacks can drive `Yield::run`. See
    /// `IOWriter::interp`.
    interp: Cell<Option<bun_ptr::ParentRef<Interpreter>>>,
}

impl IOReader {
    #[inline]
    fn this_ptr(&self) -> ThisPtr<IOReader> {
        self.self_root.this_ptr(self)
    }

    pub(crate) fn init(fd: Fd, evtloop: EventLoopHandle) -> IOReaderRef {
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
        let this = RefPtr::new_cyclic(|self_root| IOReader {
            ref_count: Cell::new(1),
            self_root,
            reader: JsCell::new(reader),
            fd,
            buf: RefCell::new(Vec::new()),
            readers: RefCell::new(Readers::new()),
            raw_err: RefCell::new(None),
            evtloop,
            #[cfg(windows)]
            is_reading: Cell::new(false),
            interp: Cell::new(None),
        });
        let parent: *mut IOReader = this.as_ptr();
        this.reader.with_mut(|r| r.set_parent(parent.cast()));
        crate::shell_log!("IOReader(0x{:x}, fd={}) create", parent as usize, fd);
        IOReaderRef(this)
    }

    /// Stash the interpreter backref so async read callbacks can drive
    /// `Yield::run`. `interp` owns (through its IO structs) every handle to
    /// this reader.
    #[inline]
    pub(crate) fn set_interp(&self, interp: &Interpreter) {
        self.interp.set(Some(bun_ptr::ParentRef::new(interp)));
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.fd
    }

    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<IOReader>()
            + self.buf.borrow().capacity()
            + self.readers.borrow().capacity() * core::mem::size_of::<ChildPtr>()
    }

    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_event_loop::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.evtloop.as_event_loop_ctx()
    }

    /// Only does things on windows.
    #[inline]
    fn set_reading(&self, reading: bool) {
        #[cfg(windows)]
        {
            self.is_reading.set(reading);
        }
        let _ = reading;
    }

    /// Idempotent function to start the reading.
    ///
    /// Not called from within a `BufferedReaderParent` callback: the read
    /// loop already holds the reader mutably there.
    pub(crate) fn start(&self) -> Yield {
        #[cfg(not(windows))]
        {
            let fd = self.fd;
            let res = self.reader.with_mut(|r| {
                let need_start = match &r.handle {
                    bun_io::pipes::PollOrFd::Closed => true,
                    bun_io::pipes::PollOrFd::Poll(p) => !p.is_registered(),
                    bun_io::pipes::PollOrFd::Fd(_) => true,
                };
                if need_start {
                    r.start(fd, true)
                } else {
                    Ok(())
                }
            });
            if let Err(e) = res {
                self.on_reader_error(&e);
            }
            return Yield::suspended();
        }
        #[cfg(windows)]
        {
            if self.is_reading.get() {
                return Yield::suspended();
            }
            self.is_reading.set(true);
            if let Err(e) = self.reader.with_mut(|r| r.start_with_current_pipe()) {
                self.on_reader_error(&e);
                return Yield::failed();
            }
            Yield::suspended()
        }
    }

    /// Only adds if not already present.
    pub(crate) fn add_reader(&self, reader: ChildPtr) {
        let mut readers = self.readers.borrow_mut();
        if !readers.contains(&reader) {
            readers.push(reader);
        }
    }

    /// Unregister a listener; no-op if it was never added.
    pub(crate) fn remove_reader(&self, reader: ChildPtr) {
        let mut readers = self.readers.borrow_mut();
        if let Some(idx) = readers.iter().position(|r| *r == reader) {
            readers.swap_remove(idx);
        }
    }

    /// The `BufferedReader.onReadChunk` hook.
    fn on_read_chunk_cb(&self, chunk: &[u8], has_more: bun_io::ReadState) -> bool {
        // `dispatch_read_chunk` → `Cat::on_io_reader_chunk` may drop the last
        // external ref; hold one across the whole body so the trailing field
        // accesses (and `run_yield`'s re-read of `interp`) see live memory.
        let _keepalive = self.this_ptr().ref_guard();
        self.set_reading(false);
        // The interpreter callback may re-enter `add_reader`/`remove_reader`,
        // so `readers` is re-borrowed per access rather than held across the
        // dispatch.
        let mut i = 0usize;
        loop {
            let Some(r) = self.readers.borrow().get(i).copied() else {
                break;
            };
            let interp = self.interp.get();
            let mut remove = false;
            self.run_yield(dispatch_read_chunk(r, chunk, &mut remove, interp));
            if remove {
                self.readers.borrow_mut().swap_remove(i);
            } else {
                i += 1;
            }
        }

        let should_continue = has_more != bun_io::ReadState::Eof;
        if should_continue && !self.readers.borrow().is_empty() {
            self.set_reading(true);
            // NOTE: no explicit re-arm (`registerPoll()` on posix /
            // `startWithCurrentPipe()` on windows) here: that would touch the
            // reader while the bun_io read loop still holds it mutably on its
            // stack (PipeReader.rs aliasing contract).
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
        // `dispatch_reader_done` may drop the last external ref; keep `self`
        // alive across the loop.
        let _keepalive = self.this_ptr().ref_guard();
        self.set_reading(false);
        *self.raw_err.borrow_mut() = Some(err.clone());
        // Copy out before dispatching (callbacks may re-enter `remove_reader`).
        let readers: Vec<ChildPtr> = self.readers.borrow().clone();
        let interp = self.interp.get();
        for r in readers {
            // Re-derive a fresh SystemError per callee (see
            // IOWriter.on_error note).
            let ee = err.to_shell_system_error();
            self.run_yield(dispatch_reader_done(r, Some(ee), interp));
        }
    }

    fn on_reader_done_cb(&self) {
        // `dispatch_reader_done` → `Cat::on_io_reader_done` drops Cat's
        // `Rc<IOReader>`; if that was the last external ref, `self` would be
        // freed mid-loop. Hold a strong ref across the body.
        let _keepalive = self.this_ptr().ref_guard();
        self.set_reading(false);
        let readers: Vec<ChildPtr> = self.readers.borrow().clone();
        let interp = self.interp.get();
        // `SystemError` isn't `Clone` yet, so we keep the source `sys::Error`
        // (which IS `Clone`) and re-derive a fresh `SystemError` per callee —
        // same approach as `on_reader_error`.
        let raw_err = self.raw_err.borrow().clone();
        for r in readers {
            let ee = raw_err.as_ref().map(|e| e.to_shell_system_error());
            self.run_yield(dispatch_reader_done(r, ee, interp));
        }
    }

    fn run_yield(&self, y: Yield) {
        let Some(interp) = self.interp.get() else {
            debug_assert!(
                matches!(y, Yield::Done | Yield::Suspended),
                "IOReader async callback fired without interp backref"
            );
            return;
        };
        // `ParentRef: Deref<Target=Interpreter>` — the interpreter owns the IO
        // struct holding this reader and outlives every IOReader. Single-threaded.
        y.run(&interp);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedReaderParent — wires the bun_io BufferedReader vtable
// ──────────────────────────────────────────────────────────────────────────

// Every hook views `this` as `&Self` (via `ThisPtr`); no `&mut IOReader` is
// materialized. Aliasing with the caller's live `&mut ReaderImpl` is handled
// by the `reader` cell split — callbacks touch only the other fields.
bun_io::impl_buffered_reader_parent! {
    ShellIoReader for IOReader;
    borrow = this;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| this.on_read_chunk_cb(&chunk, has_more);
    on_reader_done  = |this| this.on_reader_done_cb();
    on_reader_error = |this, err| this.on_reader_error(&err);
    loop_           = |this| this.io_evtloop().native_loop();
    event_loop      = |this| this.io_evtloop();
    ref_            = |this| this.ref_();
    deref           = |this| IOReader::deref_nn(this.into());
}

/// One owned ref on an [`IOReader`]; clone takes another, drop releases it.
pub struct IOReaderRef(RefPtr<IOReader>);

impl Clone for IOReaderRef {
    fn clone(&self) -> Self {
        IOReaderRef(self.0.dupe_ref())
    }
}

impl Drop for IOReaderRef {
    fn drop(&mut self) {
        self.0.deref();
    }
}

impl core::ops::Deref for IOReaderRef {
    type Target = IOReader;
    #[inline]
    fn deref(&self) -> &IOReader {
        self.0.data()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

impl Drop for IOReader {
    fn drop(&mut self) {
        // The bun_io read loop brackets every event-loop entry with the
        // parent `ref_`/`deref` hooks (our refcount), so the last ref never
        // drops while BufferedReader is still iterating.
        let fd = self.fd;
        self.reader.with_mut(|r| {
            if fd != Fd::INVALID {
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
                    let _ = sys::close(fd);
                }
            }
            r.disable_keeping_process_alive(());
        });
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
