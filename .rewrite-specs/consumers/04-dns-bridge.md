# Consumer-requirements inventory: `Bun__addrinfo_*` DNS bridge and the uSockets ConnectingSocket

All paths absolute; the repo root is `/root/bun/.claude/worktrees/bridge-cse_01UFHwYwi313BkrKbqkCyJeU` (abbreviated `$R` below).

---

## 1. The contract: who resolves a hostname on connect

### 1.1 Resolver identity — NOT c-ares on this path

The socket connect path does **not** use c-ares. c-ares (`cares_jsc.rs`, `bun_cares_sys`) is only the backend for the JS `dns`/`dns.Resolver` module ($R/src/runtime/dns_jsc/dns.rs:35-38, :567-578). The uSockets connect path uses a **process-wide DNS cache** (`GLOBAL_CACHE`, $R/src/runtime/dns_jsc/dns.rs:2468-2474) fed by:

- **macOS**: async libinfo (`lookup_libinfo`, gated by `BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO`), dns.rs:3060-3082; a machport + FilePoll on the JS loop (dns.rs:122-305). Fallback to work pool if libinfo unavailable (dns.rs:3081 "if we were not able to use libinfo, we fall back to the work pool").
- **Everything else (and macOS fallback)**: blocking `getaddrinfo(3)` on the shared work pool: `WorkPool::go(SendPtr(req), work_pool_callback)` at dns.rs:3092-3095; `work_pool_callback` (dns.rs:2737+) calls libc/ws2_32 `getaddrinfo` with `AF_UNSPEC`, `SOCK_STREAM`, `AI_ADDRCONFIG` hints (dns.rs:2481-2523, `default_hints`/`get_hints`, incl. the Node/Chromium ADDRCONFIG rationale links and `BUN_FEATURE_FLAG_DISABLE_IPV4/IPV6/ADDRCONFIG` overrides).

The layering note in $R/src/dns/lib.rs:478-482:

> "The process-wide DNS cache lives in `bun_runtime` (it owns libinfo/libuv worker threads + JSC stat counters). Lower-tier crates (`bun_http`, `bun_install`) reach it via the link-time `Bun__addrinfo_*` family — same mechanism usockets C uses — rather than a `bun_runtime` crate dep, which would cycle."

### 1.2 The connect entry point (C side)

`us_socket_group_connect` — $R/packages/bun-usockets/src/context.c:567-634 (nb: the modern name is `us_socket_group_connect`, not `us_socket_context_connect`; Rust wrapper at $R/src/uws_sys/SocketGroup.rs:230, extern at :349):

1. `try_parse_ip(host, ...)` (context.c:582-584): IP literal → `*has_dns_resolved = 1`, direct `us_socket_group_connect_resolved_dns`, **no DNS bridge at all**.
2. `Bun__addrinfo_get(loop, host, port, &ai_req)` (context.c:587). Return `0` = **cache hit** (result may still be an error or in-flight — see below), `1` = miss/in-flight.
3. Cache hit with no error and **exactly one address** (`entries->info.ai_next == NULL`, context.c:597-604): synchronous connect, `Bun__addrinfo_freeRequest(ai_req, s == NULL)`, returns a `us_socket_t*` with `*has_dns_resolved = 1`.
4. Otherwise (miss, in-flight hit, cached error, or multi-address hit): allocates a `us_connecting_socket_t` (context.c:611-624), sets `pending_resolve_callback = 1`, stores `c->addrinfo_req = ai_req`, bumps loop keep-alive (`num_polls++` / `active_handles++`, context.c:626-630), then registers the callback via `Bun__addrinfo_set(ai_req, c)` (context.c:631). Comment at context.c:589-594:

> "A cached resolver failure falls through to the connecting-socket path below (same as a multi-address result) so it is reported through the same connect-error callback, tagged `error_is_dns`, as an uncached one. Bun__addrinfo_set on an already-resolved request defers to the loop's dns_ready_head, never re-enters."

### 1.3 The five `Bun__addrinfo_*` functions

C declarations: $R/packages/bun-usockets/src/internal/internal.h:140-144. Rust definitions (FFI exports, `#[unsafe(no_mangle)]`): $R/src/runtime/dns_jsc/dns.rs:3263-3311.

