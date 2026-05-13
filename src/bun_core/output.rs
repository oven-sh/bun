//! Port of `src/bun_core/output.zig`.
//!
//! Most of the public surface in the Zig original is `(comptime fmt: string, args: anytype)`
//! printf-style entry points whose format string is rewritten at comptime (`prettyFmt`,
//! newline appending, tag prefixing). In Rust these collapse into:
//!   * a non-generic `print_to(dest, core::fmt::Arguments)` plumbing layer, and
//!   * thin `macro_rules!` wrappers (`pretty!`, `pretty_errorln!`, `note!`, …) that perform
//!     the compile-time format-string rewrite via `pretty_fmt!`.
//!
//! `pretty_fmt!` itself (the `<red>…<r>` → ANSI substitution) is necessarily a proc-macro;
//! a stub is declared here and flagged `TODO(port): proc-macro`.

use core::cell::{Cell, RefCell};
use core::ffi::c_int;
use core::fmt;
// `#[macro_export]` macros land at crate root; re-import so order-of-definition
// inside this module doesn't matter for the early call sites.
#[allow(unused_imports)]
use crate::{
    declare_scope, err_generic, note, pretty, pretty_error, pretty_errorln, prettyln, scoped_log,
    warn,
};
use core::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU32, Ordering};

use crate::Global;
use crate::env_var;
// MOVE_DOWN: bun_core::strings → bun_core (move-in pass).
use crate::strings;
// MOVE_DOWN: bun_sys::Fd / bun_sys::fd → bun_core (move-in pass).
use crate::Fd;
// MOVE_DOWN: bun_threading::Mutex → bun_core (move-in pass).
use crate::Mutex;
// MOVE_DOWN: io::Writer → bun_core (move-in pass) — re-exported as crate::io::Writer.
use crate::io;

// ──────────────────────────────────────────────────────────────────────────
// Output sink (CYCLEBREAK §Debug-hook / §Dispatch cold path)
//
// `bun_sys::{File, QuietWrite, file::QuietWriter, make_path, create_file,
// deprecated::BufferedReader}` are higher-tier I/O primitives that `bun_core`
// cannot name. The `bun_dispatch::link_interface!` `OutputSink[Sys]` (declared
// at crate root) provides the seam; `bun_sys` supplies the `Sys` arm.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::OutputSink;

#[inline]
pub fn output_sink() -> OutputSink {
    OutputSink::SYS
}

/// Opaque handle to a `bun_sys::file::QuietWriter`. bun_core treats it as a
/// POD blob; bun_sys casts back to the concrete type.
/// TODO(b0-genuine): bun_sys::file::QuietWriter — size/align must match.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct QuietWriter {
    _opaque: [*mut (); 4],
}
impl QuietWriter {
    pub const ZEROED: Self = Self {
        _opaque: [core::ptr::null_mut(); 4],
    };

    #[inline]
    pub fn adapt_to_new_api(self, buf: &mut [u8]) -> QuietWriterAdapter {
        output_sink().quiet_writer_adapt(self, buf.as_mut_ptr(), buf.len())
    }
    #[inline]
    pub fn flush(&mut self) {
        output_sink().quiet_writer_flush(self)
    }
    #[inline]
    pub fn context_handle(&self) -> Fd {
        output_sink().quiet_writer_fd(self)
    }
    /// Inherent forwarder so call sites don't need `use fmt::Write`.
    #[inline]
    pub fn write_fmt(&mut self, args: core::fmt::Arguments<'_>) -> core::fmt::Result {
        <Self as core::fmt::Write>::write_fmt(self, args)
    }
}
impl core::fmt::Write for QuietWriter {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        if output_sink().quiet_writer_write_all(self, s.as_bytes()) {
            Ok(())
        } else {
            Err(core::fmt::Error)
        }
    }
}
// `qw.write_fmt(args)` resolves through `fmt::Write`.

/// Opaque adapter wrapping a QuietWriter and exposing `crate::io::Writer`.
/// TODO(b0-genuine): bun_sys::QuietWrite::Adapter — size/align must match.
#[repr(C, align(8))]
pub struct QuietWriterAdapter {
    _opaque: [u8; 64],
}
impl QuietWriterAdapter {
    /// Zeroed placeholder; caller must overwrite via `adapt_to_new_api` before use.
    #[inline]
    pub const fn uninit() -> Self {
        Self { _opaque: [0u8; 64] }
    }
    #[inline]
    pub fn new_interface(&mut self) -> &mut io::Writer {
        // SAFETY: erased <bun_sys::QuietWrite>::Adapter; bun_sys guarantees
        // the io::Writer is the first field (repr(C)).
        unsafe { &mut *std::ptr::from_mut::<Self>(self).cast::<io::Writer>() }
    }
}

/// Opaque file handle. Replaces `bun_sys::File` in this crate.
/// repr matches `bun_sys::File` (transparent over a single Fd).
#[derive(Clone, Copy)]
#[repr(transparent)]
pub struct File(pub Fd);

impl File {
    pub const ZEROED: Self = Self(Fd::INVALID);
    #[inline]
    pub const fn fd(&self) -> Fd {
        self.0
    }
    #[inline]
    pub fn handle(self) -> Fd {
        self.0
    }
    /// `bun_sys::File::stderr()` via the sink (T0-safe).
    #[inline]
    pub fn stderr() -> Self {
        output_sink().stderr()
    }
    #[inline]
    pub fn quiet_writer(self) -> QuietWriter {
        output_sink().quiet_writer_from_fd(self.0)
    }
    /// Write all bytes (best-effort; routes through QuietWriter so errors are
    /// swallowed per Zig `bun.Output` semantics). Progress.rs uses this.
    #[inline]
    pub fn write_all(&self, bytes: &[u8]) -> Result<(), crate::Error> {
        let mut qw = self.quiet_writer();
        let _ = output_sink().quiet_writer_write_all(&mut qw, bytes);
        Ok(())
    }
    #[inline]
    pub fn write(&self, bytes: &[u8]) -> Result<usize, crate::Error> {
        self.write_all(bytes).map(|_| bytes.len())
    }
    pub fn write_fmt(&self, args: core::fmt::Arguments<'_>) -> Result<(), crate::Error> {
        struct Adapter<'a>(&'a File);
        impl core::fmt::Write for Adapter<'_> {
            fn write_str(&mut self, s: &str) -> core::fmt::Result {
                let _ = self.0.write_all(s.as_bytes());
                Ok(())
            }
        }
        let _ = core::fmt::write(&mut Adapter(self), args);
        Ok(())
    }
}
impl From<Fd> for File {
    #[inline]
    fn from(fd: Fd) -> Self {
        Self(fd)
    }
}

/// `bun.argv` — process argv as borrowed byte slices. Owned by the process.
pub fn argv() -> impl Iterator<Item = &'static [u8]> {
    // Delegates to the canonical `bun_core::argv()` which reads the raw
    // `(argc,argv)` captured by `init_argv` in `main` (musl-safe) and falls
    // back to `std::env::args_os()` for tests/tools.
    crate::util::argv().into_iter()
}

/// `bun.Output.debugWarn` — yellow `debug warn:` prefix to stderr in debug
/// builds, through the Bun output sink (so colour/redirect logic applies),
/// followed by an explicit flush. Zig output.zig:1189-1194.
///
/// Function form takes a single [`PrettyFmtInput`] payload — callers pass
/// `format_args!("template {}", x)` (the dominant convention across the
/// codebase) or a bare `&str`. The payload is rendered first, then
/// `<tag>`-rewritten. For the comptime-literal fast path use the macro form.
#[inline]
pub fn debug_warn(payload: impl PrettyFmtInput) {
    if cfg!(debug_assertions) {
        let buf = payload.into_pretty_buf(enable_ansi_colors_stderr());
        pretty_errorln!("<yellow>debug warn<r><d>:<r> {}", buf);
        flush();
    }
}

/// `bun.Output.warn` — yellow `warn:` prefix to stderr.
#[inline]
pub fn warn(payload: impl PrettyFmtInput) {
    let buf = payload.into_pretty_buf(enable_ansi_colors_stderr());
    pretty_errorln!("<r><yellow>warn<r><d>:<r> {}", buf);
}

/// `bun.Output.note` — blue `note:` prefix to stderr (output.zig:1179).
#[inline]
pub fn note(payload: impl PrettyFmtInput) {
    let buf = payload.into_pretty_buf(enable_ansi_colors_stderr());
    pretty_errorln!("<blue>note<r><d>:<r> {}", buf);
}

/// Function-form of `Output.debug` (Zig: `pub fn debug(comptime fmt, args)`).
/// The macro form is `crate::debug!`; this fn variant takes a single
/// pre-formatted payload for call sites that build the message dynamically.
#[inline]
pub fn debug(payload: impl PrettyFmtInput) {
    if cfg!(debug_assertions) {
        let buf = payload.into_pretty_buf(enable_ansi_colors_stderr());
        pretty_errorln!("<d>DEBUG:<r> {}", buf);
        flush();
    }
}

/// `Output.prettyErrorln` — function form. Performs `<tag>` → ANSI rewrite on
/// the rendered payload (using stderr's colour state), writes to stderr, and
/// appends `\n` if the rendered output does not already end in one. Macro
/// form: `crate::pretty_errorln!`.
#[inline]
pub fn pretty_errorln(payload: impl PrettyFmtInput) {
    let buf = payload.into_pretty_buf(enable_ansi_colors_stderr());
    write_bytes(Destination::Stderr, &buf);
    if buf.0.last() != Some(&b'\n') {
        write_bytes(Destination::Stderr, b"\n");
    }
}

/// `Output.prettyError` — `<tag>`-rewritten payload to stderr without a
/// trailing newline.
#[inline]
pub fn pretty_error(payload: impl PrettyFmtInput) {
    let buf = payload.into_pretty_buf(enable_ansi_colors_stderr());
    write_bytes(Destination::Stderr, &buf);
}

/// Test-harness initializer: configure the output sinks without touching the
/// real stdio FDs (Zig: `Output.initTest`). Safe to call repeatedly.
pub fn init_test() {
    if SOURCE_SET.get() {
        return;
    }
    let stdout = File::from(Fd::stdout());
    let stderr = File::from(Fd::stderr());
    Source::set_init(stdout, stderr);
    // Tests run without a TTY; force colours off so snapshot output is stable.
    ENABLE_ANSI_COLORS_STDOUT.store(false, Ordering::Relaxed);
    ENABLE_ANSI_COLORS_STDERR.store(false, Ordering::Relaxed);
}

/// `bun.Output.Source.Stdio.restore` — restore terminal to cooked mode on exit.
/// Thin alias over [`crate::output::stdio::restore`] (the real impl, also in
/// this crate); the indirection exists only because Zig spells the path both
/// `Output.Source.Stdio.restore` and `Output.Stdio.restore`.
pub mod source {
    pub mod stdio {
        #[inline]
        pub fn restore() {
            crate::output::stdio::restore();
        }
    }
}

use crate::env as Environment;

// ──────────────────────────────────────────────────────────────────────────
// Thread-local source + global stream handles
// ──────────────────────────────────────────────────────────────────────────

// These are threadlocal so we don't have stdout/stderr writing on top of each other
thread_local! {
    static SOURCE: RefCell<Source> = const { RefCell::new(Source::ZEROED) };
    static SOURCE_SET: Cell<bool> = const { Cell::new(false) };
}

// These are not threadlocal so we avoid opening stdout/stderr for every thread
// Guarded by STDOUT_STREAM_SET (write-once at startup before threads).
static STDERR_STREAM: crate::RacyCell<StreamType> = crate::RacyCell::new(StreamType::ZEROED);
static STDOUT_STREAM: crate::RacyCell<StreamType> = crate::RacyCell::new(StreamType::ZEROED);
static STDOUT_STREAM_SET: AtomicBool = AtomicBool::new(false);

// Track which stdio descriptors are TTYs (0=stdin, 1=stdout, 2=stderr).
// `[AtomicI32; 3]` has identical layout to `[i32; 3]` (`AtomicI32` is
// `#[repr(C, align(4))]`), so the `#[no_mangle]` symbol is bit-compatible with
// the C declaration `int32_t bun_stdio_tty[3]`. Using atomics instead of
// `RacyCell` makes Rust-side reads/writes fully safe (cell-get reduction).
#[unsafe(no_mangle)]
pub static bun_stdio_tty: [AtomicI32; 3] =
    [AtomicI32::new(0), AtomicI32::new(0), AtomicI32::new(0)];

/// Read `bun_stdio_tty[idx]`. Written once at startup (in `Source::set_init` /
/// `bun_initialize_process`) before reader threads spawn, so `Relaxed` suffices.
#[inline]
fn stdio_tty_flag(idx: usize) -> bool {
    bun_stdio_tty[idx].load(Ordering::Relaxed) != 0
}

// TYPE_ONLY: bun_sys::Winsize → bun_core (move-in pass).
// `AtomicCell` because the SIGWINCH handler writes this from signal context
// while any thread may read it. `Winsize` is 4×u16 = 8 bytes, padding-free.
pub static TERMINAL_SIZE: crate::AtomicCell<crate::Winsize> =
    crate::AtomicCell::new(crate::Winsize {
        row: 0,
        col: 0,
        xpixel: 0,
        ypixel: 0,
    });

// ──────────────────────────────────────────────────────────────────────────
// Source
// ──────────────────────────────────────────────────────────────────────────

/// `Source.StreamType` — `File` on native, a fixed-buffer stream on WASM.
#[cfg(not(target_arch = "wasm32"))]
pub type StreamType = File;
#[cfg(target_arch = "wasm32")]
pub type StreamType = io::FixedBufferStream; // TODO(b0): FixedBufferStream arrives via bun_io→core move-in.

pub struct Source {
    pub stdout_buffer: [u8; 4096],
    pub stderr_buffer: [u8; 4096],
    pub buffered_stream_backing: QuietWriterAdapter,
    pub buffered_error_stream_backing: QuietWriterAdapter,
    // Self-referential: point into `*_backing.new_interface`. Replaced with accessor
    // methods in Rust; raw fields kept to mirror Zig field order.
    // (LIFETIMES.tsv: BORROW_FIELD — self-ref into buffered_*_backing)
    buffered_stream: *mut io::Writer,
    buffered_error_stream: *mut io::Writer,

    pub stream_backing: QuietWriterAdapter,
    pub error_stream_backing: QuietWriterAdapter,
    // Self-referential (BORROW_FIELD)
    stream: *mut io::Writer,
    error_stream: *mut io::Writer,

    pub raw_stream: StreamType,
    pub raw_error_stream: StreamType,
    // Zig: `[]u8 = &([_]u8{})` — borrowed WASM-mode write buffers, never freed by this
    // file. Not owned → raw fat ptr (BORROW_FIELD-style), not `Box<[u8]>`.
    pub out_buffer: *mut [u8],
    pub err_buffer: *mut [u8],
}

