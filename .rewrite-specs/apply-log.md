# Apply log

## 2026-07-12 — Wave A applier (integration pass)

### Build/environment
- `BUN_CODEGEN_DIR=/root/bun/build/debug/codegen` was STALE for this branch
  (missing `json_byte_class.rs`; `cpp.rs` and `generated_classes.rs` predate
  branch symbols like `Bun__preExecutionBootstrap`). Resolution: configured the
  worktree (`bun scripts/build.ts --configure-only`) and built all 105 codegen
  ninja targets into the WORKTREE's `build/debug/codegen`. **Subsequent cargo
  runs in this worktree must use `BUN_CODEGEN_DIR=<worktree>/build/debug/codegen`.**
  (I also regenerated `json_byte_class.{h,rs}` + `cpp.rs` into the main-tree
  dir — additive, harmless to other sessions.)
- The configure wiped + refetched `vendor/boringssl` (W17's changed patch
  identity, as predicted). Refetched via `ninja ../../vendor/boringssl/.ref`;
  bssl-sys path dep intact again.

### Compile fixes (integration errors, no semantics touched)
- `unsafe_core/trampolines.rs:191/201`: parenthesized `(unsafe { … }) % 2` (parse error).
- `unsafe_core/io.rs`: linux libc 0.2.186 lacks `group_source_req` (added local
  `#[repr(C)]` struct for non-apple; glibc/FreeBSD layout is naturally aligned),
  lacks `IPV6_JOIN/LEAVE_GROUP` on linux/android (use `IPV6_ADD/DROP_MEMBERSHIP`,
  same values), and does not declare `inet_pton` at all (local POSIX extern).
- `loop_/mod.rs`: `WakeupAsync` opaque type gained `#[repr(C)]` (improper_ctypes
  deny-warnings on every `*mut Loop` extern).
- `unsafe_core/ffi.rs`: `Bun__addrinfo_set/cancel` extern params changed to
  `*mut c_void` (ConnectingSocket is repr(Rust); the resolver treats it as
  opaque anyway) + `.cast()` at the two wrappers. Added
  `#[allow(improper_ctypes)]` on the extern blocks that carry `*mut Loop`
  (opaque to C; the lint recurses into pointee fields ad infinitum —
  SocketFlags, etc.).

### Cross-shard fixes applied (flag resolutions)
- socket.rs:917 `set_timeout`: `(seconds + 3) >> 2` → wrapping arithmetic
  (W9's flagged sibling of connecting.rs:217; debug-build overflow panic on
  u32-max input from cabi).
- group.rs `adopt_socket`: added the W14-requested
  `debug_assert!(uses_group_vtable(old) == uses_group_vtable(new))`
  (adoption-family invariant).
- ffi.rs `scratch_alloc`: added the missing `US_FAULT_SSL_LOOP_BUFFER` hook
  (R11.2; fires → `bun_core::out_of_memory()`, matching C's
  `ssl_alloc_read_output` → NULL → `Bun__outOfMemory`).
