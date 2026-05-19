# Section E: runtime-socket-udp-tcp

## Purpose

Section E is the JS-visible TCP/TLS/UDP socket layer that fronts uSockets
(`Bun.connect` / `Bun.listen`, `node:dgram`, `node:tls`, `socket.upgradeTLS()`,
and Windows-named-pipe parity). It comprises:

1. **mod.rs** — the `RawSocketEvents<SSL>` impl that bridges
   `api::NewSocket<SSL>` into the dispatcher; sits one frame above the
   bun_uws_sys vtable thunks.
2. **uws_handlers.rs** — the per-`SocketKind` adapter tier
   (`PtrHandler`, `RawPtrHandler`, `NsHandler`, `BunListener`, `HTTPClient`,
   `SpawnIPC`); turns ext-slot pointers into trait dispatch and is the
   *only* place re-entrancy mode (`*mut Self` vs `&mut Ext`) is encoded.
3. **uws_dispatch.rs** — the `kind → &'static VTable` static table plus
   `#[unsafe(no_mangle)] pub extern "C" fn us_dispatch_*` shims that
   `loop.c` calls; this is the single Rust ↔ C entry point for every
   socket event.
4. **socket_body.rs** — `NewSocket<SSL>` (TCP/TLS) struct + every JS
   host_fn body + the `select_alpn_callback` BoringSSL extern + the
   `DuplexUpgradeContext` self-referential allocation flow.
5. **Listener.rs** — `Bun.listen` listener wrapper, owns embedded
   `SocketGroup`, BoringSSL `SSL_CTX`, and the Handlers heap allocation.
6. **udp_socket.rs** — `node:dgram` JS class, `parse_addr`,
   `send_many` two-phase scatter-gather flow, multicast options.
7. **Handlers.rs** — the per-Listener (server) / per-Socket-set (client)
   Handlers struct, `mark_active`/`mark_inactive` lifecycle.
8. **SocketAddress.rs** — `node.net.SocketAddress` AF_INET/AF_INET6
   wrapper plus 3× `unsafe extern "C"` blocks for WTF static-string
   constants / DTO helpers.
9. **tls_socket_functions.rs** — TLS-only host functions plus the
   ~30-symbol BoringSSL `ffi::` shim block (most `safe fn`-annotated).
10. **UpgradedDuplex.rs** — TLS over arbitrary Node duplex streams;
    user-supplied `Handlers` fn-pointer table dispatched out of `SSLWrapper`.
11. **WindowsNamedPipe.rs** / **WindowsNamedPipeContext.rs** — libuv-backed
    Windows named-pipe transport that masquerades as a uws socket.
12. **SSLConfig.rs**, **uws_jsc.rs** — config conversion + a 1-symbol
    extern bridge.

This section reads from uSockets / BoringSSL / libuv but does NOT contain
the C-side wrappers themselves (Section Q owns `bun_uws_sys`,
`bun_boringssl_sys`, `bun_libuv_sys`, `bun_cares_sys`).

## Per-file unsafe-surface tally (vs prior subtotals)

| file                                | sites | prior | delta |
| ----------------------------------- | ----: | ----: | ----: |
| `socket_body.rs`                    |   116 |   112 |    +4 |
| `uws_handlers.rs`                   |    73 |    73 |     0 |
| `WindowsNamedPipe.rs`               |    54 |    53 |    +1 |
| `Listener.rs`                       |    53 |    53 |     0 |
| `WindowsNamedPipeContext.rs`        |    45 |    29 |   +16 |
| `tls_socket_functions.rs`           |    37 |    27 |   +10 |
| `udp_socket.rs`                     |    22 |    20 |    +2 |
| `mod.rs`                            |    16 |    16 |     0 |
| `UpgradedDuplex.rs`                 |    13 |    11 |    +2 |
| `SocketAddress.rs`                  |    11 |     8 |    +3 |
| `Handlers.rs`                       |    11 |     9 |    +2 |
| `SSLConfig.rs`                      |     8 |     6 |    +2 |
| `uws_dispatch.rs`                   |     7 |     4 |    +3 |
| `uws_jsc.rs`                        |     5 |     3 |    +2 |
| **Section E**                       | **471** |   **424** |   **+47** |

