# Consumer-requirements inventory — Valkey/Redis client (`src/runtime/valkey_jsc`) vs. uSockets core (`bun_uws` / `us_*`)

Scope: `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU/src/runtime/valkey_jsc/{valkey.rs, js_valkey.rs, js_valkey_functions.rs, mod.rs, protocol_jsc.rs, ValkeyCommand.rs, index.rs, valkey.classes.ts}` plus the shared uws plumbing it depends on (`src/runtime/socket/uws_handlers.rs`, `src/runtime/socket/uws_dispatch.rs`, `src/jsc/rare_data.rs`, `src/uws_sys/*`).

Only `valkey.rs` and `js_valkey.rs` touch `bun_uws`/`us_*` directly. `js_valkey_functions.rs`, `protocol_jsc.rs`, `ValkeyCommand.rs`, `index.rs` have **zero** uws references (verified by grep); they route through `JSValkeyClient::send` / `do_connect` / `js_disconnect`.

---

## 1. SocketGroup creation & ownership

The client does **not** own its `SocketGroup`. It borrows a lazily-initialized, per-VM group from `RareData`:

- `js_valkey.rs:1566-1588` — `JSValkeyClient::connect()` obtains the group:
  - `js_valkey.rs:1581-1588` — `let group: *mut uws::SocketGroup = … (*rare).valkey_group::<true|false>(&*vm_ptr)`; SSL vs non-SSL picks `valkey_tls_group` vs `valkey_group_`.
  - Comment at `js_valkey.rs:1575-1577`: "`valkey_group` only touches the embedded `SocketGroup` field + `vm.uws_loop()` (disjoint from anything we hold). Same pattern as `Bun__RareData__postgresGroup`."
- `src/jsc/rare_data.rs:240-241` — the two groups are embedded **by value** in `RareData` (`pub valkey_group_: SocketGroup; pub valkey_tls_group: SocketGroup;`); default-initialized at `rare_data.rs:318-319`; enumerated for teardown/close-all by `for_each_socket_group!` at `rare_data.rs:595-601`.
- `src/jsc/rare_data.rs:812-821` — `pub fn valkey_group<const SSL: bool>(&mut self, vm) -> &mut SocketGroup` → `Self::lazy_group(...)`.
- `src/jsc/rare_data.rs:766-771` — `lazy_group`: `if g.loop_.is_null() { g.init(vm.uws_loop(), None, core::ptr::null_mut()); }`. So group lifetime = VM lifetime; SSL_CTX is *not* stored in the group (passed per-connect).
- Comment at `js_valkey.rs:1659-1661` (quoted): "SAFETY: `client_ptr` is live; `group` is the lazy-initialised per-VM `SocketGroup` (stable for the VM's lifetime). `ssl_ctx` is a +1-ref BoringSSL `SSL_CTX*` (or None) forwarded opaquely to usockets."
- `mod.rs:25-31` — `ValkeyContext` is now an empty ZST: "Per-VM Valkey state. Empty: connections link into `RareData.valkey_group` / `valkey_tls_group` directly, and the default-TLS `SSL_CTX` is `RareData.defaultClientSslCtx()`."

**Migration note:** a Rust rewrite must preserve (a) one shared group per (VM, ssl-flag) — not per connection; (b) per-connect SSL_CTX override on a shared group (`us_socket_group_connect(kind, ssl_ctx, …)`); (c) group stability across the VM lifetime (raw `*mut SocketGroup` is cached only transiently within `connect()`).

## 2. SocketKind

- `valkey.rs:213` — `SocketKind::ValkeyTls` (TLS branch of `Address::connect`).
- `valkey.rs:230` — `SocketKind::Valkey` (TCP branch).
- Enum values: `src/uws_sys/SocketKind.rs:52-53` (`Valkey = 16`, `ValkeyTls = 17`, per `SocketKind.rs:90-91`).
- The kind is what selects the vtable at dispatch: `src/runtime/socket/uws_dispatch.rs:67-68`:
  ```rust
  t[SocketKind::Valkey as usize]    = Some(vtable::make::<handlers::Valkey<false>>());
  t[SocketKind::ValkeyTls as usize] = Some(vtable::make::<handlers::Valkey<true>>());
  ```

