//! Bun.Terminal - Creates a pseudo-terminal (PTY) for interactive terminal sessions.
//!
//! This module provides a Terminal class that creates a PTY master/slave pair,
//! allowing JavaScript code to interact with terminal-based programs.
//!
//! Lifecycle:
//! - Starts with weak JSRef (allows GC if user doesn't hold reference)
//! - Upgrades to strong when actively reading/writing
//! - Downgrades to weak on EOF from master_fd
//! - Callbacks are stored in the wrapper's `internalFields`, accessed via js.gc

use core::cell::Cell;
#[cfg(not(windows))]
use core::ffi::c_int;
#[cfg(windows)]
use core::sync::atomic::{AtomicU32, Ordering};

use crate::node::StringOrBuffer;
use bun_core::EncodedSlice;
use bun_core::SignalCode;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_io::{
    BufferedReader, IoEvent, Owner, PollTag, ReadResult, StreamingWriter, WriteHandler, WriteStatus,
};
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{
    self as jsc, EventLoopHandle, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
    MarkedArrayBuffer, SysErrorJsc,
};
use bun_sys::{self as sys, Fd, File};

#[cfg(windows)]
use bun_sys::windows;
#[cfg(windows)]
use std::os::windows::io::{IntoRawHandle as _, OwnedHandle};

bun_output::declare_scope!(Terminal, hidden);

pub(crate) use crate::generated_bindgen::terminal::js_Terminal as js;

/// Reference counting for Terminal.
/// Refs are held by:
/// 1. The JS wrapper (released when it is collected)
/// 2. Reader (released in `on_read_result`)
/// 3. Writer (released in `on_close`)
/// 4. A write in flight, on Windows
#[derive(bun_ptr::RefCounted)]
pub(crate) struct Terminal {
    ref_count: bun_ptr::RefCount<Terminal>,

    /// The master side of the PTY (original fd, used for ioctl operations)
    #[cfg(unix)]
    master: JsCell<Option<File>>,

    /// The slave side of the PTY (used by child processes).
    #[cfg(unix)]
    slave: JsCell<Option<File>>,

    /// Windows ConPTY handle. Used for resize and passed to uv_spawn via
    /// uv_process_options_t.pseudoconsole.
    #[cfg(windows)]
    hpcon: JsCell<Option<windows::PseudoConsole>>,

    /// Current terminal size
    cols: Cell<u16>,
    rows: Cell<u16>,

    /// Event loop handle for callbacks. Read-only after construction.
    event_loop_handle: EventLoopHandle,

    /// Global object reference. Read-only after construction.
    global_this: bun_ptr::BackRef<JSGlobalObject>,

    /// Writer for sending data to the terminal
    writer: StreamingWriter,

    /// Reader for receiving data from the terminal
    reader: BufferedReader,

    /// Held until the writer closes.
    writer_ref: JsCell<Option<bun_ptr::RefPtr<Terminal>>>,
    /// Held while a write is in flight.
    #[cfg(windows)]
    inflight_write_ref: Cell<Option<bun_ptr::RefPtr<Terminal>>>,

    /// Held until the reader is done.
    reader_ref: JsCell<Option<bun_ptr::RefPtr<Terminal>>>,

    /// The JS wrapper, which roots the callbacks in its cached slots. Strong
    /// until no callback can fire, then weak (`maybe_downgrade_after_eof`).
    this_value: JsCell<JsRef>,

    /// State flags
    flags: Cell<Flags>,

    /// The writer holds bytes it has not flushed to the fd yet, so a `drain`
    /// is still owed. Gates the post-EOF downgrade in
    /// `maybe_downgrade_after_eof`.
    writer_has_buffered: Cell<bool>,

    /// This PTY's own raw-mode state (mode + saved termios), so one terminal
    /// going raw never makes another terminal's setRawMode a no-op.
    #[cfg(unix)]
    tty_state: Cell<bun_core::tty::State>,

    /// Armed while open, for a terminal that script of a `Bun.ModuleGraph` opened: it closes with the graph.
    abort_handle: jsc::AbortHandle,
}

jsc::impl_abort_handle_owner!(Terminal, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live; the wrapper's ref outlasts the close.
    unsafe { (*this).close_without_callbacks() }
});

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const CLOSED         = 1 << 0;
        const FINALIZED      = 1 << 1;
        const RAW_MODE       = 1 << 2;
        const READER_STARTED = 1 << 3;
        /// Set once an inline-created terminal is attached to a spawn; blocks
        /// reuse. Windows: the ConDrv `\Reference` handle is released at spawn.
        /// POSIX: slave_fd is held until first exit (`drain_and_close_slave_fd`).
        const INLINE_SPAWNED = 1 << 6;
        /// The `exit` callback has run (or was skipped). The wrapper stays
        /// strong until then; see `maybe_downgrade_after_eof`.
        const EXIT_DISPATCHED = 1 << 7;
    }
}

/// Options for creating a Terminal
pub(crate) struct Options {
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) data_callback: Option<JSValue>,
    pub(crate) exit_callback: Option<JSValue>,
    pub(crate) drain_callback: Option<JSValue>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            cols: 80,
            rows: 24,
            data_callback: None,
            exit_callback: None,
            drain_callback: None,
        }
    }
}

