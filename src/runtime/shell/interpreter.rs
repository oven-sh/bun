//! The interpreter for the shell language
//!
//! There are several constraints on the Bun shell language that make this
//! interpreter implementation unique:
//!
//! 1. We try to keep everything in the Bun process as much as possible for
//!    performance reasons and also to leverage Bun's existing IO/FS code
//! 2. We try to use non-blocking IO operations as much as possible so the
//!    shell does not block the main JS thread
//! 3. The Zig original has no coroutines
//!
//! The idea is that this is a tree-walking interpreter — except instead of
//! iteratively walking the AST, we build a tree of state-machine nodes so we
//! can suspend/resume without blocking the main thread, driven in
//! continuation-passing style by `Yield::run`.
//!
//! ## NodeId arena (Rust port)
//!
//! In Zig every state-machine node holds a `*Parent` back-pointer and calls
//! `parent.childDone(this, exit)`. That pattern is borrow-checker hostile in
//! Rust (overlapping `&mut` of parent and child).
//!
//! The Rust port stores all state nodes in a flat `Vec<Node>` owned by the
//! `Interpreter`. Nodes refer to each other (and to their parent) by `NodeId`
//! — a `u32` index. Dispatch is a single hoisted `match` on the parent's tag
//! (`Interpreter::child_done`), which keeps the per-tick hot path inlined the
//! same way Zig's `inline else` did (see PORTING.md §Dispatch hot-path).
//!
//! State methods that previously took `(&mut self)` and reached into
//! `self.parent` now take `(&mut Interpreter, this: NodeId)` and look their
//! own data up via `interp.node_mut(this)` / `interp.nodes[this]`.

use core::fmt;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_collections::ByteList as RawByteList;
pub type ByteList = RawByteList;
use bun_sys::{self, Fd};

pub use crate::shell::env_map::EnvMap;
use crate::shell::io::IO;
use crate::shell::states::assigns::Assigns;
use crate::shell::states::base::Base;
use crate::shell::states::binary::Binary;
pub use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::expansion::Expansion;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::states::r#async::Async;
use crate::shell::states::r#if::If;
use crate::shell::states::script::Script;
use crate::shell::states::stmt::Stmt;
use crate::shell::states::subshell::Subshell;
use crate::shell::yield_::Yield;
use crate::shell::{ast, ShellErr};

bun_core::declare_scope!(SHELL, visible);
bun_core::declare_scope!(CowFd, hidden);

/// `log!("...")` — scoped debug logger for the shell interpreter. Expands to
/// nothing in release; the `SHELL` static is referenced by absolute path so
/// callers don't need it in scope.
#[macro_export]
macro_rules! shell_log {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {{
        #[allow(unused_imports)]
        use $crate::shell::interpreter::SHELL;
        bun_core::scoped_log!(SHELL, $fmt $(, $arg)*);
    }};
}
pub(crate) use shell_log as log;

// ────────────────────────────────────────────────────────────────────────────
// NodeId arena
// ────────────────────────────────────────────────────────────────────────────

/// Index into `Interpreter::nodes`. Replaces every `*Parent` / `*Child`
/// back-pointer in the Zig state-machine tree.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeId(pub u32);

impl NodeId {
    /// Sentinel: "the parent is the Interpreter itself". The root `Script`
    /// node uses this. `Interpreter::child_done` special-cases it.
    pub const INTERPRETER: NodeId = NodeId(u32::MAX);
    /// Sentinel for "no node" (e.g. an `Option<NodeId>` packed as a plain id).
    pub const NONE: NodeId = NodeId(u32::MAX - 1);

    #[inline]
    pub fn idx(self) -> usize {
        self.0 as usize
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if *self == NodeId::INTERPRETER {
            write!(f, "Node(interp)")
        } else {
            write!(f, "Node#{}", self.0)
        }
    }
}

/// One slot in the interpreter's state arena. The Zig version heap-allocated
/// each state struct individually via `parent.create(T)`; in Rust they all
/// live as enum variants in a single `Vec<Node>` so the only outstanding
/// borrow at any time is `&mut Interpreter`.
pub enum Node {
    /// Freed slot, available for reuse by `alloc_node`.
    Free,
    Script(Script),
    Stmt(Stmt),
    Binary(Binary),
    Pipeline(Pipeline),
    Cmd(Cmd),
    Assigns(Assigns),
    Expansion(Expansion),
    If(If),
    CondExpr(CondExpr),
    Async(Async),
    Subshell(Subshell),
}

impl Node {
    pub fn kind(&self) -> StateKind {
        match self {
            Node::Free => StateKind::Free,
            Node::Script(_) => StateKind::Script,
            Node::Stmt(_) => StateKind::Stmt,
            Node::Binary(_) => StateKind::Binary,
            Node::Pipeline(_) => StateKind::Pipeline,
            Node::Cmd(_) => StateKind::Cmd,
            Node::Assigns(_) => StateKind::Assign,
            Node::Expansion(_) => StateKind::Expansion,
            Node::If(_) => StateKind::IfClause,
            Node::CondExpr(_) => StateKind::Condexpr,
            Node::Async(_) => StateKind::Async,
            Node::Subshell(_) => StateKind::Subshell,
        }
    }

    /// Every state struct embeds a `Base` header at a known field; this is the
    /// hoisted accessor (replaces Zig's structural duck-typing on `.base`).
    pub fn base(&self) -> Option<&Base> {
        match self {
            Node::Free => None,
            Node::Script(s) => Some(&s.base),
            Node::Stmt(s) => Some(&s.base),
            Node::Binary(s) => Some(&s.base),
            Node::Pipeline(s) => Some(&s.base),
            Node::Cmd(s) => Some(&s.base),
            Node::Assigns(s) => Some(&s.base),
            Node::Expansion(s) => Some(&s.base),
            Node::If(s) => Some(&s.base),
            Node::CondExpr(s) => Some(&s.base),
            Node::Async(s) => Some(&s.base),
            Node::Subshell(s) => Some(&s.base),
        }
    }

    pub fn base_mut(&mut self) -> Option<&mut Base> {
        match self {
            Node::Free => None,
            Node::Script(s) => Some(&mut s.base),
            Node::Stmt(s) => Some(&mut s.base),
            Node::Binary(s) => Some(&mut s.base),
            Node::Pipeline(s) => Some(&mut s.base),
            Node::Cmd(s) => Some(&mut s.base),
            Node::Assigns(s) => Some(&mut s.base),
            Node::Expansion(s) => Some(&mut s.base),
            Node::If(s) => Some(&mut s.base),
            Node::CondExpr(s) => Some(&mut s.base),
            Node::Async(s) => Some(&mut s.base),
            Node::Subshell(s) => Some(&mut s.base),
        }
    }
}

/// Generate `Interpreter::as_<kind>{,_mut}` typed accessors. These panic on
/// tag mismatch — same contract as Zig's `child.as(Ty).?`.
macro_rules! node_accessors {
    ($($variant:ident => $ty:ty, $get:ident, $get_mut:ident);* $(;)?) => {
        impl Interpreter {
            $(
                #[inline]
                #[track_caller]
                pub fn $get(&self, id: NodeId) -> &$ty {
                    match &self.nodes[id.idx()] {
                        Node::$variant(v) => v,
                        other => panic!(
                            concat!("expected Node::", stringify!($variant), " at {}, got {:?}"),
                            id, other.kind()
                        ),
                    }
                }
                #[inline]
                #[track_caller]
                pub fn $get_mut(&mut self, id: NodeId) -> &mut $ty {
                    match &mut self.nodes[id.idx()] {
                        Node::$variant(v) => v,
                        other => panic!(
                            concat!("expected Node::", stringify!($variant), " at {}, got {:?}"),
                            id, other.kind()
                        ),
                    }
                }
            )*
        }
    };
}

node_accessors! {
    Script    => Script,    as_script,    as_script_mut;
    Stmt      => Stmt,      as_stmt,      as_stmt_mut;
    Binary    => Binary,    as_binary,    as_binary_mut;
    Pipeline  => Pipeline,  as_pipeline,  as_pipeline_mut;
    Cmd       => Cmd,       as_cmd,       as_cmd_mut;
    Assigns   => Assigns,   as_assigns,   as_assigns_mut;
    Expansion => Expansion, as_expansion, as_expansion_mut;
    If        => If,        as_if,        as_if_mut;
    CondExpr  => CondExpr,  as_condexpr,  as_condexpr_mut;
    Async     => Async,     as_async,     as_async_mut;
    Subshell  => Subshell,  as_subshell,  as_subshell_mut;
}

// ────────────────────────────────────────────────────────────────────────────
// Small types
// ────────────────────────────────────────────────────────────────────────────

pub type ExitCode = u16;
pub type Pipe = [Fd; 2];

