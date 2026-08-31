//! Bun.Terminal - Creates a pseudo-terminal (PTY) for interactive terminal sessions.
//!
//! This module provides a Terminal class that creates a PTY master/slave pair,
//! allowing JavaScript code to interact with terminal-based programs.
//!
//! Lifecycle:
//! - Starts with weak JSRef (allows GC if user doesn't hold reference)
//! - Upgrades to strong when actively reading/writing
//! - Downgrades to weak on EOF from master_fd
//! - Callbacks are stored via `values` in classes.ts, accessed via js.gc

use core::cell::Cell;

use crate::node::StringOrBuffer;
use bun_core::EncodedSlice;
use bun_core::SignalCode;
use bun_io::Loop as AsyncLoop;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_io::{BufferedReader, ReadState, StreamingWriter, WriteStatus};
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::{
    self as jsc, CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
    MarkedArrayBuffer, SysErrorJsc,
};
use bun_ptr::{RefPtr, ThisPtr};
#[cfg(windows)]
use bun_sys::pty::PseudoConsole;
use bun_sys::{self as sys, Fd, FdExt};

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
#[cfg(windows)]
use bun_sys::windows;

bun_output::declare_scope!(Terminal, hidden);

// Generated bindings — `jsc.Codegen.JSTerminal`. The `.classes.ts` codegen
// emits `crate::generated_classes::js_Terminal` with `from_js`/`to_js` and the
// cached-value accessors; re-export here so callers continue to spell `js::*`.
pub use self::js::to_js;
pub mod js {
    pub use crate::generated_classes::js_Terminal::{
        data_get_cached, data_set_cached, drain_get_cached, drain_set_cached, exit_get_cached,
        exit_set_cached, from_js, get_constructor, to_js,
    };

    /// Typed accessor for the `values:` slots.
    pub mod gc {
        use bun_jsc::{JSGlobalObject, JSValue};

        #[derive(Clone, Copy)]
        pub enum GcValue {
            Data,
            Exit,
            Drain,
        }

        #[inline]
        pub fn get(which: GcValue, this_value: JSValue) -> Option<JSValue> {
            match which {
                GcValue::Data => super::data_get_cached(this_value),
                GcValue::Exit => super::exit_get_cached(this_value),
                GcValue::Drain => super::drain_get_cached(this_value),
            }
        }

        #[inline]
        pub(crate) fn set(
            which: GcValue,
            this_value: JSValue,
            global: &JSGlobalObject,
            value: JSValue,
        ) {
            match which {
                GcValue::Data => super::data_set_cached(this_value, global, value),
                GcValue::Exit => super::exit_set_cached(this_value, global, value),
                GcValue::Drain => super::drain_set_cached(this_value, global, value),
            }
        }
    }
    pub(crate) use gc::GcValue;
}

/// Reference counting for Terminal.
/// Refs are held by:
/// 1. JS side (released in finalize)
/// 2. Reader (`reader_ref`, released in onReaderDone/onReaderError)
/// 3. Writer (`writer_ref`, released in onWriterClose)
///
// Intrusive single-thread refcount; never `Rc`/`Arc` here: `*mut Terminal`
// crosses FFI as the `.classes.ts` m_ctx payload.
//
// `no_construct, no_finalize`: this class uses `constructNeedsThis: true` (3-arg
// constructor) and intrusive refcounting (finalize → deref, not heap::take),
// neither of which the macro's default hooks support.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The
// BufferedReader/StreamingWriter parent callbacks get `this: ThisPtr<Self>`;
// all field mutation routes through the cells.
#[bun_jsc::JsClass(no_construct, no_finalize)]
#[derive(bun_ptr::RefCounted)]
pub struct Terminal {
    ref_count: bun_ptr::RefCount<Terminal>,
    /// The reader's ref (see above).
    reader_ref: Cell<Option<RefPtr<Terminal>>>,
    /// The writer's ref (see above).
    writer_ref: Cell<Option<RefPtr<Terminal>>>,
    /// Windows: the writer's in-flight async writes (`WindowsWriterParent`);
    /// the next write is submitted before the completed one's ref is dropped,
    /// so up to two are outstanding.
    #[cfg(windows)]
    pending_write_refs: JsCell<Vec<RefPtr<Terminal>>>,

    /// The master side of the PTY (original fd, used for ioctl operations)
    /// On Windows this is always invalid_fd; ConPTY uses hpcon for control.
    master_fd: Cell<Fd>,

    /// Duplicated master fd for reading (POSIX) / overlapped read pipe end (Windows)
    read_fd: Cell<Fd>,

    /// Duplicated master fd for writing (POSIX) / overlapped write pipe end (Windows)
    write_fd: Cell<Fd>,

    /// The slave side of the PTY (used by child processes). Unused on Windows.
    slave_fd: Cell<Fd>,

    /// Windows ConPTY handle. Used for resize and passed to uv_spawn via
    /// uv_process_options_t.pseudoconsole.
    #[cfg(windows)]
    hpcon: JsCell<Option<PseudoConsole>>,

    /// Current terminal size
    cols: Cell<u16>,
    rows: Cell<u16>,

    /// Event loop handle for callbacks. Read-only after construction.
    event_loop_handle: EventLoopHandle,

    /// Global object reference. Read-only after construction.
    // Terminal is a heap-allocated `.classes.ts` m_ctx payload and cannot
    // carry a lifetime param, so the global is stored as a `BackRef` rather
    // than `&JSGlobalObject`; deref via `self.global()`.
    global_this: bun_ptr::BackRef<JSGlobalObject>,

