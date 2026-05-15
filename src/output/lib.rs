//! `bun_output` — thin facade over `bun_core::output`.
//!
//! Phase-A drafts followed PORTING.md §211 and reference scoped logging as
//! `bun_output::declare_scope!` / `bun_output::scoped_log!`. The actual
//! implementation lives in `bun_core` (see `src/bun_core/output.rs`); this
//! crate re-exports it so downstream crates can depend on `bun_output`
//! without pulling all of `bun_core` into their public surface.
//!
//! `$crate` inside the re-exported `macro_rules!` bodies still resolves to
//! `bun_core`, so the expansion paths (`$crate::output::ScopedLogger`,
//! `$crate::pretty_fmt!`) continue to work unchanged.

#![allow(unused_imports)]
#![warn(unused_must_use)]
// ── scoped logging (the requested symbol) ────────────────────────────────
//
// Zig: `bun.Output.scoped(.X, .visible)` → Rust:
//
//     bun_output::declare_scope!(X, visible);
//     bun_output::scoped_log!(X, "fmt {} {}", a, b);
//
// `declare_scope!` expands to a `pub static X: ScopedLogger`; `scoped_log!`
// gates arg evaluation behind `cfg!(feature = "debug_logs")` so release
// builds pay zero cost (see PORTING.md — args MUST sit inside the dead
// branch).
#![warn(unreachable_pub)]
pub use bun_core::declare_scope;
pub use bun_core::define_scoped_log;
pub use bun_core::scoped_log;

// Supporting types the macro expansions name. Not strictly required for
// `$crate` resolution, but exposed so callers can name them directly
// (`bun_output::ScopedLogger`, `bun_output::Visibility::Hidden`).
pub use bun_core::output::{ScopedLogger, Visibility};

// ── pass-through of the rest of the Output surface ───────────────────────
// Downstream code also reaches for `bun_output::error_writer()`,
// `bun_output::pretty_fmt!`, etc. Glob-re-export the module + the other
// `#[macro_export]`ed macros so this crate is a drop-in alias for
// `bun_core::output`.
pub use bun_core::output::*;
pub use bun_core::{
    debug, debug_warn, err_generic, note, pretty, pretty_error, pretty_errorln, pretty_fmt,
    prettyln, print_errorln, warn,
};

/// `bun_output::scope_is_visible!(X)` — sugar for `X.is_visible()` on a
/// `declare_scope!`-produced static. Mirrors Zig
/// `Output.isScopeVisible(.X)`. Kept as a macro (not a fn) so the scope
/// ident resolves at the call site without an import.
#[macro_export]
macro_rules! scope_is_visible {
    ($scope:ident) => {
        $scope.is_visible()
    };
}
