//! Port of src/shell/shell.zig
//! Shell lexer, parser, AST, and JS-bridge utilities for Bun's shell.

#![allow(
    non_camel_case_types,
    non_snake_case,
    dead_code,
    clippy::too_many_arguments
)]

use core::ffi::{c_char, c_int};
use core::fmt;
use core::mem::size_of;
use std::io::Write as _;

use bun_alloc::{Arena as Bump, ArenaVec};
use bun_collections::{IntegerBitSet, VecExt};
use bun_core::{self, Output};
use bun_jsc::{
    self as jsc, CallFrame, JSArrayIterator, JSGlobalObject, JSValue, JsResult,
    MarkedArgumentBuffer, PlatformEventLoop,
};
use bun_jsc::{StringJsc as _, SysErrorJsc as _};
// `VirtualMachine`/`MiniEventLoop` are re-exported as *modules* by bun_jsc; pull the inner types.
use bun_core::strings;
use bun_core::{OwnedString, String as BunString, ZStr};
use bun_jsc::MiniEventLoop::MiniEventLoop;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_simdutf_sys::simdutf;
use bun_sys::{self as sys, Fd, SystemError};

// ───────────────────────────── re-exports ─────────────────────────────

pub use super::interpreter as interpret; // ./interpreter.zig → crate::shell::interpret
pub use super::subproc; // ./subproc.zig — declared once in `shell/mod.rs`

pub use super::{EnvMap, EnvStr, ParsedShellScript};
pub use interpret::{ExitCode, Interpreter, unreachable_state};
pub use subproc::ShellSubprocess as Subprocess;
// In Zig these hang off `Interpreter` as namespaced decls; in Rust they are
// sibling modules re-exported through `interpret`.
pub use interpret::{IOReader, IOWriter};

pub use super::yield_; // ./Yield.zig
pub use yield_::Yield;

// ─── lexer / parser / AST (moved down to bun_shell_parser) ──────────────────
// The encoding-agnostic lex/parse/AST surface lives in the lower-tier
// `bun_shell_parser` crate so `Interpreter::parse` can compile without the
// (still-draft) JSC bridge below. This file keeps the JSC-coupled half
// (ShellErr, GlobalJS/Mini, shell_cmd_from_js, ShellSrcBuilder, TestingAPIs).
pub use bun_shell_parser::parse::ast as AST;
pub use bun_shell_parser::parse::{
    BACKSLASHABLE_CHARS, BacktrackSnapshot, CharState, EscapeUtf16Result, IfClauseTok, InputChar,
    JSValueRaw, LEX_JS_OBJREF_PREFIX, LEX_JS_STRING_PREFIX, LexError, LexResult, Lexer, LexerAscii,
    LexerError, LexerUnicode, ParseError, Parser, ParserError, SPECIAL_CHARS, SPECIAL_CHARS_TABLE,
    ShellCharIter, SmolList, Src, SrcAscii, SrcUnicode, StringEncoding, SubShellKind, SubshellKind,
    TextRange, Token, TokenTag, assert_special_char, ast, escape_8bit, escape_bun_str,
    escape_utf16, has_eq_sign, is_valid_var_name, needs_escape_bunstr,
    needs_escape_utf8_ascii_latin1, needs_escape_utf16,
};

// Spec: `bun.glob.GlobWalker(null, true)` → SyscallAccessor + sentinel paths.
pub type GlobWalker = bun_glob::BunGlobWalkerZ;

pub const SUBSHELL_TODO_ERROR: &str = "Subshells are not implemented, please open GitHub issue!";

/// Using these instead of the file descriptor decl literals to make sure we use LibUV fds on Windows
pub const STDIN_FD: Fd = Fd::from_uv(0);
pub const STDOUT_FD: Fd = Fd::from_uv(1);
pub const STDERR_FD: Fd = Fd::from_uv(2);

pub const POSIX_DEV_NULL: &ZStr = bun_core::zstr!("/dev/null");
pub const WINDOWS_DEV_NULL: &ZStr = bun_core::zstr!("NUL");

// ───────────────────────────── ShellErr ─────────────────────────────

/// The strings in this type are allocated with event loop ctx allocator
pub enum ShellErr {
    Sys(SystemError),
    Custom(Box<[u8]>),
    InvalidArguments { val: Box<[u8]> },
    Todo(Box<[u8]>),
}

impl ShellErr {
    /// Spec `ShellErr.newSys(bun.sys.Error)` — wrap a low-level syscall error.
    pub fn new_sys(e: sys::Error) -> Self {
        ShellErr::Sys(e.to_shell_system_error())
    }
    /// Spec `ShellErr.newSys(jsc.SystemError)` — already JS-shaped.
    /// (Zig `newSys(e: anytype)` dispatched on `@TypeOf(e)`; Rust splits the
    /// two arms into `new_sys` / `from_system`.)
    pub fn from_system(e: SystemError) -> Self {
        ShellErr::Sys(e)
    }

    /// Spec `ShellErr.throwJS` — "basically `transferToJS`". Consumes `self`:
    /// each arm takes ownership of its payload and releases it exactly once.
    pub fn throw_js(self, global: &JSGlobalObject) -> bun_jsc::JsError {
        match self {
            ShellErr::Sys(sys) => {
                // `to_error_instance` decrements every string ref itself, so we
                // must hand it the *owned* value (move) — no extra deref here.
                let err = bun_jsc::SystemError::from(sys).to_error_instance(global);
                global.throw_value(err)
            }
            ShellErr::Custom(custom) => {
                let err_value = BunString::clone_utf8(&custom).to_error_instance(global);
                // `custom: Box<[u8]>` drops here (Zig: `allocator.free(this.custom)`).
                global.throw_value(err_value)
            }
            ShellErr::InvalidArguments { val } => {
                global.throw_invalid_arguments(format_args!("{}", bstr::BStr::new(&*val)))
                // `val` drops here.
            }
            ShellErr::Todo(todo) => global.throw_todo(&todo),
        }
    }

