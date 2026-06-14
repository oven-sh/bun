# Codex Review — Phase 1 Section E (`runtime-socket-udp-tcp`)

Reviewed against current source on `claude/ub-exorcist-audit` / `origin/main`
baseline `4d443e5402`.

## Correction Applied

Section E correctly found no local `unsafe impl Send` / `unsafe impl Sync` rows
in `src/runtime/socket/*.rs`, but the wording said "every type in Section E" is
single-JS-thread-affine. That was too broad because
`src/runtime/socket/SSLConfig.rs` re-exports the canonical
`bun_http::SSLConfig`, whose `unsafe impl Send/Sync` lives in
`src/http/ssl_config.rs:442-445`.

The corrected wording distinguishes:

- local socket wrapper types (`NewSocket`, `Listener`, `UDPSocket`, `Handlers`,
  `WindowsNamedPipeContext`) are `!Send`/`!Sync` by auto-trait propagation from
  `Cell`, `JsCell`, JSC handles, and raw pointers;
- the re-exported `bun_http::SSLConfig` is a cross-section type with its own
  documented Send/Sync proof in the HTTP/network section.

No Section-E bug classification changed.
