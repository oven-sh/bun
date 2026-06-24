# Section Q: http-network-stack (12 crates)

## Purpose

Section Q is Bun's outbound + inbound HTTP / WebSocket / HTTP-3 stack plus the
network-layer FFI substrate it rides on. It comprises (1) the HTTP/1.1 +
HTTP/2 + HTTP/3 client (`bun_http`) with its ProxyTunnel, ssl_config,
HTTPThread loop, and chunked-decoder pipeline; (2) JSC-facing
`bun_http_jsc` — fetch enums, headers wrapper, and the WebSocket-upgrade
client + WebSocketProxyTunnel + WebSocketDeflate machinery; (3) the wire-format
and MIME catalogue (`bun_http_types`) including h2 packed-payload structs;
(4) the picohttpparser wrapper (`bun_picohttp` + `bun_picohttp_sys`) that
parses every inbound request line and response status line; (5) the
uWebSockets binding layer (`bun_uws` + `bun_uws_sys`) — the ~370-site
trampoline graph that translates every libus_socket / uws_ws / uws_app /
us_listen / us_loop event into a Rust call (sockets, TLS handshake, HTTP
methods, WebSocketBehavior, h3); (6) the closed-set cross-crate dispatch
proc-macro (`bun_dispatch`) used by Section Q for the headers + DNS + h3
glue; (7) DNS resolution (`bun_dns` + `bun_cares_sys`) — POSIX getaddrinfo +
the c-ares async DNS channel with its sock-state callback; (8) WHATWG URL
parsing (`bun_url` + `bun_url_jsc`) that rides on WebKit's URL parser. This
is the largest single FFI-callback density in the codebase outside Section F
and shares the same `*mut Self` aliasing discipline.

## Per-crate unsafe-surface tally (vs prior subtotals)

| crate              | normalised sites | prior | delta  |
| ------------------ | ---------------: | ----: | -----: |
| `bun_http`         |              181 |   170 |    +11 |
| `bun_http_jsc`     |              321 |   287 |    +34 |
| `bun_http_types`   |               10 |     8 |     +2 |
| `bun_picohttp`     |               22 |    21 |     +1 |
| `bun_picohttp_sys` |                2 |     0 |     +2 |
| `bun_uws`          |               41 |    35 |     +6 |
| `bun_uws_sys`      |              371 |   253 |   +118 |
| `bun_dispatch`     |               11 |     2 |     +9 (proc-macro emission only — see notes) |
| `bun_dns`          |               12 |    10 |     +2 |
| `bun_cares_sys`    |              108 |    75 |    +33 |
| `bun_url`          |               12 |     6 |     +6 |
| `bun_url_jsc`      |                0 |     0 |      0 |
| **Section Q**      |         **1091** |   867 |   +224 |

Normalised-site definition: lines containing `unsafe { … }` block opener
**OR** `unsafe (pub) (extern "C") fn` **OR** `unsafe impl` **OR**
`unsafe trait` **OR** `unsafe extern "…"` **OR** `#[unsafe(…)]` attribute.
Excludes prose `// SAFETY:` mentions and `unsafe` substrings inside
identifiers (`unused_unsafe`, `clippy::macro_metavars_in_unsafe`).

The headline `+224` reflects ongoing Zig→Rust ports: `bun_uws_sys` absorbed
the InternalLoopData / Timer / h3 / quic-stream FFI binding work (`+118`),
`bun_cares_sys` absorbed Hosts-file callbacks and resolve-handler trait
machinery (`+33`), `bun_http_jsc` grew a full WebSocket-upgrade close/cancel
path (`+34`), and `bun_http` picked up the ProxyTunnel detach-and-deref
helper plus h3-client PendingConnect cross-thread wakeup (`+11`).

## EXP-011 anchor status — CONFIRMED_UB model

**picohttp NUL-write site:** `src/picohttp/lib.rs:383`

Current code (verified on this checkout):

```rust
        // Leave a sentinel value, for JavaScriptCore support.
        if rc > -1 {
            // SAFETY: path_ptr points into buf; the byte after the path is the
            // space before "HTTP/1.x" which picohttpparser has already consumed,
            // so writing a NUL there is in-bounds. Zig casts away const here too.
            unsafe { path_ptr.cast_mut().add(path_len).write(0) };
        }
```

