#[repr(u8)] // conceptually a 2-bit enum — Rust has no u2, smallest repr is u8
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum FetchRedirect {
    Follow,
    Manual,
    Error,
}

// ≤8 entries — per PORTING.md a plain match is fine, but keep a phf::Map to
// preserve the `FetchRedirect.Map.get(...)` call shape for external callers.
pub static MAP: phf::Map<&'static [u8], FetchRedirect> = phf::phf_map! {
    b"follow" => FetchRedirect::Follow,
    b"manual" => FetchRedirect::Manual,
    b"error"  => FetchRedirect::Error,
};

// Per PORTING.md, `to_js` is an extension-trait method living in
// `bun_http_jsc`; the base type carries no jsc reference.

// ═══════════════════════════════════════════════════════════════════════
// CommonAbortReason — moved from bun_jsc.
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