// Local extension shims for typed optional property reads. Typed
// `getOptional` is not yet a single inherent generic on `bun_jsc::JSValue`;
// these wrap `get` + the per-type coercion. `withAsyncContextIfNeeded` is the
// inherent `JSValue::with_async_context_if_needed` in `bun_jsc` — call sites
// resolve to that directly, no shim here.
trait JSValueTerminalExt {
    fn get_optional_i32(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<i32>>;
    fn get_optional_value(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<JSValue>>;
}
impl JSValueTerminalExt for JSValue {
    fn get_optional_i32(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<i32>> {
        match self.get(global, name)? {
            Some(v) if !v.is_undefined_or_null() => Ok(Some(v.coerce::<i32>(global)?)),
            _ => Ok(None),
        }
    }
    fn get_optional_value(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<JSValue>> {
        match self.get(global, name)? {
            Some(v) if !v.is_undefined_or_null() => Ok(Some(v)),
            _ => Ok(None),
        }
    }
}

impl Options {
    /// Maximum length for terminal name (e.g., "xterm-256color")
    /// Longest known terminfo names are ~23 chars; 128 allows for custom terminals
    pub(crate) const MAX_TERM_NAME_LEN: usize = 128;

    /// Parse terminal options from a JS object
    pub(crate) fn parse_from_js(
        global_object: &JSGlobalObject,
        js_options: JSValue,
    ) -> JsResult<Options> {
        let mut options = Options::default();

        if let Some(n) = js_options.get_optional_i32(global_object, b"cols")? {
            if n > 0 && n <= 65535 {
                options.cols = u16::try_from(n).expect("int cast");
            }
        }

        if let Some(n) = js_options.get_optional_i32(global_object, b"rows")? {
            if n > 0 && n <= 65535 {
                options.rows = u16::try_from(n).expect("int cast");
            }
        }

        // `name` is a documented option (bun.d.ts) that nothing consumes yet;
        // it is still type- and length-checked.
        if let Some(name) = js_options.get_optional_slice(global_object, b"name")? {
            if name.slice().len() > Self::MAX_TERM_NAME_LEN {
                return Err(global_object.throw(format_args!(
                    "Terminal name too long (max {} characters)",
                    Self::MAX_TERM_NAME_LEN
                )));
            }
        }

        if let Some(v) = js_options.get_optional_value(global_object, b"data")? {
            if v.is_cell() && v.is_callable() {
                options.data_callback = Some(v.with_async_context_if_needed(global_object));
            }
        }

        if let Some(v) = js_options.get_optional_value(global_object, b"exit")? {
            if v.is_cell() && v.is_callable() {
                options.exit_callback = Some(v.with_async_context_if_needed(global_object));
            }
        }

        if let Some(v) = js_options.get_optional_value(global_object, b"drain")? {
            if v.is_cell() && v.is_callable() {
                options.drain_callback = Some(v.with_async_context_if_needed(global_object));
            }
        }

        Ok(options)
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum InitError {
    #[error("OpenPtyFailed")]
    OpenPtyFailed,
    #[error("DupFailed")]
    DupFailed,
    #[error("NotSupported")]
    NotSupported,
    #[error("WriterStartFailed")]
    WriterStartFailed,
    #[error("ReaderStartFailed")]
    ReaderStartFailed,
}

impl From<CreatePtyError> for InitError {
    fn from(e: CreatePtyError) -> Self {
        match e {
            CreatePtyError::OpenPtyFailed => InitError::OpenPtyFailed,
            CreatePtyError::DupFailed => InitError::DupFailed,
            CreatePtyError::NotSupported => InitError::NotSupported,
        }
    }
}

impl Terminal {
    #[inline]
    fn global(&self) -> &JSGlobalObject {
        // `global_this` is a `BackRef` set from a valid `&JSGlobalObject` in
        // `open`; the VM outlives every Terminal (JSC_BORROW).
        self.global_this.get()
    }

    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// `self`'s address for `AbortHandle::arm_owner`, whose callback borrows it shared.
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    // ─────────────────────────────────────────────────────────────────────────

    fn is_reader_done(&self) -> bool {
        self.reader_ref.get().is_none()
    }

    fn is_writer_done(&self) -> bool {
        self.writer_ref.get().is_none()
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant JS).
    fn ref_guard(&self) -> bun_ptr::RefPtr<Self> {
        // SAFETY: the writer's owner is the allocation that holds `self`.
        unsafe { bun_ptr::RefPtr::init_ref(self.writer.owner().ptr().cast()) }
    }

    /// Opens the PTY and starts reading. The caller gives the returned ref to the JS wrapper, then calls [`attach`](Self::attach).
    fn open(
        global_object: &JSGlobalObject,
        options: &Options,
    ) -> Result<bun_ptr::RefPtr<Terminal>, InitError> {
        // Create PTY
        let pty_result = create_pty(options.cols, options.rows)?;

        // The intrusive ref_count starts at 1: the JS wrapper's ref.
        let terminal = bun_ptr::RefPtr::new(Terminal {
            ref_count: bun_ptr::RefCount::init(),
            #[cfg(unix)]
            master: JsCell::new(Some(pty_result.master)),
            #[cfg(unix)]
            slave: JsCell::new(Some(pty_result.slave)),
            #[cfg(windows)]
            hpcon: JsCell::new(Some(pty_result.hpcon)),
            cols: Cell::new(if cfg!(windows) {
                u16::try_from(clamp_to_coord(options.cols)).expect("int cast")
            } else {
                options.cols
            }),
            rows: Cell::new(if cfg!(windows) {
                u16::try_from(clamp_to_coord(options.rows)).expect("int cast")
            } else {
                options.rows
            }),
            event_loop_handle: EventLoopHandle::init(global_object.bun_vm().event_loop_ptr()),
            global_this: bun_ptr::BackRef::new(global_object),
            writer: StreamingWriter::default(),
            reader: BufferedReader::init(),
            writer_ref: JsCell::new(None),
            #[cfg(windows)]
            inflight_write_ref: Cell::new(None),
            reader_ref: JsCell::new(None),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::empty()),
            writer_has_buffered: Cell::new(false),
            #[cfg(unix)]
            tty_state: Cell::new(bun_core::tty::State::new()),
            abort_handle: jsc::AbortHandle::for_owner::<Terminal>(),
        });
        let owner = |tag| Owner::new(tag, terminal.as_ptr().cast());
        // SAFETY: `owner` points to the heap allocation that holds the reader and the writer.
        unsafe {
            terminal.reader.set_owner(owner(PollTag::TerminalReader));
            terminal.writer.set_owner(owner(PollTag::TerminalWriter));
        }
        let event_loop = terminal.event_loop_handle.as_event_loop_ctx();

        // Start writer with the write fd - adds a ref.
        match terminal
            .writer
            .start(&*terminal, event_loop, pty_result.write, true)
        {
            sys::Result::Ok(()) => terminal.writer_ref.set(Some(terminal.clone())),
            sys::Result::Err(_) => {
                // The writer did not take its ref, and the reader never started.
                drop(pty_result.read);
                terminal.close_internal();
                return Err(InitError::WriterStartFailed);
            }
        }

        // Start reader with the read fd - adds a ref.
        let Ok(result) = terminal
            .reader
            .start(event_loop, pty_result.read.into(), true)
        else {
            return Err(terminal.fail_reader_start());
        };
        terminal.reader_ref.set(Some(terminal.clone()));
        terminal.on_read_result(result);
        if terminal.is_reader_done() {
            return Err(terminal.fail_reader_start());
        }
        // PTY behaves like a pipe, not a socket
        #[cfg(unix)]
        terminal
            .reader
            .update_flags(|f| f.insert(PosixFlags::NONBLOCKING));
        terminal.update_flags(|f| f.insert(Flags::READER_STARTED));

        // Start reading data
        terminal.read(None);
        // The first read can end the reader too: EOF, a read error, or a failed re-arm.
        if terminal.is_reader_done() {
            return Err(terminal.fail_reader_start());
        }

        Ok(terminal)
    }

    /// `this_value` is the JS wrapper, which owns the ref [`open`](Self::open) returned.
    fn attach(
        &self,
        global_object: &JSGlobalObject,
        context: &jsc::ScriptExecutionContext,
        options: &Options,
        this_value: JSValue,
    ) {
        // Start with strong ref since we're actively reading.
        self.this_value
            .set(JsRef::init_strong(this_value, global_object));

        // Store callbacks via generated gc setters (prevents GC of callbacks while terminal is alive)
        // Note: callbacks were already validated in parseFromJS() and may be wrapped in AsyncContextFrame
        // by withAsyncContextIfNeeded(), so we don't re-check isCallable() here
        if let Some(cb) = options.data_callback {
            js::data_set_cached(this_value, global_object, cb);
        }
        if let Some(cb) = options.exit_callback {
            js::exit_set_cached(this_value, global_object, cb);
        }
        if let Some(cb) = options.drain_callback {
            js::drain_set_cached(this_value, global_object, cb);
        }

        if let Some(context) = global_object.bun_vm().as_graph_context(context) {
            // SAFETY: heap-allocated in `open`; leaves its context in `close_internal`.
            unsafe { jsc::AbortHandle::arm_owner(self.as_ctx_ptr(), context) };
        }
    }

    /// `open` error path for a reader that finished before the
    /// terminal reached JS, with the reader's ref already released.
    /// `close_internal` closes what is still open (a writer that is still
    /// open releases its ref through `on_close`); `open` then drops
    /// the initial ref.
    fn fail_reader_start(&self) -> InitError {
        self.close_internal();
        InitError::ReaderStartFailed
    }

    /// Constructor for Terminal - called from JavaScript
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        options: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global_object = cx.global();
        let options = options.to_js();

        if !options.is_object() {
            return Err(global_object.throw(format_args!(
                "Terminal constructor requires an options object"
            )));
        }

        let options = Options::parse_from_js(global_object, options)?;

        let terminal = Self::open(global_object, &options).map_err(|err| match err {
            InitError::OpenPtyFailed => global_object.throw(format_args!("Failed to open PTY")),
            InitError::DupFailed => {
                global_object.throw(format_args!("Failed to duplicate PTY file descriptor"))
            }
            InitError::NotSupported => {
                global_object.throw(format_args!("PTY not supported on this platform"))
            }
            InitError::WriterStartFailed => {
                global_object.throw(format_args!("Failed to start terminal writer"))
            }
            InitError::ReaderStartFailed => {
                global_object.throw(format_args!("Failed to start terminal reader"))
            }
        })?;
        let this = terminal.this_ptr();
        let this_value = structure.create(&cx.heap, terminal);
        let global_object = cx.global();
        let context = global_object.bun_vm().context_of_caller();
        this.attach(global_object, context, &options, this_value.to_js());
        Ok(this_value)
    }

    /// Create a Terminal from Bun.spawn options (not from JS constructor)
    /// The slave_fd should be used for the subprocess's stdin/stdout/stderr
    pub(crate) fn create_from_spawn<'a>(
        cx: &'a jsc::JsThread<'_>,
        options: &Options,
    ) -> Result<jsc::WrapperGuard<'a, Self>, InitError> {
        let terminal = js::wrap(Self::open(cx.global(), options)?, cx.global());
        terminal.attach(cx.global(), cx.context(), options, terminal.to_js());
        Ok(terminal)
    }

    /// Get the slave fd for subprocess to use
    #[cfg(unix)]
    pub(crate) fn get_slave_fd(&self) -> Fd {
        self.slave.get().as_ref().map_or(Fd::INVALID, File::fd)
    }

    #[cfg(unix)]
    fn master_fd(&self) -> Fd {
        self.master.get().as_ref().map_or(Fd::INVALID, File::fd)
    }

    /// `flags.closed` — read by `Bun.spawn` arg validation.
    #[inline]
    pub(crate) fn is_closed(&self) -> bool {
        self.flags.get().contains(Flags::CLOSED)
    }

    /// `flags.inline_spawned` — read by `Bun.spawn` to reject reuse of an
    /// inline-created terminal.
    #[inline]
    pub(crate) fn is_inline_spawned(&self) -> bool {
        self.flags.get().contains(Flags::INLINE_SPAWNED)
    }

    /// Spawn-side error-path teardown for a terminal created via
    /// `create_from_spawn` whose subprocess never started.
    pub(crate) fn abandon_from_spawn(&self) {
        self.close_without_callbacks();
    }

    /// No callback follows (on Windows the reader drains on after `close_internal`), and the wrapper may be collected.
    fn close_without_callbacks(&self) {
        self.this_value.with_mut(|v| v.downgrade());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.close_internal();
    }

    /// Windows: get the ConPTY handle to pass to uv_spawn via
    /// uv_process_options_t.pseudoconsole.
    #[cfg(windows)]
    pub(crate) fn get_pseudoconsole(&self) -> Option<windows::HPCON> {
        self.hpcon
            .get()
            .as_ref()
            .map(windows::PseudoConsole::as_raw)
    }

    /// Mark a terminal created inline by `Bun.spawn` so it cannot be reused
    /// for a later spawn. See the `INLINE_SPAWNED` flag docs.
    pub(crate) fn mark_inline_spawned(&self) {
        self.update_flags(|f| f.insert(Flags::INLINE_SPAWNED));
    }

    /// Close the parent's copy of slave_fd and mark the terminal inline
    /// spawned (cannot be reused). The child holds its own slave; once every
    /// slave fd is gone the master reader observes EOF.
    pub(crate) fn close_slave_fd(&self) {
        self.mark_inline_spawned();
        #[cfg(unix)]
        self.slave.set(None);
    }

    /// Drain buffered pty output, close our slave_fd, then drive the reader to
    /// EOF and unref both polls so the event loop can exit. BSD kernels flush
    /// the output queue on last slave close; holding ours until
    /// Subprocess::on_process_exit keeps a fast child's writes.
    #[cfg(unix)]
    pub(crate) fn drain_and_close_slave_fd(&self) {
        let flags = self.flags.get();
        if flags.contains(Flags::CLOSED) {
            return;
        }
        // Both reader callbacks below re-enter user JS and may deref; hold a
        // +1 so `self` stays live for the trailing field accesses.
        let guard = self.ref_guard();
        if flags.contains(Flags::READER_STARTED) && !self.is_reader_done() {
            self.read(None);
            if self.flags.get().contains(Flags::CLOSED) {
                return;
            }
        }
        self.close_slave_fd();
        // Read again so the exit callback fires now (EOF on macOS, EIO on
        // Linux) instead of on the next tick when nothing may wake the loop.
        // A grandchild holding the slave keeps this at EAGAIN and re-arms.
        let flags = self.flags.get();
        if flags.contains(Flags::READER_STARTED) && !self.is_reader_done() {
            self.read(None);
        }
        // An inline terminal whose child has exited no longer keeps the event
        // loop alive; the polls stay registered so grandchild output still
        // arrives while anything else keeps the loop running.
        if !self.flags.get().contains(Flags::CLOSED) {
            self.update_ref(false);
        }
        drop(guard);
    }

    /// Windows analogue of `drain_and_close_slave_fd`'s tail: once the direct
    /// child has exited the writer no longer pins the event loop. The reader
    /// stays ref'd so the loop keeps running until conhost delivers the final
    /// frame and EOF (which `release_pseudoconsole_reference` arranged to
    /// happen once the last client disconnects); unreffing it here could let
    /// the loop exit between child-exit and that asynchronous EOF.
    #[cfg(windows)]
    pub(crate) fn unref_after_inline_child_exit(&self) {
        if !self.flags.get().contains(Flags::CLOSED) {
            self.writer.update_ref(false);
        }
    }

    /// Close this HPCON's ConDrv `\Reference` handle so conhost exits on its own
    /// once the last attached client disconnects: the output pipe then breaks
    /// and our reader observes EOF without `on_process_exit` having to tear
    /// ConPTY down (which races conhost's render thread on older builds and can
    /// drop the child's last write). No further spawn against it is possible afterwards.
    #[cfg(windows)]
    pub(crate) fn release_pseudoconsole_reference(&self) {
        if let Some(hpcon) = self.hpcon.get() {
            hpcon.release();
        }
    }

    /// On Windows < 11 24H2, ClosePseudoConsole blocks until the output pipe is
    /// drained. Our reader runs on the event-loop thread, so calling it there
    /// deadlocks. Fire from a detached thread so the event loop keeps draining;
    /// conhost completes its flush and our reader sees the final data then EOF.
    /// hpcon is passed to the thread by value so the Terminal struct may be freed
    /// before the thread completes.
    #[cfg(windows)]
    fn close_pseudoconsole_off_thread(&self, hpcon: windows::PseudoConsole) {
        // PORTING.md bans std::process but not std::thread; a raw detached OS
        // thread is intentional here (no event-loop integration needed).
        match std::thread::Builder::new().spawn(move || hpcon.close()) {
            Ok(_t) => {
                // detached: JoinHandle dropped without join → thread runs to completion.
            }
            Err(_) => {
                // CreateThread failed — the process is in a bad state. Close the
                // reader so `on_read_result` runs (releasing the reader
                // ref) instead of hanging on an EOF that will never come. Leak hpcon;
                // calling ClosePseudoConsole here would deadlock since reader.close()
                // is async (uv_close) and the pipe HANDLE is still open. Conhost sees
                // broken-pipe once libuv's deferred close runs.
                let flags = self.flags.get();
                if flags.contains(Flags::READER_STARTED) && !self.is_reader_done() {
                    self.on_read_result(self.reader.close());
                }
            }
        }
    }
}

pub(crate) struct PtyResult {
    #[cfg(unix)]
    pub(crate) master: File,
    /// Duplicated master fd (POSIX) / overlapped read pipe end (Windows)
    pub(crate) read: File,
    /// Duplicated master fd (POSIX) / overlapped write pipe end (Windows)
    pub(crate) write: File,
    #[cfg(unix)]
    pub(crate) slave: File,
    #[cfg(windows)]
    pub(crate) hpcon: windows::PseudoConsole,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum CreatePtyError {
    #[error("OpenPtyFailed")]
    OpenPtyFailed,
    #[error("DupFailed")]
    DupFailed,
    #[error("NotSupported")]
    NotSupported,
}

fn create_pty(cols: u16, rows: u16) -> Result<PtyResult, CreatePtyError> {
    #[cfg(unix)]
    {
        return create_pty_posix(cols, rows);
    }
    #[cfg(windows)]
    {
        return create_pty_windows(cols, rows);
    }
    #[cfg(not(any(unix, windows)))]
    Err(CreatePtyError::NotSupported)
}

// OpenPtyTermios is required for the openpty() extern signature even though we pass null.
// Kept for type correctness of the C function declaration.
#[repr(C)]
#[cfg(not(windows))]
pub(crate) struct OpenPtyTermios {
    pub c_iflag: u32,
    pub c_oflag: u32,
    pub c_cflag: u32,
    pub c_lflag: u32,
    pub c_cc: [u8; 20],
    pub c_ispeed: u32,
    pub c_ospeed: u32,
}

#[cfg(not(windows))]
pub(crate) use bun_core::Winsize;

#[cfg(not(windows))]
pub(crate) type OpenPtyFn = unsafe extern "C" fn(
    amaster: *mut c_int,
    aslave: *mut c_int,
    name: *mut u8,
    termp: *const OpenPtyTermios,
    winp: *const Winsize,
) -> c_int;

/// Dynamic loading of openpty on Linux (it's in libutil which may not be linked)
#[cfg(any(target_os = "linux", target_os = "android"))]
mod lib_util {
    use super::*;
    use bun_core::{ZStr, zstr};
    use sys::{DynLib, RTLD};

    pub(super) fn get_open_pty() -> Option<OpenPtyFn> {
        // Try libutil.so first (most common), then libutil.so.1
        const LIB_NAMES: [&ZStr; 3] = [
            zstr!("libutil.so"),
            zstr!("libutil.so.1"),
            zstr!("libc.so.6"),
        ];
        static OPEN_PTY: std::sync::OnceLock<Option<OpenPtyFn>> = std::sync::OnceLock::new();
        *OPEN_PTY.get_or_init(|| {
            // SAFETY: parts of the C library, which stay loaded, and the type of its `openpty`.
            unsafe {
                let library = (LIB_NAMES.into_iter())
                    .find_map(|name| DynLib::open_with_flags(name, RTLD::LAZY))
                    .map(DynLib::leak);
                // Android has none of them.
                let library = library.as_deref().unwrap_or(DynLib::GLOBAL);
                library.lookup_as(zstr!("openpty"))
            }
        })
    }
}

#[cfg(unix)]
#[inline(never)]
fn get_open_pty_fn() -> Option<OpenPtyFn> {
    bun_removable_features::removable_definition!(Terminal, get_open_pty_fn);
    // openpty is linked directly on macOS (libc) and FreeBSD (libutil, see
    // scripts/build/bun.ts).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        // Declared locally (not via the `libc` crate) so the `OpenPtyFn`
        // type unifies with the Linux dlsym path.
        unsafe extern "C" {
            // SAFETY precondition: out-param fd pointers must be writable and
            // termp/winp must be null or valid — raw-pointer contract. Kept
            // `unsafe` so the fn item coerces to `OpenPtyFn` (unsafe fn ptr).
            pub(crate) fn openpty(
                amaster: *mut c_int,
                aslave: *mut c_int,
                name: *mut u8,
                termp: *const OpenPtyTermios,
                winp: *const Winsize,
            ) -> c_int;
        }
        return Some(openpty);
    }

    // On Linux, openpty is in libutil, which may not be linked
    // Load it dynamically via dlopen
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return lib_util::get_open_pty();
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        target_os = "freebsd"
    )))]
    None
}

