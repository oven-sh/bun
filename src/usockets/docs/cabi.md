# bun_usockets: frozen C-ABI surface contract

Scope: the C under `packages/bun-usockets/src/**` was deleted and replaced by the
native Rust crate (`src/usockets`).
Surviving native consumers that must keep linking against the crate's `extern "C"` surface:

| Tag    | Consumer                                | Files                                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------------------------ |
| UWS    | C++ uWebSockets layer                   | `packages/bun-uws/src/*.h` (header-only, compiled into the shims)        |
| SHIM   | C shim                                  | `src/uws_sys/libuwsockets.cpp`                                           |
| H3SHIM | H3 C shim                               | `src/uws_sys/libuwsockets_h3.cpp`                                        |
| QUIC   | lsquic glue (survives)                  | `packages/bun-usockets/src/quic.c` (+ `quic.h`)                          |
| NTLS   | Node TLS bindings                       | `src/jsc/bindings/NodeTLS.cpp`                                           |
| JSHS   | node:http server socket                 | `src/jsc/bindings/node/JSNodeHTTPServerSocket{,.Prototype}.cpp` (+ `.h`) |
| WV     | webview backends                        | `src/runtime/webview/{WebKitBackend,ChromeBackend}.cpp`                  |
| RUST   | Rust extern decls in `src/uws_sys/*.rs` | become native calls into the crate (see §7)                              |

Opaque-pointer-only C++ users (no symbol/layout needs beyond forward decls):
`src/jsc/bindings/NodeHTTP.cpp`, `ScriptExecutionContext.{h,cpp}`, `webcore/WebSocket.{h,cpp}`
(`us_socket_t*` / `us_loop_t*` / `us_socket_group_t*` passed through only).

Reference signatures: all signatures below are verbatim from
`packages/bun-usockets/src/libusockets.h` (public) and `internal/internal.h` /
`internal/loop_data.h` / `internal/eventing/{epoll_kqueue,libuv}.h` (internal) at HEAD.
This tree already carries the "socket group" redesign (no `us_socket_context_t`; groups are
embedded in owners; TLS is per-socket `s->ssl`; dispatch is by `s->kind` through Rust
`us_dispatch_*`).

---

## 1. Exported functions required by surviving C/C++ consumers

Legend: consumers in brackets. "RUST" additionally consumes almost everything below via
`src/uws_sys` extern decls; only non-Rust consumers are listed since Rust callers can be
re-pointed natively.

### 1.1 Loop

| Function                                                                                                                                                   | Consumers                                                                               | Contract                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `struct us_loop_t *us_create_loop(void *hint, void (*wakeup_cb)(us_loop_r), void (*pre_cb)(us_loop_r), void (*post_cb)(us_loop_r), unsigned int ext_size)` | UWS `Loop.h`                                                                            | Allocates loop + `ext_size` bytes after the struct at `LIBUS_EXT_ALIGNMENT`. `hint` = existing native loop (libuv) or NULL. C++ placement-news `uWS::LoopData` (alignas(16)) into the ext immediately after. |
| `void us_loop_free(us_loop_r)`                                                                                                                             | UWS `Loop.h`                                                                            | C++ runs `LoopData::~LoopData()` first, then calls this. Must free quic_timer if armed (current loop.c:155).                                                                                                 |
| `void *us_loop_ext(us_loop_r)`                                                                                                                             | UWS (Loop.h, App.h, AsyncSocket.h, HttpResponse.h, WebSocketContext.h, Http3Response.h) | Pointer just past `us_loop_t`, 16-aligned, stable for loop lifetime. Hottest accessor in uWS (every cork/date/deflate access).                                                                               |
| `void us_loop_run(us_loop_r)`                                                                                                                              | UWS `Loop.h`                                                                            | Blocks until no non-fallthrough polls remain.                                                                                                                                                                |
| `void us_wakeup_loop(us_loop_r)`                                                                                                                           | UWS `Loop.h` (`Loop::defer`)                                                            | **Only thread-safe entry point.** Async-signal wakeup; loop thread then invokes `wakeup_cb` which drains the C++ defer queues. Increments `pending_wakeups` so the tick returns immediately.                 |
| `void us_loop_integrate(us_loop_r)`                                                                                                                        | UWS `Loop.h`                                                                            | Hook timers into an existing (alien/libuv) loop.                                                                                                                                                             |

### 1.2 Poll (needed by QUIC and SHIM only)

| Function                                                | Consumers       | Contract                                                                                                                     |
| ------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `LIBUS_SOCKET_DESCRIPTOR us_poll_fd(us_poll_r)`         | QUIC (×5), SHIM | QUIC calls it on `(struct us_poll_t *) udp_socket` — i.e. relies on `us_poll_t` being the first member of `us_udp_socket_t`. |
| `void us_poll_change(us_poll_r, us_loop_r, int events)` | QUIC, SHIM      | `events` = `LIBUS_SOCKET_READABLE                                                                                            | LIBUS_SOCKET_WRITABLE` (platform-specific values, see §8). QUIC arms WRITABLE on send backpressure; SHIM's needs-more helpers arm R | W. Must be callable from inside poll dispatch. |

(`us_create_poll`, `us_poll_free`, `us_poll_init`, `us_poll_start{,_rc}`, `us_poll_stop`,
`us_poll_events`, `us_poll_ext`, `us_poll_resize` have **no surviving C/C++ callers** —
internal + Rust only.)

### 1.3 Timers (libuv/Windows only — POSIX has no us_timer users left)

Public API is `#ifdef _WIN32` in `libusockets.h`; QUIC uses it under `LIBUS_USE_LIBUV`:

| Function                                                                                         | Consumers                                                                     | Contract                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `struct us_timer_t *us_create_timer(us_loop_r, int fallthrough, unsigned int ext_size)`          | QUIC (libuv path: lazy `loop->data.quic_timer = us_create_timer(loop, 1, 0)`) | `fallthrough=1` → does not keep loop alive. May return NULL. |
| `void us_timer_set(struct us_timer_t *, void (*cb)(struct us_timer_t *), int ms, int repeat_ms)` | QUIC                                                                          | `repeat_ms=0` = one-shot; both 0 = disarm.                   |
| `struct us_timer_t *us_timer_loop(struct us_timer_t *)` → `us_loop_t*`                           | QUIC (`us_quic_on_timer` → `us_quic_loop_process(us_timer_loop(t))`)          |                                                              |
| `void us_timer_close(struct us_timer_t *, int fallthrough)`                                      | crate-internal (loop_free closes quic_timer) + RUST `Timer.rs`                |                                                              |
| `void *us_timer_ext(struct us_timer_t *)`                                                        | RUST only                                                                     |                                                              |

### 1.4 Socket

All take `us_socket_r` = nonnull `struct us_socket_t *`. Reentrancy note that applies to the
whole table: every one of these may be called from inside `on_data`/`on_writable`/vtable
callbacks (uWS does so pervasively), including `us_socket_close` on the socket currently
being dispatched.