    /// Spec `ShellErr.throwMini` — print and `exit(1)`. Consumes `self`.
    pub fn throw_mini(self) -> ! {
        match self {
            ShellErr::Sys(err) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>bunsh: {}: {}<r>",
                    err.message, err.path
                ));
                // Zig: `defer this.deinit()` → `.sys => this.sys.deref()`.
                err.deref();
            }
            ShellErr::Custom(custom) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>{}<r>",
                    bstr::BStr::new(&*custom)
                ));
            }
            ShellErr::InvalidArguments { val } => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>bunsh: invalid arguments: {}<r>",
                    bstr::BStr::new(&*val)
                ));
            }
            ShellErr::Todo(todo) => {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r>: Failed due to error: <b>TODO: {}<r>",
                    bstr::BStr::new(&*todo)
                ));
            }
        }
        bun_core::Global::exit(1)
    }

    /// Spec `ShellErr.deinit`. Explicit release for callers that drop a
    /// `ShellErr` without throwing it (mirrors Zig's manual `deinit`; the
    /// `Box<[u8]>` arms free on ordinary drop, so only `.sys` needs work).
    pub fn deinit(self) {
        if let ShellErr::Sys(sys) = self {
            sys.deref();
        }
    }
}

impl fmt::Display for ShellErr {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ShellErr::Sys(e) => write!(f, "bun: {}: {}", e.message, e.path),
            ShellErr::Custom(msg) => write!(f, "bun: {}", bstr::BStr::new(msg)),
            ShellErr::InvalidArguments { val } => {
                write!(f, "bun: invalid arguments: {}", bstr::BStr::new(val))
            }
            ShellErr::Todo(msg) => write!(f, "bun: TODO: {}", bstr::BStr::new(msg)),
        }
    }
}

// PORT NOTE: no `impl Drop for ShellErr`. Zig's `ShellErr.deinit` is *manual*
// and asymmetric — `throwJS` deliberately skips `.sys.deref()` because
// `toErrorInstance` already consumed those refs. An unconditional `Drop` would
// re-introduce the double-deref. Ownership is instead expressed by `throw_js` /
// `throw_mini` / `deinit` taking `self` by value; the `Box<[u8]>` payloads free
// on ordinary drop, and `.sys` is released exactly once on whichever consume
// path runs.

// ───────────────────────────── Result ─────────────────────────────

pub enum ShellResult<T> {
    Result(T),
    Err(ShellErr),
}

impl<T: Default> ShellResult<T> {
    pub fn success() -> Self {
        // PORT NOTE: Zig used std.mem.zeroes(T). PORTING.md forbids zeroed::<T>() for generic T
        // (no #[repr(C)] POD guarantee, may contain NonNull/NonZero/enum). Default is the safe
        // mapping; dropped `const` since Default::default is not const-callable on generic T.
        ShellResult::Result(T::default())
    }
}

impl<T> ShellResult<T> {
    pub fn as_err(self) -> Option<ShellErr> {
        match self {
            ShellResult::Err(e) => Some(e),
            ShellResult::Result(_) => None,
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ShellError {
    #[error("Init")]
    Init,
    #[error("Process")]
    Process,
    #[error("GlobalThisThrown")]
    GlobalThisThrown,
    #[error("Spawn")]
    Spawn,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    // PRECONDITION: `name`/`value` must be valid NUL-terminated C strings for
    // the call duration; `setenv` is not thread-safe wrt concurrent
    // `getenv`/`setenv` (POSIX) — caller must hold the env lock or be on the
    // single JS thread. Cannot be `safe fn`.
    fn setenv(name: *const c_char, value: *const c_char, overwrite: c_int) -> c_int;
}

fn set_env(name: *const c_char, value: *const c_char) {
    // TODO: windows
    // SAFETY: name/value are valid NUL-terminated C strings provided by callers; setenv is
    // not called concurrently with getenv on this thread (single-threaded JS event loop).
    unsafe {
        let _ = setenv(name, value, 1);
    }
}

/// `[0]` => read end, `[1]` => write end
pub type Pipe = [Fd; 2];

bun_core::define_scoped_log!(log, SHELL, hidden);

// ───────────────────────────── GlobalJS ─────────────────────────────

#[derive(Clone, Copy)]
pub struct GlobalJS<'a> {
    pub global_this: &'a JSGlobalObject,
}

impl<'a> GlobalJS<'a> {
    #[inline]
    pub fn init(g: &'a JSGlobalObject) -> Self {
        Self { global_this: g }
    }

    #[inline]
    pub fn event_loop_ctx(self) -> &'a VirtualMachine {
        // SAFETY: `bun_vm()` is non-null for a Bun-owned global; lifetime tied to 'a.
        self.global_this.bun_vm()
    }

    #[inline]
    pub fn throw_invalid_arguments(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).expect("infallible: in-memory write");
        ShellErr::InvalidArguments {
            val: v.into_boxed_slice(),
        }
    }

    #[inline]
    pub fn throw_todo(self, msg: &[u8]) -> ShellErr {
        ShellErr::Todo(Box::<[u8]>::from(msg))
    }

    #[inline]
    pub fn throw_error(self, err: sys::Error) {
        self.global_this.throw_value(err.to_js(self.global_this));
    }

