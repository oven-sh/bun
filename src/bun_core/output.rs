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
use core::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};

use bun_core::env_var;
use bun_core::Global;
use bun_str::strings;
use bun_sys::File;
use bun_sys::Fd;
use bun_threading::Mutex;

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
// TODO(port): lifetime — guarded by STDOUT_STREAM_SET (write-once at startup before threads)
static mut STDERR_STREAM: StreamType = StreamType::ZEROED;
static mut STDOUT_STREAM: StreamType = StreamType::ZEROED;
static STDOUT_STREAM_SET: AtomicBool = AtomicBool::new(false);

// Track which stdio descriptors are TTYs (0=stdin, 1=stdout, 2=stderr)
#[unsafe(no_mangle)]
pub static mut bun_stdio_tty: [i32; 3] = [0, 0, 0];

// TODO(port): bun_sys::Winsize repr(C) matching std.posix.winsize
pub static mut TERMINAL_SIZE: bun_sys::Winsize = bun_sys::Winsize {
    row: 0,
    col: 0,
    xpixel: 0,
    ypixel: 0,
};

// ──────────────────────────────────────────────────────────────────────────
// Source
// ──────────────────────────────────────────────────────────────────────────

/// `Source.StreamType` — `File` on native, a fixed-buffer stream on WASM.
#[cfg(not(target_arch = "wasm32"))]
pub type StreamType = File;
#[cfg(target_arch = "wasm32")]
pub type StreamType = bun_io::FixedBufferStream; // TODO(port): wasm fixed buffer stream

/// `@TypeOf(StreamType.quietWriter(undefined)).Adapter` — the buffered-writer adapter
/// wrapping a `File::QuietWriter` and exposing a `std.Io.Writer` (`bun_io::Writer`) interface.
// TODO(port): exact type lives in bun_sys::File; named here for clarity.
pub type QuietWriterAdapter = <File as bun_sys::QuietWrite>::Adapter;

pub struct Source {
    pub stdout_buffer: [u8; 4096],
    pub stderr_buffer: [u8; 4096],
    pub buffered_stream_backing: QuietWriterAdapter,
    pub buffered_error_stream_backing: QuietWriterAdapter,
    // Self-referential: point into `*_backing.new_interface`. Replaced with accessor
    // methods in Rust; raw fields kept to mirror Zig field order.
    // (LIFETIMES.tsv: BORROW_FIELD — self-ref into buffered_*_backing)
    buffered_stream: *mut bun_io::Writer,
    buffered_error_stream: *mut bun_io::Writer,

    pub stream_backing: QuietWriterAdapter,
    pub error_stream_backing: QuietWriterAdapter,
    // Self-referential (BORROW_FIELD)
    stream: *mut bun_io::Writer,
    error_stream: *mut bun_io::Writer,

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
    pub const ZEROED: Self = unsafe { core::mem::zeroed() };

    /// Accessors replacing the self-referential `*std.Io.Writer` fields.
    #[inline]
    pub fn buffered_stream(&mut self) -> &mut bun_io::Writer {
        self.buffered_stream_backing.new_interface()
    }
    #[inline]
    pub fn buffered_error_stream(&mut self) -> &mut bun_io::Writer {
        self.buffered_error_stream_backing.new_interface()
    }
    #[inline]
    pub fn stream(&mut self) -> &mut bun_io::Writer {
        self.stream_backing.new_interface()
    }
    #[inline]
    pub fn error_stream(&mut self) -> &mut bun_io::Writer {
        self.error_stream_backing.new_interface()
    }