impl Source {
    // TODO(port): proper zero-init for QuietWriterAdapter / StreamType — currently relies on
    // `mem::zeroed()` which is only sound if those are `#[repr(C)]` POD with no
    // `NonNull`/`NonZero`/niche-enum fields. Hand-write `ZEROED`/`Default` once their
    // layouts are fixed in bun_sys.
    // SAFETY: byte arrays and raw `*mut` pointers are valid all-zero (null fat ptr =
    // `(null, 0)`); only read after `init()` overwrites every field. See TODO above for
    // the adapter/stream caveat.
    pub const ZEROED: Self = unsafe { crate::ffi::zeroed_unchecked() };

    /// Accessors replacing the self-referential `*std.Io.Writer` fields.
    #[inline]
    pub fn buffered_stream(&mut self) -> &mut io::Writer {
        self.buffered_stream_backing.new_interface()
    }
    #[inline]
    pub fn buffered_error_stream(&mut self) -> &mut io::Writer {
        self.buffered_error_stream_backing.new_interface()
    }
    #[inline]
    pub fn stream(&mut self) -> &mut io::Writer {
        self.stream_backing.new_interface()
    }
    #[inline]
    pub fn error_stream(&mut self) -> &mut io::Writer {
        self.error_stream_backing.new_interface()
    }

    // TODO(port): in-place init — `out` is the pre-allocated thread_local slot; PORTING.md
    // says keep `&mut MaybeUninit<Self>` (or reshape to `-> Self`) for out-param ctors.
    pub fn init(out: &mut Source, stream: StreamType, err_stream: StreamType) {
        // TODO(b2-blocked): bun_alloc::USE_MIMALLOC + mimalloc::Option::ShowErrors
        // are gated in bun_alloc; re-enable once bun_alloc/basic.rs is un-gated.

        if cfg!(debug_assertions) && bun_alloc::USE_MIMALLOC && !SOURCE_SET.get() {
            bun_alloc::mimalloc::mi_option_set(bun_alloc::mimalloc::Option::show_errors, 1);
        }
        SOURCE_SET.set(true);

        out.raw_stream = stream;
        out.raw_error_stream = err_stream;
        // stdout_buffer / stderr_buffer left uninitialized (overwritten by adapter writes)

        // PORT NOTE: reshaped for borrowck — the Zig wrote `out.* = .{ ...undefined... }`
        // then patched the self-referential pointers. In Rust we construct the backings
        // directly and expose accessors instead of storing interior pointers.
        out.buffered_stream_backing = out
            .raw_stream
            .quiet_writer()
            .adapt_to_new_api(&mut out.stdout_buffer);
        out.buffered_error_stream_backing = out
            .raw_error_stream
            .quiet_writer()
            .adapt_to_new_api(&mut out.stderr_buffer);
        out.buffered_stream = std::ptr::from_mut(out.buffered_stream_backing.new_interface());
        out.buffered_error_stream =
            std::ptr::from_mut(out.buffered_error_stream_backing.new_interface());

        out.stream_backing = out.raw_stream.quiet_writer().adapt_to_new_api(&mut []);
        out.error_stream_backing = out
            .raw_error_stream
            .quiet_writer()
            .adapt_to_new_api(&mut []);
        out.stream = std::ptr::from_mut(out.stream_backing.new_interface());
        out.error_stream = std::ptr::from_mut(out.error_stream_backing.new_interface());
    }

    pub fn configure_thread() {
        if SOURCE_SET.get() {
            return;
        }
        debug_assert!(STDOUT_STREAM_SET.load(Ordering::Relaxed));
        // SAFETY: STDOUT_STREAM/STDERR_STREAM are write-once before any thread calls this.
        SOURCE.with_borrow_mut(|s| unsafe {
            Source::init(s, STDOUT_STREAM.read(), STDERR_STREAM.read())
        });
        crate::StackCheck::configure_thread();
    }

    pub fn configure_named_thread(name: &crate::ZStr) {
        Global::set_thread_name(name);
        Self::configure_thread();
    }

    /// Like [`configure_thread`] but **skips** the JSC `StackCheck` FFI call
    /// (`Bun__StackCheck__initialize` → `WTF::StackBounds::currentThreadStackBoundsInternal`).
    ///
    /// Use on pure-Rust worker threads (ThreadPool workers, HTTP client,
    /// watchers) that never execute JavaScript. On the `bun install` cold path
    /// the WTF/JSC `.text` pages backing those C++ symbols sit ~6 pages across
    /// three otherwise-untouched 64 KB blocks; faulting them in from every
    /// worker is pure overhead when no JS will ever run on that thread.
    ///
    /// Threads that *may* run JS (web workers, debugger, the main VM thread)
    /// must keep using [`configure_thread`] / [`configure_named_thread`].
    pub fn configure_thread_no_js() {
        if SOURCE_SET.get() {
            return;
        }
        debug_assert!(STDOUT_STREAM_SET.load(Ordering::Relaxed));
        // SAFETY: STDOUT_STREAM/STDERR_STREAM are write-once before any thread calls this.
        SOURCE.with_borrow_mut(|s| unsafe {
            Source::init(s, STDOUT_STREAM.read(), STDERR_STREAM.read())
        });
        // Intentionally NOT calling `crate::StackCheck::configure_thread()`.
    }

    /// Named variant of [`configure_thread_no_js`].
    pub fn configure_named_thread_no_js(name: &crate::ZStr) {
        Global::set_thread_name(name);
        Self::configure_thread_no_js();
    }

    pub fn is_no_color() -> bool {
        // Zig output.zig:99 — parsed bool, default false. NO_COLOR=0 → false.
        env_var::NO_COLOR.get().unwrap_or(false)
    }

    pub fn get_force_color_depth() -> Option<ColorDepth> {
        let force_color = env_var::FORCE_COLOR.get()?;
        // Supported by Node.js, if set will ignore NO_COLOR.
        // - "0" to indicate no color support
        // - "1", "true", or "" to indicate 16-color support
        // - "2" to indicate 256-color support
        // - "3" to indicate 16 million-color support
        Some(match force_color {
            0 => ColorDepth::None,
            1 => ColorDepth::C16,
            2 => ColorDepth::C256,
            _ => ColorDepth::C16m,
        })
    }

    pub fn is_force_color() -> bool {
        Self::get_force_color_depth().unwrap_or(ColorDepth::None) != ColorDepth::None
    }

    pub fn is_color_terminal() -> bool {
        #[cfg(windows)]
        {
            // https://github.com/chalk/supports-color/blob/d4f413efaf8da045c5ab440ed418ef02dbb28bf1/index.js#L100C11-L112
            // Windows 10 build 10586 is the first Windows release that supports 256 colors.
            // Windows 10 build 14931 is the first release that supports 16m/TrueColor.
            // Every other version supports 16 colors.
            return true;
        }
        #[cfg(not(windows))]
        {
            Self::color_depth() != ColorDepth::None
        }
    }

    pub fn color_depth() -> ColorDepth {
        *LAZY_COLOR_DEPTH.get_or_init(compute_color_depth)
    }

    pub fn set_init(stdout: StreamType, stderr: StreamType) {
        SOURCE.with_borrow_mut(|s| Source::init(s, stdout, stderr));

        SOURCE_SET.set(true);
        if !STDOUT_STREAM_SET.load(Ordering::Relaxed) {
            STDOUT_STREAM_SET.store(true, Ordering::Relaxed);
            #[cfg(not(target_arch = "wasm32"))]
            {
                let is_stdout_tty = stdio_tty_flag(1);
                if is_stdout_tty {
                    let _ = STDOUT_DESCRIPTOR_TYPE.set(OutputStreamDescriptor::Terminal);
                }

                let is_stderr_tty = stdio_tty_flag(2);
                if is_stderr_tty {
                    let _ = STDERR_DESCRIPTOR_TYPE.set(OutputStreamDescriptor::Terminal);
                }

                let mut enable_color: Option<bool> = None;
                if Self::is_force_color() {
                    enable_color = Some(true);
                } else if Self::is_no_color() {
                    enable_color = Some(false);
                } else if Self::is_color_terminal() && (is_stdout_tty || is_stderr_tty) {
                    enable_color = Some(true);
                }

                ENABLE_ANSI_COLORS_STDOUT
                    .store(enable_color.unwrap_or(is_stdout_tty), Ordering::Relaxed);
                ENABLE_ANSI_COLORS_STDERR
                    .store(enable_color.unwrap_or(is_stderr_tty), Ordering::Relaxed);
            }

            // SAFETY: write-once init guarded by STDOUT_STREAM_SET above.
            unsafe {
                STDOUT_STREAM.write(stdout);
                STDERR_STREAM.write(stderr);
            }
        }
    }
}

// ── Source::WindowsStdio ──────────────────────────────────────────────────

#[cfg(windows)]
pub mod windows_stdio {
    use super::*;
    // MOVE_DOWN: bun_sys::windows → crate::windows_sys (T0 leaf shim).
    use crate::windows_sys as w;
    use crate::windows_sys::kernel32 as c;

    // `HANDLE` is an opaque kernel handle (kernel32 validates and returns 0 on
    // a non-console handle); `&mut DWORD` is ABI-identical to `LPDWORD` (thin
    // non-null pointer). The reference type encodes the only pointer-validity
    // precondition, so `safe fn` discharges the link-time proof. (`c::Get/Set
    // ConsoleMode` from `bun_windows_sys` still take `*mut DWORD`; redeclared
    // locally so the startup/restore paths below are plain calls.)
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn GetConsoleMode(hConsoleHandle: w::HANDLE, lpMode: &mut w::DWORD) -> w::BOOL;
        safe fn SetConsoleMode(hConsoleHandle: w::HANDLE, dwMode: w::DWORD) -> w::BOOL;
    }

    /// At program start, we snapshot the console modes of standard in, out, and err
    /// so that we can restore them at program exit if they change. Restoration is
    /// best-effort, and may not be applied if the process is killed abruptly.
    ///
    /// Write-once at startup → `Once`, not `RacyCell`: `init()` builds the
    /// snapshot locally and `.set()`s it; `restore()` reads via `.get()`. Both
    /// sides are fully safe (cell-get reduction).
    pub static CONSOLE_MODE: crate::Once<[Option<u32>; 3]> = crate::Once::new();
    pub static CONSOLE_CODEPAGE: core::sync::atomic::AtomicU32 =
        core::sync::atomic::AtomicU32::new(0);
    pub static CONSOLE_OUTPUT_CODEPAGE: core::sync::atomic::AtomicU32 =
        core::sync::atomic::AtomicU32::new(0);

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__restoreWindowsStdio() {
        restore();
    }

    pub fn restore() {
        // SAFETY: PEB access is sound on Windows; handles are valid for process
        // lifetime. `peb()` returns a raw pointer because the OS/CRT mutate the
        // PEB out-of-band (`SetStdHandle`, …), so we must not materialize a
        // long-lived `&` — read the handle fields through raw-pointer deref.
        let (stdin, stdout, stderr) = unsafe {
            let pp = (*w::peb()).ProcessParameters;
            ((*pp).hStdInput, (*pp).hStdOutput, (*pp).hStdError)
        };

        let handles = [stdin, stdout, stderr];
        let modes = CONSOLE_MODE.get().copied().unwrap_or([None; 3]);
        for (mode, handle) in modes.iter().zip(handles.iter()) {
            if let Some(m) = *mode {
                let _ = SetConsoleMode(*handle, m);
            }
        }

        let out_cp = CONSOLE_OUTPUT_CODEPAGE.load(Ordering::Relaxed);
        let in_cp = CONSOLE_CODEPAGE.load(Ordering::Relaxed);
        if out_cp != 0 {
            let _ = c::SetConsoleOutputCP(out_cp);
        }
        if in_cp != 0 {
            let _ = c::SetConsoleCP(in_cp);
        }
    }

    pub fn init() {
        w::libuv::uv_disable_stdio_inheritance();

        let stdin = w::GetStdHandle(w::STD_INPUT_HANDLE).unwrap_or(w::INVALID_HANDLE_VALUE);
        let stdout = w::GetStdHandle(w::STD_OUTPUT_HANDLE).unwrap_or(w::INVALID_HANDLE_VALUE);
        let stderr = w::GetStdHandle(w::STD_ERROR_HANDLE).unwrap_or(w::INVALID_HANDLE_VALUE);

        // MOVE_DOWN: bun_sys::fd → bun_core (move-in pass).
        use crate::fd as fd_internals;
        let invalid = w::INVALID_HANDLE_VALUE;
        // Single-threaded startup; these statics are write-once caches.
        let _ = fd_internals::WINDOWS_CACHED_STDERR.set(if stderr != invalid {
            Fd::from_system(stderr)
        } else {
            Fd::INVALID
        });
        let _ = fd_internals::WINDOWS_CACHED_STDOUT.set(if stdout != invalid {
            Fd::from_system(stdout)
        } else {
            Fd::INVALID
        });
        let _ = fd_internals::WINDOWS_CACHED_STDIN.set(if stdin != invalid {
            Fd::from_system(stdin)
        } else {
            Fd::INVALID
        });
        #[cfg(debug_assertions)]
        fd_internals::WINDOWS_CACHED_FD_SET.store(true, Ordering::Relaxed);

        // SAFETY: BUFFERED_STDIN is a static initialized at startup before use.
        unsafe {
            (*BUFFERED_STDIN.get()).fd = Fd::stdin();
        }

        // https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp
        const CP_UTF8: u32 = 65001;
        CONSOLE_OUTPUT_CODEPAGE.store(c::GetConsoleOutputCP(), Ordering::Relaxed);
        let _ = c::SetConsoleOutputCP(CP_UTF8);

        CONSOLE_CODEPAGE.store(c::GetConsoleCP(), Ordering::Relaxed);
        let _ = c::SetConsoleCP(CP_UTF8);

        let mut mode: w::DWORD = 0;
        // Build the snapshot locally, then publish via `Once::set` — no
        // long-lived `&mut` into a shared static (cell-get reduction).
        let mut console_mode: [Option<u32>; 3] = [None; 3];
        if GetConsoleMode(stdin, &mut mode) != 0 {
            console_mode[0] = Some(mode);
            bun_stdio_tty[0].store(1, Ordering::Relaxed);
            // There are no flags to set on standard in, but just in case something
            // later modifies the mode, we can still reset it at the end of program run
            //
            // In the past, Bun would set ENABLE_VIRTUAL_TERMINAL_INPUT, which was not
            // intentionally set for any purpose, and instead only caused problems.
        }

        if GetConsoleMode(stdout, &mut mode) != 0 {
            console_mode[1] = Some(mode);
            bun_stdio_tty[1].store(1, Ordering::Relaxed);
            let _ = SetConsoleMode(
                stdout,
                w::ENABLE_PROCESSED_OUTPUT
                    | w::ENABLE_VIRTUAL_TERMINAL_PROCESSING
                    | w::ENABLE_WRAP_AT_EOL_OUTPUT
                    | mode,
            );
        }

        if GetConsoleMode(stderr, &mut mode) != 0 {
            console_mode[2] = Some(mode);
            bun_stdio_tty[2].store(1, Ordering::Relaxed);
            let _ = SetConsoleMode(
                stderr,
                w::ENABLE_PROCESSED_OUTPUT
                    | w::ENABLE_VIRTUAL_TERMINAL_PROCESSING
                    | w::ENABLE_WRAP_AT_EOL_OUTPUT
                    | mode,
            );
        }
        let _ = CONSOLE_MODE.set(console_mode);
    }
}

