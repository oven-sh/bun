# Consumer-Requirements Inventory: WebSocket Client on the uSockets Core

Files (all under `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU/`):
- `src/http_jsc/websocket_client.rs` (framed phase, `WebSocket<const SSL: bool>`) — "WSC" below
- `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs` (`HTTPClient<const SSL: bool>`) — "UPG"
- `src/http_jsc/websocket_client/WebSocketProxyTunnel.rs` — "TUN"
- `src/http_jsc/websocket_client/WebSocketProxy.rs` — "PRX"
- `src/http_jsc/websocket_client/CppWebSocket.rs` — "CPP"
- `src/http_jsc/websocket_client/WebSocketDeflate.rs` — "DEF"

Supporting infra: `src/runtime/socket/uws_dispatch.rs`, `src/runtime/socket/uws_handlers.rs`, `src/jsc/rare_data.rs`, `src/uws_sys/socket.rs`, `src/uws_sys/SocketKind.rs`, `src/jsc/bindings/webcore/WebSocket.cpp`.

---

## 1. Two phases and the socket transition

### Phase A — Upgrade (`HTTPClient<SSL>`, UPG)
- Entry: C++ `WebCore::WebSocket` calls `Bun__WebSocketHTTPClient__connect` / `Bun__WebSocketHTTPSClient__connect` (UPG:2243-2254) → `HTTPClient::connect` (UPG:202).
- Socket creation: `Socket::<SSL>::connect_group(group, kind, secure_ptr, host, port, client, false)` (UPG:516) or `connect_unix_group` for `ws+unix://` (UPG:466). The **kind stamp** is `SocketKind::WsClientUpgrade` / `WsClientUpgradeTls` (UPG:401-405).
- The old "register handlers on a shared `us_socket_context_t`" model is gone; per the comment at UPG:158-169: *"sockets are stamped with the kind at connect time and routed via the `RawSocketEvents<SSL>` impl in `bun_runtime::socket::uws_handlers`, which forwards to the `pub handle_*` methods below."*
- State machine: `State { Initializing, Reading, Failed, ProxyHandshake, ProxyTlsHandshake, Done }` (UPG:77-88).

### Phase transition (101 received) — **socket adoption + ext-data swap + vtable-by-kind swap**
- On a valid 101 (`process_response`, UPG:1272-1694): non-tunnel path detaches `tcp` from the upgrade client (UPG:1653), then hands the raw `us_socket_t*` (`InternalSocket::Connected(native_socket)`, UPG:1654) across FFI to C++ `WebSocket__didConnect` (CPP:32-39, called at UPG:1656-1670), which calls back into Rust `Bun__WebSocketClient__init` / `...TLS__init` (WSC:1604).
- `WebSocket::<SSL>::init` (WSC:1604-1653) re-adopts the same `us_socket_t` into a **different SocketGroup and kind** via `Socket::<SSL>::adopt_group(tcp, group, DispatchKind::WsClient[Tls], ws, closure)` (WSC:1632-1645). `adopt_group` = `us_socket_adopt(s, group, kind, old_ext_size, ext_size)` + rewrite of the ext slot to the new owner pointer (`src/uws_sys/socket.rs:849-882` — *"Move an open socket into a new group/kind, stashing `owner` in the ext. Replaces `Socket.adoptPtr`."*).
- Dispatch is switched by the kind stamp: `src/runtime/socket/uws_dispatch.rs:55-60` maps `WsClientUpgrade[Tls]` → `vtable::make::<handlers::WSUpgrade<SSL>>()` and `WsClient[Tls]` → `vtable::make::<handlers::WSClient<SSL>>()`. So the "vtable swap" is implicit: one static `.rodata` vtable per kind, selected by `s->kind` at every event (`vt()` at uws_dispatch.rs:80-100). This is the ONLY place that knows kind→handler mapping (uws_dispatch.rs:6-8).
- **Ext layout**: both phases store `Option<ThisPtr<Owner>>` / `Option<NonNull<Owner>>` (one word) in the ext (`RawPtrHandler::Ext = Option<ThisPtr<T>>`, uws_handlers.rs:257; `adopt_group` uses `size_of::<*mut c_void>()` for both old and new ext sizes, socket.rs:862-864).
- Tunnel path (`wss://` via proxy): NO adoption. The upgrade client **stays alive in `State::Done`** and forwards raw socket bytes to the tunnel forever (UPG:1574-1624, comment at 1576-1578: "For tunnel mode, the upgrade client STAYS ALIVE to forward socket data to the tunnel"). The framed client is created via `WebSocket__didConnectWithTunnel` → `Bun__WebSocketClient__initWithTunnel` (WSC:1658, always `WebSocket<false>` — TUN:112 `type WebSocketClient = WebSocket<false>`), and C++ then calls `WebSocketProxyTunnel__setConnectedWebSocket` (TUN:621-628; WebSocket.cpp:1892) which flips the tunnel from upgrade phase to connected phase (`set_connected_web_socket` clears `upgrade_client`, TUN:430-435).

