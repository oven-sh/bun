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
/// `on_close_io` gets the process as a [`ThisPtr`](bun_ptr::ThisPtr), not
/// `&mut self`: it runs from inside the writer's callbacks — possibly
/// re-entrantly from `start()` — while the writer (held in one of the
/// process's slots) is itself borrowed.
pub trait StaticPipeWriterProcess: Sized {
    const POLL_OWNER_TAG: bun_io::PollTag;
    fn on_close_io(this: bun_ptr::ThisPtr<Self>, kind: StdioKind);
}

/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
///
/// Two refs: `create()`'s, held in the owner's stdin slot and released by its
/// `on_close_io`, and `start()`'s, held in `start_ref` while the write is in
/// flight. Whoever takes `start_ref` releases it: `on_write` on completion,
/// `on_close` after a failed write (the one ending with no completion report),
/// or an owner closing the writer itself.
// Cleanup lives in `impl Drop` below; the final Box free is
// the derive's default destructor (`drop(heap::take(this))`).
#[derive(bun_ptr::RefCounted)]
pub struct StaticPipeWriter<P: StaticPipeWriterProcess> {
    /// Intrusive refcount; `ref`/`deref` provided via `bun_ptr::RefCount`.
    pub(crate) ref_count: RefCount<Self>,
    pub(crate) writer: IOWriter<P>,
    pub(crate) stdio_result: StdioResult,
    pub source: Source,
    /// The owning process, notified on close. It holds this writer in its
    /// stdin slot and closes it (firing `on_close`) before it is itself freed.
    pub(crate) process: bun_ptr::BackRef<P, bun_ptr::Root>,
    pub(crate) event_loop: EventLoopHandle,
    /// `start()`'s ref while the write is in flight (see the type docs).
    start_ref: Option<RefPtr<Self>>,
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
    borrow     = ptr,
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

// Owner-facing entry points. The owner holds the writer by `RefPtr` (its
// own heap allocation, event-loop thread only) and drives it through these
// with `rc.this_ptr()` — by value, so no borrow of the owner's slot is live
// while the writer's callbacks re-enter the *owner* (`P::on_close_io`, which
// empties that slot and may come back through `take_start_ref` /
// `detach_source` — fields disjoint from the `writer` borrowed by `close`).
// Each projects the one field it needs through the root pointer for the
// duration of the call.
impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.event_loop.as_event_loop_ctx()
    }

    pub fn update_ref(this: bun_ptr::ThisPtr<Self>, add: bool) {
        let evl = this.io_evtloop();
        // SAFETY: see impl-level note; `update_ref` runs no callbacks.
        unsafe { (*this.as_ptr()).writer.update_ref(evl, add) };
    }

    pub fn close(this: bun_ptr::ThisPtr<Self>) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) close()",
            this.as_ptr() as usize
        );
        // SAFETY: see impl-level note.
        unsafe { (*this.as_ptr()).writer.close() };
    }

    pub fn watch(this: bun_ptr::ThisPtr<Self>) {
        if this.buffer.len() > 0 {
            // SAFETY: see impl-level note.
            unsafe { (*this.as_ptr()).writer.watch() };
        }
    }

    /// `start()`'s in-flight ref, for an owner closing the writer itself (it
    /// releases the ref after the close).
    pub fn take_start_ref(this: bun_ptr::ThisPtr<Self>) -> Option<RefPtr<Self>> {
        // SAFETY: see impl-level note; momentary field access.
        unsafe { (*this.as_ptr()).start_ref.take() }
    }

    /// Free the source now (the owner is discarding the writer).
    pub fn detach_source(this: bun_ptr::ThisPtr<Self>) {
        // SAFETY: see impl-level note; momentary field accesses. `buffer`
        // aliases `source`'s storage, so it is cleared first.
        unsafe {
            (*this.as_ptr()).buffer = RawSlice::EMPTY;
            (*this.as_ptr()).source.detach();
        }
    }

    pub fn start(this: bun_ptr::ThisPtr<Self>) -> bun_sys::Result<()> {
        // A synchronous failure inside `start_impl` can run `on_close`, which
        // releases both the owner's ref and `start_ref`; hold one more so the
        // error path below it still has a live writer.
        let _guard = RefPtr::from_this(this);
        // SAFETY: see impl-level note; momentary field access. The in-flight
        // ref is minted from the root pointer (it may be released as the last).
        unsafe { (*this.as_ptr()).start_ref = Some(RefPtr::from_this(this)) };
        // SAFETY: see impl-level note.
        unsafe { (*this.as_ptr()).start_impl() }
    }

    /// Callers resolve to an `EventLoopHandle` before calling and we accept
    /// it directly.
    pub fn create(
        event_loop: EventLoopHandle,
        subprocess: bun_ptr::ThisPtr<P>,
        result: StdioResult,
        source: Source,
    ) -> RefPtr<Self> {
        #[allow(unused_mut)]
        let mut boxed = Box::new(Self {
            ref_count: RefCount::init(),
            writer: IOWriter::<P>::default(),
            stdio_result: result,
            source,
            process: bun_ptr::BackRef::from(subprocess),
            event_loop,
            start_ref: None,
            buffer: RawSlice::EMPTY,
        });
        #[cfg(windows)]
        {
            // On Windows `StdioResult` is the `WindowsStdioResult` union and
            // the caller invariant is that the `Buffer` arm is set. Enforce
            // that here: any other arm is a logic bug, not a silent no-op.
            // Ownership of the boxed `uv::Pipe` transfers into the writer's
            // `Source::Pipe`, so we move it out (replacing with `Unavailable`)
            // and `heap::alloc` it (set_pipe re-wraps via `heap::take`).
            use crate::process::WindowsStdioResult;
            match core::mem::replace(&mut boxed.stdio_result, WindowsStdioResult::Unavailable) {
                WindowsStdioResult::Buffer(pipe) => {
                    // SAFETY: `pipe` is a Box-allocated `uv::Pipe`; `set_pipe`
                    // takes ownership via `heap::take`.
                    unsafe { boxed.writer.set_pipe(bun_core::heap::into_raw(pipe)) };
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

    /// `start_ref` is already set by [`Self::start`].
    fn start_impl(&mut self) -> bun_sys::Result<()> {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) start()",
            std::ptr::from_ref(self) as usize
        );
        // Self-borrow into `self.source` — see `buffer` field invariant.
        self.buffer = RawSlice::new(self.source.slice());
        #[cfg(windows)]
        {
            let r = self.writer.start_with_current_pipe();
            if r.is_err() {
                // start() failed: no release site fires — release start()'s
                // ref here (not the last: the caller's slot holds one).
                self.start_ref = None;
            }
            return r;
        }
        #[cfg(not(windows))]
        {
            // On POSIX `StdioResult` is an `Option<Fd>`.
            match self.writer.start(self.stdio_result.unwrap(), true) {
                bun_sys::Result::Err(err) => {
                    // start() failed: no release site fires — release
                    // start()'s ref here (not the last: the caller's slot
                    // holds one).
                    self.start_ref = None;
                    bun_sys::Result::Err(err)
                }
                bun_sys::Result::Ok(()) => {
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

    /// Writer callback (`borrow = ptr`): completing the write may release the
    /// last ref, so no `&mut Self` argument (which would have to stay valid
    /// for the whole call) is formed — fields are reached through `this`.
    ///
    /// # Safety
    /// `this` is the writer's parent back-reference: the live root pointer.
    pub(crate) unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onWrite(amount={} {})",
            this as usize,
            amount,
            // Local stringify — `WriteStatus` (upstream bun_io) has no `Debug` impl.
            match status {
                WriteStatus::EndOfFile => "end_of_file",
                WriteStatus::Drained => "drained",
                WriteStatus::Pending => "pending",
            }
        );
        // SAFETY: fn contract; each access below is a momentary field projection.
        unsafe {
            let len = (*this).buffer.len();
            (*this).buffer = RawSlice::new(&(*this).buffer.slice()[amount.min(len)..]);
            if status == WriteStatus::EndOfFile {
                // The buffered writer closes itself (-> `on_close`) after this
                // returns, so don't close here. Not the final ref: the owner's slot
                // still holds one until that `on_close`.
                (*this).start_ref = None;
                return;
            }
            if (*this).buffer.is_empty() {
                // Taken before `close()` so start()'s ref outlives the owner's.
                let start_ref = (*this).start_ref.take();
                (*this).writer.close();
                // May be the final ref; nothing touches `this` after.
                drop(start_ref);
            }
        }
    }

    /// # Safety
    /// As [`Self::on_write`].
    pub(crate) unsafe fn on_error(this: *mut Self, err: &bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            this as usize,
            err
        );
        // `buffer` aliases `self.source`'s storage, which `detach()` frees.
        // start()'s ref is released by the `on_close` the writer pairs with
        // every error.
        // SAFETY: fn contract; momentary field projections.
        unsafe {
            (*this).buffer = RawSlice::EMPTY;
            (*this).source.detach();
        }
    }

    /// # Safety
    /// As [`Self::on_write`].
    pub(crate) unsafe fn on_close(this: *mut Self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            this as usize
        );
        // SAFETY: fn contract; momentary field projections (all disjoint from
        // `writer`, whose `close()` frame may be live below us).
        let (start_ref, process) = unsafe {
            // Still set only after a failed write (every other path takes it
            // before closing). Must be taken before `on_close_io` empties the
            // slot: nothing can reach this writer afterwards.
            let start_ref = (*this).start_ref.take();
            // `buffer` aliases `self.source`'s storage; clear it before detach()
            // frees that storage so no dangling slice survives the close.
            (*this).buffer = RawSlice::EMPTY;
            (*this).source.detach();
            (start_ref, (*this).process)
        };
        P::on_close_io(process.this_ptr(), StdioKind::Stdin);
        // On POSIX this frees the writer: nothing touches `this` after, and
        // the writer's `close()` frames below do nothing after this callback.
        // On Windows the in-flight write's ref outlives it.
        drop(start_ref);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<Self>() + self.source.memory_cost() + self.writer.memory_cost()
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