| Export | Signature | Semantics | Thread |
|---|---|---|---|
| `Bun__addrinfo_get` (dns.rs:3279-3287 → `us_getaddrinfo` :3174-3194 → `getaddrinfo` :2993-3096) | `(loop: *mut Loop, host: *const c_char, port: u16, out: *mut *mut Request) -> c_int` | Locks `GLOBAL_CACHE`. Hit (`RequestKeyOwned.matches`: wyhash of **hostname only**, port excluded from hash, dns.rs:2163-2181, :2379-2392): `refcount += 1`, returns 0 if `result.is_some()` (completed hit), else returns 1 for an **in-flight** hit (refcount still taken). Miss: allocates `Request` with `refcount = 2` (one for the resolver, one for the caller — `(!preload) as u32 + 1`, dns.rs:3044), pushes into the 256-slot cache (`try_push`, eviction of refcount==0 entries, dns.rs:2715-2735), kicks off libinfo or work pool, returns 1. Always writes the `Request*` to `out`. TTL = `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS`, default 30s (dns.rs:2150-2157); expiry checked in `GlobalCache::get` (dns.rs:2650-2676). | Caller's (JS/loop) thread |
| `Bun__addrinfo_set` (dns.rs:3265-3270 → `us_getaddrinfo_set` :3196-3208) | `(request: *mut Request, socket: *mut ConnectingSocket)` | Under the cache lock: if `result.is_some()`, calls `DNSRequestOwner::Socket(socket).notify(request)` — which is `us_internal_dns_callback` (the **non-wakeup** variant, loop.c:324) since we are on the loop thread; else pushes `Socket(socket)` onto `request.notify`. | Loop thread |
| `Bun__addrinfo_cancel` (dns.rs:3272-3277 → `us_getaddrinfo_cancel` :3210-3235) | `(request: *mut Request, socket: *mut ConnectingSocket) -> c_int` | Under the cache lock: returns 0 if `result.is_some()` ("the callback has fired or is about to fire"); otherwise swap-removes the matching `Socket(socket)` from `notify` and returns 1 (= successfully cancelled; the callback will never fire). | Loop thread |
| `Bun__addrinfo_freeRequest` (dns.rs:3288-3290 → `freeaddrinfo` :3237-3256) | `(req: *mut Request, err: c_int)` | Under the cache lock: `err != 0` marks the entry `valid = false` (poisons the cache entry); decrements `refcount`; deinits + removes from cache only when `refcount == 0` **and** (cache ≥80% full or invalid) — i.e. entries linger for reuse. | Any thread that owns a ref (in practice loop thread; `Prefetch` owner calls it from the resolver thread via `notify_threadsafe`, dns.rs:2550) |
| `Bun__addrinfo_getRequestResult` (dns.rs:3292-3296 → `get_request_result` :3258-3261) | `(req: *mut Request) -> *mut RequestResult` | Returns `&mut req.result` (unwraps!). "SAFETY: caller (usockets) only invokes this after notify, when result is set" (dns.rs:3258). Layout contract at dns.rs:2230-2240: "Crosses FFI to usockets via `Bun__addrinfo_getRequestResult` — layout MUST stay `{ info: ?*ResultEntry, err: c_int }` (8-byte thin ptr)." and "Ownership of the ResultEntry buffer is `Request.result_buf` — this struct is a borrowed C-ABI view (`info` points at `result_buf[0]`). Do NOT free via this field." | Loop thread, post-notify |

Sixth export, QUIC-only: `Bun__addrinfo_registerQuic(request, pc: *mut bun_http::H3::PendingConnect)` (dns.rs:3297-3311 → `register_quic` :2580-2605), reached from lower-tier crates via `bun_dns::internal::register_quic` ($R/src/dns/lib.rs:485-533). Doc comment dns.rs:2580-2588:

> "us_getaddrinfo_set but for the QUIC client's connect path, which has no us_connecting_socket_t to hang the callback on. The .quic notify [...] re-acquires global_cache.lock — so drop it before notifying." / "`pc` must stay valid until its `on_dns_resolved[_threadsafe]` fires."

### 1.4 Completion / threading of the callback

`after_result` (dns.rs:2695-2733) runs **on the resolver thread** (work-pool worker, libinfo dispatch thread, or JS thread for the macOS FilePoll path):