### SocketGroups / SocketKinds and ownership
- Four groups, all **per-VM**, embedded as fields in `RareData` (`src/jsc/rare_data.rs:245-247, 320-322`): `ws_upgrade_group_`, `ws_upgrade_tls_group`, `ws_client_group_`, `ws_client_tls_group`. Accessors `RareData::ws_upgrade_group::<SSL>` (rare_data.rs:822) and `ws_client_group::<SSL>` (rare_data.rs:832), lazy-initialized on the VM's uws loop with **no per-group SSL ctx** (`lazy_group` → `g.init(vm.uws_loop(), None, null)`, rare_data.rs:766-771).
- Teardown: `RareData::close_all_socket_groups` must run **before** JSC teardown (rare_data.rs:845-870): closeAll fires on_close → JS callbacks → needs a live VM; it loops because handlers can re-populate groups.
- SocketKinds: `WsClientUpgrade`=8, `WsClientUpgradeTls`=9, `WsClient`=10 (implied), `WsClientTls`=11 (`src/uws_sys/SocketKind.rs:42-45, 82-85`).

---

## 2. Vtable slots and us_socket_* calls per phase

### Upgrade phase — `RawSocketEvents<SSL> for NewHttpUpgradeClient<SSL>` (uws_handlers.rs:330-365)
Every slot implemented: `on_open`→`handle_open` (UPG:796), `on_data`→`handle_data` (UPG:852), `on_writable`→`handle_writable` (UPG:1705), `on_close`→`handle_close` (UPG:698), `on_timeout`/`on_long_timeout`→`handle_timeout` (UPG:1768), `on_end`→`handle_end` (UPG:1261), `on_connect_error`→`handle_connect_error` (UPG:1779), `on_handshake`→`handle_handshake` (UPG:721).

us_socket_* usage:
- **write**: `socket.write(&me.input_body_buf)` in `handle_open` (UPG:834) and `handle_proxy_response` (UPG:1058); partial-write remainder tracked as `to_send_len` suffix (UPG:841, 194-197) and retried in `handle_writable` (UPG:1753). Tunnel path writes via `WebSocketProxyTunnel::write` instead (UPG:1184, 1728).
- **timeout**: `tcp.timeout(120)` after connect (UPG:501, 549); `tcp.timeout(0)` on successful upgrade before handoff (UPG:1585, 1643).
- **close**: `cancel` — TLS: `tcp.close(CloseCode::Normal)` ("we still wanna to send pending SSL buffer + close_notify", UPG:641-645), non-TLS: `CloseCode::Failure`. `fail` closes with `Normal` — key comment UPG:672-676: a failed upgrade is "an application-level rejection of a healthy TCP connection — close it gracefully (FIN)… A Failure close arms SO_LINGER{1,0} and sends an RST". `handle_data` with no outgoing websocket → `socket.close(Failure)` (UPG:879).
- **shutdown / pause / resume**: not used in upgrade phase. `debug_assert!(!socket.is_shutdown())` in handle_data (UPG:889).
- **native handle**: `socket.get_native_handle()` → `SSL*` for SNI/ALPN (`configure_http_client_with_alpn`, UPG:807-825) and for post-handshake verification (UPG:754).

### Framed phase — `RawSocketEvents<SSL> for WebSocket<SSL>` (uws_handlers.rs:367-411)
No `on_open` ("adoption of an already-connected socket", uws_handlers.rs:368). Slots: `on_data`→`handle_data` (WSC:553), `on_writable`→`handle_writable` (WSC:1266), `on_close`→`handle_close` (WSC:312), `on_timeout`/`on_long_timeout`→`handle_timeout` (WSC:1274), `on_end`→`handle_end` (WSC:1255), `on_connect_error`→`handle_connect_error` (WSC:1278), `on_handshake`→`handle_handshake` (WSC:255 — re-verifies server identity if the TLS handshake completes only after adoption). Note the dispatcher wraps each with `this.ref_guard()` (uws_handlers.rs:372-410).