    #[inline]
    pub fn handle_error(self, err: bun_core::Error, suffix: &str) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{} {}", err.name(), suffix).expect("infallible: in-memory write");
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn throw(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).expect("infallible: in-memory write");
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        self,
        // TODO(port): allocator param dropped (global mimalloc)
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        // SAFETY: bun_vm() is non-null for a Bun-owned global; `transpiler.env` is a
        // long-lived `*mut Loader` owned by the VM.
        unsafe {
            (*self.global_this.bun_vm().as_mut().transpiler.env)
                .map
                .create_null_delimited_env_map()
        }
    }

    #[inline]
    pub fn enqueue_task_concurrent_wait_pid<T: bun_event_loop::Taskable>(self, task: *mut T) {
        // Spec shell.zig GlobalJS.enqueueTaskConcurrentWaitPid:
        //   `globalThis.bunVMConcurrently().enqueueTaskConcurrent(ConcurrentTask.create(Task.init(task)))`
        // SAFETY: bun_vm_concurrently() returns a valid &VirtualMachine; we need &mut for the
        // intrusive concurrent queue push (which is itself thread-safe). The VM outlives the call.
        let vm = self
            .global_this
            .bun_vm_concurrently()
            .cast_const()
            .cast_mut();
        let concurrent = bun_event_loop::ConcurrentTask::create(bun_event_loop::Task::init(task));
        // SAFETY: see above — `enqueue_task_concurrent` only touches the lock-free queue.
        unsafe { (*vm).enqueue_task_concurrent(concurrent) };
    }

    #[inline]
    pub fn top_level_dir(self) -> &'a [u8] {
        bun_resolver::fs::FileSystem::get().top_level_dir
    }

    #[inline]
    pub fn env(self) -> &'a bun_dotenv::Loader<'a> {
        // `env_loader()` returns `&'static Loader<'static>`; `'static` widens to `'a`.
        self.global_this.bun_vm().as_mut().env_loader()
    }

    #[inline]
    pub fn platform_event_loop(self) -> &'a PlatformEventLoop {
        // Spec shell.zig GlobalJS.platformEventLoop → JsVM.platformEventLoop:
        //   posix: `vm.event_loop_handle.?`; windows: `vm.uvLoop()`.
        let vm = self.event_loop_ctx();
        #[cfg(windows)]
        // SAFETY: uv_loop() returns the live libuv loop owned by the VM; lifetime tied to 'a.
        unsafe {
            return &*vm.uv_loop();
        }
        #[cfg(not(windows))]
        // SAFETY: `event_loop_handle` is set during VM init and never freed before the VM.
        unsafe {
            &*vm.event_loop_handle.expect("event_loop_handle is null")
        }
    }

    #[inline]
    pub fn actually_throw(self, shellerr: ShellErr) {
        let _ = shellerr.throw_js(self.global_this);
    }
}

// ───────────────────────────── GlobalMini ─────────────────────────────

#[derive(Clone, Copy)]
pub struct GlobalMini<'a> {
    pub mini: &'a MiniEventLoop<'a>,
}

impl<'a> GlobalMini<'a> {
    #[inline]
    pub fn init(g: &'a MiniEventLoop<'a>) -> Self {
        Self { mini: g }
    }

    #[inline]
    pub fn env(self) -> &'a bun_dotenv::Loader<'a> {
        // SAFETY: `MiniEventLoop.env` is set during `initGlobal` and outlives the
        // loop (see `MiniEventLoop::env_ptr` invariant). Caller must not hold the
        // returned `&Loader` across a path that takes `&mut Loader` from the same
        // allocation (e.g. `create_null_delimited_env_map`); current callers scope
        // it to read-only env-var lookups.
        unsafe { self.mini.env_ptr().unwrap().as_ref() }
    }

    #[inline]
    pub fn event_loop_ctx(self) -> &'a MiniEventLoop<'a> {
        self.mini
    }

    #[inline]
    pub fn throw_todo(self, msg: &[u8]) -> ShellErr {
        ShellErr::Todo(Box::<[u8]>::from(msg))
    }

    #[inline]
    pub fn throw_invalid_arguments(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).expect("infallible: in-memory write");
        ShellErr::InvalidArguments {
            val: v.into_boxed_slice(),
        }
    }

    #[inline]
    pub fn handle_error(self, err: bun_core::Error, suffix: &str) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{} {}", err.name(), suffix).expect("infallible: in-memory write");
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        // SAFETY: `MiniEventLoop.env` is set during `initGlobal` and outlives the loop.
        unsafe { self.mini.env.unwrap().as_mut() }
            .map
            .create_null_delimited_env_map()
    }

    #[inline]
    pub fn enqueue_task_concurrent_wait_pid<T: 'static>(
        self,
        task: *mut T,
        // PORT NOTE: Zig `.from(task, "runFromMainThreadMini")` resolves the callback by
        // comptime decl-name lookup. Rust cannot reflect on a method by string, so callers
        // pass `T::run_from_main_thread_mini` explicitly (mirrors AnyTaskWithExtraContext::from).
        run_from_main_thread_mini: fn(*mut T, *mut ()),
    ) {
        use bun_jsc::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
        // Spec shell.zig GlobalMini.enqueueTaskConcurrentWaitPid:
        //   `var anytask = create(AnyTaskWithExtraContext); _ = anytask.from(task, "runFromMainThreadMini");
        //    mini.enqueueTaskConcurrent(anytask);`
        let anytask = bun_core::heap::into_raw(Box::new(AnyTaskWithExtraContext::default()));
        // SAFETY: `anytask` was just heap-allocated and is exclusively owned here.
        unsafe { (*anytask).from(task, run_from_main_thread_mini) };
        // SAFETY: `mini` is a long-lived loop; the concurrent queue is thread-safe.
        unsafe {
            (*(std::ptr::from_ref::<MiniEventLoop<'a>>(self.mini) as *mut MiniEventLoop<'a>))
                .enqueue_task_concurrent(anytask)
        };
    }

    #[inline]
    pub fn top_level_dir(self) -> &'a [u8] {
        &self.mini.top_level_dir
    }

    #[inline]
    pub fn throw(self, args: fmt::Arguments<'_>) -> ShellErr {
        let mut v = Vec::new();
        write!(&mut v, "{}", args).expect("infallible: in-memory write");
        ShellErr::Custom(v.into_boxed_slice())
    }

    #[inline]
    pub fn actually_throw(self, shellerr: ShellErr) {
        shellerr.throw_mini();
    }

    #[inline]
    pub fn platform_event_loop(self) -> &'a PlatformEventLoop {
        // Spec shell.zig GlobalMini.platformEventLoop → MiniVM.platformEventLoop:
        //   posix: `mini.loop`; windows: `mini.loop.uv_loop`.
        #[cfg(windows)]
        // SAFETY: see `MiniEventLoop::loop_ptr()` invariant; `uv_loop` is its
        // embedded libuv loop, set once by `us_create_loop` and immutable.
        unsafe {
            return &*(*self.mini.loop_ptr()).uv_loop;
        }
        #[cfg(not(windows))]
        // SAFETY: see `MiniEventLoop::loop_ptr()` invariant.
        unsafe {
            &*self.mini.loop_ptr()
        }
    }
}

