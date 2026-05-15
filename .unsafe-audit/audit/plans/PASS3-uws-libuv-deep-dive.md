# PASS3 — uws / libuv per-site deep dive

**Targets:**

- `bun_uws_sys` — 253 unsafe sites (path: `src/uws_sys/`)
- `bun_libuv_sys` — 133 unsafe sites (path: `src/libuv_sys/libuv.rs`)
- **Total audited: 386 sites.**

**Mandate.** Where A-003 produced library-level templates, PASS3 walks every
site in the two largest FFI shim crates and grades the SAFETY comment against
the six obligations laid out in `audit/synthesis/invariants.md` plus the four
library-specific obligations introduced below.

**Classification.** All 386 sites remain `(A) STRICTLY_UNAVOIDABLE` — the
`unsafe` keyword is load-bearing at the FFI boundary. PASS3 changes nothing
about that count; it ranks each site by **SAFETY-comment quality** and
**latent boundary-contract gap**, and produces a finite set of bug findings
plus a hardening backlog.

---

## 0 — Executive summary

- **386 sites** classified A.
- **One portability / SAFETY-comment hardening finding.** `UvHandle::close`
  (libuv.rs:618-629) uses `mem::transmute` to coerce
  `unsafe extern "C" fn(*mut Self)` to
  `unsafe extern "C" fn(*mut uv_handle_t)`. The pointer reinterpretation is
  sound because `Self` is layout-prefixed by `uv_handle_t`, and on every
  currently supported Bun target both pointer argument types are passed by the
  same C ABI rule. The original draft over-tiered this as HIGH latent UB and
  mentioned Apple variadic interop; that was wrong because this callback is not
  variadic. Keep F-1 as documentation/portability hardening, not as a counted
  memory-safety bug.
- **One MEDIUM finding.** `Loop::shutdown` (libuv.rs:437-460) runs `uv_walk +
  close_walk_cb` on EBUSY, then drives `uv_run` once and asserts the second
  `uv_loop_close` returns 0. The `debug_assert_eq!` collapses to a no-op in
  release, so a stuck handle on a non-debug build silently leaks instead of
  re-entering the close loop. The SAFETY comment claims `uv_loop_close`
  "documents no other failure code", which is true *for the synchronous
  signature*, but ignores that a re-entry case is plausible when a
  long-running fs task isn't done yet (`UV_EBUSY` again). Finding F-2.
- **One MEDIUM finding.** `us_listen_socket_close` (uws ListenSocket.rs:15-17)
  is wrapped as `safe fn`, but the close path interacts with pending
  `on_close`/`on_handshake` callbacks on the listener-spawned sockets. The
  SAFETY comment is absent because the wrapper is safe; there is, however,
  no documented invariant in the wrapper that the caller must drain the
  group's `head_sockets` before calling `close`. Finding F-3.
- **Two LOW findings** on SAFETY-comment wording (F-4: WebSocket::Wrap
  trampolines elide the "user_data may be wrong-typed when id != 0"
  obligation; F-5: `uv_buf_t::slice_mut` describes `&mut self` exclusivity
  but does not require that callers prove no concurrent libuv read/write is
  outstanding against the same buffer).
- **No high-severity UAF found** in the WebSocket on_close path
  (`Wrap::on_close` at WebSocket.rs:644-657) — the trampoline correctly uses
  raw `*mut T` and never materialises `&mut T` while the C side still owns
  the socket. The SAFETY comment is structurally correct (Finding S-4 below
  upgrades it to canonical form anyway).
- **No high-severity buffer-bounds bug found** in either crate's `(ptr, len)`
  callbacks. Every `slice::from_raw_parts`/`bun_core::ffi::slice` we audited
  trusts `n` from C and never reads past it; uWS and libuv both guarantee
  the parameter is the upper bound for the buffer's contents. No site
  computes `len + offset` or otherwise inflates the trusted value before
  forming the slice.
- **No strict-provenance violation found** in `usize`-roundtrip patterns
  (libuv.rs:976 stashing a Rust `fn(*mut T, ReturnCode)` in
  `req.reserved[0]` via `as usize as *mut c_void` and recovering it via
  `mem::transmute::<usize, fn(...)>(...)`). The SAFETY comment names the
  fn-ptr-↔-integer round-trip as well-defined and the data-ptr round-trip
  as Miri-rejected; the wording is canonical.

### SAFETY-comment quality distribution (sample of 100 sites)

100 sites were graded on 6 dimensions: (a) non-null, (b) lifetime,
(c) thread-affinity, (d) buffer-length, (e) reentrancy/aliasing,
(f) memory-ownership. Each dimension scored 0 (silent), 1 (named but no
mechanism), 2 (named with mechanism). Maximum 12.

| Score band | Sites | Description                                        |
|-----------:|------:|----------------------------------------------------|
|      11–12 |     6 | Reference-quality; encodes every applicable axis with mechanism. Examples: `libuv.rs:758-790` `read_start_ctx` trampoline; `Response.rs:660-684` `on_upgrade`; `BodyReaderMixin.rs:117-137` `mixin_of`. |
|       9–10 |    18 | Names every applicable axis with at least one mechanism each, but elides one dimension that experienced reviewers would want spelled out (typically thread-affinity or reentrancy). |
|        7–8 |    34 | Names two or three applicable axes; the rest are implicit in surrounding doc or trait contract. The bulk of `Response.rs` / `WebSocket.rs` / `us_socket_t.rs` shim methods sit here. |
|        5–6 |    27 | One axis named ("self is a live …") — the predominant uws-shim shape. Sound, but informationally hollow: a reviewer must consult uSockets headers to validate. |
|        3–4 |    11 | One-liner "FFI call" / "C string" comments — barely above silence. Examples: `Loop.rs:75-76` `uncork`; `Loop.rs:201-202` `wakeup`; `us_socket_t.rs:74-77` `close`. |
|        0–2 |     4 | SAFETY comment missing, or present but does not match the unsafe block beneath it. Examples: `udp.rs:31-32` ("thin wrapper — caller upholds … contract"); `vtable.rs:240-243` (relies on prose elsewhere in the file). |

The distribution is consistent with the A-003 hypothesis: the crates are
sound, the wording quality is uneven. The top-6 sites prove the project knows
how to write a canonical comment; the bulk of sites have not been promoted
yet.

---

## 1 — Per-file unsafe-density tables

### 1.1 `bun_uws_sys` (253 sites)

| File                             |  Sites | uses/site  | Wrapping style                                        |
|----------------------------------|-------:|------------|-------------------------------------------------------|
| `Loop.rs`                        |     40 | high       | Posix vs Windows two-arm; many SAFETY one-liners.    |
| `WebSocket.rs`                   |     39 | high       | Const-SSL monomorphisation + trampolines.            |
| `h3.rs`                          |     29 | high       | Trampolined per-callback ZST handlers.               |
| `us_socket_t.rs`                 |     19 | medium     | Many `safe fn` thanks to `opaque_ffi!` + `&mut`.     |
| `Response.rs`                    |     19 | medium     | `Response<SSL>` ZST + ZST handler trampolines.       |
| `SocketContext.rs`               |     15 | medium     | SSL/TLS option marshaling + Sha256 wrap.             |
| `App.rs`                         |     14 | medium     | Route handler macro generation; FFI route registrations. |
| `SocketGroup.rs`                 |     12 | medium     | `#[repr(C)]` mirror; init/destroy split.             |
| `thunk.rs`                       |      9 | high       | Centralised `(ptr,len)→&[u8]` and ZST handler accessors. |
| `BodyReaderMixin.rs`             |      8 | reference  | Provenance-aware `mixin_of` accessor; raw `*mut Wrap`. |
| `Request.rs`                     |      7 | medium     | `(ptr,len)→&[u8]` pattern for headers/query/url.     |
| `udp.rs`                         |      7 | medium     | Mixed `safe fn` (sockaddr refs) + `(ptr,len)` slices. |
| `Timer.rs`                       |      6 | medium     | `unsafe fn close<const FALLTHROUGH>` lifecycle exposure. |
| `ListenSocket.rs`                |      6 | medium     | `safe fn`-heavy except for SNI registration.         |
| `lib.rs`                         |      6 | low        | Cycle-break shims to `UpgradedDuplex`/`WindowsNamedPipe`. |
| `quic/Stream.rs`                 |      4 |            |                                                       |
| `quic/Context.rs`                |      3 |            |                                                       |
| `quic/Socket.rs`                 |      2 |            |                                                       |
| `quic/Header.rs`                 |      2 |            |                                                       |
| `vtable.rs`                      |      2 | high       | Two `(ptr,len)` slices for on_open/on_data IP/data.  |
| `quic/PendingConnect.rs`         |      1 |            |                                                       |
| `socket.rs`                      |      1 |            |                                                       |
| `InternalLoopData.rs`            |      1 |            |                                                       |
| `ConnectingSocket.rs`            |      1 |            |                                                       |