#[cfg(unix)]
fn create_pty_posix(cols: u16, rows: u16) -> Result<PtyResult, CreatePtyError> {
    let Some(openpty_fn) = get_open_pty_fn() else {
        return Err(CreatePtyError::NotSupported);
    };

    let mut master_fd: c_int = -1;
    let mut slave_fd: c_int = -1;

    let winsize = Winsize {
        row: rows,
        col: cols,
        xpixel: 0,
        ypixel: 0,
    };

    // SAFETY: openpty writes to master_fd/slave_fd; name/termp are null (allowed).
    let result = unsafe {
        openpty_fn(
            &raw mut master_fd,
            &raw mut slave_fd,
            core::ptr::null_mut(),
            core::ptr::null(),
            &raw const winsize,
        )
    };
    if result != 0 {
        return Err(CreatePtyError::OpenPtyFailed);
    }

    let master = File::from_fd(Fd::from_native(master_fd));
    let slave = File::from_fd(Fd::from_native(slave_fd));

    // Configure sensible terminal defaults matching node-pty behavior.
    // These are "cooked mode" defaults that most terminal applications expect.
    match sys::posix::tcgetattr(slave_fd) {
        Ok(termios) => {
            let mut t = termios;

            // Input flags: standard terminal input processing
            t.c_iflag = libc::ICRNL // Map CR to NL on input
                | libc::IXON // Enable XON/XOFF flow control on output
                | libc::IXANY // Any character restarts output
                | libc::IMAXBEL // Ring bell on input queue full
                | libc::BRKINT; // Signal interrupt on break
            // IUTF8: only set where the libc constant is exposed.
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
            {
                t.c_iflag |= libc::IUTF8;
            }

            // Output flags: standard terminal output processing
            t.c_oflag = libc::OPOST // Enable output processing
                | libc::ONLCR; // Map NL to CR-NL on output

            // Control flags: 8-bit chars, enable receiver
            t.c_cflag = libc::CREAD // Enable receiver
                | libc::CS8 // 8-bit characters
                | libc::HUPCL; // Hang up on last close

            // Local flags: canonical mode with echo and signals
            t.c_lflag = libc::ICANON // Canonical input (line editing)
                | libc::ISIG // Enable signals (INTR, QUIT, SUSP)
                | libc::IEXTEN // Enable extended input processing
                | libc::ECHO // Echo input characters
                | libc::ECHOE // Echo erase as backspace-space-backspace
                | libc::ECHOK // Echo NL after KILL
                | libc::ECHOKE // Visual erase for KILL
                | libc::ECHOCTL; // Echo control chars as ^X

            // Control characters - standard defaults
            t.c_cc[libc::VEOF] = 4; // Ctrl-D
            t.c_cc[libc::VEOL] = 0; // Disabled
            t.c_cc[libc::VERASE] = 0x7f; // DEL (backspace)
            t.c_cc[libc::VWERASE] = 23; // Ctrl-W
            t.c_cc[libc::VKILL] = 21; // Ctrl-U
            t.c_cc[libc::VREPRINT] = 18; // Ctrl-R
            t.c_cc[libc::VINTR] = 3; // Ctrl-C
            t.c_cc[libc::VQUIT] = 0x1c; // Ctrl-backslash
            t.c_cc[libc::VSUSP] = 26; // Ctrl-Z
            t.c_cc[libc::VSTART] = 17; // Ctrl-Q (XON)
            t.c_cc[libc::VSTOP] = 19; // Ctrl-S (XOFF)
            t.c_cc[libc::VLNEXT] = 22; // Ctrl-V
            t.c_cc[libc::VDISCARD] = 15; // Ctrl-O
            t.c_cc[libc::VMIN] = 1; // Min chars for non-canonical read
            t.c_cc[libc::VTIME] = 0; // Timeout for non-canonical read

            // Set baud rate to 38400 (standard for PTYs)
            sys::posix::cfsetspeed(&mut t, libc::B38400);

            let _ = sys::posix::tcsetattr(slave_fd, sys::posix::TCSA::Now, &t);
        }
        Err(err) => {
            // tcgetattr failed, log in debug builds but continue without modifying termios
            sys::syslog!("tcgetattr(slave_fd={}) failed: {:?}", slave_fd, err,);
        }
    }

    // Duplicate the master fd for reading and writing separately
    // This allows independent epoll registration and closing
    let dup_master = || {
        sys::dup(master.fd())
            .map(File::from_fd)
            .map_err(|_| CreatePtyError::DupFailed)
    };
    let read = dup_master()?;
    let write = dup_master()?;

    // Set non-blocking on master side fds (for async I/O in the event loop)
    let _ = sys::update_nonblocking(master.fd(), true);
    let _ = sys::update_nonblocking(read.fd(), true);
    let _ = sys::update_nonblocking(write.fd(), true);
    // Note: slave_fd stays blocking - child processes expect blocking I/O

    // Set close-on-exec on master side fds only
    // slave_fd should NOT have close-on-exec since child needs to inherit it
    let _ = crate::api::bun_process::spawn_sys::set_close_on_exec(master.fd());
    let _ = crate::api::bun_process::spawn_sys::set_close_on_exec(read.fd());
    let _ = crate::api::bun_process::spawn_sys::set_close_on_exec(write.fd());

    Ok(PtyResult {
        master,
        read,
        write,
        slave,
    })
}