// ── Source::Stdio ─────────────────────────────────────────────────────────

pub mod stdio {
    use super::*;

    // TODO(port): move to bun_core_sys
    unsafe extern "C" {
        // Written once by C at process startup before threads; Rust only reads.
        // `[AtomicI32; 3]` has identical layout to C's `int32_t[3]` (`AtomicI32`
        // is `#[repr(C, align(4))]`) and, unlike a plain non-`mut` extern static,
        // does not assert immutability to the optimizer. `safe static` (Rust
        // 2024 `unsafe extern`) discharges the link-time existence proof here so
        // readers need no `unsafe` (cell-get reduction).
        pub safe static bun_is_stdio_null: [AtomicI32; 3];
        /// No preconditions; one-shot stdio fixup at process startup.
        pub safe fn bun_initialize_process();
        /// No preconditions; restores TTY state on the standard streams.
        pub safe fn bun_restore_stdio();
    }

    /// Read `bun_is_stdio_null[idx]`. Written once by C
    /// (`bun_initialize_process`) at startup before threads, so `Relaxed`
    /// suffices.
    #[inline]
    fn stdio_null_flag(idx: usize) -> bool {
        bun_is_stdio_null[idx].load(Ordering::Relaxed) == 1
    }

    pub fn is_stderr_null() -> bool {
        stdio_null_flag(2)
    }
    pub fn is_stdout_null() -> bool {
        stdio_null_flag(1)
    }
    pub fn is_stdin_null() -> bool {
        stdio_null_flag(0)
    }

    pub fn init() {
        bun_initialize_process();

        #[cfg(windows)]
        super::windows_stdio::init();

        let stdout = File::from(Fd::stdout());
        let stderr = File::from(Fd::stderr());

        Source::set_init(stdout, stderr);

        if cfg!(debug_assertions) || Environment::ENABLE_LOGS {
            init_scoped_debug_writer_at_startup();
        }
    }

    pub fn restore() {
        #[cfg(windows)]
        {
            super::windows_stdio::restore();
        }
        #[cfg(not(windows))]
        {
            bun_restore_stdio();
        }
    }
}

// ── ColorDepth ────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ColorDepth {
    None,
    C16,
    C256,
    C16m,
}

static LAZY_COLOR_DEPTH: crate::Once<ColorDepth> = crate::Once::new();

fn compute_color_depth() -> ColorDepth {
    if let Some(depth) = Source::get_force_color_depth() {
        return depth;
    }

    if Source::is_no_color() {
        return ColorDepth::None;
    }

    let term = env_var::TERM.get().unwrap_or(b"");
    if term == b"dumb" {
        return ColorDepth::None;
    }

    if env_var::TMUX.get().is_some() {
        return ColorDepth::C256;
    }

    if env_var::CI.get().is_some() {
        return ColorDepth::C16;
    }

    if let Some(term_program) = env_var::TERM_PROGRAM.get() {
        const USE_16M: [&[u8]; 5] = [
            b"ghostty",
            b"MacTerm",
            b"WezTerm",
            b"HyperTerm",
            b"iTerm.app",
        ];
        for program in USE_16M {
            if term_program == program {
                return ColorDepth::C16m;
            }
        }
    }

    let mut has_color_term_set = false;

    if let Some(color_term) = env_var::COLORTERM.get() {
        if color_term == b"truecolor" || color_term == b"24bit" {
            return ColorDepth::C16m;
        }
        has_color_term_set = true;
    }

    if !term.is_empty() {
        if term.starts_with(b"xterm-256") {
            return ColorDepth::C256;
        }
        const PAIRS: [(&[u8], ColorDepth); 17] = [
            (b"st", ColorDepth::C16),
            (b"hurd", ColorDepth::C16),
            (b"eterm", ColorDepth::C16),
            (b"gnome", ColorDepth::C16),
            (b"kterm", ColorDepth::C16),
            (b"mosh", ColorDepth::C16m),
            (b"putty", ColorDepth::C16),
            (b"cons25", ColorDepth::C16),
            (b"cygwin", ColorDepth::C16),
            (b"dtterm", ColorDepth::C16),
            (b"mlterm", ColorDepth::C16),
            (b"console", ColorDepth::C16),
            (b"jfbterm", ColorDepth::C16),
            (b"konsole", ColorDepth::C16),
            (b"terminator", ColorDepth::C16m),
            (b"xterm-ghostty", ColorDepth::C16m),
            (b"rxvt-unicode-24bit", ColorDepth::C16m),
        ];
        for (name, depth) in PAIRS {
            if term == name {
                return depth;
            }
        }

        if strings::includes(term, b"con")
            || strings::includes(term, b"ansi")
            || strings::includes(term, b"rxvt")
            || strings::includes(term, b"color")
            || strings::includes(term, b"linux")
            || strings::includes(term, b"vt100")
            || strings::includes(term, b"xterm")
            || strings::includes(term, b"screen")
        {
            return ColorDepth::C16;
        }
    }

    if has_color_term_set {
        return ColorDepth::C16;
    }

    ColorDepth::None
}

// ──────────────────────────────────────────────────────────────────────────
// Module-level state
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum OutputStreamDescriptor {
    Unknown,
    // File,
    // Pipe,
    Terminal,
}

#[deprecated(
    note = "Deprecated to prevent accidentally using the wrong one. Use enable_ansi_colors_stdout or enable_ansi_colors_stderr instead."
)]
pub const ENABLE_ANSI_COLORS: () = ();

pub static ENABLE_ANSI_COLORS_STDERR: AtomicBool = AtomicBool::new(Environment::IS_NATIVE);
pub static ENABLE_ANSI_COLORS_STDOUT: AtomicBool = AtomicBool::new(Environment::IS_NATIVE);
pub static ENABLE_BUFFERING: AtomicBool = AtomicBool::new(Environment::IS_NATIVE);
pub static IS_VERBOSE: AtomicBool = AtomicBool::new(false);
pub static IS_GITHUB_ACTION: AtomicBool = AtomicBool::new(false);

pub static STDERR_DESCRIPTOR_TYPE: crate::Once<OutputStreamDescriptor> = crate::Once::new();
pub static STDOUT_DESCRIPTOR_TYPE: crate::Once<OutputStreamDescriptor> = crate::Once::new();

/// Downstream alias (Zig: `Output.OutputStreamDescriptor`). Several call sites
/// refer to it as `Output::DescriptorType` for brevity.
pub type DescriptorType = OutputStreamDescriptor;

/// Safe getter (Zig: `Output.stderr_descriptor_type`).
#[inline]
pub fn stderr_descriptor_type() -> OutputStreamDescriptor {
    STDERR_DESCRIPTOR_TYPE
        .get()
        .copied()
        .unwrap_or(OutputStreamDescriptor::Unknown)
}
/// Safe getter (Zig: `Output.stdout_descriptor_type`).
#[inline]
pub fn stdout_descriptor_type() -> OutputStreamDescriptor {
    STDOUT_DESCRIPTOR_TYPE
        .get()
        .copied()
        .unwrap_or(OutputStreamDescriptor::Unknown)
}

#[inline]
pub fn is_stdout_tty() -> bool {
    stdio_tty_flag(1)
}
#[inline]
pub fn is_stderr_tty() -> bool {
    stdio_tty_flag(2)
}
#[inline]
pub fn is_stdin_tty() -> bool {
    stdio_tty_flag(0)
}

pub fn is_github_action() -> bool {
    if env_var::GITHUB_ACTIONS.get().unwrap_or(false) {
        // Do not print github annotations for AI agents because that wastes the context window.
        return !is_ai_agent();
    }
    false
}

pub fn is_ai_agent() -> bool {
    static VALUE: AtomicBool = AtomicBool::new(false);
    static ONCE: std::sync::Once = std::sync::Once::new();

    fn evaluate() -> bool {
        if let Some(env) = env_var::AGENT.get() {
            return env == b"1";
        }
        if is_verbose() {
            return false;
        }
        // Claude Code.
        if env_var::CLAUDECODE.get().unwrap_or(false) {
            return true;
        }
        // Replit.
        if env_var::REPL_ID.get().unwrap_or(false) {
            return true;
        }
        // TODO: add environment variable for Gemini
        // Gemini does not appear to add any environment variables to identify it.

        // TODO: add environment variable for Codex
        // codex does not appear to add any environment variables to identify it.

        // TODO: add environment variable for Cursor Background Agents
        // cursor does not appear to add any environment variables to identify it.
        false
    }

    ONCE.call_once(|| VALUE.store(evaluate(), Ordering::Relaxed));
    VALUE.load(Ordering::Relaxed)
}

// (IS_VERBOSE defined above at L887; ungate exposed a duplicate.)

pub fn set_is_verbose(verbose: bool) {
    IS_VERBOSE.store(verbose, Ordering::Relaxed);
}

pub fn is_verbose() -> bool {
    // Set by Github Actions when a workflow is run using debug mode.
    IS_VERBOSE.load(Ordering::Relaxed) || env_var::RUNNER_DEBUG.get().unwrap_or(false)
}

pub fn enable_buffering() {
    if Environment::IS_NATIVE {
        ENABLE_BUFFERING.store(true, Ordering::Relaxed);
    }
}

pub struct EnableBufferingScope {
    prev_buffering: bool,
}

impl EnableBufferingScope {
    pub fn init() -> EnableBufferingScope {
        let prev_buffering = ENABLE_BUFFERING.load(Ordering::Relaxed);
        ENABLE_BUFFERING.store(true, Ordering::Relaxed);
        EnableBufferingScope { prev_buffering }
    }
}

impl Drop for EnableBufferingScope {
    /// Does not call Output.flush().
    fn drop(&mut self) {
        ENABLE_BUFFERING.store(self.prev_buffering, Ordering::Relaxed);
    }
}

pub fn enable_buffering_scope() -> EnableBufferingScope {
    EnableBufferingScope::init()
}

pub fn disable_buffering() {
    flush();
    if Environment::IS_NATIVE {
        ENABLE_BUFFERING.store(false, Ordering::Relaxed);
    }
}

/// RAII: `disable_buffering()` now, `enable_buffering()` on drop. Covers the
/// Zig `Output.disableBuffering(); defer Output.enableBuffering();` pair used
/// around child-process exec where the child writes directly to inherited
/// stdio and Bun's buffer must not interleave.
#[must_use = "dropping immediately re-enables buffering; bind to `let _scope = ...`"]
pub struct DisableBufferingScope(());

impl DisableBufferingScope {
    pub fn init() -> DisableBufferingScope {
        disable_buffering();
        DisableBufferingScope(())
    }
}

impl Drop for DisableBufferingScope {
    fn drop(&mut self) {
        enable_buffering();
    }
}

pub fn disable_buffering_scope() -> DisableBufferingScope {
    DisableBufferingScope::init()
}

#[cold]
pub fn panic(args: fmt::Arguments<'_>) -> ! {
    // PORT NOTE: Zig branched on enable_ansi_colors_stderr to pick the comptime-colored
    // vs stripped format string. In Rust callers use `panic!(pretty_fmt!(...))` directly;
    // this fn is kept for non-macro callers and writes the (already-formatted) args.
    if ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed) {
        core::panic!("{args}");
    } else {
        core::panic!("{args}");
    }
    // TODO(port): callers must wrap fmt in `pretty_fmt!(.., enable_ansi_colors_stderr)`
}

pub type WriterType = QuietWriter;

pub fn raw_error_writer() -> StreamType {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow(|s| s.raw_error_stream)
}

// TODO: investigate migrating this to the buffered one.
//
// TODO(port): these accessors hand out a `&'static mut` to a thread-local
// `Source` field. The Zig original returned `*Writer` and callers used it
// briefly. Returning `&'static mut` is *unsound* if two are alive at once, but
// matches the Zig contract until callers migrate to `with_error_writer(|w| ..)`.
//
// `source_writer_escape` centralises the escape: one `unsafe` for all five
// public `*_writer*()` accessors (nonnull-asref reduction: 5 sites → 1).
#[inline]
fn source_writer_escape(project: fn(&mut Source) -> &mut io::Writer) -> &'static mut io::Writer {
    debug_assert!(SOURCE_SET.get());
    let p: *mut io::Writer = SOURCE.with_borrow_mut(|s| std::ptr::from_mut(project(s)));
    // SAFETY: pointer escapes the RefCell borrow; the thread-local `Source`
    // backing field has a stable address once `Source::init` has run, and the
    // returned `&'static mut` is used briefly with no two live at once (see
    // TODO(port) above — known-unsound shim until callers migrate).
    unsafe { &mut *p }
}

#[allow(clippy::mut_from_ref)]
pub fn error_writer() -> &'static mut io::Writer {
    source_writer_escape(Source::error_stream)
}

pub fn error_writer_buffered() -> &'static mut io::Writer {
    source_writer_escape(Source::buffered_error_stream)
}

// TODO: investigate returning the buffered_error_stream
pub fn error_stream() -> &'static mut io::Writer {
    source_writer_escape(Source::error_stream)
}

pub fn raw_writer() -> StreamType {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow(|s| s.raw_stream)
}

pub fn writer() -> &'static mut io::Writer {
    source_writer_escape(Source::stream)
}

pub fn writer_buffered() -> &'static mut io::Writer {
    source_writer_escape(Source::buffered_stream)
}

pub fn reset_terminal() {
    let stderr = ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed);
    let stdout = ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed);
    if !stderr && !stdout {
        return;
    }
    SOURCE.with_borrow_mut(|s| {
        if stderr {
            let _ = s.error_stream().write_all(b"\x1B[2J\x1B[3J\x1B[H");
        } else {
            let _ = s.stream().write_all(b"\x1B[2J\x1B[3J\x1B[H");
        }
    });
}

pub fn reset_terminal_all() {
    SOURCE.with_borrow_mut(|s| {
        if ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed) {
            let _ = s.error_stream().write_all(b"\x1B[2J\x1B[3J\x1B[H");
        }
        if ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed) {
            let _ = s.stream().write_all(b"\x1B[2J\x1B[3J\x1B[H");
        }
    });
}

/// Write buffered stdout & stderr to the terminal.
/// Must be called before the process exits or the buffered output will be lost.
/// Bun automatically calls this function in Global.exit().
pub fn flush() {
    if Environment::IS_NATIVE && SOURCE_SET.get() {
        // Same re-entrancy hazard as with_dest_writer: drop the RefCell borrow
        // before calling into the writer so a flush triggered from inside a
        // print (or vice-versa) doesn't BorrowMutError.
        let (bs, bes): (*mut io::Writer, *mut io::Writer) = SOURCE.with_borrow_mut(|s| {
            (
                std::ptr::from_mut::<io::Writer>(s.buffered_stream()),
                std::ptr::from_mut::<io::Writer>(s.buffered_error_stream()),
            )
        });
        // SAFETY: see with_dest_writer — pointers target thread-local backing
        // fields with stable addresses once Source::init has run. We call the
        // vtable fn pointer directly with the raw `*mut` (no `&mut Writer`
        // formed) so a re-entrant print/flush from inside the drain cannot
        // alias an outstanding exclusive borrow.
        unsafe {
            let _ = ((*bs).flush)(bs);
            let _ = ((*bes).flush)(bes);
        }
        // let _ = s.stream().flush();
        // let _ = s.error_stream().flush();
    }
}