- Packs getaddrinfo results into a `Box<[ResultEntry]>` via `process_results` (dns.rs:2600-2694), which **interleaves IPv6/IPv4** ("sort (interleave ipv4 and ipv6)", dns.rs:2657-2676) and re-links `ai_next` into the boxed array.
- Under the lock: parks the box on `Request.result_buf`, sets `result`, `mem::take`s the `notify` list, `refcount -= 1`; then **drops the lock** and calls `query.notify_threadsafe(req)` per owner (dns.rs:2729-2731).
- `DNSRequestOwner::{Socket, Prefetch, Quic}` (dns.rs:2531-2535). `Socket` → `us_internal_dns_callback_threadsafe(socket, req)` (dns.rs:2547-2549); `Prefetch` → drops its ref immediately (`freeaddrinfo(req, 0)`); `Quic` → `PendingConnect::on_dns_resolved_threadsafe`.

C side of the handoff ($R/packages/bun-usockets/src/loop.c):

- `us_internal_dns_callback` (loop.c:324-331): takes `loop->data.mutex`, pushes `c` onto `loop->data.dns_ready_head`. "Does not wake up the loop." (loop.c:322). Note loop.c:325: `(void)addrinfo_req; /* already stored on c by us_socket_group_connect */`.
- `us_internal_dns_callback_threadsafe` (loop.c:336-340): same + `us_wakeup_loop`. "Can be caleld from any thread." (loop.c:335).
- Drained at the **top of every loop iteration**: `us_internal_loop_pre` → `us_internal_handle_dns_results` (loop.c:350-358, :398-400) → `us_internal_socket_after_resolve(c)` per socket, on the loop thread.

**So: resolution happens off-thread; the ConnectingSocket only ever observes results on its own loop thread via the dns_ready_head queue.**

### 1.5 ConnectingSocket state machine (happy-eyeballs-ish)

`struct us_connecting_socket_t` — $R/packages/bun-usockets/src/internal/internal.h:311-340. Key fields: `addrinfo_req` (first member), `group`, `loop` (captured at create — see UAF quote in §3), `ssl_ctx` (up-ref'd), `next` (dns_ready/closed list), `connecting_head` (list of in-flight child `us_socket_t` attempts), flags `closed/shutdown/shutdown_read/pending_resolve_callback/error_is_dns`, `timeout/long_timeout`, `port`, `error`, `addrinfo_head` (cursor into the result chain), `next_pending/prev_pending` (group's connecting list).

- `us_internal_socket_after_resolve` (context.c:702-745): clears `pending_resolve_callback`; if `c->closed` → free request + `us_connecting_socket_free` and return (late-cancel path); on DNS error → `c->error = result->error; c->error_is_dns = 1; us_connecting_socket_close(c)` (comment context.c:725-730 quoted in §4); else sets `c->addrinfo_head = &result->entries->info` and calls `start_connections(c, CONCURRENT_CONNECTIONS)` — **`#define CONCURRENT_CONNECTIONS 4`** (context.c:27). Because `process_results` interleaved AAAA/A, the first 4 attempts alternate families — a simultaneous-start happy-eyeballs variant (no staggered delay).
- `start_connections` (context.c:665-700): walks `addrinfo_head`, creates non-blocking connect sockets (`POLL_TYPE_SEMI_SOCKET`, writable poll), copies `c->timeout/long_timeout` and the ext area into each child (`memcpy((void*)(s+1), (void*)(c+1), c->socket_ext_size)`, context.c:692), links children via `s->connect_next` / `s->connect_state = c`.
- `us_internal_socket_after_open` (context.c:747-818) — per-attempt outcome:
  - **failure**: unlink the failed child, close it; when ≤1 attempt remains in flight, top up via `start_connections(c, head==NULL ? CONCURRENT_CONNECTIONS : 1)`; if nothing could be opened and none in flight → `c->error = ECONNREFUSED; us_connecting_socket_close(c)` (context.c:775-784, comment quoted in §4).
  - **success**: promote winner to `POLL_TYPE_SOCKET`, **close every losing sibling**, attach TLS only now ("Attach TLS now that we know which candidate won.", context.c:803-805), `Bun__addrinfo_freeRequest(c->addrinfo_req, 0)`, `us_connecting_socket_free(c)`, `s->connect_state = NULL`, dispatch `on_open` (context.c:791-817).

Rust view: $R/src/uws_sys/ConnectingSocket.rs:5-9:

> "`us_connecting_socket_t` — a connect in flight (DNS / non-blocking `connect()` / happy-eyeballs). No I/O is possible yet; on success the loop promotes it to a `us_socket_t` and fires `onOpen`, on failure `onConnectingError`."

