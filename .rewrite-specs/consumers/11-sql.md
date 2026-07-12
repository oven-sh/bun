# Consumer-requirements inventory — SQL clients (`src/sql_jsc`) on the uSockets core

Scope: `src/sql_jsc/postgres/PostgresSQLConnection.rs` (3086 L), `src/sql_jsc/mysql/MySQLConnection.rs` (1733 L), `src/sql_jsc/mysql/JSMySQLConnection.rs` (1106 L), `src/sql_jsc/shared/ConnectionCtorArgs.rs` (137 L), `src/sql_jsc/jsc.rs` (us_* parts). All paths below are under `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU/`.

---

## 1. SocketGroup / context creation, ownership, SocketKind

**Ownership: shared per-VM, in `bun_jsc::rare_data::RareData` — NOT per-connection.** Four dedicated groups per VM:

- `src/jsc/rare_data.rs:236-239` — fields `postgres_group`, `postgres_tls_group`, `mysql_group_`, `mysql_tls_group` (`SocketGroup` by value, `SocketGroup::default()` at :314-317).
- Lazy init: `RareData::lazy_group` (`src/jsc/rare_data.rs:766-771`) — `if g.loop_.is_null() { g.init(vm.uws_loop(), None, null_mut()) }`. Accessors `postgres_group::<SSL>` (:792-800) and `mysql_group::<SSL>` (:802-810) select plain/TLS field by const generic.
- The SQL crate reaches them via extension trait `VirtualMachineSqlExt::{postgres_socket_group, mysql_socket_group}` — `src/sql_jsc/jsc.rs:287-289, 320-335`, which routes through `self.rare_data().postgres_group::<SSL>(VirtualMachine::get())`. Note the doc comment at jsc.rs:11-15: sql_jsc's own `RareData` (`mysql_context`/`postgresql_context`, jsc.rs:264-268) is *per-VM SQL state* stored in `bun_runtime::jsc_hooks::RuntimeState.sql_rare`, distinct from `bun_jsc::rare_data::RareData` which holds the SocketGroups.
- Teardown: `RareData::close_all_socket_groups` (`src/jsc/rare_data.rs:848+`) drains groups before JSC VM teardown (on_close fires into JS, needs live VM), looping because on_close handlers can open new sockets.

