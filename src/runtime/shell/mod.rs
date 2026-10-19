//! Shell lexer, parser, AST, and tree-walking state-machine interpreter.
//!
//! ## NodeId arena architecture
//!
//! Inter-node back-references use an **arena + NodeId index** scheme:
//!
//! - `Interpreter` owns `nodes: Vec<Node>` (a flat arena of state nodes)
//! - Each state struct stores `parent: NodeId` (a `u32` index), NOT `*Parent`
//! - Dispatch: `interp.child_done(parent_id, child_id, exit)` looks up
//!   `interp.nodes[parent_id]` and matches on its tag
//! - Every method that previously took `*Parent` now takes
//!   `&Interpreter` + the relevant `NodeId`s
//!
//! This avoids self-referential `&mut` graphs entirely: all inter-node edges
//! are integer indices, and the only `&mut` is the single `&Interpreter`
//! threaded through the trampoline.

#[path = "shell_body.rs"]
pub(crate) mod shell_body;
// Codegen (`generated_js2native.rs`) addresses this as `crate::shell::shell::*`.
pub(crate) use shell_body as shell;

// ─── submodules ──────────────────────────────────────────────────────────────
#[path = "EnvMap.rs"]
pub(crate) mod env_map;
#[path = "EnvStr.rs"]
pub(crate) mod env_str;
#[path = "RefCountedStr.rs"]
pub(crate) mod ref_counted_str;
#[path = "util.rs"]
pub(crate) mod util;

#[path = "Builtin.rs"]
pub(crate) mod builtin;
#[path = "interpreter.rs"]
pub(crate) mod interpreter;
#[path = "IO.rs"]
pub(crate) mod io;
#[path = "IOReader.rs"]
pub(crate) mod io_reader;
#[path = "IOWriter.rs"]
pub(crate) mod io_writer;
#[path = "ParsedShellScript.rs"]
pub(crate) mod parsed_shell_script;
#[path = "Yield.rs"]
pub(crate) mod yield_;

#[path = "states"]
pub(crate) mod states {
    #[path = "Assigns.rs"]
    pub(crate) mod assigns;
    #[path = "Async.rs"]
    pub(crate) mod r#async;
    #[path = "Base.rs"]
    pub(crate) mod base;
    #[path = "Binary.rs"]
    pub(crate) mod binary;
    #[path = "Cmd.rs"]
    pub(crate) mod cmd;
    #[path = "CondExpr.rs"]
    pub(crate) mod cond_expr;
    #[path = "Expansion.rs"]
    pub(crate) mod expansion;
    #[path = "If.rs"]
    pub(crate) mod r#if;
    #[path = "Pipeline.rs"]
    pub(crate) mod pipeline;
    #[path = "Script.rs"]
    pub(crate) mod script;
    #[path = "Stmt.rs"]
    pub(crate) mod stmt;
    #[path = "Subshell.rs"]
    pub(crate) mod subshell;
}

#[path = "builtin"]
pub(crate) mod builtins {
    #[path = "basename.rs"]
    pub(crate) mod basename;
    #[path = "cat.rs"]
    pub(crate) mod cat;
    #[path = "cd.rs"]
    pub(crate) mod cd;
    #[path = "cp.rs"]
    pub(crate) mod cp;
    #[path = "dirname.rs"]
    pub(crate) mod dirname;
    #[path = "echo.rs"]
    pub(crate) mod echo;
    #[path = "exit.rs"]
    pub(crate) mod exit;
    #[path = "export.rs"]
    pub(crate) mod export;
    #[path = "false_.rs"]
    pub(crate) mod false_;
    #[path = "ls.rs"]
    pub(crate) mod ls;
    #[path = "mkdir.rs"]
    pub(crate) mod mkdir;
    #[path = "mv.rs"]
    pub(crate) mod mv;
    #[path = "pwd.rs"]
    pub(crate) mod pwd;
    #[path = "rm.rs"]
    pub(crate) mod rm;
    #[path = "seq.rs"]
    pub(crate) mod seq;
    #[path = "touch.rs"]
    pub(crate) mod touch;
    #[path = "true_.rs"]
    pub(crate) mod true_;
    #[path = "which.rs"]
    pub(crate) mod which;
    #[path = "yes.rs"]
    pub(crate) mod yes;
}