---

## 2. Cancellation & timeouts

### 2.1 Abort mid-resolve — `us_connecting_socket_close` (socket.c:193-256)

- Idempotent (`if (c->closed) return; c->closed = 1;`).
- Closes all child attempt sockets onto the loop's closed list (socket.c:196-208).
- Default error fabrication: `if (!c->error) c->error = ECONNABORTED;` — "if we have no error, we have to set that we were aborted aka we called close" (socket.c:209-212).
- **If `pending_resolve_callback`** (DNS not yet drained), two races (socket.c:214-244):
  - `Bun__addrinfo_cancel(c->addrinfo_req, c)` returns 1 → callback will never fire: balance keep-alive (`num_polls--`), clear `pending_resolve_callback`, `Bun__addrinfo_freeRequest(req, 0)`, dispatch `on_connecting_error`, free `c`. Comment socket.c:214-218: "The DNS callback has not been drained. Try to remove c from the request's notify list so it never fires. Returns 0 if the result is already set (the callback has fired or is about to), in which case after_resolve will see c->closed and finish teardown."
  - cancel returns 0 → callback already queued (possibly cross-thread): dispatch error now, `us_internal_connecting_socket_detach` only; `c` stays allocated until `after_resolve` runs and sees `c->closed`. Comment socket.c:229-234 quoted in §3.
- **If not pending**: `Bun__addrinfo_freeRequest(c->addrinfo_req, c->error == ECONNREFUSED || c->error_is_dns)` (socket.c:246-251) — comment: "Invalidate the cache entry for a refused connect (addresses may be stale) and for a resolver failure (never cache a negative result)."

### 2.2 Group teardown — `us_socket_group_close_all_ex` (context.c:82-110)

Iterates `group->head_connecting_sockets` calling `us_connecting_socket_close` on each (context.c:90-95); in-flight SEMI_SOCKET children get `us_dispatch_connect_error(s, ECONNABORTED)` first (context.c:98-110, comment about the Zig wrapper on_close-without-on_open UAF). `after_resolve` then handles the late queue entry — context.c:703-706:

> "close_all() may have run between the DNS thread queuing this callback and us reaching it; c->group is NULL'd at close so it can't be touched. The keep-alive (num_polls/active_handles) was already balanced by the close path's Bun__addrinfo_cancel branch."

### 2.3 Timeouts during connect