// ───────────────────────────── CmdEnvIter ─────────────────────────────

pub struct CmdEnvIter<'a> {
    pub env: &'a mut bun_collections::StringArrayHashMap<Box<ZStr>>,
    // TODO(port): Zig `[:0]const u8` value — confirm map value type.
    pub iter: bun_collections::array_hash_map::Iter<'a, Box<[u8]>, Box<ZStr>>,
}

pub struct CmdEnvEntry<'a> {
    pub key: CmdEnvKey<'a>,
    pub value: CmdEnvValue<'a>,
}

pub struct CmdEnvValue<'a> {
    pub val: &'a ZStr,
}

impl fmt::Display for CmdEnvValue<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // BStr already implements Display over raw bytes (no heap alloc, no lossy UTF-8 round-trip).
        write!(f, "{}", bstr::BStr::new(self.val.as_bytes()))
    }
}

pub struct CmdEnvKey<'a> {
    pub val: &'a [u8],
}

impl fmt::Display for CmdEnvKey<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", bstr::BStr::new(self.val))
    }
}

impl CmdEnvKey<'_> {
    pub fn eql_comptime(&self, str: &'static [u8]) -> bool {
        self.val == str
    }
}

impl<'a> CmdEnvIter<'a> {
    pub fn from_env(env: &'a mut bun_collections::StringArrayHashMap<Box<ZStr>>) -> Self {
        // PORT NOTE: `iterator()` borrows `&mut self`; rebind through a raw ptr so the
        // struct can hold both the map ref and the iterator (Zig had no aliasing rules).
        // SAFETY: `env` outlives `'a` and is not mutated through `self.env` while `iter`
        // walks the backing arrays.
        let env_ptr: *mut _ = env;
        let iter = unsafe { (*env_ptr).iterator() };
        Self { env, iter }
    }

    pub fn len(&self) -> usize {
        self.env.len()
    }

    pub fn next(&mut self) -> Result<Option<CmdEnvEntry<'a>>, bun_core::Error> {
        // TODO(port): narrow error set — Zig sig is `!?Entry` but body never errors.
        let Some(entry) = self.iter.next() else {
            return Ok(None);
        };
        Ok(Some(CmdEnvEntry {
            key: CmdEnvKey {
                val: &**entry.key_ptr,
            },
            value: CmdEnvValue {
                val: &**entry.value_ptr,
            },
        }))
    }
}

// ───────────────────────────── Test ─────────────────────────────

pub mod test {
    use super::*;