    /// Writer for sending data to the terminal
    writer: JsCell<IOWriter>,

    /// Reader for receiving data from the terminal
    reader: JsCell<IOReader>,

    /// This value reference for GC tracking
    /// - weak: allows GC when idle
    /// - strong: prevents GC when actively connected
    this_value: JsCell<JsRef>,

    /// State flags
    flags: Cell<Flags>,

    /// The streaming writer has accepted bytes it hasn't flushed to the fd
    /// yet. Set by `write()` from `has_pending_data()`; cleared when
    /// `on_write` observes `Drained` so POSIX can fire the `drain` callback
    /// (Windows fires it from `on_writable`). Also gates the post-EOF
    /// downgrade in `maybe_downgrade_after_eof`.
    writer_has_buffered: Cell<bool>,

    /// This PTY's own raw-mode state (mode + saved termios), so one terminal
    /// going raw never makes another terminal's setRawMode a no-op.
    #[cfg(unix)]
    tty_state: Cell<bun_core::tty::State>,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const CLOSED         = 1 << 0;
        const FINALIZED      = 1 << 1;
        const RAW_MODE       = 1 << 2;
        const READER_STARTED = 1 << 3;
        const CONNECTED      = 1 << 4;
        const READER_DONE    = 1 << 5;
        const WRITER_DONE    = 1 << 6;
        /// Set once an inline-created terminal is attached to a spawn; blocks
        /// reuse. Windows: the ConDrv `\Reference` handle is released at spawn.
        /// POSIX: slave_fd is held until first exit (`drain_and_close_slave_fd`).
        const INLINE_SPAWNED = 1 << 7;
    }
}

/// `bun.io.StreamingWriter(@This(), struct { onClose, onWritable, onError, onWrite })`
/// — the anon-struct of callback decls is the `PosixStreamingWriterParent` /
/// `WindowsStreamingWriterParent` trait impls at the bottom of this file.
pub type IOWriter = StreamingWriter<Terminal>;

/// Poll type alias for FilePoll Owner registration
#[cfg(not(windows))]
pub(crate) type Poll = IOWriter;

pub type IOReader = BufferedReader;

/// Options for creating a Terminal
pub struct Options {
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

/// Result from creating a Terminal for `Bun.spawn`.
pub(crate) struct CreateResult {
    /// The new terminal; its initial ref belongs to the JS wrapper (`js_value`),
    /// which holds itself strong until the terminal closes.
    pub terminal: bun_ptr::BackRef<Terminal, bun_ptr::Root>,
    pub js_value: JSValue,
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
        // `init_terminal`; the VM outlives every Terminal (JSC_BORROW).
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

    // ─────────────────────────────────────────────────────────────────────────

    /// Internal initialization - shared by constructor and createFromSpawn.
    /// Returns the initial (JS wrapper's) ref and the wrapper.
    fn init_terminal(
        global_object: &JSGlobalObject,
        options: &Options,
        // If provided, use this JSValue; otherwise create one via toJS
        existing_js_value: Option<JSValue>,
    ) -> Result<(RefPtr<Terminal>, JSValue), InitError> {
        // Create PTY
        let pty_result = create_pty(options.cols, options.rows)?;

        // The intrusive ref_count starts at 1: the JS wrapper's ref.
        let terminal = RefPtr::new(Terminal {
            ref_count: bun_ptr::RefCount::init(),
            reader_ref: Cell::new(None),
            writer_ref: Cell::new(None),
            #[cfg(windows)]
            pending_write_refs: JsCell::new(Vec::new()),
            master_fd: Cell::new(pty_result.master),
            read_fd: Cell::new(pty_result.read_fd),
            write_fd: Cell::new(pty_result.write_fd),
            slave_fd: Cell::new(pty_result.slave),
            #[cfg(windows)]
            hpcon: JsCell::new(Some(pty_result.hpcon)),
            cols: Cell::new(if cfg!(windows) {
                u16::try_from(sys::pty::clamp_to_coord(options.cols)).expect("int cast")
            } else {
                options.cols
            }),
            rows: Cell::new(if cfg!(windows) {
                u16::try_from(sys::pty::clamp_to_coord(options.rows)).expect("int cast")
            } else {
                options.rows
            }),
            event_loop_handle: EventLoopHandle::init(
                global_object.bun_vm().as_mut().event_loop().cast(),
            ),
            global_this: bun_ptr::BackRef::new(global_object),
            writer: JsCell::new(IOWriter::default()),
            reader: JsCell::new(IOReader::init::<Terminal>()),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::empty()),
            writer_has_buffered: Cell::new(false),
            #[cfg(unix)]
            tty_state: Cell::new(bun_core::tty::State::new()),
        });

        // Set reader parent
        let parent_ptr: *mut Terminal = terminal.as_ptr();
        terminal
            .reader
            .with_mut(|r| r.set_parent(parent_ptr.cast()));

        // Set writer parent
        terminal.writer.with_mut(|w| w.parent = parent_ptr);