- `us_connecting_socket_timeout` / `_long_timeout` (socket.c:112-134): store tick-relative bytes on `c` (`(seconds+3)>>2` in 4s ticks mod 240; 255 = disabled).
- **The timer sweep does not walk the connecting list**: `us_internal_timer_sweep` (loop.c:227-290) only iterates `group->head_sockets`. `c->timeout`/`c->long_timeout` are **copied onto every child attempt socket** at `start_connections` (context.c:688-689: `s->timeout = c->timeout; s->long_timeout = c->long_timeout;`), so timeout during connect fires on a child as `on_timeout`, and the embedder is expected to close (which routes through `us_connecting_socket_close` via `connect_state`). During the *DNS wait* itself there is no fd and no sweep coverage — a timeout set before resolution takes effect only once sockets exist. (Requirement for the rewrite: decide whether to honor timeouts during resolve; today's C effectively does not.)
- Loop keep-alive during resolve: `num_polls++`/`active_handles++` at connect (context.c:626-630), decremented in exactly one of `after_resolve` (context.c:710-715), the cancel branch (socket.c:220-224), or the cannot-cancel branch (socket.c:235-239).
- Freeing discipline: `us_connecting_socket_free` (socket.c:184-190) never frees inline — "we can't just free c immediately, as it may be enqueued in the dns_ready_head list; instead, we move it to a close list and free it after the iteration" — actual `us_free` in `us_internal_free_closed_sockets` (loop.c:377-382).

### 2.4 QUIC cancellation

`us_quic_pending_connect_cancel` (quic.c:1387-1391): `Bun__addrinfo_freeRequest(pc->ai_req, 1)` + frees `pc`. Note QUIC has **no cancel-from-notify-list** analogue — the contract is instead "`pc` must stay valid until its `on_dns_resolved[_threadsafe]` fires" (dns.rs:2587); the Rust `PendingConnect` is "Consumed by exactly one of `resolved()` or `cancel()`" ($R/src/uws_sys/quic/PendingConnect.rs:1-4).

---

## 3. Pointer storage & UAF discipline (quoted)

**What the pending request stores**: `Request.notify: Vec<DNSRequestOwner>` (dns.rs:2281) holding **raw pointers**: `Socket(*mut ConnectingSocket)`, `Prefetch(*mut Loop)`, `Quic(*mut PendingConnect)` (dns.rs:2531-2535). The C side symmetrically stores the raw `Request*` as `c->addrinfo_req` (internal.h:312 — first, `alignas`'d member) and `pc->ai_req` (quic.c:1358). The `Request` itself is a heap allocation owned by the global cache with a manual `refcount` (dns.rs:2283-2286: "number of sockets that have a reference to result or are waiting for the result; while this is non-zero, this entry cannot be freed").

Quoted UAF-discipline comments:

- dns.rs:3199-3201 (and 3214-3221, 3237-3242, repeated per function): "SAFETY: `request` is a live cache entry; `result`/`notify` are only touched under `global_cache().lock()`, which is held here."
- dns.rs:3215-3217 (cancel): "afterResult sets result and moves the notify list out under this same lock, so once result is non-null the socket is no longer cancellable (the callback has fired or is about to fire on the worker thread)."
- dns.rs:2366-2368: "SAFETY: every `*mut Request` stored here is a heap allocation transferred between threads only while `GLOBAL_CACHE` is locked; no thread-affine data hangs off it."
- internal.h:313-316 (the `loop` field): "Captured at create — stays valid after `group` is detached so the late after_resolve / dns_callback / free path never derefs into freed owner storage to find the loop."
- socket.c:170-173 (`us_internal_connecting_socket_detach`): "Detach c from its group + drop the borrowed SSL_CTX ref, but leave c allocated. After this, c->group is NULL and the embedding owner may safely deinit; the only remaining link is into a loop-owned list."
- socket.c:229-234 (cannot-cancel branch): "Can't cancel — the resolve callback is already queued. Detach from the group NOW so the owner can deinit; after_resolve will see c->closed and only push c to the loop's closed list without touching the (possibly freed) group. Balance the keep-alive here for the same reason."
- socket.c:185-186: "we can't just free c immediately, as it may be enqueued in the dns_ready_head list — instead, we move it to a close list and free it after the iteration".
- context.c:703-706 (already quoted in §2.2) — the close_all vs queued-callback race.
- dns.rs:2233-2240 — the borrowed-view / do-not-free contract on `RequestResult`.
- dns.rs:2712-2714: "Park the owning Box on `Request.result_buf`; `RequestResult.info` borrows its first element as a thin pointer for the C side."
- dns.rs:2345-2351 (`Request::deinit`): "`this` is reclaimed via `heap::take` (Box::from_raw); forming `&mut *this` at entry would invalidate the pointer's allocation provenance, so the param must stay `*mut`." plus `debug_assert!((*this).notify.is_empty())`.
- dns.rs:85-87 (`SendPtr`): "Send-wrapper for raw pointers handed to the threaded work pool. The DNS [request is guarded] so crossing threads is sound — Rust just can't see that through `*mut T`."

Ownership invariant summary: while `pending_resolve_callback == 1`, exactly one of {request's notify list, loop's `dns_ready_head`} holds the raw `ConnectingSocket*`; `closed` is the tombstone that lets a late `after_resolve` finish teardown without touching group memory.

---

## 4. Migration notes — what the new crate's `Connecting` type must provide

1. **Pluggable resolver hook, exact shape**: the five-function interface at internal.h:140-144 is the seam. A Rust `Connecting` needs a trait equivalent to:
   - `get(loop, host, port) -> (RequestHandle, CacheState{HitCompleted|InFlightOrMiss})` — must take a refcount so the entry outlives the connect (dns.rs:3016).
   - `set(request, subscriber)` — must handle the *already-resolved* case by **deferring to the loop queue, never re-entering** the caller (context.c:592-594 quote in §1.2); notify from the loop thread uses the non-wakeup enqueue, cross-thread uses enqueue+wakeup (loop.c:324-340).
   - `cancel(request, subscriber) -> bool` — linearized against result publication under one lock; `false` means "callback already committed, expect it, use your `closed` tombstone" (socket.c:214-218).
   - `free(request, invalidate: bool)` — refcount drop with **cache poisoning semantics**: invalidate on ECONNREFUSED-after-connect and on resolver failure ("addresses may be stale" / "never cache a negative result", socket.c:246-249), plus the "every resolved address failed" path (context.c:775-784: "…never invalidates the DNS cache entry for the dead host").
   - `result(request) -> &{entries: addrinfo chain, error: i32}` — only legal post-notify; result buffer is owned by the request, borrowed by the consumer until `free` (dns.rs:2233-2240). Keep the `#[repr(C)]` `{Option<NonNull<ResultEntry>>, c_int}` layout if C consumers remain (dns.rs:2230-2232).
2. **Address-order policy belongs to the resolver**: A/AAAA interleaving is done at result-packing time (dns.rs:2657-2676); `Connecting` just walks `ai_next` and launches up to `CONCURRENT_CONNECTIONS = 4` simultaneous attempts (context.c:27), topping up one at a time as attempts fail and only bursting again when all are dead (context.c:777).
3. **Per-attempt error reporting + `dns_error()`**: keep the **two error namespaces** split. `error` is errno for connect failures, or a raw `getaddrinfo(3)` code when `error_is_dns` is set (internal.h:325-329: "The two constant sets are different namespaces that overlap numerically, so consumers of `error` must check this bit first."). Public accessors: `us_connecting_socket_get_error` and `us_connecting_socket_get_dns_error` (`c->error_is_dns ? c->error : 0`, socket.c:640-642); Rust surface `ConnectingSocket::get_error`/`get_dns_error` ($R/src/uws_sys/ConnectingSocket.rs:47-57). Error precedence rules to preserve: DNS failure wins (context.c:725-730 — "Preserve the getaddrinfo failure so the connect-error callback can report the resolver error (ENOTFOUND, ...) instead of the fabricated ECONNABORTED"); all-attempts-failed → `ECONNREFUSED` not `ECONNABORTED` (context.c:740-744, 775-780 — "a real connect failure must not be reported as a caller abort"); plain abort → `ECONNABORTED` default (socket.c:209-212).
4. **Cancellation semantics**: idempotent `close()`; try-cancel-else-tombstone with the three-way keep-alive balance (§2.1/§2.3); detach-but-don't-free so the embedder may deinit its ext storage immediately; deferred free through a loop-owned closed list because the pointer may still sit in the resolve-ready queue (socket.c:184-190, loop.c:377-382). Rust's `Connecting` should encode "closed but callback pending" as a real state, not a flag soup.
5. **Loop integration**: a mutex-guarded MPSC ready-list drained at loop-pre (`us_internal_handle_dns_results`, loop.c:350-358, 398-400) plus loop wakeup; loop keep-alive (`num_polls`/`active_handles`) held for exactly the resolve window.
6. **Timeouts**: timeout values are staged on `Connecting` and inherited by attempt sockets (context.c:688-689); the sweep never visits `Connecting` itself — a rewrite should either replicate this (document that pre-resolve timeouts are inert) or fix it deliberately.
7. **Ext-data contract**: `socket_ext_size` trailing bytes on `Connecting` are `memcpy`'d into every attempt socket (context.c:692) — the embedder's per-socket state must be bitwise-copyable pre-open.
8. **TLS deferral**: `ssl_ctx` is up-ref'd at connect (context.c:617-618), attached only to the winning attempt (context.c:803-805), unref'd at detach (socket.c:177-180).
9. **Second consumer (QUIC)**: `Connecting` isn't the only subscriber shape — `PendingConnect` (quic.c:1335-1391, $R/src/uws_sys/quic/PendingConnect.rs, `Bun__addrinfo_registerQuic` dns.rs:3297-3311, $R/src/dns/lib.rs:485-533, $R/src/uws_sys/quic/Context.rs:74) registers with no cancel-from-list and a strict "consumed by exactly one of resolved()/cancel()" lifecycle. The resolver hook must therefore accept heterogeneous subscribers (the `DNSRequestOwner` enum, dns.rs:2531-2535), including a fire-and-forget `Prefetch` variant that just drops its refcount on completion (dns.rs:2550, `__bun_dns_prefetch` dns.rs:3163-3172).
10. **Sync fast paths to keep**: IP-literal bypass (context.c:582-584) and single-address completed-cache-hit synchronous connect with `has_dns_resolved` out-flag (context.c:587-604) — callers (SocketGroup.rs:230) branch on whether they got a `us_socket_t` or a `us_connecting_socket_t` back from the same `void*` return.