us_socket_* usage:
- **write**: `self.tcp.get().write(bytes)` fast path in `enqueue_encoded_bytes` (WSC:932, with the explicit "Do not set MSG_MORE, see oven-sh/bun#4010" comment at WSC:931) and in `send_buffer_out` (WSC:1091). Negative return → `terminate(FailedToWrite)`; short write → tail copied into `send_buffer`.
- **backpressure**: `has_backpressure()` = `send_buffer.readable_length() > 0` or tunnel's `write_buffer` non-empty (WSC:1283-1292). Controls fast-path inline stack framing (`send_frame`, WSC:1294-1303; frames < `STACK_FRAME_SIZE`=1024 bypass the heap queue).
- **shutdown**: `shutdown_after_close_frame` (WSC:1220-1225) does `tcp.shutdown_read()` + `tcp.shutdown()`, **only for `!SSL && no tunnel`**. Load-bearing comment WSC:1214-1219: "SHUT_RD + SHUT_WR after the close frame is in the kernel send buffer. Marks the socket shut-down so loop.c takes the CLEAN_SHUTDOWN branch on the subsequent EOF instead of dispatching `on_end → terminate → fail → cancel → close(Failure)`, which would RST and discard the queued close frame. SSL is excluded because the SSL handshake can happen during writes; tunnel mode operates on a detached socket." Also WSC:1164-1168: "SHUT_RD on Linux makes the socket immediately readable (recv → 0)".
- **close**: `cancel` — TLS: `close(CloseKind::Normal)`, else `close(CloseKind::Failure)` (WSC:223-228); `finalize` same policy if `!is_closed()` (WSC:1752-1759).
- **timeout**: none set in framed phase (upgrade already zeroed it); `handle_timeout` → `terminate(Timeout)` (WSC:1274-1276).
- **state queries**: `is_closed()`, `is_shutdown()`, `is_established()` in `has_tcp` (WSC:1349-1356) and `debug_assert_socket_writable` (WSC:1059-1067); socket identity via `socket.socket == self.tcp.get().socket` (WSC:1247-1249).
- **pause/resume**: not used anywhere in either phase.
- **detach**: `tcp.detach()` (WSC:306-310) — required so `close()` becomes a no-op after handoff/teardown.

### RawPtrHandler contract (uws_handlers.rs:222-333)
- Ext slot is `Option<ThisPtr<T>>`; every slot no-ops if the ext is `None` (this is the abort mechanism for cancel-mid-connect, see §5).
- `on_connect_error` **closes the socket first, then notifies** (uws_handlers.rs:306-314) because SEMI_SOCKET close skips dispatch.
- `on_connecting_error` reads the ext off the `ConnectingSocket` (uws_handlers.rs:316-321) — the Rust rewrite must support the ext on the in-flight connecting handle too.
- All handlers take `ThisPtr<Self>` not `&mut self` — "a `&mut` argument protector outliving the allocation is UB" (uws_handlers.rs:222-228; UPG:165-169).

---

## 3. Where the socket ref is stored; thread affinity; detach on close

