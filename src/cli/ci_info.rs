// A modified port of ci-info@4.0.0 (https://github.com/watson/ci-info)
// Only gets the CI name, `isPR` is not implemented.
// Main implementation is in src/codegen/ci_info.ts

use bun_core::env_var;
// TODO(port): `@import("ci_info")` is a build.zig-registered generated module (output of
// src/codegen/ci_info.ts). Wire the actual Rust module path in Phase B.
use crate::ci_info_generated as generated;

// TODO(port): `bun.once(fn)` stores the fn at construction and `.call(.{})` invokes it once,
// caching the result. Mapped here to `bun_core::Once<T>` with `.call(init_fn)` (≈ OnceLock).
static DETECT_CI_ONCE: bun_core::Once<Option<&'static [u8]>> = bun_core::Once::new();
static IS_CI_ONCE: bun_core::Once<bool> = bun_core::Once::new();

/// returns true if the current process is running in a CI environment
pub fn is_ci() -> bool {
    *IS_CI_ONCE.call(is_ci_uncached)
}

/// returns the CI name, or None if the CI name could not be determined. note that this can be None even if `is_ci` is true.
pub fn detect_ci_name() -> Option<&'static [u8]> {
    *DETECT_CI_ONCE.call(detect_uncached)
}

fn is_ci_uncached() -> bool {
    env_var::CI.get().unwrap_or_else(|| generated::is_ci_uncached_generated())
        || detect_ci_name().is_some()
}

fn detect_uncached() -> Option<&'static [u8]> {
    if env_var::CI.get() == Some(false) {
        return None;
    }
    generated::detect_uncached_generated()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/ci_info.zig (27 lines)
//   confidence: medium
//   todos:      2
//   notes:      `bun_core::Once` API shape assumed; generated `ci_info` module path needs Phase B wiring
// ──────────────────────────────────────────────────────────────────────────
