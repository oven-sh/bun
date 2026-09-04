use core::mem::size_of;

use bun_event_loop::EventLoopHandle;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedWriter, WriteStatus};
use bun_ptr::{RawSlice, RefCount, RefPtr};
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
///
/// Two refs: `create()`'s, held in the owner's stdin slot and released by its
/// `on_close_io`, and `start()`'s, held while the write is in flight. `started`
/// is the token for the latter: whoever swaps it to `false` releases the ref,
/// which is `on_write` on completion, `on_close` after a failed write (the one
/// ending with no completion report), or an owner closing the writer itself.
// Cleanup lives in `impl Drop` below; the final Box free is
// the derive's default destructor (`drop(heap::take(this))`).
#[derive(bun_ptr::RefCounted)]
pub struct StaticPipeWriter<P: StaticPipeWriterProcess> {
    /// Intrusive refcount; `ref`/`deref` provided via `bun_ptr::RefCount`.
    pub(crate) ref_count: RefCount<Self>,
    pub(crate) writer: IOWriter<P>,
    pub(crate) stdio_result: StdioResult,
    pub source: Source,
    /// BACKREF: parent process is notified on close; never owned/destroyed here.
    pub(crate) process: *mut P,
    pub(crate) event_loop: EventLoopHandle,
    /// True while `start()`'s `+1` ref is outstanding (see the type docs).
    pub started: bool,
    /// Slice into `self.source`'s storage, advanced as bytes are written.
    ///
    /// Self-borrow invariant: this aliases `self.source`'s storage, which
    /// outlives `self` by construction; every path that detaches/frees the
    /// source (`on_error`, `on_close`, `Drop`) must reset this to
    /// `RawSlice::EMPTY` first. `RawSlice` (typed `*const [u8]` with safe
    /// `.slice()`) keeps the per-access unsafe derefs out of the call sites.
    pub(crate) buffer: RawSlice<u8>,
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

    pub fn close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) close()",
            std::ptr::from_ref(self) as usize
        );
        self.writer.close();
    }

    /// Callers resolve to an `EventLoopHandle` before calling and we accept
    /// it directly.
    pub fn create(
        event_loop: EventLoopHandle,
        subprocess: *mut P,
        result: StdioResult,
        source: Source,
    ) -> RefPtr<Self> {
        #[allow(unused_mut)]
        let mut boxed = Box::new(Self {
            ref_count: RefCount::init(),
            writer: IOWriter::<P>::default(),
            stdio_result: result,
            source,
            process: subprocess,
            event_loop,
            started: false,
            buffer: RawSlice::EMPTY,
        });
        #[cfg(windows)]
        {
            // On Windows `StdioResult` is the `WindowsStdioResult` union and
            // the caller invariant is that the `Buffer` arm is set. Enforce
            // that here: any other arm is a logic bug, not a silent no-op.
            // Ownership of the boxed `uv::Pipe` transfers into the writer's
            // `Source::Pipe`, so we move it out (replacing with `Unavailable`).
            use crate::process::WindowsStdioResult;
            match core::mem::replace(&mut boxed.stdio_result, WindowsStdioResult::Unavailable) {
                WindowsStdioResult::Buffer(pipe) => {
                    boxed.writer.set_pipe(pipe);
                }
                WindowsStdioResult::BufferFd(_)
                | WindowsStdioResult::UnownedFd(_)
                | WindowsStdioResult::Unavailable => {
                    unreachable!("StaticPipeWriter stdin requires WindowsStdioResult::Buffer");
                }
            }
        }
        let this = bun_core::heap::into_raw(boxed);
        // SAFETY: `this` was just leaked above; borrow scoped to registering
        // the parent backref.
        unsafe { (*this).writer.set_parent(this) };
        // SAFETY: ownership of the initial ref is transferred to the returned RefPtr.
        unsafe { RefPtr::from_raw(this) }
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
                // `start()`; the caller's `RefPtr` keeps it alive and
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
                    // of `start()`; the caller's `RefPtr` keeps it alive
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

    pub(crate) fn on_write(&mut self, amount: usize, status: WriteStatus) {
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
        if status == WriteStatus::EndOfFile {
            // The buffered writer closes itself (-> `on_close`) after this
            // returns, so don't close here.
            if core::mem::replace(&mut self.started, false) {
                // SAFETY: token taken above; not the final ref, the owner's slot
                // still holds one until that `on_close`.
                unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
            }
            return;
        }
        if self.buffer.is_empty() {
            // Token taken before `close()` so start()'s ref outlives the owner's.
            let release_start_ref = core::mem::replace(&mut self.started, false);
            self.writer.close();
            if release_start_ref {
                // SAFETY: token taken above; may be the final ref, last use of `self`.
                unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
            }
        }
    }

    pub(crate) fn on_error(&mut self, err: &bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            std::ptr::from_ref(self) as usize,
            err
        );
        // `buffer` aliases `self.source`'s storage, which `detach()` frees.
        // start()'s ref is released by the `on_close` the writer pairs with
        // every error.
        self.buffer = RawSlice::EMPTY;
        self.source.detach();
    }

    pub(crate) fn on_close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            std::ptr::from_ref(self) as usize
        );
        // Still set only after a failed write (every other path takes the token
        // before closing). Must be taken before `on_close_io` empties the slot:
        // nothing can reach this writer afterwards.
        let release_start_ref = core::mem::replace(&mut self.started, false);
        // `buffer` aliases `self.source`'s storage; clear it before detach()
        // frees that storage so no dangling slice survives the close.
        self.buffer = RawSlice::EMPTY;
        self.source.detach();
        // SAFETY: `process` is a backref to the owning process, guaranteed alive
        // for the lifetime of this writer (the process owns/outlives its stdio writers).
        unsafe { P::on_close_io(self.process, StdioKind::Stdin) };
        if release_start_ref {
            // SAFETY: token taken above. On POSIX this frees `self`: it is the
            // last use here, and the writer's `close()` frames below do nothing
            // after this callback. On Windows the in-flight write's ref outlives it.
            unsafe { RefCount::<Self>::deref(std::ptr::from_mut::<Self>(self)) };
        }
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<Self>() + self.source.memory_cost() + self.writer.memory_cost()
    }

    pub fn watch(&mut self) {
        if self.buffer.len() > 0 {
            self.writer.watch();
        }
    }
}

/// The `RefCount` destructor callback.
/// The heap free is handled by `RefPtr` after `drop` returns.
impl<P: StaticPipeWriterProcess> Drop for StaticPipeWriter<P> {
    fn drop(&mut self) {
        self.writer.end();
        // `buffer` aliases `self.source`'s storage; clear it before detach()
        // frees that storage (upholds the field's documented invariant).
        self.buffer = RawSlice::EMPTY;
        self.source.detach();
    }
}
