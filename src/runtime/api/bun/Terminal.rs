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
use core::ffi::{c_int, c_ulong, c_void};
use core::sync::atomic::{AtomicU32, Ordering};

use crate::node::StringOrBuffer;
use crate::webcore::blob::ZigStringBlobExt;
use bun_core::SignalCode;
use bun_core::ZigString;
use bun_io::Loop as AsyncLoop;
use bun_io::pipe_reader::{BufferedReaderParent, PosixFlags};
use bun_io::{BufferedReader, ReadState, StreamingWriter, WriteStatus};
use bun_jsc::{
    self as jsc, CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
    MarkedArrayBuffer, SysErrorJsc, ZigStringSlice,
};
use bun_sys::{self as sys, Fd, FdExt};

#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
#[cfg(windows)]
use bun_sys::windows;

bun_output::declare_scope!(Terminal, hidden);

// Generated bindings — `jsc.Codegen.JSTerminal`. The `.classes.ts` codegen
// emits `crate::generated_classes::js_Terminal` with `from_js`/`to_js` and the
// cached-value accessors; re-export here so callers continue to spell `js::*`
// (matching Zig's `js.toJS`/`js.gc.set(.data, …)`).
pub use self::js::{from_js, from_js_direct, to_js};
pub mod js {
    pub use crate::generated_classes::js_Terminal::{
        data_get_cached, data_set_cached, drain_get_cached, drain_set_cached, exit_get_cached,
        exit_set_cached, from_js, from_js_direct, get_constructor, to_js,
    };

    /// Zig: `js.gc` — typed accessor for the `values:` slots.
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
        pub fn set(which: GcValue, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
            match which {
                GcValue::Data => super::data_set_cached(this_value, global, value),
                GcValue::Exit => super::exit_set_cached(this_value, global, value),
                GcValue::Drain => super::drain_set_cached(this_value, global, value),
            }
        }
    }
    pub use gc::GcValue;
}

/// Reference counting for Terminal.
/// Refs are held by:
/// 1. JS side (released in finalize)
/// 2. Reader (released in onReaderDone/onReaderError)
/// 3. Writer (released in onWriterClose)
///
// `bun.ptr.RefCount` is intrusive single-thread → `bun_ptr::IntrusiveRc<Terminal>`.
// Never `Rc`/`Arc` here: `*mut Terminal` crosses FFI as the `.classes.ts` m_ctx
// payload and is recovered by raw pointer in finalize/host fns. (LIFETIMES.tsv
// marks CreateResult.terminal as SHARED, but the RefCount→IntrusiveRc rule wins;
// the TSV row is for plain `*T` fields, not intrusive mixins.)
//
// `no_construct, no_finalize`: this class uses `constructNeedsThis: true` (3-arg
// constructor) and intrusive refcounting (finalize → deref, not heap::take),
// neither of which the macro's default hooks support. The C-ABI shims live in
// `mod js` above and `extern "C" fn finalize` below.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut Terminal` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. The
// BufferedReader/StreamingWriter parent-vtable thunks deref `*mut Self` as
// `&*this` (shared); all field mutation routes through the cells.
#[bun_jsc::JsClass(no_construct, no_finalize)]
#[derive(bun_ptr::RefCounted)]
#[ref_count(destroy = deinit_and_destroy)]
pub struct Terminal {
    ref_count: bun_ptr::RefCount<Terminal>,

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
    hpcon: Cell<Option<windows::HPCON>>,
    #[cfg(not(windows))]
    hpcon: (),

    /// Current terminal size
    cols: Cell<u16>,
    rows: Cell<u16>,

    /// Terminal name (e.g., "xterm-256color"). Read-only after construction.
    term_name: ZigStringSlice,

    /// Event loop handle for callbacks. Read-only after construction.
    event_loop_handle: EventLoopHandle,

    /// Global object reference. Read-only after construction.
    // PORT NOTE: LIFETIMES.tsv says JSC_BORROW → `&JSGlobalObject`, but Terminal
    // is a heap-allocated `.classes.ts` m_ctx payload and cannot carry a lifetime
    // param. Stored as a `BackRef`; deref via `self.global()`.
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
        /// Set when an inline-created terminal has been attached to a subprocess
        /// via spawn; prevents reusing the same inline terminal for a second
        /// spawn (which on Windows would be silently killed by ClosePseudoConsole
        /// when the first subprocess exits, and on POSIX has no slave_fd left).
        const INLINE_SPAWNED = 1 << 7;
    }
}

/// `bun.io.StreamingWriter(@This(), struct { onClose, onWritable, onError, onWrite })`
/// — the anon-struct of callback decls is the `PosixStreamingWriterParent` /
/// `WindowsStreamingWriterParent` trait impls at the bottom of this file.
pub type IOWriter = StreamingWriter<Terminal>;

/// Poll type alias for FilePoll Owner registration
pub type Poll = IOWriter;

pub type IOReader = BufferedReader;

/// Options for creating a Terminal
pub struct Options {
    pub cols: u16,
    pub rows: u16,
    pub term_name: ZigStringSlice,
    pub data_callback: Option<JSValue>,
    pub exit_callback: Option<JSValue>,
    pub drain_callback: Option<JSValue>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            cols: 80,
            rows: 24,
            term_name: ZigStringSlice::default(),
            data_callback: None,
            exit_callback: None,
            drain_callback: None,
        }
    }
}