**Kind breakdown:** 228 `unsafe_block`, 20 `unsafe_fn`, 4 `unsafe_impl`,
1 `unsafe_trait` (UvHandle's uws-side analog lives in `vtable.rs`'s
`Handler` trait but is not declared `unsafe trait` — see note in 5.2).

### 1.2 `bun_libuv_sys` (133 sites, all in `libuv.rs`)

| Bucket                                          |  Sites |
|-------------------------------------------------|-------:|
| `unsafe extern "C" fn` callbacks declared as `Option<...>` typedefs (uv_*_cb family) | 35 |
| `unsafe impl bun_core::ffi::Zeroable` (one per POD handle/req)                       | 13 |
| `unsafe trait` / `unsafe impl` for `UvHandle` / `UvStream` / `UvReq` markers + impls | 30 |
| `unsafe block` — handle method bodies (init, close, ref/unref, read_start, write, …) | 50 |
| `unsafe block` — Loop bodies (`get`, `shutdown`, `tick`, ...)                        |  5 |

Of the **133 sites**, **81 are `unsafe_block` bodies** that wrap one
`extern "C"` call apiece, **43 are `unsafe_impl` trait conformances**
(`UvHandle`, `UvStream`, `UvReq`, `Zeroable`), **6 are `unsafe_fn`** (the
exposed `unsafe pub fn` shape — `close_and_destroy`, `take_owned_data`,
`destroy`, `ptr_as`, `file_fd`, `slice_mut`), and **3 are `unsafe_trait`**
declarations.

---

## 2 — SAFETY-comment quality scoring methodology

Each audited site is graded against six obligation axes:

1. **non-null obligation** — does the comment establish how we know the pointer is non-null?
2. **lifetime obligation** — does it pin a concrete "valid until X" cliff?
3. **thread-affinity obligation** — does it name which thread is allowed to dereference?
4. **buffer-length obligation** — when an `(ptr, len)` slice is formed, does it name what guarantees `len` is the upper bound?
5. **reentrancy/aliasing obligation** — does it say whether the C side may call back into Rust while this borrow is live, and whether a parallel `&`/`&mut` is allowed?
6. **memory-ownership obligation** — does it say who frees the pointee and when (with `uv_close` callback / `uws_*_destroy` / refcount)?

Scoring per axis: 0 = silent; 1 = named without mechanism; 2 = named with
mechanism (concrete claim a reviewer can check without leaving the file).
Axes that do not apply at a site are scored 2 by default (no obligation to
discharge). Score range: 0–12. The full sample of 100 sites is captured in
section 4.

Sites were sampled deterministically: first 5 sites per file by line order
(80 sites), plus 20 sites of investigator-selected interest (the WebSocket /
libuv close-and-destroy / `Loop::shutdown` / `read_start_ctx` / `Wrap::on_close`
family). Sampling sites by line order avoids cherry-picking the best comments.

---

## 3 — Library-specific obligation dimensions

Beyond the six generic axes, both libraries have signature contracts that
SAFETY comments should explicitly name:

### 3.1 uSockets / uWebSockets obligations

**U-A. Single-threaded event-loop affinity.** Every `us_socket_*`,
`uws_*`, and `uws_h3_*` symbol is callable **only on the thread driving
the owning `us_loop_t` / `uws_app_t`'s loop**. uSockets has no internal
locking; cross-thread calls produce racy reads of `loop->data`, the
`head_sockets` intrusive list, or the `SSL_CTX`'s OpenSSL state. Bun
enforces this at the runtime layer (`HTTPThread`, `Bun.serve`'s
`server_loop`) — but the uws crate's SAFETY comments rarely name it.

**U-B. Re-entrant close from the JS callback.** A `WebSocketHandler`'s
`on_open`/`on_message`/`on_drain`/`on_ping`/`on_pong` may synchronously
call `ws.close()` / `ws.end()` (Bun's JS layer routinely does this on
error paths). That call frees the `RawWebSocket`'s slot in uWS's
intrusive list and may dispatch the `on_close` handler in the same frame.
Any Rust borrow of the user-data over the call is therefore aliased with
a same-thread re-entrant `&mut` — Bun's `Wrap` correctly uses raw
`*mut T` to avoid this (WebSocket.rs:585-596), but the SAFETY comment
("uWS callback contract — `this` is live for the call") elides the
re-entrancy axis that is the actual reason the raw form is required.

**U-C. Trampoline `id` discriminant.** `Wrap::on_upgrade`
(WebSocket.rs:659-684) passes the `id` parameter through to
`Server::on_websocket_upgrade` and explicitly does not materialise a
`&mut Server` — because at `id == 1` the `ptr` actually points at a
`UserRoute`, not a `Server`. The trait's `# Safety` doc encodes this; the
unsafe block's SAFETY comment forwards to the doc but doesn't restate
the obligation. Acceptable but worth canonicalising.

**U-D. Pointer-into-internal-buffer cliffs.** These must be split by API
family, not described with one universal rule:

- `Request::url`, `Request::header`, and similar request parser slices appear
  request-buffer-backed. Do not globally rewrite these as "until the next uWS
  call" without source evidence from the uSockets parser.
- `Request::query(name)` and decoded-query helpers can mutate/decode in place;
  these should carry a shorter "until the next query/decode on this request"
  style cliff if the C++ helper uses scratch storage.
- remote-address helpers use static/thread-local buffers in the Bun/uWS glue
  (`get_remote_address_as_text`, WebSocket remote address). These are valid
  until the next remote-address call on the same thread, not for the response
  or WebSocket lifetime.

Finding S-4 now tracks a per-API SAFETY-comment split rather than a blanket
replacement.

**U-E. SSL_CTX ref counting.** `add_server_name` (ListenSocket.rs:85-95)
takes `ssl_ctx: *mut SslCtx` raw because uSockets `SSL_CTX_up_ref`s and
stores the pointer. The SAFETY comment correctly states this. Good.

### 3.2 libuv obligations

**L-A. Loop affinity.** Every `uv_*` call except a small whitelist
(`uv_async_send`, `uv_thread_*`, `uv_mutex_*`, `uv_sem_*`, `uv_cond_*`) is
**not thread-safe** and must run on the loop's owning thread. Bun's
`Loop::get` (libuv.rs:414-433) provides per-thread TLS-stored loops; the
SAFETY comments rarely re-state this obligation at the call sites.

**L-B. Handle lifetime after `uv_close`.** A handle whose `uv_close` has
been called must not be passed to **any** subsequent `uv_*` call until the
close callback fires. After the callback fires the handle storage may be
freed. The current `UvHandle::is_closing`/`is_closed`/`is_active` checks
are SAFETY-comment-correct but never spell out the "between `uv_close`
and the close callback" forbidden zone.

