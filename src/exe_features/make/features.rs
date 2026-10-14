//! The features that can be left out, by the names that `--compile-exclude-features` takes.

// `pub` is for `bun_core`, whose file it is.
#[allow(unreachable_pub)]
#[path = "../../bun_core/feature/ids.rs"]
mod ids;

/// {name, what its `bun_core::feature::enter` and `present` are given}
pub(super) const FEATURES: &[(&str, u32)] = &[
    ("check", ids::CHECK),
    ("lint", ids::LINT),
    ("fmt", ids::FMT),
];
