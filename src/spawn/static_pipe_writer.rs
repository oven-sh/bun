use core::mem::size_of;

use bun_event_loop::EventLoopHandle;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedWriter, WriteStatus};
use bun_ptr::{RawSlice, RefCount, RefPtr};
use bun_sys;

use crate::process::StdioKind;
use crate::subprocess::StdioResult;

bun_output::declare_scope!(StaticPipeWriter, hidden);

/// What a [`StaticPipeWriter`] writes to the child.
pub trait Source {
    fn slice(&self) -> &[u8];
    fn memory_cost(&self) -> usize;
}

impl Source for Box<[u8]> {
    fn slice(&self) -> &[u8] {
        self
    }
    fn memory_cost(&self) -> usize {
        self.len()
    }
}

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
    type Source: Source;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind);
}

/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
/// `P` must expose `fn on_close_io(&mut self, kind: StdioKind)`.
#[derive(bun_ptr::RefCounted)]
pub struct StaticPipeWriter<P: StaticPipeWriterProcess> {
    /// Intrusive refcount; `ref`/`deref` provided via `bun_ptr::RefCount`.
    pub(crate) ref_count: RefCount<Self>,
    pub(crate) writer: IOWriter<P>,
    pub(crate) stdio_result: StdioResult,
    source: Option<P::Source>,
    /// BACKREF: parent process is notified on close; never owned/destroyed here.
    pub(crate) process: *mut P,
    pub(crate) event_loop: EventLoopHandle,
    /// Held while the write is in flight.
    pub start_ref: Option<RefPtr<Self>>,
    /// Slice into `self.source`'s storage, advanced as bytes are written.
    ///
    /// Self-borrow invariant: this aliases `self.source`'s storage, which
    /// outlives `self` by construction; every path that detaches/frees the
    /// source (`on_error`, `on_close`) must reset this to
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
    event_loop = |this| (*this).event_loop.as_event_loop_ctx(),
    uws_loop   = |this| (*this).event_loop.loop_(),
    ref_       = |this| RefCount::<Self>::ref_(this),
    deref      = |this| RefCount::<Self>::deref(this),
}

impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
    pub fn update_ref(&mut self, add: bool) {
        self.writer.update_ref(add);
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
        source: P::Source,
    ) -> RefPtr<Self> {
        #[allow(unused_mut)]
        let mut boxed = Box::new(Self {
            ref_count: RefCount::init(),
            writer: IOWriter::<P>::default(),
            stdio_result: result,
            source: Some(source),
            process: subprocess,
            event_loop,
            start_ref: None,
            buffer: RawSlice::EMPTY,
        });
        #[cfg(windows)]
        {
            // On Windows `StdioResult` is the `WindowsStdioResult` union and
            // the caller invariant is that the `Buffer` arm is set. Enforce
            // that here: any other arm is a logic bug, not a silent no-op.
            use crate::process::WindowsStdioResult;
            match boxed.stdio_result.take() {
                WindowsStdioResult::Buffer(pipe) => boxed.writer.set_pipe(pipe),
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

    /// `start_ref` is a ref on `self`, kept on `Ok`.
    pub fn start(&mut self, start_ref: RefPtr<Self>) -> bun_sys::Result<()> {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) start()",
            std::ptr::from_ref(self) as usize
        );
        debug_assert!(core::ptr::eq(start_ref.as_ptr(), self));
        // Self-borrow into `self.source` — see `buffer` field invariant.
        self.buffer = RawSlice::new(self.source.as_ref().expect("not closed").slice());
        #[cfg(windows)]
        self.writer.start_with_current_pipe()?;
        #[cfg(not(windows))]
        {
            let file = self.stdio_result.take().unwrap();
            self.writer.start(file.fd(), true)?;
            // The writer closes it from now on.
            file.into_raw();
            self.writer
                .handle
                .set_poll_flag(bun_io::FilePollFlag::Socket);
        }
        self.start_ref = Some(start_ref);
        Ok(())
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
            drop(self.start_ref.take());
            return;
        }
        if self.buffer.is_empty() {
            // Outlives the owner's ref, which `close()` releases.
            let _start_ref = self.start_ref.take();
            self.writer.close();
        }
    }

    pub(crate) fn on_error(&mut self, err: &bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            std::ptr::from_ref(self) as usize,
            err
        );
        // The writer pairs every error with `on_close`, which releases `start_ref`.
        self.buffer = RawSlice::EMPTY;
        self.source = None;
    }

    pub(crate) fn on_close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            std::ptr::from_ref(self) as usize
        );
        // Still set if the write did not finish. Outlives the owner's ref.
        let _start_ref = self.start_ref.take();
        self.buffer = RawSlice::EMPTY;
        self.source = None;
        // SAFETY: `process` is a backref to the owning process, guaranteed alive
        // for the lifetime of this writer (the process owns/outlives its stdio writers).
        unsafe { P::on_close_io(self.process, StdioKind::Stdin) };
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<Self>()
            + self.source.as_ref().map_or(0, Source::memory_cost)
            + self.writer.memory_cost()
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
    }
}
