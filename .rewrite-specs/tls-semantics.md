# TLS layer semantics — behavioral spec of `packages/bun-usockets/src/crypto/` + bindings migration assessment

All file:line citations are against the current worktree
(`packages/bun-usockets/src/crypto/openssl.c` @ 2572 lines unless another file is named).
Abbreviations: `openssl.c` = `packages/bun-usockets/src/crypto/openssl.c`,
`internal.h` = `packages/bun-usockets/src/internal/internal.h`,
`libusockets.h` = `packages/bun-usockets/src/libusockets.h`.

---

# PART 1 — Behavioral spec (normative)

## 1. Data flow, BIO plumbing, re-entrancy

### 1.1 Object model

- **MUST**: there is no per-socket SSL wrapper struct. `s->ssl` IS the `SSL*`
  (`openssl.c:121-126`, macro `s_ssl(s)`), and all per-socket TLS state bits live in
  `us_socket_t` bitfields (`internal.h:269-295`):
  `ssl_handshake_state:2`, `ssl_write_wants_read:1`, `ssl_read_wants_write:1`,
  `ssl_fatal_error:1`, `ssl_is_server:1`, `ssl_raw_tap:1`, `ssl_shutdown_after_spill:1`,
  `ssl_close_after_spill:1`, `ssl_in_use:1`, `ssl_pending_detach:1`, and a full byte
  `ssl_pending_close_code`. A Rust rewrite MUST preserve equivalents of every one of these.
- **MUST**: `SSL_CTX` is owned externally (SecureContext / listener / HTTPContext); openssl.c
  only borrows it. `SSL_new(ctx)` takes its own internal ref so a socket outlives its
  SecureContext with no extra bookkeeping (`openssl.c:1259-1267`,
  `us_internal_ssl_ctx_up_ref/unref` are just `SSL_CTX_up_ref/free`).
- Loop dispatch shape: `loop.c` readable → `s->ssl ? us_internal_ssl_on_data : us_dispatch_data`
  (`openssl.c:52-64` header comment; `loop.c:685`); same split for writable (`loop.c:565`),
  open, close, end. The `us_dispatch_*` functions are Rust exports
  (`src/runtime/socket/uws_dispatch.rs:150-173`) that switch on socket kind and call typed
  Rust handlers — this is the callback surface the rewrite plugs into.

### 1.2 Per-loop shared state (`struct loop_ssl_data`, openssl.c:71-113)

One instance per `us_loop_t`, created lazily in `us_internal_init_loop_ssl_data`
(`openssl.c:690-714`), freed in `us_internal_free_loop_ssl_data` (`openssl.c:716-730`,
which MUST null `loop->data.ssl_data` after freeing). Contents:

- `ssl_read_input` / `ssl_read_input_length` / `ssl_read_input_offset`: a **borrowed window
  over the caller's ciphertext buffer** (the loop's recv buffer, or an upgrade feed). The
  read BIO consumes from it (see 1.3).
- `ssl_read_output`: one shared plaintext buffer of
  `LIBUS_RECV_BUFFER_LENGTH (524288) + 2*LIBUS_RECV_BUFFER_PADDING (32)` bytes
  (`libusockets.h:59,66`; `openssl.c:681-695`). Plaintext is written at offset
  `LIBUS_RECV_BUFFER_PADDING`. Allocation failure is a fatal OOM (`Bun__outOfMemory`).
- `ssl_socket`: **the socket currently being processed**. The custom BIO methods have no
  per-socket state; they route through this pointer. Every entry point sets it via
  `ssl_set_loop_data(s)` (`openssl.c:668-676`), which also zeroes the read window.
- `shared_rbio` / `shared_wbio`: ONE pair of custom BIOs shared by **every SSL on the loop**
  (`openssl.c:699-710`). `SSL_set_bio` + `BIO_up_ref` per socket (`openssl.c:1294-1296`) —
  the BIOs are refcounted, never per-socket.
- `ssl_last_fatal_error[256]` + `ssl_last_fatal_error_owner`: parked fatal-reason scratch
  (see §3.4). `US_SSL_FATAL_ERROR_REASON_MAX = 256` (`openssl.c:66-69`).
- Write batching + spill slot fields (see §4).

### 1.3 Custom BIO methods

Both BIOs use one `BIO_METHOD` (`BIO_meth_new(BIO_TYPE_MEM, "µS BIO")`, `openssl.c:699-704`)
with create/write/read/ctrl hooks; `BIO_set_data` points at the `loop_ssl_data`.

- **read** (`BIO_s_custom_read`, `openssl.c:648-666`): copies from the
  `ssl_read_input` window at `ssl_read_input_offset`; when the window is empty returns −1
  with `BIO_set_retry_read` (→ `SSL_ERROR_WANT_READ`). MUST advance offset/length exactly.
- **write** (`BIO_s_custom_write`, `openssl.c:519-568`), in priority order:
  1. If `ssl_socket->ssl_pending_detach` (a JS callback inside the handshake/read destroyed
     the socket): **swallow the bytes and report them written** — this drops BoringSSL's
     fatal alert on the floor so the state machine completes its error path without touching
     a dying fd (`openssl.c:522-531`). This is the mechanism behind "abort SNI without an
     alert" (§2.6).
  2. If `ssl_write_batching`: append the sealed record to the loop's batch buffer (grow ×2
     from 64 KiB; on realloc failure set `ssl_fatal_error` on the socket and still report
     written — sequence numbers already advanced, the connection cannot stay coherent,
     `openssl.c:536-558`). Report full length so BoringSSL seals the next record instead of
     parking a partial one.
  3. Otherwise: `us_socket_raw_write(ssl_socket, …)` directly (`openssl.c:560-567`); 0 bytes
     → `BIO_set_retry_write` and −1 (→ `SSL_ERROR_WANT_WRITE`).
  `us_socket_raw_write` (`socket.c:537`) NEVER re-enters the SSL layer and deliberately only
  gates on fd-closed / FIN-sent — NOT on TLS shutdown — so close_notify can be flushed after
  `SSL_shutdown` set SENT_SHUTDOWN (`socket.c:538-547` comment). Partial writes set
  `flags.last_write_failed` and arm writable polling.
- **ctrl** (`openssl.c:486-493`): `BIO_CTRL_FLUSH` → 1, everything else → 0.

### 1.4 Re-entrancy protocol (`us_internal_ssl_loop_state_save/restore`)

Because the routing state is loop-global, **any JS callback that runs from inside
`SSL_do_handshake`/`SSL_read`** (SNI resolver, ALPN cb, handshake dispatch, data dispatch,
session/keylog dispatch) can write to or destroy a *different* TLS socket on the same loop,
which repoints `ssl_socket` and clobbers the read window. Rules:

- **MUST** save `{ssl_socket, ssl_read_input, ssl_read_input_length, ssl_read_input_offset}`
  before such a callback and restore after (`openssl.c:500-517`; exported to Rust — the ALPN
  callback in `src/runtime/socket/socket_body.rs` and the SNI dispatcher use it,
  `internal.h:432-433`).
- Nesting triggers (exhaustive today):
  1. server SNI resolver call from `us_select_cert_cb` (`openssl.c:2385-2389` explicit
     save/restore);
  2. ALPN select callback → JS `ALPNCallback` (Rust side, `socket_body.rs:70-215`);
  3. `ssl_trigger_handshake` fired mid-`SSL_read` (`openssl.c:1949-1966` — manual
     save/restore of the read window + re-set `ssl_socket`);
  4. `us_dispatch_data` when the 512 KiB plaintext buffer filled mid-read
     (`openssl.c:1971-1988` — same manual save/restore);
  5. session/keylog flushes are deliberately only run when `ssl_read_input_length == 0`
     (`openssl.c:1933-1944`) so JS writes can't clobber pending ciphertext.
- **In-use / deferred-destruction protocol**: every `SSL_do_handshake`/`SSL_read` call is
  bracketed with `ssl_was_in_use = s->ssl_in_use; s->ssl_in_use = 1; … restore`
  (`openssl.c:1696-1699`, `1862-1867`). If a callback destroyed the socket while
  `ssl_in_use`, teardown paths (`us_internal_ssl_detach` `openssl.c:1353-1361`,
  `us_internal_ssl_close` `openssl.c:1611-1622`) MUST NOT `SSL_free`/re-enter; they set
  `ssl_pending_detach = 1` (+ `ssl_pending_close_code`) and return. The driver's epilogue
  (`openssl.c:1700-1705`, `1868-1873`) performs the deferred `us_socket_close` when the
  outer call unwinds. The BIO-write swallow (§1.3.1) is part of the same protocol.
- After ANY dispatch, callers MUST re-check `ssl_gone(s)` (= closed or `s->ssl == NULL`,
  `openssl.c:1523-1527`) before touching the SSL again. This check appears after every
  single dispatch in the file; the rewrite must be equally paranoid.

## 2. Handshake

### 2.1 Attach (client vs server) — `us_internal_ssl_attach` (openssl.c:1271-1345)

