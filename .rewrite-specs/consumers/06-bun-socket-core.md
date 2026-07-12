# Consumer-requirements inventory: Bun.listen / Bun.connect sockets over bun_uws / bun_uws_sys

All paths relative to `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU/src/runtime/socket/`.

---

## 1. us_socket_* / SocketGroup / ConnectingSocket / ListenSocket / Loop surface used

### `uws::NewSocketHandler<SSL>` (wrapper over `InternalSocket` union) — per-socket ops
| Method | Representative call site |
|---|---|
| `is_detached()` | pervasive guard, e.g. socket_body.rs:682, 889, 2154 |
| `is_closed()` | socket_body.rs:1297, 2129, 3190 |
| `is_established()` | socket_body.rs:2132 (readyState), 2997, 3052 (SEMI_SOCKET detection) |
| `is_shutdown()` | socket_body.rs:2133, 2386, 2544 |
| `close(CloseCode)` | socket_body.rs:1253 (`close_and_detach`), 1279, 3062 (`FastShutdown` in JS `close()`), 3191 (`Failure` in finalize); uws_handlers.rs:187/308/706/802 (`CloseCode::failure` inside `on_connect_error` dispatch) |
| `shutdown()` / `shutdown_read()` | socket_body.rs:3023-3024; uws_jsc.rs:210 |
| `write(&[u8])` | socket_body.rs:2371; uws_jsc.rs:190,202 |
| `raw_write(&[u8])` | socket_body.rs:2369 (`BYPASS_TLS` twin) |
| `raw_writev(&[UsIoVec])` | socket_body.rs:2386 (`write_vectored_raw`) |
| `write_check_error(&[u8]) -> (i32, fatal)` | socket_body.rs:2416, 2923 — distinguishes would-block from EPIPE/ECONNRESET fatal |
| `write2(prefix, suffix)` (`us_socket_t` direct, POSIX writev fast-path) | socket_body.rs:2583 |
| `flush()` | socket_body.rs:2957 |
| `pause_stream()` / `resume_stream()` | socket_body.rs:714 / 693 |
| `set_timeout(secs: c_uint)` | socket_body.rs:2166-2168 (JS `timeout()`); Listener.rs:637 (`set_timeout(120)` default on accept) |
| `set_keep_alive(bool, delay)` | socket_body.rs:752 |
| `set_no_delay(bool)` | socket_body.rs:771 |
| `set_tos(i32)` / `get_tos()` | socket_body.rs:806 / 819 |
| `local_address(&mut [u8;64])` / `local_port()` | socket_body.rs:2255, 2274 / 2305 |
| `remote_address(&mut buf)` / `remote_port()` | socket_body.rs:2315, 2334 / 2363 |
| `fd()` | socket_body.rs:3245 (getter), 4719 (`setSocketOptions` setsockopt) |
| `ssl() -> Option<*mut SSL>` | socket_body.rs:1369, 1649; used throughout tls_socket_functions.rs |
| `get_verify_error() -> us_bun_verify_error_t` | socket_body.rs:2206 |
| `sni_resolve(ctx, is_error)` | socket_body.rs:853 (`resumeSNI`) |
| `dns_error() -> i32` | socket_body.rs:1226 (raw getaddrinfo code from connecting socket) |
| `is_named_pipe()` | socket_body.rs:4646-4648 |
| `ext::<T>() -> Option<*mut T>` | socket_body.rs:1270, 1447, 619 etc. |
| `DETACHED` constant + `from(s)`, `from_connecting(c)`, `from_duplex(d)`, `from_any(InternalSocket)` | socket_body.rs:42-44, 1057, 4092; uws_handlers.rs:116-118, 203 |

### `us_socket_t` direct (opaque ZST accessors)
- `us_socket_t::opaque_mut(p)` — uws_dispatch.rs:80, 190; uws_handlers.rs:187, 552 etc.
- `.kind()` / `.set_kind(SocketKind)` — uws_dispatch.rs:81; Listener.rs:631 (re-stamp accepted socket `BunListenerT* → BunSocketT*`)
- `.raw_group()` / `.group()` / `.group().owner::<Listener>()` — uws_dispatch.rs:84, 94; uws_handlers.rs:534; Listener.rs:1809
- `.ext::<Option<ThisPtr<T>>>()` — uws_dispatch.rs:197, 240, 267; uws_handlers.rs:552-585; Listener.rs:1855
- `.adopt_tls(group, kind, &mut SSL_CTX, sni: Option<&CStr>, is_client, socket_ext_size, ?)` — socket_body.rs:3492-3500 (upgradeTLS)
- `.set_ssl_raw_tap(true)` — socket_body.rs:3589
- `.start_tls_handshake()` — socket_body.rs:3611
- `.resume()` — socket_body.rs:3616 (re-arm readable interest after adopt)
- `.tls_feed(&[u8])` — socket_body.rs:3621 (inject pre-upgrade `initialData` into TLS engine)
- `.close(CloseCode)`, `.write`, `.shutdown` — via handler shims above; uws_jsc.rs:186-211

### `ConnectingSocket`
- `ConnectingSocket::opaque_mut(c)`, `.kind()`, `.raw_group()`, `.ext::<T>()` — uws_dispatch.rs:104-118; uws_handlers.rs:196-203, 313-317, 806-814
- ext slot stamped at connect: socket_body.rs:623 (`*ConnectingSocket.ext() = Some(this)`)
- `on_connecting_error` is a distinct vtable slot from `on_connect_error` (dispatched with a `ConnectingSocket*`, not `us_socket_t*`): uws_dispatch.rs:169-170

