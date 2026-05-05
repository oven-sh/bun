//! Port of src/shell/shell.zig
//! Shell lexer, parser, AST, and JS-bridge utilities for Bun's shell.
//!
//! B-2: full draft (5574 lines, preserved in `shell_body.rs`) depends on
//! `bun_jsc` method surface, `bun_glob::GlobWalker` shape, `bun_output`
//! macros, and `bun_collections::IntegerBitSet`. Submodules likewise gated.

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "shell_body.rs"]
mod shell_body;

// ─── compiling submodules ────────────────────────────────────────────────────
#[path = "util.rs"]
pub mod util;

pub const SUBSHELL_TODO_ERROR: &str =
    "Subshells are not implemented, please open GitHub issue!";

// ─── opaque type surface ─────────────────────────────────────────────────────
// TODO(b2-blocked): bun_jsc::JSGlobalObject (method surface)
// TODO(b2-blocked): bun_collections::IntegerBitSet
// TODO(b2-blocked): bun_glob::GlobWalker
pub struct Interpreter(());
pub struct ParsedShellScript(());
pub struct EnvMap(());
pub struct EnvStr(());
pub type ExitCode = u32;
pub struct Subprocess(());

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/shell.zig
//   confidence: low (B-2 thin un-gate)
// ──────────────────────────────────────────────────────────────────────────