- **Rust side**: upgrade phase — `HTTPClient.tcp: SocketHandler<SSL>` (UPG:120); framed phase — `WebSocket.tcp: Cell<Socket<SSL>>` (WSC:71). The `us_socket_t` ext slot back-points at the Rust struct (one-word `Option<NonNull<Self>>`).
- **C++/JS side**: the JS `WebSocket` wrapper (`WebCore::WebSocket`, WebSocket.cpp) holds **opaque pointers to the Rust structs, never the socket**: `m_upgradeClient` (WebSocket.cpp:203-204, 716, 728) during upgrade, and `m_connectedWebSocket.client / .clientSSL` + `m_connectedWebSocketKind` after (WebSocket.cpp:214-224, 866-899). Sends from JS go through the exported writers (`Bun__WebSocketClient__writeBinaryData/writeString/writeBlob`, WSC:1920-1943).
- **Refcount ledger (framed WebSocket)**: intrusive `Cell<u32>` refcount (`#[derive(bun_ptr::CellRefCounted)]`, WSC:66-67). Ref #1 = I/O layer (adopted socket or tunnel), released by `handle_close` (WSC:322-325, 333-336 "this is the terminal release of the socket's I/O-layer ref") or, in tunnel mode, by `clear_data` (WSC:194-203). Ref #2 = C++ side, taken in `finish_init` (WSC:1598-1599 "ref the new websocket since C++ has a reference to it"), released by `dispatch_abrupt_close`/`dispatch_close`/`finalize` (WSC:1444-1465, 1747-1750). Same two-ref shape on the upgrade client (`+1 for cpp_websocket`, UPG:504, 552; socket ref released in `handle_close`/`handle_connect_error`/`process_response` — UPG:709, 1793, 1680-1683).
- **Pending-activity / GC**: the Rust side pins the C++ object with `WebSocket__incrementPendingActivity`/`decrementPendingActivity` via `CppWebSocketRef` RAII (CPP:178-219), e.g. held by `InitialDataHandler.ws` so the JS object survives until the buffered-data microtask runs (WSC:1578-1583).
- **Event-loop keep-alive**: `poll_ref: KeepAlive` ref'd at connect (UPG:379) / init (WSC:1557-1560), unref'd in `clear_data` (WSC:157-165; UPG:571).
- **Thread affinity**: strictly JS-thread. `vm_loop_ctx` requires "the live per-thread VM singleton" (UPG:60-66; WSC:139-149); `CppWebSocket` methods call `VirtualMachine::get().event_loop_mut().enter()/exit()` around every C++ callback (CPP:71-176); refcounts are non-atomic `Cell<u32>`; the mask entropy comes from per-VM `rare_data().entropy_slice` (WSC:2055-2058).
- **Detach on close**: framed — `detach_tcp()` in `handle_close`/`handle_connect_error` (WSC:319, 329, 1279); upgrade — `tcp.detach()` in `handle_close` (UPG:704), `handle_connect_error` (UPG:1781), `cancel` (UPG:649), and the handoff path (UPG:1653). `deinit` asserts `tcp.is_detached()` (UPG:187).

---

## 4. TLS (`wss://`)

- **Group ctx vs custom**: the group has no SSL ctx (rare_data.rs:768: `g.init(vm.uws_loop(), None, null)`). Per-connect ctx is passed as `secure_ptr` to `connect_group`. Default path: VM-wide shared client ctx via `RuntimeHooks::default_client_ssl_ctx` (UPG:453). Custom CA (`config.requires_custom_request_ctx`): `ssl_ctx_cache_get_or_create` — "Per-VM weak cache: every `new WebSocket(wss://, {tls:{ca}})` with the same CA shares one CTX with each other and with any `Bun.connect`/Postgres/etc." (UPG:418-432). Fail-closed on ctx creation failure — UPG:434-439: "Do NOT fall through to the default trust store — the user passed an explicit CA/cert and BoringSSL rejected it."
- **Custom-ctx lifetime crosses the phase boundary**: `SslCtxOwned` RAII (+1 `SSL_CTX_free`-on-drop, UPG:90-109); on upgrade success ownership transfers to the framed `WebSocket.secure` (UPG:1627-1634, 1668; WSC:113-117: "The socket's `SSL*` references the `SSL_CTX` inside, so this must outlive the connection") and is freed by `clear_data` (WSC:176-179).
- **Verify error → JS error**: `handle_handshake` (UPG:721-793). `reject_unauthorized` is asked from C++ (`WebSocket__rejectUnauthorized`, CPP:60). Errors map to `fail(this, ErrorCode::TlsHandshakeFailed)` → `WebSocket__didAbruptClose` → JS `error`/`close` events. When `reject_unauthorized == false` all SSL errors are accepted (UPG:788-790 mentions NODE_EXTRA_CA_CERTS rationale). Framed-phase `handle_handshake` (WSC:255-304) repeats the check for handshakes that finish after adoption, incl. null-SSL-handle fail-closed (WSC:284-287).
- **Hostname verification** is manual: `boringssl::check_server_identity(ssl, hostname)` against `self.hostname` or `SSL_get_servername` (UPG:768-785; WSC:289-303; TUN:374-387).
- **SNI**: stored as NUL-terminated `ZBox` hostname. Set in `handle_open` via `configure_http_client_with_alpn(ssl, hostname, AlpnOffer::H1)`, skipping IP addresses (UPG:805-827). SNI uses the **dialed** host: "For HTTPS proxy connections, that's the proxy host, not the wss:// target" (UPG:541-547); unix path caveat at UPG:489-499 ("A user-supplied Host header does NOT affect SNI").
- **Proxy tunnel = TLS-in-TLS via SSLWrapper**: `WebSocketProxyTunnel` wraps `SslWrapper<*mut WebSocketProxyTunnel>` (TUN:143) with callbacks `on_open`/`on_data`/`on_handshake`/`on_close`/`write_encrypted` (TUN:205-223). `write_encrypted` writes ciphertext to the (possibly itself-TLS) proxy socket held as `MaybeAnySocket` (`SocketUnion`, TUN:124, 141), buffering into `StreamBuffer` on backpressure to "maintain TLS record ordering" (TUN:452-489). Inner SNI+ALPN set in `start()` before driving the wrapper (TUN:246-266); inner hostname verification in `on_handshake` using the `ssl` snapshot (TUN:361-388). The inner handshake defers verification (`for_client_verification()`; SSLConfig default `reject_unauthorized = 0; request_cert = 1` "We verify manually", UPG:1110-1119). `on_session`/`on_keylog` intentionally `None` (TUN:218-221).