## 3. Vtable slots implemented

Registration chain: `uws_handlers.rs:843-844` — `pub type Valkey<const SSL: bool> = NsHandler<js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>, SSL>;` and `uws_handlers.rs:496` — `impl_ns_socket_events_forward!(js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>);`.

`NsHandler` (`uws_handlers.rs:653-736`) declares `HAS_ON_OPEN/DATA/WRITABLE/CLOSE/TIMEOUT/LONG_TIMEOUT/END/CONNECT_ERROR/CONNECTING_ERROR/HANDSHAKE = true` with `type Ext = ExtSlot<Owner>` (`uws_handlers.rs:660`). The raw C-side `us_socket_vtable_t` slots mirrored in `src/uws_sys/SocketGroup.rs:44-58` (`on_open, on_data, on_fd, on_writable, on_close, on_timeout, on_long_timeout, on_end, on_connect_error, on_handshake`).

Valkey's `SocketHandler<SSL>` (js_valkey.rs) implements:

| Slot | Anchor | Behavior |
|---|---|---|
| `on_open` | `js_valkey.rs:1859-1862` | re-stamps `client.socket`, delegates to `ValkeyClient::on_open` (`valkey.rs:1271-1291`) which resets buffers/flags and, for **TCP only**, immediately sends HELLO (`valkey.rs:1285-1289`: "if is tcp, we need to start the connection process / if is tls, we need to wait for the handshake to complete"). |
| `on_handshake` (TLS only) | `js_valkey.rs:1864-1958`; gated by `ON_HANDSHAKE: Option<fn>` const at `js_valkey.rs:2002-2009` (`if SSL { Some(Self::on_handshake_) } else { None }` — "`pub const onHandshake = if (ssl) onHandshake_ else null;`") | verify-error checking, hostname verification, then `client.start()`. |
| `on_close` | `js_valkey.rs:2011-2035` | detaches socket field first, then `client.on_close()` (reconnect logic). |
| `on_end` | `js_valkey.rs:2037-2044` | no-op: "Half-opened sockets are not allowed. usockets will always call onClose after onEnd in this case so we don't need to do anything here". |
| `on_connect_error` | `js_valkey.rs:2046-2066` | detaches socket field, routes to the **same** `client.on_close()` reconnect path. Note the dispatcher closes the socket before notifying (`uws_handlers.rs:703-712`: "Close before notify … snapshot of the ext slot taken before close"), and handles both `us_socket_t` and `us_connecting_socket_t` variants (`on_connecting_error`, `uws_handlers.rs:715-723`). |
| `on_timeout` | `js_valkey.rs:2068-2073` | only re-stamps the socket pointer; comment "Handle socket timeout" — **uSockets-level timeouts are effectively unused**; timeouts are done with event-loop timers (§6). |
| `on_data` | `js_valkey.rs:2075-2083` | re-stamps socket, `client.on_data(data)`, `update_poll_ref()`. |
| `on_writable` | `js_valkey.rs:2085-2091` | re-stamps socket, `client.on_writable()`, `update_poll_ref()`. |
| `on_long_timeout` | not forwarded — `uws_handlers.rs:424-426`: "`on_long_timeout` is intentionally NOT forwarded — no driver defines it, so the trait default fires." |
| `on_fd` | not implemented (IPC-only slot). |

Note the pervasive **re-stamp pattern**: every callback does `this.client_mut().socket = Self::_socket(socket)` (`js_valkey.rs:1860, 2022, 2052, 2071, 2077, 2086`) because uSockets may hand back a *different* `us_socket_t*` (e.g. after adopt/resize); on close/connect-error it is replaced with `SocketTCP::detached()`.

## 4. Every `us_socket_*`-level call the client makes (via `bun_uws` wrappers)

