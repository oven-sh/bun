use core::ffi::c_void;
use core::mem::size_of;

use bun_io::Loop as AsyncLoop;
use bun_io::{BufferedWriter, WriteStatus};
use bun_jsc::EventLoopHandle;
use bun_ptr::{IntrusiveRc, RefCount, RefCounted};
use bun_sys;

use super::{Source, StdioResult};
// TODO(port): `StdioKind::Stdin` — Zig passes `.stdin` to `process.onCloseIO`; confirm enum path.
use super::StdioKind;

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
    /// `bun_io::poll_tag` constant for this process's `StaticPipeWriter`
    /// `FilePoll` owner. Threaded down to `PosixBufferedWriterParent` so the
    /// per-tag dispatch in `bun_runtime::dispatch::__bun_run_file_poll` can
    /// recover the monomorphized `*mut PosixBufferedWriter<StaticPipeWriter<Self>>`.
    const POLL_OWNER_TAG: bun_io::PollTag;
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
    // Self-borrow into `self.source` (the `RawSlice` invariant is satisfied:
    // `source` is owned by `self` and detached only in `on_error`/`on_close`/
    // `Drop`, after which `buffer` is no longer read).
    pub buffer: bun_ptr::RawSlice<u8>,
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
        // SAFETY: refcount hit 0; allocated via `heap::alloc` in `create()`.
        // `Drop` (below) performs `_deinit`'s `writer.end(); source.detach()`.
        drop(unsafe { bun_core::heap::take(this) });
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
    const POLL_OWNER_TAG: bun_io::PollTag = P::POLL_OWNER_TAG;
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
        // Re-borrow the `RawSlice` directly (rather than via the inherent
        // `get_buffer(&self)` accessor) so the returned lifetime `'a` is
        // unbound from `P`'s lifetime parameter.
        unsafe { &*(*this).buffer.as_ptr() }
    }
    const HAS_ON_WRITABLE: bool = false;
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see on_write. Shared-only read of event_loop.
        unsafe { (*this).io_evtloop() }
    }
}

#[cfg(windows)]
impl<P: StaticPipeWriterProcess> bun_io::pipe_writer::WindowsWriterParent for StaticPipeWriter<P> {
    unsafe fn loop_(this: *mut Self) -> *mut bun_libuv_sys::Loop {
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
        // Re-borrow the `RawSlice` directly (rather than via the inherent
        // `get_buffer(&self)` accessor) so the returned lifetime `'a` is
        // unbound from `P`'s lifetime parameter.
        unsafe { &*(*this).buffer.as_ptr() }
    }
    const HAS_ON_WRITABLE: bool = false;
}

impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
    /// `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the io-layer
    /// `FilePollVTable` round-trips back to the runtime. We pass the address of
    /// the stored `bun_jsc::EventLoopHandle` so the (runtime-registered) vtable
    /// can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        self.event_loop.as_event_loop_ctx()
    }

    pub fn update_ref(&mut self, add: bool) {
        self.writer.update_ref(self.io_evtloop(), add);
    }

    /// Returns the remaining unwritten slice.
    ///
    /// # Safety (internal invariant)
    /// `self.buffer` is never null: it is initialized to `b""` in `create()` and
    /// thereafter always points into `self.source`'s storage (set in `start()`,
    /// advanced in `on_write()`). `self.source` is owned by `self` and detached
    /// only in `on_error`/`on_close`/`Drop`, after which `buffer` is no longer
    /// read. The pointee bytes are immutable for the lifetime of `self`.
    #[inline]
    pub fn get_buffer(&self) -> &[u8] {
        self.buffer.slice()
    }

    /// Raw backref to the owning process.
    ///
    /// Returns a raw pointer (NOT `&P`/`&mut P`) because `StaticPipeWriter` is
    /// itself a field of `P`: any live `&self`/`&mut self` already aliases the
    /// process's memory, so materializing `&P` here would violate Rust's
    /// aliasing rules. Callers must go through `P`'s `*mut Self`-taking methods
    /// (e.g. [`StaticPipeWriterProcess::on_close_io`]).
    #[inline]
    pub fn process_ptr(&self) -> *mut P {
        self.process
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
        if !self.get_buffer().is_empty() {
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
            buffer: bun_ptr::RawSlice::EMPTY,
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
            std::ptr::from_ref(self) as usize
        );
        // Zig `this.ref()` — intrusive-refcount increment.
        // SAFETY: `self` is a live `Self` (created via `create()`/`heap::alloc`).
        unsafe { RefCount::<Self>::ref_(std::ptr::from_mut::<Self>(self)) };
        // Self-borrow — see `buffer` field note (`RawSlice` invariant).
        self.buffer = bun_ptr::RawSlice::new(self.source.slice());
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
        let buf = self.get_buffer();
        self.buffer = bun_ptr::RawSlice::new(&buf[amount.min(buf.len())..]);
        if status == WriteStatus::EndOfFile || self.get_buffer().is_empty() {
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
        // SAFETY: `process_ptr()` is a non-null backref to the owning process,
        // guaranteed alive for the lifetime of this writer (the process owns/
        // outlives its stdio writers). Passed raw — see `process_ptr()` doc.
        unsafe { P::on_close_io(self.process_ptr(), StdioKind::Stdin) };
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<Self>() + self.source.memory_cost() + self.writer.memory_cost()
    }

    pub fn loop_(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.event_loop.uv_loop()
        }
        #[cfg(not(windows))]
        {
            self.event_loop.r#loop()
        }
    }

    pub fn watch(&mut self) {
        if !self.get_buffer().is_empty() {
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
