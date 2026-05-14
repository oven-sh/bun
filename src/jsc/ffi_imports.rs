//! Consolidated `unsafe extern "C" { … }` import surface for `bun_jsc`.
//!
//! See `src/runtime/ffi_imports.rs` for the migration protocol. `bun_jsc` has
//! the larger share of scattered extern blocks (~200) because every JSC C++
//! shim (`JSC__JSValue__*`, `Bun__*`, `WebCore__*`) is currently declared next
//! to its first Rust caller. Consolidating here means:
//!
//!   - one `#[allow(improper_ctypes)]` instead of dozens,
//!   - duplicate decls (same symbol declared in 3 files with 3 different
//!     pointer mutabilities) become a compile error instead of silent UB,
//!   - the win-x64 `extern "sysv64"` cfg-split for JSC-ABI imports is done
//!     once via the `jsc_abi!` macro below.
//!
//! Subsystem blocks are split by C++ source file so a `git blame` on the
//! header still lines up.
#![allow(non_snake_case, dead_code, improper_ctypes, clippy::missing_safety_doc)]

use crate::{CallFrame, JSGlobalObject, JSValue};
use core::ffi::{c_char, c_int, c_void};

/// Declare an `extern` block with the JSC calling convention (`"sysv64"` on
/// win-x64, `"C"` elsewhere). Mirrors Zig's single `jsc.conv` constant
/// (`src/jsc/jsc.zig:9`); Rust forbids non-literal ABI strings, so the
/// cfg-split lives here once instead of being hand-duplicated at each site.
///
/// Two call shapes:
///   jsc_abi_extern! { fn foo(); safe fn bar(); }            // bare body
///   jsc_abi_extern! { #[allow(improper_ctypes)] { fn x(); } } // + outer attrs
///
/// Body tokens pass through verbatim, so `#[link_name = …]`, `safe fn`,
/// `concat!()` link names, and outer-macro metavariables all work.
#[macro_export]
#[doc(hidden)]
macro_rules! jsc_abi_extern {
    ($(#[$outer:meta])* { $($body:tt)* }) => {
        $(#[$outer])*
        #[cfg(all(windows, target_arch = "x86_64"))]
        unsafe extern "sysv64" { $($body)* }
        $(#[$outer])*
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        unsafe extern "C" { $($body)* }
    };
    ($($body:tt)*) => {
        $crate::jsc_abi_extern! { { $($body)* } }
    };
}

// ─── JSC__JSValue / JSC__JSGlobalObject (bindings/bindings.cpp) ─────────────
// (populated incrementally — see audit comment in generated_host_exports.rs)
unsafe extern "C" {}