Direct calls from valkey code, with the wrapper it goes through (`src/uws_sys/socket.rs`, `src/uws_sys/SocketGroup.rs`):

| Valkey call site | Wrapper | Underlying us_* |
|---|---|---|
| `valkey.rs:216,218-226` `SocketTLS::connect_unix_group` / `connect_group` (kind=ValkeyTls) | `socket.rs:757-816` / `socket.rs:818-841` | `us_socket_group_connect` / `us_socket_group_connect_unix` (`SocketGroup.rs:230, 263`); writes owner into ext (`*sock(s).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner)`) |
| `valkey.rs:233,235-243` `SocketTCP::connect_unix_group` / `connect_group` (kind=Valkey) | same | same |
| `valkey.rs:572` & `valkey.rs:1338` `self.socket.write(chunk)` | `AnySocket::write` → `socket.rs:370-377` | `us_socket_write` (on `Connected`; 0 on connecting/detached) |
| `valkey.rs:657` `socket.close(uws::CloseCode::Normal)` | `socket.rs:338-346` | `us_socket_close` / `us_connecting_socket_close` |
| `valkey.rs:642` (implicit) & `js_valkey.rs:1481,1736` `socket.is_closed()` | `socket.rs:272-279` | poll-flag reads |
| `valkey.rs:655` `matches!(socket.socket(), uws::InternalSocket::Connected(_)) && !socket.is_established()` | `socket.rs:944` / `socket.rs:292-299` | `us_socket_is_established` — SEMI_SOCKET detection (§7) |
| `js_valkey.rs:1903-1909` `socket.get_native_handle()` | `socket.rs:590-608` | `us_socket_get_native_handle` → `SSL*` for hostname verification |
| `js_valkey.rs:1584-1587` `RareData::valkey_group` → `SocketGroup::init` | `SocketGroup.rs:105` | `us_socket_group_init(loop, kind_table?, …)` |
| Group teardown (VM-level, not valkey-owned) | `SocketGroup.rs:128,133` | `us_socket_group_deinit`, `us_socket_group_close_all` |

Also consumed from the uws layer: `uws::us_bun_verify_error_t` (handshake callback signature, `js_valkey.rs:1868`), `uws::CloseCode::{Normal, failure}`, `uws::InternalSocket`, `uws::NewSocketHandler<SSL>`, `uws::AnySocket`, `uws::SocketTCP::detached()`, `uws::SslCtx`.

## 5. Socket ref storage & lifetime

**Socket handle storage:** `valkey.rs:252` — `pub socket: AnySocket` on `ValkeyClient` (embedded at offset 0 of `JSValkeyClient` — `js_valkey.rs:370-385`, `#[repr(C)]`, "`client` MUST be at offset 0"). Initialized `Detached` at construction (`js_valkey.rs:701-703`, `814-816`).

**Back-pointer storage (socket → client):** the socket's ext slot holds `Option<NonNull<JSValkeyClient>>` — the **outer** wrapper, not the inner `ValkeyClient`. Load-bearing comment at `js_valkey.rs:1649-1656` (quoted):

> "The socket ext slot is typed `ExtSlot<JSValkeyClient>` (uws_handlers.rs `Valkey<SSL> = NsHandler<JSValkeyClient, …>`); store the OUTER pointer, not the inner `ValkeyClient`, or dispatch will mis-type and re-offset it (`on_open` → `this.client_mut()` adds `offsetof(JSValkeyClient, client)` again → garbage `&mut ValkeyClient`)."

Ext layout requirement (`socket.rs:797-801`, quoted): "The dispatch trampolines read the ext slot as `Option<NonNull<_>>` (8 bytes, null-niche optimized), so size and write must match that layout — NOT `Option<*mut Owner>` (16 bytes, discriminant-first), which would hand the trampoline `1` instead of the owner pointer."

