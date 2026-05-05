//! The interpreter for the shell language
//!
//! There are several constraints on the Bun shell language that make this
//! interpreter implementation unique:
//!
//! 1. We try to keep everything in the Bun process as much as possible for
//!    performance reasons and also to leverage Bun's existing IO/FS code
//! 2. We try to use non-blocking IO operations as much as possible so the
//!    shell does not block the main JS thread
//! 3. Zig does not have coroutines (yet)
//!
//! The idea is that this is a tree-walking interpreter. Except it's not.
//!
//! Why not? Because 99% of operations in the shell are IO, and we need to do
//! non-blocking IO because Bun is a JS runtime.
//!
//! So what do we do? Instead of iteratively walking the AST like in a traditional
//! tree-walking interpreter, we're also going to build up a tree of state-machines
//! (an AST node becomes a state-machine node), so we can suspend and resume
//! execution without blocking the main thread.
//!
//! We'll also need to do things in continuation-passing style, see `Yield.zig` for
//! more on that.
//!
//! Once all these pieces come together, this ends up being a:
//! "state-machine based [tree-walking], [trampoline]-driven [continuation-passing style] interpreter"
//!
//! [tree-walking]: https://en.wikipedia.org/wiki/Interpreter_(computing)#Abstract_syntax_tree_interpreters
//! [trampoline]:   https://en.wikipedia.org/wiki/Trampoline_(computing)
//! [continuation-passing style]: https://en.wikipedia.org/wiki/Continuation-passing_style
//!
//! # Memory management
//!
//! Almost all allocations go through the `AllocationScope` allocator. This
//! tracked memory allocations and frees in debug builds (or builds with asan
//! enabled) and helps us catch memory leaks.
//!
//! The underlying parent allocator that every `AllocationScope` uses in the
//! shell is `bun.default_allocator`. This means in builds of Bun which do not
//! have `AllocationScope` enabled, every allocation just goes straight through
//! to `bun.default_allocator`.
//!
//! Usually every state machine node ends up creating a new allocation scope,
//! so an `AllocationScope` is stored in the base header struct (see `Base.zig`)
//! that all state-machine nodes include in their layout.
//!
//! You will often see `Base.initWithNewAllocScope` to create a new state machine node
//! and allocation scope.
//!
//! Sometimes it is necessary to "leak" an allocation from its scope. For
//! example, argument expansion happens in an allocation scope inside
//! `Expansion.zig`.
//!
//! But the string that is expanded may end up becoming the key/value of an
//! environment variable, which we internally use the reference counted `EnvStr`
//! for. When we turn it into an `EnvStr`, the reference counting scheme is
//! responsible for managing the memory so we can call
//! `allocScope.leakSlice(str)` to tell it not to track the allocation anymore
//! and let `EnvStr` handle it.

use core::ffi::{c_char, c_void};
use core::fmt;
use core::mem::offset_of;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_alloc::{Allocator, Arena as ArenaAllocator};
use bun_collections::{ArrayHashMap, BabyList as ByteList, TaggedPtrUnion};
use bun_core::{self, Output, Global};
use bun_jsc::{self as jsc, CallFrame, EventLoopHandle, JSGlobalObject, JSValue, JsResult, ZigString};
use bun_paths::{self as ResolvePath, PathBuffer};
use bun_str::{self, ZStr};
use bun_sys::{self as Syscall, Fd, Mode, Stat};
use bun_threading::{WorkPool, WorkPoolTask};

use crate::{self as shell, ast, LexResult, Parser, ShellErr, SmolList, Yield};
use crate::env_str::EnvStr;
use crate::env_map::EnvMap;

bun_output::declare_scope!(SHELL, visible);
bun_output::declare_scope!(CowFd, hidden);
bun_output::declare_scope!(ShellTokens, hidden);

// `string` was a Zig type alias for `[]const u8` — in Rust, just use `&[u8]`.
pub use ArenaAllocator as Arena;
pub use bun_shell_parser::braces as Braces;
pub use bun_sys as SyscallNs;
pub use bun_threading::WorkPoolTask as WorkPoolTaskTy;
pub use bun_threading::WorkPool as WorkPoolTy;

pub type Pipe = [Fd; 2];
pub use shell::SmolList as SmolListTy;

pub use bun_glob::BunGlobWalkerZ as GlobWalker;

pub const STDIN_NO: u32 = 0;
pub const STDOUT_NO: u32 = 1;
pub const STDERR_NO: u32 = 2;

#[cold]
pub fn oom(e: bun_core::Error) -> ! {
    if cfg!(debug_assertions) {
        if e != bun_core::err!("OutOfMemory") {
            bun_core::out_of_memory();
        }
    }
    bun_core::out_of_memory();
}

#[macro_export]
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(SHELL, $($arg)*) };
}

/// This is a zero-sized type returned by `.needs_io()`, designed to ensure
/// functions which rely on IO are not called when they don't need it.
///
/// For example the .enqueue(), .enqueue_fmt_bltn(), etc functions.
///
/// It is used like this:
///
/// ```ignore
/// if let Some(safeguard) = this.bltn.stdout.needs_io() {
///     this.bltn.stdout.enqueue(this, chunk, safeguard);
///     return CoroutineResult::Cont;
/// }
/// let _ = this.bltn.write_no_io(.stdout, chunk);
/// ```
///
/// The compiler optimizes away this type so it has zero runtime cost.
///
/// You should never instantiate this type directly, unless you know
/// from previous context that the output needs IO.
///
/// Functions which accept a `_: OutputNeedsIOSafeGuard` parameter can
/// safely assume the stdout/stderr they are working with require IO.
#[repr(u8)] // u0 in Zig — Rust has no u0; ZST enum compiles to nothing
#[derive(Clone, Copy)]
pub enum OutputNeedsIOSafeGuard {
    OutputNeedsIo,
}

/// Similar to `OutputNeedsIOSafeGuard` but to ensure a function is
/// called at the "top" of the call-stack relative to the interpreter's
/// execution.
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum CallstackGuard {
    IKnowWhatIAmDoing,
}

pub type ExitCode = u16;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum StateKind {
    Script,
    Stmt,
    Assign,
    Cmd,
    Binary,
    Pipeline,
    Expansion,
    IfClause,
    Condexpr,
    Async,
    Subshell,
}

/// Copy-on-write file descriptor. This is to avoid having multiple non-blocking
/// writers to the same file descriptor, which breaks epoll/kqueue
///
/// Two main fields:
/// 1. refcount - tracks number of references to the fd, closes file descriptor when reaches 0
/// 2. being_written - if the fd is currently being used by a BufferedWriter for non-blocking writes
///
/// If you want to write to the file descriptor, you call `.write()`, if `being_written` is true it will duplicate the file descriptor.
pub struct CowFd {
    __fd: Fd,
    refcount: u32,
    being_used: bool,
}

impl CowFd {
    pub fn init(fd: Fd) -> *mut CowFd {
        let this = Box::into_raw(Box::new(CowFd {
            __fd: fd,
            refcount: 1,
            being_used: false,
        }));
        bun_output::scoped_log!(CowFd, "init(0x{:x}, fd={})", this as usize, fd);
        this
    }

    pub fn dup(&self) -> bun_sys::Result<*mut CowFd> {
        // TODO(port): Zig had `.fd` and `.writercount` fields here, which look like a bug
        // (struct only has `__fd` and `refcount`). Preserving intent: dup the fd.
        let new = Box::into_raw(Box::new(CowFd {
            __fd: match bun_sys::dup(self.__fd) {
                bun_sys::Result::Ok(fd) => fd,
                bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
            },
            refcount: 1,
            being_used: false,
        }));
        bun_output::scoped_log!(
            CowFd,
            "dup(0x{:x}, fd={}) = (0x{:x}, fd={})",
            self as *const _ as usize,
            self.__fd,
            new as usize,
            // SAFETY: `new` was just produced by Box::into_raw above; valid and exclusive.
            unsafe { (*new).__fd }
        );
        bun_sys::Result::Ok(new)
    }

    pub fn use_(this: *mut CowFd) -> bun_sys::Result<*mut CowFd> {
        // SAFETY: caller holds a valid CowFd
        let me = unsafe { &mut *this };
        if !me.being_used {
            me.being_used = true;
            me.ref_();
            return bun_sys::Result::Ok(this);
        }
        me.dup()
    }

    pub fn done_using(&mut self) {
        self.being_used = false;
    }

    pub fn ref_(&mut self) {
        self.refcount += 1;
    }

    pub fn dupe_ref(this: *mut CowFd) -> *mut CowFd {
        // SAFETY: caller holds a valid CowFd
        unsafe { (*this).ref_() };
        this
    }

    pub fn deref(this: *mut CowFd) {
        // SAFETY: caller holds a valid CowFd
        let me = unsafe { &mut *this };
        me.refcount -= 1;
        if me.refcount == 0 {
            Self::destroy(this);
        }
    }