### `SocketGroup`
- `SocketGroup::default()` + `.init(Loop::get(), None, owner_ptr)` — Listener.rs:319, 326-328 (owner ext = `*mut Listener`)
- `SocketGroup::destroy(ptr)` — Listener.rs:353, 856
- `.listen(kind, ssl_ctx, Option<&CStr> host, port, flags, ext_size, &mut errno)` — Listener.rs:397-407
- `.listen_unix(kind, ssl_ctx, path_bytes, flags, ext_size, &mut errno)` — Listener.rs:415-424
- `.close_all()` — Listener.rs:775 (force-close on stop), 849 (deinit)
- `.owner::<Listener>()` — uws_handlers.rs:534, Listener.rs:1809
- Per-VM connect group: `VirtualMachine::get().rare_data().bun_connect_group::<SSL>(vm)` — socket_body.rs:564-567, 3484-3487; group ops:
  - `.connect(kind, ssl_ctx, host_cstr, port, local_bind: Option<(&CStr,u16)>, flags, ext_size) -> ConnectResult{Failed|Socket|Connecting}` — socket_body.rs:606-626
  - `.connect_unix(kind, ssl_ctx, path, flags, ext_size)` — socket_body.rs:630-636
  - `.from_fd(kind, ssl_ctx, ext_size, LIBUS_SOCKET_DESCRIPTOR, false)` — socket_body.rs:647-653 (then synchronously calls `on_open` itself, line 661)

### `ListenSocket`
- `.close()` — Listener.rs:780, 802
- `.get_local_port()` — Listener.rs:410 (ephemeral-port readback), 1391
- `.get_local_address(&mut buf)` — Listener.rs:1358
- `.socket::<false>()` → `.fd()` — Listener.rs:901-907 (getter)
- `.add_server_name(&CStr, ssl_ctx, null)` / `.remove_server_name(&CStr)` — Listener.rs:503-507, 713-714
- `.on_server_name(us_dispatch_server_name)` — Listener.rs:520 (registers early select-cert callback)

### `Loop`
- `Loop::get()` — Listener.rs:328 (group init). Event-loop keepalive goes through `bun_io::KeepAlive` (`poll_ref`), not uws directly.

### Flags/constants consumed
`LIBUS_SOCKET_ALLOW_HALF_OPEN` (socket_body.rs:574, Handlers.rs:482), `LIBUS_LISTEN_EXCLUSIVE_PORT`, `LIBUS_LISTEN_REUSE_PORT | LIBUS_LISTEN_REUSE_ADDR`, `LIBUS_LISTEN_DEFAULT`, `LIBUS_SOCKET_IPV6_ONLY` (Handlers.rs:472-487), `LIBUS_SOCKET_DESCRIPTOR` (socket_body.rs:651), `CloseCode::{Normal, Failure, FastShutdown}`, `create_bun_socket_error_t` (uws_jsc.rs:40-75), `us_bun_verify_error_t` (`error_no`, `code_bytes()`, `reason_bytes()` — socket_body.rs:1680-1691, 2206-2214), `UsIoVec` (socket_body.rs:2378).

---

## 2. Vtable slots / event dispatch

### Mechanism
`loop.c` calls `#[no_mangle] us_dispatch_*` shims stamped by the `us_dispatch_shims!` macro (uws_dispatch.rs:126-173). Each shim looks up a `&'static VTable` by `s->kind` (`vt()`/`vtc()`, uws_dispatch.rs:76-120): Rust kinds get a static monomorphized `vtable::make::<Handler>()` table (one per kind, in the `TABLES` LazyLock, uws_dispatch.rs:38-74); C++/dynamic kinds route to the per-group `group->vtable`. `SocketKind::Invalid` panics deliberately (uws_dispatch.rs:83-84).

Shims: `us_dispatch_open` (is_client, ip, ip_len), `us_dispatch_data`, `us_dispatch_fd`, `us_dispatch_writable`, `us_dispatch_close` (code, reason ptr), `us_dispatch_timeout`, `us_dispatch_long_timeout`, `us_dispatch_end`, `us_dispatch_connect_error`, `us_dispatch_connecting_error` (ConnectingSocket*), `us_dispatch_handshake` (ok, verify_error, + trailing null userdata) — uws_dispatch.rs:150-173.

Three extra non-vtable entry points:
- `us_dispatch_ssl_raw_tap(s, data, len)` — uws_dispatch.rs:182-222: ciphertext tap on the `[raw,_]` half of an `upgradeTLS` pair; only fires when `ssl_raw_tap` bit is set on a `BunSocketTls` socket; delivers to the `twin` TLSSocket's `on_data`.
- `us_dispatch_session(s, data, len)` — uws_dispatch.rs:234-252: serialized resumable session from BoringSSL's new-session callback, delivered by `ssl_flush_pending_session()` **after the SSL stack has unwound** (so JS may destroy the socket). → `TLSSocket::on_session`.
- `us_dispatch_keylog(s, data, len)` — uws_dispatch.rs:261-279 → `TLSSocket::on_keylog`.

Plus the SNI select-cert callback registered per listen socket: `us_dispatch_server_name(ls, hostname, abort_handshake, socket) -> *mut SSL_CTX` — Listener.rs:1797-1905 (see §6).

