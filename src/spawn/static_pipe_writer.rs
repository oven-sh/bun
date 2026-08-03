use core::mem::size_of;

use bun_event_loop::EventLoopHandle;
use bun_io::Loop as AsyncLoop;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedWriter, WriteStatus};
use bun_ptr::{IntrusiveRc, RawSlice, RefCount};
use bun_sys;

use crate::process::StdioKind;
use crate::subprocess::{Source, StdioResult};

bun_output::declare_scope!(StaticPipeWriter, hidden);

/// Trait bound for the owning process type `P` of [`StaticPipeWriter`].
///
/// This trait lets the
/// generic `BufferedWriter<StaticPipeWriter<P>>` field satisfy its
/// `PosixBufferedWriterParent`/`WindowsBufferedWriterParent` bound for all `P`.
///
/// Method takes `*mut Self` (not `&mut self`) because the writer is a field of
/// the process — materializing `&mut P` while `&mut writer` is live would alias.
pub trait StaticPipeWriterProcess {
    const POLL_OWNER_TAG: bun_io::PollTag;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind);
}

/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
/// `P` must expose `fn on_close_io(&mut self, kind: StdioKind)`.
// Cleanup lives in `impl Drop` below; the final Box free is
// the derive's default destructor (`drop(heap::take(this))`).
#[derive(bun_ptr::RefCounted)]
pub struct StaticPipeWriter<P: StaticPipeWriterProcess> {
    /// Intrusive refcount; `ref`/`deref` provided via `bun_ptr::RefCount`.
    pub ref_count: RefCount<Self>,
    pub writer: IOWriter<P>,
    pub stdio_result: StdioResult,
    pub source: Source,
    /// BACKREF: parent process is notified on close; never owned/destroyed here.
    pub process: *mut P,
    pub event_loop: EventLoopHandle,
    /// True while `start()`'s `+1` ref is outstanding.
    pub started: bool,
    /// Slice into `self.source`'s storage, advanced as bytes are written.
    ///
    /// Self-borrow invariant: this aliases `self.source`'s storage, which
    /// outlives `self` by construction; every path that detaches/frees the
    /// source (`on_error`, `on_close`, `Drop`) must reset this to
    /// `RawSlice::EMPTY` first. `RawSlice` (typed `*const [u8]` with safe
    /// `.slice()`) keeps the per-access unsafe derefs out of the call sites.
    pub buffer: RawSlice<u8>,
}

/// The writer's callbacks (`getBuffer`, `onClose`, `onError`, `onWrite`) map
/// to a handler trait that `StaticPipeWriter<P>` implements; the
/// inherent methods below are the callback bodies.
pub type IOWriter<P> = BufferedWriter<StaticPipeWriter<P>>;
pub type Poll<P> = IOWriter<P>;

// ──────────────────────────────────────────────────────────────────────────
// BufferedWriter parent vtable — wires bun_io callbacks to inherent methods
// ──────────────────────────────────────────────────────────────────────────

bun_io::impl_buffered_writer_parent! {
    for<P: StaticPipeWriterProcess> StaticPipeWriter<P>;
    poll_tag   = P::POLL_OWNER_TAG,
    borrow     = mut,
    on_write   = on_write,
    on_error   = on_error,
    on_close   = on_close,
    // Deref the raw `*const [u8]` directly so `'a` is unbound from `P`'s
    // lifetime parameter.
    get_buffer = |this| &*(*this).buffer.as_ptr(),
    event_loop = |this| (*this).io_evtloop(),
    uv_loop    = |this| (*this).event_loop.uv_loop(),
    ref_       = |this| RefCount::<Self>::ref_(this),
    deref      = |this| RefCount::<Self>::deref(this),
}

impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.event_loop.as_event_loop_ctx()
    }

    pub fn update_ref(&mut self, add: bool) {
        self.writer.update_ref(self.io_evtloop(), add);
    }

    pub fn get_buffer(&self) -> &[u8] {
        // `RawSlice` invariant: backing storage (`self.source` or the empty
        // literal) outlives `self`.
        self.buffer.slice()
    }

    pub fn close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) close()",
            std::ptr::from_ref(self) as usize
        );
        self.writer.close();
    }

    pub fn flush(&mut self) {
        if self.buffer.len() > 0 {
            self.writer.write();
        }
    }

    /// Callers resolve to an `EventLoopHandle` before calling and we accept
    /// it directly.
    pub fn create(
        event_loop: EventLoopHandle,
        subprocess: *mut P,
        result: StdioResult,
        source: Source,
    ) -> IntrusiveRc<Self> {
        let this = bun_core::heap::into_raw(Box::new(Self {
            ref_count: RefCount::init(),
            writer: IOWriter::<P>::default(),
            stdio_result: result,
            source,
            process: subprocess,
            event_loop,
            started: false,
            buffer: RawSlice::EMPTY,
        }));
        // SAFETY: `this` was just allocated above and is non-null.
        let this_ref = unsafe { &mut *this };
        #[cfg(windows)]
        {
            // On Windows `StdioResult` is the `WindowsStdioResult` union and
            // the caller invariant is that the `Buffer` arm is set. Enforce
            // that here: any other arm is a logic bug, not a silent no-op.
            // Ownership of the boxed `uv::Pipe` transfers into the writer's
            // `Source::Pipe`, so we move it out (replacing with `Unavailable`)
            // and `heap::alloc` it (set_pipe re-wraps via `heap::take`).
            use crate::process::WindowsStdioResult;
            match core::mem::replace(&mut this_ref.stdio_result, WindowsStdioResult::Unavailable) {
                WindowsStdioResult::Buffer(pipe) => {
                    // SAFETY: `pipe` is a Box-allocated `uv::Pipe`; `set_pipe`
                    // takes ownership via `heap::take`.
                    unsafe { this_ref.writer.set_pipe(bun_core::heap::into_raw(pipe)) };
                }
                WindowsStdioResult::BufferFd(_) | WindowsStdioResult::Unavailable => {
                    unreachable!("StaticPipeWriter stdin requires WindowsStdioResult::Buffer");
                }
            }
        }
        this_ref.writer.set_parent(this);
        // SAFETY: ownership of the initial ref is transferred to the returned IntrusiveRc.
        unsafe { IntrusiveRc::from_raw(this) }
    }

    pub fn start(&mut self) -> bun_sys::Result<()> {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) start()",
            std::ptr::from_ref(self) as usize
        );
        // Intrusive-refcount increment.
        // SAFETY: `self` is a live `Self` (created via `create()`/`heap::alloc`).
        unsafe { RefCount::<Self>::ref_(std::ptr::from_mut::<Self>(self)) };
        // Self-borrow into `self.source` — see `buffer` field invariant.
        self.buffer = RawSlice::new(self.source.slice());
        #[cfg(windows)]
        {
            let r = self.writer.start_with_current_pipe();
            self.started = r.is_ok();
            if r.is_err() {
                // start() failed: `started` stays false so no release site
                // fires — release start()'s `+1` here.
                // SAFETY: `self` is the live `Self` we ref'd at the top of
                // `start()`; the caller's `IntrusiveRc` keeps it alive and
                // `started` is false so no other site re-derefs.
                unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
            }
            return r;
        }
        #[cfg(not(windows))]
        {
            // On POSIX `StdioResult` is an `Option<Fd>`.
            match self.writer.start(self.stdio_result.unwrap(), true) {
                bun_sys::Result::Err(err) => {
                    // start() failed: `started` stays false so no release
                    // site fires — release start()'s `+1` here.
                    // SAFETY: `self` is the live `Self` we ref'd at the top
                    // of `start()`; the caller's `IntrusiveRc` keeps it alive
                    // and `started` is false so no other site re-derefs.
                    unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
                    bun_sys::Result::Err(err)
                }
                bun_sys::Result::Ok(()) => {
                    self.started = true;
                    #[cfg(unix)]
                    {
                        // `handle` is `PollOrFd` (enum); flag mutation goes
                        // through the FilePoll vtable shim.
                        if let Some(poll) = self.writer.handle.get_poll() {
                            poll.set_flag(bun_io::FilePollFlag::Socket);
                        }
                    }
                    bun_sys::Result::Ok(())
                }
            }
        }
    }

    pub fn on_write(&mut self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onWrite(amount={} {})",
            std::ptr::from_ref(self) as usize,
            amount,
            // Local stringify — `WriteStatus` (upstream bun_io) has no `Debug` impl.
            match status {
                WriteStatus::EndOfFile => "end_of_file",
                WriteStatus::Drained => "drained",
                WriteStatus::Pending => "pending",
            }
        );
        let len = self.buffer.len();
        self.buffer = RawSlice::new(&self.buffer.slice()[amount.min(len)..]);
        if status == WriteStatus::EndOfFile || self.buffer.is_empty() {
            // `started` is the token for start()'s outstanding +1. Clearing it
            // before the deref makes this release mutually exclusive with the
            // owner's close-time release (`Subprocess::take_pending_start_writer`,
            // which also clears `started`). On POSIX, `writer.close()` →
            // `Parent::on_close` may drop `create()`'s +1, so keep start()'s +1
            // across it. `EndOfFile` is skipped because `PosixBufferedWriter::
            // _on_write` still touches `self` after this returns on that status.
            let release_start_ref = self.started && status != WriteStatus::EndOfFile;
            if release_start_ref {
                self.started = false;
            }
            self.writer.close();
            if release_start_ref {
                // SAFETY: start()'s +1 was still outstanding; `started` cleared above so no other site re-derefs.
                unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
            }
        }
    }

    pub fn on_error(&mut self, err: &bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            std::ptr::from_ref(self) as usize,
            err
        );
        // Clear the buffer before detaching: `buffer` aliases `self.source`'s
        // storage, and `detach()` frees it. `drain_buffered_data` calls
        // on_error() then Parent::on_write(), which would otherwise re-slice
        // the freed allocation.
        self.buffer = RawSlice::EMPTY;
        self.source.detach();
        // Can't release start()'s +1 here: `drain_buffered_data` calls on_error() then
        // Parent::on_write(); freeing here would UAF.
    }

    pub fn on_close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            std::ptr::from_ref(self) as usize
        );
        // On Windows the error arm of `WindowsBufferedWriter::on_write_complete`
        // reaches here via `close()` without ever calling `Parent::on_write`, so
        // this is the last point `started` can be claimed for that path.
        // `write()`'s +1 (held by that callback's scopeguard) keeps `self` live
        // past the deref. POSIX must not release here: `drain_buffered_data`
        // may call `on_error()` -> `close()` -> here and then `on_write()` on
        // the same object, with no extra ref held.
        #[cfg(windows)]
        let release_start_ref = core::mem::replace(&mut self.started, false);
        // `buffer` aliases `self.source`'s storage; clear it before detach()
        // frees that storage so no dangling slice survives the close.
        self.buffer = RawSlice::EMPTY;
        self.source.detach();
        // SAFETY: `process` is a backref to the owning process, guaranteed alive
        // for the lifetime of this writer (the process owns/outlives its stdio writers).
        unsafe { P::on_close_io(self.process, StdioKind::Stdin) };
        #[cfg(windows)]
        if release_start_ref {
            // SAFETY: `started` was the token for start()'s outstanding +1;
            // cleared above so no other site re-derefs. Last use of `self`.
            unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
        }
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<Self>() + self.source.memory_cost() + self.writer.memory_cost()
    }

    pub fn loop_(&self) -> *mut AsyncLoop {
        self.event_loop.native_loop()
    }

    pub fn watch(&mut self) {
        if self.buffer.len() > 0 {
            self.writer.watch();
        }
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop
    }
}

/// The `RefCount` destructor callback.
/// The heap free is handled by `IntrusiveRc` after `drop` returns.
impl<P: StaticPipeWriterProcess> Drop for StaticPipeWriter<P> {
    fn drop(&mut self) {
        self.writer.end();
        // `buffer` aliases `self.source`'s storage; clear it before detach()
        // frees that storage (upholds the field's documented invariant).
        self.buffer = RawSlice::EMPTY;
        self.source.detach();
    }
}