/// RAII guard that calls [`flush`] on `Drop`.
///
/// This is the Rust spelling of Zig's `defer Output.flush();` — hold one of
/// these across a scope with early returns to guarantee buffered stdout/stderr
/// is drained on every exit path.
#[must_use = "FlushGuard flushes on Drop; binding to `_` drops it immediately"]
pub struct FlushGuard(());

impl Drop for FlushGuard {
    #[inline]
    fn drop(&mut self) {
        flush();
    }
}

/// Returns a guard that flushes buffered stdout & stderr when it goes out of
/// scope. Equivalent to Zig's `defer Output.flush();`.
#[inline]
pub fn flush_guard() -> FlushGuard {
    FlushGuard(())
}

// ──────────────────────────────────────────────────────────────────────────
// ElapsedFormatter
// ──────────────────────────────────────────────────────────────────────────

pub struct ElapsedFormatter {
    pub colors: bool,
    pub duration_ns: u64,
}

impl Default for ElapsedFormatter {
    fn default() -> Self {
        Self {
            colors: false,
            duration_ns: 0,
        }
    }
}

impl fmt::Display for ElapsedFormatter {
    fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        use crate::time::NS_PER_MS;
        const FAST: u64 = NS_PER_MS * 10;
        const SLOW: u64 = NS_PER_MS * 8_000;
        let ms = self.duration_ns as f64 / NS_PER_MS as f64;
        // PERF(port): was comptime bool dispatch on `colors` — profile in Phase B
        match self.duration_ns {
            0..=FAST => {
                if self.colors {
                    write!(w, pretty_fmt!("<r><d>[{:>.2}ms<r><d>]<r>", true), ms)
                } else {
                    write!(w, pretty_fmt!("<r><d>[{:>.2}ms<r><d>]<r>", false), ms)
                }
            }
            SLOW..=u64::MAX => {
                if self.colors {
                    write!(
                        w,
                        pretty_fmt!("<r><d>[<r><yellow>{:>.2}ms<r><d>]<r>", true),
                        ms
                    )
                } else {
                    write!(
                        w,
                        pretty_fmt!("<r><d>[<r><yellow>{:>.2}ms<r><d>]<r>", false),
                        ms
                    )
                }
            }
            _ => {
                if self.colors {
                    write!(w, pretty_fmt!("<r><d>[<b>{:>.2}ms<r><d>]<r>", true), ms)
                } else {
                    write!(w, pretty_fmt!("<r><d>[<b>{:>.2}ms<r><d>]<r>", false), ms)
                }
            }
        }
    }
}

// PORT NOTE: Zig's `printElapsedToWithCtx` passed the raw `<r><d>[...]<r>`
// template to a `(comptime fmt, args)` printer (`prettyError`/`pretty`), which
// then routed through `prettyTo` to branch on `enable_ansi_colors_{stdout,stderr}`.
// In Rust the `pretty_fmt!` rewrite must happen at the macro call site, so the
// public entry points (`print_elapsed`/`print_elapsed_stdout` below) inline the
// match and call `pretty_error!`/`pretty!` directly — those macros emit both the
// colored and stripped variants and let `pretty_to` pick at runtime. The
// intermediate helper had no way to defer the color/no-color choice without
// leaking raw `\x1b[` escapes when colors are disabled, so it was removed.

// `print_elapsed_to` intentionally removed — see PORT NOTE above. The colored
// template can't be deferred through an `fmt::Arguments`-taking printer without
// either leaking raw escapes or stripping color, so callers must use
// `print_elapsed` / `print_elapsed_stdout` (or `ElapsedFormatter` directly).

pub fn print_elapsed(elapsed: f64) {
    match elapsed.round() as i64 {
        0..=1500 => pretty_error!("<r><d>[<b>{:>.2}ms<r><d>]<r>", elapsed),
        _ => pretty_error!("<r><d>[<b>{:>.2}s<r><d>]<r>", elapsed / 1000.0),
    }
}

pub fn print_elapsed_stdout(elapsed: f64) {
    match elapsed.round() as i64 {
        0..=1500 => pretty!("<r><d>[<b>{:>.2}ms<r><d>]<r>", elapsed),
        _ => pretty!("<r><d>[<b>{:>.2}s<r><d>]<r>", elapsed / 1000.0),
    }
}

pub fn print_elapsed_stdout_trim(elapsed: f64) {
    match elapsed.round() as i64 {
        0..=1500 => pretty!("<r><d>[<b>{:>}ms<r><d>]<r>", elapsed),
        _ => pretty!("<r><d>[<b>{:>}s<r><d>]<r>", elapsed / 1000.0),
    }
}

pub fn print_start_end(start: i128, end: i128) {
    let elapsed = ((end - start) as i64) / crate::time::NS_PER_MS as i64;
    print_elapsed(elapsed as f64);
}

pub fn print_start_end_stdout(start: i128, end: i128) {
    let elapsed = ((end - start) as i64) / crate::time::NS_PER_MS as i64;
    print_elapsed_stdout(elapsed as f64);
}

/// Minimal timer abstraction so bun_core doesn't depend on bun_perf.
/// bun_perf::SystemTimer impls this (move-in pass).
pub trait ReadTimer {
    fn read(&mut self) -> u64;
}

pub fn print_timer(timer: &mut impl ReadTimer) {
    #[cfg(target_arch = "wasm32")]
    {
        return;
    }
    let elapsed = timer.read() / crate::time::NS_PER_MS;
    print_elapsed(elapsed as f64);
}

// ──────────────────────────────────────────────────────────────────────────
// Print routing
//
// `print` / `printError` / `pretty*` are called from thousands of sites with
// distinct comptime format strings. They used to be `noinline`, which forced
// one ~400-byte function body per (fmt, args-type) pair — about 2,650 of them,
// or ~1 MB of .text in release builds. The bodies were nearly identical: pick
// buffered-vs-unbuffered writer, then `Writer.print(fmt, args)`.
//
// Now the public entry points are `inline` and bottom out in two non-generic
// helpers (`destWriter`, `writeBytes`). The only per-call-site code is either
// a `writeBytes` call (when `args` is empty — ~40% of sites) or one
// `Writer.print` call. The buffering branch lives in `destWriter` so each
// site formats once instead of twice.
// ──────────────────────────────────────────────────────────────────────────

/// Pick the active writer for `dest`, honoring `enable_buffering`. Non-generic
/// so the buffering branch isn't duplicated into every call site.
///
/// Hands `f` a **raw** `*mut io::Writer`, not a `&mut`. `f` may call into
/// `write_fmt`, which evaluates user `Display` impls that can re-enter this
/// module (e.g. `debug_warn` → `print_to`, or `flush()`). If we materialized a
/// `&mut io::Writer` here, the re-entrant call would produce a second `&mut`
/// aliasing the first while it is still live — UB. Zig's `destWriter()`
/// (output.zig:731-737) returns a raw `*std.Io.Writer` with no exclusivity
/// contract, so callers must do the same and route writes through the vtable
/// fn pointers directly (see `write_fmt_raw`).
#[inline(never)]
fn with_dest_writer<R>(dest: Destination, f: impl FnOnce(*mut io::Writer) -> R) -> R {
    debug_assert!(SOURCE_SET.get());
    let buffering = ENABLE_BUFFERING.load(Ordering::Relaxed);
    // Load the writer pointer and *drop the RefCell borrow* before invoking `f`;
    // holding the `with_borrow_mut` guard across re-entry panics with BorrowMutError.
    let w: *mut io::Writer = SOURCE.with_borrow_mut(|s| match dest {
        Destination::Stdout => std::ptr::from_mut(
            (if buffering {
                s.buffered_stream()
            } else {
                s.stream()
            }),
        ),
        Destination::Stderr => std::ptr::from_mut(
            (if buffering {
                s.buffered_error_stream()
            } else {
                s.error_stream()
            }),
        ),
    });
    // SAFETY: `w` points into a `QuietWriterAdapter` field of the thread-local
    // `Source`, whose address is stable for the thread's lifetime once
    // `Source::init` has run (asserted via SOURCE_SET above). These same raw
    // pointers are already cached on `Source.{stream,error_stream,...}` and
    // handed out by `writer()`/`error_writer()` — this is the established
    // self-referential pattern, not a lifetime extension of borrowed data.
    // We pass the raw pointer through unchanged; `f` is responsible for not
    // forming a `&mut` that outlives a single non-reentrant vtable call.
    f(w)
}

/// Write `args` through a raw `*mut io::Writer` without ever forming a
/// `&mut io::Writer`, so re-entrant writes from inside `Display` impls don't
/// alias an outstanding exclusive borrow.
///
/// SAFETY: `w` must point to a live `io::Writer` for the duration of the call
/// (guaranteed by `with_dest_writer`'s thread-local-stability invariant).
unsafe fn write_fmt_raw(w: *mut io::Writer, args: fmt::Arguments<'_>) {
    struct Raw(*mut io::Writer);
    impl fmt::Write for Raw {
        fn write_str(&mut self, s: &str) -> fmt::Result {
            // SAFETY: `self.0` is the `w` passed to `write_fmt_raw`, valid per
            // the caller's contract. We read the `write_all` vtable fn pointer
            // via raw-pointer field projection (no intermediate `&`/`&mut`
            // Writer) and call it with the raw `*mut` — any re-entrant write
            // sees only another raw pointer, never an aliased `&mut`.
            unsafe {
                let f = (*self.0).write_all;
                let _ = f(self.0, s.as_bytes());
            }
            Ok(())
        }
    }
    let _ = fmt::Write::write_fmt(&mut Raw(w), args);
}

/// Single shared write path for pre-formatted bytes.
#[inline(never)]
fn write_bytes(dest: Destination, bytes: &[u8]) {
    with_dest_writer(dest, |w| {
        // SAFETY: `w` is valid per `with_dest_writer`; call the vtable fn
        // directly with the raw pointer so no `&mut Writer` is formed.
        unsafe {
            let f = (*w).write_all;
            let _ = f(w, bytes);
        }
    });
}

#[inline]
pub fn print_to(dest: Destination, args: fmt::Arguments<'_>) {
    #[cfg(target_arch = "wasm32")]
    {
        // TODO(port): wasm console_log/console_error path via root.Uint8Array
        let _ = (dest, args);
        return;
    }
    // PERF(port): Zig had a comptime `hasNoArgs` fast path that emitted a single
    // `writeBytes(dest, comptime_str)` per call site. `fmt::Arguments::as_str()` returns
    // Some only when there are no interpolations, so this preserves the optimization.
    if let Some(s) = args.as_str() {
        return write_bytes(dest, s.as_bytes());
    }
    // There's not much we can do if this errors. Especially if it's something like BrokenPipe.
    with_dest_writer(dest, |w| {
        // SAFETY: `w` is valid per `with_dest_writer`; `write_fmt_raw` routes
        // through the vtable without forming a `&mut Writer`, so `Display`
        // impls that re-enter `print_to`/`flush` cannot alias.
        unsafe { write_fmt_raw(w, args) };
    });
}

#[inline]
pub fn print_errorable(args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
    print_to(Destination::Stdout, args);
    Ok(())
}

/// Print to stdout
/// This will appear in the terminal, including in production.
/// Text automatically buffers
#[macro_export]
macro_rules! println {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {{
        // `:expr` (not `:literal`) so `concat!(..)` templates compile —
        // Zig `comptime fmt: string` accepts `"a" ++ "b"` (output.zig:781).
        // `concat!` accepts a nested `concat!`, so the trailing-`{}` join works.
        const __NL: &str = $crate::output::_needs_nl($fmt);
        $crate::output::print_to(
            $crate::output::Destination::Stdout,
            ::core::format_args!(concat!($fmt, "{}"), $($arg,)* __NL),
        )
    }};
}

/// Print to stdout, but only in debug builds.
/// Text automatically buffers
#[macro_export]
macro_rules! debug {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        if cfg!(debug_assertions) {
            $crate::pretty_errorln!(concat!("<d>DEBUG:<r> ", $fmt) $(, $arg)*);
            $crate::output::flush();
        }
    };
}

/// NOTE: unlike Zig output.zig:794-797, this fn form cannot inspect the
/// comptime template and therefore *always* appends `\n`. Callers must NOT
/// pass a template that already ends in `\n`. Prefer the `debug!` macro.
#[inline]
pub fn _debug(args: fmt::Arguments<'_>) {
    debug_assert!(SOURCE_SET.get());
    print_to(Destination::Stdout, args);
    write_bytes(Destination::Stdout, b"\n");
}

#[inline]
pub fn print(args: fmt::Arguments<'_>) {
    print_to(Destination::Stdout, args);
}