---

## 5. Unusual lifecycle cases (UAF-discipline comments quoted verbatim)

### Cancel mid-connect (ConnectingSocket abort)
`HTTPClient::cancel` (UPG:604-654). Verbatim comment (UPG:627-635):

> "Clear the socket's ext slot before closing. `us_socket_close` on a SEMI_SOCKET (TCP connect still in flight — the common case when `ws.close()` is called synchronously after `new WebSocket()`) skips dispatch entirely, so we cannot rely on `handle_close` / `handle_connect_error` to release the socket-userdata ref taken in `connect()`. Take it back here and deref it ourselves; any callback that does fire sees `ext == None` and no-ops via the `RawPtrHandler` guard."

Requirements for a Rust core: (a) closing a half-open (connecting) socket must be legal and must *not* dispatch close; (b) ext must be readable/clearable on a connecting socket; (c) `connect_group` may synchronously dispatch `handle_connect_error` before returning (UPG:359-365, 459-462: "MUST NOT span any `Socket::connect_*_group` call below — those install `client` as socket userdata and may synchronously dispatch `handle_connect_error`"). `handle_connect_error` distinguishes state: `Reading` → terminate, else set `Failed` for the parent to observe (UPG:1773-1794).

### Re-entrant close from JS during on_data
Multiple defenses:
- `handle_data` takes `ThisPtr` + `ref_guard` (WSC:553-559; UPG:882-884: "Bumps the intrusive refcount and derefs on Drop at every return path below. No `&`/`&mut Self` is live when the guard drops.").
- WSC:206-217 (`cancel`): "clear_data() may drop the tunnel's I/O-layer ref; keep `*this_ptr` alive until we've finished closing the socket below. ScopedRef bumps the intrusive refcount now and derefs on Drop (after `this`'s last use, since `this` is declared after the guard)."
- WSC:1308-1313 (`write_binary_data`): "In tunnel mode, SSLWrapper.writeData() can synchronously fire onClose → ws.fail() → cancel() → clear_data() and free `this` before the catch block in enqueue_encoded_bytes/send_buffer runs."
- WSC:1470-1476 (`close`): "In tunnel mode, SSLWrapper.writeData() (via send_close_with_body → enqueue_encoded_bytes → tunnel.write) can synchronously fire onClose → ws.fail() → cancel() → clear_data() and free `this` before send_close_with_body's own clear_data/dispatch_close run."
- WSC:527-531 (`dispatch_buffered_message`): "Take the fifo first: `dispatch_*` can reach `clear_receive_buffers(true)` and free the readable slice." Similarly WSC:816: "Stack copy: the caller's dispatch/close path can reach `clear_data`, which mutates `ping_frame_bytes`." And WSC:1142-1144: "`enqueue_encoded_bytes` may call `terminate → clear_data`, which mutates `ping_frame_bytes`' bookkeeping; send the local copy."
- WSC:395: "Drop the deflate borrow: `dispatch_data` can re-enter `clear_data`."
- `close_received` gates further data (WSC:554-556) and writable events (WSC:1267-1269).
- `handle_close` with a mid-flush user close reports the user code, not 1006 — WSC:315-318: "The socket closed while our close frame was mid-flush; the peer either got it or didn't, but JS should still see the user-initiated code/reason (not an abrupt 1006)."
- Terminate-during-cancel of tunnel mode — WSC:230-236: "In tunnel mode tcp is .detached so close() above is a no-op and handle_close() never fires. Mirror what handle_close() does… so e.g. ws.terminate() — which calls cancel() then sets m_connectedWebSocketKind = None, bypassing the destructor's finalize() — does not leak."

