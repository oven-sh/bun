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
//!   `&mut Interpreter` + the relevant `NodeId`s
//!
//! This avoids self-referential `&mut` graphs entirely: all inter-node edges
//! are integer indices, and the only `&mut` is the single `&mut Interpreter`
//! threaded through the trampoline.

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
// The full lexer/parser/AST draft (5574 lines) depends on `bun_jsc` method
// surface, `bun_glob::GlobWalker`, `bun_output` macros, and
// `bun_collections::IntegerBitSet`.
#[cfg(any())]
#[path = "shell_body.rs"]
mod shell_body;

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "util.rs"]
pub mod util;
#[path = "RefCountedStr.rs"]
pub mod ref_counted_str;
#[path = "EnvStr.rs"]
pub mod env_str;
#[path = "EnvMap.rs"]
pub mod env_map;
#[path = "AllocScope.rs"]
pub mod alloc_scope;

#[path = "Yield.rs"]
pub mod yield_;
#[path = "IO.rs"]
pub mod io;
#[path = "IOReader.rs"]
pub mod io_reader;
#[path = "IOWriter.rs"]
pub mod io_writer;
#[path = "Builtin.rs"]
pub mod builtin;
#[path = "interpreter.rs"]
pub mod interpreter;

#[path = "states"]
pub mod states {
    #[path = "Base.rs"]
    pub mod base;
    #[path = "Script.rs"]
    pub mod script;
    #[path = "Stmt.rs"]
    pub mod stmt;
    #[path = "Binary.rs"]
    pub mod binary;
    #[path = "Pipeline.rs"]
    pub mod pipeline;
    #[path = "Subshell.rs"]
    pub mod subshell;
    #[path = "Async.rs"]
    pub mod r#async;
    #[path = "If.rs"]
    pub mod r#if;
    #[path = "CondExpr.rs"]
    pub mod cond_expr;
    #[path = "Assigns.rs"]
    pub mod assigns;
    #[path = "Expansion.rs"]
    pub mod expansion;
    #[path = "Cmd.rs"]
    pub mod cmd;
}

#[path = "builtin"]
pub mod builtins {
    #[path = "true_.rs"]
    pub mod true_;
    #[path = "false_.rs"]
    pub mod false_;
    #[path = "basename.rs"]
    pub mod basename;
    #[path = "dirname.rs"]
    pub mod dirname;
    #[path = "exit.rs"]
    pub mod exit;
    #[path = "pwd.rs"]
    pub mod pwd;
    #[path = "cd.rs"]
    pub mod cd;
    #[path = "echo.rs"]
    pub mod echo;
    #[path = "export.rs"]
    pub mod export;
    #[path = "cat.rs"]
    pub mod cat;
    #[path = "mv.rs"]
    pub mod mv;
    #[path = "rm.rs"]
    pub mod rm;
    // The remaining builtins (cp, ls, mkdir, seq, touch, which, yes) are still
    // gated until their async-task plumbing is converted.
}

// ─── re-exports ──────────────────────────────────────────────────────────────
pub use env_map::EnvMap;
pub use env_str::EnvStr;
pub use ref_counted_str::RefCountedStr;
pub use yield_::Yield;
pub use interpreter::{ExitCode, Interpreter, NodeId, Node, ShellExecEnv};
pub use io::IO;

pub const SUBSHELL_TODO_ERROR: &str =
    "Subshells are not implemented, please open GitHub issue!";

// ─── opaque type surface (still blocked) ─────────────────────────────────────
// The shell parser/AST live in `shell_body.rs` (gated). State nodes hold
// `*const ast::*` raw pointers into the bumpalo-allocated AST; until the
// parser is un-gated we expose opaque ZSTs so the interpreter compiles.
//
// TODO(b2-blocked): bun_shell_parser ast — replace with `pub use shell_body::ast`.
//
// These shapes mirror `shell_body.rs` / `shell.zig` just enough for the
// interpreter state machines to compile. State nodes hold `*const ast::*` raw
// pointers into the (eventually bumpalo-allocated) AST; until the parser is
// un-gated, no code constructs these — they're only dereferenced through
// pointers the parser will hand out.
pub mod ast {
    macro_rules! opaque_ast {
        ($($name:ident),* $(,)?) => {
            $(
                #[repr(C)]
                pub struct $name {
                    _priv: [u8; 0],
                }
            )*
        };
    }
    // Leaf nodes the interpreter never inspects (only holds pointers to).
    opaque_ast!(Assign, Atom, CondExpr, CmdOrAssigns, SimpleAtom, CompoundAtom);

    /// `ast::If::else_parts` etc. — inline small-vec.
    pub type SmolList<T, const N: usize> = crate::shell::interpreter::SmolList<T, N>;

    #[repr(C)]
    pub struct Script {
        pub stmts: *const [Stmt],
    }

    #[repr(C)]
    pub struct Stmt {
        pub exprs: *const [Expr],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub enum Expr {
        Cmd(*const Cmd),
        Binary(*const Binary),
        Pipeline(*const Pipeline),
        Assign(*const [Assign]),
        If(*const If),
        CondExpr(*const CondExpr),
        Subshell(*const Subshell),
        Async(*const Expr),
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub enum BinaryOp {
        And,
        Or,
    }

    #[repr(C)]
    pub struct Binary {
        pub op: BinaryOp,
        pub left: Expr,
        pub right: Expr,
    }

    #[repr(C)]
    pub struct Pipeline {
        pub items: *const [PipelineItem],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub enum PipelineItem {
        Cmd(*const Cmd),
        Assigns(*const [Assign]),
        If(*const If),
        CondExpr(*const CondExpr),
        Subshell(*const Subshell),
    }

    #[repr(C)]
    pub struct Cmd {
        pub assigns: *const [Assign],
        pub name_and_args: *const [Atom],
        pub redirect_file: Option<Redirect>,
        // TODO(b2-blocked): `redirect: RedirectFlags` — needed by
        // Builtin::init redirect handling and Cmd::initRedirections.
    }

    #[repr(C)]
    pub enum Redirect {
        Atom(Atom),
        JsBuf(u32),
    }

    #[repr(C)]
    pub struct If {
        pub cond: SmolList<Stmt, 1>,
        pub then: SmolList<Stmt, 1>,
        /// Flat: [elif-cond, elif-then, ..., (final else)?]. See Zig
        /// `ast.If.else_parts` doc comment.
        pub else_parts: SmolList<SmolList<Stmt, 1>, 1>,
    }

    #[repr(C)]
    pub struct Subshell {
        pub script: Script,
        // TODO(b2-blocked): `redirect: ?Redirect`, `redirect_flags: RedirectFlags`
    }
}

// TODO(b2-blocked): bun_shell_parser — these come from shell_body.rs once un-gated.
pub struct ShellErr(pub bun_sys::Error);
impl ShellErr {
    pub fn new_sys(e: bun_sys::Error) -> Self {
        Self(e)
    }
}
pub struct ParsedShellScript(());
pub struct Subprocess(());

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/shell.zig
//   confidence: low (NodeId-arena scaffolding; parser/AST still gated)
// ──────────────────────────────────────────────────────────────────────────