Provenance trail: `path_ptr` is an out-param of `c::phr_parse_request(buf:
*const u8, …, path: *mut *const c_char, …)`. picohttpparser writes back a
pointer that was derived inside C from the read-only `*const u8` argument
`buf.as_ptr()`. `buf: &'a [u8]` is the Rust caller's read-only slice, so
`path_ptr` carries `SharedReadOnly` (or pointer-to-shared) provenance — the
same provenance class that the prior audit's PASS3 H9 finding identified.

`cast_mut().add(path_len).write(0)` then performs a write through that
pointer. The SAFETY comment justifies *bounds* (the NUL byte is the
already-consumed space before `HTTP/1.x`) but explicitly does **not**
justify *provenance* — the comment frankly admits "Zig casts away const here
too", which is the U2-style provenance smell the audit flags.

**Verdict: CONFIRMED_UB model** — the syntactic shape, the SAFETY-comment
justification, and the call shape are all unchanged from the H9 finding
documented in `.unsafe-audit/PASS3_FINDINGS_INDEX.md`. The Phase-5
Tree-Borrows witness in `experiments/EXP-011` models the exact final wrapper
step (`buf.as_ptr()` → `path_ptr.cast_mut().add(path_len).write(0)`) and fails
with `write access through <232> at alloc108[0x6] is forbidden`; the tag was
created by `buf.as_ptr()` in state `Frozen`. This is not a full integrated
picohttpparser run, but it directly validates the wrapper's provenance claim.
No remediation candidate has been added in the picohttp wrapper since the prior
audit.

## U2 dealloc-through-shared-provenance cluster (HTTP portion of 8 sites)

The prior audit identified 8 sites of `Box::from_raw` / `heap::destroy` /
`mi_free` through a `*mut T` derived from `core::ptr::from_ref(slice).cast_mut()`
or slice `.as_ptr().cast_mut()`. Of those 8, **2 are in Section Q HTTP
scope** (the remainder split across `runtime/node/node_fs.rs`,
`bun_alloc/lib.rs`, `bun_core/string`, `jsc/lib.rs`, `jsc/ZigString.rs ×2`):

| file:line | site | shared-prov source | dealloc call | bucket |
|---|---|---|---|---|
| `src/http/AsyncHTTP.rs:117` | `free_owned_href` | `href: &'static [u8]` parameter | `bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut())` | 2 (Provenance) + 1 (Aliasing) |
| `src/http/lib.rs:176` | `Drop for HTTPResponseMetadata` | `list: &[Header]` from `self.response.headers.list` field | `bun_core::heap::destroy(core::ptr::from_ref(list).cast_mut())` | 2 (Provenance) + 1 (Aliasing) |

**Both unchanged from prior audit.** The SAFETY comments still document
"the fat `*mut [T]` is obtained directly from the borrowed slice — no need
to round-trip through `(ptr, len)` + `from_raw_parts`", which captures the
laziness/perf rationale but not the SharedReadOnly provenance class.