#[cfg(windows)]
struct PipePair {
    /// Has a libuv fd, for `uv_pipe_open`.
    pub server: File,
    pub client: OwnedHandle,
}

/// Create one end of a pipe pair as an overlapped named pipe (server) and the
/// other as a synchronous client. The "server" end is suitable for libuv (uv_pipe_open) and
/// the "client" end is suitable for ConPTY (which uses synchronous I/O).
#[cfg(windows)]
fn create_overlapped_pipe_pair(
    // PIPE_ACCESS_INBOUND: server reads, client writes.
    // PIPE_ACCESS_OUTBOUND: server writes, client reads.
    server_access: u32,
) -> Result<PipePair, CreatePtyError> {
    let pid: u32 = windows::GetCurrentProcessId();
    let counter = PIPE_SERIAL.fetch_add(1, Ordering::Relaxed);
    let mut name_utf8_buf = [0u8; 96];
    let name = {
        use std::io::Write;
        let mut cursor = &mut name_utf8_buf[..];
        // An AppContainer may only create server pipes under `\\.\pipe\LOCAL\`;
        // insert the segment only then so the name is unchanged outside one
        // (matches libuv's uv__unique_pipe_name).
        let local = if windows::is_app_container() {
            r"LOCAL\"
        } else {
            ""
        };
        if write!(cursor, r"\\.\pipe\{local}bun-conpty-{pid}-{counter}").is_err() {
            return Err(CreatePtyError::OpenPtyFailed);
        }
        let written = 96 - cursor.len();
        &name_utf8_buf[..written]
    };
    let mut name_w_buf = [0u16; 97]; // [96:0]u16
    let name_w_len = bun_core::convert_utf8_to_utf16_in_buffer(&mut name_w_buf, name).len();
    name_w_buf[name_w_len] = 0;
    // SAFETY: name_w_buf[name_w_len] == 0 written above.
    let name_w = bun_core::WStr::from_buf(&name_w_buf[..], name_w_len);

    let server =
        windows::CreateNamedPipeW(name_w, server_access | windows::FILE_FLAG_OVERLAPPED, 65536)
            .map_err(|_| CreatePtyError::OpenPtyFailed)?;

    let client_access: u32 = if server_access == windows::PIPE_ACCESS_INBOUND {
        windows::GENERIC_WRITE
    } else {
        windows::GENERIC_READ
    };

    let client = windows::CreateFileW(name_w, client_access, 0, windows::OPEN_EXISTING, 0)
        .map_err(|_| CreatePtyError::OpenPtyFailed)?;

    let server = File::from_fd(Fd::from_system(server.into_raw_handle()))
        .make_lib_uv_owned()
        .map_err(|_| CreatePtyError::DupFailed)?;
    Ok(PipePair { server, client })
}