/// Stand-in for the shell's `SmolList<T, N>` (inline small-vec). The real
/// implementation lives in `shell_body.rs` (gated); state nodes only need
/// `push`/`len`/indexing, which `Vec` provides.
// TODO(b2-blocked): replace with shell_body::SmolList once parser un-gates.
pub type SmolList<T, const N: usize> = Vec<T>;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum StateKind {
    Free,
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

/// Zero-sized witness that an output stream needs IO (see `Builtin::needs_io`).
#[repr(u8)]
#[derive(Clone, Copy)]
pub enum OutputNeedsIOSafeGuard {
    OutputNeedsIo,
}

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum CallstackGuard {
    IKnowWhatIAmDoing,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CoroutineResult {
    Cont,
    Yield,
}

pub const STDIN_NO: usize = 0;
pub const STDOUT_NO: usize = 1;
pub const STDERR_NO: usize = 2;

// ────────────────────────────────────────────────────────────────────────────
// Interpreter
// ────────────────────────────────────────────────────────────────────────────

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
pub struct Interpreter {
    /// Flat arena of state-machine nodes. Indices are `NodeId`s; freed slots
    /// are recycled via `free_list`.
    pub nodes: Vec<Node>,
    free_list: Vec<u32>,

    pub event_loop: EventLoopHandle,

    pub args: Box<ShellArgs>,

    /// JS objects used as input for the shell script (allocated in the AST arena).
    // TODO(port): GC root — bare JSValue heap storage is invisible to the
    // conservative stack scan. Phase B: switch to MarkedArgumentBuffer or root
    // via wrapper visitChildren.
    pub jsobjs: *mut [crate::jsc::JSValue],

    pub root_shell: ShellExecEnv,
    pub root_io: IO,

    pub has_pending_activity: AtomicU32,
    pub started: AtomicBool,
    pub keep_alive: bun_aio::KeepAlive,

    pub async_commands_executing: u32,

    // JSC_BORROW: always borrowed, never owned. Stored raw because the struct
    // is heap-allocated and outlives any single &JSGlobalObject borrow scope.
    pub global_this: *mut crate::jsc::JSGlobalObject,

    pub flags: InterpreterFlags,
    pub exit_code: Option<ExitCode>,
    pub this_jsvalue: crate::jsc::JSValue,
    pub cleanup_state: CleanupState,
    pub estimated_size_for_gc: usize,

    /// Side-channel for `try_()`: lets init/setup paths use `?`-style cleanup
    /// while still surfacing the rich syscall error at the boundary.
    pub last_err: Option<bun_sys::Error>,
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
    NeedsFullCleanup,
    RuntimeCleaned,
}

// ────────────────────────────────────────────────────────────────────────────
// Construction / standalone-exec entrypoints
// ────────────────────────────────────────────────────────────────────────────

impl ShellArgs {
    /// Spec: interpreter.zig `ShellArgs.init` — fresh arena + zeroed AST.
    /// Heap-allocated (returned as `Box`) because the interpreter stores
    /// `Box<ShellArgs>` and state nodes hold `*const ast::*` into the arena;
    /// the box must not move once `parse()` has filled `script_ast`.
    pub fn init() -> Box<ShellArgs> {
        Box::new(ShellArgs {
            __arena: bun_alloc::Arena::new(),
            // Zig: `.script_ast = undefined` — overwritten by `parse()` before
            // `run()`. An empty stmt list is a safe placeholder.
            script_ast: ast::Script { stmts: &[] as *const [ast::Stmt] },
        })
    }

    #[inline]
    pub fn arena(&self) -> &bun_alloc::Arena {
        &self.__arena
    }
}

/// `shell.Result(T)` — Zig's `union(enum) { result: T, err: ShellErr }`.
/// Only used by the construction path (`Interpreter::init`).
pub type ShellResult<T> = Result<T, ShellErr>;

impl ShellErr {
    /// Spec: shell.zig `ShellErr.throwMini` — print to stderr and exit(1).
    /// Used on the `MiniEventLoop` (no-JSC) path where there is no global
    /// object to throw into.
    #[cold]
    pub fn throw_mini(self) -> ! {
        // PORT NOTE: Zig's `ShellErr` is a 4-variant tagged union (sys / custom
        // / invalid_arguments / todo) whose `throwMini` formats each arm. The
        // Rust port currently only carries the `.sys` payload (see `mod.rs`),
        // so this is the `.sys` arm: `bunsh: {message}: {path}`.
        let e = &self.0;
        bun_core::pretty_errorln!(
            "<r><red>error<r>: Failed due to error: <b>bunsh: {}: {}<r>",
            e,
            bstr::BStr::new(&e.path[..]),
        );
        bun_core::Global::exit(1);
    }
}

impl Interpreter {
    /// Spec: interpreter.zig `ThisInterpreter.parse` — lex `src` (ASCII or
    /// Unicode), build a `Parser`, and return the root `ast::Script`. Tokens
    /// and AST nodes are bump-allocated into `arena`.
    ///
    /// On lex error, `out_lex_err` is populated and `ParseError::Lex` returned
    /// so the caller can `combineErrors()` for diagnostics; on parse error
    /// `out_parse_err` is populated likewise.
    // TODO(b2-blocked): bun_shell_parser — `LexerAscii`/`LexerUnicode`/`Parser`
    // live in `shell_body.rs` (gated). Body preserved verbatim below; until
    // un-gated this returns `ParseUnavailable` so the standalone-shell path
    // surfaces a clear error instead of UB-walking an empty AST.
    #[allow(unused_variables)]
    pub fn parse(
        arena: &bun_alloc::Arena,
        src: &[u8],
        jsobjs: &[crate::jsc::JSValue],
        out_lex_err: &mut Option<Box<[u8]>>,
        out_parse_err: &mut Option<Box<[u8]>>,
    ) -> Result<ast::Script, bun_core::Error> {
        
        {
            use crate::shell::shell_body::{LexerAscii, LexerUnicode, ParseError, Parser};
            let jsobjs_len = jsobjs.len() as u32;
            let lex_result = if bun_str::is_all_ascii(src) {
                let mut lexer = LexerAscii::new(arena, src, &[], jsobjs_len);
                lexer.lex()?;
                lexer.get_result()
            } else {
                let mut lexer = LexerUnicode::new(arena, src, &[], jsobjs_len);
                lexer.lex()?;
                lexer.get_result()
            };
            if !lex_result.errors.is_empty() {
                *out_lex_err = Some(lex_result.combine_errors(arena));
                return Err(ParseError::Lex.into());
            }
            let mut parser = Parser::new(arena, lex_result, jsobjs)?;
            match parser.parse() {
                Ok(ast) => Ok(ast),
                Err(e) => {
                    *out_parse_err = Some(parser.combine_errors());
                    Err(e)
                }
            }
        }
        #[cfg(any())]
        Err(bun_core::err!("ParseUnavailable"))
    }

    /// Spec: interpreter.zig `ThisInterpreter.init` + `initImpl`.
    ///
    /// Builds the root `ShellExecEnv` (export env from the event loop's
    /// `DotEnv::Loader`, cwd from `getcwd()`, cwd_fd from `open(O_DIRECTORY)`),
    /// dups stdin into an `IOReader`, and heap-allocates the interpreter.
    /// stdout/stderr stay `.pipe` here — `setup_io_before_run()` (called from
    /// `run()`) upgrades them to real `IOWriter`s unless `quiet` was set.
    ///
    /// On success the returned box owns `shargs`; on error `shargs` is
    /// dropped (Zig: `defer shargs.deinit()` in the caller).
    ///
    /// PORT NOTE: `allocator` parameter dropped (always global mimalloc).
    /// `ctx` is stored for `bun run` argv access from builtins (Zig
    /// `command_ctx`); held as a raw pointer because the interpreter outlives
    /// any single `&mut ContextData` borrow.
    pub fn init(
        ctx: *mut bun_options_types::Context::ContextData,
        event_loop: EventLoopHandle,
        shargs: Box<ShellArgs>,
        jsobjs: *mut [crate::jsc::JSValue],
        export_env_: Option<EnvMap>,
        cwd_: Option<&[u8]>,
        mini_env: Option<&mut bun_dotenv::Loader<'_>>,
    ) -> ShellResult<Box<Interpreter>> {
        // ── export_env ─────────────────────────────────────────────────────
        // Zig: on `.js` event loop, take `export_env_` (or empty); on `.mini`,
        // populate from the loop's `DotEnv::Loader`.
        let export_env = if let Some(e) = export_env_ {
            e
        } else if let Some(env_loader) = mini_env {
            // PORT NOTE: Zig reads `event_loop.env()`. The Rust
            // `EventLoopHandle` shim (opaque usize) can't dereference into the
            // loop yet, so the caller passes the loader explicitly. Same data,
            // different plumbing — drop the extra arg once `EventLoopHandle`
            // becomes the real `bun_event_loop::EventLoopHandle`.
            let mut export_env = EnvMap::init_with_capacity(env_loader.map.map.count());
            let mut iter = env_loader.iterator();
            while let Some(entry) = iter.next() {
                let key = crate::shell::EnvStr::init_slice(&entry.key_ptr[..]);
                let value = crate::shell::EnvStr::init_slice(&entry.value_ptr.value[..]);
                export_env.insert(key, value);
            }
            export_env
        } else {
            EnvMap::init()
        };

        // ── cwd / cwd_fd ───────────────────────────────────────────────────
        // Hoisted PathBuffer so the error's borrowed `.path` stays valid until
        // we've converted it to an owned `ShellErr` (Zig hoists for the same
        // reason).
        let mut pathbuf = bun_paths::PathBuffer::uninit();
        let cwd_len = match bun_sys::getcwd(&mut pathbuf[..]) {
            Ok(n) => n,
            Err(e) => return Err(ShellErr::new_sys(e)),
        };
        // NUL-terminate for `open()` and so `__cwd` matches Zig's `[:0]` shape
        // (downstream `cwd()` strips the trailing 0).
        pathbuf[cwd_len] = 0;
        // SAFETY: getcwd wrote `cwd_len` bytes + we wrote the NUL at [cwd_len].
        let cwd_z = unsafe { bun_core::ZStr::from_raw(pathbuf.as_ptr(), cwd_len) };

        let cwd_fd = match bun_sys::open(cwd_z, bun_sys::O::DIRECTORY | bun_sys::O::RDONLY, 0) {
            Ok(fd) => fd,
            Err(e) => return Err(ShellErr::new_sys(e)),
        };

        let mut cwd_arr = Vec::with_capacity(cwd_len + 1);
        cwd_arr.extend_from_slice(&pathbuf[..cwd_len + 1]);
        debug_assert_eq!(*cwd_arr.last().unwrap(), 0);

        // ── stdin ──────────────────────────────────────────────────────────
        log!("Duping stdin");
        let stdin_fd_res = if bun_core::output::stdio::is_stdin_null() {
            // Zig `bun.sys.openNullDevice()`.
            #[cfg(unix)]
            {
                bun_sys::open(
                    // SAFETY: static C string with NUL.
                    unsafe { bun_core::ZStr::from_raw(b"/dev/null\0".as_ptr(), 9) },
                    bun_sys::O::RDONLY,
                    0,
                )
            }
            #[cfg(windows)]
            {
                bun_sys::open(
                    unsafe { bun_core::ZStr::from_raw(b"NUL\0".as_ptr(), 3) },
                    bun_sys::O::RDONLY,
                    0,
                )
            }
        } else {
            shell_dup(Fd::stdin())
        };
        let stdin_fd = match stdin_fd_res {
            Ok(fd) => fd,
            Err(e) => {
                closefd(cwd_fd);
                return Err(ShellErr::new_sys(e));
            }
        };

        let stdin_reader = IOReader::init(stdin_fd, event_loop);

        // ── assemble ───────────────────────────────────────────────────────
        let mut interpreter = Box::new(Interpreter {
            nodes: Vec::new(),
            free_list: Vec::new(),
            event_loop,
            args: shargs,
            jsobjs,
            root_shell: ShellExecEnv {
                kind: ShellExecEnvKind::Normal,
                _buffered_stdout: Bufio::default(),
                _buffered_stderr: Bufio::default(),
                shell_env: EnvMap::init(),
                cmd_local_env: EnvMap::init(),
                export_env,
                __prev_cwd: cwd_arr.clone(),
                __cwd: cwd_arr,
                cwd_fd,
                async_pids: SmolList::default(),
            },
            root_io: IO {
                stdin: crate::shell::io::InKind::Fd(stdin_reader),
                // By default stdout/stderr should be IOWriters on dup'd
                // stdout/stderr, but if the user later calls `.setQuiet(true)`
                // that work is wasted. So they start as `.pipe` and `run()`
                // upgrades them via `setup_io_before_run()` if `!quiet`.
                stdout: crate::shell::io::OutKind::Pipe,
                stderr: crate::shell::io::OutKind::Pipe,
            },
            has_pending_activity: AtomicU32::new(0),
            started: AtomicBool::new(false),
            keep_alive: bun_aio::KeepAlive::default(),
            async_commands_executing: 0,
            global_this: core::ptr::null_mut(),
            flags: InterpreterFlags::default(),
            exit_code: None,
            this_jsvalue: crate::jsc::JSValue::ZERO,
            cleanup_state: CleanupState::NeedsFullCleanup,
            estimated_size_for_gc: 0,
            last_err: None,
        });
        // PORT NOTE: Zig stores `command_ctx` on the struct; the Rust struct
        // doesn't have that field yet (no builtin reads it). Preserve the
        // pointer for when `which`/argv builtins land.
        let _ = ctx;

        // ── optional cwd override (Zig `init` tail) ────────────────────────
        if let Some(c) = cwd_ {
            // Spec interpreter.zig:921-930: `root_shell.changeCwdImpl(interp,
            // c, true)`; on failure, deref root_io + deinit root_shell + free.
            // The interpreter parameter is unused (`_` in spec) so we don't
            // pass it (avoids the obvious self-borrow).
            if let Err(e) = interpreter.root_shell.change_cwd_impl(c, true) {
                // `interpreter`'s Drop closes `cwd_fd` via deinit_from_exec
                // semantics: explicitly close here before dropping the box so
                // we match Zig's `root_io.deref(); root_shell.deinitImpl(...)`.
                closefd(interpreter.root_shell.cwd_fd);
                return Err(ShellErr::new_sys(e));
            }
        }

        Ok(interpreter)
    }

    /// Spec: interpreter.zig `#deinitFromExec` — full teardown for the
    /// standalone (`MiniEventLoop`) path. Drops root IO refcounts, frees the
    /// root shell env, and consumes the box.
    fn deinit_from_exec(mut self: Box<Self>) {
        log!("deinit interpreter");
        self.this_jsvalue = crate::jsc::JSValue::ZERO;
        // `root_io` holds `Arc<IOReader>`/`Arc<IOWriter>`; replacing with
        // default drops the refs (Zig: `root_io.deref()`).
        self.root_io = IO::default();
        closefd(self.root_shell.cwd_fd);
        // EnvMap / Vec / Bufio drop on box drop (Zig: `deinitImpl(false, true)`).
        // `vm_args_utf8` not yet on the Rust struct.
    }

    /// Spec: interpreter.zig `initAndRunFromSource`.
    ///
    /// Standalone-shell entrypoint for `bun run <script>` / `bun exec` when
    /// `--shell=bun`: parse `src`, construct an interpreter on a
    /// `MiniEventLoop`, drive it to completion via `mini.tick()`, and return
    /// the script's exit code. `path_for_errors` is only used in diagnostics.
    ///
    /// On any init/parse/run error this prints to stderr and `exit(1)`s
    /// directly (matching Zig); the `Result` only carries lexer/parser
    /// errors that escaped without a diagnostic (Zig `return err`).
    pub fn init_and_run_from_source(
        ctx: &mut bun_options_types::Context::ContextData,
        mini: &'static mut bun_event_loop::MiniEventLoop::MiniEventLoop<'static>,
        path_for_errors: &[u8],
        src: &[u8],
        cwd: Option<&[u8]>,
    ) -> Result<ExitCode, bun_core::Error> {
        bun_analytics::features::standalone_shell.fetch_add(1, Ordering::Relaxed);

        let mut shargs = ShellArgs::init();

        // ── parse ──────────────────────────────────────────────────────────
        let mut out_lex_err: Option<Box<[u8]>> = None;
        let mut out_parse_err: Option<Box<[u8]>> = None;
        let script = match Self::parse(
            shargs.arena(),
            src,
            &[],
            &mut out_lex_err,
            &mut out_parse_err,
        ) {
            Ok(s) => s,
            Err(err) => {
                if let Some(lex) = out_lex_err {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(path_for_errors),
                        bstr::BStr::new(&lex[..]),
                    );
                    bun_core::Global::exit(1);
                }
                if let Some(perr) = out_parse_err {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: Failed to run script <b>{}<r> due to error <b>{}<r>",
                        bstr::BStr::new(path_for_errors),
                        bstr::BStr::new(&perr[..]),
                    );
                    bun_core::Global::exit(1);
                }
                return Err(err);
            }
        };
        shargs.script_ast = script;

        // ── init ───────────────────────────────────────────────────────────
        // PORT NOTE: Zig passes `.{ .mini = mini }` as the `EventLoopHandle`.
        // The Rust shell still uses an opaque `usize` shim for the handle (see
        // `EventLoopHandle` below), so we erase the pointer and forward the
        // loader separately. Swap to `bun_event_loop::EventLoopHandle::init_mini`
        // once the shim is replaced.
        let evtloop = EventLoopHandle(mini as *mut _ as usize);
        // SAFETY: `mini.env` was set by `init_global()`; pointer is
        // thread-lifetime singleton.
        let env_loader = mini.env.map(|p| unsafe { &mut *p.as_ptr() });
        let mut interp = match Self::init(
            ctx as *mut _,
            evtloop,
            shargs,
            &mut [] as *mut [crate::jsc::JSValue],
            None,
            cwd,
            env_loader,
        ) {
            Ok(i) => i,
            Err(e) => e.throw_mini(),
        };

        // ── run ────────────────────────────────────────────────────────────
        interp.exit_code = Some(1);
        if let Err(e) = interp.run() {
            // PORT NOTE: `ErrName` not yet impl'd for `bun_sys::Error`; use
            // its `name()` (errno tag) like Zig's `Output.err(e, …)` does.
            let name = e.name();
            interp.deinit_from_exec();
            bun_core::output::err(
                name,
                format_args!("Failed to run script <b>{}<r>", bstr::BStr::new(path_for_errors)),
            );
            bun_core::Global::exit(1);
        }

        // ── tick until done ────────────────────────────────────────────────
        // Zig: `mini.tick(&is_done, IsDone.isDone)` where `isDone` reads
        // `interp.flags.done`. The `is_done` closure captures a raw pointer so
        // borrowck doesn't see an overlap with `tick`'s `&mut self` on `mini`.
        let interp_ptr: *const Interpreter = &*interp;
        mini.tick(core::ptr::null_mut(), |_ctx| {
            // SAFETY: `interp` lives in this stack frame for the whole tick
            // loop; `flags` is plain data (no interior mutation contention on
            // the mini path — all mutation happens inside tasks `tick` drains
            // synchronously).
            unsafe { (*interp_ptr).flags.done() }
        });

        let code = interp.exit_code.expect("exit_code set by finish()");
        interp.deinit_from_exec();
        Ok(code)
    }
}

