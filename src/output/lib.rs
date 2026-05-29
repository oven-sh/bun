//! `bun_output` — thin facade over `bun_core::output`.
//!
//! Downstream crates reference scoped logging as `bun_output::declare_scope!` /
//! `bun_output::scoped_log!`. The actual implementation lives in `bun_core`
//! (see `src/bun_core/output.rs`); this crate re-exports it so downstream
//! crates can depend on `bun_output` without pulling all of `bun_core` into
//! their public surface.
//!
//! `$crate` inside the re-exported `macro_rules!` bodies still resolves to
//! `bun_core`, so the expansion paths (`$crate::output::ScopedLogger`,
//! `$crate::pretty_fmt!`) continue to work unchanged.

#![warn(unused_must_use)]
pub use bun_core::declare_scope;
pub use bun_core::define_scoped_log;
pub use bun_core::scoped_log;

// Supporting types the macro expansions name. Not strictly required for
// `$crate` resolution, but exposed so callers can name them directly
// (`bun_output::ScopedLogger`, `bun_output::Visibility::Hidden`).
pub use bun_core::output::{ScopedLogger, Visibility};

pub use bun_core::output::*;
pub use bun_core::{
    debug, debug_warn, err_generic, note, pretty, pretty_error, pretty_errorln, pretty_fmt,
    prettyln, print_errorln, warn,
};

#[macro_export]
macro_rules! scope_is_visible {
    ($scope:ident) => {
        $scope.is_visible()
    };
}