#[cfg(windows)]
static PIPE_SERIAL: AtomicU32 = AtomicU32::new(0);

#[cfg(windows)]
fn create_pty_windows(cols: u16, rows: u16) -> Result<PtyResult, CreatePtyError> {
    // Output pipe: ConPTY writes (client), we read (overlapped server).
    let output = create_overlapped_pipe_pair(windows::PIPE_ACCESS_INBOUND)?;
    // Input pipe: we write (overlapped server), ConPTY reads (client).
    let input = create_overlapped_pipe_pair(windows::PIPE_ACCESS_OUTBOUND)?;

    let size = windows::COORD {
        X: clamp_to_coord(cols),
        Y: clamp_to_coord(rows),
    };
    let hpcon = windows::PseudoConsole::new(size, &input.client, &output.client)
        .ok_or(CreatePtyError::OpenPtyFailed)?;

    Ok(PtyResult {
        read: output.server,
        write: input.server,
        hpcon,
    })
}

/// COORD.X/Y are i16; clamp the u16 cols/rows to its range.
#[inline]
fn clamp_to_coord(v: u16) -> i16 {
    i16::try_from(v.min(u16::try_from(i16::MAX).expect("int cast"))).unwrap()
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
enum TermiosField {
    Iflag,
    Oflag,
    Lflag,
    Cflag,
}

impl Terminal {
    /// Check if terminal is closed
    pub(crate) fn get_closed(&self) -> bool {
        self.is_closed()
    }

    fn get_termios_flag<'a, const FIELD: TermiosField>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        #[cfg(not(unix))]
        {
            return bindgen::to_js::f64(heap, 0.0);
        }
        #[cfg(unix)]
        {
            if self.flags.get().contains(Flags::CLOSED) || self.master.get().is_none() {
                return bindgen::to_js::f64(heap, 0.0);
            }
            let Some(termios_data) = get_termios(self.master_fd()) else {
                return bindgen::to_js::f64(heap, 0.0);
            };
            let raw: u64 = match FIELD {
                TermiosField::Iflag => termios_data.c_iflag as u64,
                TermiosField::Oflag => termios_data.c_oflag as u64,
                TermiosField::Lflag => termios_data.c_lflag as u64,
                TermiosField::Cflag => termios_data.c_cflag as u64,
            };
            bindgen::to_js::f64(heap, raw as f64)
        }
    }

    fn set_termios_flag<const FIELD: TermiosField>(
        &self,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) -> JsResult<()> {
        #[cfg(not(unix))]
        {
            let _ = (cx, value);
            return Ok(());
        }
        #[cfg(unix)]
        {
            if self.flags.get().contains(Flags::CLOSED) || self.master.get().is_none() {
                return Ok(());
            }
            let num = value.to_js().coerce_f64(cx.global())?;
            let Some(mut termios_data) = get_termios(self.master_fd()) else {
                return Ok(());
            };
            let max_val: f64 = libc::tcflag_t::MAX as f64;
            // Match Zig's `@max(0, @min(num, max_val))`: apply min first so NaN
            // resolves to max_val (f64::min returns the non-NaN operand), not 0.
            let clamped = num.min(max_val).max(0.0);
            let bits = clamped as libc::tcflag_t;
            match FIELD {
                TermiosField::Iflag => termios_data.c_iflag = bits,
                TermiosField::Oflag => termios_data.c_oflag = bits,
                TermiosField::Lflag => termios_data.c_lflag = bits,
                TermiosField::Cflag => termios_data.c_cflag = bits,
            }
            let _ = set_termios(self.master_fd(), &termios_data);
            Ok(())
        }
    }

    pub(crate) fn get_input_flags<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        self.get_termios_flag::<{ TermiosField::Iflag }>(heap)
    }
    pub(crate) fn set_input_flags(&self, cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<()> {
        self.set_termios_flag::<{ TermiosField::Iflag }>(cx, value)
    }
    pub(crate) fn get_output_flags<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        self.get_termios_flag::<{ TermiosField::Oflag }>(heap)
    }
    pub(crate) fn set_output_flags(
        &self,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) -> JsResult<()> {
        self.set_termios_flag::<{ TermiosField::Oflag }>(cx, value)
    }
    pub(crate) fn get_local_flags<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        self.get_termios_flag::<{ TermiosField::Lflag }>(heap)
    }
    pub(crate) fn set_local_flags(&self, cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<()> {
        self.set_termios_flag::<{ TermiosField::Lflag }>(cx, value)
    }
    pub(crate) fn get_control_flags<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        self.get_termios_flag::<{ TermiosField::Cflag }>(heap)
    }
    pub(crate) fn set_control_flags(
        &self,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) -> JsResult<()> {
        self.set_termios_flag::<{ TermiosField::Cflag }>(cx, value)
    }

    /// Write data to the terminal
    pub(crate) fn write(&self, cx: &mut JsScope<'_>, data: JsLocal<'_>) -> JsResult<usize> {
        let global_object = cx.global();
        if self.flags.get().contains(Flags::CLOSED) {
            return Err(global_object.throw(format_args!("Terminal is closed")));
        }

        let data = data.to_js();

        if data.is_undefined_or_null() {
            return Err(global_object.throw(format_args!("write() requires data argument")));
        }

        // Get bytes to write using StringOrBuffer
        let Some(string_or_buffer) = StringOrBuffer::from_js(global_object, data)? else {
            return Err(global_object.throw(format_args!(
                "write() argument must be a string or ArrayBuffer"
            )));
        };

        let bytes = string_or_buffer.slice();
        let input_len = bytes.len();

        if input_len == 0 {
            return Ok(0);
        }

        // The write side is gone, so queuing these bytes would only re-root the
        // wrapper below for a drain that cannot come.
        if self.is_writer_done() {
            return Ok(input_len);
        }

        // No drain fires from inside `write()`: the flag is restored below.
        let had_buffered = self.writer_has_buffered.replace(false);
        let write_result = self.writer.write(self, bytes);
        // The writer can close inside `write()` and keep the bytes; no drain follows them.
        let writer_done = self.is_writer_done();
        let has_pending = self.writer.has_pending_data() && !writer_done;
        self.writer_has_buffered.set(has_pending);
        if has_pending {
            // Keep the wrapper rooted for the pending drain dispatch; a write
            // after PTY EOF finds it already downgraded.
            self.this_value.with_mut(|v| v.upgrade(global_object));
        }
        // A second write() can drain what an earlier one buffered; on_write saw
        // the cleared flag, so fire drain here.
        #[cfg(unix)]
        if had_buffered && !has_pending && !writer_done {
            self.on_writer_ready();
        }
        #[cfg(not(unix))]
        let _ = had_buffered;

        // StreamingWriter::write() buffers any bytes it couldn't flush
        // synchronously, so the full input has been accepted on every non-error
        // return. The per-arm counts are sync-flushed bytes (and on a buffered
        // writer can even exceed `input_len` when prior data drains), so
        // returning them would make callers re-send an already-queued tail.
        match write_result {
            bun_io::WriteResult::Err(err) => {
                Err(global_object.throw_value(err.to_js(global_object)))
            }
            _ => Ok(input_len),
        }
    }

    /// Resize the terminal
    pub(crate) fn resize<'a>(
        &self,
        heap: &JsHeap<'a>,
        cols: JsLocal<'a>,
        rows: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Err(heap.error(format_args!("Terminal is closed")));
        }

        let new_cols: u16 = 'blk: {
            if cols.to_js().is_number() {
                let n = cols.to_js().to_int32();
                if n > 0 && n <= 65535 {
                    break 'blk u16::try_from(n).expect("int cast");
                }
            }
            return Err(heap.error(format_args!("resize() requires valid cols argument")));
        };

        let new_rows: u16 = 'blk: {
            if rows.to_js().is_number() {
                let n = rows.to_js().to_int32();
                if n > 0 && n <= 65535 {
                    break 'blk u16::try_from(n).expect("int cast");
                }
            }
            return Err(heap.error(format_args!("resize() requires valid rows argument")));
        };

        #[cfg(unix)]
        {
            let winsize = bun_core::Winsize {
                row: new_rows,
                col: new_cols,
                xpixel: 0,
                ypixel: 0,
            };

            if sys::posix::set_winsize(self.master_fd(), winsize).is_err() {
                return Err(heap.error(format_args!("Failed to resize terminal")));
            }
        }

        #[cfg(windows)]
        {
            // HRESULT_FROM_WIN32(ERROR_NO_DATA | ERROR_BROKEN_PIPE): the signal
            // pipe's read end is gone because conhost has exited. For inline
            // terminals that can happen any time after the child disconnects
            // (the \Reference handle is released at spawn); treat it as a
            // no-op so resize() keeps its pre-existing no-throw behaviour in
            // the window between child exit and reader EOF.
            const HR_NO_DATA: i32 = 0x8007_00E8u32 as i32;
            const HR_BROKEN_PIPE: i32 = 0x8007_006Du32 as i32;
            if let Some(hpcon) = self.hpcon.get() {
                let size = windows::COORD {
                    X: clamp_to_coord(new_cols),
                    Y: clamp_to_coord(new_rows),
                };
                let hr = hpcon.resize(size);
                if hr < 0 && hr != HR_NO_DATA && hr != HR_BROKEN_PIPE {
                    return Err(heap.error(format_args!("Failed to resize terminal")));
                }
            }
        }

        self.cols.set(if cfg!(windows) {
            u16::try_from(clamp_to_coord(new_cols)).expect("int cast")
        } else {
            new_cols
        });
        self.rows.set(if cfg!(windows) {
            u16::try_from(clamp_to_coord(new_rows)).expect("int cast")
        } else {
            new_rows
        });

        Ok(())
    }

    /// Set raw mode on the terminal
    pub(crate) fn set_raw_mode<'a>(
        &self,
        heap: &JsHeap<'a>,
        enabled: bool,
    ) -> bindgen::Result<'a, ()> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Err(heap.error(format_args!("Terminal is closed")));
        }

        #[cfg(unix)]
        {
            // Use the existing TTY mode function
            let mut state = self.tty_state.get();
            let tty_result = state.set_mode(
                self.master_fd().native(),
                if enabled {
                    bun_core::tty::Mode::Raw
                } else {
                    bun_core::tty::Mode::Normal
                },
                // Never Drain on the PTY master: with the child blocked in
                // write() on a full PTY, the drain waits on a lock only our
                // own reads can release, freezing the JS thread for as long
                // as the child stays blocked.
                bun_core::tty::SetAttrWhen::Now,
            );
            self.tty_state.set(state);
            if tty_result != 0 {
                return Err(heap.error(format_args!("Failed to set raw mode")));
            }
        }

        self.update_flags(|f| f.set(Flags::RAW_MODE, enabled));
        Ok(())
    }
}

