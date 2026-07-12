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