/// `bun.Output.println(fmt, args)` — `print()` with a trailing newline.
#[inline]
pub fn println(args: fmt::Arguments<'_>) {
    print_to(Destination::Stdout, args);
    write_bytes(Destination::Stdout, b"\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Scoped debug logging
// ──────────────────────────────────────────────────────────────────────────

/// Debug-only logs which should not appear in release mode
/// To enable a specific log at runtime, set the environment variable
///   BUN_DEBUG_${TAG} to 1
/// For example, to enable the "foo" log, set the environment variable
///   BUN_DEBUG_foo=1
/// To enable all logs, set the environment variable
///   BUN_DEBUG_ALL=1
pub type LogFunction = fn(fmt::Arguments<'_>);

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Visibility {
    /// Hide logs for this scope by default.
    Hidden,
    /// Show logs for this scope by default.
    Visible,
}

impl Visibility {
    /// Show logs for this scope by default if and only if `condition` is true.
    pub const fn visible_if(condition: bool) -> Visibility {
        if condition {
            Visibility::Visible
        } else {
            Visibility::Hidden
        }
    }
}

/// Runtime state for one scoped logger. One static instance per `declare_scope!`.
pub struct ScopedLogger {
    pub tagname: &'static str, // already lowercased
    really_disable: AtomicBool,
    is_visible_once: std::sync::Once,
    lock: Mutex<()>,
    out_set: AtomicBool,
    // TODO(port): per-scope buffered writer (`buffer: [4096]u8` + adapter). For now route
    // through `scoped_writer()` directly; Phase B can reintroduce per-scope buffering.
}

impl ScopedLogger {
    pub const fn new(tagname: &'static str, visibility: Visibility) -> Self {
        Self {
            tagname,
            really_disable: AtomicBool::new(matches!(visibility, Visibility::Hidden)),
            is_visible_once: std::sync::Once::new(),
            lock: Mutex::new(()),
            out_set: AtomicBool::new(false),
        }
    }

    fn evaluate_is_visible(&self) {
        // BUN_DEBUG_<tagname> — Zig builds this with comptime `++` (no length cap),
        // so size the buffer from the tag instead of a fixed `[u8; 64]`.
        let tag = self.tagname.as_bytes();
        let prefix = b"BUN_DEBUG_";
        let key_len = prefix.len() + tag.len();
        let mut env_key = vec![0u8; key_len + 1]; // +1 NUL
        env_key[..prefix.len()].copy_from_slice(prefix);
        env_key[prefix.len()..key_len].copy_from_slice(tag);
        let key = crate::ZStr::from_buf(&env_key, key_len);

        if let Some(val) = crate::getenv_z_any_case(key) {
            self.really_disable.store(val == b"0", Ordering::Relaxed);
        } else if let Some(val) = env_var::BUN_DEBUG_ALL.get() {
            self.really_disable.store(!val, Ordering::Relaxed);
        } else if let Some(val) = env_var::BUN_DEBUG_QUIET_LOGS.get() {
            self.really_disable.store(
                self.really_disable.load(Ordering::Relaxed) || val,
                Ordering::Relaxed,
            );
        } else {
            // --debug-<tagname> / --debug-all
            let pfx = b"--debug-";
            let mut flag = vec![0u8; pfx.len() + tag.len()];
            flag[..pfx.len()].copy_from_slice(pfx);
            flag[pfx.len()..].copy_from_slice(tag);
            let flag_slice = flag.as_slice();
            for arg in argv() {
                if strings::eql_case_insensitive_ascii(arg, flag_slice, true)
                    || strings::eql_case_insensitive_ascii(arg, b"--debug-all", true)
                {
                    self.really_disable.store(false, Ordering::Relaxed);
                    break;
                }
            }
        }
    }

    pub fn is_visible(&self) -> bool {
        if !Environment::ENABLE_LOGS {
            return false;
        }
        self.is_visible_once
            .call_once(|| self.evaluate_is_visible());
        !self.really_disable.load(Ordering::Relaxed)
    }

    /// Debug-only logs which should not appear in release mode
    /// To enable a specific log at runtime, set the environment variable
    ///   BUN_DEBUG_${TAG} to 1
    /// For example, to enable the "foo" log, set the environment variable
    ///   BUN_DEBUG_foo=1
    /// To enable all logs, set the environment variable
    ///   BUN_DEBUG_ALL=1
    pub fn log(&self, args: fmt::Arguments<'_>) {
        if !Environment::ENABLE_LOGS {
            return;
        }
        if !SOURCE_SET.get() {
            return;
        }
        if scoped_debug_writer::DISABLE_INSIDE_LOG.get() > 0 {
            return;
        }
        // MOVE_DOWN: bun_crash_handler::is_panicking → bun_core (move-in pass).
        if crate::is_panicking() {
            return;
        }

        let _guard = scoped_debug_writer::DisableGuard::new();

        if !self.is_visible() {
            return;
        }

        // TODO(port): per-scope `[4096]u8` buffered adapter (`out`/`out_set`/`buffered_writer`)
        let _ = self.out_set.load(Ordering::Relaxed);

        let _lock = self.lock.lock();

        let mut out = scoped_writer();
        // PERF(port): was comptime bool dispatch on use_ansi — profile in Phase B.
        // The colored/plain selection now happens at the `scoped_log!` call site
        // (single arg evaluation) via `_scoped_use_ansi()`.
        let result = out.write_fmt(args);
        if result.is_err() {
            // Zig: write failure → disable scope and skip the flush.
            self.really_disable.store(true, Ordering::Relaxed);
            return;
        }
        // TODO(port): Zig also disables on flush failure; QuietWriter::flush()
        // currently returns () via the SysHooks vtable so flush errors are not
        // observable here. Surface a Result once bun_sys exposes it.
        out.flush();
    }
}

/// Declare a scoped logger. Expands to a `static SCOPE: ScopedLogger`.
///
/// ```ignore
/// declare_scope!(EventLoop, hidden);
/// scoped_log!(EventLoop, "tick {}", n);
/// ```
#[macro_export]
macro_rules! declare_scope {
    ($name:ident, hidden) => {
        #[allow(non_upper_case_globals)]
        pub static $name: $crate::output::ScopedLogger = $crate::output::ScopedLogger::new(
            // TODO(port): lowercase tagname at compile time (Zig did std.ascii.toLower)
            stringify!($name),
            $crate::output::Visibility::Hidden,
        );
    };
    ($name:ident, visible) => {
        #[allow(non_upper_case_globals)]
        pub static $name: $crate::output::ScopedLogger = $crate::output::ScopedLogger::new(
            stringify!($name),
            $crate::output::Visibility::Visible,
        );
    };
}

/// `bun.Output.scoped(.X, vis)("fmt", .{args})` → `scoped_log!(X, "fmt", args...)`
///
/// MUST gate arg evaluation: expands to a dead branch in release builds.
#[macro_export]
macro_rules! scoped_log {
    ($scope:path, $fmt:expr $(, $arg:expr)* $(,)?) => {
        // Gate on `debug_assertions` (== `Environment::ENABLE_LOGS`, env.rs:89) so
        // release builds dead-strip the body. Do NOT gate on a Cargo feature —
        // there is no `debug_logs` feature and §Forbidden bans silent no-ops.
        if cfg!(debug_assertions) && $scope.is_visible() {
            const __NL: &str = $crate::output::_needs_nl($crate::pretty_fmt!($fmt, false));
            // Branch on ANSI *before* `format_args!` so each `$arg` evaluates
            // exactly once (Zig builds the args tuple once — output.zig:922-933).
            // Prefix `[tag]` is built at runtime from `$scope.tagname` lowercased
            // (Zig: output.zig:826-835 lowercases via `std.ascii.toLower`).
            if $crate::output::_scoped_use_ansi() {
                $scope.log(::core::format_args!(
                    concat!(
                        "\x1b[0m\x1b[2m[{}]\x1b[0m ",
                        $crate::pretty_fmt!($fmt, true),
                        "{}",
                    ),
                    $crate::output::_LowerTag($scope.tagname), $($arg,)* __NL
                ));
            } else {
                $scope.log(::core::format_args!(
                    concat!(
                        "[{}] ",
                        $crate::pretty_fmt!($fmt, false),
                        "{}",
                    ),
                    $crate::output::_LowerTag($scope.tagname), $($arg,)* __NL
                ));
            }
        }
    };
}

/// Declare a scoped logger static **and** a local forwarding macro in one shot.
/// Replaces the per-file `declare_scope!(X, vis); macro_rules! log { … }` boilerplate.
///
/// ```ignore
/// bun_core::define_scoped_log!(log, EventLoop, hidden);
/// log!("tick {}", n);
/// ```
///
/// The two-arg form skips `declare_scope!` and just forwards to an existing
/// `ScopedLogger` static (by path) — for hand-declared statics (keyword tagnames)
/// or scopes that live in another module.
//
// Nested-macro `$` escaping uses the "`$` token smuggle" so caller crates do
// NOT need `#![feature(macro_metavar_expr)]`: the public arms forward a
// literal `$` token to a `(@inner …, $d:tt)` arm, which then writes `$d`
// where the inner macro wants `$`.
#[macro_export]
macro_rules! define_scoped_log {
    ($mac:ident, $scope:ident, $vis:tt) => {
        $crate::declare_scope!($scope, $vis);
        $crate::define_scoped_log!(@inner $mac, $scope, $);
    };
    ($mac:ident, $scope:path) => {
        $crate::define_scoped_log!(@inner $mac, $scope, $);
    };
    (@inner $mac:ident, $scope:path, $d:tt) => {
        #[allow(unused_macros)]
        macro_rules! $mac {
            ($d($d arg:tt)*) => { $crate::scoped_log!($scope, $d($d arg)*) };
        }
    };
}

/// `Display` adapter that lowercases an ASCII tag on the fly. Used by
/// `scoped_log!` so the printed `[tag]` prefix matches Zig's
/// `std.ascii.toLower`-folded `tagname` (output.zig:826-835) without needing a
/// compile-time lowercasing proc-macro.
#[doc(hidden)]
pub struct _LowerTag(pub &'static str);
impl fmt::Display for _LowerTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for c in self.0.chars() {
            fmt::Write::write_char(f, c.to_ascii_lowercase())?;
        }
        Ok(())
    }
}

pub fn up(n: usize) {
    print(format_args!("\x1B[{}A", n));
}
pub fn clear_to_end() {
    print(format_args!("\x1B[0J"));
}

// ──────────────────────────────────────────────────────────────────────────
// prettyFmt — compile-time `<tag>` → ANSI substitution
// ──────────────────────────────────────────────────────────────────────────

// Valid "colors":
// <black>
// <blue>
// <cyan>
// <green>
// <bggreen>
// <magenta>
// <red>
// <bgred>
// <white>
// <yellow>
// <b> - bold
// <d> - dim
// </r> - reset
// <r> - reset
const CSI: &str = "\x1b[";

/// Lowercase lookup wrapper (Zig: `Output.color_map.get(name)`). The table
/// itself lives in `bun_output_tags` (shared with the `pretty_fmt!` proc-macro
/// so there is exactly one copy); this fn-module mirrors the Zig
/// `ComptimeStringMap` `.get()` surface.
pub mod color_map {
    #[inline]
    pub fn get(name: &[u8]) -> Option<&'static str> {
        bun_output_tags::color_for_bytes(name)
    }
}

pub use ansi::{BOLD, DIM, RESET};
pub use bun_output_tags::{ansi, ansi_b};

/// `bun.Output.pretty(fmt, args)` — write to stdout with `<tag>` color expansion.
/// Function form: performs the `<tag>` → ANSI rewrite at runtime on the rendered
/// payload (using stdout's colour state). Prefer the `pretty!` macro for literal
/// templates so the rewrite stays comptime.
///
/// `inline(always)`: with plain `#[inline]` the `<core::fmt::Arguments>`
/// monomorphization materializes once in `bun_runtime` and every other crate's
/// single startup-banner call jumps to that island, dragging a cold .text page
/// into the install/no-op fault-around set. Forcing the body into each caller
/// keeps it next to the call site (and the body is two calls — cheap).
#[inline(always)]
pub fn pretty(payload: impl PrettyFmtInput) {
    let buf = payload.into_pretty_buf(enable_ansi_colors_stdout());
    write_bytes(Destination::Stdout, &buf);
}

/// `bun.Output.prettyln(fmt, args)` — `pretty()` with a trailing newline.
/// Function form: performs the `<tag>` → ANSI rewrite at runtime on the rendered
/// payload and appends `\n` if the result does not already end in one (matches
/// Zig output.zig:1090-1093). Prefer the `prettyln!` macro for literal templates.
/// `inline(always)` for the same .text-layout reason as [`pretty`].
#[inline(always)]
pub fn prettyln(payload: impl PrettyFmtInput) {
    let buf = payload.into_pretty_buf(enable_ansi_colors_stdout());
    write_bytes(Destination::Stdout, &buf);
    if buf.0.last() != Some(&b'\n') {
        write_bytes(Destination::Stdout, b"\n");
    }
}

/// Compile-time `<tag>` → ANSI escape rewriter.
///
/// In Zig this was a `comptime` function building a `[:0]const u8`. In Rust the
/// equivalent must be a proc-macro because it consumes a string literal and emits
/// a new string literal usable as a `format_args!` template.
///
/// `pretty_fmt!("<red>{s}<r>", true)`  → `"\x1b[31m{}\x1b[0m"`
/// `pretty_fmt!("<red>{s}<r>", false)` → `"{}"`
///
/// The reference algorithm is `pretty_fmt_runtime` below (kept 1:1 with the Zig
/// body so the proc-macro can be tested against it).
pub use bun_core_macros::pretty_fmt;

/// Input accepted by [`pretty_fmt`]: either a `&str`/`&[u8]` template or a
/// pre-formatted `&fmt::Arguments<'_>` (which is first rendered to a string
/// then `<tag>`-rewritten — used by `Custom Inspect`-style call sites that
/// build the template via `format_args!`).
pub trait PrettyFmtInput {
    fn into_pretty_buf(self, is_enabled: bool) -> PrettyBuf;
}
impl PrettyFmtInput for &str {
    #[inline]
    fn into_pretty_buf(self, is_enabled: bool) -> PrettyBuf {
        PrettyBuf(pretty_fmt_runtime(self.as_bytes(), is_enabled))
    }
}
impl PrettyFmtInput for &[u8] {
    #[inline]
    fn into_pretty_buf(self, is_enabled: bool) -> PrettyBuf {
        PrettyBuf(pretty_fmt_runtime(self, is_enabled))
    }
}
impl PrettyFmtInput for &fmt::Arguments<'_> {
    #[inline]
    fn into_pretty_buf(self, is_enabled: bool) -> PrettyBuf {
        // Render the `Arguments` first, then rewrite `<tag>` markers.
        let rendered = std::format!("{}", self);
        PrettyBuf(pretty_fmt_runtime(rendered.as_bytes(), is_enabled))
    }
}
impl PrettyFmtInput for fmt::Arguments<'_> {
    #[inline]
    fn into_pretty_buf(self, is_enabled: bool) -> PrettyBuf {
        (&self).into_pretty_buf(is_enabled)
    }
}

/// `Output.prettyFmt` — runtime `<tag>` → ANSI rewrite. Const-generic
/// `ENABLE_ANSI_COLORS` mirrors the Zig `comptime is_enabled: bool` parameter
/// so callers can do `Output::pretty_fmt::<ENABLE_ANSI_COLORS>("…")`.
///
/// For a runtime bool (e.g. from `enable_ansi_colors_stderr()`), see
/// [`pretty_fmt_rt`].
#[inline]
pub fn pretty_fmt<const ENABLE_ANSI_COLORS: bool>(input: impl PrettyFmtInput) -> PrettyBuf {
    input.into_pretty_buf(ENABLE_ANSI_COLORS)
}

/// Runtime-bool form of [`pretty_fmt`] for call sites that don't have a
/// const-generic colour flag (crash handler, dynamic templates).
#[inline]
pub fn pretty_fmt_rt(input: impl PrettyFmtInput, is_enabled: bool) -> PrettyBuf {
    input.into_pretty_buf(is_enabled)
}

/// Owned ANSI-rewritten buffer; derefs to `[u8]` so it can be passed to
/// `write_all(&buf)` directly, and implements `Display` so it can be used in
/// `write!(w, "{}", pretty_fmt::<true>("…"))`.
#[repr(transparent)]
pub struct PrettyBuf(pub Vec<u8>);
impl core::ops::Deref for PrettyBuf {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        &self.0
    }
}
impl AsRef<[u8]> for PrettyBuf {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}
impl AsRef<str> for PrettyBuf {
    #[inline]
    fn as_ref(&self) -> &str {
        // SAFETY: contents are ANSI escape bytes (pure ASCII) interleaved with
        // verbatim runs of a `&'static str` template — both UTF-8 by
        // construction.
        unsafe { core::str::from_utf8_unchecked(&self.0) }
    }
}
impl fmt::Display for PrettyBuf {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_ref())
    }
}

// ── FmtTuple ──────────────────────────────────────────────────────────────
// Zig `fn print(comptime fmt: []const u8, args: anytype)` takes a tuple of
// arguments and substitutes positionals. The Rust port models `args: anytype`
// as `impl FmtTuple` so call sites can pass `()`, `(a,)`, `(a, b)`, … or a
// pre-built `fmt::Arguments<'_>` (treated as a single positional).

