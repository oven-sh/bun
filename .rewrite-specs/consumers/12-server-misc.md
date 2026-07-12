# Consumer-Requirements Inventory: DIRECT uSockets-core usage (Rust runtime consumers)

Scope: direct `us_socket_*` / socket-context / Loop / SocketGroup / timer usage in the listed consumers. The uws C++ App/Response shim itself (`src/uws_sys`, `src/uws`) is described only where consumers reach *through* it to raw `us_*` behavior. All paths relative to `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU`.

---

## 0. Reference: the binding surface consumers depend on

- `src/uws_sys/us_socket_t.rs:19` — `bun_opaque::opaque_ffi! { pub struct us_socket_t; }`; full method surface at lines 43–378: `open/pause/resume/close/shutdown/shutdown_read/is_closed/is_shut_down/is_tls/write_check_error/local_port/remote_port/local_address/remote_address/timeout/long_timeout/nodelay/keepalive/set_tos/get_tos/sni_resolve/get_native_handle/ext/ext_raw/group (us_socket_group, "never returns null for a live socket")/kind (us_socket_kind)/set_kind/adopt (us_socket_adopt — "C may realloc and return a different us_socket_t*")/adopt_tls (us_socket_adopt_tls)/start_tls_handshake/tls_feed/set_ssl_raw_tap/write/write_fd (us_socket_ipc_write_fd, POSIX only, `unreachable!` on Windows at line 378)/raw_writev (:407)/raw_write (:421)`.
- `src/uws_sys/SocketKind.rs:20-64` — **closed-world SocketKind enum stamped on every socket**: `Invalid=0, Dynamic=1, BunSocketTcp=2, BunSocketTls=3, BunListenerTcp=4, BunListenerTls=5, HttpClient=6, HttpClientTls=7, WsClientUpgrade=8, WsClientUpgradeTls=9, WsClient=10, WsClientTls=11, Postgres=12, PostgresTls=13, Mysql=14, MysqlTls=15, Valkey=16, ValkeyTls=17, SpawnIpc=18, UwsHttp=19, UwsHttpTls=20, UwsWs=21, UwsWsTls=22`. Header comment: dispatch is a per-kind exhaustive match in `dispatch.rs`; "Add a `SocketGroup` field to whatever owns the sockets." Bun.serve sockets are `UwsHttp/UwsHttpTls/UwsWs/UwsWsTls` — "handlers live in C++; dispatch calls a thunk and the thunk reads `group->ext` as the templated `HttpContext<SSL>*`" (SocketKind.rs:58-60).
- `src/uws/lib.rs` (`bun_uws`) is a thin re-export facade: re-exports `us_socket_t`, `SocketGroup`, `SocketKind`, `NewApp`, `Request`, `AnyWebSocket`, `WebSocketUpgradeContext`, `SslCtx = bun_boringssl::c::SSL_CTX` (lib.rs:22-50), plus the `#[uws_callback]` proc-macro (extern-"C" thunk generator — *not* a socket API).
- `AnyResponse::socket()` (`src/uws_sys/Response.rs:109-110, 817-822`) — a `uws_res*` **is** a `us_socket_t*`: `downcast_socket()` is a pointer cast; consumers holding an `AnyResponse` are one cast away from the raw socket.

---

## 1. Bun.serve response path (`src/runtime/server/`)

### 1.1 `NodeHTTPResponse.rs` (node:http on top of Bun.serve)

