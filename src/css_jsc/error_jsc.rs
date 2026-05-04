//! JSC bridge for `bun_css::Err<T>`. Keeps `src/css/` free of JSC types.

use core::fmt::Display;

use bun_alloc::AllocError;
use bun_jsc::{JSGlobalObject, JSValue, StringJsc as _};
use bun_str::String as BunString;

/// `this` is `&css::Err<T>` for any `T`; only `.kind` is accessed.
// Zig `!JSValue` (inferred set) — only fallible call is `create_format` (OOM), so AllocError.
pub fn to_error_instance<T>(
    this: &bun_css::Err<T>,
    global_this: &JSGlobalObject,
) -> Result<JSValue, AllocError>
where
    // The Zig formats `this.kind` with `{f}`; in Rust the kind type must be `Display`.
    bun_css::ErrKind<T>: Display,
{
    let str = BunString::create_format(format_args!("{}", this.kind))?;
    // `defer str.deref()` — handled by `Drop for bun_str::String`.
    Ok(str.to_error_instance(global_this))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css_jsc/error_jsc.zig (10 lines)
//   confidence: medium
//   todos:      0
//   notes:      `anytype` mapped to `&bun_css::Err<T>`; assumed `ErrKind<T>: Display` and `StringJsc::to_error_instance` ext-trait — verify exact names in Phase B.
// ──────────────────────────────────────────────────────────────────────────