        // Start writer with the write fd - adds a ref
        match terminal
            .writer
            .with_mut(|w| w.start(pty_result.write_fd, true))
        {
            sys::Result::Ok(()) => terminal.writer_ref.set(Some(terminal.clone())),
            sys::Result::Err(_) => {
                // POSIX: writer.start() may have allocated a poll holding write_fd
                // before registerWithFd failed; closeInternal → writer.close()
                // frees the poll and closes write_fd. Windows: writer.start()
                // failure leaves source==null so writer.close() is a no-op; close
                // write_fd directly. Pre-set writer_done so onWriterClose's release
                // is skipped and the struct isn't freed mid-closeInternal.
                terminal.update_flags(|f| f.insert(Flags::WRITER_DONE));
                terminal.read_fd.get().close();
                terminal.read_fd.set(Fd::INVALID);
                #[cfg(windows)]
                {
                    terminal.write_fd.get().close();
                    terminal.write_fd.set(Fd::INVALID);
                }
                terminal.close_internal();
                return Err(InitError::WriterStartFailed);
            }
        }

        // Start reader with the read fd - holds a ref. Taken first: `start`
        // may dispatch `on_reader_error` synchronously (poll registration
        // failure), which releases it.
        terminal.reader_ref.set(Some(terminal.clone()));
        match terminal
            .reader
            .with_mut(|r| r.start(pty_result.read_fd, true))
        {
            sys::Result::Err(_) => {
                // Reader never started: closeInternal skips reader.close() but
                // runs writer.close() → onWriterClose, releasing the writer's
                // ref (2→1); `terminal` going out of scope drops the initial
                // ref (1→0).
                drop(terminal.reader_ref.take());
                terminal.read_fd.get().close();
                terminal.read_fd.set(Fd::INVALID);
                terminal.close_internal();
                return Err(InitError::ReaderStartFailed);
            }
            sys::Result::Ok(()) => {
                #[cfg(unix)]
                {
                    terminal.reader.with_mut(|r| {
                        if let Some(poll) = r.handle.get_poll() {
                            // PTY behaves like a pipe, not a socket
                            r.flags
                                .insert(PosixFlags::NONBLOCKING | PosixFlags::POLLABLE);
                            poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                        }
                    });
                }
                terminal.update_flags(|f| f.insert(Flags::READER_STARTED));
            }
        }

        // Start reading data (`read`'s dispatch runs user JS, hence the
        // root-pointer entry).
        IOReader::read_from(terminal.this_ptr());

        // Get or create the JS wrapper
        let this_value = existing_js_value.unwrap_or_else(|| js::to_js(parent_ptr, global_object));

        // Store the this_value (JSValue wrapper) - start with strong ref since we're actively reading.
        // The JS-side ref is the one taken by RefCount.init() above; released in finalize().
        terminal
            .this_value
            .set(JsRef::init_strong(this_value, global_object));

        // Store callbacks via generated gc setters (prevents GC of callbacks while terminal is alive)
        // Note: callbacks were already validated in parseFromJS() and may be wrapped in AsyncContextFrame
        // by withAsyncContextIfNeeded(), so we don't re-check isCallable() here
        if let Some(cb) = options.data_callback {
            js::gc::set(js::GcValue::Data, this_value, global_object, cb);
        }
        if let Some(cb) = options.exit_callback {
            js::gc::set(js::GcValue::Exit, this_value, global_object, cb);
        }
        if let Some(cb) = options.drain_callback {
            js::gc::set(js::GcValue::Drain, this_value, global_object, cb);
        }

        Ok((terminal, this_value))
    }

