use core::ffi::c_void;
use core::mem::size_of;

use bun_aio::Loop as AsyncLoop;
use bun_event_loop::EventLoopHandle;
use bun_io::{BufferedWriter, WriteStatus};
use bun_ptr::{IntrusiveRc, RefCount, RefCounted};
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
    /// `bun_aio::poll_tag` constant for this process's `StaticPipeWriter`
    /// `FilePoll` owner. Threaded down to `PosixBufferedWriterParent` so the
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll` can
    /// recover the monomorphized `*mut PosixBufferedWriter<StaticPipeWriter<Self>>`.
    const POLL_OWNER_TAG: u8;
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind);
}

/// Zig: `pub fn NewStaticPipeWriter(comptime ProcessType: type) type { return struct { ... } }`
///
/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
/// `P` must expose `fn on_close_io(&mut self, kind: StdioKind)`.
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
    pub buffer: *const [u8],
}

// Zig: `const WriterRefCount = bun.ptr.RefCount(@This(), "ref_count", _deinit, .{});`
// Zig: `pub const ref = WriterRefCount.ref; pub const deref = WriterRefCount.deref;`
// In Rust the intrusive refcount methods come from `bun_ptr::RefCount` /
// `bun_ptr::RefCounted`; the `_deinit` destructor maps to `impl Drop` below,
// and the final `bun.destroy` (Box free) is performed inside
// `RefCounted::destructor` when the count reaches zero.
impl<P: StaticPipeWriterProcess> RefCounted for StaticPipeWriter<P> {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { &raw mut (*this).ref_count }
    }
    unsafe fn destructor(this: *mut Self, _: ()) {
        // SAFETY: refcount hit 0; allocated via `Box::into_raw` in `create()`.
        // `Drop` (below) performs `_deinit`'s `writer.end(); source.detach()`.
        drop(unsafe { Box::from_raw(this) });
    }
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

#[cfg(not(windows))]
impl<P: StaticPipeWriterProcess> bun_io::pipe_writer::PosixBufferedWriterParent
    for StaticPipeWriter<P>
{
    const POLL_OWNER_TAG: u8 = P::POLL_OWNER_TAG;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: `this` is the BACKREF set via set_parent; the BufferedWriter
        // never materializes `&mut StaticPipeWriter`, so this is the unique
        // access path for the callback's duration.
        unsafe { (*this).on_write(amount, status) };
    }
    unsafe fn on_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: see on_write.
        unsafe { (*this).on_error(err) };
    }
    const HAS_ON_CLOSE: bool = true;
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: see on_write.
        unsafe { (*this).on_close() };
    }
    unsafe fn get_buffer<'a>(this: *mut Self) -> &'a [u8] {
        // SAFETY: see on_write. Shared-only borrow of `self.source`'s storage.
        // Deref the raw `*const [u8]` directly (rather than via `&self`) so the
        // returned lifetime `'a` is unbound from `P`'s lifetime parameter.
        unsafe { &*(*this).buffer }
    }
    const HAS_ON_WRITABLE: bool = false;
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see on_write. Shared-only read of event_loop.
        unsafe { (*this).io_evtloop() }
    }
}

#[cfg(windows)]
impl<P: StaticPipeWriterProcess> bun_io::pipe_writer::WindowsWriterParent for StaticPipeWriter<P> {
    unsafe fn loop_(this: *mut Self) -> *mut bun_windows::libuv::Loop {
        // SAFETY: BACKREF set via set_parent; shared-only read of event_loop.
        unsafe { (*this).loop_() }
    }
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: see loop_. Intrusive refcount bump.
        unsafe { RefCount::<Self>::ref_(this) };
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see loop_. Intrusive refcount drop; may free `this`.
        unsafe { RefCount::<Self>::deref(this) };
    }
}