**Lifetime management** is an intrusive refcount (`js_valkey.rs:384` `ref_count: bun_ptr::RefCount<JSValkeyClient>`; `RefCounted` impl at `js_valkey.rs:396-406`; destructor = `deinit` at `js_valkey.rs:1726-1752`). Refs held:

- `connect()` takes a **keep-alive +1** for the live socket (`js_valkey.rs:1630`), balanced by an errdefer on failure (`js_valkey.rs:1633-1638`) or, on success, released by one of: `on_valkey_close()`'s defer (`js_valkey.rs:1412-1421`, trailing `JSValkeyClient::deref(p)`) or `on_valkey_reconnect()` (§6, `js_valkey.rs:1397-1405`).
- Every socket callback takes a scoped ref (`this.ref_()` + `deref_guard`/scopeguard) around re-entrant work: `js_valkey.rs:2020-2032` (on_close), `2053-2063` (on_connect_error), `2079-2080` (on_data), `2087-2088` (on_writable), `1886-1887` (handshake).
- Timers hold a +1 while armed (`add_timer` `js_valkey.rs:1096` trailing `self.ref_()`; released in `remove_timer` `js_valkey.rs:1108-1112` or on fire `js_valkey.rs:1146-1149`, `1204-1207`).
- `deref` must be by raw pointer, not `&self` (`js_valkey.rs:419-425`, quoted): "Takes a raw pointer (not `&self`) because a `&self` argument would carry a Stacked Borrows protector for the whole call frame, making the in-frame deallocation in `deinit` UB ('deallocating while item is protected')."
- Event-loop keep-alive is separate: `poll_ref: JsCell<KeepAlive>` (`js_valkey.rs:375`), managed by `update_poll_ref()` (`js_valkey.rs:1757-1827`), which also upgrades/downgrades the JS wrapper strong ref (`this_value`) — including the documented intentional leak while connected (`js_valkey.rs:1802-1810`: "TODO(markovejnovic): This is a leak. Note this is an intentional leak…").
- `deinit` asserts the socket is already closed before freeing: `js_valkey.rs:1736` `debug_assert!(this_ref.client.get().socket.is_closed());`, frees the custom `SSL_CTX` via `SSL_CTX_free` (`js_valkey.rs:1737-1740`).

## 6. Reconnect logic