    /// Constructor for Terminal - called from JavaScript
    /// With constructNeedsThis: true, we receive the JSValue wrapper directly.
    /// Thunk emitted by `.classes.ts` codegen (`TerminalClass__construct` in
    /// `generated_classes.rs`); the `JsClass(no_construct)` attribute suppresses
    /// the macro's 2-arg default.
    pub(crate) fn constructor(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<*mut Terminal> {
        let args = callframe.arguments_as_array::<1>();
        let js_options = args[0];

        if !js_options.is_object() {
            return Err(global_object.throw(format_args!(
                "Terminal constructor requires an options object"
            )));
        }

        let options = Options::parse_from_js(global_object, js_options)?;

        match Self::init_terminal(global_object, &options, Some(this_value)) {
            Ok((terminal, _)) => {
                // Hand the intrusive ref to the JS wrapper as m_ctx; finalize()
                // releases it.
                Ok(RefPtr::into_raw(terminal))
            }
            Err(err) => Err(match err {
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
            }),
        }
    }

    /// Create a Terminal from Bun.spawn options (not from JS constructor)
    /// Returns the Terminal and its JS wrapper value
    /// The slave_fd should be used for the subprocess's stdin/stdout/stderr
    pub(crate) fn create_from_spawn(
        global_object: &JSGlobalObject,
        options: &Options,
    ) -> Result<CreateResult, InitError> {
        let (terminal, js_value) = Self::init_terminal(global_object, options, None)?;
        // `init_terminal` created the wrapper, which owns this ref as `m_ctx`.
        Ok(CreateResult {
            terminal: bun_ptr::BackRef::from(terminal.into_this_ptr()),
            js_value,
        })
    }

    /// Get the slave fd for subprocess to use
    #[allow(dead_code)]
    pub(crate) fn get_slave_fd(&self) -> Fd {
        self.slave_fd.get()
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
    /// `create_from_spawn` whose subprocess never started. Downgrades the
    /// JSRef so the wrapper is GC-eligible, marks `finalized` so
    /// `on_reader_done` skips the JS exit callback, and runs `close_internal`.
    pub(crate) fn abandon_from_spawn(&self) {
        self.this_value.with_mut(|v| v.downgrade());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.close_internal();
    }

    /// Windows: get the ConPTY handle to pass to uv_spawn via
    /// uv_process_options_t.pseudoconsole.
    #[cfg(windows)]
    pub(crate) fn get_pseudoconsole(&self) -> Option<windows::HPCON> {
        self.hpcon.get().as_ref().map(PseudoConsole::raw)
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
        let fd = self.slave_fd.get();
        if fd != Fd::INVALID {
            fd.close();
            self.slave_fd.set(Fd::INVALID);
        }
    }

    /// Drain buffered pty output, close our slave_fd, then drive the reader to
    /// EOF and unref both polls so the event loop can exit. BSD kernels flush
    /// the output queue on last slave close; holding ours until
    /// Subprocess::on_process_exit keeps a fast child's writes.
    /// `this: ThisPtr` because both reads below re-enter user JS and may
    /// release refs; a local guard keeps `this` live for the trailing field
    /// accesses.
    #[cfg(unix)]
    pub(crate) fn drain_and_close_slave_fd(this: ThisPtr<Self>) {
        let flags = this.flags.get();
        if flags.contains(Flags::CLOSED) {
            return;
        }
        let _guard = RefPtr::from_this(this);
        if flags.contains(Flags::READER_STARTED) && !flags.contains(Flags::READER_DONE) {
            // Single JS thread; re-entrant user JS (data callback may call
            // `terminal.close()`) is handled by `read`'s raw dispatch.
            IOReader::read_from(this);
            if this.flags.get().contains(Flags::CLOSED) {
                return;
            }
        }
        this.close_slave_fd();
        // Read again so the exit callback fires now (EOF on macOS, EIO on
        // Linux) instead of on the next tick when nothing may wake the loop.
        // A grandchild holding the slave keeps this at EAGAIN and re-arms.
        let flags = this.flags.get();
        if flags.contains(Flags::READER_STARTED) && !flags.contains(Flags::READER_DONE) {
            IOReader::read_from(this);
        }
        // An inline terminal whose child has exited no longer keeps the event
        // loop alive; the polls stay registered so grandchild output still
        // arrives while anything else keeps the loop running.
        if !this.flags.get().contains(Flags::CLOSED) {
            this.update_ref(false);
        }
    }

    /// The Windows writer's `deref`: release the ref its matching `ref_`
    /// parked in `pending_write_refs` (may be the last). Runs under a libuv
    /// callback, so an imbalance asserts in debug instead of unwinding.
    #[cfg(windows)]
    fn release_pending_write_ref(this: bun_ptr::ThisPtr<Self>) {
        let released = this.pending_write_refs.with_mut(|v| v.pop());
        debug_assert!(released.is_some(), "unbalanced writer deref");
        drop(released);
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
            let ctx = self.event_loop_handle.as_event_loop_ctx();
            self.writer.with_mut(|w| w.update_ref(ctx, false));
        }
    }

    /// Close this HPCON's ConDrv `\Reference` handle so conhost exits on its own
    /// once the last attached client disconnects: the output pipe then breaks
    /// and our reader observes EOF without `on_process_exit` having to tear
    /// ConPTY down (which races conhost's render thread on older builds and can
    /// drop the child's last write). Equivalent to kernel32's
    /// `ReleasePseudoConsole` (Windows 11 24H2+) / conpty.dll's
    /// `ConptyReleasePseudoConsole`; neither is exported from the inbox
    /// kernel32 on older builds so we reach into the struct directly. Further
    /// spawns against this pseudoconsole are impossible afterwards.
    #[cfg(windows)]
    pub(crate) fn release_pseudoconsole_reference(&self) {
        if let Some(hpcon) = self.hpcon.get() {
            hpcon.release_reference();
        }
    }

    /// On Windows < 11 24H2, ClosePseudoConsole blocks until the output pipe is
    /// drained. Our reader runs on the event-loop thread, so calling it there
    /// deadlocks. Fire from a detached thread so the event loop keeps draining;
    /// conhost completes its flush and our reader sees the final data then EOF.
    /// hpcon is passed to the thread by value so the Terminal struct may be freed
    /// before the thread completes.
    #[cfg(windows)]
    fn close_pseudoconsole_off_thread(&self, hpcon: PseudoConsole) {
        // PORTING.md bans std::process but not std::thread; a raw detached OS
        // thread is intentional here (no event-loop integration needed).
        // `ClosePseudoConsole` is safe to call from any thread per Win32 docs.
        match std::thread::Builder::new().spawn(move || hpcon.close()) {
            Ok(_t) => {
                // detached: JoinHandle dropped without join → thread runs to completion.
            }
            Err(_) => {
                // CreateThread failed — the process is in a bad state. Close the
                // reader so onReaderDone fires next loop tick (releasing the reader
                // ref) instead of hanging on an EOF that will never come. Leak hpcon;
                // calling ClosePseudoConsole here would deadlock since reader.close()
                // is async (uv_close) and the pipe HANDLE is still open. Conhost sees
                // broken-pipe once libuv's deferred close runs.
                let flags = self.flags.get();
                if flags.contains(Flags::READER_STARTED) && !flags.contains(Flags::READER_DONE) {
                    self.reader.with_mut(|r| r.close());
                }
            }
        }
    }
}

pub struct PtyResult {
    pub(crate) master: Fd,
    pub(crate) read_fd: Fd,
    pub(crate) write_fd: Fd,
    pub(crate) slave: Fd,
    #[cfg(windows)]
    pub(crate) hpcon: PseudoConsole,
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

pub use bun_core::Winsize;

#[cfg(unix)]
fn create_pty_posix(cols: u16, rows: u16) -> Result<PtyResult, CreatePtyError> {
    let winsize = Winsize {
        row: rows,
        col: cols,
        xpixel: 0,
        ypixel: 0,
    };

    // On Linux openpty is in libutil, which may not be linked; `sys::pty`
    // resolves it at runtime there.
    let sys::pty::PtyPair {
        master: master_fd_desc,
        slave: slave_fd_desc,
    } = match sys::pty::openpty(&winsize) {
        Ok(pair) => pair,
        Err(sys::pty::OpenPtyError::NotSupported) => return Err(CreatePtyError::NotSupported),
        Err(sys::pty::OpenPtyError::Failed) => return Err(CreatePtyError::OpenPtyFailed),
    };
    let slave_fd = slave_fd_desc.native();

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
            // libc termios on Linux encodes speed in c_cflag; use
            // cfsetispeed/cfsetospeed (the portable way to set both).
            sys::pty::cfsetspeed(&mut t, libc::B38400);

            let _ = sys::posix::tcsetattr(slave_fd, sys::posix::TCSA::Now, &t);
        }
        Err(err) => {
            // tcgetattr failed, log in debug builds but continue without modifying termios
            sys::syslog!("tcgetattr(slave_fd={}) failed: {:?}", slave_fd, err,);
        }
    }

