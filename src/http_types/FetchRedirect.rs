#[repr(u8)] // Zig: enum(u2) — Rust has no u2, smallest repr is u8
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum FetchRedirect {
    Follow,
    Manual,
    Error,
}

// Zig: pub const Map = bun.ComptimeStringMap(FetchRedirect, .{...})
// ≤8 entries — per PORTING.md a plain match is fine, but keep a phf::Map to
// preserve the `FetchRedirect.Map.get(...)` call shape for external callers.
pub static MAP: phf::Map<&'static [u8], FetchRedirect> = phf::phf_map! {
    b"follow" => FetchRedirect::Follow,
    b"manual" => FetchRedirect::Manual,
    b"error"  => FetchRedirect::Error,
};

// Zig: pub const toJS = @import("../http_jsc/fetch_enums_jsc.zig").fetchRedirectToJS;
// Deleted per PORTING.md — `to_js` is an extension-trait method living in
// `bun_http_jsc`; the base type carries no jsc reference.

// ═══════════════════════════════════════════════════════════════════════
// TYPE_ONLY: bun_jsc::CommonAbortReason → http_types
// (CYCLEBREAK.md / movein-skipped, requested by `http`)
// Source: src/jsc/CommonAbortReason.zig
//
// `enum(u8)` discriminant crosses the FFI boundary to
// `WebCore__CommonAbortReason__toJS` and `WebCore__AbortSignal__signal`.
// `to_js()` stays in `bun_jsc` as an extension-trait method (it names
// `*JSGlobalObject` / `JSValue`, both T6).
// ═══════════════════════════════════════════════════════════════════════

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CommonAbortReason {
    Timeout = 1,
    UserAbort = 2,
    ConnectionClosed = 3,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/FetchRedirect.zig (14 lines)
//   confidence: high
//   todos:      0
//   notes:      MAP hoisted to module-level static (Rust associated statics not allowed); toJS alias dropped per *_jsc rule
// ──────────────────────────────────────────────────────────────────────────