### Bun socket handlers
- `BunSocket<SSL> = RawPtrHandler<api::NewSocket<SSL>, SSL>` (uws_handlers.rs:505). Ext = `Option<ThisPtr<NewSocket<SSL>>>`. Handlers take `ThisPtr`, **never `&mut`** — uws_handlers.rs:220-229: *"These handlers may free or re-enter `Self` mid-call (a JS callback closing the socket, the refcount reaching zero), so they cannot take `&mut self` — a `&mut` argument protector outliving the allocation is UB."*
- `BunListener<SSL>` (uws_handlers.rs:512-594): no ext (`HAS_EXT: bool = false`); `on_open_no_ext` recovers the `Listener` from `s.group().owner::<Listener>()`, calls `Listener::on_create` (allocates NewSocket, stashes in ext, re-stamps kind to `BunSocket*`, `set_timeout(120)`), then fires `NewSocket::on_open` in the same dispatch tick (uws_handlers.rs:530-547). Remaining `*_no_ext` slots defensively read the freshly-stashed NewSocket if events fire before restamp (uws_handlers.rs:551-593).

### What each `NewSocket` handler does
| Slot | Body | Notes |
|---|---|---|
| on_open | socket_body.rs:1343-1525 | guards `has_handlers`; `ref_guard`; **replaces `self.socket` with the real `us_socket_t`** (connecting→connected transition, :1364); TLS: `SSL_set_tlsext_host_name` from `server_name`/`connection` host, registers ALPN select cb + `SSL_set_ex_data(0, this)` for servers, `SSL_set_alpn_protos` for clients (:1368-1444); rewrites ext slot (:1447-1450); `mark_active()`, resolves connect promise; for TLS with a `handshake` callback, `open` is deferred to handshake (:1463-1474); if open callback returns Error → error handler + `mark_inactive()`; flushes writes buffered during the open callback (:1498-1523). |
| on_data | :2035-2089 | guard chain: `has_handlers` → refresh `self.socket = s` → detached → `native_callback.on_data` (H2 fast path) → FINALIZING → shutting down; converts data via `binary_type` and calls JS. |
| on_writable | :880-936 | native H2 first; `internal_flush()` retry of `buffered_data_for_node_net`; only fires JS drain if buffer fully drained and not detached. |
| on_close | :1937-2032 | consumes the +1 the ext held; if no handlers: detach + deref + return (:1951-1956); detaches native callback, sets DETACHED; **chains the upgradeTLS raw twin's on_close** (:1972-1977); `CloseTeardown` guard settles IS_ACTIVE vs a synchronously reconnected `Handlers` (:317-338); FINALIZING skips JS; `err > 2` is a real read errno turned into a JS error, 0/1/2 are self-initiated CloseCodes (:2009-2024). |
| on_timeout | :939-978 | idle-timeout → JS `timeout` callback; skipped when FINALIZING. |
| on_long_timeout | not overridden for NewSocket (default no-op; slot exists in trait, uws_handlers.rs:239). Used by HTTPClient/WS handlers only. |
| on_end | :1563-1607 | TCP FIN; if no `end` callback: unref poll_ref + `mark_inactive()` (*"If you don't handle TCP fin, we assume you're done."* :1592). |
| on_connect_error | :1220-1227 → `handle_connect_error` :1033-1216 | see §7. |
| on_handshake | :1610-1809 | see §6. |
| on_fd | not implemented for Bun sockets (only `SpawnIPC`, uws_handlers.rs:871-874). |
| on_session / on_keylog | :1843-1934 | copy bytes into a JS Buffer, call `session`/`keylog` handlers. |

**Ordering contract encoded in the generic handlers** (uws_handlers.rs:169-194, verbatim): on connect error the trampoline must *"Close FIRST, then notify — same order `main`'s `configure()` trampoline used. The handler may re-enter `connectInner` synchronously (node:net `autoSelectFamily` falls back to the next address from inside the JS `connectError` callback); on Windows/libuv, starting the next attempt's `uv_poll_t` while this half-open one is still active and then closing it *afterwards* leaves the second poll never delivering writable/error → process hang."* And: *"Safe for TLS too: `us_internal_ssl_close` short-circuits SEMI_SOCKET straight to `close_raw`, and `close_raw` skips dispatch for SEMI_SOCKET, so no `on_handshake`/`on_close` lands in JS before we read `ext`/`this`."*

---

## 3. Socket reference storage & lifetimes