### Buffered handshake overflow bytes ("send before open" analogue / initial data)
Bytes pipelined after the 101 headers are handed off across FFI. Verbatim (UPG:1544-1552):

> "Ownership transfer: `overflow` is HANDED OFF across FFI — `WebSocket__didConnect` → `Bun__WebSocketClient__init`/`_initWithTunnel` adopts the raw `(ptr, len)` into an `InitialDataHandler` queued as a microtask, which reclaims it via `Box::<[u8]>::from_raw` when the microtask runs. Allocate as `Box<[u8]>` and `heap::alloc` it so the alloc/free pair through the SAME Rust global allocator (mimalloc). Do NOT keep a `Vec`/`Box` binding past the FFI call — it would drop at scope exit and leave the queued microtask with a dangling pointer (UAF on read in `handle_data`, then double-free on drop)."

`InitialDataHandler` (WSC:1949-1998) is drained **out of order** if fresh socket data arrives first: `handle_data` runs the pending handler before the new bytes (WSC:561-581, "Due to scheduling, it is possible for the websocket onData handler to run with additional data before the microtask queue is drained"); after re-entry it re-checks `outgoing_websocket`/`has_tcp` ("If we disconnected for any reason in the re-entrant case, we should just ignore the data", WSC:577). `deinit` handles the teardown race: nulls the handler's backref, and frees the box only if the VM is shutting down (the microtask can no longer run) (WSC:1770-1783). The handler holds a `CppWebSocketRef` pending-activity ref (WSC:1578-1583). Outbound sends before flush use `send_buffer` + `close_dispatch_pending` deferral (WSC:85-88, 1203-1210: "The close frame was only partially written… clear_data() would discard it (and the proxy_tunnel needed to flush it), so defer teardown until handle_writable drains the buffer or the socket dies").

### Deflate context lifetime
- Negotiated during upgrade (`Sec-WebSocket-Extensions` parse, UPG:1384-1473); params handed across FFI at `did_connect[_with_tunnel]` and a fresh `PerMessageDeflate` built in `new_raw` (WSC:1536-1538).
- Owned as `RefCell<Option<Box<WebSocketDeflate>>>` on the framed client (WSC:106); dropped in `clear_data` (`self.deflate.replace(None)`, WSC:175) and defensively in `deinit` (WSC:1768-1769).
- Holds zlib raw-deflate encoder/decoder (negative window bits per RFC 7692, DEF:113-124) + per-connection libdeflate decompressor (DEF:35-55; DEF:68-72 note: per-connection instead of VM-RareData-pooled purely due to a dep cycle). Context takeover: streams `reset()` after each message when `*_no_context_takeover` (DEF:199-201, 235-237). 128 MB decompression-bomb cap (DEF:84, 156, 179).

### Tunnel teardown ordering
- WSC:180-203 (`clear_data`): "Detach the tunnel first so its shutdown callbacks cannot re-enter this path… `shutdown` may synchronously fire SSLWrapper callbacks that re-enter the tunnel allocation, so call the raw-ptr overload which never holds a `&mut Self` across the dispatch… Release the I/O-layer ref taken in init_with_tunnel() — the tunnel was this struct's socket-equivalent owner… tunnel mode never adopts a socket so that callback never runs. Callers that touch `self` after clear_data() must hold a local ref guard (see cancel/finalize)."
- TUN:437-449: `clear_connected_web_socket` "Called before tunnel shutdown during a clean close so the tunnel's onClose callback doesn't dispatch a spurious abrupt close (1006)"; `detach_upgrade_client` "so that the SSLWrapper's synchronous onHandshake/onClose callbacks do not re-enter the upgrade client's terminate/clearData path" (also UPG:582-585).
- The tunnel's whole aliasing model (TUN:12-31) is a requirement statement in itself: driving entries project `&mut` only over the `wrapper` field; callbacks touch only disjoint fields; `ssl` is snapshotted so `on_handshake` never reads through `wrapper`.

