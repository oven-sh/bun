//! Port of src/shell/shell.zig + interpreter.zig
//! Shell lexer, parser, AST, and tree-walking state-machine interpreter.
//!
//! ## NodeId arena architecture (Rust port)
//!
//! The Zig interpreter uses parent-pointer mixin structs (`*Parent` back-refs
//! everywhere — borrow-checker hostile). The Rust port replaces this with an
//! **arena + NodeId index** scheme:
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

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
// The full lexer/parser/AST draft (5574 lines) depends on `bun_jsc` method
// surface, `bun_glob::GlobWalker`, `bun_output` macros, and
// `bun_collections::IntegerBitSet`.

#[path = "shell_body.rs"]
pub mod shell_body;
// Codegen (`generated_js2native.rs`) addresses this as `crate::shell::shell::*`
// (Zig path `src/runtime/shell/shell.zig`).
pub use shell_body as shell;

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "EnvMap.rs"]
pub mod env_map;
#[path = "EnvStr.rs"]
pub mod env_str;
#[path = "RefCountedStr.rs"]
pub mod ref_counted_str;
#[path = "util.rs"]
pub mod util;

#[path = "Builtin.rs"]
pub mod builtin;
#[path = "interpreter.rs"]
pub mod interpreter;
#[path = "IO.rs"]
pub mod io;
#[path = "IOReader.rs"]
pub mod io_reader;
#[path = "IOWriter.rs"]
pub mod io_writer;
#[path = "ParsedShellScript.rs"]
pub mod parsed_shell_script;
#[path = "Yield.rs"]
pub mod yield_;

#[path = "states"]
pub mod states {
    #[path = "Assigns.rs"]
    pub mod assigns;
    #[path = "Async.rs"]
    pub mod r#async;
    #[path = "Base.rs"]
    pub mod base;
    #[path = "Binary.rs"]
    pub mod binary;
    #[path = "Cmd.rs"]
    pub mod cmd;
    #[path = "CondExpr.rs"]
    pub mod cond_expr;
    #[path = "Expansion.rs"]
    pub mod expansion;
    #[path = "If.rs"]
    pub mod r#if;
    #[path = "Pipeline.rs"]
    pub mod pipeline;
    #[path = "Script.rs"]
    pub mod script;
    #[path = "Stmt.rs"]
    pub mod stmt;
    #[path = "Subshell.rs"]
    pub mod subshell;
}

#[path = "builtin"]
pub mod builtins {
    #[path = "basename.rs"]
    pub mod basename;
    #[path = "cat.rs"]
    pub mod cat;
    #[path = "cd.rs"]
    pub mod cd;
    #[path = "cp.rs"]
    pub mod cp;
    #[path = "dirname.rs"]
    pub mod dirname;
    #[path = "echo.rs"]
    pub mod echo;
    #[path = "exit.rs"]
    pub mod exit;
    #[path = "export.rs"]
    pub mod export;
    #[path = "false_.rs"]
    pub mod false_;
    #[path = "ls.rs"]
    pub mod ls;
    #[path = "mkdir.rs"]
    pub mod mkdir;
    #[path = "mv.rs"]
    pub mod mv;
    #[path = "pwd.rs"]
    pub mod pwd;
    #[path = "rm.rs"]
    pub mod rm;
    #[path = "seq.rs"]
    pub mod seq;
    #[path = "touch.rs"]
    pub mod touch;
    #[path = "true_.rs"]
    pub mod true_;
    #[path = "which.rs"]
    pub mod which;
    #[path = "yes.rs"]
    pub mod yes;
}

// ─── re-exports ──────────────────────────────────────────────────────────────
pub use env_map::EnvMap;
pub use env_str::EnvStr;
pub use interpreter::{ExitCode, Interpreter, Node, NodeId, ShellExecEnv};
pub use io::IO;
pub use io_writer as IOWriter;
pub use ref_counted_str::RefCountedStr;
pub use yield_::Yield;