// Local extension shims for `JSValue.getOptional` (Terminal.zig). Typed
// `getOptional` is not yet a single inherent generic on `bun_jsc::JSValue`;
// these wrap `get` + the per-type coercion. `withAsyncContextIfNeeded` is the
// inherent `JSValue::with_async_context_if_needed` in `bun_jsc` — call sites
// resolve to that directly, no shim here.
trait JSValueTerminalExt {
    fn get_optional_i32(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<i32>>;
    fn get_optional_slice(
        self,
        global: &JSGlobalObject,
        name: &[u8],
    ) -> JsResult<Option<ZigStringSlice>>;
    fn get_optional_value(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<JSValue>>;
}
impl JSValueTerminalExt for JSValue {
    fn get_optional_i32(self, global: &JSGlobalObject, name: &[u8]) -> JsResult<Option<i32>> {
        match self.get(global, name)? {
            Some(v) if !v.is_undefined_or_null() => Ok(Some(v.coerce::<i32>(global)?)),
            _ => Ok(None),
        }
    }
    fn get_optional_slice(
        self,
        global: &JSGlobalObject,
        name: &[u8],
    ) -> JsResult<Option<ZigStringSlice>> {
        match self.get(global, name)? {
            Some(v) if !v.is_undefined_or_null() => Ok(Some(v.to_slice(global)?)),
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
    pub const MAX_TERM_NAME_LEN: usize = 128;

    /// Parse terminal options from a JS object
    pub fn parse_from_js(global_object: &JSGlobalObject, js_options: JSValue) -> JsResult<Options> {
        let mut options = Options::default();
        // errdefer options.deinit() — handled by Drop on early return.

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

        if let Some(slice) = js_options.get_optional_slice(global_object, b"name")? {
            if slice.slice().len() > Self::MAX_TERM_NAME_LEN {
                drop(slice);
                return Err(global_object.throw(format_args!(
                    "Terminal name too long (max {} characters)",
                    Self::MAX_TERM_NAME_LEN
                )));
            }
            options.term_name = slice;
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

impl Drop for Options {
    fn drop(&mut self) {
        // term_name: ZigString::Slice has its own Drop; reset to default afterward
        // matches Zig `this.* = .{}` but is unnecessary in Rust.
    }
}

/// Result from creating a Terminal
pub struct CreateResult {
    // Intrusive single-thread refcount that crosses FFI as `*mut Terminal`; see
    // ref_count comment on `Terminal` for why this is not `Arc`.
    pub terminal: bun_ptr::IntrusiveRc<Terminal>,
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

impl From<InitError> for bun_core::Error {
    fn from(e: InitError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
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

    /// `self`'s address as `*mut Self` for intrusive backref / refcount slots.
    /// Callers deref it as `&*const` (shared) — see the `BufferedReaderParent`
    /// / `*StreamingWriterParent` thunks below — so no write provenance is
    /// required; the `*mut` spelling is purely to match the C-shaped vtable
    /// signatures. All field mutation routes through `Cell`/`JsCell`.
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    /// Recover `&Terminal` from the parent back-pointer stashed via
    /// [`as_ctx_ptr`](Self::as_ctx_ptr) in `init_terminal` (handed to
    /// `reader.set_parent` / `writer.parent`). Centralises the set-once
    /// `*mut Self → &Self` deref so the I/O-vtable trampolines below stay
    /// safe at the call site (one `unsafe` here, N safe callers).
    ///
    /// Only valid for the `BufferedReaderParent` /
    /// `{Posix,Windows}StreamingWriterParent` thunks where `this` is the
    /// registered BACKREF — do NOT call from `WindowsWriterParent::ref_` /
    /// `deref` (those run while a `&mut self.writer` borrow is live and must
    /// avoid forming `&Terminal`; see Stacked-Borrows note there).
    #[inline]
    fn from_parent_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: `this` is the BACKREF set via `reader.set_parent` /
        // `writer.parent = …` in `init_terminal`. The Terminal is heap-stable
        // (`heap::into_raw`) and outlives every reader/writer callback (the
        // intrusive +1 ref held by the I/O machinery is dropped only after the
        // last callback fires). R-2: shared borrow only — bodies take `&self`;
        // field writes go through `Cell`/`JsCell`, so re-entrant JS forming a
        // fresh `&Self` from `m_ctx` aliases soundly.
        unsafe { &*this }
    }

    // ─────────────────────────────────────────────────────────────────────────

    pub fn ref_(&self) {
        // SAFETY: `self` derived from a heap-allocated allocation; intrusive
        // refcount mixin only reads/writes the `ref_count` field via shared
        // access (Cell), so the &T→*mut cast is sound for `ref_` (no &mut
        // materialized).
        unsafe { bun_ptr::RefCount::<Terminal>::ref_(self.as_ctx_ptr()) };
    }

    pub fn deref_(&self) {
        // SAFETY: `self` derived from a heap-allocated allocation; the RefCount
        // mixin's `deref` reads/writes `ref_count` via Cell and runs
        // `destructor()` (→ deinit_and_destroy) iff the count hits zero.
        // Callers must treat `self` as potentially-freed on return (always
        // tail-position in this file).
        unsafe { bun_ptr::RefCount::<Terminal>::deref(self.as_ctx_ptr()) };
    }

    /// Internal initialization - shared by constructor and createFromSpawn
    fn init_terminal(
        global_object: &JSGlobalObject,
        // term_name ownership is transferred to the Terminal struct on success or
        // any error after createPty; cleared in-place once moved.
        options: &mut Options,
        // If provided, use this JSValue; otherwise create one via toJS
        existing_js_value: Option<JSValue>,
    ) -> Result<CreateResult, InitError> {
        // Create PTY
        let pty_result = create_pty(options.cols, options.rows)?;

        // Use default term name if empty
        let term_name = if !options.term_name.slice().is_empty() {
            core::mem::take(&mut options.term_name)
        } else {
            ZigStringSlice::from_utf8_never_free(b"xterm-256color")
        };
        // Ownership moves to the struct below; clear so caller's options drop
        // doesn't double-free on the WriterStartFailed/ReaderStartFailed paths.
        options.term_name = ZigStringSlice::default();

        // `bun.new(Terminal, .{...})` → heap::alloc; the intrusive ref_count
        // field starts at 1 (JS side's ref). Wrapped as IntrusiveRc on success.
        let terminal: *mut Terminal = bun_core::heap::into_raw(Box::new(Terminal {
            ref_count: bun_ptr::RefCount::init(),
            master_fd: Cell::new(pty_result.master),
            read_fd: Cell::new(pty_result.read_fd),
            write_fd: Cell::new(pty_result.write_fd),
            slave_fd: Cell::new(pty_result.slave),
            #[cfg(windows)]
            hpcon: Cell::new(Some(pty_result.hpcon)),
            #[cfg(not(windows))]
            hpcon: (),
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
            term_name,
            // SAFETY: bun_vm() returns the live VM raw pointer for this global.
            event_loop_handle: EventLoopHandle::init(
                global_object.bun_vm().as_mut().event_loop().cast(),
            ),
            global_this: bun_ptr::BackRef::new(global_object),
            writer: JsCell::new(IOWriter::default()),
            reader: JsCell::new(IOReader::init::<Terminal>()),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::empty()),
        }));
        // SAFETY: just allocated, non-null, exclusively owned here. R-2: `&`
        // (not `&mut`) — every method below takes `&self`; field writes go
        // through `Cell`/`JsCell`.
        let terminal = unsafe { &*terminal };

        // Set reader parent
        let parent_ptr = terminal.as_ctx_ptr();
        terminal
            .reader
            .with_mut(|r| r.set_parent(parent_ptr.cast::<c_void>()));

        // Set writer parent
        terminal.writer.with_mut(|w| w.parent = parent_ptr);

        // Start writer with the write fd - adds a ref
        match terminal
            .writer
            .with_mut(|w| w.start(pty_result.write_fd, true))
        {
            sys::Result::Ok(()) => terminal.ref_(),
            sys::Result::Err(_) => {
                // POSIX: writer.start() may have allocated a poll holding write_fd
                // before registerWithFd failed; closeInternal → writer.close()
                // frees the poll and closes write_fd. Windows: writer.start()
                // failure leaves source==null so writer.close() is a no-op; close
                // write_fd directly. Pre-set writer_done so onWriterClose's deref
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
                terminal.deref_();
                return Err(InitError::WriterStartFailed);
            }
        }

        // Start reader with the read fd - adds a ref
        match terminal
            .reader
            .with_mut(|r| r.start(pty_result.read_fd, true))
        {
            sys::Result::Err(_) => {
                // Reader never started: closeInternal skips reader.close() but
                // runs writer.close() → onWriterClose → deref (2→1). Then drop
                // the initial ref (1→0).
                terminal.read_fd.get().close();
                terminal.read_fd.set(Fd::INVALID);
                terminal.close_internal();
                terminal.deref_();
                return Err(InitError::ReaderStartFailed);
            }
            sys::Result::Ok(()) => {
                terminal.ref_();
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

        // Start reading data
        terminal.reader.with_mut(|r| r.read());

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

        Ok(CreateResult {
            // SAFETY: `parent_ptr` is the heap-allocated allocation above with
            // ref_count >= 1; IntrusiveRc::from_raw adopts one existing ref.
            terminal: unsafe { bun_ptr::IntrusiveRc::from_raw(parent_ptr) },
            js_value: this_value,
        })
    }

    /// Constructor for Terminal - called from JavaScript
    /// With constructNeedsThis: true, we receive the JSValue wrapper directly.
    /// Thunk emitted by `.classes.ts` codegen (`TerminalClass__construct` in
    /// `generated_classes.rs`); the `JsClass(no_construct)` attribute suppresses
    /// the macro's 2-arg default.
    pub fn constructor(
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

        let mut options = Options::parse_from_js(global_object, js_options)?;

        match Self::init_terminal(global_object, &mut options, Some(this_value)) {
            Ok(result) => {
                // Hand the intrusive ref to the JS wrapper as m_ctx; finalize()
                // releases it via deref_().
                Ok(bun_ptr::IntrusiveRc::into_raw(result.terminal))
            }
            Err(err) => {
                drop(options);
                Err(match err {
                    InitError::OpenPtyFailed => {
                        global_object.throw(format_args!("Failed to open PTY"))
                    }
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
                })
            }
        }
    }

    /// Create a Terminal from Bun.spawn options (not from JS constructor)
    /// Returns the Terminal and its JS wrapper value
    /// The slave_fd should be used for the subprocess's stdin/stdout/stderr
    pub fn create_from_spawn(
        global_object: &JSGlobalObject,
        options: &mut Options,
    ) -> Result<CreateResult, InitError> {
        Self::init_terminal(global_object, options, None)
    }

    /// Get the slave fd for subprocess to use
    pub fn get_slave_fd(&self) -> Fd {
        self.slave_fd.get()
    }

    /// `flags.closed` — read by `Bun.spawn` arg validation.
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.flags.get().contains(Flags::CLOSED)
    }

    /// `flags.inline_spawned` — read by `Bun.spawn` to reject reuse of an
    /// inline-created terminal.
    #[inline]
    pub fn is_inline_spawned(&self) -> bool {
        self.flags.get().contains(Flags::INLINE_SPAWNED)
    }

    /// Spawn-side error-path teardown for a terminal created via
    /// `create_from_spawn` whose subprocess never started. Downgrades the
    /// JSRef so the wrapper is GC-eligible, marks `finalized` so
    /// `on_reader_done` skips the JS exit callback, and runs `close_internal`.
    /// Mirrors the `defer { terminal_info.? }` block in
    /// `js_bun_spawn_bindings.zig`.
    pub fn abandon_from_spawn(&self) {
        self.this_value.with_mut(|v| v.downgrade());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.close_internal();
    }

    /// Windows: get the ConPTY handle to pass to uv_spawn via
    /// uv_process_options_t.pseudoconsole.
    #[cfg(windows)]
    pub fn get_pseudoconsole(&self) -> Option<windows::HPCON> {
        self.hpcon.get()
    }
    #[cfg(not(windows))]
    pub fn get_pseudoconsole(&self) -> Option<*mut c_void> {
        None
    }

    /// Close the parent's copy of slave_fd after fork
    /// The child process has its own copy - closing the parent's ensures
    /// EOF is received on the master side when the child exits
    pub fn close_slave_fd(&self) {
        self.update_flags(|f| f.insert(Flags::INLINE_SPAWNED));
        let fd = self.slave_fd.get();
        if fd != Fd::INVALID {
            fd.close();
            self.slave_fd.set(Fd::INVALID);
        }
    }

    /// Windows: close only the ConPTY handle so conhost releases its pipe ends and
    /// our reader observes EOF. Leaves the Terminal itself open (closed=false),
    /// matching POSIX semantics where child exit delivers EOF without closing the
    /// master fd.
    pub fn close_pseudoconsole(&self) {
        #[cfg(windows)]
        if let Some(hpcon) = self.hpcon.take() {
            self.close_pseudoconsole_off_thread(hpcon);
        }
    }

    /// On Windows < 11 24H2, ClosePseudoConsole blocks until the output pipe is
    /// drained. Our reader runs on the event-loop thread, so calling it there
    /// deadlocks. Fire from a detached thread so the event loop keeps draining;
    /// conhost completes its flush and our reader sees the final data then EOF.
    /// hpcon is passed to the thread by value so the Terminal struct may be freed
    /// before the thread completes.
    #[cfg(windows)]
    fn close_pseudoconsole_off_thread(&self, hpcon: windows::HPCON) {
        // PORT NOTE: Zig used `std.Thread.spawn(.{}, fn, .{hpcon})` then
        // `.detach()`. PORTING.md bans std::process but not std::thread; a raw
        // detached OS thread matches the Zig (no event-loop integration needed).
        let hpcon_addr = hpcon as usize;
        match std::thread::Builder::new().spawn(move || {
            // SAFETY: hpcon was a valid HPCON when taken; ClosePseudoConsole is
            // safe to call from any thread per Win32 docs.
            unsafe { windows::ClosePseudoConsole(hpcon_addr as windows::HPCON) };
        }) {
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
    #[cfg(not(windows))]
    #[allow(unused)]
    fn close_pseudoconsole_off_thread(&self, _hpcon: *mut c_void) {}
}

pub struct PtyResult {
    pub master: Fd,
    pub read_fd: Fd,
    pub write_fd: Fd,
    pub slave: Fd,
    #[cfg(windows)]
    pub hpcon: windows::HPCON,
    #[cfg(not(windows))]
    pub hpcon: (),
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

impl From<CreatePtyError> for bun_core::Error {
    fn from(e: CreatePtyError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
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
    #[allow(unreachable_code)]
    Err(CreatePtyError::NotSupported)
}

// OpenPtyTermios is required for the openpty() extern signature even though we pass null.
// Kept for type correctness of the C function declaration.
#[repr(C)]
pub struct OpenPtyTermios {
    pub c_iflag: u32,
    pub c_oflag: u32,
    pub c_cflag: u32,
    pub c_lflag: u32,
    pub c_cc: [u8; 20],
    pub c_ispeed: u32,
    pub c_ospeed: u32,
}

pub use bun_core::Winsize;

pub type OpenPtyFn = unsafe extern "C" fn(
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
    use bun_core::ZStr;

    // PORT NOTE: Zig used non-atomic file-level vars (single-threaded init).
    // PORTING.md §Global mutable state: bool→AtomicBool; handle slot is an
    // AtomicPtr (null ⇔ None — dlopen never yields a null Some). JS-thread-only.
    static HANDLE: core::sync::atomic::AtomicPtr<c_void> =
        core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());
    static LOADED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

    pub fn get_handle() -> Option<*mut c_void> {
        use core::sync::atomic::Ordering::Relaxed;
        if LOADED.load(Relaxed) {
            let h = HANDLE.load(Relaxed);
            return if h.is_null() { None } else { Some(h) };
        }
        LOADED.store(true, Relaxed);

        // Try libutil.so first (most common), then libutil.so.1
        const LIB_NAMES: [&ZStr; 3] = [
            bun_core::zstr!("libutil.so"),
            bun_core::zstr!("libutil.so.1"),
            bun_core::zstr!("libc.so.6"),
        ];
        for lib_name in LIB_NAMES {
            if let Some(h) = sys::dlopen(lib_name, sys::RTLD::LAZY) {
                HANDLE.store(h, Relaxed);
                return Some(h);
            }
        }
        None
    }

    pub fn get_open_pty() -> Option<OpenPtyFn> {
        sys::dlsym_with_handle!(OpenPtyFn, "openpty", get_handle())
    }
}

fn get_open_pty_fn() -> Option<OpenPtyFn> {
    // On macOS, openpty is in libc, so we can use it directly
    #[cfg(target_os = "macos")]
    {
        // PORT NOTE: declared locally (not via the `libc` crate) so the
        // `OpenPtyFn` type unifies with the Linux dlsym path.
        unsafe extern "C" {
            // SAFETY precondition: out-param fd pointers must be writable and
            // termp/winp must be null or valid — raw-pointer contract. Kept
            // `unsafe` so the fn item coerces to `OpenPtyFn` (unsafe fn ptr).
            pub fn openpty(
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

    #[allow(unreachable_code)]
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

    let master_fd_desc = Fd::from_native(master_fd);
    let slave_fd_desc = Fd::from_native(slave_fd);

    // Configure sensible terminal defaults matching node-pty behavior.
    // These are "cooked mode" defaults that most terminal applications expect.
    match sys::posix::tcgetattr(slave_fd) {
        Ok(termios) => {
            let mut t = termios;

            // Input flags: standard terminal input processing
            // PORT NOTE: Zig used struct-literal flag init on std.posix tc_iflag_t;
            // Rust libc termios uses raw tcflag_t bitfields, so these are bit-ORs
            // of the libc constants (identical values).
            t.c_iflag = libc::ICRNL // Map CR to NL on input
                | libc::IXON // Enable XON/XOFF flow control on output
                | libc::IXANY // Any character restarts output
                | libc::IMAXBEL // Ring bell on input queue full
                | libc::BRKINT; // Signal interrupt on break
            // IUTF8: present in Linux/macOS/FreeBSD kernels but Zig std's
            // tc_iflag_t only exposes the field on Linux/macOS, so probe for it.
            #[cfg(any(target_os = "linux", target_os = "macos"))]
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
            // PORT NOTE: Zig assigned `.B38400` to ispeed/ospeed enum fields;
            // libc termios on Linux encodes speed in c_cflag, so use
            // cfsetispeed/cfsetospeed (the portable way to set both).
            // SAFETY: `t` is a fully-initialized termios from tcgetattr.
            unsafe {
                libc::cfsetispeed(&raw mut t, libc::B38400);
                libc::cfsetospeed(&raw mut t, libc::B38400);
            }

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
        hpcon: (),
    })
}

#[cfg(windows)]
pub struct PipePair {
    pub server: windows::HANDLE,
    pub client: windows::HANDLE,
}

/// Create one end of a pipe pair as an overlapped named pipe (server) and the
/// other as a synchronous client. Returns both raw HANDLEs. Caller closes
/// both on error. The "server" end is suitable for libuv (uv_pipe_open) and
/// the "client" end is suitable for ConPTY (which uses synchronous I/O).
#[cfg(windows)]
fn create_overlapped_pipe_pair(
    // PIPE_ACCESS_INBOUND: server reads, client writes.
    // PIPE_ACCESS_OUTBOUND: server writes, client reads.
    server_access: u32,
) -> Result<PipePair, CreatePtyError> {
    use windows::kernel32 as k32;
    const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x00080000;

    let pid: u32 = windows::GetCurrentProcessId();
    let counter = PIPE_SERIAL.fetch_add(1, Ordering::Relaxed);
    let mut name_utf8_buf = [0u8; 96];
    let name = {
        use std::io::Write;
        let mut cursor = &mut name_utf8_buf[..];
        if write!(cursor, "\\\\.\\pipe\\bun-conpty-{}-{}", pid, counter).is_err() {
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

    // SAFETY: name_w is NUL-terminated; all other params are valid per Win32.
    let server = unsafe {
        k32::CreateNamedPipeW(
            name_w.as_ptr(),
            server_access | windows::FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            windows::PIPE_TYPE_BYTE | windows::PIPE_READMODE_BYTE | windows::PIPE_WAIT,
            1,
            65536,
            65536,
            0,
            core::ptr::null_mut(),
        )
    };
    if server == windows::INVALID_HANDLE_VALUE {
        return Err(CreatePtyError::OpenPtyFailed);
    }
    let server_guard = scopeguard::guard(server, |h| unsafe {
        // SAFETY: h is a valid open HANDLE on the error path.
        let _ = windows::CloseHandle(h);
    });

    let client_access: u32 = if server_access == windows::PIPE_ACCESS_INBOUND {
        windows::GENERIC_WRITE
    } else {
        windows::GENERIC_READ
    };

    // SAFETY: name_w is NUL-terminated; all other params are valid per Win32.
    let client = unsafe {
        k32::CreateFileW(
            name_w.as_ptr(),
            client_access,
            0,
            core::ptr::null_mut(),
            windows::OPEN_EXISTING,
            0,
            core::ptr::null_mut(),
        )
    };
    if client == windows::INVALID_HANDLE_VALUE {
        return Err(CreatePtyError::OpenPtyFailed);
    }

    let server = scopeguard::ScopeGuard::into_inner(server_guard);
    Ok(PipePair { server, client })
}

static PIPE_SERIAL: AtomicU32 = AtomicU32::new(0);

#[cfg(windows)]
fn create_pty_windows(cols: u16, rows: u16) -> Result<PtyResult, CreatePtyError> {
    // Track ownership explicitly: handles are nulled out as they are closed or
    // transferred so the errdefer cleanup never double-closes.
    let mut out_server: Option<windows::HANDLE> = None;
    let mut out_client: Option<windows::HANDLE> = None;
    let mut in_server: Option<windows::HANDLE> = None;
    let mut in_client: Option<windows::HANDLE> = None;
    let mut hpcon: Option<windows::HPCON> = None;

    // errdefer block: scopeguard captures &mut to all of the above.
    // PORT NOTE: reshaped for borrowck — using a single closure that reads the
    // Option cells at drop-time would require interior mutability. Instead,
    // inline the cleanup at each early-return point. This matches the Zig
    // errdefer semantics exactly (cleanup runs on every `return Err`).
    macro_rules! cleanup {
        () => {
            // SAFETY: every Some(h) is a valid open Win32 handle still owned by
            // this fn (not yet transferred); ClosePseudoConsole/CloseHandle are
            // safe on those values.
            unsafe {
                if let Some(h) = hpcon {
                    windows::ClosePseudoConsole(h);
                }
                if let Some(h) = out_server {
                    let _ = windows::CloseHandle(h);
                }
                if let Some(h) = out_client {
                    let _ = windows::CloseHandle(h);
                }
                if let Some(h) = in_server {
                    let _ = windows::CloseHandle(h);
                }
                if let Some(h) = in_client {
                    let _ = windows::CloseHandle(h);
                }
            }
        };
    }

    // Output pipe: ConPTY writes (client), we read (overlapped server).
    {
        let pair = match create_overlapped_pipe_pair(windows::PIPE_ACCESS_INBOUND) {
            Ok(p) => p,
            Err(e) => {
                cleanup!();
                return Err(e);
            }
        };
        out_server = Some(pair.server);
        out_client = Some(pair.client);
    }

    // Input pipe: we write (overlapped server), ConPTY reads (client).
    {
        let pair = match create_overlapped_pipe_pair(windows::PIPE_ACCESS_OUTBOUND) {
            Ok(p) => p,
            Err(e) => {
                cleanup!();
                return Err(e);
            }
        };
        in_server = Some(pair.server);
        in_client = Some(pair.client);
    }

    let size = windows::COORD {
        X: clamp_to_coord(cols),
        Y: clamp_to_coord(rows),
    };
    {
        let mut pc: windows::HPCON = core::ptr::null_mut();
        // SAFETY: in_client/out_client are valid open HANDLEs; pc is a valid out-ptr.
        if unsafe {
            windows::CreatePseudoConsole(size, in_client.unwrap(), out_client.unwrap(), 0, &mut pc)
        } < 0
        {
            cleanup!();
            return Err(CreatePtyError::OpenPtyFailed);
        }
        hpcon = Some(pc);
    }

    // ConPTY duplicated the client handles internally; close our copies.
    // SAFETY: in_client/out_client are valid open HANDLEs.
    unsafe {
        let _ = windows::CloseHandle(in_client.take().unwrap());
        let _ = windows::CloseHandle(out_client.take().unwrap());
    }

    // Wrap server (overlapped) ends as libuv-owned FDs so they can be passed
    // to BufferedReader/StreamingWriter.start() which calls uv_pipe_open.
    // Do not .take() until after success — on Err the cleanup! must still see
    // Some(h) so the HANDLE isn't leaked (matches Zig: `out_server = null` only
    // after the fallible call succeeds).
    let read_fd = match Fd::from_system(out_server.unwrap()).make_libuv_owned() {
        Ok(fd) => {
            out_server = None;
            fd
        }
        Err(_) => {
            cleanup!();
            return Err(CreatePtyError::DupFailed);
        }
    };
    // errdefer read_fd.close()
    let read_fd_guard = scopeguard::guard(read_fd, |fd| fd.close());

    let write_fd = match Fd::from_system(in_server.unwrap()).make_libuv_owned() {
        Ok(fd) => {
            in_server = None;
            fd
        }
        Err(_) => {
            cleanup!();
            return Err(CreatePtyError::DupFailed);
        }
    };

    let result_hpcon = hpcon.take().unwrap();
    let read_fd = scopeguard::ScopeGuard::into_inner(read_fd_guard);

    Ok(PtyResult {
        master: Fd::INVALID,
        read_fd,
        write_fd,
        slave: Fd::INVALID,
        hpcon: result_hpcon,
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
    #[bun_jsc::host_fn(getter)]
    pub fn get_closed(&self, _global: &JSGlobalObject) -> JSValue {
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
            // PORT NOTE: Zig used @typeInfo to extract the packed-struct backing
            // integer of std.posix tc_*flag_t. In Rust/libc these are already raw
            // integers (tcflag_t), so read the field directly.
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
            // PORT NOTE: Zig computed maxInt of the packed-struct backing integer
            // via @typeInfo. tcflag_t::MAX is the same value (platform width).
            let max_val: f64 = libc::tcflag_t::MAX as f64;
            let clamped = num.max(0.0).min(max_val);
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
    pub fn get_input_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Iflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub fn set_input_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Iflag }>(global_object, value)?;
        Ok(true)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_output_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Oflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub fn set_output_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Oflag }>(global_object, value)?;
        Ok(true)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_local_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Lflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub fn set_local_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Lflag }>(global_object, value)?;
        Ok(true)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_control_flags(&self, _global: &JSGlobalObject) -> JSValue {
        self.get_termios_flag::<{ TermiosField::Cflag }>()
    }
    #[bun_jsc::host_fn(setter)]
    pub fn set_control_flags(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        self.set_termios_flag::<{ TermiosField::Cflag }>(global_object, value)?;
        Ok(true)
    }

    /// Write data to the terminal
    #[bun_jsc::host_fn(method)]
    pub fn write(
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
        // defer string_or_buffer.deinit() — Drop handles it.

        let bytes = string_or_buffer.slice();

        if bytes.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        // Write using the streaming writer
        let write_result = self.writer.with_mut(|w| w.write(bytes));
        match write_result {
            bun_io::WriteResult::Done(amt) => Ok(JSValue::js_number(
                i32::try_from(amt).expect("int cast") as f64,
            )),
            bun_io::WriteResult::Wrote(amt) => Ok(JSValue::js_number(
                i32::try_from(amt).expect("int cast") as f64,
            )),
            // On Windows the streaming writer buffers and returns .pending=0; the
            // bytes were accepted, so report bytes.len to match POSIX semantics.
            bun_io::WriteResult::Pending(amt) => {
                let n = if cfg!(windows) { bytes.len() } else { amt };
                Ok(JSValue::js_number(
                    i32::try_from(n).expect("int cast") as f64
                ))
            }
            bun_io::WriteResult::Err(err) => {
                Err(global_object.throw_value(err.to_js(global_object)))
            }
        }
    }

    /// Resize the terminal
    #[bun_jsc::host_fn(method)]
    pub fn resize(
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
            #[cfg(target_os = "macos")]
            const TIOCSWINSZ: c_ulong = 0x80087467;
            #[cfg(not(target_os = "macos"))]
            const TIOCSWINSZ: c_ulong = 0x5414;

            let winsize = bun_core::Winsize {
                row: new_rows,
                col: new_cols,
                xpixel: 0,
                ypixel: 0,
            };

            // SAFETY: master_fd is open (closed flag checked above), TIOCSWINSZ
            // takes a *const winsize.
            let ioctl_result = unsafe {
                libc::ioctl(
                    self.master_fd.get().native(),
                    TIOCSWINSZ as _,
                    &raw const winsize,
                )
            };
            if ioctl_result != 0 {
                return Err(global_object.throw(format_args!("Failed to resize terminal")));
            }
        }

        #[cfg(windows)]
        {
            if let Some(hpcon) = self.hpcon.get() {
                let size = windows::COORD {
                    X: clamp_to_coord(new_cols),
                    Y: clamp_to_coord(new_rows),
                };
                // SAFETY: hpcon is a valid open HPCON.
                let hr = unsafe { windows::ResizePseudoConsole(hpcon, size) };
                if hr < 0 {
                    return Err(global_object.throw(format_args!("Failed to resize terminal")));
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

        Ok(JSValue::UNDEFINED)
    }

    /// Set raw mode on the terminal
    #[bun_jsc::host_fn(method)]
    pub fn set_raw_mode(
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
            let tty_result = bun_core::tty::set_mode(
                self.master_fd.get().native(),
                if enabled {
                    bun_core::tty::Mode::Raw
                } else {
                    bun_core::tty::Mode::Normal
                },
            );
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
#[cfg(not(unix))]
type Termios = ();

/// Get terminal attributes using tcgetattr
fn get_termios(fd: Fd) -> Option<Termios> {
    #[cfg(not(unix))]
    {
        let _ = fd;
        return None;
    }
    #[cfg(unix)]
    sys::posix::tcgetattr(fd.native()).ok()
}

/// Set terminal attributes using tcsetattr (TCSANOW = immediate)
fn set_termios(fd: Fd, termios_p: &Termios) -> bool {
    #[cfg(not(unix))]
    {
        let _ = (fd, termios_p);
        return false;
    }
    #[cfg(unix)]
    {
        sys::posix::tcsetattr(fd.native(), sys::posix::TCSA::Now, termios_p).is_ok()
    }
}

impl Terminal {
    /// Reference the terminal to keep the event loop alive
    #[bun_jsc::host_fn(method)]
    pub fn do_ref(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.update_ref(true);
        Ok(JSValue::UNDEFINED)
    }

    /// Unreference the terminal
    #[bun_jsc::host_fn(method)]
    pub fn do_unref(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
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
    pub fn close(&self, _g: &JSGlobalObject, _f: &CallFrame) -> JsResult<JSValue> {
        self.close_internal();
        Ok(JSValue::UNDEFINED)
    }

    /// Async dispose for "using" syntax
    #[bun_jsc::host_fn(method)]
    pub fn async_dispose(
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

    pub fn close_internal(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::CLOSED));

        // Close writer (closes write_fd). R-2: `with_mut` borrow is held across
        // the synchronous `on_writer_close` parent callback, but that callback
        // touches only `flags`/`ref_count` (separate `Cell`s), never `writer`.
        self.writer.with_mut(|w| w.close());
        self.write_fd.set(Fd::INVALID);

        #[cfg(windows)]
        {
            // Dispatch ClosePseudoConsole off-thread (it blocks until the output
            // pipe is drained on Windows < 11 24H2) and leave the reader open so
            // the event loop can keep draining; conhost flushes the final frame,
            // closes its pipe end, and the reader observes EOF → onReaderDone.
            if let Some(hpcon) = self.hpcon.take() {
                self.close_pseudoconsole_off_thread(hpcon);
            }
            // Reader stays open even if hpcon was already null (closePseudoconsole
            // may have dispatched it earlier); onReaderDone closes on EOF.
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
    fn on_writer_close(&self) {
        bun_output::scoped_log!(Terminal, "onWriterClose");
        if !self.flags.get().contains(Flags::WRITER_DONE) {
            self.update_flags(|f| f.insert(Flags::WRITER_DONE));
            // Release writer's ref
            self.deref_();
        }
    }

    fn on_writer_ready(&self) {
        bun_output::scoped_log!(Terminal, "onWriterReady");
        // Call drain callback
        let Some(this_jsvalue) = self.this_value.get().try_get() else {
            return;
        };
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

    fn on_writer_error(&self, err: sys::Error) {
        bun_output::scoped_log!(Terminal, "onWriterError: {:?}", err);
        // On write error, close the terminal to prevent further operations
        // This handles cases like broken pipe when the child process exits
        if !self.flags.get().contains(Flags::CLOSED) {
            self.close_internal();
        }
    }

    fn on_write(&self, amount: usize, status: WriteStatus) {
        let _ = status;
        bun_output::scoped_log!(Terminal, "onWrite: {} bytes", amount);
        let _ = self;
    }

    // IOReader callbacks
    pub fn on_reader_done(&self) {
        bun_output::scoped_log!(Terminal, "onReaderDone");
        // R-2: `&self` (no `noalias`) + `Cell<Flags>` makes the prior
        // `black_box`-launder unnecessary — the post-`call_exit_callback`
        // `flags` load is a fresh `Cell::get()` that LLVM cannot fold across
        // the re-entrant JS call (UnsafeCell suppresses the alias assumption).
        // EOF from master - downgrade to weak ref to allow GC
        // Skip JS interactions if already finalized (happens when close() is called during finalize)
        if !self.flags.get().contains(Flags::FINALIZED) {
            self.update_flags(|f| f.remove(Flags::CONNECTED));
            self.this_value.with_mut(|v| v.downgrade());
            // exit_code 0 = clean EOF on PTY stream (not subprocess exit code)
            self.call_exit_callback(0, None);
        }
        // Release reader's ref (only once)
        if !self.flags.get().contains(Flags::READER_DONE) {
            self.update_flags(|f| f.insert(Flags::READER_DONE));
            self.deref_();
        }
    }

    pub fn on_reader_error(&self, err: sys::Error) {
        bun_output::scoped_log!(Terminal, "onReaderError: {:?}", err);
        // R-2: see `on_reader_done` — `&self` + `Cell<Flags>` replaces the
        // prior `black_box` launder.
        // Error - downgrade to weak ref to allow GC
        // Skip JS interactions if already finalized
        if !self.flags.get().contains(Flags::FINALIZED) {
            self.update_flags(|f| f.remove(Flags::CONNECTED));
            self.this_value.with_mut(|v| v.downgrade());
            // exit_code 1 = I/O error on PTY stream (not subprocess exit code)
            self.call_exit_callback(1, None);
        }
        // Release reader's ref (only once)
        if !self.flags.get().contains(Flags::READER_DONE) {
            self.update_flags(|f| f.insert(Flags::READER_DONE));
            self.deref_();
        }
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
            ZigString::init(name.as_bytes()).to_js(global_this)
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
    pub fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
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
        // allocator.dupe(u8, chunk) — Zig recovered from OOM here (logged + `return true`
        // to keep reading). Replicate with try_reserve so a transient OOM on a large
        // chunk doesn't abort the process.
        // PERF(port): was explicit dupe + MarkedArrayBuffer.fromBytes; preserving.
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
        let data = MarkedArrayBuffer::from_bytes(bytes, jsc::JSType::Uint8Array)
            .to_node_buffer(global_this);

        global_this.bun_vm().event_loop_mut().run_callback(
            callback,
            global_this,
            this_jsvalue,
            &[this_jsvalue, data],
        );

        true // Continue reading
    }

    pub fn event_loop(&self) -> EventLoopHandle {
        self.event_loop_handle
    }

    pub fn loop_(&self) -> *mut AsyncLoop {
        #[cfg(windows)]
        {
            self.event_loop_handle.uv_loop()
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop().cast()
        }
    }

    /// Finalize - called by GC when object is collected
    pub fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(Terminal, "finalize");
        jsc::mark_binding();
        bun_ptr::finalize_js_box(self, |this| {
            this.this_value.with_mut(|v| v.finalize());
            this.update_flags(|f| f.insert(Flags::FINALIZED));
            this.close_internal();
        });
    }
}

/// `deinit` — NOT mapped to `impl Drop` because Terminal is an intrusive-refcounted
/// `.classes.ts` m_ctx payload: destruction is driven by `deref_()` reaching zero,
/// and the body calls `bun.destroy(this)` (frees its own allocation). Drop cannot
/// express that. Kept as a free fn called from `deref_()`.
///
/// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
/// whose generated trait `destructor` upholds the sole-owner contract.
fn deinit_and_destroy(this: *mut Terminal) {
    bun_output::scoped_log!(Terminal, "deinit");
    // SAFETY: caller is `deref_()` with ref_count == 0; `this` was heap-allocated.
    // R-2: deref as shared — `close_internal` takes `&self` and all field
    // mutation routes through `Cell`/`JsCell`.
    let t = unsafe { &*this };
    // Set reader/writer done flags to prevent extra deref calls in closeInternal
    t.update_flags(|f| f.insert(Flags::READER_DONE | Flags::WRITER_DONE));
    // Close all FDs if not already closed (handles constructor error paths)
    // closeInternal() checks flags.closed and returns early on subsequent calls,
    // so this is safe even if finalize() already called it
    t.close_internal();
    // term_name, reader, writer: Drop runs via heap::take below.
    // bun.destroy(this)
    // SAFETY: `this` was heap-allocated in init_terminal and ref_count == 0, so
    // no other live references exist.
    drop(unsafe { bun_core::heap::take(this) });
}

// `bun.io.BufferedReader.init(@This())` — vtable parent. Terminal declares
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop` (Terminal.zig).
bun_io::buffered_reader_parent_link!(Terminal for Terminal);
impl BufferedReaderParent for Terminal {
    const KIND: bun_io::BufferedReaderParentLinkKind =
        bun_io::BufferedReaderParentLinkKind::Terminal;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], has_more: ReadState) -> bool {
        Self::from_parent_ptr(this).on_read_chunk(chunk, has_more)
    }
    unsafe fn on_reader_done(this: *mut Self) {
        Self::from_parent_ptr(this).on_reader_done()
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        Self::from_parent_ptr(this).on_reader_error(err)
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        // Delegate to the inherent `Terminal::loop_()` which is cfg-split:
        // on Windows it projects `.uv_loop()` (the `*mut uv_loop_t` field of
        // `WindowsLoop`), NOT a raw cast of the `bun_uws::Loop` wrapper —
        // matching Terminal.zig `loop()` (`this.event_loop_handle.loop().uv_loop`).
        Self::from_parent_ptr(this).loop_().cast()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        Self::from_parent_ptr(this)
            .event_loop_handle
            .as_event_loop_ctx()
    }
}

// `bun.io.StreamingWriter(@This(), struct { onClose, onWritable, onError, onWrite })`
// → trait impl on `Terminal`. All methods take `*mut Self` because the writer
// is an intrusive *field of* the parent — see PipeWriter.rs PosixStreamingWriterParent.
#[cfg(unix)]
impl bun_io::pipe_writer::PosixStreamingWriterParent for Terminal {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::posix_event_loop::poll_tag::TERMINAL_POLL;
    const HAS_ON_READY: bool = true;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        Self::from_parent_ptr(this).on_write(amount, status)
    }
    unsafe fn on_error(this: *mut Self, err: sys::Error) {
        Self::from_parent_ptr(this).on_writer_error(err)
    }
    unsafe fn on_ready(this: *mut Self) {
        Self::from_parent_ptr(this).on_writer_ready()
    }
    unsafe fn on_close(this: *mut Self) {
        Self::from_parent_ptr(this).on_writer_close()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        Self::from_parent_ptr(this)
            .event_loop_handle
            .as_event_loop_ctx()
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        Self::from_parent_ptr(this).event_loop_handle.r#loop()
    }
}

#[cfg(windows)]
impl bun_io::pipe_writer::WindowsWriterParent for Terminal {
    unsafe fn loop_(this: *mut Self) -> *mut bun_libuv_sys::Loop {
        // SAFETY: BACKREF set via writer.parent; shared-only read.
        unsafe { (*this).event_loop_handle.uv_loop() }
    }
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: see loop_. Intrusive refcount bump via raw pointer — do NOT
        // form &Terminal here: this is called from inside writer methods while
        // a &mut self.writer borrow is live (Stacked-Borrows aliasing).
        unsafe { bun_ptr::RefCount::<Terminal>::ref_(this) };
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see loop_. Intrusive refcount drop via raw pointer; may free
        // `this`. See ref_ for aliasing rationale.
        unsafe { bun_ptr::RefCount::<Terminal>::deref(this) };
    }
}

#[cfg(windows)]
impl bun_io::pipe_writer::WindowsStreamingWriterParent for Terminal {
    const HAS_ON_WRITABLE: bool = true;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        Self::from_parent_ptr(this).on_write(amount, status)
    }
    unsafe fn on_error(this: *mut Self, err: sys::Error) {
        Self::from_parent_ptr(this).on_writer_error(err)
    }
    unsafe fn on_writable(this: *mut Self) {
        Self::from_parent_ptr(this).on_writer_ready()
    }
    unsafe fn on_close(this: *mut Self) {
        Self::from_parent_ptr(this).on_writer_close()
    }
}

// ported from: src/runtime/api/bun/Terminal.zig
