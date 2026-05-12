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

use bun_collections::{ByteVecExt, VecExt};
use bun_core::WTFStringImplExt as _;
use bun_jsc::JsCell;
use bun_ptr::AsCtxPtr;
use core::cell::Cell;
use core::fmt;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use bun_sys::{self, Fd};

pub use crate::shell::env_map::EnvMap;
use crate::shell::io::IO;
use crate::shell::states::assigns::Assigns;
use crate::shell::states::r#async::Async;
use crate::shell::states::base::Base;
use crate::shell::states::binary::Binary;
pub use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::expansion::Expansion;
use crate::shell::states::r#if::If;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::states::script::Script;
use crate::shell::states::stmt::Stmt;
use crate::shell::states::subshell::Subshell;
use crate::shell::yield_::Yield;
use crate::shell::{ShellErr, ast};

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
                    match &self.nodes.get()[id.idx()] {
                        Node::$variant(v) => v,
                        other => panic!(
                            concat!("expected Node::", stringify!($variant), " at {}, got {:?}"),
                            id, other.kind()
                        ),
                    }
                }
                #[inline]
                #[track_caller]
                #[allow(clippy::mut_from_ref)]
                pub fn $get_mut(&self, id: NodeId) -> &mut $ty {
                    // SAFETY: R-2 single-JS-thread invariant — see `nodes_mut`.
                    match unsafe { &mut self.nodes.get_mut()[id.idx()] } {
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
// R-2 (host-fn re-entrancy): every JS-exposed method — and the entire
// state-machine dispatch reachable from `run_from_js` — takes `&self`.
// Per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy) makes
// the noalias-based `&mut self` caching miscompile structurally impossible:
// `finish()` calls `resolve.call(...)` which can synchronously re-enter
// another `ShellInterpreter` host fn (or, via `Yield::run`, another
// interpreter entirely — see `DbgDepthGuard::MAX_DEPTH`). With every field
// behind `UnsafeCell`, an overlapping `&Interpreter` is sound.
//
// The codegen shim still emits `this: &mut Interpreter` until R-2 Phase 1
// lands; `&mut T` auto-derefs to `&T` so the impls below compile against
// either.
pub struct Interpreter {
    /// Flat arena of state-machine nodes. Indices are `NodeId`s; freed slots
    /// are recycled via `free_list`.
    pub nodes: JsCell<Vec<Node>>,
    free_list: JsCell<Vec<u32>>,

    pub event_loop: EventLoopHandle,

    pub args: JsCell<Box<ShellArgs>>,

    /// JS objects used as input for the shell script. Owned storage (the Zig
    /// `ArrayList(JSValue).items` borrow becomes `Vec` ownership in the port —
    /// `create_shell_interpreter` moves the parsed-script's vec in here).
    // TODO(port): GC root — bare JSValue heap storage is invisible to the
    // conservative stack scan. Phase B: switch to MarkedArgumentBuffer or root
    // via wrapper visitChildren.
    pub jsobjs: Vec<crate::jsc::JSValue>,

    pub root_shell: JsCell<ShellExecEnv>,
    pub root_io: JsCell<IO>,

    pub has_pending_activity: AtomicU32,
    pub started: AtomicBool,
    pub keep_alive: JsCell<bun_io::KeepAlive>,

    pub async_commands_executing: Cell<u32>,

    // JSC_BORROW: always borrowed, never owned. Stored raw because the struct
    // is heap-allocated and outlives any single &JSGlobalObject borrow scope.
    pub global_this: Cell<*mut crate::jsc::JSGlobalObject>,

    pub flags: Cell<InterpreterFlags>,
    pub exit_code: Cell<Option<ExitCode>>,
    pub this_jsvalue: Cell<crate::jsc::JSValue>,
    pub cleanup_state: Cell<CleanupState>,
    pub estimated_size_for_gc: Cell<usize>,

    /// Side-channel for `try_()`: lets init/setup paths use `?`-style cleanup
    /// while still surfacing the rich syscall error at the boundary.
    pub last_err: JsCell<Option<bun_sys::Error>>,

    /// Lazily-populated UTF-8 cache for the JS-side argv (`$@`/`$N` expansion
    /// when running under a Worker). See [`Interpreter::get_vm_args_utf8`].
    pub vm_args_utf8: JsCell<Vec<bun_core::ZigStringSlice>>,

    /// `bun run` CLI context for `$N` expansion on the mini event loop.
    /// Null when constructed from JS (no `ContextData` is reachable).
    pub command_ctx: *mut bun_options_types::context::ContextData,
}

#[repr(transparent)]
#[derive(Clone, Copy, Default)]
pub struct InterpreterFlags(u8);
impl InterpreterFlags {
    pub const fn done(self) -> bool {
        self.0 & 0b1 != 0
    }
    pub fn set_done(&mut self, v: bool) {
        if v { self.0 |= 0b1 } else { self.0 &= !0b1 }
    }
    pub const fn quiet(self) -> bool {
        self.0 & 0b10 != 0
    }
    pub fn set_quiet(&mut self, v: bool) {
        if v { self.0 |= 0b10 } else { self.0 &= !0b10 }
    }
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
            script_ast: ast::Script { stmts: &[] },
        })
    }

    #[inline]
    pub fn arena(&self) -> &bun_alloc::Arena {
        &self.__arena
    }

    /// Store the parsed AST root alongside its owning arena. This is the single
    /// self-referential lifetime-erasure point: `script` borrows `self.__arena`
    /// for `'a`, but `ShellArgs` is heap-allocated and the arena is never moved
    /// or dropped while the interpreter (and thus every state node holding
    /// `*const ast::*`) is live. Widening `'a` → `'static` here is therefore
    /// sound — every later dereference happens through raw pointers under
    /// `unsafe`, which is where the real invariant is checked.
    ///
    /// `Interpreter::parse` returns the lifetime-tied `Script<'a>` so callers
    /// that *don't* store (e.g. `TestingAPIs::shell_parse`) get the correct
    /// borrow scope; only callers that move the arena into long-lived storage
    /// route through this helper.
    #[inline]
    pub fn set_script_ast(&mut self, script: bun_shell_parser::ast::Script<'_>) {
        // `ast::Script` is `bun_shell_parser::ast::Script<'static>` — identical
        // type, only the lifetime parameter differs. `self.__arena` owns every
        // node `script.stmts` references and is dropped only when this
        // `ShellArgs` is, so the widened references remain valid for the
        // interpreter's lifetime. Re-construct field-by-field via a slice
        // pointer cast (`Stmt<'a>` and `Stmt<'static>` are layout-identical).
        let stmts = script.stmts;
        // SAFETY: lifetime-only widen; arena outlives `self` (see above).
        let stmts: &'static [ast::Stmt] =
            unsafe { core::slice::from_raw_parts(stmts.as_ptr().cast::<ast::Stmt>(), stmts.len()) };
        self.script_ast = ast::Script { stmts };
    }

    /// Spec: interpreter.zig `ShellArgs.memoryCost`.
    /// PORT NOTE: Zig walks `script_ast.memoryCost()`; the Rust port reports
    /// the arena's `allocated_bytes()` instead (a superset — tokens + strpool
    /// + AST nodes). This is for GC `estimatedSize` reporting only, where
    /// over-approximation is preferable to a tree walk on a lifetime-erased
    /// AST mirror.
    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<ShellArgs>() + self.__arena.allocated_bytes()
    }
}

/// `shell.Result(T)` — Zig's `union(enum) { result: T, err: ShellErr }`.
/// Only used by the construction path (`Interpreter::init`).
pub type ShellResult<T> = Result<T, ShellErr>;

