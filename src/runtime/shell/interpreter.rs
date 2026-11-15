//! The interpreter for the shell language
//!
//! There are several constraints on the Bun shell language that make this
//! interpreter implementation unique:
//!
//! 1. We try to keep everything in the Bun process as much as possible for
//!    performance reasons and also to leverage Bun's existing IO/FS code
//! 2. We try to use non-blocking IO operations as much as possible so the
//!    shell does not block the main JS thread
//!
//! The idea is that this is a tree-walking interpreter — except instead of
//! iteratively walking the AST, we build a tree of state-machine nodes so we
//! can suspend/resume without blocking the main thread, driven in
//! continuation-passing style by `Yield::run`.
//!
//! ## NodeId arena
//!
//! A parent/child back-pointer tree would be borrow-checker hostile
//! (overlapping `&mut` of parent and child), so all state nodes live in a
//! flat `Vec<Node>` owned by the `Interpreter`. Nodes refer to each other
//! (and to their parent) by `NodeId` — a `u32` index. Dispatch is a single
//! hoisted `match` on the parent's tag (`Interpreter::child_done`), which
//! keeps the per-tick hot path inlined (see PORTING.md §Dispatch hot-path).
//!
//! State methods take `(&mut Interpreter, this: NodeId)` and look their
//! own data up via `interp.as_<state>(this)` / `interp.as_<state>_mut(this)`.

