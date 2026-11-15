//! Similar to `IOWriter` but for reading.

use core::marker::PhantomData;
use core::ops::ControlFlow;
use std::rc::Rc;

use bun_io::{BufferedReader, IoEvent, Owner, PollTag, ReadResult};
use bun_sys::{self as sys, Fd};

use crate::shell::interpreter::{EventLoopHandle, ExitCode, Interpreter, NodeId, ShellInterpreter};
use crate::shell::yield_::{DeferredStack, Yield};

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

struct Reader {
    ptr: ChildPtr,
    /// Set by `finish_listeners` (0 at EOF).
    errno: Option<ExitCode>,
}

// PERF: an inline small-vec may be worth it — profile if hot.
type Readers = Vec<Reader>;

// ──────────────────────────────────────────────────────────────────────────
// IOReader
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type IOReaderId = bun_core::GenericIndex<u32, IOReader<'static>>;

pub(crate) struct IOReader<'a> {
    /// `on_reader_io` holds a clone, because a listener may remove the `IOReader` during the read.
    inner: Rc<Inner>,
    id: IOReaderId,
    /// Listeners for the in-flight read.
    readers: Readers,
    /// The reader is paused until a listener calls `resume()` (see `nobody_ready`).
    paused: bool,
    #[cfg(windows)]
    is_reading: bool,
    /// True after EOF. The Windows reader closes its source and the fd at EOF, so later listeners can't read.
    #[cfg(windows)]
    reached_eof: bool,
    /// Keeps it inside its `Interpreter<'a>`.
    _interp: PhantomData<&'a ()>,
}

struct Inner {
    reader: BufferedReader,
    fd: Fd,
    evtloop: EventLoopHandle,
}

impl Inner {
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.evtloop.as_event_loop_ctx()
    }
}

impl IOReader<'_> {
    /// The caller removes it from `interp.io_readers`, which closes `fd`.
    pub(crate) fn init(interp: &mut Interpreter<'_>, fd: Fd) -> IOReaderId {
        let (shell_interp, evtloop) = (interp.as_ctx_ptr(), interp.event_loop);
        interp.io_readers.insert_with(|id| {
            let inner = Rc::new(Inner {
                reader: BufferedReader::init(),
                fd,
                evtloop,
            });
            let ptr = shell_interp.as_ptr().cast();
            let owner = Owner::with_key(PollTag::ShellIoReader, id.get(), ptr);
            // SAFETY: `shell_interp` owns `interp`, and `on_reader_io` borrows it while it holds the
            // only other `Rc`.
            unsafe { inner.reader.set_external_owner(owner) };
            #[cfg(not(windows))]
            inner
                .reader
                .update_flags(|f| f.remove(bun_io::PosixFlags::CLOSE_HANDLE));
            #[cfg(windows)]
            inner
                .reader
                .set_source(bun_io::Source::File(bun_io::Source::open_file(
                    evtloop.loop_(),
                    fd,
                )));
            crate::shell_log!("IOReader({}, fd={}) create", id, fd);
            IOReader {
                inner,
                id,
                readers: Readers::new(),
                paused: false,
                #[cfg(windows)]
                is_reading: false,
                #[cfg(windows)]
                reached_eof: false,
                _interp: PhantomData,
            }
        })
    }

    #[inline]
    pub(crate) fn fd(&self) -> Fd {
        self.inner.fd
    }

    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<IOReader>()
            + core::mem::size_of::<Inner>()
            + self.readers.capacity() * core::mem::size_of::<Reader>()
    }

    /// Only does things on windows.
    #[inline]
    fn set_reading(&mut self, reading: bool) {
        #[cfg(windows)]
        {
            self.is_reading = reading;
        }
        let _ = reading;
    }

    /// Idempotent function to start the reading.
    pub(crate) fn start(&mut self) -> Yield {
        #[cfg(windows)]
        if self.reached_eof {
            return self.finish_listeners(None);
        }
        self.paused = false;
        match self.start_impl() {
            Ok(()) => Yield::suspended(),
            Err(e) => self.finish_listeners(Some(&e)),
        }
    }

    #[cfg(not(windows))]
    fn start_impl(&mut self) -> sys::Result<()> {
        let r = &self.inner.reader;
        let _ = r.unpause();
        // After a read finishes, the one-shot poll has fired but is still registered,
        // so checking `is_registered()` would skip the read a later listener needs.
        if r.has_pending_read() {
            return Ok(());
        }
        match r.start(self.inner.io_evtloop(), self.fd(), true)? {
            ReadResult::Err(err) => Err(err),
            ReadResult::Pending | ReadResult::Done => Ok(()),
        }
    }

    #[cfg(windows)]
    fn start_impl(&mut self) -> sys::Result<()> {
        if self.is_reading {
            return Ok(());
        }
        self.is_reading = true;
        self.inner.reader.start_with_current_pipe()
    }

    /// A listener has written the chunks it got. Reads on if the reader was paused for that.
    pub(crate) fn resume(&mut self) -> Yield {
        if !self.paused {
            return Yield::suspended();
        }
        self.start()
    }

    /// Every listener still writes the chunks it got. Reading on would queue input without bound.
    fn nobody_ready(&self, interp: &Interpreter<'_>) -> bool {
        !self.readers.is_empty() && self.readers.iter().all(|r| awaits_write(r.ptr, interp))
    }

    /// Only adds if not already present.
    pub(crate) fn add_reader(&mut self, reader: ChildPtr) {
        if !self.readers.iter().any(|r| r.ptr == reader) {
            self.readers.push(Reader {
                ptr: reader,
                errno: None,
            });
        }
    }

    /// Unregister a listener; no-op if it was never added.
    pub(crate) fn remove_reader(&mut self, reader: ChildPtr) {
        if let Some(idx) = self.readers.iter().position(|r| r.ptr == reader) {
            self.readers.swap_remove(idx);
        }
    }

    /// Passes `chunk` to `readers[i]`. Past the last listener, breaks with whether to read on.
    fn on_read_chunk(
        interp: &mut Interpreter<'_>,
        id: IOReaderId,
        i: usize,
        chunk: &[u8],
        has_more: bun_io::ReadState,
    ) -> ControlFlow<bool, Yield> {
        let Some(me) = interp.io_readers.get_mut(id) else {
            return ControlFlow::Break(false);
        };
        if i == 0 {
            me.set_reading(false);
        }
        match me.readers.get(i) {
            Some(reader) => ControlFlow::Continue(dispatch_read_chunk(reader.ptr, chunk, interp)),
            None => ControlFlow::Break(Self::should_continue(interp, id, has_more)),
        }
    }

    fn should_continue(
        interp: &mut Interpreter<'_>,
        id: IOReaderId,
        has_more: bun_io::ReadState,
    ) -> bool {
        if has_more == bun_io::ReadState::Eof {
            return false;
        }
        let nobody_ready = interp.io_readers[id].nobody_ready(interp);
        let me = &mut interp.io_readers[id];
        if nobody_ready {
            me.paused = true;
            me.inner.reader.pause();
            return false;
        }
        if !me.readers.is_empty() {
            // The caller re-arms after we return (on posix, based on the `bool` below).
            me.set_reading(true);
        }
        true
    }

    fn on_read_result(&mut self, result: ReadResult) -> Yield {
        match result {
            ReadResult::Pending => Yield::suspended(),
            ReadResult::Done => {
                // Set this before notifying listeners, because a notification can start the next `cat`.
                #[cfg(windows)]
                {
                    self.reached_eof = true;
                }
                self.finish_listeners(None)
            }
            ReadResult::Err(err) => self.finish_listeners(Some(&err)),
        }
    }

    /// Reports EOF (`None`) or an error to the current listeners.
    fn finish_listeners(&mut self, err: Option<&sys::Error>) -> Yield {
        self.set_reading(false);
        let errno = err.map_or(0, |e| e.to_shell_system_error().get_errno() as ExitCode);
        for r in &mut self.readers {
            r.errno.get_or_insert(errno);
        }
        Yield::FinishListeners(self.id)
    }

    /// Removes and notifies the oldest finished listener, and returns whether there are more.
    pub(crate) fn finish_next_listener(
        interp: &mut Interpreter<'_>,
        id: IOReaderId,
    ) -> (Yield, bool) {
        let Some(me) = interp.io_readers.get_mut(id) else {
            return (Yield::suspended(), false);
        };
        let mut finished = (me.readers.iter().enumerate()).filter_map(|(i, r)| Some((i, r.errno?)));
        let Some((idx, errno)) = finished.next() else {
            return (Yield::suspended(), false);
        };
        let more = finished.next().is_some();
        let child = me.readers.remove(idx).ptr;
        (dispatch_reader_done(child, errno, interp), more)
    }
}