- **Socket-ref storage/lifetime**: `pub raw_response: Cell<Option<uws::AnyResponse>>` (NodeHTTPResponse.rs:39) inside an intrusively refcounted `#[JsClass]` struct; the `*mut NodeHTTPResponse` is the m_ctx payload of the JS wrapper (lines 25-27). Cleared to `None` on abort/upgrade/completion. `Flags` (lines 68-78): `SOCKET_CLOSED, REQUEST_HAS_COMPLETED, ENDED, UPGRADED, HAS_CUSTOM_ON_DATA, IS_REQUEST_PENDING, IS_DATA_BUFFERED_DURING_PAUSE, IS_DATA_BUFFERED_DURING_PAUSE_LAST` — every raw-socket op is gated on `SOCKET_CLOSED|UPGRADED`.
- **Below-shim ops** (all through `AnyResponse`, which forwards to `uws_res_*` C shims that hit `us_socket_*`):
  - `pause_socket()` / `resume_socket()` → `raw.pause()` / `raw.resume_()` (:353, :369) → `uws_res_pause/resume` → `us_socket_pause/us_socket_resume`. Purpose comment at :50-53: *"When you call pause() on the node:http IncomingMessage / We might've already read from the socket. / So we need to buffer that data."* → the `buffered_request_body_data_during_pause: JsCell<Vec<u8>>` side-buffer (:54).
  - `end()` (:1836): *"We dont wanna a paused socket when we call end, so is important to resume the socket"* → `self.resume_socket()` before `write_or_end::<true>`.
  - Raw socket extraction: `Bun__getNodeHTTPServerSocketThisValue(any_response_is_ssl(&raw), raw.socket().cast())` (:347) — casts the response to the underlying `us_socket_t*` and hands it to C++.
  - Timeout: `set_timeout` → `raw.timeout(seconds)` (:1879), `ffi_set_timeout` → `raw.timeout(secs)` (:2153), `clear_timeout` at :1130, :1178, :1213, :1568; idle-timeout callback registration `raw_response.on_timeout(on_timeout_shim, self.as_ctx_ptr())` (:609).
  - Cork: `raw_response.corked(|| ...)` (:1934), `raw_response.uncork()` (:1769), `is_corked()` + deferred auto-flush task (:1821-1823).
  - Callback adapters at :242-260 (`on_timeout_shim`, `on_data_shim`, `on_buffer_paused_shim`, `on_drain_shim`) — capture-less `fn(*mut NodeHTTPResponse, ...)` re-derefing the userdata pointer as `&self`.
- **UAF/lifetime comments (quoted)**:
  - :469-471 (WebSocket upgrade): *"the underlying HttpParser::fallback buffer is freed when uWS adopts the socket above, so set_on_aborted_handler (which would call preserve_web_socket_headers_if_needed) must not run post-upgrade — it would read freed header views."*
  - :925-928 (abort while completed): *"Clear `raw_response` first so the `clear_on_data_callback` reached from `mark_request_as_done` can't touch the dead socket."*
  - :971-975: *"`raw_response` is cleared before `deref()` because `mark_request_as_done_if_necessary()` + `deref()` can drop the last ref when the JS wrapper has already finalized; nothing between them reads `raw_response`, so clearing first avoids a post-destroy write."*
  - :1046-1054 (pause buffer → JSC): *"`Vec` Drops, so the prior `create_buffer(slice_mut)` + `= Vec::new()` freed the backing allocation while JSC still pointed at it (mimalloc free-list pointer overwrote the first 8 bytes — test-http-pause.js saw `'�\x01xУ\x02\x00\x00Body from Client'`). Move the Vec out and hand the boxed slice to JSC so the deallocator owns the only free."*
  - :508-513: *"Once the socket is closed or has been adopted by the WebSocket layer, the HTTP request/response cycle is over — no further uws callbacks will arrive on `raw_response` to balance the IS_REQUEST_PENDING ref."*
- **Migration notes**: a Rust core must provide (a) socket-level pause/resume reachable from the response handle *with* a data-buffered-during-pause discipline (uWS may deliver one more chunk after pause), (b) per-response timeout set/clear in seconds (u8), (c) cork/uncork with re-entrancy-safe closures (`corked()` runs JS which can re-enter any `&self` method — see the R-2 `noalias` note at :1926-1932 about a real miscompile, commit b818e70e1c57), (d) response→raw-socket downcast for the JS "socket" object, (e) callbacks that tolerate the holder clearing its handle mid-callback.