use bun_collections::VecExt;
use bun_core::IntrusiveField;
use bun_dotenv::Loader as DotEnvLoader;
use bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use bun_event_loop::BoxedTask;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_jsc::bindgen::{JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::{ConcurrentPoster, GlobalRef, JsRef};
use bun_options_types::context::ContextData;
use bun_ptr::{AliasableBox, CellExt as _};
use bun_threading::work_pool::{OwnedTask, WorkPool};
use core::cell::Cell;
use core::fmt;
use core::ops::ControlFlow;
use core::ptr::NonNull;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use bun_sys::{self, Fd, File};

pub(crate) use crate::generated_bindgen::interpreter::js_ShellInterpreter as js;
use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::builtins::yes::Yes;
pub(crate) use crate::shell::env_map::EnvMap;
use crate::shell::io::{IO, OutFd, OutKind};
use crate::shell::io_writer;
use crate::shell::states::assigns::Assigns;
use crate::shell::states::r#async::Async;
use crate::shell::states::base::{Base, Env};
use crate::shell::states::binary::Binary;
pub(crate) use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::expansion::Expansion;
use crate::shell::states::r#if::If;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::states::script::Script;
use crate::shell::states::stmt::Stmt;
use crate::shell::states::subshell::Subshell;
use crate::shell::util::Slots;
use crate::shell::yield_::{DeferredStack, ReentrantAction, Yield};
use crate::shell::{EnvStr, ShellErr, ast};

bun_core::declare_scope!(SHELL, visible);

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

/// Index into `Interpreter::nodes`.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct NodeId(pub(crate) u32);

impl NodeId {
    /// Sentinel: "the parent is the Interpreter itself". The root `Script`
    /// node uses this. `Interpreter::child_done` special-cases it.
    pub(crate) const INTERPRETER: NodeId = NodeId(u32::MAX);
    /// Sentinel for "no node" (e.g. an `Option<NodeId>` packed as a plain id).
    pub(crate) const NONE: NodeId = NodeId(u32::MAX - 1);

    #[inline]
    pub(crate) fn idx(self) -> usize {
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

/// One slot in the interpreter's state arena. All state structs
/// live as enum variants in a single `Vec<Node>` so the only outstanding
/// borrow at any time is `&mut Interpreter`.
pub(crate) enum Node<'a> {
    /// Freed slot, available for reuse by `alloc_node`.
    Free,
    Script(Script<'a>),
    Stmt(Stmt<'a>),
    Binary(Binary<'a>),
    Pipeline(Pipeline<'a>),
    Cmd(Cmd<'a>),
    Assigns(Assigns<'a>),
    Expansion(Expansion<'a>),
    If(If<'a>),
    CondExpr(CondExpr<'a>),
    Async(Async<'a>),
    Subshell(Subshell<'a>),
}

impl Node<'_> {
    pub(crate) fn kind(&self) -> StateKind {
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
    /// hoisted accessor.
    pub(crate) fn base(&self) -> Option<&Base> {
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

    fn base_mut(&mut self) -> Option<&mut Base> {
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

    fn owned_shell(&self) -> Option<ShellExecEnvId> {
        let env = match self {
            Node::Script(s) => &s.shell,
            Node::Cmd(s) => &s.shell,
            Node::If(s) => &s.shell,
            Node::CondExpr(s) => &s.shell,
            Node::Subshell(s) => return Some(s.shell),
            _ => return None,
        };
        match *env {
            Env::Owned(id) => Some(id),
            Env::Inherited(_) => None,
        }
    }
}

/// Generate `{Node, Interpreter}::as_<kind>{,_mut}` typed accessors. These panic on
/// tag mismatch.
macro_rules! node_accessors {
    ($($variant:ident => $ty:ident, $get:ident, $get_mut:ident);* $(;)?) => {
        impl<'a> Node<'a> {
            $(
                #[inline]
                #[track_caller]
                pub(crate) fn $get(&self) -> &$ty<'a> {
                    match self {
                        Node::$variant(v) => v,
                        other => panic!(
                            concat!("expected Node::", stringify!($variant), ", got {:?}"),
                            other.kind()
                        ),
                    }
                }
                #[inline]
                #[track_caller]
                pub(crate) fn $get_mut(&mut self) -> &mut $ty<'a> {
                    match self {
                        Node::$variant(v) => v,
                        other => panic!(
                            concat!("expected Node::", stringify!($variant), ", got {:?}"),
                            other.kind()
                        ),
                    }
                }
            )*
        }
        impl<'a> Interpreter<'a> {
            $(
                #[inline]
                #[track_caller]
                pub(crate) fn $get(&self, id: NodeId) -> &$ty<'a> {
                    self.nodes[id.idx()].$get()
                }
                #[inline]
                #[track_caller]
                pub(crate) fn $get_mut(&mut self, id: NodeId) -> &mut $ty<'a> {
                    self.nodes[id.idx()].$get_mut()
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

pub(crate) type ExitCode = u16;

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

/// The shell promise's `reject` function and the error to call it with. Kept on the stack, where the GC sees it.
type Rejection = (crate::jsc::JSValue, crate::jsc::JSValue);

// ────────────────────────────────────────────────────────────────────────────
// Interpreter
// ────────────────────────────────────────────────────────────────────────────

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
pub(crate) struct Interpreter<'a> {
    /// Flat arena of state-machine nodes. Indices are `NodeId`s; freed slots
    /// are recycled via `free_list`.
    pub(crate) nodes: Vec<Node<'a>>,
    free_list: Vec<u32>,

    pub(crate) event_loop: EventLoopHandle,

    pub(crate) io_readers: Slots<IOReader<'a>, IOReader<'static>>,
    pub(crate) io_writers: Slots<IOWriter<'a>, IOWriter<'static>>,
    pub(crate) shells: ShellExecEnvs<'a>,

    pub(crate) root_io: IO,
    root_shell: ShellExecEnvId,
    pub(crate) arena: &'a bun_alloc::Arena,
    script_ast: ast::Script<'a>,

    /// Back-ref to the owner of this interpreter.
    shell_interp: NonNull<ShellInterpreter>,
    /// Number of [`ShellInterpreterRef`]s that are out.
    pending_tasks: u32,
    /// Same as [`ShellInterpreter::context`].
    pub(crate) context: Option<bun_jsc::ContextId>,

    pub(crate) async_commands_executing: u32,

    quiet: bool,
    /// Set by [`Interpreter::fail`].
    failed: bool,
    exit_code: Option<ExitCode>,

    /// Lazily-populated UTF-8 cache for the JS-side argv (`$@`/`$N` expansion
    /// when running under a Worker). See [`Interpreter::get_vm_args_utf8`].
    pub(crate) vm_args_utf8: Vec<bun_core::Utf8Bytes<'static>>,

    /// `bun run` CLI context for `$N` expansion on the mini event loop.
    /// `None` when constructed from JS (no `ContextData` is reachable).
    pub(crate) command_ctx: Option<&'a ContextData>,
    /// `None` when constructed from JS: the VM has it.
    env_loader: Option<&'a DotEnvLoader>,
}

/// Owns the [`Interpreter`], which JS and the event loop reach only through `with_interp`.
pub(crate) struct ShellInterpreter {
    /// `None` inside `with_interp` and after `finish`.
    args: Cell<Option<ShellArgs>>,

    pub(crate) event_loop: EventLoopHandle,

    keep_alive: bun_io::JsKeepAlive,
    /// The `Bun.ModuleGraph` context whose script started this (`run_from_js`), if any.
    context: Cell<Option<bun_jsc::ContextId>>,

    /// `None` on the mini event loop.
    global_this: Option<GlobalRef>,

    /// Set by `finish`.
    exit_code: Cell<Option<ExitCode>>,
    /// The JS wrapper. Strong from `run_from_js` until `finish` has settled the promise.
    this_value: JsRef,
    estimated_size_for_gc: usize,
}

// ────────────────────────────────────────────────────────────────────────────
// Construction / standalone-exec entrypoints
// ────────────────────────────────────────────────────────────────────────────

impl ShellArgs {
    pub(crate) fn init<E>(
        parse: impl for<'a> FnOnce(&'a bun_alloc::Arena) -> Result<ast::Script<'a>, E>,
    ) -> Result<ShellArgs, E> {
        let mut args = ShellArgs(AliasableBox::new(ShellArgsInner {
            __arena: bun_alloc::Arena::new(),
            script_ast: ast::Script { stmts: &[] },
            interp: None,
        }));
        args.with_mut(|arena, script_ast, _| {
            *script_ast = parse(arena)?;
            Ok(())
        })?;
        Ok(args)
    }

    fn with_mut<R>(
        &mut self,
        f: impl for<'a> FnOnce(
            &'a bun_alloc::Arena,
            &mut ast::Script<'a>,
            &mut Option<Interpreter<'a>>,
        ) -> R,
    ) -> R {
        let inner = self.0.as_ptr();
        // SAFETY: `&mut self` makes these the only borrows of `script_ast` and `interp`. `__arena` does
        // not move, and is neither borrowed mutably nor dropped until `Drop` has cleared `interp`. `f`
        // is generic over `'a`, so it can store a borrow of `__arena` only in these two fields.
        unsafe {
            f(
                &(*inner).__arena,
                &mut (*inner).script_ast,
                &mut (*inner).interp,
            )
        }
    }

    /// Reports the arena's `allocated_bytes()` (a superset — tokens + strpool
    /// + AST nodes). This is for GC `estimatedSize` reporting only, where
    /// over-approximation is preferable to a tree walk.
    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<ShellArgsInner>() + self.0.__arena.allocated_bytes()
    }
}

impl<'a> Interpreter<'a> {
    /// Lex `src` (ASCII or Unicode), build a `Parser`, and return the root
    /// `ast::Script`. Tokens and AST nodes are bump-allocated into `arena`.
    ///
    /// On lex error, `out_lex_err` is populated and `ParseError::Lex` returned
    /// so the caller can `combineErrors()` for diagnostics; on parse error
    /// `out_parse_err` is populated likewise.
    pub(crate) fn parse(
        arena: &'a bun_alloc::Arena,
        src: &[u8],
        jsobjs_len: u32,
        jsstrings_to_escape: &[bun_core::String],
        out_parser: &mut Option<bun_shell_parser::Parser<'a>>,
        out_lex_result: &mut Option<bun_shell_parser::LexResult<'a>>,
    ) -> crate::Result<bun_shell_parser::ast::Script<'a>> {
        use crate::shell::shell_body::{LexerAscii, LexerUnicode, ParseError, Parser};
        let lex_result = if bun_core::is_all_ascii(src) {
            let mut lexer = LexerAscii::new(arena, src, jsstrings_to_escape, jsobjs_len);
            lexer.lex().map_err(crate::Error::from)?;
            lexer.get_result()
        } else {
            let mut lexer = LexerUnicode::new(arena, src, jsstrings_to_escape, jsobjs_len);
            lexer.lex().map_err(crate::Error::from)?;
            lexer.get_result()
        };
        if !lex_result.errors.is_empty() {
            *out_lex_result = Some(lex_result);
            return Err(ParseError::Lex.into());
        }
        *out_parser = Some(Parser::new(arena, lex_result));
        Ok(out_parser.as_mut().unwrap().parse()?)
    }

    /// Builds the root `ShellExecEnv`, and dups stdin into an `IOReader`.
    /// stdout/stderr stay `.pipe` here — `setup_io_before_run()` (called from
    /// `run()`) upgrades them to real `IOWriter`s unless `quiet` was set.
    fn init(
        ctx: Option<&'a ContextData>,
        env_loader: Option<&'a DotEnvLoader>,
        event_loop: EventLoopHandle,
        shell_interp: NonNull<ShellInterpreter>,
        arena: &'a bun_alloc::Arena,
        script_ast: ast::Script<'a>,
        export_env: EnvMap<'a>,
        cwd_: Option<&[u8]>,
    ) -> bun_sys::Result<Interpreter<'a>> {
        // ── cwd / cwd_fd ───────────────────────────────────────────────────
        // Heap-pooled (not stack) —
        // on Windows `MAX_PATH_BYTES` is ~96 KiB and `init` runs from
        // JS-triggered paths that may already be deep on the stack.
        let mut pathbuf = bun_paths::path_buffer_pool::get();
        let cwd_z = bun_sys::getcwd_z(&mut pathbuf)?;

        let cwd_fd = OwnedFd(bun_sys::open(
            cwd_z,
            bun_sys::O::DIRECTORY | bun_sys::O::RDONLY,
            0,
        )?);

        let cwd: &[u8] = arena.alloc_slice_copy(cwd_z.as_bytes());

        // ── stdin ──────────────────────────────────────────────────────────
        log!("Duping stdin");
        let stdin_fd = if bun_core::output::stdio::is_stdin_null() {
            #[cfg(unix)]
            {
                bun_sys::open(bun_core::zstr!("/dev/null"), bun_sys::O::RDONLY, 0)
            }
            #[cfg(windows)]
            {
                bun_sys::open(bun_core::zstr!("NUL"), bun_sys::O::RDONLY, 0)
            }
        } else {
            shell_dup(Fd::stdin())
        }?;

        // ── assemble ───────────────────────────────────────────────────────
        let mut shells = Slots::new();
        let root_shell = shells.insert(ShellExecEnv {
            _buffered_stdout: Bufio::default(),
            _buffered_stderr: Bufio::default(),
            shell_env: EnvMap::init(),
            cmd_local_env: EnvMap::init(),
            export_env,
            __prev_cwd: cwd,
            __cwd: cwd,
            cwd_fd,
        });
        let mut interpreter = Interpreter {
            nodes: Vec::new(),
            free_list: Vec::new(),
            event_loop,
            io_readers: Slots::new(),
            io_writers: Slots::new(),
            shells,
            root_shell,
            root_io: IO {
                // Set below.
                stdin: Default::default(),
                // By default stdout/stderr should be IOWriters on dup'd
                // stdout/stderr, but if the user later calls `.setQuiet(true)`
                // that work is wasted. So they start as `.pipe` and `run()`
                // upgrades them via `setup_io_before_run()` if `!quiet`.
                stdout: OutKind::Pipe,
                stderr: OutKind::Pipe,
            },
            arena,
            script_ast,
            shell_interp,
            pending_tasks: 0,
            context: None,
            async_commands_executing: 0,
            quiet: false,
            failed: false,
            // Starts at `None` so `async_cmd_done` only finishes once
            // `on_root_child_done` has recorded the real exit code.
            exit_code: None,
            vm_args_utf8: Vec::new(),
            command_ctx: ctx,
            env_loader,
        };
        interpreter.root_io.stdin = IOReader::init(&mut interpreter, stdin_fd);

        // ── optional cwd override ───────────────────────────────────────────
        if let Some(c) = cwd_ {
            interpreter.shells[root_shell].change_cwd_impl(arena, c, true)?;
        }

        Ok(interpreter)
    }
}

impl ShellInterpreter {
    fn new(
        event_loop: EventLoopHandle,
        global_this: Option<GlobalRef>,
        estimated_size_for_gc: usize,
    ) -> ShellInterpreter {
        ShellInterpreter {
            args: Cell::new(None),
            event_loop,
            keep_alive: bun_io::JsKeepAlive::default(),
            context: Cell::new(None),
            global_this,
            exit_code: Cell::new(None),
            this_value: JsRef::empty(),
            estimated_size_for_gc,
        }
    }

    /// # Safety
    /// `this` is live, and is neither moved nor borrowed mutably until it is dropped.
    unsafe fn init(
        this: NonNull<Self>,
        ctx: Option<&'static ContextData>,
        env_loader: Option<&'static DotEnvLoader>,
        mut shargs: ShellArgs,
        export_env: EnvMap<'static>,
        cwd: Option<&[u8]>,
    ) -> bun_sys::Result<()> {
        // SAFETY: caller contract.
        let me = unsafe { this.as_ref() };
        shargs.with_mut(|arena, ast, interp| {
            Interpreter::init(
                ctx,
                env_loader,
                me.event_loop,
                this,
                arena,
                *ast,
                export_env,
                cwd,
            )
            .map(|i| *interp = Some(i))
        })?;
        me.args.set(Some(shargs));
        Ok(())
    }

    /// Standalone-shell entrypoint for `bun <file>.sh`: parse `src` (already
    /// read by the caller), construct an interpreter on a `MiniEventLoop`,
    /// drive it to completion, and return the exit code. Differs from
    /// `init_and_run_from_source` only in the parse-error diagnostic wording
    /// ("Failed to run <basename>" vs "Failed to run script <name>") and in
    /// not bumping `standalone_shell` analytics.
    pub(crate) fn init_and_run_from_file(
        ctx: &ContextData,
        env_loader: &DotEnvLoader,
        path: &[u8],
        src: &[u8],
    ) -> crate::Result<ExitCode> {
        Self::init_and_run_impl(ctx, env_loader, bun_paths::basename(path), src, None, false)
    }

    /// Standalone-shell entrypoint for `bun run <script>` / `bun exec` when
    /// `--shell=bun`: parse `src`, construct an interpreter on a
    /// `MiniEventLoop`, drive it to completion via `mini.tick()`, and return
    /// the script's exit code. `path_for_errors` is only used in diagnostics.
    ///
    /// On any init/parse/run error this prints to stderr and `exit(1)`s
    /// directly; the `Result` only carries lexer/parser errors that escaped
    /// without a diagnostic.
    pub(crate) fn init_and_run_from_source(
        ctx: &ContextData,
        env_loader: &DotEnvLoader,
        path_for_errors: &[u8],
        src: &[u8],
        cwd: Option<&[u8]>,
    ) -> crate::Result<ExitCode> {
        Self::init_and_run_impl(ctx, env_loader, path_for_errors, src, cwd, true)
    }

    /// Shared body for `init_and_run_from_file` / `init_and_run_from_source`.
    /// `from_source` gates the analytics bump and the extra "script " word in
    /// the parse-error diagnostic — the only two behavioural deltas between
    /// the two entrypoints.
    fn init_and_run_impl(
        ctx: &ContextData,
        env_loader: &DotEnvLoader,
        label: &[u8],
        src: &[u8],
        cwd: Option<&[u8]>,
        from_source: bool,
    ) -> crate::Result<ExitCode> {
        if from_source {
            bun_analytics::features::standalone_shell.fetch_add(1, Ordering::Relaxed);
        }
        // We are the script's shell (`bun run <script>`, `bun exec`, `bun x.sh`).
        bun_spawn::ctrl_c::install();

        // ── parse ──────────────────────────────────────────────────────────
        let shargs = ShellArgs::init(|arena| {
            let mut out_parser: Option<bun_shell_parser::Parser<'_>> = None;
            let mut out_lex_result: Option<bun_shell_parser::LexResult<'_>> = None;
            match Interpreter::parse(arena, src, 0, &[], &mut out_parser, &mut out_lex_result) {
                Ok(s) => Ok(s),
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
        })?;

        // ── init ───────────────────────────────────────────────────────────
        let mini = bun_event_loop::MiniEventLoop::init_global();
        let evtloop = EventLoopHandle::init_mini(mini);
        // SAFETY: only `interp` keeps these borrows, and it is dropped before this returns.
        let (ctx, env_loader) = unsafe {
            (
                &*core::ptr::from_ref(ctx),
                &*core::ptr::from_ref(env_loader),
            )
        };
        let mut export_env = EnvMap::init_with_capacity(env_loader.map.map.count());
        for (key, value) in env_loader.map.map.iter() {
            export_env.insert(EnvStr::init_slice(key), EnvStr::init_slice(&value.value));
        }
        let interp = AliasableBox::new(Self::new(evtloop, None, 0));
        // SAFETY: the box keeps it in place and is never borrowed mutably.
        let result = unsafe {
            Self::init(
                interp.as_non_null(),
                Some(ctx),
                Some(env_loader),
                shargs,
                export_env,
                cwd,
            )
        };
        if let Err(e) = result {
            ShellErr::new_sys(&e).throw_mini();
        }

        // ── run ────────────────────────────────────────────────────────────
        if let Err(e) = interp.run() {
            let name = e.name();
            drop(interp);
            bun_core::output::err(
                name,
                "Failed to run script <b>{}<r>",
                (bstr::BStr::new(label),),
            );
            bun_core::Global::exit(1);
        }

        // ── tick until done ────────────────────────────────────────────────
        loop {
            if let Some(exit_code) = interp.exit_code.get() {
                return Ok(exit_code);
            }
            mini.tick_once(core::ptr::null_mut());
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// shell_state_dispatch! — single source of truth for the StateKind→handler
// table: each row declares `Variant [=> HandlerType]` once and the macro
// emits `child_done`, `next_node`, and `start_node`. Same precedent as
// `shell_builtins!` (Builtin.rs).
//
// PERF: expands to literal `match` arms — direct calls per arm so LLVM
// inlines the hot states (Stmt/Pipeline/Cmd). No vtable, no extra
// indirection.
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
        /// single hoisted `match` dispatching on the parent's state tag.
        pub(crate) fn child_done(&mut self, parent: NodeId, child: NodeId, exit_code: ExitCode) -> Yield {
            self.propagate_interrupt(parent, child);
            if parent == NodeId::INTERPRETER {
                return self.on_root_child_done(child, exit_code);
            }
            match self.nodes[parent.idx()].kind() {
                $( StateKind::$v => $h::child_done(self, parent, child, exit_code), )+
                StateKind::Free => unreachable!("child_done on freed {}", parent),
            }
        }

        /// Advance node `id` by one step. The trampoline (`Yield::run`) calls
        /// this; replaces the per-variant `&mut State` dispatch in Yield.
        pub(crate) fn next_node(&mut self, id: NodeId) -> Yield {
            match self.nodes[id.idx()].kind() {
                $( StateKind::$v => $h::next(self, id), )+
                StateKind::Free => unreachable!("next on freed {}", id),
            }
        }

        /// Start node `id`. Most states return `Yield::<Kind>(id)` immediately;
        /// the trampoline then calls `next_node`.
        pub(crate) fn start_node(&mut self, id: NodeId) -> Yield {
            match self.nodes[id.idx()].kind() {
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

impl<'a> Interpreter<'a> {
    pub(crate) fn env_loader(&self) -> &DotEnvLoader {
        self.env_loader
            .unwrap_or_else(|| bun_jsc::virtual_machine::VirtualMachine::get().env_loader())
    }

    pub(crate) fn shell_interp(&self) -> NonNull<ShellInterpreter> {
        self.shell_interp
    }

    // ── arena management ───────────────────────────────────────────────────

    /// Allocate a fresh slot in the node arena and return its id. Reuses
    /// freed slots when available.
    pub(crate) fn alloc_node(&mut self, node: Node<'a>) -> NodeId {
        if let Some(slot) = self.free_list.pop() {
            self.nodes[slot as usize] = node;
            return NodeId(slot);
        }
        let id = NodeId(self.nodes.len() as u32);
        self.nodes.push(node);
        id
    }

    /// Drop the node and recycle its slot. A `deinit` of the node's own must run first.
    pub(crate) fn free_node(&mut self, id: NodeId) {
        // Guard: callers may have stored `NodeId::NONE` in `currently_executing`
        // when `spawn_expr` failed (Subshell init error path). Nothing
        // touches `currently_executing` on that path, so the later
        // `deinit_node`/`free_node` is a no-op there too.
        if id == NodeId::NONE || id == NodeId::INTERPRETER {
            return;
        }
        let node = self.node_mut(id);
        debug_assert!(!matches!(node, Node::Free), "double-free of {}", id);
        let owned_shell = node.owned_shell();
        *node = Node::Free;
        self.free_list.push(id.0);
        if let Some(shell) = owned_shell {
            self.shells.remove(shell);
        }
    }

    /// A child that a Ctrl+C we left to it killed marks its node `interrupted`
    /// (see `bun_spawn::ctrl_c`). bash runs each member of a pipeline in its own
    /// process, so inside one the interrupt only cuts that member short — the mark
    /// flows up through the sequencing states (which finish early on it, see
    /// `interrupted`) to the member, and the pipeline takes it from its rightmost
    /// member only. Anywhere else it ends us the way it ended the child, so
    /// `a; b` and `a || b` stop at `a`.
    fn propagate_interrupt(&mut self, parent: NodeId, child: NodeId) {
        if !self.node(child).base().is_some_and(|b| b.interrupted) {
            if bun_spawn::ctrl_c::Child::alive() == 0 {
                // A Ctrl+C the job handled is used up with the job (bash resets it per wait).
                bun_spawn::ctrl_c::take_received();
            }
            return;
        }
        if parent == NodeId::INTERPRETER {
            bun_spawn::ctrl_c::exit_like_child();
        }
        if let Node::Pipeline(p) = self.node(parent) {
            let rightmost = p.cmds.as_deref().is_none_or(|c| {
                c.len() < 2
                    || matches!(c.last(), Some(crate::shell::states::pipeline::CmdOrResult::Cmd { id, .. }) if *id == child)
            });
            if rightmost {
                self.as_pipeline_mut(parent).base.interrupted = true;
            }
            return;
        }
        if !self.in_pipeline(parent) {
            bun_spawn::ctrl_c::exit_like_child();
        }
        if let Some(base) = self.node_mut(parent).base_mut() {
            base.interrupted = true;
        }
    }

    /// A sequencing state stops early: Ctrl+C cut the member short, or the script failed.
    pub(crate) fn interrupted(&self, id: NodeId) -> bool {
        self.context_stopped()
            || self.failed()
            || self.node(id).base().is_some_and(|b| b.interrupted)
    }

    /// The `Bun.ModuleGraph` whose script started this was disposed (or its realm is going).
    pub(crate) fn context_stopped(&self) -> bool {
        self.context
            .is_some_and(|id| !bun_jsc::virtual_machine::VirtualMachine::get().is_context_live(id))
    }

    /// Some ancestor is a member of a multi-command pipeline.
    fn in_pipeline(&self, mut id: NodeId) -> bool {
        while id != NodeId::INTERPRETER {
            let Some(base) = self.node(id).base() else {
                return false;
            };
            if base.parent != NodeId::INTERPRETER {
                if let Node::Pipeline(p) = self.node(base.parent) {
                    if p.cmds.as_deref().is_some_and(|c| c.len() >= 2) {
                        return true;
                    }
                }
            }
            id = base.parent;
        }
        false
    }

    /// Inside an `&` command: not a foreground job.
    pub(crate) fn in_background(&self, mut id: NodeId) -> bool {
        while id != NodeId::INTERPRETER {
            let node = self.node(id);
            if node.kind() == StateKind::Async {
                return true;
            }
            id = match node.base() {
                Some(b) => b.parent,
                None => return false,
            };
        }
        false
    }

    #[inline]
    pub(crate) fn node(&self, id: NodeId) -> &Node<'a> {
        &self.nodes[id.idx()]
    }

    #[inline]
    fn node_mut(&mut self, id: NodeId) -> &mut Node<'a> {
        &mut self.nodes[id.idx()]
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

    /// Init + start a child state node for an `ast::Expr`. For `.subshell`,
    /// dupes the parent shell env first; all other variants borrow `shell`.
    ///
    /// Note: `Async` must NOT call this — `Async` restricts its child to
    /// pipeline/cmd/if/condexpr and inits without starting (see `Async::next`).
    pub(crate) fn spawn_expr(
        &mut self,
        shell: ShellExecEnvId,
        expr: ast::Expr<'a>,
        parent: NodeId,
        io: IO,
    ) -> (Option<NodeId>, Yield) {
        let child = match expr {
            ast::Expr::Cmd(c) => Cmd::init(self, Env::Inherited(shell), c, parent, io),
            ast::Expr::Binary(b) => Binary::init(self, shell, b, parent, io),
            ast::Expr::Pipeline(p) => Pipeline::init(self, shell, p, parent, io),
            ast::Expr::Assign(a) => Assigns::init(self, shell, a, parent, AssignCtx::Shell),
            ast::Expr::If(i) => If::init(self, Env::Inherited(shell), i, parent, io),
            ast::Expr::CondExpr(c) => CondExpr::init(self, Env::Inherited(shell), c, parent, io),
            ast::Expr::Subshell(s) => {
                // Stmt/Binary callers dupe
                // the env here so `Subshell::start`/`next` can use `shell`
                // as-is. (Pipeline dupes itself and calls `Subshell::init`
                // directly, so it does NOT go through this path.)
                match Subshell::init_dupe_shell_state(self, shell, s, parent, io) {
                    Ok(id) => id,
                    Err(e) => {
                        // No child exists, so `parent` is the node that failed.
                        // Return `None` so callers leave `currently_executing`
                        // unset (no `NodeId::NONE` sentinel needed in
                        // `deinit_node`/`free_node` for this path).
                        return (None, Yield::throw(parent, ShellErr::new_sys(&e)));
                    }
                }
            }
            ast::Expr::Async(e) => Async::init(self, shell, e, parent, io),
        };
        let y = self.start_node(child);
        (Some(child), y)
    }

    /// Run the per-state cleanup, then recycle the slot.
    pub(crate) fn deinit_node(&mut self, id: NodeId) {
        // Guard the `NodeId::NONE` sentinel: `spawn_expr` returns it on
        // Subshell init failure, and Stmt/Binary `currently_executing` may
        // hold it. Indexing `nodes[u32::MAX-1]` would be OOB.
        if id == NodeId::NONE || id == NodeId::INTERPRETER {
            return;
        }
        // NOTE: keep in sync with shell_state_dispatch! table (irregular Async/Free arms keep this hand-rolled for v1).
        match self.nodes[id.idx()].kind() {
            StateKind::Stmt => Stmt::deinit(self, id),
            StateKind::Binary => Binary::deinit(self, id),
            StateKind::Pipeline => Pipeline::deinit(self, id),
            StateKind::Cmd => Cmd::deinit(self, id),
            StateKind::Expansion => Expansion::deinit(self, id),
            StateKind::Async => return, // Freed by `async_cmd_done`.
            StateKind::Script
            | StateKind::Assign
            | StateKind::IfClause
            | StateKind::Condexpr
            | StateKind::Subshell => {}
            StateKind::Free => return,
        }
        self.free_node(id);
    }

    // ── root (Interpreter-as-parent) ───────────────────────────────────────

    fn on_root_child_done(&mut self, child: NodeId, exit_code: ExitCode) -> Yield {
        // Only `Script` can be a direct child of the interpreter.
        debug_assert!(matches!(self.nodes[child.idx()], Node::Script(_)));
        log!("Interpreter script finish {}", exit_code);
        self.free_node(child);
        self.exit_code = Some(exit_code);
        if self.async_commands_executing == 0 {
            return self.finish(exit_code);
        }
        Yield::suspended()
    }

    pub(crate) fn async_cmd_done(&mut self, async_id: NodeId) -> Yield {
        self.free_node(async_id);
        self.async_commands_executing -= 1;
        if self.async_commands_executing == 0 {
            if let Some(exit) = self.exit_code {
                return self.finish(exit);
            }
        }
        Yield::done()
    }

    /// See [`IOWriter::enqueue`].
    pub(crate) fn enqueue(&mut self, fd: OutFd, child: io_writer::ChildPtr, buf: &[u8]) -> Yield {
        self.io_writers[fd.writer].enqueue(&mut self.shells, child, fd.captured, buf)
    }

    /// See [`IOWriter::enqueue_fmt_bltn`].
    pub(crate) fn enqueue_fmt(
        &mut self,
        fd: OutFd,
        child: io_writer::ChildPtr,
        kind: Option<crate::shell::builtin::Kind>,
        args: fmt::Arguments<'_>,
    ) -> Yield {
        self.io_writers[fd.writer].enqueue_fmt_bltn(
            &mut self.shells,
            child,
            fd.captured,
            kind,
            args,
        )
    }

    pub(crate) fn memory_cost(&self) -> usize {
        let mut size = self.shells[self.root_shell].memory_cost();
        size += self.root_io.memory_cost(self);
        for arg in &self.vm_args_utf8 {
            size += arg.slice().len();
        }
        size += self.vm_args_utf8.capacity() * core::mem::size_of::<bun_core::Utf8Bytes>();
        size
    }
}

impl ShellInterpreter {
    /// `f` must not run JS or I/O callbacks. `None` once the script has finished.
    pub(crate) fn with_interp<R>(
        &self,
        f: impl for<'a> FnOnce(&mut Interpreter<'a>) -> R,
    ) -> Option<R> {
        self.args.with_taken(|args| {
            debug_assert!(
                args.is_some() || self.exit_code.get().is_some(),
                "with_interp called inside with_interp"
            );
            args.as_mut()?
                .with_mut(|_, _, interp| interp.as_mut().map(f))
        })
    }

    /// Runs the `Yield` that `f` returns.
    pub(crate) fn run_yield_with(&self, f: impl for<'a> FnOnce(&mut Interpreter<'a>) -> Yield) {
        if let Some(y) = self.with_interp(f) {
            self.run_yield(y, DeferredStack::new());
        }
    }

    pub(crate) fn run_yield(&self, mut y: Yield, mut stack: DeferredStack) {
        let _keep = self.ensure_still_alive();
        let mut rejection = None;
        while let Some(Some(action)) = self.with_interp(|interp| y.run(interp, &mut stack)) {
            let (node, result) = match action {
                ReentrantAction::Throw(node, err) => (node, Err(self.throw(*err))),
                ReentrantAction::StartBuiltinWithJsBuf(cmd, redirect) => (
                    cmd,
                    Builtin::start_with_jsbuf_redirection(self, cmd, redirect),
                ),
                ReentrantAction::Spawn(cmd) => (cmd, Cmd::spawn(self, cmd)),
                ReentrantAction::TickMiniLoop(cmd) => (cmd, Ok(Yes::tick_mini_loop(self, cmd))),
                ReentrantAction::Finish(exit_code) => {
                    self.finish(exit_code);
                    break;
                }
            };
            y = result.unwrap_or_else(|err| {
                rejection = self.take_failure(err).or(rejection);
                Yield::Failed(node)
            });
        }
        if let Some(rejection) = rejection {
            self.reject(rejection);
        }
    }

    /// For callers that use `self` after `finish` may have dropped the strong `this_value`.
    pub(crate) fn ensure_still_alive(&self) -> bun_jsc::EnsureStillAlive {
        bun_jsc::EnsureStillAlive(self.this_value.get())
    }

    /// Whose script the shell's completion continues.
    fn task_context(&self) -> bun_jsc::ContextId {
        self.context.get().unwrap_or(bun_jsc::ContextId::NONE)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.args.with_taken(|args| {
            args.as_mut().map_or(0, |args| {
                args.memory_cost()
                    + args.with_mut(|_, _, interp| interp.as_ref().map_or(0, |i| i.memory_cost()))
            })
        })
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.estimated_size_for_gc
    }

    /// `None` on the mini-event-loop path.
    #[inline]
    pub(crate) fn global_this_ref(&self) -> Option<&crate::jsc::JSGlobalObject> {
        self.global_this.as_deref()
    }

    /// The `idx`th JS object interpolated into the script.
    pub(crate) fn jsobj(
        &self,
        global: &crate::jsc::JSGlobalObject,
        idx: u32,
    ) -> crate::jsc::JsResult<crate::jsc::JSValue> {
        let jsobj = match self.this_value.try_get().and_then(js::jsobjs_get_cached) {
            Some(jsobjs) => jsobjs.get_direct_index(global, idx)?,
            None => crate::jsc::JSValue::ZERO,
        };
        if jsobj.is_empty() {
            return Err(global.throw(format_args!("Invalid JS object reference in shell")));
        }
        Ok(jsobj)
    }

    /// `mini` prints and exits(1); `js` raises a JS exception. Dispatch on
    /// `global_this` (set only on the JS event-loop path by
    /// `create_shell_interpreter`).
    pub(crate) fn throw(&self, err: ShellErr) -> crate::jsc::JsError {
        let Some(global) = self.global_this_ref() else {
            // Mini event loop — diverges (exit 1).
            err.throw_mini();
        };
        err.throw_js(global)
    }
}

impl Interpreter<'_> {
    // ── run loop ───────────────────────────────────────────────────────────

    /// When `!quiet`, dup stdout/stderr (or open
    /// the null device if the process was started with that stream closed),
    /// wrap each in an `IOWriter`, and install them as `root_io.stdout/stderr`
    /// so command output reaches the terminal. On the JS event loop the
    /// `captured` slot is also wired to `_buffered_stdout/err` so
    /// `Bun.$` callers can read it back.
    fn setup_io_before_run(&mut self) -> bun_sys::Result<()> {
        if self.quiet {
            return Ok(());
        }

        // ── dup stdout ─────────────────────────────────────────────────────
        log!("Duping stdout");
        let stdout = File::from_fd(if bun_core::output::stdio::is_stdout_null() {
            open_null_device()?
        } else {
            shell_dup(Fd::stdout())?
        });

        // ── dup stderr ─────────────────────────────────────────────────────
        log!("Duping stderr");
        let stderr_fd = if bun_core::output::stdio::is_stderr_null() {
            open_null_device()?
        } else {
            shell_dup(Fd::stderr())?
        };

        let stdout_fd = stdout.into_raw();
        let stdout_writer = IOWriter::init(
            self,
            stdout_fd,
            crate::shell::io_writer::Flags {
                pollable: is_pollable(stdout_fd),
                ..Default::default()
            },
        );
        let stderr_writer = IOWriter::init(
            self,
            stderr_fd,
            crate::shell::io_writer::Flags {
                pollable: is_pollable(stderr_fd),
                ..Default::default()
            },
        );

        // On the JS event loop, hook captured buffers so the JS
        // `Bun.$` API can read stdout/stderr after completion. The mini path
        // does not capture (it writes straight to the dup'd fd).
        let captured = |kind| {
            matches!(self.event_loop, EventLoopHandle::Js { .. })
                .then(|| self.shells.bufio_id(self.root_shell, kind))
        };

        self.root_io.stdout = OutKind::Fd(OutFd {
            writer: stdout_writer,
            captured: captured(IoKind::Stdout),
        });
        self.root_io.stderr = OutKind::Fd(OutFd {
            writer: stderr_writer,
            captured: captured(IoKind::Stderr),
        });

        Ok(())
    }

    fn start(&mut self) -> Yield {
        let (shell, ast, io) = (self.root_shell, self.script_ast, self.root_io);
        let root = Script::init(self, Env::Inherited(shell), ast, NodeId::INTERPRETER, io);
        Script::start(self, root)
    }

    fn finish(&self, exit_code: ExitCode) -> Yield {
        debug_assert_eq!(self.free_list.len(), self.nodes.len());
        debug_assert_eq!(self.shells.count(), 1);
        debug_assert_eq!(self.io_readers.count(), 1);
        debug_assert_eq!(self.io_writers.count(), if self.quiet { 0 } else { 2 });
        Yield::Action(ReentrantAction::Finish(exit_code))
    }

    fn take_buffered(&mut self, kind: IoKind) -> Vec<u8> {
        core::mem::take(self.shells.buffered_mut(self.root_shell, kind))
    }

    /// A node threw a JS error (`fail`): the script winds down and `finish` settles nothing.
    #[inline]
    pub(crate) fn failed(&self) -> bool {
        self.failed
    }

    /// Node `id` threw and holds nothing in flight: kill the subprocesses and wind the tree down.
    pub(crate) fn fail(&mut self, id: NodeId) -> Yield {
        self.failed = true;
        for node in &self.nodes {
            if let Node::Cmd(cmd) = node {
                cmd.kill_subprocess();
            }
        }
        let parent = self
            .node(id)
            .base()
            .map_or(NodeId::INTERPRETER, |b| b.parent);
        self.child_done(parent, id, 1)
    }
}

impl ShellInterpreter {
    pub(crate) fn run(&self) -> bun_sys::Result<()> {
        log!("Interpreter(0x{:x}) run", std::ptr::from_ref(self) as usize);
        self.with_interp(|interp| interp.setup_io_before_run())
            .transpose()?;
        self.run_yield_with(|interp| interp.start());
        Ok(())
    }

    fn finish(&self, exit_code: ExitCode) {
        use crate::jsc::JSValue;

        log!(
            "Interpreter(0x{:x}) finish {}",
            std::ptr::from_ref(self) as usize,
            exit_code
        );

        self.exit_code.set(Some(exit_code));
        let output = self.with_interp(|interp| {
            assert_eq!(interp.pending_tasks, 0, "script finished before its tasks");
            [IoKind::Stdout, IoKind::Stderr].map(|kind| interp.take_buffered(kind))
        });
        // Frees what the script ran on without waiting for the wrapper to be collected.
        self.args.set(None);
        let Some(global_this) = self.global_this_ref() else {
            return;
        };
        self.keep_alive.disable();

        // Roots the wrapper until the promise is settled.
        let this_value = self.this_value.take();
        let (Some(this_jsvalue), Some([stdout, stderr])) = (this_value.try_get(), output) else {
            return;
        };
        // `None` after `take_failure`: `run_yield` rejects the promise.
        let Some(resolve) = js::resolve_get_cached(this_jsvalue) else {
            return;
        };
        let buffers = io_to_js_value(global_this, stdout)
            .and_then(|out| Ok((out, io_to_js_value(global_this, stderr)?)));
        let _entered = self.event_loop.entered();
        // `run_callback` reports what the callback throws. A terminating VM settles nothing.
        let event_loop = global_this.bun_vm().event_loop();
        match buffers {
            Ok((buffered_stdout, buffered_stderr)) => event_loop.run_callback(
                self.task_context(),
                resolve,
                global_this,
                JSValue::UNDEFINED,
                &[
                    JSValue::js_number_from_int32(i32::from(exit_code)),
                    buffered_stdout,
                    buffered_stderr,
                ],
            ),
            Err(err) if !global_this.has_pending_termination_exception() => {
                let error = global_this.take_error(err);
                if let Some(reject) = js::reject_get_cached(this_jsvalue) {
                    event_loop.run_callback(
                        self.task_context(),
                        reject,
                        global_this,
                        JSValue::UNDEFINED,
                        &[error],
                    );
                }
            }
            Err(_) => {}
        }
        js::resolve_set_cached(this_jsvalue, global_this, JSValue::UNDEFINED);
        js::reject_set_cached(this_jsvalue, global_this, JSValue::UNDEFINED);
    }

    /// Runs JS, which can turn the event loop and free any node of the script.
    fn reject(&self, (reject, error): Rejection) {
        let global_this = self
            .global_this_ref()
            .expect("take_failure returned a rejection on the Js path");
        let _entered = self.event_loop.entered();
        global_this.bun_vm().event_loop().run_callback(
            self.task_context(),
            reject,
            global_this,
            crate::jsc::JSValue::UNDEFINED,
            &[error],
        );
    }

    /// Take the exception; `Some` when the promise still has to be rejected.
    fn take_failure(&self, err: crate::jsc::JsError) -> Option<Rejection> {
        // Mini event loop: `ShellInterpreter::throw` prints and exits instead.
        let global_this = self.global_this_ref()?;
        log!(
            "Interpreter(0x{:x}) take failure",
            std::ptr::from_ref(self) as usize
        );

        // A termination (`worker.terminate()`) settles nothing, and keeps unwinding if it is pending.
        let error = (!global_this.has_pending_termination_exception())
            .then(|| global_this.take_error(err))
            .filter(|error| !error.is_termination_exception());

        // `None` when a second pipeline member failed: the promise is already rejected.
        let this_jsvalue = self.this_value.try_get()?;
        js::resolve_take_cached(this_jsvalue, global_this)?;
        let reject = js::reject_take_cached(this_jsvalue, global_this)?;
        Some((reject, error?))
    }

    /// JS-host entrypoint — sets up root IO
    /// (unless quiet), spawns the root `Script` node, and starts ticking.
    pub(crate) fn run_from_js(&self, cx: &mut JsScope<'_>) -> crate::jsc::JsResult<()> {
        let global_this = cx.global();
        log!(
            "Interpreter(0x{:x}) runFromJS",
            std::ptr::from_ref(self) as usize
        );

        if let Some(Err(e)) = self.with_interp(|interp| interp.setup_io_before_run()) {
            self.args.set(None);
            return Err(ShellErr::new_sys(&e).throw_js(global_this));
        }
        self.this_value.upgrade(global_this);
        let vm = global_this.bun_vm();
        self.context.set(
            vm.as_graph_context(vm.context_of_caller())
                .map(bun_jsc::ScriptExecutionContext::id),
        );

        self.run_yield_with(|interp| {
            interp.context = self.context.get();
            interp.start()
        });
        if global_this.has_exception() {
            return Err(crate::jsc::JsError::Thrown);
        }

        Ok(())
    }
}

impl Interpreter<'_> {
    /// Appends the value of `$N` to
    /// `out`. Takes the relevant interpreter fields by-part so callers can
    /// split-borrow alongside the node arena.
    pub(crate) fn append_var_argv(
        out: &mut Vec<u8>,
        original_int: u8,
        event_loop: EventLoopHandle,
        command_ctx: Option<&ContextData>,
        vm_args_utf8: &mut Vec<bun_core::Utf8Bytes<'static>>,
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
                if let Some(main) = vm.main() {
                    if int == 0 {
                        out.extend_from_slice(main);
                        return;
                    }
                    int -= 1;
                }

                if let Some(worker) = vm.worker_ref() {
                    let argv = worker.argv();
                    if int as usize >= argv.len() {
                        return;
                    }
                    if vm_args_utf8.len() != argv.len() {
                        vm_args_utf8.reserve(argv.len());
                        for arg in argv {
                            vm_args_utf8
                                .push(crate::node::process::worker_option_string(*arg).into_utf8());
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
                let Some(ctx) = command_ctx else {
                    return;
                };
                if int as usize > ctx.passthrough.len() {
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

impl Drop for ShellInterpreter {
    fn drop(&mut self) {
        log!(
            "Interpreter(0x{:x}) drop",
            std::ptr::from_ref(self) as usize
        );
        // `this_value` is strong while the script runs, so only VM shutdown finds a `Cmd` here.
        let Some(args) = self.args.get_mut() else {
            return;
        };
        args.with_mut(|_, _, interp| {
            for node in interp.iter_mut().flat_map(|interp| &mut interp.nodes) {
                if let Node::Cmd(cmd) = node {
                    cmd.defuse_array_buf_pins();
                    // On Windows a child outlives the VM that spawned it.
                    #[cfg(not(windows))]
                    cmd.kill_subprocess();
                }
            }
        });
    }
}

/// Moves the captured stdout/stderr
/// `Vec<u8>` into a JS `Buffer` (ownership transfers to JSC's deallocator).
fn io_to_js_value(
    global_this: &crate::jsc::JSGlobalObject,
    bytelist: Vec<u8>,
) -> bun_jsc::JsResult<crate::jsc::JSValue> {
    // The moved-out `Vec<u8>` storage is handed to JSC directly; the
    // `Vec<u8>` value itself is `mem::forget`-ed since JSC now owns the bytes.
    let mut bytelist = core::mem::ManuallyDrop::new(bytelist);
    crate::jsc::JSValue::create_buffer(global_this, bytelist.slice_mut())
}

// ────────────────────────────────────────────────────────────────────────────
// ShellExecEnv
// ────────────────────────────────────────────────────────────────────────────

/// Shell execution environment (env vars, cwd, captured stdout/stderr).
pub(crate) struct ShellExecEnv<'a> {
    pub(crate) _buffered_stdout: Bufio,
    pub(crate) _buffered_stderr: Bufio,
    pub(crate) shell_env: EnvMap<'a>,
    pub(crate) cmd_local_env: EnvMap<'a>,
    pub(crate) export_env: EnvMap<'a>,
    __prev_cwd: &'a [u8],
    __cwd: &'a [u8],
    pub(crate) cwd_fd: OwnedFd,
}

pub(crate) enum Bufio {
    Owned(Vec<u8>),
    Borrowed(BufioId),
}

impl Default for Bufio {
    fn default() -> Self {
        Bufio::Owned(Vec::<u8>::default())
    }
}

impl Bufio {
    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Bufio::Owned(o) => o.memory_cost(),
            Bufio::Borrowed(_) => 0,
        }
    }
}

pub(crate) type ShellExecEnvId = bun_core::GenericIndex<u32, ShellExecEnv<'static>>;

pub(crate) type ShellExecEnvs<'a> = Slots<ShellExecEnv<'a>, ShellExecEnv<'static>>;

/// Refers to a [`Bufio::Owned`].
#[derive(Clone, Copy)]
pub(crate) struct BufioId {
    shell: ShellExecEnvId,
    kind: IoKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum ShellExecEnvKind {
    #[default]
    Normal,
    CmdSubst,
    Subshell,
    Pipeline,
}

impl<'a> ShellExecEnv<'a> {
    pub(crate) fn memory_cost(&self) -> usize {
        let mut size = core::mem::size_of::<ShellExecEnv>();
        size += self.shell_env.memory_cost();
        size += self.cmd_local_env.memory_cost();
        size += self.export_env.memory_cost();
        size += self._buffered_stderr.memory_cost();
        size += self._buffered_stdout.memory_cost();
        size
    }

    #[inline]
    pub(crate) fn cwd(&self) -> &'a [u8] {
        self.__cwd
    }

    #[inline]
    pub(crate) fn prev_cwd(&self) -> &'a [u8] {
        self.__prev_cwd
    }

    fn bufio(&self, kind: IoKind) -> &Bufio {
        match kind {
            IoKind::Stdout => &self._buffered_stdout,
            IoKind::Stderr => &self._buffered_stderr,
        }
    }
}

impl ShellExecEnvs<'_> {
    fn bufio_id(&self, shell: ShellExecEnvId, kind: IoKind) -> BufioId {
        match self[shell].bufio(kind) {
            Bufio::Owned(_) => BufioId { shell, kind },
            Bufio::Borrowed(id) => *id,
        }
    }

    /// The buffer of `shell`, or the one it borrows (see `dupe_for_subshell`).
    pub(crate) fn buffered_mut(&mut self, shell: ShellExecEnvId, kind: IoKind) -> &mut Vec<u8> {
        self.captured_mut(self.bufio_id(shell, kind))
    }

    pub(crate) fn captured(&self, id: BufioId) -> &Vec<u8> {
        match self[id.shell].bufio(id.kind) {
            Bufio::Owned(buf) => buf,
            Bufio::Borrowed(_) => unreachable!(),
        }
    }

    pub(crate) fn captured_mut(&mut self, id: BufioId) -> &mut Vec<u8> {
        let shell = &mut self[id.shell];
        let bufio = match id.kind {
            IoKind::Stdout => &mut shell._buffered_stdout,
            IoKind::Stderr => &mut shell._buffered_stderr,
        };
        match bufio {
            Bufio::Owned(buf) => buf,
            Bufio::Borrowed(_) => unreachable!(),
        }
    }

    /// Inserts a
    /// fresh env for a subshell/pipeline child: dups `cwd_fd`, clones
    /// `shell_env`/`export_env`, gives it a fresh empty `cmd_local_env`, and
    /// borrows or owns buffered stdout/stderr per `kind` (subshell/pipeline
    /// borrow the parent's buffers so output bubbles up; cmd-subst owns).
    /// The caller removes it.
    pub(crate) fn dupe_for_subshell(
        &mut self,
        parent: ShellExecEnvId,
        io: IO,
        kind: ShellExecEnvKind,
    ) -> bun_sys::Result<ShellExecEnvId> {
        let env = &self[parent];
        let cwd_fd = OwnedFd(bun_sys::dup(env.cwd_fd.fd())?);

        // For `.fd` with a captured buffer, borrow that; for `.pipe`,
        // own when normal/cmd_subst, borrow parent's when subshell/pipeline.
        let bufio_for = |out: OutKind, io_kind: IoKind| -> Bufio {
            match out {
                OutKind::Fd(f) => match f.captured {
                    Some(cap) => Bufio::Borrowed(cap),
                    None => Bufio::Owned(Vec::<u8>::default()),
                },
                OutKind::Pipe => match kind {
                    ShellExecEnvKind::Normal | ShellExecEnvKind::CmdSubst => {
                        Bufio::Owned(Vec::<u8>::default())
                    }
                    ShellExecEnvKind::Subshell | ShellExecEnvKind::Pipeline => {
                        Bufio::Borrowed(self.bufio_id(parent, io_kind))
                    }
                },
            }
        };

        let duped = ShellExecEnv {
            _buffered_stdout: bufio_for(io.stdout, IoKind::Stdout),
            _buffered_stderr: bufio_for(io.stderr, IoKind::Stderr),
            shell_env: env.shell_env.clone(),
            cmd_local_env: EnvMap::init(),
            export_env: env.export_env.clone(),
            __prev_cwd: env.__prev_cwd,
            __cwd: env.__cwd,
            cwd_fd,
        };
        Ok(self.insert(duped))
    }
}

impl<'a> ShellExecEnv<'a> {
    /// Thin `in_init = false` wrapper. Accepts the un-terminated slice and
    /// lets `change_cwd_impl` re-NUL into its join buffer.
    #[inline]
    pub(crate) fn change_cwd(
        &mut self,
        arena: &'a bun_alloc::Arena,
        new_cwd: &[u8],
    ) -> bun_sys::Result<()> {
        self.change_cwd_impl(arena, new_cwd, false)
    }

    /// Resolves `new_cwd_` (absolute, or relative to current `cwd()`), opens it
    /// with `O_DIRECTORY`, and on success rotates `__cwd`/`__prev_cwd`/`cwd_fd`.
    /// Always writes `PWD` into `export_env`; `OLDPWD` is written only when
    /// `!in_init` (the very first cwd has no meaningful "previous").
    pub(crate) fn change_cwd_impl(
        &mut self,
        arena: &'a bun_alloc::Arena,
        new_cwd_: &[u8],
        in_init: bool,
    ) -> bun_sys::Result<()> {
        let is_abs = bun_paths::is_absolute(new_cwd_);

        // Bounds-check against a `[4096]u8` buffer on *every* platform. Do NOT
        // use `bun_paths::PathBuffer` here: on Windows that is `MAX_PATH_BYTES
        // = 32767*3+1` ≈ 96 KiB of zero-filled stack per `cd`, and the
        // `>= buf.len()` check would change the ENAMETOOLONG bound.
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
            new_cwd_.len()
        } else {
            // `join_z_buf` normalizes `.`/`..` so the stored `$PWD`/`$OLDPWD`
            // strings reflect the resolved path (not `<cwd>/..`).
            // Note: reshaped for borrowck — capture only the joined length
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
            // remove trailing separator (Windows checks `\\` first then falls
            // through to `/`; POSIX only `/`).
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
            n
        };
        let new_cwd_z = bun_core::ZStr::nul_terminate(&mut buf, new_cwd_len);

        self.cwd_fd = OwnedFd(shell_openat(
            self.cwd_fd.fd(),
            new_cwd_z,
            bun_sys::O::DIRECTORY | bun_sys::O::RDONLY,
            0,
        )?);

        self.__prev_cwd = self.__cwd;
        self.__cwd = arena.alloc_slice_copy(new_cwd_z.as_bytes());

        // Only `OLDPWD` is gated on `!in_init`;
        // `PWD` is written unconditionally so the very first env (built during
        // `init()` with `in_init = true`) still exports the resolved cwd.
        if !in_init {
            let oldpwd = EnvStr::init_slice(self.prev_cwd());
            self.export_env
                .insert(EnvStr::init_slice(b"OLDPWD"), oldpwd);
        }
        let pwd = EnvStr::init_slice(self.cwd());
        self.export_env.insert(EnvStr::init_slice(b"PWD"), pwd);

        Ok(())
    }

    /// Routes `label = value` into an env map depending on where the
    /// assignment appeared (`FOO=1 cmd` → cmd-local, bare `FOO=1` → shell).
    pub(crate) fn assign_var(
        &mut self,
        label: EnvStr<'a>,
        value: EnvStr<'a>,
        assign_ctx: AssignCtx,
    ) {
        match assign_ctx {
            AssignCtx::Cmd => self.cmd_local_env.insert(label, value),
            AssignCtx::Shell => self.shell_env.insert(label, value),
        }
    }

    /// Looks up `$HOME` (`$USERPROFILE` on Windows) in `shell_env` first, then
    /// `export_env`. Falls back to `""` (or `/data/local/tmp` on Android) so
    /// `cd` with no args / `~` expansion never sees a null.
    pub(crate) fn get_homedir(&self) -> &[u8] {
        let key: &[u8] = if cfg!(windows) {
            b"USERPROFILE"
        } else {
            b"HOME"
        };
        self.shell_env
            .get(key)
            .or_else(|| self.export_env.get(key))
            .unwrap_or(if bun_core::env::IS_ANDROID {
                b"/data/local/tmp"
            } else {
                b""
            })
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ShellArgs (arena, AST and `Interpreter`)
// ────────────────────────────────────────────────────────────────────────────

pub(crate) struct ShellArgs(AliasableBox<ShellArgsInner>);

/// `'static` stands for the borrow of `__arena`, see [`ShellArgs::with_mut`].
struct ShellArgsInner {
    /// Arena owning the parsed AST nodes, tokens, and string pool.
    __arena: bun_alloc::Arena,
    /// Root AST node.
    script_ast: ast::Script<'static>,
    /// Set by [`ShellInterpreter::init`].
    interp: Option<Interpreter<'static>>,
}

impl Drop for ShellArgs {
    fn drop(&mut self) {
        self.with_mut(|_, _, interp| *interp = None);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// EventLoopHandle
// ────────────────────────────────────────────────────────────────────────────

/// `bun.jsc.EventLoopHandle` — tagged union over `{ js: *JSEventLoop, mini:
/// *MiniEventLoop }`. The real type lives in
/// `bun_event_loop` and re-exported through `bun_jsc`; shell re-exports it
/// here so `IOReader`/`IOWriter`/builtin tasks keep their existing import path.
pub(crate) use bun_event_loop::EventLoopHandle;

// ────────────────────────────────────────────────────────────────────────────
// Convenience re-exports for state modules
// ────────────────────────────────────────────────────────────────────────────

pub(crate) use crate::shell::io_reader::IOReader;
pub(crate) use crate::shell::io_writer::IOWriter;
pub(crate) use crate::shell::states::assigns::AssignCtx;

/// Open `/dev/null` `O_RDWR`
/// on POSIX, `nul` on Windows. Used when a stdio stream was closed at process
/// start so we have *something* to dup into the shell's root IO. Must be
/// writable: `setup_io_before_run` installs the result as the stdout/stderr
/// `IOWriter` target (and `init` uses it for stdin), so `RDWR` covers both.
fn open_null_device() -> bun_sys::Result<Fd> {
    #[cfg(unix)]
    {
        bun_sys::open(bun_core::zstr!("/dev/null"), bun_sys::O::RDWR, 0)
    }
    #[cfg(windows)]
    {
        // Windows NUL is bidirectional regardless of the open flags.
        bun_sys::open(bun_core::zstr!("nul"), bun_sys::O::RDWR, 0)
    }
}

/// `false` (synchronous writes) if `fstat` fails, as on Windows.
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

/// Same test as [`is_pollable`] minus the `isatty()` check — used when the
/// caller already has a cached `st_mode` (e.g. from `Builtin` stdio setup) and
/// no fd is at hand.
pub(crate) fn is_pollable_from_mode(mode: bun_sys::Mode) -> bool {
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

/// Unlike `Dir`, leaves a descriptor that landed on 0-2 open. Unlike `File`, tolerates EBADF.
pub(crate) struct OwnedFd(pub(crate) Fd);

impl OwnedFd {
    pub(crate) fn fd(&self) -> Fd {
        self.0
    }
}

impl Drop for OwnedFd {
    fn drop(&mut self) {
        use bun_sys::FdExt;
        if self.0.is_valid() {
            let _ = self.0.close_allowing_bad_file_descriptor(None);
        }
    }
}

/// Same as `bun_sys::dup` on POSIX; on Windows the duped handle is converted
/// to a libuv-owned fd via `makeLibUVOwnedForSyscall(.dup, .close_on_fail)` so
/// the IOWriter/IOReader uv-based async write/read paths receive a uv fd
/// instead of a raw NT handle.
pub(crate) fn shell_dup(fd: Fd) -> bun_sys::Result<Fd> {
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

/// Joins `parts` into an owned, normalized path. Fails with `ENAMETOOLONG` if the result is
/// too long for the `MAX_PATH_BYTES` buffers that the fs layers copy paths into.
pub(crate) fn shell_join_path(
    syscall: bun_sys::Tag,
    parts: &[&[u8]],
) -> bun_sys::Result<bun_core::ZBox> {
    let mut spill = Vec::new();
    let joined =
        bun_paths::resolve_path::join_spill::<bun_paths::platform::Auto>(&mut spill, parts);
    if joined.len() >= bun_paths::MAX_PATH_BYTES {
        return Err(bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, syscall).with_path(joined));
    }
    Ok(bun_core::ZBox::from_bytes(joined))
}

/// Resolves a builtin's path `operand` against the shell's `cwd`.
pub(crate) fn shell_resolve_operand(
    syscall: bun_sys::Tag,
    cwd: &[u8],
    operand: &[u8],
) -> bun_sys::Result<bun_core::ZBox> {
    if bun_paths::Platform::AUTO.is_absolute(operand) {
        shell_join_path(syscall, &[operand])
    } else {
        shell_join_path(syscall, &[cwd, operand])
    }
}

/// Windows-only: rewrite shell paths so POSIX-absolute `/foo` resolves onto
/// `dirfd`'s drive root, `/dev/null` maps to `NUL`, and relative paths are
/// joined against `dirfd`'s real path. Returns a NUL-terminated slice that
/// either borrows `buf` or is `to` itself. Fails with `ENAMETOOLONG` (tagged
/// with `syscall` and `to`) if the rewritten path is too long for `buf`.
#[cfg(windows)]
fn shell_get_path<'a>(
    dirfd: Fd,
    to: &'a bun_core::ZStr,
    buf: &'a mut bun_paths::PathBuffer,
    syscall: bun_sys::Tag,
) -> bun_sys::Result<&'a bun_core::ZStr> {
    if to.as_bytes() == b"/dev/null" {
        return Ok(crate::shell::shell_body::WINDOWS_DEV_NULL);
    }
    let name_too_long =
        || bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, syscall).with_path(to.as_bytes());
    if bun_paths::Platform::Posix.is_absolute(to.as_bytes()) {
        let source_root_len = {
            let dirpath = bun_sys::get_fd_path(dirfd, buf).map_err(|e| e.with_fd(dirfd))?;
            bun_paths::resolve_path::windows_filesystem_root(dirpath).len()
        };
        // `dirpath` already occupies `buf[0..]` and the root is its prefix, so
        // no copy is needed. Splice `to[1..]` after the root.
        let to_tail = &to.as_bytes()[1..];
        let end = source_root_len + to_tail.len();
        if end >= buf.len() {
            return Err(name_too_long());
        }
        buf[source_root_len..end].copy_from_slice(to_tail);
        return Ok(bun_core::ZStr::nul_terminate(buf, end));
    }
    if bun_paths::Platform::Windows.is_absolute(to.as_bytes()) {
        return Ok(to);
    }
    // Relative path. Join outside `buf` because `join_z_buf` doesn't bounds-check,
    // then copy the normalized result into `buf` if there's room.
    let mut spill = Vec::new();
    let joined = {
        let dirpath = bun_sys::get_fd_path(dirfd, buf).map_err(|e| e.with_fd(dirfd))?;
        bun_paths::resolve_path::join_spill::<bun_paths::platform::Auto>(
            &mut spill,
            &[dirpath, to.as_bytes()],
        )
    };
    bun_core::strings::copy_z(buf, joined).ok_or_else(name_too_long)
}

/// Windows: rewrite the path via `shell_get_path` then `bun_sys::stat`, tagging
/// the error with the *original* `path_` (not the rewritten one). POSIX: plain
/// `bun_sys::fstatat(dir, path_)`.
// consumed by states/CondExpr (`[[ -e/-f/-d ... ]]`) and the `ls` builtin
pub(crate) fn shell_statat(dir: Fd, path_: &bun_core::ZStr) -> bun_sys::Result<bun_sys::Stat> {
    #[cfg(windows)]
    {
        let mut buf = bun_paths::path_buffer_pool::get();
        let p = shell_get_path(dir, path_, &mut buf, bun_sys::Tag::fstatat)?;
        return bun_sys::stat(p).map_err(|e| e.with_path(path_.as_bytes()));
    }
    #[cfg(not(windows))]
    {
        bun_sys::fstatat(dir, path_)
    }
}

/// `shell_statat` without following a final symlink.
pub(crate) fn shell_lstatat(dir: Fd, path_: &bun_core::ZStr) -> bun_sys::Result<bun_sys::Stat> {
    #[cfg(windows)]
    {
        let mut buf = bun_paths::path_buffer_pool::get();
        let p = shell_get_path(dir, path_, &mut buf, bun_sys::Tag::fstatat)?;
        return bun_sys::lstat(p).map_err(|e| e.with_path(path_.as_bytes()));
    }
    #[cfg(not(windows))]
    {
        bun_sys::lstatat(dir, path_)
    }
}

/// POSIX: `bun_sys::openat` with the error tagged `.with_path(path)`.
/// Windows: for `O_DIRECTORY` opens, rewrite POSIX-absolute paths via
/// `shell_get_path` and use `openDirAtWindowsA(.iterable=true)` +
/// `makeLibUVOwnedForSyscall`; for file opens, resolve via `shell_get_path`
/// then `bun_sys::open`.
pub(crate) fn shell_openat(
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
                let p = shell_get_path(dir, path, &mut buf, bun_sys::Tag::open)?;
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
        let p = shell_get_path(dir, path, &mut buf, bun_sys::Tag::open)?;
        // No `makeLibUVOwnedForSyscall` here: `bun_sys::open` on Windows
        // routes through `sys_uv` and already yields a uv-owned fd.
        return bun_sys::open(p, flags, perm);
    }
    #[cfg(not(windows))]
    {
        bun_sys::openat(dir, path, flags, perm).map_err(|e| e.with_path(path.as_bytes()))
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Builtin flag-parsing infra
// ────────────────────────────────────────────────────────────────────────────

/// Custom parse error for invalid options.
///
/// Payload slices borrow from the builtin's argv or are `'static` literals.
pub(crate) enum ParseError<'a> {
    IllegalOption(&'a [u8]),
    Unsupported(&'a [u8]),
    ShowUsage,
}

impl<'a> ParseError<'a> {
    /// The option-name payload.
    #[inline]
    pub(crate) fn opt(&self) -> &'a [u8] {
        match *self {
            ParseError::IllegalOption(s) | ParseError::Unsupported(s) => s,
            ParseError::ShowUsage => b"",
        }
    }
}

pub(crate) enum ParseFlagResult<'a> {
    ContinueParsing,
    Done,
    IllegalOption(&'a [u8]),
    Unsupported(&'a [u8]),
}

/// Per-builtin opts type implements this to plug into `FlagParser::parse_flags`.
pub(crate) trait FlagParser {
    /// Handle a `--long` flag. Return `None` to fall through to short parsing.
    fn parse_long<'a>(&mut self, flag: &'a [u8]) -> Option<ParseFlagResult<'a>>;
    /// Handle one byte of a `-abc` cluster. Return `None` to keep iterating.
    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>>;
}

/// Returns the trailing non-flag args (`args[idx..]`) on success.
pub(crate) fn parse_flags<'a, O: FlagParser>(
    opts: &mut O,
    args: &'a [Vec<u8>],
) -> Result<Option<&'a [Vec<u8>]>, ParseError<'a>> {
    if args.is_empty() {
        return Ok(None);
    }
    let mut idx = 0usize;
    while idx < args.len() {
        let flag = bun_core::slice_to_nul(&args[idx]);
        match parse_one_flag(opts, flag) {
            ParseFlagResult::Done => return Ok(Some(&args[idx..])),
            ParseFlagResult::ContinueParsing => {}
            ParseFlagResult::IllegalOption(s) => return Err(ParseError::IllegalOption(s)),
            ParseFlagResult::Unsupported(s) => return Err(ParseError::Unsupported(s)),
        }
        idx += 1;
    }
    Err(ParseError::ShowUsage)
}

fn parse_one_flag<'a, O: FlagParser>(opts: &mut O, flag: &'a [u8]) -> ParseFlagResult<'a> {
    if flag.is_empty() || flag[0] != b'-' {
        return ParseFlagResult::Done;
    }
    if flag.len() == 1 {
        return ParseFlagResult::IllegalOption(b"-");
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
// OutputTask
// ────────────────────────────────────────────────────────────────────────────

/// Owned bytes a builtin's async sub-task
/// produced off-thread, queued for stdout once back on the main thread.
pub(crate) enum OutputSrc {
    /// Owned, freed on drop.
    Arrlist(Vec<u8>),
}

impl OutputSrc {
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            OutputSrc::Arrlist(v) => v.as_slice(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputTaskState {
    WaitingWriteErr,
    WaitingWriteOut,
    Done,
}

/// Vtable trait the parent builtin implements. All hooks
/// take `(&mut Interpreter, NodeId)` (NodeId style — the parent builtin lives
/// inside the interpreter's node arena).
///
/// `child` is the `OutputTask` itself: `write_*` keep it until the IOWriter
/// chunk completes (`Break`), or hand it back after a synchronous write (`Continue`).
pub(crate) trait OutputTaskVTable: Sized {
    fn write_err(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
        errbuf: &[u8],
    ) -> ControlFlow<Yield, Box<OutputTask<Self>>>;
    fn on_write_err(interp: &mut Interpreter<'_>, cmd: NodeId);
    fn write_out(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        child: Box<OutputTask<Self>>,
    ) -> ControlFlow<Yield, Box<OutputTask<Self>>>;
    fn on_write_out(interp: &mut Interpreter<'_>, cmd: NodeId);
    fn on_done(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield;
}

/// A task that can write to stdout and/or stderr.
///
/// Owned by the running frame, or by the builtin while an IOWriter chunk is
/// in flight; freed by `deinit`.
pub(crate) struct OutputTask<P: OutputTaskVTable> {
    /// Owning Cmd node (the builtin's `cmd` id).
    pub(crate) parent: NodeId,
    pub(crate) output: OutputSrc,
    pub(crate) state: OutputTaskState,
    _marker: core::marker::PhantomData<P>,
}

impl<P: OutputTaskVTable> OutputTask<P> {
    pub(crate) fn new(parent: NodeId, output: OutputSrc) -> Box<Self> {
        Box::new(OutputTask {
            parent,
            output,
            state: OutputTaskState::WaitingWriteErr,
            _marker: core::marker::PhantomData,
        })
    }

    /// Takes the freshly-constructed task by `Box` (callers always pair `new`
    /// → `start`) and drives the first state transition. The box is dropped by
    /// [`Self::deinit`] when the task reaches `Done`.
    pub(crate) fn start(
        mut me: Box<Self>,
        interp: &mut Interpreter<'_>,
        errbuf: Option<&[u8]>,
    ) -> Yield {
        log!(
            "OutputTask(0x{:x}) start errbuf={:?}",
            std::ptr::from_ref(&*me) as usize,
            errbuf.map(|b| b.len())
        );
        me.state = OutputTaskState::WaitingWriteErr;
        if let Some(err) = errbuf {
            return match P::write_err(interp, me.parent, me, err) {
                ControlFlow::Break(y) => y,
                ControlFlow::Continue(me) => Self::next(me, interp),
            };
        }
        me.state = OutputTaskState::WaitingWriteOut;
        let mut me = match P::write_out(interp, me.parent, me) {
            ControlFlow::Break(y) => return y,
            ControlFlow::Continue(me) => me,
        };
        P::on_write_out(interp, me.parent);
        me.state = OutputTaskState::Done;
        Self::deinit(me, interp)
    }

    pub(crate) fn next(mut me: Box<Self>, interp: &mut Interpreter<'_>) -> Yield {
        match me.state {
            OutputTaskState::WaitingWriteErr => {
                P::on_write_err(interp, me.parent);
                me.state = OutputTaskState::WaitingWriteOut;
                let mut me = match P::write_out(interp, me.parent, me) {
                    ControlFlow::Break(y) => return y,
                    ControlFlow::Continue(me) => me,
                };
                P::on_write_out(interp, me.parent);
                me.state = OutputTaskState::Done;
                Self::deinit(me, interp)
            }
            OutputTaskState::WaitingWriteOut => {
                P::on_write_out(interp, me.parent);
                me.state = OutputTaskState::Done;
                Self::deinit(me, interp)
            }
            OutputTaskState::Done => panic!("Invalid state"),
        }
    }

    pub(crate) fn on_io_writer_chunk(
        me: Box<Self>,
        interp: &mut Interpreter<'_>,
        _written: usize,
        _err: Option<bun_sys::SystemError>,
    ) -> Yield {
        log!(
            "OutputTask(0x{:x}) onIOWriterChunk",
            std::ptr::from_ref(&*me) as usize
        );
        Self::next(me, interp)
    }

    /// Frees, then fires `on_done`.
    fn deinit(me: Box<Self>, interp: &mut Interpreter<'_>) -> Yield {
        debug_assert!(me.state == OutputTaskState::Done);
        log!(
            "OutputTask(0x{:x}) deinit",
            std::ptr::from_ref(&*me) as usize
        );
        let parent = me.parent;
        drop(me);
        P::on_done(interp, parent)
    }
}

// ────────────────────────────────────────────────────────────────────────────
// ShellTask
// ────────────────────────────────────────────────────────────────────────────

/// A queued task's reference to its [`ShellInterpreter`], whose `finish` panics while one is out.
pub(crate) struct ShellInterpreterRef(NonNull<ShellInterpreter>);

// SAFETY: only `get` dereferences the pointer, on the thread of the script.
unsafe impl Send for ShellInterpreterRef {}

impl ShellInterpreterRef {
    pub(crate) fn new(interp: &mut Interpreter<'_>) -> Self {
        interp.pending_tasks += 1;
        ShellInterpreterRef(interp.shell_interp)
    }

    /// # Safety
    /// Called by the event loop of the script, for the queued task that held `self`.
    unsafe fn get(&self) -> &ShellInterpreter {
        // SAFETY: `pending_tasks` includes `self`, or a task that shares its `interp_owners`, so `finish`
        // has not run. Only a VM teardown frees the interpreter before that, and it releases the queued
        // tasks first. Both callers hold `ensure_still_alive` from before `finish` can run.
        unsafe { self.0.as_ref() }
    }

    /// Gives up the reference, and then runs [`ShellInterpreter::run_yield_with`].
    ///
    /// # Safety
    /// See [`Self::get`].
    pub(crate) unsafe fn run_yield_with(
        self,
        f: impl for<'a> FnOnce(&mut Interpreter<'a>) -> Yield,
    ) {
        // SAFETY: caller contract.
        unsafe { self.get() }.run_yield_with(|interp| {
            interp.pending_tasks -= 1;
            f(interp)
        });
    }
}

/// A thread-pool task that [`ShellTask::on_finish`] can post to the loop of its script.
///
/// Its `BoxedTask::context` is `ContextId::NONE`: a step is what its interpreter is waiting for, and the
/// interpreter checks its own context before anything reaches script (`Interpreter::interrupted`,
/// `finish`, `fail`).
pub(crate) trait ShellTaskCtx: IntrusiveField<ShellTask> + BoxedTask + Send {
    /// `is_last` is false while a task related by [`ShellTask::new_child`] is still out.
    fn run_from_main_thread(self: Box<Self>, shell_interp: &ShellInterpreter, is_last: bool);
}

pub(crate) type WorkPoolTask = bun_threading::work_pool::Task;

/// Owned storage for either kind of concurrent task.
enum EventLoopTask {
    Js(ConcurrentTask),
    Mini(AnyTaskWithExtraContext),
}

// SAFETY: it is empty until `ShellTask::on_finish` puts a `Send` task into it.
unsafe impl Send for EventLoopTask {}

pub(crate) struct ShellTask {
    /// Held while the task is out on the pool. For a JS loop this is the ticket its VM waits for.
    poster: Option<ConcurrentPoster>,
    /// `None` once the task is back.
    interp: Option<ShellInterpreterRef>,
    /// Cloned by `new_child`. The task that drops the last clone decrements `pending_tasks`.
    interp_owners: Option<Arc<()>>,
    /// Intrusive concurrent-task node for the worker→main bounce.
    concurrent_task: EventLoopTask,
}

/// For a task that never calls `on_finish`.
impl Default for ShellTask {
    fn default() -> Self {
        ShellTask {
            poster: None,
            interp: None,
            interp_owners: None,
            concurrent_task: EventLoopTask::Js(Default::default()),
        }
    }
}

impl ShellTask {
    /// A subtask created on a pool thread (`ls -R` discovering a directory):
    /// it reports to the same loop as `parent`, whose poster was captured on
    /// the JS thread — nothing here derives one from the VM.
    #[track_caller]
    pub(crate) fn new_child(parent: &mut ShellTask) -> Self {
        let poster = parent.poster.as_ref();
        ShellTask {
            poster: Some(
                poster
                    .expect("shell task on the pool holds its poster")
                    .clone(),
            ),
            interp: parent
                .interp
                .as_ref()
                .map(|interp| ShellInterpreterRef(interp.0)),
            interp_owners: Some(Arc::clone(parent.interp_owners.get_or_insert_default())),
            ..Default::default()
        }
    }

    /// Creates the poster (for a JS loop, a ticket on its VM).
    #[track_caller]
    pub(crate) fn new(interp: &mut Interpreter<'_>) -> Self {
        ShellTask {
            poster: Some(ConcurrentPoster::from_event_loop_handle(&interp.event_loop)),
            interp: Some(ShellInterpreterRef::new(interp)),
            ..Default::default()
        }
    }

    pub(crate) fn take_poster(&mut self) -> ConcurrentPoster {
        self.poster
            .take()
            .expect("shell task on the pool holds its poster")
    }

    /// Called from the worker thread; enqueues the embedded
    /// concurrent task so the main thread re-enters via
    /// [`run_from_main_thread`](Self::run_from_main_thread).
    pub(crate) fn on_finish<C: ShellTaskCtx>(mut ctx: Box<C>) {
        log!("ShellTask onFinish");
        // Moved out: the owning thread may free `*ctx` once it is queued.
        let poster = C::field_mut(&mut ctx).take_poster();
        let task = bun_event_loop::Task::from_boxed(ctx);
        let ctx = task.ptr().cast::<C>();
        // SAFETY: the box that `from_boxed` leaked, which no other thread has before the post.
        let node = unsafe { &mut (*C::field_of(ctx)).concurrent_task };
        if !poster.is_js() {
            *node = EventLoopTask::Mini(Default::default());
        }
        match node {
            EventLoopTask::Js(ct) => {
                ct.task = task;
                poster.post_js_intrusive(NonNull::from(ct));
            }
            EventLoopTask::Mini(at) => {
                let at = at.from(ctx, |ctx, _| {
                    // SAFETY: the loop of `poster` calls this once.
                    unsafe { Self::run_from_main_thread(bun_core::heap::take(ctx)) }
                });
                poster.post_mini(NonNull::new(at).expect("intrusive task"));
            }
        }
    }

    /// # Safety
    /// Called by the event loop that the poster of `ctx` posts to.
    pub(crate) unsafe fn run_from_main_thread<C: ShellTaskCtx>(mut ctx: Box<C>) {
        log!("ShellTask runFromJS");
        let task = C::field_mut(&mut ctx);
        let interp_ref = task.interp.take().expect("shell task comes back once");
        // SAFETY: caller contract.
        let shell_interp = unsafe { interp_ref.get() };
        let _keep = shell_interp.ensure_still_alive();
        let is_last = task
            .interp_owners
            .take()
            .is_none_or(|it| Arc::into_inner(it).is_some());
        if is_last {
            shell_interp.with_interp(|interp| interp.pending_tasks -= 1);
        }
        ctx.run_from_main_thread(shell_interp, is_last);
    }
}

/// What a [`PoolTask`] takes to the pool and back.
pub(crate) trait ShellWork: Send + 'static {
    const TAG: bun_event_loop::TaskTag;
    fn run_from_thread_pool(&mut self);
    fn run_from_main_thread(&mut self, interp: &mut Interpreter<'_>) -> Yield;
}

/// Owned by the pool, then by the queue of the interpreter's loop.
pub(crate) struct PoolTask<W> {
    work_task: WorkPoolTask,
    task: ShellTask,
    work: W,
}

bun_threading::intrusive_work_task!([W] PoolTask<W>, work_task);
bun_core::intrusive_field!([W] PoolTask<W>, task: ShellTask);

impl<W: ShellWork> PoolTask<W> {
    pub(crate) fn schedule(interp: &mut Interpreter<'_>, work: W) {
        log!("ShellTask schedule");
        WorkPool::schedule_new(Self {
            work_task: WorkPoolTask::default(),
            task: ShellTask::new(interp),
            work,
        });
    }
}

impl<W: ShellWork> OwnedTask for PoolTask<W> {
    fn run(mut self: Box<Self>) {
        self.work.run_from_thread_pool();
        ShellTask::on_finish(self);
    }
}

impl<W: ShellWork> BoxedTask for PoolTask<W> {
    const TAG: bun_event_loop::TaskTag = W::TAG;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTaskCtx`]: a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl<W: ShellWork> ShellTaskCtx for PoolTask<W> {
    fn run_from_main_thread(mut self: Box<Self>, shell_interp: &ShellInterpreter, _: bool) {
        shell_interp.run_yield_with(move |interp| self.work.run_from_main_thread(interp));
    }
}

#[cold]
#[track_caller]
pub(crate) fn unreachable_state(context: &str, state: &str) -> ! {
    panic!(
        "Bun shell has reached an unreachable state \"{}\" in the {} context. This indicates a bug, please open a GitHub issue.",
        state, context
    );
}

/// Creates the interpreter that runs a parsed `Bun.$` script.
pub(crate) fn create_shell_interpreter<'a>(
    cx: &mut JsScope<'a>,
    resolve: JsLocal<'a>,
    reject: JsLocal<'a>,
    parsed_shell_script: JsLocal<'a>,
) -> crate::jsc::JsResult<JsWrapper<'a, ShellInterpreter>> {
    use crate::shell::parsed_shell_script::{self, ParsedShellScript};

    let global = cx.global();
    let parsed_shell_script_js = parsed_shell_script.to_js();
    let parsed_shell_script = parsed_shell_script_js
        .as_class_ref::<ParsedShellScript>()
        .ok_or_else(|| global.throw(format_args!("shell: expected a ParsedShellScript")))?;

    if parsed_shell_script.args.get().is_none() {
        return Err(global.throw(format_args!(
            "shell: shell args is null, this is a bug in Bun. Please file a GitHub issue.",
        )));
    }

    let (shargs, quiet, cwd, export_env) = parsed_shell_script.take();

    let cwd_slice = cwd.as_ref().map(|c| c.to_utf8());

    // bun_vm() returns the live thread-local VM for a Bun-owned global; that
    // pointer is the live `jsc::EventLoop` `EventLoopHandle::init` expects.
    let event_loop = EventLoopHandle::init(global.bun_vm().event_loop_ptr());
    let export_env = export_env.unwrap_or_else(EnvMap::init);
    let this_value = ShellInterpreter::new(
        event_loop,
        Some(GlobalRef::new(global)),
        shargs.memory_cost() + export_env.memory_cost(),
    )
    .into_js(&cx.heap);
    let global = cx.global();
    let payload = this_value.payload_ptr();
    let cwd = cwd_slice.as_ref().map(|c| c.slice());
    // SAFETY: the payload of `this_value` does not move, and its class has only `&self` methods.
    let interp =
        match unsafe { ShellInterpreter::init(payload, None, None, shargs, export_env, cwd) } {
            // SAFETY: as above.
            Ok(()) => unsafe { payload.as_ref() },
            Err(e) => return Err(ShellErr::new_sys(&e).throw_js(global)),
        };
    interp.with_interp(|interp| interp.quiet = quiet);

    let js_value = this_value.to_js();
    js::resolve_set_cached(js_value, global, resolve.to_js());
    js::reject_set_cached(js_value, global, reject.to_js());
    if let Some(jsobjs) = parsed_shell_script::js::jsobjs_get_cached(parsed_shell_script_js) {
        js::jsobjs_set_cached(js_value, global, jsobjs);
    }
    interp.this_value.set_weak(js_value);
    interp.keep_alive.ref_(global.bun_vm().loop_ctx());
    bun_analytics::features::shell.fetch_add(1, Ordering::Relaxed);
    Ok(this_value)
}
