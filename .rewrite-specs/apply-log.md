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

## 2026-07-12 — Wave C applier (post-D1/D2)

### Build & unit tests
- `bun bd --version` → 1.4.0-debug, exit 0. The C-core deletion needed ZERO
  build-script fixes: grep of scripts/ + CMake for every deleted filename came
  back clean (glob-sources was already narrowed to root_certs*.cpp + quic.c in
  W18; flags.ts include dirs still valid — libusockets.h/quic.h survive).
- Cargo.lock: already regenerated by the first cargo invocation — no
  bun_uws/bun_uws_sys entries remain (only bun_uws_shim).
- `cargo test -p bun_usockets`: 10/10 slab tests green.
- Smoke: Bun.serve+fetch roundtrip OK on the fresh binary.

### D2 test fixes (2 files edited by me this wave)
1. socket-syscall-fault.test.ts: D2's "recv → ECONNRESET surfaces via
   error() then close()" asserted a contract Bun never had. Empirically (real
   peer RST via resetAndDestroy on BOTH pre-rewrite and new builds): Bun-native
   sockets deliver read errors as the close(socket, error) ARGUMENT; error()
   does not fire. Rewrote the test to assert err.code === "ECONNRESET" via the
   close argument — semantics preserved, contract corrected. Suite now 5/5.
2. node-http-syscall-fault.test.ts (branch-only, earlier wave): 2 of the 4
   subprocess tests exceed the 5s default in debug (child debug-bun startup is
   multi-second). Added explicit 60s timeouts to all 4 same-shape subprocess
   tests + a comment. Now 4/4 (verified functionally green at 60s before
   adding: all 4 pass, so the 5s failures were pure timing).

### Suite results (new debug build, box loadavg ~268 throughout)
- bun/net socket.test.ts: 65 pass/2 skip/0 fail — includes D2's 2048-cycle
  GC+upgradeTLS stress (green, in-suite).
- bun/net rest (tcp-server, retention, dns-error, named-pipe, unix-unlink):
  25/1/0. udp+dgram: 228/0. spawn-ipc: 16/0.
- happy-eyeballs stale-timer + D2 cancel-loop: 2 pass/1 skip (macOS-only)/0.
- node/net: 194/6/1 — only fail = socketaddress "does not leak memory",
  wave-B-triaged PRE-EXISTING (fails identically on pre-rewrite main debug).
- node/tls: 4 fail — the EXACT wave-B set (2x NODE_EXTRA_CA_CERTS,
  root-certs Workers, destroySoon) — all previously proven pre-existing.
- web/websocket: 226/1/4 — the EXACT wave-B set (proxy-TLS-close fixture,
  connect-many-https, send/receive [passes solo], GC-finalize).
- fetch.test.ts: 330/22 — the EXACT wave-B set (12 utf16-gc PRE-EXISTING,
  4 bad-permissions ENV uid0, 4 LOAD [pass solo per wave B], 2 PRE-EXISTING).
- serve.test.ts: 251/1/3 — the EXACT wave-B set (root-range-port ENV,
  not-instanciate-error MARGINAL, abort-sendfile PRE-EXISTING).
- node/http (24 files, NEW for wave C): 217 pass/11 fail in-suite; all 11 are
  5s-timeout shapes. Triage:
  * node-http-syscall-fault 2 → FIXED (timeouts above), now 4/4.
  * nested-cork 4, proxy-url 1, connect 1 → pass 0-fail solo at 60s on new
    build; the pre-rewrite binary fails MORE of each file (nested-cork 5,
    proxy-url 2, uaf 6/6, connect 4) → PRE-EXISTING debug timing.
  * uaf "should not crash on abort (fixture 1)" → fixture exits 0 but takes
    131.7s/iteration x2 iterations SOLO — measured 131.6s on the pre-rewrite
    binary (identical to the second). PRE-EXISTING-infeasible in debug at any
    sane timeout; not touched (file exists on main).
- bun/websocket server suite (127 tests): 121/3 in-suite. publish x2 pass
  31/31 solo; "(benchmark)" = 300k round-trip echoes vs 30s budget — measured
  via standalone replica: NEW 33.4s vs OLD 35.4s on this loaded box. New build
  slightly FASTER; failure is LOAD, not regression.

