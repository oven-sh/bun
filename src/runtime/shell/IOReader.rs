//! Similar to `IOWriter` but for reading.
//!
//! *NOTE* This type is reference counted via `Rc`; see the `Drop` impl note.

use core::cell::UnsafeCell;

use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult};
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

struct State {
    #[cfg(not(windows))]
    file: sys::CloseOnDrop,
    /// The reader closes it.
    #[cfg(windows)]
    fd: Fd,
    buf: Vec<u8>,
    /// Listeners for the in-flight read (see `take_readers`).
    readers: Readers,
    /// The reader is paused until a listener calls `resume()` (see `nobody_ready`).
    paused: bool,
    evtloop: EventLoopHandle,
    #[cfg(windows)]
    is_reading: bool,
    /// True after EOF. The Windows reader closes its source and the fd at EOF, so later listeners can't read.
    #[cfg(windows)]
    reached_eof: bool,
    /// Weak self-ref so `keepalive()` can bump the strong count from `&self`
    /// without unsafe Rc-pointer reconstruction. Set via `Rc::new_cyclic` in
    /// `init()` (the sole constructor).
    self_weak: std::rc::Weak<IOReader>,
    /// Backref so async read callbacks can drive `Yield::run`. See
    /// `IOWriter::interp`.
    interp: Option<bun_ptr::ParentRef<Interpreter>>,
}

pub(crate) struct IOReader {
    reader: BufferedReader,
    /// After `reader`, whose poll goes before the file.
    state: UnsafeCell<State>,
}

impl IOReader {
    #[inline]
    #[allow(clippy::mut_from_ref)] // interior mutability via UnsafeCell; single-threaded
    fn state(&self) -> &mut State {
        // SAFETY: shell is single-threaded; no overlapping borrow of `state`
        // escapes a callback.
        unsafe { &mut *self.state.get() }
    }

    /// Bump our own Rc strong count. Held across re-entrant `run_yield` calls
    /// whose child callback may drop the last external ref and free us
    /// mid-method.
    #[inline]
    fn keepalive(&self) -> std::rc::Rc<IOReader> {
        self.state()
            .self_weak
            .upgrade()
            .expect("IOReader::keepalive after last Rc dropped")
    }

    pub(crate) fn init(file: sys::File, evtloop: EventLoopHandle) -> std::rc::Rc<IOReader> {
        let fd = file.fd();
        let this = std::rc::Rc::new_cyclic(|w| IOReader {
            reader: BufferedReader::init(),
            state: UnsafeCell::new(State {
                #[cfg(not(windows))]
                file: file.into(),
                #[cfg(windows)]
                fd,
                buf: Vec::new(),
                readers: Readers::new(),
                paused: false,
                evtloop,
                #[cfg(windows)]
                is_reading: false,
                #[cfg(windows)]
                reached_eof: false,
                self_weak: std::rc::Weak::clone(w),
                interp: None,
            }),
        });
        let ptr = std::rc::Rc::as_ptr(&this);
        let owner = Owner::new(PollTag::ShellIoReader, ptr.cast_mut().cast());
        // SAFETY: `owner` points to the heap allocation that holds this reader.
        unsafe { this.reader.set_owner(owner) };
        #[cfg(windows)]
        this.reader
            .set_source(bun_io::Source::File(bun_io::Source::open_file(
                evtloop.loop_(),
                file.into(),
            )));
        crate::shell_log!("IOReader(0x{:x}, fd={}) create", ptr as usize, fd);
        this
    }

