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

use crate::shell::env_map::EnvMap;
use crate::shell::io::IO;
use crate::shell::states::assigns::Assigns;
use crate::shell::states::base::Base;
use crate::shell::states::binary::Binary;
use crate::shell::states::cmd::Cmd;
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

    /// Run the per-state cleanup, then recycle the slot. Replaces every
    /// `child.deinit()` + `parent.destroy(child)` pair in Zig.
    pub fn deinit_node(&mut self, id: NodeId) {
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
        // TODO(b2-blocked): bun_jsc — throw_shell_err(err, self.event_loop)
        let _ = err;
    }

    // ── run loop ───────────────────────────────────────────────────────────

    pub fn run(&mut self) -> bun_sys::Result<()> {
        log!("Interpreter(0x{:x}) run", self as *const _ as usize);
        // TODO(b2-blocked): setup_io_before_run() — depends on IOWriter::init
        // and EventLoopHandle accessors; gated body preserved in
        // `interpreter_body` below.

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

    // The full body (dupe_for_subshell, change_cwd, get_home_dir, deinit_impl,
    // etc.) is preserved in the gated `interpreter_body` module below — it
    // depends on bun_sys::dup, IOWriter, ResolvePath join_buf, and EnvMap
    // method surface that aren't yet stable.
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
                // TODO(port): (*this).__fd.close();
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

pub fn closefd(fd: Fd) {
    // TODO(b2-blocked): bun_sys::Fd::close — once Fd has the close method
    let _ = fd;
}

// ────────────────────────────────────────────────────────────────────────────
// Gated heavy body
// ────────────────────────────────────────────────────────────────────────────
//
// The remaining ~2400 lines of the original draft (JS-side `init`/`create`,
// `setup_io_before_run`, `run_from_js`, `finalize`, `OutputTask`,
// `ShellAsyncSubprocessDone`, `WriteFailingErrorFmt`, `ShellExecEnv::dupe_for_subshell`,
// the legacy `StatePtrUnion` machinery, etc.) depend on `bun_jsc` method
// surface, `IOWriter::init`, `bun_aio::FilePoll`, and `bun_glob`. Preserved
// here verbatim until those crates are green; the NodeId-arena dispatch above
// supersedes `StatePtrUnion`.
#[cfg(any())]
mod interpreter_body {
    include!("interpreter_body_gated.rs"); // TODO(port): preserved Phase-A draft
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/interpreter.zig (2100 lines)
//   confidence: medium (NodeId-arena scaffolding compiles; JS-side init/finish gated)
//   blocked_on: bun_jsc::{EventLoopHandle, codegen::JSShellInterpreter},
//               IOWriter::init, bun_glob::GlobWalker, ShellExecEnv full body
// ──────────────────────────────────────────────────────────────────────────