    // Duplicate the master fd for reading and writing separately
    // This allows independent epoll registration and closing
    let read_fd = match sys::dup(master_fd_desc) {
        sys::Result::Ok(fd) => fd,
        sys::Result::Err(_) => {
            master_fd_desc.close();
            slave_fd_desc.close();
            return Err(CreatePtyError::DupFailed);
        }
    };

    let write_fd = match sys::dup(master_fd_desc) {
        sys::Result::Ok(fd) => fd,
        sys::Result::Err(_) => {
            master_fd_desc.close();
            slave_fd_desc.close();
            read_fd.close();
            return Err(CreatePtyError::DupFailed);
        }
    };

    // Set non-blocking on master side fds (for async I/O in the event loop)
    let _ = sys::update_nonblocking(master_fd_desc, true);
    let _ = sys::update_nonblocking(read_fd, true);
    let _ = sys::update_nonblocking(write_fd, true);
    // Note: slave_fd stays blocking - child processes expect blocking I/O

    // Set close-on-exec on master side fds only
    // slave_fd should NOT have close-on-exec since child needs to inherit it
    let _ = crate::api::bun_process::spawn_sys::set_close_on_exec(master_fd_desc);
    let _ = crate::api::bun_process::spawn_sys::set_close_on_exec(read_fd);
    let _ = crate::api::bun_process::spawn_sys::set_close_on_exec(write_fd);

    Ok(PtyResult {
        master: master_fd_desc,
        read_fd,
        write_fd,
        slave: slave_fd_desc,
    })
}

