// ──────────────────────────────────────────────────────────────────────────
// B-2 UN-GATE
//   Phase-A draft bodies are progressively un-gated and made to compile.
//   Modules that remain blocked on lower-tier MOVE_DOWN symbols (chiefly
//   `bun_logger::js_ast`) keep a `` gate on the affected items
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

// ───── json_lexer (CYCLEBREAK) ────────────────────────────────────────────
// JSON-only subset of `bun_js_parser::js_lexer`, sliced from
// `src/js_parser/lexer.zig` with `is_json = true` arms taken. Breaks the
// GENUINE T4 cycle (`bun_js_parser` → `bun_interchange` → `bun_js_parser`)
// so `json.rs` can build without an upward dep. See module doc-comment.
pub mod json_lexer;

// ───── json ───────────────────────────────────────────────────────────────
// Real port lives in `json.rs` and is wired against `crate::json_lexer` (the
// cycle-break above). The inline `pub mod json` below is the live surface
// re-exported as `json_parser`; `json.rs` replaces it once the remaining
// `bun_logger::js_ast` shape mismatches in its body are reconciled.
// PORT NOTE: `json.rs` is intentionally NOT `mod`-included here yet — it is
// the _draft_ with duplicate symbols of the inline `json` mod (per phase-d
// policy: drop the draft module from the build, keep the file on disk).

pub mod json {
    use bumpalo::Bump;
    use bun_logger as logger;

    // TODO(b2-blocked): bun_logger::js_printer
    // TODO(b2-blocked): bun_js_parser::js_lexer (GENUINE cycle — needs js_lexer split)
    /// `json::Expr` — re-export of the MOVE_DOWN'd `bun_logger::js_ast::Expr`
    /// (Zig: `js_ast.Expr`). The full json.rs draft does the same re-export;
    /// surfacing it here lets downstream `json_parser::Expr` callers resolve
    /// against the real `{ loc, data }` shape instead of an opaque unit stub.
    pub use bun_logger::js_ast::Expr;

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
#[path = "yaml.rs"]
pub mod yaml;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/interchange.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; submodules ported separately
// ──────────────────────────────────────────────────────────────────────────