/// Positional-argument bundle for runtime template substitution.
pub trait FmtTuple {
    /// Write the `idx`-th positional into `f`. Returns `false` if `idx` is out
    /// of range (caller emits the literal `{}` then).
    fn write_nth(&self, idx: usize, f: &mut dyn fmt::Write) -> Result<bool, fmt::Error>;
    fn len(&self) -> usize;
}
impl FmtTuple for () {
    #[inline]
    fn write_nth(&self, _: usize, _: &mut dyn fmt::Write) -> Result<bool, fmt::Error> {
        Ok(false)
    }
    #[inline]
    fn len(&self) -> usize {
        0
    }
}
impl FmtTuple for fmt::Arguments<'_> {
    #[inline]
    fn write_nth(&self, idx: usize, f: &mut dyn fmt::Write) -> Result<bool, fmt::Error> {
        if idx == 0 {
            f.write_fmt(*self)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    #[inline]
    fn len(&self) -> usize {
        1
    }
}
impl<T: fmt::Display> FmtTuple for &[T] {
    fn write_nth(&self, idx: usize, f: &mut dyn fmt::Write) -> Result<bool, fmt::Error> {
        match self.get(idx) {
            Some(v) => {
                write!(f, "{}", v)?;
                Ok(true)
            }
            None => Ok(false),
        }
    }
    #[inline]
    fn len(&self) -> usize {
        (*self).len()
    }
}
impl<T: fmt::Display, const N: usize> FmtTuple for &[T; N] {
    fn write_nth(&self, idx: usize, f: &mut dyn fmt::Write) -> Result<bool, fmt::Error> {
        match self.get(idx) {
            Some(v) => {
                write!(f, "{}", v)?;
                Ok(true)
            }
            None => Ok(false),
        }
    }
    #[inline]
    fn len(&self) -> usize {
        N
    }
}
macro_rules! impl_fmt_tuple {
    ($($idx:tt $T:ident),+) => {
        impl<$($T: fmt::Display),+> FmtTuple for ($($T,)+) {
            fn write_nth(&self, idx: usize, f: &mut dyn fmt::Write) -> Result<bool, fmt::Error> {
                match idx { $( $idx => { write!(f, "{}", self.$idx)?; Ok(true) } )+ _ => Ok(false) }
            }
            #[inline] fn len(&self) -> usize { [$($idx),+].len() }
        }
    };
}
impl_fmt_tuple!(0 A);
impl_fmt_tuple!(0 A, 1 B);
impl_fmt_tuple!(0 A, 1 B, 2 C);
impl_fmt_tuple!(0 A, 1 B, 2 C, 3 D);
impl_fmt_tuple!(0 A, 1 B, 2 C, 3 D, 4 E);
impl_fmt_tuple!(0 A, 1 B, 2 C, 3 D, 4 E, 5 F);
impl_fmt_tuple!(0 A, 1 B, 2 C, 3 D, 4 E, 5 F, 6 G);
impl_fmt_tuple!(0 A, 1 B, 2 C, 3 D, 4 E, 5 F, 6 G, 7 H);

/// Substitute `{}` / `{s}` / `{d}` / `{any}` / `{f}` placeholders in `template`
/// with successive entries from `args`. `{{` / `}}` are emitted as literal
/// braces. Unrecognised specs are passed through verbatim.
fn substitute_template(
    template: &[u8],
    args: &impl FmtTuple,
    f: &mut dyn fmt::Write,
) -> fmt::Result {
    let t = template;
    let mut i = 0usize;
    let mut argi = 0usize;
    while i < t.len() {
        let b = t[i];
        if b == b'{' {
            if i + 1 < t.len() && t[i + 1] == b'{' {
                f.write_str("{")?;
                i += 2;
                continue;
            }
            // Find closing '}'.
            let mut j = i + 1;
            while j < t.len() && t[j] != b'}' {
                j += 1;
            }
            if j < t.len() {
                // consume placeholder
                if args.write_nth(argi, f)? {
                    argi += 1;
                }
                i = j + 1;
                continue;
            }
        } else if b == b'}' && i + 1 < t.len() && t[i + 1] == b'}' {
            f.write_str("}")?;
            i += 2;
            continue;
        }
        // SAFETY: template is ASCII/ANSI bytes; emit byte-at-a-time as Latin-1.
        let mut buf = [0u8; 4];
        let c = b as char;
        f.write_str(c.encode_utf8(&mut buf))?;
        i += 1;
    }
    Ok(())
}

/// `Display` adapter pairing a runtime template with a [`FmtTuple`].
pub struct TemplateDisplay<'a, A: FmtTuple> {
    template: std::borrow::Cow<'a, [u8]>,
    args: A,
}
impl<A: FmtTuple> fmt::Display for TemplateDisplay<'_, A> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        substitute_template(&self.template, &self.args, f)
    }
}

/// Runtime `<tag>` → ANSI rewrite *with* a positional-argument tuple
/// substituted at each `{}` / `{s}` / `{d}` placeholder. Returns a `Display`
/// impl so callers can `write!(w, "{}", pretty_fmt_args(fmt, true, (a, b)))`.
///
/// Port of `Output.prettyFmt` + `print` fused for the dynamic-template case
/// (crash_handler builds the template at runtime).
pub fn pretty_fmt_args<A: FmtTuple>(
    fmt: &str,
    is_enabled: bool,
    args: A,
) -> TemplateDisplay<'static, A> {
    TemplateDisplay {
        template: std::borrow::Cow::Owned(pretty_fmt_runtime(fmt.as_bytes(), is_enabled)),
        args,
    }
}

/// Legacy name kept for back-compat with crash_handler.
pub type PrettyFmtArgs<'a> = TemplateDisplay<'a, fmt::Arguments<'a>>;

/// Runtime mirror of Zig `prettyFmt` for testing the proc-macro and for the rare
/// dynamic case. Produces the same byte sequence the Zig comptime version would.
///
/// Colour table lives in `bun_output_tags`; the state machine is kept duplicated
/// vs `bun_core_macros::rewrite` because the two intentionally diverge in the
/// `{` arm (proc-macro rewrites Zig specs `{s}`→`{}`; this side copies braces
/// verbatim) and on unknown tags (proc-macro errors; this side emits `""`).
pub fn pretty_fmt_runtime(fmt: &[u8], is_enabled: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(fmt.len() * 4);
    let mut i = 0usize;
    while i < fmt.len() {
        match fmt[i] {
            b'\\' => {
                i += 1;
                if i < fmt.len() {
                    match fmt[i] {
                        b'<' | b'>' => {
                            out.push(fmt[i]);
                            i += 1;
                        }
                        _ => {
                            out.push(b'\\');
                            out.push(fmt[i]);
                            i += 1;
                        }
                    }
                }
            }
            b'>' => {
                i += 1;
            }
            b'{' => {
                while i < fmt.len() && fmt[i] != b'}' {
                    out.push(fmt[i]);
                    i += 1;
                }
            }
            b'<' => {
                i += 1;
                let mut is_reset = i < fmt.len() && fmt[i] == b'/';
                if is_reset {
                    i += 1;
                }
                let start = i;
                while i < fmt.len() && fmt[i] != b'>' {
                    i += 1;
                }
                let color_name = &fmt[start..i];
                let color_str: &str = 'picker: {
                    if let Some(lit) = color_map::get(color_name) {
                        break 'picker lit;
                    } else if color_name == b"r" {
                        is_reset = true;
                        break 'picker "";
                    } else {
                        // Zig: @compileError — runtime version returns empty
                        // TODO(port): proc-macro emits compile_error! here
                        break 'picker "";
                    }
                };
                if is_enabled {
                    out.extend_from_slice(if is_reset {
                        RESET.as_bytes()
                    } else {
                        color_str.as_bytes()
                    });
                }
            }
            _ => {
                out.push(fmt[i]);
                i += 1;
            }
        }
    }
    out
}

#[doc(hidden)]
#[inline]
pub fn enable_color_for(dest: Destination) -> bool {
    match dest {
        Destination::Stdout => ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed),
        Destination::Stderr => ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed),
    }
}

/// Returns `"\n"` if `fmt` does not already end in a newline, else `""`.
/// Mirrors Zig's `if (fmt.len == 0 or fmt[fmt.len - 1] != '\n')` guard so the
/// `*ln!` macros never emit a double newline when the caller's template already
/// ends in one.
#[doc(hidden)]
#[inline]
pub const fn _needs_nl(fmt: &str) -> &'static str {
    let b = fmt.as_bytes();
    if b.is_empty() || b[b.len() - 1] != b'\n' {
        "\n"
    } else {
        ""
    }
}

/// Exposed for the `scoped_log!` macro so it can pick the colored / plain
/// branch *before* building `format_args!` (single arg evaluation).
#[doc(hidden)]
#[inline]
pub fn _scoped_use_ansi() -> bool {
    ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed) && SOURCE_SET.get() && {
        // SAFETY: `SCOPED_FILE_WRITER` is `QuietWriter::ZEROED` until startup
        // init; `QuietWriter` is Copy POD so reading it is always sound.
        let sw = unsafe { scoped_debug_writer::SCOPED_FILE_WRITER.read() };
        sw.context_handle() == raw_writer().handle()
    }
}

#[inline]
pub fn pretty_to(dest: Destination, colored: fmt::Arguments<'_>, plain: fmt::Arguments<'_>) {
    // Route through `print_to` so the WASM console_log/console_error path stays
    // covered (dest_writer alone bypasses it).
    if enable_color_for(dest) {
        print_to(dest, colored);
    } else {
        print_to(dest, plain);
    }
}

/// `prettyWithPrinter(fmt, args, printer, dest)` — calls `printer` with the
/// color-appropriate format. Printer takes `fmt::Arguments`.
#[inline]
pub fn pretty_with_printer(
    colored: fmt::Arguments<'_>,
    plain: fmt::Arguments<'_>,
    printer: impl FnOnce(fmt::Arguments<'_>),
    dest: Destination,
) {
    if enable_color_for(dest) {
        printer(colored);
    } else {
        printer(plain);
    }
}

/// Internal: bind each `$arg` exactly once into a `match` tuple, then dispatch
/// on the per-destination color flag and call `print_to` with the appropriate
/// `pretty_fmt!`-expanded template. Mirrors Zig's `prettyTo` which receives the
/// args tuple already evaluated and only branches on the color flag
/// (output.zig:1066-1074).
///
/// The recursive `@go` arm zips each user arg with a name from `pool` so the
/// emitted `match (&a, &b, ..)` pattern can rebind them as plain idents — both
/// `format_args!` branches then borrow the *same* evaluated values, so a
/// side-effecting `$arg` runs exactly once and the expression text is not
/// duplicated into each branch.
#[doc(hidden)]
#[macro_export]
macro_rules! __pretty_dispatch {
    // peel: pair next arg with next pool name
    (@go $dest:expr, $fmt:expr, $tail:tt;
        bound = [$(($n:ident $v:expr))*];
        args  = [$a:expr, $($rest:expr,)*];
        pool  = [$name:ident $($pool:ident)*]
    ) => {
        $crate::__pretty_dispatch!(@go $dest, $fmt, $tail;
            bound = [$(($n $v))* ($name $a)];
            args  = [$($rest,)*];
            pool  = [$($pool)*]
        )
    };
    // base — no `\n` tail (`pretty!` / `pretty_error!`)
    (@go $dest:expr, $fmt:expr, [];
        bound = [$(($n:ident $v:expr))*];
        args  = [];
        pool  = [$($pool:ident)*]
    ) => {
        match ($dest, $( &($v), )*) {
            (__d, $($n,)*) => {
                if $crate::output::enable_color_for(__d) {
                    $crate::output::print_to(
                        __d,
                        ::core::format_args!($crate::pretty_fmt!($fmt, true) $(, $n)*),
                    )
                } else {
                    $crate::output::print_to(
                        __d,
                        ::core::format_args!($crate::pretty_fmt!($fmt, false) $(, $n)*),
                    )
                }
            }
        }
    };
    // base — with conditional `\n` tail (`prettyln!` / `pretty_errorln!`)
    (@go $dest:expr, $fmt:expr, [$nl:ident];
        bound = [$(($n:ident $v:expr))*];
        args  = [];
        pool  = [$($pool:ident)*]
    ) => {
        match ($dest, $( &($v), )*) {
            (__d, $($n,)*) => {
                if $crate::output::enable_color_for(__d) {
                    $crate::output::print_to(
                        __d,
                        ::core::format_args!(
                            ::core::concat!($crate::pretty_fmt!($fmt, true), "{}"),
                            $($n,)* $nl
                        ),
                    )
                } else {
                    $crate::output::print_to(
                        __d,
                        ::core::format_args!(
                            ::core::concat!($crate::pretty_fmt!($fmt, false), "{}"),
                            $($n,)* $nl
                        ),
                    )
                }
            }
        }
    };
}

/// Entry shim: seed `__pretty_dispatch!` with a fixed name pool (32 slots
/// covers every `Output.pretty*` call site in the tree) so the recursive zip
/// can rebind each user arg to a plain ident.
#[doc(hidden)]
#[macro_export]
macro_rules! __pretty_dispatch_start {
    ($dest:expr, $fmt:expr, $tail:tt; [$($arg:expr,)*]) => {
        $crate::__pretty_dispatch!(@go $dest, $fmt, $tail;
            bound = [];
            args  = [$($arg,)*];
            pool  = [__p0 __p1 __p2 __p3 __p4 __p5 __p6 __p7
                     __p8 __p9 __p10 __p11 __p12 __p13 __p14 __p15
                     __p16 __p17 __p18 __p19 __p20 __p21 __p22 __p23
                     __p24 __p25 __p26 __p27 __p28 __p29 __p30 __p31]
        )
    };
}

#[macro_export]
macro_rules! pretty {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        $crate::__pretty_dispatch_start!(
            $crate::output::Destination::Stdout, $fmt, []; [$($arg,)*]
        )
    };
}

/// Like Output.println, except it will automatically strip ansi color codes if
/// the terminal doesn't support them.
#[macro_export]
macro_rules! prettyln {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {{
        // Only append `\n` when the *processed* template doesn't already end in
        // one — `pretty_fmt!` flattens `concat!`/`stringify!` so wrapper macros
        // (`note!`, `warn!`, …) that prefix the user template still see the
        // user's trailing newline and don't emit a second one.
        const __NL: &str = $crate::output::_needs_nl($crate::pretty_fmt!($fmt, false));
        $crate::__pretty_dispatch_start!(
            $crate::output::Destination::Stdout, $fmt, [__NL]; [$($arg,)*]
        )
    }};
}

#[macro_export]
macro_rules! print_errorln {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {{
        // `:expr` (not `:literal`) so `concat!(..)` templates compile —
        // Zig `comptime fmt: string` accepts `"a" ++ "b"` (output.zig:1095).
        const __NL: &str = $crate::output::_needs_nl($fmt);
        $crate::output::print_to(
            $crate::output::Destination::Stderr,
            ::core::format_args!(concat!($fmt, "{}"), $($arg,)* __NL),
        )
    }};
}

#[macro_export]
macro_rules! pretty_error {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        $crate::__pretty_dispatch_start!(
            $crate::output::Destination::Stderr, $fmt, []; [$($arg,)*]
        )
    };
}