The companion `src/http/lib.rs:4136-4141` site (chunked-decoder
in-place mutation) is a *positive* example: it explicitly enumerates the
hazard ("`incoming_data.as_ptr() as *mut u8` would carry SharedReadOnly
provenance (it came from a `&[u8]`) and writing through it is UB. Derive
the mutable slice from the owning Vec instead so the write has Unique
provenance.") and routes the write through `self.state.response_message_buffer.list.as_mut_ptr()`
to recover Unique provenance. Best-in-section unsafe-block discipline.

A third candidate inside Section Q is the ProxyTunnel deref-from-`&mut self`
at `src/http/ProxyTunnel.rs:791` — it acknowledges the provenance question
("coercing it back to `*mut` preserves write provenance for the dealloc
path") but the dealloc still rides through a pointer derived from
`&mut self`, which under Stacked/Tree Borrows carries an argument
protector that makes deallocating the referent UB. This site was *not* in
the original PASS2 U2 enumeration; flag as a possible 9th cluster member
for Phase 2 confirmation.

## uSockets re-entrancy enumeration

The uSockets callback graph dispatches every TCP/TLS/UDP/WebSocket event
through a `pub extern "C" fn` trampoline that materialises an `&mut Self::Ext`
borrow before calling into the user `Handler` trait. The re-entry-depth
contract is: **the body must not call back into uSockets while the `&mut
Self::Ext` borrow is live, or the trampoline must take `*mut Self` instead**.
Section Q encodes this discipline at three layers:

| callback | file:line | re-entry depth | aliasing contract documented? |
|---|---|---:|---|
| `vtable::SocketHandlerThunks::on_open` | `src/uws_sys/vtable.rs:246-261` | 0 (synchronous to handler body; re-entry possible if handler calls `socket.write()`) | yes — module-doc + per-thunk `// SAFETY` for the slice materialisation; handler responsibility is delegated to the `Handler` impl |
| `vtable::on_data` | `src/uws_sys/vtable.rs:263-272` | 0 | yes |
| `vtable::on_writable` | `src/uws_sys/vtable.rs:283-290` | re-entrant (handler typically calls `try_send`) | partial — handler is `&mut Self::Ext`, so re-entry from the body must avoid taking another borrow |
| `vtable::on_close` | `src/uws_sys/vtable.rs:292-304` | terminal (may free `Self::Ext`) | partial — close-time-free is the handler's responsibility; trampoline holds no borrow at return |
| `vtable::on_handshake` | `src/uws_sys/vtable.rs:350-361` | re-entrant | yes |
| `WebSocket::on_open` (RawWebSocket trampoline) | `src/uws_sys/WebSocket.rs:587-597` | 0 | yes — comment cites why `extern "C" fn` items coerce to `Option<unsafe extern "C" fn>` field type |
| `WebSocket::on_message` | `src/uws_sys/WebSocket.rs:599-612` | 0 | yes |
| `WebSocket::on_drain` | `src/uws_sys/WebSocket.rs:614-622` | re-entrant | yes |
| `WebSocket::on_ping/pong` | `src/uws_sys/WebSocket.rs:624-642` | 0 | yes |
| `WebSocket::on_close` | `src/uws_sys/WebSocket.rs:644-657` | terminal | yes |
| `WebSocket::on_upgrade` | `src/uws_sys/WebSocket.rs:659-720` | re-entrant (calls `accept_*`) | yes |
| `WebSocketUpgradeClient::handle_*` (9 callbacks) | `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:682,706,778,833,1189,1241,1680,1748,1761` | unbounded (all call `tcp.close()` / `Self::deref(this)` which may free `this`) | **best-in-section** — every handler takes `*mut Self`, NOT `&mut self`, with multi-paragraph Safety doc citing Stacked-Borrows-protector UB; sibling `cancel(this: *mut Self)` is the canonical reference fix from EXP-012 |
| `App::uws_listen_handler` (and `uws_method_handler` etc.) | `src/uws_sys/App.rs:251,268,302,512-515,526,695` | re-entrant (handler typically calls `Response::end`) | partial |
| `ListenSocket::on_server_name` | `src/uws_sys/ListenSocket.rs:116,145` | re-entrant (handler may call `add_server_name`) | partial |
| `WebSocketProxyTunnel::handle_*` (TLS callbacks) | `src/http_jsc/websocket_client/WebSocketProxyTunnel.rs:226,242,263,270,278,…,562,570,581` | unbounded (every body cites BACKREF / ScopedRef discipline) | yes — `// SAFETY: BACKREF` and `ScopedRef guard holds a ref` annotations on every site |

**Most concerning re-entry shapes:**

1. `vtable::on_writable` taking `&mut Self::Ext` while the handler is
   permitted to call back into `socket.write()`/`try_send` (which may
   re-enter `on_writable` synchronously) — the contract is on the handler,
   but no mechanical prevention exists. If a handler ever forms a Rust
   `&mut`/`&` to `Ext`-internal state across the inner write, the inner
   re-entry alias is UB.
2. `App` HTTP method handlers (`uws_method_handler`) take a `*mut uws_res`
   plus `*mut c_void` userdata; the handler typically calls
   `Response::end`, which can synchronously dispatch `on_aborted` on the
   *same* response — the response's userdata closure then re-enters Rust
   with a freshly-derived `&mut`. Same mechanical-prevention gap.
3. `WebSocketUpgradeClient::handle_*` is the *fixed* shape: `*mut Self`
   throughout, refcount-guard pattern, cancel/terminate/handle_close
   sequence proven against EXP-012 and the maintainers' historical fix.
   It serves as the model for the `vtable` and `App` layers to evolve to
   if the contract-only discipline ever proves insufficient under
   Stacked-Borrows test runs.

## c-ares (DNS) Send/Sync model

`bun_cares_sys::Channel` is an `bun_opaque::opaque_ffi!`-emitted opaque
ZST (`UnsafeCell<[u8; 0]>`, `!Freeze`, `!Sync`), with a hard
`const _: () = assert!(core::mem::size_of::<Channel>() == 0);` invariant
at `src/cares_sys/c_ares.rs:741`. The invariant is **load-bearing**:
`ares_cancel` and `ares_process_fd` are declared `safe fn(&mut Channel)`
on the basis that re-entrant callbacks deriving a fresh `&mut Channel`
from the userdata pointer cannot conflict with the outer borrow because
the type covers zero bytes. Comment at L737-740 documents that if `Channel`
ever gains a real field, those signatures **must** revert to
`unsafe fn(*mut Channel)`.

Threading model: `ChannelContainer` (the trait every owner of a `Channel`
implements) takes `&self` for `on_dns_socket_state`/`set_channel`. The
sock-state callback `unsafe extern "C" fn on_sock_state<C: ChannelContainer>`
at `src/cares_sys/c_ares.rs:792-797` re-enters the container with a
`&self` borrow that may already be live in `on_dns_poll` — interior
mutability through `Cell`/`RefCell`/`Atomic*` is the implementor's
responsibility (R-2 contract). The 4 `unsafe impl bun_core::ffi::Zeroable`
rows on `Options`, `AddrInfo_hints`, `struct_ares_addr6ttl`, and
`struct_ares_addr_port_node` document that all-zero is a valid bit-pattern
for the C struct (they ride on bytemuck-style Zeroable, not runtime UB).

`bun_dns` (the higher-level wrapper) adds POSIX `getaddrinfo`/
`freeaddrinfo` via `Drop for ResultAny` (`src/dns/lib.rs:329`), the
sockaddr-storage cast for AF_UNIX (`:419`), and a link-time extern
`Bun__addrinfo_registerQuic` (`:501-504`) plus an `unsafe extern "Rust"
fn __bun_dns_prefetch` (`:507-514`) — the latter is the crate-cycle
workaround for `bun_install` reaching into `bun_runtime::dns_jsc::internal::prefetch`
without taking a hard dep.

## Notable patterns

1. **Opaque-ZST `UnsafeCell<[u8; 0]>` aliasing escape hatch.** Documented
   ~15× across `bun_uws_sys` (`App`, `Response`, `us_socket_t`,
   `RawWebSocket`, `ConnectingSocket`, `ListenSocket`, `Loop`, `udp::Socket`,
   `h3::*`, `quic::{Stream,Socket,PendingConnect,Context}`) and once in
   `bun_cares_sys::Channel`. The pattern lets the wrapper expose
   `safe fn(&mut OpaqueT)` signatures despite re-entrant C callbacks because
   the type covers zero bytes — `&mut` carries no `noalias` and there is
   nothing to alias. Encoding the invariant as a `const _:` static assertion
   (as `cares_sys::Channel` does) would make the contract automatically
   enforced if any future port gives the type a real field; only `Channel`
   currently has this guard.

2. **`*mut Self` in callbacks that may free `self`.** Section Q's
   strongest discipline. `WebSocketUpgradeClient` (17 sites),
   `WebSocketProxyTunnel` (~10 sites), `ProxyTunnel::detach_and_deref` (1
   site), and the `handle_*` family in `H3Client::Stream` all follow this
   shape. The Safety doc for each cites Stacked-Borrows protector UB
   explicitly. This is the post-EXP-012 model the audit wants to see
   propagated to the `vtable::on_*` and `App::*_handler` layers.

3. **Provenance recovery from owning Vec for in-place mutation of borrowed
   slices.** `src/http/lib.rs:4141`'s `let base =
   self.state.response_message_buffer.list.as_mut_ptr(); let off =
   incoming_data.as_ptr() as usize - base as usize; unsafe {
   bun_core::ffi::slice_mut(base.add(off), in_len) }` — the canonical
   pattern for picohttp `phr_decode_chunked` in-place decoding without
   tripping U2. This is the remediation pattern EXP-011's H9 site is
   missing.

4. **Cross-thread handoff via `Guarded<Vec<T>>`.** `src/http/h3_client/PendingConnect.rs:188-189`
   (`unsafe impl Send for Resolved` + `static RESOLVED: Guarded<Vec<Resolved>>`)
   is the section's cleanest cross-thread `*mut` plumbing: the `Send`
   impl's SAFETY explicitly states "only ever crosses threads while held
   inside RESOLVED's mutex; the pointee is heap-allocated in `register()`
   and freed on the HTTP thread in `on_dns_resolved()`." Compare with
   `bun_http::HTTPThread::InitOpts` (`:314`) and `bun_http::lshpack::HpackHandle`
   (`:204`) which both carry shorter but defensible `unsafe impl Send`
   rationales (caller-config copy + caller-serialised C wrapper).

5. **Strict-provenance hazard at `bun_url::URL::host_with_path`.**
   `src/url/lib.rs:340-351` reconstructs a pointer from `usize` arithmetic
   (`let end = self.path.as_ptr() as usize + self.path.len(); let ptr =
   start as *const u8`). Under `-Zmiri-strict-provenance` the
   integer-to-pointer cast is rejected before the deref. Phase 5 now has a
   mirror log at `phase5_experiment_results/EXP-020.log`. The fix should form
   the returned pointer from the original `self.href`/`self.host` slice base
   with provenance-preserving pointer APIs, not from an integer address.

## Open questions

1. A full integrated `bun_picohttp::Request::parse` Miri fixture would still
   improve reviewer ergonomics, but EXP-011 has already confirmed the relevant
   wrapper provenance pattern under Tree Borrows. The `Vec<u8>::as_mut_ptr()`-
   into-the-buffer pattern from `lib.rs:4141` remains the obvious fix shape.
2. The `bun_http::ProxyTunnel::detach_and_deref` site (`:791`) — does it
   belong in the U2 cluster as a 9th member? It has the same shape
   (`&mut self` → coerce to `*mut` → dispatch dealloc) but the SAFETY
   comment names provenance and the dealloc happens through `IntrusiveRc`
   not `Box::from_raw`, so the protector argument is weaker.
3. `bun_url::URL::host_with_path`'s int-to-pointer round-trip: EXP-020
   confirms the strict-provenance failure in a mirror. Phase 2 should now design
   the provenance-preserving rewrite and confirm equivalence on URL fixtures.
4. The `vtable::on_writable` and `App::*_handler` re-entry shape: is the
   contract-only discipline sufficient, or should both layers move to
   `*mut Self::Ext` like `WebSocketUpgradeClient`? The answer is empirical
   — Phase 3 should run a `loom` model of one nested `try_send` to see
   whether Stacked Borrows fires.
5. The 35 `bun_opaque::opaque_ffi!` invocations — only `cares_sys::Channel`
   carries the `assert!(size_of == 0)` static-assertion guard. Should
   the macro itself emit this assertion, making the invariant
   tamper-proof without per-site discipline?

## Anchor cross-refs (EXP-011)

- **EXP-011 anchor site:** `src/picohttp/lib.rs:383`
- **EXP-011 witness:** `experiments/EXP-011/src/main.rs`, raw log
  `phase5_experiment_results/EXP-011-tree-borrows-model.log`
- **Prior finding:** PASS3 H9 in `.unsafe-audit/PASS3_FINDINGS_INDEX.md`
- **U2 cluster cross-refs in Section Q:** `src/http/AsyncHTTP.rs:117`
  (PASS5 11.1), `src/http/lib.rs:176` (PASS5 11.2)
- **Best remediation reference (in-section):** `src/http/lib.rs:4136-4141`
  — chunked-decoder Vec-base provenance recovery; the explicit shape EXP-011
  should adopt
- **Companion EXP cross-ref:** EXP-012 (Section F) — the `WebSocketUpgradeClient::cancel`
  fix at `src/http_jsc/websocket_client/WebSocketUpgradeClient.rs:599-637`
  is the in-section reference for the `*mut Self` discipline that the
  remaining `vtable::on_*`/`App::*_handler` layers might evolve to.
