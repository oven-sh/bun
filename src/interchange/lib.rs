// ──────────────────────────────────────────────────────────────────────────
// B-1 GATE-AND-STUB
//   Phase-A draft bodies are preserved on disk but gated behind
//   `#[cfg(any())]` so they don't participate in compilation. Minimal stub
//   surface is exposed below. Un-gating happens in B-2.
//
//   gated reasons (per module):
//     json   - TODO(b1): bun_logger::js_ast / bun_logger::js_printer missing;
//              bun_js_parser crate not in deps
//     json5  - TODO(b1): bun_logger::lexer / bun_logger::js_ast missing;
//              bun_str crate not in deps; thiserror not in deps
//     toml   - TODO(b1): bun_logger::js_ast missing;
//              bun_collections::identity_context missing;
//              bun_js_parser / bun_str not in deps; thiserror not in deps
//     yaml   - TODO(b1): bun_logger::ast missing; thiserror not in deps;
//              E0658 adt_const_params (ConstParamTy on enum FirstChar);
//              duplicate `FirstChar` definition
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
#[path = "json.rs"]
pub mod json_draft;
#[cfg(any())]
#[path = "json5.rs"]
pub mod json5_draft;
#[cfg(any())]
#[path = "toml.rs"]
pub mod toml_draft;
#[cfg(any())]
#[path = "yaml.rs"]
pub mod yaml_draft;

// ───── stub surface ───────────────────────────────────────────────────────

pub mod json {
    /// Opaque stub for `json::Expr` (re-export of `bun_logger::js_ast::Expr`).
    /// TODO(b1): bun_logger::js_ast::Expr missing from lower-tier stub surface.
    pub struct Expr(());
}

pub mod json5 {}

pub mod toml {
    pub mod lexer {}
}

pub mod yaml {}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/interchange.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; submodules ported separately
// ──────────────────────────────────────────────────────────────────────────
