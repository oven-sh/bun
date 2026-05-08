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

#[path = "shell_body.rs"]
pub mod shell_body;
// Codegen (`generated_js2native.rs`) addresses this as `crate::shell::shell::*`
// (Zig path `src/runtime/shell/shell.zig`).
pub use shell_body as shell;

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
#[path = "ParsedShellScript.rs"]
pub mod parsed_shell_script;

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
    #[path = "which.rs"]
    pub mod which;
    #[path = "ls.rs"]
    pub mod ls;
    #[path = "mkdir.rs"]
    pub mod mkdir;
    #[path = "touch.rs"]
    pub mod touch;
    #[path = "cp.rs"]
    pub mod cp;
    #[path = "seq.rs"]
    pub mod seq;
    #[path = "yes.rs"]
    pub mod yes;
}

// ─── re-exports ──────────────────────────────────────────────────────────────
pub use env_map::EnvMap;
pub use env_str::EnvStr;
pub use ref_counted_str::RefCountedStr;
pub use yield_::Yield;
pub use interpreter::{ExitCode, Interpreter, NodeId, Node, ShellExecEnv};
pub use io::IO;
pub use io_writer as IOWriter;

/// Forward-decl task payloads for `runtime::dispatch::run_task` arms whose
/// owning modules are still gated. See `dispatch_tasks.rs` header.
pub mod dispatch_tasks;

/// `bun.shell.subproc` — `ShellSubprocess` + its `StaticPipeWriter`. Exposed so
/// `runtime::dispatch::run_file_poll` can name `StaticPipeWriter<ShellSubprocess>`
/// for the `SHELL_STATIC_PIPE_WRITER` poll arm.
#[path = "subproc.rs"]
pub mod subproc;

pub const SUBSHELL_TODO_ERROR: &str =
    "Subshells are not implemented, please open GitHub issue!";

// ─── shell escaping (un-gated from shell_body.rs) ────────────────────────────
// Port of `shell.zig` escape8Bit / needsEscapeUtf8AsciiLatin1 / SPECIAL_CHARS.
// Exposed here so `run_command.rs` / `filter_run.rs` passthrough-arg escaping
// can call `crate::shell::*` while the full lexer/parser in `shell_body.rs`
// remains ``-gated.

/// 0x08 — Bell; cannot be typed as a literal. Guards lexer-internal `__bun_` /
/// `__bunstr_` markers from colliding with user input.
pub const SPECIAL_JS_CHAR: u8 = 8;

/// Characters that need to be escaped (shell.zig:4165).
pub const SPECIAL_CHARS: [u8; 34] = [
    b'~', b'[', b']', b'#', b';', b'\n', b'*', b'{', b',', b'}', b'`', b'$', b'=', b'(', b')',
    b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7', b'8', b'9', b'|', b'>', b'<', b'&', b'\'',
    b'"', b' ', b'\\', SPECIAL_JS_CHAR,
];

// PORT NOTE: Zig uses `bit_set.IntegerBitSet(256)`. The Rust
// `bun_collections::IntegerBitSet<N>` is single-`usize`-backed (≤64 bits), so
// a 256-entry membership table is materialised as `[bool; 256]` instead — same
// O(1) byte-indexed lookup, const-evaluable.
const SPECIAL_CHARS_TABLE: [bool; 256] = {
    let mut table = [false; 256];
    let mut i = 0;
    while i < SPECIAL_CHARS.len() {
        table[SPECIAL_CHARS[i] as usize] = true;
        i += 1;
    }
    table
};

#[inline]
pub fn assert_special_char(c: u8) {
    debug_assert!(SPECIAL_CHARS_TABLE[c as usize]);
}

/// Characters that need to be backslashed inside double quotes.
pub const BACKSLASHABLE_CHARS: [u8; 4] = [b'$', b'`', b'"', b'\\'];

/// works for utf-8, latin-1, and ascii — port of `shell.zig` escape8Bit.
///
/// Runtime `add_quotes` (Zig is `comptime`): callers in `run_command.rs` /
/// `filter_run.rs` pass a literal `true`; the branch is trivially predicted.
pub fn escape_8bit(
    str: &[u8],
    outbuf: &mut Vec<u8>,
    add_quotes: bool,
) -> Result<(), bun_alloc::AllocError> {
    outbuf.reserve(str.len());

    if add_quotes {
        outbuf.push(b'"');
    }

    'outer: for &c in str {
        for &spc in &BACKSLASHABLE_CHARS {
            if spc == c {
                outbuf.extend_from_slice(&[b'\\', c]);
                continue 'outer;
            }
        }
        outbuf.push(c);
    }

    if add_quotes {
        outbuf.push(b'"');
    }
    Ok(())
}

/// Checks for the presence of any char from `SPECIAL_CHARS` in `str`. This
/// indicates the *possibility* that the string must be escaped, so it can have
/// false positives, but it is faster than running the shell lexer through the
/// input string for a more correct implementation.
pub fn needs_escape_utf8_ascii_latin1(str: &[u8]) -> bool {
    for &c in str {
        if SPECIAL_CHARS_TABLE[c as usize] {
            return true;
        }
    }
    false
}

pub fn needs_escape_utf16(str: &[u16]) -> bool {
    for &codeunit in str {
        if codeunit < 0xff && SPECIAL_CHARS_TABLE[codeunit as usize] {
            return true;
        }
    }
    false
}

// ─── AST surface (lifetime-erased aliases over `bun_shell_parser::ast`) ──────
// State nodes hold `*const ast::*` raw pointers into the bumpalo-allocated AST
// (`ShellArgs::__arena`). The arena outlives every state node, so the `'arena`
// lifetime on `bun_shell_parser::ast::*<'arena>` carries no information the
// interpreter can use — threading it through `Interpreter`/`Node`/every state
// struct would be pure noise. Instead we erase it to `'static` here and store
// raw pointers; `Interpreter::parse` performs the single lifetime-widening
// transmute (`Script<'a>` → `Script<'static>`, identical layout) at the
// arena/state-machine boundary.
pub mod ast {
    use bun_shell_parser::parse::ast as p;
    pub use bun_shell_parser::parse::SmolList;
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