/// Print to stderr with ansi color codes automatically stripped out if the
/// terminal doesn't support them. Text is buffered
#[macro_export]
macro_rules! pretty_errorln {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {{
        const __NL: &str = $crate::output::_needs_nl($crate::pretty_fmt!($fmt, false));
        $crate::__pretty_dispatch_start!(
            $crate::output::Destination::Stderr, $fmt, [__NL]; [$($arg,)*]
        )
    }};
}

/// `write!` an `Output.prettyFmt`-style template to an arbitrary `fmt::Write`
/// sink, branching on a (possibly const-generic) color flag so each branch gets
/// the proc-macro-expanded literal template.
///
/// Port of Zig `writer.print(comptime Output.prettyFmt(FMT, enable_ansi_colors), .{args})`
/// for `writeFormat`-style impls that take `comptime enable_ansi_colors: bool`.
/// The `pretty_fmt!` proc-macro requires a `true`/`false` *literal*, so the
/// const-generic is dispatched here; only one arm executes at runtime, so each
/// `$arg` evaluates exactly once.
#[macro_export]
macro_rules! write_pretty {
    ($w:expr, $colors:expr, $fmt:expr $(, $arg:expr)* $(,)?) => {
        if $colors {
            ::core::write!($w, $crate::pretty_fmt!($fmt, true) $(, $arg)*)
        } else {
            ::core::write!($w, $crate::pretty_fmt!($fmt, false) $(, $arg)*)
        }
    };
}

// ── printCommand ──────────────────────────────────────────────────────────

/// Argument shape accepted by `command`/`commandOut`. Mirrors the Zig `anytype`
/// switch over `[][]const u8` vs `[]const u8`.
pub enum CommandArgv<'a> {
    List(&'a [&'a [u8]]),
    Single(&'a [u8]),
}

fn print_command(argv: CommandArgv<'_>, destination: Destination) {
    macro_rules! pretty_d {
        ($f:literal $(, $a:expr)*) => {
            match destination {
                Destination::Stdout => pretty!($f $(, $a)*),
                Destination::Stderr => pretty_error!($f $(, $a)*),
            }
        };
    }
    let printf = |args: fmt::Arguments<'_>| print_to(destination, args);

    match argv {
        CommandArgv::List(argv) => {
            pretty_d!("<r><d><magenta>$<r> <d><b>");
            printf(format_args!("{}", crate::fmt::s(argv[0])));
            if argv.len() > 1 {
                for arg in &argv[1..] {
                    printf(format_args!(" {}", crate::fmt::s(arg)));
                }
            }
            pretty_d!("<r>\n");
        }
        CommandArgv::Single(argv) => {
            pretty_d!("<r><d><magenta>$<r> <d><b>{}<r>\n", crate::fmt::s(argv));
        }
    }
    flush();
}

pub fn command_out(argv: CommandArgv<'_>) {
    print_command(argv, Destination::Stdout);
}

pub fn command(argv: CommandArgv<'_>) {
    print_command(argv, Destination::Stderr);
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Destination {
    Stderr,
    Stdout,
}

/// `Output.printError` — function form. No `<tag>` rewrite; takes anything
/// `Display` (so both `format_args!(..)` and bare `&str` call sites compile)
/// and writes it to stderr without a trailing newline.
#[inline]
pub fn print_error(args: impl core::fmt::Display) {
    print_to(Destination::Stderr, format_args!("{args}"));
}

/// `Output.printErrorln` — function form (the `print_errorln!` macro at crate
/// root is the comptime-string variant). Takes anything `Display` so both
/// `format_args!(..)` and bare `&str` call sites compile; appends `\n`.
///
/// NOTE: unlike the macro (and Zig output.zig:1095-1098), this fn form cannot
/// inspect the comptime template and therefore *always* appends `\n`. Callers
/// must NOT pass a template that already ends in `\n` or output will contain a
/// doubled newline. Prefer the `print_errorln!` macro where possible.
#[inline]
pub fn print_errorln(args: impl core::fmt::Display) {
    print_to(Destination::Stderr, format_args!("{args}\n"));
}

/// `Output.enable_ansi_colors_stdout` — safe relaxed-load wrapper over the
/// startup-initialized atomic. Mirrors the Zig public-var read.
#[inline]
pub fn enable_ansi_colors_stdout() -> bool {
    ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed)
}
/// `Output.enable_ansi_colors_stderr`.
#[inline]
pub fn enable_ansi_colors_stderr() -> bool {
    ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed)
}
/// `Output.enable_ansi_colors` (legacy combined accessor — Zig deprecates the
/// var; expose as stderr to match its historical meaning).
#[inline]
pub fn enable_ansi_colors() -> bool {
    ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed)
}

// ── DebugTimer ────────────────────────────────────────────────────────────

pub struct DebugTimer {
    #[cfg(debug_assertions)]
    pub timer: std::time::Instant,
}

impl DebugTimer {
    #[inline]
    pub fn start() -> DebugTimer {
        #[cfg(debug_assertions)]
        {
            DebugTimer {
                timer: std::time::Instant::now(),
            }
        }
        #[cfg(not(debug_assertions))]
        {
            DebugTimer {}
        }
    }
}

impl fmt::Display for DebugTimer {
    fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        #[cfg(debug_assertions)]
        {
            let ns = self.timer.elapsed().as_nanos() as f64;
            write!(w, "{:.3}ms", ns / 1_000_000.0)?;
        }
        let _ = w;
        Ok(())
    }
}

/// Print a blue note message to stderr
#[macro_export]
macro_rules! note {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        // `pretty_errorln!` accepts `:expr` and the `pretty_fmt!` proc-macro
        // flattens nested `concat!`, so the prefix is folded into the template
        // at compile time even when `$fmt` is itself a `concat!(..)`.
        $crate::pretty_errorln!(concat!("<blue>note<r><d>:<r> ", $fmt) $(, $arg)*)
    };
}

/// Print a yellow warning message to stderr
#[macro_export]
macro_rules! warn {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        $crate::pretty_errorln!(concat!("<yellow>warn<r><d>:<r> ", $fmt) $(, $arg)*)
    };
}

/// Print a yellow warning message, only in debug mode
#[macro_export]
macro_rules! debug_warn {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        if cfg!(debug_assertions) {
            $crate::pretty_errorln!(concat!("<yellow>debug warn<r><d>:<r> ", $fmt) $(, $arg)*);
            $crate::output::flush();
        }
    };
}

/// Print a red error message. The first argument takes an `error_name` value, which can be either
/// be a Zig error, or a string or enum. The error name is converted to a string and displayed
/// in place of "error:", making it useful to print things like "EACCES: Couldn't open package.json"
///
/// The Zig original switched on `@typeInfo` of `error_name`. The Rust port accepts anything
/// implementing `ErrName` (impl'd for `&[u8]`, `&str`, `bun_core::Error`, `bun_sys::Error`,
/// and any `#[derive(strum::IntoStaticStr)]` enum).
// TODO(port): the comptime-literal fast path (is_comptime_name) is dropped — Phase B can
// recover it with a proc-macro overload that detects string literals.
pub fn err(error_name: impl ErrName, fmt: &str, args: impl FmtTuple) {
    // Zig concatenates `fmt` into the prettyErrorln template, whose trailing-\n
    // check then sees the caller's newline. Here `fmt` is rendered into a `{}`
    // arg, so strip a trailing \n and let pretty_errorln! add exactly one.
    let fmt = fmt.strip_suffix('\n').unwrap_or(fmt);
    let body = pretty_fmt_args(fmt, enable_ansi_colors_stderr(), args);
    if let Some(e) = error_name.as_sys_err_info() {
        // MOVE_DOWN: bun_sys::coreutils_error_map → bun_core (move-in pass).
        if let Some(label) = crate::coreutils_error_map::get(e.errno) {
            pretty_errorln!(
                "<r><red>{}<r><d>:<r> {}: {} <d>({})<r>",
                bstr::BStr::new(e.tag_name),
                bstr::BStr::new(label),
                body,
                e.syscall,
            );
        } else {
            pretty_errorln!(
                "<r><red>{}<r><d>:<r> {} <d>({})<r>",
                bstr::BStr::new(e.tag_name),
                body,
                e.syscall,
            );
        }
        return;
    }

    let display_name = error_name.name();
    pretty_errorln!("<red>{}<r><d>:<r> {}", bstr::BStr::new(display_name), body);
}

/// `Output.err(.TAG, fmt, args)` with a bare string tag — e.g.
/// `Output::err_tag("EACCES", format_args!(...))`. Thin sugar over `err` for
/// call sites that already hold a fully-formatted body (not a positional
/// `{}` template).
#[inline]
pub fn err_tag(tag: &str, body: core::fmt::Arguments<'_>) {
    pretty_errorln!("<red>{}<r><d>:<r> {}", tag, body);
}

/// `Output.errGeneric` — function form. `<red>error<r>:` prefix to stderr with
/// a `<tag>`-rewritten template + positional args.
#[inline]
pub fn err_generic(fmt: &str, args: impl FmtTuple) {
    let fmt = fmt.strip_suffix('\n').unwrap_or(fmt);
    pretty_errorln!(
        "<r><red>error<r><d>:<r> {}",
        pretty_fmt_args(fmt, enable_ansi_colors_stderr(), args),
    );
}

/// What `err()` needs from a `bun_sys::Error` without naming the type.
/// Populated by bun_sys's `ErrName` impl (move-in pass).
#[derive(Clone, Copy)]
pub struct SysErrInfo {
    pub tag_name: &'static [u8],
    pub errno: i32,
    pub syscall: &'static str,
}

/// Trait abstracting the `@typeInfo` switch in Zig `err()`.
///
/// `as_sys_err_info()` replaces the former `as_sys_error() -> Option<&bun_sys::Error>`:
/// bun_core (T0) can't name `bun_sys::Error` (T1). bun_sys impls `ErrName` for
/// its own error type (move-in pass) and returns the projected info here.
pub trait ErrName {
    fn name(&self) -> &[u8];
    fn as_sys_err_info(&self) -> Option<SysErrInfo> {
        None
    }
}
impl ErrName for &str {
    fn name(&self) -> &[u8] {
        self.as_bytes()
    }
}
impl ErrName for &[u8] {
    fn name(&self) -> &[u8] {
        self
    }
}
impl ErrName for crate::Error {
    fn name(&self) -> &[u8] {
        (*self).name().as_bytes()
    }
}
// TODO(b0): `impl ErrName for bun_sys::Error` and `bun_sys::SystemErrno` arrive
// via move-in pass in bun_sys (orphan rule allows higher tier to impl this trait).
// TODO(port): blanket impl for `T: Into<&'static str>` (strum enums) once coherence allows.

// ── ScopedDebugWriter ─────────────────────────────────────────────────────

pub mod scoped_debug_writer {
    use super::*;

    pub static SCOPED_FILE_WRITER: crate::RacyCell<QuietWriter> =
        crate::RacyCell::new(QuietWriter::ZEROED);

    thread_local! {
        pub static DISABLE_INSIDE_LOG: Cell<isize> = const { Cell::new(0) };
    }

    /// RAII guard that suppresses scoped logging for the lifetime of the guard
    /// (Zig: `disable_inside_log += 1; defer disable_inside_log -= 1;`).
    #[must_use]
    pub struct DisableGuard(());

    impl DisableGuard {
        #[inline]
        pub fn new() -> Self {
            DISABLE_INSIDE_LOG.set(DISABLE_INSIDE_LOG.get() + 1);
            Self(())
        }
    }

    impl Drop for DisableGuard {
        #[inline]
        fn drop(&mut self) {
            DISABLE_INSIDE_LOG.set(DISABLE_INSIDE_LOG.get() - 1);
        }
    }
}

pub fn disable_scoped_debug_writer() {
    // Zig: `if (!@inComptime())` — always runtime in Rust.
    scoped_debug_writer::DISABLE_INSIDE_LOG.set(scoped_debug_writer::DISABLE_INSIDE_LOG.get() + 1);
}
pub fn enable_scoped_debug_writer() {
    scoped_debug_writer::DISABLE_INSIDE_LOG.set(scoped_debug_writer::DISABLE_INSIDE_LOG.get() - 1);
}

// TODO(port): move to bun_core_sys
unsafe extern "C" {
    /// No preconditions; returns the calling process's PID.
    safe fn getpid() -> c_int;
}

pub fn init_scoped_debug_writer_at_startup() {
    debug_assert!(SOURCE_SET.get());

    if let Some(path) = env_var::BUN_DEBUG.get() {
        if !path.is_empty() && path != b"0" && path != b"false" {
            // MOVE_DOWN: bun_paths::dirname → bun_core (bundled with SEP/PathBuffer move-in).
            if let Some(dir) = crate::dirname(path) {
                let _ = output_sink().make_path(Fd::cwd(), dir);
            }

            // do not use libuv through this code path, since it might not be initialized yet.
            use std::io::Write as _;
            let mut pid = Vec::new();
            write!(&mut pid, "{}", getpid()).expect("failed to allocate path");

            let path_fmt = strings::replace_owned(path, b"{pid}", &pid);

            let fd: Fd = match output_sink().create_file(Fd::cwd(), &path_fmt) {
                Ok(fd) => fd,
                Err(open_err) => panic(format_args!(
                    "Failed to open file for debug output: {} ({})",
                    bstr::BStr::new(open_err.name()),
                    bstr::BStr::new(path),
                )),
            };
            // TODO(b2-blocked): bun_sys::Fd::truncate (Windows-only); add to OutputSinkVTable.
            // `create_file` above already opens for writing with truncate, so the explicit
            // `fd.truncate(0)` from Zig is a no-op here until the vtable entry lands.
            let _ = &fd; // windows
            // SAFETY: single-threaded startup.
            unsafe {
                scoped_debug_writer::SCOPED_FILE_WRITER
                    .write(output_sink().quiet_writer_from_fd(fd));
            }
            return;
        }
    }

    // SAFETY: single-threaded startup.
    unsafe {
        scoped_debug_writer::SCOPED_FILE_WRITER
            .write(output_sink().quiet_writer_from_fd(SOURCE.with_borrow(|s| s.raw_stream).0));
    }
}

fn scoped_writer() -> QuietWriter {
    // Zig used `@compileError` here (output.zig:1320-1325) which is lazy — it
    // only fires if `scopedWriter()` is referenced, and in release Zig the
    // `Scoped()` no-op struct never references it. Rust's `compile_error!` is
    // eager and would break every release build, so assert at runtime instead.
    // All callers are already gated on `Environment::ENABLE_LOGS`.
    debug_assert!(
        Environment::ENABLE_LOGS,
        "scopedWriter() should only be called in debug mode",
    );
    // SAFETY: initialized in init_scoped_debug_writer_at_startup; QuietWriter is Copy POD.
    unsafe { scoped_debug_writer::SCOPED_FILE_WRITER.read() }
}

/// Print a red error message with "error: " as the prefix. For custom prefixes see `err()`
#[macro_export]
macro_rules! err_generic {
    ($fmt:expr $(, $arg:expr)* $(,)?) => {
        // `pretty_errorln!` accepts `:expr` and `pretty_fmt!` flattens `concat!`,
        // so the prefix is folded into the template at compile time.
        $crate::pretty_errorln!(concat!("<r><red>error<r><d>:<r> ", $fmt) $(, $arg)*)
    };
}