**SocketKind values** (`src/uws_sys/SocketKind.rs:20-64`, `#[repr(u8)]`): `Postgres = 12`, `PostgresTls = 13`, `Mysql = 14`, `MysqlTls = 15`. Stamped on the socket at creation; dispatch is a closed-world switch, no per-context vtable. `DispatchKind` is just an alias (`src/uws/lib.rs:1355`: `pub type DispatchKind = SocketKind;` — MySQL's ctor uses `uws::DispatchKind::Mysql`, Postgres uses `uws::SocketKind::Postgres`; same type).

**Per-connection TLS context**: the `SSL_CTX*` is NOT owned by the group. It comes from the per-VM digest-keyed weak `SSLContextCache` (`ConnectionCtorArgs.rs:105-122`: `vm.ssl_ctx_cache().get_or_create_opts(...)` — "Built here (not at STARTTLS time) so cert/CA errors throw synchronously; the per-VM weak `SSLContextCache` shares one `SSL_CTX*` per distinct config across pooled connections and reconnects"). The connection holds one reference (`secure: Option<*mut uws::SslCtx>`), released with `SSL_CTX_free` in deinit/cleanup (Postgres deinit `PostgresSQLConnection.rs:1467-1470`; MySQL cleanup `MySQLConnection.rs:313-316`; ctor errdefer `ConnectionCtorArgs.rs:42-50`).

---

## 2. Vtable slots, us_socket_* calls, connect path

### Vtable registration
- `src/runtime/socket/uws_dispatch.rs:63-66` — the global dispatch table: `t[SocketKind::Postgres] = vtable::make::<handlers::Postgres<false>>()`, `PostgresTls → Postgres<true>`, `Mysql → MySQL<false>`, `MysqlTls → MySQL<true>`.
- `src/runtime/socket/uws_handlers.rs:833-841` — `type Postgres<SSL> = NsHandler<PostgresSQLConnection, postgres SocketHandler<SSL>, SSL>` and `type MySQL<SSL> = NsHandler<JSMySQLConnection, mysql SocketHandler<SSL>, SSL>`.
- `NsHandler` (`uws_handlers.rs:653-700`): `type Ext = ExtSlot<Owner>` — the socket ext slot holds `Option<NonNull<Owner>>` (8-byte null-niche; layout requirement documented at `PostgresSQLConnection.rs:465-471` and `MySQLConnection.rs:350-354`). Every event reads the owner out of ext and forwards. It sets ALL of: `HAS_ON_OPEN / ON_DATA / ON_WRITABLE / ON_CLOSE / ON_TIMEOUT / ON_LONG_TIMEOUT / ON_END / ON_CONNECT_ERROR / ON_CONNECTING_ERROR / ON_HANDSHAKE`.

### Per-driver handler set (`SocketHandler<const SSL: bool>`)
Postgres (`PostgresSQLConnection.rs:1304-1379`):
- `on_open` → store socket, poll_ref.ref, start TLS or startup (:1333, :859-874)
- `ON_HANDSHAKE: Option<fn(...)> = if SSL { Some(on_handshake_) } else { None }` (:1347-1349) — TLS-only slot
- `on_close` / `on_end` → both route to `PostgresSQLConnection::on_close` (:1351-1362); note comment at :1321-1322: on_close/on_end "intentionally do NOT route through" the VM-shutdown `guarded` wrapper — they forward unconditionally
- `on_connect_error` (:1364), `on_timeout` (:1368 — Postgres's on_timeout is a debug-log no-op, :936-938), `on_data` (:1372), `on_writable` → `on_drain` (:1376)
- Six of eight shims run through `guarded()` (:1324-1331): if `vm().is_shutting_down()` → `this.close()` instead.

MySQL (`JSMySQLConnection.rs:944-1074`): same shape; differences: `on_open` also stamps `Status::Handshaking` and takes a socket ref only for the first (TCP) open — "When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status" (:963-968); `on_end` closes the socket directly ("no half closed sockets", :1028-1031); `on_timeout` fails with `ConnectionTimedOut` (:1037-1039); `on_close` releases the socket ref taken in on_open via `DerefOnDrop` (:1001-1026).

### us_socket_* / uws API surface actually used
Via `uws::AnySocket` / `SocketTCP` / `us_socket_t` (`src/uws_sys/socket.rs:920-983`, `src/uws_sys/us_socket_t.rs`):
- `write(&[u8]) -> i32` — Postgres `flush_data` :689, `start_tls` :849; MySQL `flush_data` :260
- `close(CloseKind::Normal)` — Postgres `ref_and_close` :1544; MySQL `close` :275, `on_end` JSMySQL :1030
- `set_timeout(seconds)` — Postgres sets 300 s after ReadyForQuery (:2527), MySQL clears (`set_timeout(0)`) at data-processing start (:480)
- `is_closed()` — pending-activity/GC gating (Postgres :616, :1540)
- `get_native_handle()` → `SSL*` for hostname verification (Postgres :899-903; MySQL :442-446)
- `ext::<Option<NonNull<Owner>>>()` — repointed after adopt_tls (Postgres :496-497; MySQL :377-378)
- `adopt_tls(...)` + `start_tls_handshake()` — see §4
- `SocketTCP::connect_group` / `connect_unix_group` — see below

### Connect
Both drivers connect **plain TCP first**, into the non-TLS group, regardless of ssl_mode:
- Postgres `call()` (`PostgresSQLConnection.rs:1251-1288`): comment :1254-1256 — "Postgres always opens plain TCP first (SSLRequest happens in-band), so even `ssl_mode != .disable` lands in the TCP group; `setupTLS()` adopts into `postgres_tls_group` after the server's `S`." If `path` non-empty → `uws::SocketTCP::connect_unix_group(group, SocketKind::Postgres, None /*ssl_ctx*/, path, ptr, false /*half-open*/)` else `connect_group(group, SocketKind::Postgres, None, hostname, port, ptr, false)`.
- MySQL `create_instance` (`JSMySQLConnection.rs:558-597`): identical shape with `DispatchKind::Mysql`; comment :561-562 — "MySQL always opens plain TCP first; STARTTLS adopts into the TLS group after the SSLRequest exchange."
- **DNS**: no explicit DNS layer in the client — `connect_group` (`src/uws_sys/socket.rs:757-815`) NUL-terminates the host (256-byte stack buffer, heap fallback), strips IPv6 brackets (`[::1]` → `::1`, "getaddrinfo doesn't understand bracketed IPv6 literals"), and defers resolution to `SocketGroup::connect` (getaddrinfo inside uSockets). It returns `ConnectResult::{Failed, Socket(connected), Connecting(cs)}` — the owner pointer is written into the ext of *either* the connected or the connecting socket; the SQL structs start with `InternalSocket::Detached` (Postgres :1189-1191; MySQL default :96/:149) until `on_open` delivers the real socket (`on_open` overwrites `self.socket`, Postgres :860; MySQL :961).
- **Unix sockets**: `connect_unix_group` (`socket.rs:818-843`) — always returns `Connected` or error; same ext-write.
- Synchronous connect failure → `PostgresSQLConnection::deinit(ptr)` + throw (:1282-1287); MySQL → `Self::deref(ptr)` + throw (:584-593).

---

## 3. Where the socket ref lives; AnySocket; detach

- **Postgres**: `pub socket: JsCell<Socket>` where `type Socket = uws::AnySocket` (`PostgresSQLConnection.rs:50, 97`). The connection struct is the `m_ctx` payload of the JS wrapper (`JsClass::to_js` transfers Box ownership, :63-67); the JS object back-ref is `js_value: JsCell<JsRef>` stored **weak** (:130-133 — "Stored as a weak `JsRef`, never a bare `JSValue` — this struct is heap-allocated and the conservative GC scan covers stack/registers only"). GC-vs-liveness is mediated by `pending_activity_count: AtomicU32` + `has_pending_activity` (:597-600, GC-thread-safe atomic read).
- **MySQL**: two-layer — protocol struct `MySQLConnection` has `socket: Socket` (= `uws::AnySocket`, `MySQLConnection.rs:52`), and is embedded *by value* inside the JS wrapper: `JSMySQLConnection.connection: JsCell<my_sql_connection::MySQLConnection>` (`JSMySQLConnection.rs:67`). Recovery in the other direction is `container_of`: `bun_core::impl_field_parent! { MySQLConnection => JSMySQLConnection.connection; ... }` (`MySQLConnection.rs:129`). Unlike Postgres (weak js_value + pending-activity), MySQL uses a **strong→weak toggling JsRef**: `update_reference_type` (`JSMySQLConnection.rs:440-462`) upgrades `js_value` to strong while the connection is active, downgrades when not; ctor starts strong (`r.set_strong(js_value, ...)`, :603-604).
- **AnySocket** is the TCP/TLS union (`src/uws_sys/socket.rs:920-924`: `enum AnySocket { SocketTcp(SocketTCP), SocketTls(SocketTLS) }`, `Copy`), each wrapping `InternalSocket` (`Copy` tagged raw pointer: `Connected(*mut us_socket_t) | Connecting(..) | Detached | ...`, socket.rs:56+). All ops forwarded via `any_socket_forward!` (:926-983).
- **Detach**: no explicit "detach on close" call from these clients — the sockets start `Detached` (before connect completes); after `adopt_tls`, the *old* TCP pointer is dead ("`self` is invalid after", `us_socket_t.rs:261`; "adopt_tls may realloc and return a different ptr", PostgresSQLConnection.rs:474) and `self.socket` is overwritten with the new TLS variant (Postgres :498-500; MySQL :379-381). Post-close, callbacks check `socket.get().is_closed()`; the ext owner pointer is nulled implicitly by socket teardown (NsHandler bails on `None` owner, uws_handlers.rs:674).

---

## 4. TLS

### ssl_mode plumbing (shared)
`ConnectionCtorArgs.rs:11-34` — one postgres-shaped 5-value enum for BOTH drivers: `[Disable, Prefer, Require, VerifyCa, VerifyFull]` (index-decoded from JS int, out-of-range → `Disable`, :78-83); "the JS side (`normalizeSSLMode` in src/js/internal/sql/shared.ts) normalizes each driver's accepted ssl-mode spellings to this one wire enum, so MySQL's native ssl-mode vocabulary never crosses this boundary." When ssl_mode ≠ Disable, `tls` arg must be `true` or an object → `SSLConfig::from_js` (jsc.rs:492-504, via `SqlRuntimeHooks`); `SSL_CTX*` is built eagerly at ctor time from `tls_config.as_usockets_for_client_verification()` (**request_cert=1, reject_unauthorized=0 at the uSockets level** — "SQL re-verifies hostname itself", jsc.rs:507-522; ctor comment :105-109).

### Postgres SSLRequest → mid-stream upgrade on the same fd
1. `tls_status` starts `Pending` if ssl_mode ≠ Disable (:1223-1227).
2. `on_open` → `start_tls()` (:865-870): writes the 8-byte SSLRequest `[00 00 00 08, 04 D2 16 2F]` on the **plain** socket, tracking partial writes in `TLSStatus::MessageSent(count)` (:838-857); `on_drain` resumes a partial SSLRequest before anything else (:944-949: "Don't send any other messages while we're waiting for TLS").
3. Server's 1-byte `S`/`N` reply is handled in `PostgresRequest::on_data` dispatch (outside this file), which calls **`setup_tls()`** (:427-504). This is the exact upgrade API:
   - Require current socket to be `Socket::SocketTcp` with `InternalSocket::Connected(raw)` (:435-448).
   - `tls_group = vm.postgres_socket_group::<true>()` (:431).
   - **`(&mut *raw).adopt_tls(tls_group, SocketKind::PostgresTls, ssl_ctx, sni, /*is_client*/ true, ext_size, ext_size)`** (:475-483) — `adopt_tls` = `us_socket_adopt_tls` (`src/uws_sys/us_socket_t.rs:277-302`): moves the *same fd* into the TLS group, re-stamps kind → `PostgresTls`, attaches a fresh `SSL*` from the cached `SSL_CTX` (refcounted by C for the socket's lifetime), applies SNI. **It may realloc and return a different `us_socket_t*`; the old pointer is invalid.** It deliberately does NOT start the handshake: "Does NOT kick the handshake — the caller must repoint `ext` first (so any dispatch lands in the new owner) and then call `start_tls_handshake`" (us_socket_t.rs:271-275).
   - Repoint ext: `*sock.ext::<Option<NonNull<PostgresSQLConnection>>>() = NonNull::new(self.as_ctx_ptr())` (:496-497), swap `self.socket` to `Socket::SocketTls` (:498-500), then `sock.start_tls_handshake()` (= `us_socket_start_tls_handshake`, sends ClientHello) and immediately `self.start()` (startup message goes into write_buffer; actual bytes flow post-handshake) (:502-503).
   - Failure at any step → `fail(b"Failed to upgrade to TLS", TLSUpgradeFailed)`.
   - There is also `us_socket_t::tls_feed` (us_socket_t.rs:311-333) for replaying already-read plaintext through the decrypt path — **not used by the SQL clients** (they upgrade only at a clean protocol boundary).

### MySQL SSL switch
- `handle_handshake` (`MySQLConnection.rs:689-708`): if negotiated `capabilities.CLIENT_SSL`, write the `SSLRequest` packet, set `tls_status = MessageSent`, flush; if no backpressure, `upgrade_to_tls()` immediately, else deferred to `flush_queue` (:218-230: `if tls_status == MessageSent { upgrade_to_tls() }` after drain).
- **CVE-2021-23222-class guard** (:599-609): after sending SSLRequest, any plaintext bytes still buffered behind the handshake packet are rejected (`UnexpectedPacket`) — "Any bytes already buffered behind the handshake packet are plaintext a man-in-the-middle could have injected".
- `upgrade_to_tls` (:320-385) is byte-for-byte the same pattern as Postgres: TCP+Connected precondition → `mysql_socket_group::<true>()` → `adopt_tls(tls_group, SocketKind::MysqlTls, ssl_ctx, sni, true, ext_size, ext_size)` → repoint ext to `Option<NonNull<JSMySQLConnection>>` → swap `self.socket` to TLS → `start_tls_handshake()`. Handshake-response (auth) is sent from `do_handshake` after the TLS handshake succeeds (:466).
- If server lacks CLIENT_SSL: `tls_status = SslNotAvailable`; `Require|VerifyCa|VerifyFull` → hard fail `AuthenticationFailed`; `Prefer|Disable` continue plaintext (:709-722).
- caching_sha2 full-auth over plain TCP requires opt-in `allow_public_key_retrieval`, else `PublicKeyRetrievalNotAllowed` (:827-842).

### Verify errors / reject_unauthorized
- Postgres `on_handshake` (:876-934): on `success == 1`, checks are gated on `tls_config.reject_unauthorized() != 0` AND `ssl_mode ∈ {VerifyCa, VerifyFull}` (link to porsager/postgres semantics at :883). VerifyCa: `ssl_error.error_no != 0` → `verify_error_to_js` (`us_bun_verify_error_t` → JS, canonical impl `bun_jsc::system_error::verify_error_to_js`, re-exported jsc.rs:77) → `fail_with_js_value`. VerifyFull additionally: pull `SSL*` via `get_native_handle()` and `BoringSSL::check_server_identity(ssl, hostname-from-SNI)`; missing server_name ⇒ fail. `Require|Prefer` skip verification ("require is the same as prefer", :922-923). On `success != 1` the connection always fails "no matter if reject_unauthorized is false because we are disconnected by the server" (:926-933).
- MySQL `do_handshake` (:405-473): same policy; VerifyFull with null server_name **fails closed** (:432-440); failure sets `tls_status = SslFailed`, returns `Ok(false)`, and `JSMySQLConnection::on_handshake_` converts to `verify_error_to_js` + `fail_with_js_value` (JSMySQLConnection.rs:975-994).
- `ON_HANDSHAKE` handler is compiled in only for `SSL = true` monomorphizations in both drivers.

---

## 5. Timeouts & keepalive

- **Two intrusive `EventLoopTimer`s per connection** (not uSockets timers): `timer` — "Before being connected, this is a connection timeout timer. After being connected, this is an idle timeout timer" (PostgresSQLConnection.rs:164-170; JSMySQLConnection.rs:73-77); `max_lifetime_timer` — max connection lifetime, starts post-handshake (:172-177 / :79-84). Inserted/removed in the VM timer heap via `SqlRuntimeHooks::{timer_insert,timer_remove}` (jsc.rs:213-216, 374-386). Container-of recovery via `impl_timer_owner!` (Postgres :181-184; MySQL :87-90). Tags: `PostgresSQLConnectionTimeout/MaxLifetime`, `MySQLConnectionTimeout/MaxLifetime` (:1236-1242 / :545-550).
- Interval selection: `get_timeout_interval` — Connected → `idle_timeout_interval_ms` (MySQL only when queue is idle, JSMySQLConnection.rs:233-244), Failed → 0, else `connection_timeout_ms` (Postgres :378-384). `reset_connection_timeout` skips while `IS_PROCESSING_DATA` (Postgres :395-418; MySQL :246-263) and is re-armed after each data batch (Postgres on_data tail :1070; MySQL on_data defer :1048-1056). Timer fire paths: `on_connection_timeout` (Postgres :522-562 — distinguishes `ERR_POSTGRES_IDLE_TIMEOUT` vs `ERR_POSTGRES_CONNECTION_TIMEOUT`, with " (sent startup message, but never received response)" suffix for `SentStartupMessage`; MySQL :265-306 with " (during authentication)"), `on_max_lifetime_timeout` (:564-583 / :308-326).
- **uSockets socket timeout is used too**: Postgres `socket.set_timeout(300)` on every ReadyForQuery (:2527) — a 300 s wire-level backstop whose `on_timeout` is a **no-op** (:936-938, debug log only); MySQL `socket.set_timeout(0)` clears it when data processing starts (:480) and its `on_timeout` fails the connection (JSMySQLConnection.rs:1037-1039).
- **Event-loop keepalive** (`poll_ref: KeepAlive`, not TCP keepalive — no SO_KEEPALIVE anywhere in these files): ref while connecting / work pending, unref when Connected+idle. Postgres: ref at ctor (:1294), ref/unref in on_data tail (:1057-1066), `update_ref()` from `update_has_pending_activity` (:3046-3061), unref on Connected (:651), ref-before-close so "event loop need to be alive to close the socket ... will unref on socket close" (:1540-1544), explicit unref in `close()` for the in-flight-connect path (:1408-1411). MySQL: `update_reference_type` (JSMySQLConnection.rs:440-462) does both the poll_ref and the strong/weak js_value toggle.
- **No TCP keepalive / no allow_half_open**: both connects pass `allow_half_open=false`; MySQL `on_end`: "no half closed sockets" → immediate close (JSMySQLConnection.rs:1028-1031); Postgres `on_end` → treated as close (:1360-1362).

---

## 6. Unusual lifecycle — re-entrancy, deferred deinit, close-guard state machine

This is the hairiest section for a Rust rewrite of the core; the client code is built around it.

### Intrusive refcount + ref-bracketing around every callback that can re-enter JS
Both wrappers use `#[derive(bun_ptr::CellRefCounted)] #[ref_count(destroy = Self::deinit)]` (Postgres :94-95; JSMySQL :49-50). Patterns:
- Postgres `on_data` (:976-1073): `self.ref_()` at entry, `unsafe { Self::deref(self.as_ctx_ptr()) }` at exit; likewise `on_auto_flush_impl` (:315-339) and `fail_with_js_value` (:704-740).
- MySQL uses RAII `DerefOnDrop` / `ref_guard()` (JSMySQLConnection.rs:100-118) with LIFO ordering so the guard drops *after* the scopeguard defer bodies (`close` :362-381, `fail_with_js_value` :726-742, `SocketHandler::on_data` :1041-1056). `on_close` **adopts** the socket's ref rather than taking a new one: "Releases the socket ref taken in on_open. RAII guard adopts that existing ref (no `ref_()` here); raw-pointer shaped so no reference outlives the potential free" (:1007-1010).

### UAF-discipline comments, verbatim

R-2 header (PostgresSQLConnection.rs:84-93):
> R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). `&mut self` carried LLVM `noalias`, but JS callbacks (promise rejections, on_close, query results) can re-enter via a fresh `&mut Self` from `m_ctx` and mutate e.g. `self.requests`/`self.flags` while the original `&mut self` is still live — `clean_up_requests` was ASM-verified PROVEN_CACHED. Migrating to `&self` + `UnsafeCell`-backed fields makes the miscompile structurally impossible (UnsafeCell suppresses `noalias` on `&T`).

`clean_up_requests` (:1477-1483):
> R-2: `&self` carries no `noalias`; every field accessed below is `Cell`/`JsCell`-backed, so re-entrant JS callbacks (promise reject → user `.catch()` → new query enqueue) that mutate `self.requests` through a fresh `&Self` from `m_ctx` are sound. The previous black_box launder (b818e70e1c57-style) is no longer needed. The connection is kept alive by the caller's `ref_and_close` ref bracket for the duration of this loop, so re-entry never frees `*self`.

`update_has_pending_activity` — SSL-close deferral / GC ordering (:610-616):
> Terminal states: nothing more will happen on this connection, so allow GC to collect the JS wrapper (and ultimately call deinit()). We must still outlive the socket's onClose callback — for SSL sockets `close(.normal)` defers the actual close until the peer's close_notify arrives, so the struct must stay alive until then. The socket's onClose re-enters here (via failWithJSValue's defer) with isClosed() == true, at which point GC can proceed.

`deinit` receiver shape (:1441-1445):
> Raw-pointer receiver: this function ends in `heap::take(this)`. A `&mut self` argument would carry a Stacked Borrows protector for the whole frame, and freeing the allocation while that protector is live is UB ("deallocating while item is protected"). Taking `*mut Self` and reborrowing per-call keeps each `&mut` scoped strictly before the dealloc.

`finalize` panic-safety (:658-663):
> Refcounted: release the JS wrapper's +1; allocation may outlive this call if other refs remain, so hand ownership back to the raw refcount FIRST so a panic in the work below leaks instead of UAF-ing siblings.

MySQL `DerefOnDrop` (JSMySQLConnection.rs:94-99):
> RAII owner for one intrusive refcount on a `JSMySQLConnection`. Dropping calls [`JSMySQLConnection::deref`], which may free `*self.0` — so callers must not hold a live `&`/`&mut JSMySQLConnection` across the guard's drop point.

MySQL `handle_command` (MySQLConnection.rs:935-937):
> Queue holds a ref on every request; bump it for the body's duration so re-entrant `deref()` cannot free it.

MySQL error-packet copy (:974-977):
> `Data` is not `Clone`, so deep-copy the message bytes into an owned packet up front — re-entrant JS in `on_error_packet` may release the statement, so the packet handed to it must not borrow into it.

adopt_tls ordering (us_socket_t.rs:272-275 + call sites):
> Does NOT kick the handshake — the caller must repoint `ext` first (so any dispatch lands in the new owner) and then call `start_tls_handshake`.
> ext is now repointed; safe to kick the handshake (any dispatch lands here). (PostgresSQLConnection.rs:501; MySQLConnection.rs:382)

### Close/fail state machine
- `Status::Failed` is terminal and sticky: `set_status` refuses any transition out of Failed (Postgres :627-631: "`Failed` is terminal: `fail_with_js_value` already closed the socket and rejected every pending request. Nothing may transition out of it."); `fail_with_js_value` early-returns if already Failed (:708-711; MySQL JSMySQLConnection.rs:745-747). This is the guard against double-fail from close→on_close→fail loops.
- Ordering in `fail_with_js_value` (Postgres :704-740): stop timers → set Failed → invoke JS `onclose` callback **first** ("we defer the refAndClose so the on_close will be called first before we reject the pending requests", :716) → `ref_and_close` (poll_ref.ref, `socket.close(Normal)`, `clean_up_requests`) → deref → update pending activity.
- **Close while connect in flight gets NO socket event** — both drivers must synthesize the failure themselves. Postgres `close()` (:1393-1411): "A close while the connect/handshake is still in flight gets no socket event: uws skips the on_close dispatch for sockets whose connect never completed, and `disconnect()` only tears down connected sockets. Fail the connection directly so the JS onclose callback fires, pending queries are rejected, and the in-flight socket is torn down instead of completing the handshake after close." + ":1408-1410 closing an in-flight connect dispatches no socket event, so the poll ref taken at creation is released here rather than in a socket callback". MySQL `do_close` mirrors it (JSMySQLConnection.rs:644-651). **This is a hard behavioral requirement on the rewritten core** (or the clients must be changed if the new core does dispatch on_close for pending connects).
- `on_close` before startup completes is reported as `ConnectionFailed` ("Connection closed before the connection was established") rather than `ConnectionClosed` — Postgres :774-788, MySQL JSMySQLConnection.rs:1011-1025.
- VM-shutdown short-circuit everywhere: `guarded()` shims, `handle_socket_failure` (:796-817), `drain_internal`, `clean_up_requests`, MySQL `on_data` — during `vm().is_shutting_down()` no JS is entered, queue is just cleaned.
- Event-loop enter/exit brackets around any path that runs JS from a socket callback (`event_loop().enter()/exit()` — Postgres :719/:734, :960-973, :982/:1055; MySQL `entered()` guard :391, :1062).
- Deferred flushing: `AutoFlusher` deferred-microtask (jsc.rs:393-426) registered per connection; unregistered on failure/close paths before teardown (`unregister_auto_flusher` in `handle_socket_failure` :797, `close` :1415, deinit).
- `deinit` teardown order — Postgres (:1446-1473): disconnect → stop timers → deref all cached prepared statements → **volatile-zero `options_buf`** (password material) → `SSL_CTX_free(secure)` → `heap::take`. MySQL `cleanup` (MySQLConnection.rs:293-318) equivalent (no volatile zeroing of options_buf — MySQL keeps `password` as its own Box, freed by Drop).

---

## 7. Migration notes for a Rust uSockets-core rewrite

1. **`adopt_tls` semantics are the single most load-bearing API.** Must support: same-fd migration from a plain group to a TLS group, kind restamp, ext resize/preserve, `SSL_CTX` attach (context refcounted for the socket lifetime), SNI, is_client, **possible pointer relocation** (both clients treat the return as a fresh pointer and consider the old one invalid), and **handshake decoupled from adoption** (`start_tls_handshake` separate so ext can be repointed first — any dispatch between adopt and repoint would hit stale/unsized ext).
2. **Ext slot ABI**: exactly 8 bytes read as `Option<NonNull<Owner>>` by the dispatch trampolines (documented three times — PostgresSQLConnection.rs:465-471, MySQLConnection.rs:350-354, socket.rs:759-762+797-801). A 16-byte `Option<*mut T>` layout silently corrupts dispatch. The rewrite should either keep this contract or type the slot in the core.
3. **Closed-world SocketKind dispatch**: kinds `Postgres/PostgresTls/Mysql/MysqlTls` with a static vtable table (uws_dispatch.rs:63-66). Adding/renumbering kinds is cross-checked from C (`from_u8` exhaustive match, `BUN_SOCKET_KIND_*` exports). Keep restamping (`set_kind`/adopt) cheap.
4. **Connect API requirements**: `connect_group` must (a) accept unresolved hostnames (getaddrinfo inside the core; bracketed-IPv6 stripping currently done in the Rust shim), (b) return a tri-state (Failed / already-Connected / Connecting) with ext writable in both live states, (c) support `allow_half_open` flag (SQL passes false), and a unix-path variant returning a connected socket synchronously. Errors before any event dispatch must be returnable synchronously (clients deref/deinit and throw).
5. **on_close suppression for never-completed connects** (see §6): both clients *depend* on uws skipping on_close for a socket whose connect never completed, and compensate manually in `close()`. If the new core changes this, the compensation becomes a double-fail — sticky `Status::Failed` would absorb it, but poll_ref accounting (Postgres :1408-1411) would double-unref. Preserve or renegotiate.
6. **SSL `close(Normal)` is deferred until peer close_notify** (update_has_pending_activity comment, :610-616). The struct must stay alive until the eventual on_close; GC gating (`pending_activity_count`) encodes this. The rewrite must keep on_close guaranteed-eventually-delivered for adopted TLS sockets, including after `close(CloseKind::Normal)`.
7. **Callback re-entrancy contract**: every event handler can synchronously re-enter arbitrary connection methods (via JS) including `close()`/`deref()`. Handlers are dispatched with owner recovered from ext (NsHandler forms `&mut Owner`, but the client immediately reborrows as `&self` per R-2). The core must tolerate `us_socket_close`/`write`/`set_timeout` being called from within any of its own callbacks, and must not touch the ext owner after on_close.
8. **Groups are per-VM and lazily initialized against `vm.uws_loop()`**; teardown order matters (`close_all_socket_groups` must run before JSC teardown, and must iterate the loop's linked-group list, looping because on_close can create new sockets — rare_data.rs:848+).
9. **Timeout API**: `us_socket_timeout(seconds)` granularity is used as a coarse backstop (300 s Postgres, cleared-per-read MySQL); the real timeouts are event-loop timers owned by the clients. `on_timeout` must be per-socket and non-fatal by default (Postgres ignores it).
10. **SSL_CTX ownership split**: the core never owns the client `SSL_CTX` — the connection holds one cache reference and frees it with `SSL_CTX_free`; `adopt_tls` must take an additional ref (or the C-side "refcounted by the C side for the socket's lifetime" note must be reproduced). Verification is done in the *client* (request_cert=1, reject_unauthorized=0 at core level; hostname check via `get_native_handle() → SSL*` + `check_server_identity`) — so `get_native_handle` must keep returning the live `SSL*` inside on_handshake, and `on_handshake(success, us_bun_verify_error_t)` must keep delivering the packed verify error (`error_no` + string codes consumed by `verify_error_to_js`).
11. **Partial-write tolerance during pre-TLS phase**: Postgres tracks partial SSLRequest writes (`TLSStatus::MessageSent(count)`) and resumes on `on_writable`; `write()` returning `< len` (or negative) must map to backpressure + a later `on_writable`, even for the 8-byte pre-TLS write.
12. **MySQL plaintext-injection guard** requires that after `adopt_tls`, no already-buffered plaintext is replayed through on_data (the client rejects any residue itself, MySQLConnection.rs:599-609; `tls_feed` exists in the core for consumers that need replay, but SQL must NOT get post-upgrade delivery of pre-upgrade bytes).