impl Interpreter {
    // ── arena management ───────────────────────────────────────────────────

    /// Allocate a fresh slot in the node arena and return its id. Replaces
    /// Zig's `parent.create(T)` (which heap-allocated via the parent's
    /// allocator). Reuses freed slots when available.
    pub fn alloc_node(&mut self, node: Node) -> NodeId {
        if let Some(slot) = self.free_list.pop() {
            self.nodes[slot as usize] = node;
            return NodeId(slot);
        }
        let id = NodeId(self.nodes.len() as u32);
        self.nodes.push(node);
        id
    }

    /// Free a slot. Replaces Zig's `parent.destroy(this)`. The node's own
    /// `deinit` (which closes IO, derefs the shell env, etc.) must run first;
    /// this only recycles the storage.
    pub fn free_node(&mut self, id: NodeId) {
        // Guard: callers may have stored `NodeId::NONE` in `currently_executing`
        // when `spawn_expr` failed (Subshell init error path). Spec never
        // touches `currently_executing` on that path, so the later
        // `deinit_node`/`free_node` is a no-op there too.
        if id == NodeId::NONE || id == NodeId::INTERPRETER {
            return;
        }
        debug_assert!(
            !matches!(self.nodes[id.idx()], Node::Free),
            "double-free of {}",
            id
        );
        self.nodes[id.idx()] = Node::Free;
        self.free_list.push(id.0);
    }