| Function                                                                                                                                                                          | Consumers                                                           | Contract                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `int us_socket_write(us_socket_r, const char *data, int length)`                                                                                                                  | UWS AsyncSocket.h/HttpContext.h, WV both                            | Plaintext write; TLS-encrypts when `s->ssl`. Returns bytes accepted (0..length); on partial, socket arms WRITABLE and the next `on_writable` fires. Never negative.                                                                                                                     |
| `int us_socket_write2(us_socket_r, const char *header, int header_length, const char *payload, int payload_length)`                                                               | UWS WebSocket.h, WV WebKit                                          | Vectored 2-part write (frame header + body without copy). Returns total bytes accepted across both parts.                                                                                                                                                                               |
| `struct us_socket_t *us_socket_close(us_socket_r, int code, void *reason)`                                                                                                        | UWS App/AsyncSocket/HttpContext/WebSocket/WebSocketContext, WV      | `code` = `LIBUS_SOCKET_CLOSE_CODE_*` (§8). Fires `on_close(code, reason)` synchronously (via dispatch); returns the (still-valid-until-loop_post) socket. Idempotent w.r.t. already-closed. Actual free deferred to outermost `loop_post` (`closed_head`, `tick_depth` guard).          |
| `void us_socket_shutdown(us_socket_r)`                                                                                                                                            | UWS AsyncSocket/HttpContext                                         | TLS: close_notify; TCP: FIN.                                                                                                                                                                                                                                                            |
| `void us_socket_shutdown_read(us_socket_r)`                                                                                                                                       | UWS WebSocket.h                                                     | `shutdown(fd, SHUT_RD)` equivalent.                                                                                                                                                                                                                                                     |
| `int us_socket_is_closed(us_socket_r)`                                                                                                                                            | UWS, SHIM, WV, JSHS                                                 | Reads `flags.is_closed`. Must be true from the moment close is requested (guards in shim's needs-more helpers rely on it).                                                                                                                                                              |
| `int us_socket_is_shut_down(us_socket_r)`                                                                                                                                         | UWS HttpContext/WebSocketContext                                    | Write-side already shut down.                                                                                                                                                                                                                                                           |
| `void *us_socket_ext(us_socket_r)`                                                                                                                                                | UWS everywhere, JSHS                                                | Pointer just past `us_socket_t`, `LIBUS_EXT_ALIGNMENT`-aligned. C++ placement-news `HttpResponseData` / `WebSocketData` there and relies on the address being stable **except across `us_socket_adopt` relocation**.                                                                    |
| `struct us_socket_group_t *us_socket_group(us_socket_r)`                                                                                                                          | UWS AsyncSocket/HttpContext/HttpResponse/WebSocket/WebSocketContext | returns_nonnull. `WebSocket.h` computes its context data as `((us_socket_group_t *) us_socket_group_ext(us_socket_group(s)) + 1)` — see layout §3.                                                                                                                                      |
| `void us_socket_timeout(us_socket_r, unsigned int seconds)`                                                                                                                       | UWS AsyncSocket/HttpContext/HttpResponse/WebSocketContext           | Granularity `LIBUS_TIMEOUT_GRANULARITY` (4s) via group sweep; 0 clears. Fires vtable `on_timeout`.                                                                                                                                                                                      |
| `void us_socket_long_timeout(us_socket_r, unsigned int minutes)`                                                                                                                  | UWS HttpResponse.h                                                  | Minute-granularity sweep → `on_long_timeout`.                                                                                                                                                                                                                                           |
| `void us_socket_pause(us_socket_r)` / `void us_socket_resume(us_socket_r)`                                                                                                        | UWS AsyncSocket.h                                                   | Stop/restart readable polling (`flags.is_paused`). Resume must redeliver buffered TLS plaintext if any.                                                                                                                                                                                 |
| `void us_socket_remote_address(us_socket_r, char *buf, int *length)`                                                                                                              | UWS AsyncSocket.h, SHIM                                             | Writes 4 (v4) or 16 (v6) raw bytes; `*length` in/out (in = capacity). `*length=0` on failure/unix.                                                                                                                                                                                      |
| `void *us_socket_get_native_handle(us_socket_r)`                                                                                                                                  | UWS AsyncSocket.h                                                   | `SSL*` if TLS else `(void*)(intptr_t)fd`.                                                                                                                                                                                                                                               |
| `void us_socket_ref(us_socket_r)` / `void us_socket_unref(us_socket_r)`                                                                                                           | UWS HttpContext.h (unrefs listen sockets)                           | libuv: uv_ref/uv_unref semantics; epoll/kqueue: adjusts whether socket counts toward keeping `us_loop_run` alive. No-op must still be exported.                                                                                                                                         |
| `struct us_socket_t *us_socket_adopt(us_socket_r, us_socket_group_r, unsigned char kind, int old_ext_size, int ext_size)`                                                         | UWS HttpResponse.h (WS upgrade)                                     | Moves socket between groups/kinds, resizing ext; **may realloc and return a different pointer** (`flags.adopted`). Caller re-placement-news ext and calls `LoopData::transferCorkSlot` with the new pointer. Must be legal mid-`on_data`; dispatch continues with the returned pointer. |
| `struct us_socket_t *us_socket_from_fd(us_socket_group_r, unsigned char kind, struct ssl_ctx_st *ssl_ctx /*nullable*/, int socket_ext_size, LIBUS_SOCKET_DESCRIPTOR fd, int ipc)` | WV both (`BUN_SOCKET_KIND_DYNAMIC`, ssl_ctx=NULL, ipc=0)            | Wraps an existing fd; starts readable polling; links into group; frees the poll (not the fd) on failure and returns NULL.                                                                                                                                                               |
| `int us_socket_is_ssl_handshake_finished(us_socket_r)`                                                                                                                            | JSHS                                                                |                                                                                                                                                                                                                                                                                         |
| `int us_socket_ssl_handshake_callback_has_fired(us_socket_r)`                                                                                                                     | JSHS                                                                | Distinguishes "finished" from "on_handshake already dispatched".                                                                                                                                                                                                                        |
| `void *us_socket_server_name_userdata(us_socket_r)`                                                                                                                               | UWS HttpContext.h                                                   | Per-SNI-domain `user` stored via `us_listen_socket_add_server_name` (uWS keeps a per-domain `HttpRouter*` there); resolved for the socket's negotiated servername. NULL if none.                                                                                                        |
| `unsigned int us_get_remote_address_info(char *buf, us_socket_r, const char **dest, int *port, int *is_ipv6)`                                                                     | SHIM                                                                | Formats textual IP into `buf`, points `*dest` at it, returns length; 0 on failure/unix socket.                                                                                                                                                                                          |
| `unsigned int us_get_local_address_info(char *buf, us_socket_r, const char **dest, int *port, int *is_ipv6)`                                                                      | SHIM                                                                | Same for local end.                                                                                                                                                                                                                                                                     |

**Defined in SHIM today (not in the C library), using internal layout — see §3/§9:**

| Function                                                | Currently                                                                                             | Contract                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `LIBUS_SOCKET_DESCRIPTOR us_socket_get_fd(us_socket_r)` | SHIM def: `us_poll_fd(&s->p)`                                                                         | Declared in libusockets.h; Rust binds it (`us_socket_t.rs`).      |
| `void us_socket_sendfile_needs_more(us_socket_r)`       | SHIM def: `if(closed) return; s->flags.last_write_failed = 1; us_poll_change(&s->p, s->group->loop, R | W)`                                                               | Called after a short `sendfile(2)` so the next writable event re-fires `on_writable`. |
| `void us_socket_mark_needs_more_not_ssl(uws_res_r)`     | SHIM def: identical body (casts `uws_res_t*`→`us_socket_t*`)                                          | Same, for non-SSL HttpResponse. Called from Rust (`Response.rs`). |

### 1.5 Socket groups

`us_socket_group_t` is a PUBLIC struct (full layout in `libusockets.h`) embedded by value in
its owners — see §3.1.

| Function                                                                                                                                                                                                                   | Consumers                                                         | Contract                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `void us_socket_group_init(us_socket_group_r, us_loop_r, const struct us_socket_vtable_t *vtable /*nullable*/, void *ext /*nullable*/)`                                                                                    | UWS HttpContext/WebSocketContext `create()`, WV both              | Initializes an embedded, zero-initialized group. Does NOT link into loop (lazy on first socket). Idempotent. `ext` = owner back-pointer.                                                                                    |
| `void us_socket_group_deinit(us_socket_group_r)`                                                                                                                                                                           | UWS HttpContext::free, WebSocketContext::free                     | Unlinks from loop; asserts socket list empty. Owner frees embedding storage right after.                                                                                                                                    |
| `void us_socket_group_close_all(us_socket_group_r)`                                                                                                                                                                        | UWS App.h `close()`                                               | Closes every socket AND listen socket in the group (fires `on_close` per socket). Group stays valid. Walks `head_listen_sockets` first. Must also account for sockets parked in `low_prio_head` (`low_prio_count`).         |
| `void *us_socket_group_ext(us_socket_group_r)`                                                                                                                                                                             | UWS App/HttpContext/WebSocket/WebSocketContext                    | Returns `group->ext` (the owner pointer).                                                                                                                                                                                   |
| `struct us_loop_t *us_socket_group_loop(us_socket_group_r)`                                                                                                                                                                | UWS App/AsyncSocket/HttpResponse/WebSocketContext                 | returns_nonnull.                                                                                                                                                                                                            |
| `struct us_listen_socket_t *us_socket_group_head_listen_socket(us_socket_group_r)`                                                                                                                                         | UWS App.h (`addServerName` etc. walk listeners)                   | Live list head; caching `us_listen_socket_t*` across ticks is a documented UAF.                                                                                                                                             |
| `struct us_listen_socket_t *us_socket_group_listen(us_socket_group_r, unsigned char kind, struct ssl_ctx_st *ssl_ctx /*nullable*/, const char *host /*nullable*/, int port, int options, int socket_ext_size, int *error)` | UWS HttpContext.h (passes `options \| LIBUS_LISTEN_DEFER_ACCEPT`) | Listener owns embedded accept state; accepted sockets get `kind` stamped, `socket_ext_size` ext, are linked into THIS group, and up_ref'd `ssl_ctx` applied when non-NULL. `*error` receives errno-ish code on NULL return. |
| `struct us_listen_socket_t *us_socket_group_listen_unix(us_socket_group_r, unsigned char kind, struct ssl_ctx_st *ssl_ctx, const char *path, size_t pathlen, int options, int socket_ext_size, int *error)`                | UWS HttpContext.h                                                 | Unix-domain variant; `pathlen` supports abstract sockets (leading NUL).                                                                                                                                                     |

(Group connect: `us_socket_group_connect`, `us_socket_group_connect_unix`,
`us_socket_pair`, `us_socket_adopt_tls`, `us_socket_tls_feed`,
`us_socket_start_tls_handshake`, `us_socket_sni_resolve`, `us_loop_close_all_groups`,
`us_socket_group_close_all_ex`, `us_socket_group_timestamp`, `us_socket_group_next` —
**Rust-only consumers**, no C/C++ caller survives.)

### 1.6 Listen sockets / SNI

| Function                                                                                                                                                                                           | Consumers | Contract                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `void us_listen_socket_close(struct us_listen_socket_t *)`                                                                                                                                         | UWS App.h | Unlinks from group's listener list, releases ssl_ctx ref + SNI tree, frees in loop_post.                       |
| `struct us_listen_socket_t *us_listen_socket_next(struct us_listen_socket_t *)`                                                                                                                    | UWS App.h | Walk listener list.                                                                                            |
| `struct us_socket_group_t *us_listen_socket_group(struct us_listen_socket_t *)`                                                                                                                    | UWS App.h | The accept group.                                                                                              |
| `int us_listen_socket_add_server_name(struct us_listen_socket_t *, const char *hostname_pattern, struct ssl_ctx_st *ssl_ctx, void *user /*nullable*/)`                                             | UWS App.h | ssl_ctx up_ref'd into the SNI tree; `user` opaque (uWS: per-domain HttpRouter\*). Wildcard patterns supported. |
| `void us_listen_socket_remove_server_name(struct us_listen_socket_t *, const char *hostname_pattern)`                                                                                              | UWS App.h | Releases that entry's ssl_ctx ref.                                                                             |
| `struct ssl_ctx_st *us_listen_socket_find_server_name_ctx(struct us_listen_socket_t *, const char *hostname_pattern)`                                                                              | UWS App.h | **Returns an OWNED reference — caller must `us_internal_ssl_ctx_unref`** (App.h does).                         |
| `void us_listen_socket_on_server_name(struct us_listen_socket_t *, struct ssl_ctx_st *(*cb)(struct us_listen_socket_t *, const char *hostname, int *abort_handshake, struct us_socket_t *socket))` | UWS App.h | Dynamic SNI resolver; see callback contract §4.3.                                                              |

(`us_listen_socket_ext/get_fd/port/find_server_name_userdata` — Rust-only.)

### 1.7 SSL_CTX construction / root certs

| Function                                                                                                                                       | Consumers                      | Contract                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct ssl_ctx_st *us_ssl_ctx_from_options(struct us_bun_socket_context_options_t options /*BY VALUE*/, enum create_bun_socket_error_t *err)` | UWS App.h                      | Builds a BoringSSL SSL_CTX; caller owns one ref (release with `us_internal_ssl_ctx_unref`). Mode-neutral (client+server). Frees the internal strdup'd passphrase itself. NULL + `*err` on failure. |
| `void us_internal_ssl_ctx_unref(struct ssl_ctx_st *)`                                                                                          | UWS App.h                      | `SSL_CTX_free` without OpenSSL headers. (`us_internal_ssl_ctx_up_ref` symmetric, Rust-only today.)                                                                                                 |
| `int us_raw_root_certs(struct us_cert_string_t **out)`                                                                                         | NTLS                           | Returns count; `*out` points at static array of PEM strings (never freed).                                                                                                                         |
| `STACK_OF(X509) *us_get_root_extra_cert_instances()`                                                                                           | NTLS                           | Extra CA certs from `NODE_EXTRA_CA_CERTS`.                                                                                                                                                         |
| `STACK_OF(X509) *us_get_root_system_cert_instances()`                                                                                          | NTLS                           | Platform system store certs.                                                                                                                                                                       |
| `SSL_CTX *us_ssl_ctx_build_raw(struct us_bun_socket_context_options_t, enum create_bun_socket_error_t *)`                                      | QUIC (extern-declared locally) | Same as from_options but without socket-layer callbacks attached (QUIC installs lsquic's own).                                                                                                     |
| `X509_STORE *us_get_default_ca_store()`                                                                                                        | QUIC                           | Bun's default trust store (root_certs.cpp).                                                                                                                                                        |

**Crypto TU split:** `crypto/root_certs*.cpp` stays a C++ TU inside bun-usockets —
the NTLS + `us_get_default_ca_store` rows come from it unchanged. `crypto/sni_tree.cpp`
was replaced by `tls/sni.rs`, and `crypto/openssl.c` by the Rust TLS layer, which
exports `us_ssl_ctx_from_options`, `us_ssl_ctx_build_raw`,
`us_internal_ssl_ctx_{up_ref,unref}`, and the internal SSL surface the socket layer uses.

### 1.8 UDP + packet buffer (QUIC is the only surviving C consumer)

| Function                                                                                                                                                                                                                                                                                                                                | Consumers                                                 | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `struct us_udp_socket_t *us_create_udp_socket(us_loop_r, void (*data_cb)(struct us_udp_socket_t *, void *, int), void (*drain_cb)(struct us_udp_socket_t *), void (*close_cb)(struct us_udp_socket_t *), void (*recv_error_cb)(struct us_udp_socket_t *, int), const char *host, unsigned short port, int flags, int *err, void *user)` | QUIC (×3: server listen, client bind v6 then v4 fallback) | Creates + binds + starts readable polling. `data_cb(socket, recvbuf, npackets)` — `recvbuf` is a `us_udp_packet_buffer_t*` (per-loop shared recv buffer, `LIBUS_RECV_BUFFER_LENGTH`), valid only during the callback. `drain_cb` after WRITABLE clears backpressure. `close_cb` fires from `us_udp_socket_close` before deferred free. `recv_error_cb(s, errno)` for non-EAGAIN recvmmsg errors (IP_RECVERR/ICMP); socket NOT closed automatically. NULL + `*err` on bind failure. |
| `void us_udp_socket_close(struct us_udp_socket_t *)`                                                                                                                                                                                                                                                                                    | QUIC (×4)                                                 | Stops poll, fires close_cb, defers free to loop_post via `closed_udp_head`. Safe while iterating (QUIC calls it in `while (ctx->listeners)` teardown loops).                                                                                                                                                                                                                                                                                                                       |
| `void *us_udp_socket_user(struct us_udp_socket_t *)`                                                                                                                                                                                                                                                                                    | QUIC (×3)                                                 | The `user` pointer from create (QUIC stores its listen socket there).                                                                                                                                                                                                                                                                                                                                                                                                              |
| `char *us_udp_packet_buffer_payload(struct us_udp_packet_buffer_t *, int index)`                                                                                                                                                                                                                                                        | QUIC                                                      | Payload of packet `index` in the last receive batch.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `int us_udp_packet_buffer_payload_length(struct us_udp_packet_buffer_t *, int index)`                                                                                                                                                                                                                                                   | QUIC                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `char *us_udp_packet_buffer_peer(struct us_udp_packet_buffer_t *, int index)`                                                                                                                                                                                                                                                           | QUIC                                                      | Cast to `struct sockaddr*` (sockaddr_storage per slot).                                                                                                                                                                                                                                                                                                                                                                                                                            |

QUIC additionally does `(struct us_poll_t *) udp_socket` casts (poll-first layout, §3) and
sets DONTFRAG/DF socket options directly on `us_poll_fd(...)` — no extra API needed.

All other UDP functions (`bind`, `send`, `receive`, `set_broadcast`, `connect`,
`disconnect`, memberships, TTL, `bound_port`, `bound_ip`, `remote_ip`,
`us_create_udp_packet_buffer`, `us_udp_buffer_set_packet_payload`,
`us_udp_packet_buffer_truncated`, `us_udp_packet_buffer_local_ip`) are consumed **only by
Rust** (`src/uws_sys/udp.rs` → node:dgram) — now native calls.

### 1.9 QUIC layer (quic.c EXPORTS — for completeness, NOT part of the Rust crate)

quic.c survives and continues to export the whole `us_quic_*` surface consumed by
UWS `Http3App.h`/`Http3Context.h`/`Http3Request.h`/`Http3Response.h`/`Http3ResponseData.h`
and H3SHIM (`us_quic_global_init`, `us_create_quic_socket_context`,
`us_quic_socket_context_{shutdown,free,add_server_name,ext,loop,listen,connect,on_*}`,
`us_quic_listen_socket_{close,port,local_address}`, `us_quic_socket_remote_address`,
`us_quic_stream_*`, `us_quic_loop_process`, `us_quic_loop_flush_if_pending`, pending-connect
API) plus RUST `quic.rs` (`us_quic_global_init`) and `Loop.rs`
(`us_quic_loop_flush_if_pending`). Signatures: `packages/bun-usockets/src/quic.h`.
The Rust crate must define `LIBUS_USE_QUIC`-equivalent loop hooks (§6).

---

## 2. IMPORTS: symbols the Rust crate must call OUT to (reverse dependencies)

These are functions the deleted C calls today; the Rust crate must keep invoking them with
identical semantics:

1. **Dispatch (Rust, `src/runtime/socket/uws_dispatch.rs`)** — `us_dispatch_open`,
   `us_dispatch_data`, `us_dispatch_fd`, `us_dispatch_writable`, `us_dispatch_close`,
   `us_dispatch_timeout`, `us_dispatch_long_timeout`, `us_dispatch_end`,
   `us_dispatch_connect_error`, `us_dispatch_connecting_error`, `us_dispatch_handshake`
   (custom_data always NULL), `us_dispatch_session`, `us_dispatch_keylog`,
   `us_dispatch_ssl_raw_tap`. The loop NEVER reads `group->vtable` itself — dispatch
   switches on `s->kind` and falls back to the group vtable for `UwsHttp{,Tls}`,
   `UwsWs{,Tls}`, and `Dynamic`. For Rust-handled kinds these are direct Rust calls,
   but the vtable-for-C++-kinds path survives unchanged.
2. **quic.c hooks** — from `us_internal_loop_pre` AND `us_internal_loop_post`:
   `if (loop->data.quic_head) us_quic_loop_process(loop);`. On libuv loop teardown:
   `us_timer_close(loop->data.quic_timer, 0)` if set.
3. **Loop callbacks** installed via `us_create_loop`: `wakeup_cb` (from loop thread after
   `us_wakeup_loop`), `pre_cb` (every iteration before poll-wait — cork drain depends on
   it, §5), `post_cb` (after dispatching ready polls).
4. **Group vtable callbacks** (§4) for C++ kinds.
5. **DNS/JS glue (already Rust/Zig-side exports)** — `Bun__addrinfo_get/set/cancel/
freeRequest/getRequestResult`, `Bun__lock/unlock`, `Bun__panic`, `Bun__outOfMemory`.
6. **SNI dynamic resolver** installed via `us_listen_socket_on_server_name` (§4.3).

---

## 3. Layout contracts — struct-field pokes from surviving code (the dangerous list)

### 3.1 `us_socket_group_t` — PUBLIC repr(C), embedded by value. Layout FROZEN.

Definition (libusockets.h): `{ us_loop_t *loop; const us_socket_vtable_t *vtable; void *ext;
us_socket_t *head_sockets; us_connecting_socket_t *head_connecting_sockets;
us_listen_socket_t *head_listen_sockets; us_socket_t *iterator;
us_socket_group_t *prev, *next; uint32_t global_tick; uint16_t low_prio_count;
unsigned char timestamp, long_timestamp, linked; }`

- **Embedded by value** at offset 0 in `uWS::HttpContext` (`static_assert(offsetof == 0)`,
  non-polymorphic assert) and `uWS::WebSocketContext`
  (`static_assert(offsetof(WebSocketContext, data) == sizeof(us_socket_group_t))` —
  **`sizeof(us_socket_group_t)` is ABI**), and as C++ static storage in both webview
  backends. Zero-initialization (`{}` / static zeroing) must be a valid pre-init state.
- **Field reads from C++:** `App.h::closeIdle()` walks `group->head_sockets` and
  `s->next` directly. `SHIM` reads `s->group->loop`.
- Sockets parked in the loop's `low_prio_head` are NOT in `head_sockets`
  (`low_prio_count` tracks them) — `close_all`/`deinit` must handle both; `closeIdle`'s
  walk will simply miss parked sockets (current behavior, keep).

### 3.2 `us_socket_t` — internal, but layout-relied-upon by SHIM + App.h

- `struct us_poll_t p` is the **first member** (SHIM: `&s->p`; identity cast
  poll↔socket everywhere).
- SHIM writes `s->flags.last_write_failed = 1` (bit 7 of the packed 1-byte
  `us_socket_flags`) and reads `s->group->loop`.
- `App.h::closeIdle` reads `s->next`.
- **Pointer-identity contract:** `uWS::AsyncSocket/HttpResponse/WebSocket` are casts of
  `us_socket_t*` (no C++ fields of their own); all their state lives in the ext region
  returned by `us_socket_ext` = address just past the struct, `LIBUS_EXT_ALIGNMENT(16)`-
  aligned. So `sizeof(us_socket_t)` (rounded to 16) is ABI for the C++ side only through
  `us_socket_ext` — keep it a function, never a macro.
- JSHS additionally uses `us_socket_stream_buffer_t` + `us_socket_buffered_js_write` —
  both already **exported from Rust** (`src/runtime/socket/uws_jsc.rs`); unchanged.

### 3.3 `us_listen_socket_t` — first-member poke from C++

`HttpContext.h::listen{,_unix}` calls `us_socket_unref(&socket->s)` — relies on
`struct us_socket_t s` being the **first member** of `us_listen_socket_t` and on the C++
TU seeing the full internal.h definition. (Shrink candidate, §9.)

### 3.4 `us_poll_t`

- epoll/kqueue: `alignas(16) struct { signed int fd : 27; unsigned int poll_type : 5; }`.
- libuv: `{ uv_poll_t *uv_p; LIBUS_SOCKET_DESCRIPTOR fd; unsigned char poll_type; }`.
- First member of `us_socket_t`, `us_udp_socket_t`, `us_internal_callback_t`;
  **quic.c casts `us_udp_socket_t*` → `us_poll_t*`** for `us_poll_fd`/`us_poll_change`.

### 3.5 `us_loop_t` and `us_internal_loop_data_t`

- `struct us_internal_loop_data_t data` is the **first member** of `us_loop_t`
  (both eventing backends), followed by (epoll/kqueue) `int num_polls; int
num_ready_polls; int current_ready_poll; int fd; unsigned int bun_polls; unsigned int
pending_wakeups; alignas(16) ready_polls[1024]` / (libuv) `uv_loop_t *uv_loop; int
is_default; uv_prepare_t *uv_pre; uv_check_t *uv_check;`.
- **quic.c field pokes:** `loop->data.quic_head` (linked list of engine contexts, read+
  written), `loop->data.quic_next_tick_us` (written by `us_quic_loop_process`, read by
  Bun's Rust `getTimeout` — `src/runtime/jsc_hooks.rs` + `src/runtime/timer/mod.rs`),
  `loop->data.quic_timer` (libuv only), and **`ctx->loop->num_polls++/--`** (keeps the
  loop alive per live QUIC connection).
- `us_internal_loop_data_t` is already mirrored field-for-field in
  `src/uws_sys/InternalLoopData.rs` (comment at `internal/loop_data.h:35`); the Rust
  runtime reads `quic_next_tick_us` through that mirror. **The Rust
  definition is the source of truth; quic.c needs a C header that matches it
  exactly** (fields incl. `sweep_next_tick_ns`/`sweep_timer`, `sweep_timer_count`,
  `wakeup_async`, `head`, `quic_head`, `quic_next_tick_us`, `[quic_timer]`, `iterator`,
  `recv_buf`, `send_buf`, `ssl_data`, `pre_cb`, `post_cb`, `closed_udp_head`,
  `closed_head`, `low_prio_head`, `low_prio_budget`, `dns_ready_head`,
  `closed_connecting_head`, `zig_mutex_t mutex`, `parent_ptr`, `parent_tag`,
  `iteration_nr`, `jsc_vm`, `tick_depth`).
- C++ (uWS) touches the loop ONLY through `us_loop_ext` — `uWS::Loop*` is an identity
  cast of `us_loop_t*` but never reads fields.

### 3.6 `us_udp_socket_t`

quic.c holds `us_udp_socket_t*` opaquely EXCEPT for the poll-first cast (§3.4). Rust-only
consumers (udp.rs) treat it opaquely. Layout otherwise free.

### 3.7 Value types crossing the ABI (repr(C), FROZEN)

- `us_socket_vtable_t` — 11 function-pointer slots **in this order**: on_open, on_data,
  on_fd, on_writable, on_close, on_timeout, on_long_timeout, on_end, on_connect_error,
  on_connecting_error, on_handshake. C++ builds 4 static const instances (httpVTable,
  wsVTable, webview s_hostVTable ×2); NULL slots are skipped by dispatch.
- `us_bun_socket_context_options_t` — 20 fields, **passed BY VALUE** to
  `us_ssl_ctx_from_options` / `us_ssl_ctx_build_raw`, and **memcpy'd** onto
  `uWS::SocketContextOptions` in SHIM `uws_create_app` (layouts must stay identical).
  Also constructed by Rust (`App.rs`) and passed through H3SHIM.
- `us_bun_verify_error_t { int error; const char *code; const char *reason; }` — returned
  by value (`us_socket_verify_error`), passed by value into vtable `on_handshake`.
- `us_cert_string_t { const char *str; size_t len; }` (NTLS).
- `us_iovec_t { void *iov_base; size_t iov_len; }` — iovec-layout-compatible (Rust-only
  caller today).
- `enum create_bun_socket_error_t` (0..4).
- `struct us_socket_flags` — 1 byte packed; bit assignments frozen because SHIM sets
  `last_write_failed` directly (until §9 patch lands).

### 3.8 Socket-kind constants — Rust → C++ direction (already correct, keep)

`BUN_SOCKET_KIND_{DYNAMIC,UWS_HTTP,UWS_HTTP_TLS,UWS_WS,UWS_WS_TLS}` are `#[no_mangle]`
`unsigned char` statics exported from `src/uws_sys/SocketKind.rs`, consumed by C++ via
`packages/bun-uws/src/SocketKinds.h` and by webview backends (`BUN_SOCKET_KIND_DYNAMIC`).
`SocketKind` is `#[repr(u8)]`, dense 0..=22; `crypto/openssl.c` (being rewritten) also
references `BUN_SOCKET_KIND_BUN_SOCKET_TLS`.

---

## 4. Callback contracts

### 4.1 Group vtable (installed by C++: httpVTable, wsVTable, webview vtables)

Invocation path: Rust loop → `us_dispatch_*` (`dispatch.rs`) → for kinds
UwsHttp/UwsHttpTls/UwsWs/UwsWsTls/Dynamic → `s->group->vtable` slot. Contracts the C++
handlers assume:

- **Return value** is the possibly-relocated/closed socket; the driver must continue with
  the returned pointer (uWS handlers return the result of `close()`/`adopt` chains) and
  re-read `s->flags` after the call (a handler may have closed or adopted the socket).
- **NULL slots are skipped** (e.g. httpVTable.on_fd, wsVTable.on_open); skipping must be
  a no-op, not a crash (`Invalid` kind is deliberately null → crash-by-design).
- `on_open(s, is_client, ip, ip_len)` — after accept/connect (post-TLS-attach but before
  handshake completion); `ip` = raw bytes (4/16) or len 0.
- `on_data(s, data, len)` — `data` points into the loop's shared `recv_buf`
  (`LIBUS_RECV_BUFFER_LENGTH` + `LIBUS_RECV_BUFFER_PADDING` on both ends, writable —
  WebSocket unmasking mutates it in place and reads in 16-byte SIMD strides, hence the
  padding). Valid only for the duration of the call. **Fully re-entrant**: handler may
  write, close, shutdown, adopt (upgrade), or run arbitrary JS that re-enters the loop
  (`tick_depth`); freed-socket reclamation must defer to outermost loop_post.
- `on_writable(s)` — fired when poll goes writable AND a prior write failed
  (`last_write_failed`); uWS clears backpressure then may close.
- `on_close(s, code, reason)` — exactly once per socket, code = `LIBUS_SOCKET_CLOSE_CODE_*`,
  `reason` = pointer passed to `us_socket_close` (uWS passes strings/nullptr). Fired
  synchronously from `us_socket_close` or from EOF/error paths.
- `on_end(s)` — peer FIN with socket not shut down; uWS responds with close(); with
  `LIBUS_SOCKET_ALLOW_HALF_OPEN` the socket must stay writable.
- `on_timeout(s)` / `on_long_timeout(s)` — from the group sweep (4 s / 1 min granularity).
- `on_handshake(s, success, verify_error /*by value*/, custom_data)` — TLS handshake
  completion; dispatch passes `custom_data = NULL`. httpVTable installs it only for SSL.
- `on_connect_error` / `on_connecting_error` — connect failures (C++ leaves them NULL;
  Rust kinds use them).

### 4.2 Loop callbacks (uWS `Loop.h`)

- `pre_cb` runs EVERY iteration before poll-wait: uWS drains leftover cork slots here
  (max 2 uncork calls). Rust loop's `us_internal_loop_pre` must keep the order:
  `iteration_nr++`, DNS results, low-prio socket handling, `pre_cb(loop)`, quic process.
- `post_cb` after dispatch; `us_internal_loop_post` order: DNS results, quic process,
  free closed sockets (only when `tick_depth <= 1`), free closed udp/connecting sockets.
- `wakeup_cb` on the loop thread after any-thread `us_wakeup_loop`; uWS drains its
  mutex-protected defer queues there.

### 4.3 Dynamic SNI callback (`us_listen_socket_on_server_name`)

`struct ssl_ctx_st *cb(us_listen_socket_t *ls, const char *hostname, int *abort_handshake,
us_socket_t *socket)` — called mid-handshake (inside SSL_do_handshake, JS may run:
BIO loop state must be saved/restored around it, cf. `us_internal_ssl_loop_state_save/
restore`). Return: SSL_CTX to use for THIS handshake only (callee does not cache/own it),
or NULL → default ctx. `*abort_handshake`: 1 = abort; 2 = suspend (async resolver) —
resumed later via `us_socket_sni_resolve(s, ctx /*consumed, nullable*/, error)` which
must be a no-op on a closed socket.

### 4.4 UDP callbacks — §1.8 table.

---

## 5. Cork / LoopData / date header — who owns what

- **All cork state is C++-owned**, in `uWS::LoopData` (two `CorkSlot{buffer,socket,offset,
ssl}` of 16 KB each + LRU bit), which lives in the loop ext region
  (`us_loop_ext(loop)`), placement-new'd by `uWS::Loop::create` right after
  `us_create_loop(..., ext_size = sizeof(LoopData))` and destroyed manually before
  `us_loop_free`. The Rust crate never touches cork state.
- Mutators: `AsyncSocket::cork/uncork/getSendBuffer/write` (acquire/find/touch/release
  slots, force-uncork LRU victim), `HttpResponse::upgrade` →
  `LoopData::transferCorkSlot(slot, newWebSocketPtr, ssl)` after `us_socket_adopt`
  (relocation-aware), `LoopData::unborrowCorkSlot` on socket close paths,
  `uWS::Loop::preCb` drains leftovers each iteration, and SHIM export
  `uws_res_clear_corked_socket(us_loop_t*)` (called from Rust) force-drains both slots.
- **Crate obligations:** (1) ext pointer stable + 16-aligned (LoopData is `alignas(16)`);
  (2) `pre_cb` invoked every iteration before blocking; (3) `us_socket_adopt` returns the
  new pointer so C++ can retarget the slot; (4) nothing in the crate may hold `data`
  pointers across an `on_data` that could adopt.
- **Date header:** `LoopData::date[32]` refreshed by `LoopData::updateDate()`, driven via
  SHIM export `uws_loop_date_header_timer_update(us_loop_t*)` called from the Rust
  runtime's own 1 s timer (bound in `src/uws_sys/Loop.rs`). No usockets timer involved —
  nothing for the crate to provide beyond `us_loop_ext`.

---

## 6. Everything quic.c needs (it survives; the crate is its platform layer)

Functions: `us_create_udp_socket`, `us_udp_socket_close`, `us_udp_socket_user`,
`us_udp_packet_buffer_{payload,payload_length,peer}`, `us_poll_fd`, `us_poll_change`,
`us_create_timer`/`us_timer_set`/`us_timer_loop` (libuv only), `us_ssl_ctx_build_raw`,
`us_get_default_ca_store` (§1.7).

Loop integration:

- Fields (§3.5): `loop->data.quic_head`, `loop->data.quic_next_tick_us`,
  `loop->data.quic_timer` (libuv), `loop->num_polls++/--`.
- Hooks: `us_internal_loop_pre/post` call `us_quic_loop_process(loop)` when
  `quic_head != NULL` (loop.c:405,412 today). Rust equivalents must keep both call sites
  (pre = flush JS-task writes before blocking; post = process this tick's datagrams).
- Poll-timeout folding (epoll/kqueue): the epoll_pwait2 timeout is clamped by
  `quic_next_tick_us` — already implemented Rust-side in `src/runtime/timer/mod.rs` via
  the `InternalLoopData` mirror; keep. (epoll_kqueue.c:368-379 is the C twin being
  deleted — verify the Rust path covers the non-Bun `us_loop_run` too.)
- Constants: `LIBUS_SOCKET_READABLE/WRITABLE` (platform values! EPOLLIN/EPOLLOUT vs 1/2
  kqueue vs UV_READABLE/UV_WRITABLE), `LIBUS_SOCKET_DESCRIPTOR`, `LIBUS_SOCKET_ERROR`
  (-1 / INVALID_SOCKET), `LIBUS_RECV_BUFFER_LENGTH`.
- Headers: quic.c used to include `internal/internal.h` — it now needs a C header
  delivering: the `us_internal_loop_data_t` + `us_loop_t` + `us_poll_t` layouts (or §9
  accessors), the function decls above, and `zig_mutex_t`.
- quic.c also calls libc directly (`getsockname`, `setsockopt` DF bits) on
  `us_poll_fd(...)` — no API needed.

---

## 7. src/uws_sys Rust files: which bindings point INTO C++ (stay) vs into deleted C

**Stay unchanged — bind uws\_\* C++ shim exports (libuwsockets.cpp / libuwsockets_h3.cpp / bun-uws):**

- `App.rs` — 32 `uws_app_*` / `uws_create_app` etc.
- `Response.rs` — 37 `uws_res_*` (+1 `us_socket_mark_needs_more_not_ssl`, shim-defined — see §9.3)
- `Request.rs` — 8 `uws_req_*`
- `WebSocket.rs` — 21 `uws_ws_*`
- `h3.rs` — 58 `uws_h3_*` / H3 res functions
- `Loop.rs` — 8 `uws_*` (`uws_get_loop`, `uws_get_loop_with_native`,
  `uws_res_clear_corked_socket`, `uws_loop_date_header_timer_update`, ...) **plus 9 `us_*`
  decls that must be re-pointed to the crate**
- `BodyReaderMixin.rs`, `thunk.rs` — no FFI decls of either kind.

**Re-point to the new crate (currently extern-into-deleted-C):**
`us_socket_t.rs` (43 fns), `udp.rs` (20), `ConnectingSocket.rs` (14), `SocketGroup.rs` (9),
`ListenSocket.rs` (8), `Loop.rs` (9 us\_\*), `SocketContext.rs` (4: ssl_ctx fns),
`Timer.rs` (4), `lib.rs` (3), `socket.rs` (1). `quic.rs` (`us_quic_global_init`) points
into quic.c — stays extern. Type-only files (`vtable.rs`, `InternalLoopData.rs`,
`SocketKind.rs`, `SocketKinds` statics, `us_bun_verify_error_t`) become the canonical
definitions.

**Rust → C++ exports that already exist and must keep their symbols:** `us_dispatch_*`
(uws*dispatch.rs), `BUN_SOCKET_KIND*\*`statics (SocketKind.rs),`us_socket_buffered_js_write` (uws_jsc.rs, called from JSHS C++).

---

## 8. Constants & macros the public header must keep exporting

| Constant                                                                            | Value                                                     | Consumers                                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `LIBUS_EXT_ALIGNMENT`                                                               | 16                                                        | UWS App.h static_assert; ext-region contract everywhere                 |
| `LIBUS_RECV_BUFFER_LENGTH`                                                          | 524288                                                    | UWS WebSocketProtocol.h (unmask loop bound), QUIC recv batch            |
| `LIBUS_RECV_BUFFER_PADDING`                                                         | 32                                                        | recv_buf over-read guarantee for SIMD unmask                            |
| `LIBUS_TIMEOUT_GRANULARITY`                                                         | 4                                                         | timeout semantics                                                       |
| `LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN / CONNECTION_RESET / FAST_SHUTDOWN`         | 0 / 1 / 2                                                 | UWS App.h + Rust; semantics block comment in libusockets.h is normative |
| listen/socket option enum (`LIBUS_LISTEN_DEFAULT..LIBUS_LISTEN_DEFER_ACCEPT`)       | 0,1,2,4,8,16,32,64                                        | UWS HttpContext.h (`DEFER_ACCEPT`), Rust                                |
| `LIBUS_SOCKET_READABLE / WRITABLE`                                                  | EPOLLIN/EPOLLOUT · 1/2 (kqueue) · UV_READABLE/UV_WRITABLE | SHIM, QUIC — **per-platform, keep in header**                           |
| `LIBUS_SOCKET_DESCRIPTOR`                                                           | int / SOCKET                                              | all                                                                     |
| `LIBUS_SOCKET_ERROR`                                                                | -1 / INVALID_SOCKET                                       | QUIC                                                                    |
| `us_loop_r/us_socket_r/us_poll_r/us_socket_group_r` + `nonnull_arg/nonnull_fn_decl` | macros                                                    | SHIM uses `us_socket_r` in its own definitions                          |
| `POLL_TYPE_*`, `POLL_TYPE_BITSIZE(5)`, masks                                        | internal.h                                                | crate-internal only after §9.3                                          |
| `us_calloc/us_malloc/us_realloc/us_free`                                            | default to libc                                           | header compat only; no surviving consumer overrides them                |

---

## 9. Minimal surface + shrink opportunities (prefer small C++ patches)

### 9.1 Deduplicated extern "C" function export list (C/C++ consumers only)

Loop (6): `us_create_loop`, `us_loop_free`, `us_loop_ext`, `us_loop_run`,
`us_wakeup_loop`, `us_loop_integrate`.
Poll (2): `us_poll_fd`, `us_poll_change`.
Timer (4, libuv/Win): `us_create_timer`, `us_timer_set`, `us_timer_loop`, `us_timer_close`.
Socket (24): `us_socket_write`, `us_socket_write2`, `us_socket_close`,
`us_socket_shutdown`, `us_socket_shutdown_read`, `us_socket_is_closed`,
`us_socket_is_shut_down`, `us_socket_ext`, `us_socket_group`, `us_socket_timeout`,
`us_socket_long_timeout`, `us_socket_pause`, `us_socket_resume`,
`us_socket_remote_address`, `us_socket_get_native_handle`, `us_socket_ref`,
`us_socket_unref`, `us_socket_adopt`, `us_socket_from_fd`,
`us_socket_is_ssl_handshake_finished`, `us_socket_ssl_handshake_callback_has_fired`,
`us_socket_server_name_userdata`, `us_get_remote_address_info`,
`us_get_local_address_info` (+3 moved from SHIM per 9.3: `us_socket_get_fd`,
`us_socket_sendfile_needs_more`, `us_socket_mark_needs_more_not_ssl`).
Group (8): `us_socket_group_init`, `us_socket_group_deinit`, `us_socket_group_close_all`,
`us_socket_group_ext`, `us_socket_group_loop`, `us_socket_group_head_listen_socket`,
`us_socket_group_listen`, `us_socket_group_listen_unix`.
Listen/SNI (7): `us_listen_socket_close`, `us_listen_socket_next`,
`us_listen_socket_group`, `us_listen_socket_add_server_name`,
`us_listen_socket_remove_server_name`, `us_listen_socket_find_server_name_ctx`,
`us_listen_socket_on_server_name`.
SSL/certs (7): `us_ssl_ctx_from_options`, `us_internal_ssl_ctx_unref`,
`us_ssl_ctx_build_raw`, `us_get_default_ca_store`, `us_raw_root_certs`,
`us_get_root_extra_cert_instances`, `us_get_root_system_cert_instances`
(last 4 come from the surviving C++ crypto TUs — §1.7).
UDP (6): `us_create_udp_socket`, `us_udp_socket_close`, `us_udp_socket_user`,
`us_udp_packet_buffer_payload`, `us_udp_packet_buffer_payload_length`,
`us_udp_packet_buffer_peer`.
Data statics (5): `BUN_SOCKET_KIND_*` (already Rust).

**≈ 62 functions + 8 repr(C) types** (`us_socket_group_t`, `us_socket_vtable_t`,
`us_bun_socket_context_options_t`, `us_bun_verify_error_t`, `us_cert_string_t`,
`us_iovec_t`, `enum create_bun_socket_error_t`, and — only where the §9.2 accessors are not applied —
`us_socket_t`/`us_listen_socket_t`/`us_poll_t`/`us_loop_t`/`us_internal_loop_data_t`
partial layouts). Everything else in libusockets.h/internal.h is Rust-internal
(the ~115 `us_*` fns declared in `src/uws_sys/*.rs` are native calls).

### 9.2 Eliminating the C++ field pokes (tiny C++ accessor patches)

1. **`App.h::closeIdle`** (`group->head_sockets`, `s->next`): add
   `struct us_socket_t *us_socket_group_head_socket(us_socket_group_r)` and
   `struct us_socket_t *us_socket_next(us_socket_r)` (or a
   `us_socket_group_for_each` callback walker). Eliminates the only C++ read of
   `us_socket_t` fields → `us_socket_t` becomes fully opaque to bun-uws.
   Caveat: the walker must be close-safe (caller closes `s` after caching `next`).
2. **`HttpContext.h` `us_socket_unref(&socket->s)` ×2**: add
   `void us_listen_socket_unref(struct us_listen_socket_t *)`. Eliminates the
   `us_listen_socket_t` first-member contract → fully opaque.
3. **SHIM-defined `us_socket_get_fd` / `us_socket_sendfile_needs_more` /
   `us_socket_mark_needs_more_not_ssl`**: move all three into the Rust crate as exports
   (they only need fd, closed-check, `last_write_failed` set + poll_change) and delete
   the definitions + the `#include <bun-usockets/src/internal/internal.h>` from
   `libuwsockets.cpp`. After 9.2.1–3, **no surviving C++ needs internal.h at all**;
   `libusockets.h` keeps only opaque forward decls + the §3.7 value types +
   `us_socket_group_t`.
4. **`us_socket_group_t` stays public/repr(C)** (it's embedded by value — an accessor
   can't fix that, and the header already commits to the layout). Freeze it with a
   `static_assert(sizeof)` in the generated header mirroring the Rust
   `#[repr(C)]` definition, since WebSocketContext static_asserts on its size.
5. **quic.c pokes** (`loop->num_polls`, `loop->data.quic_*`): either (a) ship a checked C
   header (`usockets_internal.h`) whose `us_loop_t`/`us_internal_loop_data_t` mirror the
   Rust `#[repr(C)]` structs (they must stay in lockstep with
   `src/uws_sys/InternalLoopData.rs` anyway), or (b) add 4 accessors:
   `us_loop_poll_count_add(loop, int)`, `us_internal_loop_quic_head{,_set}(loop)`,
   `us_internal_loop_quic_next_tick_set(loop, long long)` (+ libuv
   `us_internal_loop_quic_timer{,_set}`). (b) makes `us_loop_t` fully opaque to all
   surviving C/C++ — preferred; the Rust runtime keeps reading the struct natively.

### 9.3 Semantics most likely to cause silent runtime corruption if drifted

1. `on_data` buffer = shared mutable `recv_buf` with 32-byte padding both ends; WebSocket
   unmasking writes to it and over-reads in 16-byte strides.
2. `us_socket_adopt` relocation + cork-slot retargeting + dispatch continuing on the
   returned pointer (WS upgrade path).
3. Deferred close/free discipline: `on_close` synchronous, memory reclaim only in
   outermost `loop_post` (`tick_depth`), incl. `closed_udp_head` for QUIC's teardown
   loops.
4. `us_wakeup_loop` thread-safety + `pending_wakeups` fast-return.
5. `pre_cb` every iteration (cork drain) and pre/post quic hooks ordering (§6).
6. `us_listen_socket_find_server_name_ctx` returns an OWNED ref (App.h unrefs);
   `us_ssl_ctx_from_options` BY-VALUE options struct memcpy-shared with
   `uWS::SocketContextOptions`.
7. `LIBUS_SOCKET_READABLE/WRITABLE` are different values per platform — they cross the
   ABI in `us_poll_change` calls from quic.c and the needs-more helpers.
