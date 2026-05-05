// ──────────────────────────────────────────────────────────────────────────
// B-2 UN-GATE
//   Phase-A draft bodies are progressively un-gated and made to compile.
//   Modules that remain blocked on lower-tier MOVE_DOWN symbols (chiefly
//   `bun_logger::js_ast`) keep a `#[cfg(any())]` gate on the affected items
//   only, with `// TODO(b2-blocked): bun_X::Y` markers.
// ──────────────────────────────────────────────────────────────────────────

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_assignments)]
#![allow(unexpected_cfgs)]
#![allow(clippy::all)]

// PORTING.md crate-map calls the string crate `bun_str`; the workspace package
// is `bun_string`. Alias once here so submodule `use bun_str::…` paths resolve.
extern crate bun_string as bun_str;

// ───── json ───────────────────────────────────────────────────────────────
// Full draft remains blocked: depends on `bun_js_parser::js_lexer` (GENUINE
// same-tier cycle per CYCLEBREAK §interchange) plus `bun_logger::{js_ast,
// js_printer}` (MOVE_DOWN not yet landed in T2). The `json` module below
// exposes the public free-fn surface (parse / parse_utf8_impl / parse_for_macro
// / parse_env_json / parse_ts_config) as signature-correct `todo!()` stubs so
// downstream crates can resolve the symbols and un-gate their own bodies.
#[cfg(any())]
#[path = "json.rs"]
pub mod json_draft;

pub mod json {
    use bumpalo::Bump;
    use bun_logger as logger;

    // TODO(b2-blocked): bun_logger::js_ast::Expr
    // TODO(b2-blocked): bun_logger::js_printer
    // TODO(b2-blocked): bun_js_parser::js_lexer (GENUINE cycle — needs js_lexer split)
    /// Opaque stub for `json::Expr` (re-export of `bun_logger::js_ast::Expr`).
    #[derive(Default)]
    pub struct Expr(());

    /// Parse JSON.
    ///
    /// This leaves UTF-16 strings as UTF-16 strings; the JavaScript Printer
    /// handles escaping if necessary.
    // TODO(b2-blocked): body in json.rs draft — requires bun_js_parser::js_lexer
    // (GENUINE T4 cycle) + bun_logger::js_ast.
    pub fn parse<const FORCE_UTF8: bool>(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        let _ = (source, log, bump);
        todo!("b2-blocked: bun_js_parser::js_lexer + bun_logger::js_ast")
    }

    /// Parse JSON, eagerly transcoding UTF-16 → UTF-8.
    // TODO(b2-blocked): body in json.rs draft.
    pub fn parse_utf8(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        parse_utf8_impl::<false>(source, log, bump)
    }

    // TODO(b2-blocked): body in json.rs draft.
    pub fn parse_utf8_impl<const CHECK_LEN: bool>(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        let _ = (source, log, bump);
        todo!("b2-blocked: bun_js_parser::js_lexer + bun_logger::js_ast")
    }

    // TODO(b2-blocked): body in json.rs draft.
    pub fn parse_for_macro(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        let _ = (source, log, bump);
        todo!("b2-blocked: bun_js_parser::js_lexer + bun_logger::js_ast")
    }

    // TODO(b2-blocked): body in json.rs draft.
    pub fn parse_env_json(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        let _ = (source, log, bump);
        todo!("b2-blocked: bun_js_parser::js_lexer + bun_logger::js_ast")
    }

    // TODO(b2-blocked): body in json.rs draft.
    pub fn parse_ts_config<const FORCE_UTF8: bool>(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        let _ = (source, log, bump);
        todo!("b2-blocked: bun_js_parser::js_lexer + bun_logger::js_ast")
    }

    /// Parse package.json (allows trailing commas & comments, force UTF-8).
    // TODO(b2-blocked): body in json.rs draft.
    pub fn parse_package_json_utf8(
        source: &logger::Source,
        log: &mut logger::Log,
        bump: &Bump,
    ) -> Result<Expr, bun_core::Error> {
        let _ = (source, log, bump);
        todo!("b2-blocked: bun_js_parser::js_lexer + bun_logger::js_ast")
    }
}

/// Zig-side import path is `bun.json` (the parser module). Downstream Rust
/// crates name it both `json` and `json_parser`; alias the latter here.
pub use json as json_parser;

// ───── json5 ──────────────────────────────────────────────────────────────
#[path = "json5.rs"]
pub mod json5;

// ───── toml ───────────────────────────────────────────────────────────────
#[path = "toml.rs"]
pub mod toml;

// ───── yaml ───────────────────────────────────────────────────────────────
// Scanner + utility types compile against a local opaque `Expr` stub; the
// AST-producing parse_* fns remain gated on the js_ast MOVE_DOWN.
#[path = "yaml.rs"]
pub mod yaml;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/interchange.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; submodules ported separately
// ──────────────────────────────────────────────────────────────────────────