    // TODO(port): in-place init — `out` is the pre-allocated thread_local slot; PORTING.md
    // says keep `&mut MaybeUninit<Self>` (or reshape to `-> Self`) for out-param ctors.
    pub fn init(out: &mut Source, stream: StreamType, err_stream: StreamType) {
        if cfg!(debug_assertions) && bun_alloc::USE_MIMALLOC && !SOURCE_SET.get() {
            bun_alloc::mimalloc::mi_option_set(bun_alloc::mimalloc::Option::ShowErrors, 1);
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
        out.buffered_stream = out.buffered_stream_backing.new_interface() as *mut _;
        out.buffered_error_stream = out.buffered_error_stream_backing.new_interface() as *mut _;

        out.stream_backing = out.raw_stream.quiet_writer().adapt_to_new_api(&mut []);
        out.error_stream_backing = out.raw_error_stream.quiet_writer().adapt_to_new_api(&mut []);
        out.stream = out.stream_backing.new_interface() as *mut _;
        out.error_stream = out.error_stream_backing.new_interface() as *mut _;
    }

    pub fn configure_thread() {
        if SOURCE_SET.get() {
            return;
        }
        debug_assert!(STDOUT_STREAM_SET.load(Ordering::Relaxed));
        // SAFETY: STDOUT_STREAM/STDERR_STREAM are write-once before any thread calls this.
        SOURCE.with_borrow_mut(|s| unsafe { Source::init(s, STDOUT_STREAM, STDERR_STREAM) });
        bun_core::StackCheck::configure_thread();
    }

    pub fn configure_named_thread(name: &bun_str::ZStr) {
        Global::set_thread_name(name);
        Self::configure_thread();
    }

    pub fn is_no_color() -> bool {
        env_var::NO_COLOR.get()
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
        COLOR_DEPTH_ONCE.call_once(get_color_depth_once);
        // SAFETY: written exactly once under COLOR_DEPTH_ONCE.
        unsafe { LAZY_COLOR_DEPTH }
    }

    pub fn set_init(stdout: StreamType, stderr: StreamType) {
        SOURCE.with_borrow_mut(|s| Source::init(s, stdout, stderr));

        SOURCE_SET.set(true);
        if !STDOUT_STREAM_SET.load(Ordering::Relaxed) {
            STDOUT_STREAM_SET.store(true, Ordering::Relaxed);
            #[cfg(not(target_arch = "wasm32"))]
            {
                // SAFETY: bun_stdio_tty is plain data written at startup.
                let is_stdout_tty = unsafe { bun_stdio_tty[1] } != 0;
                if is_stdout_tty {
                    // SAFETY: write-once at startup under STDOUT_STREAM_SET guard before threads.
                    unsafe { STDOUT_DESCRIPTOR_TYPE = OutputStreamDescriptor::Terminal };
                }

                let is_stderr_tty = unsafe { bun_stdio_tty[2] } != 0;
                if is_stderr_tty {
                    // SAFETY: write-once at startup under STDOUT_STREAM_SET guard before threads.
                    unsafe { STDERR_DESCRIPTOR_TYPE = OutputStreamDescriptor::Terminal };
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
                STDOUT_STREAM = stdout;
                STDERR_STREAM = stderr;
            }
        }
    }
}

// ── Source::WindowsStdio ──────────────────────────────────────────────────

#[cfg(windows)]
pub mod windows_stdio {
    use super::*;
    use bun_sys::windows as w;
    use bun_sys::windows::c;

    /// At program start, we snapshot the console modes of standard in, out, and err
    /// so that we can restore them at program exit if they change. Restoration is
    /// best-effort, and may not be applied if the process is killed abruptly.
    pub static mut CONSOLE_MODE: [Option<u32>; 3] = [None, None, None];
    pub static mut CONSOLE_CODEPAGE: u32 = 0;
    pub static mut CONSOLE_OUTPUT_CODEPAGE: u32 = 0;

    #[unsafe(no_mangle)]
    pub extern "C" fn Bun__restoreWindowsStdio() {
        restore();
    }

    pub fn restore() {
        // SAFETY: PEB access is sound on Windows; handles are valid for process lifetime.
        let peb = unsafe { w::peb() };
        let stdout = peb.ProcessParameters.hStdOutput;
        let stderr = peb.ProcessParameters.hStdError;
        let stdin = peb.ProcessParameters.hStdInput;

        let handles = [stdin, stdout, stderr];
        // SAFETY: CONSOLE_MODE is only mutated at init/restore on the main thread.
        for (mode, handle) in unsafe { CONSOLE_MODE }.iter().zip(handles.iter()) {
            if let Some(m) = *mode {
                // SAFETY: FFI call; `handle` is a valid console handle from the PEB.
                unsafe { c::SetConsoleMode(*handle, m) };
            }
        }

        // SAFETY: CONSOLE_*_CODEPAGE are plain `u32` written once at init on the main
        // thread; FFI calls have no preconditions beyond a valid codepage id.
        unsafe {
            if CONSOLE_OUTPUT_CODEPAGE != 0 {
                c::SetConsoleOutputCP(CONSOLE_OUTPUT_CODEPAGE);
            }
            if CONSOLE_CODEPAGE != 0 {
                c::SetConsoleCP(CONSOLE_CODEPAGE);
            }
        }
    }

    pub fn init() {
        // SAFETY: FFI call with no preconditions.
        unsafe { w::libuv::uv_disable_stdio_inheritance() };

        let stdin = w::GetStdHandle(w::STD_INPUT_HANDLE).unwrap_or(w::INVALID_HANDLE_VALUE);
        let stdout = w::GetStdHandle(w::STD_OUTPUT_HANDLE).unwrap_or(w::INVALID_HANDLE_VALUE);
        let stderr = w::GetStdHandle(w::STD_ERROR_HANDLE).unwrap_or(w::INVALID_HANDLE_VALUE);

        use bun_sys::fd as fd_internals;
        let invalid = w::INVALID_HANDLE_VALUE;
        // SAFETY: single-threaded startup; these statics are write-once caches.
        unsafe {
            fd_internals::WINDOWS_CACHED_STDERR =
                if stderr != invalid { Fd::from_system(stderr) } else { Fd::INVALID };
            fd_internals::WINDOWS_CACHED_STDOUT =
                if stdout != invalid { Fd::from_system(stdout) } else { Fd::INVALID };
            fd_internals::WINDOWS_CACHED_STDIN =
                if stdin != invalid { Fd::from_system(stdin) } else { Fd::INVALID };
        }
        #[cfg(debug_assertions)]
        // SAFETY: single-threaded startup; write-once debug flag.
        unsafe {
            fd_internals::WINDOWS_CACHED_FD_SET = true;
        }

        // SAFETY: BUFFERED_STDIN is a static initialized at startup before use.
        unsafe {
            BUFFERED_STDIN.unbuffered_reader.context.handle = Fd::stdin();
        }

        // https://learn.microsoft.com/en-us/windows/console/setconsoleoutputcp
        const CP_UTF8: u32 = 65001;
        // SAFETY: single-threaded startup; FFI calls have no preconditions; statics are
        // write-once caches restored in `restore()`.
        unsafe {
            CONSOLE_OUTPUT_CODEPAGE = c::GetConsoleOutputCP();
            c::SetConsoleOutputCP(CP_UTF8);

            CONSOLE_CODEPAGE = c::GetConsoleCP();
            c::SetConsoleCP(CP_UTF8);
        }

        let mut mode: w::DWORD = 0;
        // SAFETY: single-threaded startup; `stdin/stdout/stderr` are valid handles (or
        // INVALID_HANDLE_VALUE, which Get/SetConsoleMode reject with 0); CONSOLE_MODE /
        // bun_stdio_tty are write-once caches.
        unsafe {
            if c::GetConsoleMode(stdin, &mut mode) != 0 {
                CONSOLE_MODE[0] = Some(mode);
                bun_stdio_tty[0] = 1;
                // There are no flags to set on standard in, but just in case something
                // later modifies the mode, we can still reset it at the end of program run
                //
                // In the past, Bun would set ENABLE_VIRTUAL_TERMINAL_INPUT, which was not
                // intentionally set for any purpose, and instead only caused problems.
            }

            if c::GetConsoleMode(stdout, &mut mode) != 0 {
                CONSOLE_MODE[1] = Some(mode);
                bun_stdio_tty[1] = 1;
                c::SetConsoleMode(
                    stdout,
                    w::ENABLE_PROCESSED_OUTPUT
                        | w::ENABLE_VIRTUAL_TERMINAL_PROCESSING
                        | w::ENABLE_WRAP_AT_EOL_OUTPUT
                        | mode,
                );
            }

            if c::GetConsoleMode(stderr, &mut mode) != 0 {
                CONSOLE_MODE[2] = Some(mode);
                bun_stdio_tty[2] = 1;
                c::SetConsoleMode(
                    stderr,
                    w::ENABLE_PROCESSED_OUTPUT
                        | w::ENABLE_VIRTUAL_TERMINAL_PROCESSING
                        | w::ENABLE_WRAP_AT_EOL_OUTPUT
                        | mode,
                );
            }
        }
    }
}

// ── Source::Stdio ─────────────────────────────────────────────────────────

pub mod stdio {
    use super::*;

    // TODO(port): move to bun_core_sys
    unsafe extern "C" {
        pub static mut bun_is_stdio_null: [i32; 3];
        pub fn bun_initialize_process();
        pub fn bun_restore_stdio();
    }

    pub fn is_stderr_null() -> bool {
        // SAFETY: bun_is_stdio_null is plain data written once by C at startup before threads.
        unsafe { bun_is_stdio_null[2] == 1 }
    }
    pub fn is_stdout_null() -> bool {
        // SAFETY: bun_is_stdio_null is plain data written once by C at startup before threads.
        unsafe { bun_is_stdio_null[1] == 1 }
    }
    pub fn is_stdin_null() -> bool {
        // SAFETY: bun_is_stdio_null is plain data written once by C at startup before threads.
        unsafe { bun_is_stdio_null[0] == 1 }
    }

    pub fn init() {
        // SAFETY: FFI call with no preconditions; called once at process startup.
        unsafe { bun_initialize_process() };

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
            // SAFETY: FFI call with no preconditions.
            unsafe { bun_restore_stdio() };
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

static mut LAZY_COLOR_DEPTH: ColorDepth = ColorDepth::None;
static COLOR_DEPTH_ONCE: std::sync::Once = std::sync::Once::new();

fn get_color_depth_once() {
    // SAFETY: only called under COLOR_DEPTH_ONCE.
    let set = |d| unsafe { LAZY_COLOR_DEPTH = d };

    if let Some(depth) = Source::get_force_color_depth() {
        set(depth);
        return;
    }

    if Source::is_no_color() {
        return;
    }

    let term = env_var::TERM.get().unwrap_or(b"");
    if term == b"dumb" {
        return;
    }

    if env_var::TMUX.get().is_some() {
        set(ColorDepth::C256);
        return;
    }

    if env_var::CI.get().is_some() {
        set(ColorDepth::C16);
        return;
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
                set(ColorDepth::C16m);
                return;
            }
        }
    }

    let mut has_color_term_set = false;

    if let Some(color_term) = env_var::COLORTERM.get() {
        if color_term == b"truecolor" || color_term == b"24bit" {
            set(ColorDepth::C16m);
            return;
        }
        has_color_term_set = true;
    }

    if !term.is_empty() {
        if term.starts_with(b"xterm-256") {
            set(ColorDepth::C256);
            return;
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
                set(depth);
                return;
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
            set(ColorDepth::C16);
            return;
        }
    }

    if has_color_term_set {
        set(ColorDepth::C16);
        return;
    }

    set(ColorDepth::None);
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

pub static mut STDERR_DESCRIPTOR_TYPE: OutputStreamDescriptor = OutputStreamDescriptor::Unknown;
pub static mut STDOUT_DESCRIPTOR_TYPE: OutputStreamDescriptor = OutputStreamDescriptor::Unknown;

#[inline]
pub fn is_stdout_tty() -> bool {
    // SAFETY: bun_stdio_tty is plain data written once at startup before threads.
    unsafe { bun_stdio_tty[1] != 0 }
}
#[inline]
pub fn is_stderr_tty() -> bool {
    // SAFETY: bun_stdio_tty is plain data written once at startup before threads.
    unsafe { bun_stdio_tty[2] != 0 }
}
#[inline]
pub fn is_stdin_tty() -> bool {
    // SAFETY: bun_stdio_tty is plain data written once at startup before threads.
    unsafe { bun_stdio_tty[0] != 0 }
}

pub fn is_github_action() -> bool {
    if env_var::GITHUB_ACTIONS.get() {
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
        if env_var::CLAUDECODE.get() {
            return true;
        }
        // Replit.
        if env_var::REPL_ID.get() {
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

pub fn is_verbose() -> bool {
    // Set by Github Actions when a workflow is run using debug mode.
    env_var::RUNNER_DEBUG.get()
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

pub type WriterType = bun_sys::file::QuietWriter;

pub fn raw_error_writer() -> StreamType {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow(|s| s.raw_error_stream)
}

// TODO: investigate migrating this to the buffered one.
pub fn error_writer() -> *mut bun_io::Writer {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow_mut(|s| s.error_stream() as *mut _)
    // TODO(port): self-ref pointer escape — callers should use a `with_error_writer(|w| ...)` API
}

pub fn error_writer_buffered() -> *mut bun_io::Writer {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow_mut(|s| s.buffered_error_stream() as *mut _)
    // TODO(port): self-ref pointer escape — see error_writer()
}

// TODO: investigate returning the buffered_error_stream
pub fn error_stream() -> *mut bun_io::Writer {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow_mut(|s| s.error_stream() as *mut _)
    // TODO(port): self-ref pointer escape
}

pub fn raw_writer() -> StreamType {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow(|s| s.raw_stream)
}

pub fn writer() -> *mut bun_io::Writer {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow_mut(|s| s.stream() as *mut _)
    // TODO(port): self-ref pointer escape
}

pub fn writer_buffered() -> *mut bun_io::Writer {
    debug_assert!(SOURCE_SET.get());
    SOURCE.with_borrow_mut(|s| s.buffered_stream() as *mut _)
    // TODO(port): self-ref pointer escape
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
        SOURCE.with_borrow_mut(|s| {
            let _ = s.buffered_stream().flush();
            let _ = s.buffered_error_stream().flush();
            // let _ = s.stream().flush();
            // let _ = s.error_stream().flush();
        });
    }
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
        Self { colors: false, duration_ns: 0 }
    }
}

impl fmt::Display for ElapsedFormatter {
    fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        const NS_PER_MS: u64 = 1_000_000;
        let ms = self.duration_ns as f64 / NS_PER_MS as f64;
        // PERF(port): was comptime bool dispatch on `colors` — profile in Phase B
        match self.duration_ns {
            0..=const { NS_PER_MS * 10 } => {
                if self.colors {
                    write!(w, pretty_fmt!("<r><d>[{:>.2}ms<r><d>]<r>", true), ms)
                } else {
                    write!(w, pretty_fmt!("<r><d>[{:>.2}ms<r><d>]<r>", false), ms)
                }
            }
            const { NS_PER_MS * 8_000 }..=u64::MAX => {
                if self.colors {
                    write!(w, pretty_fmt!("<r><d>[<r><yellow>{:>.2}ms<r><d>]<r>", true), ms)
                } else {
                    write!(w, pretty_fmt!("<r><d>[<r><yellow>{:>.2}ms<r><d>]<r>", false), ms)
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

#[inline]
fn print_elapsed_to_with_ctx<C>(
    elapsed: f64,
    printer: impl Fn(Option<&C>, fmt::Arguments<'_>),
    has_ctx: bool,
    ctx: Option<&C>,
) {
    // TODO(port): Zig passed comptime fmt strings to a `(comptime fmt, args)` printer; in Rust
    // the printer takes pre-built `fmt::Arguments` and the pretty_fmt! rewrite happens here.
    let _ = has_ctx;
    match elapsed.round() as i64 {
        0..=1500 => {
            printer(ctx, format_args!(pretty_fmt!("<r><d>[<b>{:>.2}ms<r><d>]<r>", true), elapsed));
            // PORT NOTE: color/no-color branching moved into callers via pretty()/pretty_error()
        }
        _ => {
            printer(
                ctx,
                format_args!(pretty_fmt!("<r><d>[<b>{:>.2}s<r><d>]<r>", true), elapsed / 1000.0),
            );
        }
    }
}

#[inline]
pub fn print_elapsed_to<C>(elapsed: f64, printer: impl Fn(&C, fmt::Arguments<'_>), ctx: &C) {
    match elapsed.round() as i64 {
        0..=1500 => printer(ctx, format_args!("[{:>.2}ms]", elapsed)),
        _ => printer(ctx, format_args!("[{:>.2}s]", elapsed / 1000.0)),
    }
    // TODO(port): pretty_fmt! color tags — see print_elapsed_to_with_ctx
}

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
    const NS_PER_MS: i64 = 1_000_000;
    let elapsed = ((end - start) as i64) / NS_PER_MS;
    print_elapsed(elapsed as f64);
}

pub fn print_start_end_stdout(start: i128, end: i128) {
    const NS_PER_MS: i64 = 1_000_000;
    let elapsed = ((end - start) as i64) / NS_PER_MS;
    print_elapsed_stdout(elapsed as f64);
}

pub fn print_timer(timer: &mut bun_perf::SystemTimer) {
    #[cfg(target_arch = "wasm32")]
    {
        return;
    }
    const NS_PER_MS: u64 = 1_000_000;
    let elapsed = timer.read() / NS_PER_MS;
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
#[inline(never)]
fn with_dest_writer<R>(dest: Destination, f: impl FnOnce(&mut bun_io::Writer) -> R) -> R {
    debug_assert!(SOURCE_SET.get());
    let buffering = ENABLE_BUFFERING.load(Ordering::Relaxed);
    SOURCE.with_borrow_mut(|s| match dest {
        Destination::Stdout => f(if buffering { s.buffered_stream() } else { s.stream() }),
        Destination::Stderr => {
            f(if buffering { s.buffered_error_stream() } else { s.error_stream() })
        }
    })
}

/// Single shared write path for pre-formatted bytes.
#[inline(never)]
fn write_bytes(dest: Destination, bytes: &[u8]) {
    with_dest_writer(dest, |w| {
        let _ = w.write_all(bytes);
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
        let _ = w.write_fmt(args);
    });
}

#[inline]
pub fn print_errorable(args: fmt::Arguments<'_>) -> Result<(), bun_core::Error> {
    print_to(Destination::Stdout, args);
    Ok(())
}

/// Print to stdout
/// This will appear in the terminal, including in production.
/// Text automatically buffers
#[macro_export]
macro_rules! println {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::output::print_to($crate::output::Destination::Stdout,
            ::core::format_args!(concat!($fmt, "\n") $(, $arg)*))
    };
}

/// Print to stdout, but only in debug builds.
/// Text automatically buffers
#[macro_export]
macro_rules! debug {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        if cfg!(debug_assertions) {
            $crate::pretty_errorln!(concat!("<d>DEBUG:<r> ", $fmt) $(, $arg)*);
            $crate::output::flush();
        }
    };
}

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
        if condition { Visibility::Visible } else { Visibility::Hidden }
    }
}

/// Runtime state for one scoped logger. One static instance per `declare_scope!`.
pub struct ScopedLogger {
    pub tagname: &'static str, // already lowercased
    really_disable: AtomicBool,
    is_visible_once: std::sync::Once,
    lock: Mutex,
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
            lock: Mutex::new(),
            out_set: AtomicBool::new(false),
        }
    }

    fn evaluate_is_visible(&self) {
        // BUN_DEBUG_<tagname>
        let mut env_key = [0u8; 64];
        let prefix = b"BUN_DEBUG_";
        env_key[..prefix.len()].copy_from_slice(prefix);
        let tag = self.tagname.as_bytes();
        env_key[prefix.len()..prefix.len() + tag.len()].copy_from_slice(tag);
        let key = &env_key[..prefix.len() + tag.len()];

        if let Some(val) = bun_core::getenv_z_any_case(key) {
            self.really_disable.store(val == b"0", Ordering::Relaxed);
        } else if let Some(val) = env_var::BUN_DEBUG_ALL.get() {
            self.really_disable.store(!val, Ordering::Relaxed);
        } else if let Some(val) = env_var::BUN_DEBUG_QUIET_LOGS.get() {
            self.really_disable
                .store(self.really_disable.load(Ordering::Relaxed) || val, Ordering::Relaxed);
        } else {
            // --debug-<tagname> / --debug-all
            let mut flag = [0u8; 64];
            let pfx = b"--debug-";
            flag[..pfx.len()].copy_from_slice(pfx);
            flag[pfx.len()..pfx.len() + tag.len()].copy_from_slice(tag);
            let flag_slice = &flag[..pfx.len() + tag.len()];
            for arg in bun_core::argv() {
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
        self.is_visible_once.call_once(|| self.evaluate_is_visible());
        !self.really_disable.load(Ordering::Relaxed)
    }

    /// Debug-only logs which should not appear in release mode
    /// To enable a specific log at runtime, set the environment variable
    ///   BUN_DEBUG_${TAG} to 1
    /// For example, to enable the "foo" log, set the environment variable
    ///   BUN_DEBUG_foo=1
    /// To enable all logs, set the environment variable
    ///   BUN_DEBUG_ALL=1
    pub fn log(&self, colored: fmt::Arguments<'_>, plain: fmt::Arguments<'_>) {
        if !Environment::ENABLE_LOGS {
            return;
        }
        if !SOURCE_SET.get() {
            return;
        }
        if scoped_debug_writer::DISABLE_INSIDE_LOG.get() > 0 {
            return;
        }
        if bun_crash_handler::is_panicking() {
            return;
        }

        scoped_debug_writer::DISABLE_INSIDE_LOG.set(scoped_debug_writer::DISABLE_INSIDE_LOG.get() + 1);
        let _guard = scopeguard::guard((), |_| {
            scoped_debug_writer::DISABLE_INSIDE_LOG
                .set(scoped_debug_writer::DISABLE_INSIDE_LOG.get() - 1);
        });

        if !self.is_visible() {
            return;
        }

        // TODO(port): per-scope `[4096]u8` buffered adapter (`out`/`out_set`/`buffered_writer`)
        let _ = self.out_set.load(Ordering::Relaxed);

        let _lock = self.lock.lock();

        let use_ansi = ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed)
            && SOURCE_SET.get()
            && scoped_writer().context_handle() == raw_writer().handle();

        let mut out = scoped_writer();
        // PERF(port): was comptime bool dispatch on use_ansi — profile in Phase B
        let result = if use_ansi {
            out.write_fmt(colored).and_then(|_| out.flush())
        } else {
            out.write_fmt(plain).and_then(|_| out.flush())
        };
        if result.is_err() {
            self.really_disable.store(true, Ordering::Relaxed);
        }
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
        pub static $name: $crate::output::ScopedLogger =
            $crate::output::ScopedLogger::new(
                // TODO(port): lowercase tagname at compile time (Zig did std.ascii.toLower)
                stringify!($name),
                $crate::output::Visibility::Hidden,
            );
    };
    ($name:ident, visible) => {
        pub static $name: $crate::output::ScopedLogger =
            $crate::output::ScopedLogger::new(
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
    ($scope:ident, $fmt:literal $(, $arg:expr)* $(,)?) => {
        if cfg!(feature = "debug_logs") && $scope.is_visible() {
            $scope.log(
                ::core::format_args!(
                    $crate::pretty_fmt!(concat!("<r><d>[", stringify!($scope), "]<r> ", $fmt, "\n"), true)
                    $(, $arg)*
                ),
                ::core::format_args!(
                    $crate::pretty_fmt!(concat!("<r><d>[", stringify!($scope), "]<r> ", $fmt, "\n"), false)
                    $(, $arg)*
                ),
            );
        }
    };
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

pub static COLOR_MAP: phf::Map<&'static [u8], &'static str> = phf::phf_map! {
    b"b" => "\x1b[1m",
    b"d" => "\x1b[2m",
    b"i" => "\x1b[3m",
    b"u" => "\x1b[4m",
    b"black" => "\x1b[30m",
    b"red" => "\x1b[31m",
    b"green" => "\x1b[32m",
    b"yellow" => "\x1b[33m",
    b"blue" => "\x1b[34m",
    b"magenta" => "\x1b[35m",
    b"cyan" => "\x1b[36m",
    b"white" => "\x1b[37m",
    b"bgred" => "\x1b[41m",
    b"bggreen" => "\x1b[42m",
};
const RESET: &str = "\x1b[0m";

/// Compile-time `<tag>` → ANSI escape rewriter.
///
/// In Zig this was a `comptime` function building a `[:0]const u8`. In Rust the
/// equivalent must be a proc-macro because it consumes a string literal and emits
/// a new string literal usable as a `format_args!` template.
///
// TODO(port): proc-macro — implement `pretty_fmt!("<red>{s}<r>", true)` → `"\x1b[31m{}\x1b[0m"`.
// The reference algorithm is `pretty_fmt_runtime` below (kept 1:1 with the Zig body
// so the proc-macro can be derived from it / tested against it).
#[macro_export]
macro_rules! pretty_fmt {
    ($fmt:expr, true) => {
        // TODO(port): proc-macro substitution — passthrough for now
        $fmt
    };
    ($fmt:expr, false) => {
        // TODO(port): proc-macro tag stripping — passthrough for now
        $fmt
    };
}

/// Runtime mirror of Zig `prettyFmt` for testing the proc-macro and for the rare
/// dynamic case. Produces the same byte sequence the Zig comptime version would.
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
                    if let Some(lit) = COLOR_MAP.get(color_name) {
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
                    out.extend_from_slice(if is_reset { RESET.as_bytes() } else { color_str.as_bytes() });
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

#[inline]
fn enable_color_for(dest: Destination) -> bool {
    match dest {
        Destination::Stdout => ENABLE_ANSI_COLORS_STDOUT.load(Ordering::Relaxed),
        Destination::Stderr => ENABLE_ANSI_COLORS_STDERR.load(Ordering::Relaxed),
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

#[macro_export]
macro_rules! pretty {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::output::pretty_to(
            $crate::output::Destination::Stdout,
            ::core::format_args!($crate::pretty_fmt!($fmt, true) $(, $arg)*),
            ::core::format_args!($crate::pretty_fmt!($fmt, false) $(, $arg)*),
        )
    };
}

/// Like Output.println, except it will automatically strip ansi color codes if
/// the terminal doesn't support them.
#[macro_export]
macro_rules! prettyln {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::output::pretty_to(
            $crate::output::Destination::Stdout,
            ::core::format_args!(concat!($crate::pretty_fmt!($fmt, true), "\n") $(, $arg)*),
            ::core::format_args!(concat!($crate::pretty_fmt!($fmt, false), "\n") $(, $arg)*),
        )
    };
}

#[macro_export]
macro_rules! print_errorln {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::output::print_to(
            $crate::output::Destination::Stderr,
            ::core::format_args!(concat!($fmt, "\n") $(, $arg)*),
        )
    };
}

#[macro_export]
macro_rules! pretty_error {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::output::pretty_to(
            $crate::output::Destination::Stderr,
            ::core::format_args!($crate::pretty_fmt!($fmt, true) $(, $arg)*),
            ::core::format_args!($crate::pretty_fmt!($fmt, false) $(, $arg)*),
        )
    };
}

/// Print to stderr with ansi color codes automatically stripped out if the
/// terminal doesn't support them. Text is buffered
#[macro_export]
macro_rules! pretty_errorln {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::output::pretty_to(
            $crate::output::Destination::Stderr,
            ::core::format_args!(concat!($crate::pretty_fmt!($fmt, true), "\n") $(, $arg)*),
            ::core::format_args!(concat!($crate::pretty_fmt!($fmt, false), "\n") $(, $arg)*),
        )
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
            printf(format_args!("{}", bstr::BStr::new(argv[0])));
            if argv.len() > 1 {
                for arg in &argv[1..] {
                    printf(format_args!(" {}", bstr::BStr::new(arg)));
                }
            }
            pretty_d!("<r>\n");
        }
        CommandArgv::Single(argv) => {
            pretty_d!("<r><d><magenta>$<r> <d><b>{}<r>\n", bstr::BStr::new(argv));
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

#[inline]
pub fn print_error(args: fmt::Arguments<'_>) {
    print_to(Destination::Stderr, args);
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
            DebugTimer { timer: std::time::Instant::now() }
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
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::pretty_errorln!(concat!("<blue>note<r><d>:<r> ", $fmt) $(, $arg)*)
    };
}

/// Print a yellow warning message to stderr
#[macro_export]
macro_rules! warn {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::pretty_errorln!(concat!("<yellow>warn<r><d>:<r> ", $fmt) $(, $arg)*)
    };
}

/// Print a yellow warning message, only in debug mode
#[macro_export]
macro_rules! debug_warn {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
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
pub fn err(error_name: impl ErrName, args: fmt::Arguments<'_>) {
    if let Some(e) = error_name.as_sys_error() {
        let Some((tag_name, sys_errno)) = e.get_error_code_tag_name() else {
            return err("unknown error", args);
        };
        if let Some(label) = bun_sys::coreutils_error_map::get(sys_errno) {
            pretty_errorln!(
                "<r><red>{}<r><d>:<r> {}: {} <d>({})<r>",
                bstr::BStr::new(tag_name),
                bstr::BStr::new(label),
                args,
                <&'static str>::from(e.syscall),
            );
        } else {
            pretty_errorln!(
                "<r><red>{}<r><d>:<r> {} <d>({})<r>",
                bstr::BStr::new(tag_name),
                args,
                <&'static str>::from(e.syscall),
            );
        }
        return;
    }

    let display_name = error_name.name();
    pretty_errorln!("<red>{}<r><d>:<r> {}", bstr::BStr::new(display_name), args);
}

/// Trait abstracting the `@typeInfo` switch in Zig `err()`.
pub trait ErrName {
    fn name(&self) -> &[u8];
    fn as_sys_error(&self) -> Option<&bun_sys::Error> {
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
impl ErrName for bun_core::Error {
    fn name(&self) -> &[u8] {
        self.name().as_bytes()
    }
}
impl ErrName for bun_sys::Error {
    fn name(&self) -> &[u8] {
        // Unused — as_sys_error() short-circuits.
        b""
    }
    fn as_sys_error(&self) -> Option<&bun_sys::Error> {
        Some(self)
    }
}
impl ErrName for &bun_sys::Error {
    fn name(&self) -> &[u8] {
        b""
    }
    fn as_sys_error(&self) -> Option<&bun_sys::Error> {
        Some(*self)
    }
}
// TODO(port): blanket impl for `T: Into<&'static str>` (strum enums) once coherence allows,
// and for `bun_sys::SystemErrno` (the `.@"enum"` arm in Zig).

// ── ScopedDebugWriter ─────────────────────────────────────────────────────

pub mod scoped_debug_writer {
    use super::*;

    pub static mut SCOPED_FILE_WRITER: bun_sys::file::QuietWriter =
        // SAFETY: initialized in init_scoped_debug_writer_at_startup before first use.
        unsafe { core::mem::zeroed() };

    thread_local! {
        pub static DISABLE_INSIDE_LOG: Cell<isize> = const { Cell::new(0) };
    }
}

pub fn disable_scoped_debug_writer() {
    // Zig: `if (!@inComptime())` — always runtime in Rust.
    scoped_debug_writer::DISABLE_INSIDE_LOG
        .set(scoped_debug_writer::DISABLE_INSIDE_LOG.get() + 1);
}
pub fn enable_scoped_debug_writer() {
    scoped_debug_writer::DISABLE_INSIDE_LOG
        .set(scoped_debug_writer::DISABLE_INSIDE_LOG.get() - 1);
}

// TODO(port): move to bun_core_sys
unsafe extern "C" {
    fn getpid() -> c_int;
}

pub fn init_scoped_debug_writer_at_startup() {
    debug_assert!(SOURCE_SET.get());

    if let Some(path) = env_var::BUN_DEBUG.get() {
        if !path.is_empty() && path != b"0" && path != b"false" {
            if let Some(dir) = bun_paths::dirname(path) {
                // TODO(port): bun_sys::make_path equivalent of std.fs.cwd().makePath
                let _ = bun_sys::make_path(Fd::cwd(), dir);
            }

            // do not use libuv through this code path, since it might not be initialized yet.
            use std::io::Write as _;
            let mut pid = Vec::new();
            // SAFETY: FFI call with no preconditions.
            write!(&mut pid, "{}", unsafe { getpid() }).expect("failed to allocate path");

            let path_fmt = strings::replace_owned(path, b"{pid}", &pid);

            let fd: Fd = match bun_sys::create_file(
                Fd::cwd(),
                &path_fmt,
                bun_sys::CreateFileOptions {
                    mode: if cfg!(unix) { 0o644 } else { 0 },
                    ..Default::default()
                },
            ) {
                Ok(fd) => fd,
                Err(open_err) => {
                    super::panic(format_args!(
                        "Failed to open file for debug output: {} ({})",
                        open_err.name(),
                        bstr::BStr::new(path),
                    ));
                }
            };
            let _ = fd.truncate(0); // windows
            // SAFETY: single-threaded startup.
            unsafe {
                scoped_debug_writer::SCOPED_FILE_WRITER = fd.quiet_writer();
            }
            return;
        }
    }

    // SAFETY: single-threaded startup.
    unsafe {
        scoped_debug_writer::SCOPED_FILE_WRITER =
            SOURCE.with_borrow(|s| s.raw_stream).quiet_writer();
    }
}

fn scoped_writer() -> bun_sys::file::QuietWriter {
    #[cfg(not(any(debug_assertions, feature = "enable_logs")))]
    {
        compile_error!("scopedWriter() should only be called in debug mode");
    }
    // SAFETY: initialized in init_scoped_debug_writer_at_startup; QuietWriter is Copy POD.
    unsafe { scoped_debug_writer::SCOPED_FILE_WRITER }
}

/// Print a red error message with "error: " as the prefix. For custom prefixes see `err()`
#[macro_export]
macro_rules! err_generic {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        $crate::pretty_errorln!(concat!("<r><red>error<r><d>:<r> ", $fmt) $(, $arg)*)
    };
}

/// Print a red error message with "error: " as the prefix and a formatted message.
#[inline]
pub fn err_fmt(formatter: impl fmt::Display) {
    err_generic!("{}", formatter);
}

// TODO(port): bun.deprecated.BufferedReader(4096, File.Reader) — exact type lives in bun_sys
pub static mut BUFFERED_STDIN: bun_sys::deprecated::BufferedReader<4096, bun_sys::file::Reader> =
    bun_sys::deprecated::BufferedReader {
        unbuffered_reader: bun_sys::file::Reader {
            context: bun_sys::file::ReaderContext {
                #[cfg(windows)]
                handle: Fd::INVALID, // set in WindowsStdio.init
                #[cfg(not(windows))]
                handle: Fd::stdin(),
            },
        },
        buf: [0; 4096],
    };

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/output.zig (1380 lines)
//   confidence: medium
//   todos:      29
//   notes:      pretty_fmt!/scoped_log! need a proc-macro; Source self-ref *Writer fields replaced by accessors (TSV BORROW_FIELD); writer()/error_writer() escape raw ptrs and want a with_* closure API; per-scope buffered writer state deferred; many `static mut` need atomics/OnceLock in Phase B; Source::ZEROED relies on mem::zeroed() over QuietWriterAdapter/StreamType (hand-write once layouts fixed).
// ──────────────────────────────────────────────────────────────────────────