    /// `interp` must outlive this reader (it owns the IO struct that holds this `Rc`).
    #[inline]
    pub(crate) fn set_interp(&self, interp: &Interpreter) {
        self.state().interp = Some(bun_ptr::ParentRef::new(interp));
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        #[cfg(not(windows))]
        return self.state().file.fd();
        #[cfg(windows)]
        return self.state().fd;
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let s = self.state();
        core::mem::size_of::<IOReader>()
            + s.buf.capacity()
            + s.readers.capacity() * core::mem::size_of::<ChildPtr>()
    }

    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
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
        match self.start_impl() {
            Ok(()) => Yield::suspended(),
            Err(e) => {
                self.set_reading(false);
                self.finish_listeners(Some(&e))
            }
        }
    }

    #[cfg(not(windows))]
    fn start_impl(&self) -> sys::Result<()> {
        let r = &self.reader;
        let _ = r.unpause();
        // After a read finishes, the one-shot poll has fired but is still registered,
        // so checking `is_registered()` would skip the read a later listener needs.
        if r.has_pending_read() {
            return Ok(());
        }
        let file = sys::MaybeOwnedFile::Borrowed(self.fd());
        match r.start(self.io_evtloop(), file, true)? {
            ReadResult::Err(err) => Err(err),
            ReadResult::Pending | ReadResult::Done => Ok(()),
        }
    }

    #[cfg(windows)]
    fn start_impl(&self) -> sys::Result<()> {
        let s = self.state();
        if s.is_reading {
            return Ok(());
        }
        s.is_reading = true;
        self.reader.start_with_current_pipe()
    }

    /// A listener has written the chunks it got. Reads on if the reader was paused for that.
    pub(crate) fn resume(&self) -> Yield {
        if !self.state().paused {
            return Yield::suspended();
        }
        self.start()
    }

    /// Every listener still writes the chunks it got. Reading on would queue input without bound.
    fn nobody_ready(&self) -> bool {
        let s = self.state();
        !s.readers.is_empty() && s.readers.iter().all(|r| awaits_write(*r, s.interp))
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

    /// A listener may drop every other `Rc`.
    pub(crate) fn on_io(self: &std::rc::Rc<Self>, event: IoEvent) {
        let result = self
            .reader
            .read_chunks(self.io_evtloop(), Some(event), |chunk, state| {
                self.on_read_chunk(&chunk, state)
            });
        match result {
            ReadResult::Pending => {}
            ReadResult::Done => self.on_reader_done(),
            ReadResult::Err(err) => self.on_reader_error(&err),
        }
    }

    fn on_read_chunk(&self, chunk: &[u8], has_more: bun_io::ReadState) -> bool {
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
        if should_continue && self.nobody_ready() {
            self.state().paused = true;
            self.reader.pause();
            return false;
        }
        if should_continue && !self.state().readers.is_empty() {
            // The caller re-arms after we return (on posix, based on the `bool` below).
            self.set_reading(true);
        }
        should_continue
    }

    fn on_reader_error(&self, err: &sys::Error) {
        self.set_reading(false);
        let interp = self.state().interp;
        for r in self.take_readers() {
            // Re-derive a fresh SystemError per callee (see
            // IOWriter.on_error note).
            let ee = err.to_shell_system_error();
            self.run_yield(dispatch_reader_done(r, Some(ee), interp));
        }
    }

    fn on_reader_done(&self) {
        self.set_reading(false);
        // Set this before notifying listeners, because a notification can start the next `cat`.
        #[cfg(windows)]
        {
            self.state().reached_eof = true;
        }
        let interp = self.state().interp;
        for r in self.take_readers() {
            self.run_yield(dispatch_reader_done(r, None, interp));
        }
    }

    /// Reports EOF (`None`) or an error to the listeners from under `start()`. Returns the last
    /// continuation instead of running it, so consecutive `cat`s don't nest `Yield::run` calls.
    fn finish_listeners(&self, err: Option<&sys::Error>) -> Yield {
        let _keepalive = self.keepalive();
        let interp = self.state().interp;
        let mut readers = self.take_readers();
        let last = readers.pop();
        let done = |r| dispatch_reader_done(r, err.map(sys::Error::to_shell_system_error), interp);
        for r in readers {
            self.run_yield(done(r));
        }
        match last {
            Some(r) => done(r),
            None => Yield::suspended(),
        }
    }

    /// Removes and returns the finished read's listeners. The next read would notify a
    /// stale entry again, and by then its `NodeId` may be recycled.
    fn take_readers(&self) -> Readers {
        core::mem::take(&mut self.state().readers)
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
        // struct holding this Rc and outlives every IOReader. Single-threaded.
        y.run(&interp);
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