    // TODO(port): model as bun_ptr::IntrusiveRc<CowFd> in Phase B.
    fn destroy(this: *mut CowFd) {
        // SAFETY: refcount==0, caller has exclusive ownership
        unsafe {
            debug_assert!((*this).refcount == 0);
            (*this).__fd.close();
            drop(Box::from_raw(this));
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CoroutineResult {
    /// it's okay for the caller to continue its execution
    Cont,
    Yield,
}

pub use crate::ref_counted_str::RefCountedStr;
pub use crate::env_str::EnvStr as EnvStrTy;
pub use crate::env_map::EnvMap as EnvMapTy;
pub use crate::parsed_shell_script::ParsedShellScript;

pub struct ShellArgs {
    /// This is the arena used to allocate the input shell script's AST nodes,
    /// tokens, and a string pool used to store all strings.
    pub __arena: Box<ArenaAllocator>,
    /// Root ast node
    pub script_ast: ast::Script,
}

impl ShellArgs {
    pub fn arena_allocator(&self) -> &ArenaAllocator {
        &self.__arena
    }

    pub fn init() -> Box<ShellArgs> {
        let arena = Box::new(ArenaAllocator::new());
        Box::new(ShellArgs {
            __arena: arena,
            // TODO(port): Zig used `undefined` here; we use Default — script_ast is set later.
            script_ast: ast::Script::default(),
        })
    }

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<ShellArgs>() + self.script_ast.memory_cost()
    }
}

impl Drop for ShellArgs {
    fn drop(&mut self) {
        // __arena is Box<ArenaAllocator> — Drop frees it (Zig: arena.deinit() + bun.destroy)
    }
}

pub use crate::states::assigns::AssignCtx;

// ────────────────────────────────────────────────────────────────────────────
// Interpreter
// ────────────────────────────────────────────────────────────────────────────

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
#[bun_jsc::JsClass]
pub struct Interpreter {
    pub command_ctx: crate::cli::command::Context,
    pub event_loop: jsc::EventLoopHandle,
    /// This is the allocator used to allocate interpreter state
    // TODO(port): allocator param removed in non-AST crate context, but Interpreter
    // straddles JS and shell-parse arenas. Retained as marker; uses global mimalloc.
    pub allocator: (),

    pub args: Box<ShellArgs>,

    /// JS objects used as input for the shell script
    /// This should be allocated using the arena
    // TODO(port): GC root for jsobjs — bare JSValue heap storage is invisible to the
    // conservative stack scan. Phase B: switch to bun_jsc::MarkedArgumentBuffer or
    // arena-allocated `*mut [JSValue]` rooted via the wrapper's visitChildren.
    pub jsobjs: *mut [JSValue],

    pub root_shell: ShellExecEnv,
    pub root_io: IO,

    pub has_pending_activity: AtomicU32,
    pub started: AtomicBool,
    // Necessary for builtin commands.
    pub keep_alive: bun_aio::KeepAlive,

    pub vm_args_utf8: Vec<jsc::ZigStringSlice>,
    pub async_commands_executing: u32,

    // JSC_BORROW: always borrowed, never owned. Stored as raw ptr because the
    // struct is heap-allocated and outlives any single &JSGlobalObject borrow scope.
    // TODO(port): lifetime — &JSGlobalObject per LIFETIMES.tsv; using raw ptr in heap struct
    pub global_this: *mut JSGlobalObject,

    pub flags: InterpreterFlags,
    pub exit_code: Option<ExitCode>,
    // TODO(port): bare JSValue on heap struct — this is the JS wrapper itself, kept
    // alive by the wrapper owning this m_ctx payload (self-reference). Phase B should
    // retype as bun_jsc::JsRef or document why no GC root is needed.
    pub this_jsvalue: JSValue,

    /// Tracks which resources have been cleaned up to avoid double-free.
    /// When the interpreter finishes normally via finish(), it cleans up
    /// the runtime resources (IO, shell env) and sets this to .runtime_cleaned.
    /// The GC finalizer then only cleans up what remains (args, interpreter itself).
    pub cleanup_state: CleanupState,

    #[cfg(feature = "alloc_scopes")]
    pub __alloc_scope: bun_alloc::AllocationScope,
    pub estimated_size_for_gc: usize,

    /// Side-channel for `try_()`: lets init/setup paths use `try`/`errdefer` for cleanup
    /// while still surfacing the rich syscall error (errno+path+syscall) at the boundary.
    pub last_err: Option<Syscall::Error>,
}

#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct InterpreterFlags(u8);

impl InterpreterFlags {
    pub const fn done(self) -> bool { self.0 & 0b1 != 0 }
    pub fn set_done(&mut self, v: bool) { if v { self.0 |= 0b1 } else { self.0 &= !0b1 } }
    pub const fn quiet(self) -> bool { self.0 & 0b10 != 0 }
    pub fn set_quiet(&mut self, v: bool) { if v { self.0 |= 0b10 } else { self.0 &= !0b10 } }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum CleanupState {
    /// Nothing has been cleaned up yet - need full cleanup
    NeedsFullCleanup,
    /// Runtime resources (IO, shell env) have been cleaned up via finish()
    RuntimeCleaned,
}

// State node re-exports
pub use crate::states::base as State;
pub use crate::states::script::Script;
pub use crate::states::stmt::Stmt;
pub use crate::states::pipeline::Pipeline;
pub use crate::states::binary::Binary;
pub use crate::states::subshell::Subshell;
pub use crate::states::expansion::Expansion;
pub use crate::states::assigns::Assigns;
pub use crate::states::r#async::Async;
pub use crate::states::cond_expr::CondExpr;
pub use crate::states::r#if::If;
pub use crate::states::cmd::Cmd;

pub type InterpreterChildPtr = StatePtrUnion<(Script,)>;

// ────────────────────────────────────────────────────────────────────────────
// ShellExecEnv
// ────────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
type PidT = libc::pid_t;
#[cfg(windows)]
type PidT = bun_sys::windows::libuv::uv_pid_t;

/// During execution, the shell has an "environment" or "context". This
/// contains important details like environment variables, cwd, etc. Every
/// state node is given a `*ShellExecEnv` which is stored in its header (see
/// `states/Base.zig`).
///
/// Certain state nodes like subshells, pipelines, and cmd substitutions
/// will duplicate their `*ShellExecEnv` so that they can make modifications
/// without affecting their parent `ShellExecEnv`. This is done in the
/// `.dupe_for_subshell` function.
///
/// For example:
///
/// ```bash
/// echo $(FOO=bar; echo $FOO); echo $FOO
/// ```
///
/// The $FOO variable is set inside the command substitution but not outside.
///
/// Note that stdin/stdout/stderr is also considered to be part of the
/// environment/context, but we keep that in a separate struct called `IO`. We do
/// this because stdin/stdout/stderr changes a lot and we don't want to copy
/// this `ShellExecEnv` struct too much.
///
/// More info here: https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_12
pub struct ShellExecEnv {
    pub kind: ShellExecEnvKind,

    /// This is the buffered stdout/stderr that captures the entire
    /// output of the script and is given to JS.
    ///
    /// Across the entire script execution, this is usually the same.
    ///
    /// It changes when a cmd substitution is run.
    ///
    /// These MUST use the `bun.default_allocator` Allocator
    pub _buffered_stdout: Bufio,
    pub _buffered_stderr: Bufio,

    /// TODO Performance optimization: make these env maps copy-on-write
    /// Shell env for expansion by the shell
    pub shell_env: EnvMap,
    /// Local environment variables to be given to a subprocess
    pub cmd_local_env: EnvMap,
    /// Exported environment variables available to all subprocesses. This includes system ones.
    pub export_env: EnvMap,

    /// The current working directory of the shell.
    /// Use an array list so we don't have to keep reallocating
    /// Always has zero-sentinel
    pub __prev_cwd: Vec<u8>,
    pub __cwd: Vec<u8>,
    pub cwd_fd: Fd,

    pub async_pids: SmolList<PidT, 4>,

    // BORROW_PARAM per LIFETIMES.tsv: &'a mut AllocationScope
    // TODO(port): lifetime — using raw ptr because ShellExecEnv is heap-allocated and
    // borrows from its owning Interpreter; Phase B will tighten.
    #[cfg(feature = "alloc_scopes")]
    pub __alloc_scope: *mut bun_alloc::AllocationScope,
}

pub enum Bufio {
    Owned(ByteList<u8>),
    // BORROW_PARAM per LIFETIMES.tsv: &'a mut ByteList — raw ptr in heap struct.
    Borrowed(*mut ByteList<u8>),
}

impl Bufio {
    pub fn memory_cost(&self) -> usize {
        match self {
            Bufio::Owned(owned) => owned.memory_cost(),
            // SAFETY: borrowed always points to a live parent buffer per :546,552
            Bufio::Borrowed(borrowed) => unsafe { (**borrowed).memory_cost() },
        }
    }
}

impl Default for Bufio {
    fn default() -> Self {
        Bufio::Owned(ByteList::default())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ShellExecEnvKind {
    #[default]
    Normal,
    CmdSubst,
    Subshell,
    Pipeline,
}

impl ShellExecEnv {
    pub fn allocator(&self) -> &dyn Allocator {
        #[cfg(feature = "alloc_scopes")]
        {
            // SAFETY: __alloc_scope set in init()/dupe_for_subshell() to outliving scope
            return unsafe { (*self.__alloc_scope).allocator() };
        }
        #[cfg(not(feature = "alloc_scopes"))]
        {
            bun_alloc::default_allocator()
        }
    }

    pub fn memory_cost(&self) -> usize {
        let mut size = core::mem::size_of::<ShellExecEnv>();
        size += self.shell_env.memory_cost();
        size += self.cmd_local_env.memory_cost();
        size += self.export_env.memory_cost();
        size += self.__cwd.capacity();
        size += self.__prev_cwd.capacity();
        size += self._buffered_stderr.memory_cost();
        size += self._buffered_stdout.memory_cost();
        size += self.async_pids.memory_cost();
        size
    }

    pub fn buffered_stdout(&mut self) -> *mut ByteList<u8> {
        match &mut self._buffered_stdout {
            Bufio::Owned(o) => o as *mut _,
            Bufio::Borrowed(b) => *b,
        }
    }

    pub fn buffered_stderr(&mut self) -> *mut ByteList<u8> {
        match &mut self._buffered_stderr {
            Bufio::Owned(o) => o as *mut _,
            Bufio::Borrowed(b) => *b,
        }
    }

    #[inline]
    pub fn cwd_z(&self) -> &ZStr {
        if self.__cwd.is_empty() {
            return ZStr::empty();
        }
        let len = self.__cwd.len().saturating_sub(1);
        // SAFETY: __cwd always has trailing NUL per invariant
        unsafe { ZStr::from_raw(self.__cwd.as_ptr(), len) }
    }

    #[inline]
    pub fn prev_cwd_z(&self) -> &ZStr {
        if self.__prev_cwd.is_empty() {
            return ZStr::empty();
        }
        let len = self.__prev_cwd.len().saturating_sub(1);
        // SAFETY: __prev_cwd always has trailing NUL per invariant
        unsafe { ZStr::from_raw(self.__prev_cwd.as_ptr(), len) }
    }

    #[inline]
    pub fn prev_cwd(&self) -> &[u8] {
        self.prev_cwd_z().as_bytes()
    }

    #[inline]
    pub fn cwd(&self) -> &[u8] {
        self.cwd_z().as_bytes()
    }

    /// Doesn't deref `this.io`
    ///
    /// If called by interpreter we have to:
    /// 1. not free this *ShellExecEnv, because its on a field on the interpreter
    /// 2. don't free buffered_stdout and buffered_stderr, because that is used for output
    fn deinit_impl<const DESTROY_THIS: bool, const FREE_BUFFERED_IO: bool>(this: *mut ShellExecEnv) {
        log!("[ShellExecEnv] deinit {:x}", this as usize);

        // SAFETY: caller ensures `this` is valid; DESTROY_THIS implies it was Box-allocated
        let me = unsafe { &mut *this };

        if FREE_BUFFERED_IO {
            if let Bufio::Owned(o) = &mut me._buffered_stdout {
                o.clear_and_free();
            }
            if let Bufio::Owned(o) = &mut me._buffered_stderr {
                o.clear_and_free();
            }
        }

        // shell_env / cmd_local_env / export_env / __cwd / __prev_cwd are dropped by Drop
        // but Zig calls explicit deinit; we mirror by manual drop-in-place semantics:
        // TODO(port): Phase B — verify EnvMap requires explicit deinit vs Drop.
        me.shell_env.deinit();
        me.cmd_local_env.deinit();
        me.export_env.deinit();
        me.__cwd.clear();
        me.__cwd.shrink_to_fit();
        me.__prev_cwd.clear();
        me.__prev_cwd.shrink_to_fit();
        closefd(me.cwd_fd);

        if DESTROY_THIS {
            // SAFETY: this was allocated via Box in dupe_for_subshell
            unsafe { drop(Box::from_raw(this)) };
        }
    }

    pub fn dupe_for_subshell(
        &mut self,
        #[cfg(feature = "alloc_scopes")] alloc_scope: *mut bun_alloc::AllocationScope,
        io: &IO,
        kind: ShellExecEnvKind,
    ) -> bun_sys::Result<*mut ShellExecEnv> {
        let dupedfd = match Syscall::dup(self.cwd_fd) {
            bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
            bun_sys::Result::Ok(fd) => fd,
        };

        let stdout: Bufio = match &io.stdout {
            io::OutKind::Fd(x) => 'brk: {
                if let Some(captured) = x.captured {
                    break 'brk Bufio::Borrowed(captured);
                }
                Bufio::Owned(ByteList::default())
            }
            io::OutKind::Ignore => Bufio::Owned(ByteList::default()),
            io::OutKind::Pipe => match kind {
                ShellExecEnvKind::Normal | ShellExecEnvKind::CmdSubst => {
                    Bufio::Owned(ByteList::default())
                }
                ShellExecEnvKind::Subshell | ShellExecEnvKind::Pipeline => {
                    Bufio::Borrowed(self.buffered_stdout())
                }
            },
        };

        let stderr: Bufio = match &io.stderr {
            io::OutKind::Fd(x) => 'brk: {
                if let Some(captured) = x.captured {
                    break 'brk Bufio::Borrowed(captured);
                }
                Bufio::Owned(ByteList::default())
            }
            io::OutKind::Ignore => Bufio::Owned(ByteList::default()),
            io::OutKind::Pipe => match kind {
                ShellExecEnvKind::Normal | ShellExecEnvKind::CmdSubst => {
                    Bufio::Owned(ByteList::default())
                }
                ShellExecEnvKind::Subshell | ShellExecEnvKind::Pipeline => {
                    Bufio::Borrowed(self.buffered_stderr())
                }
            },
        };

        let duped = Box::into_raw(Box::new(ShellExecEnv {
            kind,
            _buffered_stdout: stdout,
            _buffered_stderr: stderr,
            shell_env: self.shell_env.clone(),
            cmd_local_env: EnvMap::init(),
            export_env: self.export_env.clone(),

            __prev_cwd: self.__prev_cwd.clone(),
            __cwd: self.__cwd.clone(),
            // TODO probably need to use os.dup here
            cwd_fd: dupedfd,
            async_pids: SmolList::zeroes(),
            #[cfg(feature = "alloc_scopes")]
            __alloc_scope: alloc_scope,
        }));

        bun_sys::Result::Ok(duped)
    }

    /// NOTE: This will `.ref()` value, so you should `defer value.deref()` it before handing it to this function.
    pub fn assign_var(
        &mut self,
        _interp: &mut Interpreter,
        label: EnvStr,
        value: EnvStr,
        assign_ctx: AssignCtx,
    ) {
        match assign_ctx {
            AssignCtx::Cmd => self.cmd_local_env.insert(label, value),
            AssignCtx::Shell => self.shell_env.insert(label, value),
            AssignCtx::Exported => self.export_env.insert(label, value),
        }
    }

    pub fn change_prev_cwd(&mut self, interp: &mut Interpreter) -> bun_sys::Result<()> {
        // PORT NOTE: reshaped for borrowck — clone the ZStr bytes since change_cwd borrows self mutably
        let prev = self.prev_cwd_z().as_bytes().to_vec();
        // SAFETY: prev came from a NUL-terminated buffer
        self.change_cwd(interp, &prev)
    }

    pub fn change_cwd(
        &mut self,
        interp: &mut Interpreter,
        new_cwd_: &[u8],
    ) -> bun_sys::Result<()> {
        self.change_cwd_impl::<false>(interp, new_cwd_)
    }

    pub fn change_cwd_impl<const IN_INIT: bool>(
        &mut self,
        _interp: &mut Interpreter,
        new_cwd_: &[u8],
    ) -> bun_sys::Result<()> {
        // TODO(port): Zig used `anytype` to accept both [:0]const u8 and []const u8.
        // In Rust we accept &[u8]; sentinel handling is folded into the abs branch below.
        let is_abs = ResolvePath::Platform::auto().is_absolute(new_cwd_);

        // Both branches below write into the 4096-byte threadlocal
        // `ResolvePath.join_buf` with no bounds check: the absolute branch
        // `@memcpy`s `new_cwd_` directly, and the relative branch normalizes
        // `cwd + "/" + new_cwd_` into it via `joinZ`. In ReleaseFast (where
        // slice bounds are elided) an oversized input overflows adjacent TLS
        // and segfaults. Normalization never grows the path, so bounding the
        // un-normalized length is sufficient (and matches POSIX `chdir`, which
        // returns ENAMETOOLONG on argument length, not canonicalized length).
        let required_len = if is_abs {
            new_cwd_.len()
        } else {
            self.cwd().len() + 1 + new_cwd_.len()
        };
        if required_len >= ResolvePath::join_buf_len() {
            return bun_sys::Result::Err(Syscall::Error::from_code(
                Syscall::Errno::NAMETOOLONG,
                Syscall::Tag::Chdir,
            ));
        }

        // TODO(port): ResolvePath::join_buf is a threadlocal in Zig; in Rust use
        // ResolvePath::with_join_buf(|buf| { ... }) — Phase B will provide the API.
        let new_cwd: &ZStr = ResolvePath::with_join_buf(|join_buf: &mut [u8]| -> &ZStr {
            if is_abs {
                join_buf[..new_cwd_.len()].copy_from_slice(new_cwd_);
                join_buf[new_cwd_.len()] = 0;
                // SAFETY: NUL written at [len]
                return unsafe { ZStr::from_raw(join_buf.as_ptr(), new_cwd_.len()) };
            }

            let existing_cwd = self.cwd();
            let cwd_str = ResolvePath::join_z(
                &[existing_cwd, new_cwd_],
                ResolvePath::Platform::auto(),
            );

            // remove trailing separator
            #[cfg(windows)]
            {
                const SEP: u8 = b'\\';
                if cwd_str.len() > 1 && cwd_str.as_bytes()[cwd_str.len() - 1] == SEP {
                    join_buf[cwd_str.len() - 1] = 0;
                    // SAFETY: NUL written at [len-1]
                    return unsafe { ZStr::from_raw(join_buf.as_ptr(), cwd_str.len() - 1) };
                }
            }
            if cwd_str.len() > 1 && cwd_str.as_bytes()[cwd_str.len() - 1] == b'/' {
                join_buf[cwd_str.len() - 1] = 0;
                // SAFETY: NUL written at [len-1]
                return unsafe { ZStr::from_raw(join_buf.as_ptr(), cwd_str.len() - 1) };
            }

            cwd_str
        });

        let new_cwd_fd = match ShellSyscall::openat(
            self.cwd_fd,
            new_cwd,
            bun_sys::O::DIRECTORY | bun_sys::O::RDONLY,
            0,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
        };
        let _ = self.cwd_fd.close_allowing_bad_file_descriptor(None);

        self.__prev_cwd.clear();
        self.__prev_cwd.extend_from_slice(&self.__cwd);

        self.__cwd.clear();
        // include the trailing NUL
        self.__cwd
            .extend_from_slice(&new_cwd.as_bytes_with_nul());

        if cfg!(debug_assertions) {
            debug_assert!(self.__cwd[self.__cwd.len().saturating_sub(1)] == 0);
            debug_assert!(self.__prev_cwd[self.__prev_cwd.len().saturating_sub(1)] == 0);
        }

        self.cwd_fd = new_cwd_fd;

        if !IN_INIT {
            self.export_env
                .insert(EnvStr::init_slice(b"OLDPWD"), EnvStr::init_slice(self.prev_cwd()));
        }
        self.export_env
            .insert(EnvStr::init_slice(b"PWD"), EnvStr::init_slice(self.cwd()));

        bun_sys::Result::Ok(())
    }

    pub fn get_homedir(&self) -> EnvStr {
        let env_var: Option<EnvStr> = {
            let static_str = if cfg!(windows) {
                EnvStr::init_slice(b"USERPROFILE")
            } else {
                EnvStr::init_slice(b"HOME")
            };
            self.shell_env.get(static_str).or_else(|| self.export_env.get(static_str))
        };
        env_var.unwrap_or_else(|| {
            EnvStr::init_slice(if cfg!(target_os = "android") {
                b"/data/local/tmp"
            } else {
                b""
            })
        })
    }

    pub fn write_failing_error_fmt<C>(
        &mut self,
        ctx: C,
        enqueue_cb: fn(C),
        args: core::fmt::Arguments<'_>,
    ) -> Yield
    where
        C: crate::states::base::HasIo + crate::states::base::HasParent,
    {
        // TODO(port): Zig used `anytype` for ctx and `comptime fmt`; here we take fmt::Arguments.
        let io: &mut io::OutKind = ctx.io_mut().stderr_mut();
        match io {
            io::OutKind::Fd(x) => {
                enqueue_cb(ctx);
                x.writer.enqueue_fmt(ctx, x.captured, args)
            }
            io::OutKind::Pipe => {
                // SAFETY: buffered_stderr returns valid ptr to owned/borrowed ByteList
                let bufio = unsafe { &mut *self.buffered_stderr() };
                use std::io::Write;
                let _ = write!(bufio, "{}", args);
                ctx.parent().child_done(ctx, 1)
            }
            // FIXME: This is not correct? This would just make the entire shell hang I think?
            io::OutKind::Ignore => {
                let childptr = IOWriterChildPtr::init(ctx);
                // TODO: is this necessary
                let count = {
                    // std.fmt.count(fmt, args) → compute formatted byte length
                    struct Counting(usize);
                    impl core::fmt::Write for Counting {
                        fn write_str(&mut self, s: &str) -> core::fmt::Result {
                            self.0 += s.len();
                            Ok(())
                        }
                    }
                    let mut c = Counting(0);
                    let _ = core::fmt::write(&mut c, args);
                    c.0
                };
                Yield::OnIoWriterChunk {
                    child: childptr.as_any_opaque(),
                    err: None,
                    written: count,
                }
            }
        }
    }
}

impl Drop for ShellExecEnv {
    fn drop(&mut self) {
        // Zig: deinit() → deinitImpl(true, true). Rust callers that need the
        // (false,*) variants call deinit_impl directly; default Drop frees IO + self.
        // TODO(port): Phase B — verify all callers; Interpreter's root_shell must NOT
        // run the destroy_this=true path. Guard via ManuallyDrop in Interpreter if needed.
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Interpreter — error handling helpers and inner types
// ────────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ShellErrorKind {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("Syscall")]
    Syscall,
}

pub enum ShellErrorCtx {
    Syscall(Syscall::Error),
    Other(ShellErrorKind),
}

impl ShellErrorCtx {
    fn to_js(&self, global_this: &JSGlobalObject) -> JSValue {
        match self {
            ShellErrorCtx::Syscall(err) => err.to_js(global_this),
            ShellErrorCtx::Other(err) => {
                jsc::ZigString::from_bytes(<&'static str>::from(err).as_bytes()).to_js(global_this)
            }
        }
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SysOnly {
    #[error("Sys")]
    Sys,
}

/// Standalone error sink for code paths where `*ThisInterpreter` isn't available yet
/// (e.g. `ThisInterpreter.init` before the struct is constructed). Same path-lifetime
/// caveat as `ThisInterpreter.try_`.
#[derive(Default)]
pub struct Catch {
    pub err: Option<Syscall::Error>,
}

impl Catch {
    pub fn try_<T>(&mut self, m: bun_sys::Result<T>) -> Result<T, SysOnly> {
        match m {
            bun_sys::Result::Ok(r) => Ok(r),
            bun_sys::Result::Err(e) => {
                self.err = Some(e);
                Err(SysOnly::Sys)
            }
        }
    }

    pub fn take(&mut self) -> Syscall::Error {
        self.err.take().unwrap()
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Interpreter impl
// ────────────────────────────────────────────────────────────────────────────

type ThisInterpreter = Interpreter;

impl Interpreter {
    /// Unwrap a `Maybe(T)` into `error{Sys}!T`, stashing the syscall error on `last_err`.
    /// Use with `?` so cleanup fires for resources acquired earlier in the function.
    /// The boundary `match`es and reads `take_err()` to surface it.
    ///
    /// The stashed `Syscall.Error.path` is borrowed; the catch boundary must be inside the
    /// scope that owns any path buffer passed to the failing syscall. In practice keep the
    /// `try_` calls and the `catch` in the same function.
    ///
    /// Main-thread only — thread-pool task bodies must keep using `Maybe` directly.
    pub fn try_<T>(&mut self, m: bun_sys::Result<T>) -> Result<T, SysOnly> {
        match m {
            bun_sys::Result::Ok(r) => Ok(r),
            bun_sys::Result::Err(e) => {
                self.last_err = Some(e);
                Err(SysOnly::Sys)
            }
        }
    }

    pub fn take_err(&mut self) -> Syscall::Error {
        self.last_err.take().unwrap()
    }

    fn compute_estimated_size_for_gc(&self) -> usize {
        let mut size = core::mem::size_of::<ThisInterpreter>();
        size += self.args.memory_cost();
        size += self.root_shell.memory_cost();
        size += self.root_io.memory_cost();
        size += self.jsobjs.len() * core::mem::size_of::<JSValue>();
        for arg in self.vm_args_utf8.iter() {
            size += arg.byte_slice().len();
        }
        size += self.vm_args_utf8.capacity() * core::mem::size_of::<jsc::ZigStringSlice>();
        size
    }

    pub fn memory_cost(&self) -> usize {
        self.compute_estimated_size_for_gc()
    }

    pub fn estimated_size(&self) -> usize {
        self.estimated_size_for_gc
    }

    #[bun_jsc::host_fn]
    pub fn create_shell_interpreter(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old(3);
        let mut arguments = jsc::CallFrame::ArgumentsSlice::init(global_this.bun_vm(), arguments_.slice());

        let resolve = arguments
            .next_eat()
            .ok_or_else(|| global_this.throw("shell: expected 3 arguments, got 0"))?;

        let reject = arguments
            .next_eat()
            .ok_or_else(|| global_this.throw("shell: expected 3 arguments, got 0"))?;

        let parsed_shell_script_js = arguments
            .next_eat()
            .ok_or_else(|| global_this.throw("shell: expected 3 arguments, got 0"))?;

        let parsed_shell_script = parsed_shell_script_js
            .as_::<ParsedShellScript>()
            .ok_or_else(|| global_this.throw("shell: expected a ParsedShellScript"))?;

        let mut shargs: Box<ShellArgs>;
        // TODO(port): GC root — do not hold JSValues in Vec on the heap. Phase B should
        // use bun_jsc::MarkedArgumentBuffer (or arena slice rooted by the JS wrapper).
        let mut jsobjs = bun_jsc::MarkedArgumentBuffer::new();
        let mut quiet: bool = false;
        let mut cwd: Option<bun_str::String> = None;
        let mut export_env: Option<EnvMap> = None;

        if parsed_shell_script.args.is_none() {
            return Err(global_this.throw(
                "shell: shell args is null, this is a bug in Bun. Please file a GitHub issue.",
            ));
        }

        parsed_shell_script.take(
            global_this,
            &mut shargs,
            &mut jsobjs,
            &mut quiet,
            &mut cwd,
            &mut export_env,
        );

        // defer cwd.deref() — bun_str::String impls Drop
        let cwd_string: Option<bun_str::Utf8Slice<'_>> = cwd.as_ref().map(|c| c.to_utf8());
        // defer cwd_string.deinit() — Utf8Slice impls Drop

        let interpreter: *mut Interpreter = match ThisInterpreter::init(
            // command_ctx, unused when event_loop is .js
            // TODO(port): Zig passed `undefined`; using a sentinel default
            crate::cli::command::Context::default(),
            EventLoopHandle::Js(global_this.bun_vm().event_loop()),
            shargs,
            // TODO(port): GC root — pass arena-backed raw slice; ownership tracked by JS wrapper.
            jsobjs.as_mut_slice() as *mut [JSValue],
            export_env,
            cwd_string.as_ref().map(|c| c.slice()),
        ) {
            shell::Result::Ok(i) => i,
            shell::Result::Err(e) => {
                // jsobjs dropped automatically
                // export_env is consumed by init() on both success and failure.
                // shargs.deinit() — Box<ShellArgs> dropped via init's error path
                // TODO(port): ownership transfer of shargs on error path needs Phase B review
                return throw_shell_err(&e, EventLoopHandle::Js(global_this.bun_vm().event_loop()));
            }
        };

        // SAFETY: init returns a valid heap-allocated *mut Interpreter
        let interp = unsafe { &mut *interpreter };

        if global_this.has_exception() {
            // Note: export_env is now owned by interpreter.root_shell; finalize() will deinit it.
            // Note: Don't call shargs.deinit() here - interpreter.finalize() will do it
            // since interpreter.args points to shargs after init() succeeds.
            interp.finalize();
            return Err(jsc::JsError::Thrown);
        }

        interp.flags.set_quiet(quiet);
        interp.global_this = global_this as *const _ as *mut _;
        interp.estimated_size_for_gc = interp.compute_estimated_size_for_gc();

        // SAFETY: FFI — global_this is a live &JSGlobalObject, interpreter is a valid
        // heap-allocated *mut Interpreter from init(), and the JSValue args are live
        // call-frame arguments rooted for the duration of this host call.
        let js_value = unsafe {
            Bun__createShellInterpreter(
                global_this,
                interpreter,
                parsed_shell_script_js,
                resolve,
                reject,
            )
        };
        interp.this_jsvalue = js_value;
        interp.keep_alive.ref_(global_this.bun_vm());
        bun_core::analytics::Features::shell_incr(1);
        Ok(js_value)
    }

    pub fn parse(
        arena_allocator: &ArenaAllocator,
        script: &[u8],
        jsobjs: &[JSValue],
        jsstrings_to_escape: &[bun_str::String],
        out_parser: &mut Option<shell::Parser>,
        out_lex_result: &mut Option<shell::LexResult>,
    ) -> Result<ast::Script, bun_core::Error> {
        // TODO(port): narrow error set
        let jsobjs_len: u32 = u32::try_from(jsobjs.len()).unwrap();
        let lex_result = 'brk: {
            if bun_str::strings::is_all_ascii(script) {
                let mut lexer =
                    shell::LexerAscii::new(arena_allocator, script, jsstrings_to_escape, jsobjs_len);
                lexer.lex()?;
                break 'brk lexer.get_result();
            }
            let mut lexer =
                shell::LexerUnicode::new(arena_allocator, script, jsstrings_to_escape, jsobjs_len);
            lexer.lex()?;
            lexer.get_result()
        };

        if !lex_result.errors.is_empty() {
            *out_lex_result = Some(lex_result);
            return Err(shell::ParseError::Lex.into());
        }

        #[cfg(debug_assertions)]
        {
            let mut test_tokens: Vec<shell::test::TestToken> =
                Vec::with_capacity(lex_result.tokens.len());
            for tok in lex_result.tokens.iter() {
                let test_tok = shell::test::TestToken::from_real(*tok, &lex_result.strpool);
                test_tokens.push(test_tok);
            }

            // TODO(port): std.json.fmt — use serde_json or similar in Phase B
            bun_output::scoped_log!(ShellTokens, "Tokens: {:?}", test_tokens);
        }

        *out_parser = Some(shell::Parser::new(arena_allocator, lex_result, jsobjs)?);

        let script_ast = out_parser.as_mut().unwrap().parse()?;
        Ok(script_ast)
    }

    /// If all initialization allocations succeed, the arena will be copied
    /// into the interpreter struct, so it is not a stale reference and safe to call `arena.deinit()` on error.
    pub fn init(
        ctx: crate::cli::command::Context,
        event_loop: EventLoopHandle,
        shargs: Box<ShellArgs>,
        jsobjs: *mut [JSValue],
        export_env_: Option<EnvMap>,
        cwd_: Option<&[u8]>,
    ) -> shell::Result<*mut ThisInterpreter> {
        // Hoisted so the catch boundary's to_shell_system_error() can read err.path
        // (which borrows from this buffer) before it's returned to the pool.
        let pathbuf = bun_paths::path_buffer_pool().get();

        let mut sys = Catch::default();
        let interpreter = match Self::init_impl(
            &mut sys, ctx, event_loop, shargs, jsobjs, export_env_, &mut *pathbuf,
        ) {
            Ok(i) => i,
            Err(_) => {
                return shell::Result::Err(shell::ShellErr::Sys(
                    sys.take().to_shell_system_error(),
                ));
            }
        };

        // SAFETY: init_impl returns valid heap-allocated *mut ThisInterpreter
        let interp = unsafe { &mut *interpreter };

        if let Some(c) = cwd_ {
            if let Some(e) = interp.root_shell.change_cwd_impl::<true>(interp, c).as_err() {
                let sys_err = e.to_shell_system_error();
                interp.root_io.deref();
                ShellExecEnv::deinit_impl::<false, true>(&mut interp.root_shell as *mut _);
                #[cfg(feature = "alloc_scopes")]
                interp.__alloc_scope.deinit();
                // SAFETY: interpreter was Box-allocated in init_impl
                unsafe { drop(Box::from_raw(interpreter)) };
                return shell::Result::Err(shell::ShellErr::Sys(sys_err));
            }
        }

        #[cfg(feature = "alloc_scopes")]
        {
            interp.root_shell.__alloc_scope = &mut interp.__alloc_scope as *mut _;
        }

        shell::Result::Ok(interpreter)
    }

    fn init_impl(
        sys: &mut Catch,
        ctx: crate::cli::command::Context,
        event_loop: EventLoopHandle,
        shargs: Box<ShellArgs>,
        jsobjs: *mut [JSValue],
        export_env_: Option<EnvMap>,
        pathbuf: &mut PathBuffer,
    ) -> Result<*mut ThisInterpreter, SysOnly> {
        let export_env = 'brk: {
            if matches!(event_loop, EventLoopHandle::Js(_)) {
                break 'brk export_env_.unwrap_or_else(EnvMap::init);
            }

            let env_loader: &mut bun_dotenv::Loader = 'env_loader: {
                if let EventLoopHandle::Js(js) = &event_loop {
                    break 'env_loader js.virtual_machine().transpiler().env();
                }
                event_loop.env()
            };

            // This will save ~2x memory
            let mut export_env =
                EnvMap::init_with_capacity(env_loader.map().map().entries_len());

            let mut iter = env_loader.iterator();

            while let Some(entry) = iter.next() {
                let value = EnvStr::init_slice(entry.value().value());
                let key = EnvStr::init_slice(entry.key());
                export_env.insert(key, value);
            }

            export_env
        };
        // init() consumes export_env_ regardless of outcome; callers must not free it.
        // errdefer export_env.deinit()
        let export_env = scopeguard::guard(export_env, |mut e| e.deinit());

        let cwd: &ZStr = sys.try_(Syscall::getcwd_z(pathbuf))?;

        let cwd_fd = sys.try_(Syscall::open(cwd, bun_sys::O::DIRECTORY | bun_sys::O::RDONLY, 0))?;
        // errdefer cwd_fd.close()
        let cwd_fd = scopeguard::guard(cwd_fd, |fd| fd.close());

        let mut cwd_arr: Vec<u8> = Vec::with_capacity(cwd.len() + 1);
        cwd_arr.extend_from_slice(cwd.as_bytes_with_nul());
        // errdefer cwd_arr.deinit() — Vec drops automatically

        if cfg!(debug_assertions) {
            debug_assert!(cwd_arr[cwd_arr.len().saturating_sub(1)] == 0);
        }

        log!("Duping stdin");
        let stdin_fd = sys.try_(if Output::Source::Stdio::is_stdin_null() {
            bun_sys::open_null_device()
        } else {
            ShellSyscall::dup(shell::STDIN_FD)
        })?;

        let stdin_reader = IOReader::init(stdin_fd, event_loop);
        // errdefer stdin_reader.deref()
        let stdin_reader = scopeguard::guard(stdin_reader, |r| r.deref());

        // Disarm all errdefer guards — no more fallible ops past this point.
        let export_env = scopeguard::ScopeGuard::into_inner(export_env);
        let cwd_fd = scopeguard::ScopeGuard::into_inner(cwd_fd);
        let stdin_reader = scopeguard::ScopeGuard::into_inner(stdin_reader);

        let interpreter = Box::into_raw(Box::new(ThisInterpreter {
            command_ctx: ctx,
            event_loop,

            args: shargs,
            allocator: (),
            jsobjs,

            root_shell: ShellExecEnv {
                kind: ShellExecEnvKind::Normal,
                _buffered_stdout: Bufio::default(),
                _buffered_stderr: Bufio::default(),
                shell_env: EnvMap::init(),
                cmd_local_env: EnvMap::init(),
                export_env,

                __cwd: cwd_arr.clone(),
                __prev_cwd: cwd_arr,
                cwd_fd,

                async_pids: SmolList::zeroes(),
                #[cfg(feature = "alloc_scopes")]
                __alloc_scope: core::ptr::null_mut(), // set after construction
            },

            root_io: IO {
                stdin: io::InKind::Fd(stdin_reader),
                // By default stdout/stderr should be an IOWriter writing to a dup'ed stdout/stderr
                // But if the user later calls `.set_quiet(true)` then all those syscalls/initialization was pointless work
                // So we cheaply initialize them now as `.pipe`
                // When `Interpreter.run()` is called, we check if `this.flags.quiet == false`, if so then we then properly initialize the IOWriter
                stdout: io::OutKind::Pipe,
                stderr: io::OutKind::Pipe,
            },

            has_pending_activity: AtomicU32::new(0),
            started: AtomicBool::new(false),
            keep_alive: bun_aio::KeepAlive::default(),

            vm_args_utf8: Vec::new(),
            async_commands_executing: 0,

            global_this: core::ptr::null_mut(), // set later in create_shell_interpreter
            flags: InterpreterFlags::default(),
            exit_code: Some(0),
            this_jsvalue: JSValue::ZERO,
            cleanup_state: CleanupState::NeedsFullCleanup,
            #[cfg(feature = "alloc_scopes")]
            __alloc_scope: bun_alloc::AllocationScope::init(),
            estimated_size_for_gc: 0,
            last_err: None,
        }));

        Ok(interpreter)
    }

    pub fn init_and_run_from_file(
        ctx: crate::cli::command::Context,
        mini: &mut jsc::MiniEventLoop,
        path: &[u8],
    ) -> Result<shell::ExitCode, bun_core::Error> {
        let mut shargs = ShellArgs::init();
        // TODO(port): Zig used std.fs.cwd().readFileAlloc — use bun_sys::File::read_from
        let src = bun_sys::File::read_from(Fd::cwd(), path, shargs.arena_allocator())
            .map_err(|e| bun_core::Error::from(e))?;

        let jsobjs: &[JSValue] = &[];
        let mut out_parser: Option<shell::Parser> = None;
        let mut out_lex_result: Option<shell::LexResult> = None;
        let script = match ThisInterpreter::parse(
            shargs.arena_allocator(),
            &src,
            jsobjs,
            &[],
            &mut out_parser,
            &mut out_lex_result,
        ) {
            Ok(s) => s,
            Err(err) => {
                if err == shell::ParseError::Lex.into() {
                    debug_assert!(out_lex_result.is_some());
                    let str = out_lex_result
                        .unwrap()
                        .combine_errors(shargs.arena_allocator());
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: Failed to run <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(bun_paths::basename(path)),
                        bstr::BStr::new(&str)
                    ));
                    Global::exit(1);
                }

                if let Some(p) = &mut out_parser {
                    let errstr = p.combine_errors();
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: Failed to run <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(bun_paths::basename(path)),
                        bstr::BStr::new(&errstr)
                    ));
                    Global::exit(1);
                }

                return Err(err);
            }
        };
        shargs.script_ast = script;
        let interp = match ThisInterpreter::init(
            ctx,
            EventLoopHandle::Mini(mini),
            shargs,
            Box::new([]),
            None,
            None,
        ) {
            shell::Result::Err(e) => e.throw_mini(),
            shell::Result::Ok(i) => i,
        };
        // SAFETY: init returned valid ptr
        let interp = unsafe { &mut *interp };

        let exit_code: ExitCode = 1;

        struct IsDone<'a> {
            interp: &'a Interpreter,
        }
        impl<'a> IsDone<'a> {
            extern "C" fn is_done(this: *mut c_void) -> bool {
                // SAFETY: this points to IsDone
                let asdlfk = unsafe { &*(this as *const IsDone<'_>) };
                asdlfk.interp.flags.done()
            }
        }
        let mut is_done = IsDone { interp };
        interp.exit_code = Some(exit_code);
        match interp.run()? {
            bun_sys::Result::Err(e) => {
                interp.deinit_from_exec();
                Output::err(
                    e,
                    format_args!(
                        "Failed to run script <b>{}<r>",
                        bstr::BStr::new(bun_paths::basename(path))
                    ),
                );
                Global::exit(1);
            }
            _ => {}
        }
        mini.tick(&mut is_done as *mut _ as *mut c_void, IsDone::is_done);
        let code = interp.exit_code.unwrap();
        interp.deinit_from_exec();
        Ok(code)
    }

    pub fn init_and_run_from_source(
        ctx: crate::cli::command::Context,
        mini: &mut jsc::MiniEventLoop,
        path_for_errors: &[u8],
        src: &[u8],
        cwd: Option<&[u8]>,
    ) -> Result<ExitCode, bun_core::Error> {
        bun_core::analytics::Features::standalone_shell_incr(1);
        let mut shargs = ShellArgs::init();

        let jsobjs: &[JSValue] = &[];
        let mut out_parser: Option<shell::Parser> = None;
        let mut out_lex_result: Option<shell::LexResult> = None;
        let script = match ThisInterpreter::parse(
            shargs.arena_allocator(),
            src,
            jsobjs,
            &[],
            &mut out_parser,
            &mut out_lex_result,
        ) {
            Ok(s) => s,
            Err(err) => {
                if err == shell::ParseError::Lex.into() {
                    debug_assert!(out_lex_result.is_some());
                    let str = out_lex_result
                        .unwrap()
                        .combine_errors(shargs.arena_allocator());
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(path_for_errors),
                        bstr::BStr::new(&str)
                    ));
                    Global::exit(1);
                }

                if let Some(p) = &mut out_parser {
                    let errstr = p.combine_errors();
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(path_for_errors),
                        bstr::BStr::new(&errstr)
                    ));
                    Global::exit(1);
                }

                return Err(err);
            }
        };
        shargs.script_ast = script;
        let interp: *mut ThisInterpreter = match ThisInterpreter::init(
            ctx,
            EventLoopHandle::Mini(mini),
            shargs,
            Box::new([]),
            None,
            cwd,
        ) {
            shell::Result::Err(e) => e.throw_mini(),
            shell::Result::Ok(i) => i,
        };
        // SAFETY: init returned valid ptr
        let interp = unsafe { &mut *interp };

