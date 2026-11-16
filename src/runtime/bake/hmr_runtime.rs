//! The HMR runtime code embedded in the binary, per side.
#![allow(unexpected_cfgs)] // `bun_codegen_embed` is set via RUSTFLAGS (scripts/build/rust.ts) for release/CI builds.

use crate::bake::Side;
use bun_core::{ZStr, strings};

/// `bake.HmrRuntime` — embedded HMR runtime code + precomputed line count.
pub(crate) struct HmrRuntime {
    /// NUL-terminated; the sentinel is
    /// load-bearing where this buffer is handed to JSC/C++ as a C string.
    pub(crate) code: &'static bun_core::ZStr,
    pub(crate) line_count: u32,
}
// (Former `__bun_bake_get_hmr_runtime` link-time bridge deleted —
// `bun_bundler::bake_types::get_hmr_runtime` now loads the codegen bytes
// itself via `bun_core::runtime_embed_file!`, so the storage moved DOWN and
// the cross-crate hook is gone. This crate's `HmrRuntime` keeps the
// NUL-terminated `&ZStr` form for JSC handoff; the bundler-side one is plain
// `&[u8]`.)

fn hmr_runtime_init(code: &'static ZStr) -> HmrRuntime {
    HmrRuntime {
        code,
        line_count: u32::try_from(strings::count_char(code.as_bytes(), b'\n')).unwrap(),
    }
}

#[inline(always)]
pub(crate) fn get_hmr_runtime(side: Side) -> HmrRuntime {
    // `runtime_embed_file!` returns `&'static str` (no NUL). Use a per-side
    // `OnceLock` holding the NUL-terminated copy — read once per process,
    // never freed. PORTING.md §Forbidden bans leaking for `&'static`; this is the
    // sanctioned process-lifetime-singleton pattern instead. (Under
    // `cfg(bun_codegen_embed)` the macro expands to `include_str!`, so this
    // costs one extra copy at first call; the cost is negligible vs. keeping
    // a per-call-site `#[cfg]` pair in sync.)
    use std::sync::OnceLock;
    fn nul_terminate(s: &'static [u8], cell: &'static OnceLock<Box<[u8]>>) -> &'static ZStr {
        let buf = cell.get_or_init(|| {
            let mut v = Vec::with_capacity(s.len() + 1);
            v.extend_from_slice(s);
            v.push(0);
            v.into_boxed_slice()
        });
        // SAFETY: buf is process-lifetime (`OnceLock` static), buf[len-1] == 0.
        ZStr::from_slice_with_nul(&buf[..])
    }
    static SERVER: OnceLock<Box<[u8]>> = OnceLock::new();
    hmr_runtime_init(match side {
        // Shipped to the browser, so release builds embed it compressed; the
        // bundler owns the one inflated (NUL-terminated) copy.
        Side::Client => {
            ZStr::from_slice_with_nul(bun_bundler::bake_types::bake_client_js_with_nul())
        }
        // server runtime is loaded once, so it is pointless to make this eager.
        Side::Server => nul_terminate(
            bun_core::runtime_embed_file!(Codegen, "bake.server.js").as_bytes(),
            &SERVER,
        ),
    })
}