    #[inline]
    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id.idx()]
    }

    #[inline]
    pub fn node_mut(&mut self, id: NodeId) -> &mut Node {
        &mut self.nodes[id.idx()]
    }

    /// Look up the `parent` field of any state node. (Replaces
    /// `StatePtrUnion.ptr.is::<T>()` checks.)
    #[inline]
    pub fn parent_of(&self, id: NodeId) -> NodeId {
        self.nodes[id.idx()]
            .base()
            .map(|b| b.parent)
            .unwrap_or(NodeId::INTERPRETER)
    }

    #[inline]
    pub fn kind_of(&self, id: NodeId) -> StateKind {
        if id == NodeId::INTERPRETER {
            // The interpreter is not stored in `nodes`; callers that need to
            // distinguish "parent is the interpreter" check the sentinel id
            // directly. Returning `Free` here would be wrong, so this is its
            // own variant in callers' matches.
            return StateKind::Script; // unused — callers test the sentinel first
        }
        self.nodes[id.idx()].kind()
    }

    /// Shell exec env for the node at `id` (or the root env if `id` is the
    /// interpreter sentinel).
    #[inline]
    pub fn shell_env(&mut self, id: NodeId) -> *mut ShellExecEnv {
        if id == NodeId::INTERPRETER {
            return &mut self.root_shell as *mut _;
        }
        self.nodes[id.idx()]
            .base()
            .map(|b| b.shell)
            .unwrap_or(&mut self.root_shell as *mut _)
    }

    // ── hoisted dispatch (PORTING.md §Dispatch hot-path) ───────────────────

    /// Signal to `parent` that `child` finished with `exit_code`. This is the
    /// single hoisted `match` that replaces every per-state
    /// `parent.childDone(this, exit)` call in Zig.
    ///
    /// PERF(port): was `inline else` switch — direct calls per arm so LLVM
    /// inlines the hot states (Stmt/Pipeline/Cmd) the same way Zig did.
    pub fn child_done(&mut self, parent: NodeId, child: NodeId, exit_code: ExitCode) -> Yield {
        if parent == NodeId::INTERPRETER {
            return self.on_root_child_done(child, exit_code);
        }
        match self.nodes[parent.idx()].kind() {
            StateKind::Script => Script::child_done(self, parent, child, exit_code),
            StateKind::Stmt => Stmt::child_done(self, parent, child, exit_code),
            StateKind::Binary => Binary::child_done(self, parent, child, exit_code),
            StateKind::Pipeline => Pipeline::child_done(self, parent, child, exit_code),
            StateKind::Cmd => Cmd::child_done(self, parent, child, exit_code),
            StateKind::Assign => Assigns::child_done(self, parent, child, exit_code),
            StateKind::Expansion => Expansion::child_done(self, parent, child, exit_code),
            StateKind::IfClause => If::child_done(self, parent, child, exit_code),
            StateKind::Condexpr => CondExpr::child_done(self, parent, child, exit_code),
            StateKind::Async => Async::child_done(self, parent, child, exit_code),
            StateKind::Subshell => Subshell::child_done(self, parent, child, exit_code),
            StateKind::Free => unreachable!("child_done on freed {}", parent),
        }
    }

    /// Advance node `id` by one step. The trampoline (`Yield::run`) calls
    /// this; replaces the per-variant `&mut State` dispatch in Yield.
    pub fn next_node(&mut self, id: NodeId) -> Yield {
        match self.nodes[id.idx()].kind() {
            StateKind::Script => Script::next(self, id),
            StateKind::Stmt => Stmt::next(self, id),
            StateKind::Binary => Binary::next(self, id),
            StateKind::Pipeline => Pipeline::next(self, id),
            StateKind::Cmd => Cmd::next(self, id),
            StateKind::Assign => Assigns::next(self, id),
            StateKind::Expansion => Expansion::next(self, id),
            StateKind::IfClause => If::next(self, id),
            StateKind::Condexpr => CondExpr::next(self, id),
            StateKind::Async => Async::next(self, id),
            StateKind::Subshell => Subshell::next(self, id),
            StateKind::Free => unreachable!("next on freed {}", id),
        }
    }

    /// Start node `id`. Most states return `Yield::<Kind>(id)` immediately;
    /// the trampoline then calls `next_node`.
    pub fn start_node(&mut self, id: NodeId) -> Yield {
        match self.nodes[id.idx()].kind() {
            StateKind::Script => Script::start(self, id),
            StateKind::Stmt => Stmt::start(self, id),
            StateKind::Binary => Binary::start(self, id),
            StateKind::Pipeline => Pipeline::start(self, id),
            StateKind::Cmd => Cmd::start(self, id),
            StateKind::Assign => Assigns::start(self, id),
            StateKind::Expansion => Expansion::start(self, id),
            StateKind::IfClause => If::start(self, id),
            StateKind::Condexpr => CondExpr::start(self, id),
            StateKind::Async => Async::start(self, id),
            StateKind::Subshell => Subshell::start(self, id),
            StateKind::Free => unreachable!("start on freed {}", id),
        }
    }

    /// Init + start a child state node for an `ast::Expr`. Replaces the
    /// per-variant `match` Zig inlines at each callsite (Stmt.zig:64-112,
    /// Binary.zig:64-112). For `.subshell`, dupes the parent shell env first
    /// (Zig `Subshell.initDupeShellState`); all other variants borrow `shell`.
    ///
    /// Note: `Async` must NOT call this — Async.zig restricts its child to
    /// pipeline/cmd/if/condexpr and inits without starting (see `Async::next`).
    pub fn spawn_expr(
        &mut self,
        shell: *mut ShellExecEnv,
        expr: &ast::Expr,
        parent: NodeId,
        io: IO,
    ) -> (Option<NodeId>, Yield) {
        let child = match expr {
            ast::Expr::Cmd(c) => Cmd::init(self, shell, *c, parent, io),
            ast::Expr::Binary(b) => Binary::init(self, shell, *b, parent, io),
            ast::Expr::Pipeline(p) => Pipeline::init(self, shell, *p, parent, io),
            ast::Expr::Assign(a) => {
                Assigns::init(self, shell, *a as *const [ast::Assign], parent, AssignCtx::Shell, io)
            }
            ast::Expr::If(i) => If::init(self, shell, *i, parent, io),
            ast::Expr::CondExpr(c) => CondExpr::init(self, shell, *c, parent, io),
            ast::Expr::Subshell(s) => {
                // Zig `Subshell.initDupeShellState`: Stmt/Binary callers dupe
                // the env here so `Subshell::start`/`next` can use `base.shell`
                // as-is. (Pipeline dupes itself and calls `Subshell::init`
                // directly, so it does NOT go through this path.)
                match Subshell::init_dupe_shell_state(self, shell, *s, parent, io) {
                    Ok(id) => id,
                    Err(e) => {
                        self.throw(&ShellErr::new_sys(e));
                        // Spec: Zig's `Binary.makeChild` returns `null` here and
                        // the caller falls through as if the subshell exited 0
                        // (Binary.zig:55-61, 130-134); Stmt.zig returns `.failed`
                        // without touching `currently_executing`. Return `None`
                        // so callers leave `currently_executing` unset — matches
                        // the Zig fallthrough exactly (no `NodeId::NONE` sentinel
                        // needed in `deinit_node`/`free_node` for this path).
                        return (None, Yield::failed());
                    }
                }
            }
            ast::Expr::Async(e) => Async::init(self, shell, *e, parent, io),
        };
        let y = self.start_node(child);
        (Some(child), y)
    }

    /// Run the per-state cleanup, then recycle the slot. Replaces every
    /// `child.deinit()` + `parent.destroy(child)` pair in Zig.
    pub fn deinit_node(&mut self, id: NodeId) {
        // Guard the `NodeId::NONE` sentinel: `spawn_expr` returns it on
        // Subshell init failure, and Stmt/Binary `currently_executing` may
        // hold it. Indexing `nodes[u32::MAX-1]` would be OOB.
        if id == NodeId::NONE || id == NodeId::INTERPRETER {
            return;
        }
        match self.nodes[id.idx()].kind() {
            StateKind::Script => Script::deinit(self, id),
            StateKind::Stmt => Stmt::deinit(self, id),
            StateKind::Binary => Binary::deinit(self, id),
            StateKind::Pipeline => Pipeline::deinit(self, id),
            StateKind::Cmd => Cmd::deinit(self, id),
            StateKind::Assign => Assigns::deinit(self, id),
            StateKind::Expansion => Expansion::deinit(self, id),
            StateKind::IfClause => If::deinit(self, id),
            StateKind::Condexpr => CondExpr::deinit(self, id),
            StateKind::Async => return, // Async deinit is purposefully empty; freed later by async_cmd_done → actually_deinit.
            StateKind::Subshell => Subshell::deinit(self, id),
            StateKind::Free => return,
        }
        self.free_node(id);
    }

    // ── root (Interpreter-as-parent) ───────────────────────────────────────

    fn on_root_child_done(&mut self, child: NodeId, exit_code: ExitCode) -> Yield {
        // Only `Script` can be a direct child of the interpreter.
        debug_assert!(matches!(self.nodes[child.idx()], Node::Script(_)));
        log!("Interpreter script finish {}", exit_code);
        Script::deinit_from_interpreter(self, child);
        self.free_node(child);
        self.exit_code = Some(exit_code);
        if self.async_commands_executing == 0 {
            return self.finish(exit_code);
        }
        Yield::suspended()
    }

    pub fn async_cmd_done(&mut self, async_id: NodeId) {
        Async::actually_deinit(self, async_id);
        self.free_node(async_id);
        self.async_commands_executing -= 1;
        if self.async_commands_executing == 0 {
            if let Some(exit) = self.exit_code {
                self.finish(exit).run(self);
            }
        }
    }

    // ── error side-channel (Base::try_) ────────────────────────────────────

    /// Unwrap a `Maybe(T)` into `Result<T, TryError>`, stashing the rich
    /// syscall error on the interpreter for later retrieval.
    #[inline]
    pub fn try_<T>(&mut self, m: bun_sys::Result<T>) -> Result<T, crate::shell::states::base::TryError> {
        match m {
            Ok(v) => Ok(v),
            Err(e) => {
                self.last_err = Some(e);
                Err(crate::shell::states::base::TryError::Sys)
            }
        }
    }

    #[inline]
    pub fn take_err(&mut self) -> bun_sys::Error {
        self.last_err
            .take()
            .expect("take_err() with no stashed error")
    }

    #[inline]
    pub fn root_io(&self) -> &IO {
        &self.root_io
    }

    pub fn throw(&mut self, err: &ShellErr) {
        // Spec: `throwShellErr(err, event_loop)` raises a JS exception.
        // TODO(b2-blocked): bun_jsc — throw_shell_err(err, self.event_loop).
        // Until JSC is wired, stash the underlying syscall error so `finish`/
        // the JS resolve path can surface it instead of silently dropping it.
        self.last_err = Some(err.0.clone());
    }

    // ── run loop ───────────────────────────────────────────────────────────

    /// Spec: interpreter.zig `setupIOBeforeRun` + `setupIOBeforeRunImpl`
    /// (interpreter.zig:1177-1223). When `!quiet`, dup stdout/stderr (or open
    /// the null device if the process was started with that stream closed),
    /// wrap each in an `IOWriter`, and install them as `root_io.stdout/stderr`
    /// so command output reaches the terminal. On the JS event loop the
    /// `captured` slot is also wired to `_buffered_stdout/err` so
    /// `Bun.$` callers can read it back.
    fn setup_io_before_run(&mut self) -> bun_sys::Result<()> {
        if self.flags.quiet() {
            return Ok(());
        }
        let event_loop = self.event_loop;

        // ── dup stdout ─────────────────────────────────────────────────────
        log!("Duping stdout");
        let stdout_fd = if bun_core::output::stdio::is_stdout_null() {
            open_null_device()?
        } else {
            shell_dup(Fd::stdout())?
        };

        // ── dup stderr (errdefer closes stdout on failure) ────────────────
        log!("Duping stderr");
        let stderr_fd_res = if bun_core::output::stdio::is_stderr_null() {
            open_null_device()
        } else {
            shell_dup(Fd::stderr())
        };
        let stderr_fd = match stderr_fd_res {
            Ok(fd) => fd,
            Err(e) => {
                closefd(stdout_fd);
                return Err(e);
            }
        };

        let stdout_writer = IOWriter::init(
            stdout_fd,
            crate::shell::io_writer::Flags {
                pollable: is_pollable(stdout_fd),
                ..Default::default()
            },
            event_loop,
        );
        let stderr_writer = IOWriter::init(
            stderr_fd,
            crate::shell::io_writer::Flags {
                pollable: is_pollable(stderr_fd),
                ..Default::default()
            },
            event_loop,
        );

        self.root_io.stdout = crate::shell::io::OutKind::Fd(crate::shell::io::OutFd {
            writer: stdout_writer,
            captured: None,
        });
        self.root_io.stderr = crate::shell::io::OutKind::Fd(crate::shell::io::OutFd {
            writer: stderr_writer,
            captured: None,
        });

        // Spec: `if (event_loop == .js)` — hook captured buffers so the JS
        // `Bun.$` API can read stdout/stderr after completion.
        // TODO(b2-blocked): bun_jsc — `EventLoopHandle` is an opaque shim with
        // no `.js` discriminant yet; the mini path (the only live caller) does
        // not capture, so this is correctly a no-op until the JS loop lands.

        Ok(())
    }

    pub fn run(&mut self) -> bun_sys::Result<()> {
        log!("Interpreter(0x{:x}) run", self as *const _ as usize);
        if let Err(e) = self.setup_io_before_run() {
            return Err(e);
        }

        // PORT NOTE: reshaped for borrowck — capture raw ptrs/clones before
        // taking `&mut self` for `Script::init`.
        let shell = &mut self.root_shell as *mut _;
        let ast = &self.args.script_ast as *const _;
        let io = self.root_io.clone();
        let root = Script::init(self, shell, ast, NodeId::INTERPRETER, io);
        self.started.store(true, Ordering::SeqCst);
        Script::start(self, root).run(self);
        Ok(())
    }

    pub fn finish(&mut self, exit_code: ExitCode) -> Yield {
        log!("Interpreter(0x{:x}) finish {}", self as *const _ as usize, exit_code);
        // Spec interpreter.zig:1287-1289 — `defer decrPendingActivityFlag(...)`
        // unconditionally (both JS and mini paths). Paired with the increment
        // in `runFromJS`; harmless wrap on the mini path (flag is only ever
        // read from the JS GC `hasPendingActivity()` hook).
        self.has_pending_activity.fetch_sub(1, Ordering::SeqCst);
        self.exit_code = Some(exit_code);
        self.flags.set_done(true);
        // TODO(b2-blocked): JS resolve/reject + keep_alive.disable() — see
        // gated body. Non-JS path just records exit code.
        Yield::done()
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ShellExecEnv
// ────────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
type PidT = libc::pid_t;
#[cfg(windows)]
type PidT = i32; // bun_sys::windows::libuv::uv_pid_t

/// Shell execution environment (env vars, cwd, captured stdout/stderr).
/// Every state node holds a `*mut ShellExecEnv` in its `Base`; some nodes
/// (Script, Subshell, command-substitution, pipeline children) own a duped
/// env that they must `deinit`.
pub struct ShellExecEnv {
    pub kind: ShellExecEnvKind,
    pub _buffered_stdout: Bufio,
    pub _buffered_stderr: Bufio,
    pub shell_env: EnvMap,
    pub cmd_local_env: EnvMap,
    pub export_env: EnvMap,
    pub __prev_cwd: Vec<u8>,
    pub __cwd: Vec<u8>,
    pub cwd_fd: Fd,
    pub async_pids: SmolList<PidT, 4>,
}

pub enum Bufio {
    Owned(ByteList),
    Borrowed(*mut ByteList),
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
    #[inline]
    pub fn cwd(&self) -> &[u8] {
        if self.__cwd.is_empty() {
            return b"";
        }
        &self.__cwd[..self.__cwd.len().saturating_sub(1)]
    }

    #[inline]
    pub fn prev_cwd(&self) -> &[u8] {
        if self.__prev_cwd.is_empty() {
            return b"";
        }
        &self.__prev_cwd[..self.__prev_cwd.len().saturating_sub(1)]
    }

    pub fn buffered_stdout(&mut self) -> *mut ByteList {
        match &mut self._buffered_stdout {
            Bufio::Owned(o) => o as *mut _,
            Bufio::Borrowed(b) => *b,
        }
    }

    pub fn buffered_stderr(&mut self) -> *mut ByteList {
        match &mut self._buffered_stderr {
            Bufio::Owned(o) => o as *mut _,
            Bufio::Borrowed(b) => *b,
        }
    }

    /// Spec: interpreter.zig `ShellExecEnv.dupeForSubshell`. Heap-allocates a
    /// fresh env for a subshell/pipeline child: dups `cwd_fd`, clones
    /// `shell_env`/`export_env`, gives it a fresh empty `cmd_local_env`, and
    /// borrows or owns buffered stdout/stderr per `kind` (subshell/pipeline
    /// borrow the parent's buffers so output bubbles up; cmd-subst owns).
    ///
    /// Caller frees with `ShellExecEnv::deinit_impl(p)`.
    pub fn dupe_for_subshell(
        &mut self,
        io: &IO,
        kind: ShellExecEnvKind,
    ) -> bun_sys::Result<*mut ShellExecEnv> {
        use crate::shell::io::OutKind;

        let dupedfd = bun_sys::dup(self.cwd_fd)?;

        // Spec (interpreter.zig dupeForSubshell): for `.fd` with a captured
        // buffer, borrow that; for `.ignore`, own a fresh one; for `.pipe`,
        // own when normal/cmd_subst, borrow parent's when subshell/pipeline.
        let bufio_for = |out: &OutKind, parent_buf: *mut ByteList| -> Bufio {
            match out {
                OutKind::Fd(f) => match f.captured {
                    Some(cap) => Bufio::Borrowed(cap),
                    None => Bufio::Owned(ByteList::default()),
                },
                OutKind::Ignore => Bufio::Owned(ByteList::default()),
                OutKind::Pipe => match kind {
                    ShellExecEnvKind::Normal | ShellExecEnvKind::CmdSubst => {
                        Bufio::Owned(ByteList::default())
                    }
                    ShellExecEnvKind::Subshell | ShellExecEnvKind::Pipeline => {
                        Bufio::Borrowed(parent_buf)
                    }
                },
            }
        };
        let stdout = bufio_for(&io.stdout, self.buffered_stdout());
        let stderr = bufio_for(&io.stderr, self.buffered_stderr());

        let duped = Box::new(ShellExecEnv {
            kind,
            _buffered_stdout: stdout,
            _buffered_stderr: stderr,
            shell_env: self.shell_env.clone(),
            cmd_local_env: EnvMap::init(),
            export_env: self.export_env.clone(),
            __prev_cwd: self.__prev_cwd.clone(),
            __cwd: self.__cwd.clone(),
            cwd_fd: dupedfd,
            async_pids: SmolList::default(),
        });
        Ok(Box::into_raw(duped))
    }

    /// Spec: interpreter.zig `ShellExecEnv.deinit` — wraps `deinitImpl(true,
    /// true)` for the heap-allocated subshell/pipeline-child case.
    ///
    /// SAFETY: `this` was returned by `dupe_for_subshell` (or otherwise
    /// `Box::into_raw`'d) and not yet freed.
    pub fn deinit_impl(this: *mut ShellExecEnv) {
        log!("[ShellExecEnv] deinit 0x{:x}", this as usize);
        // SAFETY: precondition above. Reclaim the Box; `Drop` for the env
        // maps / vecs / owned `Bufio` runs on drop. Only `cwd_fd` needs an
        // explicit close (Zig: `closefd(this.cwd_fd)`).
        let boxed = unsafe { Box::from_raw(this) };
        closefd(boxed.cwd_fd);
        // EnvMap/Vec/ByteList drop impls free their storage; `Bufio::Borrowed`
        // is a raw ptr so its drop is a no-op (matches Zig's
        // `if (== .owned) clearAndFree`).
        drop(boxed);
    }

    /// Spec: interpreter.zig `ShellExecEnv.changePrevCwd` — `cd -`.
    #[inline]
    pub fn change_prev_cwd(&mut self) -> bun_sys::Result<()> {
        // PORT NOTE: reshaped for borrowck — `prev_cwd()` borrows `self`, so
        // copy into a stack buffer before the `&mut self` call. Bounded by the
        // ENAMETOOLONG check inside `change_cwd_impl` (same 4 KiB).
        let mut buf = bun_paths::PathBuffer::uninit();
        let prev = self.prev_cwd();
        let n = prev.len();
        buf[..n].copy_from_slice(prev);
        self.change_cwd_impl(&buf[..n], false)
    }

    /// Spec: interpreter.zig `ShellExecEnv.changeCwd` — thin `in_init = false`
    /// wrapper. The Zig version is `anytype` over `[:0]const u8` / `[]const u8`;
    /// we accept the un-terminated slice and let `change_cwd_impl` re-NUL into
    /// its join buffer (the sentinel fast-path is a memcpy either way).
    #[inline]
    pub fn change_cwd(&mut self, new_cwd: &[u8]) -> bun_sys::Result<()> {
        self.change_cwd_impl(new_cwd, false)
    }

    /// Spec: interpreter.zig `ShellExecEnv.changeCwdImpl`.
    ///
    /// Resolves `new_cwd_` (absolute, or relative to current `cwd()`), opens it
    /// with `O_DIRECTORY`, and on success rotates `__cwd`/`__prev_cwd`/`cwd_fd`.
    /// Always writes `PWD` into `export_env`; `OLDPWD` is written only when
    /// `!in_init` (the very first cwd has no meaningful "previous").
    pub fn change_cwd_impl(
        &mut self,
        new_cwd_: &[u8],
        in_init: bool,
    ) -> bun_sys::Result<()> {
        let is_abs = bun_paths::is_absolute(new_cwd_);

        // Spec bounds-check against the 4096-byte join buffer (ENAMETOOLONG).
        let mut buf = bun_paths::PathBuffer::uninit();
        let required_len = if is_abs {
            new_cwd_.len()
        } else {
            self.cwd().len() + 1 + new_cwd_.len()
        };
        if required_len >= buf.len() {
            return Err(bun_sys::Error::from_code_int(
                bun_sys::E::ENAMETOOLONG as _,
                bun_sys::Tag::chdir,
            ));
        }

        // Build NUL-terminated `new_cwd` in `buf`.
        let new_cwd_len: usize = if is_abs {
            buf[..new_cwd_.len()].copy_from_slice(new_cwd_);
            buf[new_cwd_.len()] = 0;
            new_cwd_.len()
        } else {
            // Spec interpreter.zig:637-640 — `ResolvePath.joinZ(&.{cwd, new_cwd_},
            // .auto)` normalizes `.`/`..` so the stored `$PWD`/`$OLDPWD` strings
            // reflect the resolved path (not `<cwd>/..`).
            // PORT NOTE: reshaped for borrowck — capture only the joined length
            // so the borrow on `buf` is released before stripping below.
            let mut n = {
                let existing_cwd = self.cwd();
                bun_paths::resolve_path::join_z_buf::<bun_paths::platform::Auto>(
                    &mut buf[..],
                    &[existing_cwd, new_cwd_],
                )
                .as_bytes()
                .len()
            };
            // remove trailing separator (spec interpreter.zig:643-653 — Windows
            // checks `\\` first then falls through to `/`; POSIX only `/`).
            #[cfg(windows)]
            if n > 1 && buf[n - 1] == b'\\' {
                n -= 1;
            } else if n > 1 && buf[n - 1] == b'/' {
                n -= 1;
            }
            #[cfg(not(windows))]
            if n > 1 && buf[n - 1] == b'/' {
                n -= 1;
            }
            buf[n] = 0;
            n
        };
        // SAFETY: we wrote `new_cwd_len` bytes + a NUL at `[new_cwd_len]`.
        let new_cwd_z = unsafe { bun_core::ZStr::from_raw(buf.as_ptr(), new_cwd_len) };

        let new_cwd_fd = shell_openat(
            self.cwd_fd,
            new_cwd_z,
            bun_sys::O::DIRECTORY | bun_sys::O::RDONLY,
            0,
        )?;

        closefd(self.cwd_fd);

        self.__prev_cwd.clear();
        self.__prev_cwd.extend_from_slice(&self.__cwd[..]);

        self.__cwd.clear();
        // include trailing NUL (spec: `new_cwd[0 .. new_cwd.len + 1]`).
        self.__cwd.extend_from_slice(&buf[..new_cwd_len + 1]);

        debug_assert_eq!(*self.__cwd.last().unwrap(), 0);
        debug_assert_eq!(*self.__prev_cwd.last().unwrap(), 0);

        self.cwd_fd = new_cwd_fd;

        // Spec interpreter.zig:685-688: only `OLDPWD` is gated on `!in_init`;
        // `PWD` is written unconditionally so the very first env (built during
        // `init()` with `in_init = true`) still exports the resolved cwd.
        // PORT NOTE: reshaped for borrowck — materialize the EnvStr (which
        // erases the slice lifetime into a packed ptr) before taking
        // `&mut self.export_env`.
        use crate::shell::env_str::EnvStr;
        if !in_init {
            let oldpwd = EnvStr::init_slice(self.prev_cwd());
            self.export_env.insert(EnvStr::init_slice(b"OLDPWD"), oldpwd);
        }
        let pwd = EnvStr::init_slice(self.cwd());
        self.export_env.insert(EnvStr::init_slice(b"PWD"), pwd);

        Ok(())
    }

    // The remaining body (get_home_dir, assign_var, etc.) is preserved in the
    // gated `interpreter_body` module below — it depends on ResolvePath
    // join_buf and IOWriter method surface that aren't yet stable.
}

// ────────────────────────────────────────────────────────────────────────────
// ShellArgs (AST + arena)
// ────────────────────────────────────────────────────────────────────────────

pub struct ShellArgs {
    /// Arena owning the parsed AST nodes, tokens, and string pool.
    pub __arena: bun_alloc::Arena,
    /// Root AST node. State nodes hold `*const ast::*` into this arena.
    pub script_ast: ast::Script,
}

// ────────────────────────────────────────────────────────────────────────────
// EventLoopHandle shim
// ────────────────────────────────────────────────────────────────────────────

/// `bun.jsc.EventLoopHandle` — tagged union over `{ js: *JSEventLoop, mini:
/// *MiniEventLoop }`. The real type lives in `bun_jsc` (blocked); the shell
/// only stores/forwards it, so an opaque copyable handle suffices for now.
// TODO(b2-blocked): bun_jsc::EventLoopHandle
#[derive(Clone, Copy, Debug, Default)]
pub struct EventLoopHandle(pub usize);

// ────────────────────────────────────────────────────────────────────────────
// CowFd
// ────────────────────────────────────────────────────────────────────────────

/// Copy-on-write file descriptor: avoids multiple non-blocking writers on the
/// same fd (which breaks epoll/kqueue).
pub struct CowFd {
    __fd: Fd,
    refcount: u32,
    being_used: bool,
}

impl CowFd {
    pub fn init(fd: Fd) -> *mut CowFd {
        Box::into_raw(Box::new(CowFd { __fd: fd, refcount: 1, being_used: false }))
    }
    pub fn ref_(&mut self) { self.refcount += 1; }
    pub fn deref(this: *mut CowFd) {
        // SAFETY: caller holds a valid CowFd
        unsafe {
            (*this).refcount -= 1;
            if (*this).refcount == 0 {
                // Spec `CowFd.deinit` (interpreter.zig:192-196): close the fd
                // before freeing. `closefd` tolerates EBADF like Zig's
                // `closeAllowingBadFileDescriptor`.
                closefd((*this).__fd);
                drop(Box::from_raw(this));
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Convenience re-exports for state modules
// ────────────────────────────────────────────────────────────────────────────

pub use crate::shell::states::assigns::AssignCtx;
pub use crate::shell::builtin::Builtin;
pub use crate::shell::io_reader::IOReader;
pub use crate::shell::io_writer::IOWriter;

/// Spec: `bun.sys.openNullDevice()` (sys.zig:3865) — open `/dev/null` `O_RDWR`
/// on POSIX, `nul` on Windows. Used when a stdio stream was closed at process
/// start so we have *something* to dup into the shell's root IO. Must be
/// writable: `setup_io_before_run` installs the result as the stdout/stderr
/// `IOWriter` target (and `init` uses it for stdin), so `RDWR` covers both.
fn open_null_device() -> bun_sys::Result<Fd> {
    #[cfg(unix)]
    {
        bun_sys::open(
            // SAFETY: static C string with NUL.
            unsafe { bun_core::ZStr::from_raw(b"/dev/null\0".as_ptr(), 9) },
            bun_sys::O::RDWR,
            0,
        )
    }
    #[cfg(windows)]
    {
        // Spec uses `sys_uv.open("nul", 0, 0)` — flags `0` is `O_RDONLY` in
        // libuv's encoding, but Windows NUL is bidirectional regardless.
        bun_sys::open(
            unsafe { bun_core::ZStr::from_raw(b"nul\0".as_ptr(), 3) },
            bun_sys::O::RDWR,
            0,
        )
    }
}

/// Spec: interpreter.zig `isPollable` (interpreter.zig:2116-2124).
///
/// PORT NOTE: spec takes a pre-cached `mode` from `event_loop.stdout().data
/// .file.mode`; `EventLoopHandle` is still a shim, so we `fstat` the (already
/// dup'd) fd here instead. On `fstat` failure we conservatively return `false`
/// (non-pollable → synchronous write path), matching Windows behavior.
fn is_pollable(fd: Fd) -> bool {
    #[cfg(windows)]
    {
        let _ = fd;
        false
    }
    #[cfg(unix)]
    {
        let mode = match bun_sys::fstat(fd) {
            Ok(st) => st.st_mode,
            Err(_) => return false,
        };
        let fmt = mode & libc::S_IFMT;
        #[cfg(target_os = "macos")]
        {
            // macOS allows polling regular files, but our IOWriter has a
            // better dedicated path for them — exclude S_ISREG explicitly.
            if fmt == libc::S_IFREG {
                return false;
            }
        }
        fmt == libc::S_IFIFO || fmt == libc::S_IFSOCK || bun_sys::isatty(fd)
    }
}

/// Spec: interpreter.zig `closefd` → `fd.closeAllowingBadFileDescriptor`.
/// Tolerates EBADF (already-closed) so cleanup paths that may double-close
/// don't panic; skips stdin/stdout/stderr.
pub fn closefd(fd: Fd) {
    use bun_sys::FdExt;
    let _ = fd.close_allowing_bad_file_descriptor(None);
}

/// Spec: interpreter.zig `ShellSyscall.dup` (interpreter.zig:1931-1939).
/// Same as `bun_sys::dup` on POSIX; on Windows the duped handle is converted
/// to a libuv-owned fd via `makeLibUVOwnedForSyscall(.dup, .close_on_fail)` so
/// the IOWriter/IOReader uv-based async write/read paths receive a uv fd
/// instead of a raw NT handle.
pub fn shell_dup(fd: Fd) -> bun_sys::Result<Fd> {
    #[cfg(windows)]
    {
        use bun_sys::FdExt;
        bun_sys::dup(fd)?
            .make_lib_uv_owned_for_syscall(bun_sys::Tag::dup, bun_sys::ErrorCase::CloseOnFail)
    }
    #[cfg(not(windows))]
    {
        bun_sys::dup(fd)
    }
}

/// Spec: interpreter.zig `ShellSyscall.getPath` (interpreter.zig:1823-1858).
/// Windows-only: rewrite shell paths so POSIX-absolute `/foo` resolves onto
/// `dirfd`'s drive root, `/dev/null` maps to `NUL`, and relative paths are
/// joined against `dirfd`'s real path. Returns a NUL-terminated slice that
/// either borrows `buf` or is `to` itself.
#[cfg(windows)]
fn shell_get_path<'a>(
    dirfd: Fd,
    to: &'a bun_core::ZStr,
    buf: &'a mut bun_paths::PathBuffer,
) -> bun_sys::Result<&'a bun_core::ZStr> {
    if to.as_bytes() == b"/dev/null" {
        return Ok(crate::shell::shell_body::WINDOWS_DEV_NULL);
    }
    if bun_paths::Platform::Posix.is_absolute(to.as_bytes()) {
        let source_root_len = {
            let dirpath =
                bun_sys::get_fd_path(dirfd, buf).map_err(|e| e.with_fd(dirfd))?;
            bun_paths::resolve_path::windows_filesystem_root(dirpath).len()
        };
        // Spec: `copyForwards(buf[0..root], source_root)` — `dirpath` already
        // occupies `buf[0..]` and the root is its prefix, so that copy is a
        // no-op here. Splice `to[1..]` after the root.
        let to_tail = &to.as_bytes()[1..];
        let end = source_root_len + to_tail.len();
        buf[source_root_len..end].copy_from_slice(to_tail);
        buf[end] = 0;
        // SAFETY: wrote `end` bytes + NUL at `[end]`.
        return Ok(unsafe { bun_core::ZStr::from_raw(buf.as_ptr(), end) });
    }
    if bun_paths::Platform::Windows.is_absolute(to.as_bytes()) {
        return Ok(to);
    }
    // Relative: resolve dirfd → path, then join.
    // PORT NOTE: reshaped for borrowck — Zig's `joinZBuf(buf, &.{dirpath, to})`
    // reads `dirpath` (a slice of `buf`) while writing `buf`; copy `dirpath`
    // out first so the mutable borrow on `buf` is exclusive.
    let dirpath = bun_sys::get_fd_path(dirfd, buf)
        .map_err(|e| e.with_fd(dirfd))?
        .to_vec();
    Ok(bun_paths::resolve_path::join_z_buf::<bun_paths::platform::Auto>(
        &mut buf[..],
        &[&dirpath, to.as_bytes()],
    ))
}

/// Spec: interpreter.zig `ShellSyscall.statat` (interpreter.zig:1861-1877).
/// Windows: rewrite the path via `shell_get_path` then `bun_sys::stat`, tagging
/// the error with the *original* `path_` (not the rewritten one). POSIX: plain
/// `bun_sys::fstatat(dir, path_)`.
#[allow(dead_code)] // consumed by states/CondExpr (`[[ -e/-f/-d ... ]]`)
pub fn shell_statat(dir: Fd, path_: &bun_core::ZStr) -> bun_sys::Result<bun_sys::Stat> {
    #[cfg(windows)]
    {
        let mut buf = bun_paths::path_buffer_pool::get();
        let p = shell_get_path(dir, path_, &mut buf)?;
        return bun_sys::stat(p).map_err(|e| e.with_path(path_.as_bytes()));
    }
    #[cfg(not(windows))]
    {
        bun_sys::fstatat(dir, path_)
    }
}

/// Spec: interpreter.zig `ShellSyscall.openat` (interpreter.zig:1881-1918).
/// POSIX: `bun_sys::openat` with the error tagged `.with_path(path)`.
/// Windows: for `O_DIRECTORY` opens, rewrite POSIX-absolute paths via
/// `shell_get_path` and use `openDirAtWindowsA(.iterable=true)` +
/// `makeLibUVOwnedForSyscall`; for file opens, resolve via `shell_get_path`
/// then `bun_sys::open`.
pub fn shell_openat(
    dir: Fd,
    path: &bun_core::ZStr,
    flags: i32,
    perm: bun_sys::Mode,
) -> bun_sys::Result<Fd> {
    #[cfg(windows)]
    {
        use bun_sys::FdExt;
        if flags & bun_sys::O::DIRECTORY != 0 {
            if bun_paths::Platform::Posix.is_absolute(path.as_bytes()) {
                let mut buf = bun_paths::path_buffer_pool::get();
                let p = shell_get_path(dir, path, &mut buf)?;
                return bun_sys::open_dir_at_windows_a(
                    dir,
                    p.as_bytes(),
                    bun_sys::WindowsOpenDirOptions {
                        iterable: true,
                        no_follow: flags & bun_sys::O::NOFOLLOW != 0,
                        ..Default::default()
                    },
                )
                .map_err(|e| e.with_path(path.as_bytes()))?
                .make_lib_uv_owned_for_syscall(
                    bun_sys::Tag::open,
                    bun_sys::ErrorCase::CloseOnFail,
                );
            }
            return bun_sys::open_dir_at_windows_a(
                dir,
                path.as_bytes(),
                bun_sys::WindowsOpenDirOptions {
                    iterable: true,
                    no_follow: flags & bun_sys::O::NOFOLLOW != 0,
                    ..Default::default()
                },
            )
            .map_err(|e| e.with_path(path.as_bytes()))?
            .make_lib_uv_owned_for_syscall(
                bun_sys::Tag::open,
                bun_sys::ErrorCase::CloseOnFail,
            );
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let p = shell_get_path(dir, path, &mut buf)?;
        return bun_sys::open(p, flags, perm)?
            .make_lib_uv_owned_for_syscall(
                bun_sys::Tag::open,
                bun_sys::ErrorCase::CloseOnFail,
            );
    }
    #[cfg(not(windows))]
    {
        bun_sys::openat(dir, path, flags, perm)
            .map_err(|e| e.with_path(path.as_bytes()))
    }
}

/// Spec: interpreter.zig `ShellSyscall.open` (interpreter.zig:1920-1929).
/// `bun_sys::open` already routes through `sys_uv` on Windows (returns a uv
/// fd), so unlike `openat`'s NT-handle directory path this needs no explicit
/// `makeLibUVOwnedForSyscall` — the dead `if (isWindows)` tail in the Zig
/// source is unreachable after the early `return bun.sys.open(...)`.
#[allow(dead_code)] // no Zig callers yet; ported for ShellSyscall surface parity
pub fn shell_open(file_path: &bun_core::ZStr, flags: i32, perm: bun_sys::Mode) -> bun_sys::Result<Fd> {
    #[cfg(windows)]
    {
        use bun_sys::FdExt;
        return bun_sys::open(file_path, flags, perm)?
            .make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail);
    }
    #[cfg(not(windows))]
    {
        bun_sys::open(file_path, flags, perm)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Builtin flag-parsing infra (Spec: interpreter.zig `ParseError` / `FlagParser`)
// ────────────────────────────────────────────────────────────────────────────

/// Custom parse error for invalid options. Spec: interpreter.zig `ParseError`.
///
/// Payload slices borrow from the builtin's argv (NUL-terminated arena strings)
/// or are `'static` literals; the builtin formats them into an error message
/// before the next argv mutation, so a raw fat pointer is safe.
pub enum ParseError {
    IllegalOption(*const [u8]),
    Unsupported(*const [u8]),
    ShowUsage,
}

/// Spec: interpreter.zig `ParseFlagResult`.
pub enum ParseFlagResult {
    ContinueParsing,
    Done,
    IllegalOption(*const [u8]),
    Unsupported(*const [u8]),
    ShowUsage,
}

/// Spec: interpreter.zig `unsupportedFlag` (interpreter.zig:2063-2065) returns
/// the comptime-concatenated `"unsupported option, please open a GitHub issue
/// -- " ++ name ++ "\n"`. Every caller then wraps that AGAIN in the same
/// prefix via `fmtErrorArena`, so Zig's stderr prints the prefix twice.
///
/// PORT NOTE — intentional spec-bug fix: we return just `name` and let the
/// caller's `fmt_error_arena` add the prefix once. This diverges from Zig's
/// observable doubled output; update Zig (or any snapshot tests asserting the
/// doubled message) rather than reproducing the duplication here. Reproducing
/// it would require runtime allocation (`Box::leak` is forbidden — see
/// PORTING.md §Forbidden) since Rust can't comptime-concat a non-const arg.
#[inline]
pub const fn unsupported_flag(name: &'static [u8]) -> *const [u8] {
    name as *const [u8]
}

/// Per-builtin opts type implements this to plug into `FlagParser::parse_flags`.
/// Spec: interpreter.zig `FlagParser(comptime Opts)` — the Zig version is a
/// type-generator; in Rust the per-opts hooks are a trait.
pub trait FlagParser {
    /// Handle a `--long` flag. Return `None` to fall through to short parsing.
    fn parse_long(&mut self, flag: &[u8]) -> Option<ParseFlagResult>;
    /// Handle one byte of a `-abc` cluster. Return `None` to keep iterating.
    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult>;
}

/// Spec: interpreter.zig `FlagParser.parseFlags`. Returns the trailing
/// non-flag args (`args[idx..]`) on success.
pub fn parse_flags<'a, O: FlagParser>(
    opts: &mut O,
    args: &'a [*const core::ffi::c_char],
) -> Result<Option<&'a [*const core::ffi::c_char]>, ParseError> {
    if args.is_empty() {
        return Ok(None);
    }
    let mut idx = 0usize;
    while idx < args.len() {
        // SAFETY: argv entries are NUL-terminated C strings (see Builtin::init).
        let flag = unsafe { core::ffi::CStr::from_ptr(args[idx]) }.to_bytes();
        match parse_one_flag(opts, flag) {
            ParseFlagResult::Done => return Ok(Some(&args[idx..])),
            ParseFlagResult::ContinueParsing => {}
            ParseFlagResult::IllegalOption(s) => return Err(ParseError::IllegalOption(s)),
            ParseFlagResult::Unsupported(s) => return Err(ParseError::Unsupported(s)),
            ParseFlagResult::ShowUsage => return Err(ParseError::ShowUsage),
        }
        idx += 1;
    }
    Err(ParseError::ShowUsage)
}

/// Spec: interpreter.zig `FlagParser.parseFlag`.
fn parse_one_flag<O: FlagParser>(opts: &mut O, flag: &[u8]) -> ParseFlagResult {
    if flag.is_empty() || flag[0] != b'-' {
        return ParseFlagResult::Done;
    }
    if flag.len() == 1 {
        return ParseFlagResult::IllegalOption(b"-" as *const [u8]);
    }
    if flag.len() > 2 && flag[1] == b'-' {
        if let Some(r) = opts.parse_long(flag) {
            return r;
        }
    }
    let small_flags = &flag[1..];
    for (i, &ch) in small_flags.iter().enumerate() {
        if let Some(r) = opts.parse_short(ch, small_flags, i) {
            return r;
        }
    }
    ParseFlagResult::ContinueParsing
}

// ────────────────────────────────────────────────────────────────────────────
// OutputTask (Spec: interpreter.zig `OutputTask` / `OutputSrc`)
// ────────────────────────────────────────────────────────────────────────────

/// Spec: interpreter.zig `OutputSrc`. Owned bytes a builtin's async sub-task
/// produced off-thread, queued for stdout once back on the main thread.
pub enum OutputSrc {
    /// `std.ArrayListUnmanaged(u8)` — owned, freed on drop.
    Arrlist(Vec<u8>),
    /// Heap slice owned by us (freed on drop).
    OwnedBuf(Box<[u8]>),
    /// Borrowed; not freed (e.g. arena-backed).
    BorrowedBuf(*const [u8]),
}

impl OutputSrc {
    pub fn slice(&self) -> &[u8] {
        match self {
            OutputSrc::Arrlist(v) => v.as_slice(),
            OutputSrc::OwnedBuf(b) => b,
            // SAFETY: caller guarantees the borrow outlives the OutputTask.
            OutputSrc::BorrowedBuf(p) => unsafe { &**p },
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OutputTaskState {
    WaitingWriteErr,
    WaitingWriteOut,
    Done,
}

/// Spec: interpreter.zig `OutputTask` vtable. In Zig this is a comptime struct
/// of fn pointers; here it's a trait the parent builtin implements. All hooks
/// take `(&mut Interpreter, NodeId)` (NodeId style — the parent builtin lives
/// inside the interpreter's node arena).
///
/// `child` is the heap-allocated `OutputTask` itself, passed so `write_*` can
/// register it as the IOWriter callback target.
pub trait OutputTaskVTable: Sized {
    fn write_err(
        interp: &mut Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        errbuf: &[u8],
    ) -> Option<Yield>;
    fn on_write_err(interp: &mut Interpreter, cmd: NodeId);
    fn write_out(
        interp: &mut Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        output: &mut OutputSrc,
    ) -> Option<Yield>;
    fn on_write_out(interp: &mut Interpreter, cmd: NodeId);
    fn on_done(interp: &mut Interpreter, cmd: NodeId) -> Yield;
}

/// A task that can write to stdout and/or stderr. Spec: interpreter.zig
/// `OutputTask(Parent, vtable)`.
///
/// Heap-allocated (`Box::into_raw`) so the IOWriter can hold a raw pointer to
/// it across async chunks; freed by `deinit`.
pub struct OutputTask<P: OutputTaskVTable> {
    /// Owning Cmd node (the builtin's `cmd` id). Replaces Zig's `*Parent`.
    pub parent: NodeId,
    pub output: OutputSrc,
    pub state: OutputTaskState,
    _marker: core::marker::PhantomData<P>,
}

impl<P: OutputTaskVTable> OutputTask<P> {
    pub fn new(parent: NodeId, output: OutputSrc) -> *mut Self {
        Box::into_raw(Box::new(OutputTask {
            parent,
            output,
            state: OutputTaskState::WaitingWriteErr,
            _marker: core::marker::PhantomData,
        }))
    }

    /// Spec: interpreter.zig `OutputTask.start`.
    ///
    /// SAFETY: `this` was returned by `OutputTask::new` and not yet freed.
    pub unsafe fn start(
        this: *mut Self,
        interp: &mut Interpreter,
        errbuf: Option<&[u8]>,
    ) -> Yield {
        let me = unsafe { &mut *this };
        log!(
            "OutputTask(0x{:x}) start errbuf={:?}",
            this as usize,
            errbuf.map(|b| b.len())
        );
        me.state = OutputTaskState::WaitingWriteErr;
        if let Some(err) = errbuf {
            if let Some(y) = P::write_err(interp, me.parent, this, err) {
                return y;
            }
            return unsafe { Self::next(this, interp) };
        }
        me.state = OutputTaskState::WaitingWriteOut;
        if let Some(y) = P::write_out(interp, me.parent, this, &mut me.output) {
            return y;
        }
        P::on_write_out(interp, me.parent);
        me.state = OutputTaskState::Done;
        unsafe { Self::deinit(this, interp) }
    }

    /// Spec: interpreter.zig `OutputTask.next`.
    pub unsafe fn next(this: *mut Self, interp: &mut Interpreter) -> Yield {
        let me = unsafe { &mut *this };
        match me.state {
            OutputTaskState::WaitingWriteErr => {
                P::on_write_err(interp, me.parent);
                me.state = OutputTaskState::WaitingWriteOut;
                if let Some(y) = P::write_out(interp, me.parent, this, &mut me.output) {
                    return y;
                }
                P::on_write_out(interp, me.parent);
                me.state = OutputTaskState::Done;
                unsafe { Self::deinit(this, interp) }
            }
            OutputTaskState::WaitingWriteOut => {
                P::on_write_out(interp, me.parent);
                me.state = OutputTaskState::Done;
                unsafe { Self::deinit(this, interp) }
            }
            OutputTaskState::Done => panic!("Invalid state"),
        }
    }

    /// Spec: interpreter.zig `OutputTask.onIOWriterChunk`.
    pub unsafe fn on_io_writer_chunk(
        this: *mut Self,
        interp: &mut Interpreter,
        _written: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        log!("OutputTask(0x{:x}) onIOWriterChunk", this as usize);
        // Zig derefs the SystemError; in Rust drop handles it.
        unsafe { Self::next(this, interp) }
    }

    /// Spec: interpreter.zig `OutputTask.deinit` — fires `on_done` then frees.
    unsafe fn deinit(this: *mut Self, interp: &mut Interpreter) -> Yield {
        debug_assert!(unsafe { (*this).state } == OutputTaskState::Done);
        log!("OutputTask(0x{:x}) deinit", this as usize);
        let parent = unsafe { (*this).parent };
        // SAFETY: `this` was Box::into_raw'd in `new`; reclaim and drop.
        drop(unsafe { Box::from_raw(this) });
        P::on_done(interp, parent)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ShellTask (Spec: interpreter.zig `ShellTask`)
// ────────────────────────────────────────────────────────────────────────────

/// Thread-pool task wrapper used by mv/rm/ls/mkdir/touch/cp builtins. Spec:
/// interpreter.zig `ShellTask(Ctx, runFromThreadPool, runFromMainThread, log)`.
///
/// The Zig version is a type-generator over the parent ctx + two fn pointers;
/// here it's a trait the per-builtin task struct implements. The Zig
/// `@fieldParentPtr("task", task)` chain (WorkPoolTask → InnerShellTask → Ctx)
/// is reproduced via `core::mem::offset_of!` in [`ShellTaskCtx::TASK_OFFSET`]
/// + the `#[repr(C)]` first-field guarantee on [`ShellTask::task`].
pub trait ShellTaskCtx: Sized {
    /// Byte offset of the embedded `task: ShellTask` field within `Self`.
    /// Implementors define this as `core::mem::offset_of!(Self, task)`.
    const TASK_OFFSET: usize;
    fn run_from_thread_pool(this: *mut Self);
    fn run_from_main_thread(this: *mut Self, interp: &mut Interpreter);
}

pub type WorkPoolTask = bun_threading::work_pool::Task;

#[repr(C)]
pub struct ShellTask {
    /// Intrusive thread-pool node. MUST be the first field so the
    /// `*mut WorkPoolTask` → `*mut ShellTask` cast in the trampoline is a
    /// no-op (Zig: `@fieldParentPtr("task", task)`).
    pub task: WorkPoolTask,
    pub event_loop: EventLoopHandle,
    pub keep_alive: bun_aio::KeepAlive,
    /// Back-ref to the owning [`Interpreter`]. The Zig original threaded the
    /// interpreter through each builtin's parent-ptr chain; the Rust port uses
    /// a NodeId arena, so the high-tier dispatch (`runtime::dispatch::run_task`)
    /// recovers `&mut Interpreter` from this field instead. Set at
    /// `ShellTask::new`; cleared (raw-ptr) only when the task is freed.
    pub interp: *mut Interpreter,
    // TODO(b2-blocked): bun_jsc::EventLoopTask (concurrent_task).
}

impl ShellTask {
    pub fn new(event_loop: EventLoopHandle) -> Self {
        ShellTask {
            task: WorkPoolTask {
                node: Default::default(),
                // Real callback is installed by `schedule::<C>()`; this only
                // fires if a caller forgets the `<C>` (debug-asserted there).
                callback: shell_task_unset_callback,
            },
            event_loop,
            keep_alive: Default::default(),
            interp: core::ptr::null_mut(),
        }
    }

    /// Spec: interpreter.zig `InnerShellTask.schedule`. Installs the per-`C`
    /// trampoline and hands the intrusive task to the global [`WorkPool`].
    ///
    /// SAFETY: `ctx` must be a live heap allocation that embeds this
    /// `ShellTask` at `C::TASK_OFFSET` and outlives the worker-thread call.
    pub unsafe fn schedule<C: ShellTaskCtx>(ctx: *mut C) {
        use bun_threading::work_pool::WorkPool;
        log!("ShellTask schedule");
        // SAFETY: caller contract — `ctx` embeds `ShellTask` at `TASK_OFFSET`.
        // Stay on raw pointers: once `WorkPool::schedule` returns the worker
        // thread may already be touching `*this`, so we must not hold a live
        // `&mut ShellTask` across that call.
        unsafe {
            let this = (ctx as *mut u8).add(C::TASK_OFFSET) as *mut ShellTask;
            (*this).task.callback = shell_task_trampoline::<C>;
            // TODO(b2-blocked): (*this).keep_alive.ref_((*this).event_loop) —
            // needs the real `bun_jsc::EventLoopHandle`, not the `usize` shim.
            WorkPool::schedule(&raw mut (*this).task);
        }
    }

    pub fn on_finish(&mut self) {
        log!("ShellTask onFinish");
        // TODO(b2-blocked): event_loop.enqueueTaskConcurrent(concurrent_task.from(ctx))
        // — needs bun_jsc::EventLoopTask. Until then the bounce back to the
        // main thread (and thus `run_from_main_thread`) is not wired; builtin
        // state machines that depend on it remain suspended (matching the
        // pre-WorkPool stub behaviour).
    }
}

/// Spec: interpreter.zig `runFromThreadPool` — recover `*Ctx` from the
/// intrusive `*WorkPoolTask`, run the user body, then post back to main.
unsafe fn shell_task_trampoline<C: ShellTaskCtx>(task: *mut WorkPoolTask) {
    // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`.
    let shell_task = task as *mut ShellTask;
    // SAFETY: `ShellTask` is embedded in `C` at `TASK_OFFSET` (Zig:
    // `@fieldParentPtr("task", this)` for the outer hop).
    let ctx = unsafe { (shell_task as *mut u8).sub(C::TASK_OFFSET) as *mut C };
    C::run_from_thread_pool(ctx);
    // PORT NOTE: Zig calls `this.onFinish()` here; the Rust per-builtin
    // `run_from_thread_pool` bodies currently call `task.on_finish()`
    // themselves (pre-WorkPool stub legacy). Leave that as-is until
    // `on_finish` is un-stubbed to avoid a double enqueue.
    let _ = shell_task;
}

#[cold]
unsafe fn shell_task_unset_callback(_: *mut WorkPoolTask) {
    debug_assert!(false, "ShellTask scheduled without schedule::<C>()");
}

#[cold]
#[track_caller]
pub fn unreachable_state(context: &str, state: &str) -> ! {
    panic!(
        "Bun shell has reached an unreachable state \"{}\" in the {} context. This indicates a bug, please open a GitHub issue.",
        state, context
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Gated heavy body
// ────────────────────────────────────────────────────────────────────────────
//
// The remaining ~2400 lines of the original draft (JS-side `init`/`create`,
// `setup_io_before_run`, `run_from_js`, `finalize`, `OutputTask`,
// `ShellAsyncSubprocessDone`, `WriteFailingErrorFmt`, `ShellExecEnv::dupe_for_subshell`,
// the legacy `StatePtrUnion` machinery, etc.) depend on `bun_jsc` method
// surface, `IOWriter::init`, `bun_aio::FilePoll`, and `bun_glob`. The gated
// include was removed (file never materialised); port the remainder inline as
// the upstream pieces land. The NodeId-arena dispatch above supersedes
// `StatePtrUnion`.
//
// TODO(blocked_on: bun_jsc::EventLoopHandle, IOWriter::init, bun_aio::FilePoll,
// bun_glob::GlobWalker): port init/create/setup_io_before_run/run_from_js/
// finalize/OutputTask/ShellAsyncSubprocessDone once those crates are green.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/interpreter.zig (2100 lines)
//   confidence: medium (NodeId-arena scaffolding compiles; JS-side init/finish gated)
//   blocked_on: bun_jsc::{EventLoopHandle, codegen::JSShellInterpreter},
//               IOWriter::init, bun_glob::GlobWalker, ShellExecEnv full body
// ──────────────────────────────────────────────────────────────────────────