impl Interpreter {
    /// Spec: interpreter.zig `ThisInterpreter.parse` — lex `src` (ASCII or
    /// Unicode), build a `Parser`, and return the root `ast::Script`. Tokens
    /// and AST nodes are bump-allocated into `arena`.
    ///
    /// On lex error, `out_lex_err` is populated and `ParseError::Lex` returned
    /// so the caller can `combineErrors()` for diagnostics; on parse error
    /// `out_parse_err` is populated likewise.
    pub fn parse<'a>(
        arena: &'a bun_alloc::Arena,
        src: &'a [u8],
        jsobjs: &'a mut [crate::jsc::JSValue],
        jsstrings_to_escape: &'a mut [bun_core::String],
        out_parser: &mut Option<bun_shell_parser::Parser<'a>>,
        out_lex_result: &mut Option<bun_shell_parser::LexResult<'a>>,
    ) -> Result<bun_shell_parser::ast::Script<'a>, bun_core::Error> {
        use crate::shell::shell_body::{LexerAscii, LexerUnicode, ParseError, Parser};
        let jsobjs_len = jsobjs.len() as u32;
        let lex_result = if bun_core::is_all_ascii(src) {
            let mut lexer = LexerAscii::new(arena, src, jsstrings_to_escape, jsobjs_len);
            lexer.lex().map_err(|e| bun_core::err!(from e))?;
            lexer.get_result()
        } else {
            let mut lexer = LexerUnicode::new(arena, src, jsstrings_to_escape, jsobjs_len);
            lexer.lex().map_err(|e| bun_core::err!(from e))?;
            lexer.get_result()
        };
        if !lex_result.errors.is_empty() {
            *out_lex_result = Some(lex_result);
            return Err(ParseError::Lex.into());
        }
        // SAFETY: `bun_jsc::JSValue` and `bun_shell_parser::JSValueRaw` are both
        // `#[repr(transparent)]` over `usize` — see the `JSValueRaw` doc in
        // `shell_parser/parse.rs`. Reinterpret in place via a typed pointer cast.
        // Compute `len` before deriving the raw mut pointer so the shared
        // reborrow inside `len()` does not stack on top of the Unique tag.
        let jsobjs_raw: &'a mut [bun_shell_parser::JSValueRaw] = {
            let len = jsobjs.len();
            let ptr = jsobjs.as_mut_ptr().cast::<bun_shell_parser::JSValueRaw>();
            unsafe { core::slice::from_raw_parts_mut(ptr, len) }
        };
        *out_parser = Some(Parser::new(arena, lex_result, jsobjs_raw)?);
        out_parser.as_mut().unwrap().parse()
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
        ctx: *mut bun_options_types::context::ContextData,
        event_loop: EventLoopHandle,
        shargs: Box<ShellArgs>,
        jsobjs: Vec<crate::jsc::JSValue>,
        export_env_: Option<EnvMap>,
        cwd_: Option<&[u8]>,
    ) -> ShellResult<Box<Interpreter>> {
        // ── export_env ─────────────────────────────────────────────────────
        // Zig: on `.js` event loop, take `export_env_` (or empty); on `.mini`,
        // populate from `event_loop.env()` (the loop's `DotEnv::Loader`).
        let export_env = if matches!(event_loop, EventLoopHandle::Js { .. }) {
            export_env_.unwrap_or_else(EnvMap::init)
        } else {
            // SAFETY: `event_loop.env()` returns the `MiniEventLoop`'s
            // `DotEnv::Loader`, which is set by `init_global()` and outlives
            // the interpreter (thread-lifetime singleton).
            let env_loader = unsafe { &mut *event_loop.env() };
            let mut export_env = EnvMap::init_with_capacity(env_loader.map.map.count());
            let mut iter = env_loader.iterator();
            while let Some(entry) = iter.next() {
                let key = crate::shell::EnvStr::init_slice(&entry.key_ptr[..]);
                let value = crate::shell::EnvStr::init_slice(&entry.value_ptr.value[..]);
                export_env.insert(key, value);
            }
            export_env
        };

        // ── cwd / cwd_fd ───────────────────────────────────────────────────
        // Hoisted PathBuffer so the error's borrowed `.path` stays valid until
        // we've converted it to an owned `ShellErr` (Zig hoists for the same
        // reason). Heap-pooled (not stack) per spec — on Windows
        // `MAX_PATH_BYTES` is ~96 KiB and `init` runs from JS-triggered paths
        // that may already be deep on the stack (interpreter.zig:913-914).
        let mut pathbuf = bun_paths::path_buffer_pool::get();
        let cwd_len = match bun_sys::getcwd(&mut pathbuf[..]) {
            Ok(n) => n,
            Err(e) => return Err(ShellErr::new_sys(e)),
        };
        // NUL-terminate for `open()` and so `__cwd` matches Zig's `[:0]` shape
        // (downstream `cwd()` strips the trailing 0).
        pathbuf[cwd_len] = 0;
        let cwd_z = bun_core::ZStr::from_buf(pathbuf.as_slice(), cwd_len);

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
                    bun_core::ZStr::from_static(b"/dev/null\0"),
                    bun_sys::O::RDONLY,
                    0,
                )
            }
            #[cfg(windows)]
            {
                bun_sys::open(bun_core::ZStr::from_static(b"NUL\0"), bun_sys::O::RDONLY, 0)
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
        let interpreter = Box::new(Interpreter {
            nodes: JsCell::new(Vec::new()),
            free_list: JsCell::new(Vec::new()),
            event_loop,
            args: JsCell::new(shargs),
            jsobjs,
            root_shell: JsCell::new(ShellExecEnv {
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
            }),
            root_io: JsCell::new(IO {
                stdin: crate::shell::io::InKind::Fd(stdin_reader),
                // By default stdout/stderr should be IOWriters on dup'd
                // stdout/stderr, but if the user later calls `.setQuiet(true)`
                // that work is wasted. So they start as `.pipe` and `run()`
                // upgrades them via `setup_io_before_run()` if `!quiet`.
                stdout: crate::shell::io::OutKind::Pipe,
                stderr: crate::shell::io::OutKind::Pipe,
            }),
            has_pending_activity: AtomicU32::new(0),
            started: AtomicBool::new(false),
            keep_alive: JsCell::new(bun_io::KeepAlive::default()),
            async_commands_executing: Cell::new(0),
            global_this: Cell::new(core::ptr::null_mut()),
            flags: Cell::new(InterpreterFlags::default()),
            // PORT NOTE — intentional spec-bug fix: Zig declares
            // `exit_code: ?ExitCode = 0` (the *non-null* value 0), so its
            // `asyncCmdDone`'s `exit_code != null` check is always true and
            // can fire `finish(0)` before the root script has actually
            // returned. Rust starts at `None` so `async_cmd_done` only
            // finishes once `on_root_child_done` has recorded the real exit
            // code. The matching Zig fix is tracked upstream.
            exit_code: Cell::new(None),
            this_jsvalue: Cell::new(crate::jsc::JSValue::ZERO),
            cleanup_state: Cell::new(CleanupState::NeedsFullCleanup),
            estimated_size_for_gc: Cell::new(0),
            last_err: JsCell::new(None),
            vm_args_utf8: JsCell::new(Vec::new()),
            command_ctx: ctx,
        });
        // Wire the interpreter backref into root stdin so async poll
        // callbacks can drive `Yield::run`.
        let interp_ptr: *mut Interpreter = Interpreter::as_ctx_ptr(&interpreter);
        if let crate::shell::io::InKind::Fd(ref r) = interpreter.root_io.get().stdin {
            r.set_interp(interp_ptr);
        }

        // ── optional cwd override (Zig `init` tail) ────────────────────────
        if let Some(c) = cwd_ {
            // Spec interpreter.zig:921-930: `root_shell.changeCwdImpl(interp,
            // c, true)`; on failure, deref root_io + deinit root_shell + free.
            // The interpreter parameter is unused (`_` in spec) so we don't
            // pass it (avoids the obvious self-borrow).
            if let Err(e) = interpreter
                .root_shell
                .with_mut(|rs| rs.change_cwd_impl(c, true))
            {
                // Spec: `root_io.deref(); root_shell.deinitImpl(false, true);
                // allocator.destroy(interpreter)`. `deinit_from_exec` performs
                // exactly that teardown (drops `root_io` Arcs, frees env maps,
                // closes `cwd_fd`, consumes the box).
                interpreter.deinit_from_exec();
                return Err(ShellErr::new_sys(e));
            }
        }

        Ok(interpreter)
    }

    /// Spec: interpreter.zig `#deinitFromExec` — full teardown for the
    /// standalone (`MiniEventLoop`) path. Drops root IO refcounts, frees the
    /// root shell env, and consumes the box.
    fn deinit_from_exec(self: Box<Self>) {
        log!("deinit interpreter");
        self.this_jsvalue.set(crate::jsc::JSValue::ZERO);
        // `root_io` holds `Arc<IOReader>`/`Arc<IOWriter>`; replacing with
        // default drops the refs (Zig: `root_io.deref()`).
        self.root_io.set(IO::default());
        // Spec: `root_shell.deinitImpl(false, true)` — free buffered IO, env
        // maps, cwd fd; do NOT free the struct itself (it's embedded).
        self.root_shell.with_mut(|rs| rs.deinit_embedded(true));
        // `vm_args_utf8` slices Drop themselves (ZigStringSlice has a Drop
        // impl that derefs the WTF backing); the Vec frees on box drop.
    }

    /// Spec: interpreter.zig `initAndRunFromFile`.
    ///
    /// Standalone-shell entrypoint for `bun <file>.sh`: parse `src` (already
    /// read by the caller), construct an interpreter on a `MiniEventLoop`,
    /// drive it to completion, and return the exit code. Differs from
    /// `init_and_run_from_source` only in the parse-error diagnostic wording
    /// ("Failed to run <basename>" vs "Failed to run script <name>") and in
    /// not bumping `standalone_shell` analytics.
    pub fn init_and_run_from_file(
        ctx: &mut bun_options_types::context::ContextData,
        mini: &'static mut bun_event_loop::MiniEventLoop::MiniEventLoop<'static>,
        path: &[u8],
        src: &[u8],
    ) -> Result<ExitCode, bun_core::Error> {
        Self::init_and_run_impl(ctx, mini, bun_paths::basename(path), src, None, false)
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
        ctx: &mut bun_options_types::context::ContextData,
        mini: &'static mut bun_event_loop::MiniEventLoop::MiniEventLoop<'static>,
        path_for_errors: &[u8],
        src: &[u8],
        cwd: Option<&[u8]>,
    ) -> Result<ExitCode, bun_core::Error> {
        Self::init_and_run_impl(ctx, mini, path_for_errors, src, cwd, true)
    }

    /// Shared body for `init_and_run_from_file` / `init_and_run_from_source`.
    /// `from_source` gates the analytics bump and the extra "script " word in
    /// the parse-error diagnostic — the only two behavioural deltas between
    /// the two Zig spec functions.
    fn init_and_run_impl(
        ctx: &mut bun_options_types::context::ContextData,
        mini: &'static mut bun_event_loop::MiniEventLoop::MiniEventLoop<'static>,
        label: &[u8],
        src: &[u8],
        cwd: Option<&[u8]>,
        from_source: bool,
    ) -> Result<ExitCode, bun_core::Error> {
        if from_source {
            bun_analytics::features::standalone_shell.fetch_add(1, Ordering::Relaxed);
        }

        let mut shargs = ShellArgs::init();

        // ── parse ──────────────────────────────────────────────────────────
        // `out_parser`/`out_lex_result` borrow `shargs.__arena`, so they're
        // scoped to a block that ends before `shargs.set_script_ast` below.
        let arena_ptr: *const bun_alloc::Arena = shargs.arena();
        let script = {
            // SAFETY: `shargs` lives on this stack frame for the whole block;
            // arena is not moved/dropped while `out_parser`/`out_lex_result`
            // borrow it.
            let arena = unsafe { &*arena_ptr };
            let mut out_parser: Option<bun_shell_parser::Parser<'_>> = None;
            let mut out_lex_result: Option<bun_shell_parser::LexResult<'_>> = None;
            match Self::parse(
                arena,
                src,
                &mut [],
                &mut [],
                &mut out_parser,
                &mut out_lex_result,
            ) {
                Ok(s) => s,
                Err(err) => {
                    let what = if from_source { "script " } else { "" };
                    let errstr: &[u8] = if let Some(lex) = out_lex_result.as_ref() {
                        lex.combine_errors(arena)
                    } else if let Some(p) = out_parser.as_mut() {
                        p.combine_errors()
                    } else {
                        return Err(err);
                    };
                    bun_core::pretty_errorln!(
                        "<r><red>error<r>: Failed to run {}<b>{}<r> due to error <b>{}<r>",
                        what,
                        bstr::BStr::new(label),
                        bstr::BStr::new(errstr),
                    );
                    bun_core::Global::exit(1);
                }
            }
        };
        shargs.set_script_ast(script);

        // ── init ───────────────────────────────────────────────────────────
        let evtloop = EventLoopHandle::init_mini(std::ptr::from_mut(mini));
        let interp = match Self::init(
            std::ptr::from_mut(ctx),
            evtloop,
            shargs,
            Vec::new(),
            None,
            cwd,
        ) {
            Ok(i) => i,
            Err(e) => e.throw_mini(),
        };

        // ── run ────────────────────────────────────────────────────────────
        interp.exit_code.set(Some(1));
        if let Err(e) = interp.run() {
            let name = e.name();
            interp.deinit_from_exec();
            bun_core::output::err(
                name,
                "Failed to run script <b>{}<r>",
                (bstr::BStr::new(label),),
            );
            bun_core::Global::exit(1);
        }

        // ── tick until done ────────────────────────────────────────────────
        // Zig: `mini.tick(&is_done, IsDone.isDone)` where `isDone` reads
        // `interp.flags.done`. The closure captures a raw pointer so borrowck
        // doesn't see an overlap with `tick`'s `&mut self` on `mini`.
        let interp_ptr: *const Interpreter = &raw const *interp;
        mini.tick(core::ptr::null_mut(), |_ctx| {
            // SAFETY: `interp` lives in this stack frame for the whole tick
            // loop; `flags` is `Cell<InterpreterFlags>` (interior-mutable), so
            // the read is sound even while tasks `tick` drains mutate it.
            unsafe { (*interp_ptr).flags.get().done() }
        });

        let code = interp.exit_code.get().expect("exit_code set by finish()");
        interp.deinit_from_exec();
        Ok(code)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// shell_state_dispatch! — single source of truth for the StateKind→handler
// table. Zig (`interpreter.zig:1527 StatePtrUnion`) derives `start`/`next`/
// `childDone` from one `inline for (tags)` over a comptime type tuple; the
// Rust port hand-unrolled that into three parallel 11-arm matches. This
// macro restores the single-table property: each row declares
// `Variant [=> HandlerType]` once and the macro emits `child_done`,
// `next_node`, and `start_node`. Same precedent as `shell_builtins!`
// (Builtin.rs).
//
// PERF(port): expands to the *same* literal `match` arms as the hand-written
// version — direct calls per arm so LLVM inlines the hot states
// (Stmt/Pipeline/Cmd) exactly as Zig's `inline else` did. No vtable, no
// extra indirection.
//
// Invoked once, inside `impl Interpreter` below. `deinit_node` is kept
// hand-rolled for now (irregular Async/Free arms) — see the NOTE there.
macro_rules! shell_state_dispatch {
    // ── internal: tt-munch rows into normalized `(Variant, Handler)` pairs ──
    (@norm [$($done:tt)*] $v:ident => $h:ident , $($rest:tt)*) => {
        shell_state_dispatch!(@norm [$($done)* ($v, $h)] $($rest)*);
    };
    (@norm [$($done:tt)*] $v:ident , $($rest:tt)*) => {
        shell_state_dispatch!(@norm [$($done)* ($v, $v)] $($rest)*);
    };
    // ── internal: emit the three dispatch fns from the normalized table ──
    (@norm [ $( ($v:ident, $h:ident) )+ ]) => {
        /// Signal to `parent` that `child` finished with `exit_code`. This is the
        /// single hoisted `match` that replaces every per-state
        /// `parent.childDone(this, exit)` call in Zig.
        pub fn child_done(&self, parent: NodeId, child: NodeId, exit_code: ExitCode) -> Yield {
            if parent == NodeId::INTERPRETER {
                return self.on_root_child_done(child, exit_code);
            }
            match self.nodes.get()[parent.idx()].kind() {
                $( StateKind::$v => $h::child_done(self, parent, child, exit_code), )+
                StateKind::Free => unreachable!("child_done on freed {}", parent),
            }
        }

        /// Advance node `id` by one step. The trampoline (`Yield::run`) calls
        /// this; replaces the per-variant `&mut State` dispatch in Yield.
        pub fn next_node(&self, id: NodeId) -> Yield {
            match self.nodes.get()[id.idx()].kind() {
                $( StateKind::$v => $h::next(self, id), )+
                StateKind::Free => unreachable!("next on freed {}", id),
            }
        }

        /// Start node `id`. Most states return `Yield::<Kind>(id)` immediately;
        /// the trampoline then calls `next_node`.
        pub fn start_node(&self, id: NodeId) -> Yield {
            match self.nodes.get()[id.idx()].kind() {
                $( StateKind::$v => $h::start(self, id), )+
                StateKind::Free => unreachable!("start on freed {}", id),
            }
        }
    };
    // ── public entry (first token must be an ident, so `@norm` recursion never lands here) ──
    ( $first:ident $($rest:tt)* ) => {
        shell_state_dispatch!(@norm [] $first $($rest)*);
    };
}

impl Interpreter {
    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// `&self` → `*mut Self` for ctx slots. Kept inherent (NOT via the
    /// `bun_ptr::AsCtxPtr` blanket trait) so `Box<Interpreter>` callers
    /// auto-deref to `&Interpreter` and get `*mut Interpreter`, not
    /// `*mut Box<Interpreter>`.
    #[inline]
    pub fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    /// Read-modify-write the packed `Cell<InterpreterFlags>` through `&self`.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut InterpreterFlags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// Mutable projection of the node arena from `&self`.
    ///
    /// # Safety
    /// R-2 single-JS-thread invariant: the state machine never holds two
    /// `&mut` into `nodes` simultaneously (borrowck previously enforced this
    /// via `&mut Interpreter`; that discipline is preserved at every call
    /// site). Do **not** hold the returned borrow across any call that may
    /// reach `finish()`/`throw()` (the only paths that re-enter JS).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    unsafe fn nodes_mut(&self) -> &mut Vec<Node> {
        // SAFETY: forwarded to caller — see fn-level contract.
        unsafe { self.nodes.get_mut() }
    }

    // ── arena management ───────────────────────────────────────────────────

    /// Allocate a fresh slot in the node arena and return its id. Replaces
    /// Zig's `parent.create(T)` (which heap-allocated via the parent's
    /// allocator). Reuses freed slots when available.
    pub fn alloc_node(&self, node: Node) -> NodeId {
        if let Some(slot) = self.free_list.with_mut(|f| f.pop()) {
            // SAFETY: no other borrow of `nodes` is live across this store.
            unsafe { self.nodes_mut()[slot as usize] = node };
            return NodeId(slot);
        }
        self.nodes.with_mut(|n| {
            let id = NodeId(n.len() as u32);
            n.push(node);
            id
        })
    }

    /// Free a slot. Replaces Zig's `parent.destroy(this)`. The node's own
    /// `deinit` (which closes IO, derefs the shell env, etc.) must run first;
    /// this only recycles the storage.
    pub fn free_node(&self, id: NodeId) {
        // Guard: callers may have stored `NodeId::NONE` in `currently_executing`
        // when `spawn_expr` failed (Subshell init error path). Spec never
        // touches `currently_executing` on that path, so the later
        // `deinit_node`/`free_node` is a no-op there too.
        if id == NodeId::NONE || id == NodeId::INTERPRETER {
            return;
        }
        self.nodes.with_mut(|n| {
            debug_assert!(!matches!(n[id.idx()], Node::Free), "double-free of {}", id);
            n[id.idx()] = Node::Free;
        });
        self.free_list.with_mut(|f| f.push(id.0));
    }

    #[inline]
    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes.get()[id.idx()]
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn node_mut(&self, id: NodeId) -> &mut Node {
        // SAFETY: see `nodes_mut` — single-JS-thread, no overlapping borrow.
        unsafe { &mut self.nodes_mut()[id.idx()] }
    }

    /// Look up the `parent` field of any state node. (Replaces
    /// `StatePtrUnion.ptr.is::<T>()` checks.)
    #[inline]
    pub fn parent_of(&self, id: NodeId) -> NodeId {
        self.nodes.get()[id.idx()]
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
        self.nodes.get()[id.idx()].kind()
    }

    /// Shell exec env for the node at `id` (or the root env if `id` is the
    /// interpreter sentinel).
    #[inline]
    pub fn shell_env(&self, id: NodeId) -> *mut ShellExecEnv {
        if id == NodeId::INTERPRETER {
            return self.root_shell.as_ptr();
        }
        self.nodes.get()[id.idx()]
            .base()
            .map(|b| b.shell)
            .unwrap_or(self.root_shell.as_ptr())
    }

    // ── hoisted dispatch (PORTING.md §Dispatch hot-path) ───────────────────

    shell_state_dispatch! {
        Script,
        Stmt,
        Binary,
        Pipeline,
        Cmd,
        Assign   => Assigns,
        Expansion,
        IfClause => If,
        Condexpr => CondExpr,
        Async,
        Subshell,
    }

    /// Init + start a child state node for an `ast::Expr`. Replaces the
    /// per-variant `match` Zig inlines at each callsite (Stmt.zig:64-112,
    /// Binary.zig:64-112). For `.subshell`, dupes the parent shell env first
    /// (Zig `Subshell.initDupeShellState`); all other variants borrow `shell`.
    ///
    /// Note: `Async` must NOT call this — Async.zig restricts its child to
    /// pipeline/cmd/if/condexpr and inits without starting (see `Async::next`).
    pub fn spawn_expr(
        &self,
        shell: *mut ShellExecEnv,
        expr: &ast::Expr,
        parent: NodeId,
        io: IO,
    ) -> (Option<NodeId>, Yield) {
        let child = match expr {
            ast::Expr::Cmd(c) => Cmd::init(self, shell, *c, parent, io),
            ast::Expr::Binary(b) => Binary::init(self, shell, *b, parent, io),
            ast::Expr::Pipeline(p) => Pipeline::init(self, shell, *p, parent, io),
            ast::Expr::Assign(a) => Assigns::init(self, shell, *a, parent, AssignCtx::Shell, io),
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
                        self.throw(ShellErr::new_sys(e));
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
    pub fn deinit_node(&self, id: NodeId) {
        // Guard the `NodeId::NONE` sentinel: `spawn_expr` returns it on
        // Subshell init failure, and Stmt/Binary `currently_executing` may
        // hold it. Indexing `nodes[u32::MAX-1]` would be OOB.
        if id == NodeId::NONE || id == NodeId::INTERPRETER {
            return;
        }
        // NOTE: keep in sync with shell_state_dispatch! table (irregular Async/Free arms keep this hand-rolled for v1).
        match self.nodes.get()[id.idx()].kind() {
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

    fn on_root_child_done(&self, child: NodeId, exit_code: ExitCode) -> Yield {
        // Only `Script` can be a direct child of the interpreter.
        debug_assert!(matches!(self.nodes.get()[child.idx()], Node::Script(_)));
        log!("Interpreter script finish {}", exit_code);
        Script::deinit_from_interpreter(self, child);
        self.free_node(child);
        self.exit_code.set(Some(exit_code));
        if self.async_commands_executing.get() == 0 {
            return self.finish(exit_code);
        }
        Yield::suspended()
    }

    pub fn async_cmd_done(&self, async_id: NodeId) {
        Async::actually_deinit(self, async_id);
        self.free_node(async_id);
        self.async_commands_executing
            .set(self.async_commands_executing.get() - 1);
        if self.async_commands_executing.get() == 0 {
            if let Some(exit) = self.exit_code.get() {
                self.finish(exit).run(self);
            }
        }
    }

    // ── error side-channel (Base::try_) ────────────────────────────────────

    /// Unwrap a `Maybe(T)` into `Result<T, TryError>`, stashing the rich
    /// syscall error on the interpreter for later retrieval.
    #[inline]
    pub fn try_<T>(
        &self,
        m: bun_sys::Result<T>,
    ) -> Result<T, crate::shell::states::base::TryError> {
        match m {
            Ok(v) => Ok(v),
            Err(e) => {
                self.last_err.set(Some(e));
                Err(crate::shell::states::base::TryError::Sys)
            }
        }
    }

    #[inline]
    pub fn take_err(&self) -> bun_sys::Error {
        self.last_err
            .with_mut(|e| e.take())
            .expect("take_err() with no stashed error")
    }

    #[inline]
    pub fn root_io(&self) -> &IO {
        self.root_io.get()
    }

    /// Spec: interpreter.zig `#computeEstimatedSizeForGC` (interpreter.zig:752).
    pub fn compute_estimated_size_for_gc(&self) -> usize {
        let mut size = core::mem::size_of::<Interpreter>();
        size += self.args.get().memory_cost();
        size += self.root_shell.get().memory_cost();
        size += self.root_io.get().memory_cost();
        size += self.jsobjs.len() * core::mem::size_of::<crate::jsc::JSValue>();
        let vm_args = self.vm_args_utf8.get();
        for arg in vm_args {
            size += arg.slice().len();
        }
        size += vm_args.capacity() * core::mem::size_of::<bun_core::ZigStringSlice>();
        size
    }

    /// Spec: interpreter.zig `memoryCost`.
    pub fn memory_cost(&self) -> usize {
        self.compute_estimated_size_for_gc()
    }

    /// Spec: interpreter.zig `estimatedSize`. Codegen-called accessor.
    pub fn estimated_size(&self) -> usize {
        self.estimated_size_for_gc.get()
    }

    /// Safe accessor for the set-once `global_this: Cell<*mut JSGlobalObject>`
    /// backref. `None` on the mini-event-loop path (never set); `Some` once
    /// `create_shell_interpreter` populates it. Single `unsafe` deref site —
    /// callers (`throw`, `finish_internal`) read through this instead of
    /// open-coding the raw `&*self.global_this.get()` deref.
    #[inline]
    pub fn global_this_ref(&self) -> Option<&crate::jsc::JSGlobalObject> {
        let g = self.global_this.get();
        if g.is_null() {
            return None;
        }
        // `JSGlobalObject` is an `opaque_ffi!` ZST — `opaque_ref` is the safe
        // deref. `global_this` is set exactly once by `create_shell_interpreter`
        // from a live `&JSGlobalObject`; the global is process-lifetime.
        Some(crate::jsc::JSGlobalObject::opaque_ref(g))
    }

    /// Spec: interpreter.zig `throwShellErr(err, event_loop)` — `mini` prints
    /// and exits(1); `js` raises a JS exception. Dispatch on `global_this`
    /// (set only on the JS event-loop path by `create_shell_interpreter`).
    pub fn throw(&self, err: ShellErr) {
        let Some(global) = self.global_this_ref() else {
            // Mini event loop — diverges (exit 1).
            err.throw_mini();
        };
        let _ = err.throw_js(global);
    }

    // ── run loop ───────────────────────────────────────────────────────────

    /// Spec: interpreter.zig `setupIOBeforeRun` + `setupIOBeforeRunImpl`
    /// (interpreter.zig:1177-1223). When `!quiet`, dup stdout/stderr (or open
    /// the null device if the process was started with that stream closed),
    /// wrap each in an `IOWriter`, and install them as `root_io.stdout/stderr`
    /// so command output reaches the terminal. On the JS event loop the
    /// `captured` slot is also wired to `_buffered_stdout/err` so
    /// `Bun.$` callers can read it back.
    fn setup_io_before_run(&self) -> bun_sys::Result<()> {
        if self.flags.get().quiet() {
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

        let interp_ptr: *mut Interpreter = self.as_ctx_ptr();
        let stdout_writer = IOWriter::init(
            stdout_fd,
            crate::shell::io_writer::Flags {
                pollable: is_pollable(stdout_fd),
                ..Default::default()
            },
            event_loop,
        );
        stdout_writer.set_interp(interp_ptr);
        let stderr_writer = IOWriter::init(
            stderr_fd,
            crate::shell::io_writer::Flags {
                pollable: is_pollable(stderr_fd),
                ..Default::default()
            },
            event_loop,
        );
        stderr_writer.set_interp(interp_ptr);

        // Spec: `if (event_loop == .js)` — hook captured buffers so the JS
        // `Bun.$` API can read stdout/stderr after completion. The mini path
        // does not capture (it writes straight to the dup'd fd).
        let (cap_out, cap_err) = if matches!(event_loop, EventLoopHandle::Js { .. }) {
            self.root_shell
                .with_mut(|rs| (Some(rs.buffered_stdout()), Some(rs.buffered_stderr())))
        } else {
            (None, None)
        };

        self.root_io.with_mut(|io| {
            io.stdout = crate::shell::io::OutKind::Fd(crate::shell::io::OutFd {
                writer: stdout_writer,
                captured: cap_out,
            });
            io.stderr = crate::shell::io::OutKind::Fd(crate::shell::io::OutFd {
                writer: stderr_writer,
                captured: cap_err,
            });
        });

        Ok(())
    }

    pub fn run(&self) -> bun_sys::Result<()> {
        log!("Interpreter(0x{:x}) run", std::ptr::from_ref(self) as usize);
        if let Err(e) = self.setup_io_before_run() {
            return Err(e);
        }

        let shell = self.root_shell.as_ptr();
        let ast = &raw const self.args.get().script_ast;
        let io = self.root_io.get().clone();
        let root = Script::init(self, shell, ast, NodeId::INTERPRETER, io);
        self.started.store(true, Ordering::SeqCst);
        Script::start(self, root).run(self);
        Ok(())
    }

    pub fn finish(&self, exit_code: ExitCode) -> Yield {
        use crate::jsc::JSValue;
        use crate::jsc::generated::JSShellInterpreter;

        log!(
            "Interpreter(0x{:x}) finish {}",
            std::ptr::from_ref(self) as usize,
            exit_code
        );
        // Spec interpreter.zig:1289 — `defer decrPendingActivityFlag(...)`
        // unconditionally. Paired with the increment in `run_from_js`; harmless
        // wrap on the mini path (flag is only read from the JS GC
        // `hasPendingActivity()` hook).
        // R-2: `&self` lets the guard borrow the atomic directly — no raw-ptr
        // dance needed (the previous reshape existed only for `&mut self`).
        struct DecrOnDrop<'a>(&'a AtomicU32);
        impl Drop for DecrOnDrop<'_> {
            fn drop(&mut self) {
                Interpreter::decr_pending_activity_flag(self.0);
            }
        }
        let _decr = DecrOnDrop(&self.has_pending_activity);

        if matches!(self.event_loop, EventLoopHandle::Js { .. }) {
            self.exit_code.set(Some(exit_code));
            let this_jsvalue = self.this_jsvalue.get();
            if this_jsvalue != JSValue::ZERO {
                if let Some(resolve) = JSShellInterpreter::resolve_get_cached(this_jsvalue) {
                    let loop_ = self.event_loop;
                    // `global_this` is `Some` on the `EventLoopHandle::Js` path
                    // (set by `create_shell_interpreter`); see `global_this_ref`.
                    let global_this = self
                        .global_this_ref()
                        .expect("global_this set on Js event-loop path");
                    let buffered_stdout = self.get_buffered_stdout(global_this);
                    let buffered_stderr = self.get_buffered_stderr(global_this);
                    self.keep_alive.with_mut(|k| k.disable());
                    self.deref_root_shell_and_io_if_needed(true);
                    let _entered = loop_.entered();
                    if let Err(err) = resolve.call(
                        global_this,
                        JSValue::UNDEFINED,
                        &[
                            JSValue::js_number_from_int32(i32::from(exit_code)),
                            buffered_stdout,
                            buffered_stderr,
                        ],
                    ) {
                        global_this.report_active_exception_as_unhandled(err);
                    }
                    JSShellInterpreter::resolve_set_cached(
                        this_jsvalue,
                        global_this,
                        JSValue::UNDEFINED,
                    );
                    JSShellInterpreter::reject_set_cached(
                        this_jsvalue,
                        global_this,
                        JSValue::UNDEFINED,
                    );
                }
            }
        } else {
            self.update_flags(|f| f.set_done(true));
            self.exit_code.set(Some(exit_code));
        }

        Yield::done()
    }

    /// Spec: interpreter.zig `runFromJS`. JS-host entrypoint — sets up root IO
    /// (unless quiet), spawns the root `Script` node, and starts ticking.
    pub fn run_from_js(
        &self,
        global_this: &crate::jsc::JSGlobalObject,
        _callframe: &crate::jsc::CallFrame,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        log!(
            "Interpreter(0x{:x}) runFromJS",
            std::ptr::from_ref(self) as usize
        );

        if let Err(e) = self.setup_io_before_run() {
            self.deref_root_shell_and_io_if_needed(true);
            let shellerr = ShellErr::new_sys(e);
            return Err(throw_shell_err(
                shellerr,
                self.event_loop,
                Some(global_this),
            ));
        }
        Self::incr_pending_activity_flag(&self.has_pending_activity);

        let shell = self.root_shell.as_ptr();
        let ast = &raw const self.args.get().script_ast;
        let io = self.root_io.get().clone();
        let root = Script::init(self, shell, ast, NodeId::INTERPRETER, io);
        self.started.store(true, Ordering::SeqCst);
        Script::start(self, root).run(self);
        if global_this.has_exception() {
            return Err(crate::jsc::JsError::Thrown);
        }

        Ok(crate::jsc::JSValue::UNDEFINED)
    }

    /// Spec: interpreter.zig `#derefRootShellAndIOIfNeeded`. Idempotent
    /// teardown of `root_io`/`root_shell` for the JS event-loop path; called
    /// from `finish()` (success) and `run_from_js()` (early error). Guards on
    /// `cleanup_state` so a later `finalize()` doesn't double-free.
    fn deref_root_shell_and_io_if_needed(&self, free_buffered_io: bool) {
        if self.cleanup_state.get() == CleanupState::RuntimeCleaned {
            return;
        }

        if free_buffered_io {
            // Can safely be called multiple times.
            self.root_shell.with_mut(|rs| {
                if let Bufio::Owned(o) = &mut rs._buffered_stderr {
                    o.clear_and_free();
                }
                if let Bufio::Owned(o) = &mut rs._buffered_stdout {
                    o.clear_and_free();
                }
            });
        }

        // Has this already been finalized?
        if self.this_jsvalue.get() != crate::jsc::JSValue::ZERO {
            // Cannot be safely called multiple times.
            // `root_io` holds `Arc<IOReader>`/`Arc<IOWriter>`; replacing with
            // default drops the refs (Zig: `root_io.deref()`).
            self.root_io.set(IO::default());
            self.root_shell.with_mut(|rs| rs.deinit_embedded(false));
        }

        // PORT NOTE: free the parse arena eagerly. Zig's `args.__arena` is a
        // lightweight `std.heap.ArenaAllocator` (a few KB), so leaving it for
        // the GC finalizer is fine there. The Rust port's `bun_alloc::Arena` is
        // a `MimallocArena` (a full `mi_heap_t`): every shell parse pulls
        // several fresh 64 KiB pages, and with `MI_DEBUG=3` each page-init
        // runs `mi_assert_expensive(mi_mem_is_zero(page, 64 KiB))`. Under the
        // shell-load.test.ts fixture (30 000 back-to-back `$\`...\`` calls)
        // those pages are held until JSC finalizes the wrapper, so RSS grows
        // ~220 KiB per pending interpreter and >50 % of CPU is spent
        // re-scanning freshly-mmap'd zero pages. Resetting here returns the
        // pages to mimalloc's pool immediately so subsequent parses reuse them
        // (`memid.initially_zero == false` → the expensive scan is skipped)
        // and memory stays flat. The new heap created by `reset()` allocates
        // no pages until first use, so the per-interpreter footprint left for
        // the finalizer is just the bare `mi_heap_t`. `script_ast` is cleared
        // first because every node it references lives in the arena being
        // destroyed; nothing dereferences it after this point (the only
        // remaining reader is `memory_cost()`, which queries
        // `__arena.allocated_bytes()` and never touches the AST).
        self.args.with_mut(|a| {
            a.script_ast = ast::Script { stmts: &[] };
            a.__arena.reset();
        });

        self.this_jsvalue.set(crate::jsc::JSValue::ZERO);
        self.cleanup_state.set(CleanupState::RuntimeCleaned);
    }

    /// Spec: interpreter.zig `deinitFromFinalizer`. GC finalizer body — runs
    /// whatever teardown `finish()` didn't, then frees the box.
    ///
    /// # Safety
    /// `this` must be the `heap::alloc`'d pointer stored in the JS wrapper's
    /// `m_ctx`; called exactly once from the GC thread's finalizer.
    pub unsafe fn deinit_from_finalizer(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live `heap::alloc` payload.
        let this = unsafe { bun_core::heap::take(this) };
        log!(
            "Interpreter(0x{:x}) deinitFromFinalizer (cleanup_state={})",
            &raw const *this as usize,
            <&'static str>::from(this.cleanup_state.get()),
        );

        match this.cleanup_state.get() {
            CleanupState::NeedsFullCleanup => {
                // The interpreter never finished normally (e.g. early error or
                // never started), so we need to clean up IO and shell env here.
                this.root_io.set(IO::default());
                this.root_shell.with_mut(|rs| rs.deinit_embedded(true));
            }
            CleanupState::RuntimeCleaned => {
                // `finish()` already cleaned up via
                // `deref_root_shell_and_io_if_needed`; nothing more for those.
            }
        }

        this.keep_alive.with_mut(|k| k.disable());
        // `args: Box<ShellArgs>` and `vm_args_utf8: Vec<ZigStringSlice>` drop
        // with the box; `ZigStringSlice` has a `Drop` impl that derefs its
        // WTF backing (Zig: per-item `str.deinit()` + list deinit).
    }

    /// Spec: interpreter.zig `setQuiet` — JS `interp.setQuiet()`.
    pub fn set_quiet(
        &self,
        _: &crate::jsc::JSGlobalObject,
        _: &crate::jsc::CallFrame,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        log!(
            "Interpreter(0x{:x}) setQuiet()",
            std::ptr::from_ref(self) as usize
        );
        self.update_flags(|f| f.set_quiet(true));
        Ok(crate::jsc::JSValue::UNDEFINED)
    }

    /// Spec: interpreter.zig `setCwd` — JS `interp.setCwd(path)`.
    pub fn set_cwd(
        &self,
        global_this: &crate::jsc::JSGlobalObject,
        callframe: &crate::jsc::CallFrame,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        let value = callframe.argument(0);
        let str = crate::jsc::bun_string_jsc::from_js(value, global_this)?;
        let slice = str.to_utf8();
        let result = self.root_shell.with_mut(|rs| rs.change_cwd(slice.slice()));
        drop(slice);
        str.deref();
        if let Err(e) = result {
            use bun_sys_jsc::SystemErrorJsc as _;
            return Err(
                global_this.throw_value(e.to_shell_system_error().to_error_instance(global_this))
            );
        }
        Ok(crate::jsc::JSValue::UNDEFINED)
    }

    /// Spec: interpreter.zig `setEnv` — JS `interp.setEnv({ FOO: "bar" })`.
    pub fn set_env(
        &self,
        global_this: &crate::jsc::JSGlobalObject,
        callframe: &crate::jsc::CallFrame,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        use crate::jsc::{JSPropertyIterator, JSPropertyIteratorOptions};
        use crate::shell::env_str::EnvStr;

        let value1 = callframe.argument(0);
        if !value1.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!("env must be an object")));
        }

        let mut object_iter = JSPropertyIterator::init(
            global_this,
            value1.to_object(global_this)?,
            JSPropertyIteratorOptions::new(false, true),
        )?;

        self.root_shell.with_mut(|rs| {
            rs.export_env.clear_retaining_capacity();
            rs.export_env.ensure_total_capacity(object_iter.len);
        });

        // If the env object does not include a $PATH, it must disable path
        // lookup for argv[0].

        while let Some(key) = object_iter.next()? {
            let value = object_iter.value;
            if value.is_undefined() {
                continue;
            }
            let keyslice = key.to_owned_slice();
            let value_str = value.get_zig_string(global_this)?;
            let slice = value_str.to_owned_slice();
            // PORT NOTE: Zig `initRefCounted` adopts the slice; the Rust
            // `init_ref_counted` dups (see EnvStr.rs TODO), so the `Vec`s drop
            // here without leaking. Phase B revisits the ownership contract.
            let keyref = EnvStr::init_ref_counted(&keyslice);
            let valueref = EnvStr::init_ref_counted(&slice);
            self.root_shell
                .with_mut(|rs| rs.export_env.insert(keyref, valueref));
            keyref.deref();
            valueref.deref();
        }

        Ok(crate::jsc::JSValue::UNDEFINED)
    }

    /// Spec: interpreter.zig `isRunning`.
    pub fn is_running(
        &self,
        _: &crate::jsc::JSGlobalObject,
        _: &crate::jsc::CallFrame,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        Ok(crate::jsc::JSValue::js_boolean(self.has_pending_activity()))
    }

    /// Spec: interpreter.zig `getStarted`.
    pub fn get_started(
        &self,
        _: &crate::jsc::JSGlobalObject,
        _: &crate::jsc::CallFrame,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        Ok(crate::jsc::JSValue::js_boolean(
            self.started.load(Ordering::SeqCst),
        ))
    }

    /// Spec: interpreter.zig `getBufferedStdout`.
    pub fn get_buffered_stdout(
        &self,
        global_this: &crate::jsc::JSGlobalObject,
    ) -> crate::jsc::JSValue {
        io_to_js_value(
            global_this,
            self.root_shell.with_mut(|rs| rs.buffered_stdout()),
        )
    }

    /// Spec: interpreter.zig `getBufferedStderr`.
    pub fn get_buffered_stderr(
        &self,
        global_this: &crate::jsc::JSGlobalObject,
    ) -> crate::jsc::JSValue {
        io_to_js_value(
            global_this,
            self.root_shell.with_mut(|rs| rs.buffered_stderr()),
        )
    }

    /// Spec: interpreter.zig `finalize`. GC finalizer hook — called from the
    /// generated C++ `JSShellInterpreter::~JSShellInterpreter` via
    /// `host_fn::host_fn_finalize`.
    pub fn finalize(self: Box<Self>) {
        log!("Interpreter(0x{:x}) finalize", &raw const *self as usize);
        // See [`deinit_from_finalizer`](Self::deinit_from_finalizer).
        // SAFETY: `self` is the unique GC-owned `m_ctx` payload; round-trip via
        // raw ptr so `deinit_from_finalizer` can `heap::take` it.
        unsafe { Self::deinit_from_finalizer(Box::into_raw(self)) };
    }

    /// Spec: interpreter.zig `hasPendingActivity`. GC `hasPendingActivity()`.
    pub fn has_pending_activity(&self) -> bool {
        self.has_pending_activity.load(Ordering::SeqCst) > 0
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

    /// Spec: interpreter.zig `getVmArgsUtf8`. Lazily caches the worker's
    /// `argv` as UTF-8 slices so `$@`/`$N` expansion (Expansion.zig) can index
    /// without re-converting on every reference.
    pub fn get_vm_args_utf8(&self, argv: &[bun_core::WTFStringImpl], idx: u8) -> &[u8] {
        self.vm_args_utf8.with_mut(|v| {
            if v.len() != argv.len() {
                v.reserve(argv.len());
                for arg in argv {
                    // SAFETY: each `WTFStringImpl` in `argv` is a live
                    // `*WTF::StringImpl` borrowed from `worker.argv`.
                    v.push(unsafe { (**arg).to_utf8() });
                }
            }
        });
        self.vm_args_utf8.get()[idx as usize].slice()
    }

    /// Spec: Expansion.zig `expandVarArgv`. Appends the value of `$N` to
    /// `out`. Takes the relevant interpreter fields by-part so callers can
    /// split-borrow alongside the node arena.
    pub fn append_var_argv(
        out: &mut Vec<u8>,
        original_int: u8,
        event_loop: EventLoopHandle,
        command_ctx: *mut bun_options_types::context::ContextData,
        vm_args_utf8: &mut Vec<bun_core::ZigStringSlice>,
    ) {
        let mut int = original_int;
        match event_loop {
            EventLoopHandle::Js { .. } => {
                if int == 0 {
                    if let Ok(p) = bun_core::self_exe_path() {
                        out.extend_from_slice(p.as_bytes());
                    }
                    return;
                }
                int -= 1;

                let vm_ptr = event_loop
                    .bun_vm()
                    .cast::<bun_jsc::virtual_machine::VirtualMachine>();
                if vm_ptr.is_null() {
                    return;
                }
                // SAFETY: `bun_vm()` on a JS event loop returns the live
                // `*VirtualMachine` owning that loop.
                let vm = unsafe { &*vm_ptr };
                let main = vm.main();
                if !main.is_empty() {
                    if int == 0 {
                        out.extend_from_slice(main);
                        return;
                    }
                    int -= 1;
                }

                if let Some(worker_ptr) = vm.worker {
                    // SAFETY: `vm.worker` is set in `VirtualMachine::initWorker`
                    // to a live `*WebWorker` for the worker's lifetime.
                    let worker = unsafe { &*worker_ptr.cast::<bun_jsc::web_worker::WebWorker>() };
                    let argv = worker.argv();
                    if int as usize >= argv.len() {
                        return;
                    }
                    if vm_args_utf8.len() != argv.len() {
                        vm_args_utf8.reserve(argv.len());
                        for arg in argv {
                            // SAFETY: each `WTFStringImpl` in `argv` is a live
                            // `*WTF::StringImpl` borrowed from `worker.argv`.
                            vm_args_utf8.push(unsafe { (**arg).to_utf8() });
                        }
                    }
                    out.extend_from_slice(vm_args_utf8[int as usize].slice());
                    return;
                }

                if (int as usize) < vm.argv.len() {
                    out.extend_from_slice(&vm.argv[int as usize]);
                }
            }
            EventLoopHandle::Mini(_) => {
                if command_ctx.is_null() {
                    return;
                }
                // SAFETY: `command_ctx` is the process-global `ContextData`
                // (see `init`); it outlives the interpreter.
                let ctx = unsafe { &*command_ctx };
                if int as usize >= 1 + ctx.passthrough.len() {
                    return;
                }
                if int == 0 {
                    if let Some(last) = ctx.positionals.last() {
                        out.extend_from_slice(last);
                    }
                    return;
                }
                out.extend_from_slice(&ctx.passthrough[int as usize - 1]);
            }
        }
    }
}

/// Spec: interpreter.zig `ioToJSValue`. Moves the captured stdout/stderr
/// `Vec<u8>` into a JS `Buffer` (ownership transfers to JSC's deallocator)
/// and resets the source to empty.
fn io_to_js_value(
    global_this: &crate::jsc::JSGlobalObject,
    buf: *mut Vec<u8>,
) -> crate::jsc::JSValue {
    // SAFETY: `buf` points into a live `ShellExecEnv` (root or borrowed).
    let bytelist = core::mem::take(unsafe { &mut *buf });
    // PORT NOTE: Zig wraps in `jsc.Node.Buffer{ .buffer = ArrayBuffer.fromBytes
    // (..., .Uint8Array) }.toNodeBuffer(global)`. `MarkedArrayBuffer::
    // to_node_buffer` is the same `JSBuffer__bufferFromPointerAndLengthAndDeinit`
    // call; we hand it the moved-out `Vec<u8>` storage directly. The
    // `Vec<u8>` value itself is `mem::forget`-ed since JSC now owns the bytes.
    let mut bytelist = core::mem::ManuallyDrop::new(bytelist);
    crate::jsc::JSValue::create_buffer(global_this, bytelist.slice_mut())
}

/// Spec: interpreter.zig `throwShellErr(e, event_loop)`. On the mini event
/// loop this prints to stderr and `exit(1)`s (diverges); on the JS event loop
/// it raises a JS exception via [`ShellErr::throw_js`] and returns
/// `JsError::Thrown`.
// PORT NOTE: takes ownership (Zig passed `*const ShellErr` because both arms
// consume; Rust expresses that as by-value). `global` is `Option` because the
// mini arm has no global; on the JS arm callers always pass `Some`.
pub fn throw_shell_err(
    e: ShellErr,
    event_loop: EventLoopHandle,
    global: Option<&crate::jsc::JSGlobalObject>,
) -> crate::jsc::JsError {
    match event_loop {
        EventLoopHandle::Mini(_) => e.throw_mini(),
        EventLoopHandle::Js { .. } => {
            e.throw_js(global.expect("JS event loop requires a JSGlobalObject"))
        }
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
    Owned(Vec<u8>),
    Borrowed(*mut Vec<u8>),
}

impl Default for Bufio {
    fn default() -> Self {
        Bufio::Owned(Vec::<u8>::default())
    }
}

impl Bufio {
    /// Spec: interpreter.zig `Bufio.memoryCost` (interpreter.zig:429).
    pub fn memory_cost(&self) -> usize {
        match self {
            Bufio::Owned(o) => o.memory_cost(),
            // SAFETY: borrowed buffer points into a live parent `ShellExecEnv`
            // (set by `dupe_for_subshell`); the parent outlives the child.
            Bufio::Borrowed(b) => unsafe { (**b).memory_cost() },
        }
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
    /// Spec: interpreter.zig `ShellExecEnv.memoryCost` (interpreter.zig:449).
    pub fn memory_cost(&self) -> usize {
        let mut size = core::mem::size_of::<ShellExecEnv>();
        size += self.shell_env.memory_cost();
        size += self.cmd_local_env.memory_cost();
        size += self.export_env.memory_cost();
        size += self.__cwd.capacity();
        size += self.__prev_cwd.capacity();
        size += self._buffered_stderr.memory_cost();
        size += self._buffered_stdout.memory_cost();
        // PORT NOTE: Zig `async_pids.memoryCost()` walks the SmolList; the
        // Rust shim is `Vec`, so report its heap capacity directly.
        size += self.async_pids.capacity() * core::mem::size_of::<PidT>();
        size
    }

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

    pub fn buffered_stdout(&mut self) -> *mut Vec<u8> {
        // Return the raw `*mut` directly — no `&mut Vec<u8>` is materialised,
        // so the `Bufio::Borrowed` aliasing concern (which forces
        // [`buffered_stdout_mut`] to be `unsafe fn`) does not apply here. The
        // dereference obligation is on whoever later writes through it.
        match &mut self._buffered_stdout {
            Bufio::Owned(o) => std::ptr::from_mut(o),
            Bufio::Borrowed(b) => *b,
        }
    }

    pub fn buffered_stderr(&mut self) -> *mut Vec<u8> {
        match &mut self._buffered_stderr {
            Bufio::Owned(o) => std::ptr::from_mut(o),
            Bufio::Borrowed(b) => *b,
        }
    }

    /// Mutably borrow the captured-stdout buffer (owned, or the parent env's
    /// buffer for subshell/pipeline children — see `Bufio`).
    ///
    /// # Safety
    /// In the `Bufio::Borrowed` arm the returned `&mut Vec<u8>` aliases the
    /// PARENT `ShellExecEnv`'s buffer. Caller must ensure no other
    /// `&`/`&mut` to that buffer is live (including via a `&mut` of the
    /// parent env). The shell trampoline mutates one node at a time so this
    /// holds in practice, but `&mut self` alone does not encode it — hence
    /// `unsafe fn`. The parent env strictly outlives this child (parents
    /// `deinit` after children), so the pointer is never dangling.
    #[inline]
    pub unsafe fn buffered_stdout_mut(&mut self) -> &mut Vec<u8> {
        match &mut self._buffered_stdout {
            Bufio::Owned(o) => o,
            // SAFETY: caller contract.
            Bufio::Borrowed(b) => unsafe { &mut **b },
        }
    }

    /// See [`buffered_stdout_mut`].
    ///
    /// # Safety
    /// See [`buffered_stdout_mut`].
    #[inline]
    pub unsafe fn buffered_stderr_mut(&mut self) -> &mut Vec<u8> {
        match &mut self._buffered_stderr {
            Bufio::Owned(o) => o,
            // SAFETY: caller contract; see `buffered_stdout_mut`.
            Bufio::Borrowed(b) => unsafe { &mut **b },
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
        let bufio_for = |out: &OutKind, parent_buf: *mut Vec<u8>| -> Bufio {
            match out {
                OutKind::Fd(f) => match f.captured {
                    Some(cap) => Bufio::Borrowed(cap),
                    None => Bufio::Owned(Vec::<u8>::default()),
                },
                OutKind::Ignore => Bufio::Owned(Vec::<u8>::default()),
                OutKind::Pipe => match kind {
                    ShellExecEnvKind::Normal | ShellExecEnvKind::CmdSubst => {
                        Bufio::Owned(Vec::<u8>::default())
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
        Ok(bun_core::heap::into_raw(duped))
    }

    /// Spec: interpreter.zig `ShellExecEnv.deinit` — wraps `deinitImpl(true,
    /// true)` for the heap-allocated subshell/pipeline-child case.
    ///
    /// SAFETY: `this` was returned by `dupe_for_subshell` (or otherwise
    /// `heap::alloc`'d) and not yet freed.
    pub fn deinit_impl(this: *mut ShellExecEnv) {
        log!("[ShellExecEnv] deinit 0x{:x}", this as usize);
        // SAFETY: precondition above. Reclaim the Box; `Drop` for the env
        // maps / vecs / owned `Bufio` runs on drop. Only `cwd_fd` needs an
        // explicit close (Zig: `closefd(this.cwd_fd)`).
        let boxed = unsafe { bun_core::heap::take(this) };
        closefd(boxed.cwd_fd);
        // EnvMap/Vec/Vec<u8> drop impls free their storage; `Bufio::Borrowed`
        // is a raw ptr so its drop is a no-op (matches Zig's
        // `if (== .owned) clearAndFree`).
        drop(boxed);
    }

    /// Spec: interpreter.zig `ShellExecEnv.deinitImpl(false, free_buffered_io)`
    /// — teardown for the *embedded* root env (held by value in `Interpreter`;
    /// `destroy_this = false`). The Rust `deinit_impl(this: *mut)` covers the
    /// `destroy_this = true` heap-allocated subshell case.
    pub fn deinit_embedded(&mut self, free_buffered_io: bool) {
        log!(
            "[ShellExecEnv] deinit 0x{:x}",
            std::ptr::from_ref(self) as usize
        );
        if free_buffered_io {
            if let Bufio::Owned(o) = &mut self._buffered_stdout {
                o.clear_and_free();
            }
            if let Bufio::Owned(o) = &mut self._buffered_stderr {
                o.clear_and_free();
            }
        }
        // EnvMap has a Drop impl; replace with fresh to free now and leave
        // valid state for any later `Drop` of the outer `Interpreter` box.
        self.shell_env = EnvMap::init();
        self.cmd_local_env = EnvMap::init();
        self.export_env = EnvMap::init();
        self.__cwd = Vec::new();
        self.__prev_cwd = Vec::new();
        closefd(self.cwd_fd);
        self.cwd_fd = bun_sys::Fd::INVALID;
    }

    /// Spec: interpreter.zig `ShellExecEnv.changePrevCwd` — `cd -`.
    #[inline]
    pub fn change_prev_cwd(&mut self) -> bun_sys::Result<()> {
        // PORT NOTE: reshaped for borrowck — `prev_cwd()` borrows `self`, so
        // copy into a stack buffer before the `&mut self` call. Bounded by the
        // ENAMETOOLONG check inside `change_cwd_impl` (same 4 KiB).
        // Spec uses `ResolvePath.join_buf` (`[4096]u8` on every platform); do
        // NOT use `bun_paths::PathBuffer` here — on Windows that is ~96 KiB of
        // zero-filled stack, and `change_cwd_impl` stacks another on top.
        let mut buf = [0u8; 4096];
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
    pub fn change_cwd_impl(&mut self, new_cwd_: &[u8], in_init: bool) -> bun_sys::Result<()> {
        let is_abs = bun_paths::is_absolute(new_cwd_);

        // Spec interpreter.zig:620 bounds-checks against `ResolvePath.join_buf`
        // — a `[4096]u8` threadlocal on *every* platform. Do NOT use
        // `bun_paths::PathBuffer` here: on Windows that is `MAX_PATH_BYTES =
        // 32767*3+1` ≈ 96 KiB of zero-filled stack per `cd`, and the
        // `>= buf.len()` check would diverge from the Zig ENAMETOOLONG bound.
        let mut buf = [0u8; 4096];
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
        let new_cwd_z = bun_core::ZStr::from_buf(&buf[..], new_cwd_len);

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
            self.export_env
                .insert(EnvStr::init_slice(b"OLDPWD"), oldpwd);
        }
        let pwd = EnvStr::init_slice(self.cwd());
        self.export_env.insert(EnvStr::init_slice(b"PWD"), pwd);

        Ok(())
    }

    /// Spec: interpreter.zig `ShellExecEnv.assignVar`.
    ///
    /// Routes `label = value` into one of the three env maps depending on
    /// where the assignment appeared (`FOO=1 cmd` → cmd-local, bare `FOO=1` →
    /// shell, `export FOO=1` → exported). NOTE: `EnvMap::insert` `.ref()`s the
    /// value, so callers should `defer value.deref()` per the Zig contract.
    pub fn assign_var(
        &mut self,
        label: crate::shell::env_str::EnvStr,
        value: crate::shell::env_str::EnvStr,
        assign_ctx: AssignCtx,
    ) {
        match assign_ctx {
            AssignCtx::Cmd => self.cmd_local_env.insert(label, value),
            AssignCtx::Shell => self.shell_env.insert(label, value),
            AssignCtx::Exported => self.export_env.insert(label, value),
        }
    }

    /// Spec: interpreter.zig `ShellExecEnv.getHomedir`.
    ///
    /// Looks up `$HOME` (`$USERPROFILE` on Windows) in `shell_env` first, then
    /// `export_env`. Falls back to `""` (or `/data/local/tmp` on Android) so
    /// `cd` with no args / `~` expansion never sees a null.
    pub fn get_homedir(&self) -> crate::shell::env_str::EnvStr {
        use crate::shell::env_str::EnvStr;
        let key = if cfg!(windows) {
            EnvStr::init_slice(b"USERPROFILE")
        } else {
            EnvStr::init_slice(b"HOME")
        };
        self.shell_env
            .get(key)
            .or_else(|| self.export_env.get(key))
            .unwrap_or_else(|| {
                EnvStr::init_slice(if bun_core::env::IS_ANDROID {
                    b"/data/local/tmp"
                } else {
                    b""
                })
            })
    }
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
// EventLoopHandle
// ────────────────────────────────────────────────────────────────────────────

/// `bun.jsc.EventLoopHandle` — tagged union over `{ js: *JSEventLoop, mini:
/// *MiniEventLoop }`. The real type lives in
/// `bun_event_loop` and re-exported through `bun_jsc`; shell re-exports it
/// here so `IOReader`/`IOWriter`/builtin tasks keep their existing import path.
pub use bun_event_loop::EventLoopHandle;

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
        let new = bun_core::heap::into_raw(Box::new(CowFd {
            __fd: fd,
            refcount: 1,
            being_used: false,
        }));
        bun_core::scoped_log!(CowFd, "init {:x} fd={}", new as usize, fd);
        new
    }

    /// Spec: `CowFd.dup` — fresh `CowFd` wrapping a `dup()`'d fd. Errors
    /// surface the syscall error (the freshly-allocated box is dropped).
    pub fn dup(&self) -> bun_sys::Result<*mut CowFd> {
        let fd = bun_sys::dup(self.__fd)?;
        Ok(Self::init(fd))
    }

    /// Spec: `CowFd.use` — copy-on-write borrow. If nobody is currently
    /// writing through this fd, mark it in-use and return it (refcount +1);
    /// otherwise hand out a fresh `dup()`.
    pub fn use_(this: *mut CowFd) -> bun_sys::Result<*mut CowFd> {
        // SAFETY: caller holds a live `CowFd` (refcount ≥ 1).
        unsafe {
            if !(*this).being_used {
                (*this).being_used = true;
                (*this).ref_();
                return Ok(this);
            }
            (*this).dup()
        }
    }

    /// Spec: `CowFd.doneUsing` — paired with [`use_`].
    pub fn done_using(&mut self) {
        self.being_used = false;
    }

    pub fn ref_(&mut self) {
        self.refcount += 1;
    }

    /// Spec: `CowFd.dupeRef` — bump refcount and return the same pointer.
    pub fn dupe_ref(this: *mut CowFd) -> *mut CowFd {
        // SAFETY: caller holds a live `CowFd`.
        unsafe { (*this).ref_() };
        this
    }

    pub fn deref(this: *mut CowFd) {
        // SAFETY: caller holds a valid CowFd
        unsafe {
            (*this).refcount -= 1;
            if (*this).refcount == 0 {
                // Spec `CowFd.deinit` (interpreter.zig:192-196): close the fd
                // before freeing. `closefd` tolerates EBADF like Zig's
                // `closeAllowingBadFileDescriptor`.
                closefd((*this).__fd);
                drop(bun_core::heap::take(this));
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Convenience re-exports for state modules
// ────────────────────────────────────────────────────────────────────────────

pub use crate::shell::builtin::Builtin;
pub use crate::shell::io_reader::IOReader;
pub use crate::shell::io_writer::IOWriter;
pub use crate::shell::states::assigns::AssignCtx;

/// Spec: `bun.sys.openNullDevice()` (sys.zig:3865) — open `/dev/null` `O_RDWR`
/// on POSIX, `nul` on Windows. Used when a stdio stream was closed at process
/// start so we have *something* to dup into the shell's root IO. Must be
/// writable: `setup_io_before_run` installs the result as the stdout/stderr
/// `IOWriter` target (and `init` uses it for stdin), so `RDWR` covers both.
fn open_null_device() -> bun_sys::Result<Fd> {
    #[cfg(unix)]
    {
        bun_sys::open(
            bun_core::ZStr::from_static(b"/dev/null\0"),
            bun_sys::O::RDWR,
            0,
        )
    }
    #[cfg(windows)]
    {
        // Spec uses `sys_uv.open("nul", 0, 0)` — flags `0` is `O_RDONLY` in
        // libuv's encoding, but Windows NUL is bidirectional regardless.
        bun_sys::open(bun_core::ZStr::from_static(b"nul\0"), bun_sys::O::RDWR, 0)
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

/// Spec: interpreter.zig `isPollableFromMode` (interpreter.zig:2126-2134).
/// Same test as [`is_pollable`] minus the `isatty()` check — used when the
/// caller already has a cached `st_mode` (e.g. from `Builtin` stdio setup) and
/// no fd is at hand.
pub fn is_pollable_from_mode(mode: bun_sys::Mode) -> bool {
    #[cfg(windows)]
    {
        let _ = mode;
        false
    }
    #[cfg(unix)]
    {
        // `libc::S_IFMT` etc. are mode_t (u16 on Darwin/FreeBSD, u32 on Linux);
        // widen so the `mode: u32` arg compares uniformly.
        let fmt = mode & libc::S_IFMT as u32;
        #[cfg(target_os = "macos")]
        {
            // macOS allows polling regular files, but our IOWriter has a
            // better dedicated path for them — exclude S_ISREG explicitly.
            if fmt == libc::S_IFREG as u32 {
                return false;
            }
        }
        fmt == libc::S_IFIFO as u32 || fmt == libc::S_IFSOCK as u32
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
            let dirpath = bun_sys::get_fd_path(dirfd, buf).map_err(|e| e.with_fd(dirfd))?;
            bun_paths::resolve_path::windows_filesystem_root(dirpath).len()
        };
        // Spec: `copyForwards(buf[0..root], source_root)` — `dirpath` already
        // occupies `buf[0..]` and the root is its prefix, so that copy is a
        // no-op here. Splice `to[1..]` after the root.
        let to_tail = &to.as_bytes()[1..];
        let end = source_root_len + to_tail.len();
        buf[source_root_len..end].copy_from_slice(to_tail);
        buf[end] = 0;
        return Ok(bun_core::ZStr::from_buf(buf.as_slice(), end));
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
    Ok(bun_paths::resolve_path::join_z_buf::<
        bun_paths::platform::Auto,
    >(&mut buf[..], &[&dirpath, to.as_bytes()]))
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
            .make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail);
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let p = shell_get_path(dir, path, &mut buf)?;
        // Spec interpreter.zig:1904-1909: `return bun.sys.open(p, flags, perm)`
        // — no `makeLibUVOwnedForSyscall` here. `bun_sys::open` on Windows
        // routes through `sys_uv` and already yields a uv-owned fd; the
        // trailing `if (isWindows) makeLibUVOwned` in the Zig source is dead
        // code (the Windows block early-returns before it).
        return bun_sys::open(p, flags, perm);
    }
    #[cfg(not(windows))]
    {
        bun_sys::openat(dir, path, flags, perm).map_err(|e| e.with_path(path.as_bytes()))
    }
}

/// Spec: interpreter.zig `ShellSyscall.open` (interpreter.zig:1920-1929).
/// `bun_sys::open` already routes through `sys_uv` on Windows (returns a uv
/// fd), so unlike `openat`'s NT-handle directory path this needs no explicit
/// `makeLibUVOwnedForSyscall` — the dead `if (isWindows)` tail in the Zig
/// source is unreachable after the early `return bun.sys.open(...)`.
#[allow(dead_code)] // no Zig callers yet; ported for ShellSyscall surface parity
pub fn shell_open(
    file_path: &bun_core::ZStr,
    flags: i32,
    perm: bun_sys::Mode,
) -> bun_sys::Result<Fd> {
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

impl ParseError {
    /// Borrow the option-name payload. The pointer borrows either a `'static`
    /// literal (e.g. `b"-"`) or the owning `Builtin`'s argv storage
    /// (NUL-terminated `Vec<u8>` in `Cmd::args`, live for the `Builtin`'s
    /// lifetime — see [`Builtin::arg_bytes`](crate::shell::builtin::Builtin::arg_bytes)).
    /// Builtins format the error before any argv mutation.
    #[inline]
    pub fn opt(&self) -> &[u8] {
        match self {
            // SAFETY: see doc comment.
            ParseError::IllegalOption(s) | ParseError::Unsupported(s) => unsafe { &**s },
            ParseError::ShowUsage => b"",
        }
    }
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
/// it would require runtime allocation (leaking is forbidden — see
/// PORTING.md §Forbidden) since Rust can't comptime-concat a non-const arg.
#[inline]
pub const fn unsupported_flag(name: &'static [u8]) -> *const [u8] {
    std::ptr::from_ref::<[u8]>(name)
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
        let flag = unsafe { bun_core::ffi::cstr(args[idx]) }.to_bytes();
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
        return ParseFlagResult::IllegalOption(std::ptr::from_ref::<[u8]>(b"-"));
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
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        errbuf: &[u8],
    ) -> Option<Yield>;
    fn on_write_err(interp: &Interpreter, cmd: NodeId);
    fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        child: *mut OutputTask<Self>,
        output: &mut OutputSrc,
    ) -> Option<Yield>;
    fn on_write_out(interp: &Interpreter, cmd: NodeId);
    fn on_done(interp: &Interpreter, cmd: NodeId) -> Yield;
}

/// A task that can write to stdout and/or stderr. Spec: interpreter.zig
/// `OutputTask(Parent, vtable)`.
///
/// Heap-allocated (`heap::alloc`) so the IOWriter can hold a raw pointer to
/// it across async chunks; freed by `deinit`.
pub struct OutputTask<P: OutputTaskVTable> {
    /// Owning Cmd node (the builtin's `cmd` id). Replaces Zig's `*Parent`.
    pub parent: NodeId,
    pub output: OutputSrc,
    pub state: OutputTaskState,
    _marker: core::marker::PhantomData<P>,
}

impl<P: OutputTaskVTable> OutputTask<P> {
    pub fn new(parent: NodeId, output: OutputSrc) -> Box<Self> {
        Box::new(OutputTask {
            parent,
            output,
            state: OutputTaskState::WaitingWriteErr,
            _marker: core::marker::PhantomData,
        })
    }

    /// Spec: interpreter.zig `OutputTask.start`.
    ///
    /// Takes the freshly-constructed task by `Box` (callers always pair `new`
    /// → `start`), leaks it to the raw `*mut Self` the IOWriter callback chain
    /// needs, and drives the first state transition. The box is reclaimed by
    /// [`Self::deinit`] (via `heap::take`) when the task reaches `Done`.
    pub fn start(me: Box<Self>, interp: &Interpreter, errbuf: Option<&[u8]>) -> Yield {
        // Leak so `P::write_*` can stash `this` as the IOWriter's `ChildPtr`;
        // address is stable for the task's lifetime. Re-derive `&mut` per
        // step (the `P::*` callbacks re-enter via raw `this`, not a reborrow
        // of `me`).
        let this = bun_core::heap::into_raw(me);
        // SAFETY: `this` is a fresh, uniquely-owned heap allocation.
        unsafe {
            let me = &mut *this;
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
                return Self::next(this, interp);
            }
            me.state = OutputTaskState::WaitingWriteOut;
            if let Some(y) = P::write_out(interp, me.parent, this, &mut me.output) {
                return y;
            }
            P::on_write_out(interp, me.parent);
            me.state = OutputTaskState::Done;
            Self::deinit(this, interp)
        }
    }

    /// Spec: interpreter.zig `OutputTask.next`.
    pub unsafe fn next(this: *mut Self, interp: &Interpreter) -> Yield {
        // SAFETY: caller contract — see `start`.
        unsafe {
            let me = &mut *this;
            match me.state {
                OutputTaskState::WaitingWriteErr => {
                    P::on_write_err(interp, me.parent);
                    me.state = OutputTaskState::WaitingWriteOut;
                    if let Some(y) = P::write_out(interp, me.parent, this, &mut me.output) {
                        return y;
                    }
                    P::on_write_out(interp, me.parent);
                    me.state = OutputTaskState::Done;
                    Self::deinit(this, interp)
                }
                OutputTaskState::WaitingWriteOut => {
                    P::on_write_out(interp, me.parent);
                    me.state = OutputTaskState::Done;
                    Self::deinit(this, interp)
                }
                OutputTaskState::Done => panic!("Invalid state"),
            }
        }
    }

    /// Spec: interpreter.zig `OutputTask.onIOWriterChunk`.
    pub unsafe fn on_io_writer_chunk(
        this: *mut Self,
        interp: &Interpreter,
        _written: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        log!("OutputTask(0x{:x}) onIOWriterChunk", this as usize);
        // Zig derefs the SystemError; in Rust drop handles it.
        unsafe { Self::next(this, interp) }
    }

    /// Spec: interpreter.zig `OutputTask.deinit` — fires `on_done` then frees.
    unsafe fn deinit(this: *mut Self, interp: &Interpreter) -> Yield {
        // SAFETY: `this` was heap-allocated in `new`; reclaim and drop.
        let me = unsafe { bun_core::heap::take(this) };
        debug_assert!(me.state == OutputTaskState::Done);
        log!("OutputTask(0x{:x}) deinit", this as usize);
        let parent = me.parent;
        drop(me);
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
///
/// `Taskable` is a supertrait so [`ShellTask::on_finish`] can build the
/// JS-side `ConcurrentTask` (Zig: `concurrent_task.js.from(ctx, .manual_deinit)`
/// resolved the tag via comptime `@typeName(Ctx)`).
pub trait ShellTaskCtx: Sized + bun_event_loop::Taskable {
    /// Byte offset of the embedded `task: ShellTask` field within `Self`.
    /// Implementors define this as `core::mem::offset_of!(Self, task)`.
    const TASK_OFFSET: usize;
    /// Worker-thread body. Takes `&mut Self`: the trampoline recovers the
    /// heap allocation from the intrusive task node and forms the unique
    /// borrow once; no impl re-enters or frees `self` here (that happens in
    /// `run_from_main_thread`).
    fn run_from_thread_pool(this: &mut Self);
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter);

    /// Recover `*mut Self` from the intrusive `*mut WorkPoolTask` that the
    /// thread pool hands the callback. `WorkPoolTask` is the first
    /// `#[repr(C)]` field of [`ShellTask`], so the `WorkPoolTask*` and
    /// `ShellTask*` coincide; one `byte_sub(TASK_OFFSET)` walks back to the
    /// outer `Self` (Zig: the two-hop `@fieldParentPtr` chain in
    /// `InnerShellTask.runFromThreadPool`).
    ///
    /// Provided so the two opt-out builtins (`cp`/`rm`, which install a
    /// custom `work_pool_callback` and bypass [`shell_task_trampoline`]) can
    /// reuse the exact recovery the generic trampoline performs, instead of
    /// each open-coding the `byte_sub` walk.
    ///
    /// # Safety
    /// `task` must point at the [`WorkPoolTask`] node embedded in a live
    /// `Self` allocation at `Self::TASK_OFFSET` (i.e. the `task.task` field
    /// of the `ShellTask` field), with provenance covering the whole `Self`.
    #[inline(always)]
    unsafe fn from_work_task(task: *mut WorkPoolTask) -> *mut Self {
        // SAFETY: caller contract — `task` is the first `#[repr(C)]` field of
        // `ShellTask`, embedded in `Self` at `TASK_OFFSET`.
        unsafe { bun_core::container_of::<Self, _>(task, Self::TASK_OFFSET) }
    }
}

/// Stamps the boilerplate `impl ShellTaskCtx for $ty` that every per-builtin
/// task struct repeats verbatim: `TASK_OFFSET = offset_of!(Self, task)` and
/// the two trait fns forwarding to the inherent `Self::run_from_thread_pool`
/// / `Self::run_from_main_thread`. The `; no_thread_pool` arm is for the two
/// opt-out builtins (`cp`/`rm`) that install a custom `work_pool_callback`
/// and so must NOT be scheduled via the generic [`ShellTask::schedule`] —
/// the trait fn becomes a `debug_assert!(false)` trap.
macro_rules! shell_task_ctx {
    ($ty:ty) => {
        impl $crate::shell::interpreter::ShellTaskCtx for $ty {
            const TASK_OFFSET: usize = ::core::mem::offset_of!(Self, task);
            fn run_from_thread_pool(this: &mut Self) {
                Self::run_from_thread_pool(this)
            }
            fn run_from_main_thread(
                this: *mut Self,
                interp: &$crate::shell::interpreter::Interpreter,
            ) {
                Self::run_from_main_thread(this, interp)
            }
        }
    };
    ($ty:ty; no_thread_pool) => {
        impl $crate::shell::interpreter::ShellTaskCtx for $ty {
            const TASK_OFFSET: usize = ::core::mem::offset_of!(Self, task);
            fn run_from_thread_pool(_this: &mut Self) {
                debug_assert!(
                    false,
                    concat!(
                        stringify!($ty),
                        " scheduled via ShellTask::schedule; use ",
                        stringify!($ty),
                        "::schedule"
                    )
                );
            }
            fn run_from_main_thread(
                this: *mut Self,
                interp: &$crate::shell::interpreter::Interpreter,
            ) {
                Self::run_from_main_thread(this, interp)
            }
        }
    };
}
pub(crate) use shell_task_ctx;

pub type WorkPoolTask = bun_threading::work_pool::Task;

#[repr(C)]
pub struct ShellTask {
    /// Intrusive thread-pool node. MUST be the first field so the
    /// `*mut WorkPoolTask` → `*mut ShellTask` cast in the trampoline is a
    /// no-op`).
    pub task: WorkPoolTask,
    pub event_loop: EventLoopHandle,
    pub keep_alive: bun_io::KeepAlive,
    /// Back-ref to the owning [`Interpreter`]. The Zig original threaded the
    /// interpreter through each builtin's parent-ptr chain; the Rust port uses
    /// a NodeId arena, so the high-tier dispatch (`runtime::dispatch::run_task`)
    /// recovers `&mut Interpreter` from this field instead. Set at
    /// `ShellTask::new`; cleared (raw-ptr) only when the task is freed.
    pub interp: *mut Interpreter,
    /// Intrusive concurrent-task node for the worker→main bounce. JS arm holds
    /// a [`ConcurrentTask`](bun_event_loop::ConcurrentTask::ConcurrentTask),
    /// mini arm holds an `AnyTaskWithExtraContext` (Zig: `jsc.EventLoopTask`).
    pub concurrent_task: bun_event_loop::EventLoopTask,
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
            concurrent_task: bun_event_loop::EventLoopTask::from_event_loop(event_loop),
        }
    }

    /// Spec: interpreter.zig `InnerShellTask.schedule`. Installs the per-`C`
    /// trampoline and hands the intrusive task to the global [`WorkPool`].
    ///
    /// SAFETY: `ctx` must be a live heap allocation that embeds this
    /// `ShellTask` at `C::TASK_OFFSET` and outlives the worker-thread call.
    pub unsafe fn schedule<C: ShellTaskCtx>(ctx: *mut C) {
        log!("ShellTask schedule");
        // SAFETY: caller contract — `ctx` embeds `ShellTask` at `TASK_OFFSET`.
        unsafe {
            let this = ctx.cast::<u8>().add(C::TASK_OFFSET).cast::<ShellTask>();
            (*this)
                .keep_alive
                .ref_((*this).event_loop.as_event_loop_ctx());
            Self::schedule_no_ref::<C>(ctx);
        }
    }

    /// Install the per-`C` trampoline and hand the intrusive task to
    /// [`WorkPool`] WITHOUT a `keep_alive.ref` — for tasks that the Zig spec
    /// schedules via raw `WorkPool.schedule(&this.task)` (e.g. ls.zig
    /// `ShellLsTask.schedule`, called recursively from a worker thread where
    /// no JS-thread VM thread-local exists).
    ///
    /// SAFETY: same as [`Self::schedule`].
    pub unsafe fn schedule_no_ref<C: ShellTaskCtx>(ctx: *mut C) {
        use bun_threading::work_pool::WorkPool;
        // SAFETY: caller contract — `ctx` embeds `ShellTask` at `TASK_OFFSET`.
        // Stay on raw pointers: once `WorkPool::schedule` returns the worker
        // thread may already be touching `*this`, so we must not hold a live
        // `&mut ShellTask` across that call.
        unsafe {
            let this = ctx.cast::<u8>().add(C::TASK_OFFSET).cast::<ShellTask>();
            (*this).task.callback = shell_task_trampoline::<C>;
            WorkPool::schedule(&raw mut (*this).task);
        }
    }

    /// Spec: interpreter.zig `InnerShellTask.onFinish`. Called from the worker
    /// thread once `C::run_from_thread_pool` returns; enqueues the embedded
    /// concurrent task so the main thread re-enters via
    /// [`run_from_main_thread`](Self::run_from_main_thread) (which performs the
    /// `keep_alive.unref` paired with [`schedule`](Self::schedule)).
    ///
    /// # Safety
    /// `ctx` must be the same live heap allocation passed to
    /// [`schedule`](Self::schedule); not touched again on the worker thread
    /// after this returns.
    pub unsafe fn on_finish<C: ShellTaskCtx>(ctx: *mut C) {
        use bun_event_loop::{ConcurrentTask::AutoDeinit, EventLoopTask, EventLoopTaskPtr};
        log!("ShellTask onFinish");
        // SAFETY: caller contract — `ctx` embeds `ShellTask` at `TASK_OFFSET`.
        // Stay on raw pointers: once `enqueue_task_concurrent` returns, the
        // main thread may already be touching `*this`, so no live `&mut`
        // into it may span that call. `this` is live and exclusively owned by
        // this thread until the enqueue below.
        let (event_loop, task_ptr) = unsafe {
            let this = ctx.cast::<u8>().add(C::TASK_OFFSET).cast::<ShellTask>();
            let event_loop = (*this).event_loop;
            let task_ptr = match &mut (*this).concurrent_task {
                EventLoopTask::Js(ct) => {
                    // Zig: `concurrent_task.js.from(ctx, .manual_deinit)` —
                    // tag resolved via `C: Taskable`.
                    ct.from(ctx, AutoDeinit::ManualDeinit);
                    EventLoopTaskPtr {
                        js: std::ptr::from_mut(ct),
                    }
                }
                EventLoopTask::Mini(at) => {
                    // Zig: `concurrent_task.mini.from(this, "runFromMainThreadMini")`.
                    // Rust passes the monomorphised callback explicitly.
                    EventLoopTaskPtr {
                        mini: at.from(this, shell_task_run_from_main_thread_mini::<C>),
                    }
                }
            };
            (event_loop, task_ptr)
        };
        event_loop.enqueue_task_concurrent(task_ptr);
    }

    /// Spec: interpreter.zig `InnerShellTask.runFromMainThread`. Unrefs the
    /// event-loop keep-alive paired with [`schedule`], then dispatches to
    /// `C::run_from_main_thread`. The high-tier `runtime::dispatch::run_task`
    /// `shell_dispatch!` arm calls this so the ref/unref pairing is kept at
    /// the seam (Zig: `this.ref.unref(this.event_loop)` before
    /// `runFromMainThread_(ctx)`).
    ///
    /// # Safety
    /// `ctx` must be a live heap allocation that embeds a `ShellTask` at
    /// `C::TASK_OFFSET` whose `interp` back-ref is valid; called on the main
    /// thread after the worker bounce-back.
    pub unsafe fn run_from_main_thread<C: ShellTaskCtx>(ctx: *mut C) {
        log!("ShellTask runFromJS");
        // SAFETY: caller contract — `ctx` embeds `ShellTask` at `TASK_OFFSET`.
        unsafe {
            let this = ctx.cast::<u8>().add(C::TASK_OFFSET).cast::<ShellTask>();
            (*this)
                .keep_alive
                .unref((*this).event_loop.as_event_loop_ctx());
            let interp = &*(*this).interp;
            C::run_from_main_thread(ctx, interp);
        }
    }
}

/// Spec: interpreter.zig `runFromThreadPool` — recover `*Ctx` from the
/// intrusive `*WorkPoolTask`, run the user body, then post back to main.
unsafe fn shell_task_trampoline<C: ShellTaskCtx>(task: *mut WorkPoolTask) {
    // SAFETY: `task` is the first `#[repr(C)]` field of `ShellTask`, which is
    // embedded in `C` at `TASK_OFFSET` (Zig: two `container_of` hops). `ctx`
    // remains the live heap allocation handed to `schedule`.
    unsafe {
        let ctx = C::from_work_task(task);
        // The worker thread is the sole accessor until `on_finish` publishes
        // the task back; the `&mut` ends before that call.
        C::run_from_thread_pool(&mut *ctx);
        ShellTask::on_finish::<C>(ctx);
    }
}

/// Spec: interpreter.zig `InnerShellTask.runFromMainThreadMini` — mini-loop
/// `AnyTaskWithExtraContext` callback shape (`fn(*mut T, *mut ())`).
fn shell_task_run_from_main_thread_mini<C: ShellTaskCtx>(this: *mut ShellTask, _: *mut ()) {
    // SAFETY: `this` is the `ShellTask` embedded in a live `C` at `TASK_OFFSET`;
    // mini-loop dispatch runs on the main thread.
    unsafe {
        ShellTask::run_from_main_thread::<C>(bun_core::container_of::<C, _>(this, C::TASK_OFFSET))
    };
}

// Body never dereferences the pointer; a safe `fn` item coerces to the
// `WorkPoolTask::callback` field type at the assignment site.
#[cold]
fn shell_task_unset_callback(_: *mut WorkPoolTask) {
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

// ─── createShellInterpreter ─────────────────────────────────────────────────
// Host fn for `Bun.$` template tag — `BunObject_callback_createShellInterpreter`.
// Port of `Interpreter.createShellInterpreter` (interpreter.zig:773).

// C++ side (`ShellBindings.cpp`) takes `void* ptr` — `Interpreter` is opaque
// across the boundary, layout is irrelevant. Defined `extern "C" SYSV_ABI`.
bun_jsc::jsc_abi_extern! {
    #[allow(improper_ctypes)]
    // PRECONDITION: `ptr` must point to a live `Interpreter` — C++ calls back
    // into `ShellInterpreter__estimatedSize(ptr)` which dereferences it, and
    // the JS wrapper takes ownership of the allocation (freed via `finalize`).
    // Cannot be `safe fn`: `NonNull` alone does not encode points-to-valid-T.
    fn Bun__createShellInterpreter(
        global: *const crate::jsc::JSGlobalObject,
        ptr: *mut Interpreter,
        parsed_shell_script: crate::jsc::JSValue,
        resolve: crate::jsc::JSValue,
        reject: crate::jsc::JSValue,
    ) -> crate::jsc::JSValue;
}

pub fn create_shell_interpreter(
    global: &crate::jsc::JSGlobalObject,
    callframe: &crate::jsc::CallFrame,
) -> crate::jsc::JsResult<crate::jsc::JSValue> {
    use crate::jsc::{ArgumentsSlice, JsClass as _};
    use crate::shell::parsed_shell_script::ParsedShellScript;

    let arguments_ = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global.
    let vm = global.bun_vm();
    let mut arguments = ArgumentsSlice::init(vm, arguments_.slice());

    let resolve = arguments
        .next_eat()
        .ok_or_else(|| global.throw(format_args!("shell: expected 3 arguments, got 0")))?;
    let reject = arguments
        .next_eat()
        .ok_or_else(|| global.throw(format_args!("shell: expected 3 arguments, got 0")))?;
    let parsed_shell_script_js = arguments
        .next_eat()
        .ok_or_else(|| global.throw(format_args!("shell: expected 3 arguments, got 0")))?;

    let parsed_shell_script = ParsedShellScript::from_js(parsed_shell_script_js)
        .ok_or_else(|| global.throw(format_args!("shell: expected a ParsedShellScript")))?;
    // SAFETY: from_js returned a live wrapper-owned heap pointer. R-2: deref as
    // shared (`&*const`) — `ParsedShellScript`'s methods/fields are `&self` +
    // interior-mutable, so no `&mut` is required (and forming one here would
    // alias if JS re-enters another host fn on the same wrapper).
    let parsed_shell_script: &ParsedShellScript = unsafe { &*parsed_shell_script };

    if parsed_shell_script.args.get().is_none() {
        return Err(global.throw(format_args!(
            "shell: shell args is null, this is a bug in Bun. Please file a GitHub issue.",
        )));
    }

    let (shargs, jsobjs, quiet, cwd, export_env) = parsed_shell_script.take(global);

    let cwd_slice = cwd.as_ref().map(|c| c.to_utf8());

    // SAFETY: bun_vm() returns the live thread-local VM for a Bun-owned global;
    // dereferencing for `event_loop()` is sound on the mutator thread.
    let event_loop = EventLoopHandle::init(global.bun_vm().as_mut().event_loop().cast::<()>());
    let interpreter: Box<Interpreter> = match Interpreter::init(
        // command_ctx — unused on the JS event-loop path.
        core::ptr::null_mut(),
        event_loop,
        shargs,
        jsobjs,
        export_env,
        cwd_slice.as_ref().map(|c| c.slice()),
    ) {
        ShellResult::Ok(i) => i,
        ShellResult::Err(e) => {
            // shargs/jsobjs were consumed by `init` and dropped on its error
            // path; export_env likewise (Zig: `defer shargs.deinit()` in caller).
            return Err(e.throw_js(global));
        }
    };

    if global.has_exception() {
        // Spec interpreter.zig:828-834: `interpreter.finalize()` →
        // `deinitFromFinalizer` derefs root_io and closes `root_shell.cwd_fd`.
        // Neither `Interpreter` nor `ShellExecEnv` implements `Drop`, so a plain
        // box drop would leak the raw `cwd_fd`; run the explicit teardown.
        interpreter.deinit_from_exec();
        return Err(crate::jsc::JsError::Thrown);
    }

    let interpreter = bun_core::heap::into_raw(interpreter);
    // SAFETY: `interpreter` is a fresh heap allocation; the C++ wrapper takes
    // ownership of the raw pointer and `interpreter` outlives this call.
    // Single-threaded.
    let js_value = unsafe {
        let it = &*interpreter;
        it.update_flags(|f| f.set_quiet(quiet));
        it.global_this
            .set(std::ptr::from_ref::<crate::jsc::JSGlobalObject>(global).cast_mut());
        it.estimated_size_for_gc
            .set(it.compute_estimated_size_for_gc());
        let js_value = Bun__createShellInterpreter(
            global,
            interpreter,
            parsed_shell_script_js,
            resolve,
            reject,
        );
        it.this_jsvalue.set(js_value);
        it.keep_alive.with_mut(|k| {
            k.ref_(crate::jsc::VirtualMachineRef::event_loop_ctx(
                global.bun_vm_ptr(),
            ))
        });
        js_value
    };
    bun_analytics::features::shell.fetch_add(1, Ordering::Relaxed);
    Ok(js_value)
}

// ported from: src/shell/interpreter.zig