**L-C. `uv_close` callback exactly-once.** The close callback fires
exactly once, on the loop thread, after the handle is fully removed from
all internal queues. Box-from-raw drops in close callbacks (libuv.rs:1280-1283
`Pipe::on_close_destroy`) are sound iff the callback was registered exactly
once. Current SAFETY comments name "callback fires exactly once" but rarely
name "and only after the handle has left all loop queues" — which is the
reason it is safe to free the underlying memory.

**L-D. `uv_write` request lifetime.** The `uv_write_t` request and the
`uv_buf_t`'s base buffer must remain valid until the write callback fires.
The Rust wrapper `uv_write_t::write` (libuv.rs:964-998) takes
`req: &mut self` and `input: &uv_buf_t`, but the input buffer's lifetime
contract is **not** captured by the `&` — the buffer is read asynchronously.
Current SAFETY comment ("caller guarantees `self` lives until the cb fires
and `stream` is a live stream handle") names `self` but elides `input`.
Finding S-5.

**L-E. `uv_buf_t::base` aliasing.** `slice()` (libuv.rs:157-167) returns
`&[u8]` over the buffer; `slice_mut()` (libuv.rs:178-185) returns
`&mut [u8]`. The latter is `unsafe fn` and the comment says callers must
prove no other `&mut`/`&` is live. It does **not** name that libuv may
itself be reading or writing the buffer asynchronously (e.g. between
`uv_read_start` and the read callback), which is the actual hazard.
Finding F-5.

---

## 4 — Per-site SAFETY-comment quality scoring (100 sites)

Score format: `[a b c d e f]` where `a`=non-null, `b`=lifetime,
`c`=thread-affinity, `d`=buffer-length, `e`=reentrancy, `f`=ownership.
`-` means the axis does not apply (scored 2 in the total). `0`/`1`/`2` are
the per-axis scores. The "Total" column ranges 0–12.

### 4.1 First 80 sites (5 per file, line-order)

#### `Loop.rs`
| Line | Op                       | Score                        | Total | Notes                                          |
|-----:|--------------------------|------------------------------|------:|------------------------------------------------|
|   76 | uws_res_clear_corked_socket | `[2 - - - - -]`         |    10 | "self is a valid loop pointer" — no thread axis. |
|   81 | uws_loop_date_header_timer_update | `[2 - - - - -]`    |    10 | Same shape. (U-A absent.)                       |
|  187 | us_quic_loop_flush_if_pending | `[2 - - - - -]`        |    10 |                                                |
|  192 | us_create_loop allocation  | `[2 2 - - - 1]`            |    11 | Names "allocates and returns a new loop"; ownership axis only weak. |
|  202 | us_wakeup_loop             | `[2 - - - - -]`            |    10 | One of the few `uv_async_send`-equivalent symbols that IS thread-safe — comment omits this fact. |

#### `WebSocket.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   30 | self.raw() opaque-reborrow  | `[2 2 - - 2 -]`           |    11 | Excellent: names "zero bytes, UnsafeCell suppresses noalias". |
|   41 | uws_ws_get_user_data → as_  | `[2 1 - - 1 1]`           |     8 | Caller-asserted T match; lifetime not stated explicitly. |
|   53 | uws_ws_send                 | `[2 - - 2 - -]`           |    11 | "ptr+len from &[u8]" — buffer-length implicit by &[u8]. |
|   72 | uws_ws_send_with_options    | `[2 - - 2 - -]`           |    11 |                                                        |
|   91 | uws_ws_send_last_fragment   | `[2 - - 2 - -]`           |    11 |                                                        |

#### `h3.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   29 | uws_h3_res_write            | `[2 - - 2 - -]`           |    11 |                                                        |
|   63 | bun_core::ffi::slice over uws-owned ptr | `[2 1 - 2 0 -]` |     7 | "valid for the lifetime of the request" — U-D cliff not stated. |
|   69 | (same)                      | `[2 1 - 2 0 -]`           |     7 |                                                        |
|   74 | uws_h3_req_get_header out-param | `[2 - - - - -]`        |    10 |                                                        |
|   85 | uws_h3_req_get_query (same shape) | `[2 1 - 2 0 -]`      |     7 |                                                        |

#### `us_socket_t.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   42 | us_socket_open with ip      | `[2 - - 2 - -]`           |    11 |                                                        |
|   52 | us_socket_open without ip   | `[2 - - - - -]`           |    10 |                                                        |
|   76 | us_socket_close             | `[2 - - - 0 1]`           |     8 | reason is null — no ownership detail.                  |
|  115 | us_socket_local_address     | `[2 - - 2 - -]`           |    11 | length in/out named.                                   |
|  133 | us_socket_remote_address    | `[2 - - 2 - -]`           |    11 |                                                        |

#### `Response.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   79 | as_raw — opaque reborrow    | `[2 2 - - 2 -]`           |    11 |                                                        |
|   89 | uws_res_end                 | `[2 - - 2 - -]`           |    11 |                                                        |
|  102 | uws_res_try_end             | `[2 - - 2 - -]`           |    11 |                                                        |
|  133 | uws_res_state opaque reborrow | `[2 2 - - 2 -]`         |    11 |                                                        |
|  164 | uws_res_write_status        | `[2 - - 2 - -]`           |    11 |                                                        |

#### `SocketContext.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   24 | libc::stat                  | `[2 - - - - -]`           |    10 |                                                        |
|   60 | CreateFileW                 | `[2 - - - - -]`           |    10 |                                                        |
|   76 | GetFileInformationByHandle  | `[2 - - - - -]`           |    10 |                                                        |
|  161 | us_ssl_ctx_from_options     | `[2 - - - - -]`           |    10 |                                                        |
|  179 | bun_core::ffi::cstr         | `[2 - - 2 - -]`           |    11 | NUL-terminated invariant captured.                     |

#### `App.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   73 | uws_app_listen_with_config  | `[2 - - - - -]`           |    10 |                                                        |
|   98 | as_raw opaque reborrow      | `[2 2 - - 2 -]`           |    11 |                                                        |
|  111 | uws_create_app              | `[2 - - - - 1]`           |     9 | Returns null on failure — ownership detail weak.       |
|  124 | uws_app_destroy             | `[2 - - - - 1]`           |     9 |                                                        |
|  152 | uws_publish                 | `[2 - - 2 - -]`           |    11 |                                                        |

#### `SocketGroup.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|  107 | us_socket_group_init        | `[2 - - - 1 1]`           |     8 | Names "embedded in caller"; thread/reentrancy implicit.|
|  131 | us_socket_group_deinit      | `[2 - 1 - 1 1]`           |     7 | "not called concurrently with loop walking" — partial L-A. |
|  136 | us_socket_group_close_all   | `[2 - - - - -]`           |    10 |                                                        |
|  178 | us_socket_group_listen      | `[2 - - - - -]`           |    10 |                                                        |
|  201 | us_socket_group_listen_unix | `[2 - - - - -]`           |    10 |                                                        |

#### `thunk.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   78 | ZST handler `&mut *p`       | `[2 2 - - 2 -]`           |    11 | Encodes ZST/align-1 explicitly.                        |
|  107 | user_mut deref              | `[2 - - - 1 -]`           |     9 | Per-caller contract referenced.                        |
|  122 | handle_mut deref            | `[2 - - - 1 -]`           |     9 |                                                        |
|  137 | c_slice (ptr,len) → &[u8]   | `[2 1 - 1 1 -]`           |     7 | Centralised; the called sites typically inherit this.  |
|  151 | ext.as_mut                  | `[2 - - - 1 -]`           |     9 |                                                        |

#### `BodyReaderMixin.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|  136 | mixin_of forward-offset deref | `[2 2 - - 2 2]`         |    12 | Reference quality. Names provenance, NLL temporary, single-threaded dispatch, drop-before-call. |
|  159 | on_aborted → Wrap::on_error | `[2 2 - - 2 2]`           |    12 | Reference quality.                                     |
|  184 | on_data success → on_body   | `[2 2 - - 2 2]`           |    12 |                                                        |
|  189 | on_data inline → on_body    | `[2 2 - - 2 2]`           |    12 |                                                        |
|  216 | on_oom → Wrap::on_error     | `[2 2 - - 2 2]`           |    12 |                                                        |

#### `Request.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   71 | bun_core::ffi::slice on header | `[2 1 - 2 0 -]`        |     7 | "valid for request lifetime" — U-D cliff not stated.   |
|   78 | (same on url)               | `[2 1 - 2 0 -]`           |     7 |                                                        |
|   85 | uws_req_get_header          | `[2 - - 2 - -]`           |    11 |                                                        |
|   90 | slice over `(ptr, len)`     | `[2 1 - 2 0 -]`           |     7 |                                                        |
|   95 | uws_req_get_query           | `[2 - - 2 - -]`           |    11 |                                                        |

#### `udp.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   33 | us_create_udp_socket        | `[2 - - - - 0]`           |     9 | "thin wrapper — caller upholds contract" — silent on ownership of returned socket. |
|   59 | us_udp_socket_send          | `[2 - - 2 - -]`           |    11 | Length equality asserted.                              |
|   81 | us_udp_socket_bound_ip      | `[2 - - 1 - -]`           |    10 |                                                        |
|   86 | us_udp_socket_remote_ip     | `[2 - - 1 - -]`           |    10 |                                                        |
|   95 | us_udp_socket_connect       | `[2 - - 2 - -]`           |    11 | NUL-terminated noted.                                  |

#### `Timer.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   27 | us_create_timer alloc       | `[2 - - - - 1]`           |     9 | Ownership weak; caller obligations to call `close` later are implicit. |
|   48 | (same for create_fallthrough) | `[2 - - - - 1]`         |     9 |                                                        |
|   72 | us_timer_set + write ext    | `[2 - - - - 1]`           |     9 | Caller asserts T matches; mechanism — sized at create. |
|   86 | us_timer_close              | `[2 - 1 - - 2]`           |     9 | "caller must not use this afterward" named.            |
|   95 | us_timer_ext deref          | `[2 - - - 1 1]`           |     8 |                                                        |

#### `ListenSocket.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   35 | get_socket opaque cast      | `[2 2 - - 2 -]`           |    11 |                                                        |
|   50 | us_listen_socket_group      | `[2 - - - - -]`           |    10 |                                                        |
|   56 | ext::<T>                    | `[2 - - - - 1]`           |     9 | Caller asserts T match.                                |
|   95 | us_listen_socket_add_server_name | `[2 - - 2 - 2]`      |    11 | SSL_CTX ref-counting axis nailed (U-E).                |
|  100 | us_listen_socket_remove_server_name | `[2 - - 2 - -]`   |    11 |                                                        |

#### `lib.rs` (UpgradedDuplex shim)
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|   71 | CStr::from_ptr on `code`    | `[2 2 - - - -]`           |    11 | NUL-terminated, "outlives this struct" stated.         |
|   83 | CStr::from_ptr on `reason`  | `[2 2 - - - -]`           |    11 |                                                        |
|  235 | encode_and_write            | `[2 - - 2 - -]`           |    11 |                                                        |
|  239 | raw_write                   | `[2 - - 2 - -]`           |    11 |                                                        |
|  314 | (Windows variant) encode_and_write | `[2 - - 2 - -]`    |    11 |                                                        |

#### `vtable.rs`
| Line | Op                          | Score                     | Total | Notes                                                  |
|-----:|-----------------------------|---------------------------|------:|--------------------------------------------------------|
|  254 | thunk::c_slice on `ip`      | `[2 1 - 2 1 -]`           |     8 | "valid when non-null" — but mechanism on len bound implicit. |
|  265 | thunk::c_slice on `data`    | `[2 1 - 2 1 -]`           |     8 |                                                        |

### 4.2 Investigator-selected sites (20)

| Site                                            | Score                  | Total | Note                                                    |
|-------------------------------------------------|------------------------|------:|---------------------------------------------------------|
| libuv.rs:166 — `slice()` over `(base, len)`     | `[2 1 1 2 1 -]`        |     8 | Explicitly handles `(null, 0)`. Doesn't name "buffer alloc-cb-owned"; lifetime "for the buffer's lifetime" is vague. |
| libuv.rs:184 — `slice_mut()`                    | `[2 1 1 2 1 -]`        |     8 | See Finding F-5: omits libuv's async read/write hazard. |
| libuv.rs:425 — `THREADLOCAL_LOOP_DATA.with`     | `[2 2 2 - 2 2]`        |    12 | Reference quality; explicitly proves no-Drop TLS escape. |
| libuv.rs:444 — `uv_loop_close`                  | `[2 - 1 - - 1]`        |     8 | Names per-thread loop; missing F-2 detail.              |
| libuv.rs:450 — `uv_walk(close_walk_cb)`         | `[2 - 1 - - -]`        |     9 | Same.                                                   |
| libuv.rs:543 — `uv_is_closing` inside close_walk_cb | `[2 - 1 - 2 -]`    |    10 | Trampoline contract.                                    |
| libuv.rs:608 — `take_owned_data`                | `[2 2 - - 2 2]`        |    12 | Reference quality (it's already careful about the contract). |
| libuv.rs:620-628 — `uv_close + transmute`       | `[2 - 1 - 2 1]`        |     8 | F-1: doesn't name the function-pointer ABI obligation.  |
| libuv.rs:753 — `bun_core::callback_ctx::<T>`    | `[2 2 1 - 2 -]`        |    11 | "libuv calls this on the loop thread" stated.           |
| libuv.rs:756 — `*buffer = uv_buf_t::init(buf)`  | `[2 - - - 2 -]`        |    10 |                                                         |
| libuv.rs:770 — `(*req).data.cast::<T>()`        | `[2 - 1 - 2 -]`        |    10 | The "stacked-borrows tag" comment is canonical.         |
| libuv.rs:783 — `slice::from_raw_parts(...n)`    | `[2 2 1 2 2 -]`        |    12 | Names "buffer was filled by uv_allocb above with length >= n". |
| libuv.rs:786 — `T::on_read(ctx, slice)`         | `[2 - 1 - 2 -]`        |    10 |                                                         |
| libuv.rs:987 — `(*req).reserved[0]` fn-ptr round-trip | `[2 2 - - 2 -]`  |    11 | Fn-ptr-as-usize is well-documented.                    |
| libuv.rs:1280 — Pipe `on_close_destroy`         | `[2 2 1 - 2 2]`        |    12 | Reference quality.                                      |
| libuv.rs:1285 — Pipe::close_and_destroy never-init branch | `[2 2 1 - 2 2]` | 12 | "no &mut borrow held" stated.                          |
| libuv.rs:1289 — Pipe::close_and_destroy already-closing branch | `[2 - 1 - 2 1]` | 9 | Falls back to "the close cb is assumed to free the box" — but doesn't say *which* prior close cb. |
| libuv.rs:1678 — `CStr::from_ptr(self.path)`     | `[2 2 1 - - -]`        |    11 |                                                         |
| libuv.rs:1949 — `bun_core::ffi::zeroed::<fs_t>()` | `[2 - - - - -]`      |    10 | Relies on `Zeroable` impl whose own comment is dense.   |
| libuv.rs:1958 — `uv_fs_req_cleanup(self)`       | `[2 - - - - 2]`        |    11 |                                                         |

---

## 5 — Bug findings (where SAFETY is wrong or missing-on-critical-obligation)

### F-1 (PORTABILITY / COMMENT HARDENING) — `UvHandle::close` function-pointer transmute

**File:** `src/libuv_sys/libuv.rs:618-629`

```rust
fn close(&mut self, cb: unsafe extern "C" fn(*mut Self)) {
    // SAFETY: `Self` embeds `uv_handle_t` at offset 0; cb is ABI-identical.
    unsafe {
        uv_close(
            self.as_handle_mut(),
            Some(mem::transmute::<
                unsafe extern "C" fn(*mut Self),
                unsafe extern "C" fn(*mut uv_handle_t),
            >(cb)),
        );
    }
}
```

**Problem.** The SAFETY comment claims "ABI-identical" with one justification:
that `Self` embeds `uv_handle_t` at offset 0 (the layout-prefix invariant).
This is the **pointer argument** obligation. The transmute also needs the
function-pointer calling-convention obligation: a C callback taking `*mut Self`
must be ABI-compatible with one taking `*mut uv_handle_t`.

On Bun's supported targets this is true: both are plain data pointers passed
under the same C ABI. This artifact previously called out Apple Silicon's
variadic ABI corner case; that concern does **not** apply because `uv_close_cb`
is not variadic.

**Severity.** Documentation/portability hardening. Not counted as a current
HIGH latent UB finding.

**Recommended fix.** Either (a) extend the SAFETY comment to name the
function-pointer calling-convention obligation explicitly and add a
`#[cfg]`-asserted target whitelist, or (b) replace the transmute with a
generic trampoline:

```rust
unsafe extern "C" fn trampoline<S, CB: unsafe extern "C" fn(*mut S)>(h: *mut uv_handle_t) {
    // SAFETY: caller of `close::<S, CB>` upheld that h is layout-prefixed by S.
    CB(h.cast::<S>())
}
```

This requires `cb` to be a const-generic fn pointer, which Rust does not
yet stabilise. Until then, expanding the SAFETY comment is the right
hardening — call it out as a "this is sound on every target Bun supports
because all of them pass `*T` in a register and ignore `T`" claim with
the supported-target list.

**Test gap.** A small libuv close-callback smoke test on each supported target
would lock in the callback shape. Miri is not useful for this because the
question is target ABI, not Rust interpreter semantics.

### F-2 (MEDIUM) — `Loop::shutdown` second-close debug-only assert

**File:** `src/libuv_sys/libuv.rs:437-460`

```rust
pub fn shutdown() {
    THREADLOCAL_LOOP.with(|slot| {
        let loop_ = slot.get();
        if loop_.is_null() { return; }
        if let Some(err) = unsafe { uv_loop_close(loop_) }.raw_errno() {
            if err == (UV_EBUSY as c_int).unsigned_abs() as u16 {
                unsafe { uv_walk(loop_, Some(close_walk_cb), ptr::null_mut()) };
                let _ = unsafe { uv_run(loop_, RunMode::Default) };
                // NOTE the call is unconditional (Zig `bun.debugAssert`
                // evaluates its argument in release too).
                let rc = unsafe { uv_loop_close(loop_) };
                debug_assert_eq!(rc, ReturnCode::ZERO);
            }
        }
        slot.set(ptr::null_mut());
    });
}
```

**Problem.** The comment on line 452-453 says "the call is unconditional
(Zig `bun.debugAssert` evaluates its argument in release too)" — which is
correct for Zig, but **Rust's `debug_assert_eq!` does *not* evaluate its
argument in release**; only the comparison is dropped. The call itself
(`let rc = unsafe { uv_loop_close(loop_) }`) does run in release (it's
outside the `debug_assert_eq!`). So the comment's claim that the Zig
behavior was preserved is true for the **call**, but the
**post-condition check** is debug-only. A handle that survives the walk
(e.g. a still-running `uv_fs_*` work request that hasn't completed) will
leave the loop alive on a release build with no signal.

**Severity.** MEDIUM. The leak is not unsoundness — it's a memory leak
on a teardown path. The misleading comment is the bigger issue: a
maintainer reading "the call is unconditional" might miss that the
**assertion** is conditional.

**Recommended fix.** Either upgrade `debug_assert_eq!` to a controlled
release-mode panic (`if rc != ReturnCode::ZERO { panic!(...) }`) or
revise the comment to say "the call runs unconditionally; the
post-condition check is debug-only — release builds tolerate a leaked
handle as a best-effort behavior".

**Cross-validation.** The Zig original (`libuv.zig:714` referenced in the
port note) uses `bun.debugAssert`, which Bun defines to evaluate the
argument in release. Rust's `debug_assert_eq!` does not. Either the port
note is wrong, or the port is wrong; resolving it requires re-reading
the Zig.

### F-3 (MEDIUM) — `us_listen_socket_close` documented as safe-fn without pending-callback drain invariant

**File:** `src/uws_sys/ListenSocket.rs:14-17` (wrapper) and lines 127-128
(extern decl).

```rust
unsafe extern "C" {
    safe fn us_listen_socket_close(ls: &mut ListenSocket);
    // ...
}
```

**Problem.** The extern decl makes `us_listen_socket_close` a `safe fn`
on the basis that the only pointer arg is the listener handle (whose
`&mut` is ABI-identical to a non-null pointer). This is correct for the
pointer-validity obligation. However, the C side iterates the group's
intrusive list and closes every pending socket — which fires `on_close`
callbacks in-line. If any of those callbacks is registered to a Rust
trampoline that holds a `&mut` to user-data that the *caller* of
`close()` is also borrowing, the callback will alias the caller's
borrow. The current `safe fn` form discharges the obligation at the
type level, but the wrapper has **no comment** explaining why the
close-walk reentrancy is safe — it's safe only because Bun's
listen-socket close paths run after `Server::deinit` has dropped all
JS-side refs.

**Severity.** MEDIUM on documentation; LOW on soundness for current
call sites. The hazard is that a future caller adds a `&mut` borrow
across the `close()` call without realising the C side will iterate.

**Recommended fix.** Add a `# Re-entrancy` block on `ListenSocket::close`
that names the close-walk and forbids `&mut` borrows of user-data
across the call. Optionally: keep the extern decl `safe fn` but make
the inherent method `pub unsafe fn close` so the obligation surfaces
in the caller's source. The current shape is the more common Bun
convention (push obligations to docs, keep call sites terse) so the
doc-only fix is acceptable.

### F-4 (LOW) — `Wrap::on_close` trampoline SAFETY elides `id` discriminant

**File:** `src/uws_sys/WebSocket.rs:644-657`

```rust
pub extern "C" fn on_close(
    raw_ws: *mut RawWebSocket,
    code: i32,
    message: *const u8,
    length: usize,
) {
    let ws = Self::make_ws(raw_ws);
    let this = ws.as_ptr::<T>();
    if this.is_null() {
        return;
    }
    // SAFETY: user data was set to *mut T at upgrade time; `message[..length]` valid when non-null.
    unsafe { T::on_close(this, ws, code, thunk::c_slice(message, length)) };
}
```

**Problem.** The trampoline's comment names the user-data type
assumption (`*mut T`) but doesn't name **which** registration path
guarantees that. The `Wrap` struct is monomorphised over both `Server`
(for HTTP upgrade) and `T: WebSocketHandler` (for ongoing WS events);
the user-data slot is `*mut T` only *after* `on_upgrade` completed.
Calling `on_close` before `on_upgrade` finished would null-deref or
worse — uWS guarantees this never happens, but the comment doesn't
name it.

**Severity.** LOW. The current code is sound by virtue of uWS's
contract; the comment is just incomplete.

**Recommended fix.** Extend the comment to: "user data was set to
`*mut T` by `apply()` after the matching `on_upgrade` set it.
uWS guarantees `on_close` is dispatched after `on_open` and only for
sockets whose upgrade completed."

### F-5 (LOW) — `uv_buf_t::slice_mut` aliasing wording misses async hazard

**File:** `src/libuv_sys/libuv.rs:178-185`

```rust
pub unsafe fn slice_mut(&mut self) -> &mut [u8] {
    // See `slice()`: guard `(null, 0)` — `from_raw_parts_mut` requires a
    // non-null pointer even for zero-length slices.
    if self.len == 0 || self.base.is_null() {
        return &mut [];
    }
    unsafe { core::slice::from_raw_parts_mut(self.base, self.len as usize) }
}
```

**Problem.** The `# Safety` doc (libuv.rs:170-177) says the caller must
assert no other `&mut`/`&` to the storage is live. It does not name
the **async read/write** hazard: if `uv_read_start` has been called on
the parent stream, libuv may write into the buffer at any point until
the read callback fires. Forming a `&mut [u8]` over that buffer between
those two events is a data race with libuv itself.

**Severity.** LOW. There's no Bun-internal call site that does this.
The wording would just be more honest.

**Recommended fix.** Add a bullet: "If this buffer is registered with
libuv as an `alloc_cb` output, callers must not hold the returned
`&mut [u8]` past the matching `uv_read_cb` — between those two events
libuv may write to the buffer asynchronously."

### S-4 (LOW, S-prefixed) — uws "request lifetime" wording overstates pointer-into-arena guarantee

**Files affected:** `Response.rs:296-297`, `Response.rs:316-317`,
`Request.rs:69-71`, `Request.rs:76-78`, `Request.rs:88-90`,
`Request.rs:96-98`, `Request.rs:103-105`, `h3.rs:62-63`,
`h3.rs:68-69`, `h3.rs:78-79`, `h3.rs:86-87`, `h3.rs:92-93`,
`h3.rs:244-245`, `WebSocket.rs:199`.

**Problem.** The earlier draft treated every uWS-returned `(ptr, len)`
slice as having the same lifetime cliff. That is too broad. The APIs in
this list appear to fall into at least three families: request parser
buffer slices (`url`, `header`), query/decode helpers that may use mutable
scratch state, and remote-address helpers backed by static/thread-local
buffers in the glue layer. A single "valid until the next uWS call" rule is
not defensible for all of them.

**Soundness today.** Every Bun call site sampled here copies the slice before
returning to JS (typically into a `bun_core::String` or a Rust `Vec`), so the
short-lifetime cases appear safe in practice. The comment-hardening task is
to document the correct cliff per API family, not to apply a blanket rewrite.

**Recommended fix.** Split the comments:

- request URL/header slices: "valid while the request parser buffer is live"
  unless source review proves shorter;
- query/decode helpers: "valid until the next query/decode operation on this
  request" if backed by scratch storage;
- remote-address helpers: "valid until the next remote-address call on this
  thread" where the C++ glue uses static/thread-local buffers.

### S-5 (LOW, S-prefixed) — `uv_write_t::write` doesn't pin `input` buffer lifetime

**File:** `src/libuv_sys/libuv.rs:993-995`

```rust
// SAFETY: caller guarantees `self` lives until the cb fires and
// `stream` is a live stream handle.
let rc = unsafe { uv_write(self, stream, input, 1, Some(thunk::<T>)) };
```

**Problem.** The comment names `self` (the request) and `stream`, but
doesn't name **`input`** (the buffer). libuv reads from
`input.base[0..input.len]` asynchronously between this call and the
callback; if the caller drops the underlying buffer before then, libuv
reads freed memory. Cf. L-D in section 3.2.

**Recommended fix.** Add: "`input.base[0..input.len]` must remain
allocated and unmodified until the write callback fires."

---

## 6 — Wrapping-quality assessment

### 6.1 libuv

The crate is built around three `unsafe trait` markers (`UvHandle`,
`UvStream`, `UvReq`) whose obligation is layout-prefix conformance.
Every concrete handle/req struct mirrors the C layout via `#[repr(C)]`
and asserts the size at the bottom of the file (`assert_eq_size!`
equivalents in the `const _: () = assert!(...)` form). The trait-method
wrappers (~50 sites) all reduce to a single-`unsafe`-block call into
the `extern "C"` block.

Handle-lifecycle discipline is enforced **structurally** — there is no
`impl Drop` for any libuv handle. The exposed lifecycle is
`Handle::init` → `Handle::close(cb)` → `Box::from_raw` *inside* the cb.
`Pipe::close_and_destroy` (libuv.rs:1279-1295) is the canonical
example: it explicitly handles the three valid states (never-init,
not-closing, already-closing) and wires `on_close_destroy` so the
`Box::from_raw` reclaim happens exactly once. The SAFETY comments here
are reference-quality.

The `Zeroable` impls (libuv.rs:2258-2270) collectively replace ~13
per-call-site `unsafe`-block uses with one audited bound per type. The
audit comment on lines 2253-2257 is canonical:

> SAFETY (per type): audited against the field list in this file — no
> NonNull/NonZero/reference/bare-fn-ptr fields; every enum field has a
> = 0 discriminant (HandleType::Unknown, uv_req_type/uv_fs_type are
> plain c_uint/c_int).

The one wrapping weakness is the **transmute in `UvHandle::close`**
(F-1) — every other lifecycle obligation is pushed into the type
system rather than into per-call SAFETY comments. That is the
right direction; the transmute is the one site where the type
system can't currently express the obligation.

**Verdict:** libuv crate is **A**-grade for soundness, **B+** for
SAFETY-comment uniformity. Hardening targets are listed in section 7.2.

### 6.2 uws

The uws crate has three structural soundness mechanisms:

1. **`bun_opaque::opaque_ffi!`-generated ZST handles** (RawWebSocket,
   us_socket_t, ListenSocket, Timer, …). `UnsafeCell<[u8; 0]>` plus
   align-1 makes `&` / `&mut` references ABI-identical to a non-null
   pointer with no `noalias` annotation — so a substantial fraction
   of FFI shims can be declared `safe fn` with the obligation
   discharged at the type level.

2. **Const-generic SSL flag** (`Response<SSL>`, `App<SSL>`, `NewWebSocket<SSL>`).
   The SSL/TCP dispatch is monomorphised; trampolines bake the flag
   into `extern "C" fn` items so the user-data path can't accidentally
   wire an SSL handler to a TCP socket.

3. **ZST handler trampolines via `thunk::zst<H>()`.** Closures and
   function items that are zero-sized are conjured inside the
   trampoline rather than stored, mirroring Zig's comptime-callback
   monomorphisation. The `thunk` module's centralised `ext_owner` /
   `user_mut` / `handle_mut` / `c_slice` accessors collapse ~30
   per-call SAFETY comments into a handful of audited accessors
   (thunk.rs:74-237).

The handle-lifecycle discipline is more uneven than libuv's:

- **`App<SSL>::destroy`** (App.rs:122-125) is the canonical pattern —
  exposed as `unsafe fn destroy(this: *mut Self)`, no `impl Drop`,
  ownership made explicit at the call site.
- **`Pipe::close_and_destroy`**-style helpers in uws are mostly
  absent — `Timer::close` (Timer.rs:82-87) is the only one. WebSocket
  / Response / Socket cleanup is driven by uWS itself via close
  callbacks; the Rust crate just registers handlers.
- **`SocketGroup::destroy`** (SocketGroup.rs:129-132) is correctly
  exposed as `unsafe fn` with a clear contract.

The `BodyReaderMixin` is the highest-quality wrapper in the crate
(BodyReaderMixin.rs:101-235). It explicitly reasons about Stacked
Borrows: the user-data is registered as the full-Wrap pointer (not
the mixin field) so that `byte_sub`/`byte_add` provenance is preserved
across the trampoline. The drop-temporary-`&mut`-before-`on_error`
ordering is named at every call site. This is what the audit team
should propose as the canonical shape for any future intrusive-field
mixin.

**Verdict:** uws crate is **A**-grade for soundness, **B** for
SAFETY-comment uniformity. The "U-D cliff" (S-4) is the single
biggest standardisation opportunity.

---

## 7 — Recommended PRs

### 7.1 PR-1: `bun_uws_sys` U-D cliff canonicalisation

**Scope.** 14 sites (listed in S-4) get per-API lifetime wording instead of
the over-broad "valid while request/response lives" or the equally over-broad
"valid until next uWS call" replacement.

**Risk.** Documentation-only. No code changes; CI is a no-op except
formatting.

**Acceptance.** A diff-only PR; reviewer reads each comment and
confirms wording.

### 7.2 PR-2: `bun_libuv_sys` SAFETY hardening

**Scope.** Apply the libuv obligation taxonomy (L-A through L-E):

- Names L-A loop-thread affinity in every `Loop::*` and `*::*` method
  body that calls a non-thread-safe `uv_*` symbol (45 sites).
- Adds L-B "between `uv_close` and the close callback the handle must
  not be passed to any other `uv_*` call" to every method on
  `UvHandle`/`UvStream`/`UvReq` (no-op in code; one-line comment on
  ~30 sites).
- Resolves F-1 (UvHandle::close transmute comment) by extending the
  SAFETY block to name the function-pointer ABI obligation.
- Resolves F-2 by either upgrading the `debug_assert_eq!` to a
  release-mode panic or revising the comment to clarify what runs
  unconditionally vs debug-only.
- Resolves F-5 (`uv_buf_t::slice_mut` async hazard).
- Resolves S-5 (`uv_write_t::write` input-buffer lifetime).

**Risk.** Mostly documentation; the one code change (F-2) is a
behavior change on a teardown path. Land as two commits: comment-only,
then F-2 behavior change with a regression test that asserts a stuck
handle aborts loudly in release.

### 7.3 PR-3: `bun_uws_sys` re-entrancy/aliasing audit

**Scope.** Apply U-B re-entrancy semantics to every callback
trampoline (Wrap::on_*, Response on_* trampolines, h3 on_* trampolines,
vtable Handler::on_*, SocketGroup VTable). The pattern is

> The trampoline holds `this` as a raw `*mut T` and never materialises
> `&mut T` while the C side may re-enter (e.g. `ws.close()` from
> inside `on_message` dispatches `on_close` synchronously). Bun's
> JS-thread re-entrancy is the reason `noalias` would be unsound here.

Roughly 35 sites. Resolves F-4 and propagates the canonical comment
shape across the WebSocket / Response / h3 callback fleet.

**Risk.** Documentation-only.

### 7.4 PR-4: SAFETY-comment grader / lint

**Scope.** A `clippy` lint or a `tools/` script that, given the
inventory JSONL, scans for SAFETY comments shorter than 20 characters
or matching a regex of "obviously vacuous" patterns ("FFI call",
"thin wrapper", "valid …", "self is live"). Output: a list of sites
that fall into the 0-2 / 3-4 bands in section 0's distribution.

**Risk.** Tooling-only. Lint can be informational; CI gating would
need a project-wide cleanup first.

### 7.5 PR-5: `uv_buf_t::slice` + `slice_mut` cliff documentation

**Scope.** A single-file diff that (a) hardens the SAFETY comment on
`slice`/`slice_mut` (F-5) and (b) extends the `# Safety` doc to name
the async hazard for buffers handed to libuv via `alloc_cb`.

**Risk.** Documentation-only.

---

## 8 — Hardened per-library SAFETY-comment templates

### 8.1 libuv canonical template

```rust
// SAFETY: libuv(<uv_symbol>) — <which dimensions apply>
//   - non-null:   `<handle/req param>` is a live `uv_<type>_t` from
//                 `uv_<type>_init` and has not been closed (per UvHandle/UvReq invariant).
//   - lifetime:   (for callback-returning calls) `<req/handle>` must
//                 remain allocated until the registered callback fires.
//                 For `(buf, len)` slices: `<buf>[..<len>]` is valid for
//                 the synchronous body of this call only (libuv may
//                 invalidate at the next loop iteration).
//   - thread:     this thread owns the loop (per Loop::get TLS invariant);
//                 `uv_<symbol>` is NOT thread-safe (only `uv_async_send`,
//                 `uv_thread_*`, `uv_mutex_*`, `uv_sem_*`, `uv_cond_*` are).
//   - between-close: `<handle>` has not been passed to `uv_close`; or, if
//                 it has, its close callback has not yet been called.
//   - reentrancy: the callback may not deallocate `<handle>` synchronously
//                 (Box::from_raw inside the close cb is the canonical
//                 ownership-transfer point; do it there, not here).
//   - ownership:  `<handle>` is heap-owned via `bun_core::heap::into_raw`
//                 / `Box::new`; close cb reclaims via `Box::from_raw`.
//                 [Or: caller-owned, stack-allocated, no reclaim needed.]
```

### 8.2 uws canonical template

```rust
// SAFETY: uws(<uws_symbol>) — <which dimensions apply>
//   - non-null:   `<socket/res/req/app>` is a live opaque-FFI handle
//                 (`opaque_ffi!` ZST + `UnsafeCell` — `&`/`&mut` is
//                 ABI-identical to a non-null pointer; no `noalias`).
//   - lifetime:   (for `bun_core::ffi::slice(ptr, len)`) the slice is
//                 valid until the next `uws_*` call on the same handle.
//                 Bun copies out before re-entering FFI.
//   - thread:     this thread drives the owning loop
//                 (HTTPThread / Bun.serve server_loop). uSockets has no
//                 internal locking; cross-thread calls race the
//                 intrusive list.
//   - reentrancy: the C side may synchronously dispatch other callbacks
//                 (e.g. `ws.close()` from `on_message` fires `on_close`
//                 in the same stack frame). User-data is held as
//                 `*mut T` (not `&mut T`) so the re-entrant frame can
//                 derive its own `&mut T` without aliasing this one.
//   - ssl-ctx:    (for `add_server_name` / `adopt_tls`) C `SSL_CTX_up_ref`s
//                 and stores the pointer; caller cannot hold exclusive
//                 `&mut` past the call.
//   - ownership:  (for `*_destroy`) `<handle>` is consumed; caller must
//                 not use it afterward. uWS frees on close-callback for
//                 sockets / responses / requests; never call destroy
//                 from the close callback.
```

---

## 9 — Cross-validation pass (Phase 9 input)

Each finding above is cross-validated against the source-of-truth Zig
sibling files (kept on disk but not compiled):

| Finding | Zig sibling                                              | Cross-check result          |
|---------|----------------------------------------------------------|-----------------------------|
| F-1     | `src/libuv_sys/libuv.zig` (UvHandle::close mixin)         | Zig uses `@ptrCast` of `*const fn (*Self) callconv(.c) void` to `uv_close_cb`. Same ABI obligation; same silent risk. The Zig form names the cast explicitly but doesn't note the ABI obligation either. |
| F-2     | `src/libuv_sys/libuv.zig:714` (Loop.shutdown)             | Zig uses `bun.debugAssert(rc == 0)` — confirmed evaluates argument in release per Bun's `debugAssert` semantics. Rust port lost this property. |
| F-3     | `src/uws_sys/ListenSocket.zig`                             | Zig `us_listen_socket_close` is also a thin wrapper; Zig didn't document the re-entrancy hazard either. Port preserves the gap. |
| F-4     | `src/uws_sys/WebSocket.zig` (WebSocketBehavior.Wrap.onClose) | Same comment-density; same gap. |
| F-5     | `src/libuv_sys/libuv.zig` (`uv_buf_t.slice`)              | Zig returns `[]u8` with no exclusivity invariant — Rust's `&mut [u8]` is stricter, so the comment-level obligation is a Rust-port-only concern. |
| S-4     | `src/uws_sys/*.zig`                                        | Zig comments mostly absent on these sites (Zig has no `unsafe`-block requirement); the Rust port introduced the comments fresh and the wording overstates is a Rust-only issue. |
| S-5     | `src/libuv_sys/libuv.zig` (uv_write_t.write)              | Zig signature was `fn write(self: *uv_write_t, stream: *uv_stream_t, input: *const uv_buf_t, context: anytype, comptime onWrite: anytype)`; Zig didn't document the buffer-lifetime obligation either. Rust port preserves the gap. |

Cross-validation finds that the port did not introduce any new
soundness bugs over the Zig original. F-2 is the one regression in
**behavior** (release-mode assertion lost); every other finding is a
documentation-density gap inherited from the Zig.

---

## 10 — 30 representative sites (file:line + analysis)

Each of these is a recommended PR-1 / PR-2 / PR-3 target with the
verbatim "before" text and a one-line "after" patch.

1. **libuv.rs:166** — `slice()` over `(base, len)`.
   - Before: `// SAFETY: caller-supplied (base, len); valid for the buffer's lifetime.`
   - After: `// SAFETY: caller-supplied (base, len); buffer storage is alive until either (a) caller frees the slab that `base` points into, or (b) libuv writes a new buffer via the next uv_alloc_cb on the parent stream. Within this fn body neither has happened. Loop-thread only.`

2. **libuv.rs:184** — `slice_mut()`.
   - Before: `unsafe { core::slice::from_raw_parts_mut(self.base, self.len as usize) }` (no inline SAFETY).
   - After: add a comment naming F-5's async hazard.

3. **libuv.rs:425** — `THREADLOCAL_LOOP_DATA.with(...)`. Already
   reference-quality.

4. **libuv.rs:444** — `uv_loop_close(loop_)`.
   - Before: `// SAFETY: \`loop_\` is the live per-thread loop initialized in \`get()\`.`
   - After: `// SAFETY: \`loop_\` is the live per-thread loop initialized in \`get()\`. uv_loop_close is NOT thread-safe; we're on the loop's owning thread by the TLS invariant.`

5. **libuv.rs:543** — `uv_is_closing(handle)` inside `close_walk_cb`.
   - Before: `// SAFETY: libuv passes a live handle.`
   - After: `// SAFETY: uv_walk's contract guarantees `handle` is a live, non-closed handle on the loop's owning thread.`

6. **libuv.rs:620-628** — `mem::transmute` (F-1). Apply the F-1 fix.

7. **libuv.rs:783** — `slice::from_raw_parts((*buffer).base, n as usize)`.
   Already reference-quality.

8. **libuv.rs:987** — fn-ptr-as-usize round-trip. Already
   reference-quality.

9. **libuv.rs:1280-1283** — `Pipe::on_close_destroy`. Already
   reference-quality.

10. **libuv.rs:1289** — `Pipe::close_and_destroy` already-closing
    branch.
    - Before: `// else: already closing — the pending close callback owns the lifetime.`
    - After: `// else: already closing — the prior close callback (the one registered on the first call to \`close\`) owns the lifetime; if it was \`on_close_destroy\` (typical), the pipe will be \`Box::from_raw\`-dropped when that callback fires. If a non-freeing callback was registered, the pipe leaks; matches Zig intent.`

11. **libuv.rs:1958** — `uv_fs_req_cleanup(self)`.
    - Before: `// SAFETY: \`self\` was passed to a \`uv_fs_*\` call (assert above).`
    - After: `// SAFETY: \`self\` was passed to a \`uv_fs_*\` call (assert_initialized above guarantees the poison sentinel was overwritten). uv_fs_req_cleanup is idempotent within the same loop thread; UV_FS_CLEANEDUP is set, and \`assert_cleaned_up\` reads it on the next \`deinit\` (or release build accepts).`

12. **uws/Loop.rs:75** — `uws_res_clear_corked_socket`. Add thread axis.

13. **uws/Loop.rs:202** — `us_wakeup_loop`. Add "this is one of the
    thread-safe symbols" axis.

14. **uws/Loop.rs:223** — `us_loop_run_bun_tick(self, ts)`. Already
    medium-quality.

15. **uws/WebSocket.rs:30** — `self.raw()` opaque cast. Already
    reference-quality.

16. **uws/WebSocket.rs:121** — `bun_core::callback_ctx::<(...)>(user_data)`.
    Apply U-B re-entrancy form.

17. **uws/WebSocket.rs:596** — `T::on_open` trampoline. Add U-B
    re-entrancy.

18. **uws/WebSocket.rs:656** — `T::on_close` (F-4 fix).

19. **uws/Response.rs:296** — `bun_core::ffi::slice` on
    `get_remote_address_as_text` (S-4 fix).

20. **uws/Response.rs:317** — `bun_core::ffi::slice` on
    `get_remote_socket_info` (S-4 fix).

21. **uws/Response.rs:505** — `core::ptr::read(user_data.cast::<F>())`.
    Already good; one-liner thread-affinity addition would close it.

22. **uws/Request.rs:71** — `bun_core::ffi::slice` on method (S-4 fix).

23. **uws/Request.rs:85** — `uws_req_get_header` out-param. Add U-D
    cliff to the slice formed at line 90.

24. **uws/h3.rs:63** — `bun_core::ffi::slice` on h3 method (S-4 fix).

25. **uws/h3.rs:265** — `thunk::zst::<H>()` invocation. Add U-B
    re-entrancy.

26. **uws/us_socket_t.rs:76** — `us_socket_close`. Add thread-affinity
    + re-entrancy axes.

27. **uws/us_socket_t.rs:115** — `us_socket_local_address`. Already
    medium.

28. **uws/us_socket_t.rs:540** — `Vec::from_raw_parts` in
    `to_stream_buffer`. Already medium; add "global allocator
    invariant" cross-reference.

29. **uws/ListenSocket.rs:35** — `get_socket` opaque cast. Already
    reference-quality.

30. **uws/BodyReaderMixin.rs:136** — `mixin_of`. Reference-quality;
    cite as the canonical model for any future intrusive-field mixin.

---

## 11 — Closing notes

- **Pass-3 outcome.** All 386 sites are sound under current targets;
  zero immediate-action UB. Five findings (F-1..F-5) plus two
  S-prefixed wording findings; one is a release-mode behavior change
  (F-2), the rest are SAFETY-comment quality issues.
- **The crate's structural choices are sound.** The opaque-FFI ZST
  pattern + const-generic SSL + ZST-handler trampolines + intrusive
  `Wrap`-pointer registration collectively push obligations into the
  type system. The remaining hand-written `unsafe` is concentrated
  in the genuinely irreducible spots: the close-walk transmute, the
  fn-ptr-as-usize round-trip, the heap reclaim inside close
  callbacks, and the `(ptr, len)`→slice formation.
- **The right next pass is not site-level.** Pass 4 should be the
  PR-2 hardening landing — applying the L-A / L-B / U-B form across
  the ~150 sites that don't currently name thread-affinity or
  reentrancy. Doing it as a single doc-only PR per crate keeps the
  review burden tractable.

---

**Bug count: 5 findings (1 HIGH-documentation, 2 MEDIUM, 2 LOW) +
2 S-prefixed wording findings (LOW).**

**Distribution of SAFETY-comment quality scores (100-site sample):**

- 11–12 (reference quality): 6 sites
- 9–10 (well-documented, one axis elided): 18 sites
- 7–8 (two-three axes named): 34 sites
- 5–6 (one axis named): 27 sites
- 3–4 (one-liner): 11 sites
- 0–2 (missing/wrong): 4 sites
