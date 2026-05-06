use core::cell::Cell;
use core::ffi::c_void;
use core::mem::size_of;

use bun_aio::Loop as AsyncLoop;
use bun_io::{BufferedWriter, WriteStatus};
use bun_jsc::EventLoopHandle;
use bun_ptr::IntrusiveRc;
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
    /// # Safety
    /// `this` must point to a live `Self`.
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind);
}

/// Zig: `pub fn NewStaticPipeWriter(comptime ProcessType: type) type { return struct { ... } }`
///
/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
/// `P` must expose `fn on_close_io(&mut self, kind: StdioKind)`.
pub struct StaticPipeWriter<P: StaticPipeWriterProcess> {
    /// Intrusive refcount; `ref`/`deref` provided via `bun_ptr::IntrusiveRefCounted`.
    pub ref_count: Cell<u32>,
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
// In Rust the intrusive refcount methods come from `bun_ptr::IntrusiveRefCounted`;
// the `_deinit` destructor maps to `impl Drop` below, and the final `bun.destroy`
// (Box free) is performed by `IntrusiveRc<Self>` when the count reaches zero.
// TODO(port): impl `bun_ptr::IntrusiveRefCounted for StaticPipeWriter<P>` (field = ref_count).

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
        unsafe { (*this).get_buffer() }
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
        unsafe { bun_ptr::intrusive_ref(&*this) };
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see loop_. Intrusive refcount drop; may free `this`.
        unsafe { bun_ptr::intrusive_deref(&*this) };
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
        unsafe { (*this).get_buffer() }
    }
    const HAS_ON_WRITABLE: bool = false;
}

impl<P: StaticPipeWriterProcess> StaticPipeWriter<P> {
    /// CYCLEBREAK: `bun_io::EventLoopHandle` is an opaque `*mut c_void` that the
    /// io-layer `FilePollVTable` round-trips back to the runtime. We pass the
    /// address of the stored `bun_jsc::EventLoopHandle` so the (runtime-registered)
    /// vtable can recover it.
    #[inline]
    fn io_evtloop(&self) -> bun_io::EventLoopHandle {
        // SAFETY: `bun_io::EventLoopHandle` stores `*mut c_void` purely for
        // type-erasure; vtable consumers treat the pointee as read-only
        // (`*const bun_jsc::EventLoopHandle`) and never write through it.
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
    pub fn create<E>(
        event_loop: E,
        subprocess: *mut P,
        result: StdioResult,
        source: Source,
    ) -> IntrusiveRc<Self> {
        let this = Box::into_raw(Box::new(Self {
            ref_count: Cell::new(1),
            writer: IOWriter::<P>::default(),
            stdio_result: result,
            source,
            process: subprocess,
            event_loop: EventLoopHandle::init(event_loop),
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
        // TODO(port): `self.ref_()` — intrusive-refcount increment (Zig `this.ref()`).
        bun_ptr::intrusive_ref(self);
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
                        let poll = self.writer.handle.poll;
                        poll.flags.insert(bun_aio::PollFlag::Socket);
                    }
                    bun_sys::Result::SUCCESS
                }
            }
        }
    }

    pub fn on_write(&mut self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            StaticPipeWriter,
            "StaticPipeWriter(0x{:x}) onWrite(amount={} {:?})",
            self as *const _ as usize,
            amount,
            status
        );
        let len = self.buffer.len();
        // SAFETY: `buffer` points into `self.source`'s storage, alive for `self`'s lifetime.
        self.buffer = unsafe { &(*self.buffer)[amount.min(len)..] } as *const [u8];
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
        #[cfg(windows)]
        {
            self.event_loop.loop_().uv_loop
        }
        #[cfg(not(windows))]
        {
            self.event_loop.loop_()
        }
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
impl<P> Drop for StaticPipeWriter<P> {
    fn drop(&mut self) {
        self.writer.end();
        self.source.detach();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// BufferedWriter parent trait — wires bun_io callbacks to inherent methods.
// Zig: `bun.io.BufferedWriter(@This(), struct { onWritable = null; getBuffer; onClose; onError; onWrite })`
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
impl<P> bun_io::pipe_writer::PosixBufferedWriterParent for StaticPipeWriter<P> {
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: `this` is the BACKREF set via `set_parent`; the BufferedWriter
        // holds `&mut writer` (a field of `*this`) but never materializes
        // `&mut StaticPipeWriter`, so re-entering via `&mut *this` here is the
        // intrusive-field aliasing model used throughout bun_io.
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
        // SAFETY: see on_write. Returned slice borrows `(*this).source` storage.
        unsafe { (*this).get_buffer() }
    }
    const HAS_ON_WRITABLE: bool = false;
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // CYCLEBREAK: `bun_io::EventLoopHandle` is an opaque `*mut c_void` whose
        // pointee the io tier never dereferences directly; pass the address of
        // the stored `bun_jsc::EventLoopHandle` field.
        // SAFETY: `this` points to a live Self (BACKREF contract).
        bun_io::EventLoopHandle(unsafe { &(*this).event_loop } as *const _ as *mut core::ffi::c_void)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/StaticPipeWriter.zig (142 lines)
//   confidence: medium
//   todos:      5
//   notes:      buffer self-borrows source (raw *const [u8], Phase B may switch to offset+len); IntrusiveRc/BufferedWriterHandler wiring + P trait bound deferred to Phase B
// ──────────────────────────────────────────────────────────────────────────
