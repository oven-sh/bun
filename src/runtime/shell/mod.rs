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
    /// Spec `ShellErr.newSys(jsc.SystemError)` — recover the syscall errno
    /// from the JS-facing struct (`to_shell_system_error` negated it).
    pub fn from_system(e: &bun_sys::SystemError) -> Self {
        Self(bun_sys::Error {
            errno: e.errno.unsigned_abs() as u16,
            ..Default::default()
        })
    }
}
pub struct ParsedShellScript(());
pub struct Subprocess(());

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/shell.zig
//   confidence: low (NodeId-arena scaffolding; parser/AST still gated)
// ──────────────────────────────────────────────────────────────────────────