Normalised-site definition matches Phase-0 (unsafe blocks + `unsafe fn`
+ `unsafe impl` + `unsafe extern` + `unsafe trait` + `#[unsafe(...)]`).
SAFETY-comment density: **326 / 471 ≈ 69 %** (gap dominated by
`#[unsafe(no_mangle)]` attributes on the `us_dispatch_*` shims, the
4× `unsafe extern "C" { … }` block headers, and the per-trait-method
empty `unsafe fn` default bodies in `RawSocketEvents`).

## uSockets re-entrancy callback enumeration

Section E sits one frame above Section Q's vtable thunks. Every C → Rust
event flows through `uws_dispatch.rs`'s `us_dispatch_*` shims, which look
up an `Option<fn>` in the kind-keyed `TABLES` and tail-call. The actual
adapter then materialises an `&mut Ext` (the `PtrHandler` / `NsHandler`
family) or a `*mut Self` (the `RawPtrHandler` family) before invoking the
user handler. **The aliasing contract is encoded by which adapter the
kind is mapped to in `uws_dispatch.rs:43-79`**; that table is the
authoritative re-entry-mode source of truth for the section.

| dispatcher arm                      | adapter                    | borrow shape                | re-entry-safe? | site(s) |
|---|---|---|---|---|
| `BunSocketTcp` / `BunSocketTls`     | `RawPtrHandler<NewSocket<SSL>, SSL>` | `*mut Self`           | YES (load-bearing — JS `socket.write/end/reload` re-derive `&mut NewSocket` via `m_ptr`; `mod.rs:120-128` PORT NOTE explicitly states `PtrHandler` would alias re-entrant borrow → Stacked-Borrows UB + `noalias` dead-store) | `uws_handlers.rs:526`, `mod.rs:120-189` |
| `BunListenerTcp` / `BunListenerTls` | `BunListener<SSL>`         | `*mut us_socket_t` (ext stashed at `on_create`) | YES (ext owner extracted via `thunk::socket_ext_owner` returns `&mut NewSocket` but immediately demoted to `*mut` before the `on_*` body — `uws_handlers.rs:575-614` block-level SAFETY)    | `uws_handlers.rs:533-615` |
| `HttpClient` / `HttpClientTls`      | `HTTPClient<SSL>`          | `ActiveSocket` (tagged-pointer **value**, NOT a real ptr — encoded in the ext word) | DESIGN NOTE: cannot be dereferenced (`uws_handlers.rs:758-866` doc-comment); HTTP `Handler::on_*` decode via `ActiveSocket::from`; re-entry mode is Section Q's HTTP-client problem |
| `WsClientUpgrade` / `WsClientUpgradeTls` | `RawPtrHandler<NewHttpUpgradeClient<SSL>, SSL>` | `*mut Self` (delegates to Section Q `WebSocketUpgradeClient::handle_*`) | YES — Section Q model post-EXP-012 |
| `WsClient` / `WsClientTls`          | `RawPtrHandler<WebSocket<SSL>, SSL>` | `*mut Self` (delegates to Section Q `WebSocket::handle_*`) | YES |
| `Postgres` / `PostgresTls`          | `NsHandler<Owner, H, SSL>` | `&mut Owner` via `ExtSlot::owner_mut` | CONTRACT — handler must not re-enter while `&mut Owner` is live; postgres SocketHandler observed to keep callbacks short, but no mechanical enforcement |
| `Mysql` / `MysqlTls`                | `NsHandler<…>`             | `&mut Owner` | CONTRACT — same as Postgres |
| `Valkey` / `ValkeyTls`              | `NsHandler<…>`             | `&mut Owner` | CONTRACT — same as Postgres |
| `SpawnIpc`                          | `SpawnIPC` (`VHandler` impl)| `&mut SendQueue` via `ExtSlot::owner_mut` | CONTRACT — IPC `process.send` may re-enter JS; `ext.owner_mut()` borrows the SendQueue across `IpcH::on_data`. Audit candidate. |
| `BunSocketTls`'s `ssl_raw_tap`      | one-off `#[unsafe(no_mangle)] pub extern "C" fn us_dispatch_ssl_raw_tap` | `*mut TLSSocket` (twin sibling)  | YES — `on_data` taken on raw ptr, no `&mut` formed (uws_dispatch.rs:178-209) |