impl ShellInterpreter {
    pub(crate) fn on_reader_io(&self, id: IOReaderId, event: IoEvent) {
        let _keep = self.ensure_still_alive();
        let Some(inner) = self.with_interp(|interp| Rc::clone(&interp.io_readers[id].inner)) else {
            return;
        };
        let evtloop = inner.io_evtloop();
        let result = inner
            .reader
            .read_chunks(evtloop, Some(event), |chunk, has_more| {
                // A listener may add or remove listeners, remove the `IOReader` or finish the script.
                let mut i = 0usize;
                loop {
                    match self.with_interp(|interp| {
                        IOReader::on_read_chunk(interp, id, i, &chunk, has_more)
                    }) {
                        Some(ControlFlow::Continue(y)) => self.run_yield(y, DeferredStack::new()),
                        Some(ControlFlow::Break(should_continue)) => return should_continue,
                        None => return false,
                    }
                    i += 1;
                }
            });
        // So that removing the `IOReader` below closes the fd.
        drop(inner);
        self.run_yield_with(|interp| match interp.io_readers.get_mut(id) {
            Some(me) => me.on_read_result(result),
            None => Yield::suspended(),
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Drop
// ──────────────────────────────────────────────────────────────────────────

// The windows reader closes the file descriptor.
#[cfg(not(windows))]
impl Drop for Inner {
    fn drop(&mut self) {
        // The poll goes before its fd.
        self.reader.release_handle();
        if self.fd != Fd::INVALID {
            let _ = sys::close(self.fd);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Hoisted dispatch (NodeId-arena port of `IOReaderChildPtr.onReadChunk` /
// `.onReaderDone`)
// ──────────────────────────────────────────────────────────────────────────

fn dispatch_read_chunk(child: ChildPtr, chunk: &[u8], interp: &mut Interpreter<'_>) -> Yield {
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_chunk(interp, child.node, chunk)
        }
    }
}

fn awaits_write(child: ChildPtr, interp: &Interpreter<'_>) -> bool {
    match child.tag {
        ReaderTag::Cat => crate::shell::builtins::cat::Cat::awaits_write(interp, child.node),
    }
}

fn dispatch_reader_done(child: ChildPtr, errno: ExitCode, interp: &mut Interpreter<'_>) -> Yield {
    match child.tag {
        ReaderTag::Cat => {
            crate::shell::builtins::cat::Cat::on_io_reader_done(interp, child.node, errno)
        }
    }
}