// ─── re-exports ──────────────────────────────────────────────────────────────
pub(crate) use env_str::EnvStr;
pub(crate) use interpreter::{ExitCode, Interpreter};
pub(crate) use yield_::Yield;

/// Forward-decl task payloads for `runtime::dispatch::run_task` arms whose
/// owning modules are still gated. See `dispatch_tasks.rs` header.
pub(crate) mod dispatch_tasks;

/// `bun.shell.subproc` — `ShellSubprocess` + its `StaticPipeWriter`. Exposed so
/// `runtime::dispatch::run_file_poll` can name `StaticPipeWriter<ShellSubprocess>`
/// for the `SHELL_STATIC_PIPE_WRITER` poll arm.
#[path = "subproc.rs"]
pub(crate) mod subproc;

// ─── shell escaping (canonical impl lives in bun_shell_parser) ───────────────
// Re-export so `crate::shell::*` callers resolve without duplicating the table.
pub(crate) use bun_shell_parser::{escape_8bit, needs_escape_utf8_ascii_latin1};

// ─── AST surface (lifetime-erased aliases over `bun_shell_parser::ast`) ──────
// State nodes hold `*const ast::*` raw pointers into the bumpalo-allocated AST
// (`ShellArgs::__arena`). The arena outlives every state node, so the `'arena`
// lifetime on `bun_shell_parser::ast::*<'arena>` carries no information the
// interpreter can use — threading it through `Interpreter`/`Node`/every state
// struct would be pure noise. Instead we erase it to `'static` here and store
// raw pointers; `ShellArgs::set_script_ast` performs the single
// lifetime-widening slice cast (`Script<'a>` → `Script<'static>`, identical
// layout) at the arena/state-machine boundary.
pub(crate) mod ast {
    pub(crate) use bun_shell_parser::parse::SmolList;
    use bun_shell_parser::parse::ast as p;
    pub(crate) use p::{BinaryOp, CondExprOp, IoKind, RedirectFlags};

    pub(crate) type Script = p::Script<'static>;
    pub(crate) type Stmt = p::Stmt<'static>;
    pub(crate) type Expr = p::Expr<'static>;
    pub(crate) type Binary = p::Binary<'static>;
    pub(crate) type Pipeline = p::Pipeline<'static>;
    pub(crate) type PipelineItem = p::PipelineItem<'static>;
    pub(crate) type Cmd = p::Cmd<'static>;
    pub(crate) type Redirect = p::Redirect<'static>;
    pub(crate) type If = p::If<'static>;
    pub(crate) type Subshell = p::Subshell<'static>;
    pub(crate) type CondExpr = p::CondExpr<'static>;
    pub(crate) type Assign = p::Assign<'static>;
    pub(crate) type Atom = p::Atom<'static>;
    pub(crate) type SimpleAtom = p::SimpleAtom<'static>;
}

// Canonical 4-variant shell error enum. Defined in
// `shell_body.rs` and re-exported so subproc/state nodes use the same type.
pub(crate) use shell_body::ShellErr;

pub(crate) type Result<T, E = ShellErr> = core::result::Result<T, E>;

pub(crate) use parsed_shell_script::ParsedShellScript;

/// Re-export of the JS-exposed `Bun.spawn` Subprocess class. The
/// `generate-classes.ts` resolver walks `lib.rs` in declaration order and
/// `mod shell` precedes `mod api`, so `generated_classes.rs` currently routes
/// the `Subprocess` codegen thunks through `crate::shell::Subprocess`. Point
/// it at the real implementation (lifetime erased to `'static` for the C-ABI
/// `*mut Subprocess` thunk signatures — the JS wrapper outlives any borrow).
/// Distinct from [`ShellSubprocess`](subproc::ShellSubprocess), the shell
/// interpreter's internal process node.
pub(crate) type Subprocess = crate::api::bun::subprocess::Subprocess<'static>;