/// POSIX termios struct for terminal flags manipulation
#[cfg(unix)]
type Termios = sys::posix::Termios;

/// Get terminal attributes using tcgetattr
#[cfg(unix)]
fn get_termios(fd: Fd) -> Option<Termios> {
    sys::posix::tcgetattr(fd.native()).ok()
}

/// Set terminal attributes using tcsetattr (TCSANOW = immediate)
#[cfg(unix)]
fn set_termios(fd: Fd, termios_p: &Termios) -> bool {
    sys::posix::tcsetattr(fd.native(), sys::posix::TCSA::Now, termios_p).is_ok()
}

impl Terminal {
    /// Reference the terminal to keep the event loop alive
    pub(crate) fn do_ref(&self) {
        self.update_ref(true);
    }

    /// Unreference the terminal
    pub(crate) fn do_unref(&self) {
        self.update_ref(false);
    }

    fn update_ref(&self, add: bool) {
        self.reader.update_ref(add);
        self.writer.update_ref(add);
    }

    /// Close the terminal
    pub(crate) fn close(&self, _: &mut JsScope<'_>) {
        self.close_internal();
    }

    /// Async dispose for "using" syntax
    pub(crate) fn async_dispose(&self, cx: &mut JsScope<'_>) -> JSValue {
        self.close_without_callbacks();
        jsc::JSPromise::resolved_promise_value(cx.global(), JSValue::UNDEFINED)
    }

