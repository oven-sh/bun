//! JSC bridge for `bun_css::Err<T>`. Keeps `src/css/` free of JSC types.

use core::fmt::Display;

use bun_alloc::AllocError;
use bun_core::String as BunString;
use bun_jsc::{JSGlobalObject, JSValue};

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
    let str = BunString::create_format(format_args!("{}", this.kind));
    // `defer str.deref()` — `bun_core::String` is `Copy` and has no `Drop`, so deref explicitly.
    let js = bun_jsc::bun_string_jsc::to_error_instance(&str, global_this);
    str.deref();
    Ok(js)
}

// ported from: src/css_jsc/error_jsc.zig