#[cfg(windows)]
impl<P: StaticPipeWriterProcess> bun_io::pipe_writer::WindowsBufferedWriterParent
    for StaticPipeWriter<P>
{
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: BACKREF set via set_parent; unique access for callback duration.
        unsafe { (*this).on_write(amount, status) };
    }
    unsafe fn on_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: see on_write.
        unsafe { (*this).on_error(err) };
    }
    const HAS_ON_CLOSE: bool = true;
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: see on_write.
        unsafe { (*this).on_close() };
    }
    unsafe fn get_buffer<'a>(this: *mut Self) -> &'a [u8] {
        // SAFETY: see on_write. Shared-only borrow of `self.source`'s storage.
        // Deref the raw `*const [u8]` directly so `'a` is unbound from `P`.
        unsafe { &*(*this).buffer }
    }
    const HAS_ON_WRITABLE: bool = false;
}

impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_event_loop::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; vtable consumers treat the pointee as read-only
        // (`*const bun_event_loop::EventLoopHandle`) and never write through it.
        bun_io::EventLoopHandle(&self.event_loop as *const _ as *mut c_void)
    }

    pub fn update_ref(&mut self, add: bool) {
        self.writer.update_ref(self.io_evtloop(), add);
    }

    pub fn get_buffer(&self) -> &[u8] {
        // SAFETY: `buffer` always points into `self.source`'s storage (or the empty
        // literal), which is kept alive for the lifetime of `self`.
        unsafe { &*self.buffer }
    }

    pub fn close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) close()",
            self as *const _ as usize
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
        let this = Box::into_raw(Box::new(Self {
            ref_count: RefCount::init(),
            writer: IOWriter::<P>::default(),
            stdio_result: result,
            source,
            process: subprocess,
            event_loop,
            buffer: b"" as *const [u8],
        }));
        // SAFETY: `this` was just allocated above and is non-null.
        let this_ref = unsafe { &mut *this };
        #[cfg(windows)]
        {
            this_ref.writer.set_pipe(this_ref.stdio_result.buffer);
        }
        this_ref.writer.set_parent(this);
        // SAFETY: ownership of the initial ref is transferred to the returned IntrusiveRc.
        unsafe { IntrusiveRc::from_raw(this) }
    }

    pub fn start(&mut self) -> bun_sys::Result<()> {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) start()",
            self as *const _ as usize
        );
        // Zig `this.ref()` — intrusive-refcount increment.
        // SAFETY: `self` is a live `Self` (created via `create()`/`Box::into_raw`).
        unsafe { RefCount::<Self>::ref_(self as *mut Self) };
        // TODO(port): self-borrow — see `buffer` field note.
        self.buffer = self.source.slice() as *const [u8];
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
            self as *const _ as usize,
            amount,
            // Local stringify — `WriteStatus` (upstream bun_io) has no `Debug` impl.
            match status {
                WriteStatus::EndOfFile => "end_of_file",
                WriteStatus::Drained => "drained",
                WriteStatus::Pending => "pending",
            }
        );
        let len = self.buffer.len();
        // SAFETY: `buffer` points into `self.source`'s storage, alive for `self`'s lifetime.
        // Explicit `&*` avoids the implicit-autoref-on-raw-pointer lint when slicing.
        self.buffer = unsafe { &(&*self.buffer)[amount.min(len)..] } as *const [u8];
        if status == WriteStatus::EndOfFile || self.buffer.len() == 0 {
            self.writer.close();
        }
    }

    pub fn on_error(&mut self, err: bun_sys::Error) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onError(err={})",
            self as *const _ as usize,
            err
        );
        self.source.detach();
    }

    pub fn on_close(&mut self) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onClose()",
            self as *const _ as usize
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
        self.event_loop.platform_event_loop()
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/StaticPipeWriter.zig (142 lines)
//   confidence: medium
//   todos:      5
//   notes:      buffer self-borrows source (raw *const [u8], Phase B may switch to offset+len); IntrusiveRc/BufferedWriterHandler wiring + P trait bound deferred to Phase B
// ──────────────────────────────────────────────────────────────────────────