### 1.2 `FileResponseStream.rs` — the deepest below-shim consumer (sendfile)

- **Ext/lifetime**: heap-allocated, intrusive refcount; *"Heap-allocate; the raw pointer is handed to uWS callbacks and freed via `heap::take` in `deref()` when the intrusive refcount hits 0"* (:121-122). `resp: AnyResponse` stored by value (Copy raw handle) at :125; `on_aborted`/`on_writable` userdata is `*mut FileResponseStream` (:151-156, :285-292, :416-423).
- **Sendfile state** (`Sendfile` struct usage :167-173): `socket_fd: opts.resp.get_native_handle()` — **extracts the raw socket fd from the response** (`uws_res_get_native_handle` → `us_socket_get_native_handle`, Response.rs:296-310) — plus `offset`, `remain`, `has_set_on_writable`.
- **Below-shim sequence** (Linux/Android only):
  1. `resp.prepare_for_sendfile()` (:175 → `uws_res_prepare_for_sendfile`, Response.rs:168) — flush headers/uncork so the kernel write starts at the body.
  2. Direct kernel `sys::linux::sendfile(self.sendfile.socket_fd.native(), self.fd.native(), &raw mut off, adjusted)` (:370-378) in a `EINTR` loop, bypassing uSockets' write path entirely.
  3. On `EAGAIN`/partial: `arm_sendfile_writable()` (:412-425) — registers `resp.on_writable` once, then `resp.mark_needs_more()` (:424) → `us_socket_mark_needs_more_not_ssl` (Response.rs:398-401, non-SSL only) — i.e. **manually re-arm EPOLLOUT on the raw socket** since uSockets doesn't know bytes were queued.
  4. Completion: `resp.end_send_file(self.sendfile.offset, self.resp.should_close_connection())` (:437, Response.rs:231) — tells uWS the body was already written out-of-band so it can finish HTTP state (keep-alive accounting, markDone).