    fn close_internal(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::CLOSED));
        self.abort_handle.leave();

        // Close writer (closes its fd)
        self.writer.close(self);

        #[cfg(windows)]
        {
            // Dispatch ClosePseudoConsole off-thread (it blocks until the output
            // pipe is drained on Windows < 11 24H2) and leave the reader open so
            // the event loop can keep draining; conhost flushes the final frame,
            // closes its pipe end, and the reader observes EOF → `on_read_result`.
            if let Some(hpcon) = self.hpcon.take() {
                self.close_pseudoconsole_off_thread(hpcon);
            }
            // Leave the reader open; `on_read_result` closes it on EOF.
            let flags = self.flags.get();
            if flags.contains(Flags::READER_STARTED) && !self.is_reader_done() {
                return;
            }
        }

        // Close reader (closes its fd)
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.on_read_result(self.reader.close());
        }

        #[cfg(unix)]
        {
            self.master.set(None);
            self.slave.set(None);
        }
    }

    pub(crate) fn on_writer_io(&self, event: IoEvent) {
        self.writer.on_io(self, event);
    }

    fn on_writer_ready(&self) {
        bun_output::scoped_log!(Terminal, "onWriterReady");
        // Call drain callback
        if let Some(this_jsvalue) = self.this_value.get().try_get() {
            if let Some(callback) = js::drain_get_cached(this_jsvalue) {
                let global_this = self.global();
                global_this.bun_vm().event_loop().run_callback(
                    bun_event_loop::ContextId::NONE,
                    callback,
                    global_this,
                    this_jsvalue,
                    &[this_jsvalue],
                );
            }
        }
        self.maybe_downgrade_after_eof();
    }

    pub(crate) fn read(&self, event: Option<IoEvent>) {
        let event_loop = self.event_loop_handle.as_event_loop_ctx();
        let result = self.reader.read_chunks(event_loop, event, |chunk, _| {
            self.on_read_chunk(&chunk);
            true
        });
        self.on_read_result(result);
    }

    /// Takes `reader_ref` before the exit callback so re-entry (`terminal.close()` from the
    /// callback) finds it gone and no-ops.
    fn on_read_result(&self, result: ReadResult) {
        // 0 = EOF, 1 = PTY read error; not the subprocess's exit code.
        let exit_code = match result {
            ReadResult::Pending => return,
            ReadResult::Done => 0,
            ReadResult::Err(err) => {
                bun_output::scoped_log!(Terminal, "onReaderError: {:?}", err);
                1
            }
        };
        let Some(_reader_ref) = self.reader_ref.replace(None) else {
            return;
        };
        #[cfg(unix)]
        self.finish_io_after_eof();
        // Skip JS interactions if already finalized (happens when close() is called during finalize)
        if !self.flags.get().contains(Flags::FINALIZED) {
            self.call_exit_callback(exit_code, None);
        }
        // The wrapper stayed strong for `exit`; only a pending `drain` needs
        // it from here on.
        self.update_flags(|f| f.insert(Flags::EXIT_DISPATCHED));
        self.maybe_downgrade_after_eof();
    }

    /// Finish both ends of the PTY once the reader is done, so `exit` is the
    /// last callback. A pty master reports neither side's hangup the way a
    /// pipe does: Linux answers a write with EAGAIN instead of EPIPE, and a
    /// read with EIO instead of EOF. Left alone, the writer waits for a drain
    /// that cannot come and the reader delivers echo after `exit`.
    #[cfg(unix)]
    fn finish_io_after_eof(&self) {
        // EOF closes the reader itself, a read error does not.
        if !self.reader.is_done() {
            self.on_read_result(self.reader.close());
        }
        // `end()` dispatches `on_close`.
        if !self.is_writer_done() {
            self.writer.end(self);
        }
    }

    /// Downgrade `this_value` once no further callback can fire: `exit` has
    /// been dispatched and no `drain` is owed. Downgrading earlier would let
    /// GC collect the wrapper, and with it the callbacks it roots, before the
    /// last dispatch goes through it.
    fn maybe_downgrade_after_eof(&self) {
        let flags = self.flags.get();
        if !flags.contains(Flags::EXIT_DISPATCHED) || flags.contains(Flags::FINALIZED) {
            return;
        }
        if !self.is_writer_done() && self.writer_has_buffered.get() {
            return;
        }
        self.this_value.with_mut(|v| v.downgrade());
    }

    /// Invoke the exit callback with PTY lifecycle status.
    /// Note: exit_code is PTY-level (0=EOF, 1=error), NOT the subprocess exit code.
    /// The signal parameter is only populated if a signal caused the PTY close.
    fn call_exit_callback(&self, exit_code: i32, signal: Option<SignalCode>) {
        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return;
        };
        let Some(callback) = js::exit_get_cached(this_jsvalue) else {
            return;
        };

        let global_this = self.global();
        let signal_value: JSValue = if let Some(s) = signal {
            // SignalCode derives Debug → "SIGTERM" etc.
            let name = format!("{:?}", s);
            EncodedSlice::latin1(name.as_bytes()).to_js(global_this)
        } else {
            JSValue::NULL
        };

        global_this.bun_vm().event_loop().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            global_this,
            this_jsvalue,
            &[
                this_jsvalue,
                JSValue::js_number(exit_code as f64),
                signal_value,
            ],
        );
    }

    // Called when data is available from the reader
    fn on_read_chunk(&self, chunk: &[u8]) {
        bun_output::scoped_log!(Terminal, "onReadChunk: {} bytes", chunk.len());

        if self.flags.get().contains(Flags::FINALIZED) {
            return;
        }

        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return;
        };
        let Some(callback) = js::data_get_cached(this_jsvalue) else {
            return;
        };

        let global_this = self.global();
        // Use try_reserve so a transient OOM on a large chunk doesn't abort
        // the process — log and keep reading instead.
        let mut v: Vec<u8> = Vec::new();
        if v.try_reserve_exact(chunk.len()).is_err() {
            bun_output::scoped_log!(
                Terminal,
                "onReadChunk: dupe failed (OOM), dropping {} bytes",
                chunk.len()
            );
            return;
        }
        v.extend_from_slice(chunk);
        let bytes = v.into_boxed_slice();
        // This is the pipe reader's landing frame: a buffer that cannot be
        // built (allocation failure, a terminating VM) is folded here and
        // reading goes on.
        let data = match MarkedArrayBuffer::from_bytes(bytes, jsc::JSType::Uint8Array)
            .to_node_buffer(global_this)
        {
            Ok(data) => data,
            Err(err) => {
                crate::dispatch::fold(Err(err));
                return;
            }
        };

        // Each chunk's `data` callback is its own top-level call: reported and
        // reading continues, as a stream 'data' listener that throws does.
        global_this.bun_vm().event_loop().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            global_this,
            this_jsvalue,
            &[this_jsvalue, data],
        );
    }

    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(Terminal, "finalize");
        jsc::mark_binding();
        self.this_value.with_mut(|v| v.finalize());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.close_internal();
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        bun_output::scoped_log!(Terminal, "deinit");
        // Close all FDs if not already closed (handles constructor error paths)
        // closeInternal() checks flags.closed and returns early on subsequent calls,
        // so this is safe even if finalize() already called it
        self.close_internal();
    }
}