#[cfg(windows)]
fn create_pty_windows(cols: u16, rows: u16) -> Result<PtyResult, CreatePtyError> {
    // Server (overlapped) pipe ends come back as libuv-owned FDs so they can
    // be passed to BufferedReader/StreamingWriter.start() (uv_pipe_open).
    let sys::pty::ConPty {
        read_fd,
        write_fd,
        hpcon,
    } = sys::pty::create_conpty(cols, rows).map_err(|e| match e {
        sys::pty::CreatePtyError::OpenPtyFailed => CreatePtyError::OpenPtyFailed,
        sys::pty::CreatePtyError::DupFailed => CreatePtyError::DupFailed,
    })?;
    Ok(PtyResult {
        master: Fd::INVALID,
        read_fd,
        write_fd,
        slave: Fd::INVALID,
        hpcon,
    })
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
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_closed(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(self.flags.get().contains(Flags::CLOSED))
    }

    fn get_termios_flag<const FIELD: TermiosField>(&self) -> JSValue {
        #[cfg(not(unix))]
        {
            return JSValue::js_number(0.0);
        }
        #[cfg(unix)]
        {
            if self.flags.get().contains(Flags::CLOSED) || self.master_fd.get() == Fd::INVALID {
                return JSValue::js_number(0.0);
            }
            let Some(termios_data) = get_termios(self.master_fd.get()) else {
                return JSValue::js_number(0.0);
            };
            let raw: u64 = match FIELD {
                TermiosField::Iflag => termios_data.c_iflag as u64,
                TermiosField::Oflag => termios_data.c_oflag as u64,
                TermiosField::Lflag => termios_data.c_lflag as u64,
                TermiosField::Cflag => termios_data.c_cflag as u64,
            };
            JSValue::js_number(raw as f64)
        }
    }

    fn set_termios_flag<const FIELD: TermiosField>(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        #[cfg(not(unix))]
        {
            let _ = (global_object, value);
            return Ok(());
        }
        #[cfg(unix)]
        {
            if self.flags.get().contains(Flags::CLOSED) || self.master_fd.get() == Fd::INVALID {
                return Ok(());
            }
            let num = value.coerce_f64(global_object)?;
            let Some(mut termios_data) = get_termios(self.master_fd.get()) else {
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
            let _ = set_termios(self.master_fd.get(), &termios_data);
            Ok(())
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_input_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Iflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_input_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Iflag }>(global_object, value)?;
        Ok(true)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_output_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Oflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_output_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Oflag }>(global_object, value)?;
        Ok(true)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_local_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Lflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_local_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Lflag }>(global_object, value)?;
        Ok(true)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_control_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Cflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_control_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Cflag }>(global_object, value)?;
        Ok(true)
    }

    /// Write data to the terminal
    #[bun_jsc::host_fn(method)]
    pub(crate) fn write(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Err(global_object.throw(format_args!("Terminal is closed")));
        }

        let args = callframe.arguments_as_array::<1>();
        let data = args[0];

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
            return Ok(JSValue::js_number(0.0));
        }

        // Suppress drain firing from the synchronous on_write calls that
        // StreamingWriter::write() makes while we still hold the `with_mut`
        // borrow; it is restored from `has_pending_data()` immediately after.
        let had_buffered = self.writer_has_buffered.replace(false);
        let (write_result, has_pending) = self.writer.with_mut(|w| {
            let r = w.write(bytes);
            (r, w.has_pending_data())
        });
        self.writer_has_buffered.set(has_pending);
        if has_pending {
            // Keep the wrapper rooted for the pending drain dispatch; a write
            // after PTY EOF finds it already downgraded.
            self.this_value.with_mut(|v| v.upgrade(global_object));
        }
        // A second write() can drain what an earlier one buffered; on_write saw
        // the cleared flag, so fire drain here (outside `with_mut`).
        #[cfg(unix)]
        if had_buffered && !has_pending {
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
            _ => Ok(JSValue::js_number(input_len as f64)),
        }
    }

    /// Resize the terminal
    #[bun_jsc::host_fn(method)]
    pub(crate) fn resize(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Err(global_object.throw(format_args!("Terminal is closed")));
        }

        let args = callframe.arguments_as_array::<2>();

        let new_cols: u16 = 'blk: {
            if args[0].is_number() {
                let n = args[0].to_int32();
                if n > 0 && n <= 65535 {
                    break 'blk u16::try_from(n).expect("int cast");
                }
            }
            return Err(global_object.throw(format_args!("resize() requires valid cols argument")));
        };

        let new_rows: u16 = 'blk: {
            if args[1].is_number() {
                let n = args[1].to_int32();
                if n > 0 && n <= 65535 {
                    break 'blk u16::try_from(n).expect("int cast");
                }
            }
            return Err(global_object.throw(format_args!("resize() requires valid rows argument")));
        };

        #[cfg(unix)]
        {
            let winsize = bun_core::Winsize {
                row: new_rows,
                col: new_cols,
                xpixel: 0,
                ypixel: 0,
            };

            if sys::pty::set_winsize(self.master_fd.get(), &winsize).is_err() {
                return Err(global_object.throw(format_args!("Failed to resize terminal")));
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
                let hr = hpcon.resize(new_cols, new_rows);
                if hr < 0 && hr != HR_NO_DATA && hr != HR_BROKEN_PIPE {
                    return Err(global_object.throw(format_args!("Failed to resize terminal")));
                }
            }
        }

        self.cols.set(if cfg!(windows) {
            u16::try_from(sys::pty::clamp_to_coord(new_cols)).expect("int cast")
        } else {
            new_cols
        });
        self.rows.set(if cfg!(windows) {
            u16::try_from(sys::pty::clamp_to_coord(new_rows)).expect("int cast")
        } else {
            new_rows
        });

        Ok(JSValue::UNDEFINED)
    }

    /// Set raw mode on the terminal
    #[bun_jsc::host_fn(method)]
    pub(crate) fn set_raw_mode(
        &self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Err(global_object.throw(format_args!("Terminal is closed")));
        }

        let args = callframe.arguments_as_array::<1>();
        let enabled = args[0].to_boolean();

        #[cfg(unix)]
        {
            // Use the existing TTY mode function
            let mut state = self.tty_state.get();
            let tty_result = state.set_mode(
                self.master_fd.get().native(),
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
                return Err(global_object.throw(format_args!("Failed to set raw mode")));
            }
        }

        self.update_flags(|f| f.set(Flags::RAW_MODE, enabled));
        Ok(JSValue::UNDEFINED)
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
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.update_ref(true);
        Ok(JSValue::UNDEFINED)
    }

    /// Unreference the terminal
    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.update_ref(false);
        Ok(JSValue::UNDEFINED)
    }

    fn update_ref(&self, add: bool) {
        // POSIX `update_ref` takes `&self`; Windows takes `&mut self` — route
        // both through `with_mut` so the body is target-agnostic.
        self.reader.with_mut(|r| r.update_ref(add));
        let ctx = self.event_loop_handle.as_event_loop_ctx();
        self.writer.with_mut(|w| w.update_ref(ctx, add));
    }

    /// Close the terminal
    #[bun_jsc::host_fn(method)]
    pub(crate) fn close(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.close_internal();
        Ok(JSValue::UNDEFINED)
    }

    /// Async dispose for "using" syntax
    #[bun_jsc::host_fn(method)]
    pub(crate) fn async_dispose(
        &self,
        global_object: &JSGlobalObject,
        _f: &CallFrame,
    ) -> JsResult<JSValue> {
        // After dispose the caller must not see further data/exit callbacks.
        // closeInternal on Windows leaves the reader draining off-thread, so
        // suppress callbacks and downgrade the JSRef so the wrapper is
        // GC-eligible once the caller's reference is dropped.
        self.this_value.with_mut(|v| v.downgrade());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.close_internal();
        Ok(jsc::JSPromise::resolved_promise_value(
            global_object,
            JSValue::UNDEFINED,
        ))
    }

    fn close_internal(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::CLOSED));

        // Close writer (closes write_fd). R-2: `with_mut` borrow is held across
        // the synchronous `on_writer_close` parent callback, but that callback
        // touches only sibling `Cell`/`JsCell` fields, never `writer`.
        self.writer.with_mut(|w| w.close());
        self.write_fd.set(Fd::INVALID);

        #[cfg(windows)]
        {
            // Dispatch ClosePseudoConsole off-thread (it blocks until the output
            // pipe is drained on Windows < 11 24H2) and leave the reader open so
            // the event loop can keep draining; conhost flushes the final frame,
            // closes its pipe end, and the reader observes EOF → onReaderDone.
            if let Some(hpcon) = self.hpcon.replace(None) {
                self.close_pseudoconsole_off_thread(hpcon);
            }
            // Leave the reader open; onReaderDone closes it on EOF.
            let flags = self.flags.get();
            if flags.contains(Flags::READER_STARTED) && !flags.contains(Flags::READER_DONE) {
                return;
            }
        }

        // Close reader (closes read_fd)
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.reader.with_mut(|r| r.close());
        }
        self.read_fd.set(Fd::INVALID);

        // Close master fd
        let master = self.master_fd.get();
        if master != Fd::INVALID {
            master.close();
            self.master_fd.set(Fd::INVALID);
        }

        // Close slave fd
        let slave = self.slave_fd.get();
        if slave != Fd::INVALID {
            slave.close();
            self.slave_fd.set(Fd::INVALID);
        }
    }

    // IOWriter callbacks
    fn on_writer_close(this: ThisPtr<Self>) {
        bun_output::scoped_log!(Terminal, "onWriterClose");
        if !this.flags.get().contains(Flags::WRITER_DONE) {
            this.update_flags(|f| f.insert(Flags::WRITER_DONE));
            // Must run before the deref below, which may free `this`.
            this.maybe_downgrade_after_eof();
            // Release writer's ref
            drop(this.writer_ref.take());
        }
    }

    #[allow(clippy::needless_pass_by_value)] // signature fixed by `impl_streaming_writer_parent!`
    fn on_writer_error(this: ThisPtr<Self>, err: sys::Error) {
        this.on_writer_error_ref(&err);
    }

    fn on_write_this(this: ThisPtr<Self>, amount: usize, status: WriteStatus) {
        this.on_write(amount, status);
    }

    fn on_writer_ready_this(this: ThisPtr<Self>) {
        this.on_writer_ready();
    }

    fn on_writer_ready(&self) {
        bun_output::scoped_log!(Terminal, "onWriterReady");
        // Call drain callback
        if let Some(this_jsvalue) = self.this_value.get().try_get() {
            if let Some(callback) = js::gc::get(js::GcValue::Drain, this_jsvalue) {
                let global_this = self.global();
                global_this.bun_vm().event_loop_mut().run_callback(
                    callback,
                    global_this,
                    this_jsvalue,
                    &[this_jsvalue],
                );
            }
        }
        self.maybe_downgrade_after_eof();
    }

    fn on_writer_error_ref(&self, err: &sys::Error) {
        bun_output::scoped_log!(Terminal, "onWriterError: {:?}", err);
        // On write error, close the terminal to prevent further operations
        // This handles cases like broken pipe when the child process exits
        if !self.flags.get().contains(Flags::CLOSED) {
            self.close_internal();
        }
    }

    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(Terminal, "onWrite: {} bytes", amount);
        let _ = amount;
        // POSIX: `PosixStreamingWriter` never dispatches `on_ready`; detect the
        // buffered→drained transition here instead. Windows fires the drain
        // callback from `on_writable`, so only record the drained state (a
        // stale flag would block `maybe_downgrade_after_eof` forever).
        #[cfg(unix)]
        if status == WriteStatus::Drained && self.writer_has_buffered.replace(false) {
            self.on_writer_ready();
        }
        #[cfg(not(unix))]
        if matches!(status, WriteStatus::Drained | WriteStatus::EndOfFile) {
            self.writer_has_buffered.set(false);
        }
    }

    // IOReader callbacks
    fn on_reader_done(this: ThisPtr<Self>) {
        bun_output::scoped_log!(Terminal, "onReaderDone");
        // exit_code 0 = clean EOF on PTY stream (not subprocess exit code)
        Self::on_reader_finished(this, 0);
    }

    fn on_reader_error(this: ThisPtr<Self>, err: &sys::Error) {
        bun_output::scoped_log!(Terminal, "onReaderError: {:?}", err);
        // exit_code 1 = I/O error on PTY stream (not subprocess exit code)
        Self::on_reader_finished(this, 1);
    }

    /// Shared tail of `on_reader_done`/`on_reader_error`: claim `READER_DONE`
    /// before the exit callback so re-entry (`terminal.close()` from the
    /// callback) sees the flag and no-ops, then release the reader's ref
    /// (which may free `this`).
    fn on_reader_finished(this: ThisPtr<Self>, exit_code: i32) {
        if this.flags.get().contains(Flags::READER_DONE) {
            return;
        }
        this.update_flags(|f| {
            f.insert(Flags::READER_DONE);
            f.remove(Flags::CONNECTED);
        });
        // EOF from master - downgrade to weak ref to allow GC.
        // Skip JS interactions if already finalized (happens when close() is called during finalize)
        if !this.flags.get().contains(Flags::FINALIZED) {
            this.maybe_downgrade_after_eof();
            this.call_exit_callback(exit_code, None);
        }
        drop(this.reader_ref.take());
    }

    /// Downgrade `this_value` once no further callback can fire: reader hit
    /// EOF *and* the writer has no buffered data awaiting a `drain` dispatch.
    /// The wrapper's cached callback slots are the only GC root of the
    /// callbacks, so downgrading with a drain still pending lets GC collect
    /// the wrapper before `on_writer_ready` dispatches through it.
    ///
    /// Reads only `Cell` fields, never `self.writer`: callers include
    /// writer-parent callbacks that run while a writer borrow is live.
    fn maybe_downgrade_after_eof(&self) {
        let flags = self.flags.get();
        if !flags.contains(Flags::READER_DONE) || flags.contains(Flags::FINALIZED) {
            return;
        }
        if !flags.contains(Flags::WRITER_DONE) && self.writer_has_buffered.get() {
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
        let Some(callback) = js::gc::get(js::GcValue::Exit, this_jsvalue) else {
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

        global_this.bun_vm().event_loop_mut().run_callback(
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
    // Returns true to continue reading, false to pause
    fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        let _ = has_more;
        bun_output::scoped_log!(Terminal, "onReadChunk: {} bytes", chunk.len());

        if self.flags.get().contains(Flags::FINALIZED) {
            return true;
        }

        // First data received - upgrade to strong ref (connected)
        if !self.flags.get().contains(Flags::CONNECTED) {
            self.update_flags(|f| f.insert(Flags::CONNECTED));
            let global = self.global();
            self.this_value.with_mut(|v| v.upgrade(global));
        }

        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return true;
        };
        let Some(callback) = js::gc::get(js::GcValue::Data, this_jsvalue) else {
            return true;
        };

        let global_this = self.global();
        // Use try_reserve so a transient OOM on a large chunk doesn't abort
        // the process — log and `return true` to keep reading instead.
        let mut v: Vec<u8> = Vec::new();
        if v.try_reserve_exact(chunk.len()).is_err() {
            bun_output::scoped_log!(
                Terminal,
                "onReadChunk: dupe failed (OOM), dropping {} bytes",
                chunk.len()
            );
            return true;
        }
        v.extend_from_slice(chunk);
        // MarkedArrayBuffer::from_bytes takes a `&mut [u8]` it will own (freed
        // via mimalloc on the C++ side) — leak the Box and hand over the slice.
        let bytes: &'static mut [u8] = Box::leak(v.into_boxed_slice());
        // This is the pipe reader's landing frame: a buffer that cannot be
        // built (allocation failure, a terminating VM) is folded here and
        // reading goes on.
        let data = match MarkedArrayBuffer::from_bytes(bytes, jsc::JSType::Uint8Array)
            .to_node_buffer(global_this)
        {
            Ok(data) => data,
            Err(err) => {
                crate::dispatch::fold(Err(err));
                return true;
            }
        };

        // Each chunk's `data` callback is its own top-level call: reported and
        // reading continues, as a stream 'data' listener that throws does.
        global_this.bun_vm().event_loop_mut().run_callback(
            callback,
            global_this,
            this_jsvalue,
            &[this_jsvalue, data],
        );

        true // Continue reading
    }

    fn loop_(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.event_loop_handle.uv_loop()
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop().cast()
        }
    }

    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(Terminal, "finalize");
        jsc::mark_binding();
        self.this_value.with_mut(|v| v.finalize());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.close_internal();
    }
}

