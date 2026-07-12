# uSockets Rust-rewrite: consumer requirements inventory

Status: DRAFT — sections filled in as sub-inventories complete. This document freezes the
new native crate's API: every operation listed in §"Required API" must exist before the
one-PR migration lands.

Scope: everything in `src/` that talks to `bun_uws` (src/uws) or `bun_uws_sys` (src/uws_sys).
The uWS C++ App/Response shim (Bun.serve HTTP layer) is another agent's scope; only its raw
`us_*` touches are recorded here.

## 0. Shared architecture facts (grounded reads)

### 0.1 SocketKind — closed-world consumer enum [src/uws_sys/SocketKind.rs:1-66]

`SocketKind` is stamped on `us_socket_t` at creation (`s->kind`, full `unsigned char`) and is
the dispatch key. Variants (dense `#[repr(u8)]` 0..=22):

- `Invalid=0` (calloc'd zero; dispatch panics), `Dynamic=1` (per-group vtable: uWS C++, tests)
- `BunSocketTcp/Tls`, `BunListenerTcp/Tls` (listener-accepted socket: ext is `*Listener` until
  onCreate re-stamps to `BunSocket*` — kind is MUTABLE post-open)
- `HttpClient/Tls`, `WsClientUpgrade/Tls`, `WsClient/Tls` (kind re-stamped upgrade→framed)
- `Postgres/Tls`, `Mysql/Tls`, `Valkey/Tls`, `SpawnIpc`
- `UwsHttp/Tls`, `UwsWs/Tls` (C++ per-group vtable)

`is_tls()` is derived from kind, not from `s->ssl` [SocketKind.rs:104].

### 0.2 Dispatch — kind → static vtable [src/runtime/socket/uws_dispatch.rs]

`loop.c` calls `us_dispatch_{open,data,fd,writable,close,timeout,long_timeout,end,
connect_error,connecting_error,handshake}` exports [uws_dispatch.rs:150-173]. Rust switches on
kind into a **static per-kind `&'static VTable`** built via `vtable::make::<H>()`
(monomorphized `Trampolines<H>` — one table per kind in .rodata, not per connection)
[uws_dispatch.rs:38-74]. `Dynamic`/`Uws*` kinds read `group->vtable` (per-App C++ closure)
[uws_dispatch.rs:88-95]. Extra non-vtable dispatch entry points, all `BunSocketTls`-only:

- `us_dispatch_ssl_raw_tap(s,data,len)` — ciphertext tap for `socket.upgradeTLS()`'s
  `[raw,_]` pair half, gated by an `ssl_raw_tap` socket bit [uws_dispatch.rs:176-222]
- `us_dispatch_session(s,data,len)` — resumable TLS session ready (BoringSSL new-session cb
  parked, then flushed via `ssl_flush_pending_session()`) [uws_dispatch.rs:224-252]
- `us_dispatch_keylog(s,data,len)` — NSS keylog line [uws_dispatch.rs:254-279]

All dispatch callbacks return `*mut us_socket_t` (the possibly-replaced socket) — the C loop
continues on the returned pointer. **The new API must preserve "handler may return a different
socket" (adopt/re-stamp) semantics.**

### 0.3 SocketGroup registry & shutdown protocol [src/jsc/rare_data.rs]

RareData embeds 14 by-value lazily-init'd `SocketGroup`s [rare_data.rs:227-248]:
`spawn_ipc`, `test_parallel_ipc`, `bun_connect_{tcp,tls}`, `postgres{,_tls}`, `mysql{,_tls}`,
`valkey{,_tls}`, `ws_upgrade{,_tls}`, `ws_client{,_tls}` — accessors `*_group::<SSL>(vm)`
[rare_data.rs:773-841]. Listener and uWS-App groups own their own SocketGroup outside RareData.

Shutdown [rare_data.rs:843-878, quoted]:
- `close_all_socket_groups(vm)` "Must run BEFORE JSC teardown — closeAll fires on_close → JS
  callbacks → needs a live VM."
- Loops `vm.uws_loop_mut().close_all_groups()` up to 8 rounds because "a handler can call
  Bun.connect/postgres/etc. and re-populate a group we just drained"; walks "the loop's
  linked-group list rather than just our 14 embedded fields" (accepted sockets live in
  Listener/App-owned groups; iterating only embedded fields leaked one 88-byte us_socket_t per
  open accepted connection — LSAN cluster on #29932 build 49245).
- Then `vm.uws_loop_mut().drain_closed_sockets()`: "us_socket_close pushes to
  loop->data.closed_head; loop_post() normally frees it on the next tick. We're past the last
  tick, so drain it now."
- `RareData::deinit` runs later and calls `SocketGroup::destroy` on each init'd embedded group,
  asserting emptiness [rare_data.rs:1078-1093].
- Watch-mode: raw listen fds tracked separately, closed with `disable_linger` for instant
  rebind [rare_data.rs:741-760].

**New-crate consequences:** Loop must expose `close_all_groups() -> bool` (any-closed
indicator, walks ALL groups linked to the loop), `drain_closed_sockets()`, and groups must be
embeddable by-value, zero-init-safe, lazily initialized, destroyable with debug emptiness
asserts.

<!-- SECTIONS 1..12 FILLED FROM SUB-INVENTORIES -->
