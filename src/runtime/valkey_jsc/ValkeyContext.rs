//! Per-VM Valkey state. The four cached `us_socket_context_t`s that used to
//! live here are gone — connections link into `RareData.valkey_group` /
//! `valkey_tls_group` instead, and the default-TLS `SSL_CTX` is
//! `RareData.defaultClientSslCtx()`.

#[derive(Default)]
pub struct ValkeyContext;

// Zig had `pub fn deinit(_: *@This()) void {}` — empty body, no side effects.
// Per PORTING.md: empty deinit → no `impl Drop` needed (Rust drops fields automatically).

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/ValkeyContext.zig (6 lines)
//   confidence: high
//   todos:      0
//   notes:      empty file-level struct; deinit was a no-op so no Drop impl
// ──────────────────────────────────────────────────────────────────────────