    pub enum TestToken<'a> {
        Pipe,
        DoublePipe,
        Ampersand,
        DoubleAmpersand,
        Redirect(ast::RedirectFlags),
        Dollar,
        Asterisk,
        DoubleAsterisk,
        Eq,
        Semicolon,
        Newline,
        BraceBegin,
        Comma,
        BraceEnd,
        CmdSubstBegin,
        CmdSubstQuoted,
        CmdSubstEnd,
        OpenParen,
        CloseParen,
        Var(&'a [u8]),
        VarArgv(u8),
        Text(&'a [u8]),
        SingleQuotedText(&'a [u8]),
        DoubleQuotedText(&'a [u8]),
        JSObjRef(u32),
        DoubleBracketOpen,
        DoubleBracketClose,
        Delimit,
        Eof,
    }

    impl<'a> TestToken<'a> {
        pub fn from_real(the_token: Token, buf: &'a [u8]) -> TestToken<'a> {
            match the_token {
                Token::Var(txt) => TestToken::Var(&buf[txt.start as usize..txt.end as usize]),
                Token::VarArgv(int) => TestToken::VarArgv(int),
                Token::Text(txt) => TestToken::Text(&buf[txt.start as usize..txt.end as usize]),
                Token::SingleQuotedText(txt) => {
                    TestToken::SingleQuotedText(&buf[txt.start as usize..txt.end as usize])
                }
                Token::DoubleQuotedText(txt) => {
                    TestToken::DoubleQuotedText(&buf[txt.start as usize..txt.end as usize])
                }
                Token::JSObjRef(val) => TestToken::JSObjRef(val),
                Token::Pipe => TestToken::Pipe,
                Token::DoublePipe => TestToken::DoublePipe,
                Token::Ampersand => TestToken::Ampersand,
                Token::DoubleAmpersand => TestToken::DoubleAmpersand,
                Token::Redirect(r) => TestToken::Redirect(r),
                Token::Dollar => TestToken::Dollar,
                Token::Asterisk => TestToken::Asterisk,
                Token::DoubleAsterisk => TestToken::DoubleAsterisk,
                Token::Eq => TestToken::Eq,
                Token::Semicolon => TestToken::Semicolon,
                Token::Newline => TestToken::Newline,
                Token::BraceBegin => TestToken::BraceBegin,
                Token::Comma => TestToken::Comma,
                Token::BraceEnd => TestToken::BraceEnd,
                Token::CmdSubstBegin => TestToken::CmdSubstBegin,
                Token::CmdSubstQuoted => TestToken::CmdSubstQuoted,
                Token::CmdSubstEnd => TestToken::CmdSubstEnd,
                Token::OpenParen => TestToken::OpenParen,
                Token::CloseParen => TestToken::CloseParen,
                Token::DoubleBracketOpen => TestToken::DoubleBracketOpen,
                Token::DoubleBracketClose => TestToken::DoubleBracketClose,
                Token::Delimit => TestToken::Delimit,
                Token::Eof => TestToken::Eof,
            }
        }
    }

    // ─── JSON serialization (port of `std.json.fmt(test_tokens, .{})`) ──────
    // Zig: `union(TokenTag)` → `{"Tag":payload}`; void payload → `{"Tag":{}}`.
    use bun_shell_parser::json_fmt::{encode_json_string, write_redirect_flags};
    use core::fmt::Write as _;

    impl<'a> TestToken<'a> {
        pub fn write_json(&self, w: &mut impl core::fmt::Write) -> core::fmt::Result {
            use TestToken as T;
            macro_rules! unit {
                ($tag:literal) => {{ w.write_str(concat!("{\"", $tag, "\":{}}")) }};
            }
            match self {
                T::Pipe => unit!("Pipe"),
                T::DoublePipe => unit!("DoublePipe"),
                T::Ampersand => unit!("Ampersand"),
                T::DoubleAmpersand => unit!("DoubleAmpersand"),
                T::Redirect(r) => {
                    w.write_str("{\"Redirect\":")?;
                    write_redirect_flags(w, *r)?;
                    w.write_char('}')
                }
                T::Dollar => unit!("Dollar"),
                T::Asterisk => unit!("Asterisk"),
                T::DoubleAsterisk => unit!("DoubleAsterisk"),
                T::Eq => unit!("Eq"),
                T::Semicolon => unit!("Semicolon"),
                T::Newline => unit!("Newline"),
                T::BraceBegin => unit!("BraceBegin"),
                T::Comma => unit!("Comma"),
                T::BraceEnd => unit!("BraceEnd"),
                T::CmdSubstBegin => unit!("CmdSubstBegin"),
                T::CmdSubstQuoted => unit!("CmdSubstQuoted"),
                T::CmdSubstEnd => unit!("CmdSubstEnd"),
                T::OpenParen => unit!("OpenParen"),
                T::CloseParen => unit!("CloseParen"),
                T::Var(s) => {
                    w.write_str("{\"Var\":")?;
                    encode_json_string(w, s)?;
                    w.write_char('}')
                }
                T::VarArgv(n) => write!(w, "{{\"VarArgv\":{}}}", n),
                T::Text(s) => {
                    w.write_str("{\"Text\":")?;
                    encode_json_string(w, s)?;
                    w.write_char('}')
                }
                T::SingleQuotedText(s) => {
                    w.write_str("{\"SingleQuotedText\":")?;
                    encode_json_string(w, s)?;
                    w.write_char('}')
                }
                T::DoubleQuotedText(s) => {
                    w.write_str("{\"DoubleQuotedText\":")?;
                    encode_json_string(w, s)?;
                    w.write_char('}')
                }
                T::JSObjRef(n) => write!(w, "{{\"JSObjRef\":{}}}", n),
                T::DoubleBracketOpen => unit!("DoubleBracketOpen"),
                T::DoubleBracketClose => unit!("DoubleBracketClose"),
                T::Delimit => unit!("Delimit"),
                T::Eof => unit!("Eof"),
            }
        }
    }

    /// `Display` adapter mirroring `std.json.fmt(test_tokens.items, .{})`.
    pub fn tokens_json_fmt<'b>(tokens: &'b [TestToken<'_>]) -> impl core::fmt::Display + 'b {
        struct Fmt<'a, 'b>(&'b [TestToken<'a>]);
        impl core::fmt::Display for Fmt<'_, '_> {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                f.write_char('[')?;
                for (i, tok) in self.0.iter().enumerate() {
                    if i != 0 {
                        f.write_char(',')?;
                    }
                    tok.write_json(f)?;
                }
                f.write_char(']')
            }
        }
        Fmt(tokens)
    }
}
pub use test as Test;

// ───────────────────────────── JS bridge ─────────────────────────────

/// RAII owner for the `bun.String` array threaded through `shell_cmd_from_js` →
/// `Interpreter::parse`. `bun.String` is `Copy` (no `Drop`) for FFI, so the
/// per-element `deref()` from Zig's `defer { for (jsstrings.items) |bunstr|
/// bunstr.deref(); jsstrings.deinit(); }` must be explicit. Wrapping the `Vec`
/// avoids the unit-state `scopeguard` + raw-pointer-reborrow pattern that is UB
/// under Stacked Borrows (PORTING.md §Idiom-map: `defer <side effect>`).
pub struct JsStrings(pub Vec<BunString>);

impl JsStrings {
    #[inline]
    pub fn with_capacity(cap: usize) -> Self {
        Self(Vec::with_capacity(cap))
    }
}

impl core::ops::Deref for JsStrings {
    type Target = Vec<BunString>;
    #[inline]
    fn deref(&self) -> &Vec<BunString> {
        &self.0
    }
}

impl core::ops::DerefMut for JsStrings {
    #[inline]
    fn deref_mut(&mut self) -> &mut Vec<BunString> {
        &mut self.0
    }
}

impl Drop for JsStrings {
    fn drop(&mut self) {
        for s in &self.0 {
            s.deref();
        }
    }
}

pub fn shell_cmd_from_js(
    global: &JSGlobalObject,
    string_args: JSValue,
    template_args: &mut JSArrayIterator,
    // SAFETY: every JSValue pushed into out_jsobjs is also appended to marked_argument_buffer
    // (a GC root); the heap-backed Vec is index storage only, mirroring the Zig 1:1.
    out_jsobjs: &mut Vec<JSValue>,
    jsstrings: &mut Vec<BunString>,
    out_script: &mut Vec<u8>,
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<()> {
    let mut builder = ShellSrcBuilder::init(global, out_script, jsstrings);
    let mut jsobjref_buf = [0u8; 128];

    let mut string_iter = string_args.array_iterator(global)?;
    let mut i: u32 = 0;
    let last = string_iter.len.saturating_sub(1);
    while let Some(js_value) = string_iter.next()? {
        if !builder.append_js_value_str::<false>(js_value)? {
            return Err(global.throw(format_args!("Shell script string contains invalid UTF-16")));
        }
        if i < last {
            let template_value = match template_args.next()? {
                Some(v) => v,
                None => {
                    return Err(global.throw(format_args!("Shell script is missing JSValue arg")));
                }
            };
            // PORT NOTE: reshaped for borrowck — builder holds &mut out_script/jsstrings;
            // drop and re-create around the recursive call.
            drop(builder);
            handle_template_value(
                global,
                template_value,
                out_jsobjs,
                out_script,
                jsstrings,
                &mut jsobjref_buf[..],
                marked_argument_buffer,
            )?;
            builder = ShellSrcBuilder::init(global, out_script, jsstrings);
        }
        i += 1;
    }
    Ok(())
}

pub fn handle_template_value(
    global: &JSGlobalObject,
    template_value: JSValue,
    // SAFETY: every JSValue pushed into out_jsobjs is also appended to marked_argument_buffer
    // (a GC root); the heap-backed Vec is index storage only.
    out_jsobjs: &mut Vec<JSValue>,
    out_script: &mut Vec<u8>,
    jsstrings: &mut Vec<BunString>,
    jsobjref_buf: &mut [u8],
    marked_argument_buffer: &mut MarkedArgumentBuffer,
) -> JsResult<()> {
    let mut builder = ShellSrcBuilder::init(global, out_script, jsstrings);
    if !template_value.is_empty() {
        if let Some(_array_buffer) = template_value.as_array_buffer(global) {
            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if let Some(blob) = template_value.as_class_ref::<crate::webcore::Blob>() {
            if let Some(store) = blob.store.get().as_deref() {
                if let crate::webcore::blob::store::Data::File(file) = &store.data {
                    if let crate::node::PathOrFileDescriptor::Path(p) = &file.pathlike {
                        let path: &[u8] = p.slice();

                        // Check for null bytes in path (security: prevent null byte injection)
                        if strings::index_of_char(path, 0).is_some() {
                            return Err(global
                                .err(jsc::ErrorCode::INVALID_ARG_VALUE, format_args!(
                                    "The shell argument must be a string without null bytes. Received {}",
                                    bun_core::fmt::quote(path)
                                ))
                                .throw());
                        }

                        if !builder.append_utf8::<true>(path)? {
                            return Err(global.throw(format_args!(
                                "Shell script string contains invalid UTF-16"
                            )));
                        }
                        return Ok(());
                    }
                }
            }

            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if let Some(_rstream) = crate::webcore::ReadableStream::from_js(template_value, global)? {
            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if let Some(_req) = template_value.as_::<crate::webcore::Response>() {
            let idx = out_jsobjs.len();
            marked_argument_buffer.append(template_value);
            out_jsobjs.push(template_value);
            let mut cursor = std::io::Cursor::new(&mut jsobjref_buf[..]);
            write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_OBJREF_PREFIX), idx)
                .map_err(|_| global.throw_out_of_memory())?;
            let n = cursor.position() as usize;
            drop(builder);
            out_script.extend_from_slice(&jsobjref_buf[..n]);
            return Ok(());
        }

        if template_value.is_string() {
            if !builder.append_js_value_str::<true>(template_value)? {
                return Err(
                    global.throw(format_args!("Shell script string contains invalid UTF-16"))
                );
            }
            return Ok(());
        }

        if template_value.js_type().is_array() {
            let mut array = template_value.array_iterator(global)?;
            let last = array.len.saturating_sub(1);
            let mut i: u32 = 0;
            drop(builder);
            while let Some(arr) = array.next()? {
                handle_template_value(
                    global,
                    arr,
                    out_jsobjs,
                    out_script,
                    jsstrings,
                    jsobjref_buf,
                    marked_argument_buffer,
                )?;
                if i < last {
                    let str = BunString::static_(b" ");
                    let mut b = ShellSrcBuilder::init(global, out_script, jsstrings);
                    if !b.append_bun_str::<false>(str)? {
                        return Err(global
                            .throw(format_args!("Shell script string contains invalid UTF-16")));
                    }
                }
                i += 1;
            }
            return Ok(());
        }

        if template_value.is_object() {
            if let Some(maybe_str) = template_value.get_own_truthy(global, "raw")? {
                let bunstr = OwnedString::new(maybe_str.to_bun_string(global)?);

                // Check for null bytes in shell argument (security: prevent null byte injection)
                if bunstr.index_of_ascii_char(0).is_some() {
                    return Err(global
                        .err(jsc::ErrorCode::INVALID_ARG_VALUE, format_args!(
                            "The shell argument must be a string without null bytes. Received \"{}\"",
                            bunstr.to_zig_string()
                        ))
                        .throw());
                }

                if !builder.append_bun_str::<false>(bunstr.get())? {
                    return Err(
                        global.throw(format_args!("Shell script string contains invalid UTF-16"))
                    );
                }
                return Ok(());
            }
        }

        // Spec `JSValue.isPrimitive()` — `!isObject()` (covers number/bool/null/undef/symbol).
        if !template_value.is_object() {
            if !builder.append_js_value_str::<true>(template_value)? {
                return Err(
                    global.throw(format_args!("Shell script string contains invalid UTF-16"))
                );
            }
            return Ok(());
        }

        if template_value.implements_to_string(global)? {
            if !builder.append_js_value_str::<true>(template_value)? {
                return Err(
                    global.throw(format_args!("Shell script string contains invalid UTF-16"))
                );
            }
            return Ok(());
        }

        return Err(global.throw(format_args!(
            "Invalid JS object used in shell: {}, you might need to call `.toString()` on it",
            template_value.fmt_string(global)
        )));
    }

    Ok(())
}

// ───────────────────────────── ShellSrcBuilder ─────────────────────────────

pub struct ShellSrcBuilder<'a> {
    pub global_this: &'a JSGlobalObject,
    pub outbuf: &'a mut Vec<u8>,
    pub jsstrs_to_escape: &'a mut Vec<BunString>,
    pub jsstr_ref_buf: [u8; 128],
}

impl<'a> ShellSrcBuilder<'a> {
    pub fn init(
        global: &'a JSGlobalObject,
        outbuf: &'a mut Vec<u8>,
        jsstrs_to_escape: &'a mut Vec<BunString>,
    ) -> Self {
        Self {
            global_this: global,
            outbuf,
            jsstrs_to_escape,
            jsstr_ref_buf: [0u8; 128],
        }
    }

    pub fn append_js_value_str<const ALLOW_ESCAPE: bool>(
        &mut self,
        jsval: JSValue,
    ) -> JsResult<bool> {
        let bunstr = OwnedString::new(jsval.to_bun_string(self.global_this)?);

        // Check for null bytes in shell argument (security: prevent null byte injection)
        if bunstr.index_of_ascii_char(0).is_some() {
            return Err(self
                .global_this
                .err(
                    jsc::ErrorCode::INVALID_ARG_VALUE,
                    format_args!(
                        "The shell argument must be a string without null bytes. Received \"{}\"",
                        bunstr.to_zig_string()
                    ),
                )
                .throw());
        }

        Ok(self.append_bun_str::<ALLOW_ESCAPE>(bunstr.get())?)
    }

    pub fn append_bun_str<const ALLOW_ESCAPE: bool>(
        &mut self,
        bunstr: BunString,
    ) -> Result<bool, bun_alloc::AllocError> {
        let invalid = (bunstr.is_utf16() && !simdutf::validate::utf16le(bunstr.utf16()))
            || (bunstr.is_utf8() && !simdutf::validate::utf8(bunstr.byte_slice()));
        if invalid {
            return Ok(false);
        }
        // Empty interpolated values must still produce an argument (e.g. `${''}` should
        // pass "" as an arg). Route through appendJSStrRef so the \x08 marker is recognized
        // by the lexer regardless of quote context (e.g. inside single quotes).
        if ALLOW_ESCAPE && bunstr.length() == 0 {
            self.append_js_str_ref(bunstr)?;
            return Ok(true);
        }
        if ALLOW_ESCAPE {
            if needs_escape_bunstr(bunstr) {
                self.append_js_str_ref(bunstr)?;
                return Ok(true);
            }
        }
        if bunstr.is_utf16() {
            self.append_utf16_impl(bunstr.utf16())?;
            return Ok(true);
        }
        if bunstr.is_utf8() || strings::is_all_ascii(bunstr.byte_slice()) {
            self.append_utf8_impl(bunstr.byte_slice())?;
            return Ok(true);
        }
        self.append_latin1_impl(bunstr.byte_slice())?;
        Ok(true)
    }

    pub fn append_utf8<const ALLOW_ESCAPE: bool>(
        &mut self,
        utf8: &[u8],
    ) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        let invalid = simdutf::validate::utf8(utf8);
        // PORT NOTE: Zig variable name `invalid` is misleading — it holds the validity bool.
        if !invalid {
            return Ok(false);
        }
        if ALLOW_ESCAPE {
            if needs_escape_utf8_ascii_latin1(utf8) {
                let bunstr = OwnedString::new(BunString::clone_utf8(utf8));
                self.append_js_str_ref(bunstr.get())?;
                return Ok(true);
            }
        }

        self.append_utf8_impl(utf8)?;
        Ok(true)
    }

    pub fn append_utf16_impl(&mut self, utf16: &[u16]) -> Result<(), bun_alloc::AllocError> {
        let size = simdutf::length::utf8::from::utf16::le(utf16);
        self.outbuf.reserve(size);
        strings::convert_utf16_to_utf8_append(self.outbuf, utf16);
        // TODO(port): error mapping — Zig propagates encoding error directly.
        Ok(())
    }

    pub fn append_utf8_impl(&mut self, utf8: &[u8]) -> Result<(), bun_alloc::AllocError> {
        self.outbuf.extend_from_slice(utf8);
        Ok(())
    }

    pub fn append_latin1_impl(&mut self, latin1: &[u8]) -> Result<(), bun_alloc::AllocError> {
        let non_ascii_idx = strings::first_non_ascii(latin1).unwrap_or(0);

        if non_ascii_idx > 0 {
            self.append_utf8_impl(&latin1[..non_ascii_idx as usize])?;
        }

        // Zig reassigns `self.outbuf.* = allocateLatin1IntoUTF8WithList(self.outbuf.*, …)`;
        // mirror that by moving the Vec out, transforming, and storing back.
        let len = self.outbuf.len();
        let buf = core::mem::take(self.outbuf);
        *self.outbuf = strings::allocate_latin1_into_utf8_with_list(buf, len, latin1);
        Ok(())
    }

    pub fn append_js_str_ref(&mut self, bunstr: BunString) -> Result<(), bun_alloc::AllocError> {
        let idx = self.jsstrs_to_escape.len();
        let mut cursor = std::io::Cursor::new(&mut self.jsstr_ref_buf[..]);
        write!(cursor, "{}{}", bstr::BStr::new(LEX_JS_STRING_PREFIX), idx).expect("Impossible");
        let n = cursor.position() as usize;
        self.outbuf.extend_from_slice(&self.jsstr_ref_buf[..n]);
        bunstr.ref_();
        self.jsstrs_to_escape.push(bunstr);
        Ok(())
    }
}

// ───────────────────────────── TestingAPIs ─────────────────────────────

/// Used in JS tests, see `internal-for-testing.ts` and shell tests.
pub mod testing_apis {
    use super::*;
    use crate::test_runner::expect::JSGlobalObjectTestExt as _;

    #[bun_jsc::host_fn]
    pub fn disabled_on_this_platform(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(windows)]
        {
            return Ok(JSValue::FALSE);
        }
        #[cfg(not(windows))]
        {
            let arguments_ = callframe.arguments_old::<1>();
            // SAFETY: bun_vm() is non-null for a Bun-owned global.
            let vm = global.bun_vm();
            let mut arguments = jsc::ArgumentsSlice::init(vm, arguments_.slice());
            let string: JSValue = match arguments.next_eat() {
                Some(s) => s,
                None => {
                    return Err(global.throw(format_args!(
                        "shellInternals.disabledOnPosix: expected 1 arguments, got 0"
                    )));
                }
            };

            let bunstr = OwnedString::new(string.to_bun_string(global)?);
            let utf8str = bunstr.to_utf8();

            for disabled in crate::shell::builtin::Kind::DISABLED_ON_POSIX {
                // Spec uses Zig `@tagName` (lowercase). `strum::IntoStaticStr`
                // would yield the PascalCase variant name ("Cp"), so use
                // `Kind::as_str` which mirrors the lowercase tag.
                if utf8str.slice() == disabled.as_str().as_bytes() {
                    return Ok(JSValue::TRUE);
                }
            }
            Ok(JSValue::FALSE)
        }
    }

    /// Spec shell.zig `TestingAPIs.shellLex` (`MarkedArgumentBuffer.wrap(_shellLex)`).
    /// Codegen (`generated_js2native.rs`) wraps this with `host_fn_result`, so we
    /// expose the bare `JsHostFnZig` signature here and do the buffer scope inline.
    pub fn shell_lex(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        MarkedArgumentBuffer::new(|buf| shell_lex_impl(global, callframe, buf))
    }

    fn shell_lex_impl(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        marked_argument_buffer: &mut MarkedArgumentBuffer,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<2>();
        // SAFETY: bun_vm() is non-null for a Bun-owned global.
        let vm = global.bun_vm();
        let mut arguments = jsc::ArgumentsSlice::init(vm, arguments_.slice());
        let string_args: JSValue = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!("shell_parse: expected 2 arguments, got 0")));
            }
        };

        let arena = Bump::new();

        let template_args_js: JSValue = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!("shell: expected 2 arguments, got 0")));
            }
        };
        let mut template_args = template_args_js.array_iterator(global)?;
        // PERF(port): was stack-fallback (4 BunString) — profile in Phase B
        let mut jsstrings = JsStrings::with_capacity(4);
        // SAFETY: every JSValue pushed here is also rooted in marked_argument_buffer.
        let mut jsobjs: Vec<JSValue> = Vec::new();

        let mut script: Vec<u8> = Vec::new();
        shell_cmd_from_js(
            global,
            string_args,
            &mut template_args,
            &mut jsobjs,
            &mut jsstrings,
            &mut script,
            marked_argument_buffer,
        )?;

        let jsobjs_len: u32 = u32::try_from(jsobjs.len()).expect("int cast");
        let lex_result = 'brk: {
            if strings::is_all_ascii(&script[..]) {
                let mut lexer =
                    LexerAscii::new(&arena, &script[..], &mut jsstrings[..], jsobjs_len);
                if let Err(err) = lexer.lex() {
                    return Err(global.throw_error(bun_core::err!(from err), "failed to lex shell"));
                }
                break 'brk lexer.get_result();
            }
            let mut lexer = LexerUnicode::new(&arena, &script[..], &mut jsstrings[..], jsobjs_len);
            if let Err(err) = lexer.lex() {
                return Err(global.throw_error(bun_core::err!(from err), "failed to lex shell"));
            }
            lexer.get_result()
        };

        if !lex_result.errors.is_empty() {
            let str = lex_result.combine_errors(&arena);
            return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(str))));
        }

        let mut test_tokens: Vec<test::TestToken> = Vec::with_capacity(lex_result.tokens.len());
        for &tok in lex_result.tokens {
            let test_tok = test::TestToken::from_real(tok, lex_result.strpool);
            test_tokens.push(test_tok);
        }

        // Spec: `std.fmt.allocPrint(..., "{f}", .{std.json.fmt(test_tokens.items, .{})})`.
        let str = format!("{}", test::tokens_json_fmt(&test_tokens[..]));
        let bun_str = BunString::from_bytes(str.as_bytes());
        bun_str.to_js(global)
    }

    /// Spec shell.zig `TestingAPIs.shellParse` (`MarkedArgumentBuffer.wrap(_shellParse)`).
    pub fn shell_parse(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        MarkedArgumentBuffer::new(|buf| shell_parse_impl(global, callframe, buf))
    }

    fn shell_parse_impl(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        marked_argument_buffer: &mut MarkedArgumentBuffer,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<2>();
        // SAFETY: bun_vm() is non-null for a Bun-owned global.
        let vm = global.bun_vm();
        let mut arguments = jsc::ArgumentsSlice::init(vm, arguments_.slice());
        let string_args: JSValue = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!("shell_parse: expected 2 arguments, got 0")));
            }
        };

        let arena = Bump::new();

        let template_args_js: JSValue = match arguments.next_eat() {
            Some(s) => s,
            None => {
                return Err(global.throw(format_args!("shell: expected 2 arguments, got 0")));
            }
        };
        let mut template_args = template_args_js.array_iterator(global)?;
        // PERF(port): was stack-fallback
        let mut jsstrings = JsStrings::with_capacity(4);
        // SAFETY: every JSValue pushed here is also rooted in marked_argument_buffer.
        let mut jsobjs: Vec<JSValue> = Vec::new();
        let mut script: Vec<u8> = Vec::new();
        shell_cmd_from_js(
            global,
            string_args,
            &mut template_args,
            &mut jsobjs,
            &mut jsstrings,
            &mut script,
            marked_argument_buffer,
        )?;

        let mut out_parser: Option<bun_shell_parser::Parser<'_>> = None;
        let mut out_lex_result: Option<bun_shell_parser::LexResult<'_>> = None;

        let script_ast = match interpret::Interpreter::parse(
            &arena,
            &script[..],
            &mut jsobjs[..],
            &mut jsstrings[..],
            &mut out_parser,
            &mut out_lex_result,
        ) {
            Ok(a) => a,
            Err(err) => {
                // Spec: shell.zig TestingAPIs.shellParse — `if (err == ParseError.Lex)`
                // ⇔ out_lex_result was populated by `parse()`.
                if let Some(lex) = out_lex_result.as_ref() {
                    let str = lex.combine_errors(&arena);
                    return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(str))));
                }

                if let Some(p) = out_parser.as_mut() {
                    let errstr = p.combine_errors();
                    return Err(global.throw_pretty(format_args!("{}", bstr::BStr::new(errstr))));
                }

                return Err(global.throw_error(err, "failed to lex/parse shell"));
            }
        };

        // Spec: `std.fmt.allocPrint(..., "{f}", .{std.json.fmt(script_ast, .{})})`.
        // `crate::shell::ast::Script` is a `'static`-erased alias of
        // `bun_shell_parser::ast::Script`, so it formats directly.
        let str = format!(
            "{}",
            bun_shell_parser::json_fmt::script_json_fmt(&script_ast)
        );
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, str.as_bytes())
    }
}
pub use testing_apis as TestingAPIs;
// `generated_js2native.rs` snake-cases Zig's `TestingAPIs` as `testing_ap_is`
// (the codegen splits on capitalisation runs).
pub use testing_apis as testing_ap_is;

pub use subproc::ShellSubprocess;

// ported from: src/shell/shell.zig
