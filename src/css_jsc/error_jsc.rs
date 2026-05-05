//! JSC bridge for `bun_css::Err<T>`. Keeps `src/css/` free of JSC types.

use core::fmt::Display;

use bun_alloc::AllocError;
use bun_jsc::{JSGlobalObject, JSValue};
use bun_string::String as BunString;

/// `this` is `&css::Err<T>` for any `T`; only `.kind` is accessed.
// Zig `!JSValue` (inferred set) — only fallible call is `create_format` (OOM), so AllocError.
pub fn to_error_instance<T>(
    this: &bun_css::Err<T>,
    global_this: &JSGlobalObject,
) -> Result<JSValue, AllocError>
where
    // The Zig formats `this.kind` with `{f}`; in Rust the kind type must be `Display`.
    T: Display,
{
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_jsc::bun_string_jsc::to_error_instance
        let str = BunString::create_format(format_args!("{}", this.kind));
        // `defer str.deref()` — handled by `Drop for bun_str::String`.
        return Ok(bun_jsc::bun_string_jsc::to_error_instance(&str, global_this));
    }
    let _ = (this, global_this);
    todo!("bun_css_jsc::error_jsc::to_error_instance — gated on bun_jsc::bun_string_jsc::to_error_instance")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css_jsc/error_jsc.zig (10 lines)
//   confidence: medium
//   todos:      2 (b2-blocked)
//   notes:      `anytype` mapped to `&bun_css::Err<T>`; `T: Display` bound; body gated on bun_string/bun_jsc ext-trait surface.
// ──────────────────────────────────────────────────────────────────────────