- `SSL_new(ctx)`, shared BIOs attached (`SSL_set_bio` + 2×`BIO_up_ref`).
- **Client** (`openssl.c:1300-1324`):
  - `SSL_set_renegotiate_mode(ssl, ssl_renegotiate_explicit)` (bounded renegotiation,
    issues #6197/#5363);
  - `SSL_set_connect_state`;
  - `SSL_set_tlsext_host_name(ssl, sni)` when an SNI name was passed;
  - **Verification is per-SSL, never per-CTX**: if `SSL_CTX_get_verify_mode(ctx) ==
    SSL_VERIFY_NONE` (context built without ca/requestCert), the socket gets
    `SSL_set_verify(ssl, SSL_VERIFY_PEER, us_verify_callback)`, and — unless the CTX is
    marked as carrying user CAs via the `us_ctx_user_ca_ex_idx` ex_data flag — a per-SSL
    trust store: `SSL_set0_verify_cert_store(ssl, us_get_shared_default_ca_store())`.
    Rationale (MUST preserve): a SecureContext is mode-neutral (may back both
    `tls.connect` and `tls.createServer`); setting VERIFY_PEER on the CTX would make a
    server sharing it send CertificateRequest (`openssl.c:1304-1313`, and
    `openssl.c:1239-1244`).
- **Server** (`openssl.c:1325-1331`): `SSL_set_accept_state`,
  `SSL_set_renegotiate_mode(ssl, ssl_renegotiate_never)` (server reneg = DoS vector), and
  the accepting `us_listen_socket_t*` stored in per-SSL ex_data `us_ssl_listener_ex_idx`
  (never as CTX-level servername arg — the CTX is shared and can outlive a listener;
  storing there is a documented UAF, `openssl.c:147-150`).
- All the `ssl_*` bitfields are reset (`openssl.c:1333-1344`); state starts
  `HANDSHAKE_PENDING` (enum `openssl.c:115-119`: PENDING=0, COMPLETED=1,
  RENEGOTIATION_PENDING=2).
- Session/keylog opt-in marker: `us_ssl_is_socket_ex_idx` is set to 1 only for
  `BUN_SOCKET_KIND_BUN_SOCKET_TLS` sockets (Bun.connect / node:tls) — checked against the
  listener's `accept_kind` too because an accepted socket's kind isn't stamped yet at attach
  time (`openssl.c:1278-1293`), and re-checked lazily in on_data (`openssl.c:1817-1825`).
  Purpose: fetch/Bun.serve/postgres/websockets never pay session serialization.

### 2.2 Driving the handshake — `ssl_update_handshake` (openssl.c:1671-1738)

- **MUST** `ERR_clear_error()` first: the per-thread error queue may hold another socket's
  leftovers (`openssl.c:1672-1676`).
- No-op unless `s->ssl && ssl_handshake_state == HANDSHAKE_PENDING`.
- If `SSL_is_init_finished` already → fire success (SSL_read can complete the handshake
  before this is called; RECEIVED_SHUTDOWN after a completed handshake is a clean close,
  NOT a handshake failure — `openssl.c:1679-1688`).
- If socket closed / TLS shut down / RECEIVED_SHUTDOWN while still in init → fire failure.
- Else `SSL_do_handshake` under the `ssl_in_use` bracket; on `ssl_pending_detach` do the
  deferred close and return (`openssl.c:1696-1705`).
- After the call, if RECEIVED_SHUTDOWN → `ssl_close(s, 0, NULL)` (`openssl.c:1708-1711`).
- `result <= 0`:
  - `SSL_ERROR_PENDING_CERTIFICATE` → async SNI suspension: stay HANDSHAKE_PENDING, no poll
    re-arm; `us_socket_sni_resolve()` re-drives later (`openssl.c:1715-1721`).
  - WANT_READ/WANT_WRITE → stay pending, set `ssl_write_wants_read = 1` and
    `flags.last_write_failed = 1` (arms writable; `openssl.c:1729-1732`).
  - anything else: on `SSL_ERROR_SSL`/`SSL_ERROR_SYSCALL` park the fatal reason (§3.4),
    then fire failure (`openssl.c:1722-1727`).
- `result == 1` → fire success; then (if still alive) `ssl_write_wants_read = 1` so the
  next readable event re-delivers a writable to flush user data buffered pre-handshake
  (`openssl.c:1735-1737`).
- **on_open**: `us_internal_ssl_on_open` dispatches user on_open FIRST, then kicks the
  handshake immediately ("some peers stall waiting for ClientHello",
  `openssl.c:1742-1751`).
- **MUST NOT** call `ssl_update_handshake` before the `SSL_read` loop in on_data: SSL_read
  drives the handshake itself, and firing on_handshake first lets JS `write()` →
  `ssl_set_loop_data` clobber the BIO window holding piggybacked app data
  (`openssl.c:1852-1857`).

### 2.3 on_handshake firing rules (`ssl_trigger_handshake`, openssl.c:1495-1521)

Fired **exactly once** per connection (state moves to HANDSHAKE_COMPLETED first, so
re-entry no-ops). Call sites:
1. `ssl_update_handshake` success/failure paths (above);
2. inside the `SSL_read` loop when the handshake completes *with* app data in the same
   record flight — fired BEFORE delivering data so JS can read ALPN/cert and re-tag the
   socket, with full loop-state save/restore around it (`openssl.c:1949-1967`);
3. inside the `SSL_read` loop when the handshake completed but no app data (peer's Finished
   arrived alone) — fired immediately rather than deferred to the writable tail-call,
   because the low-prio queue (§3.5) can reorder events under fan-out load
   (`openssl.c:1918-1930`);
4. `us_internal_ssl_close` on a socket whose handshake never completed → the ECONNRESET
   variant (§2.4);
5. renegotiation-policy violation → failure (§2.5).

Payload: `us_dispatch_handshake(s, success, us_bun_verify_error_t)`
(`internal.h:135`; vtable slot `on_handshake`, `libusockets.h:265`).

### 2.4 `us_bun_verify_error_t` and rejectUnauthorized (fail-closed split)

`struct us_bun_verify_error_t { int error; const char* code; const char* reason; }`
(`libusockets.h:246-250`).

- Normal path: `us_internal_ssl_verify_error(s)` (`openssl.c:1442-1447`) →
  `us_ssl_socket_verify_error_from_ssl` (`openssl.c:1432-1440`):
  - **Default when no peer cert and no exemption applies:**
    `X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT` (`openssl.c:1413-1430`,
    `us_internal_verify_peer_certificate`). Exemptions returning `X509_V_OK`: PSK-auth
    cipher, or a TLS1.3 resumed session (`openssl.c:1421-1426`).
  - With a peer cert: `SSL_get_verify_result(ssl)`.
  - `code` = symbolic name from the `us_X509_error_code` table (`openssl.c:1376-1411`,
    28 X509_V_ERR cases, else "UNSPECIFIED"); `reason` =
    `X509_verify_cert_error_string`. `error == 0` ⇒ code/reason NULL.
- Special errors: parked-fatal-reason dispatch uses `{error: -71, code: "EPROTO",
  reason: <ERR_error_string_n text>}` (`openssl.c:1489-1491`); close-before-established
  uses `{error: -46, code: "ECONNRESET", reason: "Client network socket disconnected
  before secure TLS connection was established"}` (`openssl.c:1517-1520`).
- **The C layer never fails closed itself.** `us_verify_callback` always returns 1
  (`openssl.c:865-870`) so the handshake never aborts on verification; the verdict is
  carried in the verify_error and **the fail-closed decision is made in Rust**:
  `resolve_reject_unauthorized` (`src/runtime/socket/SSLConfig.rs:262-271`) —
  enforce iff `(!is_server || request_cert) && reject_unauthorized`, defaulting for
  clients to `vm.get_tls_reject_unauthorized()` (`NODE_TLS_REJECT_UNAUTHORIZED`). The Rust
  `on_handshake` handlers close the socket when enforcement applies and
  `verify_error.error != 0`.
- One exception where the handshake DOES abort in-protocol: when the CTX was built with
  CAs or `request_cert` AND `reject_unauthorized`, build_raw sets CTX verify mode to
  `SSL_VERIFY_PEER | SSL_VERIFY_FAIL_IF_NO_PEER_CERT` (server refuses a client that sends
  no cert; `openssl.c:998-1030`). Without reject_unauthorized it's `SSL_VERIFY_PEER` only.

### 2.5 Renegotiation (client only)

- Client: `ssl_renegotiate_explicit`; server: `ssl_renegotiate_never` (§2.1).
- `SSL_read` returning `SSL_ERROR_WANT_RENEGOTIATE` → `ssl_renegotiate(s)`
  (`openssl.c:1529-1565`, called at `openssl.c:1884-1887`):
  - policy from CTX ex_data `us_ctx_ex_idx`, packed `{limit:u32, window:u32}` in the
    pointer value itself (`openssl.c:187-189`, `446-451`); defaults **3 per 600 s**
    (Node's CLIENT_RENEG_LIMIT/WINDOW). Set from options
    `client_renegotiation_limit/window` in `us_ssl_ctx_from_options`
    (`openssl.c:1250-1254`). `limit==0` disables renegotiation; `window==0` = counter
    never resets.
  - per-connection counter mallocs lazily into SSL ex_data `us_ssl_reneg_state_idx`
    (`openssl.c:453-461`); window reset only when wall-clock moved forward (NTP-step
    guard, `openssl.c:1545-1554`).
  - state → `HANDSHAKE_RENEGOTIATION_PENDING`; over-limit or `SSL_renegotiate` failure
    ⇒ `ssl_trigger_handshake(s, 0)` and the caller treats it as `SSL_ERROR_SSL` (close).
  - NOTE: after a successful `SSL_renegotiate` the read loop `continue`s; the
    on_handshake for the renegotiated handshake fires again because state left
    HANDSHAKE_COMPLETED (this is how node's `secureConnect`-after-reneg behaves).

### 2.6 SNI (server)

Two-callback design on the listener's default `SSL_CTX`:

- **Early select-certificate callback** `us_select_cert_cb`
  (`SSL_CTX_set_select_certificate_cb`, registered only when a dynamic JS resolver exists —
  `us_listen_socket_on_server_name`, `openssl.c:2515-2526`). Flow (`openssl.c:2317-2425`):
  1. Consume a previously suspended resolution: state 2 (resolved) → `SSL_set_SSL_CTX`
     with the resolved ctx and free the carried ref; resolved-to-NULL falls through to the
     static tree exactly like a sync `cb(null,null)` (`openssl.c:2322-2352`). State 3
     (error) → `ssl_select_cert_error`. State 1 (still waiting, spurious re-drive) →
     `ssl_select_cert_retry`.
  2. First call: read servername by **raw ClientHello parse** of the server_name extension
     (`us_client_hello_servername`, `openssl.c:2284-2310`, hostname cap 256 incl. NUL) —
     NOT `SSL_get_servername`, because only the early-callback contract guarantees the raw
     hello. No SNI extension → success (default ctx).
  3. **Dynamic resolver runs FIRST** (Node: a user SNICallback replaces default SNI
     handling entirely, including for the bind hostname which Listener.rs always puts in
     the static tree — tree-first would shadow the callback; `openssl.c:2371-2378`). The
     call is wrapped in loop-state save/restore; the resume handle (current
     `ssl_socket`) is passed to JS (`openssl.c:2380-2389`).
  4. Resolver outcomes: `abort==1` → mark `ssl_pending_detach` on the socket (drop the
     connection **without a TLS alert** — the BIO swallows the handshake_failure alert;
     matches Node's SNICallback-error behavior) and return `ssl_select_cert_error`
     (`openssl.c:2391-2400`); `abort==2` (async pending) → alloc/set
     `us_ssl_sni_pending_t{state:1}` in SSL ex_data, return `ssl_select_cert_retry` →
     `SSL_ERROR_PENDING_CERTIFICATE` (`openssl.c:2401-2411`); non-NULL ctx → owned ref:
     `SSL_set_SSL_CTX(ssl, dyn); SSL_CTX_free(dyn)` (`openssl.c:2412-2416`); NULL → fall
     back to the static SNI tree (`openssl.c:2418-2424`).
- **servername-stage callback** `sni_cb` (`SSL_CTX_set_tlsext_servername_callback`,
  registered when the first server name is added — `us_listen_socket_add_server_name`,
  `openssl.c:2456-2485`). Static-tree-only path (`openssl.c:2427-2454`): looks up
  `SSL_get_servername` in `ls->sni`; **no-ops when a dynamic resolver exists** (the early
  cb already ran resolver + fallback; running the tree again would overwrite the
  per-connection selection). Returns `SSL_TLSEXT_ERR_OK` always (NOACK when idx
  unregistered).
- **Resume** `us_socket_sni_resolve(s, ctx, error)` (`openssl.c:2186-2219`): no-op (freeing
  the passed ref) when the socket died or wasn't suspended; `error!=0` → state 3 +
  `ssl_pending_detach` (alert-free drop); else state 2 + stash ctx; then
  `ssl_set_loop_data` + `ssl_update_handshake` re-drives, and `us_select_cert_cb` re-fires
  and consumes the state.
- **SNI tree** (`sni_tree.cpp`, see §7.5): nodes hold `struct sni_node_t {SSL_CTX* ctx
  (upref'd); void* user}` (`openssl.c:128-132`); destructor frees both
  (`openssl.c:2266-2271`). `us_listen_socket_add_server_name` also stashes `user` in CTX
  ex_data `us_sni_ex_idx` so per-socket lookup works via `SSL_get_SSL_CTX` regardless of
  which ctx SNI selected (`openssl.c:2473-2476`; consumed by
  `us_socket_server_name_userdata`, `openssl.c:2528-2531`). Duplicate hostname → returns 1
  so App.h rolls back (`openssl.c:2478-2483`).
  `us_listen_socket_find_server_name_ctx` returns an **owned** ref (up_ref before return,
  `openssl.c:2501-2513`).
- **Listener teardown** `us_internal_listen_socket_ssl_free` (`openssl.c:2537-2570`):
  accepted sockets can outlive the listener (Node `server.close()` keeps connections), so
  the per-SSL listener backref MUST be wiped on every accepted socket — including the ones
  **parked on the loop's low-prio queue** (mid-handshake sockets are unlinked from
  `head_sockets`; missing them is a UAF in sni_cb). Then unref `ls->ssl_ctx`, free the SNI
  tree with the node destructor.

### 2.7 Sessions, tickets, keylog

- CTX config (`openssl.c:1077-1086`): session cache mode `CLIENT|SERVER|NO_INTERNAL|
  NO_AUTO_CLEAR` + `SSL_CTX_sess_set_new_cb(us_ssl_new_session_cb)` +
  `SSL_CTX_set_keylog_callback(us_ssl_keylog_cb)`. Rationale: for TLS 1.3 the resumable
  session only exists when the peer's NewSessionTicket arrives, and BoringSSL only exposes
  it via the new-session callback; NO_INTERNAL stops BoringSSL double-caching.
- **Parking protocol** (MUST preserve): both callbacks fire from *inside*
  `SSL_read`/`SSL_do_handshake`, where dispatching JS could free the SSL under the caller.
  So they only serialize and park on SSL ex_data queues
  (`us_ssl_pending_session_idx` / `us_ssl_pending_keylog_idx`), append-order preserved
  (`openssl.c:226-337`). Caps: session i2d ≤ 65536 bytes, keylog line ≤ 4096 (+ appended
  `\n`, Node-style) — oversize entries dropped at the parking site (`openssl.c:233-236`).
  Only SSLs with the `us_ssl_is_socket_ex_idx` marker park anything (`openssl.c:259-261`,
  `304-312`).
- **Flush points** (each guarded by `!closed && s->ssl`, each may run JS →
  re-check `ssl_gone` after): before delivering decrypted data (`openssl.c:1933-1944`),
  before ZERO_RETURN close (`openssl.c:1888-1896`, "ticket rode ahead of close_notify —
  wire order"), when the 512 KiB buffer cycles (`openssl.c:1975-1980`), and after the read
  loop fully unwinds (`openssl.c:2003-2007`). Delivery via `us_dispatch_session` /
  `us_dispatch_keylog` (`uws_dispatch.rs:234-279`, only `BunSocketTls` kind consumes).
- **Non-us_socket consumers** (SSLWrapper for TLS-over-duplex/named pipes): opt in via
  `us_ssl_enable_pending_events(ssl)` (`openssl.c:402-410`) and drain with
  `us_ssl_pop_pending_session/keylog` (`openssl.c:412-439`) after their reads unwind.
- Undelivered entries are freed with the SSL by the ex_data free funcs
  (`openssl.c:243-252`, `377-378`).
- **Ticket flush on write-less end** (MUST): BoringSSL defers post-handshake writes
  (TLS 1.3 NewSessionTickets) until the first SSL_write/SSL_shutdown. A server doing
  `s.end()` without writing takes the FIN path (no close_notify), so
  `us_internal_ssl_shutdown` explicitly does `SSL_write(ssl, &zero, 0)` to push the
  tickets through the BIO before the FIN (`openssl.c:2145-2159`).
- Client session **reuse** (`SSL_set_session`) is done from Rust via the native handle
  (`us_internal_ssl_get_native_handle`, `openssl.c:2038-2040`), not in this file.

### 2.8 ALPN

ALPN is configured **entirely from Rust** via raw BoringSSL calls on the native handles;
openssl.c contains no ALPN code (only quic.c does for lsquic):
- client: `SSL_set_alpn_protos` on the per-socket SSL
  (`src/runtime/socket/socket_body.rs:1435`, `src/http/lib.rs:1134`);
- server: `SSL_CTX_set_alpn_select_cb(ctx, select_alpn_callback)` registered on the
  listener CTX when static ALPNProtocols or a JS ALPNCallback exists
  (`socket_body.rs:1398-1420`); the callback handles dynamic per-connection ALPN (Node
  ALPNCallback contract) and falls back to the static list (`socket_body.rs:70-215`);
- read-back: `SSL_get0_alpn_selected` (`src/runtime/socket/tls_socket_functions.rs:1085-1102`).
A rewrite that keeps the Rust side intact only needs to keep exposing the `SSL*`
(or equivalent hooks) — but note the ALPN callback runs inside the handshake and is a §1.4
nesting trigger.

## 3. Read path

`us_internal_ssl_on_data(s, data, length)` (`openssl.c:1812-2011`):

1. `ERR_clear_error()` (per-thread queue hygiene, `openssl.c:1813-1816`).
2. Lazy `us_ssl_is_socket_ex_idx` marker for accepted node:tls sockets (§2.1).
3. **Raw tap**: if `ssl_raw_tap && length > 0`, dispatch the ciphertext to
   `us_dispatch_ssl_raw_tap` BEFORE decryption (upgradeTLS `[raw, tls]` pair, §6.1); bail
   if the dispatch closed/detached (`openssl.c:1826-1831`).
4. `ssl_set_loop_data(s)`; point the read window at `data/length`.
5. Guards: closed → NULL; `!s->ssl || ssl_fatal_error` → `ssl_close(s,0,NULL)`.
   **A half-closed socket still reads** — neither SENT_SHUTDOWN nor a sent FIN skips the
   read loop (peer data may precede its close_notify; normal for TLS1.2 write()+end()
   servers) (`openssl.c:1838-1850`).
6. **SSL_read loop** into `ssl_read_output + PADDING`, accumulating `read` up to
   `LIBUS_RECV_BUFFER_LENGTH` (512 KiB), each call under the `ssl_in_use` bracket with the
   `ssl_pending_detach` epilogue (`openssl.c:1860-1873`).
   - `just_read > 0` while state != COMPLETED → fire on_handshake(1) mid-loop with
     save/restore (§2.3.2).
   - Buffer full → flush sessions/keylog, `us_dispatch_data(s, out+PADDING, read)`,
     restore window, `read = 0`, `goto restart` (`openssl.c:1971-1989`).
   - `just_read <= 0` → `SSL_get_error`:
     - `WANT_READ` / `WANT_WRITE` / `PENDING_CERTIFICATE`:
       `WANT_WRITE` sets `ssl_read_wants_write = 1`; **leftover ciphertext in the window
       here means broken TLS framing → `ssl_close`** (`openssl.c:1911-1918`); fire
       "Finished-alone" handshake if applicable (§2.3.3); if `read > 0`, flush parked
       sessions/keylog THEN dispatch the plaintext (order is normative — Node's
       NewSessionCallback precedes data; and the data dispatch may close the socket,
       dropping a deferred flush) (`openssl.c:1931-1947`); break.
     - `WANT_RENEGOTIATE` → §2.5; on policy failure treated as `SSL_ERROR_SSL`.
     - `ZERO_RETURN` (peer close_notify): flush sessions/keylog, dispatch any decrypted
       `read` bytes, then `ssl_close(s, 0, NULL)` → clean close (`openssl.c:1888-1903`).
     - `SSL_ERROR_SSL` / `SSL_ERROR_SYSCALL`: park fatal reason (§3.4), `ssl_close(s,0,
       NULL)`, clear the scratch (`openssl.c:1905-1910`).
7. Post-loop: if `ssl_write_wants_read && !ssl_read_wants_write` → clear flag and re-enter
   `us_internal_ssl_on_writable(s)` (a prior SSL_write starved for handshake input can
   proceed now; the `!ssl_read_wants_write` guard prevents recursion)
   (`openssl.c:1992-2001`).
8. Final session/keylog flush (`openssl.c:2003-2008`).

### 3.4 Fatal-reason parking (EPROTO reporting)

- `ssl_park_fatal_reason(s)` (`openssl.c:1451-1469`): on `SSL_ERROR_SSL`/`SYSCALL`,
  format `ERR_peek_last_error()` via `ERR_error_string_n` into the per-loop 256-byte
  scratch **only while the handshake is unfinished** (the handshake-failure dispatch is
  the sole consumer), tag the owner socket, then `ERR_clear_error()` and set
  `ssl_fatal_error = 1`.
- Consumed by `ssl_dispatch_parked_reason` (`openssl.c:1478-1493`): copies to stack,
  clears the scratch BEFORE running JS, dispatches `{-71, "EPROTO", reason}`. Owner check
  is mandatory (server+client share a loop; a reason parked by one socket must never be
  reported for another, `openssl.c:89-92`). Detach clears an unclaimed parked reason
  (`openssl.c:1364-1370`); relocation transfers ownership (§6.3).
- This is how `wrong version number` etc. reach Node's `tlsClientError`.

### 3.5 Low-prio throttling

`us_internal_ssl_is_low_prio(s) = SSL_in_init(ssl)` (`openssl.c:2013-2018`): loop.c
deprioritizes mid-handshake sockets (throttled to a few per tick) to keep established
connections responsive. Interacts with event ordering — the reason for §2.3.3's immediate
fire — and with listener teardown (§2.6 low-prio walk).

## 4. Write path

`us_internal_ssl_write(s, data, length)` (`openssl.c:2042-2114`). Return value = plaintext
bytes consumed; 0 = caller must buffer and retry on writable.

1. Guards: closed / TLS-shut-down / length==0 → 0. SEMI_SOCKET (fast-path connect attached
   SSL eagerly; on_open hasn't fired, SNI/ALPN not set yet — writing would serialize a
   ClientHello without them) → 0, drained later by on_open → update_handshake
   (`openssl.c:2045-2053`).
2. **Spill discipline**: if the loop's spill slot holds this socket's ciphertext, try to
   drain; if still pending → return 0 (SSL already counts those records written; nothing
   new may be sealed) (`openssl.c:2057-2062`).
3. Zero the read window, set `ssl_socket = s`.
4. **Batching**: enabled iff no other socket's spill occupies the slot
   (`batching = ssl_spill_owner == NULL`, `openssl.c:2075-2076`). Loop: SSL_write in
   ≤16384-byte plaintext chunks (one record each); each sealed record lands in the batch
   buffer via the BIO (§1.3.2); every ≥131072 batched bytes → `ssl_flush_write_batch`;
   if the wire blocked (spill created) STOP consuming plaintext (`openssl.c:2078-2093`).
   Final flush after the loop. **Honesty invariant (MUST)**: bytes reported consumed are
   on the wire or in the bounded spill — never unboundedly parked in memory
   (`openssl.c:2069-2074`).
5. `ssl_fatal_error` → 0. `total > 0` → total. Else decompose `SSL_get_error`:
   `WANT_READ` → `ssl_write_wants_read = 1`; `SSL_ERROR_SSL`/`SYSCALL` → park fatal reason
   (a pre-`secureConnect` write is where config failures like impossible version windows
   surface) (`openssl.c:2098-2113`).

### 4.1 Batch flush + spill slot

- `ssl_flush_write_batch` (`openssl.c:575-598`): one `us_socket_raw_write` of the whole
  batch. Partial → malloc a spill copy of the remainder into the loop's **single** spill
  slot `{ssl_spill, len, off, owner}`; OOM here → `ssl_fatal_error` (records already
  sequenced). Return 1 = wire took all, 0 = spill pending.
- `ssl_drain_spill` (`openssl.c:602-617`): raw-write the remaining slice; frees + clears
  the slot when done. Returns 1 when clear or not-ours.
- **Ordering invariants (MUST)**: spilled ciphertext reaches *that* socket's fd, in order,
  before any of its later records; drained from the owner's writable event
  (`openssl.c:1776-1791`); while another socket owns the slot, other sockets write
  through per-record (pre-batching behavior). Deferred actions after drain:
  `ssl_shutdown_after_spill` → `us_internal_ssl_shutdown`, `ssl_close_after_spill` →
  `ssl_close(FAST_SHUTDOWN)` (`openssl.c:1783-1791`).
- `ssl_release_spill` on teardown: one last drain attempt, then free (`openssl.c:620-634`);
  called from `ssl_detach` (error/RST paths reach detach without ssl_close —
  `openssl.c:1348-1352`) and from deferred-close in `ssl_close`.
- There is **no msg_more/cork flag at this layer**; batching-within-one-write is the
  coalescing mechanism (comment: node reaches the same shape via memory-BIO + writev,
  `openssl.c:94-99`). uWS's cork buffer sits above and simply produces one large
  `us_internal_ssl_write` call.
- The writable event (`us_internal_ssl_on_writable`, `openssl.c:1774-1810`): drain spill →
  deferred shutdown/close → `ssl_update_handshake` → if `ssl_read_wants_write`, clear it
  and re-enter `on_data(s, "", 0)` (lets a blocked decrypt flush) → dispatch user
  on_writable only when handshake completed.

## 5. Shutdown & close

### 5.1 `us_internal_ssl_shutdown` (graceful half-close; openssl.c:2116-2180)

- No-op when closed or already TLS-shut-down (`us_internal_ssl_is_shut_down` =
  FIN-sent poll type ∨ no ssl ∨ SENT_SHUTDOWN ∨ fatal, `openssl.c:2022-2027`).
- Spill pending → set `ssl_shutdown_after_spill`, return (§4.1).
- **Core Node-compat rule (MUST)**: BoringSSL has no TLS half-close — after SSL_shutdown
  sends close_notify, SSL_read refuses further app data (PROTOCOL_IS_SHUTDOWN). Node
  (OpenSSL) keeps reading after sending close_notify and node:net/tls semantics depend on
  it. Therefore: **send close_notify only when the peer's close_notify already arrived**;
  otherwise do a TCP half-close (FIN via `us_internal_socket_raw_shutdown`) and keep
  reading — preceded by the zero-length `SSL_write` ticket flush (§2.7)
  (`openssl.c:2132-2160`).
- When close_notify IS sent (`SSL_shutdown`): still-in-init or quiet-shutdown → raw FIN;
  `ret < 0` with SSL/SYSCALL → clear queue, `ssl_fatal_error = 1`, raw FIN
  (`openssl.c:2162-2180`).

### 5.2 `us_internal_ssl_close(s, code, reason)` (openssl.c:1610-1668)

- `ssl_in_use` → deferred: release spill, set `ssl_pending_detach` +
  `ssl_pending_close_code`, return (§1.4).
- `FAST_SHUTDOWN && !reason` (node `_handle.close()`): must not cut off spilled ciphertext
  already reported written — if the spill won't drain now, set `ssl_close_after_spill`
  and defer (at most once) (`openssl.c:1623-1633`).
- Release spill. SEMI_SOCKET or `ssl_gone` → straight `us_internal_socket_close_raw`
  (firing on_handshake(0) after onConnectError tore down JS state is wrong,
  `openssl.c:1634-1640`).
- `ssl_set_loop_data` + `ssl_update_handshake` (drives a final step; may fire handshake).
- Handshake never completed → `ssl_trigger_handshake_econnreset` exactly once (§2.4)
  (`openssl.c:1645-1650`).
- **CloseCode semantics** (`openssl.c:1652-1667`):
  - `code != 0` (forceful — destroy/abort/fast): `ssl_handle_shutdown(s, force_fast=1)`
    best-effort, then raw-close now (the Rust destroy path unrefs immediately after;
    deferring would orphan the socket).
  - `code == 0` (graceful — `end()`): send close_notify and **defer the fd close until
    the peer replies** — `ssl_handle_shutdown(s, 0)` returns 0 after a successful
    `SSL_shutdown()==0` (sent, not yet received) and the function returns without
    raw-closing; the actual close happens when on_end/ZERO_RETURN re-enters with
    SENT_SHUTDOWN set (then `ssl_handle_shutdown` returns 1).
- `ssl_handle_shutdown(s, force_fast)` (`openssl.c:1567-1608`): done when no ssl /
  shut down / fatal / init unfinished. Else `SSL_shutdown` (twice when force_fast —
  fast-shutdown pattern); `ret<0`: SSL/SYSCALL → fatal+close; WANT_READ/WRITE →
  **close now anyway** (the alert never left the BIO; no retry path exists once
  SENT_SHUTDOWN is set — documented LSan leak otherwise, `openssl.c:1587-1601`).

### 5.3 on_end / on_close / detach

- `us_internal_ssl_on_end` (TCP FIN received): no close_notify reply is coming; send ours
  best-effort (`ssl_close(s,0,NULL)`) and raw-close with CLEAN_SHUTDOWN — with native
  allowHalfOpen the loop.c caller no longer raw-closes for us (`openssl.c:1761-1772`).
- `us_internal_ssl_on_close`: dispatch user on_close FIRST (JS may still inspect
  ALPN/peer cert), then `us_internal_ssl_detach` frees the SSL (`openssl.c:1753-1759`).
- `us_internal_ssl_detach` (`openssl.c:1347-1372`): release spill (error/RST teardowns
  come here without ssl_close), honor `ssl_in_use` deferral, `SSL_free`, null `s->ssl`,
  clear an unclaimed parked fatal reason owned by `s`.

## 6. upgradeTLS / adopt / feed / relocation

### 6.1 `us_socket_adopt_tls` (openssl.c:2236-2256) + the JS upgradeTLS flow

- Refuses closed sockets. Calls `us_socket_adopt` (group/kind/ext resize), then
  `us_internal_ssl_attach(new_s, ctx, is_client, sni, NULL)` (no listener → SNI resolves
  from the single ctx for server-side wraps), `us_socket_resume`.
- **MUST NOT** kick the handshake or dispatch on_open inside adopt: the caller hasn't
  repointed the ext slot yet — any dispatch would land in the old TCP owner. The caller
  sequence (see `src/runtime/socket/socket_body.rs:3480-3627`): stash ext → set kind →
  fire its own onOpen → `us_socket_start_tls_handshake(s)` (`openssl.c:2258-2262`:
  set_loop_data + update_handshake → sends ClientHello) → `resume()` → feed pre-read bytes.
- The `[raw, tls]` pair contract: index 0 (raw twin) keeps pre-upgrade handlers and
  observes **ciphertext** via `us_socket_set_ssl_raw_tap(s, 1)` (`socket.c:88-90`) →
  `us_dispatch_ssl_raw_tap` before every SSL_read (§3.3; `uws_dispatch.rs:177-222`);
  index 1 sees plaintext. Raw-tap dispatch is skipped for the `length==0` flush call
  from on_writable (`openssl.c:1826-1828`).

### 6.2 `us_socket_tls_feed` (openssl.c:2231-2234)

Feeds externally-obtained ciphertext (bytes already pulled off the fd pre-upgrade — e.g. a
ClientHello consumed by the plain-TCP layer) through `us_internal_ssl_on_data` exactly as
if from the kernel. Guarded on closed/`!ssl`/`length<=0`.
NOTE: UpgradedDuplex / WindowsNamedPipe do **not** use this — they use the separate Rust
`SSLWrapper` engine (`src/uws/lib.rs:150+`), which owns its own `SSL*` with **memory BIOs**
(`BIO_s_mem` pair, `BIO_write` ciphertext in / `BIO_read` ciphertext out, 64 KiB working
buffer, same reneg policy 3/600s) and only touches openssl.c via
`us_ssl_enable_pending_events` / `us_ssl_pop_pending_*` (§2.7). A unified Rust TlsState
could subsume both engines, but the normative contract above is openssl.c's.

### 6.3 `us_internal_ssl_socket_relocated` (openssl.c:636-646)

`us_socket_adopt` may `us_poll_resize`-reallocate the `us_socket_t` when ext size changes
(`context.c:265-303`). The ONLY TLS state that must chase the new address is
**loop-level ownership pointers**: `ssl_spill_owner` and `ssl_last_fatal_error_owner`.
Everything else lives inside the moved struct (bitfields) or hangs off the SSL (ex_data),
which moves by value/pointer. ⇒ For the rewrite's goal of **eliminating relocation**, the
state that today transfers implicitly by memcpy of `us_socket_t` is: the `SSL*` and the 11
bitfield bits + close-code byte (§1.1); plus these two loop-level owner pointers. If the
rewrite keys loop-level state by stable socket identity (or stores spill per-socket),
relocation support can be dropped entirely.

## 7. Context/options

### 7.1 `us_bun_socket_context_options_t` fields and effects

(Definition `libusockets.h` — see companion notes below; consumed by
`us_ssl_ctx_build_raw`, `openssl.c:893-1088`, and `us_ssl_ctx_from_options`,
`openssl.c:1234-1257`.) Effects, in application order:

| field | effect | cite |
|---|---|---|
| — | `SSL_CTX_new(TLS_method())`; live-counter ex_data registered immediately so every exit balances | 897-901 |
| — | **Required modes**: `SSL_CTX_set_read_ahead(1)`, `SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER` — "changing these breaks the BIO logic" | 903-905 |
| `ssl_min_version`/`ssl_max_version` | `SSL_CTX_set_min/max_proto_version`; **default floor TLS1_2_VERSION** when min unset; max only set when nonzero | 906-911 |
| `ssl_prefer_low_memory_usage` | adds `SSL_MODE_RELEASE_BUFFERS` | 913-915 |
| `passphrase` | strdup'd into `SSL_CTX_set_default_passwd_cb_userdata` + `passphrase_cb` (copies the passphrase, fails if longer than buf, `openssl.c:473-479`); **dropped as soon as key loading finishes** (or on build failure) so `SSL_CTX_free` is sufficient everywhere downstream | 917-924, 876-889, 974-977 |
| `cert`/`key` arrays (`cert_count`/`key_count`) vs `cert_file_name`/`key_file_name` | **Pair-wise interleaved loading** when in-memory arrays with equal counts > 1 (multi-identity RSA+EC; loading all certs then all keys would fail KEY_TYPE_MISMATCH); else certs (file or each mem chain via `us_ssl_ctx_use_certificate_chain`, 812-863: `PEM_read_bio_X509_AUX` leaf + chain certs, trailing NO_START_LINE tolerated) then keys (file or mem PEM/DER via `us_ssl_ctx_use_privatekey_content`, 734-766) | 926-973 |
| `ca_file_name` | `SSL_load_client_CA_file` → `SSL_CTX_set_client_CA_list`; mark `us_ctx_user_ca_ex_idx`; `SSL_CTX_load_verify_locations` **into the fresh empty store** (explicit CA REPLACES default trust — Node semantics); then set verify mode | 979-1001 |
| `ca` array | mark user-CA; add each PEM (may contain multiple certs) to the CTX's own store AND client-CA list via `add_ca_cert_to_ctx_store` (768-810; a PEM doc with zero certs but a `-----BEGIN` block is tolerated Node-style — e.g. a private key passed as ca; non-PEM is an error); verify mode per cert-loop iteration | 1003-1021 |
| `request_cert` (no CAs) | `SSL_CTX_set_cert_store(us_get_shared_default_ca_store())` (process-shared bundled-roots store, refcounted); verify mode | 1022-1031 |
| `reject_unauthorized` | only chooses `SSL_VERIFY_PEER \| SSL_VERIFY_FAIL_IF_NO_PEER_CERT` vs `SSL_VERIFY_PEER` in the three branches above; **no CA/request_cert ⇒ CTX verify mode stays NONE** (client-side verification is per-SSL, §2.1) | 998-1030 |
| `dh_params_file_name` | `PEM_read_DHparams` from file → `SSL_CTX_set_tmp_dh`; then forces `SSL_CTX_set_cipher_list(DEFAULT_CIPHER_LIST)` (default_ciphers.h) | 1033-1057 |
| `ssl_ciphers` | `SSL_CTX_set_cipher_list`; failure → INVALID_CIPHERS **except** the empty-string+NO_CIPHER_MATCH combo which is tolerated; error is *peeked* not consumed so the Rust caller can decompose the reason | 1059-1071 |
| `secure_options` | `SSL_CTX_set_options(secure_options)` verbatim (Node secureOptions bitmask) | 1073-1075 |
| — | session cache mode + new-session cb + keylog cb (§2.7) | 1077-1086 |
| `client_renegotiation_limit`/`window` | packed into ctx ex_data (§2.5) — applied by `us_ssl_ctx_from_options`, NOT build_raw | 1250-1254 |

- Error reporting: `enum create_bun_socket_error_t*` out-param
  (LOAD_CA_FILE / INVALID_CA_FILE / INVALID_CA / INVALID_CIPHERS); all other failures
  return NULL with the reason left on the OpenSSL error queue for the Rust caller.
  `ssl_ctx_build_fail` = drop passphrase + `SSL_CTX_free` (`openssl.c:884-889`).
- `us_ssl_ctx_build_raw` is also exported for quic.c (lsquic sets ALPN/transport params
  itself, `openssl.c:891-893`).
- **pfx**: `us_ssl_parse_pkcs12` (`openssl.c:1153-1232`) converts a PKCS#12 blob (+pass)
  into malloc'd PEM key/cert/ca strings for the normal option path; error tags
  "parse"/"mac"/"key"/"cert"; len > INT_MAX rejected (BIO_new_mem_buf int truncation).
- **addCACert** (`us_ssl_ctx_add_ca_cert`, `openssl.c:1090-1132`): clone-on-write — if the
  CTX's store IS the process-shared default store, or is still the empty store from
  SSL_CTX_new, replace with a fresh **full default store** (`us_get_default_ca_store()`:
  bundled roots + NODE_EXTRA_CA_CERTS + system CAs when enabled) before appending; mark
  user-CA. Extends (not replaces) default trust, matching Node's SecureContext::AddCACert.
- **ex_data registration** is one-time via pthread_once/INIT_ONCE
  (`openssl.c:140-185, 368-395`): SSL_CTX creation races between the JS thread and the
  HTTP-client thread; a racy `<0` check would double-register free_funcs and corrupt the
  `ssl_ctx_live` counter (`openssl.c:134-138`, counter decremented in the ex_data free
  func so it tracks true refcount-zero destruction). `us_ctx_cache_ex_idx`'s free func is
  the Rust `bun_ssl_ctx_cache_on_free` (SSLContextCache tombstone, `openssl.c:362-371`).

### 7.2–7.6 Rust periphery (SSLConfig.asUSockets, SocketContext cache, SecureContext, HTTPContext, sni_tree, root certs)

See companion findings appended in **Appendix A** (surveyed with citations). Summary of
normative points:

- `SSLConfig.rs::asUSockets()` populates the options struct 1:1; `reject_unauthorized`
  defaults from `NODE_TLS_REJECT_UNAUTHORIZED` via the VM
  (`src/runtime/socket/SSLConfig.rs:173-183, 258`); fail-closed rule in
  `resolve_reject_unauthorized` (§2.4).
- `src/uws_sys/SocketContext.rs` caches built `SSL_CTX*` keyed by an mtime-digest of
  file-based inputs (`stat_for_digest`) + the value-based options; a false cache hit is a
  security bug — the rewrite must keep every input that shapes the CTX in the key.
- `src/http/HTTPContext.rs` keeps refcounted per-custom-TLS socket contexts on the HTTP
  client thread (each distinct SSLConfig gets its own context; the default context is
  shared).
- `sni_tree.cpp` (217 lines): label trie `{hostname → void* user}`; a `*` label matches
  exactly one label at ANY position, exact match preferred per level; full semantics in
  Appendix A §A.5.
- Root certs: `root_certs.cpp` builds the process-shared default `X509_STORE`
  (`us_get_shared_default_ca_store`, refcount-incremented per return) from the bundled
  Mozilla table + `NODE_EXTRA_CA_CERTS` (+ platform stores per
  `root_certs_{linux,darwin,windows}.cpp` when `--use-system-ca`). These are
  self-contained data/C++ providers behind a tiny C API — **they can and should remain
  untouched** by a Rust rewrite of openssl.c (Appendix A §A.6).

## 8. OpenSSL-API quirks relied upon (checklist for the rewrite)

1. **Error-queue discipline**: the queue is per-thread and shared across sockets.
   `ERR_clear_error()` at the top of on_data and update_handshake; clear after parking;
   peek-don't-consume in cipher-list failure (§7.1); `ERR_peek_last_error` (not get) when
   parking so the queue survives until cleared (`openssl.c:1460-1467`).
2. **`SSL_CTX_set_read_ahead(1)` + `SSL_MODE_ACCEPT_MOVING_WRITE_BUFFER`** are load-bearing
   for the custom-BIO design (`openssl.c:903-905`). ACCEPT_MOVING_WRITE_BUFFER matters
   because retried `SSL_write`s after WANT_* may present a different buffer address
   (caller re-buffers plaintext).
3. **BIO retry flags**: read/write hooks must `BIO_clear_retry_flags` then set
   retry-read/retry-write precisely; reporting a swallowed write as written is used
   deliberately (§1.3.1, §1.3.2 OOM path).
4. **`SSL_get_error` contract**: called immediately after the failing call, before any
   other SSL/queue operation. Distinguished codes used: WANT_READ, WANT_WRITE,
   ZERO_RETURN, WANT_RENEGOTIATE, PENDING_CERTIFICATE (BoringSSL-specific, from
   `ssl_select_cert_retry`), SSL, SYSCALL.
5. **`SSL_shutdown` bidirectional dance**: `ret==0` = sent-not-received (defer close),
   `ret==1` = complete; double-call for fast shutdown; `SSL_get_shutdown` bits
   (SENT/RECEIVED) consulted independently (§5). No TLS half-close in BoringSSL — FIN
   half-close substitute is normative Node behavior (§5.1).
6. **Session callbacks fire mid-read** — the entire parking design (§2.7) exists because
   running JS from inside `SSL_read` is a UAF. Any safe wrapper that surfaces sessions
   via callback has the same constraint.
7. **`SSL_set_SSL_CTX` mid-handshake** for SNI (works from both servername and
   select_certificate callbacks; takes its own ref). Per-SSL overrides that must survive
   it: `SSL_set_verify`, `SSL_set0_verify_cert_store` (set0 = ownership transfer).
8. **ex_data with free_funcs** for: live counter, reneg policy (pointer-packed), reneg
   counter, SNI pending state, listener backref, is-socket marker, pending
   session/keylog queues, cache tombstone. A Rust rewrite can move most of these into its
   per-socket struct; the two that must stay CTX-associated are the reneg policy and the
   cache tombstone hook.
9. **`SSL_early_callback_ctx_extension_get`** (BoringSSL-only) for raw SNI parse (§2.6).
10. **`i2d_SSL_SESSION`** double-call length+serialize pattern (§2.7).
11. `OPENSSL_init_ssl(0, NULL)` once per loop init (`openssl.c:697`);
    `BIO_meth_new(BIO_TYPE_MEM, …)` custom method with `BIO_set_data`.
12. Zero-length `SSL_write` to flush deferred NewSessionTickets (§2.7) — BoringSSL seals
    no record for len 0 but flushes pending post-handshake data.

---

# PART 2 — Bindings migration assessment

Crates present at `/root/bun/vendor/boringssl/rust/` (the worktree has no private vendor
copy; the shared repo checkout is authoritative; workspace `rust/Cargo.toml:1-11`,
resolver 3): `bssl-sys`, `bssl-crypto`, `bssl-macros`, `bssl-tls`, `bssl-tls-tokio`,
`bssl-rustls-adapters`, `bssl-x509`, `test-data`. Vendored fork commit matches Bun's
BoringSSL build: `oven-sh/boringssl@1a41b902` (`scripts/build/deps/boringssl.ts:27`).

## (a) bssl-sys symbol coverage

- Bindings are generated by **bindgen at CMake time, not cargo time**
  (`vendor/boringssl/rust/CMakeLists.txt:32-73`): `bindgen wrapper.h` with
  `--allowlist-file=".*[[:punct:]]include[[:punct:]]openssl[[:punct:]].*\.h"` — i.e. the
  allowlist is a *file* filter admitting **every** declaration in `include/openssl/*.h`.
  `wrapper.h` includes ssl.h, bio.h, pem.h, pkcs8.h, pkcs12.h, dh.h, err.h, x509.h, etc.
  (`bssl-sys/wrapper.h:1-90`). Static-inline functions are covered via
  `--wrap-static-fns`, which emits a generated `wrapper.c` compiled into a small
  `rust_wrapper` static lib (`CMakeLists.txt:76-82`).
- **Coverage verdict: no gaps.** Every symbol Part 1 needs — `SSL_new/SSL_set_bio`,
  `BIO_meth_new` family + `BIO_set_data`, `BIO_new_mem_buf`/`BIO_s_mem`,
  `SSL_do_handshake/SSL_read/SSL_write/SSL_get_error/SSL_shutdown/SSL_get_shutdown`,
  `SSL_CTX_set_select_certificate_cb`/`SSL_CTX_set_tlsext_servername_callback`/
  `SSL_set_SSL_CTX`/`SSL_early_callback_ctx_extension_get`,
  `SSL_get_verify_result/SSL_get_peer_certificate/SSL_set0_verify_cert_store`,
  ALPN trio, `SSL_CTX_sess_set_new_cb/i2d_SSL_SESSION/SSL_set_session`,
  `SSL_CTX_set_verify/SSL_CTX_set_client_CA_list/SSL_load_client_CA_file`,
  PEM/PKCS8/PKCS12 loaders, cipher list, min/max proto version, `SSL_CTX_set_options`,
  passwd cb, DH, keylog cb, renegotiate mode, `ERR_*`, ex_data — is within the bound
  surface (confirmed empirically: bssl-tls itself calls the custom-BIO and handshake
  symbols through bssl-sys, e.g. `bssl-tls/src/io.rs:334-343`,
  `connection/lifecycle.rs:204`).
- Caveat: **no pre-generated bindings are vendored** (no `wrapper_<target>.rs` files in
  tree) and `bssl-sys/build.rs:93-124` only *copies* CMake-produced bindings from
  `$BORINGSSL_BUILD_DIR` and emits `cargo:rustc-link-lib=static=crypto/ssl/rust_wrapper`
  (+ `links = "bssl"`, `bssl-sys/Cargo.toml:14`).

## (b) bssl-tls viability for the event-loop design

Status: explicitly WIP (`bssl-tls/src/lib.rs:31` "*WARNING* this crate is still work in
progress").

**What fits (genuinely sans-I/O — it does NOT own fds or require std::io/tokio):**
- I/O is a **custom BIO over user traits**: `AbstractReader::read(&mut self,
  async_ctx: Option<&mut Context>, buf) -> AbstractSocketResult{Ok(n), Retry,
  EndOfStream, Err}` / `AbstractWriter::{write, flush}` (`bssl-tls/src/io.rs:267-295`);
  `Retry` maps to `BIO_set_retry_read/write` (`io.rs:400-406, 459-465`); attach via
  `TlsConnection::set_io`/`set_split_io` → `SSL_set_bio`
  (`connection/transport.rs:47-78`). Bun would implement these over ciphertext buffers —
  the same shape as §1.3 (there is no public `BIO_s_mem` pair API; the trait IS the
  memory-BIO analogue).
- Manual handshake driving: `TlsConnectionInHandshake::do_handshake() ->
  Result<Option<TlsRetryReason>, Error>` (`connection/lifecycle.rs:202-205`), typed
  `accept()/connect()`, sync `sync_read/sync_write/flush` with
  `IoStatus::{Ok,EndOfStream,Retry,Err}` (`connection/io.rs:81-183`), `sync_shutdown`
  close_notify state machine (`lifecycle.rs:289-317`).
- Verification: `VerifyCertificate` callback trait + `VerifyCertificateContext` (peer
  chain, OCSP, SCT) (`credentials.rs:560-703`); chain verify via bssl-x509;
  client-cert request modes (`credentials.rs:909`).
- Sessions: `TlsSession::{to_bytes, from_bytes}`, `with_session`, context cache
  controls, `get_session` (`sessions.rs:56-324`, `connection.rs:111-120`) — but **no
  new-session callback wrapper** (`SSL_CTX_sess_set_new_cb` unbound in the safe layer),
  so TLS 1.3 tickets must be polled, which does NOT reproduce Node's `'session'` event
  timing (§2.7's parked-queue design needs the callback).

**Hard gaps (all must-haves for Bun.serve / node:tls):**
1. **No ALPN API at all** (no set_alpn_protos / alpn_select_cb / get0_alpn_selected
   wrappers; only error-code enum mentions).
2. **No server SNI / certificate-selection callback** (no servername_callback,
   select_certificate_cb, or SSL_set_SSL_CTX wrapper; only client `set_host`).
3. **No client-CA-list API.**
4. No PKCS12; credentials go through the modern `SSL_CREDENTIAL` API rather than
   `SSL_CTX_use_certificate` (`credentials.rs:77-311`) — a behavioral divergence from
   §7.1's legacy-slot semantics (multi-identity replacement rules).
5. Escape hatches exist (`TlsConnection::as_mut_ptr() -> *mut SSL`,
   `TlsContext::as_mut_ptr()`, `connection.rs:181-183`, `context.rs:458-460`) but the
   crate stores its own state in ex_data and declares user ex_data interaction UB
   (`context.rs:449-450`) — hand-rolled SNI/session callbacks through the escape hatch
   are delicate.

`bssl-tls-tokio` is an async adapter (irrelevant). `bssl-rustls-adapters` is **not a TLS
layer**: it's a `rustls::crypto::CryptoProvider` backed by BoringSSL primitives
(`bssl-rustls-adapters/src/lib.rs:26-44`) — only relevant if Bun adopted rustls.

**(c) sibling crates**: `bssl-crypto` = safe crypto primitives (AEAD/digest/EC/RSA/HKDF/
HPKE/PQC, no_std-able; API unstable, "must be updated atomically with BoringSSL",
`bssl-crypto/README.md:12-16`) — irrelevant to the socket layer, possibly useful
elsewhere. `bssl-x509` = safe X509: `X509Certificate` (DER/PEM parse, SAN, validity),
`PrivateKey::from_pem` with passphrase closure, `X509StoreBuilder`, typed chain verifier
(`bssl-x509/src/{certificates.rs:410-663, keys.rs:91-265, store.rs:47-149,
verify.rs:72-147}`) — a good fit for cert loading (§7.1) and verify-detail extraction
(§2.4) if we want safety there.

## (c) Build integration

- Bun compiles BoringSSL itself as a `DirectBuild` — objects straight into Bun's deps
  archive, **no CMake, no libcrypto.a/libssl.a produced**
  (`scripts/build/deps/boringssl.ts:44-90`, `provides.libs: []`).
- Bun's current bindings crate `bun_boringssl_sys` (`src/boringssl_sys/`) is hand-written
  externs (~115 fns), **no build.rs, no links key** — symbols resolve at final-binary
  link.
- Therefore bssl-sys **as-is cannot build** in Bun: its build.rs expects
  CMake-generated `wrapper_<target>.rs` + prebuilt static libs at `$BORINGSSL_BUILD_DIR`
  and would try to link a second BoringSSL. Clean integration path (all supported by the
  crate itself):
  1. pre-generate `wrapper_<target>.rs` per target against `vendor/boringssl/include`
     (from Bun's codegen scripts, or vendor the outputs);
  2. use the crate's Bazel-style escape: build with `--cfg bindgen_rs_file` +
     `BINDGEN_RS_FILE=<path>` (`bssl-sys/src/lib.rs:17-24`), neutering build.rs's copy
     step and link directives;
  3. add the generated static-inline `wrapper.c` shims to `boringssl.ts` sources.
  Version skew is structurally impossible (same vendored commit provides headers and
  rust/ tree).
- **Consumers of `bun_boringssl_sys`** (must keep compiling if we replace/augment it):
  see Appendix A §A.7 for the grep'd list — spanning node:crypto (EVP/HMAC/X509/etc.),
  `src/http` (client TLS + proxy tunnels), `src/uws` (SSLWrapper), `src/runtime/socket`
  (tls_socket_functions, socket_body, SSLConfig, UpgradedDuplex), sql drivers, websocket
  client. Replacing it wholesale is a large blast radius; **coexistence** (bssl-sys and
  bun_boringssl_sys both declaring externs against the same linked objects) is legal at
  link time as long as signatures agree, enabling incremental migration.

## (d) Recommendation

**Use `bssl-sys` (pre-generated bindings via `BINDGEN_RS_FILE`) as the raw layer inside a
hand-written `TlsState` state machine; do NOT build on `bssl-tls`. Optionally adopt
`bssl-x509` for cert/key loading and verify-detail extraction. Keep root_certs_* and
sni_tree as-is (or port sni_tree trivially — see A.5).**

Rationale:
1. Part 1's contract is dominated by things no safe layer expresses: the loop-shared BIO
   routing + save/restore re-entrancy protocol (§1.4), deferred-destruction
   (`ssl_in_use`/`ssl_pending_detach` + alert-swallowing BIO), write batching with the
   single spill slot and its honesty invariant (§4), the FIN-instead-of-close_notify
   half-close substitute (§5.1), parked session/keylog queues (§2.7), async-SNI
   suspension via `ssl_select_cert_retry` (§2.6), and per-SSL verify-store overrides
   (§2.1). A Rust rewrite is a port of *this* state machine; bssl-tls would sit at the
   wrong altitude even if complete.
2. bssl-tls is WIP and missing ALPN, server SNI dispatch, client-CA-list, the
   new-session callback, and PKCS12 — each a hard requirement. Filling them means
   forking its API anyway, while its ex_data-is-UB rule conflicts with our need for
   ex_data-adjacent state.
3. bssl-sys gives the complete, mechanically-generated, fork-synchronized symbol surface
   — eliminating the main risk of `bun_boringssl_sys` (hand-written signatures drifting
   from the fork) — at zero link-time cost given the `BINDGEN_RS_FILE` path.
4. bssl-tls remains valuable as a **design reference** (its AbstractReader/Writer trait
   BIO and IoStatus enums are a good shape for our TlsState's ciphertext interface), and
   bssl-x509's typed verify results map cleanly onto `us_bun_verify_error_t`.
5. Migration of the ~15 existing `bun_boringssl_sys` consumers can be incremental:
   re-export bssl-sys types from `bun_boringssl_sys` (or alias the crate) rather than a
   big-bang replacement.

---

# Appendix A — Rust/C++ periphery detail

## A.1 `us_bun_socket_context_options_t` (libusockets.h:418-440) and the JS mapping

Fields, in declaration order: `key_file_name`, `cert_file_name`, `passphrase`,
`dh_params_file_name`, `ca_file_name`, `ssl_ciphers` (`const char*`, 419-424);
`ssl_prefer_low_memory_usage` (int, 425); `key`/`key_count`, `cert`/`cert_count`,
`ca`/`ca_count` (`const char* const*` + `unsigned int` — arrays of inline PEM strings,
426-431); `secure_options` (unsigned, 432); `ssl_min_version`/`ssl_max_version` (int,
TLS1_VERSION..TLS1_3_VERSION, 0 = default, 433-435); `reject_unauthorized`,
`request_cert` (int, 436-437); `client_renegotiation_limit`/`window` (unsigned,
438-439). Effects: §7.1. Error enum `create_bun_socket_error_t` (442-448).

- Rust `#[repr(C)]` mirror: `BunSocketContextOptions`,
  `src/uws_sys/SocketContext.rs:98-121`; `Default` sets **reneg 3/600**
  (`SocketContext.rs:123-148`).
- Canonical config struct: `bun_http::ssl_config::SSLConfig`
  (`src/http/ssl_config.rs:21-53`); all strings are `dupe_z` allocations freed with a
  secure-zeroing `free_sensitive` (`ssl_config.rs:378-391`); content hash (wyhash,
  memoized) `316-368`; process-wide intern registry (content-hash + weak dedup)
  `529-654` — pointer equality of interned configs is the HTTP-client cache key (A.4).
- `asUSockets()` = `SSLConfig::as_usockets()` (`ssl_config.rs:174-219`) — 1:1 field
  projection. **Not projected: `server_name` and `protos` (ALPN)** — per-socket concerns
  applied via `SSL_set_tlsext_host_name` / `SSL_set_alpn_protos` (§2.8).
  `as_usockets_for_client_verification()` (`224-231`) forces
  `request_cert=1, reject_unauthorized=0` so the HTTP client always gets a verify result
  and enforces manually in its on_handshake.
- JS options → SSLConfig: `SSLConfigFromJs::from_generated`
  (`src/runtime/socket/SSLConfig.rs:150-241`): passphrase duped (159-162); the four
  `*File` paths existence-checked with `bun_sys::access` (163-166, 197-208);
  `serverName` sets `requires_custom_request_ctx` (167-170); `rejectUnauthorized`
  defaults from `vm.get_tls_reject_unauthorized()` (173-176); ca/cert/key accept
  string | Buffer | BunFile-Blob | arrays (189-195, helpers 299-404, empty files
  rejected); `ALPNProtocols` string/Buffer → `protos` (210-225); `ciphers` (226-230);
  reneg limit/window (232-233); returns `None` when nothing set (= "no custom TLS").
- **`sessionTimeout` and `ticketKeys` are NOT plumbed** anywhere in this layer (open
  question Q3).

## A.2 SSL_CTX digest cache

- **Digest**: `BunSocketContextOptions::digest()` (`SocketContext.rs:172-249`) —
  SHA-256 over EVERY options field, injectively framed (presence byte + terminator so
  null ≠ ""; arrays with count). The four file-name fields additionally feed
  `[mtime_sec, mtime_nsec, size]` from `stat_for_digest` (unix `stat`
  `SocketContext.rs:19-34`; Windows `GetFileInformationByHandle` following symlinks,
  matching libuv, `37-96`) so in-place cert rotation invalidates. Stat failure feeds
  zeros AND context build fails on the same path, so the entry never caches (16-18,
  206-209).
- **Cache**: `src/runtime/api/bun/SSLContextCache.rs` — per-VM
  `ArrayHashMap<[u8;32], *mut Entry>` holding **zero SSL_CTX refs**; each cached CTX
  carries an ex_data back-pointer whose `CRYPTO_EX_free` (`bun_ssl_ctx_cache_on_free`,
  `220-242`; registered via `us_ctx_cache_ex_idx`, openssl.c:362-371, 441-444)
  tombstones the entry when the real refcount hits 0 — that IS invalidation.
  `get_or_create_digest` (`96-190`): hit up-refs under mutex; miss builds outside the
  lock (file I/O) then converges on racing insert; tombstones compacted every 16 ops.
  MUST-preserve invariant: the cache key covers every input shaping the CTX (a false
  hit is a security bug); `server_name`/`protos` are legitimately excluded because they
  never enter the CTX.

## A.3 SecureContext.rs

`src/runtime/api/bun/SecureContext.rs` (struct 35-47): owns one `SSL_CTX` ref (the
CTX's own refcount is the only refcount — sockets `SSL_new()` up-ref), the options
digest, and `extra_memory` for GC accounting. `intern()` (78-84, 234) memoizes at two
levels: per-global `WeakGCMap` keyed by digest (`===` stability) + the per-VM
SSLContextCache. Users: `tls.createSecureContext`, Listener/`addContext`/SNICallback
(which can return a SecureContext to install on the in-flight SSL,
`src/runtime/socket/Listener.rs:678-681, 1016-1030, 1869-1894`), `setKeyCert`
(`tls_socket_functions.rs:878-886`), SQL clients, named pipes. `us_ssl_parse_pkcs12`
backs `pfx` via `SecureContext.parse_pkcs12` (`SecureContext.rs:95`).

## A.4 HTTP client custom-TLS contexts

`HTTPContext<const SSL: bool>` (`src/http/HTTPContext.rs:24-64`): HTTP-thread-only
intrusive refcount; `secure: Option<*mut SSL_CTX>` = one owned ref freed on deinit.
Refcount contract: cache entry holds 1; each in-flight HTTPClient with
`custom_ssl_ctx` holds 1; the two global http/https contexts never die.
Cache `CUSTOM_SSL_CONTEXT_MAP` (`src/http/HTTPThread.rs:63-82, 494-620`): keyed on the
**interned `SSLConfig` pointer**; only `requires_custom_request_ctx` configs take this
path; TTL 30 min + max 60 entries. Pooled keepalive sockets remember their
`ssl_config` SharedPtr and match by pointer on reuse, with an
`established_with_reject_unauthorized` monotonic reuse guard
(`HTTPContext.rs:167-177, 694-717`). rejectUnauthorized enforcement in
`HTTPContext::on_handshake` (`HTTPContext.rs:1141-1219`, esp. 1156-1189).

## A.5 sni_tree.cpp (verified first-hand)

Label trie: `sni_node { void* user; std::map<string_view, unique_ptr<sni_node>> }`
(`sni_tree.cpp:39-56`), labels split on `.` left-to-right, byte-wise **case-sensitive**
comparison (no normalization — callers must lowercase).

- `sni_add` (133-163): creates one node per label (label text malloc-duped); `*` stored
  verbatim; returns 1 (rejects, caller keeps ownership) when the terminal node already
  has a user — never overwrites. No label-count limit on add.
- `sni_find` (190-212) / `getUser` (92-117): hostnames with **>10 labels → NULL**
  (MAX_LABELS, 33-34, enforced 203-205). At each depth: try exact label; if that
  subtree yields no user, **fall back to the `"*"` child**. So a wildcard matches
  exactly ONE label at ANY position (`foo.*.com` works), exact beats wildcard per
  level with backtracking, and full-depth match is required: `*.example.com` matches
  `a.example.com` but NOT `example.com` or `a.b.example.com`.
- `sni_remove` (165-188): exact match only — `*` is the literal character; returns the
  user pointer (ownership back to caller); culls empty nodes upward.
- `sni_free(sni, cb)` (125-130): sets a `thread_local sni_free_cb` (37) then deletes;
  destructor runs `cb(user)` for every remaining user (44-55). No locking; the
  thread_local makes `sni_free` per-thread non-reentrant.
- Ownership summary: tree owns users only via sni_free's callback; remove transfers
  back; rejected add never frees.

## A.6 Root certs (per platform) — can stay as-is

- `root_certs.h`: pure data (Mozilla NSS-derived PEM bundle, `us_cert_string_t
  root_certs[]`).
- `root_certs.cpp` (314 lines): `std::call_once` parse of bundled PEMs +
  `NODE_EXTRA_CA_CERTS` (`136-165`; load failure warns via
  `BUN__warn__extra_ca_load_failed`); API consumed by openssl.c and NodeTLS.cpp:
  `us_internal_raw_root_certs` (tls.rootCertificates), `us_get_root_extra_cert_instances`,
  `us_get_root_system_cert_instances` (195-208, per-platform loader, on demand for
  `tls.getCACertificates('system')`), `us_get_default_ca_store` (210-254: fresh store =
  default paths + bundled + extra + system when `--use-system-ca`/`NODE_USE_SYSTEM_CA`,
  gate 31-40), `us_get_shared_default_ca_store` (262-268: process-wide immutable
  call_once store, **up-ref'd per return** — callers must free their ref; used at
  openssl.c:1026, 1104, 1321), `us_get_default_ciphers`, `us_no_password_callback`.
- `root_certs_linux.cpp` (184): `SSL_CERT_FILE`/`SSL_CERT_DIR` exclusive when set;
  else distro bundle paths + cert dirs; Android hashed-PEM stores.
- `root_certs_darwin.cpp` (575): dlopens Security.framework/CF at runtime;
  `SecItemCopyMatching` over keychain (deliberately not kSecMatchTrustedOnly — avoids
  trustd network fetches), keeps CA certs passing per-cert SSL-policy trust.
- `root_certs_windows.cpp` (153): pure WinCrypt, returns raw DER (no OpenSSL headers);
  ROOT/CA/TrustedPeople across machine+user(+GP,+Enterprise) stores, EKU
  server-auth-filtered like Node.
- **Verdict**: all self-contained behind a narrow `extern "C"` surface exchanging
  opaque `X509_STORE*`/DER; a Rust rewrite of openssl.c keeps calling them unchanged.

## A.7 `bun_boringssl_sys` consumers (blast radius of replacing the bindings crate)

Crate `bun_boringssl_sys` (`src/boringssl_sys/`, hand-rolled externs, ~126 fns, no
build.rs/links key). Cargo dependents (9): `bun_boringssl` (`src/boringssl` — safe
tier: `ssl_ctx_setup`, `init_client`, `check_server_identity`, `canonicalize_ip`;
`src/boringssl/lib.rs:19-516`), `src/csrf`, `src/http` (client contexts, ProxyTunnel,
digest), `src/runtime`, `src/s3_signing`, `src/sha_hmac`, `src/sql_jsc`, `src/uws_sys`,
root workspace. `use`-sites (33 files) include: `src/runtime/crypto/{CryptoHasher,EVP,
HMAC,PBKDF2,boringssl_jsc,pwhash}.rs` (node:crypto), `src/runtime/api/bun/{
SSLContextCache,SecureContext,x509}.rs`, `src/runtime/socket/{Listener,UpgradedDuplex,
WindowsNamedPipe*,socket_body,tls_socket_functions,uws_jsc}.rs`,
`src/runtime/webcore/Crypto.rs`, `src/sql_jsc/{jsc,mysql/MySQLConnection,
postgres/SASL,shared/ConnectionCtorArgs}.rs`, `src/uws_sys/{SocketContext,lib,socket,
us_socket_t}.rs`, `src/http/{HTTPContext,ProxyTunnel}.rs`, `src/csrf/lib.rs`,
`src/sha_hmac/sha.rs`. Most are crypto-primitive users unaffected by a TLS-layer
rewrite; the socket/uws_sys/http files are the ones the rewrite touches anyway.

## A.8 Callback surface the rewrite must preserve

- C vtable `us_socket_vtable_t` (`libusockets.h:253-266`) incl. SSL-specific
  `on_handshake(s, success, us_bun_verify_error_t, custom_data=NULL)`.
- Dispatch is Rust-owned: `us_dispatch_*` exports in
  `src/runtime/socket/uws_dispatch.rs` switch on `socket->kind` (static per-kind
  vtables via `src/uws_sys/vtable.rs::make::<Handler>()`; uWS C++ kinds use
  `group->vtable`). loop.c routes readable/writable/end into `us_internal_ssl_on_*`
  first when `s->ssl != NULL`; the decrypted re-entry into `us_dispatch_*` is the
  contract (§1.1). All dispatchers return the possibly-swapped `us_socket_t*`.
- SSLWrapper (TLS-over-duplex/pipes) consumes `us_ssl_enable_pending_events` /
  `us_ssl_pop_pending_{session,keylog}` (`libusockets.h:479-489`) — the only openssl.c
  API it uses (§6.2).

---

# Open questions

1. **Unification with SSLWrapper**: `src/uws/lib.rs::ssl_wrapper` is a second,
   near-parallel TLS state machine (memory `BIO_s_mem` pair, own 3/600 reneg policy,
   own shutdown logic) serving UpgradedDuplex / WindowsNamedPipe / HTTP proxy tunnels /
   WebSocket tunnels. Should the Rust rewrite's `TlsState` subsume it (one engine,
   ciphertext-in/ciphertext-out, with the us_socket path as one transport), or port
   openssl.c only? Recommended: design `TlsState` transport-agnostic so SSLWrapper can
   be folded in later, but scope the first PR to openssl.c parity.
2. **Loop-shared vs per-socket buffers**: the C design shares one 512 KiB plaintext
   buffer, one batch buffer, and ONE spill slot per loop (other sockets degrade to
   per-record writes while a spill is pending, §4). A Rust rewrite could give each
   socket its own bounded spill and remove the cross-socket degradation + the
   relocation hooks (§6.3). This changes observable backpressure timing slightly — is
   behavioral drift here acceptable? (I believe yes; the honesty invariant §4.4 is the
   contract, not the sharing.)
3. **`sessionTimeout` / `ticketKeys`**: not plumbed anywhere in the current layer
   (A.1). Node supports both on tls.Server. Out of scope for the rewrite, or the
   opportunity to add (`SSL_CTX_set_timeout`, `SSL_CTX_set_tlsext_ticket_keys`)?
4. **bssl-sys binding generation ownership**: pre-generate `wrapper_<target>.rs` per
   target and vendor them, or run bindgen from Bun's codegen at build time (adds a
   bindgen build dependency)? Both are supported via `BINDGEN_RS_FILE`; vendored
   outputs match how Bun handles other generated artifacts but must be regenerated on
   every BoringSSL bump (should be folded into the `upgrade-boringssl` skill).
5. **`--wrap-static-fns` shims**: some BoringSSL accessors are static-inline; the
   bindgen flow emits a `wrapper.c` that must be compiled into the deps build
   (`boringssl.ts`). Alternative: configure bindgen without `--wrap-static-fns` and
   hand-bind the few static-inline functions we actually need (BoringSSL has far fewer
   static-inlines than OpenSSL). Needs a concrete list before deciding.
6. **wolfSSL**: openssl.c has `LIBUS_USE_WOLFSSL` include paths (`openssl.c:41-46`).
   No Bun build configuration uses it; assume the rewrite drops wolfSSL support?
7. **quic.c**: shares `us_ssl_ctx_build_raw` (`openssl.c:891-893`). The rewrite must
   keep exporting an equivalent CTX builder for lsquic, or quic.c must move to the new
   Rust constructor. Which?
8. **SNI case sensitivity**: sni_tree matching is byte-wise case-sensitive (A.5);
   RFC 6066 hostnames are case-insensitive. Today correctness depends on callers
   normalizing on both add and lookup — verify Listener.rs lowercases both paths, and
   decide whether the Rust port should normalize internally (recommended).
9. **`us_socket_raw_writev` exists** (`socket.c:519`) but the batch flush uses a
   single copy + `raw_write`; a rewrite could batch via iovecs and skip the batch
   buffer copy entirely (node does memory-BIO + writev). Perf follow-up, not required
   for parity.

