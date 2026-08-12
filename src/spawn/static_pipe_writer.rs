use core::mem::size_of;

use bun_event_loop::EventLoopHandle;
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
    pub(crate) ref_count: RefCount<Self>,
    pub(crate) writer: IOWriter<P>,
    pub(crate) stdio_result: StdioResult,
    pub source: Source,
    /// BACKREF: parent process is notified on close; never owned/destroyed here.
    pub(crate) process: *mut P,
    pub(crate) event_loop: EventLoopHandle,
    /// True while `start()`'s `+1` ref is outstanding.
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

// `borrow = ptr`: `on_write` ends by releasing what is normally the writer's
// last ref, so the handlers take the raw backref (see `on_write`).
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
    ) -> IntrusiveRc<Self> {
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
            // `Source::Pipe`, so we move it out (replacing with `Unavailable`)
            // and `heap::alloc` it (set_pipe re-wraps via `heap::take`).
            use crate::process::WindowsStdioResult;
            match core::mem::replace(&mut boxed.stdio_result, WindowsStdioResult::Unavailable) {
                WindowsStdioResult::Buffer(pipe) => {
                    // SAFETY: `pipe` is a Box-allocated `uv::Pipe`; `set_pipe`
                    // takes ownership via `heap::take`.
                    unsafe { boxed.writer.set_pipe(bun_core::heap::into_raw(pipe)) };
                }
                WindowsStdioResult::BufferFd(_) | WindowsStdioResult::Unavailable => {
                    unreachable!("StaticPipeWriter stdin requires WindowsStdioResult::Buffer");
                }
            }
        }
        let this = bun_core::heap::into_raw(boxed);
        // SAFETY: `this` was just leaked above; borrow scoped to registering
        // the parent backref.
        unsafe { (*this).writer.set_parent(this) };
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

    /// Once the write is finished this closes the writer and releases the ref
    /// that was holding it open. On POSIX, `writer.close()` runs `on_close` →
    /// `P::on_close_io`, where the owner drops the ref it got from `create()`,
    /// so the release at the end is normally the writer's last one and frees
    /// `*this`. That is why this takes the raw backref: freeing an allocation
    /// while a reference to it is a live argument is rejected by both aliasing
    /// models, so no `&mut Self` is formed here (each borrow is scoped to one
    /// statement) and nothing above this frame holds one either
    /// (`PosixPipeWriter::on_poll`).
    ///
    /// # Safety
    /// `this` must be the live writer; it may have been freed when this returns.
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
        // SAFETY: caller contract; borrows end at each `;`.
        let claimed_start_ref = unsafe {
            let buffer = (*this).buffer;
            let remaining = RawSlice::new(&buffer.slice()[amount.min(buffer.len())..]);
            (*this).buffer = remaining;
            if status != WriteStatus::EndOfFile && !remaining.is_empty() {
                return;
            }
            // `started` is the token for start()'s outstanding +1. Claiming it
            // here makes the release below mutually exclusive with the owners'
            // close-time release (`Subprocess::take_pending_start_writer` and
            // friends clear it the same way).
            core::mem::replace(&mut (*this).started, false)
        };

        if status == WriteStatus::EndOfFile {
            // The writer closed the fd before reporting EOF and delivers
            // `on_close` itself once this returns (`PosixBufferedWriterParent::
            // on_write`), so the owner still holds `create()`'s ref and this
            // release cannot be the last one; closing here instead would let
            // the owner free `*this` underneath the writer's pending close.
            if claimed_start_ref {
                // SAFETY: caller contract; `started` was claimed above, so this
                // is the only release of start()'s ref.
                unsafe { RefCount::<Self>::deref(this) };
            }
            return;
        }

        // SAFETY: caller contract. `*this` has to be held across `close()`,
        // which lets the owner drop `create()`'s ref: start()'s ref does that
        // when it is still outstanding, otherwise (the owner already released
        // it, as `SecurityScanSubprocess` does right after `start()`) a ref
        // taken here does. Either way the trailing release balances it, goes
        // through `this`, and is the last use of `this`.
        unsafe {
            if !claimed_start_ref {
                RefCount::<Self>::ref_(this);
            }
            (*this).writer.close();
            RefCount::<Self>::deref(this);
        }
    }

    /// # Safety
    /// `this` must be the live writer.
    pub(crate) unsafe fn on_error(this: *mut Self, err: &bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            this as usize,
            err
        );
        // Nothing is released here: the writer closes itself after this (so
        // `on_close` runs), and after a partially drained buffer it still
        // reports the drained bytes through `on_write`, which does the release.
        // SAFETY: caller contract; borrows end at each `;`. `buffer` aliases
        // `source`'s storage, which `detach()` frees, so it is cleared first:
        // that later `on_write` re-slices it.
        unsafe {
            (*this).buffer = RawSlice::EMPTY;
            (*this).source.detach();
        }
    }

    /// # Safety
    /// `this` must be the live writer. On POSIX, `P::on_close_io` may drop the
    /// owner's ref, and when nothing else holds one (`SecurityScanSubprocess`,
    /// or the EOF path of `on_write`) that frees `*this`; it is the last thing
    /// done with `this` here.
    pub(crate) unsafe fn on_close(this: *mut Self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            this as usize
        );
        // On Windows the error arm of `WindowsBufferedWriter::on_write_complete`
        // reaches here via `close()` without ever calling `Parent::on_write`, so
        // this is the last point `started` can be claimed for that path.
        // `write()`'s +1 (held by that callback's scopeguard) keeps the writer
        // live past the release. POSIX must not release here: `drain_buffered_data`
        // may call `on_error()` -> `close()` -> here and then `on_write()` on
        // the same object, with no extra ref held.
        // SAFETY: caller contract; borrows end at each `;`. `buffer` aliases
        // `source`'s storage, so it is cleared before `detach()` frees that.
        // `process` is a backref to the owning process, which outlives its
        // stdio writers; it is copied out before the call that may free `*this`.
        unsafe {
            #[cfg(windows)]
            let release_start_ref = core::mem::replace(&mut (*this).started, false);
            (*this).buffer = RawSlice::EMPTY;
            (*this).source.detach();
            let process = (*this).process;
            P::on_close_io(process, StdioKind::Stdin);
            #[cfg(windows)]
            if release_start_ref {
                RefCount::<Self>::deref(this);
            }
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