**Hot extern callback graph (entry points into Section E from C):**

- **uSockets event-loop side** (loop.c): 11 `us_dispatch_*` exports in
  `uws_dispatch.rs:138-172` + `us_dispatch_ssl_raw_tap` at `:178-209`.
- **UDP packet-loop side** (uws/udp): `on_close`/`on_recv_error`/`on_drain`/`on_data`
  at `udp_socket.rs:83/91/105/127`. **All four are bare `extern "C" fn` (not
  `unsafe extern`), and all four take a `*mut uws::udp::Socket` and run
  `let this: &UDPSocket = UDPSocket::from_uws(socket)` immediately.**
- **BoringSSL ALPN side**: `select_alpn_callback` at `socket_body.rs:188`
  — registered against the listener-level `SSL_CTX` (shared across
  every accepted connection per the comment at `:184-187`), reads `*mut
  TLSSocket` from per-`SSL` ex_data slot 0 rather than from the callback
  `arg`. Sound, with explicit reason ("`arg` would UAF when handshakes
  overlap").
- **MarkedArgumentBuffer trampoline**: `udp_socket.rs:1143` `extern "C" fn
  run(ctx: *mut Ctx<'_>, payload_roots: *mut MarkedArgumentBuffer)` —
  one-shot GC-root-scope shim for `sendMany`.
- **Windows libuv side**: `WindowsNamedPipe::on_read` (`:1468`) plus the
  fn-ptr-typed `NamedPipeHandlers` table at
  `WindowsNamedPipeContext.rs:295-317` — each handler is a non-capturing
  closure that takes `*mut c_void` ctx, casts to `*mut Self`, and forwards
  RAW (the per-field comment at `:291-294` explicitly cites the
  Stacked-Borrows constraint vs the caller's `&mut WindowsNamedPipe`).
- **UpgradedDuplex side**: `Handlers` fn-pointer table in
  `UpgradedDuplex.rs:60-71` + 8× `extern "C" fn` thunks at
  `socket_body.rs:3897-3922` for the duplex-upgrade flow.

## `unsafe impl Send/Sync` inventory

**Section E source files contain ZERO local `unsafe impl Send` / `unsafe impl Sync` rows.**
Verified via `grep -nE "unsafe impl" src/runtime/socket/*.rs` (no matches).
One cross-section caveat: `src/runtime/socket/SSLConfig.rs` re-exports the
canonical `bun_http::SSLConfig`, whose documented `unsafe impl Send/Sync` lives
in `src/http/ssl_config.rs:442-445`.

Why the local socket wrappers are sound by default:
`NewSocket<SSL>`, `Listener`, `UDPSocket`, `Handlers`, and
`WindowsNamedPipeContext` are **single-JS-thread-affine**. They carry
`Cell<T>` / `JsCell<T>` interior mutability and `*mut`/`Strong` JSC fields —
`Cell` is `!Sync` and `Strong` is `!Send + !Sync`, so auto-trait machinery
suppresses both `Send` and `Sync` automatically. Cross-thread work that *does*
happen in this section (DNS resolution for `Bun.connect`, `getaddrinfo` for
`udp.connect`) goes through `bun_dns` / `bun_cares_sys` in Section Q which DOES
carry the relevant `unsafe impl Send` rows; the result-handoff to the JS thread
always lands inside a Strong before any Section E socket wrapper sees it.

This is a **defensive default**: the auto-derive will fail to compile if
anyone adds a `Send`/`Sync` field, and there is no escape hatch. Section
E is the cleanest section in the audit on this axis.

## UDP `recvmmsg`/`sendmmsg` buffer contract

**Scatter-gather actually lives in `bun_uws_sys::udp` (Section Q).**
Section E only sees the result via `uws::udp::PacketBuffer` (an
`opaque_ffi!` ZST handle) and `uws::udp::Socket::send(&[ptr], &[len], &[addr])`.
There is no `iovec`/`msghdr` in Section E — the kernel-facing buffer
layout is encoded in the uSockets C wrapper.

What Section E *does* own is the lifetime contract for the payload
pointers it hands to `socket.send`. The hot spots:

1. **`udp_socket.rs:127-260` (`on_data` receive path)**: the kernel
   `recvmmsg` result lives in the `*mut uws::udp::PacketBuffer` argument.
   `unsafe { &mut *buf }` at `:145` materialises a `&mut PacketBuffer`
   that spans the whole callback; this is the only `&mut` over uws-owned
   memory in Section E. The SAFETY comment ("buf valid for the duration
   of this callback per uws contract") is **PRESENT_WEAK** — it cites
   the uws contract but does not name the re-entrancy rule (the user
   `on_data` JS callback at `:120` could in principle close the socket
   and re-enter the loop, but uws guards against the callback firing
   re-entrantly by design — confirm in Phase 2).
2. **`udp_socket.rs:1119-1335` (`send_many` two-phase scatter-gather)**:
   the long doc-comment at `:1119-1136` is the most thoughtful aliasing
   reasoning in Section E. It identifies the exact UAF: user JS during
   address parsing (`port.coerceToInt32()` / `address.toBunString()`)
   can detach an earlier ArrayBuffer via `.transfer(n)`, freeing its
   backing store synchronously and leaving `payloads[]` dangling before
   `socket.send` reads them. The fix: a `MarkedArgumentBuffer`
   GC-rooting trampoline (`extern "C" fn run` at `:1143`) splits work
   into a phase-1 (user-JS may run; root payloads in MAB) and phase-2
   (capture raw byte pointers — no more user-JS frames between capture
   and `socket.send`). The `payloads: Vec<*const u8>`,
   `lens: Vec<usize>`, `addr_ptrs: Vec<*const c_void>`, and
   `addrs: Vec<sockaddr_storage>` arrays are pre-allocated with
   **`vec![…; len]` zero-init NOT `Vec::with_capacity + set_len`** —
   the SAFETY comment at `:1210-1211` explicitly cites why ("`sockaddr_storage`
   is POD (`Zeroable + Copy`); zero-init so phase 1/2 can index safely
   (no `set_len` over uninit memory)"). **This is the best-in-section
   anti-EXP-005 pattern.**
3. **`udp_socket.rs:894-897, 1018-1026` (`set_multicast_interface`,
   `set_source_specific_membership`)**: zero-init `sockaddr_storage`
   via `bun_core::ffi::zeroed()` rather than `MaybeUninit`. SAFETY
   comments cite "Zig spec uses `undefined`; in Rust producing a
   `sockaddr_storage` value via `assume_init()` from a partially-init
   `MaybeUninit` is UB". **Explicit recognition of an EXP-005-shape
   hazard** — Section E is one of two sections in the audit that names
   this directly.

## TLS / non-TLS dispatch boundary

Section E's TLS path goes through three layers:

1. **`socket_body.rs:188-233` `select_alpn_callback`**: BoringSSL ALPN
   negotiation FFI shim. Reads `*mut TLSSocket` from per-`SSL` ex_data
   slot 0 (not from `arg`, which is shared across all connections on a
   listener). Routes through `tls_socket_functions::ffi::SSL_get_ex_data`
   (declared `safe fn` because `&SSL` is opaque-ZST). Calls
   `SSL_select_next_proto` directly in an `unsafe { … }` block with full
   SAFETY citing "out/outlen/in are valid per BoringSSL ALPN callback contract".
2. **`tls_socket_functions.rs:67-213` `ffi::` shim block**: ~50 BoringSSL
   FFI decls. Most are `safe fn` (the new style — opaque-ZST handle args
   + by-value scalars + `&mut` out-params). The remaining `unsafe fn`s
   are explicitly the ones taking caller-owned buffers / +1 ownership
   pointers (`SSL_get_finished`, `SSL_export_keying_material`,
   `SSL_SESSION_free`, `i2d_SSL_SESSION`, `d2i_SSL_SESSION`), each with
   a `// SAFETY (unsafe fn): …` line above the decl naming the
   precondition. **Strongest FFI-decl discipline in Section E.**
3. **`UpgradedDuplex.rs` + `socket_body.rs:3830-3940` `DuplexUpgradeContext`
   self-referential allocation**: the `MaybeUninit::<DuplexUpgradeContext>::uninit()`
   + 8× `ptr::addr_of_mut!(…).write(…)` two-phase init pattern at
   `:3853-3923`, ending with a single `&mut *duplex_context` materialisation
   at `:3926`. SAFETY at `:3857-3858` ("fresh heap allocation; every
   field is `ptr::write`-initialized below before any read or `&mut
   DuplexUpgradeContext` is formed"). This is the canonical PORT pattern
   for self-referential types with `Drop` / fn-ptr-niched fields where
   `mem::zeroed()` is UB. Mirrored in `WindowsNamedPipeContext::create`
   at `:282-358`.

## Backpressure / `write_buffer` semantics

`NewSocket::buffered_data_for_node_net` is a `JsCell<Vec<u8>>` (per
`socket_body.rs:294`); writes are plain `Vec::extend_from_slice` on a
borrowed-out `Vec` (`JsCell::with_mut`), no `set_len`-without-init.
Section E does NOT have the EXP-005 buffer-init shape — the
`Vec::with_capacity` call sites are all followed by `extend_from_slice`
or `push` loops, never `set_len(cap)` + index. The closest miss is
`tls_socket_functions.rs:589-599` (`Vec::with_capacity` for a TLS
signature buffer) — followed by `extend_from_slice`, sound.

## Notable patterns

1. **`black_box(from_mut(self))` aliasing-launder for re-entrant
   `&mut self` callbacks.** `WindowsNamedPipe::close` / `shutdown`
   (`:1176`, `:1216`) use `core::hint::black_box(core::ptr::from_mut(self))`
   to force LLVM to reload fields after a re-entrant
   `(*w).shutdown(false)` call that may rebuild `*self` via
   `m_ctx`. SAFETY comments cite "Mirrors the cork fix at b818e70e1c57".
   This is a per-method launder that the comment at `socket_body.rs:254`
   identifies as having been *replaced* by the systemic `Cell<Flags>` /
   `UnsafeCell`-everywhere fix in `NewSocket`; the named-pipe code still
   uses the old shape. **Phase-2 candidate**: migrate
   `WindowsNamedPipe` to the all-`Cell<T>` interior-mutability shape so
   the `black_box` workaround can drop.

2. **`*mut Self` in callbacks that may free `self` — RIGOROUSLY APPLIED.**
   `Handlers::mark_inactive` (`Handlers.rs:234-280`) is the canonical
   in-section example: takes `*mut Self`, multi-paragraph SAFETY
   explaining why `&mut self` would carry a protector that conflicts
   with the `heap::take` in the client branch. `NewSocket::on_*`
   (`socket_body.rs:730/784/855/1025/1128/…`) all take `*mut Self`.
   Sibling `WindowsNamedPipeContext::deinit_in_next_tick` (`:262`),
   `WindowsNamedPipeContext::schedule_deinit` (`:58`) all match.
   **Best-in-section discipline alongside Section Q's
   WebSocketUpgradeClient model.**

3. **Opaque-ZST `opaque_mut` / `opaque_ref` accessor over uws C handles.**
   `socket_body.rs:72, 91, 107, 117, 133, 142` all use
   `bun_opaque::opaque_deref_mut(s)` over `*mut us_socket_t`. Every
   site has a 1-line comment ("`us_socket_t` is an `opaque_ffi!` ZST —
   `opaque_mut` is the safe deref"). This is the bridge into Section Q's
   ~15-site opaque-ZST cluster and avoids local `unsafe` blocks for the
   majority of socket-handle deref operations.

4. **`#[unsafe(no_mangle)] pub extern "C" fn us_dispatch_*` macro stamp.**
   `uws_dispatch.rs:138-172` `us_dispatch_shims!` macro generates 11
   `#[unsafe(no_mangle)]`-marked exported shims (plus `us_dispatch_ssl_raw_tap`
   at `:178` as a one-off). The macro body unconditionally calls
   `unsafe { f($($call),*) }` because the looked-up `Option<fn>` is an
   `unsafe fn` pointer from `VTable`. No per-shim SAFETY — the macro
   doc-comment at `:129-132` carries the contract ("the looked-up fn's
   precondition is the per-kind handler's contract; `vt(s).expect()`
   panics on null"). **Macro-generated, not source-direct** — counts as
   1 macro × 11 stampings + 1 one-off.

5. **`core::ptr::read(&socket_config.handlers)` + `core::mem::forget`
   move-out trick.** `Listener.rs:235, 317, 1069, 1289` all use the broad
   move-out pattern to
   move `Handlers` out of a borrowed `SocketConfig` without invoking
   Drop. Each has a SAFETY citing "socket_config.handlers is valid; we
   forget socket_config below to avoid double-drop". Follow-up correction:
   only `:235` and `:317` have allocation-prone `take_protos()` before
   `mem::forget`; `:1069` and shifted `:1296` do only `Option::take()`
   before `mem::forget`. Combined with Bun's `panic = "abort"` policy, the
   EXP-039 witness is now a two-site unwind-regression guard, not current
   production UB.

## Top 3 concerning patterns

1. **`NsHandler::on_writable` + `NsHandler::on_data` keep `&mut Owner`
   live across handler bodies that DO re-enter `socket.write/end`.**
   Postgres / MySQL / Valkey drivers' `SocketHandler::on_writable` /
   `on_data` may synchronously call back into `socket.write()` (via
   `try_send` / flush paths). The adapter at `uws_handlers.rs:702-714`
   takes `ext: &mut Self::Ext` → `Some(this) = ext.owner_mut()` and
   holds `this: &mut Owner` across `H::on_data(this, …)`. If the
   handler re-enters via the JS event-loop tick and another adapter
   path (or the dispatcher itself) reaches the same ext slot, the
   second `owner_mut()` aliases the first. `ExtSlot::owner_mut` is
   documented to be non-re-entrant per `bun_uws_sys::thunk`, but the
   contract is *handler-discipline-by-comment*; no `RefCell`/Cell
   guard, no `*mut Owner` demotion. Compare with `BunListener` whose
   `socket_ext_owner` IS demoted to `*mut` immediately (`:580-582`).
   **Section E's most plausible Stacked-Borrows surface.**

2. **`select_alpn_callback` reads from per-`SSL` ex_data slot 0 with no
   slot-collision check.** `socket_body.rs:198-204` casts the slot
   value to `*mut TLSSocket`. If any other code path on the SAME `SSL*`
   ever sets slot 0 to a different pointer type, the next ALPN callback
   reads the wrong pointer with no validation. There is only one
   producer today (`NewSocket::on_open`) but the contract is
   per-codebase-convention. Hardening would be a typed `SSL_ex_data_idx`
   newtype or a discriminator byte; Phase-2 worth flagging.

3. **`bun_uws::uws_callback` macro at
   `WindowsNamedPipe.rs:515/538/554/1127/+more` emits `extern "C" fn`
   thunks that take `&mut Self`-derived `*mut Self`.** The four
   `WindowsNamedPipe__*` exports re-enter `(*w).shutdown(false)` /
   `writer.end()` while still inside the same Rust frame; the
   `black_box(from_mut(self))` launder (above) is the current
   workaround. **The `uws_callback` macro should match the
   `bun_jsc::host_fn` pattern and emit a `*mut Self`-typed first arg
   so callers don't need the `black_box` workaround.** Macro-generated,
   counts as `bun_uws::uws_callback` instances (~14 in Section E).

## Open questions

1. **Should `BunListener` follow `RawPtrHandler` instead of using the
   no-ext-slot `BunListener` adapter?** Currently
   `BunListener::on_close_no_ext` etc. use
   `thunk::socket_ext_owner::<api::NewSocket<SSL>>(s)` which returns
   `Option<&mut NewSocket<SSL>>` but is *immediately* `let ns: *mut
   api::NewSocket<SSL> = ns` demoted (uws_handlers.rs:580-583). The
   demotion is correct — but the `&mut` is formed for an instant and
   the function signature already promises `&mut Self::Ext`. Reading
   the underlying `bun_uws_sys::thunk::socket_ext_owner` (Section Q)
   to confirm whether the `&mut` lifetime ends at the rebinding is the
   Phase-2 task; if it doesn't, the same Stacked-Borrows hazard the
   `RawPtrHandler` was built to dodge applies here.
2. **The `NsHandler` family (Postgres/MySQL/Valkey/SpawnIPC) — should
   they migrate to a `RawNsHandler` shape that takes `*mut Owner`?**
   The contract today is "handler must not call back into uSockets
   while `&mut Self::Ext` is live". Loom modelling one nested
   `try_send` would confirm whether this is empirically violated; if
   yes, mirror `RawPtrHandler` for the SQL drivers.
3. **`WindowsNamedPipeContext::create` (`:282-358`) holds the
   `MaybeUninit` pointer across 9 field-writes plus a call to
   `WindowsNamedPipe::from` that itself constructs `NamedPipeHandlers`
   referencing `this`.** Each field write goes through `addr_of_mut!`;
   sound. But the SAFETY comment at `:343-344` is a single-line "fresh
   storage; we write every field exactly once" — short for the
   complexity. Phase-2 candidate for the explicit "no `&mut` until
   `ptr::write` completes" callout.
4. **`select_alpn_callback` registered against the listener-level
   `SSL_CTX` — what protects against `SSL_CTX_free` racing with an
   in-flight callback?** Listener teardown sequences are
   single-event-loop-thread per `Bun.listen` semantics, but if uSockets
   ever dispatches `select_alpn` from an off-loop thread (does it?),
   the `arg` is dead pointer territory. Section Q `bun_uws_sys` audit
   should confirm uSockets dispatch threading.
5. **`udp_socket.rs:1143` `extern "C" fn run(ctx, payload_roots)` is
   the only `MarkedArgumentBuffer::run` callback in Section E.** The
   `payload_roots: *mut MarkedArgumentBuffer` argument's
   `&mut *payload_roots` materialisation at `:1147` overlaps with the
   `&mut *ctx` at `:1146`; the two never alias (different allocations)
   but the `Ctx<'_>` lifetime is non-`'static` and stored on the
   parent stack — confirm via syn-walker that the `'_` lifetime is
   reachable through `*mut Ctx<'_>` re-projection.

## Anchor cross-refs

- **No anchored witnesses for Section E.**
- **EXP-012 cross-ref**: Section Q's `WebSocketUpgradeClient::cancel` is
  the canonical `*mut Self` fix model; Section E mirrors it for
  `NewSocket<SSL>` and the WindowsNamedPipe context. **Confirms the
  uSockets re-entrancy model has propagated correctly into Section E
  for the BunSocket TCP/TLS path.**
- **EXP-005 cross-ref**: `udp_socket.rs:894-897 / 1018-1026 / 1210-1211`
  carry explicit "no `MaybeUninit + assume_init` on `sockaddr_storage`;
  no `set_len` over uninit memory" comments — Section E **proactively
  avoids** the EXP-005 buffer-init shape. **Reference pattern.**
- **U2 cross-ref**: NO U2-shape (`from_ref(slice).cast_mut()` →
  `heap::destroy`) sites in Section E. The heap-take sites (`Handlers.rs:275`,
  `Listener.rs:289/375/861/1090/1179/1421/1774`, `SSLConfig.rs:442`,
  `socket_body.rs:2541`, `udp_socket.rs:1717`,
  `WindowsNamedPipeContext.rs:248`) all flow from `heap::into_raw`
  allocations, never from `&[T]`-derived pointers. **Clean.**