- Gate `can_sendfile` (:554-577): TCP-only (*"sendfile() needs a real socket fd; SSL writes go through BIO and H3 through lsquic stream frames — neither has one"*), regular files, len ≥ 1 MB, and macOS excluded (*"XNU's sendfile can sleep uninterruptibly under mbuf pressure, leaving the process unkillable"*).
- Also uses shim-level: `resp.timeout(idle_timeout)` (:149, :272, :345), `resp.write()` → `WriteResult::Backpressure/WantMore` (:283-297), `resp.end(chunk, should_close)` (:278), `reader.pause()` (that's the `BufferedReader` file reader on non-unix, not the socket — :246, :295).
- **Migration notes**: the Rust core must expose (a) raw fd extraction from a response/socket, (b) a "sendfile mode" trio: prepare (flush + uncork + suppress internal buffering), manual writable re-arm (`mark_needs_more`), and out-of-band completion (`end_send_file(offset, close)`), (c) `on_writable` returning bool with an offset param.

### 1.3 `RequestContext.rs` (Bun.serve request state machine)

- **Storage/lifetime**: `pub resp: Option<uws::AnyResponse>` (:138); struct is pool-allocated per request. `SendfileContext { remain, offset, total }` (:4427-4432) — despite the name it's the **Range/Content-Range** bookkeeping; actual file shipping is delegated to `FileResponseStream` via `do_sendfile()` (:1730-1990, builds opts with `offset`/`length` at :1972-1974). Flag `HAS_SENDFILE_CTX` (:4444).
- **Ops on the shim**: `resp.on_aborted` (:649), `resp.on_timeout` (:668), `resp.on_writable` (:1152, :1162, :1687, :1721, :2196, :2873, :3337, :3844), `resp.timeout(seconds.min(255) as u8)` (:4205), `resp.clear_timeout()` (:1959, :2427, :4217), write/try_end/end throughout. No direct `us_socket_*` calls — but the lifetime contracts it encodes are uSockets-core contracts.
- **UAF comments (quoted)**:
  - :1215-1231 (`end_already_responded_stream`): *"HTTP/1's uWS `markDone()` drops its `onAborted` on end, so nothing nulls `self.resp` if the peer closes afterwards: by the time the parked stream-resolution microtask runs, uSockets may already have freed the socket (`us_internal_free_closed_sockets`) or recycled it onto the next keep-alive request. Release the handle without dereferencing it."* And for H3: *"`Http3Response::markDone()` deliberately leaves `onAborted` armed so `on_stream_close` can notify the holder … H3 therefore needs `end_stream()`'s `detach_response()` to disarm that callback before the context is released, or lsquic's later `on_stream_close` invokes it on a freed pool slot."*
  - :4045-4051 (413 path): *"Writing directly on the raw uWS response left this.resp pointing at a completed (and soon freed) response — uWS markDone() clears onAborted so no abort ever fires to release the ref, and a later handleResolve()/handleReject() from an async handler would dereference the stale pointer."*
  - :4448-4455 (flags): `IS_TRANSFER_ENCODING` — *"Used to avoid looking at the uws.Request struct after it's been freed"*; `IS_WEB_BROWSER_NAVIGATION` — same quote.
  - :167-174 (`response_weakref`): *"GC may finalize it while we're parked on tryEnd() backpressure. onAbort / handleResolveStream / handleRejectStream only use this for best-effort readable-stream cleanup and safely observe null instead of UAF."*
- **Migration notes**: the rewrite must preserve (or explicitly redesign) the markDone/onAborted disarm semantics and the closed-socket free/recycle timing (`us_internal_free_closed_sockets` deferred free) — three separate call sites encode workarounds for it.

### 1.4 `server_body.rs` — the one **raw `us_socket_t`** appearance in Bun.serve

- `server_set_on_client_error_` (:3617-3670): registers a `clientError` handler on the uws App. The extern-"C" thunk signature receives `socket: *mut uws_sys::us_socket_t` (:3646) plus `error_code: u8`, `raw_packet: *mut u8/len`; comment :3661: *"S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref."* — the raw socket is passed straight into `on_client_error_callback` (node:http `clientError` gets the socket to write a raw 400 on). This is Bun.serve reaching below the App shim.
- Otherwise shim-only: server-wide idle timeout (`set_idle_timeout`, :3600ff), `set_app_flags`, `set_max_http_header_size`; :287 explicitly documents the layering: *"…without touching `bun_uws_sys`. Only the surface `prepare_js_request_context_for`…"*.

### 1.5 `FileRoute.rs`

- Shim-level only (write_status/write_mark/write_headers/end_without_body :502-512), delegates body shipping to `FileResponseStream` (comment :507: *"FileResponseStream ships via sendfile/write()"*). Layering note :395-396: *"the parse step lives HERE (T6) because it needs `bun_jsc` — so `bun_uws_sys` (T0) carries no upward hook."* Registers on-complete callbacks with `*mut Self` userdata (:391-393).

### 1.6 `mod.rs` (server)

- Listener storage: `pub listener: Option<*mut uws_sys::app::ListenSocket<SSL>>`, `h3_listener: Option<*mut uws_sys::h3::ListenSocket>` (:233-236); close via ZST-opaque deref (:536-556, :1515-1553); extern-"C" listen callbacks over raw `*mut UwsListenSocket` (:2900-2917). App creation `uws_sys::NewApp::<SSL>::create(&uws_sys::BunSocketContextOptions::default())` (:2665).
- Socket adoption/leak note :1366-1373: *"The socket was adopted by the WebSocket context inside the handler; `raw_response` is gone and no further uws abort/end callback will fire on it, so the IS_REQUEST_PENDING ref (one of the initial 3) would otherwise strand and leak the box."*
- Shutdown UAF (quoted), :3786-3806: *"The owned `Box` may be reclaimed by `EventLoop::deinit()` *after* `~VM` has already torn down the JSC `HandleSet`. `JSPromiseStrong`'s own `Drop` would dereference the freed slot (`Bun__StrongRef__delete`), so leak the handle slot instead"* and *"The custom `Drop` impl above keeps the late free from UAFing the freed `HandleSet`."*
- Request-borrow rule :384-386: *"RAII: on drop, detaches the borrowed stack `uws::Request` from the heap `webcore::Request` so the JS request object never dangles a pointer past the uWS frame it borrowed."*

### 1.7 `ServerConfig.rs`

- Listen flags straight from usockets constants: `LIBUS_LISTEN_REUSE_PORT | LIBUS_LISTEN_REUSE_ADDR`, `LIBUS_LISTEN_EXCLUSIVE_PORT`, `LIBUS_SOCKET_IPV6_ONLY` (:601-607). Route-handler thunks build `bun_uws_sys::AnyResponse::SSL/TCP/H3` from raw `uws_res` pointers (:355-458); re-exports `AnyRequest/AnyResponse` as `RequestUnion/ResponseUnion` (:503-504).

### 1.8 `ServerWebSocket.rs` / `WebSocketServerContext.rs`

- `ServerWebSocket.rs:7-9`: `bun_uws::{AnyWebSocket, WebSocketBehavior}`, `bun_uws_sys::web_socket::{WebSocketHandler, WebSocketUpgradeServer, Wrap}`, `Opcode, SendStatus`. Socket ref is a packed pointer: `self.packed_websocket_ptr() as usize as *mut uws::RawWebSocket` (:134). Heavy `ws.cork(&mut corker, Corker::run)` usage (:418, :484, :542, :1036) with the R-2 re-entrancy warning (:24-25: *"every uws/JS callback into this socket can re-enter — `on_open` → `ws.cork(JS)` → `ws.close()` → `on_close` mutates flags"*).
- `WebSocketServerContext.rs`: pure config — builds `uws::WebSocketBehavior` (:191-192) with compressor constants (`SHARED_COMPRESSOR`, `DEDICATED_COMPRESSOR_3KB`..`256KB`, :217-242) and the idleTimeout clamp (:372: *"uws does not allow idleTimeout to be between (0, 8)"*).

### 1.9 `streams.rs` (webcore — `HTTPServerWritable`, the ReadableStream→response sink)

- Socket-ref storage: type-erased `res: Option<*mut ...>` reconstructed per call via `any_res()` (:1220-1229) into `uws::AnyResponse::{H3,SSL,TCP}` by const-generics — *"all dispatch happens at runtime through `any_res()` / `uws::AnyResponse`"* (:1046).
- Backpressure model, quoted (:1316-1320): *"uWS has no tryWrite(): write() always accepts the buffer (queuing the unsent tail internally) and reports whether the socket is now backed up. Track that so the JS writer can pause; the owning RequestContext holds the on_writable registration and forwards the drain to `on_writable()` below."* `has_backpressure = matches!(res.write(buf), uws::WriteResult::Backpressure(_))` (:1324, :1398); `res.try_end(&buffer[base..], end_len, false)` (:1374); state peek `res.state().is_http_write_called()` (:1371).
- **Migration note**: consumers assume write() never partially rejects (internal tail queueing in the core) and a distinct `try_end` that can fail; both must exist in the Rust core.

### 1.10 `AnyRequestContext.rs`, `StaticRoute.rs`, `RangeRequest.rs`, `HTMLBundle.rs`

- `AnyRequestContext.rs`: type-erased fan-out over the 16 RequestContext instantiations; `get_remote_socket_info` (:158), raw `*mut uws::Request` set/get with nominal casts (:169-188), `on_abort(response: uws::AnyResponse)` (:192).
- `StaticRoute.rs:15`: `bun_uws::{AnyRequest, AnyResponse}`; `*StaticRoute` used directly as uws onAborted/onWritable userdata (:24, :373-444) with refcount held until `on_response_complete`.
- `RangeRequest.rs:7,118`: borrows `AnyRequest::header` slices — *"returns `&[u8]` tied to"* the uWS frame lifetime.
- `HTMLBundle.rs`: `PendingResponse` boxed via `heap::into_raw` and *"registered with `resp.on_aborted`; it may be freed (via `heap::take`) by this call"* (:818-822).

---

## 2. DevServer / bake (`src/runtime/bake/`)

- **`DevServer.rs`**: consumes the App shim + WebSocket layer, no raw `us_socket_*`.
  - Route thunks build `AnyResponse::SSL/TCP` from raw `uws_res` (:1576-1588); `bun_uws_sys::thunk::OpaqueHandle` round-trips for body-reader requests (:1614-1633).
  - HMR WebSocket: `hmr_socket_behavior::<SSL>() = bun_uws_sys::web_socket::Wrap::<DevServer, HmrSocket, SSL>::apply(...)` (:1640-1641); implements `bun_uws_sys::web_socket::WebSocketHandler for HmrSocket` (on_open/on_message/on_close/on_drain/on_ping/on_pong, :1648-1682) and `WebSocketUpgradeServer<SSL> for DevServer` (:1685); `ResponseLike` impl over `bun_uws_sys::response::Response<SSL>` (:1721-1756) incl. `get_remote_socket_info` and `upgrade`.
  - UAF comment :305 (quoted): *"When freed, this is set to `undefined`. UAF here also trips ASAN."*; :1159: *"the freed block being recycled by mimalloc for a"*… (Windows overlapped I/O note).
- **`dev_server/hmr_socket.rs`**: ext-data type is `Box<HmrSocket>` (created in `HmrSocket::new`, :27-47); **socket-ref storage** `pub underlying: Option<bun_uws::AnyWebSocket>` (dev_server/mod.rs:369) with lifetime *"BACKREF: owned by `dev.active_websocket_connections`; destroyed via `remove` + `heap::take` in `on_close`"* (mod.rs:366-368). Ops: `ws.send(&response, Opcode::Binary, false, true)` (:208), `ws.close()` (:232), `dev.publish(topic, msg, bun_uws::Opcode::BINARY)` (:223-246; publish at DevServer.rs:6178). Localhost gate via `res.get_remote_socket_info()` (:29-36).
- **`dev_server/mod.rs`** `ResponseLike` trait (:302-324): *"Method shapes mirror `bun_uws_sys::Response<SSL>` so the `R`-generic bodies type-check. `bun_uws` exposes no equivalent trait"* — a migration TODO in itself: the Rust core should provide this trait natively.
- **`dev_server/error_report_request.rs:31-32`**: `bun_uws::{AnyResponse, Request}` + `bun_uws_sys::body_reader_mixin::{BodyReaderHandler, BodyResponse}` (same mixin implemented by `UnrefSourceMapRequest` at DevServer.rs:6622-6642) — a reusable "read whole request body" hook over `on_data`.

---

## 3. Misc consumers (one-liners; flagged where real)

| File | Usage |
|---|---|
| `src/install/lifecycle_script_runner.rs` | **Loop only.** `bun_event_loop::AnyEventLoop` / `EventLoopHandle::from_any` (:12, :673, :779, :1243). Comment :24-27: `BufferedReaderParent::loop_` is typed `*mut bun_uws::Loop`; `bun_io::Loop` nominal = `us_loop_t` on POSIX / `uv_loop_t` on Windows. No socket usage. |
| `src/install/PackageManager/security_scanner.rs` | **Loop only**, same shape (:8-11, :880, :1202, :1285, :1380). Notable lifetime note :925-929: stable storage needed because `AnyEventLoop` has a *different layout* from `EventLoopHandle`. Tick interplay comments :1420-1489 ("MiniEventLoop::tick_once skips the uws tick whenever a concurrent task…"). |
| `src/runtime/node/node_net_binding.rs` | **Real socket-type usage, but only the detached sentinel**: builds a `NewSocket<SSL>` with `socket: Cell::new(uws::NewSocketHandler::<SSL>::DETACHED)` (:140) for node:net's lazy-connect socket. No live `us_socket` calls here (those live in `src/runtime/socket/*`, out of scope). |
| `src/runtime/api/bun/Terminal.rs` | **Loop only.** `bun_io::Loop`, `EventLoopHandle` (:23, :143, :453). `write_fd` here is a PTY file descriptor field (:124), *not* `us_socket_ipc_write_fd`. PipeReader vtable returns `*mut bun_uws_sys::Loop` on POSIX vs `bun_libuv_sys::Loop` on Windows (:1946-1953) — the loop-nominal split is the migration hazard. |
| `src/runtime/api/bun/h2_frame_parser.rs` | **Real below-shim usage.** Socket ref: `enum BunSocket { None, Tls/TlsWriteonly/Tcp/TcpWriteonly(bun_ptr::BackRef<TLS/TCPSocket>) }` (:98-115) — lifetime quote: *"BACKREF — the socket strictly outlives the H2FrameParser while attached: Tls/Tcp are kept alive by the `IntrusiveRc<H2FrameParser>` stored in the socket's `native_callback` slot (released in `detach_native_socket`)"*. Ops: `socket.write_maybe_corked(bytes)` (:2861, :2900, :2929, :2957); **raw vectored write bypassing the write queue**: `socket.get().write_vectored_raw(iov)` with `BATCH_IOVECS: RefCell<Vec<bun_uws_sys::UsIoVec>>` (:1249, :3276-3284) — TCP-only ("raw writes bypass TLS framing", socket.rs:399-400), with manual partial-write tail buffering (:3311ff). Writable-loop contract (:9111-9122, quoted): *"Returning here would let loop.c see last_write_failed==0 and disarm WRITABLE, stranding those bytes… Loop flush() until either we hit real socket backpressure (last_write_failed is then set) or no progress is made."* TLS record note :1225-1227 ("uSockets' BIO sends per record"). UAF comment :1252-1254: TLS destructor teardown ordering — *"on any leaked parser would touch freed JSC/uws state."* **Migration**: needs `raw_writev`, `last_write_failed` semantics, and per-record TLS corking. |
| `src/runtime/api/cron.rs` | **No usockets timers.** Uses `crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag}` (Bun's own timer heap) + `EventLoopHandle` (:21-24, :158-160, :1417, :1863). Comment :82-85: `loop_()` = the per-thread singleton `bun_uws::Loop::get()` names. Loop identity only. |
| `src/runtime/webcore/fetch/FetchTasklet.rs` | `#[bun_uws::uws_callback]` proc-macro only (:2080, :2480) — extern-"C" thunk generation; no socket usage (HTTP client sockets are in `src/http/`). |
| `src/runtime/webcore/streams.rs` | See §1.9 — real `uws::AnyResponse` consumer. |
| `src/runtime/webcore/FileReader.rs` | **Loop nominal only**: `loop_()` returns `*mut bun_io::Loop` = `us_loop_t*` on POSIX / `uv_loop_t*` on Windows (:320-322); comment :292 warns not to confuse `bun_uws_sys::Loop` nominal with `bun_io::Loop`. |
| `src/http_types/MimeType.rs` | **Build-graph only**: cargo cycle note (:5-11) — `http_types → options_types → zlib → io → uws_sys → http_types`; uws_sys sits in the dependency cycle that forced a Loader-enum mirror. Migration: the Rust core crate should not depend upward on http_types. |
| `src/runtime/hw_exports.rs` | SQL hooks: `timer_insert/timer_remove` over Bun's `EventLoopTimer` heap (not us_timer, :189-201); `ssl_ctx_get_or_create(opts: &bun_uws::us_bun_socket_context_options_t, err: &mut bun_uws::create_bun_socket_error_t) -> *mut bun_uws::SslCtx` (:210-213) and `ssl_config_as_usockets_client() -> us_bun_socket_context_options_t` (:239-243). **Socket-context options struct + SslCtx creation are the migration surface.** |
| `src/runtime/jsc_hooks.rs` | **The loop driver.** `default_client_ssl_ctx` via `bun_uws::create_bun_socket_error_t` (:230-234, :270-272); loop-tick integration: `(*loop_).unref_count(n)` (:901), `update_date_header_timer_if_necessary(&*loop_, vm)` (:915-917), `(*loop_).tick_without_idle()` / `tick_with_timeout(Option<&Timespec>)` / `is_active()` (:929, :960, :985-989), reads `internal_loop_data.quic_head/quic_next_tick_us` directly off the loop struct (:952-958). Comment :309-311: `uws.Loop.get().internal_loop_data.jsc_vm = vm.jsc_vm` wiring done elsewhere. **Migration**: the Rust loop must expose active-count/unref-count, timeout-driven single tick, and an open `internal_loop_data` extension area (jsc_vm ptr, QUIC deadline chain). |
| `src/runtime/api/bun/SSLContextCache.rs` | `uws::SocketContext::BunSocketContextOptions` + `create_bun_socket_error_t` only (:28-29, :87-98) — SSL_CTX cache keyed on context options; no sockets. |
| `src/runtime/api/bun/SecureContext.rs` | Same option/err types (:211-220, :285-318) + `use bun_uws_sys::socket_context::c` (:396) for raw socket-context C fns (SSL_CTX construction). No live sockets. |
| `src/runtime/crypto/CryptoHasher.rs` | `#[bun_uws::uws_callback]` macro only (:158-199) — misleading crate path; zero socket usage. |
| `src/opaque/lib.rs` | Foundation: `opaque_ffi!` macro is the single source of the ZST-opaque pattern that `us_socket_t`, `uws_res`, etc. use (:35: previously *"three crate-local `macro_rules! opaque!` copies in `boringssl_sys`, `uws_sys`, and `uws`"*). |

---

## 4. Cross-cutting migration summary

**Below-shim raw `us_*` calls that Bun.serve itself makes** (the explicitly requested list):
1. `server_body.rs:3646` — clientError thunk receives and derefs `*mut us_socket_t`.
2. `FileResponseStream.rs:169/373` — `get_native_handle()` fd extraction + direct kernel `sendfile()` on the socket fd; `:175` `prepare_for_sendfile`; `:424` `mark_needs_more` (→ `us_socket_mark_needs_more_not_ssl`); `:437` `end_send_file`.
3. `NodeHTTPResponse.rs:347/353/369` — `raw.socket()` downcast (uws_res→us_socket_t) and pause/resume (→ `us_socket_pause/resume` via the res shim).
4. `h2_frame_parser.rs:3284` — `write_vectored_raw` (→ `us_socket_t::raw_writev`, TLS-bypassing) plus reliance on `last_write_failed`/WRITABLE-disarm loop semantics.

**Core capabilities every consumer assumes** (must survive the rewrite): Copy-able raw response/socket handles with holder-side null-out discipline (no core-side invalidation callbacks except onAborted); `write()` that never partially rejects + `try_end()` that can; onAborted disarm-on-markDone for H1 vs armed-for-H3 asymmetry; deferred closed-socket free (`us_internal_free_closed_sockets`) and keep-alive slot recycling; ext-data as caller-owned `*mut T` userdata per callback (not only per-socket ext); `SocketKind` stamp + per-kind `SocketGroup` vtable dispatch; loop surface: `tick_with_timeout/tick_without_idle/is_active/unref_count` + `internal_loop_data` extension slots.