**Does it reuse the group? Yes.** Reconnect goes back through `JSValkeyClient::connect()` (`js_valkey.rs:1566`), which re-fetches the same per-VM `RareData` group (`js_valkey.rs:1581-1588`) and calls `Address::connect` on it again. No group/context is created or destroyed per reconnect. The custom `SSL_CTX` is also reused across reconnects via `_secure` (`js_valkey.rs:1592-1594`, quoted): "Reuse across reconnect — the SSL_CTX is the only thing the old `_socket_ctx` cache existed to preserve." (plus a per-VM `ssl_ctx_cache` so `duplicate()`'d clients share the `SSL_CTX*`, `js_valkey.rs:1598-1605`).

**Flow:**
1. `SocketHandler::on_close` / `on_connect_error` → `ValkeyClient::on_close()` (`valkey.rs:665-713`): if not manually closed and auto-reconnect enabled, `retry_attempts += 1`, compute delay, bail to `fail(...)` when `delay==0 || retry_attempts > max_retries`, else set `is_reconnecting`, clear `is_authenticated`/`is_selecting_db_internal`, reject in-flight commands (`valkey.rs:708`), then `on_valkey_reconnect()`.
2. **Backoff:** `get_reconnect_delay()` (`valkey.rs:491-513`) — base 50 ms, doubling, capped at 2000 ms and at 10 attempts for the exponent; `max_retries` default 20 (`valkey.rs:176`), configurable via `maxRetries` (`js_valkey.rs:2132-2136`).
3. **Timer mechanism:** *not* a uSockets timer — a Bun event-loop timer. `reconnect_timer: JsCell<Timer::EventLoopTimer>` with tag `Timer::Tag::ValkeyConnectionReconnect` (`js_valkey.rs:382-383, 734-736`); armed in `on_valkey_reconnect` (`js_valkey.rs:1386-1395`) via `add_timer` → `VirtualMachine::timer_insert` (`js_valkey.rs:1091-1095`). Fired via `src/runtime/dispatch.rs:1056-1058` (`EventLoopTimerTag::ValkeyConnectionReconnect => timer_arm!(Valkey, reconnect_timer, …on_reconnect_timer())`), recovered by `impl_timer_owner!` field-parent macros (`js_valkey.rs:387-390`).
4. `on_reconnect_timer` (`js_valkey.rs:1194-1211`) → `reconnect()` (`js_valkey.rs:1213-1249`): guards `is_reconnecting` and VM shutdown; **resets the `KeepAlive`** (`js_valkey.rs:1228-1232`: `r.disable(); *r = KeepAlive::default(); r.ref_(…)`); calls `connect()`; on error, `fail_with_js_value` + disable poll ref; on success `reset_connection_timeout()`.
5. Ref-leak balancing, comment quoted verbatim (`js_valkey.rs:1397-1405`):

> "Release the keep-alive ref `connect()` took for the just-closed socket. We only reach here from `ValkeyClient::on_close()`'s reconnect branch, which (unlike its other branches) does not call `on_valkey_close()` and so never balances that ref. The reconnect timer (and the next `connect()`) take their own refs, so without this every retry leaks one ref and the client is never freed. SAFETY: caller (`SocketHandler::on_close`/`on_connect_error`) holds a scoped ref across this call, so the count stays > 0."

6. On successful HELLO after reconnect: `valkey.rs:995-998 / 1035-1038` reset `is_reconnecting=false`, `retry_attempts=0`, status=Connected.
7. Explicit `connect()` after failure clears sticky state: `js_valkey.rs:986-992` ("Explicit connect() should also clear the sticky `failed` flag … see https://github.com/oven-sh/bun/issues/29925") and `do_connect` restarts reconnect from Disconnected with `retry_attempts = 0` (`js_valkey.rs:1017-1024`).
8. Fresh-socket state reset on reopen (`valkey.rs:1276-1284`, comment references #29925: "A fresh socket has opened, so reset per-connection state. Without this, `send()` would permanently reject with 'Connection has failed' … and the new HELLO response would be dropped because `is_authenticated` was still set from a prior successful handshake").

## 7. TLS usage

- **Scheme mapping** (`valkey.rs:102-115`): `rediss`, `valkeys`, `redis+tls`, `valkey+tls` → `StandaloneTls`; `redis+tls+unix`, `valkey+tls+unix` → `StandaloneTlsUnix`. `Protocol::is_tls()` at `valkey.rs:122-124`.
- **TLS modes** (`valkey.rs:131-137`): `TLS::None` / `TLS::Enabled` (scheme- or `tls: true`-driven; uses `RareData.defaultClientSslCtx()` via `crate::jsc_hooks::default_client_ssl_ctx(vm_ptr)` — `js_valkey.rs:1621-1626`) / `TLS::Custom(Box<SSLConfig>)` (`tls: {…}` object, parsed by `Options::from_js` at `js_valkey.rs:2150-2173`). Custom ctx built once and cached per-VM (`js_valkey.rs:1592-1610`), stored in `_secure: Cell<Option<*mut uws::SslCtx>>` (`js_valkey.rs:378-380`: "`us_ssl_ctx_t` for `tls: { …custom CA… }`. `tls: true` borrows `RareData.defaultClientSslCtx()` instead; `tls: false` leaves this null."), freed at deinit with `SSL_CTX_free` (`js_valkey.rs:1737-1740`). Ctx-creation failure disables auto-reconnect and fail-closes (`js_valkey.rs:1611-1620`).
- **verify (`rejectUnauthorized`)**: `TLS::reject_unauthorized` (`valkey.rs:140-147`) — Custom → config flag; Enabled → `vm.get_tls_reject_unauthorized()`; None → false. Enforced in `on_handshake_` (`js_valkey.rs:1890-1949`): (1) chain error (`ssl_error.error_no != 0`) → `fail_handshake_with_verify_error`; (2) hostname identity check via `boringssl::check_server_identity` against **SNI servername** (`SSL_get_servername`, `js_valkey.rs:1911-1916`) falling back to the URL host; unix sockets skip identity check (`js_valkey.rs:1898-1902` comment); IPv6 brackets stripped (`js_valkey.rs:1922-1931`, mirroring `connect_group`'s strip at `socket.rs:771-778`). Handshake *failure* (`success != 1`) is always fatal regardless of verify setting (`js_valkey.rs:1951-1956`: "if we are here is because the server rejected us … no matter if reject_unauthorized is false, because we were disconnected by the server").
- **SNI**: not explicitly set by valkey code — it relies on whatever the uSockets connect path sets (the handshake reads it back with `SSL_get_servername`). A rewrite must keep SNI set from the connect host for the servername-preferred verification to work.
- **Handshake gating of protocol start**: TCP starts HELLO in `on_open`; TLS defers to `on_handshake` success (`valkey.rs:1285-1289`, `js_valkey.rs:1950`).
- Handshake-fail path marks `is_manually_closed = true` before closing so no reconnect is attempted on cert errors (`js_valkey.rs:1976-1979`, `1990-1998`).

## 8. Timeouts

No uSockets `us_socket_timeout` usage — the `on_timeout` vtable slot is a stub (§3). All timeouts are Bun event-loop timers:

- `timer: JsCell<EventLoopTimer>` with tag `ValkeyConnectionTimeout` (`js_valkey.rs:382, 731-733`); dispatch at `dispatch.rs:1053-1055`.
- Interval selection: `get_timeout_interval()` (`valkey.rs:473-481`) — 0 if failed; `idle_timeout_interval_ms` when Connected (default 0 = disabled, `valkey.rs:173`); `connection_timeout_ms` otherwise (default 10000, `valkey.rs:174`). JS options `idleTimeout` / `connectionTimeout` (`js_valkey.rs:2114-2124`).
- Arm/rearm: `reset_connection_timeout` (`js_valkey.rs:1116-1128`) called from `do_connect` (`js_valkey.rs:1013`), `send` (`js_valkey.rs:1696`), `reconnect` (`js_valkey.rs:1248`). Disable: `js_valkey.rs:1130-1135`.
- Fire: `on_connection_timeout` (`js_valkey.rs:1137-1192`) — Connected → `IdleTimeout` fail; Connecting/Disconnected → `ConnectionTimeout` fail. Both go through `client_fail` → `ValkeyClient::fail` → reject-all + close.
- `add_timer`/`remove_timer` (`js_valkey.rs:1060-1114`) carry their own refcount discipline (a ref per armed timer; FIRED timers release in the fire handler: `js_valkey.rs:1146` "Release the keep-alive ref from add_timer; remove_timer/stop_timers skip FIRED timers.").

## 9. Unusual lifecycle (UAF-discipline comments quoted verbatim)

### 9.1 SEMI_SOCKET close — the critical uSockets-core behavioral dependency

`ValkeyClient::close()` (`valkey.rs:637-662`) works around uSockets not firing callbacks for explicitly-closed semi-sockets. Quoted verbatim (`valkey.rs:645-654`):

> "usockets does not dispatch `on_close`/`on_connect_error` when an application explicitly closes a `us_socket_t` whose TCP connect hasn't resolved yet (`POLL_TYPE_SEMI_SOCKET` — DNS resolved synchronously so `connect()` got a real `us_socket_t*` rather than a `us_connecting_socket_t*`). See `us_internal_socket_close_raw`. The valkey client relies on one of those callbacks (via `on_valkey_close`/`on_valkey_reconnect`) to release the `+1` keep-alive ref `connect()` took, so without one the `JSValkeyClient` box leaks. Detect a SEMI_SOCKET before closing and run the close path ourselves afterwards."

Detection: `valkey.rs:655-661` — `Connected(_) && !is_established()` ⇒ after `close()`, manually set `Disconnected` and run `on_close()`. **A Rust uSockets core must either keep this exact non-dispatch semantics or this workaround becomes a double-dispatch bug.** Also note `close()` first *replaces* `self.socket` with a detached handle (`valkey.rs:638-641`) before closing — a re-entrancy guard making `close()` idempotent.

### 9.2 Connect-result trichotomy

`ConnectResult` (`SocketGroup.rs:224-247` region): `us_socket_group_connect` may return a real `us_socket_t*` (sync DNS), a `us_connecting_socket_t*`, or fail. Valkey stores whichever as `AnySocket` and the ext-owner is written on **both** variants (`socket.rs:806-815`). Errors on the connecting handle arrive via `on_connecting_error` (`uws_handlers.rs:715-723`).

### 9.3 Deferred socket close from GC finalizer

`finalize` (`js_valkey.rs:1538-1554`) cannot close inline: `close_socket_next_tick` (`js_valkey.rs:1481-1536`) enqueues an `AnyTask` because "socket close can potentially call JS so we need to enqueue the deinit" (`js_valkey.rs:1495`); holder comment quoted (`js_valkey.rs:1497-1499`): "BACKREF — JSValkeyClient is intrusively ref-counted (RefCount + @fieldParentPtr recovery in SubscriptionCtx::parent). The `self.ref_()` above / `(*ctx).deref()` in run() keep it alive across the task hop." VM-shutdown special case closes inline (`js_valkey.rs:1486-1492`: "During VM shutdown the event loop won't tick, so the deferred task below would never run; close inline (this_value is cleared, no JS re-entry).").

### 9.4 Deferred promise rejection from finalizer context

`DeferredFailure` (`valkey.rs:301-336`): when `flags.finalized`, `fail`/`reject_in_flight_commands` cannot run JS ("We can't run promises inside finalizers", `valkey.rs:588`), so queues are moved into a heap task and rejected on the next event-loop turn (`valkey.rs:539-564`, `587-607`).

### 9.5 Deinit provenance discipline

`deinit` (`js_valkey.rs:1726-1752`) quoted:

> "SAFETY: last ref dropped; exclusive access. The shared borrow is scoped so it ends before we reclaim the Box below — the final `heap::take` must consume the original `*mut` (which carries the allocation's Unique provenance from `Box::into_raw`), not a pointer re-derived from `&Self` (SharedReadOnly under Stacked Borrows, which would make the dealloc-write UB)."

### 9.6 Re-entrancy (R-2) discipline

- `js_valkey.rs:358-369`: "R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy)…"
- `client_mut` escape hatch (`js_valkey.rs:451-458`): "This is the single audited escape hatch — callers must keep the returned borrow short and not hold it across a call that re-enters JS and re-derives the same client."
- `deref_guard` (`js_valkey.rs:59-73`): scope-guarded ref/deref used in ~every callback.
- `valkey.rs:344-348` (`impl_field_parent!`): "R-2: shared `&` only — every `JSValkeyClient` method this reaches is `&self`."
- `ValkeyClient::deref` (`valkey.rs:1517-1523`): "SAFETY: only called in balanced `ref_()`/`deref()` pairs (`on_auto_flush`, `on_writable`), so the count stays > 0 and the outer `&mut self` protector is never invalidated by deallocation."
- `ExtSlot::owner_mut` contract (`thunk.rs:200-204`): "The slot holds the unique heap owner; uWS dispatch is single-threaded and — per the `Handler::Ext = ExtSlot<T>` contract — non-re-entrant on this user-data, so no aliasing `&mut T` exists."
- `on_connect_error` ext snapshot (`thunk.rs:210-212`): "Snapshot the raw pointer word without forming a borrow. Used by `on_connect_error` paths that must read the owner *before* closing the socket (which may invalidate the ext storage `self` points into)."

### 9.7 Auto-reconnect and manual close interplay

- `disconnect()` (`valkey.rs:1490-1496`) sets `is_manually_closed` first so `on_close` skips reconnect; JS `close()` maps to `jsDisconnect` (`valkey.classes.ts:89-90`, `js_valkey.rs:1038-1045`).
- `fail_with_js_value` may re-enter `close()` (`valkey.rs:630-633`) — safe only because `close()` detaches the socket field before closing.
- `duplicate()` (`js_valkey_functions.rs:1901-1927`) creates a sibling client (fresh `SocketGroup` lookup at connect time; inherits `is_manually_closed`/`finalized`, `js_valkey.rs:820-839`) and connects with `connection_promise_returns_client = true`.

## 10. Migration notes (requirements a Rust uSockets core must satisfy for this consumer)

1. **Shared, VM-lifetime socket groups keyed by (VM, TLS)** with per-connect `SSL_CTX*` override and per-connect ext sizing; kind-based vtable table dispatch (`SocketKind::Valkey`/`ValkeyTls` slots 16/17).
2. **Ext slot = single pointer word**, written by the connector *after* `connect` returns, on both `Socket` and `Connecting` results; trampolines must read it as `Option<NonNull<T>>` (8-byte null-niche). Beware the calloc'd-but-unstamped window (`ExtSlot::owner_mut` returns None then).
3. **Callback set required:** open, data, writable, close(code, reason), connect_error(code) on both socket and connecting handles, end (may be a no-op if "onClose always follows onEnd" is preserved), handshake(success, verify_error) for TLS. `on_timeout`/`on_long_timeout` may remain unused, but the slots exist.
4. **Callback socket-pointer re-stamping** must remain possible: callbacks receive the (possibly new) `us_socket_t*` and the client overwrites its stored handle on every event.
5. **Exactly-once terminal notification invariant:** the client's refcounting assumes exactly one of `on_close`/`on_connect_error` fires per successful `connect()` — *except* the explicit-close-of-semi-socket case (§9.1) where **neither** fires and the client compensates. Changing this in a rewrite silently breaks either into a leak (never fires) or UAF/double-close (fires twice: uSockets dispatch + the manual `on_close()` at `valkey.rs:660`). If the Rust core *does* dispatch `on_close` for explicitly-closed semi-sockets, `valkey.rs:645-661` must be deleted in the same change.
6. **`is_established()` must distinguish SEMI_SOCKET from established** on a `Connected` handle (used only for the §9.1 detection).
7. **TLS**: handshake callback must deliver `us_bun_verify_error_t` (error_no/code/reason) regardless of verify mode; `get_native_handle()` must yield the live `SSL*` during the handshake callback (for `SSL_get_servername` + `check_server_identity`); SNI must be set from the connect host; `SSL_CTX` ownership is caller-side (+1 ref passed in, freed by client at deinit / cached per-VM).
8. **`write` semantics**: non-blocking partial write returning bytes written (`i32`), 0 on detached/connecting; `on_writable` fired when writable again. Valkey buffers the remainder itself (`valkey.rs:567-578`, `1334-1346`).
9. **Host handling**: `connect_group` strips `[...]` IPv6 brackets and NUL-terminates the host for getaddrinfo (`socket.rs:771-793`); synchronous-DNS fast path must keep returning a real socket (that's what creates the SEMI_SOCKET case).
10. **Timers are out of scope of the socket core** — valkey uses `EventLoopTimer` tags `ValkeyConnectionTimeout` / `ValkeyConnectionReconnect` (dispatch.rs:1053-1058), not `us_timer_t`; but the group needs `vm.uws_loop()` at lazy-init.
11. **Close codes**: `CloseCode::Normal` from valkey's own close; the dispatcher uses `CloseCode::failure` in the connect-error pre-close (`uws_handlers.rs:706`).
12. **Single-threaded dispatch guarantee** underpins all of the `&self`/`JsCell` interior-mutability and `ExtSlot::owner_mut` soundness arguments — the Rust core must keep group/socket callbacks on the owning (JS) thread, non-re-entrant per user-data.