### USE_SYSTEM_BUN verification (step 4)
- socket-syscall-fault + node-http-syscall-fault + socket.test.ts: all FAIL
  under system bun (socketFaultInjection / bun:internal-for-testing import
  errors) — cannot vacuously pass. Valid.
- websocket-server publish tests: 11 fail on the pre-rewrite binary, 31/31 on
  new — strong new-crate behavioral coverage.
- cancel-loop + GC-stress: regression guards; the cancel-loop passes on system
  bun (fixture targets a timer-lifetime class, acceptable per wave brief);
  GC-stress can't run on system bun (file-level internal-for-testing import).

### Sweep (step 5)
- `grep -r 'bun_uws\b' src/` → only bun_uws_shim + prose comments.
- `grep -r uws_sys src/ scripts/` → prose comments + the two INTENTIONAL
  build refs (glob-sources.ts:104 src/uws_sys/*.cpp, flags.ts:1530 include
  dir) for the surviving C++ shim TUs. Cargo.toml/lock clean.

### LOC
- Wave-C uncommitted delta: 71 files, +446 / −20,893 (D1 C-core+crates
  −20,808; D2+fixes tests +~250).

### No semantics conflicts
- The one candidate (recv-error → error() vs close(err)) was resolved
  empirically against the pre-rewrite build: close(err) is the frozen
  behavior; the TEST was wrong, the runtime matches C semantics. No runtime
  code changed this wave.

### Notes for the orchestrator
- Everything mandated is green or triaged to wave-B-proven pre-existing/env/
  load causes. No new suppressions, no skipped tests, no weakened assertions.
- Possible follow-ups (unchanged from D1 flags): relocate the 3 surviving C++
  files out of src/uws_sys/; dedupe doubled extra-CA warning (pre-existing).

## 2026-07-12 — Phase D wave D1 applier (core shards P0/P0b/P0c/P0d integration)

### Compile fixes (applier edits on top of the shard diffs)
1. handle.rs: added `+ 'static` to all 7 `O: RefCounted<DestructorCtx: Default>`
   generic bounds — `Protocol::Owner` is `'static` and
   `dispatch::owner_registered_as::<O>` requires it (E0310 x6).
2. unsafe_core/test_support.rs: two new link stubs for the crate-local test
   binary — `SSL_free` (unreachable!, tests never create TLS) and
   `__bun_crash_handler_out_of_memory` (abort) — per P0c's "add stubs rather
   than weakening tests" instruction. cfg(test)-only module, no product impact.
3. unsafe_core/poll_access.rs: `make_kev_ex` re-export narrowed to
   cfg(macos) — it is only used by the darwin PollSource arms, so the
   freebsd target failed with deny(unused_imports).
4. spawn/process.rs + spawn/Cargo.toml: `WindowsLoop::run/tick` became
   associated functions (P0 loop rework); rewrote the two windows-only
   method-syntax call sites to `bun_usockets::Loop::run/tick(ptr)` (the
   canonical style used by jsc/event_loop.rs) and added a
   `[target.'cfg(windows)'.dependencies] bun_usockets` dep.
   NOTE: BUN_CODEGEN_DIR must be THIS WORKTREE's build/debug/codegen — the
   main-repo copy is stale for this branch (JSBundler stream slot).

### Flag resolutions
- P0b PARTIAL (family-max registration): DONE at the C++ layer.
  HttpContext.h gains `maxExtSize()` = max(sizeof(HttpResponseData<SSL>),
  sizeof(WebSocketData)+sizeof(void*)), used by both listen sites;
  HttpResponse.h upgrade() static_asserts `sizeof(UserData) <= sizeof(void*)`
  so a future larger instantiation fails at compile time instead of at the
  Rust adopt assert. WS suites pass — the release adopt assert never fires.
- P0b/P0d stale comments: "trailing-area" -> "inline-area" (handle.rs,
  trampolines.rs, group.rs); tls/context.rs FatalReason docs updated from
  "PER-SOCKET (api.md CHANGES 2)" to the P0d loop-shared+SocketRef design;
  ffi.rs loop-scratch section header now cites P0d. socket_body.rs ALPN
  comment was already correct (P0d shard fixed it) — verified, no edit.
- P0d new unsafe surface desk-checked: tls_shared_ptr/with_shared borrows are
  scoped, bio_write_cb's `&mut *c.shared` is a distinct allocation from the
  BioCtl and its borrow ends (NLL) before raw_write.
- Deviations left for owner sign-off (unchanged from shard reports):
  P0b Windows MEM_RESET instead of MEM_DECOMMIT (decommit would AV the
  single-slot-deref validation path); P0 `on_fd` takes bun_core::Fd not
  OwnedFd; Rc owners unsupported (intrusive RefCounted only); P0c
  poll_registry not re-exported at crate root (P10's call).

### Verification
- cargo check -p bun_usockets: default / --no-default-features /
  --all-features all green.
- cargo test -p bun_usockets: 22/22 (10 prior slab + 8 new P0b
  decommit/epoch/hysteresis/teardown + 4 new P0c poll_registry).
- cargo check --workspace: green. rust:check-all: 10/10 targets green
  (was 7/10: freebsd unused-import, 2x windows bun_spawn — fixed above).
- bun bd: builds clean (1.4.0-debug), including the HttpContext.h/
  HttpResponse.h C++ edits.
- Smoke (box loadavg ~260 throughout):
  * bun/net socket.test.ts 65/2skip/0 (incl. 2048-cycle GC+upgradeTLS stress)
  * websocket-server.test.ts 104/3todo/1 — only "(benchmark)" (documented
    wave-B/C LOAD failure: 300k echoes vs 30s budget on the fuzz-soaked box)
  * websocket upgrade-reentrant 3/0, upgrade-signal-gc 1/0
  * node-tls-server.test.ts (SNI gate) 40/1 — only destroySoon, in the
    wave-B proven-pre-existing set
  * serve.test.ts 251/1skip/1todo/3 — the EXACT wave-B set (root-range-port
    ENV, not-instanciate-error MARGINAL, abort-sendfile PRE-EXISTING)
  * happy-eyeballs stale-timer 2/1skip/0, socket-retention 4/0
- No new suppressions, no skipped/weakened tests. No git commit (applier rule).

## 2026-07-12 — P10 fix pass (review blockers + minors)

### Code fixes
- Interest-change kernel failures now propagate: backend `registry_change`
  (epoll + kqueue) returns the raw rc, `PollRef::change` returns
  `Result<(), i32>` (stale/non-Fd/empty stay Ok no-ops), and the FilePoll
  already-armed rearm path in `arm()` surfaces the errno to callers
  (old EPOLL_CTL_MOD parity — e.g. ENOENT/EBADF after fd close no longer
  reads as success and hangs the reader). New unit test
  `change_surfaces_kernel_errno`. epoll `poll_change` returns its rc;
  socket-path callers ignore it as before.
- RegistryShim backpointer moved to exposed provenance
  (`Cell<usize>` + `expose_provenance`/`with_exposed_provenance_mut`):
  the previous `Cell<*mut FilePoll>` captured a transient `&mut` tag that
  every later owner-side borrow invalidated under Stacked/Tree Borrows.
- `prepare_registry_event`: error/EOF-only deliveries (Linux PSI EPOLLERR
  without EPOLLPRI) no longer set the single-purpose kind flag
  (Process/Machport/MemoryPressure) — old `from_epoll_event` parity; they
  surface via the Eof/Hup mapping only. kqueue deliveries are unaffected
  (believed-READABLE keeps `readable=true` there).

### P10 acceptance scope — EXPLICIT exclusion pending owner adjudication
The "grep proves no epoll_ctl/kevent outside bun_usockets backend/"
criterion is met for the EVENT-LOOP path only. Surviving raw kernel-queue
sites, all PRIVATE per-thread queues that the loop-local P0c registry
cannot host without cross-thread support:
- src/io/lib.rs IoRequestLoop watcher thread (epoll_ctl/kevent + its own
  Pollable/PollableTag udata convention + darwin kevent64 ext[0] generation)
- src/io/lib.rs KEventWaker kq + src/io/io_darwin.cpp kevent64 (BundleThread
  machport waker)
- outside io/: src/watcher/*, path_watcher.rs (FreeBSD), spawn/process.rs
  spawn-sync reaper
Owner must either amend the acceptance wording to the event-loop path or
schedule a follow-up shard for IoRequestLoop (which duplicates the
tagged-udata pattern P10 deletes elsewhere).

## 2026-07-12 — P10 fix pass 2 (aliasing + rollback blockers)

### Code fixes
- L1 aliasing (posix_event_loop.rs): FilePoll paths no longer foreign-mutate
  the Loop while a caller-held `&mut Loop` is protected. `PollRef` gained
  `change_on(&mut Loop, ..)`/`unregister_on(&mut Loop)` (shared `_via`
  internals; `debug_assert` the borrow matches the slot's stored loop);
  `FilePoll::drop_registration_on(&mut Loop)` routes `unregister_with_fd_impl`
  (now takes the loop), `deinit_possibly_defer`'s belt-and-braces line, and
  `arm()`'s already-armed rearm through the caller borrow. The one-shot
  disarm in `prepare_registry_event` keeps the raw-`loop_` path (dispatch
  holds no protected `&mut Loop`).
- Interest-change rollback (epoll.rs/kqueue.rs registry paths): slot polling
  bits now commit only after the kernel accepts the change, so a failed
  change stays retryable instead of short-circuiting on the equality
  fast-path. kqueue `registry_fd_delta` returns `(rc, achieved)` and
  `registry_arm(Fd)`/`registry_change` commit only the achieved interest
  (partial per-filter failures no longer desync slot vs kernel). Socket-path
  `poll_change` (both backends) deliberately keeps the verbatim-C
  write-before-syscall order: all socket callers ignore the rc, and the C
  parity quirk set is load-bearing there. `change_surfaces_kernel_errno`
  extended: the identical retry must fail again (fails on pre-fix code).
- arm() rearm-failure (adjudicated per review suggestion): on `change_on`
  failure the registration is fully dropped and the Poll* interest flags
  cleared, so kernel state, registry slot, loop counts (caller deactivates)
  and flags all agree with the reported failure — no live registration on a
  loop that thinks it can idle.

### Left as-is (flagged)
- Machport port recovery `u32::try_from(fd.native()).expect("int cast")`
  panics for port names >= 2^31 — exact parity with the old code; deleting
  the latent panic needs a u32-port FilePoll entry point + dns.rs caller
  change (out of this fix pass's blast radius, darwin-only, untestable here).
- CI must exercise darwin/freebsd arms before landing: kqueue
  Proc/Machport/Memorystatus registry arms, one-shot EV_DELETE emulation,
  dispatch_registered_kevent payload threading, FreeBSD Proc widening —
  spawn (SIGCHLD reaping), macOS DNS (machport), memoryPressure suites.

### ORCHESTRATOR NOTE for D2 applier (owner-flagged)
group.rs `on_create: Option<Box<dyn FnMut(AnySocket)>>` is the only dyn in the
crate — replace with static shape: `Option<(fn(*mut c_void, AnySocket), *mut c_void)>`
(or monomorphized via the owner registry). No Box, no dyn; accept path must be
allocation-free. Verify with: grep -rn 'dyn ' src/usockets returns zero code hits.

### ORCHESTRATOR NOTE for D2 applier (owner directive: no OnceLock)
KIND_TABLES / OWNER_OPS OnceLock arrays are rejected — everything static:
build ONE `static` table, fully const-initialized, in the crate where all
handler/owner types are visible (the runtime-side dispatch module, same place
the pre-rewrite static tables lived), entries = (&'static VTable, OwnerOps)
per kind, Invalid = None (trap). Core reaches it through the existing
no_mangle dispatch-fn seam (as the C loop did) or an equivalent single
link-time boundary — NO lazy init, NO runtime register_kind/register_owner
calls (delete them). TypeId sanity checks: compile-time if const-usable,
else debug_assert on first dispatch only, else drop (the const table makes
mis-registration structurally impossible). Acceptance: grep OnceLock|LazyLock
in src/usockets + the dispatch module = zero hits; kind coverage is enforced
by the const array shape (missing kind = compile error).

### ORCHESTRATOR NOTE for D2 applier (extends the no-OnceLock directive)
Owner directive: ZERO OnceLock/LazyLock/OnceCell across src/usockets AND
src/uws_shim, not just dispatch. Current hits: dispatch.rs (const-table
directive above), unsafe_core/ffi.rs x3, unsafe_core/bssl.rs x3. Replacements
by kind:
- feature probes / latches (epoll_pwait2 etc.): plain Atomic{I8,U32} latch,
  exactly the C's `has_epoll_pwait2` shape.
- process-global cross-thread init (shared default CA store, default
  ciphers): match the C mechanism from the deleted openssl.c (read git
  history if needed) — explicit init at a deterministic site (first ssl-ctx
  creation under its existing lock, or process init) into an AtomicPtr;
  no std lazy wrappers.
- anything loop-local: plain field initialized at loop creation (no
  synchronization needed at all).
Acceptance: grep -rn 'OnceLock\|LazyLock\|OnceCell\|lazy_static' src/usockets
src/uws_shim = zero hits.

## 2026-07-12 — Phase D wave D2 applier (consumer shards P1-P8 + P10 integration)

### Compile fixes (integration errors, fixed by applier)
- src/jsc/virtual_machine_exports.rs:68 — `(**inst).data.is_connected()`
  stale after P7 moved `is_connected` onto `SendQueue`; now
  `.data.queue().is_connected()` (matches subprocess.rs / ipc_host.rs).
- src/usockets/unsafe_core/poll_access.rs — `make_kev_ex` re-export was
  `cfg(macos)` while kqueue.rs's Proc(NOTE_EXIT) arm is
  `cfg(any(macos, freebsd))` (P10 FreeBSD Proc widening); widened the
  re-export. rust:check-all was 9/10 (freebsd) before, 10/10 after.
- src/runtime/valkey_jsc/js_valkey.rs — P3-flagged sweep item applied:
  JSValkeyClient::owner_ref now calls the sanctioned safe
  `uws::owner_ref_of(self)`; last hand-written `RefPtr::init_ref` in any
  migrated consumer is gone (postgres/mysql already used the helper).
- Pre-existing main-tree test-target drift (exposed by the first-ever
  `cargo check --workspace --all-targets` run, NOT Phase-D code):
  src/router/lib.rs cfg(test) harness (missing `Output` alias, unbound `fs`,
  `&mut Writer` vs `*mut Writer` in Log::print; harness allowed-dead until
  the Zig route tests are ported), src/jsc/lib.rs `__macro_smoke`
  (allow(dead_code) — type-check-only scaffold),
  src/runtime/test_runner/diff/diff_match_patch.rs tests (`.eql`→`==`,
  `Dmp::new/DEFAULT`→struct literal/default, deleted unused `rebuildtexts`).
- NOTE: BUN_CODEGEN_DIR must be THIS worktree's build/debug/codegen; the
  main-repo copy lacks js_TLSSocket/js_TCPSocket/js_Listener
  `handlers_set_cached` + js_BuildArtifact `stream_*_cached` and fails the
  build with misleading E0425s.

### Verification
- cargo check --workspace: GREEN; --all-targets: GREEN (first time ever).
- bun run rust:check-all: 10/10 targets GREEN (after the freebsd fix).
- cargo test -p bun_usockets: 24/24 (incl. P10's extended
  change_surfaces_kernel_errno retry assertion).
- bun bd: builds + runs (1.4.0-debug).

### Suite results (box loadavg ~250 throughout; every failure retested solo
### and/or against the pre-rewrite main debug build of Jul 5)
- bun/net (whole dir, incl. socket.test.ts 2048-cycle GC+upgradeTLS stress,
  socket-syscall-fault, tcp-server, retention, dns-error): 95/3skip/0.
- bun/udp + node/dgram: 228/0 + 3/0.
- bun/websocket server suite: 123/3todo/1 — only "(benchmark)" (documented
  wave-B/C LOAD).
- web/websocket: 224/1/6 — 4 = EXACT wave-B/C set; 2 NEW-to-suite
  ("websocket in subprocess" pair) pass 6/0 solo → LOAD.
- fetch.test.ts: 330/22 — EXACT wave-B/C set. serve.test.ts: 251/3 — EXACT
  wave-B/C set. spawn-ipc: 16/0.
- node/net: 192/6/3 — 2 = wave-B set; net-syscall-fault short-write NEW in
  suite, 18/18 solo → LOAD. node/tls: 174/4 — EXACT wave-B set.
- node/http: 219/9 — same wave-C 5s-timeout shapes (nested-cork solo 10/0 at
  60s re-proven; uaf fixtures wave-C-proven infeasible-in-debug).
- valkey: unit 60/0; main+gc+scan 910/2skip/2 — both "high volume pub/sub"
  5s timeouts, fail IDENTICALLY on the pre-rewrite main debug build
  (5050ms shape) → PRE-EXISTING.
- sql (local/no-server set + local-sql docker): 62/1 — "should not segfault
  under pressure #21351" 30s timeout; manual out-of-harness repro (child
  survives 20 docker restarts + fetch bombardment, exits clean) PASSES on
  the new build; the harness test fails IDENTICALLY on the pre-rewrite
  binary (kill-after-timeout sets failed→"Server crashed") → PRE-EXISTING
  (30s budget vs 20 docker restarts on a loaded box).
- spawn (whole dir, 42 files — SIGCHLD/reaping gate for P10): 323/7skip/11
  in-suite (files run concurrently). Solo: spawn-env 1/0, spawn-signal 4/0,
  stdin-pipe-fd-leak 2/0 → LOAD. spawn-maxbuf kill-latency (<100ms asserts)
  and readable-stream-edge-cases 5s timeout and all 3 spawn-pipe-leak 30s
  RSS tests fail IDENTICALLY on the pre-rewrite binary (its RSS delta is
  WORSE: 240MB vs our 121-159MB) → PRE-EXISTING. issue #9404 cpuTime<750ms
  assert at loadavg 250 → ENV.
- process-memory-pressure (P10 PSI path): 5/0.
- NO new regressions: every failure is wave-B/C-triaged, passes solo, or
  fails identically on the pre-rewrite build.

### P9 sweep — unsafe keyword sites (unsafe {/fn/impl/extern, comment lines
### excluded), pre-Phase-D (HEAD~1) -> post
| consumer | before | after |
|---|---|---|
| runtime/valkey_jsc | 44 | 35 |
| sql_jsc (pg+mysql+shared) | 102 | 104 |
| http_jsc/websocket_client | 210 | 111 |
| http (client) | 192 | 193 |
| runtime/socket | 295 | 263 |
| jsc/ipc.rs | 48 | 52 |
| io/ | 292 | 271 |
| runtime/cli/test/parallel | 90 | 79 |
Socket-LIFECYCLE unsafe (ext derefs, ref bracketing, ThisPtr dispatch,
manual close compensation) is ZERO in all migrated consumers —
uws_handlers.rs is 0 unsafe total. The flat/slightly-up counts (sql_jsc,
http, ipc.rs) are the documented audited residues the shards ADDED under
narrower contracts: `queue_mut` JsCell projections (P7, replacing safe
with_mut misuse), intrusive-refcount helpers gained by the RefCounted
migrations (P2/P3), and the AsyncHTTP bitwise-clone cluster (P5, declared
out of scope). Irreducibles per consumer are enumerated in the shard
reports: JSC/FFI (boringssl SSL*, JsCell, heap teardown, MarkedArgumentBuffer),
refcount internals, Windows/libuv paths (spec §14), HiveArray/h2 pool
internals, and the private per-thread kernel queues below.

### Acceptance greps
- `RawPtrHandler`: gone (one prose comment in uws_handlers.rs).
- `ThisPtr` outside core: only the documented residues — NewSocket
  JS-wrapper paths in socket_body.rs/Listener.rs (P6 justified list),
  WindowsNamedPipeContext (out of scope §14), MySQL query-queue projection
  (non-socket), WTFTimer (non-socket bun_ptr use).
- `epoll_ctl(/kevent(` outside src/usockets/backend/: exactly the
  P10-documented exclusion set (io/lib.rs IoRequestLoop + KEventWaker,
  io_darwin.cpp, watcher/*, path_watcher.rs, spawn/process.rs spawn-sync
  reaper, jsc NoOrphansTracker.cpp) plus the bun_sys syscall-wrapper layer
  and bun_usockets' own unsafe_core/poll_access.rs + loop_/wakeup.rs
  (crate-internal raw edges, present since P0c). Owner adjudication of the
  literal wording still pending (logged in the P10 section above).

### LOC delta (HEAD~1 -> working tree, whole Phase D)
76 files, +6938 / -5103 (net +1835; consumer dirs alone are
-846: +2475/-3321; io/ is -671: +316/-987).

### Left for owner
- P10 acceptance-wording adjudication (above) + darwin/freebsd CI gate
  (kqueue Proc/Machport/Memorystatus arms, machport DNS, EV_DELETE
  emulation) — cannot run on this box.
- P1 behavior delta: close-during-connect no longer rejects the pending
  valkey connect promise at that instant (C parity); valkey suites green,
  no test asserts the old behavior.
- Cross-shard suggestion (P1/P2/P3): all consumers now use owner_ref_of;
  the per-consumer `owner_ref()` one-liners could fold away entirely if
  attach sites call `uws::owner_ref_of` directly (cosmetic).

### ORCHESTRATOR ADJUDICATIONS (D2 "FOR OWNER" items)
(a) P10 acceptance wording: ACCEPTED as satisfied. The remaining epoll/kevent
sites outside backend/ are separate per-thread kernel queues by design
(IoRequestLoop, KEventWaker, io_darwin, watcher/path_watcher, spawn process
tracker, NoOrphansTracker) + the bun_sys wrapper layer — the directive's
target was the MAIN loop's poll universe, which is unified. darwin/freebsd
arms gate on CI (kqueue Proc/Machport/Memorystatus, machport DNS).
(b) P1 valkey close-during-connect promise delta: ACCEPTED (C parity; suites
green; nothing asserts the old behavior).

## 2026-07-12 — no-OnceLock + lone-dyn directives executed (post-D2 cleanup)

### Const kind table (dispatch.rs directive)
- KIND_TABLES / OWNER_OPS / TLS_SIDE_CHANNEL OnceLocks DELETED, along with
  every runtime registration fn: dispatch::{register_kind, register_kind_raw,
  register_owner_ops, register_tls_side_channel}, protocol::register,
  uws_dispatch::ensure_registered, bun_http::http_context::register_protocol,
  bun_http_jsc::register_ws_client_protocols, bun_jsc::ipc::register_protocol,
  and the postgres/mysql/Channel lazy self-register lines (+ all 9 callers).
- ONE fully const table lives in src/runtime/socket/uws_dispatch.rs (the crate
  that sees every protocol type): 17 `const E_*: KindEntry` rows built by the
  new `pub const fn uws::kind_entry::<P>(kind)` (protocol.rs), assembled into
  `const KIND_TABLE: KindTable` (explicit 24-slot array literal) and exported
  as `#[unsafe(no_mangle)] static BUN_UWS_KIND_TABLE`. TLS side-channel hooks
  are the sibling `#[unsafe(no_mangle)] static BUN_UWS_TLS_SIDE_CHANNEL`.
- Cross-crate boundary: bun_usockets declares both as
  `unsafe extern "Rust" { safe static ... }` in unsafe_core/trampolines.rs
  (the crate-root #![deny(unsafe_code)] forbids extern blocks elsewhere) —
  a single link-time seam, no init code. `cargo test -p bun_usockets` links
  via `#[cfg(test)]` empty-table fallbacks in the same file (crate unit tests
  never create table-dispatched sockets); bun_uws_shim's test target links
  without any fallback (its objects don't pull dispatch).
- Compile-time enforcement: array shape (SOCKET_KIND_COUNT growth = length
  mismatch), `kind_entry` const-asserts kind ∈ {P::KIND, P::KIND_TLS} (row
  built for the wrong protocol = const-eval error), and the new
  `uws::validate_kind_table` runs in a `const _: () = ...` (row at the wrong
  index / entry on Invalid/Dynamic/Uws* = const-eval error; KindEntry gained
  a crate-private `kind` field for this).
- TypeId checks: kept as runtime data, no lazy init — KindEntry stores
  `fn() -> TypeId` monomorphized pointers (const TypeId::of is not stable);
  owner_registered_as/kind_dispatches_to read the const table directly. The
  fail-closed attach semantics are unchanged.
- Semantics deltas (all strictly tighter): dispatch on a kind with no table
  entry now panics unconditionally (before: only if nobody had registered
  yet); tls_hooks() can no longer be "unregistered"; conflicting-registration
  panics are replaced by structural impossibility.

### TestChannel de-generic (prereq for one table row per kind)
- ChannelProtocol<Owner> had one instantiation per ChannelOwner — impossible
  as a single const row. ChannelState is now NON-generic: the owner backref
  is `Cell<*mut ()>` + `Cell<Option<&'static OwnerHooks>>` (two monomorphized
  fn pointers, `frame_thunk::<Owner>`/`done_thunk::<Owner>`, stamped at
  adopt/adopt_pipe next to the backref, cleared in Channel::drop before the
  owner can be mid-drop). ChannelProtocol is a plain unit struct.

### bssl.rs EX_INDICES (matches deleted openssl.c:181-393 pthread_once shape)
- OnceLock<ExIndices> → `static EX_ONCE: std::sync::Once` + an
  UnsafeCell<ExIndices> in a Sync wrapper: written exactly once inside
  call_once at first SSL_CTX/SSL touch (same site as C), &'static reads only
  after call_once (its synchronization = the C's pthread_once). Zero caller
  churn (ex_indices() signature unchanged, 27 call sites).

### ffi.rs BIO method (C stored it per-loop; ours is cross-loop by design)
- Two OnceLocks → `BIO_INIT: Once` + AtomicUsize/AtomicI32 latches (the
  has_epoll_pwait2 plain-latch shape, ordered by the Once). Kept process-
  global rather than the C's loop-local field because `ssl_wbio_ctl` compares
  BIO_method_type across SSLWrapper-vs-ours with no loop in hand, and the
  type index must be identical on the JS and HTTP-client loops.

### group.rs lone dyn (on_create)
- `Option<Box<dyn FnMut(AnySocket)>>` → `Option<(fn(*mut c_void, AnySocket),
  *mut c_void)>` (Copy). Accept path is allocation-free and the take/put-back
  ownership dance is gone (copy out, call). Single producer
  (runtime/socket/Listener.rs) now registers a named `accept_hook_body` fn
  with the Listener as ctx (same lifetime argument the BackRef relied on);
  single consumer (group.rs accept loop) unchanged otherwise.

### Verification
- cargo check -p bun_usockets / --workspace / --workspace --all-targets: GREEN.
- cargo test -p bun_usockets: 24/24. cargo test -p bun_uws_shim --no-run: links.
- bun bd: builds, boots (1.4.0-debug).
- bun/net/socket.test.ts: 65 pass/2 skip/0 fail (incl. 2048-cycle
  GC+upgradeTLS stress → tls side-channel seam exercised).
- serve.test.ts: 251/3 — the EXACT documented pre-existing set (root-range
  ENV, not-instanciate MARGINAL, abort-sendfile PRE-EXISTING).
- spawn.ipc + spawn-ipc-gc + bun-ipc-inherit: 13/13 (SpawnIpc row).
- bun test --parallel 2-file smoke: 3/3 (TestChannel row, erased hooks).
- websocket-client + websocket-upgrade tests: 30/30 (WsClient* rows).
- Manual: fetch http+https 200 (HttpClient/HttpClientTls rows + Once-based
  ex_indices/BIO init on the HTTP thread).
- Acceptance greps: `grep -rn 'OnceLock\|LazyLock\|OnceCell\|lazy_static'
  src/usockets src/uws_shim` = 0 hits; `grep -rn 'dyn ' src/usockets
  --include='*.rs'` = 0 hits.
- bun run rust:check-all: 10/10 targets GREEN (windows arm of the table +
  Channel.rs windows hooks type-checked).