impl WriteHandler for Terminal {
    fn on_close(&self) {
        bun_output::scoped_log!(Terminal, "onWriterClose");
        if let Some(_writer_ref) = self.writer_ref.replace(None) {
            self.maybe_downgrade_after_eof();
        }
    }

    fn on_error(&self, err: sys::Error) {
        bun_output::scoped_log!(Terminal, "onWriterError: {:?}", err);
        // e.g. a broken pipe when the child process exits
        if !self.flags.get().contains(Flags::CLOSED) {
            self.close_internal();
        }
    }

    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(Terminal, "onWrite: {} bytes", amount);
        match status {
            WriteStatus::Pending => {}
            // Windows fires `drain` from `on_writable`.
            WriteStatus::Drained => {
                let had_buffered = self.writer_has_buffered.replace(false);
                #[cfg(unix)]
                if had_buffered {
                    self.on_writer_ready();
                }
                #[cfg(not(unix))]
                let _ = had_buffered;
            }
            // The writer closed its fd, so no drain can follow.
            WriteStatus::EndOfFile => {
                self.writer_has_buffered.set(false);
                self.maybe_downgrade_after_eof();
            }
        }
    }

    #[cfg(windows)]
    fn on_writable(&self) {
        self.on_writer_ready();
    }

    #[cfg(windows)]
    fn set_has_inflight_write(&self, value: bool) {
        self.inflight_write_ref.set(value.then(|| self.ref_guard()));
    }
}