/// Print a red error message with "error: " as the prefix and a formatted message.
#[inline]
pub fn err_fmt(formatter: impl fmt::Display) {
    err_generic!("{}", formatter);
}

// ──────────────────────────────────────────────────────────────────────────
// Stdin readers (CYCLEBREAK §Dispatch cold path)
//
// Zig's `bun.Output.buffered_stdin` is a `bun.deprecated.BufferedReader(4096,
// File.Reader)`. The concrete `File.Reader` lives in bun_sys; bun_core routes
// the underlying `read(2)` through the [`OutputSinkVTable::read`] slot so the
// `prompt`/`init`/`publish` callers can read stdin without naming bun_sys.
// ──────────────────────────────────────────────────────────────────────────

pub static BUFFERED_STDIN: crate::RacyCell<BufferedStdin> = crate::RacyCell::new(BufferedStdin {
    fd: {
        #[cfg(windows)]
        {
            Fd::INVALID // set in WindowsStdio.init
        }
        #[cfg(not(windows))]
        {
            Fd::stdin()
        }
    },
    buf: [0; 4096],
    start: 0,
    end: 0,
});

/// `bun.deprecated.BufferedReader(4096, File.Reader)` over the process stdin.
/// Layout is local to bun_core; bun_sys never casts into this (it only fills
/// `.fd` during Windows startup).
#[repr(C)]
pub struct BufferedStdin {
    pub fd: Fd,
    pub buf: [u8; 4096],
    pub start: usize,
    pub end: usize,
}

impl BufferedStdin {
    /// Zig `BufferedReader.reader()` — the std adapter just hands back `&mut
    /// Self` (which already exposes `read`/`read_byte`).
    #[inline]
    pub fn reader(&mut self) -> &mut Self {
        self
    }

    /// Zig `BufferedReader.read` — fill `dest` from the buffer, refilling from
    /// the underlying fd until `dest` is full or EOF. Returns `Ok(0)` on EOF.
    ///
    /// PORT NOTE: matches std `BufferedReader.read` fill-to-completion semantics
    /// (loops on the underlying fd), not POSIX partial-read.
    pub fn read(&mut self, dest: &mut [u8]) -> Result<usize, crate::Error> {
        let mut written: usize = 0;
        loop {
            let current = &self.buf[self.start..self.end];
            if !current.is_empty() {
                let n = current.len().min(dest.len() - written);
                dest[written..written + n].copy_from_slice(&current[..n]);
                self.start += n;
                written += n;
                if written == dest.len() {
                    return Ok(written);
                }
            }
            let remaining = dest.len() - written;
            if remaining >= self.buf.len() {
                // Large dest tail: bypass the buffer.
                let n = output_sink().read(self.fd, &mut dest[written..])?;
                if n == 0 {
                    return Ok(written);
                }
                written += n;
                if written == dest.len() {
                    return Ok(written);
                }
                continue;
            }
            self.end = output_sink().read(self.fd, &mut self.buf)?;
            self.start = 0;
            if self.end == 0 {
                return Ok(written);
            }
        }
    }

    /// Zig `GenericReader.readByte` — `Err` on I/O error *or* EOF (matches
    /// `error.EndOfStream`).
    pub fn read_byte(&mut self) -> Result<u8, crate::Error> {
        if self.start < self.end {
            let b = self.buf[self.start];
            self.start += 1;
            return Ok(b);
        }
        let mut one = [0u8; 1];
        match self.read(&mut one)? {
            0 => Err(crate::err!(EndOfStream)),
            _ => Ok(one[0]),
        }
    }

    /// Zig `GenericReader.readUntilDelimiterArrayList` — appends bytes (not
    /// including `delimiter`) into `out`; errors with `StreamTooLong`
    /// semantics if `out.len()` would exceed `max_size`.
    pub fn read_until_delimiter_array_list(
        &mut self,
        out: &mut Vec<u8>,
        delimiter: u8,
        max_size: usize,
    ) -> Result<(), crate::Error> {
        out.clear();
        loop {
            if out.len() >= max_size {
                return Err(crate::err!(StreamTooLong));
            }
            let b = self.read_byte()?;
            if b == delimiter {
                return Ok(());
            }
            out.push(b);
        }
    }
}

/// Unbuffered stdin byte reader (`std.fs.File.stdin().readerStreaming(..)` in
/// the Zig). Each `take_byte` is a 1-byte blocking read on the process stdin.
pub struct StdinReader {
    fd: Fd,
}

impl StdinReader {
    /// Zig `Reader.takeByte` — `Err` on I/O error *or* EOF.
    #[inline]
    pub fn take_byte(&mut self) -> Result<u8, crate::Error> {
        let mut one = [0u8; 1];
        match output_sink().read(self.fd, &mut one)? {
            0 => Err(crate::err!(EndOfStream)),
            _ => Ok(one[0]),
        }
    }
    /// Alias for callers that spell it `read_byte`.
    #[inline]
    pub fn read_byte(&mut self) -> Result<u8, crate::Error> {
        self.take_byte()
    }
}

/// `std.fs.File.stdin().readerStreaming(&buf)` — fresh, unbuffered stdin
/// reader. Used by `alert()`/`confirm()` which read a handful of bytes.
#[inline]
pub fn stdin_reader() -> StdinReader {
    StdinReader { fd: Fd::stdin() }
}

/// `bun.Output.buffered_stdin` — raw pointer to the process-global 4 KiB
/// buffered stdin. Used by `prompt()`/`bun init`/`bun publish` line reads.
///
/// Returns `*mut` (not `&'static mut`) to avoid handing out two live aliasing
/// `&mut` to the same static (PORTING.md §Forbidden); callers materialise the
/// `&mut` at the use site. Matches the other self-ref escapes in this module
/// (`writer()`, `error_writer()`, …).
///
/// SAFETY: the static is single-threaded by construction (only ever touched
/// from the main JS/CLI thread while blocked on user input).
#[inline]
pub fn buffered_stdin() -> *mut BufferedStdin {
    BUFFERED_STDIN.get()
    // TODO(port): self-ref pointer escape — see error_writer()
}

/// `bun.Output.buffered_stdin.reader()` — same accessor as [`buffered_stdin`];
/// the Zig spelling exposed the static itself and callers chained `.reader()`.
#[inline]
pub fn buffered_stdin_reader() -> *mut BufferedStdin {
    buffered_stdin()
}

/// Convenience for `bun.Output.buffered_stdin.reader().readUntilDelimiterArrayList`.
#[inline]
pub fn buffered_stdin_read_until_delimiter(
    out: &mut Vec<u8>,
    delimiter: u8,
    max_size: usize,
) -> Result<(), crate::Error> {
    // SAFETY: single-threaded static; only live `&mut` for this call's duration.
    unsafe { (*buffered_stdin()).read_until_delimiter_array_list(out, delimiter, max_size) }
}

/// https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036
pub const SYNCHRONIZED_START: &str = "\x1b[?2026h";

/// https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036
pub const SYNCHRONIZED_END: &str = "\x1b[?2026l";

/// https://gist.github.com/christianparpart/d8a62cc1ab659194337d73e399004036
pub fn synchronized() -> Synchronized {
    Synchronized::begin()
}

pub struct Synchronized;

impl Synchronized {
    pub fn begin() -> Synchronized {
        #[cfg(unix)]
        {
            print(format_args!("{}", SYNCHRONIZED_START));
        }
        Synchronized
    }

    pub fn end(self) {
        #[cfg(unix)]
        {
            print(format_args!("{}", SYNCHRONIZED_END));
        }
    }
}

#[cfg(test)]
mod output_macro_tests {
    //! Compile-shape regression tests for the `pretty*!`/`note!`/`warn!`/
    //! `debug!` wrapper macros. These don't drive a live `Source` (no I/O);
    //! they assert that the macros *expand* for the shapes the Zig originals
    //! accept and that the `*ln!` newline guard const-evaluates correctly.
    use super::_needs_nl;
    use bun_core_macros::pretty_fmt;

    /// `note!`/`warn!`/`debug!` must accept a `concat!(..)` template — Zig's
    /// `note(comptime fmt, args)` is routinely called with `"a" ++ "b"`. The
    /// `:literal` matcher rejected this; `:expr` + proc-macro `concat!`
    /// flattening makes it compile.
    #[test]
    fn prefix_wrappers_accept_concat() {
        if false {
            crate::note!(concat!("from ", "two parts {}"), 1);
            crate::warn!(concat!("w ", "{}"), 2);
            crate::debug!(concat!("d ", "{}"), 3);
            crate::debug_warn!(concat!("dw"));
            crate::err_generic!(concat!("e ", "{}"), 4);
            // …and still accept plain literals.
            crate::note!("plain {}", 1);
            crate::warn!("plain");
        }
    }

    /// `pretty!`/`pretty_error!`/`prettyln!`/`pretty_errorln!` bind each arg
    /// once into a `match` tuple; a side-effecting block arg must therefore be
    /// usable, and a moved non-`Copy` value must remain usable afterwards
    /// (the macro takes `&($arg)`, never moves).
    #[test]
    fn pretty_binds_args_once() {
        if false {
            let mut n = 0i32;
            crate::pretty!("{}", {
                n += 1;
                n
            });
            let _ = n;

            let s = String::from("x");
            crate::pretty_errorln!("{} {}", s, s.len());
            // `s` was borrowed, not moved, by the match-tuple binding.
            drop(s);

            crate::prettyln!("{} {} {}", 1, "two", 3.0);
            crate::pretty_error!("<r>{}", 0);
        }
    }

    /// `*ln!` macros must not append a second `\n` when the template already
    /// ends in one. The guard runs on the *processed* template (`pretty_fmt!`
    /// flattens `concat!`), so a wrapper-prefixed template that ends in `\n`
    /// still suppresses the extra newline.
    #[test]
    fn ln_macros_suppress_double_newline() {
        // Direct templates.
        const A: &str = _needs_nl(pretty_fmt!("hello\n", false));
        assert_eq!(A, "");
        const B: &str = _needs_nl(pretty_fmt!("hello", false));
        assert_eq!(B, "\n");
        // `note!("hi\n")` → `pretty_errorln!(concat!("<blue>note<r><d>:<r> ", "hi\n"))`
        const C: &str = _needs_nl(pretty_fmt!(concat!("<blue>note<r><d>:<r> ", "hi\n"), false));
        assert_eq!(C, "", "note!(\"hi\\n\") would double-newline");
        // Trailing reset tag does not defeat the guard (the stripped template
        // is what's checked).
        const D: &str = _needs_nl(pretty_fmt!("done<r>\n", false));
        assert_eq!(D, "");
    }
}

#[cfg(test)]
mod pretty_fmt_tests {
    //! Parity checks between the `pretty_fmt!` proc-macro (compile-time) and
    //! `pretty_fmt_runtime` (1:1 port of Zig `prettyFmt`). Guards against the
    //! macro leaking raw `<r>`/`<b>` markup into help text.
    use super::{RESET, pretty_fmt_runtime};
    use bun_core_macros::pretty_fmt;

    #[test]
    fn reset_tag_emits_ansi_or_nothing() {
        assert_eq!(pretty_fmt!("<r>", true), RESET);
        assert_eq!(pretty_fmt!("<r>", false), "");
        assert_eq!(pretty_fmt!("</b>", true), RESET);
        assert_eq!(pretty_fmt!("</b>", false), "");
    }

    #[test]
    fn color_tags_emit_ansi() {
        assert_eq!(pretty_fmt!("<red>x<r>", true), "\x1b[31mx\x1b[0m");
        assert_eq!(pretty_fmt!("<red>x<r>", false), "x");
        assert_eq!(
            pretty_fmt!("<b><green>bun<r>", true),
            "\x1b[1m\x1b[32mbun\x1b[0m"
        );
        assert_eq!(pretty_fmt!("<b><green>bun<r>", false), "bun");
    }

    #[test]
    fn escaped_angle_brackets_survive() {
        // `\<folder\>` must round-trip to literal `<folder>` and never be
        // mistaken for a tag.
        assert_eq!(pretty_fmt!("\\<folder\\>", true), "<folder>");
        assert_eq!(pretty_fmt!("\\<folder\\>", false), "<folder>");
    }

    #[test]
    fn format_specs_with_angle_brackets_pass_through() {
        // `{:<16}` / `{:>.2}` contain `<`/`>` *inside* a format spec — the
        // brace scanner must shield them from the tag parser.
        assert_eq!(pretty_fmt!("<d>{:<16}<r>", true), "\x1b[2m{:<16}\x1b[0m");
        assert_eq!(pretty_fmt!("<d>{:<16}<r>", false), "{:<16}");
        assert_eq!(pretty_fmt!("<b>{:>.2}ms<r>", false), "{:>.2}ms");
    }

    #[test]
    fn zig_spec_rewrites() {
        assert_eq!(pretty_fmt!("{s}", true), "{}");
        assert_eq!(pretty_fmt!("{d}", true), "{}");
        assert_eq!(pretty_fmt!("{any}", true), "{:?}");
        assert_eq!(pretty_fmt!("{?}", true), "{:?}");
    }

    #[test]
    fn concat_and_stringify_inputs() {
        assert_eq!(
            pretty_fmt!(concat!("<r><d>[", stringify!(http), "]<r> "), true),
            "\x1b[0m\x1b[2m[http]\x1b[0m ",
        );
    }

    #[test]
    fn no_raw_tags_leak_into_help_header() {
        // First line of `bun --help` — must contain no `<r>` / `<b>` literals.
        const ON: &str = pretty_fmt!(
            "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>({s})<r>\n",
            true
        );
        const OFF: &str = pretty_fmt!(
            "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>({s})<r>\n",
            false
        );
        assert!(!ON.contains("<r>"), "raw <r> leaked: {ON:?}");
        assert!(!ON.contains("<b>"), "raw <b> leaked: {ON:?}");
        assert!(ON.contains("\x1b["), "no ANSI emitted: {ON:?}");
        assert_eq!(
            OFF,
            "Bun is a fast JavaScript runtime, package manager, bundler, and test runner. ({})\n",
        );
    }

    #[test]
    fn macro_matches_runtime() {
        // Spot-check macro output against the runtime reference (which is 1:1
        // with Zig `prettyFmt`) for the help-text shapes that matter.
        macro_rules! check {
            ($s:literal) => {{
                assert_eq!(
                    pretty_fmt!($s, true).as_bytes(),
                    pretty_fmt_runtime($s.as_bytes(), true).as_slice(),
                    "enabled mismatch for {:?}",
                    $s,
                );
                assert_eq!(
                    pretty_fmt!($s, false).as_bytes(),
                    pretty_fmt_runtime($s.as_bytes(), false).as_slice(),
                    "disabled mismatch for {:?}",
                    $s,
                );
            }};
        }
        check!("<b>Usage<r>: <b><green>bun init<r> <cyan>[flags]<r> <blue>[\\<folder\\>]<r>\n");
        check!("<r><d>[<b>{d:>.2}ms<r><d>]<r>");
        check!("<r><red>error<r><d>:<r> ");
        check!(
            "  <b><blue>link<r>      <d>[\\<package\\>]<r>          Register or link a local npm package\n"
        );
    }
}

// ported from: src/bun_core/output.zig
