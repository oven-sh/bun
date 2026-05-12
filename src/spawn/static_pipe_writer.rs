use core::mem::size_of;

use bun_event_loop::EventLoopHandle;
use bun_io::Loop as AsyncLoop;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedWriter, WriteStatus};
use bun_ptr::{IntrusiveRc, RawSlice, RefCount, RefCounted};
use bun_sys;

use crate::process::StdioKind;
use crate::subprocess::{Source, StdioResult};

bun_output::declare_scope!(StaticPipeWriter, hidden);

/// Trait bound for the owning process type `P` of [`StaticPipeWriter`].
///
/// Zig's `NewStaticPipeWriter(comptime ProcessType)` duck-types
/// `process.onCloseIO(.stdin)`; in Rust we require this trait so the
/// generic `BufferedWriter<StaticPipeWriter<P>>` field can satisfy its
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

/// Zig: `pub fn NewStaticPipeWriter(comptime ProcessType: type) type { return struct { ... } }`
///
/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
/// `P` must expose `fn on_close_io(&mut self, kind: StdioKind)`.
// Zig: `const WriterRefCount = bun.ptr.RefCount(@This(), "ref_count", _deinit, .{});`
// `_deinit` maps to `impl Drop` below; the final `bun.destroy` (Box free) is
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
    /// Slice into `self.source`'s storage, advanced as bytes are written.
    // TODO(port): lifetime — self-borrow into `self.source`; Phase B may store an
    // offset+len pair and re-slice from `self.source` instead of a raw self-pointer.
    // `RawSlice` (typed `*const [u8]` with safe `.slice()`) replaces the raw fat
    // pointer so the per-access unsafe derefs are gone; the backing storage
    // (`self.source`) outlives `self` by construction.
    pub buffer: RawSlice<u8>,
}

// Zig: `const print = bun.Output.scoped(.StaticPipeWriter, .visible);`
// NOTE: `print` is declared but never used in the Zig source; the file-level
// `log` (hidden) is what's actually called. We declare a single hidden scope above.

/// Zig: `pub const IOWriter = bun.io.BufferedWriter(@This(), struct { ... })`
///
/// The Zig callback-struct (`onWritable = null`, `getBuffer`, `onClose`, `onError`,
/// `onWrite`) maps to a handler trait that `StaticPipeWriter<P>` implements; the
/// inherent methods below are the callback bodies.
pub type IOWriter<P> = BufferedWriter<StaticPipeWriter<P>>;
/// Zig: `pub const Poll = IOWriter;`
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
    win_on_write_guard = |_this| (),
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

    /// Zig: `pub fn create(event_loop: anytype, subprocess: *ProcessType, result: StdioResult, source: Source) *This`
    ///
    /// PORT NOTE: Zig's `anytype` dispatched on type (`EventLoopHandle`,
    /// `*VirtualMachine`, `*MiniEventLoop`) inside `EventLoopHandle.init`. The
    /// Rust port splits that into separate overloads, so callers resolve to an
    /// `EventLoopHandle` before calling and we accept it directly.
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
            buffer: RawSlice::EMPTY,
        }));
        // SAFETY: `this` was just allocated above and is non-null.
        let this_ref = unsafe { &mut *this };
        #[cfg(windows)]
        {
            // Zig: `this.writer.setPipe(this.stdio_result.buffer)` — on Windows
            // `StdioResult` is the `WindowsStdioResult` union and Zig reads the
            // `.buffer` field unchecked (caller invariant). Enforce that
            // invariant here: any other arm is a logic bug, not a silent no-op.
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
        // Zig `this.ref()` — intrusive-refcount increment.
        // SAFETY: `self` is a live `Self` (created via `create()`/`heap::alloc`).
        unsafe { RefCount::<Self>::ref_(std::ptr::from_mut::<Self>(self)) };
        // TODO(port): self-borrow — see `buffer` field note.
        self.buffer = RawSlice::new(self.source.slice());
        #[cfg(windows)]
        {
            return self.writer.start_with_current_pipe();
        }
        #[cfg(not(windows))]
        {
            // Zig: `this.stdio_result.?` — on POSIX `StdioResult` is `?bun.FD`.
            match self.writer.start(self.stdio_result.unwrap(), true) {
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
                bun_sys::Result::Ok(()) => {
                    #[cfg(unix)]
                    {
                        // Zig: `const poll = this.writer.handle.poll; poll.flags.insert(.socket);`
                        // `handle` is `PollOrFd` (enum) in Rust; flag mutation goes
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
            self.writer.close();
        }
    }

    pub fn on_error(&mut self, err: bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            std::ptr::from_ref(self) as usize,
            err
        );
        self.source.detach();
    }

    pub fn on_close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            std::ptr::from_ref(self) as usize
        );
        self.source.detach();
        // SAFETY: `process` is a backref to the owning process, guaranteed alive
        // for the lifetime of this writer (the process owns/outlives its stdio writers).
        unsafe { P::on_close_io(self.process, StdioKind::Stdin) };
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

/// Zig: `fn _deinit(this: *This) void` — the `RefCount` destructor callback.
/// `bun.destroy(this)` (the heap free) is handled by `IntrusiveRc` after `drop` returns.
impl<P: StaticPipeWriterProcess> Drop for StaticPipeWriter<P> {
    fn drop(&mut self) {
        self.writer.end();
        self.source.detach();
    }
}

// ported from: src/runtime/api/bun/subprocess/StaticPipeWriter.zig