/// Forward-decl task payloads for `runtime::dispatch::run_task` arms whose
/// owning modules are still gated. See `dispatch_tasks.rs` header.
pub mod dispatch_tasks;

/// `bun.shell.subproc` — `ShellSubprocess` + its `StaticPipeWriter`. Exposed so
/// `runtime::dispatch::run_file_poll` can name `StaticPipeWriter<ShellSubprocess>`
/// for the `SHELL_STATIC_PIPE_WRITER` poll arm.
#[path = "subproc.rs"]
pub mod subproc;

pub const SUBSHELL_TODO_ERROR: &str = "Subshells are not implemented, please open GitHub issue!";

// ─── shell escaping (canonical impl lives in bun_shell_parser) ───────────────
// Re-export so `crate::shell::*` callers resolve without duplicating the table.
pub use bun_shell_parser::{
    BACKSLASHABLE_CHARS, SPECIAL_CHARS, SPECIAL_CHARS_TABLE, assert_special_char, escape_8bit,
    needs_escape_utf8_ascii_latin1, needs_escape_utf16,
};

// ─── AST surface (lifetime-erased aliases over `bun_shell_parser::ast`) ──────
// State nodes hold `*const ast::*` raw pointers into the bumpalo-allocated AST
// (`ShellArgs::__arena`). The arena outlives every state node, so the `'arena`
// lifetime on `bun_shell_parser::ast::*<'arena>` carries no information the
// interpreter can use — threading it through `Interpreter`/`Node`/every state
// struct would be pure noise. Instead we erase it to `'static` here and store
// raw pointers; `ShellArgs::set_script_ast` performs the single
// lifetime-widening slice cast (`Script<'a>` → `Script<'static>`, identical
// layout) at the arena/state-machine boundary.
pub mod ast {
    pub use bun_shell_parser::parse::SmolList;
    use bun_shell_parser::parse::ast as p;
    pub use p::{BinaryOp, CondExprOp, IoKind, JSBuf, RedirectFlags};

    pub type Script = p::Script<'static>;
    pub type Stmt = p::Stmt<'static>;
    pub type Expr = p::Expr<'static>;
    pub type Binary = p::Binary<'static>;
    pub type Pipeline = p::Pipeline<'static>;
    pub type PipelineItem = p::PipelineItem<'static>;
    pub type Cmd = p::Cmd<'static>;
    pub type Redirect = p::Redirect<'static>;
    pub type If = p::If<'static>;
    pub type Subshell = p::Subshell<'static>;
    pub type CondExpr = p::CondExpr<'static>;
    pub type Assign = p::Assign<'static>;
    pub type Atom = p::Atom<'static>;
    pub type SimpleAtom = p::SimpleAtom<'static>;
    pub type CompoundAtom = p::CompoundAtom<'static>;
    pub type CmdOrAssigns = p::CmdOrAssigns<'static>;
}

// Canonical 4-variant error enum (shell.zig `ShellErr`). Defined in
// `shell_body.rs` and re-exported so subproc/state nodes use the same type.
pub use shell_body::ShellErr;

/// Spec: shell.zig `bun.shell.Result(T)`.
pub type Result<T, E = ShellErr> = core::result::Result<T, E>;

pub use parsed_shell_script::ParsedShellScript;

/// Re-export of the JS-exposed `Bun.spawn` Subprocess class. The
/// `generate-classes.ts` resolver walks `lib.rs` in declaration order and
/// `mod shell` precedes `mod api`, so `generated_classes.rs` currently routes
/// the `Subprocess` codegen thunks through `crate::shell::Subprocess`. Point
/// it at the real implementation (lifetime erased to `'static` for the C-ABI
/// `*mut Subprocess` thunk signatures — the JS wrapper outlives any borrow).
/// Distinct from [`ShellSubprocess`](subproc::ShellSubprocess), the shell
/// interpreter's internal process node.
pub type Subprocess = crate::api::bun::subprocess::Subprocess<'static>;

// ported from: src/shell/shell.zig
