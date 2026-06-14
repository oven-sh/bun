//! EXP-051: `bun-native-plugin-rs::BunLoader` `(u8 as u32)` transmute
//! into `#[repr(u32)]` enum lacks validity check.
//!
//! Mirrors the live public-API shape at
//! `packages/bun-native-plugin-rs/src/lib.rs:637`:
//!
//! ```ignore
//! pub fn output_loader(&self) -> BunLoader {
//!     unsafe { std::mem::transmute((*self.result_raw).loader as u32) }
//! }
//! ```
//!
//! `BunLoader` is `#[repr(u32)]` with 13 valid discriminants (`0..=12`).
//! `(*self.result_raw).loader` is the `u8` field of the C-side
//! `OnBeforeParseResult` struct (`sys.rs:155`). A hostile or buggy host
//! plugin that writes any byte in `13..=255` to that field causes
//! immediate UB the moment Rust calls `output_loader()` — Rust assumes
//! enum values match a declared discriminant, and producing an
//! out-of-range `BunLoader` is instant validity UB regardless of whether
//! the value is ever pattern-matched.
//!
//! Run under Miri (no extra flags required — validity UB is part of the
//! default checks):
//!
//! ```sh
//! cargo +nightly miri run
//! ```

// Mirror of sys::BunLoader (13 variants, #[repr(u32)]).
#[repr(u32)]
#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
#[allow(dead_code)]
enum BunLoader {
    BunLoaderJsx = 0,
    BunLoaderJs = 1,
    BunLoaderTs = 2,
    BunLoaderTsx = 3,
    BunLoaderCss = 4,
    BunLoaderFile = 5,
    BunLoaderJson = 6,
    BunLoaderToml = 7,
    BunLoaderWasm = 8,
    BunLoaderNapi = 9,
    BunLoaderBase64 = 10,
    BunLoaderDataurl = 11,
    BunLoaderText = 12,
}

// Mirror of sys::OnBeforeParseResult — only the `loader: u8` field
// matters for this experiment, but we keep the prefix shape honest so the
// `(*self.result_raw).loader as u8 as u32` pattern reads the right byte.
#[repr(C)]
struct OnBeforeParseResult {
    __struct_size: usize,
    source_ptr: *mut u8,
    source_len: usize,
    loader: u8,
}

/// Verbatim copy of `OnBeforeParse::output_loader` from
/// `packages/bun-native-plugin-rs/src/lib.rs:636-638`.
fn output_loader(result_raw: *const OnBeforeParseResult) -> BunLoader {
    unsafe { std::mem::transmute((*result_raw).loader as u32) }
}

fn main() {
    // Simulate a hostile (or simply buggy) host writing a loader value
    // outside the declared `0..=12` range — exactly what an out-of-date
    // Bun-core or a malicious in-process plugin neighbour can do.
    let hostile = OnBeforeParseResult {
        __struct_size: core::mem::size_of::<OnBeforeParseResult>(),
        source_ptr: core::ptr::null_mut(),
        source_len: 0,
        loader: 0xff,
    };

    // The transmute on the next line is the UB site. Miri must reject
    // here even before we attempt to use the value, because constructing
    // an enum with an invalid discriminant is *immediate* UB.
    let loader = output_loader(&hostile as *const _);

    // Touching the result forces any optimizer (and confirms to a reader)
    // that the value really is observed. Miri would already have stopped
    // on the line above, but this guards against silent dead-code elision
    // in any future variation of the test.
    println!("loader = {:?}", loader);
}