/// Runs when the last ref is released (JS finalize, reader done, writer
/// close), before the allocation is freed.
impl Drop for Terminal {
    fn drop(&mut self) {
        bun_output::scoped_log!(Terminal, "deinit");
        // Set reader/writer done flags to prevent extra deref calls in closeInternal
        self.update_flags(|f| f.insert(Flags::READER_DONE | Flags::WRITER_DONE));
        // Close all FDs if not already closed (handles constructor error paths)
        // closeInternal() checks flags.closed and returns early on subsequent calls,
        // so this is safe even if finalize() already called it
        self.close_internal();
    }
}

// BufferedReader vtable parent: Terminal declares
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop`.
bun_io::impl_buffered_reader_parent! {
    Terminal for Terminal;
    borrow = this;
    reader = reader;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| this.on_read_chunk(&chunk, has_more);
    on_reader_done  = |this| Terminal::on_reader_done(this);
    on_reader_error = |this, err| Terminal::on_reader_error(this, &err);
    // Delegate to the inherent `Terminal::loop_()` which is cfg-split: on
    // Windows it projects `.uv_loop()` (the `*mut uv_loop_t` field of
    // `WindowsLoop`), NOT a raw cast of the `bun_uws::Loop` wrapper.
    loop_           = |this| this.loop_().cast();
    event_loop      = |this| this.event_loop_handle.as_event_loop_ctx();
}

// `bun.io.StreamingWriter(@This(), struct { onClose, onWritable, onError, onWrite })`
// → the writer-parent trait impls. `borrow = this`: the writer is an
// intrusive *field of* the parent and `on_close` may release the last ref, so
// the callbacks get `ThisPtr<Terminal>` rather than a receiver.
bun_io::impl_streaming_writer_parent! {
    Terminal;
    poll_tag   = bun_io::posix_event_loop::poll_tag::TERMINAL_POLL,
    borrow     = this,
    on_write   = on_write_this,
    on_error   = on_writer_error,
    on_ready   = on_writer_ready_this,
    on_close   = on_writer_close,
    event_loop = |this| this.event_loop_handle.as_event_loop_ctx(),
    uws_loop   = |this| this.event_loop_handle.r#loop(),
    uv_loop    = |this| this.event_loop_handle.uv_loop(),
    // Called from inside writer methods while a `&mut self.writer` borrow is
    // live: touch only the `pending_write_refs` cell.
    ref_       = |this| this.pending_write_refs.with_mut(|v| v.push(RefPtr::from_this(this))),
    deref      = |this| Terminal::release_pending_write_ref(this),
}
