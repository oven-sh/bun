use core::cell::Cell;
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

/// Zig: `pub fn NewStaticPipeWriter(comptime ProcessType: type) type { return struct { ... } }`
///
/// Generic over the owning process type (e.g. `Subprocess`, `ShellSubprocess`).
/// `P` must expose `fn on_close_io(&mut self, kind: StdioKind)`.
// TODO(port): add `P: OnCloseIo` trait bound once that trait exists; left unbounded for Phase A.
pub struct StaticPipeWriter<P> {
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
    // offset instead of a borrowed slice. `&'static` is a placeholder, not accurate.
    pub buffer: &'static [u8],
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
// TODO(port): wire `bun_io::BufferedWriterHandler` impl forwarding to the inherent
// `get_buffer`/`on_close`/`on_error`/`on_write` below, with `ON_WRITABLE = None`.
pub type IOWriter<P> = BufferedWriter<StaticPipeWriter<P>>;
/// Zig: `pub const Poll = IOWriter;`
pub type Poll<P> = IOWriter<P>;

impl<P> StaticPipeWriter<P> {
    pub fn update_ref(&mut self, add: bool) {
        self.writer.update_ref(self.event_loop, add);
    }

    pub fn get_buffer(&self) -> &[u8] {
        self.buffer
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
        if !self.buffer.is_empty() {
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
            buffer: b"",
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
        self.buffer = self.source.slice();
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
        self.buffer = &self.buffer[amount.min(self.buffer.len())..];
        if status == WriteStatus::EndOfFile || self.buffer.is_empty() {
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
        unsafe { (*self.process).on_close_io(StdioKind::Stdin) };
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
        if !self.buffer.is_empty() {
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
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess/StaticPipeWriter.zig (142 lines)
//   confidence: medium
//   todos:      5
//   notes:      buffer self-borrows source (placeholder &'static); IntrusiveRc/BufferedWriterHandler wiring + P trait bound deferred to Phase B
// ──────────────────────────────────────────────────────────────────────────