---

## 6. Migration notes for a Rust uSockets core rewrite

1. **`us_socket_adopt` must survive**: move a connected socket between groups, restamp its kind, resize/rewrite ext, keep the fd/TLS state intact (socket.rs:849-882). The whole upgrade→framed transition depends on it. Alternatively the new core could keep one socket object and swap only the kind/ext — but the *behavioral* contract (events start routing to the new handler set atomically, no event delivered to the old owner afterward) must hold.
2. **Kind-stamped static dispatch, not per-socket callbacks**: one `.rodata` vtable per `SocketKind`, `Invalid` intentionally null → crash on missed stamp (uws_dispatch.rs:27-33). Adding a kind must be a compile error until every event has an arm.
3. **Ext-slot semantics**: exactly one word, readable/writable on both `us_socket_t` and `ConnectingSocket`; `None` ext ⇒ event no-op (the cancel/abort mechanism). Ext must be accessible on SEMI_SOCKETs, and `us_socket_close` on a SEMI_SOCKET must **not** dispatch close (UPG:627-635).
4. **Synchronous re-entrancy is pervasive**: `connect_*` may dispatch `connect_error` before returning; `close()` dispatches `on_close` synchronously; every consumer callback can free its owner. Handlers must be raw-pointer/`ThisPtr` shaped end-to-end; no `&mut Owner` across any dispatch (uws_handlers.rs:222-228, UPG:158-169, TUN:12-31).
5. **Close semantics needed**: two close flavors — Normal (flush SSL buffer + close_notify / FIN) vs Failure (SO_LINGER{1,0} RST) (UPG:641-677, WSC:223-228); half-close: `shutdown_read()` + `shutdown()` with loop-side CLEAN_SHUTDOWN on subsequent EOF instead of `on_end` (WSC:1214-1225) — this exact interaction with loop.c is load-bearing for clean close frames.
6. **Write API**: partial writes returned as count; `-1` = fatal; **no MSG_MORE** (bun#4010, WSC:931, 1073); callers do their own userspace buffering (`LinearFifo` send_buffer / `StreamBuffer` in tunnel) — the core needs no internal send queue but must deliver `on_writable` after kernel-buffer drain.
7. **Timeout API**: coarse per-socket `timeout(seconds)` with 0 = disarm; both `on_timeout` and `on_long_timeout` slots exist and are both mapped to the same handler here (uws_handlers.rs:346-352, 386-392).
8. **`on_handshake` with `us_bun_verify_error_t`** (success flag + error_no) and `get_native_handle() → SSL*` are hard requirements — SNI/ALPN configuration and manual `check_server_identity` happen in the consumer, not the core (UPG:805-827, 754-785).
9. **Per-connection SSL_CTX override at connect time** (`secure_ptr` param of `connect_group`) with refcounted `SSL_CTX` lifetime that can outlive the group and transfer between owner structs (UPG:90-109; WSC:113-117). Group-level ctx is unused for the WS client.
10. **`SslWrapper` (detached TLS state machine)** must exist independently of sockets for TLS-in-TLS: feed ciphertext (`receive_data`), pull ciphertext (`write` callback), push plaintext (`write_data`), `flush`, fast `shutdown`, optional initial payload (`start_with_payload`, TUN:274-284), and callbacks that may be invoked synchronously from any driving call.
11. **VM teardown ordering**: groups must be drainable (`close_all_socket_groups`) before JSC teardown, with re-population loops tolerated (rare_data.rs:845-870), and the loop's linked-group list must be walkable (leak fix reference bun#29932).
12. **Thread model**: everything single-threaded on the JS thread; non-atomic refcounts; no cross-thread event delivery.
13. **`memory_cost` note**: WSC:1797 "This is under-estimated a little, as we don't include usockets context" — a Rust core could expose per-socket/group memory accounting.
14. **Autobahn/RFC behaviors to preserve** (consumer-level but tied to socket ordering): masked empty pongs (WSC:1137-1139), pong-for-every-ping (WSC:836-839), close-code echo/dispatch mapping incl. 1005/1002/1001→1000 (WSC:902-906, 2127-2141), 128 MB receive cap (WSC:54-58).
