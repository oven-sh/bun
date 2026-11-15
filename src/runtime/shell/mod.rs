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
//!   `&mut Interpreter` + the relevant `NodeId`s
//!
//! This avoids self-referential `&mut` graphs entirely: all inter-node edges
//! are integer indices, and the only `&mut` is the single `&mut Interpreter`
//! threaded through the trampoline.

#[path = "shell_body.rs"]
pub(crate) mod shell_body;

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
pub(crate) use interpreter::{ExitCode, Interpreter, ShellInterpreter};
pub(crate) use yield_::Yield;

/// Forward-decl task payloads for `runtime::dispatch::run_task` arms whose
/// owning modules are still gated. See `dispatch_tasks.rs` header.
pub(crate) mod dispatch_tasks;

#[path = "subproc.rs"]
pub(crate) mod subproc;

// ─── shell escaping (canonical impl lives in bun_shell_parser) ───────────────
// Re-export so `crate::shell::*` callers resolve without duplicating the table.
pub(crate) use bun_shell_parser::{escape_8bit, needs_escape_utf8_ascii_latin1};

// ─── AST surface ─────────────────────────────────────────────────────────────
pub(crate) mod ast {
    pub(crate) use bun_shell_parser::parse::SmolList;
    pub(crate) use bun_shell_parser::parse::ast::*;
}

// Canonical 4-variant shell error enum. Defined in
// `shell_body.rs` and re-exported so subproc/state nodes use the same type.
pub(crate) use shell_body::ShellErr;

pub(crate) type Result<T, E = ShellErr> = core::result::Result<T, E>;

pub(crate) use parsed_shell_script::ParsedShellScript;