### Ext-data
- Connected client socket: ext = `Option<ThisPtr<NewSocket<SSL>>>` written at connect (socket_body.rs:619, 640, 657) and rewritten in `on_open` (:1447-1450). Optional because *"a connect/accept can fail and dispatch `on_close` / `on_connect_error` BEFORE the caller has had a chance to stash `this` in the freshly-calloc'd ext slot"* (uws_handlers.rs:107-112).
- ConnectingSocket ext: same `Option<ThisPtr<...>>` (socket_body.rs:623).
- Accepted socket: ext uninitialized at `on_open` (calloc'd); owner comes from `group->ext = *mut Listener`; `on_create` fills the ext then restamps kind (uws_handlers.rs:509-547, Listener.rs:625-636).
- Listener: `group.ext = *mut Listener` (Listener.rs:328); the SNI callback recovers it via `ls.group().owner::<Listener>()` (Listener.rs:1809).
- ext size passed as `size_of::<*mut c_void>()` everywhere (socket_body.rs:613, 635, 650, 3498; Listener.rs:404, 421).
- `detach_for_reconnect` **nulls the ext slot before closing** so the synchronous close dispatch early-returns (socket_body.rs:1268-1290).

### `NewSocket<SSL>` struct (socket_body.rs:246-295)
Fields: `socket: Cell<NewSocketHandler<SSL>>` (union of Detached / Connected(us_socket_t*) / Connecting(ConnectingSocket*) / Pipe / UpgradedDuplex), `owned_ssl_ctx: Cell<Option<*mut SSL_CTX>>` (client-owned +1, freed in deinit :3174-3177; server-accepted leave None — listener owns it), `flags: Cell<Flags>` (u16 bitflags, :3959-3990), `ref_count` (intrusive `bun_ptr::RefCount`), `handlers: JsCell<Option<Rc<Handlers>>>`, `this_value: JsCell<JsRef>` (strong-while-active / weak-when-idle JS wrapper ref, :267-269), `poll_ref: JsCell<KeepAlive>` (process keepalive), `ref_pollref_on_connect`, `connection: Option<UnixOrHost{Unix, Host{host,port}, Fd}>`, `local_binding`, `protos`, `server_name`, `buffered_data_for_node_net: Vec<u8>`, `bytes_written: u64`, `native_callback: NativeCallbacks{H2, None}`, `twin: JsCell<Option<IntrusiveRc<Self>>>` (upgradeTLS pair), `verify_error: Option<StoredVerifyError{code,reason}>` (survives detach, :291-294).

### Ref lifecycle
- `NewSocket::new` = `heap::into_raw(Box)`; intrusive refcount; owners: ext slot (+1 taken in `connect_finish` :1468 / `on_create` :619, consumed by `on_close`/`handle_connect_error`), JS wrapper's +1 (released by `finalize` :3182-3197), twin's IntrusiveRc, per-dispatch `ref_guard()`s.
- `this_value` state machine: empty → strong (`set_strong` in `get_this_value` :1545) → weak (`downgrade()` at `mark_inactive`/connect-error :1308-1310, 1188) → `Finalized` (GC ran; `get_this_value` then returns UNDEFINED — *"Creating a new one here would result in a second `finalize` (and double-deref) later."* :1531-1534).
- `Flags::FINALIZING` (:3963-3964: *"Prevent onClose from calling into JavaScript while we are finalizing"*) is set in `finalize` (:3188); on_data/on_timeout/on_close check it.
- `mark_active`/`mark_inactive` (:1229-1321): pairs `Handlers.active_connections` ++/--, upgrades/downgrades `this_value`, ref/unrefs `poll_ref`; `mark_inactive` closes a still-open socket first — verbatim: *"we have to close the socket before the socket context is closed otherwise we will get a segfault / uSockets will defer freeing the TCP socket until the next tick"* (:1294-1296).
- `exit_scope` (:1017-1023): a `Scope` (Handlers.rs:423-452) holds its own `Rc<Handlers>` + event-loop enter; on exit it settles `active_connections` and only drops the socket's `handlers` if the socket still points at the same `Rc` (reconnect/upgradeTLS may have repointed it).
- Detach semantics: `self.socket.set(DETACHED)` everywhere; a detached socket keeps `verify_error` (getAuthorizationError after close, :2197-2201) and `buffered_data` is freed.
- `Handlers` (Handlers.rs:37-67): shared `Rc` between listener and all accepted sockets, or one client socket and its reconnects/TLS twin; callbacks live in a GC-visited C++ cell `JSSocketHandlers` (13 callbacks + pending connect promise; JSSocketHandlers.rs:43-63) stored in each wrapper's visited `handlers` slot; `root_cell()` Strong bridges the window before the first wrapper exists (JSSocketHandlers.rs:99-106). `Handlers.listener` is a nullable raw ptr cleared by `Listener::deinit` before free (Handlers.rs:56-66).
- Wrapped-socket unions: `InternalSocket::Pipe(*WindowsNamedPipe)` (Listener.rs:1184-1186, 1257-1259) and `InternalSocket::UpgradedDuplex(*UpgradedDuplex)` (socket_body.rs:42-44, 4091-4093) live in the same `socket` cell; `DuplexUpgradeContext` (socket_body.rs:4060-4337) is a self-referential heap struct dispatching `UpgradedDuplexHandlers` fn-pointers into the TLSSocket, with deferred `deinit_in_next_tick` via an `AnyTask`.

---

## 4. SocketKind values & dispatch

Used by this consumer: `BunSocketTcp`, `BunSocketTls`, `BunListenerTcp`, `BunListenerTls` (uws_dispatch.rs:43-48; socket_body.rs:570-572, 3494; Listener.rs:369-373, 631-634). Full table also carries HttpClient(+Tls), WsClientUpgrade(+Tls), WsClient(+Tls), Postgres/Mysql/Valkey(+Tls), SpawnIpc, plus per-group kinds Dynamic/UwsHttp(+Tls)/UwsWs(+Tls) and Invalid (panic). Kind dispatch: `#[repr(u8)]` dense discriminants, plain array indexed `kind as usize` (uws_dispatch.rs:33-36). Kind is **mutable per socket**: accept path restamps `BunListener* → BunSocket*` (Listener.rs:631), and `adopt_tls` is passed `SocketKind::BunSocketTls` for a socket that was `BunSocketTcp` (socket_body.rs:3494). Comment: *"`Invalid` is intentionally null so a missed `kind` stamp crashes here instead of dispatching into the wrong handler."* (uws_dispatch.rs:27-28).

---

## 5. Timeout usage

- `socket.set_timeout(seconds: c_uint)` — JS `socket.timeout(t)` (socket_body.rs:2147-2170; validates ≥0, no separate minutes API used).
- Accepted sockets default `set_timeout(120)` at create (Listener.rs:637).
- Idle timeout fires the vtable `on_timeout` → JS `timeout` callback; socket is not closed automatically (socket_body.rs:939-978).
- `on_long_timeout` slot exists in the dispatch table and trait (uws_dispatch.rs:163-164, uws_handlers.rs:85, 239) but is a **no-op for Bun sockets** (only HTTPClient/WSUpgrade forward it, both mapping to `handle_timeout`). No `set_timeout_minutes`/long-timeout arming appears in these files — the new API must still provide the slot for other consumers.

---

## 6. TLS specifics

- **Handshake callback**: vtable `on_handshake(s, ok, us_bun_verify_error_t)` (also passes the possibly-new `us_socket_t*` — `this.socket.set(s)` at socket_body.rs:1625). Sets `HANDSHAKE_COMPLETE`; client-side hostname check via `check_server_identity` against `server_name`/connect host unless `acts_as_tls_server()` (:1648-1678); stores an owned `StoredVerifyError` copy (:1682-1692) — *"Owned copy of the handshake verify error, so `getAuthorizationError()` keeps its verdict after detach (the live error borrows the `SSL`, and EPROTO reasons are stack-copied in uSockets)."* (:292-294).
- **reject_unauthorized flow**: policy resolved from `SSLConfig`/VM default (`resolve_reject_unauthorized`, SSLConfig.rs:264-273; server also from ctx verify-mode `FAIL_IF_NO_PEER_CERT`, socket_body.rs:4017-4023). On failure: `REJECTED` flag set *before* the callback so *"no write path can deliver application data to a peer that is about to be rejected — including the raw twin of an `upgradeTLS` pair, which shares the fd"* (:1702-1714); writes return -1 when REJECTED (:2383, 2399); then `reject_unauthorized_connection()` → `close_and_detach(CloseCode::FastShutdown)` (:1828-1834). `DEFERS_SERVER_IDENTITY` defers hostname-mismatch enforcement to node:tls JS (:1696-1700, 3983-3984).
- **get_verify_error**: live `socket.get_verify_error()` in `getAuthorizationError` (:2206), falling back to the stored copy when detached or error_no==0.
- **SNI, server side**: `ListenSocket.add_server_name/remove_server_name` (static tree; SNI tree `SSL_CTX_up_ref`s, caller frees its own ref — Listener.rs:710-716); `ListenSocket.on_server_name(cb)` registers `us_dispatch_server_name` (Listener.rs:518-521, 1797-1905). Callback contract (Listener.rs:1780-1791): runs FIRST for every ClientHello with servername; return SSL_CTX* → installed via `SSL_set_SSL_CTX` (caller takes own ref); null → static tree → default ctx; `*abort_handshake = 2` suspends handshake for async SNICallback, resumed via `handle.resumeSNI(...)` → `us_socket_sni_resolve(ctx_or_null, is_error)` (socket_body.rs:825-855); `*abort_handshake = 1` aborts. The callback also receives the in-flight `us_socket_t*` so JS gets a resume handle (Listener.rs:1847-1862).
- **SNI, client side**: `SSL_set_tlsext_host_name` at on_open (:1374-1396) and via `setServername` (tls_socket_functions.rs:303-347, errors "Already started." after init finished); `adopt_tls` takes an `sni: Option<&CStr>` argument (socket_body.rs:3482, 3496).
- **ALPN**: per-connection selector `select_alpn_callback` registered on the CTX but reading the socket via `SSL_get_ex_data(ssl, 0)` — *"`SSL_CTX_set_alpn_select_cb` registers on the listener-level `SSL_CTX`, so its `arg` is shared across every accepted connection — using it for a per-connection `*TLSSocket` is a UAF when handshakes overlap"* (socket_body.rs:73-77). Dynamic `ALPNCallback` JS handler runs **inside SSL_do_handshake**, requiring `us_internal_ssl_loop_state_save/restore` around JS: *"JS that writes to or destroys a different TLS socket on the same loop re-points the per-loop BIO routing state, and this handshake's next flight would land on that other socket's fd."* (:141-150). Client ALPN via `SSL_set_alpn_protos` (:1434-1440); `getALPNProtocol` via `SSL_get0_alpn_selected` (tls_socket_functions.rs:1085-1111).
- **start_tls / upgradeTLS**: `upgrade_tls_impl` (socket_body.rs:3279-3628) — requires `InternalSocket::Connected`; builds/borrows an `SSL_CTX` (SecureContext `borrow()` +1 or per-VM `SSLContextCache.get_or_create`); `adopt_tls` into the per-VM TLS connect group with kind `BunSocketTls`; produces `[raw, tls]` twins over one fd: `tls` owns dispatch, `raw` has `BYPASS_TLS|IS_ACTIVE` and receives ciphertext via the `ssl_raw_tap` bit; original TCP wrapper is retired, its `Handlers` transferred to the raw twin (:3521-3549); then `on_open`, `start_tls_handshake()`, `resume()`, `tls_feed(initialData)` (:3610-3622). Duplex path `js_upgrade_duplex_to_tls` (:4361-4631) drives an `UpgradedDuplex` (JS stream-backed TLS engine, no fd, must not hold the loop open :4616-4622). `js_upgrade_tls_deferred` (:4345-4359) is node:tls' entry setting `DEFERS_SERVER_IDENTITY`.
- **Session/ticket**: `us_dispatch_session` deferred-delivery (uws_dispatch.rs:224-252); `getSession`/`setSession` via `i2d/d2i_SSL_SESSION` + `SSL_set_session` (tls_socket_functions.rs:1113-1194); `getTLSTicket` via `SSL_SESSION_get0_ticket` (:1196-1224); `isSessionReused` (:1256-1267). `EMPTY_PACKET_PENDING` mimics Node's `SSL_write(0)` after handshake (socket_body.rs:2554-2571, 2869-2882).
- **Renegotiation**: `SSL_renegotiate` / `SSL_set_renegotiate_mode(never)` (tls_socket_functions.rs:1226-1254); client `open` callback cleared after first handshake so renegotiations don't re-fire it (socket_body.rs:1756-1762); `client_renegotiation_limit/window` flow through SSLConfig (SSLConfig.rs:232-233).
- **Keylog**: `us_dispatch_keylog` → JS `keylog` handler.
- **Other per-SSL ops** (tls_socket_functions.rs): peer/local cert (+issuer-chain walk through the trust store incl. `us_get_shared_default_ca_store`, :539-612), cipher, TLS version, finished messages, shared sigalgs, export keying material, `setMaxSendFragment`, `setVerifyMode` (`SSL_set_verify` with always-allow cb, :1269-1329), `setKeyCert` (`SSL_set_SSL_CTX` + direct `SSL_use_certificate/PrivateKey/set1_chain`, :868-912), ephemeral key info.

---

## 7. Unusual lifecycle requirements

- **Re-entrant close/reconnect during callbacks**: every JS-facing handler takes `ThisPtr`, not `&mut` (socket_body.rs:873-879 verbatim: *"A live `&mut self` across that call is aliasing UB and lets LLVM cache those fields and dead-store the re-entrant write."*). `CloseTeardown` / `ConnectErrorTeardown` / `ScopeExit` guards settle state against the `Handlers` captured at entry because a callback may synchronously reconnect onto fresh `Handlers` (:317-409, 1066-1075).
- **Deferred deinit**: uSockets is relied on to *"defer freeing the TCP socket until the next tick"* (:1294-1296); duplex context deinits via next-tick task (:4298-4301); `on_close` transfers the ext's +1 into the dispatch (BunListener comment uws_handlers.rs:553-556: *"The `on_*` handlers may free it, so they take `ThisPtr`, never `&mut`."*).
- **SEMI_SOCKET rules** (connected but pre-open/pre-handshake): `us_socket_close` on a SEMI_SOCKET dispatches **no** terminal callback — JS `close()`/`terminate()` must manually balance the connect-time `ref_()`, downgrade `this_value`, and unref poll_ref (socket_body.rs:3030-3078, 2990-3009). `is_semi_connect = socket.socket.get().is_some() && !socket.is_established()`.
- **Connect error before open**: `Connecting` arm dispatches `on_connecting_error` synchronously inside `close()` (socket_body.rs:3048-3051); handler must tolerate ext-not-yet-set (uws_handlers.rs:107-112); close-before-notify ordering (§2); DNS failures carry the raw getaddrinfo code via `dns_error()` and map to `getaddrinfo ENOTFOUND host` (socket_body.rs:1084-1099); errno whitelist for unix/bind errors else ECONNREFUSED (:1100-1145; Listener.rs:1496-1526).
- **Open callback closes socket**: `on_open` holds a `ref_guard`, checks `is_closed()` after the callback, and `mark_inactive()` on error result (:1484-1497). Accept path fires user `open` in the same dispatch tick as accept (uws_handlers.rs:536-546).
- **Pause/resume**: `pause_stream()`/`resume_stream()` with `IS_PAUSED` flag; **must not** pause the shared fd through the BYPASS_TLS raw twin — *"Pausing the shared fd here would wedge the TLS read path (#15438)"* (socket_body.rs:686-696).
- **fd-passing**: `on_fd` vtable slot exists and is dispatched (`us_dispatch_fd`); consumed only by `SpawnIPC` (uws_handlers.rs:871-874). No `write_fd` call in these files (lives in the IPC crate) — but the socket API must support fd receive on AF_UNIX.
- **sendfile**: no `mark_needs_more_for_sendfile` usage in these files (that's the HTTP server consumer).
- **Adopt**: `adopt_tls(group, kind, ctx, sni, is_client, ext_sizes)` is the only group-adoption used here (upgradeTLS); accepted sockets change kind in place instead of adopting.
- **End-of-life detach**: JS wrapper can outlive the native socket indefinitely — `socket.set(DETACHED)`; all getters/methods early-return on `is_detached()`; `verify_error` intentionally survives (:2197-2201).
- **GC finalize vs live socket**: `finalize` sets FINALIZING and `close_and_detach(Failure)` if not closed (:3182-3197); `deinit_and_destroy` runs at refcount 0, frees owned SSL_CTX, protos (`OWNED_PROTOS` gate — accepted sockets clone the listener's protos and own their clone; flag distinguishes reused boxes), server_name, connection (:3145-3180).
- **Reconnect on a live wrapper** (`detach_for_reconnect`, :1256-1290): nulls ext before close so *"the synchronous `on_close` / `on_connecting_error` dispatch early-returns and no JS callback fires."*
- **upgradeTLS raw twin never gets its own dispatch**: its close is chained from the tls half's `on_close` (:1968-1977); it writes via `raw_write` bypassing SSL, reads via the `ssl_raw_tap`.
- **Loop-state save/restore** around any JS run from inside `SSL_do_handshake` (ALPN callback, socket_body.rs:146-166) — a Rust rewrite of the SSL loop must expose an equivalent snapshot of per-loop BIO routing state (`us_internal_ssl_loop_state_save/restore`, tls_socket_functions.rs:182-183).
- **write fatal-error discipline**: `write_check_error` must report EPIPE/ECONNRESET-class failures distinct from would-block, and the consumer must **not** close synchronously from inside the write (socket_body.rs:2416-2432, 2917-2937).
- **on_open for `from_fd`** is invoked by the consumer itself, synchronously (socket_body.rs:661) — the group `from_fd` API must not also dispatch open.

---

## 8. Listener.rs lifecycle

- Listen: allocate `Listener` at final address first (embedded `SocketGroup` is linked into the loop's intrusive list; comment Listener.rs:293-295, 63-67 of mod notes), `group.init(Loop::get(), None, *Listener)`, optional `create_ssl_context`, then `group.listen`/`listen_unix` with flags; errno out-param mapped to JS error with syscall/address/port/code (Listener.rs:441-484; ENAMETOOLONG→EINVAL :455-459). Ephemeral port read back from `ListenSocket.get_local_port()` (:408-411).
- Flags: `exclusive` → `LIBUS_LISTEN_EXCLUSIVE_PORT`, `reusePort` → `LIBUS_LISTEN_REUSE_PORT|REUSE_ADDR`, `allowHalfOpen` → `LIBUS_SOCKET_ALLOW_HALF_OPEN`, `ipv6Only` → `LIBUS_SOCKET_IPV6_ONLY` (Handlers.rs:472-488).
- Keepalive: `poll_ref.ref_()` while listening (:536); `ref()`/`unref()` JS methods (:913-940) — `unref` only downgrades `this_value` when `active_connections == 0`.
- stop/dispose (`do_stop`, :759-793): replace `ListenerType::None` first; unlink unix socket path **before** close (*"Unlinking after close would race with another process creating a socket at the same path"*, :821-833; abstract-namespace paths starting with NUL are skipped :828-830); if no connections → unref + downgrade; `force_close` → `group.close_all()`; then `ListenSocket.close()`. Non-force stop leaves accepted sockets running; the last socket's `mark_inactive` releases the listener's poll_ref/this_value when `listener.listener == None` (Handlers.rs:266-275).
- finalize/deinit (:795-865): clears `handlers.set_listener(None)` **before** `close_all()` so accepted sockets' on_close can't double-release (:844-849); `SocketGroup::destroy`, `SSL_CTX_free(secure_ctx)`; ASAN root-region register/unregister for the embedded group (:334-337, 851-854).
- Listen SSL: one `SSL_CTX` per listener (`secure_ctx`, one owned ref, :85-88 — *"`SSL_new()` per-accept takes its own ref, so accepted sockets outlive a stopped listener safely"*); default cert optionally registered in the SNI tree under its own servername (:497-509).
- `getsockname` via `ListenSocket.get_local_address/get_local_port` (:1339-1397); `fd` getter via `ListenSocket.socket().fd()` (:896-911).
- Windows named-pipe listener is a parallel libuv path (`WindowsNamedPipeListeningContext`, :1590-1778) — not uSockets.
- Connect path (`connect_inner`/`connect_finish`, :944-1545): client Handlers; SecureContext borrow or `SSLContextCache.get_or_create`; optional wrapper reuse for node:net reconnect (`detach_for_reconnect`, handlers swap, protos/server_name/ctx replacement :1415-1444); promise stored in the handlers cell; `ref_pollref_on_connect` honors pre-connect `unref()` (:1536-1542).

---

## 9. SSLConfig.rs → SSL_CTX

- Canonical struct is `bun_http::ssl_config::SSLConfig` (C-string field layout, freed with `free_sensitive`); this file only adds JS parsing (`SSLConfigFromJs::from_js/from_generated`, SSLConfig.rs:139-242): key/cert/ca as string|Buffer|BunFile|arrays (read via node_fs, NUL-terminated), keyFile/certFile/caFile paths (existence-probed :279-297), passphrase, dhParamsFile, serverName, ALPNProtocols (string|Buffer), ciphers, secureOptions, ssl_min/max_version, lowMemoryMode, requestCert, rejectUnauthorized (default from `vm.get_tls_reject_unauthorized()`), client_renegotiation_limit/window. Returns `None` if all defaults ("tls not really configured").
- CTX creation goes through **us_* C code**: `ssl_cfg.as_usockets().create_ssl_context(&mut create_bun_socket_error_t)` (Listener.rs:358-367, 1720-1724) — i.e. `us_ssl_ctx_from_options`; error enum covers CA/cipher failures, everything else lands on the BoringSSL error queue (uws_jsc.rs:44-52). `us_ssl_ctx_from_options` sets `SSL_VERIFY_PEER|FAIL_IF_NO_PEER_CERT` iff rejectUnauthorized (socket_body.rs:4014-4023).
- Per-group vs per-connection: **listener** = one CTX per listen group (passed to `group.listen`); **client** = per-socket `owned_ssl_ctx` passed to `group.connect(kind, ssl_ctx, ...)` and to `adopt_tls`, with the per-VM weak `SSLContextCache.get_or_create(cfg)` deduplicating identical configs (Listener.rs:1268-1290 — servername/ALPN excluded from the digest *"because they're applied per-SSL, not per-CTX"*); `SecureContext.borrow()` (`SSL_CTX_up_ref`) shares a prebuilt CTX. SNI contexts are additional per-hostname CTXs held (up-ref'd) by the C SNI tree on the listen socket.
- `resolve_reject_unauthorized` / `tls_true_defaults` (:256-273).

---

## Migration notes — what a new Socket/Ctx/Listener API must provide

**Socket (per-connection handle):**
1. A tri/quad-state handle distinguishing Detached / Connecting / Connected / wrapped (Pipe, UpgradedDuplex) — the consumer stores it by value and swaps Connecting→Connected inside `on_open`/`on_data`/`on_handshake`.
2. State predicates: `is_detached`, `is_closed`, `is_established`, `is_shutdown` (readyState mapping -1/0/1/-2/2).
3. Writes: plain `write`, `write_check_error` (would-block vs fatal EPIPE/ECONNRESET distinction, no internal close on fatal), two-buffer `write2`/writev fast path, vectored raw `raw_writev`, `raw_write` bypassing TLS on a TLS socket, `flush`.
4. `close(code)` with three semantics: Normal (TLS defers for close_notify), Failure (SO_LINGER{1,0} RST), FastShutdown (send close_notify once, close fd synchronously); close of a SEMI_SOCKET must dispatch **no** callbacks; close of a Connecting socket dispatches `on_connecting_error` synchronously.
5. `shutdown` (write side) and `shutdown_read`.
6. `pause_stream`/`resume_stream` returning success bools; `resume()` to re-arm read interest post-adopt.
7. Socket options: keepalive(+initial delay), nodelay, TOS get/set, local/remote address(binary 4/16 bytes)+port, `fd()` accessor.
8. Per-socket ext slot ≥ pointer-size, calloc'd (readable-as-null before init), stable across the socket's life, shared between ConnectingSocket and its promoted us_socket_t handoff, and mutable by the consumer (nulled for silent detach).
9. Mutable per-socket `kind` tag (restamp on accept and on adopt_tls); kind→static-vtable dispatch with a poison/Invalid kind that traps.
10. Timeouts: per-socket idle `set_timeout(seconds)` firing `on_timeout` repeatedly without closing; a `long_timeout` channel kept for other consumers.
11. `on_connect_error` must be deliverable for both Connected-but-failed sockets and ConnectingSockets (separate slot, `ConnectingSocket*` receiver), carry errno, and expose the raw getaddrinfo code (`dns_error`). Dispatch order guarantee: consumer closes the socket before notifying (support re-entrant connect from the callback without poll-registration hangs).
12. `on_fd(fd)` event + AF_UNIX fd-passing receive for the IPC consumer.
13. Deferred socket free: after `close`, the `us_socket_t` memory must remain valid until at least the next loop tick (consumer reads ext/kind post-close and relies on chained dispatch).
14. Event callbacks receive the (possibly re-allocated) socket pointer as an argument and must tolerate consumer callbacks freeing the ext owner, closing the socket, re-connecting, or transferring ownership mid-dispatch (no `&mut`-style aliasing assumptions).

**TLS:**
15. Per-socket `SSL*` accessor; TLS group connect/adopt takes an `SSL_CTX*` argument per connection (no per-group CTX requirement for clients), plus optional SNI name.
16. `on_handshake(ok, verify_error{error_no, code, reason})` slot; `get_verify_error()` on demand; verify error strings must be copyable (stack/SSL-borrowed lifetime).
17. `adopt_tls(existing TCP socket → TLS socket in another group, is_client flag, new ext sizes)` preserving the fd; `start_tls_handshake()`; `tls_feed(bytes)` for pre-consumed wire data; a per-socket `ssl_raw_tap` ciphertext tap delivering pre-decryption bytes to a second observer.
18. Deferred delivery channels for new-session and keylog data (dispatch only after the SSL call stack unwinds, so JS may destroy the socket).
19. SNI resolution: listen-socket static SNI tree (`add_server_name`/`remove_server_name`, up-refs ctx), an early select-cert callback hook (`on_server_name`) that can return a ctx, fall through, abort (=1), or suspend (=2), and `sni_resolve(ctx, is_error)` to resume a suspended handshake.
20. Save/restore of per-loop TLS BIO routing state around JS run from inside a handshake (ALPN/SNI callbacks).
21. Verify-mode plumbing: consumer sets `SSL_set_verify` with an always-allow callback and enforces policy itself post-handshake; server ctx built with FAIL_IF_NO_PEER_CERT iff rejectUnauthorized so policy can be recovered from a bare ctx.
22. `create_ssl_context(options) -> (SSL_CTX*, error enum)` equivalent (us_ssl_ctx_from_options semantics: BoringSSL error queue for cert/key/DH failures, enum for CA/ciphers), and a shared default root CA store accessor (`us_get_shared_default_ca_store`).

**Group (context):**
23. `init(loop, vtable?, owner_ext)` with owner recoverable from any member socket (`socket.group().owner()`), `destroy`, `close_all()` (force-close every member, dispatching on_close), embedded/intrusive membership list with stable group address.
24. `connect(kind, ssl_ctx, host, port, local_bind(addr,port), flags, ext_size)` returning Failed | Socket (immediate, e.g. unix/fd) | Connecting (async DNS/happy-eyeballs); `connect_unix`; `from_fd(kind, ssl_ctx, ext_size, fd, dispatch_open=false)` that does **not** self-dispatch open.
25. Connect flags: ALLOW_HALF_OPEN at socket level.

**Listener:**
26. `listen(kind, ssl_ctx, host, port, flags, ext_size, &mut errno)` / `listen_unix(path incl. abstract-namespace NUL-prefixed, ...)` returning a ListenSocket with `close()`, `get_local_port()` (ephemeral readback), `get_local_address()`, underlying `socket()`/fd.
27. Listen flags: EXCLUSIVE_PORT, REUSE_PORT+REUSE_ADDR, IPV6_ONLY, ALLOW_HALF_OPEN; errno out-param for JS error shaping (EADDRINUSE etc., ENAMETOOLONG distinguishable).
28. Accept dispatch: `on_open` for accepted sockets with uninitialized ext, owner via group ext; ability for consumer to restamp kind and fill ext during that first dispatch; listener close while connections remain open must leave accepted sockets fully functional (per-accept SSL holds its own CTX ref).
29. Loop keepalive is external (KeepAlive/poll_ref) — the socket layer itself must not pin the event loop beyond live polls; a duplex-backed TLS socket must be able to exist with **no** loop presence at all.

**Error/close code contract:**
30. `on_close(code, reason)` where code is overloaded: 0/1/2 = self-initiated CloseCode, >2 = real read/poll errno (recv/SO_ERROR), and the producer guarantees EPERM(1)/ENOENT(2) can never appear as errnos.