        struct IsDone<'a> {
            interp: &'a Interpreter,
        }
        impl<'a> IsDone<'a> {
            extern "C" fn is_done(this: *mut c_void) -> bool {
                // SAFETY: this points to IsDone
                let asdlfk = unsafe { &*(this as *const IsDone<'_>) };
                asdlfk.interp.flags.done()
            }
        }
        let mut is_done = IsDone { interp };
        let exit_code: ExitCode = 1;
        interp.exit_code = Some(exit_code);
        match interp.run()? {
            bun_sys::Result::Err(e) => {
                interp.deinit_from_exec();
                Output::err(
                    e,
                    format_args!("Failed to run script <b>{}<r>", bstr::BStr::new(path_for_errors)),
                );
                Global::exit(1);
            }
            _ => {}
        }
        mini.tick(&mut is_done as *mut _ as *mut c_void, IsDone::is_done);
        let code = interp.exit_code.unwrap();
        interp.deinit_from_exec();
        Ok(code)
    }

    fn setup_io_before_run(&mut self) -> bun_sys::Result<()> {
        match self.setup_io_before_run_impl() {
            Ok(()) => bun_sys::Result::Ok(()),
            Err(_) => bun_sys::Result::Err(self.take_err()),
        }
    }

    fn setup_io_before_run_impl(&mut self) -> Result<(), SysOnly> {
        if !self.flags.quiet() {
            let event_loop = self.event_loop;

            log!("Duping stdout");
            let stdout_fd = self.try_(if Output::Source::Stdio::is_stdout_null() {
                bun_sys::open_null_device()
            } else {
                ShellSyscall::dup(Fd::stdout())
            })?;
            let stdout_guard = scopeguard::guard(stdout_fd, |fd| fd.close());

            log!("Duping stderr");
            let stderr_fd = self.try_(if Output::Source::Stdio::is_stderr_null() {
                bun_sys::open_null_device()
            } else {
                ShellSyscall::dup(Fd::stderr())
            })?;
            let stderr_guard = scopeguard::guard(stderr_fd, |fd| fd.close());

            let stdout_fd = scopeguard::ScopeGuard::into_inner(stdout_guard);
            let stderr_fd = scopeguard::ScopeGuard::into_inner(stderr_guard);

            let stdout_writer = IOWriter::init(
                stdout_fd,
                IOWriter::Flags {
                    pollable: is_pollable(stdout_fd, event_loop.stdout().data().file().mode()),
                    ..Default::default()
                },
                event_loop,
            );
            let stderr_writer = IOWriter::init(
                stderr_fd,
                IOWriter::Flags {
                    pollable: is_pollable(stderr_fd, event_loop.stderr().data().file().mode()),
                    ..Default::default()
                },
                event_loop,
            );

            self.root_io = IO {
                stdin: self.root_io.stdin,
                stdout: io::OutKind::Fd(io::OutFd {
                    writer: stdout_writer,
                    captured: None,
                }),
                stderr: io::OutKind::Fd(io::OutFd {
                    writer: stderr_writer,
                    captured: None,
                }),
            };

            if matches!(event_loop, EventLoopHandle::Js(_)) {
                if let io::OutKind::Fd(f) = &mut self.root_io.stdout {
                    if let Bufio::Owned(o) = &mut self.root_shell._buffered_stdout {
                        f.captured = Some(o as *mut _);
                    }
                }
                if let io::OutKind::Fd(f) = &mut self.root_io.stderr {
                    if let Bufio::Owned(o) = &mut self.root_shell._buffered_stderr {
                        f.captured = Some(o as *mut _);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn run(&mut self) -> Result<bun_sys::Result<()>, bun_core::Error> {
        log!("Interpreter(0x{:x}) run", self as *const _ as usize);
        if let Some(e) = self.setup_io_before_run().as_err() {
            return Ok(bun_sys::Result::Err(e));
        }

        let root = Script::init(
            self,
            &mut self.root_shell,
            &self.args.script_ast,
            Script::ParentPtr::init(self),
            self.root_io.copy(),
        );
        self.started.store(true, Ordering::SeqCst);
        root.start().run();

        Ok(bun_sys::Result::Ok(()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn run_from_js(
        this: &mut Self,
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        log!("Interpreter(0x{:x}) runFromJS", this as *const _ as usize);

        if let Some(e) = this.setup_io_before_run().as_err() {
            this.deref_root_shell_and_io_if_needed(true);
            let shellerr = shell::ShellErr::new_sys(e);
            return throw_shell_err(
                &shellerr,
                EventLoopHandle::Js(global_this.bun_vm().event_loop()),
            );
        }
        incr_pending_activity_flag(&this.has_pending_activity);

        let root = Script::init(
            this,
            &mut this.root_shell,
            &this.args.script_ast,
            Script::ParentPtr::init(this),
            this.root_io.copy(),
        );
        this.started.store(true, Ordering::SeqCst);
        root.start().run();
        if global_this.has_exception() {
            return Err(jsc::JsError::Thrown);
        }

        Ok(JSValue::UNDEFINED)
    }

    fn io_to_js_value(global_this: &JSGlobalObject, buf: &mut ByteList<u8>) -> JSValue {
        let bytelist = core::mem::take(buf);
        let buffer = jsc::node::Buffer {
            allocator: (), // bun.default_allocator
            buffer: jsc::ArrayBuffer::from_bytes(bytelist.into_slice_mut(), jsc::TypedArrayType::Uint8Array),
        };
        buffer.to_node_buffer(global_this)
    }

    pub fn async_cmd_done(&mut self, async_: &mut Async) {
        log!("asyncCommandDone {}", async_);
        async_.actually_deinit();
        self.async_commands_executing -= 1;
        if self.async_commands_executing == 0 && self.exit_code.is_some() {
            self.finish(self.exit_code.unwrap()).run();
        }
    }

    pub fn child_done(&mut self, child: InterpreterChildPtr, exit_code: ExitCode) -> Yield {
        if child.ptr.is::<Script>() {
            let script = child.as_::<Script>();
            script.deinit_from_interpreter();
            self.exit_code = Some(exit_code);
            if self.async_commands_executing == 0 {
                return self.finish(exit_code);
            }
            return Yield::Suspended;
        }
        panic!("Bad child");
    }

    pub fn finish(&mut self, exit_code: ExitCode) -> Yield {
        log!(
            "Interpreter(0x{:x}) finish {}",
            self as *const _ as usize,
            exit_code
        );
        let _decr = scopeguard::guard(&self.has_pending_activity, |hpa| {
            decr_pending_activity_flag(hpa)
        });

        if matches!(self.event_loop, EventLoopHandle::Js(_)) {
            self.exit_code = Some(exit_code);
            let this_jsvalue = self.this_jsvalue;
            if !this_jsvalue.is_empty() {
                if let Some(resolve) =
                    jsc::codegen::JSShellInterpreter::resolve_get_cached(this_jsvalue)
                {
                    let loop_ = self.event_loop.js();
                    // SAFETY: global_this set in create_shell_interpreter
                    let global_this = unsafe { &*self.global_this };
                    let buffered_stdout = self.get_buffered_stdout(global_this);
                    let buffered_stderr = self.get_buffered_stderr(global_this);
                    self.keep_alive.disable();
                    self.deref_root_shell_and_io_if_needed(true);
                    loop_.enter();
                    let _ = resolve
                        .call(
                            global_this,
                            JSValue::UNDEFINED,
                            &[
                                JSValue::js_number_from_u16(exit_code),
                                buffered_stdout,
                                buffered_stderr,
                            ],
                        )
                        .map_err(|err| global_this.report_active_exception_as_unhandled(err));
                    jsc::codegen::JSShellInterpreter::resolve_set_cached(
                        this_jsvalue,
                        global_this,
                        JSValue::UNDEFINED,
                    );
                    jsc::codegen::JSShellInterpreter::reject_set_cached(
                        this_jsvalue,
                        global_this,
                        JSValue::UNDEFINED,
                    );
                    loop_.exit();
                }
            }
        } else {
            self.flags.set_done(true);
            self.exit_code = Some(exit_code);
        }

        Yield::Done
    }

    fn deref_root_shell_and_io_if_needed(&mut self, free_buffered_io: bool) {
        // Check if already cleaned up to prevent double-free
        if self.cleanup_state == CleanupState::RuntimeCleaned {
            return;
        }

        if free_buffered_io {
            // Can safely be called multiple times.
            if let Bufio::Owned(o) = &mut self.root_shell._buffered_stderr {
                o.clear_and_free();
            }
            if let Bufio::Owned(o) = &mut self.root_shell._buffered_stdout {
                o.clear_and_free();
            }
        }

        // Has this already been finalized?
        if !self.this_jsvalue.is_empty() {
            // Cannot be safely called multiple times.
            self.root_io.deref();
            ShellExecEnv::deinit_impl::<false, false>(&mut self.root_shell as *mut _);
        }

        self.this_jsvalue = JSValue::ZERO;
        // Mark that runtime resources have been cleaned up
        self.cleanup_state = CleanupState::RuntimeCleaned;
    }

    fn deinit_from_finalizer(this: *mut ThisInterpreter) {
        // SAFETY: called from finalize() with valid heap ptr
        let me = unsafe { &mut *this };
        log!(
            "Interpreter(0x{:x}) deinitFromFinalizer (cleanup_state={})",
            this as usize,
            <&'static str>::from(me.cleanup_state)
        );

        match me.cleanup_state {
            CleanupState::NeedsFullCleanup => {
                // The interpreter never finished normally (e.g., early error or never started),
                // so we need to clean up IO and shell env here
                me.root_io.deref();
                ShellExecEnv::deinit_impl::<false, true>(&mut me.root_shell as *mut _);
            }
            CleanupState::RuntimeCleaned => {
                // finish() already cleaned up IO and shell env via deref_root_shell_and_io_if_needed,
                // nothing more to do for those resources
            }
        }

        me.keep_alive.disable();
        // me.args is Box<ShellArgs> — dropped by Box::from_raw below
        for str in me.vm_args_utf8.iter() {
            str.deinit();
        }
        // vm_args_utf8 dropped by Box::from_raw below
        // SAFETY: this was Box-allocated in init_impl
        unsafe { drop(Box::from_raw(this)) };
    }

    fn deinit_from_exec(this: *mut ThisInterpreter) {
        log!("deinit interpreter");
        // SAFETY: caller has exclusive ownership
        let me = unsafe { &mut *this };

        me.this_jsvalue = JSValue::ZERO;
        me.root_io.deref();
        ShellExecEnv::deinit_impl::<false, true>(&mut me.root_shell as *mut _);

        for str in me.vm_args_utf8.iter() {
            str.deinit();
        }
        // SAFETY: this was Box-allocated in init_impl
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_quiet(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        log!("Interpreter(0x{:x}) setQuiet()", this as *const _ as usize);
        this.flags.set_quiet(true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_cwd(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let value = callframe.argument(0);
        let str = bun_str::String::from_js(value, global_this)?;

        let slice = str.to_utf8();
        match this.root_shell.change_cwd(this, slice.slice()) {
            bun_sys::Result::Err(e) => {
                return Err(global_this.throw_value(e.to_js(global_this)));
            }
            bun_sys::Result::Ok(()) => {}
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_env(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let value1 = callframe.argument(0);
        if !value1.is_object() {
            return Err(global_this.throw_invalid_arguments("env must be an object"));
        }

        let mut object_iter = jsc::JSPropertyIterator::init(
            global_this,
            value1,
            jsc::JSPropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
            },
        );

        this.root_shell.export_env.clear_retaining_capacity();
        this.root_shell
            .export_env
            .ensure_total_capacity(object_iter.len());

        // If the env object does not include a $PATH, it must disable path lookup for argv[0]
        // PATH = "";

        while let Some(key) = object_iter.next() {
            let value = object_iter.value();
            if value.is_undefined() {
                continue;
            }
            let keyslice = key.to_owned_slice();

            let value_str = value.get_zig_string(global_this);
            let slice = value_str.to_owned_slice();
            let keyref = EnvStr::init_ref_counted(keyslice);
            let valueref = EnvStr::init_ref_counted(slice);

            this.root_shell.export_env.insert(keyref.clone(), valueref.clone());
            keyref.deref();
            valueref.deref();
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn is_running(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(this.has_pending_activity()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_started(
        this: &mut Self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::from(this.started.load(Ordering::SeqCst)))
    }

    pub fn get_buffered_stdout(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: buffered_stdout returns valid ptr
        Self::io_to_js_value(global_this, unsafe { &mut *self.root_shell.buffered_stdout() })
    }

    pub fn get_buffered_stderr(&mut self, global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: buffered_stderr returns valid ptr
        Self::io_to_js_value(global_this, unsafe { &mut *self.root_shell.buffered_stderr() })
    }

    pub fn finalize(this: *mut Self) {
        log!("Interpreter(0x{:x}) finalize", this as usize);
        Self::deinit_from_finalizer(this);
    }

    #[bun_jsc::host_call]
    pub extern fn has_pending_activity(this: *mut Self) -> bool {
        // SAFETY: called from GC thread; only reads atomic
        unsafe { (*this).has_pending_activity.load(Ordering::SeqCst) > 0 }
    }

    pub fn root_io(&self) -> &IO {
        &self.root_io
    }

    pub fn get_vm_args_utf8(&mut self, argv: &[*const bun_str::WTFStringImplStruct], idx: u8) -> &[u8] {
        if self.vm_args_utf8.len() != argv.len() {
            self.vm_args_utf8.reserve(argv.len().saturating_sub(self.vm_args_utf8.len()));
            for arg in argv {
                // SAFETY: arg points to a valid WTFStringImpl
                self.vm_args_utf8.push(unsafe { (**arg).to_utf8() });
            }
        }
        self.vm_args_utf8[idx as usize].slice()
    }
}

fn incr_pending_activity_flag(has_pending_activity: &AtomicU32) {
    has_pending_activity.fetch_add(1, Ordering::SeqCst);
    log!(
        "Interpreter incr pending activity {}",
        has_pending_activity.load(Ordering::SeqCst)
    );
}

fn decr_pending_activity_flag(has_pending_activity: &AtomicU32) {
    has_pending_activity.fetch_sub(1, Ordering::SeqCst);
    log!(
        "Interpreter decr pending activity {}",
        has_pending_activity.load(Ordering::SeqCst)
    );
}

pub struct ExpansionOpts {
    pub for_spawn: bool,
    pub single: bool,
}

impl Default for ExpansionOpts {
    fn default() -> Self {
        // Zig: `for_spawn: bool = true`
        Self { for_spawn: true, single: false }
    }
}

impl ExpansionOpts {
    pub const DEFAULT: Self = Self { for_spawn: true, single: false };
}

pub use crate::builtin::Builtin;

/// TODO: Investigate whether or not this can be removed now that we have
/// removed recursion
pub use crate::io_reader::AsyncDeinitReader;

pub use crate::io::{self, IO};
pub use crate::io_reader::{self as IOReaderMod, IOReader};
pub use crate::io_reader::ChildPtr as IOReaderChildPtr;
pub use crate::io_writer::{self as IOWriterMod, IOWriter};

pub use crate::io_writer::AsyncDeinitWriter;

// TODO(port): move to <area>_sys
unsafe extern "C" {
    #[bun_jsc::host_call]
    fn Bun__createShellInterpreter(
        global_this: *const JSGlobalObject,
        ptr: *mut Interpreter,
        parsed_shell_script: JSValue,
        resolve: JSValue,
        reject: JSValue,
    ) -> JSValue;
}

// ────────────────────────────────────────────────────────────────────────────
// StatePtrUnion
// ────────────────────────────────────────────────────────────────────────────

/// Construct a tagged union of the state nodes provided in `Types`.
/// The returned type has functions to call state node functions on the underlying type.
///
/// A state node must implement the following functions:
/// - `.start()`
/// - `.deinit()`
/// - `.child_done()`
///
/// In addition, a state node struct must declare a `pub type ChildPtr = StatePtrUnion<...>` variable.
/// This `ChildPtr` variable declares all the possible state nodes that can be a *child* of the state node.
#[repr(transparent)]
pub struct StatePtrUnion<Types> {
    pub ptr: TaggedPtrUnion<Types>,
}

/// Trait that every state-node type in a `StatePtrUnion` must implement.
/// Replaces Zig's `@hasDecl(Ty, "ChildPtr")` + structural duck-typing.
pub trait StateNode {
    type ChildPtr;
    fn start(&mut self) -> Yield;
    fn deinit(&mut self);
    fn child_done(&mut self, child: Self::ChildPtr, exit_code: ExitCode) -> Yield;
    #[cfg(feature = "alloc_scopes")]
    fn scoped_allocator(&mut self) -> *mut bun_alloc::AllocationScope;
    fn allocator(&mut self) -> &dyn Allocator;
}

impl<Types> StatePtrUnion<Types> {
    // TODO(port): Zig used `inline for` over `std.meta.fields(Ptr.Tag)` to dispatch
    // by tag. In Rust this is a per-tuple impl generated by the `TaggedPtrUnion`
    // machinery (or a small derive). The methods below describe the contract;
    // Phase B will wire the actual per-variant dispatch via a `state_ptr_union!`
    // macro or trait-object table. Leaving the bodies as tag-dispatch stubs.

    #[cfg(feature = "alloc_scopes")]
    pub fn scoped_allocator(self) -> *mut bun_alloc::AllocationScope {
        // TODO(port): tag-dispatch over Types — for Interpreter return &mut casted.__alloc_scope,
        // else casted.base.__alloc_scope.scoped_allocator()
        self.ptr.dispatch(|casted| casted.scoped_allocator())
    }

    pub fn allocator(self) -> &'static dyn Allocator {
        // TODO(port): tag-dispatch over Types — for Interpreter return alloc-scope or default,
        // else casted.base.allocator()
        #[cfg(feature = "alloc_scopes")]
        {
            // dispatch via tag
        }
        bun_alloc::default_allocator()
    }

    pub fn create<Ty>(self) -> *mut Ty {
        #[cfg(feature = "alloc_scopes")]
        {
            // TODO(port): self.allocator().create::<Ty>()
        }
        Box::into_raw(Box::<Ty>::new_uninit()) as *mut Ty
        // PERF(port): was alloc-scope create — profile in Phase B
    }

    pub fn destroy<Ty>(self, ptr: *mut Ty) {
        #[cfg(feature = "alloc_scopes")]
        {
            // TODO(port): self.allocator().destroy(ptr)
        }
        // SAFETY: ptr was Box-allocated via create()
        unsafe { drop(Box::from_raw(ptr)) };
    }

    /// Starts the state node.
    pub fn start(self) -> Yield {
        // TODO(port): tag-dispatch over Types calling casted.start()
        self.ptr
            .dispatch_mut(|casted: &mut dyn StateNodeDyn| casted.start())
    }

    /// Deinitializes the state node
    pub fn deinit(self) {
        // TODO(port): tag-dispatch over Types calling casted.deinit()
        self.ptr
            .dispatch_mut(|casted: &mut dyn StateNodeDyn| casted.deinit());
    }

    /// Signals to the state node that one of its children completed with the
    /// given exit code
    pub fn child_done<C>(self, child: C, exit_code: ExitCode) -> Yield {
        // TODO(port): tag-dispatch — for each Ty, construct Ty::ChildPtr::init(child)
        // then call casted.child_done(child_ptr, exit_code).
        // Zig's `getChildPtrType` special-cased Interpreter → InterpreterChildPtr.
        let _ = child;
        let _ = exit_code;
        unreachable!("Phase B: implement tag dispatch for child_done")
    }

    #[cold]
    pub fn unknown_tag(tag: u16) -> ! {
        Output::panic(format_args!("Unknown tag for shell state node: {}\n", tag));
    }

    pub fn tag_int(self) -> u16 {
        self.ptr.tag() as u16
    }

    pub fn tag_name(self) -> &'static [u8] {
        self.ptr.type_name_from_tag(self.tag_int()).unwrap()
    }

    pub fn init<T>(ptr: *mut T) -> Self {
        // Zig: @typeInfo check that _ptr is a pointer + Ptr.assert_type
        // In Rust the generic bound on TaggedPtrUnion::init enforces membership.
        Self {
            ptr: TaggedPtrUnion::init(ptr),
        }
    }

    #[inline]
    pub fn as_<T>(self) -> *mut T {
        self.ptr.as_::<T>()
    }
}

// TODO(port): dyn-compatible subset of StateNode for dispatch closures above.
trait StateNodeDyn {
    fn start(&mut self) -> Yield;
    fn deinit(&mut self);
}

// ────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ────────────────────────────────────────────────────────────────────────────

// Zig `MaybeChild` is comptime type reflection. Unused in Rust — pointer/slice
// element types are written directly. Kept as a marker trait for Phase B audit.
// TODO(port): comptime type reflection — likely deletable.
pub trait MaybeChild {
    type Child;
}

pub fn closefd(fd: Fd) {
    if let Some(err) = fd.close_allowing_bad_file_descriptor(None) {
        log!("ERR closefd: {}\n", err);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// CmdEnvIter
// ────────────────────────────────────────────────────────────────────────────

pub struct CmdEnvIter<'a> {
    env: &'a bun_collections::StringArrayHashMap<Box<ZStr>>,
    iter: bun_collections::string_array_hash_map::Iter<'a, Box<ZStr>>,
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
    pub fn from_env(env: &'a bun_collections::StringArrayHashMap<Box<ZStr>>) -> CmdEnvIter<'a> {
        let iter = env.iterator();
        CmdEnvIter { env, iter }
    }

    pub fn len(&self) -> usize {
        self.env.entries_len()
    }

    pub fn next(&mut self) -> Result<Option<CmdEnvEntry<'a>>, bun_core::Error> {
        let Some(entry) = self.iter.next() else {
            return Ok(None);
        };
        Ok(Some(CmdEnvEntry {
            key: CmdEnvKey { val: entry.key() },
            value: CmdEnvValue { val: entry.value() },
        }))
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ShellTask
// ────────────────────────────────────────────────────────────────────────────

/// A concurrent task, the idea is that this task is not heap allocated because
/// it will be in a field of one of the Shell state structs which will be heap
/// allocated.
///
/// `Ctx` must embed `ShellTask<Ctx>` as a field named `task` so that
/// `@fieldParentPtr("task", ...)` (here `container_of!`) recovers the parent.
pub struct ShellTask<Ctx: ShellTaskCtx> {
    pub task: WorkPoolTask,
    pub event_loop: EventLoopHandle,
    // This is a poll because we want it to enter the uSockets loop
    pub ref_: bun_aio::KeepAlive,
    pub concurrent_task: jsc::EventLoopTask,
    _ctx: core::marker::PhantomData<Ctx>,
}

/// Replaces Zig's comptime fn params `runFromThreadPool_` / `runFromMainThread_`
/// and `comptime debug: bun.Output.LogFunction`.
pub trait ShellTaskCtx: Sized {
    /// Offset of the `task: ShellTask<Self>` field within `Self`, for container_of.
    const TASK_FIELD_OFFSET: usize;
    /// Function to be called when the thread pool starts the task, this could
    /// be on anyone of the thread pool threads so be mindful of concurrency
    /// nuances
    fn run_from_thread_pool(this: &mut Self);
    /// Function that is called on the main thread, once the event loop
    /// processes that the task is done
    fn run_from_main_thread(this: &mut Self);
    fn debug(args: core::fmt::Arguments<'_>);
}

impl<Ctx: ShellTaskCtx> ShellTask<Ctx> {
    pub fn schedule(&mut self) {
        Ctx::debug(format_args!("schedule"));

        self.ref_.ref_(self.event_loop);
        WorkPool::schedule(&mut self.task);
    }

    pub fn on_finish(&mut self) {
        Ctx::debug(format_args!("onFinish"));
        match self.event_loop {
            EventLoopHandle::Js(js) => {
                // SAFETY: self is the `task` field of Ctx; recover parent via offset
                let ctx: *mut Ctx = unsafe {
                    (self as *mut Self as *mut u8)
                        .sub(Ctx::TASK_FIELD_OFFSET)
                        .cast::<Ctx>()
                };
                js.enqueue_task_concurrent(
                    self.concurrent_task.js().from(ctx, jsc::TaskDeinit::Manual),
                );
            }
            EventLoopHandle::Mini(mini) => {
                let ctx = self as *mut Self;
                mini.enqueue_task_concurrent(
                    self.concurrent_task
                        .mini()
                        .from(ctx, "runFromMainThreadMini"),
                );
            }
        }
    }

    pub extern "C" fn run_from_thread_pool(task: *mut WorkPoolTask) {
        Ctx::debug(format_args!("runFromThreadPool"));
        // SAFETY: task points to ShellTask.task field
        let this: *mut Self = unsafe {
            (task as *mut u8)
                .sub(offset_of!(Self, task))
                .cast::<Self>()
        };
        // SAFETY: this is the `task` field of Ctx
        let ctx: *mut Ctx = unsafe {
            (this as *mut u8)
                .sub(Ctx::TASK_FIELD_OFFSET)
                .cast::<Ctx>()
        };
        // SAFETY: ctx/this recovered via container_of from the embedded `task` field;
        // the parent Ctx allocation is valid for the lifetime of the work-pool task.
        unsafe {
            Ctx::run_from_thread_pool(&mut *ctx);
            (*this).on_finish();
        }
    }

    pub fn run_from_main_thread(&mut self) {
        Ctx::debug(format_args!("runFromJS"));
        // SAFETY: self is the `task` field of Ctx
        let ctx: *mut Ctx = unsafe {
            (self as *mut Self as *mut u8)
                .sub(Ctx::TASK_FIELD_OFFSET)
                .cast::<Ctx>()
        };
        self.ref_.unref(self.event_loop);
        // SAFETY: ctx recovered via container_of from the embedded `task` field; valid
        // for the task's lifetime (main-thread invocation owns exclusive access).
        unsafe { Ctx::run_from_main_thread(&mut *ctx) };
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut ()) {
        self.run_from_main_thread();
    }
}

#[inline]
fn errnocast<T: TryInto<u16>>(errno: T) -> u16
where
    T::Error: core::fmt::Debug,
{
    errno.try_into().unwrap()
}

/// 'js' event loop will always return JSError
/// 'mini' event loop will always return noreturn and exit 1
pub fn throw_shell_err(e: &shell::ShellErr, event_loop: EventLoopHandle) -> JsResult<!> {
    match event_loop {
        EventLoopHandle::Mini(_) => e.throw_mini(),
        EventLoopHandle::Js(js) => e.throw_js(js.global()),
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReadChunkAction {
    StopListening,
    Cont,
}

pub use crate::io_writer::ChildPtr as IOWriterChildPtr;

// ────────────────────────────────────────────────────────────────────────────
// ShellSyscall
// ────────────────────────────────────────────────────────────────────────────

/// Shell modifications for syscalls, mostly to make windows work:
/// - Any function that returns a file descriptor will return a uv file descriptor
/// - Sometimes windows doesn't have `*at()` functions like `rmdirat` so we have to join the directory path with the target path
/// - Converts Posix absolute paths to Windows absolute paths on Windows
pub mod ShellSyscall {
    use super::*;

    pub use Syscall::unlinkat_with_flags;
    pub use Syscall::rmdirat;

    /// `dirfd` is either a `bun.FD` or a path slice (`&[u8]`).
    /// TODO(port): Zig used `anytype` to branch on `@TypeOf(dirfd) == bun.FD`.
    /// We model this with an enum; Phase B may split into two fns.
    pub enum DirOrPath<'a> {
        Fd(Fd),
        Path(&'a [u8]),
    }

    #[cfg(windows)]
    pub fn get_path<'b>(
        dirfd: DirOrPath<'_>,
        to: &ZStr,
        buf: &'b mut PathBuffer,
    ) -> bun_sys::Result<&'b ZStr> {
        if to.as_bytes() == b"/dev/null" {
            return bun_sys::Result::Ok(shell::WINDOWS_DEV_NULL);
        }
        if ResolvePath::Platform::Posix.is_absolute(to.as_bytes()) {
            let dirpath: &[u8] = 'brk: {
                match dirfd {
                    DirOrPath::Fd(fd) => match Syscall::get_fd_path(fd, buf) {
                        bun_sys::Result::Ok(path) => break 'brk path,
                        bun_sys::Result::Err(e) => return bun_sys::Result::Err(e.with_fd(fd)),
                    },
                    DirOrPath::Path(p) => break 'brk p,
                }
            };
            let source_root = ResolvePath::windows_filesystem_root(dirpath);
            buf[..source_root.len()].copy_from_slice(source_root);
            buf[source_root.len()..][..to.len() - 1].copy_from_slice(&to.as_bytes()[1..]);
            buf[source_root.len() + to.len() - 1] = 0;
            // SAFETY: NUL written above
            return bun_sys::Result::Ok(unsafe {
                ZStr::from_raw(buf.as_ptr(), source_root.len() + to.len() - 1)
            });
        }
        if ResolvePath::Platform::Windows.is_absolute(to.as_bytes()) {
            return bun_sys::Result::Ok(to);
        }

        let dirpath: &[u8] = 'brk: {
            match dirfd {
                DirOrPath::Fd(fd) => match Syscall::get_fd_path(fd, buf) {
                    bun_sys::Result::Ok(path) => break 'brk path,
                    bun_sys::Result::Err(e) => return bun_sys::Result::Err(e.with_fd(fd)),
                },
                DirOrPath::Path(p) => {
                    buf[..p.len()].copy_from_slice(p);
                    break 'brk &buf[..p.len()];
                }
            }
        };

        let parts: &[&[u8]] = &[dirpath, to.as_bytes()];
        let joined = ResolvePath::join_z_buf(buf, parts, ResolvePath::Platform::auto());
        bun_sys::Result::Ok(joined)
    }

    #[cfg(not(windows))]
    pub fn get_path<'b>(
        _dirfd: DirOrPath<'_>,
        _to: &ZStr,
        _buf: &'b mut PathBuffer,
    ) -> bun_sys::Result<&'b ZStr> {
        unreachable!("Don't use this on POSIX");
    }

    pub fn statat(dir: Fd, path_: &ZStr) -> bun_sys::Result<Stat> {
        #[cfg(windows)]
        {
            let mut buf = bun_paths::path_buffer_pool().get();
            let path = match get_path(DirOrPath::Fd(dir), path_, &mut *buf) {
                bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
                bun_sys::Result::Ok(p) => p,
            };

            return match Syscall::stat(path) {
                bun_sys::Result::Err(e) => bun_sys::Result::Err(e.with_path(path_)),
                bun_sys::Result::Ok(s) => bun_sys::Result::Ok(s),
            };
        }

        #[cfg(not(windows))]
        Syscall::fstatat(dir, path_)
    }

    /// Same thing as bun.sys.openat on posix
    /// On windows it will convert paths for us
    pub fn openat(dir: Fd, path: &ZStr, flags: i32, perm: Mode) -> bun_sys::Result<Fd> {
        #[cfg(windows)]
        {
            if flags & bun_sys::O::DIRECTORY != 0 {
                if ResolvePath::Platform::Posix.is_absolute(path.as_bytes()) {
                    let mut buf = bun_paths::path_buffer_pool().get();
                    let p = match get_path(DirOrPath::Fd(dir), path, &mut *buf) {
                        bun_sys::Result::Ok(p) => p,
                        bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
                    };
                    return match Syscall::open_dir_at_windows_a(
                        dir,
                        p,
                        Syscall::OpenDirOptions {
                            iterable: true,
                            no_follow: flags & bun_sys::O::NOFOLLOW != 0,
                        },
                    ) {
                        bun_sys::Result::Ok(fd) => {
                            fd.make_libuv_owned_for_syscall(Syscall::Tag::Open, Syscall::OnFail::Close)
                        }
                        bun_sys::Result::Err(e) => bun_sys::Result::Err(e.with_path(path)),
                    };
                }
                return match Syscall::open_dir_at_windows_a(
                    dir,
                    path,
                    Syscall::OpenDirOptions {
                        iterable: true,
                        no_follow: flags & bun_sys::O::NOFOLLOW != 0,
                    },
                ) {
                    bun_sys::Result::Ok(fd) => {
                        fd.make_libuv_owned_for_syscall(Syscall::Tag::Open, Syscall::OnFail::Close)
                    }
                    bun_sys::Result::Err(e) => bun_sys::Result::Err(e.with_path(path)),
                };
            }

            let mut buf = bun_paths::path_buffer_pool().get();
            let p = match get_path(DirOrPath::Fd(dir), path, &mut *buf) {
                bun_sys::Result::Ok(p) => p,
                bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
            };
            return bun_sys::open(p, flags, perm);
        }

        #[cfg(not(windows))]
        {
            let fd = match Syscall::openat(dir, path, flags, perm) {
                bun_sys::Result::Ok(fd) => fd,
                bun_sys::Result::Err(e) => return bun_sys::Result::Err(e.with_path(path)),
            };
            // Unreachable Windows branch elided (Zig had dead `if (isWindows)` after posix path)
            bun_sys::Result::Ok(fd)
        }
    }

    pub fn open(file_path: &ZStr, flags: Mode, perm: Mode) -> bun_sys::Result<Fd> {
        let fd = match Syscall::open(file_path, flags, perm) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
        };
        #[cfg(windows)]
        {
            return fd.make_libuv_owned_for_syscall(Syscall::Tag::Open, Syscall::OnFail::Close);
        }
        #[cfg(not(windows))]
        bun_sys::Result::Ok(fd)
    }

    pub fn dup(fd: Fd) -> bun_sys::Result<Fd> {
        #[cfg(windows)]
        {
            return match Syscall::dup(fd) {
                bun_sys::Result::Ok(duped_fd) => {
                    duped_fd.make_libuv_owned_for_syscall(Syscall::Tag::Dup, Syscall::OnFail::Close)
                }
                bun_sys::Result::Err(e) => bun_sys::Result::Err(e),
            };
        }
        #[cfg(not(windows))]
        Syscall::dup(fd)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// OutputTask
// ────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OutputTaskState {
    WaitingWriteErr,
    WaitingWriteOut,
    Done,
}

/// Replaces Zig's `comptime vtable: struct { ... }` param.
pub trait OutputTaskVTable: Sized {
    fn write_err(parent: &mut Self, childptr: *mut OutputTask<Self>, buf: &[u8]) -> Option<Yield>;
    fn on_write_err(parent: &mut Self);
    fn write_out(
        parent: &mut Self,
        childptr: *mut OutputTask<Self>,
        out: &mut OutputSrc,
    ) -> Option<Yield>;
    fn on_write_out(parent: &mut Self);
    fn on_done(parent: &mut Self) -> Yield;
}

/// A task that can write to stdout and/or stderr
pub struct OutputTask<Parent: OutputTaskVTable> {
    // BACKREF per LIFETIMES.tsv
    pub parent: *mut Parent,
    pub output: OutputSrc,
    pub state: OutputTaskState,
}

impl<Parent: OutputTaskVTable> OutputTask<Parent> {
    pub fn deinit(this: *mut Self) -> Yield {
        // SAFETY: caller owns this; bun.destroy(this) at end
        let me = unsafe { &mut *this };
        if cfg!(debug_assertions) {
            debug_assert!(me.state == OutputTaskState::Done);
        }
        log!(
            "OutputTask({}, 0x{:x}) deinit",
            core::any::type_name::<Parent>(),
            this as usize
        );
        let parent = me.parent;
        // output.deinit() handled by Drop on Box::from_raw
        // SAFETY: this was bun.new'd (Box-allocated)
        unsafe { drop(Box::from_raw(this)) };
        // SAFETY: parent outlives this task
        Parent::on_done(unsafe { &mut *parent })
    }

    pub fn start(this: *mut Self, errbuf: Option<&[u8]>) -> Yield {
        // SAFETY: caller passes valid heap ptr
        let me = unsafe { &mut *this };
        log!(
            "OutputTask({}, 0x{:x}) start errbuf={}",
            core::any::type_name::<Parent>(),
            this as usize,
            match errbuf {
                Some(err) => bstr::BStr::new(&err[..err.len().min(128)]),
                None => bstr::BStr::new(b"null"),
            }
        );
        me.state = OutputTaskState::WaitingWriteErr;
        // SAFETY: parent backref valid for task lifetime
        let parent = unsafe { &mut *me.parent };
        if let Some(err) = errbuf {
            if let Some(yield_) = Parent::write_err(parent, this, err) {
                return yield_;
            }
            return Self::next(this);
        }
        me.state = OutputTaskState::WaitingWriteOut;
        if let Some(yield_) = Parent::write_out(parent, this, &mut me.output) {
            return yield_;
        }
        Parent::on_write_out(parent);
        me.state = OutputTaskState::Done;
        Self::deinit(this)
    }

    pub fn next(this: *mut Self) -> Yield {
        // SAFETY: caller passes valid heap ptr
        let me = unsafe { &mut *this };
        // SAFETY: parent backref valid for task lifetime
        let parent = unsafe { &mut *me.parent };
        match me.state {
            OutputTaskState::WaitingWriteErr => {
                Parent::on_write_err(parent);
                me.state = OutputTaskState::WaitingWriteOut;
                if let Some(yield_) = Parent::write_out(parent, this, &mut me.output) {
                    return yield_;
                }
                Parent::on_write_out(parent);
                me.state = OutputTaskState::Done;
                Self::deinit(this)
            }
            OutputTaskState::WaitingWriteOut => {
                Parent::on_write_out(parent);
                me.state = OutputTaskState::Done;
                Self::deinit(this)
            }
            OutputTaskState::Done => panic!("Invalid state"),
        }
    }

    pub fn on_io_writer_chunk(this: *mut Self, _: usize, err: Option<jsc::SystemError>) -> Yield {
        log!(
            "OutputTask({}, 0x{:x}) onIOWriterChunk",
            core::any::type_name::<Parent>(),
            this as usize
        );
        if let Some(e) = err {
            e.deref();
        }

        // SAFETY: caller passes valid heap ptr
        let me = unsafe { &mut *this };
        // SAFETY: parent backref valid for task lifetime
        let parent = unsafe { &mut *me.parent };
        match me.state {
            OutputTaskState::WaitingWriteErr => {
                Parent::on_write_err(parent);
                me.state = OutputTaskState::WaitingWriteOut;
                if let Some(yield_) = Parent::write_out(parent, this, &mut me.output) {
                    return yield_;
                }
                Parent::on_write_out(parent);
                me.state = OutputTaskState::Done;
                Self::deinit(this)
            }
            OutputTaskState::WaitingWriteOut => {
                Parent::on_write_out(parent);
                me.state = OutputTaskState::Done;
                Self::deinit(this)
            }
            OutputTaskState::Done => panic!("Invalid state"),
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// OutputSrc
// ────────────────────────────────────────────────────────────────────────────

/// All owned memory is assumed to be allocated with `bun.default_allocator`
pub enum OutputSrc {
    Arrlist(Vec<u8>),
    OwnedBuf(Box<[u8]>),
    BorrowedBuf(&'static [u8]),
    // TODO(port): borrowed_buf was `[]const u8` with no lifetime in Zig; using
    // 'static here as placeholder. Phase B: thread proper lifetime or raw slice.
}

impl OutputSrc {
    pub fn slice(&self) -> &[u8] {
        match self {
            OutputSrc::Arrlist(v) => &v[..],
            OutputSrc::OwnedBuf(b) => b,
            OutputSrc::BorrowedBuf(b) => b,
        }
    }
}

impl Drop for OutputSrc {
    fn drop(&mut self) {
        // Arrlist/OwnedBuf free via their own Drop; BorrowedBuf no-op.
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Flag parsing
// ────────────────────────────────────────────────────────────────────────────

/// Custom parse error for invalid options
pub enum ParseError {
    // TODO(port): lifetime — Zig callers pass runtime slices from parseShort/parseLong,
    // not literals. Using raw `*const [u8]` in Phase A; Phase B should bound to the
    // argv lifetime or own the slice.
    IllegalOption(*const [u8]),
    Unsupported(*const [u8]),
    ShowUsage,
}

// Zig: `pub fn unsupportedFlag(comptime name: []const u8) []const u8` — comptime
// string concat. Rust expresses this as a macro over a literal (concat!); a
// `const fn` cannot accept a non-const &str and yield &'static str.
#[macro_export]
macro_rules! unsupported_flag {
    ($name:literal) => {
        concat!("unsupported option, please open a GitHub issue -- ", $name, "\n")
    };
}

pub enum ParseFlagResult {
    ContinueParsing,
    Done,
    // TODO(port): lifetime — see ParseError note above.
    IllegalOption(*const [u8]),
    Unsupported(*const [u8]),
    ShowUsage,
}

/// Replaces Zig's `comptime Opts: type` — caller's options struct must impl this.
pub trait FlagOpts {
    fn parse_long(&mut self, flag: &[u8]) -> Option<ParseFlagResult>;
    fn parse_short(&mut self, char: u8, small_flags: &[u8], i: usize) -> Option<ParseFlagResult>;
}

pub struct FlagParser<Opts: FlagOpts>(core::marker::PhantomData<Opts>);

impl<Opts: FlagOpts> FlagParser<Opts> {
    pub fn parse_flags<'a>(
        opts: &mut Opts,
        args: &'a [*const c_char],
    ) -> bun_core::result::Result<Option<&'a [*const c_char]>, ParseError> {
        let mut idx: usize = 0;
        if args.is_empty() {
            return bun_core::result::Result::Ok(None);
        }

        while idx < args.len() {
            let flag = args[idx];
            // SAFETY: flag is a valid NUL-terminated C string from argv
            let flag_bytes = unsafe { core::ffi::CStr::from_ptr(flag) }.to_bytes();
            match Self::parse_flag(opts, flag_bytes) {
                ParseFlagResult::Done => {
                    let filepath_args = &args[idx..];
                    return bun_core::result::Result::Ok(Some(filepath_args));
                }
                ParseFlagResult::ContinueParsing => {}
                ParseFlagResult::IllegalOption(opt_str) => {
                    return bun_core::result::Result::Err(ParseError::IllegalOption(opt_str))
                }
                ParseFlagResult::Unsupported(unsp) => {
                    return bun_core::result::Result::Err(ParseError::Unsupported(unsp))
                }
                ParseFlagResult::ShowUsage => {
                    return bun_core::result::Result::Err(ParseError::ShowUsage)
                }
            }
            idx += 1;
        }

        bun_core::result::Result::Err(ParseError::ShowUsage)
    }

    pub fn parse_flag(opts: &mut Opts, flag: &[u8]) -> ParseFlagResult {
        if flag.is_empty() {
            return ParseFlagResult::Done;
        }
        if flag[0] != b'-' {
            return ParseFlagResult::Done;
        }

        if flag.len() == 1 {
            return ParseFlagResult::IllegalOption(b"-");
        }

        if flag.len() > 2 && flag[1] == b'-' {
            if let Some(result) = opts.parse_long(flag) {
                return result;
            }
        }

        let small_flags = &flag[1..];
        for (i, &char) in small_flags.iter().enumerate() {
            if let Some(err) = opts.parse_short(char, small_flags, i) {
                return err;
            }
        }

        ParseFlagResult::ContinueParsing
    }
}

// ────────────────────────────────────────────────────────────────────────────
// isPollable / unreachableState
// ────────────────────────────────────────────────────────────────────────────

pub fn is_pollable(fd: Fd, mode: Mode) -> bool {
    #[cfg(any(windows, target_arch = "wasm32"))]
    {
        let _ = (fd, mode);
        false
    }
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        bun_sys::posix::S::isfifo(mode)
            || bun_sys::posix::S::issock(mode)
            || bun_sys::posix::isatty(fd.native())
    }
    // macos DOES allow regular files to be pollable, but we don't want that because
    // our IOWriter code has a separate and better codepath for writing to files.
    #[cfg(target_os = "macos")]
    {
        if bun_sys::posix::S::isreg(mode) {
            false
        } else {
            bun_sys::posix::S::isfifo(mode)
                || bun_sys::posix::S::issock(mode)
                || bun_sys::posix::isatty(fd.native())
        }
    }
}

pub fn is_pollable_from_mode(mode: Mode) -> bool {
    #[cfg(any(windows, target_arch = "wasm32"))]
    {
        let _ = mode;
        false
    }
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    {
        bun_sys::posix::S::isfifo(mode) || bun_sys::posix::S::issock(mode)
    }
    // macos DOES allow regular files to be pollable, but we don't want that because
    // our IOWriter code has a separate and better codepath for writing to files.
    #[cfg(target_os = "macos")]
    {
        if bun_sys::posix::S::isreg(mode) {
            false
        } else {
            bun_sys::posix::S::isfifo(mode) || bun_sys::posix::S::issock(mode)
        }
    }
}

#[cold]
pub fn unreachable_state(context: &[u8], state: &[u8]) -> ! {
    Output::panic(format_args!(
        "Bun shell has reached an unreachable state \"{}\" in the {} context. This indicates a bug, please open a GitHub issue.",
        bstr::BStr::new(state),
        bstr::BStr::new(context)
    ));
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/interpreter.zig (2164 lines)
//   confidence: low
//   todos:      35
//   notes:      Heavy comptime/anytype dispatch (StatePtrUnion, change_cwd, write_failing_error_fmt) stubbed with traits; jsobjs/this_jsvalue need GC rooting (MarkedArgumentBuffer/JsRef) in Phase B; ResolvePath threadlocal join_buf API assumed; ShellExecEnv borrows-from-parent fields kept as raw ptrs.
// ──────────────────────────────────────────────────────────────────────────
