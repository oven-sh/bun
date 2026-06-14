//! Smoke crate that compiles the three layout-assert authoring files in
//! `../layout_asserts/` against the live workspace crates.
//!
//! Each `assertions::<crate>` module brings the target crate's types into
//! root-namespace scope (matching the names referenced unqualified in the
//! authoring files), then `include!`s the file. If any number is wrong,
//! `cargo check` fails with the assert's stringified message.
//!
//! ## How to run
//!
//! ```sh
//! cd .ub-exorcism/2026-05-15-exhaustive/experiments/layout_asserts_smoke
//!
//! # Linux/macOS — exercises boringssl_sys asserts (gated x86_64 + linux/macos)
//! cargo check
//!
//! # Windows x64 — exercises windows_sys + handle_type_enum asserts
//! cargo check --target x86_64-pc-windows-msvc
//! ```
//!
//! Note: rustc requires that everything `include!`d is syntactically valid
//! Rust *even if cfg-gated out*, so all three files compile-check even on
//! the wrong host — the assert bodies only run on their gated target.

#![allow(unused_imports, unused, non_snake_case, non_camel_case_types, non_upper_case_globals)]

/// Brings `bun_windows_sys`'s 48 `#[repr(C)]` types into scope and includes
/// the authored windows_sys.rs file. The assert block inside is gated on
/// `#[cfg(all(windows, target_pointer_width = "64"))]` so it only fires
/// when checking with `--target x86_64-pc-windows-msvc`.
mod assertions_windows_sys {
    pub use bun_windows_sys::*;
    // `ws2_32::*` types stay qualified in the asserts; the glob-re-export at
    // `bun_windows_sys::ws2_32::*` is preserved by `pub use *`.
    include!("../../layout_asserts/windows_sys.rs");
}

/// Brings `bun_boringssl_sys`'s 15 `#[repr(C)]` types into scope and
/// includes the authored boringssl_sys.rs file. Gated on x86_64 +
/// linux/macos so it fires on the Linux CI runner.
mod assertions_boringssl_sys {
    pub use bun_boringssl_sys::*;
    include!("../../layout_asserts/boringssl_sys.rs");
}

/// Brings `bun_libuv_sys::HandleType` + companion constants into scope
/// and includes the authored handle_type_enum.rs file. Gated on `windows`
/// to match the parent libuv module's gate.
mod assertions_handle_type_enum {
    // Re-export everything from the cfg(windows) module body. On non-Windows
    // the `pub use ... *` is empty (the module is cfg-stripped), which is
    // fine because the assert block inside is also cfg(windows)-gated.
    #[cfg(windows)]
    pub use bun_libuv_sys::*;
    include!("../../layout_asserts/handle_type_enum.rs");
}