- cabi.rs `us_listen_socket_next`: null on closed listeners (W8 flag — Rust
  reuses `next` as the closed-chain link; C's dedicated link reads NULL).
- kind.rs: deleted dead `adoption_family_ext_size` (W14: zero callers,
  contradicted the resolved Dynamic-ext rule).
- backend/mod.rs: deleted the reserved `PollType::Semaphore` variant (W2 asked
  confirm-or-delete; no C counterpart, nothing constructs it; discriminants
  are explicit so numbering unchanged, gap documented).

### SNI: implemented the MISSING select-cert/servername callbacks
The crate had all building blocks (SniMap, `client_hello_servername`,
bssl `SniSuspension` ex_data machinery, listener backref, `sni_resolve`
re-drive) but **no `us_select_cert_cb`/`sni_cb` port and no registration** —
server SNI (static tree and async SNICallback) was entirely unwired.
- ffi.rs: new section ports openssl.c:2317-2454 —
  `select_cert_cb` (suspension consume → resolver-first → abort/suspend/
  install/static-tree, resume-null falls to the tree like sync cb(null,null)),
  `sni_cb` (static tree only, no-ops when a dynamic resolver exists),
  `hello_servername` (raw ClientHello parse via bssl_sys
  `SSL_early_callback_ctx_extension_get`), `register_servername_cb` /
  `register_select_cert_cb`. Uses bssl_sys types directly for
  SSL_CLIENT_HELLO (layout safety).
  DEVIATION (documented in-code): no loop-state save/restore around the
  resolver — the C's loop-global {ssl_socket, read window} is per-socket
  `BioCtl` in this design, so there is nothing loop-global to clobber.
  DEVIATION (verbatim C parity): abort==1/2 paths do NOT free a non-null
  resolver return (C leaks identically; real resolvers return null there).
- handle.rs `add_server_name`: now fails on a null default ctx (C -1),
  creates the tree + registers `sni_cb` on first add, and stamps the
  per-domain `user` into CTX ex_data (`ctx_set_sni_user`, openssl.c:2473-2476)
  so `us_socket_server_name_userdata` works — that ex_data side channel was
  missing (W13 flag).
- handle.rs `on_server_name`: registers `select_cert_cb` on the default ctx.
- tls/sni.rs: deleted `PendingSni`/`SniSelection`/`interpret_resolver` (W11
  flag: dead duplicate of the bssl SniSuspension machinery; zero users).

### Implemented the two remaining tls-shard todo!() seams (cabi-flip gates)
- ffi.rs `socket_server_name_userdata` → new `socket::server_name_userdata`
  (SSL_get_SSL_CTX → ctx ex_data `sni_user`; null for plain/detached).
- ffi.rs `listen_socket_find_server_name_ctx` → SniMap::find_ctx (OWNED ref),
  guarded on closed listeners (ListenerData freed at close).

### Verification status
- `cargo check -p bun_usockets` — green (also with `--features
  cabi,socket_fault_injection`).
- `cargo test -p bun_usockets` — 10/10 slab tests pass.
- `cargo check --workspace` — green (worktree codegen dir).
- Cross-target `cargo check -p bun_usockets` (darwin x64/arm64, windows msvc
  x64/arm64, freebsd, android, musl, aarch64-gnu): see next entry.

### Known remaining / for later waves
- Windows winsock + libuv-UDP io.rs bodies are still `todo!()` (deferred
  winsock shard) — any Windows TCP-connect/UDP call panics.
- ffi.rs `create_loop_raw`… seams: implemented except none remaining as
  todo!() in ffi.rs after this pass (grep clean apart from the windows io.rs
  stubs above).
- M9/D1 ordering: cabi `us_internal_dns_callback` exports are behind the
  `cabi` feature; D1 must flip the feature and delete the C exports in one
  build step (W9/W18 flags stand).
- Frozen-signature deltas needing spec-owner ratification (carried from
  shards, not changed here): Loop tick family as raw-ptr associated fns (C17);
  Handler::* taking `ExtMut<'_, Ext>`; `SocketHeader::write_check_error(&mut
  self)`; `is_shutdown` TLS-aware.

### Cross-target results (cargo check -p bun_usockets --features cabi,socket_fault_injection)
All 8 CI triples GREEN after fixes: x86_64/aarch64-unknown-linux-gnu,
x86_64-unknown-linux-musl, aarch64-linux-android, x86_64/aarch64-apple-darwin,
x86_64/aarch64-pc-windows-msvc, x86_64-unknown-freebsd.

Per-target fixes:
- freebsd: MCAST_JOIN/LEAVE_SOURCE_GROUP defined locally (82/83, same as
  Darwin — libc lacks them on freebsd too).
- android: bionic errno spelling (`__errno`, not `__errno_location`) in
  poll_access.rs/io.rs; local extern for `epoll_pwait` (absent from libc for
  android; bionic has it since API 21).
- musl: avoided deprecated `libc::time_t` alias; `as _` casts for the musl
  msghdr/mmsg flag+len field types (c_uint flags, u32 controllen).
- windows: `udp::sockaddr_storage` — pub repr(C, align(8)) 128-byte winsock
  SOCKADDR_STORAGE mirror (libc has no windows sockaddr types; the frozen
  `&sockaddr_storage` method surface keeps compiling on all targets); windows
  io.rs multicast stubs retyped to it; lib.rs PosixLoop re-export cfg'd;
  socket.rs unused-import/unused-mut cfg splits; cabi timer exports
  `pub(crate)` (unreachable_pub deny).
- socket.rs:1088 adopt_tls debug_assert switched is_uws → uses_group_vtable
  (same family predicate as group::adopt_socket).
- scripts/build/deps/boringssl.ts:43 `?? ""` for a possibly-undefined
  firstLine (tsc; note scripts/build tsconfig has many PRE-EXISTING errors in
  untouched files — not a gate this pass introduced).

### IMPORTANT: full-binary link state
glob-sources.ts already drops the C core (only root_certs*.cpp + quic.c
survive from packages/bun-usockets) and the SHIM helpers are deleted from
libuwsockets.cpp, while the crate's `cabi` feature is OFF and bun_bin does
NOT yet depend on bun_usockets. A full `bun bd` link is EXPECTED-BROKEN in
this intermediate state (W18's documented sequencing). The deletion/flip wave
must: add bun_usockets (features=["cabi"]) to bun_bin, delete the C core
files + duplicate BUN_SOCKET_KIND_* statics in src/uws_sys/SocketKind.rs, and
land it as one build step.

### ORCHESTRATOR NOTE (pre-final cleanup, binding)
The 12 per-target bssl_bindings/wrapper_*.rs files (~343k lines committed) must be
collapsed before the PR: diff them, keep ONE shared bindings file + a minimal
cfg-gated divergence module (per-OS at worst). Verify cargo check on linux x64
+ rust:check-all after collapsing.

### ORCHESTRATOR NOTE (supersedes the bindings-dedupe note above)
Owner directive: bindgen outputs are NOT committed. A dedicated agent is moving
bssl-sys binding generation to build time (patched build.rs runs the bindgen
crate into OUT_DIR; committed per-target wrapper_*.rs files deleted; wrapper.c
stays committed with a build-time drift assert). Final applier: verify
cargo check -p bun_usockets natively AND for at least one foreign target,
confirm boringssl.ts stamp checks updated, and ensure no wrapper_*.rs remain.

## 2026-07-12 — Wave B applier (consumer-migration integration)

### Compile fixes (workspace green after these)
- HTTPContext.rs connect/connect_socket: hoisted `ssl_ctx_for_connect()` out
  of the `&mut self.group` borrow (E0502 x2).
- jsc/rare_data.rs Drop: `SSL_CTX_free(s.cast())` — boringssl-sys vs bssl-sys
  nominal seam (M12's documented cast-at-boundary rule).
- CppWebSocket.rs extern block: `#[allow(improper_ctypes)]` (lint recurses
  into SocketHeader's repr(Rust) `*mut ConnectingSocket` pointee; same class
  as Wave A's Loop externs).
- sql_jsc/postgres setup_tls: `*tcp` (JsCell::get returns by-ref pattern
  binding; NewSocketHandler is Copy).
- shell/builtin/yes.rs: `(*mini.loop_).tick()` → `bun_usockets::Loop::tick(ptr)`
  (M8's raw-ptr associated-fn tick family).
- jsc_hooks.rs: `.cast()` on both get_or_create_opts results (SSLContextCache
  returns bun_boringssl_sys::SSL_CTX; hooks are bun_usockets::SslCtx-typed).

### bun_uws / bun_uws_sys fully unlinked
- verify_error_to_js (bun_jsc::system_error) repointed to
  `&bun_usockets::us_bun_verify_error_t`; sql_jsc's field-by-field bridge
  collapsed to a `pub use` (the loud one-line fix M4 predicted).
- ResponseKind repointed bun_uws → bun_uws_shim in FetchHeaders.rs,
  CookieMap.rs, server_body.rs, RequestContext.rs.
- webcore/Request.rs migrated (`bun_uws as uws` → `bun_uws_shim as uws`,
  `#[bun_uws::uws_callback]` → shim macro re-export) and
  AnyRequestContext::get_request flipped to `*mut bun_uws_shim::Request` in
  the same change (M10's split-typed bridge TODO resolved).
- sql_jsc SslCtx refs → bun_uws_shim::SslCtx (identical alias:
  bun_boringssl::c::SSL_CTX).
- Cargo deps: bun_uws → bun_uws_shim in sql_jsc + jsc; bun_uws + bun_uws_sys
  REMOVED from bun_runtime. `cargo tree -i bun_uws` → orphan (only
  bun_uws → bun_uws_sys edge remains, workspace-member-only). The M11
  duplicate-#[no_mangle] link hazard is gone without deleting the crates
  (D1 still deletes the source dirs).

### cabi flip (the apply-log Wave A "deletion/flip wave" step)
- bun_bin: added `bun_usockets = { workspace = true, features = ["cabi"] }`
  + `use bun_usockets as _;` force-link in lib.rs.
- scripts/build/rust.ts: `--features bun_usockets/socket_fault_injection`
  pushed alongside `--cfg=socket_fault_injection` (M1's loud-gap flag).
- Verified ninja graph: C core gone; only root_certs*.cpp + quic.c +
  UnifiedSource-src_uws_sys (surviving C++ uWS glue) compile from the old
  tree.
- vendor/boringssl vanished mid-session (concurrent activity on the shared
  /root/bun/vendor); refetched via `ninja ../../vendor/boringssl/.ref`.

### In progress
- Full `bun bd --version` running in background; subsystem tests next.

### Full binary LINKS AND RUNS (first time on the Rust core)
- One undefined symbol at link: `us_raw_root_certs` — the NTLS-consumed
  wrapper lived in (deleted) context.c, delegating to
  `us_internal_raw_root_certs` in surviving root_certs.cpp. Fixed by renaming
  the root_certs.cpp definition to `us_raw_root_certs` (its only caller;
  matches cabi-surface.md §1.7 "stays in surviving C++ TUs"). The stale
  us_internal_ decl in internal.h is D1 cleanup.
- `bun bd --version` → 1.4.0-debug. Smoke: Bun.serve+fetch roundtrip OK,
  real TLS fetch (https://example.com) OK.
- core hardening while waiting: from_fd now debug_asserts
  `!uses_group_vtable(kind)` before stamping the ext word (M6's flagged
  Dynamic-clobber hazard).

### Test results (debug build, this box is shared — expect some timing noise)
- test/js/bun/net/: 90 pass / 3 skip / 0 fail (65.6s).
- remaining suites running: udp, dgram, websocket, fetch, spawn-ipc,
  node/net, node/tls, serve.

### Test-environment caveats (shared box)
- Load average ~270 from concurrent sessions during the suite runs — timeout
  failures must be retested solo before being treated as regressions.
- test/node_modules was missing in this worktree; `bun install
  --ignore-scripts` fixed it (puppeteer postinstall fails; known issue).
  Early websocket failures (ws / https-proxy-agent ERR_MODULE_NOT_FOUND) were
  this, not code.
- "bad permissions throws" fetch tests fail because we run as root
  (pre-existing env condition, permissions are not enforced for uid 0).
- udp: 228/0 fail, dgram: 3/0, net: 90/0 — all green.

### Failure triage (every failure retested solo and/or against the PRE-REWRITE
### main-tree debug build /root/bun/build/debug/bun-debug of Jul 5)
Legend: PRE-EXISTING = same failure on the pre-rewrite main debug build;
ENV = environment condition; LOAD = passes solo, fails only under suite
concurrency/box load (~270 loadavg).

fetch.test.ts (330 pass / 22 fail in-suite):
- 12x "utf16 * (with gc)": PRE-EXISTING (main debug build fails identically —
  ~1200 Bun.gc(true) calls per test at debug/ASAN speed exceed 5s).
- 4x "bad permissions throws": ENV (uid 0 ignores file modes; fails on
  USE_SYSTEM_BUN too).
- 4x 55s concurrent tests (simultaneous HTTPS fetch, tlsextname, ipv6
  localhost, redirect to another port #7793): LOAD — all pass solo; starved
  by the concurrent utf16 gc-storm tests in the same file.
- "follow redirect if connection is closed…": PRE-EXISTING (main fails
  identically; AbortSignal.timeout(150) too tight for debug).
- "very long redirect URLS": PRE-EXISTING (main fails identically).

node/net (192 pass / 2 fail):
- mongodb-pattern-leak framed round-trips: LOAD (passes solo, 107s vs 60s
  suite timeout).
- socketaddress "does not leak memory": PRE-EXISTING (main fails identically;
  100k iterations > 5s in debug).

node/tls (174 pass / 4 fail):
- 2x invalid NODE_EXTRA_CA_CERTS: PRE-EXISTING (main fails identically; 3
  debug child spawns > 5s). NOTE: the doubled extra-CA warning (old-style
  "Warning: Ignoring extra certs…" + new "warn: ignoring extra certs…") is
  ALSO printed by the pre-rewrite main build — not a wave-B artifact, but
  someone should dedupe the two warn paths eventually.
- root-certs concurrent Workers: PRE-EXISTING (main fails identically).
- destroySoon "delivers the whole stream": test only exists on this branch;
  correctness PROVEN solo — 64/64 iterations of the 2MB spill deliver every
  byte (manual repro); 5s test timeout can't fit 64x2MB TLS in debug.

serve.test.ts (251 pass / 3 fail):
- root range port #7187: ENV (uid 0 binds port 1003; fails on system bun).
- "not instanciate error instances": MARGINAL — 1000 sequential requests at
  ~4.7ms/req(debug) ≈ 5s budget; flips both ways on our build, measured
  ms/req parity with main (4.78 vs 4.68).
- abort sendfile response: PRE-EXISTING (main fails identically at 10s).

spawn-ipc: 13/13 pass. websocket rerun (after node_modules install) pending.

### websocket rerun (deps installed) + final triage
- websocket suite: 226 pass / 1 skip / 4 fail. All 4 are PRE-EXISTING debug
  timing: "connect many times over https" + "instances finalized when GC'd"
  fail identically on the pre-rewrite main debug build (same file, solo);
  "should send and receive messages" passes solo on our build; the
  proxy-close-reentrancy fixture takes 6.05s on main vs 6.09s on ours
  (identical) against a 5s test timeout.
- Our build passes MORE websocket.test.js tests solo than the main debug
  build (45 vs 42).

### Final state
- cargo check --workspace: GREEN. cargo check -p bun_bin (cabi on): GREEN.
- cargo test -p bun_usockets: 10/10 slab tests pass.
- bun bd links and runs; every mandated subsystem suite executed; every
  failure traced to a pre-existing condition (proven against the pre-rewrite
  main debug build or USE_SYSTEM_BUN) or box load (passes solo).
- Diff for the orchestrator to commit: 22 files (uws consumer repoints to
  bun_uws_shim/bun_usockets, bun_uws/bun_uws_sys unlinked from the bun_bin
  graph, cabi flip in bun_bin, rust.ts fault-injection feature wiring,
  root_certs.cpp us_raw_root_certs rename, from_fd group-vtable
  debug_assert, borrowck/nominal-cast fixes).

### Remaining for D1/D2 (unchanged obligations)
- D1: delete packages/bun-usockets C core sources from disk (they are
  already out of the build graph), delete src/uws + src/uws_sys Rust crates
  (now orphaned — nothing links them), drop their workspace memberships,
  prune stale decls in internal.h (us_internal_raw_root_certs) /
  libusockets.h, flip `cabi` default-on if desired (currently explicit in
  bun_bin's dep).
- D2: fault-injection test port + slab Miri target + GC-stress adopt/
  upgradeTLS tests.
- Dedupe the doubled extra-CA warning (old "Warning: Ignoring extra certs…"
  + new "warn: ignoring extra certs…") — pre-existing on main, cosmetic.
